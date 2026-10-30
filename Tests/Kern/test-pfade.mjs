import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { join, dirname, relative, basename, isAbsolute, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { vaultPfad, pruefeVault, vaultUndRest, shellQuote, stabilerKern, kernStabil, KernNichtStabilFehler, nimmVaultArg, KeinVaultFehler, KERN, ALT_KIT_ORDNER, kernVersion, kernAnzeige, supportOrte, supportOrdner, kitOrte, aktiverVaultAusListe, evalFragenDatei, holdoutDatei, ordner, renderVorlage, nodeBefehl, nodePfad, gitAnzeige, ladeConfig, configFehler, liesConfigRoh, entferneBom } from "../pfade.mjs";
import { createHash } from "node:crypto";

// Ein gültiger Vault: existierender Ordner mit brain.config.json
const gueltig = (v = neu()) => { writeFileSync(join(v, "brain.config.json"), "{}"); return v; };
const neu = () => { const v = join(mkdtempSync(join(tmpdir(), "brain pfad ")), "Mein Brain"); mkdirSync(v); return v; };

test("Defaults = heutige Ordnernamen", () => {
  const v = neu(); writeFileSync(join(v, "brain.config.json"), "{}");
  assert.deepEqual(ordner(v), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv", aufgaben: "05_aufgaben" });
});
test("Config überschreibt Ordnernamen, alter Schlüssel wiki.ordner gilt weiter", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { inbox: "inbox", archiv: "archiv" }, wiki: { ordner: "wiki" } }));
  assert.deepEqual(ordner(v), { inbox: "inbox", wiki: "wiki", archiv: "archiv", aufgaben: "05_aufgaben" });
});
const ohneUmgebung = (extra = {}) => ({ ...process.env, BRAIN_VAULT: "", BRAIN_APP_SUPPORT: join(tmpdir(), "pfad-test-leer-nie-vorhanden"), ...extra });

test("KERN ist der Ordner der Datei selbst (nie der Vault, nie das Elternverzeichnis)", () => {
  assert.equal(KERN, dirname(fileURLToPath(new URL("../pfade.mjs", import.meta.url))));
});
test("Vault: --vault vor Positionsargument vor BRAIN_VAULT vor der App-Liste; jeder Pfad kommt absolut zurück", () => {
  const [f, a, e, l] = [gueltig(), gueltig(), gueltig(), gueltig()];
  const support = mkdtempSync(join(tmpdir(), "pfad-support "));
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: l }], aktiv: l }));
  const env = { BRAIN_VAULT: e, BRAIN_APP_SUPPORT: support };
  assert.equal(vaultPfad(["node", "s", "--vault", f, a], { env }), f);
  assert.equal(vaultPfad(["node", "s", `--vault=${f}`], { env }), f);
  assert.equal(vaultPfad(["node", "s", a], { env }), a);
  assert.equal(vaultPfad(["node", "s", "--flag"], { env }), e);
  assert.equal(vaultPfad(["node", "s"], { env: { BRAIN_VAULT: "", BRAIN_APP_SUPPORT: support } }), l);
  // relativ angegeben → absolut (resolve), BRAIN_VAULT ebenso
  const rel = relative(process.cwd(), f);
  assert.equal(vaultPfad(["node", "s", rel], { env: {} }), f);
  assert.equal(vaultPfad(["node", "s"], { env: { BRAIN_VAULT: rel, BRAIN_APP_SUPPORT: support } }), f);
  assert.ok(isAbsolute(vaultPfad(["node", "s", "--vault", rel], { env: {} })));
});
test("Geister-Vault: ein angegebener Vault muss ein existierender Ordner mit brain.config.json sein — sonst Fehler, nie ein Ausweichen auf den aktiven Vault", () => {
  const aktiv = gueltig();
  const support = mkdtempSync(join(tmpdir(), "pfad-support "));
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: aktiv }], aktiv }));
  const env = { BRAIN_APP_SUPPORT: support };
  const ohneConfig = neu();
  const datei = join(neu(), "datei.txt"); writeFileSync(datei, "x");
  for (const [argv, e] of [
    [["node", "s", "--vault", join(tmpdir(), "gibt-es-nicht-vault")], env],
    [["node", "s", join(tmpdir(), "gibt-es-nicht-vault")], env],
    [["node", "s"], { ...env, BRAIN_VAULT: join(tmpdir(), "gibt-es-nicht-vault") }],
    [["node", "s", "--vault", ohneConfig], env],
    [["node", "s", "--vault", datei], env],
  ]) assert.throws(() => vaultPfad(argv, { env: e }), (x) => x instanceof KeinVaultFehler && /Vault nicht gefunden|kein Kortex-Vault/.test(x.message), JSON.stringify(argv));
  assert.equal(pruefeVault(aktiv), aktiv);
});
test("Geister-Vault: ein Symlink auf einen Vault gilt (aufgelöst geprüft), ein kaputter Symlink nicht", { skip: process.platform === "win32" }, () => {
  const echt = gueltig(), dir = mkdtempSync(join(tmpdir(), "pfad-link "));
  symlinkSync(echt, join(dir, "gut")); symlinkSync(join(dir, "fehlt"), join(dir, "kaputt"));
  assert.equal(pruefeVault(join(dir, "gut")), join(dir, "gut"));
  assert.throws(() => pruefeVault(join(dir, "kaputt")), KeinVaultFehler);
});

