// Tests für die Vault-Verwaltung (gemeinsam/vaults.mjs, gemeinsam/vorlage.mjs) — alles in Wegwerf-Ordnern in os.tmpdir().
// Hermetisch: eigenes Home (Git liest keine echte ~/.gitconfig), eigener Support-Ordner (hilfe.mjs), kein Netzwerk.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync, mkdirSync, rmSync, chmodSync, lstatSync } from "node:fs";
import { join, basename } from "node:path";
import { userInfo } from "node:os";
import { execFileSync } from "node:child_process";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

// GANZ OBEN, vor dem Laden der Module: Node liest $HOME bei jedem os.homedir()-Aufruf, Git ebenso.
const HOME = tmp("brain-home-");
process.env.HOME = HOME;
delete process.env.XDG_CONFIG_HOME;
delete process.env.GIT_CONFIG_GLOBAL;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const {
  leseVaults, aktiverVaultPfad, registriere, waehleAktiv, entferne, standardOrdner, pruefeVaultPfad,
  neuesVault, oeffneOrdner, klone, PALETTE, HttpFehler,
} = await import(pfad("gemeinsam", "vaults.mjs"));
const { pruefeText } = await import(pfad("gemeinsam", "pruefung.mjs"));
const { vorlageDateien, GITIGNORE } = await import(pfad("gemeinsam", "vorlage.mjs"));

const SUPPORT = () => process.env.BRAIN_APP_SUPPORT;
const HEUTE = "2026-10-24";
const OPT = { heute: HEUTE };
const LEER = { vaults: [], aktiv: null };

beforeEach(() => { for (const f of ["vaults.json", "vaults.json.defekt", "config.json"]) rmSync(join(SUPPORT(), f), { force: true }); });

