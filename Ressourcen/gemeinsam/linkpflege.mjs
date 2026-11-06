// gemeinsam/linkpflege.mjs — Link-Pflege beim Umbenennen und Verschieben (reine Funktionen, kein Plattenzugriff außer dem übergebenen `existiert`).
// Genutzt von gemeinsam/dateiaktionen.mjs (Werkstatt und MCP-Server). Die Regel, wohin ein [[Link]] zeigt, kommt aus gemeinsam/wikilink.mjs — hier wird nur
// verglichen, wo ein Link VOR und NACH der Änderung hinführt, und nur umgeschrieben, was sonst ins Leere oder woandershin zeigen würde.
//
// Was umgeschrieben wird: [[Ziel]], [[Ziel|Anzeige]], [[Ziel#Abschnitt]], ![[Ziel]] (Einbettung) und relative Markdown-Links [Text](pfad.md#abschnitt) / ![Bild](pfad.png).
// Was NICHT: alles in Code-Blöcken (``` / ~~~) und in Inline-Code, Links mit Adresse (https:, mailto: …), Anker allein. Alles andere im Text bleibt Byte für Byte erhalten
// (Zeilenenden CRLF/LF, BOM, Kopf): es werden nur die Zeichen des Ziels ersetzt (und bei Bedarf „|Anzeige“ ergänzt).
import { parseKopf, titelAus } from "./notizen.mjs";
import { baueWikiIndex, findeWikiZiel, lockerFormen, ordnerVonPfad, falte } from "./wikilink.mjs";

