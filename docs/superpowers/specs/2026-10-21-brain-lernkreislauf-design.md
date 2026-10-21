# Brain-Lernkreislauf — Design-Spezifikation

**Stand:** 21.10.2026 · **Ersetzt:** in der App-Spec (`2026-10-16-brain-app-design.md`) die noch offenen Teile von
M2 („Wahrheit + Kern v2“: W1–W7, K1, K4–K10, §12.1) und den Autopiloten aus M3 (§6). Die App bleibt eine spätere
Hülle; alles hier läuft im Kit, ohne App.
**Entscheidungen von Fabio:** Vertrauensstufen statt Freigabe jedes Eintrags (21.10.) · Lauf „einmal täglich
nachholen“ lokal auf dem Mac statt Server oder Cloud (21.10.) · Lektionen werden nur über Rückfragen aktiv ·
„mach, was du für richtig hältst“: Technik entscheidet Claude.

## 1. Ziel

Das Brain wächst ohne Pflegeaufwand mit und bleibt dabei richtig. Fabio beantwortet höchstens zehn kurze
Rückfragen pro Woche (Ja/Nein/A/B); alles andere erledigt ein täglicher Lauf selbst, nachvollziehbar und
rückgängig zu machen.

**Leitsatz unverändert:** Lieber eine Lücke als ein Fehler. Korrektheit entsteht nicht aus Vertrauen in die KI,
sondern aus Regeln, die ein Skript prüft (wörtliches Zitat, Herkunft, Widerspruchsprüfung), aus Git als Rückweg
und aus einer gemessenen Fehlerquote, die die Automatik selbst bremst.

**Erfolg (messbar, im Bericht):**

| Kennzahl | Ziel |
|---|---|
| Offene Vorschläge (heute 442) | dauerhaft < 30 |
| Offene Rückfragen | ≤ 10, Antwortaufwand ≤ 10 min/Woche |
| Fehlerquote der automatischen Übernahmen (Stichprobe + Rücknahmen + W7) | ≤ 5 % |
| Inbox-Notizen älter als 7 Tage | 0 (ab Bauabschnitt 3) |

## 2. Was es heute gibt (Ausgangslage, Kit-Stand a089540)

- **Ernte** (`ernte.mjs`, Haiku über `claude -p --tools ""`): am Sitzungsende ≤ 5 Fakten + 1 Stand je Sitzung →
  `00_inbox/_vorschlaege/<id>.md`. Kein Zitat, keine Herkunft.
- **Lektionen** (`lektionen.mjs`): wiederholte Korrekturen/Fehlschläge → Rohkandidaten; aktiv werden sie über
  `09_wiki/_lektionen.md`, das `regeln-lesen.mjs` beim `Read` passender Dateien einspielt.
- **Pflege** (`pflege.mjs` Bericht, `pflegelauf.mjs` Haiku-Vorschläge), **Konflikt-Kästen** + `entscheidungen.mjs`,
  **Gültigkeit** (`stand`, `pruefen_bis`, `verfall`), **Lint**, **pre-commit** (Secrets, Struktur, rev+1, `_log.md`).
- **Ins Wiki schreibt nur der Skill `/ingest`** (interaktiv). Es gibt keinen automatischen Schreibweg, keinen
  geplanten Lauf, keine Zitatprüfung, keine Vertrauensstufen, kein Aktionsprotokoll.
- Ergebnis: 442 Vorschläge (337 fakt, 75 stand, 30 lektion), 8 Inbox-Notizen, 3 offene Konflikte — alles wartet
  auf Fabio.

## 3. Überblick

