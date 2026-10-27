#!/bin/bash
# Prüft Signatur, Gatekeeper-Bewertung und Notar-Beleg (Staple) von App und DMG.
# Aufruf: bash scripts/pruefe-signatur.sh [App] [DMG]   (Standard: build/Kortex.app und die neueste build/Kortex-*.dmg)
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$W/build/Kortex.app}"
DMG="${2:-}"
if [ -z "$DMG" ]; then
  DMG="$(find "$W/build" -maxdepth 1 -name 'Kortex-*.dmg' -print 2>/dev/null | sort | tail -1)"
fi

FEHLER=0
pruefe() {  # pruefe "Beschreibung" befehl...
  local text="$1"; shift
  if out="$("$@" 2>&1)"; then echo "ok      $text"; else echo "FEHLER  $text"; echo "$out" | sed 's/^/        /'; FEHLER=1; fi
}

[ -d "$APP" ] || { echo "App nicht gefunden: $APP (zuerst bauen und veröffentlichen)"; exit 1; }
echo "App: $APP"
pruefe "Signatur lückenlos (codesign --verify --deep --strict)" codesign --verify --deep --strict --verbose=2 "$APP"
pruefe "Gatekeeper akzeptiert die App (spctl)" spctl -a -vv -t exec "$APP"
pruefe "Notar-Beleg an der App geheftet (stapler)" xcrun stapler validate "$APP"

if [ -n "$DMG" ] && [ -f "$DMG" ]; then
  echo "DMG: $DMG"
  pruefe "DMG signiert" codesign --verify --strict --verbose=2 "$DMG"
  pruefe "Gatekeeper akzeptiert die DMG (spctl)" spctl -a -vv -t open --context context:primary-signature "$DMG"
  pruefe "Notar-Beleg an der DMG geheftet (stapler)" xcrun stapler validate "$DMG"
else
  echo "DMG: keine gefunden, übersprungen."
fi

echo
if [ "$FEHLER" = 0 ]; then echo "Alles in Ordnung."; else echo "Es gibt Fehler (siehe oben)."; fi
exit "$FEHLER"
