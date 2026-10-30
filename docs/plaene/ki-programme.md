# Mehr KI-Programme erkennen und verbinden

Stand: 30.10.2026. Kortex trug sich bisher bei Claude Code, Codex und Cursor ein. Jetzt kommen sechs weitere Programme dazu. Dieses Papier hält fest, **welche** (und welche nicht), **wo und wie** jedes Programm seine MCP-Server konfiguriert, **woher** die Angaben stammen, und wie der Code aufgebaut ist.

## Auswahl

Maßstab: viele Mac-Nutzer, **dokumentierte und stabile** Konfiguration, ein Programm das lokale Server über einen Befehl (`command` + `args`) startet.

| Programm | Datei (macOS, Nutzerebene) | Schlüssel | Eintrag „brain“ | Erkennung |
|---|---|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` | `{ "command", "args" }` | App `Claude.app` |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers` | `{ "command", "args" }` | Befehl `gemini` |
| GitHub Copilot (CLI) | `~/.copilot/mcp-config.json` | `mcpServers` | `{ "type": "local", "command", "args", "tools": ["*"] }` | Befehl `copilot` |
| Zed | `~/.config/zed/settings.json` (JSONC) | `context_servers` | `{ "command", "args" }` | App `Zed.app` / `Zed Preview.app`, Befehl `zed` |
| OpenCode | `~/.config/opencode/opencode.json` (JSON oder JSONC) | `mcp` | `{ "type": "local", "command": [Programm, Argument…], "enabled": true }` (**ein** Feld mit Liste, kein `args`) | Befehl `opencode`, App `OpenCode.app` |
| Warp | `~/.warp/.mcp.json` | `mcpServers` | `{ "command", "args" }` | App `Warp.app` |

Cursor (`~/.cursor/mcp.json`, `mcpServers`) läuft jetzt durch denselben Baustein wie diese sechs. Claude Code und Codex bleiben bei ihren Befehlen (`claude mcp add`, `codex mcp add`).

### Bewusst nicht dabei (und warum)

