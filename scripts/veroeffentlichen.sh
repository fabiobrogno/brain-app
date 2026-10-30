#!/bin/bash
# Veröffentlicht build/Kortex.app: Developer-ID-Signatur (Hardened Runtime), Notarisierung, DMG, Sparkle-Appcast.
#
# Aufruf:   bash scripts/veroeffentlichen.sh [--trocken] [--app <Pfad zu Kortex.app>]
# Vorher:   bash scripts/baue-app.sh
#
# Umgebungsvariablen (keine Geheimnisse im Skript; Kennwörter liegen im Schlüsselbund):
#   BRAIN_SIGNIER_ID    Name des Zertifikats, z. B. "Developer ID Application: Vorname Name (TEAMID)"
#   BRAIN_NOTAR_PROFIL  Name des mit `xcrun notarytool store-credentials` angelegten Schlüsselbund-Profils
#   BRAIN_NOTAR_KEY_PFAD, BRAIN_NOTAR_KEY_ID, BRAIN_NOTAR_ISSUER   CI-Variante statt BRAIN_NOTAR_PROFIL:
#                       App-Store-Connect-API-Schlüssel (.p8-Datei, Key-ID, Issuer-ID) für notarytool
#   SPARKLE_ED_KEY_DATEI  optional (CI): Datei mit dem privaten Sparkle-EdDSA-Schlüssel; sonst liest sign_update den Schlüsselbund
#   SPARKLE_BIN         Ordner mit Sparkles Werkzeugen (darin sign_update)
#   BRAIN_GITHUB_REPO   "konto/repo" des öffentlichen Repos, auf dem die Releases liegen
#
# --trocken: prüft nur und zeigt, was passieren würde. Signiert, notarisiert und schreibt nichts.
set -euo pipefail

W="$(cd "$(dirname "$0")/.." && pwd)"
cd "$W"

TROCKEN=0
APP="$W/build/Kortex.app"
while [ $# -gt 0 ]; do
  case "$1" in
    --trocken) TROCKEN=1 ;;
    --app) shift; APP="${1:?--app braucht einen Pfad}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
  shift
done

FEHLER=0
fehlt() { echo "  FEHLT: $1" >&2; FEHLER=1; }
ok() { echo "  ok: $1"; }
schritt() { echo; echo "== $1"; }
tun() {  # führt aus oder zeigt nur an
  if [ "$TROCKEN" = 1 ]; then echo "  würde ausführen: $*"; else "$@"; fi
}

ENTITLEMENTS="$W/Ressourcen/node.entitlements"
SIGNIER_ID="${BRAIN_SIGNIER_ID:-}"
PROFIL="${BRAIN_NOTAR_PROFIL:-}"
NOTAR_KEY="${BRAIN_NOTAR_KEY_PFAD:-}"
NOTAR_KEY_ID="${BRAIN_NOTAR_KEY_ID:-}"
NOTAR_ISSUER="${BRAIN_NOTAR_ISSUER:-}"
SPARKLE_KEY_DATEI="${SPARKLE_ED_KEY_DATEI:-}"
SPARKLE_BIN="${SPARKLE_BIN:-}"
REPO="${BRAIN_GITHUB_REPO:-}"

echo "Kortex veröffentlichen$([ "$TROCKEN" = 1 ] && echo ' (TROCKENLAUF, es wird nichts verändert)')"

# ---------- Vorher-Prüfungen ----------
schritt "Prüfe Voraussetzungen"

if [ -d "$APP" ]; then ok "App gefunden: $APP"; else
  fehlt "Die App ist noch nicht gebaut ($APP). Zuerst ausführen: bash scripts/baue-app.sh"
fi

VERSION=""; BUILD=""
if [ -f "$APP/Contents/Info.plist" ]; then
  VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  [ -n "$VERSION" ] && ok "Version $VERSION (Build $BUILD)" || fehlt "In der App steht keine Versionsnummer (CFBundleShortVersionString)."
fi

if [ -d "$APP" ]; then
  if [ -f "$APP/Contents/Resources/AppIcon.icns" ]; then ok "App-Icon im Paket"; else
    fehlt "Im Paket fehlt Contents/Resources/AppIcon.icns. Neu bauen: bash scripts/baue-app.sh"
  fi
fi

if [ -f "$ENTITLEMENTS" ]; then ok "Rechte-Datei für Node: Ressourcen/node.entitlements"; else
  fehlt "Die Datei Ressourcen/node.entitlements fehlt."
fi

