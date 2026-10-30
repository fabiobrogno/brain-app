# Plan P7: Umstellungs-Assistent für bestehende Vaults (Kit-Zeit → Kortex)

Stand 29.10.2026, Grundlage `main` @ `9307e06`. **P7a umgesetzt** (Branch `feat/umstellung-befund`), **P7b umgesetzt** (Branch `feat/umstellung-phase-a`, Abschnitt „P7b umgesetzt“ unten), P7c–P7d offen. Bezug: `docs/plaene/kern-umzug.md` (P6 fertig, P5 in Arbeit, Abschnitt „Für P7“), `docs/stand/2026-10-29/README.md`, `Ressourcen/kern/HERKUNFT.md` (P2/P6).
Ziel: Ein Vault, der noch aus der Kit-Zeit stammt (`<vault>/.tools`, alte Hooks/LaunchAgent/MCP-Einträge, lokale git-Einstellungen), wird **ohne Datenverlust, mit Probelauf an einer Kopie und mit Rückweg je Schritt** auf den gebündelten Kern umgestellt. Sichtbare Begriffe: App **Kortex**, Datenordner **Vault**.

Annahme: P7 setzt auf P5 auf (Workspace-Trust). Ein in P7 umgestellter Vault wird am Ende als „vertraut“ vermerkt; bis P5 fertig ist, ändert die Umstellung den Fingerabdruck in `gemeinsam/vertrauen.mjs` (er rechnet `.tools`-Code und git-Einstellungen ein) und das Studio fragt einmal neu. Das ist hinnehmbar, steht aber im Abschlusstext.

---

## Verbindliche Entscheidungen (29.10.2026)

1. **Lokale git-Schlüssel, die `git-sicher` sperrt, werden in Phase A NICHT flach in die globale Konfiguration verschoben.** Sie kommen in eine Datei je Vault im Support-Ordner (`<Support>/git/<Kennung>.gitconfig`, 0600) und werden per `includeIf "gitdir:…"` in die globale Konfiguration eingebunden. Das gilt auch für die Arbeitskopien des Tageslaufs (verknüpfte Arbeitsbäume des Vaults). Rückweg = Include-Zeilen entfernen (Abschnitt 3.3; Befund zur genauen Form in 8.3).
2. **Freigabe-Tor für Phase B:** der Gerätemerker `.kortex/geraete/<id>.json` je Mac **und** `kernVersion` in `brain.config.json` (Abschnitte 4.1 und 6). Ohne beides – und ohne ausdrückliche Bestätigung des Nutzers für Macs ohne Merker – kein Phase B.
3. **`.tools` kommt in Phase B ins Archiv im Support-Ordner** (`<Support>/umstellung/<Kennung>/archiv/`, nie gelöscht); nach 30 Tagen bietet Kortex an, das Archiv in den Papierkorb zu legen (Abschnitt 4.2).

---

## 0. Grundsätze (gelten für alle Schritte)

1. **Nur auf Klick.** Nichts läuft automatisch; der Assistent erkennt, schlägt vor, der Nutzer bestätigt. Am echten Vault eines Nutzers startet dieser die Schritte selbst in Kortex (kein Agent führt sie aus).
2. **Erst die Kopie, dann das Original.** Jeder Schreibschritt läuft zuerst im Probelauf (Abschnitt 2). Schlägt dort eine Prüfung fehl, wird am Original nichts angeboten außer „Befund ansehen“.
3. **Zwei Phasen.** Phase A ändert nur Dinge *außerhalb* des versionierten Vault-Inhalts (plus `.git/config`, die nicht synchronisiert wird, plus ein harmloser Gerätemerker). Phase B (Vault-Inhalt: `.tools` raus, Config bereinigen) kommt frühestens mit dem nächsten Release.
4. **Rückweg vor Schritt.** Vor jedem Schreibschritt wird gesichert, was er ändert; das Protokoll hält fest, welche Sicherung zu welchem Schritt gehört. Jeder Schritt ist idempotent und einzeln umkehrbar.
5. **Keine Werte nach außen.** Befund, Protokoll, Log und API-Antworten enthalten nur Schlüssel*namen*, Kategorien, Zählungen und Hashes – nie Werte von git-Schlüsseln, Hook-Befehlen, MCP-Argumenten oder Umgebungsvariablen (wie schon `handler.mjs` für MCP-Einträge). Sicherungskopien, die Werte enthalten können (`settings.json`, `.git/config`, globale gitconfig, plist), liegen nur im Support-Ordner mit Rechten 0600/0700.
6. **Fremdes bleibt fremd.** Alles, was nicht eindeutig von Kit/Kortex stammt, wird nur gemeldet, nicht geändert (Regel der bestehenden Installer).
7. **Eine Stelle für die Logik.** Erkennung und Schritte leben im Kern (`Ressourcen/kern/umstellung/`, testbar in `Tests/Kern`, Aufruf über den Starter `kortex umstellung …`), die Werkstatt reicht sie als Routen durch (Muster `werkstatt/verdrahtung.mjs`), Swift zeigt sie an. MCP bleibt in der Werkstatt (`verbindeClaude/Codex/Cursor`), weil dort die Umstell-Logik schon lebt.

---

## 1. Erkennung und Befundbericht

### 1.1 Neuer Befehl
`kortex umstellung befund --vault <v> [--claude-home <p>]… [--json]` (Kern: `umstellung/befund.mjs`, `umstellung/cli.mjs`), liest nur; ohne `--json` kommt der Klartext-Bericht (`umstellung/bericht.mjs`). Der Befund beschreibt auch einen Vault, den `pruefeVault` ablehnt (Fund `E8`/`E0`). Werkstatt: `GET /api/umstellung/befund` (`werkstatt/umstellung.mjs`). Ergebnis: Liste von Funden `{ id, kategorie, schwere, ort, anzahl, aktion }` mit
- `phase`: `A` (Umstellung außerhalb des Vault-Inhalts) oder `B` (späteres Aufräumen im Vault); `blockiertPhase` (nur bei `blocker`): welche Phase der Blocker sperrt; `text`: der Satz für Nicht-Techniker; `details`: nur Kategorien, Zählungen, Stellen- und Schlüsselnamen.
- `schwere`: `auto` (wird umgestellt) · `frage` (braucht Entscheidung) · `hinweis` (Kortex ändert es nicht) · `blocker` (Umstellung erst nach Behebung),
- `ort`: Art des Orts (z. B. „Claude-Profil ~/.claude“, „Versionsverlauf des Vaults“, „Hintergrunddienst“) – Profilpfade dürfen erscheinen (zeigt die App schon), Werte nie.

### 1.2 Altlasten und Prüfmethode

