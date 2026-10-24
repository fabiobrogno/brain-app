# Brain

**Ein Editor für dein Wissen, der weiß, was davon stimmt, und deine KI arbeitet direkt mit.**

Brain ist eine Mac-App für einen Ordner mit Markdown-Notizen. Zu jeder Seite zeigt sie, ob sie belegt, abgelaufen,
strittig oder noch ungeprüft ist. Der Ordner bleibt die einzige Wahrheit: Brain liest und schreibt nur normale Dateien
und erhält deinen Text Byte für Byte.

> **Frühe Version.** Brain ist jung und wird noch viel angefasst. Ecken und Fehler sind wahrscheinlich.
> Dein Ordner liegt in Git, sodass du Änderungen jederzeit zurückholen kannst. Eine Sicherung ersetzt das trotzdem nicht.

## Funktionen

- **Editor** mit Markdown-Live-Vorschau, `[[Wikilinks]]`, automatischem Speichern und Befehlspalette (⌘K)
- **Prüf-Signale** je Seite: belegt, abgelaufen, strittig, ungeprüft
- **Git eingebaut:** Änderungen ansehen, auswählen und committen, Verlauf mit Vergleich, alte Fassung wiederherstellen,
  Abgleich mit deinem eigenen Git-Remote (Konflikte werden erklärt, nichts wird still überschrieben)
- **Suche** über alle Seiten, **Schnell merken** in die Inbox
- **Lokale KI-Anbindung per MCP:** Claude Code, Codex, Cursor und andere lesen dein Wissen mit Quellen und legen Merkzettel
  ausschließlich in die Inbox ab, nie direkt ins Wiki
- **Kein Server, keine Kosten, keine Telemetrie**

## Voraussetzungen

- **Nur Apple Silicon (arm64: M1 oder neuer)** — Intel-Macs werden nicht unterstützt
- macOS 26 oder neuer
- Git (bei den Xcode-Kommandozeilentools dabei: `xcode-select --install`)

## Installation

1. Die neueste `Brain-<Version>.dmg` (nur Apple Silicon, arm64) unter **Releases** laden.
2. Öffnen und **Brain** auf **Programme** ziehen.
3. Starten und ein neues Brain anlegen oder einen vorhandenen Ordner verbinden.

Die App ist von Apple geprüft (notarisiert) und aktualisiert sich selbst, sobald die Update-Funktion eingebaut ist.

## Mit Claude Code verbinden

Brain bringt einen lokalen MCP-Server mit (Standard-Ein-/Ausgabe, kein Netzwerk-Port). Die App kann ihn für Claude Code
einrichten. Von Hand geht es mit:

```bash
claude mcp add -s user brain -- <node> <brain-mcp.mjs> <dein-brain-ordner>
```

Den genauen Befehl mit den richtigen Pfaden zeigt Brain an. Werkzeuge: `brain_suchen`, `brain_lesen`, `brain_merken`,
`brain_gesundheit`, `brain_verlauf`.

## Datenschutz

- Keine Telemetrie, keine Analyse, kein Absturz-Upload. Berichte bleiben auf deinem Mac.
- Kein offener Netzwerk-Port. Die Oberfläche spricht über eine interne Brücke mit der App.
- Brain arbeitet nur in deinem Brain-Ordner und in `~/Library/Application Support/Brain`.
- Wenn du ein Git-Remote einträgst, geht dein Wissen dorthin und nirgendwo sonst hin.

## Entwicklung

```bash
swift build                      # Swift-Teil bauen
swift test                       # Swift-Tests
bash scripts/teste-node.sh       # Node-Tests (Brücke, MCP, Dateizugriff, Git)
bash scripts/baue-app.sh         # baut build/Brain.app (arm64)
```

Die Oberflächen-Tests (Playwright) liegen in `Tests/Oberflaeche` und laufen gegen den Entwicklungsserver mit einem
Wegwerf-Ordner, nie gegen echte Notizen. Veröffentlichen (Signieren, Notarisieren, DMG, Update-Feed) beschreibt
[docs/veroeffentlichen.md](docs/veroeffentlichen.md).

## Lizenz

MIT, siehe [LICENSE](LICENSE). Copyright 2026 Fabio Brogno.

---

## English (short)

**Brain** is a free, open-source Mac app: an editor for a folder of Markdown notes that knows which pages are
backed by sources, which have expired, and which are disputed. Git is built in (review, commit, history, restore,
sync with your own remote). A local MCP server (stdio, no network port) lets Claude Code, Codex or Cursor search and
read your notes with provenance; agents can only drop notes into the inbox.

- No server, no cost, no telemetry. Everything stays in your folder.
- Requires Apple Silicon and macOS 26 or later.
- **Early version:** expect rough edges. Keep backups.
- Install: download the notarized DMG from Releases, drag Brain to Applications.
- Develop: `swift test`, `bash scripts/teste-node.sh`, `bash scripts/baue-app.sh`; UI tests (Playwright) in `Tests/Oberflaeche`.
- License: MIT.
