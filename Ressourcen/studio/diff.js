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
