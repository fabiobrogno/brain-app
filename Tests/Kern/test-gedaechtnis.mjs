// .tools/tests/test-gedaechtnis.mjs — gemeinsames Auto-Memory für mehrere Claude-Konten per 3-Wege-Abgleich (gedaechtnis.mjs).
// Alles mit FAKE-Konten in einem Temp-HOME — nie echte Konten (~/.claude*) oder ~/.claude-gedaechtnis. Geprüft: erster Lauf
// (gleich/verschieden/MEMORY-union), Änderung/Löschen in einem Konto → im anderen, beide ändern (sauberer Merge, Konflikt-Kopie),
// Änderung in der Wurzel (Traum) wird nicht zurückgedreht, Konto-Datei ändert sich während des Laufs, Symlink → echter Ordner,
// Trockenlauf ändert nichts, Idempotenz, Basis-Blobs/Manifeste, Sicherung, Git-Verlauf der Wurzel, Sperre, Temp-Projekte,
// Hook-Auslöser (transcript_path), Standard-Konten, CLI, Tageslauf-Schritt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, realpathSync, existsSync, symlinkSync, utimesSync, mkdtempSync, rmSync, unlinkSync, chmodSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tempOrdner, tempVault, hook, KIT } from "./verlauf-fixture.mjs";
import {
  gleicheAb, statusGedaechtnis, gedaechtnisPfade, gedaechtnisSchritt, istTempProjekt, bereinigeIndex, konfliktName, expandiere, leseBaum, leseArgs,
  blobHash, projektAusTranskript, starteAbgleichFuerSitzung, STANDARD_KONTEN, STANDARD_WURZEL,
  leseKonfliktName, istKonfliktKopie, konfliktZeile, leseKonfliktEintraege, streicheKonfliktEintraege, istAufgeloesteKopie, projektKlasse, istEchterProjektSchluessel,
} from "../gedaechtnis.mjs";
import * as G from "../gedaechtnis.mjs";                                    // für neu hinzukommende Exporte (bereinigeIndexBefund)
import { SCHEMA, STANDARD, leseAutomatik, schreibeAutomatik } from "../einstellungen.mjs";

const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const P1 = "-work-projekt-a", P2 = "-work-projekt-b";

// Fake-Welt: Temp-HOME mit zwei Konten (Ordnernamen wie die echten) und einer noch nicht angelegten Wurzel
function welt() {
  const home = tempOrdner("Heim Äö");
  const k1 = join(home, ".claude"), k2 = join(home, ".claude-zwei"), wurzel = join(home, ".claude-gedaechtnis");
  for (const k of [k1, k2]) mkdirSync(join(k, "projects"), { recursive: true });
  return { home, k1, k2, wurzel, konten: [k1, k2], sicherungen: join(home, ".claude-gedaechtnis-sicherungen") };
}
const memory = (k, p) => join(k, "projects", p, "memory");
const schreibe = (k, p, rel, inhalt) => { const f = join(memory(k, p), ...rel.split("/")); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, inhalt); return f; };
const schreibeW = (w, p, rel, inhalt) => { const f = join(w.wurzel, p, ...rel.split("/")); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, inhalt); return f; };
const loesche = (k, p, rel) => unlinkSync(join(memory(k, p), ...rel.split("/")));
const lies = (pfad) => readFileSync(pfad, "utf8");
const liesK = (k, p, rel) => lies(join(memory(k, p), ...rel.split("/")));
const liesW = (w, p, rel) => lies(join(w.wurzel, p, ...rel.split("/")));
const dateien = (dir) => (existsSync(dir) ? [...leseBaum(dir).dateien.keys()].sort() : []);
const istLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: OHNE_GIT }).stdout.trim();
const abgleich = (w, extra = {}) => gleicheAb({ wurzel: w.wurzel, konten: w.konten, anwenden: true, ...extra });
const trocken = (w, extra = {}) => gleicheAb({ wurzel: w.wurzel, konten: w.konten, ...extra });
const manifest = (w, konto, p) => JSON.parse(lies(join(w.wurzel, ".abgleich", konto, `${p}.json`)));
// Abbild eines ganzen Baums (Pfade, Art, Inhalt; Symlinks mit Ziel) — für „Trockenlauf ändert nichts“
function abbild(dir) {
  const aus = [];
  const geh = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name), rel = relative(dir, p);
      if (e.isSymbolicLink()) aus.push(`L ${rel} -> ${readlinkSync(p)}`);
      else if (e.isDirectory()) { aus.push(`D ${rel}`); geh(p); }
      else aus.push(`F ${rel} ${createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12)}`);
    }
  };
  geh(dir);
  return aus.join("\n");
}
const warteBis = async (bedingung, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (bedingung()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return bedingung();
};
// Einmal in Sync bringen: Konto 1 und 2 mit denselben Dateien, dann abgleichen (Ausgangslage für die Folge-Tests)
function eingespielt(dateienMap = { "a.md": "A\n", "b.md": "B\n" }, p = P1) {
  const w = welt();
  for (const [rel, text] of Object.entries(dateienMap)) schreibe(w.k1, p, rel, text);
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  for (const rel of Object.keys(dateienMap)) assert.equal(liesK(w.k2, p, rel), dateienMap[rel], "Ausgangslage: Konto 2 hat die Datei");
  return w;
}

// ------------------------------------------------------------------------------------------ erster Lauf
test("erster Lauf: gleich/verschieden/MEMORY-union; beide Konten behalten ECHTE Ordner mit demselben Stand", () => {
  const w = welt();
  schreibe(w.k1, P1, "MEMORY.md", "## Erinnerungen\n- [A](a.md) — Eins\n");
  schreibe(w.k1, P1, "a.md", "A aus Konto 1\n");
  schreibe(w.k1, P1, "gleich.md", "identisch\n");
  schreibe(w.k1, P1, "unter/tief.md", "tief\n");
  schreibe(w.k1, P1, "verschieden.md", "V1\n");
  schreibe(w.k2, P1, "MEMORY.md", "## Erinnerungen\n- [B](b.md) — Zwei\n");
  schreibe(w.k2, P1, "b.md", "B aus Konto 2\n");
  schreibe(w.k2, P1, "gleich.md", "identisch\n");
  schreibe(w.k2, P1, "verschieden.md", "V2\n");
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const T = join(w.wurzel, P1);
  assert.deepEqual(dateien(T), ["MEMORY.md", "_konflikte.md", "a.md", "b.md", "gleich.md", "unter/tief.md", "verschieden.konflikt-claude-zwei.md", "verschieden.md"]);
  assert.equal(liesW(w, P1, "MEMORY.md"), "## Erinnerungen\n- [A](a.md) — Eins\n- [B](b.md) — Zwei\n", "MEMORY.md: union beider Seiten");
  assert.equal(liesW(w, P1, "verschieden.md"), "V1\n", "die Wurzel behält die Fassung des ersten Kontos");
  assert.equal(liesW(w, P1, "verschieden.konflikt-claude-zwei.md"), "V2\n");
  assert.match(liesW(w, P1, "_konflikte.md"), /claude-zwei: `verschieden\.md` weicht ab → Kopie `verschieden\.konflikt-claude-zwei\.md`/);
  for (const k of w.konten) {
    assert.ok(!istLink(memory(k, P1)) && lstatSync(memory(k, P1)).isDirectory(), `${k}: memory bleibt ein echter Ordner`);
    assert.deepEqual(dateien(memory(k, P1)), dateien(T), "beide Konten haben denselben Stand wie die Wurzel");
    assert.equal(liesK(k, P1, "MEMORY.md"), liesW(w, P1, "MEMORY.md"));
    assert.equal(liesK(k, P1, "verschieden.md"), "V1\n");
    assert.equal(liesK(k, P1, "unter/tief.md"), "tief\n");
  }
  assert.deepEqual(r.plan.projekte[0].konflikte, [{ datei: "verschieden.md", kopie: "verschieden.konflikt-claude-zwei.md", konto: "claude-zwei" }]);
  assert.equal(r.zaehler.konflikte, 1);
  // Temp-Dateien bleiben nicht liegen — weder im Projektordner noch in memory/ noch in der Wurzel
  for (const k of w.konten) assert.ok(!readdirSync(join(k, "projects", P1)).some((n) => n.startsWith(".gedaechtnis")), "keine Temp-Reste im Projektordner");
  assert.ok(!readdirSync(w.wurzel).some((n) => n.startsWith(".gedaechtnis")));
  // zweiter Lauf: nichts mehr zu tun (Konflikt-Kopie entsteht nicht noch einmal)
  assert.equal(abgleich(w).nichtsZuTun, true);
});

test("erster Lauf mit schon gefüllter Wurzel: ihre Fassung gilt, BEIDE Konten bekommen eine Konflikt-Kopie", () => {
  const w = welt();
  schreibeW(w, P1, "regel.md", "Wurzel\n");
  schreibe(w.k1, P1, "regel.md", "K1\n");
  schreibe(w.k2, P1, "regel.md", "K2\n");
  abgleich(w);
  assert.equal(liesW(w, P1, "regel.md"), "Wurzel\n");
  assert.equal(liesW(w, P1, "regel.konflikt-claude.md"), "K1\n");
  assert.equal(liesW(w, P1, "regel.konflikt-claude-zwei.md"), "K2\n");
  assert.equal(liesK(w.k1, P1, "regel.md"), "Wurzel\n");
  assert.equal(liesK(w.k2, P1, "regel.konflikt-claude.md"), "K1\n", "auch das andere Konto sieht die Kopie");
});

test("Manifeste und Basis-Blobs: je Konto/Projekt { datei: blob-sha }, die SHA ist die von git hash-object, der Inhalt liegt in der Objektdatenbank der Wurzel", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "Inhalt A\n");
  schreibe(w.k2, P1, "b.md", "Inhalt B\n");
  abgleich(w);
  for (const konto of ["claude", "claude-zwei"]) {
    const m = manifest(w, konto, P1);
    assert.deepEqual(Object.keys(m), ["a.md", "b.md"]);
    for (const [rel, sha] of Object.entries(m)) {
      const pfad = join(w.wurzel, P1, rel);
      assert.equal(sha, git(w.wurzel, "hash-object", pfad), `${konto}/${rel}: SHA wie git hash-object`);
      assert.equal(sha, blobHash(readFileSync(pfad)));
      assert.equal(git(w.wurzel, "cat-file", "blob", sha), lies(pfad).trim(), "Basisinhalt per git cat-file lesbar");
    }
  }
  // Basis bleibt auch lesbar, wenn die Wurzel die Datei später ändert (liegt im Verlauf)
  const alt = manifest(w, "claude", P1)["a.md"];
  schreibeW(w, P1, "a.md", "Neu aus dem Traum\n");
  abgleich(w);
  assert.equal(git(w.wurzel, "cat-file", "blob", alt), "Inhalt A");
  assert.notEqual(manifest(w, "claude", P1)["a.md"], alt, "Manifest zieht nach");
});

// ------------------------------------------------------------------------------------------ Änderungen und Löschen
test("Änderung nur in A → B bekommt sie (geänderte und neue Datei); A wird nicht angefasst; zweiter Lauf: nichts zu tun", () => {
  const w = eingespielt();
  schreibe(w.k1, P1, "a.md", "A, geändert\n");
  schreibe(w.k1, P1, "neu.md", "ganz neu\n");
  const vorherK1 = abbild(w.k1);
  const r = abgleich(w);
  assert.equal(r.ok, true);
  assert.equal(liesK(w.k2, P1, "a.md"), "A, geändert\n");
  assert.equal(liesK(w.k2, P1, "neu.md"), "ganz neu\n");
  assert.equal(liesW(w, P1, "a.md"), "A, geändert\n");
  assert.equal(abbild(w.k1), vorherK1, "Konto 1 unverändert");
  assert.deepEqual(r.plan.projekte[0].konten.map((k) => [k.konto, k.vonKonto.geaendert, k.vonKonto.neu, k.schreiben]), [["claude", 1, 1, 0], ["claude-zwei", 0, 0, 2]]);
  assert.equal(manifest(w, "claude-zwei", P1)["a.md"], blobHash(Buffer.from("A, geändert\n")));
  assert.equal(abgleich(w).nichtsZuTun, true);
});

test("Löschen in A → in B gelöscht (auch aus der Wurzel); leere Unterordner verschwinden; Löschen in B wirkt umgekehrt genauso", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n", "unter/tief.md": "tief\n" });
  loesche(w.k1, P1, "a.md");
  loesche(w.k1, P1, "unter/tief.md");
  const r = abgleich(w);
  assert.equal(r.ok, true);
  assert.ok(!existsSync(join(memory(w.k2, P1), "a.md")), "in Konto 2 gelöscht");
  assert.ok(!existsSync(join(memory(w.k2, P1), "unter")), "leerer Unterordner entfernt");
  assert.deepEqual(dateien(join(w.wurzel, P1)), ["b.md"]);
  assert.deepEqual(Object.keys(manifest(w, "claude-zwei", P1)), ["b.md"]);
  assert.equal(r.plan.projekte[0].konten[0].vonKonto.geloescht, 2);
  loesche(w.k2, P1, "b.md");
  abgleich(w);
  assert.deepEqual(dateien(memory(w.k1, P1)), []);
  assert.deepEqual(dateien(join(w.wurzel, P1)), []);
});

test("drei Konten: eine Änderung im dritten kommt in beiden anderen an", () => {
  const w = welt();
  const k3 = join(w.home, ".claude-drei");
  mkdirSync(join(k3, "projects"), { recursive: true });
  const konten = [w.k1, w.k2, k3];
  schreibe(w.k1, P1, "a.md", "A\n");
  assert.equal(abgleich({ ...w, konten }).ok, true);
  writeFileSync(join(memory(k3, P1), "a.md"), "A von Konto 3\n");
  abgleich({ ...w, konten });
  assert.equal(liesK(w.k1, P1, "a.md"), "A von Konto 3\n");
  assert.equal(liesK(w.k2, P1, "a.md"), "A von Konto 3\n");
});

// ------------------------------------------------------------------------------------------ beide ändern
test("beide ändern verschieden: sauber trennbar → git merge-file führt zusammen; gleiche Stelle → Wurzel behält Konto 1, Konto 2 wird <name>.konflikt-<konto>", () => {
  const basis = "eins\nzwei\ndrei\nvier\nfünf\nsechs\nsieben\n";
  const w = eingespielt({ "regel.md": basis, "same.md": "x\n", "daten.json": '{"k":0}\n' });
  schreibe(w.k1, P1, "regel.md", basis.replace("eins", "EINS"));
  schreibe(w.k2, P1, "regel.md", basis.replace("sieben", "SIEBEN"));
  schreibe(w.k1, P1, "same.md", "von eins\n");
  schreibe(w.k2, P1, "same.md", "von zwei\n");
  schreibe(w.k1, P1, "daten.json", '{"k":1}\n');
  schreibe(w.k2, P1, "daten.json", '{"k":2}\n');
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  for (const k of w.konten) assert.equal(liesK(k, P1, "regel.md"), "EINS\nzwei\ndrei\nvier\nfünf\nsechs\nSIEBEN\n", "sauberer 3-Wege-Merge in beiden Konten");
  assert.deepEqual(r.plan.projekte[0].merges, ["regel.md"]);
  assert.equal(liesW(w, P1, "same.md"), "von eins\n");
  assert.equal(liesW(w, P1, "same.konflikt-claude-zwei.md"), "von zwei\n");
  assert.equal(liesW(w, P1, "daten.konflikt-claude-zwei.json"), '{"k":2}\n', "Endung bleibt");
  assert.doesNotMatch(liesW(w, P1, "same.md"), /<<<<<<<|>>>>>>>/, "keine Konfliktmarken in der Wurzel");
  assert.equal(liesK(w.k2, P1, "same.md"), "von eins\n", "Konto 2 sieht die Wurzel-Fassung …");
  assert.equal(liesK(w.k2, P1, "same.konflikt-claude-zwei.md"), "von zwei\n", "… und seine eigene als Kopie");
  const liste = liesW(w, P1, "_konflikte.md");
  assert.match(liste, /`same\.md`/); assert.match(liste, /`daten\.json`/); assert.doesNotMatch(liste, /regel\.md/);
  assert.equal(statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten }).offeneKonflikte, 2);
  assert.equal(abgleich(w).nichtsZuTun, true, "Idempotent trotz Konflikt-Kopien");
});

