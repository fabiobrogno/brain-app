// gemeinsam/suchindex.mjs — Volltext-Index der Werkstatt: ein invertierter Index im Speicher, der nie blockiert und sich selbst aktuell hält.
//
// Aufbau
//   · Je Vault ein Index (vault.mjs legt ihn beim ersten Suchen an). Der erste Aufbau läuft in Scheiben von ≈ 6 ms mit setImmediate dazwischen:
//     andere Anfragen (Speichern, Live-Ereignisse) warten höchstens eine Scheibe. Schon während des Aufbaus ist der Index durchsuchbar
//     (neueste Notizen zuerst); die Antwort nennt dann `aufbau: { fertig: false, anteil }`.
//   · Wörter: Unicode-Wörter, klein, ä→ae ö→oe ü→ue ß→ss, sonstige Akzente weg („Müller“ = „Mueller“ = „muller“ nur über Tippfehler-Toleranz).
//     Je Notiz und Wort EIN Eintrag mit gewichteter Häufigkeit: Titel ×8, Alias ×6, Dateiname ×5, Tag ×4, Überschrift ×3, Beschreibung ×2, Pfad ×2, Text ×1.
//   · Einträge liegen in einem Block-Pool aus Int32Array-Seiten (je Block 7 Einträge + Zeiger). Ein Eintrag ist (Notiz-Nr << 8) | gewichtete Häufigkeit.
//     Keine Texte im Speicher: Auszüge entstehen beim Antworten, indem nur die angezeigten Dateien neu gelesen werden (und dabei auf Frische geprüft).
//   · Ändern: eine geänderte Notiz bekommt eine neue Nummer, die alte gilt als tot (Einträge bleiben, werden beim Suchen übersprungen). Wird der tote Anteil
//     groß, baut ein Hintergrundlauf einen frischen Index und tauscht ihn aus.
//   · Aktuell halten: (1) aendere(rel) — eigene Schreibvorgänge und Live-Ereignisse der Werkstatt; (2) pruefeNeu() — Abgleich aller Dateien nach Änderungszeit
//     und Größe (in Scheiben), bei „alles“-Ereignissen, Ordnerwechseln, Git-Wechseln und höchstens alle 30 s beim Suchen; (3) jede angezeigte Datei wird beim Antworten
//     mit dem Stand verglichen — stimmt er nicht, wird sie neu gelesen und die Suche einmal wiederholt.
//
// Suche
//   Gewichtetes BM25 (Wort-Häufigkeit über alle Felder), UND über alle Wörter (findet nichts alle, gilt ODER nach BM25 — je mehr Wörter, desto höher —, markiert als `locker`).
//   Je Wort zählt das Beste aus: genau · Wortanfang (Präfix, Faktor 0,6) · Tippfehler (Damerau-Levenshtein 1–2, Faktor 0,35–0,45; nur wenn es wenige Treffer gibt) · Teilwort (Begriff ≥ 4 Zeichen mitten/am Ende eines Worts: „erklärung“ in „Steuererklärung“; CJK immer; Faktor 0,25).
//   Phrasen "…" werden an den Texten der Kandidaten geprüft. Filter: ordner: typ: tag: status: geaendert:<7d. -wort schließt aus.
//   Antwort: Treffer mit Auszügen (Zeile, Spalte, Markierungen), Gesamtzahl, Seitenweise (offset/limit), Facetten für die Filterchips.
import { readdirSync, statSync, readFileSync, realpathSync, openSync, readSync, closeSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BEARBEITBAR, generiertName, wikiGeneriert, gesperrterName } from "./basis.mjs";
import { parseKopf, ohneMarkdown } from "./notizen.mjs";

const MAX_BYTES = 1024 * 1024;           // größere Dateien: wie bisher nicht durchsucht
const MAX_DOKUMENTE = 150_000;           // Schutz des Speichers (≈ 300 MB bei echten Texten); darüber wird nicht weiter indexiert
const SCHEIBE_MS = 6;                    // so lange arbeitet der Aufbau am Stück
const ABGLEICH_MS = 30_000;              // so selten stößt eine Suche den Abgleich an
const ID_MAX = 4_000_000;                // (Nr << 8) muss in 31 Bit passen
const W = { titel: 8, alias: 6, datei: 5, tag: 4, kopf: 3, beschr: 2, pfad: 2 };
const K1 = 1.2, B = 0.75;
const GEW_PRAEFIX = 0.6, GEW_FUZZY = [0, 0.45, 0.35];
const WORT_MAX = 40;
const FUZZY_SCHWELLE = 3;                // Tippfehler-Suche nur, wenn genau + Wortanfang weniger Notizen treffen
const MAX_TERME = 12, MAX_PRAEFIX = 40, MAX_FUZZY = 20, PRUEF_MAX = 400, PRUEF_MS = 80, BONUS_N = 300;
const AUSZUG_BYTES = 64 * 1024;          // ein Auszug wird höchstens aus den ersten 64 KB einer Datei gesucht (nie die ganze Datei lesen)
const PHRASE_BYTES = 192 * 1024;         // die Phrasenprüfung liest etwas mehr, bricht aber mit der Zeit ab
const AUSZUG_MS = 60;                    // Zeitbudget für alle Auszüge einer Antwort; danach nur noch die erste Zeile je Treffer
const OFFSET_MAX = 2000;                 // tiefer blättert die Suche nicht (dann mehr = false)
const GEW_TEIL = 0.25, MAX_TEIL = 40;    // Teilwort-Suche (Teil eines längeren Worts: „erklärung“ in „Steuererklärung“)
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
const VERZ_STUECK = 100;                 // beim Ordnerlauf alle so viele Dateien an die Scheibe zurückgeben
const BLOCK_BITS = 14, BLOCK_INTS = 8;   // 16.384 Blöcke je Seite

// ───────────────────────────── Wörter ─────────────────────────────
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu; // \p{M}: Akzent als eigenes Zeichen (NFD „Mu\u0308ller“) gehört zum Wort
const NUR_ASCII = /^[\x00-\x7f]*$/;
const SONDER = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ł": "l", "ı": "i" };
const faltZeichen = new Map();
function falteNichtAscii(s) {
  return s.replace(/[^\x00-\x7f]/g, (c) => {
    let r = SONDER[c];
    if (r !== undefined) return r;
    r = faltZeichen.get(c);
    if (r === undefined) { r = c.normalize("NFD").replace(/[̀-ͯ]/g, ""); if (faltZeichen.size < 5000) faltZeichen.set(c, r); }
    return r;
  });
}
// Klein, Umlaute/ß aufgelöst, Akzente weg. Gilt für den Index und für jede Frage gleich.
export function falteText(s) {
  s = String(s);
  if (/[̀-ͯ]/.test(s)) s = s.normalize("NFC");
  s = s.toLowerCase();
  return NUR_ASCII.test(s) ? s : falteNichtAscii(s);
}
export function tokenisiere(s) { return falteText(s).match(TOKEN) || []; }

// ───────────────────────────── Frage lesen ─────────────────────────────
const FILTER_NAMEN = { ordner: "ordner", folder: "ordner", ort: "ordner", typ: "typ", type: "typ", tag: "tag", tags: "tag", status: "status", geaendert: "geaendert", modified: "geaendert", alter: "geaendert" };
export const FILTER_SCHLUESSEL = ["ordner", "typ", "tag", "status", "geaendert"];
const FRAGE_MUSTER = /(-?)(?:([\p{L}]+):(?=\S))?(?:"([^"]*)(?:"|$)|([^\s"]+))/gu;