const wirft = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const wirftAsync = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const verfolgt = (d) => g(d, "ls-files").trim().split("\n").filter(Boolean).sort();
// Alle Dateien samt Inhalt (zum Vergleich „nichts verändert“).
function momentaufnahme(d, rel = "") {
  const aus = {};
  for (const n of readdirSync(join(d, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (lstatSync(join(d, r)).isDirectory()) { aus[r + "/"] = null; Object.assign(aus, momentaufnahme(d, r)); } else aus[r] = readFileSync(join(d, r), "utf8");
  }
  return aus;
}
const ohneGit = async (fn) => { const alt = process.env.PATH; process.env.PATH = "/nonexistent"; try { return await fn(); } finally { process.env.PATH = alt; } };
// Attrappe für `git clone` (alles andere geht an das echte Git): zum Prüfen von Abbruch und Zeitlimit.
function attrappe(klonSkript) {
  const dir = tmp("brain-fakegit-");
  const echtes = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "git"), `#!/bin/sh\ncase " $* " in *" clone "*) ${klonSkript} ;; esac\nexec "${echtes}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  return dir;
}
const mitPfad = async (dir, fn) => { const alt = process.env.PATH; process.env.PATH = `${dir}:${alt}`; try { return await fn(); } finally { process.env.PATH = alt; } };
function bareMitInhalt() {
  const bare = tmp("brain-bare-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const w = repo();
  schreibe(w, "wissen.md", "# Wissen\n");
  g(w, "add", "--", "wissen.md"); g(w, "commit", "-q", "-m", "Wissen");
  g(w, "remote", "add", "origin", bare); g(w, "push", "-q", "origin", "main");
  return bare;
}

// ---------------------------------------------------------------- Liste

test("Liste: ohne vaults.json und config.json leer — es wird nichts geschrieben", () => {
  assert.deepEqual(leseVaults(), LEER);
  assert.equal(existsSync(join(SUPPORT(), "vaults.json")), false);
  assert.equal(aktiverVaultPfad(), null);
});

test("Liste: Übernahme aus config.json — vaults.json entsteht, config.json bleibt unberührt", () => {
  const d = tmp("brain-alt-");
  const cfg = JSON.stringify({ vault: d });
  writeFileSync(join(SUPPORT(), "config.json"), cfg);
  const l = leseVaults();
  assert.equal(l.aktiv, d);
  assert.deepEqual(l.vaults, [{ name: basename(d), pfad: d, farbe: PALETTE[0] }]);
  assert.deepEqual(JSON.parse(readFileSync(join(SUPPORT(), "vaults.json"), "utf8")), { vaults: l.vaults, aktiv: d });
  assert.equal(readFileSync(join(SUPPORT(), "config.json"), "utf8"), cfg);
  assert.equal(aktiverVaultPfad(), d);
  // ab jetzt ist vaults.json maßgeblich: ein anderer Eintrag in config.json ändert nichts
  writeFileSync(join(SUPPORT(), "config.json"), JSON.stringify({ vault: tmp() }));
  assert.equal(leseVaults().aktiv, d);
});

test("Liste: config.json ohne brauchbaren Vault (fehlender Ordner, relativ, Müll) wird nicht übernommen", () => {
  for (const roh of [JSON.stringify({ vault: join(tmp(), "weg") }), JSON.stringify({ vault: "relativ/pfad" }), JSON.stringify({ vault: 5 }), "kein json", "[]"]) {
    writeFileSync(join(SUPPORT(), "config.json"), roh);
    assert.deepEqual(leseVaults(), LEER, roh);
    assert.equal(existsSync(join(SUPPORT(), "vaults.json")), false);
  }
  const datei = join(tmp(), "datei.md"); writeFileSync(datei, "x");
  writeFileSync(join(SUPPORT(), "config.json"), JSON.stringify({ vault: datei }));
  assert.deepEqual(leseVaults(), LEER, "eine Datei ist kein Ordner");
});

test("Liste: defekte vaults.json zählt als leer, wird beim Lesen nie überschrieben, beim Schreiben vorher gesichert", () => {
  const kaputt = "{ das ist kein json";
  writeFileSync(join(SUPPORT(), "vaults.json"), kaputt);
  assert.deepEqual(leseVaults(), LEER);
  assert.equal(aktiverVaultPfad(), null);
  assert.equal(readFileSync(join(SUPPORT(), "vaults.json"), "utf8"), kaputt);
  assert.equal(existsSync(join(SUPPORT(), "vaults.json.defekt")), false);
  const d = tmp();
  registriere(d);
  assert.equal(readFileSync(join(SUPPORT(), "vaults.json.defekt"), "utf8"), kaputt);
  assert.deepEqual(leseVaults().vaults.map((v) => v.pfad), [d]);
  // gültiges JSON in falscher Form ist ebenfalls defekt
  for (const roh of ["[]", "\"x\"", "null", "5", "{\"vaults\": 5}"]) {
    rmSync(join(SUPPORT(), "vaults.json.defekt"), { force: true });
    writeFileSync(join(SUPPORT(), "vaults.json"), roh);
    assert.deepEqual(leseVaults(), LEER, roh);
    assert.equal(readFileSync(join(SUPPORT(), "vaults.json"), "utf8"), roh, "beim Lesen unverändert");
  }
});

test("Liste: kaputte Einträge werden übersprungen, fehlende Namen und Farben ergänzt, Doppelte entfernt", () => {
  const d = tmp(), e = tmp();
  writeFileSync(join(SUPPORT(), "vaults.json"), JSON.stringify({ vaults: [{ pfad: "relativ" }, 5, null, { name: "  ", pfad: d, farbe: "rot" }, { name: "Nochmal", pfad: d + "/" }, { name: "E", pfad: e, farbe: "#112233" }], aktiv: e }));
  const l = leseVaults();
  assert.deepEqual(l.vaults, [{ name: basename(d), pfad: d, farbe: PALETTE[0] }, { name: "E", pfad: e, farbe: "#112233" }]);
  assert.equal(l.aktiv, e);
});

test("Liste: Schreiben ist atomar (keine Reste), legt den Support-Ordner an, opt.support wird frisch gelesen", () => {
  registriere(tmp());
  assert.deepEqual(readdirSync(SUPPORT()).filter((n) => n.includes(".tmp")), []);
  const eigener = join(tmp("brain-sup-"), "neu", "support");
  const d = tmp();
  registriere(d, { support: eigener });
  assert.ok(existsSync(join(eigener, "vaults.json")));
  assert.deepEqual(leseVaults({ support: eigener }).vaults.map((v) => v.pfad), [d]);
  assert.equal(leseVaults().vaults.length, 1, "der Standard-Support-Ordner blieb unberührt");
});

test("aktiverVaultPfad: nur bei vorhandenem Ordner, wirft nie", () => {
  const d = tmp();
  registriere(d); waehleAktiv(d);
  assert.equal(aktiverVaultPfad(), d);
  rmSync(d, { recursive: true });
  assert.equal(aktiverVaultPfad(), null);
  for (const opt of [{ support: 5 }, { support: join(tmp(), "gibt", "es", "nicht") }, null, undefined, { home: {} }]) assert.equal(aktiverVaultPfad(opt), null);
});

// ---------------------------------------------------------------- registrieren, wählen, entfernen

test("registriere: idempotent über den echten Pfad, Name nur auf Wunsch, macht nicht aktiv", () => {
  const d = tmp("brain-v-");
  const r1 = registriere(d, OPT);
  assert.deepEqual(r1.eintrag, { name: basename(d), pfad: d, farbe: PALETTE[0] });
  assert.equal(r1.liste.aktiv, null);
  const link = join(tmp("brain-l-"), "verweis");
  symlinkSync(d, link);
  assert.deepEqual(registriere(link + "/").eintrag, r1.eintrag, "Symlink + Schrägstrich");
  assert.equal(registriere(join(d, "..", basename(d))).liste.vaults.length, 1, "mit ..");
  const gross = d.toUpperCase(); // APFS unterscheidet Groß/klein nicht: derselbe Ordner, also derselbe Vault
  if (existsSync(gross)) { assert.equal(registriere(gross).liste.vaults.length, 1); assert.equal(registriere(gross).eintrag.pfad, d, "gespeichert wird die echte Schreibweise"); }
  assert.equal(registriere(d, { name: "  Mein Vault " }).eintrag.name, "Mein Vault");
  assert.equal(registriere(d).eintrag.name, "Mein Vault", "ohne name bleibt er");
  assert.equal(leseVaults().vaults[0].name, "Mein Vault");
  assert.equal(registriere(d, { name: "x".repeat(80) }).eintrag.name.length, 80);
  for (const name of ["   ", "x".repeat(81), 5, "a\nb"]) assert.equal(wirft(() => registriere(d, { name })).status, 400, String(name));
  assert.equal(leseVaults().vaults.length, 1);
});

test("registriere: noch nicht vorhandener Ordner geht (es wird nichts angelegt), Datei und verbotene Orte nicht", () => {
  const ziel = join(tmp(), "kommt", "noch");
  assert.equal(registriere(ziel).eintrag.pfad, ziel);
  assert.equal(existsSync(ziel), false);
  assert.equal(wirft(() => registriere("/System")).status, 403);
});

test("Farben: erste unbenutzte der Palette, danach reihum; frei gewordene Farbe zuerst", () => {
  assert.deepEqual(PALETTE, ["#5B8DEF", "#E5734F", "#4FA877", "#B07CD8", "#D9A441", "#3FA7B5", "#D6638A", "#7C8798"]);
  const ordner = Array.from({ length: 10 }, () => tmp("brain-f-"));
  const farben = ordner.map((d) => registriere(d).eintrag.farbe);
  assert.deepEqual(farben.slice(0, 8), PALETTE);
  assert.equal(farben[8], PALETTE[0]);
  assert.equal(farben[9], PALETTE[1]);
  entferne(ordner[2]);
  assert.equal(registriere(tmp()).eintrag.farbe, PALETTE[2]);
});

test("waehleAktiv und entferne: aktiv wandert, unbekannt → 404, weg → 409, Dateien bleiben", () => {
  const [a, b, c] = [tmp(), tmp(), tmp()];
  for (const d of [a, b, c]) registriere(d);
  assert.equal(leseVaults().aktiv, null);
  assert.equal(waehleAktiv(b).aktiv, b);
  assert.equal(leseVaults().aktiv, b);
  assert.equal(wirft(() => waehleAktiv(tmp())).status, 404, "existiert, ist aber nicht registriert");
  assert.equal(wirft(() => waehleAktiv(join(tmp(), "nie"))).status, 404);
  assert.equal(wirft(() => waehleAktiv("")).status, 400);
  assert.equal(wirft(() => waehleAktiv(undefined)).status, 400);
  rmSync(c, { recursive: true });
  const weg = wirft(() => waehleAktiv(c));
  assert.equal(weg.status, 409); assert.match(weg.message, /nicht mehr da/);
  assert.equal(leseVaults().aktiv, b, "bei Fehler bleibt alles wie es war");

  schreibe(b, "bleibt.md", "# bleibt\n");
  const l = entferne(b);
  assert.deepEqual(l.vaults.map((v) => v.pfad), [a, c]);
  assert.equal(l.aktiv, a, "der erste verbleibende wird aktiv");
  assert.equal(readFileSync(join(b, "bleibt.md"), "utf8"), "# bleibt\n", "Dateien werden nie gelöscht");
  assert.equal(entferne(c).aktiv, a, "ein nicht aktiver Vault ändert aktiv nicht");
  assert.equal(entferne(a).aktiv, null);
  assert.deepEqual(leseVaults(), LEER);
  assert.equal(wirft(() => entferne(a)).status, 404);
  assert.equal(wirft(() => entferne(42)).status, 400);
});

test("entferne: ein alter config.json-Eintrag kommt danach nicht wieder", () => {
  const d = tmp();
  writeFileSync(join(SUPPORT(), "config.json"), JSON.stringify({ vault: d }));
  assert.equal(leseVaults().aktiv, d);
  assert.deepEqual(entferne(d), LEER);
  assert.deepEqual(leseVaults(), LEER);
  assert.equal(aktiverVaultPfad(), null);
});

test("Wahl und Entfernen finden den Vault auch über ~, Symlink und andere Schreibweise", () => {
  const d = join(HOME, "Notizen"); mkdirSync(d);
  registriere(d);
  const link = join(tmp(), "ln"); symlinkSync(d, link);
  assert.equal(waehleAktiv("~/Notizen").aktiv, d);
  assert.equal(waehleAktiv(link).aktiv, d);
  assert.deepEqual(entferne(d + "/./").vaults, []);
});

// ---------------------------------------------------------------- Pfadregeln

test("Pfadregeln: verbotene Orte → 403", () => {
  const t = tmp("brain-p-");
  const verboten = [
    "/", "/Users", HOME, "~", "~/", "/Volumes", "/System", "/System/Library/Foo", "/system/library", "/USERS", "/bin", "/sbin", "/usr/local/foo",
    "/etc", "/private/etc/ssh", "/dev", "/Library", "/Library/Application Support/X", "/Applications", "/Applications/Foo", "/cores",
    "/opt/homebrew", "/private", "/private/var", "/var", "/private/var/db", "/var/db/x", join(HOME, "Library"), join(HOME, "Library", "Caches", "x"),
    SUPPORT(), join(SUPPORT(), "unter"), join(HOME, ".ssh"), join(HOME, ".config", "x"), join(HOME, "Dokumente", ".versteckt", "x"),
    join(t, "proj", ".git", "x"), join(t, "proj", ".GIT"), join(t, "node_modules", "x"), join(t, "Node_Modules"),
    join(t, "Programm.app"), join(t, "Programm.APP", "Contents"),
  ];
  for (const p of verboten) assert.equal(wirft(() => pruefeVaultPfad(p, { vaults: [] })).status, 403, p);
});

test("Pfadregeln: erlaubt sind tmpdir, Ordner unter /Volumes, iCloud/Dropbox in Library, versteckte Ordner außerhalb von Home", () => {
  const t = tmp("brain-p2-");
  const ok = [
    t, join(t, "neu", "tief"), join(HOME, "Brain"), join(HOME, "Dokumente", "Notizen"),
    join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs", "Brain"), join(HOME, "Library", "CloudStorage", "Dropbox", "Brain"),
    join(t, ".versteckt-ausserhalb-von-home"), join(t, "mein.git"), "/Volumes/Platte/Brain",
  ];
  for (const p of ok) assert.equal(pruefeVaultPfad(p, { vaults: [] }), p, p);
});

test("Pfadregeln: Symlinks werden aufgelöst — ein Verweis nach /etc oder ~/.ssh ist verboten", () => {
  const t = tmp("brain-p3-");
  symlinkSync("/etc", join(t, "etc-link"));
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "etc-link"), { vaults: [] })).status, 403);
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "etc-link", "neu"), { vaults: [] })).status, 403);
  mkdirSync(join(HOME, ".ssh"), { recursive: true });
  symlinkSync(join(HOME, ".ssh"), join(t, "ssh-link"));
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "ssh-link"), { vaults: [] })).status, 403);
  symlinkSync(HOME, join(t, "home-link"));
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "home-link"), { vaults: [] })).status, 403, "auch das Home-Verzeichnis über einen Verweis");
  const gut = tmp("brain-gut-");
  symlinkSync(gut, join(t, "gut-link"));
  assert.equal(pruefeVaultPfad(join(t, "gut-link"), { vaults: [] }), gut, "ein guter Verweis wird zum echten Pfad");
  symlinkSync(join(t, "gibts-nicht"), join(t, "kaputt"));
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "kaputt"), { vaults: [] })).status, 409, "kaputter Verweis");
});

test("Pfadregeln: nicht innerhalb eines anderen Vaults und kein Ordner, der einen Vault enthält (409 mit Namen)", () => {
  const basis = tmp("brain-w-");
  const a = join(basis, "a", "tief");
  mkdirSync(a, { recursive: true });
  registriere(a, { name: "Alpha" });
  const liste = leseVaults().vaults;
  let e = wirft(() => pruefeVaultPfad(join(a, "unter"), { vaults: liste }));
  assert.equal(e.status, 409); assert.match(e.message, /Alpha/);
  e = wirft(() => pruefeVaultPfad(join(basis, "a"), { vaults: liste }));
  assert.equal(e.status, 409); assert.match(e.message, /Alpha/);
  assert.equal(pruefeVaultPfad(a, { vaults: liste }), a, "derselbe Pfad ist erlaubt (Idempotenz)");
  assert.equal(pruefeVaultPfad(join(basis, "b"), { vaults: liste }), join(basis, "b"), "Geschwister sind erlaubt");
  assert.equal(wirft(() => pruefeVaultPfad(join(a, "x"))).status, 409, "ohne vaults wird die Liste gelesen");
  assert.equal(wirft(() => registriere(join(a, "x"))).status, 409);
  assert.equal(wirft(() => registriere(join(basis, "a"))).status, 409);
});

test("Pfadregeln: ~ wird zum Home; relativ und Unsinn → 400; ../ und // werden bereinigt; Datei statt Ordner → 400", () => {
  assert.equal(pruefeVaultPfad("~/Brain", { vaults: [] }), join(HOME, "Brain"));
  assert.equal(pruefeVaultPfad("~/Dokumente/Notizen", { vaults: [] }), join(HOME, "Dokumente", "Notizen"));
  for (const p of ["Brain", "./Brain", "../x", "~root/x", "  ", "", undefined, null, 5, {}, "a\0b", "/tmp/a\nb", "/" + "x".repeat(1000)]) {
    assert.equal(wirft(() => pruefeVaultPfad(p, { vaults: [] })).status, 400, String(p).slice(0, 20));
  }
  assert.equal(wirft(() => pruefeVaultPfad("Brain", { vaults: [] })).message, "Bitte einen vollständigen Ordnerpfad angeben");
  const t = tmp("brain-p4-");
  assert.equal(pruefeVaultPfad(`${t}//a/../b/`, { vaults: [] }), join(t, "b"));
  assert.equal(pruefeVaultPfad(`  ${t}  `, { vaults: [] }), t, "Leerzeichen am Rand werden entfernt");
  schreibe(t, "datei.md", "x");
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "datei.md"), { vaults: [] })).status, 400);
  assert.equal(wirft(() => pruefeVaultPfad(join(t, "datei.md", "unter"), { vaults: [] })).status, 400);
});

