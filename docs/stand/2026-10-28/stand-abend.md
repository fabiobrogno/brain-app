# Stand Kortex, 28.10.2026 abends

Nachtrag zum [Stand vom Tag](README.md). Ab heute Abend arbeitet Claude Code direkt in den Repos (Konto `fabiobrogno`). Das Paperclip-Team soll in dieser Zeit pausieren, damit nicht doppelt gebaut wird. Jeder PR läuft durch CI und ein Opus-Review, bevor er gemergt wird.

## Richtungsentscheidung: ein Repo, eine App

Fabio, 28.10.2026: „Man installiert die App und alles funktioniert nur über diese App — ein Repo.“

- Die Logik des bisherigen Kits wandert als `Ressourcen/kern/` in dieses Repo und wird im signierten App-Bundle ausgeliefert. Der Vault enthält nur noch Daten.
- Der Kern bleibt plattformneutral. Eigene Installer für Windows und Linux entfallen.
- `second-brain-kit` wird nach der Umstellung archiviert.
- Support-Ordner künftig `~/Library/Application Support/Kortex`.
- Ein bestehender Vault mit `.tools/` wird erst nach einem erfolgreichen Test an einem Klon umgestellt, und nur mit Fabios Freigabe.
- Vorbild für Einrichtung und Bedienung: Tolaria (Vaults, eingebauter git-Client).

Plan mit Paketen P0–P9: [docs/plaene/kern-umzug.md](../../plaene/kern-umzug.md).

### Befund aus P0 (Bestandsabgleich)

- Die eigentliche Quelle des Kits ist der private Quell-Vault, nicht das öffentliche `second-brain-kit`. Das öffentliche Repo ist ein Export vom 12.10. (v0.5.1).
- **Der B1–B3-Code ist nicht verloren.** Alle 84 Code- und Testdateien der Pläne B1, B2 und B3 liegen im Quell-Vault (die Arbeit von v0.6 bis v0.9 ist dort am 22.10. gemergt). Der Neubau von B1-Teilen im öffentlichen Kit war deshalb doppelt. Für den Import gilt die Fassung aus dem Quell-Vault.
- Importiert wird als Kopie ohne Historie, weil die Historie des Quell-Vaults private Commits enthält. Die Privatheitsprüfung des Kandidaten fand keine privaten Pfade, E-Mail-Adressen, Secrets oder Namen. Zwei Test-Beispiele werden vor dem Import neutralisiert.

## Heute gemergt

**brain-app**

| PR | Inhalt | Paperclip |
|---|---|---|
| #12 | GitHub-Anmeldung per Gerätecode, Token nur im Schlüsselbund | FBL-86 |
| #14 | KI verbinden: Codex und Cursor zusätzlich zu Claude, mit Selbsttest. Nach Review: Dateirechte und Symlinks der Cursor-Datei bleiben erhalten, Cursor wird auch ohne CLI erkannt, höchstens 3 Sicherungen | FBL-70 |
| #16 | Lokale Nutzungsmessung: welche Seiten die KI per MCP abruft (`.logs/mcp.log`, nie Suchbegriffe, nichts verlässt den Rechner), Dialog „KI-Nutzung“ im Studio | FBL-72 |
| #17 | Einrichtung: git prüfen und Apples Installationsdialog auslösen | FBL-85 |
| #18 | Menüleiste: ⚠ bei stillstehender Zuführung, auch wenn der Wächter selbst nicht mehr läuft | FBL-94 |
| #19 | Posteingang: Verwerfen, Später und In Seite übernehmen, je ein Commit, nichts wird gelöscht | FBL-68, FBL-71 |

**second-brain-kit** (wird archiviert, Inhalte fließen in den Kern)

| PR | Inhalt |
|---|---|
| #9 | Kit-Adressen auf `fabiobrogno` |
| #13 | Wächter für Zuführungen, `.logs/zufuehrungen.json` |
| #14 | B1-1 `beleg.mjs` |
| #16 | B1-7 `seitenfelder.mjs` + Lint |
| #17 | Nacharbeiten aus dem Review, darunter ein flackernder Test |

## Offen

| PR | Inhalt | Stand |
|---|---|---|
| brain-app #20 | Assistent „Kortex einrichten“: git, Vault (neu, öffnen, klonen), GitHub, KI verbinden, Probe-Frage | Review-Fixes laufen |
| brain-app #21 | P3: Laufzeit mit Kern, Starter `kortex`, Support-Ordner Kortex | in Arbeit |
| brain-app (neu) | P1: Kern-Import nach `Ressourcen/kern/` und `Tests/Kern/`, CI-Job `kern-test` | in Arbeit |
| brain-app (neu) | Vorschau-Modus: App wie frisch installiert starten, alles in einem Wegwerf-Ordner | in Arbeit |
| second-brain-kit #12 | Suche: neuere Fakten gewinnen, Widerspruch nur bei derselben Sache | Merge nach grüner CI; danach Port in den Kern |

## Als Nächstes

1. Assistent und Vorschau-Modus mergen, damit sich die App wie bei einem neuen Nutzer ausprobieren lässt.
2. Kern-Umbau P2 (Pfade), P4 (App nutzt den gebündelten Kern), P6 (Hooks, MCP und Hintergrunddienst zeigen auf den Starter). Danach funktioniert ein frischer Vault ohne Kit.
3. FBL-88: Assistent-Schritt „Sicherung“ (privates GitHub-Repo anlegen oder wählen).
4. Git-Client im Studio vervollständigen (Konflikte beim Abgleich, Version zurückholen).
5. P5 (Vertrauen verkleinern) mit Sicherheits-Review, P7 (Umstellungs-Assistent für bestehende Vaults).

## Hinweise

- Lokal laufen einige Swift-Tests unter Last gelegentlich ins Zeitlimit (`terminalNodeNimmtDieLetzteAbsolutePfadZeile`, `KitVertrauenTests`). In der CI sind sie grün. Eigener kleiner Fix steht aus.
- Alter Account `fbrogno`: dort nie ein Repo `second-brain-kit` anlegen, sonst bricht die Umleitung für alte Kit-Installationen.
- Im privaten Kit-Config-Eintrag `kit.erlaubt` muss die neue Adresse `fabiobrogno/second-brain-kit` stehen, solange noch exportiert wird.
