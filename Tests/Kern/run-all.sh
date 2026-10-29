#!/bin/bash
# Gesamtsuite: Unit-Tests + Shell-Tests. Exit ≠ 0, sobald einer rot ist.
# Aufruf:  bash Tests/Kern/run-all.sh                 alles (lokal wie bisher)
#          bash Tests/Kern/run-all.sh --shard I/N     nur Teil I von N (1 ≤ I ≤ N); auch über KERN_SHARD=I/N. So teilt die CI die
#                                                     Suite auf parallele Jobs auf. Die Teile sind disjunkt und decken alles ab:
#                                                     Verteilung nach Gewichten aus gewichte.txt (größte zuerst, immer auf den
#                                                     gerade leersten Teil), Dateien ohne Eintrag zählen als kurz.
# KERN_TEST_KONKURRENZ=<n>: Anzahl paralleler Testdateien in den Unit-Tests (siehe unit.sh).
set -u; D="$(cd "$(dirname "$0")" && pwd)"; RC=0
if [ "${1:-}" = "--shard" ]; then export KERN_SHARD="${2:?--shard braucht I/N}"; shift 2; fi
. "$D/stage.sh" "$@"   # Kern-Wurzel (KORTEX_KERN): baut bei Bedarf die Bühne und läuft dort weiter (siehe stage.sh)

UNIT=(); SHELLS=()
if [ -n "${KERN_SHARD:-}" ]; then
  I="${KERN_SHARD%/*}"; N="${KERN_SHARD#*/}"
  case "$I$N" in ''|*[!0-9]*) echo "run-all.sh: ungültiger Shard '$KERN_SHARD' (erwartet I/N)" >&2; exit 2 ;; esac
  { [ "$I" -ge 1 ] && [ "$I" -le "$N" ]; } || { echo "run-all.sh: Shard '$KERN_SHARD' außerhalb 1..N" >&2; exit 2; }
  # Kosten: Shell-Tests laufen nacheinander und auf dem Runner etwa doppelt so lange wie auf dem Mac (Gewicht × 2),
  # Unit-Dateien parallel zu etwa 4 (Gewicht / 4).
  while IFS= read -r f; do
    case "$f" in *.mjs) UNIT+=("$D/$f") ;; *.sh) SHELLS+=("$D/$f") ;; esac
  done < <(cd "$D" && ls test-*.mjs test-*.sh | LC_ALL=C awk -v G="$D/gewichte.txt" '
      BEGIN { while ((getline z < G) > 0) { if (z ~ /^#/ || z == "") continue; split(z, a, " "); w[a[2]] = a[1] } }
      { c = ($0 in w) ? w[$0] : 3; c = ($0 ~ /\.mjs$/) ? c / 4 : c * 2; printf "%.3f %s\n", c, $0 }' \
    | LC_ALL=C sort -k1,1nr -k2,2 \
    | LC_ALL=C awk -v N="$N" -v I="$I" '{ m = 1; for (i = 2; i <= N; i++) if (s[i] < s[m]) m = i; s[m] += $1; if (m == I) print $2 }')
  echo "Shard $KERN_SHARD: ${#UNIT[@]} Unit-Dateien, ${#SHELLS[@]} Shell-Tests"
else
  for t in "$D"/test-*.sh; do SHELLS+=("$t"); done
fi

# Unit-Tests: ohne Shard alle (unit.sh ohne Argumente), mit Shard genau die Dateien des Teils (leer = nichts zu tun).
if [ -z "${KERN_SHARD:-}" ]; then
  bash "$D/unit.sh" || RC=1   # node --test --import setup.mjs (räumt Temp-Ordner auf, Fake-qmd)
elif [ "${#UNIT[@]}" -gt 0 ]; then
  bash "$D/unit.sh" "${UNIT[@]}" || RC=1
fi
for t in ${SHELLS[@]+"${SHELLS[@]}"}; do
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
