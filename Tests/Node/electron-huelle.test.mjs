// Electron-Hülle (Paket W2a, electron/): die Teile ohne Electron — Prüfung der Aktionswerte, Navigationsregel, Umgebung und Brücke zur Werkstatt (echte werkstatt.mjs als Kindprozess).
// Die App selbst (Fenster, Preload, Schema) prüft electron/test/huelle.spec.mjs (Job electron-probe der CI).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, realpathSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const laden = (rel) => import(pathToFileURL(join(W, rel)).href);
const { ortImVault, einzeilig, kopierenText, fehlerOrt, einstieg } = await laden("electron/aktionen.mjs");
const { darfSchliessen } = await laden("electron/schliessen.mjs");
const { pruefeGitAsync } = await laden("electron/git.mjs");
const { beendeBaum } = await laden("Ressourcen/gemeinsam/plattform.mjs");
const { externPruefen, istEigeneAdresse } = await laden("electron/navigation.mjs");
const { baueKindUmgebung, starteBruecke, findeNode } = await laden("electron/bruecke.mjs");
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
  assert.equal(externPruefen("https://example.com:8443/").ok, false, "kein Port");
  assert.equal(externPruefen("https://example.com:443/").ok, true, "Standardport ist keiner");
  assert.equal(externPruefen("http://github.com/", { nurHttps: false, einrichtungOffen: true }).ok, false, "bei offener Einrichtung nur https");
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

test("Umgebung der Werkstatt: ausdrücklich gebaut — nie CLAUDE_CONFIG_DIR, CODEX_HOME, GIT_CONFIG_*, Tokens, BRAIN_VAULT; im Testmodus kein XDG_*", () => {
  const quelle = { PATH: "/usr/bin", HOME: "/h", LANG: "de_DE.UTF-8", LC_ALL: "C", BRAIN_APP_SUPPORT: "/s", KORTEX_X: "1", XDG_CONFIG_HOME: "/x", XDG_DATA_HOME: "/d", BRAIN_VAULT: "/v", BRAIN_MCP_NODE: "/fremd/node",
    CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/o", GIT_CONFIG_GLOBAL: "/g", GIT_CONFIG_COUNT: "1", GITHUB_TOKEN: "t", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", NODE_OPTIONS: "--x", ELECTRON_FOO: "1", DISPLAY: ":0" };
  const normal = baueKindUmgebung(quelle);
  assert.deepEqual(Object.keys(normal).sort(), ["BRAIN_APP_SUPPORT", "HOME", "KORTEX_X", "LANG", "LC_ALL", "PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]);
  assert.equal("ELECTRON_RUN_AS_NODE" in baueKindUmgebung({ ...quelle, ELECTRON_RUN_AS_NODE: "1" }), false, "die Werkstatt läuft mit einem echten Node, nie als Electron");
  assert.equal(baueKindUmgebung(quelle, { node: "/usr/bin/node" }).BRAIN_MCP_NODE, "/usr/bin/node");
  const mitKern = baueKindUmgebung({ ...quelle, KORTEX_KERN_PFAD: "/fremd/kern" }, { kern: "/s/bin/kern" });
  assert.equal(mitKern.KORTEX_KERN_PFAD, "/s/bin/kern");
  assert.equal("KORTEX_KERN_PFAD" in baueKindUmgebung({ ...quelle, KORTEX_KERN_PFAD: "/fremd/kern" }), false, "ein mitgebrachter Kern-Pfad geht nie durch");
  const test = baueKindUmgebung({ ...quelle, BRAIN_TESTMODUS: "1" });
  assert.equal(Object.keys(test).filter((k) => k.startsWith("XDG_")).length, 0);
  for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "NODE_OPTIONS", "ELECTRON_FOO", "BRAIN_VAULT", "BRAIN_MCP_NODE"]) assert.equal(k in normal, false, k);
});

