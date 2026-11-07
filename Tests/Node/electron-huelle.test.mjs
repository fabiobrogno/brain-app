// Electron-Hülle (Paket W2a, electron/): die Teile ohne Electron — Prüfung der Aktionswerte, Navigationsregel, Umgebung und Brücke zur Werkstatt (echte werkstatt.mjs als Kindprozess).
// Die App selbst (Fenster, Preload, Schema) prüft electron/test/huelle.spec.mjs (Job electron-probe der CI).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const laden = (rel) => import(pathToFileURL(join(W, rel)).href);
const { ortImVault, einzeilig, kopierenText, fehlerOrt } = await laden("electron/aktionen.mjs");
const { externPruefen, istEigeneAdresse } = await laden("electron/navigation.mjs");
const { baueKindUmgebung, starteBruecke } = await laden("electron/bruecke.mjs");
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "kortex-electron-test-")));

test("ordner-zeigen: nur Pfade im Vault, auch nach dem Auflösen von Verknüpfungen", (t) => {
  const vault = temp(), aussen = temp();
  mkdirSync(join(vault, "a"));
  writeFileSync(join(vault, "a", "n.md"), "x");
  assert.equal(ortImVault("a/n.md", vault), join(vault, "a", "n.md"));
  assert.equal(ortImVault("a/neu.md", vault), join(vault, "a", "neu.md"), "auch eine Datei, die es noch nicht gibt");
  for (const schlecht of ["", "/etc/passwd", "../x", "a/../../x", "C:\\x", "\\\\server\\x", "a\0b", 5, null, undefined]) assert.equal(ortImVault(schlecht, vault), null, String(schlecht));
  try { symlinkSync(aussen, join(vault, "raus"), "junction"); } catch { return t.skip("keine Verknüpfungen möglich"); }
  assert.equal(ortImVault("raus/geheim.md", vault), null, "Verknüpfung nach außen");
  assert.equal(ortImVault("a", null), null);
});

test("extern: https; Links der Seite auch http; bei offener Einrichtung nur GitHub und Anmelde-Domänen; nie Zugangsdaten in der Adresse", () => {
  assert.equal(externPruefen("https://example.com/a?b=1").ok, true);
  assert.equal(externPruefen("http://example.com/").ok, false);
  assert.equal(externPruefen("http://example.com/", { nurHttps: false }).ok, true);
  for (const s of ["file:///etc/passwd", "javascript:alert(1)", "https://", "ftp://x.de/", "kortex://studio/", "https://u:p@example.com/", "mailto:a@b.de", "", null, 5]) assert.equal(externPruefen(s, { nurHttps: false }).ok, false, String(s));
  const e = { einrichtungOffen: true };
  for (const s of ["https://github.com/login/device", "https://claude.ai/login", "https://console.anthropic.com/x", "https://auth.openai.com/", "https://chatgpt.com/"]) assert.equal(externPruefen(s, e).ok, true, s);
  for (const s of ["https://example.com/", "https://evilclaude.ai/", "https://claude.ai.evil.com/", "https://github.com.evil.com/"]) assert.equal(externPruefen(s, e).ok, false, s);
});

test("eigene Adresse: genau kortex://studio (kein Port, kein Benutzer, kein anderer Host)", () => {
  assert.equal(istEigeneAdresse("kortex://studio/"), true);
  assert.equal(istEigeneAdresse("kortex://studio/?pfad=a.md"), true);
  for (const s of ["kortex://anders/", "kortex://studio:80/", "kortex://u@studio/", "https://studio/", "file:///x", "data:text/html,x", "kortex://studio.evil.com/", "", undefined]) assert.equal(istEigeneAdresse(s), false, String(s));
});

test("Texte: einzeilig und gekürzt, kopieren streng, Ort ohne Query", () => {
  assert.equal(einzeilig("a\nb\u202ec", 10), "a bc");
  assert.equal(einzeilig("   ", 10), null);
  assert.equal(einzeilig("äöüß🙂xyz", 5), "äöüß🙂");
  assert.equal(kopierenText("ABCD-1234"), "ABCD-1234");
  for (const s of ["", " ", "a\nb", "a\tb", "a\u202eb", "x".repeat(401), 5, null]) assert.equal(kopierenText(s), null, JSON.stringify(s));
  assert.equal(kopierenText("x".repeat(400)).length, 400);
  assert.equal(fehlerOrt("app.js:1:2?x=geheim y"), "app.js:1:2");
  assert.equal(fehlerOrt("   "), null);
});