```
Sitzungen ──Ernte (+Zitat, +Herkunft)──▶ _vorschlaege/
Inbox-Notizen ─────────────────────────▶ 00_inbox/
Lektions-Rohkandidaten ────────────────▶ _vorschlaege/ (art: lektion)

Tageslauf (1×/Tag nachholen, Mac)
  1 Aufräumen        Regeln, 0 Tokens      Dubletten, überholte Stände, Unbelegtes → Archiv
  2 Belege nachholen Haiku + Regelprüfung  nur Altbestand ohne Zitat
  3 Einordnen        Suche + Aliasse       Zielseite bestimmen (kein LLM)
  4 Abgleich         Haiku                 neu / schon drin / widerspricht / unklar
  5 Stufe            Regeln                🟢 übernehmen · ⚪ aussortieren · 🟡 Rückfrage · ⏸ warten
  6 Schreiben        Node, kein LLM        Arbeitskopie (Git-Worktree), 1 Commit je Fakt, pre-commit
  7 Übernehmen       git ff-merge          sonst nächster Lauf
  8 Rückfragen       Regeln                Deckel 10, Priorität, Stichprobe
  9 Lektionen        Haiku formuliert      → Rückfrage
 10 Bericht          Regeln                .logs/tageslauf/, eine Zeile beim Sitzungsstart
 (B3) Inbox einarbeiten, Konsolidieren, neue Seiten  Sonnet mit Schutzgeländern
```

**Grundsatz der Trennung:** In Bauabschnitt 2 hat keine KI Schreibwerkzeuge (`--tools ""`). Die KI liefert nur
Urteile (Text/JSON); jedes Schreiben macht Node deterministisch. Damit kann auch eingeschleuster Text in einem
Transkript nichts ins Wiki schreiben, was nicht wörtlich belegt ist.

## 4. Bauabschnitt 1 — Wahrheit und Belege (Fundament)

Nichts schreibt automatisch ins Wiki, bevor B1 steht (wie in der App-Spec §14).

### 4.1 Beleg je Fakt (W1, W2)

Ein Vorschlag bekommt drei neue Frontmatter-Felder:

| Feld | Inhalt |
|---|---|
| `zitat` | wörtlicher Auszug aus dem Transkript (≤ 300 Zeichen), der die Aussage trägt |
| `herkunft` | `du` · `tool` · `web` · `ki` — regelbasiert aus der Fundstelle bestimmt |
| `fundstelle` | `<sitzung>#<uuid der Nachricht>` + Zeitstempel |

- **Neues Modul `beleg.mjs`:** `findeZitat(transkriptZeilen, zitat)` sucht das Zitat normalisiert (Leerraum
  zusammengefasst, typografische Anführungszeichen/Striche vereinheitlicht, sonst wörtlich, Groß/Klein zählt) und
  liefert `{ herkunft, uuid, zeit, werkzeug }` oder `null`.
- **Herkunft aus der Fundstelle:**
  - Nutzer-Text → `du`.
  - Werkzeug-Ergebnis von `Read`/`Bash`/`Grep`/`Glob`/`mcp__*` → `tool`.
  - `WebFetch`/`WebSearch` → `web`.
  - Assistenten-Text → `ki`.
  - Eingespielter Kontext (`<system-reminder>`, Hook-Ausgaben, Brain-Hinweise, Skill-Texte) → `ki`. Sonst würde
    das Brain sich selbst bestätigen.
  - Steht das Zitat an mehreren Stellen, gilt die stärkste Herkunft in der Reihenfolge `tool` > `du` > `web` > `ki`.
- **Ernte:** Der Haiku-Auftrag verlangt je Fakt ein wörtliches Zitat. Node prüft es mit `findeZitat`. Ohne Treffer
  oder mit Herkunft `ki` wird der Fakt nicht gespeichert, nur gezählt (`ernte.log`: `ohneBeleg`, `nurKi`). `web`
  bleibt erhalten und wird später zur Rückfrage.

### 4.2 Zeit und Ersetzen (W3)

- **Neue Seitenfelder:** `gilt_seit` (YYYY-MM-DD), `ersetzt_durch` (Wikilink auf die Nachfolgeseite), `kritisch`
  (bool), `zweifel` (`"<datum>: <grund>"`, gesetzt durch W7). `stand`, `pruefen_bis` und `verfall` werden in
  `_schema.md` dokumentiert (fehlen dort heute).
- **Fakt-Zeilen** (das Format, das der Tageslauf schreibt):
  `- <Aussage> · Stand 21.10.2026 · [[<cluster>/belege/<JJJJ-MM>/<id>]]` (Pfad-Link wie bei Rohquellen, Lint `TOTER LINK` greift)
