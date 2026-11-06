#!/bin/sh
# Führt alle Node-Tests von Brain Studio aus (node:test, nur Bordmittel). Aufruf: scripts/teste-node.sh [node-Optionen]
set -eu
cd "$(dirname "$0")/.."
# Windows (Git Bash, Plattform-Probe): Laufwerkspfade in import() brauchen einen Haken (Tests/Node/windows-importe.mjs). Sonst nichts ändern.
if [ "${OS:-}" = "Windows_NT" ]; then set -- --import ./Tests/Node/windows-importe.mjs "$@"; fi
exec node --test --test-timeout=60000 "$@" Tests/Node/*.test.mjs