// → { terme: [{ token, pflicht, phrase }], phrasen: [[token…]], ausschluss: [token], filter: [{ schluessel, wert, roh, neg }], rest }
export function parseFrage(roh) {
  const s = String(roh ?? "").slice(0, 500);
  const terme = [], phrasen = [], ausschluss = [], filter = [], rest = [];
  const gesehen = new Set();
  const nimm = (token, pflicht, phrase) => { const k = (pflicht ? "!" : "") + token; if (gesehen.has(k) || terme.length >= MAX_TERME) return; gesehen.add(k); terme.push({ token, pflicht, phrase }); };
  for (const m of s.matchAll(FRAGE_MUSTER)) {
    const neg = m[1] === "-", schluessel = m[2] ? FILTER_NAMEN[falteText(m[2])] : undefined;
    const wert = m[3] !== undefined ? m[3] : m[4];
    if (schluessel) { if (String(wert).trim()) filter.push({ schluessel, wert: String(wert).trim(), roh: m[0], neg }); continue; }
    const text = (m[2] && m[3] === undefined ? m[2] + ":" : "") + wert;
    const tokens = tokenisiere(text).filter((t) => t.length <= WORT_MAX);
    if (!tokens.length) continue;
    rest.push(m[0]);
    if (neg) { if (m[3] === undefined || tokens.length === 1) for (const t of tokens) if (!ausschluss.includes(t)) ausschluss.push(t); continue; } // -"a b" (Phrase ausschließen) gibt es nicht: nie jede Notiz mit a ODER b ausschließen
    if (m[3] !== undefined && tokens.length > 1) { phrasen.push(tokens); for (const t of tokens) nimm(t, true, true); }
    else for (const t of tokens) nimm(t, false, false);
  }
  return { terme, phrasen, ausschluss, filter, rest: rest.join(" ") };
}

// geaendert-Wert → { von, bis } in ms (Änderungszeit muss in [von, bis) liegen) oder null
const EINHEIT_MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 };
function zeitBereich(wert, jetzt) {
  const w = falteText(wert).trim();
  let m;
  if (w === "heute") { const d = new Date(jetzt); d.setHours(0, 0, 0, 0); return { von: d.getTime(), bis: Infinity }; }
  if (w === "woche") return { von: jetzt - EINHEIT_MS.w, bis: Infinity };
  if (w === "monat") return { von: jetzt - EINHEIT_MS.m, bis: Infinity };
  if ((m = /^([<>]=?)?(\d{1,4})([hdwmy])$/.exec(w))) {
    const grenze = jetzt - Number(m[2]) * EINHEIT_MS[m[3]];
    return m[1] && m[1][0] === ">" ? { von: -Infinity, bis: grenze } : { von: grenze, bis: Infinity }; // <7d = jünger als 7 Tage, >30d = älter als 30 Tage
  }
  if ((m = /^([<>]=?)?(\d{4})-(\d\d)-(\d\d)$/.exec(w))) {
    const tag = Date.UTC(+m[2], +m[3] - 1, +m[4]);
    if (Number.isNaN(tag)) return null;
    if (!m[1]) return { von: tag, bis: tag + 86400e3 };
    const op = m[1];
    if (op === ">") return { von: tag + 86400e3, bis: Infinity };
    if (op === ">=") return { von: tag, bis: Infinity };
    if (op === "<") return { von: -Infinity, bis: tag };
    return { von: -Infinity, bis: tag + 86400e3 };
  }
  return null;
}

// ───────────────────────────── Tippfehler ─────────────────────────────
const popcount = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
function buchstabenMaske(w) {
  let m = 0;
  for (let i = 0; i < w.length; i++) { const c = w.charCodeAt(i); m |= 1 << (c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? 26 + ((c - 48) % 5) : 31); }
  return m;
}
// Damerau-Levenshtein (Vertauschung zählt 1), abgebrochen ab `max`; → Abstand oder max + 1
function abstand(a, b, max) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let vorvor = null, vor = new Array(m + 1), jetzt = new Array(m + 1);
  for (let j = 0; j <= m; j++) vor[j] = j;
  for (let i = 1; i <= n; i++) {
    jetzt[0] = i;
    let kleinste = i;
    for (let j = 1; j <= m; j++) {
      const kosten = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(vor[j] + 1, jetzt[j - 1] + 1, vor[j - 1] + kosten);
      if (vorvor && i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, vorvor[j - 2] + 1);
      jetzt[j] = v;
      if (v < kleinste) kleinste = v;
    }
    if (kleinste > max) return max + 1;
    vorvor = vor; vor = jetzt; jetzt = new Array(m + 1);
  }
  return vor[m];
}

