#!/bin/bash
# Rauchtest (App-Spec §13.1/§13.3, Studio-Spec §11, Studio-v2-Spec §2/§8): startet eine Kopie von build/Kortex.app (mit eigener
# Bundle-ID, damit die echte App unberührt bleibt) mehrfach. Der Kern ist der gebündelte aus dem App-Paket (Contents/Resources/kern,
# wie in der Auslieferung, bereitgestellt unter <support>/kern/<Version> mit Link bin/kern); die Wegwerf-Vaults sind Kopien von
# Tests/Kern/fixture (Kern-Umzug P4: kein Kit-Worktree, keine Freigabe nötig).
#  A) mit --vault auf ein Wegwerf-Brain mit Leerzeichen im Namen (nie das Live-Brain): Status vom Kern gelesen, Studio-Fenster erscheint
#     und ist bereit, Werkstatt-Prozess läuft, KEIN Netzwerk-Port, die Übersicht (Brücke aus support/bin/kern, --vault) öffnet; Fenster
#     zu → Brücken beendet; App beenden → keine Node-Prozesse der App übrig.
#  B) OHNE --vault mit leerem Support-Ordner: das Studio öffnet trotzdem ('Willkommen'), die Werkstatt läuft ohne
#     Vault-Argument, es erscheint kein Einrichtungsdialog.
#  E) Frischer Start (--test-frischer-start, nur mit Wegwerf-Support-Ordner): der Assistent „Kortex einrichten“ erscheint von selbst
#     (Log 'assistent-offen'), das Studio wartet auf ihn, der Assistent legt von sich aus keinen Vault an und merkt sich seinen
#     Stand in einrichtung.json.
#  C) OHNE --vault, aber mit vaults.json im Support-Ordner: die App liest den aktiven Vault daraus (Status) und startet die Werkstatt
#     trotzdem ohne Vault-Argument (die Werkstatt liest vaults.json selbst); beendet wird bei offenem Studio.
#  D) Marken-Vault: ein altes Kit (<vault>/.tools/brain.mjs, ansicht/bruecke.mjs), Git-Hooks, core.fsmonitor und eine
#     `node_modules/.bin/git` schreiben je eine Marke, falls sie je laufen. Zwei Läufe, beide mit relativem PATH-Eintrag
#     ('node_modules/.bin:$PATH') und mit den Aktionen `vertrauen-geaendert` und `ansicht` aus der Studio-Oberfläche (--test-skript,
#     BRAIN_TESTMODUS=1). Der Vault ist von außen geöffnet, also nicht vertraut (Workspace-Trust, P5): Git ist ganz gesperrt (status
#     200/gesperrt, sync/commit/verlauf 409 gitGesperrt), und das alte .tools darf NIE laufen (der Kern kommt aus dem Paket):
#       haken    — core.hooksPath im Arbeitsbaum (.githooks) und core.fsmonitor: erst gesperrt; dann bestätigt die Probe den Vault wie die App
#                  (POST /api/vertrauen): Die Werkstatt committet (200), führt aber den Hook-Ordner im Arbeitsbaum nicht aus, Marken: KEINE.
#       gesperrt — Git-Einstellungen, die Programme starten (filter.*.clean, remote.*.uploadpack, Partial Clone mit Nachladen,
#                  diff.external, credential.helper): Git bleibt gesperrt (409), Marken: KEINE (der Vault wird hier nie bestätigt).
#       umleitung — core.worktree und .logs zeigen aus dem Vault hinaus, brain.config.json nennt Ordner wie „../aussen“: Der Kern
#                  schreibt nichts außerhalb (Ordner vorher/nachher gleich), Marken: KEINE.
#     Der Markenpfad steht fest in den Marken-Skripten (keine Umgebungsvariable, die eine bereinigte Umgebung verschluckt), und eine
#     Kontrolle an einer Kopie des Vaults beweist vorher, dass jede Marke wirklich schreibt.
# Keine Spuren (k11): am Ende steht unter der Test-Bundle-ID weder ein gemerkter Fensterrahmen noch ein Ordner in ~/Library/WebKit.
# Port-Check (A): App-PID, Kinder und alle NEU hinzugekommenen com.apple.WebKit.*-Prozesse (XPC-Dienste, keine Kinder).
# Umgebung (optional): BRAIN_TEST_APP (andere .app), BRAIN_RAUCHTEST_PHASEN (Standard "A B C D E").
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
ORIGINAL="${BRAIN_TEST_APP:-$W/build/Kortex.app}"
FIXTURE="$W/Tests/Kern/fixture"
[ -x "$ORIGINAL/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -f "$ORIGINAL/Contents/Resources/werkstatt/werkstatt.mjs" ] || { echo "FAIL: werkstatt.mjs fehlt im Paket"; exit 1; }
[ -f "$ORIGINAL/Contents/Resources/kern/brain.mjs" ] || { echo "FAIL: Kern fehlt im App-Paket (Contents/Resources/kern)"; exit 1; }
# Lizenzhinweise (Drittanbieter) liegen im Paket: im Ressourcen-Ordner, neben der Oberfläche (Einstellungen → „Lizenzen …“) und mit dem Volltext der Node-Lizenz
for lizenz in THIRD-PARTY-NOTICES.md studio/THIRD-PARTY-NOTICES.md LICENSE node-runtime/LICENSE; do
  [ -s "$ORIGINAL/Contents/Resources/$lizenz" ] || { echo "FAIL: $lizenz fehlt im Paket (Lizenzhinweise)"; exit 1; }
done
grep -q "Sparkle 2" "$ORIGINAL/Contents/Resources/studio/THIRD-PARTY-NOTICES.md" || { echo "FAIL: Sparkle fehlt in den Lizenzhinweisen im Paket"; exit 1; }
[ -f "$FIXTURE/brain.config.json" ] || { echo "FAIL: Tests/Kern/fixture fehlt"; exit 1; }
# Eigene Kopie mit eigener Bundle-ID: Die Einstellungen und WebKit-Daten der installierten App bleiben unberührt, und ein
# Neubau von build/Kortex.app während des Laufs stört nicht.
ARBEIT="$(mktemp -d)"
APP="$ARBEIT/Kortex.app"
KENNUNG="io.github.fbrogno.brain.rauchtest.$$"
cp -R "$ORIGINAL" "$APP"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $KENNUNG" "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" 2>/dev/null
aufraeumen() {
  defaults delete "$KENNUNG" 2>/dev/null || true
  rm -rf "$HOME/Library/WebKit/$KENNUNG" "$HOME/Library/Caches/$KENNUNG" "$ARBEIT" 2>/dev/null || true
}
trap aufraeumen EXIT
BASIS="$(mktemp -d)"
VAULT="$BASIS/Test Brain"
mkdir -p "$VAULT"
cp -R "$FIXTURE/." "$VAULT/"
PID=""
LOG=""
RNODE="$APP/Contents/Resources/node-runtime/bin/node"
UEBERSPRUNGEN=()
webkit() { pgrep -f "com.apple.WebKit" | sort || true; }
warte() { for _ in $(seq 1 "$2"); do grep -Eq "$1" "$LOG" 2>/dev/null && return 0; sleep 0.25; done; return 1; }
fehl() { echo "FAIL: $1"; tail -20 "$LOG" 2>/dev/null || true; [ -n "$PID" ] && kill "$PID" 2>/dev/null || true; exit 1; }
lauf() { pgrep -P "$PID" -f "$1" >/dev/null; }
ueberspringe() { echo "SKIP: $1"; UEBERSPRUNGEN+=("$1"); }
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
sauber() { env -i PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" "$@"; }

# ---------- A) mit --vault ----------
phase_a() {
  export BRAIN_APP_SUPPORT="$BASIS/support"
  mkdir -p "$BRAIN_APP_SUPPORT"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  VORHER="$(webkit)"
  # Übersicht (Brücke des Kerns) nur mit --test-fenster; das Studio öffnet beim Start von selbst.
  "$APP/Contents/MacOS/BrainApp" --vault "$VAULT" --test-fenster --test-fenster-schliessen-nach 40 --test-beenden-nach 60 &
  PID=$!
  warte "kern bereit\(version:" 80 || fehl "Der Kern wurde nicht bereitgestellt"
  warte "status (ok|hinweis|problem)" 80 || fehl "Status wurde nicht gelesen"
  [ -f "$BRAIN_APP_SUPPORT/bin/kern/brain.mjs" ] || fehl "support/bin/kern/brain.mjs fehlt (stabiler Kern-Link)"
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
  lauf "bruecke.mjs" || fehl "Kern-Brücke läuft nicht, obwohl die Übersicht offen ist"
  # Die Brücke kommt aus dem stabilen Kern-Pfad (bin/kern) und kennt ihren Vault ausdrücklich per --vault
  local br args
  br="$(pgrep -P "$PID" -f bruecke.mjs | head -1 || true)"
  args="$(ps -o args= -p "$br" 2>/dev/null || true)"
  case "$args" in *"$BRAIN_APP_SUPPORT/bin/kern/ansicht/bruecke.mjs --vault $VAULT") ;; *) fehl "Brücke läuft nicht aus bin/kern mit --vault: $args" ;; esac
  warte "fenster-zu studio" 200 || fehl "Studio wurde nicht geschlossen"
  warte "fenster-zu uebersicht" 40 || fehl "Übersicht wurde nicht geschlossen"
  sleep 3
  if lauf "werkstatt.mjs"; then fehl "Werkstatt läuft nach dem Schließen weiter"; fi
  if lauf "bruecke.mjs"; then fehl "Kern-Brücke läuft nach dem Schließen weiter"; fi
  # Dock-Klick ersetzt: App läuft nach 'Fenster zu' weiter, Beenden räumt auf
  kill -0 "$PID" 2>/dev/null || fehl "App hat sich mit dem letzten Fenster beendet"
  nichts_uebrig "$BASIS"
  echo "OK A: mit --vault (Kern aus bin/kern, Status gelesen, Übersicht geöffnet und geschlossen)"
}

