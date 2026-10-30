# Kortex veröffentlichen

Stand 30.10.2026. Für die Person, die freigibt (Fabio). Nichts davon passiert von allein: Ein Release entsteht erst, wenn ein
Tag gesetzt wird, und ein stabiler Release erscheint erst, wenn du den Entwurf von Hand veröffentlichst.

**Wichtig:** Apple-ID, Kennwörter und Schlüssel tippst du nur selbst ein. Gib sie niemals in einen Chat, an Claude oder in eine Datei im Repo.
Hier stehen nur die **Namen** der Secrets und der Ort, an dem sie liegen, nie ihre Werte.

## 1. Wo wir stehen

| Baustein | Stand |
|---|---|
| Repo | öffentlich (`fabiobrogno/brain-app`), MIT, `main` geschützt (Pflicht-Check `ci-ok`), Secret-Scanning und Push-Schutz an |
| Apple Developer Program | aktiv, Zertifikat „Developer ID Application“ liegt im lokalen Schlüsselbund und als Secret im Repo |
| Signieren und Notarisieren | `scripts/veroeffentlichen.sh` (Hardened Runtime, Node mit `Ressourcen/node.entitlements`, App und DMG notarisiert und geheftet); Trockenlauf in CI belegt (28.10.), **ein echter Lauf mit Apple steht noch aus** |
| Sparkle 2.10.0 | in der App (`SUPublicEDKey`, `SUFeedURL` in `Ressourcen/Info.plist`), `appcast.xml` entsteht beim Signieren, **Update-Weg noch nie mit einer echten Vorversion getestet** |
| App-Icon, Lizenzen | Icon vorhanden; `THIRD-PARTY-NOTICES.md` liegt im Paket und in der App unter Einstellungen → „Lizenzen …“ |
| CI-Prüfung nach dem Signieren | unabhängig vom Skript: `codesign --verify`, `spctl -a -vv`, `xcrun stapler validate` an App, DMG und der App in der DMG; Appcast gegen Tag und DMG; Dateien im Release |

## 2. Kanäle: Beta bis zum Umzug auf das Firmenkonto

Bis das Repo auf das Firmenkonto umgezogen ist, gibt es **nur Betas** und kein Update-Versprechen. Grund: Der Umzug ändert
Repo-Adresse, Feed-Adresse (`SUFeedURL`) und womöglich die Bundle-ID. Eine stabile Version, die schon Updates ausliefert,
müsste danach bei allen Nutzern neu installiert werden.

| Tag | Was entsteht | Signatur | Updates |
|---|---|---|---|
| `v0.3.0-beta.N` | GitHub-**Prerelease** mit Zip und Prüfsumme | **unsigniert** (ad-hoc), nicht notarisiert | nein: `releases/latest/download/appcast.xml` ignoriert Prereleases, die Beta enthält keinen Appcast |
| `vX.Y.Z` (später) | Release-**Entwurf** mit Zip, DMG, `appcast.xml` | Developer ID, notarisiert, geheftet | ja, sobald du den Entwurf veröffentlichst |

Tags werden **nie** verschoben oder ersetzt. Ist ein Release fehlerhaft, folgt eine neue Nummer (`beta.2`, `0.3.1`).
Für Betas gilt die Gatekeeper-Anleitung aus der README („Trotzdem öffnen“).

## 3. Erster Beta-Tag `v0.3.0-beta.1`: wer macht was

