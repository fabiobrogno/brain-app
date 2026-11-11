// Callouts (`> [!typ] Titel`) wie in Obsidian: reine Regeln ohne Editor und ohne DOM (Node-getestet).
// Die Datei bleibt, wie sie ist; gezeigt wird nur per Dekoration (editor-callouts.js).

// Obsidian-Arten und ihre Schreibweisen. Der Schlüssel ist die Art, die gezeichnet wird (Farbe, Symbol); alles andere ist ein Alias.
export const ARTEN = {
  note: [],
  abstract: ["summary", "tldr"],
  info: [],
  todo: [],
  tip: ["hint", "important"],
  success: ["check", "done"],
  question: ["help", "faq"],
  warning: ["caution", "attention"],
  failure: ["fail", "missing"],
  danger: ["error"],
  bug: [],
  example: [],
  quote: ["cite"],
};

const ALIAS = new Map();
for (const [art, alias] of Object.entries(ARTEN)) { ALIAS.set(art, art); for (const a of alias) ALIAS.set(a, art); }

// „tipp“ und „hinweis“ kennt Obsidian nicht (unbekannt = Notiz), aber deutsche Schreiber tippen sie: sie bekommen die Optik, die sie meinen.
ALIAS.set("tipp", "tip"); ALIAS.set("hinweis", "info"); ALIAS.set("warnung", "warning"); ALIAS.set("gefahr", "danger"); ALIAS.set("beispiel", "example"); ALIAS.set("frage", "question");
ALIAS.set("zitat", "quote"); ALIAS.set("fehler", "failure"); ALIAS.set("aufgabe", "todo"); ALIAS.set("zusammenfassung", "abstract"); ALIAS.set("erfolg", "success"); ALIAS.set("notiz", "note");

export const bekannt = (typ) => ALIAS.has(String(typ).toLowerCase());
export const artVon = (typ) => ALIAS.get(String(typ).toLowerCase()) || "note"; // unbekannter Typ = Notiz

// Kopfzeile eines Zitats ohne die Zitatmarke: „[!tip]- Titel“ → { typ, art, falt: "-" | "+" | null, titel, titelVon } oder null.
// titelVon = Spalte, ab der der Titel beginnt (nach Marke und Leerzeichen), sonst Ende der Marke.
const KOPF = /^([ \t]*)\[!([A-Za-z0-9_-]+)\]([+-])?([ \t]*)(.*)$/;
export function parseKopf(text) {
  const m = KOPF.exec(text);
  if (!m) return null;
  const marke = m[1].length + m[2].length + 3 + (m[3] ? 1 : 0);
  const titel = m[5].replace(/[ \t]+$/, "");
  return { typ: m[2], art: artVon(m[2]), falt: m[3] || null, titel, titelVon: titel ? marke + m[4].length : marke };
}

// Standardmäßig zugeklappt? („-“ ja, „+“ und ohne Zeichen offen.) umgeschaltet = der Nutzer hat den Zustand per Klick getauscht.
export const istZu = (falt, umgeschaltet) => (falt === "-") !== !!umgeschaltet && !!falt;
