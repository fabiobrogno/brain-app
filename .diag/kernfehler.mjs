// Fehlerblöcke der Kern-Suite (spec-Reporter): node kernfehler.mjs <log> [Zeilen je Block]
import { readFileSync } from "node:fs";
const t = readFileSync(process.argv[2], "utf8").split("\n");
const n = Number(process.argv[3] || 9);
const start = t.findIndex((l) => l.startsWith("✖ failing tests:"));
if (start < 0) { console.log("keine roten Tests"); process.exit(0); }
const aus = [];
for (let i = start + 1; i < t.length; i++) {
  if (!t[i].startsWith("✖ ")) continue;
  const block = [t[i].slice(0, 110)];
  for (let k = i + 1; k < t.length && !t[k].startsWith("✖ ") && !t[k].startsWith("test at "); k++) {
    const s = t[k].trim();
    if (!s || /^at /.test(s) || /^(generatedMessage|code|operator|diff|expected|actual):/.test(s)) continue;
    block.push("   " + s.slice(0, 230));
    if (block.length > n) break;
  }
  aus.push(block.join("\n"));
}
console.log(aus.join("\n"));
