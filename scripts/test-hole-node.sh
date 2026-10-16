#!/bin/bash
# Prüft hole-node.sh: richtige Version, Prüfsumme im Manifest stimmt, arm64, und ein manipuliertes Archiv wird abgewiesen.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
bash "$W/scripts/hole-node.sh" >/dev/null
SOLL="$(tr -d '[:space:]' < "$W/scripts/node-version.txt")"
IST="$("$W/build/node-runtime/bin/node" --version)"
[ "$IST" = "$SOLL" ] || { echo "FAIL Version: $IST statt $SOLL"; exit 1; }
SHA="$(shasum -a 256 "$W/build/node-runtime/bin/node" | cut -d' ' -f1)"
grep -q "\"sha256\":\"$SHA\"" "$W/build/node-runtime/manifest.json" || { echo "FAIL Manifest-Prüfsumme"; exit 1; }
grep -q "\"version\":\"$SOLL\"" "$W/build/node-runtime/manifest.json" || { echo "FAIL Manifest-Version"; exit 1; }
file "$W/build/node-runtime/bin/node" | grep -q arm64 || { echo "FAIL nicht arm64"; exit 1; }
# Manipulation: ein Byte im zwischengespeicherten Archiv ändern → Skript muss scheitern und das Archiv verwerfen
TAR="$W/build/cache/node-$SOLL-darwin-arm64.tar.gz"
printf 'X' | dd of="$TAR" bs=1 seek=100 conv=notrunc 2>/dev/null
if bash "$W/scripts/hole-node.sh" >/dev/null 2>&1; then echo "FAIL manipuliertes Archiv akzeptiert"; exit 1; fi
[ ! -f "$TAR" ] || { echo "FAIL manipuliertes Archiv nicht verworfen"; exit 1; }
bash "$W/scripts/hole-node.sh" >/dev/null   # sauberen Stand wieder herstellen
echo "OK hole-node"
