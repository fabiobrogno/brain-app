#!/bin/bash
# Aktionskanal-Test (Studio-v2-Spec §2/§5/§8): startet eine Kopie von build/Kortex.app, in der Werkstatt und Oberfläche durch
# Tests/Aktionskanal/stub-werkstatt.mjs und die Vertrauensprüfung durch Tests/Aktionskanal/vertrauen-pruefen.mjs ersetzt sind, und
# prüft die Swift-Seite unabhängig vom Stand des Backends:
#  - Studio öffnet ohne Vault; die Werkstatt startet ohne Vault-Argument und ohne BRAIN_VAULT (mit BRAIN_APP_SUPPORT)
#  - `aktion` antwortet: {ok:true} (titel, vault-gewechselt, vertrauen-geaendert, ansicht mit Kit und Vertrauen),
#    {ok:false,grund:"kein-kit"} (ansicht ohne Kit), {ok:false,grund:"nicht-vertraut"} (ansicht mit Kit, aber ohne Vertrauen),
#    Promise-Abweisung bei Ungültigem, null beim zweiten gleichzeitigen ordner-waehlen
#  - Vertrauen (K1): ohne Freigabe liest die App den Kit-Status nicht ('Kit nicht erlaubt') und öffnet die Übersicht nicht; nach
#    der Freigabe und `vertrauen-geaendert` liest sie den Status und öffnet die Übersicht. Fehlt die Prüfung ganz (dritter Lauf),
#    bleibt alles zu — auch nach der 'Freigabe' — und die App sagt 'Prüfung fehlgeschlagen' statt 'nicht erlaubt' (SW-5).
#  - Offene Übersicht (SW-2): Entzieht das Backend die Freigabe oder verschwindet das Kit (Abgleich) und meldet `vertrauen-geaendert`,
#    schließt die Übersicht. Ein technischer Prüffehler lässt sie offen; nach 10 s wird einmal wiederholt, erst bei einem zweiten
#    Fehlschlag schließt sie. Belege sind Zeilen im App-Log (die Attrappe wartet darauf), keine festen Schlafzeiten.
#  - Aktion `fehler` (SW-7): je Fensterleben 20 Zeilen im Log, danach einmal 'js-fehler gedrosselt', der Rest wird verworfen.
#  - vault-gewechselt: aktiver Vault aus vaults.json, Status, offene Übersicht wird geschlossen
#  - der Ordner-Dialog (Sheet) öffnet und endet mit dem Fenster (ordner-dialog abgebrochen), kein Absturz
#  - keine Spuren (k11): kein gemerkter Fensterrahmen in den Einstellungen, keine WebKit-Daten unter ~/Library/WebKit
# Nicht automatisierbar (braucht einen Klick): der Dialog mit echter Auswahl → {pfad}.
# Umgebung (optional): BRAIN_TEST_APP (andere .app als build/Kortex.app), BRAIN_TEST_KIT (Kit-Worktree), KANAL_LAEUFE (Standard: alle drei).
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
ORIGINAL="${BRAIN_TEST_APP:-$W/build/Kortex.app}"
KIT="${BRAIN_TEST_KIT:-}"
if [ -z "$KIT" ]; then
  for k in "$HOME/brain-kit-v0.6" "$HOME/brain-kit-v0.9-integ"; do [ -f "$k/.tools/brain.mjs" ] && { KIT="$k"; break; }; done