| # | Altlast | Prüfmethode (nur lesend) | Schwere |
|---|---|---|---|
| E1 | Kit-Ordner `.tools/` im Vault | `lstat` (Ordner oder Verweis), `VERSION` lesen, Größe | auto (Phase B) |
| E2 | `.tools` versioniert / mit ungesicherten Änderungen | `git-sicher -C v ls-files -z -- .tools` (Anzahl), `status --porcelain -- .tools` | Info / frage (Phase B archiviert alles) |
| E3 | Laufende Prozesse aus `.tools` (alter MCP-Server, Suchdienst) | `pgrep -f '<vault>/.tools/'` (nur Anzahl) | Blocker nur für Phase B |
| E4 | `brain.config.json` defekt/BOM | `configFehler`, `liesConfigRoh` | blocker |
| E5 | `backup.pfad` in der Config | `ladeConfig().backup?.pfad`, `pruefeBackupPfad`; Merker in `<Support>/backup/<Kennung>.json` schon da? | auto (übernehmen) bzw. frage (ungültig) |
| E6 | Altfelder `werkzeuge.*`, `kit`, `systemVersion`, `updateHinweis`, `vaultPath` | Schlüssel vorhanden | auto (Phase B entfernt; jetzt schon wirkungslos) |
| E7 | Ordnernamen ungültig (`ordner.*`, `wiki.ordner` ist ein Pfad statt Name) | `istOrdnerName` gegen den Rohwert; Kortex würde auf `00_inbox/09_wiki/90_archiv` ausweichen | **blocker** (sonst schreibt Kortex in einen neuen Ordner) |
| E8 | Verweise aus dem Vault hinaus (`.logs`, Inbox/Wiki/Archiv, `AGENTS.md` …) | `pruefeVault` (`zieleImVault`) | blocker |
| E9 | `core.hooksPath` | `hooks-install --stand` **plus** eigene Prüfung der relativen Kit-Form `.tools/git-hooks` (siehe 8.3, Lücke in `istKortex`) | auto (alt) · frage (fremd, z. B. husky) |
| E10 | Lokale git-Schlüssel außerhalb der Erlaubnisliste | neu: `git-sicher-pruefung.pl --alle` → alle `REFUSE`-Namen statt nur des ersten, je mit Kategorie (siehe 3.3) | frage / hinweis |
| E11 | Lokales Remote (`remote.*.url/pushurl` absoluter Pfad oder `file://`) | dieselbe Liste, Kategorie `remote-lokal` | frage |
| E12 | Verweis (Symlink) im `.git`-Ordner, `.git`-Datei mit `gitdir:` nach draußen, `objects/info/alternates` | `find .git -type l` ohne `objects/??`, `objects/pack`, `hooks`; `git-sicher status` Exit 126 | frage (Verweis auflösen) / blocker (gitdir draußen, alternates) |
| E13 | Eigene Dateien in `.git/hooks/` (keine `.sample`) | Verzeichnis lesen | hinweis (laufen im Kern ohnehin nicht) |
| E14 | Claude-Hooks in alter Form, je Profil (`profile.mjs#erkenneProfile`) | `claude-hooks --stand --claude-home <p>` (`neueForm < soll`) | auto |
| E15 | Restverweise in Claude-Einstellungen: jeder String in `settings.json` (Hooks, `statusLine`, `env`, `permissions`), der `<vault>/.tools`, `~/…/.tools`, `$HOME/…/.tools` oder `node-start.sh` nennt und *nicht* von E14 erfasst wird (z. B. eigenes Such-Skript, Tilde-Schreibweise) | Text-Suche im geparsten JSON, nur Zählung je Ereignis | hinweis (vor Phase B: frage) |
| E16 | Plugin-Marktplatz/Plugin aus dem Kit-Ordner (z. B. `brain-mods`) | `enabledPlugins`, `extraKnownMarketplaces` in `settings.json`, `<profil>/plugins/known_marketplaces.json`: Quelle `directory` unter `<vault>/.tools` | hinweis (Phase B: bricht sonst) |
| E17 | Befehle/Skills mit Kit-Pfaden | `<profil>/commands/*.md` mit Marke `<!-- brain-kit -->` (werden beim Hook-Eintrag neu erzeugt → auto); ohne Marke, aber mit `.tools`-Verweis, und `<profil>/skills/**` → hinweis | auto / hinweis |
| E18 | Globale Anweisungsdatei `<profil>/CLAUDE.md` nennt `.tools`-Skripte | Text-Suche (nur Zählung) | hinweis (Ersatztext zum Kopieren) |
| E19 | MCP-Einträge mit Server unter `<vault>/.tools` | Claude je Profil `claude mcp get brain` (`artClaude`), Codex `codex mcp get brain --json`, Cursor `~/.cursor/mcp.json`; zusätzlich *jeder* Eintrag (auch anderer Name), dessen Argumente in `<vault>/.tools` zeigen | auto (`alt` + Vault bekannt) · frage (`anders`) |
| E20 | LaunchAgent `de.brain.tageslauf` alt | `dienst status --json` (`veraltet`), plist-Text: `BRAIN_VAULT` = dieser Vault? anderer Vault? `node-start.sh`/`.tools`? `CLAUDE_CONFIG_DIR`? geladen? | auto (dieser Vault) · frage (anderer Vault) |
| E21 | Weitere Kit-LaunchAgents | `~/Library/LaunchAgents/de.brain.*.plist` außer `tageslauf` (nur Namen) | hinweis |
| E22 | Vault-eigene Agenten-Einstellungen | `<vault>/.claude/settings.json`, `<vault>/.mcp.json`, `<vault>/CLAUDE.md` mit `.tools`-Verweisen | hinweis (Phase B: Vorschlag mit Vorschau) |
| E23 | `AGENTS.md` versioniert | `ls-files --error-unmatch AGENTS.md` (Kortex rendert sie je Mac neu → Wechselspiel zwischen Macs) | frage (Phase B: aus dem Verlauf nehmen, `.gitignore`) |
| E24 | Shell-Startdateien nennen `.tools` | `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile`, `~/.config/fish/config.fish` (nur Zählung) | hinweis |
| E25 | Sicherung: Art und Ziel | `backup.art`, Art des `origin` (https/ssh/lokal/keins), Merker `remoteBestaetigt` vorhanden und gleich? | frage (bestätigen) |
| E26 | Weitere Macs | `origin` vorhanden? Gerätemerker im Vault (`.kortex/geraete/*.json`, siehe 6) und `kernVersion` in der Config von einem anderen Mac? | frage („Nutzt du diesen Vault auf weiteren Macs?“) |
| E27 | Vault-Ort | Volume (APFS? gleich wie Temp?), iCloud/CloudStorage, „dataless“-Dateien (`stat` Flag), Leerzeichen/Umlaut/`'` im Pfad, Vault über Symlink erreichbar | Info für Probelauf |
| E28 | Altlasten außerhalb ohne Handlungsbedarf | alter Support-Ordner `…/Brain` (erledigt `SupportMigration`), `~/.brain-kit` (Lese-Rückfall `kitOrte`) | Info |

### 1.3 Befundbericht (Text für Nicht-Techniker)
Kopf: „**Dein Vault stammt aus der Zeit vor Kortex.** Kortex hat nachgesehen, was noch auf die alten Werkzeuge im Vault zeigt. An deinen Notizen ändert sich nichts.“

Vier Gruppen, je Fund ein Satz:
- **Stellt Kortex für dich um** – „Claude Code ruft Kortex noch über den alten Werkzeug-Ordner auf (8 Stellen).“ · „Die Passwort-Prüfung vor dem Speichern zeigt noch auf den alten Ordner.“ · „Der Hintergrunddienst startet noch das alte Programm.“ · „Dein Sicherungsordner wird übernommen.“
- **Braucht deine Entscheidung** – „Im Versionsverlauf dieses Vaults ist eine Anmeldehilfe eingetragen (`credential.helper`). Kortex kann sie in deine persönlichen git-Einstellungen verschieben – sie gilt dann weiter nur für diesen Vault.“ · „Die Online-Sicherung geht an ein Ziel, das du noch nicht bestätigt hast.“ · „Nutzt du diesen Vault auch auf einem anderen Mac?“
- **Kann Kortex nicht ändern – nur zur Info** – „In deiner Anweisungsdatei für Claude steht noch ein Befehl aus dem alten Werkzeug-Ordner. Ersatz zum Kopieren: …“ · „Ein Zusatz-Plugin wird aus dem alten Ordner geladen und funktioniert nach dem Aufräumen nicht mehr.“
- **Muss vorher gelöst werden** – „Der Wiki-Ordner ist in den Einstellungen als Pfad angegeben. Kortex kennt nur einfache Ordnernamen und würde sonst einen neuen, leeren Wiki-Ordner anlegen.“

Fuß: „Als Nächstes probiert Kortex alles an einer Kopie deines Vaults aus. Das Original bleibt dabei unberührt.“

---

## 2. Probelauf an einer Kopie

### 2.1 Kopie
- Ort: `$TMPDIR/kortex-probelauf-<Kennung>-<zeit>/` (Ordner 0700) mit `vault/`, `support/`, `claude/<profil>/`, `gitconfig`, `qmd.sqlite`.
- Kopieren per `clonefile(2)` mit `CLONE_NOFOLLOW | CLONE_NOOWNERCOPY` auf den ganzen Ordner (Swift `KopieKlon` in BrainCore; Node-Rückfall `cp -cR`). Kostet auf APFS fast keinen Platz.
- `EXDEV`/`ENOTSUP` (anderes Volume, kein APFS): Kopie in einen Nachbarordner auf demselben Volume (`<Elternordner>/.kortex-probelauf-…`), sonst normale Kopie mit Größenanzeige und Rückfrage. Bei iCloud-Dateien „nur in der Cloud“ (dataless): Hinweis, dass die Kopie sie herunterlädt; Abbruch möglich.
- Die Kopie behält `.git` (mit `origin`), damit git-Prüfungen echt sind.

