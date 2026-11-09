// KI-Vorschläge in der Vorschau (scripts/vorschau.sh --mit-ki, Paket #88): Der claude-Platzhalter erkennt KORTEX-VORSCHLAG/1 und antwortet DETERMINISTISCH aus dem Datenpaket, jedes Ergebnis mit
// "vorschau": true (das Studio zeigt die Marke „Vorschau-Beispiel“). Getestet wird das echte Skript aus Sources/BrainCore/VorschauPlatzhalter.swift (zwischen den Marken) durch die echte
// Werkstatt-Funktion — alles in Temp-Ordnern, nie das echte claude oder HOME.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";
import { nurUnix } from "./attrappe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { VORSCHAU_VORSCHLAG_TEXT } = await import(pfad("werkstatt", "ki-vorschlag.mjs"));
const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
after(() => { beendeAlleProzesse(); });

const SKIP = nurUnix("Vorschau (scripts/vorschau.sh) ist ein macOS-Entwicklungswerkzeug; KORTEX_VORSCHAU erlaubt nur /…-Pfade und der Platzhalter ist ein sh-Skript");
function platzhalterSkript() {
  const swift = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Sources", "BrainCore", "VorschauPlatzhalter.swift"), "utf8");
  const holeBlock = (anfang, ende) => {
    const i = swift.indexOf(anfang), j = swift.indexOf(ende, i + anfang.length);
    assert.ok(i >= 0 && j > i, `Marke fehlt: ${anfang}`);
    const zeilen = swift.slice(i + anfang.length, j).replace(/^\n/, "").split("\n");
    const einzug = Math.min(...zeilen.filter((z) => z.trim()).map((z) => z.match(/^ */)[0].length));
    return zeilen.map((z) => z.slice(einzug)).join("\n").replace(/\n+$/, "\n");
  };
  const schutz = holeBlock('static let schutz = """', '"""').replace(/\n$/, "");
  return holeBlock('static let claude = #"""', '"""#').replace("\\#(schutz)", schutz);
}

function vorschau() {
  const vo = realpathSync(tmp("kortex-vorschau-"));
  writeFileSync(join(vo, ".kortex-vorschau"), "");
  for (const u of ["home", "support", "bin", "tmp"]) mkdirSync(join(vo, u));
  const home = join(vo, "home"), support = join(vo, "support"), bin = join(vo, "bin");
  const vault = join(home, "vaults", "probe");
  schreibe(vault, "brain.config.json", "{}\n");
  schreibe(vault, "00_inbox/Idee.md", "# Idee\n\nWir sollten das Projekt Atlas mit der Kaffeemaschine besprechen.\n");
  schreibe(vault, "10_projekte/Atlas.md", "# Atlas\n\nProjekt Atlas, Planung.\n");
  schreibe(vault, "10_projekte/Kaffeemaschine.md", "# Kaffeemaschine\n\nEntkalken.\n");
  const profil = join(home, ".claude"); mkdirSync(profil); writeFileSync(join(profil, "settings.json"), "{}");
  const ordner = realpathSync(profil);
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Probe", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner, standard: true, name: "Standard", ordnerKennung: K.kennungVon(ordner), abo: "max" } },
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen" }, vorschlaege: { an: true, seit: "2026-11-09T10:00:00.000Z", konto: "k_aaaaaaaa" } } } }));
  writeFileSync(join(bin, "claude"), platzhalterSkript());
  chmodSync(join(bin, "claude"), 0o755);
  return { vo, home, support, bin, vault };
}
const werkstattEnv = (p, extra = {}) => baueTestUmgebung({ HOME: p.home, BRAIN_APP_SUPPORT: p.support, PATH: `${p.bin}:/usr/bin:/bin`, TMPDIR: join(p.vo, "tmp") + "/", KORTEX_VORSCHAU: p.vo, ...extra });

