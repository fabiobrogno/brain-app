#!/bin/bash
# Erzeugt Ressourcen/AppIcon.icns aus den SVG-Entwürfen (Entwurf C): 16 und 32 px aus der kräftigeren Kleinvariante
# (kortex-c-k-klein.svg), alle größeren aus dem vollen Entwurf (kortex-c-k.svg). Braucht rsvg-convert (brew install librsvg) und iconutil.
# Die erzeugte .icns liegt im Repo; dieses Skript muss nur laufen, wenn sich ein Entwurf ändert.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
E="$W/Ressourcen/icon-entwuerfe"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
SET="$T/AppIcon.iconset"
mkdir -p "$SET"
bild() { # <svg> <pixel> <dateiname>
  rsvg-convert -w "$2" -h "$2" "$1" -o "$SET/$3"
}
GROSS="$E/kortex-c-k.svg"
KLEIN="$E/kortex-c-k-klein.svg"
bild "$KLEIN" 16 icon_16x16.png
bild "$KLEIN" 32 icon_16x16@2x.png
bild "$KLEIN" 32 icon_32x32.png
bild "$GROSS" 64 icon_32x32@2x.png
bild "$GROSS" 128 icon_128x128.png
bild "$GROSS" 256 icon_128x128@2x.png
bild "$GROSS" 256 icon_256x256.png
bild "$GROSS" 512 icon_256x256@2x.png
bild "$GROSS" 512 icon_512x512.png
bild "$GROSS" 1024 icon_512x512@2x.png
iconutil -c icns "$SET" -o "$W/Ressourcen/AppIcon.icns"
echo "Gebaut: Ressourcen/AppIcon.icns"
