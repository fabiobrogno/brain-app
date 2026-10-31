# Entwicklung

## Branches
- `main` ist immer grün und wird nur per PR geändert. **Verbindliche Regel für Agenten: nie direkt auf `main` pushen.**
  GitHub erzwingt das nicht (kein Branch-Schutz); die Regel gilt trotzdem.
- Namen: `feat/fbl-<n>-<kurz>`, `fix/fbl-<n>-<kurz>`, `ci/<kurz>`, `docs/<kurz>`.

## Commits
Stil wie bisher: `feat(FBL-19): Rückfragen-Zähler …`, `fix(FBL-19): …`, `ci: …`, `docs(B2): …`.
Deutsch, Imperativ oder Substantivstil, die Aufgabe steht in Klammern.

## Pull Requests
- PR ist Pflicht. Der CI-Status `ci-ok` muss grün sein (er fasst alle Jobs zusammen); ein Review gibt frei.
- Gemergt wird nur durch die zuständige Person (CEO), nicht durch die Autorin oder den Autor.
- Reine Doku-Änderungen (`docs/**`, `*.md`) laufen durch die CI, überspringen aber alle Prüfjobs: `ci-ok` ist nach wenigen Sekunden grün.

## Spuren
| Spur | Auslöser | Ergebnis |
|---|---|---|
| dev | Push auf `main` | Artefakt `Kortex-dev-<sha>` (Zip, 14 Tage) im CI-Lauf |
| beta | Tag `vX.Y.Z-beta.N` | GitHub-Prerelease mit Zip, Workflow `release-pruefung` |
| stable | Tag `vX.Y.Z` | Release-Entwurf (draft); Veröffentlichen von Hand |

dev und beta sind nur ad-hoc signiert, nicht notarisiert; nur stable ist signiert und notarisiert (siehe „Signieren + Notarisieren“). Ein manueller Lauf von
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
Sparkle 2.10.0 steckt als SwiftPM-Abhängigkeit in der App (`SUPublicEDKey` und `SUFeedURL` in `Ressourcen/Info.plist`,
Feed: `https://github.com/fabiobrogno/brain-app/releases/latest/download/appcast.xml`); `baue-app.sh` legt `Sparkle.framework` nach
`Contents/Frameworks`, `veroeffentlichen.sh` signiert dessen XPC-Dienste, Autoupdate und Updater.app von innen nach außen mit Hardened Runtime.
Sparkle-Werkzeuge 2.10.0 werden mit fester SHA-256 geladen. Die `appcast.xml` aus CI enthält nur die jeweils neue Version. Vor dem Signieren prüft CI, dass der Stable-Tag `v<Version>` der `CFBundleShortVersionString` aus `Ressourcen/Info.plist` entspricht, sonst Abbruch. `releases/latest` ignoriert Entwürfe: Der Stable-Entwurf muss veröffentlicht sein, damit der Feed greift.

Nach dem Signieren prüft der Workflow unabhängig vom Skript (Schritte „Gatekeeper-Prüfung“ und „Appcast gegen Tag und DMG prüfen“):
`codesign --verify --deep --strict`, `spctl -a -vv` und `xcrun stapler validate` an App, DMG und der App in der gemounteten DMG, Hardened Runtime,
Verknüpfung „Programme“, und im Appcast Version, Download-Adresse (muss zu Tag und DMG passen) und EdDSA-Signatur. Alle Actions sind auf Commit-SHAs
gepinnt (Version im Kommentar), jeder Job und jeder lange Schritt hat `timeout-minutes`. Den Ablauf für dich als Freigebende beschreibt `docs/veroeffentlichen.md`.

## Lizenzen von Dritten
`THIRD-PARTY-NOTICES.md` (Wurzelordner) nennt alles, was die App mitliefert: Node.js (Version aus `scripts/node-version.txt`), Sparkle (Version aus
`Package.swift`), CodeMirror, three.js, Geist, Gehirnmodell, Simple Icons. `baue-app.sh` legt die Datei nach `Contents/Resources/` und neben die
Oberfläche (`studio/`, dort liest sie Einstellungen → „Lizenzen …“); `Tests/Node/lizenzen.test.mjs` und der Rauchtest prüfen, dass jede Datei unter
`vendor/` und `logos/` darin steht und die Datei im Paket liegt. **Wer eine Bibliothek, Schrift oder ein Logo hinzufügt oder die Version von Node/Sparkle ändert, ergänzt die Datei im selben PR.**

