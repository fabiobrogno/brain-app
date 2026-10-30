// Synthetischer Vault für Leistungsmessung und Gleichheitstests: N Markdown-Dateien mit realistischen Größen in einem Temp-Ordner.
// Deterministisch (feste Zufallsfolge je Startwert), kein Zugriff auf echte Nutzerorte. Aufbau wie ein echter Vault:
//   09_wiki/<bereich>/<thema>/seite-<n>.md  (Frontmatter name/description/typ/stand, Überschriften, Absätze, [[Verknüpfungen]], Listen)
//   00_inbox/notiz-<n>.md                   (lose Notizen ohne Frontmatter)
//   10_projekte/<projekt>/aufgabe-<n>.md    (kurze Projektnotizen)
// Wortschatz: künstliche Wörter mit Zipf-Verteilung (wenige häufige, viele seltene), dazu deutsche Füllwörter. Größe je Datei: logarithmische
// Normalverteilung mit Median ≈ 3 KB (Spanne ≈ 0,4 – 40 KB), wie gewachsene Wiki-Seiten.
import { mkdirSync, writeFileSync, utimesSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

function zufall(start) { // mulberry32
  let a = start >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SILBEN = ["ka", "re", "lo", "mi", "tan", "ber", "gus", "nel", "fra", "vor", "sti", "dem", "wal", "pro", "zen", "ox", "ul", "an", "ei", "or", "sch", "ung", "heit", "keit", "lich", "tor", "men", "sat", "ver", "ent"];
const FUELL = ["der", "die", "das", "und", "ist", "wird", "bei", "mit", "nach", "für", "aus", "von", "wenn", "dann", "auch", "nicht", "oder", "eine", "einer", "wurde", "kann", "muss", "gilt", "zeigt", "liegt"];

export function baueWortschatz(rnd, groesse = 30000) {
  const w = new Set();
  while (w.size < groesse) {
    const n = 2 + Math.floor(rnd() * 3);
    let s = "";
    for (let i = 0; i < n; i++) s += SILBEN[Math.floor(rnd() * SILBEN.length)];
    w.add(s);
  }
  return [...w];
}

// → { vault, dateien: [rel…], aendere(rel, text?), neueSeite(rel, text?) }; alle Dateien tragen eine Änderungszeit vor 1 Tag (der Cache misstraut frischen).
export function baueGrossVault(anzahl, { start = 1, wurzel = null, wortschatz = 30000 } = {}) {
  const rnd = zufall(start);
  const vault = wurzel || mkdtempSync(join(tmpdir(), `brain-gross-${anzahl}-`));
  const woerter = baueWortschatz(rnd, wortschatz);
  const wort = () => (rnd() < 0.35 ? FUELL[Math.floor(rnd() * FUELL.length)] : woerter[Math.min(woerter.length - 1, Math.floor(woerter.length * rnd() ** 3))]);
  const satz = () => { const n = 6 + Math.floor(rnd() * 12); const t = []; for (let i = 0; i < n; i++) t.push(wort()); const s = t.join(" "); return s[0].toUpperCase() + s.slice(1) + "."; };
  const absatz = () => { const n = 2 + Math.floor(rnd() * 5); const t = []; for (let i = 0; i < n; i++) t.push(satz()); return t.join(" "); };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const zielBytes = () => Math.min(40000, Math.max(400, Math.round(3000 * Math.exp(0.9 * normal()))));
  const alt = new Date(Date.now() - 24 * 3600 * 1000);

  const bereiche = Math.max(4, Math.round(Math.sqrt(anzahl) / 6)), themen = 12;
  const dateien = [];
  const schreib = (rel, inhalt) => {
    const abs = join(vault, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, inhalt);
    utimesSync(abs, alt, alt);
    dateien.push(rel);
  };
  const seite = (rel, titel, art) => {
    const ziel = zielBytes();
    const kopf = art === "wiki"
      ? `---\nname: ${titel}\ndescription: ${satz()}\ntyp: ${["thema", "entitaet", "prozess", "entscheidung"][Math.floor(rnd() * 4)]}\nstand: 2026-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}\n---\n`
      : "";
    let t = `${kopf}# ${titel}\n\n`;
    while (t.length < ziel) {
      const r = rnd();
      if (r < 0.12) t += `## ${wort()} ${wort()}\n\n`;
      else if (r < 0.22) t += `- ${satz()}\n- ${satz()}\n- ${satz()} [[seite-${Math.floor(rnd() * anzahl)}]]\n\n`;
      else t += `${absatz()}\n\n`;
    }
    return t;
  };

  const nWiki = Math.round(anzahl * 0.7), nInbox = Math.round(anzahl * 0.1);
  for (let i = 0; i < nWiki; i++) {
    const b = i % bereiche, th = Math.floor(i / bereiche) % themen;
    schreib(`09_wiki/bereich-${b}/thema-${th}/seite-${i}.md`, seite(`seite-${i}`, `${wort()} ${wort()} ${i}`, "wiki"));
  }
  for (let i = 0; i < nInbox; i++) schreib(`00_inbox/notiz-${i}.md`, seite(`notiz-${i}`, `${wort()} ${i}`, "lose"));
  for (let i = nWiki + nInbox; i < anzahl; i++) schreib(`10_projekte/projekt-${i % 40}/aufgabe-${i}.md`, seite(`aufgabe-${i}`, `${wort()} ${wort()}`, "lose"));

  const text = () => seite("neu", `${wort()} ${wort()}`, "lose");
  return {
    vault, dateien, wort,
    // Ändert eine vorhandene Datei (neuer Inhalt, andere Größe, jetzige Änderungszeit)
    aendere(rel, inhalt = `${text()}\n\n${absatz()}\n`) { writeFileSync(join(vault, rel), inhalt); return inhalt; },
    neueSeite(rel, inhalt = text()) { const abs = join(vault, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, inhalt); return inhalt; },
  };
}
