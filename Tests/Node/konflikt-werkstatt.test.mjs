// Konflikt-Ansicht über die Werkstatt: Studio-Abgleich lässt die Zusammenführung offen, der Kern (brain abgleich) liefert beide Fassungen, nimmt die
// Entscheidungen, schließt ab, gleicht ab, nimmt zurück. Dazu die gemeinsame Sperre zwischen Studio-Abgleich und Kern-Hintergrund und der Stand
// „Konflikt in N Notizen“ im Git-Status. Nur Wegwerf-Repos und ein Bare-Remote in os.tmpdir(); die Engine selbst prüft Tests/Kern/test-abgleich-konflikt.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { kennung } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };

function mitRemote() {
  const bare = tmp("brain-bare-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo();
  g(a, "remote", "add", "origin", bare);
  g(a, "push", "-q", "-u", "origin", "main");
  const b = tmp("brain-klon-");
  g(b, "clone", "-q", bare, ".");
  g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@Fabios-iPhone.local");
  return { bare, a, b, v: oeffneVault(a) };
}
const commitIn = (d, datei, inhalt, msg, push = false) => { schreibe(d, datei, inhalt); g(d, "add", "--", datei); g(d, "commit", "-q", "-m", msg); if (push) g(d, "push", "-q"); };
const lies = (d, rel) => readFileSync(join(d, rel), "utf8");
async function konfliktAufbauen() {
  const x = mitRemote();
  commitIn(x.b, "start.md", "# Start\nVersion von B\n", "B ändert start\n\nKortex-Geraet: Fabios iPhone", true);
  commitIn(x.a, "start.md", "# Start\nVersion von A\n", "A ändert start");
  const e = await wirft(x.v.gitSync({ konflikteLoesen: true }));
  return { ...x, e };
}

test("Ansicht: beide Fassungen, Gerät und Zeit; die Zusammenführung bleibt dabei offen", async () => {
  const { a, v, e } = await konfliktAufbauen();
  assert.equal(e.status, 409); assert.equal(e.extra.konflikt, true);
  const r = await v.gitKonfliktAnsicht();
  assert.equal(r.aktiv, true); assert.equal(r.modus, "offen");
  assert.equal(r.geraet, "Fabios iPhone");
  assert.equal(r.dateien.length, 1);
  const d = r.dateien[0];
  assert.equal(d.pfad, "start.md"); assert.equal(d.typ, "text");
  assert.equal(d.meine.text, "# Start\nVersion von A\n"); assert.equal(d.andere.text, "# Start\nVersion von B\n");
  assert.ok(d.meine.zeit && d.andere.zeit);
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")));
  assert.equal(r.rueckgaengig.moeglich, false);
});

test("Ansicht ohne Konflikt: aktiv false", async () => {
  const { v } = mitRemote();
  const r = await v.gitKonfliktAnsicht();
  assert.equal(r.aktiv, false); assert.deepEqual(r.dateien, []);
});

test("Lösen: Entscheidung ist ein Eintrag im Verlauf, danach ist alles gesendet (auch ohne bestätigtes Ziel: der Studio-Abgleich sendet)", async () => {
  const { a, b, bare, v } = await konfliktAufbauen();
  const r = await v.gitKonfliktLoesen({ auswahl: [{ pfad: "start.md", wahl: "beide" }] });
  assert.equal(r.ok, true);
  assert.equal(r.kopien.length, 1);
  assert.equal(r.kopien[0].pfad, "start (Fabios iPhone).md");
  assert.equal(lies(a, "start (Fabios iPhone).md"), "# Start\nVersion von B\n");
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n");
  assert.equal(r.abgleich.ok, true, r.abgleich.text);
  assert.equal(g(bare, "rev-parse", "main").trim(), g(a, "rev-parse", "HEAD").trim(), "gesendet");
  assert.match(g(a, "log", "-1", "--format=%s").trim(), /^Konflikt gelöst: „Start“ – beide behalten/);
  assert.equal(g(a, "status", "--porcelain").trim(), "");
  g(b, "pull", "-q", "--ff-only");
  assert.equal(lies(b, "start (Fabios iPhone).md"), "# Start\nVersion von B\n");
  assert.equal((await v.gitStatus()).konflikt, null);
});

test("Lösen prüft die Auswahl (400), kein Konflikt → 409; Fehler des Kerns kommen als HttpFehler mit Status", async () => {
  const { a, v } = await konfliktAufbauen();
  assert.equal((await wirft(v.gitKonfliktLoesen({ auswahl: [] }))).status, 400);
  for (const wahl of ["--theirs", "meine ", "Meine", "", `ext::sh -c "touch x" x`]) assert.equal((await wirft(v.gitKonfliktLoesen({ auswahl: [{ pfad: "start.md", wahl }] }))).status, 400, wahl);
  assert.equal((await wirft(v.gitKonfliktLoesen({ auswahl: [{ pfad: "../x", wahl: "meine" }] }))).status, 400);
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")), "nichts angefasst");
  await v.gitKonfliktAbbrechen();
  assert.equal((await wirft(v.gitKonfliktLoesen({ auswahl: [] }))).status, 409);
});

test("Später (Abbrechen): Arbeitsstand wie vorher; der Konflikt bleibt in der Statusanzeige (Kern-Vermerk)", async () => {
  const { a, v } = await konfliktAufbauen();
  const r = await v.gitKonfliktAbbrechen();
  assert.equal(r.ok, true); assert.equal(r.offen, true);
  assert.equal(existsSync(join(a, ".git", "MERGE_HEAD")), false);
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n");
  const s = await v.gitStatus();
  assert.equal(s.sicherungStand, "konflikt");
  assert.deepEqual(s.sicherungDateien, ["start.md"]);
  assert.equal((await v.gitKonfliktAbbrechen()).offen, false, "zweimal ist harmlos");
});

test("Rückgängig und neu entscheiden über die Routen; Methoden und Fehler der Routen", async () => {
  const leer = mitRemote();
  const hl = erzeugeHandler({ vault: leer.a });
  const rufe = async (methode, p) => { const r = await hl({ methode, pfad: p, query: null }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  const k = await konfliktAufbauen();
  const hk = erzeugeHandler({ vault: k.a });
  const rk = async (methode, p, daten) => {
    const r = await hk({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* egal */ }
    return { status: r.status, j };
  };
  assert.equal((await rufe("GET", "/api/git/konflikt")).j.aktiv, false);
  let r = await rk("GET", "/api/git/konflikt");
  assert.equal(r.status, 200); assert.equal(r.j.dateien[0].andere.text, "# Start\nVersion von B\n");
  assert.equal((await rk("GET", "/api/git/konflikt/loesen")).status, 405);
  assert.equal((await rk("GET", "/api/git/konflikt/rueckgaengig")).status, 405);
  assert.equal((await rk("POST", "/api/git/konflikt/loesen")).status, 400);
  r = await rk("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "andere" }] });
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nVersion von B\n");
  r = await rk("GET", "/api/git/konflikt");
  assert.equal(r.j.aktiv, false); assert.equal(r.j.rueckgaengig.moeglich, true);
  r = await rk("POST", "/api/git/konflikt/rueckgaengig");
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nVersion von A\n");
  const basis = r.j.basis;
  r = await rk("POST", "/api/git/konflikt", { basis });
  assert.equal(r.j.aktiv, true); assert.equal(r.j.modus, "stand"); assert.equal(r.j.dateien[0].andere.text, "# Start\nVersion von B\n");
  r = await rk("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "text", text: "# Start\nzusammen\n" }], basis });
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nzusammen\n");
  assert.equal((await rk("POST", "/api/git/konflikt/rueckgaengig")).status, 200);
  assert.equal((await rk("POST", "/api/git/konflikt/rueckgaengig")).status, 409, "nur einmal");
});

test("Gemeinsame Sperre: solange der Kern-Hintergrund (oder ein anderer Prozess) abgleicht, wartet der Studio-Abgleich — und umgekehrt", async () => {
  const { a, v } = mitRemote();
  const support = process.env.BRAIN_APP_SUPPORT;
  const datei = join(support, "backup", `${kennung(a)}.sperre`);
  mkdirSync(join(support, "backup"), { recursive: true });
  writeFileSync(datei, JSON.stringify({ pid: process.pid, zeit: Date.now(), art: "sicherung", marke: "kern" }));
  const e = await wirft(v.gitSync({}));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "laeuft");
  assert.equal((await wirft(v.gitKonfliktLoesen({ auswahl: [] }))).status, 409);
  assert.equal(existsSync(datei), true, "eine fremde Sperre wird nie freigegeben");
  // verwaist (Prozess nicht mehr da) blockiert nicht
  writeFileSync(datei, JSON.stringify({ pid: 2 ** 22 - 3, zeit: Date.now(), art: "sicherung", marke: "tot" }));
  commitIn(a, "neu.md", "# Neu\n", "neu");
  const r = await v.gitSync({});
  assert.equal(r.ergebnis, "gesendet");
  assert.equal(existsSync(datei), false, "der Studio-Abgleich gibt seine Sperre wieder frei");
});
