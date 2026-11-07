// Review 5 (#95): eigener Ordner .kortex-lokal (.kortex gehört der Umstellung), Journal-Grenzen, Ordner-Restore-Fenster, Geisterordner, gelöschtes .kortex-lokal. Nur Wegwerf-Ordner (tmp).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync, renameSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmp, schreibe, pfad, repo, g } from "./hilfe.mjs";
import { systemPfad } from "./attrappe.mjs";
import { heim, istAbsturz } from "./umgebung-win.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const KIND = join(dirname(fileURLToPath(import.meta.url)), "umbenennen-kind.mjs");
const lies = (d, p) => readFileSync(join(d, p), "utf8");
async function fehler(fn) { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); }
function aufbau(dateien = {}) {
  const d = realpathSync(tmp("r5-vault-")), support = realpathSync(tmp("r5-support-"));
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  return { d, support, v: oeffneVault(d, { support, heute: "2026-11-05" }) };
}
const vorgangsDir = (d, id) => join(d, ".kortex-lokal", "papierkorb", "vorgaenge", id);
const manifestPfad = (d, id) => join(vorgangsDir(d, id), "manifest.json");
function setze(d, id, f) { const mf = manifestPfad(d, id); const m = JSON.parse(readFileSync(mf, "utf8")); f(m); writeFileSync(mf, JSON.stringify(m)); }
function absturz({ d, support, methode, eingabe, punkt }) {
  return new Promise((ok, nein) => {
    const env = { PATH: systemPfad(), ...heim(tmp("r5-home-")), TMPDIR: process.env.TMPDIR || tmpdir(), BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", TZ: "Europe/Berlin" };
    const k = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode, eingabe, punkt })], { env, stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; k.stderr.on("data", (x) => { err += x; });
    k.on("exit", (code, signal) => (istAbsturz(code, signal) ? ok() : nein(new Error(`Kind: ${code} ${signal} ${err}`))));
  });
}

test(".kortex gehört der Umstellung: nach Papierkorb-Aktionen klappt `git add .kortex/geraete/x.json`, .kortex bleibt unberührt (keine .gitignore darin), .kortex-lokal ist ignoriert", async () => {
  const d = realpathSync(repo("r5-git-")), support = realpathSync(tmp("r5-sup-"));
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "n.md", "# n\n"); schreibe(d, ".kortex/geraete/x.json", "{}\n"); schreibe(d, ".kortex/versionen/v.json", "{}\n");
  g(d, "add", "--", "brain.config.json", "n.md"); g(d, "commit", "-q", "-m", "x");
  const vorher = readdirSync(join(d, ".kortex")).sort().join();
  const v = oeffneVault(d, { support });
  const r = await v.loeschen({ pfad: "n.md" });
  await v.papierkorbWiederherstellen({ id: r.vorgang });
  g(d, "add", ".kortex/geraete/x.json");
  assert.match(g(d, "status", "--porcelain"), /A\s+\.kortex\/geraete\/x\.json/);
  assert.equal(readdirSync(join(d, ".kortex")).sort().join(), vorher, ".kortex ist unberührt");
  assert.equal(lies(d, ".kortex-lokal/.gitignore"), "*\n");
  assert.equal(g(d, "status", "--porcelain").includes(".kortex-lokal"), false);
});

test("Ein Vault ohne .kortex bekommt keins: unsere Dateien liegen nur in .kortex-lokal", async () => {
  const { d, v } = aufbau({ "a.md": "# a\n" });
  await v.loeschen({ pfad: "a.md" });
  assert.ok(!existsSync(join(d, ".kortex"))); assert.ok(existsSync(join(d, ".kortex-lokal", "papierkorb")));
});

test("Journal-Grenzen: Rückgängig-Journale nach 30 Tagen weg, 50 MB-Grenze, gelöschte Notizen (auch nach 400 Tagen) und unklare Vorgänge nie", async () => {
  const { d, v } = aufbau({ "a/n0.md": "# n0\n", "a/n1.md": "# n1\n", "a/n2.md": "# n2\n", "a/n3.md": "# n3\n", "a/n5.md": "# n5\n", "l.md": "[[n0]] [[n1]] [[n2]] [[n3]]\n" });
  const geloescht = await v.loeschen({ pfad: "a/n5.md" });
  const ids = [];
  for (const i of [0, 1, 2, 3]) ids.push((await v.umbenennen({ pfad: `a/n${i}.md`, dateiname: `x${i}.md` })).vorgang);
  setze(d, ids[0], (m) => { m.zeit = new Date(Date.now() - 40 * 86400e3).toISOString(); });
  setze(d, ids[1], (m) => { m.zeit = new Date(Date.now() - 41 * 86400e3).toISOString(); m.status = "unklar"; });
  setze(d, geloescht.vorgang, (m) => { m.zeit = new Date(Date.now() - 400 * 86400e3).toISOString(); });
  await v.umbenennen({ pfad: "a/x2.md", dateiname: "y2.md" });
  assert.ok(!existsSync(vorgangsDir(d, ids[0])), "älter als 30 Tage: weg");
  assert.ok(existsSync(vorgangsDir(d, ids[1])), "unklar bleibt");
  assert.ok(existsSync(vorgangsDir(d, geloescht.vorgang)), "gelöschte Notiz nie automatisch");
  // 50 MB: ein riesiges Journal drängt ältere hinaus (das neueste bleibt immer)
  const neuer = (await v.umbenennen({ pfad: "a/x3.md", dateiname: "y3.md" })).vorgang;
  setze(d, neuer, (m) => { m.zeit = new Date(Date.now() - 3 * 3600e3).toISOString(); });
  setze(d, ids[2], (m) => { m.groesse = 60 * 1024 * 1024; m.zeit = new Date(Date.now() - 3600e3).toISOString(); });
  await v.umbenennen({ pfad: "a/y3.md", dateiname: "z3.md" });
  const rest = readdirSync(join(d, ".kortex-lokal/papierkorb/vorgaenge"));
  assert.ok(rest.includes(geloescht.vorgang) && rest.includes(ids[1]));
  assert.ok(!rest.includes(neuer) && !rest.includes(ids[2]), "über der 50-MB-Grenze: die ältesten zuerst weg (das neueste Journal bleibt immer)");
});

