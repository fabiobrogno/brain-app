# Runde 3

Plan der Runde 3 (Schreiben im Editor). Jedes Paket hat seinen Abschnitt; die technischen Einzelheiten stehen in `docs/ENTWICKLUNG.md`.

## 3b – Tabellen, Formatierung, Einfügen

**Ziel:** Tabellen wie in Notion bearbeiten, Text mit Kürzeln und einer kleinen Leiste formatieren, Fremdes (Web, Word, Notion) sauber als Markdown einfügen. Die Datei bleibt immer gewöhnliches Markdown.

| Teil | Ergebnis |
|---|---|
| Tabellen | Anzeige als Tabelle (Live-Vorschau), Zellen direkt bearbeiten, Tab/⇧Tab/Enter, Ausrichtung der Spalten beim Schreiben, Kontextmenü (Zeile/Spalte einfügen/löschen, Ausrichtung), Befehl „Tabelle einfügen“ (Palette, ⌥⇧⌘T); Rohtext-Modus bleibt |
| Formatierung | ⌘B, ⌘I, ⇧⌘C (Code), ⇧⌘X, Link ⌘L, Überschriften ⌥⇧⌘1–4, Listen ⇧⌘8/7/9, alle im Kürzel-Register (änderbar, Konfliktprüfung) |
| Einfügen | HTML → Markdown (Überschriften, Listen, Tabellen, Links, fett/kursiv, Code), ⇧⌘V als reiner Text, Adresse über Auswahl = Link, Bild-Hook für die Anhänge aus 3a |
| Format-Leiste | kleine Leiste über markiertem Text, abschaltbar (Einstellungen → Darstellung) |

**Entscheidungen bei Konflikten im Kürzel-Register:** ⌘E ist „Kortex einrichten“ → Code liegt auf ⇧⌘C. ⌘K ist die Palette und ⇧⌘K löscht die Zeile (CodeMirror) → Link auf ⌘L. ⌥⌘1/⌥⌘2 sind „Studio öffnen“/„Übersicht öffnen“ → Überschriften auf ⌥⇧⌘1–4. ⌘1–4 sind „Gehe zu“.

**Offen / Übergabe:** Bilder aus der Zwischenablage legt erst die Anhang-Logik aus 3a ab (`ctx.bildEinfuegen`); ein Schrägstrich-Menü gibt es noch nicht (der Befehl „Tabelle einfügen“ steht in der Palette).

## 3d – Ungelinkte Erwähnungen und „Was ist neu“

### Ungelinkte Erwähnungen (Info-Spalte)

Code: `Ressourcen/gemeinsam/erwaehnungen.mjs` (Regeln, rein), `erwaehnungen-index.mjs` (Suchindex, Namenssatz, Verlinken), Studio `erwaehnungen.js`.

