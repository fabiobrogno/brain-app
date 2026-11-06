// Nach Review 3 (#95): Locale-feste Sperre, Wiederherstellen ohne Überschreiben, Marke nach 409, .kortex-lokal in git, stabile Vault-ID, Hard-Link-Fenster, Undo/Redo-Erholung, Geräte, Uhrensprung.
// Nur Wegwerf-Ordner (tmp); Kindprozesse mit ausdrücklich gebauter Umgebung.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, utimesSync, lstatSync, renameSync, statSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, hostname } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmp, schreibe, pfad, repo, g } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const KIND = join(dirname(fileURLToPath(import.meta.url)), "umbenennen-kind.mjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const lies = (d, p) => readFileSync(join(d, p), "utf8");
async function fehler(fn) { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); }
function stand(d) {
  const dateien = {};
  const geh = (rel) => { for (const n of readdirSync(rel ? join(d, rel) : d).sort()) { if (n.startsWith(".")) continue; const r = rel ? `${rel}/${n}` : n; if (lstatSync(join(d, r)).isDirectory()) geh(r); else dateien[r] = sha(readFileSync(join(d, r))); } };
  geh("");
  return dateien;
}
function aufbau(dateien = {}, opts = {}, mitId = true) {
  const d = realpathSync(tmp("r3-vault-")), support = realpathSync(tmp("r3-support-"));
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  const v = oeffneVault(d, { support, heute: "2026-11-05", ...opts });
  return { d, support, v };
}
const anderesGeraet = (support) => (p) => (String(p).startsWith(support) ? 2 : 1);
const kindEnv = (support, extra = {}) => ({ PATH: "/usr/bin:/bin", HOME: tmp("r3-home-"), TMPDIR: process.env.TMPDIR || tmpdir(), BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", ...extra });
function absturz({ d, support, methode, eingabe, punkt }) {
  return new Promise((ok, nein) => {
    const k = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode, eingabe, punkt })], { env: kindEnv(support, { TZ: "Europe/Berlin" }), stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; k.stderr.on("data", (x) => { err += x; });
    k.on("exit", (code, signal) => (signal === "SIGKILL" ? ok() : nein(new Error(`Kind: ${code} ${signal} ${err}`))));
  });
}

// ───────────── 1. Sperre: Locale und Zeitzone ändern die Startzeit nicht ─────────────

