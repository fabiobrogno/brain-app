# Runde 5: Selbstläufer für alle

Stand: 14.11.2026 · Plan (nichts davon gebaut). Grundlage: `main` @ `f6a573d` (nach Runde 4), nur gelesen.
Auftrag des Nutzers (14.11.2026, wörtlich): ein Brain, „was sich immer verlässlich selbst weiterentwickelt und selbst alles macht“,
„auf Mac, Linux und Windows leicht zu installieren“, „perfekt installierbar für normale Leute“. Keine Kunden, sondern „einfach ein open repo,
was richtig geisteskrank ist und dieses Brain-Problem ein für alle Mal für alle löst“.

## 0. Worum es geht

Kortex hört auf, vor allem ein Editor zu sein. Es wird ein **Brain, das im Hintergrund läuft**: Es nimmt auf, was du ihm gibst, ordnet es jeden Tag
selbst ein, prüft und repariert sich selbst, sichert sich und hält sich aktuell. Du siehst nur noch drei Dinge: ein Symbol in der Menüleiste
bzw. im Infobereich, eine Seite „Stand“ (was es getan hat, was es von dir wissen will, Rückgängig) und, wenn du willst, den Editor.

**Prüfkriterium der Runde** (geschärft gegenüber dem Vorschlag, damit es messbar ist):

| # | Kriterium | Gemessen an |
|---|---|---|
| K1 | Ein Mensch ohne Technikwissen installiert auf **Mac, Windows und Linux (Ubuntu LTS)** in **unter 10 min**, ohne Terminal, von der Website bis „Fertig“ | Protokoll eines echten Durchlaufs je System (Uhrzeit, Klicks, Stolperstellen), mindestens Mac und Windows mit einer Person, die nicht programmiert |
| K2 | Danach läuft das Brain **7 Tage ohne Eingreifen**: mindestens 6 erfolgreiche Tagesläufe, jeden Tag eine Sicherung, kein Hinweis „du musst etwas tun“ (Rückfragen zählen nicht als Eingreifen, aber das Brain bleibt auch ohne Antworten nicht stehen), Stand-Seite grün | Stand-Seite und Lauf-Protokoll nach 7 Tagen, dazu derselbe Ablauf mit vorgestellter Uhr in der CI |
| K3 | Ein Update erscheint in dieser Woche und installiert sich ohne Zutun; danach läuft alles weiter | CI-Updatetest je System plus ein echter Beta-Schritt |
| K4 | Deinstallieren hinterlässt nichts außer dem Vault (und auf Wunsch dem Support-Ordner): kein Autostart, keine Hooks, keine MCP-Einträge | CI-Test je System |

## 1. Prüfung der Empfehlung „nicht wegwerfen, umsteuern“

**Stimmt im Kern.** Fast alles, was ein Selbstläufer braucht, gibt es schon (Abschnitt 2), und es gibt **kein einziges Release**
(`gh release list` ist leer, 0 Sterne). Es gibt also auch kein Update-Versprechen und nichts zu migrieren. Billiger wird ein Kurswechsel nicht mehr.

**Vier Korrekturen:**

1. **Keine neue „kleine App“ bauen.** Die Electron-Hülle hat Tray, Schnell erfassen, Mitteilungen und Updater schon. Ein zweites Programm
   hieße wieder zwei Oberflächen. Stattdessen: dieselbe App startet unsichtbar im Tray, und das Fenster öffnet auf einer neuen **Startseite „Stand“**.
   Der Editor bleibt einen Klick entfernt. Er ist fertig gebaut und wird nur nicht weiter ausgebaut.
2. **Das Brain bekommt heute für normale Leute kein Futter.** Die Ernte liest Claude-Code-Transkripte (`kern/ernte.mjs`). Wer kein Claude Code
   benutzt, füllt das Brain nur von Hand. Ohne Eingänge für alle (Posteingang-Ordner, Schnell erfassen, `brain_merken` aus jeder verbundenen KI)
   kann sich nichts „selbst weiterentwickeln“.
3. **„Ohne Terminal“ scheitert heute an vier Stellen, nicht an einer:** Git fehlt am Mac ohne Xcode-Werkzeuge (README: `xcode-select --install`),
   die Pakete sind unsigniert (Gatekeeper, SmartScreen), Claude Code lässt sich nur im Terminal installieren, und die Pflege mit Werkzeugen (Inbox-Einarbeitung,
   B3, Traum) gibt es nur mit Claude Code. Darum ist ein **KI-Weg ohne Claude Code Pflicht für K1**, keine Kür.
4. **Keine drei System-Planer bauen.** Statt launchd, Aufgabenplanung und systemd-Timer je einzeln ist die **App selbst der Dienst**
   (Start bei der Anmeldung, unsichtbar im Tray, Takt im Hauptprozess). Ein Weg für alle drei Systeme, mit Attrappen-Uhr testbar (Paket P1).

## 2. Bestand: was schon trägt

