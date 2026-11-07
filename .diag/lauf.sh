cd "$(dirname "$0")/.."
(cd Werkzeuge/symbole && npm ci --ignore-scripts --no-audit --no-fund) >/dev/null 2>&1 || true
bash scripts/teste-node.sh --test-concurrency=4 > "$RUNNER_TEMP/lauf.log" 2>&1
grep -E "^# (tests|pass|fail)" "$RUNNER_TEMP/lauf.log"
node .diag/fehler.mjs "$RUNNER_TEMP/lauf.log" 330