### 2.2 Abschottung (nichts verlässt die Kopie)
| Ziel | Umlenkung |
|---|---|
| Support-Ordner | `BRAIN_APP_SUPPORT=<probe>/support` mit `vaults.json` (aktiv = Kopie), ohne Merker `remoteBestaetigt` → kein Push möglich |
| Netz | zusätzlich `GIT_ALLOW_PROTOCOL=kortex-probelauf` (kein bekanntes Protokoll erlaubt; Test sichert ab, dass `git-sicher` die Variable nicht leert) |
| Globale git-Konfiguration | `GIT_CONFIG_GLOBAL=<probe>/gitconfig` = Kopie der echten globalen Datei (0600) |
| Claude-Einstellungen | **keine Kopie**: neuer Schalter `claude-hooks --vorschau --claude-home <p>` rechnet Phase A von `install.mjs` im Speicher und gibt nur `{eintraege:[{ereignis, aktion}], restVerweise:n, geaendert}` aus |
| MCP | nur `mcp get` (lesend) + Einstufung `gleich/alt/anders`; die Probe `brain_suchen` läuft mit dem neuen Server (`bin/node` + `bin/kern/mcp/brain-mcp.mjs`) gegen die Kopie |
| LaunchAgent | kein `launchctl`; `plistInhalt(...)` in `<probe>/LaunchAgents/` rendern, `plutil -lint` |
| Suche | `QMD_DB=<probe>/qmd.sqlite`, BM25-Rückfall, kein Embedding |
| Tageslauf | läuft im Probelauf nicht |

### 2.3 Schritte im Probelauf
Alle Phase-A-Schritte (Abschnitt 3) mit denselben Funktionen, nur mit den Zielen aus 2.2 („ein Code, zwei Ziele“: jede Schritt-Funktion bekommt ein `ziele`-Objekt `{ vault, support, gitGlobal, claudeHomes, launchAgents, schreibeClaude, launchctl }`). Danach zusätzlich ein **Phase-B-Probelauf**: `.tools` in der Kopie entfernen, Config bereinigen, Commit in der Kopie.

### 2.4 Prüfkriterien (alle grün, sonst kein Angebot fürs Original)
1. **Kern-Status ok:** `kortex status --vault <kopie> --json` Exit 0, `pruefeVault` ok, `configFehler` null, keine Ordner-Ausweichung (E7).
2. **Suche ok:** `kortex search "<Titel einer zufälligen Wiki-Seite>" --vault <kopie>` findet ≥ 1 Treffer, darunter die Seite; MCP-Probe `brain_suchen` über den neuen Server ebenso.
3. **git-sicher ok:** `git-sicher -C <kopie> status` Exit 0 (nicht 126) mit der umgestellten globalen Konfiguration; `log -1` ok; ein Test-Commit in der Kopie (`commit --allow-empty -m probe`) läuft durch den Pre-Commit-Hook des Kerns (`core.hooksPath` = `bin/kern/git-hooks`, Exit 0).
4. **Hooks zeigen auf den Starter:** `--vorschau` je Profil meldet 8/8 Hooks + Statuszeile in neuer Form (`… kortex' hook <name>`), `restVerweise` nur noch aus E15/E16 (gemeldete Hinweise). Ende-zu-Ende: `kortex hook brain-hint` mit einer Testfrage (stdin-JSON) gegen die Kopie → Exit 0, Ausgabe beginnt mit „Brain-Treffer“; `kortex hook session-start` → Exit 0, schreibt nur unter `<kopie>/` und `<probe>/`.
5. **MCP zeigt auf den stabilen Kern:** neuer Eintrag = `<Support>/bin/node <Support>/bin/kern/mcp/brain-mcp.mjs` (beide vorhanden, Link nicht aufgelöst); vorhandene Einträge sind `alt` oder `gleich`, `anders` steht als Frage im Befund.
6. **LaunchAgent:** gerenderte plist startet `<Support>/bin/kortex tageslauf --wenn-faellig --dienst`, ohne `BRAIN_VAULT`, `node-start.sh`, `.tools`, `/bin/sh`; `plutil -lint` ok; altes `CLAUDE_CONFIG_DIR` übernommen.
7. **Sicherung:** übernommener Ordner besteht `pruefeBackupPfad`; `origin` ist https/ssh (Kandidat für `remoteBestaetigt`) oder als Frage markiert.
8. **Phase-B-Probe:** nach Entfernen von `.tools` in der Kopie erneut 1–4 grün, `Restverweise` auf `<kopie>/.tools` = nur gemeldete Hinweise.
9. **Original unberührt:** vor/nach dem Probelauf gleich: SHA-256 von `.git/config`, `brain.config.json`, `git status --porcelain`, `HEAD`, mtime von `settings.json` je Profil, plist, globaler gitconfig.

Ergebnis: Ampel je Kriterium, Protokoll (Abschnitt 5). Die Kopie wird nach Erfolg gelöscht, nach Fehler 7 Tage behalten (Hinweis im Bericht, Knopf „Kopie jetzt löschen“).

---

## 3. Phase A (außerhalb des Vault-Inhalts, sofort umkehrbar)

Ablauf: Sperre setzen (Vault-Lock wie `brain lock`, plus `<Support>/umstellung/<Kennung>/laeuft`), Sicherung **A0**, dann A1–A8 einzeln mit Protokoll, dann Prüfung A9. Jeder Schritt: *prüfen → sichern → schreiben (atomar) → nachprüfen*; scheitert das Nachprüfen, wird nur dieser Schritt automatisch zurückgenommen und der Assistent hält an.

| Schritt | Was | Wie (vorhandener Code) | Rückweg |
|---|---|---|---|
| **A0** Sicherung | `git bundle create <Support>/umstellung/<K>/vor-kortex.bundle --all`; `.git/config` → `.git/config.vor-kortex` (+ Kopie im Support-Ordner); Kopien von `settings.json` je Profil, plist, globaler gitconfig, Ausgabe von `mcp get` je Ziel (0600, nur im Support-Ordner) | neu `umstellung/sicherung.mjs` | – (ist der Rückweg) |
| **A1** Sicherungsziel | `backup.pfad` → `<Support>/backup/<K>.json` `pfad` (**ohne** Änderung der Config und ohne Commit – `einrichten()` schreibt die Config und committet, darum neue Funktion `backup.mjs#uebernehmeOrdner`); `remoteBestaetigt` nur nach ausdrücklicher Bestätigung und nur für https/ssh (`sicherungsmerker.mjs#merkeRemoteBestaetigt`) | `backup.mjs`, `sicherungsmerker.mjs` | vorherigen Inhalt der Merker-Datei wiederherstellen (aus Protokoll: „vorher fehlte sie“ → löschen) |
| **A2** Lokale git-Schlüssel | verschiebbare Schlüssel (3.3) in eine eigene Datei je Vault und Einbindung in die globale Konfiguration; danach `git config --local --unset-all` je Schlüssel; Verweise in `.git` auflösen (Ziel-Inhalt an seine Stelle kopieren); lokales Remote nur auf Wunsch entfernen | neu `umstellung/git-umzug.mjs` | `.git/config` aus `config.vor-kortex` (wenn seit A2 unverändert, Hash-Vergleich; sonst Schlüssel einzeln zurückschreiben), Einbindung aus globaler Konfiguration entfernen (`--remove-section`), Datei je Vault löschen, aufgelöste Verweise aus Sicherung wiederherstellen |
| **A3** `core.hooksPath` | `kortex hooks-install --vault V` (alte Kit-Form gilt als eigene, absolut **und relativ** – Fix 8.3); fremder Wert nur mit „Ersetzen“ | `install-git-hooks.mjs` | alten Wert aus Protokoll/`config.vor-kortex` zurückschreiben (`git config core.hooksPath <alt>`) |
| **A4** Claude-Hooks je gewähltem Profil | `kortex claude-hooks --vault V --claude-home P` (ersetzt Alt-Formen, schreibt Commands neu, Backup `settings.json.bak-<zeit>`) | `install.mjs`, `verdrahtung.mjs` | Backup zurückkopieren, wenn `settings.json` seit A4 unverändert (Hash); sonst `--entfernen` und Hinweis „alte Einträge aus Sicherung von Hand“ |
| **A5** MCP | `/api/mcp/verbinden` für jedes Ziel mit Einstufung `alt` (Claude je Profil, Codex, Cursor); `anders` nur nach Rückfrage | `handler.mjs#verbindeClaude/Codex/Cursor` | gesicherten alten Eintrag wieder eintragen (`mcp remove` + `mcp add` mit den gesicherten Argumenten; Cursor: Sicherung von `mcp.json`) |
| **A6** Hintergrunddienst | nur wenn eine alte plist für **diesen** Vault da ist: `kortex dienst an --vault V` mit dem Profil aus der alten plist (`profilAusPlist` exportieren) | `tageslauf/dienst.mjs` | `bootout`, alte plist zurück, `bootstrap`; `dienst.json` auf vorherigen Stand |
| **A7** Commands/AGENTS | Kit-Befehle in `<profil>/commands` sind mit A4 neu gerendert; `AGENTS.md` nur neu rendern, wenn sie **nicht** versioniert ist | `skills-build.mjs` | Backup-Dateien von `platziereCommand` |
| **A8** Gerätemerker (einzige Änderung im Vault-Inhalt, harmlos für alte Kits) | `.kortex/geraete/<Geräte-ID>.json` `{ name, kortexVersion, phaseA: <datum> }` und `kernVersion` in `brain.config.json`; ein Commit nur dieser Pfade über `git-sicher` | neu `umstellung/geraete.mjs` | `git revert` dieses Commits |
| **A9** Prüfung am Original | Kriterien 2.4 Nr. 1–7 lesend am Original (`status`, `search`, `git-sicher status`, `claude-hooks --stand`, `mcp get`, `dienst status --json`) | – | bei Rot: „Rückgängig machen“ für Phase A anbieten |

