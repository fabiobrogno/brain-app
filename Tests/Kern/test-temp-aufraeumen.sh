#!/bin/bash
# .tools/tests/test-temp-aufraeumen.sh — Test-Hygiene für Shell-Tests: plattform.sh (von jedem Shell-Test als Erstes gesourct)
# merkt sich alles, was mktemp / mktemp -d anlegt — auch in $(…)-Teilshells —, und löscht es beim Exit des Tests.
# Eigene EXIT-Traps der Tests laufen weiter (sie werden verkettet, nicht ersetzt). Auch bei Fehlschlag (exit 1) bleibt nichts liegen.
# Zwei Fallen, die dieser Test kennen muss:
#  - macOS: `mktemp -d` OHNE Vorlage ignoriert $TMPDIR (BSD-mktemp nimmt den Benutzer-Temp-Ordner aus confstr). Ein „TMPDIR-Ordner ist leer“-Check prüft dort nichts,
#    wenn der Test ohne Vorlage anlegt. Darum legt jeder Fall zusätzlich mit Vorlage "$TMPDIR/…XXXXXX" an (landet auf macOS wie Linux im Wegwerf-Ordner $W, wo leer()
#    es sieht) UND prüft die ohne Vorlage angelegten Pfade einzeln (nach dem Exit nicht mehr da). Dass leer() wirklich anschlägt, beweist die Gegenprobe (Fall 5).
#  - Signale: Läuft der Test im Hintergrund (&, nohup, Cron), ist SIGINT (und ggf. SIGHUP) beim Start ignoriert — eine Shell kann ein beim Start ignoriertes Signal
#    weder fangen noch zurücksetzen (POSIX), `trap -p INT` bliebe leer. Die Signal-Trap-Fälle nehmen darum USR1, das nie ignoriert vorgegeben wird.
set -u; D="$(cd "$(dirname "$0")" && pwd)"
. "$D/plattform.sh"
W="$(mktemp -d)"            # TMPDIR der Kind-Shells (wird wie jedes mktemp-Ergebnis beim Exit dieses Tests gelöscht)
W2="$(mktemp -d)"           # Marken außerhalb von TMPDIR der Kind-Shells
fail() { echo "FAIL: $*"; exit 1; }
leer() { [ -z "$(ls -A "$W")" ]; }
kind() { TMPDIR="$W" BRAIN_TEST_TEMP_BEHALTEN="${BEHALTEN:-}" bash -c ". \"$D/plattform.sh\"; $1"; }

