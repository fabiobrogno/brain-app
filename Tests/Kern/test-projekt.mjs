// K14 Projekt-Steckbrief: Felder pruefen/ziel/fallen wörtlich, Stack frisch aus den Manifesten, Budget in ganzen
// Zeilen, Lint STECKBRIEF; Repo ohne Projektseite bleibt still.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fmListe, stackAusManifesten, findeProjektseite, steckbrief, istProjektseite, STECKBRIEF_MAX } from "../projekt.mjs";
import { gezeigtListe, merkeGezeigt } from "../gezeigt.mjs";
import { tempOrdner, tempVault, hook, KIT, TEMP_HOME } from "./verlauf-fixture.mjs";

function vaultMitProjekt() {
  const v = tempVault("Mein Brän");
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "projekte", "entitaet_garten-app.md"),
    '---\nname: garten-app\ndescription: Garten-App\ntyp: entitaet\nrepo: jo/garten-app\n'
    + 'pruefen: ["node --test", "bash scripts/rauchtest.sh"]\nziel: "test — Prod nur nach Freigabe durch Jo"\n'
    + 'fallen: ["Port 4242 ist belegt", "nie direkt auf main"]\n---\n# Garten-App\n');
  const repo = join(tempOrdner("Arbeit Ü"), "garten-app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "garten-app", version: "0.3.0" }));
  return { v, repo };
}

test("fmListe: JSON-Liste, YAML-Liste, Einzelwert, kaputtes JSON fällt auf Komma-Liste zurück", () => {
  const t = '---\nname: x\npruefen: ["node --test", "bash run-all.sh, mit Komma"]\nziel: "test — Prod nur nach Freigabe"\n'
    + "fallen:\n  - nie auf main\n  - Ports prüfen\nkaputt: [\"a\", b]\n---\n# x\n";
  assert.deepEqual(fmListe(t, "pruefen"), ["node --test", "bash run-all.sh, mit Komma"]);
  assert.deepEqual(fmListe(t, "ziel"), ["test — Prod nur nach Freigabe"]);
  assert.deepEqual(fmListe(t, "fallen"), ["nie auf main", "Ports prüfen"]);
  assert.deepEqual(fmListe(t, "kaputt"), ["a", "b"]);
  assert.deepEqual(fmListe(t, "fehlt"), []);
});

test("stackAusManifesten: package.json, Package.swift, go.mod, pyproject.toml, Cargo.toml wörtlich; kaputtes JSON → still", () => {
  const r = tempOrdner("Repo Ä");
  writeFileSync(join(r, "package.json"), JSON.stringify({ name: "garten", version: "1.2.3", engines: { node: ">=22" },
    dependencies: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`dep${i}`, `^${i}.0.0`])) }));
  writeFileSync(join(r, "Package.swift"), "// swift-tools-version:6.2\nimport PackageDescription\nlet p = Package(name: \"A\", platforms: [.macOS(.v26)], targets: [])\n");
  writeFileSync(join(r, "go.mod"), "module example.com/garten\n\ngo 1.23\n");
  writeFileSync(join(r, "pyproject.toml"), "[tool.x]\nname = \"falsch\"\n[project]\nname = \"garten-py\"\nversion = \"0.4\"\nrequires-python = \">=3.12\"\n");
  writeFileSync(join(r, "Cargo.toml"), "[package]\nname = \"garten-rs\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
  const s = Object.fromEntries(stackAusManifesten(r).map((x) => [x.datei, x.angaben]));
  assert.deepEqual(s["package.json"], ["garten 1.2.3", "engines.node >=22",
    "Abhängigkeiten: dep0 ^0.0.0, dep1 ^1.0.0, dep2 ^2.0.0, dep3 ^3.0.0, dep4 ^4.0.0, dep5 ^5.0.0, dep6 ^6.0.0, dep7 ^7.0.0 (+2)"]);
  assert.deepEqual(s["Package.swift"], ["swift-tools-version 6.2", "platforms .macOS(.v26)"]);
  assert.deepEqual(s["go.mod"], ["module example.com/garten", "go 1.23"]);
  assert.deepEqual(s["pyproject.toml"], ["name garten-py", "version 0.4", "requires-python >=3.12"]);
  assert.deepEqual(s["Cargo.toml"], ["name garten-rs", "version 0.1.0", "edition 2021"]);
  writeFileSync(join(r, "package.json"), "{kaputt");
  assert.equal(stackAusManifesten(r).some((x) => x.datei === "package.json"), false);
});

