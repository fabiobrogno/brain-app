// Fasst ein TAP-Log zusammen: je rotem Test Datei, Name, Fehlertext (gekürzt)
import { readFileSync } from "node:fs";
const t = readFileSync(process.argv[2], "utf8").split("\n");
const maxLen = Number(process.argv[3] || 260);
let n = 0;
for (let i = 0; i < t.length; i++) {
  const m = /^not ok (\d+) - (.*)/.exec(t[i]);
  if (!m || /\.mjs$/.test(m[2])) continue;
  n++;
  let f = "", e = "";
  for (let k = i + 1; k < Math.min(i + 40, t.length); k++) {
    if (/^(# Subtest|not ok|ok )/.test(t[k])) break;
    const mm = /([\w-]+\.mjs):(\d+)/.exec(t[k]);
    if (/location:/.test(t[k]) && mm) f = mm[1] + ":" + mm[2];
    if (t[k].startsWith("  error:")) {
      if (/\|-\s*$/.test(t[k])) e = t.slice(k + 1, k + 14).filter((x) => !/^\s*(code|name|expected|actual|operator):/.test(x) && x.trim()).map((x) => x.trim()).join(" / ");
      else e = t[k].slice(9);
      break;
    }
  }
  console.log(`${m[1]} ${f} | ${m[2].slice(0, 60)} || ${e.slice(0, maxLen)}`);
}
console.log("ROT:", n);
