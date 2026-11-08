// Texte für Bilder und Anhänge (Paket 3a, Runde 3): Einfügen, Anzeige, Lightbox, externe Bilder, Rückfrage beim Löschen. Deutsch, Du-Form; App „Kortex“, Datenordner „Vault“.
export const TAN = {
  // Einfügen und Ziehen
  hochladen: (name) => `„${name}“ wird abgelegt …`,
  nurLesen: "Diese Notiz ist schreibgeschützt. Anhänge lassen sich hier nicht einfügen.",
  leer: (name) => `„${name}“ ist leer und wurde nicht eingefügt.`,
  zuGross: (name, groesse, grenze) => `„${name}“ ist ${groesse} groß. Erlaubt sind ${grenze} (Einstellungen → Schreiben → Anhänge).`,
  falscherTyp: (name) => `„${name}“ hat einen Typ, den Kortex nicht ablegt. Erlaubt sind Bilder, PDF, Office-Dateien, Text, Archive, Audio und Video.`,
  fehler: (name) => `„${name}“ ließ sich nicht ablegen.`,
  gross: (name, groesse) => `„${name}“ (${groesse}) liegt jetzt im Vault. Große Dateien machen Sicherung und Abgleich langsamer.`,
  mehrere: (n) => `${n} Dateien abgelegt.`,
  // Die Zwischenablage nannte eine Datei, gab aber keine her (je nach Hülle unterschiedlich)
  pasteLeer: {
    app: "Die Mac-App hat die Datei aus der Zwischenablage nicht bekommen. Ziehe sie stattdessen aus dem Finder in die Notiz.",
    electron: "Kortex hat die Datei aus der Zwischenablage nicht bekommen. Ziehe sie stattdessen aus dem Dateimanager in die Notiz.",
    browser: "Der Browser hat die Datei aus der Zwischenablage nicht herausgegeben. Ziehe sie stattdessen aus dem Dateimanager in die Notiz.",
  },
  // Anzeige
  bildFehlt: (name) => `Bild nicht gefunden: ${name}`,
  bildOeffnen: (name) => `Bild „${name}“ groß ansehen`,
  nichtGefunden: "nicht gefunden",
  dateiFehlt: (name) => `Datei nicht gefunden: ${name}`,
  dateiOeffnen: (name) => `„${name}“ mit dem Programm des Systems öffnen`,
  dateiOeffnenBrowser: (name) => `„${name}“ in einem neuen Tab öffnen`,
  dateiNichtOeffnen: (name) => `„${name}“ ließ sich nicht öffnen.`,
  // Externe Bilder
  externPlatzhalter: (host) => `Externes Bild von ${host}`,
  externLaden: "Klicken zum Laden",
  externText: "Kortex lädt Bilder aus dem Internet nur mit deiner Zustimmung. Beim Laden erfährt der Server, dass du diese Notiz öffnest.",
  externNurHttps: "Nur https-Bilder werden geladen.",
  externFehler: (host) => `Das Bild von ${host} ließ sich nicht laden.`,
  externKi: "Externes Bild, in Antworten der KI nie geladen",
  // Lightbox
  lightbox: { titel: "Bildansicht", schliessen: "Schließen", hinweis: "Esc oder Klick schließt" },
  // Beim Löschen einer Notiz
  loeschen: {
    titel: "Bilder und Anhänge mit löschen?",
    satz: (n) => (n === 1 ? "Ein Anhang wird nur in dieser Notiz benutzt." : `${n} Anhänge werden nur in dieser Notiz benutzt.`),
    hinweis: "Sie kommen in den Papierkorb und lassen sich dort zurückholen. Kortex löscht nie endgültig von allein.",
    mit: "Mit in den Papierkorb",
    behalten: "Behalten",
    abbrechen: "Abbrechen",
    mehr: (n) => `und ${n} weitere`,
    fertig: (n) => (n === 1 ? "Ein Anhang liegt jetzt im Papierkorb." : `${n} Anhänge liegen jetzt im Papierkorb.`),
    teilweise: (ok, n) => `${ok} von ${n} Anhängen kamen in den Papierkorb, der Rest ließ sich nicht bewegen.`,
    fehler: "Die Anhänge ließen sich nicht in den Papierkorb legen.",
  },
};
