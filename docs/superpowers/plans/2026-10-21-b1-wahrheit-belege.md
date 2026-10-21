# B1 „Wahrheit und Belege“ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Kit bekommt das Fundament „Wahrheit“: Jeder geerntete Fakt trägt ein wörtliches, vom Skript geprüftes Zitat mit regelbasierter Herkunft (du · tool · web · ki), Wiki-Seiten bekommen Zeit-/Ersetzt-/Kritisch-/Zweifel-Felder mit Lint, ein `heikel`-Filter, das Fehler-Signal W7 und Entitäts-Aliasse — alles ohne einen einzigen automatischen Schreibzugriff aufs Wiki.

**Architecture:** `beleg.mjs` (parallel gebaut, Schnittstelle fest) kennt als einzige Stelle die Regeln „Zitat finden“ und „Herkunft je Rolle“; das neue `beleg-ernte.mjs` ergänzt, was die Ernte drumherum braucht (Selbstbestätigungs-Sperre fürs eigene Brain, Web-Adresse, Fundstelle). `ernte.mjs` prüft damit nach der Haiku-Antwort jedes Zitat und speichert nur belegte Vorschläge (`vorschlaege.mjs` bekommt die Felder). Reine Bausteine für den Tageslauf (B2): `heikel.mjs` (parallel gebaut), `seitenfelder.mjs`, `fakten.mjs`, `aliasse.mjs`; `brain-lint.mjs`, `brain-index.mjs` und `hint-core.mjs` (W6) binden sie ein. `w7.mjs` erkennt „Brain-Hinweis → Antwort → Korrektur“ direkt im Verlauf und läuft losgelöst über den bestehenden `ernte-ausloeser.mjs`.

**Tech Stack:** Node-ESM (nur Standardbibliothek), `node --test`, Bash-Testsuiten des Kits (`.tools/tests/run-all.sh`), `fake-claude.mjs`, git-CLI. Keine neuen Abhängigkeiten.

**Spec:** `/Users/fbFirma/source/brain-app/docs/superpowers/specs/2026-10-21-brain-lernkreislauf-design.md` — §4 komplett (4.1–4.5), §6.1 (Schutzgeländer, soweit B1), §8 (Abnahme B1, Worktree), §9 (Bewusst nicht), §10 (Tests `beleg`, `ernte`).

## Global Constraints

- **Leitsatz** (§1): „Lieber eine Lücke als ein Fehler.“ Im Zweifel `ki`, `ohneBeleg`, `heikel`, `kritisch` — nie umgekehrt.
- **Kein automatisches Schreiben ins Wiki** (§4): „Nichts schreibt automatisch ins Wiki, bevor B1 steht.“ B1 schreibt nur Vorschläge (`00_inbox/_vorschlaege/`), `.logs/*` und Doku. Schreib-Bausteine für Fakt-Zeilen (einfügen/ersetzen) kommen erst mit B2.
- **0 Tokens** für W7, `heikel`, Lint, Index, Hinweis (§4.3/§4.4): nur Regeln. Die Ernte behält ihren **einen** bestehenden Haiku-Aufruf (`claude -p --tools ""`), kein zusätzlicher Aufruf.
- **Zitat** (§4.1): `zitat` = wörtlicher Auszug aus dem Transkript, **≤ 300 Zeichen**; Suche normalisiert („Leerraum zusammengefasst, typografische Anführungszeichen/Striche vereinheitlicht, sonst wörtlich, Groß/Klein zählt“).
- **Herkunft** (§4.1): Nutzer-Text → `du`; Ergebnis von `Read`/`Bash`/`Grep`/`Glob`/`mcp__*` → `tool`; `WebFetch`/`WebSearch` → `web`; Assistenten-Text → `ki`; eingespielter Kontext (`<system-reminder>`, Hook-Ausgaben, Brain-Hinweise, Skill-Texte) → `ki`. Mehrfachfund: **`tool` > `du` > `web` > `ki`**.
- **Fundstelle** (§4.1): `<sitzung>#<uuid der Nachricht>` + Zeitstempel → Format `"<sitzung>#<uuid> <ISO-Zeit>"`.
- **Ernte** (§4.1): Ohne Treffer oder mit Herkunft `ki` wird der Fakt nicht gespeichert, nur gezählt (`ernte.log`: `ohneBeleg`, `nurKi`). `web` bleibt erhalten.
- **Fakt-Zeilen** (§4.2), exakt: `- <Aussage> · Stand 21.10.2026 · [[<cluster>/belege/<JJJJ-MM>/<id>]]` und `- ~~<Aussage>~~ · ersetzt am 23.10.2026 durch die Zeile darunter` (Mittelpunkt `·` = U+00B7).
- **Neue Seitenfelder** (§4.2): `gilt_seit` (YYYY-MM-DD), `ersetzt_durch` (Wikilink), `kritisch` (bool), `zweifel` (`"<datum>: <grund>"`); `stand`, `pruefen_bis`, `verfall` in `_schema.md` dokumentieren. Aliasse (§4.5): `auch_genannt: ["nucleus", "nucleus-base"]` → `.logs/aliasse.json`.
- **Bewusst nicht** (§9): „Keine Änderungen an `~/.claude*/settings.json`, LaunchAgents oder globaler `CLAUDE.md` durch Claude.“ B1 registriert keinen neuen Claude-Hook und ändert keinen Skill — W7 hängt am bestehenden SessionEnd/PreCompact-Eintrag `ernte-ausloeser.mjs`.
- **Arbeitsort** (§8): Worktree `~/brain-kit-v0.7`, Branch `kit-v0.7` vom aktuellen `main` des Brains. Nie direkt in `~/brain` ändern. Merge (nur Fast-Forward) erst im letzten Task, nach grünen Tests, nach dem einen Opus-Review und **nur nach ausdrücklicher Freigabe der Hauptsitzung**.
- **Tests** (§10): `node:test`, Temp-Vaults, `fake-claude`. HOME/USERPROFILE auf Temp, PATH ohne echtes `claude`; Tests fassen nie das echte `~/brain` oder echte Transkripte an. Neue Testdateien je < 2 s (der pre-commit führt alle `test-*.mjs` mit 45-s-Grenze aus; heute ≈ 12 s).
- **Export-Regeln** (gelten auch für Tests, `publish-check.mjs`): keine `/Users/<x>`- oder `/home/<x>`-Pfade (Tests nutzen `/heim/jo`, `/vault/…`, `/projekte/…`), E-Mails nur `@example.com`, keine Firmennamen, keine Zeile, die wie ein Zugangsdatum aussieht — Köder zur Laufzeit zusammensetzen (`["pass", "word"].join("")`). In `.tools/*.mjs` und Doku zusätzlich der pre-commit-Secrets-Scan: keine Zeilen wie `token:`/`secret:`/`password=`/„Passwort ist …“.
- **Stil:** Bezeichner Deutsch ohne Umlaute, camelCase; Kommentare Deutsch; Stil wie im Kit; Pfade in Tests mit Leerzeichen/Umlauten/Apostroph.
- **Git:** `git add` nur mit expliziten Dateien (nie `-A`/`.`); jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Kein Push.
- **Shell-Falle:** Bash-Befehle, deren Text `rm` enthält, hält ein Hook an — neue Dateien mit dem Write-Werkzeug anlegen, Aufräumen in Tests nur über `fs.rmSync` im Testcode.
- **Version:** `.tools/VERSION` bleibt `0.5.1` (test-bootstrap koppelt den bootstrap-Standard daran; M1/M2a haben auch nicht angehoben). Änderungen kommen unter `## [Unreleased]` in `.tools/kit/repo/CHANGELOG.md` (Englisch).
- **Modelle (Hauptsitzung verteilt):** Umsetzer je Task `sonnet`, Zwischenchecks (Suite, publish-check) `haiku`, genau **ein** Opus-Review am Ende (Task 12).
- **Parallel gebaut, hier nur geprüft:** `beleg.mjs` (+ `tests/test-beleg.mjs`, Prüfset `tests/fixture-belege/{transkript.jsonl,faelle.json}`) und `heikel.mjs` (+ `tests/test-heikel.mjs`). Ihre Schnittstellen sind fest (Task 1/4); Abweichungen von der Spec werden dort mit minimalen Regel-Ergänzungen geschlossen, nie durch einen Umbau.

## Review Focus

1. **Hand-Stichpunkte mit „Stand“** (live z. B. `entitaet_revolor.md`: „(Stand 19.10.)“, „Stand: …“, Datum ohne Mittelpunkt) dürfen nie `FAKT-BELEG` auslösen — sonst blockiert der pre-commit echte Ingests. Nur das exakte Format „ · Stand TT.MM.JJJJ“ ist Kandidat. → Task 6, Tests `leseFaktZeilen: Hand-Stichpunkte …` und `Lint FAKT-BELEG: Hand-Stichpunkte wie auf der Live-Seite …`.
2. **Zitat-Schreibvarianten**, die Haiku liefert (typografische Anführungszeichen/Striche, Zeilenumbruch, `**fett**`/`` `code` ``, geschütztes Leerzeichen, Vorsatz „Nutzer:“/„Werkzeug (Bash):“, Anführungs-Hülle, `**Zitat:**`), werden gefunden — eine inhaltliche Abweichung (andere Zahl, Groß/Klein, Zusatzwort, über zwei Fundstellen hinweg) nie. → Task 1 (`Herkunft je Rolle …`: u26/u27/u28 + Negativfälle), Task 3 (`parseAntwort: Zitat-Zeile …`, `ernte: … ohneBeleg`).
3. **Eingeschleuster oder eigener Text zählt nie als Beleg:** `<system-reminder>` in Werkzeug-Ausgaben und Nutzertext, Brain-Hinweis, Skill-Text (`isMeta`), Agent-Bericht, `Read` einer Wiki-Seite, Sitzung mit cwd im Vault → immer `ki` → `nurKi`, nie gespeichert. → Task 1 (`Herkunft je Rolle …`: u04/u10/u11/u12/u13/u15/u23/u29/u39), Task 3 (`ernte: eingespielter und eigener Text … → nurKi`).
4. **SessionEnd + PreCompact derselben Sitzung** (nacheinander und gleichzeitig, zwei Prozesse) → jeder W7-Fund steht genau einmal in `.logs/w7.jsonl`. → Task 9 (`w7 CLI: zwei Prozesse gleichzeitig …`, `W7 Ende-zu-Ende: … zweimal ausgelöst …`).
5. **Pfade:** Leerzeichen/Umlaute/Apostroph, Backslashes (Windows), `~`, Groß/Klein (macOS), Symlinks, Nachbarordner `~/brain-kit-v0.7` ≠ `~/brain`, relativer Pfad vom Home aus; dazu BOM/CRLF in Seiten. → Task 1 (`Pfade: …`, `pfadFormen: … Symlink …`, `sperrPfade + aufrufGesperrt: …`), Task 5 (`leseSeitenFelder: BOM + CRLF …`), Task 9 (`hinweisSeiten: Vault mit Leerzeichen/Umlaut …`).

## Entscheidungen und Abweichungen (bewusst)

- **Werkzeug-Ausgaben gehen mit in den Haiku-Input** (neuer Abschnitt `--- WERKZEUG-AUSGABEN ---`, je ≤ 800, zusammen ≤ 8.000 Zeichen, neueste zuerst, innerhalb des bestehenden 24.000-Budgets). Ohne sie könnte Haiku nie ein `tool`/`web`-Zitat liefern. Vorher gefiltert: nur Herkunft `tool`/`web`, keine Fehler, nichts aus dem eigenen Brain, `<system-reminder>`-Blöcke raus, Zeilen mit Zugangs- oder Kundendaten raus, im Zweifel die ganze Ausgabe raus.
- **Selbstbestätigungs-Sperre = ganzer Vault + `ernteNichtIn`** (auch `.tools`), in `beleg-ernte.mjs#markiereEigenes`, nicht in `beleg.mjs` (dessen Schnittstelle kennt keinen Vault): Werkzeug-Ergebnisse eines Aufrufs, dessen Eingabe einen dieser Pfade nennt (absolut, mit `~`, oder relativ vom cwd aus) oder dessen Zeile ein cwd darin hat, dazu Fehler-Ergebnisse und Ergebnisse ohne bekannten Aufruf, werden vor `findeZitat` zu Assistenten-Zeilen umgeformt → `ki`. Folge: Sitzungen *im* Brain-Ordner liefern keine `tool`-Belege (Nutzer-Aussagen bleiben `du`).
- **Ein Regelort für die Herkunft:** Auch der Werkzeug-Abschnitt im Haiku-Input nimmt nur Zeilen, in denen `beleg.mjs#fundstellen` eine `tool`/`web`-Fundstelle sieht (nach `markiereEigenes`). Folge: Verlaufszeilen ohne `uuid` (nur alte Test-Fixtures, echte Verläufe haben sie immer) liefern keine Werkzeug-Ausgabe.
- **W7-Quelle ist der Verlauf selbst** (Attachment `hook_success`, `hookEvent: "UserPromptSubmit"`, Text beginnt mit „Brain-Treffer“) statt `gezeigt.mjs`/`hint.log`: genau das, was Claude gesehen hat, mit Seite und Reihenfolge; `hint.log` kennt keine Zuordnung zur Antwort und kürzt die Sitzungs-ID. Erkennung „Korrektur“: `korrekturGewicht ≥ 2` (lektionen.mjs) **oder** „stimmt (so) nicht / das war falsch / nicht mehr aktuell / veraltet / ist überholt“.
- **`AskUserQuestion`, `queued_command`, `Agent`, `Skill`, `Edit`, `Write` → `ki`.** Die Antwort auf eine Auswahlfrage ist ein von Claude formulierter Optionstext; eingereihte Befehle kommen als Attachment. Lieber eine Lücke.
- **Zitat auch für `stand`** (gleiche Prüfreihenfolge), damit B2 nur belegte Stände übernimmt. Ein Zitat mit Kundendaten (`hatPii`) wird verworfen (`verworfen`), wie eines mit Zugangsdaten.
- **Prüfreihenfolge je Vorschlag:** Zugangs-/Kundendaten (Titel, Text, Zitat) → `verworfen`; Zitat fehlt oder < 12 / > 300 Zeichen → `ohneBeleg`; nicht gefunden → `ohneBeleg`; Herkunft `ki` → `nurKi`; sonst speichern. Der Beleg-Index umfasst den **ganzen** Verlauf (bis 16 MB, `verlauf.mjs#leseAb`), nicht nur den neuen Teil.
- **Lint-Klassen:** blockierend (pre-commit, nur neue Befunde): `KRITISCH`, `GILT_SEIT`, `ERSETZT` (Format, Nachfolger fehlt, Nachfolger = Seite selbst), `FAKT-BELEG`, `ALIAS`. Nicht blockierend: `ERSETZT-HINWEIS` (Kette; alte Seite noch verlinkt — nur im Normalmodus), `PRÜFBEDÜRFTIG (ZWEIFEL)`, `DOPPELTER NAME` über Aliasse (nur Normalmodus). `kritisch` ist fail-safe: alles außer genau `false` gilt als kritisch. Befundtexte ohne Zeilennummern (der pre-commit vergleicht Zeilen mit HEAD).
- **Spec sagt `ERSETZT` für „Ziel fehlt“ und „noch verlinkt“** — aufgeteilt in `ERSETZT` (blockiert) und `ERSETZT-HINWEIS` (blockiert nicht), weil der Tageslauf eine Seite ersetzen können muss, bevor alle Links umgestellt sind.
- **Beleg-Dateien** sind Rohquellen im Cluster-Ordner: `<cluster>/belege/<JJJJ-MM>/<id>.md` (Cluster = `brain.config.json#clusters[].id`, z. B. `20_firma`). B1 prüft nur Format und Existenz; Anlegen ist B2.
- **Aliasse über Spec hinaus:** Die Suchkarte bekommt eine Zeile „Auch genannt: …“ (sonst findet der Hinweis eine Entität unter dem Alias nicht). Seiten ohne Feld behalten ihre Karte byte-gleich.
- **Keine Installation nötig:** `brain hooks-install` installiert nur den Git-pre-commit (`install-git-hooks.mjs`), nicht die Claude-Hooks; B1 ändert keine Registrierung (`adapters/claude-code/install.mjs` bleibt) und keinen Skill. Nach dem Merge wirkt alles sofort.
- **`_schema.md`:** live (`09_wiki/_schema.md`) und Vorlage (`.tools/kit/vorlage/wiki/_schema.md`) — wie Kit-Commit 05e1878. Der `wiki-guard` schützt nur `~/brain`, nicht den Worktree; ins Live-Wiki kommt die Änderung nur über den Fast-Forward in Task 13. Eine Migration für fremde, bestehende Vaults kommt mit dem nächsten Release (Versionssprung), nicht in B1.

## Was B1 für B2 bereitstellt (Schnittstellen — nicht verbauen)

- `beleg.mjs` (`ladeTranskript`, `findeZitat`, `fundstellen`, `normalisiere`, `HERKUNFT_RANG`) + `beleg-ernte.mjs` (`sperrPfade`, `markiereEigenes`, `webAdresse`, `baueFundstelle`/`leseFundstelle`, `FUNDSTELLE_MUSTER`, `HERKUNFT_WERTE`) — für „Belege nachholen“ (Altbestand aus `.logs/transkript-sicherung/`): `findeZitat(markiereEigenes(ladeTranskript(pfad), { sperr }), zitat)`.
- `vorschlaege.mjs`: Felder `zitat`, `herkunft`, `fundstelle`, `quelleUrl` in `listeVorschlaege()` (nur wenn vorhanden; fehlt `zitat` = Altbestand).
- `heikel.mjs` (vorhanden): `istHeikel(text)` → `{ heikel, gruende }`, Gründe `geld`, `recht`, `person`, `zugang`.
- `seitenfelder.mjs`: `leseSeitenFelder(text)` → `{ giltSeit, ersetztDurch, kritisch, zweifel, roh }` (Tageslauf: `kritisch` → nie ändern).
- `fakten.mjs`: `baueFaktZeile`, `baueErsetzteZeile`, `leseFaktZeilen`, `belegZiel`, `datumDE`, `BELEG_LINK_MUSTER`.
- `aliasse.mjs` + `.logs/aliasse.json` (`{ version: 1, seiten: { "<vault-rel id>": [aliase] }, namen: { "<normalisiert>": ["<id>", …] } }`), `normalisiereName`.
- `w7.mjs` + `.logs/w7.jsonl`: je Zeile `{ "v": 1, "seite": "09_wiki/…md", "sitzung", "uuid", "zeit", "zitat", "erkannt" }`, `leseW7(vault)`.

## Dateistruktur

Alle Pfade relativ zum Worktree `~/brain-kit-v0.7`.

**Vorhanden (parallel gebaut, hier geprüft):** `.tools/beleg.mjs` (Task 1), `.tools/heikel.mjs` (Task 4) samt ihren Tests.

**Neu (Module):**
- `.tools/beleg-ernte.mjs` — Sperre fürs eigene Brain, Web-Adresse, Fundstelle, eingespielte Blöcke (Task 1).
- `.tools/seitenfelder.mjs` — `gilt_seit`/`ersetzt_durch`/`kritisch`/`zweifel` lesen und prüfen (Task 5).
- `.tools/fakten.mjs` — Fakt-Zeilen bauen/lesen, Beleg-Links prüfen (Task 6).
- `.tools/aliasse.mjs` — `auch_genannt` prüfen, Alias-Index, Dubletten, Kartenzeile (Task 7).
- `.tools/w7.mjs` — Fehler-Signal W7 (Erkennung, Speichern, CLI) (Task 9).

**Neu (Tests):** `.tools/tests/fixture-garten.mjs` (kein Test), `test-beleg-ernte.mjs`, `test-vorschlaege-beleg.mjs`, `test-ernte-beleg.mjs`, `test-heikel-abnahme.mjs`, `test-seitenfelder.mjs`, `test-lint-wahrheit.mjs`, `test-fakten.mjs`, `test-aliasse.mjs`, `test-w7.mjs`.

**Geändert:**
- `.tools/vorschlaege.mjs` — Beleg-Felder (Task 2).
- `.tools/ernte.mjs` — Auftrag mit Zitat, `parseAntwort` mit Zitat, Werkzeug-Ausgaben, Beleg-Prüfung, Log (Task 3).
- `.tools/brain-lint.mjs` — `KRITISCH`, `GILT_SEIT`, `ERSETZT`, `ERSETZT-HINWEIS`, `PRÜFBEDÜRFTIG (ZWEIFEL)` (Task 5), `FAKT-BELEG` (Task 6), `ALIAS` + Alias-`DOPPELTER NAME` (Task 7).
- `.tools/brain-index.mjs` — `.logs/aliasse.json`, Kartenzeile „Auch genannt“ (Task 7).
- `.tools/hint-core.mjs` — W6: ersetzt/Zweifel im Hinweis (Task 8).
- `.tools/adapters/claude-code/ernte-ausloeser.mjs` — startet `w7.mjs` losgelöst (Task 9).
- `.tools/tests/test-ernte.mjs`, `.tools/tests/test-ernte-ausloeser.mjs`, `.tools/tests/test-hint-core.mjs` — Anpassungen/Ergänzungen.
- Doku: `09_wiki/_schema.md`, `.tools/kit/vorlage/wiki/_schema.md`, `.tools/adapters/claude-code/README.md`, `.tools/kit/repo/README.md`, `.tools/kit/repo/CHANGELOG.md` (Task 10).

**Reihenfolge:** Task 1 erst, wenn `beleg.mjs` vorhanden ist; Task 1 → 2 → 3 (Ernte braucht beide). Task 4, sobald `heikel.mjs` vorhanden ist. Tasks 5 → 6 → 7 strikt nacheinander (alle ändern `brain-lint.mjs`). Task 8 nach 5 (nutzt `seitenfelder.mjs`). Task 9 nach 3 (nutzt `ernte.mjs`-Helfer). Task 10 nach 1–9.

---

### Task 0: Worktree prüfen (existiert bereits) und Ausgangslage messen

**Files:** keine (nur lesend)

**Interfaces:**
- Consumes: Worktree `~/brain-kit-v0.7`, Branch `kit-v0.7` (angelegt von der Hauptsitzung, Basis `717960f`).
- Produces: Ausgangszahl der Unit-Tests (heute 767 Tests, ≈ 12 s) für den Vergleich in Task 11.

- [ ] **Step 1: Worktree und Hook-Pfad prüfen (nur lesend)**

```bash
git -C ~/brain worktree list | grep brain-kit-v0.7
git -C ~/brain-kit-v0.7 branch --show-current
git -C ~/brain-kit-v0.7 log --oneline -3
git -C ~/brain-kit-v0.7 config core.hooksPath
```

Expected: Worktree vorhanden, Branch `kit-v0.7`, Basis `717960f` (ggf. mit den Commits der parallelen Umsetzer darüber), `core.hooksPath` = `.tools/git-hooks` (der pre-commit gilt auch im Worktree). Fehlt der Worktree: STOPP, der Hauptsitzung melden.

- [ ] **Step 2: Ausgangslage der Tests messen**

```bash
cd ~/brain-kit-v0.7 && node --test .tools/tests/test-*.mjs 2>&1 | grep -E "^# (tests|pass|fail|duration_ms)"
cd ~/brain-kit-v0.7 && bash .tools/tests/run-all.sh 2>&1 | tail -8; echo "Exit ${PIPESTATUS[0]}"
```

Expected: `# fail 0`, Exit 0. Zahlen notieren. Ist die Ausgangslage rot: STOPP, der Hauptsitzung melden (nicht in B1 reparieren).

Kein Commit in diesem Task.

---
### Task 1: `beleg.mjs` (vorhanden) prüfen + `beleg-ernte.mjs` — Sperre fürs eigene Brain, Fundstelle, Web-Adresse

`beleg.mjs` und sein Prüfset baut ein paralleler Umsetzer (Branch `kit-v0.7`). Dieser Task baut es **nicht** neu, sondern prüft die Schnittstelle gegen die Spec und ergänzt, was die Ernte zusätzlich braucht, in einem eigenen Modul.

**Files:**
- Prüfen (vorhanden): `.tools/beleg.mjs`, `.tools/tests/test-beleg.mjs`, `.tools/tests/fixture-belege/transkript.jsonl`, `.tools/tests/fixture-belege/faelle.json`
- Create: `.tools/beleg-ernte.mjs`
- Create: `.tools/tests/fixture-garten.mjs` (Helfer, kein Test)
- Test: `.tools/tests/test-beleg-ernte.mjs`

**Interfaces:**
- Consumes (vorhanden, fest vorgegeben): `beleg.mjs` — `HERKUNFT_RANG = { tool: 3, du: 2, web: 1, ki: 0 }`, `normalisiere(text) → string`, `fundstellen(zeilen) → Array<{ herkunft, uuid, zeit, werkzeug, text }>`, `findeZitat(zeilen, zitat) → { herkunft, uuid, zeit, werkzeug } | null` (Zitat normalisiert 12–300 Zeichen, sonst `null`; Mehrfachfund → stärkste Herkunft, bei Gleichstand früheste), `ladeTranskript(pfad) → zeilen[]` (JSONL tolerant). **Annahme dieses Plans:** `zeilen` = Array **geparster Objekte** (eine je JSONL-Zeile) — Step 1 prüft das.
- Produces (für Task 2, 3 und B2) aus `.tools/beleg-ernte.mjs`:
  - `HERKUNFT_WERTE = ["du", "tool", "web", "ki"]`, `MAX_ZITAT = 300`, `FUNDSTELLE_MUSTER`
  - `baueFundstelle({ sitzung, uuid, zeit }) → "<sitzung>#<uuid> <ISO-Zeit>"` (Unbekanntes = `?`), `leseFundstelle(s) → { sitzung, uuid, zeit } | null`
  - `ohneEingespieltes(text) → string` (`<system-reminder>`, `<command-*>`, `<local-command-*>`, `<task-notification>`, `<agent-message>`, `<user-prompt-submit-hook>`, `<bash-*>` raus; offener Block bis zum Ende), `ergebnisText(inhalt) → string`
  - `pfadFormen(pfad, { home }?) → string[]`, `nenntPfad(text, formen, { plattform }?) → boolean`, `sperrPfade(vault, ernteNichtIn?, { home }?) → string[]`, `aufrufGesperrt(input, cwds, sperr, { plattform }?) → boolean`
  - `markiereEigenes(zeilen, { sperr, plattform }?) → zeilen` — Werkzeug-Ergebnisse aus dem eigenen Brain (Eingabe nennt Vault/`ernteNichtIn`, oder cwd liegt darin), Fehler-Ergebnisse und Ergebnisse unbekannter Aufrufe werden zu Assistenten-Zeilen (gleiche `uuid`/`timestamp`) → `beleg.mjs` wertet sie als `ki`.
  - `webAdresse(zeilen, uuid) → string` — Herkunft+Pfad (ohne Query) der `WebFetch`-Adresse, deren Ergebnis in der Zeile `uuid` steht, sonst `""`.
  - Fixture: `gartenEintraege({ vault }?)`, `GARTEN_SITZUNG = "sitzung-beleg"`, `GARTEN_CWD = "/projekte/garten"`, `GARTEN_VAULT = "/vault/beispiel"`.