- **Ersetzte Fakt-Zeile:** `- ~~<Aussage>~~ · ersetzt am 23.10.2026 durch die Zeile darunter`. Sie bleibt
  sichtbar, bis die Konsolidierung (B3) sie entfernt. Die Historie liegt in Git.
- **Stand-Abschnitt:** Projektseiten bekommen `## Stand` (wird ersetzt) und `## Verlauf` (eine Zeile je früherem
  Stand, neueste oben, höchstens 10).
- **Lint:**
  - `ERSETZT`: Ziel fehlt, oder eine ersetzte Seite wird noch verlinkt.
  - `KRITISCH`: kein bool.
  - `ZWEIFEL`: gesetzt, wird als PRÜFBEDÜRFTIG gezeigt.
  - `FAKT-BELEG`: Fakt-Zeile ohne existierenden Beleg-Link.
- **Hinweise (W6):** Seiten mit `ersetzt_durch` werden nie als aktuell gezeigt, sondern als „ersetzt → [[neu]]“.
  `zweifel` erscheint als PRÜFBEDÜRFTIG.

### 4.3 Kritisch (W5) und heikel

- `kritisch: true` auf einer Seite: Der Tageslauf ändert sie nie (auch B3 nicht). Ein neuer Fakt dafür wird zur
  Rückfrage.
- **Heikel** (Regeln, 0 Tokens, Modul `heikel.mjs`): Geldbeträge/Preise/Kosten, Vertrag/Recht/DSGVO,
  Personennamen (vorhandener PII-Filter), Zugänge/Server/Produktion (vorhandene Secret-Muster + Wortliste). Ein
  heikler Fakt wird nie automatisch übernommen, sondern zur Rückfrage.

### 4.4 Fehler-Signal (W7, K8)

- **Erkennung** (bei `SessionEnd`, 0 Tokens): Folgt auf eine Antwort, vor deren Prompt ein Brain-Hinweis auf Seite X
  gezeigt wurde (`gezeigt.mjs`/Hinweis-Log), eine Nutzer-Korrektur (Muster aus `lektionen.mjs`), dann wird
  `{seite, sitzung, zitat der Korrektur}` an `.logs/w7.jsonl` angehängt.
- **Folge:** Der Tageslauf setzt `zweifel` auf der Seite und legt eine Rückfrage an. Stammt die gezeigte Stelle aus
  einer automatischen Übernahme der letzten 60 Tage, zählt das als Fehler (§6.3).

### 4.5 Entitäts-Aliasse (K5, Teil für das Einordnen)

- Frontmatter `auch_genannt: ["nucleus", "nucleus-base"]` auf Entitätsseiten.
- `brain-index` baut daraus `.logs/aliasse.json`.
- Lint `DOPPELTER NAME` nutzt sie (Namens-Dubletten).

## 5. Bauabschnitt 2 — Tageslauf und Rückfragen (Kern)

### 5.1 Wann er läuft

- **Befehl:** `brain tageslauf [--wenn-faellig] [--probe] [--nur-antworten]`.
- **Sperre:** PID + Startzeit in `.logs/tageslauf/lauf.lock` (§12.1 Nr. 5). Eine tote PID gibt die Sperre frei.
- **Fällig:** letzter *erfolgreicher* Lauf > 20 h her.
- **Hintergrunddienst (Standard):** Ein LaunchAgent `de.brain.tageslauf` ruft jede Stunde
  `tageslauf --wenn-faellig --dienst` auf. Mit `--dienst` gelten zusätzlich:
  - am Netzteil (`pmset -g ps`; Geräte ohne Akku zählen immer als am Netz)
  - ≥ 10 min keine Eingabe (`ioreg -c IOHIDSystem`, HIDIdleTime)

  Ruhezustand: Der Lauf kommt beim nächsten stündlichen Takt nach dem Aufwachen. Mac aus: Er kommt beim nächsten
  Einschalten. Verpasste Tage ergeben einen Lauf.
- **Einrichten:** `brain dienst an|aus|status` schreibt bzw. entfernt die plist in `~/Library/LaunchAgents` und
  ruft `launchctl bootstrap/bootout`. Den Node-Pfad erkennt der Befehl, er ist nicht fest eingetragen. Fabio führt
  `brain dienst an` einmal selbst aus (Claude ändert keine LaunchAgents).
