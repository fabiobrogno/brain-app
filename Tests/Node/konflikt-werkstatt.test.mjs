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
const { kennung, merkeRemoteBestaetigt } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };

function mitRemote({ bestaetigt = true } = {}) {
  const bare = tmp("brain-bare-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo();
  g(a, "remote", "add", "origin", bare);
  g(a, "push", "-q", "-u", "origin", "main");
  const b = tmp("brain-klon-");
  g(b, "clone", "-q", bare, ".");
  g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@Fabios-iPhone.local");
  if (bestaetigt) merkeRemoteBestaetigt(a, bare, { support: process.env.BRAIN_APP_SUPPORT }); // das Ziel ist vom Nutzer bestätigt (Assistent „Sicherung“)
  return { bare, a, b, v: oeffneVault(a) };
}
const commitIn = (d, datei, inhalt, msg, push = false) => { schreibe(d, datei, inhalt); g(d, "add", "--", datei); g(d, "commit", "-q", "-m", msg); if (push) g(d, "push", "-q"); };
const lies = (d, rel) => readFileSync(join(d, rel), "utf8");
// Lösen wie die Oberfläche: mit dem gesehenen Stand
const loesen = async (v, auswahl) => { const an = await v.gitKonfliktAnsicht(); return v.gitKonfliktLoesen({ auswahl, gesehen: { meine: an.meine, andere: an.andere } }); };
async function konfliktAufbauen(opt) {
  const x = mitRemote(opt);
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
  const r = await loesen(v, [{ pfad: "start.md", wahl: "beide" }]);
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
  assert.equal((await wirft(loesen(v, []))).status, 400);
  for (const wahl of ["--theirs", "meine ", "Meine", "", `ext::sh -c "touch x" x`]) assert.equal((await wirft(loesen(v, [{ pfad: "start.md", wahl }]))).status, 400, wahl);
  assert.equal((await wirft(loesen(v, [{ pfad: "../x", wahl: "meine" }]))).status, 400);
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")), "nichts angefasst");
  await v.gitKonfliktAbbrechen();
  assert.equal((await wirft(loesen(v, []))).status, 409);
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
  const r0 = await rk("GET", "/api/git/konflikt");
  let r = r0;
  assert.equal(r.status, 200); assert.equal(r.j.dateien[0].andere.text, "# Start\nVersion von B\n");
  assert.equal((await rk("GET", "/api/git/konflikt/loesen")).status, 405);
  assert.equal((await rk("GET", "/api/git/konflikt/rueckgaengig")).status, 405);
  assert.equal((await rk("POST", "/api/git/konflikt/loesen")).status, 400);
  r = await rk("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "andere" }], gesehen: { meine: r0.j.meine, andere: r0.j.andere } });
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nVersion von B\n");
  r = await rk("GET", "/api/git/konflikt");
  assert.equal(r.j.aktiv, false); assert.equal(r.j.rueckgaengig.moeglich, true);
  r = await rk("POST", "/api/git/konflikt/rueckgaengig");
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nVersion von A\n");
  // der gemerkte Stand kommt aus dem Support-Ordner; die Oberfläche schickt keinen
  r = await rk("GET", "/api/git/konflikt");
  assert.equal(r.j.aktiv, true); assert.equal(r.j.modus, "stand"); assert.equal(r.j.haelt, true); assert.equal(r.j.dateien[0].andere.text, "# Start\nVersion von B\n");
  assert.equal((await rk("POST", "/api/git/konflikt", {})).status, 405);
  // solange der Stand wartet, sendet auch der Studio-Abgleich nichts: 409 mit dem Hinweis auf den Konflikt
  r = await rk("POST", "/api/git/sync", {});
  assert.equal(r.status, 409); assert.equal(r.j.haelt, true); assert.equal(r.j.konflikt, true);
  r = await rk("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "text", text: "# Start\nzusammen\n" }], gesehen: { meine: r0.j.meine, andere: r0.j.andere } });
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
  assert.equal((await wirft(loesen(v, []))).status, 409);
  assert.equal(existsSync(datei), true, "eine fremde Sperre wird nie freigegeben");
  // verwaist (Prozess nicht mehr da) blockiert nicht
  writeFileSync(datei, JSON.stringify({ pid: 2 ** 22 - 3, zeit: Date.now(), art: "sicherung", marke: "tot" }));
  commitIn(a, "neu.md", "# Neu\n", "neu");
  const r = await v.gitSync({});
  assert.equal(r.ergebnis, "gesendet");
  assert.equal(existsSync(datei), false, "der Studio-Abgleich gibt seine Sperre wieder frei");
});

test("Umstellung (Phase B) läuft: Abgleich, Lösen, Später und Rückgängig melden 409 „Kortex räumt gerade auf“, die Ansicht bleibt lesbar", async () => {
  const { a, v } = await konfliktAufbauen();
  mkdirSync(join(a, ".logs"), { recursive: true });
  const sperre = join(a, ".logs", "umstellung-phase-b.lock");
  writeFileSync(sperre, JSON.stringify({ pid: process.pid, zeit: new Date().toISOString() }));
  for (const f of [() => v.gitSync({}), () => v.gitKonfliktLoesen({ auswahl: [{ pfad: "start.md", wahl: "meine" }], gesehen: {} }), () => v.gitKonfliktAbbrechen(), () => v.gitKonfliktRueckgaengig()]) {
    const e = await wirft(f()); assert.equal(e.status, 409); assert.match(e.message, /räumt gerade/);
  }
  assert.equal((await v.gitKonfliktAnsicht()).aktiv, true);
  writeFileSync(sperre, JSON.stringify({ pid: process.pid, zeit: new Date(Date.now() - 2 * 3600_000).toISOString() })); // zu alt: zählt nicht
  assert.equal((await loesen(v, [{ pfad: "start.md", wahl: "meine" }])).ok, true);
});

test("Ohne bestätigtes Ziel sendet das Lösen nicht (nur ein Hinweis), auch nicht über den Studio-Abgleich — dieselbe Regel wie bei der Sicherung", async () => {
  const { a, bare, v } = await konfliktAufbauen({ bestaetigt: false });
  const vorher = g(bare, "rev-parse", "main").trim();
  const r = await loesen(v, [{ pfad: "start.md", wahl: "meine" }]);
  assert.equal(r.ok, true);
  assert.equal(r.abgleich.art, "nicht-bestaetigt"); assert.equal(r.abgleich.ok, false);
  assert.equal(g(bare, "rev-parse", "main").trim(), vorher, "nichts gesendet");
  assert.equal(g(a, "status", "--porcelain").trim(), "");
});

test("Zusammenführung, die nicht über den Studio-Abgleich begonnen wurde: Ansicht ja (fremd), Lösen und Später 409; der Studio-Abgleich markiert seine eigene", async () => {
  const { a, b, v } = mitRemote();
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  commitIn(a, "start.md", "# Start\nA\n", "A");
  g(a, "fetch", "-q", "origin");
  assert.throws(() => g(a, "merge", "--no-edit", "origin/main"));
  const an = await v.gitKonfliktAnsicht();
  assert.equal(an.fremd, true);
  assert.equal((await wirft(loesen(v, [{ pfad: "start.md", wahl: "meine" }]))).extra.art, "fremd");
  assert.equal((await wirft(v.gitKonfliktAbbrechen())).extra.art, "fremd");
  g(a, "merge", "--abort");
  await wirft(v.gitSync({ konflikteLoesen: true }));
  assert.equal((await v.gitKonfliktAnsicht()).fremd, false, "der Studio-Abgleich hat die Marke gesetzt");
});

test("Kern-Befehle laufen unter der Sperre im Prozess: neben einem laufenden Abgleich gibt es 409 „läuft schon“ statt einer Kollision auf dem Index", async () => {
  const { v } = await konfliktAufbauen();
  await v.gitKonfliktAbbrechen();
  const [s, r] = await Promise.allSettled([v.gitSync({}), v.gitKonfliktRueckgaengig()]);
  assert.equal(r.status, "rejected"); assert.equal(r.reason.status, 409); assert.match(r.reason.message, /Abgleich läuft schon/);
  void s;
});

test("Gemerkter Stand: Status meldet seit wann die Sicherung wartet (Tage); Verwerfen räumt ihn, der Verlauf bleibt; zweimal ist 409", async () => {
  const { a, v } = await konfliktAufbauen();
  const h = erzeugeHandler({ vault: a });
  const rufe = async (methode, p) => { const r = await h({ methode, pfad: p, query: null }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  await loesen(v, [{ pfad: "start.md", wahl: "andere" }]);
  assert.equal((await v.gitStatus()).sicherungHaelt, null, "nichts gemerkt, nichts blockiert");
  await v.gitKonfliktRueckgaengig();
  let s = await v.gitStatus();
  assert.equal(s.sicherungStand, "konflikt"); assert.equal(s.sicherungHaelt.tage, 0);
  // fünf Tage alt: die Oberfläche kann es deutlich sagen
  const support = process.env.BRAIN_APP_SUPPORT, dir = join(support, "backup");
  const datei = join(dir, `${kennung(a)}.json`);
  const m = JSON.parse(readFileSync(datei, "utf8")); m.konfliktBasis.zeit = new Date(Date.now() - 5 * 86_400_000).toISOString(); writeFileSync(datei, JSON.stringify(m));
  s = await v.gitStatus();
  assert.equal(s.sicherungHaelt.tage, 5);
  assert.equal((await rufe("GET", "/api/git/konflikt/verwerfen")).status, 405);
  const kopfVorher = g(a, "rev-parse", "HEAD").trim();
  const r = await rufe("POST", "/api/git/konflikt/verwerfen");
  assert.equal(r.status, 200); assert.equal(r.j.ok, true);
  s = await v.gitStatus();
  assert.equal(s.sicherungHaelt, null); assert.equal(s.sicherungStand, null);
  assert.equal(g(a, "rev-parse", "HEAD").trim(), kopfVorher, "der Verlauf ist unberührt");
  assert.equal((await rufe("POST", "/api/git/konflikt/verwerfen")).status, 409);
  assert.equal((await v.gitKonfliktAnsicht()).aktiv, false);
});

test("Übernehmen über die Werkstatt: eine ältere Zusammenführung ohne Marke wird nach Bestätigung zur eigenen; Methode und Fehler der Route", async () => {
  const { a, b, v } = mitRemote();
  const h = erzeugeHandler({ vault: a });
  const rufe = async (methode, p) => { const r = await h({ methode, pfad: p, query: null }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  assert.equal((await rufe("POST", "/api/git/konflikt/uebernehmen")).status, 409, "keine offene Zusammenführung");
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  commitIn(a, "start.md", "# Start\nA\n", "A");
  g(a, "fetch", "-q", "origin");
  assert.throws(() => g(a, "merge", "--no-edit", "origin/main"));
  const an = await v.gitKonfliktAnsicht();
  assert.equal(an.fremd, true); assert.equal(an.uebernehmbar, true);
  assert.equal((await rufe("GET", "/api/git/konflikt/uebernehmen")).status, 405);
  assert.equal((await rufe("POST", "/api/git/konflikt/uebernehmen")).status, 200);
  assert.equal((await v.gitKonfliktAnsicht()).fremd, false);
  assert.equal((await loesen(v, [{ pfad: "start.md", wahl: "meine" }])).ok, true);
});
