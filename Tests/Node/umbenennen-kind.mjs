// Kindprozess für umbenennen-papierkorb.test.mjs: führt EINE Aktion aus und beendet sich an einem benannten Punkt mit SIGKILL (echter Absturz, kein Aufräumen).
// argv[2] = JSON { vault, support, methode, eingabe, punkt }. Weigert sich, außerhalb des Temp-Ordners zu arbeiten.
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const a = JSON.parse(process.argv[2]);
const TEMP = realpathSync(tmpdir());
for (const p of [a.vault, a.support]) {
  if (!realpathSync(p).startsWith(TEMP + "/")) { console.error("Kind: Pfad außerhalb des Temp-Ordners: " + p); process.exit(9); }
}
const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Ressourcen");
const { oeffneVault } = await import(pathToFileURL(join(wurzel, "gemeinsam", "vault.mjs")).href);
const haken = { punkt: (n) => { if (n === a.punkt) process.kill(process.pid, "SIGKILL"); } };
const v = oeffneVault(a.vault, { support: a.support, dateiHaken: haken });
await v[a.methode](a.eingabe);
process.exit(0);
