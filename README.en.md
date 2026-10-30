# Kortex

**An editor for your knowledge that knows what is still true, with your AI working right inside it.**

[Deutsche Fassung](README.md) · [Third-party notices](THIRD-PARTY-NOTICES.md)

Kortex is a Mac app for folders of Markdown notes (vaults). Every page shows whether it is backed by sources, expired,
disputed or not yet reviewed. Your vault stays the single source of truth: Kortex only reads and writes plain files and
keeps your text byte for byte. The app is in German for now.

> **Beta.** Expect rough edges, and there is no update promise until the first stable release. Your vault lives in Git so
> you can get changes back, but that does not replace a backup.

## Features

- **Vaults:** create one, open an existing folder, or start with the sample vault; switch between several vaults.
- **Studio editor:** Markdown with live preview, `[[wikilinks]]`, autosave, command palette (Cmd-K), a review signal per page, a health overview and a 3D view.
- **Search and quick capture:** search all pages; drop a thought into the inbox in one step.
- **Tasks:** a board inside the vault where you and your AI add and move tasks.
- **Quick capture:** from anywhere with ⌃⌥Space (changeable in the window): a small panel for a task or a note, even when the Studio
  is closed. Shortcuts in the text such as "morgen" or "!hoch" set due date and priority; dictation works with Fn twice.
  The hotkey needs no accessibility permission.
- **git sync and backup:** review and choose changes, commit, history with diff, restore old versions, sync with your own remote or GitHub; conflicts are explained and nothing is silently overwritten.
- **Connect your AI:** Kortex detects your AI programs and registers its local MCP server there: Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, GitHub Copilot (CLI), Zed, OpenCode and Warp. The AI reads your notes with sources and leaves notes in the inbox; it never writes into the wiki directly.
- **AI accounts and access:** per AI account and vault you decide: blocked, read, inbox or extended. New accounts start blocked. Enforcement is built in; the screen for it follows in upcoming betas.
- **Trust:** a folder opened from outside is "view only" (no git, no background service, no hooks, no instructions to the AI) until you trust it.
- **Migrating old vaults:** "Migrate vault ..." tests on a copy first and has a way back for every step.

## Install

Requires **Apple Silicon (M1 or newer)**, **macOS 26 or later** and Git (`xcode-select --install`).

1. Download the latest file from **Releases**: betas (`v0.3.0-beta.N`) are a zip, stable versions a `Kortex-<version>.dmg`.
2. Unzip (or open the DMG) and drag **Kortex** to **Applications**.
3. A beta is not notarized by Apple yet, so macOS blocks the first start. Open **System Settings → Privacy & Security** and choose **Open Anyway** next to the Kortex message. Or in Terminal: `xattr -dr com.apple.quarantine /Applications/Kortex.app`.

Stable versions are signed, notarized and update themselves through Sparkle.

## Privacy

Your notes stay on your Mac. No server, no telemetry, no analytics, no crash upload. Network traffic happens only for the git sync
with your own remote, GitHub sign-in and repositories, and the update check (Kortex fetches `appcast.xml` from GitHub, so GitHub sees your IP
address; no system profile is sent). There is no open network port. Your AI programs follow their own privacy rules, so you set per
account what they may see.

## Development

See [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md) (German). `swift build && swift test`, `bash scripts/teste-node.sh`, `bash scripts/baue-app.sh`.

## License and trademarks

MIT, see [LICENSE](LICENSE). Copyright 2026 Fabio Brogno. Bundled third-party software is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
(also in the app: Settings → "Lizenzen ...").

Names and logos of Anthropic (Claude), OpenAI (Codex), Anysphere (Cursor), Google (Gemini), GitHub, Zed, OpenCode, Warp and others belong to
their owners and are used only to identify programs Kortex connects to. **Kortex is not affiliated with, endorsed by or supported by any of these companies.**
