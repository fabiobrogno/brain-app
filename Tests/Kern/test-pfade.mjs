import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { vaultPfad, nimmVaultArg, KeinVaultFehler, KERN, ALT_KIT_ORDNER, kernVersion, kernAnzeige, supportOrte, supportOrdner, kitOrte, aktiverVaultAusListe, evalFragenDatei, holdoutDatei, ordner, renderVorlage, nodeBefehl, nodePfad, gitAnzeige, ladeConfig, configFehler, liesConfigRoh, entferneBom } from "../pfade.mjs";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

const neu = () => { const v = join(mkdtempSync(join(tmpdir(), "brain pfad ")), "Mein Brain"); mkdirSync(v); return v; };

test("Defaults = heutige Ordnernamen", () => {
  const v = neu(); writeFileSync(join(v, "brain.config.json"), "{}");
  assert.deepEqual(ordner(v), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv" });
});
test("Config überschreibt Ordnernamen, alter Schlüssel wiki.ordner gilt weiter", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { inbox: "inbox", archiv: "archiv" }, wiki: { ordner: "wiki" } }));
  assert.deepEqual(ordner(v), { inbox: "inbox", wiki: "wiki", archiv: "archiv" });
});
const ohneUmgebung = (extra = {}) => ({ ...process.env, BRAIN_VAULT: "", BRAIN_APP_SUPPORT: join(tmpdir(), "pfad-test-leer-nie-vorhanden"), ...extra });

