// Konflikt-Ansicht über die Werkstatt, Teil 2: Prüfung der Auswahl, Kern-Befehle unter der Sperre, gemerkter Stand. Hilfen: konflikt-werkstatt-hilfe.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, g, pfad, erzeugeHandler, kennung, wirft, mitRemote, commitIn, lies, loesen, konfliktAufbauen } from "./konflikt-werkstatt-hilfe.mjs";

test("Lösen prüft die Auswahl (400), kein Konflikt → 409; Fehler des Kerns kommen als HttpFehler mit Status", async () => {
  const { a, v } = await konfliktAufbauen();
  assert.equal((await wirft(loesen(v, []))).status, 400);
  for (const wahl of ["--theirs", "meine ", "Meine", "", `ext::sh -c "touch x" x`]) assert.equal((await wirft(loesen(v, [{ pfad: "start.md", wahl }]))).status, 400, wahl);
  assert.equal((await wirft(loesen(v, [{ pfad: "../x", wahl: "meine" }]))).status, 400);
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")), "nichts angefasst");
  await v.gitKonfliktAbbrechen();
  assert.equal((await wirft(loesen(v, []))).status, 409);
});

test("Kern-Befehle laufen unter der Sperre im Prozess und warten kurz (statt gleich 409): ein Abgleich und ein Kern-Befehl kollidieren nicht auf dem Index", async () => {
  const gitFn = await import(pfad("gemeinsam", "git.mjs"));
  const wurzel = tmp("brain-sperre-");
  const zeiten = [];
  const arbeit = (name, ms) => gitFn.gitExklusiv(wurzel, async () => { zeiten.push(`${name}+`); await new Promise((ok) => setTimeout(ok, ms)); zeiten.push(`${name}-`); return name; });
  const t0 = Date.now();
  const [x, y] = await Promise.allSettled([arbeit("a", 300), arbeit("b", 10)]);
  assert.equal(x.status, "fulfilled"); assert.equal(y.status, "fulfilled", "der zweite wartet, statt abgelehnt zu werden");
  assert.deepEqual(zeiten, ["a+", "a-", "b+", "b-"], "nie gleichzeitig");
  assert.ok(Date.now() - t0 >= 290);
  // länger als die Wartezeit: dann 409
  const lang = gitFn.gitExklusiv(wurzel, () => new Promise((ok) => setTimeout(ok, 700)));
  await new Promise((ok) => setTimeout(ok, 20));
  const kurz = await wirft(gitFn.gitExklusiv(wurzel, async () => 1, 100));
  assert.equal(kurz.status, 409); assert.match(kurz.message, /Abgleich läuft schon/);
  await lang;
  // über die Werkstatt: Später neben einem laufenden Studio-Abgleich bricht nicht mit einer Kollision ab
  const { v } = await konfliktAufbauen();
  await v.gitKonfliktAbbrechen();
  const [s, r] = await Promise.allSettled([v.gitSync({}), v.gitKonfliktRueckgaengig()]);
  assert.ok(r.status === "fulfilled" || r.reason.status === 409, String(r.reason && r.reason.message));
  if (r.status === "rejected") assert.doesNotMatch(r.reason.message, /index\.lock/);
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