### 3.1 Abschluss Phase A
Text: „Fertig. Kortex arbeitet jetzt mit deinem Vault. **Starte offene Claude-Sitzungen neu**, damit sie die neuen Einstellungen lesen. Der alte Werkzeug-Ordner bleibt vorerst liegen und wird nicht mehr benutzt – aufgeräumt wird mit einem der nächsten Kortex-Updates.“ Danach `phase: "A"` in `zustand.json`, Vault als vertraut vermerken (P5).

### 3.2 Unterbrechung
Absturz/Abbruch mitten in Phase A: beim nächsten Start liest der Assistent `zustand.json` und bietet „Weitermachen“ (Schritte sind idempotent) oder „Rückgängig machen“ (bis zum letzten erledigten Schritt) an. Die Sperre verhindert parallele Läufe (Tageslauf prüft sie ebenfalls).

### 3.3 Lokale git-Schlüssel – Einteilung
`git-sicher-pruefung.pl --alle` liefert alle verweigerten Schlüsselnamen; `git-umzug.mjs` ordnet sie ein:

| Kategorie | Beispiele | Behandlung |
|---|---|---|
| **verschiebbar** (Vorlieben/Programme des Nutzers) | `credential.*` (mehrwertig, auch leerer Reset-Wert), `core.sshCommand`, `url.*.insteadOf`, `http.*`, `core.editor/pager`, `diff.*/merge.*/filter.*` (git-lfs), `lfs.*`, `alias.*`, `gpg.*`, `user.signingkey`, unbekannte harmlose Werkzeugschlüssel (`remote.*.prune/tagopt`, `maintenance.*`, `core.untrackedcache`, `core.fsmonitor`, `gui.*`) | in Datei je Vault verschieben, Reihenfolge und Mehrfachwerte erhalten |
| **Wert ungültig** | `user.name/email` mit `&`, `;`, `\` …, Wahrheitswert `2` | verschieben (wie oben) – die Erlaubnisliste gilt nur lokal |
| **strukturell** (gehört zum Repo-Aufbau oder wirkt nur global) | `include.path`/`includeIf.*.path` (Pfade gelten relativ zur einbindenden Datei), `safe.directory`, `uploadpack.packObjectsHook`, `core.worktree`, `core.bare=true`, `extensions.partialclone`, `remote.*.promisor/partialclonefilter`, `extensions.refstorage`, `submodule.*`, alternates | nicht verschiebbar: erklären; Vault arbeitet im Kern ohne Versionsverlauf, bis er anders eingerichtet ist (Angebot: „Vault frisch aus der Sicherung klonen“ über den vorhandenen Klon-Assistenten; für `refstorage` Hinweis auf `git refs migrate`) |
| **Remote lokal** | `remote.<n>.url` = Pfad/`file://` | Angebot: Remote entfernen und stattdessen Ordner-Sicherung auf denselben Datenträger einrichten; sonst bleibt der Kern ohne git |

**Form der Verschiebung (Entscheidung 1):** nicht flach in `~/.gitconfig`, sondern in `<Support>/git/<Kennung>.gitconfig` (0600) plus in der globalen Konfiguration ein markierter Block mit **zwei** Einbindungen (siehe 8.3, Messung mit git 2.51):

```
[includeIf "gitdir:<vault>/.git"]            ; der Vault selbst
    path = <Support>/git/<Kennung>.gitconfig
[includeIf "gitdir:<vault>/.git/worktrees/"] ; verknüpfte Arbeitsbäume (Tageslauf-Kopien)
    path = <Support>/git/<Kennung>.gitconfig
```

Gründe: wirkt wie bisher **nur für diesen Vault** (ein flach verschobener `credential.helper` oder `core.sshCommand` gälte sonst für *alle* Repos des Nutzers), deckt die verknüpften Arbeitsbäume des Tageslaufs ab, steht im Scope „global“ (die Erlaubnisliste prüft nur local/worktree) und ist mit einem Handgriff umkehrbar (beide Include-Zeilen entfernen, Datei je Vault löschen). Folge: Wird der Vault verschoben, greift die Einbindung nicht mehr (sicheres Versagen: dann fehlt nur die Anmeldehilfe) – der Befund soll verwaiste Einbindungen erkennen (P7b).

---

## 4. Phase B (im Vault, frühestens ein Release später)

### 4.1 Freigabe-Tor (alles nötig)
1. Kortex-Version > Version, mit der Phase A lief (`zustand.json`), und Phase A ≥ 7 Tage alt ohne Fehler im Protokoll.
2. Alle Geräte im Gerätemerker (`.kortex/geraete/<id>.json`) haben `phaseA` und `kernVersion` in `brain.config.json` ist gesetzt (Entscheidung 2); der Nutzer bestätigt „Auf keinem anderen Mac läuft dieser Vault noch mit den alten Werkzeugen.“ (siehe 6).
3. Keine laufenden Prozesse aus `.tools` (E3) – sonst „Bitte beende offene Claude-Sitzungen.“
4. Alle Restverweise (E15–E18, E22, E24) sind behoben oder einzeln mit „Ist mir bewusst“ quittiert.
5. Frischer Phase-B-Probelauf an einer neuen Kopie grün (2.4 Nr. 8).

### 4.2 Schritte
| Schritt | Was | Rückweg |
|---|---|---|
| B0 | Sicherung: neues `vor-phase-b.bundle`, Config-Kopie | – |
| B1 | `.tools` **archivieren, nicht löschen** (Entscheidung 3): `rename` nach `<Support>/umstellung/<K>/archiv/tools-<datum>/` (gleiches Volume); sonst Kopie + Hash-Liste + Vergleich, erst dann Original entfernen. Enthält auch Unversioniertes und lokale Entwicklungsstände. | zurück verschieben, wenn `<vault>/.tools` fehlt |
| B2 | `git rm -r --cached -q -- .tools`; `.gitignore` um `.tools/` ergänzen (verhindert, dass ein altes Kit neue Dateien wieder einträgt) | per Revert (B6) |
| B3 | `brain.config.json` bereinigen (atomar, optimistisch über `liesConfigRoh().stand`): `backup.pfad` nur, wenn A1 ihn übernommen hat; `werkzeuge`, `kit`, `systemVersion`, `updateHinweis`; unbekannte Schlüssel bleiben. Vorschau als Liste „wird entfernt“. | per Revert |
| B4 (optional, nur mit Vorschau) | `AGENTS.md` aus dem Verlauf nehmen + `.gitignore`; `.tools`-Verweise in `<vault>/CLAUDE.md` durch Kortex-Befehle ersetzen (z. B. Such-Skript → `'<Support>/bin/kortex' search`) | per Revert |
| B5 | ein Commit nur dieser Pfade über `git-sicher` (`commit -- <pfade>`), Nachricht „Kortex: alten Werkzeug-Ordner entfernt“; danach Frage „Jetzt sichern?“ (normale Sicherung, nur mit Merker) | `git revert <sha>` |
| B6 | Prüfung 2.4 Nr. 1–4 am Original, Restverweis-Suche | bei Rot Rückweg B anbieten |

