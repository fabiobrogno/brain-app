# Runde 3: Funktionslücken im Editor

Stand: 07.11.2026 · gemeinsamer Plan der vier parallelen Pakete. Jede Seite gehört dem Paket, das sie schreibt; Fremdes nur ergänzen, nicht umschreiben.

## Hintergrund

Die Funktionsprüfung (Vergleich mit Obsidian, Bear, Craft) zeigt Lücken, die Nutzer dort als selbstverständlich erwarten: Bilder und Anhänge,
Tabellen, Fett/Kursiv per Tastatur, eingefügtes HTML als Markdown, Tags mit Ansicht, Export und Teilen, unverlinkte Erwähnungen und eine
Übersicht „Was ist neu“. Runde 3 schließt diese Lücken in vier Paketen, die unabhängig voneinander gebaut und gemergt werden.

| Paket | Inhalt | Eigene Module (Ziel: wenig Streuung in `editor.js`) |
|---|---|---|
| 3a | Bilder und Anhänge | `gemeinsam/anhaenge.mjs`, `werkstatt/anhaenge.mjs`, `studio/editor-anhaenge.js`, `studio/anhaenge.js` |
| 3b | Tabellen, ⌘B/⌘I, HTML beim Einfügen als Markdown | eigene Editor-Module |
| 3c | Tags (Ansicht, Umbenennen), Export, Teilen | eigene Module |
| 3d | Unverlinkte Erwähnungen, Karte „Was ist neu“ | eigene Module |

Alle vier berühren `editor.js` (Erweiterungsliste in `erstelleEditor`). Regel: je Paket eine einzeilige Einhängung dort, die Logik liegt im
eigenen Modul. Wer später merged, holt `origin/main` und löst nur diese Zeilen auf.

## Später: KI-Vorschläge (nicht in Runde 3)

Zwei Ideen, die auf Runde 3 aufbauen, aber noch nicht gebaut werden:

- **Vorschlagskarten im Posteingang:** die KI schlägt vor (Tags, Verknüpfungen, Zusammenfassung, Ablageort), der Nutzer übernimmt oder verwirft.
- **Editor-Aktionen als Diff:** „Kürzen“, „Gliedern“, „Korrigieren“ zeigen das Ergebnis als Unterschied zum Text; erst „Übernehmen“ schreibt.

Grundsatz: **Die KI handelt nie, sie schlägt nur vor.** Jede Wirkung geht über eine sichtbare Bestätigung des Nutzers, jede Änderung ist rückgängig
(Fassungen, Papierkorb). Risiko **Prompt-Injection aus Notizinhalt:** Text einer Notiz (auch aus dem Web eingefügt, aus Anhängen oder PDFs) kann
Anweisungen an die KI enthalten. Darum gilt: Notiztext ist Daten, nie Anweisung; Vorschläge sind reiner Text/Diff ohne Aufrufe von Werkzeugen mit
Wirkung; Links und Bilder in KI-Antworten werden nie von außen geladen (das tut schon `frage-markdown.js`, und Paket 3a erweitert es nur um lokale Bilder).

---

## 3a: Bilder und Anhänge

### Ziel
Bilder und Dateien lassen sich in eine Notiz einfügen (Zwischenablage, Ziehen aus Finder/Explorer, Ziehen aus dem Browser), erscheinen im Editor
und in „Frag deinen Vault“ als Bild bzw. als Chip und überstehen Umbenennen, Verschieben und Löschen.

### Entscheidungen
- **Format: `![[datei.png]]`** (Obsidian-kompatibel; Wikilink-Einbettung). Der Name ist im Vault eindeutig, deshalb löst Kortex ihn über den Dateinamen auf
  (zuerst Ordner der Notiz, dann Anhänge-Ordner, dann überall im Vault), und Verschieben einer Notiz bricht nichts. Weiter gelesen werden
  `![Alt](relativer/pfad.png)` und `![[ordner/datei.png]]` (die Link-Pflege schreibt sie beim Umbenennen/Verschieben schon um).
