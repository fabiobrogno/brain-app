// GitHub-Anmeldung per Gerätecode (FBL-86): Schein-GitHub-Server auf 127.0.0.1 und ein gefälschter Credential-Helper (Datei statt
// Schlüsselbund). Kein echtes Netz, kein echter Schlüsselbund. Belegt auch: Das Token steht nirgends außer im „Schlüsselbund“.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

process.env.HOME = tmp("brain-home-");          // keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";
const SUPPORT = process.env.BRAIN_APP_SUPPORT;
const TOKEN = "gho_GEHEIMESTOKEN1234567890abcdefABCDEF";

const { erzeugeGitHub } = await import(pfad("gemeinsam", "github.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

// ── gefälschter Schlüsselbund: ein Helper-Skript, das alles in einer Datei ablegt ──
const BUND = tmp("brain-bund-");
const BUNDDATEI = join(BUND, "schluesselbund.txt");
process.env.FAKE_BUND = BUNDDATEI;
const HELPER = join(BUND, "git-credential-fake");
writeFileSync(HELPER, `#!/bin/sh
case "$1" in
  store) grep -E '^(username|password)=' > "$FAKE_BUND" ;;
  get) cat "$FAKE_BUND" 2>/dev/null || exit 1 ;;
  erase) rm -f "$FAKE_BUND" ;;
esac
`);
chmodSync(HELPER, 0o755);

// ── Schein-GitHub: antwortet der Reihe nach mit den vorbereiteten Token-Antworten ──
let tokenAntworten = [], anfragen = [];
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d));
  req.on("end", () => {
    anfragen.push({ methode: req.method, url: req.url, body, auth: req.headers.authorization || null });
    const json = (status, j) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url === "/login/device/code") return json(200, { device_code: "DEV123", user_code: "ABCD-1234", verification_uri: `http://127.0.0.1:${server.address().port}/login/device`, expires_in: 900, interval: 5 });
    if (req.url === "/login/oauth/access_token") return json(200, tokenAntworten.shift() || { error: "authorization_pending" });
    if (req.url === "/user") return req.headers.authorization === `Bearer ${TOKEN}` ? json(200, { login: "anna-test" }) : json(401, { message: "Bad credentials" });
    json(404, {});
  });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
after(() => server.close());
const BASIS = () => `http://127.0.0.1:${server.address().port}`;

const sofort = () => { const w = []; return { w, warte: (ms) => { w.push(ms); return new Promise((ok) => setImmediate(ok)); } }; };
function neu(extra = {}) {
  const logs = [], uhr = sofort();
  const gh = erzeugeGitHub({ clientId: "Iv1.testclient", basis: BASIS(), apiBasis: BASIS(), helper: HELPER, warte: uhr.warte, log: (m) => logs.push(m), ...extra });
  return { gh, logs, warten: uhr.w };
}
const bisEnde = async (gh) => { for (let i = 0; i < 1000; i++) { const s = gh.status(); if (s.zustand !== "wartet") return s; await new Promise((ok) => setTimeout(ok, 5)); } assert.fail("Polling endet nicht"); };
const bundWeg = async () => { (await import("node:fs")).rmSync(BUNDDATEI, { force: true }); tokenAntworten = []; anfragen = []; };

function alleDateien(d, aus = []) {
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? alleDateien(p, aus) : aus.push(p); }
  return aus;
}

