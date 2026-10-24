#!/bin/bash
# Rauchtest (App-Spec §13.1/§13.3, Studio-Spec §11, Studio-v2-Spec §2): startet build/Brain.app dreimal.
#  A) mit --vault auf ein Wegwerf-Brain mit Leerzeichen im Namen (nie das Live-Brain): Status gelesen, Studio-Fenster
#     erscheint und ist bereit, Werkstatt-Prozess läuft, KEIN Netzwerk-Port, mit Kit-Worktree zusätzlich die Übersicht
#     (Kit-Brücke); Fenster zu → Brücken beendet; App beenden → keine Node-Prozesse der App übrig.
#  B) OHNE --vault mit leerem Support-Ordner: das Studio öffnet trotzdem („Willkommen“), die Werkstatt läuft ohne
#     Vault-Argument, es erscheint kein Einrichtungsdialog.
#  C) OHNE --vault, aber mit vaults.json im Support-Ordner: die App liest den aktiven Vault daraus (Status) und startet
#     die Werkstatt trotzdem ohne Vault-Argument (die Werkstatt liest vaults.json selbst).
# Port-Check (A): App-PID, Kinder und alle NEU hinzugekommenen com.apple.WebKit.*-Prozesse (XPC-Dienste, keine Kinder).
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="${BRAIN_TEST_APP:-$W/build/Brain.app}"
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
PID=""
LOG=""
webkit() { pgrep -f "com.apple.WebKit" | sort || true; }
warte() { for _ in $(seq 1 "$2"); do grep -Eq "$1" "$LOG" 2>/dev/null && return 0; sleep 0.25; done; return 1; }
fehl() { echo "FAIL: $1"; tail -20 "$LOG" 2>/dev/null || true; [ -n "$PID" ] && kill "$PID" 2>/dev/null || true; exit 1; }
lauf() { pgrep -P "$PID" -f "$1" >/dev/null; }
# Kommandozeile der Werkstatt endet auf werkstatt.mjs, wenn KEIN Vault-Argument übergeben wurde.
werkstatt_ohne_argument() {
  local wk args
  wk="$(pgrep -P "$PID" -f werkstatt.mjs | head -1 || true)"
  [ -n "$wk" ] || fehl "Werkstatt läuft nicht, obwohl das Studio offen ist"
  args="$(ps -o args= -p "$wk")"
  case "$args" in *werkstatt.mjs) ;; *) fehl "Werkstatt wurde mit Vault-Argument gestartet: $args" ;; esac
}
nichts_uebrig() {
  wait "$PID" || true
  PID=""
  sleep 2
  if pgrep -f "$APP/Contents/Resources/(werkstatt|node-runtime)|$1" >/dev/null; then fehl "Nach dem Beenden laufen noch Prozesse der App"; fi
}

# ---------- A) mit --vault ----------
phase_a() {
  export BRAIN_APP_SUPPORT="$BASIS/support"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  VORHER="$(webkit)"
  # Übersicht (Kit-Brücke) nur mit --test-fenster; das Studio öffnet beim Start von selbst.
  "$APP/Contents/MacOS/BrainApp" --vault "$VAULT" --test-fenster --test-fenster-schliessen-nach 40 --test-beenden-nach 60 &
  PID=$!
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
  nichts_uebrig "$BASIS"
  echo "OK A: mit --vault"
}

# ---------- B) ohne --vault, leerer Support-Ordner ----------
phase_b() {
  BASIS_B="$(mktemp -d)"
  export BRAIN_APP_SUPPORT="$BASIS_B/support"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  "$APP/Contents/MacOS/BrainApp" --test-fenster-schliessen-nach 25 --test-beenden-nach 45 &
  PID=$!
  warte "kein-vault" 80 || fehl "B: App meldet nicht „kein-vault“ im Log"
  warte "fenster-auf studio" 80 || fehl "B: Studio-Fenster öffnet nicht ohne Vault"
  warte "fenster-bereit studio" 120 || fehl "B: Studio wurde ohne Vault nicht bereit"
  werkstatt_ohne_argument
  if grep -Eq "laufzeit-fehler|fenster-nicht-bereit" "$LOG"; then fehl "B: Laufzeitfehler oder Studio nicht bereit"; fi
  warte "fenster-zu studio" 200 || fehl "B: Studio wurde nicht geschlossen"
  nichts_uebrig "$BASIS_B"
  echo "OK B: ohne --vault, leerer Support-Ordner (Studio öffnet, Werkstatt ohne Vault-Argument)"
}

# ---------- C) ohne --vault, vaults.json im Support-Ordner ----------
phase_c() {
  BASIS_C="$(mktemp -d)"
  export BRAIN_APP_SUPPORT="$BASIS_C/support"
  mkdir -p "$BRAIN_APP_SUPPORT"
  printf '{"vaults":[{"name":"Test Brain","pfad":"%s","farbe":"#3b82f6"}],"aktiv":"%s"}\n' "$VAULT" "$VAULT" > "$BRAIN_APP_SUPPORT/vaults.json"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  "$APP/Contents/MacOS/BrainApp" --test-fenster-schliessen-nach 25 --test-beenden-nach 45 &
  PID=$!
  warte "^[^ ]+ vault /.*Test Brain$" 80 || fehl "C: aktiver Vault wurde nicht aus vaults.json gelesen"
  warte "status (ok|hinweis|problem)" 80 || fehl "C: Status des Vaults aus vaults.json wurde nicht gelesen"
  warte "fenster-bereit studio" 120 || fehl "C: Studio wurde nicht bereit"
  werkstatt_ohne_argument
  warte "fenster-zu studio" 200 || fehl "C: Studio wurde nicht geschlossen"
  nichts_uebrig "$BASIS_C"
  echo "OK C: Vault aus vaults.json (Status gelesen, Werkstatt ohne Vault-Argument)"
}

# Phasen wählen: BRAIN_RAUCHTEST_PHASEN="A" (Standard: "A B C"), z. B. solange das Backend ohne Vault-Argument noch fehlt.
PHASEN=" ${BRAIN_RAUCHTEST_PHASEN:-A B C} "
[[ "$PHASEN" == *" A "* ]] && phase_a
[[ "$PHASEN" == *" B "* ]] && phase_b
[[ "$PHASEN" == *" C "* ]] && phase_c
echo "OK Rauchtest"