- **Ablage:** Einstellung „Anhänge-Ordner“ (`anhaengeOrt`): `vault` (Standard, `_anhaenge/` an der Wurzel des Vaults) oder `notiz`
  (`_anhaenge/` im Ordner der Notiz). Der Ordnername ist einstellbar (`anhaengeOrdner`).
- **Namen:** `JJJJ-MM-TT-HHMMSS-<slug>.<endung>`; der Slug kommt aus dem Namen der Datei (bei Einfügen aus der Zwischenablage „bild“), die Endung aus dem
  geprüften Typ, nicht aus dem Namen. Belegt = Zähler `-2`; geschrieben wird exklusiv (`wx`), nie überschrieben.
- **Grenzen:** größte Größe einstellbar (Standard 20 MB, höchstens 100 MB); Hinweis mit Größe. Erlaubte Typen für die Anzeige im Text: png, jpg, gif, webp,
  svg; weitere harmlose Dokumente (pdf, office, txt, csv, zip, Audio/Video) nur als Chip. Ausführbares und aktive Inhalte (html, js, exe, app, sh, bat …) werden abgelehnt.
  Der Typ wird am Inhalt geprüft (Kennung der Bytes), nicht am Namen.
- **SVG:** wird beim Speichern bereinigt (keine Skripte, kein `foreignObject`, keine `on…`-Attribute, keine Adressen nach außen) und im Editor nur als `<img>` gezeigt;
  die Werkstatt liefert Anhänge mit `Content-Security-Policy: sandbox`.
- **Externe Bilder** (`![](https://…)`): nie geladen, außer die Einstellung „Externe Bilder laden“ (Standard aus) ist an oder der Nutzer klickt auf den Platzhalter
  (nur dieses Bild, nur diese Sitzung). Geladen wird über die Werkstatt (`/_extern-bild`): nur https, keine privaten Adressen, Größe und Typ begrenzt;
  die Seite bleibt bei `img-src 'self'`.
- **Löschen einer Notiz:** gibt es Anhänge, die nur diese Notiz benutzt, fragt Kortex, was damit geschehen soll (mit löschen = Papierkorb, behalten). Nie direkt löschen.
- **Hülle:** neue Aktion `anhang-oeffnen` im Vertrag (System-App öffnet PDF/Dokument). Dateien aus der Zwischenablage und per Ziehen kommen als DOM-Ereignis
  (`File`); das Studio schickt sie in Stücken über die Werkstatt (der Nachrichtenkanal der Mac-App ist auf 8 MB je Anfrage begrenzt).

### Prüfkriterien (fertig, wenn)
1. Node-Tests grün: Speichern (Pfad, Ort, Ordner), Namen (Slug, Zähler, keine Überschreibung), Typprüfung und Größe, SVG-Bereinigung, Auflösen, Umbenennen/Verschieben,
   unbenutzte Anhänge beim Löschen, externe Bilder (SSRF-Schranken).
2. Playwright grün: Einfügen und Ziehen eines Bildes und einer PDF, Anzeige im Editor, Lightbox, externes Bild mit Platzhalter, hell und dunkel; Bilder im Scratchpad.
3. Hüllen-Vertrag (JSON, Swift, Electron, Browser) nennt `anhang-oeffnen`; die Tests dazu sind grün.
4. `ci-ok` einschließlich Linux- und Windows-Bahnen grün.

### Risiken
- **Mac-App (WKWebView):** Einfügen von Bildern und Ziehen aus dem Finder liefert normalerweise `File`-Objekte; das ist hier nur im Browser/Chromium geprüft, nicht im echten
  Fenster. Ein Dateiwähler (`<input type=file>`) geht in WKWebView erst mit einem `WKUIDelegate`; das gibt es in der App heute nicht. Darum: kein Dateiwähler in 3a, ehrlicher Hinweis, wenn das Einfügen nichts liefert.
