// electron/laufzeit.mjs — die Laufzeit der installierten App im Support-Ordner (Paket W2c), das Gegenstück zu Sources/BrainCore/Laufzeit.swift:
//   Node  <support>/node/<version>/node[.exe]   Kopie des mitgelieferten Node (geprüft gegen manifest.json), nie überschrieben: Version ändert sich nur mit dem Node
//         <support>/bin/node[.exe]               der STABILE Pfad (BRAIN_MCP_NODE → MCP-Einträge, Statuszeile): fester Verweis auf die Kopie
//   Kern  <support>/kern/<appversion>-<stempel>  Kopie von <resources>/Ressourcen/kern (mit mcp/ und gemeinsam/), unveränderlich je Inhalt
//         <support>/bin/kern                     der STABILE Pfad (KORTEX_KERN_PFAD → MCP-Server, Hooks): Verweis auf die Kopie
// Warum Kopie statt „auf das Paket zeigen“: Das Paket liegt nicht überall an einem festen Ort — ein AppImage hängt sich bei jedem Start unter /tmp/.mount_<zufall> ein und hat bei jedem
// Update einen anderen Pfad —, aber ~/.claude, ~/.codex, Git-Hooks und Statuszeile merken sich die Pfade. Der Support-Ordner ist stabil, und eine Kopie überlebt auch das Beenden der App.
// Alles idempotent und ohne Wirkung außerhalb des Support-Ordners. Reine Logik OHNE `import "electron"` (Test: Tests/Node/electron-w2c.test.mjs).
//
// Der stabile Node-Pfad ist eine harte Verknüpfung (Rückfall: Kopie) und kein Symlink: harte Verknüpfungen brauchen unter Windows keine Rechte; Symlinks dort Entwicklermodus oder Admin.
// Austausch: Verknüpfung nebenan anlegen und darüber umbenennen (atomar auf Linux, auch bei laufendem Node); Windows verweigert das Überschreiben eines LAUFENDEN Programms, erlaubt aber
// das Umbenennen — dann wird die alte Datei beiseite geschoben (`.alt-<pid>`) und beim nächsten Start gelöscht. Der stabile Kern-Pfad ist ein Symlink (Windows: Junction, ohne Rechte).
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const VERSION = /^v\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{64}$/;
const NAME = /^[0-9A-Za-z._-]{1,60}$/;

export function sha256Datei(pfad) {
  const h = createHash("sha256"), puffer = Buffer.allocUnsafe(1 << 22), fd = openSync(pfad, "r");
  try { for (let n; (n = readSync(fd, puffer, 0, puffer.length, null)) > 0;) h.update(puffer.subarray(0, n)); } finally { closeSync(fd); }
  return h.digest("hex");
}

// Windows: frisch geschriebene Dateien hält oft kurz ein Virenscanner fest (EPERM/EBUSY) — umbenennen mit kurzen Wiederholungen
const warteBlockierend = (ms) => { const bis = Date.now() + ms; while (Date.now() < bis) { /* kurz warten */ } };
const benenneUm = (von, nach) => {
  for (let i = 0; ; i++) {
    try { return renameSync(von, nach); }
    catch (e) { if (process.platform !== "win32" || i >= 8 || !/^(EPERM|EACCES|EBUSY)$/.test(e?.code)) throw e; warteBlockierend(100 * (i + 1)); }
  }
};
const groesse = (p) => { try { return statSync(p).size; } catch { return -1; } };
const gleicheDatei = (a, b) => {
  try {
    const x = statSync(a, { bigint: true }), y = statSync(b, { bigint: true });
    if (x.ino !== 0n && x.ino === y.ino && x.dev === y.dev) return true; // harte Verknüpfung
    return x.size === y.size && sha256Datei(a) === sha256Datei(b); // Rückfall (Kopie, nur wenn keine harte Verknüpfung möglich war): gleicher Inhalt
  } catch { return false; }
};
const wegDamit = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* läuft gerade (Windows) oder weg: der nächste Start räumt auf */ } };
const aufraeumen = (ordner, muster) => { try { for (const n of readdirSync(ordner)) if (muster.test(n)) wegDamit(join(ordner, n)); } catch { /* kein Ordner */ } };

