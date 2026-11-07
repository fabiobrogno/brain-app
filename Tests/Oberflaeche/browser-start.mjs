// Startet den ECHTEN Startbefehl von „Kortex im Browser“ (Ressourcen/werkstatt/start.mjs) für die Oberflächentests, mit ausdrücklich gebauter Umgebung:
// eigenes HOME und Support-Ordner in Temp, nichts vom Testlauf außer PATH (und den Windows-Systemvariablen); nie CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*, GIT_CONFIG_*.
// Liefert die Einlass-Adresse genau wie der Startbefehl sie dem Browser gäbe: Karte per Geheimnis aus der Sperrdatei holen, `/?t=<Karte>`.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const START = join(wurzel, "Ressourcen/werkstatt/start.mjs");

export async function starteBrowserDienst({ vault = null, path = process.env.PATH, extra = {} } = {}) {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "kortex-browser-ui-")));
  const support = join(home, "support");
  mkdirSync(support, { recursive: true });
  const env = { PATH: path, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"), BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", TZ: "Europe/Berlin", ...extra };
  for (const k of ["SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG"]) if (process.env[k] !== undefined) env[k] = process.env[k];
  const kind = spawn(process.execPath, [START, "--nicht-oeffnen", ...(vault ? ["--vault", vault] : [])], { stdio: ["ignore", "pipe", "pipe"], env, windowsHide: true });
  let puffer = "";
  const m = await new Promise((ok, nein) => {
    const frist = setTimeout(() => nein(new Error("Browser-Dienst startet nicht: " + puffer)), 20000);
    const lies = (d) => { puffer += d; const t = /Bereit: (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(puffer); if (t) { clearTimeout(frist); ok(t); } };
    kind.stdout.on("data", lies); kind.stderr.on("data", lies);
    kind.on("exit", (c) => nein(new Error(`Browser-Dienst beendet (${c}): ${puffer}`)));
  });
  const url = m[1], port = Number(m[2]);
  const stand = () => JSON.parse(readFileSync(join(support, "browser-dienst.json"), "utf8"));
  // Einlass-Adresse mit frischer Karte (einmal gültig)
  const einlass = async () => {
    const r = await fetch(`${url}_kortex/einlass`, { method: "POST", headers: { Authorization: `Bearer ${stand().geheimnis}` } });
    return `${url}?t=${(await r.json()).karte}`;
  };
  const ausgabe = () => puffer;
  const stopp = () => new Promise((ok) => { kind.once("exit", ok); try { kind.kill(); } catch { ok(); } setTimeout(ok, 3000); });
  return { url, port, home, support, einlass, ausgabe, stopp, kind };
}
