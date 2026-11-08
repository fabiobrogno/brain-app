// HTML aus der Zwischenablage → sauberes Markdown (Runde 3b). Rein, ohne DOM (läuft im Studio und in Node: Tests/Node/html-markdown.test.mjs).
// Eigener, kleiner HTML-Leser statt DOMParser: Skripte, Styles, Kommentare und fremde Tags (Word: <o:p>, Notion, Browser) fallen weg, aus der Seite
// kommt nie etwas anderes als Text und die unten gebauten Markdown-Zeichen heraus. Links: nur http, https, mailto, tel und relative Ziele.
// Aufruf: htmlZuMarkdown(html) → Text (ohne abschließenden Zeilenumbruch). hatStruktur(html): lohnt die Umwandlung (sonst gilt der reine Text)?

const LEER = new Set(["br", "img", "hr", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr", "param"]);
const WEG = new Set(["script", "style", "head", "title", "noscript", "template", "iframe", "object", "svg", "canvas", "select", "button", "textarea", "audio", "video", "map", "math", "form-nein"]);
const ROHTEXT = new Set(["script", "style", "textarea", "title"]);
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "pre", "blockquote", "hr", "section", "article", "aside", "header", "footer",
  "nav", "main", "figure", "figcaption", "dl", "dt", "dd", "details", "summary", "address", "fieldset", "center", "body", "html"]);

const NAMEN = { nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", bull: "•", middot: "·",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", deg: "°", plusmn: "±", times: "×", divide: "÷", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", lArr: "⇐", check: "✓", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  eacute: "é", egrave: "è", agrave: "à", aacute: "á", ccedil: "ç", ntilde: "ñ", oacute: "ó", iacute: "í", uacute: "ú", ecirc: "ê", acirc: "â", ocirc: "ô", oslash: "ø", aring: "å", aelig: "æ" };
export function entitaeten(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, n) => {
    if (n[0] === "#") {
      const c = n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : "";
    }
    return Object.hasOwn(NAMEN, n) ? NAMEN[n] : m;
  });
}

// ---------- Lesen: Text → Baum ----------
// Knoten: { tag, attr: {…}, kinder: [Knoten | { text }] }
export function liesHtml(html) {
  const wurzel = { tag: "#wurzel", attr: {}, kinder: [] };
  const stapel = [wurzel];
  const oben = () => stapel[stapel.length - 1];
  const hinzu = (k) => oben().kinder.push(k);
  const schliesseBis = (pred) => { for (let i = stapel.length - 1; i > 0; i--) { if (pred(stapel[i])) { stapel.length = i; return true; } if (BLOCK_GRENZE.has(stapel[i].tag)) return false; } return false; };
  const BLOCK_GRENZE = new Set(["table", "ul", "ol", "blockquote", "body", "dl", "details"]);
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { hinzu({ text: entitaeten(html.slice(i)) }); break; }
    if (lt > i) hinzu({ text: entitaeten(html.slice(i, lt)) });
    i = lt;
    if (html.startsWith("<!--", i)) { const e = html.indexOf("-->", i + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[i + 1] === "!" || html[i + 1] === "?") { const e = html.indexOf(">", i + 2); i = e < 0 ? n : e + 1; continue; }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9:_-]*)/.exec(html.slice(i, i + 80));
    if (!m) { hinzu({ text: "<" }); i++; continue; }
    // Tag lesen (Attribute in "…", '…' oder ohne Anführungszeichen)
    let j = i + m[0].length;
    const attr = {};
    let selbst = false;
    while (j < n && html[j] !== ">") {
      if (html[j] === "/" ) { if (html[j + 1] === ">") selbst = true; j++; continue; }
      if (/\s/.test(html[j])) { j++; continue; }
      const a = /^([^\s=>/]+)/.exec(html.slice(j, j + 200));
      if (!a) { j++; continue; }
      j += a[0].length;
      let wert = "";
      const rest = html.slice(j, j + 2000);
      const g = /^\s*=\s*/.exec(rest);
      if (g) {
        j += g[0].length;
        if (html[j] === '"' || html[j] === "'") { const q = html[j], e = html.indexOf(q, j + 1); wert = html.slice(j + 1, e < 0 ? n : e); j = e < 0 ? n : e + 1; }
        else { const u = /^[^\s>]*/.exec(html.slice(j, j + 2000)); wert = u[0]; j += u[0].length; }
      }
      attr[a[1].toLowerCase()] = entitaeten(wert);
    }
    i = j < n ? j + 1 : n;
    const tag = m[2].toLowerCase(), schluss = !!m[1];
    if (schluss) {
      if (ROHTEXT.has(tag)) continue;
      for (let k = stapel.length - 1; k > 0; k--) if (stapel[k].tag === tag) { stapel.length = k; break; }
      continue;
    }
    if (ROHTEXT.has(tag) && !selbst) { // Inhalt überspringen bis </tag>
      const e = html.toLowerCase().indexOf("</" + tag, i);
      const g = e < 0 ? -1 : html.indexOf(">", e);
      i = g < 0 ? n : g + 1;
      continue;
    }
    // Stillschweigend geschlossene Elemente (HTML erlaubt es): <p>, <li>, <td>, <th>, <tr>
    if (tag === "li") schliesseBis((k) => k.tag === "li");
    else if (tag === "td" || tag === "th") schliesseBis((k) => k.tag === "td" || k.tag === "th");
    else if (tag === "tr") schliesseBis((k) => k.tag === "tr");
    else if (tag === "dt" || tag === "dd") schliesseBis((k) => k.tag === "dt" || k.tag === "dd");
    else if (BLOCK.has(tag) && tag !== "tr") schliesseBis((k) => k.tag === "p");
    const knoten = { tag, attr, kinder: [] };
    hinzu(knoten);
    if (!LEER.has(tag) && !selbst) stapel.push(knoten);
  }
  return wurzel;
}

