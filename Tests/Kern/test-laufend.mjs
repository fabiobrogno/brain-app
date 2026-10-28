// K13 „Was läuft parallel": je Sitzung eine Datei, atomar geschrieben; nur gleiches Repo/gleicher Vault zählt; ohne
// Lebenszeichen > 2 h zählt nicht, > 24 h wird aufgeräumt (Absturz ohne SessionEnd); jede andere Sitzung wird einmal
// gemeldet; Titel nie mit Zugangs- oder Kundendaten. Nur Hinweis — nichts wird gesperrt oder übernommen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { anmelden, parallele, puls, abmelden, raeumeAuf, hinweisZeile, titelAusPrompt } from "../laufend.mjs";
import { tempOrdner, tempVault, hook, KIT } from "./verlauf-fixture.mjs";

test("anmelden/parallele: gleiche Wurzel zählt, andere nicht, eigene nicht, ohne Lebenszeichen > 2 h nicht", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/repo/x", titel: "Export", jetzt: t - 3 * 3600000 });
  anmelden(v, { sid: "b", schluessel: "/repo/x", titel: "Doku", jetzt: t - 60000 });
  anmelden(v, { sid: "c", schluessel: "/repo/y", jetzt: t });
  const r = anmelden(v, { sid: "d", schluessel: "/repo/x", jetzt: t });
  assert.deepEqual(r.andere.map((e) => e.sid), ["b"]);
  assert.doesNotMatch(hinweisZeile(r.andere), /peers/);
  assert.match(hinweisZeile(r.andere), /^Parallel im selben Repo: „Doku“ seit \d\d:\d\d — .*Cross-Session-Messaging.*nichts wird gesperrt/);
  assert.equal(anmelden(v, { sid: "e", schluessel: null, jetzt: t }).andere.length, 0, "ohne Repo zählt nichts");
  assert.equal(hinweisZeile([]), "");
});

test("puls: Lebenszeichen, Titel aus dem ersten Prompt, neue Parallele nur einmal melden", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/r", jetzt: t });
  assert.deepEqual(puls(v, { sid: "a", prompt: "Baue den Export bitte", jetzt: t + 1000 }), []);
  anmelden(v, { sid: "b", schluessel: "/r", titel: "Andere Arbeit", jetzt: t + 2000 });
  assert.deepEqual(puls(v, { sid: "a", prompt: "weiter", jetzt: t + 3000 }).map((e) => e.sid), ["b"]);
  assert.deepEqual(puls(v, { sid: "a", prompt: "weiter", jetzt: t + 4000 }), [], "nur einmal melden");
  assert.equal(parallele(v, { sid: "b", schluessel: "/r", jetzt: t + 5000 })[0].titel, "Baue den Export bitte");
  assert.deepEqual(puls(v, { sid: "unbekannt", prompt: "x" }), [], "ohne Anmeldung nichts");
});

test("titelAusPrompt: Zugangs-/Kundendaten → ausgeblendet; Befehle und Systemzeilen → kein Titel", () => {
  assert.equal(titelAusPrompt(["pass","wort"].join("") + "=geheim123 einbauen"), "(Titel ausgeblendet)");
  assert.equal(titelAusPrompt("schick das an max@example.com"), "(Titel ausgeblendet)");
  assert.equal(titelAusPrompt("/compact"), null);
  assert.equal(titelAusPrompt("<task-notification>x"), null);
  assert.equal(titelAusPrompt("  Export   bauen  "), "Export bauen");
});

test("abmelden und Altlasten: SessionEnd trägt aus; ohne SessionEnd (Absturz) > 24 h wird aufgeräumt", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/r", jetzt: t });
  abmelden(v, "a");
  assert.equal(existsSync(join(v, ".logs", "laufend", "a.json")), false);
  anmelden(v, { sid: "tot", schluessel: "/r", jetzt: t - 25 * 3600000 });
  anmelden(v, { sid: "lebt", schluessel: "/r", jetzt: t });
  raeumeAuf(v, t);
  assert.equal(existsSync(join(v, ".logs", "laufend", "tot.json")), false);
  assert.equal(existsSync(join(v, ".logs", "laufend", "lebt.json")), true);
});

