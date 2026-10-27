#!/bin/bash
# Node-Prüfsumme im App-Paket (Contents/Resources/node-runtime/manifest.json) – für scripts/veroeffentlichen.sh.
#
#   bash scripts/node-manifest.sh pruefe-original <Kortex.app>   VOR dem Signieren: das mitgelieferte bin/node ist
#                                                               byte-gleich dem Node von nodejs.org (SHASUMS256.txt)
#   bash scripts/node-manifest.sh nachziehen <Kortex.app>        NACH dem Signieren von bin/node, VOR dem Signieren der App:
#                                                               schreibt die neue SHA-256 ins Manifest
#
# Warum: Das Signieren (codesign) ändert die Bytes von bin/node. Die App prüft beim Kopieren nach Application Support
# die SHA-256 gegen das Manifest (Sources/BrainCore/NodeLaufzeit.swift) und bricht sonst mit pruefsummeFalsch ab.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
MODUS="${1:-}"; APP="${2:-}"
[ -n "$MODUS" ] && [ -d "$APP" ] || { sed -n '2,10p' "$0" >&2; exit 2; }
RT="$APP/Contents/Resources/node-runtime"
NODE="$RT/bin/node"; MANIFEST="$RT/manifest.json"
[ -f "$NODE" ] && [ -f "$MANIFEST" ] || { echo "FEHLT: $NODE oder $MANIFEST" >&2; exit 1; }
VERSION="$(plutil -extract version raw -o - "$MANIFEST")"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Manifest-Version ungültig: $VERSION" >&2; exit 1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

case "$MODUS" in
  pruefe-original)
    NAME="node-$VERSION-darwin-arm64"
    CACHE="${NODE_CACHE:-$W/build/cache}"; mkdir -p "$CACHE"
    SUMS="$CACHE/SHASUMS256-$VERSION.txt"; TAR="$CACHE/$NAME.tar.gz"
    [ -f "$SUMS" ] || curl -fsSL -o "$SUMS" "https://nodejs.org/dist/$VERSION/SHASUMS256.txt"
    [ -f "$TAR" ] || curl -fsSL -o "$TAR" "https://nodejs.org/dist/$VERSION/$NAME.tar.gz"
    SOLL="$(grep " $NAME.tar.gz\$" "$SUMS" | cut -d' ' -f1)"
    [ -n "$SOLL" ] && [ "$SOLL" = "$(sha "$TAR")" ] || { echo "Abbruch: Prüfsumme des Node-Downloads stimmt nicht mit nodejs.org überein." >&2; exit 1; }
    TMP="$(mktemp -d)"
    tar -xzf "$TAR" -C "$TMP" "$NAME/bin/node"
    ORIG="$(sha "$TMP/$NAME/bin/node")"
    [ "$ORIG" = "$(sha "$NODE")" ] || { echo "Abbruch: Das mitgelieferte Node ist nicht das Original von nodejs.org ($VERSION)." >&2; exit 1; }
    echo "  ok: mitgeliefertes Node $VERSION = Original von nodejs.org"
    ;;
  nachziehen)
    codesign --verify --strict "$NODE" >/dev/null 2>&1 || { echo "Abbruch: bin/node ist nicht (mehr) gültig signiert." >&2; exit 1; }
    NEU="$(sha "$NODE")"
    printf '{"version":"%s","sha256":"%s"}\n' "$VERSION" "$NEU" > "$MANIFEST"
    echo "  ok: Manifest auf die Prüfsumme des signierten Node gesetzt ($NEU)"
    ;;
  *) echo "Unbekannter Modus: $MODUS" >&2; exit 2 ;;
esac
