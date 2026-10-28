# .tools/tests/plattform.sh — von jedem Shell-Test als Erstes gesourct.
# Unter Windows (Git Bash) versteht Node keine POSIX-Pfade: aus /tmp/x oder /d/a/… macht es D:\tmp\x bzw.
# D:\d\a\… — sobald ein Pfad in einem String steckt (node -e, JSON), den Git Bash nicht umschreibt.
# Darum liefern pwd und mktemp hier die gemischte Form C:/…, die Bash UND Node verstehen.
# Node liest das Home-Verzeichnis unter Windows aus USERPROFILE, nicht aus HOME — Tests mit eigenem
# Home setzen deshalb beides. Auf macOS/Linux tut diese Datei nichts.
# Tests legen eigene Temp-Repos an: geerbte GIT_*-Variablen (z. B. aus einem Hook) würden sie aufs echte Repo lenken.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$_v"; done; unset _v
# Hook-Dubletten-Guard (adapters/claude-code/einmal.mjs) aus: Shell-Tests rufen dieselben Hooks mit gleicher Eingabe mehrfach kurz
# hintereinander auf und prüfen anderes. (Node-Tests: setup.mjs; der Guard selbst: test-hook-einmal.mjs.)
export BRAIN_EINMAL=aus
TEST_WIN=0
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    TEST_WIN=1
    pwd() { builtin pwd -W; }
    ;;
esac

# --- Temp-Hygiene: alles, was ein Test per mktemp anlegt, wird beim Exit des Tests gelöscht -----------------------------------
# (Node-Tests: setup.mjs; zusammen ein Mechanismus. Hintergrund: ~291 000 Temp-Reste, 25 GB aus Kit-Testläufen.)
# mktemp merkt sich jeden Pfad in einer Registratur-DATEI (kein Array: $(mktemp -d) läuft in einer Teilshell, dort ginge ein
# Array verloren). Ein EIGENER EXIT-Trap des Tests wird nicht ersetzt, sondern verkettet: erst sein Trap, dann das Aufräumen
# (trap ist darum unten gekapselt; Signal-Traps, trap -p und trap - bleiben wie gewohnt). Aufgeräumt wird nur in der Hauptshell
# des Tests, nie beim Ende einer Teilshell. BRAIN_TEST_TEMP_BEHALTEN=1 lässt alles liegen (Fehlersuche an einem roten Test).
if [ -z "${_TEMP_LISTE:-}" ]; then
  _TEMP_LISTE="$(command mktemp)" && _TEMP_EBENE="${BASH_SUBSHELL:-0}" && _TEMP_HOME0="${HOME:-}" && printf '%s\n' "$_TEMP_LISTE" >> "$_TEMP_LISTE"
fi
mktemp() {
  local p; p="$(command mktemp "$@")" || return 1
  [ -z "${_TEMP_LISTE:-}" ] || printf '%s\n' "$p" >> "$_TEMP_LISTE" 2>/dev/null
  if [ "$TEST_WIN" = 1 ]; then cygpath -ml "$p"; else printf '%s\n' "$p"; fi
}
_temp_aufraeumen() {
  [ "${BASH_SUBSHELL:-0}" = "${_TEMP_EBENE:-0}" ] || return 0
  [ "${BRAIN_TEST_TEMP_BEHALTEN:-}" = 1 ] && return 0
  local p; [ -f "${_TEMP_LISTE:-}" ] || return 0
  while IFS= read -r p; do
    case "$p" in /?*|[A-Za-z]:/?*) ;; *) continue ;; esac            # nur absolute Pfade, nie leer, nie "/"
    [ "$p" = "${TMPDIR:-/tmp}" ] || [ "$p" = "/tmp" ] || [ "$p" = "${_TEMP_HOME0:-/}" ] || command rm -rf -- "$p" 2>/dev/null
  done < "$_TEMP_LISTE"
  command rm -f -- "$_TEMP_LISTE" 2>/dev/null
  return 0
}
trap() {
  if [ "$#" -lt 2 ]; then builtin trap "$@"; return; fi                # trap -p, trap INT (zurücksetzen) …
  case "$1" in -p|-l|-P) builtin trap "$@"; return ;; esac
  local aktion="$1" s exit_dabei=0 rest; rest=()
  shift
  for s in "$@"; do case "$s" in EXIT|0) exit_dabei=1 ;; *) rest[${#rest[@]}]="$s" ;; esac; done
  if [ "${#rest[@]}" -gt 0 ]; then builtin trap "$aktion" "${rest[@]}" || return; fi
  [ "$exit_dabei" = 1 ] || return 0
  case "$aktion" in
    -|"") builtin trap _temp_aufraeumen EXIT ;;                          # trap - EXIT: nur den eigenen Trap aufheben
    *)    builtin trap "$aktion"$'\n'"_temp_aufraeumen" EXIT ;;
  esac
}
builtin trap _temp_aufraeumen EXIT
# --- Kein echtes qmd in Tests ------------------------------------------------------------------------------------------------
# QMD_BIN zeigt standardmäßig auf fake-qmd-cli.mjs (wie in setup.mjs für die Node-Tests). Sonst startet jeder Test, der brain refresh /
# search-refresh / doctor ausführt, das PATH-qmd — und dessen `embed` lädt mit frischem Test-HOME das Embedding-Modell (333 MB, Netz) herunter.
# qmd-befehl.mjs#qmdAufruf liest QMD_BIN für alle Aufrufer. Ein von außen gesetzter Wert bleibt; leer zählt als nicht gesetzt. Tests, die den Weg OHNE
# QMD_BIN prüfen (PATH-qmd, „ohne qmd“), setzen es für genau diesen Aufruf leer (QMD_BIN= …) und geben dabei ein eigenes Fake-qmd vor.
[ -n "${QMD_BIN:-}" ] || QMD_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fake-qmd-cli.mjs"
export QMD_BIN
# Tests, die BEWUSST das echte qmd brauchen (Adapter-Lauf mit echter Suche), fragen vorher: installiert UND das Embedding-Modell liegt schon im Cache
# (XDG_CACHE_HOME oder ~/.cache/qmd/models) — nie einen Download auslösen. Ruft qmd selbst nie auf.
echtes_qmd_bereit() {
  command -v qmd >/dev/null 2>&1 || return 1
  local m; for m in "${XDG_CACHE_HOME:-$HOME/.cache}"/qmd/models/*embeddinggemma*.gguf; do [ -f "$m" ] && return 0; done
  return 1
}
# PATH-Einträge brauchen unter Git Bash die POSIX-Form (/c/…): in "C:/…" wäre der Doppelpunkt ein Trenner.
posixpfad() { if [ "$TEST_WIN" = 1 ]; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
# Git Bash schreibt Argumente, die wie POSIX-Pfade aussehen ("/api/daten", "x=/kunden/a"), beim Start
# eines Windows-Programms in C:/Program Files/Git/… um. Für Argumente, die Daten sind (URL-Pfade,
# Config-Werte), diesen Umbau abschalten: ohne_pfadumbau node … — auf macOS/Linux wirkungslos.
ohne_pfadumbau() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$@"; }
