// Konflikt-Ansicht über die Werkstatt, Teil 4: Umstellung, fehlendes Ziel, fremde Zusammenführung. Hilfen: konflikt-werkstatt-hilfe.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, g, pfad, erzeugeHandler, kennung, wirft, mitRemote, commitIn, lies, loesen, konfliktAufbauen } from "./konflikt-werkstatt-hilfe.mjs";

test("Umstellung (Phase B) läuft: Abgleich, Lösen, Später und Rückgängig melden 409 „Kortex räumt gerade auf“, die Ansicht bleibt lesbar", async () => {
  const { a, v } = await konfliktAufbauen();
  mkdirSync(join(a, ".logs"), { recursive: true });
  const sperre = join(a, ".logs", "umstellung-phase-b.lock");
  writeFileSync(sperre, JSON.stringify({ pid: process.pid, zeit: new Date().toISOString() }));
  for (const f of [() => v.gitSync({}), () => v.gitKonfliktLoesen({ auswahl: [{ pfad: "start.md", wahl: "meine" }], gesehen: {} }), () => v.gitKonfliktAbbrechen(), () => v.gitKonfliktRueckgaengig()]) {
    const e = await wirft(f()); assert.equal(e.status, 409); assert.match(e.message, /räumt gerade/);
  }
  assert.equal((await v.gitKonfliktAnsicht()).aktiv, true);
  writeFileSync(sperre, JSON.stringify({ pid: process.pid, zeit: new Date(Date.now() - 2 * 3600_000).toISOString() })); // zu alt: zählt nicht
  assert.equal((await loesen(v, [{ pfad: "start.md", wahl: "meine" }])).ok, true);
});

test("Ohne bestätigtes Ziel sendet das Lösen nicht (nur ein Hinweis), auch nicht über den Studio-Abgleich — dieselbe Regel wie bei der Sicherung", async () => {
  const { a, bare, v } = await konfliktAufbauen({ bestaetigt: false });
  const vorher = g(bare, "rev-parse", "main").trim();
  const r = await loesen(v, [{ pfad: "start.md", wahl: "meine" }]);
  assert.equal(r.ok, true);
  assert.equal(r.abgleich.art, "nicht-bestaetigt"); assert.equal(r.abgleich.ok, false);
  assert.equal(g(bare, "rev-parse", "main").trim(), vorher, "nichts gesendet");
  assert.equal(g(a, "status", "--porcelain").trim(), "");
});

test("K-neu-1: eine schon offene Zusammenführung aus dem Terminal (mit Handarbeit) wird vom Studio-Abgleich oder „Jetzt sichern“ NIE markiert — Später ist 409, die Handarbeit bleibt", async () => {
  const { a, b, v } = mitRemote();
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  commitIn(a, "start.md", "# Start\nA\n", "A");
  g(a, "fetch", "-q", "origin");
  assert.throws(() => g(a, "merge", "--no-edit", "origin/main")); // im Terminal begonnen
  schreibe(a, "start.md", "# Start\nim Terminal von Hand gelöst\n");
  // „Abgleichen“ in der Oberfläche (Palette, Statusleiste): die 409 kommt von der schon offenen Zusammenführung, nicht von einem eigenen Start
  const e = await wirft(v.gitSync({ konflikteLoesen: true }));
  assert.equal(e.status, 409); assert.equal(e.extra.konflikt, true); assert.notEqual(e.extra.gestartet, true);
  // „Jetzt sichern“
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: ["start.md"] }))).status, 409);
  const an = await v.gitKonfliktAnsicht();
  assert.equal(an.fremd, true);
  assert.equal((await wirft(loesen(v, [{ pfad: "start.md", wahl: "meine" }]))).extra.art, "fremd");
  assert.equal((await wirft(v.gitKonfliktAbbrechen())).extra.art, "fremd");
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")));
  assert.equal(lies(a, "start.md"), "# Start\nim Terminal von Hand gelöst\n");
});

