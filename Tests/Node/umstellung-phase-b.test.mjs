// Umstellung P7d: die Routen der Werkstatt für Phase B (Freigabe-Tor, Probelauf, Aufräumen, Rückweg) und das Aufräumen nach der Umstellung reichen den Kern durch (Starter → brain.mjs umstellung …).
// Geschrieben wird nur mit `bestaetigt: true` im Body. Nur Wegwerf-Ordner: eigenes HOME, eigener Support-Ordner, eigene globale git-Konfiguration; launchctl, claude und codex nur als Attrappe.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync, rmSync, symlinkSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pfad } from "./hilfe.mjs";
import { altvault, baumStand, GEHEIM } from "../Kern/fixture-altvault.mjs";

const MERKEN = ["HOME", "KORTEX_KERN_UNSTABIL_ERLAUBT", "KORTEX_KERN_TEMP_WURZELN", "KORTEX_KERN_PFAD", "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "KORTEX_CODEX_PROGRAMM", "GIT_CONFIG_GLOBAL", "BRAIN_APP_SUPPORT", "KORTEX_VAULT_VERTRAUT",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "FAKE_LAUNCHCTL_LOG", "FAKE_MCP_LOG", "CLAUDE_CONFIG_DIR", "KORTEX_DIENST_PLATTFORM"];
const fake = (n) => pfad("..", "Tests", "Kern", n);
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erlaube } = await import(pfad("gemeinsam", "vertrauen.mjs"));
const { entscheidungenBArgument } = await import(pfad("werkstatt", "umstellung.mjs"));
const { liesZustand, schreibeZustand } = await import(pfad("kern", "umstellung", "protokoll.mjs"));
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
const ALT = ["kit-versioniert", "hookspath-relativ", "credential-helper", "hooks-alt-sh", "mcp-claude-alt", "plist-alt-dieser", "altfelder", "shell-datei"];
const bed = (j, id) => j.tor.bedingungen.find((b) => b.id === id);
// Phase A über die Routen, dann Zeit und Version von Phase A so setzen, dass das Tor außer Probelauf, Bestätigung und Restverweis offen ist
async function nachPhaseA(f) {
  assert.equal((await f.rufe("POST", "/api/umstellung/probelauf", { bestaetigt: true })).j.ok, true);
  const a = await f.rufe("POST", "/api/umstellung/phase-a", { bestaetigt: true });
  assert.equal(a.j.phase, "A", a.roh);
  try { f.a.g("add", "--", "brain.config.json"); f.a.g("commit", "-q", "-m", "Config"); } catch { /* nichts zu speichern */ }
  const z = { vault: f.a.vault, support: f.a.support };
  const zu = liesZustand(z);
  zu.phaseA = { zeit: new Date(Date.now() - 8 * 86_400_000).toISOString(), kernVersion: "0.0.1" };
  schreibeZustand(z, zu);
}

