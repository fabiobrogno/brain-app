#!/bin/bash
# Selbstfoto (Studio v2): startet build/Brain.app je einmal hell und einmal dunkel und lässt das Studio sein eigenes Fenster als
# PNG (@2x) speichern — echtes WKWebView, Swift-Brücke, Node-Werkstatt, echter Vault. Der Schnappschuss kommt aus WebKit selbst
# (WKWebView.takeSnapshot), nicht vom Bildschirm: es geht auch bei gesperrtem Bildschirm und ohne Aufnahme-Rechte.
#
#   scripts/selbstfoto.sh <vault|-> <ausgabeordner> [skript.js]
#
#   <vault>        Wegwerf-KOPIE eines Brains (das Studio kann dort schreiben — nie das echte Brain nehmen).
#                  "-" = kein Vault: der Willkommen-Bildschirm (leerer Support-Ordner).
#   <ausgabeordner> bekommt <name>-hell.png und <name>-dunkel.png (name = studio, willkommen oder der Name des Skripts) samt
#                  Kopie des App-Logs (<name>-hell.log, <name>-dunkel.log).
#   [skript.js]    Rumpf einer async-Funktion (darf await), läuft nach „bereit“ und vor dem Bild — z. B. eine Notiz öffnen.
#                  Setzt BRAIN_TESTMODUS=1 (ohne das ignoriert die App --test-skript).
#
# Am Ende: die PNG-Pfade, alle js-fehler-Zeilen aus dem App-Log (Fehlerhaken der Oberfläche) und Warnungen der Testschalter.
# Jeder Lauf nutzt einen frischen Support-Ordner (BRAIN_APP_SUPPORT) in /tmp; ~/Library/Application Support/Brain bleibt unberührt.
# Umgebung (alle optional): SELBSTFOTO_GROESSE (Standard 1440x900, Inhaltsgröße in Punkten), SELBSTFOTO_WARTEN (Sekunden zwischen
# „bereit“/Skript und Bild, Standard 2), SELBSTFOTO_FRIST (Sekunden bis zum Abbruch je Lauf, Standard 60), BRAIN_TEST_APP (andere .app).
# Exit 0, wenn beide Bilder geschrieben wurden (auch bei js-fehler — die stehen in der Ausgabe), sonst 1.
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="${BRAIN_TEST_APP:-$W/build/Brain.app}"
GROESSE="${SELBSTFOTO_GROESSE:-1440x900}"
WARTEN="${SELBSTFOTO_WARTEN:-2}"
FRIST="${SELBSTFOTO_FRIST:-60}"
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Aufruf: scripts/selbstfoto.sh <vault|-> <ausgabeordner> [skript.js]" >&2
  echo "  <vault>: Wegwerf-Kopie eines Brains; \"-\" fotografiert den Willkommen-Bildschirm" >&2
  exit 2
fi
VAULT="$1"; AUS="$2"; SKRIPT="${3:-}"
[ -x "$APP/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
case "$FRIST" in ''|*[!0-9]*) echo "FAIL: SELBSTFOTO_FRIST muss eine ganze Zahl sein"; exit 2 ;; esac
if [ "$VAULT" != "-" ]; then
  [ -d "$VAULT" ] || { echo "FAIL: Vault-Ordner fehlt: $VAULT"; exit 1; }
  VAULT="$(cd "$VAULT" && pwd)"
fi
if [ -n "$SKRIPT" ]; then
  [ -f "$SKRIPT" ] || { echo "FAIL: Skript fehlt: $SKRIPT"; exit 1; }
  SKRIPT="$(cd "$(dirname "$SKRIPT")" && pwd)/$(basename "$SKRIPT")"
  NAME="$(basename "$SKRIPT" .js)"
elif [ "$VAULT" = "-" ]; then
  NAME="willkommen"
else
  NAME="studio"
fi
mkdir -p "$AUS" && AUS="$(cd "$AUS" && pwd)" || { echo "FAIL: Ausgabeordner nicht anlegbar"; exit 1; }

# Sperrzustand der Sitzung (nur lesend): zur Einordnung, ob das Bild bei gesperrtem Bildschirm entstand.
gesperrt() { ioreg -n Root -d1 2>/dev/null | grep -o '"IOConsoleLocked" = [A-Za-z]*' | head -1 | sed 's/.*= //' | sed 's/Yes/ja/; s/No/nein/'; }

