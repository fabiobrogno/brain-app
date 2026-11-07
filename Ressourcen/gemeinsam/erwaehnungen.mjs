// gemeinsam/erwaehnungen.mjs — ungelinkte Erwähnungen: Wo steht der Titel (oder ein Alias) einer Notiz im Klartext, ohne dass er verlinkt ist? Reine Funktionen,
// kein Plattenzugriff, keine KI. Genutzt von gemeinsam/erwaehnungen-index.mjs (Werkstatt, MCP-Server); die Studio-Oberfläche ruft nur die Routen.
//
// Die Regeln
//   · Wortgrenzen: ein Name zählt nur als ganze Wortfolge. „Kaffee“ steht nicht in „Kaffeemaschine“ und nicht in „Kaffee_alt“; „Kaffee-Maschine“ zählt (Bindestrich = Wortgrenze).
//   · Groß/klein, Unicode-Form (NFC/NFD) und Umlaute sind egal: „muehle“, „Mühle“, „MUEHLE“ und „Muhle“ treffen alle die Notiz „Mühle“ (wie die Link-Auflösung in wikilink.mjs).
//     Zwischen den Wörtern eines Namens gelten Leerzeichen, Tabs, „-“ und „_“ gleich; ein Zeilenumbruch bricht den Treffer ab.
//   · Nie gezählt wird: der Datei-Kopf (Front Matter), Code (Zäune, eingerückte Blöcke, Inline-Code), HTML-Kommentare und -Tags, Überschriften (ein Link würde den Titel ändern),
//     Formeln, vorhandene Links ([[…]], [Text](…), ![Bild](…), [Text][ref], Definitionen), Adressen (https:, www., E-Mail), #Tags und @Namen.
//   · Gibt es einen längeren Namen einer anderen Notiz, der den Treffer umfasst („Kaffee Maschine“ enthält „Kaffee“), gehört die Stelle zu diesem längeren Namen.
//   · Ein Name, der zu zwei Notizen gehört, ist mehrdeutig und wird nie vorgeschlagen.
//   · Zu kurze Namen (weniger als drei Buchstaben), reine Zahlen und Namen mit [ ] | # tauchen nicht auf.

