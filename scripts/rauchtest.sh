#!/bin/bash
# Rauchtest (App-Spec §13.1/§13.3, Studio-Spec §11): startet build/Brain.app gegen ein Wegwerf-Brain mit Leerzeichen
# im Namen (nie das Live-Brain) und prüft: Status gelesen, Studio-Fenster erscheint und ist bereit, Werkstatt-Prozess
# läuft, KEIN Netzwerk-Port, mit Kit-Worktree zusätzlich die Übersicht (Kit-Brücke); Fenster zu → Brücken beendet;
# App beenden → keine Node-Prozesse der App übrig.
# Port-Check: App-PID, Kinder und alle NEU hinzugekommenen com.apple.WebKit.*-Prozesse (XPC-Dienste, keine Kinder).
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="$W/build/Brain.app"
KIT="${BRAIN_TEST_KIT:-}"
if [ -z "$KIT" ]; then
  for k in "$HOME/brain-kit-v0.6" "$HOME/brain-kit-v0.9-integ"; do [ -f "$k/.tools/ansicht/bruecke.mjs" ] && { KIT="$k"; break; }; done
fi
[ -x "$APP/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -f "$APP/Contents/Resources/werkstatt/werkstatt.mjs" ] || { echo "FAIL: werkstatt.mjs fehlt im Paket"; exit 1; }
[ -n "$KIT" ] && [ -f "$KIT/.tools/brain.mjs" ] || { echo "FAIL: Kit-Worktree fehlt (BRAIN_TEST_KIT setzen)"; exit 1; }
BASIS="$(mktemp -d)"
VAULT="$BASIS/Test Brain"
mkdir -p "$VAULT"
cp -R "$KIT/.tools/tests/fixture/." "$VAULT/"
ln -s "$KIT/.tools" "$VAULT/.tools"
export BRAIN_APP_SUPPORT="$BASIS/support"
LOG="$BRAIN_APP_SUPPORT/logs/app.log"
webkit() { pgrep -f "com.apple.WebKit" | sort || true; }
VORHER="$(webkit)"
# Übersicht (Kit-Brücke) nur mit --test-fenster; das Studio öffnet beim Start von selbst.
"$APP/Contents/MacOS/BrainApp" --vault "$VAULT" --test-fenster --test-fenster-schliessen-nach 40 --test-beenden-nach 60 &
PID=$!
warte() { for _ in $(seq 1 "$2"); do grep -Eq "$1" "$LOG" 2>/dev/null && return 0; sleep 0.25; done; return 1; }
fehl() { echo "FAIL: $1"; tail -20 "$LOG" 2>/dev/null || true; kill "$PID" 2>/dev/null || true; exit 1; }
lauf() { pgrep -P "$PID" -f "$1" >/dev/null; }
warte "status (ok|hinweis|problem)" 80 || fehl "Status wurde nicht gelesen"
warte "fenster-auf studio" 80 || fehl "Studio-Fenster ist nicht erschienen"
warte "fenster-bereit studio" 120 || fehl "Studio wurde nicht bereit"
warte "fenster-bereit uebersicht" 120 || fehl "Übersicht wurde nicht bereit"
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
lauf "werkstatt.mjs" || fehl "Werkstatt läuft nicht, obwohl das Studio offen ist"
lauf "bruecke.mjs" || fehl "Kit-Brücke läuft nicht, obwohl die Übersicht offen ist"
warte "fenster-zu studio" 200 || fehl "Studio wurde nicht geschlossen"
warte "fenster-zu uebersicht" 40 || fehl "Übersicht wurde nicht geschlossen"
sleep 3
if lauf "werkstatt.mjs"; then fehl "Werkstatt läuft nach dem Schließen weiter"; fi
if lauf "bruecke.mjs"; then fehl "Kit-Brücke läuft nach dem Schließen weiter"; fi
# Dock-Klick ersetzt: App läuft nach „Fenster zu“ weiter, Beenden räumt auf
kill -0 "$PID" 2>/dev/null || fehl "App hat sich mit dem letzten Fenster beendet"
wait "$PID" || true
sleep 2
if pgrep -f "$APP/Contents/Resources/(werkstatt|node-runtime)|$BASIS" >/dev/null; then fehl "Nach dem Beenden laufen noch Prozesse der App"; fi
echo "OK Rauchtest"