| Baustein | Wo | Stand für das Ziel |
|---|---|---|
| **Tageslauf** mit Fehlergrenze je Schritt, Probemodus, Budgets, Bericht | `kern/tageslauf.mjs`, `kern/tageslauf/` (47 Dateien) | trägt; ist das Herz des Selbstläufers |
| **Automatik mit Grenzen**: Lernmodus (alles als Rückfrage), Einschwingphase, Richter (Sonnet), Regeln R1–R5, Stichproben, Rücknahmen, Autostufe, heikel/kritisch nie automatisch | `tageslauf/autostufe.mjs`, `einschwingen.mjs`, `richter.mjs`, `regeln.mjs`, `heikel.mjs` | trägt; genau das Muster „entwickelt sich selbst, aber verlässlich“ |
| **Rückweg**: jede Übernahme ein Commit in einer Arbeitskopie, ff-Merge, Aktionsprotokoll, `brain zurueck <lauf\|id>`, Selbstheilung des Protokolls | `tageslauf/arbeitskopie.mjs`, `zurueck.mjs`, `heilung.mjs` | trägt |
| **Ohne KI** laufen Aufräumen, Protokoll und Heilung, Rückfragen anwenden, Integrität, Gesundheit und Lint, Index, Veraltet-Markierung, Sicherung | `ki-konten.md` §5 | trägt; das Brain bleibt ohne KI nützlich |
| Gesundheitswert 0–100, `brain doctor` (OK/FEHLT/WARN in Alltagssprache) | `kern/gesundheitswert.mjs`, `kern/doctor.mjs` | Grundlage für Selbstprüfung; repariert aber nichts |
| Sicherung (git bundle ×7, privates GitHub, höchstens alle 15 min) | `kern/backup.mjs`, `sicherung-takt.mjs` | trägt |
| **KI schlägt nur vor**: `claude -p` ohne Werkzeuge, JSON-Schema, HMAC-Token, Opt-in je Vault, `ki: nein` | `ki-runde.md`, `werkstatt/ki-kern.mjs`, `gemeinsam/ki-schema.mjs` | trägt; Vorlage für jeden weiteren Anbieter |
| Vertrauen je Vault, gehärtete Git-Schranke (Erlaubnisliste), Vault-Schutz | `kern/vertrauen.mjs`, `git-sicher*`, `vault-schutz.mjs` | trägt |
| **Electron-Hülle Windows/Linux**: Tray, Erfassen-Fenster + globales Kürzel, Mitteilungen, Menü, Fuses, Werkstatt als Kind mit eigenem Node | `electron/` (~3 700 Zeilen) | trägt; fehlt nur der Mac |
| **Pakete**: NSIS pro Benutzer ohne Admin (144 MB), AppImage (176 MB), deb (139 MB), arm64; Rauchtest installiert/startet/deinstalliert in der CI | `electron/paket/`, `ci.yml` Job `paket` | trägt; nur CI-Artefakte, nie veröffentlicht |
| **electron-updater** (GitHub-Releases, Beta-Kanal, sha512, kein Downgrade), gegen lokalen Feed belegt | `electron/updater.mjs`, `electron/test/updater.spec.mjs` | trägt; lädt heute nur nach Frage |
| Stabile Pfade `<Support>/bin/node`, `bin/kern`, Hook-Starter `bin/kortex(.cmd)` | `electron/laufzeit.mjs` | trägt; überlebt Updates und den AppImage-Einhängepunkt |
| MCP-Server und Eintrag in 9 KI-Programme (Claude Code/Desktop, Codex, Cursor, Gemini, Copilot, Zed, OpenCode, Warp) | `Ressourcen/mcp/`, `werkstatt/ki-programme/` | trägt; ist der Weg, wie „jede KI“ das Brain liest und füttert |
| Anmelden im Fenster (Claude Code, Codex), Kontingent | `einrichtung-und-konten-wie-orca.md` E3/E5 | trägt für Claude-Nutzer |
| CI auf Linux, Windows, macOS, ~216 Kern-, Node- und 74 Playwright-Specs | `.github/workflows/ci.yml` | trägt; Windows-UI hat noch 17 rote Messfälle |

## 3. Lücken

