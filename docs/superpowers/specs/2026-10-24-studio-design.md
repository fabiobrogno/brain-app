# Brain Studio — Editor, Git-Client und KI-Anschluss (Spec-Nachtrag)

- **Stand:** 24.10.2026 · **Status:** entschieden (Fabio: „komplett eigen, öffentlich, durchbauen“)
- **Ändert:** App-Spec 2026-10-16 §2 (Zielgruppe jetzt öffentlich), §3 (Editor kein Nicht-Ziel mehr), §14 (Meilenstein
  ME wird zu „Studio“ und kommt jetzt). Alles andere aus der App-Spec gilt weiter, besonders §4 Leitprinzipien und §4a.
- **Arbeitstitel bleibt „Brain“.** Der Produktname wird getrennt entschieden (Namensrecherche), im Code steht er an
  genau einer Stelle (Info.plist `CFBundleName`/`CFBundleDisplayName`, `studio/texte.js` `PRODUKT`).

## 1. Versprechen

**Ein Editor für dein Wissen, der weiß, was davon stimmt — und deine KI arbeitet direkt mit.**
Abgrenzung: Notiz-Apps (Obsidian, Tolaria) zeigen, was getippt wurde. Studio zeigt zu jeder Seite, ob sie belegt,
abgelaufen, strittig oder ungeprüft ist, hält den Vault in Git und gibt jeder KI über einen lokalen MCP Zugriff.

## 2. Rahmen

- Öffentlich, kostenlos, MIT. **0 € Betriebskosten:** kein Server; Abgleich über das eigene Git-Remote des Nutzers;
  Updates per Sparkle-Appcast auf GitHub Releases; Website später per GitHub Pages.
- Weiter: nur Apple Silicon, macOS 26+, kein offener Port, keine Telemetrie.
- **Der Ordner ist die Wahrheit:** Studio liest und schreibt nur Dateien im Vault; Text wird **bytegleich** erhalten
  (kein Umwandeln in Blöcke und zurück).

## 3. Bausteine (alle im App-Repo, nicht im Kit)

| Pfad | Was | Wer startet es |
|---|---|---|
| `Ressourcen/gemeinsam/vault.mjs` | Pfad-Schutz, Dateibaum, Lesen/Schreiben (atomar, Hash), Suche, Prüf-Signale, Git-Aufrufe | wird importiert |
| `Ressourcen/werkstatt/werkstatt.mjs` | Brücke für die Studio-Oberfläche: JSON-Zeilen über stdin/stdout, **gleiches Protokoll wie** `~/brain/.tools/ansicht/bruecke.mjs`; liefert auch die statischen Dateien aus `Ressourcen/studio/` | Swift-App, solange das Hauptfenster offen ist |
| `Ressourcen/werkstatt/entwicklung.mjs` | derselbe Handler über HTTP auf 127.0.0.1 (nur Entwicklung/Tests, nie in der App gestartet) | Tests, Entwickler |
| `Ressourcen/mcp/brain-mcp.mjs` | lokaler MCP-Server (stdio, JSON-RPC 2.0, ohne npm-Abhängigkeiten) | Claude Code / Codex / Cursor |
| `Ressourcen/studio/` | Oberfläche (HTML/CSS/JS, CodeMirror 6 als fertiges Bundle unter `vendor/`) | WKWebView `brain://studio/` |
| `Sources/BrainApp/…` | Dock-App: Hauptfenster (Studio), Menüleiste bleibt, alte Ansicht (3D/Karten) als zweites Fenster | — |

Aufruf: `node werkstatt.mjs <vault>` und `node brain-mcp.mjs <vault>`. Kit (falls vorhanden): `<vault>/.tools/brain.mjs`.
Node ist das mitgelieferte der App (`~/Library/Application Support/Brain/bin/node`); Tests nutzen das System-Node.

## 4. Brücken-Protokoll (unverändert vom Kit übernommen)

