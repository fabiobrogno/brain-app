#!/bin/bash
# .tools/tests/test-qmd-nie-echt.sh — Kein Shell-Test ruft das echte qmd (Folgepunkt aus der B2-Gegenprüfung): Dessen `embed` lädt mit frischem Test-HOME das
# Embedding-Modell (333 MB, Netz). Darum setzt plattform.sh (von jedem Shell-Test gesourct) QMD_BIN auf fake-qmd-cli.mjs, und brain search/refresh, doctor und
# search-refresh starten über QMD_BIN statt über das PATH-qmd (qmd-befehl.mjs#qmdAufruf). Prüft mit einem Spy-qmd vorn im PATH: 0 Aufrufe — und, dass der Spy
# überhaupt aufgerufen würde, wenn QMD_BIN leer ist (sonst bewiese „0“ nichts). Echtes qmd nur, wenn das Modell schon im Cache liegt (echtes_qmd_bereit).
. "$(dirname "$0")/plattform.sh"
set -u; D="$(cd "$(dirname "$0")" && pwd)"; B="$D/../brain.mjs"
fail() { echo "FAIL: $*"; exit 1; }

# 1) plattform.sh: ohne QMD_BIN zeigt er auf den Fake; ein von außen gesetzter Wert bleibt; leer zählt als nicht gesetzt
OUT=$(env -u QMD_BIN bash -c ". \"$D/plattform.sh\"; printf '%s' \"\$QMD_BIN\"")
case "$OUT" in */fake-qmd-cli.mjs) ;; *) fail "QMD_BIN ohne Vorgabe: erwartet …/fake-qmd-cli.mjs, war '$OUT'" ;; esac
[ -f "$OUT" ] || fail "der Fake liegt nicht dort: $OUT"
OUT=$(QMD_BIN=/eigener/qmd bash -c ". \"$D/plattform.sh\"; printf '%s' \"\$QMD_BIN\"")
[ "$OUT" = /eigener/qmd ] || fail "ein gesetztes QMD_BIN muss bleiben, war '$OUT'"
OUT=$(QMD_BIN= bash -c ". \"$D/plattform.sh\"; printf '%s' \"\$QMD_BIN\"")
case "$OUT" in */fake-qmd-cli.mjs) ;; *) fail "leeres QMD_BIN zählt als nicht gesetzt, war '$OUT'" ;; esac
case "${QMD_BIN:-}" in */fake-qmd-cli.mjs) ;; *) fail "dieser Test selbst läuft mit '$QMD_BIN'" ;; esac

# 2) echtes_qmd_bereit: nur mit installiertem qmd UND vorhandenem Modell — nie ein Download
if [ "$TEST_WIN" = 1 ]; then echo "SKIP: Spy-qmd ohne .cmd unter Windows nicht auffindbar"; echo "OK test-qmd-nie-echt"; exit 0; fi
S="$(mktemp -d)"; mkdir -p "$S/bin" "$S/heim"
SPY_LOG="$S/spy.log"; : > "$SPY_LOG"; export SPY_LOG
printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "$SPY_LOG"\nexit 0\n' > "$S/bin/qmd"; chmod +x "$S/bin/qmd"
( PATH="$S/bin:$PATH" HOME="$S/heim" XDG_CACHE_HOME= echtes_qmd_bereit ) && fail "echtes_qmd_bereit ohne Modell im Cache muss nein sagen"
mkdir -p "$S/heim/.cache/qmd/models"; : > "$S/heim/.cache/qmd/models/hf_ggml-org_embeddinggemma-300M-Q8_0.gguf"
( PATH="$S/bin:$PATH" HOME="$S/heim" XDG_CACHE_HOME= echtes_qmd_bereit ) || fail "echtes_qmd_bereit mit qmd und Modell muss ja sagen"
( PATH="/usr/bin:/bin" HOME="$S/heim" XDG_CACHE_HOME= echtes_qmd_bereit ) && fail "ohne qmd im PATH muss echtes_qmd_bereit nein sagen"
[ ! -s "$SPY_LOG" ] || fail "echtes_qmd_bereit hat qmd aufgerufen: $(cat "$SPY_LOG")"

# 3) Spy-qmd vorn im PATH, frisches Test-HOME: refresh, search, doctor, search-refresh → 0 Aufrufe
V="$(mktemp -d)/Mein Brain"; cp -R "$D/fixture" "$V"
node "$B" index >/dev/null 2>&1 || true
export BRAIN_VAULT="$V" BRAIN_UPDATE_QUELLE="$S/kein-update.json"
for befehl in "refresh" "search Testthema" "doctor"; do
  # shellcheck disable=SC2086
  PATH="$S/bin:$PATH" HOME="$S/heim" USERPROFILE="$S/heim" node "$B" $befehl >/dev/null 2>&1 || true
done
PATH="$S/bin:$PATH" HOME="$S/heim" USERPROFILE="$S/heim" node "$D/../search-refresh.mjs" >/dev/null 2>&1 || true
PATH="$S/bin:$PATH" HOME="$S/heim" USERPROFILE="$S/heim" node "$D/../doctor.mjs" "$V" >/dev/null 2>&1 || true
[ ! -s "$SPY_LOG" ] || fail "das PATH-qmd wurde aufgerufen (QMD_BIN ignoriert): $(head -3 "$SPY_LOG")"

# 4) Gegenprobe: mit leerem QMD_BIN ruft derselbe Weg den Spy auf — sonst bewiese „0 Aufrufe“ nichts
PATH="$S/bin:$PATH" HOME="$S/heim" USERPROFILE="$S/heim" QMD_BIN= node "$B" search Testthema >/dev/null 2>&1 || true
[ -s "$SPY_LOG" ] || fail "Gegenprobe: ohne QMD_BIN müsste der Spy aufgerufen werden — der Test misst nichts"

echo "OK test-qmd-nie-echt"
