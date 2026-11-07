# Kortex auf Windows und Linux: Bestand, Wege, Empfehlung

Stand: 06.11.2026 · Branch `docs/plattformen` · nur Planung, kein Code geändert.

Auftrag des Nutzers: „Die App soll bald auch für Windows und Linux funktionieren.“ Damit fällt die Entscheidung vom 28.10.
(`docs/stand/2026-10-28/stand-abend.md`, `docs/plaene/kern-umzug.md` Z. 6: „Kern plattformneutral, keine Win/Linux-Installer“).
Dieses Papier zählt auf, was heute an macOS hängt, vergleicht die Wege und schlägt eine Reihenfolge vor.

Quellen: dieses Repo @ `origin/main` `2a60a3c` (nur gelesen; Zahlen per `grep`/`wc`), Orca (MIT, Electron) als flacher Klon im Scratchpad, nur gelesen,
nichts gebaut oder ausgeführt (Orca-Angaben über einen Unteragenten, Stichproben siehe §7).

---

## 1. Kurzfassung

- **Das Produkt ist schon zu etwa 90 % plattformneutral.** Studio (77 Dateien), Werkstatt (22), Gemeinsam (39), Kern (201) und MCP sind Node/Vanilla-JS,
  zusammen rund 75 000 Zeilen. Kern-, Node- und Oberflächentests laufen **schon heute auf Linux** (`ci.yml`, `ubuntu-latest`), die Oberflächentests in **Chromium**.
  Der Kern hat aus der Kit-Zeit schon Windows-Zweige (`kern/pfade.mjs:33-37` APPDATA/XDG, `kern/oeffner.mjs:12`, `kern/werkzeug.mjs:10-23` MinGit, 52 `win32`-Stellen).
- **macOS-gebunden ist die Hülle:** Swift, rund 10 100 Zeilen (BrainApp 2 782, BrainCore 7 350) plus 8 559 Zeilen Swift-Tests, dazu Paketierung/Signatur (Sparkle, Notarisierung)
  und etwa 25 Stellen im Node-Code, die macOS-Befehle aufrufen (launchctl, plutil, ioreg, pmset, caffeinate, scutil, osascript, lsof, `ps -o lstart`, Schlüsselbund-Helper).
- Die Brücke Studio ↔ Werkstatt ist ein **einfaches JSON-Zeilenprotokoll über stdin/stdout** (`werkstatt/werkstatt.mjs` Z. 2-8) plus 20 Aktionen
  (`BrainCore/AppAktion.swift`). Jede andere Hülle kann genau diesen Vertrag sprechen.
- **Empfehlung:** Ziel ist **eine Hülle für alle drei Systeme mit Electron** (Weg B). Der Weg dorthin ist billig und umkehrbar: zuerst Windows/Linux in die CI (Paket W0),
  dann „Kortex im Browser“ als Vorschau für Windows/Linux (W1), dann die Electron-Hülle für Windows/Linux (W2), und erst danach, gemessen, der Wechsel am Mac (W3) —
  **vor** dem ersten Stable-Release, weil es bis dahin kein Update-Versprechen gibt (`docs/veroeffentlichen.md` §2) und damit keinen Umzug Sparkle → electron-updater.
- „Bald“ heißt realistisch: **Windows/Linux-Vorschau im Browser 2-3 Wochen nach Start von W0**, **installierbare App mit Updates in etwa 2-3 Monaten**,
  begrenzt durch die Windows-Signatur (Antrag, Wartezeit) und E1-E5, die zuerst fertig werden sollen.

---

## 2. Bestand: was an macOS hängt

Zählweise: ein Eintrag = ein eigener Mechanismus, der auf Windows/Linux ersetzt, nachgebaut oder abgeschaltet werden muss. „Portabel?“ sagt, wie weit der heutige Code trägt.

### 2.1 Fenster, Menüs, Kürzel (7)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| F1 | App-Lebenszyklus, Menüleisten-Symbol (`MenuBarExtra`), Menü „Nach Updates suchen“ | `BrainApp/BrainApp.swift:11,115,207`, `BrainApp/MenueInhalt.swift:13-45` | nein (SwiftUI/AppKit) → Tray + App-Menü |
| F2 | Studio-Fenster, Vollbild, Material hinter der Seitenleiste, Ziehen/Zoomen per Aktion (WKWebView kennt kein `-webkit-app-region`) | `BrainApp/FensterSteuerung.swift:292-334`, `AppAktion.swift` (`fensterZiehen`, `fensterZoom`, `darstellung`), `BrainCore/StudioFenster.swift` | nein; in Electron/Tauri gibt es `app-region: drag` direkt, Aktionen entfallen |
| F3 | Systemdialoge: Ordnerwahl als Sheet, `NSAlert` beim Start | `FensterSteuerung.swift:553,671`, `AppZustand.swift:337` | nein → `dialog.showOpenDialog`; Start-Alerts werden mit E7 ohnehin Banner |
| F4 | Menübefehle und Kürzel des Studios (`StudioBefehl`), Register `tastenkuerzel-register.json` | `MenueInhalt.swift`, `scripts/erzeuge-tastenkuerzel.mjs` | teils: Register ist Daten; Studio hat schon `istMac()` (`studio/tastenkuerzel.js:11`) für ⌘/Strg |
| F5 | „Im Finder zeigen“, Datei öffnen | `AppZustand.swift:510-514,657-661` (`NSWorkspace`) | ja über `shell.showItemInFolder`/`kern/oeffner.mjs` (hat schon `xdg-open`/`rundll32`) |
| F6 | Menüleisten-Symbol als Vorlage-Bild, Systemfarbe | `BrainCore/KortexMenueSymbol.swift`, `KortexFarbe.swift` | nein → Tray-Icon je System (Windows: farbig, Linux: je nach Desktop) |
| F7 | Texte mit ⌘, „Mac“, „Finder“ | 60× `⌘` in `studio/*.js`, 83 Nennungen von Mac/Finder/macOS in `studio/texte*.js` | ja, aber Textarbeit (Plattformwort aus einer Stelle) |

### 2.2 WKWebView-Brücke und Aktionsrechte (8)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| B1 | Schema `brain://` für Seiten und Dateien des Studios | `FensterSteuerung.swift:7,292` (`WKURLSchemeHandler`) | Konzept ja (Electron `protocol.handle`, Tauri Custom Protocol), Code nein |
| B2 | Datenkanal `brain` (Anfrage/Antwort an die Werkstatt) | `FensterSteuerung.swift:65`, `studio/api.js:5-26` | Protokoll ja (`werkstatt.mjs` Z. 2-8), Hülle neu; `api.js` hat schon den fetch-Rückfall |
| B3 | Aktionskanal `aktion` mit 20 Aktionen und Rechten je Herkunft (Studio vs. Übersicht) | `BrainCore/AppAktion.swift`, `FensterSteuerung.swift:98`, `studio/api.js:225-231` | Prüflogik ist reine Logik (Swift) → in der neuen Hülle neu schreiben; Tests `Tests/Aktionskanal/` |
| B4 | Navigationsregel (nur eigene Seiten, extern nur https) | `FensterSteuerung.swift:134`, `BrainCore/NavigationsRegel.swift` | neu (`will-navigate`, `setWindowOpenHandler`) |
| B5 | Absturz des Web-Prozesses → Neuladen mit `?nachAbsturz=1`, höchstens 3× in 60 s | `BrainCore/WebProzessSchutz.swift` | Konzept ja (`render-process-gone`), Code neu |
| B6 | Brücken-Prozess (Node-Kind, Neustart, SIGPIPE-Schutz) | `BrainCore/BrueckenVerbindung.swift` | Protokoll ja, Code neu |
| B7 | Web-Speicher je Bundle-ID unter `~/Library/WebKit/<ID>` | `FensterSteuerung.swift:288`, `StartArgumente.swift:61` | entfällt (Electron `userData`) |
| B8 | Studio-Testlauf in echtem WKWebView | `BrainApp/StudioTestlauf.swift` | neu; Playwright deckt das Studio schon in Chromium ab |

### 2.3 Schnell-Erfassen-Fenster und globales Kürzel (5)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| C1 | Schwebefenster (`NSPanel`, `.floating`, auf allen Spaces) | `BrainApp/ErfassenFenster.swift:7,135,140` | Windows/X11 ja (`alwaysOnTop`), macOS ja (`type: 'panel'`), Wayland eingeschränkt |
| C2 | Fokus zurück an die vorige App, „Bewegung reduzieren“ | `ErfassenFenster.swift:68-101` | teils (Electron gibt Fokus beim Verstecken meist selbst zurück) |
| C3 | Globales Kürzel über Carbon `RegisterEventHotKey` (ohne Bedienungshilfen-Recht) | `BrainCore/Erfassen/KuerzelRegistrierung.swift:25-51`, `KuerzelPruefung.swift`, `KuerzelBelegung.swift` | Windows/X11: `globalShortcut`; **Wayland: nur über das Portal bzw. ein vom Nutzer angelegtes System-Kürzel** |
| C4 | Erfassen-Oberfläche in SwiftUI (`NSTextView`) | `BrainCore/Erfassen/ErfassenAnsicht.swift`, `ErfassenTextfeld.swift`, `ErfassenModell.swift` | nein → kleine Web-Seite im Studio-Stil |
| C5 | Kurzformen doppelt (Swift und JS, gemeinsame Fälle) | `Erfassen/Kurzformen.swift`, `gemeinsam/kurzformen.mjs`, `Tests/Gemeinsam/kurzformen-faelle.json` | JS-Fassung trägt; Swift-Zwilling entfällt in einer JS-Hülle |

