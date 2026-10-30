// Texte der Bausteine (Deutsch). Eigene Datei, damit texte.js klein bleibt.
export const TB = {
  waehlen: "Wählen …",
  zuruecksetzen: (name) => `${name} zurücksetzen`,
  loeschen: "Eingabe löschen",
  datum: { keins: "Kein Datum", waehlen: "Datum wählen", heute: "Heute", morgen: "Morgen", naechsteWoche: "Nächste Woche", kein: "Kein Datum", vor: "Voriger Monat", nach: "Nächster Monat", kalender: "Kalender" },
  wochentage: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  laedt: "Wird geladen …",
  // KI-Auswahl (kiAuswahl in bausteine.js)
  ki: {
    label: "KI wählen",
    gefundenTitel: "Auf diesem Computer gefunden",
    beliebtTitel: "Beliebte KIs",
    sucht: "Wird gesucht …",
    nichtDa: "Nicht installiert",
    gefunden: (version) => (version ? `Gefunden · ${version}` : "Gefunden"),
    gefundenNichtVerbindbar: "Noch nicht verbindbar",
    mehr: (n) => `Weitere KIs anzeigen (${n})`,
    weniger: "Weitere KIs ausblenden",
    suchen: "KI suchen",
    alleLabel: "Weitere KIs",
    treffer: (n) => (n === 1 ? "1 Treffer" : `${n} Treffer`),
    keine: (q) => `Keine KI zu „${q}“.`,
    schonOben: (q) => `„${q}“ steht schon oben bei den gefundenen KIs.`,
    art: { terminal: "Terminal", app: "App", editor: "Editor" },
    nichtWaehlbarHinweis: "Ausgegraute KIs kann Kortex noch nicht selbst eintragen.",
    nichtWaehlbarTitel: (name) => `${name}: Kortex kann sich hier noch nicht selbst eintragen.`,
  },
};
