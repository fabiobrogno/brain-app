// Vorschau „wie frisch installiert“ (KORTEX_VORSCHAU): Die Node-Seite hält sich an den Vorschau-Ordner. Belegt mit einem zweiten
// Temp-Ordner als „echtes“ HOME (Köder: Fake-claude, Vorher/Nachher-Vergleich) — nie das echte HOME dieses Rechners.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, chmodSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { vorschauOrdner, vorschauFehler } = await import(pfad("gemeinsam", "basis.mjs"));
const { erzeugeGitHub } = await import(pfad("gemeinsam", "github.mjs"));
const { findeProgramm, erkenneAgenten } = await import(pfad("gemeinsam", "ki.mjs"));
const vaults = await import(pfad("gemeinsam", "vaults.mjs"));

// Umgebung zeitweise setzen (in-process-Tests lesen process.env bei jedem Aufruf).
async function mit(env, fn) {
  const alt = {};
  for (const k of Object.keys(env)) alt[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// Ein Vorschau-Ordner wie ihn die App anlegt: home, support, bin, tmp.
function vorschauAnlegen() {
  const vo = tmp("kortex-vorschau-");
  for (const u of ["home", "support", "bin", "tmp"]) mkdirSync(join(vo, u));
  return vo;
}
const vorschauEnv = (vo) => ({ KORTEX_VORSCHAU: vo, HOME: join(vo, "home"), BRAIN_APP_SUPPORT: join(vo, "support"), CFFIXED_USER_HOME: join(vo, "home"),
  GIT_CONFIG_GLOBAL: join(vo, "home", ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1", PATH: `${join(vo, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin` });

// Fingerabdruck eines Ordners: Pfad, Art, Größe, Änderungszeit, Inhalt — für „nichts hat sich verändert“.
function abdruck(wurzel) {
  const aus = [];
  const geh = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n), s = lstatSync(p);
      if (s.isDirectory()) { aus.push(`D ${p} ${s.mtimeMs}`); geh(p); }
      else aus.push(`F ${p} ${s.size} ${s.mtimeMs} ${s.isFile() ? createHash("sha256").update(readFileSync(p)).digest("hex") : "link"}`);
    }
  };
  geh(wurzel);
  return aus;
}
// „Echtes“ HOME mit Ködern: ein Fake-claude, das jeden Aufruf in eine Datei schreibt, und ein paar Dotfiles.
function echtesHome() {
  const h = tmp("kortex-echtes-home-");
  schreibe(h, ".gitconfig", "[user]\n\tname = Echt\n");
  schreibe(h, ".claude.json", "{}\n");
  schreibe(h, ".local/bin/claude", `#!/bin/sh\necho "$*" >> "${join(h, "claude-aufrufe.txt")}"\nexit 0\n`);
  chmodSync(join(h, ".local/bin/claude"), 0o755);
  mkdirSync(join(h, "Library/Keychains"), { recursive: true });
  return h;
}

// ── Pfad-Prüfung ──
test("vorschauOrdner/vorschauFehler: nur gültige Pfade, HOME muss im Vorschau-Ordner liegen", async () => {
  const vo = vorschauAnlegen();
  await mit({ KORTEX_VORSCHAU: undefined }, () => { assert.equal(vorschauOrdner(), null); assert.equal(vorschauFehler(), null); });
  await mit({ KORTEX_VORSCHAU: vo, HOME: join(vo, "home") }, () => { assert.equal(vorschauOrdner(), vo); assert.equal(vorschauFehler(), null); });
  await mit({ KORTEX_VORSCHAU: vo, HOME: tmp("anderes-home-") }, () => assert.match(vorschauFehler(), /HOME/));
  for (const schlecht of ["relativ/pfad", "/mit leerzeichen", `${vo}/`, `${vo}/../x`, "/a;b", "", "/"]) {
    await mit({ KORTEX_VORSCHAU: schlecht, HOME: join(vo, "home") }, () => {
      assert.equal(vorschauOrdner(), null, schlecht);
      assert.match(vorschauFehler(), /gültig/, `gesetzt, aber ungültig ist ein Fehler, kein stilles „aus“: ${JSON.stringify(schlecht)}`);
    });
  }
});

// ── GitHub-Token: Datei im Vorschau-Ordner statt Schlüsselbund ──
test("GitHub-Anmeldung in der Vorschau: das Token landet in der Zugangsdatei des Vorschau-Ordners, nicht im Schlüsselbund", async () => {
  const vo = vorschauAnlegen();
  const echt = echtesHome();
  const vorher = abdruck(echt);
  const TOKEN = "gho_VORSCHAUTOKEN1234567890abcdef";
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const json = (j) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
      if (req.url === "/login/device/code") return json({ device_code: "D", user_code: "AAAA-1111", verification_uri: `http://127.0.0.1:${server.address().port}/login/device`, expires_in: 900, interval: 0 });
      if (req.url === "/login/oauth/access_token") return json({ access_token: TOKEN });
      if (req.url === "/user") return json({ login: "vorschau-test" });
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  after(() => server.close());
  const basis = `http://127.0.0.1:${server.address().port}`;
  await mit(vorschauEnv(vo), async () => {
    const gh = erzeugeGitHub({ clientId: "Iv1.testclient", basis, apiBasis: basis, warte: () => new Promise((ok) => setImmediate(ok)), log: () => {} });
    await gh.anmelden();
    for (let i = 0; i < 400 && gh.status().zustand === "wartet"; i++) await new Promise((ok) => setTimeout(ok, 10));
    assert.deepEqual(gh.status(), { zustand: "fertig", login: "vorschau-test" });
    const datei = join(vo, "home", ".git-credentials");
    assert.ok(existsSync(datei), "Zugangsdatei im Vorschau-Ordner");
    assert.ok(readFileSync(datei, "utf8").includes(TOKEN));
    assert.deepEqual(await gh.konto(), { verfuegbar: true, angemeldet: true, login: "vorschau-test" });
    assert.deepEqual(await gh.abmelden(), { ok: true });
    assert.ok(!readFileSync(datei, "utf8").includes(TOKEN), "Abmelden entfernt das Konto aus der Datei");
  });
  assert.deepEqual(abdruck(echt), vorher, "das „echte“ HOME blieb unberührt");
});

// ── KI-Suche ──
test("KI-Suche in der Vorschau: nur PATH und das Vorschau-Home, nie die Systemorte dieses Rechners", async () => {
  const vo = vorschauAnlegen();
  await mit({ ...vorschauEnv(vo), BRAIN_TESTMODUS: undefined, BRAIN_CLAUDE_EXTRA: undefined }, () => {
    assert.equal(findeProgramm("claude", { PATH: "" }), null, "frisch installiert: keine KI");
    schreibe(join(vo, "home"), ".local/bin/claude", "#!/bin/sh\nexit 0\n");
    chmodSync(join(vo, "home", ".local/bin/claude"), 0o755);
    assert.equal(findeProgramm("claude", { PATH: "" }), join(vo, "home", ".local/bin/claude"));
  });
});

// ── Vault-Orte ──
test("Vaults in der Vorschau: nur im Vorschau-Ordner; Standardort ist <home>/Kortex", async () => {
  const vo = vorschauAnlegen();
  const draussen = tmp("kortex-draussen-");
  await mit(vorschauEnv(vo), async () => {
    assert.throws(() => vaults.pruefeVaultPfad(join(draussen, "Kortex")), (e) => e.status === 403 && /Vorschau/.test(e.message));
    assert.throws(() => vaults.pruefeVaultPfad("/tmp/x-vorschau-test"), (e) => e.status === 403);
    assert.equal(vaults.pruefeVaultPfad(join(vo, "home", "Kortex")), join(vo, "home", "Kortex"));
    await assert.rejects(vaults.oeffneOrdner({ pfad: draussen }), (e) => e.status === 403);
    await assert.rejects(vaults.klone({ url: "https://github.com/x/y.git", ordner: join(draussen, "klon") }), (e) => e.status === 403);
    assert.ok(!existsSync(join(draussen, "klon")));
    const v = await vaults.neuesVault({ art: "leer" });
    assert.equal(v.vault.pfad, join(vo, "home", "Kortex"));
    assert.ok(existsSync(join(vo, "home", "Kortex", ".git")));
  });
  assert.deepEqual(readdirSync(draussen), [], "außerhalb wurde nichts angelegt");
});

// ── Werkstatt als Unterprozess: Schutz und Ablauf ──
function starteWerkstatt(env) {
  const p = spawn(process.execPath, [pfad("werkstatt", "werkstatt.mjs")], { stdio: ["pipe", "pipe", "pipe"], env });
  const zeilen = [], wartende = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else zeilen.push(o); });
  const naechste = () => new Promise((ok) => { const z = zeilen.shift(); if (z) ok(z); else wartende.push(ok); });
  let err = ""; p.stderr.on("data", (d) => (err += d));
  const ende = new Promise((ok) => p.on("close", (code) => ok({ code, err })));
  let nr = 0;
  const rufe = async (methode, pfadText, body = null) => {
    const id = ++nr;
    p.stdin.write(JSON.stringify({ id, methode, pfad: pfadText, query: null, body: body ? Buffer.from(JSON.stringify(body)).toString("base64") : null }) + "\n");
    const a = await naechste();
    assert.equal(a.id, id);
    return { status: a.status, j: JSON.parse(Buffer.from(a.body, "base64").toString("utf8") || "{}") };
  };
  return { p, naechste, ende, rufe };
}
const basisEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith("GIT_") || k === "KORTEX_VORSCHAU") delete e[k]; return e; };

