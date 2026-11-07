// electron/paket/start-pruefung.mjs — startet die gebaute RELEASE-App OHNE Playwright (mit den Fuses der Auslieferung: kein Inspect, kein RunAsNode) und wartet, bis ihr Protokoll „werkstatt bereit“ meldet.
// Dazu zwei Gegenproben: Debug-Anschlüsse beenden die App sofort (Exit ≠ 0), und mit ELECTRON_RUN_AS_NODE=1 wird sie kein Node (sie startet als App, `-e` wird nicht ausgeführt).
//   node electron/paket/start-pruefung.mjs <Programmdatei> [--no-sandbox]
// Umgebung ausdrücklich gebaut: eigenes Temp-HOME und Support-Ordner, nie der echte; DISPLAY/XAUTHORITY nur durchgereicht (xvfb).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const programm = process.argv[2];
const extra = process.argv.slice(3);
if (!programm || !existsSync(programm)) { console.error(`Programm fehlt: ${programm}`); process.exit(2); }
const WIN = process.platform === "win32";
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));

function umgebung(home, zusatz = {}) {
  const env = { PATH: WIN ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : "/usr/bin:/bin", HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    BRAIN_APP_SUPPORT: join(home, "support"), TZ: "Europe/Berlin", ...zusatz };
  for (const k of ["SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"]) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}
function beende(kind) { // nur der eigene Prozess
  if (kind.exitCode !== null) return;
  if (WIN) spawnSync("taskkill", ["/PID", String(kind.pid), "/T", "/F"], { stdio: "ignore" }); else kind.kill("SIGKILL");
}

const home = realpathSync(mkdtempSync(join(tmpdir(), "kortex-start-")));
let fehler = null;
try {
  // 1. Debug-Anschluss: die App beendet sich (Exit ≠ 0), ohne ein Fenster zu zeigen
  const dbg = spawnSync(programm, [...extra, "--remote-debugging-port=0"], { env: umgebung(home), encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (dbg.status === 0 || dbg.status === null) throw new Error(`mit --remote-debugging-port hätte sich die App beenden müssen (Status ${dbg.status}, ${dbg.signal ?? ""})`);
  console.log(`ok: --remote-debugging-port beendet die App (Status ${dbg.status})`);
  // 2. ELECTRON_RUN_AS_NODE: wirkt nicht (die App startet normal und führt `-e` nicht aus)
  const alsNode = spawn(programm, [...extra, "-e", `require("fs").writeFileSync(${JSON.stringify(join(home, "als-node.txt"))}, "x")`], { env: umgebung(home, { ELECTRON_RUN_AS_NODE: "1" }), stdio: "ignore", windowsHide: true });
  await warte(8000);
  beende(alsNode);
  if (existsSync(join(home, "als-node.txt"))) throw new Error("ELECTRON_RUN_AS_NODE hat die App in ein Node verwandelt (Fuse RunAsNode ist nicht aus)");
  console.log("ok: ELECTRON_RUN_AS_NODE wirkt nicht");
  // 3. normaler Start: das Protokoll meldet „werkstatt bereit“
  rmSync(join(home, "support"), { recursive: true, force: true });
  const app = spawn(programm, extra, { env: umgebung(home), stdio: "ignore", windowsHide: true });
  const log = join(home, "support", "electron", "huelle.log");
  const bis = Date.now() + 90_000;
  let text = "";
  while (Date.now() < bis) {
    await warte(500);
    if (existsSync(log)) text = readFileSync(log, "utf8");
    if (/werkstatt bereit/.test(text)) break;
    if (app.exitCode !== null) break;
  }
  const lief = app.exitCode === null;
  beende(app);
  if (!/werkstatt bereit/.test(text)) throw new Error(`Das Protokoll meldet nie „werkstatt bereit“ (App ${lief ? "lief" : `endete mit ${app.exitCode}`}). Protokoll:\n${text.slice(-1500)}`);
  console.log("ok: Release-App startet ohne Playwright, Werkstatt bereit");
} catch (e) { fehler = e; }
finally { await warte(500); try { rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Temp räumt das System */ } }
if (fehler) { console.error(fehler.message); process.exit(1); }
