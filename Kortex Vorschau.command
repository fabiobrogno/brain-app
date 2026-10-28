#!/bin/bash
# Doppelklick im Finder: Kortex so ansehen, wie es jemand sieht, der es frisch installiert hat — ohne dass auf diesem Mac etwas
# bleibt. Alles Weitere steht in scripts/vorschau.sh (Schalter: --ohne-git, --mit-ki).
cd "$(dirname "$0")" || exit 1
bash scripts/vorschau.sh "$@"
status=$?
echo
echo "Die Vorschau ist beendet und aufgeräumt. Dieses Fenster kannst du schließen."
exit "$status"
