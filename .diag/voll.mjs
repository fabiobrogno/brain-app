// Gibt von jedem roten Test den rohen TAP-Block aus (gekürzt): node voll.mjs <log> [Zeilen] [Breite]
import { readFileSync } from "node:fs";
const t = readFileSync(process.argv[2], "utf8").split("\n");
const zeilen = Number(process.argv[3] || 30), breite = Number(process.argv[4] || 300);
for (let i = 0; i < t.length; i++) {
  const m = /^not ok (\d+) - (.*)/.exec(t[i]);
  if (!m || /\.mjs$/.test(m[2])) continue;
  console.log(`===== ${m[1]} ${m[2].slice(0, 80)}`);
  let n = 0;
  for (let k = i + 1; k < t.length && n < zeilen; k++, n++) {
    if (/^(# Subtest|not ok|ok )/.test(t[k])) break;
    if (/^\s*(duration_ms|type|failureType|code|name|operator):/.test(t[k])) continue;
    console.log(t[k].slice(0, breite));
  }
}
