# Stand Kortex, 30.10.2026 abends

Nachtrag zum [Stand vom Mittag](README.md).

## Neu auf main (#48–#64)

| Bereich | PRs | Kurz |
|---|---|---|
| Aufgaben | #50, #56, #57 | Kanban-Board unter dem Posteingang, Markdown-Dateien in `05_aufgaben/`, KI legt per MCP/CLI an (Quelle vom Server gesetzt), Archiv |
| KI-Programme | #49 | zusätzlich Claude Desktop, Gemini CLI, Copilot CLI, Zed, OpenCode, Warp |
| KI-Konten | #52, #53 | Stufen je Konto×Vault (gesperrt/lesen/posteingang/erweitert); Claude-Leseverbote + „Strenger Schutz“ (Sandbox), mit echtem `claude` 2.1.314 geprüft |
| Pflege-Konto | #63 | Konto und Stufe (klein/mittel/ohne KI) je Vault; plist ohne festes Profil; fremde Zugangsdaten werden nicht an `claude` gereicht |
| Frag deinen Vault | #59 | ⌘J im Studio, nur Kortex-MCP, nur lesend, kein Verlauf; mit echtem `claude` geprüft |
| Live | #58 | Änderungen von KI/Abgleich erscheinen in ~0,3 s im Studio und in der Menüleiste |
| Oberfläche | #48, #60, #61, #62 | eigene Bausteine statt Systemfelder (Lint), Responsiv, Fokus, Assistent in 2 Bildern, einheitliche Dialoge, Leerzustände – Vorbild Orca (MIT, Herkunft in THIRD-PARTY-NOTICES) |
| Schnell erfassen | #64 | ⌃⌥Leertaste von überall, Kurzformen (`!hoch`, `@morgen`), Diktat |
| Logo | #51, #54 | Original-Windung als App-Icon, Menüleiste, Studio-Marke |
| Release | #55 | THIRD-PARTY-NOTICES, README (de/en), private Pfade aus docs entfernt, gehärteter Release-Workflow |

Jedes Paket mit Sicherheitsfolgen lief durch ein Opus-Review mit Nacharbeit (#50, #53, #59, #63).

## Offen

1. Ende-zu-Ende mit echten Gegenstellen: GitHub-Gerätecode-Anmeldung + Repo anlegen + Push; Migration des Hintergrunddienstes mit echtem `launchctl`; Schnell erfassen live.
2. Umstellung des echten Quell-Vaults: Probelauf an Kopie, dann nur mit Freigabe.
3. Beta-Tag `v0.3.0-beta.1`: Entscheidungen Bundle-ID/Repo-Ort, Sicherung des Sparkle-Schlüssels bestätigen.
4. P7d (Phase B), iOS-App mit Spracheingabe (Etappe nach der Beta).
5. Wackeltests: `bausteine.spec` (Farbübergang Checkbox), `test-hook-einmal` (Zeit).
6. KI-Karte im Assistenten liest den Verbunden-Status nicht; GitHub-Logo im Assistenten prüfen.