async function anfrage(p, env, eingabe) {
  const temp = realpathSync(tmp("kortex-vorschlag-temp-"));
  const h = erzeugeHandler({ vault: p.vault, vaultOptionen: { support: p.support }, kontenHome: p.home, kontenErkennung: () => [], frageEnv: env, vorschlagTemp: temp });
  const api = async (methode, pf, daten) => {
    const q = pf.indexOf("?");
    const r = await h({ methode, pfad: q < 0 ? pf : pf.slice(0, q), query: q < 0 ? null : pf.slice(q + 1), body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    return { status: r.status, j: JSON.parse(r.body.toString("utf8")) };
  };
  const s = await api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", ...eingabe });
  assert.equal(s.status, 200, JSON.stringify(s.j));
  for (let i = 0; i < 200; i++) {
    const r = await api("GET", `/api/ki/vorschlag/stand?id=${s.j.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    if (r.j.fertig) return r.j;
  }
  assert.fail("Anfrage wird nicht fertig");
}

test("Vorschau: Posteingang — der Platzhalter antwortet deterministisch: erster Kandidat als Verlinkungs-Vorschlag, mit Marke „Vorschau“", { skip: SKIP }, async () => {
  const p = vorschau();
  const r1 = await anfrage(p, werkstattEnv(p), { funktion: "posteingang", pfad: "00_inbox/Idee.md" });
  assert.equal(r1.ergebnis.ok, true, JSON.stringify(r1.ergebnis));
  assert.equal(r1.ergebnis.vorschau, true);
  assert.equal(r1.ergebnis.vorschlaege.length, 1);
  assert.equal(r1.ergebnis.vorschlaege[0].art, "verlinken");
  assert.match(r1.ergebnis.vorschlaege[0].beschriftung, /^Verlinkt mit „/);
  const r2 = await anfrage(p, werkstattEnv(p), { funktion: "posteingang", pfad: "00_inbox/Idee.md" });
  const gleich = (a) => ({ art: a.art, beschriftung: a.beschriftung, beleg: a.beleg, begruendung: a.begruendung });
  assert.deepEqual(r2.ergebnis.vorschlaege.map(gleich), r1.ergebnis.vorschlaege.map(gleich), "deterministisch: zweimal dieselbe Antwort");
  rmSync(p.vo, { recursive: true, force: true });
});

test("Vorschau: Text-Aktionen — Umschreiben/Kürzen/Übersetzen geben die Auswahl zurück, Aufgaben haben einen gültigen Beleg; alles mit Marke", { skip: SKIP }, async () => {
  const p = vorschau();
  const sel = "Projekt Atlas, Planung.";
  const e = await anfrage(p, werkstattEnv(p), { funktion: "text", aktion: "umschreiben", pfad: "10_projekte/Atlas.md", auswahl: sel });
  assert.equal(e.ergebnis.ok, true, JSON.stringify(e.ergebnis));
  assert.equal(e.ergebnis.ersatz, sel); assert.equal(e.ergebnis.vorschau, true);
  const a = await anfrage(p, werkstattEnv(p), { funktion: "text", aktion: "aufgaben", pfad: "10_projekte/Atlas.md", auswahl: sel });
  assert.equal(a.ergebnis.ok, true, JSON.stringify(a.ergebnis));
  assert.equal(a.ergebnis.aufgaben.length, 1); assert.equal(a.ergebnis.vorschau, true);
  const mitAnfuehrung = await anfrage(p, werkstattEnv(p), { funktion: "text", aktion: "kuerzen", pfad: "10_projekte/Atlas.md", auswahl: "Projekt Atlas" });
  assert.equal(mitAnfuehrung.ergebnis.ersatz, "Projekt Atlas");
  rmSync(p.vo, { recursive: true, force: true });
});

test("Vorschau: ohne KORTEX_VORSCHAU verweigert der Platzhalter die Arbeit; scheitert der Platzhalter in der Vorschau, steht ein freundlicher Text statt eines internen Fehlers da", { skip: SKIP }, async () => {
  const p = vorschau();
  const ohne = werkstattEnv(p); delete ohne.KORTEX_VORSCHAU;
  const r = await anfrage(p, ohne, { funktion: "posteingang", pfad: "00_inbox/Idee.md" });
  assert.equal(r.ergebnis.ok, false);
  assert.notEqual(r.ergebnis.fehler, VORSCHAU_VORSCHLAG_TEXT, "keine Vorschau: der echte Fehlertext");
  writeFileSync(join(p.bin, "claude"), "#!/bin/sh\necho 'interner Fehler 123' >&2\nexit 3\n");
  const f = await anfrage(p, werkstattEnv(p), { funktion: "posteingang", pfad: "00_inbox/Idee.md" });
  assert.equal(f.ergebnis.ok, false);
  assert.equal(f.ergebnis.fehler, VORSCHAU_VORSCHLAG_TEXT);
  assert.doesNotMatch(f.ergebnis.fehler, /interner Fehler/);
  rmSync(p.vo, { recursive: true, force: true });
});

test("Vorschau: Zusammenfassung — ein Beispielsatz mit gültigen Belegen aus dem Paket (z1, z2), deterministisch, mit Marke „Vorschau“", { skip: SKIP }, async () => {
  const p = vorschau();
  const r1 = await anfrage(p, werkstattEnv(p), { funktion: "zusammenfassung", seit: "2020-01-01T00:00:00.000Z" });
  assert.equal(r1.ergebnis.ok, true, JSON.stringify(r1.ergebnis));
  assert.equal(r1.ergebnis.vorschau, true);
  assert.equal(r1.ergebnis.saetze.length, 1);
  assert.match(r1.ergebnis.saetze[0].text, /^Vorschau-Beispiel: Neu ist unter anderem .+\.$/);
  assert.deepEqual(r1.ergebnis.saetze[0].belege.map((b) => b.id), ["z1", "z2"]);
  for (const b of r1.ergebnis.saetze[0].belege) assert.ok(b.pfad && b.titel, "Chips mit Titel und Pfad von Kortex");
  const r2 = await anfrage(p, werkstattEnv(p), { funktion: "zusammenfassung", seit: "2020-01-01T00:00:00.000Z" });
  assert.deepEqual(r2.ergebnis.saetze, r1.ergebnis.saetze, "deterministisch: zweimal dieselbe Antwort");
  rmSync(p.vo, { recursive: true, force: true });
});

test("Vorschau: Erwähnungen prüfen — ein Beispielurteil „unklar“ für f1 (gesendete Kennung), deterministisch, mit Marke „Vorschau“", { skip: SKIP }, async () => {
  const p = vorschau();
  for (const n of [1, 2, 3]) schreibe(p.vault, `20_notizen/Quelle ${n}.md`, `# Quelle ${n}\n\nHeute sprechen wir über Atlas in Runde ${n} und planen die nächsten Schritte.\n`);
  const r1 = await anfrage(p, werkstattEnv(p), { funktion: "erwaehnungen", pfad: "10_projekte/Atlas.md" });
  assert.equal(r1.ergebnis.ok, true, JSON.stringify(r1.ergebnis));
  assert.equal(r1.ergebnis.vorschau, true);
  assert.deepEqual(r1.ergebnis.urteile.map((u) => [u.id, u.gemeint]), [["f1", "unklar"]]);
  assert.match(r1.ergebnis.urteile[0].grund, /^Vorschau-Beispiel/);
  const r2 = await anfrage(p, werkstattEnv(p), { funktion: "erwaehnungen", pfad: "10_projekte/Atlas.md" });
  assert.deepEqual(r2.ergebnis.urteile, r1.ergebnis.urteile, "deterministisch");
  rmSync(p.vo, { recursive: true, force: true });
});