const WORT = /[\p{L}\p{M}\p{N}]+/gu;
const BUCHSTABE = /\p{L}/gu;
const FENCE = /^\s*(`{3,}|~{3,})/;
const MAX_NAME = 80;
const MAX_TOKEN = 60;

// ───────────────────────────── Falten ─────────────────────────────
const SONDER_AE = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ł": "l", "ı": "i" };
const SONDER_A = { "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ł": "l", "ı": "i" };
const RE_SONDER = /[äöüßæœøđłı]/g;
export const MODI = ["ae", "a"];

/** Ein Wort falten: klein, Umlaute (modus "ae": ä→ae; modus "a": ä→a), Akzente weg. */
export function falteWort(w, modus = "ae") {
  let s = w.normalize("NFC").toLowerCase();
  const tab = modus === "ae" ? SONDER_AE : SONDER_A;
  s = s.replace(RE_SONDER, (c) => tab[c] ?? c);
  return s.normalize("NFD").replace(/\p{M}+/gu, "");
}

const luecke = (g) => (/^[\s_-]+$/.test(g) ? " " : g);

/**
 * Einen Namen für den Abgleich aufbereiten. → null, wenn er sich nicht eignet.
 * { text, laenge (Wörter), seq: { ae: [...], a: [...] }, luecken: [...] }
 */
export function bereiteName(roh) {
  if (typeof roh !== "string") return null;
  const text = roh.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_NAME || /[\[\]|#\n]/.test(text)) return null;
  if ((text.match(BUCHSTABE) || []).length < 3) return null;
  const toks = [...text.matchAll(WORT)];
  if (!toks.length || toks.length > 8 || toks.some((t) => t[0].length > MAX_TOKEN)) return null;
  const luecken = [];
  for (let i = 1; i < toks.length; i++) luecken.push(luecke(text.slice(toks[i - 1].index + toks[i - 1][0].length, toks[i].index)));
  return { text, laenge: toks.length, seq: { ae: toks.map((t) => falteWort(t[0], "ae")), a: toks.map((t) => falteWort(t[0], "a")) }, luecken };
}

/** Namen einer Notiz (Titel, dann Aliasse), nur die brauchbaren, ohne Doppelte. → [{ ...bereiteName, art: "titel" | "alias" }] */
export function namenEinerNotiz({ titel, aliasse = [] }) {
  const aus = [], gesehen = new Set();
  const nimm = (t, art) => { const n = bereiteName(t); if (!n) return; const k = n.seq.ae.join(" "); if (gesehen.has(k)) return; gesehen.add(k); aus.push({ ...n, art }); };
  nimm(titel, "titel");
  for (const a of aliasse) nimm(a, "alias");
  return aus;
}

// ───────────────────────────── Wo darf nichts gefunden werden? ─────────────────────────────
function zeilenVon(text) {
  const zeilen = [];
  for (let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0, nr = 1; pos < text.length; nr++) {
    const nl = text.indexOf("\n", pos);
    const ende = nl < 0 ? text.length : nl + 1;
    let inhaltEnde = nl < 0 ? text.length : nl;
    if (inhaltEnde > pos && text[inhaltEnde - 1] === "\r") inhaltEnde--;
    zeilen.push({ pos, text: text.slice(pos, inhaltEnde), nr });
    pos = ende;
  }
  return zeilen;
}

function codeBereiche(zeile) { // Inline-Code: gleich lange Backtick-Reihen öffnen und schließen
  const aus = [];
  let i = 0;
  while (i < zeile.length) {
    if (zeile[i] !== "`") { i++; continue; }
    let n = 0;
    while (zeile[i + n] === "`") n++;
    let j = i + n, ende = -1;
    while (j < zeile.length) {
      if (zeile[j] !== "`") { j++; continue; }
      let m = 0;
      while (zeile[j + m] === "`") m++;
      if (m === n) { ende = j + m; break; }
      j += m;
    }
    if (ende < 0) { i += n; continue; }
    aus.push([i, ende]);
    i = ende;
  }
  return aus;
}

const INLINE = [
  /!?\[\[[^\[\]\n]*\]\]/g,                                     // [[Link]], ![[Einbettung]]
  /!?\[[^\[\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g,            // [Text](Adresse), ![Bild](Adresse)
  /!?\[[^\[\]\n]+\]\[[^\[\]\n]*\]/g,                           // [Text][ref]
  /\[\^[^\]\n]+\]/g,                                           // Fußnote
  /<\/?[A-Za-z][^<>\n]*>/g,                                    // HTML-Tag
  /<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/g,                       // <https://…>
  /\b(?:https?|ftp|file):\/\/[^\s<>\])]+/g,                    // Adresse
  /\bwww\.[^\s<>\])]+/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,                             // E-Mail
  /(?<![\p{L}\p{N}_])[#@][\p{L}\p{N}_\/-]+/gu,                 // #tag, @name
  /(?<!\\)\$(?![\s$])[^$\n]*[^$\s\\]\$(?!\d)/g,                // $Formel$
];

