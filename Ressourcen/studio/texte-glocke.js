// Texte der Glocke in der Kopfzeile und der Mitteilungsliste (Paket P8b, Deutsch, Alltagssprache). Die Sätze zu den Ereignissen kommen von der Werkstatt
// (`wer` + `text`, siehe texte-mitteilungen.js); hier stehen nur Beschriftungen, Gruppen, Filter und die Hinweise, die das Studio selbst bildet.
export const TG = {
  titel: "Mitteilungen",
  knopf: (n) => (n > 0 ? `Mitteilungen, ${n} ungelesen` : "Mitteilungen"),
  knopfTitel: (taste) => (taste ? `Mitteilungen (${taste})` : "Mitteilungen"),
  zahl: (n) => (n > 9 ? "9+" : String(n)),
  alleGelesen: "Alle als gelesen",
  einstellungen: "Einstellungen für Mitteilungen",
  protokoll: "Aktivitätsprotokoll",
  filterName: "Auswahl der Mitteilungen",
  filter: { alle: "Alle", abweisungen: "Abweisungen", ablagen: "KI-Ablagen", sicherung: "Sicherung" },
  gruppen: { heute: "Heute", gestern: "Gestern", frueher: "Früher" },
  listeName: "Mitteilungen der KIs",
  leer: { titel: "Noch nichts gemeldet", text: "Kortex meldet hier, was deine KIs in deinem Vault tun." },
  leerFilter: {
    abweisungen: { titel: "Keine Abweisungen", text: "Wenn eine KI etwas lesen wollte, das gesperrt ist, steht es hier." },
    ablagen: { titel: "Keine Ablagen", text: "Hier steht, was eine KI in deinem Vault angelegt oder geändert hat." },
    sicherung: { titel: "Keine Meldungen zur Sicherung", text: "Wenn eine Sicherung nicht klappt oder wartet, steht es hier." },
  },
  gestern: (zeit) => `Gestern ${zeit}`,
  ungelesen: "ungelesen",
  ohneText: "Meldung ohne Text",
  zurueckgenommen: "zurückgenommen",
  marke: { abgewiesen: "abgewiesen", gelesen: "gelesen" },
  // Knöpfe je Art
  ansehen: "Ansehen",
  rechteAnsehen: "Rechte ansehen",
  neuAnmelden: "Neu anmelden …",
  mitSatz: (knopf, satz) => `${knopf.replace(/ …$/, "")}: ${satz}`, // Name des Knopfes für Screenreader: Beschriftung, dann worum es geht
  // „gelesen-ohne-leseverbot“: die KI hat im gesperrten Vault gelesen, nichts hat es verhindert
  leseverbot: { hinweis: "Kortex konnte das nicht verhindern: In Claude Code ist das Leseverbot aus.", knopf: "Leseverbot einschalten" },
  fehlerGelesen: "Das Markieren hat nicht geklappt. Es wurde nichts verändert.",
};
