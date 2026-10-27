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

## Signieren + Notarisieren (nur Stable-Tags)
`release-pruefung.yml` signiert und notarisiert nur bei Tags `vX.Y.Z` (Betas bleiben ad-hoc signiert). Der Schritt ruft
`scripts/veroeffentlichen.sh` auf: Developer-ID-Signatur, Notarisierung, DMG, Sparkle-Appcast. Das Release (Entwurf) bekommt
Zip, DMG und `appcast.xml`. Fehlt ein Secret, bricht der Lauf mit dem Namen des fehlenden Secrets ab; es wird nie unsigniert
als Stable ausgeliefert. Repo-Secrets (Fabio legt sie selbst an, nie in Kommentare oder Chats):
- `MACOS_CERT_P12_BASE64` und `MACOS_CERT_PASSWORD`: Developer-ID-Application-Zertifikat (base64) und sein Passwort
- `BRAIN_SIGNIER_ID`: voller Zertifikatsname „Developer ID Application: … (TEAMID)“
- `NOTAR_KEY_P8_BASE64`, `NOTAR_KEY_ID`, `NOTAR_ISSUER_ID`: App-Store-Connect-API-Schlüssel (Rolle Developer) für `notarytool`
- `SPARKLE_ED_PRIVATE_KEY`: EdDSA-Schlüssel (`generate_keys -x`); derselbe wie lokal, sonst passen Updates nicht

Der Runner legt einen temporären Schlüsselbund mit zufälligem Kennwort an und löscht ihn und alle Schlüsseldateien am Ende immer
(`if: always()`). In `veroeffentlichen.sh` gilt die CI-Variante, sobald `BRAIN_NOTAR_KEY_PFAD`/`BRAIN_NOTAR_KEY_ID`/`BRAIN_NOTAR_ISSUER`
gesetzt sind (sonst `BRAIN_NOTAR_PROFIL` aus dem Schlüsselbund); `SPARKLE_ED_KEY_DATEI` ersetzt dort den Schlüsselbund für Sparkle.
Sparkle-Werkzeuge 2.10.0 werden mit fester SHA-256 geladen. Die `appcast.xml` aus CI enthält nur die jeweils neue Version.

**Probelauf:** Actions, „Release-Prüfung“, Run workflow, `signier_probe` anhaken. Das führt `veroeffentlichen.sh --trocken` aus
(Secrets, Zertifikat, Apple-Anmeldung werden geprüft, nichts wird signiert oder veröffentlicht).
Stable-Tags setzt nur der CEO nach Fabios Freigabe.

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