**Probelauf:** Actions, „Release-Prüfung“, Run workflow, `signier_probe` anhaken. Das führt `veroeffentlichen.sh --trocken` aus
(Secrets, Zertifikat, Apple-Anmeldung werden geprüft, nichts wird signiert oder veröffentlicht).
Stable-Tags setzt nur der CEO nach Fabios Freigabe.

## Node-Tests
## CI-Aufbau (`.github/workflows/ci.yml`)
- `aenderungen` entscheidet mit `scripts/ci-aenderungen.sh` (Test: `scripts/teste-ci-aenderungen.sh`), welche Bereiche laufen: `swift`, `kern`, `node`, `ui`, `vorab`.
  Bei einem PR gilt der Vergleich mit dem Zielzweig, bei `main` der mit dem Stand vor dem Push. Unbekannte Pfade (z. B. `.github/**`, neue Ordner) schalten alles ein; neue Abhängigkeiten zwischen Bereichen gehören in dieses Skript.
- Jobs: `vorpruefung` (shellcheck, Syntax, JSON, Lint; lokal `bash scripts/ci-vorpruefung.sh`), `kern-test` (6 Shards), `node-test`, `ui-test` (6 Shards), `swift` (macOS), `ci-ok` (EIN Status, grün bei „erfolgreich oder übersprungen“), `dev-artefakt` (nur `main`).
- Kern-Shards: `bash Tests/Kern/run-all.sh --shard I/N`. Die Verteilung nutzt `Tests/Kern/gewichte.txt` (Sekunden je Testdatei, optional nachpflegen); jede Testdatei läuft in genau einem Shard, auch ohne Eintrag.
- Playwright: `npx playwright test --shard=I/N --workers=2 --fully-parallel` (jeder Test startet seinen eigenen Server).

## Tags
Tags werden nie verschoben oder ersetzt. Ist ein Release fehlerhaft, folgt eine neue Version
(`v0.2.0-beta.2`, `v0.2.1`). Tags werden nur vom CEO gesetzt.

## Flakes
Ein roter Lauf darf höchstens 2× neu gestartet werden. Den ersten Fehler verlinkt man im PR
(Lauf-URL und Zeile), damit er nicht verschwindet. Tritt er wieder auf, wird er behoben, nicht wegrestartet.

## Laufzeit und feste Pfade
Support-Ordner ist `~/Library/Application Support/Kortex` (früher `Brain`; beim Start benennt `SupportMigration` ihn einmalig um,
existieren beide, bleibt alles unberührt und die App zeigt einen Hinweis). Die App stellt dort bereit (`Sources/BrainCore/Laufzeit.swift`):
`bin/node` (relativer Symlink auf `node/<ver>/bin/node`), `bin/kern` (Symlink auf `kern/<appVersion>/`, Kopie von `Resources/kern`, jede Datei
gegen `Resources/kern-manifest.json` geprüft) und den Starter `bin/kortex` (`exec bin/node bin/kern/brain.mjs "$@"`). Hooks, MCP, git-Hooks
und LaunchAgent verwenden nur diese Pfade. Die vorige Kern-Version bleibt nach einem Update liegen. Ohne `Ressourcen/kern` im Paket gibt
es nur Node (Kern-Status „nicht enthalten“). `scripts/baue-app.sh` erzeugt das Manifest (`scripts/kern-manifest.sh`), Test:
`bash scripts/teste-kern-manifest.sh`. Der Node-Code liest den Ordner aus `BRAIN_APP_SUPPORT` (setzt die App), Rückfall `…/Kortex`. Ein relativer Wert von `BRAIN_APP_SUPPORT`
wird auf den Arbeitsordner bezogen. Nach dem Umbenennen bleibt `Brain` als relativer Symlink auf `Kortex` stehen, damit bereits eingetragene
Pfade (MCP-Einträge, Hooks) weiterlaufen. Die App gibt der Werkstatt den stabilen Node-Pfad (`BRAIN_MCP_NODE` = `bin/node`) für neue MCP-Einträge;
Einträge mit altem aufgelöstem Pfad (`…/Brain|Kortex/node/<ver>/bin/node`) stellt „KI verbinden“ ohne Rückfrage darauf um.