test("Journal-Grenze 100: nach 105 Umbenennungen bleiben die letzten 100 Journale (und der Papierkorb-Eintrag)", async () => {
  const { d, v } = aufbau({ "a/n.md": "# n\n", "b/t.md": "# t\n" });
  const g1 = await v.loeschen({ pfad: "b/t.md" });
  let name = "n";
  for (let i = 0; i < 105; i++) { const neu = `n${i}`; await v.umbenennen({ pfad: `a/${name}.md`, dateiname: `${neu}.md` }); name = neu; }
  const vz = readdirSync(join(d, ".kortex-lokal/papierkorb/vorgaenge"));
  const manifeste = vz.map((n) => JSON.parse(readFileSync(manifestPfad(d, n), "utf8")));
  assert.equal(manifeste.filter((m) => m.art === "umbenennen").length, 100);
  assert.ok(vz.includes(g1.vorgang));
});

test("„Papierkorb leeren“ meldet die Größe und entfernt auch alte Rückgängig-Journale (nie laufende/unklare); entferneKopien findet Kopien über den Vorgang (Pfad nach der Aktion)", async () => {
  const { d, v } = aufbau({ "ord/n.md": "# n\n[[x]]\n", "x.md": "# x\n", "b/L.md": "# L\n[[x]]\n" });
  const rOrd = await v.umbenennen({ typ: "ordner", pfad: "ord", name: "ord2" }); // Journal enthält ord/n.md (Pfad VOR der Aktion); die Notiz liegt jetzt unter ord2/n.md
  const geloescht = await v.loeschen({ pfad: "ord2/n.md" });
  await v.papierkorbEndgueltig({ id: geloescht.vorgang });
  const m = JSON.parse(readFileSync(manifestPfad(d, rOrd.vorgang), "utf8"));
  assert.ok(!m.dateien.some((x) => x.pfad === "ord/n.md"), "die Kopie der gelöschten Notiz ist auch dort entfernt");
  setze(d, rOrd.vorgang, (mm) => { mm.groesse = 4096; });
  const rU = await v.umbenennen({ pfad: "x.md", dateiname: "y.md" });
  setze(d, rU.vorgang, (mm) => { mm.status = "unklar"; });
  const liste = await v.papierkorb();
  assert.ok(liste.groesse > 0 && liste.journale.anzahl >= 1);
  const e = await v.papierkorbEndgueltig({ alle: true });
  assert.ok(e.freigegeben > 0);
  assert.ok(!existsSync(vorgangsDir(d, rOrd.vorgang)), "altes Rückgängig-Journal weg");
  assert.ok(existsSync(vorgangsDir(d, rU.vorgang)), "unklar bleibt");
});

test("Ordner-Restore, SIGKILL zwischen mkdir und rename: das leere Ziel wird abgeräumt, der Inhalt liegt noch im Papierkorb und lässt sich danach wiederherstellen", async () => {
  const { d, support, v } = aufbau({ "p/a.md": "# a\n", "p/u/b.md": "# b\n" });
  const r = await v.loeschen({ typ: "ordner", pfad: "p" });
  await absturz({ d, support, methode: "papierkorbWiederherstellen", eingabe: { id: r.vorgang }, punkt: "restore-nach-mkdir" });
  assert.ok(existsSync(join(d, "p")) && readdirSync(join(d, "p")).length === 0, "Zustand nach dem Absturz: leerer Zielordner");
  const v2 = oeffneVault(d, { support });
  const liste = await v2.papierkorb();
  assert.ok(!existsSync(join(d, "p")), "das leere Ziel ist abgeräumt");
  assert.equal(liste.eintraege.length, 1); assert.deepEqual(liste.hinweise, []);
  await v2.papierkorbWiederherstellen({ id: r.vorgang });
  assert.equal(lies(d, "p/u/b.md"), "# b\n");
});

test("Der Vault-Ordner ist weg (umgezogen): 409 „gibt es nicht mehr“, kein Geister-.kortex-lokal am alten Pfad", async () => {
  const { d, v } = aufbau({ "a.md": "# a\n" });
  const eltern = realpathSync(tmp("r5-weg-")); renameSync(d, join(eltern, "umgezogen"));
  const e = await fehler(() => v.loeschen({ pfad: "a.md" }));
  assert.equal(e.extra.art, "kein-vault");
  assert.ok(!existsSync(d), "am alten Pfad entsteht nichts");
});

test("Löscht jemand .kortex-lokal mitten in der Aktion, gibt es eine verständliche Meldung statt eines rohen ENOENT", async () => {
  const { d, support } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const v = oeffneVault(d, { support, dateiHaken: { punkt: (n) => { if (n === "nach-umzug") rmSync(join(d, ".kortex-lokal"), { recursive: true, force: true }); } } });
  const e = await fehler(() => v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }));
  assert.equal(e.extra.art, "kortex-lokal-weg"); assert.match(e.message, /\.kortex-lokal/);
});
