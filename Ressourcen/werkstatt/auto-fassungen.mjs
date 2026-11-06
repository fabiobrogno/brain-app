// werkstatt/auto-fassungen.mjs — automatische lokale Fassungen („Fassungen automatisch anlegen“, Einstellungen → Sicherung & GitHub, Standard: an).
// Nach dem Speichern im Studio wartet die Werkstatt, bis 2 Minuten lang nichts mehr gespeichert wurde (oder das Studio meldet: Fenster gewechselt/geschlossen, App
// beendet) und legt dann EINEN Commit an: „Automatisch gesichert: N Notizen“. Der Commit ist lokal; ist die GitHub-Sicherung eingerichtet, lädt die Hintergrund-Sicherung
// des Kerns jeden neuen Stand hoch (ein Schalter „Automatisch abgleichen“ ist vorbereitet, tut aber noch nichts). Darum kommen NUR Notizen hinein: im Studio gespeicherte
// Dateien und geänderte, schon versionierte .md-Dateien — nie neue fremde Dateien (PDF, Video, halb geschriebene KI-Dateien) und nie große Dateien.
// Der Commit läuft über denselben Weg wie „Sichern“ im Studio (vault.gitCommit → gemeinsam/git.mjs): gehärtetes git, Hooks nach der bestehenden Regel (vertrauter Vault:
// die Commit-Prüfung des Kerns mit der Geheimnis-Suche; nicht vertraut: Git ist gesperrt, dann geschieht nichts), dieselbe Sperre im Prozess. Zusätzlich wartet
// die Automatik, solange ein Abgleich, eine offene Zusammenführung (#69/#73/#78: gemerkter Konfliktstand, Sperrdatei der Hintergrund-Sicherung) oder die Umstellung läuft.
// Findet die Prüfung etwas (Geheimnis in einer Notiz), hält die Automatik an: sie versucht es erst wieder, wenn sich die Dateien ändern, und meldet es einmal als
// Mitteilung („Sicherung“) und im Stand (GET /api/auto/stand). Es gibt nie einen zweiten Weg am Hook vorbei.
import { statSync } from "node:fs";
import { join } from "node:path";
import { leseApp } from "../gemeinsam/app-einstellungen.mjs";
import { melde } from "../gemeinsam/aktivitaet.mjs";

export const LEERLAUF_MS = 120_000;   // so lange darf nichts gespeichert werden, bevor automatisch gesichert wird
export const WIEDERHOL_MS = 60_000;   // war gerade ein Abgleich/Commit unterwegs: nach so langer Zeit noch einmal fragen
const MAX_DATEIEN = 2000;
const MAX_GROESSE = 5 * 1024 * 1024;  // größere Dateien nimmt die Automatik nie mit (die Online-Sicherung bliebe daran hängen)
const FUND = /secret|geheimnis|credential|passwort|password|schl[üu]ssel|token|api[-_ ]?key|private[-_ ]?key/i; // ausdrücklicher Fund in der Ausgabe des Hooks
const MAX_VERSUCHE = 5;               // Wartet ein Abgleich dauerhaft, gibt die Automatik nach so vielen Anläufen für diese Runde auf (der nächste Speichervorgang startet neu)

const mehrzahl = (n) => `${n} ${n === 1 ? "Notiz" : "Notizen"}`;
export const nachrichtFuer = (n) => `Automatisch gesichert: ${mehrzahl(n)}`;

