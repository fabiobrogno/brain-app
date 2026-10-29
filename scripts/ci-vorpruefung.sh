#!/bin/bash
# Schnelle Vorprüfung der CI (Job „vorpruefung“, läuft in unter einer Minute auf Linux, auch lokal nutzbar):
#   1. shellcheck über scripts/*.sh und die Kern-Test-Läufer (Tests/Kern/stage.sh, run-all.sh, unit.sh)
#   2. Syntaxprüfung (node --check) aller .mjs/.js unter Ressourcen/, Tests/ (ohne vendor, node_modules, Testdaten-Ordner)
#   3. Gültiges JSON in allen .json (ohne node_modules, Testdaten-Ordner)
#   4. Lint-Test „keine Altpfade“ im Kern (kostet Sekunden, findet Rückfälle auf ~/brain früh)
#   5. Lint-Test „sichtbare Begriffe“ (Tests/Node/sichtbare-begriffe.test.mjs): kein sichtbares „Brain“ in Texten, die App heißt Kortex, der Datenordner Vault
# Aufruf: bash scripts/ci-vorpruefung.sh   (Exit ≠ 0, sobald etwas rot ist; alle Funde werden gesammelt)
set -u
cd "$(dirname "$0")/.." || exit 2
FEHLER=0
rot() { echo "ROT: $*" >&2; FEHLER=1; }

echo "== shellcheck"
# Wie bisher: scripts/*.sh und die Tests/Kern-Läufer (die übernommenen test-*.sh dort sind nicht shellcheck-sauber).
shellcheck -S warning scripts/*.sh Tests/Kern/stage.sh Tests/Kern/run-all.sh Tests/Kern/unit.sh || rot "shellcheck"

echo "== Syntax (node --check)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
n=0
while IFS= read -r f; do
  n=$((n + 1))
  case "$f" in
    *.mjs) node --check "$f" 2>"$T/err" || { cat "$T/err" >&2; rot "Syntax: $f"; } ;;
    *)     # .js: Browser-Skripte, teils ES-Module -> als .mjs prüfen (Kopie, das Original bleibt unberührt)
           cp "$f" "$T/pruef.mjs"; node --check "$T/pruef.mjs" 2>"$T/err" || { cat "$T/err" >&2; rot "Syntax: $f"; } ;;
  esac
done < <(find Ressourcen Tests scripts Werkzeuge -type f \( -name '*.mjs' -o -name '*.js' \) \
           -not -path '*/node_modules/*' -not -path '*/vendor/*' -not -path 'Tests/Kern/fixture*' -not -path 'Werkzeuge/editor-bundle/*' | sort)
echo "$n Dateien geprüft"

echo "== JSON"
n=0
while IFS= read -r f; do
  n=$((n + 1))
  node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$f" 2>"$T/err" || { cat "$T/err" >&2; rot "JSON ungültig: $f"; }
done < <(find . -type f -name '*.json' -not -path '*/node_modules/*' -not -path './.git/*' -not -path './.build/*' -not -path './.claude/*' \
           -not -path './Tests/Kern/fixture*' -not -path './docs/*' | sort)
echo "$n Dateien geprüft"

echo "== Lint: keine Altpfade im Kern"
bash Tests/Kern/unit.sh Tests/Kern/test-keine-altpfade.mjs >"$T/lint" 2>&1 || { tail -n 40 "$T/lint" >&2; rot "test-keine-altpfade"; }

echo "== Lint: sichtbare Begriffe (Kortex / Vault statt Brain)"
node --test Tests/Node/sichtbare-begriffe.test.mjs >"$T/begriffe" 2>&1 || { grep -E '^\s+(Sources|Ressourcen|README)' "$T/begriffe" | head -n 40 >&2; rot "sichtbare-begriffe"; }

[ "$FEHLER" -eq 0 ] && echo "Vorprüfung grün." || echo "Vorprüfung ROT." >&2
exit "$FEHLER"
