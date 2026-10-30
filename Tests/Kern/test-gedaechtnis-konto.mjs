// KI-Konten (docs/plaene/ki-konten.md) und gemeinsames Gedächtnis: Das Gedächtnis eines Projekts, das zu einem Vault gehört (Projekt-Schlüssel = Schlüssel des Vaults oder
// „<vault>-…“ darunter), wandert nur zwischen Konten, die den Vault mindestens lesen dürfen. Ein für den Vault gesperrtes Konto wird weder gelesen noch beschrieben noch mit
// verteilt; eine beschädigte oder gelöschte Kontenliste heißt: niemand nimmt teil; fehlt die Liste ganz ohne Spur, bleibt alles wie bisher; fremde Projekte gehen weiter an alle.
// Alles mit Fake-Konten in einem Temp-HOME, nie echte Nutzerorte; Kindprozesse mit baueTestUmgebung (nie ...process.env).
// Die Vaults dieser Tests liegen im Temp-Ordner, deren Projekt-Schlüssel der Abgleich als „temporär“ überspringt: darum der Testhaken schluesselVon (feste Schlüssel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, statSync, unlinkSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { baueTestUmgebung } from "./konto-hilfe.mjs";
import { gleicheAb, statusGedaechtnis, baueKontoPruefung, vaultSchluesselFormen, projektSchluessel, KONTO_NICHT_FREIGEGEBEN, leseBaum } from "../gedaechtnis.mjs";

process.env.BRAIN_TESTMODUS = "1";                                           // kontoStufe liest nur den übergebenen Support-Ordner, nie den echten des Rechners
const HIER = dirname(fileURLToPath(import.meta.url));
const KERN = join(HIER, "..");
const temp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const kennung = (p) => { const st = statSync(p); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; };

const VAULT_P = "-work-wissen";                                              // Projekt = Vault
const UNTER_P = "-work-wissen-unterordner";                                  // Projekt darunter
const NAH_P = "-work-wissenschaft";                                          // beginnt gleich, liegt aber nicht darunter
const FREMD_P = "-work-fremd";                                               // fremdes Projekt
const GEHEIM = "GEHEIMER-VAULT-INHALT-4711";
const vaultSchluessel = (pfad) => [VAULT_P];

