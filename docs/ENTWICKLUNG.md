# Entwicklung

## Branches
- `main` ist immer grün und wird nur per PR geändert. **Verbindliche Regel für Agenten: nie direkt auf `main` pushen.**
  GitHub erzwingt das nicht (kein Branch-Schutz); die Regel gilt trotzdem.
- Namen: `feat/fbl-<n>-<kurz>`, `fix/fbl-<n>-<kurz>`, `ci/<kurz>`, `docs/<kurz>`.

## Commits
Stil wie bisher: `feat(FBL-19): Rückfragen-Zähler …`, `fix(FBL-19): …`, `ci: …`, `docs(B2): …`.
Deutsch, Imperativ oder Substantivstil, die Aufgabe steht in Klammern.

## Pull Requests
- PR ist Pflicht. CI (`shellcheck`, `build-test`) muss grün sein; ein Review gibt frei.
- Gemergt wird nur durch die zuständige Person (CEO), nicht durch die Autorin oder den Autor.
- Reine Doku-Änderungen (`docs/**`, `*.md`) lösen die CI nicht aus.

## Spuren
| Spur | Auslöser | Ergebnis |
|---|---|---|
| dev | Push auf `main` | Artefakt `Kortex-dev-<sha>` (Zip, 14 Tage) im CI-Lauf |
| beta | Tag `vX.Y.Z-beta.N` | GitHub-Prerelease mit Zip, Workflow `release-pruefung` |
| stable | Tag `vX.Y.Z` | Release-Entwurf (draft); Veröffentlichen von Hand |

Alle Pakete sind nur ad-hoc signiert, nicht notarisiert (siehe „Signieren + Notarisieren“). Ein manueller Lauf von
`release-pruefung` (`workflow_dispatch`) baut und testet, veröffentlicht aber nichts.

## Signieren + Notarisieren (noch nicht aktiv)
`release-pruefung.yml` enthält einen deaktivierten Schritt (`if: false`), der später `scripts/veroeffentlichen.sh`
(aus `studio-v2`) aufruft. Dafür wären diese Repo-Secrets nötig (aktuell **nicht** angelegt):
- `DEVELOPER_ID_CERT_P12` (base64) und `DEVELOPER_ID_CERT_PASSWORD`: Developer-ID-Application-Zertifikat
- `KEYCHAIN_PASSWORD`: temporäre Keychain auf dem Runner
- `NOTARY_APPLE_ID`, `NOTARY_TEAM_ID`, `NOTARY_APP_PASSWORD`: App-spezifisches Passwort für `notarytool`
Die genauen Namen richten sich nach `veroeffentlichen.sh`, wenn es übernommen wird (FBL-25).

## Node-Tests
Der Job `node-test` in `ci.yml` läuft nur, wenn `scripts/teste-node.sh` existiert (kommt mit `studio-v2`, FBL-25).

## Tags
Tags werden nie verschoben oder ersetzt. Ist ein Release fehlerhaft, folgt eine neue Version
(`v0.2.0-beta.2`, `v0.2.1`). Tags werden nur vom CEO gesetzt.

## Flakes
Ein roter Lauf darf höchstens 2× neu gestartet werden. Den ersten Fehler verlinkt man im PR
(Lauf-URL und Zeile), damit er nicht verschwindet. Tritt er wieder auf, wird er behoben, nicht wegrestartet.

## Lokal prüfen
`swift build && swift test`, `shellcheck scripts/*.sh`, `bash scripts/baue-app.sh` (macOS, arm64).
