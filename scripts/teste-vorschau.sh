#!/bin/bash
# Test für scripts/vorschau.sh (Vorschau „wie frisch installiert“). Zwei Teile:
#
#   scripts/teste-vorschau.sh         Skripttest mit einem Platzhalter statt der App (schnell, ohne Build, läuft überall):
#                                     Ordner unter $TMPDIR, Schalter und Umgebung kommen an, Aufräumen nach Ende, Strg-C/TERM/HUP,
#                                     alte Ordner, Fehlerfälle. Ein zweiter Temp-Ordner dient als echtes HOME (Vorher/Nachher).
#   scripts/teste-vorschau.sh --app   zusätzlich ein Lauf mit der echten App (build/Kortex.app, braucht einen Bildschirm): die App
#                                     öffnet den Assistenten und beendet sich nach wenigen Sekunden; danach darf im echten Benutzerordner
#                                     nichts neu oder anders sein (nur LESEND geprüft: Support-Ordner, Einstellungen der echten App,
#                                     ~/.claude, ~/.codex, ~/.cursor, .gitconfig, LaunchAgents).
#
# Das echte HOME wird nie beschrieben. Exit 0 = alles ok.
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
SKRIPT="$W/scripts/vorschau.sh"
FEHLER=0
ok() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FEHLER=1; }
pruefe() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (erwartet: $3, ist: $2)"; fi; }
weg() { if [ -e "$1" ]; then fail "$3"; else ok "$2"; fi; } # <Pfad> <ok-Text> <fail-Text>: Pfad darf nicht existieren
da() { if [ -e "$1" ]; then ok "$2"; else fail "$3"; fi; } # Pfad muss existieren

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
BASIS="$ARBEIT/tmp"; mkdir -p "$BASIS"
ECHT="$ARBEIT/echtes-home"; mkdir -p "$ECHT/Library" "$ECHT/.claude"
echo "[user]" > "$ECHT/.gitconfig"
echo "{}" > "$ECHT/.claude.json"
LOG="$ARBEIT/stub.log"

# Platzhalter statt der App: schreibt Argumente und Umgebung ins Log und legt etwas im (Vorschau-)HOME an.
STUB="$ARBEIT/stub-app"
cat > "$STUB" <<'EOF'
#!/bin/bash
{
  echo "args: $*"
  echo "HOME=$HOME"
  echo "CFFIXED_USER_HOME=$CFFIXED_USER_HOME"
  echo "KORTEX_VORSCHAU=$KORTEX_VORSCHAU"
  echo "TMPDIR=$TMPDIR"
  echo "GIT_CONFIG_GLOBAL=$GIT_CONFIG_GLOBAL"
  echo "GIT_CONFIG_NOSYSTEM=$GIT_CONFIG_NOSYSTEM"
  echo "XDG_CONFIG_HOME=$XDG_CONFIG_HOME"
  echo "SSH_AUTH_SOCK=${SSH_AUTH_SOCK-nicht gesetzt}"
  echo "BRAIN_APP_SUPPORT=${BRAIN_APP_SUPPORT-nicht gesetzt}"
  echo "BRAIN_VAULT=${BRAIN_VAULT-nicht gesetzt}"
  echo "PID=$$"
  echo "ELTERN=$PPID"
} > "@LOG@"
env | sort > "@LOG@.env"
echo "Notiz" > "$HOME/vorschau-datei.txt"
case "$(cat "@LOG@.mode" 2>/dev/null || echo ende)" in
  ende) exit "$(cat "@LOG@.code" 2>/dev/null || echo 0)" ;;
  warten) trap 'exit 0' TERM HUP INT; echo bereit >> "@LOG@"; while true; do sleep 1; done ;;
esac
EOF
chmod +x "$STUB"
# Die App läuft mit bereinigter Umgebung: Log-Pfad, Modus und Exit-Code kommen aus Dateien, nicht aus Variablen.
sed -i '' "s|@LOG@|$LOG|g" "$STUB"