test("B1: Halter mit LANG=de_DE und TZ=Asia/Tokyo, Prüfer mit anderer Locale/Zeitzone: der Halter lebt, die Sperre wird nicht gebrochen (409), seine Aktion läuft ungestört zu Ende", async () => {
  const { d, support, v } = aufbau({ "a/x.md": "# x\n", "b/y.md": "[[x]]\n", "ord/n.md": "# n\n[[x]]\n" });
  const pause = join(support, "pause");
  const halter = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode: "umbenennen", eingabe: { typ: "ordner", pfad: "ord", name: "ord2" }, punkt: "nie", pausePunkt: "nach-schreiben", pauseDatei: pause })],
    { env: kindEnv(support, { LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", TZ: "Asia/Tokyo" }), stdio: ["ignore", "pipe", "pipe"] });
  let aus = ""; halter.stderr.on("data", (x) => { aus += x; });
  const ende = new Promise((ok) => halter.on("exit", (c) => ok(c)));
  const t0 = Date.now(); while (!existsSync(pause) && Date.now() - t0 < 15000) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(existsSync(pause), "Halter hält an: " + aus);
  const e = await fehler(() => v.umbenennen({ pfad: "a/x.md", dateiname: "z.md" })); // dieser Prozess: andere Locale (C/Test) und Zeitzone (Berlin)
  assert.equal(e.extra.art, "beschaeftigt");
  assert.ok(existsSync(join(d, "a/x.md")), "der Prüfer hat nichts angefasst");
  writeFileSync(pause + ".weiter", "");
  assert.equal(await ende, 0, aus);
  assert.ok(existsSync(join(d, "ord2/n.md")) && !existsSync(join(d, "ord")));
});

// ───────────── 2. Wiederherstellen: nie überschreiben, Name wie Umbenennen ─────────────

test("Wiederherstellen überschreibt nie: eine fremde Datei (oder ein fremder Ordner), die zwischen Prüfung und link/mkdir auftaucht, bleibt unberührt", async () => {
  const frei = aufbau({ "a.md": "# a\n", "p/q.md": "# q\n" });
  const r1 = await frei.v.loeschen({ pfad: "a.md" }), r2 = await frei.v.loeschen({ typ: "ordner", pfad: "p" });
  let einmal = 0;
  const v2 = oeffneVault(frei.d, { support: frei.support, dateiHaken: { punkt: (n) => {
    if (n !== "restore-vor-link") return;
    einmal++;
    if (einmal === 1) writeFileSync(join(frei.d, "a.md"), "FREMD\n");           // eine andere App schreibt a.md
    else { mkdirSync(join(frei.d, "p")); writeFileSync(join(frei.d, "p/fremd.md"), "FREMD\n"); } // oder legt den Ordner an
  } } });
  assert.equal((await fehler(() => v2.papierkorbWiederherstellen({ id: r1.vorgang }))).extra.art, "belegt");
  assert.equal(lies(frei.d, "a.md"), "FREMD\n");
  assert.equal((await fehler(() => v2.papierkorbWiederherstellen({ id: r2.vorgang }))).extra.art, "belegt");
  assert.equal(lies(frei.d, "p/fremd.md"), "FREMD\n"); assert.ok(!existsSync(join(frei.d, "p/q.md")));
  const liste = (await v2.papierkorb()).eintraege;
  assert.equal(liste.length, 2, "beides liegt weiter im Papierkorb");
});

test("„Mit neuem Namen“ behält die Endung und läuft durch dieselben Prüfungen wie Umbenennen (reserviert, Unter-Vault)", async () => {
  const { d, support, v } = aufbau({ "Kaffee.md": "# Kaffee\n", "Tee.md": "# Tee\n", "sub/brain.config.json": "{}\n", "sub/n.md": "# n\n" });
  const r1 = await v.loeschen({ pfad: "Kaffee.md" }), r2 = await v.loeschen({ pfad: "Tee.md" }), r3 = await v.loeschen({ pfad: "sub/n.md" });
  assert.equal((await fehler(() => v.papierkorbWiederherstellen({ id: r2.vorgang, name: "x.txt" }))).status, 400);
  assert.equal((await fehler(() => v.papierkorbWiederherstellen({ id: r2.vorgang, name: "index.md" }))).extra.art, "reserviert");
  assert.equal((await v.papierkorbWiederherstellen({ id: r1.vorgang, name: "Kaffee alt" })).pfad, "Kaffee alt.md");
  assert.ok(existsSync(join(d, "Kaffee alt.md")));
  const mcp = oeffneVault(d, { support, ohneUnterVaults: true });
  assert.equal((await fehler(() => mcp.papierkorbWiederherstellen({ id: r3.vorgang }))).status, 404, "nicht in einen Unter-Vault");
  assert.ok(!existsSync(join(d, "sub/n.md")));
});

// ───────────── 3. Marke nach 409 ─────────────

test("Rückgängig mit 409 (Notiz inzwischen geändert) hinterlässt keine Marke: kein „unklar“, Rückgängig bleibt möglich", async () => {
  const { d, v, support } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  writeFileSync(join(d, "b/x.md"), "[[Neu]] weitergeschrieben\n");
  const e = await fehler(() => v.vorgangZurueck({ id: r.vorgang }));
  assert.equal(e.extra.art, "geaendert");
  assert.ok(!existsSync(join(v.aktionenOrt(), ".laeuft")));
  const v2 = oeffneVault(d, { support });
  assert.deepEqual((await v2.papierkorb()).hinweise, []);
  await v2.vorgangZurueck({ id: r.vorgang, teilweise: true });
  assert.ok(existsSync(join(d, "a/Alt.md")));
});

// ───────────── 4. .kortex-lokal bleibt aus git ─────────────

const gitStatus = (wo) => g(wo, "status", "--porcelain", "--untracked-files=all");
test(".kortex-lokal/.gitignore („*“) deckt Worktree-Vaults, Vaults in Unterordnern eines Repos und später eingerichtetes git", async () => {
  const support = realpathSync(tmp("r3-gsup-"));
  const haken = { geraet: anderesGeraet(support) }; // Papierkorb im Vault
  // (a) Worktree: .git ist eine Datei
  const haupt = realpathSync(repo("r3-wt-"));
  schreibe(haupt, "brain.config.json", "{}\n"); schreibe(haupt, "n.md", "# n\n"); g(haupt, "add", "--", "."); g(haupt, "commit", "-q", "-m", "x");
  const wt = join(realpathSync(tmp("r3-wtdir-")), "arbeit");
  g(haupt, "worktree", "add", "-q", "-b", "nebenzweig", wt);
  assert.ok(lstatSync(join(wt, ".git")).isFile());
  const v1 = oeffneVault(wt, { support, dateiHaken: haken });
  await v1.loeschen({ pfad: "n.md" });
  assert.equal(gitStatus(wt).includes(".kortex-lokal"), false, gitStatus(wt));
  assert.equal(lies(wt, ".kortex-lokal/.gitignore"), "*\n");
  // (b) Vault in einem Unterordner eines Repos
  const wurzel = realpathSync(repo("r3-sub-"));
  schreibe(wurzel, "x.txt", "x\n"); g(wurzel, "add", "--", "."); g(wurzel, "commit", "-q", "-m", "x");
  schreibe(wurzel, "vault/brain.config.json", "{}\n"); schreibe(wurzel, "vault/m.md", "# m\n");
  const v2 = oeffneVault(join(wurzel, "vault"), { support, dateiHaken: haken });
  await v2.loeschen({ pfad: "m.md" });
  assert.equal(gitStatus(wurzel).includes(".kortex-lokal"), false, gitStatus(wurzel));
  // (c) git erst nach dem ersten Löschen eingerichtet
  const d3 = realpathSync(tmp("r3-spaet-"));
  schreibe(d3, "brain.config.json", "{}\n"); schreibe(d3, "k.md", "# k\n");
  const v3 = oeffneVault(d3, { support, dateiHaken: haken });
  await v3.loeschen({ pfad: "k.md" });
  g(d3, "init", "-q", "-b", "main");
  assert.equal(gitStatus(d3).includes(".kortex-lokal"), false, gitStatus(d3));
});

// ───────────── 5. Papierkorb im Vault: Umbenennen und Kopieren des Vault-Ordners ─────────────

test("Der Papierkorb zieht mit dem Vault-Ordner um (umbenannt, verschoben): kein Schlüssel, keine Migration", async () => {
  const { d, support, v } = aufbau({ "a.md": "# a\n" });
  await v.loeschen({ pfad: "a.md" });
  const eltern = realpathSync(tmp("r3-eltern-")); const neu = join(eltern, "umbenannter-vault");
  renameSync(d, neu);
  const v2 = oeffneVault(neu, { support });
  const liste = (await v2.papierkorb()).eintraege;
  assert.equal(liste.length, 1); assert.equal(liste[0].titel, "a");
  assert.equal((await v2.papierkorbWiederherstellen({ id: liste[0].id })).pfad, "a.md");
  await v2.loeschen({ pfad: "a.md" });
  const neu2 = join(eltern, "noch-ein-name");
  renameSync(neu, neu2);
  assert.equal((await oeffneVault(neu2, { support }).papierkorb()).eintraege.length, 1);
});

test("Ein kopierter Vault hat seinen eigenen, kopierten Papierkorb: Wiederherstellen bleibt im eigenen Vault, das Original bleibt unberührt", async () => {
  const { d, support, v } = aufbau({ "a.md": "# a\n", "b.md": "# b\n" });
  const r = await v.loeschen({ pfad: "a.md" });
  const kopie = join(realpathSync(tmp("r3-kopie-")), "kopie");
  cpSync(d, kopie, { recursive: true });
  const vk = oeffneVault(kopie, { support });
  const liste = (await vk.papierkorb()).eintraege;
  assert.equal(liste.length, 1);
  assert.equal((await vk.papierkorbWiederherstellen({ id: r.vorgang })).pfad, "a.md");
  assert.equal(lies(kopie, "a.md"), "# a\n");
  assert.ok(!existsSync(join(d, "a.md")), "das Original ist nicht berührt");
  assert.equal((await v.papierkorb()).eintraege.length, 1, "und hat seinen eigenen Papierkorb noch");
});

// ───────────── 6. Hard-Link-Fenster ─────────────

for (const [methode, eingabe, punkt] of [["umbenennen", { pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }, "nach-link"], ["verschieben", { pfad: "a/Alt.md", ziel: "b" }, "nach-link"]]) {
  test(`Hard-Link-Fenster (SIGKILL zwischen link und unlink bei ${methode}): die Erholung entfernt den neuen Namen, alles ist wie vorher (kein „unklar“, kein 423)`, async () => {
    const { d, support } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
    const vorher = stand(d);
    await absturz({ d, support, methode, eingabe, punkt });
    const v = oeffneVault(d, { support });
    const liste = await v.papierkorb();
    assert.deepEqual(stand(d), vorher); assert.deepEqual(liste.hinweise, []);
    assert.equal(statSync(join(d, "a/Alt.md")).nlink, 1);
    await v.umbenennen({ pfad: "a/Alt.md", dateiname: "Z.md" }); // kein 423
  });
}

test("Hard-Link-Fenster beim Wiederherstellen (SIGKILL zwischen link und unlink): wird zu Ende geführt, Datei im Vault, Papierkorb leer", async () => {
  const { d, support, v } = aufbau({ "a.md": "# a\n" });
  const r = await v.loeschen({ pfad: "a.md" });
  await absturz({ d, support, methode: "papierkorbWiederherstellen", eingabe: { id: r.vorgang }, punkt: "restore-nach-link" });
  const v2 = oeffneVault(d, { support });
  const liste = await v2.papierkorb();
  assert.equal(lies(d, "a.md"), "# a\n"); assert.deepEqual(liste.eintraege, []); assert.deepEqual(liste.hinweise, []);
  assert.equal(statSync(join(d, "a.md")).nlink, 1);
});

// ───────────── 7. Abgebrochenes Undo/Redo wird zu Ende geführt ─────────────

const NOTIZEN = { "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]] [m](../a/Alt.md)\n", "ord/n1.md": "# n1\n[[Alt]]\n", "l.md": "[[ord/n1]]\n" };
for (const [eingabe, punkt, aktion] of [
  [{ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }, "undo-nach-schreiben", "undo"], [{ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }, "undo-nach-umzug", "undo"],
  [{ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }, "redo-nach-schreiben", "redo"], [{ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }, "redo-nach-umzug", "redo"],
  [{ typ: "ordner", pfad: "ord", name: "ord2" }, "undo-nach-schreiben", "undo"], [{ typ: "ordner", pfad: "ord", name: "ord2" }, "redo-nach-umzug", "redo"],
]) {
  test(`SIGKILL bei „${punkt}“ (${eingabe.typ || "datei"}): das ${aktion === "undo" ? "Rückgängig" : "Wiederholen"} wird automatisch zu Ende geführt — kein „unklar“`, async () => {
    const { d, support, v } = aufbau(NOTIZEN);
    const vorOp = stand(d);
    const r = await v.umbenennen(eingabe);
    const nachOp = stand(d);
    if (aktion === "redo") await v.vorgangZurueck({ id: r.vorgang });
    await absturz({ d, support, methode: aktion === "undo" ? "vorgangZurueck" : "vorgangWieder", eingabe: { id: r.vorgang }, punkt });
    const v2 = oeffneVault(d, { support });
    const liste = await v2.papierkorb();
    assert.deepEqual(liste.hinweise, []);
    assert.deepEqual(stand(d), aktion === "undo" ? vorOp : nachOp);
    const m = JSON.parse(readFileSync(join(d, ".kortex-lokal", "papierkorb", "vorgaenge", r.vorgang, "manifest.json"), "utf8"));
    assert.equal(m.status, aktion === "undo" ? "zurueck" : "fertig");
  });
}

// ───────────── 8. Aufräumen von Resten ─────────────

test("Reste toter Prozesse werden aufgeräumt: .brain-tmp-<pid>-* nach abgebrochenem Undo, .sperre.<pid>.* in der Support-Ablage; lebende PIDs bleiben", async () => {
  const { d, support, v } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  const korb = v.aktionenOrt();
  writeFileSync(join(korb, ".laeuft"), JSON.stringify({ id: r.vorgang, aktion: "undo" }));
  schreibe(d, "b/.brain-tmp-99999999-aa", "x"); schreibe(d, `b/.brain-tmp-${process.pid}-aa`, "x");
  for (const n of [".sperre.99999999.ab12", ".sperre.bruch.99999999.cd34", ".sperre.alt.99999999.ef56", `.sperre.${process.pid}.ab12`]) writeFileSync(join(korb, n), "{}");
  await oeffneVault(d, { support }).papierkorb();
  assert.ok(!existsSync(join(d, "b/.brain-tmp-99999999-aa"))); assert.ok(existsSync(join(d, `b/.brain-tmp-${process.pid}-aa`)));
  for (const n of [".sperre.99999999.ab12", ".sperre.bruch.99999999.cd34", ".sperre.alt.99999999.ef56"]) assert.ok(!existsSync(join(korb, n)), n);
  assert.ok(existsSync(join(korb, `.sperre.${process.pid}.ab12`)));
});

// ───────────── 9. Gerät ─────────────

// Zwei Geräte mit einem gesyncten Vault: Hardware-ID entscheidet allein, wenn beide eine haben; der Rechnername nur, wenn einer Seite sie fehlt. Sperre und Marke liegen je Gerät.
const manifestPfad = (d, id) => join(d, ".kortex-lokal", "papierkorb", "vorgaenge", id, "manifest.json");
async function vorgangMitMarke(geraetA, geraetManifest) {
  const { d, support } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const vA = oeffneVault(d, { support, dateiHaken: { geraeteId: geraetA } });
  const r = await vA.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  const mf = manifestPfad(d, r.vorgang);
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; m.geraet = geraetManifest; writeFileSync(mf, JSON.stringify(m));
  writeFileSync(join(vA.aktionenOrt(), ".laeuft"), JSON.stringify({ id: r.vorgang, aktion: "op" }));
  return { d, support, vA, r, nachOp: stand(d) };
}
test("Gleicher Hostname, andere Hardware-ID (zwei Macs, ein Sync): der Vorgang des anderen Geräts wird nicht angefasst, nur als Hinweis gezeigt; „Ausblenden“ verschiebt nichts", async () => {
  const A = { hw: "A-uuid", host: "host:gleich" };
  const { d, support, r, nachOp } = await vorgangMitMarke(A, { hw: "B-uuid", host: "host:gleich" });
  const liste = await oeffneVault(d, { support, dateiHaken: { geraeteId: A } }).papierkorb();
  assert.deepEqual(stand(d), nachOp, "fremder Vorgang nicht angefasst");
  assert.equal(liste.hinweise.length, 1); assert.equal(liste.hinweise[0].fremd, true);
  const vA = oeffneVault(d, { support, dateiHaken: { geraeteId: A } });
  await vA.papierkorbHinweisErledigt({ id: r.vorgang });
  assert.ok(existsSync(manifestPfad(d, r.vorgang)), "nichts verschoben");
  assert.deepEqual((await vA.papierkorb()).hinweise, [], "nur hier ausgeblendet");
  assert.equal((await oeffneVault(d, { support, dateiHaken: { geraeteId: { hw: "B-uuid", host: "host:gleich" } } }).papierkorb()).eintraege.length, 0);
});
test("Eigenes Gerät wird erkannt: gleiche Hardware-ID (anderer Rechnername) oder Rechnername, wenn einer Seite die Hardware-ID fehlt; eigene Journale werden nach einem Neustart erholt", async () => {
  for (const [ich, journal] of [[{ hw: "A-uuid", host: "host:neu" }, { hw: "A-uuid", host: "host:alt" }], [{ hw: "", host: "host:gleich" }, { hw: "B-uuid", host: "host:gleich" }], [{ hw: "A-uuid", host: "host:gleich" }, { hw: "", host: "host:gleich" }]]) {
    const { d, support } = await vorgangMitMarke(ich, journal);
    const liste = await oeffneVault(d, { support, dateiHaken: { geraeteId: ich } }).papierkorb();
    assert.equal(lies(d, "b/x.md"), "[[Alt]]\n", JSON.stringify([ich, journal])); assert.deepEqual(liste.hinweise, []);
  }
});
test("Sperre je Gerät: die Sperre eines anderen Geräts wird nie gebrochen und nie berücksichtigt", async () => {
  const { d, support } = aufbau({ "a/x.md": "# x\n" });
  const vB = oeffneVault(d, { support, dateiHaken: { geraeteId: { hw: "B-uuid", host: "host:b" } } });
  mkdirSync(vB.aktionenOrt(), { recursive: true });
  writeFileSync(join(vB.aktionenOrt(), ".sperre"), JSON.stringify({ pid: 99999999, token: "von-b" }) + "\n"); // totes Gerät-B-Prozess-Abbild
  const vA = oeffneVault(d, { support, dateiHaken: { geraeteId: { hw: "A-uuid", host: "host:a" } } });
  await vA.umbenennen({ pfad: "a/x.md", dateiname: "y.md" }); // A läuft ungehindert (eigene Sperre)
  assert.ok(existsSync(join(vB.aktionenOrt(), ".sperre")), "A hat die Sperre von B nicht angefasst, obwohl deren PID hier tot wäre");
});

// ───────────── Wiederherstellen unter neuem Namen / in anderen Ordner: Absturz zwischen link und unlink ─────────────

for (const opt of [{ name: "x alt" }, { ziel: "neu" }, {}]) {
  test(`SIGKILL zwischen link und unlink beim Wiederherstellen ${JSON.stringify(opt)}: die Erholung führt es am richtigen Ziel zu Ende (Marke trägt das Ziel)`, async () => {
    const { d, support, v } = aufbau({ "x.md": "# x\nalt\n", "neu/.keep": "" });
    const r = await v.loeschen({ pfad: "x.md" });
    await absturz({ d, support, methode: "papierkorbWiederherstellen", eingabe: { id: r.vorgang, ...opt }, punkt: "restore-nach-link" });
    const liste = await oeffneVault(d, { support }).papierkorb();
    const ziel = opt.name ? "x alt.md" : opt.ziel ? "neu/x.md" : "x.md";
    assert.equal(lies(d, ziel), "# x\nalt\n");
    assert.equal(statSync(join(d, ziel)).nlink, 1, "kein zweiter Name");
    assert.deepEqual(liste.eintraege, []); assert.deepEqual(liste.hinweise, []);
  });
}

// ───────────── Sperre zwischen später gestarteten Prozessen ─────────────

test("Ein später gestarteter Prozess (anderes LANG/TZ) sieht die Sperre eines laufenden Halters im Vault: kein Rollback, der Halter beendet seinen Vorgang sauber", async () => {
  const { d, support, v } = aufbau({ "a/x.md": "# x\n", "ord/n.md": "# n\n[[x]]\n", "l.md": "[[ord/n]]\n" });
  const pause = join(support, "pause");
  const halter = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode: "umbenennen", eingabe: { typ: "ordner", pfad: "ord", name: "ord2" }, punkt: "nie", pausePunkt: "nach-schreiben", pauseDatei: pause })],
    { env: kindEnv(support, { LANG: "C", TZ: "UTC" }), stdio: ["ignore", "pipe", "pipe"] });
  const ende = new Promise((ok) => halter.on("exit", (c) => ok(c)));
  const t0 = Date.now(); while (!existsSync(pause) && Date.now() - t0 < 15000) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(existsSync(join(v.aktionenOrt(), ".sperre")), "die Sperre liegt im Vault, für jeden Prozess am selben Ort");
  const spaeter = await new Promise((ok) => {
    const k = spawn(process.execPath, [KIND, JSON.stringify({ vault: d, support, methode: "umbenennen", eingabe: { pfad: "a/x.md", dateiname: "z.md" }, punkt: "nie" })], { env: kindEnv(support, { LANG: "de_DE.UTF-8", TZ: "Asia/Tokyo" }), stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; k.stderr.on("data", (x) => { err += x; }); k.on("exit", (c) => ok({ c, err }));
  });
  assert.notEqual(spaeter.c, 0); assert.match(spaeter.err, /andere Änderung/);
  assert.equal(lies(d, "l.md"), "[[ord2/n]]\n", "der Halter hat seine Verweise geschrieben, nichts wurde zurückgefahren");
  writeFileSync(pause + ".weiter", "");
  assert.equal(await ende, 0);
  assert.ok(existsSync(join(d, "ord2/n.md"))); assert.ok(existsSync(join(d, "a/x.md")));
  assert.deepEqual((await oeffneVault(d, { support }).papierkorb()).hinweise, []);
});
