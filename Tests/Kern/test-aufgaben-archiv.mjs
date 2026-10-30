// Aufgaben archivieren (aufgaben.mjs archiviere / archiviereAlte, `brain aufgabe archivieren`): erledigte Aufgaben wandern unverändert in
// <aufgaben-ordner>/archiv/ — nichts wird gelöscht oder überschrieben, Pfadschutz wie sonst, Board und Zähler sehen das Archiv nie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as A from "../aufgaben.mjs";
import { brainStatus } from "../status.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const KERN = join(HIER, "..");
const vault = (cfg = {}) => { const v = mkdtempSync(join(tmpdir(), "aufgaben archiv ")); writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg)); return v; };
const JETZT = new Date("2026-10-30T10:00:00Z");
const VOR = (tage) => new Date(JETZT.getTime() - tage * 86400000);
const lies = (v, rel) => readFileSync(join(v, rel), "utf8");
const namen = (v, rel) => (existsSync(join(v, rel)) ? readdirSync(join(v, rel)).sort() : []);
const fehler = (fn, code, re) => assert.throws(fn, (x) => x instanceof A.AufgabeFehler && x.code === code && (!re || re.test(x.message)), String(fn));
const erledigt = (v, titel, vorTagen = 40, extra = {}) => A.legeAn(v, { titel, status: "erledigt", ...extra }, { jetzt: VOR(vorTagen) });

test("archiviere: eine erledigte Aufgabe wandert Byte für Byte nach archiv/, am alten Ort bleibt nichts, kein Rest im Ordner", () => {
  const v = vault();
  const a = erledigt(v, "Alt erledigt", 40, { text: "Mit Text.\nUnd Umlauten: äöü" });
  const vorher = lies(v, a.pfad);
  const r = A.archiviere(v, a.pfad);
  const name = a.pfad.split("/").pop();
  assert.equal(r.von, a.pfad);
  assert.equal(r.pfad, `05_aufgaben/archiv/${name}`);
  assert.equal(r.aufgabe.pfad, r.pfad);
  assert.equal(lies(v, r.pfad), vorher, "unverändert (auch das geaendert-Feld)");
  assert.deepEqual(namen(v, "05_aufgaben"), ["archiv"], "am alten Ort nichts, keine Temp-Datei");
  assert.deepEqual(namen(v, "05_aufgaben/archiv"), [name]);
  assert.ok(lstatSync(join(v, "05_aufgaben", "archiv")).isDirectory());
});

test("Board und Zähler sehen das Archiv nie: liste, zaehle und status ignorieren archiv/ — auch von Hand dorthin gelegte Aufgaben", async () => {
  const v = vault();
  A.legeAn(v, { titel: "Offen" }, { jetzt: JETZT });
  const e = erledigt(v, "Weg damit");
  A.archiviere(v, e.pfad);
  // eine OFFENE Aufgabe, die jemand von Hand ins Archiv gelegt hat, zählt ebenfalls nicht
  writeFileSync(join(v, "05_aufgaben", "archiv", "2026-10-01-von-hand.md"), "---\ntyp: aufgabe\ntitel: Von Hand\nstatus: offen\nfaellig: 2020-01-01\n---\n");
  assert.deepEqual(A.liste(v).map((a) => a.titel), ["Offen"]);
  assert.deepEqual(A.zaehle(v, "2026-10-30"), { offen: 1, ueberfaellig: 0 });
  assert.deepEqual((await brainStatus(v)).aufgaben, { offen: 1, ueberfaellig: 0 });
  assert.throws(() => A.findePfad(v, "weg-damit"), (x) => x.code === 404, "archivierte Aufgaben findet man nicht mehr unter dem Board-Namen");
});

test("archiviere: nur erledigte Aufgaben (409), die anderen bleiben unberührt", () => {
  const v = vault();
  for (const status of ["offen", "in-arbeit", "warten"]) {
    const a = A.legeAn(v, { titel: `Aufgabe ${status}`, status }, { jetzt: VOR(90) });
    const vorher = lies(v, a.pfad);
    fehler(() => A.archiviere(v, a.pfad), 409, /nur erledigte/i);
    assert.equal(lies(v, a.pfad), vorher);
  }
  assert.equal(existsSync(join(v, "05_aufgaben", "archiv")), false, "kein leerer Archiv-Ordner als Nebenwirkung");
});

