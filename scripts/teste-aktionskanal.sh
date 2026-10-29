#!/bin/bash
# Aktionskanal-Test (Studio-v2-Spec §2/§5/§8): startet eine Kopie von build/Kortex.app, in der Werkstatt und Oberfläche durch
# Tests/Aktionskanal/stub-werkstatt.mjs ersetzt sind, und prüft die Swift-Seite unabhängig vom Stand des Backends. Der Kern ist der
# gebündelte aus dem App-Paket (Contents/Resources/kern, wie in der Auslieferung); der Vault ist eine Kopie von Tests/Kern/fixture.
# Es braucht weder ein Kit-Worktree noch eine Vertrauensprüfung (Kern-Umzug P4):
#  - Studio öffnet ohne Vault; die Werkstatt startet ohne Vault-Argument und ohne BRAIN_VAULT (mit BRAIN_APP_SUPPORT)
#  - `aktion` antwortet: {ok:true} (titel, vault-gewechselt, vertrauen-geaendert, ansicht mit Brain-Vault und Kern),
#    {ok:false,grund:"kein-kit"} (ansicht ohne Vault), {ok:false,grund:"kern-nicht-bereit"} (Kern fehlt im Paket),
#    Promise-Abweisung bei Ungültigem, null beim zweiten gleichzeitigen ordner-waehlen
#  - Kern-Aufrufe: `brain status` läuft aus support/bin/kern mit --vault, ohne jede Freigabe; ein altes <vault>/.tools wird nie ausgeführt
#    (Marken-Skripte schreiben eine Datei, falls sie je laufen); fehlt der Kern, meldet die App 'kern-nicht-bereit' und öffnet nichts.
#  - Offene Übersicht (SW-2): Verschwindet brain.config.json (Abgleich) und meldet `vertrauen-geaendert`, schließt die Übersicht; sie
#    öffnet wieder, wenn die Datei zurück ist. Belege sind Zeilen im App-Log (die Attrappe wartet darauf), keine festen Schlafzeiten.
#  - Aktion `fehler` (SW-7): je Fensterleben 20 Zeilen im Log, danach einmal 'js-fehler gedrosselt', der Rest wird verworfen.
#  - vault-gewechselt: aktiver Vault aus vaults.json, Status, offene Übersicht wird geschlossen
#  - der Ordner-Dialog (Sheet) öffnet und endet mit dem Fenster (ordner-dialog abgebrochen), kein Absturz
#  - keine Spuren (k11): kein gemerkter Fensterrahmen in den Einstellungen, keine WebKit-Daten unter ~/Library/WebKit
# Nicht automatisierbar (braucht einen Klick): der Dialog mit echter Auswahl → {pfad}.
# Umgebung (optional): BRAIN_TEST_APP (andere .app als build/Kortex.app), KANAL_LAEUFE (Standard: alle drei).
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
ORIGINAL="${BRAIN_TEST_APP:-$W/build/Kortex.app}"
FIXTURE="$W/Tests/Kern/fixture"
[ -x "$ORIGINAL/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -f "$ORIGINAL/Contents/Resources/kern/brain.mjs" ] || { echo "FAIL: Kern fehlt im App-Paket (Contents/Resources/kern)"; exit 1; }
[ -f "$FIXTURE/brain.config.json" ] || { echo "FAIL: Tests/Kern/fixture fehlt"; exit 1; }
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
lauf() { # leer | mit-vault | ohne-kern
  local modus="$1" basis v1 v2 log breite hoehe z_status z_auf z_wechsel z_zu_uebersicht z_zu_studio marke
  # Im Lauf 'ohne-kern' fehlt der Kern im Paket (samt Manifest). Vor der Signatur (neue_kennung).
  if [ "$modus" = "ohne-kern" ]; then
    rm -rf "$APP/Contents/Resources/kern" "$APP/Contents/Resources/kern-manifest.json"
  elif [ ! -d "$APP/Contents/Resources/kern" ]; then
    cp -R "$ORIGINAL/Contents/Resources/kern" "$APP/Contents/Resources/kern"
    cp "$ORIGINAL/Contents/Resources/kern-manifest.json" "$APP/Contents/Resources/kern-manifest.json"
  fi
  neue_kennung "$modus"
  basis="$(mktemp -d "$ARBEIT/lauf.XXXX")"
  v1="$basis/Vault Eins"; v2="$basis/Vault Zwei"
  mkdir -p "$v1" "$v2"
  # Eigene KOPIE der Kern-Fixture (ein Vault ist ein Ordner mit brain.config.json; der Test löscht sie, wie ein Abgleich es könnte).
  cp -R "$FIXTURE/." "$v1/"
  # Ein altes Kit im Vault mit Marken: Es darf nie laufen (Status, Übersicht) — sonst steht die Marke da.
  marke="$basis/marke-altes-kit.txt"
  mkdir -p "$v1/.tools/ansicht"
  printf 'import { appendFileSync } from "node:fs";\nappendFileSync("%s", "brain.mjs\\n");\nconsole.log("{}");\n' "$marke" > "$v1/.tools/brain.mjs"
  printf 'import { appendFileSync } from "node:fs";\nappendFileSync("%s", "bruecke.mjs\\n");\nprocess.stdout.write(JSON.stringify({ bereit: true, version: "alt" }) + "\\n");\nprocess.stdin.resume();\n' "$marke" > "$v1/.tools/ansicht/bruecke.mjs"
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
  pruefe "Status des neuen Vaults (ohne brain.config.json)" "$log" "status ohne-konfiguration"
  pruefe "Ordner-Dialog endet mit dem Fenster" "$log" "ordner-dialog abgebrochen"
  case "$modus" in
  leer)
    pruefe "Start ohne Vault" "$log" "kein-vault"
    pruefe "ansicht ohne Vault antwortet ok:false/kein-kit" "$STUB_LOG" '"ansicht":"{\"grund\":\"kein-kit\",\"ok\":false}"'
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
    pruefe "ansicht mit Brain-Vault und Kern antwortet {ok:true} (ohne jede Freigabe)" "$STUB_LOG" '"ansicht":"{\"ok\":true}"'
    pruefe "Der Kern wurde bereitgestellt" "$log" " kern bereit(version:"
    pruefe "Status vom gebündelten Kern gelesen" "$log" " status ok"
    pruefe_nicht "nie ein Vertrauens-Status für den Kern" "$log" 'kit-nicht-erlaubt|kit-pruefung|uebersicht-abgelehnt'
    z_status="$(zeile "$log" ' status (ok|hinweis|problem)$')"
    z_auf="$(zeile "$log" ' fenster-auf uebersicht')"
    if [ -n "$z_status" ] && [ -n "$z_auf" ]; then
      echo "  ok   Status gelesen und Übersicht geöffnet (Status Zeile $z_status, Fenster Zeile $z_auf)"
    else
      echo "  FAIL Status oder Übersicht fehlt (Status Zeile ${z_status:-?}, Fenster Zeile ${z_auf:-?})"; FEHLER=1
    fi
    pruefe "Übersicht war nach dem Öffnen bereit (Seite vom Kern geladen)" "$STUB_LOG" '"bereitEins":true'
    # Offene Übersicht (SW-2): brain.config.json verschwindet (Abgleich) → sie schließt; danach öffnet sie wieder
    pruefe "brain.config.json weg + vertrauen-geaendert: die Übersicht schließt" "$STUB_LOG" '"schliesstOhneKonfig":true'
    pruefe_anzahl "Schließgrund 'kein Brain' genau einmal im Log" "$log" ' uebersicht-geschlossen kein-brain$' 1
    pruefe "ansicht ohne brain.config.json: ok:false/kein-kit" "$STUB_LOG" '"ansichtOhneKonfig":"{\"grund\":\"kein-kit\",\"ok\":false}"'
    pruefe "wieder da: die Übersicht öffnet erneut" "$STUB_LOG" '"ansichtZwei":"{\"ok\":true}"'
    pruefe "… und wird bereit" "$STUB_LOG" '"bereitZwei":true'
    pruefe_anzahl "zwei Übersichten geöffnet" "$log" ' fenster-auf uebersicht' 2
    pruefe_anzahl "zwei Übersichten geschlossen" "$log" ' fenster-zu uebersicht$' 2
    z_wechsel="$(zeile "$log" "vault-wechsel $v2")"
    z_zu_uebersicht="$(letzte_zeile "$log" ' fenster-zu uebersicht$')"
    z_zu_studio="$(zeile "$log" 'fenster-zu studio')"
    if [ -n "$z_wechsel" ] && [ -n "$z_zu_uebersicht" ] && [ -n "$z_zu_studio" ] && [ "$z_zu_uebersicht" -ge $((z_wechsel - 1)) ] && [ "$z_zu_uebersicht" -lt "$z_zu_studio" ]; then
      echo "  ok   Vault-Wechsel schließt die offene Übersicht (Fenster-zu steht unmittelbar am Wechsel, vor dem Schließen des Studios)"
    else
      echo "  FAIL Übersicht wurde beim Vault-Wechsel nicht geschlossen (Wechsel Zeile ${z_wechsel:-?}, Übersicht zu ${z_zu_uebersicht:-?}, Studio zu ${z_zu_studio:-?})"; FEHLER=1
    fi
    if [ -e "$marke" ]; then echo "  FAIL Code aus <vault>/.tools ist gelaufen (Marke: $(tr '\n' ' ' < "$marke"))"; FEHLER=1; else echo "  ok   das alte .tools im Vault ist nie gelaufen (keine Marke)"; fi
    ;;
  ohne-kern)
    pruefe "Vault aus vaults.json beim Start" "$log" "vault $v1"
    # Fehlt der Kern im Paket, meldet die App das klar — und weicht nicht auf das .tools im Vault aus.
    pruefe "Kern nicht bereit im Log (Meldung)" "$log" "kern-nicht-bereit Der Kern (die Brain-Logik) fehlt im App-Paket"
    pruefe "Status: 'Kern nicht bereit'" "$log" " status kern-nicht-bereit"
    pruefe "ansicht ohne Kern: ok:false/kern-nicht-bereit" "$STUB_LOG" '"ansicht":"{\"grund\":\"kern-nicht-bereit\",\"ok\":false}"'
    pruefe "Übersicht abgelehnt (Kern fehlt)" "$log" "uebersicht-abgelehnt kern-nicht-bereit"
    pruefe_nicht "Status wurde nie gelesen" "$log" ' status (ok|hinweis|problem)$'
    pruefe_nicht "Übersicht wurde nie geöffnet" "$log" ' fenster-auf uebersicht'
    if [ -e "$marke" ]; then echo "  FAIL Code aus <vault>/.tools ist gelaufen (Marke: $(tr '\n' ' ' < "$marke"))"; FEHLER=1; else echo "  ok   kein Ausweichen auf das alte .tools im Vault (keine Marke)"; fi
    ;;
  esac
  keine_spuren "$KENNUNG"
}
# Läufe wählen: KANAL_LAEUFE="ohne-kern" (Standard: alle drei), z. B. zum Eingrenzen eines Fehlers.
LAEUFE="${KANAL_LAEUFE:-leer mit-vault ohne-kern}"
for m in $LAEUFE; do lauf "$m"; done
for m in $LAEUFE; do
  defaults delete "io.github.fbrogno.brain.kanaltest.$$.$m" 2>/dev/null || true
  rm -rf "$HOME/Library/WebKit/io.github.fbrogno.brain.kanaltest.$$.$m" "$HOME/Library/Caches/io.github.fbrogno.brain.kanaltest.$$.$m" 2>/dev/null || true
done
rm -rf "$ARBEIT"
[ "$FEHLER" = 0 ] && echo "OK Aktionskanal" || { echo "FAIL Aktionskanal"; exit 1; }
