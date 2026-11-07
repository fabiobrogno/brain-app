// Vorschau der Electron-Hülle (scripts/vorschau-electron.sh, Paket W2c) mit der ECHTEN App: Ordner entsteht, die App startet mit Support-Ordner und HOME darin, beim Beenden
// verschwindet der Ordner. Mit KORTEX_PAKET_PROGRAMM startet das Skript die gebaute App (`--paket`), sonst die Hülle aus dem Quelltext. Nur Linux/macOS (POSIX-Pfade).
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skip(process.platform === "win32", "Windows: keine Vorschau (POSIX-Pfade)");
const SKRIPT = new URL("../../scripts/vorschau-electron.sh", import.meta.url).pathname;
const PAKET = process.env.KORTEX_PAKET_PROGRAMM;
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));

test("Vorschau: eigener Ordner mit Support und HOME, die App läuft darin, nach dem Beenden ist nichts mehr da", async () => {
  const basis = realpathSync(mkdtempSync(join(tmpdir(), "kortex-vorschau-test-")));
  const env = { PATH: process.env.PATH, HOME: basis, TMPDIR: basis, ...Object.fromEntries(["DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
  const args = [SKRIPT, ...(PAKET ? ["--paket", PAKET] : []), ...(process.env.KORTEX_TEST_OHNE_SANDBOX === "1" ? ["--no-sandbox"] : [])];
  const p = spawn("bash", args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let fehler = "";
  p.stderr.on("data", (b) => { fehler += b; });
  const ende = new Promise((ok) => p.on("exit", (code, signal) => ok({ code, signal })));
  try {
    // der Ordner entsteht, die App legt ihr Protokoll im Support-Ordner der Vorschau ab
    let ordner = null, log = null;
    for (let i = 0; i < 120 && !log; i++) {
      await warte(500);
      ordner = readdirSync(basis).find((n) => n.startsWith("kortex-vorschau-"));
      if (ordner && existsSync(join(basis, ordner, "support", "electron", "huelle.log"))) log = join(basis, ordner, "support", "electron", "huelle.log");
    }
    expect(log, `kein Protokoll der App; Ausgabe: ${fehler.slice(-600)}`).toBeTruthy();
    const o = join(basis, ordner);
    expect(existsSync(join(o, ".kortex-vorschau"))).toBe(true);
    expect(existsSync(join(o, "home"))).toBe(true);
    if (PAKET) { // das Paket legt sein Node und den Kern im Support-Ordner der Vorschau ab
      for (let i = 0; i < 60 && !/laufzeit node/.test(readFileSync(log, "utf8")); i++) await warte(500);
      expect(readFileSync(log, "utf8")).toMatch(/laufzeit node v\d+\.\d+\.\d+ kern ja/);
      expect(existsSync(join(o, "support", "bin", "node"))).toBe(true);
    }
    // beenden wie Strg-C: Ordner weg
    p.kill("SIGTERM");
    const r = await Promise.race([ende, warte(30_000).then(() => "zeit")]);
    expect(r, "das Skript beendet sich nicht").not.toBe("zeit");
    expect(existsSync(o)).toBe(false);
  } finally {
    if (p.exitCode === null) p.kill("SIGKILL");
    rmSync(basis, { recursive: true, force: true, maxRetries: 3 });
  }
});
