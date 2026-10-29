#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# pre-commit über core.hooksPath: blockiert neuen toten Link, lässt sauberen Commit durch, < 10 s, Hook ist 100755.
# Node-Suche des Hooks: PATH → Support-Ordner der App → $HOME/.brain-kit/node (alter Ort) → sonst blockieren (fail closed).
# Der Test-Vault entsteht aus fixture-neutral (nur Daten); der Hook liegt im Kern (core.hooksPath zeigt absolut dorthin).
set -u; D="$(cd "$(dirname "$0")" && pwd)"; K="${KORTEX_KERN:-$(cd "$D/.." && pwd)}"   # K = Kern-Wurzel (stage.sh setzt KORTEX_KERN)
[ -x "$K/git-hooks/pre-commit" ] || { echo "FAIL: pre-commit nicht ausführbar"; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
V="$T/Mein Brain"; mkdir -p "$V"
cp -R "$D/fixture-neutral/." "$V/"
g(){ git -C "$V" -c user.email=t@t -c user.name=t "$@"; }
# Portable Ersatz für „sed -i ''": Regex-Ersatz, ^/$ wirkt je Zeile; ersetzt nur den ERSTEN Treffer der Datei.
ersetze() { node -e 'const fs=require("fs");const [f,re,ers]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(new RegExp(re,"m"),ers))' "$@"; }
g init -q; g add --all; g commit -qm init --no-verify
node "$K/install-git-hooks.mjs" "$V" >/dev/null && [ "$(git -C "$V" config core.hooksPath)" = "$(cd "$K" && pwd -P)/git-hooks" ] || { echo "FAIL: Installer (hooksPath=$(git -C "$V" config core.hooksPath))"; exit 1; }
node "$K/install-git-hooks.mjs" "$V" >/dev/null   # idempotent
BRAIN_VAULT="$V" node "$K/install-git-hooks.mjs" >/dev/null && node "$K/install-git-hooks.mjs" --vault "$V" >/dev/null || { echo "FAIL: Installer mit BRAIN_VAULT bzw. --vault"; exit 1; }
P="wiki/firma/kunde_a/thema_beta.md"
echo '[[gibt_es_garantiert_nicht]]' >> "$V/$P"; ersetze "$V/$P" '^rev: [0-9]+$' 'rev: 99'; g add -- "$P"
S0=$(date +%s); OUT=$(g commit -qm kaputt 2>&1); RC=$?; D0=$(( $(date +%s) - S0 ))
[ $RC -ne 0 ] && echo "$OUT" | grep -q 'TOTER LINK' || { echo "FAIL: kaputter Commit angenommen (rc=$RC): $OUT"; exit 1; }
[ $D0 -lt 10 ] || { echo "FAIL: pre-commit zu langsam (${D0}s)"; exit 1; }
g checkout -q -- "$P" 2>/dev/null; g reset -q --hard HEAD
echo "notiz" > "$V/inbox/probe.md"; g add -- inbox/probe.md; g commit -qm sauber || { echo "FAIL: sauberer Commit abgelehnt"; exit 1; }

# Secret in .env wird über den Hook blockiert
KEY=api_key; VAL=sk-DUMMY1234567890; printf '%s=%s\n' "$KEY" "$VAL" > "$V/.env"; g add -f -- .env
OUT=$(g commit -qm geheim 2>&1) && { echo "FAIL: Secret in .env nicht blockiert"; exit 1; }
echo "$OUT" | grep -q 'SECRETS: .env' || { echo "FAIL: .env-Fundstelle fehlt: $OUT"; exit 1; }
g reset -q -- .env; rm -f "$V/.env"

# Node nicht im PATH, aber unter $HOME/.brain-kit/node → Hook findet es (Commit geht durch)
H="$T/home"
if [ "$TEST_WIN" = 1 ]; then
  # Windows: privates Node liegt als node.exe direkt in ~/.brain-kit/node (Zip-Layout). Git bringt sh und seine
  # Hilfsprogramme in /mingw64/bin + /usr/bin mit; Symlinks wären unter Git Bash nur Kopien ohne DLLs, und env -i
  # nähme Windows-Programmen SYSTEMROOT & Co. — darum nur PATH und HOME ersetzen.
  PRIV="$H/.brain-kit/node/node.exe"; mkdir -p "$(dirname "$PRIV")"; cp "$(node -p process.execPath)" "$PRIV"
  GITDIR="$(dirname "$(command -v git)")"   # Git-Verzeichnis je nach Git-for-Windows-Version unterschiedlich
  ohne_node() { env HOME="$H" PATH="/mingw64/bin:/usr/bin:$GITDIR" "$@"; }
else
  PRIV="$H/.brain-kit/node/bin/node"; mkdir -p "$(dirname "$PRIV")"; ln -s "$(command -v node)" "$PRIV"
  # PATH nur mit git + sh (git findet seine Hilfsprogramme über die eigene exec-path)
  OHNE="$T/ohne-node"; mkdir -p "$OHNE"; for W in git sh; do ln -sf "$(command -v $W)" "$OHNE/$W"; done
  ohne_node() { env -i HOME="$H" PATH="$OHNE" "$@"; }
fi
ohne_node sh -c 'command -v node' >/dev/null 2>&1 && { echo "FAIL: node im Test-PATH"; exit 1; }
echo "x" > "$V/inbox/probe2.md"; g add -- inbox/probe2.md
OUT=$(ohne_node git -C "$V" -c user.email=t@t -c user.name=t commit -qm privat-node 2>&1) || { echo "FAIL: Node unter ~/.brain-kit/node nicht gefunden: $OUT"; exit 1; }

# Node nirgends → blockiert mit einem Satz (fail closed)
rm -f "$PRIV"
echo "y" > "$V/inbox/probe3.md"; g add -- inbox/probe3.md
RC=0; OUT=$(ohne_node git -C "$V" -c user.email=t@t -c user.name=t commit -qm ohne-node 2>&1) || RC=$?
[ $RC -ne 0 ] && echo "$OUT" | grep -q 'Node wurde nicht gefunden' || { echo "FAIL: ohne Node nicht blockiert (rc=$RC): $OUT"; exit 1; }
g reset -q -- inbox/probe3.md; rm -f "$V/inbox/probe3.md"

# Hook ohne Prüfskript (Kern entfernt/unvollständig) → Commit geht durch, keine Shell-Fehlermeldung
mkdir -p "$T/leer-kern/git-hooks"; cp "$K/git-hooks/pre-commit" "$T/leer-kern/git-hooks/pre-commit"; chmod 755 "$T/leer-kern/git-hooks/pre-commit"
g config core.hooksPath "$T/leer-kern/git-hooks"
echo "x" > "$V/inbox/probe4.md"; g add -- inbox/probe4.md
OUT=$(g commit -qm ohne-skript 2>&1) || { echo "FAIL: fehlendes Prüfskript blockiert: $OUT"; exit 1; }
[ -z "$OUT" ] || { echo "FAIL: Meldung trotz fehlendem Prüfskript: $OUT"; exit 1; }
echo "PASS"
