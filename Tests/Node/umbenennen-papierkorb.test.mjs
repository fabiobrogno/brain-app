// Papierkorb nur per rename (nie Kopieren über Laufwerksgrenzen), Ort je Gerät, Erholung nach echtem SIGKILL, Sperre mit PID-Prüfung, Aufräumen. Nur Wegwerf-Ordner (tmp).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, utimesSync, lstatSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { tmp, schreibe, pfad, repo, g } from "./hilfe.mjs";
import { systemPfad } from "./attrappe.mjs";
import { heim, istAbsturz } from "./umgebung-win.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const { prozessStart } = await import(pfad("gemeinsam", "plattform.mjs"));
const KIND = join(dirname(fileURLToPath(import.meta.url)), "umbenennen-kind.mjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const lies = (d, p) => readFileSync(join(d, p), "utf8");
async function fehler(fn) { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); }
const exdev = () => { const e = new Error("EXDEV"); e.code = "EXDEV"; throw e; };
function stand(d) { // alle Dateien (Hash) und Ordner ohne Punkt-Ordner
  const dateien = {}, ordner = [];
  const geh = (rel) => {
    for (const n of readdirSync(rel ? join(d, rel) : d).sort()) {
      if (n.startsWith(".")) continue;
      const r = rel ? `${rel}/${n}` : n;
      if (lstatSync(join(d, r)).isDirectory()) { ordner.push(r); geh(r); } else dateien[r] = sha(readFileSync(join(d, r)));
    }
  };
  geh("");
  return { dateien, ordner };
}
function aufbau(dateien = {}, opts = {}) {
  const d = tmp("upk-vault-"), support = tmp("upk-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  const v = oeffneVault(d, { support, heute: "2026-11-05", ...opts });
  return { d, support, v, kennung: null };
}
const jDir = (d, id) => join(d, ".kortex-lokal", "papierkorb", "vorgaenge", id);
// Kindprozess mit ausdrücklich gebauter Umgebung (nie die des Testlaufs), beendet sich am Punkt mit SIGKILL
function absturz({ d, support, methode, eingabe, punkt }) {
  return new Promise((ok, nein) => {
    const home = tmp("upk-home-");
    const env = { PATH: systemPfad(), ...heim(home), TMPDIR: process.env.TMPDIR || tmpdir(), BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", TZ: "Europe/Berlin" };
    const k = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode, eingabe, punkt })], { env, stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; k.stderr.on("data", (x) => { err += x; });
    k.on("exit", (code, signal) => (istAbsturz(code, signal) ? ok() : nein(new Error(`Kind endete nicht per SIGKILL: ${code} ${signal} ${err}`))));
  });
}

// ───────────── EXDEV: abgelehnt, nichts angefasst ─────────────

test("EXDEV beim rename: Löschen (Datei und Ordner) wird abgelehnt, nichts verändert, kein Journal bleibt liegen", async () => {
  const dateien = { "p/a.md": "# a\n", "p/u/b.md": "# b\n", "n.md": "# n\n" };
  const { d, v, support, kennung } = aufbau(dateien, { dateiHaken: { rename: exdev } });
  const vorher = stand(d);
  for (const eingabe of [{ typ: "ordner", pfad: "p" }, { pfad: "n.md" }]) {
    const e = await fehler(() => v.loeschen(eingabe));
    assert.equal(e.status, 409); assert.equal(e.extra.art, "anderes-laufwerk");
  }
  assert.deepEqual(stand(d), vorher);
  const vz = join(d, ".kortex-lokal", "papierkorb", "vorgaenge");
  assert.deepEqual(existsSync(vz) ? readdirSync(vz) : [], []);
  assert.ok(!existsSync(join(v.aktionenOrt(), ".laeuft")));
});

// ───────────── Vault auf anderem Gerät: Papierkorb im Vault ─────────────

function anderesGeraet(support) { return (p) => (String(p).startsWith(support) ? 2 : 1); }

