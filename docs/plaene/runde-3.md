# Runde 3 – Pakete

Jedes Paket hat eigene Module und fasst `editor.js`, `app.js` und die Seitenleiste nur an wenigen, kleinen Stellen an. Wer als Zweiter merged, führt vorher `git merge origin/main` aus.

## Paket 3c – Tags und Export/Teilen

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
