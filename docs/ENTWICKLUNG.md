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
- Die Linux-Plattform-Probe (`plattform-probe`, ubuntu-latest) ist Pflichtbestandteil von `ci-ok`. Die Windows-Probe läuft mit, blockiert aber nicht (`continue-on-error`), bis sie grün ist; danach wird sie ebenfalls Pflicht.
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
`Package.swift`), CodeMirror, three.js, Geist, Gehirnmodell, Simple Icons, Lucide (Symbole). `baue-app.sh` legt die Datei nach `Contents/Resources/` und neben die
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

## Gemeinsame Logik für Studio, Werkstatt, MCP und Swift
- `Ressourcen/gemeinsam/wikilink.mjs`: EINE Regel, wohin ein `[[Link]]` zeigt (Pfad/Dateiname, Titel, Alias; erst genau, dann tolerant bei Groß/klein, Umlauten, Trennern),
  dazu Vervollständigung und „Anlegen“ (`POST /api/wiki/anlegen`: findet ein vorhandenes Ziel, sonst Notiz mit dem Ziel als Titel). Der Kern-Lint (`kern/wiki-pfade.mjs`) prüft Wiki-Dateinamen und bleibt davon getrennt.
- `Ressourcen/gemeinsam/kurzformen.mjs`: Kurzformen („morgen“, „@freitag“, „!hoch“) für Board, „Schnell merken“ (als Aufgabe) und `brain_aufgabe_anlegen`.
  Das Erfassen-Fenster hat dieselbe Logik in Swift (`Kurzformen.swift`); beide Tests lesen `Tests/Gemeinsam/kurzformen-faelle.json` — eine Regel ändert man dort und in beiden Implementierungen.
- `Ressourcen/gemeinsam/zeit.mjs`: „heute“ ist überall ein Kalendertag in der **Zeitzone des Macs**; Berlin steht nur in den Tests (`Tests/Node/hilfe.mjs`, `Tests/Oberflaeche/playwright.config.mjs`, `Tests/Kern/run-all.sh` setzen `TZ=Europe/Berlin`).
  Funktionen nehmen optional `zone` (eingespritzt); Tests zur Zeitzone selbst: `Tests/Node/zeit.test.mjs`.
- Symbole: `Ressourcen/studio/symbole.js` ist ERZEUGT aus Lucide (`lucide-static`, exakt gepinnt in `Werkzeuge/symbole/package.json`; dort `npm ci`). Namen und Zuordnung (Kortex-Name → Lucide-Name) stehen in `scripts/erzeuge-symbole.mjs`; nach jeder Änderung `node scripts/erzeuge-symbole.mjs` (Test: `--pruefen`, `Tests/Node/symbole.test.mjs`). Strich 1,5 px bis 16 px, 1,75 px ab 18 px; `symbol(name, größe, { farbe })` kann einfärben. Neue Lucide-Version: Pin ändern, neu erzeugen, THIRD-PARTY-NOTICES.md anpassen.
- App-Symbole (wählbares Dock-Symbol): `scripts/erzeuge-app-symbole.mjs` erzeugt aus `icon-entwuerfe/kortex-3-windung(-klein).svg` je Palette (Dunkel, Graphit, Papier, Smaragd) SVGs (`icon-entwuerfe/varianten/`), `Ressourcen/AppSymbole/<name>.icns` (mit eigener 16/32-px-Fassung) und 128-px-Kacheln fürs Studio (`studio/app-symbole/`); `baue-icon.sh` ruft es mit auf, Test: `--pruefen`, `Tests/Node/app-symbole.test.mjs`. Die Wahl steht als `appSymbol` in `einstellungen.json`; die App liest sie beim Start und setzt `NSApp.applicationIconImage` (Brücken-Aktion `app-symbol` für sofortige Wirkung, `AppSymbol.swift`); nie `NSWorkspace.setIcon` (Signatur/Sparkle).
- `Ressourcen/gemeinsam/vorlagen.mjs`: Vorlagen und Tagesnotiz — Platzhalter (`{{titel}}`, `{{datum}}`, `{{datum:FORMAT}}`, `{{zeit}}`, `{{cursor}}`), Datumsformate (`JJJJ MM TT MMMM WWWW KW HH mm`, Text in `[…]` bleibt),
  Kopf (Frontmatter) bleibt oben und gültig, Cursor-Position, Titel einer Notiz (`titelAusText`) und der Pfad der Tagesnotiz (`tagesnotizPfad`, Gegenprobe `tagesnotizDatum`). Einstellungen (App-weit, `einstellungen.json`): `vorlagenOrdner` (Vorlagen),
  `tagesnotizOrdner` (Tagebuch), `tagesnotizFormat` (JJJJ-MM-TT), `tagesnotizVorlage` (leer = „Tagesnotiz“, wenn es sie gibt). Tests: `Tests/Node/vorlagen.test.mjs`, `Tests/Oberflaeche/schreiben.spec.mjs`.
- Das Studio lädt nur aus seinem Ordner: `node scripts/erzeuge-gemeinsam-kopien.mjs` schreibt `Ressourcen/studio/{zeit,wikilink,kurzformen,vorlagen}.js` neu (Test: `--pruefen`). Nach jeder Änderung an einer Quelle ausführen.