- Start: Prozess schreibt `{"bereit":true,"version":"<app-version>","vaultId":"<id>"}`.
- Anfrage: `{"id":1,"methode":"GET","pfad":"/api/datei","query":"pfad=a.md"|null,"body":"<base64>"|null}`
- Antwort: `{"id":1,"status":200,"headers":{"Content-Type":"…"},"body":"<base64>"}`
- Pfade ohne `/api/` = statische Datei aus `Ressourcen/studio/` (Standard `index.html`), sonst 404.
- Ende bei geschlossenem stdin, SIGTERM oder `POST /api/stopp`.
- Oberfläche → App: `window.webkit.messageHandlers.brain.postMessage({methode, pfad, daten})` (wie `ansicht/api.js`);
  im Browser (Entwicklung) stattdessen `fetch`. Aktionen an die App (kein Datenweg):
  `window.webkit.messageHandlers.aktion.postMessage({aktion:"ansicht"|"ordner-zeigen"|"extern", wert?})`.

## 5. API (JSON, UTF-8; Fehler immer `{ "fehler": "<Alltagssprache>" }`)

Pfade sind relativ zum Vault mit `/`. **Pfad-Schutz:** normalisieren, kein `..`, Ziel (realpath) muss im Vault liegen,
kein Symlink nach draußen. Gesperrt (403): `.git/`, `.tools/`, `.logs/`, alles mit führendem Punkt, `node_modules/`.
**Nur lesbar** (`schreibschutz:true`): generierte Dateien — `INDEX.md`, `_index.md`, `graph.json`, `_<ordner>.md`
in `09_wiki`, jede Datei, deren erste 3 Zeilen „generiert — nicht editieren“ enthalten.
Bearbeitbar sind nur `.md` und `.txt`.

| Methode + Pfad | Eingabe | Antwort |
|---|---|---|
| `GET /api/info` | — | `{vault, name, appVersion, kitVersion\|null, git:bool, mcpBefehl:string\|null}` |
| `GET /api/baum` | — | `{eintraege:[{pfad, art:"ordner"\|"datei", geaendert, groesse, schreibschutz}]}` (sortiert, Ordner zuerst) |
| `GET /api/datei?pfad=` | — | `{pfad, inhalt, hash, geaendert, schreibschutz}` · hash = sha256-hex der Bytes |
| `PUT /api/datei` | `{pfad, inhalt, basisHash}` | 200 `{hash, geaendert}` · `basisHash:null` = neu anlegen (409 wenn vorhanden) · 409 `{fehler, aktuellerHash}` wenn die Datei sich auf der Platte geändert hat · atomar (Temp-Datei + rename), Bytes exakt wie gesendet |
| `POST /api/neu` | `{ordner, titel}` | `{pfad}` · Datei `<ordner>/<slug>.md` mit `# <titel>\n` |
| `POST /api/merken` | `{text, titel?}` | `{pfad}` · neue Datei in `00_inbox/JJJJ-MM-TT_<slug>.md` im Format der bestehenden Inbox-Dateien (vorher ansehen); nie überschreiben, bei Namensgleichheit `-2`, `-3` |
| `GET /api/suche?q=` | — | `{treffer:[{pfad, titel, auszug, zeile}]}` · max. 30, Titel-Treffer zuerst, Groß/klein egal, Umlaute normal |
| `GET /api/pruefung?pfad=` | — | `{stufe:"gruen"\|"gelb"\|"rot"\|"grau", zusammenfassung, signale:[{art, text, zeile?}]}` (§6) |
| `GET /api/gesundheit` | — | Kit `brain.mjs gesundheit --json` durchgereicht (Cache 120 s, Zeitlimit 20 s) oder `{verfuegbar:false}` |
| `GET /api/git/status` | — | `{repo, zweig, upstream\|null, vor, zurueck, geaendert:[{pfad, code}], letzterCommit:{sha,kurz,nachricht,zeit}\|null, letzterSync\|null, remote:bool}` |
| `POST /api/git/commit` | `{nachricht, dateien:[pfad…]}` | `{sha}` · staged NUR genau diese Pfade (`git add -- <pfade>`), nie `-A`; pre-commit-Ablehnung → 422 `{fehler, ausgabe}` (Ausgabe gekürzt) |
| `POST /api/git/sync` | — | `{ergebnis:"aktuell"\|"geholt"\|"gesendet"\|"beides", letzterSync}` · `fetch`; hinterher: `merge --ff-only`, sonst normaler Merge; Konflikt → `merge --abort`, 409 `{fehler, dateien}`; danach `push`, nie `--force`; ohne Remote 400 |
| `GET /api/git/verlauf?pfad=&max=` | — | `{eintraege:[{sha,kurz,autor,zeit,nachricht}]}` (`--follow`, Standard 50) |
| `GET /api/git/diff?pfad=&sha=` | — | `{diff}` · mit sha: Änderung dieses Commits an der Datei; ohne: Arbeitsstand gegen HEAD |
| `GET /api/git/fassung?pfad=&sha=` | — | `{inhalt}` (Wiederherstellen = Oberfläche lädt Fassung in den Editor, Nutzer speichert, normaler Commit) |
| `POST /api/mcp/verbinden` | `{ziel:"claude"}` | führt `claude mcp add -s user brain -- <node> <brain-mcp.mjs> <vault>` aus, wenn `claude` gefunden; sonst 404 mit dem Befehl zum Kopieren |
| `POST /api/stopp` | — | `{ok:true}`, danach Ende |