test("Erfolg: Code → Warten → Token landet nur im Schlüsselbund, Konto wird erkannt", async () => {
  await bundWeg();
  const vault = tmp("brain-vault-"); schreibe(vault, "00_inbox/a.md", "# A\n");
  const { gh, logs, warten } = neu();
  assert.equal(gh.verfuegbar, true);
  tokenAntworten = [{ error: "authorization_pending" }, { error: "authorization_pending" }, { access_token: TOKEN, token_type: "bearer", scope: "repo" }];
  const start = await gh.anmelden();
  assert.deepEqual(Object.keys(start).sort(), ["ablauf", "code", "url"]);
  assert.equal(start.code, "ABCD-1234"); assert.match(start.url, /\/login\/device$/); assert.ok(Date.parse(start.ablauf) > Date.now());
  const ende = await bisEnde(gh);
  assert.deepEqual(ende, { zustand: "fertig", login: "anna-test" });
  assert.deepEqual(warten.slice(0, 3), [5000, 5000, 5000]);
  assert.deepEqual(await gh.konto(), { verfuegbar: true, angemeldet: true, login: "anna-test" });

  // Das Token liegt im Schlüsselbund, mit dem Konto-Namen …
  const bund = readFileSync(BUNDDATEI, "utf8");
  assert.match(bund, /^username=anna-test$/m); assert.ok(bund.includes(`password=${TOKEN}`));
  // … und sonst nirgends: keine Antwort, kein Log, keine Datei unter Support/Vault/Home.
  const ausgaben = JSON.stringify([start, gh.status(), ende, await gh.konto(), logs]);
  assert.ok(!ausgaben.includes(TOKEN), "Token in einer Antwort oder einem Log");
  for (const wurzel of [SUPPORT, vault, process.env.HOME]) for (const f of alleDateien(wurzel)) assert.ok(!readFileSync(f).includes(TOKEN), `Token in ${f}`);
  // Anfrage an GitHub: client_id und Gerätecode, aber nie das Token als Zugangsdaten außer beim Konto-Abruf.
  assert.ok(anfragen.some((a) => a.url === "/login/device/code" && /client_id=Iv1.testclient/.test(a.body) && /scope=repo/.test(a.body)));
});

test("slow_down erhöht den Abstand um 5 s; ohne Antwort-Intervall wird weitergepollt", async () => {
  await bundWeg();
  const { gh, warten } = neu();
  tokenAntworten = [{ error: "authorization_pending" }, { error: "slow_down" }, { error: "authorization_pending" }, { access_token: TOKEN }];
  await gh.anmelden();
  assert.equal((await bisEnde(gh)).zustand, "fertig");
  assert.deepEqual(warten, [5000, 5000, 10000, 10000]);
});

test("expired_token → abgelaufen, access_denied → abgelehnt; kein Token im Schlüsselbund", async () => {
  await bundWeg();
  let t = neu();
  tokenAntworten = [{ error: "expired_token" }];
  await t.gh.anmelden();
  assert.equal((await bisEnde(t.gh)).zustand, "abgelaufen");
  t = neu();
  tokenAntworten = [{ error: "authorization_pending" }, { error: "access_denied" }];
  await t.gh.anmelden();
  assert.equal((await bisEnde(t.gh)).zustand, "abgelehnt");
  assert.ok(!existsSync(BUNDDATEI));
  assert.deepEqual(await t.gh.konto(), { verfuegbar: true, angemeldet: false });
});

test("Code läuft nach der Frist ab (eigene Uhr); unbekannter Serverfehler endet ohne Servertext", async () => {
  await bundWeg();
  let ms = 1_000_000;
  const a = neu({ jetzt: () => ms, warte: async () => { ms += 1_000_000; } });
  await a.gh.anmelden();
  assert.equal((await bisEnde(a.gh)).zustand, "abgelaufen");
  const b = neu();
  tokenAntworten = [{ error: "incorrect_client_credentials", error_description: "GEHEIM-HINWEIS" }];
  await b.gh.anmelden();
  const e = await bisEnde(b.gh);
  assert.equal(e.zustand, "abgelehnt"); assert.ok(!JSON.stringify(e).includes("GEHEIM-HINWEIS"));
});

test("Netzfehler beim Polling (Schlaf, kurz offline) brechen die Anmeldung nicht ab", async () => {
  await bundWeg();
  let n = 0;
  const echt = globalThis.fetch;
  const wackelig = (url, o) => (String(url).endsWith("/login/oauth/access_token") && ++n <= 2 ? Promise.reject(new TypeError("fetch failed")) : echt(url, o));
  const { gh } = neu({ fetch: wackelig });
  tokenAntworten = [{ access_token: TOKEN }];
  await gh.anmelden();
  assert.equal((await bisEnde(gh)).zustand, "fertig"); assert.ok(n >= 3);
});

