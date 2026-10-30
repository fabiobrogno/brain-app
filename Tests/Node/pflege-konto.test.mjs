// Pflege-Konto und KI-Stufe je Vault (docs/plaene/ki-konten.md, Abschnitt 5, Paket P3): Routen (/api/ki/pflege), Prüfung der Eingaben, Parität Werkstatt ↔ Kern,
// Status (letzter/nächster Lauf), „Jetzt pflegen“ und die einmalige Übernahme des festen Profils aus der alten plist.
// Nur Wegwerf-Orte unter dem Temp-Ordner; die plist liegt in einem Temp-HOME (nie ~/Library/LaunchAgents), der Starter ist eine Attrappe, kein echtes claude/launchctl.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync, chmodSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
const HOME0 = tmp("brain-home-");
process.env.HOME = HOME0;

const G = await import(pfad("gemeinsam", "ki-konten.mjs"));
const KERN = await import(pfad("kern", "ki-konten.mjs"));
const { pflegeAufloesen } = await import(pfad("kern", "pflege-konto.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", JSON.stringify({ automatik: { tageslauf: "an" } })); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const claudeProfil = (home, name = "") => { const p = join(home, name ? `.claude-${name}` : ".claude"); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
const kennung = (p) => G.kennungVon(p);
// Eine fertige Liste: Konten (Standard, A, B, Codex) und die Vaults mit Stufen/Pflege.
function liste(support, vaults, { A, B, STD }) {
  const konten = {
    k_00000001: { programm: "claude", ordner: STD, standard: true, name: "Standard", ordnerKennung: kennung(STD) },
    k_0000000a: { programm: "claude", ordner: A, standard: false, name: "A", ordnerKennung: kennung(A) },
    k_0000000b: { programm: "claude", ordner: B, standard: false, name: "B", ordnerKennung: kennung(B) },
    k_0000000c: { programm: "codex", ordner: join(HOME0, ".codex"), standard: true, name: "Codex", ordnerKennung: "" },
  };
  const v = {};
  for (const [p, e] of Object.entries(vaults)) v[p] = { ordnerKennung: kennung(p), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: e.konten, ...(e.pflege !== undefined ? { pflege: e.pflege } : {}) };
  mkdirSync(support, { recursive: true });
  writeFileSync(G.kontenPfad(support), JSON.stringify({ version: 1, konten, vaults: v }));
}
const ERW = { k_00000001: "erweitert", k_0000000a: "erweitert", k_0000000b: "posteingang", k_0000000c: "erweitert" };
function aufbau() {
  const home = tmp("brain-home-");
  const P = { STD: claudeProfil(home), A: claudeProfil(home, "a"), B: claudeProfil(home, "b") };
  const s = tmp("brain-support-");
  const v1 = neuesVault(), v2 = neuesVault();
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [v1, v2].map((p, i) => ({ name: `V${i + 1}`, pfad: p, farbe: "#5B8DEF" })), aktiv: v1 }));
  liste(s, { [v1]: { konten: ERW }, [v2]: { konten: ERW } }, P);
  return { home, P, s, v1, v2 };
}
const handler = (a, extra = {}) => aufruf(erzeugeHandler({ vault: a.v1, vaultOptionen: { support: a.s }, kontenHome: a.home, kontenErkennung: () => [], kontenVerbunden: () => false,
  mcpPfad: (() => { const m = tmp("brain-mcpdir-"); schreibe(m, "brain-mcp.mjs", "//\n"); return join(m, "brain-mcp.mjs"); })(), ...extra }));
const pflegeVon = (s, v) => G.pflegeFuer(G.liesKonten(s).daten, v);

