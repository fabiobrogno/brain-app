#!/bin/bash
# Gesamtsuite: Unit-Tests + Shell-Tests. Exit ≠ 0, sobald einer rot ist.
set -u; D="$(cd "$(dirname "$0")" && pwd)"; RC=0
. "$D/stage.sh" "$@"   # Kern-Wurzel (KORTEX_KERN): baut bei Bedarf die Bühne und läuft dort weiter (siehe stage.sh)
bash "$D/unit.sh" || RC=1   # node --test --import setup.mjs (räumt Temp-Ordner auf, Fake-qmd)
for t in "$D"/test-*.sh; do
  OUT=$(mktemp)
  if bash "$t" >"$OUT" 2>&1; then
    echo "OK $(basename "$t")"
    grep '^SKIP' "$OUT" | sed 's/^/    /'
  else
    echo "FAIL $(basename "$t")"
    tail -n 40 "$OUT" | sed 's/^/    /'
    RC=1
  fi
  rm -f "$OUT"
done
exit $RC
