# Plan: Kern-Umzug („ein Repo, eine App“)

Stand 28.10.2026. Entscheidung Fabio: Man installiert Kortex, und alles funktioniert über die App. Die Logik des bisherigen Kits (`<vault>/.tools`) lebt künftig im brain-app-Repo und wird im signierten App-Bundle ausgeliefert. Der Vault enthält nur Daten.

## Entscheidungen (Fabio, 28.10.2026)
- Kern bleibt plattformneutral (win32-Zweige bleiben); eigene Installer für Windows/Linux entfallen. Eine CLI aus diesem Repo ist später möglich.
- `second-brain-kit` wird nach der Umstellung archiviert (Schluss-Tag, README-Hinweis, nur lesbar).
- Support-Ordner: `~/Library/Application Support/Kortex` (Umzug aus `Brain`).
- Das echte `~/brain` wird erst nach erfolgreichem Test an einem Klon und nur mit ausdrücklicher Freigabe umgestellt.
- Import als Kopie ohne Historie (die Historie in `~/brain` ist mit privaten Commits durchsetzt); publish-check ist Pflicht.

## Ausgangslage
- Eigentliche Quelle: `~/brain/.tools` (Quell-Vault). `second-brain-kit` ist ein Export daraus; beide Stände sind auseinandergelaufen.
- Die App ruft heute `brain.mjs status|rueckfragen`, `ansicht/bruecke.mjs` und `gesundheit` aus `<vault>/.tools` auf, nach einer Vertrauensprüfung (KitVertrauen/KitStand, vertrauen.mjs).
- Außerhalb des Vaults zeigen Claude-Code-Hooks (`~/.claude/settings.json`), der LaunchAgent `de.brain.tageslauf` und `core.hooksPath` auf `<vault>/.tools`.

## Zielbild
- `Ressourcen/kern/` (Logik) und `Tests/Kern/` (Tests, nicht im Bundle), `HERKUNFT.md` mit Quell-SHAs.
- Fester Pfad: `Support/Kortex/kern/<appVersion>/` (Kopie mit Manifest-Prüfung), `Support/Kortex/bin/kern` (Symlink), Starter `Support/Kortex/bin/kortex`.
- Hooks, MCP, git-Hooks und LaunchAgent zeigen auf den Starter bzw. `bin/kern`.
- `kern/pfade.mjs`: `KERN` = eigener Ordner; Vault aus `--vault`, `BRAIN_VAULT` oder aktivem Vault in `vaults.json`, nie Rückfall auf `~/brain`. Keine `.tools`-Literale (Lint-Test).
- Vertrauen: KitVertrauen/KitStand entfallen; ein schmales VaultVertrauen bleibt für `.git/hooks`, `core.hooksPath` und programmstartende git-Einstellungen.

## Pakete
| Paket | Inhalt | hängt ab von |
|---|---|---|
| P0 | Bestandsabgleich A/B/C, Positiv-/Negativliste, Privatheitsprüfung | – |
| P1 | Import nach `Ressourcen/kern/` + `Tests/Kern/`, HERKUNFT.md, CI-Job `kern-test`, keine Verhaltensänderung | P0 |
| P2 | `pfade.mjs` (KERN/VAULT), `.tools`-Literale und Schreibziele umstellen, Lint-Test | P1 |
| P3 | Swift: Laufzeit (node + kern), Starter `bin/kortex`, Support-Ordner Kortex | – |
| P4 | App nutzt den gebündelten Kern (BrainBefehl, Rueckfragen, Brücke, vault.mjs, VaultAuswahl, mcpArgs) | P2, P3 |
| P5 | Vertrauen verkleinern (VaultVertrauen), danach Sicherheits-Review | P4 |
| P6 | Einrichtung verdrahten: Hooks, `core.hooksPath`, LaunchAgent auf den Starter | P2, P3 |
| P7 | Umstellungs-Assistent für bestehende Vaults: Probelauf, Phase A (außerhalb Vault), Phase B (`.tools` entfernen, ein Release später), Rückweg | P6 |
| P8 | Aufräumen: Installer/Export raus, Übersicht ins Studio, Vorlage und Suche zusammenführen | P2 |
| P9 | `second-brain-kit` archivieren | P7 released |

## Risiken
1. Zwei auseinandergelaufene Quellen → ohne P0 gehen Funktionen verloren.
2. Private Inhalte im künftig öffentlichen Repo → Kopie statt Historie, publish-check.
3. Hooks laufen bei jedem Prompt → atomares Umschalten, fehlender Starter beendet still mit Exit 0.
4. Mehrere Macs mit gemischten Versionen → zwei Phasen, `kernVersion` in `brain.config.json`.
5. Fest eingebrannte Pfade → Ordnername Kortex vor P3 entschieden.
6. Vertrauensmodell ändert sich → Sicherheits-Review nach P5.

## P4 umgesetzt: die App nutzt den gebündelten Kern
- Alle Kern-Aufrufe laufen über `Support/Kortex/bin/kern` (`AppPfade.kern`) mit `bin/node` und ausdrücklichem `--vault <vault>` (zusätzlich `BRAIN_VAULT`):
  `BrainBefehl` (status, rueckfragen), `BrueckenVerbindung` (Ansicht-Brücke `ansicht/bruecke.mjs --vault`), Werkstatt (`gesundheit`, Rückfragen-Zahl über `KORTEX_KERN_PFAD`, das die App setzt).
  Ist der Kern nicht bereit (`KernBereitschaft`: fehlt im Paket, Prüfung gescheitert, Link kaputt), zeigt die App eine Meldung (Menüleiste, Menü, Aktion `ansicht` → Grund `kern-nicht-bereit`); nie ein Ausweichen auf `<vault>/.tools`.
