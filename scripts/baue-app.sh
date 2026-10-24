#!/bin/bash
# Baut build/Brain.app (nur arm64): Release-Build, Paket-Struktur, mitgelieferte Node-Laufzeit, Studio-Ressourcen
# (studio, werkstatt, mcp, gemeinsam), Ad-hoc-Signatur.
# Das Node behält seine Original-Signatur (Prüfsumme im Manifest bleibt gültig); Developer-ID-Signatur und
# Notarisierung kommen in M5.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
cd "$W"
# Studio-Bausteine (Oberfläche, Werkstatt, MCP, gemeinsamer Code) müssen vorhanden sein
for ordner in studio werkstatt mcp gemeinsam; do
  [ -d "Ressourcen/$ordner" ] || { echo "FEHLER: Ressourcen/$ordner fehlt — ohne diesen Ordner entsteht keine vollständige App." >&2; exit 1; }
done
[ -f Ressourcen/werkstatt/werkstatt.mjs ] || { echo "FEHLER: Ressourcen/werkstatt/werkstatt.mjs fehlt." >&2; exit 1; }
[ -f build/node-runtime/manifest.json ] || bash scripts/hole-node.sh
swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)/BrainApp"
APP="$W/build/Brain.app"
NEU="$W/build/Brain.app.neu"
rm -rf "$NEU"
mkdir -p "$NEU/Contents/MacOS" "$NEU/Contents/Resources"
cp "$BIN" "$NEU/Contents/MacOS/BrainApp"
cp Ressourcen/Info.plist "$NEU/Contents/Info.plist"
cp -R build/node-runtime "$NEU/Contents/Resources/node-runtime"
for ordner in studio werkstatt mcp gemeinsam; do
  cp -R "Ressourcen/$ordner" "$NEU/Contents/Resources/$ordner"
done
codesign --force --sign - "$NEU"
codesign --verify --strict "$NEU"
rm -rf "$APP"
mv "$NEU" "$APP"
echo "Gebaut: $APP"