test("MEMORY.md: beide fügen Zeilen hinzu → union, keine Doppelzeilen, keine Zeilen mit gleicher verlinkter Datei; bei gleicher Datei mit anderem Text bleibt die Wurzel, die andere Fassung wird als Konflikt-Kopie vermerkt", () => {
  const w = eingespielt({ "MEMORY.md": "## Erinnerungen\n- [A](a.md) — a\n\n## Projekte\n- [P](p.md) — p\n" });
  schreibe(w.k1, P1, "MEMORY.md", "## Erinnerungen\n- [A](a.md) — a\n- [K1](k1.md) — von Konto 1\n- [Gemeinsam](g.md) — Fassung Konto 1\n\n## Projekte\n- [P](p.md) — p\n");
  schreibe(w.k2, P1, "MEMORY.md", "## Erinnerungen\n- [A](a.md) — a\n- [K2](k2.md) — von Konto 2\n- [Gemeinsam](g.md) — Fassung Konto 2\n\n## Projekte\n- [P](p.md) — p\n- [Neu](neu.md) — neu in Konto 2\n");
  const r = abgleich(w);
  const text = liesW(w, P1, "MEMORY.md");
  const zeilen = text.split("\n");
  for (const d of ["a.md", "k1.md", "k2.md", "g.md", "p.md", "neu.md"]) assert.equal(zeilen.filter((z) => z.includes(`(${d})`)).length, 1, `${d} genau einmal in:\n${text}`);
  assert.equal(new Set(zeilen.filter((z) => z.trim())).size, zeilen.filter((z) => z.trim()).length, "keine exakten Doppelzeilen");
  assert.ok(text.includes("Fassung Konto 1") && !text.includes("Fassung Konto 2"), "bei gleicher verlinkter Datei bleibt die Zeile der Wurzel");
  assert.deepEqual(r.plan.projekte[0].konflikte, [{ datei: "MEMORY.md", kopie: "MEMORY.konflikt-claude-zwei.md", konto: "claude-zwei" }], "… aber nie still verworfen: die Fassung von Konto 2 liegt als Kopie daneben");
  assert.match(liesW(w, P1, "MEMORY.konflikt-claude-zwei.md"), /Fassung Konto 2/);
  assert.match(liesW(w, P1, "_konflikte.md"), /claude-zwei: `MEMORY\.md` weicht ab → Kopie `MEMORY\.konflikt-claude-zwei\.md`/);
  assert.deepEqual(r.plan.projekte[0].merges, ["MEMORY.md"]);
  assert.equal(liesK(w.k1, P1, "MEMORY.md"), text); assert.equal(liesK(w.k2, P1, "MEMORY.md"), text);
  assert.equal(abgleich(w).nichtsZuTun, true);
});

test("gelöscht auf einer Seite, geändert auf der anderen → die Änderung gewinnt (beide Richtungen)", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n" });
  loesche(w.k1, P1, "a.md"); schreibe(w.k2, P1, "a.md", "A, geändert\n");       // K1 löscht, K2 ändert
  schreibe(w.k1, P1, "b.md", "B, geändert\n"); loesche(w.k2, P1, "b.md");       // K1 ändert, K2 löscht
  abgleich(w);
  for (const k of w.konten) { assert.equal(liesK(k, P1, "a.md"), "A, geändert\n"); assert.equal(liesK(k, P1, "b.md"), "B, geändert\n"); }
  assert.deepEqual(dateien(join(w.wurzel, P1)), ["a.md", "b.md"]);
});

// ------------------------------------------------------------------------------------------ Änderung in der Wurzel (Traum)
test("Wurzel-Änderung (z. B. vom Traum): beide Konten bekommen sie und sie wird NICHT zurückgedreht; auch neue und gelöschte Dateien", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n" });
  schreibeW(w, P1, "a.md", "A vom Traum\n");
  schreibeW(w, P1, "traum.md", "neu vom Traum\n");
  unlinkSync(join(w.wurzel, P1, "b.md"));
  const r = abgleich(w);
  assert.equal(r.ok, true);
  for (const k of w.konten) {
    assert.equal(liesK(k, P1, "a.md"), "A vom Traum\n");
    assert.equal(liesK(k, P1, "traum.md"), "neu vom Traum\n");
    assert.ok(!existsSync(join(memory(k, P1), "b.md")), "vom Traum Gelöschtes verschwindet auch in den Konten");
  }
  assert.equal(liesW(w, P1, "a.md"), "A vom Traum\n", "nicht zurückgedreht");
  assert.equal(abgleich(w).nichtsZuTun, true);
  assert.equal(liesW(w, P1, "a.md"), "A vom Traum\n");
  assert.equal(r.plan.projekte[0].wurzel.geaendert, 0, "Die Wurzel selbst ändert der Lauf hier nicht (nur ihr Stand wird verteilt)");
});

test("Wurzel und Konto ändern dieselbe Datei: getrennte Stellen → Merge; gleiche Stelle → die Wurzel (Traum) behält ihre Fassung, die des Kontos wird Kopie", () => {
  const basis = "1\n2\n3\n4\n5\n6\n7\n";
  const w = eingespielt({ "m.md": basis, "k.md": "alt\n" });
  schreibeW(w, P1, "m.md", basis.replace("1", "EINS"));
  schreibe(w.k2, P1, "m.md", basis.replace("7", "SIEBEN"));
  schreibeW(w, P1, "k.md", "Traum\n");
  schreibe(w.k2, P1, "k.md", "Konto 2\n");
  abgleich(w);
  for (const k of w.konten) assert.equal(liesK(k, P1, "m.md"), "EINS\n2\n3\n4\n5\n6\nSIEBEN\n");
  assert.equal(liesW(w, P1, "k.md"), "Traum\n");
  assert.equal(liesW(w, P1, "k.konflikt-claude-zwei.md"), "Konto 2\n");
});

// ------------------------------------------------------------------------------------------ Konto-Datei ändert sich während des Laufs
test("Konto-Datei ändert sich während des Laufs → wird nicht überschrieben und nicht gelöscht; der nächste Abgleich holt sie, nichts geht verloren", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n" });
  schreibe(w.k1, P1, "a.md", "A neu aus Konto 1\n");
  loesche(w.k1, P1, "b.md");
  const alt = manifest(w, "claude-zwei", P1);
  const r = abgleich(w, { haken: { vorVerteilen: ({ konto, memory: m }) => {
    if (konto !== "claude-zwei") return;
    writeFileSync(join(m, "a.md"), "A, während des Laufs in Konto 2 geändert\n");
    writeFileSync(join(m, "b.md"), "B, während des Laufs in Konto 2 geändert\n");
  } } });
  assert.equal(liesK(w.k2, P1, "a.md"), "A, während des Laufs in Konto 2 geändert\n", "nicht überschrieben");
  assert.equal(liesK(w.k2, P1, "b.md"), "B, während des Laufs in Konto 2 geändert\n", "nicht gelöscht");
  assert.ok(r.warnungen.some((x) => /claude-zwei.*2 Datei\(en\) während des Laufs verändert/.test(x)), r.warnungen.join("|"));
  assert.deepEqual(manifest(w, "claude-zwei", P1), alt, "Manifest von Konto 2 behält den gelesenen Stand dieser Dateien");
  // nächster Lauf: a.md — beide haben geändert (an derselben Stelle) → Wurzel (Konto 1) gilt, Konto 2 als Kopie; b.md — Änderung gewinnt gegen Löschen
  const r2 = abgleich(w);
  assert.equal(r2.ok, true);
  assert.equal(liesW(w, P1, "a.md"), "A neu aus Konto 1\n");
  assert.equal(liesW(w, P1, "a.konflikt-claude-zwei.md"), "A, während des Laufs in Konto 2 geändert\n");
  assert.equal(liesW(w, P1, "b.md"), "B, während des Laufs in Konto 2 geändert\n");
  assert.equal(liesK(w.k1, P1, "b.md"), "B, während des Laufs in Konto 2 geändert\n", "die Änderung kommt auch in Konto 1 an");
  assert.equal(abgleich(w).nichtsZuTun, true);
});

test("übersprungene Datei: ihr gelesener Stand wird als Basis-Blob gesichert und beim nächsten 3-Wege-Merge gebraucht (nichts geht verloren)", () => {
  const basis = "1\n2\n3\n4\n5\n6\n7\n";
  const w = eingespielt({ "m.md": basis });
  const k2Stand = basis.replace("7", "SIEBEN");                           // Änderung von Konto 2 (nur in Konto 2 gelesen, nie in der Wurzel als Ganzes)
  schreibe(w.k1, P1, "m.md", basis.replace("1", "EINS"));
  schreibe(w.k2, P1, "m.md", k2Stand);
  const zwischen = k2Stand.replace("4", "VIER");                          // Konto 2 ändert die Datei noch einmal, während der Lauf verteilt
  abgleich(w, { haken: { vorVerteilen: ({ konto, memory: m }) => { if (konto === "claude-zwei") writeFileSync(join(m, "m.md"), zwischen); } } });
  assert.equal(liesK(w.k2, P1, "m.md"), zwischen, "nicht überschrieben");
  assert.equal(liesW(w, P1, "m.md"), "EINS\n2\n3\n4\n5\n6\nSIEBEN\n", "Wurzel: beide Änderungen zusammengeführt");
  const sha = manifest(w, "claude-zwei", P1)["m.md"];
  assert.equal(sha, blobHash(Buffer.from(k2Stand)), "Basis = der gelesene Stand von Konto 2");
  assert.equal(git(w.wurzel, "cat-file", "blob", sha), k2Stand.trim(), "Basis-Blob liegt in der Objektdatenbank");
  const r = abgleich(w);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.projekte[0].konflikte, [], "Merge statt Konflikt-Kopie");
  for (const k of w.konten) assert.equal(liesK(k, P1, "m.md"), "EINS\n2\n3\nVIER\n5\n6\nSIEBEN\n", "alle drei Änderungen sind da");
});

test("Wurzel-Datei ändert sich zwischen Rechnen und Schreiben → Projekt wird nicht angewendet (nichts halb verteilt), der nächste Lauf holt es nach", () => {
  const w = eingespielt({ "a.md": "A\n" });
  schreibe(w.k1, P1, "a.md", "A aus Konto 1\n");
  const vorherK2 = abbild(w.k2);
  const manifestVorher = lies(join(w.wurzel, ".abgleich", "claude-zwei", `${P1}.json`));
  const r = abgleich(w, { haken: { nachPlan: () => schreibeW(w, P1, "a.md", "A vom Traum, mitten im Lauf\n") } });
  assert.equal(r.ok, false);
  assert.match(r.fehler.join("|"), /Wurzel-Datei a\.md hat sich während des Laufs geändert/);
  assert.equal(abbild(w.k2), vorherK2);
  assert.equal(lies(join(w.wurzel, ".abgleich", "claude-zwei", `${P1}.json`)), manifestVorher);
  const r2 = abgleich(w);
  assert.equal(r2.ok, true);
  assert.equal(liesW(w, P1, "a.md"), "A vom Traum, mitten im Lauf\n", "die Wurzel behält die Fassung des Traums …");
  assert.equal(liesW(w, P1, "a.konflikt-claude.md"), "A aus Konto 1\n", "… die Änderung des Kontos bleibt als Kopie erhalten");
  assert.equal(liesK(w.k2, P1, "a.md"), "A vom Traum, mitten im Lauf\n");
  assert.equal(abgleich(w).nichtsZuTun, true);
});

// ------------------------------------------------------------------------------------------ Symlinks aus der früheren Version
test("memory-Symlink der früheren Version → wird zu einem echten Ordner mit dem Wurzelstand; Verläufe im Projektordner bleiben", () => {
  const w = welt();
  const T = join(w.wurzel, P1);
  mkdirSync(T, { recursive: true });
  writeFileSync(join(T, "MEMORY.md"), "## Erinnerungen\n- [A](a.md) — a\n");
  writeFileSync(join(T, "a.md"), "A\n");
  mkdirSync(join(w.k1, "projects", P1), { recursive: true });
  symlinkSync(T, memory(w.k1, P1));
  writeFileSync(join(w.k1, "projects", P1, "verlauf.jsonl"), "{}\n");
  schreibe(w.k2, P1, "a.md", "A\n");
  schreibe(w.k2, P1, "nur-in-2.md", "zwei\n");
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.ok(!istLink(memory(w.k1, P1)) && lstatSync(memory(w.k1, P1)).isDirectory(), "echter Ordner");
  assert.deepEqual(dateien(memory(w.k1, P1)), ["MEMORY.md", "a.md", "nur-in-2.md"]);
  assert.equal(liesK(w.k1, P1, "nur-in-2.md"), "zwei\n");
  assert.equal(lies(join(w.k1, "projects", P1, "verlauf.jsonl")), "{}\n");
  assert.deepEqual(readdirSync(join(w.k1, "projects", P1)).sort(), ["memory", "verlauf.jsonl"], "kein memory.alt-…, keine Reste");
  assert.equal(r.plan.projekte[0].konten[0].aktion, "symlink-ersetzen");
  // Schreiben im Konto wirkt jetzt NICHT mehr direkt in die Wurzel (echter Ordner) — erst der nächste Abgleich bringt es hin
  writeFileSync(join(memory(w.k1, P1), "spaeter.md"), "später\n");
  assert.ok(!existsSync(join(T, "spaeter.md")));
  abgleich(w);
  assert.equal(liesW(w, P1, "spaeter.md"), "später\n");
  assert.equal(liesK(w.k2, P1, "spaeter.md"), "später\n");
});

test("Symlink mit fehlendem Ziel (alte Wurzel weg) wird ebenfalls zum echten Ordner; fremder Symlink und memory als Datei bleiben unangetastet", () => {
  const w = welt();
  mkdirSync(join(w.k1, "projects", P1), { recursive: true });
  symlinkSync(join(w.wurzel, P1), memory(w.k1, P1));                      // zeigt ins Leere (Wurzel gibt es nicht)
  schreibe(w.k2, P1, "a.md", "A\n");
  const anders = join(w.home, "anderes-memory");
  mkdirSync(anders);
  mkdirSync(join(w.k1, "projects", P2), { recursive: true });
  symlinkSync(anders, memory(w.k1, P2));                                  // fremd
  mkdirSync(join(w.k2, "projects", P2), { recursive: true });
  schreibe(w.k2, P2, "b.md", "B\n");
  const r = abgleich(w);
  assert.ok(!istLink(memory(w.k1, P1)));
  assert.equal(liesK(w.k1, P1, "a.md"), "A\n");
  assert.equal(readlinkSync(memory(w.k1, P2)), anders, "fremder Symlink bleibt");
  assert.deepEqual(readdirSync(anders), [], "und bekommt nichts hineingeschrieben");
  assert.ok(r.warnungen.some((x) => /claude\/-work-projekt-b: memory ist ein Symlink auf etwas anderes/.test(x)), r.warnungen.join("|"));
  assert.equal(liesW(w, P2, "b.md"), "B\n", "das andere Konto geht trotzdem in die Wurzel");
});