/** Bereiche [von, bis) des Textes, in denen nichts gefunden werden darf (sortiert, zusammengefasst). */
export function sperrBereiche(text) {
  const iv = [];
  const zeilen = zeilenVon(text);
  const art = new Array(zeilen.length).fill("text"); // "sperr" (Kopf, Code, Überschrift) | "text" | "leer"
  let kopfEnde = -1;
  if (zeilen.length && /^---\s*$/.test(zeilen[0].text)) for (let i = 1; i < zeilen.length; i++) if (/^(---|\.\.\.)\s*$/.test(zeilen[i].text)) { kopfEnde = i; break; }
  if (kopfEnde > 0) { iv.push([0, zeilen[kopfEnde].pos + zeilen[kopfEnde].text.length]); for (let i = 0; i <= kopfEnde; i++) art[i] = "sperr"; }
  const einzug = (t) => { let n = 0; for (const c of t) { if (c === " ") n++; else if (c === "\t") n += 4; else break; } return n; };
  let zaun = null, inListe = false, davorLeer = true, davorCode = false;
  for (let i = Math.max(0, kopfEnde + 1); i < zeilen.length; i++) {
    const z = zeilen[i];
    const bis = z.pos + z.text.length;
    const m = FENCE.exec(z.text);
    if (zaun) {
      art[i] = "sperr"; iv.push([z.pos, bis]);
      if (m && m[1][0] === zaun.z && m[1].length >= zaun.n && !z.text.slice(m[0].length).trim()) zaun = null;
      continue;
    }
    if (m) { zaun = { z: m[1][0], n: m[1].length }; art[i] = "sperr"; iv.push([z.pos, bis]); davorLeer = false; davorCode = true; continue; }
    if (!z.text.trim()) { art[i] = "leer"; davorLeer = true; continue; }
    if (!inListe && einzug(z.text) >= 4 && (davorLeer || davorCode)) { art[i] = "sperr"; iv.push([z.pos, bis]); davorLeer = false; davorCode = true; continue; }
    const liste = /^\s*([-*+]|\d+[.)])\s/.test(z.text);
    if (liste) inListe = true; else if (einzug(z.text) === 0) inListe = false;
    const naechste = zeilen[i + 1]?.text;
    if (/^ {0,3}#{1,6}(\s|$)/.test(z.text) || (!liste && naechste !== undefined && /^ {0,3}(=+|-+)\s*$/.test(naechste) && /\S/.test(z.text))) { art[i] = "sperr"; iv.push([z.pos, bis]); davorLeer = false; davorCode = false; continue; }
    if (/^\s{0,3}\[[^\]\n]+\]:/.test(z.text)) { art[i] = "sperr"; iv.push([z.pos, bis]); davorLeer = false; davorCode = false; continue; } // Link-Definition
    davorLeer = false; davorCode = false;
  }
  for (const k of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) iv.push([k.index, k.index + k[0].length]);
  for (const k of text.matchAll(/\$\$[\s\S]*?(?:\$\$|$)/g)) iv.push([k.index, k.index + k[0].length]);
  // Inline-Code (auch über Zeilen eines Absatzes) und die Muster je Zeile
  for (let i = 0; i < zeilen.length;) {
    if (art[i] !== "text") { i++; continue; }
    let j = i;
    while (j + 1 < zeilen.length && art[j + 1] === "text") j++;
    const starts = []; let acc = 0; const teile = [];
    for (let k = i; k <= j; k++) { starts.push(acc); teile.push(zeilen[k].text); acc += zeilen[k].text.length + 1; }
    const wo = (idx) => { let k = starts.length - 1; while (k > 0 && starts[k] > idx) k--; return zeilen[i + k].pos + (idx - starts[k]); };
    for (const [a, b] of codeBereiche(teile.join("\n"))) iv.push([wo(a), wo(b - 1) + 1]);
    for (let k = i; k <= j; k++) {
      const z = zeilen[k];
      for (const re of INLINE) { re.lastIndex = 0; for (const mm of z.text.matchAll(re)) iv.push([z.pos + mm.index, z.pos + mm.index + mm[0].length]); }
    }
    i = j + 1;
  }
  iv.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const aus = [];
  for (const [a, b] of iv) { const l = aus[aus.length - 1]; if (l && a <= l[1]) { if (b > l[1]) l[1] = b; } else aus.push([a, b]); }
  return aus;
}

// Liegt [von, bis) in einem gesperrten Bereich? (binäre Suche)
function beruehrt(iv, von, bis) {
  let lo = 0, hi = iv.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (iv[mid][1] <= von) lo = mid + 1; else if (iv[mid][0] >= bis) hi = mid - 1; else return true;
  }
  return false;
}

// ───────────────────────────── Namen im Text finden ─────────────────────────────
/**
 * Abgleicher über mehrere Namen. namen: [{ id, name: bereiteName(…) }]. Namen mit gleicher Folge, aber verschiedener id, sind mehrdeutig (id → null).
 * → { modi: { ae: Map(erstesWort → [eintrag, …] längste zuerst), a: … } }
 */
