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

### 5a. Gebaute Antworten im Einzelnen (Backend, Stand 24.10. abends — gilt vor der Tabelle oben)

**`GET /api/notizen`** — alle `.md`/`.txt` des Vaults ohne gesperrte Orte (`.git`, `.tools`, `.logs`, Punkt-Namen, `node_modules`), neueste Änderung zuerst.
`{notizen:[{pfad, titel, vorschau, typ, bereich, geaendert, erstellt, stufe, links, felder, generiert, ansichten}]}`
- `titel`: erste `# `-Überschrift (außerhalb von Code-Blöcken, Markdown entfernt) > Kopf `title`/`titel`/`name` > Dateiname ohne Endung.
- `vorschau`: Kopf `description`/`beschreibung` > erster Absatz (ohne Überschriften, Code, Tabellen; Listen-/Zitatzeichen und `[!Callout]` abgestreift; Markdown entfernt), höchstens ~200 Zeichen.
- `typ`: Kopf `typ` > `type`, klein; `[[Link]]` und Listen werden aufgelöst; **`""` wenn keiner**.
- `bereich` (Vorrang in dieser Reihenfolge): `archiv` (`archiviert: true`/`archived: true` oder oberster Ordner `90_*`) · `maschine` (alles unter `00_inbox/_*/` — Ordner mit Unterstrich direkt im Posteingang, z. B. `_rueckfragen`, `_vorschlaege`, `_warten`, `_lektionen`) · `vorlage` (`01_vorlagen/`) · `system` (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` direkt in der Vault-Wurzel, Groß/klein egal; andere Wurzel-Dateien wie `README.md` bleiben Notizen) · `inbox` (`00_inbox/`, ohne die `_`-Ordner) · `wissen` (`09_wiki/`, auch generierte Dateien: dort `generiert:true`) · bei Vaults **ohne** `00_inbox`-Ordner: Notizen ohne `typ`, ohne `[[…]]` und ohne Rückverweis → `inbox` · sonst `notiz`.
- `stufe`: wie `/api/pruefung` (`gruen`/`gelb`/`rot`/`ohne`, `grau` für `_*.md`) **nur unter `09_wiki/`, sonst `null`**.
- `links`: Pfade aller `[[…]]` in Kopf-Feldern und Text (Code-Blöcke und `` `Inline-Code` `` zählen nicht), in Dateireihenfolge, ohne Doppelte; Alias (`|`) und Anker (`#`, `^`) werden abgeschnitten; Einbettungen `![[…]]` zählen. Auflösung ohne Groß/klein und Unicode-Form, Reihenfolge: Pfad (auch Endstück des Pfads, z. B. `firma/belege/2026-10/b1`) → Dateiname ohne Endung → Titel → Alias (`aliases`/`alias`/`auch_genannt`); `./`/`../` relativ zum Ordner der Notiz. Bei mehreren Treffern gewinnt der exakte Pfad, dann der gleiche Ordner, dann der kürzeste Pfad. Nicht auflösbare Ziele fehlen hier (sie stehen in `kontext`).
- `felder`: Kopf-Felder als Text oder Liste von Texten (Inline-Liste, Block-Liste, `>`/`|`-Blocktext; Verschachteltes = `""`); je Wert höchstens 300 Zeichen, höchstens 40 Felder, Listen höchstens 20 Einträge.
- `erstellt`: ISO-Zeit des ersten Git-Commits der Datei (Umbenennungen verfolgt; gelöscht und neu angelegt = neu), je HEAD gecacht und bei neuen Commits nur fortgeschrieben; ungetrackt/ohne Git/flaches Repo: Erstellzeit der Datei; sonst `null`.
- `geaendert`: für in Git **saubere** Dateien die Zeit des letzten Commits, der die Datei berührt hat (reine Umbenennung zählt nicht, Umbenennung mit Änderung im selben Commit schon) — sauber = laut einem `git status --porcelain=v1 -z --untracked-files=all` je Indexlauf (ohne Sperre) weder geändert noch vorgemerkt noch neu und seit dessen Start nicht mehr geschrieben; so gilt nach `git clone` oder Abgleich nicht jede Notiz als „gerade geändert“. Sonst (geändert, vorgemerkt, neu, kein Git, Karte oder Status nicht innerhalb von 1,5 s fertig) die Dateizeit. Sortierung, Ansicht `zuletzt` und `info.geaendert` im Kontext benutzen dieselbe Zeit. Kostet warm etwa 5 bis 35 ms je Anfrage (nach einer Kopie des Ordners mit veraltetem Git-Index bis ≈ 100 ms, bis irgendein Git-Befehl den Index erneuert).
- `generiert`: wie der Schreibschutz in §5 (v1). `ansichten`: Ids der Ansichten, zu denen die Notiz gehört (leer bei generierten und bei `maschine`/`vorlage`/`system`/`archiv`) — die Oberfläche filtert damit, die Zähler in `/api/ansichten` stammen aus denselben Werten.
- Cache je Datei über Änderungszeit+Größe, Verknüpfungen werden bei jeder Anfrage neu aufgelöst. Gemessen an einer Kopie von `~/brain` mit 1.036 Notizen: kalt ≈ 250 ms, warm ≈ 15 ms, Antwort ≈ 840 KB.

**`GET /api/notiz/kontext?pfad=`** — `{felder, beziehungen, verweise, rueckverweise, info}`: `felder` vollständig (Texte/Listen); `beziehungen:[{feld, ziele}]` nur Kopf-Felder mit `[[…]]` (`ziele` = Pfad, nicht auflösbare als Text des Links); `verweise` = Ziele der Links im Text (Pfad oder Text); `rueckverweise:[{pfad,titel}]` (ohne generierte Dateien und ohne die Notiz selbst, nach Titel); `info:{woerter, bytes, geaendert, erstellt}`. 403 gesperrt, 404 fehlt, 415 kein Text.

**`GET /api/typen`** — `{typen:[{name, anzahl, farbe, symbol}], standard:{farbe, symbol}}` nach Anzahl absteigend (generierte Dateien zählen nicht; gezählt wird nur in `inbox`/`notiz`/`wissen`, wie bei den Ansichten). `farbe` = `#RRGGBB`. Fest: `thema` `#4F7DF3` buch · `quelle` `#C9922A` zitat · `entitaet` `#9A6FD6` wuerfel · `projekt` `#E0693F` rakete · `person` `#D4578A` person · `entscheidung` `#2FA39A` waage · `notiz` `#7C8798` notiz; Schreibweisen wie `project`, `topic`, `Entität` werden auf diese abgebildet, alles andere bekommt eine aus dem Namen abgeleitete Farbe und das Symbol `notiz`. `standard` gilt für Notizen ohne Typ. Symbol-Namen (feste Liste der Oberfläche): `buch zitat wuerfel rakete person waage notiz ordner`.

**`GET /api/ansichten`** — Zähler (generierte Dateien nie; nur Notizen aus `inbox`/`notiz`/`wissen`, nie `maschine`/`vorlage`/`system`/`archiv`): `abgelaufen` = `pruefen_bis` < heute (Berlin) **oder** `stand`+`verfall`-Tage überschritten · `strittig` = `stufe rot` · `ungeprueft` = Wiki-Seite (nicht `_*`, nicht unter `belege/`) ohne belegte Fakt-Zeile **und** ohne `stand` · `zuletzt` = in den letzten 7 Tagen geändert (Zeit wie `geaendert`).

**`POST /api/probe {frage}`** → `{frage, treffer:[{pfad,titel,auszug,zeile,stufe}], text}` — dieselbe Funktion wie MCP `brain_suchen` (höchstens 10 Treffer); `text` ist genau das, was die KI sieht. 400 bei leerer/zu langer Frage.

**`GET /api/git/log?max=&vor=`** — `{tage:[{datum:"JJJJ-MM-TT", beschriftung:"Dienstag, 20. Oktober 2026", commits:[{sha, kurz, nachricht, zeit, autor, plus, geaendert, geloescht, zeilenPlus, zeilenMinus, merge, dateien:[{pfad, status, von?, plus, minus}], dateienGesamt, versteckt}]}], weitere, naechste}`.
Gruppiert nach **Berliner** Tag (`zeit` = Commit-Zeit ISO), neueste zuerst (Reihenfolge von `git log`); `max` Standard 50, höchstens 200. Seitenweise: `vor=<sha>` liefert die Commits **nach** diesem (exakt über die Position in `git rev-list HEAD`, auch mit Merges); `weitere` sagt, ob es mehr gibt, `naechste` ist der `vor`-Wert für die nächste Seite. Derselbe Tag kann auf zwei Seiten vorkommen (die Oberfläche fügt zusammen).
`status` je Datei: `A` neu · `M` geändert · `D` gelöscht · `R` umbenannt (mit `von`); `plus`/`minus` = Zeilen. Commit-Zähler: `plus` = neue Dateien, `geaendert` = geänderte + umbenannte, `geloescht`; `zeilenPlus`/`zeilenMinus` = Summen. Gesperrte Pfade (Punkt-Namen, `node_modules`) erscheinen nicht und zählen nicht, `versteckt` nennt ihre Zahl. `dateien` höchstens 300 je Commit (`dateienGesamt` = alle sichtbaren). Merge-Commits: `merge:true`, keine Dateien. Repo ohne Commit: `{tage:[], weitere:false, naechste:null}`; kein Repo: 400.

**`POST /api/git/remote {url}`** → `{ok:true, ergebnis:"gesendet"|"geholt"|"verbunden", remote:"origin", zweig, letzterSync}`. Erlaubt sind `https://…`, `ssh://…`, `git@host:pfad` (keine Passwörter in der Adresse, kein `ext::`/`file://`/`http://`). Ablauf: `ls-remote` → leeres Server-Repo: `origin` setzen und `push -u`; sonst Zielzweig (gleichnamig, sonst Hauptzweig des Servers) in einen **temporären Ref** holen und mit `merge-base --is-ancestor` prüfen: Server ist Vorfahr → senden; Vault ist Vorfahr → vorspulen (`--ff-only`); auseinandergelaufen → **409** `{art:"auseinander"}`; kein gemeinsamer Vorfahr → **409** `{art:"fremd"}` („Dieses Repository hat eine andere Geschichte“); anderer Zweigname → 409 `{art:"zweigname"}`; schon ein anderes Remote → 409. Der Ref wird immer aufgeräumt, `origin` erst am Ende gesetzt (bei Misserfolg zurückgenommen), nie `--force`. Zeitlimits 60 s (lesen) / 120 s (senden).

**Vaults** — Liste `<support>/vaults.json` = `{vaults:[{name,pfad,farbe}], aktiv:"<pfad>"|null}` (absolute Pfade; fehlt die Datei, wird der Vault aus `config.json` übernommen und gespeichert; danach ist `vaults.json` maßgeblich, auch mit `aktiv:null`). Alle Antworten dieser Gruppe haben `{vaults:[{name,pfad,farbe,aktiv,vorhanden,git,temporaer?}], aktiv}`; die vier Wege zum Vault zusätzlich `vault:{name,pfad,farbe,git}` und `git`. Jeder Weg legt an/prüft, trägt in die Liste ein, macht den Vault **aktiv** und die Werkstatt wechselt **ohne Neustart** (Caches, Sperren, Kit-Vertrauen sind je Vault).
- `GET /api/vaults` · `POST /api/vaults/aktiv {pfad}` (nur eingetragene) · `POST /api/vaults/entfernen {pfad}` (nur aus der Liste, nie Dateien; war er aktiv → erster verbleibender oder keiner).
- `POST /api/vaults/neu {art:"vorlage"|"leer", name?, ordner?}` — `ordner` ist der **Vault-Ordner selbst** (Standard `~/Brain`, bei Kollision `~/Brain 2`, …; muss neu oder leer sein), `name` der Anzeigename (Standard: Ordnername). `vorlage`: `00_inbox/`, `09_wiki/` (`_schema.md`, `_log.md`, zwei belegte Beispielseiten mit Beleg-Dateien), `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `.gitignore`, dann `git init -b main` und Commit „Brain angelegt“; `leer`: `.gitignore`, `git init`, Commit „Vault angelegt“. Fehlt eine Git-Identität, wird sie nur in diesem Repo gesetzt (Mac-Benutzername).
- `POST /api/vaults/oeffnen {pfad, gitEinschalten?}` — Ordner muss existieren; `git:false`, wenn er kein Repo ist; mit `gitEinschalten:true`: `.gitignore` (falls fehlt), `git init -b main`, Commit „Versionsverlauf eingeschaltet“ nur mit Textdateien (`.md`/`.txt`); liegt der Ordner in einem anderen Repo → 409.
- `POST /api/vaults/klonen {url, ordner?, name?}` — URL-Regeln wie bei `git/remote`; Ziel darf nicht existieren oder muss leer sein; System-Git ohne Rückfragen (`GIT_TERMINAL_PROMPT=0`), Zeitlimit 300 s (**die Anfrage kann so lange dauern**); bei Fehler wird das Ziel wieder aufgeräumt; Fehler in Alltagssprache (privat/Anmeldung 403, nicht gefunden 404, offline 502).
- Pfadregeln (403/409): nicht `/`, `/Users`, `/Volumes`, das Home selbst, Systemordner (`/System /usr /bin /sbin /etc /Library /Applications /opt …`), `~/Library` (außer `Mobile Documents` und `CloudStorage`), der App-Ordner, versteckte Ordner unter dem Home, `.git`/`node_modules`/`.app`; nicht in einem anderen Vault und kein Ordner, der einen anderen Vault enthält. Symlinks werden aufgelöst.

**`GET /api/ki/erkennen[?neu=1]`** → `{agenten:[{id,name,version|null,pfad|null}]}` in fester Reihenfolge `claude`, `codex`, `gemini`, `cursor-agent`, `opencode`; gesucht in PATH und üblichen Orten (auch `~/.local/bin`, Homebrew, nvm …), Version per `--version` (5 s), 10 Minuten gecacht (`neu=1` umgeht).

**Ohne Vault:** jede Route außer `info`, `vaults/*`, `ki/erkennen`, `stopp` und den statischen Dateien antwortet 409 `{fehler, keinVault:true}`. `/api/info` → `{vault:null, name:null, …, kit:{vorhanden:false, vertraut:false}}`. Die Brücken-Startzeile hat dann `vaultId:null`.

**MCP:** ohne Vault-Argument folgt `brain-mcp.mjs` dem aktiven Vault aus `vaults.json` (bei jedem Aufruf geprüft; ohne aktiven Vault antworten die Werkzeuge mit einem Hinweis, der Server läuft weiter). Neues Werkzeug `brain_vaults` listet die Vaults (`*` = von diesem Server genutzt).

App → Oberfläche: Aktion `ordner-waehlen` (Kanal `aktion` mit Antwort) öffnet `NSOpenPanel` (nur Ordner) und liefert `{pfad}|null`.

## 6. Abnahme je Welle

Node-, Swift-, Playwright-Tests grün · Screenshots hell+dunkel bei 1440×900 neben die Tolaria-Bilder gelegt und selbst geprüft ·
Echtdaten-Lauf gegen eine Kopie von `~/brain` · am Ende EIN Opus-Review über Welle 1+2.

## 7. Zusagen aus dem Bauplan (Vergleichsseite, Fassung 2)

Was die Vergleichsseite unter „bei uns besser“ verspricht, gehört in die Wellen 3 und 4:

| Ablauf | Zusage | Welle |
|---|---|---|
| Commit | Commit-Dialog vorbelegt mit den Titeln der Notizen („Amazon Nachtlauf, Heimnetz Mesh aktualisiert“, ab 3: „… und 2 weitere“), ⌘↵ schickt ab; nur angehakte Dateien | 4 |
| Push abgelehnt | Klartext-Satz plus Knopf „Holen und erneut senden“ (fetch → ff/merge → push), Statusleiste „Pull nötig“ | 4 |
| Konflikt | Konflikt-Karte: beide Fassungen nebeneinander, absatzweise, mit Stand/Beleg, je Absatz „Diese gilt / Andere gilt“; Merge wird bei Fehler ganz abgebrochen (heute schon so) | 4 |
| Git aus | Ordner ohne Git: Frage „Git für diesen Vault einschalten?“ mit „Nie für diesen Vault / Später / Git einschalten“; danach nur „Git aus“ in der Statusleiste | 2 (Rest) |
| KI-Antwort | Quellen in der Antwort als Notiz-Chips mit Wahrheitspunkt; Schreiben nur als Vorschlag mit Diff und „Übernehmen“ | 4 |
| Palette | Leerzeichen am Anfang = Frage an Claude | 4 |
| Editor | Slash-Menü in Gruppen mit Kürzeln; Wikilink-Vorschläge mit Typ-Marke; Linkfarbe nach Zieltyp; kaputte Links grau; Link auf abgelaufene/strittige Seite zeigt das beim Schreiben | 3 |
| KI-Einstellungen | Keine API-Schlüssel in der App; „Mit Claude verbinden“ trägt MCP und Hooks selbst ein und lässt sich mit einem Klick zurücknehmen; KI-Flächen ganz abschaltbar | 4 |

Dazu aus der Sichtprüfung mit echten Daten (24.10. abends): fest umbrochene Absätze fließend anzeigen (Datei bleibt gleich, aktiver Absatz roh), Eigenschaften-Spalte klappt bei schmalem Fenster von selbst ein, „Verweist auf“ (Links im Text) im Eigenschaften-Panel, Maschinen-Ordner/Vorlagen/Agenten-Anweisungen nicht in „Alle Notizen“.

## 8. Vertrauen v2 (aus dem Opus-Review 24.10., K1/K2/W1)

Grundsatz: Nichts aus einem Vault startet ein Programm, bevor der Nutzer diesem Vault vertraut hat – weder Kit-Code (`.tools`)
noch Git-Hooks noch Git-Einstellungen, die Programme starten. Gilt für Werkstatt, MCP-Server und Swift gleich.

**Merker** `<support>/vertrauen.json`: `{ "<realpath des Vaults>": { seit, ordner: "<dev>:<ino>:<birthtimeMs>", code: "<sha256>" } }`.
- `ordner` bindet an genau diesen Ordner (gelöscht und neu geklont = neue Frage).
- `code` = sha256 über alle Code-Dateien unter `.tools/` (Endungen mjs/js/cjs/ts/sh/py/rb/pl/bash/zsh oder Ausführbar-Bit; ohne
  `node_modules`, ohne Dateien > 2 MB; Symlinks: Ziel-Text statt Inhalt) plus die Hook-Dateien, die Git ausführen würde
  (`core.hooksPath` aus der lokalen Konfiguration, sonst `.git/hooks/*` ohne `.sample`). Sortierte relative Pfade, je Datei Pfad + Größe + sha256.
  Geänderter Code (z. B. nach einem Abgleich) = neue Frage.
- Einträge im alten Format (nur `seit`) gelten als ungültig (`geaendert: true`).
- `klonen`, `neu` und `entfernen` löschen den Eintrag des Zielpfads.

**Git ohne Vertrauen:** jeder Aufruf mit `-c core.fsmonitor=false -c protocol.ext.allow=never` (immer, auch mit Vertrauen), Diff/Log/Show mit
`--no-ext-diff --no-textconv` (immer), Umgebung `GIT_EDITOR=:` und `GIT_SEQUENCE_EDITOR=:` (immer); ohne Vertrauen zusätzlich
`-c core.hooksPath=/dev/null` und unser `GIT_SSH_COMMAND`. Enthält die lokale Konfiguration (mit `include.path`) einen Schlüssel, den wir
nicht entschärfen können – `credential.helper`, `core.askPass`, `core.gitProxy`, `core.alternateRefsCommand`, `gpg.program`,
`gpg.*.program`, `merge.*.driver`, `filter.*.clean|smudge|process`, `remote.*.uploadpack|receivepack`, `protocol.*.allow` (außer never) –,
ist Git für diesen Vault **gesperrt**, bis er vertraut ist. Mit Vertrauen läuft Git mit der Konfiguration des Repos (Hooks wie gewohnt);
`GIT_SSH_COMMAND` setzen wir dann nur, wenn weder global noch lokal `core.sshCommand` steht.

**Schnittstelle**
- `GET /api/info` → zusätzlich `vertrauen: { erlaubt, noetig, geaendert, gitGesperrt, gruende: [{ art: "kit"|"hooks"|"git", text }] }`
  (ohne Vault `null`); `kit.vertraut` === `vertrauen.erlaubt`. `mcpBefehl` ohne Vault-Pfad (der MCP folgt dem aktiven Vault).
- `POST /api/kit/vertrauen { erlauben }` → `{ kit, vertrauen }`.
- Git gesperrt: `GET /api/git/status` → 200 `{ repo: true, gesperrt: true, grund }`; übrige Git-Routen → 409 `{ fehler, gitGesperrt: true }`;
  der Notiz-Index nutzt dann mtime statt Git-Zeiten.
- `node Ressourcen/werkstatt/vertrauen-pruefen.mjs <vault>` → stdout `{"erlaubt":true|false}`, Exit 0 (für Swift; liest denselben Merker
  mit derselben Logik, startet nichts aus dem Vault). Swift startet `brain.mjs status` und die Übersicht nur bei `erlaubt: true`.
- Aktion `vertrauen-geaendert` (Oberfläche → Swift, nur Studio) nach erfolgreichem `POST /api/kit/vertrauen`: Swift prüft neu,
  aktualisiert Status und Übersicht. `ansicht` ohne Vertrauen → `{ ok: false, grund: "nicht-vertraut" }`.
- `POST /api/mcp/verbinden`: Eintrag ohne Vault-Pfad; gibt es schon einen Server `brain` mit anderem Befehl → 409
  `{ fehler, art: "anders" }` (ohne Details des fremden Eintrags); mit `{ umstellen: true }` wird er ersetzt. `/api/probe` fragt über den
  MCP-Server selbst (stdio, `brain_suchen`), nicht direkt im Vault.
- Gesamtfristen in Node je Route (jeder Git-Aufruf bekommt nur das Restbudget): `git/remote` 120 s, `git/commit` 75 s,
  `vaults/oeffnen`/`vaults/neu` 300 s, `vaults/klonen` 300 s, `mcp/verbinden` 25 s. Swift: oeffnen/neu/klonen 330 s, git/remote 150 s,
  git/commit 90 s, sync 400 s, übrige git 90 s, Rest 30 s. Läuft die Frist ab, wird zurückgenommen (kein Vault-Wechsel, kein halbes Remote).
