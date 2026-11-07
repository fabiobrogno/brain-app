#!/bin/bash
# Test für scripts/ci-aenderungen.sh (Pfadfilter der CI). Aufruf: bash scripts/teste-ci-aenderungen.sh
set -u
W="$(cd "$(dirname "$0")/.." && pwd)"
FEHLER=0
# erwartet <Dateien, durch Komma getrennt> <swift kern node ui vorab paket als t/f-Folge>
pruefe() {
  local ist
  ist="$(printf '%s\n' ${1//,/ } | bash "$W/scripts/ci-aenderungen.sh" --stdin | sed 's/.*=true/t/; s/.*=false/f/' | tr -d '\n')"
  if [ "$ist" = "$2" ]; then echo "  ok   $1 -> $2"; else echo "  FAIL $1: erwartet $2, ist $ist"; FEHLER=1; fi
}
#                                         swift kern node ui vorab paket
pruefe "docs/a.md"                          ffffff
pruefe "README.md,LICENSE,docs/x/y.png"     ffffff
pruefe "Tests/Kern/test-x.mjs"              ftfftf
pruefe "Ressourcen/kern/skills/a.md"        ftfftt
pruefe "Ressourcen/studio/app.js"           fftttt
pruefe "Ressourcen/werkstatt/handler.mjs"   tftttt
pruefe "Ressourcen/gemeinsam/basis.mjs"     tftttt
pruefe "Ressourcen/mcp/brain-mcp.mjs"       fftftt
pruefe "Sources/BrainCore/Laufzeit.swift"   tffftf
pruefe "Tests/BrainCoreTests/A.swift"       tffftf
pruefe "Tests/Node/v2-api.test.mjs"         fftftf
pruefe "electron/haupt.mjs"                 fftftt
pruefe "electron/package-lock.json"         fftftt
pruefe "Tests/Oberflaeche/v2.spec.mjs"      fffttf
pruefe "scripts/vorschau-electron.sh"       fftftf
pruefe "scripts/baue-app.sh"                tffftf
pruefe "scripts/ci-aenderungen.sh"            tttttt
pruefe "scripts/erzeuge-symbole.mjs"         fftttf
pruefe "THIRD-PARTY-NOTICES.md"             fftftt
pruefe "Ressourcen/AppIcon.icns"            tffftt
pruefe "Ressourcen/icon-entwuerfe/x.svg"    fftftt
pruefe "Ressourcen/AppSymbole/papier.icns"  tftftt
pruefe "scripts/erzeuge-app-symbole.mjs"     fftftf
pruefe "Package.swift"                      tffftf
pruefe ".github/workflows/ci.yml"           tttttt
pruefe "neuer-ordner/datei.txt"             tttttt
pruefe "docs/a.md,Tests/Kern/x.mjs"         ftfftf
pruefe "scripts/node-version.txt"           ftfftt
# --alle und ein nicht auflösbarer Vergleichsstand schalten alles ein
ist="$(bash "$W/scripts/ci-aenderungen.sh" --alle | sed 's/.*=true/t/; s/.*=false/f/' | tr -d '\n')"
if [ "$ist" = "tttttt" ]; then echo "  ok   --alle"; else echo "  FAIL --alle: $ist"; FEHLER=1; fi
exit $FEHLER
