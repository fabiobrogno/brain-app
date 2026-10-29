#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# test-zeig.sh — "brain zeig": erzeugt die Daten für die 3D-Ansicht (Task 1:
# ansicht/daten.mjs im Kern) und meldet den Pfad der Ansicht. --nicht-oeffnen/--nur-daten verhindern
# in Tests, dass ein Browser aufgeht.
set -u; D="$(cd "$(dirname "$0")" && pwd)"; B="$D/../brain.mjs"
T="$(mktemp -d)"; V="$T/Mein Brain"; cp -R "$D/fixture" "$V"
# zeig nutzt die Ansicht des KERNS (liegt außerhalb des Vaults); Daten und die file://-Seite (seite.html) entstehen im Ziel-Vault (BRAIN_VAULT).
mit_tools() { :; }   # früher: Kopie des Werkzeug-Ordners in jeden Test-Vault — der Vault enthält jetzt nur Daten

RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig --nicht-oeffnen) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig --nicht-oeffnen rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://' || { echo "FAIL: Ausgabe enthält keine file://-URL: $OUT"; exit 1; }
echo "$OUT" | grep -Eq '\.logs/ansicht/seite\.html"?$' || { echo "FAIL: Ausgabe endet nicht auf .logs/ansicht/seite.html: $OUT"; exit 1; }
# Die geöffnete Seite liegt im Ziel-Vault (dort, wo auch data.js geschrieben wird), nicht im Werkzeug-Vault
echo "$OUT" | grep -qF "/Mein%20Brain/.logs/ansicht/seite.html" || { echo "FAIL: URL zeigt nicht auf <BRAIN_VAULT>/.logs/ansicht: $OUT"; exit 1; }
# seite.html = index.html des Kerns mit <base> auf den Kern und der Adresse der Daten im Vault
grep -q '<base href="file://[^"]*/ansicht/">' "$V/.logs/ansicht/seite.html" && grep -q '<meta name="brain-daten" content="file://[^"]*/Mein%20Brain/.logs/ansicht/data.js">' "$V/.logs/ansicht/seite.html" || { echo "FAIL: seite.html ohne base/brain-daten"; head -8 "$V/.logs/ansicht/seite.html"; exit 1; }
grep -q 'src="app.js"' "$V/.logs/ansicht/seite.html" || { echo "FAIL: seite.html ist nicht die Kern-index.html"; exit 1; }
[ ! -e "$V/.tools" ] || { echo "FAIL: zeig legt .tools im Vault an"; exit 1; }
[ -f "$V/.logs/ansicht/data.js" ] || { echo "FAIL: <vault>/.logs/ansicht/data.js fehlt"; exit 1; }

# --nur-daten: öffnet nichts (keine file://-URL in der Ausgabe), druckt die Seitenzahl
RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig --nur-daten) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig --nur-daten rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://' && { echo "FAIL: --nur-daten hat trotzdem eine URL gedruckt: $OUT"; exit 1; }
echo "$OUT" | grep -Eq '^[0-9]+ Seiten, [0-9]+ Verbindungen\.$' || { echo "FAIL: --nur-daten druckt keine Seitenzahl: $OUT"; exit 1; }

# Leerer Vault → Exit 0 (kein Wiki-Ordner, keine Notizen)
LEER="$T/leer"; mkdir -p "$LEER"; mit_tools "$LEER"
RC=0; OUT=$(BRAIN_VAULT="$LEER" node "$B" zeig --nicht-oeffnen) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig bei leerem Vault rc=$RC: $OUT"; exit 1; }

# Scheitern-Pfad beim tatsächlichen Öffnen (ohne --nicht-oeffnen/--nur-daten): BRAIN_OEFFNER ist ein reiner
# Testhaken (siehe oeffneDatei() in brain.mjs) und ersetzt das Öffner-Programm durch einen garantiert nicht
# existierenden Pfad — kein echter Browser geht auf, spawn() liefert asynchron "error", kein Absturz,
# Scheitern-Satz, Exit 0 (Fund 1 aus dem Review).
# BRAIN_DIENST_AUS=1: Ansicht-Dienst-Start gilt als gescheitert → genau der file://-Rückfall wird geprüft
# (der Dienst selbst: test-dienst.sh) — und es bleibt kein Dienst-Prozess übrig.
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_OEFFNER="$T/gibt-es-nicht/kein-programm" BRAIN_VAULT="$V" node "$B" zeig) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit scheiterndem Öffner rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "Öffne diese Datei im Browser:" || { echo "FAIL: Scheitern-Satz fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://' || { echo "FAIL: Scheitern-Satz ohne file://-URL: $OUT"; exit 1; }

# Erfolgspfad beim tatsächlichen Öffnen: BRAIN_OEFFNER zeigt auf ein echtes, garantiert vorhandenes Programm
# (node selbst) — der Kindprozess startet wirklich (spawn()-Event), auch wenn er danach an der .html-Datei
# scheitert; das genügt für den Erfolgs-Satz.
# Nativer Pfad direkt von Node (C:\… unter Windows) — hängt nicht an der MSYS-Umgebungskonvertierung (Fund 6).
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_OEFFNER="$(node -p process.execPath)" BRAIN_VAULT="$V" node "$B" zeig) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit echtem Öffner rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "Geöffnet im Browser:" || { echo "FAIL: Erfolgs-Satz fehlt: $OUT"; exit 1; }

