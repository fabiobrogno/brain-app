// tageslauf/traum-eingabe.mjs — Eingabe des Traums (traum.mjs): Einstellungen, Projekte der Gedächtnis-Wurzel, Verläufe der letzten 24 h,
// Themen-Ausschluss, Anlass. Nur LESEN (nie in Wurzel oder ~/.claude*), nur Node-Standardbibliothek (+ gedaechtnis.mjs: Pfade, Projekt-Schlüssel und das Format der
// Konflikt-Kopien/_konflikte.md kommen von dort — es gibt keinen zweiten Parser), wirft nie bei kaputten Dateien.
//
// Wurzel: <wurzel>/<projekt-schlüssel>/MEMORY.md + Themen-Dateien (+ _konflikte.md, Konflikt-Kopien <name>.konflikt-<konto>.md — beides schreibt gedaechtnis.mjs).
// Verläufe: <konto>/projects/<projekt-schlüssel>/*.jsonl (der Schlüssel ist der Ordnername, den Claude Code für das Projekt vergibt).
// Was die KI sieht, steht komplett in diesem Modul fest: je Verlauf nur Nutzer- und Assistenten-Text (verlauf.mjs), Zeilen mit Zugangsdaten
// entfernt, gekappt (30 KB je Verlauf, 150 KB je Projekt, höchstens 20 Verläufe, neueste Nachrichten zuerst). Ein Verlauf, in dem irgendeine
// Nachricht ein ausgeschlossenes Wort nennt, fällt GANZ heraus (lieber Lücke als Fehler); Gedächtnis-Dateien und Index-Zeilen mit einem solchen
// Wort bekommt die KI ebenfalls nie zu sehen (Dateien nicht kopiert, Zeilen durch einen Platzhalter ersetzt, den die Prüfung wieder einsetzt) — ebenso jede Gedächtnis-Zeile mit
// Zugangsdaten-Muster (Platzhalter in ALLEN Dateien; gemeldet wird sie weiterhin, nur nie weitergegeben).
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { nutzerNachricht, assistentText, zeitVon, leseAb, kuerze, uhrzeit, datumZeit } from "../verlauf.mjs";
import { nenntThema, normiereWortliste } from "../thema-ausschluss.mjs";
import { ohneSecrets, zeilenMitSecrets } from "../secrets-muster.mjs";
import { gedaechtnisPfade, istEchterProjektSchluessel, istKonfliktKopie, istAufgeloesteKopie, leseKonfliktEintraege } from "../gedaechtnis.mjs";

export const FENSTER_MS = 24 * 3600e3;
export const MAX_VERLAEUFE = 20, MAX_BYTES_VERLAUF = 30 * 1024, MAX_BYTES_PROJEKT = 150 * 1024;
export const MAX_NUTZER_ZEICHEN = 2000, MAX_ASSISTENT_ZEICHEN = 700;
export const MEMORY_SOLL = 150;                      // MEMORY.md über dieser Zeilenzahl ist allein schon ein Anlass
export { istEchterProjektSchluessel };                // EINE Definition „echter Projekt-Schlüssel“ (Aufbau + Temp-/Scratchpad-Ausschluss) — dieselbe wie im Abgleich
export const DATEINAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,150}\.md$/;      // _konflikte.md zählt mit; NEUE Dateien dürfen nicht mit „_“ beginnen (traum-regeln.mjs)
export const istKonfliktKopieMd = (name) => istKonfliktKopie(name) && /\.md$/.test(name);     // Namensmuster von gedaechtnis.mjs (konfliktName), hier nur .md
const MAX_DATEI_BYTES = 512 * 1024;
const LESE_MAX = 8 * 1024 * 1024;
export const PLATZHALTER = (n) => `<!-- traum-geschuetzt-${n} -->`;
export const PLATZHALTER_MUSTER = /^<!-- traum-geschuetzt-(\d+) -->$/;