test("steckbrief: Felder + Stack wörtlich mit Quelle, ≤ 1.200 Zeichen; bei Überschreitung ganze Zeilen weg mit Hinweis", () => {
  const { v, repo } = vaultMitProjekt();
  const seite = findeProjektseite(v, "09_wiki", ["garten-app"]);
  assert.equal(seite, "09_wiki/projekte/entitaet_garten-app.md");
  const t = steckbrief(v, seite, { wurzel: repo });
  assert.match(t, /^Projekt-Steckbrief \(wörtlich aus 09_wiki\/projekte\/entitaet_garten-app\.md und den Manifesten im Repo\):/);
  assert.match(t, /- Prüfen: `node --test` · `bash scripts\/rauchtest\.sh`/);
  assert.match(t, /- Ziel: test — Prod nur nach Freigabe durch Jo/);
  assert.match(t, /- Falle: Port 4242 ist belegt/);
  assert.match(t, /- Stack laut package\.json: garten-app 0\.3\.0/);
  assert.ok(t.length <= STECKBRIEF_MAX);
  const knapp = steckbrief(v, seite, { wurzel: repo, max: 300 });
  assert.ok(knapp.length <= 300, String(knapp.length));
  assert.match(knapp, /- Prüfen:/);
  assert.match(knapp, /weitere Angaben in 09_wiki/);
  assert.doesNotMatch(knapp, /\(gekürzt\)/, "nie mitten in einer Zeile kürzen");
});

test("istProjektseite: repo/pfade oder entitaet unter projekte/", () => {
  assert.equal(istProjektseite("wissen/thema_x.md", "name: x\nrepo: a/b"), true);
  assert.equal(istProjektseite("projekte/entitaet_y.md", "name: y\ntyp: entitaet"), true);
  assert.equal(istProjektseite("projekte/thema_z.md", "name: z\ntyp: thema"), false);
  assert.equal(istProjektseite("wissen/entitaet_w.md", "name: w\ntyp: entitaet"), false);
});

test("gezeigt: je Sitzung eine Liste, andere Sitzung sieht nichts", () => {
  const v = tempVault();
  merkeGezeigt(v, "s1", "steckbrief:a.md", "repo:/r");
  assert.deepEqual([...gezeigtListe(v, "s1")], ["steckbrief:a.md", "repo:/r"]);
  assert.equal(gezeigtListe(v, "s2").size, 0);
  assert.equal(gezeigtListe(v, "").size, 0);
});

test("SessionStart: Projektseite + Steckbrief aus Unterordner des Repos; Steckbrief als gezeigt gemerkt; Repo ohne Projektseite still", () => {
  const { v, repo } = vaultMitProjekt();
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  const s = hook("session-start.mjs", { session_id: "s1", source: "startup", cwd: join(repo, "src") }, { vault: v, env });
  assert.equal(s.status, 0);
  assert.match(s.stdout, /^Projektseite: .*entitaet_garten-app\.md$/m);
  assert.match(s.stdout, /Projekt-Steckbrief/);
  assert.match(s.stdout, /- Stack laut package\.json: garten-app 0\.3\.0/);
  assert.match(readFileSync(join(v, ".logs", "gezeigt", "s1.txt"), "utf8"), /^steckbrief:09_wiki\/projekte\/entitaet_garten-app\.md$/m);
  const anderes = join(tempOrdner("Fremd"), "anderes-repo");
  mkdirSync(join(anderes, ".git"), { recursive: true });
  const o = hook("session-start.mjs", { session_id: "s2", source: "startup", cwd: anderes }, { vault: v, env });
  assert.doesNotMatch(o.stdout, /Steckbrief|Projektseite/);
});

test("brain lint: STECKBRIEF für Projektseiten ohne pruefen, nicht für Seiten mit pruefen oder Nicht-Projektseiten", () => {
  const v = tempOrdner("Brain Lint");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "projekte", "entitaet_ohne.md"), "---\nname: ohne\ndescription: x\ntyp: entitaet\n---\n# ohne\n");
  writeFileSync(join(v, "09_wiki", "projekte", "entitaet_mit.md"), '---\nname: mit\ndescription: x\ntyp: entitaet\npruefen: ["npm test"]\n---\n# mit\n');
  writeFileSync(join(v, "09_wiki", "thema_repo.md"), "---\nname: r\ndescription: x\ntyp: thema\nrepo: jo/r\n---\n# r\n");
  const r = spawnSync(process.execPath, [join(KIT, "brain-lint.mjs"), v], { encoding: "utf8", env: { ...process.env, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME } });
  const steck = r.stdout.split("\n").filter((z) => z.includes("STECKBRIEF"));
  assert.equal(steck.length, 2, r.stdout);
  assert.ok(steck.some((z) => z.includes("projekte/entitaet_ohne.md")));
  assert.ok(steck.some((z) => z.includes("thema_repo.md")));
});
