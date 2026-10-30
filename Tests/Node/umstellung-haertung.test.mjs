// Umstellung P7b, Nachbesserung nach dem Review (Werkstatt-Seite): Fehlercodes des Kerns, Fristen, roter A9, gemeinsame Kennung von Kern und Werkstatt.
// Nur Wegwerf-Ordner (eigenes HOME, Support, globale git-Konfiguration); launchctl, claude und codex nur als Attrappe; nie ein echtes Profil (CLAUDE_CONFIG_DIR wird entfernt).
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pfad } from "./hilfe.mjs";
import { altvault } from "../Kern/fixture-altvault.mjs";

const MERKEN = ["HOME", "KORTEX_KERN_UNSTABIL_ERLAUBT", "KORTEX_KERN_TEMP_WURZELN", "KORTEX_KERN_PFAD", "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "KORTEX_CODEX_PROGRAMM", "GIT_CONFIG_GLOBAL", "BRAIN_APP_SUPPORT", "KORTEX_VAULT_VERTRAUT",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "FAKE_LAUNCHCTL_LOG", "FAKE_MCP_LOG", "CLAUDE_CONFIG_DIR"];
const fake = (n) => pfad("..", "Tests", "Kern", n);
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
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
  Object.assign(process.env, {
    HOME: a.home, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_KERN_TEMP_WURZELN: "", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_APP_SUPPORT: a.support, GIT_CONFIG_GLOBAL: global,
    BRAIN_LAUNCHCTL: fake("fake-launchctl.mjs"), FAKE_LAUNCHCTL_LOG: join(a.basis, "launchctl.log"), FAKE_MCP_LOG: join(a.basis, "mcp.log"),
    BRAIN_CLAUDE: fake("fake-claude-mcp.mjs"), KORTEX_CODEX_PROGRAMM: fake("fake-codex-mcp.mjs"),
    GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org",
  });
  delete process.env.KORTEX_KERN_PFAD;
  return { a, starter, weg: () => { for (const [k, v] of Object.entries(gespeichert)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } a.weg(); } };
}

test("Fehlercodes des Kerns: „nicht vertraut“ (Exit 6) und „läuft schon“ (Exit 5) haben verschiedene Antworten", async () => {
  const f = mitFixture([]);
  try {
    const stub = (code, fehler, meldung) => {
      const s = join(f.a.basis, `stub-${code}-${fehler}.sh`);
      writeFileSync(s, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ ok: false, fehler, meldung })}'\nexit ${code}\n`);
      chmodSync(s, 0o755);
      return aufruf(erzeugeHandler({ vault: f.a.vault, vaultOptionen: { support: f.a.support }, starter: s }));
    };
    const vt = await stub(6, "nicht-vertraut", "Bestätige den Vault zuerst.")("POST", "/api/umstellung/phase-a", { bestaetigt: true });
    assert.equal(vt.status, 409);
    assert.equal(vt.j.art, "nicht-vertraut");
    assert.match(vt.roh, /Bestätige den Vault/);
    const bel = await stub(5, "laeuft-schon", "Die Umstellung läuft gerade schon.")("POST", "/api/umstellung/phase-a", { bestaetigt: true });
    assert.equal(bel.j.art, "belegt");
    assert.notEqual(bel.j.art, vt.j.art);
    const alt = await stub(5, "nicht-vertraut", "x")("POST", "/api/umstellung/probelauf", { bestaetigt: true });
    assert.equal(alt.j.art, "nicht-vertraut", "auch ein Exit 5 mit dem Code „nicht-vertraut“ gilt als nicht vertraut");
  } finally { f.weg(); }
});

test("Die Frist der Werkstatt ist länger als das Kopieren im Kern; die Entscheidung „nachbarkopie“ ist erlaubt, falsche Typen nicht", async () => {
  const { FRIST_SCHREIBEN } = await import(pfad("werkstatt", "umstellung.mjs"));
  const { KOPIE_FRIST_MS } = await import(pfad("kern", "umstellung", "probelauf.mjs"));
  assert.ok(FRIST_SCHREIBEN > KOPIE_FRIST_MS, `${FRIST_SCHREIBEN} > ${KOPIE_FRIST_MS}`);
  assert.equal(entscheidungenArgument({ nachbarkopie: true }, []), "nachbarkopie=ja");
  assert.throws(() => entscheidungenArgument({ nachbarkopie: "ja" }, []), /true oder false/);
});

test("Roter A9 (mit Warnungen): kein Vertrauensvermerk, Phase bleibt offen; nach dem Weitermachen wird vermerkt", async () => {
  const f = mitFixture(["plist-alt-anderer"]);
  try {
    const aufrufe = [];
    const u = erzeugeUmstellung({ starter: f.starter, support: f.a.support, vertrauen: { erlaube: (v) => aufrufe.push(v) } });
    const v = { wurzel: f.a.vault };
    assert.equal((await u.probelauf(v, { bestaetigt: true })).ok, true);
    const r = await u.phaseA(v, { bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.mitWarnungen, true);
    assert.equal(r.phase, null);
    assert.deepEqual(aufrufe, [], "kein Vertrauensvermerk bei rotem A9");
    assert.equal((await u.stand(v)).phase, null);
    const e = { dienstAnderer: true };
    assert.equal((await u.probelauf(v, { bestaetigt: true, entscheidungen: e })).ok, true);
    const r2 = await u.phaseA(v, { bestaetigt: true, entscheidungen: e });
    assert.equal(r2.phase, "A", JSON.stringify(r2));
    assert.deepEqual(aufrufe, [f.a.vault]);
  } finally { f.weg(); }
});

test("Kennung/Merker: Kern (backup.mjs) und Werkstatt (sicherungsmerker.mjs) finden dieselbe Datei – auch für einen unter der früheren Kennung angelegten Merker", async () => {
  const f = mitFixture([]);
  try {
    const kern = await import(pfad("kern", "backup.mjs"));
    const werk = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
    assert.equal(kern.merkerDateiFuer(f.a.vault, f.a.support), werk.merkerDatei(f.a.vault, f.a.support));
    const ids = werk.kennungen(f.a.vault);
    assert.deepEqual(kern.kennungen(f.a.vault), ids);
    if (ids.length > 1) {
      writeFileSync(join(f.a.support, "backup", `${ids[1]}.json`), "{}\n");
      assert.equal(kern.merkerDateiFuer(f.a.vault, f.a.support), werk.merkerDatei(f.a.vault, f.a.support));
    }
  } finally { f.weg(); }
});