# Nicht existierender Vault: verständliche Meldung statt Stacktrace, Exit 1 (Fund 2 aus dem Review)
RC=0; OUT=$(BRAIN_VAULT="$T/gibt-es-nicht-als-vault" node "$B" zeig --nicht-oeffnen 2>&1) || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: zeig bei fehlendem Vault rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "Vault nicht gefunden:" || { echo "FAIL: Satz für fehlenden Vault fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -qiE 'ENOENT|at .*\(|stack' && { echo "FAIL: Rohtext/Stacktrace bei fehlendem Vault: $OUT"; exit 1; }

# Unbekannte Option: Exit 2 mit Hinweis statt den Browser zu öffnen (BRAIN_OEFFNER zur Sicherheit gesetzt,
# falls die Prüfung je regrediert — dann soll trotzdem kein echter Browser aufgehen, siehe Hinweis im Review)
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_OEFFNER="$T/gibt-es-nicht/kein-programm" BRAIN_VAULT="$V" node "$B" zeig --quatsch 2>&1) || RC=$?
[ "$RC" = 2 ] || { echo "FAIL: zeig mit unbekannter Option rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF -- "--quatsch" || { echo "FAIL: Hinweis nennt die unbekannte Option nicht: $OUT"; exit 1; }

# Kern ohne Ansicht (z. B. beschädigte Installation): klare Meldung, Exit 1
OHNE="$T/ohne-ansicht"; cp -R "$D/fixture" "$OHNE"
K2="$T/kern-ohne-ansicht"; mkdir -p "$K2"; for e in "$D/.."/* "$D/.."/.[!.]*; do [ -e "$e" ] || continue; [ "$(basename "$e")" = tests ] && continue; cp -R "$e" "$K2/"; done; rm -f "$K2/ansicht/index.html"
RC=0; OUT=$(BRAIN_VAULT="$OHNE" node "$K2/brain.mjs" zeig --nicht-oeffnen 2>&1) || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: zeig ohne Ansicht im Kern rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "fehlt in diesem Kern" || { echo "FAIL: Satz für fehlende Ansicht fehlt: $OUT"; exit 1; }
# Kein Vault bekannt (weder --vault noch BRAIN_VAULT noch App-Liste): Exit 2 mit klarer Meldung, kein Rückfall auf irgendeinen Ordner
RC=0; OUT=$(node "$B" zeig --nicht-oeffnen 2>&1) || RC=$?
[ "$RC" = 2 ] && echo "$OUT" | grep -qF "Kein Vault gefunden" || { echo "FAIL: zeig ohne Vault rc=$RC: $OUT"; exit 1; }
# --vault <pfad> statt BRAIN_VAULT
RC=0; OUT=$(node "$B" zeig --nur-daten --vault "$V" 2>&1) || RC=$?
[ "$RC" = 0 ] && echo "$OUT" | grep -Eq '^[0-9]+ Seiten' || { echo "FAIL: zeig --vault rc=$RC: $OUT"; exit 1; }

# Warnungen von daten.mjs (kaputte brain.config.json) landen auf stderr, zeig läuft trotzdem durch (Fund 4)
KAPUTT="$T/kaputt"; cp -R "$D/fixture" "$KAPUTT"; mit_tools "$KAPUTT"
printf '{ "clusters": [ kaputt' > "$KAPUTT/brain.config.json"
RC=0; ERR=$(BRAIN_VAULT="$KAPUTT" node "$B" zeig --nur-daten 2>&1 >/dev/null) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit kaputter Config rc=$RC: $ERR"; exit 1; }
echo "$ERR" | grep -q '^Warnung: brain.config.json ist kaputt' || { echo "FAIL: Warnung zur kaputten Config fehlt auf stderr: $ERR"; exit 1; }
# Doppelte Cluster-ID → Warnung, Exit 0
printf '{ "clusters": [ { "id": "kochen", "name": "Kochen" }, { "id": "kochen", "name": "Nochmal" } ] }\n' > "$KAPUTT/brain.config.json"
RC=0; ERR=$(BRAIN_VAULT="$KAPUTT" node "$B" zeig --nur-daten 2>&1 >/dev/null) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit doppeltem Cluster rc=$RC: $ERR"; exit 1; }
echo "$ERR" | grep -q '^Warnung: Cluster „kochen“ steht doppelt' || { echo "FAIL: Warnung zum doppelten Cluster fehlt: $ERR"; exit 1; }

echo "OK test-zeig"