- **Eindeutigkeit der Namen** gilt nur für Dateien, die Kortex anlegt; selbst abgelegte gleichnamige Dateien löst die feste Suchreihenfolge auf.
- **Speicher beim Hochladen** (Stücke liegen bis zum Ende im Speicher der Werkstatt): Obergrenze = Größengrenze, Sitzungen verfallen nach 2 Minuten.
- **Mehrere Fenster/Geräte:** Anhänge sind normale Dateien im Vault und laufen mit Git und Abgleich; große Bilder blähen das Repo auf (Hinweis ab 5 MB).

---

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

## 3c: Tags und Export/Teilen

### Ziel
Tags (`#tag`, Frontmatter) haben eine Ansicht, lassen sich umbenennen und filtern; eine Notiz lässt sich als Markdown, PDF oder HTML exportieren und teilen.
### Prüfkriterien
Tag-Umbenennen ändert alle Notizen atomar mit Vorschau; Export enthält eingebettete Bilder (nutzt die Auflösung aus 3a) und gibt nichts Fremdes weiter.
### Risiken
Export von Bildern und Anhängen hängt an der Auflösung von 3a (`gemeinsam/anhaenge.mjs`); Teilen darf nichts ohne Zustimmung nach außen senden.

## 3d: Unverlinkte Erwähnungen und „Was ist neu“

### Ziel
Eine Notiz zeigt, wo ihr Titel in anderen Notizen vorkommt, ohne verlinkt zu sein (Übernehmen = Link setzen), und eine Karte „Was ist neu“ fasst
Änderungen seit dem letzten Besuch zusammen.
### Prüfkriterien
Erwähnungen ohne Treffer in Code, Links und Kopf; Übernehmen ändert genau eine Stelle (rückgängig); die Karte zeigt nur, was wirklich geändert wurde.
### Risiken
Rechenzeit in großen Vaults (Index, Grenzen); Fehltreffer bei kurzen Titeln.

## 3c im Detail: Tags und Export/Teilen

### Tags

**Regel (eine Stelle: `Ressourcen/gemeinsam/tags.mjs`)**: Seitenleiste, Vervollständigung, Suche (`tag:`), MCP und Umbenennen benutzen dieselbe Erkennung.

