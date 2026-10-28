// .tools/tests/test-pflege-einheit.mjs — B3 Task 2: Pflege-Einheit in der Arbeitskopie: ein Commit je Einheit, rev+1, _log oben,
// Verwerfen bei Diff-Befund / pre-commit rot / Arbeit gescheitert (Arbeitskopie danach sauber), Wächter „Vault verändert",
// ff-Merge nur scharf, doppelte IDs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, neuerTestVault, seitenText, JETZT } from "./tageslauf-hilfe.mjs";
const P = await import("../tageslauf/pflege-kopie.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { neuerLauf } = await import("../tageslauf/protokoll.mjs");
isoliere();

const SEITE = "09_wiki/wissen/orion.md";
const RUMPF = `# Orion\n\n${Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1}.`).join("\n")}\n`;
function aufbau(fm = {}) {
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion", ...fm }, rumpf: RUMPF }) } });
  const ctx = neuerLauf(v, { jetzt: JETZT, claudeBefehl: null });
  return { v, ctx, kopie: P.legePflegeKopieAn(v, ctx.lauf) };
}
const haengeAn = (wurzel, rel, text) => writeFileSync(join(wurzel, rel), readFileSync(join(wurzel, rel), "utf8") + text);
const sauber = (kopie) => assert.equal(git(kopie.pfad, "status", "--porcelain", "--ignored"), "");

test("gute Einheit: ein Commit mit pflege-Betreff, rev+1, _log-Eintrag oben; main erst nach uebernehmePflege", async () => {
  const { v, ctx, kopie } = aufbau();
  const vorher = git(v, "rev-parse", "HEAD");
  const e = await P.einheit(ctx, kopie, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
    arbeit: async (p) => { haengeAn(p, SEITE, "Neu: Orion nutzt Redis.\n"); return { ok: true, info: { x: 1 } }; } });
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.deepEqual(e.seiten, [SEITE]);
  assert.deepEqual(e.info, { x: 1 });
  assert.match(git(kopie.pfad, "log", "-1", "--format=%s"), /^pflege\(\d{8}-\d{6}\): inbox notiz-a\.md \[inbox-notiz-a\]$/);
  assert.match(readFileSync(join(kopie.pfad, SEITE), "utf8"), /^rev: 2$/m);
  assert.match(readFileSync(join(kopie.pfad, "09_wiki/_log.md"), "utf8"),
    /\n## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — pflege\(\d{8}-\d{6}\): Inbox eingearbeitet: notiz-a\.md\n- Seiten geändert\/neu: wissen\/orion\.md\n[\s\S]*## 2026-01-01 10:00 — start/);
  assert.equal(git(v, "rev-parse", "HEAD"), vorher);
  const m = P.uebernehmePflege(ctx, kopie);
  assert.equal(m.ok, true);
  assert.equal(m.commits.get("inbox-notiz-a"), git(v, "rev-parse", "HEAD"));
  verwerfeArbeitskopie(v, kopie);
});

test("Löschen → diff-rot, Arbeitskopie sauber und die Seite wieder da", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "kons-orion", art: "konsolidieren", titel: "orion",
    arbeit: async (p) => { rmSync(join(p, SEITE)); return { ok: true }; } });
  assert.equal(e.grund, "diff-rot");
  assert.deepEqual(e.befunde.map((b) => b.regel), ["geloescht"]);
  assert.ok(existsSync(join(kopie.pfad, SEITE)));
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test(".tools-Datei → Integrität verletzt (Härtung: Werkzeug-Code der Kopie), kritische Seite → diff-rot", async () => {
  let { v, ctx, kopie } = aufbau();
  let e = await P.einheit(ctx, kopie, { id: "inbox-a", art: "inbox", titel: "a",
    arbeit: async (p) => { mkdirSync(join(p, ".tools"), { recursive: true }); writeFileSync(join(p, ".tools", "neu.mjs"), "x\n"); return { ok: true }; } });
  assert.equal(e.grund, "integritaet-verletzt");
  assert.deepEqual(e.befunde.map((b) => [b.regel, b.meldung]), [["integritaet", "Integrität verletzt: Arbeitskopie/.tools/neu.mjs"]]);
  assert.equal(ctx.pflegeStopp, true);
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
  ({ v, ctx, kopie } = aufbau({ kritisch: true }));
  e = await P.einheit(ctx, kopie, { id: "inbox-b", art: "inbox", titel: "b", arbeit: async (p) => { haengeAn(p, SEITE, "x\n"); return { ok: true }; } });
  assert.deepEqual(e.befunde.map((b) => b.regel), ["kritisch"]);
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test("arbeit schreibt in den echten Vault → Integrität verletzt (vorher: vault-veraendert), Pflege stoppt, nichts committed", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "inbox-c", art: "inbox", titel: "c",
    arbeit: async (p) => { haengeAn(p, SEITE, "x\n"); haengeAn(v, SEITE, "von außen\n"); return { ok: true }; } });
  assert.equal(e.grund, "integritaet-verletzt");
  assert.ok(e.befunde.some((b) => b.meldung === `Integrität verletzt: ${SEITE}`), JSON.stringify(e.befunde));
  assert.equal(ctx.pflegeStopp, true);
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test("pre-commit rot → pruefung-rot mit Befund; arbeit scheitert → Grund durchgereicht; nichts geändert → unveraendert", async () => {
  const { v, ctx, kopie } = aufbau();
  let e = await P.einheit(ctx, kopie, { id: "inbox-d", art: "inbox", titel: "d", arbeit: async (p) => { haengeAn(p, SEITE, "VERBOTEN\n"); return { ok: true }; } });
  assert.equal(e.grund, "pruefung-rot");
  assert.match(e.befunde[0].meldung, /SECRETS/);
  sauber(kopie);
  e = await P.einheit(ctx, kopie, { id: "inbox-e", art: "inbox", titel: "e", arbeit: async (p) => {
    mkdirSync(join(p, "00_inbox"), { recursive: true }); writeFileSync(join(p, "00_inbox", "x.md"), "x"); haengeAn(p, SEITE, "y\n");
    return { ok: false, grund: "ki-nichts", befunde: [{ pfad: "x", regel: "ki", meldung: "nichts" }] }; } });
  assert.equal(e.grund, "ki-nichts");
  assert.equal(existsSync(join(kopie.pfad, "00_inbox", "x.md")), false);
  sauber(kopie);
  e = await P.einheit(ctx, kopie, { id: "inbox-f", art: "inbox", titel: "f", arbeit: async () => ({ ok: true }) });
  assert.equal(e.grund, "unveraendert");
  verwerfeArbeitskopie(v, kopie);
});

test("zwei Einheiten, die zweite rot: der erste Commit bleibt, der Merge bringt genau ihn; doppelte ID → -2", async () => {
  const { v, ctx, kopie } = aufbau();
  const a = await P.einheit(ctx, kopie, { id: "inbox-g", art: "inbox", titel: "g", arbeit: async (p) => { haengeAn(p, SEITE, "eins\n"); return { ok: true }; } });
  const b = await P.einheit(ctx, kopie, { id: "inbox-g", art: "inbox", titel: "g2", arbeit: async (p) => { rmSync(join(p, SEITE)); return { ok: true }; } });
  assert.equal(a.ok, true);
  assert.equal(b.id, "inbox-g-2");
  assert.equal(b.ok, false);
  const m = P.uebernehmePflege(ctx, kopie);
  assert.deepEqual([...m.commits.keys()], ["inbox-g"]);
  assert.match(readFileSync(join(v, SEITE), "utf8"), /eins\n$/);
  verwerfeArbeitskopie(v, kopie);
});

test("Probe: uebernehmePflege merged nie", async () => {
  const { v, ctx, kopie } = aufbau();
  ctx.probe = true;
  await P.einheit(ctx, kopie, { id: "inbox-h", art: "inbox", titel: "h", arbeit: async (p) => { haengeAn(p, SEITE, "x\n"); return { ok: true }; } });
  const vorher = git(v, "rev-parse", "HEAD");
  assert.deepEqual({ ...P.uebernehmePflege(ctx, kopie), commits: null }, { ok: false, grund: "probe", commits: null });
  assert.equal(git(v, "rev-parse", "HEAD"), vorher);
  verwerfeArbeitskopie(v, kopie);
});

test("vaultZustand: .logs, Inbox und Archiv zählen nicht, Wiki schon; sammleDiff liefert alt aus HEAD", () => {
  const { v, kopie } = aufbau();
  const z = P.vaultZustand(v);
  mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", "x"), "1");
  mkdirSync(join(v, "00_inbox"), { recursive: true }); writeFileSync(join(v, "00_inbox", "neu.md"), "1");
  assert.equal(P.vaultZustand(v), z);
  haengeAn(v, SEITE, "x\n");
  assert.notEqual(P.vaultZustand(v), z);
  haengeAn(kopie.pfad, SEITE, "neu\n");
  writeFileSync(join(kopie.pfad, "09_wiki", "wissen", "tee mit leer.md"), "t\n");
  const d = P.sammleDiff(v, kopie).sort((a, b) => a.pfad.localeCompare(b.pfad));
  assert.deepEqual(d.map((x) => [x.pfad, x.status]), [[SEITE, "geaendert"], ["09_wiki/wissen/tee mit leer.md", "neu"]]);
  assert.equal(d[0].alt, readFileSync(join(v, SEITE), "utf8").replace(/x\n$/, ""));
  verwerfeArbeitskopie(v, kopie);
});
