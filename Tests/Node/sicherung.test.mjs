// Sicherung (FBL-88), Vorprüfung und Verbinden: GET /api/sicherung/bereit, POST /api/sicherung/verbinden. Echtes git mit Wegwerf-Vaults und
// Bare-Repos als „GitHub“, GitHub selbst ist ein Schein-fetch, der Schlüsselbund ein Schein-Helper. Kein Netz, kein echter Schlüsselbund.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmp, repo, g, pfad } from "./hilfe.mjs";

process.env.HOME = tmp("brain-home-");
process.env.GIT_CONFIG_NOSYSTEM = "1";
const TOKEN = "gho_GEHEIMESTOKEN_sicherung_0123456789";

const { erzeugeGitHub } = await import(pfad("gemeinsam", "github.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { sicherungStand } = await import(pfad("gemeinsam", "gitsicherung.mjs"));
const { githubHelperArgs, remoteHinzufuegen } = await import(pfad("gemeinsam", "git.mjs"));

// Schein-Schlüsselbund: antwortet nur auf protocol=https + host=github.com
const BUND = tmp("brain-bund-");
const HELPER = join(BUND, "git-credential-fake");
writeFileSync(join(BUND, "konto.txt"), `username=anna-test\npassword=${TOKEN}\n`);
writeFileSync(HELPER, `#!/bin/sh
[ "$1" = get ] || exit 0
eingabe=$(cat)
echo "$eingabe" | grep -qx 'protocol=https' && echo "$eingabe" | grep -qx 'host=github.com' || exit 1
cat "${join(BUND, "konto.txt")}"
`);
chmodSync(HELPER, 0o755);

const bare = () => { const b = tmp("brain-sbare-"); g(b, "init", "-q", "--bare", "-b", "main"); return b; };
const refsVon = (b) => g(b, "for-each-ref").trim();

// GitHub: antwortet auf GET /repos/<besitzer>/<name> mit `repoJson`; merkt sich die Aufrufe.
function aufbau(vault, { repoJson, ziel = bare() } = {}) {
  const aufrufe = [];
  const fetchFn = async (url) => {
    const u = new URL(url);
    aufrufe.push(u.pathname);
    const r = typeof repoJson === "function" ? repoJson(u.pathname) : repoJson;
    return new Response(JSON.stringify(r.j), { status: r.status });
  };
  const github = erzeugeGitHub({ clientId: "Iv1.testclient", apiBasis: "http://127.0.0.1:1", helper: HELPER, fetch: fetchFn, log: () => {}, repoAdresse: () => ziel });
  const h = erzeugeHandler({ vault, github });
  const rufe = async (methode, p, body) => {
    const r = await h({ methode, pfad: p, query: null, body: body ? Buffer.from(JSON.stringify(body)) : undefined });
    return { status: r.status, text: r.body.toString("utf8"), j: JSON.parse(r.body.toString("utf8")) };
  };
  return { rufe, aufrufe, ziel };
}
const privat = { status: 200, j: { name: "mein-brain", private: true, archived: false, owner: { login: "anna-test" }, permissions: { push: true } } };
const VERBINDEN = { besitzer: "anna-test", name: "mein-brain" };

test("sicherungStand: jeder Zustand und jede Sperre", () => {
  const gut = { repo: true, zweig: "main", upstream: null, remote: false, letzterCommit: { sha: "a" } };
  assert.deepEqual(sicherungStand(gut), { zustand: "bereit" });
  assert.deepEqual(sicherungStand({ ...gut, remote: true, upstream: "origin/main" }), { zustand: "gesichert" });
  for (const [s, grund] of [
    [{ repo: true, gesperrt: true, grund: "x" }, "gesperrt"],
    [{ repo: false }, "kein-git"],
    [{ ...gut, zweig: "(losgelöst)" }, "losgeloest"],
    [{ ...gut, remote: true }, "unfertig"],
    [{ ...gut, letzterCommit: null }, "keine-version"],
    [null, "kein-git"],
  ]) {
    const r = sicherungStand(s);
    assert.equal(r.zustand, "blockiert", grund); assert.equal(r.grund, grund); assert.ok(r.text.length > 20);
  }
});

test("bereit über die Route: bereit, losgelöst, gesperrt (credential.helper im Vault), ohne Version, Remote ohne Upstream", async () => {
  const v = repo();
  const { rufe } = aufbau(v, { repoJson: privat });
  assert.deepEqual((await rufe("GET", "/api/sicherung/bereit")).j, { zustand: "bereit" });
  assert.equal((await rufe("POST", "/api/sicherung/bereit")).status, 405);

  g(v, "remote", "add", "origin", bare());
  let r = (await rufe("GET", "/api/sicherung/bereit")).j;
  assert.deepEqual([r.zustand, r.grund], ["blockiert", "unfertig"]);
  g(v, "remote", "remove", "origin");

  g(v, "checkout", "-q", "--detach");
  r = (await rufe("GET", "/api/sicherung/bereit")).j;
  assert.deepEqual([r.zustand, r.grund], ["blockiert", "losgeloest"]);
  g(v, "checkout", "-q", "main");

  g(v, "config", "credential.helper", "!echo");
  r = (await rufe("GET", "/api/sicherung/bereit")).j;
  assert.deepEqual([r.zustand, r.grund], ["blockiert", "gesperrt"]);

  const leer = tmp("brain-leer-"); g(leer, "init", "-q", "-b", "main");
  r = (await aufbau(leer, { repoJson: privat }).rufe("GET", "/api/sicherung/bereit")).j;
  assert.deepEqual([r.zustand, r.grund], ["blockiert", "keine-version"]);
});

test("verbinden: sendet ZUERST, trägt origin erst danach ein, setzt den Upstream — nie ein halbes origin im Vault", async () => {
  const v = repo(), ziel = bare();
  // Der Server notiert, welche Remotes der Vault WÄHREND des Empfangs hat.
  const spur = join(tmp("brain-spur-"), "remotes.txt");
  const haken = join(ziel, "hooks", "pre-receive");
  writeFileSync(haken, `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES\ngit -C "$BRAIN_VAULT" remote > "${spur}" 2>&1\n`);
  chmodSync(haken, 0o755);
  const { rufe, aufrufe } = aufbau(v, { repoJson: privat, ziel });
  const r = await rufe("POST", "/api/sicherung/verbinden", VERBINDEN);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.j.ergebnis, "gesendet");
  assert.equal(readFileSync(spur, "utf8").trim(), "", "während des Sendens gab es noch kein origin");
  assert.equal(g(v, "remote").trim(), "origin");
  assert.equal(g(v, "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/main");
  assert.equal(g(ziel, "rev-parse", "main").trim(), g(v, "rev-parse", "HEAD").trim());
  assert.deepEqual(aufrufe, ["/repos/anna-test/mein-brain"]);
  assert.ok(!r.text.includes(TOKEN));
  assert.deepEqual((await rufe("GET", "/api/sicherung/bereit")).j, { zustand: "gesichert" });
  // zweiter Aufruf: nichts mehr zu tun, nichts wird noch einmal gesendet
  const nochmal = await rufe("POST", "/api/sicherung/verbinden", VERBINDEN);
  assert.equal(nochmal.status, 409); assert.equal(nochmal.j.art, "gesichert");
});

test("verbinden: abgelehnter Push → kein origin, Server unverändert (Regel auf dem Server)", async () => {
  const v = repo(), ziel = bare();
  const haken = join(ziel, "hooks", "pre-receive");
  writeFileSync(haken, "#!/bin/sh\necho 'Regel' >&2\nexit 1\n"); chmodSync(haken, 0o755);
  const { rufe } = aufbau(v, { repoJson: privat, ziel });
  const r = await rufe("POST", "/api/sicherung/verbinden", VERBINDEN);
  assert.notEqual(r.status, 200);
  assert.equal(g(v, "remote").trim(), ""); assert.equal(refsVon(ziel), "");
  assert.deepEqual((await rufe("GET", "/api/sicherung/bereit")).j, { zustand: "bereit" }, "nach dem Fehlschlag ist alles wie vorher");
});

test("verbinden: ein öffentliches, archiviertes oder nicht beschreibbares Repository wird abgelehnt, bevor etwas gesendet wird", async () => {
  for (const [j, art] of [[{ ...privat.j, private: false }, "oeffentlich"], [{ ...privat.j, archived: true }, "archiviert"],
    [{ ...privat.j, permissions: { push: false } }, "rechte"], [{ ...privat.j, owner: { login: "anderer" } }, "github"]]) {
    const v = repo(), ziel = bare();
    const { rufe } = aufbau(v, { repoJson: { status: 200, j }, ziel });
    const r = await rufe("POST", "/api/sicherung/verbinden", VERBINDEN);
    assert.equal(r.j.art, art, r.text); assert.ok(r.status >= 400);
    assert.equal(g(v, "remote").trim(), ""); assert.equal(refsVon(ziel), "", "es wurde nichts gesendet");
  }
  const v = repo();
  const { rufe } = aufbau(v, { repoJson: { status: 404, j: {} } });
  assert.equal((await rufe("POST", "/api/sicherung/verbinden", VERBINDEN)).status, 404);
});

test("verbinden: gesperrter Vault, losgelöster Kopf oder ungültige Eingabe → Fehler OHNE einen Aufruf an GitHub", async () => {
  const gesperrt = repo(); g(gesperrt, "config", "credential.helper", "!echo");
  const a = aufbau(gesperrt, { repoJson: privat });
  let r = await a.rufe("POST", "/api/sicherung/verbinden", VERBINDEN);
  assert.equal(r.status, 409); assert.equal(r.j.grund, "gesperrt"); assert.equal(a.aufrufe.length, 0);

  const lose = repo(); g(lose, "checkout", "-q", "--detach");
  const b = aufbau(lose, { repoJson: privat });
  r = await b.rufe("POST", "/api/sicherung/verbinden", VERBINDEN);
  assert.equal(r.status, 409); assert.equal(r.j.grund, "losgeloest"); assert.equal(b.aufrufe.length, 0);

  const ok = repo(), c = aufbau(ok, { repoJson: privat });
  for (const schlecht of [{ besitzer: "../x", name: "a" }, { besitzer: "anna", name: "a/b" }, { besitzer: "anna", name: "" }, { url: "https://evil.example/x.git" }, {}]) {
    r = await c.rufe("POST", "/api/sicherung/verbinden", schlecht);
    assert.equal(r.status, 400, JSON.stringify(schlecht));
  }
  assert.equal(c.aufrufe.length, 0); assert.equal(g(ok, "remote").trim(), "");
});

test("githubHelperArgs: nur github.com, vorherige Helper werden geleert; Studio ohne Angabe unverändert", async () => {
  assert.deepEqual(githubHelperArgs(null), []);
  assert.deepEqual(githubHelperArgs("osxkeychain"), ["-c", "credential.https://github.com.helper=", "-c", "credential.https://github.com.helper=osxkeychain"]);
  assert.throws(() => githubHelperArgs("osxkeychain; rm -rf /"));
  assert.throws(() => githubHelperArgs("!echo"));
  // Wirkung mit echtem git und Schein-Helpern: ein anderer Helper des Nutzers (global) wird für github.com ersetzt, für andere Server nicht.
  const fremd = join(BUND, "git-credential-fremd");
  writeFileSync(fremd, "#!/bin/sh\n[ \"$1\" = get ] && printf 'username=falsch\\npassword=FALSCH\\n'\nexit 0\n"); chmodSync(fremd, 0o755);
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith("GIT_") && k !== "GIT_CONFIG_NOSYSTEM") delete env[k];
  const fill = (host, extra) => execFileSync("git", ["-c", `credential.helper=${fremd}`, ...extra, "credential", "fill"], { input: `protocol=https\nhost=${host}\n\n`, env, encoding: "utf8" });
  assert.match(fill("github.com", []), /password=FALSCH/, "ohne Angabe gilt der Helper des Nutzers");
  const mit = githubHelperArgs(HELPER);
  assert.match(fill("github.com", mit), new RegExp(`password=${TOKEN}`), "mit Angabe: der Schlüsselbund der Anmeldung");
  assert.match(fill("example.org", mit), /password=FALSCH/, "andere Server bleiben beim Helper des Nutzers");
});

test("remoteHinzufuegen ohne githubHelper (Studio): Verhalten und Reihenfolge funktionieren wie zuvor, Upstream gesetzt", async () => {
  const v = repo(), ziel = bare();
  const r = await remoteHinzufuegen(v, ziel);
  assert.equal(r.ergebnis, "gesendet");
  assert.equal(g(v, "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/main");
  assert.ok(existsSync(join(v, ".git")));
});