for w in codesign hdiutil xcrun ditto security /usr/libexec/PlistBuddy; do
  if command -v "$w" >/dev/null 2>&1 || [ -x "$w" ]; then :; else fehlt "Das macOS-Werkzeug '$w' ist nicht da (Xcode-Kommandozeilentools installieren: xcode-select --install)."; fi
done
xcrun --find notarytool >/dev/null 2>&1 && ok "notarytool vorhanden" || fehlt "notarytool fehlt. Xcode (ab Version 13) installieren."
xcrun --find stapler >/dev/null 2>&1 && ok "stapler vorhanden" || fehlt "stapler fehlt. Xcode installieren."

if [ -z "$SIGNIER_ID" ]; then
  fehlt "BRAIN_SIGNIER_ID ist nicht gesetzt. Es ist der Name deines Zertifikats \"Developer ID Application\" (siehe docs/veroeffentlichen.md, Schritt 2)."
else
  case "$SIGNIER_ID" in
    "Developer ID Application:"*) ;;
    *) fehlt "BRAIN_SIGNIER_ID muss mit \"Developer ID Application:\" beginnen. Ein \"Apple Development\"-Zertifikat reicht für die Veröffentlichung nicht." ;;
  esac
  if security find-identity -v -p codesigning 2>/dev/null | grep -qF "\"$SIGNIER_ID\""; then
    ok "Zertifikat im Schlüsselbund gefunden"
  else
    fehlt "Das Zertifikat \"$SIGNIER_ID\" ist nicht im Schlüsselbund (oder abgelaufen). Prüfen mit: security find-identity -v -p codesigning"
  fi
fi

# Notar-Zugang: CI-Variante (API-Schlüssel) hat Vorrang, sonst Schlüsselbund-Profil
NOTAR_ARGS=()
if [ -n "$NOTAR_KEY" ] || [ -n "$NOTAR_KEY_ID" ] || [ -n "$NOTAR_ISSUER" ]; then
  [ -n "$NOTAR_KEY" ] && [ -f "$NOTAR_KEY" ] || fehlt "BRAIN_NOTAR_KEY_PFAD fehlt oder zeigt auf keine Datei (App-Store-Connect-Schlüssel .p8)."
  [ -n "$NOTAR_KEY_ID" ] || fehlt "BRAIN_NOTAR_KEY_ID ist nicht gesetzt (Key-ID des App-Store-Connect-Schlüssels)."
  [ -n "$NOTAR_ISSUER" ] || fehlt "BRAIN_NOTAR_ISSUER ist nicht gesetzt (Issuer-ID aus App Store Connect)."
  NOTAR_ARGS=(--key "$NOTAR_KEY" --key-id "$NOTAR_KEY_ID" --issuer "$NOTAR_ISSUER")
  ok "Notar-Zugang per API-Schlüssel (Key-ID $NOTAR_KEY_ID)"
elif [ -z "$PROFIL" ]; then
  fehlt "BRAIN_NOTAR_PROFIL ist nicht gesetzt. Es ist der Name, den du bei 'xcrun notarytool store-credentials' vergeben hast (Schritt 3)."
else
  NOTAR_ARGS=(--keychain-profile "$PROFIL")
  if [ "$TROCKEN" = 1 ]; then
    echo "  hinweis: Das Profil '$PROFIL' wird beim echten Lauf von Apple geprüft (eine lesende Abfrage)."
    if xcrun notarytool history "${NOTAR_ARGS[@]}" >/dev/null 2>&1; then ok "Notar-Profil '$PROFIL' funktioniert"; else
      fehlt "Das Notar-Profil '$PROFIL' wurde nicht gefunden oder Apple lehnt die Anmeldung ab (oder es gibt kein Netz). Neu anlegen: xcrun notarytool store-credentials $PROFIL"
    fi
  else
    ok "Notar-Profil '$PROFIL' wird beim Einreichen geprüft"
  fi
fi
if [ "${#NOTAR_ARGS[@]}" -gt 0 ] && [ -n "$NOTAR_KEY" ] && [ "$TROCKEN" = 1 ]; then
  if xcrun notarytool history "${NOTAR_ARGS[@]}" >/dev/null 2>&1; then ok "Apple akzeptiert den API-Schlüssel"; else
    fehlt "Apple lehnt den API-Schlüssel ab (Key-ID/Issuer-ID/Schlüssel passen nicht zusammen, oder es gibt kein Netz)."
  fi
fi

