// Unified-Diff als DOM (ohne innerHTML). Wird von der Eigenschaften-Spalte genutzt.
import { h } from "./hilfen.js";
import { T } from "./texte.js";

export function diffAnsicht(text) {
  if (!text || !text.trim()) return h("div", { klasse: "leise", text: T.info.keineAenderung });
  const zeilen = text.split("\n").filter((z, i, a) => !(i === a.length - 1 && z === ""));
  return h("div", { klasse: "diff", "data-diff": "" }, zeilen.map((z) => {
    const k = /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(z) ? "k" : z.startsWith("@@") ? "h" : z[0] === "+" ? "p" : z[0] === "-" ? "m" : "";
    return h("div", { klasse: k, text: z || " " });
  }));
}

// ---- Wort-Diff (KI-Text-Aktionen, K2): die Teile aus wort-diff.js#wortDiff als DOM, nur über textContent. „weg“ in <del>, „neu“ in <ins>, Gleiches als Text.
// Zeilenenden werden nur für die Anzeige vereinheitlicht (CRLF → ein Umbruch); die Daten bleiben byte-treu. Reiner Leerraum in einer Änderung bekommt Zeichen
// („·“ für Leerzeichen, „⏎“ für Umbrüche), damit man sieht, was sich ändert.
export { wortDiff, wortDiffAnzeige, hatAenderung, textAlt, textNeu } from "./wort-diff.js";
const anzeige = (s) => s.replace(/\r\n|\r/g, "\n");
export function wortDiffAnsicht(teile, { label = "" } = {}) {
  const wurzel = h("div", { klasse: "wd", "data-wort-diff": "", role: "group", ...(label ? { "aria-label": label } : {}) });
  for (const x of teile) {
    if (x.t === "gleich") { wurzel.append(document.createTextNode(anzeige(x.s))); continue; }
    const nurLeer = /^\s+$/.test(x.s);
    const el = h(x.t === "weg" ? "del" : "ins", { klasse: x.t === "weg" ? "wd-weg" : "wd-neu", "data-wd": x.t });
    el.textContent = nurLeer ? anzeige(x.s).replace(/ /g, "·").replace(/\n/g, "⏎\n") : anzeige(x.s);
    wurzel.append(el);
  }
  return wurzel;
}