Nach 30 Tagen bietet Kortex an, das Archiv in den Papierkorb zu legen (nur auf Klick, Finder „Zurücklegen“ bleibt möglich).

---

## 5. Rückweg und Protokoll

### 5.1 Ablage
`<Support>/umstellung/<Kennung>/` (0700)
- `zustand.json` – Phase, erledigte Schritte, Versionen, Geräte-ID (atomar, Muster `dienst-merker.mjs`)
- `protokoll.jsonl` – je Zeile `{zeit, lauf: probe|original, schritt, ereignis: start|ok|fehler|rueckweg, sicherung: <relativer Pfad>, hashVorher, hashNachher, anzahl}`; keine Werte
- `sicherungen/<zeit>/…` – Kopien mit Werten (0600)
- `vor-kortex.bundle`, `vor-phase-b.bundle`, `archiv/`
- `bericht.txt` – lesbare Kurzfassung für den Nutzer (Knopf „Protokoll zeigen“ im Assistenten)

### 5.2 Rückweg je Schritt
Siehe Tabellen in 3 und 4. Regel für Dateien anderer Programme: Sicherung nur zurückspielen, wenn die Datei seit unserem Schreiben unverändert ist (Hash im Protokoll). Sonst nur unsere Einträge entfernen und die Sicherung als Datei nennen – nie Änderungen des Nutzers überschreiben.

### 5.3 Gesamt-Rückweg
„Umstellung rückgängig machen“ (Einstellungen → Vault): erst Rückweg B (Revert-Commit, Archiv zurück), dann A8 → A1 in umgekehrter Reihenfolge. Ergebnis: Vault und Umgebung wie vor der Umstellung; Kortex bleibt installiert, zeigt den Vault wieder als „noch nicht umgestellt“. Als letzte Rettung bleibt `vor-kortex.bundle` (Wiederherstellen in einen neuen Ordner über `brain backup wiederherstellen`).

---

## 6. Mehrere Macs mit gemischten Versionen (Risiko 4)

Ausgangslage: `.tools` ist im Kit-Vault **versioniert** und wird per git mit verteilt; ein zweiter Mac (B) führt also genau den `.tools`-Stand aus, den er zuletzt gezogen hat. `.git/config`, Claude-Einstellungen, LaunchAgent, MCP und Support-Ordner sind je Mac.

| Lage | Was passiert | Schutz |
|---|---|---|
| Mac A Phase A, Mac B altes Kit | Unkritisch: A ändert nur Lokales; B arbeitet weiter mit `.tools`. Einzige Vault-Änderung von A ist der Gerätemerker + `kernVersion` (vom alten Kit ignoriert). | A8 bewusst klein halten |
| Mac B ändert `.tools` (Kit-Update, Entwicklung) und schiebt | A zieht neue `.tools`-Stände; Kortex führt sie nie aus. Vor Phase B: Bearbeiten/Löschen-Konflikt möglich. | Phase-B-Tor 2; Konfliktlösung im Studio |
| Mac A Phase B, Mac B zieht | git löscht `.tools` auf B. Folgen auf B: jeder Claude-Hook scheitert sichtbar bei jeder Eingabe, MCP-Server weg, LaunchAgent scheitert stündlich still, **und `core.hooksPath` zeigt ins Leere → git committet auf B ohne Passwort-Prüfung**. | Tor 2 (alle Geräte umgestellt + Bestätigung). Rückweg: Revert-Commit bringt `.tools` auf B zurück. |
| Kortex auf Mac B neu installiert | Kortex sieht `kernVersion`/Gerätemerker eines anderen Macs → Befund „Dieser Vault wurde auf einem anderen Mac schon umgestellt“ → nur Phase A für diesen Mac (Probelauf bleibt Pflicht), keine Phase B. | `kernVersion` lesen |
| Kortex auf B älter als `kernVersion` | Hinweis „Kortex auf diesem Mac ist älter als dein Vault erwartet – bitte aktualisieren.“ Kein Schreibschritt der Umstellung. | Versionsvergleich |
| Beide Macs mit Hintergrunddienst | Tageslauf läuft doppelt (wie schon zu Kit-Zeiten) → Merge-Konflikte in Pflege-Commits möglich. | Hinweis im Befund: Dienst auf einem Mac einschalten genügt |
| `AGENTS.md` versioniert | Jeder Mac rendert seine Pfade → ständige Änderung. | B4 nimmt sie aus dem Verlauf |
| Sicherungs-Merker | `remoteBestaetigt`/`pfad` liegen je Mac im Support-Ordner (Kennung = Hash des Pfads) → jeder Mac bestätigt selbst. | A1 auf jedem Mac |

Gerätemerker: `.kortex/geraete/<zufällige Geräte-ID>.json` (eine Datei je Mac → keine Merge-Konflikte), Inhalt: frei wählbarer Name (Vorgabe Rechnername), Kortex-Version, Datum Phase A/B. Für Kit-Macs gibt es keinen Merker; darum bleibt die ausdrückliche Bestätigung des Nutzers Pflicht. Der Kern muss `.kortex/` in Pflege-Sperren aufnehmen (`pflege-sperre.mjs`, `pflege-ki.mjs#KOPIE_GESPERRT`, `inbox-schritt.mjs`), damit Pflege/KI ihn nicht anfasst.

Bewusst **nicht** gemacht: eine „Brückenfassung“ von `.tools` (Kortex schreibt Weiterleitungs-Code in den Vault, damit alte Macs sanft scheitern). Das widerspräche „ein Vault liefert nur Daten“ und dem Vertrauensmodell.

---

## 7. Oberfläche

**Ort:** eigenes Fenster/Blatt „Vault umstellen“ in der Swift-App (`UmstellungsAssistent`), Muster `EinrichtungsAssistent`. Einstieg: Menüleiste und Studio-Banner zeigen „Dein Vault kann auf Kortex umgestellt werden“, sobald der Befund `E1` meldet; nie automatischer Start. Das Studio zeigt nur Banner und Protokoll, die Schritte laufen im Assistenten.

**Schritte (Phase A):**
1. **Willkommen** – „Dieser Vault stammt aus der Zeit vor Kortex. In wenigen Minuten stellt Kortex ihn um. Deine Notizen bleiben, wie sie sind, und alles lässt sich rückgängig machen.“ [Weiter] [Später]
2. **Befund** – vier Gruppen (1.3), aufklappbar „Was heißt das?“. Blocker sperren „Weiter“ mit Anleitung.
3. **Entscheidungen** – je Frage ein Schalter mit Empfehlung und Satz zum Rückweg, z. B.
   - „Anmeldehilfe für diesen Vault in deine persönlichen git-Einstellungen verschieben (empfohlen). Sie gilt weiter nur für diesen Vault.“
   - „Online-Sicherung an ‹Adresse› bestätigen.“ (die Adresse zeigt die App dem Nutzer, sie landet nicht im Protokoll)
   - „Claude-Profile umstellen: ☑ Standard ☑ weiteres Profil“
   - „Nutzt du diesen Vault auf weiteren Macs? ○ Nein ○ Ja“ (Ja → Hinweis zu 6)
