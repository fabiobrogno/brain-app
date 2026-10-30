// „Lizenzen …“ (Einstellungen): zeigt THIRD-PARTY-NOTICES.md, die Datei mit den Hinweisen zu Software und Material von Dritten.
// Der App-Bau legt sie neben die Oberfläche (Contents/Resources/studio/THIRD-PARTY-NOTICES.md); die Werkstatt liefert sie wie jede andere
// Studio-Datei aus. Im Entwicklungsserver (ohne App-Bau) fehlt sie: dann sagt der Dialog das, statt leer zu bleiben.
// Kein innerHTML: alles über h() und textContent. Gezeigt wird schlicht (Überschriften, Absätze, Tabellen und Lizenztexte in fester Schrift).
import { h, dialog } from "./hilfen.js";

export const LIZENZ_DATEI = "THIRD-PARTY-NOTICES.md";
const TEXTE = {
  titel: "Lizenzen",
  einleitung: "Kortex enthält Software und Material von Dritten. Hier stehen ihre Lizenzen.",
  laedt: "Wird geladen …",
  fehlt: "Die Lizenzdatei liegt in dieser Ausführung nicht bei. In der fertigen App steht sie im Paket (Kortex.app/Contents/Resources/THIRD-PARTY-NOTICES.md) und im Quellcode von Kortex.",
  zu: "Schließen",
};

// Zerlegt den Markdown-Text in Blöcke: { art: "h"|"p"|"code", text, stufe? }. Tabellen und Zaunblöcke (```) werden als Code gezeigt.
export function zerlegeLizenzText(text) {
  const bloecke = [];
  let absatz = [];
  let code = null;
  const absatzFertig = () => {
    if (!absatz.length) return;
    const tabelle = absatz.every((z) => z.startsWith("|"));
    bloecke.push({ art: tabelle ? "code" : "p", text: absatz.join(tabelle ? "\n" : " ") });
    absatz = [];
  };
  for (const zeile of String(text).split("\n")) {
    if (code) {
      if (zeile.startsWith("```")) { bloecke.push({ art: "code", text: code.join("\n") }); code = null; } else code.push(zeile);
      continue;
    }
    if (zeile.startsWith("```")) { absatzFertig(); code = []; continue; }
    const kopf = /^(#{1,3})\s+(.*)$/.exec(zeile);
    if (kopf) { absatzFertig(); bloecke.push({ art: "h", stufe: kopf[1].length, text: kopf[2] }); continue; }
    if (!zeile.trim()) { absatzFertig(); continue; }
    absatz.push(zeile.trim());
  }
  if (code) bloecke.push({ art: "code", text: code.join("\n") });
  absatzFertig();
  return bloecke;
}

// Entfernt die Markdown-Zeichen, die als Text stören würden (`code`, **fett**, *kursiv*).
const schlicht = (t) => t.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");

export function baueLizenzAnsicht(text) {
  const wurzel = h("div", { klasse: "lizenzen", "data-lizenzen": "text" });
  for (const b of zerlegeLizenzText(text)) {
    if (b.art === "h") wurzel.append(h(b.stufe === 1 ? "h2" : "h3", { text: schlicht(b.text), style: "margin:14px 0 4px;font-size:" + (b.stufe === 1 ? "16px" : "13px") }));
    else if (b.art === "code") wurzel.append(h("pre", { text: b.text.replace(/`/g, ""), style: "margin:6px 0;padding:10px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 var(--mono);color:var(--text-2);border:1px solid var(--linie-stark);border-radius:8px;max-height:260px" }));
    else wurzel.append(h("p", { text: schlicht(b.text), style: "margin:6px 0;font-size:12.5px;line-height:1.5;overflow-wrap:anywhere" }));
  }
  return wurzel;
}

export async function ladeLizenzText(holen = (u) => fetch(u, { cache: "no-store" })) {
  const r = await holen(new URL(LIZENZ_DATEI, document.baseURI).href);
  if (!r.ok) throw new Error("fehlt");
  const t = await r.text();
  if (!t.trim()) throw new Error("leer");
  return t;
}

export function oeffneLizenzen({ holen } = {}) {
  const platz = h("div", { klasse: "mini", "data-lizenzen": "platz", text: TEXTE.laedt });
  const zu = h("button", { klasse: "knopf", type: "button", "data-aktion": "lizenzen-zu", text: TEXTE.zu, aufClick: () => d.schliessen() });
  const d = dialog({ titel: TEXTE.titel, breit: true, rumpf: [h("p", { klasse: "mini", text: TEXTE.einleitung }), platz], knoepfe: [zu] });
  ladeLizenzText(holen).then(
    (t) => { if (platz.isConnected) platz.replaceWith(baueLizenzAnsicht(t)); },
    () => { if (platz.isConnected) { platz.textContent = TEXTE.fehlt; platz.setAttribute("data-lizenzen", "fehlt"); } },
  );
  return d;
}