test("Abmelden entfernt das Konto aus dem Schlüsselbund; ein neuer Start ersetzt ein laufendes Polling", async () => {
  await bundWeg();
  const { gh } = neu();
  tokenAntworten = [{ access_token: TOKEN }];
  await gh.anmelden(); await bisEnde(gh);
  assert.ok(existsSync(BUNDDATEI));
  assert.deepEqual(await gh.abmelden(), { ok: true });
  assert.ok(!existsSync(BUNDDATEI));
  assert.deepEqual(await gh.konto(), { verfuegbar: true, angemeldet: false });
  assert.deepEqual(gh.status(), { zustand: "keiner" });
});

test("Ohne Client-ID: nicht verfügbar, Logeintrag, kein Absturz; falsche Client-ID wird abgelehnt", async () => {
  const { gh, logs } = neu({ clientId: "" });
  assert.equal(gh.verfuegbar, false); assert.equal(logs.length, 1); assert.match(logs[0], /fehlt/);
  await assert.rejects(gh.anmelden(), (e) => e.status === 404 && e.extra?.art === "nicht-eingerichtet");
  assert.deepEqual(await gh.konto(), { verfuegbar: false, angemeldet: false });
  assert.deepEqual(await gh.abmelden(), { ok: true });
  assert.equal(neu({ clientId: "x y;$" }).gh.verfuegbar, false);
});

test("Fremde Adresse im Gerätecode-Antwort wird nicht übernommen", async () => {
  const boese = async (url, o) => (String(url).endsWith("/login/device/code")
    ? new Response(JSON.stringify({ device_code: "d", user_code: "X", verification_uri: "https://boese.example/login", expires_in: 900, interval: 5 }), { status: 200 })
    : fetch(url, o));
  const { gh } = neu({ fetch: boese });
  await assert.rejects(gh.anmelden(), (e) => e.status === 502);
});

test("Routen über den Handler: anmelden (POST/GET), konto, abmelden; Methoden; ohne Vault; Token nie in der Antwort", async () => {
  await bundWeg();
  const { gh } = neu();
  const h = erzeugeHandler({ github: gh });
  const rufe = async (methode, p) => { const r = await h({ methode, pfad: p, query: null }); return { status: r.status, text: r.body.toString("utf8"), j: JSON.parse(r.body.toString("utf8")) }; };
  tokenAntworten = [{ error: "authorization_pending" }, { access_token: TOKEN }];
  let r = await rufe("POST", "/api/github/anmelden");
  assert.equal(r.status, 200); assert.equal(r.j.code, "ABCD-1234");
  r = await rufe("GET", "/api/github/anmelden");
  assert.equal(r.status, 200); assert.ok(["wartet", "fertig"].includes(r.j.zustand));
  await bisEnde(gh);
  r = await rufe("GET", "/api/github/anmelden"); assert.deepEqual(r.j, { zustand: "fertig", login: "anna-test" }); assert.ok(!r.text.includes(TOKEN));
  r = await rufe("GET", "/api/github/konto"); assert.deepEqual(r.j, { verfuegbar: true, angemeldet: true, login: "anna-test" }); assert.ok(!r.text.includes(TOKEN));
  assert.equal((await rufe("POST", "/api/github/konto")).status, 405);
  assert.equal((await rufe("GET", "/api/github/abmelden")).status, 405);
  assert.equal((await rufe("PUT", "/api/github/anmelden")).status, 405);
  r = await rufe("POST", "/api/github/abmelden"); assert.equal(r.status, 200);
  assert.deepEqual((await rufe("GET", "/api/github/konto")).j, { verfuegbar: true, angemeldet: false });
  // Handler ohne Client-ID: Anmelden → 404 mit art, Konto → verfügbar:false
  const aus = erzeugeHandler({ github: neu({ clientId: "" }).gh });
  const r2 = await aus({ methode: "POST", pfad: "/api/github/anmelden", query: null });
  assert.equal(r2.status, 404);
});
