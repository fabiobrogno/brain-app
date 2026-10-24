// Startet entwicklung.mjs für einen Vault und liefert die Adresse.
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
// BRAIN_WURZEL: alternative Wurzel mit Ressourcen/werkstatt (z. B. fester Backend-Stand), sonst dieses Repo
const wurzel = process.env.BRAIN_WURZEL || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Vertrauen v2 (Spec §8): der Merker braucht Ordner-Kennung und Code-Fingerabdruck. Die rechnet das Backend selbst aus (erlaube),
// geschrieben wird nur in den übergebenen Support-Ordner. Ein älterer Backend-Stand (BRAIN_WURZEL) kennt nur { seit }.
export async function erteileVertrauen(vault, support) {
  try {
    const m = await import(pathToFileURL(join(wurzel, "Ressourcen/gemeinsam/vertrauen.mjs")).href);
    if (typeof m.erlaube === "function") { m.erlaube(vault, { support }); return; }
  } catch { /* älterer Backend-Stand */ }
  writeFileSync(join(support, "vertrauen.json"), JSON.stringify({ [realpathSync(vault)]: { seit: new Date().toISOString() } }));
}
// Eigener Support-Ordner je Server (nie der echte). Standard: Vault ist vertraut (Kit läuft); { vertraut: false } = unvertraut.
export async function starteServer(vault, { vertraut = true } = {}) {
  const support = mkdtempSync(join(tmpdir(), "brain-ui-support-"));
  if (vertraut) await erteileVertrauen(vault, support);
  return new Promise((ok, nein) => {
    const p = spawn(process.execPath, [join(wurzel, "Ressourcen/werkstatt/entwicklung.mjs"), vault, "0"],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1" } });
    let puffer = "";
    const frist = setTimeout(() => nein(new Error("Server startet nicht: " + puffer)), 10000);
    const lies = (d) => { puffer += d; const m = /Bereit: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(puffer); if (m) { clearTimeout(frist); ok({ url: m[1], stopp: () => p.kill() }); } };
    p.stdout.on("data", lies); p.stderr.on("data", lies);
    p.on("exit", (c) => nein(new Error("Server beendet: " + c + " " + puffer)));
  });
}