# ---------- B) ohne --vault, leerer Support-Ordner ----------
phase_b() {
  BASIS_B="$(mktemp -d)"
  export BRAIN_APP_SUPPORT="$BASIS_B/support"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  "$APP/Contents/MacOS/BrainApp" --test-fenster-schliessen-nach 25 --test-beenden-nach 45 &
  PID=$!
  warte "kein-vault" 80 || fehl "B: App meldet nicht 'kein-vault' im Log"
  warte "fenster-auf studio" 80 || fehl "B: Studio-Fenster öffnet nicht ohne Vault"
  warte "fenster-bereit studio" 120 || fehl "B: Studio wurde ohne Vault nicht bereit"
  werkstatt_ohne_argument
  if grep -Eq "laufzeit-fehler|fenster-nicht-bereit" "$LOG"; then fehl "B: Laufzeitfehler oder Studio nicht bereit"; fi
  warte "fenster-zu studio" 200 || fehl "B: Studio wurde nicht geschlossen"
  nichts_uebrig "$BASIS_B"
  echo "OK B: ohne --vault, leerer Support-Ordner (Studio öffnet, Werkstatt ohne Vault-Argument)"
}

# ---------- E) frischer Start: der Assistent „Kortex einrichten“ erscheint von selbst, das Studio erst nach ihm ----------
phase_e() {
  BASIS_E="$(mktemp -d)"
  export BRAIN_APP_SUPPORT="$BASIS_E/support"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  # --test-frischer-start gilt nur mit BRAIN_APP_SUPPORT auf einen eigenen Ordner (hier der Wegwerf-Ordner), nie gegen den echten.
  "$APP/Contents/MacOS/BrainApp" --test-frischer-start --test-beenden-nach 20 &
  PID=$!
  warte "assistent-offen automatisch=true" 80 || fehl "E: der Assistent erscheint beim frischen Start nicht"
  warte "kein-vault" 20 || fehl "E: App meldet nicht 'kein-vault' im Log"
  [ -z "$(ls "$BRAIN_APP_SUPPORT/vaults.json" 2>/dev/null)" ] || fehl "E: der Assistent hat von selbst einen Vault angelegt"
  sleep 2
  if grep -q "fenster-auf studio" "$LOG"; then fehl "E: das Studio öffnete schon, obwohl der Assistent offen ist"; fi
  warte "git (vorhanden|fehlt|installiert-gerade|defekt|nicht-pruefbar)" 80 || fehl "E: der git-Stand steht nicht im Log"
  [ -f "$BRAIN_APP_SUPPORT/einrichtung.json" ] || { sleep 2; [ -f "$BRAIN_APP_SUPPORT/einrichtung.json" ] || fehl "E: einrichtung.json (Gedächtnis des Assistenten) wurde nicht geschrieben"; }
  nichts_uebrig "$BASIS_E"
  echo "OK E: frischer Start (Assistent erscheint, Studio wartet, Gedächtnis geschrieben)"
}

