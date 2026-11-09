// Texte für KI-Vorschläge (Deutsch): Einwilligung je Vault, „Was wird gesendet?“, Kontingent-Zeile, Lauf. Die App heißt Kortex, der Datenordner Vault.
// Eine Quelle für alle Funktionen (K1 Zusammenfassen, K2 Text-Aktionen, K3 Posteingang): `gesendet` nennt je Funktion ehrlich, was an die KI geht.
export const TV = {
  einwilligung: {
    titel: (vault) => `KI-Vorschläge für „${vault}“ einschalten?`,
    satz: (konto) => `Wenn du einen KI-Knopf drückst, schickt Kortex genau die Daten dieser einen Anfrage über dein Claude-Code-Konto „${konto}“ an Anthropic. Die KI ändert nichts selbst: Du siehst jeden Vorschlag und entscheidest.`,
    gesendetTitel: "Das geht an die KI",
    nieTitel: "Nie gesendet",
    nie: "Der ganze Vault, Anhänge, andere Vaults und Notizen mit „ki: nein“ im Kopf.",
    gespeichertTitel: "Nichts gespeichert",
    gespeichert: "Kortex speichert keine Anfrage und keine Antwort. Was Anthropic damit tut, regeln die Bedingungen deines Kontos.",
    kontingent: "Jede Anfrage zählt zum Kontingent deines Abos.",
    kontingentApi: "Jede Anfrage kostet etwas auf deinem API-Konto (grob 0,01 $, eine Schätzung).",
    konto: (stufe) => `Claude Code · darf diesen Vault ${stufe}`,
    stufeLesen: "lesen",
    abbrechen: "Abbrechen",
    einschalten: "Für diesen Vault einschalten",
    fehler: "Das Einschalten hat nicht geklappt. Es wurde nichts geändert.",
    anderesFenster: "Der geöffnete Vault ist ein anderer geworden. Es wurde nichts geändert.",
  },
  // Was je Funktion gesendet wird (Titel + ein Satz); die Dialoge zeigen die Funktionen, die es gibt
  gesendet: {
    zusammenfassung: { titel: "„Was ist neu“ zusammenfassen", text: "Titel, Art und Zeit der Zeilen aus der Karte und ein paar Zahlen. Keine Inhalte von Notizen.", symbol: "inbox" },
    posteingang: { titel: "Vorschläge im Posteingang", text: "Den Eintrag selbst sowie Titel und Anfänge von bis zu 12 passenden Notizen, deine Ordner und Tags.", symbol: "inbox" },
    text: { titel: "Aktionen im Editor", text: "Nur den markierten Text und die Überschrift darüber.", symbol: "stift" },
  },
  gesendetBlock: {
    knopf: "Was wird gesendet?",
    vorab: "Genau diese Daten schickt Kortex bei diesem Knopf. Du siehst sie hier, bevor du ihn drückst.",
    jetzt: "So ging es an die KI (nur diese Anfrage, nichts anderes):",
    kopieren: "Kopieren",
    kopiert: "Kopiert",
    kopierFehler: "Kopieren hat nicht geklappt.",
    gekuerzt: (n) => `… gekürzt, ${n.toLocaleString("de-DE")} Zeichen insgesamt; „Kopieren“ übernimmt alles.`,
    ausgenommen: (n) => (n === 1 ? "1 Notiz mit „ki: nein“ ist ausgenommen und kommt nicht vor." : `${n} Notizen mit „ki: nein“ sind ausgenommen und kommen nicht vor.`),
  },
  kontingent: {
    zaehlt: "Zählt zum Kontingent deines Abos.",
    zaehltApi: "Kostet etwas auf deinem API-Konto (grob 0,01 $, eine Schätzung).",
    fastVoll: "Dein Kontingent ist bald aufgebraucht. Diese Anfrage zählt dazu.",
    voll: (wann) => `Kontingent erschöpft${wann ? `, ${wann}` : ""}. Dann geht es wieder.`,
    ohneWert: "Der Stand erscheint, sobald Claude Code das nächste Mal läuft.",
  },
  lauf: {
    startet: "Verbinde mit der KI …",
    arbeitet: (s) => `Die KI arbeitet … ${s} s`,
    abbrechen: "Abbrechen",
    abgebrochen: "Abgebrochen. Nichts wurde geändert.",
    nochEinmal: "Noch einmal",
    verbindung: "Keine Verbindung zu Kortex. Nichts wurde geändert.",
    fehlerAllgemein: "Das hat nicht geklappt. Nichts wurde geändert.",
  },
};