/** Legt `stabil` als harte Verknüpfung (Rückfall Kopie) auf `ziel`; ein vorhandener, anderer Eintrag wird atomar ersetzt (Windows: laufende Datei beiseite geschoben). */
export function setzeDateiLink(stabil, ziel) {
  if (existsSync(stabil) && gleicheDatei(stabil, ziel)) return false;
  const tmp = `${stabil}.neu-${process.pid}`;
  wegDamit(tmp);
  try { linkSync(ziel, tmp); } catch { copyFileSync(ziel, tmp); chmodSync(tmp, 0o755); }
  try { renameSync(tmp, stabil); }
  catch {
    const alt = `${stabil}.alt-${process.pid}-${Date.now()}`;
    renameSync(stabil, alt); // Windows: eine laufende Datei lässt sich umbenennen, nicht überschreiben
    renameSync(tmp, stabil);
    wegDamit(alt);
  }
  return true;
}

// Windows kann einen Verweis nicht durch Umbenennen ersetzen (MoveFileEx überschreibt nur Dateien, nie ein Verzeichnis oder eine Junction: EPERM); eine Junction lässt sich auch nicht umbiegen. Dort gibt es darum
// beim ECHTEN Wechsel (nur bei neuem Kern, also nach einem App-Update) eine Lücke von zwei Aufrufen (löschen, umbenennen). Sie bleibt klein, weil der neue Verweis vorher unter eigenem Namen fertig ist, und im
// Normalfall (gleicher Kern wie beim letzten Start) wird gar nichts angefasst. Linux/macOS: atomar, keine Lücke.
/** Legt `stabil` als Verweis auf den Ordner `ziel` (Linux/macOS Symlink, Windows Junction) und schaltet ihn atomar um. → vorheriges Ziel (Ordnername) oder null. */
export function setzeOrdnerLink(stabil, ziel, { plattform = process.platform } = {}) {
  let vorher = null;
  try { vorher = basename(readlinkSync(stabil)); } catch { /* neu */ }
  try { if (readlinkSync(stabil) === ziel) return vorher; } catch { /* neu */ } // schon richtig: nichts anfassen (unter Windows gäbe es sonst ein Fenster ohne Verweis)
  const tmp = `${stabil}.neu-${process.pid}`;
  wegDamit(tmp);
  symlinkSync(ziel, tmp, plattform === "win32" ? "junction" : "dir");
  try { renameSync(tmp, stabil); }
  catch { // Windows: ein vorhandener Verweis lässt sich nicht überschreiben
    try { unlinkSync(stabil); } catch { /* weg oder kein Verweis */ }
    renameSync(tmp, stabil);
  }
  return vorher;
}

/** Node: Kopie nach <support>/node/<version>/, stabiler Pfad <support>/bin/node[.exe]. → { node (stabil), nodeDatei (Kopie), version } */
export function installiereNode({ quelle, support, plattform = process.platform }) {
  const exe = plattform === "win32" ? "node.exe" : "node";
  let m;
  try { m = JSON.parse(readFileSync(join(quelle, "manifest.json"), "utf8")); } catch { throw new Error("Das Manifest der mitgelieferten Node-Laufzeit fehlt."); }
  if (!m || !VERSION.test(m.version) || !SHA.test(m.sha256) || !Number.isInteger(m.size)) throw new Error("Das Manifest der mitgelieferten Node-Laufzeit ist ungültig.");
  const dir = join(support, "node", m.version), datei = join(dir, exe), marke = join(dir, ".fertig");
  const fertig = () => { try { return readFileSync(marke, "utf8").trim() === m.sha256 && groesse(datei) === m.size; } catch { return false; } };
  if (!fertig()) {
    const q = join(quelle, exe);
    if (groesse(q) !== m.size || sha256Datei(q) !== m.sha256) throw new Error("Die Prüfsumme der mitgelieferten Node-Datei stimmt nicht.");
    wegDamit(dir);
    mkdirSync(dir, { recursive: true });
    const tmp = `${datei}.neu-${process.pid}`;
    copyFileSync(q, tmp);
    chmodSync(tmp, 0o755);
    benenneUm(tmp, datei);
    writeFileSync(marke, `${m.sha256}\n`);
  }
  const bin = join(support, "bin");
  mkdirSync(bin, { recursive: true });
  aufraeumen(bin, /\.(alt|neu)-\d+(-\d+)?$/);
  const stabil = join(bin, exe);
  setzeDateiLink(stabil, datei);
  try { for (const n of readdirSync(join(support, "node"))) if (n !== m.version) wegDamit(join(support, "node", n)); } catch { /* nichts zu räumen */ }
  return { node: stabil, nodeDatei: datei, version: m.version };
}

