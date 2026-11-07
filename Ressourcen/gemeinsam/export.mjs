// gemeinsam/export.mjs — Notizen als Markdown, HTML und Druck-HTML (für PDF) ausgeben. Liest den Vault, schreibt nie hinein und lädt nie etwas hoch.
//
// Ergebnis von exportiere(): ein Bündel { ok, format, name, haupt, dateien: [{ pfad, text } | { pfad, base64 }], notizen, hinweise }. Wohin es geschrieben wird, entscheidet die Hülle
// (Speichern-Dialog; Aktion `export-speichern`); das PDF macht die Hülle aus dem HTML (Aktion `export-pdf`).
//   · markdown: Notiz als .md, Bilder als Dateien daneben unter bilder/<Kurzhash>-<Name> (gleiche Datei = gleicher Name, nie ein Konflikt); die Verweise im Text zeigen dorthin.
//     Mehrere Notizen oder ein Ordner: <Ordner>/<Pfad>.md mit gemeinsamem bilder/-Ordner an der Spitze.
//   · html: EINE eigenständige Datei: Styles, Schrift (Geist) und Bilder (data:) eingebettet, helles Drucklayout; mehrere Notizen werden Abschnitte mit Inhaltsverzeichnis.
//   · fragment: nur der HTML-Körper (für „formatiert kopieren“).
// Geschrieben wird nur, was die Notiz selbst enthält: Bilder aus dem Vault (kein Verweis aus dem Vault hinaus, keine Netzbilder), Links nur http(s)/mailto/#. Rohes HTML der Notiz wird nie übernommen.
import { readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { HttpFehler, loese, imVault, BEARBEITBAR, gesperrterName } from "./basis.mjs";
import { parseKopf, titelAus } from "./notizen.mjs";

const BILD_TYPEN = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif" };
const MAX_BILD = 6 * 1024 * 1024, MAX_BILDER_GESAMT = 24 * 1024 * 1024, MAX_NOTIZEN = 500;
const SCHRIFTEN = {
  geist: '"Geist", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  serif: 'ui-serif, "New York", "Iowan Old Style", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};
const CODE_STAPEL = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const EXPORT_FORMATE = ["markdown", "html", "fragment"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kurzHash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);
export const dateiNameAus = (t, ersatz = "Notiz") => {
  const n = String(t || "").normalize("NFC").replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").replace(/^[.\s-]+|[.\s-]+$/g, "").slice(0, 80).trim();
  return n || ersatz;
};

// ───────────────────────── Markdown → HTML ─────────────────────────
// Bewusst klein: Überschriften, Absätze, Listen (verschachtelt, Aufgaben), Zitate (mit Callouts), Code, Tabellen, Linien und die üblichen Auszeichnungen.
const SICHERE_LINKS = /^(https?:|mailto:|#)/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

export function inlineZuHtml(roh, opt = {}) {
  const merk = [];
  const halte = (html) => { merk.push(html); return `\u0000${merk.length - 1}\u0000`; };
  let s = String(roh);
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~=<>])/g, (_, c) => halte(esc(c)));
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _k, c) => halte(`<code>${esc(c.replace(/^ (.*) $/, "$1"))}</code>`));
  // Bilder: ![[datei|größe]] und ![alt](pfad "titel")
  s = s.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_, ziel, rest) => halte(bildHtml(ziel.trim(), /^\d+$/.test(rest || "") ? "" : rest || "", opt, /^\d+$/.test(rest || "") ? rest : null)));
  s = s.replace(/!\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g, (_, alt, src) => halte(bildHtml(src.replace(/^<|>$/g, ""), alt, opt)));
  // Wiki-Links: nur der Text (ein Export hat keinen Vault dahinter)
  s = s.replace(/\[\[([^\]\n|#]*)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g, (_, ziel, text) => halte(`<span class="wiki">${esc((text || ziel || "").trim())}</span>`));
  // Links [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(\s*(<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\s*\)/g, (_, t, url) => {
    url = url.replace(/^<|>$/g, "");
    const innen = inlineZuHtml(t, { ...opt, ohneLinks: true });
    return halte(SICHERE_LINKS.test(url) && !opt.ohneLinks ? `<a href="${esc(url)}">${innen}</a>` : innen);
  });
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, (_, u) => halte(opt.ohneLinks ? esc(u) : `<a href="${esc(u)}">${esc(u)}</a>`));
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>)\]]+[^\s<>)\].,;:!?])/gi, (_, v, u) => `${v}${halte(opt.ohneLinks ? esc(u) : `<a href="${esc(u)}">${esc(u)}</a>`)}`);
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, "<em>$1</em>").replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>").replace(/==(?=\S)([\s\S]*?\S)==/g, "<mark>$1</mark>");
  s = s.replace(/(?<=^|[\s(,;])#((?:[\p{L}\p{N}_-]+)(?:\/[\p{L}\p{N}_-]+)*)/gu, (m, t) => (/[^\p{N}\/]/u.test(t) ? `<span class="tag">#${t}</span>` : m));
  s = s.replace(/ {2,}\n|\\\n/g, "<br>\n");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => merk[+i]);
}

