#!/bin/sh
# .tools/node-start.sh — startet Node OHNE festen Pfad (App-Spec §12.1 Nr. 1, Lernkreislauf §7.7) für Hooks und den
# Hintergrunddienst: $BRAIN_NODE, sonst node im PATH, sonst das private Kit-Node, sonst übliche Orte. Ein Node-Update oder ein
# neuer Rechner bricht so keine Hooks mehr. Testhaken: BRAIN_NODE_KEINE_ORTE=1 überspringt die festen Orte.
K=""
for C in "${BRAIN_NODE:-}" "$(command -v node 2>/dev/null)"; do
  if [ -z "$K" ] && [ -n "$C" ] && [ -x "$C" ]; then K="$C"; fi
done
if [ -z "$K" ] && [ "${BRAIN_NODE_KEINE_ORTE:-}" != "1" ]; then
  for C in "$HOME/.brain-kit/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -z "$K" ] && [ -x "$C" ]; then K="$C"; fi
  done
fi
if [ -z "$K" ]; then
  echo "Brain: Node wurde nicht gefunden — führe die Brain-Einrichtung erneut aus." >&2
  exit 127
fi
exec "$K" "$@"
