// Härtung der KI-Konten nach dem Sicherheitsreview (P1+P2): Regressionstests, je Punkt mindestens einer. Die Proben des Reviews (P1–P7, Sperre, Zurücksetzen) sind hier übernommen.
// Grundsatz (auch in Plan und Oberfläche): Die Konto-Kennung ist eine Selbstauskunft, keine Anmeldung. Durchgesetzt wird nur über Leseverbote und den Strengen Schutz samt Schutz der eigenen
// Einstellungsdateien. Alle Kindprozess-Umgebungen über baueTestUmgebung, nur Wegwerf-Orte unter dem Temp-Ordner, kein echter claude-Aufruf.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, realpathSync, symlinkSync, rmSync, readdirSync, existsSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const S = await import(pfad("gemeinsam", "claude-sperre.mjs"));
const { erzeugeKonten } = await import(pfad("werkstatt", "konten.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erzeugeZugriff } = await import(pfad("mcp", "brain-mcp.mjs"));
const { walk } = await import(pfad("kern", "vault-dateien.mjs"));

const kinder = [];
after(() => { for (const k of kinder) try { k.kill("SIGKILL"); } catch { /* weg */ } });
const GEHEIM = "Geheimprojekt-Nordlicht";
const leak = (t) => String(t).includes(GEHEIM);

// ───────────── Aufbau: zwei Claude-Profile (a, b) und das Standardprofil (std), zwei Vaults (offen, zu) ─────────────
function szenario({ verschachtelt = false } = {}) {
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const offen = realpathSync(tmp("vault-offen-"));
  const zu = verschachtelt ? join(offen, "privat") : realpathSync(tmp("vault-zu-"));
  mkdirSync(zu, { recursive: true });
  for (const [v, t] of [[offen, "Das Zebra frisst Gras."], [zu, `${GEHEIM} ist vertraulich.`]]) { schreibe(v, "brain.config.json", "{}\n"); schreibe(v, "09_wiki/w/thema.md", `# Thema\n\n${t}\n`); }
  const profil = (n) => { const p = join(home, n ? `.claude-${n}` : ".claude"); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil("a"), b = profil("b"), std = profil("");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Offen", pfad: offen }, { name: "Zu", pfad: zu }], aktiv: offen }));
  const liste = (stufen, extra = {}) => K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "A", ordnerKennung: K.kennungVon(a) },
              k_bbbbbbbb: { programm: "claude", ordner: b, standard: false, name: "B", ordnerKennung: K.kennungVon(b) },
              k_cccccccc: { programm: "claude", ordner: std, standard: true, name: "Std", ordnerKennung: K.kennungVon(std) } },
    vaults: { [offen]: { ordnerKennung: K.kennungVon(offen), neueKonten: "gesperrt", ohneKonto: "posteingang", konten: { k_aaaaaaaa: "posteingang", k_bbbbbbbb: "posteingang", k_cccccccc: "posteingang" } },
              [zu]: { ordnerKennung: K.kennungVon(zu), neueKonten: "gesperrt", ohneKonto: extra.ohneKonto || "posteingang", konten: { k_aaaaaaaa: "gesperrt", k_bbbbbbbb: "posteingang", k_cccccccc: "gesperrt", ...stufen } } } }));
  liste({});
  return { home, support, offen, zu, a, b, std, liste };
}
function mcp(s, args, envX = {}) {
  const env = baueTestUmgebung({ HOME: s.home, BRAIN_APP_SUPPORT: s.support, KORTEX_VAULT_VERTRAUT: "alle", ...envX });
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), ...args], { stdio: ["pipe", "pipe", "pipe"], env, cwd: s.home }); kinder.push(p);
  const w = [], q = []; createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const f = w.shift(); f ? f(o) : q.push(o); });
  let n = 0; const frage = (method, params) => new Promise((ok) => { p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) + "\n"); const a = q.shift(); a ? ok(a) : w.push(ok); });
  return { rufe: async (name, a = {}) => { const r = (await frage("tools/call", { name, arguments: a })).result; return r.content.map((c) => c.text).join("\n"); }, ende: () => new Promise((ok) => { p.on("close", ok); p.stdin.end(); }) };
}
const suche = async (s, args, envX) => { const m = mcp(s, args, envX); try { return await m.rufe("brain_suchen", { frage: "Geheimprojekt" }); } finally { await m.ende(); } };