test("Routen: Plan samt Tor ohne Bestätigung schreibt nichts; ungültige Eingaben → 400; Phase B vor Phase A → Tor zu (409)", async () => {
  const f = mitFixture(ALT);
  try {
    const vorher = baumStand(f.a.home, f.a.vault);
    for (const body of [{ probelauf: true }, { probelauf: true, bestaetigt: "ja" }]) {
      const r = await f.rufe("POST", "/api/umstellung/phase-b", body);
      assert.equal(r.status, 200, r.roh);
      assert.equal(r.j.plan, true, "ohne echte Bestätigung nur der Plan des Probelaufs");
      assert.deepEqual(r.j.schritte.map((s) => s.id), ["B0", "B1", "B2", "B3"]);
    }
    for (const body of [{}, { bestaetigt: "ja" }, { bestaetigt: 1 }]) {
      const r = await f.rufe("POST", "/api/umstellung/phase-b", body);
      assert.equal(r.status, 200, r.roh);
      assert.equal(r.j.plan, true, r.roh);
      assert.equal(r.j.tor.frei, false);
      assert.deepEqual(r.j.tor.bedingungen.map((b) => b.id), ["phase-a", "release", "wartezeit", "macs", "bestaetigung", "prozesse", "restverweise", "befund", "probelauf"]);
      assert.equal(bed(r.j, "phase-a").erfuellt, false);
      assert.match(bed(r.j, "phase-a").text, /Phase A/);
      assert.deepEqual(r.j.schritte.map((s) => s.id), ["B0", "B1", "B2", "B3", "B4"]);
    }
    assert.equal((await f.rufe("GET", "/api/umstellung/phase-b")).status, 405);
    for (const body of [[], { entscheidungen: [] }, { entscheidungen: { keineAltenMacs: "ja" } }, { entscheidungen: { bewusst: ["x"] } }, { entscheidungen: { bewusst: "E24" } }, { entscheidungen: { bewusst: ["E24; rm -rf"] } }]) {
      assert.equal((await f.rufe("POST", "/api/umstellung/phase-b", body)).status, 400, JSON.stringify(body));
    }
    const zu = await f.rufe("POST", "/api/umstellung/phase-b", { bestaetigt: true, entscheidungen: { keineAltenMacs: true } });
    assert.equal(zu.status, 409, zu.roh);
    assert.equal(zu.j.art, "vorbedingung");
    assert.equal(zu.j.code, "tor-zu");
    assert.match(zu.j.fehler, /nicht freigegeben/);
    const probe = await f.rufe("POST", "/api/umstellung/phase-b", { probelauf: true, bestaetigt: true });
    assert.equal(probe.status, 409, "ohne Phase A kein Probelauf für Phase B");
    assert.equal(probe.j.code, "nicht-umgestellt");
    // Aufräumen: Eingaben streng
    assert.equal((await f.rufe("GET", "/api/umstellung/aufraeumen")).j.angebote.length, 0);
    assert.equal((await f.rufe("POST", "/api/umstellung/aufraeumen", { was: "alles", bestaetigt: true })).status, 400);
    assert.equal((await f.rufe("POST", "/api/umstellung/aufraeumen", { was: "archiv", bestaetigt: true })).status, 400, "Archiv ohne Namen");
    assert.equal((await f.rufe("POST", "/api/umstellung/aufraeumen", { was: "archiv", name: "../../etc", bestaetigt: true })).status, 400);
    assert.equal((await f.rufe("POST", "/api/umstellung/aufraeumen", { was: "archiv", name: "kit-2026-01-01", bestaetigt: true })).status, 409, "kein solches Archiv");
    assert.equal((await f.rufe("PUT", "/api/umstellung/aufraeumen", {})).status, 405);
    assert.equal((await f.rufe("POST", "/api/umstellung/rueckweg", { bestaetigt: true, schritte: ["C1"] })).status, 400);
    assert.equal(baumStand(f.a.home, f.a.vault), vorher, "nichts verändert");
  } finally { f.weg(); }
});