test("Der Papierkorb liegt für jeden Vault im Vault (.kortex-lokal/papierkorb), nie im Support; Löschen, Wiederherstellen, Wiederholen gehen; .kortex-lokal ist für Baum, Index, Notizen, Lesen und git unsichtbar", async () => {
  const d = repo("upk-git-"), support = tmp("upk-git-support-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "p/a.md", "# A\n[[B]]\n"); schreibe(d, "p/b.md", "# B\n"); schreibe(d, "l.md", "# L\n[[A]]\n");
  g(d, "add", "--", "."); g(d, "commit", "-q", "-m", "x");
  const v = oeffneVault(d, { support });
  const vorher = stand(d);
  const r = await v.loeschen({ typ: "ordner", pfad: "p" });
  assert.ok(existsSync(join(d, ".kortex-lokal/papierkorb/vorgaenge", r.vorgang, "inhalt/p/a.md")), "Inhalt im Vault-Papierkorb");
  assert.ok(!existsSync(join(support, "papierkorb")), "im Support entsteht nichts");
  assert.ok(!existsSync(join(d, "p")));
  // unsichtbar
  assert.ok(!v.baum().eintraege.some((e) => e.pfad.includes(".kortex-lokal")));
  assert.ok(!(await v.notizen()).notizen.some((n) => n.pfad.includes(".kortex-lokal")));
  assert.equal((await fehler(async () => v.lies(".kortex-lokal/papierkorb/vorgaenge/" + r.vorgang + "/inhalt/p/a.md"))).status, 403);
  assert.equal(g(d, "status", "--porcelain").includes(".kortex-lokal"), false);
  assert.match(readFileSync(join(d, ".git/info/exclude"), "utf8"), /^\/\.kortex-lokal\/$/m);
  assert.ok(!existsSync(join(d, ".gitignore")), "die .gitignore des Nutzers wird nie angefasst");
  // getrashte Notizen werden bei der Link-Pflege nie umgeschrieben
  await v.umbenennen({ pfad: "l.md", titel: "L2", dateiname: "L2.md" });
  assert.equal(lies(d, ".kortex-lokal/papierkorb/vorgaenge/" + r.vorgang + "/inhalt/p/a.md"), "# A\n[[B]]\n");
  // Wiederholen / Wiederherstellen
  await v.vorgangZurueck({ id: r.vorgang });
  assert.equal(lies(d, "p/a.md"), "# A\n[[B]]\n");
  await v.vorgangWieder({ id: r.vorgang });
  assert.ok(!existsSync(join(d, "p")));
  const w = await v.papierkorbWiederherstellen({ id: r.vorgang });
  assert.equal(w.pfad, "p"); assert.equal(lies(d, "p/b.md"), "# B\n");
  const nachher = stand(d);
  assert.deepEqual(nachher.dateien["p/a.md"], vorher.dateien["p/a.md"]);
});

// Ein Papierkorb aus früheren Versionen: <Support>/papierkorb/<Pfad-Hash>/vorgaenge/<id>/ (von Hand nachgebaut, die neue Version legt dort nichts mehr an)
function alterKorb(d, support, id, name, inhalt) {
  const dir = join(support, "papierkorb", A.kennungVault(d), "vorgaenge", id);
  mkdirSync(join(dir, "inhalt"), { recursive: true });
  writeFileSync(join(dir, "inhalt", name), inhalt);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ v: 1, id, art: "loeschen", typ: "datei", zeit: new Date(Date.now() - 90 * 86400e3).toISOString(), status: "fertig", von: name, nach: null,
    titel: null, inhalt: { name, modus: 0o644, eintraege: [{ pfad: "", art: "datei", groesse: Buffer.byteLength(inhalt), modus: 0o644, hash: sha(Buffer.from(inhalt)) }] }, dateien: [] }));
  return dir;
}
test("Älterer Papierkorb unter Support bleibt sichtbar und wiederherstellbar (gleiches Laufwerk: per rename mit denselben Prüfungen), wird nie automatisch gelöscht; auf anderem Laufwerk „im Finder öffnen“", async () => {
  const { d, support, v } = aufbau({ "x.md": "# x\n" });
  const dir1 = alterKorb(d, support, "v_aaaaaaaaaaaa", "a.md", "# a\n"), dir2 = alterKorb(d, support, "v_bbbbbbbbbbbb", "b.md", "# b\n");
  const liste = (await v.papierkorb()).eintraege;
  assert.equal(liste.length, 2); assert.ok(liste.every((e) => e.aelterKorb === true && e.alt === true), "als älterer Papierkorb gekennzeichnet, nichts gelöscht");
  assert.ok(existsSync(dir1) && existsSync(dir2));
  assert.equal((await v.papierkorbWiederherstellen({ id: "v_aaaaaaaaaaaa" })).pfad, "a.md");
  assert.equal(lies(d, "a.md"), "# a\n");
  // anderes Laufwerk (simuliert): abgelehnt mit Hinweis auf den Finder, nichts gelöscht oder verschoben
  const v2 = oeffneVault(d, { support, dateiHaken: { geraet: anderesGeraet(support), rename: exdev } });
  const l2 = (await v2.papierkorb()).eintraege;
  assert.equal(l2.length, 1); assert.equal(l2[0].nurImFinder, true); assert.ok(l2[0].ort.includes(support));
  const e = await fehler(() => v2.papierkorbWiederherstellen({ id: "v_bbbbbbbbbbbb" }));
  assert.equal(e.extra.art, "anderes-laufwerk"); assert.ok(e.message.includes("Finder"));
  assert.ok(existsSync(join(dir2, "inhalt", "b.md")) && !existsSync(join(d, "b.md")));
});

