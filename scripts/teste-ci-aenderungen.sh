#!/bin/bash
# Test für scripts/ci-aenderungen.sh (Pfadfilter der CI). Aufruf: bash scripts/teste-ci-aenderungen.sh
set -u
W="$(cd "$(dirname "$0")/.." && pwd)"
FEHLER=0
# erwartet <Dateien, durch Komma getrennt> <swift kern node ui vorab als t/f-Folge>
pruefe() {
  local ist
  ist="$(printf '%s\n' ${1//,/ } | bash "$W/scripts/ci-aenderungen.sh" --stdin | sed 's/.*=true/t/; s/.*=false/f/' | tr -d '\n')"
  if [ "$ist" = "$2" ]; then echo "  ok   $1 -> $2"; else echo "  FAIL $1: erwartet $2, ist $ist"; FEHLER=1; fi
}
#                                         swift kern node ui vorab
pruefe "docs/a.md"                          fffff
pruefe "README.md,LICENSE,docs/x/y.png"     fffff
pruefe "Tests/Kern/test-x.mjs"              ftfft
pruefe "Ressourcen/kern/skills/a.md"        ftfft
pruefe "Ressourcen/studio/app.js"           ffttt
pruefe "Ressourcen/werkstatt/handler.mjs"   tfttt
pruefe "Ressourcen/gemeinsam/basis.mjs"     tfttt
pruefe "Ressourcen/mcp/brain-mcp.mjs"       fftft
pruefe "Sources/BrainCore/Laufzeit.swift"   tffft
pruefe "Tests/BrainCoreTests/A.swift"       tffft
pruefe "Tests/Node/v2-api.test.mjs"         fftft
pruefe "Tests/Oberflaeche/v2.spec.mjs"      ffftt
pruefe "scripts/baue-app.sh"                tffft
pruefe "scripts/ci-aenderungen.sh"            ttttt
pruefe "Ressourcen/AppIcon.icns"            tffft
pruefe "Ressourcen/icon-entwuerfe/x.svg"    fffff
pruefe "Package.swift"                      tffft
pruefe ".github/workflows/ci.yml"           ttttt
pruefe "neuer-ordner/datei.txt"             ttttt
pruefe "docs/a.md,Tests/Kern/x.mjs"         ftfft
# --alle und ein nicht auflösbarer Vergleichsstand schalten alles ein
ist="$(bash "$W/scripts/ci-aenderungen.sh" --alle | sed 's/.*=true/t/; s/.*=false/f/' | tr -d '\n')"
if [ "$ist" = "ttttt" ]; then echo "  ok   --alle"; else echo "  FAIL --alle: $ist"; FEHLER=1; fi
exit $FEHLER
