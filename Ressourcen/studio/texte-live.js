// Texte der Live-Aktualisierung (Deutsch): Hinweise, wenn eine KI im Hintergrund Aufgaben anlegt.
const MAX_TITEL = 3;
const q = (t) => `„${t}“`;
export const TL = {
  // name: Anzeigename der KI (z. B. „Claude“); null bei mehreren verschiedenen → „Eine KI“
  aufgabeAngelegt: (name, titel) => {
    const wer = name || "Eine KI";
    if (titel.length === 1) return `${wer} hat eine Aufgabe angelegt: ${q(titel[0])}`;
    const zeigen = titel.slice(0, MAX_TITEL).map(q).join(", ");
    const rest = titel.length - MAX_TITEL;
    return `${wer} hat ${titel.length} Aufgaben angelegt: ${zeigen}${rest > 0 ? ` und ${rest} weitere` : ""}`;
  },
  aufgabeOhneTitel: "Aufgabe ohne Titel",
};
