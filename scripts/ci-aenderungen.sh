#!/bin/bash
# Änderungserkennung für die CI (.github/workflows/ci.yml, Job „aenderungen“): welche Prüfbereiche muss ein Stand durchlaufen?
#
# Aufruf:
#   scripts/ci-aenderungen.sh <von> <bis>   Dateien aus `git diff --name-only <von> <bis>`
#   scripts/ci-aenderungen.sh --stdin       Dateiliste (eine je Zeile) von stdin, z. B. zum Ausprobieren:
#                                           printf 'docs/x.md\n' | bash scripts/ci-aenderungen.sh --stdin
#   scripts/ci-aenderungen.sh --alle        alles ausführen (kein Vergleichsstand bekannt)
# Ausgabe (stdout, GITHUB_OUTPUT-Format): swift=…  kern=…  node=…  ui=…  vorab=…  (true/false)
#
# Grundsatz „im Zweifel prüfen“: Eine Datei, die hier nicht ausdrücklich einem Bereich oder der Ignorierliste zugeordnet ist
# (neue Ordner, .github/**, Package.*, …), schaltet ALLE Bereiche ein. Nur Doku und Lizenz schalten nichts ein.
# Abhängigkeiten zwischen den Bereichen (geprüft per grep, Stand Kern-Umbau):
#   Swift-Tests starten Ressourcen/werkstatt/werkstatt.mjs (das importiert ../gemeinsam)  -> werkstatt + gemeinsam gehören zu swift
#   Node-Tests und Playwright nutzen werkstatt + gemeinsam + studio (+ mcp bei Node)
#   Kern ist in sich geschlossen (importiert nichts aus gemeinsam/werkstatt/studio)
set -u

swift=false; kern=false; node=false; ui=false
alle() { swift=true; kern=true; node=true; ui=true; }

dateien() {
  case "${1:-}" in
    --alle) echo "?"; ;;
    --stdin) cat ;;
    *) [ "$#" -eq 2 ] || { echo "Aufruf: $0 <von> <bis> | --stdin | --alle" >&2; exit 2; }
       git diff --name-only "$1" "$2" || echo "?" ;;   # Diff nicht möglich (z. B. Vorgänger fehlt) -> alles prüfen
  esac
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    Sources/*|Tests/BrainCoreTests/*|Package.swift|Package.resolved) swift=true ;;
    Ressourcen/Info.plist|Ressourcen/node.entitlements) swift=true ;;
    Ressourcen/kern/*|Tests/Kern/*|scripts/node-version.txt) kern=true ;;       # auch deren .md (Skills, Fixtures) sind Testgegenstand
    Ressourcen/gemeinsam/*|Ressourcen/werkstatt/*) swift=true; node=true; ui=true ;;
    Ressourcen/studio/*) node=true; ui=true ;;
    Ressourcen/mcp/*) node=true ;;
    Tests/Node/*|scripts/teste-node.sh) node=true ;;
    Tests/Oberflaeche/*|Werkzeuge/editor-bundle/*) ui=true ;;
    Tests/Aktionskanal/*) ;;                                                     # nur vom Rauchtest (rauchtest.yml) genutzt
    scripts/ci-aenderungen.sh|scripts/teste-ci-aenderungen.sh) alle ;;           # der Filter selbst
    scripts/*) swift=true ;;                                                     # Bau-/Prüfskripte laufen im macOS-Job (Kern-Manifest, Vorschau)
    docs/*|*.md|LICENSE) ;;                                                      # Doku: nichts
    *) alle ;;                                                                   # unbekannt (.github/**, neue Ordner, "?") -> alles
  esac
done < <(dateien "$@")

# Vorprüfung (shellcheck, Syntax, JSON) ist billig (< 1 min) und läuft, sobald irgendetwas außer Doku geändert ist.
vorab=false
if $swift || $kern || $node || $ui; then vorab=true; fi

echo "swift=$swift"
echo "kern=$kern"
echo "node=$node"
echo "ui=$ui"
echo "vorab=$vorab"
