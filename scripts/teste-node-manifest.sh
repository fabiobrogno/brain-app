#!/bin/bash
# Prüft ohne Zertifikat (Ad-hoc-Signatur): Nach dem Neu-Signieren von bin/node stimmt das Manifest nicht mehr (Fehlerbild),
# nach `node-manifest.sh nachziehen` stimmt es wieder – und das Original wurde vorher gegen nodejs.org geprüft.
# Aufruf: bash scripts/teste-node-manifest.sh [Kortex.app]   (Standard: build/Kortex.app, wird nur kopiert)
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
QUELLE="${1:-$W/build/Kortex.app}"
T="$(mktemp -d)"
ditto "$QUELLE" "$T/Kortex.app"
RT="$T/Kortex.app/Contents/Resources/node-runtime"
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
manifest_sha() { plutil -extract sha256 raw -o - "$RT/manifest.json"; }
bash "$W/scripts/node-manifest.sh" pruefe-original "$T/Kortex.app"
codesign --force --options runtime --sign - --entitlements "$W/Ressourcen/node.entitlements" "$RT/bin/node" 2>/dev/null
[ "$(manifest_sha)" != "$(sha "$RT/bin/node")" ] || { echo "ROT: Neusignatur hat die Prüfsumme nicht verändert (Test sinnlos)" >&2; exit 1; }
bash "$W/scripts/node-manifest.sh" nachziehen "$T/Kortex.app"
[ "$(manifest_sha)" = "$(sha "$RT/bin/node")" ] || { echo "ROT: Manifest passt nicht zum signierten Node" >&2; exit 1; }
echo "grün: Manifest folgt der Signatur ($T)"
