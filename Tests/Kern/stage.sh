#!/bin/bash
# Tests/Kern/stage.sh — gemeinsames Test-Setup: legt die zentrale Kern-Wurzel fest (KORTEX_KERN). Wird von run-all.sh und unit.sh gesourct.
#
# Hintergrund: Im Repo liegt der Code unter Ressourcen/kern/, die Tests unter Tests/Kern/. Die ~200 übernommenen Testdateien
# rechnen aber mit dem alten Layout, in dem der Ordner „tests“ IM Kern liegt (tests/.. = Kern). Statt jede Stelle einzeln
# umzuschreiben, baut dieses Skript eine Bühne (temporäre Kopie):
#     <Bühne>/            = Ressourcen/kern/
#     <Bühne>/tests/      = Tests/Kern/
# und führt das aufrufende Skript dort aus. KORTEX_KERN zeigt auf die Bühne (= Kern-Wurzel) und ist für Tests und Kern-Code
# gesetzt. Die Bühne wird am Ende gelöscht; der Arbeitsbaum bleibt unberührt.
#
# Rückfall: Liegt brain.mjs schon neben dem Testordner (altes Layout, z. B. wenn Tests/Kern in eine Bühne kopiert wurde),
# wird nichts kopiert; KORTEX_KERN ist dann der Elternordner. Ein von außen gesetztes KORTEX_KERN_QUELLE (Ordner mit dem
# Kern-Code) ersetzt den Standardpfad Ressourcen/kern.
#
# Aufruf in der ersten Zeile des Aufrufers:  D="$(cd "$(dirname "$0")" && pwd)"; . "$D/stage.sh" "$@"
# Kehrt nur zurück, wenn der Aufrufer schon in der Bühne bzw. im alten Layout läuft; sonst läuft er in der Bühne und
# stage.sh beendet den Aufrufer mit dessen Exit-Code.

_kern_hier="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$_kern_hier/../brain.mjs" ]; then
  KORTEX_KERN="$(cd "$_kern_hier/.." && pwd)"
  export KORTEX_KERN
else
  _kern_quelle="${KORTEX_KERN_QUELLE:-$_kern_hier/../../Ressourcen/kern}"
  [ -f "$_kern_quelle/brain.mjs" ] || { echo "stage.sh: Kern-Code nicht gefunden: $_kern_quelle" >&2; exit 2; }
  _kern_buehne="$(mktemp -d "${TMPDIR:-/tmp}/kortex-kern.XXXXXX")" || exit 2
  trap 'rm -rf "$_kern_buehne"' EXIT
  cp -Rp "$_kern_quelle/." "$_kern_buehne/" || exit 2
  mkdir -p "$_kern_buehne/tests" && cp -Rp "$_kern_hier/." "$_kern_buehne/tests/" || exit 2
  # Platzhalter-Fragen für Messlatte/Karten-Tor/Lint (der Kern liest tests/hint-eval.json; echte Fragen gehören nie ins Repo).
  cp "$_kern_buehne/kit/vorlage-eval.json" "$_kern_buehne/tests/hint-eval.json" || exit 2
  export KORTEX_KERN="$_kern_buehne"
  # Dateiargumente (Tests/Kern/test-x.mjs) auf die Bühne umlenken; alles andere bleibt, wie es ist.
  _kern_args=()
  for _a in "$@"; do
    if [ -f "$_a" ] && [ -f "$_kern_buehne/tests/$(basename "$_a")" ]; then _kern_args+=("$_kern_buehne/tests/$(basename "$_a")"); else _kern_args+=("$_a"); fi
  done
  bash "$_kern_buehne/tests/$(basename "$0")" ${_kern_args[@]+"${_kern_args[@]}"}
  exit $?
fi