// → { teilen, wurzel, konten, max, woerter } | null. null = Einstellungen nicht lesbar → der Traum läuft nicht (fail-closed wie der Themen-Guard von B3).
// Wurzel, Konten und der Schalter gedaechtnisTeilen kommen aus gedaechtnisPfade (dieselbe Auflösung wie im Abgleich).
export function traumKonfig(ctx) {
  const w = ctx?.werte;
  if (!w || typeof w !== "object" || !Array.isArray(w.ernteOhneThema) || !Array.isArray(w.traumOhneThema)) return null;
  const max = Number.isInteger(w.traumProjekteMax) && w.traumProjekteMax >= 1 ? w.traumProjekteMax : 5;
  const { teilen, wurzel, konten } = gedaechtnisPfade(w, { home: ctx.home || homedir() });
  return { teilen, wurzel, konten, max, woerter: normiereWortliste([...w.ernteOhneThema, ...w.traumOhneThema]) };
}

const istDatei = (p) => { try { return lstatSync(p).isFile(); } catch { return false; } };
const istOrdner = (p) => { try { const s = lstatSync(p); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } };
const lies = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// Projekte der Wurzel: nur echte Projekt-Schlüssel (nicht _traum, .git, .abgleich, Temp-/Scratchpad-Projekte) — dieselbe Definition wie im Abgleich.
export function listeProjekte(wurzel) {
  let namen = [];
  try { namen = readdirSync(wurzel); } catch { return []; }
  return namen.filter((n) => istEchterProjektSchluessel(n) && istOrdner(join(wurzel, n))).sort();
}

// Fingerabdruck ALLER Dateien des Projektordners (rekursiv, ohne .git): jede Änderung — auch eine neue Datei — ändert ihn.
export function gedaechtnisStand(projektDir) {
  const h = createHash("sha256");
  const gang = (rel) => {
    let namen = [];
    try { namen = readdirSync(join(projektDir, rel)).sort(); } catch { return; }
    for (const n of namen) {
      if (n === ".git") continue;
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = lstatSync(join(projektDir, r)); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) gang(r);
      else if (st.isFile()) { try { h.update(`${r}\0${createHash("sha256").update(readFileSync(join(projektDir, r))).digest("hex")}\0`); } catch { h.update(`${r}\0?\0`); } }
      else h.update(`${r}\0${st.isSymbolicLink() ? "link" : "andere"}\0`);
    }
  };
  gang("");
  return h.digest("hex");
}

// Fingerabdruck NUR der genannten Dateien (Namen im Projektordner; „fehlt“ zählt mit): so verfällt eine Freigabe nicht, nur weil eine ANDERE Datei des Projekts
// (z. B. durch eine laufende Sitzung) geändert wurde. Dieselbe Rechnung für die Platte (dateienStand) und für die Texte, auf denen der Traum rechnete (standAusTexten).
const dateiHash = (inhalt) => (inhalt === null ? "-" : createHash("sha256").update(inhalt).digest("hex"));
const standVon = (namen, inhaltVon) => {
  const h = createHash("sha256");
  for (const n of [...new Set(namen)].sort()) h.update(`${n}\0${dateiHash(inhaltVon(n))}\0`);
  return h.digest("hex");
};
export function dateienStand(projektDir, namen) {
  return standVon(namen, (n) => { try { return lstatSync(join(projektDir, n)).isFile() ? readFileSync(join(projektDir, n)) : Buffer.from("(keine Datei)"); } catch { return null; } });
}
export function standAusTexten(texte, namen) { return standVon(namen, (n) => (texte.has(n) ? Buffer.from(texte.get(n), "utf8") : null)); }

// → { dateien: Map<name, text> (nur Dateien oberhalb von Unterordnern: *.md, lesbar, ≤ 512 KB), konflikte: [Namen der Konflikt-Kopien], zeilenMemory }
export function leseProjekt(wurzel, schluessel) {
  const dir = join(wurzel, schluessel);
  const dateien = new Map();
  let namen = [];
  try { namen = readdirSync(dir).sort(); } catch { /* leer */ }
  for (const n of namen) {
    if (!DATEINAME.test(n) || !istDatei(join(dir, n))) continue;
    try { if (lstatSync(join(dir, n)).size > MAX_DATEI_BYTES) continue; } catch { continue; }
    const t = lies(join(dir, n));
    if (t !== null) dateien.set(n, t);
  }
  // Offene Konflikt-Kopien: Namensmuster UND/ODER Eintrag in _konflikte.md (exaktes Format von gedaechtnis.mjs) — bereits aufgelöste (status: aufgeloest) zählen nicht mehr,
  // sie räumt der nächste Abgleich weg.
  const offen = (n) => dateien.has(n) && !istAufgeloesteKopie(n, dateien.get(n));
  const konflikte = new Set([...dateien.keys()].filter((n) => istKonfliktKopieMd(n) && offen(n)));
  const liste = dateien.get("_konflikte.md");
  const eintraege = liste ? leseKonfliktEintraege(liste).filter((e) => offen(e.kopie)) : [];
  for (const e of eintraege) konflikte.add(e.kopie);
  return { dir, dateien, konflikte: [...konflikte].sort(), hatKonfliktListe: eintraege.length > 0, zeilenMemory: zeilenZahl(dateien.get("MEMORY.md")) };
}
export const zeilenZahl = (t) => (typeof t === "string" && t ? t.replace(/\n$/, "").split("\n").length : 0);