- **Richtung 1, „Ungelinkte Erwähnungen“:** Wo steht Titel oder Alias der offenen Notiz in anderen Notizen im Klartext? Der Suchindex (#92) nennt aus dem Speicher die Kandidaten (alle Wörter des Namens kommen vor, Umlaut-Varianten als ODER). Nur Kandidaten werden gelesen und genau geprüft, neueste zuerst, höchstens 25 ms je Aufruf und 1500 Dateien. Das Ergebnis je Datei wird mit Änderungszeit und Größe gemerkt; ist das Budget aufgebraucht, nennt die Antwort `offen`, und die Oberfläche fragt in kurzen Abständen weiter.
- **Richtung 2, „Diese Notiz erwähnt …“:** Welche Titel anderer Notizen stehen im (auch ungespeicherten) Text? Der Namenssatz hält die gefalteten Namen aller Notizen im Speicher, führt sich über den Suchindex selbst fort (neue Einträge hängen hinten an, Epoche bei Neubau) und baut sich in Scheiben von 6 ms auf.
- **Regeln:** Ganze Wörter (Bindestrich = Grenze, `_` gehört zum Wort); Groß/klein, NFC/NFD und Umlaute egal (`Mühle` = `muehle` = `Muhle`); Leerzeichen, Tab, `-`, `_` zwischen Wörtern gleich, Zeilenumbruch bricht ab. Nie in: Datei-Kopf, Code (Zäune, eingerückt, Inline), HTML-Kommentar und -Tags, Überschriften (ein Link würde den Titel ändern), Formeln, vorhandenen Links, Adressen, #Tags, @Namen. Ein längerer Name einer anderen Notiz überdeckt den kürzeren; ein Name, der zu zwei Notizen gehört, ist mehrdeutig und wird nie vorgeschlagen. Namen unter drei Buchstaben, reine Zahlen und Namen mit `[ ] | #` zählen nicht. Ziele und Quellen ohne Archiv, Vorlagen, maschinelle Ordner und Systemdateien; Ziele auch nicht im Posteingang.
- **Verlinken in anderen Notizen:** `POST /api/erwaehnungen/verlinken` (`ziel`, `stellen` oder `alle`, `vorschau`, `token`). Läuft als Vorgang `verlinken` in `dateiaktionen.mjs`: Vorschau mit Token, Journal (vorher/nachher), Hash-Prüfung je Datei, ein Eintrag im Aktivitätsprotokoll, Rückgängig über `/api/aktivitaet/rueckgaengig`. Die Stelle wird im aktuellen Text wiedergefunden (gleiche Umgebung), sonst übersprungen. Linktext `[[Titel]]`, bei abweichender Schreibweise `[[Titel|Text]]`, bei mehrdeutigem Titel mit Pfad (`wikilink.mjs#linkText`); in Tabellenzeilen nie mit `|`.
- **Verlinken in der offenen Notiz:** `POST /api/erwaehnungen/links` liefert nur die Änderungen; der Editor setzt sie in EINER Transaktion (⌘Z und „Rückgängig“ im Hinweis), gespeichert wird über den gewohnten sicheren Weg (Drei-Wege-Zusammenführung).

### „Was ist neu“

Code: `gemeinsam/neuigkeiten.mjs`, Studio `neuigkeiten.js`, Routen `GET /api/neuigkeiten?seit=`, `POST /api/neuigkeiten/gelesen`.

Karte oben im Posteingang: neue und geänderte Notizen, Aufgaben (neu, erledigt, überfällig), KI-Aktivität aus dem Protokoll (abgelegt, abgewiesen), Abgleich-Stand, Posteingang. Jede Zeile ist anklickbar. Zeitraum: Merker „gelesen bis“ (je Vault im Support-Ordner), sonst 7 Tage, wählbar. „Gelesen“ setzt den Merker. Eine nicht lesbare Quelle fehlt in der Antwort (`null`), nichts wird erfunden. „Mit KI zusammenfassen“ erscheint nur mit einem KI-Konto ab Stufe „lesen“ und ist ein ehrlicher Platzhalter („kommt bald“); die echte Zusammenfassung kommt später als Vorschlag, nie als Aktion.

MCP: `brain_neuigkeiten` (nur lesend, Stufe „lesen“, wenige Zeilen, ändert den Merker nie). Die Werkzeugliste bleibt unter 4400 Zeichen (Beschreibungen von `brain_gesundheit`, `brain_vaults`, `brain_kontext` gekürzt).

### Messung (20.000 Notizen, Entwicklungsrechner, `Tests/Node/erwaehnungen-last.test.mjs`)

Seltener Titel (200 Notizen): kalt höchstens 25 ms je Aufruf (6 Aufrufe), warm Median 1,1 ms. Häufiges Wort als Titel (1415 Notizen): jeder Aufruf höchstens 26 ms. Gegenrichtung (3-KB-Text): Median 1 ms. Nach Änderung einer Notiz: 6 ms. „Alle verlinken“-Vorschau über 199 Notizen: 150 ms (Nutzeraktion). Der erste Aufbau des Suchindex (2,4 s) gehört dem Index, nicht diesem Paket.