// ------------------------------------------------------------------------------------------ fehlendes Projekt / fehlender Ordner
test("fehlt das Projekt (oder nur memory) im anderen Konto, wird es angelegt — beide Richtungen; Verläufe bleiben unangetastet", () => {
  const w = welt();
  schreibe(w.k1, P1, "nur-in-1.md", "eins\n");
  schreibe(w.k2, P2, "nur-in-2.md", "zwei\n");
  mkdirSync(join(w.k2, "projects", P1), { recursive: true });
  writeFileSync(join(w.k2, "projects", P1, "verlauf.jsonl"), "{}\n");       // Projekt-Ordner da, memory fehlt
  const r = abgleich(w);
  assert.ok(r.ok, JSON.stringify(r.fehler));
  assert.ok(!istLink(memory(w.k2, P1)) && !istLink(memory(w.k1, P2)));
  assert.equal(liesK(w.k2, P1, "nur-in-1.md"), "eins\n");
  assert.equal(liesK(w.k1, P2, "nur-in-2.md"), "zwei\n");
  assert.equal(lies(join(w.k2, "projects", P1, "verlauf.jsonl")), "{}\n");
});

test("memory-Ordner fehlt, obwohl das Konto schon abgeglichen war → wird wiederhergestellt, NICHT als „alles gelöscht“ in die Wurzel und ins andere Konto getragen", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n" });
  rmSync(memory(w.k2, P1), { recursive: true });
  const r = abgleich(w);
  assert.equal(r.ok, true);
  assert.ok(r.warnungen.some((x) => /claude-zwei\/.*memory fehlt.*wiederhergestellt/.test(x)));
  assert.deepEqual(dateien(memory(w.k2, P1)), ["a.md", "b.md"]);
  assert.deepEqual(dateien(memory(w.k1, P1)), ["a.md", "b.md"]);
  assert.deepEqual(dateien(join(w.wurzel, P1)), ["a.md", "b.md"]);
  // ein leerer (vorhandener) Ordner dagegen ist eine bewusste Löschung aller Dateien
  for (const rel of ["a.md", "b.md"]) loesche(w.k2, P1, rel);
  abgleich(w);
  assert.deepEqual(dateien(memory(w.k1, P1)), []);
});

test("Reste der früheren Version (memory.alt-…) werden nicht angefasst, es gibt einen Hinweis; kaputtes Manifest gilt als nicht vorhanden (nur Konflikt-Kopien, keine Löschungen)", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n" });
  const alt = join(w.k1, "projects", P1, "memory.alt-20260101-000000");
  mkdirSync(alt);
  writeFileSync(join(alt, "rest.md"), "Rest\n");
  writeFileSync(join(w.wurzel, ".abgleich", "claude-zwei", `${P1}.json`), "{kaputt");
  loesche(w.k2, P1, "b.md");                                              // ohne Manifest ist das KEINE Löschung
  schreibe(w.k2, P1, "a.md", "A anders\n");
  const r = abgleich(w);
  assert.ok(existsSync(join(alt, "rest.md")));
  assert.ok(r.warnungen.some((x) => /memory\.alt-20260101-000000.*früheren Symlink-Version/.test(x)));
  assert.ok(r.warnungen.some((x) => /Manifest unlesbar/.test(x)));
  assert.equal(liesW(w, P1, "b.md"), "B\n", "nicht gelöscht");
  assert.equal(liesK(w.k2, P1, "b.md"), "B\n", "und im Konto zurückgekommen");
  assert.equal(liesW(w, P1, "a.konflikt-claude-zwei.md"), "A anders\n");
  assert.deepEqual(Object.keys(manifest(w, "claude-zwei", P1)).sort(), ["_konflikte.md", "a.konflikt-claude-zwei.md", "a.md", "b.md"], "neues Manifest nach dem Lauf");
});

test("Basis-Blob fehlt in der Objektdatenbank → keine Fehlzusammenführung: Konflikt-Kopie (MEMORY.md: union)", () => {
  const w = eingespielt({ "a.md": "1\n2\n3\n4\n5\n6\n7\n", "MEMORY.md": "## E\n- [A](a.md)\n" });
  const falsch = "1".repeat(40);
  const mp = join(w.wurzel, ".abgleich", "claude-zwei", `${P1}.json`);
  const m = JSON.parse(lies(mp)); m["a.md"] = falsch; m["MEMORY.md"] = falsch;
  writeFileSync(mp, JSON.stringify(m));
  schreibe(w.k1, P1, "a.md", "EINS\n2\n3\n4\n5\n6\n7\n");
  schreibe(w.k2, P1, "a.md", "1\n2\n3\n4\n5\n6\nSIEBEN\n");
  schreibe(w.k1, P1, "MEMORY.md", "## E\n- [A](a.md)\n- [X](x.md)\n");
  schreibe(w.k2, P1, "MEMORY.md", "## E\n- [A](a.md)\n- [Y](y.md)\n");
  abgleich(w);
  assert.equal(liesW(w, P1, "a.md"), "EINS\n2\n3\n4\n5\n6\n7\n");
  assert.equal(liesW(w, P1, "a.konflikt-claude-zwei.md"), "1\n2\n3\n4\n5\n6\nSIEBEN\n");
  assert.equal(liesW(w, P1, "MEMORY.md"), "## E\n- [A](a.md)\n- [X](x.md)\n- [Y](y.md)\n");
});

// ------------------------------------------------------------------------------------------ Trockenlauf, Idempotenz
test("Trockenlauf (Standard) ändert nichts — weder Konten, noch Wurzel, Sicherung, Sperre oder Git — und liefert den Plan", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  schreibe(w.k2, P1, "a.md", "andere\n");
  schreibe(w.k1, P1, "MEMORY.md", "## Erinnerungen\n- [A](a.md)\n");
  schreibe(w.k2, P1, "MEMORY.md", "## Erinnerungen\n- [B](b.md)\n");
  const vorher = abbild(w.home);
  const r = trocken(w);
  assert.equal(r.anwenden, false);
  assert.equal(r.nichtsZuTun, false);
  assert.match(r.zeile, /^Gedächtnis \(Trockenlauf\): 1 Projekt\(e\) abzugleichen/);
  assert.equal(r.plan.projekte[0].konflikte.length, 1);
  assert.deepEqual(r.plan.projekte[0].merges, ["MEMORY.md"]);
  assert.equal(abbild(w.home), vorher, "Dateibaum unverändert");
  assert.ok(!existsSync(w.wurzel) && !existsSync(w.sicherungen) && !existsSync(`${w.wurzel}.lock`));
  // auch bei vorhandener Wurzel, Manifesten, Symlink und Änderungen in beiden Konten und der Wurzel
  abgleich(w);
  schreibe(w.k1, P2, "x.md", "x\n");
  schreibe(w.k1, P1, "a.md", "A, geändert\n");
  schreibeW(w, P1, "traum.md", "t\n");
  const v2 = abbild(w.home);
  const t2 = trocken(w);
  assert.equal(t2.nichtsZuTun, false);
  assert.equal(abbild(w.home), v2);
  assert.ok(t2.plan.projekte.every((p) => p.konten.every((k) => typeof k.schreiben === "number")), "Plan ist JSON-fähig (nur Zahlen/Namen)");
  JSON.stringify(t2);
});

test("Idempotenz: der zweite Lauf meldet „nichts zu tun“ und ändert nichts (keine Sicherung, kein Commit, keine Sperre, keine neuen Dateien)", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  schreibe(w.k2, P1, "b.md", "B\n");
  schreibe(w.k2, P2, "c.md", "C\n");
  const erst = abgleich(w);
  assert.equal(erst.ok, true);
  const commits = git(w.wurzel, "rev-list", "--count", "HEAD");
  const sicherungen = readdirSync(w.sicherungen).length;
  const vorher = abbild(w.home);
  const zweit = abgleich(w);
  assert.equal(zweit.nichtsZuTun, true);
  assert.match(zweit.zeile, /^Gedächtnis: nichts zu tun \(2 Projekt\(e\) abgeglichen\)$/);
  assert.equal(zweit.sicherung, null);
  assert.equal(zweit.commit, null);
  assert.equal(abbild(w.home), vorher);
  assert.equal(git(w.wurzel, "rev-list", "--count", "HEAD"), commits);
  assert.equal(readdirSync(w.sicherungen).length, sicherungen);
  assert.equal(trocken(w).nichtsZuTun, true);
});

// ------------------------------------------------------------------------------------------ Sicherung und Git
test("Sicherung: <wurzel>-sicherungen/<zeit>.tgz mit den echten memory-Ordnern und der alten Wurzel — vor dem ersten Schreiben; ohne Dateiänderung keine", () => {
  const w = welt();
  mkdirSync(join(w.wurzel, P1), { recursive: true });
  writeFileSync(join(w.wurzel, P1, "schon.md"), "schon in der Wurzel\n");
  schreibe(w.k1, P1, "a.md", "A von Konto 1\n");
  schreibe(w.k2, P1, "a.md", "A von Konto 2\n");
  const r = abgleich(w, { jetzt: Date.parse("2026-10-22T08:15:30") });
  assert.equal(r.sicherung, join(w.sicherungen, "20261022-081530.tgz"));
  assert.ok(existsSync(r.sicherung));
  const frisch = mkdtempSync(join(tmpdir(), "g-entpackt-"));
  const t = spawnSync("tar", ["-xzf", r.sicherung, "-C", frisch], { encoding: "utf8" });
  assert.equal(t.status, 0, t.stderr);
  assert.equal(lies(join(frisch, "konten", "claude", P1, "memory", "a.md")), "A von Konto 1\n");
  assert.equal(lies(join(frisch, "konten", "claude-zwei", P1, "memory", "a.md")), "A von Konto 2\n");
  assert.equal(lies(join(frisch, "wurzel", P1, "schon.md")), "schon in der Wurzel\n");
  assert.ok(!existsSync(join(frisch, "wurzel", P1, "a.md")), "Stand VOR dem Schreiben");
  rmSync(frisch, { recursive: true, force: true });
  // identische Konten, nur die Manifeste fehlen → es wird nichts überschrieben, also keine Sicherung
  const v = welt();
  schreibe(v.k1, P1, "a.md", "gleich\n"); schreibe(v.k2, P1, "a.md", "gleich\n");
  mkdirSync(join(v.wurzel, P1), { recursive: true }); writeFileSync(join(v.wurzel, P1, "a.md"), "gleich\n");
  const r2 = abgleich(v);
  assert.equal(r2.ok, true);
  assert.equal(r2.sicherung, null);
  assert.ok(existsSync(join(v.wurzel, ".abgleich", "claude", `${P1}.json`)), "Manifeste entstehen trotzdem");
  assert.equal(abgleich(v).nichtsZuTun, true);
});

test("scheitert die Sicherung, wird nichts geändert", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  writeFileSync(w.sicherungen, "ich bin eine Datei, kein Ordner");        // Sicherungsordner nicht anlegbar
  const vorher = abbild(w.k1);
  assert.throws(() => abgleich(w), /Sicherung fehlgeschlagen .*nichts geändert/);
  assert.equal(abbild(w.k1), vorher);
  assert.ok(!existsSync(w.wurzel), "Wurzel nicht angelegt");
  assert.ok(!existsSync(`${w.wurzel}.lock`), "Sperre wieder frei");
});

test("Die Wurzel ist ein lokales Git-Repo ohne Remote; jeder Lauf mit Änderungen endet mit einem Commit (Zähler in der Nachricht), ohne Änderung keiner", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  const r = abgleich(w);
  assert.match(r.commit, /^[0-9a-f]{7,}$/);
  assert.ok(existsSync(join(w.wurzel, ".git")));
  assert.equal(git(w.wurzel, "remote"), "", "kein Remote");
  assert.equal(git(w.wurzel, "rev-list", "--count", "HEAD"), "1");
  assert.match(git(w.wurzel, "log", "-1", "--format=%s"), /^gedaechtnis: abgleichen — 1 Projekt\(e\), 1 Datei\(en\) in der Wurzel, 1 in Konten verteilt/);
  assert.equal(git(w.wurzel, "status", "--porcelain"), "", "alles committet");
  assert.match(git(w.wurzel, "show", "--stat", "--format=", "HEAD"), new RegExp(`${P1}/a\\.md`));
  assert.match(git(w.wurzel, "ls-files"), new RegExp(`\\.abgleich/claude/${P1}\\.json`), "Manifeste liegen im selben Verlauf");
  schreibe(w.k2, P2, "b.md", "B\n");
  assert.ok(abgleich(w).commit);
  assert.equal(git(w.wurzel, "rev-list", "--count", "HEAD"), "2");
  assert.equal(abgleich(w).commit, null);
  assert.equal(git(w.wurzel, "rev-list", "--count", "HEAD"), "2", "kein Commit ohne Änderung");
  // Änderung in einem Konto: der Verlauf zeigt den alten Stand
  schreibe(w.k1, P1, "a.md", "A2\n");
  abgleich(w);
  assert.equal(git(w.wurzel, "show", `HEAD~1:${P1}/a.md`), "A");
});

test("ein Konto allein: der Abgleich führt nur den Wurzel-Verlauf (Wurzel + Manifest + Commit), das Konto bleibt unverändert", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  const vorher = abbild(w.k1);
  const r = abgleich({ ...w, konten: [w.k1] });
  assert.equal(r.ok, true);
  assert.equal(abbild(w.k1), vorher);
  assert.equal(liesW(w, P1, "a.md"), "A\n");
  schreibe(w.k1, P1, "a.md", "A2\n");
  abgleich({ ...w, konten: [w.k1] });
  assert.equal(git(w.wurzel, "rev-list", "--count", "HEAD"), "2");
  assert.equal(abbild(w.k1).includes("A2"), false);
});

test("Konto mit Git (session-hintergrund.mjs: git add <memory>): atomare Renames und Löschungen erscheinen als normale Änderungen, keine Temp-Dateien", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n", "weg.md": "weg\n" });
  const g = (...a) => spawnSync("git", ["-C", w.k1, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8", env: OHNE_GIT });
  g("init", "-q"); g("add", "."); g("commit", "-q", "-m", "stand");
  schreibe(w.k2, P1, "a.md", "A, geändert in Konto 2\n");
  loesche(w.k2, P1, "weg.md");
  schreibe(w.k2, P1, "neu.md", "neu\n");
  assert.equal(abgleich(w).ok, true);
  // genau die Befehle des Memory-Syncs: add <memDir>, dann diff --cached
  assert.equal(g("add", memory(w.k1, P1)).status, 0);
  const stand = g("diff", "--cached", "--name-status").stdout.trim().split("\n").map((z) => z.split("\t").join(" ")).sort();
  assert.deepEqual(stand, [`A projects/${P1}/memory/neu.md`, `D projects/${P1}/memory/weg.md`, `M projects/${P1}/memory/a.md`].sort());
  assert.equal(g("status", "--porcelain", "--untracked-files=all").stdout.split("\n").filter((z) => z.startsWith("??")).length, 0, "nichts Unversioniertes (keine Temp-Reste)");
});

test("Sperre: ein laufender Lauf blockiert einen zweiten; eine alte Sperre (> 15 min) nicht", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  writeFileSync(`${w.wurzel}.lock`, "999999 jetzt\n");
  assert.throws(() => abgleich(w), /anderen Lauf/);
  assert.ok(!existsSync(w.wurzel), "nichts geschrieben");
  const alt = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(`${w.wurzel}.lock`, alt, alt);
  assert.equal(abgleich(w).ok, true);
  assert.ok(!existsSync(`${w.wurzel}.lock`), "Sperre nach dem Lauf weg");
  // mit warteMs wartet der Lauf auf eine frische Sperre, die ein anderer Prozess gleich freigibt (so laufen die Hook-Läufe)
  schreibe(w.k1, P2, "b.md", "B\n");
  writeFileSync(`${w.wurzel}.lock`, "999999 jetzt\n");
  spawn(process.execPath, ["-e", `setTimeout(() => require("node:fs").unlinkSync(${JSON.stringify(`${w.wurzel}.lock`)}), 500)`], { stdio: "ignore", detached: true }).unref();
  const t0 = Date.now();
  const r = abgleich(w, { warteMs: 5000 });
  assert.equal(r.ok, true);
  assert.ok(Date.now() - t0 >= 250, "hat gewartet");
  assert.ok(existsSync(join(memory(w.k2, P2), "b.md")));
});

