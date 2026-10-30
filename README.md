# Kortex

**Ein Editor für dein Wissen, der weiß, was davon stimmt, und an dem deine KI direkt mitarbeitet.**

[English version](README.en.md) · [Lizenzen von Dritten](THIRD-PARTY-NOTICES.md)

Kortex ist eine Mac-App für Ordner mit Markdown-Notizen, die Vaults. Zu jeder Seite zeigt sie, ob sie belegt, abgelaufen,
strittig oder noch ungeprüft ist. Dein Vault bleibt die einzige Wahrheit: Kortex liest und schreibt nur normale Dateien und
erhält deinen Text Byte für Byte.

> **Beta.** Kortex ist jung und wird noch viel angefasst. Ecken und Fehler sind wahrscheinlich, und bis zur ersten
> stabilen Version gibt es kein Update-Versprechen. Dein Vault liegt in Git, sodass du Änderungen zurückholen kannst. Eine
> Sicherung ersetzt das trotzdem nicht.

## Was Kortex kann

- **Vaults:** Lege einen neuen Vault an, öffne einen vorhandenen Ordner oder starte mit dem Beispiel-Vault. Du kannst mehrere
  Vaults führen und zwischen ihnen wechseln.
- **Studio-Editor:** Markdown mit Live-Vorschau, `[[Wikilinks]]`, automatischem Speichern und Befehlspalette (⌘K). Jede
  Seite trägt ein Prüf-Signal (belegt, abgelaufen, strittig, ungeprüft). Dazu kommen eine Gesundheitsübersicht und eine 3D-Ansicht
  des Vaults.
- **Suche und Schnell merken:** Suche über alle Seiten; was du nicht verlieren willst, landet mit einem Handgriff im Posteingang.
- **Aufgaben:** Ein Board im Vault, auf dem du und deine KI Aufgaben anlegen, verschieben und abhaken.
- **Schnell erfassen:** Von überall mit ⌃⌥Leertaste (in dem Fenster änderbar): ein kleines Fenster für eine Aufgabe oder eine
  Notiz, auch bei geschlossenem Studio. Kurzformen wie „morgen“ oder „!hoch“ setzen Fälligkeit und Priorität; Diktat geht mit Fn
  zweimal. Das Kürzel braucht keine Bedienungshilfen-Rechte.
- **Abgleich und Sicherung mit git:** Änderungen ansehen und auswählen, sichern, Verlauf mit Vergleich, alte Fassungen
  wiederherstellen. Abgleich mit deinem eigenen git-Remote oder GitHub; Konflikte werden erklärt, nichts wird still überschrieben.
  Auf Wunsch sichert der Assistent den Vault in ein privates GitHub-Repository.
- **KI verbinden:** Kortex erkennt deine KI-Programme und trägt seinen lokalen MCP-Server dort ein: Claude Code, Claude Desktop,
  Codex, Cursor, Gemini CLI, GitHub Copilot (CLI), Zed, OpenCode und Warp. Die KI liest dein Wissen mit Quellen und legt
  Merkzettel im Posteingang ab; ins Wiki schreibt sie nie direkt. Wer sie zusätzlich dürfen soll, entscheidest du.
- **KI-Konten und Zugriff:** Kortex unterscheidet deine KI-Konten (zum Beispiel ein privates und ein Firmenkonto von Claude Code)
  und legt je Konto und Vault fest, was es darf: gesperrt, lesen, Posteingang oder erweitert. Neue Konten starten gesperrt.
  Die Durchsetzung ist eingebaut; die Oberfläche dafür folgt in den nächsten Beta-Versionen.
- **Vertrauen:** Ein Ordner, der von außen kommt, ist zunächst „Nur ansehen“: kein git, kein Hintergrunddienst, keine Hooks, keine
  Anweisungen an die KI. Erst wenn du dem Vault vertraust, wird er voll nutzbar. Du kannst das jederzeit zurücknehmen.
- **Umstellung alter Vaults:** Hast du einen Vault aus der Zeit des Vorgängers (mit eigenem Werkzeugordner), prüft „Vault
  umstellen …“ zuerst an einer Kopie, stellt dann Schritt für Schritt um und kennt für jeden Schritt einen Rückweg.

