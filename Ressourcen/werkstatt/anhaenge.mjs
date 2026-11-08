// werkstatt/anhaenge.mjs — Routen für Anhänge (Paket 3a): Hochladen in Stücken, Ausliefern, Rückfrage beim Löschen, externe Bilder.
//   POST /api/anhang/start     { name, groesse, notiz? }        → { id }       prüft Größe und Endung, bevor Bytes fließen
//   POST /api/anhang/teil      { id, nr, daten (Base64) }       → { ok }       Stücke der Reihe nach (der Nachrichtenkanal der Mac-App nimmt höchstens 8 MB je Anfrage)
//   POST /api/anhang/ende      { id }                           → { pfad, name, art, groesse, mime, einbettung, gross? }   prüft Inhalt, bereinigt SVG, legt die Datei an
//   GET  /api/anhang/aufloesen ?ziel=&von=                      → { pfad, name, groesse, art }   wohin zeigt ein Ziel (Chips); 404, wenn es den Anhang nicht gibt
//   GET  /api/anhang/unbenutzt ?pfad=<Notiz>                    → { anhaenge: [{ pfad, name, art, groesse }] }   Anhänge, die nur diese Notiz benutzt
//   POST /api/anhang/loeschen  { pfade: [..] }                  → { ergebnisse }   in den Papierkorb (gemeinsam/dateiaktionen.mjs), nie endgültig
//   GET  /_anhang?ziel=<Name|Pfad>&von=<Notiz>                  → die Datei (kein /api/…: so geht es auch als Seitenabruf durch die Mac-App)
//   GET  /_extern-bild?url=<https-Adresse>                      → ein externes Bild über die Werkstatt (nur auf Klick/Einstellung des Nutzers; sonst bleibt die Seite bei img-src 'self')
// Die Stücke liegen bis zum Ende im Speicher (Obergrenze = Größengrenze, höchstens 8 Sitzungen, Verfall nach 2 Minuten); nichts liegt halb fertig auf der Platte.
import { statSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { HttpFehler, testmodus } from "../gemeinsam/basis.mjs";
import { leseApp } from "../gemeinsam/app-einstellungen.mjs";
import { anhangEinstellungen, speichereAnhang, loeseAnhang, unbenutzteAnhaenge, bereinigeSvg, holeExternBild, endungVon, istBildName, mimeFuer, groesseText, ANHANG_TYPEN } from "../gemeinsam/anhaenge.mjs";

const FRIST_MS = 120_000, MAX_SITZUNGEN = 8, MAX_STUECK = 6 * 1024 * 1024, MAX_AUSLIEFERN = 256 * 1024 * 1024, MAX_LOESCHEN = 100;
const SICHER = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
// PDF bewusst nicht inline: Chromium zeigt PDFs nicht unter „Content-Security-Policy: sandbox“ (der Viewer ist eine Erweiterung im eingebetteten Rahmen); statt die Sandbox für PDFs zu lockern, lädt der Browser sie herunter
// (Mac-App und Electron öffnen sie mit dem Programm des Systems, anhang-oeffnen). Nicht prüfbar in der Test-Chromium (Headless-Shell ohne PDF-Viewer).
const INLINE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "mp3", "m4a", "wav", "mp4", "mov", "webm"]);
const MAX_GESAMT = 200 * 1024 * 1024; // alle laufenden Uploads zusammen

const kopf = (typ, extra = {}) => ({ "Content-Type": typ, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SICHER, "Referrer-Policy": "no-referrer", "Cache-Control": "private, max-age=300", ...extra });
const JSON_KOPF = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const nicht = () => ({ status: 404, headers: { ...JSON_KOPF }, body: Buffer.from(JSON.stringify({ fehler: "nicht gefunden" })) });
const fehlerAntwort = (e) => ({ status: e instanceof HttpFehler ? e.status : 502, headers: { ...JSON_KOPF },
  body: Buffer.from(JSON.stringify({ fehler: e instanceof HttpFehler ? e.message : "Das Bild konnte nicht geladen werden.", ...(e instanceof HttpFehler ? e.extra || {} : {}) })) });

