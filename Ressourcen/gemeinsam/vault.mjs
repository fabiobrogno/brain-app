// gemeinsam/vault.mjs — Kern von Brain Studio (Spec §3/§5): Pfad-Schutz, Baum, Lesen/Schreiben (atomar, Hash),
// Neu, Merken, Suche, Prüf-Signale, Git, Kit-Gesundheit. Wird von der Werkstatt und vom MCP-Server importiert.
import {
  realpathSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync,
  mkdirSync, renameSync, linkSync, unlinkSync, existsSync,
} from "node:fs";
import { join, basename, relative, sep, isAbsolute } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HttpFehler, MAX_DATEI, inboxOrdnerVon, vorlagenOrdnerVon, inboxHinweisVon, loese, imVault, falte, kindUmgebung, supportOrdner, kernOrdner, BEARBEITBAR, generiertName, wikiGeneriert, gesperrterName } from "./basis.mjs";
import { pruefeText, leseKopf } from "./pruefung.mjs";
import { heuteIso } from "./zeit.mjs";
import { zielZuNeuerNotiz, ordnerVonPfad } from "./wikilink.mjs";
import * as gitFn from "./git.mjs";
import * as vertrauenFn from "./vertrauen.mjs";
import { leseAbgleichDetail, loescheAbgleichStand, kennung as vaultKennung } from "./sicherungsmerker.mjs";
import { umstellungLaeuft } from "./umstellung-sperre.mjs";
import { erzeugeNotizIndex, titelAus } from "./notizen.mjs";
import { wertAus } from "./nutzung.mjs";
import { erzeugePosteingang } from "./posteingang.mjs";
import { erzeugeAufgaben } from "./aufgaben-vault.mjs";
import { erzeugeDateiaktionen } from "./dateiaktionen.mjs";
import { SUCHE_STANDARD, SUCHE_MAX, sucheWoerter, suchAuszug, sucheText } from "./ki-antworten.mjs";
import { erzeugeSuchindex } from "./suchindex.mjs";
import { erzeugeTagIndex } from "./tags.mjs";
import { erzeugeExport } from "./export.mjs";
import { erzeugeErwaehnungen } from "./erwaehnungen-index.mjs";
import { zeileIstKiNein } from "./ki-schema.mjs";
import { baueNeuigkeiten, leseMarke, setzeMarke, STANDARD_TAGE } from "./neuigkeiten.mjs";
import * as merge3 from "./merge3.mjs";
import * as ablageFn from "./ablage.mjs";
import * as entwurfFn from "./entwurf.mjs";
import { leseEreignisse, kennungVault, programmAnzeige } from "./aktivitaet.mjs";

export { HttpFehler, pruefeText, heuteIso, supportOrdner };
export const STUFE_TEXT = { gruen: "grün", gelb: "gelb", rot: "rot", grau: "grau", ohne: "ohne Befund" };

const HASH = (buf) => createHash("sha256").update(buf).digest("hex");

