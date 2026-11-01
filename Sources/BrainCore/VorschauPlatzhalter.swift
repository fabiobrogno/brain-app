import Foundation

/// Platzhalter für KI-Programme in der Vorschau mit `--mit-ki`: kleine Shell-Skripte im PATH des Vorschau-Ordners, damit der Schritt
/// „KI verbinden“ etwas zu sehen hat. Sie beantworten `--version` und — für Claude Code — führen den MCP-Eintrag „brain“ in
/// `$HOME/.claude.json`; außerdem antwortet `claude -p …` (der Aufruf von „Frag deinen Vault“) mit einer klar gekennzeichneten Beispielantwort,
/// die zwei echte Seiten des Vorschau-Vaults nennt (nur lesend, nur innerhalb des Vorschau-Ordners). Jedes Skript bricht ab, wenn `HOME` nicht im Vorschau-Ordner liegt (zweiter Schutz, falls die
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

    /// `claude --version`, `claude mcp get|add|remove brain …` (Ausgabe im Format von Claude Code, soweit die Werkstatt sie liest) und
    /// `claude -p …` (Frag deinen Vault): eine Beispielantwort als stream-json in dem Format, das `werkstatt/frage.mjs` liest. Den Vault nennt
    /// das `--mcp-config` (`"--vault","<pfad>"`); er muss im Vorschau-Ordner liegen. Gelesen wird nur mit `find`, `grep`, `sed` und `awk`.
    /// Raw-String: die Schrägstriche gehören dem Shell-Skript. `Tests/Node/vorschau-frage.test.mjs` lädt das Skript zwischen den Marken.
    // BEGIN claude-platzhalter
    private static let claude = #"""
    #!/bin/sh
    \#(schutz)
    konfig="$HOME/.claude.json"
    eintrag="$HOME/.claude/vorschau-mcp-brain.txt"

    # ---- Frag deinen Vault: claude -p … (die Frage kommt über stdin) ----
    # Eine Beispielantwort als stream-json (Format wie in werkstatt/frage.mjs gelesen). Liest nur, und nur im Vorschau-Ordner.
    json() { tr '\t' ' ' | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
    beispielantwort() {
      export LC_ALL=en_US.UTF-8
      vault=""
      for a in "$@"; do
        case "$a" in *'"--vault","'*) vault="$(printf '%s' "$a" | sed -n 's/.*"--vault","\([^"]*\)".*/\1/p')" ;; esac
      done
      vp="$(cd "$KORTEX_VORSCHAU" 2>/dev/null && pwd -P)"
      vv="$(cd "$vault" 2>/dev/null && pwd -P)"
      case "$vv" in
        "$vp"/*) ;;
        *) echo "Vorschau-Schutz: Der Vault liegt nicht im Vorschau-Ordner" >&2; exit 97 ;;
      esac
      frage="$(head -c 2000 | tr '\n' ' ')"
      woerter="$(printf '%s' "$frage" | tr 'A-ZÄÖÜ' 'a-zäöü' | tr -cs 'a-zäöüß0-9' '\n' | awk 'length($0) >= 4' | head -6)"
      # Seiten, die ein Wort der Frage enthalten (zuerst), danach alle übrigen; Belege zuletzt. Zwei davon werden genannt.
      alle="$(cd "$vv" && find . -type f -name '*.md' -not -path '*/.*' -not -name '_*' 2>/dev/null | sort)"
      gefunden="$(cd "$vv" && for w in $woerter; do find . -type f -name '*.md' -not -path '*/.*' -not -name '_*' -exec grep -liF -- "$w" {} + 2>/dev/null | sort; done)"
      ordnung="$({ printf '%s\n' "$alle" | grep -v '/belege/'; printf '%s\n' "$alle" | grep '/belege/'; } | grep -v '^$')"
      auswahl="$(printf '%s\n%s\n' "$gefunden" "$ordnung" | sed 's|^\./||' | grep -v '^$' | awk '!gesehen[$0]++' | head -2)"
      zeilen=""
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        titel="$(sed -n 's/^# *//p' "$vv/$f" | head -1)"
        [ -n "$titel" ] || titel="$(basename "$f" .md)"
        auszug="$(awk 'NR==1 && /^---[ \t]*$/ {fm=1; next} fm==1 {if ($0 ~ /^---[ \t]*$/) fm=0; next} /^#/ || /^[ \t]*$/ {next} {print; exit}' "$vv/$f" | cut -c1-140)"
        zeilen="${zeilen}- [[${f}]] — ${titel}: ${auszug}
    "
      done <<EOF
    $auswahl
    EOF
      anfang="Vorschau: So würde eine Antwort aussehen. In der Vorschau antwortet ein Platzhalter statt Claude Code: Er hat deine Frage nicht ausgewertet, sondern aus deinem Vault zwei Seiten ausgewählt, die passen könnten."
      ende="Eine echte Antwort aus deinem Vault gibt Claude Code in der installierten App."
      ganz="$(printf '%s\n\n%s\n%s' "$anfang" "$zeilen" "$ende")"
      printf '{"type":"system","subtype":"init","session_id":"vorschau","model":"vorschau-platzhalter"}\n'
      printf '{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_vorschau","role":"assistant"}}}\n'
      printf '%s\n' "$ganz" | while IFS= read -r z; do
        printf '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"%s\\n"}}}\n' "$(printf '%s' "$z" | json)"
        sleep 0.1
      done
      alles="$(printf '%s\n' "$ganz" | { erste=1; while IFS= read -r z; do [ "$erste" = 1 ] || printf '\\n'; erste=0; printf '%s' "$(printf '%s' "$z" | json)"; done; })"
      printf '{"type":"assistant","message":{"id":"msg_vorschau","role":"assistant","content":[{"type":"text","text":"%s"}]}}\n' "$alles"
      printf '{"type":"result","subtype":"success","is_error":false,"result":"%s","num_turns":1,"duration_ms":300,"total_cost_usd":0,"usage":{"input_tokens":420,"output_tokens":96}}\n' "$alles"
    }

    case "${1:-}" in
      --version|-v|version) echo "2.1.0 (Claude Code)"; exit 0 ;;
      mcp) ;;
      *)
        for a in "$@"; do
          case "$a" in -p|--print) beispielantwort "$@"; exit 0 ;; esac
        done
        echo "Platzhalter der Kortex-Vorschau" >&2; exit 1 ;;
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
        printf 'Command: %s\nArgs: %s\n' "$befehl" "$*" > "$eintrag"
        printf '{"mcpServers":{"brain":{"type":"stdio","command":"%s"}}}\n' "$befehl" > "$konfig"
        echo "Added stdio MCP server brain to user config"; exit 0 ;;
      *) echo "Platzhalter der Kortex-Vorschau" >&2; exit 1 ;;
    esac
    """#
    // END claude-platzhalter
}