// ------------------------------------------------------------------------------------------ Überspringen
test("Temp-/Scratchpad-Projekte werden übersprungen (-private-…, -tmp…, -var-folders-…, …scratchpad…, Windows-Temp, Temp-Ordner des Systems)", () => {
  for (const p of ["-private-tmp-claude-502--work-sitzung", "-private-var-x", "-tmp-foo", "-tmpfoo", "-var-folders-ab-cdef-T-x", "-work-sache-scratchpad", "C--Nutzer-AppData-Local-Temp-x"]) {
    assert.equal(istTempProjekt(p), true, p);
  }
  for (const p of ["-work-projekt-a", "-work-private-notizen", "-work-tmp-sache", "-home-anna-brain"]) assert.equal(istTempProjekt(p), false, p);
  assert.equal(istTempProjekt("-meine-ablage-t-x", { temp: ["/meine/ablage/t"] }), true, "Schlüssel des übergebenen Temp-Ordners");
  assert.equal(istTempProjekt("-meine-ablage-tx", { temp: ["/meine/ablage/t"] }), false);
  const w = welt();
  const temp = ["-private-tmp-claude-502--work-x", "-tmp-y", "-var-folders-aa-bb-T-z", "-work-q-scratchpad"];
  for (const t of temp) schreibe(w.k1, t, "a.md", "A\n");
  schreibe(w.k1, P1, "ok.md", "ok\n");
  const r = abgleich(w);
  assert.deepEqual(readdirSync(w.wurzel).filter((n) => !n.startsWith(".")), [P1], "nur das normale Projekt in der Wurzel");
  for (const t of temp) assert.ok(existsSync(join(memory(w.k1, t), "a.md")), `${t} bleibt unberührt`);
  assert.deepEqual(r.plan.uebersprungen.map((u) => u.projekt).sort(), [...temp].sort());
  assert.ok(!existsSync(join(w.k2, "projects", temp[0])), "im anderen Konto nichts angelegt");
  assert.throws(() => abgleich(w, { projekt: "kein schlüssel/" }), /kein Projekt-Schlüssel/);
});

test("Konten: fehlendes Konto und Ordner ohne Claude-Merkmale werden nicht angelegt/angefasst; Symlinks in memory werden nicht übernommen", () => {
  const w = welt();
  const fehlt = join(w.home, ".claude-gibt-es-nicht"), fremd = join(w.home, "irgendein-ordner");
  mkdirSync(fremd);
  schreibe(w.k1, P1, "a.md", "A\n");
  symlinkSync(join(w.home, "anderswo"), join(memory(w.k1, P1), "verweis.md"));
  const r = abgleich({ ...w, konten: [w.k1, w.k2, fehlt, fremd] });
  assert.ok(!existsSync(fehlt), "fehlendes Konto nicht angelegt");
  assert.deepEqual(readdirSync(fremd), [], "fremder Ordner unberührt (kein projects/ angelegt)");
  assert.ok(r.warnungen.some((x) => /gibt es nicht/.test(x)) && r.warnungen.some((x) => /sieht nicht wie ein Claude-Konto aus/.test(x)));
  assert.ok(r.warnungen.some((x) => /verweis\.md.*Symlink/.test(x)));
  assert.ok(!existsSync(join(w.wurzel, P1, "verweis.md")));
  assert.equal(liesK(w.k2, P1, "a.md"), "A\n");
});

test("Ordner in der Wurzel, die keine Projekt-Schlüssel sind (_traum, .git, .abgleich, …), werden nie als Projekt behandelt — Platz für andere Werkzeuge", () => {
  const w = welt();
  mkdirSync(join(w.wurzel, "_traum"), { recursive: true });
  writeFileSync(join(w.wurzel, "_traum", "bericht.md"), "Traum\n");
  mkdirSync(join(w.wurzel, "ordner mit leerzeichen"), { recursive: true });
  schreibe(w.k1, P1, "a.md", "A\n");
  const r = abgleich(w);
  assert.equal(r.ok, true);
  for (const k of w.konten) assert.deepEqual(readdirSync(join(k, "projects")), [P1], "nur das echte Projekt in den Konten");
  assert.ok(existsSync(join(w.wurzel, "_traum", "bericht.md")), "fremde Dateien bleiben");
  assert.deepEqual(statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten }).projekte.map((p) => p.projekt), [P1]);
  assert.match(git(w.wurzel, "ls-files"), /_traum\/bericht\.md/, "liegt im selben Git-Repo und wird mitgesichert");
});

test("Wurzel und Konto dürfen nicht ineinander liegen", () => {
  const w = welt();
  assert.throws(() => gleicheAb({ wurzel: join(w.k1, "geteilt"), konten: [w.k1] }), /ineinander/);
  assert.throws(() => gleicheAb({ wurzel: w.k1, konten: [w.k1] }), /ineinander/);
});

test("--projekt/projekt: nur dieses Projekt wird abgeglichen", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  schreibe(w.k1, P2, "b.md", "B\n");
  const r = abgleich(w, { projekt: P1 });
  assert.deepEqual(r.plan.projekte.map((p) => p.projekt), [P1]);
  assert.ok(existsSync(join(memory(w.k2, P1), "a.md")));
  assert.ok(!existsSync(join(w.k2, "projects", P2)), "das andere Projekt bleibt unberührt");
  assert.ok(!existsSync(join(w.wurzel, P2)));
});

// ------------------------------------------------------------------------------------------ status
test("status: abgeglichen/ausstehend je Projekt und Konto, offene Konflikte, Temp-Projekte ausgelassen — und nur lesend", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  schreibe(w.k2, P1, "a.md", "A2\n");
  schreibe(w.k1, "-tmp-q", "a.md", "x\n");
  const vorherAbbild = abbild(w.home);
  const vor = statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten });
  assert.equal(abbild(w.home), vorherAbbild, "status ändert nichts");
  assert.equal(vor.wurzelVorhanden, false);
  assert.equal(vor.uebersprungen, 1);
  assert.deepEqual(vor.projekte.map((p) => p.projekt), [P1]);
  assert.equal(vor.projekte[0].abgeglichen, false);
  assert.equal(vor.abgeglichenGanz, 0);
  abgleich(w);
  const nach = statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten });
  assert.equal(nach.projekte[0].abgeglichen, true);
  assert.equal(nach.abgeglichenGanz, 1);
  assert.equal(nach.offeneKonflikte, 1);
  schreibe(w.k1, P1, "neu.md", "neu\n");
  const offen = statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten });
  assert.equal(offen.projekte[0].abgeglichen, false);
  assert.deepEqual(offen.projekte[0].konten.map((k) => [k.konto, k.vonKonto, k.nachKonto]), [["claude", 1, 0], ["claude-zwei", 0, 1]]);
});

// ------------------------------------------------------------------------------------------ Einstellungen
test("Einstellungen: gedaechtnisTeilen aus|an (Standard aus), Wurzel ~/.claude-gedaechtnis, Standard-Konten NUR ~/.claude; Prüfung beim Schreiben", () => {
  assert.deepEqual(SCHEMA.gedaechtnisTeilen.werte, ["aus", "an"]);
  assert.equal(STANDARD.gedaechtnisTeilen, "aus");
  assert.equal(STANDARD.gedaechtnisWurzel, STANDARD_WURZEL);
  assert.deepEqual(STANDARD.gedaechtnisKonten, STANDARD_KONTEN);
  assert.equal(STANDARD_WURZEL, "~/.claude-gedaechtnis");
  assert.deepEqual(STANDARD_KONTEN, ["~/.claude"], "keine privaten Ordnernamen als Standard (das Kit wird veröffentlicht)");
  assert.equal(SCHEMA.gedaechtnisWurzel.ohneMaske, true);
  assert.equal(SCHEMA.gedaechtnisKonten.typ, "pfadliste");
  const v = tempVault();
  const { werte, stand } = leseAutomatik(v);
  assert.equal(werte.gedaechtnisTeilen, "aus");
  assert.deepEqual(werte.gedaechtnisKonten, ["~/.claude"]);
  schreibeAutomatik(v, { gedaechtnisTeilen: "an", gedaechtnisWurzel: "~/mein-gedaechtnis", gedaechtnisKonten: ["~/.claude", "/pfad mit Leerzeichen/.claude-x"] }, stand);
  const neu = leseAutomatik(v).werte;
  assert.deepEqual([neu.gedaechtnisTeilen, neu.gedaechtnisWurzel, neu.gedaechtnisKonten], ["an", "~/mein-gedaechtnis", ["~/.claude", "/pfad mit Leerzeichen/.claude-x"]]);
  for (const kaputt of [{ gedaechtnisTeilen: "vielleicht" }, { gedaechtnisTeilen: true }, { gedaechtnisWurzel: "" }, { gedaechtnisWurzel: 5 }, { gedaechtnisWurzel: ["a"] }, { gedaechtnisKonten: "~/.claude" }, { gedaechtnisKonten: [1] }]) {
    assert.throws(() => schreibeAutomatik(v, kaputt, leseAutomatik(v).stand), (e) => e.code === 400, JSON.stringify(kaputt));
  }
  schreibeAutomatik(v, { gedaechtnisWurzel: null, gedaechtnisKonten: null }, leseAutomatik(v).stand);
  assert.equal(leseAutomatik(v).werte.gedaechtnisWurzel, STANDARD_WURZEL, "null = Rückfall auf den Standard");
  assert.deepEqual(leseAutomatik(v).werte.gedaechtnisKonten, ["~/.claude"]);
});

test("gedaechtnisPfade/expandiere: ~ wird mit dem übergebenen Home aufgelöst, Dubletten fallen weg, teilen nur bei „an“, Standard-Konten = nur ~/.claude", () => {
  const home = join(tmpdir(), "heim-x");
  assert.equal(expandiere("~", home), home);
  assert.equal(expandiere("~/.claude", home), join(home, ".claude"));
  assert.equal(expandiere("/abs/pfad", home), "/abs/pfad");
  const p = gedaechtnisPfade({ ...STANDARD, gedaechtnisKonten: ["~/.claude", "~/.claude/", "~/.claude-zwei", " "] }, { home });
  assert.deepEqual(p, { teilen: false, wurzel: join(home, ".claude-gedaechtnis"), konten: [join(home, ".claude"), join(home, ".claude-zwei")] });
  assert.equal(gedaechtnisPfade({ ...STANDARD, gedaechtnisTeilen: "an" }, { home }).teilen, true);
  assert.deepEqual(gedaechtnisPfade({}, { home }).konten, [join(home, ".claude")], "ohne Werte: Standard = nur ~/.claude");
  assert.deepEqual(gedaechtnisPfade(STANDARD, { home }).konten, [join(home, ".claude")]);
});

// ------------------------------------------------------------------------------------------ Hook-Auslöser
test("projektAusTranskript: Projekt-Schlüssel = Name des Elternordners von transcript_path (auch Windows-Pfade); ohne gültigen Schlüssel null", () => {
  assert.equal(projektAusTranskript("/pfad/zum/konto/projects/-work-projekt-a/sitzung-1.jsonl"), "-work-projekt-a");
  assert.equal(projektAusTranskript("C:\\konto\\projects\\C--work-projekt\\s.jsonl"), "C--work-projekt");
  for (const schlecht of [undefined, null, "", "   ", 5, {}, "sitzung.jsonl", "/projekt mit leerzeichen/s.jsonl", "/projects/-private-tmp-x/s.jsonl", "/projects/_traum/s.jsonl"]) {
    assert.equal(projektAusTranskript(schlecht), null, String(schlecht));
  }
});

test("starteAbgleichFuerSitzung: nur mit gedaechtnisTeilen=an und gültigem Projekt-Schlüssel; wirft nie", () => {
  const aufrufe = [];
  const starte = (x) => aufrufe.push(x);
  const eingabe = { transcript_path: `/x/.claude/projects/${P1}/s.jsonl`, session_id: "s" };
  assert.deepEqual(starteAbgleichFuerSitzung({ vault: "/v", eingabe, werte: { gedaechtnisTeilen: "aus" }, starte }), { gestartet: false, grund: "aus" });
  assert.deepEqual(starteAbgleichFuerSitzung({ vault: "/v", eingabe, werte: {}, starte }), { gestartet: false, grund: "aus" });
  assert.deepEqual(starteAbgleichFuerSitzung({ vault: "/v", eingabe: { session_id: "s" }, werte: { gedaechtnisTeilen: "an" }, starte }), { gestartet: false, grund: "kein-projekt" });
  assert.deepEqual(starteAbgleichFuerSitzung({ vault: "/v", eingabe, werte: { gedaechtnisTeilen: "an" }, starte }), { gestartet: true, projekt: P1 });
  assert.deepEqual(aufrufe, [{ vault: "/v", projekt: P1 }]);
  assert.equal(starteAbgleichFuerSitzung({ vault: "/v", eingabe, werte: { gedaechtnisTeilen: "an" }, starte: () => { throw new Error("kaputt"); } }).gestartet, false);
  assert.doesNotThrow(() => starteAbgleichFuerSitzung());
});

function hookVault(w, an = true) {
  const v = tempVault("Hook-Vault");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ...(an ? { gedaechtnisTeilen: "an" } : {}), gedaechtnisWurzel: w.wurzel, gedaechtnisKonten: w.konten } }));
  return v;
}
const HOOK_ENV = (w) => ({ HOME: w.home, USERPROFILE: w.home, BRAIN_SESSION_NUR_STATUS: "1" });
const fertig = (w) => !existsSync(`${w.wurzel}.lock`);

test("Hook SessionStart mit transcript_path: gleicht NUR das aktuelle Projekt im Hintergrund ab (der Hook selbst wartet nicht)", async () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A aus Konto 1\n");
  schreibe(w.k1, P2, "b.md", "anderes Projekt\n");
  const v = hookVault(w);
  const h = hook("session-start.mjs", { session_id: "s1", source: "startup", cwd: v, transcript_path: join(w.k1, "projects", P1, "s1.jsonl") }, { vault: v, env: HOOK_ENV(w) });
  assert.equal(h.status, 0, h.stderr);
  assert.ok(await warteBis(() => existsSync(join(memory(w.k2, P1), "a.md")) && existsSync(join(w.wurzel, P1, "a.md")) && fertig(w)), "Konto 2 bekommt das Gedächtnis des Projekts");
  assert.equal(liesK(w.k2, P1, "a.md"), "A aus Konto 1\n");
  assert.ok(!existsSync(join(w.k2, "projects", P2)) && !existsSync(join(w.wurzel, P2)), "das andere Projekt wird nicht angefasst");
  const logDatei = join(v, ".logs", "hooks.log");
  assert.ok(await warteBis(() => existsSync(logDatei) && /gedaechtnis -work-projekt-a: Gedächtnis: 1 Projekt\(e\) abgeglichen/.test(lies(logDatei))), "Ergebnis steht im Hook-Log");
});

