# Brain Studio v2 — Aufbau wie eine fertige Wissens-App (Spec)

- **Stand:** 24.10.2026 · **Status:** entschieden (Fabio: „wie Tolaria, nur viel besser, mit allen Abläufen; jeder Vault ein Repo“)
- **Grundlage:** Tolaria-Analyse (Artifact „Studio v2 Bauplan“), native Screenshots `scratchpad/tolaria-nativ/`, Browser-Rundgang
  `scratchpad/tolaria-tour/` (tour.md, masse.json, bilder/), Doku-Analyse `scratchpad/tolaria-tour/doku-analyse.md`.
  Kein Tolaria-Code (AGPL) — nur Abläufe, Muster, gemessene Maße.
- **Baut auf:** `2026-10-24-studio-design.md` (v1). Alles dort gilt weiter (bytegleiches Speichern, Pfad-Schutz, Kit-Vertrauen,
  Git per execFile, kein Port), außer wo hier ersetzt.

## 1. Fenster (Welle 1)

Vier Spalten + Statusleiste. Maße/Farben/Schriften aus `masse.json` (gemessen an Tolaria), eigene Akzentfarbe.

| Spalte | Inhalt |
|---|---|
| **Seitenleiste** | Vault-Wechsler oben (Name, Farbpunkt, ▾) · Bereiche: Posteingang (n) · Rückfragen (n, nur mit Kit) · Alle Notizen (n) · Wissen (n) · Archiv · **ANSICHTEN**: Abgelaufen · Strittig · Ungeprüft · Zuletzt geändert · **TYPEN** (aus `typ:`/`type:`, Farbe+Symbol, Zähler) · **ORDNER** (Baum, eingeklappt) · unten: + Neu, Schnell merken |
| **Liste** | Kopf: Titel des Bereichs, Sortierung (Geändert ↓ / Titel / Erstellt), Suche, + · Karten: Titel (H1 > `title`/`titel`/`name` > Dateiname), Vorschau (`description` > erster Absatz, 2 Zeilen), Datum geändert links, Typ-Symbol + Wahrheits-Punkt rechts oben · Auswahl hervorgehoben · Tastatur ↑↓ |
| **Editor** | Kopf: Pfad als Brotkrumen (Bereich › Ordner › Titel), Werkzeuge (Favorit, Rohtext/Vorschau, Breite, Gliederung, Eigenschaften-Panel), Speicherstand · Text: CodeMirror (v1), Textspalte max. Breite wie gemessen |
| **Eigenschaften** (ein-/ausblendbar ⌘⌥I) | ganz oben **Wahrheitsstatus** (Stufe, Stand, prüfen bis, Herkunft, Belege-Zahl, Signale) · Typ · Felder aus dem Kopf (lesen in Welle 1, bearbeiten in Welle 3) · Beziehungen: jedes Feld mit `[[…]]` · Rückverweise · Info (geändert, erstellt, Wörter, Größe) · Verlauf dieser Notiz |

**Statusleiste:** Vault · App-Version · Zweig · Remote/„Kein Remote“ · ↑↓ · Sync-Zustand („Gesichert vor 2 Min“ / „Pull nötig“ / „Konflikt“ / „Fehler“) · n geändert → Commit · Verlauf (schaltet Liste auf Verlauf) · Claude (verbunden ✓/✕) · Gesundheit · Hell/Dunkel · Einstellungen.

**Verlauf-Modus der Liste:** Repo-Commits nach Tagen gruppiert („Dienstag, 20. Oktober 2026 (1 Commit)“), je Eintrag Nachricht, relative Zeit, Kurz-Hash, +n/~n; Klick klappt geänderte Dateien auf, Klick auf Datei zeigt deren Diff im Editorbereich.

**Posteingang** = Dateien in `00_inbox/` (Brain-Konvention) — bei Vaults ohne `00_inbox`: Notizen ohne `typ` und ohne Verknüpfung.
**Wissen** = `09_wiki/` ohne generierte Dateien. **Archiv** = `90_*`-Ordner und Notizen mit `archiviert: true`.

## 2. Vaults und Einstieg (Welle 2)

- **Vault-Liste:** `<support>/vaults.json` `{ "vaults":[{"name","pfad","farbe"}], "aktiv":"<pfad>" }` (support = `BRAIN_APP_SUPPORT`).
  Erststart: vorhandenes `config.json` (`vault`) der App wird übernommen. Jeder Vault ist ein Ordner, idealerweise ein Git-Repo.
- **Werkstatt ohne Vault:** Start ohne Vault-Argument → liest `vaults.json`; ohne aktiven Vault liefert `/api/info` `{vault:null}`
  und die Oberfläche zeigt **Willkommen**. Vault-Wechsel ohne Neustart der App (Werkstatt tauscht intern Vault + Caches).
- **Willkommen** (Karte, mittig, wie Tolaria): vier Wege — **Brain-Vorlage** (neues Brain mit Inbox, Wiki, Schema, AGENTS.md,
  CLAUDE.md, Beispielseiten; `git init` + erster Commit) · **Leerer Vault** (Ordner + `git init`) · **Vorhandenen Ordner öffnen**
  (nativer Ordner-Dialog über die App; ohne Git nachfragen „Versionsverlauf einschalten?“) · **Von GitHub klonen** (URL + Zielordner,
  System-Git, keine Tokens in der App). Standard-Zielordner `~/Brain` (keine macOS-Freigabe nötig; erklären).