test("archiviere: Pfadschutz — nur Dateien direkt im Aufgaben-Ordner; Ausbruch, fremde Ordner, Archiv selbst, Nicht-Aufgaben, Unbekanntes", () => {
  const v = vault();
  const a = erledigt(v, "Echt");
  writeFileSync(join(v, "notiz.md"), "---\ntyp: aufgabe\nstatus: erledigt\n---\n");
  mkdirSync(join(v, "09_wiki")); writeFileSync(join(v, "09_wiki", "x.md"), "---\ntyp: aufgabe\nstatus: erledigt\n---\n");
  writeFileSync(join(v, "05_aufgaben", "kein-kopf.md"), "# Nur Text\n");
  writeFileSync(join(v, "05_aufgaben", ".versteckt.md"), "---\ntyp: aufgabe\nstatus: erledigt\n---\n");
  writeFileSync(join(v, "05_aufgaben", "_intern.md"), "---\ntyp: aufgabe\nstatus: erledigt\n---\n");
  for (const schlecht of ["../aussen.md", "05_aufgaben/../notiz.md", "notiz.md", "09_wiki/x.md", "/etc/passwd", "05_aufgaben/archiv/x.md", "05_aufgaben/a/b.md", "", null, 5, "05_aufgaben/.versteckt.md", "05_aufgaben/_intern.md", "05_aufgaben/x\ny.md"]) {
    assert.throws(() => A.archiviere(v, schlecht), (x) => x instanceof A.AufgabeFehler && [400, 404].includes(x.code), String(schlecht));
  }
  fehler(() => A.archiviere(v, "05_aufgaben/kein-kopf.md"), 422, /keine Aufgabe/);
  fehler(() => A.archiviere(v, "05_aufgaben/gibtsnicht.md"), 404);
  assert.ok(existsSync(join(v, a.pfad)), "die echte Aufgabe blieb liegen");
  assert.deepEqual(namen(v, ""), ["05_aufgaben", "09_wiki", "brain.config.json", "notiz.md"], "nichts außerhalb angelegt oder verschoben");
});

test("archiviere: ein Verweis als archiv/ wird nie benutzt (403), nichts landet außerhalb; ebenso eine Datei namens archiv", () => {
  const v = vault();
  const a = erledigt(v, "Echt");
  const aussen = mkdtempSync(join(tmpdir(), "archiv aussen "));
  symlinkSync(aussen, join(v, "05_aufgaben", "archiv"));
  fehler(() => A.archiviere(v, a.pfad), 403, /Verweis/);
  assert.deepEqual(readdirSync(aussen), [], "außerhalb des Vaults wurde nichts abgelegt");
  assert.ok(existsSync(join(v, a.pfad)), "die Aufgabe blieb am Ort");
  const w = vault(); const b = erledigt(w, "Echt");
  writeFileSync(join(w, "05_aufgaben", "archiv"), "ich bin eine Datei");
  fehler(() => A.archiviere(w, b.pfad), 422, /Datei, kein Ordner/);
  assert.ok(existsSync(join(w, b.pfad)));
});

test("archiviere: ein Verweis als Aufgaben-Ordner wird nie benutzt (403)", () => {
  const v = vault();
  mkdirSync(join(v, "09_wiki")); writeFileSync(join(v, "09_wiki", "x.md"), "---\ntyp: aufgabe\nstatus: erledigt\n---\n");
  symlinkSync(join(v, "09_wiki"), join(v, "05_aufgaben"));
  fehler(() => A.archiviere(v, "05_aufgaben/x.md"), 403, /Verweis/);
  assert.deepEqual(readdirSync(join(v, "09_wiki")), ["x.md"]);
});

test("archiviere: ein Verweis als Aufgaben-Datei wird nicht gelesen und nicht verschoben", () => {
  const v = vault();
  erledigt(v, "Echt");
  const aussen = mkdtempSync(join(tmpdir(), "archiv fremd ")); writeFileSync(join(aussen, "f.md"), "---\ntyp: aufgabe\nstatus: erledigt\n---\n");
  symlinkSync(join(aussen, "f.md"), join(v, "05_aufgaben", "verweis.md"));
  fehler(() => A.archiviere(v, "05_aufgaben/verweis.md"), 422);
  assert.ok(lstatSync(join(v, "05_aufgaben", "verweis.md")).isSymbolicLink());
  assert.equal(existsSync(join(v, "05_aufgaben", "archiv")), false);
});

test("archiviere: gleicher Name im Archiv → nichts wird überschrieben, die neue Datei bekommt -2, -3", () => {
  const v = vault();
  const a = erledigt(v, "Doppelt", 40, { text: "Erste" });
  const name = a.pfad.split("/").pop();
  const erste = lies(v, a.pfad);
  A.archiviere(v, a.pfad);
  // gleicher Titel und Tag noch einmal angelegt (landet wieder unter demselben Dateinamen, weil der alte weg ist)
  const b = erledigt(v, "Doppelt", 40, { text: "Zweite" });
  assert.equal(b.pfad.split("/").pop(), name);
  const zweite = lies(v, b.pfad);
  const r2 = A.archiviere(v, b.pfad);
  const c = erledigt(v, "Doppelt", 40, { text: "Dritte" });
  const dritte = lies(v, c.pfad);
  const r3 = A.archiviere(v, c.pfad);
  assert.equal(r2.pfad, `05_aufgaben/archiv/${name.replace(/\.md$/, "-2.md")}`);
  assert.equal(r3.pfad, `05_aufgaben/archiv/${name.replace(/\.md$/, "-3.md")}`);
  assert.equal(lies(v, `05_aufgaben/archiv/${name}`), erste);
  assert.equal(lies(v, r2.pfad), zweite);
  assert.equal(lies(v, r3.pfad), dritte);
  assert.deepEqual(namen(v, "05_aufgaben"), ["archiv"]);
});

