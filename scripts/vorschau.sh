#!/bin/bash
# Vorschau „wie frisch installiert“: startet Kortex so, wie es jemand sieht, der die App gerade installiert hat — und fasst nichts an,
# was dir gehört. Ein Befehl, nichts bleibt zurück.
#
#   scripts/vorschau.sh [--ohne-git] [--mit-ki] [weitere App-Schalter …]
#
#   --ohne-git   git gilt als nicht installiert (der Klick „installieren“ zeigt nur einen Hinweis, es wird nichts installiert)
#   --mit-ki     simuliert erkannte KI-Programme (Claude Code, Codex, Cursor): „KI verbinden“ schreibt nur in die Vorschau
#   --neu-bauen  baut die App neu, auch wenn ein Build da ist (sonst nur, wenn es keinen gibt oder der Quelltext neuer ist)
#   -h, --hilfe  diese Hilfe
#   Alles andere geht unverändert an die App (z. B. --test-dunkel).
#
# Was passiert: Die App läuft als Kopie unter eigener Kennung (io.github.fbrogno.brain.vorschau) in einem Wegwerf-Ordner
# $TMPDIR/kortex-vorschau-XXXX. Application Support, HOME aller Kindprozesse (git, Node, claude …), Zugangsdaten statt Schlüsselbund
# und Vaults liegen darin. Beim Beenden — auch mit Strg-C — räumt das Skript den Ordner und die Spuren der Vorschau-Kennung auf.
#
# Test-Hilfen: KORTEX_VORSCHAU_PROGRAMM=<ausführbare Datei> startet diese statt der App (ohne Build, Kopie und Aufräumen im System).
set -euo pipefail

W="$(cd "$(dirname "$0")/.." && pwd)"
ECHTE_ID="io.github.fbrogno.brain"
VORSCHAU_ID="$ECHTE_ID.vorschau"

zeige_hilfe() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

NEU_BAUEN=0
APP_ARGS=()
for a in "$@"; do
  case "$a" in
    -h|--hilfe|--help) zeige_hilfe; exit 0 ;;
    --neu-bauen) NEU_BAUEN=1 ;;
    --vorschau) echo "FEHLER: --vorschau setzt dieses Skript selbst." >&2; exit 2 ;;
    *) APP_ARGS+=("$a") ;;
  esac
done

PROGRAMM_VORGABE="${KORTEX_VORSCHAU_PROGRAMM:-}"
BASIS="${TMPDIR:-/tmp}"
BASIS="${BASIS%/}"

# ---------- alte Vorschau-Ordner (Skript hart beendet) wegräumen: nur eigene, deren Prozess nicht mehr läuft ----------
ordner_sicher() { # nur ein echter (kein Verweis) Ordner mit unserer Marke und unserem Namen
  case "$1" in */kortex-vorschau-*) ;; *) return 1 ;; esac
  [ -d "$1" ] && [ ! -L "$1" ] && [ -f "$1/.kortex-vorschau" ]
}
for alt in "$BASIS"/kortex-vorschau-*; do
  [ -e "$alt" ] || continue
  ordner_sicher "$alt" || continue
  pid="$(cat "$alt/.pid" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  kill -0 "$pid" 2>/dev/null && continue
  rm -rf "$alt"
done

# ---------- App bereitstellen ----------
APP="$W/build/Kortex.app"
if [ -z "$PROGRAMM_VORGABE" ]; then
  EXE="$APP/Contents/MacOS/BrainApp"
  if [ "$NEU_BAUEN" = 1 ] || [ ! -x "$EXE" ] || [ -n "$(find "$W/Sources" "$W/Ressourcen" "$W/Package.swift" -type f -newer "$EXE" -print -quit 2>/dev/null)" ]; then
    echo "Vorschau: baue die App …" >&2
    bash "$W/scripts/baue-app.sh" >&2
  fi
  [ -x "$EXE" ] || { echo "FEHLER: $EXE fehlt — der Build ist gescheitert." >&2; exit 1; }
fi

# ---------- Wegwerf-Ordner ----------
ORDNER="$(mktemp -d "$BASIS/kortex-vorschau-XXXXXX")"
chmod 700 "$ORDNER"
case "$ORDNER" in
  *[!A-Za-z0-9._/+@=,-]*) rm -rf "$ORDNER"; echo "FEHLER: Der Pfad $ORDNER enthält Zeichen, die die Vorschau nicht verträgt (z. B. Leerzeichen). Setze TMPDIR auf einen einfachen Pfad." >&2; exit 1 ;;
