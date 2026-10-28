#!/bin/bash
# Hook-Laufzeiten (Spec §13.2) — als Shell-Test, damit die zeitkritischen Prüfungen nicht in der Commit-Prüfung
# (node --test .tools/tests/test-*.mjs, parallel, 120 s) laufen und dort unter Last zufällig Commits blockieren.
. "$(dirname "$0")/plattform.sh"
set -u; cd "$(dirname "$0")"
OUT=$(bash ./unit.sh laufzeit-hooks.mjs 2>&1) || { echo "$OUT" | tail -n 40; echo "FAIL: Hook-Laufzeiten"; exit 1; }
echo "OK test-hook-laufzeit"