test("archiviere: eigener Ordnername (todo) → todo/archiv; Groß/Klein eines vorhandenen Archiv-Ordners wird übernommen", () => {
  const v = vault({ ordner: { aufgaben: "todo" } });
  const a = erledigt(v, "Eigener Ordner");
  assert.equal(A.archiviere(v, a.pfad).pfad.startsWith("todo/archiv/"), true);
  const w = vault(); mkdirSync(join(w, "05_aufgaben")); mkdirSync(join(w, "05_aufgaben", "Archiv"));
  const b = erledigt(w, "Groß");
  assert.equal(A.archiviere(w, b.pfad).pfad.startsWith("05_aufgaben/Archiv/"), true);
  assert.deepEqual(namen(w, "05_aufgaben"), ["Archiv"], "kein zweiter Ordner daneben");
});

test("archiviere: ohne Aufgaben-Ordner → 404; die Aufgabe gibt es nur einmal (zweites Archivieren → 404)", () => {
  const v = vault();
  fehler(() => A.archiviere(v, "05_aufgaben/x.md"), 404);
  const a = erledigt(v, "Einmal");
  A.archiviere(v, a.pfad);
  fehler(() => A.archiviere(v, a.pfad), 404);
});

test("archiviereAlte: nur erledigte, die länger als die Tage nicht geändert wurden; Standard 30", () => {
  const v = vault();
  const alt = erledigt(v, "Alt erledigt", 40);
  const grenze = erledigt(v, "Genau dreißig", 30);
  const neu = erledigt(v, "Frisch erledigt", 5);
  const offenAlt = A.legeAn(v, { titel: "Offen und alt", status: "offen" }, { jetzt: VOR(90) });
  const r = A.archiviereAlte(v, { jetzt: JETZT });
  assert.equal(r.tage, 30);
  assert.deepEqual(r.archiviert.map((x) => x.von), [alt.pfad]);
  assert.equal(r.uebersprungen, 0);
  assert.deepEqual(A.liste(v).map((a) => a.titel).sort(), ["Frisch erledigt", "Genau dreißig", "Offen und alt"], "auf dem Board bleiben die übrigen");
  for (const p of [grenze.pfad, neu.pfad, offenAlt.pfad]) assert.ok(existsSync(join(v, p)), p);
  // mit 3 Tagen: auch die frisch erledigte (5 Tage) und die dreißig-Tage-Aufgabe
  const r3 = A.archiviereAlte(v, { tage: 3, jetzt: JETZT });
  assert.deepEqual(r3.archiviert.map((x) => x.von).sort(), [grenze.pfad, neu.pfad].sort());
  assert.deepEqual(A.liste(v).map((a) => a.titel), ["Offen und alt"]);
  assert.equal(namen(v, "05_aufgaben/archiv").length, 3);
  // noch einmal: nichts mehr zu tun
  assert.deepEqual(A.archiviereAlte(v, { jetzt: JETZT }).archiviert, []);
});

test("archiviereAlte: ohne lesbares Datum bleibt eine erledigte Aufgabe stehen; die Tage werden geprüft", () => {
  const v = vault();
  mkdirSync(join(v, "05_aufgaben"));
  writeFileSync(join(v, "05_aufgaben", "ohne-datum.md"), "---\ntyp: aufgabe\ntitel: Ohne Datum\nstatus: erledigt\n---\n");
  writeFileSync(join(v, "05_aufgaben", "kaputtes-datum.md"), "---\ntyp: aufgabe\ntitel: Kaputt\nstatus: erledigt\ngeaendert: gestern\n---\n");
  assert.deepEqual(A.archiviereAlte(v, { jetzt: JETZT }).archiviert, []);
  assert.equal(A.liste(v).length, 2);
  for (const schlecht of [0, -1, 1.5, 3651, "30", NaN, Infinity, null]) fehler(() => A.archiviereAlte(v, { tage: schlecht, jetzt: JETZT }), 400, /Tage/);
});