test("Routen: Tor Schritt für Schritt → Probelauf → Aufräumen → Stand → Rückweg; keine Werte in den Antworten", async () => {
  const f = mitFixture(ALT);
  try {
    await nachPhaseA(f);
    const kit = join(f.a.vault, ".tools");
    // Tor: Bestätigung und der Restverweis (Shell-Datei, E24) fehlen, der Probelauf auch
    const t1 = await f.rufe("POST", "/api/umstellung/phase-b", {});
    assert.equal(bed(t1.j, "phase-a").erfuellt, true, t1.roh);
    assert.equal(bed(t1.j, "release").erfuellt, true);
    assert.equal(bed(t1.j, "wartezeit").erfuellt, true);
    assert.equal(bed(t1.j, "macs").erfuellt, true, JSON.stringify(bed(t1.j, "macs")));
    assert.equal(bed(t1.j, "bestaetigung").erfuellt, false);
    assert.equal(bed(t1.j, "restverweise").erfuellt, false);
    assert.deepEqual(bed(t1.j, "restverweise").details.liste.map((x) => x.id), ["E24"]);
    assert.equal(bed(t1.j, "probelauf").erfuellt, false);
    const ent = { keineAltenMacs: true, bewusst: ["E24"] };
    const t2 = await f.rufe("POST", "/api/umstellung/phase-b", { entscheidungen: ent });
    assert.deepEqual(t2.j.tor.offen, ["probelauf"]);
    // Probelauf an der Kopie
    const p = await f.rufe("POST", "/api/umstellung/phase-b", { probelauf: true, bestaetigt: true, entscheidungen: ent });
    assert.equal(p.status, 200, p.roh);
    assert.equal(p.j.ok, true, p.roh);
    assert.ok(p.j.kriterien.length >= 6 && p.j.kriterien.every((c) => c.status !== "rot"), p.roh);
    assert.equal((await f.rufe("GET", "/api/umstellung/stand")).j.phaseB.probelauf.gueltig, true);
    const t3 = await f.rufe("POST", "/api/umstellung/phase-b", { entscheidungen: ent });
    assert.equal(t3.j.tor.frei, true, t3.roh);
    // ohne die Bestätigung der Macs: weiter zu; mit ihr: durch
    assert.equal((await f.rufe("POST", "/api/umstellung/phase-b", { bestaetigt: true, entscheidungen: { bewusst: ["E24"] } })).j.code, "tor-zu");
    assert.ok(existsSync(join(kit, "VERSION")));
    const r = await f.rufe("POST", "/api/umstellung/phase-b", { bestaetigt: true, entscheidungen: ent });
    assert.equal(r.status, 200, r.roh);
    assert.equal(r.j.ok, true, r.roh);
    assert.equal(r.j.phaseB, "fertig");
    assert.match(r.j.archiv, /^kit-\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(r.j.schritte.map((s) => s.id), ["B0", "B1", "B2", "B3", "B4"]);
    assert.ok(!existsSync(kit));
    const s2 = await f.rufe("GET", "/api/umstellung/stand");
    assert.equal(s2.j.phase, "A");
    assert.equal(s2.j.phaseB.status, "fertig");
    assert.equal(s2.j.phaseB.archiv, r.j.archiv);
    assert.equal(s2.j.phaseB.schritte.B1.status, "ok");
    assert.equal(s2.j.phaseB.b4.ampel, "gruen");
    const ang = await f.rufe("GET", "/api/umstellung/aufraeumen");
    assert.equal(ang.status, 200, ang.roh);
    const archiv = ang.j.angebote.find((x) => x.id === "archiv");
    assert.equal(archiv.faellig, false, "erst nach 30 Tagen");
    assert.equal((await f.rufe("POST", "/api/umstellung/aufraeumen", { was: "archiv", name: archiv.name, bestaetigt: true })).status, 409, "zu früh → abgelehnt");
    assert.ok(existsSync(join(f.a.support, "umstellung")) && readdirSync(join(f.a.support, "umstellung")).length >= 1);
    // Rückweg
    const plan = await f.rufe("POST", "/api/umstellung/rueckweg", { schritte: ["B3", "B2", "B1"] });
    assert.equal(plan.j.plan, true);
    assert.deepEqual(plan.j.schritte.filter((s) => s.id.startsWith("B")).map((s) => [s.id, s.hatRueckweg]), [["B0", true], ["B1", true], ["B2", true], ["B3", true]]);
    const rw = await f.rufe("POST", "/api/umstellung/rueckweg", { bestaetigt: true, schritte: ["B3", "B2", "B1"] });
    assert.equal(rw.status, 200, rw.roh);
    assert.equal(rw.j.ok, true);
    assert.deepEqual(rw.j.hinweise, []);
    assert.ok(existsSync(join(kit, "VERSION")), ".tools ist zurück");
    assert.equal((await f.rufe("GET", "/api/umstellung/stand")).j.phaseB.status, null);
    for (const x of [t1, t2, p, t3, r, s2, ang, rw]) assert.ok(!x.roh.includes(GEHEIM) && !x.roh.includes(f.a.home), "kein Wert, kein Home-Pfad in der Antwort");
  } finally { f.weg(); }
});

test("entscheidungenBArgument: nur bekannte Schlüssel, Fund-IDs streng", () => {
  assert.equal(entscheidungenBArgument({ keineAltenMacs: true, bewusst: ["E24", "E15"], nachbarkopie: false, unbekannt: 1 }), "keineAltenMacs=ja,nachbarkopie=nein,bewusst=E24+E15");
  assert.equal(entscheidungenBArgument(undefined), "");
  assert.equal(entscheidungenBArgument({ bewusst: [] }), "");
  assert.throws(() => entscheidungenBArgument({ bewusst: ["E24+E1"] }), /bewusst/);
  assert.throws(() => entscheidungenBArgument({ keineAltenMacs: 1 }), /true oder false/);
  assert.throws(() => entscheidungenBArgument([]), /Objekt/);
});