test("Hook SessionEnd mit transcript_path: bringt die Änderung des Projekts ins andere Konto; Schalter aus oder kein transcript_path → nichts", async () => {
  const w = eingespielt({ "a.md": "A\n" });
  const v = hookVault(w);
  schreibe(w.k1, P1, "a.md", "A, in der Sitzung geändert\n");
  schreibe(w.k1, P2, "x.md", "anderes Projekt\n");
  const ohne = hook("sitzung-ende.mjs", { session_id: "s2", reason: "other" }, { vault: v, env: HOOK_ENV(w) });
  assert.equal(ohne.status, 0);
  assert.equal(ohne.stdout, "", "gibt nie etwas aus");
  const aus = hook("sitzung-ende.mjs", { session_id: "s2", transcript_path: join(w.k1, "projects", P1, "s2.jsonl") }, { vault: hookVault(w, false), env: HOOK_ENV(w) });
  assert.equal(aus.status, 0);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(liesK(w.k2, P1, "a.md"), "A\n", "ohne Schalter und ohne transcript_path passiert nichts");
  const h = hook("sitzung-ende.mjs", { session_id: "s2", reason: "other", transcript_path: join(w.k1, "projects", P1, "s2.jsonl") }, { vault: v, env: HOOK_ENV(w) });
  assert.equal(h.status, 0, h.stderr);
  assert.equal(h.stdout, "");
  assert.ok(await warteBis(() => liesK(w.k2, P1, "a.md") === "A, in der Sitzung geändert\n" && fertig(w)), "die Änderung kommt im anderen Konto an");
  assert.ok(!existsSync(join(w.k2, "projects", P2)), "nur das aktuelle Projekt");
});

// ------------------------------------------------------------------------------------------ CLI
function cli(w, args, extraEnv = {}) {
  const v = tempVault("Brain CLI");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { gedaechtnisWurzel: w.wurzel, gedaechtnisKonten: w.konten } }));
  return { v, ...spawnSync(process.execPath, [join(KIT, "gedaechtnis.mjs"), v, ...args], { encoding: "utf8", env: { ...OHNE_GIT, HOME: w.home, USERPROFILE: w.home, ...extraEnv } }) };
}
test("CLI: status/abgleichen (Trockenlauf) ändern nichts, --anwenden führt aus, --projekt begrenzt, --json liefert ein Objekt; brain gedaechtnis delegiert", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  schreibe(w.k1, P2, "b.md", "B\n");
  const vorher = abbild(w.home);
  const s = cli(w, ["status"]);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /Gemeinsames Gedächtnis/);
  assert.match(s.stdout, /⚠ -work-projekt-a/);
  assert.match(s.stdout, /Schalter gedaechtnisTeilen: aus/);
  const t = cli(w, ["abgleichen"]);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /TROCKENLAUF/);
  assert.match(t.stdout, /claude-zwei: 1 schreiben, 0 löschen/);
  assert.match(t.stdout, /abgleichen --anwenden/);
  assert.equal(abbild(w.home), vorher);
  assert.equal(JSON.parse(cli(w, ["abgleichen", "--json"]).stdout).anwenden, false);
  const a = cli(w, ["abgleichen", "--projekt", P1, "--anwenden"]);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /ANGEWENDET/);
  assert.match(a.stdout, /Sicherung: /);
  assert.ok(existsSync(join(memory(w.k2, P1), "a.md")) && !existsSync(join(w.k2, "projects", P2)));
  const a2 = cli(w, ["abgleichen", "--anwenden", "--ins-log"]);
  assert.equal(a2.status, 0, a2.stderr);
  assert.match(lies(join(a2.v, ".logs", "hooks.log")), /gedaechtnis: Gedächtnis: 1 Projekt\(e\) abgeglichen/);
  const j2 = JSON.parse(cli(w, ["status", "--json"]).stdout);
  assert.equal(j2.abgeglichenGanz, 2);
  assert.equal(j2.schalter, "aus");
  assert.match(cli(w, ["abgleichen"]).stdout, /nichts zu tun/);
  for (const [args, muster] of [[["--gibt-es-nicht"], /Unbekannte Angabe/], [["verbinden"], /gibt es nicht mehr.*abgleichen/], [["trennen"], /gibt es nicht mehr/], [["abgleichen", "--projekt"], /--projekt braucht/]]) {
    const falsch = cli(w, args);
    assert.equal(falsch.status, 64, args.join(" "));
    assert.match(falsch.stderr, muster);
    assert.match(falsch.stderr, /Nutzung: brain gedaechtnis \[status\|abgleichen\]/);
  }
  assert.equal(cli(w, ["abgleichen", "--projekt", "kein schlüssel/"]).status, 1);
  // über den brain-Einstieg (BRAIN_VAULT, ohne Vault-Argument)
  const v = tempVault("Brain CLI 2");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { gedaechtnisWurzel: w.wurzel, gedaechtnisKonten: w.konten } }));
  const b = spawnSync(process.execPath, [join(KIT, "brain.mjs"), "gedaechtnis", "status", "--json"], { encoding: "utf8", env: { ...OHNE_GIT, HOME: w.home, USERPROFILE: w.home, BRAIN_VAULT: v } });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(JSON.parse(b.stdout).konten.length, 2);
});

test("leseArgs: Befehl, Vault, --projekt, --anwenden, --json, --ins-log; verbinden/trennen gibt es nicht mehr", () => {
  assert.deepEqual(leseArgs([]), { befehl: "status", anwenden: false, json: false, insLog: false, projekt: null, warte: 0, vault: null, erzwingen: false });
  assert.deepEqual(leseArgs(["/v", "abgleichen", "--projekt", "-a-b", "--anwenden", "--json", "--ins-log", "--warte", "30"]), { befehl: "abgleichen", anwenden: true, json: true, insLog: true, projekt: "-a-b", warte: 30, vault: "/v", erzwingen: false });
  assert.throws(() => leseArgs(["--warte", "viel"]), /--warte braucht/);
  assert.throws(() => leseArgs(["verbinden"]), /gibt es nicht mehr/);
  assert.throws(() => leseArgs(["--projekt"]), /braucht einen Projekt-Schlüssel/);
  assert.throws(() => leseArgs(["a", "b", "c"]), /Unbekannte Angabe/);
});

// ------------------------------------------------------------------------------------------ Tageslauf
test("gedaechtnisSchritt: nur mit Schalter „an“; Probe = Trockenlauf; scharf gleicht ab; Fehler werfen nie", () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  const werte = (extra = {}) => ({ ...STANDARD, gedaechtnisWurzel: w.wurzel, gedaechtnisKonten: w.konten, ...extra });
  const aus = { werte: werte(), probe: false, home: w.home, jetzt: Date.now() };
  gedaechtnisSchritt(aus);
  assert.equal(aus.gedaechtnis, undefined, "Schalter aus → nichts");
  assert.ok(!existsSync(w.wurzel));
  const probe = { werte: werte({ gedaechtnisTeilen: "an" }), probe: true, home: w.home, jetzt: Date.now() };
  const vorher = abbild(w.home);
  gedaechtnisSchritt(probe);
  assert.match(probe.gedaechtnis, /^Gedächtnis \(Trockenlauf\): 1 Projekt\(e\) abzugleichen/);
  assert.equal(abbild(w.home), vorher, "Probe ändert nichts");
  const scharf = { werte: werte({ gedaechtnisTeilen: "an" }), probe: false, home: w.home, jetzt: Date.now() };
  gedaechtnisSchritt(scharf);
  assert.match(scharf.gedaechtnis, /^Gedächtnis: 1 Projekt\(e\) abgeglichen, 1 Datei\(en\) in der Wurzel geändert, 1 in den Konten/);
  assert.equal(liesK(w.k2, P1, "a.md"), "A\n");
  const nochmal = { werte: werte({ gedaechtnisTeilen: "an" }), probe: false, home: w.home, jetzt: Date.now() };
  gedaechtnisSchritt(nochmal);
  assert.match(nochmal.gedaechtnis, /^Gedächtnis: nichts zu tun \(1 Projekt\(e\) abgeglichen\)$/);
  // Wurzel in den Konten: Fehler als Zeile, nie eine Ausnahme
  const kaputt = { werte: werte({ gedaechtnisTeilen: "an", gedaechtnisWurzel: join(w.k1, "x") }), probe: false, home: w.home, jetzt: Date.now() };
  assert.doesNotThrow(() => gedaechtnisSchritt(kaputt));
  assert.match(kaputt.gedaechtnis, /^Gedächtnis: Fehler — Wurzel \(/);
  assert.doesNotThrow(() => gedaechtnisSchritt(undefined));
});

test("Tageslauf: Schritt am Anfang, eine Zeile im Bericht; Probelauf = Trockenlauf; Schalter aus → keine Zeile", async () => {
  const { aufbau, lauf } = await import("./lauf-hilfe.mjs");
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  const grundAutomatik = { tageslauf: "an", einschwingen: 0, gedaechtnisWurzel: w.wurzel, gedaechtnisKonten: w.konten };
  // Schalter aus
  const v0 = aufbau({ automatik: grundAutomatik });
  const r0 = await lauf(v0, { home: w.home });
  assert.doesNotMatch(readFileSync(join(v0, r0.bericht), "utf8"), /Gedächtnis/);
  assert.ok(!existsSync(w.wurzel));
  // Probe von Hand: Trockenlauf-Zeile, nichts geändert
  const v1 = aufbau({ automatik: { ...grundAutomatik, gedaechtnisTeilen: "an" } });
  const vorher = abbild(w.home);
  const r1 = await lauf(v1, { home: w.home, probe: true });
  assert.match(readFileSync(join(v1, r1.bericht), "utf8"), /^- Gedächtnis \(Trockenlauf\): 1 Projekt\(e\) abzugleichen/m);
  assert.equal(abbild(w.home), vorher);
  // scharfer Lauf: abgeglichen, eine Zeile im Bericht
  const v2 = aufbau({ automatik: { ...grundAutomatik, gedaechtnisTeilen: "an" } });
  const r2 = await lauf(v2, { home: w.home });
  const bericht = readFileSync(join(v2, r2.bericht), "utf8");
  assert.equal((bericht.match(/^- Gedächtnis: /gm) || []).length, 1, bericht);
  assert.match(bericht, /^- Gedächtnis: 1 Projekt\(e\) abgeglichen, 1 Datei\(en\) in der Wurzel geändert/m);
  assert.equal(liesK(w.k2, P1, "a.md"), "A\n");
  assert.notEqual(r2.status, "fehler");
});

// ------------------------------------------------------------------------------------------ Bausteine
test("bereinigeIndex: Zeilen der Wurzel bleiben unberührt; fremde Dubletten (exakt oder gleiche verlinkte Datei) samt Folgezeilen entfallen; fremde Überschrift wird in den bestehenden Abschnitt einsortiert", () => {
  const aktuell = "## Aktive Sessions\n- [Eins](eins.md) — läuft\n- [Eins](eins.md) — läuft\n\n## Erinnerungen\n- [GitHub](github.md) — Konten\n";
  // wie ein --union-Merge mit leerer Basis aussieht: erst alles der Wurzel, dann alles des Kontos
  const union = aktuell + "## Aktive Sessions\n- [Eins](eins.md) — läuft\n- [Zwei](zwei.md) — neu\n## Erinnerungen\n- [GitHub](github.md) — anders beschrieben\n  Folgezeile dazu\n- [Brain](brain.md) — neu\n  Folgezeile zu Brain\n## Nur im Konto\n- [Exot](exot.md) — fremd\n## Leer\n- [GitHub](github.md) — nochmal\n";
  const t = bereinigeIndex(union, aktuell);
  assert.equal(t, "## Aktive Sessions\n- [Eins](eins.md) — läuft\n- [Eins](eins.md) — läuft\n- [Zwei](zwei.md) — neu\n\n## Erinnerungen\n- [GitHub](github.md) — Konten\n- [Brain](brain.md) — neu\n  Folgezeile zu Brain\n## Nur im Konto\n- [Exot](exot.md) — fremd\n");
  assert.equal(bereinigeIndex(t, t), t, "idempotent");
  assert.equal(bereinigeIndex("## A\r\n- [x](x.md)\r\n## A\r\n- [y](y.md)\r\n", "## A\r\n- [x](x.md)\r\n"), "## A\r\n- [x](x.md)\r\n- [y](y.md)\r\n", "CRLF bleibt");
  assert.equal(bereinigeIndex("", ""), "");
  assert.equal(bereinigeIndex("Kopf\n- [A](a.md)\n", ""), "Kopf\n- [A](a.md)\n");
});

test("konfliktName: vor der Endung, ohne Endung → .md, Unterordner bleiben, Nummer bei weiterer Kopie", () => {
  assert.equal(konfliktName("a.md", "k"), "a.konflikt-k.md");
  assert.equal(konfliktName("sub/a.json", "k"), "sub/a.konflikt-k.json");
  assert.equal(konfliktName("notiz", "k"), "notiz.konflikt-k.md");
  assert.equal(konfliktName("a.md", "k", 2), "a.konflikt-k-2.md");
});