test("Werkstatt startet in der Vorschau nur mit umgelenktem HOME (sonst Abbruch mit Code 2, ohne etwas anzufassen)", async () => {
  const vo = vorschauAnlegen();
  const echt = echtesHome();
  const vorher = abdruck(echt);
  const r = spawnSync(process.execPath, [pfad("werkstatt", "werkstatt.mjs")], { env: { ...basisEnv(), KORTEX_VORSCHAU: vo, HOME: echt, BRAIN_APP_SUPPORT: join(vo, "support") }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2); assert.match(r.stderr, /Vorschau-Schutz/);
  const r2 = spawnSync(process.execPath, [pfad("werkstatt", "werkstatt.mjs")], { env: { ...basisEnv(), KORTEX_VORSCHAU: "/mit leerzeichen", HOME: echt }, encoding: "utf8", timeout: 20000 });
  assert.equal(r2.status, 2);
  assert.deepEqual(abdruck(echt), vorher);
  assert.deepEqual(readdirSync(join(vo, "support")), []);
});

test("Assistenten-Ablauf in der Vorschau bis „Vault angelegt“ mit Fake-claude: außerhalb des Vorschau-Ordners ändert sich nichts", async (t) => {
  const vo = vorschauAnlegen();
  const echt = echtesHome();
  const vorher = abdruck(echt);
  // Fake-claude im PATH des Vorschau-Ordners (--mit-ki): führt den Eintrag „brain“ in $HOME/.claude.json
  schreibe(vo, "bin/claude", `#!/bin/sh
case "$HOME" in "${vo}"/*) ;; *) echo "Schutz" >&2; exit 97;; esac
case "$1 $2" in
  "--version "*) echo "2.1.0 (Claude Code)";;
  "mcp get") echo "No MCP server found with name: brain" >&2; exit 1;;
  "mcp add") echo '{"mcpServers":{"brain":{}}}' > "$HOME/.claude.json"; echo "Added";;
  *) exit 1;;
esac
`);
  chmodSync(join(vo, "bin/claude"), 0o755);
  const env = { ...basisEnv(), ...vorschauEnv(vo), TMPDIR: join(vo, "tmp") + "/" };
  const w = starteWerkstatt(env);
  t.after(() => w.p.kill("SIGKILL"));
  const start = await w.naechste();
  assert.equal(start.bereit, true);

  assert.equal((await w.rufe("GET", "/api/github/konto")).j.verfuegbar, false, "ohne Client-ID ist der Schritt unsichtbar");
  const kis = (await w.rufe("GET", "/api/ki/erkennen?neu=1")).j.agenten;
  assert.equal(kis.find((a) => a.id === "claude").pfad, join(vo, "bin/claude"), "nur der Platzhalter, nicht das claude des echten HOME");
  assert.equal(kis.find((a) => a.id === "codex").pfad, null);

  const neu = await w.rufe("POST", "/api/vaults/neu", { art: "vorlage" });
  assert.equal(neu.status, 200, JSON.stringify(neu.j));
  assert.equal(neu.j.vault.pfad, join(vo, "home", "Kortex"));
  for (const d of ["00_inbox", "09_wiki"]) assert.ok(existsSync(join(vo, "home", "Kortex", d)), d);
  assert.ok(existsSync(join(vo, "home", "Kortex", ".git")));
  assert.ok(existsSync(join(vo, "support", "vaults.json")));

  const aus = await w.rufe("POST", "/api/vaults/neu", { art: "leer", ordner: join(echt, "Brain") });
  assert.equal(aus.status, 403, "ein Ordner im echten HOME wird abgelehnt");

  const verb = await w.rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
  assert.equal(verb.status, 200, JSON.stringify(verb.j));
  assert.ok(existsSync(join(vo, "home", ".claude.json")), "verbunden: nur in der Vorschau-Konfiguration");

  w.p.stdin.end();
  assert.equal((await w.ende).code, 0);
  assert.deepEqual(abdruck(echt), vorher, "das „echte“ HOME ist unverändert (Köder-claude nie gestartet, keine Datei neu)");
  assert.ok(!existsSync(join(echt, "claude-aufrufe.txt")));
  assert.ok(!existsSync(join(echt, "Brain")));
});

// ── Cursor.app dieses Rechners zählt in der Vorschau nicht ──
test("Cursor-Erkennung in der Vorschau: nur das Vorschau-Home, nicht /Applications", async () => {
  const vo = vorschauAnlegen();
  const apps = tmp("kortex-apps-");
  mkdirSync(join(apps, "Cursor.app"));
  const env = { PATH: "" };
  assert.equal((await erkenneAgenten({ env, home: join(vo, "home"), appOrdner: apps, neu: true })).cursorDa, true, "ohne Vorschau zählt die App");
  await mit(vorschauEnv(vo), async () => {
    assert.equal((await erkenneAgenten({ env, home: join(vo, "home"), appOrdner: apps, neu: true })).cursorDa, false, "Vorschau: frisch");
    mkdirSync(join(vo, "home", ".cursor"));
    assert.equal((await erkenneAgenten({ env, home: join(vo, "home"), appOrdner: apps, neu: true })).cursorDa, true, "--mit-ki: Platzhalter-Ordner im Vorschau-Home");
  });
});