FEHLER=0
BILDER=()
JSFEHLER=""
WARNUNGEN=""
# Diagnosezeilen der Testschalter und der Oberfläche, die man sehen will, auch wenn das Bild fehlt.
# `status kit-nicht-erlaubt`: Der frische Support-Ordner jedes Laufs enthält keine Freigabe — das Kit des Vaults läuft dann nicht
# (Studio-v2-Spec §8); das Studio selbst ist davon nicht betroffen.
MUSTER=' (fenster-nicht-bereit|fenster-ladefehler|laufzeit-fehler|test-nicht-bereit|test-bild-fehler|test-skript-fehler|test-skript-uebersprungen|test-schalter-ignoriert|status-fehler|status kit-nicht-erlaubt|befehl-verworfen)'

lauf() { # hell | dunkel
  local modus="$1" basis png log pid ende kinder k zeile
  basis="$(mktemp -d)"
  png="$AUS/$NAME-$modus.png"
  log="$basis/support/logs/app.log"
  rm -f "$png"
  local args=(--test-fenster "$GROESSE" "--test-$([ "$modus" = hell ] && echo hell || echo dunkel)" --test-bild "$png" --test-bild-warten "$WARTEN" --test-beenden-nach "$FRIST")
  [ "$VAULT" = "-" ] || args=(--vault "$VAULT" "${args[@]}")
  [ -z "$SKRIPT" ] || args+=(--test-skript "$SKRIPT")
  echo "Lauf: $modus (Bildschirm gesperrt: $(gesperrt))"
  # exec: $! ist die PID der App selbst — nur sie (und ihre Kinder) wird am Ende beendet, nie ein fremder Prozess.
  ( export BRAIN_APP_SUPPORT="$basis/support"; [ -z "$SKRIPT" ] || export BRAIN_TESTMODUS=1; exec "$APP/Contents/MacOS/BrainApp" "${args[@]}" >/dev/null 2>&1 ) &
  pid=$!
  ende=$((SECONDS + FRIST))
  while [ "$SECONDS" -lt "$ende" ]; do
    grep -Eq 'test-bild geschrieben|test-bild-fehler' "$log" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  # Das Bild ist da (oder der Lauf gescheitert): App beenden. SIGTERM reicht — die Werkstatt endet von selbst, wenn ihr stdin zugeht.
  kinder="$(pgrep -P "$pid" 2>/dev/null | paste -sd' ' - || true)"
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  for k in $kinder; do
    for _ in 1 2 3 4 5 6 7 8; do kill -0 "$k" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$k" 2>/dev/null; then kill -TERM "$k" 2>/dev/null || true; fi
  done
  if [ -s "$png" ]; then
    zeile="$(grep -h 'test-bild geschrieben' "$log" 2>/dev/null | tail -1)"
    echo "  ok   $png (${zeile##* })"
    BILDER+=("$png (${zeile##* })")
  else
    echo "  FAIL kein Bild: $png"
    FEHLER=1
    tail -15 "$log" 2>/dev/null | sed 's/^/       /' || true
  fi
  if [ -f "$log" ]; then
    cp "$log" "$AUS/$NAME-$modus.log" 2>/dev/null || true
    JSFEHLER+="$(grep -h ' js-fehler ' "$log" | sed "s/^/[$modus] /")"$'\n'
    WARNUNGEN+="$(grep -hE "$MUSTER" "$log" | sed "s/^/[$modus] /")"$'\n'
  fi
  rm -rf "$basis"
}

lauf hell
lauf dunkel

echo
echo "Bilder:"
for b in ${BILDER[@]+"${BILDER[@]}"}; do echo "  $b"; done
echo
JSFEHLER="$(printf '%s' "$JSFEHLER" | sed '/^$/d')"
if [ -n "$JSFEHLER" ]; then
  echo "js-fehler ($(printf '%s\n' "$JSFEHLER" | wc -l | tr -d ' ')):"
  printf '%s\n' "$JSFEHLER" | sed 's/^/  /'
else
  echo "js-fehler: keine"
fi
WARNUNGEN="$(printf '%s' "$WARNUNGEN" | sed '/^$/d')"
if [ -n "$WARNUNGEN" ]; then
  echo
  echo "Warnungen:"
  printf '%s\n' "$WARNUNGEN" | sed 's/^/  /'
fi
[ "$FEHLER" = 0 ] || { echo; echo "FAIL Selbstfoto"; exit 1; }
echo "OK Selbstfoto"
