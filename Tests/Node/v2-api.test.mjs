import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, realpathSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

// Hermetisch: kein echtes Home (Standardordner ~/Brain, Git-Konfiguration).
process.env.HOME = tmp("brain-home-");
const SUPPORT = process.env.BRAIN_APP_SUPPORT;

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const kinder = [];
after(() => { for (const k of kinder) k.kill("SIGKILL"); });

const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const loescheListe = async () => { const { rmSync } = await import("node:fs"); for (const f of ["vaults.json", "config.json", "vertrauen.json"]) rmSync(join(SUPPORT, f), { force: true }); };
const schreibeListe = (vaults, aktiv) => writeFileSync(join(SUPPORT, "vaults.json"), JSON.stringify({ vaults, aktiv }));
const id16 = (p) => createHash("sha256").update(realpathSync(p)).digest("hex").slice(0, 16);

function vaultMitNotizen() {
  const d = tmp();
  schreibe(d, "00_inbox/lose.md", "# Lose\n\nEine lose Idee.\n");
  schreibe(d, "09_wiki/firma/thema_a.md", "---\nname: a\ntyp: thema\nstand: 2026-10-01\nverwandt: \"[[entitaet_b]]\"\n---\n# Thema A\n\n- Fakt · Stand 01.10.2026 · [[firma/belege/2026-10/b1]]\n");
  schreibe(d, "09_wiki/firma/entitaet_b.md", "---\nname: b\ntyp: entitaet\n---\n# Entität B\n\nVerweist auf [[thema_a]].\n");
  schreibe(d, "09_wiki/firma/belege/2026-10/b1.md", "---\nzitat: x\n---\n# Beleg\n");
  return d;
}

test("Routen: notizen, notiz/kontext, typen, ansichten über den Handler; Methoden und Fehler", async () => {
  await loescheListe();
  const d = vaultMitNotizen();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  let r = await rufe("GET", "/api/notizen");
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.notizen.map((n) => n.pfad).sort(), ["00_inbox/lose.md", "09_wiki/firma/belege/2026-10/b1.md", "09_wiki/firma/entitaet_b.md", "09_wiki/firma/thema_a.md"]);
  const a = r.j.notizen.find((n) => n.pfad === "09_wiki/firma/thema_a.md");
  assert.deepEqual(Object.keys(a).sort(), ["ansichten", "bereich", "erstellt", "felder", "geaendert", "generiert", "links", "pfad", "stufe", "titel", "typ", "vorschau"]);
  assert.equal(a.titel, "Thema A"); assert.equal(a.typ, "thema"); assert.equal(a.bereich, "wissen"); assert.equal(a.stufe, "gruen");
  assert.deepEqual(a.links, ["09_wiki/firma/entitaet_b.md", "09_wiki/firma/belege/2026-10/b1.md"]);
  assert.equal(a.felder.verwandt, "[[entitaet_b]]"); assert.equal(a.generiert, false);

  r = await rufe("GET", "/api/notiz/kontext", undefined, "pfad=09_wiki%2Ffirma%2Fthema_a.md");
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.beziehungen, [{ feld: "verwandt", ziele: ["09_wiki/firma/entitaet_b.md"] }]);
  assert.deepEqual(r.j.rueckverweise, [{ pfad: "09_wiki/firma/entitaet_b.md", titel: "Entität B" }]);
  r = await rufe("GET", "/api/notiz/kontext", undefined, "pfad=..%2Fx.md"); assert.equal(r.status, 403); assert.ok(r.j.fehler);
  r = await rufe("GET", "/api/notiz/kontext"); assert.equal(r.status, 400);
  r = await rufe("GET", "/api/notiz/kontext", undefined, "pfad=nirgends.md"); assert.equal(r.status, 404);

  r = await rufe("GET", "/api/typen");
  assert.deepEqual(r.j.typen.map((t) => [t.name, t.anzahl, t.symbol]).sort(), [["entitaet", 1, "wuerfel"], ["thema", 1, "buch"]]);
  r = await rufe("GET", "/api/ansichten");
  assert.deepEqual(r.j.ansichten.map((x) => x.id), ["abgelaufen", "strittig", "ungeprueft", "zuletzt"]);
  for (const p of ["/api/notizen", "/api/typen", "/api/ansichten", "/api/notiz/kontext", "/api/ki/erkennen", "/api/vaults"]) assert.equal((await rufe("POST", p, {})).status, 405, p);
});