test("Parität: gemeinsam und Kern lesen vaults[v].pflege gleich; pflegeWirksam (Werkstatt) und pflegeAufloesen (Kern) kommen bei jedem Fall zum selben Ergebnis", () => {
  const a = aufbau();
  const faelle = [
    undefined, null, "mittel", 5, [], {}, { stufe: "klein" }, { konto: null, stufe: "klein" }, { konto: "k_0000000a", stufe: "klein" }, { konto: "k_0000000a", stufe: "mittel" },
    { konto: "k_0000000a", stufe: "aus" }, { konto: "k_0000000b", stufe: "mittel" }, { konto: "k_00000001", stufe: "mittel" }, { konto: "k_0000000c", stufe: "mittel" }, { konto: "k_0000000c", stufe: "aus" },
    { konto: "k_deadbeef", stufe: "mittel" }, { konto: "kaputt", stufe: "mittel" }, { konto: 7, stufe: "klein" }, { konto: "k_0000000a", stufe: "riesig" }, { konto: null, stufe: "aus" },
  ];
  const abschnitt = (d) => { const t = readFileSync(d, "utf8"); return t.slice(t.indexOf("// LESEN-BEGINN"), t.indexOf("// LESEN-ENDE")); };
  assert.equal(abschnitt(pfad("kern", "ki-konten.mjs")), abschnitt(pfad("gemeinsam", "ki-konten.mjs")), "der lesende Abschnitt (mit pflegeFuer) ist wortgleich");
  assert.ok(Object.hasOwn(KERN, "pflegeFuer") && Object.hasOwn(KERN, "PFLEGE_STUFEN"));
  for (const f of faelle) {
    liste(a.s, { [a.v1]: { konten: ERW, ...(f === undefined ? {} : { pflege: f }) } }, a.P);
    const d = G.liesKonten(a.s).daten;
    const x = G.pflegeFuer(d, a.v1), y = KERN.pflegeFuer(d, a.v1);
    assert.deepEqual(y, x, JSON.stringify(f));
    const w = G.pflegeWirksam(d, a.v1);
    const k = pflegeAufloesen(a.v1, { support: a.s, env: { PATH: "/usr/bin", BRAIN_TESTMODUS: "1" } });
    assert.equal(k.modus, w.modus, JSON.stringify(f));
    if (w.modus !== "alt") { assert.equal(k.bewusst, w.bewusst, JSON.stringify(f)); assert.equal(k.stufe, w.stufe, JSON.stringify(f)); assert.equal(Boolean(k.grund), Boolean(w.problem), JSON.stringify(f)); }
    if (w.modus === "konto") assert.equal(k.env.CLAUDE_CONFIG_DIR, w.konto === "k_00000001" ? undefined : d.konten[w.konto].ordner);
  }
});

test("POST /api/ki/pflege: setzt Konto und Stufe atomar (Modus 0600), nur für Vaults und Konten aus den Listen, nur mit Stufe erweitert; die Antwort ist der Stand", async () => {
  const a = aufbau();
  const rufe = handler(a);
  let r = await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: "k_0000000a", stufe: "klein" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(pflegeVon(a.s, a.v1), { gesetzt: true, konto: "k_0000000a", stufe: "klein" });
  assert.equal(statSync(G.kontenPfad(a.s)).mode & 0o777, 0o600);
  const v1 = r.j.vaults.find((v) => v.pfad === a.v1), v2 = r.j.vaults.find((v) => v.pfad === a.v2);
  assert.deepEqual(v1.pflege, { gesetzt: true, konto: "k_0000000a", stufe: "klein", wirksam: "konto", bewusst: false });
  assert.deepEqual(v2.pflege, { gesetzt: false, wirksam: "alt" }, "der andere Vault bleibt unberührt");
  // zweiter Vault, anderes Konto
  r = await rufe("POST", "/api/ki/pflege", { vault: a.v2, konto: "k_00000001", stufe: "mittel" });
  assert.equal(r.status, 200); assert.equal(pflegeVon(a.s, a.v2).konto, "k_00000001"); assert.equal(pflegeVon(a.s, a.v1).konto, "k_0000000a");
  // Ohne KI: bewusst, mit oder ohne Konto
  r = await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: null, stufe: "aus" });
  assert.equal(r.status, 200); assert.deepEqual(r.j.vaults.find((v) => v.pfad === a.v1).pflege, { gesetzt: true, konto: null, stufe: "aus", wirksam: "aus", bewusst: true });
  // Konto ohne erweitert: 409 mit Weg dorthin, nichts geschrieben
  const vorher = readFileSync(G.kontenPfad(a.s), "utf8");
  r = await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: "k_0000000b", stufe: "mittel" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "stufe"); assert.match(r.j.fehler, /Wer darf diesen Vault sehen/); assert.match(r.j.fehler, /Erweitert/);
  r = await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: "k_0000000c", stufe: "mittel" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-claude");
  r = await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: null, stufe: "klein" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-konto");
  assert.equal(readFileSync(G.kontenPfad(a.s), "utf8"), vorher, "abgelehnte Eingaben ändern nichts");
  // Eingaben
  for (const schlecht of [{ konto: "k_0000000a", stufe: "klein" }, { vault: a.v1, konto: "k_0000000a" }, { vault: a.v1, konto: "k_0000000a", stufe: "riesig" }, { vault: a.v1, konto: 5, stufe: "klein" }, { vault: 5, konto: null, stufe: "aus" }]) {
    assert.equal((await rufe("POST", "/api/ki/pflege", schlecht)).status, 400, JSON.stringify(schlecht));
  }
  assert.equal((await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: "k_00000000", stufe: "klein" })).status, 404, "unbekanntes Konto");
  assert.equal((await rufe("POST", "/api/ki/pflege", { vault: neuesVault(), konto: "k_0000000a", stufe: "klein" })).status, 404, "nur Vaults aus der Liste der App");
  assert.equal((await rufe("POST", "/api/ki/pflege", { vault: "/etc", konto: "k_0000000a", stufe: "klein" })).status, 404);
  assert.equal((await rufe("PUT", "/api/ki/pflege", { vault: a.v1, stufe: "aus" })).status, 405);
  assert.equal((await rufe("GET", "/api/ki/pflege")).status, 400, "GET braucht den Vault");
});