### 2.4 Mitteilungen (3)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| N1 | `UNUserNotificationCenter` (braucht Bundle-ID, Klick-Antwort, Rückzug) | `BrainApp/MitteilungsDienst.swift:8-89` | Electron `Notification`: Windows braucht AppUserModelID (setzt der Installer), Linux über libnotify, Klick-Aktionen dort unsicher |
| N2 | Mitteilungs-Planer (Drossel, nur im Hintergrund, Schlüssel) | `BrainCore/Mitteilungen.swift` (585 Z.), `MeldungsDrossel.swift` | reine Logik, aber Swift → nach JS |
| N3 | Erlaubnis-Abfrage, „Systemeinstellungen öffnen“ | Texte, `einrichtung-und-konten-wie-orca.md` §4.6 | Windows: Einstellung „Benachrichtigungen“; Linux: meist ohne Erlaubnis |

### 2.5 Schlüsselbund und Zugangsdaten (3)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| K1 | GitHub-Token nur über `git credential` mit Helper `osxkeychain` | `gemeinsam/github.mjs:2,26,34,137-181` | **ja, mit anderem Helper**: Windows `manager` (Git Credential Manager, kommt mit Git for Windows), Linux `libsecret` falls vorhanden, sonst GCM; ohne Schlüsseldienst ehrlich sagen, dass nichts gespeichert wird |
| K2 | Texte „Schlüsselbund dieses Macs“ | `studio/texte-willkommen.js:46,85,98`, `texte-einrichtung.js:126`, `texte-verlauf.js:162` | Text je System |
| K3 | KI-Konten: Kortex liest **keine** Zugangsdaten, fragt nur `claude auth status` / `codex login status` | `studio/einstellungen-ki.js:4`, `gemeinsam/kontingent.mjs:2` | ja; Swift fasst den Schlüsselbund nie an (`VorschauModus`) |

### 2.6 Sparkle, Signatur, Notarisierung, Paket (6)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| S1 | Sparkle 2.10.0 (SwiftPM), `SUFeedURL`, `SUPublicEDKey` | `Package.swift`, `BrainApp.swift:11`, `Ressourcen/Info.plist` | nein → electron-updater (oder Tauri-Updater) |
| S2 | Developer-ID-Signatur, Notarisierung, DMG, Appcast | `scripts/veroeffentlichen.sh`, `scripts/pruefe-signatur.sh`, `.github/workflows/release-pruefung.yml` (macos-26) | Mac-Teil bleibt (electron-builder signiert/notarisiert ebenfalls); Windows/Linux neu |
| S3 | Hardened Runtime für Node (JIT-Rechte) | `Ressourcen/node.entitlements` | Mac bleibt; Windows/Linux ohne |
| S4 | `.app`-Aufbau (`Contents/Resources`, `Frameworks`) | `scripts/baue-app.sh` | nein → electron-builder |
| S5 | Node nur für `darwin-arm64` geladen, gegen SHA-256 geprüft | `scripts/hole-node.sh:2,8`, `scripts/node-manifest.sh`, `scripts/node-version.txt` | Muster ja; Ziele `win-x64`, `linux-x64`, später `linux-arm64` ergänzen |
| S6 | Sieben Apple-Secrets | `docs/veroeffentlichen.md` §6 | Windows-Signatur braucht eigene (siehe §5, Entscheidung 3) |

### 2.7 Hintergrunddienst (6)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| D1 | Tageslauf als LaunchAgent `de.brain.tageslauf` (`launchctl bootstrap/bootout/print`) | `kern/tageslauf/dienst.mjs:72-161`; außerhalb macOS heute: „startet beim Sitzungsstart, wenn fällig“ (`:102`) | Logik testbar (`KORTEX_DIENST_PLATTFORM`, `:27-28`); Windows: Aufgabenplanung (`schtasks`/XML), Linux: systemd-User-Timer |
| D2 | `plutil` zum Lesen/Prüfen der plist | `werkstatt/pflege.mjs:24-46`, `kern/umstellung/pruefung.mjs:271`, `umstellung/schritte.mjs:352` | entfällt außerhalb macOS (Dateien sind dort Text) |
| D3 | Bedingungen „am Netzteil“, „im Leerlauf“ über `pmset`/`ioreg` | `kern/tageslauf/zeitplan.mjs:30-39` | Windows: Bedingungen der Aufgabenplanung selbst; Linux: `ConditionACPower=` im Timer, Leerlauf ohne Ersatz |
| D4 | Wachhalten mit `caffeinate` | `kern/tageslauf/gesundheit.mjs:100` | Windows `SetThreadExecutionState` (nur nativ), Linux `systemd-inhibit`; sonst weglassen |
| D5 | Arbeitskopie unter `~/Library/Caches/brain-tageslauf` | `kern/tageslauf/arbeitskopie.mjs:2`, `kern/vertrauen.mjs:44` | ja mit Cache-Ordner je System |
| D6 | Schutzlisten nennen `Library/LaunchAgents`, `Library/Application Support/…` | `kern/tageslauf/integritaet.mjs:106`, `tageslauf/pflege-ki.mjs:54`, Texte `texte-ki-einstellungen.js:198`, `texte-einrichtung.js:219` | Listen je System ergänzen |

### 2.8 Prozesse und Umgebung für claude/codex (8)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| P1 | Eigene Prozessgruppe, Abbruch der ganzen Gruppe (`posix_spawn` + `SETPGROUP`, `kill(-pid)`) | `BrainCore/KiProzess.swift:41-97` | nein; Windows kennt keine Gruppen-Signale → `taskkill /T /F` oder Job-Objekt |
| P2 | Dasselbe in Node (`process.kill(-pid)`, `detached: true`) | `gemeinsam/prozess.mjs:18,108`, `gemeinsam/ki.mjs:75` (18 `detached`-Stellen insgesamt) | auf Windows wirkungslos → eine Funktion `beendeBaum()` je System |
| P3 | PATH aus der Login-Shell (`$SHELL -l`, sonst `/bin/zsh`), Suchorte Homebrew, `/Applications` | `BrainCore/KiErkennung.swift:86-95`, `TerminalNode.swift:6` | Linux ähnlich (bash/zsh), Windows: Registry-PATH + `PATHEXT`, `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs` |
| P4 | Anmelden über Terminal.app mit erzeugtem `#!/bin/bash`-Skript | `AppZustand.swift:120-125`, `KiKontoAktionen.swift:163-176`, `KiRoute.swift:25` | nein; mit E3 ohnehin „Anmelden im Overlay“ (siehe §4) |
| P5 | `.cmd`-Programme (npm-Shims) unter Windows | Kern: 16 Stellen `.cmd` (z. B. `kern/qmd-befehl.mjs:24-75`) | teils; Node startet `.cmd` seit dem Sicherheits-Fix 2024 nur mit `shell: true` → sorgfältiges Quoting nötig |
| P6 | Gesperrte Variablen (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Schlüssel) | `KiErkennung.swift:104-108`, `NodeUmgebung.swift` | Logik ja, Swift → JS (Werkstatt hat Gegenstücke) |
| P7 | Starter `bin/kortex` und Hook-Starter als `#!/bin/sh` | `BrainCore/Laufzeit.swift:293-308`, `kern/node-start.sh`, `kern/adapters/claude-code/install.mjs` (hat schon einen win32-Zweig) | Windows: `kortex.cmd` bzw. direkter `node`-Pfad in Hooks |
| P8 | Platzhalter-Programme der Vorschau als `#!/bin/sh` | `BrainCore/VorschauPlatzhalter.swift:34,50` | Windows: `.cmd`-Platzhalter |

