// Texte des gemeinsamen Ablaufs „KI verbinden“ (ki-verbinden.js): Wählen · Konto · Stufe · Prüfen · Fertig. Deutsch, Du-Form, Alltagssprache.
// Regeln: jeder Fehlertext nennt den nächsten Schritt; nichts wird als erledigt gemeldet, bevor es geschehen ist. Die Namen der Stufen und der Anmeldung stehen weiter in
// texte-einrichtung.js (TE.ki.stufen), texte-konten.js (TK) und texte-ki-einstellungen.js (TKE.anmeldung): eine Quelle, nicht zwei.
import { PRODUKT } from "./texte.js";

export const TKV = {
  titel: "KI verbinden",
  dialogAria: "KI verbinden",
  schritt: (n, von) => `${n} von ${von}`,
  schrittAria: (n, von, name) => `Schritt ${n} von ${von}: ${name}`,
  schritte: { waehlen: "KI wählen", konto: "Konto", stufe: "Stufe", pruefen: "Prüfen", fertig: "Fertig" },
  laedt: "Suche nach KI-Programmen auf diesem Mac …",

  // ---- 1 · Wählen
  waehlen: {
    text: `${PRODUKT} verbindet sich mit dem Programm, das du schon nutzt. Es läuft mit deinem Abo; ${PRODUKT} sieht kein Passwort.`,
    textKarte: `${PRODUKT} verbindet deine KI-Programme mit dem Vault. Du bestimmst, wie viel jede darf, für jeden Vault einzeln.`,
    neuSuchen: "Neu suchen",
    sucht: "Sucht …",
    nichtsNeues: "Keine neuen Programme gefunden",
    weiter: "Weiter",
    ohneKi: "Ohne KI weiter",
    abbrechen: "Abbrechen",
    spaeter: "Später",
    keineKi: `${PRODUKT} funktioniert auch ohne. Installierst du später eines dieser Programme, findet ${PRODUKT} es von selbst und fragt dich.`,
    konfigTitel: "Eine andere KI?",
    konfigText: `Kopiere die Konfiguration und füge sie in den MCP-Einstellungen deines Programms ein (Feld „mcpServers“).`,
    konfigKurz: "Für Programme, die Kortex nicht selbst einträgt: Konfiguration kopieren, dann in den MCP-Einstellungen einfügen.",
    konfigKopieren: "Konfiguration kopieren",
    konfigKopiert: "Konfiguration kopiert",
    konfigFehler: "Die Konfiguration ließ sich nicht kopieren. Versuche es noch einmal.",
    ladeFehler: "Die Programme konnten nicht gesucht werden. Es wurde nichts verändert. Klicke auf „Neu suchen“, um es noch einmal zu versuchen.",
  },

  // ---- 2 · Konto
  konto: {
    titel: (p) => `${p}: Mit welchem Konto?`,
    text: "Ein Konto ist eine eigene Anmeldung mit eigenem Einstellungsordner. So kannst du ein privates und ein Firmen-Abo nebeneinander nutzen und sie getrennt freigeben.",
    keine: (p) => `Für ${p} gibt es noch kein Konto in ${PRODUKT}. Lege eines an, oder verbinde das Programm ohne Konto-Auswahl.`,
    hinzu: "Konto hinzufügen",
    hinzuTitel: (p) => `Weiteres ${p}-Konto`,
    name: "Name",
    namePlatzhalter: "Zum Beispiel „Firma“",
    ordnerText: `Bekommt einen eigenen Ordner im Ordner von ${PRODUKT}. Dein bisheriges Konto bleibt unberührt. Das neue Konto startet gesperrt; die Stufe wählst du im nächsten Schritt.`,
    anlegen: "Anlegen und anmelden …",
    abbrechen: "Abbrechen",
    leer: "Gib dem Konto einen Namen.",
    zuLang: "Der Name darf höchstens 40 Zeichen haben.",
    angelegt: (n) => `Konto „${n}“ angelegt.`,
    standardOrdner: (o) => o,
    zustand: { angemeldet: "Angemeldet", abgelaufen: "Anmeldung abgelaufen", "nicht-angemeldet": "Nicht angemeldet", unbekannt: "Anmeldung nicht geprüft", prueft: "Prüft …" },
    nichtAngemeldet: (n) => `${n} ist noch nicht angemeldet.`,
    abgelaufen: (n) => `Die Anmeldung von ${n} ist abgelaufen.`,
    nichtAngemeldetText: "Kortex öffnet das Terminal mit dem Anmelde-Befehl des Programms; melde dich dort mit deinem Konto an. Kortex wartet und prüft alle paar Sekunden.",
    anmelden: "Im Terminal anmelden …",
    neuAnmelden: "Neu anmelden …",
    spaeterAnmelden: "Du kannst auch weitermachen und dich später anmelden.",
    wartet: "Wartet auf die Anmeldung im Terminal …",
    angemeldetOk: (n) => `${n} ist angemeldet.`,
    weiter: "Weiter",
    zurueck: "Zurück",
  },

  // ---- 3 · Stufe
  stufe: {
    titel: (p, vault) => `${p}: Was darf es in ${vault}?`,
    darf: "Darf",
    andere: "Andere Vaults",
    andereText: "Gelten, wie sie sind. Ändern kannst du das in den Einstellungen unter „KI & Konten“.",
    andereKeine: "Es gibt keine weiteren Vaults.",
    gesperrtBleibt: "Dieses Konto ist für diesen Vault gesperrt und bleibt es, bis du selbst eine Stufe wählst.",
    gesperrtGewaehlt: "Mit einer Stufe darf das Konto diesen Vault über Kortex nutzen.",
    keinLeseverbot: (p) => `${p} kennt kein Leseverbot. ${PRODUKT} hält seine eigenen Wege dicht; das Programm selbst kann Dateien öffnen, wenn du es ihm dort erlaubst.`,
    nurClaude: "Die Pflege läuft nur mit Claude Code",
    verbinden: "Verbinden",
    zurueck: "Zurück",
    vaultFallback: "deinem Vault",
  },

  // ---- 4 · Prüfen
  pruefen: {
    titel: (p) => `${p} wird verbunden`,
    schritte: {
      programm: "Programm gefunden",
      anmeldung: "Anmeldung prüfen",
      eintragen: `${PRODUKT} eintragen`,
      probe: (p) => `Probe: ${p} sieht deinen Vault`,
    },
    version: (v) => `v${v}`,
    nichtGefunden: "nicht gefunden",
    angemeldet: "angemeldet",
    nichtAngemeldetKurz: "noch nicht angemeldet",
    unbekanntKurz: "nicht geprüft",
    schonEingetragen: "schon eingetragen",
    ok: (p) => `${p} sieht deinen Vault.`,
    okOhneKonto: (p) => `Der ${PRODUKT}-Server antwortet. Starte ${p} neu, dann ist dein Vault dabei.`,
    hinweisAnmeldung: (p) => `${p} ist noch nicht angemeldet. Die Verbindung steht trotzdem; melde dich später an, dann arbeitet das Konto mit.`,
    abbrechen: "Abbrechen",
    nochmal: "Nochmal prüfen",
    stufeAendern: "Stufe ändern",
    zurueck: "Zurück",
    anders: (p) => `In ${p} gibt es schon einen Eintrag „brain“, der woanders hinzeigt. Auf diesen Vault umstellen?`,
    umstellen: "Umstellen",
    nichtAendern: "Nicht ändern",
    befehl: "Das geht von hier aus noch nicht. Führe diesen Befehl im Terminal aus:",
    befehlKopieren: "Befehl kopieren",
    befehlKopiert: "Befehl kopiert",
    nichtGefundenText: (p) => `${p} wurde nicht gefunden. Installiere es, oder klicke auf „Neu suchen“.`,
    fehler: (p, m) => `${p}: ${m}`,
    keinZugriff: (p) => `${p} sieht deinen Vault nicht: Das Konto ist für diesen Vault gesperrt. Wähle unter „Stufe ändern“ mindestens „Lesen“.`,
    fehlerStandard: "Die Prüfung hat nicht geklappt. Versuche es noch einmal.",
  },

  // ---- 5 · Fertig
  fertig: {
    titel: (p) => `${p} ist verbunden`,
    darf: (vault, stufe) => `Darf in ${vault}: ${stufe}.`,
    andere: (n) => (n === 1 ? "Ein anderer Vault bleibt gesperrt." : `${n} andere Vaults bleiben gesperrt.`),
    gesperrtBleibt: (vault) => `Das Konto bleibt in ${vault} gesperrt.`,
    neustart: (p) => `Starte ${p} neu, falls es gerade offen ist.`,
    konto: (n) => `Konto: ${n}`,
    kontingentTitel: "Kontingent anzeigen",
    kontingentText: "Zeigt in der Statusleiste, wie viel vom 5-Stunden-Fenster dieses Kontos verbraucht ist. Dafür trägt Kortex mit deiner Zustimmung eine Statuszeile bei Claude Code ein.",
    kontingentKnopf: "Anzeigen …",
    leseverbotTitel: "Leseverbot für gesperrte Vaults",
    leseverbotText: (n) => (n === 1
      ? "Ein Vault ist für dieses Konto gesperrt. Zusätzlich kann Kortex Claude Code das Lesen dort selbst verbieten. Das schaltest du unter „KI & Konten“ ein."
      : `${n} Vaults sind für dieses Konto gesperrt. Zusätzlich kann Kortex Claude Code das Lesen dort selbst verbieten. Das schaltest du unter „KI & Konten“ ein.`),
    leseverbotKnopf: "Ansehen",
    weitere: "Weitere KI verbinden",
    rechte: "Rechte ansehen",
    fertig: "Fertig",
    weiter: "Weiter",
  },

  // ---- Hinweise für den Rahmen des Assistenten
  assistent: {
    verbundenListe: "Verbunden",
  },
};