test("20 gleichzeitige Prozesse: jede Datei bleibt gültiges JSON, jede Sitzung genau einmal", async () => {
  const v = tempVault();
  const modul = pathToFileURL(join(KIT, "laufend.mjs")).href;
  const skript = `const m = await import(${JSON.stringify(modul)}); const sid = process.argv[1];`
    + "m.anmelden(process.env.BRAIN_VAULT, { sid, schluessel: '/repo' });"
    + "for (let i = 0; i < 20; i++) m.puls(process.env.BRAIN_VAULT, { sid, prompt: 'frage ' + i });";
  await Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((ok, nein) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", skript, `s${i}`], { env: { ...process.env, BRAIN_VAULT: v }, stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? ok() : nein(new Error(`Exit ${c}`))));
  })));
  const dateien = readdirSync(join(v, ".logs", "laufend")).filter((n) => n.endsWith(".json"));
  assert.equal(dateien.length, 20);
  for (const n of dateien) JSON.parse(readFileSync(join(v, ".logs", "laufend", n), "utf8"));
  assert.equal(parallele(v, { sid: "s0", schluessel: "/repo" }).length, 19);
});

test("Hooks: zwei Sitzungen im selben Repo (Pfad mit Leerzeichen/Umlaut) — Start meldet die andere, Prompt meldet Neue einmal, SessionEnd trägt aus, cwd ohne Repo still", () => {
  const v = tempVault();
  const repo = tempOrdner("Gärten Repo");
  mkdirSync(join(repo, ".git"));
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  assert.doesNotMatch(hook("session-start.mjs", { session_id: "sa", source: "startup", cwd: repo }, { vault: v, env }).stdout, /Parallel/);
  const b = hook("session-start.mjs", { session_id: "sb", source: "startup", cwd: join(repo), session_title: "Doku schreiben" }, { vault: v, env });
  assert.match(b.stdout, /Parallel im selben Repo: „ohne Titel“/);
  const p = hook("brain-hint.mjs", { session_id: "sa", prompt: "ok" }, { vault: v });
  assert.equal(p.status, 0);
  assert.match(p.stdout, /Parallel im selben Repo: „Doku schreiben“/);
  assert.doesNotMatch(hook("brain-hint.mjs", { session_id: "sa", prompt: "ok" }, { vault: v }).stdout, /Parallel/);
  const ende = hook("sitzung-ende.mjs", { session_id: "sb", reason: "prompt_input_exit" }, { vault: v });
  assert.equal(ende.status, 0);
  assert.equal(ende.stdout, "");
  assert.equal(existsSync(join(v, ".logs", "laufend", "sb.json")), false);
  const ohne = hook("session-start.mjs", { session_id: "sc", source: "startup", cwd: tempOrdner("kein Repo") }, { vault: v, env });
  assert.doesNotMatch(ohne.stdout, /Parallel/);
});

test("titelAusPrompt (M5): reine Bestätigung ist kein Titel", () => {
  assert.equal(titelAusPrompt("ok"), null);
  assert.equal(titelAusPrompt("ja, mach weiter"), null);
});

test("anmelden (I2): ohne melden=true gilt eine Parallele nicht als gemeldet", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/r", jetzt: t });
  anmelden(v, { sid: "b", schluessel: "/r", titel: "B-Arbeit", jetzt: t + 1000 });
  anmelden(v, { sid: "a", schluessel: "/r", jetzt: t + 2000, melden: false });
  assert.deepEqual(puls(v, { sid: "a", prompt: "weiter", jetzt: t + 3000 }).map((e) => e.sid), ["b"]);
});

test("Hooks (I2): B startet vor A's Kompaktierung — SessionStart(compact) zeigt nichts, der nächste Prompt von A meldet B", () => {
  const v = tempVault();
  const repo = tempOrdner("Repo Ü");
  mkdirSync(join(repo, ".git"));
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  hook("session-start.mjs", { session_id: "sa", source: "startup", cwd: repo }, { vault: v, env });
  hook("session-start.mjs", { session_id: "sb", source: "startup", cwd: repo, session_title: "B-Arbeit" }, { vault: v, env });
  const c = hook("session-start.mjs", { session_id: "sa", source: "compact", cwd: repo }, { vault: v, env });
  assert.doesNotMatch(c.stdout, /Parallel/);
  assert.match(hook("brain-hint.mjs", { session_id: "sa", prompt: "ok" }, { vault: v }).stdout, /Parallel im selben Repo: „B-Arbeit“/);
});