- **Rückfall ohne Dienst:** `SessionStart` startet den Lauf losgelöst, wenn kein Dienst eingerichtet ist und der
  Lauf fällig ist, oder wenn der Dienst eingerichtet ist, aber seit > 36 h nichts lief. Dann ohne Leerlauf-Prüfung.
- **Ohne Netz oder ohne `claude`:** Schritte mit KI entfallen. Der Lauf gilt dann nicht als erfolgreich und wird
  beim nächsten Takt wiederholt. Die Regel-Schritte (1, 8, 10) laufen trotzdem.
- **Budget je Lauf:** höchstens 60 KI-Aufrufe und 15 min Laufzeit (`automatik.tageslaufBudget`). Was übrig
  bleibt, kommt beim nächsten Lauf dran. Den Altbestand arbeitet der Lauf so über mehrere Tage ab.

### 5.2 Die Schritte

1. **Aufräumen (0 Tokens).** Ins Archiv `90_archiv/vorschlaege-aussortiert/<grund>/` (verschieben, nie löschen)
   kommen:
   - exakte und nahe Dubletten untereinander (`import/aehnlich.mjs`)
   - `stand`-Vorschläge, zu denen es einen neueren aus demselben Ordner gibt
   - Lektions-Rohkandidaten, die seit 14 Tagen nicht wieder aufgetreten sind
   - Vorschläge mit `herkunft: ki`
2. **Belege nachholen (nur Altbestand).**
   - Je Sitzung: ein Haiku-Aufruf mit den Vorschlägen dieser Sitzung und den Nutzer- und Werkzeug-Abschnitten des
     Transkripts (Stufe-0-Zerlegung, ≤ 30 000 Zeichen je Aufruf, sonst in Teilen).
   - Antwort: ein Zitat je Vorschlag. Danach prüft `findeZitat`.
   - Kein Treffer oder Transkript fehlt → aussortiert (`kein-beleg`).
   - Transkripte sucht der Lauf zuerst in `.logs/transkript-sicherung/` (am 21.10. von Fabio angelegt, 53
     Sitzungen des Altbestands), dann unter `~/.claude*/projects/`.
3. **Einordnen (0 Tokens, K9).**
   - Zielseite über die lokale Suche (`minisuche`/BM25 über Titel, `description`, `fragen`, `auch_genannt`).
     Treffer nur über einer Mindestgüte.
   - `stand` geht auf die Projektseite, deren `repo`/`pfade` zum `quelle_ordner` passt (K14-Felder).
   - Keine Zielseite → **Warten** (`00_inbox/_warten/`). Bauabschnitt 3 macht daraus neue Seiten. Nach 60 Tagen
     ohne Seite → Archiv.
4. **Abgleich (Haiku, `--tools ""`).**
   - Eingabe: Fakt + Zitat + die passenden Abschnitte der Zielseite (≤ 6 000 Zeichen).
   - Ausgabe als JSON: `neu | schon_drin | widerspricht | unklar`, bei `widerspricht` mit der betroffenen Zeile.
   - Vorfilter ohne KI: Bei gleicher Entität und abweichender Zahl, abweichendem Datum oder Verneinung wird
     `widerspricht` vorgeschlagen und nur bestätigt.
5. **Stufe (Regeln).**

   | Stufe | Bedingung (alle) |
   |---|---|
   | 🟢 übernehmen | `herkunft` ∈ {du, tool} · Zitat geprüft · Abgleich `neu` · Zielseite nicht `kritisch` · nicht heikel · Autostufe erlaubt es (§6.3) |
   | 🟢 Stand ersetzen | `art: stand` · `herkunft` ∈ {du, tool} · Projektseite gefunden · nicht `kritisch` |
   | ⚪ aussortieren | Abgleich `schon_drin` · oder Schritt 1/2 |
   | 🟡 Rückfrage | `widerspricht`/`unklar` · `web` · heikel · Zielseite `kritisch` · `lektion` · W7 |
   | ⏸ warten | keine Zielseite · Prüfung rot (Schritt 6) · Rückfragen-Deckel voll |

