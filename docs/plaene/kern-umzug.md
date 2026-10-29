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
- Der Kern startet git nur über `Ressourcen/kern/git-sicher` (Shell-Skript) mit `git-sicher-pruefung.pl`: git von festen Orten, Härtung wie die Werkstatt (kein fsmonitor, keine Hooks außer dem eigenen `git-hooks`-Ordner des Kerns, kein ext::, keine Submodule, keine Signierung, `GIT_SSH_COMMAND` und `GIT_NO_LAZY_FETCH` immer gesetzt, geerbte `GIT_DIR`/`GIT_CONFIG_*` verworfen). **Erlaubnisliste statt Sperrliste (fail-closed):** jeder lokale/worktree-Schlüssel der Repo-Konfiguration (NUL-getrennt gelesen) muss auf der Liste harmloser Schlüssel stehen und einen zulässigen Wert haben, sonst Exit 126 mit dem Schlüsselnamen. Erlaubt: `core.{repositoryformatversion,filemode,bare(false),logallrefupdates,ignorecase,precomposeunicode,symlinks,longpaths,autocrlf,eol,safecrlf,quotepath,hookspath}`, `user.{name,email}` (harmlose Zeichen: keines von Semikolon, Dollar, Backtick, senkrechter Strich, &, <, >, Backslash, kein Zeilenumbruch/Steuerzeichen, weil git sie in Reflog-Zeilen schreibt), `remote.<n>.{url,pushurl,fetch}` (url nur `https://`, `ssh://` oder `user@host:pfad`; **lokale Adressen (absoluter Pfad, `file:///`) sind verboten**, weil ein Push die Hooks des Ziel-Repos startet; kein `ext::`/`fd::`, kein `-`; nur die Testumgebung erlaubt lokale), `branch.<n>.{remote,pushremote,merge,rebase,description,vscode-merge-base}`, `pull.{rebase,ff}`, `merge.ff`, `push.{default,autosetupremote,gpgsign}`, `init.defaultbranch`, `fetch.prune`, `rebase.autostash`, `commit.gpgsign`, `tag.gpgsign`, `gc.{auto,autopacklimit,autodetach,pruneexpire,reflogexpire,reflogexpireunreachable,worktreepruneexpire}` (feste Liste, Zahl/Wahrheitswert/Zeitangabe), `extensions.{objectformat,worktreeconfig}`. Alles andere ist verboten (`include.*`, `http.*`, `url.*.insteadOf`, `man.*`, `help.*`, `submodule.*`, `credential.*`, `core.{fsmonitor,worktree,sshCommand,editor,pager,…}`, Filter-/Diff-/Merge-Treiber, `remote.*.{promisor,proxy,uploadpack,…}`, `extensions.partialclone`). Wahrheitswerte gelten nur als `true/false/yes/no/on/off/0/1` (git deutet `2` oder einen Schlüssel ohne Wert als wahr). `http.sslVerify/proxy/…` werden nicht erzwungen: lokal sind sie nicht erlaubt, system/global sind die Einstellungen des Nutzers (Firmen-Proxy, eigene Zertifikate). Außerdem Exit 126 ohne feststellbaren Arbeitsbaum, bei einem Arbeitsbaum, der kein Elternordner des `-C`-Ordners ist, bei einem Git-Verzeichnis außerhalb des Arbeitsbaums (`.git`-Datei mit `gitdir:` nach draußen), bei `objects/info/alternates`, bei jedem **Verweis (Symlink) im Git-Verzeichnis** (gemeinsames und eigenes; ausgenommen die Objektdateien `objects/??/*`, `objects/pack/*` und `hooks/*`, weil sonst `logs/HEAD`, `COMMIT_EDITMSG`, `FETCH_HEAD` oder ein Verweis als `objects` git außerhalb schreiben ließen) und bei den Unterbefehlen `help`/`submodule`; auch `config` bekommt die Lage- und Verweisprüfung (aber keine Erlaubnisliste; ohne `-C` und mit `--global/--system/--file` wird nichts geprüft); das Git-Verzeichnis jedes Arbeitsbaums (`--absolute-git-dir`) wird wie das gemeinsame gegen den Arbeitsbaum geprüft; im Hook (`GIT_INDEX_FILE` gesetzt) bleibt `GIT_DIR` nur stehen, wenn es unter dem `-C`-Ordner liegt; ausgenommen sind die verknüpften Arbeitsbäume des Tageslaufs unter `~/Library/Caches/brain-tageslauf`. `BRAIN_GIT_PROGRAMM`, `BRAIN_GIT_HOOKS_ERLAUBT` und `BRAIN_TAGESLAUF_CACHE` wirken nur in der Testumgebung. Die Werkstatt fährt weiter ihre Sperrliste mit Vertrauensfrage (`vertrauen.mjs`); `Tests/Node/kern-git-haertung.test.mjs` hält beide zusammen (nichts Gefährliches der Werkstatt steht auf der Erlaubnisliste; jedes Beispiel wird verweigert).
  Folge: Ein Vault mit lokalem `credential.helper`, `core.sshCommand`, Filter-/Diff-/Merge-Treibern (z. B. git-lfs), `url.*.insteadOf` oder Partial Clone arbeitet im Kern ohne git (Online-Sicherung `backup.mjs`, Push der Sitzungs-Sicherung in `session-hintergrund.mjs`, Verlauf); die Einstellung gehört in die globale Konfiguration.