| # | Lücke | Warum sie das Ziel blockiert |
|---|---|---|
| L1 | Hintergrundlauf gibt es nur am Mac (LaunchAgent, muss je Vault ausdrücklich eingeschaltet werden, `brain dienst an`); unter Windows/Linux läuft der Tageslauf nur beim Start einer Claude-Code-Sitzung | K2 ohne Claude Code unmöglich |
| L2 | Selbstprüfung meldet nur, sie repariert nicht; es gibt keine Stand-Seite, die „alles gut“ oder „das brauche ich von dir“ in einem Satz sagt | K2 („ohne Eingreifen“) nicht beweisbar |
| L3 | KI nur über Claude Code; die Einarbeitung des Posteingangs (`tageslauf/inbox-schritt.mjs`), B3 und Traum brauchen Sonnet **mit Werkzeugen** | K1 (Claude Code braucht das Terminal), Pflege für alle |
| L4 | Eingänge für normale Leute fehlen: kein beobachteter Posteingang-Ordner für Dateien, Ernte nur aus Claude-Code-Transkripten | Brain bleibt leer |
| L5 | Git wird nicht mitgeliefert (Mac braucht Xcode-Werkzeuge, Linux-AppImage ein System-Git); die Git-Schranke braucht am Mac/Linux Perl; die volle Suche erwartet ein per npm installiertes `qmd` | K1 |
| L6 | Mac läuft auf einer zweiten Hülle (Swift, 10 800 Zeilen + 9 100 Zeilen Tests, Sparkle, nur arm64 und macOS 26) | doppelte Pflege, schmale Mac-Basis, zwei Update-Wege |
| L7 | Kein Release, keine Signatur unter Windows, Notarisierung nie echt gelaufen, Updates nur nach Frage, keine Release-Kette für Windows/Linux | K1 (Warnungen), K3 |
| L8 | Kein `SECURITY.md`, kein `CONTRIBUTING.md`, keine Website; README sagt „nur Mac, macOS 26“; Oberfläche nur auf Deutsch; Name „Kortex“ ist im selben Feld schon vergeben (Abschnitt 4, E4) | „für alle“, Vertrauen in ein Programm mit Selbst-Update |
| L9 | Kein Beweis: kein Installationstest auf frischer Umgebung ohne Node/Git im PATH, kein 7-Tage-Lauf, kein Test mit einem Nicht-Techniker | K1–K4 |

## 4. Entscheidungen für den Nutzer (mit Empfehlung)

| # | Frage | Empfehlung | Warum |
|---|---|---|---|
| **E1** | **KI für alle:** nur Claude, nur lokal, oder mehrere Wege? | **Drei Wege hinter einem Vertrag, alle ohne Werkzeuge:** (1) Claude Code bleibt erstklassig (Abo, Anmelden im Fenster); (2) **lokal über Ollama** (kostenlos, privat, Ollama hat einen grafischen Installer; Kortex erkennt es und lädt das Modell auf Knopfdruck); (3) **eigener API-Schlüssel** (Anthropic oder ein OpenAI-kompatibler Dienst; Schlüssel im System-Schlüsselbund). Die Pflege mit Werkzeugen (B3, Traum, Claude-Gedächtnis) bleibt ein Zusatz für Claude Code. | Ohne Weg 2 oder 3 ist K1 nicht erreichbar (L3). Ein OpenAI-kompatibler Adapter deckt Ollama, LM Studio, OpenAI, OpenRouter und viele andere mit **einem** Code ab. Werkzeugfrei heißt: das Bedrohungsmodell aus `ki-runde.md` gilt unverändert, die KI liefert nur JSON, Kortex schreibt. Kleine lokale Modelle urteilen schlechter (der Richter entstand, weil Haiku 3 von 4 Übernahmen falsch machte), darum öffnet die Autostufe je Anbieter erst, wenn er die Messlatte besteht (P3). |
| **E2** | **Eine Hülle:** Swift-App am Mac einstellen und Electron überall? | **Ja.** Swift wird ab sofort nicht mehr ausgebaut, Electron bekommt den Mac (P5), Swift wird gelöscht, sobald die Mac-Fassung im CI-Test gleichzieht und du sie einmal benutzt hast. | Ein Projekt ohne Kunden kann sich zwei Hüllen nicht leisten (+30–50 % auf jede Hüllen-Arbeit, `plattformen-windows-linux.md` §3). Es gibt kein Release, also keinen Umzug Sparkle → electron-updater. Gewinn: Intel-Macs und ältere macOS-Fassungen statt nur macOS 26 auf Apple Silicon (Untergrenze von Electron 45 prüfen). Preis: ~+100 MB, etwas mehr Arbeitsspeicher, etwas weniger natives Gefühl (die Oberfläche war ohnehin Web). |
| **E3** | **Geld und Anträge:** Apple-Entwicklerkonto (99 $/Jahr) und SignPath-Antrag (Windows, kostenlos für Open Source)? | **Beides ja.** Kläre zuerst, wem das laut `veroeffentlichen.md` §1 aktive Apple-Konto gehört: Gehört es der Firma, braucht ein privates offenes Projekt ein eigenes Konto. SignPath-Antrag stellen, sobald das Repo die Bedingungen erfüllt (öffentliches Release, Beschreibung, OSI-Lizenz: erfüllt). Linux bleibt unsigniert. | Ohne Notarisierung kein K1 am Mac (Gatekeeper verlangt dann „Systemeinstellungen → Trotzdem öffnen“) **und kein Selbst-Update am Mac**: electron-updater verlangt dort eine signierte App. SmartScreen-Warnungen sind für Nicht-Techniker die häufigste Abbruchstelle. Bis SignPath durch ist: Windows-Betas unsigniert mit Anleitung. |
| **E4** | **Name, Heimat, Sprache** (vor dem ersten Release festlegen, danach teuer) | **Umbenennen** (Kandidaten aus `namensrecherche-2026-10-24.md`, z. B. „Vigil“, frisch prüfen); **eigene GitHub-Organisation** für das Projekt statt des geplanten Umzugs auf das Firmenkonto; Bundle-ID `io.github.<org>.<name>`; **README und Website zuerst auf Englisch** mit deutscher Fassung; die kleine Oberfläche (Einrichtung, Stand, Tray, Mitteilungen) auf **Englisch und Deutsch**, der Editor vorerst nur Deutsch. | „Kortex“ ist schon ein KI-„Second Brain“ (kortex.co, Notiz- und Wissensprodukt mit KI; die Seite heißt derzeit „Kortex Is Becoming Eden“): gleiche Kategorie, Verwechslung und Markenrisiko. Name, Repo-Adresse und Bundle-ID stecken in jedem Updater-Feed (`app-update.yml`, `SUFeedURL`); ändern geht nur vor dem ersten Release ohne Neuinstallation. Der Umzug aufs Firmenkonto passt nicht mehr zu „keine Kunden, offenes Repo“. Englisch erreicht „alle“; die Fläche ist klein genug. |
| **E5** | **Wie selbstständig ab Werk?** (Wissen und Programm) | **Wissen:** startet im Lernmodus (alles als Rückfrage, wie heute), danach öffnet die Einschwingphase die Autostufe für **belegte** Fakten; nie automatisch: löschen, Text des Menschen umschreiben, heikel/kritisch, Notizen mit `ki: nein`. Wochenbericht, jede Übernahme mit einem Klick zurück. **Programm:** Updates laden sich selbst und installieren sich beim nächsten Neustart; nur signierte Releases aus der Release-Kette, gestaffelt (erst 10 %, dann alle), stabile Fassungen mit 3 Tagen Verzögerung; Abschalter in den Einstellungen. Nie Code aus `main` oder aus dem Vault. | „Selbst alles macht“ heißt: ohne Klick. Verlässlich heißt: mit Rückweg und Grenzen. Das Muster gibt es im Tageslauf schon und es ist gemessen (Einschwingen, Stichproben, Rücknahmen). Automatische Updates sind der Weg, wie Fehler bei allen ankommen; darum Staffelung, Verzögerung, Prüfung nach dem Update und Rückfall (P7). |

