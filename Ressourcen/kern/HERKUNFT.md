# Herkunft des Kerns

Dieser Ordner (`Ressourcen/kern/`, Tests unter `Tests/Kern/`) ist eine **Kopie ohne Historie** der Kit-Logik, die bisher als
`<vault>/.tools` lag. Die Historie liegt im archivierten `second-brain-kit` bzw. (mit privaten Commits durchsetzt) im privaten
Quell-Vault und wird bewusst nicht übernommen. Plan: `docs/plaene/kern-umzug.md`. Paket P1: keine Verhaltensänderung der App, der Kern
wird nur getestet, aber noch nicht von der App benutzt. Paket P2: Pfade (siehe „P2: KERN und VAULT“ unten).

## Quellen
| Stand | Quelle | SHA | Nutzung |
|---|---|---|---|
| A | privater Quell-Vault, Ordner `.tools`, Branch `main` | `6608c43` (`6608c432d0c2`) | Basis; nur versionierte Dateien (`git archive 6608c43 .tools`), nie der Arbeitsbaum |
| B | `second-brain-kit`, Branch `main` | `d269c20a8b71` (enthält `5fe7493` = PR #13 und die Nacharbeiten aus Kit-PR #17: Singular „1 Tag“ in `texte.js`/`steuer.js`, `.tmp`-Aufräumen in `zufuehrungen.mjs`) | nur die unten genannten Teile |
| B (Merge-Basis) | `second-brain-kit`, Export v0.5.1 | `ba5fcf4` | gemeinsamer Vorfahr für die Dreiwege-Zusammenführung |

Kit-PR #12 (Frische: `frische.mjs`, `test-frische.mjs` und Deltas in `brain.mjs`, `hint-core.mjs`, `brain-hint.mjs`, `import/widerspruch.mjs`)
ist **nicht** enthalten; er kommt später als eigener Port auf den Kern.

## Übernommen (Basis A)
Alles aus A `.tools`, außer der Liste „Weggelassen“. Code → `Ressourcen/kern/`, `tests/*` → `Tests/Kern/` (flach, inklusive Fixtures).

## Aus B dazugenommen
- `zufuehrungen.mjs`, `tests/test-zufuehrungen.mjs` (FBL-93)
- `gesundheit.mjs` **umbenannt** zu `gesundheitswert.mjs` (Gesundheitswert 0–100; Namenskonflikt mit `tageslauf/gesundheit.mjs`, dem Gesundheits-Wächter);
  `tests/test-gesundheit.mjs` (B) als `Tests/Kern/test-gesundheitswert.mjs`. `Tests/Kern/test-gesundheit.mjs` bleibt der Test des Wächters (A).
- `tests/test-karte.mjs` (FBL-96)
- `tests/test-pre-commit.sh` (Git-for-Windows-Pfad) und `skills/lint/SKILL.md` (Zeile zum Gesundheitswert): in B neuer, in A unverändert

## Zusammengeführt (A als Basis + B-Änderungen, Dreiwege-Merge gegen `ba5fcf4`)
- `pflege.mjs`: B bringt den Posten `zufuehrungen` und den Gesundheitswert (Feld `gesundheit`), A das Feld `wirkung`. Rückgabeobjekt trägt beide;
  im Textbericht steht die Wirkungszeile vor der Zeile „Gesundheit: N/100“, die als letzte Zeile bleibt.
- `ansicht/steuer.js`, `ansicht/texte.js`, `tests/test-ansicht-steuer.mjs`, `tests/test-pflege-bericht.mjs`, `kit/AGENTS.md`
- `tests/test-seitenfelder.mjs`: A plus die eine zusätzliche Behauptung aus B (`kritisch: true` ist gültig)

Nicht aus B übernommen (A ist vollständiger): `beleg.mjs`, `heikel.mjs`, `seitenfelder.mjs`, `brain-lint.mjs` mit ihren Tests und `tests/fixture-belege/`.

## Weggelassen
- Export/Installer/Publish: `kit/export.mjs`, `kit/allowlist.txt`, `kit/repo/**` (install.mjs, bootstrap.sh/.ps1, lib/voraussetzungen.mjs, README/INSTALL/UPDATE/CHANGELOG, migrations, assets, Workflow), `kit/screenshot/**`, `kit/publish-check.mjs` (+ `tests/test-publish-check.sh`; bleibt als Entwicklerwerkzeug für die Veröffentlichung zu klären)
- `skills/update/` (Update-Skill)
- privat: `skills-claude/**`, `mods/**`, `migrate/**`, `SEARCH.md`, `claude-md-block.md`, `search.sh`, `tests/hint-eval.json`, `tests/holdout.json`, `tests/hint-eval.mjs`
- Tests auf Entfallenes: `test-export.sh`, `test-migrate-3-2.sh`, `test-voraussetzungen.mjs`, `test-brain-mods.mjs`, `test-bootstrap.sh`,
  `test-install.sh`, `test-install-safety.sh`, `test-migrationen.sh`, `test-update-check.mjs`, `test-publish-check.sh`
- unversionierte Laufzeitdateien im Arbeitsbaum von A (`tests/fixture/.logs/**` u. a.)

## P2: KERN und VAULT
Der Kern liegt künftig außerhalb des Vaults (P3/P4: `Support/Kortex/kern/<appVersion>/`, Symlink `bin/kern`); der Vault enthält nur Daten.
`pfade.mjs` ist die einzige Stelle, die das weiß:
- `KERN` = Ordner von `pfade.mjs` selbst (`import.meta.url`). Kern-Dateien (Module, Skills, `kit/AGENTS.md`, `kit/vorlage-eval.json`, `ansicht/`) werden nur darüber gefunden, nie über den Vault.
- Vault, in dieser Reihenfolge: `--vault <pfad>` (an beliebiger Stelle der Kommandozeile; `pfade.mjs` nimmt die Angabe beim Laden aus `process.argv`), erstes Positionsargument (Altform, wo ein Werkzeug sie kennt), `BRAIN_VAULT`, aktiver Vault aus
  `vaults.json` im Support-Ordner der App (`BRAIN_APP_SUPPORT` für Tests, sonst `~/Library/Application Support/Kortex`, als Rückfall `…/Brain`; Format wie `Sources/BrainCore/VaultListe.swift`).
  **Nie** ein Rückfall auf einen festen Home-Ordner des Entwicklers oder auf den Ort des Kerns. Kein Vault: Werkzeuge melden „Kein Vault gefunden …“ und enden mit Exit 2 (`vaultPfadOderEnde`); Hook-Einstiege (`adapters/claude-code/*`, `search-refresh`, `hint-warm`, `suchdienst`) enden still mit Exit 0.
- Schreibziele bleiben im Vault (`.logs/` …). Die file://-Rückfallansicht von `brain zeig` schreibt `<vault>/.logs/ansicht/seite.html` (index.html des Kerns mit `<base>` auf den Kern); `data.js` liegt wie bisher unter `.logs/ansicht/`.
- Messlatte-Fragen: gebündelt `kit/vorlage-eval.json` (Platzhalter); eigene Fragen `<vault>/.logs/hint-eval.json` ersetzen sie, der Holdout liegt in `<vault>/.logs/holdout.json` (nie im Repo).
- Kit-weite Werkzeuge (privates qmd/Node/git/gh): `pfade.mjs#kitOrte` = Support-Ordner der App, als Lese-Rückfall `~/.brain-kit` (nichts wird verschoben).
- Kern-Version = App-Version: die eine Lesestelle ist `pfade.mjs#kernVersion()` (liest `VERSION` im Kern; `brain version`, `brain status`, `wirkung`, Ansicht-Dienst/-Brücke). Der App-Bau soll dort `CFBundleShortVersionString` eintragen (P3); bis dahin steht der Kit-Stand `0.5.1` darin.
- `KORTEX_KERN_PFAD` (vom Starter, P3) = stabiler Kern-Pfad (z. B. der Symlink `bin/kern`) für gerenderte Befehle, Hook-Einträge, `core.hooksPath` und den LaunchAgent; ohne ihn gilt der tatsächliche Ort.
- Einziges erlaubtes `.tools`-Literal: `ALT_KIT_ORDNER` in `pfade.mjs` (Erkennung/Schutz noch nicht umgestellter Vaults). Der Lint-Test `Tests/Kern/test-keine-altpfade.mjs` hält das fest (Allowlist mit Begründung: `pfade.mjs`, `HERKUNFT.md`, `adapters/claude-code/install.mjs` wegen der Migration älterer Hook-Einträge in `$HOME`-Schreibweise).
- Entfallen: `update-check.mjs` samt Befehl `brain update-check`, Update-Hinweis in `session-start`/`session-hintergrund` und `doctor` (die App aktualisiert sich per Sparkle; der Schalter `updateHinweis` bleibt wirkungslos in der Config gültig), `istQuellVault`, der Unit-Test-Schritt der Commit-Prüfung (`BRAIN_ERSTCOMMIT`), `systemVersion`-Pflicht im `doctor`.
- Templates (`kit/AGENTS.md`, `skills/*`): neue Platzhalter `{{KERN}}` und `{{DATEN}}`; Kern-Befehle lauten `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" <befehl>`.

## Mitgenommen
- `VERSION` (`0.5.1`, Stand des Exports; wird in P3 beim App-Bau auf die App-Version gesetzt)

## Änderungen gegenüber A/B (Neutralisierung und Testanpassung)
- Fixture-Ordner des privaten Vault-Layouts (`firma/<Firmenname>`) → `firma/kunde_a` (samt `_kunde_a.md`, Beschreibungen und Suchwörter); Beispielfragen in `kit/vorlage-eval.json` neutral
- Beispiel-Token in `skills/ingest/SKILL.md` → „Zugangs-Token“; Marken-Beispiele in vier Testtexten → „Kundenportal“; ein MCP-Servername im Werkzeug-Log-Test → `beispiel-ads-bc`
- `test-tageslauf-regeln.mjs`: LAN-Adresse mit Straßenangabe → `192.0.2.147` (Dokumentationsbereich) und „Beispielstraße 12“
- `test-skills.mjs`: Update-Skill/`brain-update.md` entfernt; `test-adapter-claude.mjs`, `test-commit-pruefung-limit.mjs`: Bezüge auf Update-Skill und `kit/repo/install.mjs` entfernt
- `test-gesundheit.mjs`: ein Test hing an der echten Uhr (Stand „frisch“ war auf den 22.10.2026 festgelegt); jetzt `new Date()`
- Neu: `Tests/Kern/stage.sh` (zentrale Kern-Wurzel `KORTEX_KERN`, siehe unten), Aufruf in `run-all.sh` und `unit.sh`
- P2: `setup.mjs`/`plattform.sh`/`stage.sh` räumen `BRAIN_VAULT`/`KORTEX_KERN_PFAD` aus der Umgebung und lenken `BRAIN_APP_SUPPORT` auf einen leeren Temp-Pfad (kein Test liest je die echte Vaultliste); Tests ohne Werkzeug-Kopie im Vault; `test-commit-pruefung-limit.mjs` → `test-commit-pruefung-ohne-unit.mjs`; neu `test-keine-altpfade.mjs` (Lint) und erweiterte `test-pfade.mjs`

## Tests im neuen Layout
Die übernommenen Tests rechnen mit dem alten Layout (`tests/..` ist der Kern). `Tests/Kern/stage.sh` baut deshalb pro Lauf eine temporäre
Bühne (`Ressourcen/kern/` + `Tests/Kern/` als `tests/`), setzt `KORTEX_KERN` auf deren Wurzel und führt `run-all.sh`/`unit.sh` dort aus. Der Arbeitsbaum bleibt unberührt.
`bash Tests/Kern/run-all.sh` (alles) bzw. `bash Tests/Kern/unit.sh Tests/Kern/test-x.mjs` (einzelne Dateien). Platzhalterfragen
(`kit/vorlage-eval.json`) sind seit P2 direkt die Standardfragen des Kerns; echte Fragen gehören nie ins Repo (`<vault>/.logs/hint-eval.json`).