if [ -z "$SPARKLE_BIN" ]; then
  fehlt "SPARKLE_BIN ist nicht gesetzt. Es ist der Ordner mit Sparkles Werkzeugen (darin sign_update), siehe Schritt 4."
elif [ -x "$SPARKLE_BIN/sign_update" ]; then ok "Sparkle sign_update gefunden"; else
  fehlt "In SPARKLE_BIN ($SPARKLE_BIN) liegt kein ausführbares sign_update."
fi
SIGN_UPDATE_ARGS=()
if [ -n "$SPARKLE_KEY_DATEI" ]; then
  if [ -f "$SPARKLE_KEY_DATEI" ]; then SIGN_UPDATE_ARGS=(--ed-key-file "$SPARKLE_KEY_DATEI"); ok "Sparkle-Schlüssel aus Datei"; else
    fehlt "SPARKLE_ED_KEY_DATEI zeigt auf keine Datei."
  fi
fi

if [ -z "$REPO" ]; then
  fehlt "BRAIN_GITHUB_REPO ist nicht gesetzt (Form: konto/repo des öffentlichen Repos, z. B. meinkonto/brain)."
fi

if [ -d "$APP/Contents/Frameworks/Sparkle.framework" ] || grep -q 'SUPublicEDKey' "$APP/Contents/Info.plist" 2>/dev/null; then
  ok "Sparkle ist in der App eingebaut"
else
  echo "  hinweis: Sparkle ist in dieser App noch nicht eingebaut (kein SUPublicEDKey). Die DMG wird erzeugt, aber die App sucht noch keine Updates."
fi

if [ "$FEHLER" != 0 ]; then
  echo
  echo "Abbruch: Es fehlt noch etwas (siehe FEHLT oben)."
  [ "$TROCKEN" = 1 ] && echo "(Im Trockenlauf ist das normal, solange die Einrichtung aus docs/veroeffentlichen.md nicht fertig ist.)"
  exit 1
fi

DMG_NAME="Kortex-$VERSION.dmg"
DMG="$W/build/$DMG_NAME"
APPCAST="$W/build/appcast.xml"
ZIP="$W/build/Kortex-notar.zip"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/v$VERSION/$DMG_NAME"

# ---------- 1. Signieren, von innen nach außen ----------
schritt "1/6 Signieren (Developer ID, Hardened Runtime, Zeitstempel)"
SIGN=(codesign --force --timestamp --options runtime --sign "$SIGNIER_ID")

# 0) Original-Node gegen nodejs.org prüfen, solange es noch unsigniert ist (danach ändert die Signatur die Bytes)
if [ "$TROCKEN" = 1 ]; then echo "  würde ausführen: bash scripts/node-manifest.sh pruefe-original $APP"; else bash "$W/scripts/node-manifest.sh" pruefe-original "$APP"; fi

# a) einzelne Programmdateien (Mach-O), tiefste Pfade zuerst. Node bekommt seine Rechte (siehe node.entitlements).
MACHO_LISTE="$(mktemp)"
trap 'rm -f "$MACHO_LISTE"' EXIT
find "$APP/Contents" -type f ! -path "$APP/Contents/MacOS/*" -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      if file -b "$f" | grep -q 'Mach-O'; then printf '%s\n' "$f"; fi
    done \
  | awk -F/ '{print NF "\t" $0}' | sort -rn | cut -f2- > "$MACHO_LISTE"
while IFS= read -r f; do
  case "$f" in
    */node-runtime/bin/node) tun "${SIGN[@]}" --entitlements "$ENTITLEMENTS" "$f" ;;
    *) tun "${SIGN[@]}" "$f" ;;
  esac
done < "$MACHO_LISTE"

# a2) Manifest auf die Prüfsumme des signierten Node setzen (sonst lehnt die App ihr eigenes Node ab);
#     muss vor der App-Signatur passieren, damit diese das Manifest mit absichert.
if [ "$TROCKEN" = 1 ]; then echo "  würde ausführen: bash scripts/node-manifest.sh nachziehen $APP"; else bash "$W/scripts/node-manifest.sh" nachziehen "$APP"; fi

# b) verschachtelte Pakete (z. B. Sparkle.framework mit XPC-Diensten), tiefste zuerst
find "$APP/Contents" \( -name '*.xpc' -o -name '*.app' -o -name '*.framework' \) -print 2>/dev/null \
  | awk -F/ '{print NF "\t" $0}' | sort -rn | cut -f2- \
  | while IFS= read -r b; do tun "${SIGN[@]}" "$b"; done