- Quelle: Front-Matter (`tags`, `tag`, `schlagworte`, `keywords`; Liste, Blockliste oder Text, `#` erlaubt) und Inline-`#tag`, auch verschachtelt (`#projekt/atlas`).
- Zeichen: Buchstaben (Unicode), Ziffern, `_`, `-`, getrennt durch `/` ohne leere Teile; nie nur Ziffern (`#123` ist kein Tag, `#2024-plan` schon). Vor dem `#` steht Zeilenanfang, Leerraum oder `( , ;`.
- Nicht gezählt: Code-Zäune (` ``` `, `~~~`), Code in Backticks, Überschriften, Links, URLs, `[[Wiki#Abschnitt]]`, HTML, Kommentare, `\#`. Eingerückter Code (4 Leerzeichen) zählt mit, weil dieselbe Einrückung auch Listeninhalt ist.
- Groß/klein ist egal; angezeigt wird die häufigste Schreibweise. Ein verschachtelter Tag zählt auch für seine Eltern (`direkt` = genau dieser Tag, `anzahl` = mit allem darunter).
- Nicht gelesen werden generierte Dateien, Punkt-Ordner und Unter-Vaults (für KI-Konten).

**Oberfläche (`tags.js`, `tags-quelle.js`, `texte-tags.js`, `tags.css`)**: Bereich „Tags“ in der Seitenleiste mit Zählern und Baum; Klick = Filter der Notizliste (Sicht `tag`); Rechtsklick: Notizen zeigen, in der Suche zeigen (`tag:…`), umbenennen. `#` im Editor öffnet die Vervollständigung (nicht in Überschriften, Code, Links, Datei-Kopf). ⌘K: `#proj` oder `tag:` zeigt nur Tags; ein längeres Wort ergänzt bis zu vier Tags hinter den Notizen.

**Umbenennen (`dateiaktionen.mjs`, `tagUmbenennen`)**: wie „Umbenennen mit Link-Pflege“: Vorschau (Stellen, Notizen, Liste, Hinweis „wird zusammengeführt“) → Ausführen mit Token (409 bei veraltetem Stand) → alle Notizen atomar mit Hash-Prüfung → **ein** Vorgang im Journal und **ein** Eintrag im Verlauf → Rückgängig/Wiederholen über `POST /api/aktivitaet/rueckgaengig`. Geschützte, generierte und mehrfach verknüpfte Notizen bleiben unberührt und werden in der Vorschau genannt.

**Werkstatt**: `GET /api/tags` (`{tags, notizen, zuordnung}`), `GET /api/tags/notizen?tag=`, `POST /api/tags/umbenennen { alt, neu, vorschau?, token? }`.

**MCP**: `brain_tags` (nur lesend, Mindeststufe „lesen“, zentrale Stufenprüfung): ohne Argument die häufigsten Tags mit Zahl, mit `tag` die Notizen dazu. Die Werkzeugliste bleibt unter der Grenze von `token-budget.test.mjs` (andere Beschreibungen wurden gekürzt).

### Export und Teilen

**Bündel (`gemeinsam/export.mjs`, `POST /api/export`)**: `format` = `markdown` (Notiz als `.md`, Bilder als Dateien unter `bilder/<Kurzhash>-<Name>`, Verweise umgeschrieben; mehrere Notizen/Ordner als Ordnerstruktur mit gemeinsamem `bilder/`), `html` (eine eigenständige Datei: Styles, Schrift Geist und Bilder als `data:` eingebettet, helles Drucklayout, bei mehreren Notizen mit Inhaltsverzeichnis) oder `fragment` (Körper für „formatiert kopieren“). `zip: true` baut ein ZIP (für den Browser). Rohes HTML aus der Notiz wird nie übernommen, Links nur `http(s)`/`mailto`/`#`, Netzbilder und Bilder außerhalb des Vaults (auch per Symlink) nie geladen. Nichts wird hochgeladen; geschrieben wird nur über die Hülle.

**Hüllen (Vertrag `huellen-vertrag.json`)**

| Aktion | Mac-App (Swift) | Electron | Browser |
|---|---|---|---|
| `export-speichern` | `NSSavePanel` als Sheet, `ExportBuendel.schreibe` | `dialog.showSaveDialog`, `export-schreiben.mjs` | Download (mehrere Dateien als ZIP) |
| `export-pdf` | `WKWebView` (kein JavaScript, kein Netz) + `createPDF`, A4-Seiten mit PDFKit zusammengesetzt | verstecktes Fenster, nur die Temp-Datei erreichbar, `printToPDF` (A4, `@page`) | Druckansicht des Browsers („Als PDF sichern“), so beschriftet |
| `teilen` | `NSSharingServicePicker` mit einer `.md`-Datei im Temp-Ordner | nicht verfügbar | nicht verfügbar |

Schreiben ist streng: nur relative Pfade ohne `..` und ohne versteckte Teile, höchstens 2000 Dateien und 96 MB, nie durch einen Symlink und nie aus dem gewählten Ort heraus; Texte (`.md .html .pdf .zip`) werden ersetzt (der Dialog hat bestätigt), Bilder nur, wenn sie fehlen.

**Oberfläche (`export.js`)**: Kontextmenü von Notiz und Ordner (auch im Titel des Editors) und ⌘K: „Exportieren …“, „Als Markdown kopieren“, „Formatiert kopieren“ (`text/html` und `text/plain`), „Teilen …“ (nur wo die Hülle es kann). HTML und PDF folgen der gewählten Schrift der Darstellung, aber mit hellem Drucklayout.

Bekannte Grenze: die Mac-App schneidet das PDF nach Seitenhöhe, nicht nach Absatz (`createPDF` liefert nur Ausschnitte); Electron bricht sauberer um.

### Prüfung

Node: `tags.test.mjs`, `export.test.mjs`, `export-huelle.test.mjs`; Swift: `ExportBuendelTests` (Prüfung, Schreiben, Symlinks, echtes PDF); Playwright: `Tests/Oberflaeche/tags-export.spec.mjs`; Electron: Test „Export“ in `electron/test/huelle.spec.mjs` (echtes `printToPDF`).