// deps: { support, leerlaufMs, wiederholMs, an: () => boolean (Test-Ersatz für die Einstellung), jetzt: () => ms }
export function erzeugeAutoFassungen({ support, leerlaufMs = LEERLAUF_MS, wiederholMs = WIEDERHOL_MS, an = null, jetzt = () => Date.now() } = {}) {
  const zustaende = new Map(); // Vault-Wurzel → Zustand
  const angeschaltet = () => { if (an) return an() !== false; try { return leseApp(support).werte.fassungenAutomatisch !== false; } catch { return true; } };

  function z(v) {
    let s = zustaende.get(v.wurzel);
    if (!s) { s = { vault: v, timer: null, offen: false, zaehler: 0, laeuft: false, versuche: 0, letzte: null, angehalten: null, faellig: null, pfade: new Set() }; zustaende.set(v.wurzel, s); }
    s.vault = v;
    return s;
  }
  function plane(s, ms) {
    clearTimeout(s.timer);
    s.faellig = jetzt() + ms;
    s.timer = setTimeout(() => { sichere(s.vault, "leerlauf").catch(() => {}); }, ms);
    s.timer.unref?.();
  }

  // Aufgerufen nach jedem Speichern im Studio: der Leerlauf beginnt von vorn.
  // pfade: die im Studio gespeicherten Dateien (PUT, Zusammenführen); nur sie (und geänderte, schon versionierte .md) kommen in die Fassung.
  function vermerke(v, pfade = []) {
    if (!v) return;
    const s = z(v);
    for (const p of pfade) if (typeof p === "string" && p) s.pfade.add(p.split("\\").join("/").replace(/^\.\//, ""));
    s.offen = true; s.zaehler++; s.versuche = 0;
    if (!angeschaltet()) return;
    plane(s, leerlaufMs);
  }

  // Stand der offenen Änderungen je Datei: Änderungszeit und Größe — ändert sich eine Datei (etwa nachdem ein Geheimnis entfernt wurde), versucht die Automatik es wieder.
  function staende(wurzel, dateien) {
    const m = new Map();
    for (const p of dateien) {
      let t = "?"; try { const st = statSync(join(wurzel, p)); t = `${st.mtimeMs}:${st.size}`; } catch { /* gelöscht */ }
      m.set(p, t);
    }
    return m;
  }
  const gleichStaende = (a, b) => a.size === b.size && [...a].every(([p, t]) => b.get(p) === t);
  // Welche der geänderten Dateien kommen in die Fassung? Im Studio gespeicherte; sonst nur schon versionierte .md-Dateien; nie große.
  function auswahl(wurzel, geaendert, gespeichert) {
    const aus = [];
    for (const e of geaendert) {
      const p = e.pfad;
      const inHead = e.code !== "??" && !e.code.startsWith("A"); // schon versioniert (nicht neu, nicht bloß vorgemerkt von einem anderen Programm)
      const darf = gespeichert.has(p) || (inHead && /\.md$/i.test(p));
      if (!darf) continue;
      try { if (statSync(join(wurzel, p)).size > MAX_GROESSE) continue; } catch { /* gelöscht: die Löschung einer Notiz darf mit */ }
      aus.push(p);
      if (aus.length >= MAX_DATEIEN) break;
    }
    return aus;
  }

  // grund: "leerlauf" | "fenster" | "beenden" | "test". → { art: "gesichert" | "nichts" | "aus" | "besetzt" | "angehalten" | "kein-git" | "konflikt" | "laeuft", … }
  async function sichere(v, grund = "leerlauf") {
    const s = z(v);
    if (!angeschaltet()) { clearTimeout(s.timer); s.faellig = null; return { art: "aus" }; }
    if (s.laeuft) return { art: "laeuft" };
    if (grund !== "test" && !s.offen) return { art: "nichts" }; // nur nach Speichern im Studio, nie „ins Blaue“
    s.laeuft = true;
    const zaehlerStart = s.zaehler; // wurde während des Sicherns wieder gespeichert, bleibt „offen“
    const erledigt = () => { if (s.zaehler === zaehlerStart) s.offen = false; };
    clearTimeout(s.timer); s.faellig = null;
    // Ist gerade etwas anderes dran (Abgleich, Zusammenführung, Umstellung, vorübergehender Git-Fehler), fragt die Automatik später noch einmal — auch nach „Fenster gewechselt“,
    // sonst bliebe der Stand offen, bis zufällig wieder gespeichert wird. Beim Beenden gibt es kein Später.
    const spaeter = (art) => {
      if (grund !== "beenden" && ++s.versuche < MAX_VERSUCHE) plane(s, wiederholMs);
      return { art };
    };
    try {
      if (v.umstellungLaeuft?.()) return spaeter("besetzt");
      if (await v.abgleichBeschaeftigt()) return spaeter("besetzt");
      const st = await v.gitStatus();
      if (st.gesperrt || !st.repo) { erledigt(); return { art: "kein-git" }; }
      if (st.konflikt) return spaeter("konflikt");
      const dateien = auswahl(v.wurzel, st.geaendert || [], s.pfade);
      if (!dateien.length) { erledigt(); s.angehalten = null; s.pfade.clear(); return { art: "nichts" }; }
      const stand = staende(v.wurzel, dateien);
      if (s.angehalten && ["pruefung", "hook-fehler"].includes(s.angehalten.grund) && gleichStaende(s.angehalten.staende, stand)) { erledigt(); return { art: "angehalten", grund: s.angehalten.grund }; }
      let r;
      try {
        // Der Commit läuft unter der gemeinsamen Sperre der Hintergrund-Sicherung (nie zugleich mit deren Zusammenführung); ohne Kern/Sperre wie bisher.
        const tun = () => v.gitCommit({ nachricht: nachrichtFuer(dateien.length), dateien });
        r = await (typeof v.mitAbgleichSperre === "function" ? v.mitAbgleichSperre("auto-fassung", tun) : tun());
      }
      catch (e) {
        if (e && e.status === 409) return spaeter("besetzt"); // Abgleich läuft, Zusammenführung offen, Git gesperrt
        // Nur die Ablehnung durch die Prüfung (Hook) hält an; index.lock, fehlende Identität, GPG & Co. sind vorübergehend oder Einrichtung: später noch einmal.
        const pruefung = !!(e && e.status === 422 && e.extra && e.extra.art === "hook");
        if (!pruefung && grund !== "beenden" && s.versuche + 1 < MAX_VERSUCHE) return spaeter("fehler");
        // Ein Fund heißt nur so, wenn der Hook ausdrücklich einen meldet; ein Hook, der aus anderem Grund scheitert (fehlender Interpreter, Signal), hat nur „angehalten“.
        const ausgabe = pruefung && e.extra && typeof e.extra.ausgabe === "string" ? e.extra.ausgabe : "";
        const fund = pruefung && FUND.test(ausgabe);
        const art = pruefung ? (fund ? "pruefung" : "hook-fehler") : "fehler";
        const text = fund
          ? "Die Prüfung vor dem Sichern hat etwas gefunden (zum Beispiel einen Schlüssel oder ein Passwort in einer Notiz). Die automatische Fassung wartet, bis du das behoben hast."
          : pruefung ? "Die Prüfung vor dem Sichern hat angehalten (sie meldet keinen Fund, sondern einen Fehler). Die automatische Fassung wartet, bis sich an den Dateien etwas ändert."
          : "Die automatische Fassung konnte nicht angelegt werden.";
        // „Meldet einmal“ je betroffener Datei: dieselbe unveränderte Datei aus dem früheren Stand läutet nicht noch einmal, auch wenn inzwischen andere Notizen dazukamen.
        const neu = !s.angehalten || ![...s.angehalten.staende].some(([p, t]) => stand.get(p) === t);
        s.angehalten = { grund: art, text, ausgabe: pruefung ? ausgabe.slice(0, 800) : null, seit: new Date(jetzt()).toISOString(), staende: stand };
        erledigt();
        if (neu) { try { melde(v.wurzel, { art: "sicherung-fehler", text: fund ? "Automatische Fassung angehalten: die Prüfung hat etwas gefunden." : pruefung ? "Automatische Fassung angehalten: die Prüfung vor dem Sichern hat angehalten." : "Automatische Fassung nicht angelegt." }, { support }); } catch { /* nur ein Hinweis */ } }
        return { art: "angehalten", grund: s.angehalten.grund };
      }
      erledigt(); s.versuche = 0; s.angehalten = null; for (const p of dateien) s.pfade.delete(p);
      s.letzte = { zeit: new Date(jetzt()).toISOString(), sha: r.sha, anzahl: dateien.length, grund };
      return { art: "gesichert", sha: r.sha, anzahl: dateien.length };
    } finally { s.laeuft = false; }
  }

  // Stand für die Oberfläche (GET /api/auto/stand)
  function stand(v) {
    const s = v ? zustaende.get(v.wurzel) : null;
    return {
      an: angeschaltet(),
      offen: !!s?.offen,
      faelligIn: s?.faellig ? Math.max(0, s.faellig - jetzt()) : null,
      letzte: s?.letzte || null,
      angehalten: s?.angehalten ? { grund: s.angehalten.grund, text: s.angehalten.text, ausgabe: s.angehalten.ausgabe, seit: s.angehalten.seit } : null,
    };
  }

  // Vault-Wechsel: was beim bisherigen Vault noch offen war, wird jetzt gesichert (beste Mühe); Zeitgeber aller Vaults enden.
  async function beiWechsel(alt) {
    if (!alt) return;
    const s = zustaende.get(alt.wurzel);
    if (s) { clearTimeout(s.timer); s.faellig = null; }
    if (s && s.offen) { try { await sichere(alt, "fenster"); } catch { /* beste Mühe */ } }
  }
  function beende() { for (const s of zustaende.values()) { clearTimeout(s.timer); s.faellig = null; } }

  return { vermerke, sichere, stand, beiWechsel, beende };
}
