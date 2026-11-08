// Markdown-Tabellen (Runde 3b): die reine Logik — Zerlegen, Ausrichten, Zeilen und Spalten ändern, Zellenpositionen im Text.
// Ohne DOM und ohne CodeMirror (läuft auch in Node: Tests/Node/tabellen.test.mjs). Das Modell:
//   { zeilen: [[zelle, …], …], ausr: [null | "l" | "c" | "r", …] }
// zeilen[0] ist die Kopfzeile; jede Zeile hat gleich viele Zellen. Zellentexte stehen ohne den Schutz „\|“ im Modell und bekommen ihn erst beim Schreiben.

export const entschuetze = (z) => z.replace(/\\\|/g, "|");
export const schuetze = (z) => z.replace(/\|/g, "\\|");

// Eine Tabellenzeile in ihre Zellen (roh, getrimmt, mit „\|“ unverändert). Führendes und abschließendes „|“ gehören nicht zu den Zellen.
export function zerlegeZeile(zeile) {
  const t = zeile.trim();
  const teile = [];
  let aktuell = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && t[i + 1] === "|") { aktuell += "\\|"; i++; continue; }
    if (c === "|") { teile.push(aktuell); aktuell = ""; continue; }
    aktuell += c;
  }
  teile.push(aktuell);
  if (t.startsWith("|")) teile.shift();
  if (t.endsWith("|") && !t.endsWith("\\|") && teile.length) teile.pop();
  return teile.map((z) => z.trim());
}

const TRENNER = /^:?-+:?$/;
export const istTrennerZeile = (zeile) => {
  const z = zerlegeZeile(zeile);
  return z.length > 0 && z.every((c) => TRENNER.test(c)) && /-/.test(zeile);
};
const ausrichtungVon = (c) => (c.startsWith(":") && c.endsWith(":") ? "c" : c.endsWith(":") ? "r" : c.startsWith(":") ? "l" : null);

// Text einer Tabelle (Zeilen mit \n getrennt) → Modell, oder null, wenn es keine Tabelle ist (Kopf und Trennzeile fehlen).
export function parseTabelle(text) {
  const zeilen = text.split(/\r?\n/).filter((z) => z.trim() !== "");
  if (zeilen.length < 2 || !istTrennerZeile(zeilen[1])) return null;
  const kopf = zerlegeZeile(zeilen[0]).map(entschuetze);
  const trenner = zerlegeZeile(zeilen[1]);
  const rumpf = zeilen.slice(2).map((z) => zerlegeZeile(z).map(entschuetze));
  const n = Math.max(kopf.length, trenner.length, ...rumpf.map((r) => r.length), 1); // nie Zellen verlieren (GFM würde Überzählige ignorieren)
  const fuelle = (r) => { const x = r.slice(); while (x.length < n) x.push(""); return x; };
  return { zeilen: [fuelle(kopf), ...rumpf.map(fuelle)], ausr: Array.from({ length: n }, (_, i) => (trenner[i] ? ausrichtungVon(trenner[i]) : null)) };
}

// Anzeigebreite: breite Zeichen (CJK, Emoji) zählen doppelt, kombinierende Zeichen gar nicht
export function breite(s) {
  let b = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    b += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f)
      || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) ? 2 : 1;
  }
  return b;
}

// Modell → ausgerichteter Text. Gibt { zeilen: [Text, …], starts: [[Versatz der Zelle im Text, …], …] } zurück;
// starts[i][j] = Versatz des Zelleninhalts (nach „| “ und dem Füllraum bei rechts/zentrierten Spalten) vom Anfang des Tabellentextes, mit `ende` als Länge des Zeilenumbruchs (Zeile i = Modellzeile, die Trennzeile zählt mit).
export function baueTabelle(m, ende = "\n") {
  const n = m.ausr.length;
  const roh = m.zeilen.map((r) => r.map(schuetze));
  const w = Array.from({ length: n }, (_, j) => Math.max(3, ...roh.map((r) => breite(r[j] ?? ""))));
  const fuell = (s, j) => {
    const l = w[j] - breite(s), a = m.ausr[j];
    if (a === "r") return " ".repeat(l) + s;
    if (a === "c") { const links = Math.floor(l / 2); return " ".repeat(links) + s + " ".repeat(l - links); }
    return s + " ".repeat(l);
  };
  const trenner = (j) => { const a = m.ausr[j], b = w[j]; return a === "c" ? ":" + "-".repeat(b - 2) + ":" : a === "r" ? "-".repeat(b - 1) + ":" : a === "l" ? ":" + "-".repeat(b - 1) : "-".repeat(b); };
  const linien = [], starts = [];
  let versatz = 0;
  const linie = (zellen, istTrenner) => {
    let text = "|", s = [];
    for (let j = 0; j < n; j++) {
      const inhalt = istTrenner ? trenner(j) : fuell(zellen[j] ?? "", j);
      s.push(versatz + text.length + 1 + (istTrenner ? 0 : /^ */.exec(inhalt)[0].length));
      text += " " + inhalt + " |";
    }
    linien.push(text); starts.push(s);
    versatz += text.length + ende.length;
  };
  linie(roh[0], false);
  linie(null, true);
  for (let i = 1; i < roh.length; i++) linie(roh[i], false);
  // Zeilen des Modells (ohne Trennzeile) auf die Zeilen des Textes abbilden: Text-Zeile 0 = Kopf, 1 = Trenner, k+1 = Modellzeile k
  return { zeilen: linien, starts: starts.filter((_, i) => i !== 1), text: linien.join(ende) };
}

