#!/bin/bash
# Holt das offizielle Node (darwin-arm64) in der Version aus scripts/node-version.txt, prüft die SHA-256 gegen
# SHASUMS256.txt von nodejs.org und legt bin/node + LICENSE + manifest.json unter build/node-runtime/ ab.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$W/scripts/node-version.txt")"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "node-version.txt ungültig: $VERSION" >&2; exit 1; }
NAME="node-$VERSION-darwin-arm64"
ZIEL="$W/build/node-runtime"
CACHE="$W/build/cache"
mkdir -p "$CACHE"
TAR="$CACHE/$NAME.tar.gz"
SUMS="$CACHE/SHASUMS256-$VERSION.txt"
[ -f "$SUMS" ] || curl -fsSL -o "$SUMS" "https://nodejs.org/dist/$VERSION/SHASUMS256.txt"
[ -f "$TAR" ] || curl -fsSL -o "$TAR" "https://nodejs.org/dist/$VERSION/$NAME.tar.gz"
SOLL="$(grep " $NAME.tar.gz\$" "$SUMS" | cut -d' ' -f1)"
IST="$(shasum -a 256 "$TAR" | cut -d' ' -f1)"
if [ -z "$SOLL" ] || [ "$SOLL" != "$IST" ]; then
  echo "Prüfsumme stimmt nicht für $NAME — Download verworfen." >&2
  rm -f "$TAR"
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TAR" -C "$TMP" "$NAME/bin/node" "$NAME/LICENSE"
rm -rf "$ZIEL"
mkdir -p "$ZIEL/bin"
cp "$TMP/$NAME/bin/node" "$ZIEL/bin/node"
cp "$TMP/$NAME/LICENSE" "$ZIEL/LICENSE"
chmod 755 "$ZIEL/bin/node"
BIN_SHA="$(shasum -a 256 "$ZIEL/bin/node" | cut -d' ' -f1)"
printf '{"version":"%s","sha256":"%s"}\n' "$VERSION" "$BIN_SHA" > "$ZIEL/manifest.json"
echo "Node $VERSION bereit: $ZIEL"