# ---------- C) ohne --vault, vaults.json im Support-Ordner ----------
phase_c() {
  BASIS_C="$(mktemp -d)"
  export BRAIN_APP_SUPPORT="$BASIS_C/support"
  mkdir -p "$BRAIN_APP_SUPPORT"
  printf '{"vaults":[{"name":"Test Brain","pfad":"%s","farbe":"#3b82f6"}],"aktiv":"%s"}\n' "$VAULT" "$VAULT" > "$BRAIN_APP_SUPPORT/vaults.json"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  # Kein --test-fenster-schliessen-nach: Die App wird bei OFFENEM Studio beendet (der ⌘Q-Weg: die Oberfläche sichert zuerst).
  "$APP/Contents/MacOS/BrainApp" --test-beenden-nach 22 &
  PID=$!
  warte "^[^ ]+ vault /.*Test Brain$" 80 || fehl "C: aktiver Vault wurde nicht aus vaults.json gelesen"
  warte "status (ok|hinweis|problem)" 80 || fehl "C: Status des Vaults aus vaults.json wurde nicht gelesen"
  warte "fenster-bereit studio" 120 || fehl "C: Studio wurde nicht bereit"
  werkstatt_ohne_argument
  warte "fenster-zu studio" 200 || fehl "C: Beenden bei offenem Studio ist hängen geblieben"
  nichts_uebrig "$BASIS_C"
  echo "OK C: Vault aus vaults.json (Status gelesen, Werkstatt ohne Vault-Argument, Beenden bei offenem Studio)"
}

