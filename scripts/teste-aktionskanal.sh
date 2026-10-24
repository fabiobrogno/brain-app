#!/bin/bash
# Aktionskanal-Test (Studio-v2-Spec §2/§5/§8): startet eine Kopie von build/Brain.app, in der Werkstatt und Oberfläche durch
# Tests/Aktionskanal/stub-werkstatt.mjs und die Vertrauensprüfung durch Tests/Aktionskanal/vertrauen-pruefen.mjs ersetzt sind, und
# prüft die Swift-Seite unabhängig vom Stand des Backends:
#  - Studio öffnet ohne Vault; die Werkstatt startet ohne Vault-Argument und ohne BRAIN_VAULT (mit BRAIN_APP_SUPPORT)
#  - `aktion` antwortet: {ok:true} (titel, vault-gewechselt, vertrauen-geaendert, ansicht mit Kit und Vertrauen),
#    {ok:false,grund:"kein-kit"} (ansicht ohne Kit), {ok:false,grund:"nicht-vertraut"} (ansicht mit Kit, aber ohne Vertrauen),
#    Promise-Abweisung bei Ungültigem, null beim zweiten gleichzeitigen ordner-waehlen
#  - Vertrauen (K1): ohne Freigabe liest die App den Kit-Status nicht („Kit nicht erlaubt“) und öffnet die Übersicht nicht; nach
#    der Freigabe und `vertrauen-geaendert` liest sie den Status und öffnet die Übersicht. Fehlt die Prüfung ganz (dritter Lauf),
#    bleibt alles zu — auch nach der „Freigabe“.
#  - vault-gewechselt: aktiver Vault aus vaults.json, Status, offene Übersicht wird geschlossen
#  - der Ordner-Dialog (Sheet) öffnet und endet mit dem Fenster (ordner-dialog abgebrochen), kein Absturz
#  - keine Spuren (k11): kein gemerkter Fensterrahmen in den Einstellungen, keine WebKit-Daten unter ~/Library/WebKit
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
FEHLER=0
# Je Lauf eine eigene Bundle-ID: so zählt jeder Lauf als erster Start und die echten Einstellungen der installierten App bleiben
# unberührt. Danach darf unter dieser ID nichts stehen (keine_spuren).
neue_kennung() {
  KENNUNG="io.github.fbrogno.brain.kanaltest.$$.$1"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $KENNUNG" "$APP/Contents/Info.plist"
  codesign --force --sign - "$APP" 2>/dev/null
}
pruefe() { # <Beschreibung> <Datei> <fester Text>
  if grep -qF -- "$3" "$2"; then echo "  ok   $1"; else echo "  FAIL $1 (fehlt: $3)"; FEHLER=1; fi
}
pruefe_nicht() { # <Beschreibung> <Datei> <Muster (egrep)>
  if grep -qE -- "$3" "$2"; then echo "  FAIL $1 (unerwartet: $3)"; FEHLER=1; else echo "  ok   $1"; fi
}
zeile() { grep -nE -- "$2" "$1" | head -1 | cut -d: -f1; } # Nummer der ersten passenden Zeile (leer, wenn keine)
keine_spuren() { # <Bundle-ID>: kein gemerkter Fensterrahmen, keine WebKit-Daten (ein Testlauf hinterlässt nichts in der App)
  # Gemeint sind die Rahmen von Studio und Übersicht. (Der Ordner-Dialog dieses Tests, `NSWindow Frame NSNavPanelAutosaveName`,
  # merkt sich AppKit selbst — unter der Wegwerf-ID dieses Laufs, nie in der echten App.)
  if defaults read "$1" 2>/dev/null | grep -qE 'NSWindow Frame (StudioFenster|BrainFenster)'; then
    echo "  FAIL Fensterrahmen von Studio/Übersicht in den Einstellungen gemerkt ($1):"
    defaults read "$1" 2>/dev/null | grep -E 'NSWindow Frame (StudioFenster|BrainFenster)' | sed 's/^/       /'; FEHLER=1
  else
    echo "  ok   kein Fensterrahmen von Studio/Übersicht gemerkt"
  fi
  if [ -e "$HOME/Library/WebKit/$1" ]; then
    echo "  FAIL WebKit-Daten angelegt: ~/Library/WebKit/$1"; FEHLER=1
  else
    echo "  ok   keine WebKit-Daten"
  fi
}
lauf() { # leer | mit-vault | ohne-cli
  local modus="$1" basis v1 v2 log stublog zeilen_a zeilen_b breite hoehe z_frei z_status z_auf
  # Vertrauensprüfung (Attrappe) in die Kopie legen — im Lauf „ohne-cli“ fehlt sie. Vor der Signatur (neue_kennung).
  rm -f "$APP/Contents/Resources/werkstatt/vertrauen-pruefen.mjs"
  [ "$modus" = "ohne-cli" ] || cp "$W/Tests/Aktionskanal/vertrauen-pruefen.mjs" "$APP/Contents/Resources/werkstatt/vertrauen-pruefen.mjs"
  neue_kennung "$modus"
  basis="$(mktemp -d "$ARBEIT/lauf.XXXX")"
  v1="$basis/Vault Eins"; v2="$basis/Vault Zwei"
  mkdir -p "$v1" "$v2"
  cp -R "$KIT/.tools/tests/fixture/." "$v1/"; ln -s "$KIT/.tools" "$v1/.tools"
  export BRAIN_APP_SUPPORT="$basis/support"; mkdir -p "$BRAIN_APP_SUPPORT"
  export STUB_LOG="$basis/stub.log" STUB_NEUER_VAULT="$v2"
  local extra=()
  if [ "$modus" != "leer" ]; then
    printf '{"vaults":[{"name":"Eins","pfad":"%s"}],"aktiv":"%s"}\n' "$v1" "$v1" > "$BRAIN_APP_SUPPORT/vaults.json"
    extra=(--test-fenster)
  fi
  "$APP/Contents/MacOS/BrainApp" ${extra[@]+"${extra[@]}"} --test-fenster-schliessen-nach 16 --test-beenden-nach 24 &
  local pid=$!
  wait "$pid"; local code=$?
  log="$BRAIN_APP_SUPPORT/logs/app.log"
  echo "Lauf: $modus"
  [ "$code" = 0 ] && echo "  ok   App beendet sich sauber (Exit 0)" || { echo "  FAIL App-Exit=$code"; FEHLER=1; }
  [ -f "$log" ] && [ -f "$STUB_LOG" ] || { echo "  FAIL kein Log (App oder Attrappe nicht gestartet)"; FEHLER=1; return; }
  breite="$(sed -n 's/.* fenster-auf studio \([0-9]*\)x\([0-9]*\)$/\1/p' "$log" | head -1)"
  hoehe="$(sed -n 's/.* fenster-auf studio \([0-9]*\)x\([0-9]*\)$/\2/p' "$log" | head -1)"
  if [ -n "$breite" ] && [ "$breite" -ge 1100 ] && [ "$hoehe" -ge 700 ]; then
    echo "  ok   Erster Start: Fenster ${breite}x${hoehe} (mindestens 1100x700, Standard 1440x900 bei genug Platz)"
  else
    echo "  FAIL Fenstergröße beim ersten Start: ${breite:-?}x${hoehe:-?}"; FEHLER=1
  fi
  pruefe "Attrappe startet ohne Vault-Argument und ohne BRAIN_VAULT" "$STUB_LOG" '"argv":[],"brainVault":null,"support":"'"$BRAIN_APP_SUPPORT"'"'
  pruefe "titel antwortet {ok:true}" "$STUB_LOG" '"titel":"{\"ok\":true}"'
  pruefe "Ungültiges wird abgewiesen" "$STUB_LOG" '"ungueltig":"abgewiesen:Error: ungültige Aktion"'
  pruefe "Aktion ohne Pflichtwert wird abgewiesen" "$STUB_LOG" '"ohneWert":"abgewiesen:Error: ungültige Aktion"'
  pruefe "vertrauen-geaendert antwortet {ok:true}" "$STUB_LOG" '"vertrauenGeaendert":"{\"ok\":true}"'
  pruefe "vault-gewechselt antwortet {ok:true}" "$STUB_LOG" '"gewechselt":"{\"ok\":true}"'
  pruefe "zweiter gleichzeitiger Ordner-Dialog antwortet null" "$STUB_LOG" '"zweiterDialog":"null"'
  pruefe "Aktion vertrauen-geaendert kommt an" "$log" "aktion vertrauen-geaendert"
  pruefe "Vault-Wechsel erkannt (vaults.json)" "$log" "vault-wechsel $v2"
  pruefe "Status des neuen Vaults (ohne Kit)" "$log" "status ohne-kit"
  pruefe "Ordner-Dialog endet mit dem Fenster" "$log" "ordner-dialog abgebrochen"
  case "$modus" in
  leer)
    pruefe "Start ohne Vault" "$log" "kein-vault"
    pruefe "ansicht ohne Kit antwortet ok:false/kein-kit" "$STUB_LOG" '"ansicht":"{\"grund\":\"kein-kit\",\"ok\":false}"'
    pruefe "ansicht ohne Kit (vor der Freigabe) ebenso" "$STUB_LOG" '"ansichtOhneVertrauen":"{\"grund\":\"kein-kit\",\"ok\":false}"'
    ;;
  mit-vault)
    pruefe "Vault aus vaults.json beim Start" "$log" "vault $v1"
    pruefe "ansicht mit Kit, aber ohne Vertrauen: ok:false/nicht-vertraut" "$STUB_LOG" '"ansichtOhneVertrauen":"{\"grund\":\"nicht-vertraut\",\"ok\":false}"'
    pruefe "ansicht mit Kit und Vertrauen antwortet {ok:true}" "$STUB_LOG" '"ansicht":"{\"ok\":true}"'
    pruefe "Status ohne Freigabe: „Kit nicht erlaubt“" "$log" "status kit-nicht-erlaubt nicht-freigegeben"
    pruefe "Übersicht ohne Freigabe abgelehnt" "$log" "uebersicht-abgelehnt kit-nein nicht-freigegeben"
    pruefe "Attrappen-CLI wurde ohne und mit Freigabe gefragt" "$STUB_LOG" '"pruefung":{"vault":"'"$v1"'","erlaubt":false}'
    pruefe "Attrappen-CLI wurde ohne und mit Freigabe gefragt (mit)" "$STUB_LOG" '"pruefung":{"vault":"'"$v1"'","erlaubt":true}'
    # Reihenfolge: Das Kit läuft erst nach der Freigabe (Status gelesen, Übersicht geöffnet)
    z_frei="$(zeile "$log" 'aktion vertrauen-geaendert')"
    z_status="$(zeile "$log" ' status (ok|hinweis|problem)$')"
    z_auf="$(zeile "$log" ' fenster-auf uebersicht')"
    if [ -n "$z_frei" ] && [ -n "$z_status" ] && [ "$z_status" -gt "$z_frei" ]; then
      echo "  ok   Kit-Status erst nach der Freigabe gelesen"
    else
      echo "  FAIL Kit-Status vor der Freigabe oder gar nicht gelesen (Freigabe Zeile ${z_frei:-?}, Status Zeile ${z_status:-?})"; FEHLER=1
    fi
    if [ -n "$z_frei" ] && [ -n "$z_auf" ] && [ "$z_auf" -gt "$z_frei" ]; then
      echo "  ok   Übersicht erst nach der Freigabe geöffnet"
    else
      echo "  FAIL Übersicht vor der Freigabe oder gar nicht geöffnet (Freigabe Zeile ${z_frei:-?}, Fenster Zeile ${z_auf:-?})"; FEHLER=1
    fi
    zeilen_a="$(grep -n 'fenster-zu uebersicht' "$log" | head -1 | cut -d: -f1)"
    zeilen_b="$(grep -n 'fenster-zu studio' "$log" | head -1 | cut -d: -f1)"
    if [ -n "$zeilen_a" ] && [ -n "$zeilen_b" ] && [ "$zeilen_a" -lt "$zeilen_b" ]; then
      echo "  ok   Vault-Wechsel schließt die offene Übersicht (vor dem Schließen des Studios)"
    else
      echo "  FAIL Übersicht wurde beim Vault-Wechsel nicht geschlossen"; FEHLER=1
    fi
    ;;
  ohne-cli)
    pruefe "Vault aus vaults.json beim Start" "$log" "vault $v1"
    # Fehlt die Prüfung, ist alles „nicht erlaubt“ — auch nach der „Freigabe“ der Attrappe (es gibt niemanden, der sie liest)
    pruefe "ansicht ohne Prüfung: ok:false/nicht-vertraut" "$STUB_LOG" '"ansichtOhneVertrauen":"{\"grund\":\"nicht-vertraut\",\"ok\":false}"'
    pruefe "ansicht nach der „Freigabe“ ohne Prüfung ebenso" "$STUB_LOG" '"ansicht":"{\"grund\":\"nicht-vertraut\",\"ok\":false}"'
    pruefe "Status: „Kit nicht erlaubt“ (Prüfung fehlt)" "$log" "status kit-nicht-erlaubt pruefung-fehlt"
    pruefe "Übersicht abgelehnt (Prüfung fehlt)" "$log" "uebersicht-abgelehnt kit-nein pruefung-fehlt"
    pruefe_nicht "Kit-Status wurde nie gelesen" "$log" ' status (ok|hinweis|problem)$'
    pruefe_nicht "Übersicht wurde nie geöffnet" "$log" ' fenster-auf uebersicht'
    pruefe_nicht "Attrappen-CLI wurde nie gestartet" "$STUB_LOG" '"pruefung"'
    ;;
  esac
  keine_spuren "$KENNUNG"
}
# Läufe wählen: KANAL_LAEUFE="ohne-cli" (Standard: alle drei), z. B. zum Eingrenzen eines Fehlers.
LAEUFE="${KANAL_LAEUFE:-leer mit-vault ohne-cli}"
for m in $LAEUFE; do lauf "$m"; done
for m in $LAEUFE; do
  defaults delete "io.github.fbrogno.brain.kanaltest.$$.$m" 2>/dev/null || true
  rm -rf "$HOME/Library/WebKit/io.github.fbrogno.brain.kanaltest.$$.$m" "$HOME/Library/Caches/io.github.fbrogno.brain.kanaltest.$$.$m" 2>/dev/null || true
done
rm -rf "$ARBEIT"
[ "$FEHLER" = 0 ] && echo "OK Aktionskanal" || { echo "FAIL Aktionskanal"; exit 1; }
