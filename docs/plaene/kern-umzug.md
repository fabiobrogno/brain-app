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