// ───────────────────────────── Eine Datei auswerten ─────────────────────────────
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// Überschrift „## Text ##“ → [zeile, "##", "Text"] oder null. Ohne Regex mit Rückverfolgung: eine Zeile mit tausend Leerzeichen darf die Werkstatt nicht festhalten.
const UEBERSCHRIFT = { exec(z) {
  if (z.length > 600 || z.charCodeAt(0) !== 35) return null;
  let n = 0;
  while (n < z.length && z.charCodeAt(n) === 35) n++;
  if (n > 6) return null;
  const c = z.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let t = z.slice(n).trim();
  while (t.endsWith("#")) t = t.slice(0, -1);
  t = t.trim();
  return t ? [z, "#".repeat(n), t] : null;
} };
const TAG_MUSTER = /(?:^|[\s(,;])#([\p{L}_][\p{L}\p{N}_\/-]*)/gu;
const erster = (v) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const alsListe = (...vs) => vs.flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : [])).map((s) => String(s).trim().replace(/^#/, "")).filter(Boolean);

function nachZeilen(text, n) { // Text hinter den ersten n Zeilen
  let pos = 0;
  for (let i = 0; i < n; i++) { const p = text.indexOf("\n", pos); if (p < 0) return ""; pos = p + 1; }
  return text.slice(pos);
}

// → Dokumentsatz (ohne Nr/Änderungszeit) und Wortzählung. Rein, ohne Plattenzugriff.
export function analysiere(rel, textRoh) {
  const text = textRoh.charCodeAt(0) === 0xfeff ? textRoh.slice(1) : textRoh;
  let felder = {}, koerper = text;
  if (text.startsWith("---")) {
    const k = parseKopf(text.length > 20000 ? text.slice(0, 20000) : text);
    if (k.bis) { felder = k.felder; koerper = nachZeilen(text, k.bis); }
  }
  const fl = {};
  for (const [s, v] of Object.entries(felder)) fl[falteText(s)] = v;

  const zaehl = new Map();
  const plus = (s, gewicht) => { for (const t of tokenisiere(s)) if (t.length <= WORT_MAX) zaehl.set(t, (zaehl.get(t) || 0) + gewicht); };

  let h1 = null, offen = null;
  const tags = new Set();
  for (const zl of koerper.split("\n")) {
    const f = FENCE.exec(zl);
    if (offen) { if (f && f[1][0] === offen.z && f[1].length >= offen.n && !zl.slice(f[0].length).trim()) offen = null; continue; }
    if (f) { offen = { z: f[1][0], n: f[1].length }; continue; }
    if (zl.charCodeAt(0) === 35) {
      const m = UEBERSCHRIFT.exec(zl.endsWith("\r") ? zl.slice(0, -1) : zl);
      if (m) { if (h1 === null && m[1].length === 1) h1 = m[2]; plus(m[2], W.kopf); continue; }
    }
    if (zl.includes("#")) for (const m of zl.matchAll(TAG_MUSTER)) if (!/^\d+$/.test(m[1])) tags.add(m[1]);
  }
  for (const t of alsListe(fl.tags, fl.tag, fl.schlagworte, fl.keywords)) tags.add(t);

  const stamm = rel.split("/").pop().replace(/\.(md|txt)$/i, "");
  const feldTitel = String(erster(fl.title) || erster(fl.titel) || erster(fl.name) || "");
  const titel = (h1 !== null && ohneMarkdown(h1.slice(0, 500))) || ohneMarkdown(feldTitel.slice(0, 500)) || stamm;
  const aliasse = alsListe(fl.aliases, fl.alias, fl.auch_genannt).map((a) => ohneMarkdown(a)).filter(Boolean);
  const beschr = String(erster(fl.description) || erster(fl.beschreibung) || "");
  const typ = ohneMarkdown(String(erster(fl.typ) || erster(fl.type) || "")).toLowerCase().trim();
  const status = String(erster(fl.status)).trim().toLowerCase();

  const koerperTokens = tokenisiere(koerper);
  let laenge = 0;
  for (const t of koerperTokens) if (t.length <= WORT_MAX) { zaehl.set(t, (zaehl.get(t) || 0) + 1); laenge++; }
  plus(titel, W.titel);
  if (feldTitel && ohneMarkdown(feldTitel) !== titel) plus(feldTitel, W.titel);
  for (const a of aliasse) plus(a, W.alias);
  plus(stamm, W.datei);
  plus(rel.replace(/\.(md|txt)$/i, ""), W.pfad);
  for (const t of tags) plus(t, W.tag);
  if (beschr) plus(beschr, W.beschr);

  const teile = rel.split("/");
  const ordner = teile.slice(0, -1).join("/");
  const tagListe = [...tags].slice(0, 30).map((t) => t.toLowerCase());
  return {
    doc: {
      titel, titelF: falteText(titel), aliasF: aliasse.map(falteText), typ, typF: falteText(typ), status, statusF: falteText(status),
      tags: tagListe, tagsF: tagListe.map(falteText), ordnerF: falteText(ordner), ordner0: teile.length > 1 ? teile[0] : "", segF: null, laenge,
    },
    zaehl,
  };
}

// Liest höchstens die ersten `max` Bytes einer Datei als Text (nie eine ganze Riesendatei); ein abgeschnittenes letztes Zeichen fällt weg. Fehler → null
const LESEPUFFER = Buffer.allocUnsafe(PHRASE_BYTES); // ein Puffer für alle Lesevorgänge (synchron, nie gleichzeitig benutzt)
function liesAnfang(abs, max) {
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = LESEPUFFER;
    let n = 0;
    while (n < max) { const r = readSync(fd, buf, n, max - n, n); if (r <= 0) break; n += r; }
    let t = buf.toString("utf8", 0, n);
    if (n === max && t.endsWith("\ufffd")) t = t.slice(0, -1);
    return t;
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}

// ───────────────────────────── Zustand: Wörterbuch, Einträge, Notizen ─────────────────────────────
function waechst(a, n, Typ) { if (n <= a.length) return a; const neu = new Typ(Math.max(n, a.length * 2, 64)); neu.set(a); return neu; }

const TOT = Object.freeze({ tot: true, rel: "", mtimeMs: -1, groesse: -1 });

class Zustand {
  constructor() {
    this.vok = new Map(); this.liste = []; this.praefix = new Map();
    this.df = new Int32Array(1024); this.kopf = new Int32Array(1024); this.ende = new Int32Array(1024); this.fuell = new Uint8Array(1024);
    this.maske = new Int32Array(1024); this.wlen = new Uint8Array(1024);
    this.seiten = []; this.nBloecke = 1; // Block 0 = „keiner“
    this.docs = []; this.lebt = new Uint8Array(1024); this.laenge = new Int32Array(1024);
    this.nachKey = new Map(); this.nLebend = 0; this.summe = 0; this.tot = 0; this.aufgegeben = false;
  }
  wortNr(w) {
    let id = this.vok.get(w);
    if (id !== undefined) return id;
    id = this.liste.length;
    this.vok.set(w, id); this.liste.push(w);
    if (id >= this.df.length) {
      const n = id + 1;
      this.df = waechst(this.df, n, Int32Array); this.kopf = waechst(this.kopf, n, Int32Array); this.ende = waechst(this.ende, n, Int32Array);
      this.fuell = waechst(this.fuell, n, Uint8Array); this.maske = waechst(this.maske, n, Int32Array); this.wlen = waechst(this.wlen, n, Uint8Array);
    }
    this.maske[id] = buchstabenMaske(w); this.wlen[id] = Math.min(255, w.length);
    if (w.length >= 3) { const k = w.slice(0, 2); const l = this.praefix.get(k); if (l) l.push(id); else this.praefix.set(k, [id]); }
    return id;
  }
  neuerBlock() {
    const nr = this.nBloecke++;
    const s = nr >> BLOCK_BITS;
    if (!this.seiten[s]) this.seiten[s] = new Int32Array((1 << BLOCK_BITS) * BLOCK_INTS);
    return nr;
  }
  haengeAn(id, wert) {
    let b = this.ende[id];
    if (b === 0) { b = this.neuerBlock(); this.kopf[id] = b; this.ende[id] = b; this.fuell[id] = 0; }
    else if (this.fuell[id] === 7) {
      const n = this.neuerBlock();
      this.seiten[b >> BLOCK_BITS][(b & ((1 << BLOCK_BITS) - 1)) * BLOCK_INTS + 7] = n;
      this.ende[id] = b = n; this.fuell[id] = 0;
    }
    this.seiten[b >> BLOCK_BITS][(b & ((1 << BLOCK_BITS) - 1)) * BLOCK_INTS + this.fuell[id]++] = wert;
    this.df[id]++;
  }
  // Ruft f(eintrag) für jeden Eintrag des Worts
  fuerEintraege(id, f) {
    let b = this.kopf[id];
    const maskeB = (1 << BLOCK_BITS) - 1;
    while (b !== 0) {
      const seite = this.seiten[b >> BLOCK_BITS], basis = (b & maskeB) * BLOCK_INTS;
      const n = b === this.ende[id] ? this.fuell[id] : 7;
      for (let i = 0; i < n; i++) f(seite[basis + i]);
      b = seite[basis + 7];
    }
  }
  // Anzahl lebender Notizen mit dem Wort (df zählt tote Einträge mit; ohne Tote ist es dasselbe)
  dfLebend(id) {
    if (this.tot === 0) return this.df[id];
    let n = 0;
    this.fuerEintraege(id, (e) => { if (this.lebt[e >>> 8]) n++; });
    return n;
  }
  fuegeEin(key, rel, st, a) {
    const alt = this.nachKey.get(key);
    if (alt !== undefined) this.entferne(key);
    const nr = this.docs.length;
    if (nr >= ID_MAX) { this.aufgegeben = true; return false; }
    this.docs.push({ ...a.doc, rel, mtimeMs: st.mtimeMs, groesse: st.size, nr });
    if (nr >= this.lebt.length) { this.lebt = waechst(this.lebt, nr + 1, Uint8Array); this.laenge = waechst(this.laenge, nr + 1, Int32Array); }
    this.lebt[nr] = 1; this.laenge[nr] = a.doc.laenge;
    for (const [w, c] of a.zaehl) this.haengeAn(this.wortNr(w), (nr << 8) | (c > 255 ? 255 : c));
    this.nachKey.set(key, nr); this.nLebend++; this.summe += a.doc.laenge;
    return true;
  }
  entferne(key) {
    const nr = this.nachKey.get(key);
    if (nr === undefined) return;
    this.nachKey.delete(key);
    this.lebt[nr] = 0; this.nLebend--; this.summe -= this.laenge[nr]; this.tot++;
    this.docs[nr] = TOT;
  }
}

// ───────────────────────────── Der Index ─────────────────────────────
const keyVon = (rel) => rel.normalize("NFC");

// o: { wurzel, unterVault(abs) → bool (Ordner mit eigener brain.config.json, den eine KI nicht sieht), jetzt() , tot (Schwelle für den Neubau) }
export function erzeugeSuchindex(o) {
  const wurzel = o.wurzel;
  const jetztMs = o.jetzt || (() => Date.now());
  const maxDok = o.maxDokumente ?? MAX_DOKUMENTE;
  // Tote Einträge verzerren die Wort-Häufigkeiten (df) leicht; ab einem Viertel der Notizen (mindestens 200) baut ein Hintergrundlauf einen frischen Index.
  const totGrenze = () => o.totSchwelle ?? Math.max(200, Math.floor(z.nLebend * 0.25));
  let z = new Zustand();
  let gestartet = false, fertig = false, abgebrochen = false;
  let bauStart = 0, bauZeit = 0, anteil = 0, entdeckt = 0, letzterAbgleich = 0, neubau = null;
  const schmutzig = new Set();
  const aufgaben = []; // Erzeuger (Generatoren), die in Scheiben laufen
  let laeuft = null, geplant = false, nochAbgleich = false, abgleichOffen = false, leerenGeplant = false;
  let scratch = { punkte: new Float32Array(1024), bester: new Float32Array(1024), maske: new Uint16Array(1024), aus: new Uint8Array(1024) };

  // ----- Welche Dateien gehören hinein (wie die bisherige Suche: kein Versteckter Ordner, keine generierte Datei, kein Unter-Vault, ≤ 1 MB) -----
  const dateiOk = (rel, name) => BEARBEITBAR.test(name) && !generiertName(name) && !wikiGeneriert(rel, name);
  function pfadOk(rel) {
    const teile = rel.split("/");
    if (!teile.length || teile.some((t) => !t || t === ".." || gesperrterName(t))) return false;
    if (!dateiOk(rel, teile[teile.length - 1])) return false;
    if (o.unterVault) { let p = wurzel; for (const t of teile.slice(0, -1)) { p = join(p, t); try { if (o.unterVault(p)) return false; } catch { /* egal */ } } }
    return true;
  }

  const istUnter = (rel) => { if (!o.unterVault) return false; try { return !!o.unterVault(join(wurzel, rel)); } catch { return false; } };

  // ----- Scheiben -----
  function plane() { if (geplant) return; geplant = true; setImmediate(takt); }
  function takt() {
    geplant = false;
    if (!laeuft) { laeuft = aufgaben.shift() || null; if (!laeuft) return; }
    const t = performance.now();
    try {
      while (performance.now() - t < SCHEIBE_MS) {
        const r = laeuft.gen.next();
        if (r.done) { const l = laeuft; laeuft = null; try { l.ende?.(); } catch { /* egal */ } if (aufgaben.length) plane(); return; }
      }
    } catch { const l = laeuft; laeuft = null; try { l.ende?.(true); } catch { /* egal */ } }
    plane();
  }
  const einreihen = (gen, ende) => { aufgaben.push({ gen, ende }); plane(); };

  function* verzeichnisse(ziel) { // → entdeckte Dateien { rel, abs, st } (in Scheiben je Ordner)
    const aus = [];
    const stapel = [""];
    let wurzelOk = true;
    while (stapel.length) {
      const relOrdner = stapel.pop();
      let liste;
      try { liste = readdirSync(relOrdner ? join(wurzel, relOrdner) : wurzel, { withFileTypes: true }); } catch { if (!relOrdner) wurzelOk = false; continue; }
      let seit = 0;
      for (const d of liste) {
        if (++seit % VERZ_STUECK === 0) { entdeckt = aus.length; yield; } // auch ein flacher Ordner mit 20.000 Notizen hält die Schleife nie lange fest
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!istUnter(rel)) stapel.push(rel); }
        else if (d.isFile() && dateiOk(rel, d.name)) {
          let st; try { st = statSync(join(wurzel, rel)); } catch { continue; }
          if (st.size <= MAX_BYTES) aus.push({ rel, st });
        }
      }
      entdeckt = aus.length;
      yield;
    }
    ziel.dateien = aus; ziel.wurzelOk = wurzelOk;
  }

  // Liest und indexiert eine Datei in den Zustand zz. → true, wenn sie jetzt drin ist
  function indexiere(zz, rel, st) {
    let text;
    try { text = readFileSync(join(wurzel, rel), "utf8"); } catch { zz.entferne(keyVon(rel)); return false; }
    if (zz.nLebend >= maxDok && !zz.nachKey.has(keyVon(rel))) { zz.aufgegeben = true; return false; } // bekannte Notizen dürfen sich weiter ändern
    return zz.fuegeEin(keyVon(rel), rel, st, analysiere(rel, text));
  }

  // Abgleich oder Aufbau: Verzeichnislauf, dann alles Neue/Geänderte lesen, am Ende Verschwundenes entfernen. zz: Ziel-Zustand.
  function* abgleichen(zz, istAufbau) {
    const ziel = {};
    yield* verzeichnisse(ziel);
    if (!ziel.wurzelOk) return;
    const dateien = ziel.dateien;
    if (istAufbau) dateien.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs); // Neueste zuerst: früh schon brauchbare Treffer
    const gesehen = new Set();
    let i = 0;
    for (const { rel, st } of dateien) {
      const key = keyVon(rel);
      gesehen.add(key);
      const nr = zz.nachKey.get(key);
      const bekannt = nr !== undefined ? zz.docs[nr] : null;
      if (!bekannt || bekannt.mtimeMs !== st.mtimeMs || bekannt.groesse !== st.size) indexiere(zz, rel, st);
      if (istAufbau) anteil = ++i / (dateien.length || 1);
      yield;
    }
    for (const [key, nr] of [...zz.nachKey]) { // Verschwundenes: nur, wenn es die Datei wirklich nicht mehr gibt (eine neue könnte nach dem Lauf entstanden sein)
      if (gesehen.has(key)) continue;
      const d = zz.docs[nr];
      let weg = false; try { const st = statSync(join(wurzel, d.rel)); if (!st.isFile() || st.size > MAX_BYTES) weg = true; } catch { weg = true; } // auch: über 1 MB gewachsen
      if (weg) zz.entferne(key);
      yield;
    }
  }

  function starte() {
    if (gestartet) return;
    gestartet = true; bauStart = performance.now(); letzterAbgleich = jetztMs();
    einreihen(abgleichen(z, true), () => { fertig = true; anteil = 1; bauZeit = performance.now() - bauStart; nochmalPruefen(); });
  }
  function nochmalPruefen() { if (nochAbgleich) { nochAbgleich = false; pruefeNeu(); } }

  // Alle Dateien nach Änderungszeit und Größe abgleichen (in Scheiben). Läuft schon einer, folgt genau ein weiterer.
  function pruefeNeu() {
    if (!gestartet) return;
    if (!fertig || neubau) { nochAbgleich = true; return; }
    letzterAbgleich = jetztMs();
    if (abgleichOffen) { nochAbgleich = true; return; } // genau ein weiterer folgt, sobald der laufende fertig ist
    abgleichOffen = true;
    const zz = z;
    einreihen(abgleichen(zz, false), () => { abgleichOffen = false; if (z === zz) pruefeTot(); nochmalPruefen(); });
  }
  // Zu viele tote Notizen: frischen Index im Hintergrund bauen und tauschen (Suchen läuft währenddessen auf dem alten weiter)
  function pruefeTot() {
    if (neubau || !(z.tot >= totGrenze() || z.docs.length > ID_MAX * 0.8)) return;
    const frisch = new Zustand();
    neubau = frisch;
    // Was sich während des Neubaus ändert, hat der frische Index vielleicht schon (alt) gelesen: nach dem Tausch folgt ein Abgleich
    einreihen(abgleichen(frisch, true), (fehler) => { const gebaut = neubau === frisch; if (gebaut && !fehler) { z = frisch; nochAbgleich = true; } if (gebaut) neubau = null; nochmalPruefen(); });
  }

  // Einzelne Dateien neu lesen (eigene Schreibvorgänge, Live-Ereignisse)
  function aendere(rels) {
    if (!gestartet) return; // der erste Aufbau liest ohnehin den aktuellen Stand
    for (const r of [].concat(rels)) if (typeof r === "string" && r && BEARBEITBAR.test(r)) schmutzig.add(r);
    if (schmutzig.size && !leerenGeplant) {
      leerenGeplant = true;
      einreihen((function* () { while (schmutzig.size) { leere(20); yield; } })(), () => { leerenGeplant = false; });
    }
  }
  function leere(max = 50) {
    let n = 0;
    for (const rel of schmutzig) {
      if (n++ >= max) break;
      schmutzig.delete(rel);
      aktualisiereDatei(rel);
    }
    if (schmutzig.size > 500) { schmutzig.clear(); pruefeNeu(); } // Flut: besser alles abgleichen
  }
  function aktualisiereDatei(rel, zz = z) {
    const key = keyVon(rel);
    const nr = zz.nachKey.get(key);
    const bekannt = nr !== undefined ? zz.docs[nr].rel : rel;
    const weg = () => { zz.entferne(key); if (bekannt !== rel) zz.entferne(keyVon(bekannt)); };
    if (!pfadOk(rel)) { weg(); return; }
    // Die Datei muss wirklich hier im Vault liegen: kein Verweis (Symlink) aus dem Vault heraus oder auf eine andere Datei (auch nicht über einen Elternordner).
    // realpath liefert zugleich die Schreibweise auf der Platte (Groß/klein, APFS): so gibt es eine Datei nie doppelt.
    let echtAbs, st;
    try { echtAbs = realpathSync.native(join(wurzel, rel)); st = statSync(echtAbs); if (!st.isFile()) throw 0; } catch { weg(); return; }
    const echt = relative(wurzel, echtAbs).split(sep).join("/");
    if (!echt || echt.startsWith("..") || echt.normalize("NFC").toLowerCase() !== rel.normalize("NFC").toLowerCase() || !pfadOk(echt)) { weg(); return; }
    if (st.size > MAX_BYTES) { weg(); zz.entferne(keyVon(echt)); return; }
    if (echt !== rel) zz.entferne(key);
    indexiere(zz, echt, st);
    if (zz === z && !neubau && z.tot >= totGrenze()) pruefeTot();
  }

  // ----- Suche -----
  function sichern(n) {
    if (n <= scratch.punkte.length) return;
    const m = Math.max(n, scratch.punkte.length * 2);
    scratch = { punkte: new Float32Array(m), bester: new Float32Array(m), maske: new Uint16Array(m), aus: new Uint8Array(m) };
  }

  // Alternativen eines Worts: genau · Wortanfang · Tippfehler
  function erweitere(token, nurGenau, ohneFuzzy = false) {
    const alts = [];
    const exakt = z.vok.get(token);
    let abgedeckt = 0;
    if (exakt !== undefined) { const n = z.dfLebend(exakt); if (n > 0) { alts.push({ id: exakt, gew: 1 }); abgedeckt += n; } }
    if (nurGenau) return alts;
    const L = token.length;
    if (L >= 3) {
      const kand = (z.praefix.get(token.slice(0, 2)) || []).filter((id) => id !== exakt && z.df[id] > 0 && z.liste[id].startsWith(token));
      kand.sort((a, b) => z.df[b] - z.df[a]);
      for (const id of kand.slice(0, MAX_PRAEFIX)) { const n = z.dfLebend(id); if (n > 0) { alts.push({ id, gew: GEW_PRAEFIX }); abgedeckt += n; } }
    }
    // Teilwörter: wenige Treffer → Wörter, die den Begriff in der Mitte oder am Ende enthalten („erklaerung“ in „steuererklaerung“, „name“ in „username“).
    // CJK hat keine Wortgrenzen (eine Zeichenfolge ist EIN Wort): dort immer, auch bei kurzen Begriffen.
    const cjk = CJK.test(token);
    if (!ohneFuzzy && (cjk ? L >= 1 : L >= 4) && (cjk || abgedeckt < FUZZY_SCHWELLE)) {
      const schon = new Set(alts.map((a) => a.id));
      const gefunden = [];
      for (let id = 0, n = z.liste.length; id < n; id++) {
        if (z.df[id] === 0 || schon.has(id)) continue;
        const w = z.liste[id];
        if (w.length > L && w.includes(token)) gefunden.push(id);
      }
      gefunden.sort((a, b) => z.df[b] - z.df[a]);
      for (const id of gefunden.slice(0, MAX_TEIL)) { const n = z.dfLebend(id); if (n > 0) { alts.push({ id, gew: GEW_TEIL }); abgedeckt += n; } }
    }
    if (L >= 4 && !ohneFuzzy && abgedeckt < FUZZY_SCHWELLE && !/\d/.test(token)) {
      const d = L <= 6 ? 1 : 2, qm = buchstabenMaske(token), n = z.liste.length;
      const gefunden = [];
      for (let id = 0; id < n; id++) {
        if (id === exakt || z.df[id] === 0) continue;
        const dl = z.wlen[id] - L;
        if (dl > d || dl < -d) continue;
        if (popcount(z.maske[id] ^ qm) > 2 * d) continue;
        const ab = abstand(token, z.liste[id], d);
        if (ab <= d && ab >= 1) gefunden.push({ id, ab });
      }
      gefunden.sort((a, b) => a.ab - b.ab || z.df[b.id] - z.df[a.id]);
      for (const g of gefunden.slice(0, MAX_FUZZY)) alts.push({ id: g.id, gew: GEW_FUZZY[g.ab] });
    }
    return alts;
  }

  const zeitFilter = (f, jetzt) => zeitBereich(f.wert, jetzt);
  function baueFilter(filter, jetzt) {
    const gruppen = new Map(); // Schlüssel → { bit, pos: [test], neg: [test] }
    const ungueltig = [];
    for (const f of filter) {
      const wF = falteText(f.wert).replace(/^#/, "").trim();
      let test;
      if (f.schluessel === "ordner") {
        const v = wF.replace(/^\/+|\/+$/g, "");
        test = (d) => {
          if (!v) return true;
          if (v.includes("/")) return d.ordnerF === v || d.ordnerF.startsWith(v + "/") || ("/" + d.ordnerF + "/").includes("/" + v + "/");
          const segs = d.segF || (d.segF = d.ordnerF ? d.ordnerF.split("/") : []);
          return segs.some((s) => s === v || s.replace(/^[\d]+[_\-\s]*/, "") === v || (v.length >= 3 && s.startsWith(v)));
        };
      } else if (f.schluessel === "typ") test = (d) => d.typF === wF || (wF === "-" && !d.typF);
      else if (f.schluessel === "status") test = (d) => d.statusF === wF;
      else if (f.schluessel === "tag") test = (d) => d.tagsF.some((t) => t === wF || t.startsWith(wF + "/"));
      else {
        const b = zeitFilter(f, jetzt);
        if (!b) { ungueltig.push(f); continue; }
        test = (d) => d.mtimeMs >= b.von && d.mtimeMs < b.bis;
      }
      let g = gruppen.get(f.schluessel);
      if (!g) { g = { schluessel: f.schluessel, bit: 1 << gruppen.size, pos: [], neg: [] }; gruppen.set(f.schluessel, g); }
      (f.neg ? g.neg : g.pos).push(test);
    }
    const liste = [...gruppen.values()];
    const voll = liste.reduce((s, g) => s | g.bit, 0);
    const maskeVon = (d) => {
      let m = 0;
      for (const g of liste) if ((!g.pos.length || g.pos.some((t) => t(d))) && !g.neg.some((t) => t(d))) m |= g.bit;
      return m;
    };
    return { liste, voll, maskeVon, ungueltig };
  }

  function suche(opt = {}) {
    const t0 = performance.now();
    starte();
    leere(50);
    if (letzterAbgleich + ABGLEICH_MS < jetztMs() && fertig) pruefeNeu();
    // Veraltete Treffer (extern geändert/gelöscht) werden beim Antworten erkannt und aus dem Index genommen; dann wird neu gerechnet, bis die Seite stimmt (höchstens 3 Runden,
    // die letzte lässt Veraltetes einfach weg und zählt es von `gesamt` ab).
    let erg;
    for (let runde = 0; runde < 3; runde++) { erg = sucheEinmal(opt); if (!erg.veraltet) break; }
    if (erg.veraltet) erg = sucheEinmal(opt, true);
    erg.dauerMs = Math.round((performance.now() - t0) * 10) / 10;
    return erg;
  }

  function sucheEinmal(opt, zweiter = false) {
    const jetzt = opt.jetzt ?? jetztMs();
    const limit = Math.min(50, Math.max(1, Number.parseInt(opt.limit, 10) || 30));
    const offsetRoh = Math.max(0, Number.parseInt(opt.offset, 10) || 0);
    const offset = Math.min(OFFSET_MAX, offsetRoh);
    const q = parseFrage(opt.q);
    const ff = baueFilter(q.filter, jetzt);
    const aufbau = { fertig, anteil: Math.round(anteil * 1000) / 1000, dokumente: z.nLebend, entdeckt, ...(z.aufgegeben ? { abgeschnitten: true } : {}) };
    const antwort = (extra) => ({ treffer: [], gesamt: 0, gesamtGenau: true, offset, limit, mehr: false, aufbau, frage: q.rest, filter: q.filter.map((f) => ({ schluessel: f.schluessel, wert: f.wert, roh: f.roh, neg: f.neg, gueltig: !ff.ungueltig.includes(f) })), begriffe: [], markieren: [], facetten: null, locker: null, ...extra });
    const filterAktiv = ff.liste.length > 0;
    if ((!q.terme.length && !filterAktiv) || offsetRoh > OFFSET_MAX) return antwort({}); // tiefer als OFFSET_MAX: leer, mehr = false (nie dieselbe Seite wiederholen)

    const docs = z.docs, N = Math.max(1, z.nLebend), avg = z.summe / N || 1;
    sichern(docs.length + 1);
    const { punkte, bester, maske, aus } = scratch;
    const beruehrt = [], ausgeschlossen = [];
    try { return rechne(); } finally { // Arbeitsfelder immer zurücksetzen (auch bei einem Fehler)
      for (const d of beruehrt) { punkte[d] = 0; maske[d] = 0; bester[d] = 0; }
      for (const d of ausgeschlossen) aus[d] = 0;
    }

    function rechne() {
    const plain = [];
    let pflicht = 0, plainMaske = 0;
    const termInfo = [];
    q.terme.forEach((t, i) => {
      const alts = erweitere(t.token, t.pflicht, i >= 4); // Tippfehler-Suche (läuft über das ganze Wörterbuch) nur für die ersten vier Wörter
      termInfo.push({ t, alts });
      if (t.pflicht) pflicht |= 1 << i; else { plainMaske |= 1 << i; plain.push(i); }
    });
    const markiere = new Map(); // konkretes Wort → Maske der Fragewörter
    const begriffe = [];
    termInfo.forEach(({ t, alts }, i) => {
      begriffe.push(t.token);
      for (const a of alts) { const w = z.liste[a.id]; markiere.set(w, (markiere.get(w) || 0) | (1 << i)); }
      if (!alts.length) markiere.set(t.token, (markiere.get(t.token) || 0) | (1 << i));
    });

    // Punkte sammeln: je Fragewort zählt je Notiz die beste Alternative
    const lokal = [];
    termInfo.forEach(({ alts }, i) => {
      for (const a of alts) {
        const df = z.dfLebend(a.id), idf = Math.log(1 + (Math.max(N, df) - df + 0.5) / (df + 0.5)) * a.gew;
        z.fuerEintraege(a.id, (e) => {
          const d = e >>> 8;
          if (!z.lebt[d]) return;
          const f = e & 255;
          const s = idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (z.laenge[d] / avg)));
          if (s > bester[d]) { if (bester[d] === 0) lokal.push(d); bester[d] = s; }
        });
      }
      for (const d of lokal) { if (maske[d] === 0) beruehrt.push(d); maske[d] |= 1 << i; punkte[d] += bester[d]; bester[d] = 0; }
      lokal.length = 0;
    });
    for (const w of q.ausschluss) {
      const id = z.vok.get(w);
      if (id !== undefined) z.fuerEintraege(id, (e) => { const d = e >>> 8; if (z.lebt[d] && !aus[d]) { aus[d] = 1; ausgeschlossen.push(d); } });
    }

    // Kandidaten: genug Fragewörter, alle Pflichtwörter, keine Ausgeschlossenen, Filter
    let locker = null;
    const facetten = opt.facetten ? { typ: new Map(), ordner: new Map(), tag: new Map(), status: new Map() } : null;
    const ohneText = !q.terme.length;
    let textTreffer = 0, meiste = 0;
    const sammle = (noetig) => {
      const kand = [];
      textTreffer = 0; meiste = 0;
      const pruefe = (d) => {
        if (!z.lebt[d] || aus[d]) return;
        if (!ohneText) {
          const m = maske[d];
          if ((m & pflicht) !== pflicht) return;
          const zahl = popcount(m & plainMaske);
          if (zahl < noetig) return;
          if (zahl > meiste) meiste = zahl;
        }
        textTreffer++;
        const doc = docs[d];
        let fm = 0;
        if (filterAktiv) { fm = ff.maskeVon(doc); if (fm !== ff.voll && !facetten) return; }
        if (facetten) zaehleFacetten(facetten, doc, fm, ff);
        if (!filterAktiv || fm === ff.voll) kand.push(d);
      };
      if (ohneText) for (let d = 0; d < docs.length; d++) pruefe(d); else for (const d of beruehrt) pruefe(d);
      return kand;
    };
    let kand = sammle(plain.length);
    if (!textTreffer && !ohneText && plain.length >= 2) { // kein Text hat alle Wörter: „irgendeins“, nach BM25 (je mehr Wörter, desto höher); gemeldet wird, wie viele es höchstens sind
      if (facetten) for (const k of Object.keys(facetten)) facetten[k].clear();
      kand = sammle(1);
      if (textTreffer) locker = { gefunden: meiste, von: plain.length };
    }

    // Reihenfolge: Punkte, Bonus für Titel, dann Änderungszeit
    const vergleich = (a, b) => punkte[b] - punkte[a] || docs[b].mtimeMs - docs[a].mtimeMs || (docs[a].rel < docs[b].rel ? -1 : 1);
    const vergleichZeit = (a, b) => docs[b].mtimeMs - docs[a].mtimeMs || (docs[a].rel < docs[b].rel ? -1 : 1);
    let sortiert;
    if (ohneText) sortiert = kand.sort(vergleichZeit);
    else {
      kand.sort(vergleich);
      const kopf = kand.slice(0, BONUS_N), schwanz = kand.slice(BONUS_N);
      const frageF = q.terme.filter((t) => !t.phrase).map((t) => t.token).join(" ") || q.terme.map((t) => t.token).join(" ");
      const bonus = new Map();
      for (const d of kopf) {
        const doc = docs[d];
        let b = 0;
        if (doc.titelF === frageF) b = 40; else if (doc.aliasF.includes(frageF)) b = 32; else if (frageF.length >= 2 && doc.titelF.startsWith(frageF)) b = 18;
        else if (plain.length && plain.every((i) => { const w = termInfo[i].t.token; return doc.titelF.split(/[^\p{L}\p{N}]+/u).includes(w); })) b = 10;
        if (b) bonus.set(d, b);
      }
      if (bonus.size) { kopf.sort((a, b) => (punkte[b] + (bonus.get(b) || 0)) - (punkte[a] + (bonus.get(a) || 0)) || vergleich(a, b)); }
      sortiert = kopf.concat(schwanz);
    }

    // Phrasen an den Texten prüfen (Kandidaten in Reihenfolge, höchstens PRUEF_MAX)
    let gesamt = sortiert.length, gesamtGenau = true, auswahl = sortiert;
    const phrasenF = q.phrasen;
    if (phrasenF.length) {
      auswahl = []; let geprueft = 0, offenBleibt = false;
      const bis = performance.now() + PRUEF_MS; // eine Phrase mit lauter häufigen Wörtern darf die Werkstatt nicht lange festhalten
      for (const d of sortiert) {
        if (auswahl.length >= offset + limit + 1 && geprueft >= 40) { offenBleibt = true; break; }
        if (geprueft >= PRUEF_MAX || (geprueft >= 2 && performance.now() > bis)) { offenBleibt = true; break; }
        geprueft++;
        const text = liesAnfang(join(wurzel, docs[d].rel), PHRASE_BYTES);
        if (text === null) continue;
        if (phrasenF.every((p) => enthaeltPhrase(text, p))) auswahl.push(d);
      }
      gesamt = auswahl.length; gesamtGenau = !offenBleibt;
    }

    const spec = { markiere, phrasen: phrasenF, termAnzahl: termInfo.length, bis: performance.now() + AUSZUG_MS };
    let veraltet = false, uebersprungen = 0;
    const treffer = [];
    // Frische prüfen: ab offset der Reihe nach, bis die Seite voll ist. Veraltetes wandert aus dem Index (und die Rechnung beginnt von vorn); in der letzten Runde wird es nur übersprungen.
    let gelesen = 0, pos = offset;
    for (; pos < auswahl.length && treffer.length < limit && gelesen < 400; pos++, gelesen++) {
      const d = auswahl[pos], doc = docs[d];
      let st; try { st = statSync(join(wurzel, doc.rel)); } catch { st = null; }
      if (!st || !st.isFile() || st.mtimeMs !== doc.mtimeMs || st.size !== doc.groesse) {
        if (!zweiter) { veraltet = true; aktualisiereDatei(doc.rel); } else uebersprungen++;
        continue;
      }
      treffer.push(baueTreffer(doc, ohneText ? 0 : punkte[d], spec, ohneText));
    }
    if (veraltet) return { veraltet: true };
    gesamt -= uebersprungen;
    const bis = pos; // bis hier ist die Liste durchgesehen (Übersprungenes zählt zur Seite, damit die nächste Seite dort weitermacht)

    return antwort({
      treffer, gesamt, gesamtGenau, mehr: bis <= OFFSET_MAX && (bis < auswahl.length || (!gesamtGenau && treffer.length === limit)), locker,
      begriffe, markieren: [...markiere.keys()].slice(0, 120),
      facetten: facetten ? fertigeFacetten(facetten) : null,
    });
    }
  }

  function zaehleFacetten(f, doc, fm, ff) {
    const bit = (k) => ff.liste.find((g) => g.schluessel === k)?.bit || 0;
    const ok = (k) => (fm | bit(k)) === ff.voll;
    const plusEins = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    if (doc.typ && ok("typ")) plusEins(f.typ, doc.typ);
    if (doc.ordner0 && ok("ordner")) plusEins(f.ordner, doc.ordner0);
    if (doc.status && ok("status")) plusEins(f.status, doc.status);
    if (ok("tag")) for (const t of doc.tags) plusEins(f.tag, t);
  }
  function fertigeFacetten(f) {
    const aus = {};
    for (const [k, m] of Object.entries(f)) aus[k] = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12).map(([wert, anzahl]) => ({ wert, anzahl }));
    return aus;
  }

  function enthaeltPhrase(text, p) {
    const t = tokenisiere(text);
    const n = p.length;
    outer: for (let i = 0; i + n <= t.length; i++) {
      if (t[i] !== p[0]) continue;
      for (let j = 1; j < n; j++) if (t[i + j] !== p[j]) continue outer;
      return true;
    }
    return false;
  }

  // ----- Treffer mit Auszügen -----
  function markenIn(text, markiere, phrasen) {
    // → [{ s, e, maske }] für jedes Wort in text, das markiert werden soll (UTF-16-Positionen in text)
    const aus = [];
    const toks = [];
    for (const m of text.matchAll(TOKEN)) toks.push({ s: m.index, e: m.index + m[0].length, f: falteText(m[0]) });
    const isPhrase = new Array(toks.length).fill(false);
    for (const p of phrasen) {
      outer: for (let i = 0; i + p.length <= toks.length; i++) {
        for (let j = 0; j < p.length; j++) if (toks[i + j].f !== p[j]) continue outer;
        for (let j = 0; j < p.length; j++) isPhrase[i + j] = true;
      }
    }
    toks.forEach((t, i) => {
      const m = markiere.get(t.f);
      if (m !== undefined) aus.push({ s: t.s, e: t.e, maske: m, phrase: isPhrase[i] });
    });
    return aus;
  }

  function fenster(zeile, treffer) { // Auszug um den ersten Treffer, mit Markierungen relativ zum Auszug
    const BREITE = 170;
    let a = 0, b = zeile.length;
    if (zeile.length > BREITE) {
      a = Math.max(0, treffer[0].s - 60);
      b = Math.min(zeile.length, a + BREITE);
      if (a > 0) { const sp = zeile.indexOf(" ", a); if (sp >= 0 && sp < treffer[0].s) a = sp + 1; }
      if (b < zeile.length) { const sp = zeile.lastIndexOf(" ", b); if (sp > treffer[0].e) b = sp; }
    }
    const kern = zeile.slice(a, b);
    const vorn = kern.length - kern.trimStart().length;
    const text = kern.trim();
    const basis = a + vorn, vor = a > 0 ? "… " : "";
    const marken = [];
    for (const t of treffer) {
      const s = Math.max(t.s, basis), e = Math.min(t.e, basis + text.length);
      if (e > s) marken.push([vor.length + s - basis, vor.length + e - basis]);
    }
    return { text: vor + text + (b < zeile.length ? " …" : ""), marken };
  }

  function baueTreffer(doc, score, spec, ohneText) {
    const t = { pfad: doc.rel, titel: doc.titel, titelMarken: [], typ: doc.typ || "", geaendert: new Date(doc.mtimeMs).toISOString(), score: Math.round(score * 100) / 100, auszug: "", zeile: 1, spalte: 0, laenge: 0, stellen: [], anzahl: 0 };
    if (spec.markiere.size) t.titelMarken = markenIn(doc.titel, spec.markiere, []).map((m) => [m.s, m.e]);
    const text = liesAnfang(join(wurzel, doc.rel), AUSZUG_BYTES);
    if (text === null) return t;
    const zeilen = text.split("\n");
    const eilig = () => performance.now() > spec.bis; // Zeitbudget der Antwort verbraucht: nur noch die erste Zeile zeigen
    const kandidaten = [];
    let abschnitt = "", kopfEnde = 0;
    if (text.startsWith("---")) { for (let i = 1; i < Math.min(zeilen.length, 400); i++) if (/^(---|\.\.\.)\s*$/.test(zeilen[i])) { kopfEnde = i + 1; break; } }
    let anzahl = 0, ersteInhalt = -1;
    if (spec.markiere.size && !ohneText && !eilig()) {
      for (let i = 0; i < zeilen.length; i++) {
        if ((i & 63) === 63 && eilig()) break;
        let z = zeilen[i];
        if (z.endsWith("\r")) z = z.slice(0, -1);
        const uebers = z.charCodeAt(0) === 35 ? UEBERSCHRIFT.exec(z) : null;
        if (uebers) abschnitt = uebers[2];
        if (!z.trim()) continue;
        if (ersteInhalt < 0 && i >= kopfEnde && !uebers) ersteInhalt = i;
        const ms = markenIn(z, spec.markiere, spec.phrasen);
        if (!ms.length) continue;
        let treffM = ms;
        if (spec.phrasen.length) { const nurPhrase = ms.filter((m) => m.phrase); if (nurPhrase.length) treffM = nurPhrase; }
        anzahl += ms.length;
        let verschieden = 0, m0 = 0; for (const m of treffM) m0 |= m.maske;
        for (let b = m0; b; b &= b - 1) verschieden++;
        const rang = verschieden * 100 + (spec.phrasen.length && treffM.some((m) => m.phrase) ? 500 : 0) - i * 0.001 + (uebers ? 0 : 1) - (i < kopfEnde ? 50 : 0);
        kandidaten.push({ i, z, treffM, rang, abschnitt: uebers ? "" : abschnitt });
        if (anzahl > 999) break;
      }
    } else {
      for (let i = kopfEnde; i < zeilen.length; i++) { const z = zeilen[i]; if (z.trim() && !z.startsWith("#")) { ersteInhalt = i; break; } }
    }
    t.anzahl = Math.min(anzahl, 999);
    kandidaten.sort((a, b) => b.rang - a.rang);
    const gewaehlt = kandidaten.slice(0, 3);
    for (const k of gewaehlt) {
      const f = fenster(k.z, k.treffM);
      t.stellen.push({ zeile: k.i + 1, spalte: k.treffM[0].s, laenge: k.treffM[0].e - k.treffM[0].s, text: f.text, marken: f.marken, ...(k.abschnitt ? { abschnitt: k.abschnitt } : {}) });
    }
    if (t.stellen.length) { const s = t.stellen[0]; t.auszug = s.text; t.zeile = s.zeile; t.spalte = s.spalte; t.laenge = s.laenge; }
    else if (ersteInhalt >= 0) { const z = zeilen[ersteInhalt].replace(/\r$/, "").trim(); t.auszug = z.slice(0, 160); t.zeile = ersteInhalt + 1; }
    return t;
  }

  // Wie suche(), wartet aber (nur kurz nach dem Start des Aufbaus) auf den Aufbau, damit die erste Suche in kleinen und mittleren Vaults schon vollständig ist.
  // Danach, und bei großen Vaults, kommt sofort die vorläufige Antwort mit aufbau.fertig = false. Das Warten blockiert nichts (Zeitgeber).
  async function sucheWarte(opt = {}, fristMs = 350) {
    starte();
    const bis = bauStart + fristMs;
    while (!fertig && performance.now() < bis) await new Promise((ok) => setTimeout(ok, 3));
    return suche(opt);
  }

  // Der Vault wird gewechselt: laufende Arbeit stoppen und den Speicher freigeben (ein späteres Suchen baut neu auf)
  function beende() {
    aufgaben.length = 0; laeuft = null; schmutzig.clear();
    gestartet = false; fertig = false; abgleichOffen = false; leerenGeplant = false; nochAbgleich = false; neubau = null;
    z = new Zustand(); anteil = 0; entdeckt = 0;
  }

  function stand() {
    return { gestartet, fertig, anteil, dokumente: z.nLebend, tot: z.tot, woerter: z.liste.length, bloecke: z.nBloecke, bauMs: Math.round(bauZeit), neubau: !!neubau, laeuft: !!laeuft || aufgaben.length > 0, schmutzig: schmutzig.size };
  }
  // Wartet, bis keine Hintergrundarbeit mehr offen ist (Tests, Messung)
  function ruhe() {
    return new Promise((ok) => { const pruef = () => (!laeuft && !aufgaben.length && !geplant ? ok() : setTimeout(pruef, 2)); pruef(); });
  }
  return { starte, suche, sucheWarte, beende, aendere, pruefeNeu, stand, ruhe, istFertig: () => fertig };
}