fi
[ -x "$ORIGINAL/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -n "$KIT" ] && [ -f "$KIT/.tools/brain.mjs" ] || { echo "FAIL: Kit-Worktree fehlt (BRAIN_TEST_KIT setzen)"; exit 1; }
ARBEIT="$(mktemp -d)"
APP="$ARBEIT/Kortex.app"
cp -R "$ORIGINAL" "$APP"
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
letzte_zeile() { grep -nE -- "$2" "$1" | tail -1 | cut -d: -f1; } # Nummer der letzten passenden Zeile (leer, wenn keine)
zeile_nach() { grep -nE -- "$2" "$1" | cut -d: -f1 | awk -v ab="$3" '$1 > ab { print; exit }'; } # erste passende Zeile nach Zeile <ab>
anzahl() { grep -cE -- "$2" "$1" || true; } # Zahl der passenden Zeilen
pruefe_anzahl() { # <Beschreibung> <Datei> <Muster (egrep)> <erwartet>
  local ist; ist="$(anzahl "$2" "$3")"
  if [ "$ist" = "$4" ]; then echo "  ok   $1"; else echo "  FAIL $1 (erwartet $4, gefunden $ist: $3)"; FEHLER=1; fi
}
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
  local modus="$1" basis v1 v2 log breite hoehe z_frei z_status z_auf z_fehler z_gut z_zu_fehler z_wechsel z_zu_uebersicht z_zu_studio
  # Vertrauensprüfung (Attrappe) in die Kopie legen — im Lauf 'ohne-cli' fehlt sie. Vor der Signatur (neue_kennung).
  rm -f "$APP/Contents/Resources/werkstatt/vertrauen-pruefen.mjs"
  [ "$modus" = "ohne-cli" ] || cp "$W/Tests/Aktionskanal/vertrauen-pruefen.mjs" "$APP/Contents/Resources/werkstatt/vertrauen-pruefen.mjs"
  neue_kennung "$modus"
  basis="$(mktemp -d "$ARBEIT/lauf.XXXX")"
  v1="$basis/Vault Eins"; v2="$basis/Vault Zwei"
  mkdir -p "$v1" "$v2"
  # Eigene KOPIE des Kits (kein Verweis): Der Test löscht darin `brain.mjs`, wie ein Abgleich es könnte — nie im Kit-Worktree.
  cp -R "$KIT/.tools/tests/fixture/." "$v1/"; cp -R "$KIT/.tools" "$v1/.tools"
  export BRAIN_APP_SUPPORT="$basis/support"; mkdir -p "$BRAIN_APP_SUPPORT"
  export STUB_LOG="$basis/stub.log" STUB_NEUER_VAULT="$v2" STUB_MODUS="$modus" STUB_VAULT="$v1"
  local extra=()
  if [ "$modus" != "leer" ]; then
    printf '{"vaults":[{"name":"Eins","pfad":"%s"}],"aktiv":"%s"}\n' "$v1" "$v1" > "$BRAIN_APP_SUPPORT/vaults.json"
    extra=(--test-fenster)
  fi
  # Der Lauf 'mit-vault' wartet auf Belege im App-Log und braucht für die Wiederholungen nach technischen Prüffehlern 2 × 10 s mehr.
  local dauer=(--test-fenster-schliessen-nach 16 --test-beenden-nach 24)
  [ "$modus" = "mit-vault" ] && dauer=(--test-fenster-schliessen-nach 75 --test-beenden-nach 85)
  "$APP/Contents/MacOS/BrainApp" ${extra[@]+"${extra[@]}"} "${dauer[@]}" &
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
    # Aktion 'fehler' (SW-7): 25 Meldungen einer Seite → 20 im Log, danach einmal 'gedrosselt', der Rest verworfen
    pruefe "fehler: 20 Meldungen angenommen" "$STUB_LOG" '"fehlerAngenommen":20'
    pruefe "fehler: die übrigen 5 antworten ok:false/gedrosselt" "$STUB_LOG" '"fehlerGedrosselt":5'
    pruefe_anzahl "fehler: genau 20 js-fehler-Zeilen im Log" "$log" ' js-fehler stub\.js:' 20
    pruefe_anzahl "fehler: genau eine Zeile 'js-fehler gedrosselt'" "$log" ' js-fehler gedrosselt' 1
    pruefe "fehler: die letzte durchgelassene Meldung steht im Log" "$log" ' js-fehler stub.js:20:1 Probefehler 20'
    pruefe_nicht "fehler: die 21. Meldung steht nicht im Log" "$log" 'Probefehler 21'
    ;;
  mit-vault)
    pruefe "Vault aus vaults.json beim Start" "$log" "vault $v1"
    pruefe "ansicht mit Kit, aber ohne Vertrauen: ok:false/nicht-vertraut" "$STUB_LOG" '"ansichtOhneVertrauen":"{\"grund\":\"nicht-vertraut\",\"ok\":false}"'
    pruefe "ansicht mit Kit und Vertrauen antwortet {ok:true}" "$STUB_LOG" '"ansicht":"{\"ok\":true}"'
    pruefe "Status ohne Freigabe: 'Kit nicht erlaubt'" "$log" "status kit-nicht-erlaubt nicht-freigegeben"
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
    # Offene Übersicht (SW-2): Freigabe entzogen, Kit verschwunden → sie schließt; Belege aus dem App-Log und der Attrappe
    pruefe "Übersicht war nach dem Öffnen bereit (Kit-Seite geladen)" "$STUB_LOG" '"bereitEins":true'
    pruefe "Freigabe entzogen + vertrauen-geaendert: die Übersicht schließt" "$STUB_LOG" '"schliesstBeiEntzug":true'
    pruefe "ansicht nach dem Entzug: ok:false/nicht-vertraut" "$STUB_LOG" '"ansichtNachEntzug":"{\"grund\":\"nicht-vertraut\",\"ok\":false}"'
    pruefe "wieder freigegeben: die Übersicht öffnet erneut" "$STUB_LOG" '"ansichtZwei":"{\"ok\":true}"'
    pruefe "Kit gelöscht + vertrauen-geaendert: die Übersicht schließt" "$STUB_LOG" '"schliesstOhneKit":true'
    pruefe "Schließgrund 'Freigabe entfallen' im Log" "$log" " uebersicht-geschlossen kit-nicht-erlaubt$"
    pruefe "Schließgrund 'Kit fehlt' im Log" "$log" " uebersicht-geschlossen kein-kit$"
    # Technischer Prüffehler (SW-5): einmal fehlgeschlagen → Übersicht bleibt offen, nach 10 s wiederholt, intakt → weiter offen
    pruefe "technischer Prüffehler wird als 'Prüfung fehlgeschlagen' angezeigt" "$STUB_LOG" '"fehlerAngezeigt":true'
    pruefe "… mit einer Wiederholung nach 10 s" "$STUB_LOG" '"wiederholungGeplant":true'
    pruefe "… die das Vertrauen intakt findet (Status wird wieder gelesen)" "$STUB_LOG" '"wiederholungOk":true'
    z_fehler="$(zeile "$log" ' status kit-pruefung-fehlgeschlagen unerwartete-ausgabe$')"
    z_gut="$(zeile_nach "$log" ' status (ok|hinweis|problem)$' "${z_fehler:-0}")"
    z_zu_fehler="$(zeile "$log" ' uebersicht-geschlossen pruefung-fehlgeschlagen$')"
    if [ -n "$z_fehler" ] && [ -n "$z_gut" ] && { [ -z "$z_zu_fehler" ] || [ "$z_zu_fehler" -gt "$z_gut" ]; }; then
      echo "  ok   Die Übersicht blieb während der Wiederholung offen (Prüffehler Zeile $z_fehler, wieder gut Zeile $z_gut)"
    else
      echo "  FAIL Übersicht schloss schon beim ersten technischen Prüffehler (Fehler Zeile ${z_fehler:-?}, wieder gut ${z_gut:-?}, geschlossen ${z_zu_fehler:-?})"; FEHLER=1
    fi
    # … und scheitert auch die Wiederholung, schließt sie erst danach
    pruefe "zweiter Prüffehler: die Übersicht schließt erst nach der Wiederholung" "$STUB_LOG" '"schliesstNachWiederholung":true'
    pruefe "… Log: zweiter Fehlschlag steht als endgültig da" "$log" " status kit-pruefung-fehlgeschlagen unerwartete-ausgabe endgueltig$"
    pruefe_anzahl "Wiederholung geplant: zweimal (je ein Prüffehler-Durchgang)" "$log" ' kit-pruefung-wiederholung in 10s$' 2
    pruefe_anzahl "Schließgrund 'Prüfung fehlgeschlagen' genau einmal" "$log" ' uebersicht-geschlossen pruefung-fehlgeschlagen$' 1
    pruefe_nicht "technischer Prüffehler wird nie als 'Kit nicht erlaubt' gemeldet (kein 'bitte freigeben')" "$log" ' status kit-nicht-erlaubt unerwartete-ausgabe'
    pruefe "Übersicht öffnet vor dem Vault-Wechsel noch einmal" "$STUB_LOG" '"ansichtVier":"{\"ok\":true}"'
    # Vier Übersichten: Entzug, Kit weg, zweiter Prüffehler, Vault-Wechsel — jede schließt, keine bleibt übrig
    pruefe_anzahl "vier Übersichten geöffnet" "$log" ' fenster-auf uebersicht' 4
    pruefe_anzahl "vier Übersichten geschlossen" "$log" ' fenster-zu uebersicht$' 4
    z_wechsel="$(zeile "$log" "vault-wechsel $v2")"
    z_zu_uebersicht="$(letzte_zeile "$log" ' fenster-zu uebersicht$')"
    z_zu_studio="$(zeile "$log" 'fenster-zu studio')"
    if [ -n "$z_wechsel" ] && [ -n "$z_zu_uebersicht" ] && [ -n "$z_zu_studio" ] && [ "$z_zu_uebersicht" -gt "$z_wechsel" ] && [ "$z_zu_uebersicht" -lt "$z_zu_studio" ]; then
      echo "  ok   Vault-Wechsel schließt die offene Übersicht (vor dem Schließen des Studios)"
    else
      echo "  FAIL Übersicht wurde beim Vault-Wechsel nicht geschlossen (Wechsel Zeile ${z_wechsel:-?}, Übersicht zu ${z_zu_uebersicht:-?}, Studio zu ${z_zu_studio:-?})"; FEHLER=1
    fi
    ;;
  ohne-cli)
    pruefe "Vault aus vaults.json beim Start" "$log" "vault $v1"
    # Fehlt die Prüfung, ist alles 'nicht erlaubt' — auch nach der 'Freigabe' der Attrappe (es gibt niemanden, der sie liest)
    # SW-5: Eine fehlende Prüfung ist ein technischer Fehler, nicht 'nicht freigegeben' — sonst hieße es 'bitte freigeben', obwohl der
    # Nutzer nichts freigeben kann. Gestartet wird auch hier nichts.
    pruefe "ansicht ohne Prüfung: ok:false/pruefung-fehlgeschlagen" "$STUB_LOG" '"ansichtOhneVertrauen":"{\"grund\":\"pruefung-fehlgeschlagen\",\"ok\":false}"'
    pruefe "ansicht nach der 'Freigabe' ohne Prüfung ebenso" "$STUB_LOG" '"ansicht":"{\"grund\":\"pruefung-fehlgeschlagen\",\"ok\":false}"'
    pruefe "Status: 'Kit-Prüfung fehlgeschlagen' (Prüfung fehlt)" "$log" "status kit-pruefung-fehlgeschlagen pruefung-fehlt"
    pruefe "Die Prüfung wird einmal wiederholt (Wiederholung geplant)" "$log" "kit-pruefung-wiederholung in 10s"
    pruefe_nicht "nie 'Kit nicht erlaubt' gemeldet (kein 'bitte freigeben')" "$log" ' status kit-nicht-erlaubt'
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