export function baueAbgleicher(namen) {
  const modi = { ae: new Map(), a: new Map() };
  const besitzer = { ae: new Map(), a: new Map() };
  for (const { id, name } of namen) {
    if (!name) continue;
    for (const m of MODI) {
      const folge = name.seq[m], k = folge.join(" ");
      const b = besitzer[m].get(k);
      if (b === undefined) besitzer[m].set(k, id); else if (b !== id) besitzer[m].set(k, null);
    }
  }
  const dazu = new Set();
  for (const { id, name } of namen) {
    if (!name) continue;
    for (const m of MODI) {
      const folge = name.seq[m], k = folge.join(" ");
      const schl = `${m}|${k}|${id}`;
      if (dazu.has(schl)) continue;
      dazu.add(schl);
      const e = { id: besitzer[m].get(k), name, folge, luecken: name.luecken };
      const l = modi[m].get(folge[0]);
      if (l) l.push(e); else modi[m].set(folge[0], [e]);
    }
  }
  for (const m of MODI) for (const l of modi[m].values()) l.sort((a, b) => b.folge.length - a.folge.length || (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0));
  return { modi };
}

/** Zeilennummer (1-basiert) und Spalte (0-basiert) einer Textposition. */
export function zeileSpalte(text, pos) {
  let zeile = 1, letzter = -1;
  for (let i = text.indexOf("\n"); i >= 0 && i < pos; i = text.indexOf("\n", i + 1)) { zeile++; letzter = i; }
  return { zeile, spalte: pos - (letzter + 1) };
}

const WORTZEICHEN = /[\p{L}\p{M}\p{N}_]/u;

/**
 * Alle Stellen im Text, an denen ein Name des Abgleichers steht (ohne gesperrte Bereiche, ohne Überlappungen, längster Name zuerst).
 * → [{ start, ende, treffer, id, name }] sortiert nach start; id null = mehrdeutig (nur gemeldet, damit es längere Treffer überdeckt)
 */
export function findeNamen(text, abgleicher, { sperr = null, nurId = undefined } = {}) {
  const bereiche = sperr || sperrBereiche(text);
  const toks = [];
  for (const m of text.matchAll(WORT)) toks.push({ s: m.index, e: m.index + m[0].length, w: m[0] });
  if (!toks.length) return [];
  const roh = [];
  for (const modus of MODI) {
    const karte = abgleicher.modi[modus];
    if (!karte.size) continue;
    const cache = new Map();
    abgleicher.ordne?.();
    const fold = (t) => { let f = cache.get(t.w); if (f === undefined) { f = falteWort(t.w, modus); cache.set(t.w, f); } return f; };
    for (let i = 0; i < toks.length; i++) {
      const kand = karte.get(fold(toks[i]));
      if (!kand) continue;
      for (const c of kand) {
        const n = c.folge.length;
        if (i + n > toks.length) continue;
        let ok = true;
        for (let j = 1; j < n && ok; j++) {
          if (fold(toks[i + j]) !== c.folge[j]) { ok = false; break; }
          const gap = text.slice(toks[i + j - 1].e, toks[i + j].s);
          if (/[\r\n]/.test(gap) || luecke(gap) !== c.luecken[j - 1]) ok = false;
        }
        if (!ok) continue;
        const start = toks[i].s, ende = toks[i + n - 1].e;
        if ((start > 0 && WORTZEICHEN.test(text[start - 1])) || (ende < text.length && text[ende] === "_")) continue; // _ gehört zum Wort
        if (beruehrt(bereiche, start, ende)) continue;
        roh.push({ start, ende, id: abgleicher.mehrdeutig?.(modus, c) ? null : c.id, name: c.name, laenge: n });
        break; // der längste passende Name an dieser Stelle
      }
    }
  }
  roh.sort((a, b) => a.start - b.start || b.ende - a.ende);
  const aus = [];
  let letzteEnde = -1;
  for (const r of roh) {
    if (r.start < letzteEnde) continue;
    letzteEnde = r.ende;
    aus.push({ start: r.start, ende: r.ende, treffer: text.slice(r.start, r.ende), id: r.id, name: r.name });
  }
  return nurId === undefined ? aus : aus.filter((a) => a.id === nurId);
}

