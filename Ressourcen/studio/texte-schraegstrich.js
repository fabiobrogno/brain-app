// Texte des Schrägstrich-Menüs im Editor. Deutsch, Du-Form; App „Kortex“, Datenordner „Vault“.
export const TSM = {
  menue: "Einfügen und umwandeln",
  leer: "Nichts gefunden",
  gruppen: { text: "Text", listen: "Listen", bloecke: "Blöcke", einfuegen: "Einfügen" },
  eintraege: {
    text: "Text", h1: "Überschrift 1", h2: "Überschrift 2", h3: "Überschrift 3",
    aufgabe: "Aufgabe", punkt: "Aufzählung", nummer: "Nummerierung",
    zitat: "Zitat", callout: "Callout", code: "Codeblock", trennlinie: "Trennlinie", tabelle: "Tabelle",
    datei: "Bild oder Datei", notiz: "Link zu Notiz", datum: "Datum heute",
  },
  beschreibung: {
    text: "Normaler Absatz", h1: "Große Überschrift", h2: "Mittlere Überschrift", h3: "Kleine Überschrift",
    aufgabe: "Liste mit Kästchen", punkt: "Liste mit Punkten", nummer: "Liste mit Zahlen",
    zitat: "Hervorgehobener Absatz", callout: "Farbiger Hinweiskasten", code: "Text in fester Schrift", trennlinie: "Waagerechte Linie", tabelle: "Zeilen und Spalten",
    datei: "Aus dem Dateidialog", notiz: "Verweis auf eine andere Notiz", datum: "Das heutige Datum",
  },
  // Suchwörter (Umlaute egal): deutsch und englisch
  woerter: {
    text: ["absatz", "paragraph", "normal", "plain"],
    h1: ["h1", "ueberschrift 1", "titel", "heading", "heading 1", "gross"],
    h2: ["h2", "ueberschrift 2", "untertitel", "heading 2", "mittel"],
    h3: ["h3", "ueberschrift 3", "heading 3", "klein"],
    aufgabe: ["todo", "to-do", "checkliste", "checkbox", "kaestchen", "task", "aufgaben", "checklist"],
    punkt: ["liste", "aufzaehlung", "punkte", "bullet", "list"],
    nummer: ["nummeriert", "nummerierte liste", "zahlen", "numbered", "ordered", "liste"],
    zitat: ["quote", "blockquote", "zitieren"],
    callout: ["hinweis", "hint", "notice", "kasten", "box", "info", "achtung", "warnung", "tipp", "tip", "admonition", "note", "warning"],
    code: ["codeblock", "code block", "quelltext", "snippet", "programm"],
    trennlinie: ["linie", "strich", "trenner", "divider", "hr", "rule", "line", "horizontal"],
    tabelle: ["table", "raster", "spalten", "zeilen", "grid"],
    datei: ["bild", "image", "foto", "anhang", "datei", "file", "upload", "pdf", "attachment", "picture"],
    notiz: ["link", "wikilink", "verweis", "verknuepfung", "seite", "note", "page", "mention", "erwaehnen"],
    datum: ["heute", "today", "date", "kalender", "zeit"],
  },
};
