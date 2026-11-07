cd "$(dirname "$0")/.."
(cd Werkzeuge/symbole && npm ci --ignore-scripts --no-audit --no-fund) >/dev/null 2>&1 || true
# .diag/dateien.txt: Testdateien (je Zeile, ohne Pfad); leer = alle. .diag/voll.txt vorhanden = roher Block je rotem Test
DATEIEN=""
for f in $(cat .diag/dateien.txt 2>/dev/null); do DATEIEN="$DATEIEN Tests/Node/$f"; done
if [ -n "$DATEIEN" ]; then
  node --test --test-timeout=60000 --import ./Tests/Node/windows-importe.mjs --test-concurrency=4 $DATEIEN > "$RUNNER_TEMP/lauf.log" 2>&1
else
  bash scripts/teste-node.sh --test-concurrency=4 > "$RUNNER_TEMP/lauf.log" 2>&1
fi
grep -E "^# (tests|pass|fail)" "$RUNNER_TEMP/lauf.log"
if [ -f .diag/voll.txt ]; then node .diag/voll.mjs "$RUNNER_TEMP/lauf.log" 28 300; else node .diag/fehler.mjs "$RUNNER_TEMP/lauf.log" 330; fi
