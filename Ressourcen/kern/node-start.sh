#!/bin/sh
# node-start.sh — startet Node OHNE festen Pfad (App-Spec §12.1 Nr. 1, Lernkreislauf §7.7) für Hooks und den
# Hintergrunddienst: $BRAIN_NODE, sonst node im PATH, sonst das private Node der App bzw. des alten Kits, sonst übliche Orte. Ein Node-Update oder ein
# neuer Rechner bricht so keine Hooks mehr. Testhaken: BRAIN_NODE_KEINE_ORTE=1 überspringt die festen Orte.
K=""
for C in "${BRAIN_NODE:-}" "$(command -v node 2>/dev/null)"; do
  if [ -z "$K" ] && [ -n "$C" ] && [ -x "$C" ]; then K="$C"; fi
done
if [ -z "$K" ] && [ "${BRAIN_NODE_KEINE_ORTE:-}" != "1" ]; then
  # Reihenfolge: Support-Ordner der App (Kortex, alter Name Brain; BRAIN_APP_SUPPORT lenkt um), alter Kit-Ort, übliche Orte.
  S="${BRAIN_APP_SUPPORT:-$HOME/Library/Application Support/Kortex}"
  for C in "$S/bin/node" "$HOME/Library/Application Support/Brain/bin/node" "$HOME/.brain-kit/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -z "$K" ] && [ -x "$C" ]; then K="$C"; fi
  done
fi
if [ -z "$K" ]; then
  echo "Kortex: Node wurde nicht gefunden — öffne die Kortex-App und führe die Einrichtung erneut aus." >&2
  exit 127
fi
exec "$K" "$@"
