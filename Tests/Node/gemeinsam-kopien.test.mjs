// Die Studio-Kopien der gemeinsamen Module (zeit, wikilink, kurzformen) müssen zur Quelle in Ressourcen/gemeinsam passen — das Studio lädt nur aus
// seinem eigenen Ordner. Erzeugt von scripts/erzeuge-gemeinsam-kopien.mjs; wer eine Quelle ändert, führt es aus.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WURZEL } from "./hilfe.mjs";

const SKRIPT = join(WURZEL, "..", "scripts", "erzeuge-gemeinsam-kopien.mjs");
const { MODULE, baueKopie, ziel } = await import(SKRIPT);

test("erzeugte Studio-Kopien passen zu den Quellen (node scripts/erzeuge-gemeinsam-kopien.mjs --pruefen)", () => {
  execFileSync(process.execPath, [SKRIPT, "--pruefen"], { stdio: "pipe" });
});

test("jede Kopie trägt den Hinweis „ERZEUGT“, und die Importe zeigen auf Kopien (.js) statt auf Quellen (.mjs)", () => {
  assert.deepEqual(MODULE, ["zeit", "wikilink", "kurzformen"]);
  for (const name of MODULE) {
    const kopie = readFileSync(ziel(name), "utf8");
    assert.equal(kopie, baueKopie(name));
    assert.match(kopie, /^\/\/ ERZEUGT von scripts\/erzeuge-gemeinsam-kopien\.mjs aus Ressourcen\/gemeinsam\/.+\.mjs — nicht von Hand ändern\./);
    assert.doesNotMatch(kopie, /from\s+"\.\/[\w-]+\.mjs"/, `${name}: Import auf .mjs`);
  }
});

test("die gemeinsamen Module hängen nur voneinander ab (laufen im Browser, in der Werkstatt und im MCP-Server)", () => {
  for (const name of MODULE) {
    const imports = [...readFileSync(join(WURZEL, "gemeinsam", `${name}.mjs`), "utf8").matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    for (const i of imports) assert.match(i, /^\.\/(zeit|wikilink|kurzformen)\.mjs$/, `${name} importiert ${i}`);
  }
});
