#!/bin/sh
# Führt alle Node-Tests von Brain Studio aus (node:test, nur Bordmittel). Aufruf: scripts/teste-node.sh [node-Optionen]
set -eu
cd "$(dirname "$0")/.."
exec node --test --test-timeout=60000 "$@" Tests/Node/*.test.mjs