## Darstellung (Farbschemata, Akzent, Dichte, Schrift, Größe)
Alles Aussehen kommt aus den App-Einstellungen (`einstellungen.json`, Schlüssel `erscheinung`, `schemaHell`, `schemaDunkel`, `akzent`, `dichte`, `editorSchrift`, `schriftgroesse` 12–22, `oberflaeche` 90/100/110/125, `zeilenbreite`, `codeSchrift`, `symbole`, `seitenleisteDurchscheinend`, `bewegung`; Schema und Prüfung: `gemeinsam/app-einstellungen.mjs`, ältere Schreibweisen übernimmt `migriere`) und gilt sofort im ganzen Studio, auch bei Änderungen von außen (Ereignis `einstellungen`).
- **Logik an EINER Stelle:** `studio/darstellung.js` (rein, keine Nebenwirkung beim Import): Listen und Werte aus dem freigegebenen Prototyp (Akzente mit Hell/Dunkel-Wert, Dichte-Stufen, Breiten, Schriften), `berechne(werte, {systemDunkel, mac})` → Palette (`hell-papier` …), Variablen und Attribute, `wendeDarstellungAn` setzt sie am `<html>`. `app.js#wendeDarstellung` ruft es bei jeder Änderung und bei Wechsel des Systems (Hell/Dunkel); der Browserspeicher (`brain-studio.darstellung`) hält nur den letzten Stand für die erste Zeichnung. Die alte Wahl im Browserspeicher (`theme`, `breit`) wandert einmal in die Datei (`migriereAlteWahl`).
- **Farbschemata:** `schemata.css` (`[data-pal="hell-papier"]` usw., erzeugt aus den Prototyp-Werten; dieselben Blöcke färben die Mini-Fenster der Einstellungen). Flächen und Texte sind Tokens (`--papier`, `--seite`, `--text-2` …), Akzent setzt `darstellung.js` als `--akzent`/`--akzent-text` (schwarz oder weiß, je nach Kontrast), abgeleitete Töne (`--akzent-weich`, `--akzent-tinte` …) stehen im Schema-Block. `data-theme` (`light`/`dark`/ohne) bleibt für „Hell/Dunkel/Wie System“ erhalten. Neue Farben immer als Token, nie als `light-dark()` in neuen Regeln.
- **Kontrast:** `Tests/Oberflaeche/darstellung.spec.mjs` prüft jedes Schema × jeden Akzent (7 × 9): Text, Zweittext, Akzent als Text, Akzenttinte, Text auf Akzent ≥ 4,5:1, Drittext ≥ 3:1, in „Kontrast hoch“ Feldrand und Linien ≥ 3:1. Dafür sind Blau, Violett, Rosa, Rot, Orange, Bernstein und Grün in Hell minimal dunkler als im Prototyp (Seitenfläche von „Papier“), Papier-Zweittext `#73685a`.
- **Größe der Oberfläche:** `zoom` am `body`; `app.js#passeFlaeche` setzt feste Maße (`--ui-breite/-hoehe`), weil Prozentwerte unter `zoom` nicht in jeder Engine gleich aufgelöst werden. `vw`/`vh` gibt es nur als `--vw`/`--vh` (durch den Zoom geteilt). Dichte: `--zeile`, `--innen`, `--ed-zeilenabstand`.
- **Steuerungen:** `bausteine.js#schieber` (Regler ohne natives Feld), Karten, Farbkreise und Vorschau in `einstellungen-darstellung.js` (+ `darstellung.css`); Zeilen im Register `texte-einstellungen.js` (Arten `erscheinung`, `schemata`, `akzent`, `schriftWahl`, `codeWahl`, `groesse`, `dichte`, `oberflaeche`, `zeilenbreite`, `symbole2`). Die Zeile „Durchscheinende Seitenleiste“ (`nurGlas`) erscheint nur, wenn die Hülle `data-glas-moeglich` am `<html>` setzt.
- **Durchscheinende Seitenleiste:** Hüllen-Aktion `fenster-durchscheinend` (Wert `true|false`, Antwort `{ok:true, wirkt}` oder `{ok:false, grund:"nicht-verfuegbar"}`; Browser: `browser-vorschau`). Swift setzt `data-glas-moeglich` (Material `NSVisualEffectView` hinter der durchsichtigen WebView) und `data-glas` je nach Einstellung `seitenleisteDurchscheinend` (`SeitenleisteGlas`); eine Electron-Hülle setzt dieselben Attribute und Aktion.
- **Symbole farbig:** `html[data-symbole="farbig"]` färbt die Symbole der Seitenleiste und der Einstellungen als Kacheln (Farben je Bereich in `darstellung.css`); Standard einfarbig.
- Tests: `Tests/Node/darstellung.test.mjs`, `Tests/Oberflaeche/darstellung.spec.mjs` (Kontrast), `darstellung-bedienung.spec.mjs` (jedes Schema, Akzent, Dichte, Schrift, Größe, Breite, Symbole, Zurücksetzen, Änderung von außen, Migration, Fähigkeit „durchscheinend“, Bilder hell/dunkel bei 1440 und 900 px).

## Schreiben im Alltag (Studio)
- **Neue Notiz (⌘N)** ist ein Entwurf ohne Datei (`S.entwurf`, `S.pfad` leer): `# ` mit dem Cursor in der Titelzeile. Die Datei entsteht erst, wenn etwas drinsteht (`festigeEntwurf` in `app.js`; `POST /api/neu` mit `inhalt`,
  Name aus dem Titel im Posteingang, Namensgleichheit `-2`); beim Tippen wartet eine leere Titelzeile auf ihren Titel (2,5 s), beim Verlassen/Beenden nimmt Kortex die erste Zeile, nach 20 s Ruhe wird gesichert. Leer verlassen = keine Datei.
- **Tagesnotiz** (⇧⌘D, „Heute“): `Tagebuch/JJJJ-MM-TT.md`; „Heute“ legt die Datei gleich an, Tageswechsel (‹ ›, Kalender mit Punkten) öffnet bei fehlender Notiz einen Entwurf auf dem festen Pfad. „Heute“ zählt in der Zeitzone des Macs (`zeit.mjs`).
- **Vorlagen** (⌥⌘N): Notizen im Vorlagenordner; Wahl mit Suche und Vorschau (`schreiben.js`). Der Ordner zählt wie `01_vorlagen` nicht als Notizen (`bereich: "vorlage"`); nur neue Vaults bekommen drei Beispiele (`gemeinsam/vorlage.mjs`).
- **Zurück/Vor** (⌥⌘← ⌥⌘→; ⌘[ und ⌘] sind absichtlich frei: im Editor gehören sie zum Einrücken, auf der deutschen Tastatur liegen sie auf ⌘Ü/⌘+; Maustasten 4/5, Zwei-Finger-Wischen, Knöpfe mit Rechtsklick-Liste): Modell in `studio/seitenverlauf.js` (Cursor + Scroll je Eintrag, tote Einträge fallen lautlos weg). Pfadänderungen melden andere Teile mit
  `window.studio.schreiben.umbenannt(alt, neu)`, `.ordnerUmbenannt(alt, neu)` und `.entfernt(pfad)`.