test("Probe: dieselbe Suche wie MCP brain_suchen; leere Frage → 400", async () => {
  await loescheListe();
  const d = vaultMitNotizen();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  // Vertrauen v2 (§8): die Probe läuft über den MCP-Server, und der folgt dem AKTIVEN Vault aus vaults.json — ohne Eintrag 409.
  let r = await rufe("POST", "/api/probe", { frage: "fakt" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-aktiv");
  schreibeListe([{ name: "t", pfad: realpathSync(d), farbe: "#5B8DEF" }], realpathSync(d));
  r = await rufe("POST", "/api/probe", { frage: "fakt" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.treffer.map((t) => t.pfad), ["09_wiki/firma/thema_a.md"]);
  assert.deepEqual(Object.keys(r.j.treffer[0]).sort(), ["auszug", "pfad", "stufe", "titel", "zeile"]);
  assert.equal(r.j.treffer[0].stufe, "gruen");
  assert.match(r.j.text, /^1\. 09_wiki\/firma\/thema_a\.md — Thema A \[grün\]\n {3}/);
  assert.equal((await rufe("POST", "/api/probe", { frage: "zzzgibtesnicht" })).j.text, "Keine Treffer.");
  assert.equal((await rufe("POST", "/api/probe", { frage: "  " })).status, 400);
  assert.equal((await rufe("POST", "/api/probe", {})).status, 400);
});

test("Ohne Vault: info mit vault:null, Vault-Routen und Statisches gehen, alle anderen Routen 409 keinVault", async () => {
  await loescheListe();
  const studio = tmp(); schreibe(studio, "index.html", "<title>Studio</title>");
  const rufe = aufruf(erzeugeHandler({ studioDir: studio, appVersion: "9.9.9" }));
  let r = await rufe("GET", "/api/info");
  assert.deepEqual(r.j, { vault: null, name: null, appVersion: "9.9.9", kitVersion: null, git: false, mcpBefehl: null, kit: { vorhanden: false, vertraut: false }, vertrauen: null });
  r = await rufe("GET", "/api/vaults"); assert.deepEqual(r.j, { vaults: [], aktiv: null });
  r = await rufe("GET", "/"); assert.equal(r.status, 200);
  r = await rufe("GET", "/api/ki/erkennen"); assert.equal(r.status, 200); assert.equal(r.j.agenten.length, 5);
  for (const [m, p, daten, q] of [["GET", "/api/baum"], ["GET", "/api/notizen"], ["GET", "/api/typen"], ["GET", "/api/ansichten"], ["GET", "/api/datei", undefined, "pfad=a.md"],
    ["GET", "/api/git/status"], ["GET", "/api/git/log"], ["POST", "/api/git/remote", { url: "https://x.example/a" }], ["POST", "/api/probe", { frage: "x" }], ["POST", "/api/mcp/verbinden", { ziel: "claude" }]]) {
    r = await rufe(m, p, daten, q);
    assert.equal(r.status, 409, `${m} ${p}`); assert.equal(r.j.keinVault, true); assert.ok(r.j.fehler);
  }
  r = await rufe("POST", "/api/vaults/aktiv", { pfad: join(tmp(), "gibts-nicht") }); assert.ok(r.status >= 400 && r.j.fehler);
});

test("Start aus vaults.json / config.json; das Vault-Argument hat Vorrang", async () => {
  await loescheListe();
  const a = vaultMitNotizen(), b = tmp();
  schreibe(b, "x.md", "# X\n");
  schreibeListe([{ name: "A", pfad: realpathSync(a), farbe: "#5B8DEF" }, { name: "B", pfad: realpathSync(b), farbe: "#E5734F" }], realpathSync(b));
  let rufe = aufruf(erzeugeHandler({}));
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(b));
  let l = (await rufe("GET", "/api/vaults")).j;
  assert.deepEqual(l.vaults.map((v) => [v.name, v.aktiv, v.vorhanden]), [["A", false, true], ["B", true, true]]); assert.equal(l.aktiv, realpathSync(b));
  rufe = aufruf(erzeugeHandler({ vault: a }));
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(a));
  // Argument-Vault, der nicht in der Liste steht: erscheint als aktiv und temporär, die Liste bleibt unverändert
  const c = tmp();
  rufe = aufruf(erzeugeHandler({ vault: c }));
  l = (await rufe("GET", "/api/vaults")).j;
  assert.equal(l.vaults[0].pfad, realpathSync(c)); assert.equal(l.vaults[0].aktiv, true); assert.equal(l.vaults[0].temporaer, true); assert.equal(l.vaults.length, 3);
  assert.equal(JSON.parse(readFileSync(join(SUPPORT, "vaults.json"), "utf8")).vaults.length, 2);
  // aktiver Vault existiert nicht mehr → Start ohne Vault, Eintrag bleibt (vorhanden:false)
  schreibeListe([{ name: "Weg", pfad: join(tmp(), "weg"), farbe: "#5B8DEF" }], join(tmp(), "weg"));
  rufe = aufruf(erzeugeHandler({}));
  assert.equal((await rufe("GET", "/api/info")).j.vault, null);
  assert.equal((await rufe("GET", "/api/vaults")).j.vaults[0].vorhanden, false);
  // Übernahme aus config.json der App
  await loescheListe();
  writeFileSync(join(SUPPORT, "config.json"), JSON.stringify({ vault: a }));
  rufe = aufruf(erzeugeHandler({}));
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(a));
  assert.equal(JSON.parse(readFileSync(join(SUPPORT, "vaults.json"), "utf8")).aktiv, realpathSync(a));
});

