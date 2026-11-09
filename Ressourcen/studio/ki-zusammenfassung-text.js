// Der Text, den „In den Posteingang legen“ schreibt — gebaut von Kortex aus dem geprüften Ergebnis, nie von der KI selbst (rein, ohne Oberfläche; Test: Tests/Node/ki-zusammenfassung-text.test.mjs).
// Die Sätze der KI sind fremder Text: Markdown-Zeichen werden entschärft (kein Link, kein Bild, keine Überschrift, kein HTML), Adressen nach außen werden nicht anklickbar.
const STEUER = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+", "g");
export const markdownSicher = (s) => String(s ?? "")
  .replace(STEUER, " ")
  .replace(/[\\`*_\[\]<>#|~!{}]/g, "\\$&")
  .replace(/\b(https?|ftp|mailto)(:)/gi, "$1\\$2") // erst nach dem Entschärfen: das eigene „\“ bleibt einfach
  .replace(/\bwww\./gi, "www\\.")
  .replace(/\s+/g, " ")
  .trim();
// Titel in [[Links]]: ohne die Zeichen, die einen Link sprengen oder umlenken würden
export const linkTitel = (s) => String(s ?? "").replace(STEUER, " ").replace(/[\[\]|#^\\<>]/g, "").replace(/\s+/g, " ").trim();

// ergebnis: { saetze: [{ text, belege: [{ titel }] }] } · seitText: „Mo., 9. Nov., 08:00“ o. ä. (nur Anzeige) · datum: JJJJ-MM-TT
// → { titel, text }  (für api.merken)
export function baueMerkText(ergebnis, { seitText = "", datum = "" } = {}) {
  const saetze = Array.isArray(ergebnis?.saetze) ? ergebnis.saetze : [];
  const zeilen = saetze.map((s) => {
    const links = [...new Set((s.belege || []).map((b) => linkTitel(b.titel)).filter(Boolean))].map((t) => `[[${t}]]`);
    return `- ${markdownSicher(s.text)}${links.length ? ` (${links.join(", ")})` : ""}`;
  });
  const kopf = `Von einer KI zusammengefasst${seitText ? `, was seit ${markdownSicher(seitText)} neu ist` : ""}. Grundlage waren nur Titel, Art und Zeit, nicht die Inhalte der Notizen. Prüfe es, bevor du dich darauf verlässt.`;
  return { titel: `KI-Zusammenfassung: Was ist neu${datum ? ` (${datum})` : ""}`, text: `${kopf}\n\n${zeilen.join("\n")}` };
}
