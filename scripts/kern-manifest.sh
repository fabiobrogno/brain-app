#!/bin/bash
# Prüfsummen des Kerns im App-Paket (Contents/Resources/kern-manifest.json) – Gegenstück zu scripts/node-manifest.sh.
#
#   bash scripts/kern-manifest.sh erzeuge <Kortex.app>   schreibt kern-manifest.json: SHA-256 jeder Datei unter Resources/kern
#   bash scripts/kern-manifest.sh pruefe  <Kortex.app>   prüft, dass das Manifest zum Inhalt von Resources/kern passt
#
# Warum: Die App kopiert den Kern beim Start nach Application Support/Kortex/kern/<Version>/ und prüft jede Datei
# gegen dieses Manifest (Sources/BrainCore/Laufzeit.swift). Das Manifest liegt NEBEN dem Ordner kern (nicht darin),
# damit es nicht in sich selbst eingeht. Es entsteht beim Bauen, nach dem Kopieren der Ressourcen und vor dem Signieren
# der App (die Signatur versiegelt es mit). Fehlt Resources/kern, tut das Skript nichts (Exit 0, Hinweis).
# Format: {"schema":1,"dateien":{"brain.mjs":"<sha256>","lib/x.mjs":"<sha256>"}}, Pfade aufsteigend sortiert.
# Symlinks und andere Nicht-Dateien im Kern sind verboten (die App lehnt sie ebenfalls ab).
set -euo pipefail
MODUS="${1:-}"; APP="${2:-}"
[ -n "$MODUS" ] && [ -d "$APP" ] || { sed -n '2,6p' "$0" >&2; exit 2; }
RES="$APP/Contents/Resources"
KERN="$RES/kern"; MANIFEST="$RES/kern-manifest.json"
if [ ! -d "$KERN" ]; then echo "  kern: Resources/kern fehlt im Paket – kein Manifest nötig."; exit 0; fi

# Alles außer Dateien und Ordnern (Symlinks, Geräte …) ablehnen
ANDERE="$(find "$KERN" ! -type f ! -type d | head -n 1)"
[ -z "$ANDERE" ] || { echo "Abbruch: Im Kern liegt etwas, das keine Datei und kein Ordner ist: $ANDERE" >&2; exit 1; }

erzeuge_json() {
  local erste=1 rel sha
  printf '{"schema":1,"dateien":{'
  while IFS= read -r rel; do
    rel="${rel#./}"
    # JSON ohne Maskierung: nur unkritische Zeichen im Dateinamen zulassen
    [[ "$rel" =~ ^[A-Za-z0-9._/@+\ -]+$ ]] || { echo "Abbruch: Dateiname im Kern nicht zulässig: $rel" >&2; return 1; }
    sha="$(shasum -a 256 "$KERN/$rel" | cut -d' ' -f1)"
    [ "$erste" = 1 ] || printf ','
    erste=0
    printf '"%s":"%s"' "$rel" "$sha"
  done < <(cd "$KERN" && LC_ALL=C find . -type f | LC_ALL=C sort)
  printf '}}\n'
}

case "$MODUS" in
  erzeuge)
    NEU="$(erzeuge_json)"
    case "$NEU" in *'"dateien":{}'*) echo "Abbruch: Resources/kern enthält keine Dateien." >&2; exit 1 ;; esac
    printf '%s\n' "$NEU" > "$MANIFEST"
    echo "  ok: kern-manifest.json geschrieben ($(grep -o '":"' "$MANIFEST" | wc -l | tr -d ' ') Dateien)"
    ;;
  pruefe)
    [ -f "$MANIFEST" ] || { echo "FEHLT: $MANIFEST" >&2; exit 1; }
    SOLL="$(erzeuge_json)"
    [ "$SOLL" = "$(cat "$MANIFEST")" ] || { echo "Abbruch: kern-manifest.json passt nicht zu Resources/kern." >&2; exit 1; }
    echo "  ok: kern-manifest.json passt zu Resources/kern"
    ;;
  *) echo "Unbekannter Modus: $MODUS" >&2; exit 2 ;;
esac
