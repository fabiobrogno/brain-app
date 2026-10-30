// minisuche.mjs — reine JS-Suche (kein qmd nötig): BM25 über die Vault-Notizen, k1=1.2, b=0.75.
// Das Frontmatter-Feld `description` zählt dreifach (Signal für Wiki-Seiten).
//
// Inkrementeller Index-Cache (im Speicher des Prozesses; der MCP-Server und die Werkstatt laufen lange, die CLI je Aufruf einmal):
//   · Je Vault (Schlüssel: aufgelöster Pfad) merkt sich der Cache je Datei die Zählung der Wörter (Wort-Nummer → Häufigkeit, in der Reihenfolge des
//     ersten Vorkommens) und die Länge. Schlüssel je Datei: Änderungszeit + Größe aus dem Verzeichnislauf (walk). Nur neue oder geänderte Dateien
//     werden wieder gelesen und zerlegt; gelöschte fallen heraus. Der Verzeichnislauf selbst (readdir + stat) läuft bei jeder Suche, damit jede
//     Änderung auffällt — er ist ein Bruchteil der Kosten von Lesen und Zerlegen.
//   · Frisch geschriebene Dateien (Änderungszeit < 2 s vor dem Lesen) gelten nicht als sicher (grobe Zeitstempel: zwei Schreibvorgänge in derselben
//     Zeiteinheit mit gleicher Größe): sie werden bei der nächsten Suche noch einmal gelesen.
//   · Vault-Wechsel: jeder Vault hat seinen eigenen Eintrag; höchstens MINISUCHE_GRENZEN.vaults Einträge (zuletzt benutzt bleibt), der Rest wird freigegeben.
//   · Begrenzter Speicher: Wörter als Zahlen (ein Wörterbuch je Vault) und Zählungen als Int32Array; wächst das Wörterbuch über .woerter oder die
//     Zahl der Zählungen über .eintraege, wird der Eintrag verworfen (die laufende Suche wird noch beantwortet, die nächste liest neu).
// Die Rangfolge ist bitgleich zur Suche ohne Cache: gleiche Zerlegung, gleiche Reihenfolge der Summanden (Wörter in der Reihenfolge ihres ersten
// Vorkommens in der Datei), gleiche Sortierung.
import { readFileSync } from "node:fs";
import { sep, resolve } from "node:path";
import { walk } from "./vault-dateien.mjs";
import { entferneBom } from "./pfade.mjs";

const K1 = 1.2;
const B = 0.75;
const TOKEN_MUSTER = /[\p{L}\p{N}]+/gu;

// Grenzen (veränderbar nur für Tests): Vaults im Speicher · Wörter im Wörterbuch je Vault (≈ 100 MB) · Zählungen je Vault (je 2 × 4 Byte ≈ 64 MB)
export const MINISUCHE_GRENZEN = { vaults: 3, woerter: 1_000_000, eintraege: 8_000_000 };
const FRISCH_MS = 2000;

function tokenisiere(text) {
  return String(text).normalize("NFC").toLowerCase().match(TOKEN_MUSTER) || [];  // NFC: wie ansicht/suche.js
}