## Installation

Kortex läuft nur auf **Apple Silicon (M1 oder neuer)** mit **macOS 26 oder neuer**. Git muss installiert sein (es gehört
zu den Xcode-Kommandozeilentools: `xcode-select --install`).

1. Lade unter **Releases** die neueste Datei herunter. Die Beta-Versionen (`v0.3.0-beta.N`) sind ein Zip, die späteren
   stabilen Versionen eine `Kortex-<Version>.dmg`.
2. Zip entpacken (DMG öffnen) und **Kortex** in den Ordner **Programme** ziehen.
3. Beim ersten Start meldet macOS bei einer Beta, dass es Kortex nicht prüfen kann. Das ist normal, die Beta ist noch nicht
   von Apple notarisiert. So öffnest du sie trotzdem: Starte Kortex einmal, öffne **Systemeinstellungen → Datenschutz &
   Sicherheit**, scrolle zu „Kortex wurde blockiert“ und wähle **Trotzdem öffnen**. (Rechtsklick → Öffnen genügt unter macOS 26 nicht mehr.)
   Wer lieber das Terminal nutzt: `xattr -dr com.apple.quarantine /Applications/Kortex.app`.
4. Starte Kortex. Der Assistent legt deinen ersten Vault an und verbindet auf Wunsch deine KI-Programme.

Stabile Versionen sind signiert, von Apple notarisiert und aktualisieren sich über Sparkle selbst („Nach Updates suchen …“ im Menü).

## Datenschutz

- **Alles bleibt auf deinem Mac.** Deine Notizen liegen in deinem Vault-Ordner. Kortex hat keinen Server, keine Telemetrie, keine
  Analyse und lädt keine Berichte hoch.
- **Netzverbindungen** gibt es nur, wenn du sie auslöst oder in diesen Fällen: der **git-Abgleich** mit deinem Remote (dorthin
  gehen deine Notizen und nirgendwo sonst hin), die **GitHub-Anmeldung** und das Anlegen oder Klonen von Repositories, und die
  **Update-Abfrage** (Kortex lädt die Datei `appcast.xml` von GitHub; dabei sieht GitHub deine IP-Adresse, Kortex schickt kein Systemprofil).
- Es gibt keinen offenen Netzwerk-Port. Die Oberfläche spricht über eine interne Brücke mit der App, die KI-Programme über
  Standard-Ein- und -Ausgabe (MCP) mit dem lokalen Server.
- **Deine KI-Programme** haben eigene Datenschutzregeln: Was sie aus dem Vault lesen, geht an ihren Anbieter. Deshalb legst du
  je KI-Konto fest, was sichtbar ist.
- Kortex arbeitet nur in deinen Vaults und in `~/Library/Application Support/Kortex`.

## Entwicklung

Bauen, testen, CI und Veröffentlichen beschreibt [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md); die Schritte zum Veröffentlichen stehen in
[docs/veroeffentlichen.md](docs/veroeffentlichen.md). Kurz:

```bash
swift build && swift test        # Swift-Teil
bash scripts/teste-node.sh       # Node-Tests
bash scripts/baue-app.sh         # baut build/Kortex.app (arm64)
```

Beiträge sind willkommen: Fehler und Wünsche als Issue, Änderungen als Pull Request (die CI muss grün sein).

## Lizenz

Kortex steht unter der MIT-Lizenz, siehe [LICENSE](LICENSE). Copyright 2026 Fabio Brogno. Software und Material von Dritten, die
Kortex mitliefert (Node.js, Sparkle, CodeMirror, three.js, Geist, Simple Icons und weitere), steht in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); in der App findest du den Text unter Einstellungen → „Lizenzen …“.

## Markenhinweis

Namen und Logos von Anthropic (Claude), OpenAI (Codex), Anysphere (Cursor), Google (Gemini), GitHub, Zed, OpenCode, Warp und
anderen gehören ihren Inhabern. Kortex zeigt sie nur, um Programme zu kennzeichnen, mit denen es sich verbindet. **Kortex ist mit
keinem dieser Unternehmen verbunden und wird von ihnen weder empfohlen noch unterstützt.**