test("KERN ist der Ordner der Datei selbst (nie der Vault, nie das Elternverzeichnis)", () => {
  assert.equal(KERN, dirname(fileURLToPath(new URL("../pfade.mjs", import.meta.url))));
});
test("Vault: --vault vor Positionsargument vor BRAIN_VAULT vor der App-Liste", () => {
  const env = { BRAIN_VAULT: "/x/env", BRAIN_APP_SUPPORT: join(tmpdir(), "pfad-test-leer-nie-vorhanden") };
  assert.equal(vaultPfad(["node", "s", "--vault", "/x/flag", "/x/arg"], { env }), "/x/flag");
  assert.equal(vaultPfad(["node", "s", "--vault=/x/gleich"], { env }), "/x/gleich");
  assert.equal(vaultPfad(["node", "s", "/x/arg"], { env }), "/x/arg");
  assert.equal(vaultPfad(["node", "s", "--flag"], { env }), "/x/env");
  const app = join(mkdtempSync(join(tmpdir(), "pfad-app ")), "v");
  const support = mkdtempSync(join(tmpdir(), "pfad-support "));
  mkdirSync(app);
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: app, name: "x" }], aktiv: app }));
  assert.equal(vaultPfad(["node", "s"], { env: { BRAIN_APP_SUPPORT: support } }), app);
  assert.equal(vaultPfad(["node", "s"], { env: { BRAIN_VAULT: "", BRAIN_APP_SUPPORT: support } }), app);
  assert.equal(vaultPfad(["node", "s"], { env: { BRAIN_VAULT: "/x/env", BRAIN_APP_SUPPORT: support } }), "/x/env");
});
test("Vault: nichts gefunden → KeinVaultFehler, nie ~/brain und nie der Ort des Kerns", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-home "));
  mkdirSync(join(home, "brain"));   // ein Ordner ~/brain darf NICHT als Vault gelten
  assert.throws(() => vaultPfad(["node", "s"], { env: { BRAIN_APP_SUPPORT: join(home, "leer") } }), (e) => e instanceof KeinVaultFehler && e.code === "KEIN_VAULT" && /--vault/.test(e.message));
  assert.throws(() => vaultPfad(["node", "s", "--flag"], { env: { BRAIN_VAULT: "", BRAIN_APP_SUPPORT: join(home, "leer") } }), KeinVaultFehler);
});
test("vaults.json: aktiv zählt nur, wenn es einen Eintrag mit absolutem Pfad meint; defekte Listen und aktiv:null ergeben keinen Vault", () => {
  const s = mkdtempSync(join(tmpdir(), "pfad-liste "));
  const lies = () => aktiverVaultAusListe({ env: { BRAIN_APP_SUPPORT: s } });
  assert.equal(lies(), null);                                                                       // keine Datei
  writeFileSync(join(s, "vaults.json"), "{ kaputt"); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: "x", aktiv: "/a" })); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: "/a" }, { pfad: "relativ" }], aktiv: "/b" })); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: "/a" }], aktiv: null })); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: "/a/b/../a" }, { pfad: "/c" }], aktiv: "/a/a" })); assert.equal(lies(), "/a/a");
});
test("Support-Ordner: BRAIN_APP_SUPPORT (nur absolut) allein, sonst Kortex vor dem alten Brain; Kit-Orte mit Rückfall ~/.brain-kit", () => {
  assert.deepEqual(supportOrte({ env: { BRAIN_APP_SUPPORT: "/t/s" }, home: "/h" }), ["/t/s"]);
  assert.deepEqual(supportOrte({ env: { BRAIN_APP_SUPPORT: "relativ" }, home: "/h", plattform: "darwin" }), ["/h/Library/Application Support/Kortex", "/h/Library/Application Support/Brain"]);
  assert.equal(supportOrdner({ env: {}, home: "/h", plattform: "darwin" }), "/h/Library/Application Support/Kortex");
  assert.deepEqual(kitOrte({ env: {}, home: "/h", plattform: "darwin" }), ["/h/Library/Application Support/Kortex", "/h/.brain-kit"]);
});
test("--vault wird aus der Kommandozeile genommen (nimmVaultArg), auch hinter anderen Argumenten", () => {
  const a = ["node", "s", "search", "--vault", "/v", "frage"];
  assert.equal(nimmVaultArg(a), "/v");
  assert.deepEqual(a, ["node", "s", "search", "frage"]);
  const b = ["node", "s", "--vault"]; assert.equal(nimmVaultArg(b), null); assert.deepEqual(b, ["node", "s", "--vault"]);
});
test("Prozess: ohne Vault endet ein Werkzeug mit Exit 2 und klarer Meldung, ein Hook still mit Exit 0; version braucht keinen Vault", () => {
  const brain = join(KERN, "brain.mjs");
  let r = spawnSync(process.execPath, [brain, "status"], { env: ohneUmgebung(), encoding: "utf8" });
  assert.equal(r.status, 2); assert.match(r.stderr, /Kein Vault gefunden/); assert.equal(r.stdout, "");
  r = spawnSync(process.execPath, [brain, "version"], { env: ohneUmgebung(), encoding: "utf8" });
  assert.equal(r.status, 0); assert.equal(r.stdout.trim(), kernVersion());
  r = spawnSync(process.execPath, [join(KERN, "adapters", "claude-code", "brain-hint.mjs")], { env: ohneUmgebung(), input: "{}", encoding: "utf8" });
  assert.equal(r.status, 0); assert.equal(r.stdout, ""); assert.equal(r.stderr, "");
  r = spawnSync(process.execPath, [join(KERN, "adapters", "claude-code", "wiki-guard.mjs")], { env: ohneUmgebung(), input: JSON.stringify({ tool_input: { file_path: "/x/09_wiki/a.md" } }), encoding: "utf8" });
  assert.equal(r.status, 0); assert.equal(r.stderr, "");
});
test("Prozess: --vault <pfad> vor dem Befehl und hinter ihm wählt den Vault (Windows-sichere Pfade mit Leerzeichen)", () => {
  const v = neu(); writeFileSync(join(v, "brain.config.json"), "{}");
  for (const args of [["--vault", v, "status", "--json"], ["status", "--json", "--vault", v], [`--vault=${v}`, "status", "--json"]]) {
    const r = spawnSync(process.execPath, [join(KERN, "brain.mjs"), ...args], { env: ohneUmgebung(), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.version, kernVersion());
    assert.equal(j.quellVault, false);
  }
});
test("kernVersion liest KERN/VERSION (die eine Lesestelle für Kern-Version = App-Version)", () => {
  assert.equal(kernVersion(), readFileSync(join(KERN, "VERSION"), "utf8").trim());
});
test("Messlatte-Fragen: gebündelte Vorlage (KERN), eigene Fragen im Vault (.logs/hint-eval.json) ersetzen sie, BRAIN_EVAL_DATEI geht vor", () => {
  const v = neu();
  assert.equal(evalFragenDatei(v, { env: {} }), join(KERN, "kit", "vorlage-eval.json"));
  mkdirSync(join(v, ".logs")); writeFileSync(join(v, ".logs", "hint-eval.json"), "{}");
  assert.equal(evalFragenDatei(v, { env: {} }), join(v, ".logs", "hint-eval.json"));
  assert.equal(evalFragenDatei(v, { env: { BRAIN_EVAL_DATEI: "/x/e.json" } }), "/x/e.json");
  assert.equal(holdoutDatei(v), join(v, ".logs", "holdout.json"));
});
test("kernAnzeige: KORTEX_KERN_PFAD (absolut) geht vor dem tatsächlichen Ort; {{KERN}}/{{DATEN}} werden gerendert", () => {
  assert.equal(kernAnzeige({ env: {} }), KERN.split("\\").join("/"));
  assert.equal(kernAnzeige({ env: { KORTEX_KERN_PFAD: "/stabil/kern" } }), "/stabil/kern");
  assert.equal(kernAnzeige({ env: { KORTEX_KERN_PFAD: "relativ" } }), KERN.split("\\").join("/"));
  const v = neu();
  const r = renderVorlage('"{{KERN}}/brain.mjs" --vault "{{VAULT}}" · {{DATEN}}', v);
  assert.ok(r.startsWith(`"${KERN.split("\\").join("/")}/brain.mjs" --vault "${v.split("\\").join("/")}"`), r);
  assert.doesNotMatch(r, /\{\{/);
});
test("ALT_KIT_ORDNER bleibt der einzige Ort, der den alten Kit-Ordner nennt", () => {
  assert.equal(ALT_KIT_ORDNER, ".tools");
});
test("renderVorlage: absoluter, gequoteter Node-Pfad, Ordnernamen inkl. ARCHIV, keine Platzhalter übrig", () => {
  const v = neu(); writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { archiv: "ablage" } }));
  const r = renderVorlage("{{NODE}} \"{{KERN}}/brain.mjs\" · {{ARCHIV}} · {{GIT}} · {{INBOX}} · {{WIKI}}", v);
  assert.ok(r.startsWith(`${nodeBefehl()} `), r);
  assert.equal(realpathSync(nodePfad()), realpathSync(process.execPath));
  assert.ok(isAbsolute(nodePfad()));
  assert.match(r, / · ablage · /);
  assert.doesNotMatch(r, /\{\{/);
});
test("renderVorlage: {{GIT}} bevorzugt werkzeuge.git aus der Vault-Config vor dem PATH-Rückfall (Fix round 1)", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ werkzeuge: { git: "/ein/privater/git" } }));
  const r = renderVorlage("{{GIT}}", v);
  assert.equal(r, `"/ein/privater/git"`);
});
test("gitAnzeige: ohne Config fällt auf den bisherigen Rückfall zurück (win32-MinGit-Ort bzw. nacktes 'git')", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-git-"));
  assert.equal(gitAnzeige({ cfg: {}, plattform: "darwin", home }), "git");
  mkdirSync(join(home, ".brain-kit", "git", "cmd"), { recursive: true });
  writeFileSync(join(home, ".brain-kit", "git", "cmd", "git.exe"), "");
  // Anzeige-Strings tragen immer "/" (auch unter Windows), darum hier ebenso
  assert.equal(gitAnzeige({ cfg: {}, plattform: "win32", home }), `"${join(home, ".brain-kit", "git", "cmd", "git.exe").split("\\").join("/")}"`);
  // Config geht auch hier vor
  assert.equal(gitAnzeige({ cfg: { werkzeuge: { git: "/x/git" } }, plattform: "win32", home }), `"/x/git"`);
});
test("Review-Fund 7 (BOM in brain.config.json): ladeConfig/configFehler tolerieren ein UTF-8-BOM", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), "﻿" + JSON.stringify({ zebra: 1 }));
  assert.deepEqual(ladeConfig(v), { zebra: 1 });
  assert.equal(configFehler(v), null);
});

