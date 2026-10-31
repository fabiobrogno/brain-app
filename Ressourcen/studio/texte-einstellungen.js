// Texte und Register der Seite „Einstellungen“ (Paket P5). Deutsch, Du-Form, für Nicht-Techniker: App „Kortex“, Datenordner „Vault“, „KI-Konto“, „Posteingang“.
// Das Register ist zugleich das, was die Suche durchsucht: jede Einstellung ist eine Zeile { id, titel, text, woerter } (Orca: { title, description, keywords }),
// gruppiert in Abschnitte und Bereiche. `schluessel` + `art` beschreiben einfache Zeilen (Schalter, Segment, Menü, Liste) für einstellungen.js; Zeilen mit eigener
// Steuerung (Thema, Vaults, GitHub …) haben `sonder: true` und werden dort einzeln gebaut. Muster: Orca src/renderer/src/components/settings/settings-search.ts
// @9bccd67 (MIT, Lovecast Inc.) — Gliederung in Bereich → Abschnitt → Eintrag mit Titel, Beschreibung und Stichwörtern.
export const GRUPPEN = ["Kortex", "Wissen", "Verbindungen", "Mehr"];

const STUFEN = {
  aus3: [["aus", "Aus"], ["probe", "Probe"], ["an", "An"]],
  hinweise: [["aus", "Aus"], ["niedrig", "Selten"], ["mittel", "Normal"], ["hoch", "Oft"]],
};

