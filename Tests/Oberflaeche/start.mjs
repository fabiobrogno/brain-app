// Startet entwicklung.mjs für einen Vault und liefert die Adresse.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function starteServer(vault) {
  return new Promise((ok, nein) => {
    const p = spawn(process.execPath, [join(wurzel, "Ressourcen/werkstatt/entwicklung.mjs"), vault, "0"], { stdio: ["ignore", "pipe", "pipe"] });
    let puffer = "";
    const frist = setTimeout(() => nein(new Error("Server startet nicht: " + puffer)), 10000);
    const lies = (d) => { puffer += d; const m = /Bereit: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(puffer); if (m) { clearTimeout(frist); ok({ url: m[1], stopp: () => p.kill() }); } };
    p.stdout.on("data", lies); p.stderr.on("data", lies);
    p.on("exit", (c) => nein(new Error("Server beendet: " + c + " " + puffer)));
  });
}
