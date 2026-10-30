# Claude-Code-Adapter

Bindet den Kortex-Vault in Claude Code ein: Hooks, Statusline und Slash-Commands.

## Dateien
- `install.mjs` — Merge-Installer. Ergänzt `~/.claude/settings.json` um die Kortex-Hooks (nie ersetzen,
  nie eine fremde `statusLine` überschreiben) und schreibt die Slash-Commands nach `~/.claude/commands/`
  (`ingest`, `handoff`, `brain-lint`, `brain-review`, `brain-feedback`, `brain-backup`). Jede
  generierte Datei trägt die Marke `<!-- brain-kit -->`; eine gleichnamige eigene Datei ohne Marke wird vorher
  als `<name>.md.bak-<YYYYMMDD-HHMMSS>` gesichert (mit Meldung). Hook-Befehle nutzen den absoluten Node-Pfad.
- `session-start.mjs` (SessionStart) — stößt `session-hintergrund.mjs` als eigenen, losgelösten Prozess an
  und gibt eine kurze Statuszeile aus (Inbox, Konflikte, fälliger Review). Nur wenn zutreffend außerdem:
  die Zahl neuer Vorschläge, die Ich-Karte `09_wiki/ich.md` (Schalter `ichKarte`, ohne Frontmatter,
  ≤ 1500 Zeichen) und `Projektseite: <pfad>` (Schalter `projektAutomatik`: genau eine Wiki-Seite, deren
  Frontmatter `repo:`/`pfade:` auf den Ordner- bzw. Git-Repo-Namen zeigt, sonst gleicher Seitenname).
  Seit v0.6 (M2a) außerdem — alles wörtlich mit Quelle, gesamt ≤ 9.500 Zeichen: nach einer Kompaktierung zuerst
  der Arbeitsstand dieser Sitzung (`.logs/sitzungen/<sid>.md`, nur dieselbe `session_id`); beim Start „Zuletzt in
  diesem Ordner“ (letzte drei Sitzungen, Commits seither, „Offen“ aus der jüngsten `session_*.md`, ≤ 600), parallele
  Sitzungen im selben Repo (`.logs/laufend/`, nur Hinweis) und der Projekt-Steckbrief (`pruefen`/`ziel`/`fallen` +
  Stack aus den Manifesten, ≤ 1.200).
- `session-hintergrund.mjs` — Hintergrund-Refresh: AGENTS.md neu rendern, Index, Suchrefresh, Lint-Cache,
  Sicherung (Schalter `sicherungTaeglich`), Memory-Sync (der frühere Update-Check entfällt: Kortex aktualisiert sich selbst).
- `brain-hint.mjs` (UserPromptSubmit) — lokaler Kortex-Hinweis über QMD-Vektorsuche (0 API-Tokens). Stufe
  `hinweise` (aus/niedrig/mittel/hoch), Import-Treffer mit „(Import, ungeprüft)“, Lücken (Schalter `luecken`),
  startet beim Stand-Intervall (`staendeIntervallStunden`) die Ernte `--art stand` losgelöst. Seit v0.6: Intent-Gate
  (reine Bestätigungen wie „ok, mach weiter“ suchen nicht; gezählt in `.logs/intent-gate.log`), Hinweis ≤ 600 Zeichen
  in ganzen Treffern, neue parallele Sitzungen im selben Repo werden einmal gemeldet. Diese Parallel-Meldung (K13) ist eine
  einmalige Zeile und zählt nicht zum 600-Zeichen-Budget des Such-Hinweises.
  Seit B1 (W6): Treffer auf eine Seite mit „ersetzt_durch“ erscheinen nur als „ersetzt → [[neu]], nicht mehr aktuell“,
  Seiten mit „zweifel“ tragen „(PRÜFBEDÜRFTIG: Zweifel)“.
