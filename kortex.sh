#!/bin/sh
# Kortex im Browser (Vorschau für Linux; am Mac zum Testen): startet den lokalen Dienst und öffnet den Standardbrowser.
# Aufruf: ./kortex.sh [--vault <Ordner>] [--nicht-oeffnen] [--beenden]. Braucht Node.js 22 oder neuer (https://nodejs.org).
dir=$(cd "$(dirname "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Installiere Node.js 22 oder neuer (https://nodejs.org) und starte Kortex noch einmal." >&2
  exit 1
fi
exec node "$dir/Ressourcen/werkstatt/start.mjs" "$@"
