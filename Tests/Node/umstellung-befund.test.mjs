// Umstellung P7a: GET /api/umstellung/befund reicht den Befund des Kerns durch (nur lesend). Nur Wegwerf-Ordner: eigenes HOME, eigener Support-Ordner,
// ein Starter, der den Kern aus dem Quellbaum startet. Nie ein echtes ~/.claude, nie ein echter Support-Ordner, kein launchctl, kein claude/codex.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";
import { altvault, baumStand, GEHEIM } from "../Kern/fixture-altvault.mjs";

process.env.KORTEX_KERN_UNSTABIL_ERLAUBT = "1";
const echtesHome = process.env.HOME;
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erkenneProfile: profileWerkstatt } = await import(pfad("werkstatt", "profile.mjs"));
const { erkenneProfile: profileKern } = await import(pfad("kern", "umstellung", "profile.mjs"));
const q = (p) => `'${String(p).replaceAll("'", "'\\''")}'`;

const aufruf = (h) => async (methode, p) => {
  const r = await h({ methode, pfad: p, query: null, body: undefined });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* kein JSON */ }
  return { ...r, j };
};
function mitFixture(faelle) {
  const a = altvault({ faelle });
  const starter = join(a.basis, "starter.sh");
  writeFileSync(starter, `#!/bin/sh\nexec ${q(process.execPath)} ${q(pfad("kern", "brain.mjs"))} "$@"\n`);
  chmodSync(starter, 0o755);
  process.env.HOME = a.home;   // os.homedir() liest $HOME – auch in den Kindprozessen
  const rufe = aufruf(erzeugeHandler({ vault: a.vault, vaultOptionen: { support: a.support }, starter }));
  return { a, rufe, starter, weg: () => { process.env.HOME = echtesHome; a.weg(); } };
}

test("GET /api/umstellung/befund: Kit-Vault → Befund mit Funden, ohne Werte, nichts verändert", async () => {
  const f = mitFixture(["kit-versioniert", "hooks-alt-sh", "zwei-profile", "credential-helper", "mcp-claude-alt", "plist-alt-dieser", "restverweis-skript"]);
  try {
    const vorher = baumStand(f.a.basis);
    const r = await f.rufe("GET", "/api/umstellung/befund");
    assert.equal(r.status, 200, r.body.toString());
    assert.equal(r.j.version, 1);
    assert.equal(r.j.kitZeit, true);
    assert.equal(r.j.umstellbar, true);
    const kat = r.j.funde.map((x) => x.kategorie).sort();
    assert.deepEqual(kat, ["claude-hooks", "claude-hooks", "claude-restverweise", "dienst-alt", "git-schluessel", "kit-ordner", "kit-versioniert", "mcp-alt"].sort());
    assert.deepEqual(r.j.profile.map((p) => p.name), [".claude", ".claude-privat"], "die Werkstatt reicht die erkannten Profile durch");
    assert.ok(!r.body.toString().includes(GEHEIM), "kein Wert in der Antwort");
    assert.equal(baumStand(f.a.basis), vorher, "die Route schreibt nichts");
  } finally { f.weg(); }
});

test("GET /api/umstellung/befund: sauberer Vault → leerer Befund", async () => {
  const f = mitFixture([]);
  try {
    const r = await f.rufe("GET", "/api/umstellung/befund");
    assert.equal(r.status, 200);
    assert.deepEqual(r.j.funde, []);
    assert.equal(r.j.kitZeit, false);
  } finally { f.weg(); }
});

test("GET /api/umstellung/befund: nur lesend (POST wird abgelehnt); ohne Starter eine klare Meldung", async () => {
  const f = mitFixture([]);
  try {
    assert.ok([404, 405].includes((await f.rufe("POST", "/api/umstellung/befund")).status));
    const ohne = aufruf(erzeugeHandler({ vault: f.a.vault, vaultOptionen: { support: f.a.support }, starter: join(f.a.basis, "gibt-es-nicht") }));
    const r = await ohne("GET", "/api/umstellung/befund");
    assert.equal(r.status, 409);
    assert.equal(r.j.art, "kein-starter");
  } finally { f.weg(); }
});

test("Profile: Kern und Werkstatt erkennen dieselben Claude-Profile", () => {
  const home = tmp("kortex-profile-");
  mkdirSync(join(home, ".claude"), { recursive: true }); writeFileSync(join(home, ".claude", "settings.json"), "{}");
  mkdirSync(join(home, ".claude-privat", "projects"), { recursive: true });
  mkdirSync(join(home, ".claude-leer"), { recursive: true });
  mkdirSync(join(home, "echt"), { recursive: true }); writeFileSync(join(home, "echt", "settings.json"), "{}");
  symlinkSync(join(home, "echt"), join(home, ".claude-link"));
  assert.deepEqual(profileKern(home), profileWerkstatt(home));
  assert.deepEqual(profileKern(home).map((p) => p.name), [".claude", ".claude-privat"]);
  const nur = tmp("kortex-profile-nur-");
  writeFileSync(join(nur, ".claude.json"), "{}");
  assert.deepEqual(profileKern(nur), profileWerkstatt(nur));
  assert.deepEqual(profileKern(tmp("kortex-profile-nix-")), []);
});