**Von mir entschieden** (Technik, nicht Geschmack, umkehrbar): die App ist der Dienst (keine OS-Planer); Git kommt mit (P4); `qmd` und der Browser-Modus
sind kein Teil des Produkts mehr; keine Telemetrie, auch nicht „anonym“. Fehlerberichte entstehen nur als Datei, die der Mensch selbst anhängt.

## 5. Pakete

Reihenfolge nach Wichtigkeit für K1–K4. Größe: S ≤ 3 Tage, M ≤ 1,5 Wochen, L ≤ 3 Wochen (Agenten-Arbeitszeit, ohne Wartezeit auf Anträge).

### P1 Die App ist der Dienst (L)
- **Ziel:** Der Tageslauf, die Sicherung und die Selbstprüfung laufen auf allen drei Systemen ohne Claude Code und ohne Zutun.
- **Umfang:** Start bei der Anmeldung (`app.setLoginItemSettings` Mac/Windows, `~/.config/autostart/<name>.desktop` unter Linux, Ziel immer der stabile
  Starter `<Support>/bin/kortex`, nie der AppImage-Einhängepunkt), Start unsichtbar im Tray (`--hintergrund`), Takt im Hauptprozess:
  stündlich `tageslauf --wenn-faellig`, Sicherung nach `sicherung-takt`, Bedingungen über `powerMonitor` (Netzteil, Leerlauf) statt `pmset`/`ioreg`.
  Verpasste Läufe holt die App beim Aufwachen nach. Ein Wächter startet eine abgestürzte Werkstatt neu (gibt es schon: 3× in 60 s). Der Mac-LaunchAgent
  wird nach P5 von selbst abgelöst (`dienst aus`, Merker übernehmen). Der Rückfall „beim Sitzungsstart“ für Claude-Code-Nutzer bleibt.
  Der Dienst läuft nur für Vaults, die ihn eingeschaltet haben und denen vertraut wird (wie heute `dienst-merker.mjs`).
- **Fertig wenn:** CI auf Linux, Windows, macOS: Autostart wird gesetzt und beim Ausschalten/Deinstallieren entfernt; mit vorgestellter Uhr laufen 7 Tage
  → 7 Läufe mit KI-Attrappe, 7 Sicherungen, 0 Fehler; ein simulierter Absturz und ein „verschlafener“ Tag werden nachgeholt; Leerlauf-/Netzteil-Bedingung mit Attrappe belegt.
- **Risiken:** Linux-Desktops ohne Tray (GNOME ohne AppIndicator) → Hintergrundlauf auch ohne sichtbares Symbol, Fenster öffnet aus dem Startmenü;
  macOS meldet „Hintergrundobjekt hinzugefügt“ (normal, im Einrichtungstext ankündigen); Läufe nur bei angemeldetem Menschen (bewusst: wie der LaunchAgent heute).
- **Hängt ab von:** Mac-Teil von P5. Windows/Linux sofort.