# 1) Ordner, Datei, Template-Ordner und die Form T="$(mktemp -d)/Mein Brain" (Teilshell!) — alles weg, Exit-Code bleibt 0
#    (T, F: ohne Vorlage — nur über den Pfad prüfbar; V, H, G: mit Vorlage unter $TMPDIR — dort sieht es auch leer())
OUT=$(kind 'T="$(mktemp -d)/Mein Brain"; mkdir -p "$T"; echo x > "$T/f"; F=$(mktemp); echo x > "$F"; V=$(mktemp -d "$TMPDIR/vXXXX"); H="$(mktemp -d "$TMPDIR/hXXXXXX")/Mein Brain"; mkdir -p "$H"; G=$(mktemp "$TMPDIR/gXXXXXX"); echo "$T|$F|$V|$H|$G"; exit 0'); RC=$?
[ "$RC" = 0 ] || fail "Kind-Shell endet nicht mit 0 ($RC)"
IFS='|' read -r T F V H G <<< "$OUT"
[ -n "$T" ] && [ -n "$F" ] && [ -n "$V" ] && [ -n "$H" ] && [ -n "$G" ] || fail "Kind lieferte keine Pfade: $OUT"
for p in "$T" "$F" "$V" "$H" "$G"; do [ ! -e "$p" ] || fail "nach dem Exit noch da: $p"; done
case "$V" in "$W"/*) ;; *) fail "Vorlage unter \$TMPDIR landet nicht in $W: $V" ;; esac
leer || fail "Temp-Ordner nicht leer: $(ls -A "$W")"

# 2) Fehlschlag (exit 7) räumt ebenfalls auf, der Exit-Code bleibt erhalten
OUT=$(kind 'T=$(mktemp -d); U=$(mktemp -d "$TMPDIR/tXXXXXX"); echo "$T|$U"; exit 7'); RC=$?
[ "$RC" = 7 ] || fail "Exit-Code 7 erwartet, war $RC"
IFS='|' read -r T U <<< "$OUT"
[ -n "$T" ] && [ -n "$U" ] && [ ! -e "$T" ] && [ ! -e "$U" ] || fail "nach exit 7 noch da: $OUT"
leer || fail "Temp-Ordner nicht leer nach exit 7"

# 3) Eigener EXIT-Trap des Tests läuft weiter (der zuletzt gesetzte, wie gewohnt) UND der Temp-Ordner wird trotzdem gelöscht
OUT=$(kind 'T=$(mktemp -d); U=$(mktemp -d "$TMPDIR/tXXXXXX"); trap "echo EINS >> \"'"$W2"'/marke\"" EXIT; trap "echo ZWEI >> \"'"$W2"'/marke\"; [ -d \"$U\" ] && echo DA >> \"'"$W2"'/marke\"" EXIT; echo "$T|$U"')
[ "$(tr '\n' ' ' < "$W2/marke")" = "ZWEI DA " ] || fail "eigener EXIT-Trap: erwartet 'ZWEI DA', war '$(tr '\n' ' ' < "$W2/marke")'"
IFS='|' read -r T U <<< "$OUT"
[ -n "$T" ] && [ -n "$U" ] && [ ! -e "$T" ] && [ ! -e "$U" ] || fail "Temp-Ordner trotz eigenem Trap nicht gelöscht: $OUT"
leer || fail "Temp-Ordner nicht leer nach eigenem Trap"

# 4) Andere trap-Formen bleiben benutzbar: Signal-Traps, trap -p; trap - EXIT hebt nur den EIGENEN Trap auf, aufgeräumt wird trotzdem
#    (USR1 statt INT: ein im Hintergrund/unter nohup ignoriertes INT/HUP lässt sich nicht fangen — siehe oben)
OUT=$(kind 'trap "echo x" USR1; trap -p USR1 > "'"$W2"'/trapp"; trap - USR1; trap -p USR1 > "'"$W2"'/trapp2"; trap - EXIT; T=$(mktemp -d); U=$(mktemp -d "$TMPDIR/tXXXXXX"); echo "$T|$U"')
grep -q "echo x" "$W2/trapp" || fail "trap -p USR1 lieferte nicht den Signal-Trap: $(cat "$W2/trapp")"
[ ! -s "$W2/trapp2" ] || fail "trap - USR1 hat den Signal-Trap nicht zurückgesetzt: $(cat "$W2/trapp2")"
IFS='|' read -r T U <<< "$OUT"
[ -n "$T" ] && [ -n "$U" ] && [ ! -e "$T" ] && [ ! -e "$U" ] || fail "nach trap - EXIT muss trotzdem aufgeräumt sein: $OUT"
leer || fail "Temp-Ordner nicht leer nach trap - EXIT"

# 5) Debug-Schalter: BRAIN_TEST_TEMP_BEHALTEN=1 lässt alles liegen — zugleich die Gegenprobe, dass leer() anschlägt (sonst bewiese „leer“ nichts)
#    Behalten bleibt auch die Registratur ($_TEMP_LISTE). Sie entsteht ohne Vorlage: auf Linux in $TMPDIR (= $W), auf macOS anderswo.
OUT=$(BEHALTEN=1 kind 'T=$(mktemp -d); U=$(mktemp -d "$TMPDIR/tXXXXXX"); echo "$T|$U|$_TEMP_LISTE"')
IFS='|' read -r T U L <<< "$OUT"
[ -d "$T" ] && [ -d "$U" ] || fail "BRAIN_TEST_TEMP_BEHALTEN=1 muss die Ordner behalten: $OUT"
leer && fail "leer() schlägt nicht an, obwohl in $W etwas liegt — die leer()-Prüfungen dieses Tests wären wirkungslos"
node -e 'for (const p of process.argv.slice(1)) require("fs").rmSync(p, { recursive: true, force: true })' "$T" "$U" "$L"
leer || fail "Temp-Ordner nicht leer nach dem Behalten-Test"

# 6) Scheitert mktemp selbst, kommt der Fehlercode durch und es wird nichts Falsches vorgemerkt (Registratur: nur ihre eigene Datei)
kind 'mktemp -d /gibt/es/nicht/XXXX 2>/dev/null; echo "rc=$?" > "'"$W2"'/rc"; wc -l < "$_TEMP_LISTE" | tr -d " " > "'"$W2"'/anzahl"'
grep -q 'rc=[1-9]' "$W2/rc" || fail "Fehlercode von mktemp geht verloren"
[ "$(cat "$W2/anzahl")" = 1 ] || fail "nach fehlgeschlagenem mktemp steht mehr als die Registratur selbst in der Liste: $(cat "$W2/anzahl") Zeilen"
leer || fail "Temp-Ordner nicht leer nach fehlgeschlagenem mktemp"

echo "OK test-temp-aufraeumen"
