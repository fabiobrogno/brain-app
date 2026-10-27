// gemeinsam/sicherung.mjs — Sicherung einer defekten Datei im App-Ordner: <name>.defekt-<JJJJMMTT-HHMMSS> (Berliner Zeit), nie überschreibend;
// es bleiben die 5 neuesten. Genutzt für vaults.json (vaults.mjs) und vertrauen.json (vertrauen.mjs, vaults.mjs). Keine Abhängigkeiten.
// Die Namen steigen immer (die Reihenfolge der Namen ist die der Sicherungen, danach richtet sich das Aufräumen): zweimal in derselben
// Sekunde → …-2, …-3 (immer eine Nummer über der höchsten vorhandenen), und nie ein Zeitstempel unter dem neuesten vorhandenen
// (Zeitumstellung im Herbst, zurückgestellte Uhr). Ältere Einzeldateien „<name>.defekt“ werden nicht angefasst.
import { readdirSync, copyFileSync, rmSync, constants } from "node:fs";
import { join } from "node:path";

const MAX_SICHERUNGEN = 5;
const BERLIN_ZEIT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function zeitstempel(jetzt) {
  let d = jetzt === undefined || jetzt === null ? new Date() : new Date(jetzt);
  if (Number.isNaN(d.getTime())) d = new Date();
  const t = Object.fromEntries(BERLIN_ZEIT.formatToParts(d).map((p) => [p.type, p.value]));
  return `${t.year}${t.month}${t.day}-${t.hour}${t.minute}${t.second}`;
}

// → { sichere(ordner, datei, { jetzt, verschieben }), liste(ordner) } für Dateien mit dem Namen `name` (z. B. "vaults.json").
//   sichere: kopiert `datei` unter dem nächsten freien Sicherungsnamen in `ordner` (verschieben: danach die Datei selbst weg). Wirft, wenn
//   das Kopieren scheitert (dann ist nichts verändert); das Aufräumen alter Sicherungen ist beste Mühe. → der Name der Sicherung.
export function sicherungFuer(name) {
  const muster = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.defekt-(\\d{8}-\\d{6})(?:-(\\d+))?$`);
  const liste = (ordner) => { try { return readdirSync(ordner).map((n) => ({ n, m: muster.exec(n) })).filter((x) => x.m); } catch { return []; } };
  function sichere(ordner, datei, { jetzt, verschieben = false } = {}) {
    const vorhandene = liste(ordner);
    let stempel = zeitstempel(jetzt);
    for (const { m } of vorhandene) if (m[1] > stempel) stempel = m[1];
    const hoechste = Math.max(0, ...vorhandene.filter(({ m }) => m[1] === stempel).map(({ m }) => Number(m[2] || 1)));
    let sicherung = null;
    for (let nr = hoechste + 1; ; nr++) {
      const ziel = `${name}.defekt-${stempel}${nr === 1 ? "" : `-${nr}`}`;
      try { copyFileSync(datei, join(ordner, ziel), constants.COPYFILE_EXCL); sicherung = ziel; break; }
      catch (e) { if (!(e && e.code === "EEXIST") || nr > hoechste + 1000) throw e; } // der Name ist belegt (anderer Prozess) → nächste Nummer; alles andere bricht ab
    }
    if (verschieben) rmSync(datei, { force: true });
    try { // nur die 5 neuesten behalten (Name = Zeit, bei Gleichstand die Nummer); beste Mühe
      const alle = liste(ordner).sort((a, b) => (a.m[1] < b.m[1] ? -1 : a.m[1] > b.m[1] ? 1 : Number(a.m[2] || 1) - Number(b.m[2] || 1)));
      for (const x of alle.slice(0, Math.max(0, alle.length - MAX_SICHERUNGEN))) rmSync(join(ordner, x.n), { force: true });
    } catch { /* beste Mühe */ }
    return sicherung;
  }
  return { sichere, liste };
}