# ---------- D) Marken-Vault (nicht vertraut): nichts aus dem Vault läuft, auch das alte .tools nicht ----------
# Git für den Aufbau und die Kontrollen: ohne globale und Systemkonfiguration des Nutzers (keine fremden Hooks, Vorlagen, Aliase).
d_git() { GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git "$@"; }
# Marken-Skript: schreibt <name> in die Markendatei. Der Pfad steht FEST im Skript, nicht in einer Umgebungsvariablen: Bei einer
# bereinigten Umgebung wäre sie leer, und ein Kit, das doch läuft, schriebe still nichts — D bestünde zu Unrecht (Review SW-6).
d_marke_sh() { # <datei> <name> <markendatei> [ende]   (ende: ok = Exit 0 | filter = stdin durchreichen, wie ein clean-Filter es muss | sonst Exit 1)
  local ende
  case "${4:-}" in ok) ende="exit 0" ;; filter) ende="cat" ;; *) ende="exit 1" ;; esac
  printf '#!/bin/sh\necho %s >> "%s"\n%s\n' "$2" "$3" "$ende" > "$1"
  chmod +x "$1"
}
d_marke_mjs() { # <datei> <name> <markendatei> <stdout-js>
  printf 'import { appendFileSync } from "node:fs";\nappendFileSync("%s", "%s\\n");\n%s\n' "$3" "$2" "$4" > "$1"
}