export const BEREICHE = [
  {
    id: "allgemein", name: "Allgemein", gruppe: "Kortex", symbol: "zahnrad", woerter: ["start", "version", "update", "sprache"],
    intro: "Wie Kortex sich im Alltag verhält.",
    abschnitte: [
      { id: "aktualisierungen", titel: "Aktualisierungen", zeilen: [
        { id: "update-hinweis", schluessel: "updateHinweis", art: "schalter", titel: "Auf neue Versionen hinweisen", text: "Gibt es eine neue Version von Kortex, sagt dir deine KI einmal Bescheid.", woerter: ["update", "aktualisierung", "version", "neu", "hinweis"] },
        { id: "version-info", sonder: true, titel: "Version", text: "Neue Versionen findest du im Menü „Kortex“ unter „Nach Updates suchen …“.", woerter: ["version", "update", "build", "prüfen"] },
      ] },
      { id: "sitzung", titel: "Übersicht und Sitzungen", zeilen: [
        { id: "live-aufleuchten", schluessel: "liveAufleuchten", art: "schalter", titel: "Live-Aufleuchten", text: "Liest die KI eine Seite, leuchtet sie in der Übersicht kurz auf.", woerter: ["übersicht", "live", "aufleuchten", "ki", "lesen"] },
        { id: "luecken", schluessel: "luecken", art: "schalter", titel: "Lücken merken", text: "Findet eine Suche nichts, merkt sich Kortex die Frage 30 Tage lang, gekürzt und ohne Zugangsdaten. So siehst du, was noch fehlt.", woerter: ["suche", "fragen", "fehlt", "lücke"] },
      ] },
    ],
  },
  {
    id: "darstellung", name: "Darstellung", gruppe: "Kortex", symbol: "sonne", woerter: ["aussehen", "hell", "dunkel", "schrift"],
    intro: "So sieht Kortex aus. Änderungen siehst du sofort.",
    abschnitte: [
      { id: "thema", titel: "Thema", zeilen: [
        { id: "thema", sonder: true, titel: "Thema", text: "Hell, dunkel oder wie dein Mac.", woerter: ["hell", "dunkel", "system", "macos", "modus", "aussehen", "dark", "light"] },
      ] },
      { id: "feinheiten", titel: "Feinheiten", zeilen: [
        { id: "schriftgroesse", schluessel: "schriftgroesse", art: "regler", titel: "Schriftgröße im Editor", text: "Gilt für Notizen, nicht für Menüs und Listen.", woerter: ["schrift", "größe", "text", "font", "lesbar", "zoom"] },
        { id: "bewegung", schluessel: "bewegung", art: "segment", optionen: [["system", "Wie macOS"], ["reduziert", "Reduziert"]], titel: "Bewegung", text: "„Reduziert“ ersetzt Übergänge durch sofortiges Ein- und Ausblenden. „Wie macOS“ folgt deiner Systemeinstellung.", woerter: ["animation", "bewegung", "reduzieren", "ruhig", "übergang"] },
        { id: "breit", sonder: true, titel: "Breite Textspalte", text: "Notizen nutzen die ganze Breite des Fensters statt einer schmalen Lesespalte.", woerter: ["breit", "lesespalte", "editor", "fenster", "schmal"] },
      ] },
    ],
  },
  {
    id: "tasten", name: "Tastenkürzel", gruppe: "Kortex", symbol: "tastatur", woerter: ["kürzel", "taste", "tastatur", "shortcut", "belegung", "konflikt"],
    intro: "Klick auf ein Kürzel und drück die neue Kombination. Esc bricht ab, ⌫ entfernt das Kürzel. Änderungen gelten sofort.",
    // Die Abschnitte und Zeilen (ein Befehl je Zeile, nach Gruppen) baut einstellungen-tasten.js aus dem Register der Tastenkürzel (gemeinsam/tastenkuerzel-register.json).
    abschnitte: [],
  },
  {
    id: "mitteilungen", name: "Mitteilungen", gruppe: "Kortex", symbol: "glocke", woerter: ["benachrichtigung", "hinweis", "ton", "banner"],
    intro: "Kortex meldet sich nur, wenn etwas deine Aufmerksamkeit braucht. Deine Wahl wird schon jetzt gemerkt; die Mitteilungen selbst starten mit einem der nächsten Updates.",
    abschnitte: [
      { id: "wann", titel: "Wann Kortex dich benachrichtigt", zeilen: [
        { id: "m-abgelegt", schluessel: "mitteilungenAbgelegt", art: "schalter", titel: "Eine KI hat etwas abgelegt", text: "Zum Beispiel: „Claude Code hat 2 Aufgaben angelegt“, mit „Ansehen“ und „Rückgängig“.", woerter: ["ablegen", "aufgabe", "notiz", "ki", "agent"] },
        { id: "m-abgewiesen", schluessel: "mitteilungenAbgewiesen", art: "schalter", titel: "Eine KI wurde abgewiesen", text: "Wenn ein Konto einen gesperrten Vault lesen wollte. Empfohlen.", woerter: ["gesperrt", "zugriff", "verweigert", "sicherheit", "abweisung"] },
        { id: "m-rueckfragen", schluessel: "mitteilungenRueckfragen", art: "schalter", titel: "Rückfragen warten", text: "Die Pflege braucht deine Entscheidung.", woerter: ["rückfrage", "pflege", "entscheidung"] },
        { id: "m-sicherung", schluessel: "mitteilungenSicherung", art: "schalter", titel: "Sicherung hat nicht geklappt", text: "Zum Beispiel ohne Netz oder bei abgelaufener GitHub-Anmeldung.", woerter: ["github", "fehler", "sicherung", "sync", "netz"] },
        { id: "m-kontingent", schluessel: "mitteilungenKontingent", art: "schalter", titel: "KI-Kontingent fast aufgebraucht", text: "Ab 80 % im 5-Stunden-Fenster eines Kontos.", woerter: ["kontingent", "limit", "nutzung", "usage", "abo"] },
        { id: "m-pflege", schluessel: "mitteilungenPflege", art: "schalter", titel: "Pflege ist fertig", text: "Normalerweise unnötig; das Ergebnis steht morgens unter Mitteilungen.", woerter: ["pflege", "fertig", "tageslauf"] },
      ] },
      { id: "macos", titel: "macOS-Mitteilungen", zeilen: [
        { id: "m-vorne", schluessel: "mitteilungenNurImHintergrund", art: "schalter", titel: "Nur wenn Kortex nicht vorne ist", text: "Ist Kortex offen, erscheint stattdessen ein kurzer Hinweis unten rechts.", woerter: ["vordergrund", "fokus", "toast", "banner"] },
        { id: "m-ton", schluessel: "mitteilungenTon", art: "schalter", titel: "Ton", text: "Ein leiser Ton bei einer Mitteilung.", woerter: ["sound", "ton", "klang"] },
      ] },
    ],
  },
  {
    id: "vaults", name: "Vaults", gruppe: "Wissen", symbol: "vault", woerter: ["ordner", "wissen", "notizen", "projekt"],
    intro: "Ein Vault ist ein normaler Ordner mit Markdown-Dateien. „Aus Kortex entfernen“ löscht nie Dateien.",
    abschnitte: [
      { id: "liste", titel: "Deine Vaults", zeilen: [
        { id: "vaults-liste", sonder: true, titel: "Deine Vaults", text: "Alle Vaults, die Kortex kennt. Im Finder zeigen, wechseln oder aus Kortex entfernen.", woerter: ["ordner", "finder", "wechseln", "entfernen", "hinzufügen", "öffnen", "vault"] },
      ] },
      { id: "dieser", titel: "Für den geöffneten Vault", text: "Gilt nur für den Vault, der gerade offen ist.", zeilen: [
        { id: "ernte-nicht-in", schluessel: "ernteNichtIn", art: "liste", mono: true, platzhalter: "Ordner/", plusText: "Ordner", titel: "Ordner, aus denen Kortex nie lernt", text: "Für Firmen- oder Kundenordner: Dort sichert Kortex keinen Zwischenstand und sammelt keine Fakten.", woerter: ["ordner", "privat", "ausschließen", "kunden", "firma", "ernte", "sperren"] },
        { id: "ernte-ohne-thema", schluessel: "ernteOhneThema", art: "liste", platzhalter: "Wort", plusText: "Wort", titel: "Themen, die nie ins Wissen wandern", text: "Kommt eines dieser Wörter in einem Fakt vor (ganzes Wort, Groß- und Kleinschreibung egal), übernimmt Kortex ihn nicht. Die Wörter stehen im Klartext in der Konfiguration des Vaults, und die liegt in Git und im Backup.", woerter: ["thema", "wörter", "ausschluss", "nie", "gesundheit", "gehalt", "privat", "wissen"] },
        { id: "vertrauen", sonder: true, titel: "Vertrauen", text: "Nur Vaults, die du selbst angelegt hast oder deren Herkunft du kennst. Ohne Vertrauen bleibt der Vault „nur ansehen“.", woerter: ["vertrauen", "nur ansehen", "git", "hooks", "sicherheit", "herkunft"] },
      ] },
    ],
  },
  {
    id: "ki", name: "KI & Konten", gruppe: "Wissen", symbol: "funke", woerter: ["konto", "claude", "codex", "anmelden", "abo"],
    intro: "Kortex arbeitet mit den KI-Programmen, die du schon hast, und mit deinem eigenen Abo. Hier siehst du, welche Konten angemeldet sind und was jedes Konto in welchem Vault darf.",
    abschnitte: [
      { id: "uebersicht", titel: "", zeilen: [
        { id: "ki-uebersicht", sonder: true, titel: "Übersicht der KI-Konten", text: "Wie viele Konten angemeldet sind, wie viele deine Anmeldung brauchen und wie viele Sperren gelten.", woerter: ["übersicht", "angemeldet", "anmeldung", "zahlen", "konten", "sperren"] },
      ] },
      { id: "konten", titel: "Programme und Konten", text: "Kortex sucht im Pfad deiner Login-Shell, in /opt/homebrew/bin, /usr/local/bin und /Applications. Ein Konto ist eine eigene Anmeldung mit eigenem Einstellungsordner.", zeilen: [
        { id: "ki-konten", sonder: true, titel: "Programme und Konten", text: "Gefundene KI-Programme mit Pfad und Version, ihre Konten, Anmelden, Umbenennen, Entfernen und ein weiteres Konto hinzufügen.", woerter: ["konto", "programm", "anmelden", "abmelden", "neu suchen", "hinzufügen", "entfernen", "umbenennen", "claude", "codex", "cursor", "gemini", "version", "pfad", "verbinden", "mcp", "eintragen", "schnittstelle", "ordner"] },
      ] },
      { id: "zugriff", titel: "Wer darf welchen Vault sehen?", text: "Jede Zelle ist die Stufe eines Kontos in einem Vault. Sperren fragt vorher nach.", zeilen: [
        { id: "ki-zugriff", sonder: true, titel: "Zugriff je Konto und Vault", text: "Gesperrt, Lesen, Posteingang oder Erweitert, je KI-Konto und Vault. Dazu die Stufe für neu gefundene Konten.", woerter: ["zugriff", "stufe", "gesperrt", "lesen", "posteingang", "erweitert", "matrix", "berechtigung", "neue konten", "sperren"] },
      ] },
      { id: "schutz", titel: "Wie fest ist die Sperre?", text: "Drei Stufen, ehrlich benannt. Nur Claude Code kennt Stufe 2 und 3; bei anderen Programmen sperrt Kortex seine eigenen Wege.", zeilen: [
        { id: "ki-schutz", sonder: true, titel: "Schutz-Ampel je Claude-Konto", text: "Kortex-Wege, Leseverbot in Claude Code und Strenger Schutz (Sandbox): was die Sperre wirklich hält.", woerter: ["schutz", "ampel", "leseverbot", "sandbox", "streng", "strenger schutz", "sperre", "shell", "claude"] },
      ] },
      { id: "frage", titel: "Frag deinen Vault", zeilen: [
        { id: "ki-frage-konto", sonder: true, titel: "Antwortet mit", text: "Wenn du in „Frag“ nichts anderes wählst. Nur Konten, die den offenen Vault lesen dürfen.", woerter: ["frage", "frag", "standard", "konto", "antwort"] },
        { id: "ki-frage-modell", sonder: true, titel: "Gründlichkeit", text: "Schnell nutzt das kleine Modell und antwortet rasch. Gründlich nimmt ein größeres Modell.", woerter: ["frage", "modell", "schnell", "gründlich", "haiku", "sonnet"] },
      ] },
      { id: "pflege", titel: "Pflege je Vault", text: "Einmal am Tag räumt Kortex im Hintergrund auf. Wählbar sind nur Konten mit Stufe „Erweitert“.", zeilen: [
        { id: "ki-pflege", sonder: true, titel: "Pflege-Konto und wie viel KI", text: "Welches Konto die tägliche Pflege eines Vaults übernimmt und wie viel KI dabei mitarbeitet. Jetzt pflegen.", woerter: ["pflege", "konto", "klein", "mittel", "ohne ki", "jetzt pflegen", "tageslauf", "haiku", "sonnet"] },
      ] },
      { id: "arbeit", titel: "Kortex bei der Arbeit", text: "Zusätzliche Eintragungen, jede nur auf deinen Klick und mit Rückweg. Die Texte sagen genau, was wo eingetragen wird.", zeilen: [
        { id: "ki-hooks", sonder: true, titel: "Claude Code: Kortex beim Arbeiten dabeihaben", text: "Trägt in die gewählten Claude-Profile kleine Helfer ein: passende Notizen beim Fragen, Schutz vor versehentlichen Änderungen am Wiki, Arbeitsstand, Statuszeile und Kortex-Befehle. Ausschalten nimmt genau das wieder heraus.", woerter: ["hooks", "claude", "profil", "statuszeile", "befehle", "settings", "eintragen"] },
        { id: "ki-git", sonder: true, titel: "Vor jedem Speichern nach Passwörtern und Schlüsseln suchen", text: "Beim Speichern einer Version prüft Kortex, ob Passwörter oder Schlüssel in den Notizen stehen, und hält das Speichern dann an. Gilt nur in diesem Vault.", woerter: ["passwort", "schlüssel", "prüfung", "speichern", "git", "commit", "hook", "secrets", "geheimnisse"] },
        { id: "ki-dienst", sonder: true, titel: "Kortex darf diesen Vault im Hintergrund aufräumen", text: "Richtet einen Dienst auf deinem Mac ein, der einmal am Tag genau diesen Vault pflegt. Ausschalten löscht ihn wieder.", woerter: ["hintergrund", "dienst", "launchagent", "tageslauf", "aufräumen", "automatik", "netzteil"] },
      ] },
      { id: "aktivitaet", titel: "Was deine KIs zuletzt getan haben", text: "Nur über Kortex. Bleibt auf diesem Mac.", zeilen: [
        { id: "ki-aktivitaet", sonder: true, titel: "Aktivität der KIs", text: "Die letzten Pflege-Läufe. Zugriffe und Abweisungen folgen mit den Mitteilungen.", woerter: ["aktivität", "protokoll", "abweisung", "zugriff", "verlauf", "pflege", "mitteilungen"] },
      ] },
      { id: "ehrlich", titel: "Was Kortex schützt – und was nicht", zeilen: [
        { id: "ki-ehrlich", sonder: true, titel: "Was Kortex schützt – und was nicht", text: "Kortex-Wege, Claude Code, andere Programme und echte Trennung ehrlich benannt.", woerter: ["schutz", "ehrlich", "grenzen", "trennung", "sicherheit", "macos-benutzer", "selbstauskunft"] },
      ] },
    ],
  },
  {
    id: "automatik", name: "Pflege & Automatik", gruppe: "Wissen", symbol: "sanduhr", woerter: ["pflege", "automatisch", "tageslauf", "lernen"],
    intro: "Was Kortex von selbst tut. Jeder Lauf ist abbrechbar und landet im Verlauf; Änderungen an deinen Notizen kommen nie ohne Rückfrage.",
    abschnitte: [
      { id: "lauf", titel: "Täglicher Lauf", zeilen: [
        { id: "tageslauf", schluessel: "tageslauf", art: "segment", optionen: STUFEN.aus3, titel: "Tageslauf", text: "Einmal am Tag übernimmt eine kleine KI belegte Fakten aus deinen Sitzungen ins Wissen, mit Beleg und rückgängig zu machen. „Probe“ rechnet alles durch und zeigt das Ergebnis, ändert aber nichts.", woerter: ["tageslauf", "automatik", "nacht", "lernen", "täglich", "probe"] },
        { id: "tageslauf-budget", schluessel: "tageslaufBudget", art: "segment", optionen: [["klein", "Klein"], ["normal", "Normal"], ["gross", "Groß"]], titel: "Umfang des Laufs", text: "Wie viel der Tageslauf je Lauf höchstens tun darf. Klein: 30 Aufrufe, 10 Minuten · Normal: 60, 15 · Groß: 120, 30. Was übrig bleibt, kommt beim nächsten Lauf dran.", woerter: ["budget", "umfang", "aufrufe", "minuten", "kosten", "tokens"] },
        { id: "pflege-intelligenz", schluessel: "pflegeIntelligenz", art: "segment", optionen: STUFEN.aus3, experiment: true, titel: "Pflege durch eine stärkere KI", text: "Arbeitet Inbox-Notizen ein, fasst lange Seiten zusammen und legt Seiten aus wartenden Fakten an. Jede Änderung wird geprüft und lässt sich einzeln zurücknehmen. „Probe“ rechnet nur.", woerter: ["sonnet", "pflege", "zusammenfassen", "inbox", "experiment", "stärker"] },
        { id: "wochenbericht", schluessel: "wochenbericht", art: "schalter", titel: "Wochenbericht", text: "Einmal pro Woche eine Zeile beim Sitzungsstart: was im Vault zu pflegen ist. Nur wenn es etwas gibt.", woerter: ["bericht", "woche", "montag", "sitzungsstart"] },
        { id: "gesundheit", schluessel: "gesundheit", art: "schalter", titel: "Gesundheit prüfen", text: "Suche, Index und Rückstand. Meldet sich nur bei Problemen, kostet keine Tokens.", woerter: ["gesundheit", "index", "suche", "rückstand", "wächter", "warnung"] },
        { id: "antwort-messlatte", schluessel: "antwortMesslatte", art: "segment", optionen: [["aus", "Aus"], ["monatlich", "Monatlich"]], titel: "Antwort-Messlatte", text: "Einmal im Monat beantwortet eine kleine KI deine Testfragen nur aus der jeweiligen Seite. Kortex prüft, ob die wichtigen Fakten in der Antwort stehen.", woerter: ["messlatte", "testfragen", "treffsicherheit", "qualität", "monat"] },
        { id: "pflege-lauf", schluessel: "pflegeLauf", art: "segment", optionen: [["aus", "Aus"], ["woechentlich", "Wöchentlich"]], titel: "Pflege-Lauf mit KI", text: "Eine kleine KI sieht sich auffällige Seiten an und schlägt vor, was zusammengehört, zu lang oder veraltet ist. Am Wissen ändert sie nichts.", woerter: ["pflege", "lauf", "veraltet", "zusammengehört", "woche"] },
      ] },
      { id: "sitzung", titel: "In jeder Sitzung", zeilen: [
        { id: "hinweise", schluessel: "hinweise", art: "segment", optionen: STUFEN.hinweise, titel: "Hinweise zu deinen Fragen", text: "Passt eine Seite deines Vaults zu deiner Frage, bekommt die KI einen kurzen Hinweis darauf. Wie oft, bestimmst du hier.", woerter: ["hinweise", "vorschläge", "passende notizen", "schwelle", "schreiben"] },
        { id: "ich-karte", schluessel: "ichKarte", art: "schalter", titel: "Ich-Karte mitgeben", text: "Zu Beginn jeder Sitzung liest deine KI deine kurze Ich-Karte: wer du bist und wie du arbeitest.", woerter: ["ich", "karte", "profil", "sitzung", "ich.md"] },
        { id: "projekt-automatik", schluessel: "projektAutomatik", art: "schalter", titel: "Projektseite finden", text: "Arbeitest du in einem Projektordner, nennt Kortex deiner KI die passende Projektseite.", woerter: ["projekt", "ordner", "seite", "automatik"] },
      ] },
      { id: "lernen", titel: "Aus Sitzungen lernen", text: "Kortex kann aus deinen KI-Sitzungen Wissen für den Vault vorschlagen. Vorschläge landen als Rückfrage, nie direkt in Notizen.", zeilen: [
        { id: "ernte-sitzungsende", schluessel: "ernteSitzungsende", art: "schalter", titel: "Am Ende einer Sitzung ernten", text: "Endet eine Sitzung, sucht eine kleine KI bis zu fünf Fakten heraus, die sich zu merken lohnen. In deinen Vault kommt nichts ohne dein Okay.", woerter: ["ernte", "sitzung", "fakten", "lernen", "sammeln"] },
        { id: "lektionen", schluessel: "lektionen", art: "segment", optionen: [["aus", "Aus"], ["lokal", "Lokal"], ["mit-ki", "Mit KI"]], titel: "Aus Fehlern lernen", text: "Korrigierst du deine KI zweimal zum selben Thema oder scheitert sie zweimal gleich, entsteht ein Vorschlag für eine Lektion. „Lokal“ kostet nichts, „Mit KI“ formuliert sie sauber.", woerter: ["lektion", "fehler", "korrektur", "lernen", "memory"] },
        { id: "staende", schluessel: "staendeIntervallStunden", art: "segment", optionen: [[0, "Aus"], [1, "Stündlich"], [2, "Alle 2 Std"], [4, "Alle 4 Std"]], titel: "Zwischenstand sichern", text: "Alle paar Stunden schreibt eine kleine KI im Hintergrund auf, woran du gerade arbeitest. Du bekommst es als Vorschlag zum Prüfen.", woerter: ["zwischenstand", "stunden", "arbeit", "vorschlag", "intervall"] },
        { id: "einschwingen", schluessel: "einschwingen", art: "zahl", stufen: [0, 10, 20, 50], einheit: "Übernahmen", einheitEin: "Übernahme", nullText: "Aus", titel: "Einschwingphase", text: "Die ersten automatischen Übernahmen kommen einzeln als Stichprobe zu dir („Stimmt das?“). Sind so viele bestätigt, wie hier steht, läuft es von selbst weiter.", woerter: ["einschwingen", "stichprobe", "bestätigen", "übernahmen", "tageslauf"] },
        { id: "autostufe-start", schluessel: "autostufeStart", art: "segment", optionen: [["aus", "Aus (Lernmodus)"], ["eng", "Eng"], ["normal", "Normal"]], titel: "Startstufe des Tageslaufs", text: "Womit der erste scharfe Lauf beginnt. „Aus“ ist der Lernmodus: Der Lauf schreibt anfangs nichts selbst, jeder Fakt kommt als Rückfrage zu dir. Wirkt nur, solange es noch keinen Lernstand gibt.", woerter: ["lernmodus", "autostufe", "start", "vorsichtig", "tageslauf"] },
        { id: "traum", schluessel: "traum", art: "segment", optionen: STUFEN.aus3, experiment: true, titel: "Gedächtnis aufräumen", text: "Nachts schlägt die KI ein bereinigtes Gedächtnis deiner Claude-Konten vor. Nie ohne dein Ja. „Probe“ zeigt die Unterschiede nur im Bericht.", woerter: ["traum", "gedächtnis", "memory", "aufräumen", "claude", "experiment"] },
        { id: "gedaechtnis-teilen", schluessel: "gedaechtnisTeilen", art: "segment", optionen: [["aus", "Aus"], ["an", "An"]], titel: "Gemeinsames Gedächtnis", text: "Deine Claude-Konten teilen sich das Gedächtnis je Projekt. Jedes Konto behält seinen eigenen Ordner, ein Abgleich führt Änderungen zusammen; nichts geht verloren.", woerter: ["gedächtnis", "teilen", "konten", "claude", "memory", "abgleich"] },
      ] },
    ],
  },
  {
    id: "sicherung", name: "Sicherung & GitHub", gruppe: "Wissen", symbol: "wolke-hoch", woerter: ["backup", "git", "github", "version"],
    intro: "Jede Änderung wird zur Version. Mit GitHub liegt zusätzlich eine Kopie sicher im Netz, privat und nur für dich sichtbar.",
    abschnitte: [
      { id: "konto", titel: "GitHub-Konto", zeilen: [
        { id: "github-konto", sonder: true, titel: "GitHub-Konto", text: "Angemeldet über einen Gerätecode. Kortex bekommt nur Zugriff auf Repositories, die es selbst anlegt.", woerter: ["github", "konto", "anmelden", "abmelden", "gerätecode", "repository"] },
      ] },
      { id: "wie-oft", titel: "Wie oft sichern", zeilen: [
        { id: "sicherung-taeglich", schluessel: "sicherungTaeglich", art: "schalter", titel: "Täglich zusätzlich sichern", text: "Einmal am Tag wird dein Vault gesichert, sofern eine Sicherung eingerichtet ist.", woerter: ["täglich", "sichern", "backup", "tag"] },
      ] },
      { id: "vault", titel: "Dieser Vault", zeilen: [
        { id: "sicherung-vault", sonder: true, titel: "Stand der Sicherung", text: "Ob der geöffnete Vault bei GitHub liegt und ob alles abgeglichen ist.", woerter: ["stand", "abgleich", "gesichert", "remote", "jetzt sichern", "ahead", "behind"] },
      ] },
      { id: "technik", titel: "Technik", zeilen: [
        { id: "git-technik", sonder: true, titel: "Versionsverlauf", text: "Kortex nutzt git, um jede Änderung als Version festzuhalten.", woerter: ["git", "version", "verlauf", "xcode", "werkzeug", "commit"] },
      ] },
    ],
  },
  {
    id: "mobil", name: "iPhone & iPad", gruppe: "Verbindungen", symbol: "handy", bald: true, woerter: ["handy", "mobil", "koppeln", "qr", "ios"],
    intro: "Geplant: Mit der Kortex-App auf iPhone und iPad erfasst du unterwegs und fragst deinen Vault. Der Mac bleibt die Quelle.",
    abschnitte: [
      { id: "bald", titel: "Gerät verbinden", zeilen: [
        { id: "mobil-bald", sonder: true, titel: "Kommt mit der iPhone-App", text: "Sobald die App da ist, koppelst du dein Gerät hier.", woerter: ["iphone", "ipad", "handy", "mobil", "koppeln", "qr", "bald"] },
      ] },
    ],
  },
  {
    id: "datenschutz", name: "Datenschutz", gruppe: "Verbindungen", symbol: "schild", woerter: ["privat", "daten", "sicherheit", "telemetrie"],
    intro: "Kortex läuft auf deinem Mac. Deine Notizen verlassen ihn nur auf zwei Wegen: zur Sicherung bei GitHub und zu dem KI-Anbieter, dessen Programm du fragst.",
    abschnitte: [
      { id: "sendet", titel: "Was Kortex sendet", zeilen: [
        { id: "ds-nutzungsdaten", sonder: true, badge: "aus", titel: "Nutzungsdaten", text: "Kortex sammelt keine Nutzungsdaten. Es gibt keinen Schalter, weil es nichts gibt, das man abschalten müsste.", woerter: ["telemetrie", "tracking", "analyse", "daten", "senden", "statistik"] },
        { id: "ds-absturz", sonder: true, badge: "aus", titel: "Absturzberichte", text: "Kortex verschickt keine Berichte. Bei Problemen hilft das Protokoll im Ordner von Kortex; du entscheidest, ob du es weitergibst.", woerter: ["crash", "absturz", "bericht", "fehler", "protokoll"] },
        { id: "ds-wege", sonder: true, titel: "Die zwei Wege nach draußen", text: "GitHub (nur wenn du die Sicherung einschaltest) und der Anbieter deines KI-Programms (nur, wenn du es fragst).", woerter: ["github", "anbieter", "anthropic", "openai", "netz", "senden", "cloud"] },
      ] },
      { id: "sieht", titel: "Was die KI sieht", zeilen: [
        { id: "ds-geheimnisse", sonder: true, badge: "immer an", titel: "Geheimnisse bleiben draußen", text: "Was nach Passwort, Schlüssel oder Zugangsdaten aussieht, übernimmt Kortex nie automatisch ins Wissen und warnt dich vor dem Sichern.", woerter: ["secrets", "passwort", "schlüssel", "token", "zugangsdaten", "filter", "geheimnis"] },
        { id: "ds-themen", sonder: true, titel: "Themen, die nie ins Wissen wandern", text: "Eigene Wörter und Ordner legst du bei den Vaults fest.", woerter: ["themen", "ausschluss", "wörter", "ordner"] },
        { id: "ds-zugriff", sonder: true, titel: "Wer was sehen darf", text: "Jedes KI-Konto hat je Vault eine Stufe: gesperrt, lesen, Posteingang oder erweitert.", woerter: ["zugriff", "stufe", "konto", "gesperrt", "lesen"] },
      ] },
    ],
  },
  {
    id: "erweitert", name: "Erweitert", gruppe: "Mehr", symbol: "code", woerter: ["experten", "technik", "mcp", "dateien"],
    intro: "Für Neugierige. Nichts hier ist für den Alltag nötig.",
    abschnitte: [
      { id: "mcp", titel: "Verbindung zu den KIs (MCP)", zeilen: [
        { id: "mcp-verbinden", sonder: true, titel: "In Programmen eintragen", text: "Hilft, wenn ein Programm Kortex nicht mehr findet. Vorher wird jede Datei gesichert.", woerter: ["mcp", "verbinden", "eintragen", "schnittstelle", "reparieren", "neu verbinden", "claude", "codex"] },
        { id: "mcp-vertraut", schluessel: "mcpVertraut", art: "liste", mono: true, platzhalter: "mcp__name__*", plusText: "Werkzeug", titel: "Diesen MCP-Werkzeugen vertrauen", text: "Fakten aus MCP-Werkzeugen gelten sonst als Web-Inhalt und werden nie ohne Rückfrage übernommen. Hier stehen die Werkzeuge, die deine eigenen Daten liefern (Name oder Anfang mit *).", woerter: ["mcp", "werkzeuge", "vertrauen", "web", "quelle"] },
      ] },
      { id: "gesundheit", titel: "Gesundheits-Wächter", text: "Ab dieser Zahl wartender Dinge meldet Kortex einen Rückstau. „Aus“ meldet nie.", zeilen: [
        { id: "gesundheit-messlatte", schluessel: "gesundheitMesslatte", art: "segment", optionen: [["taeglich", "Täglich"], ["woechentlich", "Wöchentlich"], ["aus", "Aus"]], titel: "Such-Messlatte", text: "Wie oft der Tageslauf die lokale Such-Messlatte laufen lässt (Testfragen, keine Tokens, dauert ein paar Minuten).", woerter: ["messlatte", "suche", "takt", "test"] },
        { id: "gesundheit-vorschlaege", schluessel: "gesundheitVorschlaege", art: "zahl", stufen: [0, 100, 200, 500], einheit: "Vorschläge", einheitEin: "Vorschlag", nullText: "Aus", titel: "Warnung: wartende Vorschläge", text: "Ab so vielen neuen Vorschlägen.", woerter: ["schwelle", "warnung", "vorschläge", "rückstau"] },
        { id: "gesundheit-lektionen", schluessel: "gesundheitLektionen", art: "zahl", stufen: [0, 15, 30, 60], einheit: "Lektionen", einheitEin: "Lektion", nullText: "Aus", titel: "Warnung: wartende Lektionen", text: "Ab so vielen Lektionen, die auf Übernahme warten.", woerter: ["schwelle", "warnung", "lektionen", "rückstau"] },
        { id: "gesundheit-inbox", schluessel: "gesundheitInbox", art: "zahl", stufen: [0, 5, 15, 30], einheit: "Dateien", einheitEin: "Datei", nullText: "Aus", titel: "Warnung: Dateien im Posteingang", text: "Ab so vielen Dateien im Posteingang.", woerter: ["schwelle", "warnung", "posteingang", "inbox", "rückstau"] },
        { id: "gesundheit-konflikte", schluessel: "gesundheitKonflikte", art: "zahl", stufen: [0, 1, 3, 5], einheit: "Konflikte", einheitEin: "Konflikt", nullText: "Aus", titel: "Warnung: offene Konflikte", text: "Ab so vielen Seiten mit einem noch nicht entschiedenen Konflikt.", woerter: ["schwelle", "warnung", "konflikte", "rückstau"] },
      ] },
      { id: "gedaechtnis", titel: "Gemeinsames Gedächtnis", text: "Wo es liegt und welche Claude-Konten es teilen. Nur nötig, wenn du mehrere Konten mit eigenen Ordnern nutzt.", zeilen: [
        { id: "gedaechtnis-wurzel", schluessel: "gedaechtnisWurzel", art: "pfad", titel: "Ordner des gemeinsamen Gedächtnisses", text: "Dort liegt je Projekt ein abgeglichenes Gedächtnis. „~“ steht für deinen Benutzerordner; leer lassen heißt Standard.", woerter: ["gedächtnis", "ordner", "pfad", "wurzel", "memory", "claude"] },
        { id: "gedaechtnis-konten", schluessel: "gedaechtnisKonten", art: "liste", mono: true, platzhalter: "~/.claude", plusText: "Konto-Ordner", titel: "Konto-Ordner, die das Gedächtnis teilen", text: "Der Ordner jedes Claude-Kontos, das mitmachen soll. Standard: nur ~/.claude.", woerter: ["gedächtnis", "konten", "ordner", "claude", "profil", "teilen"] },
      ] },
      { id: "dateien", titel: "Dateien", zeilen: [
        { id: "datei-vault", sonder: true, titel: "Einstellungen des Vaults", text: "Stehen in brain.config.json im Vault und gelten auch für „brain einstellungen“ im Terminal. Änderungen von dort erscheinen hier sofort.", woerter: ["datei", "json", "config", "terminal", "cli", "finder", "export"] },
        { id: "datei-app", sonder: true, titel: "Einstellungen der App", text: "Darstellung und Mitteilungen stehen in der Datei einstellungen.json im Ordner von Kortex und gelten für alle Vaults.", woerter: ["datei", "json", "app", "mac", "ordner"] },
        { id: "zuruecksetzen", sonder: true, titel: "Alle Einstellungen auf Standard", text: "Setzt Einstellungen des Vaults und der App auf den Anfang. Vaults, Notizen und KI-Konten bleiben.", woerter: ["zurücksetzen", "reset", "standard", "anfang", "löschen"] },
      ] },
    ],
  },
  {
    id: "ueber", name: "Über Kortex", gruppe: "Mehr", symbol: "info", woerter: ["version", "lizenz", "herkunft"],
    intro: "",
    abschnitte: [
      { id: "app", titel: "", zeilen: [
        { id: "ueber-app", sonder: true, titel: "Kortex", text: "Dein Wissen als Ordner. Deine KI mit deinem Abo.", woerter: ["version", "build", "macos", "über", "app"] },
      ] },
      { id: "lizenzen", titel: "Lizenzen und Herkunft", text: "Kortex steht auf den Schultern anderer. Danke.", zeilen: [
        { id: "lizenz-geist", sonder: true, badge: "SIL OFL 1.1", titel: "Geist, Geist Mono", text: "Schrift · Vercel", woerter: ["lizenz", "schrift", "font", "vercel", "geist"] },
        { id: "lizenz-icons", sonder: true, badge: "CC0", titel: "Simple Icons", text: "Logos der KI-Programme (nur zur Kennzeichnung)", woerter: ["lizenz", "logos", "marken", "icons"] },
        { id: "lizenz-orca", sonder: true, badge: "MIT", titel: "Orca", text: "Gestaltungswerte und Muster (Lovecast Inc.)", woerter: ["lizenz", "orca", "gestaltung", "muster", "lovecast"] },
        { id: "lizenz-codemirror", sonder: true, badge: "MIT", titel: "CodeMirror", text: "Editor", woerter: ["lizenz", "editor", "codemirror"] },
        { id: "lizenz-node", sonder: true, badge: "MIT", titel: "Node.js", text: "Läuft im Hintergrund von Kortex", woerter: ["lizenz", "node", "javascript"] },
        { id: "lizenz-sparkle", sonder: true, badge: "MIT", titel: "Sparkle", text: "Aktualisierungen der App", woerter: ["lizenz", "sparkle", "update"] },
      ] },
    ],
  },
];