test("Leseprobe: leseBaum lässt Symlinks und .DS_Store aus; blobHash entspricht git hash-object", () => {
  const d = tempOrdner("baum");
  writeFileSync(join(d, "a.md"), "a");
  writeFileSync(join(d, ".DS_Store"), "x");
  symlinkSync(join(d, "a.md"), join(d, "link.md"));
  const b = leseBaum(d);
  assert.deepEqual([...b.dateien.keys()], ["a.md"]);
  assert.deepEqual(b.uebersprungen, ["link.md"]);
  assert.equal(blobHash(Buffer.from("a")), spawnSync("git", ["hash-object", join(d, "a.md")], { encoding: "utf8", env: OHNE_GIT }).stdout.trim());
  assert.equal(blobHash(Buffer.alloc(0)), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", "leerer Blob");
});

// ------------------------------------------------------------------------------------------ Konflikt-Format (EIN Format für Schreiber und Leser)
const fmKopie = (extra = "") => `---\nname: same\ndescription: "Konflikt"\nmetadata:\n  type: feedback\n${extra}---\n\n`;
const FM_OFFEN = `${fmKopie()}Text\n`, FM_AUFG = `${fmKopie("status: aufgeloest\n")}Aufgelöst in same.md\n`;
const KOPIE = "same.konflikt-claude-zwei.md";
// Ausgangslage: same.md in Konto 1 und 2 an derselben Stelle verschieden geändert → Konflikt-Kopie in Wurzel und beiden Konten, Eintrag in _konflikte.md
function mitKonflikt(extra = {}) {
  const w = eingespielt({ "MEMORY.md": "# M\n- [S](same.md) — s\n", "same.md": "alt\n", ...extra });
  schreibe(w.k1, P1, "same.md", "von eins\n");
  schreibe(w.k2, P1, "same.md", "von zwei\n");
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(liesW(w, P1, KOPIE), "von zwei\n");
  for (const k of w.konten) assert.equal(liesK(k, P1, KOPIE), "von zwei\n", "beide Konten haben die Kopie");
  return w;
}

test("Konflikt-Name: leseKonfliktName ist die Umkehrung von konfliktName (Unterordner, Nummer, ohne Endung); Nicht-Kopien sind keine", () => {
  const faelle = [["a.md", "k", 1, "a.md"], ["sub/a.json", "claude-zwei", 1, "sub/a.json"], ["notiz", "k", 1, "notiz.md"], ["a.md", "k", 2, "a.md"], ["a.b.md", "konto_1", 3, "a.b.md"]];
  for (const [rel, konto, n, original] of faelle) {
    const name = konfliktName(rel, konto, n), i = leseKonfliktName(name);
    assert.ok(i, name);
    assert.deepEqual([i.konto, i.n, i.original], [konto, n, original], name);
    assert.equal(istKonfliktKopie(name), true);
  }
  assert.equal(leseKonfliktName("a.konflikt-k.konflikt-j.md").original, "a.konflikt-k.md", "Kopie einer Kopie: das Original ist die erste Kopie");
  for (const kein of ["a.md", "MEMORY.md", "_konflikte.md", "konflikt-a.md", "a.konflikt-.md", "a.konflikt-k", "a.konflikt-k.md.bak", "a.konflikt-k.md/", "a.konflikt-k l.md"]) assert.equal(istKonfliktKopie(kein), false, kein);
});

test("_konflikte.md: der Abgleich schreibt exakt konfliktZeile — und leseKonfliktEintraege liest nur dieses Format (keine toleranten Treffer)", () => {
  const w = mitKonflikt();
  const text = liesW(w, P1, "_konflikte.md");
  const e = leseKonfliktEintraege(text);
  assert.equal(e.length, 1);
  assert.deepEqual({ ...e[0], index: undefined, datum: undefined }, { index: undefined, datum: undefined, konto: "claude-zwei", datei: "same.md", kopie: KOPIE });
  assert.equal(text.split("\n")[e[0].index], konfliktZeile({ datum: e[0].datum, konto: "claude-zwei", datei: "same.md", kopie: KOPIE }), "Schreiber und Leser benutzen dasselbe Format");
  assert.equal(leseKonfliktName(e[0].kopie).original, e[0].datei);
  assert.ok(existsSync(join(w.wurzel, P1, e[0].kopie)));
  for (const lose of [`- ${KOPIE}`, KOPIE, `- 2026-10-22 same.md weicht ab → Kopie ${KOPIE}`, `- 2026-10-22 · k: same.md weicht ab → Kopie \`${KOPIE}\``, `* 2026-10-22 · k: \`same.md\` weicht ab → Kopie \`${KOPIE}\``, `- 22.10.2026 · k: \`same.md\` weicht ab → Kopie \`${KOPIE}\``]) {
    assert.deepEqual(leseKonfliktEintraege(`${lose}\n`), [], lose);
  }
  const zwei = `${text}${konfliktZeile({ datum: "2026-10-23", konto: "claude", datei: "x.md", kopie: "x.konflikt-claude.md" })}\n`;
  const ohneEins = streicheKonfliktEintraege(zwei, new Set([KOPIE]));
  assert.deepEqual(leseKonfliktEintraege(ohneEins).map((x) => x.kopie), ["x.konflikt-claude.md"]);
  assert.match(ohneEins, /^# Offene Konflikte/, "Kopf bleibt, solange ein Eintrag da ist");
  assert.equal(streicheKonfliktEintraege(zwei, new Set([KOPIE, "x.konflikt-claude.md"])), "", "kein Eintrag mehr, nur der Kopf → die Liste entfällt");
  assert.equal(streicheKonfliktEintraege(`${text}Eigene Notiz.\n`, new Set([KOPIE])).trim().endsWith("Eigene Notiz."), true, "eigener Text bleibt");
});

test("istAufgeloesteKopie: Konflikt-Name (.md) UND eigene Zeile „status: aufgeloest“ im Frontmatter — sonst nie", () => {
  assert.equal(istAufgeloesteKopie(KOPIE, FM_AUFG), true);
  assert.equal(istAufgeloesteKopie(KOPIE, FM_AUFG.replace(/\n/g, "\r\n")), true, "auch mit Windows-Zeilenenden");
  assert.equal(istAufgeloesteKopie(KOPIE, FM_AUFG.replace("status: aufgeloest", 'status: "aufgeloest"')), true);
  assert.equal(istAufgeloesteKopie(KOPIE, FM_OFFEN), false, "ohne status");
  assert.equal(istAufgeloesteKopie(KOPIE, fmKopie("status: erledigt\n")), false, "anderer Status");
  assert.equal(istAufgeloesteKopie(KOPIE, `Text\nstatus: aufgeloest\n`), false, "ohne Frontmatter");
  assert.equal(istAufgeloesteKopie(KOPIE, `${fmKopie()}status: aufgeloest\n`), false, "im Text statt im Frontmatter");
  assert.equal(istAufgeloesteKopie(KOPIE, fmKopie("  status: aufgeloest\n")), false, "eingerückt = unter metadata");
  assert.equal(istAufgeloesteKopie("regel.md", FM_AUFG), false, "kein Konflikt-Name");
  assert.equal(istAufgeloesteKopie("daten.konflikt-k.json", FM_AUFG), false, "nur .md");
});

test("aufgelöste Konflikt-Kopie (vom Traum: status: aufgeloest): der nächste Abgleich entfernt sie aus Wurzel UND beiden Konten, streicht den Eintrag, die leere Liste entfällt; protokolliert und gesichert", () => {
  const w = mitKonflikt();
  assert.equal(statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten }).offeneKonflikte, 1);
  schreibeW(w, P1, KOPIE, FM_AUFG);                                         // der Traum markiert die Kopie als aufgelöst (und lässt hier die Zeile in _konflikte.md stehen)
  assert.equal(statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten }).offeneKonflikte, 0, "aufgelöst zählt nicht mehr als offen");
  const vorher = abbild(w.wurzel);
  const plan = trocken(w);
  assert.deepEqual(plan.plan.projekte[0].aufgeloeste, [KOPIE]);
  assert.match(plan.zeile, /1 aufgelöste Konflikt-Kopie\(n\) zu entfernen/);
  assert.equal(abbild(w.wurzel), vorher, "Trockenlauf ändert nichts");
  assert.ok(existsSync(join(memory(w.k1, P1), KOPIE)));
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.plan.projekte[0].aufgeloeste, [KOPIE]);
  assert.equal(r.zaehler.aufgeloest, 1);
  assert.match(r.zeile, /1 aufgelöste Konflikt-Kopie\(n\) entfernt/);
  assert.match(git(w.wurzel, "log", "-1", "--format=%s"), /1 aufgelöste Konflikt-Kopie\(n\) entfernt/, "im Commit der Wurzel steht die Löschung");
  for (const dir of [join(w.wurzel, P1), memory(w.k1, P1), memory(w.k2, P1)]) assert.deepEqual(dateien(dir), ["MEMORY.md", "same.md"], dir);
  assert.equal(liesW(w, P1, "same.md"), "von eins\n", "das Original bleibt unberührt");
  for (const konto of ["claude", "claude-zwei"]) assert.deepEqual(Object.keys(manifest(w, konto, P1)).sort(), ["MEMORY.md", "same.md"], `Manifest ${konto}`);
  assert.ok(r.sicherung, "es gab eine Sicherung vor dem Löschen");
  assert.match(spawnSync("tar", ["-tzf", r.sicherung], { encoding: "utf8" }).stdout, /same\.konflikt-claude-zwei\.md/, "die Kopie steckt noch in der Sicherung");
  assert.equal(abgleich(w).nichtsZuTun, true, "danach ist alles ruhig");
});

test("aufgelöste Kopien: nur Konflikt-Name UND status UND vorhandenes Original — alles andere bleibt; andere Einträge in _konflikte.md bleiben", () => {
  const w = mitKonflikt({ "x.md": "X\n" });
  schreibeW(w, P1, "regel.md", FM_AUFG);                                    // status: aufgeloest, aber kein Konflikt-Name → bleibt
  schreibeW(w, P1, "x.konflikt-claude.md", FM_OFFEN);                       // Konflikt-Name, aber nicht aufgelöst → bleibt
  schreibeW(w, P1, "y.konflikt-claude.md", FM_AUFG);                        // aufgelöst, aber y.md gibt es nicht → bleibt (Warnung)
  const eintrag = (kopie, datei, konto = "claude") => konfliktZeile({ datum: "2026-10-22", konto, datei, kopie });
  schreibeW(w, P1, "_konflikte.md", `${liesW(w, P1, "_konflikte.md")}${eintrag("x.konflikt-claude.md", "x.md")}\n${eintrag("y.konflikt-claude.md", "y.md")}\n`);
  const r1 = abgleich(w);
  assert.equal(r1.ok, true, JSON.stringify(r1.fehler));
  assert.deepEqual(r1.plan.projekte[0].aufgeloeste, []);
  assert.ok(r1.warnungen.some((x) => /y\.konflikt-claude\.md.*y\.md fehlt/.test(x)), JSON.stringify(r1.warnungen));
  for (const dir of [join(w.wurzel, P1), memory(w.k1, P1), memory(w.k2, P1)]) assert.deepEqual(dateien(dir), ["MEMORY.md", "_konflikte.md", "regel.md", KOPIE, "same.md", "x.konflikt-claude.md", "x.md", "y.konflikt-claude.md"].sort(), dir);
  // jetzt wird die Kopie von same aufgelöst: nur sie geht, die anderen Zeilen bleiben
  schreibeW(w, P1, KOPIE, FM_AUFG);
  const r2 = abgleich(w);
  assert.equal(r2.ok, true, JSON.stringify(r2.fehler));
  assert.deepEqual(r2.plan.projekte[0].aufgeloeste, [KOPIE]);
  assert.deepEqual(leseKonfliktEintraege(liesW(w, P1, "_konflikte.md")).map((e) => e.kopie), ["x.konflikt-claude.md", "y.konflikt-claude.md"]);
  for (const k of w.konten) assert.equal(liesK(k, P1, "_konflikte.md"), liesW(w, P1, "_konflikte.md"));
  for (const dir of [join(w.wurzel, P1), memory(w.k1, P1), memory(w.k2, P1)]) assert.deepEqual(dateien(dir), ["MEMORY.md", "_konflikte.md", "regel.md", "same.md", "x.konflikt-claude.md", "x.md", "y.konflikt-claude.md"], dir);
});

test("eine Kopie, die dieser Lauf selbst neu anlegt, wird nie im selben Lauf als „aufgelöst“ entfernt (Konto ändert die aufgelöste Kopie)", () => {
  const w = mitKonflikt();
  schreibeW(w, P1, KOPIE, FM_AUFG);
  schreibe(w.k2, P1, KOPIE, `${fmKopie("status: aufgeloest\n")}Ein Konto hat daran weitergearbeitet.\n`);     // beide ändern die Kopie verschieden
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const neue = dateien(join(w.wurzel, P1)).filter((n) => n.startsWith("same.konflikt-") && n !== KOPIE);
  assert.equal(neue.length, 1, "die Konto-Fassung bleibt als eigene Kopie erhalten");
  assert.match(liesW(w, P1, neue[0]), /weitergearbeitet/);
});

// ------------------------------------------------------------------------------------------ Wurzel-Repo: gc.pruneExpire
test("Wurzel: git config gc.pruneExpire never beim Anlegen; eine ältere Wurzel ohne den Wert bekommt ihn beim nächsten anwendenden Lauf, ein gesetzter Wert bleibt", () => {
  const holeWert = (wurzel) => spawnSync("git", ["-C", wurzel, "config", "--local", "--get", "gc.pruneExpire"], { encoding: "utf8", env: OHNE_GIT }).stdout.trim();
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  trocken(w);
  assert.ok(!existsSync(join(w.wurzel, ".git")), "Trockenlauf legt nichts an");
  abgleich(w);
  assert.equal(holeWert(w.wurzel), "never", "neu angelegte Wurzel");
  const alt = welt();                                                         // Wurzel einer früheren Fassung: Repo ohne die Einstellung
  mkdirSync(alt.wurzel, { recursive: true });
  spawnSync("git", ["init", "-q", alt.wurzel], { env: OHNE_GIT });
  assert.equal(holeWert(alt.wurzel), "");
  schreibe(alt.k1, P1, "a.md", "A\n");
  abgleich(alt);
  assert.equal(holeWert(alt.wurzel), "never", "ältere Wurzel wird nachgezogen");
  const eigen = welt();
  mkdirSync(eigen.wurzel, { recursive: true });
  spawnSync("git", ["init", "-q", eigen.wurzel], { env: OHNE_GIT });
  spawnSync("git", ["-C", eigen.wurzel, "config", "--local", "gc.pruneExpire", "30.days.ago"], { env: OHNE_GIT });
  schreibe(eigen.k1, P1, "a.md", "A\n");
  abgleich(eigen);
  assert.equal(holeWert(eigen.wurzel), "30.days.ago", "ein selbst gesetzter Wert wird respektiert");
});

// ------------------------------------------------------------------------------------------ Projekt-Schlüssel (EINE Definition)
test("projektKlasse/istEchterProjektSchluessel: Aufbau (nur Buchstaben, Ziffern, „-“) und Temp-/Scratchpad-Ausschluss an einer Stelle; projektAusTranskript benutzt dieselbe", () => {
  const faelle = { "-work-projekt-a": "projekt", "-Users-x-brain": "projekt", "_traum": "kein-schluessel", ".git": "kein-schluessel", ".abgleich": "kein-schluessel", "a.b": "kein-schluessel", "mit leerzeichen": "kein-schluessel", "": "kein-schluessel",
    "-private-var-folders-ab-T-x": "temporaer", "-tmp-sache": "temporaer", "-var-folders-ab-T-x": "temporaer", "-work-scratchpad-abc": "temporaer", "-C-Users-x-AppData-Local-Temp-y": "temporaer" };
  for (const [name, klasse] of Object.entries(faelle)) {
    assert.equal(projektKlasse(name), klasse, name);
    assert.equal(istEchterProjektSchluessel(name), klasse === "projekt", name);
    if (klasse !== "projekt" && name) assert.equal(projektAusTranskript(`/x/projects/${name}/s.jsonl`), null, name);
  }
  assert.equal(projektKlasse("-meine-ablage-t-x", { temp: ["/meine/ablage/t"] }), "temporaer", "Temp-Ordner des Systems wie übergeben");
  assert.equal(projektAusTranskript("/x/projects/-work-projekt-a/s.jsonl"), "-work-projekt-a");
});

// ------------------------------------------------------------------------------------------ Schutz vor „alles gelöscht“ (Wurzel weg, Lesefehler, Massenlöschung)
test("Wurzel-Projektordner fehlt (oder ist leer) trotz stehender Manifeste → wie „fehlt“: keine Löschungen, Wiederaufbau aus den Konten, Hinweis", () => {
  for (const wie of ["weg", "leer"]) {
    const w = eingespielt({ "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" });
    const T = join(w.wurzel, P1);
    if (wie === "weg") rmSync(T, { recursive: true }); else for (const n of readdirSync(T)) rmSync(join(T, n), { recursive: true });
    schreibe(w.k1, P1, "a.md", "A, in Konto 1 geändert\n");              // eine echte Änderung läuft trotzdem mit
    const r = abgleich(w);
    assert.equal(r.ok, true, `${wie}: ${JSON.stringify(r.fehler)}`);
    assert.ok(r.warnungen.some((x) => /Wurzel.*(fehlt|leer).*Manifest/.test(x)), `${wie}: Hinweis fehlt — ${r.warnungen.join(" | ")}`);
    for (const k of [w.k1, w.k2]) assert.deepEqual(dateien(memory(k, P1)), ["a.md", "b.md", "c.md"], `${wie}: Konto behält alle Dateien`);
    assert.deepEqual(dateien(T), ["a.md", "b.md", "c.md"], `${wie}: Wurzel aus den Konten neu aufgebaut`);
    assert.equal(liesK(w.k2, P1, "a.md"), "A, in Konto 1 geändert\n", `${wie}: die echte Änderung kommt an`);
    assert.equal(abgleich(w).nichtsZuTun, true, `${wie}: danach stabil`);
  }
});