// Welt: Temp-HOME mit Standardprofil (.claude), Konto A (.claude-a), Konto B (.claude-b), Support-Ordner mit vaults.json, ein Vault.
function welt({ liste = "ok", stufen = { a: "erweitert", b: "gesperrt", std: "gesperrt" }, ohneStandard = false } = {}) {
  const home = temp("gk-home-"), support = temp("gk-support-"), vault = temp("gk-vault-");
  writeFileSync(join(vault, "brain.config.json"), "{}");
  const profil = (n) => { const p = join(home, n); mkdirSync(join(p, "projects"), { recursive: true }); return realpathSync(p); };
  const std = profil(".claude"), a = profil(".claude-a"), b = profil(".claude-b");
  const wurzel = join(home, ".claude-gedaechtnis");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: vault, name: "V" }], aktiv: vault }));
  const schreibeListe = (s = stufen) => writeFileSync(join(support, "ki-konten.json"), JSON.stringify({ version: 1,
    konten: {
      k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "A", ordnerKennung: kennung(a) },
      k_bbbbbbbb: { programm: "claude", ordner: b, standard: false, name: "B", ordnerKennung: kennung(b) },
      k_cccccccc: { programm: "claude", ordner: std, standard: !ohneStandard, name: "Standard", ordnerKennung: kennung(std) },
    },
    vaults: { [vault]: { ordnerKennung: kennung(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: s.a, k_bbbbbbbb: s.b, k_cccccccc: s.std } } } }));
  if (liste === "ok") { schreibeListe(); writeFileSync(join(support, "ki-konten.angelegt"), ""); }
  else if (liste === "defekt") { writeFileSync(join(support, "ki-konten.json"), "{ das ist kein JSON"); writeFileSync(join(support, "ki-konten.angelegt"), ""); }
  else if (liste === "geloescht") { schreibeListe(); writeFileSync(join(support, "ki-konten.angelegt"), ""); unlinkSync(join(support, "ki-konten.json")); }
  // liste === "fehlt": weder Datei noch Spur
  return { home, support, vault, std, a, b, wurzel, schreibeListe, konten: (...k) => k.map((x) => ({ std, a, b })[x]) };
}
const memory = (k, p) => join(k, "projects", p, "memory");
const schreibe = (k, p, rel, inhalt) => { const f = join(memory(k, p), rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, inhalt); return f; };
const lies = (f) => readFileSync(f, "utf8");
const baum = (d, rel = "") => (existsSync(join(d, rel)) ? readdirSync(join(d, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${join(rel, e.name)}/`, ...baum(d, join(rel, e.name))] : [join(rel, e.name)])).sort() : []);
// Abbild mit Inhalt: unveränderte Konten müssen nach dem Lauf Byte für Byte so aussehen wie vorher
const abbild = (d, ausser = []) => baum(d).filter((r) => !ausser.some((p) => r.startsWith(`projects/${p}/`) || r === `projects/${p}/`)).map((r) => (r.endsWith("/") ? r : `${r}=${lies(join(d, r))}`)).join("\n");
const kp = (w, extra = {}) => ({ support: w.support, home: w.home, schluesselVon: vaultSchluessel, ...extra });
const lauf = (w, konten, extra = {}) => gleicheAb({ wurzel: w.wurzel, konten, anwenden: true, kontoPruefung: kp(w), ...extra });
// Alle vier Projekte mit eigenem Inhalt im Konto A (Quelle) und, falls gewünscht, auch in B
function fuelle(w, { inB = false } = {}) {
  for (const p of [VAULT_P, UNTER_P, NAH_P, FREMD_P]) {
    schreibe(w.a, p, "note.md", `# ${p}\n${[VAULT_P, UNTER_P].includes(p) ? GEHEIM : "offen"}-${p}\n`);
    if (inB) schreibe(w.b, p, "eigen-b.md", `# B ${p}\nnur in B ${p}\n`);
  }
}
const inWurzel = (w, p) => baum(join(w.wurzel, p)).filter((r) => !r.endsWith("/"));
const zeile = (erg, p, kontoName) => erg.plan.projekte.find((x) => x.projekt === p).konten.find((k) => k.konto === kontoName);

test("Schlüssel eines Vaults: wie angegeben UND realpath (Symlink), beide Formen; Wurzel-Schlüssel zählt nicht", () => {
  const echt = temp("gk-echt-"), basis = temp("gk-link-"), link = join(basis, "Mein Link");
  symlinkSync(echt, link);
  const formen = vaultSchluesselFormen(link).map((k) => k.toLowerCase());
  assert.ok(formen.includes(projektSchluessel(link).toLowerCase()), "wie angegeben");
  assert.ok(formen.includes(projektSchluessel(echt).toLowerCase()), "realpath");
  const w = welt();
  const pr = baueKontoPruefung({ support: w.support, home: w.home, vaults: [link] });
  for (const p of [projektSchluessel(link), projektSchluessel(echt), `${projektSchluessel(echt)}-unter`, projektSchluessel(echt).toUpperCase()]) {
    assert.ok(pr.vaultsFuer(p).length > 0, `${p} gehört zu einem Vault`);
  }
  assert.deepEqual(pr.vaultsFuer(`${projektSchluessel(echt)}x`).filter((v) => v === echt || v === link), [], "gleiches Präfix ohne „-“ liegt nicht darunter");
  assert.deepEqual(vaultSchluesselFormen("/"), [], "„/“ ergäbe den Schlüssel „-“: kein Vault");
});

for (const stufe of ["lesen", "posteingang", "erweitert"]) {
  test(`Konto A (${stufe}) nimmt teil, Konto B (gesperrt) nicht: Vault-Projekte nur in A und Wurzel, B bleibt unberührt, fremdes Projekt geht an beide`, () => {
    const w = welt({ stufen: { a: stufe, b: "gesperrt", std: "gesperrt" } });
    fuelle(w, { inB: true });
    const vorherB = abbild(w.b, [NAH_P, FREMD_P]);
    const erg = lauf(w, w.konten("a", "b"));
    assert.equal(erg.ok, true, erg.fehler.join("; "));
    // B: Byte für Byte unverändert (auch keine neuen Dateien, kein Konflikt-/Temp-Rest)
    assert.equal(abbild(w.b, [NAH_P, FREMD_P]), vorherB, "Vault-Projekte in Konto B sind unberührt");
    // Der Vault-Inhalt taucht nirgends in B auf (Dateien und Inhalte)
    const alleB = baum(w.b).filter((r) => !r.endsWith("/"));
    for (const r of alleB) assert.ok(!lies(join(w.b, r)).includes(GEHEIM), `${r} in B enthält keinen Vault-Inhalt`);
    for (const p of [VAULT_P, UNTER_P]) {
      assert.deepEqual(baum(memory(w.b, p)), ["eigen-b.md"], `${p}: B hat nur seine eigene Datei`);
      assert.ok(!existsSync(join(w.wurzel, ".abgleich", "claude-b", `${p}.json`)), `${p}: für B gibt es kein Manifest`);
      assert.ok(!existsSync(join(w.wurzel, p, "eigen-b.md")), `${p}: B hat nichts in die Wurzel gegeben`);
      assert.ok(inWurzel(w, p).includes("note.md"), `${p}: A hat in die Wurzel gegeben`);
    }
    // „nah“ (kein Vault-Projekt) und fremd: wie bisher an beide verteilt, beide Seiten tauschen aus
    for (const p of [NAH_P, FREMD_P]) {
      assert.ok(lies(join(memory(w.b, p), "note.md")).includes(p), `${p}: A-Datei ist in B angekommen`);
      assert.ok(lies(join(memory(w.a, p), "eigen-b.md")).includes("nur in B"), `${p}: B-Datei ist in A angekommen`);
    }
    // Plan: B ist ausgeschlossen mit neutralem Grund; A nicht
    const b = zeile(erg, VAULT_P, "claude-b"), a = zeile(erg, VAULT_P, "claude-a");
    assert.equal(b.ausgeschlossen, true); assert.equal(b.aktion, "uebersprungen"); assert.equal(b.grund, KONTO_NICHT_FREIGEGEBEN);
    assert.ok(!a.ausgeschlossen);
    assert.ok(!zeile(erg, FREMD_P, "claude-b").ausgeschlossen);
    // Der Grund nennt weder Vault-Pfad noch Vault-Name (auch nicht in den Hinweisen)
    const text = JSON.stringify({ w: erg.warnungen, f: erg.fehler, z: erg.zeile, g: [b.grund] });
    assert.ok(text.includes(KONTO_NICHT_FREIGEGEBEN), "Hinweis mit neutralem Grund");
    for (const verboten of [w.vault, VAULT_P, "wissen", GEHEIM]) assert.ok(!text.includes(verboten), `Hinweis nennt „${verboten}“ nicht`);
  });
}

test("Trockenlauf und Status: B nimmt nicht teil, ändern nichts; Status gilt Vault-Projekte nicht als „offen“ wegen des ausgeschlossenen Kontos", () => {
  const w = welt();
  fuelle(w, { inB: true });
  const vorher = [abbild(w.a), abbild(w.b)];
  const erg = gleicheAb({ wurzel: w.wurzel, konten: w.konten("a", "b"), kontoPruefung: kp(w) });
  assert.equal(zeile(erg, VAULT_P, "claude-b").ausgeschlossen, true);
  assert.deepEqual([abbild(w.a), abbild(w.b)], vorher, "Trockenlauf ändert nichts");
  assert.ok(!existsSync(w.wurzel), "Trockenlauf legt die Wurzel nicht an");
  lauf(w, w.konten("a", "b"));
  const s = statusGedaechtnis({ wurzel: w.wurzel, konten: w.konten("a", "b"), kontoPruefung: kp(w) });
  assert.equal(s.projekte.find((p) => p.projekt === VAULT_P).abgeglichen, true, "nach dem Lauf gilt das Vault-Projekt als abgeglichen");
  assert.equal(s.fehler.length, 0, s.fehler.join("; "));
});

test("Vault-Projekt, das nur in B liegt: B ist gesperrt, das Projekt wird gar nicht erst aufgenommen; Wurzel und A bleiben leer", () => {
  const w = welt();
  schreibe(w.b, UNTER_P, "nur-b.md", `${GEHEIM}\n`);
  const erg = lauf(w, w.konten("a", "b"));
  assert.equal(erg.ok, true);
  assert.ok(!existsSync(join(w.wurzel, UNTER_P)), "nichts in der Wurzel");
  assert.ok(!existsSync(join(w.a, "projects", UNTER_P)), "nichts in A");
  assert.deepEqual(baum(memory(w.b, UNTER_P)), ["nur-b.md"], "B unberührt");
});

test("Beide Konten freigegeben: die Vault-Projekte werden an beide verteilt; Rücknahme der Freigabe stoppt es sofort", () => {
  const w = welt({ stufen: { a: "erweitert", b: "lesen", std: "gesperrt" } });
  fuelle(w);
  assert.equal(lauf(w, w.konten("a", "b")).ok, true);
  assert.ok(lies(join(memory(w.b, VAULT_P), "note.md")).includes(GEHEIM), "B darf lesen und bekommt das Gedächtnis");
  assert.equal(zeile(gleicheAb({ wurzel: w.wurzel, konten: w.konten("a", "b"), kontoPruefung: kp(w) }), VAULT_P, "claude-b").ausgeschlossen, undefined);
  // B wird gesperrt; A schreibt neu → B bekommt es nicht mehr
  w.schreibeListe({ a: "erweitert", b: "gesperrt", std: "gesperrt" });
  schreibe(w.a, VAULT_P, "neu.md", "nach der Sperre\n");
  const vorherB = abbild(w.b);
  lauf(w, w.konten("a", "b"));
  assert.equal(abbild(w.b), vorherB, "nach der Sperre bekommt B nichts mehr");
  assert.ok(inWurzel(w, VAULT_P).includes("neu.md"), "A arbeitet weiter");
});

for (const liste of ["defekt", "geloescht"]) {
  test(`${liste === "defekt" ? "Beschädigte" : "Gelöschte (Spur bleibt)"} Kontenliste: kein Konto nimmt an Vault-Projekten teil, fremde Projekte gehen weiter an alle`, () => {
    const w = welt({ liste });
    fuelle(w, { inB: true });
    const vorher = abbild(w.b, [FREMD_P, NAH_P]);
    const erg = lauf(w, w.konten("a", "b"));
    assert.equal(erg.ok, true, erg.fehler.join("; "));
    assert.equal(abbild(w.b, [FREMD_P, NAH_P]), vorher, "B: Vault-Projekte unverändert");
    for (const p of [VAULT_P, UNTER_P]) {
      assert.deepEqual(baum(memory(w.b, p)), ["eigen-b.md"], `${p}: B unverändert`);
      assert.ok(!existsSync(join(w.wurzel, p)), `${p}: auch A hat nichts in die Wurzel gegeben`);
      assert.ok(!existsSync(join(w.a, "projects", p, "memory", "eigen-b.md")), `${p}: nichts aus B in A`);
      assert.equal(erg.plan.projekte.find((x) => x.projekt === p), undefined, `${p}: kein Konto nimmt teil, das Projekt kommt im Plan nicht vor`);
    }
    assert.ok(erg.warnungen.some((x) => x.includes(KONTO_NICHT_FREIGEGEBEN) && x.includes("claude-a") && x.includes("claude-b")), "neutraler Hinweis");
    assert.ok(lies(join(memory(w.b, FREMD_P), "note.md")).includes(FREMD_P), "fremdes Projekt: weiter an B");
    assert.ok(lies(join(memory(w.a, NAH_P), "eigen-b.md")).includes("nur in B"), "„nah“-Projekt: weiter an A");
  });
}

test("Liste fehlt ganz, ohne jede Spur: bisheriges Verhalten (Übergang vor dem ersten Start der App) — alles wird an alle verteilt", () => {
  const w = welt({ liste: "fehlt" });
  fuelle(w, { inB: true });
  const erg = lauf(w, w.konten("a", "b"));
  assert.equal(erg.ok, true, erg.fehler.join("; "));
  for (const p of [VAULT_P, UNTER_P, NAH_P, FREMD_P]) {
    assert.ok(lies(join(memory(w.b, p), "note.md")).includes(p), `${p}: in B angekommen`);
    assert.ok(lies(join(memory(w.a, p), "eigen-b.md")).includes("nur in B"), `${p}: in A angekommen`);
    assert.ok(!zeile(erg, p, "claude-b").ausgeschlossen);
  }
});

test("Ein Projekt, das keinem Vault entspricht, bleibt wie bisher — auch wenn Vault und Liste nicht lesbar sind (kein Vault bekannt)", () => {
  const w = welt({ liste: "defekt" });
  writeFileSync(join(w.support, "vaults.json"), "kaputt");                    // auch die Vaultliste ist defekt: es ist kein Vault bekannt
  fuelle(w, { inB: true });
  const erg = lauf(w, w.konten("a", "b"), { kontoPruefung: kp(w) });
  assert.equal(erg.ok, true);
  assert.ok(lies(join(memory(w.b, VAULT_P), "note.md")).includes(VAULT_P), "ohne bekannten Vault kein Ausschluss (Altverhalten)");
});

test("Standardprofil ~/.claude: gilt als Standard (mit und ohne CLAUDE_CONFIG_DIR); freigegeben nimmt es teil, gesperrt nicht", () => {
  // Standardprofil erweitert, B gesperrt: das Standardprofil nimmt teil, B nicht
  let w = welt({ stufen: { a: "gesperrt", b: "gesperrt", std: "erweitert" } });
  schreibe(w.std, VAULT_P, "note.md", `${GEHEIM}\n`);
  schreibe(w.b, VAULT_P, "eigen-b.md", "nur B\n");
  schreibe(w.b, FREMD_P, "eigen-b.md", "nur B fremd\n");
  schreibe(w.std, FREMD_P, "note.md", "Std fremd\n");
  const vorherB = abbild(w.b, [FREMD_P]);
  let erg = lauf(w, w.konten("std", "b"));
  assert.equal(erg.ok, true, erg.fehler.join("; "));
  assert.ok(!zeile(erg, VAULT_P, "claude").ausgeschlossen && zeile(erg, VAULT_P, "claude-b").ausgeschlossen);
  assert.ok(inWurzel(w, VAULT_P).includes("note.md"), "Standardprofil gibt in die Wurzel");
  assert.ok(!inWurzel(w, VAULT_P).includes("eigen-b.md"), "B nicht");
  assert.equal(abbild(w.b, [FREMD_P]), vorherB, "B: Vault-Projekt unverändert");
  assert.ok(existsSync(join(memory(w.std, FREMD_P), "eigen-b.md")), "fremdes Projekt: Standardprofil und B tauschen aus");

  // Standardprofil gesperrt: nimmt nicht teil, obwohl es das Standardkonto ist
  w = welt({ stufen: { a: "gesperrt", b: "erweitert", std: "gesperrt" } });
  schreibe(w.std, VAULT_P, "std.md", "Std\n");
  schreibe(w.b, VAULT_P, "note.md", `${GEHEIM}\n`);
  const vorherStd = abbild(w.std);
  erg = lauf(w, w.konten("std", "b"));
  assert.equal(abbild(w.std), vorherStd, "gesperrtes Standardprofil bleibt unberührt");
  assert.ok(inWurzel(w, VAULT_P).includes("note.md") && !inWurzel(w, VAULT_P).includes("std.md"));
});

test("Standardprofil ohne Standard-Kennzeichen in der Liste: ohne CLAUDE_CONFIG_DIR nicht eindeutig → das strengere Ergebnis gilt (fail-closed)", () => {
  const w = welt({ stufen: { a: "gesperrt", b: "gesperrt", std: "erweitert" }, ohneStandard: true });
  schreibe(w.std, VAULT_P, "std.md", "Std\n");
  schreibe(w.a, VAULT_P, "a.md", "A\n");
  const vorher = abbild(w.std);
  const erg = lauf(w, w.konten("std", "a"));
  assert.equal(abbild(w.std), vorher, "Standardprofil nimmt nicht teil");
  assert.equal(erg.plan.projekte.find((x) => x.projekt === VAULT_P), undefined, "niemand nimmt teil");
  assert.ok(erg.warnungen.some((x) => x.includes("claude")), "Hinweis nennt das Konto");
});

test("Unbekanntes Konto (nicht in der Liste) und Vault ohne Eintrag: gesperrt (fail-closed)", () => {
  const w = welt();
  const fremdesKonto = join(w.home, ".claude-fremd"); mkdirSync(join(fremdesKonto, "projects"), { recursive: true });
  const pr = baueKontoPruefung({ support: w.support, home: w.home, schluesselVon: vaultSchluessel });
  assert.equal(pr.gesperrt(VAULT_P, fremdesKonto), true, "Konto unbekannt");
  assert.equal(pr.gesperrt(VAULT_P, w.a), false);
  assert.equal(pr.gesperrt(VAULT_P, w.b), true);
  assert.equal(pr.gesperrt(FREMD_P, fremdesKonto), false, "fremdes Projekt: nie ausgeschlossen");
});

test("CLI in eigener Kindumgebung (baueTestUmgebung): beschädigte Liste, fremdes Projekt wird weiter an alle verteilt", () => {
  const w = welt({ liste: "defekt" });
  writeFileSync(join(w.vault, "brain.config.json"), JSON.stringify({ automatik: { gedaechtnisWurzel: w.wurzel, gedaechtnisKonten: [w.a, w.b] } }));
  schreibe(w.a, FREMD_P, "note.md", "fremd A\n");
  schreibe(w.b, FREMD_P, "eigen-b.md", "fremd B\n");
  const env = baueTestUmgebung({ HOME: w.home, USERPROFILE: w.home, BRAIN_APP_SUPPORT: w.support, KORTEX_VAULT_VERTRAUT: "alle" });
  const r = spawnSync(process.execPath, [join(KERN, "gedaechtnis.mjs"), w.vault, "abgleichen", "--anwenden", "--json"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(join(memory(w.a, FREMD_P), "eigen-b.md")) && existsSync(join(memory(w.b, FREMD_P), "note.md")), "fremdes Projekt gleicht aus");
  assert.ok(!/ausgeschlossen":true/.test(r.stdout), "kein Konto ausgeschlossen (kein Vault-Projekt)");
});
