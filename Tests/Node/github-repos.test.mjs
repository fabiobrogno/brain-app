// Sicherung (FBL-88): eigene private Repositories listen und anlegen. Kein Netz: GitHub ist eine Schein-fetch-Funktion, der Schlüsselbund ein
// gefälschter Credential-Helper (Datei). Belegt: Anlegen ist IMMER privat, es erscheinen nur private Repos, das Token bleibt im Schlüsselbund.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

process.env.HOME = tmp("brain-home-"); // keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";
const TOKEN = "gho_GEHEIMESTOKEN9876543210zyxwvuTSRQ";

const { erzeugeGitHub, repoNameFehler } = await import(pfad("gemeinsam", "github.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

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
const angemeldet = () => writeFileSync(BUNDDATEI, `username=anna-test\npassword=${TOKEN}\n`);
const abgemeldet = () => rmSync(BUNDDATEI, { force: true });

// Schein-GitHub: antwortet je Aufruf mit dem Ergebnis von `antwort(methode, pfad, body)` und merkt sich alle Aufrufe.
function neu(antwort, extra = {}) {
  const aufrufe = [], logs = [];
  const fetchFn = async (url, o = {}) => {
    const u = new URL(url);
    const a = { methode: o.method || "GET", pfad: u.pathname + u.search, host: u.origin, auth: o.headers?.Authorization || null, body: o.body ? JSON.parse(o.body) : null };
    aufrufe.push(a);
    const r = antwort(a);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.j ?? {}), { status: r.status });
  };
  const gh = erzeugeGitHub({ clientId: "Iv1.testclient", apiBasis: "http://127.0.0.1:1", helper: HELPER, fetch: fetchFn, log: (m) => logs.push(m), ...extra });
  return { gh, aufrufe, logs };
}
const repoZeile = (name, extra = {}) => ({ name, private: true, archived: false, disabled: false, size: 12, owner: { login: "anna-test" }, pushed_at: "2026-10-01T10:00:00Z", ...extra });

test("Anlegen: immer privat — auch wenn die Eingabe etwas anderes verlangt; Token nur im Header, nie in Antwort oder Log", async () => {
  angemeldet();
  const { gh, aufrufe, logs } = neu((a) => ({ status: 201, j: { ...repoZeile(a.body.name), private: a.body.private } }));
  const r = await gh.repoAnlegen({ name: "mein-brain", private: false, visibility: "public" });
  assert.deepEqual(r, { name: "mein-brain", besitzer: "anna-test", url: "https://github.com/anna-test/mein-brain.git", privat: true });
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].methode, "POST"); assert.match(aufrufe[0].pfad, /^\/user\/repos$/);
  assert.equal(aufrufe[0].body.private, true, "private: true muss fest im Aufruf stehen");
  assert.equal(aufrufe[0].body.visibility, undefined, "fremde Felder aus der Eingabe werden nicht weitergereicht");
  assert.equal(aufrufe[0].auth, `Bearer ${TOKEN}`);
  assert.ok(!JSON.stringify([r, logs]).includes(TOKEN));
  assert.ok(!r.url.includes("@"), "keine Zugangsdaten in der Adresse");
});

test("Meldet GitHub das neue Repository nicht als privat, wird es nicht weiterverwendet", async () => {
  angemeldet();
  const { gh } = neu((a) => ({ status: 201, j: repoZeile(a.body.name, { private: false }) }));
  await assert.rejects(gh.repoAnlegen({ name: "oeffentlich" }), (e) => e.status === 502 && e.extra?.art === "github");
});