// ───────────── 1 (HOCH): ohneKonto darf Sperren nicht umgehen ─────────────
test("1 ohneKonto: ein Aufruf ohne erkennbares Konto ist nie lockerer als das strengste Konto des Vaults (Probe P3)", async () => {
  const s = szenario();
  const d = K.liesKonten(s.support).daten;
  assert.equal(d.vaults[s.zu].ohneKonto, "posteingang", "der Vermerk steht auf posteingang (Migration) …");
  assert.equal(K.stufeFuer(d, s.zu, null), "gesperrt", "… wirksam ist das Minimum der Konten (a und Std sind gesperrt)");
  assert.equal(K.stufeFuer(d, s.offen, null), "posteingang", "ist kein Konto gesperrt, gilt ohneKonto");
  assert.ok(!leak(await suche(s, ["--vault", s.zu])), "Altform ohne --konto und ohne Umgebung: nichts aus dem gesperrten Vault");
  // auch kern und gemeinsam rechnen gleich (Parität steht in ki-konten-paritaet.test.mjs)
  assert.equal(K.kontoStufe(s.zu, { support: s.support, env: {} }), "gesperrt");
});

test("1 Beim Sperren über die Route wird auch ohneKonto gesperrt; ein Assistent kann ein vom Nutzer gesperrtes Konto nicht still öffnen (12)", async () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const p = join(home, ".claude-a"); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0" }] }] } }));
  const v = realpathSync(tmp("vault-")); schreibe(v, "brain.config.json", "{}\n");
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ name: "V", pfad: v, farbe: "#5B8DEF" }], aktiv: v }));
  const mcpDir = tmp("brain-mcpdir-"); schreibe(mcpDir, "brain-mcp.mjs", "//\n");
  const h = erzeugeHandler({ vault: v, vaultOptionen: { support: s }, mcpPfad: join(mcpDir, "brain-mcp.mjs") });
  const rufe = async (m, pf, b) => { const r = await h({ methode: m, pfad: pf, query: null, body: b === undefined ? undefined : Buffer.from(JSON.stringify(b)) }); let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* */ } return { ...r, j }; };
  const alt = process.env.HOME; process.env.HOME = home;
  try {
    const id = (await rufe("POST", "/api/ki/konten/abgleich")).j.konten[0].id;
    await rufe("PUT", "/api/ki/zugriff", { konto: id, vault: v, stufe: "gesperrt" });
    assert.equal(K.liesKonten(s).daten.vaults[v].ohneKonto, "gesperrt", "mit der Sperre auch ohneKonto");
    assert.equal(K.liesKonten(s).daten.vaults[v].gesperrtNutzer[id], true, "die Sperre ist als vom Nutzer gesetzt vermerkt");
    // Assistent (quelle assistent): ohne ausdrückliche Wahl bleibt es gesperrt
    let r = await rufe("PUT", "/api/ki/zugriff", { konto: id, vault: v, stufe: "posteingang", quelle: "assistent" });
    assert.equal(r.j.zugriffGesetzt, false); assert.equal(r.j.zugriffGrund, "vom-nutzer-gesperrt");
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v, id), "gesperrt");
    // über „KI verbinden“ mit zugriff: gleich (die Route nimmt zugriff nur über verbinde; hier die Werkstatt-Funktion direkt)
    const konten = erzeugeKonten({ support: s, home: () => home, vaults: () => [{ pfad: v, name: "V" }], erkennung: () => [], quelleVon: () => "bestaetigt" });
    r = konten.setzeZugriff({ konto: id, vault: v, stufe: "lesen", quelle: "assistent", ausdruecklich: true });
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v, id), "lesen", "mit ausdrücklicher Wahl gilt die neue Stufe");
    assert.equal(K.liesKonten(s).daten.vaults[v].gesperrtNutzer, undefined, "und der Vermerk ist weg");
    // ein Konto, das der Assistent nur gesperrt VORFINDET (nicht vom Nutzer gesperrt), darf er öffnen
    K.aendere(s, (d) => { d.vaults[v].konten[id] = "gesperrt"; return d; });
    r = konten.setzeZugriff({ konto: id, vault: v, stufe: "posteingang", quelle: "assistent" });
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v, id), "posteingang");
  } finally { process.env.HOME = alt; }
});

