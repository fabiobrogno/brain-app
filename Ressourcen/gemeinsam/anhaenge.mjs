// gemeinsam/anhaenge.mjs — Anhänge einer Notiz (Bilder, PDFs, Dateien) auf der Platte: speichern, auflösen, prüfen, aufräumen (Paket 3a, Runde 3).
// Die Regeln, die auch das Studio braucht (Typen, Namen, Schreibweise der Einbettung), stehen in anhang-regeln.mjs; hier nur, was Dateizugriff und Netz braucht.
//
//   speichereAnhang   Bytes prüfen (Größe, Typ am Inhalt, SVG bereinigen) und unter einem eindeutigen Namen im Anhänge-Ordner ablegen (nie überschreiben)
//   loeseAnhang       `![[name.png]]` / `![](pfad)` → Datei im Vault (Ordner der Notiz, Anhänge-Ordner, sonst überall im Vault; immer innerhalb des Vaults)
//   unbenutzteAnhaenge  Anhänge, die nur diese Notiz benutzt (für die Rückfrage beim Löschen der Notiz)
//   bereinigeSvg      SVG ohne Skripte, Fremdinhalt und Verweise nach außen
//   holeExternBild    ein Bild von einer https-Adresse holen (nur nach Zustimmung; keine privaten Adressen, begrenzt)
import { readdirSync, readFileSync, statSync, lstatSync, mkdirSync, writeFileSync, openSync, closeSync, constants as fsKonst } from "node:fs";
import { join, basename } from "node:path";
import { isIP, BlockList } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import http from "node:http";
import { HttpFehler, loese, falte, gesperrterName, BEARBEITBAR } from "./basis.mjs";
import { BILD_TYPEN, DATEI_TYPEN, ANHANG_TYPEN, endungVon, istBildName, istAnhangName, mimeFuer, slugAnhang, zeitstempel, groesseText, einbettungsText,
  EINBETTUNG, einbettungAus, istAdresse, lokalerPfad, MAX_MB_STANDARD, MAX_MB_GRENZE, GROSS_HINWEIS_BYTES } from "./anhang-regeln.mjs";
import { findeVerweise, loeseRelativ } from "./linkpflege.mjs";

export { ANHANG_TYPEN, BILD_TYPEN, DATEI_TYPEN, endungVon, istBildName, istAnhangName, mimeFuer, groesseText };

export const ORDNER_STANDARD = "_anhaenge";

// ───────────────────────────── Einstellungen ─────────────────────────────
// werte: Einstellungen der App (anhaengeOrt: "vault" | "notiz", anhaengeOrdner, anhaengeMaxMB). Ungültiges fällt auf den Standard zurück.
export function anhangEinstellungen(werte = {}) {
  const ort = werte.anhaengeOrt === "notiz" ? "notiz" : "vault";
  const teile = String(werte.anhaengeOrdner ?? "").split("/").map((t) => t.trim()).filter((t) => t && t !== ".");
  const ok = teile.length > 0 && teile.length <= 4 && teile.every((t) => t !== ".." && !t.startsWith(".") && !/[\\\0:*?"<>|]/.test(t) && falte(t) !== "node_modules");
  const mb = Number.isInteger(werte.anhaengeMaxMB) ? Math.max(1, Math.min(MAX_MB_GRENZE, werte.anhaengeMaxMB)) : MAX_MB_STANDARD;
  return { ort, ordner: ok ? teile.join("/") : ORDNER_STANDARD, maxBytes: mb * 1024 * 1024, maxMB: mb, externeBilder: werte.externeBilder === true };
}

// ───────────────────────────── Inhalt prüfen ─────────────────────────────
const beginnt = (buf, bytes, ab = 0) => buf.length >= ab + bytes.length && bytes.every((b, i) => buf[ab + i] === b);
const ascii = (buf, von, bis) => buf.subarray(von, bis).toString("latin1");

// Ist der Text (ohne Byte-Reihenfolge-Marke) gültiges UTF-8 ohne NUL-Zeichen?
function istText(buf) {
  const probe = buf.subarray(0, Math.min(buf.length, 65536));
  if (probe.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(probe); return true; }
  catch (e) { // ein mitten im Zeichen abgeschnittenes Ende zählt nicht als Fehler
    return buf.length > probe.length && probe.length > 4 && (() => { try { new TextDecoder("utf-8", { fatal: true }).decode(probe.subarray(0, probe.length - 3)); return true; } catch { return false; } })();
  }
}
const istSvgText = (buf) => /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, ""));