- Schreibziele: `ordner.inbox/wiki/archiv` (und `wiki.ordner`) in der Vault-Config sind ein einzelner Name (`pfade.mjs#ordner`, sonst Standard); `pruefeVault` verweigert (Exit 2, Hooks still Exit 0) einen Vault, dessen `.logs`, Inbox/Wiki/Archiv, `AGENTS.md`, `CLAUDE.md`, `graph.json` oder `_index.md` per Verweis (auch ins Leere) aus dem Vault hinauszeigt. Tiefer im Baum (`.logs/werkzeug.log → ~/.zshrc`, Wiki-Unterordner) schützt `vault-schutz.mjs`: nach `pruefeVault` laufen alle schreibenden `node:fs`-Funktionen (write/append/copy/cp/rename/open/mkdir/unlink/rm) für Pfade unter dem Vault durch `sicheresZiel` (Verweise müssen im Vault bleiben, kein Verweis als Ziel, `nlink` ≤ 1, `O_NOFOLLOW`). Geschützt sind auch `utimes`, `chmod`, `symlink`/`link` (Ziel und Verweispfad müssen im Vault liegen), die Callback- und `fs.promises`-Varianten, `createWriteStream` sowie URL- und Buffer-Pfade. Noch ungeschützt: die Schreibzugriffe von Werkstatt und MCP-Server (`gemeinsam/nutzung.mjs` schreibt `.logs/mcp.log`) — eigener Befund für P5.
- Sicherungsordner: `backup.pfad` steht nicht mehr in der Vault-Config, sondern je Vault im Support-Ordner (`<Support>/backup/<Kennung>.json`, von `brain backup einrichten ordner:<pfad>`); absolut, ein Ordner, kein Verweis, bei jedem Gebrauch neu geprüft. Ältere Vaults mit `pfad` in der Config müssen die Sicherung neu einrichten (der Kern sagt es). Die „heute schon gesichert“-Prüfung rechnet wie das Bundle nach Ortszeit (vorher UTC).
- Online-Sicherung nur zu einem bestätigten Ziel: Ein fremder Vault kann ein `origin` mitbringen. `backup.mjs#pushErlaubnis` (und damit `brain backup` und der Push in `session-hintergrund.mjs`) pusht nur, wenn `<Support>/backup/<Kennung>.json` ein `remoteBestaetigt` mit genau der Adresse des `origin` enthält. Gesetzt wird es dort, wo der Nutzer das Ziel selbst einrichtet: Assistent „Sicherung“ (`/api/sicherung/verbinden`), Studio „Remote hinzufügen“ (`/api/git/remote`, beide über `gemeinsam/sicherungsmerker.mjs`) und `brain backup einrichten github` (nur für https/ssh-Adressen; `keins` löscht es). Ohne Merker: kein Push, im Sitzungsstart eine Logzeile „Push übersprungen: Remote nicht bestätigt“, bei `brain backup` ein freundlicher Satz. `backup wiederherstellen` entfernt ein lokales `origin` des Klons (Bundle/Ordner), damit der Vault nicht für `git-sicher` gesperrt ist. `Tests/Node/sicherungsmerker.test.mjs` hält Werkstatt und Kern zusammen.
- Die Pflege-KI (`pflege-ki.mjs`) lädt mit `--setting-sources user` nur die Einstellungen des Nutzers, nie die `.claude/settings.json` der Vault-Kopie. Die Haiku-Aufrufe (`ernte.mjs`) laufen in einem leeren Temp-Ordner und behalten `project`.
- MCP: ein alter Eintrag mit Server unter `.tools` wird nur ohne Rückfrage umgestellt, wenn dieses `.tools` zu einem Vault aus `vaults.json` gehört.
- Offen für P5/Windows: die Windows-Zweige des Kerns (MinGit-Pfad) laufen ohne diese Härtung.