### 2.9 Pfade (7)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| A1 | Support-Ordner `~/Library/Application Support/Kortex` (Swift) | `BrainCore/AppPfade.swift:3-50` | neu je System |
| A2 | **Fest verdrahtet** im Node-Code, obwohl der Kern es schon kann | `gemeinsam/basis.mjs:32`, `gemeinsam/ki-konten.mjs:185`, `kern/ki-konten.mjs:175` (der Kern hat die richtige Regel in `kern/pfade.mjs:33-37`) | **sofort reparierbar** (W0) |
| A3 | Erkennung alter/eigener Pfade per Regex `/Application Support/(Kortex\|Brain)/…` | `kern/install-git-hooks.mjs:29`, `kern/umstellung/git-lage.mjs:120`, `werkstatt/handler.mjs:551-558`, `kern/umstellung/mcp-lage.mjs:15` | aus `supportOrte()` ableiten statt Literal |
| A4 | Umzug `Brain` → `Kortex` und Rückwärts-Symlink | `BrainCore/SupportMigration.swift` | entfällt (neue Systeme haben keinen Altbestand) |
| A5 | Atomar umgeschaltete Symlinks `bin/node`, `bin/kern` (`renamex_np RENAME_SWAP`) | `BrainCore/Laufzeit.swift:197-199` | Windows: Symlinks brauchen Entwicklermodus → Junction für Ordner, Kopie bzw. `.cmd` für `node` |
| A6 | Konfig von Claude Desktop | `werkstatt/ki-programme/programme.mjs:27-28` (fest macOS); `kern/ansicht/mcp-inventar.mjs:52` (schon je System) | Werkstatt an Kern-Regel angleichen |
| A7 | Logs, Einstellungen, Web-Daten im Support-Ordner | `AppZustand.swift:661`, `AppEinstellungen.swift` | folgt A1 |

### 2.10 git und xcode-select (6)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| G1 | git-Prüfung über `xcode-select -p`, damit `/usr/bin/git` keinen Apple-Dialog auslöst | `BrainCore/GitPruefung.swift:8-133` | entfällt; Windows: Git for Windows (oder MinGit mitliefern, `kern/werkzeug.mjs:10-23`), Linux: Paketverwaltung, nur Hinweis |
| G2 | „git installieren“ = `xcode-select --install` | `AppAktion.swift` (`gitInstallieren`), `VorschauModus.swift:183-188` | Windows: `winget install Git.Git` anbieten (mit Rückfrage) oder Download-Link; Linux: Befehl zum Kopieren |
| G3 | Prüfskript in Perl (`/usr/bin/perl`) | `kern/umstellung/git-lage.mjs:55`, `kern/git-sicher-pruefung.pl` | Perl fehlt auf Windows (Git for Windows hat eins, MinGit nicht) → nach Node verlegen (stand schon in `kern-umzug.md` Z. 68) |
| G4 | Laufende git-Prozesse per `lsof` | `gemeinsam/git.mjs:294-297` | Rückfall „ja, vorsichtig“ existiert; Windows-Ersatz nötig oder bewusst vorsichtig |
| G5 | `pgrep`/`lsof` im Umstellungs-Tor | `kern/umstellung/befund.mjs:77-95` | fail-closed vorhanden; auf Windows wäre das Tor immer zu → Ersatz oder Tor dort anders |
| G6 | Windows-Zweig ohne die git-Härtung des Mac | `kern-umzug.md` Z. 66 | offen, Sicherheitsthema |

### 2.11 Dateisystem und Beobachtung (8)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| V1 | Live-Änderungen per `fs.watch` rekursiv (FSEvents); Linux fällt auf Polling | `werkstatt/ereignisse.mjs:2,86-88,386,399` | Windows ja; Linux Polling (große Vaults messen, `scripts/messe-grosse-vaults.mjs`) |
| V2 | Groß/Klein: darwin/win32 falten, Linux nicht | `kern/werkzeug-log.mjs:8-10`, `vorschlaege.mjs:42-55`, `ernte.mjs:140`, `entscheidungen.mjs:30`, `pflege.mjs:138` | ja, bereits durchdacht |
| V3 | Unicode NFC/NFD (APFS bewahrt die Form, Linux nicht, Windows meist NFC) | ~125 Stellen, z. B. `gemeinsam/vault.mjs:39,392` | vermutlich ja; Tests mit NFD-Dateinamen auf Linux/Windows nötig |
| V4 | Pfadtrenner: Vault-Pfade sind `/`-Pfade; Umrechnung mit `sep` | `gemeinsam/vault.mjs:74,184`; rund 200 `split("/")`-Stellen im Node-Code | **ungeprüft**: der Großteil arbeitet auf Vault-relativen Pfaden (richtig), einzelne auf echten Pfaden (falsch unter Windows) — die Windows-CI findet sie |
| V5 | Rechte `0600`/`0755` (`chmod`, Entwurfs-Journal, Ablage) | 75 Stellen, z. B. `gemeinsam/ablage.mjs` | auf Windows ohne Wirkung → Schutz dort über den Benutzerordner (ACL), Text ehrlich |
| V6 | iCloud-Platzhalter `find -flags +dataless` | `kern/umstellung/befund.mjs:343` | entfällt außerhalb macOS (OneDrive „Nur online“ wäre das Windows-Gegenstück) |
| V7 | Papierkorb über Finder (`osascript`) | `kern/umstellung/aufraeumen.mjs:66-67` | Electron `shell.trashItem`; ohne Hülle: Windows PowerShell, Linux `gio trash` |
| V8 | Zeilenenden: Zusammenführung ist byte-treu (`\r` bleibt Teil der Zeile) | `gemeinsam/merge3.mjs`, `ENTWICKLUNG.md` „Nichts geht verloren“ | ja; aber git `core.autocrlf=true` (Vorgabe von Git for Windows) ändert Vault-Dateien → beim Anlegen eines Vaults `.gitattributes` `* -text` oder `autocrlf=false` lokal setzen |

### 2.12 Geräte- und Prozess-Identität (3)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| I1 | Hardware-ID über `ioreg IOPlatformUUID` | `gemeinsam/dateiaktionen.mjs:68-84` | Windows `MachineGuid` (Registry), Linux `/etc/machine-id` |
| I2 | Startzeit eines Prozesses über `ps -o lstart` (gegen PID-Wiederverwendung bei Sperren) | `gemeinsam/dateiaktionen.mjs:95-104`, `kern/abgleich-sperre.mjs` | Linux `ps` ja; Windows: PowerShell `Get-Process` (langsam) oder nur PID + Alter |
| I3 | Gerätename über `scutil --get ComputerName`, Mac-Adresse `nutzer@Name.local` | `kern/abgleich-konflikt.mjs:80`, `ENTWICKLUNG.md` „Konflikt beim Abgleich“ | `os.hostname()` als Rückfall reicht |

### 2.13 Symbole (3)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| Y1 | App-Symbol und vier Varianten als `.icns` | `Ressourcen/AppIcon.icns`, `Ressourcen/AppSymbole/*.icns`, `scripts/erzeuge-app-symbole.mjs`, `scripts/baue-icon.sh` | Quelle ist SVG → `.ico` und PNG-Größen zusätzlich erzeugen |
| Y2 | Symbol zur Laufzeit wechseln (`NSApp.applicationIconImage`) | `BrainCore/AppSymbol.swift`, Aktion `app-symbol` | Windows: Fenster-/Taskleisten-Symbol ja; Linux: das Symbol im Starter ist fest → Funktion dort nur fürs Fenster |
| Y3 | Menüleisten-Vorlagebild | `KortexMenueSymbol.swift` | Tray-PNG je System |

### 2.14 Vorschau und Tests (6)

| # | Was | Wo | Portabel? |
|---|---|---|---|
| T1 | Vorschau-Modus der App (HOME, `CFFIXED_USER_HOME`, eigene Bundle-ID, fail-closed Exit 2) | `BrainCore/VorschauModus.swift` | Konzept ja; Windows: `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` statt `CFFIXED_USER_HOME`; Linux: `XDG_*` |
| T2 | Vorschau-Skripte (`$TMPDIR`, Aufräumen der Kennung, `.command`) | `scripts/vorschau.sh`, `scripts/teste-vorschau.sh`, `Kortex Vorschau.command` | nein → je System ein Starter oder eine Node-Fassung |
| T3 | Vorschau-Schutz im Node-Code | `gemeinsam/basis.mjs:36` | ja, Variablenliste je System ergänzen |
| T4 | 43 Swift-Testdateien (8 559 Zeilen), nur macOS | `Tests/BrainCoreTests/` | für eine JS-Hülle: Logik-Tests mitwandern lassen |
| T5 | 22 Shell-Tests des Kerns, Läufer in bash | `Tests/Kern/test-*.sh`, `Tests/Kern/run-all.sh` | Linux ja; Windows nur unter Git Bash, sonst die 191 `.mjs`-Tests allein |
| T6 | CI: Kern/Node/UI auf `ubuntu-latest`, Swift auf `macos-26`, **kein Windows-Job** | `.github/workflows/ci.yml` | Windows-Matrix ergänzen (W0) |