// ---------- Verläufe ----------

function nachrichten(eintraege) {
  const out = [];
  for (const o of eintraege) {
    const z = zeitVon(o);
    const n = nutzerNachricht(o);
    if (n) { if (n.text) out.push({ rolle: "Nutzer", text: n.text, zeit: z }); continue; }
    const a = assistentText(o).trim();
    if (a) out.push({ rolle: "Claude", text: a, zeit: z });
  }
  return out;
}

// → { verlaeufe: [{ nr, name, konto, mtime, bytes, text, nutzerText, nachrichten }], ausgeschlossen, secretZeilen }
//   nachrichten: [{ rolle: "Nutzer"|"Claude", text }] — NUR die echten Nachrichtentexte (genau die, die in `text` stehen), strukturiert. Die Regelprüfung (traum-regeln.mjs) lässt Belege
//   ausschließlich darin gelten — nie in den vom Kit erzeugten Kopf-, Trenn- und Auslassungszeilen von `text` (keine Muster-Raterei).
// Reihenfolge: neueste zuerst (mtime). `woerter` null → nichts lesen (fail-closed).
export function sammleVerlaeufe({ konten, schluessel, jetzt, woerter, seitMs = FENSTER_MS, maxAnzahl = MAX_VERLAEUFE,
  maxVerlauf = MAX_BYTES_VERLAUF, maxProjekt = MAX_BYTES_PROJEKT }) {
  const erg = { verlaeufe: [], ausgeschlossen: 0, secretZeilen: 0 };
  if (!Array.isArray(woerter)) return erg;
  const kand = [];
  for (const konto of konten) {
    const dir = join(konto, "projects", schluessel);
    let namen = [];
    try { namen = readdirSync(dir); } catch { continue; }
    for (const n of namen) {
      if (!n.endsWith(".jsonl")) continue;
      let st;
      try { st = lstatSync(join(dir, n)); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < jetzt - seitMs || st.mtimeMs > jetzt + 3600e3) continue;
      kand.push({ pfad: join(dir, n), name: n.replace(/\.jsonl$/, ""), konto, mtime: st.mtimeMs });
    }
  }
  kand.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  let rest = maxProjekt;
  for (const k of kand.slice(0, maxAnzahl)) {
    if (rest < 2048) break;
    let msgs = nachrichten(leseAb(k.pfad, 0, LESE_MAX).eintraege);
    if (!msgs.length) continue;
    if (msgs.some((m) => nenntThema(woerter, m.text))) { erg.ausgeschlossen++; continue; }     // ein Treffer → der ganze Verlauf fällt heraus
    msgs = msgs.map((m) => {
      const roh = kuerze(m.text, m.rolle === "Nutzer" ? MAX_NUTZER_ZEICHEN : MAX_ASSISTENT_ZEICHEN);
      erg.secretZeilen += zeilenMitSecrets(roh).treffer.size;
      return { ...m, text: ohneSecrets(roh).trim() };
    }).filter((m) => m.text);
    if (!msgs.length) continue;
    const nr = erg.verlaeufe.length + 1;
    const kopf = `# Verlauf ${nr} — ${datumZeit(k.mtime)} (Konto ${k.konto.split(/[\\/]/).pop()}, Sitzung ${k.name.slice(0, 8)})`;
    const grenze = Math.min(maxVerlauf, rest);
    const bloecke = msgs.map((m) => `[${uhrzeit(m.zeit)}] ${m.rolle}: ${m.text}`);
    let bytes = Buffer.byteLength(kopf) + 64, von = bloecke.length;
    while (von > 0 && bytes + Buffer.byteLength(bloecke[von - 1]) + 2 <= grenze) { von--; bytes += Buffer.byteLength(bloecke[von]) + 2; }
    if (von >= bloecke.length) continue;                                                      // nicht einmal die letzte Nachricht passt
    const gewaehlt = msgs.slice(von);
    const text = [kopf, "", ...(von > 0 ? [`[… ${von} frühere Nachrichten ausgelassen]`, ""] : []), bloecke.slice(von).join("\n\n"), ""].join("\n");
    rest -= Buffer.byteLength(text);
    erg.verlaeufe.push({ nr, name: k.name, konto: k.konto, mtime: k.mtime, bytes: Buffer.byteLength(text), text,
      nutzerText: gewaehlt.filter((m) => m.rolle === "Nutzer").map((m) => m.text).join("\n\n"),
      nachrichten: gewaehlt.map((m) => ({ rolle: m.rolle, text: m.text })) });
  }
  return erg;
}