// ───────────── 2 (HOCH): ein umgelenkter Support-Ordner öffnet nichts ─────────────
test("2 BRAIN_APP_SUPPORT auf einen leeren Ordner: der Standardort zählt immer mit, bei mehreren Orten das strengere Ergebnis (Probe P4)", () => {
  const s = szenario();
  const leer = tmp("leer-");
  const mitStandard = { standard: s.support, abgeschottet: false }; // „s.support“ spielt den Standardort des Rechners
  assert.equal(K.kontoStufe(s.zu, { support: leer, arg: "k_aaaaaaaa", env: { CLAUDE_CONFIG_DIR: s.a }, ...mitStandard }), "gesperrt", "der leere Ersatzordner hebt die Sperre nicht auf");
  assert.equal(K.kontoStufe(s.zu, { support: leer, arg: "k_aaaaaaaa", env: { CLAUDE_CONFIG_DIR: s.a }, standard: s.support, abgeschottet: true }), "posteingang", "im Test/Vorschau (abgeschottet) gilt nur der übergebene Ordner");
  assert.deepEqual(K.kontenOrte(leer, mitStandard), [s.support, leer], "Standardort zuerst, dann der übergebene");
  // zwei Orte mit Listen: das strengere Ergebnis
  const zweite = tmp("support2-");
  K.aendere(zweite, () => ({ version: 1, konten: K.liesKonten(s.support).daten.konten, vaults: { [s.zu]: { ordnerKennung: K.kennungVon(s.zu), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "erweitert", k_bbbbbbbb: "gesperrt", k_cccccccc: "gesperrt" } } } }));
  assert.equal(K.kontoStufe(s.zu, { support: zweite, arg: "k_bbbbbbbb", env: { CLAUDE_CONFIG_DIR: s.b }, standard: s.support, abgeschottet: false }), "gesperrt", "Standardort sagt posteingang, der andere gesperrt → gesperrt");
  // der MCP-Zugriff (Server) nutzt dieselbe Regel
  const z = erzeugeZugriff({ support: leer, arg: "k_aaaaaaaa", env: { CLAUDE_CONFIG_DIR: s.a }, ...mitStandard });
  assert.equal(z.stufe(s.zu), "gesperrt"); assert.equal(z.gefiltert(), true);
  const zTest = erzeugeZugriff({ support: leer, arg: "k_aaaaaaaa", env: { CLAUDE_CONFIG_DIR: s.a }, standard: s.support, abgeschottet: true });
  assert.equal(zTest.gefiltert(), false, "abgeschottet und keine Liste: bisheriges Verhalten (Übergang)");
});