test("Lesefehler (EACCES/EIO) in leseBaum → fehler-Liste statt stillem Auslassen; beim Abgleich bricht das Projekt ab, nichts wird als „gelöscht“ gewertet", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const w = welt();
  const d = join(w.home, "baum");
  mkdirSync(join(d, "unter"), { recursive: true });
  writeFileSync(join(d, "a.md"), "A\n"); writeFileSync(join(d, "zu.md"), "Z\n"); writeFileSync(join(d, "unter", "x.md"), "X\n");
  chmodSync(join(d, "zu.md"), 0); chmodSync(join(d, "unter"), 0);
  try {
    const b = leseBaum(d);
    assert.deepEqual([...b.dateien.keys()], ["a.md"]);
    assert.equal(b.fehler.length, 2, JSON.stringify(b.fehler));
    assert.ok(b.fehler.some((f) => f.includes("zu.md")) && b.fehler.some((f) => f.includes("unter")));
  } finally { chmodSync(join(d, "zu.md"), 0o600); chmodSync(join(d, "unter"), 0o700); }
  for (const seite of ["wurzel", "konto"]) {
    const e = eingespielt({ "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" });
    schreibe(e.k2, P2, "n.md", "anderes Projekt\n");                       // ein zweites Projekt läuft trotzdem durch
    const datei = seite === "wurzel" ? join(e.wurzel, P1, "b.md") : join(memory(e.k1, P1), "b.md");
    chmodSync(datei, 0);
    try {
      const r = abgleich(e);
      assert.equal(r.ok, false, `${seite}: Fehler im Ergebnis`);
      assert.ok(r.fehler.some((f) => f.includes(P1) && f.includes("b.md")), `${seite}: ${JSON.stringify(r.fehler)}`);
      assert.ok(existsSync(datei), `${seite}: die Datei bleibt`);
      for (const k of [e.k1, e.k2]) assert.deepEqual(readdirSync(memory(k, P1)).sort(), ["a.md", "b.md", "c.md"], `${seite}: Konto unverändert`);
      assert.deepEqual(readdirSync(join(e.wurzel, P1)).sort(), ["a.md", "b.md", "c.md"], `${seite}: Wurzel unverändert`);
      assert.ok(existsSync(join(memory(e.k1, P2), "n.md")), `${seite}: das andere Projekt wurde angewendet`);
      assert.match(r.zeile, /1 Fehler/);
    } finally { chmodSync(datei, 0o600); }
    const danach = abgleich(e);                                                // wieder lesbar → alles gut, nichts ging verloren
    assert.equal(danach.ok, true, JSON.stringify(danach.fehler));
    for (const k of [e.k1, e.k2]) assert.deepEqual(dateien(memory(k, P1)).sort(), ["a.md", "b.md", "c.md"]);
  }
});

test("Massenlöschung: mehr als 50 % der Dateien eines Kontos (und mindestens 3) → Projekt nicht angewendet, Warnung; --erzwingen hebt den Riegel auf", () => {
  const sechs = { "a.md": "A\n", "b.md": "B\n", "c.md": "C\n", "d.md": "D\n", "e.md": "E\n", "f.md": "F\n" };
  const w = eingespielt(sechs);
  for (const rel of ["a.md", "b.md", "c.md", "d.md"]) loesche(w.k1, P1, rel);   // 4 von 6 in Konto 1 → Konto 2 würde 4 von 6 löschen
  schreibe(w.k1, P2, "n.md", "anderes Projekt\n");
  const stand = () => abbild(join(w.k2, "projects", P1)) + abbild(join(w.wurzel, P1));
  const vorher = stand();
  const t = trocken(w);
  assert.ok(t.warnungen.some((x) => x.includes("Massenlöschung — bitte prüfen: brain gedaechtnis abgleichen --projekt -work-projekt-a --erzwingen")), t.warnungen.join(" | "));
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.ok(r.warnungen.some((x) => x.includes("Massenlöschung — bitte prüfen: brain gedaechtnis abgleichen --projekt -work-projekt-a --erzwingen")), r.warnungen.join(" | "));
  assert.equal(stand(), vorher, "nichts geändert (Konto 2, Wurzel)");
  assert.deepEqual(dateien(memory(w.k1, P1)), ["e.md", "f.md"], "Konto 1 behält seinen eigenen Stand");
  assert.ok(existsSync(join(memory(w.k2, P2), "n.md")), "das andere Projekt wird angewendet");
  assert.equal(r.nichtsZuTun, false);
  assert.match(r.zeile, /Massenlöschung/);
  // stabil: ein zweiter Lauf blockiert wieder, ändert nichts
  const r2 = abgleich(w);
  assert.ok(r2.warnungen.some((x) => /Massenlöschung/.test(x)));
  assert.equal(stand(), vorher);
  // mit erzwingen: ausgeführt
  const z = abgleich(w, { erzwingen: true });
  assert.equal(z.ok, true, JSON.stringify(z.fehler));
  assert.ok(!z.warnungen.some((x) => /Massenlöschung/.test(x)));
  assert.deepEqual(dateien(memory(w.k2, P1)), ["e.md", "f.md"]);
  assert.deepEqual(dateien(join(w.wurzel, P1)), ["e.md", "f.md"]);
  // Grenzen: genau 50 % (3 von 6) und mehr als 50 % bei weniger als 3 Dateien (2 von 3) werden angewendet
  const g = eingespielt(sechs);
  for (const rel of ["a.md", "b.md", "c.md"]) loesche(g.k1, P1, rel);
  assert.ok(!abgleich(g).warnungen.some((x) => /Massenlöschung/.test(x)));
  assert.deepEqual(dateien(memory(g.k2, P1)), ["d.md", "e.md", "f.md"]);
  const k = eingespielt({ "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" });
  loesche(k.k1, P1, "a.md"); loesche(k.k1, P1, "b.md");
  assert.ok(!abgleich(k).warnungen.some((x) => /Massenlöschung/.test(x)));
  assert.deepEqual(dateien(memory(k.k2, P1)), ["c.md"]);
});

test("Massenlöschung: vom Traum aufgelöste Konflikt-Kopien zählen nicht mit (bewusste, protokollierte Löschung)", () => {
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n" });
  const kopien = ["a.konflikt-claude-zwei.md", "a.konflikt-claude-zwei-2.md", "b.konflikt-claude-zwei.md"];
  for (const n of kopien) schreibeW(w, P1, n, "---\nstatus: offen\n---\nnoch zu prüfen\n");
  assert.equal(abgleich(w).ok, true);
  assert.equal(dateien(memory(w.k2, P1)).filter((n) => /konflikt/.test(n)).length, 3, "Kopien liegen in den Konten");
  for (const n of kopien) schreibeW(w, P1, n, "---\nstatus: aufgeloest\n---\nerledigt\n");     // der Traum hat sie aufgelöst
  const r = abgleich(w);
  assert.ok(r.ok && !r.warnungen.some((x) => /Massenlöschung/.test(x)), r.warnungen.join(" | "));
  for (const k of [w.k1, w.k2]) assert.deepEqual(dateien(memory(k, P1)), ["a.md", "b.md"]);
});

test("leseArgs: --erzwingen; CLI reicht es an den Abgleich durch", () => {
  assert.equal(leseArgs(["abgleichen", "--erzwingen"]).erzwingen, true);
  assert.equal(leseArgs(["abgleichen"]).erzwingen, false);
  const w = eingespielt({ "a.md": "A\n", "b.md": "B\n", "c.md": "C\n", "d.md": "D\n" });
  for (const rel of ["a.md", "b.md", "c.md"]) loesche(w.k1, P1, rel);
  const ohne = cli(w, ["abgleichen", "--projekt", P1, "--anwenden"]);
  assert.equal(ohne.status, 0, ohne.stderr);
  assert.match(ohne.stdout, /Massenlöschung — bitte prüfen: brain gedaechtnis abgleichen --projekt -work-projekt-a --erzwingen/);
  assert.deepEqual(dateien(memory(w.k2, P1)), ["a.md", "b.md", "c.md", "d.md"]);
  const mit = cli(w, ["abgleichen", "--projekt", P1, "--anwenden", "--erzwingen"]);
  assert.equal(mit.status, 0, mit.stderr);
  assert.deepEqual(dateien(memory(w.k2, P1)), ["d.md"]);
});

// ------------------------------------------------------------------------------------------ MEMORY.md: Änderungen an bestehenden Zeilen
const INDEX_C = "# M\n\n## Aktive Sessions\n- [A](a.md) — Status alt\n- [C](c.md) — c\n- [B](b.md) — b\n";
const mitC = { "MEMORY.md": INDEX_C, "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" };
const alleGleich = (w, p = P1) => { const t = liesW(w, p, "MEMORY.md"); assert.equal(liesK(w.k1, p, "MEMORY.md"), t); assert.equal(liesK(w.k2, p, "MEMORY.md"), t); return t; };

test("MEMORY.md: ändert ein Konto eine bestehende Index-Zeile und fügt das andere daneben eine Zeile ein, bleibt die Änderung erhalten (beide Richtungen, auch an „Aktive Sessions“-Zeilen)", () => {
  // Konto 2 ändert die C-Zeile, Konto 1 fügt direkt dahinter eine ein (Reviewer-Fall)
  const w = eingespielt(mitC);
  schreibe(w.k1, P1, "MEMORY.md", INDEX_C.replace("- [B](b.md) — b\n", "- [D](d.md) — d\n- [B](b.md) — b\n")); schreibe(w.k1, P1, "d.md", "D\n");
  schreibe(w.k2, P1, "MEMORY.md", INDEX_C.replace("— c\n", "— c AKTUALISIERT von Konto 2\n"));
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const t = alleGleich(w);
  assert.equal(t, "# M\n\n## Aktive Sessions\n- [A](a.md) — Status alt\n- [C](c.md) — c AKTUALISIERT von Konto 2\n- [D](d.md) — d\n- [B](b.md) — b\n");
  assert.deepEqual(r.plan.projekte[0].konflikte, [], "kein Konflikt: nur eine Seite hat die Zeile geändert");
  assert.equal(abgleich(w).nichtsZuTun, true);
  // umgekehrt: Konto 1 ändert, Konto 2 fügt unmittelbar vor der Zeile eine ein
  const v = eingespielt(mitC);
  schreibe(v.k1, P1, "MEMORY.md", INDEX_C.replace("— Status alt", "— Status NEU von Konto 1"));
  schreibe(v.k2, P1, "MEMORY.md", INDEX_C.replace("- [A](a.md) — Status alt\n", "- [E](e.md) — e\n- [A](a.md) — Status alt\n")); schreibe(v.k2, P1, "e.md", "E\n");
  abgleich(v);
  assert.equal(alleGleich(v), "# M\n\n## Aktive Sessions\n- [A](a.md) — Status NEU von Konto 1\n- [E](e.md) — e\n- [C](c.md) — c\n- [B](b.md) — b\n", "die Reihenfolge am Konflikt-Rand gibt der Union-Merge vor (Wurzelzeile zuerst) — nichts geht verloren");
  assert.equal(abgleich(v).nichtsZuTun, true);
  // Konto 2 schreibt die Zeile um und fügt zugleich oben eine neue Session ein (so arbeitet /handoff)
  const h = eingespielt(mitC);
  schreibe(h.k1, P1, "MEMORY.md", INDEX_C.replace("- [A](a.md)", "- [N](n.md) — neue Session\n- [A](a.md)")); schreibe(h.k1, P1, "n.md", "N\n");
  schreibe(h.k2, P1, "MEMORY.md", INDEX_C.replace("— b\n", "— b, nachgeführt\n"));
  abgleich(h);
  assert.equal(alleGleich(h), "# M\n\n## Aktive Sessions\n- [N](n.md) — neue Session\n- [A](a.md) — Status alt\n- [C](c.md) — c\n- [B](b.md) — b, nachgeführt\n");
});

test("MEMORY.md: dieselbe Zeile auf beiden Seiten verschieden geändert → die Wurzel behält ihre Fassung, die des Kontos liegt als Konflikt-Kopie daneben und steht in _konflikte.md (nie still verworfen)", () => {
  const w = eingespielt(mitC);
  schreibe(w.k1, P1, "MEMORY.md", INDEX_C.replace("— c\n", "— c, Fassung Konto 1\n"));
  schreibe(w.k2, P1, "MEMORY.md", INDEX_C.replace("— c\n", "— c, Fassung Konto 2\n").replace("- [B](b.md) — b\n", "- [B](b.md) — b\n- [F](f.md) — f\n")); schreibe(w.k2, P1, "f.md", "F\n");
  const r = abgleich(w);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const t = alleGleich(w);
  assert.ok(t.includes("c, Fassung Konto 1") && !t.includes("Fassung Konto 2"), t);
  assert.ok(t.includes("- [F](f.md) — f"), "die übrigen Änderungen von Konto 2 kommen an");
  assert.deepEqual(r.plan.projekte[0].konflikte, [{ datei: "MEMORY.md", kopie: "MEMORY.konflikt-claude-zwei.md", konto: "claude-zwei" }]);
  assert.match(liesW(w, P1, "MEMORY.konflikt-claude-zwei.md"), /c, Fassung Konto 2/);
  const eintraege = leseKonfliktEintraege(liesW(w, P1, "_konflikte.md"));
  assert.deepEqual(eintraege.map((e) => [e.konto, e.datei, e.kopie]), [["claude-zwei", "MEMORY.md", "MEMORY.konflikt-claude-zwei.md"]]);
  for (const k of [w.k1, w.k2]) assert.ok(existsSync(join(memory(k, P1), "MEMORY.konflikt-claude-zwei.md")), "die Kopie liegt in beiden Konten");
  assert.equal(abgleich(w).nichtsZuTun, true, "danach stabil");
});

