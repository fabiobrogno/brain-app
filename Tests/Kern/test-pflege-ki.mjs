// .tools/tests/test-pflege-ki.mjs — B3 Task 1: Sonnet-Argumente (Schutzgeländer §6.2), Aufruf im cwd mit Fake, Budget,
// ohne claude, drei Fehler in Folge, Haiku-Weitergabe an fake-claude, letztesJson, Pflege-Stand (Probe schreibt nie).
import { KERN } from "../pfade.mjs";
import { SONNET_BASH } from "../tageslauf/pflege-ki.mjs";
const BRAIN = `node "${KERN.split("\\").join("/")}/brain.mjs"`;   // der Befehl, den die KI ausführen darf (Kern liegt außerhalb der Kopie)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, fakeKi } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx } from "./pflege-hilfe.mjs";
const K = await import("../tageslauf/pflege-ki.mjs");
const S = await import("../tageslauf/pflege-stand.mjs");
isoliere();

// Die Pfadregeln selbst (Syntax, Verbote, Bash-Verengung, gepinnter Vault) prüft test-pflege-rechte.mjs.
test("sonnetArgs: eingebaut nur Lese-/Schreibwerkzeuge, Rechte nur unter der Kopie, dontAsk, keine MCP-Server, kein Sitzungsprotokoll", () => {
  const kopie = tempOrdner("kopie");
  const a = K.sonnetArgs("SYS", kopie);
  const w = (f) => a[a.indexOf(f) + 1];
  assert.equal(w("--model"), "sonnet");
  assert.equal(w("--tools"), "Read,Edit,Write,Glob,Grep,Bash");
  assert.ok(w("--allowedTools").startsWith("Read(//") && a.includes(`Bash(${SONNET_BASH[0]} *)`), "Pfadregeln statt nackter Werkzeuge");
  assert.ok(a.includes("WebFetch") && a.includes("WebSearch") && a.indexOf("WebFetch") > a.indexOf("--disallowedTools"));
  assert.equal(w("--permission-mode"), "dontAsk");
  assert.equal(w("--mcp-config"), '{"mcpServers":{}}');
  assert.equal(w("--system-prompt"), "SYS");
  assert.equal(w("--setting-sources"), "project");
  assert.equal(w("--max-turns"), "25", "Sonnet-Lauf ist auf 25 Runden begrenzt");
  assert.ok(Number(w("--max-budget-usd")) > 0, "und auf ein Dollar-Budget");
  for (const f of ["-p", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(a.includes(f), f);
  assert.ok(!a.some((x) => /bypass|dangerously/i.test(x)));
});

test("rufeSonnet: läuft im cwd der Arbeitskopie, Fake schreibt per Regel, Text und Tokens kommen zurück", async () => {
  const v = neuerPflegeVault();
  const kopie = tempOrdner("kopie");
  const f = fakeSonnet([{ wenn: "QUELLE: a.md", antwort: 'fertig {"ziel":"30_wissen/a.md"}', dateien: { "09_wiki/wissen/a.md": "neu\n" } }]);
  const ctx = pflegeCtx(v);
  const r = await K.rufeSonnet(ctx, { system: "SYS", eingabe: "QUELLE: a.md", cwd: kopie });
  assert.equal(r.text, 'fertig {"ziel":"30_wissen/a.md"}');
  assert.equal(readFileSync(join(kopie, "09_wiki", "wissen", "a.md"), "utf8"), "neu\n");
  assert.equal(realpathSync(f.aufrufe()[0].cwd), realpathSync(kopie));
  assert.ok(ctx.pflegeTokens.ein > 0 && ctx.pflegeTokens.aus > 0, "B3-Tokens getrennt gezählt");
  assert.deepEqual([ctx.tokens.ein, ctx.tokens.aus], [0, 0], "die B2-Zähler bleiben unberührt");
  assert.deepEqual(ctx.pflegeAufrufe, { sonnet: 1, haiku: 0 });
  assert.deepEqual(K.letztesJson(r.text), { ziel: "30_wissen/a.md" });
});

test("Budget: Sonnet-Deckel greift, dann { budget } ohne Aufruf", async () => {
  const v = neuerPflegeVault();
  const f = fakeSonnet([], { standard: "ok" });
  const ctx = pflegeCtx(v);
  ctx.pflegeBudget = K.neuesPflegeBudget({ sonnet: 1, haiku: 0, minuten: 40 });
  assert.equal(ctx.pflegeBudget.rest("sonnet"), 1);
  assert.equal((await K.rufeSonnet(ctx, { system: "S", eingabe: "x", cwd: tempOrdner("k") })).text, "ok");
  assert.equal(ctx.pflegeBudget.rest("sonnet"), 0);
  assert.deepEqual(await K.rufeSonnet(ctx, { system: "S", eingabe: "x", cwd: tempOrdner("k") }), { budget: true });
  assert.deepEqual(await K.pflegeHaiku(ctx, { system: "S", eingabe: "x" }), { budget: true });
  assert.equal(f.anzahl(), 1);
});

test("ohne claude → ohneKi; drei Fehler in Folge → ohneKi, danach kein Aufruf mehr", async () => {
  const v = neuerPflegeVault();
  const ohne = pflegeCtx(v, { claudeBefehl: null });
  assert.deepEqual(await K.rufeSonnet(ohne, { system: "S", eingabe: "x", cwd: tempOrdner("k") }), { ohneKi: true });
  const f = fakeSonnet([], { exit: 2 });
  const ctx = pflegeCtx(v);
  for (let i = 0; i < 3; i++) assert.ok((await K.rufeSonnet(ctx, { system: "S", eingabe: "x", cwd: tempOrdner("k") })).fehler);
  assert.equal(ctx.ohneKi, true);
  assert.deepEqual(await K.rufeSonnet(ctx, { system: "S", eingabe: "x", cwd: tempOrdner("k") }), { ohneKi: true });
  assert.equal(f.anzahl(), 3);
});

test("pflegeHaiku: Haiku-Aufruf geht über fake-sonnet an fake-claude (Regeln von fakeKi)", async () => {
  const v = neuerPflegeVault();
  fakeSonnet([]);
  const h = fakeKi([{ wenn: "AUSSAGE: Orion", antwort: '{"drin":"ja"}' }]);
  const ctx = pflegeCtx(v);
  assert.equal((await K.pflegeHaiku(ctx, { system: "Prüfe", eingabe: "AUSSAGE: Orion läuft" })).text, '{"drin":"ja"}');
  assert.equal(h.anzahl(), 1);
  assert.deepEqual(ctx.pflegeAufrufe, { sonnet: 0, haiku: 1 });
});

test("letztesJson: letztes Objekt, verschachtelt, Zaun, kein JSON", () => {
  assert.deepEqual(K.letztesJson('Erst {"a":1} dann ```json\n{"b":{"c":2}}\n```'), { b: { c: 2 } });
  assert.equal(K.letztesJson("kein json"), null);
  assert.equal(K.letztesJson("[1,2]"), null);
  assert.equal(K.letztesJson("{kaputt"), null);
});

test("Pflege-Stand: scharf geschrieben, Probe schreibt nie, kaputte Datei → {}", () => {
  const v = neuerPflegeVault();
  S.aendereStand(pflegeCtx(v, { probe: true }), (s) => { s.tag = "x"; });
  assert.equal(existsSync(S.STAND_DATEI(v)), false);
  S.aendereStand(pflegeCtx(v), (s) => { s.tag = "2026-10-22"; s.inbox = { "a.md": { versuche: 1 } }; });
  assert.deepEqual(S.leseStand(v), { tag: "2026-10-22", inbox: { "a.md": { versuche: 1 } } });
  writeFileSync(S.STAND_DATEI(v), "{kaputt");
  assert.deepEqual(S.leseStand(v), {});
});

test("Haiku-Aufruf: Cache-Lesen wird getrennt gezählt (Eingabe ohne Cache / Cache-Lesen / Ausgabe)", async () => {
  const v = neuerPflegeVault();
  fakeKi([{ wenn: "xxxx", antwort: '{"drin":"ja"}' }]);
  const ctx = pflegeCtx(v);
  const r = await K.pflegeHaiku(ctx, { system: "SYS", eingabe: "x".repeat(400) });
  assert.equal(r.text, '{"drin":"ja"}');
  assert.equal(ctx.pflegeTokens.cache, 100);
  assert.ok(ctx.pflegeTokens.ein >= 100 + 1 && ctx.pflegeTokens.aus > 0);
  assert.deepEqual(ctx.pflegeAufrufe, { sonnet: 0, haiku: 1 });
});