// ───────────── 3: eine gelöschte Liste öffnet nichts und läuft nicht neu in die Migration ─────────────
test("3 Gelöschte ki-konten.json: fail-closed, Hinweis mit Grund „geloescht“, keine Migration, alles gesperrt; die frühere Fassung bleibt zurückholbar (Probe Reset)", () => {
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const v = realpathSync(tmp("vault-")); schreibe(v, "brain.config.json", "{}\n");
  const a = join(home, ".claude-a"); mkdirSync(a); writeFileSync(join(a, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0" }] }] } }));
  const erz = () => erzeugeKonten({ support, home: () => home, vaults: () => [{ pfad: v, name: "V" }], quelleVon: () => "bestaetigt" });
  let kn = erz();
  kn.synchronisiere();
  const id = Object.keys(kn.lade().konten)[0];
  assert.equal(K.kontoStufe(v, { support, arg: id, env: {} }), "posteingang", "Migration: verbunden → heutige Rechte");
  assert.ok(existsSync(join(support, K.SPUR_DATEI)), "das Schreiben hinterlässt die Spur");
  kn.setzeZugriff({ konto: id, vault: v, stufe: "gesperrt" });
  kn.setzeName({ id, name: "Eins" }); // .vorher ist die Fassung vor dem letzten Schreiben: hier die mit der Sperre
  rmSync(join(support, "ki-konten.json"));
  assert.equal(K.liesKonten(support).zustand, "geloescht");
  assert.equal(K.kontoStufe(v, { support, arg: id, env: {} }), "gesperrt", "Datei gelöscht → MCP/Hooks: gesperrt, nicht „noch nie gelaufen“");
  assert.equal(K.kontoStufe(v, { support, env: { CLAUDE_CONFIG_DIR: a } }), "gesperrt");
  kn = erz();
  const r = kn.synchronisiere();
  assert.equal(r.hinweis, "defekt-neu"); assert.equal(r.hinweisGrund, "geloescht");
  const d = kn.lade();
  assert.ok(Object.keys(d.konten).length === 1, "das Konto wird neu erkannt (neue Kennung) …");
  for (const k of Object.keys(d.konten)) assert.equal(K.stufeFuer(d, v, k), "gesperrt", "… aber gesperrt: die Migration läuft nicht noch einmal (sie hätte die Hooks als „verbunden“ erkannt und geöffnet)");
  assert.equal(K.stufeFuer(d, v, null), "gesperrt");
  assert.equal(kn.stand().hinweis, "defekt-neu"); assert.equal(kn.stand().hinweisGrund, "geloescht");
  assert.equal(kn.stand().vorherDa, true, "die frühere Fassung ist da");
  assert.equal(kn.holeVorher({ bestaetigt: true }).hinweis, undefined);
  assert.equal(K.stufeFuer(kn.lade(), v, id), "gesperrt", "zurückgeholt: die Sperre, die der Nutzer gesetzt hatte");
  // „fehlt“ ohne Spur (die App lief noch nie) bleibt der Übergang
  assert.equal(K.kontoStufe(v, { support: tmp("neu-"), env: {} }), "posteingang");
});

// ───────────── 4: die Kennung ist eine Selbstauskunft ─────────────
test("4 --konto B + CLAUDE_CONFIG_DIR=A ist blockiert (P1); --konto B unter Claude Code ohne CLAUDE_CONFIG_DIR vergleicht mit dem Standardprofil; die reine Fälschung --konto B + Umgebung B bleibt eine dokumentierte Grenze (P2)", async () => {
  const s = szenario();
  assert.ok(!leak(await suche(s, ["--konto", "k_bbbbbbbb", "--vault", s.zu], { CLAUDE_CONFIG_DIR: s.a })), "P1: Widerspruch → das strengere Recht");
  assert.ok(!leak(await suche(s, ["--konto", "k_bbbbbbbb", "--vault", s.zu], { CLAUDECODE: "1" })), "unter Claude Code ohne CLAUDE_CONFIG_DIR läuft das Standardprofil (gesperrt) — B allein genügt nicht");
  assert.ok(leak(await suche(s, ["--konto", "k_bbbbbbbb", "--vault", s.zu], { CLAUDE_CONFIG_DIR: s.b })), "P2: Kennung UND Umgebung gefälscht — nicht erkennbar; darum schützen die Einstellungsregeln und der Strenge Schutz die Dateien, in denen das steht");
  // die Einstellungsregeln: genau die Dateien, in denen Kennung und Umgebung stehen
  const r = S.einstellungsRegeln({ support: s.support, profil: s.b, home: s.home, standard: false });
  for (const erwartet of [`Edit(//${s.support.slice(1)}/**)`, `Edit(//${s.b.slice(1)}/settings.json)`, `Edit(//${s.b.slice(1)}/.claude.json)`, "Edit(**/.mcp.json)", "Edit(**/.claude/settings.json)", "Edit(**/.claude/settings.local.json)"]) assert.ok(r.includes(erwartet), erwartet);
  const rs = S.einstellungsRegeln({ support: s.support, profil: s.std, home: s.home, standard: true });
  assert.ok(rs.includes(`Edit(//${s.home.slice(1)}/.claude.json)`), "das Standardprofil legt seine MCP-Einträge in ~/.claude.json ab");
});

// ───────────── 5: verschachtelte Vaults ─────────────
test("5 Ein Vault in einem Vault: Suche, Lesen, Verlauf, Kontext, Vault-Liste und Index zeigen den inneren nicht mit (Probe P5)", async () => {
  const s = szenario({ verschachtelt: true });
  const m = mcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: s.a });
  try {
    assert.ok(!leak(await m.rufe("brain_suchen", { frage: "Geheimprojekt" })), "Suche");
    const l = await m.rufe("brain_lesen", { pfad: "privat/09_wiki/w/thema.md" });
    assert.ok(!leak(l)); assert.match(l, /gibt es nicht/);
    assert.ok(!leak(await m.rufe("brain_verlauf", { pfad: "privat/09_wiki/w/thema.md" })));
    assert.ok(!leak(await m.rufe("brain_kontext", { projekt: "thema" })), "Kontext");
    assert.ok(!(await m.rufe("brain_vaults")).includes(s.zu), "kein Pfad des inneren Vaults");
    // der äußere Vault selbst bleibt lesbar
    assert.ok((await m.rufe("brain_suchen", { frage: "Zebra" })).includes("Zebra"));
  } finally { await m.ende(); }
  // Index/Hooks: der Kern-Walk läuft nicht in den inneren Vault
  const dateien = walk(s.offen).map((f) => f.rel.split("\\").join("/"));
  assert.ok(dateien.some((f) => f.startsWith("09_wiki/")) && !dateien.some((f) => f.startsWith("privat/")), JSON.stringify(dateien));
});

