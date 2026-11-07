// Startet die ECHTE Electron-App (haupt.mjs) für die Tests, mit ausdrücklich gebauter Umgebung: eigenes HOME und Support-Ordner im Temp-Verzeichnis,
// nichts vom Testlauf außer PATH, der Anzeige (DISPLAY/XAUTHORITY unter xvfb) und den Windows-Systemvariablen — nie CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*, GIT_CONFIG_*.
// Der echte Support-Ordner, ~/brain, ~/.claude* und der Schlüsselbund werden nie berührt.
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { baueVault } from "../../Tests/Oberflaeche/vault.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const HAUPT = join(HIER, "..", "haupt.mjs");
export { baueVault };

export function baueUmgebung(home, extra = {}) {
  const support = join(home, "support");
  const env = {
    PATH: process.env.PATH, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", TZ: "Europe/Berlin",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.org",
    ...extra,
  };
  for (const k of ["SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "XAUTHORITY"]) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

// → { app, fenster, home, support, vault, stopp }
export async function starteApp({ vault = undefined, mitVault = true, extra = {}, warteAufStudio = true } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "kortex-electron-")));
  mkdirSync(join(home, "support"), { recursive: true });
  let vaultDir = vault;
  if (mitVault && !vaultDir) vaultDir = baueVault().vault;
  const args = [HAUPT, ...(mitVault ? ["--vault", vaultDir] : [])];
  // Auf Linux-Runnern ohne eingerichteten Chromium-Sandbox-Helfer (SUID) startet Electron nur mit --no-sandbox: nur dort, nur mit ausdrücklichem Schalter (CI richtet sonst den Helfer ein)
  if (process.env.KORTEX_TEST_OHNE_SANDBOX === "1") args.unshift("--no-sandbox");
  const app = await electron.launch({ args, env: baueUmgebung(home, extra), timeout: 60_000 });
  const fenster = await app.firstWindow();
  if (warteAufStudio) await fenster.waitForFunction(() => window.__studioBereit === true, null, { timeout: 45_000 });
  const stopp = async () => {
    try { await app.close(); } catch { /* schon weg */ }
    try { rmSync(home, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Temp räumt das System */ }
  };
  return { app, fenster, home, support: join(home, "support"), vault: vaultDir, stopp };
}