## Lokal prüfen
`swift build && swift test`, `shellcheck scripts/*.sh`, `bash scripts/baue-app.sh` (macOS, arm64).

## Vorschau wie frisch installiert
Ein Befehl zeigt Kortex so, wie es jemand sieht, der es gerade installiert hat — ohne dass auf deinem Mac etwas bleibt:

    scripts/vorschau.sh [--ohne-git] [--mit-ki]      # oder Doppelklick auf „Kortex Vorschau.command“ im Repo-Ordner

- `--ohne-git`: git gilt als nicht installiert; „installieren“ zeigt nur einen Hinweis, `xcode-select --install` läuft nie.
- `--mit-ki`: Platzhalter für Claude Code, Codex und Cursor im Vorschau-PATH; „KI verbinden“ schreibt nur in die Vorschau.
- `--neu-bauen`: Build erzwingen (sonst wird nur gebaut, wenn `build/Kortex.app` fehlt oder der Quelltext neuer ist). Weitere Schalter gehen an die App.

Das Skript legt `$TMPDIR/kortex-vorschau-XXXX` an, startet eine Kopie der App unter eigener Kennung `io.github.fbrogno.brain.vorschau`
(eigene Einstellungen, eigener Web-Speicher, Sparkle aus) mit `--vorschau <Ordner>` und löscht Ordner und Spuren der Kennung nach dem Ende
(Beenden, Strg-C, Schließen des Terminals). Der Assistent „Kortex einrichten“ erscheint wie bei einem frischen Nutzer; ein Band
„Vorschau — nichts wird gespeichert“ steht in jedem Fenster, im Menü und im Titel des Assistenten.

Was umgeleitet ist (`VorschauModus`, Swift; `KORTEX_VORSCHAU`, Node):
- Application Support → `<Ordner>/support`. HOME, `CFFIXED_USER_HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` aller Kindprozesse → `<Ordner>/home` bzw. `tmp`.
- git: `GIT_CONFIG_GLOBAL=<home>/.gitconfig`, `GIT_CONFIG_NOSYSTEM=1`; ssh ohne `~/.ssh`, Schlüssel und Agent (`GIT_SSH_COMMAND`).
- GitHub-Token: Helper `store --file=<home>/.git-credentials` statt Schlüsselbund; die Swift-Seite greift nie auf den Schlüsselbund zu.
- PATH: `<Ordner>/bin` plus Systemordner, nie Homebrew oder `/usr/local`. KI-Suche nur dort und im Vorschau-Home.
- Vaults (anlegen, öffnen, klonen) nur innerhalb des Ordners — auch ein im Dialog gewählter Ordner außerhalb wird abgelehnt.
- Kein Sparkle, keine Login-Shell (`TerminalNode`), keine LaunchAgents, keine Login-Items.
- Fail-closed: ungültiger Ordner, HOME nicht umgelenkt oder echte Bundle-ID → die App beendet sich (Exit 2), die Werkstatt ebenso.

Tests: `swift test --filter Vorschau` (Pfade, Umgebung, Platzhalter, Ende-zu-Ende mit echter Werkstatt und einem zweiten Temp-Ordner als
„echtes“ HOME), `Tests/Node/vorschau.test.mjs`, `scripts/teste-vorschau.sh` (Skript, Signale, Aufräumen) und
`scripts/teste-vorschau.sh --app` (echte App; prüft nur lesend, dass im echten Benutzerordner nichts neu oder anders ist).
Wer weitere Orte einführt (neue Ordner unter `~`, Keychain, LaunchAgents), muss sie hier umlenken oder in der Vorschau abschalten.

