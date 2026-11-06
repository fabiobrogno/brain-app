// Texte für „Nichts geht verloren“: Änderung von außen bei offener Notiz (Zusammenführen), Entwurfs-Journal (Wiederherstellen), Werkstatt-Ausfall.
// Deutsch, Du-Form, Alltagssprache. Nie: merge, diff, commit, hash, conflict (Test: sichtbare-begriffe.test.mjs prüft nur das Wort „Brain“).
const mz = (n, eins, viele) => (n === 1 ? eins : viele);

export const TN = {
  // ---- Änderung von außen
  quelleUnbekannt: "einem anderen Programm",
  eingearbeitet: (quelle) => `Änderung von ${quelle} eingearbeitet`,
  rueckgaengig: "Rückgängig",
  rueckgaengigNeuererText: "Du hast seit dem Einarbeiten weitergetippt: dieser neuere Text liegt jetzt unter „Gesicherte Fassungen“, die Fassung von davor ist wieder da.",
  rueckgaengigErledigt: (quelle) => `Deine Fassung ist wieder da. Die Änderung von ${quelle} liegt unter „Gesicherte Fassungen“.`,
  uebernommen: (quelle) => `Neue Fassung von ${quelle} geladen`,
  zusammengefuehrt: "Beide Fassungen sind zusammengeführt",
  konflikt: {
    titel: (quelle) => `Du und ${quelle} habt dieselbe Stelle geändert`,
    text: (n, auto) => `${n} ${mz(n, "Stelle", "Stellen")} musst du entscheiden.${auto ? ` ${auto} ${mz(auto, "andere Änderung ist", "andere Änderungen sind")} schon zusammengeführt.` : ""} Nichts geht verloren: beide Fassungen bleiben unter „Gesicherte Fassungen“.`,
    meine: "Meine", andere: "Andere", beide: "Beide", zusammen: "Zusammenführen",
    meineTitel: "Meine Fassung", andereTitel: (quelle) => `Fassung von ${quelle}`,
    stelle: (i, n) => `Stelle ${i} von ${n}`,
    gewaehlt: { meine: "Meine Fassung bleibt", andere: "Die andere Fassung bleibt", beide: "Beide stehen untereinander", text: "Von dir zusammengeführt" },
    eigenTitel: "Selbst zusammenführen", eigenUebernehmen: "Übernehmen", eigenAbbrechen: "Zurück",
    leer: "(nichts)",
    speichern: "Zusammenführung speichern", offen: (n) => `Noch ${n} ${mz(n, "Stelle", "Stellen")} offen`,
    spaeter: "Später entscheiden",
    hinweisGesperrt: "Der Editor ist gesperrt, bis du entschieden hast. Deine Eingaben bleiben erhalten.",
    erneut: "Die Datei wurde inzwischen noch einmal geändert. Kortex zeigt dir den neuen Stand.",
    gespeichert: (quelle) => `Zusammengeführt mit der Fassung von ${quelle}`,
    unterschiedLinks: "Zeilen davor", unterschiedRechts: "Zeilen danach",
  },
  // ---- Gesicherte Fassungen (Ablage)
  ablage: {
    titel: "Gesicherte Fassungen",
    leer: "Noch nichts zur Seite gelegt.",
    grund: { "fremd-eingearbeitet": "Fassung von außen, vor dem Zusammenführen", "fremd-zusammengefuehrt": "Fassung von außen, vor deiner Auswahl", "fremd-ueberschrieben": "Fassung von außen, vor dem Überschreiben",
      "meine-verworfen": "Deine Fassung, nicht übernommen", "meine-vor-zusammenfuehren": "Deine Fassung, vor dem Zusammenführen", "entwurf-verworfen": "Verworfener Entwurf" },
    wiederherstellen: "In den Editor holen", geholt: "Die Fassung steht im Editor. Speichere, wenn du sie behalten willst.",
    von: (quelle) => `von ${quelle}`,
  },
  // ---- Entwurfs-Journal
  entwurf: {
    titel: (zeit) => `Ungespeicherter Text von ${zeit} gefunden`,
    text: "Kortex hat ihn für dich aufgehoben, bevor das Fenster oder der Hintergrunddienst abgestürzt ist.",
    wiederherstellen: "Ungespeicherten Text wiederherstellen",
    vergleichen: "Vergleichen", verbergen: "Vergleich schließen", verwerfen: "Verwerfen",
    wiederhergestellt: "Der Text ist wieder da. Er wird gleich gespeichert.",
    verworfen: "Entwurf verworfen. Er liegt noch unter „Gesicherte Fassungen“.",
    vergleichKopf: { datei: "Auf der Platte", entwurf: "Ungespeicherter Text" },
    gleich: "Kein Unterschied zur gespeicherten Fassung.",
    inAnderer: (zeit, titel) => `Ungespeicherter Text von ${zeit} in „${titel}“ gefunden`,
    ansehen: "Ansehen",
    nachAbsturz: "Das Fenster ist abgestürzt und wurde neu geladen.",
    abgelegt: (zeit) => `Der ungespeicherte Text von ${zeit} liegt jetzt unter „Gesicherte Fassungen“, damit dein neuer Text ihn nicht überschreibt.`,
    waise: (n) => (n === 1 ? "Ein ungespeicherter Text einer verschobenen oder gelöschten Notiz liegt jetzt unter „Gesicherte Fassungen“." : `${n} ungespeicherte Texte verschobener oder gelöschter Notizen liegen jetzt unter „Gesicherte Fassungen“.`),
    deinTextAbgelegt: "Dein bisheriger Text liegt unter „Gesicherte Fassungen“.",
  },
  // ---- Hintergrunddienst weg
  dienst: {
    stand: "Speichern gerade nicht möglich",
    meldung: "Speichern gerade nicht möglich – Kortex startet den Hintergrunddienst neu. Dein Text bleibt erhalten.",
    wieder: "Der Hintergrunddienst läuft wieder. Dein Text ist gespeichert.",
    aufgegeben: "Der Hintergrunddienst startet nicht. Dein Text liegt im Entwurfs-Journal; starte Kortex neu, falls das bleibt.",
  },
  // ---- Automatische Fassungen
  auto: {
    angehalten: "Die automatische Fassung wartet: Die Prüfung vor dem Sichern hat etwas gefunden (zum Beispiel einen Schlüssel oder ein Passwort in einer Notiz). Behebe es, dann geht es von selbst weiter.",
    hookFehler: "Die Prüfung vor dem Sichern hat angehalten (ein Fehler, kein Fund). Die automatische Fassung wartet, bis sich an den Dateien etwas ändert.",
    fehler: "Die automatische Fassung konnte nicht angelegt werden.",
  },
};