const ENDUNG = /\.(md|txt)$/i;
const WIKI = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const MD_ANFANG = /(!?)\[([^\[\]\n]*)\]\(/g;
// Zäune auch eingerückt (in Listen): im Zweifel gilt etwas als Code und wird NICHT umgeschrieben
const FENCE = /^\s*(`{3,}|~{3,})/;

// ───────────────────────────── Verweise in einem Text finden ─────────────────────────────

// Bereiche [von, bis) in `zeile`, die Inline-Code sind (gleich lange Backtick-Reihen öffnen und schließen)
function codeBereiche(zeile) {
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

// Adresse eines Markdown-Links ab `ab` (direkt nach „](“): → { von, bis, pfadBis, spitz } oder null
function mdZiel(zeile, ab) {
  let i = ab;
  while (zeile[i] === " " || zeile[i] === "\t") i++;
  let von, bis, spitz = false;
  if (zeile[i] === "<") {
    const e = zeile.indexOf(">", i + 1);
    if (e < 0) return null;
    von = i + 1; bis = e; spitz = true; i = e + 1;
  } else {
    von = i;
    let tiefe = 0;
    while (i < zeile.length) {
      const c = zeile[i];
      if (c === " " || c === "\t") break;
      if (c === "(") tiefe++;
      else if (c === ")") { if (tiefe === 0) break; tiefe--; }
      i++;
    }
    bis = i;
  }
  // optionaler Titel, dann „)“
  let j = i;
  while (zeile[j] === " " || zeile[j] === "\t") j++;
  if (zeile[j] === '"' || zeile[j] === "'") { const q = zeile[j]; const e = zeile.indexOf(q, j + 1); if (e < 0) return null; j = e + 1; while (zeile[j] === " " || zeile[j] === "\t") j++; }
  if (zeile[j] !== ")") return null;
  return { von, bis, spitz, ende: j + 1 };
}

/**
 * Alle Verweise eines Textes. → [{ art: "wiki" | "md", einbettung, start, ende, zielVon, zielBis, ziel, innenEnde?, zeile (1-basiert), kopf }]
 *   Positionen sind Zeichenpositionen im übergebenen Text (UTF-16), `ziel` ist der rohe Zieltext (ohne Anzeige und Abschnitt).
 */
export function findeVerweise(text) {
  const aus = [];
  const basis = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // Zeilen samt Positionen (Zeilenende bleibt außen vor, \r gehört zum Zeilenende)
  const zeilen = [];
  for (let pos = basis, nr = 1; pos < text.length; nr++) {
    const nl = text.indexOf("\n", pos);
    const ende = nl < 0 ? text.length : nl + 1;
    let inhaltEnde = nl < 0 ? text.length : nl;
    if (inhaltEnde > pos && text[inhaltEnde - 1] === "\r") inhaltEnde--;
    zeilen.push({ pos, text: text.slice(pos, inhaltEnde), nr });
    pos = ende;
  }
  // Kopf (Frontmatter): erste Zeile --- bis zur nächsten --- / ...
  let kopfEnde = -1;
  if (zeilen.length && /^---\s*$/.test(zeilen[0].text)) {
    for (let i = 1; i < zeilen.length; i++) if (/^(---|\.\.\.)\s*$/.test(zeilen[i].text)) { kopfEnde = i; break; }
  }
  // 1. Was ist Code? Zäune, eingerückte Code-Blöcke (4 Leerzeichen/Tab nach einer Leerzeile, nicht in einer Liste)
  const art = new Array(zeilen.length).fill("text"); // "kopf" | "code" | "text" | "leer"
  let zaun = null, inListe = false, davorLeer = true, davorCode = false;
  const einzug = (t) => { let n = 0; for (const c of t) { if (c === " ") n++; else if (c === "\t") n += 4; else break; } return n; };
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (kopfEnde > 0 && i <= kopfEnde) { art[i] = i < kopfEnde ? "kopf" : "leer"; continue; }
    const m = FENCE.exec(z.text);
    if (zaun) {
      art[i] = "code";
      if (m && m[1][0] === zaun.z && m[1].length >= zaun.n && !z.text.slice(m[0].length).trim()) zaun = null;
      continue;
    }
    if (m) { zaun = { z: m[1][0], n: m[1].length }; art[i] = "code"; davorLeer = false; davorCode = true; continue; }
    const leer = !z.text.trim();
    if (leer) { art[i] = "leer"; davorLeer = true; continue; }
    if (!inListe && einzug(z.text) >= 4 && (davorLeer || davorCode)) { art[i] = "code"; davorLeer = false; davorCode = true; continue; }
    if (/^\s*([-*+]|\d+[.)])\s/.test(z.text)) inListe = true; else if (einzug(z.text) === 0) inListe = false;
    davorLeer = false; davorCode = false;
  }
  // 2. Was ist Inline-Code (auch über Zeilengrenzen eines Absatzes) oder ein HTML-Kommentar? Globale Bereiche [von, bis)
  const maske = [];
  for (const k of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) maske.push([k.index, k.index + k[0].length]);
  for (let i = 0; i < zeilen.length;) {
    if (art[i] !== "text" && art[i] !== "kopf") { i++; continue; }
    let j = i;
    while (j + 1 < zeilen.length && art[j + 1] === art[i]) j++;
    const starts = []; let acc = 0;
    const teile = [];
    for (let k = i; k <= j; k++) { starts.push(acc); teile.push(zeilen[k].text); acc += zeilen[k].text.length + 1; }
    const wo = (idx) => { let k = starts.length - 1; while (k > 0 && starts[k] > idx) k--; return zeilen[i + k].pos + (idx - starts[k]); };
    for (const [a1, b1] of codeBereiche(teile.join("\n"))) maske.push([wo(a1), wo(b1 - 1) + 1]);
    i = j + 1;
  }
  const imCode = (g) => maske.some(([a1, b1]) => g >= a1 && g < b1);
  // 3. Verweise
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (art[i] !== "text" && art[i] !== "kopf") continue;
    const imKopf = art[i] === "kopf";
    if (!z.text.includes("[")) continue;
    WIKI.lastIndex = 0;
    let m;
    while ((m = WIKI.exec(z.text))) {
      if (imCode(z.pos + m.index)) continue;
      const innenVon = m.index + m[1].length + 2;
      const inner = m[2];
      const stopp = inner.search(/[|#^]/);
      let zeig = stopp < 0 ? inner.length : stopp;
      // „\|“ (Tabellen) und Leerraum gehören nicht zum Ziel
      let a = 0, b = zeig;
      while (b > a && inner[b - 1] === "\\") b--;
      while (b > a && /\s/.test(inner[b - 1])) b--;
      while (a < b && /\s/.test(inner[a])) a++;
      if (b <= a) continue;
      aus.push({ art: "wiki", einbettung: m[1] === "!", start: z.pos + m.index, ende: z.pos + m.index + m[0].length, zielVon: z.pos + innenVon + a, zielBis: z.pos + innenVon + b,
        ziel: inner.slice(a, b), innenEnde: z.pos + innenVon + inner.length, hatAnzeige: /\\?\|/.test(inner.slice(zeig)), zeile: z.nr, kopf: imKopf, tabelle: /^\s*\|/.test(z.text) });
    }
    if (imKopf) continue;
    MD_ANFANG.lastIndex = 0;
    while ((m = MD_ANFANG.exec(z.text))) {
      if (imCode(z.pos + m.index)) continue;
      if (m.index > 0 && z.text[m.index - 1] === "[" && !m[1]) continue; // [[x]](y): kein Markdown-Link
      const zi = mdZiel(z.text, m.index + m[0].length);
      if (!zi) continue;
      const roh = z.text.slice(zi.von, zi.bis);
      if (!roh || /^[a-z][a-z0-9+.-]*:/i.test(roh) || roh.startsWith("//") || roh.startsWith("#") || roh.startsWith("/") || roh.startsWith("?")) continue;
      const rest = roh.search(/[#?]/);
      const pfadTeil = rest < 0 ? roh : roh.slice(0, rest);
      if (!pfadTeil) continue;
      aus.push({ art: "md", einbettung: m[1] === "!", start: z.pos + m.index, ende: z.pos + zi.ende, zielVon: z.pos + zi.von, zielBis: z.pos + zi.von + pfadTeil.length, ziel: pfadTeil, spitz: zi.spitz, zeile: z.nr, kopf: false });
      MD_ANFANG.lastIndex = Math.max(MD_ANFANG.lastIndex, m.index + m[0].length);
    }
  }
  return aus;
}

/** Ersetzungen { von, bis, text } auf einen Text anwenden (von hinten nach vorn, damit die Positionen stimmen). */
export function ersetze(text, aenderungen) {
  const liste = [...aenderungen].sort((a, b) => b.von - a.von || b.bis - a.bis);
  let aus = text;
  for (const e of liste) aus = aus.slice(0, e.von) + e.text + aus.slice(e.bis);
  return aus;
}

// ───────────────────────────── Titel ändern ─────────────────────────────

const ohneZeilenumbruch = (s) => String(s).replace(/[\r\n]+/g, " ").trim();
function yamlWert(neu, alt) {
  const t = ohneZeilenumbruch(neu);
  const q = /^\s*(["'])/.exec(alt)?.[1];
  if (q === '"') return `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (q === "'") return `'${t.replace(/'/g, "''")}'`;
  if (/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(t) || /:\s|\s#|:$/.test(t) || /^(true|false|null|yes|no|~)$/i.test(t)) return `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return t;
}

/**
 * Setzt den Titel einer Notiz so, wie ihn der Notiz-Index liest (notizen.mjs#titelAus): erste Überschrift „# …“ außerhalb von Code-Blöcken, sonst title/titel/name im Kopf.
 * → { text, geaendert: true } oder { text (unverändert), geaendert: false } (keine Quelle für den Titel: er stammt aus dem Dateinamen).
 */
export function setzeTitel(text, titel) {
  const neu = ohneZeilenumbruch(titel);
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const k = parseKopf(text.slice(bom));
  const zeilen = [];
  for (let pos = bom; pos < text.length;) {
    const nl = text.indexOf("\n", pos);
    const ende = nl < 0 ? text.length : nl + 1;
    let ie = nl < 0 ? text.length : nl;
    if (ie > pos && text[ie - 1] === "\r") ie--;
    zeilen.push({ pos, text: text.slice(pos, ie) });
    pos = ende;
  }
  let zaun = null;
  for (let i = k.bis; i < zeilen.length; i++) {
    const m0 = FENCE.exec(zeilen[i].text);
    if (zaun) { if (m0 && m0[1][0] === zaun.z && m0[1].length >= zaun.n && !zeilen[i].text.slice(m0[0].length).trim()) zaun = null; continue; }
    if (m0) { zaun = { z: m0[1][0], n: m0[1].length }; continue; }
    const m = /^(#\s+)(.+?)(\s*#*\s*)$/.exec(zeilen[i].text);
    if (m) return { text: ersetze(text, [{ von: zeilen[i].pos, bis: zeilen[i].pos + zeilen[i].text.length, text: m[1] + neu + m[3] }]), geaendert: true };
  }
  // Kopf: der erste nicht leere Schlüssel in der Reihenfolge title, titel, name
  if (k.bis > 0) {
    for (const schluessel of ["title", "titel", "name"]) {
      for (let i = 1; i < k.bis - 1; i++) {
        const m = new RegExp(`^(\\s*(["']?)${schluessel}\\2\\s*:[ \\t]*)(.*)$`, "i").exec(zeilen[i].text);
        if (!m) continue;
        const wert = m[3];
        if (!wert.trim() || /^[>|][+-]?\d*\s*$/.test(wert.trim()) || wert.trim().startsWith("[") || wert.trim().startsWith("#")) return { text, geaendert: false };
        // Kommentar am Zeilenende erhalten (nur bei unquotiertem Wert nach „ #“, bei quotiertem nach dem schließenden Zeichen)
        let alt = wert, kommentar = "";
        const q = /^(["'])/.exec(wert)?.[1];
        if (q) { const e = wert.indexOf(q, 1); if (e > 0) { alt = wert.slice(0, e + 1); kommentar = wert.slice(e + 1); } }
        else { const c = wert.search(/\s+#/); if (c >= 0) { alt = wert.slice(0, c); kommentar = wert.slice(c); } }
        return { text: ersetze(text, [{ von: zeilen[i].pos + m[1].length, bis: zeilen[i].pos + zeilen[i].text.length, text: yamlWert(neu, alt) + kommentar }]), geaendert: true };
      }
    }
  }
  return { text, geaendert: false };
}

/** Aliasse einer Notiz (aliases / alias / auch_genannt), wie der Notiz-Index sie liest. */
export function aliasseAus(text) {
  const k = parseKopf(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const fl = {};
  for (const [s, v] of Object.entries(k.felder)) fl[falte(s)] = v;
  return [fl.aliases, fl.alias, fl.auch_genannt].flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : [])).map((a) => String(a).trim()).filter(Boolean);
}

// ───────────────────────────── Pfade ─────────────────────────────

/** Relativer Pfad → Segmente ab `vonDir`, oder null, wenn er aus dem Vault führt. */
export function loeseRelativ(vonDir, ziel) {
  const seg = vonDir ? vonDir.split("/") : [];
  for (const s of ziel.split("/")) { if (s === "" || s === ".") continue; if (s === "..") { if (!seg.length) return null; seg.pop(); } else seg.push(s); }
  return seg;
}
/** Pfad von Ordner `vonDir` nach `zielPfad` (beide relativ zum Vault, ohne führenden Schrägstrich). */
export function relativerPfad(vonDir, zielPfad) {
  const a = vonDir ? vonDir.split("/") : [], b = zielPfad.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && falte(a[i]) === falte(b[i])) i++;
  return "../".repeat(a.length - i) + b.slice(i).join("/");
}
const dekodiere = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
function kodiereWieVorlage(neu, vorlageRoh, spitz) {
  const wieProzent = /%[0-9A-Fa-f]{2}/.test(vorlageRoh);
  // „%“, „#“ und „?“ gehören im Pfad immer kodiert (sonst wären sie Escape, Abschnitt oder Abfrage); Klammern immer, Leerzeichen nur ohne <…>
  return neu.split("/").map((seg) => {
    let t = wieProzent && !spitz ? encodeURIComponent(seg) : seg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
    if (!spitz) t = t.replace(/ /g, "%20");
    return t.replace(/\(/g, "%28").replace(/\)/g, "%29");
  }).join("/");
}

// ───────────────────────────── Plan ─────────────────────────────

const mitAnker = (ziel) => /[|#^\n\[\]]/.test(ziel);

// Welcher Text in den Klammern führt von der Notiz im Ordner `vonDir` sicher zu `pfadNeu`? Erst im Stil des alten Textes (Name, Titel, Pfad, relativ), dann sicherer.
function waehleZiel(orig, pfadNeu, index1, vonDir1, altName, altTitel) {
  const e = index1.nachPfad.get(pfadNeu);
  if (!e) return null;
  const mitEnde = ENDUNG.test(orig);
  const endung = pfadNeu.slice(e.ohne.length);
  const fmt = (s) => (mitEnde ? s + endung : s);
  const liste = [];
  const ohneOrig = orig.replace(ENDUNG, "");
  if (orig.startsWith("./") || orig.startsWith("../")) liste.push(fmt(relativerPfad(vonDir1, e.ohne)));
  if (orig.includes("/")) {
    const n = ohneOrig.split("/").filter(Boolean).length;
    if (n >= 1 && n <= e.teile.length) liste.push(fmt(e.teile.slice(-n).join("/")));
  } else {
    const name = e.teile[e.teile.length - 1];
    // Im Stil des alten Textes: war es der Dateiname (genau), dann der neue Dateiname zuerst; war es der Titel, der neue Titel; sonst nach der toleranten Form
    const genauName = falte(ohneOrig) === falte(altName), genauTitel = !!altTitel && falte(ohneOrig) === falte(altTitel);
    const wieName = lockerFormen(ohneOrig).some((f) => lockerFormen(altName).includes(f));
    const wieTitel = !!altTitel && lockerFormen(ohneOrig).some((f) => lockerFormen(altTitel).includes(f));
    const nameZuerst = genauName ? true : genauTitel ? false : wieName && !wieTitel;
    if (nameZuerst) liste.push(fmt(name), e.titel);
    else liste.push(e.titel, fmt(name));
  }
  liste.push(fmt(e.ohne), e.ohne, pfadNeu);
  const gesehen = new Set();
  for (const c of liste) {
    if (!c || gesehen.has(c) || mitAnker(c) || c !== c.trim()) continue;
    gesehen.add(c);
    if (findeWikiZiel(index1, c, vonDir1)?.pfad === pfadNeu) return c;
  }
  return null;
}

/**
 * Plan der Link-Pflege.
 *   notizen:  [{ pfad, text }]  alle Notizen mit ihrem Stand VOR der Änderung
 *   abb(p):   alter Pfad → neuer Pfad (für Dateien und Ordner; sonst derselbe)
 *   neueTexte: Map(alter Pfad → Text, wie er NACH der Änderung des Titels aussieht) — nur für Notizen, deren Titel sich ändert (für den neuen Index)
 *   existiert(p): gibt es diese Datei oder diesen Ordner im Vault (für Markdown-Links einer verschobenen Notiz)
 * → Map(alter Pfad → { text (neu), verweise: [{ zeile, vorher, nachher, art }] })  — nur Notizen mit Änderungen
 */
export function planeVerweise({ notizen, abb, neueTexte = new Map(), existiert = () => false }) {
  const eintraege0 = [], eintraege1 = [];
  for (const n of notizen) {
    const t1 = neueTexte.get(n.pfad) ?? n.text;
    eintraege0.push({ pfad: n.pfad, titel: titelAus(n.pfad, n.text.slice(n.text.charCodeAt(0) === 0xfeff ? 1 : 0)), aliasse: aliasseAus(n.text) });
    eintraege1.push({ pfad: abb(n.pfad), titel: titelAus(abb(n.pfad), t1.slice(t1.charCodeAt(0) === 0xfeff ? 1 : 0)), aliasse: aliasseAus(t1) });
  }
  const index0 = baueWikiIndex(eintraege0), index1 = baueWikiIndex(eintraege1);
  const ergebnis = new Map();
  for (const n of notizen) {
    if (!n.text.includes("[[") && !n.text.includes("](")) continue;
    const pfad1 = abb(n.pfad), v0 = ordnerVonPfad(n.pfad), v1 = ordnerVonPfad(pfad1);
    const verweise = findeVerweise(n.text);
    if (!verweise.length) continue;
    const aend = [], zeigen = [];
    for (const l of verweise) {
      const lokal = [];
      if (l.art === "wiki") {
        const ziel = l.ziel;
        if (/\.[A-Za-z0-9]{1,8}$/.test(ziel) && !ENDUNG.test(ziel)) { // Anhang (Bild, PDF …): nur Pfade, nur wenn es ihn gibt
          if (!ziel.includes("/")) continue;
          const p = ziel.replace(/^\/+/, "");
          const neu = abb(p);
          if (neu !== p && existiert(p)) lokal.push({ von: l.zielVon, bis: l.zielBis, text: neu });
        } else {
          const alt = findeWikiZiel(index0, ziel, v0);
          if (!alt) continue;
          const erwartet = abb(alt.pfad);
          const jetzt = findeWikiZiel(index1, ziel, v1);
          if (jetzt && jetzt.pfad === erwartet) continue;
          const neuZiel = waehleZiel(ziel, erwartet, index1, v1, alt.pfad.split("/").pop().replace(ENDUNG, ""), alt.titel);
          if (neuZiel === null) continue;
          lokal.push({ von: l.zielVon, bis: l.zielBis, text: neuZiel });
          // Die Anzeige soll bleiben, wenn der Link nur wegen eines Ordners eindeutig gemacht werden musste („Kaffee“ → „a/Kaffee|Kaffee“)
          const e1 = index1.nachPfad.get(erwartet);
          if (!l.hatAnzeige && !ziel.includes("/") && neuZiel.includes("/") && e1 && [e1.titel, e1.teile[e1.teile.length - 1]].some((x) => falte(x) === falte(ziel.replace(ENDUNG, "")))) {
            lokal.push({ von: l.innenEnde, bis: l.innenEnde, text: (l.tabelle ? "\\|" : "|") + ziel });
          }
        }
      } else {
        const roh = dekodiere(l.ziel);
        const seg = loeseRelativ(v0, roh);
        if (!seg) continue;
        const p = seg.join("/");
        const neuP = abb(p);
        const bewegt = v1 !== v0;
        if (neuP === p && !bewegt) continue;
        if (neuP === p && !existiert(p)) continue; // toter Link: bleibt wie er ist
        const aktuell = loeseRelativ(v1, roh);
        if (aktuell && aktuell.join("/") === neuP) continue; // zeigt von selbst richtig
        let rel = relativerPfad(v1, neuP);
        // Wurde nur der Name der Datei geändert (derselbe Ordner), bleibt der Weg dorthin, wie er geschrieben war („../10/x.md“ → „../10/y.md“)
        const rest = roh.lastIndexOf("/");
        if (rest >= 0 && ordnerVonPfad(neuP) === ordnerVonPfad(p) && v1 === v0) rel = roh.slice(0, rest + 1) + neuP.split("/").pop();
        else if (roh.startsWith("./") && !rel.startsWith(".")) rel = "./" + rel;
        lokal.push({ von: l.zielVon, bis: l.zielBis, text: kodiereWieVorlage(rel, l.ziel, l.spitz) });
      }
      if (!lokal.length) continue;
      aend.push(...lokal);
      zeigen.push({ l, lokal });
    }
    if (!aend.length) continue;
    const text = ersetze(n.text, aend);
    ergebnis.set(n.pfad, { text, verweise: zeigen.map(({ l, lokal }) => ({ zeile: l.zeile, art: l.art, einbettung: l.einbettung,
      vorher: n.text.slice(l.start, l.ende), nachher: ersetze(n.text.slice(l.start, l.ende), lokal.map((x) => ({ von: x.von - l.start, bis: x.bis - l.start, text: x.text }))) })) });
  }
  return ergebnis;
}

/** Wer verlinkt auf einen der Pfade in `ziele` (alte Pfade, Datei oder Ordner)? → [{ pfad, anzahl }] (ohne die Notizen selbst, die in `ziele` liegen). */
export function verlinktVon({ notizen, ziele, existiert = () => false }) {
  const pfade = ziele.slice();
  const liegtDrin = (p) => pfade.some((z) => p === z || p.startsWith(z + "/"));
  const index = baueWikiIndex(notizen.map((n) => ({ pfad: n.pfad, titel: titelAus(n.pfad, n.text.slice(n.text.charCodeAt(0) === 0xfeff ? 1 : 0)), aliasse: aliasseAus(n.text) })));
  const aus = [];
  for (const n of notizen) {
    if (liegtDrin(n.pfad) || (!n.text.includes("[[") && !n.text.includes("]("))) continue;
    const v = ordnerVonPfad(n.pfad);
    let anzahl = 0;
    for (const l of findeVerweise(n.text)) {
      if (l.art === "wiki") {
        if (/\.[A-Za-z0-9]{1,8}$/.test(l.ziel) && !ENDUNG.test(l.ziel)) { if (l.ziel.includes("/") && liegtDrin(l.ziel.replace(/^\/+/, "")) && existiert(l.ziel.replace(/^\/+/, ""))) anzahl++; continue; }
        const z = findeWikiZiel(index, l.ziel, v);
        if (z && liegtDrin(z.pfad)) anzahl++;
      } else {
        const seg = loeseRelativ(v, dekodiere(l.ziel));
        if (seg && liegtDrin(seg.join("/"))) anzahl++;
      }
    }
    if (anzahl) aus.push({ pfad: n.pfad, anzahl });
  }
  return aus;
}