test("Pfadregeln: opt.home und opt.support gelten bei jedem Aufruf frisch", () => {
  const anderes = tmp("brain-home2-");
  assert.equal(pruefeVaultPfad("~/X", { vaults: [], home: anderes }), join(anderes, "X"));
  assert.equal(wirft(() => pruefeVaultPfad(anderes, { vaults: [], home: anderes })).status, 403);
  assert.equal(wirft(() => pruefeVaultPfad(join(anderes, ".config"), { vaults: [], home: anderes })).status, 403);
  assert.equal(pruefeVaultPfad(anderes, { vaults: [] }), anderes, "mit dem Standard-Home ist es nur ein Ordner in tmp");
  const s2 = tmp("brain-support2-");
  assert.equal(wirft(() => pruefeVaultPfad(join(s2, "x"), { vaults: [], support: s2 })).status, 403);
  const alt = process.env.BRAIN_APP_SUPPORT, neu = tmp("brain-support3-");
  process.env.BRAIN_APP_SUPPORT = neu;
  try { assert.equal(wirft(() => pruefeVaultPfad(join(neu, "v"), { vaults: [] })).status, 403, "Umgebungsvariable wird nicht zwischengespeichert"); }
  finally { process.env.BRAIN_APP_SUPPORT = alt; }
  const altHome = process.env.HOME, neuHome = tmp("brain-home5-");
  process.env.HOME = neuHome;
  try { assert.equal(wirft(() => pruefeVaultPfad(neuHome, { vaults: [] })).status, 403, "$HOME wird bei jedem Aufruf gelesen"); }
  finally { process.env.HOME = altHome; }
});