### P2 Selbstprüfung, Selbstreparatur, Stand-Seite (M)
- **Ziel:** Das Brain merkt selbst, wenn etwas nicht stimmt, repariert, was es sicher reparieren kann, und sagt sonst in einem Satz, was es braucht.
- **Umfang:** `doctor` liefert strukturierte Befunde `{ art, schwere, reparierbar, text }` statt Zeilen. Eine **Reparatur-Liste** mit Rückweg je Eintrag:
  Autostart neu setzen, Hook-/MCP-Einträge auf die stabilen Pfade zurückbiegen, verwaiste Sperren und `index.lock` lösen, Suchindex neu bauen, kaputtes JSON
  sichern (`.defekt-<Zeit>`) und neu anlegen, Kern-Kopie gegen das Manifest prüfen und neu kopieren, Arbeitskopie-Reste räumen. Läuft beim Start, täglich und nach jedem Update.
  **Startseite „Stand“** im Studio: Ampel, „Heute: 4 Notizen eingeordnet, 1 Sicherung, nichts zu tun“, Rückfragen, Verlauf mit „Rückgängig“, nächster Lauf.
  Mitteilung **nur**, wenn ein Mensch gebraucht wird (Tageslauf 2× gescheitert, Sicherung älter als 3 Tage, KI-Zugang abgelaufen, Platte voll, Update gescheitert).
  „Problem melden …“ legt ein **Diagnosepaket** an (Versionen, Befunde, letzte Protokollzeilen ohne Inhalte, Pfade gekürzt), das der Mensch selbst an ein Issue hängt.
- **Fertig wenn:** Fehlerkatalog mit mindestens 12 eingespielten Fehlern als Tests: jeder wird erkannt, mindestens 8 werden ohne Zutun repariert, die übrigen ergeben
  genau eine verständliche Mitteilung mit Knopf; das Diagnosepaket enthält in einem Test-Vault mit Geheimnissen und Namen keinen Notizinhalt (Muster aus `secrets-muster.mjs`, `pii-muster.mjs`).
- **Risiken:** Reparaturen, die mehr kaputt machen → nur Einträge mit Rückweg, jede Reparatur ins Protokoll, Probemodus wie im Tageslauf.
- **Hängt ab von:** P1 für den Takt (die Liste selbst geht sofort).

### P3 KI für alle: Anbieter-Schicht ohne Werkzeuge (L)
- **Ziel:** Pflege und Vorschläge laufen mit Claude Code, Ollama oder einem API-Schlüssel, alle mit demselben Schutz.
- **Umfang:** Vertrag `gemeinsam/ki-anbieter.mjs`: `frage({ zweck, system, daten, schema, grenzen }) → { json, tokens }`. **Kein Feld für Werkzeuge**, nicht einmal optional.
  Adapter: `claude-cli` (der heutige Aufruf), `openai-kompatibel` (Chat Completions mit JSON-Schema; Ollama, LM Studio, OpenAI, OpenRouter …), `anthropic-api` (Messages API).
  Basis-Adresse nur `https://` oder `http://127.0.0.1`/`localhost`; Schlüssel nur im System-Schlüsselbund (Electron `safeStorage`; Linux ohne Schlüsseldienst: nicht speichern und das sagen);
  Tagesgrenze für Tokens bei Schlüsseln. Umstellen auf den Vertrag: Ernte-Urteile, Einordnen, Richter, Vorschlagskarten, Zusammenfassen, Text-Aktionen, Erwähnungen,
  „Frag deinen Vault“ (Kortex sucht selbst im Suchindex und schickt das Datenpaket, statt der KI ein MCP-Lesewerkzeug zu geben).
  **Neu: Posteingang einarbeiten ohne Werkzeuge** (ersetzt für Nicht-Claude-Anbieter den Sonnet-Schritt in `inbox-schritt.mjs`): die KI liefert einen Plan im Schema
  (Zielseite als Kennung aus der Kandidatenliste oder „neue Seite“, Absätze mit wörtlichem Beleg), Kortex schreibt in der Arbeitskopie, Rest wie heute.
  **Messlatte je Anbieter und Modell** (`antwort-messlatte.mjs`, Fixtures aus dem Richter-Probelauf): nur wer sie besteht, bekommt die Autostufe; sonst bleibt der Lernmodus.
  Ollama: Erkennung, Modell laden per Knopf (`/api/pull` mit Fortschritt), Empfehlung nach Arbeitsspeicher.
- **Fertig wenn:** dieselben Kern-Tests des Tageslaufs laufen mit drei Attrappen (Claude-Platzhalter, lokaler OpenAI-kompatibler Testserver, Anthropic-Testserver) grün;
  ein Test prüft für jeden Adapter, dass kein Anfragekörper `tools`, `functions` oder `tool_choice` enthält; die Prompt-Injection-Fälle aus `ki-runde.md` §2 laufen für alle Adapter;
  Posteingang mit 5 Einträgen wird ohne Claude Code eingearbeitet, jeder Schritt einzeln zurücknehmbar; Opt-in-Text nennt den Anbieter und den Ort (lokal oder Dienst).
- **Risiken:** schwache lokale Modelle (Messlatte als Tor), Kosten bei Schlüsseln (Tagesgrenze, Kontingent-Anzeige), JSON-Schema-Unterstützung je Anbieter unterschiedlich
  (Kortex prüft ohnehin selbst, `ki-schema.mjs`), Sicherheitsfläche Netzwerk (Opus-Review Pflicht).