test("Vault-Wechsel ohne Neustart: Öffnen, Wechseln, Vertrauen je Vault, Entfernen, Neuanlage aus der Vorlage", async () => {
  await loescheListe();
  const a = vaultMitNotizen(), b = tmp();
  schreibe(b, "00_inbox/b-lose.md", "# B lose\n");
  mkdirSync(join(b, ".tools")); schreibe(b, ".tools/brain.mjs", "console.log('{}')\n");
  const rufe = aufruf(erzeugeHandler({}));
  let r = await rufe("POST", "/api/vaults/oeffnen", { pfad: a });
  assert.equal(r.status, 200); assert.equal(r.j.git, false); assert.equal(r.j.vault.pfad, realpathSync(a)); assert.equal(r.j.aktiv, realpathSync(a));
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(a));
  assert.equal((await rufe("GET", "/api/notizen")).j.notizen.length, 4);
  assert.equal((await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: a })).j.kit.vertraut, true);
  r = await rufe("POST", "/api/vaults/oeffnen", { pfad: b });
  assert.equal(r.j.vaults.length, 2); assert.deepEqual(r.j.vaults.map((v) => v.aktiv), [false, true]);
  assert.deepEqual((await rufe("GET", "/api/notizen")).j.notizen.map((n) => n.pfad), ["00_inbox/b-lose.md"]);
  assert.equal((await rufe("GET", "/api/info")).j.kit.vertraut, false, "Vertrauen gilt je Vault");
  // zurück zu A (ohne Neustart): Vertrauen bleibt dort erhalten, Caches sind die von A
  r = await rufe("POST", "/api/vaults/aktiv", { pfad: a });
  assert.equal(r.status, 200); assert.equal(r.j.aktiv, realpathSync(a));
  assert.equal((await rufe("GET", "/api/info")).j.kit.vertraut, true);
  assert.equal((await rufe("GET", "/api/notizen")).j.notizen.length, 4);
  assert.equal(JSON.parse(readFileSync(join(SUPPORT, "vaults.json"), "utf8")).aktiv, realpathSync(a));
  // nur registrierte Vaults lassen sich wählen
  assert.ok((await rufe("POST", "/api/vaults/aktiv", { pfad: tmp() })).status >= 400);
  // Entfernen des nicht aktiven: Liste kürzer, aktiver bleibt; Ordner bleibt auf der Platte
  r = await rufe("POST", "/api/vaults/entfernen", { pfad: b });
  assert.deepEqual(r.j.vaults.map((v) => v.pfad), [realpathSync(a)]); assert.ok(existsSync(join(b, "00_inbox/b-lose.md")));
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(a));
  // Entfernen des aktiven (letzten): Willkommen
  r = await rufe("POST", "/api/vaults/entfernen", { pfad: a });
  assert.deepEqual(r.j, { vaults: [], aktiv: null });
  assert.equal((await rufe("GET", "/api/info")).j.vault, null);
  assert.equal((await rufe("GET", "/api/baum")).status, 409);
  assert.ok(existsSync(join(a, "00_inbox/lose.md")), "nichts gelöscht");

  // Neuanlage aus der Vorlage (Standardordner ~/Kortex im hermetischen Home) und leerer Vault
  r = await rufe("POST", "/api/vaults/neu", { art: "vorlage", name: "Mein Vault" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const brain = join(process.env.HOME, "Kortex");
  assert.equal(r.j.vault.pfad, realpathSync(brain)); assert.equal(r.j.vault.name, "Mein Vault"); assert.equal(r.j.git, true);
  assert.equal((await rufe("GET", "/api/info")).j.git, true);
  const notizen = (await rufe("GET", "/api/notizen")).j.notizen;
  assert.ok(notizen.some((n) => n.bereich === "wissen" && n.stufe === "gruen"), "Beispielseiten sind belegt");
  assert.equal((await rufe("GET", "/api/git/status")).j.letzterCommit.nachricht, "Kortex-Vault angelegt");
  r = await rufe("POST", "/api/vaults/neu", { art: "leer", name: "Zweites" });
  assert.equal(r.j.vault.pfad, realpathSync(join(process.env.HOME, "Kortex 2")), "Kollision → Kortex 2");
  assert.deepEqual((await rufe("GET", "/api/notizen")).j.notizen, []);
  assert.equal((await rufe("GET", "/api/vaults")).j.vaults.length, 2);
  assert.equal((await rufe("POST", "/api/vaults/neu", { art: "gibtsnicht" })).status, 400);
});