Git immer per `execFile` (keine Shell), Pfade nach `--`, Umgebung `GIT_TERMINAL_PROMPT=0`, Zeitlimit 60 s (Sync 120 s).
Der Zeitpunkt des letzten Abgleichs liegt in `.git/brain-studio.json`.

## 6. Prüf-Signale je Seite (0 Tokens, nur Regeln)

Grundlage: `09_wiki/_schema.md` des Vaults. Nur Seiten unter `09_wiki/` werden bewertet, alles andere ist `grau`
(„Notiz — wird erst durch /ingest zu Wissen“).
- `rot`: Konflikt-Kasten in der Seite · Markierung PRÜFBEDÜRFTIG/Zweifel.
- `gelb`: `pruefen_bis` überschritten oder `stand` + `verfall` abgelaufen · Fakt-Zeilen ohne Beleg-Link
  (`· [[…/belege/…]]`) · `quellen_sha` fehlt bei `quelle_*`.
- `gruen` („Belegt“): mindestens eine belegte Fakt-Zeile und keine unbelegte. Fakt-Zeile = Listenzeile mit `· Stand TT.MM.JJJJ` oder Beleg-Link; unter `## Fakten` zählen dann alle Listenzeilen. `ohne` („Ohne Befund“, neutral): keine Fakt-Zeilen im Beleg-Format und keine Signale (z. B. handgeschriebene Stichpunkte). Zusatz-Signale (nicht wertend): `kritisch: true` („nur von Hand“), Stand-Datum, Zahl belegter Fakten.
Die Oberfläche zeigt die Stufe in Kopfzeile und Dateibaum; Zeilen-Signale als Randmarken im Editor.
**Ehrlichkeit:** Studio behauptet nie „stimmt“, sondern „belegt“/„ungeprüft“ — Wahrheit entscheidet der Mensch.

## 7. MCP-Werkzeuge (`brain-mcp.mjs`)

Protokoll: `initialize` (Version des Clients übernehmen, wenn unterstützt: `2025-06-18`, `2025-03-26`, `2024-11-05`),
`notifications/initialized`, `tools/list`, `tools/call`, `ping`. Nur stdout für JSON-RPC, Logs nach stderr.

| Werkzeug | Eingabe | Wirkung |
|---|---|---|
| `brain_suchen` | `frage`, `anzahl?` (≤ 20) | Treffer mit Pfad, Titel, Auszug, Prüf-Stufe |
| `brain_lesen` | `pfad` | Inhalt + Prüf-Signale + Stand |
| `brain_merken` | `text`, `titel?` | neue Datei in `00_inbox/` (wie `/api/merken`); **schreibt nie ins Wiki** |
| `brain_gesundheit` | — | Kurzfassung der Kit-Gesundheit (Ampel + Befunde) |
| `brain_verlauf` | `pfad`, `max?` | Git-Verlauf der Datei |

## 8. Oberfläche (`brain://studio/`)