test("Wird dem Konto später die Stufe genommen, bleibt die Einstellung stehen und der Stand meldet das Problem (die Pflege läuft dann ohne KI, kein Ausweichen auf ein anderes Konto)", async () => {
  const a = aufbau();
  const rufe = handler(a);
  await rufe("POST", "/api/ki/pflege", { vault: a.v1, konto: "k_0000000a", stufe: "mittel" });
  let r = await rufe("PUT", "/api/ki/zugriff", { konto: "k_0000000a", vault: a.v1, stufe: "lesen" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.vaults.find((v) => v.pfad === a.v1).pflege, { gesetzt: true, konto: "k_0000000a", stufe: "mittel", wirksam: "aus", bewusst: false, problem: "stufe" });
  const k = pflegeAufloesen(a.v1, { support: a.s, env: { PATH: "/usr/bin" } });
  assert.deepEqual([k.modus, k.bewusst], ["aus", false]);
  assert.match(k.grund, /keine ausreichende Freigabe/);
});

test("Migration: das feste Profil der alten plist wird das Pflege-Konto der Vaults des Dienstes (erweitert → mittel, sonst ohne KI + Hinweis); einmalig, überschreibt nichts Eingestelltes", async () => {
  const a = aufbau();
  const v3 = neuesVault();
  writeFileSync(join(a.s, "vaults.json"), JSON.stringify({ vaults: [a.v1, a.v2, v3].map((p, i) => ({ name: `V${i + 1}`, pfad: p, farbe: "#5B8DEF" })), aktiv: a.v1 }));
  liste(a.s, { [a.v1]: { konten: ERW }, [a.v2]: { konten: ERW, pflege: { konto: "k_00000001", stufe: "klein" } }, [v3]: { konten: ERW } }, a.P);
  writeFileSync(join(a.s, "dienst.json"), JSON.stringify({ vaults: [a.v1, a.v2] }));      // v3 ist nicht im Dienst
  const plist = join(a.home, "Library", "LaunchAgents", "de.brain.tageslauf.plist");
  mkdirSync(join(a.home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0"?><plist><dict><key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin</string>\n<key>CLAUDE_CONFIG_DIR</key><string>${a.P.A}</string></dict></dict></plist>`);
  const rufe = handler(a);
  const r = await rufe("GET", "/api/ki/konten");
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(pflegeVon(a.s, a.v1), { gesetzt: true, konto: "k_0000000a", stufe: "mittel" }, "Konto A hat erweitert → mittel (wie heute)");
  assert.deepEqual(pflegeVon(a.s, a.v2), { gesetzt: true, konto: "k_00000001", stufe: "klein" }, "eine vorhandene Einstellung bleibt");
  assert.equal(pflegeVon(a.s, v3).gesetzt, false, "ein Vault ohne Dienst bekommt nichts");
  assert.equal(r.j.pflegeHinweise, undefined);
  const nach = readFileSync(G.kontenPfad(a.s), "utf8");
  await rufe("GET", "/api/ki/konten");
  assert.equal(readFileSync(G.kontenPfad(a.s), "utf8"), nach, "zweiter Aufruf: nichts mehr zu tun (einmalig)");
  assert.ok(G.liesKonten(a.s).daten.pflegeMigration.seit);
});

test("Migration: hat das Konto des Dienstes nicht erweitert (oder gibt es das Profil nicht), steht der Vault auf „ohne KI“ mit Hinweis; ohne Variable war das Standardprofil das Konto; ohne plist geschieht nichts", async () => {
  // Konto B (Stufe posteingang) war das Profil des Dienstes
  let a = aufbau();
  writeFileSync(join(a.s, "dienst.json"), JSON.stringify({ vaults: [a.v1] }));
  const plistMit = (home, profil) => { const d = join(home, "Library", "LaunchAgents"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "de.brain.tageslauf.plist"), `<plist><dict><key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin</string>${profil ? `<key>CLAUDE_CONFIG_DIR</key><string>${profil}</string>` : ""}</dict></dict></plist>`); };
  plistMit(a.home, a.P.B);
  let r = await handler(a)("GET", "/api/ki/konten");
  assert.deepEqual(pflegeVon(a.s, a.v1), { gesetzt: true, konto: "k_0000000b", stufe: "aus" });
  assert.deepEqual(r.j.pflegeHinweise, [{ vault: a.v1, grund: "stufe", konto: "k_0000000b" }]);
  assert.deepEqual(r.j.vaults.find((v) => v.pfad === a.v1).pflege.bewusst, true);
  // der Nutzer stellt es selbst ein → der Hinweis verschwindet
  await handler(a)("PUT", "/api/ki/zugriff", { konto: "k_0000000b", vault: a.v1, stufe: "erweitert" });
  r = await handler(a)("POST", "/api/ki/pflege", { vault: a.v1, konto: "k_0000000b", stufe: "mittel" });
  assert.equal(r.j.pflegeHinweise, undefined);
  // ein Profil, das Kortex nicht kennt
  a = aufbau(); writeFileSync(join(a.s, "dienst.json"), JSON.stringify({ vaults: [a.v1] }));
  plistMit(a.home, join(a.home, ".claude-gibtesnicht"));
  r = await handler(a)("GET", "/api/ki/konten");
  assert.deepEqual(pflegeVon(a.s, a.v1), { gesetzt: true, konto: null, stufe: "aus" });
  assert.equal(r.j.pflegeHinweise[0].grund, "kein-konto");
  // ohne Variable: Standardprofil
  a = aufbau(); writeFileSync(join(a.s, "dienst.json"), JSON.stringify({ vaults: [a.v1] }));
  plistMit(a.home, null);
  await handler(a)("GET", "/api/ki/konten");
  assert.deepEqual(pflegeVon(a.s, a.v1), { gesetzt: true, konto: "k_00000001", stufe: "mittel" });
  // ohne plist: nichts, und kein Vermerk (eine spätere plist ist schon die neue Form)
  a = aufbau(); writeFileSync(join(a.s, "dienst.json"), JSON.stringify({ vaults: [a.v1] }));
  await handler(a)("GET", "/api/ki/konten");
  assert.equal(pflegeVon(a.s, a.v1).gesetzt, false);
  assert.equal(G.liesKonten(a.s).daten.pflegeMigration, undefined);
});

test("GET /api/ki/pflege: letzter Lauf aus letzter.json (nur feste Felder), nächster Lauf, Dienst; unbekannter Vault → 404; ein Link statt der Datei wird nicht gelesen", async () => {
  const a = aufbau();
  const rufe = handler(a);
  let r = await rufe("GET", "/api/ki/pflege", undefined, `vault=${encodeURIComponent(a.v1)}`);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.letzter, null); assert.deepEqual(r.j.naechster, { art: "sitzungsstart" }); assert.equal(r.j.schalter, "an"); assert.equal(r.j.dienst.eingerichtet, false);
  const jetzt = Date.now();
  const erfolg = new Date(jetzt - 2 * 3600e3).toISOString();
  schreibe(a.v1, ".logs/tageslauf/letzter.json", JSON.stringify({ lauf: "x", zeit: erfolg, status: "ok-ohne-ki", erfolgreich: true, modus: "an", art: "voll", letzterErfolg: erfolg, grund: null, aufrufe: 0, tokEin: 12, tokAus: 3,
    zahlen: { uebernommen: 2, rueckfragen: 1, geheim: "x" }, ki: { modus: "aus", stufe: "aus", bewusst: true }, pfad: "/Users/geheim", fehlerquote: { fehler: 0 } }));
  writeFileSync(join(a.s, "dienst.json"), JSON.stringify({ vaults: [a.v1] }));
  const d = join(a.home, "Library", "LaunchAgents"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "de.brain.tageslauf.plist"), "<plist/>");
  r = await rufe("GET", "/api/ki/pflege", undefined, `vault=${encodeURIComponent(a.v1)}`);
  assert.deepEqual(r.j.letzter, { zeit: erfolg, status: "ok-ohne-ki", erfolgreich: true, modus: "an", art: "voll", letzterErfolg: erfolg, aufrufe: 0, tokEin: 12, tokAus: 3, uebernommen: 2, rueckfragen: 1, ki: { modus: "aus", stufe: "aus", bewusst: true } });
  assert.ok(!JSON.stringify(r.j).includes("geheim"), "nur die festen Felder");
  assert.equal(r.j.dienst.fuerVault, true);
  assert.equal(r.j.naechster.art, "dienst");
  assert.equal(r.j.naechster.fruehestens, new Date(Date.parse(erfolg) + 20 * 3600e3).toISOString(), "20 Stunden nach dem letzten Erfolg");
  assert.equal((await rufe("GET", "/api/ki/pflege", undefined, `vault=${encodeURIComponent(neuesVault())}`)).status, 404);
  // Schalter aus
  writeFileSync(join(a.v1, "brain.config.json"), JSON.stringify({ automatik: { tageslauf: "aus" } }));
  assert.deepEqual((await rufe("GET", "/api/ki/pflege", undefined, `vault=${encodeURIComponent(a.v1)}`)).j.naechster, { art: "aus" });
  // ein Link statt der Datei: nicht gelesen
  const ziel = join(tmp("fremd-"), "l.json"); writeFileSync(ziel, JSON.stringify({ status: "ok", zeit: erfolg }));
  const dateiL = join(a.v1, ".logs", "tageslauf", "letzter.json"); (await import("node:fs")).rmSync(dateiL); symlinkSync(ziel, dateiL);
  assert.equal((await rufe("GET", "/api/ki/pflege", undefined, `vault=${encodeURIComponent(a.v1)}`)).j.letzter, null);
});