// ---- Änderungen (jede gibt ein neues Modell zurück)
const kopie = (m) => ({ zeilen: m.zeilen.map((r) => r.slice()), ausr: m.ausr.slice() });
export function mitZelle(m, z, s, text) { const k = kopie(m); if (k.zeilen[z] && s < k.ausr.length) k.zeilen[z][s] = text; return k; }
// Neue Zeile vor Modellzeile `index` (mindestens 1: über der Kopfzeile gibt es nichts); index = Anzahl der Zeilen hängt hinten an
export function zeileEinfuegen(m, index) {
  const k = kopie(m), i = Math.min(Math.max(1, index), k.zeilen.length);
  k.zeilen.splice(i, 0, k.ausr.map(() => ""));
  return k;
}
// Die Kopfzeile bleibt immer (sonst wäre es keine Tabelle mehr)
export function zeileLoeschen(m, z) { if (z < 1 || z >= m.zeilen.length) return m; const k = kopie(m); k.zeilen.splice(z, 1); return k; }
export function spalteEinfuegen(m, index) {
  const k = kopie(m), i = Math.min(Math.max(0, index), k.ausr.length);
  k.zeilen.forEach((r, z) => r.splice(i, 0, z === 0 ? `Spalte ${k.ausr.length + 1}` : ""));
  k.ausr.splice(i, 0, null);
  return k;
}
export function spalteLoeschen(m, s) { if (m.ausr.length < 2 || s < 0 || s >= m.ausr.length) return m; const k = kopie(m); k.zeilen.forEach((r) => r.splice(s, 1)); k.ausr.splice(s, 1); return k; }
export function ausrichtungSetzen(m, s, a) { if (s < 0 || s >= m.ausr.length) return m; const k = kopie(m); k.ausr[s] = a || null; return k; }
export function spalteVerschieben(m, s, nach) {
  if (s < 0 || nach < 0 || s >= m.ausr.length || nach >= m.ausr.length || s === nach) return m;
  const k = kopie(m);
  for (const r of k.zeilen) r.splice(nach, 0, r.splice(s, 1)[0]);
  k.ausr.splice(nach, 0, k.ausr.splice(s, 1)[0]);
  return k;
}

// Neue Tabelle: Spaltenüberschriften „Spalte 1 …“, leere Zeilen
export function neueTabelle(spalten = 3, zeilen = 2, kopf = (j) => `Spalte ${j + 1}`) {
  const n = Math.max(1, spalten);
  return { zeilen: [Array.from({ length: n }, (_, j) => kopf(j)), ...Array.from({ length: Math.max(0, zeilen) }, () => Array(n).fill(""))], ausr: Array(n).fill(null) };
}

// Wo steht der Cursor? `text` = Tabellentext, `versatz` = Cursor darin → { zeile: Modellzeile (0 = Kopf) | "trenner", spalte }
export function zellenOrt(text, versatz) {
  const linien = text.split(/\r?\n/);
  let pos = 0, nr = 0;
  for (; nr < linien.length; nr++) { const ende = pos + linien[nr].length; if (versatz <= ende) break; pos = ende + (text.slice(ende, ende + 2) === "\r\n" ? 2 : 1); }
  nr = Math.min(nr, linien.length - 1);
  const zeile = linien[nr], v = Math.max(0, Math.min(versatz - pos, zeile.length));
  const fuehrend = zeile.trimStart().startsWith("|") ? 1 : 0;
  let striche = 0;
  for (let i = 0; i < v; i++) if (zeile[i] === "|" && zeile[i - 1] !== "\\") striche++;
  return { zeile: nr === 1 ? "trenner" : nr === 0 ? 0 : nr - 1, spalte: Math.max(0, striche - fuehrend) };
}
// Vorgänger/Nachfolger-Zelle bei Tab / ⇧Tab. → { zeile, spalte } oder { neueZeile: true } (hinter der letzten Zelle) bzw. null (vor der ersten)
export function naechsteZelle(m, z, s, rueckwaerts = false) {
  const n = m.ausr.length;
  if (rueckwaerts) { if (s > 0) return { zeile: z, spalte: s - 1 }; return z > 0 ? { zeile: z - 1, spalte: n - 1 } : null; }
  if (s < n - 1) return { zeile: z, spalte: s + 1 };
  return z < m.zeilen.length - 1 ? { zeile: z + 1, spalte: 0 } : { neueZeile: true };
}

// Kleinste Änderung zwischen zwei Texten (gemeinsamer Anfang und Ende bleiben): → { von, bis, einfuegen } bezogen auf `alt`
export function kleinsteAenderung(alt, neu) {
  let a = 0;
  const max = Math.min(alt.length, neu.length);
  while (a < max && alt[a] === neu[a]) a++;
  let e = 0;
  while (e < max - a && alt[alt.length - 1 - e] === neu[neu.length - 1 - e]) e++;
  return { von: a, bis: alt.length - e, einfuegen: neu.slice(a, neu.length - e) };
}

// Text für den Befehl „Tabelle einfügen“
export const neueTabelleText = (ende = "\n", spalten = 3, zeilen = 2) => baueTabelle(neueTabelle(spalten, zeilen), ende);