// Wörter, die bei einer Suche ohne Treffer angeboten werden, wenn sich aus der Eingabe nichts Näheres ableiten lässt (jedes kommt im Register vor)
export const STANDARD_VORSCHLAEGE = ["Konto", "Kürzel", "GitHub", "dunkel"];

export const TE = {
  seite: "Einstellungen",
  zurueck: "Zurück zu Kortex",
  zurueckTitel: "Zurück zu Kortex (Esc)",
  suchen: "Einstellung suchen",
  suchenLabel: "Einstellungen durchsuchen",
  suchLeeren: "Suche leeren",
  seitenleiste: "Einstellungen",
  suche: "Suche",
  treffer: (n, q) => `${n} ${n === 1 ? "Treffer" : "Treffer"} für „${q}“`,
  trefferJeBereich: (n) => `${n} ${n === 1 ? "Treffer" : "Treffer"}`,
  keine: (q) => `Keine Einstellung zu „${q}“`,
  keineText: "Versuch ein anderes Wort. Notizen findest du mit",
  keineText2: "im Hauptfenster.",
  vielleicht: "Vielleicht meinst du",
  fuss: "Änderungen gelten sofort.",
  gespeichert: "Gespeichert",
  speichertGerade: "Speichert …",
  statusDatei: "Einstellungen werden sofort gespeichert",
  bald: "bald",
  braucht: "Ein Konto braucht deine Anmeldung",
  laedt: "Kortex liest die Einstellungen …",
  fehlerLaden: "Die Einstellungen konnten nicht gelesen werden. Es wurde nichts verändert.",
  nochmal: "Nochmal versuchen",
  konflikt: "Die Einstellungen wurden gerade woanders geändert. Kortex hat sie neu geladen; deine letzte Änderung wurde nicht übernommen.",
  nichtVertraut: "Dieser Vault ist nur zum Ansehen geöffnet. Vertraue ihm zuerst, dann kannst du seine Einstellungen ändern.",
  keinVault: "Es ist noch kein Vault geöffnet. Öffne zuerst einen Vault.",
  fehlerSpeichern: "Das hat nicht geklappt. Es wurde nichts Halbes gespeichert.",
  keinVaultHinweis: "Es ist kein Vault geöffnet. Die Einstellungen eines Vaults erscheinen, sobald du einen geöffnet hast.",
  nurAnsehen: "Dieser Vault ist nur zum Ansehen geöffnet. Seine Einstellungen kannst du erst ändern, wenn du ihm vertraust.",
  dateiDefekt: (t) => t,
  // Zeilen
  wertFuer: (t) => t,
  oeffnen: "Öffnen …",
  neuLaden: "Neu laden",
  entfernen: "Entfernen",
  hinzufuegen: "Hinzufügen",
  eintragEntfernen: (w) => `${w} entfernen`,
  eintragNeu: (w) => `${w} hinzufügen`,
  eintragLang: "Der Eintrag ist zu lang.",
  eintragLeer: "Der Eintrag darf nicht leer sein.",
  eintragDoppelt: "Der Eintrag steht schon in der Liste.",
  eintragZuviele: "Die Liste ist voll.",
  eintragZeichen: "Dieser Eintrag enthält Zeichen, die hier nicht erlaubt sind.",
  experiment: "Experiment",
  schriftKlein: "Kleiner",
  schriftGross: "Größer",
  // Darstellung
  thema: { system: "Wie macOS", hell: "Hell", dunkel: "Dunkel" },
  // Version und Lizenzen
  versionDev: "Entwicklungsstand",
  macosHinweis: "macOS 26 oder neuer",
  alleHinweise: "Alle Hinweise",
  // Vaults
  vaultOffen: "offen",
  vaultFehlt: "Ordner nicht gefunden",
  vaultNurMac: "Nur auf diesem Mac",
  vaultGit: "Mit Versionsverlauf",
  vaultKeinGit: "Ohne Versionsverlauf",
  imFinder: "Im Finder",
  vaultWechseln: "Öffnen",
  vaultHinzu: "Vault hinzufügen",
  vaultMehr: "Mehr",
  vaultAusKortex: "Aus Kortex entfernen …",
  vaultFuer: (n) => `Für den Vault „${n}“`,
  vertrauenAn: "Vertraut",
  vertrauenAus: "Nur ansehen",
  vertrauenEntziehen: "Vertrauen entziehen …",
  vertrauenGeben: "Diesem Vault vertrauen …",
  keinVaultOffen: "Kein Vault geöffnet",
  // KI
  kiOeffnen: "Öffnen …",
  kiVerbinden: "Verbinden …",
  // Sicherung
  githubAngemeldet: "verbunden",
  githubNicht: "nicht verbunden",
  githubNichtVerfuegbar: "In dieser Version nicht eingerichtet",
  githubAnmelden: "Anmelden …",
  githubAbmelden: "Abmelden",
  githubAbmeldenTitel: "Von GitHub abmelden?",
  githubAbmeldenText: "Kortex vergisst das Konto auf diesem Mac. Bereits gesicherte Versionen bleiben bei GitHub. Du kannst dich jederzeit wieder anmelden.",
  githubAbgemeldet: "Von GitHub abgemeldet.",
  githubAmGitHub: "Auf GitHub ansehen",
  sichGesichert: "Gesichert",
  sichAktuell: "aktuell",
  sichZuSenden: (n) => `${n} zu senden`,
  sichZuHolen: (n) => `${n} zu holen`,
  sichBereit: "Bereit, bei GitHub zu sichern",
  sichNurMac: "Nur auf diesem Mac",
  sichBlockiert: "Sicherung noch nicht möglich",
  sichEinrichten: "Bei GitHub sichern …",
  sichJetzt: "Jetzt abgleichen",
  gitAn: "aktiv",
  gitAus: "aus",
  gitOhne: "Dieser Vault hat noch keinen Versionsverlauf. Ohne ihn gibt es keine Sicherung und keine früheren Fassungen.",
  gitGesperrt: "Gesperrt, bis du diesem Vault vertraust.",
  gitMit: (zweig) => `Jede Änderung wird zur Version · Zweig ${zweig}`,
  // Datenschutz
  zuDenVaults: "Bei den Vaults festlegen",
  zuKonten: "Bei KI & Konten ansehen",
  // Erweitert
  imFinderZeigen: "Im Finder zeigen",
  reset: {
    knopf: "Zurücksetzen …",
    titel: "Alle Einstellungen zurücksetzen?",
    text: "Alle Einstellungen des Vaults und der App gehen auf den Anfang zurück. Vaults, Notizen und KI-Konten bleiben, wie sie sind.",
    textNurApp: "Alle Einstellungen der App gehen auf den Anfang zurück. Die Einstellungen des Vaults bleiben, weil er nur zum Ansehen geöffnet ist.",
    ja: "Zurücksetzen",
    abbrechen: "Abbrechen",
    erledigt: "Einstellungen zurückgesetzt.",
  },
  // iPhone
  mobilBald: "Kommt mit der iPhone-App",
  // Bereiche mit Platzhalter
  verweis: "Bis dahin wie gewohnt öffnen:",
};