- **Zusammenspiel mit Umbenennen (#95) und Entwurfs-Journal (#93):** `dateiaktionen.js#pfadGeaendert` meldet jede Pfadänderung (eigene Aktion, Rückgängig, Live-Ereignis anderer Fenster/KI) an `schreiben.umbenannt/ordnerUmbenannt/entfernt`, an `S.entwurf` (fester Pfad der Tagesnotiz, Ordner) und über `POST /api/entwurf/verschieben` an das Journal (Entwürfe ziehen mit, Zeit wird erneuert). Entwürfe neuer Notizen ohne Datei liegen im Journal unter `entwurf:<Kennung>` mit `meta` (Pfad, Ordner, Tag); nach einem Absturz bietet der Start „Wiederherstellen“ an, Anlegen der Datei löscht den Eintrag. Geschützt sind Posteingang, Aufgaben, Wiki, Archiv und der Vorlagenordner des Vaults (`ordner.vorlagen`); der Ordner der Tagesnotizen ist nicht fest: Kortex fragt vor Umbenennen/Verschieben/Löschen einmal nach und zieht die Einstellung `tagesnotizOrdner` mit. Tests: `Tests/Node/schreiben-integration.test.mjs`, `Tests/Oberflaeche/schreiben-integration.spec.mjs`.
- Neue Menübefehle der App (`StudioBefehl`): `heute`, `vorlage`, `zurueck`, `vor`; Kürzel im Register (`tastenkuerzel-register.json`), Test `schreibenImAlltagHatMenueUndKuerzel`.

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
  „Frag deinen Vault“ bekommt vom `claude`-Platzhalter eine gekennzeichnete Beispielantwort („Vorschau: So würde eine Antwort aussehen …") mit zwei echten Seiten des Vorschau-Vaults;
  dafür gibt die Werkstatt `KORTEX_VORSCHAU` (nur diese Variable, nur wenn die Marke `.kortex-vorschau` im Ordner liegt und HOME darin) an den Frag-Prozess weiter. Scheitert die Frage dort trotzdem,
  steht „In der Vorschau antwortet ein Platzhalter statt Claude Code“ statt eines internen Fehlers da.
- `--neu-bauen`: Build erzwingen (sonst wird nur gebaut, wenn `build/Kortex.app` fehlt oder der Quelltext neuer ist). Weitere Schalter gehen an die App.

Das Skript legt `$TMPDIR/kortex-vorschau-XXXX` an, startet eine Kopie der App unter eigener Kennung `io.github.fbrogno.brain.vorschau`
(eigene Einstellungen, eigener Web-Speicher, Sparkle aus) mit `--vorschau <Ordner>` und löscht Ordner und Spuren der Kennung nach dem Ende
(Beenden, Strg-C, Schließen des Terminals). Die Einrichtung „Kortex einrichten“ erscheint wie bei einem frischen Nutzer, als Overlay im Studio (siehe „Ein Fenster“);
ein Band „Vorschau — nichts wird gespeichert“ steht in jedem Fenster und im Menü.

Was umgeleitet ist (`VorschauModus`, Swift; `KORTEX_VORSCHAU`, Node):
- Application Support → `<Ordner>/support`. HOME, `CFFIXED_USER_HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` aller Kindprozesse → `<Ordner>/home` bzw. `tmp`.
- git: `GIT_CONFIG_GLOBAL=<home>/.gitconfig`, `GIT_CONFIG_NOSYSTEM=1`; ssh ohne `~/.ssh`, Schlüssel und Agent (`GIT_SSH_COMMAND`).
- GitHub-Token: Helper `store --file=<home>/.git-credentials` statt Schlüsselbund; die Swift-Seite greift nie auf den Schlüsselbund zu.
- PATH: `<Ordner>/bin` plus Systemordner, nie Homebrew oder `/usr/local`. KI-Suche nur dort und im Vorschau-Home.
- Vaults (anlegen, öffnen, klonen) nur innerhalb des Ordners — auch ein im Dialog gewählter Ordner außerhalb wird abgelehnt.
- Kein Sparkle, keine Login-Shell (`TerminalNode`), keine LaunchAgents, keine Login-Items.
- Fail-closed: ungültiger Ordner, HOME nicht umgelenkt oder echte Bundle-ID → die App beendet sich (Exit 2), die Werkstatt ebenso.

Tests: `swift test --filter Vorschau` (Pfade, Umgebung, Platzhalter, Ende-zu-Ende mit echter Werkstatt und einem zweiten Temp-Ordner als
„echtes“ HOME), `Tests/Node/vorschau.test.mjs`, `Tests/Node/vorschau-frage.test.mjs`, `Tests/Oberflaeche/vorschau-frage.spec.mjs`, `scripts/teste-vorschau.sh` (Skript, Signale, Aufräumen) und
`scripts/teste-vorschau.sh --app` (echte App; prüft nur lesend, dass im echten Benutzerordner nichts neu oder anders ist).
Wer weitere Orte einführt (neue Ordner unter `~`, Keychain, LaunchAgents), muss sie hier umlenken oder in der Vorschau abschalten.

## Ein Fenster: die Einrichtung ist ein Overlay im Studio
Das Studio ist das einzige Hauptfenster, vom ersten Start an (Plan: `docs/plaene/einrichtung-und-konten-wie-orca.md`, Paket E1). „Kortex einrichten“ ist kein eigenes `NSWindow` mehr, sondern `#einrichtung-host` im Studio
(`studio/einrichtung.js`, Anbindung in `studio/einrichtung-studio.js`): Der Rest des Studios ist dahinter `inert` und abgedunkelt, ein Zieh-Streifen (32 px) greift das Fenster.
- Öffnen: Menü „Kortex einrichten …“ (⌘E), Karte „Noch kein Vault“, Seitenleiste und Aktion `einrichtung-oeffnen` gehen alle über `AppZustand.zeigeAssistent`; die App holt das Studio nach vorn (öffnet es, wenn es zu ist) und schickt den
  Befehl `StudioBefehl.einrichtung(ab:weg:)` (`window.studio.befehl('einrichtung', {ab, weg})`, beide Werte aus festen Listen). Beim ersten Start entscheidet `EinrichtungsStart.entscheide` (nie ein Assistentenfenster).
- Rechte: `git-pruefen`, `git-installieren`, `kopieren`, `einrichtung-schritt` und `einrichtung-ende` gelten nur, solange das Overlay offen UND von der SEITE bestätigt ist (`EinrichtungsSitzung.bestaetigt`; `extern` öffnet dann nur GitHub).
  Ablauf: Die App fordert an (Befehl `einrichtung`), die Seite zeigt das Overlay und meldet `einrichtung-sitzung {offen:true}`; jede neu geladene Seite meldet `{offen:false}` (`einrichtung-studio.js`), ein Neuladen lässt die Rechte also nie offen stehen
  (war das Overlay bestätigt, endet der Lauf ohne Wahl und macht beim nächsten Start weiter). **Das ist keine Sicherheitsgrenze:** die Seite bestätigt sich selbst, Code im Studio könnte `einrichtung-sitzung` ebenfalls senden, sobald ein Lauf angefordert ist.
  Die Sitzung verhindert Versehen und hält die Rechte klein (fünf Aktionen, `extern` nur GitHub und die Anmelde-Domänen); gegen Code im Studio schützen lokale Seite und CSP. Die Sitzung endet sonst mit `einrichtung-ende` oder wenn das Studio zugeht.
- Ende: Das Overlay geht zu, das Studio lädt den Vault in der Seite (`ladeAlles`; offene Eingaben werden vor dem Öffnen gesichert), das Zeichen wandert in die Seitenleiste (280 ms, bei reduzierter Bewegung sofort), Hinweis „Dein Vault ist bereit“.
  „Später“/Esc → Rückfrage „Einrichtung überspringen?“ (400 ms Sperre und `e.repeat`-Schutz gegen gehaltene Tasten) legt NICHTS an; ohne Vault zeigt das Studio den leeren Zustand („Neuer Vault“ · „Ordner öffnen“).
- Start-Hinweise der App (Ordner „Brain“ umbenannt, Laufzeit unvollständig) sind Banner im Studio (`window.studio.hinweis`, `#hinweis-host`), keine Systemdialoge. Systemdialoge (`NSAlert`) bleiben nur für „Kern nicht bereit“ beim Öffnen der Rückfragen und
  „Änderungen nicht gespeichert“ beim Schließen (beide nicht auf dem Weg der Einrichtung).
- Ablauf (Paket E2): drei Schritte **Vault · KI · Sicherung**, der Kopf über Schritt 1 ist das Willkommen (kein eigener Schritt, kein „Fertig“-Bild; das Ende ist das Schließen des Overlays). `einrichtung.js` hält Kopf, Pillen, Fußleiste, Reihenfolge, Tastatur
  und git (still geprüft, eine Karte nur bei Mangel); die Schritte sind `einrichtung-vault.js` (Neuer Vault mit Vorgabe ~/Kortex und eigenem Ort-Menü, „Andere Wege“: Ordner öffnen, Von GitHub holen mit geprüftem Feld, Beispiel; Zeile „Diesem Ordner vertrauen“, Vorgabe aus,
  ersetzt die Frage nach der Einrichtung), `einrichtung-ki.js` (Liste der gefundenen Programme, je Zeile „Verbinden“; Konto-Auswahl nur bei mehr als einem Konto; Zugriff „Posteingang“ mit „Ändern“; stille Prüfung als Haken; Zeile „Kontingent in Kortex anzeigen“, Vorgabe an)
  und `einrichtung-sicherung.js` (GitHub-Gerätecode im Overlay oder „Nur auf diesem Mac“). Erfüllte Schritte entfallen von selbst: KI, wenn für diesen Vault schon ein Konto verbunden ist und Zugriff hat; Sicherung, wenn ein Remote da ist oder der Vault von GitHub kam;
  ein von der Hülle ausdrücklich verlangter Schritt (`ab`) bleibt immer. **Haken für Paket E3:** `einrichtung-anmeldung.js` (`starteAnmeldung(programm, konto, …)`) ist die einzige Stelle, an der das Anmelden im Overlay ersetzt wird; heute die bestehende Anmeldung über das Terminal.
  Fortsetzen: Die Seite meldet jeden erledigten Schritt (`einrichtung-schritt`), die App schreibt ihn als `letzterSchritt` in `einrichtung.json` (Fassung 2 mit `ablaufVersion`; Dateien des alten Ablaufs rechnet `EinrichtungsDatei.umgerechnet()` beim Lesen um) und schickt das Overlay beim
  nächsten Öffnen mit `ab` dorthin, wo es weitergeht (`EinrichtungsOverlay.einstieg`). „Später“ (links unten, leise) fragt nach und legt nichts an.
  Danach zeigt die Seitenleiste die Checkliste „Einrichtung n/4“ mit Ring (`einrichtung-liste.js`: KI verbinden, Sicherung, Kontingent anzeigen, Mitteilungen; eingeklappt, ausblendbar mit „Rückgängig“; sie erscheint erst nach einer Einrichtung auf diesem Gerät, Zustände nur lesend aus der Wirklichkeit).
- Hüllen-Vertrag: `Ressourcen/studio/huellen-vertrag.json` beschreibt in EINER Datei alles, was das Studio von der Hülle braucht (Aktion, Wert, Antwort, Rechte „nur bei offenem Overlay“, dazu die Befehle `einrichtung` und `hinweis`).
  Das Studio ruft nur diese Aktionen auf; Swift implementiert sie, eine spätere Electron-Hülle (Windows/Linux) dieselben. Test: `Tests/Node/huellen-vertrag.test.mjs` (Studio-Aufrufe, Swift-Namen und Rechte gegen die Liste).
- Tests: `Tests/Oberflaeche/ein-fenster.spec.mjs` und `einrichtung.spec.mjs` (Attrappe der App: `mocks-einrichtung.mjs`, `oeffneEinrichtungImStudio`; je Weg, mit/ohne git, mit/ohne KI, Remote, Fortsetzen nach Neuladen, Später, Checkliste), `Tests/BrainCoreTests/EinrichtungsFensterTests.swift` (Startentscheidung, Rechte, Sitzung, Befehl),
  `Tests/BrainCoreTests/EinrichtungsZustandTests.swift` (`einrichtung.json`, Umrechnung alter Dateien),
  `scripts/rauchtest.sh` Phase E und `scripts/teste-vorschau.sh --app` (genau ein `fenster-auf studio` im Log, nie `fenster-auf einrichtung`).

## Kontingent wie Orca (Paket E5)
Quelle bleibt die Statuszeilen-Kette von Claude Code und die Abfrage von Codex am eigenen App-Server: Kortex ruft nie einen Anbieter an und liest keine Zugangsdaten. Alle Regeln sind reine Funktionen ohne Uhr und Dateien (Logik in Node/Studio, nicht in Swift):
- `gemeinsam/kontingent-regeln.mjs` (Studio-Kopie `studio/kontingent-regeln.js`, `node scripts/erzeuge-gemeinsam-kopien.mjs`): **Takt** (`planeAbfrage`: nur bei sichtbarem Fenster, Aktivieren frischt ab 5 Minuten auf, sonst 15 Minuten, „Auffrischen“ frühestens nach 5 Minuten, Fehlerpause 30 s bis 15 min, nach 8 Fehlern in Folge Pause bis zum Klick, `Retry-After` bindet bis 24 Stunden, `leseRetryAfter`), **Dichte-Leiter** (`waehleDichte`, `waehleSichtbare`), **ruhig veraltet** (`warnzeichenNoetig`: Warnzeichen nur bei gescheitertem Abruf UND Wert über 30 Minuten, sonst grau „Stand vor N Min“ ab 10 Minuten), **verbraucht/übrig** (`angezeigtProzent`) und **Schwellen** (`planeSchwellen`: 80 % und 100 % je Fenster und Konto höchstens einmal, Rücksetzzeiten ±60 s sind dasselbe Fenster).
- **Monotone Regel** in `gemeinsam/kortex-statuszeile.mjs` (`istVeraltetesFenster`, `uebernimmMonoton`; eigenständig, weil das Skript nach `<Support>/kontingent/bin/` kopiert wird): im selben Fenster steigt der Verbrauch nur, der Stand einer ruhenden Sitzung wird beim Schreiben verworfen; dieselbe Regel gilt für Codex in `werkstatt/kontingent.mjs`.
- **Sichtbarkeit**: Die Seite fragt nur, solange `document.visibilityState` nicht „hidden“ ist (`studio/kontingent.js`, kein Eintrag im Hüllen-Vertrag nötig); beim Sichtbarwerden geht `GET /api/ki/kontingent?aktiviert=1` an die Werkstatt, die Codex nur bei einem Stand über 5 Minuten neu fragt.
- **Statusleiste** (`studio/kontingent.js#erzeugeKontoLeiste`): ein Knopf mit einem Eintrag je Claude-/Codex-Konto; fünf Stufen (voll → kompakt → knappstes Fenster → „+N“ → Symbol), gewählt an der **gemessenen** Breite (unsichtbare Messkopien je Stufe neben dem Knopf, Platz = Knopf + freie Fläche rechts − was andere Teile schon kürzen müssten). Konten, die erst eingerichtet werden müssen, stehen nur im Popover und in den Einstellungen. Rechtsklick auf die Leiste: Kontingent je Konto, Wörter, Format (App-Einstellungen `kiKontingentStatusleiste`, `statusWoerter`, `statusFormat`).
- **Popover „Kontingent“**: alle Konten nach Programm, 5 Std und Woche mit Rücksetzzeit, Auffrischen, „Konten verwalten …“ (Einstellungen → KI & Konten → Konten), Wahl Verbraucht/Übrig (`kiKontingentAnzeige`; auch im Unterbereich „Kontingent“ mit den Schaltern für Statusleiste und Mitteilung).
- **Mitteilung bei 80 % und 100 %**: Node entscheidet (`werkstatt/kontingent.mjs#meldeSchwellen`, Stand in `<Support>/kontingent/mitteilungen.json`, zuerst gemerkt, dann gemeldet) und schreibt ein Ereignis der Art `kontingent` (Grund `5h-80`, `5h-100`, `woche-80`, `woche-100`) ins Aktivitätsprotokoll des offenen Vaults. Der bestehende `MitteilungsPlaner` (Swift) stellt es zu: Schalter `mitteilungenKontingent`, nur wenn Kortex nicht vorne ist (`mitteilungenNurImHintergrund`), feste Sätze je Grund, dazu die **5-s-Sperre je Schlüssel** für alle Arten. Entsteht die Überschreitung, während Kortex vorne ist, bleibt es bei der Anzeige in der Leiste (das Ereignis ist dann verbraucht).
  Die Claude-Werte sind lokale Dateien (kein Aufruf beim Anbieter): die Werkstatt prüft deren Schwellen selbst im 60-s-Takt (`kontingent.mjs#starteWache`/`pruefeClaudeSchwellen`, unabhängig davon, ob das Studio sichtbar ist); „nur bei sichtbarem Fenster“ gilt allein für Codex (app-server). Node merkt jede Schwelle als gemeldet, die App entscheidet über die Zustellung: ist Kortex vorne, kommt keine Systemmitteilung, dafür zeigt das Studio die Karte (Toast) — der Nutzer sieht sie also einmal. Ohne Rücksetzzeit gilt das zuletzt bekannte Fenster.
- Tests: `Tests/Node/kontingent-regeln.test.mjs` (alle Regeln, Schreibweg, Codex, Ereignis), `Tests/Node/einstellungen-route.test.mjs` (neue Schlüssel), `Tests/BrainCoreTests/MitteilungenTests.swift` (Art `kontingent`, Sperre), `Tests/Oberflaeche/kontingent-leiste.spec.mjs` (Dichte bei 1440/1180/960/800 px und im Durchlauf, Popover, Rechtsklick-Menü, ruhig veraltet/Warnzeichen, Takt, Unterbereich; hell und dunkel).

## Anmelden im Fenster (Paket E3)
Claude Code und Codex melden sich im Studio an, ohne Terminalfenster. Die Logik liegt in Node (nicht in Swift), damit eine spätere Electron-Hülle sie unverändert nutzt; die Hülle öffnet nur die Adresse (Aktion `extern`).
- `gemeinsam/anmeldung.mjs`: Kindprozess mit **explizit gebauter Umgebung** (`anmeldeUmgebung`: nur `CLAUDE_CONFIG_DIR` bzw. `CODEX_HOME` des Kontos, alle `XDG_*`, `GIT_*`, `CLAUDE*`, `ANTHROPIC_*`, `CODEX_*`, `OPENAI_*`, `CURSOR_*`, `GEMINI_*`, `NODE_*`, `BRAIN_*`, `KORTEX_*` entfernt; Standardkonto = keine Variable),
  eigene Prozessgruppe (`beendeBaum`, gleicher Name wie in `gemeinsam/plattform.mjs` aus W0 — nach dem Merge von W0 von dort importieren), Fristen (Claude 10 min gesamt, 30 s bis zur Adresse; Codex 3 min bis Adresse+Code, dann 15 min Gerätecode).
  Claude: `claude auth login`, `BROWSER` = Kortex-Skript (Temp-Ordner 0700), das nur die Adresse in eine Datei schreibt; stdin bleibt offen für einen eingefügten Code. Codex: `codex login --device-auth`, Adresse und Code nach Orcas Muster.
  Fertig = Exit 0 **und** `claude auth status` / `codex login status` mit Exit 0 (nur der Exit-Code; die Ausgabe der Programme wird nie gelesen). **Kortex liest nur Adresse (https, feste Hosts) und Gerätecode; nichts anderes wird gespeichert, gesendet oder protokolliert.**
- `werkstatt/anmelden.mjs` + Routen: `POST /api/ki/anmeldelauf {programm, konto|neu}` → `{id, phase, url, code, codeMoeglich, verbleibendMs, grund, rueckfall}`, `GET /api/ki/anmeldelauf?id=` (Abfrage), `POST …/code {id, code}`, `POST …/abbrechen {id}`.
  Phasen `start | wait | ok | timeout | error | abgebrochen`. Nur claude/codex, nur bekannte Konten oder ein neuer Name; eine Anmeldung je Konto (409 `laeuft-schon`), höchstens 4 gleichzeitig, 8 Starts je Minute (429). In der App laufen die Routen nur über die Brücke des Studios (kein Netzwerk-Socket).
- Neues Konto (Schnittstelle von E4): `konten.legeKontoAn` (`/api/ki/konto-neu`) legt den Ordner gleich unter dem ENDGÜLTIGEN Namen an (Konto „ausstehend“); die Anmeldung läuft immer mit genau diesem Pfad (der Schlüsselbund-Eintrag von Claude Code hängt vermutlich am Pfad), nie wird umbenannt. Nach bestätigter Anmeldung `konten.kontoFertig` (`/api/ki/konto-fertig`); Abbruch, Frist, Fehler und Ende der Werkstatt rufen `konten.kontoAbbruch`. Ein ausstehendes Konto erscheint nirgends, bis `kontoFertig` die Marke entfernt; E4 räumt Liegengebliebenes nach 30 min und beim Start auf.
- Studio: `studio/anmeldung.js` — `starteAnmeldung(programm, konto | { neu: Name }, { host, ordner, beiFertig, beiTerminal, terminal })` → `{ knoten, ergebnis, abbrechen, zerstoere }`. „Im Browser anmelden“, „Link kopieren“, bei Claude „Code einfügen“, bei Codex der Gerätecode, leiser Countdown;
  der leise Link „Im Terminal anmelden“ (bisheriger Weg) ist immer da und wird bei Fehler/keiner Adresse hervorgehoben. `EinrichtungsOverlay.externErlaubt` lässt bei offener Einrichtung neben GitHub die Anmelde-Domänen zu (`claude.ai`, `claude.com`, `anthropic.com`, `openai.com`, `chatgpt.com`).
- Tests: `Tests/Node/anmelden.test.mjs` (Platzhalter `claude`/`codex` in `anmelden-hilfe.mjs`, brechen außerhalb von Temp ab; nie ein echtes Programm), `Tests/Oberflaeche/anmeldung.spec.mjs` (hell/dunkel).
  Nicht mit dem echten Programm geprüft (bewusst keine echten Logins): ob `claude auth login` die Adresse wirklich über `BROWSER` meldet und wie die Ausgabe heutiger Versionen aussieht — bei Abweichung greift der Rückfall (Terminal).

## Kortex im Browser (Vorschau für Windows/Linux, Paket W1)
Der Handler der App als lokaler Dienst plus eine Browser-Hülle, bis die Electron-Hülle (W2) da ist. Start: `node Ressourcen/werkstatt/start.mjs [--vault <Ordner>] [--port <n>] [--nicht-oeffnen] [--beenden]` oder `kortex.sh` / `kortex.cmd` im Repo-Wurzelordner. Anders als `entwicklung.mjs` (nur Entwicklung/Tests, ohne Token) ist dieser Dienst für Benutzer gedacht.
- **Dateien:** `werkstatt/start.mjs` (Befehl, eine Instanz, Browser öffnen), `browser-dienst.mjs` (HTTP-Dienst), `browser-zugang.mjs` (Token/Cookie/Host/Origin, reine Logik), `browser-sperre.mjs` (Sperrdatei), `browser-ordner.mjs` (Ordner, Einrichtungsstand, git-Prüfung), Studio: `huelle-browser.js` (+ `huelle-browser-ordner.js`, `texte-browser.js`, `huelle-browser.css`). Browser öffnen: `plattform.mjs` `oeffneImBrowser` (macOS `open`, Windows `rundll32 url.dll,FileProtocolHandler` statt `cmd /c start` wegen `&` in Adressen, Linux `xdg-open`, Rückfall `gio open`; `KORTEX_BROWSER` wählt einen Browser; nur `http://127.0.0.1:<port>/…`, nie über eine Shell).
- **Zugang:** je Start ein zufälliges Geheimnis, nur in `<Support>/browser-dienst.json` (0600). Damit holt der Startbefehl eine **Einlass-Karte** (`POST /_kortex/einlass`, Bearer): zufällig, einmal gültig, 2 min. Der Browser öffnet `/?t=<Karte>`; der Dienst setzt `kortex_s_<port>=<Sitzung>; HttpOnly; SameSite=Strict; Path=/` (Port im Namen, Cookies sind nicht an Ports gebunden) und leitet auf `/` um. Ohne Cookie antwortet jede Anfrage (Studio, Statik, API) mit 401 und einer Hinweisseite. Geheimnis, Karte und Sitzung stehen in keiner Ausgabe und keinem Log.
- **Prüfungen je Anfrage:** Host nur `127.0.0.1:<port>`/`localhost:<port>` (DNS-Rebinding), `Sec-Fetch-Site` nur `same-origin`/`none` (ein anderer lokaler Port ist `same-site` und wird abgelehnt), `Origin` falls vorhanden gleich der eigenen Herkunft, schreibende Methoden **nur mit eigenem Origin** und JSON, `OPTIONS` und unbekannte Methoden 405, nie ein `Access-Control-*`-Header, `Cross-Origin-Resource-Policy: same-origin`, kein Framing. Der Server bindet nur `127.0.0.1`.
- **Eine Instanz:** `beanspruche` legt die Sperrdatei mit `wx` an (PID + Startzeit gegen PID-Wiederverwendung). Ein zweiter Start findet eine lebende Sperre, holt über das Geheimnis eine Karte und öffnet den Browser auf der laufenden Instanz (`Läuft bereits: <Adresse>`). Verwaiste Sperren werden übernommen; lebt der Prozess, antwortet aber nicht, fasst der Start nichts an.
- **Browser-Hülle** (`window.kortexHuelle`, nur vom Dienst in `index.html` eingefügt; `api.js`: `browserModus()`/`mitHuelle()`, `inApp()` bleibt „nativ“): setzt jede Aktion des Hüllen-Vertrags um (Feld `browser` in `huellen-vertrag.json`; Test prüft Vollständigkeit). Ordner wählen: **Dialog mit Pfadfeld, Unterordner-Liste und zuletzt benutzten Ordnern** (`/_kortex/ordner/*`, Prüfung wie am Mac: `breit`, `notizen`, `ordner`, `mehr`), weil `showDirectoryPicker` keinen Pfad liefert. „Zuletzt benutzt“ liegt im Support-Ordner (`browser-zuletzt.json`), nicht im Browser — der Port wechselt bei jedem Start und damit die Herkunft der Seite. Zwischenablage: Clipboard API. Extern: `window.open`, nur https. Mitteilungen: Web Notifications auf Klick. Einrichtung: gleiche Regeln wie die App (`einrichtung-sitzung` nur nach Anforderung, Domänenliste für `extern`), Stand in `browser-einrichtung.json`; beim ersten Start ohne Vault öffnet die Hülle sie selbst (Ereignis `studio-bereit`).
- **Ausgeblendet im Browser-Modus:** Finder-Befehle, Übersicht (Kit-Ansicht), Einstellungen „Dock“ und „macOS-Mitteilungen“, die „Überall“-Marke bei Kürzeln. Die Zeile für den Hintergrunddienst meldet selbst „nicht möglich“ (`nurMac`).
- **Neutrale Wörter im Browser-Modus:** `studio/plattform-texte.js#plattformTexte` umhüllt die Textmodule von Einrichtung und Einstellungen (`texte-einrichtung`, `-einstellungen`, `-ki-einstellungen`, `-konten`, `-ki-verbinden`): im Browser (Hülle da, keine App-Brücke) werden „Mac“, „Finder“, „Apple“, „macOS“ ersetzt („Im Dateimanager zeigen“, „diesem Rechner“); die App bekommt dieselben Objekte unverändert. Neue Texte mit diesen Wörtern stehen in diesen Modulen, nicht im Code. Test: `Tests/Node/browser-texte.test.mjs`.
- **Routen der Hülle:** was Swift statt der Werkstatt beantwortet (`KiRoute.swift`: `/api/ki/programme`, `anmeldestatus`, `anmelden`, `ordner-papierkorb`) steht im Vertrag unter `routen` mit dem Browser-Verhalten (Rückfall in `handler.mjs`); der Vertragstest vergleicht mit dem Swift-Quelltext.
- **Windows:** `prozessStart` (PowerShell) merkt die Startzeit des eigenen Prozesses für immer und die eines fremden 10 s; ein Start je Abfrage ließ `browser-dienst.test.mjs` am Zeitlimit scheitern.
- **Tests:** `Tests/Node/browser-modus.test.mjs` (Zugang, Karten, Cookie, Host/Origin/CSRF/CORS, eine Instanz, Beenden, Portwahl, verwaiste Sperre, Browser-Befehle, Vertrag), `Tests/Oberflaeche/browser-modus.spec.mjs` (gegen den echten Startbefehl: Zugang, Notiz bearbeiten/speichern, Einrichtung mit Ordnerwahl, Einstellungen, Suche, Anmelde-Panel mit Platzhalter-Programmen). Beide laufen im Job `plattform-probe` (Linux und Windows) mit.
- **Karte nie in der Befehlszeile:** der Browser öffnet eine Startdatei `kortex-start-<kennung>.html` (0600, im Support-Ordner, nach 60 s und beim nächsten Start gelöscht), die auf `/?t=<Karte>` weiterleitet — `/proc/<pid>/cmdline` ist unter Linux für jeden Benutzer lesbar (Review-Befund).
- **Bekannte Restrisiken (Review):** Cookies sind nicht an Ports gebunden: ein anderer Server auf `127.0.0.1` bekommt den Sitzungs-Cookie zu sehen, wenn der Browser ihn dorthin sendet (Abhilfe wäre ein zusätzlicher Header aus `sessionStorage` oder ein Zufalls-Hostname `*.localhost`); eine verwaiste Sperre mit wiederverwendeter PID kann den Browser auf einen fremden Port lenken (wenn `prozessStart` leer bleibt); unter Windows blockiert `existsSync` auf getrennten Netzlaufwerken, `prozessStart` (PowerShell) ist langsam, und die Sperre liegt in `%APPDATA%` (Roaming) statt `%LOCALAPPDATA%`.
- **Offen:** Installationsskript mit Node-Download, Dienst über Aufgabenplanung/systemd, Texte ohne „Mac“/„Finder“/„Apple“ in Einrichtung und Einstellungen, Windows-Platzhalter für `claude`/`codex` (die Tests nutzen `#!`-Skripte), Browser-Mitteilungen aus dem Studio heraus.

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

## Nichts geht verloren (Speichern, Absturz, Fassungen)
Datenfluss beim Speichern einer offenen Notiz (`studio/app.js`, `gemeinsam/vault.mjs`, `werkstatt/auto-fassungen.mjs`):
1. Tippen → `S.dirty`; alle 5 s (und beim Verlassen des Fensters) schreibt das Entwurfs-Journal den Text nach `<Support>/entwuerfe/<Vault-Kennung>/<Pfad-Hash>.json` (0600, mit Pfad, Basis-Hash, Zeit). Nach 0,8 s Ruhe: `PUT /api/datei` mit dem Hash vom Öffnen.
2. Erfolg → Journal-Eintrag gelöscht, Basis (`S.basis`) = gespeicherter Text, die Werkstatt merkt „offen“ für die automatische Fassung.
3. 409 (Platte hat sich geändert) oder ein Live-Ereignis bei ungespeicherten Eingaben → `POST /api/datei/zusammenfuehren` mit Basis, meiner Fassung, Basis-Hash. `gemeinsam/merge3.mjs` rechnet zeilenweise (Drei-Wege, byte-treu, „\r“ bleibt Teil der Zeile). Ohne Überschneidung wird geschrieben (Toast mit „Rückgängig“), mit Überschneidung zeigt das Studio die Blöcke (`studio/fremd-ansicht.js`) und schreibt erst nach der Wahl (`auswahl` + `gesehenHash`; hat sich die Platte inzwischen geändert: 409 `art: "erneut"`).
4. **Vor jedem Überschreiben** liegt die fremde Fassung (bei „Andere“/„Zusammenführen“ auch meine) in der Ablage `<Support>/fassungen/<Kennung>/` (`gemeinsam/ablage.mjs`, 0600, 90 Tage, höchstens 300). Gelingt das Ablegen nicht, wird nichts geschrieben. `schreibe` prüft den Hash direkt vor dem Ersetzen noch einmal; ein Rest-Fenster von Mikrosekunden zwischen dieser Prüfung und `rename` bleibt (ohne Dateisperre der anderen Programme nicht zu schließen).
5. Nach 2 min ohne Speichern, bei Fensterwechsel (`blur`) und beim Schließen/Beenden (`vorSchliessen`) legt `auto-fassungen.mjs` einen Commit „Automatisch gesichert: N Notizen“ an: derselbe Weg wie „Sichern“ (`vault.gitCommit`, Hooks nach der bestehenden Regel, Sperre im Prozess), wartet bei laufendem Abgleich/offener Zusammenführung/Umstellung, hält bei einem Fund der Commit-Prüfung an (Mitteilung „sicherung-fehler“, erst wieder nach einer Änderung der Dateien). Nur lokal; Schalter `fassungenAutomatisch` (Standard an), `abgleichAutomatisch` ist nur vorbereitet (Standard aus, ohne Wirkung).
6. Absturz: `webViewWebContentProcessDidTerminate` → `WebAbsturzBehandlung` lädt die Seite mit `?nachAbsturz=1` neu (höchstens 3-mal in 60 s, danach Fehlerseite); das Studio öffnet die letzte Notiz und bietet den Entwurf an, wenn er neuer ist als die Datei. Stirbt die Werkstatt, startet die App sie bei der nächsten Anfrage neu (ein PUT wird nie wiederholt); das Studio zeigt „Speichern gerade nicht möglich“ und speichert in wachsenden Abständen erneut.

Tests: `Tests/Node/nichts-geht-verloren.test.mjs`, `Tests/Oberflaeche/nichts-geht-verloren.spec.mjs`, `Tests/BrainCoreTests/WebProzessSchutzTests.swift`, `WerkstattNeustartTests.swift`.

## Electron-Hülle (Windows/Linux, Paket W2a)
Die Hülle für Windows und Linux, bis W2b/W2c (Tray, Erfassen, Installer, Updates) sie vollständig machen; am Mac läuft weiter die Swift-App. Plan und Stand: `docs/plaene/plattformen-windows-linux.md` §9.
- **Start lokal (ein Befehl):** einmal `npm --prefix electron ci`, dann `npm --prefix electron start -- --vault <Ordner>` (ohne `--vault` gilt der aktive Vault aus `<Support>/vaults.json`, sonst öffnet sich die Einrichtung). Support-Ordner wie sonst: `BRAIN_APP_SUPPORT` lenkt ihn um, Chromium-Daten liegen in `<Support>/electron`. Zum gefahrlosen Ausprobieren `HOME` und `BRAIN_APP_SUPPORT` auf ein Temp-Verzeichnis setzen.
- **Dateien:** `electron/haupt.mjs` (Fenster, Schema `kortex://studio`, Menü, Sicherheit), `preload.cjs` (`window.kortexHuelle`), `aktionen.mjs` (Hüllen-Vertrag, reine Logik), `navigation.mjs`, `bruecke.mjs` (Werkstatt als Kindprozess). Die Werkstatt ist dieselbe `werkstatt.mjs` wie am Mac; es gibt keinen Port und kein Token.
- **Neue Aktion:** Name und Beschreibung (`browser`, `electron`) in `huellen-vertrag.json`, Umsetzung in `electron/aktionen.mjs` (und `huelle-browser.js`, Swift); der Vertragstest schlägt sonst an.
- **Tests:** `node --test Tests/Node/huellen-vertrag.test.mjs Tests/Node/electron-huelle.test.mjs` (ohne Electron) und `npm --prefix electron test` (die echte App, braucht eine Anzeige; unter Linux `xvfb-run -a npm --prefix electron test`, in der CI zusätzlich der Sandbox-Helfer, lokal ohne Helfer `KORTEX_TEST_OHNE_SANDBOX=1`). Der Test baut die Umgebung ausdrücklich (Temp-HOME, eigener Support-Ordner, nie `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_*`, Git-Konfiguration); `KORTEX_BILDER=<Ordner>` legt das Fenster-Foto dorthin.
- **Electron-Version:** in `electron/package.json` exakt festgelegt, nicht neuer als etwa zwei Wochen; Aktualisieren heißt Version ändern, `npm --prefix electron install`, Test laufen lassen.
