// .tools/tests/traum-baum-dump.mjs — Testhelfer (KEIN Test): wird vom Fake-Sonnet im Arbeitsordner des Traums gestartet und schreibt Dateinamen und Inhalt
// des ganzen Baums nach <argv[2]> — so prüft test-traum.mjs, was die KI überhaupt zu sehen bekommt.
import { readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

const dateien = [];
let inhalt = "";
const gang = (rel) => {
  for (const n of readdirSync(join(process.cwd(), rel))) {
    const r = rel ? `${rel}/${n}` : n;
    if (lstatSync(join(process.cwd(), r)).isDirectory()) gang(r);
    else { dateien.push(r); inhalt += `${r}\n${readFileSync(join(process.cwd(), r), "utf8")}\n`; }
  }
};
gang("");
let memory = "";
try { memory = readFileSync(join(process.cwd(), "gedaechtnis", "MEMORY.md"), "utf8"); } catch { /* keine */ }
writeFileSync(process.argv[2], JSON.stringify({ dateien, inhalt, memory }));