test("Umgebung im Paket: Testschalter und Vorschau fallen weg wie in Swift (NodeUmgebung); die Liste ist dieselbe wie im Swift-Quelltext", () => {
  const liste = JSON.parse(readFileSync(join(W, "electron/test-schalter.json"), "utf8"));
  const swift = readFileSync(join(W, "Sources/BrainCore/NodeUmgebung.swift"), "utf8");
  const aus = (name) => [...new RegExp(`static let ${name}: Set<String> = \\[([\\s\\S]*?)\\n    \\]`).exec(swift)[1].matchAll(/"([A-Z_0-9]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...liste.testSchalter].sort(), aus("testSchalter").sort(), "electron/test-schalter.json gleicht NodeUmgebung.testSchalter");
  assert.equal(liste.testmodus, /static let testmodusName = "([A-Z_]+)"/.exec(swift)[1]);
  assert.ok(aus("gesperrt").includes("KORTEX_VORSCHAU"));
  const quelle = { PATH: "/usr/bin", BRAIN_TESTMODUS: "1", KORTEX_VORSCHAU: "/v", BRAIN_CLAUDE: "/x", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_GITHUB_API: "http://x", BRAIN_ERNTE: "1", KORTEX_GITHUB_CLIENT_ID: "id" };
  assert.deepEqual(Object.keys(baueKindUmgebung(quelle, { gepackt: true })).sort(), ["BRAIN_ERNTE", "KORTEX_GITHUB_CLIENT_ID", "PATH"]);
  assert.equal(baueKindUmgebung(quelle, { gepackt: true, githubClientId: "aus-der-plist" }).KORTEX_GITHUB_CLIENT_ID, "aus-der-plist", "im Paket gilt die ID aus der Info.plist");
  assert.equal(baueKindUmgebung(quelle, { githubClientId: "aus-der-plist" }).KORTEX_GITHUB_CLIENT_ID, "id", "in der Entwicklung darf eine gesetzte Variable überstimmen");
  assert.ok("BRAIN_TESTMODUS" in baueKindUmgebung(quelle), "in der Entwicklung bleiben die Schalter");
});

test("node im PATH: nur absolute Einträge, ausführbare Datei", (t) => {
  const d = temp();
  assert.equal(findeNode(d), null);
  assert.equal(findeNode(""), null);
  if (process.platform === "win32") return t.skip("Windows: node.exe");
  const n = join(d, "node");
  writeFileSync(n, "#!/bin/sh\n"); chmodSync(n, 0o755);
  assert.equal(findeNode(`relativ:${d}`), n);
  assert.equal(findeNode("relativ:."), null);
});

test("kein ELECTRON_RUN_AS_NODE mehr: alsNode gibt es nicht, die Werkstatt kennt kein ohneNode, kindUmgebung gibt ELECTRON_* nie weiter", () => {
  const lauf = () => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `const b = await import(${JSON.stringify(pathToFileURL(join(W, "Ressourcen/gemeinsam/basis.mjs")).href)});
     console.log(JSON.stringify({ als: typeof b.alsNode, kind: b.kindUmgebung({}).ELECTRON_RUN_AS_NODE ?? null }));`],
    { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" }));
  assert.deepEqual(lauf(), { als: "undefined", kind: null });
  for (const datei of ["Ressourcen/werkstatt/werkstatt.mjs", "Ressourcen/werkstatt/handler.mjs", "Ressourcen/gemeinsam/vault.mjs", "electron/bruecke.mjs", "electron/haupt.mjs"]) {
    const text = readFileSync(join(W, datei), "utf8");
    assert.equal(/ohneNode|alsNode/.test(text), false, `${datei}: kein ohneNode/alsNode mehr`);
    assert.equal(/ELECTRON_RUN_AS_NODE\s*=/.test(text) || /ELECTRON_RUN_AS_NODE:\s*"1"/.test(text), false, `${datei}: setzt ELECTRON_RUN_AS_NODE nicht`);
  }
});

test("einrichtung-oeffnen: Einstieg wie EinrichtungsOverlay.einstieg (Swift)", () => {
  assert.equal(einstieg({ ab: "sicherung", weg: null, vaultDa: true, letzterSchritt: null }), "sicherung");
  assert.equal(einstieg({ ab: null, weg: "neu", vaultDa: true, letzterSchritt: "ki" }), null);
  assert.equal(einstieg({ ab: null, weg: null, vaultDa: false, letzterSchritt: "ki" }), null);
  assert.equal(einstieg({ ab: null, weg: null, vaultDa: true, letzterSchritt: null }), "ki");
  assert.equal(einstieg({ ab: null, weg: null, vaultDa: true, letzterSchritt: "vault" }), "ki");
  assert.equal(einstieg({ ab: null, weg: null, vaultDa: true, letzterSchritt: "ki" }), "sicherung");
  assert.equal(einstieg({ ab: null, weg: null, vaultDa: true, letzterSchritt: "sicherung" }), "ki");
});

test("Schließen sichert zuerst: ok → schließen; nicht gespeichert → Rückfrage; Zeitüberschreitung → Rückfrage; ältere Seite oder Fehler → schließen", async () => {
  const zeilen = [];
  const mit = (frage, antwort, extra = {}) => { const fragen = []; return darfSchliessen({ frage, rueckfrage: async (g) => { fragen.push(g); return antwort; }, protokoll: (t) => zeilen.push(t), ...extra }).then((ok) => ({ ok, fragen })); };
  assert.deepEqual(await mit(async () => ({ ok: true }), false), { ok: true, fragen: [] });
  assert.deepEqual(await mit(async () => ({ ok: false, grund: "Konflikt" }), false), { ok: false, fragen: ["Konflikt"] });
  assert.deepEqual(await mit(async () => ({ ok: false, grund: "Konflikt" }), true), { ok: true, fragen: ["Konflikt"] });
  assert.deepEqual(await mit(() => new Promise(() => {}), false, { fristMs: 30 }), { ok: false, fragen: ["Das Sichern dauert zu lange."] });
  assert.deepEqual(await mit(async () => ({ nicht: true }), false), { ok: true, fragen: [] });
  assert.deepEqual(await mit(async () => { throw new Error("weg"); }, false), { ok: true, fragen: [] });
  assert.deepEqual(await mit(async () => ({ ok: false }), false), { ok: false, fragen: ["Das Studio konnte nicht alles sichern."] });
  assert.ok(zeilen.some((z) => z.startsWith("schliessen-ohne-pruefung")));
});

test("git-pruefen: asynchron, nur über den absoluten Pfad und die bereinigte Umgebung", async () => {
  assert.deepEqual(await pruefeGitAsync({ gitPfad: () => null, umgebung: () => ({}) }), { stand: "fehlt" });
  let gesehen;
  const lauf = (pfad, args, opt, cb) => { gesehen = { pfad, args, env: opt.env }; cb(null, "git version 2.50.1\n", ""); };
  assert.deepEqual(await pruefeGitAsync({ gitPfad: () => "/opt/git", umgebung: () => ({ E: "1" }), lauf }), { stand: "vorhanden", version: "2.50.1" });
  assert.deepEqual(gesehen, { pfad: "/opt/git", args: ["--version"], env: { E: "1" } });
  const kaputt = (pfad, args, opt, cb) => cb(Object.assign(new Error("x"), { code: 1 }), "", "kaputt");
  assert.deepEqual(await pruefeGitAsync({ gitPfad: () => "/opt/git", umgebung: () => ({}), lauf: kaputt }), { stand: "defekt", meldung: "kaputt" });
});

test("Brücke: die echte Werkstatt als Kind — bereit, Anfrage und Antwort, Studio-Seite, sauberes Ende", async () => {
  const home = temp(), vault = join(home, "vault");
  mkdirSync(join(home, "support")); mkdirSync(vault);
  writeFileSync(join(vault, "n.md"), "# N\n");
  const env = { ...baueKindUmgebung({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    BRAIN_APP_SUPPORT: join(home, "support"), BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle" }) };
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

test("Brücke: stirbt die Werkstatt vor dem ersten „bereit“ (Vault fehlt), wird bereit abgelehnt — mit Grund, ohne Neustart", async () => {
  const home = temp();
  mkdirSync(join(home, "support"));
  const env = baueKindUmgebung({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"), BRAIN_APP_SUPPORT: join(home, "support"), BRAIN_TESTMODUS: "1" });
  const zeilen = [];
  const b = starteBruecke({ programm: process.execPath, skript: join(W, "Ressourcen/werkstatt/werkstatt.mjs"), vault: join(home, "gibt-es-nicht"), env, protokoll: (z) => zeilen.push(z) });
  await assert.rejects(b.bereit, /endete vor dem Start \(2\)/);
  assert.equal(zeilen.filter((z) => z.startsWith("werkstatt beendet")).length, 1, "kein Neustart");
  await b.beende();
});

test("Brücke: eine Anfrage ohne Antwort endet nach der Frist (code frist, Eintrag aufgeräumt); beende() wartet nicht endlos und beendet den Prozess", async () => {
  const d = temp();
  const skript = join(d, "stumm.mjs");
  // meldet „bereit“, antwortet nie und ignoriert das Ende von stdin
  writeFileSync(skript, 'process.stdout.write(JSON.stringify({ bereit: true, version: "t", vaultId: null }) + "\\n"); process.stdin.resume(); setInterval(() => {}, 1000);');
  const b = starteBruecke({ programm: process.execPath, skript, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, fristMs: 150, hartMs: 300, beendeBaum });
  await b.bereit;
  await assert.rejects(b.anfrage({ methode: "GET", pfad: "/x" }), (e) => e.code === "frist");
  const t = Date.now();
  await b.beende();
  assert.ok(Date.now() - t < 5000, "beende() hängt nicht");
  assert.equal(b.lebt(), false);
});