- [ ] **Step 1: Vorhandenes prüfen (nur lesend)**

```bash
cd ~/brain-kit-v0.7
git log --oneline -5 -- .tools/beleg.mjs .tools/heikel.mjs
node -e 'import("./.tools/beleg.mjs").then(m => { for (const k of ["HERKUNFT_RANG","normalisiere","fundstellen","findeZitat","ladeTranskript"]) if (!(k in m)) throw new Error("fehlt: " + k); console.log(JSON.stringify(m.HERKUNFT_RANG)); const z = m.ladeTranskript(".tools/tests/fixture-belege/transkript.jsonl"); console.log(Array.isArray(z), typeof z[0]); })'
node --test .tools/tests/test-beleg.mjs 2>&1 | grep -E "^# (tests|pass|fail)"
grep -n "100" .tools/tests/test-beleg.mjs | head -5
```

Expected: `{"tool":3,"du":2,"web":1,"ki":0}`, `true object`, `# fail 0`, und der Test prüft die Zitat-Treue im Prüfset auf 100 % (Abnahme §8). Fehlt etwas oder ist `typeof z[0]` `string`: STOPP, der Hauptsitzung melden — der Umsetzer von `beleg.mjs` passt die Schnittstelle an (Objekte annehmen: `const o = typeof z === "string" ? parseZeile(z) : z`), nicht dieser Task.

- [ ] **Step 2: Garten-Fixture anlegen**

Create `.tools/tests/fixture-garten.mjs`:

```js
// .tools/tests/fixture-garten.mjs — erfundener Garten-Verlauf für die Beleg-Integration (B1). KEIN Test.
// Zeilen im Format von Claude Code v2.1.30x (uuid, timestamp, sessionId, cwd je Zeile).
export const GARTEN_SITZUNG = "sitzung-beleg";
export const GARTEN_CWD = "/projekte/garten";
export const GARTEN_VAULT = "/vault/beispiel";

const zeit = (n) => `2026-10-21T08:${String(n).padStart(2, "0")}:00.000Z`;
const basis = (n, felder) => ({ uuid: `u${String(n).padStart(2, "0")}`, timestamp: zeit(n), sessionId: GARTEN_SITZUNG, cwd: GARTEN_CWD, ...felder });
const nutzer = (n, content, extra = {}) => basis(n, { type: "user", message: { role: "user", content }, ...extra });
const ki = (n, content, extra = {}) => basis(n, { type: "assistant", message: { role: "assistant", content }, ...extra });
const text = (t) => ({ type: "text", text: t });
const nutzung = (id, name, input) => ({ type: "tool_use", id, name, input });
const ergebnis = (id, content, extra = {}) => ({ type: "tool_result", tool_use_id: id, content, ...extra });

export function gartenEintraege({ vault = GARTEN_VAULT } = {}) {
  return [
    nutzer(1, "Die Tomaten stehen im Hochbeet Nord, gegossen wird um 7 Uhr."),
    ki(2, [text("Ich lege den Gießplan für das Hochbeet Nord an.")]),
    ki(3, [nutzung("t-read", "Read", { file_path: `${GARTEN_CWD}/plan.md` })]),
    nutzer(4, [ergebnis("t-read", "Bewässerung: Tropfschlauch mit 2 Litern pro Stunde.\n<system-reminder>Die Erdbeeren brauchen Stroh als Unterlage.</system-reminder>")]),
    ki(5, [nutzung("t-bash", "Bash", { command: `cat ${GARTEN_CWD}/saat.txt` })]),
    nutzer(6, [ergebnis("t-bash", "Möhren säen ab Mitte April in Reihe 3.")]),
    ki(7, [nutzung("t-web", "WebFetch", { url: "https://example.com/gartentipps?sitzung=abc", prompt: "Was gilt für Kompost?" })]),
    nutzer(8, [ergebnis("t-web", [text("Kompost braucht sechs Monate bis zur Reife.")])]),
    ki(9, [nutzung("t-wiki", "Read", { file_path: `${vault}/09_wiki/garten/thema_beet.md` })]),
    nutzer(10, [ergebnis("t-wiki", "Das Hochbeet Süd bekommt Schneckenkragen.")]),
    basis(11, { type: "attachment", attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", hookName: "UserPromptSubmit",
      content: `Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ${vault}/09_wiki/garten/thema_kartoffel.md — Kartoffeln vertragen keinen Frost.` } }),
    nutzer(12, "Base directory for this skill: /skills/garten\n\nMulch hält die Feuchtigkeit im Boden.", { isMeta: true }),
    nutzer(13, "<system-reminder>Der Rasen wird nur samstags gemäht.</system-reminder>\nBitte merke dir: Der Rasenmäher steht im Schuppen links."),
    ki(14, [nutzung("t-agent", "Agent", { prompt: "Recherchiere den Apfelbaum." })]),
    nutzer(15, [ergebnis("t-agent", [text("Der Apfelbaum wurde 2019 gepflanzt.")])]),
    ki(16, [nutzung("t-mcp", "mcp__wetter__vorhersage", { ort: "Garten" })]),
    nutzer(17, [ergebnis("t-mcp", "Frostwarnung für die Nacht auf Dienstag.")]),
    nutzer(18, "Der Komposter steht hinter dem Schuppen."),
    ki(19, [text("Notiert: Der Komposter steht hinter dem Schuppen. Außerdem: Die Wasseruhr hängt im Keller.")]),
    ki(20, [nutzung("t-notiz", "Bash", { command: "cat notizen.txt" })]),
    nutzer(21, [ergebnis("t-notiz", "Notiz: Der Komposter steht hinter dem Schuppen.")]),
    ki(22, [nutzung("t-fehl", "Bash", { command: "cat gartenplan.csv" })]),
    nutzer(23, [ergebnis("t-fehl", "Fehler: Datei gartenplan.csv nicht gefunden", { is_error: true })]),
    nutzer(24, "Die Hecke ist 40 Meter lang.", { isSidechain: true }),
    nutzer(25, "Zusammenfassung: Beet A hat Lehmboden.", { isCompactSummary: true }),
    nutzer(26, "Der Gärtner sagt: „Bohnen nie vor den Eisheiligen“ – das gilt auch für Kürbis…"),
    nutzer(27, "Die Regentonne fasst\n   300 Liter."),
    nutzer(28, "Die **Gartenschere** liegt in der `Werkzeugkiste`."),
    nutzer(29, [ergebnis("t-unbekannt", "Die Laube hat ein Blechdach.")]),
    nutzer(30, "<local-command-stdout>Die Gießkanne ist leer.</local-command-stdout>"),
    ki(31, [nutzung("t-nachbar", "Read", { file_path: `${vault}-kit/notiz.md` })]),
    nutzer(32, [ergebnis("t-nachbar", "Der Zaun ist grün gestrichen.")]),
    ki(34, [nutzung("t-suche", "WebSearch", { query: "Lavendel Standort" })]),
    nutzer(35, [ergebnis("t-suche", "Lavendel mag sonnige Standorte.")]),
    ki(36, [nutzung("t-grep", "Grep", { pattern: "Kartoffel", path: GARTEN_CWD })]),
    nutzer(37, [ergebnis("t-grep", [text("vorrat.md: Die Kartoffeln liegen im Keller.")])]),
    ki(38, [nutzung("t-cwd", "Bash", { command: "cat notizen.md" })], { cwd: vault }),
    nutzer(39, [ergebnis("t-cwd", "Die Kräuterspirale liegt am Südhang.")], { cwd: vault }),
    ki(40, [nutzung("t-skill", "Skill", { skill: "garten" })]),
    nutzer(41, [ergebnis("t-skill", "Der Gartenkalender beginnt im Februar.")]),
    nutzer(42, "Die Wasseruhr hängt im Keller."),
    ki(43, [nutzung("t-web2", "WebFetch", { url: "https://example.com/rosen" })]),
    nutzer(44, [ergebnis("t-web2", "Rosen brauchen einen Rückschnitt im März.")]),
    ki(45, [text("Laut Quelle: Rosen brauchen einen Rückschnitt im März.")]),
    nutzer(46, "<task-notification>Der Holzstapel ist trocken.</task-notification>"),
    nutzer(47, "Die Tomaten bekommen Brennnesseljauche."),
  ];
}
```

- [ ] **Step 3: Failing Tests schreiben**

Create `.tools/tests/test-beleg-ernte.mjs`:

```js
// .tools/tests/test-beleg-ernte.mjs — Beleg-Integration für die Ernte (B1, §4.1): Selbstbestätigungs-Sperre (Pfade),
// Herkunft je Rolle laut Spec über beleg.mjs + markiereEigenes, Web-Adresse, Fundstelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { findeZitat } from "../beleg.mjs";
import {
  pfadFormen, nenntPfad, sperrPfade, aufrufGesperrt, markiereEigenes, webAdresse, ohneEingespieltes, ergebnisText,
  baueFundstelle, leseFundstelle, FUNDSTELLE_MUSTER, HERKUNFT_WERTE, MAX_ZITAT,
} from "../beleg-ernte.mjs";
import { gartenEintraege, GARTEN_VAULT } from "./fixture-garten.mjs";

const HOME = "/heim/jo";

test("Pfade: Leerzeichen, Umlaute, Apostroph, Backslashes, ~, Groß/Klein (macOS), Nachbarordner ist nicht der Vault", () => {
  const formen = pfadFormen("~/Mein Brän, Jo's", { home: HOME });
  assert.deepEqual([...formen].sort(), ["/heim/jo/Mein Brän, Jo's", "~/Mein Brän, Jo's"].sort());
  for (const t of [`cat "/heim/jo/Mein Brän, Jo's/09_wiki/a.md"`, "~/Mein Brän, Jo's/x", "/HEIM/jo/mein brän, jo's/x"]) assert.ok(nenntPfad(t, formen, { plattform: "darwin" }), t);
  for (const t of ["/heim/jo/Mein Brän, Jo's-kit/x", "/heim/jo/Mein Brän, Jo's.bak/x", "/sicherung/heim/jo/Mein Brän, Jo's/x", "/heim/jo/Mein"]) assert.ok(!nenntPfad(t, formen, { plattform: "darwin" }), t);
  assert.ok(!nenntPfad("/HEIM/jo/mein brän, jo's/x", formen, { plattform: "linux" }), "Linux unterscheidet Groß/Klein");
  const win = pfadFormen("C:\\Daten\\Mein Brän", { home: "C:\\heim\\jo" });
  assert.ok(nenntPfad("type C:\\daten\\mein brän\\09_wiki\\a.md", win, { plattform: "win32" }));
  assert.ok(!nenntPfad("type C:\\Daten\\Mein Brän-kit\\a.md", win, { plattform: "win32" }));
  const brain = pfadFormen("~/brain", { home: HOME });
  assert.ok(!nenntPfad("cd ~/brain-kit-v0.7 && cat .tools/ernte.mjs", brain, { plattform: "darwin" }), "Nachbar-Worktree");
  assert.ok(nenntPfad("cd ~/brain && cat 09_wiki/a.md", brain, { plattform: "darwin" }));
});

test("pfadFormen: der echte Pfad hinter einem Symlink zählt mit", { skip: process.platform === "win32" }, () => {
  const basis = tempOrdner("Sym Brän");
  const echt = join(basis, "echt");
  mkdirSync(echt);
  const verweis = join(basis, "verweis");
  symlinkSync(echt, verweis);
  const formen = pfadFormen(verweis, { home: HOME });
  assert.ok(nenntPfad(`cat ${realpathSync(echt)}/09_wiki/a.md`, formen));
  assert.ok(nenntPfad(`cat ${verweis}/09_wiki/a.md`, formen));
});

test("sperrPfade + aufrufGesperrt: Vault/ernteNichtIn, cwd darin, verschachtelte Eingabe, relativ vom Eltern-cwd; Relatives/Wurzel zählt nicht", () => {
  assert.deepEqual([...sperrPfade("/vault/beispiel", ["~/firma", "", "/", "relativ/ordner", 5], { home: HOME })].sort(), ["/heim/jo/firma", "/vault/beispiel", "~/firma"].sort());
  const sperr = sperrPfade("/heim/jo/brain", [], { home: HOME });
  assert.ok(aufrufGesperrt({ command: "ls" }, "/heim/jo/brain/09_wiki", sperr), "cwd im Vault");
  assert.ok(aufrufGesperrt({ file_path: "/heim/jo/brain/09_wiki/a.md" }, "/projekte/garten", sperr));
  assert.ok(aufrufGesperrt({ args: ["-n", "~/brain/09_wiki/a.md"] }, "/projekte/garten", sperr));
  assert.ok(aufrufGesperrt({ command: "cat brain/09_wiki/a.md" }, "/heim/jo", sperr), "relativ vom Home aus");
  assert.ok(aufrufGesperrt({ command: "cat ./brain/09_wiki/a.md" }, "/heim/jo", sperr));
  assert.ok(!aufrufGesperrt({ command: "cat brain-app/README.md" }, "/heim/jo", sperr), "Nachbarordner");
  assert.ok(!aufrufGesperrt({ command: "cat brain/x" }, "/projekte/garten", sperr));
  assert.ok(!aufrufGesperrt({ file_path: "/heim/jo/brain/a.md" }, "/heim/jo", []), "ohne Sperrliste nie gesperrt");
});

// Spec §4.1 je Rolle — über das vorhandene beleg.mjs, nach markiereEigenes (eigenes Brain, Fehler, unbekannte Aufrufe → ki).
const FAELLE = [
  ["u01", "Die Tomaten stehen im Hochbeet Nord", "du"],
  ["u02", "Ich lege den Gießplan für das Hochbeet Nord an.", "ki"],
  ["u04", "Tropfschlauch mit 2 Litern pro Stunde", "tool"],
  ["u04", "Die Erdbeeren brauchen Stroh als Unterlage.", "ki"],
  ["u06", "Möhren säen ab Mitte April in Reihe 3.", "tool"],
  ["u08", "Kompost braucht sechs Monate bis zur Reife.", "web"],
  ["u10", "Das Hochbeet Süd bekommt Schneckenkragen.", "ki"],
  ["u11", "Kartoffeln vertragen keinen Frost.", "ki"],
  ["u12", "Mulch hält die Feuchtigkeit im Boden.", "ki"],
  ["u13", "Der Rasen wird nur samstags gemäht.", "ki"],
  ["u13", "Der Rasenmäher steht im Schuppen links.", "du"],
  ["u15", "Der Apfelbaum wurde 2019 gepflanzt.", "ki"],
  ["u17", "Frostwarnung für die Nacht auf Dienstag.", "tool"],
  ["u21", "Der Komposter steht hinter dem Schuppen.", "tool"],
  ["u23", "Datei gartenplan.csv nicht gefunden", "ki"],
  ["u24", "Die Hecke ist 40 Meter lang.", "ki"],
  ["u25", "Zusammenfassung: Beet A hat Lehmboden.", "ki"],
  ["u26", "Der Gärtner sagt: \"Bohnen nie vor den Eisheiligen\" - das gilt auch für Kürbis...", "du"],
  ["u27", "Die Regentonne fasst 300 Liter.", "du"],
  ["u28", "Die Gartenschere liegt in der Werkzeugkiste.", "du"],
  ["u29", "Die Laube hat ein Blechdach.", "ki"],
  ["u30", "Die Gießkanne ist leer.", "ki"],
  ["u32", "Der Zaun ist grün gestrichen.", "tool"],
  ["u35", "Lavendel mag sonnige Standorte.", "web"],
  ["u37", "Die Kartoffeln liegen im Keller.", "tool"],
  ["u39", "Die Kräuterspirale liegt am Südhang.", "ki"],
  ["u41", "Der Gartenkalender beginnt im Februar.", "ki"],
  ["u42", "Die Wasseruhr hängt im Keller.", "du"],
  ["u44", "Rosen brauchen einen Rückschnitt im März.", "web"],
  ["u46", "Der Holzstapel ist trocken.", "ki"],
  [null, "die regentonne fasst 300 liter.", null],
  [null, "Die Regentonne fasst 400 Liter.", null],
  [null, "hinter dem Schuppen. Notiert:", null],
  [null, "Die Tomaten bekommen Brennnesseljauche und Kompost.", null],
  [null, "Reihe 3", null],
];

test("Herkunft je Rolle (Spec §4.1) mit beleg.mjs + markiereEigenes: 100 % der Fälle", () => {
  const zeilen = markiereEigenes(gartenEintraege(), { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  const falsch = [];
  for (const [uuid, zitat, herkunft] of FAELLE) {
    const r = findeZitat(zeilen, zitat);
    const ok = herkunft === null ? r === null : r !== null && r.herkunft === herkunft && r.uuid === uuid;
    if (!ok) falsch.push(`${zitat} → ${JSON.stringify(r)} (erwartet ${herkunft} ${uuid})`);
  }
  assert.deepEqual(falsch, []);
});

test("markiereEigenes: nur Werkzeug-Ergebnisse wandern; uuid/Zeit bleiben; Nachbarordner und fremde Zeilen unverändert", () => {
  const ein = gartenEintraege();
  const aus = markiereEigenes(ein, { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  const u10 = aus.filter((o) => o.uuid === "u10");
  assert.deepEqual(u10.map((o) => o.type), ["assistant"]);
  assert.equal(u10[0].timestamp, "2026-10-21T08:10:00.000Z");
  assert.equal(u10[0].message.content[0].text, "Das Hochbeet Süd bekommt Schneckenkragen.");
  assert.deepEqual(aus.find((o) => o.uuid === "u32"), ein.find((o) => o.uuid === "u32"));
  assert.deepEqual(aus.find((o) => o.uuid === "u01"), ein.find((o) => o.uuid === "u01"));
  assert.deepEqual(markiereEigenes(null), []);
});

test("webAdresse: WebFetch-Adresse ohne Query/Fragment; WebSearch und Unbekanntes → leer", () => {
  const z = gartenEintraege();
  assert.equal(webAdresse(z, "u08"), "https://example.com/gartentipps");
  assert.equal(webAdresse(z, "u44"), "https://example.com/rosen");
  assert.equal(webAdresse(z, "u35"), "");
  assert.equal(webAdresse(z, "u99"), "");
});

test("ohneEingespieltes/ergebnisText: eingespielte Blöcke raus (offener Block bis zum Ende), Text-Blöcke verbunden", () => {
  assert.equal(ohneEingespieltes("A <system-reminder>x</system-reminder> B <task-notification>offen"), "A \n B");
  assert.equal(ohneEingespieltes("<command-name>/clear</command-name>"), "");
  assert.equal(ergebnisText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(ergebnisText(5), "");
});

test("Fundstelle: <sitzung>#<uuid> <Zeit>, Unbekanntes als ?, Rundweg; Konstanten", () => {
  const f = baueFundstelle({ sitzung: "sitzung-beleg", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z" });
  assert.equal(f, "sitzung-beleg#u06 2026-10-21T08:06:00.000Z");
  assert.match(f, FUNDSTELLE_MUSTER);
  assert.deepEqual(leseFundstelle(f), { sitzung: "sitzung-beleg", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z" });
  assert.equal(baueFundstelle({ sitzung: "s/../x", uuid: "", zeit: "gestern" }), "sx#? ?");
  assert.deepEqual(leseFundstelle("sx#? ?"), { sitzung: "sx", uuid: "", zeit: "" });
  assert.equal(leseFundstelle("kaputt"), null);
  assert.deepEqual(HERKUNFT_WERTE, ["du", "tool", "web", "ki"]);
  assert.equal(MAX_ZITAT, 300);
});
```

- [ ] **Step 4: Test laufen lassen — er muss scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-beleg-ernte.mjs`
Expected: FAIL mit `Cannot find module '…/.tools/beleg-ernte.mjs'`.

- [ ] **Step 5: `beleg-ernte.mjs` schreiben**

Create `.tools/beleg-ernte.mjs`:

```js
// .tools/beleg-ernte.mjs — alles, was die Ernte rund um beleg.mjs braucht (B1, §4.1): die Selbstbestätigungs-Sperre
// (Werkzeug-Ergebnisse aus dem eigenen Brain — Vault oder ernteNichtIn — zählen nie als Beleg), Fehler und unbekannte
// Aufrufe als „ki“, die Web-Adresse eines web-Belegs und die Fundstelle. Die Regeln „Zitat finden / Herkunft je Rolle“
// stehen nur in beleg.mjs; markiereEigenes formt den Verlauf so um, dass beleg.mjs Eigenes als Assistenten-Text (ki) sieht.
// Rein (liest nur realpath für Pfadformen), wirft nie. Nur Node-Standardbibliothek.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, win32 } from "node:path";

export const HERKUNFT_WERTE = ["du", "tool", "web", "ki"];
export const MAX_ZITAT = 300;
export const FUNDSTELLE_MUSTER = /^[\w?-]{1,64}#[\w?-]{1,80} (?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z|\?)$/;

// ---------- Eingespielter Kontext ----------

const EINGESPIELT = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification|agent-message|user-prompt-submit-hook|bash-[a-z-]+)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1>|$)/g;
export function ohneEingespieltes(text) {
  return String(text ?? "").replace(EINGESPIELT, "\n").trim();
}
export function ergebnisText(inhalt) {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return inhalt.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
}

// ---------- Pfade ----------

const fwd = (p) => String(p ?? "").replace(/\\/g, "/");
const ohneSchluss = (p) => p.replace(/\/+$/, "");
const faltet = (plattform) => plattform === "darwin" || plattform === "win32";
const vergleich = (p, plattform) => { const f = fwd(p).normalize("NFC"); return faltet(plattform) ? f.toLowerCase() : f; };
const VOR_GRENZE = /[\p{L}\p{N}_.~\/-]/u;   // davor kein Pfadzeichen
const NACH_GRENZE = /[\p{L}\p{N}_.~-]/u;    // danach kein Namenszeichen („/“, Ende, Anführung, Leerraum sind ok)

// Schreibweisen eines absoluten Ordners: wie angegeben, echt (realpath), mit ~ fürs Home — immer mit „/“.
// Relative oder leere Angaben und die Wurzel liefern nichts (nicht sicher prüfbar).
export function pfadFormen(pfad, { home = homedir() } = {}) {
  let p = typeof pfad === "string" ? pfad.trim() : "";
  if (!p) return [];
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = join(home, p.slice(1));
  if (!isAbsolute(p) && !win32.isAbsolute(p)) return [];
  const formen = new Set();
  const dazu = (x) => { const f = ohneSchluss(fwd(x).normalize("NFC")); if (f) formen.add(f); };
  dazu(p);
  try { dazu(realpathSync(p)); } catch {}
  const h = ohneSchluss(fwd(home).normalize("NFC"));
  for (const f of [...formen]) if (h && f.startsWith(h + "/")) formen.add("~" + f.slice(h.length));
  return [...formen];
}

// Nennt `text` einen der Pfade an Ordnergrenzen? (`~/brain-kit` nennt `~/brain` nicht.) darwin/win32 ohne Groß/Klein.
export function nenntPfad(text, formen, { plattform = process.platform } = {}) {
  if (!Array.isArray(formen) || !formen.length) return false;
  const s = vergleich(text, plattform);
  for (const f0 of formen) {
    const f = vergleich(f0, plattform);
    if (!f) continue;
    for (let i = s.indexOf(f); i !== -1; i = s.indexOf(f, i + 1)) {
      const vor = i > 0 ? s[i - 1] : "", nach = s[i + f.length] ?? "";
      if ((!vor || !VOR_GRENZE.test(vor)) && (!nach || !NACH_GRENZE.test(nach))) return true;
    }
  }
  return false;
}

export function sperrPfade(vault, ernteNichtIn = [], { home = homedir() } = {}) {
  const alle = new Set();
  for (const p of [vault, ...(Array.isArray(ernteNichtIn) ? ernteNichtIn : [])]) for (const f of pfadFormen(p, { home })) alle.add(f);
  return [...alle];
}

function liegtUnter(pfad, formen, plattform) {
  if (typeof pfad !== "string" || !pfad) return false;
  const p = ohneSchluss(vergleich(pfad, plattform));
  return formen.some((f0) => { const f = vergleich(f0, plattform); return f && !f.startsWith("~") && (p === f || p.startsWith(f + "/")); });
}
// Liegt ein gesperrter Ordner unter dem cwd, kann ein Befehl ihn relativ nennen („cat brain/09_wiki/a.md“ in ~).
function relativeFormen(formen, cwd, plattform) {
  if (typeof cwd !== "string" || !cwd) return [];
  const c = ohneSchluss(vergleich(cwd, plattform));
  const out = [];
  for (const f0 of formen) {
    const f = ohneSchluss(fwd(f0).normalize("NFC"));
    if (f.startsWith("~") || !vergleich(f, plattform).startsWith(c + "/")) continue;
    const rel = f.slice(c.length + 1);
    if (rel) out.push(rel, "./" + rel);
  }
  return out;
}
function werteText(x, tiefe = 0) {
  if (typeof x === "string") return [x];
  if (!x || typeof x !== "object" || tiefe > 5) return [];
  return Object.values(x).flatMap((w) => werteText(w, tiefe + 1));
}

// Werkzeug-Aufruf liest aus dem eigenen Brain: ein cwd liegt darin oder ein Eingabewert nennt einen gesperrten Pfad.
export function aufrufGesperrt(input, cwds, sperr, { plattform = process.platform } = {}) {
  if (!Array.isArray(sperr) || !sperr.length) return false;
  const orte = (Array.isArray(cwds) ? cwds : [cwds]).filter((c) => typeof c === "string" && c);
  if (orte.some((c) => liegtUnter(c, sperr, plattform))) return true;
  const formen = [...sperr, ...orte.flatMap((c) => relativeFormen(sperr, c, plattform))];
  return werteText(input).some((t) => nenntPfad(t, formen, { plattform }));
}

// ---------- Verlauf für beleg.mjs vorbereiten ----------

