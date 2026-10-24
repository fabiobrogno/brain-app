# Brain veröffentlichen — Schritt für Schritt

Für Fabio. Dauer: einmalig etwa eine Stunde Einrichtung, danach pro Version ein Befehl.
**Wichtig:** Apple-ID, Kennwörter und Schlüssel tippst du nur selbst ein. Gib sie niemals an Claude oder in einen Chat.

## 1. Mitgliedschaft prüfen

Du brauchst das **Apple Developer Program** (99 USD pro Jahr). Es ist aktiv, wenn
Xcode im nächsten Schritt „Developer ID Application“ anbietet. Sonst auf developer.apple.com anmelden und beitreten.

## 2. Zertifikat „Developer ID Application“ anlegen

1. Xcode öffnen, Einstellungen, **Accounts**, deine Apple-ID wählen, **Manage Certificates…**
2. Unten links **+**, dann **Developer ID Application** wählen.
3. Prüfen, ob es im Schlüsselbund liegt:
   `security find-identity -v -p codesigning`
   Es muss eine Zeile `Developer ID Application: … (TEAMID)` geben. Bisher gibt es nur „Apple Development“, das reicht nicht.
4. Den Namen in Anführungszeichen für den Release-Befehl merken (Schritt 6).

## 3. Notar-Zugang einmal ablegen

1. Auf appleid.apple.com ein **app-spezifisches Kennwort** erzeugen (Anmeldung und Sicherheit, App-spezifische Kennwörter).
2. Im Terminal (Profilname frei wählbar, hier `brain-notar`):
   `xcrun notarytool store-credentials brain-notar`
3. Das Werkzeug fragt nach Apple-ID, Team-ID und dem app-spezifischen Kennwort. Du tippst sie selbst ein.
   Sie landen im Schlüsselbund, nicht in einer Datei.

## 4. Sparkle-Werkzeuge holen und Schlüssel erzeugen

Aktuelle Sparkle-2-Version: **2.10.0** (Stand 24.10.2026, Mindest-macOS 12, passt zu uns).

```bash
mkdir -p ~/Werkzeuge/sparkle && cd ~/Werkzeuge/sparkle
curl -L -o Sparkle-2.10.0.tar.xz \
  https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-2.10.0.tar.xz
tar -xf Sparkle-2.10.0.tar.xz
./bin/generate_keys
```

`generate_keys` legt den **privaten Schlüssel im Schlüsselbund** an und zeigt den **öffentlichen Schlüssel** an (eine
lange Zeichenkette). Den öffentlichen Schlüssel gibst du Claude (er ist nicht geheim): Er kommt in `Ressourcen/Info.plist`
als `SUPublicEDKey`.

**Den privaten Schlüssel doppelt sichern:** `./bin/generate_keys -x brain-sparkle-privat.key` exportiert ihn in eine Datei.
Diese Datei auf zwei getrennte Orte legen (z. B. Passwortmanager und verschlüsselter Stick), nie ins Repo, nie in einen
Chat. Geht er verloren, bekommen bestehende Nutzer keine Updates mehr.

## 5. Update-Adresse festlegen

Updates liegen kostenlos auf GitHub Releases des **öffentlichen** Repos. Die feste Adresse des Feeds lautet:

`https://github.com/<konto>/<repo>/releases/latest/download/appcast.xml`

Diese Adresse kommt als `SUFeedURL` in `Ressourcen/Info.plist` (macht Claude zusammen mit dem Sparkle-Einbau).
Dafür muss das Repo öffentlich sein, sonst kann niemand ohne Anmeldung laden.

## 6. Eine Version veröffentlichen

1. Versionsnummer in `Ressourcen/Info.plist` erhöhen (`CFBundleShortVersionString` und `CFBundleVersion`, die zweite immer hochzählen).
2. App bauen: `bash scripts/baue-app.sh`
3. Erst nur prüfen (verändert nichts):

```bash
export BRAIN_SIGNIER_ID="Developer ID Application: Dein Name (TEAMID)"
export BRAIN_NOTAR_PROFIL="brain-notar"
export SPARKLE_BIN="$HOME/Werkzeuge/sparkle/bin"
export BRAIN_GITHUB_REPO="<konto>/<repo>"
bash scripts/veroeffentlichen.sh --trocken
```

4. Wenn nichts mehr als „FEHLT“ gemeldet wird: dasselbe ohne `--trocken`. Das signiert, schickt die App zu Apple
   (Wartezeit meist 2 bis 10 Minuten), baut die DMG, notarisiert sie und schreibt `build/appcast.xml`.
5. Kontrolle: `bash scripts/pruefe-signatur.sh` (alles „ok“?).
6. Hochladen (der Befehl wird am Ende des Laufs ausgegeben):

```bash
gh release create v0.1.0 build/Brain-0.1.0.dmg build/appcast.xml \
  -R <konto>/<repo> --title "Brain 0.1.0" --notes "Frühe Version."
```

`appcast.xml` immer zusammen mit der neuen DMG hochladen. Das Skript ergänzt die bestehende Datei, ein älterer Eintrag
bleibt erhalten. Liegt die alte `appcast.xml` nicht mehr in `build/`, zuerst laden:
`gh release download -R <konto>/<repo> -p appcast.xml -D build --clobber`

## 7. Was bei Node beachtet wurde

Die mitgelieferte Node-Laufzeit wird mit neu signiert und bekommt nur zwei Rechte (`Ressourcen/node.entitlements`):
`allow-jit` und `allow-unsigned-executable-memory`. Node erzeugt zur Laufzeit Maschinencode, ohne diese Rechte stürzt es
unter Hardened Runtime ab. Mehr Rechte gibt es nicht.

## Was danach Claude macht

Sobald du den **öffentlichen Sparkle-Schlüssel** nennst und das Repo öffentlich ist:

1. Sparkle 2.10.0 per Swift Package Manager einbauen und in `baue-app.sh` ins Paket legen (`Contents/Frameworks`).
2. `SUPublicEDKey`, `SUFeedURL` und die Update-Prüfung in die App einbauen (Menüpunkt „Nach Updates suchen…“).
3. Prüfen, dass der Signier-Lauf Sparkles Hilfsprogramme mitsigniert, und einen Testlauf mit einer Probe-Version (0.1.0 auf 0.1.1) durchspielen.
4. Offene Frage klären: Die Node-Prüfsumme im App-Manifest bezieht sich auf die Original-Datei. Nach dem Neusignieren ändert sich der Hash der Datei im Paket. Die Prüfung muss dann gegen die Original-Prüfsumme der Quelle oder die Developer-ID-Signatur laufen.
