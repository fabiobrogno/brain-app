# Runde 4: Premium-Audit – ruhig, schnell, ganz mit der Tastatur

Stand: 10.11.2026 · Plan (nichts davon gebaut). Grundlage: Audit von `main` (91bfd87, nach KI-Runde K0–K4 und Folge-Fixes #133) im Browser-Modus.
Maßstab des Nutzers: Orca, Linear, Raycast – exzellente Funktion, flüssig, live, **keine Layout-Sprünge**, keine nativen Felder, eigene Bausteine.
Sichtbar heißt die App „Kortex“, der Datenordner „Vault“.

## 0. Wie geprüft wurde

- **Start:** echter Startbefehl `Ressourcen/werkstatt/start.mjs --nicht-oeffnen` (wie `Tests/Oberflaeche/browser-start.mjs`), eigenes Temp-HOME und Support-Ordner, Umgebung ohne `CLAUDE_CONFIG_DIR`/`CODEX_HOME`. Nie `~/brain`.
- **Vaults:** (1) Test-Vault aus `Tests/Oberflaeche/vault.mjs` plus Notiz mit Tabelle, Bild, Callout, Code, Tags, Aufgaben (4 Karten); (2) **5 052 Notizen** (5 000 generiert in 5 Ordnern × 40 Unterordnern, je 6 Absätze mit Wikilink und Tag, 40 Posteingang-Einträge, Git-Repo); (3) ohne Vault (Willkommen/Einrichtung).
- **Werkzeug:** Playwright 1.64 mit Chromium (headless) aus `Tests/Oberflaeche/node_modules`, 1440 × 900, hell und dunkel, dazu 1024/820/600 px. Zeiten auf dem Entwicklungsrechner, warm.
  **Nicht geprüft:** WebKit (die Engine der Mac-App, WKWebView) – der passende Playwright-WebKit ist nicht installiert; echte Mac-Hülle, Electron-Fenster, KI mit echtem Konto.
- **Fotos** (nur im Scratchpad der Audit-Sitzung, nicht im Repo; die Messwerte stehen unten vollständig):
  `/private/tmp/claude-502/-Users-fbFirma-Privat-Claude/42e9bddd-41bd-41a3-a564-be3ef3f5d013/scratchpad/audit4-*.png` – im Folgenden nur der Name (`audit4-02-editor.png`).

## 1. Was schon Premium ist (nicht anfassen)

- **Einrichtung/Willkommen** (`audit4-60-willkommen.png`): ein Fenster, klare Wahl, Kürzel am Hauptknopf – auf Orca-Niveau.
- **Befehlspalette ⌘K** (`audit4-08-palette.png`): zuletzt geöffnet, Befehle mit Kürzeln, Fußzeile mit Tastenhilfe; **5 ms** bis zum Treffer in 5 052 Notizen, 42 ms bis die Notiz offen ist.
- **Aufgaben-Board** (`audit4-13-aufgaben.png`), **Einstellungen** mit Suche und eigenen Bausteinen (`audit4-16-einst-*.png`), **Dunkel** (`audit4-d-02-editor.png`).
- **Fehlerzustand:** Fällt die Werkstatt weg, sagt die Kopfzeile „Speichern gerade nicht möglich“, der Text bleibt (`audit4-81-werkstatt-weg-sicht.png`).
- **Live:** eine von außen angelegte Datei steht nach **0,9 s** in der Liste. Volltextsuche über 5 052 Notizen: **~160 ms** bis „2750 Treffer“.
- **Keine nativen Formularfelder** im Studio gefunden (`bausteine.js` ersetzt select/date/checkbox; kein `alert/confirm/prompt`).

## 2. Befunde nach Gewicht

### A – hoch (spürbar bei jedem Benutzen oder Datensicherheit)

| # | Befund | Beleg |
|---|---|---|
| A1 | **Kopfzeile springt beim Tippen.** Sobald der Speicherstand von ✓ (14 px) auf den Text „Nicht gespeichert“ wechselt, schrumpft der Notiztitel auf „P…“ und das Suchfeld rutscht um ~90 px nach links – bei jedem Tippen, bei 1440 px mit Info-Spalte. | `audit4-45-kopfzeile-springt.png` (oben gespeichert, unten beim Tippen); `hauptfenster.css:75` (✓ nur im Zustand „gespeichert“), `index.html:81` |
| A2 | **Absätze springen, wenn der Cursor hineingeht.** Fest umbrochene Absätze werden fließend angezeigt (gewollt, ea81ea5) und klappen beim Betreten auf: der Inhalt darunter rutscht um **57 px** (3 Zeilen). Überschrift: 3 px. | `audit4-44-sprung-vergleich.png`; Messung: „Ende“-Zeile y = 560 px (Cursor im Titel) → 617 px (Cursor im Absatz) → 563 px; `editor.js:417-426` (`weicherUmbruch`) |
| A3 | **⌘Z gilt nur im Editor.** Notiz mit ⌘⌫ in den Papierkorb, danach ⌘Z: nichts passiert, nur der Knopf im Toast stellt wieder her. Gleiches für Verschieben, Umbenennen, Tag umbenennen, KI-Übernahme. | `audit4-72-geloescht-toast.png`; `dateiaktionen.js:563-569` |
| A4 | **K2 Befund 9 offen:** ⌘Z nach „Übernehmen“ einer KI-Textaktion nimmt direkt danach getippte Zeichen mit zurück (CodeMirror gruppiert; `isolateHistory` ist im Bündel nicht exportiert). | `ki-runde.md` §11 „Offen“; `ki-text.js:325`, `:335`; `Werkzeuge/editor-bundle/einstieg.js:3` |
| A5 | **Notizliste ohne Virtualisierung.** Die Liste hängt beim Scrollen Karten an und gibt keine ab: nach Scrollen bis zum Ende **5 052 Karten, 94 499 DOM-Knoten** (Start: 3 382), Scrollen bis unten 6,7 s. Ein Sichtwechsel zeichnet danach alles neu (143 ms). Bei 20 000 Notizen vierfach. | `app.js:1376-1407` (`zeichneListe`, `rendereMehr` nur anhängend), `app.js:1408-1417` (`markiereAuswahl` rendert bis zur Auswahl) |
| A6 | **Riesiger Absatz macht den Editor zäh.** 487 KB als EIN Absatz (8 000 Zeilen ohne Leerzeile, viele `[[…]]`): Öffnen 1,36 s (längste Aufgabe 773 ms), **236 ms je Taste**; Profil: 2 038 von 2 355 ms in `LinkEnd` (@lezer/markdown, quadratisch über die offenen `[` des Absatzes). Gleich groß mit Leerzeilen: 74 ms Öffnen, 11 ms je Taste. Typisch bei eingefügten Logs, Transkripten, Exporten. | Profil mit CDP; `vendor/codemirror.bundle.js` |

### B – mittel (Premium-Gefühl, Barrierefreiheit, fehlende Grundfunktionen)

| # | Befund | Beleg |
|---|---|---|
| B1 | **Fokusring zu schwach:** 3 px Akzent mit 38 % Deckkraft ≈ **2:1** gegen Weiß (WCAG 1.4.11 verlangt 3:1); daneben eine zweite Form (`outline: 2px solid`) in Darstellung und Aufgaben. | `studio.css:22`, `darstellung.css:13`, `aufgaben.css:40`; `audit4-17-tab-fokus.png` (Mond-Knopf kaum erkennbar) |
| B2 | **Drittext nur 3:1** bei 12-px-Texten (Datum, „Erstellt …“, Zähler) – AA verlangt 4,5:1 für kleinen Text. | `docs/ENTWICKLUNG.md:95` („Drittext ≥ 3:1“); `audit4-01-start.png` |
| B3 | **Esc und Fokus uneinheitlich:** ⌘J ohne KI-Konto öffnet „Frag“, setzt den Fokus aber nicht ins Panel; Esc schließt es dann nicht (Esc wirkt nur mit Fokus im Panel). Palette, Einstellungen, Kürzelhilfe schließen mit Esc. Keine Taste, um zwischen Seitenleiste, Liste, Editor und Info zu springen; die linke Seitenleiste lässt sich gar nicht ausblenden (⌘\ gilt nur rechts). | `frage.js:281-286`; Register `Ressourcen/gemeinsam/tastenkuerzel-register.json` (`seitenleiste` = „rechts“) |
| B4 | **64 sichtbare Elemente mit nativem `title`** im Hauptfenster: System-Tooltips (langsam, grau, Systemschrift) neben dem eigenen `tooltip()` aus `bausteine.js:388`. | Zählung im DOM (1440 px, Notiz offen) |
| B5 | **Editor-Darstellung unvollständig:** Callouts (`> [!tipp] Titel`) erscheinen roh als Zitat mit „!tipp“; Code-Blöcke zeigen ihre Zäune ```` ```js ```` auch ohne Cursor und haben keine Syntaxfarben; „Neue Notiz“ zeigt nur ein nacktes „#“ ohne Platzhalter, und die Info-Spalte bleibt bei „Wähle links eine Notiz“. Schrägstrich-Menü fehlt (wird parallel gebaut). | `audit4-04-wikilink-vervollst.png`, `audit4-44-sprung-vergleich.png`, `audit4-24-neue-notiz.png`, `audit4-06-schraegstrich.png`; `editor.js:252-258` (FencedCode nur Zeilenklasse) |
| B6 | **Schmale Fenster brechen:** bei 600 px ist der Editor rechts abgeschnitten, das Suchfeld liegt über dem Zurück-Pfeil; nichts klappt ein. Die Mac-App verhindert das mit einer **Mindestbreite von 1 100 px** – damit geht kein Split View auf einem 13"/14"-Mac (halbe Breite ≈ 735 px). Electron erlaubt 720 px, dort bleiben dem Editor ~290 px. | `audit4-50-chromium-600.png`, `audit4-50-chromium-820.png`; `Sources/BrainCore/StudioFenster.swift:8`, `electron/haupt.mjs:369`, `app.js:2915-2935` |
| B7 | **Verlauf spricht Git:** „(3 Commits)“ bricht in eine zweite Zeile, Hashes `6aa8796` und „+7“ für jeden sichtbar. | `audit4-19-verlauf.png`; `texte-verlauf.js:11` |
| B8 | **Suchtreffer zeigen Markdown roh** („`**Heißgetränk**`“, „`[[Kaffee]]`“, „`> Ein Zitat`“); in ⌘K stehen unter „Im Inhalt“ Treffer, die nur „Notiz“ enthalten, vor solchen mit „4711“. | `audit4-11-suche.png`, `audit4-31-gross-palette.png` |
| B9 | **Langsame Startdaten bei großen Vaults:** `/api/notizen` liefert **3,4 MB** (276 ms) und `/api/baum` 880 KB (191 ms) für 5 052 Notizen; „Was ist neu“ steht im Posteingang erst nach **2,3 s** („wird zusammengestellt …“), obwohl `/api/neuigkeiten` 270 ms braucht. | Messung aus der Seite; `audit4-36-gross-was-ist-neu.png` |

### C – klein (wirkt „billig“, schnell behoben)

- **Notizliste:** jede Karte trägt zwei Daten („10. Nov. 2026“ und „Erstellt 10. Nov. 2026“) und dasselbe Dokument-Symbol; die Hover-Aktionen liegen über dem Datum (`audit4-90-akzent-orange-hell.png`); Ordner ohne Pfeil stehen 24 px weiter links als Ordner mit Pfeil (`audit4-01-start.png`).
- **Seitenleiste:** „Schnell er…“ abgeschnitten neben dem Kürzel „⌃⌥ Leertaste“ – im Browser gibt es dieses globale Kürzel gar nicht (`audit4-01-start.png`).
- **Info-Spalte ohne Notiz:** 300 px leer mit „Wähle links eine Notiz“ (`audit4-01-start.png`); „Notiz — wird erst durch /ingest zu Wissen“ zeigt einen internen Befehl (`texte.js:84`); „Ungelinkte Erwähnungen“ neben „unverlinkt“ an anderen Stellen.
- **Einstellungen:** „Rechner: Menü „Kortex“, Windows und Linux: Menü „Ablage““ – im Browser gibt es kein Menü, und „Rechner“ ist die neutralisierte Fassung von „Mac“ (`texte-einstellungen.js:21`); Fußzeile mit Dateinamen `brain.config.json · einstellungen.json` plus zweitem Hinweis „Änderungen gelten sofort.“ (`audit4-15-einstellungen.png`); „0 von 0 Konten angemeldet“ als Kachel (`audit4-16-einst-ki.png`).
- **Browser-Modus:** „Kortex startet den Hintergrunddienst neu“ stimmt dort nicht – niemand startet ihn neu (`audit4-81-werkstatt-weg-sicht.png`).
- **Aufgaben + Frag:** die vierte Spalte wird ohne Hinweis abgeschnitten (`audit4-14-frag.png`).
- **Lokale Posteingang-Vorschläge** („ohne KI“): für „Link-Sammlung Espresso“ (nennt „Espresso“ und „Kaffee“, beide Notizen) und für 40 Einträge „Kaffee Gedanke …“ im großen Vault liefert `/api/ki/vorschlag/lokal` leere Listen. **Zu prüfen**, ob gewollt (Regel) oder Lücke.

### Bekannte offene Punkte, die in Runde 4 gehören

- **K2 Befund 9** (⌘Z-Grenze) → Paket R4-4.
- **Windows-Folgeaufgaben** aus `plattformen-windows-linux.md` §8/§10/§11: Hook-Starter `bin/kortex` für Windows/Linux, `BROWSER`-Skript beim Anmelden (Windows), Named Pipe statt Unix-Socket (`suchdienst.sock`), Pfadform der Oberflächentests (Windows **UI 25 rot, Kern 24 rot**, beides noch Messung statt Tor), Linux: sichtbarer Tray erkennen, Tray-Zeile „Aufgaben offen“, Vault-Name in Mitteilungen; Electron 45.0.0 → ein Patch, der mindestens zwei Wochen alt ist (45.1.0 vom 27.10. ist es ab heute) → Paket R4-8.
- **Offene Nutzer-Entscheidungen:** Win/Linux-Beta-Freigabe, Orange/Bernstein im hellen Schema → Abschnitt 5.

### Schon in Arbeit (nur erwähnt)

- **Schrägstrich-Menü** wird parallel gebaut. Es hängt sich wie alle Editor-Pakete in die Erweiterungsliste von `erstelleEditor` (`editor.js`); R4-1 und R4-2 holen danach `origin/main` und lösen nur diese Zeilen auf.

## 3. Messwerte (5 052 Notizen, Chromium, Entwicklungsrechner)

| Messung | Wert | Ziel nach Runde 4 |
|---|---|---|
| Werkstatt bereit / erste Karten sichtbar | 162 ms / 160 ms | halten |
| ⌘K: Treffer „Notiz 4711“ / Notiz öffnen | 5 ms / 42 ms | halten |
| Volltextsuche „Röstung Angebot“ | ~160 ms (2 750 Treffer) | halten |
| Tippen, 40 Zeichen / bis „Gespeichert“ | 39 ms / 860 ms | halten |
| Liste bis zum Ende scrollen | 6,7 s, 94 499 DOM-Knoten | ≤ 3 000 Knoten der Liste, p95-Frame ≤ 17 ms |
| `/api/notizen` beim Start | 3,4 MB, 276 ms | ≤ 1 MB oder in Teilen |
| „Was ist neu“ im Posteingang | 2,3 s | ≤ 500 ms |
| Notiz 487 KB als ein Absatz: Öffnen / je Taste | 1,36 s / 236 ms | ≤ 300 ms / ≤ 16 ms |
| gleiche Größe mit Absätzen: Öffnen / je Taste | 74 ms / 11 ms | halten |
| Live: Datei von außen in der Liste | 0,9 s | halten |

## 4. Pakete

Jedes Paket: Umsetzer (sonnet) → Tests grün → **ein** Opus-Review am Ende (frischer Kontext, ganzer Diff) → Fotos hell/dunkel prüfen → nacheinander mergen.

### R4-1 Ruhiger Editor: keine Sprünge (M)

**Ziel:** Nichts im Fenster bewegt sich, nur weil man tippt oder den Cursor bewegt.
**Umfang:**
- Kopfzeile: Speicherstand bekommt einen festen Platz (Symbol mit fester Breite; Text nur als Tooltip bzw. `aria-live`), der Titel wird nie vom Speicherstand verdrängt. Fehlerzustand bleibt sichtbar (Farbe + Symbol + Toast).
- Weiche Umbrüche nach Entscheidung 1 (Abschnitt 5): Standard „wie getippt“; „fließend“ als Schalter (Einstellungen → Schreiben); wo fließend, ohne Aufklappen des ganzen Absatzes beim Betreten.
- Überschrift: `#`-Marke ohne 3-px-Versatz (feste Zeilenhöhe).
- Neue Sprung-Spec `Tests/Oberflaeche/ruhe.spec.mjs`: für jeden Blocktyp (Absatz mit Umbrüchen, Überschrift, Liste, Aufgabe, Zitat/Callout, Code-Zaun, Tabelle, Bild, Datei-Kopf) Position des Folgeblocks vor/nach Cursor-Eintritt.

**Fertig, wenn:** `ruhe.spec.mjs` grün mit |Δy| ≤ 1 px je Blocktyp; beim Tippen über 3 s bleiben Titel und Suchfeld in der Kopfzeile pixelgleich (Δx = 0) und der Titel ist bei 1440 px mit Info-Spalte nicht gekürzt; Fotos hell/dunkel; die Spec läuft zusätzlich unter Playwright-WebKit (Engine der Mac-App).
**Risiken:** fließende Absätze sind für hart umbrochene Importe gedacht – wer sie nutzt, darf sie nicht verlieren (Schalter, Datei bleibt bytegleich). WebKit in CI braucht einen Browser-Download (Cache).
**Abhängigkeiten:** Entscheidung 1; nach dem Schrägstrich-Menü mergen (gleiche Einhängung in `editor.js`).

### R4-2 Editor-Darstellung vollständig (M)

**Ziel:** Was Obsidian-Nutzer erwarten, sieht in Kortex fertig aus.
**Umfang:** Callouts `> [!typ] Titel` (Typen wie Obsidian, faltbar mit `-`/`+`, unbekannter Typ = Notiz); Code-Blöcke: Zäune nur in der Cursor-Zeile, Sprachmarke rechts oben, Kopier-Knopf, Syntaxfarben für die häufigsten Sprachen (js/ts, json, py, sh, swift, md, yaml, html/css, sql) über `LanguageDescription` (nur bei Bedarf geladen, Bündel höchstens +150 KB); „Neue Notiz“ mit Platzhalter „Titel“ und Info-Spalte für die neue (noch ungespeicherte) Notiz.
**Fertig, wenn:** Playwright: Callout gerendert (hell/dunkel, gefaltet/offen), Cursor im Callout zeigt Rohtext ohne Sprung (R4-1-Spec erweitert), Code-Block mit Farben, Zäune ohne Cursor unsichtbar, Kopieren liefert den Code ohne Zäune; neue Notiz zeigt Platzhalter und eigene Info; Datei bleibt bytegleich (vorhandene Byte-Tests grün).
**Risiken:** Bündelgröße (`vendor/codemirror.bundle.js`, Neubau über `Werkzeuge/editor-bundle`); Callouts in Listen/verschachtelt.
**Abhängigkeiten:** nach R4-1 (gleiche Dekorationen) und dem Schrägstrich-Menü (das Callouts und Code-Blöcke anbieten soll).

### R4-3 Tastatur, Fokus und Kontrast (M)

**Ziel:** Alles geht ohne Maus, man sieht immer, wo man ist, und Esc tut überall das Erwartbare.
**Umfang:**
- Ein Fokusring für alles (`--fokus-ring` mit ≥ 3:1 gegen jede Fläche, alle Schemata × Akzente), die zweite Form (`outline`) entfällt.
- Regionen: F6 / ⇧F6 springt Seitenleiste → Liste → Editor → Info/Frag; linke Seitenleiste ein/aus (Kürzel nach Mac-Gewohnheit ⌃⌘S, im Register änderbar); Hell/Dunkel bekommt ein Standardkürzel.
- Esc als **ein** Stapel: Popover/Menü → Dialog → Format-Leiste → Panel (Frag, Verlauf, Mitteilungen) → Suche → Auswahl; ⌘J/⇧⌘H/⇧⌘B setzen den Fokus ins geöffnete Panel und geben ihn beim Schließen zurück.
- Kürzelhilfe ⌘/ zeigt alle Register-Einträge (nach Gruppen) plus F2, ⌘⌫, Pfeile in Liste und Board.
- Kleiner Text (< 14 px: Datum, Zähler, Pfade) auf ≥ 4,5:1 (Drittext nur noch für Symbole und Linien).

**Fertig, wenn:** Spec mit Esc-Matrix (jede Fläche öffnen → Esc → richtiger Zustand, Fokus zurück am Auslöser); Tab/F6-Reihenfolge-Test; Kontrast-Test in `darstellung.spec.mjs` um Fokusring (≥ 3:1) und kleinen Text (≥ 4,5:1) erweitert, alle 7 × 9 grün; Kürzel-Konflikttest grün.
**Risiken:** F6 und ⌃⌘S kollidieren evtl. mit Systemkürzeln (Register-Prüfung `reserviert`); dunklerer Drittext verändert das Bild (Fotos zeigen).
**Abhängigkeiten:** keine; parallel zu R4-1 möglich (andere Dateien: CSS-Tokens, `fenster.js`, Register).

### R4-4 Rückgängig überall, Verlauf in Menschensprache (M)

**Ziel:** Jede Wirkung lässt sich mit ⌘Z zurücknehmen, und der Verlauf erklärt sich ohne Git-Wissen.
**Umfang:**
- ⌘Z/⇧⌘Z außerhalb des Editors = letzte Dateiaktion (Papierkorb, Verschieben, Umbenennen, Tag umbenennen, Verlinken, KI-Übernahme) über den vorhandenen Weg `POST /api/aktivitaet/rueckgaengig`; der Toast nennt „⌘Z“.
- **K2 Befund 9:** `isolateHistory` aus `@codemirror/commands` im Bündel exportieren (`Werkzeuge/editor-bundle/einstieg.js`), Übernahme-Transaktionen in `ki-text.js:325/335` und `erwaehnungen.js:199` mit `isolateHistory.of("full")`.
- Verlauf: „Sicherung“ statt „Commit“, keine Hashes/Zeilenzahlen im Standard (Schalter „Technische Details“ unter Erweitert), Zählzeile ohne Umbruch, vor dem Wiederherstellen eine Vorschau mit Unterschied.

**Fertig, wenn:** Playwright: Notiz löschen → ⌘Z → Notiz zurück und offen; Verschieben/Umbenennen/Tag-Umbenennen je ⌘Z/⇧⌘Z; KI-Text übernehmen, „x“ tippen, ⌘Z entfernt nur „x“, zweites ⌘Z die KI-Änderung (Attrappe aus `Tests/Kern/fake-claude-vorschlag.mjs`); Text-Test: keine Hashes/„Commit“ in der Standardansicht; vorhandene Journal-/Rückgängig-Tests (Node) grün.
**Risiken:** zwei Rückgängig-Stapel (Editor und Datei) – Regel: Fokus im Editor = Editor-Stapel, sonst Datei-Stapel; nie über Vault-Wechsel hinweg.
**Abhängigkeiten:** Bündel-Neubau auch für R4-2 nötig – denselben Neubau einmal machen (wer zuerst kommt, exportiert beides).

### R4-5 Große Vaults ohne Ruckeln (L)

**Ziel:** 20 000 Notizen fühlen sich an wie 200.
**Umfang:**
- Notizliste virtualisieren (nur sichtbare Karten ± Puffer, feste bzw. gemessene Höhen, Auswahl und Scroll-Position bleiben; Übergänge aus `listenUebergang` erhalten).
- Startdaten schlank: `/api/notizen` nur mit den Feldern der Liste (Vorschautext gekürzt) oder in Teilen; `/api/baum` ohne Doppelungen.
- „Was ist neu“ ohne Warten auf den vollen Index (erst Zahlen, dann Zeilen).
- Riesen-Absätze: Schutz vor dem quadratischen Inline-Parsen (z. B. Live-Vorschau-Dekoration ab einer Absatzlänge nur im Sichtbereich, oder Absatz-Grenze für Inline-Links) – gemessen, nicht geraten.
- `scripts/messe-grosse-vaults.mjs --ui` um Liste, Start, Riesen-Absatz und „Was ist neu“ erweitern; Ergebnis als Bericht im CI-Lauf (nicht blockierend).

**Fertig, wenn:** bei 20 000 Notizen: Liste bis zum Ende gescrollt ≤ 3 000 DOM-Knoten in `#liste-koerper` und p95-Frame ≤ 17 ms; Start bis erste Karte ≤ 300 ms; Startdaten ≤ 1 MB; „Was ist neu“ ≤ 500 ms; 500-KB-Absatz: Öffnen ≤ 300 ms, ≤ 16 ms je Taste; alle bestehenden Listen-Specs (Auswahl, Pfeiltasten, Ziehen, Umbenennen an Ort und Stelle) grün.
**Risiken:** Virtualisierung bricht Ziehen-und-Ablegen, Umbenennen an Ort und Stelle (`da.nachZeichnen`) und `scrollIntoView`; Höhen variieren (1–3 Zeilen Vorschau). Ein eigener kleiner Virtualisierer statt Bibliothek.
**Abhängigkeiten:** vor R4-6/R4-7 (die Karte ändert sich dort); parallel zu R4-1/R4-3.

### R4-6 Politur: Liste, Suche, Texte, Tooltips (M)

**Ziel:** Keine Stelle wirkt mehr „billig“.
**Umfang:** alle C-Befunde aus Abschnitt 2; Notizkarte: ein Datum (je nach Sortierung), Symbol nur bei abweichendem Typ, Hover-Aktionen ohne Überdeckung; Ordnerzeilen bündig; Suchtreffer ohne Markdown-Zeichen, Inhaltstreffer mit allen Suchwörtern zuerst; alle 64 nativen `title` → `tooltip()`; Texte („/ingest“, „Ungelinkte“, „Rechner: Menü“, Fußzeile der Einstellungen, „0 von 0“, Browser-Modus-Texte) plattformgerecht über `plattform-texte.js`; lokale Posteingang-Vorschläge prüfen (Regel oder Fehler) und ggf. beheben.
**Fertig, wenn:** Test „keine nativen Tooltips“ (`[title]` im Hauptfenster = 0); Texttest mit Liste verbotener Begriffe in `texte*.js` (`/ingest`, `Commit`, `Rechner:`, Dateinamen in Fußzeilen); Such-Spec für Snippets ohne `**`, `[[`, `>`; Fotos vorher/nachher von Liste, Suche, Info, Einstellungen (hell/dunkel).
**Risiken:** viele kleine Stellen in `app.js` – Konflikte mit R4-5/R4-7 (darum danach).
**Abhängigkeiten:** nach R4-5.

### R4-7 Schmale Fenster und Split View (M)

**Ziel:** Kortex funktioniert auf der halben Breite eines 13"-MacBooks.
**Umfang:** Stufen: < 1 100 px Info-Spalte als Überlagerung; < 960 px Seitenleiste eingeklappt (Knopf + Kürzel aus R4-3, schwebend beim Öffnen); < 760 px Liste und Editor im Wechsel (Zurück-Pfeil); Kopfzeile mit Überlauf-Menü „…“. Mindestgröße Mac und Electron einheitlich 720 × 520 (`StudioFenster.swift:8`, `electron/haupt.mjs:369`). Aufgaben-Board horizontal scrollbar mit Kantenschatten.
**Fertig, wenn:** Fotos 1440/1100/900/720 px hell/dunkel ohne Abschneiden (`scrollWidth == innerWidth`, Textspalte des Editors ≥ 420 px oder Editor allein); alle Hauptflächen (Liste, Editor, Posteingang, Board, Frag, Einstellungen) bei 720 px bedienbar; `FensterGeometrie`-Tests mit neuer Mindestgröße grün.
**Risiken:** Breitenlogik `begrenzeBreiten` (`app.js:2915`) und gespeicherte Spaltenbreiten; Glas-Seitenleiste der Mac-App als Überlagerung.
**Abhängigkeiten:** Entscheidung 4; nach R4-3 (Kürzel) und R4-5 (Liste).

### R4-8 Windows/Linux-Beta-Rest (M–L)

**Ziel:** Windows und Linux sind kein „fast“ mehr – die Messung wird Tor.
**Umfang:** Hook-Starter `bin/kortex` für Windows (`.cmd`/`.exe` wie die Vertrauensschranke) und Linux; `BROWSER`-Skript beim Anmelden unter Windows; Named Pipe statt `suchdienst.sock`; Pfadform in `starteServer` und den Specs vereinheitlichen, dann die 25 roten UI-Tests und 24 Kern-Tests je Ursache; Linux: sichtbaren Tray erkennen (sonst Schließen = Beenden mit Hinweis); Tray-Zeile „Aufgaben offen“; Vault-Name in Mitteilungen; Electron auf einen Patch ≥ 2 Wochen alt (45.1.x).
**Fertig, wenn:** Windows Kern + Oberfläche **0 rot**, `continue-on-error` für `windows-latest` aus `.github/workflows/ci.yml` entfernt (bis auf arm64-Bau); Hook-Aufruf auf allen drei Systemen getestet (`kern-verdrahtung`); Paket-Rauchtest Windows/Linux grün mit neuem Electron; Abschnitte in `plattformen-windows-linux.md` nachgetragen.
**Risiken:** Windows-Zeitgrenzen schwanken (Virenscan) – Grenzen für win32 lockern statt Tests zu streichen; Kern-Tests mit `ps`-Lebendprüfung.
**Abhängigkeiten:** unabhängig von R4-1 … R4-7 (anderer Code) – jederzeit parallel; Entscheidung 3 bestimmt, ob die Beta darauf wartet.

## 5. Entscheidungen für den Nutzer (mit Empfehlung)

| # | Frage | Empfehlung |
|---|---|---|
| 1 | **Weiche Umbrüche:** fest umbrochene Absätze (A) wie getippt zeigen und „fließend“ als Schalter anbieten, oder (B) weiter fließend zeigen und nur den Sprung beim Betreten dämpfen? | **A** – so macht es Obsidian; kein Sprung möglich, und wer hart umbrochene Importe hat, schaltet „fließend“ ein (dann ohne Aufklappen beim Betreten). |
| 2 | **Orange und Bernstein im hellen Schema:** (A) so lassen (wegen AA bräunlich: Orange `#B64409`, Bernstein `#8F5E18`), (B) zwei Töne je Akzent – Flächen/Knöpfe in der leuchtenden Farbe mit dunkler Schrift, Text/Links in der dunklen AA-Fassung, (C) beide im hellen Schema streichen. | **B** – sieht aus wie gewählt und bleibt lesbar; Foto zum Vergleich `audit4-90-akzent-orange-hell.png`, vor dem Bau als kleine Vorschau zeigen. |
| 3 | **Windows/Linux-Beta:** jetzt freigeben (unsigniert, Schritte `docs/veroeffentlichen.md` §10) oder nach R4-8? | **Nach R4-8** (Hook-Starter fehlt, UI-Tests unter Windows noch Messung) – etwa eine Woche; **SignPath-Antrag jetzt stellen**, weil er Wartezeit hat. |
| 4 | **Mindestbreite** der Mac-App von 1 100 auf 720 px senken (Split View auf 13"/14")? | **Ja, mit R4-7** – erst wenn die schmalen Stufen gebaut sind, nicht vorher. |
| 5 | **Git-Begriffe im Verlauf** (Commit, Hash) für alle ausblenden und nur unter „Technische Details“ zeigen? | **Ja** – Kortex-Nutzer sichern „Fassungen“, nicht Commits; Fachleute schalten es ein. |

## 6. Reihenfolge und was parallel geht

| Welle | Pakete (parallel) | Warum so |
|---|---|---|
| 1 | **R4-1** Ruhiger Editor · **R4-3** Tastatur/Fokus/Kontrast · **R4-5** Große Vaults · **R4-8** Windows/Linux | die drei wichtigsten Gefühlsthemen (Sprünge, Tastatur, Tempo) in verschiedenen Dateien; R4-8 berührt das Studio nicht |
| 2 | **R4-4** Rückgängig/Verlauf · **R4-2** Editor-Darstellung (nach Schrägstrich-Menü und R4-1) | brauchen beide den Bündel-Neubau – einmal bauen, nacheinander mergen |
| 3 | **R4-6** Politur · **R4-7** schmale Fenster | ändern Liste und Kopfzeile; erst nach R4-5/R4-3, damit nichts doppelt angefasst wird |

Merge-Regel wie in Runde 3: parallel bauen, **nacheinander** mergen; wer später kommt, holt `origin/main` und löst nur die eigenen Einhängungen in `editor.js`/`app.js` auf.
Abschluss der Runde: Vorschau für den Nutzer neu starten (hell, dunkel, großer Vault), nicht nur Tests melden.

## 7. Nicht in Runde 4 (bewusst)

- Offene KI-Kleinigkeiten aus `ki-runde.md` §11–§13 (Übersetzen ins Deutsche aus deutschem Text leer, K4 ohne Nachladen über 25 Stellen, `ki: nein`-Schalter im Studio, Richtung „Diese Notiz erwähnt …“ mit KI): klein, eigene Folge-PR bei Bedarf.
- Tabs/geteilte Ansicht, Graph-Ansicht, iPhone/iPad, Team-Vault (`vision-team.md`): erst nach v1.

## 8. Stand R4-8 (Windows/Linux-Beta-Rest, Branch `feat/r4-windows-linux`)

**Gebaut und getestet**

| Teil | Stand |
|---|---|
| Hook-Starter | `electron/laufzeit.mjs` schreibt bei jedem Start `<Support>/bin/kortex` (Linux, Shell wie `Laufzeit.swift`) bzw. `bin/kortex.cmd` (Windows, Stapeldatei ohne feste Pfade, `%~dp0`). Hook-Befehle zeigen auf ihn (`pfade.mjs#hookBefehl`; Windows über Git Bash: `if [ -f … ]; then … hook <name>; else exit 0; fi`, Exit-Code des Hooks bleibt). Die Werkstatt ruft ihn unter Windows als `node.exe` + `brain.mjs` (`starterAufruf`, nie eine `.cmd` ohne Shell). Test `Tests/Node/starter-hook.test.mjs` startet den Starter wirklich (cmd.exe und sh.exe auf Windows), Paket-Rauchtest ruft `hook` im installierten Paket auf. |
| `BROWSER` beim Anmelden (Windows) | `kortex-browser.cmd` schreibt die Adresse in die Datei (`anmeldung.mjs`); der Test „umbrochene Adresse“ läuft jetzt auch unter Windows. |
| Named Pipe | Suchdienst und Client nutzen unter Windows `\\.\pipe\kortex-suchdienst-<Hash>`. Der Hash enthält ein **Geheimnis des Benutzers** (32 Zufallsbytes in `<Support>/suchdienst-geheimnis`, 0600, im Profil des Benutzers): ein anderer lokaler Benutzer kann den Namen nicht erraten und die Pipe nicht vorher belegen; ohne lesbares Geheimnis gibt es keinen Dienst (`dienst-client.mjs#dienstGeheimnis`, Test `test-dienst-pipe.mjs`). `meldeHaenger` beendet den Dienst unter Windows über die Prozessliste und `taskkill` statt `ps`. |
| Linux-Tray | `tray.mjs#linuxTraySichtbar` fragt den StatusNotifierWatcher (gdbus, dann dbus-send). Schließen bleibt nur dann im Tray, sonst beendet es die App (`KORTEX_SCHLIESSEN_IN_TRAY=1/0` erzwingt/verbietet). |
| Tray-Zeile | „N Aufgaben offen · M überfällig“ (wie Mac), öffnet das Board. Aktualisierung alle 2 min bzw. bei Statuswechseln. |
| Mitteilungen | `subtitle` gibt es nur am Mac: unter Windows/Linux steht der Vault-Name vor dem Satz (`systemMitteilung`). |
| Electron | 45.0.0 → 45.1.0 (vom 27.10., jetzt ≥ 2 Wochen alt; 45.2.x/45.3.0 sind jünger), Lizenzliste angepasst. Fuses und Lizenzliste (Electron, electron-updater) waren schon erledigt (`plattformen-windows-linux.md` §12). |
| Echte Fehler gefunden | Sperre unter Windows (`abgleich-sperre.mjs`: EPERM bei gerade gelöschter Datei zählte als „kein Tor“ → zwei Prozesse zugleich), Laufwerkswurzel `D:` in Sperrlisten (`beleg-ernte.mjs`, `gedaechtnis.mjs`), PDF-Export unter Windows (erlaubte Adresse), Hook-Liste der Tests mit `:` statt `;`, Konto-Kennung vor `;` im Hook-Befehl, **pre-commit fand kein Node ohne System-Node** (`git-hooks/pre-commit` sucht jetzt zuerst `<Support>/bin/node[.exe]` neben dem Kern; sonst bräche jeder Vault-Commit auf Windows/Linux-Paketen ab). Beleg: `test-pre-commit-echt.mjs` startet den ECHTEN Kern-Hook mit Node nicht im PATH, ein Secret im Commit macht ihn rot, ein sauberer geht durch (läuft auf macOS, Linux und Windows). Kleinkram aus dem Review: Scheitert das Schreiben des Starters, läuft die App weiter (Grund im Protokoll); `BROWSER`-`.cmd` legt den Pfad vor der verzögerten Ausdehnung in eine Variable; Linux ohne sichtbaren Tray zeigt beim ersten Schließen einmal einen Hinweis. |
| Zeilenenden (bewusst NICHT im Produkt) | Das Review wollte `-c core.autocrlf=false` fest in der Vertrauensschranke und in `gemeinsam/git.mjs`. Probiert und zurückgenommen: ein Klon mit dem Standard von Git for Windows (`autocrlf=true`) hat CRLF im Arbeitsbaum; mit erzwungenem `false` meldet `git status` dort **jede Datei als geändert** (Test `v2-notizen.test.mjs:294` wurde unter Windows rot). Die CI schaltet autocrlf darum nur für die Testumgebung ab (`ci.yml`, Schritt „Git ohne Zeilenenden-Umwandlung“). Offen als Produktfrage: Verlauf/Wiederherstellen liefern unter Windows mit `autocrlf=true` CRLF (wie das eigene git des Nutzers); sauber wäre, `\r` erst bei der Anzeige/dem Vergleich in Kortex zu ignorieren statt git umzustellen. |

**CI je Plattform (Pflicht = in `ci-ok`)**

- Linux: alles Pflicht (wie bisher).
- Windows jetzt Pflicht: Node-Tests, Vertrauensschranke, Kern-Unit-Tests (mit 20 übersprungenen, siehe Offen 2), Electron-Hülle, Paket-Rauchtest (außer arm64-Bau).
- Windows weiter Messung (`continue-on-error`): nur die Oberflächentests (Playwright, 4 Teile). Stand der letzten Messung (Lauf 42947494701): **17 rote Tests von ~1100** (vorher 30; `ki-konten.spec` mit 5 Tests war ein CSS-Escape der Windows-Pfade, behoben und bestätigt).

**Offen (ehrlich)**

1. Windows-UI, Ursache noch ungeklärt (nur im Lauf gemessen, kein Windows-Rechner zum Nachstellen): `posteingang.spec` (3: Verwerfen/Übernehmen ohne Wirkung), `konflikt.spec` (1), `umbenennen.spec` (2), `browser-modus.spec` (2, Anmelden im Browser), `einrichtung.spec:900`, `vorschau-frage.spec` (2, Platzhalter-Claude), `zusammenbau.spec` (Spaltenbreite), `aktivitaet.spec:74`, `glocke.spec:402` (Tab-Fokus), `ki-text-aktionen.spec:317/386` (wechselt zwischen den Läufen), `anhaenge.spec:331`, `schreiben.spec:424`, `tags-export.spec:215` (Zwischenablage mit `\r`?). `ki-konten.spec` (5) war ein CSS-Escape der Windows-Pfade, behoben. Tor erst, wenn diese Liste 0 ist.
2. Windows-Kern, bewusst übersprungen mit Vermerk „R4-8 offen“ (`nurUnix`): **20 Tests** in 8 Dateien (`test-pflege-*`, `test-tageslauf-schreiben/-lauf/-lauf-grenzen`, `test-pflege-zurueck-nichts`). 16 davon nutzen einen Test-pre-commit aus dem Vault-Ordner `.hooks` (`core.hooksPath` → Vertrauensschranke → Hook): unter Windows geht der Commit durch statt rot zu werden; die Folgetests scheitern an einer liegengebliebenen Arbeitskopie („already exists“). 4 nutzen die Attrappe `claude` (`fake-sonnet`, Exit 4). Die Ursache ist **nicht** der echte Hook: der läuft unter Windows (`test-pre-commit-echt.mjs`, grün, Node nicht im PATH). `test-konto-hooks` ist aufgeteilt: „kaputte `ki-konten.json` → Hooks verstummen“ läuft jetzt auf Windows, nur die Symlink-Variante bleibt Unix (Symlink braucht dort den Entwicklermodus). Weitere Unix-Skips mit Grund: chmod-Verzeichnisrechte (3), `Read(//Users/…)`-Regelmuster (Windows-Laufwerksform in Claude-Code-Rechten ungeklärt), relative POSIX-Pfade (W1-Pfadformen). **Für Windows-Nutzer zählt:** der Commit-Schutz im Vault ist belegt (echter Hook, Secret rot); die Tageslauf-Arbeitskopie mit Fixture-Hook ist es noch nicht.
3. UI-Zeitgrenzen: auf Windows nur geloggt (Skelett-Deckkraft), Dichte-Leiter der Kontingent-Leiste übersprungen (Schriftmaße).
4. Nicht in der CI prüfbar: echter Linux-Desktop (Wayland/GNOME-Tray), SmartScreen, Update-Weg zwischen zwei Betas.

**Was der Nutzer für die Beta-Freigabe tun muss** (nichts davon ist ausgeführt; kein Tag, kein Release, kein SignPath-Antrag)

1. Entscheiden (Entscheidung 3). **Beta-Freigabe erst nach:** Pipe-Geheimnis (erledigt), belegter Commit-Prüfung unter Windows (erledigt durch den echten Hook; die 20 Fixture-Tests stehen noch offen), der Zeilenenden-Frage oben und den Geräteprüfungen (Punkte 2 und 3). Wer vorher eine Beta will: unter Windows Tageslauf und Pflege ausgeschaltet lassen (Einstellungen → Automatik), und die Windows-UI als bekannte Lücke nennen.
2. Auf einem **echten Windows-Rechner** einmal prüfen: Installer (SmartScreen „Trotzdem ausführen“), Kortex starten, Einstellungen → Claude Code verbinden, in einer Claude-Sitzung läuft der Hook (Git Bash ist dafür Voraussetzung), Anmelden im Fenster (Browser öffnet sich), Tray-Symbol. Meldet sich etwas rot, bitte die Stelle nennen: dort fehlt mir ein Windows-Gerät.
3. Auf einem **Linux-Desktop** (Ubuntu 24.04 und ein zweiter, z. B. Fedora/KDE): AppImage und deb starten, Tray sichtbar? (GNOME braucht die AppIndicator-Erweiterung, sonst beendet Schließen die App), Hook in einer Claude-Sitzung.
4. Die Schritte in `docs/veroeffentlichen.md` §10 (Version, Pakete des grünen `main`-Laufs, Prerelease mit Tag, Update-Weg prüfen) selbst ausführen.
5. SignPath-Antrag stellen (Wartezeit); bis dahin unsigniert.
6. Markenrecht „Kortex“ klären (`veroeffentlichen.md` §10 Schritt 3 der Liste).

## Stand R4-1 (Ruhiger Editor)

**Entscheidung 1 = A umgesetzt.** Gemessen mit `Tests/Oberflaeche/ruhe.spec.mjs` (Chromium, 1440 px, 1700 px hoch, hell + dunkel; Δy = Verschiebung der Zeile „ENDE“ unter allen Blöcken, wenn der Cursor in einen Block geht):

| Block | vorher | nachher |
|---|---|---|
| Absatz (3 fest umbrochene Zeilen) | +26,9 px | 0 (beide Modi) |
| Überschrift | −3,1 px | 0 |
| Liste, Aufgabe, Zitat, Callout, Code | 0 | 0 |
| Tabelle: Zelle anklicken | 0 | 0 |
| Bild: anklicken | 0 | 0 |

- **Umbrüche:** Standard „wie getippt“ (jede Zeile des Absatzes steht, wie sie in der Datei steht). Schalter „Zeilenumbrüche fließend“ (Einstellungen → Darstellung → Text und Editor, Schlüssel `zeilenFliessend`, Standard aus; `app-einstellungen.mjs`, `darstellung.js`) zeigt fest umbrochene Absätze als Textfluss und klappt sie beim Betreten **nicht** mehr auf; Umschalten wirkt sofort im offenen Editor. Enter mitten in einem fließenden Absatz auf oberster Ebene beginnt einen neuen Absatz (ein einfacher Umbruch bliebe unsichtbar). Datei bleibt bytegleich (Byte-Tests in `absaetze.spec.mjs` laufen jetzt mit eingeschaltetem Schalter und sind auf „bleibt fließend“ umgestellt).
- **Überschrift:** die 3 px kamen von zwei Puffer-Bildern (`cm-widgetBuffer`, 1 em hoch), die CodeMirror um das versteckte „# “ legt und die in der großen Schrift über die Zeilenbox ragten (`studio.css`).
- **Kopfzeile:** Speicherstand ist ein Symbol fester Größe (16 px: Häkchen, Ring, Spinner, Ausrufezeichen), Text bleibt im Element (`aria-live`) und im Tooltip (`tooltip()` aus `bausteine.js`); ein Fehler erscheint zusätzlich als Toast. Der Titel behält Platz (`.kopf-links { min-width: 260px }`: bei Platzmangel schrumpft zuerst das Suchfeld). Gemessen beim Tippen über 3 s: Suchfeld-x, Suchfeld-Breite, Titelbreite und Breite des Speicherstands Δ = 0; Titel bei 1440 px mit Info-Spalte nicht gekürzt (vorher: Suchfeld rutschte um 86 px).
- **WebKit:** `playwright.webkit.config.mjs` + CI-Schritt in Shard 1 (`ci.yml`). Lokal war WebKit in der Agenten-Umgebung nicht startbar (Browser schließt sich sofort); der erste Lauf ist der in der CI.

**Offen / bewusst nicht in R4-1:**
- **Tabelle und Bild beim Hineinlaufen mit den Pfeiltasten** zeigen den Quelltext: Tabelle −20 px (3 Zeilen statt Gitter), Bild +37,8 px (Rohzeile + Bild). Das ist die Quelltext-Bearbeitung dieser Blöcke, kein Layoutfehler; wer sie bedient (Zelle, Klick auf das Bild), sieht keinen Sprung. Die Spec protokolliert die Werte. Wollen wir 0 px auch dort, braucht es einen anderen Weg (Fokus in die erste Zelle statt Quelltext; Rohzeile als Überlagerung des Bildes) – Vorschlag für R4-2.
- **Datei-Kopf (Front Matter):** der zugeklappte Kopf ist ein atomares Kästchen und öffnet nur durch ausdrückliche Handlung (Klick); Pfeiltasten springen darüber. Kein Cursor-Eintritt, daher nicht in der Messreihe.
- Die Mac-App und der Browser-Modus teilen sich dieselben Dateien; der neue Schalter steht im Schema (`app-einstellungen.mjs`), Swift muss nichts wissen.

## Stand R4-5 (Große Vaults ohne Ruckeln)

**Gebaut** (Branch `feat/r4-grosse-vaults`):
- **Virtuelle Notizliste** (`Ressourcen/studio/liste-virtuell.js`, Einhängung in `app.js`: `zeichneListe`, `markiereAuswahl`, Pfeiltasten): nur sichtbare Karten ± 700 px im DOM, Platzhalter oben/unten tragen den Rest. Kartenhöhen werden gemessen (je Pfad gemerkt, `ResizeObserver`), Ungemessene zählen 92 px; der oberste sichtbare Eintrag bleibt beim Messen und Nachzeichnen an derselben Stelle (Ankerkorrektur, kein Sprung). Auswahl, `scrollIntoView`, Pfeiltasten/Pos1/Ende, Live-Aktualisierung (`behalte`), Übergänge (`listenUebergang`, nur noch für wirklich neue/entfernte Einträge der ganzen Liste) und Umbenennen an Ort und Stelle (Karte mit Fokus bleibt gezeichnet) sind erhalten; Karten tragen `aria-setsize`/`aria-posinset`. `content-visibility` entfällt (Karten werden gemessen).
- **Pfeiltasten-Fehler behoben:** schneller als die 40-ms-Entprellung rechnete jeder Tastendruck vom alten Stand (Halten der Taste bewegte nur eine Karte).
- **Schlanke Startdaten:** `/api/index`, `/api/notizen`, `/api/teilindex` mit `kompakt` (Studio nutzt es): ohne `links`, Vorschau auf 160 Zeichen; ohne den Schalter bleibt der Vertrag unverändert (`Tests/Node/index-kompakt.test.mjs`).
- **„Was ist neu“:** die 2,3 s kamen daher, dass `/api/ki/vorschlag/lokal` die Werkstatt ~2 s blockierte (Pool, Ordner und Titel-Index wurden je Eintrag für alle 5 000 Notizen neu berechnet); jetzt einmal je Anfrage (`ki-vorschlag.mjs: lokalerPool`), 2,1 s → 0,7 s.
- **Riesen-Absatz** (`Ressourcen/studio/editor-lange-absaetze.js`, eine Zeile in `editor.js`): im Syntaxbaum endet ein Absatz nach 8 000 Zeichen (Text unverändert), ab 20 000 Zeichen in einem Absatz gelten Klammern als gewöhnlicher Text (kein quadratisches `LinkEnd`).
- Tests: `Tests/Oberflaeche/grosse-vaults.spec.mjs` (DOM-Grenze, Scrollen bis zum Ende, Frame-Zeiten, Pfeiltasten über Seiten, keine Sprünge ≤ 1,5 px über 220 Schritte rauf/runter, Live, Riesen-Absatz; Zeitgrenzen auf Windows nur Log), `Tests/Node/index-kompakt.test.mjs`; `scripts/messe-grosse-vaults.mjs --ui` misst zusätzlich Startdaten, Liste, „Was ist neu“ und Riesen-Absatz (`--alt <Ordner>` für „vorher“).

**Messwerte** (Chromium headless, Entwicklungsrechner; „vorher“ = `origin/main`):

| Messung | vorher (5 052) | nachher (5 000) | nachher (20 000) | Ziel |
|---|---:|---:|---:|---|
| DOM-Knoten der Liste nach Scrollen bis zum Ende | 71 744 (5 053 Karten) | 242–366 (17–26 Karten) | 296 (21 Karten) | ≤ 3 000 ✔ |
| Bild beim Scrollen p95 | 16,8 ms | 16,7 ms | 16,8 ms (größtes 33 ms) | ≤ 17 ms ✔ |
| Sprung beim Scrollen gegenüber Soll | – | 0,00 px (220 Schritte) | – | ≤ 1,5 px ✔ |
| `/api/index` beim Start | 3,72 MB | 2,1 MB (eigener Vault) / 2,57 MB (Messvault, vorher 2,89) | 10,3 MB | ≤ 1 MB ✘ |
| „Was ist neu“ im Posteingang | 0,3–2,3 s (Werkstatt blockiert durch `lokal` 2,1 s) | 0,31–0,37 s, `lokal` 0,74 s | 1,29 s (vorher 0,83 s) | ≤ 0,5 s (5 000 ✔, 20 000 ✘) |
| 487-KB-Absatz: Öffnen | 4,3 s | 0,09–0,11 s | 0,25 s | ≤ 0,3 s ✔ |
| 487-KB-Absatz: je Taste (Event-Dauer / 2 Bilder) | 144–272 ms | ≤ 16 ms / 32 ms (Boden ≈ 33) | 43 ms | ≤ 16 ms ✔ (5 000) |
| Start bis erste Karte | 0,9–1,4 s | 1,0–1,45 s | 6,5 s (vorher 6,0 s) | ≤ 0,3 s ✘ |

**Offen:**
- Startdaten bleiben bei 20 000 Notizen ≈ 10 MB (Felder `felder`, `vorschau`, Pfad, zwei Zeitstempel je Zeile ≈ 500 B): Ziel „≤ 1 MB oder in Teilen“ nicht erreicht. Nächster Schritt wäre Laden in Teilen (erste 500 Zeilen sofort, Rest im Hintergrund; Zähler der Seitenleiste brauchen dann einen eigenen Weg) oder `felder` nur für gewünschte Schlüssel.
- Start bis erste Karte (20 000: 6,5 s) und „Was ist neu“ (1,3 s) hängen an Aufbau und Aufbereitung des Index in der Werkstatt (Server), nicht an der Oberfläche; unberührt.
- `messe-grosse-vaults.mjs --ui` läuft nicht im CI-Lauf (nur von Hand); „vorher“-Wert für Liste scrollen ist im Skript nicht belastbar (alte Liste wächst erst beim Scrollen), die Tabelle oben nutzt die Messung mit Mausrad-Schritten.
- Review-Nachträge: Tabellen und Link-Definitionen werden nie geschnitten (Test mit dem Bündel); Karte mit Fokus/Umbenennung/Ziehen bleibt gezeichnet bzw. gibt den Fokus an die Liste ab; Vorschau kompakt endet mit „…“ an Wortgrenze; Ziel der Pfeiltasten gilt nur für Wege aus der Liste.
- Der Schnitt langer Absätze wirkt nur im Syntaxbaum; ein `[Text](Adresse)`-Link in einem Absatz über 20 000 Zeichen verliert seine Auszeichnung.

## Stand R4-3 (Tastatur, Fokus und Kontrast)

Gebaut auf Branch `feat/r4-tastatur-fokus`. Fotos (Scratchpad der Sitzung): `r43-fokusring-hell.png`, `r43-fokusring-dunkel.png`, `r43-fokus-liste-hell.png`, `r43-fokus-liste-dunkel.png`, `r43-tooltip.png`, `r43-kuerzelhilfe.png`, `r43-frag-fokus.png`.

- **Ein Fokusring:** `--fokus` (= Akzent, deckend) und `--fokus-ring` (1 px Papierspalt + 2 px Akzent) in `studio.css`; alle `outline: 2px solid var(--akzent)` bei `:focus-visible` sind weg (Ring per `box-shadow`, innen bei bündigen Zeilen). Test: Fokusring >= 3:1 gegen Papier, Seite, Karte, Hover und Auswahl in allen 7 x 9 Schema/Akzent-Kombinationen (`darstellung.spec.mjs`). Orange/Bernstein hell sind unverändert und erreichen die Grenzen.
- **Kleiner Text:** Zweit- und Drittext >= 4,5:1 auf allen fünf Flächen (hell Standard Drittext `#6b6b6b`, Papier `#6a6053`, dunkel Standard `#939393`, Graphit `#a4a5aa`, Mitternacht `#9198b6`). Der Drittext unterscheidet sich damit kaum noch vom Zweittext; Symbole und Linien nehmen `--linie`/`--grau`. Fotos zeigen die dunklere Optik.
- **Bereiche:** F6 / Umschalt+F6 (Seitenleiste, Liste, Editor oder Board, Info oder Frag); ausgeblendete Bereiche werden übersprungen. Linke Seitenleiste ein/aus mit Control+Command+S und Knopf links in der Kopfzeile (Zustand bleibt). Hell/Dunkel: Option+Command+L. Alle im Register, in Palette und Kürzelhilfe. Neu: F-Tasten brauchen keinen Umschalter (`brauchtUmschalter`).
- **Esc als ein Stapel** (`tastatur.js`): Popover/Menü und Dialog schließen sich zuerst selbst, danach Format-Leiste, Verlauf, Frag, Suche, Textauswahl; jede Taste schließt genau eine Schicht, auch wenn der Fokus nicht im Panel liegt. Frag und Verlauf setzen den Fokus hinein (auch ohne KI-Konto) und geben ihn an den Auslöser zurück; Mitteilungen geben ihn an die Glocke zurück.
- **Kürzelhilfe** erzeugt sich aus dem Register (alle Gruppen) plus feste Tasten (Liste, F2, Command+Rücktaste, Board).
- **Tooltips:** `bewegung.js` nimmt jedes `title` (auch später gesetzte) weg und zeigt den eigenen Tooltip aus `data-tipp-text`; der zugängliche Name bleibt (`aria-label`). Test: in allen Hauptansichten kein sichtbares Element mit `title`. Ausnahmen: eigenständige Modulseiten der Tests ohne `app.js` (dort bleibt `title`), Menüeinträge (`.menue`, `.bs-liste`) zeigen keinen Tooltip.
- **Tests:** neu `Tests/Oberflaeche/tastatur-fokus.spec.mjs` (F6-Reihenfolge, Seitenleiste, Hell/Dunkel, Esc-Matrix mit 8 Flächen, Stapelreihenfolge, Fokus-Rückgabe, Tab-Lauf mit sichtbarem Fokus, kein natives `title`); bestehende Specs auf `data-tipp-text` bzw. neue Werte umgestellt.
- **Offen:** Command-Control-S/F6 auf Windows/Linux (Strg gilt dort als Command): im Register änderbar, nicht auf echter Hardware geprüft; Mac-Menüeintrag für die neuen Befehle fehlt (kein `menue`-Name, nur Studio); Orange/Bernstein hell weiter Entscheidung 2.

## Stand R4-7 (Schmale Fenster und Split View)

Gebaut auf Branch `feat/r4-schmale-fenster`. **Entscheidung 4 = Ja umgesetzt:** Mindestgröße von Mac-App (`StudioFenster.minimum`) und Electron (`minWidth/minHeight`) einheitlich **720 × 520**; Swift-Tests angepasst. Fotos (Scratchpad der Sitzung): `r47-<fläche>-<breite>[-dunkel].png` für Liste, Editor, Posteingang, Aufgaben, Frag, Einstellungen bei 1440/1024/820/720/600 px, dazu `r47-seite-ueber-*`, `r47-info-ueber-*`, `r47-wechsel-liste-600`, `r47-kopf-menue-600`.

**Stufen** (nur aus der Fensterbreite, `begrenzeBreiten` in `app.js`, Stil in `schmal.css`; Attribute `data-seite`, `data-info-ueber`, `data-wechsel` am `#app`):
- **< 960 px** Seitenleiste nicht mehr in der Reihe, sondern Überlagerung (Knopf links in der Kopfzeile oder ⌃⌘S; Esc, Klick daneben, ein gewähltes Ziel oder F6 schließen sie; Fokus geht beim Öffnen hinein, beim Schließen an den Knopf). Die gespeicherte Ein/Aus-Wahl für breite Fenster bleibt unberührt. Ausgeblendet ist sie `inert` (nicht per Tab erreichbar). Die Kopfzeile lässt links Platz für die Ampel, wenn keine Seitenleiste in der Reihe steht.
- **< 1256 px** Eigenschaften klappen ein (wie bisher); der Knopf (⌥⌘I) öffnet sie jetzt als **Überlagerung** rechts statt den Editor zu quetschen (Esc schließt). Der Editor ändert dabei weder Breite noch Lage. (Der Plan nannte 1 100 px; die tatsächliche Grenze folgt aus „Editor ≥ 560 px neben Eigenschaften“.)
- **< 680 px** Liste und Editor im **Wechsel**: ohne offene Notiz die Liste, mit Klick/Enter/Palette/Link der Editor; „Notizen“ links in der Kopfzeile bringt die Liste zurück (Fokus in die Liste). Pfeiltasten in der Liste wählen aus, ohne den Editor nach vorn zu holen. Bei 720 px stehen Liste (248) und Editor (472) nebeneinander.
- **Kopfzeile < 660 px Inhaltsbreite (Fenster ≈ 690 px):** Werkzeuge der Notiz und Verlauf wandern in ein Überlauf-Menü „…“ (Favorit, Rohtext, Breiter Text, Gliederung, Verlauf).
- **Aufgaben-Board:** scrollt waagerecht, die Kante läuft zur Scrollrichtung aus (`data-kanten-x`, `bewegung.js/css`); der Hinweis „Noch keine Aufgaben“ füllt die Fensterbreite (war bei 600 px rechts abgeschnitten).

**Gemessen** (`Tests/Oberflaeche/schmale-fenster.spec.mjs`, Chromium headless): 6 Flächen × 5 Breiten × hell/dunkel = 60 Messungen (kein Element über dem Rand, kein Behälter mit breiterem Inhalt, Kopfzeilenteile überlappen nicht, `scrollWidth == innerWidth`, Editor ≥ 420 px), Seitenleiste/Eigenschaften/Wechsel/Kopf-Menü per Tastatur, Hauptflächen bei 720 px, und ein Sweep 1440 → 600 → 1440 in 8-px-Schritten (kein Überstand in keinem Schritt, ≤ 4 Stufenwechsel, innerhalb einer Stufe wächst der Editor genau mit dem Fenster, Hin- und Rückweg gleich = keine Schwingung). Vorher: bei 600 px Editor rechts abgeschnitten (Kopfzeile 678 > 600 px, Hinweis im Board).

**Offen:**
- WebKit (WKWebView) und die echte Mac-Hülle nicht geprüft (Glas-Seitenleiste als Überlagerung ist mit deckendem Grund unterlegt, aber ohne echte App ungesehen; Ampel-Platz nur per CSS-Variable).
- Die Stufengrenzen springen beim Ziehen an der Grenze (Spalte erscheint/verschwindet sofort, kein Gleiten beim Ziehen – gewollt, wie bei der rechten Spalte).
- In der Wechsel-Ansicht gibt es kein eigenes Kürzel für „Notizen“ (nur Knopf/Tab); F6 überspringt die ausgeblendete Liste.

## Stand R4-2 (Editor-Darstellung vollständig)

Gebaut auf Branch `feat/r4-editor-darstellung`. Fotos (Scratchpad der Sitzung): `r42-callouts-{hell,dunkel}.png`, `r42-callouts-cursor-{hell,dunkel}.png`, `r42-code-{hell,dunkel}.png`, `r42-neue-notiz-{hell,dunkel}.png`, `r42-tabelle-tastatur-{hell,dunkel}.png`, `r42-bild-tastatur-{hell,dunkel}.png`.

- **Callouts** (`callout-logik.js` rein und in Node getestet, `editor-callouts.js` für den Editor): `> [!typ] Titel` mit den 13 Obsidian-Arten und ihren Aliassen (summary, tldr, hint, important, check, done, help, faq, caution, attention, fail, missing, error, cite; dazu deutsche Schreibweisen wie `tipp`, `hinweis`, `warnung`); unbekannter Typ = Notiz mit dem Typ als Titel; ohne Titel steht der deutsche Name der Art. Farbiger Kasten mit Symbol (Farben je Art in `editor-darstellung.css`, hell und dunkel), Pfeil rechts bei `-`/`+`. Falten per Klick auf Symbol oder Pfeil und per Tastatur (Mod-Alt-[ zu, Mod-Alt-] auf); zugeklappt versteckt den Rumpf atomar (wie der Datei-Kopf), der Zustand `-`/`+` bleibt der Anfangszustand, ein Klick tauscht ihn nur in der Sitzung. Am Cursor zeigt nur die Cursor-Zeile den Rohtext; die Zitatmarken `>` der Folgezeilen sind unsichtbar statt entfernt, darum bewegt sich nichts (Test: |Δy| = 0 für Kopf, Rumpf, ohne Titel, zugeklappt, in Liste, beide Schemata). Callouts in Listen laufen mit, in Zitaten geschachtelte bleiben Zitat.
- **Code-Blöcke** (`editor-code.js`): Zäune stehen nur in der Cursor-Zeile (sonst leere Zeile, Höhe gleich), oben rechts Sprachmarke und Kopier-Knopf (kopiert den Code ohne Zäune, auch bei offenem Zaun; mit `aria-label`, Tooltip, Häkchen als Rückmeldung). Farben nur im Code der Zäune (Markdown-Text bleibt unberührt), als CSS-Klassen `.syn-*` mit Variablen: Schlüsselwort, Zeichenfolge, Zahl, Kommentar, Funktion, Definition, Eigenschaft, Typ, Tag, Operator. Test: alle Farben ≥ 4,5:1 auf `--seite` in allen 7 Schemata. Sprachen: js/ts/jsx/tsx, json, py, sh/bash/zsh, swift, yaml, html/xml, css, sql, md; jede als eigene Datei, die erst beim ersten Block dieser Sprache geladen wird (Höhe vor/nach dem Nachladen: Δ ≤ 1 px).
- **Bündel:** `Werkzeuge/editor-bundle` baut jetzt mit `--splitting`: `codemirror.bundle.js` (47 KB) plus gemeinsame Teile und Sprachdateien `vendor/sprache-<Kennung>.js` (die Kennung ändert sich bei jedem Neubau; das Bauskript löscht die alten). Der Start lädt `codemirror.bundle.js` plus 6 gemeinsame Dateien = 611 938 B (vorher 598 172 B), denn lang-markdown zieht lang-html, -css und -js fest mit; alle Dateien zusammen 712 KB (+114 KB gegenüber dem alten Bündel, Grenze +150 KB eingehalten). Lädt eine Sprach-Datei nicht, liefert `sprachen.js` einmalig eine einfarbige Ersatzsprache (keine Dauerabfragen). `THIRD-PARTY-NOTICES.md` und `vendor/DRITTANBIETER.md` nennen die neuen Pakete, `lizenzen.test.mjs` nimmt `sprache-*.js` unter dem Sammelnamen an. **Beim Merge mit R4-4 (`isolateHistory`):** Quellen zusammenführen (`einstieg.js`, `package.json`, `package-lock.json`), dann `npm run bauen` im Ordner; die erzeugten `vendor/*.js` nie von Hand mischen.
- **Neue Notiz:** eine leere Titelzeile `# ` zeigt den Platzhalter „Titel“ statt des nackten „#“ (auch mit dem Cursor in der Zeile; der Text bleibt `# `). Die Info-Spalte einer noch nicht gespeicherten Notiz zeigt „Neue Notiz“, Ordner und „Noch nicht gespeichert“ statt „Wähle links eine Notiz“.
- **Tabelle und Bild per Pfeiltasten (offener Punkt aus R4-1):** Pfeil ab/rechts in eine Tabelle setzt den Fokus in die erste Zelle, Pfeil auf/links in die letzte Zeile; die Tabelle bleibt ein Gitter. Bild und Anhang-Chip sind atomar: Pfeiltasten hüpfen darüber, der Rohtext `![[…]]` erscheint nur, wenn der Cursor MITTEN in der Schreibweise steht (Klick, Suchsprung; Rohtext-Modus immer). Gemessen: Δy 0 px für Tabelle (von oben und unten) und Bild (von oben und unten), beide Schemata (vorher −20 / +37,8). Rücktaste hinter dem Bild löscht die ganze Einbettung (⌘Z holt sie zurück).
- **Härtung (Review):** ein zugeklapptes Callout verliert nie unsichtbar Text (Entf/⌥⌦/Auswahl-Löschen am Kopfende wird verworfen und klappt auf, Test mit Datei bytegleich); die leere Titelzeile klemmt den Cursor hinter das unsichtbare „#“; Kopier-Knopf und Falt-Pfeil sind per Tastatur (Tab, Enter, Leertaste) bedienbar und bei Fokus sichtbar; `Tests/Node/editor-buendel-importe.test.mjs` prüft alle Importe des Bündels und die Auslieferung über den Werkstatt-Handler; `editor-darstellung-haertung.spec.mjs`.
- **Schrägstrich-Menü:** neuer Eintrag „Callout“ (Gruppe Blöcke, setzt `> [!note] ` mit dem Cursor im Titel).
- **Text bleibt:** `editor-darstellung.spec.mjs` prüft, dass der Dokumenttext und die Datei nach Falten, Kopieren, Pfeiltasten und Rückgängig byte-gleich sind (CRLF, Umlaute, Callout in Liste und Zitat).
- Tests: `Tests/Oberflaeche/editor-darstellung.spec.mjs` (17), `Tests/Node/callout-logik.test.mjs`; `schraegstrich.spec.mjs` kennt den neuen Eintrag.

**Offen / bewusst nicht in R4-2:**
- Rohtext eines Bildes oder Anhangs (Breite `|300`, Alt-Text) ist nur noch per Klick/Suchsprung in die Schreibweise oder im Rohtext-Modus erreichbar, nicht mehr per Pfeiltaste (Preis für 0 px).
- Callouts in Callouts und Callouts in Zitaten werden nicht verschachtelt gezeichnet (bleiben Zitat); ein zugeklapptes Callout lässt sich nur per Klick, Mod-Alt-] oder Rohtext-Modus öffnen.
- Neue Sprachen (z. B. Rust, Go, PHP) fehlen: der Block bleibt einfarbig; eine Zeile in `Werkzeuge/editor-bundle/sprachen.js` plus Neubau genügt.
- Playwright-WebKit lief hier nicht (siehe R4-1); die CI-Läufe der Spec sind Chromium.