4. **Probelauf** – Fortschritt „Kortex probiert alles an einer Kopie aus …“, danach Ampel je Kriterium in Klartext („Suche findet deine Notizen ✓“, „Claude Code ruft Kortex auf ✓“, „Passwort-Prüfung vor dem Speichern ✓“, „Sicherung ✓“). Rot: „Hier hat etwas nicht geklappt. Am Original wurde nichts geändert.“ [Protokoll zeigen] [Abbrechen]
5. **Umstellen** – „Jetzt am Original umstellen“ (eigener Klick), Häkchenliste A0–A9 in Alltagssprache („Sicherung angelegt“, „Claude Code eingeklinkt“, „Hintergrunddienst umgestellt“ …).
6. **Fertig** – Text 3.1, Knöpfe [Protokoll zeigen] [Rückgängig machen].

**Phase B (späteres Update):** Hinweis in der Menüleiste „Aufräumen möglich: der alte Werkzeug-Ordner wird nicht mehr gebraucht“ → Tor-Prüfung als Liste (offene Punkte mit Erklärung) → Probelauf → „Aufräumen“ → Fertig („Der Ordner liegt 30 Tage im Archiv.“).

**Rückweg-Ansicht:** Einstellungen → Vault → „Umstellung“: Stand je Schritt, einzeln oder gesamt rückgängig.

Sprache: „Vault“, „Kortex“, „Versionsverlauf“ (statt git), „Passwort-Prüfung vor dem Speichern“ (pre-commit), „Hintergrunddienst“, „Online-Sicherung“, „Claude Code einklinken“ (Hooks). Fachbegriffe nur in „Details“.

---

## 8. Teilpakete

### P7a – Erkennung und Befund (nur lesend) – **umgesetzt**
Abweichungen vom ursprünglichen Entwurf: (1) MCP-Einträge liest der Befund **aus den Konfigurationsdateien** (`~/.claude.json` bzw. `<Profil>/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`) statt per `claude mcp get`/`codex mcp get` – so startet der Befund kein fremdes Programm, und die Einstufung `gleich/alt/anders` ist dieselbe wie in `werkstatt/handler.mjs#befehlsArt`. (2) Der Hintergrunddienst wird aus der plist gelesen (kein `launchctl`; „geladen?“ ist nicht Teil des Befunds). (3) Der Befund liest Git mit dem echten git von festen Orten (nicht über `git-sicher`, das die zu beschreibenden Vaults sperrt), ohne Hooks/fsmonitor/Index-Schreiben; `status` läuft erst, wenn die Prüfung der Erlaubnisliste nichts beanstandet hat. (4) Schlüsselnamen erscheinen nur in der Form `abschnitt.*.variable` (der Unterabschnitt kann Adressen mit Zugangsdaten enthalten). (5) Swift (`BrainCore/Umstellung.swift`) kommt mit der Oberfläche (P7c), weil es dort erst gebraucht wird.
- Dateien (neu, `Ressourcen/kern/umstellung/`): `befund.mjs` (Erkennung E0–E28 mit Stufe), `git-lage.mjs` (Versionsverlauf lesen, Einteilung der Schlüssel), `restverweise.mjs` (Claude-Einstellungen, Befehle/Skills, Shell-Dateien), `mcp-lage.mjs`, `profile.mjs`, `bericht.mjs` (Klartext), `cli.mjs`; geändert: `git-sicher-pruefung.pl` (Modus `--alle`: alle `REFUSE`-Namen, jeder einmal; Normalmodus unverändert), `brain.mjs` (Befehl `umstellung`), `pfade.mjs` (`angegebenerVaultPfad`); `werkstatt/umstellung.mjs` + Route `GET /api/umstellung/befund` in `handler.mjs`. Swift (`BrainCore/Umstellung.swift`, `WerkstattDienste`-Aufruf) folgt mit P7c.
- **Fixture-Bauer** `Tests/Kern/fixture-altvault.mjs` (wie `fixture-garten.mjs`, aber baut in Temp einen Kit-Vault mit `.git`): `altvault({ faelle: [...] })` setzt je Fall genau eine Altlast; dazu Wegwerf-`home` mit Profilen, plist, Shell-Dateien.
- Tests: `Tests/Kern/test-umstellung-befund.mjs` (ein Test je Fall in 8.5, plus „sauberer Kortex-Vault = leerer Befund“), `Tests/Kern/test-git-sicher-liste.mjs` (`--alle` liefert dieselben Namen wie wiederholte Einzelläufe; Werte erscheinen nie), `Tests/Node/umstellung-befund.test.mjs` (Route, gleiche Profilerkennung in Kern und Werkstatt); Swift `UmstellungTests` mit P7c.
- Lint: Befund-Ausgabe enthält nie Werte (Test mit Marker-Werten wie `GEHEIM-xyz` in jedem Fall).
- Risiko: niedrig. Selbstprüfung + CI.

### P7b – Probelauf, Phase A, Rückweg, Protokoll
- Dateien: neu `umstellung/{probelauf,phase-a,rueckweg,protokoll,sicherung,git-umzug,geraete,ziele}.mjs`; Änderungen: `install.mjs` (`--vorschau`; Alt-Muster um `~/`-Schreibweise und realpath-Form ergänzen), `install-git-hooks.mjs#istKortex` (relative Form `.tools/git-hooks` als eigene erkennen – heute Exit 4 „fremd“, obwohl `doctor.mjs` genau diese Form als Kit-Stand meldet), `backup.mjs#uebernehmeOrdner` (ohne Config/Commit), `dienst.mjs` (`profilAusPlist` exportieren, Option „nur rendern“), Pflege-Sperren für `.kortex/`; Werkstatt-Routen `POST /api/umstellung/probelauf|phase-a|rueckweg`, `GET /api/umstellung/stand`; Swift `KopieKlon` (clonefile).
- Tests: je Schritt A0–A9 „wirkt / idempotent / Rückweg stellt Hash-gleich her / Rückweg bei inzwischen geänderter Datei überschreibt nichts“; Probelauf-Test „Original unverändert“ (Kriterium 9) über alle Fälle; Abbruch nach jedem Schritt + Wiederaufnahme; `git-umzug`: Mehrfachwerte, leerer Reset-Wert bei `credential.helper`, Reihenfolge, Einbindung wirkt im Vault und in einem verknüpften Arbeitsbaum und **nicht** in einem anderen Repo; `GIT_ALLOW_PROTOCOL` übersteht `git-sicher`; `clonefile`-Rückfall bei `EXDEV` (einspritzbarer Kopierer); Pfade mit Leerzeichen/`'`/Umlaut; `launchctl` nur als Attrappe (`BRAIN_LAUNCHCTL`).
- Risiko: hoch (schreibt in `~/.gitconfig`, Claude-Einstellungen, LaunchAgents). → Umsetzer sonnet → Tests → **ein Opus-Review** über den ganzen Diff (Sicherheit, Rückweg, Datenschutz).

