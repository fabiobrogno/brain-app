// Texte zum Kontingent (Paket P7): Balken 5 Std / Woche, Statusleiste, Konto-Menü, Einstellungen, Frag-Feld. Deutsch, Du-Form, für Nicht-Techniker.
// Regeln (Orca docs/STYLEGUIDE.md „UX rules“, usage-error-copy.ts @9bccd67, MIT, Lovecast Inc.): Jeder Fehlertext nennt den nächsten Schritt. Kein Text behauptet etwas, bevor es geschehen ist.
// Ein Wert, der sich nicht ermitteln lässt, heißt „nicht abrufbar“ und wird nie verschwiegen oder erfunden.
const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const pad = (n) => String(n).padStart(2, "0");
const uhrzeit = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const gleicherTag = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const TKO = {
  fenster: { session: "5 Std", weekly: "Woche" },
  fensterLang: { session: "5-Stunden-Fenster", weekly: "Wochenfenster" },
  prozent: (p) => `${Math.round(p)} %`,
  voll: "voll",
  zurueckgesetzt: "zurückgesetzt",
  // „noch 2 h 14 min“ (5 Std) · „bis Do 19:00“ (Woche) — in der Ortszeit des Macs
  restDauer: (ms) => { const min = Math.max(1, Math.ceil(ms / 60000)); return min < 60 ? `noch ${min} min` : `noch ${Math.floor(min / 60)} h ${pad(min % 60)} min`; },
  bisZeit: (zeit, jetzt) => { const d = new Date(zeit); return gleicherTag(d, new Date(jetzt)) ? `bis ${uhrzeit(d)}` : `bis ${WOCHENTAGE[d.getDay()]} ${uhrzeit(d)}`; },
  wiederAb: (zeit, jetzt) => { const d = new Date(zeit); return gleicherTag(d, new Date(jetzt)) ? `wieder ab ${uhrzeit(d)}` : `wieder ab ${WOCHENTAGE[d.getDay()]} ${uhrzeit(d)}`; },
  stand: (min) => (min < 1 ? "Stand gerade eben" : min < 60 ? `Stand vor ${min} Min` : min < 1440 ? `Stand vor ${Math.floor(min / 60)} Std` : `Stand vor ${Math.floor(min / 1440)} Tg`),
  vor: (min) => (min < 1 ? "gerade eben" : min < 60 ? `vor ${min} Min` : min < 1440 ? `vor ${Math.floor(min / 60)} Std` : `vor ${Math.floor(min / 1440)} Tg`),

  // ---- Zustände: kurz (Statusleiste, Zeile), text (Erklärung mit dem nächsten Schritt), knopf (was der Nutzer tun kann)
  status: {
    "nicht-eingerichtet": { kurz: "Kontingent nicht eingerichtet", text: "Claude Code meldet sein Kontingent an eine Statuszeile. Kortex trägt sie erst nach deinem Klick ein, und deine eigene Statuszeile bleibt dabei erhalten.", knopf: "Kontingent anzeigen …" },
    "keine-werte": { kurz: "Noch keine Werte", text: "Die Werte erscheinen, sobald du Claude Code mit diesem Konto benutzt hast (ab Version 2.1.80, angemeldet mit deinem Abo). Öffne dazu Claude Code und stelle eine Frage." },
    "ohne-kontingent": { kurz: "Kontingent nicht abrufbar", text: "Claude Code meldet für dieses Konto kein Kontingent. Das ist bei einer Anmeldung mit API-Schlüssel oder vor Version 2.1.80 so. Aktualisiere Claude Code oder melde das Konto mit deinem Abo an." },
    geaendert: { kurz: "Statuszeile geändert", text: "Die Statuszeile in den Einstellungen von Claude Code wurde geändert und gehört nicht mehr zu Kortex. Schalte „Kontingent anzeigen“ noch einmal ein, damit Kortex sie wieder weiterreicht.", knopf: "Kontingent anzeigen …" },
    "einstellungen-defekt": { kurz: "Einstellungen von Claude Code kaputt", text: "Die Einstellungen von Claude Code (settings.json) sind kaputt oder nicht lesbar. Kortex ändert nichts daran. Repariere die Datei, dann geht es hier weiter." },
    laedt: { kurz: "Kortex fragt …", text: "Kortex fragt Codex nach dem Kontingent. Das dauert einen Moment." },
    "nicht-abrufbar": { kurz: "Kontingent nicht abrufbar", text: "Dieses Programm gibt sein Kontingent nicht heraus. Schau beim Anbieter nach, wie viel noch übrig ist." },
  },
  nichtAbrufbarVon: (name) => `Kontingent gibt ${name} nicht heraus. Schau direkt in ${name} nach, wie viel noch übrig ist.`,
  fehler: {
    fehlt: "Kontingent nicht abrufbar: Codex wurde nicht gefunden. Installiere Codex und klicke dann in den Einstellungen auf „Neu suchen“.",
    anmeldung: "Kontingent nicht abrufbar: Die Anmeldung ist abgelaufen. Melde das Konto in den Einstellungen unter „KI & Konten“ neu an.",
    zeit: "Kontingent nicht abrufbar: Codex hat nicht rechtzeitig geantwortet. Kortex versucht es gleich noch einmal; „Neu laden“ probiert es früher.",
    sonst: "Kontingent nicht abrufbar: Codex liefert es gerade nicht. Aktualisiere Codex auf die neueste Version und klicke dann auf „Neu laden“.",
  },
  fehlerKurz: { fehlt: "Codex nicht gefunden", anmeldung: "Anmeldung abgelaufen", zeit: "Keine Antwort", sonst: "Nicht abrufbar" },
  veraltet: (wann, codex) => (codex ? `Stand ${wann}. Kortex fragt Codex bald wieder; „Neu laden“ geht schon früher.` : `Stand ${wann}. Claude Code meldet neue Werte, sobald du es benutzt.`),
  keineAnmeldung: "Kontingent erst nach der Anmeldung sichtbar",

  // ---- Knöpfe, Tooltips
  neuLaden: "Neu laden",
  neuLadenTitel: "Kortex fragt das Programm noch einmal. Das geht frühestens 5 Minuten nach der letzten Abfrage.",
  neuLadenSpaeter: (zeit) => `Frühestens um ${zeit} Uhr wieder möglich. Kortex fragt höchstens alle 5 Minuten nach.`,
  neuLadenFehler: "Kortex konnte nicht nachfragen. Versuche es in einer Minute noch einmal.",
  ausschalten: "Kontingent nicht mehr anzeigen",
  fussnote: "Kontingent laut Anbieter. Kortex fragt höchstens alle 5 Minuten nach.",
  zusammen: (n) => (n === 1 ? "1 Konto mit Kontingent" : `${n} Konten mit Kontingent`),

  // ---- Einwilligung (Dialog in den Einstellungen)
  einwilligung: {
    titel: (name) => `Kontingent für „${name}“ anzeigen`,
    satz: "Claude Code gibt sein Kontingent nur an eine Statuszeile heraus. Dafür trägt Kortex ein kleines Skript in die Einstellungen dieses Kontos ein.",
    punkte: {
      keinToken: "Kortex liest dafür keine Anmeldedaten und fragt Anthropic nicht selbst.",
      nurZahlen: "Gemerkt werden nur Prozent und Rücksetzzeit der beiden Fenster, kein Text aus deinen Gesprächen.",
      kette: "Hast du schon eine Statuszeile, ruft Kortex sie weiter auf. Ihre Anzeige bleibt genau gleich.",
      rueckweg: "Mit „Kontingent nicht mehr anzeigen“ stellt Kortex deine Einstellungen wieder her, Byte für Byte, solange du sie nicht inzwischen geändert hast.",
    },
    ja: "Eintragen",
    abbrechen: "Abbrechen",
    fertig: (name) => `Kontingent für „${name}“ wird angezeigt, sobald Claude Code die ersten Werte meldet.`,
    fertigKette: "Deine bisherige Statuszeile läuft unverändert weiter.",
  },
  // System-Standard (~/.claude) und andere Ordner außerhalb von Kortex: zusätzliche Bestätigung in der Seite
  bestaetigung: {
    titel: (name) => `Einstellungen von „${name}“ ändern?`,
    satz: (ordner) => `Dieses Konto liegt nicht in Kortex, sondern in ${ordner}. Kortex ändert dort nur die Statuszeile in der Datei settings.json.`,
    punkte: {
      sicherung: "Vorher legt Kortex eine Kopie der Datei an (Ordner „kontingent/sicherung“ im Ordner von Kortex, nur für dich lesbar).",
      eintrag: "Der Eintrag ist eindeutig markiert („kortex-statuszeile“). Alles andere in der Datei bleibt, wie es ist.",
      rueckweg: "Beim Ausschalten bekommst du die Datei genau so zurück, wie sie vorher war.",
    },
    ja: "Ja, in diesem Konto eintragen",
  },
  fehlerSchalten: "Kortex konnte die Einstellungen von Claude Code nicht ändern. Es wurde nichts verändert. Versuche es noch einmal oder prüfe, ob die Datei settings.json beschreibbar ist.",
  entfernt: (name, exakt) => (exakt ? `Kontingent für „${name}“ ist aus. Deine Einstellungen sind wieder genau wie vorher.` : `Kontingent für „${name}“ ist aus. Weil du die Einstellungen inzwischen geändert hast, hat Kortex nur seinen eigenen Eintrag entfernt.`),
  entfernenTitel: (name) => `Kontingent für „${name}“ nicht mehr anzeigen?`,
  entfernenText: "Kortex stellt die Einstellungen von Claude Code wieder her. Eine frühere Statuszeile von dir läuft danach allein weiter.",
  entfernenJa: "Nicht mehr anzeigen",

  // ---- Statusleiste und Menü
  leiste: {
    keinKonto: "KI verbinden …",
    keinKontoTitel: "Noch kein KI-Konto für diesen Vault: Öffne die Einstellungen, um eines zu verbinden.",
    knopfTitel: (name) => `${name}: Kontingent und Konto wechseln`,
    gesperrt: "Gesperrt",
    gesperrtGrund: "In diesem Vault gesperrt. Gib das Konto unter „Konten und Rechte …“ frei, dann steht es hier zur Wahl.",
    nurFrag: "Frag nutzt nur Claude Code",
    gewaehlt: (name) => `${name} beantwortet jetzt deine Fragen.`,
    menueKopf: (vault) => `KI im Vault „${vault}“`,
    kiVerbinden: "KI verbinden …",
    kontenRechte: "Konten und Rechte …",
    keineKonten: "Noch kein KI-Konto gefunden. Klicke auf „KI verbinden …“.",
    ladeFehler: "Das Kontingent konnte nicht geladen werden. Öffne die Einstellungen und versuche es dort noch einmal.",
  },
  // ---- Frag-Feld
  frag: {
    voll: (name, wieder) => `${name} ist voll, ${wieder}. Wähle ein anderes Konto oder warte bis dahin.`,
    vollOhneAnderes: (name, wieder) => `${name} ist voll, ${wieder}. Frag geht dann wieder; vorher kann Claude Code mit diesem Konto nicht antworten.`,
    optionVoll: (wieder) => `voll · ${wieder}`,
    optionProzent: (p, fenster) => `${Math.round(p)} % · ${fenster}`,
  },
};
