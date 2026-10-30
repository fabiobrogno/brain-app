// Umstellung P7c: die zwei neuen Routen der Werkstatt für die Oberfläche (Protokoll zeigen, Kopie jetzt löschen) und die neuen Felder (stand.kopien). Wie umstellung-phase-a.test.mjs:
// Starter → brain.mjs umstellung …, nur Wegwerf-Ordner (eigenes HOME, eigener Support-Ordner, eigene globale git-Konfiguration), launchctl/claude/codex nur als Attrappe.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync, rmSync, symlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pfad } from "./hilfe.mjs";
import { altvault, GEHEIM } from "../Kern/fixture-altvault.mjs";

const MERKEN = ["HOME", "KORTEX_KERN_UNSTABIL_ERLAUBT", "KORTEX_KERN_TEMP_WURZELN", "KORTEX_KERN_PFAD", "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "KORTEX_CODEX_PROGRAMM", "GIT_CONFIG_GLOBAL", "BRAIN_APP_SUPPORT", "KORTEX_VAULT_VERTRAUT",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "FAKE_LAUNCHCTL_LOG", "FAKE_MCP_LOG", "CLAUDE_CONFIG_DIR", "KORTEX_DIENST_PLATTFORM"];
const fake = (n) => pfad("..", "Tests", "Kern", n);
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erlaube } = await import(pfad("gemeinsam", "vertrauen.mjs"));
const { kennung } = await import(pfad("kern", "umstellung", "ziele.mjs"));
const q = (p) => `'${String(p).replaceAll("'", "'\\''")}'`;

const aufruf = (h) => async (methode, p, body) => {
  const r = await h({ methode, pfad: p, query: null, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* kein JSON */ }
  return { ...r, j, roh: r.body.toString("utf8") };
};
function mitFixture(faelle) {
  const a = altvault({ faelle });
  const gespeichert = Object.fromEntries(MERKEN.map((k) => [k, process.env[k]]));
  const hooks = join(a.support, "bin", "kern", "git-hooks");
  rmSync(hooks, { recursive: true, force: true });
  symlinkSync(pfad("kern", "git-hooks"), hooks);
  const global = join(a.basis, "gitconfig-global");
  writeFileSync(global, "[user]\n\tname = T\n\temail = t@example.org\n");
  const starter = join(a.basis, "starter.sh");
  writeFileSync(starter, `#!/bin/sh\nKORTEX_KERN_PFAD=${q(join(a.support, "bin", "kern"))}\nexport KORTEX_KERN_PFAD\nexec ${q(process.execPath)} ${q(pfad("kern", "brain.mjs"))} "$@"\n`);
  chmodSync(starter, 0o755);
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.KORTEX_VAULT_VERTRAUT;
  erlaube(a.vault, { support: a.support, quelle: "geklont" });
  Object.assign(process.env, {
    HOME: a.home, KORTEX_DIENST_PLATTFORM: "darwin", KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_KERN_TEMP_WURZELN: "", BRAIN_APP_SUPPORT: a.support, GIT_CONFIG_GLOBAL: global,
    BRAIN_LAUNCHCTL: fake("fake-launchctl.mjs"), FAKE_LAUNCHCTL_LOG: join(a.basis, "launchctl.log"), FAKE_MCP_LOG: join(a.basis, "mcp.log"),
    BRAIN_CLAUDE: fake("fake-claude-mcp.mjs"), KORTEX_CODEX_PROGRAMM: fake("fake-codex-mcp.mjs"),
    GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org",
  });
  delete process.env.KORTEX_KERN_PFAD;
  const rufe = aufruf(erzeugeHandler({ vault: a.vault, vaultOptionen: { support: a.support }, starter }));
  return { a, rufe, weg: () => { for (const [k, v] of Object.entries(gespeichert)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } a.weg(); } };
}

test("Protokoll-Route: leer vor dem ersten Schritt, danach Zeilen ohne Werte und ohne Home-Pfad; falsche Methode → 405", async () => {
  const f = mitFixture(["kit-versioniert", "hooks-alt-sh"]);
  try {
    const leer = await f.rufe("GET", "/api/umstellung/protokoll");
    assert.equal(leer.status, 200, leer.roh);
    assert.deepEqual(leer.j.zeilen, []);
    assert.equal(leer.j.datei, "protokoll.jsonl");
    const p = await f.rufe("POST", "/api/umstellung/probelauf", { bestaetigt: true });
    assert.equal(p.status, 200, p.roh);
    const r = await f.rufe("GET", "/api/umstellung/protokoll");
    assert.equal(r.status, 200, r.roh);
    assert.ok(r.j.zeilen.length > 3, "der Probelauf hat protokolliert");
    for (const z of r.j.zeilen) {
      assert.deepEqual(Object.keys(z).filter((k) => !["zeit", "lauf", "schritt", "ereignis", "anzahl", "grund"].includes(k)), [], "nur erlaubte Felder");
      assert.ok(["probe", "original"].includes(z.lauf));
    }
    assert.ok(!r.roh.includes(GEHEIM) && !r.roh.includes(f.a.home), "kein Wert, kein Home-Pfad");
    assert.equal(r.j.ordner, join(f.a.support, "umstellung", kennung(f.a.vault)), "der Ablageort im Support-Ordner (liegt er unter dem Home-Ordner, steht er mit ~)");
    assert.equal((await f.rufe("POST", "/api/umstellung/protokoll", {})).status, 405);
  } finally { f.weg(); }
});

test("Kopie jetzt löschen: stand.kopien zählt, ohne bestaetigt nur Plan, mit bestaetigt gelöscht; Fremdes bleibt", async () => {
  const f = mitFixture(["kit-versioniert"]);
  const k = kennung(f.a.vault);
  const meine = join(tmpdir(), `kortex-probelauf-${k}-TeSt${process.pid}`);
  const fremd = join(tmpdir(), `kortex-probelauf-ffffffffffffffff-TeSt${process.pid}`);
  try {
    mkdirSync(join(meine, "vault"), { recursive: true });
    mkdirSync(fremd, { recursive: true });
    assert.equal((await f.rufe("GET", "/api/umstellung/stand")).j.kopien, 1);
    for (const body of [{}, { bestaetigt: "ja" }, { bestaetigt: 1 }]) {
      const plan = await f.rufe("POST", "/api/umstellung/kopie-loeschen", body);
      assert.equal(plan.status, 200, plan.roh);
      assert.equal(plan.j.plan, true);
      assert.equal(plan.j.anzahl, 1);
      assert.ok(existsSync(meine), "ohne ausdrückliches true wird nichts gelöscht");
    }
    assert.equal((await f.rufe("POST", "/api/umstellung/kopie-loeschen", [])).status, 400);
    assert.equal((await f.rufe("GET", "/api/umstellung/kopie-loeschen")).status, 405);
    const weg = await f.rufe("POST", "/api/umstellung/kopie-loeschen", { bestaetigt: true });
    assert.equal(weg.status, 200, weg.roh);
    assert.deepEqual({ geloescht: weg.j.geloescht, uebrig: weg.j.uebrig }, { geloescht: 1, uebrig: 0 });
    assert.ok(!existsSync(meine));
    assert.ok(existsSync(fremd), "die Kopie eines anderen Vaults bleibt");
    assert.ok(existsSync(join(f.a.vault, "brain.config.json")), "das Original bleibt");
    assert.equal((await f.rufe("GET", "/api/umstellung/stand")).j.kopien, 0);
  } finally { rmSync(meine, { recursive: true, force: true }); rmSync(fremd, { recursive: true, force: true }); f.weg(); }
});