abdruck() { # Fingerabdruck eines Ordners (Pfad, Größe, Inhalt-Prüfsumme, Zeit)
  (cd "$1" && find . -exec stat -f '%N %z %m' {} + 2>/dev/null | sort; find . -type f -exec shasum {} + 2>/dev/null | sort)
}
lauf() { # <Argumente …>: Skript mit Platzhalter, echtem Temp-HOME und eigenem TMPDIR
  env HOME="$ECHT" TMPDIR="$BASIS/" KORTEX_VORSCHAU_PROGRAMM="$STUB" "$@"
}
ordner_im_basis() { find "$BASIS" -mindepth 1 -maxdepth 1 -name 'kortex-vorschau-*' | head -1; }

echo "== Normaler Lauf: Schalter und Umgebung, Aufräumen, Exit-Code =="
vorher="$(abdruck "$ECHT")"
echo 3 > "$LOG.code"
lauf bash "$SKRIPT" --ohne-git --mit-ki --test-dunkel >/dev/null 2>&1
code=$?
rm -f "$LOG.code"
pruefe "Exit-Code der App wird weitergegeben" "$code" "3"
ORD="$(sed -n 's/^KORTEX_VORSCHAU=//p' "$LOG")"
case "$ORD" in "$BASIS"/kortex-vorschau-*) ok "Ordner liegt unter \$TMPDIR: kortex-vorschau-XXXX" ;; *) fail "Ordner liegt nicht unter \$TMPDIR: $ORD" ;; esac
pruefe "Schalter kommen unverändert an (--vorschau <Ordner> zuerst)" "$(sed -n 's/^args: //p' "$LOG")" "--vorschau $ORD --ohne-git --mit-ki --test-dunkel"
pruefe "HOME zeigt in den Vorschau-Ordner" "$(sed -n 's/^HOME=//p' "$LOG")" "$ORD/home"
pruefe "CFFIXED_USER_HOME zeigt in den Vorschau-Ordner" "$(sed -n 's/^CFFIXED_USER_HOME=//p' "$LOG")" "$ORD/home"
pruefe "TMPDIR zeigt in den Vorschau-Ordner" "$(sed -n 's/^TMPDIR=//p' "$LOG")" "$ORD/tmp/"
pruefe "GIT_CONFIG_GLOBAL im Vorschau-Home" "$(sed -n 's/^GIT_CONFIG_GLOBAL=//p' "$LOG")" "$ORD/home/.gitconfig"
pruefe "GIT_CONFIG_NOSYSTEM=1" "$(sed -n 's/^GIT_CONFIG_NOSYSTEM=//p' "$LOG")" "1"
pruefe "XDG_CONFIG_HOME im Vorschau-Home" "$(sed -n 's/^XDG_CONFIG_HOME=//p' "$LOG")" "$ORD/home/.config"
pruefe "geerbte Variablen sind weg: BRAIN_APP_SUPPORT" "$(sed -n 's/^BRAIN_APP_SUPPORT=//p' "$LOG")" "nicht gesetzt"
weg "$ORD" "Vorschau-Ordner nach dem Ende gelöscht" "Vorschau-Ordner nach dem Ende noch da: $ORD"
pruefe "nichts übrig in \$TMPDIR" "$(ordner_im_basis)" ""
pruefe "das echte HOME ist unverändert" "$(abdruck "$ECHT")" "$vorher"

echo "== SSH-Agent des Nutzers wird nicht durchgereicht =="
lauf env SSH_AUTH_SOCK=/private/tmp/echter-agent bash "$SKRIPT" >/dev/null 2>&1
pruefe "SSH_AUTH_SOCK nicht gesetzt" "$(sed -n 's/^SSH_AUTH_SOCK=//p' "$LOG")" "nicht gesetzt"

echo "== Bereinigte Umgebung: nichts vom Starter geht durch =="
lauf env CLAUDE_CONFIG_DIR=/echt/claude CLAUDE_CODE_OAUTH_TOKEN=x GH_CONFIG_DIR=/echt/gh GIT_ASKPASS=/echt/askpass SSH_ASKPASS=/echt/askpass \
  GIT_SSH_COMMAND="ssh -i /echt/schluessel" BRAIN_VAULT=/echt/brain BRAIN_TESTMODUS=1 ANTHROPIC_API_KEY=x KOEDER=1 \
  LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8 TERM=xterm bash "$SKRIPT" >/dev/null 2>&1