- Ein Vault ist ein Ordner mit `brain.config.json` (`VaultAuswahl`, wie `pruefeVault`). Ein altes `.tools/` bleibt liegen und wird nicht ausgeführt. Neue Vaults aus der Vorlage (`vorlage.mjs`) enthalten `brain.config.json` und kein `.tools`; „leerer Vault“ bleibt ein reiner Studio-Ordner.
- MCP-Server: liegt im Quellbaum in `Ressourcen/mcp` (braucht `Ressourcen/gemeinsam`). `scripts/baue-app.sh` legt beides zusätzlich in den Kern (`kern/mcp`, `kern/gemeinsam`, vom Manifest erfasst). Neue MCP-Einträge: `<bin/node> <bin/kern>/mcp/brain-mcp.mjs` (Link nicht aufgelöst). Frühere Formen (Server im App-Paket, früherer Kern-Ordner, Server unter `<vault>/.tools`, alter App-Node) werden ohne Rückfrage umgestellt.
- KitVertrauen/KitStand/`UebersichtRegel` bleiben als Code, die App ruft sie nicht mehr auf. Das Vertrauen der Werkstatt (`vertrauen.mjs`, Git-Hooks, Git-Einstellungen) ist unverändert.

### Für P5 (entfernen oder verkleinern)
- Swift: `KitVertrauen`, `KitErlaubnis`, `KitStand`, `UebersichtRegel`, `StatusAnzeige.kitNichtErlaubt/.kitPruefungFehlgeschlagen`, `BrueckenFehler.nichtErlaubt`/`vorStart` (wird nur noch für „Kern noch da?“ genutzt), `AppAktion.vertrauenGeaendert` (löst nur noch einen Status-Abruf aus), Test `KitVertrauenTests`.
- Werkstatt: der Grund `kit` in `vertrauen.mjs` (Fingerabdruck über `.tools`, Text „Programmcode unter .tools“); `werkstatt/vertrauen-pruefen.mjs` (CLI für Swift, sonst nicht mehr gebraucht); `info.kit`/`kitVersion` (heißt jetzt: Brain-Vault + Kern).
- Studio: Texte/Zweige zu `nicht-vertraut` und `pruefung-fehlgeschlagen` der Aktion `ansicht` (nur für ältere Apps).

### Programme kommen nie aus dem Vault (in P4 geschlossen)
Der Kern läuft ohne Freigabe auf beliebigen Vaults, darum gilt: ein Vault liefert nur Daten.
- `werkzeuge.*` aus der `brain.config.json` des Vaults wird nicht gelesen (`werkzeug.mjs#gitBefehl`, `pfade.mjs#gitAnzeige`). Es gibt sonst keinen Config-Schlüssel im Kern, der ein Programm oder einen Skriptpfad nennt; alle dynamischen Importe laufen über den Kern-Ordner.
- Der Kern startet git nur über `Ressourcen/kern/git-sicher` (Shell-Skript): git von festen Orten, Härtung wie die Werkstatt (kein fsmonitor, keine Hooks außer dem eigenen `git-hooks`-Ordner des Kerns, kein ext::, keine Submodule, keine Signierung, `GIT_SSH_COMMAND` und `GIT_NO_LAZY_FETCH` immer gesetzt). Bei JEDEM Befehl Exit 126, wenn die Repo-Konfiguration ein Programm eintragen kann (Filter-/Merge-/Diff-Treiber, gpg.program, credential.helper, askPass, gitProxy, uploadpack/receivepack/vcs, core.sshCommand) oder einen Partial Clone anzeigt (`remote.*.promisor`, `partialclonefilter`, `extensions.partialclone`: auch lesende Befehle laden sonst nach und starten dann diese Programme). Ebenso bei `core.worktree`, `core.bare`, einem Arbeitsbaum, der kein Elternordner des `-C`-Ordners ist, oder einem Git-Verzeichnis außerhalb des Arbeitsbaums (`.git`-Datei mit `gitdir:` nach draußen); ausgenommen sind die verknüpften Arbeitsbäume des Tageslaufs unter `~/Library/Caches/brain-tageslauf`. `BRAIN_GIT_PROGRAMM` und `BRAIN_GIT_HOOKS_ERLAUBT` wirken nur in der Testumgebung.
  Folge: Ein Vault mit lokalem `credential.helper`, `core.sshCommand` oder Partial Clone arbeitet im Kern ohne git (Online-Sicherung `backup.mjs`, Push der Sitzungs-Sicherung in `session-hintergrund.mjs`, Verlauf); der Helper gehört in die globale Konfiguration.
- Schreibziele: `ordner.inbox/wiki/archiv` (und `wiki.ordner`) in der Vault-Config sind ein einzelner Name (`pfade.mjs#ordner`, sonst Standard); `pruefeVault` verweigert (Exit 2, Hooks still Exit 0) einen Vault, dessen `.logs`, Inbox/Wiki/Archiv, `AGENTS.md`, `CLAUDE.md`, `graph.json` oder `_index.md` per Verweis (auch ins Leere) aus dem Vault hinauszeigt. Offen: `backup.pfad` (Zielordner der Ordner-Sicherung) kommt weiter aus der Config.
- Die Pflege-KI (`pflege-ki.mjs`) lädt mit `--setting-sources user` nur die Einstellungen des Nutzers, nie die `.claude/settings.json` der Vault-Kopie. Die Haiku-Aufrufe (`ernte.mjs`) laufen in einem leeren Temp-Ordner und behalten `project`.
- MCP: ein alter Eintrag mit Server unter `.tools` wird nur ohne Rückfrage umgestellt, wenn dieses `.tools` zu einem Vault aus `vaults.json` gehört.
- Offen für P5/Windows: die Windows-Zweige des Kerns (MinGit-Pfad) laufen ohne diese Härtung.
