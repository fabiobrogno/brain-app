// Dauer je Test (TAP): node dauer.mjs <log> [Mindestdauer ms]
import { readFileSync } from "node:fs";
const t = readFileSync(process.argv[2], "utf8").split("\n");
const min = Number(process.argv[3] || 3000);
const aus = [];
for (let i = 0; i < t.length; i++) {
  const m = /^(not )?ok (\d+) - (.*)/.exec(t[i]);
  if (!m) continue;
  for (let k = i + 1; k < Math.min(i + 6, t.length); k++) {
    const d = /duration_ms: ([\d.]+)/.exec(t[k]);
    if (d) { if (Number(d[1]) >= min) aus.push(`${Math.round(Number(d[1]))} ms  ${m[1] ? "ROT " : ""}${m[3].slice(0, 110)}`); break; }
  }
}
console.log(aus.sort((a, b) => parseInt(b) - parseInt(a)).join("\n"));