// Frontmatter-Beschreibung dreifach gewichten: Rumpf (ohne Frontmatter) + description 3×
// statt einmal natürlich im Rohtext.
function dokumentText(full) {
  const raw = entferneBom(readFileSync(full, "utf8")).replace(/\r\n/g, "\n"); // BOM (PowerShell 5.1) weg wie daten.mjs; CRLF (Windows-Checkout) wie LF
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return raw;
  const rumpf = raw.slice(m[0].length);
  let beschreibung = "";
  for (const zeile of m[1].split("\n")) {
    const kv = zeile.match(/^description:\s*(.*)$/);
    if (kv) beschreibung = kv[1].trim().replace(/^["']|["']$/g, "");
  }
  return beschreibung ? `${rumpf} ${beschreibung} ${beschreibung} ${beschreibung}` : rumpf;
}

// ───────────────────────────── Cache ─────────────────────────────
const caches = new Map();           // Vault-Pfad → { woerter: Map<Wort, Nr>, docs: Map<rel, Dokument>, eintraege }
const zaehler = { gelesen: 0, suchen: 0, verworfen: 0 };

export function leereMinisucheCache() { caches.clear(); zaehler.gelesen = zaehler.suchen = zaehler.verworfen = 0; }
// Für Tests und Messungen: wie groß der Cache ist und wie viele Dateien seit Prozessstart gelesen wurden.
export function minisucheStand() {
  let dokumente = 0, woerter = 0, eintraege = 0;
  for (const c of caches.values()) { dokumente += c.docs.size; woerter += c.woerter.size; eintraege += c.eintraege; }
  return { vaults: caches.size, dokumente, woerter, eintraege, ...zaehler };
}

// Zerlegt eine Datei in { k, laenge, ids, tfs, frisch }: ids/tfs in der Reihenfolge des ersten Vorkommens des Worts in der Datei.
function indexiere(zustand, f) {
  const tokens = tokenisiere(dokumentText(f.full));
  zaehler.gelesen++;
  const pos = new Map();            // Wort-Nr → Stelle in ids/tfs
  const ids = [], tfs = [];
  for (const t of tokens) {
    let id = zustand.woerter.get(t);
    if (id === undefined) { id = zustand.woerter.size; zustand.woerter.set(t, id); }
    const p = pos.get(id);
    if (p === undefined) { pos.set(id, ids.length); ids.push(id); tfs.push(1); } else tfs[p]++;
  }
  return { k: `${f.mtimeMs}:${f.size}`, laenge: tokens.length, ids: Int32Array.from(ids), tfs: Int32Array.from(tfs), frisch: Date.now() - f.mtimeMs < FRISCH_MS };
}

function aktualisiere(zustand, dateien) {
  const neu = new Map();
  let eintraege = 0;
  for (const f of dateien) {
    const alt = zustand.docs.get(f.rel);
    const d = alt && !alt.frisch && alt.k === `${f.mtimeMs}:${f.size}` ? alt : indexiere(zustand, f);
    neu.set(f.rel, d);
    eintraege += d.ids.length;
  }
  zustand.docs = neu;
  zustand.eintraege = eintraege;
}

function holeZustand(schluessel) {
  let z = caches.get(schluessel);
  if (z) caches.delete(schluessel);   // ans Ende: zuletzt benutzt
  else z = { woerter: new Map(), docs: new Map(), eintraege: 0 };
  caches.set(schluessel, z);
  while (caches.size > MINISUCHE_GRENZEN.vaults) caches.delete(caches.keys().next().value);
  return z;
}

// ───────────────────────────── Suche ─────────────────────────────
export function minisuche(vault, frage, n = 5) {
  const begriffe = [...new Set(tokenisiere(frage))];
  if (!begriffe.length) return [];
  const dateien = walk(vault);
  const schluessel = resolve(vault);
  if (!dateien.length) { caches.delete(schluessel); return []; }

  const z = holeZustand(schluessel);
  aktualisiere(z, dateien);
  zaehler.suchen++;
  if (z.woerter.size > MINISUCHE_GRENZEN.woerter || z.eintraege > MINISUCHE_GRENZEN.eintraege) { caches.delete(schluessel); zaehler.verworfen++; }

  const N = dateien.length;
  const docs = [...z.docs.values()];  // gleiche Reihenfolge wie dateien (walk: sortiert)
  const pfade = [...z.docs.keys()];
  let summe = 0;
  for (const d of docs) summe += d.laenge;
  const avgdl = summe / N || 1;

  // Wort-Nr → Index in begriffe (-1 = kein Suchwort); Wörter, die im Vault nie vorkommen, haben df 0.
  const abbildung = new Int32Array(z.woerter.size).fill(-1);
  begriffe.forEach((b, i) => { const id = z.woerter.get(b); if (id !== undefined) abbildung[id] = i; });
  const df = new Array(begriffe.length).fill(0);
  const mBegriff = [], mTf = [], start = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) {
    start[i] = mBegriff.length;
    const { ids, tfs } = docs[i];
    for (let j = 0; j < ids.length; j++) {
      const q = abbildung[ids[j]];
      if (q >= 0) { mBegriff.push(q); mTf.push(tfs[j]); df[q]++; }
    }
  }
  start[N] = mBegriff.length;
  const idf = begriffe.map((_, i) => Math.log(1 + (N - df[i] + 0.5) / (df[i] + 0.5)));

  const ergebnisse = [];
  for (let i = 0; i < N; i++) {
    let score = 0;
    for (let m = start[i]; m < start[i + 1]; m++) {
      const f = mTf[m];
      const nenner = f + K1 * (1 - B + B * (docs[i].laenge / avgdl));
      score += idf[mBegriff[m]] * (f * (K1 + 1)) / nenner;
    }
    if (score > 0) ergebnisse.push({ pfad: pfade[i].split(sep).join("/"), score });
  }
  ergebnisse.sort((a, b) => b.score - a.score);
  return ergebnisse.slice(0, n);
}