// deps: { support }
export function erzeugeAnhaenge({ support }) {
  const sitzungen = new Map();
  const einst = () => anhangEinstellungen(leseApp(support).werte);
  const raeume = () => { const jetzt = Date.now(); for (const [id, s] of sitzungen) if (jetzt - s.zeit > FRIST_MS) sitzungen.delete(id); };
  const text = (x, was) => { if (typeof x !== "string" || !x.trim() || x.length > 400 || /[\u0000-\u001f]/.test(x)) throw new HttpFehler(400, `Bitte ${was} angeben.`); return x; };

  return {
    einstellungen: einst,

    start(e) {
      raeume();
      const name = text(e?.name, "einen Dateinamen").replace(/[\\/]+/g, "/").split("/").pop();
      const groesse = e?.groesse;
      const notiz = e?.notiz == null || e.notiz === "" ? "" : text(e.notiz, "die Notiz");
      if (!Number.isInteger(groesse) || groesse < 1) throw new HttpFehler(400, "Die Datei ist leer.", { art: "leer" });
      const grenze = einst().maxBytes;
      if (groesse > grenze) throw new HttpFehler(413, `Die Datei ist ${groesseText(groesse)} groß. Erlaubt sind ${groesseText(grenze)} (Einstellungen → Schreiben → Anhänge).`, { art: "zu-gross", groesse, grenze });
      const endung = endungVon(name);
      if (/\.[A-Za-z0-9]{1,8}$/.test(name) && !Object.hasOwn(ANHANG_TYPEN, endung)) {
        throw new HttpFehler(415, `Dateien vom Typ „.${endung}“ legt Kortex nicht ab (erlaubt: Bilder, PDF, Office-Dateien, Text, Archive, Audio und Video).`, { art: "typ", endung });
      }
      let belegt = 0; for (const s of sitzungen.values()) belegt += s.groesse;
      if (belegt + groesse > MAX_GESAMT) throw new HttpFehler(429, "Es laufen gerade zu viele große Uploads. Bitte kurz warten.", { art: "voll" });
      if (sitzungen.size >= MAX_SITZUNGEN) throw new HttpFehler(429, "Es laufen schon mehrere Uploads. Bitte kurz warten.", { art: "voll" });
      const id = randomBytes(8).toString("hex");
      sitzungen.set(id, { name, groesse, notiz, stuecke: [], summe: 0, zeit: Date.now() });
      return { id };
    },

    teil(e) {
      raeume();
      const s = sitzungen.get(e?.id);
      if (!s) throw new HttpFehler(410, "Der Upload ist abgelaufen. Bitte noch einmal einfügen.", { art: "abgelaufen" });
      if (!Number.isInteger(e.nr) || e.nr !== s.stuecke.length) throw new HttpFehler(400, "Die Stücke kamen in falscher Reihenfolge.");
      if (typeof e.daten !== "string" || e.daten.length > Math.ceil(MAX_STUECK * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(e.daten)) throw new HttpFehler(400, "Ungültige Daten.");
      const buf = Buffer.from(e.daten, "base64");
      if (s.summe + buf.length > s.groesse) { sitzungen.delete(e.id); throw new HttpFehler(400, "Es kamen mehr Bytes an als angekündigt."); }
      s.stuecke.push(buf); s.summe += buf.length; s.zeit = Date.now();
      return { ok: true, summe: s.summe };
    },

    ende(v, e) {
      const s = sitzungen.get(e?.id);
      if (!s) throw new HttpFehler(410, "Der Upload ist abgelaufen. Bitte noch einmal einfügen.", { art: "abgelaufen" });
      sitzungen.delete(e.id);
      if (s.summe !== s.groesse) throw new HttpFehler(400, "Die Datei kam nicht vollständig an.", { art: "unvollstaendig" });
      return speichereAnhang({ wurzel: v.wurzel, notiz: s.notiz, name: s.name, buf: Buffer.concat(s.stuecke), einstellungen: leseApp(support).werte });
    },

    unbenutzt(v, pfad) {
      if (typeof pfad !== "string" || !pfad) throw new HttpFehler(400, "Bitte eine Notiz angeben.");
      return unbenutzteAnhaenge({ wurzel: v.wurzel, notiz: pfad, einstellungen: leseApp(support).werte }); // { anhaenge, unsicher }
    },

    // Wohin zeigt dieses Ziel (für Chips: Pfad im Vault für „anhang-oeffnen“, Größe, Art)? 404, wenn es den Anhang nicht gibt.
    aufloesen(v, ziel, von) {
      const t = loeseAnhang(v.wurzel, { von: von || "", ziel: ziel || "", ordner: einst().ordner });
      if (!t) throw new HttpFehler(404, "Diesen Anhang gibt es nicht (mehr).", { art: "fehlt" });
      let groesse = 0; try { groesse = statSync(t.abs).size; } catch { /* weg */ }
      return { pfad: t.rel, name: t.rel.split("/").pop(), groesse, art: istBildName(t.rel) ? "bild" : "datei" };
    },

    async loeschen(v, e) {
      const pfade = e?.pfade;
      if (!Array.isArray(pfade) || !pfade.length || pfade.length > MAX_LOESCHEN || pfade.some((p) => typeof p !== "string" || !p)) throw new HttpFehler(400, "Bitte die Anhänge angeben.");
      const ergebnisse = [];
      for (const pfad of pfade) {
        try { const r = await v.loeschen({ pfad, typ: "datei", anhang: true }); ergebnisse.push({ pfad, ok: true, vorgang: r.vorgang }); }
        catch (err) { ergebnisse.push({ pfad, ok: false, fehler: err instanceof HttpFehler ? err.message : "Nicht möglich." }); }
      }
      return { ok: ergebnisse.every((r) => r.ok), ergebnisse, geaendert: pfade };
    },

    // GET /_anhang: nur Dateien mit Anhang-Endung, nur innerhalb des Vaults
    liefere(v, q) {
      if (!v) return nicht();
      const treffer = loeseAnhang(v.wurzel, { von: q.get("von") || "", ziel: q.get("ziel") || "", ordner: einst().ordner });
      if (!treffer) return nicht();
      let st; try { st = statSync(treffer.abs); } catch { return nicht(); }
      if (!st.isFile() || st.size > MAX_AUSLIEFERN) return nicht();
      let body; try { body = readFileSync(treffer.abs); } catch { return nicht(); }
      const endung = endungVon(treffer.rel);
      if (endung === "svg") { try { body = Buffer.from(bereinigeSvg(body.toString("utf8")), "utf8"); } catch { return nicht(); } } // auch von Hand abgelegte SVG liefert Kortex nur bereinigt aus
      const name = treffer.rel.split("/").pop().replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      return { status: 200, headers: kopf(mimeFuer(treffer.rel), { "Content-Disposition": `${INLINE.has(endung) ? "inline" : "attachment"}; filename="${name}"` }), body };
    },

    // GET /_extern-bild
    async extern(q) {
      try {
        const r = await holeExternBild(q.get("url") || "", { erlaubeLokal: testmodus() && process.env.BRAIN_EXTERN_LOKAL === "1" });
        return { status: 200, headers: kopf(r.typ, { "Content-Disposition": "inline" }), body: r.body };
      } catch (e) { return fehlerAntwort(e); }
    },
  };
}
