# Stand Kortex, 29.10.2026

Fortsetzung von [28.10. abends](../2026-10-28/stand-abend.md). Das Repo ist seit heute öffentlich (die GitHub-Actions-Minuten des privaten Kontos waren aufgebraucht). Vorher wurde die gesamte Historie auf Geheimnisse geprüft: keine gefunden, nur Test-Attrappen.

## Ergebnis des Tages

Ein frischer Vault braucht kein Kit mehr. Die App bringt den Kern mit, legt ihn versioniert im Support-Ordner ab und verdrahtet Hooks, git-Prüfung und Hintergrunddienst über einen stabilen Starter.

| PR | Inhalt |
|---|---|
| #21 | P3: Laufzeit mit Kern (`Support/Kortex/kern/<Version>`, Manifest), Starter `bin/kortex`, Umzug Support-Ordner Brain → Kortex |
| #24 | Vorschau-Modus: App wie frisch installiert starten, alles in einem Wegwerf-Ordner (`scripts/vorschau.sh`) |
| #25, #30 | Flackernde Tests behoben; #30 war ein echter Fehler (abgelöster Kern-Link wurde vor der Schonfrist gelöscht) |
| #26 | Einrichtung „Sicherung“: privates GitHub-Repo anlegen oder wählen, erster Push ohne Force (FBL-88) |
| #27, #33 | CI: Kern-Tests, Manifest- und Vorschau-Test; danach Shards, Pfadfilter, eine Ampel `ci-ok` – ca. 2 statt 6 Minuten |
| #28, #35 | git-Client im Studio: Abgleich mit Konfliktlösung je Datei, frühere Fassung zurückholen, Zustand sichtbar; neu gestaltet |
| #29 | P2: Kern findet seinen Vault selbst (`--vault`, `BRAIN_VAULT`, aktiver Vault), nie Rückfall auf `~/brain` |
| #32 | P4: App ruft nur noch den gebündelten Kern auf. Härtung gegen fremde Vaults: `git-sicher` (Erlaubnisliste lokaler git-Einstellungen, keine Symlinks in `.git`, keine lokalen Remotes), Schreibschutz im Vault, Sicherung nur zu bestätigtem Ziel |
| #31 | P6: Claude-Code-Hooks (je Profil `~/.claude*`), git-Prüfung vor dem Commit und Hintergrunddienst über den Starter; Dienst nur für freigegebene Vaults |
| #34 | Echte Logos für Claude und Cursor (Simple Icons, CC0), Codex vorerst als Initiale |

Jedes Paket lief durch CI; alles mit Sicherheits- oder Außenwirkung zusätzlich durch Opus-Reviews (P4 in drei Runden).

## Entscheidungen

- Sichtbare Begriffe: App = **Kortex**, Datenordner = **Vault**. Interne Namen (`brain.mjs`, `brain.config.json`, Bundle-ID) bleiben.
- Hooks und Hintergrunddienst folgen dem aktiven Vault der App; der Dienst läuft nur für ausdrücklich freigegebene Vaults.
- Vertrauen pro Vault kommt in P5 als Workspace-Trust zurück: In Kortex angelegte oder geklonte Vaults sind vertraut, von außen kopierte Ordner werden einmal gefragt.

## In Arbeit

- P5: Vertrauensfrage pro Vault, altes Kit-Vertrauen entfernen.
- Texte: überall „Kortex“ und „Vault“ statt „Brain“.
- Danach: Swift-Oberfläche (Menüleiste, Assistent mit KI-Logos), P7 Umstellungs-Assistent für bestehende Vaults (u.a. lokale git-Einstellungen in die globale Konfiguration verschieben), P8 Aufräumen, P9 Kit archivieren.

## Hinweise

- Bestehender Vault mit lokalem `credential.helper` o.ä.: Der Kern arbeitet dort ohne git, bis P7 umstellt.
- Codex-Logo: erst nach geklärter Markenfreigabe (`Ressourcen/logos/HERKUNFT.md`).
- Vorschlag offen: `ci-ok` als Pflicht-Check für `main` in den Repo-Einstellungen.
