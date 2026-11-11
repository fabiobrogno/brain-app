// Reine Textfunktionen der Suche (ohne Oberfläche, in Node getestet): Markdown-Zeichen aus Fundstellen entfernen, Marken umrechnen, Treffer nach Abdeckung ordnen.
// Markdown-Zeichen fallen weg, der Text bleibt lesbar: Wikilinks zeigen ihren Namen (oder Alias), Links ihren Text, Überschrift-Rauten, Zitat- und Listenzeichen,
// Hervorhebungen, Code- und Durchstreichzeichen verschwinden. Rückgabe: { text, karte } – karte[i] = Index des Zeichens i im Original (für die Marken).
const ZEILENANFANG = /^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)+/;
const MD = [
  [/!?\[\[([^\]|#\n]*)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (m) => m[2] ?? m[1]],   // [[Ziel#Abschnitt|Alias]], ![[Datei]]
  [/!?\[([^\]\n]*)\]\([^)\n]*\)/g, (m) => m[1]],                                      // [Text](adresse)
  [/(\*\*|__|~~|==)(?=\S)([^\n]*?\S)\1/g, (m) => m[2]],                                   // **fett**, __fett__, ~~weg~~, ==markiert==
  [/(?<![\w*])([*_])(?=\S)([^*_\n]*?\S)\1(?![\w*])/g, (m) => m[2]],                      // *kursiv*, _kursiv_
  [/`([^`\n]+)`/g, (m) => m[1]],                                                          // `code`
];
export function ohneMarkdown(text) {
  const s = String(text ?? "");
  const karte = [];
  let aus = "", pos = 0;
  const zA = ZEILENANFANG.exec(s);
  if (zA && zA[0].length > zA[1].length) pos = zA[0].length;
  while (pos < s.length) {
    let best = null;
    for (const [re, f] of MD) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (m && (!best || m.index < best.von)) best = { von: m.index, bis: m.index + m[0].length, ersatz: f(m), roh: m[0] };
    }
    const bis = best ? best.von : s.length;
    for (let i = pos; i < bis; i++) { karte.push(i); aus += s[i]; }
    if (!best) break;
    const versatz = best.ersatz ? Math.max(0, best.roh.indexOf(best.ersatz)) : 0;
    for (let i = 0; i < best.ersatz.length; i++) { karte.push(best.von + versatz + i); aus += best.ersatz[i]; }
    pos = best.bis;
  }
  return { text: aus, karte };
}
// Marken ([[von, bis], …] im Original) auf den bereinigten Text umrechnen; Marken, die ganz in entfernten Zeichen lagen, entfallen
export function neueMarken(marken, karte) {
  const aus = [];
  for (const [von, bis] of marken || []) {
    let a = -1, b = -1;
    for (let i = 0; i < karte.length; i++) { if (karte[i] >= von && karte[i] < bis) { if (a < 0) a = i; b = i + 1; } }
    if (a >= 0) aus.push([a, b]);
  }
  return aus;
}

// Inhaltstreffer: wer mehr verschiedene Suchwörter trägt (Titel und Fundstellen zusammen), steht vorn; sonst bleibt die Reihenfolge der Werkstatt
export function abdeckung(t) {
  const w = new Set();
  const nimm = (text, marken) => { for (const [a, b] of marken || []) w.add(String(text ?? "").slice(a, b).toLowerCase()); };
  nimm(t.titel, t.titelMarken);
  for (const st of t.stellen || []) nimm(st.text, st.marken);
  return w.size;
}
export const nachAbdeckung = (liste) => liste.map((t, i) => [t, i, abdeckung(t)]).sort((a, b) => b[2] - a[2] || a[1] - b[1]).map((x) => x[0]);