- **Danach „KI verbinden“:** erkannte CLIs mit Version (claude, codex, gemini, cursor-agent, opencode) · Knopf „Mit Claude verbinden“
  (MCP, wie v1) · wenn Kit vorhanden: „Brain-Hinweise einschalten“ (Kit `hooks-install`, nur auf Klick) · **Probe-Frage**: eine
  Beispielsuche über den MCP-Weg, Ergebnis anzeigen („Claude findet dein Brain“).
- **Remote hinzufügen** (Statusleiste bei „Kein Remote“): URL → prüft per `ls-remote`/`fetch`, ob die Historien passen
  (leer / verwandt → ok; fremd → ablehnen mit Erklärung), setzt `origin`, erster Push.

## 3. Editor und Eigenschaften (Welle 3)

Griffe ⋮⋮ und + am Zeilenrand (nur Darstellung), Slash-Menü (Überschrift, Liste, Aufgabe, Zitat, Code, Tabelle, Callout, Bild,
Link, Beleg-Zeile), Callouts `> [!hinweis]`, Bilder aus `attachments/` per Drag & Drop. Neue Notiz: Titel tippen → Datei wird nach
dem H1 benannt (Slug), Wikilinks werden beim Umbenennen nachgezogen (eigener Änderungs-Dialog). Kopf-Felder bearbeitbar, ohne den
Rest der Datei anzufassen (zeilengenaue YAML-Änderung). Text bleibt bytegleich (v1-Vertrag).

## 4. Git und KI (Welle 4)

Auto-Commit (aus/an, nach 90 s Pause oder beim Verlassen der App, nur ohne ungespeicherte Eingaben, Nachricht „Notizen aktualisiert
(n)“) · Auto-Pull bei Start, Fokus, alle 15 Min · Claude-Panel ⌘I (Claude Code `-p --output-format stream-json` im Vault mit
`--strict-mcp-config` nur unseren MCP-Werkzeugen, Schreiben als Vorschlag mit Diff + Übernehmen) · Rückfragen-Liste mit
Ein-Klick-Antworten (Kit) · Papierkorb `.papierkorb/` im Vault (von Git ignoriert? nein: versioniert, damit Wiederherstellen geht).

## 5. API-Ergänzungen (Welle 1 + 2)

| Route | Antwort |
|---|---|
| `GET /api/notizen` | `{notizen:[{pfad, titel, vorschau, typ, bereich:"inbox"\|"wissen"\|"notiz"\|"archiv", geaendert, erstellt\|null, stufe, links:[pfad], felder:{…}, generiert}]}` — Index mit Cache (Datei-mtime), < 300 ms bei 1.000 Dateien |
| `GET /api/notiz/kontext?pfad=` | `{felder, beziehungen:[{feld, ziele:[pfad\|titel]}], rueckverweise:[{pfad,titel}], info:{woerter, bytes, geaendert, erstellt}}` |
| `GET /api/typen` | `{typen:[{name, anzahl, farbe, symbol}]}` (Farbe/Symbol fest je bekanntem Brain-Typ: thema, quelle, entitaet, projekt, person, entscheidung; sonst aus Name abgeleitet) |
| `GET /api/ansichten` | `{ansichten:[{id:"abgelaufen"\|"strittig"\|"ungeprueft"\|"zuletzt", anzahl}]}` |
| `GET /api/git/log?max=&vor=` | `{tage:[{datum, commits:[{sha,kurz,nachricht,zeit,autor,plus,geaendert,dateien:[{pfad,status}]}]}]}` |
| `GET /api/vaults` · `POST /api/vaults/aktiv` · `POST /api/vaults/neu` `{art:"vorlage"\|"leer", name, ordner}` · `POST /api/vaults/oeffnen` `{pfad}` · `POST /api/vaults/klonen` `{url, ordner}` · `POST /api/vaults/entfernen` `{pfad}` (nur aus der Liste, nie löschen) | Vault-Verwaltung |
| `GET /api/ki/erkennen` | `{agenten:[{id,name,version\|null,pfad\|null}]}` |
| `POST /api/git/remote` `{url}` | Remote hinzufügen mit Historien-Prüfung |
| `POST /api/probe` `{frage}` | Suche über denselben Weg wie MCP `brain_suchen`; `{treffer}` |

App → Oberfläche: Aktion `ordner-waehlen` (Kanal `aktion` mit Antwort) öffnet `NSOpenPanel` (nur Ordner) und liefert `{pfad}|null`.

## 6. Abnahme je Welle

Node-, Swift-, Playwright-Tests grün · Screenshots hell+dunkel bei 1440×900 neben die Tolaria-Bilder gelegt und selbst geprüft ·
Echtdaten-Lauf gegen eine Kopie von `~/brain` · am Ende EIN Opus-Review über Welle 1+2.
