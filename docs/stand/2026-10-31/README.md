# Stand Kortex, 31.10.2026

Nachtrag zum [Stand vom 30.10. abends](../2026-10-30/abend.md). Richtung: Oberfläche auf Orca-Niveau nach freigegebenem HTML-Prototyp (Orca MIT, Herkunft in THIRD-PARTY-NOTICES).

## Neu auf main (#66–#82)

| Bereich | PRs | Kurz |
|---|---|---|
| Fundament | #66 | Design-System v2: neutrale Flächen, Geist/Geist Mono offline, Auswahl-Rezept, Bausteine, Tokens-Spec |
| Sicherung mehrerer Geräte | #67 | holen → zusammenführen → senden; Konflikt ohne Push, klare Fehlerarten, regelmäßiges Holen, konfigurierter Posteingang |
| Große Vaults | #68 | Such-Cache (20 000 Dateien: 1,9 s → 0,13 s), Teil-Index im Studio |
| Umstellung Phase B | #69 | Freigabe-Tor (9 Bedingungen), `.tools` ins Archiv, byte-genauer Rückweg; 2 Opus-Runden (u. a. Abbruch/Weitermachen, Gerätemerker getrennt) |
| KI-Katalog | #70 | 47 Einträge, 42 echte Logos lokal (Herkunft je Datei), Baustein `kiAuswahl` |
| Einstellungen | #71 | eigene Seite, Suche gewichtet + markiert, sofort speichern, `GET/PUT /api/einstellungen` mit `stand`, ⌘, |
| Einrichtungs-Assistent | #72 | im Studio statt SwiftUI; KI-Sperre bleibt, kein Auto-Vertrauen, Verdrahtung zurück; 2 Opus-Runden |
| Konflikt-Ansicht | #73 | beide Fassungen, diese/andere/beide/zusammenführen, Rückgängig/Verwerfen, nur eigene Zusammenführungen, Sicherheitsnetz; 3 Opus-Runden |
| KI & Konten | #74 | Programme, Konten je Ordner, Anmelden im Terminal, Matrix, Schutz-Ampel; Security-Review |
| Hauptfenster | #75 | Kopfzeile mit Suche, Seitenleiste wie Prototyp, Frag als Spalte, Aufgaben-Kästchen |
| Tastenkürzel | #76 | Register als einzige Quelle, Editor mit Aufnahme/Konflikt, globale Kürzel neu anmeldbar |
| Kontingent | #77 | Statuszeilen-Kette (mit Einwilligung, Sicherung, byte-genauer Rückweg), Codex-Abfrage, Anzeige; Security-Review |
| Aktivität | #78 | Protokoll je Vault, Abweisungen, Rückgängig nur für echte KI-Ablagen mit Papierkorb-Kopie, macOS-Mitteilungen; 2 Opus-Runden |
| Folgepaket | #79 | „Später“ 325 s → ~1 s bei 2000 Dateien, Wettlauf/`.git`-Datei, `GET /api/ki/konten` rein lesend, Statuszeile in der Kette |
| Glocke | #80 | Mitteilungsfeld in der Kopfzeile, Filter, Aktionen, ⇧⌘B |
| Bewegung | #81 | Bewegungs-Tokens, Bewegung mit Bedeutung, Windung als Ladeanzeige, Skelett, Ruhenetz (Inhalt auch bei angehaltenen Animationen), Statusleiste ohne Doppel |
| Wackeltests | #82 | 8 Tests ursächlich stabil (2 echte App-Fehler), unbekanntes `~/.claude` gilt bis zum Eintragen als gesperrt |

## Offen

1. Echter Durchlauf am Mac: zwei Claude-Konten anmelden, Kontingent-Statuszeile eintragen, macOS-Mitteilungen (Erlaubnisdialog, Klick), Aufnahme von ⌘-Kürzeln im WKWebView.
2. Ende-zu-Ende mit echten Gegenstellen: GitHub-Gerätecode + Push, Migration des Hintergrunddienstes mit echtem `launchctl`.
3. Umstellung des echten Quell-Vaults: Probelauf an Kopie, dann nur mit Freigabe.
4. Beta: Bundle-ID/Repo-Ort, Sparkle-Schlüssel-Sicherung bestätigen, OpenAI-Logo-Freigabe klären.
5. iOS-App mit Spracheingabe (Plan liegt vor; Entscheidungen GitHub-App, ganzer Vault, On-Device-KI).
6. Entscheidung: Übergangsregel „Liste fehlt ganz → Posteingang“ für KI-Konten strenger machen?
7. Beobachten: `kontingent-codex` „Abbrechen“ (mögliches Rennen), Abgleich-Tests unter Last.