for koeder in CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN GH_CONFIG_DIR GIT_ASKPASS SSH_ASKPASS GIT_SSH_COMMAND BRAIN_VAULT BRAIN_TESTMODUS ANTHROPIC_API_KEY KOEDER; do
  pruefe "nicht durchgereicht: $koeder" "$(grep -c "^$koeder=" "$LOG.env" || true)" "0"
done
pruefe "Sprache bleibt: LANG" "$(sed -n 's/^LANG=//p' "$LOG.env")" "de_DE.UTF-8"
pruefe "Sprache bleibt: LC_ALL" "$(sed -n 's/^LC_ALL=//p' "$LOG.env")" "de_DE.UTF-8"
pruefe "Terminal bleibt: TERM" "$(sed -n 's/^TERM=//p' "$LOG.env")" "xterm"
pruefe "PATH ist nur System" "$(sed -n 's/^PATH=//p' "$LOG.env")" "/usr/bin:/bin:/usr/sbin:/sbin"
pruefe "Vorschau-Variable da: KORTEX_VORSCHAU" "$(grep -c '^KORTEX_VORSCHAU=' "$LOG.env")" "1"

for sig in TERM HUP; do
  echo "== Signal $sig während die App läuft: App beendet, Ordner gelöscht =="
  : > "$LOG"
  echo warten > "$LOG.mode"
  lauf bash "$SKRIPT" >/dev/null 2>&1 &
  skript_pid=$!
  for _ in $(seq 1 100); do grep -q '^bereit' "$LOG" 2>/dev/null && break; sleep 0.1; done
  grep -q '^bereit' "$LOG" || fail "Platzhalter startet nicht"
  app_pid="$(sed -n 's/^PID=//p' "$LOG")"
  ORD="$(sed -n 's/^KORTEX_VORSCHAU=//p' "$LOG")"
  kill "-$sig" "$(sed -n 's/^ELTERN=//p' "$LOG")"
  wait "$skript_pid" 2>/dev/null; code=$?
  if [ "$sig" = TERM ]; then pruefe "Skript endet mit 143" "$code" "143"; else pruefe "Skript endet mit 129" "$code" "129"; fi
  if kill -0 "$app_pid" 2>/dev/null; then fail "App läuft nach $sig noch (pid $app_pid)"; else ok "App ist beendet"; fi
  weg "$ORD" "Ordner gelöscht" "Ordner nach $sig noch da"
  rm -f "$LOG.mode"
done

echo "== Alte Ordner: nur eigene mit toter Prozess-Nummer werden weggeräumt =="
mkdir -p "$BASIS/kortex-vorschau-tot" "$BASIS/kortex-vorschau-lebt" "$BASIS/kortex-vorschau-fremd"
: > "$BASIS/kortex-vorschau-tot/.kortex-vorschau"; echo 999999 > "$BASIS/kortex-vorschau-tot/.pid"
: > "$BASIS/kortex-vorschau-lebt/.kortex-vorschau"; echo $$ > "$BASIS/kortex-vorschau-lebt/.pid"
: > "$BASIS/kortex-vorschau-fremd/wichtig.txt"
lauf bash "$SKRIPT" >/dev/null 2>&1
weg "$BASIS/kortex-vorschau-tot" "toter Vorschau-Ordner weggeräumt" "toter Vorschau-Ordner nicht weggeräumt"
da "$BASIS/kortex-vorschau-lebt" "Ordner mit lebendem Prozess bleibt" "Ordner mit lebendem Prozess gelöscht"
da "$BASIS/kortex-vorschau-fremd/wichtig.txt" "Ordner ohne Marke bleibt" "Ordner ohne Marke gelöscht"
rm -rf "$BASIS/kortex-vorschau-lebt" "$BASIS/kortex-vorschau-fremd"