/** Kern: Kopie nach <support>/kern/<version>-<stempel>/, stabiler Pfad <support>/bin/kern. → { kern (stabil), ordner, version } oder null, wenn das Paket keinen Kern enthält. */
export function installiereKern({ quelle, support, plattform = process.platform }) {
  if (!existsSync(join(quelle, "brain.mjs"))) return null;
  const lies = (n) => { try { return readFileSync(join(quelle, n), "utf8").trim(); } catch { return ""; } };
  const version = NAME.test(lies("VERSION")) ? lies("VERSION") : "0";
  const stempel = lies(".stempel");
  if (!SHA.test(stempel)) throw new Error("Der Kern im Paket hat keinen Stempel (.stempel).");
  const name = `${version}-${stempel.slice(0, 12)}`, dir = join(support, "kern", name), marke = join(dir, ".fertig");
  if (!(existsSync(marke) && readFileSync(marke, "utf8").trim() === stempel)) {
    mkdirSync(join(support, "kern"), { recursive: true });
    const tmp = `${dir}.neu-${process.pid}`;
    wegDamit(tmp);
    cpSync(quelle, tmp, { recursive: true });
    writeFileSync(join(tmp, ".fertig"), `${stempel}\n`);
    wegDamit(dir);
    benenneUm(tmp, dir);
  }
  const bin = join(support, "bin");
  mkdirSync(bin, { recursive: true });
  const stabil = join(bin, "kern");
  const vorher = setzeOrdnerLink(stabil, dir, { plattform });
  // Die vorige Version bleibt liegen (ein Hook, der mitten im Update läuft, liest weiter aus ihr); ältere und angebrochene Kopien gehen
  try { for (const n of readdirSync(join(support, "kern"))) if (n !== name && n !== vorher) wegDamit(join(support, "kern", n)); } catch { /* nichts zu räumen */ }
  return { kern: stabil, ordner: dir, version };
}

