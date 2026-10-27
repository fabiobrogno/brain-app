#!/bin/bash
# Baut build/Kortex.app (nur arm64): Release-Build, Paket-Struktur, mitgelieferte Node-Laufzeit, Studio-Ressourcen
# (alle Ordner unter Ressourcen/: studio, werkstatt, mcp, gemeinsam, …), Ad-hoc-Signatur.
# Das Node behält seine Original-Signatur (Prüfsumme im Manifest bleibt gültig); Developer-ID-Signatur und
# Notarisierung kommen in M5. Sparkle.framework wird nach Contents/Frameworks kopiert und ad-hoc von innen nach außen signiert.
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
BIN_DIR="$(swift build -c release --arch arm64 --show-bin-path)"
BIN="$BIN_DIR/BrainApp"
APP="$W/build/Kortex.app"
NEU="$W/build/Kortex.app.neu"
rm -rf "$NEU"
mkdir -p "$NEU/Contents/MacOS" "$NEU/Contents/Resources"
cp "$BIN" "$NEU/Contents/MacOS/BrainApp"
cp Ressourcen/Info.plist "$NEU/Contents/Info.plist"
cp -R build/node-runtime "$NEU/Contents/Resources/node-runtime"
# Alle Ressourcen-Ordner ins Paket (studio, werkstatt, mcp, gemeinsam und was das Backend sonst mitbringt, z. B. Vorlagen)
for d in Ressourcen/*/; do
  ordner="$(basename "$d")"
  cp -R "Ressourcen/$ordner" "$NEU/Contents/Resources/$ordner"
done
# Sparkle (Update-Framework): ins Paket, Suchpfad für die Programmdatei, Teile einzeln signieren (ohne --deep)
[ -d "$BIN_DIR/Sparkle.framework" ] || { echo "FEHLER: Sparkle.framework fehlt im Build ($BIN_DIR)." >&2; exit 1; }
mkdir -p "$NEU/Contents/Frameworks"
ditto "$BIN_DIR/Sparkle.framework" "$NEU/Contents/Frameworks/Sparkle.framework"
install_name_tool -add_rpath @executable_path/../Frameworks "$NEU/Contents/MacOS/BrainApp"
SPK="$NEU/Contents/Frameworks/Sparkle.framework/Versions/B"
for t in "$SPK"/XPCServices/*.xpc "$SPK/Autoupdate" "$SPK/Updater.app" "$NEU/Contents/Frameworks/Sparkle.framework"; do
  [ -e "$t" ] && codesign --force --sign - "$t"
done
codesign --force --sign - "$NEU"
codesign --verify --strict "$NEU"
rm -rf "$APP"
mv "$NEU" "$APP"
echo "Gebaut: $APP"