- `ernte-ausloeser.mjs` (SessionEnd, PreCompact) — startet `ernte.mjs --art fakt` losgelöst, wenn
  `ernteSitzungsende` an ist; gibt nie etwas aus. Vorher legt er eine Auftrags-Marke `.logs/ernte/offen/<sid>.json`
  an, die `ernte.mjs` nach Abschluss entfernt. Bleibt sie liegen (Lauf mit Claude Code beendet, z. B. Windows),
  startet `session-start.mjs` sie beim nächsten Start neu; Marken älter als 7 Tage werden dort aufgeräumt.
  Seit B1 startet er mit „fakt“ zusätzlich das Fehler-Signal W7 (`w7.mjs`, 0 Tokens): Folgt auf eine Antwort nach
  einem Kortex-Hinweis eine Korrektur, landet {Seite, Sitzung, Zitat der Korrektur} in `.logs/w7.jsonl` (jeder Fund
  genau einmal). Die Ernte speichert nur noch Vorschläge mit wörtlichem Zitat aus Nutzer- oder Werkzeug-Text (`zitat`,
  `herkunft`, `fundstelle`); `ernte.log` zählt `ohneBeleg`, `nurKi` und `ungedeckt` (ein Fakt, dessen Zahlen, Daten, Uhrzeiten oder
  Verneinungen das Zitat nicht trägt; zählt auch als `ohneBeleg`).
  Herkunft je Fundstelle: Text, den Claude selbst geschrieben hat und der über ein Werkzeug zurückkommt (echo, Write →
  Read, Commit-Text → git log), zählt als `ki`; Bash mit curl/wget/URL und MCP-Werkzeuge zählen als `web` (MCP nur dann
  als `tool`, wenn der Name in `automatik.mcpVertraut` steht); das Zitat muss an Wortgrenzen stehen.
  Lesen aus dem eigenen Vault zählt als `ki`: Pfade auch als `$HOME/…`, `${HOME}/…` und relativ (`../…`), alle Git-Worktrees
  des Vaults — und jedes Zitat, das schon wörtlich in einer Seite unter `09_wiki/` steht, egal wie es zurückkam.
  Themen-Ausschluss: nennt ein Vorschlag (Titel, Text oder Zitat) ein Wort aus `automatik.ernteOhneThema` (ganzes Wort, Groß/Klein
  egal), wird er gar nicht erst angelegt (`ernte.log`: `thema=N`, nie das Wort); dasselbe gilt für Lektionen, W7 und die Lücken-Logs.
- `werkzeug-protokoll.mjs` (PreToolUse: `Read|mcp__.*`, eigener Eintrag) — Werkzeug-Protokoll für das
  Aufleuchten und die MCP-Nutzung; gibt nie etwas aus.
- `wiki-guard.mjs` (PreToolUse: Edit/Write/MultiEdit/NotebookEdit) — Riegel: `09_wiki/` nur über `/ingest`
  (frisches Lock), generierte Dateien nie von Hand.
- `kompakt-sichern.mjs` (PreCompact) — sichert den Arbeitsstand der Sitzung wörtlich aus dem Verlauf nach
  `.logs/sitzungen/<sid>.{json,md}` (Ziel, Vorgaben, Aufgaben, Dateien, Commits, Nutzer-Nachrichten; Secret-Riegel).
  Ersetzt den früheren echo-Hinweis „Skill handoff“ — der Installer entfernt ihn.
- `sitzung-ende.mjs` (SessionEnd) — trägt die Sitzung aus `.logs/laufend/` aus; gibt nie etwas aus. Mit `gedaechtnisTeilen=an` stößt er (wie `session-start.mjs`)
  zusätzlich den Abgleich des Auto-Memorys des aktuellen Projekts an (`gedaechtnis.mjs abgleichen --projekt <Schlüssel aus transcript_path>`, losgelöst im Hintergrund).
- `regeln-lesen.mjs` (PreToolUse: `Read`, eigener Eintrag) — spielt beim Lesen einer Datei die passenden Lektionen
  (`_lektionen.md`, Folgezeile „Gilt für“) und beim ersten Read in einem Repo den Projekt-Steckbrief als
  `additionalContext` ein (nur JSON, je Sitzung einmal, `.logs/gezeigt/`).

Alle Hooks bleiben registriert, auch wenn ihr Schalter in `brain.config.json#automatik` aus ist — sie beenden
sich dann sofort. So schreibt eine Änderung in der Einstellungsmaske `settings.json` nie um. Mit
`BRAIN_ERNTE=1` (der Hintergrund-Ernte-Lauf) tun alle Hooks nichts.
- `statusline.mjs` — Claude-Code-Statusline mit Kortex-Status (aktuell/wartend/Konflikte).
- `einmal.mjs` — Dubletten-Guard, kein Hook. Liest ein zweites Claude-Konto die Hook-Einstellungen des ersten zusätzlich als
  Projekt-Einstellung (gleicher Arbeitsordner), steht jeder Kortex-Hook je Ereignis zweimal in der Liste und liefe doppelt.
  `session-start`, `brain-hint`, `kompakt-sichern`, `werkzeug-protokoll`, `regeln-lesen` und `ernte-ausloeser` legen darum zuerst
  atomar eine Marke `.logs/hook-einmal/<hash>` an (Schlüssel: Hook + session_id + Hash von Prompt/`source`/`tool_use_id`/Verlauf).
  Ein zweiter Aufruf mit derselben Marke (< 30 s alt) endet sofort ohne Ausgabe und ohne Seiteneffekt; Marken älter als 10 min
  räumt der jeweils erste Aufruf weg. Nie blockierend: ein Fehler im Guard lässt den Hook normal laufen. Nicht unterdrückt werden
  Aufrufe ohne `session_id` und Eval-Sitzungen (`eval-…`, `messlatte.mjs`); `BRAIN_EINMAL=aus` schaltet den Guard ab.
  Bewusst ohne Guard: `wiki-guard.mjs` (blockierender Riegel, prüft gern zweimal), `statusline.mjs` (reine Anzeige, jeder Aufruf
  muss ausgeben), `sitzung-ende.mjs` (Austragen ist idempotent), `session-hintergrund.mjs` (kein Hook, nur Kindprozess von `session-start.mjs`).