| # | Schritt | Wer |
|---|---|---|
| 1 | PR „Release-Vorbereitung“ prüfen und mergen (`ci-ok` grün) | Fabio |
| 2 | Auf `main` nachsehen: Version in `Ressourcen/Info.plist` ist `0.3.0` (ein Beta-Tag wird **nicht** gegen die Plist geprüft; nur Stable-Tags) | Claude |
| 3 | Lizenz-, Marken- und Datenschutztexte lesen (README, `THIRD-PARTY-NOTICES.md`); Markenrecht für „Kortex“ prüfen lassen (`docs/namensrecherche-2026-10-24.md`) | Fabio |
| 4 | Entscheiden: Bundle-ID `io.github.fbrogno.brain` bleibt oder wird geändert. Nach dem ersten Release mit Updates **nicht mehr änderbar**, ohne dass Nutzer neu installieren | Fabio |
| 5 | Optional, aber empfohlen: Actions → „Release-Prüfung“ → Run workflow → `signier_probe` anhaken (Trockenlauf, signiert und veröffentlicht nichts; prüft die Secrets und den Skriptweg) | Fabio oder Claude |
| 6 | Tag setzen und pushen: `git tag -a v0.3.0-beta.1 -m "Kortex 0.3.0 Beta 1"` und `git push origin v0.3.0-beta.1` | Fabio (Claude nur nach ausdrücklicher Freigabe) |
| 7 | CI beobachten: `release-pruefung` baut, testet, packt, legt den Prerelease an und listet die Dateien | Claude |
| 8 | Zip laden und am **frischen Mac** (anderer Nutzer ohne Entwicklerwerkzeuge) installieren: Gatekeeper-Hinweis, Assistent, Vault anlegen, KI verbinden. Git-Voraussetzung prüfen: Erklärt der Assistent fehlendes Git verständlich? | Fabio |
| 9 | Fehler sammeln, beheben, `beta.2` | Claude |

## 4. Der stabile Weg (erst nach dem Umzug auf das Firmenkonto)

Voraussetzungen, alle nur von dir zu erledigen:

1. **Umzug**: Repo auf das Firmenkonto übertragen. Danach `SUFeedURL` in `Ressourcen/Info.plist`, Adressen in der README und `BRAIN_GITHUB_REPO` prüfen (die CI setzt es aus `github.repository`). Die sieben Secrets müssen im neuen Repo stehen.
2. **Bundle-ID und Repo-Name** endgültig entscheiden (siehe oben).
3. **Sparkle-Schlüssel gesichert** (Abschnitt 5).
4. **Test des Update-Wegs**: Eine Probe-Version `0.3.0` installieren, `0.3.1` veröffentlichen (oder als Entwurf prüfen), in der installierten App „Nach Updates suchen …“.

Ablauf pro Version:

1. Versionsnummer in `Ressourcen/Info.plist` erhöhen (`CFBundleShortVersionString` und `CFBundleVersion`, die zweite immer hochzählen). Der Tag `vX.Y.Z` **muss** zur Version passen, sonst bricht die CI ab.
2. PR, `ci-ok` grün, mergen.
3. Tag `vX.Y.Z` setzen und pushen (nur du, oder Claude auf deine ausdrückliche Anweisung).
4. CI: bauen, Tests, signieren (Hardened Runtime), App und DMG bei Apple notarisieren, heften, Appcast mit EdDSA-Signatur, danach **Gatekeeper-Prüfung** (`spctl`, `stapler validate`, Appcast gegen Tag), Zip + Artefakt, dann der Release-**Entwurf**.
5. Entwurf auf GitHub öffnen: Dateien (Zip, Prüfsumme, `Kortex-<Version>.dmg`, `appcast.xml`) und Notizen prüfen, **von Hand veröffentlichen**. Erst dann findet `latest/download/appcast.xml` die neue Version.
6. Sofort nachsehen: `curl -fsSL -o /dev/null -w "%{http_code}\n" -L https://github.com/<konto>/<repo>/releases/latest/download/appcast.xml` muss `200` liefern. Eine fehlerhafte Version erreicht alle Nutzer sofort; bei Problemen den Entwurf nicht veröffentlichen oder schnell eine neue Version nachschieben.

## 5. Der private Sparkle-Schlüssel (muss von dir gesichert sein)

- Er liegt als Secret `SPARKLE_ED_PRIVATE_KEY` im Repo (GitHub → Settings → Secrets and variables → Actions) und im Schlüsselbund deines Macs (Eintrag von `generate_keys`). Den **öffentlichen** Schlüssel trägt `Ressourcen/Info.plist` als `SUPublicEDKey`.
- **Geht der private Schlüssel verloren, bekommen alle bestehenden Nutzer nie wieder ein Update.** Eine neue Schlüsselpaarung erfordert eine Neuinstallation.
- Bitte bestätige für dich selbst, dass es **zwei getrennte Sicherungen** gibt (zum Beispiel Passwortmanager und verschlüsselter Stick). Export: `./bin/generate_keys -x <datei>` aus dem Sparkle-Werkzeugordner (Sparkle 2.10.0, `https://github.com/sparkle-project/Sparkle/releases`). Die Datei gehört nie ins Repo und nie in einen Chat.
- Claude kann nicht prüfen, ob die Sicherung existiert, und liest den Wert nie.

