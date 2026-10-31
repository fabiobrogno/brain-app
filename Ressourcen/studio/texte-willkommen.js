// Alle sichtbaren Texte des Einstiegs ohne Vault (Deutsch, Du-Form, Alltagssprache).
// Produktname nur über PRODUKT aus texte.js.
import { PRODUKT } from "./texte.js";

export const TW = {
  zurueck: "Zurück",
  abbrechen: "Abbrechen",
  schliessen: "Schließen",

  willkommen: {
    titel: `Willkommen bei ${PRODUKT}`,
    untertitel: `Dein Vault ist ein Ordner mit Notizen auf deinem Computer. Wie möchtest du starten?`,
    wegeLabel: "So kannst du starten",
    andere: "Andere Wege",
    fuss: "Alles bleibt als normale Textdatei in deinem Ordner. Es gibt kein Konto und keine Cloud von uns.",
  },
  wege: {
    vorlage: { titel: `Mit der ${PRODUKT}-Vorlage loslegen`, text: `Ein neuer Vault mit Posteingang, Wiki und Beispielseiten.` },
    leer: { titel: "Leeren Vault anlegen", text: "Ein leerer Ordner mit Versionsverlauf. Du fängst neu an." },
    ordner: { titel: "Vorhandenen Ordner öffnen", text: "Wähle einen Ordner mit Notizen, den du schon hast." },
    klonen: { titel: "Von GitHub klonen", text: "Hole einen bestehenden Vault aus einem Git-Repository." },
  },

  name: {
    vorlage: { titel: `${PRODUKT}-Vorlage anlegen`, text: `Ein neuer Vault mit Posteingang, Wiki und Beispielseiten.`, arbeit: "Die Vorlage wird angelegt …" },
    leer: { titel: "Leeren Vault anlegen", text: "Ein leerer Ordner mit Versionsverlauf. Du fängst neu an.", arbeit: "Der Ordner wird angelegt …" },
    feld: "Name",
    vorgabe: PRODUKT,
    ortVor: "Wird angelegt in",
    andererOrdner: "Anderen Ordner wählen …",
    freigabe: "In deinem Benutzerordner braucht die App keine zusätzliche Freigabe.",
    anlegen: "Vault anlegen",
    keinName: "Gib deinem Vault einen Namen.",
    schraegstrich: "Der Name darf keinen Schrägstrich enthalten.",
    dialogTitel: "Ordner für deinen Vault wählen",
  },

  klonen: {
    titel: "Von GitHub klonen",
    text: "Hole einen bestehenden Vault aus einem Git-Repository.",
    urlFeld: "Adresse (URL)",
    urlPlatzhalter: "https://github.com/name/vault.git",
    zielFeld: "Zielordner",
    ortVor: "Wird geholt nach",
    andererOrdner: "Anderen Ordner wählen …",
    anmeldung: "Anmeldung läuft über deine normale Git-Anmeldung (SSH-Schlüssel oder macOS-Schlüsselbund). Die App speichert keine Passwörter.",
    knopf: "Klonen",
    arbeit: "Wird geklont … das kann einige Minuten dauern.",
    keineUrl: "Gib die Adresse des Repositories ein.",
    urlFormat: "Die Adresse sollte mit https://, ssh:// oder git@ beginnen.",
    dialogTitel: "Zielordner wählen",
  },

  ordner: {
    dialogTitel: "Ordner mit deinen Notizen wählen",
    arbeit: "Der Ordner wird geöffnet …",
    arbeitTitel: "Ordner wird geöffnet",
    anderer: "Anderen Ordner wählen …",
  },

  git: {
    titel: "Versionsverlauf einschalten?",
    text: "In diesem Ordner gibt es noch keinen Versionsverlauf. Einschalten?",
    hilfe: "Damit kannst du Änderungen nachvollziehen und frühere Fassungen zurückholen.",
    einschalten: "Einschalten",
    ohne: "Ohne Verlauf weiter",
    arbeit: "Der Versionsverlauf wird eingeschaltet …",
    fehlgeschlagen: "Der Versionsverlauf ließ sich nicht einschalten. Du kannst trotzdem ohne Verlauf weiterarbeiten.",
    // Zeitüberschreitung beim Einschalten: der Ordner ist durch den ersten Schritt schon geöffnet, nur der Verlauf fehlt
    zeit: "Das Einschalten des Versionsverlaufs hat zu lange gedauert. Dein Ordner ist geöffnet, der Verlauf aber nicht eingeschaltet. Versuche es noch einmal oder arbeite ohne Verlauf weiter.",
  },

  pfad: {
    titel: "Pfad zum Ordner",
    feld: "Ordnerpfad",
    platzhalter: "/Users/dein-name/Notizen",
    hilfe: "Gib den vollständigen Pfad ein, zum Beispiel /Users/dein-name/Notizen. In der App öffnet sich hier die normale Ordnerauswahl.",
    uebernehmen: "Übernehmen",
    leer: "Gib den Pfad des Ordners ein.",
    relativ: "Der Pfad muss mit / oder ~ beginnen.",
  },

  github: {
    titel: "Bei GitHub anmelden",
    text: "So kann dein Computer private Repositories holen und hochladen. Dein Zugang bleibt im Schlüsselbund dieses Macs.",
    anmelden: "Bei GitHub anmelden",
    codeLabel: "Dein Code",
    kopierenOeffnen: "Code kopieren und GitHub öffnen",
    anleitung: "Gib den Code auf der GitHub-Seite ein und bestätige dort die Anmeldung.",
    wartet: "Warte auf deine Bestätigung bei GitHub …",
    abbrechen: "Abbrechen",
    kopiert: "Code kopiert.",
    kopierFehler: "Der Code konnte nicht kopiert werden — tippe ihn bitte selbst ein.",
    erfolg: (name) => (name ? `Angemeldet als ${name}` : "Angemeldet"),
    abmelden: "Abmelden",
    abgelaufen: "Der Code ist abgelaufen. Starte die Anmeldung noch einmal.",
    abgelehnt: "GitHub hat die Anmeldung nicht bestätigt.",
    abgelehntBund: "Der Zugang konnte nicht im Schlüsselbund gespeichert werden.",
    nochmal: "Noch einmal versuchen",
    fehler: "Die Anmeldung bei GitHub hat nicht geklappt.",
  },
  // Der Schritt „KI“ ist der gemeinsame Ablauf aus ki-verbinden.js (Texte: texte-ki-verbinden.js); hier nur die Beschriftungen der Karte
  ki: {
    dialogTitel: "KI verbinden",
    spaeter: "Später",
    weiter: "Weiter",
  },

  fehler: {
    titel: "Das hat nicht geklappt",
    allgemein: "Das hat nicht geklappt.",
    nochNicht: "Das geht in dieser Version noch nicht.",
  },
};