## Installation

```
node adapters/claude-code/install.mjs <vault> [--claude-home <dir>] [--ohne-statusline]
```

- `<vault>` ist der Pfad zum Kortex-Vault (z. B. `~/Documents/Kortex`). Fehlt er, gilt `--vault`, `BRAIN_VAULT` bzw. der aktive Vault der App.
- Die Hook-Befehle zeigen auf den **Starter der App** (`Support/Kortex/bin/kortex`, neben dem stabilen Symlink `bin/kern`), nie auf einen Versionsordner,
  das App-Paket oder einen festen Vault: `[ -x '<Starter>' ] && exec '<Starter>' hook <name> || exit 0`. Der Starter startet `adapters/claude-code/<name>.mjs`
  im Kern. Fehlt der Starter, Node oder der Kern (App gelöscht, Update läuft gerade), endet der Befehl **still mit Exit 0** — nie eine Fehlermeldung in der Sitzung.
  Läuft der Hook, bleiben Exit-Code, Ausgabe und stdin erhalten (der `wiki-guard` darf blockieren). Ohne Vault im Hook (`--vault`, `BRAIN_VAULT`, aktiver Vault der App)
  beenden sich die Hooks ebenfalls still. Der Installer verlangt `KORTEX_KERN_PFAD` (setzt der Starter) und den Starter; sonst Exit 3 und nichts wird geschrieben.
  Windows (kein Starter): Node mit dem Kern-Pfad direkt.
- `--claude-home <dir>` überschreibt `~/.claude` (für Tests/Probeläufe).
- `--ohne-statusline` lässt die Statusline unangetastet.
- `--entfernen` ist der Rückweg: nimmt alle Kortex-Hooks (neue und ältere Form), die Kortex-Statuszeile und die Kortex-Befehle (`commands/*.md` mit der Marke) heraus; Fremdes
  bleibt, vorher wird ein Backup angelegt. Braucht weder Vault noch Starter.
- Ist `settings.json` ein Symlink (Dotfiles), wird das Ziel atomar ersetzt und der Link bleibt (gilt auch für `--entfernen`).
- `--stand` schreibt nichts und gibt eine JSON-Zeile aus (`hooks.eingetragen/neueForm`, `statuszeile`, `befehle`, `aktiv`).
- Über den Starter: `kortex claude-hooks [--entfernen|--stand]` (das ruft die Einrichtung der App auf).

Der Installer ergänzt `settings.json` nur — fremde Hooks und eine fremde Statusline bleiben unverändert.
Vor jeder Änderung wird ein Backup `settings.json.bak-<YYYYMMDD-HHMMSS>` angelegt. Ein zweiter Lauf ohne
Vault-/Config-Änderung meldet `unverändert` und legt kein neues Backup an.

Ist `settings.json` kein gültiges JSON, bricht der Installer mit einer Klartextzeile und Exit 1 ab, ohne
etwas zu schreiben oder ein Backup anzulegen — erst die Datei reparieren, dann erneut installieren.

**Ältere Kortex-Hooks derselben Vault** (Stand vor dem Kern-Umzug: Pfade im alten Kit-Ordner des Vaults, auch die frühere Form
ohne `adapters/claude-code/` und die `$HOME`-Schreibweise des Vault-Ordners) werden automatisch durch den neuen Aufruf **ersetzt** statt verdoppelt —
an derselben Stelle in der Hook-Liste, mit Backup wie jede andere Änderung. Hooks, die auf eine andere
Vault oder ein anderes Werkzeug zeigen, bleiben unangetastet.

## Tests

Die Tests liegen im Repo unter `Tests/Kern/` und laufen über `bash Tests/Kern/run-all.sh` (alles) bzw.
`bash Tests/Kern/unit.sh Tests/Kern/test-x.mjs` (einzelne Dateien); siehe `Ressourcen/kern/HERKUNFT.md`. Das Setup löscht beim Prozessende alle Temp-Ordner,
die ein Test per `mkdtemp` anlegt, setzt `QMD_BIN` auf den Fake (kein echtes qmd, kein Modell-Download) und `BRAIN_APP_SUPPORT` auf einen leeren
Temp-Ordner (kein Test liest je die echte Vault-Liste der App). Ein nackter `node --test` hinterlässt Temp-Reste.