## Konflikt beim Abgleich (zwei Geräte)
Datenfluss: Die Hintergrund-Sicherung des Kerns (`kern/backup.mjs#abgleichen`) holt vor dem Senden, nimmt bei einem Konflikt ihre Zusammenführung zurück und vermerkt ihn im
Support-Ordner (`<Support>/backup/<Kennung>.json` → `abgleich` mit `stand: "konflikt"` und den betroffenen `dateien`). Das Studio zeigt daraus Banner, Mitteilung und
„Konflikt in N Notizen“ in der Statusleiste. „Ansehen“ gleicht noch einmal ab und lässt die Zusammenführung offen (`gemeinsam/git.mjs#sync`, `konflikteLoesen`); die Konflikt-Ansicht
(`studio/konflikt.js`) holt beide Fassungen je Datei über die Werkstatt vom Kern (`brain abgleich ansicht`, `kern/abgleich-konflikt.mjs`, git nur über `git-sicher`, immer ohne Hooks).
Abschluss (⌘↩): `brain abgleich loesen` hält zuerst überall die eigene Fassung fest (ein Zusammenführungs-Eintrag), danach je Entscheidung (diese · andere · beide mit Kopie
„<Name> (<Gerät>)“ · zusammengeführter Text) einen eigenen Eintrag im Verlauf, gleicht wie die Sicherung ab (nur an das bestätigte Ziel; sonst sendet der Studio-Abgleich) und räumt den
Konfliktstand. „Rückgängig“ (`brain abgleich rueckgaengig`) legt die Fassungen von vor den Entscheidungen als neuen Eintrag zurück (nie Reset) und nur, solange an den Dateien nicht weitergearbeitet wurde.
„Später“ nimmt die offene Zusammenführung zurück (`brain abgleich abbrechen`), damit nie Dateien mit Konfliktmarken liegen bleiben.
Gerätename: Marke `Kortex-Geraet: <Name>` im Commit, sonst die Standard-Adresse eines Macs (`nutzer@Name.local`), sonst „Anderes Gerät“; der eigene Name steht in `<Support>/geraet.json` oder ist der Computername.
Gemeinsame Sperre: `kern/abgleich-sperre.mjs` (`<Support>/backup/<Kennung>.sperre` mit PID, Zeit und Art; verwaist, wenn der Prozess fehlt oder sie älter als 15 min ist) für Sicherung, Holen, Studio-Abgleich und Konfliktlösung.
Tests: `Tests/Kern/test-abgleich-konflikt.mjs` (echte Repos, alle Arten, Sperre auch zwischen Prozessen), `Tests/Node/konflikt-werkstatt.test.mjs`, `Tests/Oberflaeche/konflikt.spec.mjs`.
Sicherheit der Konfliktlösung: Kortex löst oder bricht nur eine Zusammenführung ab, die es selbst begonnen hat (`brain abgleich markieren` nach dem Studio-Abgleich merkt HEAD, MERGE_HEAD und einen Fingerabdruck der Konfliktdateien;
sonst 409 „fremd“). Von Hand Bearbeitetes wird nie überschrieben (409 „bearbeitet“) und vor dem Zurücknehmen gesichert (`.git/brain-sicherung/<Zeit>/`, große Dateien als Objekt in `_blobs.txt`). Die Oberfläche schickt nur den
gesehenen Stand (`gesehen`: meine/andere); ein Stand nach „Rückgängig“ oder einem Abbruch mitten im Festhalten liegt als `konfliktBasis` im Support-Ordner, die Sicherung sendet bis dahin nichts. Einträge im Verlauf entstehen ohne Pfadangabe.
Die Marke setzt nur der Abgleich, der die Zusammenführung SELBST begonnen hat (`gestartet` in der 409 von `sync`, und es gab vorher kein MERGE_HEAD); eine Zusammenführung aus dem Terminal bleibt „fremd“ und wird nur angezeigt (Hinweis mit kopierbaren Befehlen, kein Übernehmen). Vor jedem Eingriff sichert `sichereArbeitsstand` alles, was vom reinen Ergebnis der Zusammenführung abweicht (vorgemerkt und nicht vorgemerkt); Fremdes im Index ist 409 „vorgemerkt“. Der gemerkte Stand (`konfliktBasis`) wird nie still geräumt: Holen und Sicherung lassen ihn stehen; ist er ungültig (nicht mehr Vorfahr von HEAD) oder wurde seitdem weitergearbeitet, zeigt die Ansicht Hinweis und „Verwerfen“. Dateien über 5 MB gehen als Strom aus dem Objekt (`cat-file`). `gitExklusiv` wartet bis ca. 3 s statt gleich 409. Ohne vom Nutzer bestätigtes Ziel sendet das Lösen nicht (wie die Sicherung, #67). Posteingang: ungültiger Eintrag `ordner.inbox` → sichtbarer Hinweis im Studio (`inboxHinweis`), gleiche Regel wie der Kern.
