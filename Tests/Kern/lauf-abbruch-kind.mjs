// .tools/tests/lauf-abbruch-kind.mjs — Hilfsprozess für test-tageslauf-aktionen-frueh.mjs (kein Test, wird nicht von run-all gestartet):
// führt einen scharfen Tageslauf mit der Fake-KI aus und stirbt hart (SIGKILL — kein finally, kein exit-Handler) in dem Augenblick,
// in dem der Lauf NACH dem Merge den ersten übernommenen Vorschlag ins Archiv „vorschlaege-uebernommen“ verschieben will.
// Aufruf: node lauf-abbruch-kind.mjs <vault> <jetzt-ms>. Ruft nie das echte claude (BRAIN_CLAUDE zeigt auf fake-claude).
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const [vault, jetzt] = process.argv.slice(2);
const hier = dirname(fileURLToPath(import.meta.url));
const echt = fs.writeFileSync;
fs.writeFileSync = function (pfad, ...rest) {
  if (String(pfad).includes("vorschlaege-uebernommen")) process.kill(process.pid, "SIGKILL");
  return echt.call(this, pfad, ...rest);
};
syncBuiltinESMExports();   // die benannten Importe (writeFileSync) der danach geladenen Module sehen die Ersatzfunktion
const { tageslauf } = await import(pathToFileURL(join(hier, "..", "tageslauf.mjs")).href);
await tageslauf(vault, { claudeBefehl: { befehl: process.execPath, args: [join(hier, "fake-claude.mjs")] }, jetzt: Number(jetzt) });
process.exit(0);   // wird nur erreicht, wenn der Haken nie ausgelöst hat