// ───────────── Erholung nach echtem SIGKILL ─────────────

const NOTIZEN = { "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]] [m](../a/Alt.md)\n", "c/y.md": "[[Alt]]\n", "ord/n1.md": "# n1\n[[Alt]]\n", "ord/tief/n2.md": "# n2\n", "l.md": "[[ord/n1]] [k](ord/n1.md)\n" };

for (const [punkt, methode, eingabe] of [
  ["nach-schreiben", "umbenennen", { pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }],
  ["nach-umzug", "umbenennen", { pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }],
  ["nach-schreiben", "umbenennen", { typ: "ordner", pfad: "ord", name: "ord2" }],
  ["nach-mkdir", "umbenennen", { typ: "ordner", pfad: "ord", name: "ord2" }],
  ["nach-umzug", "umbenennen", { typ: "ordner", pfad: "ord", name: "ord2" }],
  ["nach-umzug", "verschieben", { typ: "ordner", pfad: "ord", ziel: "c" }],
  ["loeschen-vorher", "loeschen", { typ: "ordner", pfad: "ord" }],
  ["loeschen-nachher", "loeschen", { typ: "ordner", pfad: "ord" }],
  ["loeschen-nachher", "loeschen", { pfad: "a/Alt.md" }],
]) {
  test(`SIGKILL bei „${punkt}“ (${methode} ${eingabe.typ || "datei"} ${eingabe.pfad}): nach der Erholung ist alles wie vorher, keine Datei verloren`, async () => {
    const { d, support, kennung } = aufbau(NOTIZEN);
    const vorher = stand(d);
    await absturz({ d, support, methode, eingabe, punkt });
    const v = oeffneVault(d, { support });
    const liste = await v.papierkorb();
    assert.deepEqual(stand(d), vorher);
    assert.deepEqual(liste.hinweise, []);
    assert.ok(!existsSync(join(v.aktionenOrt(), ".laeuft")));
    // und es geht danach ganz normal weiter
    await v.umbenennen({ pfad: "l.md", titel: "L neu", dateiname: "Lneu.md" });
    assert.ok(existsSync(join(d, "Lneu.md")));
  });
}