test("POST /api/ki/pflege/jetzt: startet den Tageslauf des offenen Vaults über den Starter (--losgeloest, --vault); meldet ehrlich, wenn der Kern nicht startet; ohne Starter 409", async () => {
  const a = aufbau();
  const bin = tmp("brain-starter-"); const log = join(bin, "aufrufe.log");
  const starter = join(bin, "kortex");
  const bauen = (ausgabe) => { writeFileSync(starter, `#!/bin/sh\necho "$@" >> '${log}'\necho '${ausgabe}'\n`); chmodSync(starter, 0o755); };
  bauen("Tageslauf läuft im Hintergrund.");
  const rufe = handler(a, { starter });
  let r = await rufe("POST", "/api/ki/pflege/jetzt", {});
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.gestartet, true);
  assert.equal(readFileSync(log, "utf8").trim(), `tageslauf --losgeloest --vault ${a.v1}`);
  bauen("Tageslauf nicht gestartet: läuft schon.");
  r = await rufe("POST", "/api/ki/pflege/jetzt", {});
  assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-gestartet"); assert.match(r.j.fehler, /läuft schon/);
  assert.equal((await rufe("GET", "/api/ki/pflege/jetzt")).status, 405);
  const ohne = handler(a, { starter: join(bin, "gibt-es-nicht") });
  r = await ohne("POST", "/api/ki/pflege/jetzt", {});
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-starter");
  assert.ok(existsSync(log));
});
