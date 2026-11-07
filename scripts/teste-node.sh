#!/bin/sh
# Führt alle Node-Tests von Brain Studio aus (node:test, nur Bordmittel). Aufruf: scripts/teste-node.sh [node-Optionen]
set -eu
cd "$(dirname "$0")/.."
# Windows (Git Bash, Plattform-Probe): Laufwerkspfade in import() brauchen einen Haken (Tests/Node/windows-importe.mjs). Sonst nichts ändern.
ZEIT=60000
# Windows: Prozessstart (git, node) ist dort ein Vielfaches langsamer; gemessen brauchen v2-git, konflikt-werkstatt und nichts-geht-verloren allein 70–80 s (viele hundert
# Aufrufe von git, merge3-Fuzz gegen `git merge-file`) und rissen das Zeitlimit von 60 s je Datei. Hängende Tests werden dort nach 4 Minuten abgebrochen.
if [ "${OS:-}" = "Windows_NT" ]; then set -- --import ./Tests/Node/windows-importe.mjs "$@"; ZEIT=240000; fi
exec node --test --test-timeout="$ZEIT" "$@" Tests/Node/*.test.mjs
