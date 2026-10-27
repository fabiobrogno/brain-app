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
(aus `studio-v2`) aufruft. Dafür sind diese Repo-Secrets vorgesehen (Fabio legt sie an, siehe FBL-26; Notarisierung per API-Schlüssel):
- `MACOS_CERT_P12_BASE64` und `MACOS_CERT_PASSWORD`: Developer-ID-Application-Zertifikat (base64) und sein Passwort
- `BRAIN_SIGNIER_ID`: Signier-Identität
- `NOTAR_KEY_P8_BASE64`, `NOTAR_KEY_ID`, `NOTAR_ISSUER_ID`: App-Store-Connect-API-Schlüssel für `notarytool`
- `SPARKLE_ED_PRIVATE_KEY`: EdDSA-Schlüssel zum Signieren der Sparkle-Updates

Die CI legt daraus Keychain und `notarytool`-Profil an; `veroeffentlichen.sh` liest `BRAIN_SIGNIER_ID` und
`BRAIN_NOTAR_PROFIL`. Das Keychain-Passwort erzeugt der Runner zufällig, es ist kein Secret.

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
