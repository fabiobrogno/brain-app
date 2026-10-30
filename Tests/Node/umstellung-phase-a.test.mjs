// Umstellung P7b: die Routen der Werkstatt für Probelauf, Phase A und Rückweg reichen den Kern durch (Starter → brain.mjs umstellung …). Geschrieben wird nur mit
// `bestaetigt: true` im Body. Nur Wegwerf-Ordner: eigenes HOME, eigener Support-Ordner, eigene globale git-Konfiguration; launchctl, claude und codex nur als Attrappe.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync, rmSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pfad } from "./hilfe.mjs";
import { altvault, baumStand, GEHEIM } from "../Kern/fixture-altvault.mjs";

const MERKEN = ["HOME", "KORTEX_KERN_UNSTABIL_ERLAUBT", "KORTEX_KERN_TEMP_WURZELN", "KORTEX_KERN_PFAD", "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "KORTEX_CODEX_PROGRAMM", "GIT_CONFIG_GLOBAL", "BRAIN_APP_SUPPORT", "KORTEX_VAULT_VERTRAUT",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "FAKE_LAUNCHCTL_LOG", "FAKE_MCP_LOG", "CLAUDE_CONFIG_DIR", "KORTEX_DIENST_PLATTFORM"];
const fake = (n) => pfad("..", "Tests", "Kern", n);
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erlaube, pruefeVertrauen: vertrauensStand } = await import(pfad("gemeinsam", "vertrauen.mjs"));
const { erzeugeUmstellung, entscheidungenArgument } = await import(pfad("werkstatt", "umstellung.mjs"));
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
  delete process.env.KORTEX_VAULT_VERTRAUT;   // Workspace-Trust (P5): der Vault ist über den ECHTEN Merker im Temp-Support vertraut, nicht über den Testschalter
  erlaube(a.vault, { support: a.support, quelle: "geklont" });
  Object.assign(process.env, {
    HOME: a.home, KORTEX_DIENST_PLATTFORM: "darwin", KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_KERN_TEMP_WURZELN: "", BRAIN_APP_SUPPORT: a.support, GIT_CONFIG_GLOBAL: global,
    BRAIN_LAUNCHCTL: fake("fake-launchctl.mjs"), FAKE_LAUNCHCTL_LOG: join(a.basis, "launchctl.log"), FAKE_MCP_LOG: join(a.basis, "mcp.log"),
    BRAIN_CLAUDE: fake("fake-claude-mcp.mjs"), KORTEX_CODEX_PROGRAMM: fake("fake-codex-mcp.mjs"),
    GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org",
  });
  delete process.env.KORTEX_KERN_PFAD;
  const rufe = aufruf(erzeugeHandler({ vault: a.vault, vaultOptionen: { support: a.support }, starter }));
  return { a, rufe, starter, global, weg: () => { for (const [k, v] of Object.entries(gespeichert)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } a.weg(); } };
}
const ALT = ["kit-versioniert", "hookspath-relativ", "credential-helper", "hooks-alt-sh", "mcp-claude-alt", "plist-alt-dieser", "zwei-profile"];

test("Routen: Plan ohne Bestätigung schreibt nichts (auch bei bestaetigt als Text); Phase A ohne Probelauf → 409", async () => {
  const f = mitFixture(ALT);
  try {
    const vorher = baumStand(f.a.home, f.a.vault);
    const stand0 = await f.rufe("GET", "/api/umstellung/stand");
    assert.equal(stand0.status, 200, stand0.roh);
    assert.equal(stand0.j.phase, null);
    for (const body of [{}, { bestaetigt: "ja" }, { bestaetigt: 1 }]) {
      const p = await f.rufe("POST", "/api/umstellung/probelauf", body);
      assert.equal(p.status, 200, p.roh);
      assert.equal(p.j.plan, true);
      const a = await f.rufe("POST", "/api/umstellung/phase-a", body);
      assert.equal(a.j.plan, true);
      const r = await f.rufe("POST", "/api/umstellung/rueckweg", body);
      assert.equal(r.j.plan, true);
    }
    const ohne = await f.rufe("POST", "/api/umstellung/phase-a", { bestaetigt: true });
    assert.equal(ohne.status, 409);
    assert.equal(ohne.j.art, "vorbedingung");
    assert.match(ohne.j.fehler || ohne.roh, /Probelauf/);
    assert.equal(baumStand(f.a.home, f.a.vault), vorher, "nichts verändert");
    assert.equal((await f.rufe("GET", "/api/umstellung/phase-a")).status, 405);
  } finally { f.weg(); }
});