## Stand R4-6 (Politur: Liste, Suche, Texte, Tooltips)

Gebaut auf Branch `feat/r4-politur`. Fotos (Scratchpad der Sitzung): `r46-vorher-*.png` und `r46-nachher-*.png` (je hell, dunkel mit Endung `-dunkel`) für `liste`, `liste-hover`, `info-leer`, `suche`, `palette`, `einst`, `einst-darstellung`, `einst-codeschrift-offen`, `einst-ki`; dazu `r46-nachher-tooltip-menue-*`, `r46-nachher-code-schrift-<schema>`.

- **Notizkarte:** ein Datum je Karte (das der gewählten Sortierung: „Geändert“ als Datum, „Erstellt“ mit Wort); das Dokument-Symbol steht nur noch bei einer Notiz mit Typ (gilt auch für Suchtreffer); die Hover-Aktionen im Posteingang liegen jetzt auf freier Fläche (rechts neben dem einen Datum).
- **Ordnerzeilen:** Ordner ohne Unterordner standen 24 px weiter links, weil die Klasse `leer` des unsichtbaren Pfeils mit der allgemeinen Klasse `.leer` (Leerzustand: Breite 64 px, absolut) kollidierte. Neue Klasse `ohne` (Seitenleiste und Tag-Baum); alle Symbole stehen in einer Spalte (Test).
- **Seitenleiste:** „Schnell erfassen“ wird nicht mehr zu „Schnell er…“ gekürzt: in der schmalen Seitenleiste fällt das Wort „Leertaste“ im Kürzel weg (⌃⌥ ␣), voll im Tooltip.
- **Suche:** `suche-text.js` (rein, in Node getestet) entfernt Wikilinks (`[[Ziel#Abschnitt|Alias]]` → Alias), `![[…]]`, Links, `**`/`__`/`~~`/`==`/`*`/`_`/`` ` ``, Überschrift-Rauten, Zitat- und Listenzeichen aus Fundstellen (Ansicht und ⌘K) und rechnet die Treffer-Marken auf den bereinigten Text um (Marke auf einem Zeichen, das wegfällt, entfällt). ⌘K „Im Inhalt“: Treffer mit mehr verschiedenen Suchwörtern (Titel und Fundstellen) stehen vorn, sonst bleibt die Reihenfolge der Werkstatt.
- **Tooltips:** Die R4-3-Ausnahme „Menüeinträge zeigen keinen Tooltip“ ist weg: ein Eintrag in `.menue`/`.bs-liste` zeigt den Tooltip, wenn sein Text gekürzt ist (oder ein Hinweis gesetzt ist), neben dem Menü statt über den Nachbarn. Der Title-Beobachter überspringt alles in `.cm-editor`; die Editor-Bausteine (Anhänge, Tabellen-Plus, Signalpunkt) setzen `data-tipp-text` selbst statt `title`. Gemessen beim Tippen (55 Zeichen, `politur.spec.mjs`): Tipp-Latenz Median 17 ms / p95 17–18 ms – gleich wie vorher (17/17, begrenzt vom Bildtakt); Beobachter-Läufe 53, davon nur Statusleiste (Wörter, Speicherstand), der Editorbaum wird übersprungen und kostet < 15 ms im Beobachter insgesamt. Test: kein `[title]` im Dokument nach dem Öffnen einer Notiz.
- **Dunkel-Fehler gefunden und behoben (vermutliche Ursache des „hellgrauen Blocks“):** `schemata.css` setzte `:root, [data-pal]` auf die hellen Werte – auch auf die Palette-Einträge von ⌘K, die `data-pal="notiz|befehl|…"` als Art tragen. Im dunklen Schema war der gewählte Eintrag dadurch ein weißer Balken mit hellem Text. Jetzt `:not(:where(.pal-eintrag))` (Spezifität unverändert). Die Code-Schrift-Auswahl ist schon der eigene `auswahl()`-Baustein; Test über alle 7 Schemata (Hintergrund hell/dunkel, `appearance: none` ergänzt, damit WebKit keinen nativen Knopf darunter legt). In Chromium war der Knopf vorher nicht hellgrau; echtes WebKit nicht geprüft.
- **Texte:** Info-Spalte ohne Notiz: Symbol, „Keine Notiz offen“ und ein Satz statt „Wähle links eine Notiz“; „/ingest“ weg („…Als Wissen zählt sie erst, wenn sie ins Wissen übernommen wurde“); „Unverlinkte Erwähnungen“; Update-Hinweis je Hülle (Mac-App: Menü „Kortex“, Electron: Menü „Ablage“, Browser: „keine eigenen Updates“) statt „Rechner: Menü …“; Einstellungen: Dateinamen in der Statuszeile und zweiter Hinweis „Änderungen gelten sofort“ entfallen (es bleibt „Einstellungen werden sofort gespeichert“); Kachel „0 von 0 Konten angemeldet“ → „– · Noch kein Konto“, „0 brauchen deine Anmeldung“ → „0 · Anmeldungen offen“; Browser-Modus: der Hinweis „Kortex startet den Hintergrunddienst neu“ gilt nur noch in App und Electron, im Browser steht „…antwortet nicht, Kortex versucht es weiter“.
- **Lokale Posteingang-Vorschläge („ohne KI“):** geprüft, **Regel und kein Fehler**: Vorschläge gibt es nur für gleichen Titel (Duplikat), genannten Notiztitel (Verlinken) und Tag = Ordnername (Verschieben), und nur gegen Notizen, die auch die KI bearbeiten dürfte (`kiOrtErlaubt`: Wiki, Archiv, Vorlagen, Aufgaben sind nie Ziel). „Link-Sammlung Espresso“ bekommt keinen Vorschlag, wenn „Espresso“ und „Kaffee“ im Wiki liegen; „Kaffee Gedanke …“ nennt keinen Titel vollständig. Unverändert.
- **Tests:** `Tests/Oberflaeche/politur.spec.mjs` (12 Läufe hell + dunkel: Liste, Info, Suche und Palette, Tooltips, Tippen im Editor, Einstellungen, Texte ohne „null/undefined“), `Tests/Node/politur-texte.test.mjs` (Markdown-Entfernung, Marken, Abdeckung, verbotene Begriffe in `texte*.js` außer `texte-verlauf.js`).

**Offen / bewusst nicht in R4-6:**
- Akzentfarben Orange/Bernstein im hellen Schema (Entscheidung 2 steht aus, eigener kleiner Schritt).
- `texte-verlauf.js` („Commit“, Hashes) gehört zu R4-4 und ist von der Wortprüfung ausgenommen.
- Der Ersatz „␣“ für „Leertaste“ in der schmalen Seitenleiste ist ein Zeichen aus der Systemschrift; auf echtem Mac ungesehen.
- Aufgaben-Board: die vierte Spalte neben Frag wird seit R4-7 waagerecht gescrollt (Kantenschatten); kein weiterer Hinweis ergänzt.
