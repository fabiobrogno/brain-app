import Foundation

/// Platzhalter für KI-Programme in der Vorschau mit `--mit-ki`: kleine Shell-Skripte im PATH des Vorschau-Ordners, damit der Schritt
/// „KI verbinden“ etwas zu sehen hat. Sie tun nichts außer `--version` zu beantworten und — für Claude Code — den MCP-Eintrag „brain“
/// in `$HOME/.claude.json` zu führen. Jedes Skript bricht ab, wenn `HOME` nicht im Vorschau-Ordner liegt (zweiter Schutz, falls die
/// Umgebung einmal nicht stimmt): es schreibt nie in den echten Benutzerordner.
enum VorschauPlatzhalter {
    struct Programm {
        let name: String
        let skript: String
    }

    static let programme: [Programm] = [
        Programm(name: "claude", skript: claude),
        Programm(name: "codex", skript: einfach(ausgabe: "codex-cli 0.50.0")),
        Programm(name: "cursor-agent", skript: einfach(ausgabe: "2025.10.28-vorschau")),
    ]

    private static let schutz = """
    # Kortex-Vorschau: Platzhalter, kein echtes Programm. Schreibt nur in den Vorschau-Ordner.
    case "${KORTEX_VORSCHAU:-}" in
      /?*) ;;
      *) echo "Vorschau-Schutz: KORTEX_VORSCHAU fehlt" >&2; exit 97 ;;
    esac
    case "${HOME:-}" in
      "$KORTEX_VORSCHAU"/*) ;;
      *) echo "Vorschau-Schutz: HOME liegt nicht im Vorschau-Ordner" >&2; exit 97 ;;
    esac
    """

    private static func einfach(ausgabe: String) -> String {
        """
        #!/bin/sh
        \(schutz)
        case "${1:-}" in
          --version|-v|version) echo "\(ausgabe)" ;;
          *) echo "Platzhalter der Kortex-Vorschau" >&2; exit 1 ;;
        esac

        """
    }

    /// `claude --version`, `claude mcp get|add|remove brain …` (Ausgabe im Format von Claude Code, soweit die Werkstatt sie liest).
    private static let claude = """
    #!/bin/sh
    \(schutz)
    konfig="$HOME/.claude.json"
    eintrag="$HOME/.claude/vorschau-mcp-brain.txt"
    case "${1:-}" in
      --version|-v|version) echo "2.1.0 (Claude Code)"; exit 0 ;;
      mcp) ;;
      *) echo "Platzhalter der Kortex-Vorschau" >&2; exit 1 ;;
    esac
    aktion="${2:-}"
    case "$aktion" in
      get)
        if [ -f "$eintrag" ]; then
          echo "brain:"; echo "  Scope: User config (available in all your projects)"; echo "  Type: stdio"
          sed -n 's/^/  /p' "$eintrag"
          exit 0
        fi
        echo "No MCP server found with name: brain" >&2; exit 1 ;;
      remove)
        rm -f "$eintrag" "$konfig"
        echo "Removed MCP server brain from user config"; exit 0 ;;
      add)
        if [ -f "$eintrag" ]; then echo "MCP server brain already exists in user config" >&2; exit 1; fi
        shift 2
        while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
        [ "${1:-}" = "--" ] && shift
        befehl="${1:-}"; [ $# -gt 0 ] && shift
        mkdir -p "$HOME/.claude"
        printf 'Command: %s\\nArgs: %s\\n' "$befehl" "$*" > "$eintrag"
        printf '{"mcpServers":{"brain":{"type":"stdio","command":"%s"}}}\\n' "$befehl" > "$konfig"
        echo "Added stdio MCP server brain to user config"; exit 0 ;;
      *) echo "Platzhalter der Kortex-Vorschau" >&2; exit 1 ;;
    esac

    """
}