test("standardOrdner: <home>/Brain, bei Kollision Brain 2, Brain 3", () => {
  const home = tmp("brain-home3-");
  assert.equal(standardOrdner({ home }), join(home, "Brain"));
  mkdirSync(join(home, "Brain"));
  assert.equal(standardOrdner({ home }), join(home, "Brain 2"));
  schreibe(home, "Brain 2", "ich bin eine Datei");
  assert.equal(standardOrdner({ home }), join(home, "Brain 3"));
  assert.match(standardOrdner(), /\/Brain( \d+)?$/);
  assert.equal(standardOrdner().startsWith(HOME + "/"), true, "Standard-Home ist $HOME");
});

// ---------------------------------------------------------------- Neu anlegen

test("neuesVault vorlage: Gerüst, ein Commit „Brain angelegt“, sauber, Identität trotz leerem HOME, Beispielseiten grün", async () => {
  const ziel = join(tmp("brain-neu-"), "Mein Brain");
  const r = await neuesVault({ art: "vorlage", name: "Mein Brain", ordner: ziel }, OPT);
  assert.deepEqual(Object.keys(r).sort(), ["git", "liste", "vault"]);
  assert.equal(r.git, true);
  assert.deepEqual(r.vault, { name: "Mein Brain", pfad: ziel, farbe: PALETTE[0], git: true });
  assert.deepEqual(r.liste, { vaults: [{ name: "Mein Brain", pfad: ziel, farbe: PALETTE[0] }], aktiv: ziel });
  assert.deepEqual(leseVaults(), r.liste);
  assert.equal(aktiverVaultPfad(), ziel);

  // Dateiliste vollständig
  const erwartet = ["00_inbox/.gitkeep", "09_wiki/_log.md", "09_wiki/_schema.md", "09_wiki/wissen/thema_so-funktioniert-dein-brain.md",
    "09_wiki/wissen/thema_wissen-belegen.md", "AGENTS.md", "CLAUDE.md", ".gitignore"];
  const liste = verfolgt(ziel);
  for (const p of erwartet) assert.ok(liste.includes(p), p);
  const belege = liste.filter((p) => p.startsWith("09_wiki/wissen/belege/2026-10/"));
  assert.equal(belege.length, 4);
  assert.equal(liste.length, erwartet.length + belege.length, "nichts Unerwartetes");
  for (const x of vorlageDateien({ name: "Mein Brain", heute: HEUTE })) {
    assert.ok(liste.includes(x.pfad), x.pfad);
    assert.equal(readFileSync(join(ziel, x.pfad), "utf8"), x.inhalt, x.pfad);
  }

  // Git: ein Commit, sauber, Zweig main, Identität nur lokal (HOME ist leer)
  assert.equal(g(ziel, "log", "--format=%s").trim(), "Brain angelegt");
  assert.equal(g(ziel, "rev-list", "--count", "HEAD").trim(), "1");
  assert.equal(g(ziel, "status", "--porcelain").trim(), "");
  assert.equal(g(ziel, "symbolic-ref", "--short", "HEAD").trim(), "main");
  const konto = userInfo().username;
  assert.equal(g(ziel, "log", "-1", "--format=%an <%ae>").trim(), `${konto} <${konto}@localhost>`);
  assert.equal(g(ziel, "config", "--local", "user.name").trim(), konto);
  assert.equal(existsSync(join(HOME, ".gitconfig")), false, "die globale Git-Einstellung bleibt unberührt");

  assert.equal(readFileSync(join(ziel, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(readFileSync(join(ziel, "00_inbox", ".gitkeep"), "utf8"), "");
  assert.equal(readFileSync(join(ziel, ".gitignore"), "utf8"), GITIGNORE);
  for (const eintrag of [".DS_Store", ".logs/", "node_modules/", ".brain-tmp-*"]) assert.ok(GITIGNORE.split("\n").includes(eintrag), eintrag);
  assert.match(readFileSync(join(ziel, "09_wiki", "_log.md"), "utf8"), /^## 2026-10-24: Brain angelegt$/m);
});

test("neuesVault vorlage: beide Beispielseiten ergeben „gruen“, Beleg-Links lösen auf, Zitate stehen wörtlich in der Herkunftsdatei", async () => {
  const ziel = join(tmp("brain-neu2-"), "B");
  await neuesVault({ art: "vorlage", ordner: ziel }, OPT);
  for (const n of ["thema_so-funktioniert-dein-brain", "thema_wissen-belegen"]) {
    const rel = `09_wiki/wissen/${n}.md`;
    const text = readFileSync(join(ziel, rel), "utf8");
    assert.equal(pruefeText(rel, text, { heute: HEUTE }).stufe, "gruen", n);
    assert.equal(pruefeText(rel, text, { heute: "2031-01-01" }).stufe, "gruen", "kein pruefen_bis, kein verfall: bleibt grün");
    assert.match(text, /^typ: thema$/m); assert.match(text, /^stand: 2026-10-24$/m); assert.match(text, /^name: /m); assert.match(text, /^description: [^:]+$/m); assert.match(text, /^quellen: \[/m);
    assert.match(text, /^# .+/m);
    const fakten = text.match(/^- .+ · Stand 24\.10\.2026 · \[\[wissen\/belege\/2026-10\/[a-z0-9-]+\]\]$/gm) || [];
    assert.ok(fakten.length >= 2, `${n}: mindestens zwei Fakt-Zeilen`);
    const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
    const belegLinks = links.filter((l) => l.includes("/belege/"));
    assert.equal(belegLinks.length, fakten.length);
    for (const l of belegLinks) {
      assert.match(l, /^wissen\/belege\/2026-10\/[a-z0-9-]+$/);
      const datei = join(ziel, "09_wiki", l + ".md");
      assert.ok(existsSync(datei), `Beleg fehlt: ${l}`);
      const beleg = readFileSync(datei, "utf8");
      const kopf = (feld) => JSON.parse(beleg.match(new RegExp(`^${feld}: (".*")$`, "m"))[1]);
      assert.ok(kopf("zitat").length > 10); assert.ok(kopf("fundstelle"));
      assert.ok(readFileSync(join(ziel, kopf("herkunft")), "utf8").includes(kopf("zitat")), `${l}: Zitat steht nicht wörtlich in ${kopf("herkunft")}`);
      assert.equal(pruefeText(`09_wiki/${l}.md`, beleg, { heute: HEUTE }).stufe, "ohne");
    }
    const andere = n === "thema_wissen-belegen" ? "thema_so-funktioniert-dein-brain" : "thema_wissen-belegen";
    assert.ok(links.includes(andere), `Querverweis auf ${andere}`);
    assert.ok(existsSync(join(ziel, "09_wiki", "wissen", andere + ".md")));
  }
});

test("Vorlage: Inhalte passen zu den Vorgaben, ohne private Bezüge, Name wird bereinigt", () => {
  const dateien = vorlageDateien({ name: "Mein [[Brain]]", heute: HEUTE });
  const von = (p) => dateien.find((x) => x.pfad === p).inhalt;
  for (const x of dateien) assert.doesNotMatch(x.inhalt, /Fabio|Brogno|jarvis/i, x.pfad);
  const agents = von("AGENTS.md");
  assert.match(agents, /^# Mein Brain — /);
  for (const w of ["brain_suchen", "brain_lesen", "brain_merken", "brain_verlauf", "brain_gesundheit", "brain_vaults", "00_inbox/", "09_wiki/_schema.md", "--force", "INDEX.md", "_index.md", "graph.json", "pruefen_bis", "> [!KONFLIKT]", "PRÜFBEDÜRFTIG", "Claude Code", "Codex", "Gemini", "Cursor"]) assert.ok(agents.includes(w), `AGENTS.md: ${w}`);
  const schema = von("09_wiki/_schema.md");
  for (const w of ["thema_<slug>.md", "entitaet_<slug>.md", "synthese_<slug>.md", "quelle_<slug>.md", "name:", "description:", "typ:", "stand:", "quellen:", "09_wiki/<bereich>/",
    "· Stand TT.MM.JJJJ · [[<bereich>/belege/<JJJJ-MM>/<id>]]", "zitat", "herkunft", "fundstelle", "pruefen_bis", "verfall", "ersetzt_durch", "kritisch", "> [!KONFLIKT] offen — Du entscheidest",
    "Originalquelle", "nie still aufgelöst", "_log.md", "Rohquellen", "Querverweise", "Geheimnisse"]) assert.ok(schema.includes(w), `_schema.md: ${w}`);
  assert.equal(pruefeText("09_wiki/_schema.md", schema, { heute: HEUTE }).stufe, "grau");
  assert.equal(pruefeText("09_wiki/_log.md", von("09_wiki/_log.md"), { heute: HEUTE }).stufe, "grau");
  assert.equal(von("CLAUDE.md"), "@AGENTS.md\n");
  assert.equal(vorlageDateien({ heute: HEUTE }).find((x) => x.pfad === "AGENTS.md").inhalt.startsWith("# Brain — "), true, "ohne Namen: „Brain“");
  assert.equal(wirft(() => vorlageDateien({ name: "x", heute: "gestern" })).status, 500);
  assert.match(vorlageDateien({ name: "x" }).find((x) => x.pfad === "09_wiki/_log.md").inhalt, /^## \d{4}-\d\d-\d\d: Brain angelegt$/m, "ohne heute: Berliner Datum");
});

test("neuesVault vorlage: auch wenn eine globale Ignore-Datei CLAUDE.md und AGENTS.md ausschließt, sind sie im ersten Commit", async () => {
  const konfig = join(tmp("brain-gkonf-"), "gitconfig"), ignorieren = join(tmp("brain-gign-"), "ignore");
  writeFileSync(ignorieren, "CLAUDE.md\nAGENTS.md\n.gitkeep\n");
  writeFileSync(konfig, `[core]\n\texcludesFile = ${ignorieren}\n`);
  process.env.GIT_CONFIG_GLOBAL = konfig;
  let ziel;
  try {
    ziel = join(tmp("brain-neu3-"), "V");
    await neuesVault({ art: "vorlage", ordner: ziel }, OPT);
  } finally { delete process.env.GIT_CONFIG_GLOBAL; }
  const liste = verfolgt(ziel);
  for (const p of ["CLAUDE.md", "AGENTS.md", "00_inbox/.gitkeep", ".gitignore"]) assert.ok(liste.includes(p), p);
  assert.equal(g(ziel, "rev-list", "--count", "HEAD").trim(), "1");
});

test("neuesVault leer: nur .gitignore, Commit „Vault angelegt“, Name aus dem Ordner; ein leerer Ordner mit .DS_Store ist erlaubt", async () => {
  const ziel = tmp("brain-leer-");
  writeFileSync(join(ziel, ".DS_Store"), "x");
  const r = await neuesVault({ art: "leer", ordner: ziel }, OPT);
  assert.deepEqual(r.vault, { name: basename(ziel), pfad: ziel, farbe: PALETTE[0], git: true });
  assert.equal(r.liste.aktiv, ziel);
  assert.deepEqual(verfolgt(ziel), [".gitignore"]);
  assert.equal(g(ziel, "log", "--format=%s").trim(), "Vault angelegt");
  assert.equal(g(ziel, "rev-list", "--count", "HEAD").trim(), "1");
  assert.equal(g(ziel, "status", "--porcelain").trim(), "", ".DS_Store wird ignoriert");
  assert.equal(readFileSync(join(ziel, ".gitignore"), "utf8"), GITIGNORE);
  assert.ok(existsSync(join(ziel, ".DS_Store")));
  assert.equal(g(ziel, "config", "--local", "user.email").trim(), `${userInfo().username}@localhost`);
});

test("neuesVault: Eingaben werden geprüft, bevor etwas angelegt wird", async () => {
  const basis = tmp("brain-ein-");
  const ziel = join(basis, "V");
  const faelle = [
    [{ art: "xyz", ordner: ziel }, 400], [{ ordner: ziel }, 400], [{ art: "leer", name: "  ", ordner: ziel }, 400],
    [{ art: "leer", name: "x".repeat(81), ordner: ziel }, 400], [{ art: "leer", ordner: "relativ/pfad" }, 400],
    [{ art: "leer", ordner: "/System/Brain" }, 403], [{ art: "leer", ordner: HOME }, 403], [{ art: "leer", ordner: join(basis, ".git", "x") }, 403],
    [{ art: "vorlage", ordner: join(HOME, ".ssh", "Brain") }, 403],
  ];
  for (const [args, status] of faelle) assert.equal((await wirftAsync(neuesVault(args, OPT))).status, status, JSON.stringify(args));
  for (const kaputt of [undefined, null, "text", [], 5]) assert.equal((await wirftAsync(neuesVault(kaputt, OPT))).status, 400, "Eingabe kein Objekt");
  assert.deepEqual(readdirSync(basis), []);
  assert.equal(existsSync("/System/Brain"), false);
  assert.deepEqual(leseVaults(), LEER);
});

test("neuesVault ohne Ordner: <home>/Brain, danach Brain 2; Name wird getrimmt", async () => {
  const home = tmp("brain-home4-");
  const a = await neuesVault({ art: "leer" }, { ...OPT, home });
  assert.equal(a.vault.pfad, join(home, "Brain")); assert.equal(a.vault.name, "Brain");
  const b = await neuesVault({ art: "leer", name: "  Zweites  " }, { ...OPT, home });
  assert.equal(b.vault.pfad, join(home, "Brain 2")); assert.equal(b.vault.name, "Zweites");
  assert.equal(b.vault.farbe, PALETTE[1]);
  assert.equal(leseVaults().aktiv, join(home, "Brain 2"));
  assert.equal(leseVaults().vaults.length, 2);
});

test("neuesVault: nicht leerer Ordner → 409, nichts verändert, nichts registriert", async () => {
  const d = tmp("brain-voll-");
  schreibe(d, "notiz.md", "# meine Notiz\n"); schreibe(d, "unter/x.txt", "x");
  const vorher = momentaufnahme(d);
  for (const art of ["vorlage", "leer"]) {
    const e = await wirftAsync(neuesVault({ art, ordner: d }, OPT));
    assert.equal(e.status, 409);
    assert.equal(e.message, "Der Ordner ist nicht leer. Wähle einen neuen oder leeren Ordner — oder öffne ihn als vorhandenen Ordner.");
  }
  assert.deepEqual(momentaufnahme(d), vorher);
  assert.equal(existsSync(join(d, ".git")), false);
  assert.deepEqual(leseVaults(), LEER);
  const nurOrdner = tmp("brain-voll2-"); mkdirSync(join(nurOrdner, "leerer-unterordner"));
  assert.equal((await wirftAsync(neuesVault({ art: "leer", ordner: nurOrdner }, OPT))).status, 409, "auch ein leerer Unterordner zählt als Inhalt");
  const datei = join(tmp(), "ich-bin-eine-datei"); writeFileSync(datei, "x");
  assert.equal((await wirftAsync(neuesVault({ art: "leer", ordner: datei }, OPT))).status, 400);
});

test("neuesVault: zwei gleichzeitige Aufrufe für denselben Ordner — der zweite wird abgewiesen", async () => {
  const ziel = join(tmp("brain-par-"), "V");
  const [a, b] = await Promise.allSettled([neuesVault({ art: "leer", ordner: ziel }, OPT), neuesVault({ art: "leer", ordner: ziel }, OPT)]);
  assert.equal(a.status, "fulfilled");
  assert.equal(b.status, "rejected"); assert.equal(b.reason.status, 409);
  assert.equal(g(ziel, "rev-list", "--count", "HEAD").trim(), "1");
  assert.equal(leseVaults().vaults.length, 1);
});

test("Fehler beim Anlegen: neue Ordner verschwinden samt Elternordnern wieder, nichts wird registriert", async () => {
  const basis = tmp("brain-fehler-");
  for (const art of ["vorlage", "leer"]) {
    const e = await ohneGit(() => wirftAsync(neuesVault({ art, ordner: join(basis, "a", "b", "Brain") }, OPT)));
    assert.equal(e.status, 500); assert.match(e.message, /Git/);
    assert.deepEqual(readdirSync(basis), [], art);
  }
  assert.deepEqual(leseVaults(), LEER);
});

test("Fehler beim Anlegen in einem vorher leeren Ordner: nur unsere Inhalte verschwinden, Ordner und .DS_Store bleiben", async () => {
  const d = tmp("brain-fehler2-");
  writeFileSync(join(d, ".DS_Store"), "x");
  for (const art of ["vorlage", "leer"]) {
    await ohneGit(() => wirftAsync(neuesVault({ art, ordner: d }, OPT)));
    assert.deepEqual(readdirSync(d), [".DS_Store"], art);
  }
});

test("Fehler beim Registrieren (Liste nicht speicherbar): das neue Vault wird wieder entfernt", async () => {
  const basis = tmp("brain-fehler3-");
  const support = join(basis, "support-ist-eine-datei");
  writeFileSync(support, "x");
  const e = await wirftAsync(neuesVault({ art: "leer", ordner: join(basis, "V") }, { ...OPT, support }));
  assert.equal(e.status, 500); assert.match(e.message, /Liste der Vaults/);
  assert.deepEqual(readdirSync(basis), ["support-ist-eine-datei"]);
});

// ---------------------------------------------------------------- Ordner öffnen

test("oeffneOrdner ohne Git-Wunsch: registriert + aktiv, git:false, es wird nichts angelegt", async () => {
  const d = tmp("brain-offen-");
  schreibe(d, "a.md", "# a\n"); schreibe(d, "bild.png", "x"); schreibe(d, "sub/b.txt", "b");
  const vorher = momentaufnahme(d);
  const r = await oeffneOrdner({ pfad: d }, OPT);
  assert.deepEqual(r.vault, { name: basename(d), pfad: d, farbe: PALETTE[0], git: false });
  assert.equal(r.git, false); assert.equal(r.liste.aktiv, d);
  assert.deepEqual(momentaufnahme(d), vorher);
  assert.equal(existsSync(join(d, ".git")), false);
  assert.equal(aktiverVaultPfad(), d);
});

test("oeffneOrdner: vorhandenes Repo → git:true, Verlauf und Dateien unverändert (auch mit gitEinschalten)", async () => {
  const d = repo();
  const kopf = g(d, "rev-parse", "HEAD");
  const r = await oeffneOrdner({ pfad: d, gitEinschalten: true }, OPT);
  assert.equal(r.git, true); assert.equal(r.vault.git, true);
  assert.equal(g(d, "rev-parse", "HEAD"), kopf);
  assert.equal(g(d, "rev-list", "--count", "HEAD").trim(), "1");
  assert.equal(existsSync(join(d, ".gitignore")), false);
});

test("oeffneOrdner mit gitEinschalten: Repo + Commit „Versionsverlauf eingeschaltet“ nur mit Textdateien", async () => {
  const d = tmp("brain-einsch-");
  schreibe(d, "a.md", "# a\n"); schreibe(d, "sub/b.txt", "b"); schreibe(d, "GROSS.MD", "# g\n"); schreibe(d, "bild.png", "png");
  schreibe(d, ".versteckt/c.md", "# c\n"); schreibe(d, "node_modules/x.md", "# x\n"); schreibe(d, "sub/.auch-versteckt.md", "# v\n"); schreibe(d, ".DS_Store", "x");
  symlinkSync(join(d, "a.md"), join(d, "verweis.md"));
  const r = await oeffneOrdner({ pfad: d, gitEinschalten: true }, OPT);
  assert.equal(r.git, true); assert.equal(r.vault.git, true);
  assert.deepEqual(verfolgt(d), [".gitignore", "GROSS.MD", "a.md", "sub/b.txt"]);
  assert.equal(g(d, "log", "--format=%s").trim(), "Versionsverlauf eingeschaltet");
  assert.equal(g(d, "rev-list", "--count", "HEAD").trim(), "1");
  assert.equal(g(d, "symbolic-ref", "--short", "HEAD").trim(), "main");
  assert.equal(readFileSync(join(d, ".gitignore"), "utf8"), GITIGNORE);
  const rest = g(d, "status", "--porcelain", "-uall");
  assert.match(rest, /\?\? bild\.png/); assert.match(rest, /\?\? \.versteckt\/c\.md/); assert.match(rest, /\?\? verweis\.md/);
  assert.doesNotMatch(rest, /node_modules|\.DS_Store/);
  assert.equal(g(d, "config", "--local", "user.email").trim(), `${userInfo().username}@localhost`);
  assert.equal(readFileSync(join(d, "a.md"), "utf8"), "# a\n");
});

test("oeffneOrdner mit gitEinschalten: eigene .gitignore bleibt und wird beachtet; ein leerer Ordner bekommt nur .gitignore", async () => {
  const d = tmp("brain-einsch2-");
  const eigene = "*.txt\ngeheim/\n";
  schreibe(d, ".gitignore", eigene); schreibe(d, "a.md", "# a\n"); schreibe(d, "b.txt", "b"); schreibe(d, "geheim/c.md", "# c\n");
  await oeffneOrdner({ pfad: d, gitEinschalten: true }, OPT);
  assert.deepEqual(verfolgt(d), [".gitignore", "a.md"]);
  assert.equal(readFileSync(join(d, ".gitignore"), "utf8"), eigene);

  const leer = tmp("brain-einsch3-");
  await oeffneOrdner({ pfad: leer, gitEinschalten: true }, OPT);
  assert.deepEqual(verfolgt(leer), [".gitignore"]);
  assert.equal(g(leer, "rev-list", "--count", "HEAD").trim(), "1");
});

test("oeffneOrdner mit gitEinschalten: scheitert Git, bleibt der Ordner wie er war (kein .git, keine .gitignore)", async () => {
  const d = tmp("brain-einsch4-");
  schreibe(d, "a.md", "# a\n");
  const vorher = momentaufnahme(d);
  const e = await ohneGit(() => wirftAsync(oeffneOrdner({ pfad: d, gitEinschalten: true }, OPT)));
  assert.equal(e.status, 500);
  assert.deepEqual(momentaufnahme(d), vorher);
  assert.deepEqual(leseVaults(), LEER);
  // ohne Git-Wunsch geht das Öffnen auch ohne installiertes Git
  const r = await ohneGit(() => oeffneOrdner({ pfad: d }, OPT));
  assert.equal(r.git, false);
});

test("oeffneOrdner mit gitEinschalten in einem Unterordner eines Repos → 409, nie verschachtelt", async () => {
  const wurzel = repo();
  schreibe(wurzel, "unter/n.md", "# n\n");
  const sub = join(wurzel, "unter");
  const e = await wirftAsync(oeffneOrdner({ pfad: sub, gitEinschalten: true }, OPT));
  assert.equal(e.status, 409);
  assert.equal(e.message, "Dieser Ordner liegt schon in einem anderen Git-Repository.");
  assert.equal(existsSync(join(sub, ".git")), false); assert.equal(existsSync(join(sub, ".gitignore")), false);
  assert.deepEqual(leseVaults(), LEER);
  const r = await oeffneOrdner({ pfad: sub }, OPT);
  assert.equal(r.git, false, "als Vault öffnen geht, nur ohne eigenen Versionsverlauf");
  assert.equal(existsSync(join(sub, ".git")), false);
});

test("oeffneOrdner: schon registrierter Ordner → nur aktiv gesetzt, Name/Farbe/Reihenfolge bleiben", async () => {
  const [a, b] = [tmp(), tmp()];
  registriere(a, { name: "Alpha" }); registriere(b, { name: "Beta" });
  waehleAktiv(a);
  const link = join(tmp(), "ln"); symlinkSync(b, link);
  const r = await oeffneOrdner({ pfad: link }, OPT);
  assert.equal(r.liste.aktiv, b);
  assert.deepEqual(r.liste.vaults.map((v) => [v.name, v.pfad, v.farbe]), [["Alpha", a, PALETTE[0]], ["Beta", b, PALETTE[1]]]);
  assert.deepEqual(r.vault, { name: "Beta", pfad: b, farbe: PALETTE[1], git: false });
});

test("oeffneOrdner: Fehlerfälle (fehlt 404, Datei 400, verboten 403, ohne Pfad 400, innerhalb eines Vaults 409)", async () => {
  const t = tmp("brain-offen2-");
  assert.equal((await wirftAsync(oeffneOrdner({ pfad: join(t, "gibt-es-nicht") }, OPT))).status, 404);
  schreibe(t, "datei.md", "x");
  assert.equal((await wirftAsync(oeffneOrdner({ pfad: join(t, "datei.md") }, OPT))).status, 400);
  assert.equal((await wirftAsync(oeffneOrdner({ pfad: "/System" }, OPT))).status, 403);
  assert.equal((await wirftAsync(oeffneOrdner({ pfad: HOME }, OPT))).status, 403);
  assert.equal((await wirftAsync(oeffneOrdner({}, OPT))).status, 400);
  for (const kaputt of [undefined, null, "text", [], 5]) assert.equal((await wirftAsync(oeffneOrdner(kaputt, OPT))).status, 400, "Eingabe kein Objekt");
  assert.equal(wirft(() => registriere(undefined, null)).status, 400);
  assert.equal(wirft(() => pruefeVaultPfad("/System", null)).status, 403);
  registriere(t); mkdirSync(join(t, "innen"));
  assert.equal((await wirftAsync(oeffneOrdner({ pfad: join(t, "innen") }, OPT))).status, 409);
  assert.equal(leseVaults().vaults.length, 1);
});

// ---------------------------------------------------------------- Klonen

test("klone: lokales Bare-Repo (Testmodus) → Vault aktiv, git:true, Name aus dem Ordner (ohne .git)", async () => {
  const bare = bareMitInhalt();
  const ziel = join(tmp("brain-kl-"), "Geklont");
  const r = await klone({ url: bare, ordner: ziel }, OPT);
  assert.equal(r.git, true);
  assert.deepEqual(r.vault, { name: "Geklont", pfad: ziel, farbe: PALETTE[0], git: true });
  assert.equal(r.liste.aktiv, ziel);
  assert.equal(readFileSync(join(ziel, "wissen.md"), "utf8"), "# Wissen\n");
  assert.equal(g(ziel, "remote", "get-url", "origin").trim(), bare);
  assert.equal(g(ziel, "config", "--local", "user.email").trim(), `${userInfo().username}@localhost`, "Identität für den ersten eigenen Commit");
  assert.deepEqual(leseVaults(), r.liste);

  const r2 = await klone({ url: bare, ordner: join(tmp("brain-kl-"), "notizen.git") }, OPT);
  assert.equal(r2.vault.name, "notizen");
  const r3 = await klone({ url: bare, ordner: join(tmp("brain-kl-"), "x"), name: " Mein Klon " }, OPT);
  assert.equal(r3.vault.name, "Mein Klon");
  assert.equal(r3.liste.vaults.length, 3);
  assert.equal(r3.liste.aktiv, r3.vault.pfad);
});

test("klone: ohne Ordner nach <home>/Brain, in einen vorhandenen leeren Ordner (auch mit .DS_Store) geht", async () => {
  const bare = bareMitInhalt();
  const home = tmp("brain-home6-");
  const r = await klone({ url: bare }, { ...OPT, home });
  assert.equal(r.vault.pfad, join(home, "Brain"));
  assert.ok(existsSync(join(home, "Brain", "wissen.md")));
  const leer = tmp("brain-kl-leer-");
  writeFileSync(join(leer, ".DS_Store"), "x");
  const r2 = await klone({ url: bare, ordner: leer }, OPT);
  assert.equal(r2.vault.pfad, leer);
  assert.ok(existsSync(join(leer, "wissen.md")));
});

test("klone: unzulässige Adressen → 400, es wird nichts angelegt", async () => {
  const basis = tmp("brain-kl2-");
  const ziel = join(basis, "Z");
  const urls = ["ext::sh -c touch /tmp/gehackt", "ext::sh,-c,touch${IFS}/tmp/gehackt", "http://example.org/x.git", "https://nutzer:geheim@example.org/x.git",
    "-oProxyCommand=x", "", "   ", undefined, null, 5, "git://example.org/x.git", "ftp://example.org/x", "x::y", "relativ/pfad", "file://etc"]; // „file:///…“ ist nur im Testmodus erlaubt
  for (const url of urls) assert.equal((await wirftAsync(klone({ url, ordner: ziel }, OPT))).status, 400, String(url));
  for (const kaputt of [undefined, null, "text", [], 5]) assert.equal((await wirftAsync(klone(kaputt, OPT))).status, 400, "Eingabe kein Objekt");
  assert.deepEqual(readdirSync(basis), []);
  assert.deepEqual(leseVaults(), LEER);
  const bare = bareMitInhalt();
  assert.equal((await wirftAsync(klone({ url: bare, ordner: ziel, name: "x".repeat(81) }, OPT))).status, 400, "Name wird vor dem Klonen geprüft");
  assert.equal((await wirftAsync(klone({ url: bare, ordner: "relativ" }, OPT))).status, 400);
  assert.equal((await wirftAsync(klone({ url: bare, ordner: "/System/Brain" }, OPT))).status, 403);
  assert.deepEqual(readdirSync(basis), []);
});

test("klone: Ziel nicht leer → 409, nichts verändert", async () => {
  const bare = bareMitInhalt();
  const voll = tmp("brain-kl3-");
  schreibe(voll, "x.md", "mein Text");
  const vorher = momentaufnahme(voll);
  const e = await wirftAsync(klone({ url: bare, ordner: voll }, OPT));
  assert.equal(e.status, 409);
  assert.equal(e.message, "Der Ordner ist nicht leer. Wähle einen neuen oder leeren Ordner — oder öffne ihn als vorhandenen Ordner.");
  assert.deepEqual(momentaufnahme(voll), vorher);
  assert.deepEqual(leseVaults(), LEER);
});

test("klone: gibt es das Repository nicht, verschwindet das Ziel wieder (neu: samt Elternordnern; vorher leer: bleibt leer)", async () => {
  const basis = tmp("brain-kl4-");
  const gibtsNicht = join(basis, "kein-repo.git");
  let e = await wirftAsync(klone({ url: gibtsNicht, ordner: join(basis, "x", "y", "Ziel") }, OPT));
  assert.equal(e.status, 404); assert.match(e.message, /gibt es nicht/); assert.match(e.extra.ausgabe, /fatal/);
  assert.deepEqual(readdirSync(basis), []);
  const leer = tmp("brain-kl5-");
  e = await wirftAsync(klone({ url: gibtsNicht, ordner: leer }, OPT));
  assert.equal(e.status, 404);
  assert.deepEqual(readdirSync(leer), []);
  assert.ok(existsSync(leer));
  assert.deepEqual(leseVaults(), LEER);
});

test("klone: halb fertiger Klon (Abbruch) wird komplett entfernt — neu und in einem vorher leeren Ordner", async () => {
  const dir = attrappe(`for a in "$@"; do last="$a"; done; mkdir -p "$last/.git"; echo halb > "$last/halb.txt"; echo "fatal: Abbruch (Test)" >&2; exit 128`);
  const basis = tmp("brain-kl6-");
  let e = await mitPfad(dir, () => wirftAsync(klone({ url: "/irgendein/pfad", ordner: join(basis, "p", "Ziel") }, OPT)));
  assert.equal(e.status, 502);
  assert.equal(e.message, "Das Repository konnte nicht geklont werden.");
  assert.match(e.extra.ausgabe, /Abbruch/);
  assert.deepEqual(readdirSync(basis), []);
  const leer = tmp("brain-kl7-");
  e = await mitPfad(dir, () => wirftAsync(klone({ url: "/irgendein/pfad", ordner: leer }, OPT)));
  assert.equal(e.status, 502);
  assert.deepEqual(readdirSync(leer), []);
  assert.deepEqual(leseVaults(), LEER);
});

test("klone: Zeitlimit → 504 „zu lange gedauert“, Ziel wird entfernt", async () => {
  const dir = attrappe(`for a in "$@"; do last="$a"; done; mkdir -p "$last"; echo halb > "$last/halb.txt"; exec sleep 20`);
  const basis = tmp("brain-kl8-");
  const e = await mitPfad(dir, () => wirftAsync(klone({ url: "/irgendein/pfad", ordner: join(basis, "Ziel") }, { ...OPT, limitKlon: 600 })));
  assert.equal(e.status, 504);
  assert.equal(e.message, "Das Herunterladen hat zu lange gedauert.");
  assert.deepEqual(readdirSync(basis), []);
});

test("klone: Anmeldung/Netz werden in Alltagssprache übersetzt (403, 502)", async () => {
  const basis = tmp("brain-kl9-");
  for (const [meldung, status, muster] of [["fatal: Authentication failed for 'x'", 403, /Zugriff verweigert/], ["fatal: unable to access: Could not resolve host: example.org", 502, /nicht erreichbar/]]) {
    const dir = attrappe(`echo "${meldung}" >&2; exit 128`);
    const e = await mitPfad(dir, () => wirftAsync(klone({ url: "/irgendein/pfad", ordner: join(basis, "Z") }, OPT)));
    assert.equal(e.status, status); assert.match(e.message, muster);
    assert.deepEqual(readdirSync(basis), []);
  }
});

test("klone: scheitert das Registrieren, wird der fertige Klon wieder entfernt", async () => {
  const bare = bareMitInhalt();
  const basis = tmp("brain-kl10-");
  const support = join(basis, "support-ist-eine-datei");
  writeFileSync(support, "x");
  const e = await wirftAsync(klone({ url: bare, ordner: join(basis, "Z") }, { ...OPT, support }));
  assert.equal(e.status, 500);
  assert.deepEqual(readdirSync(basis), ["support-ist-eine-datei"]);
});
