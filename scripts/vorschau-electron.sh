#!/bin/bash
# Vorschau „wie frisch installiert“ für die Electron-Hülle (Windows/Linux-Pakete, Paket W2c) — das Gegenstück zu scripts/vorschau.sh für die Mac-App.
# Ein Befehl, nichts bleibt zurück: eigener Support-Ordner, eigenes (temporäres) HOME, keine Zugangsdaten, kein Schlüsselbund, keine Updates, kein globales Kürzel.
#
#   scripts/vorschau-electron.sh [--paket <ausführbare Datei der gebauten App>] [weitere Schalter …]
#
#   ohne --paket   startet die Hülle aus dem Quelltext (`electron electron/`; vorher einmal `npm ci` in electron/)
#   --paket <exe>  startet eine gebaute App: Linux entpacktes AppImage (`--appimage-extract`, dann squashfs-root/kortex) oder /opt/Kortex/kortex (deb); sie legt dann
#                  ihr mitgeliefertes Node und den Kern im Vorschau-Support-Ordner ab und prüft so auch den Weg „frisch installiert“
#   -h, --hilfe    diese Hilfe
#   Alles andere geht unverändert an die App (z. B. --vault <Ordner>).
#
# Was passiert: Die App läuft mit KORTEX_VORSCHAU=<Wegwerf-Ordner> in $TMPDIR/kortex-vorschau-XXXX. Support-Ordner (BRAIN_APP_SUPPORT), HOME, XDG_*, CODEX_HOME,
# Git-Konfiguration und Zugangsdaten liegen darin; die Werkstatt hält sich daran (gemeinsam/basis.mjs: vorschauFehler) und startet sonst gar nicht. Die Umgebung ist ausdrücklich gebaut
# (env -i + Liste): nichts vom Aufrufer geht durch — weder CLAUDE_CONFIG_DIR, GH_CONFIG_DIR, SSH_AUTH_SOCK noch BRAIN_*. Durch kommen nur Sprache, Anzeige und Sitzung
# (DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR …, ohne die Electron kein Fenster öffnen kann). Im PATH liegt nur ein Verweis auf `node` (Quelltext-Start) und das System: ein echtes claude oder
# codex des Rechners findet die Vorschau nie. Beim Beenden — auch mit Strg-C — verschwindet der Ordner.
# Linux und macOS; Windows hat keine solche Vorschau (die Prüfung der Werkstatt kennt nur POSIX-Pfade) — dort hilft das Testen mit den Playwright-Tests (electron/test).
#
# Test-Hilfe: KORTEX_VORSCHAU_PROGRAMM=<ausführbare Datei> startet diese statt der App (Test Tests/Node/electron-w2c.test.mjs).
set -euo pipefail

W="$(cd "$(dirname "$0")/.." && pwd)"
zeige_hilfe() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

PAKET=""
APP_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--hilfe|--help) zeige_hilfe; exit 0 ;;
    --paket) [ "$#" -ge 2 ] || { echo "FEHLER: --paket braucht einen Pfad." >&2; exit 2; }; PAKET="$2"; shift 2; continue ;;
    --vorschau) echo "FEHLER: --vorschau setzt dieses Skript selbst." >&2; exit 2 ;;
    *) APP_ARGS+=("$1") ;;
  esac
  shift
done

BASIS="${TMPDIR:-/tmp}"
BASIS="${BASIS%/}"
ORDNER="$(mktemp -d "$BASIS/kortex-vorschau-XXXXXX")"
chmod 700 "$ORDNER"
case "$ORDNER" in
  *[!A-Za-z0-9._/+@=,-]*) rm -rf "$ORDNER"; echo "FEHLER: Der Pfad $ORDNER enthält Zeichen, die die Vorschau nicht verträgt (z. B. Leerzeichen). Setze TMPDIR auf einen einfachen Pfad." >&2; exit 1 ;;
esac
: > "$ORDNER/.kortex-vorschau"
echo $$ > "$ORDNER/.pid"
mkdir -p "$ORDNER/home" "$ORDNER/tmp" "$ORDNER/support" "$ORDNER/bin"

APP_PID=""
# shellcheck disable=SC2329 # über trap aufgerufen
aufraeumen() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  # nur unser eigener Wegwerf-Ordner: Name, Marke und kein Verweis
  case "$ORDNER" in */kortex-vorschau-*) [ -f "$ORDNER/.kortex-vorschau" ] && [ ! -L "$ORDNER" ] && rm -rf "$ORDNER" ;; esac
}
trap aufraeumen EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# ---------- Programm ----------
if [ -n "${KORTEX_VORSCHAU_PROGRAMM:-}" ]; then
  PROGRAMM=("$KORTEX_VORSCHAU_PROGRAMM")
elif [ -n "$PAKET" ]; then
  [ -x "$PAKET" ] || { echo "FEHLER: $PAKET ist keine ausführbare Datei." >&2; exit 1; }
  PROGRAMM=("$PAKET")
else
  ELECTRON="$W/electron/node_modules/.bin/electron"
  [ -x "$ELECTRON" ] || { echo "FEHLER: electron/node_modules fehlt — einmal 'npm ci' in electron/ ausführen." >&2; exit 1; }
  NODE="$(command -v node || true)"
  [ -n "$NODE" ] || { echo "FEHLER: Für den Start aus dem Quelltext braucht es node im PATH." >&2; exit 1; }
  ln -s "$NODE" "$ORDNER/bin/node" # die Werkstatt findet so genau dieses node, aber nichts sonst aus dem PATH des Aufrufers
  PROGRAMM=("$ELECTRON" "$W/electron")
fi

# ---------- Starten ----------
H="$ORDNER/home"
echo "Vorschau läuft in $ORDNER" >&2
echo "(Beenden: Kortex beenden, Strg-C oder dieses Fenster schließen — der Ordner wird gelöscht.)" >&2
UMGEBUNG=(PATH="$ORDNER/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  KORTEX_VORSCHAU="$ORDNER" HOME="$H" TMPDIR="$ORDNER/tmp/" BRAIN_APP_SUPPORT="$ORDNER/support"
  XDG_CONFIG_HOME="$H/.config" XDG_CACHE_HOME="$H/.cache" XDG_DATA_HOME="$H/.local/share" XDG_STATE_HOME="$H/.local/state"
  CODEX_HOME="$H/.codex" GIT_CONFIG_GLOBAL="$H/.gitconfig" GIT_CONFIG_NOSYSTEM=1)
for name in LANG LANGUAGE TERM USER LOGNAME SHELL DISPLAY XAUTHORITY WAYLAND_DISPLAY XDG_RUNTIME_DIR XDG_SESSION_TYPE DBUS_SESSION_BUS_ADDRESS __CF_USER_TEXT_ENCODING $(compgen -v LC_ || true); do
  if [ -n "${!name+x}" ]; then UMGEBUNG+=("$name=${!name}"); fi
done
STATUS=0
env -i "${UMGEBUNG[@]}" "${PROGRAMM[@]}" --vorschau "$ORDNER" ${APP_ARGS[@]+"${APP_ARGS[@]}"} &
APP_PID=$!
wait "$APP_PID" || STATUS=$?
APP_PID=""
exit "$STATUS"