- **VS Code mit GitHub Copilot:** Die Nutzer-Datei `mcp.json` (Schlüssel `servers`, `"type": "stdio"`) ist in der aktuellen VS-Code-Doku als „deprecated“ markiert, der macOS-Pfad steht dort nicht wörtlich (nur abgeleitet aus dem Profilordner `~/Library/Application Support/Code/User`). Der neue gemeinsame Ort ist die Copilot-Datei `~/.copilot/mcp-config.json`, die wir über „GitHub Copilot“ bedienen. VS Code selbst hat außerdem kein Logo in Simple Icons.
- **Windsurf:** laut Sekundärquellen am 2.6.2026 in „Devin Desktop“ umbenannt; die offizielle Doku nennt `.devin/config.json` / `~/.config/devin/config.json`, Drittquellen noch `~/.codeium/windsurf/mcp_config.json`. Zu widersprüchlich, bis es sich setzt.
- **Google Antigravity:** laut geminicli.com ersetzt die Antigravity CLI die Gemini CLI für einen Teil der Nutzer (18.6.2026); die Pfade sind uneinheitlich (`~/.gemini/config/mcp_config.json`, `~/.gemini/antigravity/mcp_config.json`, `~/.gemini/antigravity-cli/mcp_config.json`). Kein Simple-Icons-Logo. **Gemini CLI bleibt dabei**, weil ihre Doku stabil und eindeutig ist; sie kann trotzdem bald seltener werden.
- **Kiro** (`~/.kiro/settings/mcp.json`, gut dokumentiert, aber geringe Verbreitung und kein Logo), **Goose** (YAML, anderes Schema `extensions`/`cmd`), **Cline**/**Roo Code** (Pfad der VS-Code-Erweiterung nicht dokumentiert), **LM Studio** (Doku nennt keinen Pfad, Bug-Reports widersprechen sich), **Amp** (klein): später, wenn Nachfrage da ist. Das Format-Gerüst trägt sie, es fehlt nur eine Beschreibung in `programme.mjs` (Goose bräuchte zusätzlich einen YAML-Leser).

## Quellen (abgerufen 30.10.2026)

- Claude Desktop: https://modelcontextprotocol.io/docs/develop/connect-local-servers — „macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`“, Schlüssel `mcpServers` > Name > `command`, `args`, optional `env`; Neustart nötig. Keine CLI, Handbearbeitung.
- Gemini CLI: https://geminicli.com/docs/tools/mcp-server/ — `~/.gemini/settings.json`, `mcpServers` > Name > `command` („Path to the executable for Stdio transport“), `args`. Es gibt auch `gemini mcp add` (Standard-Scope `project`, nicht `user`!); wir schreiben die Datei selbst, damit der Scope eindeutig ist. Installation: https://geminicli.com/docs/get-started/installation/ (Befehl `gemini`).
- GitHub Copilot CLI: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers — `~/.copilot/mcp-config.json`, `mcpServers` > Name > `"type": "local"` (oder `"stdio"`), `command`, `args`, optional `env`, `tools` (Standard `"*"`). Doku bei `type` nicht ganz eindeutig; wir nehmen `local` wie im Beispiel. `COPILOT_HOME` kann den Ordner verschieben; Kortex kennt die Umgebungsvariable nicht (Start aus dem Finder), daher nur der Standardort. Installation: https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli.
- Zed: https://zed.dev/docs/ai/mcp — `context_servers` > Name > `command`, `args`, `env`. Die Einstellungsdatei ist JSONC (Beispiele mit `//`-Kommentaren). Ältere Zed-Versionen verlangten zusätzlich `"source": "custom"`; die aktuelle Doku nennt es nicht, wir schreiben es nicht.
- OpenCode: https://opencode.ai/docs/mcp-servers/ und https://opencode.ai/docs/config/ — `mcp` > Name > `"type": "local"`, `command` als Liste, `enabled`; „OpenCode supports both JSON and JSONC“; globale Datei `~/.config/opencode/opencode.json`.
- Warp: https://docs.warp.dev/agent-platform/capabilities/mcp/ — „Global: `~/.warp/.mcp.json`“, Wrapper `mcpServers` > Name > `command`, `args`, `env`.
- Windsurf/Devin: https://docs.devin.ai/desktop/cascade/mcp (Umleitung von docs.windsurf.com). VS Code: https://code.visualstudio.com/docs/copilot/customization/mcp-servers und https://code.visualstudio.com/docs/copilot/reference/mcp-configuration.
- Goose: https://goose-docs.ai/docs/getting-started/using-extensions (`~/.config/goose/config.yaml`). Cline: https://docs.cline.bot/mcp/configuring-mcp-servers. Kiro: https://kiro.dev/docs/mcp/configuration/. Antigravity: https://antigravity.google/docs/mcp.

Nicht belegt (nur Erfahrungswert, deshalb nirgends im Code verwendet): Bundle-IDs der Apps; ob die Programme eine bestimmte Version von `--version` ausgeben. Die App-Version lesen wir aus `Contents/Info.plist` (`CFBundleShortVersionString`), ohne die App zu starten.

## Wie der Code aufgebaut ist

`Ressourcen/werkstatt/ki-programme/`:

- `programme.mjs` — **eine Beschreibung je Programm**: `id`, `name`, Dateiort, Schlüsselpfad, `baue(a)` (Eintrag im Format des Programms), `lies(eintrag)` (zum Vergleichen), `erkennung`. Ein neues Programm ist ein neuer Eintrag in `BESCHREIBUNGEN` (plus Swift-Fall, Logo, Test-Zeile).
- `datei-adapter.mjs` — das **gemeinsame Verhalten**: `verbinde`, `trenne`, `konfiguration`. Eintrag „brain“ additiv; fremde Einträge, Kommentare, Einrückung und Reihenfolge bleiben; vor jeder Änderung eine **Sicherung** neben der Datei (Rechte des Originals, nur die letzten 3); **atomar** (Temp-Datei, `rename`); ein **Symlink** bleibt ein Symlink (geschrieben wird am echten Ziel); eine **kaputte oder anders geformte Datei wird nie überschrieben** (422 mit Text zum Kopieren); ein fremder Eintrag „brain“ bleibt stehen (409), außer der Nutzer wählt „Umstellen“; eine frühere Form desselben Servers (alter Node im App-Ordner) wird ohne Rückfrage umgestellt. Command/Args fremder Einträge stehen nie in einer Antwort.
- `jsonc.mjs` — JSON mit Kommentaren und nachgestellten Kommas lesen und **zeichengenau** ändern (nur die Zeichen von „brain“); das Ergebnis wird vor dem Schreiben gegen den erwarteten Wert geprüft, bei Abweichung wird nichts geschrieben.
- `erkennung.mjs` — installiert? App (`/Applications`, `~/Applications`) oder Befehl im PATH; ein Konfigurationsordner allein zählt nicht (bleibt oft nach dem Löschen liegen).
- `index.mjs` — Einstieg für den Handler.

Der Adapter bekommt `ctx = { home, a, art, ordner? }`. **`ordner`** ersetzt den Standard-Konfigurationsordner: so lässt sich später ein **Profil** je Programm anbinden (mehrere Konfigurationsordner), ohne den Adapter zu ändern. Zugriffsregeln gehören nicht hierher.

Routen (`Ressourcen/werkstatt/handler.mjs`): `POST /api/mcp/verbinden` und `/api/mcp/trennen` mit `{ ziel }` (`claude`, `codex`, oder die `id` aus `programme.mjs`); `GET /api/mcp/konfiguration?ziel=<id>` liefert `{ json, ort }` im Format des Programms; `GET /api/ki/erkennen` liefert zusätzlich `programme: [{ id, name, gefunden, version, quelle }]`.

Swift: `KiZiel` (`Sources/BrainCore/EinrichtungsDienste.swift`) hat die neuen Fälle mit `ziel`, `name`, `dateiOrt`; der Assistent zeigt erkannte Programme zuerst und alle nicht gefundenen eingeklappt unter „Weitere Programme“ (dort je Programm „Konfiguration kopieren“). Das Studio (`willkommen.js`) bietet erkannte Programme in der Auswahl „KI verbinden“ an.

## Logos

Siehe `Ressourcen/logos/HERKUNFT.md`: Quelle Simple Icons 16.36.0 (CC0) für Claude, Cursor, Gemini, GitHub Copilot, Zed, OpenCode und Warp; einheitliche optische Größe über eine je Logo berechnete `viewBox`; Markenfarbe nur bei mindestens 3:1 Kontrast auf Hell und Dunkel (Claude, Gemini), sonst einfarbig. Codex bleibt bei der Initiale: Simple Icons hat kein OpenAI-Logo, `openai.com/brand` war nicht abrufbar (403), eine Erlaubnis für Integrations-Logos ist nicht belegt.

## Offene Punkte

- Windsurf/Devin Desktop, Antigravity und VS Code: wieder prüfen, wenn die Doku sich gesetzt hat.
- GUI-gestartete Programme erben nicht den Shell-PATH. Kortex trägt deshalb den **absoluten** Pfad des mitgelieferten Node ein (wie bisher bei Claude Code, Codex und Cursor).
- Bekannte Grenzen des Adapters (Review): Die Sicherungen liegen neben der Datei; liegt der ganze Ordner in einem Dotfiles-Repository, liegen sie dort mit (sie können fremde Tokens enthalten). Ein Hardlink wird beim Schreiben (`rename`) aufgetrennt. „Umstellen“ ersetzt den ganzen Eintrag „brain“ (eigene Zusatzfelder wie `env` gehen verloren, die Sicherung hat sie). Ändert das Programm die Datei in den Millisekunden zwischen Sicherung und Ersetzen, bricht Kortex mit 409 ab statt darüber zu schreiben. Ungültiges UTF-8, schreibgeschützte Dateien und tote Symlinks werden nie angefasst (422).
- Profile je Programm und Zugriffsregeln für den Vault plant ein anderer Arbeitsstrang.