test("bereinigeIndexBefund: mit Basis gewinnt die geänderte Konto-Zeile, wenn die Wurzel sie nicht angefasst hat; haben beide geändert, bleibt die Wurzel und die Konto-Zeile steht in „verloren“", () => {
  const basis = "## S\n- [C](c.md) — c\n- [B](b.md) — b\n";
  const wurzelNeueZeile = "## S\n- [C](c.md) — c\n- [D](d.md) — d\n- [B](b.md) — b\n";
  const union = "## S\n- [C](c.md) — c\n- [D](d.md) — d\n- [C](c.md) — c NEU\n- [B](b.md) — b\n";      // wie der --union-Merge bei benachbarten Änderungen aussieht
  const a = G.bereinigeIndexBefund(union, wurzelNeueZeile, basis);
  assert.equal(a.text, "## S\n- [C](c.md) — c NEU\n- [D](d.md) — d\n- [B](b.md) — b\n");
  assert.deepEqual(a.verloren, []);
  assert.equal(bereinigeIndex(union, wurzelNeueZeile, basis), a.text, "bereinigeIndex liefert denselben Text");
  const wurzelAuchGeaendert = "## S\n- [C](c.md) — c, Wurzel\n- [D](d.md) — d\n- [B](b.md) — b\n";
  const union2 = "## S\n- [C](c.md) — c, Wurzel\n- [D](d.md) — d\n- [C](c.md) — c NEU\n- [B](b.md) — b\n";
  const b = G.bereinigeIndexBefund(union2, wurzelAuchGeaendert, basis);
  assert.equal(b.text, wurzelAuchGeaendert);
  assert.deepEqual(b.verloren, ["- [C](c.md) — c NEU"]);
  // Zeile des Kontos unverändert (nur ein Merge-Artefakt): wird verworfen, ohne etwas zu verlieren
  const c = G.bereinigeIndexBefund("## S\n- [C](c.md) — c, Wurzel\n- [C](c.md) — c\n- [B](b.md) — b\n", "## S\n- [C](c.md) — c, Wurzel\n- [B](b.md) — b\n", basis);
  assert.equal(c.text, "## S\n- [C](c.md) — c, Wurzel\n- [B](b.md) — b\n"); assert.deepEqual(c.verloren, []);
  // ohne Basis (erster Lauf) ist eine abweichende Fassung nie „bekannt“: die Wurzel bleibt, die andere wird gemeldet
  const d = G.bereinigeIndexBefund("- [C](c.md) — eins\n- [C](c.md) — zwei\n", "- [C](c.md) — eins\n", null);
  assert.equal(d.text, "- [C](c.md) — eins\n"); assert.deepEqual(d.verloren, ["- [C](c.md) — zwei"]);
  // eingerückte Folgezeilen einer geänderten Zeile gehen ebenfalls nicht still verloren
  const e = G.bereinigeIndexBefund("- [C](c.md) — c\n- [C](c.md) — c NEU\n  neue Folgezeile\n", "- [C](c.md) — c\n", "- [C](c.md) — c\n");
  assert.equal(e.text, "- [C](c.md) — c NEU\n"); assert.deepEqual(e.verloren, ["  neue Folgezeile"]);
});

// ------------------------------------------------------------------------------------------ Sperre: Übernahme einer veralteten Sperre
const altMachen = (datei, minuten = 20) => { const t = new Date(Date.now() - minuten * 60 * 1000); utimesSync(datei, t, t); };

test("Sperre: eine veraltete Sperre wird per rename übernommen (kein unlink+neu-anlegen); Reste (<sperre>.alt-<pid>-<zeit>) werden aufgeräumt, frische bleiben", () => {
  const w = welt();
  const sperre = `${w.wurzel}.lock`;
  writeFileSync(sperre, "999999 alt\n"); altMachen(sperre);
  writeFileSync(`${sperre}.alt-4242-${Date.now() - 10 * 60 * 1000}`, "Rest eines Absturzes\n");                 // älter als eine Minute → weg
  writeFileSync(`${sperre}.alt-4243-${Date.now()}`, "gerade übernommen\n");                                         // frisch → bleibt (der andere räumt selbst auf)
  const datei = G.nimmSperre(w.wurzel, Date.now());
  assert.equal(datei, sperre, "Rückgabe: Pfad der Sperrdatei");
  assert.match(lies(sperre), new RegExp(`^${process.pid} `), "die Sperre gehört jetzt uns");
  const reste = readdirSync(dirname(sperre)).filter((n) => n.includes(".lock.alt-"));
  assert.equal(reste.length, 1, reste.join(", "));
  assert.match(reste[0], /\.alt-4243-/);
  G.gibSperre(datei);
  assert.ok(!existsSync(sperre));
  // eine frische Sperre wird nicht übernommen (und bleibt unberührt)
  writeFileSync(sperre, "999999 frisch\n");
  assert.throws(() => G.nimmSperre(w.wurzel, Date.now()), /anderen Lauf/);
  assert.equal(lies(sperre), "999999 frisch\n");
  assert.ok(!readdirSync(dirname(sperre)).some((n) => /\.lock\.alt-\d+-\d+$/.test(n) && !n.includes("alt-4243")), "kein Übernahme-Rest");
});

test("Sperre: uebernimmVeraltete räumt nur eine wirklich veraltete Sperre weg (Wache + erneute Prüfung); frische bleibt, fehlende → true, belegte Wache → false, alte Wache wird entfernt", () => {
  const w = welt();
  const sperre = `${w.wurzel}.lock`, wache = `${sperre}.uebernahme`;
  mkdirSync(dirname(sperre), { recursive: true });
  const reste = () => readdirSync(dirname(sperre)).filter((n) => n.includes(".alt-") || n.endsWith(".uebernahme"));
  writeFileSync(sperre, "4711 frisch\n");
  assert.equal(G.uebernimmVeraltete(sperre), false);
  assert.equal(lies(sperre), "4711 frisch\n", "eine frische Sperre bleibt unberührt");
  assert.deepEqual(reste(), [], "keine Wache, kein Rest");
  altMachen(sperre);
  writeFileSync(wache, "jemand anderes prüft gerade\n");                  // Wache belegt → nichts tun
  assert.equal(G.uebernimmVeraltete(sperre), false);
  assert.ok(existsSync(sperre) && existsSync(wache));
  altMachen(wache, 5);                                                      // Wache ist ein Rest eines Absturzes → wird entfernt, die Übernahme gelingt beim nächsten Versuch
  assert.equal(G.uebernimmVeraltete(sperre), false);
  assert.ok(!existsSync(wache));
  assert.equal(G.uebernimmVeraltete(sperre), true);
  assert.ok(!existsSync(sperre));
  assert.deepEqual(reste(), []);
  assert.equal(G.uebernimmVeraltete(sperre), true, "schon weg: anlegen darf jeder");
});

test("Sperre: übernehmen mehrere Prozesse gleichzeitig dieselbe veraltete Sperre, gewinnt genau einer", async () => {
  const w = welt();
  const sperre = `${w.wurzel}.lock`;
  const kind = `const { nimmSperre } = await import(${JSON.stringify(new URL("../gedaechtnis.mjs", import.meta.url).href)});
    const start = Number(process.argv[1]);
    while (Date.now() < start) {}
    try { nimmSperre(${JSON.stringify(w.wurzel)}, Date.now(), 0); console.log("OK"); } catch { console.log("BELEGT"); }
    await new Promise((r) => setTimeout(r, 300));`;                                                              // die Sperre wird nicht freigegeben
  for (let runde = 0; runde < 3; runde++) {
    rmSync(sperre, { force: true });
    writeFileSync(sperre, "999999 alt\n"); altMachen(sperre);
    const start = String(Date.now() + 1500);
    const ergebnisse = await Promise.all(Array.from({ length: 8 }, () => new Promise((fertig) => {
      let aus = "";
      const k = spawn(process.execPath, ["--input-type=module", "-e", kind, start], { stdio: ["ignore", "pipe", "ignore"], env: OHNE_GIT });
      k.stdout.on("data", (d) => { aus += d; });
      k.on("close", () => fertig(aus.trim()));
    })));
    assert.equal(ergebnisse.filter((x) => x === "OK").length, 1, `Runde ${runde}: ${ergebnisse.join(" ")}`);
  }
});

// ------------------------------------------------------------------------------------------ Zeitgrenzen für git und tar
// Fake-Programme, die bei bestimmten Aufrufen hängen (exec sleep: das Kind wird beim Timeout selbst beendet, kein Enkel hält die Pipe offen)
function hangendesGit(w, muster) {
  const f = join(w.home, "fake-git.sh");
  writeFileSync(f, `#!/bin/sh\ncase "$*" in\n  *${muster}*) exec sleep 8 ;;\nesac\nexec git "$@"\n`, { mode: 0o755 });
  return f;
}
const OHNE_WINDOWS = { skip: process.platform === "win32" };
const GIT_GRENZE = 3000;     // deutlich über einem normalen git-Aufruf (auch bei voller Last der ganzen Suite), deutlich unter dem Hängen des Fakes (8 s)

test("Zeitgrenzen: Standard git 60 s, tar 120 s", () => {
  assert.deepEqual(G.ZEIT_STANDARD, { git: 60_000, tar: 120_000 });
});

test("hängendes git (hash-object) → Zeitüberschreitung ist ein Projektfehler, die Sperre wird freigegeben, nichts ist halb verteilt, der nächste Lauf holt alles nach", OHNE_WINDOWS, () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  const t0 = Date.now();
  const r = abgleich(w, { gitCmd: hangendesGit(w, "hash-object"), zeitgrenzen: { git: GIT_GRENZE } });
  assert.ok(Date.now() - t0 < 7500, "nicht ausgesessen");
  assert.equal(r.ok, false);
  assert.ok(r.fehler.some((f) => /Zeitüberschreitung/.test(f) && f.includes(P1)), JSON.stringify(r.fehler));
  assert.ok(!existsSync(`${w.wurzel}.lock`), "Sperre frei");
  assert.ok(!existsSync(join(memory(w.k2, P1), "a.md")), "nichts halb verteilt");
  const danach = abgleich(w);
  assert.equal(danach.ok, true, JSON.stringify(danach.fehler));
  assert.equal(liesK(w.k2, P1, "a.md"), "A\n");
  assert.equal(abgleich(w).nichtsZuTun, true);
});

test("hängendes git (cat-file beim Rechnen) → Fehler nur für dieses Projekt, Trockenlauf wirft nicht; hängendes merge-file → Konflikt-Kopie statt Hängenbleiben", OHNE_WINDOWS, () => {
  const w = eingespielt({ "a.md": "1\n2\n3\n4\n5\n6\n7\n", "b.md": "B\n" });
  schreibe(w.k1, P1, "a.md", "EINS\n2\n3\n4\n5\n6\n7\n");
  schreibe(w.k2, P1, "a.md", "1\n2\n3\n4\n5\n6\nSIEBEN\n");
  schreibe(w.k1, P2, "n.md", "anderes Projekt\n");
  const t = trocken(w, { gitCmd: hangendesGit(w, "cat-file"), zeitgrenzen: { git: GIT_GRENZE } });
  assert.equal(t.ok, false);
  assert.ok(t.fehler.some((f) => /Zeitüberschreitung/.test(f) && f.includes(P1)), JSON.stringify(t.fehler));
  assert.ok(t.plan.projekte.some((p) => p.projekt === P2 && p.noetig), "das andere Projekt wird weiter geplant");
  const m = abgleich(w, { gitCmd: hangendesGit(w, "merge-file"), zeitgrenzen: { git: GIT_GRENZE } });
  assert.equal(m.ok, true, JSON.stringify(m.fehler));
  assert.equal(liesW(w, P1, "a.konflikt-claude-zwei.md"), "1\n2\n3\n4\n5\n6\nSIEBEN\n", "ohne Merge: die Konto-Fassung bleibt als Kopie erhalten");
});

test("hängendes tar (Sicherung) → „Sicherung fehlgeschlagen … Zeitüberschreitung — nichts geändert“, die Sperre wird freigegeben", OHNE_WINDOWS, () => {
  const w = welt();
  schreibe(w.k1, P1, "a.md", "A\n");
  const bin = join(w.home, "fake-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "tar"), "#!/bin/sh\nexec sleep 8\n", { mode: 0o755 });
  const pfadVorher = process.env.PATH;
  process.env.PATH = `${bin}:${pfadVorher}`;
  const vorher = abbild(w.k1);
  const t0 = Date.now();
  try { assert.throws(() => abgleich(w, { zeitgrenzen: { tar: 400 } }), /Sicherung fehlgeschlagen .*Zeitüberschreitung.*nichts geändert/); }
  finally { process.env.PATH = pfadVorher; }
  assert.ok(Date.now() - t0 < 6000, "nicht ausgesessen");
  assert.equal(abbild(w.k1), vorher);
  assert.ok(!existsSync(w.wurzel), "Wurzel nicht angelegt");
  assert.ok(!existsSync(`${w.wurzel}.lock`), "Sperre wieder frei");
  assert.equal(abgleich(w).ok, true, "danach läuft es wieder");
});

// ------------------------------------------------------------------------------------------ Sicherungen rotieren
test("Sicherungen werden rotiert: nach dem Anlegen bleiben die neuesten 30 UND alle, die jünger als 14 Tage sind — gelöscht wird nur, was beide Bedingungen verletzt; fremde Dateien bleiben", () => {
  const TAG = 24 * 60 * 60 * 1000, zwei = (n) => String(n).padStart(2, "0");
  // jung[i]: (i+1) Stunden alt; alt[i]: (20+i) Tage alt — alt[0] ist die neueste der alten
  const fuelle = (w, anzahlJung, anzahlAlt) => {
    mkdirSync(w.sicherungen, { recursive: true });
    const lege = (name, alter) => { const f = join(w.sicherungen, name); writeFileSync(f, "x"); const t = new Date(Date.now() - alter); utimesSync(f, t, t); return name; };
    const jung = Array.from({ length: anzahlJung }, (_, i) => lege(`2026100${i % 10}-1200${zwei(i)}.tgz`, (i + 1) * 60 * 60 * 1000));
    const alt = Array.from({ length: anzahlAlt }, (_, i) => lege(`2026030${i % 10}-1100${zwei(i)}-${i}.tgz`, (20 + i) * TAG));
    lege("notiz.tgz", 100 * TAG); lege("20260101-120000.tgz.teil", 100 * TAG);                       // gehören nicht zu den Sicherungen dieses Werkzeugs
    return { jung, alt };
  };
  const lauf = (w) => {
    schreibe(w.k1, P1, "a.md", "A\n");
    const r = abgleich(w);
    assert.equal(r.ok, true, JSON.stringify(r.fehler));
    assert.ok(r.sicherung, "es gab eine Sicherung");
    return { neu: basename(r.sicherung), bleibt: new Set(readdirSync(w.sicherungen)) };
  };
  // A: 45 Sicherungen, alle jünger als 14 Tage → nichts wird gelöscht, obwohl es mehr als 30 sind
  const a = welt(); const fa = fuelle(a, 45, 0);
  const ra = lauf(a);
  for (const n of fa.jung) assert.ok(ra.bleibt.has(n), `A: ${n} bleibt`);
  assert.ok(ra.bleibt.has(ra.neu));
  // B: 45 alte → die neue und die 29 neuesten alten bleiben (30), die 16 ältesten gehen
  const b = welt(); const fb = fuelle(b, 0, 45);
  const rb = lauf(b);
  assert.ok(rb.bleibt.has(rb.neu));
  fb.alt.forEach((n, i) => assert.equal(rb.bleibt.has(n), i < 29, `B: ${n} (Platz ${i})`));
  // C: 6 junge + 40 alte → die neue, die 6 jungen und die 23 neuesten alten bleiben (30)
  const c = welt(); const fc = fuelle(c, 6, 40);
  const rc = lauf(c);
  for (const n of fc.jung) assert.ok(rc.bleibt.has(n), `C: junge ${n} bleibt`);
  fc.alt.forEach((n, i) => assert.equal(rc.bleibt.has(n), i < 23, `C: ${n} (Platz ${i})`));
  // D: 35 junge + 5 alte → alle jungen bleiben (jünger als 14 Tage, auch jenseits der 30), die alten (weder unter den neuesten 30 noch jung) gehen
  const d = welt(); const fd = fuelle(d, 35, 5);
  const rd = lauf(d);
  for (const n of fd.jung) assert.ok(rd.bleibt.has(n), `D: junge ${n} bleibt`);
  for (const n of fd.alt) assert.ok(!rd.bleibt.has(n), `D: alte ${n} geht`);
  for (const [r, w] of [[ra, a], [rb, b], [rc, c], [rd, d]]) {
    assert.ok(r.bleibt.has("notiz.tgz") && r.bleibt.has("20260101-120000.tgz.teil"), "fremde Dateien bleiben");
    assert.ok(existsSync(join(w.sicherungen, r.neu)));
  }
});
