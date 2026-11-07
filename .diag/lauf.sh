cd "$(dirname "$0")/.."
(cd Werkzeuge/symbole && npm ci --ignore-scripts --no-audit --no-fund) >/dev/null 2>&1 || true
if [ -f .diag/probe.txt ]; then node --import ./Tests/Node/windows-importe.mjs .diag/probe.mjs 2>&1 | cut -c1-1800; fi
# .diag/dateien.txt: Node-Testdateien (je Zeile, ohne Pfad); leer = alle. .diag/voll.txt vorhanden = roher Block je rotem Test
DATEIEN=""
for f in $(cat .diag/dateien.txt 2>/dev/null); do DATEIEN="$DATEIEN Tests/Node/$f"; done
if [ -f .diag/nurkern.txt ]; then :; elif [ -n "$DATEIEN" ]; then
  node --test --test-timeout=60000 --import ./Tests/Node/windows-importe.mjs --test-concurrency=4 $DATEIEN > "$RUNNER_TEMP/lauf.log" 2>&1
else
  bash scripts/teste-node.sh --test-concurrency=4 > "$RUNNER_TEMP/lauf.log" 2>&1
fi
if [ ! -f .diag/nurkern.txt ]; then
  grep -E "^# (tests|pass|fail)" "$RUNNER_TEMP/lauf.log"
  if [ -f .diag/voll.txt ]; then node .diag/voll.mjs "$RUNNER_TEMP/lauf.log" 24 280; else node .diag/fehler.mjs "$RUNNER_TEMP/lauf.log" 330; fi
fi
# Kern: .diag/kern.txt = Dateien (je Zeile, ohne Pfad); „alle“ = ganze Suite
if [ -s .diag/kern.txt ]; then
  KD=""; for f in $(cat .diag/kern.txt); do [ "$f" = alle ] || KD="$KD Tests/Kern/$f"; done
  export KERN_TEST_KONKURRENZ=4 GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=t@example.org GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=t@example.org
  bash Tests/Kern/unit.sh $KD > "$RUNNER_TEMP/kern.log" 2>&1
  grep -E "^ℹ (tests|pass|fail)" "$RUNNER_TEMP/kern.log" || tail -n 12 "$RUNNER_TEMP/kern.log" | cut -c1-220
  node .diag/kernfehler.mjs "$RUNNER_TEMP/kern.log" "${KERN_ZEILEN:-9}"
fi