test("Routen: Probelauf grün → Phase A → Rückweg; keine Werte in den Antworten", async () => {
  const f = mitFixture(ALT);
  try {
    const p = await f.rufe("POST", "/api/umstellung/probelauf", { bestaetigt: true });
    assert.equal(p.status, 200, p.roh);
    assert.equal(p.j.ok, true, p.roh);
    assert.deepEqual(p.j.kriterien.map((c) => c.status).filter((s) => s === "rot"), []);
    const s1 = await f.rufe("GET", "/api/umstellung/stand");
    assert.equal(s1.j.probelauf.ampel, "gruen");
    assert.equal(s1.j.probelauf.gueltig, true);
    const a = await f.rufe("POST", "/api/umstellung/phase-a", { bestaetigt: true });
    assert.equal(a.status, 200, a.roh);
    assert.equal(a.j.phase, "A", a.roh);
    assert.equal(a.j.a9.ampel, "gruen", a.roh);
    const s2 = await f.rufe("GET", "/api/umstellung/stand");
    assert.equal(s2.j.phase, "A");
    assert.equal(s2.j.bundle, true);
    const settings = readFileSync(join(f.a.home, ".claude", "settings.json"), "utf8");
    assert.match(settings, /kortex' hook session-start/);
    const rw = await f.rufe("POST", "/api/umstellung/rueckweg", { bestaetigt: true, alles: true });
    assert.equal(rw.status, 200, rw.roh);
    assert.equal(rw.j.ok, true);
    assert.match(readFileSync(join(f.a.home, ".claude", "settings.json"), "utf8"), /session-start\.sh/, "alte Form wieder da");
    assert.equal((await f.rufe("GET", "/api/umstellung/stand")).j.phase, null);
    for (const x of [p, a, rw, s1, s2]) assert.ok(!x.roh.includes(GEHEIM) && !x.roh.includes(f.a.home), "kein Wert, kein Home-Pfad in der Antwort");
  } finally { f.weg(); }
});

test("Routen: ungültige Eingaben → 400/409; unbekanntes Profil in den Entscheidungen wird abgelehnt", async () => {
  const f = mitFixture(["zwei-profile"]);
  try {
    assert.equal((await f.rufe("POST", "/api/umstellung/phase-a", { bestaetigt: true, schritte: ["A1; rm -rf"] })).status, 400);
    assert.equal((await f.rufe("POST", "/api/umstellung/phase-a", { schritte: "A1" })).status, 400);
    assert.equal((await f.rufe("POST", "/api/umstellung/probelauf", { entscheidungen: { gitSchluessel: "ja" } })).status, 400);
    assert.equal((await f.rufe("POST", "/api/umstellung/probelauf", { entscheidungen: { profile: ["/etc"] } })).status, 409);
    assert.equal((await f.rufe("POST", "/api/umstellung/rueckweg", {})).j.plan, true);
    const ohneStarter = aufruf(erzeugeHandler({ vault: f.a.vault, vaultOptionen: { support: f.a.support }, starter: join(f.a.basis, "gibt-es-nicht") }));
    assert.equal((await ohneStarter("POST", "/api/umstellung/probelauf", {})).j.art, "kein-starter");
  } finally { f.weg(); }
});

test("entscheidungenArgument: nur bekannte Schlüssel, nur Profile aus der Liste", () => {
  const profile = [{ pfad: "/h/.claude" }, { pfad: "/h/.claude-privat" }];
  assert.equal(entscheidungenArgument({ gitSchluessel: false, mcpAnders: true, profile: ["/h/.claude"], weitereMacs: "ja", unbekannt: 1 }, profile), "gitSchluessel=nein,mcpAnders=ja,weitereMacs=ja,profile=/h/.claude");
  assert.equal(entscheidungenArgument(undefined, profile), "");
  assert.throws(() => entscheidungenArgument({ profile: ["/h/.claude", "/anderswo"] }, profile), /Profil/);
  assert.throws(() => entscheidungenArgument([], profile), /Objekt/);
});

test("Vertrauen (P5-Anschluss): nach erfolgreicher Phase A wird erlaube() aufgerufen; ohne Vertrauensmodul bleibt es ein Leerlauf", async () => {
  const f = mitFixture(["hooks-alt-sh"]);
  try {
    const aufrufe = [];
    const u = erzeugeUmstellung({ starter: f.starter, support: f.a.support, vertrauen: { erlaube: (v, o) => aufrufe.push({ v, o }) } });
    const v = { wurzel: f.a.vault };
    assert.equal((await u.probelauf(v, { bestaetigt: true })).ok, true);
    assert.deepEqual(aufrufe, [], "der Probelauf vermerkt kein Vertrauen");
    const r = await u.phaseA(v, { bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].v, f.a.vault);
    assert.equal(aufrufe[0].o.support, f.a.support);
    // Teil-Schritte vermerken nichts
    aufrufe.length = 0;
    await u.rueckweg(v, { bestaetigt: true, alles: true });
    const u2 = erzeugeUmstellung({ starter: f.starter, support: f.a.support });
    assert.equal((await u2.probelauf(v, { bestaetigt: true })).ok, true);
    assert.equal((await u2.phaseA(v, { bestaetigt: true })).ok, true, "ohne Vertrauensmodul kein Fehler");
  } finally { f.weg(); }
});