# Ein Lauf: <art> = haken | gesperrt (siehe Kopf)
d_lauf() {
  local art="$1" basis marke vd k probe erwartet m ergebnis
  basis="$(mktemp -d)"
  export BRAIN_APP_SUPPORT="$basis/support"
  mkdir -p "$BRAIN_APP_SUPPORT" "$basis/marken"
  LOG="$BRAIN_APP_SUPPORT/logs/app.log"
  vd="$basis/Marken Brain"
  marke="$basis/marken/marke.txt"
  mkdir -p "$vd/.tools/ansicht"
  # Ein Brain-Vault für den Kern (sonst wäre schon der Status "kein Brain"). Seine Konfiguration nennt als „Werkzeuge“ ein Skript im Vault, das
  # eine Marke schreibt, falls es je läuft: früher hätte `brain status` es als git gestartet (Kern-Umzug P4: Programme kommen nie aus dem Vault).
  d_marke_sh "$vd/werkzeug.sh" werkzeug "$marke"
  printf '{"werkzeuge":{"git":"%s","qmd":"%s","claude":"%s","node":"%s","editor":"%s"},"ordner":{"wiki":"../aussen3","inbox":"../aussen3","archiv":"../aussen3"}}\n' "$vd/werkzeug.sh" "$vd/werkzeug.sh" "$vd/werkzeug.sh" "$vd/werkzeug.sh" "$vd/werkzeug.sh" > "$vd/brain.config.json"
  # Ein altes Kit im Vault (brain status, Brücke der Übersicht): Es darf nie laufen, der Kern kommt aus dem App-Paket.
  d_marke_mjs "$vd/.tools/brain.mjs" brain.mjs "$marke" 'console.log(JSON.stringify({ version: "marke", quellVault: false, zustand: "ok", meldungen: [], zahlen: { vorschlaege: 0, konflikte: 0, abgelaufen: 0, zuTun: 0 } }));'
  d_marke_mjs "$vd/.tools/ansicht/bruecke.mjs" bruecke.mjs "$marke" 'process.stdout.write(JSON.stringify({ bereit: true, version: "marke" }) + "\n");
process.stdin.resume();'
  # Git-Wege: ein echtes Repo mit einem Commit (die Marken kommen erst danach, der erste Commit löst keine aus)
  d_git init -q "$vd" && d_git -C "$vd" config user.name Probe && d_git -C "$vd" config user.email probe@example.invalid || fehl "D/$art: git init ist gescheitert"
  printf '# Notiz\n' > "$vd/notiz.md"; printf '# Neu\n' > "$vd/neu.md"
  d_git -C "$vd" add notiz.md && d_git -C "$vd" commit -q -m Start || fehl "D/$art: erster Commit ist gescheitert"
  # Ein `git` im Vault, das nur ein relativer PATH-Eintrag ('node_modules/.bin') vor das echte setzt — schon das Lesen der
  # Git-Einstellungen (Werkstatt: git config --list im Vault-Ordner) startet git im Vault-Ordner (Review SW-3).
  mkdir -p "$vd/node_modules/.bin"; d_marke_sh "$vd/node_modules/.bin/git" fremdes-git "$marke"
  case "$art" in
    haken)
      # Hook-Ordner IM Arbeitsbaum (so liefen die Hooks alter Kit-Vaults, `.tools/git-hooks`; ein Abgleich könnte sie austauschen) und fsmonitor:
      # auch im bestätigten Vault führt die Werkstatt beides nicht aus (core.hooksPath=/dev/null bzw. nur .git/hooks und die Hooks des Kerns).
      mkdir -p "$vd/.githooks"
      for h in pre-commit commit-msg post-commit post-checkout post-merge pre-push; do d_marke_sh "$vd/.githooks/$h" "hook-$h" "$marke" ok; done
      d_git -C "$vd" config core.hooksPath .githooks
      d_marke_sh "$basis/marken/fsmonitor.sh" fsmonitor "$marke"
      d_git -C "$vd" config core.fsmonitor "$basis/marken/fsmonitor.sh"
      erwartet="brain.mjs bruecke.mjs werkzeug fremdes-git hook-pre-commit hook-commit-msg hook-post-commit fsmonitor"
      ;;
    gesperrt)
      # Einstellungen, die Programme starten und sich nicht entschärfen lassen: Git bleibt gesperrt, bis der Nutzer vertraut.
      d_marke_sh "$basis/marken/clean.sh" filter-clean "$marke" filter
      d_marke_sh "$basis/marken/uploadpack.sh" uploadpack "$marke"
      d_marke_sh "$basis/marken/diffext.sh" diff-extern "$marke"
      d_marke_sh "$basis/marken/cred.sh" credential-helper "$marke"
      d_git -C "$vd" config remote.origin.promisor true         # Partial Clone: lesende Befehle würden nachladen (uploadpack/ssh)
      d_git -C "$vd" config remote.origin.partialclonefilter blob:none
      # Umgehungen einer Sperrliste: „=“ im Unterabschnitt und ein lokaler http-Schlüssel (der Kern führt eine Erlaubnisliste und verweigert beides)
      printf '[remote "a=b"]\n\turl = %s\n\tuploadpack = %s\n[http]\n\tproxy = http://127.0.0.1:9\n' "$basis/gegenstelle.git" "$basis/marken/uploadpack.sh" >> "$vd/.git/config"
      d_git -C "$vd" config diff.external "$basis/marken/diffext.sh"
      d_git -C "$vd" config credential.helper "$basis/marken/cred.sh"
      printf '* filter=marke\n' > "$vd/.gitattributes"
      d_git -C "$vd" config filter.marke.clean "$basis/marken/clean.sh"
      d_git init -q --bare "$basis/gegenstelle.git"
      d_git -C "$vd" config remote.origin.url "$basis/gegenstelle.git"
      d_git -C "$vd" config remote.origin.uploadpack "$basis/marken/uploadpack.sh"
      erwartet="brain.mjs bruecke.mjs werkzeug fremdes-git filter-clean uploadpack diff-extern"
      ;;
    umleitung)
      # Arbeitsbaum und .logs zeigen auf Ordner außerhalb des Vaults; „../aussen3“ steht schon in der Konfiguration (siehe oben).
      mkdir -p "$basis/aussen" "$basis/aussen-logs"; printf 'fremd\n' > "$basis/aussen/wichtig.md"
      d_git -C "$vd" config core.worktree "$basis/aussen"
      ln -s "$basis/aussen-logs" "$vd/.logs"
      erwartet="brain.mjs bruecke.mjs werkzeug fremdes-git"
      ;;
  esac
  # Kontrolle: Jede Marke schreibt wirklich, wenn man das Programm ohne die Vorsicht der App laufen lässt (an einer KOPIE des Vaults).
  # Sonst bewiese 'keine Marke' nichts.
  k="$basis/kontrolle"; cp -R "$vd" "$k"
  ( cd "$k" && "$RNODE" .tools/brain.mjs >/dev/null 2>&1; "$RNODE" .tools/ansicht/bruecke.mjs </dev/null >/dev/null 2>&1; ./werkzeug.sh status >/dev/null 2>&1 ) || true
  ( cd "$k" && PATH="node_modules/.bin:$PATH" git --version >/dev/null 2>&1 ) || true
  if [ "$art" = haken ]; then
    ( cd "$k" && printf 'x\n' >> notiz.md && d_git status -s >/dev/null 2>&1; d_git add notiz.md >/dev/null 2>&1; d_git commit -q -m Kontrolle >/dev/null 2>&1 ) || true
  elif [ "$art" = umleitung ]; then
    # Kontrolle: einfaches git schreibt mit core.worktree wirklich in den fremden Ordner (an einem eigenen kleinen Repo)
    mkdir -p "$basis/kontrolle-u/aussen"; d_git init -q "$basis/kontrolle-u/v" && d_git -C "$basis/kontrolle-u/v" config user.name Probe && d_git -C "$basis/kontrolle-u/v" config user.email probe@example.invalid
    printf 'a\n' > "$basis/kontrolle-u/v/a.md"; d_git -C "$basis/kontrolle-u/v" add a.md && d_git -C "$basis/kontrolle-u/v" commit -q -m a || fehl "D/$art: Kontroll-Commit"
    d_git -C "$basis/kontrolle-u/v" config core.worktree "$basis/kontrolle-u/aussen"
    d_git -C "$basis/kontrolle-u/v" reset -q --hard >/dev/null 2>&1 || true
    [ -f "$basis/kontrolle-u/aussen/a.md" ] || fehl "D/$art: die Kontrolle schreibt mit core.worktree nicht in den fremden Ordner — der Test würde nichts beweisen"
  else
    ( cd "$k" && printf 'x\n' >> notiz.md && d_git add notiz.md >/dev/null 2>&1; d_git diff --cached >/dev/null 2>&1; d_git fetch -q origin >/dev/null 2>&1 ) || true
  fi
  for m in $erwartet; do
    grep -qx "$m" "$marke" 2>/dev/null || { echo "Markendatei der Kontrolle:"; cat "$marke" 2>/dev/null || true; fehl "D/$art: Marke '$m' schreibt in der Kontrolle nicht — der Test würde nichts beweisen"; }
  done
  rm -rf "$k" "$marke"
  # Stand der Ordner außerhalb des Vaults vor dem Lauf (Umleitung): danach muss er gleich sein
  aussen_stand() { ( cd "$basis" && find aussen aussen-logs aussen3 -print 2>/dev/null | LC_ALL=C sort; [ -f aussen/wichtig.md ] && shasum aussen/wichtig.md ) 2>/dev/null || true; }
  aussen_vorher="$(aussen_stand)"
  # Die Probe im Studio: vertrauen-geaendert und ansicht (öffnet die Übersicht des Kerns) aus der Oberfläche, dazu die Git-Wege der Werkstatt (nur mit BRAIN_TESTMODUS=1)
  probe="$basis/probe.js"
  # Die Probe kennt den Vault-Pfad und ob sie ihn bestätigen soll (nur „haken“): zwei Zeilen davor, der Rest ist fest.
  { printf 'const VAULT = %s;\nconst BESTAETIGEN = %s;\n' "$("$RNODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$vd")" "$([ "$art" = haken ] && echo true || echo false)"
  cat <<'JS'
const A = window.webkit.messageHandlers.aktion;
const K = window.webkit.messageHandlers.brain;
const web = async (methode, pfad, daten) => {
  try {
    const r = await K.postMessage({ methode, pfad, daten: daten ?? null });
    let w = null; try { w = JSON.parse(r.body); } catch (e) { w = null; }
    return r.status + (w && w.gesperrt === true ? "/gesperrt" : "") + (w && w.gitGesperrt === true ? "/gitGesperrt" : "");
  } catch (e) { return "fehler"; }
};
const t = [];
const g = await A.postMessage({ aktion: "vertrauen-geaendert" });
t.push("geaendert=" + (g && g.ok === true ? "ok" : "?"));
const a = await A.postMessage({ aktion: "ansicht" });
t.push("ansicht=" + (a && a.ok === false ? a.grund : "offen"));
t.push("status=" + await web("GET", "/api/git/status"));
t.push("sync=" + await web("POST", "/api/git/sync", {}));
t.push("commit=" + await web("POST", "/api/git/commit", { nachricht: "Probe", dateien: ["neu.md"] }));
t.push("verlauf=" + await web("GET", "/api/git/verlauf?pfad=notiz.md"));
if (BESTAETIGEN) {
  // wie die App nach dem Klick auf „Vertrauen“: POST /api/vertrauen mit dem gezeigten Vault
  t.push("vertrauen=" + await web("POST", "/api/vertrauen", { erlauben: true, vault: VAULT }));
  t.push("status2=" + await web("GET", "/api/git/status"));
  t.push("commit2=" + await web("POST", "/api/git/commit", { nachricht: "Probe", dateien: ["neu.md"] }));
  t.push("verlauf2=" + await web("GET", "/api/git/verlauf?pfad=notiz.md"));
}
return t.join(" ");
JS
  } > "$probe"
  # PATH mit relativem Eintrag: Ohne die Bereinigung fände jeder Kindprozess im Vault das git aus node_modules/.bin zuerst.
  ( export BRAIN_TESTMODUS=1 PATH="node_modules/.bin:$PATH"
    exec "$APP/Contents/MacOS/BrainApp" --vault "$vd" --test-fenster --test-skript "$probe" --test-fenster-schliessen-nach 16 --test-beenden-nach 22 >/dev/null 2>&1 ) &
  PID=$!
  if [ "$art" = umleitung ]; then
    warte "status-fehler|status (ok|hinweis|problem)" 80 || fehl "D/$art: der Status wurde gar nicht abgerufen"
    if grep -Eq " status (ok|hinweis|problem)$" "$LOG"; then fehl "D/$art: der Kern hat trotz Verweis aus dem Vault hinaus einen Status geliefert"; fi
  else
    warte "status (ok|hinweis|problem)" 80 || fehl "D/$art: der Status vom Kern wurde nicht gelesen"
  fi
  warte "fenster-bereit studio" 120 || fehl "D/$art: Studio wurde nicht bereit"
  warte "test-skript(-fehler| ok) probe.js" 120 || fehl "D/$art: Die Probe im Studio ist nicht gelaufen"
  warte "fenster-zu studio" 200 || fehl "D/$art: Studio wurde nicht geschlossen"
  nichts_uebrig "$basis"
  if [ -e "$marke" ]; then cat "$marke"; fehl "D/$art: Code aus dem Vault ist ohne Freigabe gelaufen (Marke geschrieben)"; fi
  [ "$art" = umleitung ] || grep -q "fenster-auf uebersicht" "$LOG" || fehl "D/$art: die Übersicht des Kerns hat sich nicht geöffnet"
  if [ "$(aussen_stand)" != "$aussen_vorher" ]; then echo "vorher:"; echo "$aussen_vorher"; echo "nachher:"; aussen_stand; fehl "D/$art: außerhalb des Vaults wurde geschrieben"; fi
  [ ! -e "$basis/aussen3" ] || fehl "D/$art: ../aussen3 aus der Konfiguration wurde angelegt"
  grep -q "aktion vertrauen-geaendert" "$LOG" || fehl "D/$art: Die Aktion vertrauen-geaendert kam nicht an"
  grep -q "aktion ansicht" "$LOG" || fehl "D/$art: Die Aktion ansicht kam nicht an"
  ergebnis="$(sed -n 's/.* test-skript ok probe.js [0-9]*ms ergebnis=\(.*\)$/\1/p' "$LOG" | head -1)"
  [ -n "$ergebnis" ] || { grep "test-skript" "$LOG" || true; fehl "D/$art: Die Probe im Studio meldet kein Ergebnis"; }
  case " $ergebnis " in *" geaendert=ok "*) ;; *) fehl "D/$art: vertrauen-geaendert antwortet nicht {ok:true}: $ergebnis" ;; esac
  if [ "$art" != umleitung ]; then
    case " $ergebnis " in *" ansicht=offen "*) ;; *) fehl "D/$art: ansicht (Übersicht des Kerns) antwortet nicht ok: $ergebnis" ;; esac
  fi
  # Nicht vertraut (alle Läufe): Git ist ganz gesperrt — die Marken bleiben aus, weil gar kein git startet
  case " $ergebnis " in *" status=200/gesperrt "*) ;; *) fehl "D/$art: Git-Status meldet ohne Vertrauen nicht 'gesperrt': $ergebnis" ;; esac
  for w in sync commit verlauf; do
    case " $ergebnis " in *" $w=409/gitGesperrt "*) ;; *) fehl "D/$art: $w ist ohne Vertrauen nicht gesperrt (erwartet 409/gitGesperrt): $ergebnis" ;; esac
  done
  if [ "$art" = haken ]; then
    # Nach der Bestätigung (wie die App): Git geht (Commit 200), aber der Hook-Ordner im Arbeitsbaum läuft nicht — sonst bewiese 'keine Marke' nichts.
    case " $ergebnis " in *" vertrauen=200 "*) ;; *) fehl "D/$art: Die Bestätigung (POST /api/vertrauen) ging nicht durch: $ergebnis" ;; esac
    case " $ergebnis " in *" status2=200 "*) ;; *) fehl "D/$art: Git-Status nach der Bestätigung nicht frei (erwartet 200): $ergebnis" ;; esac
    case " $ergebnis " in *" commit2=200 "*) ;; *) fehl "D/$art: Der Commit der Werkstatt ging nach der Bestätigung nicht bis Git (erwartet 200, ohne Hooks): $ergebnis" ;; esac
    case " $ergebnis " in *" verlauf2=200 "*) ;; *) fehl "D/$art: Der Verlauf ist nach der Bestätigung nicht frei (erwartet 200): $ergebnis" ;; esac
    [ "$(d_git -C "$vd" log --format=%s -1 2>/dev/null)" = "Probe" ] || fehl "D/$art: Der Commit nach der Bestätigung steht nicht im Verlauf"
  fi
  echo "OK D/$art: ohne Vertrauen ist Git gesperrt, auch bestätigt läuft nichts aus dem Vault (Probe: $ergebnis; Marken unberührt, Status und Übersicht kamen vom Kern)"
}