// ───────────── Starter: <support>/bin/kortex (Linux) bzw. kortex.cmd (Windows), Gegenstück zu Laufzeit.swift#starterInhalt ─────────────
// Normalmodus `kortex <befehl> …`: setzt KORTEX_KERN_PFAD auf den stabilen Verweis bin/kern und startet `node bin/kern/brain.mjs …` (fehlt etwas: Meldung auf stderr, Exit 127).
// Hook-Modus `kortex hook <name> …`: startet bin/kern/adapters/claude-code/<name>.mjs. Fehlt Node, der Kern oder der Hook (App gelöscht, Update mitten im Wechsel), endet er STILL mit Exit 0 ohne
// Ausgabe — nie eine Fehlermeldung in einer Claude-Sitzung. Läuft der Hook, bleiben Exit-Code, Ausgabe und stdin erhalten.
const shText = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
export function starterInhaltUnix(support) {
  const node = join(support, "bin", "node"), kern = join(support, "bin", "kern");
  return `#!/bin/sh
# Kortex-Starter. Von der App geschrieben und bei jedem Start erneuert — nicht von Hand ändern.
node=${shText(node)}
kern=${shText(kern)}
KORTEX_KERN_PFAD="$kern"
export KORTEX_KERN_PFAD
if [ "$1" = "hook" ]; then
  # Hook-Modus: fehlt etwas, still beenden (Exit 0, keine Ausgabe).
  name="$2"
  case "$name" in
    ''|*[!abcdefghijklmnopqrstuvwxyz0123456789-]*) exit 0 ;;
  esac
  hook="$kern/adapters/claude-code/$name.mjs"
  if [ ! -f "$node" ] || [ ! -x "$node" ] || [ ! -f "$hook" ]; then exit 0; fi
  shift 2
  exec "$node" "$hook" "$@"
fi
if [ ! -f "$node" ] || [ ! -x "$node" ]; then
  echo "kortex: Node fehlt ($node). Bitte Kortex einmal öffnen." >&2
  exit 127
fi
if [ ! -f "$kern/brain.mjs" ]; then
  echo "kortex: Kern fehlt ($kern/brain.mjs). Bitte Kortex öffnen bzw. aktualisieren." >&2
  exit 127
fi
exec "$node" "$kern/brain.mjs" "$@"
`;
}
// Windows: Stapeldatei. Die Pfade stehen NICHT darin, sie kommen aus ihrem eigenen Ort (%~dp0 = <support>\bin\): nichts, was man quoten müsste. Der Hook-Name wird gegen [a-z0-9-] geprüft, die übrigen
// Argumente (--art fakt, --konto k_…) reichen als Text weiter (%* ignoriert shift, darum die Schleife). Das Ende ist `exit /b` mit dem Code des Programms.
export function starterInhaltWindows() {
  return [
    "@echo off",
    "rem Kortex-Starter. Von der App geschrieben und bei jedem Start erneuert - nicht von Hand aendern.",
    "setlocal DisableDelayedExpansion",
    'set "node=%~dp0node.exe"',
    'set "kern=%~dp0kern"',
    'set "KORTEX_KERN_PFAD=%kern%"',
    'if /i "%~1"=="hook" goto hook',
    'if not exist "%node%" (',
    "  echo kortex: Node fehlt. Bitte Kortex einmal oeffnen. 1>&2",
    "  exit /b 127",
    ")",
    'if not exist "%kern%\\brain.mjs" (',
    "  echo kortex: Kern fehlt. Bitte Kortex oeffnen bzw. aktualisieren. 1>&2",
    "  exit /b 127",
    ")",
    '"%node%" "%kern%\\brain.mjs" %*',
    "exit /b %errorlevel%",
    ":hook",
    'set "name=%~2"',
    'if "%name%"=="" exit /b 0',
    "setlocal EnableDelayedExpansion", // nur für die Prüfung: `echo !name!` wertet &, | im Namen nicht aus
    'echo !name!| findstr /r /x /c:"[a-z0-9-][a-z0-9-]*" >nul || exit /b 0',
    "endlocal",
    'set "hook=%kern%\\adapters\\claude-code\\%name%.mjs"',
    'if not exist "%node%" exit /b 0',
    'if not exist "%hook%" exit /b 0',
    'set "rest="',
    "shift",
    "shift",
    ":schleife",
    'if "%~1"=="" goto lauf',
    "set rest=%rest% %1",
    "shift",
    "goto schleife",
    ":lauf",
    '"%node%" "%hook%" %rest%',
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");
}
/** Schreibt den Starter atomar (erst daneben, dann umbenennen); unverändert, wenn der Inhalt schon stimmt. → Pfad. */
export function schreibeStarter({ support, plattform = process.platform }) {
  const win = plattform === "win32", bin = join(support, "bin"), ziel = join(bin, win ? "kortex.cmd" : "kortex");
  const inhalt = win ? starterInhaltWindows() : starterInhaltUnix(support);
  mkdirSync(bin, { recursive: true });
  try { if (readFileSync(ziel, "utf8") === inhalt && (win || (statSync(ziel).mode & 0o111) === 0o111)) return ziel; } catch { /* neu */ }
  const tmp = `${ziel}.neu-${process.pid}`;
  wegDamit(tmp);
  writeFileSync(tmp, inhalt, { mode: 0o755 });
  chmodSync(tmp, 0o755);
  benenneUm(tmp, ziel);
  return ziel;
}

/** Alles zusammen für die installierte App: `ressourcen` = process.resourcesPath. Node ist Pflicht (wirft), der Kern fehlt nur in einem Paket ohne Kern. */
export function installiereLaufzeit({ ressourcen, support, plattform = process.platform }) {
  const node = installiereNode({ quelle: join(ressourcen, "node"), support, plattform });
  const kern = installiereKern({ quelle: join(ressourcen, "Ressourcen", "kern"), support, plattform });
  // Der Starter ist Zubehör (Hooks, Hintergrunddienst): lässt er sich nicht schreiben (Schreibschutz, Virenscanner), läuft die App trotzdem; der Grund geht an den Aufrufer (Protokoll)
  let starter = null, starterFehler = null;
  if (kern) { try { starter = schreibeStarter({ support, plattform }); } catch (e) { starterFehler = String(e?.message || e); } }
  return { ...node, kern: kern?.kern ?? null, kernOrdner: kern?.ordner ?? null, starter, starterFehler };
}