/** Welche Art Datei sind die Bytes? → Endung ("png" …) oder null. Nur Bilder werden sicher unterschieden; für Dokumente zählt die Familie (zip, ole, text). */
export function erkenneInhalt(buf) {
  if (beginnt(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (beginnt(buf, [0xff, 0xd8, 0xff])) return "jpg";
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return "gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "webp";
  if (ascii(buf, 0, 5) === "%PDF-") return "pdf";
  if (beginnt(buf, [0x50, 0x4b, 0x03, 0x04]) || beginnt(buf, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (beginnt(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (ascii(buf, 0, 5) === "{\\rtf") return "rtf";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "wav";
  if (ascii(buf, 4, 8) === "ftyp") return "mp4";
  if (beginnt(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(buf, 0, 3) === "ID3" || (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "mp3";
  if (istSvgText(buf)) return "svg";
  if (istText(buf)) return "text";
  return null;
}

const FAMILIE = {
  pdf: ["pdf"], zip: ["zip"], docx: ["zip"], xlsx: ["zip"], pptx: ["zip"], odt: ["zip"], ods: ["zip"], odp: ["zip"],
  doc: ["ole"], xls: ["ole"], ppt: ["ole"], rtf: ["rtf"], txt: ["text"], csv: ["text"],
  wav: ["wav"], mp3: ["mp3"], mp4: ["mp4"], m4a: ["mp4"], mov: ["mp4"], webm: ["webm"],
};
const BILD_INHALT = new Set(["png", "jpg", "gif", "webp", "svg"]);

/**
 * Name und Bytes prüfen → { endung, art: "bild"|"datei", mime }. Wirft HttpFehler:
 *   413 zu groß · 415 Typ nicht erlaubt oder Inhalt passt nicht zum Namen · 400 leer
 * Bilder erkennt Kortex am Inhalt (eine PNG-Datei namens „x.jpg“ wird als png abgelegt); Dokumente müssen zur Endung passen.
 */
export function pruefeAnhang({ name, buf, maxBytes = MAX_MB_STANDARD * 1024 * 1024 }) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpFehler(400, "Die Datei ist leer.", { art: "leer" });
  if (buf.length > maxBytes) throw new HttpFehler(413, `Die Datei ist ${groesseText(buf.length)} groß. Erlaubt sind ${groesseText(maxBytes)} (Einstellungen → Schreiben → Anhänge).`, { art: "zu-gross", groesse: buf.length, grenze: maxBytes });
  const inhalt = erkenneInhalt(buf);
  if (inhalt && BILD_INHALT.has(inhalt)) {
    const e = endungVon(name);
    // Ein Bild, das sich als Dokument ausgibt (z. B. „x.pdf“ mit PNG-Inhalt), wird nicht als Dokument abgelegt: der Inhalt zählt
    if (e && !Object.hasOwn(BILD_TYPEN, e) && Object.hasOwn(DATEI_TYPEN, e)) throw new HttpFehler(415, "Der Inhalt der Datei passt nicht zu ihrem Namen.", { art: "typ-passt-nicht" });
    return { endung: inhalt, art: "bild", mime: BILD_TYPEN[inhalt] };
  }
  const e = endungVon(name);
  if (!e || !Object.hasOwn(ANHANG_TYPEN, e)) throw new HttpFehler(415, `Dateien vom Typ „${e ? "." + e : "ohne Endung"}“ legt Kortex nicht ab (erlaubt: Bilder, PDF, Office-Dateien, Text, Archive, Audio und Video).`, { art: "typ", endung: e });
  if (Object.hasOwn(BILD_TYPEN, e)) throw new HttpFehler(415, "Der Inhalt der Datei ist kein gültiges Bild.", { art: "typ-passt-nicht" });
  if (!inhalt || !FAMILIE[e].includes(inhalt)) throw new HttpFehler(415, "Der Inhalt der Datei passt nicht zu ihrem Namen.", { art: "typ-passt-nicht" });
  return { endung: e, art: "datei", mime: DATEI_TYPEN[e] };
}

// ───────────────────────────── SVG bereinigen ─────────────────────────────
// Whitelist: nur Zeichen- und Formelemente. Skripte, Fremdinhalt (foreignObject, iframe …), Animationen (SMIL kann Adressen ändern), Links (a) und alles mit Adresse nach außen entfällt;
// Attribute `on…`, Adressen außer `#id` und Rasterbildern als data:, `url(…)` außer `url(#id)`, `javascript:` und `@import` entfallen.
const SVG_ELEMENTE = new Set(["svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath", "lineargradient", "radialgradient", "stop",
  "clippath", "mask", "pattern", "marker", "title", "desc", "image", "filter", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix", "fediffuselighting",
  "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr", "fegaussianblur", "femerge", "femergenode", "femorphology", "feoffset", "fepointlight",
  "fespecularlighting", "fespotlight", "fetile", "feturbulence"]);
// <style> entfällt samt Inhalt (CSS lässt sich mit Escapes, image-set(), @import … nicht sicher prüfen); ebenso jedes style-Attribut mit „(“, „\“ oder „@“ (siehe bereinigeAttribute)
const SVG_MIT_INHALT_WEG = new Set(["style", "script", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas", "animate", "set", "animatetransform", "animatemotion", "handler", "listener", "feimage", "html", "head"]);
const ENTITAETEN = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: "\t", newline: "\n" };
function entkodiere(s) {
  return String(s).replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (m, h, d, n) => {
    if (h !== undefined || d !== undefined) { const c = Number.parseInt(h ?? d, h !== undefined ? 16 : 10); return Number.isFinite(c) && c <= 0x10ffff ? String.fromCodePoint(c) : ""; }
    return Object.hasOwn(ENTITAETEN, n.toLowerCase()) ? ENTITAETEN[n.toLowerCase()] : m;
  });
}
// CSS-Escapes („\75 rl(“ = „url(“) vor der Prüfung auflösen
const cssKlar = (s) => String(s).replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g, (m, h) => { const c = Number.parseInt(h, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ""; }).replace(/\\(.)/gs, "$1");
const klar = (s) => cssKlar(entkodiere(s)).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+/g, "").toLowerCase();
const gefaehrlicherWert = (wert) => {
  const k = klar(wert);
  if (/javascript:|vbscript:|data:text|data:application|data:image\/svg|@import|expression\(|-moz-binding|behavior:|image-set\(|image\(|cross-fade\(|element\(|src\(/.test(k)) return true;
  for (const m of k.matchAll(/url\(([^)]*)\)/g)) { const u = m[1].replace(/^["']|["']$/g, ""); if (!u.startsWith("#")) return true; }
  return false;
};
const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/;
const esc = (s) => String(s).replace(/&(?!#?\w+;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textEsc = (s) => String(s).replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function bereinigeAttribute(roh, element) {
  const aus = [];
  const re = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of roh.matchAll(re)) {
    const name = m[1], wert = m[2] ?? m[3] ?? m[4] ?? "";
    const n = name.toLowerCase();
    if (!/^[a-z_][a-z0-9:._-]*$/i.test(name) || n.startsWith("on")) continue;
    if (n === "href" || n === "xlink:href") {
      const v = entkodiere(wert).trim();
      if (v.startsWith("#") || (element === "image" && RASTER_DATA.test(klar(v)))) aus.push(`${name}="${esc(v)}"`);
      continue;
    }
    if (n.startsWith("xmlns")) { if (n === "xmlns" && wert === "http://www.w3.org/2000/svg") aus.push(`xmlns="${wert}"`); else if (n === "xmlns:xlink" && wert === "http://www.w3.org/1999/xlink") aus.push(`xmlns:xlink="${wert}"`); continue; }
    if (n === "style" && /[(\\@]/.test(entkodiere(wert))) continue; // Style-Attribut mit Funktion, Escape oder @-Regel: weg
    if (n === "src" || n === "action" || n === "formaction" || n === "begin" || n === "end" || n === "from" || n === "to" || n === "values") continue;
    if (gefaehrlicherWert(wert)) continue;
    aus.push(wert === "" && m[2] === undefined && m[3] === undefined && m[4] === undefined ? name : `${name}="${esc(entkodiere(wert))}"`);
  }
  return aus.length ? " " + aus.join(" ") : "";
}

/** SVG-Text → bereinigter SVG-Text. Wirft HttpFehler 415, wenn danach kein <svg> übrig ist. */
export function bereinigeSvg(text) {
  // DOCTYPE samt innerer Teilmenge (<!ENTITY …>) entfällt vor allem anderen: eigene Entitäten gibt es nicht
  const quelle = String(text).replace(/^﻿/, "").replace(/<!DOCTYPE(?:[^>\[]|\[[\s\S]*?\])*>/gi, "");
  const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|<|[^<]+/g;
  const aus = [];
  const stapel = []; // geöffnete, behaltene Elemente
  let weg = 0, wegName = null; // Tiefe eines verworfenen Elements samt Inhalt
  let imStyle = 0, hatSvg = false, gesehen = false; // hatSvg: gerade im Wurzelelement
  for (const m of quelle.matchAll(TOKEN)) {
    const t = m[0];
    const istTag = m[3] !== undefined;
    if (!istTag) {
      if (weg || !hatSvg) continue; // verworfenes Element oder Text vor/hinter dem Wurzelelement
      if (t.startsWith("<!--") || t.startsWith("<!") && !t.startsWith("<![CDATA[") || t.startsWith("<?")) continue; // Kommentar, DOCTYPE/ENTITY, Verarbeitungsanweisung
      if (t === "<") { aus.push("&lt;"); continue; }
      const inhalt = t.startsWith("<![CDATA[") ? m[1] : t;
      if (imStyle) { const css = entkodiere(inhalt); if (!gefaehrlicherWert(css)) aus.push(textEsc(css)); continue; }
      aus.push(textEsc(t.startsWith("<![CDATA[") ? inhalt : t));
      continue;
    }
    const schliessend = m[2] === "/", name = m[3], n = name.toLowerCase().replace(/^svg:/, ""), selbst = m[5] === "/";
    if (weg) {
      if (n === wegName) { if (schliessend) weg--; else if (!selbst) weg++; }
      continue;
    }
    if (SVG_MIT_INHALT_WEG.has(n)) { if (!schliessend && !selbst) { weg = 1; wegName = n; } continue; }
    if (!SVG_ELEMENTE.has(n)) continue; // unbekanntes Element: nur das Tag entfällt, der Inhalt bleibt Text
    if (schliessend) {
      const i = stapel.lastIndexOf(n);
      if (i < 0) continue;
      while (stapel.length > i + 1) aus.push(`</${stapel.pop()}>`);
      stapel.pop();
      if (n === "style") imStyle = 0;
      aus.push(`</${n}>`);
      if (!stapel.length) hatSvg = false; // das Wurzelelement ist zu: danach steht nichts mehr
      continue;
    }
    if (n === "svg") { hatSvg = true; gesehen = true; }
    if (!hatSvg) continue; // vor dem Wurzelelement steht nichts
    const attr = bereinigeAttribute(m[4], n);
    if (selbst) { aus.push(`<${n}${attr}/>`); if (!stapel.length) hatSvg = false; continue; }
    stapel.push(n);
    if (n === "style") imStyle = 1;
    aus.push(`<${n}${attr}>`);
  }
  while (stapel.length) aus.push(`</${stapel.pop()}>`);
  const ergebnis = aus.join("");
  if (!gesehen || !/<svg[\s>]/.test(ergebnis)) throw new HttpFehler(415, "Das ist keine gültige SVG-Datei.", { art: "svg" });
  return ergebnis;
}

// ───────────────────────────── Ablage ─────────────────────────────
// Alle Dateien des Vaults mit Anhang-Endung (einmal gelaufen, kurz gemerkt): Name (gefaltet) → [relative Pfade]. Versteckte Ordner, node_modules und Verweise (Symlinks) bleiben außen vor.
const MAX_EINTRAEGE = 200_000;
const indexCache = new Map(); // wurzel → { zeit, index }
const INDEX_FRIST_MS = 3000;
export function vergissAnhangIndex(wurzel) { if (wurzel) indexCache.delete(wurzel); else indexCache.clear(); }
export function baueAnhangIndex(wurzel, { frisch = false } = {}) {
  const c = indexCache.get(wurzel);
  if (!frisch && c && Date.now() - c.zeit < INDEX_FRIST_MS) return c.index;
  const index = new Map();
  let zaehler = 0;
  const geh = (rel) => {
    let liste; try { liste = readdirSync(rel ? join(wurzel, rel) : wurzel, { withFileTypes: true }); } catch { return; }
    for (const d of liste) {
      if (++zaehler > MAX_EINTRAEGE) return;
      if (gesperrterName(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) geh(r);
      else if (d.isFile() && istAnhangName(d.name)) { const k = falte(d.name); (index.get(k) || index.set(k, []).get(k)).push(r); }
    }
  };
  geh("");
  for (const l of index.values()) l.sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1));
  indexCache.set(wurzel, { zeit: Date.now(), index });
  return index;
}

const ordnerVon = (p) => { const i = String(p).lastIndexOf("/"); return i < 0 ? "" : String(p).slice(0, i); };
// Einfach statt klug: eine Verknüpfung (Symlink) ist nie ein Anhang — weder die Datei selbst noch ein Ordner davor. Nur eine gewöhnliche Datei zählt (kein Ordner, kein Bundle).
// Kein Auflösen: sonst käme über „doc.pdf → tool.command“ oder „x.txt → .git/config“ etwas in die Anzeige oder zum Öffnen, das der Name verschweigt.
function reineDatei(wurzel, segmente) {
  let p = wurzel;
  for (let i = 0; i < segmente.length; i++) {
    p = join(p, segmente[i]);
    let st; try { st = lstatSync(p); } catch { return false; }
    if (st.isSymbolicLink()) return false;
    if (i === segmente.length - 1) return st.isFile();
    if (!st.isDirectory()) return false;
  }
  return false;
}

/**
 * Wohin zeigt dieses Ziel einer Einbettung? → { rel, abs } oder null (gibt es nicht, kein Anhang-Typ, außerhalb des Vaults).
 *   wurzel: echter Vault-Pfad · von: Pfad der Notiz mit der Einbettung (relativ zum Vault, darf leer sein) · ziel: Name oder Pfad wie im Text · ordner: Anhänge-Ordner (Einstellung)
 * Reihenfolge: Pfad relativ zur Notiz → Pfad ab Vault-Wurzel → Name im Ordner der Notiz → Name im Anhänge-Ordner (Notiz, dann Wurzel) → Name irgendwo im Vault (nächster Ordner zuerst).
 */
export function loeseAnhang(wurzel, { von = "", ziel, ordner = ORDNER_STANDARD, index = null } = {}) {
  let z = typeof ziel === "string" ? ziel.trim().replace(/\\/g, "/") : "";
  if (!z || z.includes("\0") || z.length > 1000 || istAdresse(z) || !istAnhangName(z)) return null;
  const vonDir = ordnerVon(von);
  const pruefe = (rel) => {
    if (!rel || rel.split("/").some((t) => !t || t === "." || t === ".." || gesperrterName(t))) return null;
    try { const l = loese(wurzel, rel); return l.segmente.every((t) => !gesperrterName(t)) && reineDatei(wurzel, l.segmente) && istAnhangName(l.rel) ? { rel: l.rel, abs: l.abs } : null; } catch { return null; }
  };
  const kandidaten = [];
  if (z.includes("/")) {
    const rel = loeseRelativ(vonDir, z.replace(/^\/+/, ""));
    if (rel && !z.startsWith("/")) kandidaten.push(rel.join("/"));
    kandidaten.push(z.replace(/^\/+/, "").split("/").filter((t) => t && t !== ".").join("/"));
  } else {
    kandidaten.push(vonDir ? `${vonDir}/${z}` : z);
    if (vonDir) kandidaten.push(`${vonDir}/${ordner}/${z}`);
    kandidaten.push(`${ordner}/${z}`);
  }
  for (const k of kandidaten) { const r = pruefe(k); if (r) return r; }
  const name = z.split("/").pop();
  const treffer = (index || baueAnhangIndex(wurzel)).get(falte(name));
  if (!treffer || !treffer.length) return null;
  // Nächster Ordner zur Notiz zuerst (gemeinsamer Anfang des Pfads), dann der kürzere Pfad
  const gemein = (p) => { const a = ordnerVon(p).split("/"), b = vonDir.split("/"); let i = 0; while (i < a.length && i < b.length && falte(a[i]) === falte(b[i])) i++; return i; };
  const sortiert = treffer.slice().sort((a, b) => gemein(b) - gemein(a));
  for (const t of sortiert) { const r = pruefe(t); if (r) return r; }
  return null;
}

/** Wohin kommt ein neuer Anhang (Ordner relativ zum Vault)? */
export function anhangOrdnerFuer({ ort, ordner }, notizPfad = "") {
  const dir = ort === "notiz" ? ordnerVon(notizPfad) : "";
  return dir ? `${dir}/${ordner}` : ordner;
}

/**
 * Anhang speichern: prüfen, bei SVG bereinigen, unter `JJJJ-MM-TT-HHMMSS-<slug>.<endung>` im Anhänge-Ordner anlegen. Nie überschreiben: belegt (auch an einem anderen Ort im Vault) = Zähler `-2`, `-3` …
 * → { pfad, name, art, groesse, mime, einbettung, gross? }
 */
export function speichereAnhang({ wurzel, notiz = "", name, buf, einstellungen, jetzt = () => new Date() }) {
  const e = anhangEinstellungen(einstellungen);
  const befund = pruefeAnhang({ name, buf, maxBytes: e.maxBytes });
  let bytes = buf;
  if (befund.endung === "svg") bytes = Buffer.from(bereinigeSvg(buf.toString("utf8")), "utf8");
  const relOrdner = anhangOrdnerFuer(e, notiz);
  const ziel = loese(wurzel, relOrdner); // prüft: innerhalb des Vaults, kein versteckter Ort, kein Ausbruch über Verknüpfungen
  mkdirSync(ziel.abs, { recursive: true });
  const stamm = `${zeitstempel(jetzt())}-${slugAnhang(name)}`;
  const index = baueAnhangIndex(wurzel, { frisch: true });
  for (let n = 1; n < 1000; n++) {
    const datei = `${stamm}${n > 1 ? `-${n}` : ""}.${befund.endung}`;
    if (index.has(falte(datei))) continue; // eindeutig im ganzen Vault: die Auflösung über den Namen bleibt sicher
    const abs = join(ziel.abs, datei);
    let fd;
    try { fd = openSync(abs, fsKonst.O_WRONLY | fsKonst.O_CREAT | fsKonst.O_EXCL, 0o644); }
    catch (err) { if (err.code === "EEXIST") continue; throw new HttpFehler(500, `Der Anhang konnte nicht gespeichert werden (${err.code || err.message}).`); }
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    vergissAnhangIndex(wurzel);
    return { pfad: `${ziel.rel}/${datei}`, name: datei, art: befund.art, groesse: bytes.length, mime: befund.mime, einbettung: einbettungsText(datei), ...(bytes.length >= GROSS_HINWEIS_BYTES ? { gross: true } : {}) };
  }
  throw new HttpFehler(409, "Für diesen Anhang ließ sich kein freier Name finden.");
}

// ───────────────────────────── Verweise und unbenutzte Anhänge ─────────────────────────────
/** Alle Anhang-Ziele im Text einer Notiz (Wikilink-Einbettung und Markdown-Bild/-Link auf Anhang-Dateien; nicht in Code, nicht im Kopf): [{ ziel, art: "wiki"|"md" }] */
export function anhangZieleIn(text) {
  const aus = [];
  for (const v of findeVerweise(String(text))) {
    if (v.kopf) continue;
    if (v.art === "wiki") { if (istAnhangName(v.ziel)) aus.push({ ziel: v.ziel, art: "wiki" }); }
    else { const p = lokalerPfad(v.ziel); if (p && istAnhangName(p)) aus.push({ ziel: p, art: "md" }); }
  }
  return aus;
}

const MAX_NOTIZEN = 50_000, MAX_NOTIZ_BYTES = 5 * 1024 * 1024;
const TEXT_DATEI = /\.(md|txt|canvas)$/i; // Notizen und Obsidian-Canvas (JSON mit Dateipfaden)
// → { dateien, vollstaendig }: false, wenn die Obergrenze erreicht wurde (dann kennt Kortex nicht alle Verweise)
function alleTextDateien(wurzel) {
  const aus = [];
  let vollstaendig = true;
  const geh = (rel) => {
    let liste; try { liste = readdirSync(rel ? join(wurzel, rel) : wurzel, { withFileTypes: true }); } catch { vollstaendig = false; return; }
    for (const d of liste) {
      if (aus.length >= MAX_NOTIZEN) { vollstaendig = false; return; }
      if (gesperrterName(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) geh(r);
      else if (d.isFile() && TEXT_DATEI.test(d.name)) aus.push(r);
    }
  };
  geh("");
  return { dateien: aus, vollstaendig };
}

// Alles, was nach einem Anhang-Namen aussieht (Wikilink, Markdown, Kopf-Wert wie cover: "[[x.png]]", <img src>, Canvas), nicht nur Einbettungen: für „wer benutzt das?“ lieber zu viel als zu wenig
const ENDUNGEN_MUSTER = Object.keys(ANHANG_TYPEN).join("|");
const KANDIDAT = new RegExp(`[^\\s"'()\\[\\]<>|\`\\\\{}]+\\.(?:${ENDUNGEN_MUSTER})(?![A-Za-z0-9])`, "gi");
export function anhangKandidaten(text) {
  const aus = new Set();
  for (const m of String(text).matchAll(KANDIDAT)) { let t = m[0].replace(/^[:,;=]+/, ""); try { t = decodeURIComponent(t); } catch { /* bleibt */ } aus.add(t); }
  for (const z of anhangZieleIn(text)) aus.add(z.ziel);
  return [...aus];
}
const kommtVor = (kleinText, rel) => {
  const name = basename(rel).toLowerCase();
  if (kleinText.includes(name)) return true;
  let dekodiert = ""; try { dekodiert = decodeURIComponent(kleinText); } catch { dekodiert = kleinText.replace(/%([0-9a-f]{2})/g, (m, h) => String.fromCharCode(Number.parseInt(h, 16))); } // „nur%2Da.png“, „a%20b.png“
  return dekodiert.includes(name);
};

/**
 * Anhänge, die NUR diese Notiz benutzt → { anhaenge: [{ pfad, name, art, groesse }], unsicher }.
 * „Benutzt“ ist weit gefasst: jede andere Notiz oder Canvas-Datei, in der der Dateiname irgendwo steht (auch im Datei-Kopf, in <img>, im Code), zählt. Konnte Kortex nicht alles lesen
 * (Datei über 5 MB, mehr als 50 000 Dateien, Lesefehler), ist das Ergebnis „unsicher“ und es wird nichts zum Löschen angeboten.
 * Für die Rückfrage beim Löschen einer Notiz: Kortex fragt, was damit geschehen soll, und löscht nie von allein.
 */
export function unbenutzteAnhaenge({ wurzel, notiz, einstellungen }) {
  const e = anhangEinstellungen(einstellungen);
  const index = baueAnhangIndex(wurzel, { frisch: true });
  const loeseZiel = (von, ziel) => loeseAnhang(wurzel, { von, ziel, ordner: e.ordner, index })?.rel ?? null;
  let eigener;
  try { eigener = readFileSync(loese(wurzel, notiz).abs, "utf8"); } catch { return { anhaenge: [], unsicher: false }; }
  const meine = new Map();
  for (const z of anhangKandidaten(eigener)) { const rel = loeseZiel(notiz, z); if (rel) meine.set(falte(rel), rel); }
  if (!meine.size) return { anhaenge: [], unsicher: false };
  const uebrig = new Map(meine);
  const { dateien, vollstaendig } = alleTextDateien(wurzel);
  let unsicher = !vollstaendig;
  for (const rel of dateien) {
    if (!uebrig.size) break;
    if (falte(rel) === falte(notiz)) continue;
    let text;
    try { const abs = join(wurzel, rel); if (statSync(abs).size > MAX_NOTIZ_BYTES) { unsicher = true; continue; } text = readFileSync(abs, "utf8").toLowerCase(); } catch { unsicher = true; continue; }
    for (const [k, r] of uebrig) if (kommtVor(text, r)) uebrig.delete(k);
  }
  if (unsicher) return { anhaenge: [], unsicher: true };
  return { unsicher: false, anhaenge: [...uebrig.values()].map((rel) => {
    let groesse = 0; try { groesse = statSync(join(wurzel, rel)).size; } catch { /* weg */ }
    return { pfad: rel, name: basename(rel), art: istBildName(rel) ? "bild" : "datei", groesse };
  }) };
}

// ───────────────────────────── Externe Bilder ─────────────────────────────
/** Ist diese IP-Adresse öffentlich erreichbar (kein Loopback, privates Netz, Link-Local, Multicast, Dokumentations- oder Carrier-Bereich)? */
export function istOeffentlicheIp(ip) {
  const v = isIP(ip);
  if (!v) return false;
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  // IPv6: nur globale Unicast-Adressen (2000::/3), und davon nicht die Übergangs-, Test- und Dokumentationsbereiche. Alles andere (auch ::ffff:…, ::1, fc00::/7, fe80::/10) ist nicht öffentlich.
  return V6_ERLAUBT.check(ip, "ipv6") && !V6_GESPERRT.check(ip, "ipv6");
}
const V6_ERLAUBT = new BlockList();
V6_ERLAUBT.addSubnet("2000::", 3, "ipv6");
const V6_GESPERRT = new BlockList();
for (const [netz, laenge] of [["2002::", 16], ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:db8::", 32], ["3fff::", 20], ["100::", 64], ["::", 96], ["::ffff:0:0", 96], ["fec0::", 10]]) V6_GESPERRT.addSubnet(netz, laenge, "ipv6");

const EXTERN_TYPEN = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
export const EXTERN_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Ein Bild von einer Adresse holen (nur nach Zustimmung des Nutzers). Nur https (mit `erlaubeLokal` für Tests auch http und Loopback), keine Zugangsdaten in der Adresse,
 * keine privaten Adressen (geprüft beim Verbinden, auch bei Weiterleitungen), höchstens 3 Weiterleitungen, Antwort höchstens `maxBytes`, nur Bildtypen, Inhalt passt zum Typ.
 * → { typ: "image/png" …, body: Buffer }
 */
export async function holeExternBild(adresse, { maxBytes = EXTERN_MAX_BYTES, zeitMs = 10_000, erlaubeLokal = false } = {}) {
  let url;
  try { url = new URL(String(adresse)); } catch { throw new HttpFehler(400, "Das ist keine gültige Adresse.", { art: "adresse" }); }
  for (let sprung = 0; sprung <= 3; sprung++) {
    const ok = url.protocol === "https:" || (erlaubeLokal && url.protocol === "http:");
    if (!ok) throw new HttpFehler(400, "Bilder werden nur über https geladen.", { art: "adresse" });
    if (url.username || url.password) throw new HttpFehler(400, "Adressen mit Zugangsdaten werden nicht geladen.", { art: "adresse" });
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host) throw new HttpFehler(400, "Das ist keine gültige Adresse.", { art: "adresse" });
    if (!erlaubeLokal && (isIP(host) ? !istOeffentlicheIp(host) : /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))) throw new HttpFehler(403, "Diese Adresse liegt im eigenen Netz und wird nicht geladen.", { art: "privat" });
    const r = await eineAnfrage(url, { maxBytes, zeitMs, erlaubeLokal });
    if (r.weiter) { try { url = new URL(r.weiter, url); } catch { throw new HttpFehler(502, "Ungültige Weiterleitung.", { art: "weiterleitung" }); } continue; }
    return r;
  }
  throw new HttpFehler(502, "Zu viele Weiterleitungen.", { art: "weiterleitung" });
}

function eineAnfrage(url, { maxBytes, zeitMs, erlaubeLokal }) {
  return new Promise((ok, nein) => {
    const modul = url.protocol === "https:" ? https : http;
    let fertig = false;
    const ende = (f, wert) => { if (fertig) return; fertig = true; clearTimeout(uhr); f(wert); };
    // Die Adresse wird beim Verbinden geprüft (nicht vorher): so hilft auch ein Namensserver nicht, der erst eine öffentliche und dann eine private Adresse nennt
    const lookup = (host, opt, cb) => {
      dnsLookup(host, { ...(typeof opt === "object" ? opt : {}), all: true }, (err, adressen) => {
        if (err) return cb(err);
        const liste = (adressen || []).filter((a) => erlaubeLokal || istOeffentlicheIp(a.address));
        if (!liste.length) return cb(Object.assign(new Error("private Adresse"), { code: "PRIVAT" }));
        if (typeof opt === "object" && opt.all) return cb(null, liste);
        cb(null, liste[0].address, liste[0].family);
      });
    };
    const req = modul.request(url, { method: "GET", lookup, headers: { Accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", "User-Agent": "Kortex", "Accept-Encoding": "identity" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); return ende(ok, { weiter: String(res.headers.location) }); }
      if (res.statusCode !== 200) { res.resume(); return ende(nein, new HttpFehler(502, `Der Server antwortet mit ${res.statusCode}.`, { art: "antwort" })); }
      const typ = String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!Object.hasOwn(EXTERN_TYPEN, typ)) { res.resume(); return ende(nein, new HttpFehler(415, "Das ist kein Bild, das Kortex anzeigt.", { art: "typ" })); }
      const laenge = Number(res.headers["content-length"]);
      if (Number.isFinite(laenge) && laenge > maxBytes) { res.resume(); return ende(nein, new HttpFehler(413, `Das Bild ist größer als ${groesseText(maxBytes)}.`, { art: "zu-gross" })); }
      const teile = []; let summe = 0;
      res.on("data", (d) => { summe += d.length; if (summe > maxBytes) { res.destroy(); ende(nein, new HttpFehler(413, `Das Bild ist größer als ${groesseText(maxBytes)}.`, { art: "zu-gross" })); } else teile.push(d); });
      res.on("end", () => {
        const body = Buffer.concat(teile);
        const inhalt = erkenneInhalt(body);
        const erwartet = EXTERN_TYPEN[typ];
        if (inhalt !== erwartet && !(erwartet === "jpg" && inhalt === "jpg")) return ende(nein, new HttpFehler(415, "Der Inhalt ist kein Bild.", { art: "typ-passt-nicht" }));
        let aus = body;
        if (erwartet === "svg") { try { aus = Buffer.from(bereinigeSvg(body.toString("utf8")), "utf8"); } catch { return ende(nein, new HttpFehler(415, "Das ist keine gültige SVG-Datei.", { art: "svg" })); } } // auch fremde SVG nur bereinigt
        ende(ok, { typ, body: aus });
      });
      res.on("error", () => ende(nein, new HttpFehler(502, "Das Bild konnte nicht geladen werden.", { art: "netz" })));
    });
    const uhr = setTimeout(() => { req.destroy(); ende(nein, new HttpFehler(504, "Der Server antwortet nicht.", { art: "zeit" })); }, zeitMs);
    req.on("error", (e) => ende(nein, e.code === "PRIVAT" ? new HttpFehler(403, "Diese Adresse liegt im eigenen Netz und wird nicht geladen.", { art: "privat" }) : new HttpFehler(502, "Das Bild konnte nicht geladen werden.", { art: "netz" })));
    req.end();
  });
}

export { EINBETTUNG, einbettungAus, lokalerPfad, istAdresse };