**Summe: 79 Einträge** — Fenster/Menüs 7 · Brücke 8 · Erfassen 5 · Mitteilungen 3 · Zugangsdaten 3 · Sparkle/Signatur 6 · Dienst 6 · Prozesse 8 ·
Pfade 7 · git 6 · Dateisystem 8 · Identität 3 · Symbole 3 · Vorschau/Tests 6. Davon sind **rund 45 nur Hülle** (Swift, verschwinden mit jeder neuen Hülle bzw. müssen dort neu entstehen)
und **rund 30 im Node-Code**, die unabhängig von der Hülle gelöst werden müssen — das ist die eigentliche Windows/Linux-Arbeit, und sie ist bei allen Wegen gleich.

---

## 3. Wege

Gemeinsam für alle Wege: Die ~30 Node-Stellen aus §2 (Dienst, Prozessbaum, Pfade, Helper, Perl, Identität, Papierkorb) brauchen eine Plattform-Schicht
(`gemeinsam/plattform.mjs`, injizierbar wie `dienstPlattform` heute). Die zählt unten nicht mit.

### Weg A — Swift bleibt am Mac, zweite Hülle (Electron oder Tauri) für Windows/Linux

- **Was Nutzer bekommen:** Mac unverändert nativ; Windows/Linux eine App mit gleichem Studio, gleicher Werkstatt.
- **Aufwand:** zweite Hülle bis Gleichstand ~6-8 Wochen (Fenster, Brücke, Aktionsrechte, Erfassen, Tray, Mitteilungen, Kürzel, Updater, Installer).
  **Danach dauerhaft doppelt:** jede Aktion, jedes Hüllen-Feature (E1 Aktionsrechte, E3 Anmeldelauf, E7 Ein-Instanz-Prüfung, Kürzel) zweimal bauen und testen;
  geschätzt +30-50 % auf alles, was die Hülle berührt. Logik wie Mitteilungs-Planer, Aktionsprüfung, Kürzelprüfung gibt es dann in Swift **und** JS (wie heute schon die Kurzformen).
- **Updates/Signatur:** Mac Sparkle wie geplant; Windows electron-updater + NSIS; Linux AppImage. Zwei Update-Wege, zwei Release-Ketten.
- **Risiko:** Auseinanderlaufen der Hüllen (Fehler, die nur auf einem System auftreten), doppelte Vorschau-Modi. Gering für den Mac, hoch für die Pflege.
- **Passt, wenn** der Mac der Kern der Nutzerschaft bleibt und Windows/Linux „auch da“ sein soll.

### Weg B — eine Hülle für alle drei Systeme

**B1 Electron (wie Orca).**
- **Was Nutzer bekommen:** überall dieselbe App; am Mac etwas weniger nativ (Menüs und Fenster bleiben echte Systemmenüs/-fenster, das Studio war ohnehin Web), größerer Download
  (Schätzung +70-100 MB), mehr Arbeitsspeicher als WKWebView (vor dem Mac-Wechsel mit `scripts/messe-speicher.sh` vergleichen).
- **Aufwand:** Hülle in JS ~6-8 Wochen für Windows/Linux, +2-3 Wochen für Mac-Gleichstand (Erfassen-Panel, Tray, Notarisierung mit electron-builder, Vorschau-Modus).
  Die Swift-Logik (Aktionsrechte, Planer, Kürzelprüfung, Vault-Auswahl, Laufzeit-Bereitstellung) wird **einmal** nach JS übertragen; Teile gibt es dort schon (Kurzformen).
- **Stärken:** Chromium überall = dieselbe Engine, in der die 47 Playwright-Specs heute schon laufen; Node im Hauptprozess spricht das Werkstatt-Protokoll ohne Umweg;
  eine Sprache von Hülle bis Kern; Orca zeigt den kompletten Weg (siehe unten).