- **Hängt ab von:** nichts; geht sofort parallel.

### P4 Alles dabei: Git mitliefern, eine Schranke, kein npm (M)
- **Ziel:** Das Paket braucht auf keinem System etwas Vorinstalliertes.
- **Umfang:** portables Git für macOS (arm64, x64), Windows, Linux (x64, arm64) mitliefern (Vorschlag: die Builds von `dugite-native`, die GitHub Desktop nutzt; Prüfsumme wie bei Node,
  GPL-Hinweis und Quellangabe in `THIRD-PARTY-NOTICES.md`), als erster fester Ort in `windowsGitKandidaten` und den Gegenstücken; System-Git bleibt Rückfall.
  Die Perl-Prüfung `git-sicher-pruefung.pl` geht ganz nach Node (unter Windows läuft das schon, `git-sicher.mjs`): **eine** Schranke auf allen Systemen.
  `qmd` (Vektorsuche per npm) wird optional und ist ab Werk aus; der eigene Suchindex (`gemeinsam/suchindex.mjs`) trägt die Suche. Das deb bekommt keine `Depends: git` mehr.
- **Fertig wenn:** CI auf allen drei Systemen in einer Umgebung **ohne Git und ohne Node im PATH** (eigener Nutzer bzw. bereinigtes PATH): Vault anlegen, Notiz speichern,
  Fassung, Sicherung, Tageslauf, Rückgängig grün; der Schranken-Test (`kern-git-haertung.test.mjs`) läuft gegen die Node-Schranke auf allen Systemen; Paketgröße steht im PR (Erwartung +30–60 MB).
- **Risiken:** Lizenz- und Signaturfragen beim Mitliefern (Mac: das Git muss mit signiert und notarisiert werden), Unterschiede zur Perl-Schranke (Abgleichstest beider Fassungen vor dem Löschen).
- **Hängt ab von:** nichts; parallel.

### P5 Electron auch am Mac, Swift einfrieren und abbauen (L)
- **Ziel:** Eine Hülle, ein Update-Weg, ein Satz Tests (E2).
- **Umfang:** electron-builder für macOS (dmg + zip, arm64 und x64), Notarisierung mit den vorhandenen Secrets (sobald E3 geklärt), Hardened Runtime für Node und Git;
  am Mac fehlende Hüllen-Teile nach `huellen-vertrag.json` (Menüleiste statt Tray, Erfassen-Fenster, Dock, Übersicht/Vorschau-Modus); einmalige Messung gegen die Swift-App
  (Start, Speicher, `scripts/messe-speicher.sh`). Danach eigener PR: `Sources/`, `Package.swift`, Swift-Tests, Sparkle, `rauchtest.yml` und der Swift-Teil von `release-pruefung.yml` fliegen raus;
  Texte und README sagen nicht mehr „nur macOS 26“.
- **Fertig wenn:** der Job `paket` baut und prüft auch auf macOS (dmg einhängen, nach `~/Applications` kopieren, starten, Werkstatt mit eigenem Node, MCP-Eintrag auf stabile Pfade, deinstallieren);
  alle Electron-Specs laufen auf macOS; Messwerte im PR; der Lösch-PR ist grün und senkt die Laufzeit der CI messbar (macOS-Minuten).
- **Risiken:** Erfassen-Fenster und Kürzel fühlen sich am Mac anders an (Fotos hell/dunkel zeigen, bevor Swift gelöscht wird); unsignierte Mac-Builds sind bis E3 nur für Tests.
- **Hängt ab von:** E2; Notarisierung von E3. Parallel zu P3/P4.

### P6 Einrichtung für Nicht-Techniker und saubere Deinstallation (M)
- **Ziel:** Vom ersten Start bis „Fertig“ in drei Bildschirmen, ohne ein technisches Wort.
- **Umfang:** (1) „Wo soll dein Brain liegen?“ (Vorgabe `Dokumente/<Name>`, vorhandenen Ordner wählen, Obsidian-Vault erkennen), (2) „Welche KI soll helfen?“ (erkannt: Claude Code / Ollama /
  Schlüssel einfügen / „erst mal ohne“), (3) „Fertig“: Dienst an, lokale Sicherung an, Posteingang-Ordner angelegt, KI-Programme verbunden, die erkannt wurden.
  **Posteingang-Ordner** wird beobachtet: Dateien (`.md`, `.txt`, Weblink-Dateien) und alles, was eine verbundene KI per `brain_merken` ablegt, landen im Tageslauf.
  Englisch und Deutsch für Einrichtung, Stand, Tray und Mitteilungen (Texte liegen schon getrennt in `studio/texte-*.js`). „<Name> entfernen …“ im Menü und im Windows-Deinstaller:
  Autostart, Hooks, MCP-Einträge, Starter entfernen; Vault bleibt; Support-Ordner nur auf Wunsch.