test("5 Symlink im erlaubten Vault auf einen gesperrten Vault und Pfade außerhalb: kein Inhalt (Proben P6, P7)", async () => {
  const s = szenario();
  symlinkSync(s.zu, join(s.offen, "09_wiki", "link"));
  const m = mcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: s.a });
  try {
    assert.ok(!leak(await m.rufe("brain_suchen", { frage: "Geheimprojekt" })), "P6 Suche");
    assert.ok(!leak(await m.rufe("brain_lesen", { pfad: "09_wiki/link/09_wiki/w/thema.md" })), "P6 Lesen");
    for (const pf of [join(s.zu, "09_wiki/w/thema.md"), `../${s.zu.split("/").pop()}/09_wiki/w/thema.md`]) assert.ok(!leak(await m.rufe("brain_lesen", { pfad: pf })), `P7 ${pf}`);
  } finally { await m.ende(); }
});

test("5 Warnung beim Öffnen eines verschachtelten Vaults (äußerer und innerer)", async () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const aussen = realpathSync(tmp("vault-aussen-")); schreibe(aussen, "brain.config.json", "{}\n");
  const innen = join(aussen, "innen"); mkdirSync(innen); schreibe(innen, "brain.config.json", "{}\n");
  const fremd = realpathSync(tmp("vault-fremd-"));
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ name: "Fremd", pfad: fremd, farbe: "#5B8DEF" }], aktiv: fremd }));
  schreibe(fremd, "brain.config.json", "{}\n");
  const mcpDir = tmp("brain-mcpdir-"); schreibe(mcpDir, "brain-mcp.mjs", "//\n");
  const h = erzeugeHandler({ vault: fremd, vaultOptionen: { support: s }, mcpPfad: join(mcpDir, "brain-mcp.mjs") });
  const rufe = async (m, pf, b) => { const r = await h({ methode: m, pfad: pf, query: null, body: Buffer.from(JSON.stringify(b)) }); return { ...r, j: JSON.parse(r.body.toString("utf8")) }; };
  const alt = process.env.HOME; process.env.HOME = home;
  try {
    // der äußere Vault enthält einen Ordner, der selbst ein Vault ist (nie angemeldet)
    let r = await rufe("POST", "/api/vaults/oeffnen", { pfad: aussen });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.match(r.j.warnung, /liegt der Ordner „innen“, der selbst ein Vault ist/); assert.match(r.j.warnung, /KI-Konten/);
    // ein Vault ohne Verschachtelung bekommt keine Warnung
    r = await rufe("POST", "/api/vaults/oeffnen", { pfad: fremd });
    assert.equal(r.j.warnung, undefined);
  } finally { process.env.HOME = alt; }
});