- **Updates/Signatur:** electron-builder + electron-updater mit GitHub-Releases (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`). Mac: Developer ID + Notarisierung wie heute
  (Secrets bleiben nutzbar), Windows: NSIS-Installer pro Benutzer (kein Admin), signiert (Entscheidung 3), Linux: AppImage (aktualisiert sich selbst) + deb (Update über Paketverwaltung).
- **Risiko:** mittel. Der Wechsel am Mac ist nur **vor** dem ersten Stable billig: Betas versprechen keine Updates (`veroeffentlichen.md` §2). Nach einem Stable mit Sparkle
  müsste die letzte Sparkle-Version eine Electron-App gleicher Bundle-ID ausliefern — machbar, aber ein heikler Einmal-Schritt.

**B2 Tauri.**
- **Stärken:** kleine Hülle; am Mac bleibt **WKWebView** (Studio verhält sich wie heute); Windows nutzt WebView2 (Chromium); eingebauter Updater mit Signatur, Plugins für Tray, globale Kürzel, Mitteilungen.
- **Schwächen:** Hülle in Rust (neue Sprache im Team); Node muss trotzdem als Sidecar mit (Werkstatt, Kern, MCP) — der Größenvorteil schrumpft; **Linux nutzt WebKitGTK**,
  das weder die Playwright-Tests (Chromium) noch der Mac (WKWebView) abdecken; dritte Engine = dritte Fehlerklasse (Editor, CodeMirror, three.js, CSS-Masken: 6× `-webkit-mask-image`).
- **Aufwand:** ähnlich B1 plus Einarbeitung Rust, Risiko mittel bis hoch (Linux).

### Weg C — günstigere Zwischenschritte

**C1 „Kortex im Browser“ (lokaler Dienst + Standardbrowser).**
- `kortex studio` (Kern-CLI) startet die Werkstatt als HTTP-Dienst auf `127.0.0.1` und öffnet den Browser. Es gibt ihn schon fast: `werkstatt/entwicklung.mjs` nutzt denselben Handler,
  prüft Host und Origin (DNS-Rebinding, CSRF) und nimmt nur JSON. **Es fehlt ein Zugriffs-Token** (Z. 4-6: „jeder Prozess desselben Benutzers … spricht mit der Werkstatt“) —
  Pflicht vor jeder Auslieferung: zufälliges Token je Start, einmal per URL übergeben, danach als `HttpOnly`/`SameSite=Strict`-Cookie, Port nur lokal.
- **Was Nutzer bekommen:** Studio, Suche, Schreiben, Abgleich, KI verbinden (MCP) auf Windows/Linux. **Nicht:** Schnell-Erfassen-Fenster, globales Kürzel, Tray, Dock-Symbol,
  Systemmitteilungen nur als Browser-Mitteilung, Dienst nur über einen CLI-Befehl.
- **Aufwand:** ~1-2 Wochen (Token, Starter, Installskript mit Node-Download wie `hole-node.sh`, Studio ohne `aktion`-Kanal sauber abschalten — `inApp()` gibt es schon, `studio/api.js:228`).
- **Risiko:** gering; Sicherheit des lokalen Dienstes ist der einzige ernste Punkt (Review).
- **Wert:** findet die echten Windows/Linux-Fehler früh, ohne Hüllen-Entscheidung; danach ist genau dieser Dienst der Kern jeder Hülle.

**C2 Nur Kern/MCP als CLI** (alter Plan FBL-81). Billigster Schritt (~3-5 Tage), aber ohne Studio — für Nutzer kaum sichtbar. In C1 enthalten.

### Vergleich

| | A Swift + 2. Hülle | B1 Electron überall | B2 Tauri überall | C1 Browser-Modus |
|---|---|---|---|---|
| Hüllen-Code | 2× dauerhaft | 1× | 1× (Rust) | keiner |
| Web-Engines | WKWebView + Chromium | Chromium | WKWebView + WebView2 + WebKitGTK | Nutzerbrowser |
| Aufwand bis nutzbar (Win/Linux) | 6-8 Wo. | 6-8 Wo. | 7-10 Wo. | 1-2 Wo. |
| Aufwand danach je Hüllen-Feature | +30-50 % | 0 | 0 | — |
| Updates | Sparkle + electron-updater | electron-updater | Tauri-Updater | über Installskript |
| Mac-Gefühl | unverändert | gut, etwas schwerer | wie heute | Browser-Tab |
| Risiko | Drift | Mac-Wechsel vor Stable | Linux-Engine, Rust | lokaler Dienst |

### Querschnitt je Thema

| Thema | Windows | Linux | Hinweis |
|---|---|---|---|
| Zugangsdaten | `git credential` Helper `manager` (GCM) | `libsecret` falls installiert, sonst GCM; ohne Schlüsseldienst nichts speichern und das sagen | Electron `safeStorage` brauchen wir nicht (Token bleibt bei git); Orca verschleiert unter Linux ohne Schlüsseldienst nur — das übernehmen wir nicht |
| Hintergrunddienst | Aufgabenplanung, täglich, Bedingungen „Netzbetrieb“/„Leerlauf“ eingebaut | systemd-User-Timer `~/.config/systemd/user/kortex-tageslauf.timer`, `Persistent=true`, `ConditionACPower=true`; ohne systemd: heutiger Rückfall „beim Sitzungsstart“ | Logik in `dienst.mjs` bleibt, je System ein Schreiber + Rückweg, beide mit Attrappe testbar |
| Globales Kürzel | `globalShortcut` | X11 ja; Wayland: Portal oder „lege im System ein Kürzel auf `kortex erfassen` an“ | Orca hat gar keins — für uns ein Unterschied, kein Muss in W2 |
| Erfassen-Fenster | rahmenloses `alwaysOnTop`-Fenster | dito, Wayland ohne feste Position | Web-Fassung von `ErfassenAnsicht` |
| Mitteilungen | Toast, AppUserModelID aus dem Installer | libnotify; Klick-Aktion nicht überall | Planer-Logik nach JS |
| Installer | NSIS pro Benutzer; **kein MSIX** (Paket-Sandbox verträgt sich schlecht mit dem Start von `claude`/`codex` und dem Schreiben nach `~/.claude`) | AppImage + deb; **kein Flatpak/Snap** (Sandbox blockiert Host-Programme und `~/.claude`) | wie Orca: dmg/zip, NSIS, AppImage/deb/rpm |
| claude/codex starten | `.cmd`/`.exe`, `PATHEXT`, Prozessbaum mit `taskkill /T`; Claude Code unter Windows setzt nach unserem Stand Git Bash voraus (prüfen) | wie macOS (Login-Shell-PATH) | Orca: PATH aus der Login-Shell (`src/main/startup/hydrate-shell-path.ts`), `.cmd`-Shims je Agent |
| CI | `windows-latest` für Node/Kern-Unit/Playwright | gibt es schon | Repo ist öffentlich → Runner kostenlos; Orca testet PRs auf `ubuntu-24.04` und `windows-2022` |

### Wie E1-E5 hineinpassen

E1-E5 (`einrichtung-und-konten-wie-orca.md` §6) schieben Arbeit aus Swift ins Studio — das hilft jedem Weg. Zwei Anpassungen machen sie portabel, ohne sie zu verzögern:

1. **E1:** Die Aktionen, die an „Overlay offen“ gebunden werden (`git-pruefen`, `git-installieren`, `kopieren`, `einrichtung-ende`), als **Hüllen-Vertrag** beschreiben
   (Liste der Aktionen, erlaubte Herkunft, Werte, Antworten — z. B. `Ressourcen/gemeinsam/huellen-vertrag.json`) und den Swift-Test daraus lesen lassen, wie bei `kurzformen-faelle.json`.
   Dann prüft dieselbe Datei später die Electron-Hülle.
2. **E3:** Den Anmeldelauf (`claude auth login` mit `BROWSER`-Shim, Codex-Gerätecode, Fristen, Prozessgruppe) **in der Werkstatt (Node)** bauen statt in Swift.
   `gemeinsam/prozess.mjs` hat Prozessgruppen und Fristen schon; die Swift-Seite muss nur „Adresse öffnen“ (`extern`) können. So entsteht das heikelste Stück (nie Zugangsdaten lesen)
   genau einmal, mit einem Satz Tests.

E4 und E5 sind reines Studio/Node und laufen unverändert überall. E7 (Rückfragen und Hinweise ins Studio) verkleinert die Hülle weiter.

### Wirkung auf die Team-Vision

`vision-team.md` Frage 5 („Team-Mitglieder ohne Mac“) ist damit beantwortet: In Firmen ist Windows die Regel. C1 reicht für erste Team-Versuche (Team-Vault, Posteingang, MCP),
eine einzige Hülle (B1) hält die Team-Funktionen später in **einem** Code. Weg A würde jede Team-Funktion mit Hüllenanteil (Mitteilung bei neuer Nachricht, Tray-Zähler) doppelt kosten.

---

## 4. Orca als Vorlage (was wir übernehmen können)

Aus dem Orca-Quelltext (nur gelesen; Pfade relativ zur Orca-Wurzel):

- Paket: `config/electron-builder.config.cjs` (electron-builder 26): Mac dmg+zip x64/arm64, Windows NSIS (Vorgabe) mit Hooks `config/nsis/`, Linux AppImage/deb/rpm; kein MSIX, Snap, Flatpak.
- Updates: electron-updater mit GitHub-Releases, `autoDownload = false` (`src/main/updater/lifecycle/updater-setup.ts:149`); deb/rpm gelten als „von außen verwaltet“,
  nur das AppImage aktualisiert sich selbst (`src/main/updater/…/linux-update-package-type.ts`).
- Signatur: Mac Developer ID + Notarisierung nur im Release; **Windows über SignPath Foundation** (kostenlos für Open Source; `.github/workflows/release-cut.yml`); Linux unsigniert.
- CI: PRs auf `ubuntu-24.04` und `windows-2022`, Releases als Matrix Windows/Linux x64/Linux arm64/macOS.
- Zugangsdaten: Electron `safeStorage`; ohne Schlüsseldienst unter Linux nur verschleiert. Orca liest zusätzlich Zugangsdaten anderer Programme aus dem Mac-Schlüsselbund — **das übernehmen wir nicht** (unsere Regel: nie Zugangsdaten lesen).
- Kein `globalShortcut`, kein Autostart; Ein-Instanz-Sperre `src/main/startup/single-instance-lock.ts`.

---

## 5. Empfehlung und Plan

**Ziel: Weg B1 (Electron für alle drei).** Weg dorthin über C1, ohne vorher Swift abzuschalten. Jede Stufe ist für sich nützlich und einzeln umkehrbar.

| Stufe | Inhalt | Größe | Risiko | Fertig heißt | Wann |
|---|---|---|---|---|---|
| **W0** | **Plattform-Probe** (erstes Paket, Details unten) | M (2-4 Tage) | gering | Node-Tests und Kern-Unit-Tests grün auf `windows-latest` und `ubuntu-latest`; Playwright auf Windows grün oder jede Abweichung als Aufgabe | sofort, parallel zu E1 |
| W1 | **Kortex im Browser** (C1) mit Token, `kortex studio`, Installskript (Node + Kern je System), Dienst über Aufgabenplanung/systemd, Texte je System | M-L (1-2 Wochen) | gering-mittel (lokaler Dienst → Opus-Review) | frische Windows- und Linux-VM: installieren, Vault anlegen, Claude Code verbinden, suchen, schreiben, abgleichen; Vorschau-Ordner bleibt sauber | nach W0, parallel zu E2-E5 möglich |
| W2 | **Electron-Hülle für Windows/Linux**: Brücke, Hüllen-Vertrag, Tray, Erfassen-Fenster, Kürzel, Mitteilungen, NSIS/AppImage/deb, electron-updater, Vorschau-Modus | XL (6-8 Wochen) | mittel | Release-Kette auf drei Runnern, Update 0.x → 0.x+1 auf Windows und Linux belegt, Hüllen-Vertrag-Tests grün | nach E1-E5 und der Mac-Beta |
| W3 | **Mac auf Electron**, gemessen gegen die Swift-App (Startzeit, Speicher, Erfassen-Fenster, Fotos hell/dunkel, Vorschau-Test „nichts bleibt“) | L (2-3 Wochen) | mittel | Messwerte mit Nutzer angesehen, dann Wechsel **vor** dem ersten Stable; sonst bleibt der Mac bei Swift (= Weg A als bewusste Rückfallebene) | vor dem Umzug auf das Firmenkonto |

### Erstes Paket W0 „Plattform-Probe“ (billig, nimmt das größte Risiko vorweg)

1. CI: neuer Job `plattform-probe` mit Matrix `windows-latest` (und `ubuntu-latest` für Gleichstand): `node --test Tests/Node`, Kern-Unit-Tests (die 191 `.mjs` über `unit.sh` bzw. einen
   Node-Läufer ohne bash), Playwright-Specs auf Windows. Zuerst **nicht** in `ci-ok`, nur als Messung; die Liste roter Tests kommt in den PR. Sobald grün: in `ci-ok` aufnehmen.
2. `gemeinsam/plattform.mjs` mit injizierbaren Funktionen (Muster `dienstPlattform`): `supportBasis()` (Regel aus `kern/pfade.mjs:33-37`), `beendeBaum(pid)`, `geraeteKennung()`,
   `prozessStart(pid)`, `rechnerName()`, `credentialHelper()`, `inPapierkorb()`. Am Mac ändert sich nichts (bestehende Tests sichern das).
3. Die drei fest verdrahteten Support-Pfade (`gemeinsam/basis.mjs:32`, `gemeinsam/ki-konten.mjs:185`, `kern/ki-konten.mjs:175`) und die Pfad-Regexe (A3) auf diese Schicht umstellen.
4. Tests mit NFD-Dateinamen, Backslash-Pfaden und Groß/Klein auf allen Runnern; `.gitattributes`-Regel für neue Vaults unter Windows (V8) als Test.
5. Ergebnis im PR: Anzahl roter Tests je System vorher/nachher, offene Fälle als Aufgaben. Kein Installer, keine Hülle, keine Produktänderung am Mac.

Warum zuerst: Alle Wege brauchen genau diese Arbeit, sie kostet wenige Tage, und erst ihr Ergebnis zeigt, ob „bald“ Wochen oder Monate heißt.

### Ab sofort (kostet nichts)

- Neue Hüllen-Funktionen nur noch mit Vertrag (Aktion + Herkunft + Test-Datei), Logik bevorzugt in Node/Studio statt in Swift (E3 siehe oben).
- Keine neuen macOS-Befehle im Node-Code ohne Eintrag in `gemeinsam/plattform.mjs`.

---

## 6. Entscheidungen für dich (mit Empfehlung)

| # | Frage | Empfehlung |
|---|---|---|
| 1 | **Zielbild der App-Hülle:** eine Electron-App für alle drei Systeme (B1), Swift am Mac + zweite Hülle (A) oder Tauri (B2)? | **B1 als Ziel**, aber der Mac wechselt erst nach Messung (W3); bis dahin wird Swift gepflegt, aber nicht mehr ausgebaut. Spätester Zeitpunkt: vor dem ersten Stable-Release, weil danach der Update-Umzug teuer wird. |
| 2 | **Reihenfolge gegenüber v1 am Mac:** Windows/Linux erst nach E1-E5 oder parallel? | **W0 sofort parallel** (nur CI, berührt E1-E5 nicht), E3 gleich in Node bauen, W1 parallel zu E2-E5, W2 erst nach E1-E5 und der Mac-Beta. So kommt v1 am Mac nicht später, und „bald“ = Browser-Vorschau in 2-3 Wochen. |
| 3 | **Windows-Signatur und Vertrieb:** SignPath Foundation (kostenlos für Open Source, Antrag, Wartezeit), Azure Trusted Signing (monatliche Gebühr, Voraussetzungen für Einzelpersonen prüfen) oder vorerst unsigniert? | **Betas unsigniert** (SmartScreen-Hinweis wie heute „Trotzdem öffnen“ am Mac), **Antrag bei SignPath gleich stellen** (wie Orca), Linux als AppImage + deb ohne Signatur. Kein MSIX, kein Flatpak/Snap. |

---

## 7. Was nicht geprüft ist

- Kein Test lief auf Windows; die Zahl der Stellen mit Pfadtrennern (V4) und NFD (V3), die wirklich brechen, ist geschätzt — genau das misst W0.
- Ob Claude Code und Codex unter Windows `auth status`/`login status` gleich ausgeben, ob Claude Code dort Git Bash voraussetzt und ob `BROWSER`-Shims dort greifen: nicht geprüft (keine echten Logins).
- Electron-Größe und Speicherbedarf sind Erfahrungswerte, nicht gemessen; vor W3 mit `scripts/messe-speicher.sh` gegen die Swift-App messen.
- Globales Kürzel unter Wayland (Portal-Unterstützung in Electron) nicht geprüft.
- Voraussetzungen und Kosten von SignPath Foundation und Azure Trusted Signing für dieses Repo nicht geprüft.
- Orca-Angaben aus dem Quelltext über einen Unteragenten gelesen. Selbst per `grep` nachgesehen: Linux-Ziele `['AppImage', 'deb', 'rpm']` und `provider: 'github'`
  (`config/electron-builder.config.cjs:712,763`), SignPath in `release-cut.yml` und `windows-signing-rehearsal.yml`, PR-Runner `ubuntu-24.04`/`windows-2022` (`pr.yml`),
  `autoDownload = false`, kein `globalShortcut` in `src/main`. Auffällig: Orca legt auch ins AppImage eine eigene Node-Laufzeit (`placeAppImageNodeRuntime`, Z. 79) — wie wir
  für Kern/MCP. Übrige Zeilenangaben nicht einzeln geprüft; Größenangaben von Orca bewusst weggelassen (nicht belastbar).

---

## 8. W0 Ergebnis (PR „W0 Plattform-Probe“) und Windows-grün-Paket

Messjob `plattform-probe` in `.github/workflows/ci.yml` (Windows und Linux; Bereiche node, kern, ui in 4 Teilen). Die **Linux-Probe ist Pflichtbestandteil von `ci-ok`** (Job in `needs`, alles muss grün sein). Die **Windows-Probe bleibt nicht blockierend** (`continue-on-error` nur für `windows-latest`), bis sie grün ist; dann fällt die Ausnahme weg. Zahlen stehen in der Lauf-Zusammenfassung (`scripts/plattform-probe-bericht.sh`) und im Artefakt `plattform-probe-<os>-<bereich>`; bei roten UI-Tests liegt `plattform-probe-fehlerkontext-windows-latest-ui-*` bei.

Neu: `gemeinsam/plattform.mjs` (Kopie `kern/plattform.mjs`), `.gitattributes` (`eol=lf`), Import-Haken für Laufwerkspfade (`Tests/*/windows-importe.mjs`), tragbare Test-Attrappen (`Tests/Node/attrappe.mjs`, unter Windows ein einmalig mit csc gebauter `.exe`-Starter), Perl-Prüfskript nach Node (`Ressourcen/kern/git-sicher-pruefung.mjs`, Gleichwertigkeitstest), `nurUnix`/`nurMac` für echte Plattform-Unterschiede.

### Messwerte (Lauf auf Kopf e02e997, PR #112)

| Bereich | Linux | Windows vorher (main) | Windows jetzt |
|---|---|---|---|
| Node-Tests | 1276 Tests, 0 rot | 310 rot | 1217 Tests, 83 rot |
| Kern-Unit-Tests | 2794 Tests, 0 rot | 399 rot | 2794 Tests, 338 rot |
| Playwright (Chromium) | 954 grün, 0 rot | 54 rot | 35 rot (19 / 7 / 7 / 2 je Teil) |

### Offene Fälle: Ursache → Folgeaufgabe (alles W2)

| Gruppe | Ursache | Folgeaufgabe |
|---|---|---|
| Umstellung A4 (Kern, Node) | Claude-Hooks brauchen POSIX-Shell-Befehle; unter Windows anderer Aufrufweg | W2: Hook-Befehle je System erzeugen |
| UI ohne Diagnose (35, Artefakte `…-ui-*`) | Ursache je Spec noch nicht ermittelt | W2: Fehlerkontext sichten, nach Ursache gruppieren |
| Härtung „Sync Zeitlimit“ | Windows liefert 409 statt 504 | W2: Ablauf prüfen, Erwartung oder Code angleichen |
| `kontingent-regeln` (Vault kurzer/langer Name) | Kurznamen (`RUNNER~1`) vs. lange Pfade | W2: Pfade vor Vergleich per `realpath.native` |
| `browser-dienst`, v2-git (60-s-Zeitlimits) | langsamer Start/Prozessbaum unter Windows | W2: Ursache messen, Zeitlimits oder Start anpassen |
| `git worktree` (Tageslauf, Pflege, Traum) | Pfad mit Umlaut und Zweigname `tageslauf/…` | W2: Aufruf und Quoting prüfen |
| ≈200× `split("/")` auf echten Pfaden (V4) | Pfade mit `\` | W2: je Stelle `path`-Funktionen |
| `lsof`/`pgrep` (G4, G5) | Unix-Werkzeuge | W2: Windows-Ersatz (`tasklist`/PowerShell) |
| `supportOrte`-Regexe (A3) | Unix-Pfadform | W2: Regex auf Laufwerkspfade |
| macOS-only ohne Ersatz | launchctl, pmset/ioreg, caffeinate, osascript, plutil, Keychain | W2: Aufgabenplanung, `powercfg`, PowerShell-Papierkorb, Credential Manager; Linux: systemd, `gio trash`, libsecret |
| Bewusst nicht gemacht | ⌘→`mod()` (UI-Tests setzen `MacIntel`, Studio bildet Cmd auf Ctrl ab) | keine |
| Linux-Support-Ordner | Regel aus `kern/pfade.mjs` (`XDG_DATA_HOME`/`~/.local/share`) | Entscheidung, falls `~/.config` gewünscht |

---

## 9. W2a Ergebnis (PR „W2a Electron-Grundgerüst“)

Stand: lauffähige Electron-Hülle für Windows und Linux in `electron/`, ohne Installer, Updater, Tray und Erfassen-Fenster. Die Swift-App am Mac ist unverändert (`Sources/` nicht angefasst).

**Aufbau**
- `electron/haupt.mjs` (Hauptprozess), `preload.cjs` (die eine Schnittstelle `window.kortexHuelle`), `aktionen.mjs` (alle 24 Aktionen des Vertrags, reine Logik ohne `import "electron"`), `navigation.mjs` (erlaubte Adressen), `bruecke.mjs` (Werkstatt als Kindprozess, gleiches Zeilenprotokoll wie in der Swift-App).
- Die **Werkstatt läuft als Kindprozess** (dieselbe `werkstatt.mjs` wie am Mac), nicht im Hauptprozess: Sie startet an vielen Stellen `process.execPath` als Node (Kern-Skripte, MCP, `vault.mjs`) — im Hauptprozess wäre das die Electron-Datei, also ein zweites Fenster; ein hängender Handler (git, lange Läufe) friert so die Oberfläche nicht ein; Absturz und Neustart sind getrennt (höchstens 3× in 60 s); ein Weg wie am Mac. Das Kind läuft als `ELECTRON_RUN_AS_NODE`; `gemeinsam/basis.mjs#alsNode` setzt sie für die Kinder, die `process.execPath` als Node starten (`vault.mjs`), nur wenn der Prozess selbst Electron ist.
- Das Studio lädt über **`kortex://studio/`** (`protocol.handle` → Brücke): **kein Port, kein Token, kein Netzwerkweg** zur Werkstatt (anders als der Browser-Dienst W1). `api.js` braucht dafür keine Änderung (fetch auf dieselbe Herkunft).
- **Sicherheit:** `contextIsolation`, kein `nodeIntegration`, `sandbox`, `webSecurity`, `webviewTag` aus; Preload lädt nur `electron`; Aktionen kommen nur vom Hauptrahmen der eigenen Seite (`senderFrame`); Navigation und `window.open` nie zu fremden Adressen (nur http/https gehen über `shell.openExternal` in den Browser, bei offener Einrichtung nur GitHub und Anmelde-Domänen); Netzzugriff der Seite gesperrt (`onBeforeRequest`: nur `kortex:`, `data:`, `blob:`); Berechtigungen bis auf „Zwischenablage schreiben“ verweigert; schreibende Anfragen nur als JSON (Chromium reicht den Origin nicht an `protocol.handle` weiter: gemessen, darum nur geprüft, wenn er da ist); Einzelinstanz-Sperre; alle Daten der Hülle unter `<Support>/electron`; Umgebung des Kindes ausdrücklich gebaut (nie `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Git-Konfiguration, Tokens).
- **Vertrag:** Feld `electron` bei jeder Aktion und jeder Route in `huellen-vertrag.json`; `Tests/Node/huellen-vertrag.test.mjs` prüft, dass die Hülle jede Aktion kennt, dieselbe Liste „nur bei offener Einrichtung“ hat und für jede Aktion beschrieben ist. Echte Umsetzung: Ordner zeigen (`showItemInFolder`), extern (`openExternal`), Ordner wählen (`showOpenDialog`, Antwort wie am Mac), Zwischenablage, Mitteilungs-Probe (`Notification`), Titel, Darstellung (`nativeTheme`), Fenster-Zoom, Einrichtung samt erstem Start. Noch nicht (`{ok:false, grund:"nicht-verfuegbar"}`): globale Kürzel, App-Symbol, durchscheinende Seitenleiste; `ansicht` bleibt `kein-kit`.
- **Nachbesserung nach dem Review:** Stirbt die Werkstatt vor dem ersten `bereit`, zeigt die Hülle den Grund und beendet sich (kein Neustart). Schließen und Beenden fragen zuerst `window.studio.vorSchliessen()` (Frist 8 s, bei „nicht gespeichert“ die Rückfrage „Trotzdem schließen“/„Abbrechen“ wie in Swift, `electron/schliessen.mjs`). Im Paket gilt dieselbe Sperrliste für Testschalter und `KORTEX_VORSCHAU` wie in Swift (`electron/test-schalter.json`, gegen `NodeUmgebung.swift` abgeglichen), `BRAIN_VAULT` wird nie weitergegeben. `BRAIN_MCP_NODE` zeigt auf ein absolutes `node` aus dem PATH; gibt es keines, schreibt Kortex weder MCP-Einträge noch Statuszeile (Fehler mit Grund, bis W2c ein eigenes Node mitbringt). Körper über `MAX_KOERPER` (8 MB, aus `handler.mjs`) bekommen 413, Anfragen ohne Antwort nach 5 min 504; beim Beenden SIGKILL/`taskkill` nach der Frist. `ELECTRON_RUN_AS_NODE` setzen nur die eigenen `process.execPath`-Aufrufe (`alsNode`, `vault.mjs`), nicht `kindUmgebung`.
- **Studio:** `api.js` kennt `imElectron()` und `kannOrdnerZeigen()`; die Oberfläche behandelt Electron wie den Browser-Modus (kein Dock, keine Übersicht, keine globalen Kürzel), zeigt aber „Im Dateimanager zeigen“.
- **Tests:** `Tests/Node/electron-huelle.test.mjs` (Werteprüfung, Navigation, Umgebung, Brücke gegen die echte Werkstatt; läuft überall mit), `electron/test/huelle.spec.mjs` (die echte App über Playwright `_electron`, Temp-HOME, eigener Support-Ordner: Start, Sandbox/Isolation, Notiz anlegen und speichern, Aktionen, Navigation, erster Start, Fenster-Foto). CI: Job `electron-probe` (Linux unter xvfb ist Tor in `ci-ok`, Windows Messung).

**Für W2b (Tray, Erfassen, Kürzel, Mitteilungen)**
- Tray-Symbol je System, App-Menü mit den Kürzeln aus `tastenkuerzel-register.json` (heute nur „Ansicht“), Schließen = in den Tray (heute: Beenden).
- Erfassen-Fenster (kleine Web-Seite im Studio-Stil, `alwaysOnTop`, Fokus zurück), globales Kürzel (`globalShortcut`; Wayland nur über das Portal oder ein vom Nutzer angelegtes Kürzel), damit `kuerzel-global` und `kuerzel-geaendert` echt werden.
- Mitteilungen aus dem Studio heraus (Planer `Mitteilungen.swift` nach JS, Klick → Befehl), `status-auffrischen` für Zähler im Tray, `vault-gewechselt`/`vertrauen-geaendert` für Menü und Tray.
- GitHub-Anmeldung: `KORTEX_GITHUB_CLIENT_ID` (am Mac aus der Info.plist) fehlt in der Electron-Hülle, die GitHub-Karte bleibt ausgeblendet; die Client-ID gehört in die Paketkonfiguration (W2b/W2c).
- Eigene Titelleiste und `fenster-ziehen` (nur wenn der Rahmen entfällt), `fenster-durchscheinend` (Windows: Mica), App-Symbol als `.ico`/`.png`.

**Für W2c (Paket und Updates)**
- electron-builder: NSIS (Windows), AppImage und deb (Linux); `Ressourcen/` als `extraResources` (`haupt.mjs` erwartet sie unter `<resources>/Ressourcen`), AppUserModelID im Installer.
- Ein **eigenes Node** im Paket statt Electron-als-Node (Kern-Skripte, MCP-Einträge zeigen dann auf ein stabiles `node`; `BRAIN_MCP_NODE` gibt es schon), dazu Hook-Starter je System (A4).
- electron-updater (GitHub-Releases, `autoDownload = false`), Signatur (Windows: SignPath, Linux unsigniert), Release-Kette auf drei Runnern, Vorschau-Modus (`KORTEX_VORSCHAU`) für Electron.
- Chromium-Sandbox unter Linux im Paket: SUID-Helfer oder User-Namensräume; die CI richtet den Helfer ein (`chrome-sandbox` root, 4755) und lockert auf Ubuntu 24.04 `apparmor_restrict_unprivileged_userns`.

## 10. W2b Ergebnis (PR „W2b System-Funktionen der Electron-Hülle“)

Stand: Die Electron-Hülle hat die System-Funktionen der Mac-App: App-Menü, Tray, Schnell-Erfassen-Fenster mit globalem Kürzel, Mitteilungen, App-Symbole, durchscheinende Seitenleiste. Die Swift-App (`Sources/`) ist nur gelesen, nicht verändert. Je Funktion eine kleine Datei in `electron/`; die reine Logik ohne `import "electron"` (Test: `Tests/Node/electron-w2b.test.mjs`, gleicht Texte, Zahlen und Fälle gegen die Swift-Dateien ab), die echte App prüft `electron/test/w2b.spec.mjs` (Playwright `_electron`).

| Funktion | Datei | Umsetzung |
|---|---|---|
| App-Menü | `menue.mjs` | Aufbau und Texte wie das Hauptmenü der Mac-App (Ablage, Darstellung, Gehe zu, Fenster), deutsch. Die Kürzel stehen **nicht** im Code: jeder Eintrag nennt nur den Menü-Namen des Studio-Befehls, das Kürzel kommt aus `tastenkuerzel-register.json` plus eigener Belegung (`tastenkuerzel.json`, dieselbe Logik `gemeinsam/tastenkuerzel-logik.mjs` wie Studio und Werkstatt, auch der Gewinner bei doppelt belegten Kürzeln). Feste Einträge (Beenden, Kortex einrichten, Studio) nehmen ihr Kürzel aus den `reserviert`-Einträgen des Registers. Windows/Linux: Strg statt ⌘ (Cmd und Ctrl werden beide zu Strg, wie das Studio); das Menü **zeigt** die Kürzel nur (`registerAccelerator: false`), den Tastendruck fängt das Studio selbst ab, so wirkt nichts doppelt und kein Befehl ohne offenen Vault. `kuerzel-geaendert` baut das Menü neu. Kein Bearbeiten-Menü (Strg+C/V/Z gehören dem Editor). |
| Tray | `tray.mjs`, `haupt.mjs` | Menü wie die Menüleiste der Mac-App: Vault-Name, „Nur ansehen“, Zähler **neue Mitteilungen** (`ungelesen` des Aktivitätsprotokolls, wie die Glocke) und **Rückfragen** (nur wo die Werkstatt sie kennt, also mit Kit; die Zeile hat die Texte von `RueckfragenText`), Studio öffnen, Schnell erfassen, Abgleichen, Vault wechseln/öffnen, Dateimanager, Einstellungen, einrichten, Beenden; Tooltip mit Zähler. `status-auffrischen`, `vault-gewechselt`, `vertrauen-geaendert` lesen den Stand neu (gebündelt, ein Lauf je Sekunde, dazu alle 60 s). Windows: Klick öffnet das Studio, Schließen des Fensters läuft im Tray weiter; Linux: nur das Menü, Schließen beendet (ob ein Tray sichtbar ist, weiß die App nicht). Schlägt die Anlage fehl oder gibt es keine Tray-Unterstützung, läuft die App ohne (Zeile im Protokoll). `KORTEX_SCHLIESSEN_IN_TRAY=0/1` schaltet das Schließen-Verhalten um. Nicht umgesetzt: Zeile „N Aufgaben offen“ (die Mac-App holt sie aus dem Kit-Status). |
| Schnell erfassen + globales Kürzel | `erfassen.mjs`, `erfassen-fenster.mjs`, `erfassen/`, `erfassen-preload.cjs`, `kuerzel.mjs` | Kleines rahmenloses Fenster (560×276, immer oben, nicht in der Taskleiste, oben mittig auf dem Bildschirm mit dem Mauszeiger, Platzierung wie `ErfassenPlatzierung`), Esc und Fokusverlust schließen (das Fenster wird nur versteckt: der Entwurf bleibt). Aufgabe (Kurzformen `!hoch`, `morgen` … aus `gemeinsam/kurzformen.mjs`, Chips wählen von Hand, „×“ lässt die Kurzform als Text) oder Notiz (Posteingang); gespeichert über `POST /api/aufgaben` bzw. `/api/merken` der Werkstatt (Quelle `mensch`, nicht bestätigter Vault → „nur zum Ansehen“), die Art merkt `schnell-erfassen.json` wie in der Mac-App. Die Seite lädt über `kortex://erfassen/` nur ihre drei Dateien und drei Studio-Dateien (Farben, Kurzformen), CSP `default-src 'none'`, Sandbox, eine Schnittstelle `window.kortexErfassen`. Globale Kürzel (`globalShortcut`, Befehle des Registers mit `global: true`): Aktionen `kuerzel-global` und `kuerzel-geaendert` sind echt, **dieselben Antworten und Texte wie `KuerzelSteuerung.pruefeGlobal`** (Taste ungültig, ⌃/⌘ fehlt, reserviert, „schon von einem anderen Programm belegt“, „Dieses Kürzel gibt es nicht.“); ein Fehler lässt das bisherige Kürzel angemeldet; Beenden und `app.exit` geben alle frei. Wayland: eigener Hinweistext. Vorschau und Testlauf (`BRAIN_TESTMODUS`) melden nichts an (wie die Mac-App); Tests schalten es mit `KORTEX_TEST_GLOBALE_KUERZEL=1` und Tasten Strg+Alt+Umschalt+F7–F9 ein. Studio: `kannGlobaleKuerzel()` (App oder Electron) statt `inApp()` für `kuerzel-global`/`kuerzel-geaendert` und die Marke „Überall“. Nicht umgesetzt: Ziel-Vault wählen (das Fenster speichert in den aktiven Vault der Werkstatt; die Mac-App startet je Vault eine eigene Werkstatt), Kürzel im Fenster aufnehmen (geht in Einstellungen → Tastenkürzel), Diktat-Hinweis, Bewegung-reduzieren. |
| Mitteilungen | `mitteilungen.mjs`, `haupt.mjs` | Port von `MitteilungsPlaner`/`MitteilungsAblauf`/`MitteilungsEinstellungen`/`MitteilungsZiel` (gleiche Regeln: Schalter je Art aus `ART_SCHALTER`, Sammelfenster 5 s, höchstens 4 je Minute und dann „Weitere N Mitteilungen“, 5-s-Sperre, Abweisungs-Pause 10 min, „nur im Hintergrund“, nie Freitext aus dem Protokoll, nie Namen im Protokoll der Hülle) — der Leser nutzt `leseEreignisse`/`protokollKennungen` aus `gemeinsam/aktivitaet.mjs` (kein zweiter Leser), Takt 2 s. **Kontingent 80/100 %** kommt als Art `kontingent` aus der Werkstatt (je Fenster/Schwelle eine eigene Gruppe). Electron-`Notification`; Klick holt das Studio nach vorn und schickt den Befehl `aufgaben`/`posteingang`/`aktivitaet` (Ziel je Art wie in Swift). `mitteilung-probe` ist dieselbe Probe wie in der Mac-App. Windows: AppUserModelID wie am Mac. Nicht umgesetzt: Zugestelltes beim Aktivwerden zurückziehen (Electron kennt das nicht), Erlaubnis-Abfrage (Windows/Linux haben keine). |
| App-Symbol | `symbole.mjs`, `scripts/erzeuge-electron-symbole.mjs`, `symbole/` | Die fünf Varianten als `.png` (256), `.ico` (16/32/48/64/128/256) und Tray-`.png` (32) — **vom Skript erzeugt** aus denselben SVGs wie die Mac-Symbole (`--pruefen` prüft Köpfe und ICO-Verzeichnis, Test `electron-w2b.test.mjs`). `app-symbol` wechselt `setIcon` für Hauptfenster und Erfassen-Fenster und das Tray-Bild (Windows: Taskleiste zur Laufzeit nur über das Fenster); die gespeicherte Wahl (`appSymbol` in `einstellungen.json`) liest die Hülle beim Start. Das Starter-Symbol unter Linux/Windows bleibt fest (Paket W2c). Die Einstellungen „App-Symbol“ und „Systemmitteilungen“ sind in der Electron-Hülle sichtbar. |
| Durchscheinende Seitenleiste | `glas.mjs` | Nur Windows 11 22H2+ (Build 22621): `backgroundMaterial: "mica"` bzw. `"none"`, `data-glas` und `data-glas-moeglich` am `<html>`, Antwort `{ok:true, wirkt}`. Sonst `{ok:false, grund:"nicht-verfuegbar"}` und `data-glas-moeglich` fehlt (Einstellung ausgeblendet). Wunsch aus `seitenleisteDurchscheinend` (Standard an). Auf dem Linux-Runner prüft der Test die ablehnende Seite und mit Testschalter `KORTEX_TEST_GLAS_MOEGLICH=1` die Seite-Attribute; das echte Material zeigt nur der Windows-Lauf. |

**Vertrag:** Das Feld `electron` in `huellen-vertrag.json` ist für alle geänderten Aktionen aktualisiert (`vault-gewechselt`, `vertrauen-geaendert`, `status-auffrischen`, `mitteilung-probe`, `kuerzel-geaendert`, `kuerzel-global`, `app-symbol`, `fenster-durchscheinend`); `Tests/Node/huellen-vertrag.test.mjs` prüft weiter jede Aktion.

**Tests:** `Tests/Node/electron-w2b.test.mjs` (24 Fälle: Accelerator je System, globale Kürzel mit Attrappe, Menü aus dem Register, Tray, Planer mit Uhr von außen, Erfassen, Symbole, Glas, Abgleich mit den Swift-Dateien) und `electron/test/w2b.spec.mjs` (13 Fälle gegen die echte App: Menü-Einträge und Klick, Tray, Schließen in den Tray, Erfassen öffnen/speichern/Esc/Fokusverlust, Kürzel-Aktionen, Symbol-Wechsel, Mitteilungen aus dem Protokoll, Glas). Fenster-Fotos (Hauptfenster `electron-<system>.png`, Erfassen-Fenster `erfassen-<system>.png`) liegen als Artefakt `electron-probe-<os>` im CI-Lauf.

**Für W2c bleibt:** electron-builder (NSIS, AppImage, deb), AppUserModelID im Installer, eigenes Node, electron-updater, Signatur, Starter-Symbol der Pakete (die Laufzeit-Symbole gibt es jetzt), GitHub-Anmeldung (`KORTEX_GITHUB_CLIENT_ID`), Release-Kette, Vorschau-Modus für Electron; offen aus W2b: Zeile „Aufgaben offen“ im Tray, Ziel-Vault im Erfassen-Fenster, Linux-Erkennung eines sichtbaren Trays (heute beendet Schließen dort die App).
