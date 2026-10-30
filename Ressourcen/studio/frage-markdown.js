// Sicheres Markdown für die Antwort der KI („Frag deinen Vault“). Die Antwort ist Text von außen und wird NIE als HTML behandelt: es entstehen nur Elemente aus
// einer festen Liste (p, h3–h6, ul, ol, li, blockquote, pre, code, strong, em, del, hr, table, br, span, button), Inhalte gelangen nur über createTextNode/textContent
// hinein. Kein innerHTML, keine Attribute aus dem Text, keine Links: ein Markdown-Link zeigt nur den Text (und die Adresse als Text), nichts ist anklickbar außer
// Verweisen auf Seiten dieses Vaults ([[Seite]], aufgelöst von der Werkstatt: nur Seiten, die es gibt).
//   rendereMarkdown(text, { verweise: { "<Ziel im Text>": "<Pfad im Vault>"|null }, oeffne: (pfad) => … }) → DocumentFragment
const MAX_TIEFE = 4;
const el = (tag, klasse, ...kinder) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  for (const k of kinder) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const basis = (p) => p.split("/").pop().replace(/\.(md|txt)$/i, "");

// ---------- Inline ----------
const INLINE = /(`+)([^`][\s\S]*?[^`]|[^`])\1(?!`)|\[\[([^\[\]\n]{1,300})\]\]|\*\*([^*\n]+?)\*\*|(?<![\p{L}\p{N}_])__([^_\n]+?)__(?![\p{L}\p{N}_])|~~([^~\n]+?)~~|(?<![\p{L}\p{N}*])\*([^*\s][^*\n]*?)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_([^_\s][^_\n]*?)_(?![\p{L}\p{N}_])|\[([^\]\n]{1,300})\]\(([^)\s]{1,500})\)/gu;
function inline(text, ziel, opt, tiefe = 0) {
  if (tiefe > MAX_TIEFE) { ziel.append(document.createTextNode(text)); return; }
  let pos = 0;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, INLINE.flags);
  for (let m; (m = re.exec(text)); ) {
    if (m.index > pos) ziel.append(document.createTextNode(text.slice(pos, m.index)));
    pos = m.index + m[0].length;
    if (m[1] !== undefined) ziel.append(el("code", "md-code", m[2].trim()));
    else if (m[3] !== undefined) ziel.append(wiki(m[3], opt));
    else if (m[4] !== undefined || m[5] !== undefined) { const s = el("strong"); inline(m[4] ?? m[5], s, opt, tiefe + 1); ziel.append(s); }
    else if (m[6] !== undefined) { const s = el("del"); inline(m[6], s, opt, tiefe + 1); ziel.append(s); }
    else if (m[7] !== undefined || m[8] !== undefined) { const s = el("em"); inline(m[7] ?? m[8], s, opt, tiefe + 1); ziel.append(s); }
    else if (m[9] !== undefined) { // [Text](Adresse): nie ein Link — der Text, und die Adresse nur als Text, wenn sie nach Web aussieht
      const s = el("span", "md-linktext"); inline(m[9], s, opt, tiefe + 1); ziel.append(s);
      if (/^https?:\/\//i.test(m[10])) ziel.append(el("span", "md-url", ` (${m[10]})`));
    }
  }
  if (pos < text.length) ziel.append(document.createTextNode(text.slice(pos)));
}
function wiki(roh, opt) {
  const [zielTeil, alias] = roh.split("|");
  const pfad = opt.verweise && Object.hasOwn(opt.verweise, roh) ? opt.verweise[roh] : null;
  const name = (alias && alias.trim()) || (pfad ? basis(pfad) : zielTeil.split("#")[0].trim());
  if (typeof pfad === "string" && pfad && opt.oeffne) {
    const b = el("button", "md-wiki", name);
    b.type = "button"; b.title = pfad; b.dataset.pfad = pfad;
    b.addEventListener("click", () => opt.oeffne(pfad));
    return b;
  }
  const s = el("span", "md-wiki nein", name);
  s.title = "Diese Seite gibt es in deinem Vault nicht.";
  return s;
}

// ---------- Blöcke ----------
const LISTE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABELLEN_KOPF = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const zellen = (z) => z.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const BLOCK_START = (z) => /^(#{1,6}\s|```|~~~|>\s?|\s*([-*_])(\s*\2){2,}\s*$)/.test(z) || LISTE.test(z);