for (const [vorbereitung, punkt, aktion] of [
  ["umbenennen", "undo-nach-schreiben", "zurueck"], ["umbenennen", "undo-nach-umzug", "zurueck"],
  ["loeschen", "restore-nach-umzug", "restore"], ["loeschen", "redo-nach-umzug", "redo"],
]) {
  test(`SIGKILL bei „${punkt}“: keine Datei geht verloren; Unklares wird sichtbar gemeldet, Eindeutiges zu Ende geführt`, async () => {
    const { d, support, v } = aufbau(NOTIZEN);
    const ausgang = vorbereitung === "umbenennen" ? await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }) : await v.loeschen({ typ: "ordner", pfad: "ord" });
    if (aktion === "redo") await v.vorgangZurueck({ id: ausgang.vorgang });
    const davor = stand(d);
    const [methode, eingabe] = aktion === "restore" ? ["papierkorbWiederherstellen", { id: ausgang.vorgang }] : aktion === "redo" ? ["vorgangWieder", { id: ausgang.vorgang }] : ["vorgangZurueck", { id: ausgang.vorgang }];
    await absturz({ d, support, methode, eingabe, punkt });
    const v2 = oeffneVault(d, { support });
    const liste = await v2.papierkorb();
    // keine Datei geht verloren: jeder Inhalt von vorher liegt im Vault oder im Journal (vorher/nachher/inhalt)
    const vorhandene = new Set(Object.values(stand(d).dateien));
    const walk = (dir) => { if (!existsSync(dir)) return; for (const n of readdirSync(dir)) { const f = join(dir, n); if (lstatSync(f).isDirectory()) walk(f); else vorhandene.add(sha(readFileSync(f))); } };
    walk(join(d, ".kortex-lokal"));
    for (const [p, h] of Object.entries(davor.dateien)) assert.ok(vorhandene.has(h), `verloren: ${p}`);
    if (aktion === "restore") { assert.ok(existsSync(join(d, "ord/n1.md"))); assert.deepEqual(liste.eintraege, []); }
    if (aktion === "redo") { assert.ok(!existsSync(join(d, "ord"))); assert.equal(liste.eintraege.length, 1); }
    if (aktion === "zurueck") assert.ok(liste.hinweise.length <= 1);
  });
}

test("Unklarer Vorgang erscheint als Hinweis im Papierkorb (mit Weg) und „Erledigt“ legt das Journal in die Quarantäne statt es zu löschen", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  schreibe(d, "a/Alt.md", "# noch eine Alt\n"); // beide da → nicht eindeutig
  const mf = join(jDir(d, r.vorgang), "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; writeFileSync(mf, JSON.stringify(m));
  writeFileSync(join(v.aktionenOrt(), ".laeuft"), JSON.stringify({ id: r.vorgang, aktion: "op" }));
  const liste = await v.papierkorb();
  assert.equal(liste.hinweise.length, 1); assert.equal(liste.hinweise[0].id, r.vorgang); assert.ok(liste.hinweise[0].ort.includes(r.vorgang));
  const e = await v.papierkorbHinweisErledigt({ id: r.vorgang });
  assert.ok(existsSync(join(e.ort, "manifest.json")));
  assert.deepEqual((await v.papierkorb()).hinweise, []);
});

test("Erholung räumt .brain-tmp-<pid>-* toter Prozesse auf, nicht die lebender", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  schreibe(d, "a/.brain-tmp-99999999-abcd", "x"); schreibe(d, `a/.brain-tmp-${process.pid}-abcd`, "x");
  const mf = join(jDir(d, r.vorgang), "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; writeFileSync(mf, JSON.stringify(m));
  await oeffneVault(d, { support }).papierkorb();
  assert.ok(!existsSync(join(d, "a/.brain-tmp-99999999-abcd"))); assert.ok(existsSync(join(d, `a/.brain-tmp-${process.pid}-abcd`)));
});