# c) die App selbst (ohne --deep: jedes Teil wurde oben einzeln signiert)
tun "${SIGN[@]}" "$APP"
tun codesign --verify --strict --verbose=2 "$APP"

# ---------- 2. App notarisieren ----------
schritt "2/6 App bei Apple notarisieren (dauert meist 2-10 Minuten)"
tun ditto -c -k --keepParent "$APP" "$ZIP"
tun xcrun notarytool submit "$ZIP" "${NOTAR_ARGS[@]}" --wait
tun xcrun stapler staple "$APP"

# ---------- 3. DMG ----------
schritt "3/6 DMG bauen (mit Programme-Verknüpfung)"
STAGE="$W/build/dmg-inhalt"
tun rm -rf "$STAGE" "$DMG"
tun mkdir -p "$STAGE"
tun ditto "$APP" "$STAGE/Kortex.app"
tun ln -s /Applications "$STAGE/Programme"
tun hdiutil create -volname "Kortex" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
tun "${SIGN[@]}" "$DMG"

# ---------- 4. DMG notarisieren ----------
schritt "4/6 DMG notarisieren und heften"
tun xcrun notarytool submit "$DMG" "${NOTAR_ARGS[@]}" --wait
tun xcrun stapler staple "$DMG"

# ---------- 5. Appcast ----------
schritt "5/6 Sparkle-Appcast ergänzen (EdDSA-Signatur über die DMG)"
if [ "$TROCKEN" = 1 ]; then
  echo "  würde ausführen: $SPARKLE_BIN/sign_update $DMG   (privater Schlüssel kommt aus ${SPARKLE_KEY_DATEI:-dem Schlüsselbund})"
  echo "  würde $APPCAST ergänzen: Version $VERSION, Download $DOWNLOAD_URL"
else
  SIG_ZEILE="$("$SPARKLE_BIN/sign_update" ${SIGN_UPDATE_ARGS[@]+"${SIGN_UPDATE_ARGS[@]}"} "$DMG")"   # Form: sparkle:edSignature="..." length="..."
  case "$SIG_ZEILE" in
    *edSignature=*length=*) ;;
    *) echo "Abbruch: sign_update lieferte keine Signatur. Ist der Sparkle-Schlüssel im Schlüsselbund (generate_keys)?" >&2; exit 1 ;;
  esac
  DATUM="$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')"
  ITEM="$(mktemp)"
  cat > "$ITEM" <<EOF
    <item>
      <title>Version $VERSION</title>
      <pubDate>$DATUM</pubDate>
      <sparkle:version>$BUILD</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>26.0</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink>https://github.com/$REPO/releases/tag/v$VERSION</sparkle:releaseNotesLink>
      <enclosure url="$DOWNLOAD_URL" type="application/octet-stream" $SIG_ZEILE />
    </item>
EOF
  if [ -f "$APPCAST" ]; then
    if grep -q "<sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>" "$APPCAST"; then
      echo "Abbruch: In appcast.xml steht Version $VERSION schon. Erst die Versionsnummer in Ressourcen/Info.plist erhöhen." >&2; exit 1
    fi
    NEU="$(mktemp)"
    # neuer Eintrag direkt nach dem <title> des Kanals (neueste zuerst)
    awk -v itemfile="$ITEM" 'BEGIN{done=0} {print} !done && /<\/title>/ && !/<item>/ && !/<title>Version/ {while((getline l < itemfile)>0) print l; done=1}' "$APPCAST" > "$NEU"
    mv "$NEU" "$APPCAST"
  else
    {
      cat <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Brain</title>
EOF
      cat "$ITEM"
      printf '  </channel>\n</rss>\n'
    } > "$APPCAST"
  fi
  rm -f "$ITEM"
  xmllint --noout "$APPCAST" 2>/dev/null && ok "appcast.xml ist gültiges XML" || { echo "Abbruch: appcast.xml ist kein gültiges XML." >&2; exit 1; }
fi

# ---------- 6. Prüfen ----------
schritt "6/6 Endkontrolle"
tun bash "$W/scripts/pruefe-signatur.sh" "$APP" "$DMG"

echo
if [ "$TROCKEN" = 1 ]; then
  echo "Trockenlauf fertig: Alles Nötige ist da. Echter Lauf: ohne --trocken starten."
else
  echo "Fertig. Zum Hochladen:"
  echo "  gh release create v$VERSION \"$DMG\" \"$APPCAST\" -R $REPO --title \"Kortex $VERSION\" --notes \"Frühe Version.\""
fi