test("archiviereAlte: eine Aufgabe, die sich nicht verschieben lässt, stoppt die anderen nicht (zählt als übersprungen)", () => {
  const v = vault();
  erledigt(v, "Erste", 40); erledigt(v, "Zweite", 41);
  writeFileSync(join(v, "05_aufgaben", "archiv"), "Datei statt Ordner");   // jede Verschiebung scheitert mit 422
  const r = A.archiviereAlte(v, { jetzt: JETZT });
  assert.deepEqual(r.archiviert, []);
  assert.equal(r.uebersprungen, 2);
  assert.equal(A.liste(v).length, 2, "beide liegen noch da");
});

// ---------- Kommandozeile ----------
const KEIN_KI = { BRAIN_VAULT: "", BRAIN_QUELLE: "", CLAUDECODE: "", GEMINI_CLI: "", CODEX_SANDBOX: "", CODEX_CI: "" };
const brain = (v, ...args) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", v, ...args], { encoding: "utf8", env: { ...process.env, ...KEIN_KI } });

test("CLI: aufgabe archivieren <name> verschiebt eine erledigte Aufgabe; --alte [--tage n] alle älteren", () => {
  const v = vault();
  const e1 = erledigt(v, "Alte Mühle", 40);
  const e2 = erledigt(v, "Mittlere Mühle", 10);
  A.legeAn(v, { titel: "Offene Mühle" });
  let r = brain(v, "aufgabe", "archivieren", "alte-muehle");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Archiviert: 05_aufgaben\/.*alte-muehle\.md → 05_aufgaben\/archiv\/.*alte-muehle\.md\n$/);
  assert.equal(existsSync(join(v, e1.pfad)), false);
  assert.equal(brain(v, "aufgaben", "--alle").stdout.trim().split("\n").length, 2, "Board: die übrigen zwei");
  // Datums-Schwelle: die Aufgabe ist 10 Tage alt → mit Standard 30 nichts, mit --tage 5 archiviert
  r = brain(v, "aufgabe", "archivieren", "--alte");
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Keine erledigte Aufgabe älter als 30 Tage/);
  r = brain(v, "aufgabe", "archivieren", "--alte", "--tage", "5");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Archiviert: .*mittlere-muehle\.md/); assert.match(r.stdout, /1 erledigte Aufgabe\(n\) archiviert \(älter als 5 Tage\)/);
  assert.equal(existsSync(join(v, e2.pfad)), false);
  assert.deepEqual(A.liste(v).map((a) => a.titel), ["Offene Mühle"]);
  assert.equal(namen(v, "05_aufgaben/archiv").length, 2);
});

test("CLI: archivieren — Fehler sind verständlich (Exit 64/1), nichts wird verschoben", () => {
  const v = vault();
  const off = A.legeAn(v, { titel: "Noch offen" }, { jetzt: JETZT });
  for (const [args, code, re] of [[["aufgabe", "archivieren"], 64, /Nutzung/], [["aufgabe", "archivieren", "a", "b"], 64, /Nutzung/], [["aufgabe", "archivieren", "gibtsnicht"], 1, /gibt es nicht/],
    [["aufgabe", "archivieren", "noch-offen"], 64, /nur erledigte/i], [["aufgabe", "archivieren", "--alte", "--tage", "0"], 64, /Tage/], [["aufgabe", "archivieren", "--alte", "--tage", "viele"], 64, /Tage/],
    [["aufgabe", "archivieren", "--alte", "irgendwas"], 64, /Nutzung/], [["aufgabe", "archivieren", "noch-offen", "--tage", "3"], 64, /Nutzung/]]) {
    const r = brain(v, ...args);
    assert.equal(r.status, code, args.join(" ") + r.stdout + r.stderr);
    assert.match(r.stderr, re); assert.doesNotMatch(r.stderr, /at .*\.mjs/);
  }
  assert.ok(existsSync(join(v, off.pfad)));
  assert.equal(existsSync(join(v, "05_aufgaben", "archiv")), false);
});

test("CLI: archivieren nur in einem vertrauten Vault (Exit 5) — ohne Bestätigung bleibt alles liegen", () => {
  const v = vault();
  const e = erledigt(v, "Schon alt", 40);
  const env = { ...process.env, ...KEIN_KI, KORTEX_VAULT_VERTRAUT: "", BRAIN_APP_SUPPORT: mkdtempSync(join(tmpdir(), "support leer ")) };
  const lauf = (...a) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", v, ...a], { encoding: "utf8", env });
  for (const args of [["aufgabe", "archivieren", "schon-alt"], ["aufgabe", "archivieren", "--alte"]]) {
    const r = lauf(...args);
    assert.equal(r.status, 5, args.join(" ")); assert.match(r.stderr, /noch nicht als deiner bestätigt/);
  }
  assert.ok(existsSync(join(v, e.pfad)));
});
