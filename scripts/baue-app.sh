#!/bin/bash
# Baut build/Kortex.app (nur arm64): Release-Build, Paket-Struktur, mitgelieferte Node-Laufzeit, Ad-hoc-Signatur.
# Das Node behält seine Original-Signatur (Prüfsumme im Manifest bleibt gültig); Developer-ID-Signatur und
# Notarisierung kommen in M5.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
cd "$W"
[ -f build/node-runtime/manifest.json ] || bash scripts/hole-node.sh
swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)/BrainApp"
APP="$W/build/Kortex.app"
NEU="$W/build/Kortex.app.neu"
rm -rf "$NEU"
mkdir -p "$NEU/Contents/MacOS" "$NEU/Contents/Resources"
cp "$BIN" "$NEU/Contents/MacOS/BrainApp"
cp Ressourcen/Info.plist "$NEU/Contents/Info.plist"
cp -R build/node-runtime "$NEU/Contents/Resources/node-runtime"
codesign --force --sign - "$NEU"
codesign --verify --strict "$NEU"
rm -rf "$APP"
mv "$NEU" "$APP"
echo "Gebaut: $APP"
