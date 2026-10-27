#!/bin/bash
# Rauchtest M1 (App-Spec §13.1/§13.3): startet build/Kortex.app gegen ein Test-Brain mit Leerzeichen im Namen,
# öffnet das Fenster und prüft: Status gelesen, Fenster bereit, KEIN Netzwerk-Port, Fenster zu → Brücke beendet.
# Port-Check: App-PID, Kinder und alle NEU hinzugekommenen com.apple.WebKit.*-Prozesse (XPC-Dienste, keine Kinder).
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="$W/build/Kortex.app"
KIT="${BRAIN_TEST_KIT:-$HOME/brain-kit-v0.6}"
[ -x "$APP/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -f "$KIT/.tools/ansicht/bruecke.mjs" ] || { echo "FAIL: Kit-Worktree fehlt: $KIT"; exit 1; }
BASIS="$(mktemp -d)"
VAULT="$BASIS/Test Brain"
mkdir -p "$VAULT"
cp -R "$KIT/.tools/tests/fixture/." "$VAULT/"
ln -s "$KIT/.tools" "$VAULT/.tools"
export BRAIN_APP_SUPPORT="$BASIS/support"
LOG="$BRAIN_APP_SUPPORT/logs/app.log"
webkit() { pgrep -f "com.apple.WebKit" | sort || true; }
VORHER="$(webkit)"
"$APP/Contents/MacOS/BrainApp" --vault "$VAULT" --test-fenster --test-fenster-schliessen-nach 40 --test-beenden-nach 60 &
PID=$!
warte() { for _ in $(seq 1 "$2"); do grep -Eq "$1" "$LOG" 2>/dev/null && return 0; sleep 0.25; done; return 1; }
fehl() { echo "FAIL: $1"; tail -20 "$LOG" 2>/dev/null || true; kill "$PID" 2>/dev/null || true; exit 1; }
warte "status (ok|hinweis|problem)" 80 || fehl "Status wurde nicht gelesen"
warte "fenster-bereit" 120 || fehl "Fenster wurde nicht bereit"
KINDER="$(pgrep -P "$PID" | paste -sd, - || true)"
NEUWK="$(comm -13 <(echo "$VORHER") <(webkit) | paste -sd, - || true)"
ALLE="$PID${KINDER:+,$KINDER}${NEUWK:+,$NEUWK}"
echo "Port-Check: App=$PID Kinder=${KINDER:-keine} neue-WebKit=${NEUWK:-keine}"
VERB="$(lsof -nP -a -i -p "$ALLE" 2>/dev/null || true)"
if echo "$VERB" | grep -q "LISTEN"; then echo "$VERB"; fehl "LISTEN-Socket offen (Port)"; fi
# Verbindungen ohne LISTEN: nur Loopback/lokal wäre tolerierbar, alles nach außen ist FAIL
AUSSEN="$(echo "$VERB" | awk 'NR>1' | grep -vE '(127\.0\.0\.1|\[::1\]|\*:\*)' | grep -E '(TCP|UDP)' || true)"
if [ -n "$AUSSEN" ]; then echo "$AUSSEN"; fehl "Verbindung nach außen"; fi
if [ -n "$(echo "$VERB" | awk 'NR>1')" ]; then echo "HINWEIS: lokale/unbound Sockets ohne LISTEN:"; echo "$VERB"; else echo "Port-Check: keine Netzwerk-Sockets"; fi
pgrep -P "$PID" -f "bruecke.mjs" >/dev/null || fehl "Brücke läuft nicht, obwohl das Fenster offen ist"
warte "fenster-zu" 200 || fehl "Fenster wurde nicht geschlossen"
sleep 3
if pgrep -P "$PID" -f "bruecke.mjs" >/dev/null; then fehl "Brücke läuft nach dem Schließen weiter"; fi
wait "$PID" || true
echo "OK Rauchtest"