phase_d() {
  command -v git >/dev/null 2>&1 || { ueberspringe "D: git fehlt auf diesem Mac — Git-Wege (Hooks, fsmonitor, git aus dem Vault, Sperre) nicht geprüft"; return 0; }
  d_lauf haken
  d_lauf gesperrt
  d_lauf umleitung
}

# Keine Spuren in der echten App (k11): unter der Test-Bundle-ID steht kein gemerkter Fensterrahmen, und WebKit hat nichts angelegt.
keine_spuren() {
  if defaults read "$KENNUNG" 2>/dev/null | grep -qE 'NSWindow Frame (StudioFenster|BrainFenster)'; then
    defaults read "$KENNUNG" 2>/dev/null | grep -E 'NSWindow Frame' || true
    fehl "Ein Testlauf hat einen Fensterrahmen in den Einstellungen gemerkt ($KENNUNG)"
  fi
  [ ! -e "$HOME/Library/WebKit/$KENNUNG" ] || fehl "Ein Testlauf hat WebKit-Daten angelegt (~/Library/WebKit/$KENNUNG)"
  echo "OK Keine Spuren: kein gemerkter Fensterrahmen, keine WebKit-Daten ($KENNUNG)"
}

# Phasen wählen: BRAIN_RAUCHTEST_PHASEN="A" (Standard: "A B C D E"), z. B. solange das Backend ohne Vault-Argument noch fehlt.
PHASEN=" ${BRAIN_RAUCHTEST_PHASEN:-A B C D E} "
[[ "$PHASEN" == *" A "* ]] && phase_a
[[ "$PHASEN" == *" B "* ]] && phase_b
[[ "$PHASEN" == *" C "* ]] && phase_c
[[ "$PHASEN" == *" D "* ]] && phase_d
[[ "$PHASEN" == *" E "* ]] && phase_e
keine_spuren
if [ "${#UEBERSPRUNGEN[@]}" -gt 0 ]; then
  echo
  echo "ÜBERSPRUNGEN (${#UEBERSPRUNGEN[@]}):"
  for u in "${UEBERSPRUNGEN[@]}"; do echo "  - $u"; done
  if [ "${BRAIN_RAUCHTEST_STRENG:-0}" = 1 ]; then echo "FAIL Rauchtest: Übersprungenes zählt im strengen Modus als Fehler"; exit 1; fi
  echo "OK Rauchtest (NICHT vollständig: siehe ÜBERSPRUNGEN)"
else
  echo "OK Rauchtest"
fi