// Werkzeug-Ergebnisse aus dem eigenen Brain, Fehler-Ergebnisse und Ergebnisse ohne bekannten Aufruf → Assistenten-Zeile
// (gleiche uuid/timestamp): beleg.mjs zählt sie dann als „ki“. Alles andere bleibt unverändert (gleiche Objekte).
export function markiereEigenes(zeilen, { sperr = [], plattform = process.platform } = {}) {
  const aufrufe = new Map();   // tool_use id → gesperrt?
  const out = [];
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    const c = o && typeof o === "object" ? o.message?.content : null;
    if (o?.type === "assistant" && Array.isArray(c)) {
      for (const b of c) if (b?.type === "tool_use") aufrufe.set(String(b.id ?? ""), aufrufGesperrt(b.input, [o.cwd], sperr, { plattform }));
    }
    if (o?.type !== "user" || !Array.isArray(c) || !c.some((b) => b?.type === "tool_result")) { out.push(o); continue; }
    const cwdGesperrt = aufrufGesperrt({}, [o.cwd], sperr, { plattform });
    const bleibt = [], alsKi = [];
    for (const b of c) {
      const eigen = b?.type === "tool_result" && (b.is_error === true || aufrufe.get(String(b.tool_use_id ?? "")) !== false || cwdGesperrt);
      (eigen ? alsKi : bleibt).push(b);
    }
    if (!alsKi.length) { out.push(o); continue; }
    if (bleibt.length) out.push({ ...o, message: { ...o.message, content: bleibt } });
    for (const b of alsKi) {
      out.push({ type: "assistant", uuid: o.uuid, timestamp: o.timestamp, sessionId: o.sessionId, cwd: o.cwd,
        message: { role: "assistant", content: [{ type: "text", text: ergebnisText(b.content) }] } });
    }
  }
  return out;
}

// Adresse (Herkunft + Pfad, nie Query/Fragment) der WebFetch-Seite, deren Ergebnis in der Zeile `uuid` steht.
export function webAdresse(zeilen, uuid) {
  const urls = new Map();
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    if (o.type === "assistant") for (const b of c) if (b?.type === "tool_use" && b.name === "WebFetch") urls.set(String(b.id ?? ""), b.input?.url);
    if (o.type !== "user" || !uuid || String(o.uuid ?? "") !== uuid) continue;
    for (const b of c) {
      if (b?.type !== "tool_result" || !urls.has(String(b.tool_use_id ?? ""))) continue;
      try {
        const u = new URL(String(urls.get(String(b.tool_use_id))));
        if (u.protocol === "http:" || u.protocol === "https:") return (u.origin + u.pathname).slice(0, MAX_ZITAT);
      } catch {}
    }
  }
  return "";
}

// ---------- Fundstelle ----------

const rein = (s, n) => String(s ?? "").replace(/[^\w-]/g, "").slice(0, n) || "?";
const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export function baueFundstelle({ sitzung, uuid, zeit } = {}) {
  return `${rein(sitzung, 64)}#${rein(uuid, 80)} ${ISO_ZEIT.test(String(zeit ?? "")) ? zeit : "?"}`;
}
export function leseFundstelle(s) {
  const t = String(s ?? "");
  if (!FUNDSTELLE_MUSTER.test(t)) return null;
  const [kopf, zeit] = t.split(" ");
  const [sitzung, uuid] = kopf.split("#");
  const ohne = (x) => (x === "?" ? "" : x);
  return { sitzung: ohne(sitzung), uuid: ohne(uuid), zeit: ohne(zeit) };
}
```

- [ ] **Step 6: Tests laufen lassen — grün; Spec-Lücken in `beleg.mjs` schließen**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-beleg-ernte.mjs .tools/tests/test-beleg.mjs`
Expected: PASS. Scheitert nur „Herkunft je Rolle …“, liegt die Abweichung in `beleg.mjs` (Spec §4.1). Dann dort die Regel ergänzen — Zielverhalten je Fall: Nutzertext nach Entfernen eingespielter Blöcke → `du`, der Block selbst → `ki`; `isMeta`/`isCompactSummary`/`isSidechain` → `ki`; `type: "attachment"` (Hook-Ausgaben, Brain-Hinweis) → `ki`; Werkzeug-Ergebnis nur bei `Read`/`Bash`/`Grep`/`Glob`/`mcp__*` → `tool`, `WebFetch`/`WebSearch` → `web`, jedes andere Werkzeug (`Agent`, `Skill`, …) → `ki`; `<system-reminder>` in einem Werkzeug-Ergebnis → `ki`, der Rest des Ergebnisses behält seine Herkunft. Danach beide Testdateien erneut — beide grün, das Prüfset weiter 100 %.

- [ ] **Step 7: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/beleg-ernte.mjs .tools/tests/fixture-garten.mjs .tools/tests/test-beleg-ernte.mjs
git commit -m "$(printf 'kit: beleg-ernte.mjs — Sperre fürs eigene Brain, Web-Adresse, Fundstelle; Herkunft je Rolle geprüft (B1, §4.1)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

(Wurde `beleg.mjs` in Step 6 geändert: `.tools/beleg.mjs` explizit mit in `git add`.)

---
### Task 2: Vorschläge tragen den Beleg (`zitat`, `herkunft`, `fundstelle`, `quelle_url`)

**Files:**
- Modify: `.tools/vorschlaege.mjs` (Import-Block oben, `schreibeVorschlag` ab Zeile 61, `leseDatei` ab Zeile 114)
- Test: `.tools/tests/test-vorschlaege-beleg.mjs`

**Interfaces:**
- Consumes: `beleg-ernte.mjs#HERKUNFT_WERTE`, `#FUNDSTELLE_MUSTER`, `#MAX_ZITAT` (Task 1).
- Produces: `schreibeVorschlag(vault, { art, titel, text, ordner, sitzung, …, zitat?, herkunft?, fundstelle?, quelleUrl? }, jetzt)` → id. Frontmatter-Zeilen `zitat: "<json>"`, `herkunft: <du|tool|web|ki>`, `fundstelle: "<json>"`, `quelle_url: "<json>"` (nur wenn gesetzt) direkt vor `erstellt:`. `listeVorschlaege(vault)`/`leseVorschlagDatei(inhalt)` liefern zusätzlich `zitat`, `herkunft`, `fundstelle`, `quelleUrl` — **nur wenn vorhanden** (alte Vorschläge behalten exakt ihre Form).

- [ ] **Step 1: Failing Tests schreiben**

Create `.tools/tests/test-vorschlaege-beleg.mjs`:

```js
// .tools/tests/test-vorschlaege-beleg.mjs — Vorschläge mit Beleg (B1, §4.1): Felder zitat/herkunft/fundstelle/quelle_url.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempVault } from "./verlauf-fixture.mjs";
import { schreibeVorschlag, listeVorschlaege, vorschlagOrdner } from "../vorschlaege.mjs";

const JETZT = new Date(Date.UTC(2026, 9, 21, 9, 0, 0));
const BELEG = { zitat: "Möhren säen ab Mitte April in Reihe 3.", herkunft: "tool", fundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00.000Z" };
const KOEDER = ["pass", "word"].join("") + "=Koeder123";

test("schreibeVorschlag: Beleg-Felder stehen vor erstellt, JSON-sicher; listeVorschlaege liefert sie", () => {
  const v = tempVault("Vorschlag Brän, Jo's");
  const id = schreibeVorschlag(v, { art: "fakt", titel: "Möhren", text: "Möhren ab Mitte April.", ordner: "/projekte/garten", sitzung: "sitzung-beleg",
    ...BELEG, zitat: "Er sagte \"Reihe 3\" \\ links", quelleUrl: "https://example.com/gartentipps" }, JETZT);
  const datei = readFileSync(join(vorschlagOrdner(v), `${id}.md`), "utf8");
  assert.match(datei, /\nquelle_sitzung: "sitzung-beleg"\nzitat: "Er sagte \\"Reihe 3\\" \\\\ links"\nherkunft: tool\nfundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00\.000Z"\nquelle_url: "https:\/\/example\.com\/gartentipps"\nerstellt: 2026-10-21T09:00:00Z\n/);
  const [v1] = listeVorschlaege(v);
  assert.equal(v1.zitat, "Er sagte \"Reihe 3\" \\ links");
  assert.equal(v1.herkunft, "tool");
  assert.equal(v1.fundstelle, BELEG.fundstelle);
  assert.equal(v1.quelleUrl, "https://example.com/gartentipps");
});

test("schreibeVorschlag: ohne Beleg bleibt alles wie bisher — keine neuen Schlüssel in listeVorschlaege", () => {
  const v = tempVault();
  schreibeVorschlag(v, { art: "fakt", titel: "Alt", text: "Altbestand." }, JETZT);
  const [x] = listeVorschlaege(v);
  assert.deepEqual(Object.keys(x).sort(), ["art", "erstellt", "id", "quelleOrdner", "text", "titel"]);
  schreibeVorschlag(v, { art: "stand", titel: "Stand", text: "Erledigt.", ...BELEG, herkunft: "du" }, JETZT);
  assert.ok(listeVorschlaege(v).some((y) => y.art === "stand" && y.herkunft === "du" && !("quelleUrl" in y)));
});

test("schreibeVorschlag: ungültiger Beleg → 400, nichts geschrieben", () => {
  const v = tempVault();
  const faelle = [
    { art: "lektion", titel: "L", text: "x", ...BELEG },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: "zwei\nZeilen" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: "z".repeat(301) },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: "   " },
    { art: "fakt", titel: "F", text: "x", ...BELEG, herkunft: "chef" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, fundstelle: "irgendwo" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, quelleUrl: "ftp://example.com/a" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, quelleUrl: "https://example.com/" + "a".repeat(300) },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: `Das gilt: ${KOEDER}` },
  ];
  for (const f of faelle) assert.throws(() => schreibeVorschlag(v, f, JETZT), (e) => e.code === 400, JSON.stringify(f).slice(0, 80));
  assert.deepEqual(listeVorschlaege(v), []);
});
```

- [ ] **Step 2: Test laufen lassen — er muss scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-vorschlaege-beleg.mjs`
Expected: FAIL — erster Test: Frontmatter ohne `zitat:` (Regex passt nicht); dritter Test: `Missing expected exception` (Beleg-Felder werden noch ignoriert).

- [ ] **Step 3: `vorschlaege.mjs` erweitern**

Im Import-Block nach `import { findeSecrets } from "./secrets-muster.mjs";` ergänzen:

```js
import { HERKUNFT_WERTE, FUNDSTELLE_MUSTER, MAX_ZITAT } from "./beleg-ernte.mjs";
```

Die Signatur von `schreibeVorschlag` ersetzen:

```js
export function schreibeVorschlag(vault, { art, titel, text, ordner: quelleOrdner = "", sitzung = "", ziel = "memory", regel = "", warum = "", wie = "", befund = "sonstiges", zitat = "", herkunft = "", fundstelle = "", quelleUrl = "" } = {}, jetzt = new Date()) {
```

Direkt vor der Zeile `if ([t, inhalt, qo, qs, ...extra].some(hatZugangsdaten)) throw …` einfügen und die Zeile selbst ersetzen:

```js
  // B1 (§4.1): Beleg je Fakt — nur für fakt/stand; alles oder nichts (zitat + herkunft + fundstelle, quelle_url optional).
  const beleg = [];
  if (zitat || herkunft || fundstelle || quelleUrl) {
    if (art !== "fakt" && art !== "stand") throw fehlerMit(400, "Beleg gibt es nur für Fakten und Stände.");
    const z = String(zitat ?? "");
    if (/[\r\n]/.test(z) || !z.trim() || z.trim().length > MAX_ZITAT) throw fehlerMit(400, "Zitat ungültig (eine Zeile, höchstens 300 Zeichen).");
    if (!HERKUNFT_WERTE.includes(herkunft)) throw fehlerMit(400, "Unbekannte Herkunft.");
    if (!FUNDSTELLE_MUSTER.test(String(fundstelle ?? ""))) throw fehlerMit(400, "Fundstelle ungültig.");
    const url = String(quelleUrl ?? "");
    if (url && (url.length > MAX_ZITAT || !/^https?:\/\/\S+$/.test(url))) throw fehlerMit(400, "Quellen-Adresse ungültig.");
    beleg.push(`zitat: ${JSON.stringify(z.trim())}`, `herkunft: ${herkunft}`, `fundstelle: ${JSON.stringify(fundstelle)}`);
    if (url) beleg.push(`quelle_url: ${JSON.stringify(url)}`);
  }
  if ([t, inhalt, qo, qs, ...extra, ...beleg].some(hatZugangsdaten)) throw fehlerMit(400, "Vorschlag enthält vermutlich Zugangsdaten — nicht gespeichert.");
```

Im Datei-Array `...extra,` durch `...extra, ...beleg,` ersetzen (also `beleg` direkt vor `erstellt:`):

```js
    ...extra,
    ...beleg,
    `erstellt: ${erstellt}`,
```

In `leseDatei` nach der Zeile `if (fm.art === "pflege") v.befund = …;` einfügen:

```js
  // B1: Beleg-Felder nur, wenn vorhanden — alte Vorschläge behalten exakt ihre Form (Dienst/Ansicht vergleichen sie).
  if (fm.zitat) v.zitat = fm.zitat;
  if (fm.herkunft) v.herkunft = fm.herkunft;
  if (fm.fundstelle) v.fundstelle = fm.fundstelle;
  if (fm.quelle_url) v.quelleUrl = fm.quelle_url;
```

Den Kopfkommentar der Datei um eine Zeile ergänzen (nach der v0.4-Zeile):

```js
// B1: fakt/stand tragen optional den Beleg (zitat, herkunft du|tool|web|ki, fundstelle, quelle_url) — beleg-ernte.mjs.
```

- [ ] **Step 4: Tests laufen lassen — grün, alte Vorschlags-Tests unverändert grün**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-vorschlaege-beleg.mjs .tools/tests/test-vorschlaege.mjs`
Expected: PASS (falls `test-vorschlaege.mjs` anders heißt: `ls .tools/tests | grep -i vorschl` und alle gefundenen `.mjs` mitlaufen lassen).

- [ ] **Step 5: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/vorschlaege.mjs .tools/tests/test-vorschlaege-beleg.mjs
git commit -m "$(printf 'kit: Vorschläge tragen den Beleg — zitat/herkunft/fundstelle/quelle_url (B1, §4.1)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: Ernte mit Zitat — Auftrag, Werkzeug-Ausgaben, Beleg-Prüfung, Log

**Files:**
- Modify: `.tools/ernte.mjs` (Kopfkommentar, Imports, `auftrag`, `leseTranskript`, `parseAntwort`, `ernteLauf`)
- Modify: `.tools/tests/test-ernte.mjs` (Fake-Ausgaben mit `Zitat:`, Log-Regex, Werkzeug-Abschnitt)
- Modify: `.tools/tests/test-ernte-ausloeser.mjs:87` (Fake-Ausgabe mit `Zitat:`)
- Test: `.tools/tests/test-ernte-beleg.mjs`

**Interfaces:**
- Consumes: `beleg.mjs` (vorhanden) — `findeZitat(zeilen, zitat)`, `fundstellen(zeilen)`, `ladeTranskript(pfad)`; `beleg-ernte.mjs` — `sperrPfade`, `markiereEigenes`, `webAdresse`, `baueFundstelle`, `ohneEingespieltes`, `ergebnisText`, `MAX_ZITAT` (Task 1); `schreibeVorschlag(… zitat, herkunft, fundstelle, quelleUrl)` (Task 2); `verlauf.mjs#parseZeile`; `pii-muster.mjs#hatPii`; `secrets-muster.mjs#hatSecretsImKontext`; `hint-core.mjs#istSystemNachricht`.
- Produces: `MAX_JE_WERKZEUG = 800`, `MAX_WERKZEUGE = 8000`, `WERKZEUG_KOPF = "\n--- WERKZEUG-AUSGABEN ---\n\n"`; `leseTranskript(pfad, { ab, sperr })` → `{ prompts, text, werkzeuge, bis }`; `parseAntwort(ausgabe, art)` → `Array<{ titel, text, zitat }>`; `saubereZitat(roh)` → string; `ernte.log`-Zeile endet mit `vorschlaege=N verworfen=M ohneBeleg=X nurKi=Y`. Unverändert exportiert (Task 9 nutzt sie): `istAusgeschlossen`, `nimmLock`, `leseArgs`.

- [ ] **Step 1: Failing Tests schreiben**

Create `.tools/tests/test-ernte-beleg.mjs`:

```js
// .tools/tests/test-ernte-beleg.mjs — Ernte mit Zitat (B1, §4.1/§10): Zitat fehlt → ohneBeleg, ki → nurKi, web bleibt,
// eingespielter/eigener Text zählt nie, Werkzeug-Ausgaben im Haiku-Input gefiltert. Nur fake-claude, Temp-HOME, leerer PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const LEER_PATH = mkdtempSync(join(tmpdir(), "ernte-beleg-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "ernte-beleg-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
delete process.env.BRAIN_CLAUDE;
delete process.env.BRAIN_ERNTE;
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const { ernte, parseAntwort, saubereZitat, auftrag, leseTranskript, WERKZEUG_KOPF, MAX_JE_WERKZEUG } = await import("../ernte.mjs");
const { tempVault, tempOrdner, schreibeVerlauf } = await import("./verlauf-fixture.mjs");
const { gartenEintraege, GARTEN_SITZUNG, GARTEN_CWD } = await import("./fixture-garten.mjs");

const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";

function fakeAusgabe(ausgabe) {
  const d = mkdtempSync(join(tmpdir(), "ernte-beleg-fake-"));
  writeFileSync(join(d, "ausgabe.txt"), ausgabe);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "eingabe.txt"), FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt"), FAKE_CLAUDE_WARTE: "0", FAKE_CLAUDE_EXIT: "0", FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "" });
  return join(d, "eingabe.txt");
}
// Garten-Verlauf mit dem Temp-Vault als „eigenem Brain“ (Wiki-Read, Sitzung im Vault) + optional weitere Einträge.
function verlauf(v, extra = []) {
  const f = join(tempOrdner("Verlauf Brän"), "sitzung beleg.jsonl");
  schreibeVerlauf(f, [...gartenEintraege({ vault: v }), ...extra]);
  return f;
}
const lauf = (v, tr) => ernte(v, { art: "fakt", transkript: tr, sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: Date.UTC(2026, 9, 21, 9, 0, 0) });
const vorschlaege = (v) => { const d = join(v, "00_inbox", "_vorschlaege"); try { return readdirSync(d).map((n) => readFileSync(join(d, n), "utf8")); } catch { return []; } };
const logZeile = (v) => readFileSync(join(v, ".logs", "ernte.log"), "utf8").trim().split("\n").pop();

test("auftrag: verlangt je Vorschlag eine Zeile „Zitat:“ — wörtlich aus Nutzer/Werkzeug, Assistent belegt nichts", () => {
  for (const art of ["fakt", "stand"]) {
    const a = auftrag(art);
    assert.match(a, /Zitat: <Auszug>/);
    assert.match(a, /"Nutzer:" oder "Werkzeug \(…\):"/);
    assert.match(a, /Assistenten belegen nichts/);
  }
});

test("parseAntwort: Zitat-Zeile wird abgetrennt — Vorsatz, Anführungs-Hülle, Fett; zählt nicht zu den 12 Stand-Zeilen", () => {
  const r = parseAntwort("### Möhren\nMöhren ab April.\nZitat: Werkzeug (Bash): „Möhren säen ab Mitte April in Reihe 3.“\n\n### Rasen\nRasen samstags.\n**Zitat:** Nutzer: \"Der Rasenmäher steht im Schuppen links.\"\n\n### Ohne\nKein Beleg.\n", "fakt");
  assert.deepEqual(r, [
    { titel: "Möhren", text: "Möhren ab April.", zitat: "Möhren säen ab Mitte April in Reihe 3." },
    { titel: "Rasen", text: "Rasen samstags.", zitat: "Der Rasenmäher steht im Schuppen links." },
    { titel: "Ohne", text: "Kein Beleg.", zitat: "" },
  ]);
  const zeilen = Array.from({ length: 12 }, (_, i) => `- Punkt ${i + 1}`).join("\n");
  const [stand] = parseAntwort(`### Stand\n${zeilen}\nZitat: Frage 1 zum Testbrett`, "stand");
  assert.equal(stand.text.split("\n").length, 12);
  assert.equal(stand.zitat, "Frage 1 zum Testbrett");
  assert.equal(saubereZitat("  «Nutzer: ‚Reihe 3 links‘»  "), "Reihe 3 links");
});