Drei Spalten wie eine native Mac-App: **Seitenleiste** (Suche, Bereiche Inbox · Wiki · Notizen · Alle Dateien,
Dateibaum mit Prüf-Punkt, unten „+ Neu“ und „Schnell merken“) · **Editor** (CodeMirror 6, Markdown mit Live-Vorschau:
Überschriften, Fett/Kursiv, Listen, `[[Wikilinks]]` klickbar mit Autovervollständigung, Frontmatter dezent
eingeklappt; Schreibschutz sichtbar; Speichern automatisch 800 ms nach der letzten Eingabe und mit ⌘S) ·
**Infospalte** (ein-/ausblendbar: Prüf-Signale, Verlauf dieser Notiz mit Diff und „Diese Fassung wiederherstellen“,
Rückverweise). **Statusleiste** unten: `● Gesichert vor 2 Min · main ↑1 ↓0 · 3 geändert · Inbox 10 · Rückfragen 8 · Gesundheit ⚠ 4`
— Klick auf „geändert“ öffnet den **Commit-Dialog** (Dateien abhakbar, Nachricht vorbelegt), Klick auf den Sync-Punkt
gleicht ab. Konflikte und Fehler in Alltagssprache. **Befehlspalette ⌘K** (Notiz öffnen, Befehle). Hell/Dunkel nach
System, Schrift SF Pro / SF Mono, ruhige Farben, eine Akzentfarbe; keine generische KI-Optik.
Tastatur: ⌘N neu, ⌘⇧M merken, ⌘P/⌘K Palette, ⌘F Suche in Notiz, ⌘⇧F Suche im Vault, ⌘⌥I Infospalte, ⌘⇧G Commit.

## 9. App (Swift)

- `LSUIElement` entfällt → Dock-Symbol, Hauptfenster beim Start (Fenstergröße gemerkt), Menüleisten-Symbol bleibt.
- Hauptfenster lädt `brain://studio/index.html`; Schema-Handler und Kanal wie bisher, aber Host `studio` → Werkstatt-
  Brücke, Host `app` → bisherige Kit-Ansicht (zweites Fenster „Übersicht“). Fenster zu = Webview + Brücke weg.
- Werkstatt startet mit dem mitgelieferten Node: `node <Resources>/werkstatt/werkstatt.mjs <vault>`.
- Menü: Ablage (Neu ⌘N, Schnell merken ⌘⇧M), Darstellung (Infospalte), Fenster (Studio, Übersicht).
- `scripts/baue-app.sh` kopiert `Ressourcen/{studio,werkstatt,mcp,gemeinsam}` nach `Contents/Resources/`.
- Version 0.2.0.

## 10. Veröffentlichung (vorbereitet, Schlüssel nur Fabio)

`scripts/veroeffentlichen.sh`: Developer-ID-Signatur (Hardened Runtime, auch Node + Skripte), `notarytool submit
--keychain-profile <profil> --wait`, `stapler`, DMG, Sparkle-`appcast.xml` (EdDSA). Was Fabio einmal selbst tut:
Zertifikat „Developer ID Application“ in Xcode anlegen, `xcrun notarytool store-credentials`, Sparkle-Schlüssel
`generate_keys` (liegt im Schlüsselbund). Sparkle-Einbau in die App kommt, sobald der öffentliche Schlüssel existiert.

## 11. Tests

- Node (`node --test`): vault.mjs (Pfad-Schutz inkl. `..`/Symlink, Schreibschutz, Hash-Konflikt 409, bytegleiches
  Schreiben mit CRLF/Emoji/Frontmatter, Merken-Dateinamen, Suche, Prüf-Signale an Beispielseiten), Git-Routen gegen
  Wegwerf-Repos in einem Temp-Ordner (Commit nur gewählte Dateien, pre-commit-Ablehnung → 422, Sync mit lokalem
  Bare-Remote: geholt/gesendet/Konflikt → abort + 409), Brücken-Protokoll, MCP-Protokoll (initialize, tools/list,
  tools/call, unbekanntes Werkzeug, merken schreibt nur Inbox).
- Oberfläche: Playwright gegen `entwicklung.mjs` mit Wegwerf-Vault: öffnen, tippen, Auto-Speichern bytegleich,
  Konflikt-Hinweis, Commit-Dialog, Verlauf + Wiederherstellen, Suche, Schnell merken, Hell/Dunkel; Screenshots prüfen.
- Swift: XCTest für neue Kern-Logik; Rauchtest der gebauten App.
- **Trockenlauf gegen eine Kopie von `~/brain`** (git clone in Temp), nie gegen das Live-Brain.