test("liesConfigRoh: fehlende Datei → stand '0', text null, cfg {}, kein Fehler", () => {
  const v = neu();
  assert.deepEqual(liesConfigRoh(v), { stand: "0", text: null, cfg: {}, fehler: null });
});

test("liesConfigRoh: stand ist SHA-256 der rohen Bytes (BOM inklusive, vor der Bereinigung), text/cfg sind BOM-frei", () => {
  const v = neu();
  const roh = "﻿" + JSON.stringify({ zebra: 1 }, null, 2) + "\n";
  writeFileSync(join(v, "brain.config.json"), roh);
  const r = liesConfigRoh(v);
  assert.equal(r.stand, createHash("sha256").update(Buffer.from(roh, "utf8")).digest("hex"));
  assert.equal(r.text, entferneBom(roh));
  assert.deepEqual(r.cfg, { zebra: 1 });
  assert.equal(r.fehler, null);
});

test("liesConfigRoh: kaputtes JSON → fehler gesetzt, cfg null, stand trotzdem berechnet (optimistisches Sperren bleibt möglich)", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), "{ kaputt");
  const r = liesConfigRoh(v);
  assert.ok(r.fehler);
  assert.equal(r.cfg, null);
  assert.match(r.stand, /^[0-9a-f]{64}$/);
});

test("nodePfad: BRAIN_NODE (absolut, vorhanden) gewinnt", () => {
  assert.equal(nodePfad({ env: { BRAIN_NODE: process.execPath, PATH: "" } }), process.execPath);
});

test("nodePfad: BRAIN_NODE relativ oder nicht vorhanden → wird ignoriert", () => {
  for (const vorgabe of ["node", "/gibt/es/nicht/node"]) {
    const p = nodePfad({ env: { BRAIN_NODE: vorgabe, PATH: process.env.PATH } });
    assert.notEqual(p, vorgabe);
    assert.equal(realpathSync(p), realpathSync(process.execPath));
  }
});