echo "== Fehlerfälle =="
lauf bash "$SKRIPT" --vorschau /tmp/x >/dev/null 2>&1
pruefe "--vorschau von außen wird abgelehnt (Exit 2)" "$?" "2"
mkdir -p "$ARBEIT/mit leerzeichen"
env HOME="$ECHT" TMPDIR="$ARBEIT/mit leerzeichen/" KORTEX_VORSCHAU_PROGRAMM="$STUB" bash "$SKRIPT" >/dev/null 2>&1
pruefe "TMPDIR mit Leerzeichen wird abgelehnt (Exit 1)" "$?" "1"
pruefe "dabei bleibt nichts liegen" "$(find "$ARBEIT/mit leerzeichen" -mindepth 1 | head -1)" ""
pruefe "das echte HOME ist weiter unverändert" "$(abdruck "$ECHT")" "$vorher"

if [ "${1:-}" = "--app" ]; then
  echo "== Echte App: Assistent öffnet, App beendet sich, im echten Benutzerordner ändert sich nichts =="
  EXE="$W/build/Kortex.app/Contents/MacOS/BrainApp"
  [ -x "$EXE" ] || { echo "  FAIL zuerst bash scripts/baue-app.sh"; exit 1; }
  # Nur LESEND: der echte Benutzerordner dieses Rechners. Was von selbst weiterläuft (laufende KI-Sitzungen schreiben in ~/.claude und
  # ~/.codex, eine installierte Kortex-App in ihre Caches), wird nur auf Namen der obersten Ebene und den MCP-Eintrag geprüft.
  echt_stand() {
    for p in "$HOME/Library/Application Support/Brain" "$HOME/Library/Application Support/Kortex"; do
      echo "== $p"; if [ -e "$p" ]; then abdruck "$p" | grep -v '/logs' || true; else echo "(fehlt)"; fi
    done
    for p in "$HOME/.claude" "$HOME/.codex" "$HOME/.cursor" "$HOME/Library/LaunchAgents"; do
      echo "== Namen $p"; if [ -d "$p" ]; then find "$p" -mindepth 1 -maxdepth 1 -exec basename -a {} + | sort | grep -v -E '^(history|sessions|projects|todos|shell-snapshots|statsig|file-history|session-env|log|logs|\.DS_Store)' || true; else echo "(fehlt)"; fi
    done
    echo "== gitconfig"; if [ -e "$HOME/.gitconfig" ]; then shasum "$HOME/.gitconfig"; else echo "(fehlt)"; fi
    echo "== MCP-Eintrag brain in claude.json"; if [ -e "$HOME/.claude.json" ]; then grep -c '"brain"' "$HOME/.claude.json" || true; else echo "(fehlt)"; fi
    echo "== Einstellungen der echten App"; defaults read io.github.fbrogno.brain 2>&1 | shasum
  }
  vorher_echt="$(echt_stand)"
  bash "$SKRIPT" --mit-ki --test-beenden-nach 8 2>"$ARBEIT/app.err"
  pruefe "App-Lauf endet mit 0" "$?" "0"
  pruefe "Vorschau-Ordner gelöscht" "$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'kortex-vorschau-*' -newer "$STUB" 2>/dev/null | head -1)" ""
  for spur in "$HOME/Library/Preferences/io.github.fbrogno.brain.vorschau.plist" "$HOME/Library/Saved Application State/io.github.fbrogno.brain.vorschau.savedState" \
              "$HOME/Library/WebKit/io.github.fbrogno.brain.vorschau" "$HOME/Library/Caches/io.github.fbrogno.brain.vorschau"; do
    weg "$spur" "keine Spur: ${spur#"$HOME"/}" "Spur der Vorschau-Kennung blieb: $spur"
  done
  pruefe "echter Benutzerordner unverändert" "$(echt_stand)" "$vorher_echt"
fi

echo
if [ "$FEHLER" = 0 ]; then echo "Vorschau-Test: ALLES OK"; else echo "Vorschau-Test: FEHLER"; fi
exit "$FEHLER"