- **Fertig wenn:** Playwright-Test: frischer Start → „Fertig“ in ≤ 3 Bildschirmen und ≤ 6 Klicks mit jeder der vier KI-Wahlen; ein Text-Lint verbietet in diesen Texten Wörter wie
  git, Commit, Repository, MCP, Hook, Token, Terminal, Vault-Kennung (Ausnahme: Hilfetexte unter „Details“); Deinstallations-Test je System findet danach keinen Eintrag in
  `~/.claude*`, den Konfigurationen der KI-Programme, Autostart oder Aufgabenplanung.
- **Risiken:** „Vault“ als Wort (bleibt intern, sichtbar heißt es „dein Brain“, wenn E4 so entschieden wird), Obsidian-Ordner mit eigenem `.obsidian` (nur lesen, nichts umbauen).
- **Hängt ab von:** P1, P3 (KI-Wahl), P4.

### P7 Release-Kette und Selbst-Update für alle (M)
- **Ziel:** Ein Tag erzeugt signierte Pakete für drei Systeme; installierte Fassungen aktualisieren sich selbst und sicher (E5).
- **Umfang:** ein Workflow: Tag `v*` → Bau auf macOS, Windows, Linux → Signatur (Mac Developer ID + Notarisierung; Windows über SignPath, sobald bewilligt) →
  **Herkunftsnachweis** (GitHub Artifact Attestations) → Prerelease bzw. Release-Entwurf mit allen `latest*.yml`; veröffentlicht wird von Hand (wie heute am Mac).
  Tag-Schutz und eine Umgebung mit Freigabe für die Secrets. electron-updater: automatisch laden, beim Neustart installieren, `stagingPercentage` für die Staffelung,
  stabile Fassungen erst nach 3 Tagen. Nach jedem Update läuft die Selbstprüfung (P2); startet der neue Kern nicht, nimmt der Starter die vorige Kern-Fassung
  (`<Support>/kern/<Version>` liegt noch da) und meldet es. deb aktualisiert über die Paketverwaltung (eigene Paketquelle ist nicht in Runde 5), AppImage und NSIS selbst.
- **Fertig wenn:** CI-Updatetest auf allen drei Systemen gegen einen lokalen Feed: 0.x installiert → 0.x+1 lädt sich ohne Klick, installiert sich beim Neustart, Selbstprüfung grün;
  Rückfall bei absichtlich kaputtem Kern belegt; ein echter Schritt `beta.1 → beta.2` auf je einem echten Rechner (das macht der Nutzer).
- **Risiken:** Lieferkette: ein übernommenes GitHub-Konto erreicht alle Nutzer → 2FA mit Sicherheitsschlüssel, Freigabe-Umgebung, Signaturen, Staffelung, nie automatisch veröffentlichen.
  Windows ohne Signatur prüft Updates nur per sha512 aus demselben Release.
- **Hängt ab von:** E3, E4 (Name und Feed vor dem ersten Release), P5 für den Mac.

### P8 Beweis und Open-Source-Fundament (M)
- **Ziel:** K1–K4 belegt; das Repo ist für normale Menschen und für Mitwirkende verständlich.
- **Umfang:** **CI-Installationstest** je System auf frischem Runner ohne Node/Git im PATH: still installieren (NSIS `/S`, dmg kopieren, deb/AppImage), Einrichtung per Playwright,
  Dienst startet, 7 Tage mit vorgestellter Uhr und KI-Attrappe, Update, Deinstallation, Reste-Prüfung (K4). **Testprotokoll** für den Menschentest
  (`docs/messungen/<datum>-installation-<system>.md`: Zeit, Klicks, Stolperstellen, Zitate; Woche danach: Stand-Seite). README neu: oben für Menschen
  (was es tut, Download je System, drei Bilder, Datenschutz in fünf Sätzen), unten für Mitwirkende. `CONTRIBUTING.md` (Branches, CI, Regeln aus `ENTWICKLUNG.md`),
  `SECURITY.md` (Meldung über GitHub „Private vulnerability reporting“, unterstützte Fassungen, Bedrohungsmodell in Kurzform), Issue-Vorlagen (Fehler mit Diagnosepaket, Wunsch),
  Website auf GitHub Pages (eine Seite, Download-Knopf erkennt das System, Link auf `releases/latest`).
- **Fertig wenn:** Workflow „Installation“ grün auf drei Systemen und Tor in `ci-ok` für Release-Tags; Protokolle für Mac und Windows mit einer Person ohne Technikwissen liegen im Repo
  und zeigen < 10 min; README, `CONTRIBUTING.md`, `SECURITY.md`, Website veröffentlicht.
- **Risiken:** der Menschentest findet Dinge, die die CI nicht sieht (das ist sein Zweck: Befunde als Folgepakete, nicht in P8 nachbauen).
- **Hängt ab von:** die Texte gehen sofort; der Installationstest wächst mit P1/P4/P5; das Protokoll braucht P6 und P7.

## 6. Reihenfolge und was parallel geht