**P7b umgesetzt (30.10.2026, Branch `feat/umstellung-phase-a`).** Stand und Abweichungen vom Entwurf:
- CLI: `kortex umstellung stand|probelauf|phase-a|zurueck [--ja] [--schritt A1,A4|--alles] [--entscheide gitSchluessel=nein,…] [--claude-home …] [--json]`. **Ohne `--ja` (Body `bestaetigt: true`) schreibt nichts**: Plan statt Ausführung. Phase A verlangt einen grünen Probelauf für denselben Stand (Merker `<Support>/umstellung/<Kennung>/probelauf.json`: Fingerabdruck von Vault-Konfiguration, `.git/config`, `settings.json` je Profil, plist, globaler git-Konfiguration, MCP-Einträgen, `dienst.json` + Hash der Entscheidungen; Notizen ändern ihn nicht).
- Werkstatt: `GET /api/umstellung/stand`, `POST /api/umstellung/probelauf|phase-a|rueckweg` (`werkstatt/umstellung.mjs`, Kern über den Starter); Eingaben streng geprüft (Schritte `A0–A9`, Entscheidungen nur bekannte Schlüssel, Profile nur aus der erkannten Liste). Swift `KopieKlon` entfällt: der Kern klont per `cp -c` (Rückfall Nachbarordner → volle Kopie), Swift/UI folgt mit P7c.
- **A5 (MCP) läuft im Kern**, nicht über die Werkstatt-Route `/api/mcp/verbinden`: eine Stelle für Ablauf, Abbruch und Rückweg. Einstufung identisch (`mcp-lage.mjs`), Einträge setzt wie dort das Programm selbst (`claude mcp remove/add -s user`, `codex mcp …`); Cursor per Datei mit Sicherung. Rückweg nur, wenn der Eintrag noch unser ist.
- Entscheidungen (alle `false`, nur `gitSchluessel` ist vorbelegt `true`): `gitSchluessel`, `verweiseAufloesen`, `remoteEntfernen`, `remoteBestaetigen` (nur https/ssh, nie lokal), `hooksErsetzen`, `mcpAnders`, `dienstAnderer`, `profile`, `weitereMacs`.
- Rückweg-Angaben stehen **vor** dem ersten Schreiben jedes Schritts (`sicherungen/<Lauf>/<Schritt>.undo.json`, 0600; nur dort Werte). Dateien anderer Programme werden nur zurückgespielt, wenn sie seit unserem Schreiben unverändert sind (Hash), sonst gehen nur unsere Einträge. Ein Fehler nimmt nur den betroffenen Schritt zurück; ein Absturz ist mit „Weitermachen“ (erneut starten) oder `zurueck --alles` zu beenden. Läuft ein Schritt später erneut und tut wieder etwas, bleiben die früheren Rückweg-Angaben erhalten (`fruehere`).
- Sperren: `<Ablage>/laeuft` (PID; toter Prozess = „unterbrochen“) und `.logs/ingest.lock` im Vault (wie `brain lock`; ein frischer fremder Lock verhindert den Lauf).
- Probelauf-Kriterien 1–9 wie Abschnitt 2.4; Kriterium 4 prüft den Hook-Weg über `kern/brain.mjs version` und `regeln-lesen.mjs` (kein Dauerläufer wie `brain-hint`/`session-start`, die Hintergrundprozesse starten); Kriterium 8 entfernt den alten Werkzeug-Ordner in der Kopie und prüft 1–4 erneut (Config-Bereinigung und Commit in der Kopie gehören zu P7d). Die Kopie wird nach grünem Lauf gelöscht, nach rotem behalten (`kopieBehalten`).
- Der Probelauf rührt am Original nichts an (Momentaufnahme vorher/nachher als Test über alle Kernfälle) und bestätigt nie ein Online-Ziel (`remoteBestaetigen` im Probelauf immer aus).
- Fixes 8.3 Nr. 1, 2, 4 erledigt (`istKortex` kennt `<Kit-Ordner>/git-hooks` und `./<Kit-Ordner>/git-hooks`; `install.mjs` erkennt `~/…`, `$HOME/…`, `${HOME}/…` und den aufgelösten Pfad; `dienstStatus`/`dienst status --nur-lesen` ohne `launchctl print`; `bauePlist` zum reinen Rendern). Nr. 3 (zwei `includeIf`, Maskierung, `gitdir/i`) in `git-umzug.mjs`; der Block steht zwischen Marken (`# >>> Kortex-Umstellung <Kennung> … <<<`) und wird als Ganzes entfernt.
- **P5-Anschluss** (`umstellung/vertrauen-merker.mjs`, `werkstatt/umstellung.mjs#vermerkeVertrauen`): Phase A setzt `zustand.vertrauen = "vermerken"`; die Werkstatt ruft nach Erfolg `erlaube(vault, { support, quelle: "bestaetigt" })` aus `gemeinsam/vertrauen.mjs`, sobald es das Modul gibt (sonst Leerlauf). Die Probekopie bekommt einen Merker im Format von P5 im EIGENEN Probe-Support. Beim Merge von P5 nichts weiter nötig, außer optional eine Quelle `umgestellt` in `QUELLEN` (beide `vertrauen.mjs`) und `VERTRAUEN_QUELLE` zu ändern. Unter P5 enden `claude-hooks`/`hooks-install`/`dienst an`/`skills-build` an einem nicht vertrauten Vault mit Exit 5: die Schritte melden `vault-nicht-vertraut`.
- **Nachbesserung nach dem Opus-Review (30.10.2026):** (1) A6: erwartete plist vorab gerendert (`hashErwartet`), im Fehlerfall immer aus der Sicherung herstellen, `dienst.json` zurück, vorher geladenen Dienst neu laden; (2) A5 Claude: Rückweg mit `claude mcp add-json` (verlustfrei, Exit-Codes geprüft), nie `add -e …`; (3) A5 Codex: Text der Abschnitte `[mcp_servers.brain*]` gesichert und wiederhergestellt, Fehlerpfad aus der Byte-Sicherung; (4) A2 verschiebt `include.path`, `includeIf.*.path`, `safe.*`, `uploadpack.packObjectsHook` nicht (strukturell) und lehnt relative Pfade und Werte, die in den Vault zeigen, ab; (5) Probekopie: `.git` muss im Vault liegen, Verweise darin werden durch echte Kopien ersetzt, Blocker des Befunds stoppen vor der Kopie; (6) A4-Rückweg kehrt bei geänderter `settings.json` gezielt um (`hakenDiff`/`hakenZurueck`); (7) `remoteBestaetigen` wird im Probelauf-Merker mit der echten Wahl gehasht; (8) `zurueckgenommen` nur bei sauberem Rückweg, sonst `rueckwegHinweise`; (9) alte Probekopien (> 7 Tage) werden aufgeräumt, Nachbarkopie nur mit Entscheidung `nachbarkopie`, Platzprüfung (statfs, ×1,2 + Puffer) vor Kopie und Bundle, Werkstatt-Frist 45 min > Kopierfrist 30 min; (10) Kennung = Hash des kanonischen Pfads (`realpath.native`) mit Übergang für Merker unter der früheren Kennung (`merkerDateiFuer`); (11) Verweise auf `.git/config`, `brain.config.json`, globale Konfiguration bleiben erhalten, Rückweg-Angaben des Blocks stehen vor dem Schreiben; (12) `~/.gitconfig` wird wie von git mit `.lock` exklusiv geschrieben; (13) Vertrauen wird vor A0 geprüft (Exit 6, Code `nicht-vertraut`, getrennt von „läuft schon“ = Exit 5); (14) bei rotem A9 ist Phase A **nicht** abgeschlossen, kein Vertrauensvermerk, Ergebnis `mitWarnungen`. Die Attrappen für claude/codex/launchctl bilden Argument-Parsing und Exit-Codes nach und arbeiten nur im Temp-Ordner.
- Offen für P7c/P7d: UI (Banner, Assistent, Ampel, Protokoll zeigen, „Kopie jetzt löschen“, Rückweg-Ansicht), Swift-Modell des JSON-Vertrags, Verwaiste-Einbindung im Befund (Vault verschoben → includeIf greift nicht mehr), Aufräumen von `.bak-*`-Dateien nach 30 Tagen, Phase B inklusive Tor, Archiv und Zwei-Mac-Test, Bereinigung der Kopie in Kriterium 8.

### P7c – Oberfläche
- Dateien: `Sources/BrainApp/UmstellungsAssistent.swift`, `Sources/BrainCore/UmstellungsAblauf.swift` (Zustandsmaschine wie `EinrichtungsAblauf`), Menüleisten-Hinweis (`MenueInhalt.swift`), Studio-Banner (`Ressourcen/studio/app.js`, Texte in `texte.js`).
- Tests: `Tests/BrainCoreTests/UmstellungsAblaufTests.swift` (Schritte, Blocker sperren, Wiederaufnahme), Oberflächen-Spec `Tests/Oberflaeche/umstellung.spec.mjs` (Banner, Protokoll), Durchlauf mit `scripts/vorschau.sh` und einem Fixture-Altvault.
- Kann nach dem JSON-Vertrag von P7a parallel zu P7b beginnen.

### P7d – Phase B (eigenes Release nach P7a–c)
- Dateien: `umstellung/phase-b.mjs`, Tor-Prüfung, Archiv, Revert-Rückweg; Werkstatt-Route `POST /api/umstellung/phase-b`; UI-Teil aus 7.
- Tests: Tor (jede Bedingung einzeln rot), Archiv vollständig (Hash-Liste, inkl. Unversioniertem), Commit nur der genannten Pfade, Revert stellt `.tools` her; **Zwei-Mac-Simulation**: zwei Kopien + gemeinsames nacktes Repo (lokale Remotes nur in der Testumgebung erlaubt), Mac B mit Kit-Stummel-Hooks – Phase B auf A wird ohne Bestätigung verweigert, mit Bestätigung durchgeführt; nach Pull auf B fehlen `.tools` und der Befund auf B meldet „auf anderem Mac umgestellt“; Revert repariert B.
- Risiko: hoch (Daten im Vault, wirkt auf andere Macs) → ein Opus-Review.