test("Name vergeben (422) → 409 mit klarem Text; ungültige Namen gehen gar nicht erst zu GitHub", async () => {
  angemeldet();
  const { gh, aufrufe } = neu(() => ({ status: 422, j: { message: "Repository creation failed.", errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" }] } }));
  await assert.rejects(gh.repoAnlegen({ name: "mein-brain" }), (e) => e.status === 409 && e.extra?.art === "name-vergeben" && /schon ein Repository/.test(e.message));
  for (const schlecht of ["", "  ", "mit Leerzeichen", "Über", "a/b", "..", ".", "x.git", "a".repeat(101), null, 5]) {
    await assert.rejects(gh.repoAnlegen({ name: schlecht }), (e) => e.status === 400 && e.extra?.art === "name", `Name ${JSON.stringify(schlecht)}`);
  }
  assert.equal(aufrufe.length, 1, "nur der eine gültige Name erreichte GitHub");
});

test("Namensregeln", () => {
  for (const gut of ["brain", "Mein_Brain-2", "a.b", "x".repeat(100), ".github-sicherung"]) assert.equal(repoNameFehler(gut), null, gut);
  for (const schlecht of ["", "ä", "a b", "..", "foo.git", "foo.GIT", "x".repeat(101)]) assert.ok(repoNameFehler(schlecht), schlecht);
});

test("Liste: nur private, nur eigene, seitenweise; Öffentliches, Archiviertes und Ungültiges erscheint nie", async () => {
  angemeldet();
  const seite1 = Array.from({ length: 100 }, (_, i) => repoZeile(`repo-${i}`));
  seite1[3] = repoZeile("oeffentlich", { private: false }); // vom Server fälschlich geliefert: wird trotzdem nicht gezeigt
  seite1[4] = repoZeile("alt", { archived: true });
  seite1[5] = repoZeile("boes/../pfad");
  seite1[6] = { name: "ohne-besitzer", private: true };
  const seite2 = [repoZeile("letztes", { size: 0, pushed_at: null, updated_at: "2026-09-01T00:00:00Z" })];
  const { gh, aufrufe, logs } = neu((a) => (/page=1$/.test(a.pfad) ? { status: 200, j: seite1 } : { status: 200, j: seite2 }));
  const r = await gh.repos();
  assert.equal(aufrufe.length, 2);
  for (const a of aufrufe) {
    assert.equal(a.methode, "GET");
    assert.match(a.pfad, /^\/user\/repos\?affiliation=owner&visibility=private&/);
    assert.equal(a.auth, `Bearer ${TOKEN}`);
  }
  assert.equal(r.repos.length, 96 + 1);
  const namen = r.repos.map((x) => x.name);
  for (const nie of ["oeffentlich", "alt", "boes/../pfad", "ohne-besitzer"]) assert.ok(!namen.includes(nie), nie);
  assert.deepEqual(r.repos.at(-1), { name: "letztes", besitzer: "anna-test", url: "https://github.com/anna-test/letztes.git", aktualisiert: "2026-09-01T00:00:00Z", leer: true });
  assert.equal(r.repos[0].leer, false);
  assert.ok(r.repos.every((x) => /^https:\/\/github\.com\/anna-test\/[A-Za-z0-9._-]+\.git$/.test(x.url)));
  assert.ok(!JSON.stringify([r, logs]).includes(TOKEN));
  assert.equal(r.gekuerzt, undefined);
});

test("Liste: höchstens 10 Seiten, danach gekürzt", async () => {
  angemeldet();
  const voll = Array.from({ length: 100 }, (_, i) => repoZeile(`r${i}`));
  const { gh, aufrufe } = neu(() => ({ status: 200, j: voll }));
  const r = await gh.repos();
  assert.equal(aufrufe.length, 10); assert.equal(r.gekuerzt, true); assert.equal(r.repos.length, 1000);
});

test("Nicht angemeldet: 401 ohne einen einzigen Aufruf an GitHub; abgelaufenes Token: 401 mit Klartext, ohne Token", async () => {
  abgemeldet();
  const a = neu(() => ({ status: 200, j: [] }));
  await assert.rejects(a.gh.repos(), (e) => e.status === 401 && e.extra?.art === "nicht-angemeldet");
  await assert.rejects(a.gh.repoAnlegen({ name: "x" }), (e) => e.status === 401 && e.extra?.art === "nicht-angemeldet");
  assert.equal(a.aufrufe.length, 0);
  angemeldet();
  const b = neu(() => ({ status: 401, j: { message: `Bad credentials ${TOKEN}` } }));
  await assert.rejects(b.gh.repos(), (e) => e.status === 401 && e.extra?.art === "anmeldung" && !JSON.stringify([e.message, e.extra]).includes(TOKEN));
});

test("Netzfehler und Rate-Limit werden zu verständlichen Fehlern", async () => {
  angemeldet();
  await assert.rejects(neu(() => new TypeError("fetch failed")).gh.repos(), (e) => e.status === 502 && e.extra?.art === "netz");
  await assert.rejects(neu(() => ({ status: 403, j: { message: "rate limit" } })).gh.repos(), (e) => e.status === 429 && e.extra?.art === "limit");
  await assert.rejects(neu(() => ({ status: 403, j: {} })).gh.repoAnlegen({ name: "x" }), (e) => e.status === 403 && e.extra?.art === "limit");
  await assert.rejects(neu(() => ({ status: 200, j: { kaputt: true } })).gh.repos(), (e) => e.status === 502);
});

test("Ohne Client-ID (nicht verfügbar): 404 und kein Aufruf", async () => {
  angemeldet();
  const { gh, aufrufe } = neu(() => ({ status: 200, j: [] }), { clientId: "" });
  await assert.rejects(gh.repos(), (e) => e.status === 404);
  await assert.rejects(gh.repoAnlegen({ name: "x" }), (e) => e.status === 404);
  assert.equal(aufrufe.length, 0);
});

test("Routen über den Handler: GET /api/github/repos, POST /api/github/repo-anlegen, falsche Methode 405", async () => {
  angemeldet();
  const { gh } = neu((a) => (a.methode === "POST" ? { status: 201, j: repoZeile(a.body.name) } : { status: 200, j: [repoZeile("brain")] }));
  const h = erzeugeHandler({ github: gh });
  const rufe = async (methode, p, body) => {
    const r = await h({ methode, pfad: p, query: null, body: body ? Buffer.from(JSON.stringify(body)) : undefined });
    return { status: r.status, text: r.body.toString("utf8"), j: JSON.parse(r.body.toString("utf8")) };
  };
  let r = await rufe("GET", "/api/github/repos");
  assert.equal(r.status, 200); assert.equal(r.j.repos[0].name, "brain"); assert.ok(!r.text.includes(TOKEN));
  r = await rufe("POST", "/api/github/repos"); assert.equal(r.status, 405);
  r = await rufe("GET", "/api/github/repo-anlegen"); assert.equal(r.status, 405);
  r = await rufe("POST", "/api/github/repo-anlegen", { name: "neu-brain" });
  assert.equal(r.status, 200); assert.equal(r.j.url, "https://github.com/anna-test/neu-brain.git"); assert.equal(r.j.privat, true);
  r = await rufe("POST", "/api/github/repo-anlegen", { name: "Über uns" });
  assert.equal(r.status, 400); assert.equal(r.j.art, "name");
});
