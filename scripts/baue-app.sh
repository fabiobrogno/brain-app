#!/bin/bash
# Baut build/Kortex.app (nur arm64): Release-Build, Paket-Struktur, mitgelieferte Node-Laufzeit, Studio-Ressourcen
# (alle Ordner unter Ressourcen/: studio, werkstatt, mcp, gemeinsam, …), Lizenzhinweise (THIRD-PARTY-NOTICES.md), Ad-hoc-Signatur.
# Das Node behält seine Original-Signatur (Prüfsumme im Manifest bleibt gültig); Developer-ID-Signatur und
# Notarisierung kommen in M5. Sparkle.framework wird nach Contents/Frameworks kopiert und ad-hoc von innen nach außen signiert.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
cd "$W"
# Studio-Bausteine (Oberfläche, Werkstatt, MCP, gemeinsamer Code, Logos) müssen vorhanden sein
for ordner in studio werkstatt mcp gemeinsam logos; do
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
[ -f Ressourcen/AppIcon.icns ] || { echo "FEHLER: Ressourcen/AppIcon.icns fehlt (scripts/baue-icon.sh erzeugt es)." >&2; exit 1; }
cp Ressourcen/AppIcon.icns "$NEU/Contents/Resources/AppIcon.icns" # App-Icon (Info.plist: CFBundleIconFile)
cp -R build/node-runtime "$NEU/Contents/Resources/node-runtime"
# Alle Ressourcen-Ordner ins Paket (studio, werkstatt, mcp, gemeinsam und was das Backend sonst mitbringt, z. B. Vorlagen)
for d in Ressourcen/*/; do
  ordner="$(basename "$d")"
  [ "$ordner" = "icon-entwuerfe" ] && continue # Entwürfe fürs App-Icon: gehören nicht ins Paket
  cp -R "Ressourcen/$ordner" "$NEU/Contents/Resources/$ordner"
done
# Lizenzen: Hinweise zu Software von Dritten (THIRD-PARTY-NOTICES.md) und die eigene Lizenz ins Paket. Die Hinweise liegen zweimal da:
# im Wurzelordner der Ressourcen (auffindbar im Paket) und neben der Oberfläche (Studio: Einstellungen → „Lizenzen …“ lädt sie von dort).
for f in THIRD-PARTY-NOTICES.md LICENSE; do
  [ -f "$f" ] || { echo "FEHLER: $f fehlt — ohne Lizenzhinweise darf die App nicht gebaut werden." >&2; exit 1; }
done
cp THIRD-PARTY-NOTICES.md "$NEU/Contents/Resources/THIRD-PARTY-NOTICES.md"
cp THIRD-PARTY-NOTICES.md "$NEU/Contents/Resources/studio/THIRD-PARTY-NOTICES.md"
cp LICENSE "$NEU/Contents/Resources/LICENSE"
# Kern (Brain-Logik, Ressourcen/kern): Der MCP-Server samt gemeinsamem Code kommt zusätzlich in den Kern (kern/mcp, kern/gemeinsam), damit
# die MCP-Einträge der KI-Programme auf den stabilen Pfad <support>/bin/kern/mcp/brain-mcp.mjs zeigen können und nicht auf das App-Paket
# (Kern-Umzug P4). Relative Importe (../gemeinsam/…) bleiben dabei gültig. Die Quellen bleiben Ressourcen/mcp und Ressourcen/gemeinsam.
if [ -d "$NEU/Contents/Resources/kern" ]; then
  rm -rf "$NEU/Contents/Resources/kern/mcp" "$NEU/Contents/Resources/kern/gemeinsam"
  cp -R Ressourcen/mcp "$NEU/Contents/Resources/kern/mcp"
  cp -R Ressourcen/gemeinsam "$NEU/Contents/Resources/kern/gemeinsam"
fi
# Kern (Brain-Logik, Ressourcen/kern): Prüfsummen-Manifest daneben, bevor die App signiert wird. Ohne Ressourcen/kern entfällt das.
if [ -d "$NEU/Contents/Resources/kern" ]; then
  bash scripts/kern-manifest.sh erzeuge "$NEU"
  bash scripts/kern-manifest.sh pruefe "$NEU"
else
  echo "Hinweis: Ressourcen/kern fehlt – App ohne Kern (nur Node-Laufzeit)."
fi
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
# Lizenzhinweise im fertigen Paket: vorhanden und nicht leer (auch der Volltext der Node-Lizenz, auf den die Hinweise verweisen)
for f in Resources/THIRD-PARTY-NOTICES.md Resources/studio/THIRD-PARTY-NOTICES.md Resources/LICENSE Resources/node-runtime/LICENSE; do
  [ -s "$NEU/Contents/$f" ] || { echo "FEHLER: $f fehlt im Paket." >&2; exit 1; }
done
rm -rf "$APP"
mv "$NEU" "$APP"
echo "Gebaut: $APP"