### 8.3 Bekannte Lücken im Bestand (in P7a dokumentiert, Behebung in P7b)

1. **`install-git-hooks.mjs#istKortex` kennt die relative Kit-Form nicht.** Das Kit trug `core.hooksPath = <Kit-Ordner>/git-hooks` **relativ** ein; `istKortex` erkennt nur den absoluten Pfad im Vault (`${V}/<Kit-Ordner>/git-hooks`) und den Kortex-Pfad. Der relative Wert gilt dort als „fremd“: `hooks-install` endet mit Exit 4, `--stand` meldet `fremder: true`, `--aus` lässt ihn stehen – obwohl `doctor.mjs` genau diese Form als Kit-Stand kennt. Der Befund (`E9`) erkennt beide Formen als alten Kit-Eintrag (`details.form: relativ|absolut`). P7b: `istKortex` um die relative Form erweitern (Test: relativer Wert wird ohne `--ersetzen` umgestellt und mit `--aus` entfernt).
2. **`adapters/claude-code/install.mjs` erkennt alte Hook-Befehle nur in zwei Schreibweisen des Vaults** (absoluter Pfad und die Form für genau den Ordner `$HOME/<Standardname>`). Hooks mit `~/…`, `$HOME/<anderer Ordner>` oder dem aufgelösten Pfad (realpath) des Vaults bleiben stehen; der Befund (`E14`) zählt sie als „alte Form“ (auto). P7b: das Alt-Muster auf diese Schreibweisen erweitern, sonst bleiben sie als Doppel neben dem neuen Eintrag.
3. **`includeIf "gitdir:<vault>/.git/"` (mit Schrägstrich am Ende) trifft den Vault selbst NICHT**, nur die verknüpften Arbeitsbäume darunter (`.git/worktrees/*`): git ergänzt `**` und vergleicht mit `…/.git` ohne Schrägstrich. Gemessen mit git 2.51 an Wegwerf-Repos: `gitdir:<v>/.git` trifft den Vault, `gitdir:<v>/.git/` nur Arbeitsbäume. Darum zwei Einbindungen (Abschnitt 3.3). Außerdem muss der **aufgelöste** Pfad (realpath, z. B. `/private/var/…` statt `/var/…`) eingetragen werden, Sonderzeichen des Musters (`*?[\`) im Vault-Pfad müssen maskiert werden, und auf Volumes ohne Groß/klein-Unterscheidung ist `gitdir/i:` nötig. Die Einbindung steht im Scope „global“ und wird von der Erlaubnisliste von `git-sicher-pruefung.pl` nicht geprüft (gemessen: auch für Arbeitsbäume).
4. **`dienstStatus` (tageslauf/dienst.mjs) ruft immer `launchctl print`**, auch für `--json`; der Befund umgeht es durch Lesen der plist. P7b: für Probelauf/Vorschau eine Option „nur lesen“ anbieten.

### 8.4 Reihenfolge
P5 fertig → **P7a** → (**P7b** ‖ **P7c**) → Release N → Befund + Probelauf + Phase A am echten Vault (Freigaben 8.6) → Beobachtung ≥ 7 Tage → **P7d** → Release N+1 → Phase B am echten Vault (Freigabe) → P9 (Kit archivieren).

### 8.5 Fixture-Fälle (je Fall ein Test)
Kit-Ordner: versioniert · unversioniert · mit ungesicherten Änderungen · als Verweis.
Config: `backup.pfad` gültig · relativ · Verweis · fehlt; `werkzeuge.git`; `kit`/`systemVersion`/`updateHinweis`/`vaultPath`; `wiki.ordner` als Pfad (Blocker); defektes JSON; BOM.
git: `core.hooksPath` = `.tools/git-hooks` relativ · absolut · Kortex · fremd (husky); `credential.helper` (mehrere Werte, leerer Reset); `credential.<url>.helper`; `core.sshCommand`; `url.*.insteadOf`; `http.<url>.extraheader` mit Token-Attrappe (darf nirgends erscheinen); `filter.lfs.*` + `lfs.repositoryformatversion`; `include.path`; `user.name` mit `&`; `remote.origin.prune`; `maintenance.*`; `core.fsmonitor`; `core.worktree`; `extensions.partialclone` + `remote.origin.promisor`; `extensions.refstorage`; lokales Remote (Pfad, `file://`); Verweis `.git/info/exclude` nach draußen; `.git`-Datei mit `gitdir:` nach draußen; `objects/info/alternates`; eigene `.git/hooks/pre-commit`.
Claude: Hooks in Alt-Formen (`.sh`/`.mjs`, `$HOME/<vault>`, `~/<vault>`, `node-start.sh`, `<vault>/.tools/adapters/claude-code/`), fremde Hooks daneben, alte Statuszeile, eigenes Skript aus `.tools` (Restverweis), `settings.json` als Verweis, kaputtes `settings.json`, zwei Profile, Plugin-Marktplatz im Kit-Ordner, Commands mit/ohne Marke, Profil-`CLAUDE.md` mit Verweis.
MCP: Claude alt (bekannter Vault) · alt (unbekannter Vault → Frage) · fremd · gleich; Codex alt; Cursor alt; anderer Server-Name mit `.tools`-Argument.
LaunchAgent: alt für diesen Vault (mit/ohne `CLAUDE_CONFIG_DIR`) · alt für anderen Vault · neu · keiner · weitere `de.brain.*`.
Vault/Ort: `.claude/settings.json` und `.mcp.json` im Vault; `CLAUDE.md` mit Verweis; `AGENTS.md` versioniert; Shell-Datei mit Verweis; Pfad mit Leerzeichen/`'`/Umlaut; Vault über Verweis erreichbar; anderes Volume (Kopier-Rückfall); laufender Prozess aus `.tools` (Attrappe).
Mehrere Macs: Gerätemerker eines anderen Macs; `kernVersion` neuer als Kortex.

### 8.6 Was erst nach Freigabe des Nutzers am echten Vault passiert
1. **Befund am echten Vault** (liest `~/.claude*`, LaunchAgents, Shell-Dateien) – Freigabe „Befund ausführen“; Ergebnis nur als Kategorien.
2. **Probelauf an einer Kopie des Vaults** – Freigabe, weil eine vollständige Kopie privater Inhalte in Temp entsteht (wird danach gelöscht).
3. **Phase A am Original** – nur nach grünem Probelauf, ausdrücklicher Freigabe und vorhandenem `vor-kortex.bundle`; der Nutzer klickt selbst in Kortex.
4. **Phase B** – frühestens Release N+1, nach ≥ 7 Tagen ohne Fehler, Bestätigung „keine anderen Macs mit altem Kit“, eigener Freigabe.
Kein Agent ändert dabei selbst `~/.claude*/settings.json`, LaunchAgents oder die globale gitconfig (globale Regel); er bereitet höchstens Befehle vor.

---

## Risiken (P7-spezifisch)
1. **Breiter Schaden durch flache Verschiebung** git-Einstellungen in `~/.gitconfig` → Einbindung je Vault (3.3).
2. **Stille Lücke auf Mac B nach Phase B** (Passwort-Prüfung fehlt) → Tor + Gerätemerker + Bestätigung (6).
3. **Datenschutz der Sicherungen** (Kopien von `settings.json`/gitconfig können Zugangsdaten enthalten) → nur Support-Ordner, 0600, nach Phase B + 30 Tage löschen, nie im Protokoll.
4. **Probelauf, der doch nach außen wirkt** (Push, qmd-Index, LaunchAgent) → Abschottung 2.2 + Kriterium 9 als Test über alle Fixtures.
5. **Offene Claude-Sitzungen** behalten alte Hooks/MCP bis zum Neustart → Hinweis nach Phase A, Prozessprüfung vor Phase B.