// ---------- Themen-Ausschluss im Gedächtnis ----------

// Dateien, die die KI nie sieht: Name oder Inhalt nennt ein ausgeschlossenes Wort. → Set<name>
export function ausgeschlosseneDateien(dateien, woerter) {
  const aus = new Set();
  for (const [n, t] of dateien) if (nenntThema(woerter, n, t)) aus.add(n);
  return aus;
}

// Zeilen (MEMORY.md, _konflikte.md), die ein ausgeschlossenes Wort nennen oder auf eine ausgeschlossene Datei zeigen, werden durch einen Platzhalter ersetzt — mit
// secrets: true auch Zeilen mit Zugangsdaten-Muster (in JEDER Datei; ein PEM-Block zeilenweise). Die KI sieht dann nie einen Zugangsdaten-Wert.
// → { text, maske: [{ platzhalter, zeile }] }. Die Prüfung (traum-regeln.mjs) setzt die Originalzeilen wieder ein und verlangt jeden Platzhalter genau einmal.
export function maskiereZeilen(text, { woerter, ausgeschlossen, start = 1, secrets = false }) {
  const maske = [];
  const geheim = secrets ? zeilenMitSecrets(text).treffer : new Set();
  const zeilen = String(text).split("\n").map((z, i) => {
    const ziele = [...z.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]);
    if (!geheim.has(i) && !nenntThema(woerter, z) && !ziele.some((x) => ausgeschlossen.has(x))) return z;
    const platzhalter = PLATZHALTER(start + maske.length);
    maske.push({ platzhalter, zeile: z });
    return platzhalter;
  });
  return { text: zeilen.join("\n"), maske };
}

// Dieselben Zeilen für die ANZEIGE: Originalzeilen, die maskiert waren, erscheinen auch im Diff nur als Platzhalter (der Diff landet als Rückfrage im Brain).
export function maskiereFuerAnzeige(text, maske) {
  const frei = (maske || []).map((m) => ({ ...m, benutzt: false }));
  return String(text).split("\n").map((z) => { const m = frei.find((x) => !x.benutzt && x.zeile === z); if (m) { m.benutzt = true; return m.platzhalter; } return z; }).join("\n");
}

// ---------- Anlass ----------

// → { gruende: [Text], groesse }. Leer = kein Anlass. groesse bestimmt die Reihenfolge („größte Anlässe zuerst“).
export function anlassFuer(projekt, verlaeufe) {
  const gruende = [];
  let groesse = 0;
  const kb = Math.round(verlaeufe.reduce((s, v) => s + v.bytes, 0) / 1024);
  if (verlaeufe.length) { gruende.push(`${verlaeufe.length} Verlauf/Verläufe der letzten 24 h (${kb} KB)`); groesse += kb; }
  if (projekt.hatKonfliktListe || projekt.konflikte.length) { gruende.push(`Konflikt-Kopien (${projekt.konflikte.length})`); groesse += 100 * Math.max(1, projekt.konflikte.length); }
  if (projekt.zeilenMemory > MEMORY_SOLL) { gruende.push(`MEMORY.md hat ${projekt.zeilenMemory} Zeilen (> ${MEMORY_SOLL})`); groesse += projekt.zeilenMemory - MEMORY_SOLL; }
  return { gruende, groesse };
}