// ───────────── 8: Nachführen bei neuen oder verschobenen Vaults, Warnungen ─────────────
test("8 Strenger Schutz: ein neuer gesperrter Vault kommt sofort in denyRead/denyWrite; ein verschobener Vault ersetzt die alten Pfade; Warnungen für allowRead, excludedCommands und settings.local.json", async () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const p = join(home, ".claude-a"); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), JSON.stringify({ sandbox: { filesystem: { allowRead: ["/x"] }, excludedCommands: ["git"] } }));
  writeFileSync(join(p, "settings.local.json"), JSON.stringify({ sandbox: { enabled: false } }));
  const v1 = realpathSync(tmp("vault1-")), v2 = realpathSync(tmp("vault2-"));
  for (const v of [v1, v2]) schreibe(v, "brain.config.json", "{}\n");
  let liste = [{ pfad: v1, name: "V1" }];
  const kn = erzeugeKonten({ support: s, home: () => home, vaults: () => liste, quelleVon: () => "bestaetigt" });
  kn.synchronisiere();
  const id = Object.keys(kn.lade().konten)[0];
  kn.setzeZugriff({ konto: id, vault: v1, stufe: "gesperrt", claudeSperre: true });
  kn.setzeSchutz({ konto: id, sandbox: true, bestaetigt: true });
  const doc = () => JSON.parse(readFileSync(join(p, "settings.json"), "utf8"));
  assert.ok(doc().sandbox.filesystem.denyRead.includes(v1) && doc().sandbox.filesystem.denyWrite.includes(v1));
  const st = kn.stand().konten[0].schutz;
  assert.deepEqual(st.warnungen.sort(), ["allowRead", "excludedCommands", "lokal"]);
  // ein neuer Vault kommt dazu (für das Konto gesperrt)
  liste = [...liste, { pfad: v2, name: "V2" }];
  kn.vaultHinzu(v2, "geoeffnet");
  assert.ok(doc().sandbox.filesystem.denyRead.includes(v2) && doc().sandbox.filesystem.denyWrite.includes(v2), "neuer gesperrter Vault sofort geschützt");
  // v1 wird verschoben: die Regeln folgen (Leseverbot und Sandbox-Pfade)
  const neu = join(realpathSync(tmp("ziel-")), "umgezogen");
  renameSync(v1, neu);
  liste = [{ pfad: neu, name: "V1" }, { pfad: v2, name: "V2" }];
  kn.synchronisiere();
  const regeln = doc().permissions.deny;
  assert.ok(regeln.includes(`Read(//${realpathSync(neu).slice(1)}/**)`), "Leseverbot für den neuen Ort");
  assert.ok(!regeln.includes(`Read(//${v1.slice(1)}/**)`), "und nicht mehr für den alten");
  assert.ok(doc().sandbox.filesystem.denyRead.includes(realpathSync(neu)) && !doc().sandbox.filesystem.denyRead.includes(v1));
});

// ───────────── 10, 11: sauberes Schreiben ─────────────
test("10 Eine Sicherung je Anfrage mit eindeutigem Namen; leere Behälter nur entfernen, wenn Kortex sie angelegt hat; Rückweg stellt den Text exakt her (Probe Sperre)", () => {
  const p = realpathSync(tmp("sp-"));
  const orig = '{\n  "permissions": {},\n  "sandbox": { "filesystem": {} }\n}\n';
  writeFileSync(join(p, "settings.json"), orig);
  const regeln = S.vaultRegeln("/Users/x/Mein Vault (2024) [a]*?\\b", "/Users/x/Bücher".normalize("NFD"));
  assert.ok(regeln.some((r) => r.includes("(2024)")) && regeln.some((r) => r.includes("\\[a\\]")), "Klammern bleiben, eckige Klammern werden maskiert");
  assert.ok(regeln.some((r) => r.includes("Bücher".normalize("NFC"))) && regeln.some((r) => r.includes("Bücher".normalize("NFD"))), "NFC und NFD");
  let r1, sb;
  S.eineSicherung(() => {
    r1 = S.tragRegelnEin(p, regeln);
    sb = S.gleicheSandboxAb(p, null, { denyRead: ["/Users/x/V"], denyWrite: ["/Users/x/V"] });
    S.gleicheSandboxAb(p, sb, null);
    S.nimmRegelnHeraus(p, regeln, r1.angelegt);
  });
  assert.deepEqual(JSON.parse(readFileSync(join(p, "settings.json"), "utf8")), JSON.parse(orig), "inhaltlich exakt zurück: die leeren Behälter des Nutzers bleiben, was Kortex angelegt hat, geht");
  const baks = readdirSync(p).filter((n) => n.includes(".bak-"));
  assert.equal(baks.length, 1, "vier Schreibvorgänge in einer Anfrage, eine Sicherung");
  assert.match(baks[0], /^settings\.json\.bak-\d{8}-\d{6}-[0-9a-f]{6}$/, "Zeit und Zufall im Namen");
  assert.equal(readFileSync(join(p, baks[0]), "utf8"), orig, "die Sicherung ist die Fassung vor der Anfrage (Byte für Byte)");
  // ohne eineSicherung: jede Anfrage ihre eigene (nie eine vorhandene überschreiben)
  S.tragRegelnEin(p, regeln); S.tragRegelnEin(p, ["Read(//x/**)"]);
  assert.equal(readdirSync(p).filter((n) => n.includes(".bak-")).length, 3);
  assert.deepEqual(readdirSync(p).filter((n) => n.includes(".tmp-")), []);
});