6. **Schreiben (Node, kein LLM).**
   - In einer Arbeitskopie: `git worktree add ~/Library/Caches/brain-tageslauf/<lauf> -b tageslauf/<lauf>` (außerhalb
     des Vaults, damit Suche und Index sie nicht sehen).
   - Je 🟢-Vorschlag:
     - Beleg-Datei `<cluster>/belege/<JJJJ-MM>/<id>.md` anlegen (Vorschlag samt Zitat, Herkunft, Fundstelle).
     - Fakt-Zeile unter `## Fakten` der Zielseite einfügen (Abschnitt anlegen, falls er fehlt).
     - `quellen`/`quellen_sha` ergänzen, `rev`+1, Eintrag in `_log.md`.
     - **ein Commit** `auto(<lauf>): <titel> → <seite> [<id>]`.
   - Der pre-commit läuft wie bei jedem Commit (Secrets, Struktur, rev, Log). Ist er rot, wird die Änderung
     verworfen und der Vorschlag kommt nach Warten (`pruefung-rot`) mit Befund.
   - Den Cluster bestimmt der Bereich der Zielseite über `brain.config.json`.
7. **Übernehmen.**
   - Im Vault, nur wenn er auf `main` steht: `git merge --ff-only tageslauf/<lauf>`.
   - Ist `main` weitergelaufen: in der Arbeitskopie rebasen und dann erneut versuchen.
   - Konflikt oder eine lokale Änderung an derselben Datei: abbrechen, Arbeitskopie verwerfen, Vorschläge bleiben
     offen und kommen im nächsten Lauf dran.
   - Danach Arbeitskopie und Branch entfernen; die Commits liegen in `main`.
   - Verschobene Vorschlagsdateien (nicht in Git) werden erst nach erfolgreichem Merge bewegt und im
     Aktionsprotokoll vermerkt.
8. **Rückfragen auffüllen** (§5.3).
9. **Lektionen.**
   - Rohkandidaten mit ≥ 2 Vorkommen formuliert Haiku (vorhandener `mit-ki`-Auftrag) zu Regel, Warum, Wie und
     „Gilt für“ (Dateimuster oder leer = allgemein).
   - Daraus wird eine Rückfrage vom Typ `lektion`.
   - Bei „Ja“: `lektionen ins-wiki`. Allgemeine Lektionen (ohne Dateimuster) spielt der `SessionStart` ein (≤ 600
     Zeichen, neueste und meistgenutzte zuerst), dateibezogene wie bisher beim `Read`.
10. **Bericht.**
    - `.logs/tageslauf/<datum>.md` (lesbar) und `.logs/tageslauf/aktionen.jsonl`. Je Aktion: `lauf`, `id`, `stufe`,
      `ziel`, `commit`, `grund`.
    - Kurzform in `.logs/tageslauf/letzter.json` für `SessionStart`, `brain status --json` und später die App.

**Probemodus** (`--probe`, Schalter `automatik.tageslauf: probe`): Alle Schritte rechnen, nichts wird geschrieben,
verschoben oder gemerged. Der Bericht sagt „würde …“. Startzustand nach der Installation ist `probe`.

### 5.3 Rückfragen

(Neuer Name, weil „Karten“ im Kit schon die Such-Karteikarten meint.)

- **Ablage:** `00_inbox/_rueckfragen/<id>.md`, Modul `rueckfragen.mjs`.
- **Typen:**

  | Typ | Inhalt | Antworten |
  |---|---|---|
  | `widerspruch` | A (Wiki-Zeile + Quelle) gegen B (neuer Fakt + Zitat) | A gilt · B gilt · beide (verschiedener Zusammenhang) · weiß nicht |
  | `heikel` | Fakt + Zitat + Zielseite | übernehmen · verwerfen |
  | `web` | Fakt + Quelle (URL) | übernehmen · verwerfen |
  | `lektion` | fertig formulierte Regel | aktivieren · verwerfen · (Freitext = ändern) |
  | `zweifel` (W7) | Seite + deine Korrektur | Seite stimmt · Seite falsch (welche Stelle?) |
  | `konflikt` | bestehende `[!KONFLIKT]`-Kästen | A · B · beide · später |
  | `stichprobe` | ein automatisch übernommener Fakt + Zitat | stimmt · stimmt nicht |
  | `veraltet` (K7) | abgelaufene, oft genutzte Seite | stimmt noch · ist überholt |