// ---------- MCP folgt dem aktiven Vault ----------
function starteMcp(args = []) {
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, BRAIN_VAULT: "" } });
  kinder.push(p);
  const wartende = [], antworten = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  const naechste = () => new Promise((ok) => { const a = antworten.shift(); if (a) ok(a); else wartende.push(ok); });
  let n = 0;
  const frage = async (method, params) => { const id = ++n; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const a = await naechste(); assert.equal(a.id, id); return a; };
  const text = async (name, args2 = {}) => (await frage("tools/call", { name, arguments: args2 })).result.content.map((c) => c.text).join("\n");
  const ende = new Promise((ok) => p.on("close", (code) => ok(code)));
  return { p, frage, text, ende };
}

test("MCP ohne Vault-Argument folgt dem aktiven Vault aus vaults.json und kennt brain_vaults", async () => {
  await loescheListe();
  const a = vaultMitNotizen(), b = tmp();
  schreibe(b, "09_wiki/w/thema_b.md", "# Nur in B\n\nSchwalbe\n");
  const s = starteMcp();
  // noch kein Vault: Server läuft, Werkzeuge melden es freundlich
  assert.match(await s.text("brain_vaults"), /noch kein Vault/);
  assert.match(await s.text("brain_suchen", { frage: "thema" }), /noch kein Vault/);
  schreibeListe([{ name: "Eins", pfad: realpathSync(a), farbe: "#5B8DEF" }, { name: "Zwei", pfad: realpathSync(b), farbe: "#E5734F" }], realpathSync(a));
  assert.match(await s.text("brain_suchen", { frage: "thema" }), /thema_a\.md/);
  let t = await s.text("brain_vaults");
  assert.match(t, new RegExp(`1\\. \\* Eins — ${realpathSync(a)}`)); assert.match(t, new RegExp(`2\\.   Zwei — ${realpathSync(b)}$`));
  // Wechsel in der App → derselbe Server liest jetzt B
  schreibeListe([{ name: "Eins", pfad: realpathSync(a), farbe: "#5B8DEF" }, { name: "Zwei", pfad: realpathSync(b), farbe: "#E5734F" }], realpathSync(b));
  assert.match(await s.text("brain_suchen", { frage: "schwalbe" }), /thema_b\.md/);
  assert.match(await s.text("brain_vaults"), /2\. \* Zwei/);
  s.p.stdin.end(); assert.equal(await s.ende, 0);
});

test("MCP mit Vault-Argument bleibt gebunden; brain_vaults markiert ihn, auch wenn er nicht in der Liste steht", async () => {
  await loescheListe();
  const a = vaultMitNotizen(), b = tmp();
  schreibe(b, "x.md", "# X\n");
  schreibeListe([{ name: "Zwei", pfad: realpathSync(b), farbe: "#E5734F" }], realpathSync(b));
  const s = starteMcp([a]);
  assert.match(await s.text("brain_suchen", { frage: "thema" }), /thema_a\.md/);
  const t = await s.text("brain_vaults");
  assert.match(t, new RegExp(`1\\.   Zwei — ${realpathSync(b)} \\(in der App aktiv\\)`)); assert.match(t, new RegExp(`\\*  .* — ${realpathSync(a)} \\(nicht in der Liste der App\\)`));
  s.p.stdin.end(); assert.equal(await s.ende, 0);
});

// ---------- Brücke ohne Vault-Argument ----------
test("Brücke ohne Argument: vaultId des aktiven Vaults aus vaults.json, ohne aktiven Vault null", async () => {
  await loescheListe();
  const starte = () => {
    const p = spawn(process.execPath, [pfad("werkstatt", "werkstatt.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, BRAIN_VAULT: "" } });
    kinder.push(p);
    return new Promise((ok) => { createInterface({ input: p.stdout }).once("line", (z) => { p.stdin.end(); ok(JSON.parse(z)); }); });
  };
  let start = await starte();
  assert.deepEqual(Object.keys(start).sort(), ["bereit", "vaultId", "version"]); assert.equal(start.vaultId, null);
  const a = vaultMitNotizen();
  schreibeListe([{ name: "Eins", pfad: realpathSync(a), farbe: "#5B8DEF" }], realpathSync(a));
  start = await starte();
  assert.equal(start.vaultId, id16(a));
});