// ---------- Hilfen ----------
const stil = (k) => String(k.attr.style || "").toLowerCase();
const klassen = (k) => String(k.attr.class || "").toLowerCase().split(/\s+/);
const stilIst = (k, re) => re.test(stil(k));
const FETT = /font-weight\s*:\s*(bold|bolder|[6-9]00)/;
const KURSIV = /font-style\s*:\s*italic/;
const DURCH = /text-decoration[^;]*line-through/;
const MONO = /font-family\s*:[^;]*(mono|courier|consolas|menlo)/;
const VERSTECKT = /display\s*:\s*none|mso-hide\s*:\s*all|visibility\s*:\s*hidden/;
const textVon = (k) => (k.text !== undefined ? k.text : k.kinder.map(textVon).join(""));

// Erlaubte Linkziele (nie javascript:, data:, vbscript:, file:)
export function sichereAdresse(a) {
  const u = String(a || "").trim().replace(/[\u0000-\u001f\u007f\s]+/g, "");
  if (!u) return null;
  const sch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u);
  if (sch && !/^(https?|mailto|tel)$/i.test(sch[1])) return null;
  return String(a).trim().replace(/\s+/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// ---------- Inline: Läufe { t, b, i, s, c, a } ----------
// Jeder Textlauf trägt seine Auszeichnungen; gleiche Nachbarläufe werden zusammengefasst, danach schreibt `schreibeLaeufe` das Markdown.
function laeufe(knoten, fl, aus, kontext) {
  for (const k of knoten.kinder) {
    if (k.text !== undefined) {
      const t = kontext.pre ? k.text.replace(/\u00a0/g, " ") : k.text.replace(/[\s\u00a0]+/g, " ");
      if (t) aus.push({ ...fl, t });
      continue;
    }
    if (WEG.has(k.tag) || (k.tag === "span" && /mso-list\s*:\s*ignore/.test(stil(k))) || stilIst(k, VERSTECKT) || "hidden" in k.attr) continue;
    const f = { ...fl };
    const tag = k.tag;
    if (tag === "b" || tag === "strong") f.b = true;
    if (tag === "i" || tag === "em" || tag === "cite" || tag === "dfn") f.i = true;
    if (tag === "s" || tag === "strike" || tag === "del") f.s = true;
    if ((tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt") && !kontext.pre) f.c = true;
    if (tag === "span" || tag === "font" || tag === "u" || tag === "mark" || tag === "div" || tag === "p" || tag === "label" || tag === "sup" || tag === "sub") {
      if (stilIst(k, FETT) && !kontext.ohneFett) f.b = true;
      if (stilIst(k, KURSIV)) f.i = true;
      if (stilIst(k, DURCH)) f.s = true;
      if (stilIst(k, MONO) && tag === "span" && !kontext.pre) f.c = true;
    }
    if ((tag === "b" || tag === "strong") && kontext.ohneFett) f.b = fl.b;
    if (tag === "a") { const ziel = sichereAdresse(k.attr.href); if (ziel && !fl.a) f.a = ziel; }
    if (tag === "br") { aus.push({ ...fl, br: true, t: "" }); continue; }
    if (tag === "img") { const bild = bildMarkdown(k, kontext); if (bild) aus.push({ ...fl, roh: bild, t: "" }); continue; }
    if (tag === "input") { if ((k.attr.type || "").toLowerCase() === "checkbox") aus.push({ ...fl, roh: "k" in k.attr || "checked" in k.attr ? "[x] " : "[ ] ", t: "", kaestchen: true }); continue; }
    if (tag === "sup" || tag === "sub") { /* Text bleibt, ohne Hoch-/Tiefstellung */ }
    if (klassen(k).some((c) => /^checkbox/.test(c)) && tag === "div") { aus.push({ ...fl, roh: klassen(k).includes("checkbox-on") ? "[x] " : "[ ] ", t: "", kaestchen: true }); continue; }
    laeufe(k, f, aus, kontext);
  }
  return aus;
}

function bildMarkdown(k, kontext) {
  const src = String(k.attr.src || "").trim();
  if (!/^https?:\/\//i.test(src)) return kontext.bild ? kontext.bild(src, k.attr.alt || "") || "" : ""; // data:, blob:, file: kommen nicht mit; Anhänge übernimmt die Anwendung (Hook)
  const alt = String(k.attr.alt || "").replace(/[\[\]\n]/g, " ").replace(/\s+/g, " ").trim();
  const url = sichereAdresse(src);
  return url ? `![${alt}](${url})` : "";
}

// Zeichen, die im Text Markdown auslösen würden
function maskiere(t, zeilenAnfang) {
  let s = t.replace(/\\/g, "\\\\").replace(/([*`~])/g, "\\$1").replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace("_", "\\_")).replace(/<(?=[A-Za-z/!?])/g, "\\<");
  if (zeilenAnfang) s = s.replace(/^(\s*)([#>])/, "$1\\$2").replace(/^(\s*)([-+])(?=\s)/, "$1\\$2").replace(/^(\s*\d+)([.)])(?=\s)/, "$1\\$2");
  return s;
}

function schreibeLauf(l, zelle) {
  let t = l.t;
  if (l.br) return zelle ? "<br>" : "\\\n";
  if (l.roh !== undefined) return l.roh;
  const lead = /^\s*/.exec(t)[0], trail = t.length > lead.length ? /\s*$/.exec(t)[0] : "";
  let kern = t.slice(lead.length, t.length - trail.length);
  if (!kern) return t;
  if (l.c) { const rahmen = kern.includes("`") ? "``" : "`"; kern = rahmen + (kern.startsWith("`") || kern.endsWith("`") ? " " + kern + " " : kern) + rahmen; }
  else kern = maskiere(kern, false);
  if (l.s) kern = `~~${kern}~~`;
  if (l.i) kern = `*${kern}*`;
  if (l.b) kern = `**${kern}**`;
  return lead + kern + trail;
}

function schreibeLaeufe(liste, zelle = false) {
  // gleiche Nachbarn zusammenfassen
  const gleich = (a, b) => !a.br && !b.br && a.roh === undefined && b.roh === undefined && !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.c === !!b.c && a.a === b.a;
  const m = [];
  for (const l of liste) { const v = m[m.length - 1]; if (v && gleich(v, l)) v.t += l.t; else m.push({ ...l }); }
  // Links: aufeinanderfolgende Läufe mit demselben Ziel in EINEN Link
  let aus = "";
  for (let i = 0; i < m.length; ) {
    const l = m[i];
    if (l.a) {
      let j = i, innen = "";
      while (j < m.length && m[j].a === l.a) { innen += schreibeLauf({ ...m[j], a: undefined }, zelle); j++; }
      const sicht = innen.trim();
      if (sicht) {
        const lead = /^\s*/.exec(innen)[0], trail = /\s*$/.exec(innen)[0];
        aus += lead + (sicht.replace(/\\(.)/g, "$1") === l.a ? `<${l.a}>` : `[${sicht.replace(/\]/g, "\\]")}](${l.a})`) + trail;
      } else aus += innen;
      i = j;
    } else { aus += schreibeLauf(l, zelle); i++; }
  }
  return aus;
}

const inlineText = (knoten, kontext, zelle = false) => schreibeLaeufe(laeufe(knoten, {}, [], kontext), zelle);
// Absatztext: Leerraum zusammenfassen, Ränder kürzen
const absatz = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();

// ---------- Block ----------
function blockInhalt(knoten, kontext) {
  const bloecke = [];
  let lauf = [];
  const leere = () => {
    if (!lauf.length) return;
    const t = absatz(schreibeLaeufe(lauf));
    lauf = [];
    if (t) bloecke.push(zeilenStart(t));
  };
  const zeilenStart = (t) => t.split("\n").map(maskiereAnfang).join("\n");
  for (const k of knoten.kinder) {
    if (k.text !== undefined || !BLOCK.has(k.tag)) {
      // Inline-Knoten (oder Text): in den laufenden Absatz sammeln
      if (k.text !== undefined) { const t = kontext.pre ? k.text : k.text.replace(/[\s\u00a0]+/g, " "); if (t) lauf.push({ t }); }
      else if (!WEG.has(k.tag)) lauf.push(...laeufe({ kinder: [k] }, {}, [], kontext));
      continue;
    }
    if (stilIst(k, VERSTECKT) || "hidden" in k.attr || WEG.has(k.tag)) continue;
    if (k.tag === "div" && klassen(k).some((c) => /^checkbox/.test(c))) { lauf.push({ roh: klassen(k).includes("checkbox-on") ? "[x] " : "[ ] ", t: "", kaestchen: true }); continue; } // Notion: Kästchen einer Aufgabe
    leere();
    const b = blockKnoten(k, kontext);
    if (b) bloecke.push(...(Array.isArray(b) ? b : [b]));
  }
  leere();
  return bloecke;
}
// Zeilenbeginn, der sonst Markdown wäre („1. “, „- “, „# “, „> “)
const maskiereAnfang = (z) => z.replace(/^(\s*)([#>])/, "$1\\$2").replace(/^(\s*)([-+*])(?=\s)/, "$1\\$2").replace(/^(\s*\d+)([.)])(?=\s)/, "$1\\$2");

function blockKnoten(k, kontext) {
  const tag = k.tag;
  if (/^h[1-6]$/.test(tag)) {
    const t = absatz(inlineText(k, { ...kontext, ohneFett: true })).replace(/\\\n/g, " ").replace(/\n/g, " ");
    return t ? "#".repeat(+tag[1]) + " " + t : null;
  }
  if (tag === "hr") return "---";
  if (tag === "pre") return codeBlock(k);
  if (tag === "blockquote" || tag === "aside") {
    const inh = fuege(blockInhalt(k, kontext));
    return inh ? inh.split("\n").map((z) => (z ? "> " + z : ">")).join("\n") : null;
  }
  if (tag === "ul" || tag === "ol") return liste(k, kontext, 0);
  if (tag === "table") return tabelle(k, kontext);
  if (tag === "details") return blockInhalt(k, kontext);
  if (tag === "dl") return blockInhalt(k, kontext);
  if (tag === "dt") { const t = absatz(inlineText(k, kontext)); return t ? `**${t}**` : null; }
  if (tag === "li") return liste({ tag: "ul", attr: {}, kinder: [k] }, kontext, 0);
  // Word-Listenabsatz (<p class=MsoListParagraph style="mso-list:l0 level1 lfo1">)
  if (/mso-list\s*:\s*l\d+/.test(stil(k))) return wordListe(k, kontext);
  if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "header" || tag === "footer" || tag === "nav" || tag === "main" || tag === "figure"
    || tag === "figcaption" || tag === "summary" || tag === "dd" || tag === "address" || tag === "fieldset" || tag === "center" || tag === "body" || tag === "html") {
    const kin = blockInhalt(k, kontext);
    return kin.length ? kin : null;
  }
  return blockInhalt(k, kontext);
}

function codeBlock(pre) {
  const code = pre.kinder.find((x) => x.tag === "code") || pre;
  const sprache = ((code.attr.class || pre.attr.class || "").match(/(?:language|lang)-([\w+#-]+)/) || [])[1] || pre.attr["data-language"] || "";
  let t = zeilenText(pre).replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  if (!t.trim()) return null;
  const rahmen = "`".repeat(Math.max(3, ...[...t.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
  return `${rahmen}${/^[\w+#-]+$/.test(sprache) ? sprache : ""}\n${t}\n${rahmen}`;
}
// Text mit Zeilenumbrüchen: <br> und Blockenden werden zu \n
function zeilenText(k) {
  if (k.text !== undefined) return k.text;
  if (WEG.has(k.tag)) return "";
  if (k.tag === "br") return "\n";
  const s = k.kinder.map(zeilenText).join("");
  return BLOCK.has(k.tag) && k.tag !== "pre" && !s.endsWith("\n") ? s + "\n" : s;
}

// Listen: Einträge mit Einrückung; verschachtelte Listen innerhalb des Eintrags
function liste(k, kontext, tiefe) {
  const geordnet = k.tag === "ol";
  let nr = geordnet ? parseInt(k.attr.start, 10) || 1 : 0;
  const aufgabenListe = klassen(k).some((c) => /to-do|task-list|contains-task-list/.test(c));
  const zeilen = [];
  for (const li of k.kinder) {
    if (li.text !== undefined) continue;
    if (li.tag === "ul" || li.tag === "ol") { zeilen.push(...liste(li, kontext, tiefe + 1).split("\n")); continue; }
    if (li.tag !== "li") continue;
    const marke = geordnet ? `${nr++}. ` : "- ";
    const einr = " ".repeat(marke.length);
    const teile = blockInhalt({ kinder: li.kinder }, kontext);
    let kopf = "", rest = [];
    for (const t of teile) {
      if (!kopf && !/^(?:[-*+] |\d+\. |```|\||>|#)/.test(t) && !(typeof t === "string" && t.startsWith("  "))) { kopf = t; continue; }
      rest.push(t);
    }
    if (!kopf && rest.length && /^(?:- |\d+\. )/.test(rest[0])) { /* Eintrag, der nur aus einer Unterliste besteht */ }
    let text = kopf.split("\n");
    let vorne = marke;
    // Aufgaben: Kästchen steht schon im Text („[ ] “/„[x] “) oder die Liste ist eine To-do-Liste
    if (/^\[[ xX]\] /.test(text[0])) text[0] = text[0].replace(/^\[([ xX])\] /, (m, x) => `[${x === " " ? " " : "x"}] `);
    else if (aufgabenListe) text[0] = "[ ] " + text[0];
    zeilen.push(vorne + text[0], ...text.slice(1).map((z) => einr + z));
    for (const t of rest) {
      const unterliste = /^(?:[-*+] |\d+\. )/.test(t);
      if (!unterliste) zeilen.push("");
      zeilen.push(...t.split("\n").map((z) => (z ? einr + z : z)));
    }
  }
  return zeilen.join("\n");
}

// Word: Listenabsätze stehen als <p style="mso-list:l0 level2 lfo1">; Marke (·, o, 1., a.) steckt in einem mit mso-list:Ignore ausgezeichneten Span
function wordListe(k, kontext) {
  const stufe = Math.max(1, parseInt((/level(\d+)/.exec(stil(k)) || [])[1], 10) || 1);
  const marke = (function suche(x) {
    if (x.text !== undefined) return null;
    if (x.tag === "span" && /mso-list\s*:\s*ignore/.test(stil(x))) return textVon(x).replace(/[\s\u00a0]+/g, "");
    for (const c of x.kinder) { const r = suche(c); if (r !== null) return r; }
    return null;
  })(k);
  const geordnet = marke !== null && /^[\p{L}\d]+[.)]$/u.test(marke) && !/^[·•o§Øv\-–]$/.test(marke);
  const text = absatz(inlineText(k, kontext)).replace(/\n/g, " ");
  if (!text) return null;
  return " ".repeat((stufe - 1) * (geordnet ? 3 : 2)) + (geordnet ? (/^\d/.test(marke) ? parseInt(marke, 10) : 1) + ". " : "- ") + text;
}

// ---------- Tabellen ----------
function tabelle(t, kontext) {
  const zeilen = [];
  let kopfZeilen = 0;
  const sammle = (knoten, imKopf) => {
    for (const k of knoten.kinder) {
      if (k.text !== undefined) continue;
      if (k.tag === "thead") { sammle(k, true); continue; }
      if (k.tag === "tbody" || k.tag === "tfoot") { sammle(k, false); continue; }
      if (k.tag === "tr") {
        const zellen = [];
        let alleTh = true;
        for (const c of k.kinder) {
          if (c.text !== undefined || (c.tag !== "td" && c.tag !== "th")) continue;
          if (c.tag !== "th") alleTh = false;
          const inhalt = zelleText(c, kontext);
          zellen.push(inhalt);
          for (let n = 1; n < Math.min(12, Math.max(1, parseInt(c.attr.colspan, 10) || 1)); n++) zellen.push("");
        }
        if (!zellen.length) continue;
        zeilen.push(zellen);
        if ((imKopf || alleTh) && zeilen.length === kopfZeilen + 1) kopfZeilen++;
      }
      else if (k.tag === "caption") { /* Titel der Tabelle: wird hier nicht übernommen */ }
      else sammle(k, imKopf);
    }
  };
  sammle(t, false);
  if (!zeilen.length) return null;
  const n = Math.max(...zeilen.map((z) => z.length));
  const voll = zeilen.map((z) => { const x = z.slice(); while (x.length < n) x.push(""); return x; });
  // Ausrichtung aus align-Attribut / text-align der Zellen der ersten Datenzeile
  const ausr = Array.from({ length: n }, () => null);
  const erste = zeilen.length > 1 ? 1 : 0;
  let spalte = 0;
  const ersteTr = [];
  (function f(k) { for (const c of k.kinder) { if (c.text !== undefined) continue; if (c.tag === "tr") ersteTr.push(c); else if (c.tag !== "table") f(c); } })(t);
  const tr = ersteTr.filter((x) => x.kinder.some((c) => c.tag === "td" || c.tag === "th"))[erste];
  if (tr) for (const c of tr.kinder) {
    if (c.text !== undefined || (c.tag !== "td" && c.tag !== "th")) continue;
    const a = (c.attr.align || (/text-align\s*:\s*(left|center|right)/.exec(stil(c)) || [])[1] || "").toLowerCase();
    if (spalte < n) ausr[spalte] = a === "center" ? "c" : a === "right" ? "r" : a === "left" ? "l" : null;
    spalte += Math.min(12, Math.max(1, parseInt(c.attr.colspan, 10) || 1));
  }
  const schutz = (s) => s.replace(/\|/g, "\\|");
  const trennzeile = ausr.map((a) => (a === "c" ? ":---:" : a === "r" ? "---:" : a === "l" ? ":---" : "---"));
  const linie = (z) => "| " + z.map(schutz).join(" | ") + " |";
  const kopf = voll[0], rumpf = voll.slice(1);
  return [linie(kopf), "| " + trennzeile.join(" | ") + " |", ...rumpf.map(linie)].join("\n");
}
function zelleText(c, kontext) {
  const inh = blockInhalt(c, { ...kontext, zelle: true });
  return inh.join("<br>").replace(/\\\n/g, "<br>").replace(/\n+/g, "<br>").replace(/\s+/g, " ").trim();
}

// Aufeinanderfolgende Listenzeilen (Word liefert jeden Eintrag als eigenen Absatz) gehören in eine Liste, ohne Leerzeile dazwischen
const PUNKT = /^\s*[-*+] [^\n]*$/, NUMMER = /^\s*\d+\. [^\n]*$/;
export function fuege(bloecke) {
  let aus = "";
  bloecke.forEach((b, i) => {
    const v = bloecke[i - 1];
    const zusammen = i > 0 && ((PUNKT.test(v) && PUNKT.test(b)) || (NUMMER.test(v) && NUMMER.test(b)));
    aus += i === 0 ? b : (zusammen ? "\n" : "\n\n") + b;
  });
  return aus;
}

// ---------- Eingang ----------
// Gibt es etwas, das Markdown braucht (Überschrift, Liste, Tabelle, Link, fett …)? Sonst ist der reine Text die bessere Wahl (z. B. aus einem Code-Editor).
const STRUKTUR = /<(h[1-6]|ul|ol|li|table|a|strong|b|em|i|code|pre|img|blockquote|del|s|strike|hr|p)[\s>/]/i;
export function hatStruktur(html) {
  if (typeof html !== "string" || !html.trim()) return false;
  const roh = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  return STRUKTUR.test(roh) || FETT.test(roh.toLowerCase()) || KURSIV.test(roh.toLowerCase()) || DURCH.test(roh.toLowerCase());
}

export function htmlZuMarkdown(html, optionen = {}) {
  if (typeof html !== "string" || !html) return "";
  // Das Fragment der Zwischenablage (Windows/Word): nur der Teil zwischen den Markierungen zählt
  const a = html.indexOf("<!--StartFragment-->"), b = html.indexOf("<!--EndFragment-->");
  if (a >= 0 && b > a) html = html.slice(a + 20, b);
  const baum = liesHtml(html);
  // Das <body> (falls vorhanden) ist die Wurzel; <head> fällt über WEG weg
  const bloecke = blockInhalt(baum, { bild: optionen.bild });
  return fuege(bloecke).replace(/\n{3,}/g, "\n\n").replace(/\u00a0/g, " ").trim();
}