test("Umgebung der Werkstatt: ausdrücklich gebaut — nie CLAUDE_CONFIG_DIR, CODEX_HOME, GIT_CONFIG_*, Tokens; im Testmodus kein XDG_*", () => {
  const quelle = { PATH: "/usr/bin", HOME: "/h", LANG: "de_DE.UTF-8", LC_ALL: "C", BRAIN_APP_SUPPORT: "/s", KORTEX_X: "1", XDG_CONFIG_HOME: "/x", XDG_DATA_HOME: "/d",
    CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/o", GIT_CONFIG_GLOBAL: "/g", GIT_CONFIG_COUNT: "1", GITHUB_TOKEN: "t", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", NODE_OPTIONS: "--x", ELECTRON_FOO: "1", DISPLAY: ":0" };
  const normal = baueKindUmgebung(quelle);
  assert.deepEqual(Object.keys(normal).sort(), ["BRAIN_APP_SUPPORT", "ELECTRON_RUN_AS_NODE", "HOME", "KORTEX_X", "LANG", "LC_ALL", "PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]);
  assert.equal(normal.ELECTRON_RUN_AS_NODE, "1");
  const test = baueKindUmgebung({ ...quelle, BRAIN_TESTMODUS: "1" });
  assert.equal(Object.keys(test).filter((k) => k.startsWith("XDG_")).length, 0);
  for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "NODE_OPTIONS", "ELECTRON_FOO"]) assert.equal(k in normal, false, k);
});

test("kindUmgebung (gemeinsam/basis.mjs): ELECTRON_RUN_AS_NODE nur weiterreichen, wenn der Prozess selbst Electron-als-Node ist", () => {
  const lauf = (env, mitElectron) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `${mitElectron ? "Object.defineProperty(process.versions, 'electron', { value: '45.0.0', configurable: true });" : ""}
     const { kindUmgebung } = await import(${JSON.stringify(pathToFileURL(join(W, "Ressourcen/gemeinsam/basis.mjs")).href)});
     const e = kindUmgebung({}); console.log(JSON.stringify({ ar: e.ELECTRON_RUN_AS_NODE ?? null, andere: Object.keys(e).filter((k) => k.startsWith("ELECTRON_") && k !== "ELECTRON_RUN_AS_NODE") }));`],
    { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: "utf8" }));
  assert.deepEqual(lauf({ ELECTRON_RUN_AS_NODE: "1", ELECTRON_X: "1" }, true), { ar: "1", andere: [] });
  assert.deepEqual(lauf({ ELECTRON_RUN_AS_NODE: "1", ELECTRON_X: "1" }, false), { ar: null, andere: [] });
  assert.deepEqual(lauf({}, true), { ar: null, andere: [] });
});

test("Brücke: die echte Werkstatt als Kind — bereit, Anfrage und Antwort, Studio-Seite, sauberes Ende", async () => {
  const home = temp(), vault = join(home, "vault");
  mkdirSync(join(home, "support")); mkdirSync(vault);
  writeFileSync(join(vault, "n.md"), "# N\n");
  const env = { ...baueKindUmgebung({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    BRAIN_APP_SUPPORT: join(home, "support"), BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle" }) };
  delete env.ELECTRON_RUN_AS_NODE; // hier läuft ein echtes Node
  const b = starteBruecke({ programm: process.execPath, skript: join(W, "Ressourcen/werkstatt/werkstatt.mjs"), vault, env });
  try {
    const bereit = await b.bereit;
    assert.equal(typeof bereit.version, "string");
    const info = await b.anfrage({ methode: "GET", pfad: "/api/info" });
    assert.equal(info.status, 200);
    assert.equal(realpathSync(JSON.parse(info.body.toString()).vault), vault);
    const seite = await b.anfrage({ methode: "GET", pfad: "/" });
    assert.equal(seite.status, 200);
    assert.match(seite.headers["Content-Type"], /text\/html/);
    assert.match(seite.body.toString(), /<html/i);
    assert.ok(seite.headers["Content-Security-Policy"], "die CSP der Werkstatt kommt mit");
    const schreib = await b.anfrage({ methode: "PUT", pfad: "/api/datei", body: Buffer.from(JSON.stringify({ pfad: "n.md", inhalt: "# N\nneu\n" })) });
    assert.ok(schreib.status >= 200 && schreib.status < 500, `Schreiben antwortet (${schreib.status})`);
    const viele = await Promise.all(Array.from({ length: 20 }, () => b.anfrage({ methode: "GET", pfad: "/api/info" })));
    assert.ok(viele.every((r) => r.status === 200), "gleichzeitige Anfragen werden richtig zugeordnet");
  } finally {
    await b.beende();
  }
  assert.equal(b.lebt(), false);
  await assert.rejects(b.anfrage({ methode: "GET", pfad: "/api/info" }), /beendet/);
});