| Welle | Pakete (parallel) | Warum so |
|---|---|---|
| 0 | Entscheidungen E1–E5 | E2 und E4 ändern Pfade, Namen und Feeds; vorher keine Release-Arbeit |
| 1 | **P3** KI für alle · **P4** Alles dabei · **P5** Electron am Mac · P8-Texte (README, SECURITY, CONTRIBUTING) | voneinander unabhängig, nehmen die größten Risiken vorweg (L3, L5, L6) |
| 2 | **P1** App ist der Dienst · **P2** Selbstprüfung | brauchen die eine Hülle auf allen Systemen |
| 3 | **P6** Einrichtung · **P7** Release-Kette | brauchen KI-Wahl, Dienst und Paket |
| 4 | **P8** Beweis: CI-Installationstest als Tor, erste Beta, Menschentest, 7-Tage-Lauf | erst jetzt ist K1–K4 prüfbar |

Opus-Review: je eines nach P3 (Netzwerk, Schlüssel, Injection) und nach P7 (Lieferkette, Signatur, Rückfall); P1/P2/P4/P5 im Abschluss-Review der Welle 2 über den ganzen Diff.
Anträge (Apple, SignPath) laufen ab Welle 0 neben allem her, weil sie Wartezeit haben.

## 7. Ehrlich: was Ballast für das Ziel ist

| Teil | Urteil | Was damit passiert |
|---|---|---|
| Swift-App (`Sources/`, 10 800 + 9 100 Zeilen, Sparkle, Perl-Schranke, macOS-CI) | Ballast, sobald P5 gleichzieht | löschen (P5) |
| Browser-Modus (`kortex.sh`/`kortex.cmd`, lokaler HTTP-Dienst mit Token) | war Brücke zu Electron; für normale Leute überflüssig, eigene Sicherheitsfläche | nur noch Entwicklungswerkzeug, nicht in README/Website; nach Runde 5 entfernen, wenn niemand ihn braucht |
| Editor-Ausbau (Runde 3/4), 7 Farbschemata, 9 Akzente, 5 App-Symbole, Mica, 3D-Ansicht | fertig und gut, aber für einen Selbstläufer kein Hebel | einfrieren: nur Fehler beheben; Akzent-Frage ruht |
| Umstellung alter Kit-Vaults (`kern/umstellung/`, ~37 Dateien, P7-Assistent) | dient einem einzigen Vault (`~/brain`) | bleibt bis zur Umstellung von `~/brain`, dann entfernen |
| Traum, gemeinsames Claude-Gedächtnis über Konten, mehrere Claude-Profile je Vault, Hinweise bei jedem Prompt | Kraftwerkzeuge für Claude-Code-Nutzer | bleiben als Zusatz „Claude-Code-Anschluss“, ab Werk aus bzw. nur sichtbar, wenn Claude Code da ist |
| `qmd` (Vektorsuche per npm) | versteckte Abhängigkeit | optional, ab Werk aus (P4) |
| Team-Vision | richtig, aber später | bleibt in `vision-team.md` |

## 8. Nicht in Runde 5 (bewusst)

- **Flatpak/Snap, Microsoft Store, Mac App Store:** Sandbox verträgt sich nicht mit dem Start von `claude` und dem Schreiben in Konfigurationen anderer Programme. Mit P3 wäre Flathub
  für Nutzer ohne Claude Code denkbar: eigene Prüfung nach Runde 5. Ebenso **winget/Homebrew-Cask**: folgen dem ersten stabilen Release (klein, S).
- **Handy (iOS/Android)**, Web-Clipper, E-Mail-Eingang, PDF-Text aus Anhängen: erst wenn der Posteingang-Ordner sich bewährt.
- **Codex als Pflege-KI:** lässt sich nicht ohne Shell und Dateilesen starten (`ki-konten.md` P4). Codex bleibt als MCP-Leser verbunden. API-Schlüssel decken OpenAI ab.
- **KI mit Werkzeugen für Nicht-Claude-Anbieter:** bewusst nie. Wer Pflege mit Werkzeugen will, nimmt Claude Code.
- **Updates aus dem Repo statt aus Releases**, Plugins oder Skripte aus dem Vault: nie (Programme kommen nie aus dem Vault, `kern-umzug.md`).
- **Telemetrie, Absturzberichte an einen Server:** nein; Diagnosepaket nur von Hand.
- **Neue Editor-Funktionen, Design-Runden, Team-Funktionen.**
- **Umstellung von `~/brain`:** nur mit ausdrücklicher Freigabe, eigener Termin.

## 9. Was nicht geprüft ist

- Ob Claude Code inzwischen ohne Terminal zu installieren ist (z. B. über eine Desktop-App) und ob es unter Windows noch Git Bash braucht: nicht geprüft, keine echten Logins.
- Qualität lokaler Modelle für Einordnen und Richter: nicht gemessen; genau das macht die Messlatte in P3.
- Größe und Lizenzdetails des portablen Git je System, Notarisierung eines mitgelieferten Git: Erfahrungswerte, in P4 messen.
- Bedingungen und Wartezeit bei SignPath Foundation, Eigentümer des Apple-Kontos: nicht geprüft (E3).
- Markenlage für einen neuen Namen: nur Web-Suche zu „Kortex“ (Treffer kortex.co und Verzeichnisseiten dazu), keine Registerabfrage (DPMA/EUIPO/USPTO). Keine Rechtsberatung.
- Electron-Autostart unter Wayland-Desktops und ohne Tray: nur aus der Doku, kein echter Desktop.
