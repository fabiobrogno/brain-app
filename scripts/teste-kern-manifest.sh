#!/bin/bash
# Prüft scripts/kern-manifest.sh ohne gebaute App: erzeugt ein Mini-Paket mit Kern, prüft Manifest-Inhalt, Manipulation,
# Symlink-Verbot und das Überspringen, wenn Resources/kern fehlt.
# Aufruf: bash scripts/teste-kern-manifest.sh
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
APP="$T/Kortex.app"
RES="$APP/Contents/Resources"
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
rot() { echo "ROT: $1" >&2; exit 1; }
KM() { bash "$W/scripts/kern-manifest.sh" "$@"; }

# 1) ohne kern: überspringen, kein Manifest
mkdir -p "$RES"
KM erzeuge "$APP" >/dev/null
[ ! -e "$RES/kern-manifest.json" ] || rot "ohne kern darf kein Manifest entstehen"

# 2) mit kern: Manifest passt zum Inhalt
mkdir -p "$RES/kern/lib" "$RES/kern/mit leer"
printf 'console.log(1)\n' > "$RES/kern/brain.mjs"
printf 'export const a = 1\n' > "$RES/kern/lib/hilfe.mjs"
printf 'x\n' > "$RES/kern/mit leer/datei mit leerzeichen.txt"
KM erzeuge "$APP" >/dev/null
M="$RES/kern-manifest.json"
EXPECT="{\"schema\":1,\"dateien\":{\"brain.mjs\":\"$(sha "$RES/kern/brain.mjs")\",\"lib/hilfe.mjs\":\"$(sha "$RES/kern/lib/hilfe.mjs")\",\"mit leer/datei mit leerzeichen.txt\":\"$(sha "$RES/kern/mit leer/datei mit leerzeichen.txt")\"}}"
[ "$(cat "$M")" = "$EXPECT" ] || rot "Manifest-Inhalt falsch: $(cat "$M")"
KM pruefe "$APP" >/dev/null || rot "pruefe sollte grün sein"

# 3) Manipulation (Inhalt, zusätzliche Datei) wird erkannt
printf 'MANIPULIERT\n' > "$RES/kern/brain.mjs"
if KM pruefe "$APP" >/dev/null 2>&1; then rot "geänderte Datei nicht erkannt"; fi
KM erzeuge "$APP" >/dev/null
printf 'z\n' > "$RES/kern/extra.mjs"
if KM pruefe "$APP" >/dev/null 2>&1; then rot "zusätzliche Datei nicht erkannt"; fi
rm "$RES/kern/extra.mjs"

# 4) Symlinks im Kern sind verboten
ln -s /etc/hosts "$RES/kern/boese"
if KM erzeuge "$APP" >/dev/null 2>&1; then rot "Symlink im Kern nicht abgelehnt"; fi
rm "$RES/kern/boese"

# 5) unzulässiger Dateiname (Anführungszeichen würden das JSON brechen)
printf 'x\n' > "$RES/kern/a\"b.txt"
if KM erzeuge "$APP" >/dev/null 2>&1; then rot "Anführungszeichen im Dateinamen nicht abgelehnt"; fi

echo "grün: kern-manifest.sh"