test("ernte: Nutzer/Werkzeug → gespeichert mit Beleg; web bleibt mit Adresse; abgewandelt oder ohne Zitat → ohneBeleg; Wiki-Read → nurKi", async () => {
  const v = tempVault("Ernte Brän, Jo's");
  fakeAusgabe([
    "### Möhren", "Möhren werden ab Mitte April gesät.", "Zitat: Werkzeug (Bash): Möhren säen ab Mitte April in Reihe 3.", "",
    "### Kompost", "Kompost reift sechs Monate.", "Zitat: „Kompost braucht sechs Monate bis zur Reife.“", "",
    "### Schneckenkragen", "Das Hochbeet Süd hat Schneckenkragen.", "Zitat: Das Hochbeet Süd bekommt Schneckenkragen.", "",
    "### Regentonne", "Die Regentonne fasst 400 Liter.", "Zitat: Die Regentonne fasst 400 Liter.", "",
    "### Rasenmäher", "Der Rasenmäher steht im Schuppen.", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 2);
  const [moehren, kompost] = r.vorschlaege.map((id) => readFileSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`), "utf8"));
  assert.match(moehren, /\nzitat: "Möhren säen ab Mitte April in Reihe 3\."\nherkunft: tool\nfundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00\.000Z"\nerstellt: /);
  assert.match(kompost, /\nzitat: "Kompost braucht sechs Monate bis zur Reife\."\nherkunft: web\nfundstelle: "sitzung-beleg#u08 2026-10-21T08:08:00\.000Z"\nquelle_url: "https:\/\/example\.com\/gartentipps"\n/);
  assert.match(logZeile(v), / vorschlaege=2 verworfen=0 ohneBeleg=2 nurKi=1$/);
});

test("ernte: eingespielter und eigener Text (system-reminder, Brain-Hinweis, Skill, Agent, Sitzung im Vault) → nurKi, nie gespeichert", async () => {
  const v = tempVault();
  fakeAusgabe([
    "### Erdbeeren", "Stroh unter Erdbeeren.", "Zitat: Die Erdbeeren brauchen Stroh als Unterlage.", "",
    "### Kartoffeln", "Kein Frost.", "Zitat: Kartoffeln vertragen keinen Frost.", "",
    "### Mulch", "Mulch hält feucht.", "Zitat: Mulch hält die Feuchtigkeit im Boden.", "",
    "### Apfelbaum", "Gepflanzt 2019.", "Zitat: Der Apfelbaum wurde 2019 gepflanzt.", "",
    "### Kräuter", "Südhang.", "Zitat: Die Kräuterspirale liegt am Südhang.", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.vorschlaege.length, 0);
  assert.deepEqual(vorschlaege(v), []);
  assert.match(logZeile(v), / vorschlaege=0 verworfen=0 ohneBeleg=0 nurKi=5$/);
});

test("ernte: Zitat mit Zugangs- oder Kundendaten → verworfen; zu kurzes Zitat → ohneBeleg", async () => {
  const v = tempVault();
  fakeAusgabe([
    "### Zugang", "Siehe Zitat.", `Zitat: Bitte notieren ${KOEDER_PW}`, "",
    "### Kontakt", "Gärtner anschreiben.", "Zitat: Schreib an jo@example.com wegen der Beete", "",
    "### Kurz", "Reihe 3.", "Zitat: Reihe 3", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.vorschlaege.length, 0);
  assert.match(logZeile(v), / vorschlaege=0 verworfen=2 ohneBeleg=1 nurKi=0$/);
  assert.ok(!vorschlaege(v).join("").includes("Koeder123"));
});

test("leseTranskript/ernte: Werkzeug-Ausgaben gehen gefiltert mit — tool/web ja; Wiki-Read, Fehler, KI-Werkzeuge, system-reminder, Zugangs- und Kundendaten nie; ≤ 800 je Ausgabe", async () => {
  const v = tempVault();
  const lang = [
    { type: "assistant", uuid: "u60", timestamp: "2026-10-21T08:59:00.000Z", cwd: GARTEN_CWD, message: { role: "assistant", content: [{ type: "tool_use", id: "t-lang", name: "Bash", input: { command: "cat lang.txt" } }] } },
    { type: "user", uuid: "u61", timestamp: "2026-10-21T08:59:30.000Z", cwd: GARTEN_CWD, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t-lang", content: `Zeile A bleibt.\n${KOEDER_PW}\nTel. 0171 2345678\n${"Beet ".repeat(400)}` }] } },
  ];
  const tr = verlauf(v, lang);
  const { werkzeuge, text, prompts } = leseTranskript(tr, { sperr: [v] });
  assert.equal(prompts, 8, "Nutzertext nach einem system-reminder zählt als Prompt, Meta/Nebenzweig/Befehle nicht");
  assert.ok(text.includes("Nutzer: Bitte merke dir: Der Rasenmäher steht im Schuppen links."));
  assert.ok(!text.includes("Die Hecke ist 40 Meter lang"), "Nebenzweig fehlt");
  for (const da of ["Werkzeug (Bash): Möhren säen ab Mitte April in Reihe 3.", "Werkzeug (WebFetch): Kompost braucht sechs Monate", "Werkzeug (mcp__wetter__vorhersage): Frostwarnung",
    "Werkzeug (Grep): vorrat.md: Die Kartoffeln liegen im Keller.", "Werkzeug (Read): Der Zaun ist grün gestrichen.", "Werkzeug (Read): Bewässerung: Tropfschlauch", "Werkzeug (Bash): Zeile A bleibt."]) {
    assert.ok(werkzeuge.includes(da), da);
  }
  for (const nie of ["Schneckenkragen", "Erdbeeren", "gartenplan.csv nicht gefunden", "Apfelbaum", "Kräuterspirale", "Gartenkalender", "Blechdach", "Koeder123", "2345678"]) {
    assert.ok(!werkzeuge.includes(nie), nie);
  }
  assert.ok(werkzeuge.includes("Beet ".repeat(100)) && !werkzeuge.includes("Beet ".repeat(170)), `je Ausgabe ≤ ${MAX_JE_WERKZEUG}`);
  const log = fakeAusgabe("NICHTS\n");
  await lauf(v, tr);
  const gesendet = readFileSync(log, "utf8");
  assert.ok(gesendet.includes(WERKZEUG_KOPF + "Werkzeug ("), "Werkzeug-Abschnitt nach dem Verlauf");
  assert.ok(!gesendet.includes("Koeder123") && !gesendet.includes("Schneckenkragen"));
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-ernte-beleg.mjs`
Expected: FAIL — `saubereZitat`/`WERKZEUG_KOPF` sind `undefined` (TypeError), `auftrag` ohne „Zitat“, Log ohne `ohneBeleg`.

- [ ] **Step 3: `ernte.mjs` umbauen**

(a) Kopfkommentar: nach der Zeile `// Auftrags-Marke (Final-Review #5): …` ergänzen:

```js
// B1 (Beleg je Fakt, §4.1): Haiku liefert je Vorschlag eine Zeile „Zitat: …“. Node sucht das Zitat im ganzen Verlauf
// (beleg.mjs) und speichert nur belegte Vorschläge mit zitat/herkunft/fundstelle; ohne Treffer → ohneBeleg, nur KI
// (Assistent, eingespielter Kontext, eigenes Brain) → nurKi. Damit Haiku auch Werkzeug-Ergebnisse zitieren kann,
// gehen gefilterte Werkzeug-Ausgaben (tool/web, ohne Fehler, ohne eigenes Brain, ohne Zugangs-/Kundendaten) mit.
```

(b) Imports: die Zeile `import { findeSecrets, ohneSecrets } from "./secrets-muster.mjs";` ersetzen und Imports ergänzen:

```js
import { findeSecrets, ohneSecrets, hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { parseZeile } from "./verlauf.mjs";
import { istSystemNachricht } from "./hint-core.mjs";
import { findeZitat, fundstellen, ladeTranskript } from "./beleg.mjs";
import { sperrPfade, markiereEigenes, webAdresse, baueFundstelle, ohneEingespieltes, ergebnisText, MAX_ZITAT } from "./beleg-ernte.mjs";
```

(c) Nach `export const MIN_PROMPTS = 5;` ergänzen:

```js
export const MAX_JE_WERKZEUG = 800;           // je Werkzeug-Ausgabe im Haiku-Input (Anfang)
export const MAX_WERKZEUGE = 8000;            // alle Werkzeug-Ausgaben zusammen (neueste zuerst), Teil der 24 000
export const WERKZEUG_KOPF = "\n--- WERKZEUG-AUSGABEN ---\n\n";
```

(d) `auftrag(art)` vollständig ersetzen:

```js
export function auftrag(art) {
  const gemeinsam = [
    "Du liest unten den Verlauf einer Arbeitssitzung (Nutzer und Assistent) und darunter Werkzeug-Ausgaben.",
    "Schreibe NIE Zugangsdaten, Passwörter, Tokens, Schlüssel, Adressen, Telefonnummern oder Kundendaten.",
    "Belege jeden Vorschlag: letzte Zeile genau \"Zitat: <Auszug>\" — ein wörtlicher Auszug (12 bis 300 Zeichen, eine Zeile)",
    "aus einer Zeile, die mit \"Nutzer:\" oder \"Werkzeug (…):\" beginnt. Aussagen des Assistenten belegen nichts.",
    "Findest du keinen solchen Auszug, lass den Vorschlag weg.",
    "Ausgabeformat je Vorschlag genau: eine Zeile \"### <Titel>\", darunter der Text, zuletzt die Zitat-Zeile. Sonst nichts.",
    "Gibt es nichts Neues, antworte nur: NICHTS",
  ];
  const kern = art === "stand"
    ? ["Aufgabe: Fasse den aktuellen Arbeitsstand als EINEN Vorschlag zusammen: was erledigt ist, was offen ist,",
       "nächster Schritt. Höchstens 12 Zeilen, Titel höchstens 60 Zeichen."]
    : ["Aufgabe: Nenne höchstens 5 dauerhaft nützliche Fakten oder Entscheidungen aus der Sitzung (keine Plaudereien,",
       "nichts Vorübergehendes). Je Fakt 1–2 Sätze, Titel höchstens 60 Zeichen."];
  return [...kern, ...gemeinsam].join("\n");
}
```

(e) `leseTranskript` vollständig ersetzen (Kommentar darüber mit):

```js
// Verlauf (Nutzer/Assistent) + gefilterte Werkzeug-Ausgaben ab Byte `ab`, höchstens die letzten 8 MB.
// → { prompts: echte Nutzer-Prompts, text: Verlauf, werkzeuge: Werkzeug-Abschnitt (≤ MAX_WERKZEUGE), bis: gelesen bis Byte }
// Werkzeug-Ausgaben: nur Zeilen, in denen beleg.mjs eine Fundstelle mit Herkunft tool/web sieht — nach markiereEigenes
// (Fehler, unbekannte Aufrufe, eigenes Brain `sperr` → ki), also dieselbe Regel wie bei der Zitat-Prüfung. Der Text kommt
// roh aus der Zeile: ohne eingespielte Blöcke; Zeilen mit Zugangs-/Kundendaten fallen weg, im Zweifel die ganze Ausgabe.
// Zeilen ohne uuid (keine Fundstelle möglich) gehen nicht mit.
function werkzeugAusgabe(inhalt) {
  const zeilen = ohneSecrets(ohneEingespieltes(ergebnisText(inhalt))).split("\n").filter((z) => z.trim() && !hatPii(z));
  const t = zeilen.join("\n").trim();
  if (!t || hatSecretsImKontext(t) || hatPii(t)) return "";
  return t.slice(0, MAX_JE_WERKZEUG);
}
export function leseTranskript(pfad, { ab = 0, sperr = [] } = {}) {
  const teile = [], werkzeugTeile = [];
  let prompts = 0;
  const { zeilen, bis } = leseEnde(pfad, ab);
  const objekte = zeilen.map(parseZeile).filter(Boolean);
  const markiert = markiereEigenes(objekte, { sperr });
  const quelle = new Map();   // uuid → Werkzeugname, wo beleg.mjs tool/web sieht
  for (const f of fundstellen(markiert)) {
    if ((f.herkunft === "tool" || f.herkunft === "web") && f.uuid && !quelle.has(f.uuid)) quelle.set(f.uuid, f.werkzeug || "?");
  }
  for (const o of markiert) {
    if (o?.type !== "user" || o.isSidechain || !quelle.has(String(o.uuid ?? "")) || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b?.type !== "tool_result") continue;
      const t = werkzeugAusgabe(b.content);
      if (t) werkzeugTeile.push(`Werkzeug (${quelle.get(String(o.uuid))}): ${t}`);
    }
  }
  for (const m of objekte) {
    const c = m.message?.content;
    const intern = m.isMeta || m.isCompactSummary || m.isSidechain;
    if ((m.type !== "user" && m.type !== "assistant") || intern) continue;
    let texte = [];
    if (typeof c === "string") texte = [c];
    else if (Array.isArray(c)) {
      if (m.type === "user" && c.some(x => x?.type === "tool_result")) continue;
      texte = c.filter(x => x?.type === "text" && typeof x.text === "string").map(x => x.text);
    }
    texte = texte.map(t => ohneEingespieltes(t)).filter(t => t && !t.startsWith("<") && !istSystemNachricht(t));
    if (!texte.length) continue;
    if (m.type === "user") {
      if (texte.every(t => t.startsWith("/"))) continue;   // Slash-Befehle zählen nicht
      prompts++;
    }
    const wer = m.type === "user" ? "Nutzer" : "Assistent";
    for (const t of texte) {
      const sauber = ohneSecrets(t).trim();   // Zeilen mit Zugangsdaten, private Schlüssel als ganzer Block
      if (sauber) teile.push(`${wer}: ${sauber}`);
    }
  }
  // Werkzeug-Ausgaben: neueste zuerst ins Budget, dann wieder in Zeitfolge.
  const gewaehlt = [];
  let laenge = 0;
  for (let i = werkzeugTeile.length - 1; i >= 0; i--) {
    const l = werkzeugTeile[i].length + 2;
    if (laenge + l > MAX_WERKZEUGE) break;
    gewaehlt.unshift(werkzeugTeile[i]);
    laenge += l;
  }
  const werkzeuge = gewaehlt.join("\n\n");
  const budget = MAX_TRANSKRIPT - (werkzeuge ? WERKZEUG_KOPF.length + werkzeuge.length + 1 : 0);
  let text = teile.join("\n\n");
  if (text.length > budget) {
    text = text.slice(-budget);
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);              // halbe erste Zeile weg
  }
  return { prompts, text, werkzeuge, bis };
}
```

(f) `parseAntwort` vollständig ersetzen:

```js
const ZITAT_ZEILE = /^[*_>\s-]*zitat[*_]*\s*:[*_]*\s*(.*)$/i;
const VORSATZ = /^(?:nutzer|werkzeug\s*\([^)]*\))\s*:\s*/i;
const HUELLEN = [["\"", "\""], ["„", "“"], ["“", "”"], ["«", "»"], ["‚", "‘"], ["'", "'"]];
// „Zitat: Werkzeug (Bash): „…““ → der reine Auszug (Vorsatz und eine äußere Anführungs-Hülle weg, zweimal).
export function saubereZitat(roh) {
  let z = String(roh ?? "").trim();
  for (let i = 0; i < 2; i++) {
    z = z.replace(VORSATZ, "").trim();
    for (const [a, b] of HUELLEN) if (z.length >= 2 && z.startsWith(a) && z.endsWith(b)) { z = z.slice(a.length, -b.length).trim(); break; }
  }
  return z;
}

export function parseAntwort(ausgabe, art) {
  const t = String(ausgabe || "").replace(/\r\n?/g, "\n").trim();
  if (!t || /^NICHTS\b/.test(t)) return [];
  const out = [];
  for (const block of t.split(/^###[ \t]+/m).slice(1)) {
    const [kopf, ...rest] = block.split("\n");
    const titel = kopf.trim().slice(0, 60);
    let zitat = "";
    const zeilen = [];
    for (const z of rest) {
      const m = ZITAT_ZEILE.exec(z.trim());
      if (m) { if (!zitat) zitat = saubereZitat(m[1]); continue; }   // die Zitat-Zeile gehört nicht zum Text
      zeilen.push(z);
    }
    let text = zeilen.join("\n").trim();
    if (art === "stand") text = text.split("\n").slice(0, 12).join("\n");
    if (titel && text) out.push({ titel, text, zitat });
  }
  return out.slice(0, art === "stand" ? 1 : 5);
}
```

Im Test `saubereZitat("  «Nutzer: ‚Reihe 3 links‘»  ")`: erst die Hülle `«…»` weg (Durchlauf 1: kein Vorsatz am Anfang, dann Hülle), dann Durchlauf 2: Vorsatz „Nutzer:“ weg, dann Hülle `‚…‘` → „Reihe 3 links“.

(g) In `ernteLauf`: Den Lese-Aufruf ersetzen —

```js
      const sperr = sperrPfade(vault, werte.ernteNichtIn);
      try { gelesen = leseTranskript(transkript, { ab, sperr }); } catch { return ergebnis("uebersprungen", "Transkript nicht lesbar"); }
```

— und die Eingabe-Zeile `const eingabe = VERLAUF_KOPF + gelesen.text + "\n";` ersetzen durch:

```js
      const eingabe = VERLAUF_KOPF + gelesen.text + "\n" + (gelesen.werkzeuge ? WERKZEUG_KOPF + gelesen.werkzeuge + "\n" : "");
```

Den Block von `const ids = [];` bis einschließlich `protokoll("ok", …);` ersetzen durch:

```js
      // Prüfreihenfolge je Vorschlag (B1): Zugangs-/Kundendaten → verworfen; Zitat fehlt, zu kurz/lang (beleg.mjs: 12–300)
      // oder nicht im Verlauf → ohneBeleg; nur KI → nurKi; sonst speichern. Gesucht wird im GANZEN Verlauf.
      const ids = [];
      const n = { verworfen: 0, ohneBeleg: 0, nurKi: 0 };
      let alle = null;
      for (const v of parseAntwort(antwort.text, art)) {
        if (findeSecrets(`${v.titel}\n${v.text}\n${v.zitat}`).length || hatSecretsImKontext(v.zitat) || hatPii(v.zitat)) { n.verworfen++; continue; }
        alle ??= markiereEigenes(ladeTranskript(transkript), { sperr });
        const fund = v.zitat ? findeZitat(alle, v.zitat) : null;
        if (!fund) { n.ohneBeleg++; continue; }
        if (fund.herkunft === "ki") { n.nurKi++; continue; }
        try {
          ids.push(schreibeVorschlag(vault, {
            art, titel: v.titel, text: v.text, ordner: cwd, sitzung: sid,
            zitat: v.zitat.replace(/\s+/g, " ").trim().slice(0, MAX_ZITAT), herkunft: fund.herkunft,
            fundstelle: baueFundstelle({ sitzung: reinSid, uuid: fund.uuid, zeit: fund.zeit }),
            quelleUrl: fund.herkunft === "web" ? webAdresse(alle, fund.uuid) : "",
          }, new Date(jetzt)));
        } catch { n.verworfen++; }
      }
      protokoll("ok", einZeichen, antwort.text.length, `${tokFeld(antwort.tokens)} vorschlaege=${ids.length} verworfen=${n.verworfen} ohneBeleg=${n.ohneBeleg} nurKi=${n.nurKi}`);
```

- [ ] **Step 4: Bestehende Ernte-Tests an das Zitat anpassen**

In `.tools/tests/test-ernte.mjs`:

1. (Import-Zeile bleibt.)
2. Test „ernte: gesendeter Text ohne Secret/Tool-Ergebnis …“: die Fake-Ausgabe ersetzen durch
   ```js
   const fake = fakeUmgebung({ ausgabe: `### Testbrett-Port\nDas Testbrett läuft auf Port 4711.\nZitat: das Testbrett läuft auf Port 4711\n\n### Zugang\nDer Zugang ist ${KOEDER_SCHLUESSEL}.\n` });
   ```
   (`!gesendet.includes("TOOL-ERGEBNIS-GEHEIMNIS")` bleibt richtig: die Fixture-Zeilen haben keine `uuid`, ohne Fundstelle geht keine Werkzeug-Ausgabe mit — der Werkzeug-Abschnitt ist in `test-ernte-beleg.mjs` geprüft.)
   Nach `assert.match(datei, /quelle_sitzung: "sid-42"/);` ergänzen
   ```js
   assert.match(datei, /\nzitat: "das Testbrett läuft auf Port 4711"\nherkunft: du\nfundstelle: "sid-42#\? \?"\n/);
   ```
   und die Log-Regex ersetzen durch
   ```js
   assert.match(log[0], /^2026-10-02T09:00:00 art=fakt status=ok ein=\d+ aus=\d+ tokEin=\d+ tokAus=\d+ vorschlaege=1 verworfen=1 ohneBeleg=0 nurKi=0$/);
   ```
3. Test „ernte stand: höchstens ein Vorschlag …“: Ausgabe ersetzen durch
   ```js
   fakeUmgebung({ ausgabe: `### Stand Testbrett\n${zeilen}\nZitat: Frage 1 zum Testbrett\n\n### Zweiter\nwird ignoriert\n` });
   ```
4. Test „parseAntwort: höchstens 5 Fakten …“ bleibt (Rückgabe hat jetzt zusätzlich `zitat: ""`).
5. Test „CLI: …“: Ausgabe ersetzen durch `"### CLI-Fakt\nKommt über die Kommandozeile.\nZitat: Frage 3 zum Testbrett\n"`.
6. Test „ernte: Passwort/Kennwort/…“: Ausgabe ersetzen durch
   ```js
   const fake = fakeUmgebung({ ausgabe: `### Zugang\n${KOEDER.pw}\n\n### Schlüssel\nNimm ${KOEDER.skAnt}.\n\n### Mondstein\nDer Server heißt Mondstein.\nZitat: Der Server heißt Mondstein.\n` });
   ```
7. Test „ernte: Ausgabe ohne JSON oder ohne usage …“: Ausgabe ersetzen durch `"### Fakt\nText.\nZitat: Frage 1 zum Testbrett\n"`.
8. Test „fakt je Sitzung …“: `"### Erster\nTeil.\n"` → `"### Erster\nTeil.\nZitat: Frage 1 zum Testbrett\n"` und `"### Zweiter\nTeil.\n"` → `"### Zweiter\nTeil.\nZitat: Spaeter Frage 2\n"`.

In `.tools/tests/test-ernte-ausloeser.mjs` Zeile 87:

```js
  writeFileSync(join(d, "ausgabe.txt"), "### Beet\nErst Kompost.\nZitat: Wie plane ich das Gemüsebeet Nummer 0 im Frühling?\n");
```

- [ ] **Step 5: Tests laufen lassen — alle grün**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-ernte-beleg.mjs .tools/tests/test-ernte.mjs .tools/tests/test-ernte-ausloeser.mjs .tools/tests/test-lektionen.mjs .tools/tests/test-pflegelauf.mjs`
Expected: PASS. (`lektionen`/`pflegelauf` nutzen `rufeHaiku`/`leseEnde` — müssen unverändert grün sein.)

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/ernte.mjs .tools/tests/test-ernte-beleg.mjs .tools/tests/test-ernte.mjs .tools/tests/test-ernte-ausloeser.mjs
git commit -m "$(printf 'kit: Ernte mit Zitat — Beleg-Prüfung, Werkzeug-Ausgaben gefiltert, ohneBeleg/nurKi im ernte.log (B1, §4.1)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---
### Task 4: `heikel.mjs` (vorhanden) — prüfen und abnehmen

`heikel.mjs` und `test-heikel.mjs` baut ein paralleler Umsetzer. Dieser Task prüft nur Schnittstelle und Spec-Abdeckung (§4.3); in B1 nutzt noch niemand das Modul (Verbraucher ist der Tageslauf, B2).

**Files:**
- Prüfen (vorhanden): `.tools/heikel.mjs`, `.tools/tests/test-heikel.mjs`
- Test: `.tools/tests/test-heikel-abnahme.mjs`

**Interfaces:**
- Consumes (vorhanden, fest vorgegeben): `istHeikel(text) → { heikel: boolean, gruende: Array<"geld" | "recht" | "person" | "zugang"> }`.
- Produces: nichts Neues (B2 ruft `istHeikel` je Fakt auf).

- [ ] **Step 1: Abnahme-Test schreiben (Spec §4.3, je Grund ein Fall + Alltag ohne Befund)**

Create `.tools/tests/test-heikel-abnahme.mjs`:

```js
// .tools/tests/test-heikel-abnahme.mjs — Abnahme heikel (B1, §4.3) gegen die Spec: Geldbeträge/Preise/Kosten, Vertrag/
// Recht/DSGVO, Personennamen (PII-Filter), Zugänge/Server/Produktion. Ergänzt test-heikel.mjs, ändert es nicht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { istHeikel } from "../heikel.mjs";

const KOEDER = ["pass", "word"].join("") + "=Koeder123";
const hat = (t, grund) => istHeikel(t).gruende.includes(grund);

test("je Grund aus der Spec mindestens ein Fall; Form { heikel, gruende }", () => {
  for (const t of ["Das Saatgut kostet 0 €.", "Der Preis steigt im Mai.", "Die Kosten für den Zaun sind gedeckt."]) assert.ok(hat(t, "geld"), t);
  for (const t of ["Der Mietvertrag läuft bis 2027.", "DSGVO-Auskunft beantworten"]) assert.ok(hat(t, "recht"), t);
  for (const t of ["Schreib an jo@example.com", "Tel. 0171 2345678"]) assert.ok(hat(t, "person"), t);
  for (const t of [KOEDER, "Der Server startet neu.", "Die Produktion ist betroffen."]) assert.ok(hat(t, "zugang"), t);
  const r = istHeikel("Der Vertrag kostet 40 €.");
  assert.equal(r.heikel, true);
  assert.ok(Array.isArray(r.gruende) && r.gruende.every((g) => ["geld", "recht", "person", "zugang"].includes(g)));
});

test("Garten-Alltag ist nicht heikel; leer/null wirft nie", () => {
  for (const t of ["Der Salat wächst im Hochbeet.", "Die Tomaten stehen in Reihe 3.", "", null]) {
    assert.deepEqual(istHeikel(t), { heikel: false, gruende: [] }, String(t));
  }
});
```

- [ ] **Step 2: Tests laufen lassen**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-heikel.mjs .tools/tests/test-heikel-abnahme.mjs`
Expected: PASS. Scheitert ein Fall der Abnahme: die fehlende Regel in `heikel.mjs` ergänzen („lieber zu oft heikel“), `test-heikel.mjs` bleibt grün. Keine Wortliste mit Schlüssel und `=`/`:` dahinter (pre-commit-Secrets-Scan).

- [ ] **Step 3: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/tests/test-heikel-abnahme.mjs
git commit -m "$(printf 'kit: Abnahme heikel gegen Spec §4.3 (B1)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

(Wurde `heikel.mjs` geändert: `.tools/heikel.mjs` explizit mit in `git add`.)

---

### Task 5: `seitenfelder.mjs` + Lint `KRITISCH`, `GILT_SEIT`, `ERSETZT`, `ERSETZT-HINWEIS`, `PRÜFBEDÜRFTIG (ZWEIFEL)`

**Files:**
- Create: `.tools/seitenfelder.mjs`
- Modify: `.tools/brain-lint.mjs` (Imports Zeile 10–16; Schleife Zeile 42–95; nach der Schleife Zeile 96; `BLOCKIEREND` Zeile 98)
- Test: `.tools/tests/test-seitenfelder.mjs`, `.tools/tests/test-lint-wahrheit.mjs`

**Interfaces:**
- Consumes: `pfade.mjs#entferneBom`, `gueltigkeit.mjs#datumNr(s)` → Tageszahl | null; im Lint `wiki-pfade.mjs#resolveLink`, `#istWikiSeite`.
- Produces (für Task 8 und B2):
  - `frontmatterText(text: string): string` (BOM/CRLF egal, ohne `---`)
  - `linkZiel(wert: string): string` (`"[[ziel]]"`/`[[ziel|Text]]` → `ziel`, sonst `""`)
  - `leseSeitenFelder(text: string): { giltSeit: string | null, ersetztDurch: string | null (null = fehlt, "" = ungültig), kritisch: boolean (fail-safe), zweifel: string | null, roh: { giltSeit, ersetztDurch, kritisch, zweifel } }`
  - `pruefeSeitenFelder(text: string): Array<{ klasse: "KRITISCH" | "GILT_SEIT" | "ERSETZT", meldung: string }>`
  - Lint-Zeilen: `KRITISCH: <p> — …`, `GILT_SEIT: <p> — …`, `ERSETZT: <p> — …` (blockierend), `ERSETZT-HINWEIS: <p> — …`, `PRÜFBEDÜRFTIG (ZWEIFEL): <p> — <grund ≤ 120>` (nicht blockierend). Test-Helfer in `test-lint-wahrheit.mjs`: `vaultMit(dateien, { cfg })`, `lint(v, struktur)`, `seite(name, { fm, body })` — Tasks 6 und 7 hängen dort Tests an.

- [ ] **Step 1: Failing Tests für das Modul schreiben**

Create `.tools/tests/test-seitenfelder.mjs`:

```js
// .tools/tests/test-seitenfelder.mjs — Seitenfelder Zeit/Ersetzen/Kritisch/Zweifel (B1, §4.2/§4.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatterText, linkZiel, leseSeitenFelder, pruefeSeitenFelder } from "../seitenfelder.mjs";

const seite = (fm, body = "# Beet\n\nText.\n") => `---\nname: beet\ndescription: Beet\n${fm}---\n\n${body}`;

test("linkZiel: Wikilink mit/ohne Anzeige-Text und Anker → Ziel; alles andere → leer", () => {
  assert.equal(linkZiel("[[thema_beet_neu]]"), "thema_beet_neu");
  assert.equal(linkZiel(" [[garten/thema_beet_neu|neu]] "), "garten/thema_beet_neu");
  assert.equal(linkZiel("[[thema_beet_neu#Stand]]"), "thema_beet_neu");
  for (const w of ["thema_beet_neu", "[thema]", "[[]]", "[[a]] [[b]]", "", null]) assert.equal(linkZiel(w), "", String(w));
});

test("leseSeitenFelder: alle Felder; ersetzt_durch mit und ohne Anführungszeichen; fehlende Felder → null/false", () => {
  const f = leseSeitenFelder(seite("gilt_seit: 2026-10-21\nersetzt_durch: \"[[thema_beet_neu]]\"\nkritisch: true\nzweifel: \"2026-10-22: Nutzer sagt, abends gießen\"\n"));
  assert.deepEqual({ ...f, roh: undefined }, { giltSeit: "2026-10-21", ersetztDurch: "thema_beet_neu", kritisch: true, zweifel: "2026-10-22: Nutzer sagt, abends gießen", roh: undefined });
  assert.equal(leseSeitenFelder(seite("ersetzt_durch: [[thema_beet_neu]]\n")).ersetztDurch, "thema_beet_neu");
  assert.deepEqual({ ...leseSeitenFelder(seite("")), roh: undefined }, { giltSeit: null, ersetztDurch: null, kritisch: false, zweifel: null, roh: undefined });
});

test("kritisch ist fail-safe: nur genau false ist nicht kritisch — \"true\", ja, True, leer → kritisch + Lint KRITISCH", () => {
  assert.equal(leseSeitenFelder(seite("kritisch: false\n")).kritisch, false);
  assert.deepEqual(pruefeSeitenFelder(seite("kritisch: false\n")), []);
  for (const w of ["\"true\"", "ja", "True", "", "yes", "false # alt"]) {
    const t = seite(`kritisch: ${w}\n`);
    assert.equal(leseSeitenFelder(t).kritisch, true, w);
    assert.deepEqual(pruefeSeitenFelder(t).map((b) => b.klasse), ["KRITISCH"], w);
  }
});

test("gilt_seit: nur gültiges Datum JJJJ-MM-TT; 2026-02-30, 21.10.2026, morgen → GILT_SEIT", () => {
  assert.equal(leseSeitenFelder(seite("gilt_seit: \"2026-10-21\"\n")).giltSeit, "2026-10-21");
  for (const w of ["2026-02-30", "21.10.2026", "morgen"]) {
    const t = seite(`gilt_seit: ${w}\n`);
    assert.equal(leseSeitenFelder(t).giltSeit, null, w);
    assert.deepEqual(pruefeSeitenFelder(t).map((b) => b.klasse), ["GILT_SEIT"], w);
  }
});

test("ersetzt_durch ohne Wikilink → \"\" + ERSETZT; Felder nur im Seitentext zählen nicht", () => {
  const t = seite("ersetzt_durch: thema_beet_neu\n");
  assert.equal(leseSeitenFelder(t).ersetztDurch, "");
  assert.deepEqual(pruefeSeitenFelder(t).map((b) => b.klasse), ["ERSETZT"]);
  const nurText = seite("", "# Beet\n\nersetzt_durch: [[x]]\nkritisch: kaputt\n");
  assert.deepEqual({ ...leseSeitenFelder(nurText), roh: undefined }, { giltSeit: null, ersetztDurch: null, kritisch: false, zweifel: null, roh: undefined });
  assert.deepEqual(pruefeSeitenFelder(nurText), []);
});

test("leseSeitenFelder: BOM + CRLF (Windows-Checkout) wie LF; offenes Frontmatter → keine Felder", () => {
  const t = "﻿---\r\nname: beet\r\nkritisch: true\r\nersetzt_durch: \"[[thema_neu]]\"\r\n---\r\n\r\n# Beet\r\n";
  assert.equal(frontmatterText(t), "name: beet\nkritisch: true\nersetzt_durch: \"[[thema_neu]]\"");
  assert.equal(leseSeitenFelder(t).kritisch, true);
  assert.equal(leseSeitenFelder(t).ersetztDurch, "thema_neu");
  assert.equal(leseSeitenFelder("---\nkritisch: true\nohne Ende").kritisch, false);
});
```

- [ ] **Step 2: Test laufen lassen — er muss scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-seitenfelder.mjs`
Expected: FAIL mit `Cannot find module '…/.tools/seitenfelder.mjs'`.

- [ ] **Step 3: `seitenfelder.mjs` schreiben**

Create `.tools/seitenfelder.mjs`:

```js
// .tools/seitenfelder.mjs — Seitenfelder für Zeit und Ersetzen (B1, §4.2/§4.3): gilt_seit (JJJJ-MM-TT), ersetzt_durch
// (Wikilink auf die Nachfolgeseite), kritisch (true|false), zweifel ("<datum>: <grund>", setzt der Tageslauf nach W7).
// Lesen (Brain-Hinweis W6, Tageslauf B2) und Prüfen (Lint). Fail-safe: ein kaputtes `kritisch` gilt als kritisch —
// der Tageslauf fasst die Seite dann nie an. Nur echtes Frontmatter zählt. Rein, nur Node-Standardbibliothek.
import { entferneBom } from "./pfade.mjs";
import { datumNr } from "./gueltigkeit.mjs";

// Frontmatter-Inhalt (ohne ---) oder "" — BOM und CRLF egal; ein offenes Frontmatter zählt nicht.
export function frontmatterText(text) {
  const t = entferneBom(String(text ?? "")).replace(/\r\n?/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return m ? m[1] : "";
}
function rohFeld(fm, schluessel) {
  const m = fm.match(new RegExp(`^${schluessel}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}
function ohneAnfuehrung(w) {
  if (w.startsWith("\"")) { try { const j = JSON.parse(w); return typeof j === "string" ? j : ""; } catch { return ""; } }
  if (w.length >= 2 && w.startsWith("'") && w.endsWith("'")) return w.slice(1, -1).replace(/''/g, "'");
  return w;
}

// "[[ziel]]", "[[ziel|Text]]", "[[ziel#Abschnitt]]" → "ziel"; sonst "" (kein einzelner gültiger Wikilink).
export function linkZiel(wert) {
  const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(String(wert ?? "").trim());
  return m ? m[1].trim() : "";
}

export function leseSeitenFelder(text) {
  const fm = frontmatterText(text);
  const roh = { giltSeit: rohFeld(fm, "gilt_seit"), ersetztDurch: rohFeld(fm, "ersetzt_durch"), kritisch: rohFeld(fm, "kritisch"), zweifel: rohFeld(fm, "zweifel") };
  const gs = roh.giltSeit === null ? null : ohneAnfuehrung(roh.giltSeit);
  const zw = roh.zweifel === null ? "" : ohneAnfuehrung(roh.zweifel).trim();
  return {
    giltSeit: gs !== null && datumNr(gs) !== null ? gs : null,
    ersetztDurch: roh.ersetztDurch === null ? null : linkZiel(ohneAnfuehrung(roh.ersetztDurch)),
    kritisch: roh.kritisch !== null && roh.kritisch !== "false",
    zweifel: zw || null,
    roh,
  };
}

// Formatfehler (blockierend im Lint). Ob der Nachfolger existiert, prüft der Lint (braucht die Seitenliste).
export function pruefeSeitenFelder(text) {
  const f = leseSeitenFelder(text);
  const befunde = [];
  if (f.roh.kritisch !== null && f.roh.kritisch !== "true" && f.roh.kritisch !== "false") {
    befunde.push({ klasse: "KRITISCH", meldung: "kritisch muss true oder false sein (ohne Anführungszeichen) — bis dahin gilt die Seite als kritisch" });
  }
  if (f.roh.giltSeit !== null && f.giltSeit === null) befunde.push({ klasse: "GILT_SEIT", meldung: "gilt_seit ist kein gültiges Datum JJJJ-MM-TT" });
  if (f.ersetztDurch === "") befunde.push({ klasse: "ERSETZT", meldung: "ersetzt_durch ist kein Wikilink — Format: ersetzt_durch: \"[[nachfolger]]\"" });
  return befunde;
}
```

- [ ] **Step 4: Modul-Test laufen lassen — grün**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-seitenfelder.mjs`
Expected: PASS.

- [ ] **Step 5: Failing Lint-Tests schreiben**

Create `.tools/tests/test-lint-wahrheit.mjs`:

```js
// .tools/tests/test-lint-wahrheit.mjs — Lint für B1 (Wahrheit): Seitenfelder (Task 5), Fakt-Belege (Task 6), Aliasse (Task 7).
// Temp-Vaults mit Leerzeichen/Umlaut/Apostroph, HOME auf Temp; --struktur = pre-commit-Modus (nur Blockierendes, Exit 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { tempOrdner, TEMP_HOME, KIT } from "./verlauf-fixture.mjs";

const LINT = join(KIT, "brain-lint.mjs");
const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("BRAIN_")));

export function vaultMit(dateien, { cfg = {} } = {}) {
  const v = tempOrdner("Lint Brän, Jo's");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg));
  for (const [rel, inhalt] of Object.entries(dateien)) {
    const f = join(v, ...rel.split("/"));
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, inhalt);
  }
  return v;
}
export function lint(v, struktur = false) {
  const r = spawnSync(process.execPath, [LINT, v, ...(struktur ? ["--struktur"] : [])],
    { encoding: "utf8", env: { ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME }, timeout: 30000, windowsHide: true });
  return { status: r.status, zeilen: (r.stdout || "").split("\n").filter((z) => z.startsWith("- ")).map((z) => z.slice(2)), stderr: r.stderr };
}
export const seite = (name, { fm = "", body = "Text." } = {}) => `---\nname: ${name}\ndescription: ${name} Beschreibung\ntyp: thema\n${fm}---\n\n# ${name}\n\n${body}\n`;
const mit = (zeilen, start) => zeilen.filter((z) => z.startsWith(start));

test("Lint Seitenfelder (--struktur): KRITISCH, GILT_SEIT und ERSETZT blockieren", () => {
  const v = vaultMit({
    "09_wiki/garten/thema_a.md": seite("thema_a", { fm: "kritisch: ja\n" }),
    "09_wiki/garten/thema_b.md": seite("thema_b", { fm: "gilt_seit: 2026-02-30\n" }),
    "09_wiki/garten/thema_c.md": seite("thema_c", { fm: "ersetzt_durch: \"[[thema_gibt_es_nicht]]\"\n" }),
    "09_wiki/garten/thema_d.md": seite("thema_d", { fm: "ersetzt_durch: \"[[thema_d]]\"\n" }),
    "09_wiki/garten/thema_e.md": seite("thema_e", { fm: "ersetzt_durch: thema_a\n" }),
  });
  const { status, zeilen } = lint(v, true);
  assert.equal(status, 2);
  assert.deepEqual(mit(zeilen, "KRITISCH:"), ["KRITISCH: garten/thema_a.md — kritisch muss true oder false sein (ohne Anführungszeichen) — bis dahin gilt die Seite als kritisch"]);
  assert.deepEqual(mit(zeilen, "GILT_SEIT:"), ["GILT_SEIT: garten/thema_b.md — gilt_seit ist kein gültiges Datum JJJJ-MM-TT"]);
  assert.deepEqual(mit(zeilen, "ERSETZT:").sort(), [
    "ERSETZT: garten/thema_c.md — Nachfolger [[thema_gibt_es_nicht]] existiert nicht",
    "ERSETZT: garten/thema_d.md — Nachfolger ist die Seite selbst",
    "ERSETZT: garten/thema_e.md — ersetzt_durch ist kein Wikilink — Format: ersetzt_durch: \"[[nachfolger]]\"",
  ]);
});

test("Lint Seitenfelder: Kette und Zweifel blockieren nicht; noch verlinkte alte Seite nur im Normalmodus, Nachfolger darf verlinken", () => {
  const v = vaultMit({
    "09_wiki/garten/thema_alt.md": seite("thema_alt", { fm: "ersetzt_durch: \"[[thema_mitte]]\"\n" }),
    "09_wiki/garten/thema_mitte.md": seite("thema_mitte", { fm: "ersetzt_durch: \"[[thema_neu]]\"\n", body: "Früher: [[thema_alt]]" }),
    "09_wiki/garten/thema_neu.md": seite("thema_neu", { fm: "kritisch: false\nzweifel: \"2026-10-22: Nutzer sagt, abends gießen\"\n" }),
    "09_wiki/garten/thema_leser.md": seite("thema_leser", { body: "Siehe [[thema_alt]]." }),
  });
  const s = lint(v, true);
  assert.equal(s.status, 0, s.zeilen.join("\n"));
  const n = lint(v).zeilen;
  assert.deepEqual(mit(n, "ERSETZT-HINWEIS:").sort(), [
    "ERSETZT-HINWEIS: garten/thema_alt.md — Nachfolger garten/thema_mitte.md ist selbst ersetzt (Kette) — direkt auf den letzten Nachfolger zeigen",
    "ERSETZT-HINWEIS: garten/thema_alt.md — wird noch verlinkt von garten/thema_leser.md (Link auf garten/thema_mitte.md umstellen)",
  ]);
  assert.deepEqual(mit(n, "PRÜFBEDÜRFTIG (ZWEIFEL):"), ["PRÜFBEDÜRFTIG (ZWEIFEL): garten/thema_neu.md — 2026-10-22: Nutzer sagt, abends gießen"]);
  const r = n.find((z) => z.startsWith("PRÜFBEDÜRFTIG (ZWEIFEL)")).match(/^PRÜFBEDÜRFTIG[^:]*:\s*(.+?)(?: — |$)/);
  assert.equal(r[1], "garten/thema_neu.md", "analyse.mjs/ansicht lesen die Seite mit diesem Muster");
});
```

Hinweis: Die Datei exportiert ihre Helfer — `node --test` stört das nicht; Tasks 6 und 7 hängen ihre Tests unten an dieselbe Datei an.

- [ ] **Step 6: Lint-Test laufen lassen — er muss scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-lint-wahrheit.mjs`
Expected: FAIL — erster Test: Status 0 statt 2 (keine Befunde), zweiter: keine `ERSETZT-HINWEIS`-Zeilen.

- [ ] **Step 7: `brain-lint.mjs` erweitern**

(a) Nach `import { istProjektseite } from "./projekt.mjs";` ergänzen:

```js
import { leseSeitenFelder, pruefeSeitenFelder } from "./seitenfelder.mjs";
```

(b) Direkt vor der Schleife `for (const p of pages) {` ergänzen:

```js
// B1: ersetzte Seiten (alt → Nachfolger, beide relativ zum Wiki) für Ketten und noch bestehende Links nach der Schleife
const ersetzt = new Map();
```

(c) In der Schleife direkt nach der `AUCH`-Prüfung (letzte Zeile vor der schließenden `}` der Schleife) einfügen:

```js
  // B1 Zeit/Ersetzen/Kritisch/Zweifel (seitenfelder.mjs): Formatfehler blockieren, Zweifel wird PRÜFBEDÜRFTIG
  for (const b of pruefeSeitenFelder(raw)) findings.push(`${b.klasse}: ${p} — ${b.meldung}`);
  const sf = leseSeitenFelder(raw);
  if (sf.ersetztDurch) {
    const ziel = resolveLink(ids, sf.ersetztDurch, wikiName, idSet);
    const zielRel = ziel && istWikiSeite(ziel, wikiName) ? ziel.slice(wikiName.length + 1) : null;
    if (!zielRel) findings.push(`ERSETZT: ${p} — Nachfolger [[${sf.ersetztDurch}]] existiert nicht`);
    else if (zielRel === p) findings.push(`ERSETZT: ${p} — Nachfolger ist die Seite selbst`);
    else ersetzt.set(p, zielRel);
  }
  if (sf.zweifel) findings.push(`PRÜFBEDÜRFTIG (ZWEIFEL): ${p} — ${sf.zweifel.replace(/\s+/g, " ").slice(0, 120)}`);
```

(d) Direkt nach der Schleife (vor `for (const g of doppelteNamen(…`) einfügen:

```js
// Ersetzte Seiten: Kette (Nachfolger selbst ersetzt) und — nur im Normalmodus, braucht die Kanten — eingehende Links
// von anderen Wiki-Seiten als dem Nachfolger. Nicht blockierend: der Tageslauf ersetzt zuerst und stellt Links danach um.
for (const [alt, neu] of ersetzt) {
  if (ersetzt.has(neu)) findings.push(`ERSETZT-HINWEIS: ${alt} — Nachfolger ${neu} ist selbst ersetzt (Kette) — direkt auf den letzten Nachfolger zeigen`);
  if (struktur) continue;
  const quellen = new Set();
  for (const e of graph.edges) {
    const von = e.source.split(sep).join("/"), nach = e.target.split(sep).join("/");
    if (nach !== `${wikiName}/${alt}` || !istWikiSeite(von, wikiName)) continue;
    const q = von.slice(wikiName.length + 1);
    if (q !== neu && q !== alt) quellen.add(q);
  }
  for (const q of [...quellen].sort()) findings.push(`ERSETZT-HINWEIS: ${alt} — wird noch verlinkt von ${q} (Link auf ${neu} umstellen)`);
}
```

(e) `BLOCKIEREND` ersetzen:

```js
const BLOCKIEREND = /^(FRONTMATTER|TOTER LINK|DOPPELTER NAME|AUCH|FRAGEN|ORDNER|TOTE QUELLE|CONFIG|KRITISCH|GILT_SEIT|ERSETZT(?=:))\b/;
```

(`ERSETZT(?=:)` trifft nur `ERSETZT:`, nicht `ERSETZT-HINWEIS:`.)

- [ ] **Step 8: Tests laufen lassen — grün; Fixture-Lint bleibt sauber**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-seitenfelder.mjs .tools/tests/test-lint-wahrheit.mjs && bash .tools/tests/test-index.sh && bash .tools/tests/test-module.sh`
Expected: PASS; die Shell-Tests melden keinen FAIL (Fixture `--struktur` weiter Exit 0).

- [ ] **Step 9: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/seitenfelder.mjs .tools/brain-lint.mjs .tools/tests/test-seitenfelder.mjs .tools/tests/test-lint-wahrheit.mjs
git commit -m "$(printf 'kit: Seitenfelder gilt_seit/ersetzt_durch/kritisch/zweifel + Lint KRITISCH/GILT_SEIT/ERSETZT (B1, §4.2/§4.3)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---
### Task 6: `fakten.mjs` + Lint `FAKT-BELEG`

**Files:**
- Create: `.tools/fakten.mjs`
- Modify: `.tools/brain-lint.mjs` (Import, vor der Schleife, in der Schleife, `BLOCKIEREND`)
- Test: `.tools/tests/test-fakten.mjs`; Ergänzung in `.tools/tests/test-lint-wahrheit.mjs`

**Interfaces:**
- Consumes: Lint-Kontext (`idSet` = alle Vault-Dateien mit `/`, `cfg.clusters[].id`); Test-Helfer `vaultMit`, `lint`, `seite`, `mit` aus `test-lint-wahrheit.mjs` (Task 5).
- Produces (für B2): `BELEG_LINK_MUSTER` (`<cluster>/belege/<JJJJ-MM>/<id>`), `datumDE(d) → "TT.MM.JJJJ"`, `belegZiel(cluster, id, datum) → string`, `baueFaktZeile({ aussage, datum, beleg }) → string`, `baueErsetzteZeile({ aussage, datum }) → string`, `leseFaktZeilen(text) → Array<{ zeile, art: "fakt" | "ersetzt" | "kaputt", aussage, datum, beleg }>`, `pruefeFaktBelege(text, { existiert(beleg) → bool, cluster: string[] }) → Array<{ meldung }>`. Lint-Zeile `FAKT-BELEG: <p> — <meldung>` (blockierend).

- [ ] **Step 1: Failing Tests schreiben**

Create `.tools/tests/test-fakten.mjs`:

```js
// .tools/tests/test-fakten.mjs — Fakt-Zeilen (B1, §4.2): Format bauen/lesen, Beleg-Links prüfen, Hand-Stichpunkte nie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { baueFaktZeile, baueErsetzteZeile, leseFaktZeilen, pruefeFaktBelege, belegZiel, datumDE } from "../fakten.mjs";

const D = new Date(2026, 9, 21, 12);

test("baueFaktZeile/baueErsetzteZeile: exakt das Spec-Format; Ungültiges wirft", () => {
  const beleg = belegZiel("20_garten", "b-123", D);
  assert.equal(beleg, "20_garten/belege/2026-10/b-123");
  assert.equal(baueFaktZeile({ aussage: "Möhren ab Mitte\nApril säen", datum: D, beleg }), "- Möhren ab Mitte April säen · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-123]]");
  assert.equal(baueErsetzteZeile({ aussage: "Möhren ab März", datum: new Date(2026, 9, 23, 12) }), "- ~~Möhren ab März~~ · ersetzt am 23.10.2026 durch die Zeile darunter");
  assert.equal(datumDE(new Date(2026, 0, 5, 12)), "05.01.2026");
  for (const f of [{ aussage: "", beleg }, { aussage: "a · b", beleg }, { aussage: "~~x~~", beleg }, { aussage: "siehe [[x]]", beleg },
    { aussage: "x", beleg: "20_garten/x" }, { aussage: "x", beleg: "20_garten/belege/2026-13/a" }]) {
    assert.throws(() => baueFaktZeile({ ...f, datum: D }), JSON.stringify(f));
  }
  assert.throws(() => belegZiel("20 garten", "B!", D));
});

test("leseFaktZeilen: Rundweg; ersetzt; Frontmatter und Code-Zäune zählen nicht; BOM + CRLF", () => {
  const zeile = baueFaktZeile({ aussage: "Möhren ab April", datum: D, beleg: "20_garten/belege/2026-10/b-1" });
  const t = ("﻿---\nname: x\nliste:\n- X · Stand 21.10.2026\n---\n\n## Fakten\n" + zeile + "\n```\n- Y · Stand 21.10.2026\n```\n"
    + "- ~~Möhren ab März~~ · ersetzt am 23.10.2026 durch die Zeile darunter\n").replace(/\n/g, "\r\n");
  assert.deepEqual(leseFaktZeilen(t).map(({ zeile: _z, ...r }) => r), [
    { art: "fakt", aussage: "Möhren ab April", datum: "21.10.2026", beleg: "20_garten/belege/2026-10/b-1" },
    { art: "ersetzt", aussage: "Möhren ab März", datum: "23.10.2026", beleg: "" },
  ]);
});

test("leseFaktZeilen: Hand-Stichpunkte wie auf der Live-Seite sind nie Fakt-Zeilen", () => {
  const t = "## Fakten\n- Umsatz läuft gut (Stand 19.10.)\n- Stand: Markenbuch v1 fertig\n- Stand 21.10.2026 · neu\n- Shop live, Stand 21.10.2026\n"
    + "Stand 21.10.2026 · im Fließtext\n- Preise · Stand 21.10.\n";
  assert.deepEqual(leseFaktZeilen(t), []);
  assert.deepEqual(pruefeFaktBelege(t), []);
});

test("pruefeFaktBelege: ohne Link, kein Beleg-Pfad, fremder Cluster, Beleg fehlt; vorhandener Beleg und ersetzte Zeile ok", () => {
  const t = [
    "- A ok · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-1]]",
    "- B ohne Link · Stand 21.10.2026",
    "- C falscher Pfad · Stand 21.10.2026 · [[thema_beet]]",
    "- D fremder Cluster · Stand 21.10.2026 · [[99_fremd/belege/2026-10/b-2]]",
    "- E fehlt · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-3]]",
    "- ~~F alt~~ · ersetzt am 23.10.2026 durch die Zeile darunter",
  ].join("\n");
  const da = new Set(["20_garten/belege/2026-10/b-1", "99_fremd/belege/2026-10/b-2"]);
  assert.deepEqual(pruefeFaktBelege(t, { existiert: (b) => da.has(b), cluster: ["20_garten"] }).map((b) => b.meldung), [
    "„B ohne Link“ ohne Beleg-Link — Format: - <Aussage> · Stand TT.MM.JJJJ · [[<cluster>/belege/<JJJJ-MM>/<id>]]",
    "„C falscher Pfad“ — [[thema_beet]] ist kein Beleg-Pfad (<cluster>/belege/<JJJJ-MM>/<id>)",
    "„D fremder Cluster“ — [[99_fremd/belege/2026-10/b-2]] ist kein Beleg-Pfad (<cluster>/belege/<JJJJ-MM>/<id>)",
    "„E fehlt“ — Beleg [[20_garten/belege/2026-10/b-3]] fehlt",
  ]);
});
```

An `.tools/tests/test-lint-wahrheit.mjs` unten anhängen:

```js
test("Lint FAKT-BELEG (--struktur): fehlender Beleg blockiert; vorhandener ok; Hand-Stichpunkte wie auf der Live-Seite nie", () => {
  const cfg = { clusters: [{ id: "20_garten", name: "Garten" }] };
  const ok = "- Möhren ab April · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-1]]";
  const hand = "## Fakten\n- Umsatz läuft gut (Stand 19.10.)\n- Stand: Markenbuch v1 fertig\n- Shop live, Stand 21.10.2026";
  const beleg = { "20_garten/belege/2026-10/b-1.md": "# Beleg b-1\n" };
  const r1 = lint(vaultMit({ "09_wiki/garten/thema_beet.md": seite("thema_beet", { body: `${hand}\n${ok}` }), ...beleg }, { cfg }), true);
  assert.equal(r1.status, 0, r1.zeilen.join("\n"));
  const r2 = lint(vaultMit({ "09_wiki/garten/thema_beet.md": seite("thema_beet", { body: `${hand}\n${ok}\n- Kompost · Stand 21.10.2026` }), ...beleg }, { cfg }), true);
  assert.equal(r2.status, 2);
  assert.deepEqual(mit(r2.zeilen, "FAKT-BELEG:"), ["FAKT-BELEG: garten/thema_beet.md — „Kompost“ ohne Beleg-Link — Format: - <Aussage> · Stand TT.MM.JJJJ · [[<cluster>/belege/<JJJJ-MM>/<id>]]"]);
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-fakten.mjs .tools/tests/test-lint-wahrheit.mjs`
Expected: FAIL — `Cannot find module '…/.tools/fakten.mjs'`; der Lint-Test: Status 0 statt 2.

- [ ] **Step 3: `fakten.mjs` schreiben**

Create `.tools/fakten.mjs`:

```js
// .tools/fakten.mjs — Fakt-Zeilen im Wiki (B1, §4.2): Format bauen und lesen, Beleg-Links prüfen (Lint FAKT-BELEG).
//   - <Aussage> · Stand 21.10.2026 · [[<cluster>/belege/<JJJJ-MM>/<id>]]
//   - ~~<Aussage>~~ · ersetzt am 23.10.2026 durch die Zeile darunter
// Kandidat ist nur eine Listenzeile mit „ · Stand TT.MM.JJJJ“ (Mittelpunkt U+00B7) — Hand-Stichpunkte wie „(Stand 19.10.)“
// sind nie Fakt-Zeilen. Frontmatter und Code-Zäune zählen nicht. Einfügen/Ersetzen im Wiki kommt mit dem Tageslauf (B2).
// Rein, nur Node-Standardbibliothek.
const P = "·";
export const BELEG_LINK_MUSTER = /^([^/\s\]|#]+)\/belege\/(\d{4}-(?:0[1-9]|1[0-2]))\/([a-z0-9-]{1,80})$/;
const zwei = (n) => String(n).padStart(2, "0");
const einzeilig = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function datumDE(d = new Date()) {
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`;
}
export function belegZiel(cluster, id, datum = new Date()) {
  const ziel = `${cluster}/belege/${datum.getFullYear()}-${zwei(datum.getMonth() + 1)}/${id}`;
  if (!BELEG_LINK_MUSTER.test(ziel)) throw new Error("Beleg-Ziel ungültig");
  return ziel;
}
export function baueFaktZeile({ aussage, datum = new Date(), beleg } = {}) {
  const a = einzeilig(aussage);
  if (!a || a.startsWith("~~") || a.includes(` ${P} `) || a.includes("[[")) throw new Error("Aussage ungültig");
  if (!BELEG_LINK_MUSTER.test(String(beleg ?? ""))) throw new Error("Beleg-Link ungültig");
  return `- ${a} ${P} Stand ${datumDE(datum)} ${P} [[${beleg}]]`;
}
export function baueErsetzteZeile({ aussage, datum = new Date() } = {}) {
  const a = einzeilig(aussage).replace(/~~/g, "");
  if (!a) throw new Error("Aussage ungültig");
  return `- ~~${a}~~ ${P} ersetzt am ${datumDE(datum)} durch die Zeile darunter`;
}

const KANDIDAT = new RegExp(`^- .+ ${P} Stand \\d{2}\\.\\d{2}\\.\\d{4}(?: ${P} |\\s*$)`);
const FAKT = new RegExp(`^- (.+?) ${P} Stand (\\d{2}\\.\\d{2}\\.\\d{4}) ${P} \\[\\[([^\\]|#]+)(?:\\|[^\\]]*)?\\]\\]\\s*$`);
const ERSETZT = new RegExp(`^- ~~(.+)~~ ${P} ersetzt am (\\d{2}\\.\\d{2}\\.\\d{4}) durch die Zeile darunter\\s*$`);

export function leseFaktZeilen(text) {
  const zeilen = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  if (zeilen[0] === "---") { const ende = zeilen.indexOf("---", 1); if (ende > 0) i = ende + 1; }
  const out = [];
  let zaun = false;
  for (; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (/^\s*(```|~~~)/.test(z)) { zaun = !zaun; continue; }
    if (zaun) continue;
    let m;
    if ((m = ERSETZT.exec(z))) { out.push({ zeile: i + 1, art: "ersetzt", aussage: m[1], datum: m[2], beleg: "" }); continue; }
    if (!KANDIDAT.test(z)) continue;
    if ((m = FAKT.exec(z))) out.push({ zeile: i + 1, art: "fakt", aussage: m[1], datum: m[2], beleg: m[3].trim() });
    else out.push({ zeile: i + 1, art: "kaputt", aussage: z.slice(2).split(` ${P} Stand `)[0].trim(), datum: "", beleg: "" });
  }
  return out;
}

// Befunde ohne Zeilennummer (der pre-commit vergleicht Befundzeilen mit HEAD — Zeilennummern wären immer „neu“).
const kurz = (s) => { const t = einzeilig(s); return t.length > 40 ? t.slice(0, 39) + "…" : t; };
export function pruefeFaktBelege(text, { existiert = () => false, cluster = [] } = {}) {
  const befunde = [];
  for (const f of leseFaktZeilen(text)) {
    if (f.art === "ersetzt") continue;
    if (f.art === "kaputt") {
      befunde.push({ meldung: `„${kurz(f.aussage)}“ ohne Beleg-Link — Format: - <Aussage> ${P} Stand TT.MM.JJJJ ${P} [[<cluster>/belege/<JJJJ-MM>/<id>]]` });
      continue;
    }
    const m = BELEG_LINK_MUSTER.exec(f.beleg);
    if (!m || (cluster.length && !cluster.includes(m[1]))) {
      befunde.push({ meldung: `„${kurz(f.aussage)}“ — [[${f.beleg}]] ist kein Beleg-Pfad (<cluster>/belege/<JJJJ-MM>/<id>)` });
      continue;
    }
    if (!existiert(f.beleg)) befunde.push({ meldung: `„${kurz(f.aussage)}“ — Beleg [[${f.beleg}]] fehlt` });
  }
  return befunde;
}
```

- [ ] **Step 4: Lint einbinden**

In `.tools/brain-lint.mjs`: nach `import { leseSeitenFelder, pruefeSeitenFelder } from "./seitenfelder.mjs";` ergänzen

```js
import { pruefeFaktBelege } from "./fakten.mjs";
```

vor der Schleife (neben `const ersetzt = new Map();`) ergänzen

```js
const clusterIds = (cfg.clusters || []).map((c) => c?.id).filter(Boolean);
```

in der Schleife nach dem Zweifel-Block ergänzen

```js
  // B1 Fakt-Zeilen (fakten.mjs): jede „ · Stand TT.MM.JJJJ“-Listenzeile braucht einen existierenden Beleg-Link
  for (const b of pruefeFaktBelege(raw, { existiert: (z) => idSet.has(`${z}.md`), cluster: clusterIds })) findings.push(`FAKT-BELEG: ${p} — ${b.meldung}`);
```

und `BLOCKIEREND` ersetzen:

```js
const BLOCKIEREND = /^(FRONTMATTER|TOTER LINK|DOPPELTER NAME|AUCH|FRAGEN|ORDNER|TOTE QUELLE|CONFIG|KRITISCH|GILT_SEIT|ERSETZT(?=:)|FAKT-BELEG)\b/;
```

- [ ] **Step 5: Tests laufen lassen — grün; Live-Wiki ohne neue Befunde (nur lesend)**

```bash
cd ~/brain-kit-v0.7 && node --test .tools/tests/test-fakten.mjs .tools/tests/test-lint-wahrheit.mjs && bash .tools/tests/test-index.sh
cd ~/brain-kit-v0.7 && node .tools/brain-lint.mjs . --struktur | grep -E "FAKT-BELEG|KRITISCH|GILT_SEIT|ERSETZT" ; echo "Treffer-Ende"
```

Expected: PASS; die zweite Zeile druckt nur `Treffer-Ende` (der Worktree trägt das echte Wiki — keine Seite darf durch B1 neu auffallen, auch `entitaet_revolor.md` nicht).

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/fakten.mjs .tools/brain-lint.mjs .tools/tests/test-fakten.mjs .tools/tests/test-lint-wahrheit.mjs
git commit -m "$(printf 'kit: Fakt-Zeilen mit Stand + Beleg-Link, Lint FAKT-BELEG (B1, §4.2)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 7: `aliasse.mjs` — `auch_genannt`, `.logs/aliasse.json`, Lint `ALIAS` + `DOPPELTER NAME`

**Files:**
- Create: `.tools/aliasse.mjs`
- Modify: `.tools/brain-index.mjs` (Imports Zeile 9–10; nach `mkdirSync(join(vault, ".logs"), …)` ≈ Zeile 125; Karten-Schleife ≈ Zeile 139–144)
- Modify: `.tools/brain-lint.mjs` (Import, Schleife, nach `doppelteNamen`, `BLOCKIEREND`)
- Test: `.tools/tests/test-aliasse.mjs`; Ergänzung in `.tools/tests/test-lint-wahrheit.mjs`

**Interfaces:**
- Consumes: Test-Helfer aus `test-lint-wahrheit.mjs` (Task 5).
- Produces (für B2): `MAX_ALIASSE = 10`, `MAX_ALIAS_LAENGE = 60`, `auchGenanntRoh(fm) → string | null`, `pruefeAuchGenannt(roh) → { aliase: string[], fehler: string[] }`, `normalisiereName(s) → string` (klein, ä→ae …, Nicht-Buchstaben → „-“), `eigenerName(id, fmName?) → string` (ohne Typ-Präfix), `aliasIndex(seiten: Array<{ id, name, aliase }>) → { version: 1, seiten, namen }`, `aliasDubletten(index) → Array<{ name, ids }>`, `aliasZeile(roh) → "Auch genannt: a · b" | ""`; Datei `.logs/aliasse.json` (ids vault-relativ, z. B. `09_wiki/technik/entitaet_nucleus.md`).

- [ ] **Step 1: Failing Tests schreiben**

Create `.tools/tests/test-aliasse.mjs`:

```js
// .tools/tests/test-aliasse.mjs — Entitäts-Aliasse (B1, §4.5): Format, Normalisierung, Index, Dubletten, Kartenzeile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auchGenanntRoh, pruefeAuchGenannt, normalisiereName, eigenerName, aliasIndex, aliasDubletten, aliasZeile } from "../aliasse.mjs";

test("pruefeAuchGenannt: JSON-Liste aus Texten, höchstens 10, je ≤ 60; Feld fehlt → nichts", () => {
  assert.deepEqual(pruefeAuchGenannt("[\"Nucleus Base\", \" nucleus-core \", \"Nucleus Base\"]"), { aliase: ["Nucleus Base", "nucleus-core"], fehler: [] });
  assert.deepEqual(pruefeAuchGenannt(null), { aliase: [], fehler: [] });
  assert.match(pruefeAuchGenannt("nucleus").fehler[0], /^kein gültiges JSON/);
  assert.match(pruefeAuchGenannt("{\"a\":1}").fehler[0], /^keine Liste/);
  assert.match(pruefeAuchGenannt("").fehler[0], /^leer/);
  assert.deepEqual(pruefeAuchGenannt(JSON.stringify(Array.from({ length: 11 }, (_, i) => `n${i}`))).fehler, ["11 Namen — höchstens 10"]);
  assert.deepEqual(pruefeAuchGenannt(JSON.stringify(["a".repeat(61), 5, " "])).fehler, ["Eintrag 1 hat 61 Zeichen — höchstens 60", "Eintrag 2 ist kein Text", "Eintrag 3 ist leer"]);
  assert.equal(auchGenanntRoh("name: x\r\nauch_genannt: [\"a\"]\r\n"), "[\"a\"]");
  assert.equal(auchGenanntRoh("name: x\n"), null);
});

test("normalisiereName/eigenerName: Groß/Klein, Umlaute, Trenner; Typ-Präfix weg, name-Feld zählt", () => {
  assert.equal(normalisiereName("Nucleus Base"), "nucleus-base");
  assert.equal(normalisiereName("nucleus_base"), "nucleus-base");
  assert.equal(normalisiereName("Nücleus  Straße!"), "nuecleus-strasse");
  assert.equal(eigenerName("09_wiki/technik/entitaet_nucleus.md"), "nucleus");
  assert.equal(eigenerName("09_wiki/technik/entitaet_nucleus.md", "Nucleus Core"), "nucleus-core");
  assert.equal(eigenerName("09_wiki/garten/thema_beet.md", "thema_beet"), "beet");
});

test("aliasIndex: sortiert, normalisiert; aliasDubletten nur, wenn ein Alias beteiligt ist; aliasZeile", () => {
  const idx = aliasIndex([
    { id: "b.md", name: "kern", aliase: [] },
    { id: "a.md", name: "nucleus", aliase: ["Kern", "Nucleus Base"] },
    { id: "c.md", name: "beet", aliase: [] },
    { id: "d.md", name: "beet", aliase: [] },
  ]);
  assert.deepEqual(idx, { version: 1, seiten: { "a.md": ["kern", "nucleus-base"] },
    namen: { beet: ["c.md", "d.md"], kern: ["a.md", "b.md"], nucleus: ["a.md"], "nucleus-base": ["a.md"] } });
  assert.deepEqual(aliasDubletten(idx), [{ name: "kern", ids: ["a.md", "b.md"] }]);
  assert.equal(aliasZeile("[\"Nucleus Base\", \"nucleus-core\"]"), "Auch genannt: Nucleus Base · nucleus-core");
  assert.equal(aliasZeile(null), "");
});
```

An `.tools/tests/test-lint-wahrheit.mjs`: in der Import-Zeile `import { mkdirSync, writeFileSync } from "node:fs";` zusätzlich `readFileSync` importieren und unten anhängen:

```js
test("brain-index: .logs/aliasse.json und Kartenzeile „Auch genannt“; Seite ohne Feld behält ihre Karte", () => {
  const v = vaultMit({
    "09_wiki/technik/entitaet_nucleus.md": seite("nucleus", { fm: "auch_genannt: [\"Nucleus Base\", \"nucleus-core\"]\n" }),
    "09_wiki/technik/thema_beet.md": seite("thema_beet"),
  });
  const r = spawnSync(process.execPath, [join(KIT, "brain-index.mjs"), v], { encoding: "utf8", env: { ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME }, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(v, ".logs", "aliasse.json"), "utf8")), { version: 1,
    seiten: { "09_wiki/technik/entitaet_nucleus.md": ["nucleus-base", "nucleus-core"] },
    namen: { beet: ["09_wiki/technik/thema_beet.md"], nucleus: ["09_wiki/technik/entitaet_nucleus.md"],
      "nucleus-base": ["09_wiki/technik/entitaet_nucleus.md"], "nucleus-core": ["09_wiki/technik/entitaet_nucleus.md"] } });
  assert.match(readFileSync(join(v, ".logs", "hint-karten", "entitaet_nucleus.md"), "utf8"), /\n\nAuch genannt: Nucleus Base · nucleus-core\n\nAbschnitte: /);
  assert.ok(!readFileSync(join(v, ".logs", "hint-karten", "thema_beet.md"), "utf8").includes("Auch genannt"));
});

test("Lint ALIAS (--struktur) blockiert Formatfehler; Alias-Dublette nur im Normalmodus als DOPPELTER NAME, nie blockierend", () => {
  const k = lint(vaultMit({ "09_wiki/technik/entitaet_nucleus.md": seite("nucleus", { fm: "auch_genannt: nucleus-base\n" }) }), true);
  assert.equal(k.status, 2);
  assert.deepEqual(mit(k.zeilen, "ALIAS:"), ["ALIAS: technik/entitaet_nucleus.md — kein gültiges JSON — Format: auch_genannt: [\"…\", \"…\"]"]);
  const doppelt = vaultMit({
    "09_wiki/technik/entitaet_nucleus.md": seite("nucleus", { fm: "auch_genannt: [\"Kern\"]\n" }),
    "09_wiki/technik/entitaet_kern.md": seite("kern"),
  });
  assert.equal(lint(doppelt, true).status, 0);
  assert.deepEqual(mit(lint(doppelt).zeilen, "DOPPELTER NAME:"),
    ["DOPPELTER NAME: technik/entitaet_kern.md · technik/entitaet_nucleus.md — Name „kern“ (auch_genannt) zeigt auf mehrere Seiten — Alias eindeutig machen"]);
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-aliasse.mjs .tools/tests/test-lint-wahrheit.mjs`
Expected: FAIL — `Cannot find module '…/.tools/aliasse.mjs'`; `aliasse.json` fehlt (ENOENT); `ALIAS`-Zeile fehlt.

- [ ] **Step 3: `aliasse.mjs` schreiben**

Create `.tools/aliasse.mjs`:

```js
// .tools/aliasse.mjs — Entitäts-Aliasse (B1, §4.5): Frontmatter `auch_genannt: ["nucleus", "nucleus-base"]` (eine Zeile,
// JSON wie `fragen`). brain-index baut daraus .logs/aliasse.json (Name → Seiten, fürs Einordnen im Tageslauf B2) und die
// Kartenzeile „Auch genannt: …“; der Lint prüft das Format (ALIAS, blockierend) und meldet Namen, die über einen Alias
// auf mehrere Seiten zeigen (DOPPELTER NAME, nur Normalmodus). Rein, nur Node-Standardbibliothek.
export const MAX_ALIASSE = 10;
export const MAX_ALIAS_LAENGE = 60;
const TYP_PRAEFIX = /^(?:thema|entitaet|synthese|quelle)_/;
const FORMAT = "Format: auch_genannt: [\"…\", \"…\"]";

export function auchGenanntRoh(frontmatter) {
  const m = String(frontmatter ?? "").replace(/\r\n?/g, "\n").match(/^auch_genannt:[ \t]*(.*)$/m);
  return m ? m[1].trim() : null;
}

export function pruefeAuchGenannt(roh) {
  if (roh == null) return { aliase: [], fehler: [] };
  const text = String(roh).trim();
  if (!text) return { aliase: [], fehler: [`leer — ${FORMAT}`] };
  let liste;
  try { liste = JSON.parse(text); } catch { return { aliase: [], fehler: [`kein gültiges JSON — ${FORMAT}`] }; }
  if (!Array.isArray(liste)) return { aliase: [], fehler: [`keine Liste — ${FORMAT}`] };
  const aliase = [], fehler = [];
  if (liste.length > MAX_ALIASSE) fehler.push(`${liste.length} Namen — höchstens ${MAX_ALIASSE}`);
  liste.forEach((a, i) => {
    if (typeof a !== "string") { fehler.push(`Eintrag ${i + 1} ist kein Text`); return; }
    const t = a.replace(/\s+/g, " ").trim();
    if (!t) { fehler.push(`Eintrag ${i + 1} ist leer`); return; }
    if (t.length > MAX_ALIAS_LAENGE) { fehler.push(`Eintrag ${i + 1} hat ${t.length} Zeichen — höchstens ${MAX_ALIAS_LAENGE}`); return; }
    if (aliase.length < MAX_ALIASSE && !aliase.includes(t)) aliase.push(t);
  });
  return { aliase, fehler };
}

export function normalisiereName(s) {
  return String(s ?? "").normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
// Eigener Name einer Seite: `name:` aus dem Frontmatter, sonst Dateiname — ohne Typ-Präfix, normalisiert.
export function eigenerName(id, fmName = "") {
  const basis = String(fmName ?? "").trim() || String(id ?? "").split("/").pop().replace(/\.md$/i, "");
  return normalisiereName(basis.replace(TYP_PRAEFIX, ""));
}

export function aliasIndex(seiten) {
  const proSeite = {}, namen = new Map();
  const dazu = (n, id) => { if (!n) return; if (!namen.has(n)) namen.set(n, new Set()); namen.get(n).add(id); };
  for (const s of [...(Array.isArray(seiten) ? seiten : [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const aliase = [...new Set((s.aliase || []).map(normalisiereName).filter(Boolean))].sort();
    if (aliase.length) proSeite[s.id] = aliase;
    dazu(normalisiereName(s.name), s.id);
    for (const a of aliase) dazu(a, s.id);
  }
  return { version: 1, seiten: proSeite, namen: Object.fromEntries([...namen.keys()].sort().map((k) => [k, [...namen.get(k)].sort()])) };
}

// Nur Gruppen, an denen ein Alias beteiligt ist — reine Dateinamen-Dubletten meldet der Lint schon über doppelteNamen.
export function aliasDubletten(index) {
  const out = [];
  for (const [name, ids] of Object.entries(index?.namen || {})) {
    if (ids.length < 2 || !ids.some((id) => (index.seiten?.[id] || []).includes(name))) continue;
    out.push({ name, ids });
  }
  return out;
}

export function aliasZeile(roh) {
  const { aliase } = pruefeAuchGenannt(roh);
  return aliase.length ? `Auch genannt: ${aliase.join(" · ")}` : "";
}
```

- [ ] **Step 4: `brain-index.mjs` erweitern**

Nach `import { fragenRoh, fragenZeile } from "./fragen.mjs";` ergänzen:

```js
import { auchGenanntRoh, pruefeAuchGenannt, eigenerName, aliasIndex, aliasZeile } from "./aliasse.mjs";
```

Direkt nach der Zeile `mkdirSync(join(vault, ".logs"), { recursive: true });` (vor dem Karten-Block) einfügen:

```js
// .logs/aliasse.json — Entitäts-Aliasse (aliasse.mjs): Name → Seiten, fürs Einordnen im Tageslauf (B2). Ungültige
// auch_genannt-Werte fehlen hier still (der Lint meldet sie als ALIAS).
atomic(join(vault, ".logs", "aliasse.json"), JSON.stringify(aliasIndex(wikiPages.map((p) => ({
  id: toSlash(p.id), name: eigenerName(toSlash(p.id), p.fm.name), aliase: pruefeAuchGenannt(p.fm.auch_genannt ?? null).aliase,
}))), null, 2) + "\n");
```

In der Karten-Schleife nach `const fragen = fragenZeile(fragenRoh(fmText));` ergänzen und die `karte`-Zeile ersetzen:

```js
  // B1 Aliasse: andere Namen der Entität, damit der Hinweis sie auch unter dem Alias findet (ohne Feld byte-gleich)
  const auchZeile = aliasZeile(auchGenanntRoh(fmText));
```

```js
  const karte = `# ${p.title}\n\n${p.fm.description || ""}\n\n${fragen ? fragen + "\n\n" : ""}${auchZeile ? auchZeile + "\n\n" : ""}Abschnitte: ${heads.join(" · ")}\n\nBegriffe: ${bold.join(" · ")}\n`;
```

- [ ] **Step 5: Lint einbinden**

In `.tools/brain-lint.mjs`: nach `import { pruefeFaktBelege } from "./fakten.mjs";` ergänzen

```js
import { auchGenanntRoh, pruefeAuchGenannt, eigenerName, aliasIndex, aliasDubletten } from "./aliasse.mjs";
```

vor der Schleife ergänzen: `const aliasSeiten = [];`; in der Schleife nach dem FAKT-BELEG-Block ergänzen:

```js
  // B1 Aliasse (aliasse.mjs): Formatfehler blockieren wie FRAGEN; Dubletten nach der Schleife (nur Normalmodus)
  const auchGenannt = pruefeAuchGenannt(auchGenanntRoh(fm));
  for (const f of auchGenannt.fehler) findings.push(`ALIAS: ${p} — ${f}`);
  const fmName = (fm.match(/^name:[ \t]*(.*)$/m) || [, ""])[1].trim().replace(/^["']|["']$/g, "");
  aliasSeiten.push({ id: p, name: eigenerName(p, fmName), aliase: auchGenannt.aliase });
```

direkt nach der Zeile `for (const g of doppelteNamen(…)) findings.push(…);` ergänzen:

```js
if (!struktur) for (const d of aliasDubletten(aliasIndex(aliasSeiten))) {
  findings.push(`DOPPELTER NAME: ${d.ids.join(" · ")} — Name „${d.name}“ (auch_genannt) zeigt auf mehrere Seiten — Alias eindeutig machen`);
}
```

und `BLOCKIEREND` ersetzen:

```js
const BLOCKIEREND = /^(FRONTMATTER|TOTER LINK|DOPPELTER NAME|AUCH|FRAGEN|ORDNER|TOTE QUELLE|CONFIG|KRITISCH|GILT_SEIT|ERSETZT(?=:)|FAKT-BELEG|ALIAS)\b/;
```

(`DOPPELTER NAME` steht schon in `BLOCKIEREND`, die Alias-Dublette entsteht aber nur im Normalmodus — im pre-commit nie.)

- [ ] **Step 6: Tests laufen lassen — grün; Karten im echten Wiki unverändert (nur lesend)**

```bash
cd ~/brain-kit-v0.7 && node --test .tools/tests/test-aliasse.mjs .tools/tests/test-lint-wahrheit.mjs && bash .tools/tests/test-index.sh && bash .tools/tests/test-module.sh
cd ~/brain-kit-v0.7 && grep -rl "^auch_genannt:" 09_wiki | head -3; echo "Ende"
```

Expected: PASS; die zweite Zeile druckt nur `Ende` (heute nutzt keine Live-Seite das Feld → alle Karten bleiben byte-gleich).

- [ ] **Step 7: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/aliasse.mjs .tools/brain-index.mjs .tools/brain-lint.mjs .tools/tests/test-aliasse.mjs .tools/tests/test-lint-wahrheit.mjs
git commit -m "$(printf 'kit: Entitäts-Aliasse auch_genannt — .logs/aliasse.json, Kartenzeile, Lint ALIAS/DOPPELTER NAME (B1, §4.5)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 8: W6 — Brain-Hinweis zeigt ersetzte Seiten nie als aktuell, Zweifel als PRÜFBEDÜRFTIG

**Files:**
- Modify: `.tools/hint-core.mjs` (Import Zeile 3–6; `ablaufZusatz` + `format` Zeile 56–86)
- Test: `.tools/tests/test-hint-core.mjs` (Import Zeile 3 + neue Tests unten)

**Interfaces:**
- Consumes: `seitenfelder.mjs#leseSeitenFelder` (Task 5), `gueltigkeit.mjs#gueltigkeit` (vorhanden).
- Produces: `seitenStatus(vault, page, { jetzt }?) → { ersetzt: boolean, ersetztDurch: string | null, zusatz: string }`; Hinweiszeile für ersetzte Seiten `- <pfad> — ersetzt → [[<neu>]], nicht mehr aktuell` (ungültig: `ersetzt → (Nachfolger fehlt)`), sonst `- <pfad>[ (PRÜFBEDÜRFTIG: Zweifel)][ (abgelaufen seit N Tagen)] — <desc>`. `ablaufZusatz` bleibt mit gleicher Signatur/Ausgabe. W7 (Task 9) liest die Pfade aus genau diesen Zeilen.

- [ ] **Step 1: Failing Tests schreiben**

In `.tools/tests/test-hint-core.mjs` die Import-Zeile von `../hint-core.mjs` um `seitenStatus, anzeigePfad` ergänzen und unten anhängen:

```js
function w6Vault() {
  const v = mkdtempSync(join(tmpdir(), "w6 Brän, Jo's "));
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  const schreib = (n, fm, body = "# x\n") => writeFileSync(join(v, "09_wiki", "garten", n), `---\nname: x\ndescription: d\n${fm}---\n\n${body}`);
  schreib("alt.md", "ersetzt_durch: \"[[thema_beet_neu]]\"\n");
  schreib("kaputt.md", "ersetzt_durch: thema_beet_neu\n");
  schreib("text.md", "", "# x\n\nersetzt_durch: [[y]]\n");
  schreib("zweifel.md", "zweifel: \"2026-10-22: Nutzer sagt abends\"\npruefen_bis: 2026-10-01\n");
  schreib("normal.md", "");
  return v;
}
const w6Treffer = (page, extra = {}) => [{ page, score: 0.6, description: "Gießplan alt", ...extra }];

test("W6: ersetzte Seite nie als aktuell — „ersetzt → [[neu]]“; ungültig → „(Nachfolger fehlt)“; nur echtes Frontmatter; Import unverändert", () => {
  const v = w6Vault();
  assert.equal(format(w6Treffer("09_wiki/garten/alt.md"), { vault: v }),
    `Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ${anzeigePfad(v, "09_wiki/garten/alt.md")} — ersetzt → [[thema_beet_neu]], nicht mehr aktuell`);
  assert.match(format(w6Treffer("09_wiki/garten/kaputt.md"), { vault: v }), / — ersetzt → \(Nachfolger fehlt\), nicht mehr aktuell$/);
  assert.match(format(w6Treffer("09_wiki/garten/text.md"), { vault: v }), /text\.md — Gießplan alt$/);
  assert.match(format(w6Treffer("09_wiki/garten/alt.md", { import: true }), { vault: v }), /alt\.md — Gießplan alt$/);
  assert.deepEqual(seitenStatus(v, "09_wiki/garten/alt.md"), { ersetzt: true, ersetztDurch: "thema_beet_neu", zusatz: "" });
  assert.deepEqual(seitenStatus(v, "09_wiki/garten/fehlt.md"), { ersetzt: false, ersetztDurch: null, zusatz: "" });
});

test("W6: Zweifel → „(PRÜFBEDÜRFTIG: Zweifel)“ vor dem Ablauf-Zusatz; Seite ohne Felder unverändert", () => {
  const v = w6Vault();
  const jetzt = Date.UTC(2026, 9, 21, 12);
  assert.match(format(w6Treffer("09_wiki/garten/zweifel.md"), { vault: v, jetzt }), /zweifel\.md \(PRÜFBEDÜRFTIG: Zweifel\) \(abgelaufen seit 20 Tagen\) — Gießplan alt$/);
  assert.match(format(w6Treffer("09_wiki/garten/normal.md"), { vault: v, jetzt }), /normal\.md — Gießplan alt$/);
  assert.equal(ablaufZusatz(v, "09_wiki/garten/zweifel.md", { jetzt }), " (abgelaufen seit 20 Tagen)");
});
```

- [ ] **Step 2: Test laufen lassen — er muss scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-hint-core.mjs`
Expected: FAIL — `seitenStatus` ist kein Export (SyntaxError beim Import).

- [ ] **Step 3: `hint-core.mjs` umbauen**

Nach `import { gueltigkeit } from "./gueltigkeit.mjs";` ergänzen:

```js
import { leseSeitenFelder } from "./seitenfelder.mjs";
```

Die Funktionen `ablaufZusatz` und `format` (samt Kommentar „Spec A: …“ darüber) ersetzen durch:

```js
// Kopf (≤ 4 KB) einer getroffenen Seite — einmal je Treffer, für Gültigkeit (Spec A) und W6.
function seitenKopf(vault, page) {
  if (!vault || typeof page !== "string" || !page.endsWith(".md")) return "";
  try {
    const fd = openSync(join(vault, ...page.split("/")), "r");
    try { const b = Buffer.alloc(4096); return b.subarray(0, readSync(fd, b, 0, 4096, 0)).toString("utf8"); }
    finally { closeSync(fd); }
  } catch { return ""; }
}
const hatFrontmatter = (kopf) => /^﻿?---\r?\n/.test(kopf);
// Spec A: Treffer auf eine abgelaufene Seite tragen „(abgelaufen seit N Tagen)“ (~5 Tokens). Ausgewertet nur, wenn im
// echten Frontmatter pruefen_bis steht. `verfall` braucht die Commit-Zeit (git) — die fragt der Hinweis-Hook bewusst
// nicht ab (Antwortzeit); solche Seiten bleiben hier ohne Zusatz (Lint/Gehirn zeigen es).
function ablaufAusKopf(kopf, jetzt) {
  if (!hatFrontmatter(kopf) || !/^pruefen_bis:/m.test(kopf)) return "";
  const g = gueltigkeit(kopf, { jetzt });
  if (g.status !== "abgelaufen") return "";
  return ` (abgelaufen seit ${g.tageUeber} ${g.tageUeber === 1 ? "Tag" : "Tagen"})`;
}
export function ablaufZusatz(vault, page, { jetzt = Date.now() } = {}) {
  return ablaufAusKopf(seitenKopf(vault, page), jetzt);
}
// W6 (B1): Seiten mit ersetzt_durch nie als aktuell zeigen; zweifel (W7) als PRÜFBEDÜRFTIG. Nur echtes Frontmatter.
export function seitenStatus(vault, page, { jetzt = Date.now() } = {}) {
  const kopf = seitenKopf(vault, page);
  if (!hatFrontmatter(kopf)) return { ersetzt: false, ersetztDurch: null, zusatz: "" };
  const f = leseSeitenFelder(kopf);
  if (f.ersetztDurch !== null) return { ersetzt: true, ersetztDurch: f.ersetztDurch, zusatz: "" };
  return { ersetzt: false, ersetztDurch: null, zusatz: (f.zweifel ? " (PRÜFBEDÜRFTIG: Zweifel)" : "") + ablaufAusKopf(kopf, jetzt) };
}

function trefferZeile(h, vault, jetzt) {
  const pfad = anzeigePfad(vault, h.page);
  if (h.import) return `- ${pfad} — ${h.description.slice(0, 90)}`;
  const s = seitenStatus(vault, h.page, { jetzt });
  if (s.ersetzt) return `- ${pfad} — ersetzt → ${s.ersetztDurch ? `[[${s.ersetztDurch}]]` : "(Nachfolger fehlt)"}, nicht mehr aktuell`;
  return `- ${pfad}${s.zusatz} — ${h.description.slice(0, 90)}`;
}

export function format(hits, { vault, jetzt = Date.now() } = {}) {
  if (!hits.length) return "";
  let out = "Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n" +
    hits.map(h => trefferZeile(h, vault, jetzt)).join("\n");
  // Beide Treffer im selben Themenordner → dessen generierte Übersicht anbieten (nur wenn sie existiert)
  const ordner = [...new Set(hits.map(h => dirname(h.page)))];
  if (vault && hits.length >= 2 && ordner.length === 1 && ordner[0].split("/").length >= 3) {
    const uebersicht = `${ordner[0]}/_${basename(ordner[0])}.md`;
    if (existsSync(join(vault, uebersicht))) out += `\n- Überblick: ${anzeigePfad(vault, uebersicht)}`;
  }
  return out;
}
```

Den Kopfkommentar der Datei (Zeile 1–2) ersetzen durch:

```js
// Reine Entscheidungslogik des Brain-Hinweises — kein LLM (Spec §3.2); IO nur existsSync für die Überblick-Zeile und
// der Kopf (≤ 4 KB) getroffener Seiten für Gültigkeit und W6 (ersetzt_durch, zweifel — seitenfelder.mjs). Testbar.
```

- [ ] **Step 4: Tests laufen lassen — grün, Hinweis-Hook und Laufzeit unverändert**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-hint-core.mjs .tools/tests/test-intent-gate.mjs && bash .tools/tests/test-hint-hook.sh && bash .tools/tests/test-hook-laufzeit.sh`
Expected: PASS (bestehende `format`-Tests byte-gleich; Hook < 300 ms wie bisher — weiterhin ein 4-KB-Lesen je Treffer).

- [ ] **Step 5: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/hint-core.mjs .tools/tests/test-hint-core.mjs
git commit -m "$(printf 'kit: W6 — Hinweis zeigt ersetzte Seiten als „ersetzt → [[neu]]“, Zweifel als PRÜFBEDÜRFTIG (B1, §4.2)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---
### Task 9: W7 — Fehler-Signal „Hinweis → Antwort → Korrektur“ (`w7.mjs`, Auslöser)

**Files:**
- Create: `.tools/w7.mjs`
- Modify: `.tools/adapters/claude-code/ernte-ausloeser.mjs` (Kopfkommentar, Konstanten Zeile 21–23, `starteLektionen` Zeile 117–129, `loese` Zeile 133–144)
- Test: `.tools/tests/test-w7.mjs`; Ergänzung unten in `.tools/tests/test-ernte-ausloeser.mjs`

**Interfaces:**
- Consumes: `verlauf.mjs` — `leseAb`, `nutzerNachricht`, `assistentText`, `hookAusgabe`, `kuerze`; `lektionen.mjs#korrekturGewicht`; `ernte.mjs` — `istAusgeschlossen(cwd, liste, { home })`, `nimmLock(datei, jetzt)`, `leseArgs(argv)`; `einstellungen.mjs#leseAutomatik`; `logs.mjs` — `haengeAn`, `zeitstempel`; `pfade.mjs#ordner`; Hinweis-Format aus `hint-core.mjs#format` (Task 8).
- Produces (für B2): `istKorrektur(text) → boolean`, `hinweisSeiten(text, { vault, wiki, home, plattform }) → string[]` (vault-relative Wiki-Pfade), `erkenneW7(eintraege, { vault, wiki, sitzung, home, plattform }) → Array<{ seite, sitzung, uuid, zeit, zitat }>`, `schreibeW7(vault, funde, { jetzt }) → Anzahl neu`, `leseW7(vault) → Array<{ v: 1, seite, sitzung, uuid, zeit, zitat, erkannt }>`, `w7Lauf(vault, { transkript, sid, cwd, jetzt, home }) → { status, grund?, funde, neu }`; Dateien `.logs/w7.jsonl`, `.logs/w7.log`, Sperre `.logs/w7.lock`. Auslöser: `starteW7(vault, { transkript, sid, cwd }) → boolean`, Testhaken `BRAIN_W7_SKRIPT`.

- [ ] **Step 1: Failing Tests schreiben**

Create `.tools/tests/test-w7.mjs`:

```js
// .tools/tests/test-w7.mjs — Fehler-Signal W7 (B1, §4.4): Brain-Hinweis → Antwort → Korrektur → .logs/w7.jsonl, genau einmal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { nutzer, assistent, hinweis, schreibeVerlauf, tempVault, tempOrdner, TEMP_HOME, KIT } from "./verlauf-fixture.mjs";
import { istKorrektur, hinweisSeiten, erkenneW7, schreibeW7, leseW7, w7Lauf } from "../w7.mjs";

const KOPF = "Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):";
const V = "/vault/garten brän";
const H = (seiten, vault = V) => hinweis(`${KOPF}\n${seiten.map((s) => `- ${vault}/${s} — Beschreibung`).join("\n")}`);
const z = (n) => `2026-10-21T08:0${n}:00.000Z`;
const BEET = ["09_wiki/garten/thema_beet.md"];

test("istKorrektur: Muster aus lektionen.mjs + „stimmt nicht / veraltet / überholt“; Zustimmung und Fragen nicht", () => {
  for (const t of ["Nein, das ist falsch.", "Das stimmt so nicht mehr.", "Die Seite ist veraltet.", "das war falsch", "Das ist nicht mehr aktuell.", "Das ist überholt."]) assert.ok(istKorrektur(t), t);
  for (const t of ["Danke, passt.", "Wie spät ist es?", "Stimmt, so machen wir es.", ""]) assert.ok(!istKorrektur(t), t);
});

test("hinweisSeiten: ~ und Vault mit Leerzeichen/Umlaut, Zusätze, W6-Zeile; Überblick, fremder Vault, Import, _-Dateien nie", () => {
  const text = [KOPF,
    "- ~/Mein Brän/09_wiki/garten/thema_beet.md (abgelaufen seit 3 Tagen) — Beet",
    "- ~/Mein Brän/09_wiki/garten/thema_alt.md — ersetzt → [[thema_beet]], nicht mehr aktuell",
    "- /heim/jo/mein brän/09_wiki/garten/thema_rasen.md (PRÜFBEDÜRFTIG: Zweifel) — Rasen",
    "- ~/Mein Brän/00_inbox/_import/alt/notiz.md — Import",
    "- ~/Anderes/09_wiki/garten/thema_x.md — fremd",
    "- ~/Mein Brän/09_wiki/garten/_garten.md — generiert",
    "- Überblick: ~/Mein Brän/09_wiki/garten/_garten.md",
  ].join("\n");
  assert.deepEqual(hinweisSeiten(text, { vault: "/heim/jo/Mein Brän", home: "/heim/jo", plattform: "darwin" }),
    ["09_wiki/garten/thema_beet.md", "09_wiki/garten/thema_alt.md", "09_wiki/garten/thema_rasen.md"]);
  assert.deepEqual(hinweisSeiten("Kein Hinweis\n- ~/Mein Brän/09_wiki/a.md — x", { vault: "/heim/jo/Mein Brän", home: "/heim/jo" }), []);
});

test("erkenneW7: Hinweis → Antwort → Korrektur = ein Fund je gezeigter Seite; Hinweis am Sitzungsstart zählt für den ersten Prompt", () => {
  const e = [
    nutzer("Wann gieße ich das Hochbeet?", { uuid: "p1", zeit: z(0) }),
    H(["09_wiki/garten/thema_beet.md", "09_wiki/garten/thema_wasser.md"]),
    assistent("Laut Brain um 7 Uhr."),
    nutzer("Nein, das stimmt nicht, wir gießen abends.", { uuid: "p2", zeit: z(1) }),
    assistent("Korrigiert."),
  ];
  const zitat = "Nein, das stimmt nicht, wir gießen abends.";
  assert.deepEqual(erkenneW7(e, { vault: V, sitzung: "s1" }), [
    { seite: "09_wiki/garten/thema_beet.md", sitzung: "s1", uuid: "p2", zeit: z(1), zitat },
    { seite: "09_wiki/garten/thema_wasser.md", sitzung: "s1", uuid: "p2", zeit: z(1), zitat },
  ]);
  const start = [H(BEET), nutzer("Plan?", { uuid: "p1", zeit: z(0) }), assistent("7 Uhr."), nutzer("Das ist veraltet.", { uuid: "p2", zeit: z(1) })];
  assert.equal(erkenneW7(start, { vault: V, sitzung: "s1" }).length, 1);
});

test("erkenneW7: ohne Antwort, Korrektur erst später, ohne Korrektur, anderer Hook, fremder Vault, Nebenzweig → kein Fund; Zugangsdaten → Fund ohne Zitat", () => {
  const faelle = [
    [nutzer("Plan?"), H(BEET), nutzer("Nein, falsch!")],
    [nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer("Danke."), assistent("Gern."), nutzer("Nein, das ist falsch.")],
    [nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer("Danke, passt.")],
    [nutzer("Plan?"), hinweis(`${KOPF}\n- ${V}/09_wiki/garten/thema_beet.md — x`, "SessionStart"), assistent("7 Uhr."), nutzer("Nein, falsch.")],
    [nutzer("Plan?"), H(BEET, "/vault/anders"), assistent("7 Uhr."), nutzer("Nein, falsch.")],
    [nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer("Nein, falsch.", { isSidechain: true })],
  ];
  for (const [i, e] of faelle.entries()) assert.deepEqual(erkenneW7(e, { vault: V, sitzung: "s" }), [], `Fall ${i}`);
  const koeder = ["pass", "word"].join("") + "=Koeder123";
  const [f] = erkenneW7([nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer(`Nein, falsch: ${koeder}`, { uuid: "p2" })], { vault: V, sitzung: "s" });
  assert.equal(f.seite, BEET[0]);
  assert.equal(f.zitat, "");
});

test("schreibeW7/leseW7: jeder Fund genau einmal (sitzung|uuid|seite); kaputte Zeilen stören nicht", () => {
  const v = tempVault();
  const f = { seite: BEET[0], sitzung: "s1", uuid: "p2", zeit: z(1), zitat: "Nein." };
  assert.equal(schreibeW7(v, [f, f], { jetzt: Date.UTC(2026, 9, 21, 9) }), 1);
  writeFileSync(join(v, ".logs", "w7.jsonl"), readFileSync(join(v, ".logs", "w7.jsonl"), "utf8") + "{kaputt\n");
  assert.equal(schreibeW7(v, [f, { ...f, seite: "09_wiki/garten/thema_wasser.md" }]), 1);
  assert.deepEqual(leseW7(v).map((o) => [o.v, o.seite, o.erkannt.length]), [[1, BEET[0], 20], [1, "09_wiki/garten/thema_wasser.md", 20]]);
});

function verlaufMit(v) {
  const f = join(tempOrdner("W7 Verlauf"), "sitzung w7.jsonl");
  schreibeVerlauf(f, [
    nutzer("Wann gieße ich das Hochbeet?", { uuid: "p1", zeit: z(0), cwd: "/projekte/garten" }),
    H(BEET, v),
    assistent("Laut Brain um 7 Uhr."),
    nutzer("Nein, das stimmt nicht.", { uuid: "p2", zeit: z(1), cwd: "/projekte/garten" }),
    assistent("Korrigiert."),
  ]);
  return f;
}

test("w7Lauf: w7.jsonl + w7.log; zweiter Lauf ohne Neues und Folgelauf mit mehr Verlauf ergänzen nur Neues; ausgeschlossen, kaputte Config, BRAIN_ERNTE=1 → nichts", () => {
  const v = tempVault("W7 Brän, Jo's");
  const tr = verlaufMit(v);
  const opt = { transkript: tr, sid: "sitzung-w7", cwd: "/projekte/garten", home: TEMP_HOME };
  assert.deepEqual(w7Lauf(v, opt), { status: "ok", funde: 1, neu: 1 });
  assert.deepEqual(w7Lauf(v, opt), { status: "ok", funde: 1, neu: 0 });
  const mehr = [nutzer("Und das Beet?", { uuid: "p3", zeit: z(2) }), H(BEET, v), assistent("Süd."), nutzer("Das ist veraltet.", { uuid: "p4", zeit: z(3) })];
  writeFileSync(tr, readFileSync(tr, "utf8") + mehr.map((o) => JSON.stringify(o)).join("\n") + "\n");
  assert.deepEqual(w7Lauf(v, opt), { status: "ok", funde: 2, neu: 1 });
  assert.deepEqual(leseW7(v).map((o) => o.uuid), ["p2", "p4"]);
  assert.match(readFileSync(join(v, ".logs", "w7.log"), "utf8"), /status=ok funde=2 neu=1\n$/);
  const aus = tempVault();
  writeFileSync(join(aus, "brain.config.json"), JSON.stringify({ automatik: { ernteNichtIn: ["/projekte/garten"] } }));
  assert.equal(w7Lauf(aus, { ...opt, transkript: verlaufMit(aus) }).grund, "ausgeschlossener Ordner");
  const kaputt = tempVault();
  writeFileSync(join(kaputt, "brain.config.json"), "{ kaputt");
  assert.equal(w7Lauf(kaputt, { ...opt, transkript: verlaufMit(kaputt) }).grund, "Config nicht lesbar");
  process.env.BRAIN_ERNTE = "1";
  try { assert.equal(w7Lauf(v, opt).grund, "Selbstaufruf"); } finally { delete process.env.BRAIN_ERNTE; }
  for (const x of [aus, kaputt]) assert.ok(!existsSync(join(x, ".logs", "w7.jsonl")));
});

test("w7 CLI: zwei Prozesse gleichzeitig (SessionEnd + PreCompact) → jeder Fund genau einmal, keine Ausgabe", async () => {
  const v = tempVault("W7 parallel Brän");
  const tr = verlaufMit(v);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("BRAIN_"))), HOME: TEMP_HOME, USERPROFILE: TEMP_HOME };
  const lauf = () => new Promise((fertig) => {
    const k = spawn(process.execPath, [join(KIT, "w7.mjs"), "--transkript", tr, "--sid", "sitzung-w7", "--cwd", "/projekte/garten", v], { env, windowsHide: true });
    let aus = "";
    k.stdout.on("data", (d) => { aus += d; });
    k.stderr.on("data", (d) => { aus += d; });
    k.on("close", (code) => fertig({ code, aus }));
  });
  assert.deepEqual(await Promise.all([lauf(), lauf()]), [{ code: 0, aus: "" }, { code: 0, aus: "" }]);
  assert.equal(leseW7(v).length, 1);
  assert.equal(readFileSync(join(v, ".logs", "w7.log"), "utf8").trim().split("\n").length, 2);
});
```

Unten an `.tools/tests/test-ernte-ausloeser.mjs` anhängen:

```js
// ---------- B1: Fehler-Signal W7 am Sitzungsende ----------
function fakeW7() {
  const f = join(FAKE_DIR, "fake-w7.mjs");
  if (!existsSync(f)) writeFileSync(f, `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.FAKE_W7_LOG, JSON.stringify({ args: process.argv.slice(2), vault: process.env.BRAIN_VAULT || "" }));\n`);
  return f;
}
const ohneAndere = (tag) => ({ BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: join(FAKE_DIR, `${tag}-e.json`), BRAIN_LEKTIONEN_SKRIPT: FAKE_LEKTIONEN, FAKE_LEKTIONEN_LOG: join(FAKE_DIR, `${tag}-l.json`) });

test("W7: SessionEnd/PreCompact startet w7.mjs losgelöst — ohne eigenen Schalter, still, < 300 ms", async () => {
  const v = neuerVault({}), tr = transkript(), log = join(FAKE_DIR, "w7-1.json");
  const r = starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: v, BRAIN_W7_SKRIPT: fakeW7(), FAKE_W7_LOG: log, ...ohneAndere("w7-1") }));
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
  assert.ok(r.ms < 300, `Auslöser brauchte ${r.ms} ms`);
  const lauf = await warteAuf(log);
  assert.ok(lauf, "W7 wurde nicht gestartet");
  assert.deepEqual(lauf.args, ["--transkript", tr, "--sid", "sitzung-abc123", "--cwd", "/projekte/garten", v]);
});

test("W7: --art stand, kaputte Config oder fehlendes Transkript → kein W7", async () => {
  const tr = transkript();
  const kaputt = mkdtempSync(join(tmpdir(), "ausloeser-w7-kaputt-"));
  writeFileSync(join(kaputt, "brain.config.json"), "{ kaputt");
  const faelle = [[neuerVault({}), ["--art", "stand"], hookEingabe(tr)], [kaputt, ["--art", "fakt"], hookEingabe(tr)],
    [neuerVault({}), ["--art", "fakt"], hookEingabe(join(FAKE_DIR, "gibt-es-nicht.jsonl"))]];
  for (const [i, [v, args, eingabe]] of faelle.entries()) {
    const log = join(FAKE_DIR, `w7-2-${i}.json`);
    starte(AUSLOESER, args, eingabe, basisEnv({ BRAIN_VAULT: v, BRAIN_W7_SKRIPT: fakeW7(), FAKE_W7_LOG: log, ...ohneAndere(`w7-2-${i}`) }));
    assert.ok(await sicherNichts(log), `Fall ${i}: W7 gestartet`);
  }
});

test("W7 Ende-zu-Ende: echte w7.mjs, zweimal ausgelöst (PreCompact + SessionEnd) → genau ein Fund", async () => {
  const v = neuerVault({}), d = mkdtempSync(join(tmpdir(), "ausloeser-w7-"));
  const tr = join(d, "sitzung.jsonl");
  const zeile = (o) => JSON.stringify({ cwd: "/projekte/garten", ...o });
  writeFileSync(tr, [
    zeile({ type: "user", uuid: "p1", timestamp: "2026-10-21T08:00:00.000Z", message: { role: "user", content: "Wann gieße ich das Beet?" } }),
    zeile({ type: "attachment", attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", content: `Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ${v}/09_wiki/garten/thema_beet.md — Beet` } }),
    zeile({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Um 7 Uhr." }] } }),
    zeile({ type: "user", uuid: "p2", timestamp: "2026-10-21T08:01:00.000Z", message: { role: "user", content: "Nein, das stimmt nicht." } }),
  ].join("\n") + "\n");
  const env = basisEnv({ BRAIN_VAULT: v, ...ohneAndere("w7-3") });
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), env);
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), env);
  const log = join(v, ".logs", "w7.log");
  const bis = Date.now() + 10000;
  while (Date.now() < bis && !(existsSync(log) && readFileSync(log, "utf8").trim().split("\n").length >= 2)) await new Promise((r) => setTimeout(r, 50));
  const zeilen = readFileSync(join(v, ".logs", "w7.jsonl"), "utf8").trim().split("\n");
  assert.equal(zeilen.length, 1);
  assert.equal(JSON.parse(zeilen[0]).seite, "09_wiki/garten/thema_beet.md");
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen scheitern**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-w7.mjs .tools/tests/test-ernte-ausloeser.mjs`
Expected: FAIL — `Cannot find module '…/.tools/w7.mjs'`; Auslöser-Tests: „W7 wurde nicht gestartet“.

- [ ] **Step 3: `w7.mjs` schreiben**

Create `.tools/w7.mjs`:

```js
#!/usr/bin/env node
// .tools/w7.mjs — Fehler-Signal W7/K8 (B1, §4.4): Folgt auf eine Antwort, vor deren Prompt ein Brain-Hinweis eine Wiki-Seite
// gezeigt hat, eine Korrektur der Person, wird {seite, sitzung, zitat der Korrektur} an .logs/w7.jsonl angehängt. Der
// Tageslauf (B2) setzt daraus `zweifel` und stellt eine Rückfrage. 0 Tokens, nur Regeln.
// Quelle des Hinweises ist der Verlauf selbst (attachment hook_success, UserPromptSubmit, „Brain-Treffer …“) — genau das,
// was Claude gesehen hat, in der richtigen Reihenfolge. Läuft losgelöst über ernte-ausloeser.mjs (SessionEnd/PreCompact);
// mehrere Läufe derselben Sitzung schreiben jeden Fund nur einmal (Schlüssel sitzung|uuid|seite, Sperre .logs/w7.lock).
// CLI: node .tools/w7.mjs --transkript <pfad> --sid <id> --cwd <pfad> [vault]. Gibt nie etwas aus; Ergebnis in .logs/w7.log.
import { readFileSync, appendFileSync, mkdirSync, unlinkSync, realpathSync } from "node:fs";
import { join, isAbsolute, win32 } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { leseAb, nutzerNachricht, assistentText, hookAusgabe, kuerze } from "./verlauf.mjs";
import { korrekturGewicht } from "./lektionen.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { istAusgeschlossen, nimmLock, leseArgs } from "./ernte.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { ordner } from "./pfade.mjs";

const W7_MUSTER = /\bstimmt (?:so )?nicht\b|\bdas war falsch\b|\bnicht mehr aktuell\b|\bveraltet\b|\bist überholt\b/iu;
const MAX_ZITAT = 300;

export function istKorrektur(text) {
  const t = String(text ?? "");
  return korrekturGewicht(t) >= 2 || W7_MUSTER.test(t.slice(0, 600));
}

// Wiki-Seiten aus einem Brain-Hinweis (Zeilen „- <pfad>[ (Zusatz)] — …“, hint-core.format) → vault-relativ.
export function hinweisSeiten(text, { vault, wiki = "09_wiki", home = homedir(), plattform = process.platform } = {}) {
  const t = String(text ?? "").trimStart();
  if (!t.startsWith("Brain-Treffer")) return [];
  const falt = plattform === "darwin" || plattform === "win32";
  const norm = (p) => { const f = String(p).replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC"); return falt ? f.toLowerCase() : f; };
  const v = vault ? norm(vault) : "";
  const h = String(home ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const out = [];
  for (const zeile of t.split(/\r?\n/)) {
    const m = /^- (.+?\.md)(?: \([^)]*\))* — /.exec(zeile);
    if (!m) continue;
    let p = m[1].replace(/\\/g, "/").normalize("NFC");
    if (p.startsWith("~/")) p = h + p.slice(1);
    let rel = null;
    if (v && norm(p).startsWith(v + "/")) rel = p.slice(v.length + 1);
    else if (!isAbsolute(p) && !win32.isAbsolute(p)) rel = p;
    if (!rel || !rel.startsWith(wiki + "/") || rel.split("/").includes("..") || rel.split("/").pop().startsWith("_")) continue;
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

// Runden: Prompt → (Hinweis) → Antwort → nächster Prompt. Ein Hinweis vor dem ersten Prompt (Sitzungsstart) gehört zu ihm.
export function erkenneW7(eintraege, { vault, wiki = "09_wiki", sitzung = "", home = homedir(), plattform = process.platform } = {}) {
  const funde = [];
  let wartend = [];
  let runde = null;
  for (const o of Array.isArray(eintraege) ? eintraege : []) {
    if (!o || typeof o !== "object" || o.isSidechain === true) continue;
    const h = hookAusgabe(o);
    if (h) {
      if (h.ereignis !== "UserPromptSubmit") continue;
      const ziel = runde && !runde.antwort ? runde.seiten : wartend;
      for (const s of hinweisSeiten(h.text, { vault, wiki, home, plattform })) if (!ziel.includes(s)) ziel.push(s);
      continue;
    }
    if (o.type === "assistant") { if (runde && assistentText(o).trim()) runde.antwort = true; continue; }
    const n = nutzerNachricht(o);
    if (!n?.text) continue;
    if (runde?.antwort && runde.seiten.length && istKorrektur(n.text)) {
      const zitat = hatSecretsImKontext(n.text) || hatPii(n.text) ? "" : kuerze(n.text.replace(/\s+/g, " ").trim(), MAX_ZITAT);
      for (const seite of runde.seiten) funde.push({ seite, sitzung, uuid: String(o.uuid ?? ""), zeit: String(o.timestamp ?? ""), zitat });
    }
    runde = { seiten: wartend, antwort: false };
    wartend = [];
  }
  return funde;
}

const DATEI = (vault) => join(vault, ".logs", "w7.jsonl");
const schluessel = (f) => `${f.sitzung}|${f.uuid || f.zeit}|${f.seite}`;

export function leseW7(vault) {
  let roh = "";
  try { roh = readFileSync(DATEI(vault), "utf8"); } catch { return []; }
  const out = [];
  for (const z of roh.split("\n")) { try { const o = JSON.parse(z); if (o && typeof o.seite === "string") out.push(o); } catch {} }
  return out;
}
export function schreibeW7(vault, funde, { jetzt = Date.now() } = {}) {
  const bekannt = new Set(leseW7(vault).map(schluessel));
  const neu = [];
  for (const f of funde) {
    const k = schluessel(f);
    if (bekannt.has(k)) continue;
    bekannt.add(k);
    neu.push({ v: 1, seite: f.seite, sitzung: f.sitzung, uuid: f.uuid, zeit: f.zeit, zitat: f.zitat, erkannt: new Date(jetzt).toISOString().slice(0, 19) + "Z" });
  }
  if (neu.length) {
    mkdirSync(join(vault, ".logs"), { recursive: true });
    appendFileSync(DATEI(vault), neu.map((o) => JSON.stringify(o)).join("\n") + "\n");
  }
  return neu.length;
}

const kurzWarten = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Fail-closed wie die Ernte: ohne lesbare Config oder bekannten Ordner nichts; ernteNichtIn gilt auch hier.
export function w7Lauf(vault, { transkript, sid = "", cwd = "", jetzt = Date.now(), home = homedir() } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return { status: "uebersprungen", grund: "Selbstaufruf", funde: 0, neu: 0 };
  const ende = (status, grund = "", funde = 0, neu = 0) => {
    try { haengeAn(join(vault, ".logs", "w7.log"), `${zeitstempel(new Date(jetzt))} status=${status}${grund ? ` grund=${encodeURIComponent(grund)}` : ""} funde=${funde} neu=${neu}`); } catch {}
    return { status, ...(grund ? { grund } : {}), funde, neu };
  };
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ende("uebersprungen", "Config nicht lesbar");
    if (!cwd || !(isAbsolute(cwd) || win32.isAbsolute(cwd))) return ende("uebersprungen", "Ordner unbekannt");
    if (istAusgeschlossen(cwd, werte.ernteNichtIn, { home })) return ende("uebersprungen", "ausgeschlossener Ordner");
    if (typeof transkript !== "string" || !transkript) return ende("uebersprungen", "Transkript nicht lesbar");
    const { eintraege } = leseAb(transkript, 0);
    if (eintraege.some((o) => typeof o.cwd === "string" && istAusgeschlossen(o.cwd, werte.ernteNichtIn, { home }))) return ende("uebersprungen", "ausgeschlossener Ordner");
    const funde = erkenneW7(eintraege, { vault, wiki: ordner(vault).wiki, sitzung: String(sid || "").replace(/[^\w-]/g, "").slice(0, 64), home });
    if (!funde.length) return ende("ok");
    const lock = join(vault, ".logs", "w7.lock");
    let frei = false;
    for (let i = 0; i < 40 && !(frei = nimmLock(lock, jetzt)); i++) kurzWarten(50);
    if (!frei) return ende("uebersprungen", "läuft schon", funde.length);
    try { return ende("ok", "", funde.length, schreibeW7(vault, funde, { jetzt })); }
    finally { try { unlinkSync(lock); } catch {} }
  } catch { return ende("fehler", "intern"); }
}

let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { flags, vault } = leseArgs(process.argv.slice(2));
    w7Lauf(vault, { transkript: flags.transkript, sid: flags.sid || "", cwd: flags.cwd || "" });
  } catch { /* nie Ausgabe, nie blockierend */ }
}
```

- [ ] **Step 4: Auslöser erweitern**

In `.tools/adapters/claude-code/ernte-ausloeser.mjs`:

(a) Kopfkommentar nach der Zeile `// Testhaken: BRAIN_LEKTIONEN_SKRIPT ersetzt den Pfad zu lektionen.mjs.` ergänzen:

```js
// B1: Mit „fakt“ startet zusätzlich das Fehler-Signal W7 (w7.mjs, 0 Tokens) losgelöst — ohne eigenen Schalter, nur bei
// lesbarer Config; doppelte Läufe (SessionEnd + PreCompact) entdoppelt w7.mjs selbst. Testhaken: BRAIN_W7_SKRIPT.
```

(b) Nach `const LEKTIONEN = join(HIER, "..", "..", "lektionen.mjs");` ergänzen:

```js
const W7 = join(HIER, "..", "..", "w7.mjs");
```

(c) `starteLektionen` ersetzen durch:

```js
// Gemeinsamer Start losgelöster Kindprozesse (Session-Auswerter, W7): still, nie blockierend.
function starteLosgeloest(vault, skript, args) {
  try {
    const kind = spawn(process.execPath, [skript, ...args, vault], { cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, BRAIN_VAULT: vault } });
    kind.on("error", () => {});
    kind.unref();
    return true;
  } catch { return false; }
}
const jobArgs = ({ transkript, sid = "", cwd = "" }) => ["--transkript", transkript, "--sid", saubereSid(sid), "--cwd", String(cwd || "")];
const lesbar = (t) => typeof t === "string" && t !== "" && existsSync(t);

// Session-Auswerter losgelöst starten (Schalter prüft der Aufrufer, ernteNichtIn prüft lektionen.mjs selbst).
export function starteLektionen(vault, job = {}) {
  if (process.env.BRAIN_ERNTE === "1" || !lesbar(job.transkript)) return false;
  return starteLosgeloest(vault, process.env.BRAIN_LEKTIONEN_SKRIPT || LEKTIONEN, jobArgs(job));
}
// Fehler-Signal W7 losgelöst starten (ernteNichtIn und Config prüft w7.mjs selbst).
export function starteW7(vault, job = {}) {
  if (process.env.BRAIN_ERNTE === "1" || !lesbar(job.transkript)) return false;
  return starteLosgeloest(vault, process.env.BRAIN_W7_SKRIPT || W7, jobArgs(job));
}
```

(d) In `loese` vor der Zeile `if (art === "fakt" && !fehler && werte.lektionen !== "aus") starteLektionen(vault, job);` ergänzen:

```js
  if (art === "fakt" && !fehler) starteW7(vault, job);
```

- [ ] **Step 5: Tests laufen lassen — grün**

Run: `cd ~/brain-kit-v0.7 && node --test .tools/tests/test-w7.mjs .tools/tests/test-ernte-ausloeser.mjs .tools/tests/test-lektionen.mjs && bash .tools/tests/test-hook-laufzeit.sh`
Expected: PASS (alle bisherigen Auslöser-Tests unverändert grün, Auslöser < 300 ms).

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.7
git add .tools/w7.mjs .tools/adapters/claude-code/ernte-ausloeser.mjs .tools/tests/test-w7.mjs .tools/tests/test-ernte-ausloeser.mjs
git commit -m "$(printf 'kit: W7 — Fehler-Signal Hinweis→Antwort→Korrektur nach .logs/w7.jsonl, losgelöst am Sitzungsende (B1, §4.4)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 10: Doku — Schema (live + Vorlage), Adapter-README, Kit-README, CHANGELOG

**Files:**
- Modify: `09_wiki/_schema.md` (Zeile 20; neuer Abschnitt vor `## Projekt-Steckbrief (Projektseiten, optional)`)
- Modify: `.tools/kit/vorlage/wiki/_schema.md` (neuer Abschnitt vor `## Projekt-Steckbrief (Projektseiten, optional)`)
- Modify: `.tools/adapters/claude-code/README.md` (Einträge `brain-hint.mjs`, `ernte-ausloeser.mjs`, Testliste)
- Modify: `.tools/kit/repo/README.md` (Abschnitt „Background harvest“, Datenschutz-Zeile)
- Modify: `.tools/kit/repo/CHANGELOG.md` (neuer Block `## [Unreleased]` über `## [0.5.1]`)

**Interfaces:**
- Consumes: Formate und Lint-Klassen aus Task 1–9.
- Produces: Dokumentation; der Skill `/ingest` liest `_schema.md` (kein Skill-Update, keine Installation nötig).

- [ ] **Step 1: Schema-Abschnitt in beide `_schema.md` einfügen**

In **beiden** Dateien direkt vor der Zeile `## Projekt-Steckbrief (Projektseiten, optional)` einfügen (in der Vorlage ohne den ersten Spiegelstrich „Gültigkeit“, der dort schon unter „Optionale Frontmatter“ steht):

```markdown
## Zeit, Gültigkeit und Ersetzen (optional, Frontmatter)
- Gültigkeit: `stand: YYYY-MM-DD` (Wissensstand), `pruefen_bis: YYYY-MM-DD` (feste Frist) und/oder `verfall: <Tage>`
  (Momentaufnahme, gezählt ab dem letzten Commit der Seite). Abgelaufen → Lint `ABGELAUFEN`, der Brain-Hinweis zeigt
  „(abgelaufen seit N Tagen)“. Schnell veränderliche Tatsachen: `pruefen_bis` Standard 90 Tage, Preise 30 Tage.
- `gilt_seit: YYYY-MM-DD` — ab wann die Aussage der Seite gilt. Falsches Datum → Lint `GILT_SEIT` (blockiert).
- `ersetzt_durch: "[[<nachfolger>]]"` — die Seite ist überholt. Der Brain-Hinweis zeigt sie nur noch als
  „ersetzt → [[nachfolger]]“, nie als aktuell. Lint `ERSETZT` (blockiert): kein Wikilink, Nachfolger fehlt oder ist die
  Seite selbst. `ERSETZT-HINWEIS` (blockiert nicht): Kette (Nachfolger selbst ersetzt) oder die alte Seite wird noch
  verlinkt — Links auf den Nachfolger umstellen.
- `kritisch: true|false` — `true`: der automatische Tageslauf ändert die Seite nie, neue Fakten dazu werden zur Rückfrage.
  Nur `true` oder `false` ohne Anführungszeichen; alles andere meldet Lint `KRITISCH` (blockiert) und gilt bis zur
  Korrektur als kritisch.
- `zweifel: "<JJJJ-MM-TT>: <grund>"` — setzt der Tageslauf, wenn nach einem Brain-Hinweis auf diese Seite eine Korrektur
  kam (W7). Lint zeigt die Seite als `PRÜFBEDÜRFTIG (ZWEIFEL)`, der Hinweis mit „(PRÜFBEDÜRFTIG: Zweifel)“. Nach dem
  Prüfen entfernen.
- `auch_genannt: ["<alias>", …]` — andere Namen einer Entität (eine Zeile, JSON, höchstens 10, je ≤ 60 Zeichen; Lint
  `ALIAS` blockiert bei Formatfehlern). `brain-index` baut daraus `.logs/aliasse.json` und die Suchkarte („Auch genannt“);
  zeigt ein Alias auf mehrere Seiten, meldet der Lint `DOPPELTER NAME`.
- Diese Felder brauchen kein rev+1.

## Fakt-Zeilen und Stand-Abschnitt (Format des Tageslaufs)
- Belegte Fakt-Zeile: `- <Aussage> · Stand 21.10.2026 · [[<cluster>/belege/<JJJJ-MM>/<id>]]` — der Link zeigt auf die
  Beleg-Datei (Rohquelle mit wörtlichem Zitat, Herkunft und Fundstelle). Das Muster „ · Stand TT.MM.JJJJ“ (Mittelpunkt)
  ist dafür reserviert: Steht es in einer Listenzeile ohne existierenden Beleg-Link, meldet Lint `FAKT-BELEG` (blockiert).
  Hand-Stichpunkte wie „(Stand 19.10.)“ sind keine Fakt-Zeilen.
- Ersetzte Fakt-Zeile: `- ~~<Aussage>~~ · ersetzt am 23.10.2026 durch die Zeile darunter` — bleibt sichtbar, bis die
  Konsolidierung sie entfernt; die Historie liegt in Git.
- Projektseiten: `## Stand` (wird ersetzt) und `## Verlauf` (eine Zeile je früherem Stand, neueste oben, höchstens 10).
```

Nur in `09_wiki/_schema.md` Zeile 20 ersetzen:

```markdown
  auf das führende System. Gültigkeit per Frontmatter (siehe „Zeit, Gültigkeit und Ersetzen“).
```

- [ ] **Step 2: Adapter-README**

In `.tools/adapters/claude-code/README.md`:
- Im Eintrag `brain-hint.mjs` nach „… zählt nicht zum 600-Zeichen-Budget des Such-Hinweises.“ anhängen: `Seit B1 (W6): Treffer auf eine Seite mit „ersetzt_durch“ erscheinen nur als „ersetzt → [[neu]], nicht mehr aktuell“, Seiten mit „zweifel“ tragen „(PRÜFBEDÜRFTIG: Zweifel)“.`
- Im Eintrag `ernte-ausloeser.mjs` nach „… Marken älter als 7 Tage werden dort aufgeräumt.“ anhängen: `Seit B1 startet er mit „fakt“ zusätzlich das Fehler-Signal W7 (`.tools/w7.mjs`, 0 Tokens): Folgt auf eine Antwort nach einem Brain-Hinweis eine Korrektur, landet {Seite, Sitzung, Zitat der Korrektur} in `.logs/w7.jsonl` (jeder Fund genau einmal). Die Ernte speichert nur noch Vorschläge mit wörtlichem Zitat aus Nutzer- oder Werkzeug-Text (`zitat`, `herkunft`, `fundstelle`); `ernte.log` zählt `ohneBeleg` und `nurKi`.`
- In der Testliste nach `node --test .tools/tests/test-ernte-ausloeser.mjs` ergänzen:
  ```
  node --test .tools/tests/test-w7.mjs .tools/tests/test-ernte-beleg.mjs .tools/tests/test-hint-core.mjs
  ```

- [ ] **Step 3: Kit-README (Englisch)**

In `.tools/kit/repo/README.md`, Abschnitt „## Background harvest“: direkt vor dem Spiegelstrich `- **Never secrets:** …` einfügen:

```markdown
- **Every fact needs proof:** Haiku must add a verbatim quote from your own words or from a tool result (a file it
  read, a command it ran, a web page). A script checks that the quote really is in the transcript. Facts without a
  quote, or backed only by the AI's own words or by text injected from your brain, are dropped and counted in
  `.logs/ernte.log`.
```

und die Zeile `  - **The background harvest, only if you switch it on:** a short excerpt of the session (secrets removed)` samt Folgezeile ersetzen durch:

```markdown
  - **The background harvest, only if you switch it on:** a short excerpt of the session and of its tool output
    (secrets and customer data removed) goes to Claude Haiku through your own Claude Code — the same provider your
    conversation already uses.
```

(Vorher prüfen: `sed -n "$(grep -n 'a short excerpt of the session (secrets removed)' .tools/kit/repo/README.md | cut -d: -f1),+1p" .tools/kit/repo/README.md` zeigt genau diese zwei Zeilen.)

- [ ] **Step 4: CHANGELOG (Englisch)**

In `.tools/kit/repo/CHANGELOG.md` direkt über `## [0.5.1] - 2026-10-12` einfügen:

```markdown
## [Unreleased]

### Added
- **Proof for every harvested fact.** Each suggestion now carries a verbatim quote, where it came from (`du` = you,
  `tool`, `web`, `ki` = the AI) and the exact place in the transcript. Quotes are checked by a script; facts without
  a quote or backed only by the AI or by injected context are dropped (`ohneBeleg`, `nurKi` in `.logs/ernte.log`).
- **Page fields for time and replacement:** `gilt_seit`, `ersetzt_durch`, `kritisch`, `zweifel`, documented with
  `stand`, `pruefen_bis` and `verfall` in `_schema.md`. The brain hint shows replaced pages as "ersetzt → [[new]]".
- **Aliases** (`auch_genannt`) in `.logs/aliasse.json` and in the search cards.
- **Error signal (W7):** a correction right after an answer that used a brain hint is recorded in `.logs/w7.jsonl`.
- Lint classes `KRITISCH`, `GILT_SEIT`, `ERSETZT`, `FAKT-BELEG`, `ALIAS` (blocking, only new findings) and
  `ERSETZT-HINWEIS`, `PRÜFBEDÜRFTIG (ZWEIFEL)` (not blocking).

```

- [ ] **Step 5: Prüfen — Struktur-Lint, Export-Tests, Secrets-Scan**

```bash
cd ~/brain-kit-v0.7 && node .tools/brain-lint.mjs . --struktur; echo "Exit $?"
cd ~/brain-kit-v0.7 && bash .tools/tests/test-export.sh && bash .tools/tests/test-migrationen.sh
cd ~/brain-kit-v0.7 && for f in 09_wiki/_schema.md .tools/kit/vorlage/wiki/_schema.md .tools/kit/repo/README.md .tools/kit/repo/CHANGELOG.md .tools/adapters/claude-code/README.md; do node .tools/secrets-muster.mjs "$f" || echo "SECRET-VERDACHT: $f"; done
```

Expected: Lint Exit 0 (wie vorher), Export- und Migrations-Tests grün, kein `SECRET-VERDACHT`.

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.7
git add 09_wiki/_schema.md .tools/kit/vorlage/wiki/_schema.md .tools/adapters/claude-code/README.md .tools/kit/repo/README.md .tools/kit/repo/CHANGELOG.md
git commit -m "$(printf 'kit: Doku B1 — Schema Zeit/Ersetzen/Fakt-Zeilen/Aliasse, Ernte mit Beleg, W6/W7, CHANGELOG\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 11: Volle Suite, Laufzeit, publish-check (Zwischencheck, `haiku`)

**Files:** keine Änderungen (nur prüfen)

**Interfaces:**
- Consumes: Branch `kit-v0.7` nach Task 1–10.
- Produces: Prüfbericht (Zahlen) für das Review in Task 12.

- [ ] **Step 1: Volle Suite und Unit-Laufzeit**

```bash
cd ~/brain-kit-v0.7 && bash .tools/tests/run-all.sh 2>&1 | tail -8; echo "Exit ${PIPESTATUS[0]}"
cd ~/brain-kit-v0.7 && node --test .tools/tests/test-*.mjs 2>&1 | grep -E "^# (tests|pass|fail|duration_ms)"
```

Expected: Exit 0, `# fail 0`, `duration_ms` < 30000 (pre-commit-Grenze 45 s; Ausgangslage aus Task 0 ≈ 12 s). Mehr als 30 s: die langsamste neue Datei melden (`node --test --test-reporter=spec <datei>`), nicht die Grenze anheben.

- [ ] **Step 2: publish-check der geänderten Kit-Dateien**

```bash
cd ~/brain-kit-v0.7 && P=$(mktemp -d) && git diff --name-only main...HEAD -- .tools | rsync -a --files-from=- . "$P/" && node .tools/kit/publish-check.mjs "$P"; echo "Exit $?"
```

Expected: keine Fundzeilen, Exit 0 (keine `/Users/…`-/`/home/…`-Pfade, keine fremden E-Mails, keine Secret-Muster — auch nicht in Tests und Fixtures).

- [ ] **Step 3: Live-Wiki unverändert sauber (nur lesend, im Worktree)**

```bash
cd ~/brain-kit-v0.7 && node .tools/brain-lint.mjs . --struktur; echo "Exit $?"
cd ~/brain-kit-v0.7 && node .tools/brain-lint.mjs . | grep -E "^- (KRITISCH|GILT_SEIT|ERSETZT|FAKT-BELEG|ALIAS|PRÜFBEDÜRFTIG \(ZWEIFEL\))" ; echo "Ende"
```

Expected: Exit 0; nur `Ende` (das echte Wiki trägt keines der neuen Felder → keine neuen Befunde). Der Normal-Lint schreibt `graph.json`/`INDEX.md`/`09_wiki/_index.md` neu — alle gitignored, `git status --short` bleibt leer.

Kein Commit.

---

### Task 12: Opus-Abschlussreview (Hauptsitzung)

**Files:** keine (Review); Befunde werden als eigene Commits (sonnet) behoben.

**Interfaces:**
- Consumes: ganzer Diff `git -C ~/brain-kit-v0.7 diff main...kit-v0.7`, dieser Plan, die Spec §4/§6.1/§8/§10, Prüfbericht aus Task 11.
- Produces: Befundliste (kritisch/wichtig/klein) an die Hauptsitzung.

- [ ] **Step 1: Genau ein Review-Subagent (`model: opus`, frischer Kontext)**

Auftrag (wörtlich an den Subagenten): „Prüfe den Diff `git -C ~/brain-kit-v0.7 diff main...kit-v0.7` gegen Spec §4 (B1) und den Plan `docs/superpowers/plans/2026-10-21-b1-wahrheit-belege.md`. Schwerpunkte: (1) Kann eingespielter oder eigener Text (system-reminder, Hinweis, Skill, Agent, Wiki-Read, Sitzung im Vault, Fehler) je als `tool`/`du` durchrutschen? (2) Kann ein Zitat gespeichert werden, das nicht wörtlich im Verlauf steht, oder Zugangs-/Kundendaten enthält? (3) Blockiert der pre-commit nach dem Merge einen normalen Ingest im echten Wiki (FAKT-BELEG/KRITISCH/ALIAS auf Bestand)? (4) W7: doppelte oder falsche Funde (Runden-Logik, parallele Läufe)? (5) Laufzeit der Hooks (brain-hint, ernte-ausloeser) und Absturzfreiheit bei kaputten Verläufen. Nur lesen, nichts ändern; Befunde mit Datei:Zeile und Schweregrad.“

- [ ] **Step 2: Befunde bewerten und beheben**

Die Hauptsitzung bewertet jeden Befund selbst (nicht blind übernehmen). Behebung je Befund durch einen `sonnet`-Umsetzer mit Test zuerst; danach Task 11 Step 1 erneut. Ein zweiter Opus-Blick nur bei kritischen Befunden.

---

### Task 13: Live-Merge — wartet auf Freigabe der Hauptsitzung

**Files:** `~/brain` (Fast-Forward auf `kit-v0.7`), nur nach ausdrücklicher Freigabe.

**Interfaces:**
- Consumes: grüner Branch `kit-v0.7` nach Task 12.
- Produces: B1 live; Abnahme §8 („eine echte Ernte nach Merge hat Zitate“).

- [ ] **Step 1: Freigabe einholen — STOPP bis zum Okay**

Sicherheitszeile an die Hauptsitzung: „schreibt `~/brain` (Fast-Forward von `main` auf `kit-v0.7`: Kit-Code, `09_wiki/_schema.md`) · Ziel: Prod (echtes Brain, wirkt ab dem nächsten Hook-Aufruf) · Rückweg: `git -C ~/brain reset --hard <alter main-Hash>` (Hash vorher notieren) · Dry-Run: `git -C ~/brain merge --ff-only --no-commit` gibt es nicht — stattdessen `git -C ~/brain log --oneline main..kit-v0.7` zeigen und `git -C ~/brain status --short` muss für die betroffenen Dateien leer sein“. Ohne ausdrückliches Okay nichts weiter.

- [ ] **Step 2: Auf aktuellen `main` bringen (das Brain committet laufend Ingests)**

```bash
git -C ~/brain log --oneline -1 main
git -C ~/brain-kit-v0.7 rebase main
cd ~/brain-kit-v0.7 && bash .tools/tests/run-all.sh 2>&1 | tail -5; echo "Exit ${PIPESTATUS[0]}"
```

Expected: Rebase ohne Konflikt (sonst: Konflikt nur in `09_wiki/_schema.md` möglich — beide Stände zusammenführen, nichts verwerfen), Suite Exit 0.

- [ ] **Step 3: Fast-Forward und Kontrolle**

```bash
git -C ~/brain rev-parse main
git -C ~/brain merge --ff-only kit-v0.7
cd ~/brain && node .tools/brain-lint.mjs --struktur; echo "Exit $?"
cd ~/brain && node .tools/brain-index.mjs && test -s .logs/aliasse.json && echo "aliasse ok"
```

Expected: FF ohne Merge-Commit; Struktur-Lint Exit 0; `aliasse ok`. Keine Hook-/Skill-Installation (Registrierung unverändert), kein Push.

- [ ] **Step 4: Abnahme nach der nächsten echten Sitzung (nur lesend)**

```bash
cd ~/brain && tail -3 .logs/ernte.log
cd ~/brain && ls -t 00_inbox/_vorschlaege | head -3 | while read f; do grep -E "^(art|zitat|herkunft|fundstelle):" "00_inbox/_vorschlaege/$f"; done
cd ~/brain && tail -2 .logs/w7.log
```

Expected: die neueste `ernte.log`-Zeile endet mit `ohneBeleg=… nurKi=…`; mindestens ein neuer Vorschlag trägt `zitat:`, `herkunft:` und `fundstelle:` (Abnahme §8). Kommt über mehrere Sitzungen nur `ohneBeleg`: der Hauptsitzung melden (Auftrag/Zitat-Format prüfen), nichts abschalten.

---

## Spec-Abdeckung (Selbstprüfung)

| Spec | Task |
|---|---|
| §4.1 Felder `zitat`/`herkunft`/`fundstelle`, `findeZitat`, Herkunft je Rolle, Mehrfachfund | 1 (beleg vorhanden + Integration), 2, 3 |
| §4.1 Ernte: Haiku-Zitat, ohne Treffer/`ki` nicht speichern, `ohneBeleg`/`nurKi`, `web` bleibt | 3 |
| §4.2 `gilt_seit`, `ersetzt_durch`, `kritisch`, `zweifel`; Doku `stand`/`pruefen_bis`/`verfall` | 5, 10 |
| §4.2 Fakt-Zeilen, ersetzte Zeilen, `## Stand`/`## Verlauf` (Format) | 6 (lesen/prüfen/bauen), 10 (Doku); Schreiben = B2 |
| §4.2 Lint `ERSETZT`, `KRITISCH`, `ZWEIFEL`, `FAKT-BELEG` | 5, 6 |
| §4.2 Hinweise W6 | 8 |
| §4.3 `kritisch`, `heikel` | 5 (fail-safe), 4 (heikel vorhanden + Abnahme) |
| §4.4 W7 | 9 |
| §4.5 Aliasse, `.logs/aliasse.json`, `DOPPELTER NAME` | 7 |
| §8 Abnahme B1 (Tests grün, Prüfset 100 %, echte Ernte mit Zitaten), Worktree, Review vor Live | 1, 11, 12, 13 |
| §9 keine settings/LaunchAgents/CLAUDE.md, kein Server | Global Constraints, 13 |
| §10 Tests `beleg`, `ernte` | 1, 3 |