// Kontext einer Stelle: die Zeile (gekürzt) mit der Markierung relativ zum Auszug, dazu die Zeichen davor und danach (zum Wiederfinden nach Änderungen)
export function kontextVon(text, start, ende, breite = 160) {
  const zs = text.lastIndexOf("\n", start - 1) + 1;
  let ze = text.indexOf("\n", ende); if (ze < 0) ze = text.length;
  if (ze > zs && text[ze - 1] === "\r") ze--;
  let a = zs, b = ze;
  if (b - a > breite) { a = Math.max(zs, start - 60); b = Math.min(ze, a + breite); if (b < ende) b = ende; }
  const vor = (a > zs ? "… " : ""), nach = (b < ze ? " …" : "");
  const zeile = vor + text.slice(a, b) + nach;
  const von = vor.length + (start - a);
  return { zeile, markierung: [von, von + (ende - start)], vor: text.slice(Math.max(zs, start - 24), start), nach: text.slice(ende, Math.min(ze, ende + 24)) };
}

/** Stelle(n) einer Notiz zum Anzeigen: { start, ende, zeile, spalte, treffer, ... }. */
export function stellenAus(text, treffer) {
  return treffer.map((t) => {
    const zs = zeileSpalte(text, t.start);
    const k = kontextVon(text, t.start, t.ende);
    return { start: t.start, ende: t.ende, zeile: zs.zeile, spalte: zs.spalte, treffer: t.treffer, name: t.name.text, art: t.name.art, auszug: k.zeile, markierung: k.markierung, vor: k.vor, nach: k.nach };
  });
}

// ───────────────────────────── Verlinken ─────────────────────────────
const ZEILE_TABELLE = /^\s*\|/;
/**
 * Der Linktext für eine Stelle: `[[Ziel]]`, wenn der Text genau dem Linkziel entspricht, sonst `[[Ziel|Text]]` (der Text im Satz bleibt, wie er ist).
 * `ziel`: was in die Klammern gehört (Titel oder Pfad|Titel, siehe wikilink.mjs#linkText). → null, wenn die Stelle sich so nicht verlinken lässt
 * (Anzeigetext mit | in einer Tabellenzeile).
 */
export function linkFuer(text, stelle, ziel) {
  const [adresse, anzeige] = ziel.split("|");
  const t = stelle.treffer;
  const gleich = !anzeige ? adresse.normalize("NFC") === t.normalize("NFC") : false;
  if (gleich) return `[[${adresse}]]`;
  const zs = text.lastIndexOf("\n", stelle.start - 1) + 1;
  let ze = text.indexOf("\n", stelle.ende); if (ze < 0) ze = text.length;
  if (ZEILE_TABELLE.test(text.slice(zs, ze))) return null;
  return `[[${adresse}|${t}]]`;
}

/**
 * Setzt Links in den Text. stellen: [{ start, ende, link }] (nicht überlappend). → neuer Text. Alles andere bleibt Byte für Byte.
 */
export function setzeLinks(text, stellen) {
  const s = stellen.slice().sort((a, b) => b.start - a.start);
  let aus = text;
  for (const x of s) aus = aus.slice(0, x.start) + x.link + aus.slice(x.ende);
  return aus;
}

/**
 * Eine zuvor gezeigte Stelle im aktuellen Text wiederfinden: genau dort (gleicher Treffertext und gleiche Umgebung), sonst die einzige Stelle mit gleicher
 * Umgebung, sonst null (zwischenzeitlich geändert). stellen: aktuelle Treffer von findeNamen (nur dieses Ziels).
 */
export function findeWieder(text, aktuelle, alt) {
  const passt = (a) => a.treffer === alt.treffer;
  const umgebung = (a) => { const k = kontextVon(text, a.start, a.ende); return k.vor === alt.vor && k.nach === alt.nach; };
  const genau = aktuelle.find((a) => a.start === alt.start && passt(a) && umgebung(a));
  if (genau) return genau;
  const gleich = aktuelle.filter((a) => passt(a) && umgebung(a));
  return gleich.length === 1 ? gleich[0] : null;
}
