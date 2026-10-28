#!/bin/bash
# .tools/tests/unit.sh — die Node-Unit-Suite mit dem Aufräum-Setup (setup.mjs): `node --test --import setup.mjs <Dateien>`.
# Ohne Argumente laufen alle test-*.mjs, sonst genau die genannten Dateien (Entwickeln: bash .tools/tests/unit.sh .tools/tests/test-x.mjs).
# Das Setup löscht alle Temp-Ordner, die ein Test per mkdtemp anlegt, beim Prozessende, und setzt QMD_BIN auf den Fake
# (kein echtes qmd, kein Modell-Download). Ein nackter `node --test` hinterlässt dagegen Temp-Reste.
# --import verlangt eine URL (Windows: C:\… ist keine) — node baut sie, auch mit Leerzeichen/Umlauten im Pfad.
D="$(cd "$(dirname "$0")" && pwd)"
. "$D/stage.sh" "$@"   # Kern-Wurzel (KORTEX_KERN): baut bei Bedarf die Bühne und läuft dort weiter (siehe stage.sh)
S="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$D/setup.mjs")" || exit 1
[ "$#" -gt 0 ] || set -- "$D"/test-*.mjs
exec node --test --import "$S" "$@"