- **Deckel:** höchstens 10 offene.
- **Reihenfolge:** `zweifel` > `widerspruch`/`konflikt` auf oft genutzten Seiten (Hinweis-Log) > `lektion` >
  `heikel` > `veraltet` > `web`.
- **Rest:** Was nicht unter den Deckel passt, wartet und wird nicht angezeigt. `web`- und `heikel`-Rückfragen
  verfallen nach 60 Tagen ins Archiv; bis dahin bleibt die Lücke.
- **Stichprobe:** zwei je Woche, zufällig aus den automatischen Übernahmen der letzten 30 Tage (bevorzugt
  ungeprüfte). Sie zählt außerhalb des Deckels.
- **Beantworten:**
  - Skill `/rueckfragen` stellt die Fragen per `AskUserQuestion`, vier je Block, mit Zitat und Quelle in der
    Beschreibung.
  - CLI `brain rueckfragen [liste|antwort <id> <wahl> [notiz]]` für die spätere App.
  - Die Antwort wird sofort gespeichert. Angewendet wird sie mit `brain tageslauf --nur-antworten` (startet der
    Skill am Ende losgelöst) oder beim nächsten Lauf.
- **Anwenden:**
  - `widerspruch` A/B → Supersession nach §4.2.
  - `konflikt` → Entscheidung (`entscheidungen.mjs`, wie heute). Das Auflösen des Kastens macht B3, bis dahin
    `/ingest`.
  - `lektion` → `ins-wiki`.
  - `stichprobe` „stimmt nicht“ → wie `brain zurueck <id>` und zählt als Fehler.

### 5.4 Rückgängig

- `brain zurueck <lauf|id>`:
  - `git revert` der zugehörigen Commits (neuer Commit, nichts wird umgeschrieben).
  - Die nicht versionierten Verschiebungen aus dem Aktionsprotokoll werden zurückverschoben.
  - Betroffene Vorschläge → `90_archiv/vorschlaege-abgelehnt/`.
- Jede Rücknahme einer automatischen Übernahme zählt als Fehler (§6.3).

### 5.5 Sitzungsstart

- Statt der heutigen Zählzeilen („412 neue Vorschläge …“, „30 Lektionen warten …“) eine Zeile:
  `Brain hat gelernt (21.10.): 7 übernommen · 31 aussortiert · 3 Rückfragen offen — „Rückfragen“ sagen · Fehlerquote 0/12`
- Ist die Autostufe nicht `normal`, steht das dabei.
- Ist der Lauf seit > 3 Tagen nicht erfolgreich gewesen, steht der Grund dabei.

## 6. Sicherheit, Korrektheit, Selbstbremse

### 6.1 Schutzgeländer (Zusammenfassung)

- Kein KI-Schreibzugriff in B2.
- Das Zitat wird vom Skript geprüft.
- Eingespielter Kontext zählt nie als Beleg.
- Kritische und heikle Inhalte fasst der Lauf nie an.
- Widersprüche löst nie die KI auf.
- Ein Commit je Fakt.
- Der pre-commit gilt auch für den Lauf.
- Merge nur als Fast-Forward.
- Archiv statt Löschen.
- Aktionsprotokoll.

### 6.2 Neue Regeln für eine KI mit Schreibrechten (nur B3)

- Arbeitskopie außerhalb des Vaults.
- `--allowedTools` nur `Read, Edit, Write, Glob, Grep` und `Bash(node .tools/brain.mjs …)`; kein Web, kein MCP.
- `BRAIN_ERNTE=1`.
- Nach dem Lauf prüft Node den Diff:
  - keine Änderung an `kritisch`-Seiten, generierten Dateien oder `.tools/`
  - je Seite ≤ 20 % entfernte Zeilen
  - jeder vorher vorhandene Beleg-Link ist noch da
  - Lint und pre-commit grün

  Ist eine dieser Prüfungen nicht erfüllt, wird der ganze Quellen-Commit verworfen und landet als Befund im
  Bericht.

