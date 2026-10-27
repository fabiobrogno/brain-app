#!/bin/bash
# Speichermessung M1 (App-Spec §7.1, §13.2): physischer Speicher (Spalte MEM von top = phys_footprint, wie die
# Aktivitätsanzeige 'Speicher') von App, Brücke und den neuen WebKit-Prozessen des Fensters.
# shellcheck disable=SC2046,SC2086  # PID-Listen (pgrep, $NEU, $REST) werden absichtlich aufgeteilt: ein Argument je PID, leer = keine
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="$W/build/Kortex.app/Contents/MacOS/BrainApp"
KIT="${BRAIN_TEST_KIT:-$HOME/brain-kit-v0.6}"
VAULT_ECHT="${1:-$KIT}"   # gemessen wird mit einem vollständigen Brain (Standard: der Kit-Worktree)
[ -x "$APP" ] || { echo "zuerst bash scripts/baue-app.sh"; exit 1; }

mem_mb() {   # Summe in MB über alle übergebenen PIDs
  local s=0 p v
  for p in "$@"; do
    v="$(top -l 1 -stats pid,mem -pid "$p" 2>/dev/null | awk -v p="$p" '$1==p {v=$2; sub(/[+-]$/,"",v); u=substr(v,length(v)); n=substr(v,1,length(v)-1)+0; if(u=="K") n/=1024; else if(u=="G") n*=1024; else if(u=="B") n/=1048576; printf "%.0f", n}' || true)"
    s=$((s + ${v:-0}))
  done
  echo "$s"
}
webkit() { pgrep -f "com.apple.WebKit" | sort || true; }
warte() { for _ in $(seq 1 "$3"); do grep -Eq "$2" "$1" 2>/dev/null && return 0; sleep 0.25; done; return 1; }

# 1) nur Menüleiste (Fenster nie geöffnet)
S1="$(mktemp -d)"
BRAIN_APP_SUPPORT="$S1" "$APP" --vault "$VAULT_ECHT" --test-beenden-nach 30 &
P1=$!
warte "$S1/logs/app.log" "status (ok|hinweis|problem)" 80 || true
sleep 5
MENUE="$(mem_mb "$P1" $(pgrep -P "$P1" || true))"
wait "$P1" || true

# 2) Fenster offen (mit 3D), 3) Fenster wieder zu
S2="$(mktemp -d)"
VORHER="$(webkit)"
BRAIN_APP_SUPPORT="$S2" "$APP" --vault "$VAULT_ECHT" --test-fenster --test-fenster-schliessen-nach 25 --test-beenden-nach 60 &
P2=$!
warte "$S2/logs/app.log" "fenster-bereit" 120 || true
sleep 5
NEU="$(comm -13 <(echo "$VORHER") <(webkit) | tr '\n' ' ')"
OFFEN="$(mem_mb "$P2" $(pgrep -P "$P2" || true) $NEU)"
warte "$S2/logs/app.log" "fenster-zu" 120 || true
sleep 10
REST="$(for p in $NEU; do { kill -0 "$p" 2>/dev/null && echo "$p"; } || true; done | tr '\n' ' ')"
ZU="$(mem_mb "$P2" $(pgrep -P "$P2" || true) $REST)"
wait "$P2" || true

bewerte() { [ "$1" -le "$2" ] && echo "✓ ja" || echo "✕ nein"; }
DATUM="$(date +%Y-%m-%d)"
mkdir -p "$W/docs/messungen"
DATEI="$W/docs/messungen/$DATUM-m1-speicher.md"
cat > "$DATEI" <<PROTOKOLL
# Speichermessung M1 — $DATUM

Gerät: $(sysctl -n machdep.cpu.brand_string), $(( $(sysctl -n hw.memsize) / 1073741824 )) GB, macOS $(sw_vers -productVersion).
Brain: \`$VAULT_ECHT\`. Messgröße: physischer Speicher (top MEM), App + Kindprozesse + neue WebKit-Prozesse.

| Zustand | gemessen | Ziel (Spec §7.1) | erfüllt |
|---|---|---|---|
| Nur Menüleiste, Fenster nie geöffnet | $MENUE MB | ≤ 60 MB | $(bewerte "$MENUE" 60) |
| Fenster offen, 3D sichtbar | $OFFEN MB | ≤ 600 MB | $(bewerte "$OFFEN" 600) |
| Fenster wieder zu | $ZU MB | ≤ 60 MB | $(bewerte "$ZU" 60) |
PROTOKOLL
cat "$DATEI"