test("Vault: nichts gefunden → KeinVaultFehler, nie ~/brain und nie der Ort des Kerns", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-home "));
  mkdirSync(join(home, "brain")); writeFileSync(join(home, "brain", "brain.config.json"), "{}");   // ein Ordner ~/brain darf NICHT als Vault gelten
  assert.throws(() => vaultPfad(["node", "s"], { env: { BRAIN_APP_SUPPORT: join(home, "leer") } }), (e) => e instanceof KeinVaultFehler && e.code === "KEIN_VAULT" && /--vault/.test(e.message));
  assert.throws(() => vaultPfad(["node", "s", "--flag"], { env: { BRAIN_VAULT: "", BRAIN_APP_SUPPORT: join(home, "leer") } }), KeinVaultFehler);
});

test("vaults.json (Leseregel der Werkstatt): aktiv zählt nur bei einem Eintrag mit absolutem Pfad und gültigem Vault; defekt/leer/null ergeben keinen Vault", () => {
  const s = mkdtempSync(join(tmpdir(), "pfad-liste "));
  const [a, b] = [gueltig(), gueltig()];
  const lies = () => aktiverVaultAusListe({ env: { BRAIN_APP_SUPPORT: s } });
  assert.equal(lies(), null);                                                                       // keine Datei
  writeFileSync(join(s, "vaults.json"), "{ kaputt"); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: "x", aktiv: a })); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: a }, { pfad: "relativ" }], aktiv: b })); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: a }], aktiv: null })); assert.equal(lies(), null);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: join(a, "..", basename(a)) }, { pfad: b }], aktiv: a })); assert.equal(lies(), a);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: a }, { pfad: b }], aktiv: b })); assert.equal(lies(), b);
});
test("vaults.json: ein aktiver Eintrag ohne existierenden Ordner oder ohne brain.config.json ist kein Vault (Geister-Vault)", () => {
  const s = mkdtempSync(join(tmpdir(), "pfad-liste "));
  const lies = () => aktiverVaultAusListe({ env: { BRAIN_APP_SUPPORT: s } });
  const weg = join(tmpdir(), "abgezogener-stick-vault");
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: weg }], aktiv: weg })); assert.equal(lies(), null);
  const leer = neu();
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ pfad: leer }], aktiv: leer })); assert.equal(lies(), null);
  gueltig(leer); assert.equal(lies(), leer);
});
test("vaults.json: Ortsregeln — Home selbst, Systemordner, .git/node_modules/.app im Pfad, versteckte Ordner unter dem Home und der App-Ordner sind nie ein Vault", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-home "));
  const support = mkdtempSync(join(tmpdir(), "pfad-support "));
  const mk = (rel) => { const d = join(home, rel); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "brain.config.json"), "{}"); return d; };
  const gut = mk("Dokumente/Brain");
  const lies = (pfad) => { writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad }], aktiv: pfad })); return aktiverVaultAusListe({ env: { BRAIN_APP_SUPPORT: support }, home }); };
  assert.equal(lies(gut), gut);
  for (const schlecht of [home, mk(".versteckt/vault"), mk("proj/.git/vault"), mk("proj/node_modules/v"), mk("Programm.app/v"), "/", "/usr/local/vault", "/System/Library"]) assert.equal(lies(schlecht), null, schlecht);
  const imApp = join(support, "vault"); mkdirSync(imApp); writeFileSync(join(imApp, "brain.config.json"), "{}");
  assert.equal(lies(imApp), null, "der interne Ordner der App");
});
test("vaults.json: eine defekte Kortex-Datei fällt nicht auf die Liste in …/Brain zurück; eine fehlende schon; config.json desselben Ordners als Rückfall", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-home ")), v = gueltig();
  const basis = join(home, "Library", "Application Support");
  const kortex = join(basis, "Kortex"), brain = join(basis, "Brain");
  mkdirSync(kortex, { recursive: true }); mkdirSync(brain, { recursive: true });
  const opt = { env: {}, home, plattform: "darwin" };
  writeFileSync(join(brain, "vaults.json"), JSON.stringify({ vaults: [{ pfad: v }], aktiv: v }));
  assert.equal(aktiverVaultAusListe(opt), v, "Kortex-Datei fehlt → alte Liste");
  writeFileSync(join(kortex, "vaults.json"), "{ kaputt");
  assert.equal(aktiverVaultAusListe(opt), null, "Kortex-Datei defekt → kein Rückfall");
  writeFileSync(join(kortex, "config.json"), JSON.stringify({ vault: v }));
  assert.equal(aktiverVaultAusListe(opt), v, "defekt, aber config.json desselben Ordners (wie die Werkstatt)");
});