function baueListe(eintraege, ziel, opt, tiefe) {
  // eintraege: [{ einzug, geordnet, text }] → verschachtelte Listen nach Einzug (höchstens MAX_TIEFE Ebenen)
  const wurzel = { kinder: [], einzug: -1 };
  const keller = [wurzel];
  for (const e of eintraege) {
    while (keller.length > 1 && e.einzug <= keller[keller.length - 1].einzug) keller.pop();
    const eltern = keller[keller.length - 1];
    const n = { ...e, kinder: [] };
    if (keller.length - 1 >= MAX_TIEFE) { keller[keller.length - 1].kinder.push(n); continue; }
    eltern.kinder.push(n); keller.push(n);
  }
  const zeichne = (knoten, host) => {
    if (!knoten.kinder.length) return;
    const liste = el(knoten.kinder[0].geordnet ? "ol" : "ul", "md-liste");
    for (const k of knoten.kinder) { const li = el("li"); inline(k.text, li, opt, tiefe + 1); zeichne(k, li); liste.append(li); }
    host.append(liste);
  };
  zeichne(wurzel, ziel);
}

function bloecke(text, ziel, opt, tiefe = 0) {
  const zeilen = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < zeilen.length) {
    const z = zeilen[i];
    if (!z.trim()) { i++; continue; }
    const zaun = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)/.exec(z);
    if (zaun) { // Code-Block: bis zum schließenden Zaun oder bis zum Ende (die Antwort kann mittendrin stehen)
      const code = [];
      i++;
      while (i < zeilen.length && !new RegExp(`^\\s{0,3}${zaun[1][0]}{${zaun[1].length},}\\s*$`).test(zeilen[i])) code.push(zeilen[i++]);
      i++;
      ziel.append(el("pre", "md-pre", el("code", null, code.join("\n"))));
      continue;
    }
    const ueber = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(z);
    if (ueber) { const h = el(`h${Math.min(6, ueber[1].length + 2)}`, "md-h"); inline(ueber[2], h, opt, tiefe + 1); ziel.append(h); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(z)) { ziel.append(el("hr", "md-hr")); i++; continue; }
    if (/^\s{0,3}>/.test(z)) {
      const q = [];
      while (i < zeilen.length && /^\s{0,3}>/.test(zeilen[i])) q.push(zeilen[i++].replace(/^\s{0,3}>\s?/, ""));
      const b = el("blockquote", "md-zitat");
      if (tiefe < MAX_TIEFE) bloecke(q.join("\n"), b, opt, tiefe + 1); else b.append(document.createTextNode(q.join("\n")));
      ziel.append(b);
      continue;
    }
    if (LISTE.test(z)) {
      const eintraege = [];
      while (i < zeilen.length) {
        const m = LISTE.exec(zeilen[i]);
        if (m) { eintraege.push({ einzug: m[1].replace(/\t/g, "    ").length, geordnet: /\d/.test(m[2]), text: m[3] }); i++; }
        else if (zeilen[i].trim() && /^\s{2,}\S/.test(zeilen[i]) && eintraege.length) { eintraege[eintraege.length - 1].text += ` ${zeilen[i].trim()}`; i++; } // Fortsetzungszeile
        else if (!zeilen[i].trim() && i + 1 < zeilen.length && LISTE.test(zeilen[i + 1])) i++; // Leerzeile zwischen Einträgen
        else break;
      }
      baueListe(eintraege, ziel, opt, tiefe);
      continue;
    }
    if (z.includes("|") && i + 1 < zeilen.length && TABELLEN_KOPF.test(zeilen[i + 1]) && zeilen[i + 1].includes("-")) {
      const kopf = zellen(z);
      i += 2;
      const tabelle = el("table", "md-tabelle"), tk = el("thead"), tr0 = el("tr");
      for (const c of kopf) { const th = el("th"); inline(c, th, opt, tiefe + 1); tr0.append(th); }
      tk.append(tr0); tabelle.append(tk);
      const tb = el("tbody");
      while (i < zeilen.length && zeilen[i].includes("|") && zeilen[i].trim()) {
        const tr = el("tr");
        for (const c of zellen(zeilen[i]).slice(0, Math.max(kopf.length, 1))) { const td = el("td"); inline(c, td, opt, tiefe + 1); tr.append(td); }
        tb.append(tr); i++;
      }
      tabelle.append(tb);
      const rahmen = el("div", "md-tabelle-rahmen"); rahmen.append(tabelle); ziel.append(rahmen);
      continue;
    }
    // Absatz: bis zur Leerzeile oder zum nächsten Block
    const teile = [z.trim()];
    i++;
    while (i < zeilen.length && zeilen[i].trim() && !BLOCK_START(zeilen[i])) teile.push(zeilen[i++].trim());
    const p = el("p", "md-p");
    inline(teile.join(" "), p, opt, tiefe + 1);
    ziel.append(p);
  }
}

export function rendereMarkdown(text, opt = {}) {
  const f = document.createDocumentFragment();
  bloecke(String(text ?? "").slice(0, 200_000), f, { verweise: opt.verweise || {}, oeffne: typeof opt.oeffne === "function" ? opt.oeffne : null });
  return f;
}
