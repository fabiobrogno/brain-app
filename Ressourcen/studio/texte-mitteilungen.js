// Texte der Mitteilungen und des Aktivitätsprotokolls (Studio, Deutsch, Alltagssprache): Hinweise unten rechts („Claude Code hat 2 Aufgaben angelegt“),
// Rückgängig-Meldungen und Zeilen des Protokolls. Der Satz zu einem Ereignis kommt von der Werkstatt (`wer` + `text`); hier stehen nur die Sätze, die das Studio selbst bildet.
export const TM = {
  eineKi: "Eine KI",
  vault: (name) => `Vault ${name}`,
  // Wohin ein Eintrag gehört (Unterzeile des Hinweises)
  ort: { "ablage-aufgabe": "Aufgaben", "ablage-notiz": "Posteingang" },
  // Mehrere gleichartige Ereignisse in einem Hinweis (n ≥ 2)
  mehrere: {
    "ablage-aufgabe": (n) => `hat ${n} Aufgaben angelegt`,
    "ablage-notiz": (n) => `hat ${n} Notizen im Posteingang abgelegt`,
    aenderung: (n) => `hat ${n} Änderungen vorgenommen`,
    abweisung: (n) => `wurde ${n}-mal abgewiesen`,
  },
  weitere: (n) => (n === 1 ? "und 1 weitere Meldung" : `und ${n} weitere Meldungen`),
  ansehen: "Ansehen",
  rueckgaengig: "Rückgängig",
  rueckgaengigLang: (wer) => `Rückgängig: ${wer}`,
  zurueck: "Zurückgenommen",
  zurueckMehrere: (n) => `${n} Ablagen zurückgenommen`,
  teilweise: (ok, alle) => `${ok} von ${alle} zurückgenommen.`,
  // Fehler beim Rückgängigmachen: die Werkstatt hat nichts gelöscht, wenn eine Datei sich inzwischen geändert hat
  geaendert: "Die Notiz wurde seit der Ablage geändert. Kortex entfernt sie nicht — öffne sie und entscheide selbst.",
  schonZurueck: "Das ist schon zurückgenommen.",
  schonWeg: "Die Datei war schon weg. Es gab nichts mehr zu tun.",
  nichtMoeglich: "Das lässt sich nicht rückgängig machen.",
  unbekannt: "Zu diesem Eintrag gibt es nichts mehr, das sich zurücknehmen ließe.",
  nichtVertraut: "Dieser Vault ist noch nicht als deiner bestätigt. Kortex ändert darin nichts, bevor du es erlaubt hast.",
  keinVault: "Es ist gerade kein Vault geöffnet. Öffne den Vault, dann geht es hier weiter.",
  keineVerbindung: "Kortex antwortet gerade nicht. Es wurde nichts verändert.",
  allgemein: "Das Zurücknehmen hat nicht geklappt. Es wurde nichts verändert.",
};