export function slug(s, max = 50) {
  const t = String(s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return t || "notiz";
}

function kopfBytes(abs, n = 400) {
  let fd;
  try { fd = openSync(abs, "r"); const b = Buffer.alloc(n); const len = readSync(fd, b, 0, n, 0); return b.subarray(0, len).toString("utf8"); }
  catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}

export function oeffneVault(vaultPfad, opts = {}) {
  let wurzel;
  try { wurzel = realpathSync(vaultPfad); if (!statSync(wurzel).isDirectory()) throw 0; }
  catch { throw new HttpFehler(400, "Der Vault-Ordner existiert nicht."); }
  const jetzt = opts.jetzt || (() => new Date());
  // Kern-Werkzeuge (Gesundheit, Rückfragen) laufen aus dem gebündelten Kern (opts.kern = Test), nie aus dem Vault.
  const kern = opts.kern || kernOrdner();
  const kitPfad = join(kern, "brain.mjs");

  // „generiert — nicht editieren“ in den ersten 3 Zeilen, bekannte generierte Namen, _*.md unter 09_wiki
  function istGeneriert(rel, abs) {
    const name = rel.split("/").pop();
    if (generiertName(name)) return true;
    if (wikiGeneriert(rel, name)) return true;
    if (!abs || !BEARBEITBAR.test(name)) return false;
    const kopf = kopfBytes(abs).split(/\r?\n/).slice(0, 3).join("\n");
    return /generiert\s+—\s+nicht\s+editieren/i.test(kopf);
  }
  const mehrfachVerknuepft = (st) => st.isFile() && st.nlink > 1;
  // Unter-Vaults (opts.ohneUnterVaults, vom MCP-Server gesetzt): Ein Unterordner mit eigener brain.config.json ist ein eigener Vault mit eigenen Zugriffsregeln. Für eine KI gehört er nicht zum äußeren
  // Vault — weder im Baum noch in der Suche, im Kontext oder beim Lesen: sonst läse jedes Konto, das den äußeren Vault sehen darf, den inneren mit (der ggf. für dieses Konto gesperrt ist).
  const istUnterVaultOrdner = (abs) => opts.ohneUnterVaults === true && abs !== wurzel && existsSync(join(abs, "brain.config.json"));
  const imUnterVault = (abs) => {
    if (opts.ohneUnterVaults !== true) return false;
    const teile = relative(wurzel, abs).split(sep).filter(Boolean);
    let p = wurzel;
    for (const t of teile.slice(0, -1)) { p = join(p, t); if (istUnterVaultOrdner(p)) return true; }
    return false;
  };
  const schreibgeschuetzt = (rel, abs, st) => !BEARBEITBAR.test(rel) || istGeneriert(rel, abs) || (st ? mehrfachVerknuepft(st) : false);

  // ---------- Baum ----------
  // Titel je Datei (H1, sonst Frontmatter title/titel/name) für die Befehlspalette; Cache je Pfad+Änderungszeit+Größe.
  const titelCache = new Map();
  function titelFuerBaum(rel, abs, st) {
    if (!BEARBEITBAR.test(rel) || st.size > 1024 * 1024) return "";
    const schluessel = `${st.mtimeMs}:${st.size}`;
    const c = titelCache.get(rel);
    if (c && c.k === schluessel) return c.t;
    const t = titelAus(rel, kopfBytes(abs, 8192));
    titelCache.set(rel, { k: schluessel, t });
    return t;
  }
  const dateiEintrag = (rel, abs, st) => ({ pfad: rel, art: "datei", geaendert: st.mtime.toISOString(), groesse: st.size, schreibschutz: schreibgeschuetzt(rel, abs, st), titel: titelFuerBaum(rel, abs, st) });
  function baum() {
    const eintraege = [];
    const geh = (relOrdner) => {
      const abs = relOrdner ? join(wurzel, relOrdner) : wurzel;
      let liste;
      try { liste = readdirSync(abs, { withFileTypes: true }); } catch { return; }
      const ordner = [], dateien = [];
      for (const d of liste) {
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        let istOrdner = d.isDirectory(), istDatei = d.isFile();
        if (d.isSymbolicLink()) { // nur Dateien, die im Vault bleiben; Ordner-Symlinks nie (Schleifen)
          try { const echt = realpathSync(join(abs, d.name)); if (!imVault(echt, wurzel) || !statSync(echt).isFile()) continue; istDatei = true; istOrdner = false; } catch { continue; }
        }
        if (istOrdner && istUnterVaultOrdner(join(abs, d.name))) continue;
        if (istOrdner) ordner.push({ name: d.name, rel });
        else if (istDatei) dateien.push({ name: d.name, rel });
      }
      const nach = (a, b) => a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
      ordner.sort(nach); dateien.sort(nach);
      for (const o of ordner) {
        let st; try { st = statSync(join(wurzel, o.rel)); } catch { continue; }
        eintraege.push({ pfad: o.rel, art: "ordner", geaendert: st.mtime.toISOString(), groesse: 0, schreibschutz: false });
        geh(o.rel);
      }
      for (const f of dateien) {
        const a = join(wurzel, f.rel);
        let st; try { st = statSync(a); } catch { continue; }
        eintraege.push(dateiEintrag(f.rel, a, st));
      }
    };
    geh("");
    return { eintraege };
  }

  // Teil-Index für die Live-Aktualisierung der Oberfläche: Baum-Eintrag und Notiz-Zeile nur der genannten Dateien (geändert, bereits bekannt) — kein
  // Verzeichnislauf. { voll: true } heißt: das reicht nicht (neue, entfernte oder unbekannte Pfade, Ordner, Symlinks, Titel/Alias geändert, zu viele,
  // noch kein Vollauf) — die Oberfläche lädt dann wie bisher Baum und Index ganz. Rein lesend.
  const TEIL_MAX = 200;
  async function teilIndex(pfade) {
    const VOLL = { voll: true };
    if (!Array.isArray(pfade) || !pfade.length || pfade.length > TEIL_MAX) return VOLL;
    const dateien = [];
    for (const p of pfade) {
      if (typeof p !== "string") return VOLL;
      let l; try { l = loese(wurzel, p); } catch { return VOLL; }
      if (l.segmente.some(gesperrterName) || imUnterVault(l.abs)) return VOLL;
      dateien.push(l);
    }
    const eintraege = [];
    for (const { rel, abs } of dateien) {
      let st; try { st = lstatSync(abs); } catch { return VOLL; }
      if (st.isSymbolicLink() || !st.isFile()) return VOLL;
      eintraege.push(dateiEintrag(rel, abs, st));
    }
    const notizPfade = dateien.filter((d) => BEARBEITBAR.test(d.rel)).map((d) => d.rel);
    let teil = null;
    if (notizPfade.length) { teil = notizIndex.teil(notizPfade); if (!teil) return VOLL; }
    return { voll: false, baum: eintraege, notizen: teil ? teil.zeilen : [], ...(teil ? { typen: teil.typen, ansichten: teil.ansichten } : {}), aufgabenOrdner: await aufgabenFn.ordnerName(), inboxOrdner: inboxOrdnerVon(wurzel), vorlagenOrdner: vorlagenOrdnerVon(wurzel), ...hinweisFeld() };
  }

  // ---------- Lesen / Schreiben ----------
  function lies(rel) {
    const { abs, rel: sauber } = loese(wurzel, rel);
    if (imUnterVault(abs)) throw new HttpFehler(404, "Diese Datei gibt es nicht.");
    if (!BEARBEITBAR.test(sauber)) throw new HttpFehler(415, "Nur Markdown- und Textdateien lassen sich öffnen.");
    let st, buf;
    try { st = statSync(abs); if (!st.isFile()) throw 0; if (st.size > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß."); buf = readFileSync(abs); }
    catch (e) { if (e instanceof HttpFehler) throw e; throw new HttpFehler(404, "Diese Datei gibt es nicht."); }
    const inhalt = buf.toString("utf8");
    if (Buffer.compare(Buffer.from(inhalt, "utf8"), buf) !== 0) throw new HttpFehler(415, "Diese Datei ist kein gültiger UTF-8-Text und wird nicht geöffnet.");
    return { pfad: sauber, inhalt, hash: HASH(buf), geaendert: st.mtime.toISOString(), schreibschutz: schreibgeschuetzt(sauber, abs, st) };
  }

  function tmpName(abs) { return join(abs, "..", `.brain-tmp-${process.pid}-${randomBytes(4).toString("hex")}`); }

  function schreibe({ pfad, inhalt, basisHash }) {
    if (typeof inhalt !== "string") throw new HttpFehler(400, "Der Inhalt fehlt.");
    if (basisHash !== null && typeof basisHash !== "string") throw new HttpFehler(400, "basisHash fehlt (null = neu anlegen).");
    let { abs, rel } = loese(wurzel, pfad);
    if (!BEARBEITBAR.test(rel)) throw new HttpFehler(403, "Nur Markdown- und Textdateien lassen sich bearbeiten.");
    const buf = Buffer.from(inhalt, "utf8");
    if (buf.length > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß.");
    // Symlink im Vault: geschrieben wird atomar auf das (per realpath aufgelöste) Ziel, das im Vault liegen muss —
    // der Link selbst bleibt ein Link; Schutz und Hash gelten für das Ziel.
    try {
      if (lstatSync(abs).isSymbolicLink()) {
        let echt;
        try { echt = realpathSync(abs); } catch { throw new HttpFehler(403, "Dieser Verweis führt ins Leere."); }
        if (!imVault(echt, wurzel)) throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
        const zielRel = relative(wurzel, echt).split(sep);
        if (zielRel.some(gesperrterName)) throw new HttpFehler(403, "Dieser Ort ist gesperrt.");
        if (!BEARBEITBAR.test(echt)) throw new HttpFehler(403, "Nur Markdown- und Textdateien lassen sich bearbeiten.");
        abs = echt; rel = zielRel.join("/");
      }
    } catch (e) { if (e instanceof HttpFehler) throw e; /* gibt es noch nicht */ }
    let alt = null;
    try { const st = lstatSync(abs); if (!st.isFile()) throw new HttpFehler(400, "Das ist ein Ordner, keine Datei."); if (mehrfachVerknuepft(st)) throw new HttpFehler(423, "Diese Datei ist mehrfach verknüpft (derselbe Inhalt liegt unter einem zweiten Namen). Beim Speichern würden die Namen auseinanderlaufen — bitte nicht hier bearbeiten.");
      alt = readFileSync(abs); } catch (e) { if (e instanceof HttpFehler) throw e; }
    if (alt && istGeneriert(rel, abs)) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist schreibgeschützt.");
    if (!alt && istGeneriert(rel, null)) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist schreibgeschützt.");
    if (basisHash === null) {
      if (alt) throw new HttpFehler(409, "Diese Datei gibt es schon.", { aktuellerHash: HASH(alt) });
    } else {
      if (!alt) throw new HttpFehler(404, "Diese Datei gibt es nicht mehr.");
      if (HASH(alt) !== basisHash) throw new HttpFehler(409, "Die Datei wurde inzwischen geändert (zum Beispiel von einem anderen Programm).", { aktuellerHash: HASH(alt) });
    }
    mkdirSync(join(abs, ".."), { recursive: true });
    const tmp = tmpName(abs);
    try {
      writeFileSync(tmp, buf, { flag: "wx", mode: alt ? statSync(abs).mode & 0o777 : 0o644 });
      // Direkt vor dem Ersetzen noch einmal prüfen: zwischen dem ersten Lesen und hier kann ein anderes Programm geschrieben haben (das Schreiben der Temp-Datei dauert bei großen Dateien Millisekunden)
      if (alt) { let jetzt = null; try { jetzt = readFileSync(abs); } catch { /* weg: unten */ } if (!jetzt) throw new HttpFehler(404, "Diese Datei gibt es nicht mehr."); if (HASH(jetzt) !== HASH(alt)) throw new HttpFehler(409, "Die Datei wurde inzwischen geändert (zum Beispiel von einem anderen Programm).", { aktuellerHash: HASH(jetzt) }); }
      if (alt) renameSync(tmp, abs); // atomar ersetzen
      else { try { linkSync(tmp, abs); } catch (e) { if (e.code === "EEXIST") throw new HttpFehler(409, "Diese Datei gibt es schon."); throw e; } unlinkSync(tmp); }
    } catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
    suchindex?.aendere(rel); tagIndex.aendere(rel);
    return { hash: HASH(buf), geaendert: statSync(abs).mtime.toISOString() };
  }

  // ---------- Fremdänderung bei offener Notiz: Drei-Wege-Zusammenführung, Ablage, Entwurfs-Journal ----------
  const supportOrdnerV = () => opts.support || supportOrdner();
  // Wer hat die Datei zuletzt geändert? Das Aktivitätsprotokoll kennt KI-Ablagen und Änderungen der letzten Minuten → "Claude Code", sonst null.
  function quelleFuer(rel) {
    try {
      const seit = new Date(Date.now() - 30 * 60_000).toISOString();
      const e = leseEreignisse(supportOrdnerV(), kennungVault(wurzel), { seit }).filter((x) => Array.isArray(x.pfade) && x.pfade.includes(rel) && x.programm).pop();
      return e ? programmAnzeige(e.programm) : null;
    } catch { return null; }
  }
  // a = { pfad, basis (Text beim Öffnen bzw. letzten Speichern), meine (Text im Editor), basisHash (Hash der Datei, auf der der Editor aufbaut) }
  //   ohne auswahl: hat die Platte sich nicht geändert → speichern · lässt sich alles zusammenführen → zusammengeführt geschrieben (die fremde Fassung liegt vorher in der Ablage) ·
  //                 sonst { art: "konflikt", teile, aktuellerHash } ohne etwas zu schreiben
  //   mit auswahl (je Konfliktblock "meine" | "andere" | "beide" | { text }) und gesehenHash (der aktuellerHash, den die Oberfläche gezeigt hat): die Wahl anwenden und schreiben;
  //                 hat die Platte sich inzwischen noch einmal geändert → 409 art "erneut" und es wird nichts geschrieben.
  // Vor jedem Überschreiben liegt die fremde Fassung in der Ablage (und, wenn meine Fassung nicht ganz übernommen wird, auch meine). Schlägt das Ablegen fehl, wird nichts geschrieben.
  function zusammenfuehren(a) {
    if (!a || typeof a !== "object") throw new HttpFehler(400, "Die Anfrage ist kein Objekt.");
    const { pfad, basis, meine, basisHash, auswahl, gesehenHash } = a;
    if (typeof pfad !== "string" || typeof meine !== "string" || typeof basisHash !== "string") throw new HttpFehler(400, "pfad, meine und basisHash fehlen.");
    const aktuell = lies(pfad);
    if (aktuell.schreibschutz) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist schreibgeschützt.");
    // Hat die Platte sich gegenüber dem Stand des Editors nicht verändert (gleicher Text wie die Basis), gibt es nichts zusammenzuführen: einfach speichern.
    // Gilt der Text, nicht der Hash: ein Programm, das dieselben Bytes neu schreibt, ist keine Änderung.
    if (typeof basis === "string" ? aktuell.inhalt === basis : aktuell.hash === basisHash) { const r = schreibe({ pfad, inhalt: meine, basisHash: aktuell.hash }); return { art: "gespeichert", hash: r.hash, geaendert: r.geaendert }; }
    if (typeof basis !== "string") throw new HttpFehler(400, "basis fehlt (der Text, auf dem die Eingaben aufbauen).");
    const quelle = quelleFuer(aktuell.pfad);
    const erg = merge3.zusammenfuehren(basis, meine, aktuell.inhalt);
    let wahl = [];
    if (auswahl !== undefined) {
      if (gesehenHash !== aktuell.hash) throw new HttpFehler(409, "Die Datei wurde inzwischen noch einmal geändert. Kortex zeigt dir den neuen Stand.", { art: "erneut", aktuellerHash: aktuell.hash });
      if (!Array.isArray(auswahl) || auswahl.length !== erg.konflikte || !auswahl.every(merge3.istWahl)) throw new HttpFehler(400, "Die Wahl passt nicht zu den Konfliktblöcken.");
      wahl = auswahl;
    } else if (!erg.sauber) {
      return { art: "konflikt", aktuellerHash: aktuell.hash, teile: erg.teile, konflikte: erg.konflikte, quelle };
    }
    const text = merge3.baue(erg.teile, wahl);
    const art = auswahl !== undefined ? "zusammengefuehrt" : (text === aktuell.inhalt ? "uebernommen" : "eingearbeitet");
    const ablegeMeine = (grund) => ablageFn.legeAb(supportOrdnerV(), wurzel, { pfad: aktuell.pfad, inhalt: meine, grund, quelle: "meine Fassung" });
    if (text === aktuell.inhalt) return { art, text, hash: aktuell.hash, quelle, ...(meine !== text ? { meineFassung: ablegeMeine(auswahl !== undefined ? "meine-verworfen" : "meine-vor-einarbeiten").id } : {}) };
    // Ablage VOR dem Schreiben: die fremde Fassung (und meine, wenn sie nicht vollständig im Ergebnis steckt)
    const fremd = ablageFn.legeAb(supportOrdnerV(), wurzel, { pfad: aktuell.pfad, inhalt: aktuell.inhalt, grund: auswahl !== undefined ? "fremd-zusammengefuehrt" : "fremd-eingearbeitet", quelle });
    const eigene = meine !== text ? ablegeMeine(auswahl !== undefined ? "meine-vor-zusammenfuehren" : "meine-vor-einarbeiten") : null; // auch beim automatischen Einarbeiten: meine Fassung liegt danach in der Ablage
    const r = schreibe({ pfad, inhalt: text, basisHash: aktuell.hash });
    return { art, text, hash: r.hash, geaendert: r.geaendert, quelle, fremdFassung: fremd.id, ...(eigene ? { meineFassung: eigene.id } : {}) };
  }
  // Eine Fremddatei, die noch geschrieben wird (Größe oder Änderungszeit ändern sich), nicht halb zusammenführen: erst warten, bis sie `ruheMs` still ist (höchstens `hoechstMs`).
  async function warteBisStabil(pfad, { ruheMs = 300, hoechstMs = 3000, schritt = 60 } = {}) {
    let abs; try { abs = loese(wurzel, pfad).abs; } catch { return true; }
    const stand = () => { try { const st = statSync(abs); return `${st.mtimeMs}:${st.size}`; } catch { return "weg"; } };
    const ende = Date.now() + hoechstMs;
    let letzter = stand(), seit = Date.now();
    try { seit = Math.min(seit, statSync(abs).mtimeMs); } catch { /* weg */ } // eine längst unveränderte Datei ist sofort stabil
    for (;;) {
      if (Date.now() - seit >= ruheMs) return true;
      if (Date.now() >= ende) return false;
      await new Promise((ok) => setTimeout(ok, schritt));
      const jetzt = stand();
      if (jetzt !== letzter) { letzter = jetzt; seit = Date.now(); }
    }
  }
  const ablageListe = (pfad) => ({ fassungen: ablageFn.liste(supportOrdnerV(), wurzel, pfad ? loese(wurzel, pfad).rel : null) });
  const ablageLese = (id) => ablageFn.lese(supportOrdnerV(), wurzel, id);
  const ablageLegeAb = (a) => { // eine Fassung, die der Nutzer selbst verwirft („Neu laden“, „Verwerfen“): erst ablegen, dann darf das Studio sie weglassen
    if (!a || typeof a.pfad !== "string" || typeof a.inhalt !== "string") throw new HttpFehler(400, "pfad und inhalt fehlen.");
    const grund = ["meine-verworfen", "entwurf-verworfen", "fremd-ueberschrieben"].includes(a.grund) ? a.grund : "meine-verworfen";
    const r = ablageFn.legeAb(supportOrdnerV(), wurzel, { pfad: loese(wurzel, a.pfad).rel, inhalt: a.inhalt, grund, quelle: grund === "fremd-ueberschrieben" ? "andere Fassung" : "meine Fassung" });
    return { id: r.id, zeit: r.zeit };
  };
  // Entwurf: nur zurückgeben, wenn er NEUER ist als die Datei und anders als ihr Inhalt; ist er gleich, ist er überflüssig und wird entfernt.
  function entwurfPruefen(pfad) {
    const e = entwurfFn.leseEntwurf(supportOrdnerV(), wurzel, pfad);
    if (!e) return { entwurf: null };
    let d = null; try { d = lies(pfad); } catch { /* Datei gibt es (noch) nicht */ }
    if (d && d.inhalt === e.text) { entwurfFn.loescheEntwurf(supportOrdnerV(), wurzel, pfad); return { entwurf: null }; }
    if (d && Date.parse(d.geaendert) > Date.parse(e.zeit)) {
      // Die Datei ist neuer als der Entwurf (jemand hat inzwischen gespeichert): der Entwurf wird nicht mehr angeboten, geht aber nicht verloren — er liegt dann in der Ablage.
      try { ablageFn.legeAb(supportOrdnerV(), wurzel, { pfad: d.pfad, inhalt: e.text, grund: "entwurf-verworfen", quelle: "Entwurf" }); entwurfFn.loescheEntwurf(supportOrdnerV(), wurzel, pfad); }
      catch { /* kann die Ablage nicht schreiben, bleibt der Entwurf liegen */ }
      return { entwurf: null, aelter: true };
    }
    return { entwurf: { text: e.text, zeit: e.zeit, basisHash: e.basisHash, ...(e.meta ? { meta: e.meta } : {}) }, datei: d ? { inhalt: d.inhalt, hash: d.hash, geaendert: d.geaendert } : null };
  }


  // Freien Dateinamen reservieren: name.md, name-2.md, name-3.md … Der Inhalt liegt vorher fertig in einer Temp-Datei und wird mit einem Hartlink an den Namen gesetzt
  // (wie in schreibe): der Name zeigt nie eine halb geschriebene Datei, und ein belegter Name wird nie überschrieben (EEXIST → nächster Name).
  function legeFreiAn(relOrdner, stamm, inhalt) {
    const ordnerAbs = relOrdner ? loese(wurzel, relOrdner).abs : wurzel;
    mkdirSync(ordnerAbs, { recursive: true });
    const tmp = tmpName(join(ordnerAbs, "x"));
    try {
      writeFileSync(tmp, inhalt, { flag: "wx", mode: 0o644 });
      for (let i = 1; i < 1000; i++) {
        const name = `${stamm}${i === 1 ? "" : "-" + i}.md`;
        try { linkSync(tmp, join(ordnerAbs, name)); const neuRel = relOrdner ? `${relOrdner}/${name}` : name; suchindex?.aendere(neuRel); tagIndex.aendere(neuRel); return neuRel; }
        catch (e) { if (e.code !== "EEXIST") throw e; }
      }
    } finally { try { unlinkSync(tmp); } catch { /* schon weg */ } }
    throw new HttpFehler(409, "Es gibt schon zu viele Dateien mit diesem Namen.");
  }

  // inhalt (optional): der fertige Text der Notiz (Studio: „Neue Notiz“ legt die Datei erst an, wenn etwas drinsteht); ohne: „# Titel“. Der Dateiname folgt dem Titel.
  // id (optional): Entwurfs-ID des Studios. Kommt die Antwort nicht an und das Studio versucht es noch einmal, liefert dieselbe ID dieselbe Antwort — nichts wird doppelt angelegt.
  const angelegt = new Map(); // id → Antwort (die letzten 200)
  function neu({ ordner, titel, inhalt, id }) {
    if (typeof titel !== "string" || !titel.trim()) throw new HttpFehler(400, "Bitte einen Titel eingeben.");
    if (ordner !== undefined && ordner !== null && typeof ordner !== "string") throw new HttpFehler(400, "Ungültiger Ordner.");
    if (inhalt !== undefined && inhalt !== null && typeof inhalt !== "string") throw new HttpFehler(400, "Ungültiger Inhalt.");
    if (id !== undefined && id !== null && (typeof id !== "string" || !id || id.length > 100)) throw new HttpFehler(400, "Ungültige Kennung.");
    if (typeof inhalt === "string" && Buffer.byteLength(inhalt) > MAX_DATEI) throw new HttpFehler(413, "Der Text ist zu lang.");
    if (typeof id === "string" && angelegt.has(id)) return angelegt.get(id);
    const o = (ordner || "").replace(/^\/+|\/+$/g, "");
    const t = titel.trim().replace(/\s+/g, " ").slice(0, 200);
    const text = typeof inhalt === "string" ? inhalt : `# ${t}\n`;
    const pfad = legeFreiAn(o ? loese(wurzel, o).rel : "", slug(t, 60), text);
    const antwort = typeof inhalt === "string" ? { pfad, hash: HASH(Buffer.from(text, "utf8")) } : { pfad }; // der Hash nur mit eigenem Inhalt (Studio: Entwurf wird zur Datei)
    if (typeof id === "string") { angelegt.set(id, antwort); if (angelegt.size > 200) angelegt.delete(angelegt.keys().next().value); }
    return antwort;
  }

  // „Anlegen“ aus einem offenen [[Link]]: gibt es das Ziel nach der gemeinsamen Regel (wikilink.mjs) schon, kommt dessen Pfad zurück und nichts wird angelegt;
  // sonst entsteht eine Notiz, deren Titel genau das Ziel ist („# Neue Idee“) — der Link trifft sie danach sofort, auch wenn der Dateiname anders aussieht.
  // Anfragen laufen nacheinander: zwei Klicks kurz hintereinander legen nichts doppelt an. ordner: Vorgabe, wenn das Ziel keinen Ordner nennt (Standard: Ordner der Notiz `von`).
  let wikiKette = Promise.resolve();
  async function wikiAnlegen({ ziel, von, ordner }) {
    if (typeof ziel !== "string" || !ziel.trim() || ziel.length > 300) throw new HttpFehler(400, "Bitte ein Ziel angeben.");
    if (von !== undefined && von !== null && typeof von !== "string") throw new HttpFehler(400, "Ungültige Notiz.");
    if (ordner !== undefined && ordner !== null && typeof ordner !== "string") throw new HttpFehler(400, "Ungültiger Ordner.");
    const vonDir = ordnerVonPfad(von || "");
    const lauf = wikiKette.catch(() => {}).then(async () => {
      const da = await notizIndex.loeseWiki(ziel, vonDir);
      if (da) return { pfad: da, vorhanden: true };
      const n = zielZuNeuerNotiz(ziel, vonDir);
      if (!n) throw new HttpFehler(400, "Dieses Ziel lässt sich nicht anlegen.");
      return { ...neu({ ordner: n.ordner ?? (ordner || vonDir), titel: n.titel }), vorhanden: false };
    });
    wikiKette = lauf;
    return lauf;
  }

  // Der Posteingang des Vaults (Regel und Begründung: basis.mjs#inboxOrdnerVon).
  const inboxOrdner = () => inboxOrdnerVon(wurzel);
  const hinweisFeld = () => { const t = inboxHinweisVon(wurzel); return t ? { inboxHinweis: t } : {}; }; // nur bei einem ungültigen Eintrag in der Konfiguration

  function merken({ text, titel }) {
    if (typeof text !== "string" || !text.trim()) throw new HttpFehler(400, "Bitte einen Text eingeben.");
    if (Buffer.byteLength(text) > 1024 * 1024) throw new HttpFehler(413, "Der Text ist zu lang.");
    if (titel !== undefined && titel !== null && typeof titel !== "string") throw new HttpFehler(400, "Ungültiger Titel.");
    const koerper = text.replace(/\s+$/, "");
    let t = (titel || "").trim().replace(/\s+/g, " ");
    let inhalt;
    if (!t && /^#\s+\S/.test(koerper)) { // Text bringt schon eine Überschrift mit
      t = koerper.split(/\r?\n/)[0].replace(/^#\s+/, "").trim();
      inhalt = koerper + "\n";
    } else {
      if (!t) t = koerper.split(/\r?\n/).find((z) => z.trim()).trim().replace(/\s+/g, " ").slice(0, 80);
      inhalt = `# ${t}\n\n${koerper}\n`;
    }
    const datum = opts.heute || heuteIso(jetzt()); // opts.heute: feste Zeit für Tests (wie bei den anderen Aufrufen)
    return { pfad: legeFreiAn(inboxOrdner(), `${datum}_${slug(t)}`, inhalt) };
  }

  // ---------- Suche ----------
  function alleTexte() {
    const aus = [];
    const geh = (relOrdner) => {
      let liste; try { liste = readdirSync(relOrdner ? join(wurzel, relOrdner) : wurzel, { withFileTypes: true }); } catch { return; }
      for (const d of liste) {
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!istUnterVaultOrdner(join(wurzel, rel))) geh(rel); }
        else if (d.isFile() && BEARBEITBAR.test(d.name) && !generiertName(d.name) && !wikiGeneriert(rel, d.name)) aus.push(rel);
      }
    };
    geh("");
    return aus;
  }
  const norm = (s) => s.normalize("NFC").toLowerCase();


  function suche(q) {
    const woerter = norm(String(q || "")).split(/\s+/).filter(Boolean);
    if (!woerter.length) return { treffer: [] };
    const titelTreffer = [], inhaltTreffer = [];
    for (const rel of alleTexte()) {
      let buf; try { const a = join(wurzel, rel); const st = statSync(a); if (st.size > 1024 * 1024) continue; buf = readFileSync(a); } catch { continue; }
      const text = buf.toString("utf8");
      const titel = titelAus(rel, text);
      const kopf = norm(titel + " " + rel);
      const klein = norm(text);
      if (woerter.every((w) => kopf.includes(w))) { titelTreffer.push({ rel, text, titel, klein, score: 0 }); continue; }
      if (!woerter.every((w) => klein.includes(w))) continue;
      let score = 0; for (const w of woerter) { let i = -1; while ((i = klein.indexOf(w, i + 1)) >= 0) score++; }
      inhaltTreffer.push({ rel, text, titel, klein, score });
    }
    titelTreffer.sort((a, b) => (a.rel < b.rel ? -1 : 1));
    inhaltTreffer.sort((a, b) => b.score - a.score || (a.rel < b.rel ? -1 : 1));
    const treffer = [...titelTreffer, ...inhaltTreffer].slice(0, 30).map((t) => {
      const zeilen = t.text.split(/\r?\n/);
      let z = zeilen.findIndex((l) => { const k = norm(l); return woerter.some((w) => k.includes(w)); });
      if (z < 0) z = Math.max(0, zeilen.findIndex((l, i) => i >= leseKopf(t.text).bis && l.trim() && !l.startsWith("#")));
      const zeile = zeilen[z] ?? "";
      const k = norm(zeile), pos = woerter.map((w) => k.indexOf(w)).filter((i) => i >= 0), start = Math.max(0, (pos.length ? Math.min(...pos) : 0) - 40);
      const auszug = (start > 0 ? "… " : "") + zeile.trim().slice(start, start + 160).trim();
      return { pfad: t.rel, titel: t.titel, auszug, zeile: z + 1 };
    });
    return { treffer };
  }

  // Volltextsuche der Oberfläche über den Index im Speicher (suchindex.mjs): gewichtet, tolerant, mit Filtern, Markierungen und Seiten.
  // Der Index baut sich beim ersten Aufruf in Scheiben auf (blockiert nie) und bleibt über aendere()/Abgleich aktuell. Rein lesend.
  let suchindex = null;
  const holeSuchindex = () => suchindex || (suchindex = erzeugeSuchindex({ wurzel, unterVault: istUnterVaultOrdner }));
  function sucheIndex(opt = {}) { return holeSuchindex().sucheWarte(opt, opt.frist); }
  const suchindexAendere = (pfade) => { if (suchindex) suchindex.aendere(pfade); tagIndex.aendere(pfade); }; // dasselbe Änderungssignal hält auch den Tag-Index aktuell
  const suchindexPruefeNeu = () => { if (suchindex) suchindex.pruefeNeu(); tagIndex.markiereVoll(); };
  const sucheVorwaermen = () => holeSuchindex().starte();
  const suchindexBeende = () => { if (suchindex) suchindex.beende(); if (erwaehnungsDienst) erwaehnungsDienst.beende(); verwaltetKonfig = null; };

  // Ungelinkte Erwähnungen (erwaehnungen-index.mjs): läuft auf dem Suchindex. Quelle (hier darf Kortex einen Link einfügen) und Ziel (darauf darf verlinkt werden) schließen
  // verwaltete Orte aus: Archiv, Vorlagen, maschinelle Ordner im Posteingang, Systemdateien; Ziele zusätzlich den Posteingang und Dateien mit „_“ am Anfang.
  let verwaltetKonfig = null, erwaehnungsDienst = null;
  const verwaltet = (rel) => {
    verwaltetKonfig ??= { inbox: falte(inboxOrdnerVon(wurzel)), vorlagen: falte(vorlagenOrdnerVon(wurzel)) };
    const t = rel.split("/"), erste = falte(t[0]);
    return /^90_/.test(erste) || erste === verwaltetKonfig.vorlagen || (erste === verwaltetKonfig.inbox && t.length > 2 && t[1].startsWith("_")) || /(^|\/)((claude|agents|gemini)\.md|\.cursorrules|copilot-instructions\.md)$/i.test(rel);
  };
  const darfQuelle = (rel) => !verwaltet(rel);
  const darfZiel = (rel) => !verwaltet(rel) && falte(rel.split("/")[0]) !== (verwaltetKonfig?.inbox ?? falte(inboxOrdnerVon(wurzel))) && !rel.split("/").pop().startsWith("_");
  const holeErwaehnungen = () => erwaehnungsDienst || (erwaehnungsDienst = erzeugeErwaehnungen({ wurzel, index: holeSuchindex, darfZiel, darfQuelle }));
  const erwPfad = (p) => { if (typeof p !== "string" || !p) throw new HttpFehler(400, "Der Pfad fehlt."); const l = loese(wurzel, p); if (!BEARBEITBAR.test(l.rel)) throw new HttpFehler(415, "Das ist keine Notiz."); return l.rel; };
  const erwaehnungen = (p, opt) => holeErwaehnungen().erwaehnungen(erwPfad(p), opt);
  async function erwaehntVon(p, text) {
    if (typeof text !== "string") throw new HttpFehler(400, "Der Text fehlt.");
    if (text.length > 1024 * 1024) throw new HttpFehler(413, "Der Text ist zu groß.");
    return holeErwaehnungen().erwaehntVon(erwPfad(p), text);
  }
  // a: { pfad, text, stellen: [{ ziel, start, treffer, vor, nach }] | alle: true } — Links für den offenen (auch ungespeicherten) Text; geschrieben wird nichts
  async function erwaehnungenLinks(a) {
    if (!a || typeof a !== "object" || typeof a.text !== "string") throw new HttpFehler(400, "Der Text fehlt.");
    if (a.text.length > 1024 * 1024) throw new HttpFehler(413, "Der Text ist zu groß.");
    const pfad = erwPfad(a.pfad);
    let stellen = "alle";
    if (a.alle !== true) {
      if (!Array.isArray(a.stellen) || !a.stellen.length || a.stellen.length > 500) throw new HttpFehler(400, "Bitte die Stellen angeben (höchstens 500).");
      stellen = a.stellen.map((s) => {
        if (!s || !Number.isInteger(s.start) || s.start < 0 || typeof s.treffer !== "string" || s.treffer.length > 200) throw new HttpFehler(400, "Eine Stelle ist unvollständig.");
        return { ziel: erwPfad(s.ziel), start: s.start, treffer: s.treffer, vor: typeof s.vor === "string" ? s.vor.slice(0, 40) : "", nach: typeof s.nach === "string" ? s.nach.slice(0, 40) : "" };
      });
    }
    return holeErwaehnungen().linksFuerText(pfad, a.text, stellen);
  }
  // a: { ziel, stellen: [{ pfad, start, treffer, vor, nach }] | alle: true, vorschau?, token? }
  async function verlinke(a) {
    if (!a || typeof a !== "object") throw new HttpFehler(400, "Die Anfrage ist leer.");
    const ziel = erwPfad(a.ziel);
    let auswahl;
    if (a.alle === true) auswahl = "alle";
    else {
      if (!Array.isArray(a.stellen) || !a.stellen.length || a.stellen.length > 500) throw new HttpFehler(400, "Bitte die Stellen angeben (höchstens 500).");
      auswahl = a.stellen.map((s) => {
        if (!s || typeof s.pfad !== "string" || !Number.isInteger(s.start) || s.start < 0 || typeof s.treffer !== "string" || s.treffer.length > 200) throw new HttpFehler(400, "Eine Stelle ist unvollständig.");
        return { pfad: erwPfad(s.pfad), start: s.start, treffer: s.treffer, vor: typeof s.vor === "string" ? s.vor.slice(0, 40) : "", nach: typeof s.nach === "string" ? s.nach.slice(0, 40) : "", ...(typeof s.hash === "string" && /^[0-9a-f]{64}$/.test(s.hash) ? { hash: s.hash } : {}) };
      });
    }
    if (await selbst.abgleichBeschaeftigt()) throw new HttpFehler(409, "Gerade läuft ein Abgleich oder eine Zusammenführung. Kortex verlinkt nichts, bis sie abgeschlossen ist.", { art: "beschaeftigt" });
    const r = await dateiAktionen.verlinke({ vorschau: a.vorschau === true, ...(typeof a.token === "string" ? { token: a.token } : {}) }, (lies) => holeErwaehnungen().planeVerlinken(ziel, auswahl, lies));
    if (r.geaendert && r.geaendert.length && suchindex) suchindex.aendere(r.geaendert);
    return r;
  }

  function pruefung(rel) {
    const d = lies(rel);
    return pruefeText(d.pfad, d.inhalt, { heute: opts.heute || heuteIso(jetzt()) });
  }

  // ---------- Kern und Workspace-Trust (Kern-Umzug P4/P5) ----------
  // Der gebündelte Kern läuft aus dem App-Paket (per Manifest geprüft, der Vault liefert nur Daten). Ob an einem Vault etwas bewirkt werden darf
  // (git, Hintergrunddienst, Hooks, KI-Pflege), entscheidet das Vertrauen: angelegt/geklont von Kortex oder vom Nutzer im Studio bestätigt. Der
  // Merker liegt außerhalb des Vaults (<support>/vertrauen.json, siehe vertrauen.mjs); er wirkt auch für den MCP-Server und den Kern.
  const stuetze = () => ({ support: opts.support });
  const stand = () => vertrauenFn.pruefeVertrauen(wurzel, stuetze());
  const rueckfragenPfad = join(kern, "rueckfragen.mjs");
  // „Kit vorhanden“ heißt jetzt: der Vault ist ein Brain im Sinne des Kerns (brain.config.json) UND der Kern ist da.
  const istBrain = () => existsSync(join(wurzel, "brain.config.json"));
  const kitVorhanden = () => istBrain() && (existsSync(kitPfad) || existsSync(rueckfragenPfad));
  const kit = () => ({ vorhanden: kitVorhanden() });
  function vertrauen(erlauben) {
    if (typeof erlauben !== "boolean") throw new HttpFehler(400, "„erlauben“ muss true oder false sein.");
    if (erlauben) vertrauenFn.erlaube(wurzel, { support: opts.support, quelle: "bestaetigt" }); else vertrauenFn.widerrufe(wurzel, { support: opts.support });
    gesCache = null; rfCache = null;
    return { kit: kit(), vertrauen: stand() };
  }
  // Version des gebündelten Kerns (= App-Version), nicht die eines Ordners im Vault.
  const kitVersion = () => { if (!istBrain()) return null; try { return readFileSync(join(kern, "VERSION"), "utf8").trim() || null; } catch { return null; } };
  let gesCache = null;
  function gesundheit() {
    if (!istBrain() || !existsSync(kitPfad)) return Promise.resolve({ verfuegbar: false });
    if (gesCache && Date.now() - gesCache.t < 120_000) return Promise.resolve(gesCache.wert);
    return new Promise((ok) => {
      // --vault UND BRAIN_VAULT = dieser Vault: eine vom Start geerbte Variable (anderer Vault nach einem Wechsel in der Oberfläche) ließe
      // den Kern sonst auf dem Startvault arbeiten.
      execFile(process.execPath, [kitPfad, "--vault", wurzel, "gesundheit", "--json"], { cwd: wurzel, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: kindUmgebung({ NO_COLOR: "1", BRAIN_VAULT: wurzel }) },
        (err, stdout) => {
          let wert = { verfuegbar: false };
          try { const j = JSON.parse(String(stdout)); if (j && typeof j === "object") wert = j; } catch { /* Kit fehlt/defekt/Zeitlimit */ }
          if (wert.verfuegbar !== false) gesCache = { t: Date.now(), wert };
          ok(wert);
        });
    });
  }

  // Offene Rückfragen: rein lesend über die Kit-Funktion sichtbare() (nicht über `brain rueckfragen liste` — das
  // schreibt `gezeigt` in die Rückfragen und würde die Verfallsfrist auslösen). Zahl = so viele, wie der Skill zeigt.
  // Läuft als eigener Kindprozess (nie im eigenen Prozess importiert): Fehler des Kerns bleiben draußen.
  const RF_SKRIPT = `import(process.argv[1]).then((m) => { const s = typeof m.sichtbare === "function" ? m.sichtbare(process.argv[2]) : null;
    process.stdout.write(JSON.stringify(s && Array.isArray(s.fragen) && Number.isFinite(s.wartend) ? { f: s.fragen.length, w: s.wartend } : null)); }).catch(() => process.stdout.write("null"));`;
  let rfCache = null;
  async function rueckfragen() {
    if (!istBrain() || !existsSync(rueckfragenPfad)) return { verfuegbar: false };
    if (rfCache && Date.now() - rfCache.t < 120_000) return rfCache.wert;
    const wert = await new Promise((ok) => {
      execFile(process.execPath, ["--input-type=module", "-e", RF_SKRIPT, pathToFileURL(rueckfragenPfad).href, wurzel],
        { cwd: wurzel, timeout: 20_000, maxBuffer: 1024 * 1024, env: kindUmgebung({ BRAIN_VAULT: wurzel }) }, (err, stdout) => {
          try { const j = JSON.parse(String(stdout)); if (j && Number.isFinite(j.f) && Number.isFinite(j.w)) return ok({ verfuegbar: true, offen: j.f + j.w }); } catch { /* keine Zahl statt einer falschen */ }
          ok({ verfuegbar: false });
        });
    });
    if (wert.verfuegbar) rfCache = { t: Date.now(), wert };
    return wert;
  }

  // ---------- Git unter Workspace-Trust (P5) ----------
  // Jeder Git-Aufruf läuft gehärtet (git.mjs). Ist dem Vault nicht vertraut, ist Git GANZ gesperrt: status meldet es, alle anderen Git-Routen
  // antworten 409 { gitGesperrt: true }, der Notiz-Index fragt Git gar nicht. Mit Vertrauen laufen Hooks und Repo-Konfiguration wie gewohnt.
  const gitSicht = () => vertrauenFn.gitSicht(wurzel, { ...stuetze(), kern });
  // Phase B der Umstellung (oder ihr Rückweg) läuft: Speichern, Abgleichen und Wiederherstellen warten (409), bis sie fertig ist (gemeinsam/umstellung-sperre.mjs)
  const umstellungSperre = () => { if (umstellungLaeuft(wurzel)) throw new HttpFehler(409, "Kortex räumt gerade deinen Vault auf (alter Werkzeug-Ordner). Warte einen Moment, dann geht das Speichern und Abgleichen wieder.", { umstellungLaeuft: true }); };
  const gesperrtFehler = (s) => new HttpFehler(409, `Git ist für diesen Vault gesperrt. ${s.grund}`, { gitGesperrt: true, grund: s.grund });
  // Kontext eines Git-Aufrufs: vertraut/sshEigen und, was der Nutzer selbst eingestellt hat (sshGlobal, gpgGlobal) — ohne Vertrauen ersetzen wir
  // nur die Einstellungen des Vaults, nie seine eigenen.
  const ctxVon = (s) => ({ vertraut: s.vertraut, hooks: s.hooks, sshEigen: s.sshEigen, sshGlobal: s.sshGlobal, gpgGlobal: s.gpgGlobal });
  const mitSicherungsStand = (s) => {
    if (!s || !s.repo) return s;
    const d = leseAbgleichDetail(wurzel, opts.support);
    // sicherungHaelt: ein gemerkter Stand blockiert die Online-Sicherung (seit wann, wie viele Tage) — die Oberfläche sagt es in Statusleiste und Banner
    const tage = d && d.haelt && d.haeltSeit ? Math.max(0, Math.floor((Date.now() - Date.parse(d.haeltSeit)) / 86_400_000)) : 0;
    return { ...s, sicherungStand: d ? d.stand : null, sicherungDateien: d && d.stand === "konflikt" ? d.dateien : [], sicherungHaelt: d && d.haelt ? { seit: d.haeltSeit || null, tage } : null };
  };
  const gitCtx = (extra = {}) => { const s = gitSicht(); if (s.gesperrt) throw gesperrtFehler(s); return { ...ctxVon(s), ...extra }; };

  // ---------- Abgleich und Konflikte: gemeinsame Sperre, Kern-Befehl `brain abgleich` ----------
  // Dieselbe Sperrdatei wie die Hintergrund-Sicherung des Kerns (kern/abgleich-sperre.mjs, <Support>/backup/<Kennung>.sperre): nie zwei Abgleiche zugleich.
  // Fehlt der Kern (oder die Datei), gibt es keine Sperre — der Abgleich im Studio läuft dann wie bisher.
  async function abgleichSperre(art) {
    let m; try { m = await import(pathToFileURL(join(kern, "abgleich-sperre.mjs")).href); } catch { return { ok: true, freigeben() {} }; }
    return m.nimmSperre(join(opts.support || supportOrdner(), "backup", `${vaultKennung(wurzel)}.sperre`), { art });
  }
  // Etwas unter der gemeinsamen Sperre ausführen (automatische Fassung): ist sie gehalten, 409 art „laeuft“. Die Sperre wird immer freigegeben.
  async function mitAbgleichSperre(art, fn) {
    const sp = await abgleichSperre(art);
    if (!sp.ok) throw new HttpFehler(409, BESETZT_TEXT, { art: "laeuft" });
    try { return await fn(); } finally { sp.freigeben(); }
  }
  const BESETZT_TEXT = "Gerade läuft ein anderer Abgleich (zum Beispiel die Online-Sicherung im Hintergrund). Bitte kurz warten und noch einmal versuchen.";
  // Ein Befehl des Kerns als Kindprozess (nie im eigenen Prozess: ein Abgleich kann Minuten dauern). → die JSON-Antwort; { ok: false, fehler, status } wird zu HttpFehler.
  function kernAbgleich(unter, eingabe, frist = 120_000) {
    const s = gitSicht(); if (s.gesperrt) return Promise.reject(gesperrtFehler(s));
    if (!existsSync(kitPfad)) return Promise.reject(new HttpFehler(503, "Der Abgleich ist gerade nicht verfügbar (der Kern fehlt)."));
    return new Promise((ok, nein) => {
      const k = execFile(process.execPath, [kitPfad, "--vault", wurzel, "abgleich", unter, ...(eingabe ? ["--stdin"] : [])],
        { cwd: wurzel, timeout: frist, maxBuffer: 64 * 1024 * 1024, env: kindUmgebung({ BRAIN_VAULT: wurzel, BRAIN_APP_SUPPORT: opts.support || supportOrdner() }) }, (err, stdout) => {
          let j = null; try { j = JSON.parse(String(stdout).trim().split("\n").pop()); } catch { /* keine Antwort */ }
          if (!j) return nein(new HttpFehler(err && err.killed ? 504 : 500, err && err.killed ? "Der Abgleich hat zu lange gebraucht und wurde abgebrochen." : "Der Abgleich ist fehlgeschlagen."));
          if (j.ok === false) { const { ok: _o, fehler, status, ...extra } = j; return nein(new HttpFehler(Number.isInteger(status) ? status : 500, fehler || "Der Abgleich ist fehlgeschlagen.", extra)); }
          ok(j);
        });
      k.stdin.on("error", () => {});
      k.stdin.end(eingabe ? JSON.stringify(eingabe) : "");
    });
  }

  async function gitSyncLaufen(a) {
    umstellungSperre();
    // Wartet ein gemerkter Stand auf neue Entscheidungen (nach „Rückgängig“), sendet auch der Studio-Abgleich nichts: die Oberfläche öffnet die Ansicht
    const detail = leseAbgleichDetail(wurzel, opts.support);
    if (detail && detail.haelt) throw new HttpFehler(409, "Es warten noch Entscheidungen zu einem Konflikt. Bitte schließe sie zuerst ab.", { konflikt: true, dateien: detail.dateien, haelt: true });
    // Markiert wird nur, wenn dieser Abgleich die Zusammenführung SELBST begonnen hat: vorher war keine offen (MERGE_HEAD fehlte), und die 409 trägt `gestartet`
    // Geprüft wird INNERHALB der Sperren (in der Sperr-Funktion, nach der gemeinsamen Dateisperre): der Aufruf von gitFn.sync bleibt der erste Schritt („wer zuerst aufruft, gewinnt“), und niemand
    // kann dazwischen eine Zusammenführung beginnen. Den Pfad von MERGE_HEAD nennt Git selbst (auch bei einer .git-Datei), nie .git/ angenommen.
    let vorherAbwesend = false;
    let r;
    try {
      r = await gitFn.sync(wurzel, gitCtx({ limitSync: opts.gitLimitSync, limitGesamt: opts.gitLimitAbgleich, konflikteLoesen: !!(a && a.konflikteLoesen === true),
        sperre: async () => {
          const sp = await abgleichSperre("studio-abgleich"); if (!sp.ok) throw new HttpFehler(409, BESETZT_TEXT, { art: "laeuft" });
          try { const mh = await gitFn.mergeKopfPfad(wurzel, gitCtx()); vorherAbwesend = !!mh && !existsSync(mh); } catch { /* unklar: nicht markieren */ }
          return sp;
        } }));
    } catch (e) {
      // Die Zusammenführung blieb offen: Kortex merkt sich, dass SIE sie begonnen hat (nur dann lösen oder brechen wir sie später ab)
      if (vorherAbwesend && e instanceof HttpFehler && e.status === 409 && e.extra && e.extra.konflikt && e.extra.gestartet === true) { try { await gitFn.gitExklusiv(wurzel, () => kernAbgleich("markieren", { vorherAbwesend: true, ...(typeof e.extra.ziel === "string" ? { ziel: e.extra.ziel } : {}) })); } catch { /* ohne Marke bleibt sie „fremd“: nur ansehen */ } }
      throw e;
    }
    loescheAbgleichStand(wurzel, { support: opts.support }); // der Abgleich lief durch: der Vermerk der Hintergrund-Sicherung (Konflikt, Anmeldung, Neues) gilt nicht mehr
    return r;
  }
  // Kern-Befehle, die Index und Arbeitsbaum anfassen, laufen unter derselben Sperre im Prozess wie Commit, Abgleich und Nachsehen
  const kernGesperrt = (unter, eingabe, frist) => { umstellungSperre(); return gitFn.gitExklusiv(wurzel, () => kernAbgleich(unter, eingabe, frist)); };

  // ---------- Notiz-Index (Spec v2 §5) ----------
  const notizIndex = erzeugeNotizIndex({ wurzel, jetzt, heute: () => opts.heute || heuteIso(jetzt()),
    gitKontext: () => { const s = gitSicht(); return s.gesperrt ? null : ctxVon(s); },
    aufgabenOrdner: () => aufgabenFn.ordnerName() });

  // Lokale Nutzungsmessung (FBL-72): welche Seiten die KI per MCP abruft (.logs/mcp.log). Als „nie genutzt“ kommen nur echte Wiki-Seiten
  // in Frage (09_wiki/, Markdown, nicht generiert, kein Unterstrich-Name). Rein lesend, ohne Kit-Code.
  function nutzung() {
    const wiki = baum().eintraege.filter((e) => e.art === "datei" && e.pfad.startsWith("09_wiki/") && e.pfad.endsWith(".md") && !e.schreibschutz && !e.pfad.split("/").pop().startsWith("_")).map((e) => e.pfad);
    return wertAus(wurzel, wiki);
  }

  // ---------- Posteingang sichten (FBL-68/71): Verwerfen, Später, in eine Wiki-Seite übernehmen — je Aktion ein Commit ----------
  const posteingang = erzeugePosteingang({
    wurzel, heute: () => opts.heute || heuteIso(jetzt()), notizen: () => notizIndex.notizen(), lies, schreibe, istGeneriert, slug,
    git: {
      // Gesperrtes Git (Vertrauen v2) → 409, bevor irgendetwas angefasst wird; sonst: gibt es ein Repository?
      vorab: async () => { const s = gitSicht(); if (s.gesperrt) throw gesperrtFehler(s); return gitFn.istRepo(wurzel, ctxVon(s)); },
      offen: async () => (await gitFn.status(wurzel, gitCtx())).geaendert.map((e) => e.pfad),
      commit: async (a) => { umstellungSperre(); return gitFn.commit(wurzel, a, gitCtx({ limit: opts.gitLimitCommit })); },
    },
  });

  // ---------- Aufgaben (kern/aufgaben.mjs): je Aufgabe eine Markdown-Datei; geschrieben wird nur in einen vertrauten Vault ----------
  const aufgabenFn = erzeugeAufgaben({ wurzel, kern, vertraut: () => { try { return stand().erlaubt === true; } catch { return false; } }, jetzt });

  // ---------- Umbenennen, Verschieben, Papierkorb (gemeinsam/dateiaktionen.mjs): mit Link-Pflege, Journal und Rückgängig ----------
  const dateiAktionen = erzeugeDateiaktionen({ wurzel, support: opts.support || supportOrdner(), name: basename(wurzel), istGeneriert, ueberspringeOrdner: istUnterVaultOrdner, aufgabenOrdner: () => aufgabenFn.ordnerName(), vorlagenOrdner: () => vorlagenOrdnerVon(wurzel), slug, jetzt, haken: opts.dateiHaken || {} });
  gitFn.setzeFremdeSperre(wurzel, () => dateiAktionen.sperreAktiv());
  // Läuft gerade ein Abgleich oder eine Umstellung, ändert Kortex nichts am Arbeitsbaum (wie beim Rückgängig der Ablagen)
  const mitRuhe = (fn) => async (a) => {
    umstellungSperre();
    // Ein Abgleich dauert meist Sekunden (und läuft nach dem Öffnen oder beim Zurückkehren ins Fenster von selbst): bis zu 8 s warten statt sofort abzulehnen
    for (let i = 0; i < 80 && gitFn.gitBeschaeftigt(wurzel); i++) await new Promise((ok) => setTimeout(ok, 100));
    if (gitFn.gitBeschaeftigt(wurzel)) throw new HttpFehler(409, "Kortex gleicht gerade ab. Versuche es in einem Moment noch einmal — es wurde nichts verändert.", { art: "beschaeftigt" });
    return fn(a);
  };

  // Tags (gemeinsam/tags.mjs): Zähler für Seitenleiste, Vervollständigung und MCP; liest nur geänderte Notizen neu
  const tagIndex = erzeugeTagIndex({ wurzel, gesperrt: gesperrterName, generiert: istGeneriert, ueberspringeOrdner: istUnterVaultOrdner });
  // Export (gemeinsam/export.mjs): Markdown, HTML und Druck-HTML aus Notizen des Vaults; liest nur, schreibt nie in den Vault
  const exportFn = erzeugeExport({ wurzel, lies, istGeneriert, ueberspringeOrdner: istUnterVaultOrdner, tagIndex });

  // Dieselbe Suche für MCP brain_suchen und die Probe-Frage: strukturiert (treffer) und als Text, wie ihn die KI sieht.
  // Rangfolge wie die CLI-Suche (`brain search`, Profil minimal): BM25 aus dem gebündelten Kern (minisuche.mjs), ODER über die Wörter der
  // Frage statt „jedes Wort muss vorkommen“. Fehlt der Kern (oder wirft er), gilt die UND-Suche der Oberfläche (suche()).
  let miniSuche; // Funktion | null (nicht verfügbar) | undefined (noch nicht versucht)
  async function ladeMiniSuche() {
    if (miniSuche !== undefined) return miniSuche;
    try { miniSuche = (await import(pathToFileURL(join(kern, "minisuche.mjs")).href)).minisuche || null; } catch { miniSuche = null; }
    return miniSuche;
  }
  async function kandidaten(frage, n) {
    const mini = await ladeMiniSuche();
    if (mini) {
      try {
        const liste = [];
        for (const t of mini(wurzel, frage, n + 10)) {
          if (liste.length >= n) break;
          if (t.pfad.split("/").some(gesperrterName)) continue;
          let d; try { d = lies(t.pfad); } catch { continue; } // außerhalb des Vaults, unlesbar, kein Text → nie nennen
          if (istGeneriert(d.pfad, null)) continue;
          liste.push({ pfad: d.pfad, titel: titelAus(d.pfad, d.inhalt), inhalt: d.inhalt });
        }
        return liste;
      } catch { /* Kern defekt → einfache Suche */ }
    }
    return suche(frage).treffer.slice(0, n).map((t) => { try { const d = lies(t.pfad); return { pfad: d.pfad, titel: t.titel, inhalt: d.inhalt }; } catch { return null; } }).filter(Boolean);
  }
  async function suchenFuerKi(frage, anzahl) {
    const n = Math.min(SUCHE_MAX, Math.max(1, Number.parseInt(anzahl, 10) || SUCHE_STANDARD));
    const woerter = sucheWoerter(frage);
    const treffer = (await kandidaten(frage, n)).map((k) => {
      let stufe = "grau"; try { stufe = pruefung(k.pfad).stufe; } catch { /* unlesbar → grau */ }
      const { auszug, zeile } = suchAuszug(k.inhalt, woerter);
      return { pfad: k.pfad, titel: k.titel, auszug, zeile, stufe };
    });
    const text = sucheText(treffer.map((t) => ({ ...t, stufeText: STUFE_TEXT[t.stufe] })), { mehr: treffer.length >= n && n < SUCHE_MAX });
    return { treffer, text };
  }

  // „Was ist neu“ (neuigkeiten.mjs): nur lokale Daten. seit: ISO | leer → der Merker „gelesen bis“, sonst die letzten Tage. Eine Quelle, die gerade nicht lesbar ist, fehlt in der Antwort (null), statt zu raten.
  async function neuigkeiten(o = {}) {
    const marke = leseMarke(supportOrdnerV(), kennungVault(wurzel));
    let seit = null, seitArt = "standard";
    if (typeof o.seit === "string" && o.seit) { if (!Number.isFinite(Date.parse(o.seit))) throw new HttpFehler(400, "„seit“ ist eine Zeitangabe (ISO)."); seit = o.seit; seitArt = "gewaehlt"; }
    else if (marke) { seit = marke; seitArt = "besuch"; }
    const frueh = seit ? new Date(Date.parse(seit)).toISOString() : new Date(jetzt().getTime() - STANDARD_TAGE * 86400e3).toISOString();
    const mitFrist = (p, ms = 2000) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), ms))]).catch(() => null);
    const [zeilen, aufgaben, git] = await Promise.all([
      mitFrist(notizIndex.notizen().then((r) => r.notizen)),
      mitFrist(aufgabenFn.aufgaben().then((r) => r.aufgaben)),
      mitFrist(selbst.gitStatus()),
    ]);
    let ereignisse = null; try { ereignisse = leseEreignisse(supportOrdnerV(), kennungVault(wurzel), { seit: new Date(Date.parse(frueh) - 1).toISOString() }); } catch { ereignisse = null; }
    const heute = opts.heute || heuteIso(jetzt());
    // fuerKi (nur intern, nie über die Route): Notizen mit `ki: nein` erscheinen nirgends, nur als Zahl `ausgenommen`; ist der Index nicht lesbar, gibt es auch keine Aufgaben (fail-closed)
    let ausnehmen = null;
    if (o.fuerKi === true) {
      const nein = (zeilen || []).filter(zeileIstKiNein);
      ausnehmen = new Set(nein.map((z) => z.pfad));
      // Aufgaben, die sich auf eine solche Notiz beziehen (Dateiname, Pfad oder Titel), verraten sie mit ihrem Titel: auch sie bleiben draußen
      const name = (t) => String(t ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0].replace(/\.(md|txt)$/i, "").normalize("NFC").trim().toLowerCase();
      const namen = new Set(nein.flatMap((z) => [name(z.pfad), name(String(z.pfad).split("/").pop()), name(z.titel)]).filter(Boolean));
      for (const a of Array.isArray(aufgaben) ? aufgaben : []) if (Array.isArray(a.bezug) && a.bezug.some((b) => namen.has(name(typeof b === "string" ? b : b && (b.pfad || b.ziel || b.titel))) || namen.has(name(String(typeof b === "string" ? b : b && (b.pfad || b.ziel || "")).split("/").pop())))) ausnehmen.add(a.pfad);
    }
    const aufgabenQuelle = o.fuerKi === true && !zeilen ? null : aufgaben;
    return { ...baueNeuigkeiten({ seit: frueh, jetzt: jetzt(), heute, notizen: zeilen, aufgaben: aufgabenQuelle, ereignisse, git, ausnehmen }), marke, seitArt };
  }
  function neuigkeitenGelesen(bis) {
    const t = bis === undefined || bis === null ? jetzt().toISOString() : bis;
    if (typeof t !== "string" || !Number.isFinite(Date.parse(t))) throw new HttpFehler(400, "„bis“ ist eine Zeitangabe (ISO).");
    return { ok: true, gelesenBis: setzeMarke(supportOrdnerV(), kennungVault(wurzel), t) };
  }

  // Rückgängig und Wiederholen fassen Dateien an: nicht während eines offenen Abgleichs (MERGE_HEAD, gemerkter Konfliktstand, Sperre)
  const nichtImAbgleich = async (fn) => {
    if (await selbst.abgleichBeschaeftigt()) throw new HttpFehler(409, "Gerade läuft ein Abgleich oder eine Zusammenführung. Versuche es danach noch einmal — es wurde nichts verändert.", { art: "beschaeftigt" });
    return fn();
  };
  let selbst = null;
  return selbst = {
    wurzel, name: basename(wurzel), heute: () => opts.heute || heuteIso(jetzt()), rueckfragen, kitVersion, kitVorhanden, kit, vertrauen, vertrauenStand: stand, baum, lies, imUnterVault: (rel) => { try { return imUnterVault(loese(wurzel, rel).abs); } catch { return false; } }, schreibe, zusammenfuehren, ablageListe, ablageLese, ablageLegeAb, entwurfPruefen,
    entwurfSchreiben: (a) => entwurfFn.schreibeEntwurf(supportOrdnerV(), wurzel, a || {}), entwurfLoeschen: (pfad) => ({ ok: entwurfFn.loescheEntwurf(supportOrdnerV(), wurzel, pfad) }), entwurfVerschieben: (a) => entwurfFn.verschiebeEntwuerfe(supportOrdnerV(), wurzel, a?.von, a?.nach), entwuerfe: () => ({ entwuerfe: entwurfFn.listeEntwuerfe(supportOrdnerV(), wurzel) }),
    neu, wikiAnlegen, wikiLoese: (ziel, von) => notizIndex.loeseWiki(ziel, ordnerVonPfad(von || "")), merken, suche, sucheIndex, sucheVorwaermen, suchindexBeende, suchindexAendere, suchindexPruefeNeu, suchindexStand: () => (suchindex ? suchindex.stand() : null), suchindexRuhe: () => (suchindex ? suchindex.ruhe() : Promise.resolve()), suchenFuerKi, pruefung, gesundheit, nutzung,
    tags: (o) => tagIndex.liste(o), tagNotizen: (tag) => tagIndex.notizen(tag),
    // Tag umbenennen: nie mitten in einem Abgleich oder einer offenen Zusammenführung (auch die Vorschau nicht) — dann ändert Kortex nichts am Arbeitsbaum
    tagUmbenennen: mitRuhe(async (a) => {
      if (await selbst.abgleichBeschaeftigt()) throw new HttpFehler(409, "Kortex gleicht gerade ab oder eine Zusammenführung ist offen. Versuche es danach noch einmal — es wurde nichts verändert.", { art: "beschaeftigt" });
      const r = await dateiAktionen.tagUmbenennen(a);
      if (Array.isArray(r.geaendert) && r.geaendert.length) tagIndex.aendere(r.geaendert);
      return r;
    }), exportiere: exportFn.exportiere,
    erwaehnungen, erwaehntVon, erwaehnungenLinks, verlinke: mitRuhe(verlinke), neuigkeiten, neuigkeitenGelesen, umbenennen: mitRuhe(dateiAktionen.umbenennen), verschieben: mitRuhe(dateiAktionen.verschieben), loeschen: mitRuhe(dateiAktionen.loeschen),
    papierkorb: dateiAktionen.papierkorbListe, papierkorbWiederherstellen: mitRuhe(dateiAktionen.papierkorbWiederherstellen), papierkorbEndgueltig: dateiAktionen.papierkorbEndgueltig, papierkorbHinweisErledigt: dateiAktionen.papierkorbHinweisErledigt, aktionenOrt: dateiAktionen.aktionenOrt,
    vorgangZurueck: mitRuhe((a) => nichtImAbgleich(() => dateiAktionen.vorgangZurueck(a.id, a))), vorgangWieder: mitRuhe((a) => nichtImAbgleich(() => dateiAktionen.vorgangWieder(a.id, a))), vorgangMoeglich: dateiAktionen.vorgangMoeglich,
    posteingangVerwerfen: posteingang.verwerfen, posteingangSpaeter: posteingang.spaeter, posteingangUebernehmen: posteingang.uebernehmen,
    aufgaben: aufgabenFn.aufgaben, aufgabeAnlegen: aufgabenFn.anlegen, aufgabeAendern: aufgabenFn.aendern, aufgabenArchivieren: aufgabenFn.archivieren, aufgabenFuerKi: aufgabenFn.fuerKi, aufgabenOrdnerName: aufgabenFn.ordnerName, aufgabePfad: aufgabenFn.findePfad,
    notizen: async () => ({ ...(await notizIndex.notizen()), aufgabenOrdner: await aufgabenFn.ordnerName(), inboxOrdner: inboxOrdnerVon(wurzel), vorlagenOrdner: vorlagenOrdnerVon(wurzel), ...hinweisFeld() }), notizKontext: notizIndex.kontext, typen: notizIndex.typen, ansichten: notizIndex.ansichten,
    indexAlles: async () => ({ ...(await notizIndex.alles()), aufgabenOrdner: await aufgabenFn.ordnerName(), inboxOrdner: inboxOrdnerVon(wurzel), vorlagenOrdner: vorlagenOrdnerVon(wurzel), ...hinweisFeld() }), teilIndex,
    gitLog: async (a) => gitFn.log(wurzel, a || {}, gitCtx()),
    gitRemote: async (url, extra = {}) => gitFn.remoteHinzufuegen(wurzel, url, gitCtx({ limit: opts.gitLimitRemote, ...extra })),
    // sicherungStand: "konflikt" | "anmeldung" | "neues" | null — die Hintergrund-Sicherung des Kerns (kern/backup.mjs) vermerkt, wenn sie nicht senden konnte
    gitStatus: async () => {
      const s = gitSicht();
      if (s.gesperrt) return { repo: true, gesperrt: true, grund: s.grund };
      return mitSicherungsStand(await gitFn.status(wurzel, ctxVon(s)));
    },
    // extra.ohneHooks: der Commit läuft auch in einem vertrauten Vault ohne Hooks (Rückgängig für KI-Ablagen, P8a)
    // Aktivitätsprotokoll (P8a, Rückgängig): Ordnername des Posteingangs; Git beschäftigt?; ist die Datei versioniert UND unverändert gegenüber HEAD (ls-files + diff, ohne Hooks)?
    mitAbgleichSperre, warteBisStabil, inboxOrdnerName: inboxOrdner, umstellungLaeuft: () => umstellungLaeuft(wurzel),
    // Läuft oder wartet gerade ein Abgleich? (Git beschäftigt · die gemeinsame Sperre aller Abgleiche · ein gemerkter Konfliktstand „konfliktBasis“) — dann ändert Kortex nichts am Arbeitsbaum.
    abgleichBeschaeftigt: async () => {
      if (gitFn.gitBeschaeftigt(wurzel)) return true;
      // offene Zusammenführung: den Ort von MERGE_HEAD fragt Git selbst (verknüpfte Arbeitsbäume und andere Git-Ordner haben ihn nicht unter .git/)
      try {
        const s = gitSicht();
        if (!s.gesperrt) {
          const r = await gitFn.git(wurzel, ["rev-parse", "--git-path", "MERGE_HEAD"], { ...ctxVon(s), ohneHooks: true });
          const ort = r.code === 0 ? r.stdout.trim() : "";
          if (ort && existsSync(isAbsolute(ort) ? ort : join(wurzel, ort))) return true;
        } else if (existsSync(join(wurzel, ".git", "MERGE_HEAD"))) return true;
      } catch { /* unten */ }
      try { const d = leseAbgleichDetail(wurzel, opts.support); if (d && d.haelt) return true; } catch { /* unten */ }
      try {
        const m = await import(pathToFileURL(join(kern, "abgleich-sperre.mjs")).href);
        if (m.sperreStand(join(opts.support || supportOrdner(), "backup", `${vaultKennung(wurzel)}.sperre`)).besetzt) return true;
      } catch { /* ohne Kern keine Sperre */ }
      return false;
    },
    gitVersioniert: async (rel) => {
      const s = gitSicht();
      if (s.gesperrt) return false;
      const ctx = { ...ctxVon(s), ohneHooks: true };
      const ls = await gitFn.git(wurzel, ["ls-files", "--error-unmatch", "--", rel], ctx);
      if (ls.code !== 0) return false;
      const d = await gitFn.git(wurzel, ["diff", "--quiet", "HEAD", "--", rel], ctx);
      return d.code === 0;
    },
    gitCommit: async (a, extra = {}) => { umstellungSperre(); return gitFn.commit(wurzel, a || {}, gitCtx({ limit: opts.gitLimitCommit, ...(extra && extra.ohneHooks === true ? { hooks: false } : {}) })); },
    // konflikteLoesen: bei Konflikten die Zusammenführung offen lassen, damit die Oberfläche pro Datei wählen lässt (sonst wie bisher: abbrechen, 409)
    gitSync: (a) => gitSyncLaufen(a),
    // Konflikt-Ansicht (Kern): beide Fassungen je Datei · Entscheidungen abschließen (mit Abgleich wie die Sicherung) · „Später“ · „Rückgängig“
    gitKonfliktAnsicht: async () => kernAbgleich("ansicht"),
    // Ohne vom Nutzer bestätigtes Ziel sendet das Lösen NICHT (nur ein Hinweis in der Antwort) — dieselbe Regel wie bei der Sicherung (#67)
    gitKonfliktLoesen: async (a) => kernGesperrt("loesen", { auswahl: a && a.auswahl, gesehen: a && a.gesehen }, 420_000),
    gitKonfliktAbbrechen: async () => kernGesperrt("abbrechen"),
    gitKonfliktRueckgaengig: async () => kernGesperrt("rueckgaengig"),
    gitKonfliktVerwerfen: async () => kernGesperrt("verwerfen"),
    gitNachsehen: async () => mitSicherungsStand(await gitFn.nachsehen(wurzel, gitCtx())),
    gitWiederherstellenVorschau: async (pfad, sha) => gitFn.wiederherstellenVorschau(wurzel, pfad, sha, gitCtx()),
    gitWiederherstellen: async (a) => { umstellungSperre(); return gitFn.wiederherstellen(wurzel, a || {}, gitCtx({ limit: opts.gitLimitCommit })); },
    gitVerlauf: async (pfad, max) => gitFn.verlauf(wurzel, pfad, max, gitCtx()),
    gitDiff: async (pfad, sha) => gitFn.diff(wurzel, pfad, sha, gitCtx()),
    gitFassung: async (pfad, sha) => gitFn.fassung(wurzel, pfad, sha, gitCtx()),
    // Ohne Vertrauen läuft kein git, auch kein rev-parse: dann zählt, ob der Ordner ein .git hat.
    istGitRepo: async () => { const s = gitSicht(); return s.gesperrt ? existsSync(join(wurzel, ".git")) : gitFn.istRepo(wurzel, ctxVon(s)); },
  };
}