esac
: > "$ORDNER/.kortex-vorschau"
echo $$ > "$ORDNER/.pid"
mkdir -p "$ORDNER/home" "$ORDNER/tmp"

APP_PID=""
# shellcheck disable=SC2329 # über trap aufgerufen
beende_app() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
}
# shellcheck disable=SC2329 # über trap aufgerufen
aufraeumen() {
  beende_app
  if ordner_sicher "$ORDNER"; then rm -rf "$ORDNER"; fi
  if [ -z "$PROGRAMM_VORGABE" ]; then
    # Spuren, die macOS selbst unter der Vorschau-Kennung anlegt (nur diese Kennung, nie die der echten App)
    defaults delete "$VORSCHAU_ID" >/dev/null 2>&1 || true
    for spur in "$HOME/Library/Preferences/$VORSCHAU_ID.plist" \
                "$HOME/Library/Saved Application State/$VORSCHAU_ID.savedState" \
                "$HOME/Library/Caches/$VORSCHAU_ID" \
                "$HOME/Library/WebKit/$VORSCHAU_ID" \
                "$HOME/Library/HTTPStorages/$VORSCHAU_ID" \
                "$HOME/Library/HTTPStorages/$VORSCHAU_ID.binarycookies"; do
      if [ -e "$spur" ]; then rm -rf "$spur"; fi
    done
  fi
}
trap aufraeumen EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# ---------- Kopie der App unter eigener Kennung (eigene Einstellungen, eigener Web-Speicher, kein Sparkle) ----------
if [ -n "$PROGRAMM_VORGABE" ]; then
  PROGRAMM="$PROGRAMM_VORGABE"
else
  KOPIE="$ORDNER/Kortex-Vorschau.app"
  cp -cR "$APP" "$KOPIE" 2>/dev/null || cp -R "$APP" "$KOPIE" # APFS-Klon: sofort und ohne Platz
  PLIST="$KOPIE/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $VORSCHAU_ID" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName Kortex-Vorschau" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Kortex-Vorschau" "$PLIST"
  /usr/libexec/PlistBuddy -c "Delete :SUFeedURL" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :SUEnableAutomaticChecks false" "$PLIST" 2>/dev/null || true
  # Ad-hoc neu siegeln (Info.plist hat sich geändert); ohne Hardened Runtime, damit Sparkle.framework weiter lädt. Eingebettete
  # Teile behalten ihre Signatur.
  codesign --force --sign - "$KOPIE" >/dev/null 2>&1 || { echo "FEHLER: Die Kopie ließ sich nicht signieren." >&2; exit 1; }
  PROGRAMM="$KOPIE/Contents/MacOS/BrainApp"
fi

# ---------- Starten ----------
HOME_V="$ORDNER/home"
echo "Vorschau läuft in $ORDNER" >&2
echo "(Beenden: Kortex beenden, Strg-C oder dieses Fenster schließen — der Ordner wird gelöscht.)" >&2
STATUS=0
# Bereinigte Umgebung (env -i + Whitelist): nichts vom Starter geht durch — weder CLAUDE_CONFIG_DIR, CLAUDE_CODE_*, GH_CONFIG_DIR,
# *_ASKPASS, SSH_AUTH_SOCK noch BRAIN_*. Durch kommen nur Sprache/Terminal/Benutzername und die Vorschau-Variablen.
UMGEBUNG=(PATH=/usr/bin:/bin:/usr/sbin:/sbin
  KORTEX_VORSCHAU="$ORDNER" HOME="$HOME_V" CFFIXED_USER_HOME="$HOME_V" TMPDIR="$ORDNER/tmp/"
  XDG_CONFIG_HOME="$HOME_V/.config" XDG_CACHE_HOME="$HOME_V/.cache" XDG_DATA_HOME="$HOME_V/.local/share" XDG_STATE_HOME="$HOME_V/.local/state"
  GIT_CONFIG_GLOBAL="$HOME_V/.gitconfig" GIT_CONFIG_NOSYSTEM=1)
for name in LANG LANGUAGE TERM USER LOGNAME SHELL __CF_USER_TEXT_ENCODING $(compgen -v LC_ || true); do
  if [ -n "${!name+x}" ]; then UMGEBUNG+=("$name=${!name}"); fi
done
env -i "${UMGEBUNG[@]}" \
  "$PROGRAMM" --vorschau "$ORDNER" ${APP_ARGS[@]+"${APP_ARGS[@]}"} &
APP_PID=$!
wait "$APP_PID" || STATUS=$?
APP_PID=""
exit "$STATUS"