- Mittelfristig: die Perl-Prüfung (`git-sicher-pruefung.pl`) nach Node/Swift verlegen (eine Sprache, einfacher zu testen; Perl liegt auf macOS, aber nicht auf Windows).

### Für P5: VaultVertrauen kommt zurück als Workspace-Trust
In Kortex angelegte oder über den Assistenten geklonte Vaults gelten als vertraut; von außen kopierte Ordner (Zip/AirDrop/Cloud) → einmalige Frage, bis dahin kein git, kein Dienst, keine Hooks. Der bestätigte Online-Sicherungsort (`remoteBestaetigt`, siehe oben) ist der erste Baustein dieses Modells und kann dann in denselben Vertrauensspeicher wandern.

### Für P7 (Umstellungs-Assistent für bestehende Vaults)
- Der Assistent prüft jeden bestehenden Vault auf lokale Git-Schlüssel, die nicht auf der Erlaubnisliste von `git-sicher-pruefung.pl` stehen (am einfachsten: `git-sicher status` im Probelauf; Exit 126 nennt den ersten Schlüssel, die vollständige Liste liefert `git config --local --list --show-scope`), und zeigt sie dem Nutzer in Klartext (nur Namen).
- Für jeden Schlüssel bietet er an, ihn in die GLOBALE Konfiguration des Nutzers zu verschieben (typisch `credential.helper`, `core.sshCommand`, `url.*.insteadOf`, `http.*`, `core.editor`) — mit Rückweg: vorher Sicherung der `.git/config` (`config.vor-kortex`), danach „Rückgängig“ stellt sie wieder her. Schlüssel, die sich nicht verschieben lassen (Filter-/Merge-Treiber wie git-lfs, `core.worktree`, Partial Clone), werden erklärt; solche Vaults laufen im Kern ohne git, bis der Nutzer sie anders einrichtet.
- Vaults mit einem lokalen Remote (absoluter Pfad/`file:///`) oder einem Verweis im `.git`-Ordner laufen im Kern ohne git; der Assistent nennt es und bietet an, das Remote zu entfernen bzw. den Verweis aufzulösen. Ein vorhandenes https/ssh-`origin` wird dort bestätigt (Merker `remoteBestaetigt`), wenn der Nutzer die Sicherung bestätigt.
- Ein altes `backup.pfad` in der Vault-Config wird in den Support-Ordner übernommen (`brain backup einrichten ordner:<pfad>`), danach aus der Config entfernt.