### 6.3 Fehlerquote und Autostufe

- **Fehler:**
  - Stichprobe „stimmt nicht“
  - `brain zurueck` einer automatischen Übernahme
  - W7-Treffer auf einer automatisch geschriebenen Stelle
- **Geprüft:** beantwortete Stichproben + Rücknahmen + W7-Treffer + automatische Übernahmen, die älter als 30 Tage
  sind und ohne Beanstandung genutzt wurden (Hinweis-Log).
- **Quote:** über die letzten 40 Prüfungen.
- **Autostufe** (`.logs/tageslauf/autostufe.json`, selbstregelnd):
  - `normal`: Regeln aus §5.2.
  - `eng`, wenn die Quote > 5 % ist: nur `herkunft: tool`, keine neuen Seiten, Stichprobe 4 je Woche.
  - `aus`, wenn die Quote > 15 % ist: alles 🟢 wird zur Rückfrage, und beim Sitzungsstart erscheint eine Warnung.
  - Zurück eine Stufe nach 20 Prüfungen in Folge ohne Fehler.

## 7. Bauabschnitt 3 — Pflege-Intelligenz (Sonnet mit Schutzgeländern)

1. **Inbox einarbeiten.**
   - Je Lauf höchstens 2 Notizen aus `00_inbox/` (Rohquellen, keine Vorschläge).
   - Headless nach dem bestehenden `/ingest`-Skill mit den Regeln aus §6.2: einsortieren, Seiten schreiben,
     Konflikt-Kästen statt Auflösung, ein Commit je Quelle.
   - Notizen, die aus Web- oder KI-Recherche stammen (Erkennung: URLs, „Recherche“, Herkunftszeile), bekommen
     `herkunft: web` auf den berührten Abschnitten. Der Hinweis sagt dann „laut Web-Recherche“.
2. **Konsolidieren** (monatlich je Seite mit ≥ 5 Fakt-Zeilen oder > 8 KB).
   - Sonnet arbeitet `## Fakten` in den Fließtext ein und entfernt ersetzte Zeilen, die älter als 90 Tage sind.
   - Die Prüfung aus §6.2 gilt. Zusätzlich prüft ein Haiku-Abgleich je ursprünglicher Fakt-Zeile: „Steht das
     noch drin?“ (`ja`/`nein`). Bei einem Nein wird verworfen.
3. **Neue Seiten aus dem Wartebereich.** Erst ab ≥ 3 belegten Fakten aus ≥ 2 Sitzungen zum selben Thema
   (Häufung über die Suche). Die Seite wird im passenden Bereich angelegt und landet im Bericht.
4. **Entscheidungen anwenden.** Beantwortete `konflikt`-Rückfragen lösen den Kasten so auf, wie Fabio entschieden
   hat (Schutzgeländer wie oben).
5. **K4 Drift-Liste** (`09_wiki/_ausgemustert.md`: alter Begriff → neuer). Lint und Abgleich melden lebende
   Erwähnungen.
6. **K7 Prüfen nach Nutzung.** Abgelaufene Seiten, sortiert nach Nutzung × Alter, werden zu `veraltet`-Rückfragen.
   Projektseiten prüft der Lauf vorher selbst gegen das Repo (K14). Nie genutzte Seiten > 180 Tage → Bericht
   „Archiv-Kandidat“, nichts automatisch.
7. **Härtung, Rest aus §12.1.** Kein fester Node-Pfad in Hooks und plist; Sicherung nur bei Änderung.

## 8. Reihenfolge, Abnahme, Inbetriebnahme