test("Support-Ordner: BRAIN_APP_SUPPORT (nur absolut) allein, sonst Kortex vor dem alten Brain; Kit-Orte mit Rückfall ~/.brain-kit", () => {
  assert.deepEqual(supportOrte({ env: { BRAIN_APP_SUPPORT: "/t/s" }, home: "/h" }), ["/t/s"]);
  assert.deepEqual(supportOrte({ env: { BRAIN_APP_SUPPORT: "relativ" }, home: "/h", plattform: "darwin" }), ["/h/Library/Application Support/Kortex", "/h/Library/Application Support/Brain"]);
  assert.equal(supportOrdner({ env: {}, home: "/h", plattform: "darwin" }), "/h/Library/Application Support/Kortex");
  assert.deepEqual(kitOrte({ env: {}, home: "/h", plattform: "darwin" }), ["/h/Library/Application Support/Kortex", "/h/.brain-kit"]);
});
test("--vault wird aus der Kommandozeile genommen (nimmVaultArg), auch hinter anderen Argumenten; bei „--“ ist Schluss; ein Wert mit „-“ ist ungültig", () => {
  const a = ["node", "s", "search", "--vault", "/v", "frage"];
  assert.equal(nimmVaultArg(a), "/v");
  assert.deepEqual(a, ["node", "s", "search", "frage"]);
  const b = ["node", "s", "--vault"]; assert.equal(nimmVaultArg(b), null); assert.deepEqual(b, ["node", "s", "--vault"]);
  const c = ["node", "s", "suche", "--", "--vault", "/v"]; assert.equal(nimmVaultArg(c), null, "hinter -- ist es ein gewöhnliches Argument"); assert.deepEqual(c, ["node", "s", "suche", "--", "--vault", "/v"]);
  const d = ["node", "s", "--vault", "--json", "x"]; assert.equal(nimmVaultArg(d), null); assert.deepEqual(d, ["node", "s", "--vault", "--json", "x"], "Werte mit führendem - werden nicht verschluckt");
  const e = ["node", "s", "--vault=-x"]; assert.equal(nimmVaultArg(e), null);
  const gut = gueltig();
  assert.throws(() => vaultPfad(["node", "s", "--vault", "--json"], { env: { BRAIN_VAULT: gut } }), (x) => x instanceof KeinVaultFehler && /--vault braucht/.test(x.message), "kein stilles Ausweichen auf BRAIN_VAULT");
  assert.throws(() => vaultPfad(["node", "s", "--vault=-x"], { env: { BRAIN_VAULT: gut } }), KeinVaultFehler);
});
test("vaultUndRest: erstes Argument ist der Vault (auch relativ, auch ohne „/“), sofern es kein Befehl ist; er wird geprüft und nie durch den aktiven Vault ersetzt", () => {
  const v = gueltig(), cwd = process.cwd();
  const mitCwd = (dir, f) => { process.chdir(dir); try { return f(); } finally { process.chdir(cwd); } };
  const istBefehl = (a) => a === "liste" || a === "antwort";
  const r = vaultUndRest([v, "liste", "x"], istBefehl);
  assert.deepEqual([r.vault, r.rest], [v, ["liste", "x"]]);
  const rel = mitCwd(dirname(v), () => vaultUndRest([basename(v), "liste"], istBefehl));
  assert.deepEqual([realpathSync(r.vault), realpathSync(rel.vault)], [realpathSync(v), realpathSync(v)]);
  assert.ok(isAbsolute(rel.vault));
  assert.equal(vaultUndRest(["liste"], istBefehl, { env: { BRAIN_VAULT: v } }).vault, v);
  // ein angegebener, aber ungültiger Vault führt zum Fehler (hier: Exit-Pfad als Ausnahme geprüft über vaultPfad), nicht zum Ausweichen
  assert.throws(() => vaultPfad(["", "", join(tmpdir(), "gibt-es-nicht")], { env: { BRAIN_VAULT: v } }), KeinVaultFehler);
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
test("kernAnzeige: ein vorhandener, stabiler KORTEX_KERN_PFAD geht vor dem tatsächlichen Ort; {{KERN}}/{{DATEN}} werden gerendert", () => {
  const stabil = mkdtempSync(join(tmpdir(), "kortex-pfad-test-")), ohneTemp = ["/gibt-es-nicht-als-temp"];   // der Testordner liegt im Temp: Temp-Wurzeln für diesen Test ersetzen
  try {
    assert.equal(kernAnzeige({ env: {} }), KERN.split("\\").join("/"));
    assert.equal(kernAnzeige({ env: { KORTEX_KERN_PFAD: stabil }, tempWurzeln: ohneTemp }), stabil.split("\\").join("/"));
    assert.equal(kernAnzeige({ env: { KORTEX_KERN_PFAD: "relativ" } }), KERN.split("\\").join("/"));
    assert.equal(kernAnzeige({ env: { KORTEX_KERN_PFAD: join(stabil, "fehlt") } }), KERN.split("\\").join("/"), "nicht vorhanden → tatsächlicher Ort (nur Anzeige)");
  } finally { rmSync(stabil, { recursive: true, force: true }); }
  const v = gueltig();
  const r = renderVorlage('"{{KERN}}/brain.mjs" --vault "{{VAULT}}" · {{DATEN}}', v);
  if (process.platform !== "win32") assert.ok(r.startsWith(`'${KERN}/brain.mjs' --vault '${v}'`), r);
  assert.doesNotMatch(r, /\{\{/);
});
test("kernStabil: nur ein vorhandener Pfad außerhalb von .app, Temp und Worktrees; sonst Fehler — nie ein stiller Rückfall auf den Ort des Kerns", () => {
  const stabil = mkdtempSync(join(tmpdir(), "kortex-pfad-test-")), ohneTemp = ["/gibt-es-nicht-als-temp"];
  try {
    assert.equal(stabilerKern({ env: { KORTEX_KERN_PFAD: stabil }, tempWurzeln: ohneTemp }), stabil);
    assert.equal(kernStabil({ env: { KORTEX_KERN_PFAD: stabil }, tempWurzeln: ohneTemp }), stabil);
    assert.equal(stabilerKern({ env: { KORTEX_KERN_PFAD: stabil } }), null, "unter dem echten Temp-Ordner ist er unbeständig");
    const app = join(stabil, "Kortex.app", "Contents", "kern"); mkdirSync(app, { recursive: true });
    const wt = join(stabil, ".claude", "worktrees", "x", "kern"); mkdirSync(wt, { recursive: true });
    for (const schlecht of [undefined, "", "relativ/kern", join(stabil, "fehlt"), app, wt]) {
      const env = schlecht === undefined ? {} : { KORTEX_KERN_PFAD: schlecht };
      assert.equal(stabilerKern({ env, tempWurzeln: ohneTemp }), null, String(schlecht));
      assert.throws(() => kernStabil({ env, tempWurzeln: ohneTemp }), (e) => e instanceof KernNichtStabilFehler && e.code === "KERN_NICHT_STABIL" && /stabilen Kern-Pfad/.test(e.message), String(schlecht));
    }
    // unter dem echten Temp-Ordner (Standard-Temp-Wurzeln) ist selbst ein vorhandener Ordner unbeständig
    for (const temp of [tmpdir(), mkdtempSync(join(tmpdir(), "kern-"))]) assert.equal(stabilerKern({ env: { KORTEX_KERN_PFAD: temp } }), null, temp);
    // Testschalter: erlaubt den tatsächlichen Ort ausdrücklich
    assert.equal(kernStabil({ env: { KORTEX_KERN_UNSTABIL_ERLAUBT: "1" } }), KERN);
  } finally { rmSync(stabil, { recursive: true, force: true }); }
});
test("shellQuote: $(), Backtick, \", ', Leerzeichen und Zeilenumbruch bleiben Daten — von einer echten Shell ausgewertet kommt genau der Wert heraus", { skip: process.platform === "win32" }, () => {
  const marke = join(mkdtempSync(join(tmpdir(), "pfad-inj ")), "pwned");
  for (const wert of ["a b", `x$(touch ${marke})y`, "`touch " + marke + "`", 'dq"dq', "it's", "a'b'c", "$HOME ${HOME} ~", "zeile1\nzeile2", "\\ \\\\ *", `'; touch ${marke}; '`]) {
    const r = spawnSync("/bin/sh", ["-c", `printf %s ${shellQuote(wert)}`], { encoding: "utf8" });
    assert.equal(r.stdout, wert, JSON.stringify(wert));
  }
  assert.ok(!existsSync(marke), "kein eingeschleuster Befehl ist gelaufen");
  assert.equal(shellQuote("C:\\a b\\c", "win32"), '"C:/a b/c"');
});
test("renderVorlage: Vault-Pfade mit $(), Backtick, \" und ' stehen in Befehlen POSIX-sicher gequotet — nichts läuft beim Ausführen", { skip: process.platform === "win32" }, () => {
  const arbeitsdir = mkdtempSync(join(tmpdir(), "pfad-inj2 "));   // eine Injektion würde hier „pwned1“/„pwned2“ anlegen
  const v = join(mkdtempSync(join(tmpdir(), "pfad-vault ")), `Mein "Brain" it's $(touch pwned1) \`touch pwned2\``);
  mkdirSync(v); writeFileSync(join(v, "brain.config.json"), "{}");
  const r = renderVorlage('{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" jetzt', v);
  const zeile = r.replace(/^'[^']*(?:'\\''[^']*)*' /, "");   // ohne {{NODE}}
  // die Shell zerlegt die Argumente; der Vault muss als EIN unverändertes Argument ankommen
  const ausgabe = spawnSync("/bin/sh", ["-c", `set -- ${zeile}; printf '%s\n' "$#" "$2" "$3"`], { encoding: "utf8", cwd: arbeitsdir });
  const [anzahl, flag, wert] = ausgabe.stdout.split("\n");
  assert.equal(anzahl, "4");
  assert.equal(flag, "--vault");
  assert.equal(wert, v);
  assert.deepEqual(readdirSync(arbeitsdir), [], "kein eingeschleuster Befehl ist gelaufen");
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
test("renderVorlage: {{GIT}} ignoriert werkzeuge.git aus der Vault-Config (Programme kommen nie aus dem Vault, P4)", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ werkzeuge: { git: "/ein/privater/git" } }));
  const r = renderVorlage("{{GIT}}", v);
  assert.equal(r, "git");
});
test("gitAnzeige: ohne Config fällt auf den bisherigen Rückfall zurück (win32-MinGit-Ort bzw. nacktes 'git')", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-git-"));
  assert.equal(gitAnzeige({ cfg: {}, plattform: "darwin", home }), "git");
  mkdirSync(join(home, ".brain-kit", "git", "cmd"), { recursive: true });
  writeFileSync(join(home, ".brain-kit", "git", "cmd", "git.exe"), "");
  // Anzeige-Strings tragen immer "/" (auch unter Windows), darum hier ebenso
  assert.equal(gitAnzeige({ cfg: {}, plattform: "win32", home }), `"${join(home, ".brain-kit", "git", "cmd", "git.exe").split("\\").join("/")}"`);
  // eine Angabe aus der Config zählt nicht
  assert.equal(gitAnzeige({ cfg: { werkzeuge: { git: "/x/git" } }, plattform: "darwin", home }), "git");
});
test("ordner(): nur ein einzelnes relatives Segment — '../aussen', Absolutes, Pfade, Shell-Zeichen fallen auf den Standard (landen so nie in Pfaden, Hooks, gerenderten Texten)", () => {
  const v = neu();
  const mit = (o) => ordner(v, o);
  assert.deepEqual(mit({ ordner: { inbox: "../aussen", wiki: "/tmp/x", archiv: "a/b", aufgaben: "../x" } }), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv", aufgaben: "05_aufgaben" });
  assert.deepEqual(mit({ ordner: { inbox: "..", wiki: ".", archiv: "" } }), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv", aufgaben: "05_aufgaben" });
  assert.deepEqual(mit({ ordner: { wiki: "$(evil)", inbox: "x y", archiv: "a;b" } }), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv", aufgaben: "05_aufgaben" });
  assert.equal(mit({ wiki: { ordner: "../aussen" } }).wiki, "09_wiki", "auch der ältere Schlüssel wiki.ordner");
  assert.equal(mit({ ordner: { wiki: "../aussen" }, wiki: { ordner: "Wissen" } }).wiki, "Wissen", "ungültig → nächster Schlüssel → Standard");
  assert.deepEqual(mit({ ordner: { inbox: "Eingang_Ü", wiki: "wiki-1.x", archiv: "90_archiv", aufgaben: "Todo" } }), { inbox: "Eingang_Ü", wiki: "wiki-1.x", archiv: "90_archiv", aufgaben: "Todo" });
  assert.deepEqual(mit({ ordner: { inbox: 5, wiki: null, archiv: ["x"] } }), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv", aufgaben: "05_aufgaben" });
});
test("renderVorlage: {{WIKI}}/{{INBOX}}/{{ARCHIV}} aus einer Vault-Config mit Pfad oder Shell-Zeichen werden zum Standard (Prompt-Injection in ~/.claude*/commands)", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { wiki: "../../.claude/commands", inbox: "x`id`", archiv: "a/../b" } }));
  assert.equal(renderVorlage("{{WIKI}}|{{INBOX}}|{{ARCHIV}}", v), "09_wiki|00_inbox|90_archiv");
});
test("pruefeVault: Schreibziele, die per Verweis aus dem Vault hinauszeigen, machen ihn unbrauchbar (auch ein Verweis ins Leere)", () => {
  const v = neu(), aussen = mkdtempSync(join(tmpdir(), "pfad-aussen-"));
  writeFileSync(join(v, "brain.config.json"), "{}");
  assert.equal(pruefeVault(v), resolve(v));
  for (const [rel, ziel] of [[".logs", aussen], ["AGENTS.md", join(aussen, "gibt-es-nicht")], ["graph.json", join(aussen, "g.json")], ["09_wiki", aussen]]) {
    rmSync(join(v, rel), { recursive: true, force: true });
    execFileSync("ln", ["-s", ziel, join(v, rel)]); // nach pruefeVault sind die fs-Verweisfunktionen selbst geschützt
    assert.throws(() => pruefeVault(v), /zeigt aus dem Ordner hinaus/, rel);
    rmSync(join(v, rel), { force: true });
  }
  // ein Verweis innerhalb des Vaults ist in Ordnung
  mkdirSync(join(v, "echt")); execFileSync("ln", ["-s", join(v, "echt"), join(v, ".logs")]);
  assert.equal(pruefeVault(v), resolve(v));
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