## 6. Secrets und Ablaufdaten

Namen der sieben Repo-Secrets (Werte nur bei dir): `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `BRAIN_SIGNIER_ID`,
`NOTAR_KEY_P8_BASE64`, `NOTAR_KEY_ID`, `NOTAR_ISSUER_ID`, `SPARKLE_ED_PRIVATE_KEY`. Fehlt eines, bricht die CI mit dem Namen
des Secrets ab; es wird nie unsigniert als Stable ausgeliefert.

Trage dir Kalendererinnerungen ein: Das Developer-ID-Zertifikat läuft nach fünf Jahren ab (Datum im Schlüsselbund unter dem Zertifikat), der
App-Store-Connect-API-Schlüssel (Rolle Developer) endet mit dem Widerruf, und die Mitgliedschaft im Apple Developer Program
verlängert sich jährlich. Ein Ablauf am Tag des Releases ist vermeidbar.

## 7. Lokal veröffentlichen (ohne CI, nur im Notfall)

Nur nötig, wenn die CI nicht läuft. Einmalige Einrichtung:

1. Notar-Zugang ablegen (Profilname frei, hier `brain-notar`): `xcrun notarytool store-credentials brain-notar`. Das Werkzeug fragt nach Apple-ID, Team-ID und einem **app-spezifischen Kennwort** (appleid.apple.com → Anmeldung und Sicherheit). Du tippst sie selbst ein; sie landen im Schlüsselbund.
2. Sparkle-Werkzeuge 2.10.0 nach `~/Werkzeuge/sparkle` entpacken (Archiv von der Sparkle-Releaseseite, SHA-256 wie in `release-pruefung.yml`).

Dann:

```bash
bash scripts/baue-app.sh
export BRAIN_SIGNIER_ID="Developer ID Application: <Name> (<TEAMID>)"
export BRAIN_NOTAR_PROFIL="brain-notar"
export SPARKLE_BIN="$HOME/Werkzeuge/sparkle/bin"
export BRAIN_GITHUB_REPO="<konto>/<repo>"
bash scripts/veroeffentlichen.sh --trocken     # verändert nichts, meldet „FEHLT“, was noch fehlt
bash scripts/veroeffentlichen.sh               # signiert, notarisiert (meist 2 bis 10 Minuten je Datei), DMG, Appcast
bash scripts/pruefe-signatur.sh                # alles „ok“?
```

Das Hochladen übernimmt der Befehl, den das Skript am Ende ausgibt (`gh release create v<Version> build/Kortex-<Version>.dmg build/appcast.xml …`).
Lokal gebaute Releases nie parallel zur CI-Spur für dieselbe Version.

## 8. Was bei Node beachtet wurde

Die mitgelieferte Node-Laufzeit wird neu signiert und bekommt nur zwei Rechte (`Ressourcen/node.entitlements`):
`allow-jit` und `allow-unsigned-executable-memory`. Node erzeugt zur Laufzeit Maschinencode, ohne diese Rechte stürzt es unter Hardened Runtime ab.
Nach dem Signieren wird die Prüfsumme des signierten Node ins Manifest nachgezogen (`scripts/node-manifest.sh nachziehen`), damit die
App-interne Prüfung stimmt.

## 9. Offene Punkte vor dem ersten stabilen Release

- Ein **echter** Lauf der Kette mit Apple (Notarisierung, Heften, Gatekeeper) und der Update-Weg 0.3.0 → 0.3.1 sind noch nie gelaufen.
- Bundle-ID und Repo-Name endgültig, Markenrecht für „Kortex“ geprüft (beides nur du).
- Test am frischen Mac (Git-Voraussetzung, Assistent, Gatekeeper, Update).
- Homebrew-Cask (FBL-80) und Website sind optional und folgen der ersten echten DMG-Adresse.