| Abschnitt | Ergebnis | Abnahme |
|---|---|---|
| **B1 Wahrheit** | Ernte mit Zitat + Herkunft, Schema/Lint W3/W5, `heikel`, W7-Erkennung, Aliasse | Tests grün; Zitat-Treue im Prüfset 100 %; eine echte Ernte nach Merge hat Zitate |
| **B2 Tageslauf** | Schritte 1–10, Rückfragen + Skill, `zurueck`, Dienst, Sitzungsstart-Zeile, Probemodus | Tests grün; **Probelauf über den Altbestand** (Brain nachweislich unverändert, Claude prüft alle 🟢-Kandidaten gegen die Transkripte, jeder Fehler wird vor `an` behoben); danach Schalter `an` mit **Einschwingphase** (geändert 21.10.: der Altbestand lieferte zu wenige 🟢 für 20 Stichproben) — die ersten N = 20 automatischen Übernahmen prüft Fabio einzeln per Rückfrage; solange weniger als N mit „stimmt“ beantwortet sind, schreibt der Lauf höchstens so viele Übernahmen, wie Prüfplätze frei sind (≤ 10 offen), „stimmt nicht“ stellt die Autostufe sofort auf die vorsichtigste Stufe |
| **B3 Pflege** | Inbox headless, Konsolidieren, neue Seiten, Entscheidungen, K4, K7, Härtung | Tests grün; Probe an einer Kopie des Vaults; Diff-Prüfung |

- **Entwicklung:** neuer Worktree `~/brain-kit-v0.7`, Branch `kit-v0.7` vom aktuellen `main` des Brains. Merge
  je Bauabschnitt nach grünen Tests, und vor dem Live-Schalten ein Opus-Review je Bauabschnitt (bei B2 mit
  Probelauf-Bericht).
- **Termin für B2:** entschärft — die 53 Transkripte des Altbestands sind seit 21.10. in
  `.logs/transkript-sicherung/` gesichert. Trotzdem zügig, weil neue Vorschläge täglich dazukommen.
- ~~Termin für B2: vor dem 05.11.2026.~~ Bis dahin liegen die Transkripte des Altbestands noch vor; Claude Code
  räumt sie nach etwa 30 Tagen ab. Gehen sie verloren, kann der Altbestand nicht belegt werden und wird
  aussortiert.
- **KI-Kosten:** über `claude -p` (Fabios Claude-Zugang, kein API-Schlüssel). Haiku für Ernte, Belege, Abgleich
  und Lektionen; Sonnet nur in B3. Token-Zahlen stehen je Lauf im Bericht.

## 9. Bewusst nicht

- Kein Server, keine Cloud, keine Graph-Datenbank, keine Vektor-Datenbank neu.
- Keine automatische Auflösung von Widersprüchen.
- Keine automatische Aktivierung von Lektionen. Skills legt der Lauf nur als Entwurf an, er installiert nichts.
- Keine Änderungen an `~/.claude*/settings.json`, LaunchAgents oder globaler `CLAUDE.md` durch Claude. Fabio
  führt `brain dienst an` und `brain hooks-install` selbst aus.
- Kein Firmen-Wissen in den Knowledge Collective schreiben (bleibt getrennt).

## 10. Tests (je Abschnitt, `node:test`, Temp-Vaults, `fake-claude`)

- **`beleg`:**
  - Zitat wörtlich, normalisiert, fehlt
  - Herkunft je Rolle; `system-reminder` und Hook-Text → `ki`
  - Mehrfachfund → stärkste Herkunft
- **`ernte`:** Zitat fehlt → verworfen; `ki` → verworfen; `web` → behalten.
- **`tageslauf`:**
  - jede Stufe aus §5.2 mit einem Beispiel
  - Probemodus schreibt nichts (Datei- und Git-Vergleich)
  - Arbeitskopie; ff-Merge; `main` weitergelaufen; Konflikt → abbrechen ohne Schaden
  - pre-commit rot → Warten
  - Sperre mit toter PID
  - Budget-Abbruch und Fortsetzung
- **`rueckfragen`:** Deckel, Reihenfolge, Verfall, jede Antwortart angewendet, Stichprobe.
- **`zurueck`:** Revert + Zurückverschieben; zählt als Fehler.
- **Autostufe:** Übergänge `normal` → `eng` → `aus` → zurück.
- **`dienst`:** plist-Inhalt, Leerlauf- und Strom-Prüfung (Befehle per Testhaken ersetzt).
- **B3:** Diff-Prüfung (kritisch, 20 %, Beleg-Links), Verwerfen bei Verstoß.