// ───────────── 13: Skripte nur aus eigenen Dateien ─────────────
test("13 Die Werkstatt liefert die Studio-Seite mit script-src 'self'", async () => {
  const s = tmp("brain-support-");
  const v = realpathSync(tmp("vault-")); schreibe(v, "brain.config.json", "{}\n");
  const h = erzeugeHandler({ vault: v, vaultOptionen: { support: s } });
  const r = await h({ methode: "GET", pfad: "/", query: null });
  assert.equal(r.status, 200);
  assert.match(r.headers["Content-Security-Policy"], /script-src 'self'/);
  assert.ok(!/unsafe-inline[^;]*;[^;]*script/.test(r.headers["Content-Security-Policy"]) && !/script-src[^;]*unsafe/.test(r.headers["Content-Security-Policy"]));
});

// ───────────── 7: Warnung beim Sperren, wenn das Konto im Gedächtnis-Abgleich steht ─────────────
test("7 Sperren warnt, wenn das Konto im Gedächtnis-Abgleich eines Vaults steht (Text ohne Vault-Namen); sonst keine Warnung", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const a = join(home, ".claude-a"); mkdirSync(a); writeFileSync(join(a, "settings.json"), "{}");
  const b = join(home, ".claude-b"); mkdirSync(b); writeFileSync(join(b, "settings.json"), "{}");
  const v = realpathSync(tmp("vault-")); schreibe(v, "brain.config.json", JSON.stringify({ automatik: { gedaechtnisTeilen: "an", gedaechtnisKonten: ["~/.claude-a"] } }));
  const kn = erzeugeKonten({ support: s, home: () => home, vaults: () => [{ pfad: v, name: "Geheimer Vaultname" }], quelleVon: () => "bestaetigt" });
  kn.synchronisiere();
  const id = (o) => Object.entries(kn.lade().konten).find(([, k]) => k.ordner === realpathSync(o))[0];
  let r = kn.setzeZugriff({ konto: id(a), vault: v, stufe: "gesperrt" });
  assert.equal(r.warnungen.length, 1); assert.match(r.warnungen[0], /Gedächtnis-Abgleich/); assert.ok(!r.warnungen[0].includes("Geheimer"));
  r = kn.setzeZugriff({ konto: id(b), vault: v, stufe: "gesperrt" });
  assert.equal(r.warnungen, undefined, "b steht nicht in der Liste");
  r = kn.setzeZugriff({ konto: id(a), vault: v, stufe: "lesen" });
  assert.equal(r.warnungen, undefined, "nur beim Sperren");
});

// ───────────── Altform erkennen ─────────────
test("1 Altform: Einträge und Hooks ohne --konto werden erkannt (für „Mit Konto neu verbinden“)", async () => {
  const { altformStandard } = await import(pfad("werkstatt", "konten.mjs"));
  const home = tmp("brain-home-"), p = join(home, ".claude-a"); mkdirSync(p);
  const hook = (c) => JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: c }] }] } });
  const k = { programm: "claude", ordner: p, standard: false };
  writeFileSync(join(p, "settings.json"), hook("[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0"));
  writeFileSync(join(p, ".claude.json"), JSON.stringify({ mcpServers: { brain: { command: "n", args: ["/x/brain-mcp.mjs"] } } }));
  assert.deepEqual(altformStandard(k, home), { mcp: true, hooks: true });
  writeFileSync(join(p, "settings.json"), hook("[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start --konto k_aaaaaaaa || exit 0"));
  writeFileSync(join(p, ".claude.json"), JSON.stringify({ mcpServers: { brain: { command: "n", args: ["/x/brain-mcp.mjs", "--konto", "k_aaaaaaaa"] } } }));
  assert.deepEqual(altformStandard(k, home), { mcp: false, hooks: false });
  assert.deepEqual(altformStandard({ programm: "claude", ordner: join(home, "gibtsnicht"), standard: false }, home), { mcp: false, hooks: false });
});
