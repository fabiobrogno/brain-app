// Reine Regeln der KI-Text-Aktionen im Editor (ohne DOM, in Node getestet): wann darf eine Auswahl an die KI, wie wird ein Ergebnis eingepasst.
// Docs: docs/plaene/ki-runde.md (K2). Der Text im Editor hat überall „\n“ als Zeilenende; das Zeilenende der Datei steht in state.lineBreak.
export const AKTIONEN = ["umschreiben", "kuerzen", "uebersetzen", "aufgaben"];
export const SPRACHEN = ["de", "en", "fr", "es", "it"];
export const MAX_AUSWAHL = 8000; // wie werkstatt/ki-vorschlag.mjs (GRENZEN.eingabe.auswahl), gemessen am Text mit den Zeilenenden der Datei

const ZAUN = /^ {0,3}(`{3,}|~{3,})/;
const TABELLE = /^\s*\|.*\|\s*$/;

// Bereiche [von, bis) in Dokumentpositionen, in denen keine KI-Aktion läuft: Code-Zäune (samt Zaunzeilen), Tabellenzeilen, Datei-Kopf (Front-Matter)
export function gesperrteBereiche(doc) {
  const text = String(doc ?? "");
  const aus = [];
  const zeilen = text.split("\n");
  let pos = 0, zaun = null, kopfEnde = -1;
  if (/^---[ \t]*(\n|$)/.test(text)) {
    let p = text.indexOf("\n") + 1;
    for (const z of zeilen.slice(1)) { if (/^---[ \t]*$/.test(z) || /^\.\.\.[ \t]*$/.test(z)) { kopfEnde = p + z.length; break; } p += z.length + 1; }
    if (kopfEnde >= 0) aus.push({ von: 0, bis: kopfEnde, art: "kopf" });
  }
  for (const z of zeilen) {
    const ende = pos + z.length;
    const m = ZAUN.exec(z);
    if (zaun) {
      zaun.bis = ende;
      if (m && m[1][0] === zaun.zeichen && m[1].length >= zaun.laenge && /^ {0,3}[`~]+\s*$/.test(z)) { aus.push({ von: zaun.von, bis: ende, art: "code" }); zaun = null; }
    } else if (m) zaun = { von: pos, bis: ende, zeichen: m[1][0], laenge: m[1].length };
    else if (TABELLE.test(z) && (kopfEnde < 0 || pos > kopfEnde)) aus.push({ von: pos, bis: ende, art: "tabelle" });
    pos = ende + 1;
  }
  if (zaun) aus.push({ von: zaun.von, bis: zaun.bis, art: "code" }); // nicht geschlossener Zaun reicht bis zum Ende
  return aus;
}

// → { ok: true } | { ok: false, grund: "leer" | "zulang" | "code" | "tabelle" | "kopf" }
// laenge: Zeichen der Auswahl mit den Zeilenenden der Datei (so zählt die Werkstatt)
export function pruefeAuswahl(doc, von, bis, { laenge = bis - von, bereiche = null } = {}) {
  if (!(bis > von) || !String(doc).slice(von, bis).trim()) return { ok: false, grund: "leer" };
  if (laenge > MAX_AUSWAHL) return { ok: false, grund: "zulang" };
  for (const b of bereiche || gesperrteBereiche(doc)) if (von < b.bis && bis > b.von) return { ok: false, grund: b.art };
  return { ok: true };
}

// Das Zeilenende der Datei auf einen Text der KI anwenden (die KI liefert „\n“): so ist der Diff frei von Zeilenende-Rauschen und das Einfügen passt zur Datei
export const mitZeilenende = (text, zeilenende) => String(text ?? "").replace(/\r\n|\r|\n/g, zeilenende === "\r\n" || zeilenende === "\r" ? zeilenende : "\n");

// „Aufgaben herausziehen“ als Markdown unter der Auswahl: → { pos, einfuegen } (Zeilenende „\n“; der Aufrufer wendet das der Datei an).
// Steht die Auswahl in einer Liste, folgt die Aufgabenliste mit demselben Einzug direkt darunter; sonst mit einer Leerzeile davor (und danach, wenn gleich Text folgt).
export function aufgabenEinfuegung(doc, bis, aufgaben) {
  const text = String(doc ?? "");
  const ende = bis > 0 && text[bis - 1] === "\n" ? bis - 1 : bis; // eine Auswahl, die den Zeilenumbruch am Ende mitnimmt, gehört noch zur Zeile davor
  const zeilenStart = text.lastIndexOf("\n", Math.max(0, ende - 1)) + 1;
  let zeilenEnde = text.indexOf("\n", ende);
  if (zeilenEnde < 0) zeilenEnde = text.length;
  const zeile = text.slice(zeilenStart, zeilenEnde);
  const liste = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(zeile);
  const einzug = liste ? liste[1] : "";
  const zeilen = aufgaben.map((a) => `${einzug}- [ ] ${aufgabeAlsText(a)}`);
  let naechste = null;
  if (zeilenEnde < text.length) { const e2 = text.indexOf("\n", zeilenEnde + 1); naechste = text.slice(zeilenEnde + 1, e2 < 0 ? text.length : e2); }
  const folgtText = naechste !== null && naechste.trim() !== "" && !/^\s*(?:[-*+]|\d+[.)])\s/.test(naechste);
  return { pos: zeilenEnde, einfuegen: (liste ? "\n" : "\n\n") + zeilen.join("\n") + (!liste && folgtText ? "\n" : "") + (liste && folgtText ? "\n" : "") };
}
export const aufgabeAlsText = (a) => String(a.text).replace(/\s*\n\s*/g, " ").trim() + (a.faellig ? ` (fällig ${a.faellig})` : "");
