#!/bin/bash
# Fasst den Log eines Testlaufs der Plattform-Probe (Job „plattform-probe“ in ci.yml) zusammen: Zahlen und Namen der roten Tests.
# Aufruf: bash scripts/plattform-probe-bericht.sh <Titel> <Logdatei> <Ergebnis des Schritts>   → Markdown auf stdout (der Job hängt es an GITHUB_STEP_SUMMARY)
# Immer Exit 0: die Probe misst nur, sie blockiert nichts.
set -u
TITEL="${1:-?}"; LOG="${2:-}"; ERGEBNIS="${3:-unbekannt}"
echo "### ${TITEL} — Schritt: ${ERGEBNIS}"
if [ -z "$LOG" ] || [ ! -s "$LOG" ]; then echo "Kein Log (Schritt nicht gelaufen oder ohne Ausgabe)."; exit 0; fi
# node:test (spec: „ℹ pass 12“, tap: „# pass 12“) und Playwright („12 passed“, „3 failed“)
zahl() { grep -E "^(# |ℹ )$1 [0-9]+" "$LOG" | tail -1 | awk '{print $NF}'; }
T="$(zahl tests)"; P="$(zahl pass)"; F="$(zahl fail)"
if [ -n "$T" ]; then echo "node:test — Tests: ${T}, grün: ${P:-0}, rot: ${F:-0}"; fi
PW_OK="$(grep -E "^ +[0-9]+ passed" "$LOG" | tail -1 | awk '{print $1}')"
PW_ROT="$(grep -E "^ +[0-9]+ failed" "$LOG" | tail -1 | awk '{print $1}')"
if [ -n "$PW_OK$PW_ROT" ]; then echo "Playwright — grün: ${PW_OK:-0}, rot: ${PW_ROT:-0}"; fi
echo
echo "Rote Tests (erste 150):"
echo '```'
{ grep -E "^(✖|not ok) " "$LOG" | grep -vE "^(✖|not ok) [0-9]+ - (tests|suites)" ; grep -E "^ +[0-9]+\) \[" "$LOG"; } | sort -u | head -150
echo '```'
exit 0
