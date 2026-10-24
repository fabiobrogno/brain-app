#!/bin/bash
# Aktionskanal-Test (Studio-v2-Spec §2/§5): startet eine Kopie von build/Brain.app, in der Werkstatt und Oberfläche durch
# Tests/Aktionskanal/stub-werkstatt.mjs ersetzt sind, und prüft die Swift-Seite unabhängig vom Stand des Backends:
#  - Studio öffnet ohne Vault; die Werkstatt startet ohne Vault-Argument und ohne BRAIN_VAULT (mit BRAIN_APP_SUPPORT)
#  - `aktion` antwortet: {ok:true} (titel, vault-gewechselt, ansicht mit Kit), {ok:false,grund:"kein-kit"} (ansicht ohne Kit),
#    Promise-Abweisung bei Ungültigem, null beim zweiten gleichzeitigen ordner-waehlen
#  - vault-gewechselt: aktiver Vault aus vaults.json, Status, offene Übersicht wird geschlossen
#  - der Ordner-Dialog (Sheet) öffnet und endet mit dem Fenster (ordner-dialog abgebrochen), kein Absturz
# Nicht automatisierbar (braucht einen Klick): der Dialog mit echter Auswahl → {pfad}.
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
KIT="${BRAIN_TEST_KIT:-}"
if [ -z "$KIT" ]; then
  for k in "$HOME/brain-kit-v0.6" "$HOME/brain-kit-v0.9-integ"; do [ -f "$k/.tools/brain.mjs" ] && { KIT="$k"; break; }; done
fi
[ -x "$W/build/Brain.app/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -n "$KIT" ] && [ -f "$KIT/.tools/brain.mjs" ] || { echo "FAIL: Kit-Worktree fehlt (BRAIN_TEST_KIT setzen)"; exit 1; }
ARBEIT="$(mktemp -d)"
APP="$ARBEIT/Brain.app"
cp -R "$W/build/Brain.app" "$APP"
for d in studio mcp gemeinsam werkstatt; do rm -rf "$APP/Contents/Resources/$d"; done
mkdir "$APP/Contents/Resources/werkstatt"
cp "$W/Tests/Aktionskanal/stub-werkstatt.mjs" "$APP/Contents/Resources/werkstatt/werkstatt.mjs"
codesign --force --sign - "$APP" 2>/dev/null
FEHLER=0
pruefe() { # <Beschreibung> <Datei> <fester Text>
  if grep -qF -- "$3" "$2"; then echo "  ok   $1"; else echo "  FAIL $1 (fehlt: $3)"; FEHLER=1; fi
}
lauf() { # leer | mit-vault
  local basis v1 v2 log stublog zeilen_a zeilen_b
  basis="$(mktemp -d "$ARBEIT/lauf.XXXX")"
  v1="$basis/Vault Eins"; v2="$basis/Vault Zwei"
  mkdir -p "$v1" "$v2"
  cp -R "$KIT/.tools/tests/fixture/." "$v1/"; ln -s "$KIT/.tools" "$v1/.tools"
  export BRAIN_APP_SUPPORT="$basis/support"; mkdir -p "$BRAIN_APP_SUPPORT"
  export STUB_LOG="$basis/stub.log" STUB_NEUER_VAULT="$v2"
  local extra=()
  if [ "$1" = "mit-vault" ]; then
    printf '{"vaults":[{"name":"Eins","pfad":"%s"}],"aktiv":"%s"}\n' "$v1" "$v1" > "$BRAIN_APP_SUPPORT/vaults.json"
    extra=(--test-fenster)
  fi
  "$APP/Contents/MacOS/BrainApp" ${extra[@]+"${extra[@]}"} --test-fenster-schliessen-nach 14 --test-beenden-nach 22 &
  local pid=$!
  wait "$pid"; local code=$?
  log="$BRAIN_APP_SUPPORT/logs/app.log"
  echo "Lauf: $1"
  [ "$code" = 0 ] && echo "  ok   App beendet sich sauber (Exit 0)" || { echo "  FAIL App-Exit=$code"; FEHLER=1; }
  [ -f "$log" ] && [ -f "$STUB_LOG" ] || { echo "  FAIL kein Log (App oder Attrappe nicht gestartet)"; FEHLER=1; return; }
  pruefe "Attrappe startet ohne Vault-Argument und ohne BRAIN_VAULT" "$STUB_LOG" '"argv":[],"brainVault":null,"support":"'"$BRAIN_APP_SUPPORT"'"'
  pruefe "titel antwortet {ok:true}" "$STUB_LOG" '"titel":"{\"ok\":true}"'
  pruefe "Ungültiges wird abgewiesen" "$STUB_LOG" '"ungueltig":"abgewiesen:Error: ungültige Aktion"'
  pruefe "Aktion ohne Pflichtwert wird abgewiesen" "$STUB_LOG" '"ohneWert":"abgewiesen:Error: ungültige Aktion"'
  pruefe "vault-gewechselt antwortet {ok:true}" "$STUB_LOG" '"gewechselt":"{\"ok\":true}"'
  pruefe "zweiter gleichzeitiger Ordner-Dialog antwortet null" "$STUB_LOG" '"zweiterDialog":"null"'
  pruefe "Fenstertitel gesetzt" "$log" "aktion titel Stub Vault"
  pruefe "Vault-Wechsel erkannt (vaults.json)" "$log" "vault-wechsel $v2"
  pruefe "Status des neuen Vaults (ohne Kit)" "$log" "status ohne-kit"
  pruefe "Ordner-Dialog endet mit dem Fenster" "$log" "ordner-dialog abgebrochen"
  if [ "$1" = "leer" ]; then
    pruefe "Start ohne Vault" "$log" "kein-vault"
    pruefe "ansicht ohne Kit antwortet ok:false/kein-kit" "$STUB_LOG" '"ansicht":"{\"grund\":\"kein-kit\",\"ok\":false}"'
  else
    pruefe "Vault aus vaults.json beim Start" "$log" "vault $v1"
    pruefe "ansicht mit Kit antwortet {ok:true}" "$STUB_LOG" '"ansicht":"{\"ok\":true}"'
    zeilen_a="$(grep -n 'fenster-zu uebersicht' "$log" | head -1 | cut -d: -f1)"
    zeilen_b="$(grep -n 'fenster-zu studio' "$log" | head -1 | cut -d: -f1)"
    if [ -n "$zeilen_a" ] && [ -n "$zeilen_b" ] && [ "$zeilen_a" -lt "$zeilen_b" ]; then
      echo "  ok   Vault-Wechsel schließt die offene Übersicht (vor dem Schließen des Studios)"
    else
      echo "  FAIL Übersicht wurde beim Vault-Wechsel nicht geschlossen"; FEHLER=1
    fi
  fi
}
lauf leer
lauf mit-vault
rm -rf "$ARBEIT"
[ "$FEHLER" = 0 ] && echo "OK Aktionskanal" || { echo "FAIL Aktionskanal"; exit 1; }
