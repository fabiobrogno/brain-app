// Texte für „Schreiben im Alltag“: neue Notiz, Tagesnotiz, Vorlagen, Zurück und Vor. Deutsch, Du-Form; App „Kortex“, Datenordner „Vault“.
export const TS = {
  neu: { name: "Neue Notiz", unbenannt: "Neue Notiz", gibtEsSchon: "Diese Notiz gibt es inzwischen schon. Kopiere deinen Text, bevor du weitermachst." },
  tag: {
    heute: "Heute", befehl: "Heute (Tagesnotiz)", titel: "Tagesnotiz", vorher: "Vorheriger Tag", nachher: "Nächster Tag", kalender: "Kalender", zuHeute: "Zu heute springen",
    angelegt: (titel) => `Tagesnotiz „${titel}“ angelegt.`, fehler: "Die Tagesnotiz ließ sich nicht öffnen.", vorlageFehlt: (name) => `Die Vorlage „${name}“ für die Tagesnotiz gibt es nicht. Kortex nimmt eine leere Seite.`,
    kalenderKopf: "Tagesnotizen", mitNotiz: "Hat eine Notiz", ohneNotiz: "Noch keine Notiz",
  },
  vorlage: {
    befehl: "Neue Notiz aus Vorlage …", titel: "Neue Notiz aus Vorlage", suche: "Vorlage suchen …", titelFeld: "Titel (optional)", titelPlatzhalter: "Wie soll die Notiz heißen?", anlegen: "Notiz anlegen", abbrechen: "Abbrechen",
    gruppe: "Vorlagen", nichtsPasst: "Keine Vorlage passt.", vorschau: "Vorschau", waehle: "Wähle links eine Vorlage.", laedt: "Lädt …", ladeFehler: "Die Vorlage ließ sich nicht lesen.",
    keine: "Noch keine Vorlagen", keineText: (ordner) => `Lege im Ordner „${ordner}“ Notizen an. Jede Notiz darin ist eine Vorlage, mit Platzhaltern wie {{titel}}, {{datum}}, {{zeit}} und {{cursor}}.`,
    ordnerOeffnen: "Ordner zeigen", beispiele: "Beispiele anlegen", beispieleFertig: "Drei Beispiel-Vorlagen angelegt.", leerHinweis: "Platzhalter",
    hinweisPlatzhalter: "{{titel}} · {{datum}} · {{datum:TT.MM.JJJJ}} · {{zeit}} · {{cursor}}", hinweisWaehlen: "wählen", hinweisAnlegen: "anlegen", hinweisTitel: "Titel",
  },
  verlauf: {
    zurueck: "Zurück", vor: "Vor", zurueckListe: "Zuletzt geöffnet", vorListe: "Danach geöffnet", leer: "Nichts mehr in dieser Richtung.", gibtEsNicht: "Diese Notiz gibt es nicht mehr.",
  },
  palette: { heute: "Heute (Tagesnotiz)", vorlage: "Neue Notiz aus Vorlage …", zurueck: "Zurück", vor: "Vor" },
  einstellungen: {
    bereich: "Schreiben", intro: "Wie neue Notizen entstehen: Tagesnotiz und Vorlagen.",
    tagesnotiz: "Tagesnotiz", vorlagen: "Vorlagen",
    tagOrdner: "Ordner der Tagesnotizen", tagOrdnerText: "Im Vault; entsteht beim ersten Mal von selbst. Kürzel: ⇧⌘D öffnet die Notiz für heute.",
    tagFormat: "Name der Tagesnotiz", tagFormatText: "Zum Beispiel JJJJ-MM-TT (2026-11-05) oder TT.MM.JJJJ. Weitere Zeichen: MMMM (November), WWWW (Donnerstag), KW (Kalenderwoche).",
    tagVorlage: "Vorlage für die Tagesnotiz", tagVorlageText: "Name einer Notiz im Vorlagenordner. Leer: die Vorlage „Tagesnotiz“, wenn es sie gibt, sonst eine leere Seite.",
    vorlagenOrdner: "Ordner der Vorlagen", vorlagenOrdnerText: "Jede Notiz in diesem Ordner ist eine Vorlage für ⌥⌘N.",
  },
};