function bildHtml(src, alt, opt, breite = null) {
  const b = opt.bild ? opt.bild(src) : null;
  if (!b) return `<span class="bild-fehlt">${esc(alt || basename(src.split(/[?#]/)[0]) || "Bild")}</span>`;
  const w = breite ? ` width="${Number(breite)}"` : "";
  return `<img src="${esc(b.url)}" alt="${esc(alt)}"${w}>`;
}

const zelleLauf = (z) => z.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const TRENNZEILE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const LISTENPUNKT = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function markdownZuHtml(md, opt = {}) {
  const zeilen = String(md).replace(/\r\n?/g, "\n").split("\n");
  return bloecke(zeilen, opt);
}

function bloecke(zl, opt) {
  const aus = [];
  let i = 0;
  const leer = (z) => !z.trim();
  while (i < zl.length) {
    const z = zl[i];
    if (leer(z)) { i++; continue; }
    let m;
    if ((m = FENCE.exec(z))) {
      const n = m[1].length, c = m[1][0], lang = m[2];
      const code = [];
      i++;
      while (i < zl.length) { const f = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(zl[i]); if (f && f[1][0] === c && f[1].length >= n) { i++; break; } code.push(zl[i]); i++; }
      aus.push(`<pre><code${lang ? ` class="language-${esc(lang.replace(/[^\w+#.-]/g, ""))}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(z)) || (m = /^ {0,3}(#{1,6})$/.exec(z))) {
      const n = m[1].length;
      aus.push(`<h${n}>${inlineZuHtml(m[2] || "", opt)}</h${n}>`);
      i++; continue;
    }
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(z)) { aus.push("<hr>"); i++; continue; }
    if (/^ {0,3}>/.test(z)) {
      const q = [];
      while (i < zl.length && /^ {0,3}>/.test(zl[i])) { q.push(zl[i].replace(/^ {0,3}> ?/, "")); i++; }
      const co = /^\[!([A-Za-z]+)\][+-]?[ \t]*(.*)$/.exec(q[0]);
      if (co) aus.push(`<blockquote class="callout callout-${co[1].toLowerCase()}"><p class="callout-titel">${inlineZuHtml(co[2] || co[1][0].toUpperCase() + co[1].slice(1).toLowerCase(), opt)}</p>${bloecke(q.slice(1), opt)}</blockquote>`);
      else aus.push(`<blockquote>${bloecke(q, opt)}</blockquote>`);
      continue;
    }
    if (z.includes("|") && i + 1 < zl.length && TRENNZEILE.test(zl[i + 1]) && zl[i + 1].includes("-")) {
      const kopf = zelleLauf(z), ausr = zelleLauf(zl[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : ""));
      i += 2;
      const reihen = [];
      while (i < zl.length && !leer(zl[i]) && zl[i].includes("|")) { reihen.push(zelleLauf(zl[i])); i++; }
      const td = (t, c, k) => `<${t}${ausr[k] ? ` style="text-align:${ausr[k]}"` : ""}>${inlineZuHtml(c ?? "", opt)}</${t}>`;
      aus.push(`<table><thead><tr>${kopf.map((c, k) => td("th", c, k)).join("")}</tr></thead><tbody>${reihen.map((r) => `<tr>${kopf.map((_, k) => td("td", r[k], k)).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (LISTENPUNKT.test(z)) {
      const gruppe = [];
      while (i < zl.length && (!leer(zl[i]) || (i + 1 < zl.length && (LISTENPUNKT.test(zl[i + 1]) || /^\s{2,}\S/.test(zl[i + 1]))))) {
        if (!leer(zl[i]) && !LISTENPUNKT.test(zl[i]) && !/^\s+\S/.test(zl[i])) break;
        gruppe.push(zl[i]); i++;
      }
      aus.push(liste(gruppe, opt));
      continue;
    }
    // Absatz (bis Leerzeile oder Beginn eines anderen Blocks)
    const p = [z];
    i++;
    while (i < zl.length && !leer(zl[i]) && !FENCE.test(zl[i]) && !/^ {0,3}#{1,6}([ \t]|$)/.test(zl[i]) && !/^ {0,3}>/.test(zl[i]) && !LISTENPUNKT.test(zl[i]) && !/^ {0,3}([-*_])( *\1){2,} *$/.test(zl[i])) {
      if (/^ {0,3}(=+|-+)\s*$/.test(zl[i])) break;
      p.push(zl[i]); i++;
    }
    if (i < zl.length && /^ {0,3}=+\s*$/.test(zl[i])) { aus.push(`<h1>${inlineZuHtml(p.join(" ").trim(), opt)}</h1>`); i++; continue; }
    if (i < zl.length && /^ {0,3}-{2,}\s*$/.test(zl[i]) && !LISTENPUNKT.test(zl[i])) { aus.push(`<h2>${inlineZuHtml(p.join(" ").trim(), opt)}</h2>`); i++; continue; }
    aus.push(`<p>${inlineZuHtml(p.map((x) => x.replace(/^\s+/, "")).join("\n").trim(), opt)}</p>`);
  }
  return aus.join("\n");
}

// Zeilen einer Liste (mit Einrückung) → <ul>/<ol>; Unterlisten über die Einrückung des Punkts
function liste(zl, opt) {
  const punkte = [];
  for (const z of zl) {
    const m = LISTENPUNKT.exec(z);
    if (m) punkte.push({ tiefe: m[1].replace(/\t/g, "    ").length, art: /\d/.test(m[2]) ? "ol" : "ul", start: /\d/.test(m[2]) ? parseInt(m[2], 10) : 1, text: [m[3]], kinder: [] });
    else if (punkte.length && z.trim()) punkte[punkte.length - 1].text.push(z.trim());
  }
  const baum = [];
  const kellerSt = [];
  for (const p of punkte) {
    while (kellerSt.length && kellerSt[kellerSt.length - 1].tiefe >= p.tiefe) kellerSt.pop();
    (kellerSt.length ? kellerSt[kellerSt.length - 1].kinder : baum).push(p);
    kellerSt.push(p);
  }
  const laeufe = []; // aufeinanderfolgende Punkte gleicher Art (ul/ol) auf oberster Ebene sind je eine Liste
  for (const p of baum) { const l = laeufe[laeufe.length - 1]; if (l && l[0].art === p.art) l.push(p); else laeufe.push([p]); }
  return laeufe.map((l) => ausgeben(l, opt)).join("\n");
}
function ausgeben(punkte, opt) {
  if (!punkte.length) return "";
  const art = punkte[0].art;
  const aufgaben = punkte.some((p) => /^\[[ xX]\]\s/.test(p.text[0]));
  const li = punkte.map((p) => {
    let t = p.text.join("\n"), k = "";
    const a = /^\[([ xX])\]\s+/.exec(t);
    if (a) { k = ` class="aufgabe"`; t = `<input type="checkbox" disabled${a[1] === " " ? "" : " checked"}> ` + inlineZuHtml(t.slice(a[0].length), opt); } else t = inlineZuHtml(t, opt);
    return `<li${k}>${t}${ausgeben(p.kinder, opt)}</li>`;
  }).join("");
  return `<${art}${aufgaben ? ` class="aufgaben"` : ""}${art === "ol" && punkte[0].start !== 1 ? ` start="${punkte[0].start}"` : ""}>${li}</${art}>`;
}

// Text der Notiz ohne Kopf (Front-Matter) → { koerper, felder }
export function ohneKopf(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const k = parseKopf(text);
  if (!k.bis) return { koerper: text, felder: {} };
  return { koerper: text.split(/\r?\n/).slice(k.bis).join("\n").replace(/^\s*\n/, ""), felder: k.felder };
}

// ───────────────────────── HTML-Seite ─────────────────────────
export function seitenStil({ schrift = "geist", schriftDatei = "" } = {}) {
  const stapel = SCHRIFTEN[schrift] || SCHRIFTEN.geist;
  return `${schriftDatei ? `@font-face{font-family:"Geist";font-weight:100 900;font-style:normal;src:url(data:font/woff2;base64,${schriftDatei}) format("woff2")}\n` : ""}`
    + `:root{color-scheme:light}*{box-sizing:border-box}
html{background:#fff}
body{margin:0;color:#1d1d1f;background:#fff;font-family:${stapel};font-size:11pt;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:46em;margin:0 auto;padding:2.2em 1.6em 3em}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.5em 0 .5em;font-weight:650;break-after:avoid}
h1{font-size:1.9em;margin-top:.2em}h2{font-size:1.4em}h3{font-size:1.15em}h4,h5,h6{font-size:1em}
p{margin:.7em 0}a{color:#3a3fb5;text-decoration:underline}
code{font-family:${CODE_STAPEL};font-size:.88em;background:#f1f1f4;border-radius:4px;padding:.1em .35em}
pre{background:#f6f6f8;border:1px solid #e3e3e8;border-radius:7px;padding:.8em 1em;overflow:auto;white-space:pre-wrap;word-break:break-word;break-inside:avoid}
pre code{background:none;padding:0}
blockquote{margin:.9em 0;padding:.1em 1em;border-left:3px solid #c7c7d1;color:#4a4a52}
.callout{border-left-color:#5b4ed6;background:#f4f3fd}.callout-titel{font-weight:650;margin:.5em 0}
ul,ol{padding-left:1.5em}li{margin:.2em 0}ul.aufgaben{list-style:none;padding-left:.4em}
table{border-collapse:collapse;margin:1em 0;max-width:100%}th,td{border:1px solid #d6d6dd;padding:.35em .7em;text-align:left;vertical-align:top}th{background:#f3f3f6}
img{max-width:100%;height:auto;break-inside:avoid}hr{border:0;border-top:1px solid #d6d6dd;margin:1.6em 0}
mark{background:#fff2a8}.tag{color:#5b4ed6;background:#efedfc;border-radius:4px;padding:0 .3em}.wiki{border-bottom:1px dotted #8a8a96}.bild-fehlt{color:#777;font-style:italic}
.notiz+.notiz{break-before:page;margin-top:3em;padding-top:2em;border-top:1px solid #d6d6dd}
nav.inhalt{margin:0 0 2em}nav.inhalt h2{margin-top:0}nav.inhalt ol{margin:.3em 0}
.meta{color:#6b6b75;font-size:.85em;margin:-.2em 0 1.2em}
@page{margin:18mm 16mm}
@media print{main{max-width:none;padding:0}a{color:inherit;text-decoration:none}.notiz+.notiz{border-top:0;margin-top:0;padding-top:0}}`;
}

export function baueHtmlSeite({ titel, abschnitte, schrift = "geist", schriftDatei = "", inhaltsverzeichnis = false }) {
  const verz = inhaltsverzeichnis ? `<nav class="inhalt"><h2>Inhalt</h2><ol>${abschnitte.map((a) => `<li>${esc(a.titel)}</li>`).join("")}</ol></nav>` : "";
  return `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="generator" content="Kortex">\n<title>${esc(titel)}</title>\n<style>\n${seitenStil({ schrift, schriftDatei })}\n</style>\n</head>\n<body>\n<main>\n${verz}${abschnitte.map((a) => `<section class="notiz">\n${a.html}\n</section>`).join("\n")}\n</main>\n</body>\n</html>\n`;
}

// ───────────────────────── ZIP (ohne Kompression der Bilder, Text mit deflate) ─────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipBauen(dateien) { // [{ pfad, daten: Buffer }] → Buffer
  const teile = [], zentral = [];
  let ab = 0;
  for (const d of dateien) {
    const name = Buffer.from(d.pfad, "utf8"), roh = d.daten, crc = crc32(roh);
    const dicht = /\.(png|jpe?g|gif|webp|avif)$/i.test(d.pfad) ? null : deflateRawSync(roh);
    const daten = dicht && dicht.length < roh.length ? dicht : roh, methode = daten === roh ? 0 : 8;
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6); kopf.writeUInt16LE(methode, 8);
    kopf.writeUInt16LE(0, 10); kopf.writeUInt16LE(0x21, 12); kopf.writeUInt32LE(crc, 14); kopf.writeUInt32LE(daten.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(name.length, 26);
    teile.push(kopf, name, daten);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x0800, 8); z.writeUInt16LE(methode, 10); z.writeUInt16LE(0, 12); z.writeUInt16LE(0x21, 14);
    z.writeUInt32LE(crc, 16); z.writeUInt32LE(daten.length, 20); z.writeUInt32LE(roh.length, 24); z.writeUInt16LE(name.length, 28); z.writeUInt32LE(ab, 42);
    zentral.push(z, name);
    ab += 30 + name.length + daten.length;
  }
  const zb = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(dateien.length, 8); ende.writeUInt16LE(dateien.length, 10); ende.writeUInt32LE(zb.length, 12); ende.writeUInt32LE(ab, 16);
  return Buffer.concat([...teile, zb, ende]);
}

// ───────────────────────── Bilder im Markdown ─────────────────────────
// Ruft fn(ziel, alt) für jedes Bild außerhalb von Code und ersetzt es durch dessen Rückgabe (Text) oder lässt es, wenn fn null liefert.
export function ersetzeBilder(md, fn) {
  const zl = md.split("\n");
  let zaun = null;
  for (let i = 0; i < zl.length; i++) {
    const f = FENCE.exec(zl[i].replace(/\r$/, ""));
    if (zaun) { if (f && f[1][0] === zaun.c && f[1].length >= zaun.n && !/[^\s`~]/.test(zl[i].replace(/^ {0,3}(`{3,}|~{3,})/, ""))) zaun = null; continue; }
    if (f) { zaun = { c: f[1][0], n: f[1].length }; continue; }
    if (!zl[i].includes("![")) continue;
    zl[i] = zl[i].split(/((`+)[^`]*?\2(?!`))/).map((teil, k, arr) => {
      if (k % 3 !== 0) return k % 3 === 1 ? teil : ""; // Code-Span und seine Klammer-Gruppe
      return teil.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|!\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^)\s]+)((?:\s+"[^"\n]*")?)\s*\)/g, (m, ziel, rest, alt, src, titel) => {
        const r = ziel !== undefined ? fn(ziel.trim(), /^\d+$/.test(rest || "") ? "" : rest || "") : fn(src.replace(/^<|>$/g, ""), alt);
        return r === null ? m : ziel !== undefined ? r : r.replace(/\)$/, `${titel})`);
      });
    }).join("");
  }
  return zl.join("\n");
}

// ───────────────────────── Export ─────────────────────────
export function erzeugeExport({ wurzel, lies, istGeneriert = () => false, ueberspringeOrdner = () => false, tagIndex = null, studioOrdner = null }) {
  let bilderIndex = null; // Dateiname (klein) → rel, für ![[bild.png]]
  const bildSuche = () => {
    if (bilderIndex) return bilderIndex;
    bilderIndex = new Map();
    let n = 0;
    const geh = (rel) => {
      let l; try { l = readdirSync(rel ? join(wurzel, rel) : wurzel, { withFileTypes: true }); } catch { return; }
      for (const d of l) {
        if (gesperrterName(d.name) || n > 20000) continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!ueberspringeOrdner(join(wurzel, r))) geh(r); continue; }
        n++;
        if (BILD_TYPEN[extname(d.name).toLowerCase()] && !bilderIndex.has(d.name.toLowerCase())) bilderIndex.set(d.name.toLowerCase(), r);
      }
    };
    geh("");
    return bilderIndex;
  };

  function ladeBild(notizDir, ziel, gesamt, hinweise) {
    let z = String(ziel).split(/[?#]/)[0];
    try { z = decodeURIComponent(z); } catch { /* roh lassen */ }
    if (!z || /^[a-z][a-z0-9+.-]*:/i.test(z) || z.startsWith("//")) return null; // Netz- und data:-Bilder werden nie geladen oder eingebettet
    const typ = BILD_TYPEN[extname(z).toLowerCase()];
    if (!typ) return null;
    const kandidaten = [];
    if (z.startsWith("/")) kandidaten.push(z.replace(/^\/+/, "")); else { kandidaten.push((notizDir ? notizDir + "/" : "") + z); kandidaten.push(z); if (!z.includes("/")) { const g = bildSuche().get(z.toLowerCase()); if (g) kandidaten.push(g); } }
    for (const k of kandidaten) {
      let l; try { l = loese(wurzel, k); } catch { continue; }
      try {
        const echt = realpathSync(l.abs);
        if (!imVault(echt, wurzel)) continue;
        if (l.segmente.some((s) => gesperrterName(s))) continue;
        const st = statSync(echt);
        if (!st.isFile()) continue;
        if (st.size > MAX_BILD) { hinweise.push(`Bild „${basename(z)}“ ist zu groß (über 6 MB) und fehlt im Export.`); return null; }
        if (gesamt.bytes + st.size > MAX_BILDER_GESAMT) { hinweise.push(`Bild „${basename(z)}“ fehlt: der Export ist mit Bildern zu groß.`); return null; }
        const buf = readFileSync(echt);
        gesamt.bytes += buf.length;
        return { buf, typ, name: basename(l.rel) };
      } catch { /* nächster Kandidat */ }
    }
    hinweise.push(`Bild „${basename(z)}“ gibt es im Vault nicht und fehlt im Export.`);
    return null;
  }

  function notizenAus({ pfade = [], ordner = null }) {
    const liste = [];
    const sieht = (rel) => !rel.split("/").some(gesperrterName);
    const nimm = (rel) => { if (!liste.includes(rel)) liste.push(rel); };
    for (const p of pfade) {
      if (typeof p !== "string") throw new HttpFehler(400, "Ein Pfad ist ungültig.");
      const l = loese(wurzel, p);
      if (!BEARBEITBAR.test(l.rel) || !sieht(l.rel)) throw new HttpFehler(415, "Nur Markdown- und Textnotizen lassen sich exportieren.");
      nimm(l.rel);
    }
    if (typeof ordner === "string") {
      const w = loese(wurzel, ordner);
      let st; try { st = statSync(w.abs); } catch { throw new HttpFehler(404, "Diesen Ordner gibt es nicht."); }
      if (!st.isDirectory()) throw new HttpFehler(400, "Das ist kein Ordner.");
      const geh = (rel) => {
        let l; try { l = readdirSync(join(wurzel, rel), { withFileTypes: true }); } catch { return; }
        l.sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
        for (const d of l) {
          if (gesperrterName(d.name)) continue;
          const r = `${rel}/${d.name}`;
          if (d.isDirectory()) { if (!ueberspringeOrdner(join(wurzel, r))) geh(r); continue; }
          if (BEARBEITBAR.test(d.name) && !istGeneriert(r, join(wurzel, r))) nimm(r);
        }
      };
      geh(w.rel);
    }
    if (!liste.length) throw new HttpFehler(400, "Es gibt nichts zu exportieren.");
    if (liste.length > MAX_NOTIZEN) throw new HttpFehler(413, `Zu viele Notizen (höchstens ${MAX_NOTIZEN}).`);
    return liste;
  }

  /**
   * a: { pfade?: string[], ordner?: string, format: "markdown"|"html"|"fragment", schrift?: "geist"|"serif"|"mono", zip?: boolean }
   */
  function exportiere(a) {
    if (!a || typeof a !== "object") throw new HttpFehler(400, "Die Anfrage ist leer.");
    const format = EXPORT_FORMATE.includes(a.format) ? a.format : null;
    if (!format) throw new HttpFehler(400, "Unbekanntes Format.");
    const rels = notizenAus({ pfade: a.pfade || [], ordner: a.ordner ?? null });
    const hinweise = [], gesamt = { bytes: 0 };
    const notizen = rels.map((rel) => { const d = lies(rel); return { rel, text: d.inhalt, titel: titelAus(rel, d.inhalt) }; });
    const einzeln = notizen.length === 1 && a.ordner == null;
    const hauptName = dateiNameAus(einzeln ? notizen[0].titel : (a.ordner ? basename(String(a.ordner)) : "Kortex-Export"), "Kortex-Export");
    let erg;

    if (format === "markdown") {
      const dateien = [], bilder = new Map(); // name → true
      const wurzelName = einzeln ? "" : hauptName + "/";
      const benutzt = new Set();
      const basisOrdner = einzeln ? "" : gemeinsamerOrdner(rels);
      for (const n of notizen) {
        const dir = dirname(n.rel) === "." ? "" : dirname(n.rel);
        const rel = einzeln ? hauptName + ".md" : n.rel.slice(basisOrdner ? basisOrdner.length + 1 : 0);
        const tiefe = einzeln ? 0 : rel.split("/").length - 1;
        const text = ersetzeBilder(n.text, (ziel, alt) => {
          const b = ladeBild(dir, ziel, gesamt, hinweise);
          if (!b) return null;
          const name = `${kurzHash(b.buf)}-${dateiNameAus(b.name, "bild").replace(/\s+/g, "-")}`;
          if (!bilder.has(name)) { bilder.set(name, true); dateien.push({ pfad: `${wurzelName}bilder/${name}`, base64: b.buf.toString("base64") }); }
          return `![${alt}](${"../".repeat(tiefe)}bilder/${encodeURI(name)})`;
        });
        let pfad = wurzelName + rel;
        if (benutzt.has(pfad)) pfad = pfad.replace(/(\.[^.]*)?$/, `-${benutzt.size}$1`);
        benutzt.add(pfad);
        dateien.unshift({ pfad, text });
      }
      // die Notizen zuerst in Vault-Reihenfolge, Bilder danach
      const md = dateien.filter((d) => d.text !== undefined).reverse(), rest = dateien.filter((d) => d.text === undefined);
      erg = { dateien: [...md, ...rest], haupt: md[0].pfad, name: einzeln ? hauptName + ".md" : hauptName, ordner: !einzeln };
    } else {
      const schrift = SCHRIFTEN[a.schrift] ? a.schrift : "geist";
      let schriftDatei = "";
      if (format === "html" && schrift === "geist") {
        try { schriftDatei = readFileSync(join(studioOrdner || join(dirname(fileURLToPath(import.meta.url)), "..", "studio"), "vendor", "fonts", "Geist-Variable.woff2")).toString("base64"); } catch { /* Systemschrift */ }
      }
      const abschnitte = notizen.map((n) => {
        const dir = dirname(n.rel) === "." ? "" : dirname(n.rel);
        const { koerper } = ohneKopf(n.text);
        const html = markdownZuHtml(koerper, { bild: (src) => { const b = ladeBild(dir, src, gesamt, hinweise); return b ? { url: `data:${b.typ};base64,${b.buf.toString("base64")}` } : null; } });
        return { titel: n.titel, html: /^\s*<h1[ >]/.test(html) ? html : `<h1>${esc(n.titel)}</h1>\n${html}` };
      });
      if (format === "fragment") erg = { html: abschnitte.map((s) => s.html).join("\n<hr>\n"), name: hauptName };
      else {
        const html = baueHtmlSeite({ titel: einzeln ? notizen[0].titel : hauptName, abschnitte, schrift, schriftDatei, inhaltsverzeichnis: notizen.length > 1 });
        erg = { dateien: [{ pfad: `${hauptName}.html`, text: html }], haupt: `${hauptName}.html`, name: `${hauptName}.html`, ordner: false, html };
      }
    }
    const aus = { ok: true, format, notizen: notizen.length, hinweise: [...new Set(hinweise)].slice(0, 20), ...erg };
    if (a.zip === true && erg.dateien) {
      const zip = zipBauen(erg.dateien.map((d) => ({ pfad: d.pfad, daten: d.text !== undefined ? Buffer.from(d.text, "utf8") : Buffer.from(d.base64, "base64") })));
      aus.dateien = [{ pfad: `${hauptName}.zip`, base64: zip.toString("base64") }];
      aus.haupt = `${hauptName}.zip`; aus.name = `${hauptName}.zip`; aus.ordner = false;
    }
    return aus;
  }

  return { exportiere };
}

function gemeinsamerOrdner(rels) {
  const teile = rels.map((r) => r.split("/").slice(0, -1));
  let g = teile[0] || [];
  for (const t of teile) { let i = 0; while (i < g.length && i < t.length && g[i] === t[i]) i++; g = g.slice(0, i); }
  return g.join("/");
}
