// Konflikt-Ansicht über die Werkstatt, Teil 1: Ansicht, Lösen, Später, Marke des Studio-Abgleichs. Gemeinsame Hilfen: konflikt-werkstatt-hilfe.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, g, pfad, erzeugeHandler, kennung, wirft, mitRemote, commitIn, lies, loesen, konfliktAufbauen } from "./konflikt-werkstatt-hilfe.mjs";

test("Ansicht: beide Fassungen, Gerät und Zeit; die Zusammenführung bleibt dabei offen", async () => {
  const { a, v, e } = await konfliktAufbauen();
  assert.equal(e.status, 409); assert.equal(e.extra.konflikt, true);
  const r = await v.gitKonfliktAnsicht();
  assert.equal(r.aktiv, true); assert.equal(r.modus, "offen");
  assert.equal(r.geraet, "Fabios iPhone");
  assert.equal(r.dateien.length, 1);
  const d = r.dateien[0];
  assert.equal(d.pfad, "start.md"); assert.equal(d.typ, "text");
  assert.equal(d.meine.text, "# Start\nVersion von A\n"); assert.equal(d.andere.text, "# Start\nVersion von B\n");
  assert.ok(d.meine.zeit && d.andere.zeit);
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")));
  assert.equal(r.rueckgaengig.moeglich, false);
});

test("Ansicht ohne Konflikt: aktiv false", async () => {
  const { v } = mitRemote();
  const r = await v.gitKonfliktAnsicht();
  assert.equal(r.aktiv, false); assert.deepEqual(r.dateien, []);
});

test("Lösen: Entscheidung ist ein Eintrag im Verlauf, danach ist alles gesendet (auch ohne bestätigtes Ziel: der Studio-Abgleich sendet)", async () => {
  const { a, b, bare, v } = await konfliktAufbauen();
  const r = await loesen(v, [{ pfad: "start.md", wahl: "beide" }]);
  assert.equal(r.ok, true);
  assert.equal(r.kopien.length, 1);
  assert.equal(r.kopien[0].pfad, "start (Fabios iPhone).md");
  assert.equal(lies(a, "start (Fabios iPhone).md"), "# Start\nVersion von B\n");
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n");
  assert.equal(r.abgleich.ok, true, r.abgleich.text);
  assert.equal(g(bare, "rev-parse", "main").trim(), g(a, "rev-parse", "HEAD").trim(), "gesendet");
  assert.match(g(a, "log", "-1", "--format=%s").trim(), /^Konflikt gelöst: „Start“ – beide behalten/);
  assert.equal(g(a, "status", "--porcelain").trim(), "");
  g(b, "pull", "-q", "--ff-only");
  assert.equal(lies(b, "start (Fabios iPhone).md"), "# Start\nVersion von B\n");
  assert.equal((await v.gitStatus()).konflikt, null);
});

test("Später (Abbrechen): Arbeitsstand wie vorher; der Konflikt bleibt in der Statusanzeige (Kern-Vermerk)", async () => {
  const { a, v } = await konfliktAufbauen();
  const r = await v.gitKonfliktAbbrechen();
  assert.equal(r.ok, true); assert.equal(r.offen, true);
  assert.equal(existsSync(join(a, ".git", "MERGE_HEAD")), false);
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n");
  const s = await v.gitStatus();
  assert.equal(s.sicherungStand, "konflikt");
  assert.deepEqual(s.sicherungDateien, ["start.md"]);
  assert.equal((await v.gitKonfliktAbbrechen()).offen, false, "zweimal ist harmlos");
});

test("Der Studio-Abgleich markiert nur die Zusammenführung, die er SELBST begonnen hat", async () => {
  const { a, b, v } = mitRemote();
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  commitIn(a, "start.md", "# Start\nA\n", "A");
  const e = await wirft(v.gitSync({ konflikteLoesen: true }));
  assert.equal(e.extra.gestartet, true);
  assert.equal((await v.gitKonfliktAnsicht()).fremd, false);
  assert.equal((await v.gitKonfliktAbbrechen()).offen, true);
});