// ───────────── Sperre ─────────────

const sperreDatei = (v) => join(v.aktionenOrt(), ".sperre");
function legeSperre(v, inhalt, alterMs = 0) {
  mkdirSync(v.aktionenOrt(), { recursive: true });
  const f = sperreDatei(v);
  writeFileSync(f, JSON.stringify(inhalt) + "\n");
  if (alterMs) { const t = new Date(Date.now() - alterMs); utimesSync(f, t, t); }
  return f;
}
const startVon = (pid) => process.platform === "win32" ? prozessStart(pid) : execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/bin:/usr/bin" } }).trim();

test("Sperre: ein anderer lebender Prozess wird auch nach 20 Minuten nicht gebrochen; tote PID und wiederverwendete PID (andere Startzeit) sofort; eigene PID mit fremdem Token gilt als veraltet", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n" });
  const fremd = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { env: { PATH: systemPfad(), ...heim(tmp("upk-home-")) }, stdio: "ignore" });
  try {
    legeSperre(v, { pid: fremd.pid, start: startVon(fremd.pid), token: "t" }, 20 * 60_000);
    const e = await fehler(() => v.umbenennen({ pfad: "a/x.md", dateiname: "y.md" }));
    assert.equal(e.extra.art, "beschaeftigt"); assert.ok(existsSync(join(d, "a/x.md")));
    assert.ok(existsSync(sperreDatei(v)), "die Sperre des lebenden Prozesses bleibt");
  } finally { fremd.kill("SIGKILL"); }
  const t0 = Date.now();
  legeSperre(v, { pid: 99999999, token: "t" });
  await v.umbenennen({ pfad: "a/x.md", dateiname: "y.md" });
  assert.ok(Date.now() - t0 < 2000, "tote PID: sofort, nicht erst nach 60 s");
  legeSperre(v, { pid: process.pid, start: "Thu Jan  1 00:00:00 1970", token: "t" });
  await v.umbenennen({ pfad: "a/y.md", dateiname: "z.md" });
  legeSperre(v, { pid: process.pid, start: startVon(process.pid), token: "nicht-meins" }); // Vault-Kopie oder Umzug im selben Prozess
  await v.umbenennen({ pfad: "a/z.md", dateiname: "w.md" });
  assert.ok(existsSync(join(d, "a/w.md")));
  assert.ok(!existsSync(sperreDatei(v)), "die eigene Sperre ist wieder frei");
});

test("Sperre: drei Prozesse brechen gleichzeitig dieselbe veraltete Sperre — alle drei Aktionen laufen, nacheinander, ohne dass eine frische Sperre gelöscht wird", async () => {
  const { d, support, v } = aufbau({ "a/1.md": "# 1\n", "a/2.md": "# 2\n", "a/3.md": "# 3\n" });
  legeSperre(v, { pid: 99999999, token: "alt" });
  const lauf = (n) => new Promise((ok, nein) => {
    const home = tmp("upk-home-");
    const env = { PATH: systemPfad(), ...heim(home), TMPDIR: process.env.TMPDIR || tmpdir(), BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", TZ: "Europe/Berlin" };
    const k = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode: "umbenennen", eingabe: { pfad: `a/${n}.md`, dateiname: `n${n}.md` }, punkt: "nie" })], { env, stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; k.stderr.on("data", (x) => { err += x; });
    k.on("exit", (code) => (code === 0 ? ok() : nein(new Error(`Kind ${n}: ${code} ${err}`))));
  });
  await Promise.all([lauf(1), lauf(2), lauf(3)]);
  for (const n of [1, 2, 3]) assert.ok(existsSync(join(d, `a/n${n}.md`)), `n${n}`);
  assert.ok(!existsSync(sperreDatei(v)));
  assert.ok(!existsSync(sperreDatei(v) + ".bruch"));
});
