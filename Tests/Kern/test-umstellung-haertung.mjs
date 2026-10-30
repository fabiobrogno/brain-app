// test-umstellung-haertung.mjs — Paket P7b, Nachbesserung nach dem Review: Fehlerpfade und „Absturz vor hashNachher“.
// Die Attrappen für claude, codex und launchctl bilden Argument-Parsing und Fehlercodes der echten Programme nach (Tests/Kern/fake-mcp-lib.mjs, fake-launchctl.mjs); darum fallen
// falsche Aufrufe (z. B. `mcp add -e K=V brain`) hier auf. Nur Temp-HOME, Temp-Support, eigene globale git-Konfiguration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, lstatSync, utimesSync, readdirSync, unlinkSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { umstellungsFixture, freigabe, umstellungsStand, inhaltsStand } from "./umstellung-hilfe.mjs";
import { baumStand, GEHEIM } from "./fixture-altvault.mjs";
import { phaseA, TestAbbruch } from "../umstellung/phase-a.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { probelauf, raeumeAlteProben, sichereKopieGit } from "../umstellung/probelauf.mjs";
import { liesZustand, ablageOrdner } from "../umstellung/protokoll.mjs";
import { kennung, kennungen } from "../umstellung/ziele.mjs";
import { merkerDateiFuer } from "../backup.mjs";
import { codexAbschnitte } from "../umstellung/mcp-schritt.mjs";
import { hakenDiff, hakenZurueck } from "../umstellung/schritte.mjs";
import { KERN } from "../pfade.mjs";

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);
const starte = (h, opt = {}) => { freigabe(h.z(), opt.entscheidungen); return phaseA(h.z(), { bestaetigt: true, ...opt }); };
const zurueck = (h, opt = {}) => rueckweg(h.z(), { bestaetigt: true, ...opt });
const befehle = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((x) => x.command));
const FAKE = (n) => new URL(`./${n}`, import.meta.url).pathname;
const kitMcp = (h) => join(h.a.vault, ".tools", "mcp", "brain-mcp.mjs");
const plistPfad = (h) => join(h.a.home, "Library", "LaunchAgents", "de.brain.tageslauf.plist");

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// Attrappen: sie lehnen falsche Aufrufe ab
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("Attrappe claude: `add -e K=V brain -- …` scheitert (--env ist variadisch), add-json geht, remove/add kennen Exit-Codes", () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    const lauf = (...a) => spawnSync(process.execPath, [FAKE("fake-claude-mcp.mjs"), ...a], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: h.a.home } });
    assert.notEqual(lauf("mcp", "add", "-s", "user", "-e", "K=V", "andere", "--", "node", "x").status, 0, "-e frisst den Namen: kein Name übrig");
    assert.match(lauf("mcp", "add", "-s", "user", "-e", "K=V", "andere", "--", "node", "x").stderr, /missing required argument/);
    assert.notEqual(lauf("mcp", "add", "-s", "user", "brain", "--", "node", "x").status, 0, "brain gibt es schon");
    assert.notEqual(lauf("mcp", "remove", "-s", "user", "gibt-es-nicht").status, 0);
    assert.equal(lauf("mcp", "add-json", "-s", "user", "neu", JSON.stringify({ command: "n", args: [], env: { A: "b" } })).status, 0);
    assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.neu, { command: "n", args: [], env: { A: "b" } });
    assert.notEqual(lauf("mcp", "add-json", "-s", "user", "kaputt", "{nope").status, 0);
  } finally { h.weg(); }
});

test("Attrappe claude/codex: arbeitet nur im Temp-Ordner – ein HOME oder CLAUDE_CONFIG_DIR außerhalb wird mit Exit 99 abgelehnt, ohne etwas anzufassen", () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    for (const art of ["fake-claude-mcp.mjs", "fake-codex-mcp.mjs"]) {
      for (const env of [{ HOME: "/Users/jemand-anderes" }, { HOME: h.a.home, CLAUDE_CONFIG_DIR: "/Users/jemand-anderes/.claude-x" }]) {
        const r = spawnSync(process.execPath, [FAKE(art), "mcp", "add", "-s", "user", "brain", "--", "node", "x"], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
        assert.equal(r.status, 99, `${art} ${JSON.stringify(env)}`);
      }
    }
  } finally { h.weg(); }
});

test("Attrappe launchctl: bootstrap eines geladenen Dienstes scheitert, bootout eines nicht geladenen ebenso, print meldet den Zustand", () => {
  const h = umstellungsFixture([]);
  try {
    const lc = (...a) => spawnSync(process.execPath, [FAKE("fake-launchctl.mjs"), ...a], { encoding: "utf8", env: { ...process.env } }).status;
    assert.equal(lc("print", "gui/1/x"), 113);
    assert.equal(lc("bootout", "gui/1/x"), 3);
    assert.equal(lc("bootstrap", "gui/1", "/p"), 0);
    assert.equal(lc("print", "gui/1/x"), 0);
    assert.equal(lc("bootstrap", "gui/1", "/p"), 5);
    assert.equal(lc("bootout", "gui/1/x"), 0);
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 1 (hoch): A6 — scheitert bootstrap, ist der alte Dienst wieder da
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("A6: bootstrap scheitert → alte plist zurück, dienst.json zurück, der vorher geladene Dienst wird wieder geladen", async () => {
  const h = umstellungsFixture(["plist-alt-dieser-profil", "zwei-profile"]);
  try {
    process.env.FAKE_LAUNCHCTL_VORGELADEN = "1";
    process.env.FAKE_LAUNCHCTL_FAIL = "bootstrap";
    const plistVor = sha(plistPfad(h));
    const r = await starte(h, { schritte: ["A6"] });
    assert.equal(r.ok, false);
    assert.equal(r.fehlerBei, "A6");
    assert.equal(r.grund, "dienst-an-fehlgeschlagen");
    assert.equal(r.zurueckgenommen, true, JSON.stringify(r));
    assert.equal(sha(plistPfad(h)), plistVor, "die alte plist ist Byte für Byte zurück");
    assert.ok(!existsSync(join(h.a.support, "dienst.json")), "der Dienst-Merker ist wieder weg");
    const log = h.zeilen(h.log);
    assert.ok(log.filter((l) => l.startsWith("bootstrap")).length >= 2, `der alte Dienst wird neu geladen: ${log.join(" | ")}`);
    assert.ok(existsSync(`${h.log}.geladen`), "am Ende ist der Dienst geladen wie vorher");
  } finally { h.weg(); }
});

test("A6: Absturz NACH dem Schreiben der plist, VOR dem Vermerken von hashNachher → Rückweg erkennt sie (hashErwartet/Form) und stellt her", async () => {
  const h = umstellungsFixture(["plist-alt-dieser-profil", "zwei-profile"]);
  try {
    const plistVor = sha(plistPfad(h));
    await assert.rejects(starte(h, { schritte: ["A6"], abbruchBei: "A6:nach-dienst" }), TestAbbruch);
    assert.notEqual(sha(plistPfad(h)), plistVor, "die neue plist steht schon");
    const undo = json(join(ablageOrdner(h.z()), liesZustand(h.z()).schritte.A6.undo));
    assert.equal(undo.plist.hashNachher, null, "hashNachher wurde nie vermerkt");
    assert.ok(undo.plist.hashErwartet, "die erwartete plist steht vorab in den Rückweg-Angaben");
    const rw = await zurueck(h, { alles: true });
    assert.equal(rw.ok, true);
    assert.equal(sha(plistPfad(h)), plistVor);
    assert.ok(!existsSync(join(h.a.support, "dienst.json")));
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 2 (hoch) A5 Claude: Rückweg verlustfrei, Exit-Codes geprüft
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const altEintrag = (h) => ({ type: "stdio", command: "/opt/homebrew/bin/node", args: [kitMcp(h)], env: { TOKEN: GEHEIM, ANDERES: "x y" } });
function mitEnvEintrag(h) {
  writeFileSync(join(h.a.home, ".claude.json"), JSON.stringify({ mcpServers: { brain: altEintrag(h), anderer: { command: "x" } }, projekte: 1 }, null, 2) + "\n");
}
test("A5 Claude mit env im alten Eintrag: Hinweg setzt den neuen, Rückweg stellt den alten VERLUSTFREI her (add-json), Fremdes bleibt", async () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    mitEnvEintrag(h);
    const r = await starte(h, { schritte: ["A5"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const neu = json(join(h.a.home, ".claude.json"));
    assert.equal(neu.mcpServers.brain.command, join(h.a.support, "bin", "node"));
    assert.deepEqual(neu.mcpServers.anderer, { command: "x" });
    assert.equal((await zurueck(h, { schritte: ["A5"] })).ok, true);
    const nach = json(join(h.a.home, ".claude.json"));
    assert.deepEqual(nach.mcpServers.brain, altEintrag(h), "der alte Eintrag samt env ist vollständig zurück");
    assert.deepEqual(nach.mcpServers.anderer, { command: "x" });
    assert.equal(nach.projekte, 1);
  } finally { h.weg(); }
});

test("A5 Claude: schlägt das neue add fehl, kommt der alte Eintrag zurück (Exit-Code geprüft) und der Schritt scheitert sauber", async () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    mitEnvEintrag(h);
    process.env.FAKE_MCP_FAIL = "add";
    const r = await starte(h, { schritte: ["A5"] });
    assert.equal(r.ok, false);
    assert.equal(r.grund, "mcp-claude-fehlgeschlagen");
    assert.equal(r.zurueckgenommen, true);
    assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.brain, altEintrag(h));
  } finally { h.weg(); }
});

test("A5 Claude: scheitert auch das Zurückschreiben, ist der Eintrag zwar weg, steht aber vollständig in den Rückweg-Angaben – der Rückweg stellt ihn später her", async () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    mitEnvEintrag(h);
    process.env.FAKE_MCP_FAIL = "add,add-json";
    const r = await starte(h, { schritte: ["A5"] });
    assert.equal(r.ok, false);
    assert.equal(r.grund, "mcp-claude-eintrag-verloren");
    assert.equal(r.zurueckgenommen, false, "nicht sauber zurückgenommen: der Eintrag fehlt");
    assert.ok(r.rueckwegHinweise && r.rueckwegHinweise.includes("mcp-claude-nicht-zurueck"), JSON.stringify(r));
    assert.equal(json(join(h.a.home, ".claude.json")).mcpServers.brain, undefined);
    delete process.env.FAKE_MCP_FAIL;
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.brain, altEintrag(h));
  } finally { h.weg(); }
});

test("A5 Claude: Absturz nach dem Umstellen (Hash/Stand nicht vermerkt) → Rückweg stellt den alten Eintrag her", async () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    mitEnvEintrag(h);
    await assert.rejects(starte(h, { schritte: ["A5"], abbruchBei: "A5:nach-claude" }), TestAbbruch);
    assert.equal(json(join(h.a.home, ".claude.json")).mcpServers.brain.command, join(h.a.support, "bin", "node"));
    await zurueck(h, { alles: true });
    assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.brain, altEintrag(h));
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 3 (mittel) A5 Codex: env und Zusatzfelder bleiben
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const CODEX_ALT = (h) => `model = "x"\n\n[mcp_servers.brain]\ncommand = "/opt/homebrew/bin/node"\nargs = ["${kitMcp(h)}"]\nstartup_timeout_sec = 30\n\n[mcp_servers.brain.env]\nTOKEN = "${GEHEIM}"\nZWEI = "a b"\n\n[projects."/x"]\ntrust = "ja"\n`;
test("A5 Codex: schlägt das neue add fehl, ist die Datei Byte für Byte die alte (env und Zusatzfelder bleiben)", async () => {
  const h = umstellungsFixture(["mcp-codex-alt"]);
  try {
    writeFileSync(join(h.a.home, ".codex", "config.toml"), CODEX_ALT(h));
    const vor = sha(join(h.a.home, ".codex", "config.toml"));
    process.env.FAKE_MCP_FAIL = "add";
    const r = await starte(h, { schritte: ["A5"] });
    assert.equal(r.ok, false);
    assert.equal(r.grund, "mcp-codex-fehlgeschlagen");
    assert.equal(sha(join(h.a.home, ".codex", "config.toml")), vor);
  } finally { h.weg(); }
});

test("A5 Codex: Rückweg stellt den vollständigen alten Eintrag her – auch wenn die Datei inzwischen anders geändert wurde (Fremdes bleibt)", async () => {
  const h = umstellungsFixture(["mcp-codex-alt"]);
  try {
    const datei = join(h.a.home, ".codex", "config.toml");
    writeFileSync(datei, CODEX_ALT(h));
    const vor = sha(datei);
    assert.equal((await starte(h, { schritte: ["A5"] })).ok, true);
    assert.ok(!readFileSync(datei, "utf8").includes(GEHEIM), "der neue Eintrag hat kein env");
    // 1. unverändert → Byte-Sicherung
    assert.equal((await zurueck(h, { schritte: ["A5"] })).ok, true);
    assert.equal(sha(datei), vor);
    // 2. inzwischen geändert → Text der Abschnitte wird wieder eingesetzt, Fremdes bleibt
    assert.equal((await starte(h, { schritte: ["A5"] })).ok, true);
    writeFileSync(datei, readFileSync(datei, "utf8") + '\n[projects."/neu"]\ntrust = "nein"\n');
    assert.equal((await zurueck(h, { schritte: ["A5"] })).ok, true);
    const t = readFileSync(datei, "utf8");
    const { brain } = codexAbschnitte(t);
    assert.equal(brain, codexAbschnitte(CODEX_ALT(h)).brain, "Abschnitt samt env und startup_timeout_sec vollständig zurück");
    assert.match(t, /\[projects\."\/neu"\]/);
    assert.match(t, /\[projects\."\/x"\]/);
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 4 (mittel) A2: nicht verschiebbare Schlüssel, bedenkliche Werte
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("A2: include.path und safe.directory werden NICHT verschoben (strukturell), relative Pfade und Pfade in den Vault bleiben lokal; Unbedenkliches zieht um", async () => {
  const h = umstellungsFixture(["credential-helper", "include-path", "safe-directory", "git-pfad-relativ", "git-pfad-im-vault"]);
  try {
    const r = await starte(h, { schritte: ["A2"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const d = r.schritte.find((s) => s.id === "A2");
    assert.equal(d.status, "ok");
    assert.equal(d.details.verschoben, 3, "nur credential.helper (3 Werte)");
    assert.equal(d.details.abgelehnt, 2);
    assert.equal(d.details.strukturell, 2);
    const lokal = (k) => spawnSync("/usr/bin/git", ["-C", h.a.vault, "config", "--local", "--get-all", k], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).stdout.trim();
    assert.equal(lokal("include.path"), `../${GEHEIM}.cfg`);
    assert.equal(lokal("safe.directory"), "*");
    assert.equal(lokal("core.excludesFile"), "./ignorieren-extern");
    assert.match(lokal("core.sshCommand"), /ssh-wrapper/);
    assert.equal(lokal("credential.helper"), "", "credential.helper ist nicht mehr lokal");
    const datei = readFileSync(join(h.a.support, "git", `${kennung(h.a.vault)}.gitconfig`), "utf8");
    assert.ok(!/include|safe|excludesfile|sshcommand/i.test(datei), "nichts Bedenkliches in der Datei je Vault");
    assert.equal((await zurueck(h, { alles: true })).ok, true);
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 5 (mittel) Probekopie: kein .git nach draußen, Verweise ersetzt
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("Probelauf: Verweise im .git der Kopie werden durch echte Kopien ersetzt – die Datei im Original ändert sich nie", async () => {
  const h = umstellungsFixture(["git-verweis-exclude"]);
  try {
    const extern = join(h.a.extern, "exclude");
    const vor = sha(extern);
    const r = await probelauf(h.z(), { bestaetigt: true, behalten: true });
    assert.equal(sha(extern), vor, "die verknüpfte Datei im Original ist unberührt");
    assert.ok(r.kopieBehalten, JSON.stringify(r.kriterien));
    const inKopie = join(r.kopieBehalten.kopie, ".git", "info", "exclude");
    assert.equal(lstatSync(inKopie).isSymbolicLink(), false, "in der Kopie ist es eine echte Datei");
    assert.equal(readFileSync(inKopie, "utf8"), readFileSync(extern, "utf8"));
    rmSync(r.kopieBehalten.wurzel, { recursive: true, force: true });
  } finally { h.weg(); }
});

test("sichereKopieGit: .git nach draußen und fremde Objektspeicher (alternates) brechen ab; Probelauf stoppt vor der Kopie bei Blockern", async () => {
  for (const fall of ["alternates", "git-datei-aussen"]) {
    const h = umstellungsFixture([fall]);
    try {
      assert.throws(() => sichereKopieGit(h.a.vault), /Versionsverlauf|nicht abgeschottet/);
      const eigene = () => readdirSync(tmpdir()).filter((n) => n.startsWith(`kortex-probelauf-${kennung(h.a.vault)}-`)).length;   // nur dieser Vault (andere Tests laufen parallel)
      const vorher = eigene();
      await assert.rejects(probelauf(h.z(), { bestaetigt: true }), /behoben|Versionsverlauf/);
      assert.equal(eigene(), vorher, "keine Probekopie angelegt");
    } finally { h.weg(); }
  }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 6 (mittel) A4: gezielte Umkehr
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("A4-Rückweg bei geänderter settings.json: nur unsere Einträge gehen, der alte Eintrag kommt wieder, vorhandene neue Hooks, eigene Einträge und fehlende Befehle bleiben bzw. kommen aus der Sicherung", async () => {
  const h = umstellungsFixture(["hooks-alt-sh", "commands-marke", "statusline-alt"]);
  try {
    const s = join(h.a.home, ".claude", "settings.json");
    const vor = json(s);
    assert.ok(befehle(vor).some((c) => c.includes("session-start.sh")));
    const vorNeu = befehle(vor).filter((c) => c.includes("kortex' hook")).sort();
    assert.equal((await starte(h, { schritte: ["A4"] })).ok, true);
    const doc = json(s);
    doc.eigenerSchluessel = "meins";
    (doc.hooks.PostToolUse ||= []).push({ hooks: [{ type: "command", command: "echo mein-hook" }] });
    writeFileSync(s, JSON.stringify(doc, null, 2) + "\n");
    unlinkSync(join(h.a.home, ".claude", "commands", "brain-suche.md"));
    const rw = await zurueck(h, { schritte: ["A4"] });
    assert.equal(rw.ok, true);
    const nach = json(s);
    assert.equal(nach.eigenerSchluessel, "meins");
    assert.ok(befehle(nach).includes("echo mein-hook"), "eigener Hook bleibt");
    assert.ok(befehle(nach).some((c) => c.includes("session-start.sh")), "der ersetzte alte Hook ist wieder da");
    assert.ok(!befehle(nach).some((c) => c.includes("kortex' hook session-start")), "unser neuer Hook ist weg");
    assert.deepEqual(befehle(nach).filter((c) => c.includes("kortex' hook")).sort(), vorNeu, "bereits vorhandene Hooks in neuer Form bleiben unberührt");
    assert.ok(nach.statusLine.command.includes("statusline.sh"), "alte Statuszeile zurück");
    assert.ok(existsSync(join(h.a.home, ".claude", "commands", "brain-suche.md")), "der gelöschte Befehl kommt aus der Sicherung");
    assert.ok(rw.hinweise.some((x) => x.includes("settings-geaendert-gezielt-zurueck")));
  } finally { h.weg(); }
});

test("A4: Absturz nach dem Eintragen, vor dem Vermerken von hashNachher/diff → Rückweg leitet die Änderung aus der Sicherung ab", async () => {
  const h = umstellungsFixture(["hooks-alt-sh", "statusline-alt"]);
  try {
    const s = join(h.a.home, ".claude", "settings.json");
    const vor = json(s);
    await assert.rejects(starte(h, { schritte: ["A4"], abbruchBei: "A4:nach-install" }), TestAbbruch);
    const undo = json(join(ablageOrdner(h.z()), liesZustand(h.z()).schritte.A4.undo));
    assert.equal(undo.profile[0].settings.hashNachher, null);
    assert.equal(undo.profile[0].diff, undefined);
    assert.ok(befehle(json(s)).some((c) => c.includes("kortex' hook session-start")));
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.deepEqual(befehle(json(s)).sort(), befehle(vor).sort());
    assert.equal(json(s).statusLine.command, vor.statusLine.command);
  } finally { h.weg(); }
});

test("hakenDiff/hakenZurueck: Einträge mit Matcher und mehreren Hooks je Gruppe", () => {
  const vor = { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "alt" }, { type: "command", command: "fremd" }] }] }, statusLine: { type: "command", command: "s-alt" } };
  const nach = { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "neu" }, { type: "command", command: "fremd" }] }] }, statusLine: { type: "command", command: "s-neu" } };
  const d = hakenDiff(vor, nach);
  assert.deepEqual(d.neu.map((x) => x.hook.command), ["neu"]);
  assert.deepEqual(d.alt.map((x) => x.hook.command), ["alt"]);
  const jetzt = JSON.parse(JSON.stringify(nach)); jetzt.hooks.PreToolUse[0].hooks.push({ type: "command", command: "danach" });
  const z = hakenZurueck(jetzt, d);
  assert.deepEqual(z.hooks.PreToolUse[0].hooks.map((x) => x.command).sort(), ["alt", "danach", "fremd"]);
  assert.equal(z.statusLine.command, "s-alt");
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 7 remoteBestaetigen über den echten Ablauf
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("remoteBestaetigen: Probelauf mit derselben Wahl gibt Phase A frei (kein freigabe()-Kunstgriff); eine andere Wahl danach entwertet den Merker", async () => {
  const h = umstellungsFixture(["remote-https"]);
  try {
    const merker = () => { try { return json(join(h.a.support, "backup", `${kennung(h.a.vault)}.json`)); } catch { return {}; } };
    const p = await probelauf(h.z(), { bestaetigt: true, entscheidungen: { remoteBestaetigen: true } });
    assert.equal(p.ok, true, JSON.stringify(p.kriterien));
    assert.equal(merker().remoteBestaetigt, undefined, "der Probelauf selbst bestätigt nie ein Ziel");
    await assert.rejects(phaseA(h.z(), { bestaetigt: true }), /Seit dem Probelauf/);
    const r = await phaseA(h.z(), { bestaetigt: true, entscheidungen: { remoteBestaetigen: true } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(merker().remoteBestaetigt);
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 8 zurueckgenommen nur bei sauberem Rückweg — zusammen mit 1 und 2 oben getestet; hier der Fall „nichts geschrieben“
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("Fehler vor dem ersten Schreiben: zurueckgenommen = true, ohne Rückweg-Hinweise", async () => {
  const h = umstellungsFixture(["mcp-claude-alt"]);
  try {
    process.env.FAKE_MCP_FAIL = "remove";
    const r = await starte(h, { schritte: ["A5"] });
    assert.equal(r.ok, false);
    assert.equal(r.zurueckgenommen, true);
    assert.equal(r.rueckwegHinweise, undefined);
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 9 Aufräumen, Platz, Fristen
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("Alte Probekopien dieses Vaults (älter als 7 Tage) werden aufgeräumt, frische und fremde bleiben", () => {
  const h = umstellungsFixture([]);
  try {
    const z = h.z();
    const alt = join(tmpdir(), `kortex-probelauf-${kennung(z.vault)}-alt${process.pid}`), neu = join(tmpdir(), `kortex-probelauf-${kennung(z.vault)}-neu${process.pid}`), fremd = join(tmpdir(), `kortex-probelauf-0000000000000000-fremd${process.pid}`);
    for (const d of [alt, neu, fremd]) mkdirSync(join(d, "vault"), { recursive: true });
    const vorZehnTagen = new Date(Date.now() - 10 * 86_400_000);
    for (const d of [alt, fremd]) utimesSync(d, vorZehnTagen, vorZehnTagen);
    assert.equal(raeumeAlteProben(z), 1);
    assert.ok(!existsSync(alt) && existsSync(neu) && existsSync(fremd));
    for (const d of [neu, fremd]) rmSync(d, { recursive: true, force: true });
  } finally { h.weg(); }
});

test("Zu wenig freier Platz: Probelauf und das Bundle von A0 brechen vorher ab, nichts wird angelegt", async () => {
  const h = umstellungsFixture(["kit-versioniert"]);
  try {
    const z = h.z();
    z.freierPlatz = () => 1000;
    await assert.rejects(probelauf(z, { bestaetigt: true }), /nicht genug freier Platz/);
    z.freierPlatz = () => 10 ** 12;
    z.probe = false;
    const zz = h.z(); zz.freierPlatz = () => 1000;
    freigabe(zz);
    const r = await phaseA(zz, { bestaetigt: true, schritte: ["A0"] });
    assert.equal(r.ok, false);
    assert.equal(r.grund, "zu-wenig-platz");
    assert.ok(!existsSync(join(ablageOrdner(zz), "vor-kortex.bundle")));
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 10 Kennung kanonisch, Übergang für bestehende Merker
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("Kennung: kanonischer Pfad (realpath.native), und ein unter der früheren Kennung angelegter Merker wird weiter gefunden", () => {
  const h = umstellungsFixture([]);
  try {
    const z = h.z();
    const ids = kennungen(z.vault);
    assert.equal(ids[0], kennung(z.vault));
    assert.equal(createHash("sha256").update(realpathSync.native(z.vault)).digest("hex").slice(0, 16), ids[0]);
    // anders geschriebener Pfad (Groß/klein des letzten Buchstabens vertauscht): auf APFS derselbe Ordner, gleiche Kennung wie der kanonische
    const e = realpathSync.native(z.vault);
    const i = [...e].map((c, n) => [c, n]).filter(([c]) => /[A-Za-z]/.test(c)).pop();
    if (i) {
      const [c, n] = i;
      const anders = e.slice(0, n) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + e.slice(n + 1);
      if (existsSync(anders)) {
        assert.equal(kennung(anders), kennung(e), "die Kennung hängt nicht von der Schreibweise des Pfads ab");
        const alt = kennungen(anders)[1];
        if (alt !== kennungen(anders)[0]) {
          mkdirSync(join(h.a.support, "backup"), { recursive: true });
          writeFileSync(join(h.a.support, "backup", `${alt}.json`), '{"pfad":"/x"}\n');
          assert.equal(merkerDateiFuer(anders, h.a.support), join(h.a.support, "backup", `${alt}.json`), "früherer Merker wird weiter gefunden");
        }
      }
    }
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 11 + 12 Globale git-Konfiguration: Verweis bleibt, Sperre wie git, Rückweg-Angaben vor dem Schreiben
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
function globalAlsVerweis(h) {
  const echt = join(h.a.extern, "dotfiles-gitconfig");
  writeFileSync(echt, readFileSync(h.gitGlobal));
  rmSync(h.gitGlobal);
  symlinkSync(echt, h.gitGlobal);
  return echt;
}
test("Globale git-Konfiguration als Verweis (Dotfiles): Block wird beim Ziel gesetzt und entfernt, der Verweis bleibt, der Inhalt ist Byte für Byte zurück", async () => {
  const h = umstellungsFixture(["credential-helper"]);
  try {
    const echt = globalAlsVerweis(h);
    const vor = sha(echt);
    assert.equal((await starte(h, { schritte: ["A2"] })).ok, true);
    assert.equal(lstatSync(h.gitGlobal).isSymbolicLink(), true);
    assert.match(readFileSync(echt, "utf8"), /includeIf/);
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.equal(lstatSync(h.gitGlobal).isSymbolicLink(), true);
    assert.equal(sha(echt), vor);
  } finally { h.weg(); }
});

test("Absturz VOR dem Schreiben des Blocks: die Rückweg-Angaben stehen schon (blockGesetzt), der Rückweg findet nichts zu entfernen und stellt die lokalen Schlüssel her", async () => {
  const h = umstellungsFixture(["credential-helper"]);
  try {
    const vor = umstellungsStand(h);
    await assert.rejects(starte(h, { schritte: ["A2"], abbruchBei: "A2:vor-block" }), TestAbbruch);
    const undo = json(join(ablageOrdner(h.z()), liesZustand(h.z()).schritte.A2.undo));
    assert.equal(undo.blockGesetzt, true);
    assert.ok(!readFileSync(h.gitGlobal, "utf8").includes("includeIf"));
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.equal(umstellungsStand(h), vor);
  } finally { h.weg(); }
});

test("Absturz nach den Schlüsseln, vor dem Vermerken von hashNachher der .git/config → Rückweg stellt Schlüssel und Block her", async () => {
  const h = umstellungsFixture(["credential-helper", "ssh-command"]);
  try {
    const vor = umstellungsStand(h);
    await assert.rejects(starte(h, { schritte: ["A2"], abbruchBei: "A2:nach-config" }), TestAbbruch);
    assert.match(readFileSync(h.gitGlobal, "utf8"), /includeIf/);
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.equal(umstellungsStand(h), vor);
  } finally { h.weg(); }
});

test("~/.gitconfig.lock: eine laufende Schreibung von git wird nicht überfahren – der Schritt scheitert, die lokalen Schlüssel und die globale Datei bleiben", async () => {
  const h = umstellungsFixture(["credential-helper"]);
  try {
    const vor = umstellungsStand(h);
    writeFileSync(`${h.gitGlobal}.lock`, "");
    const r = await starte(h, { schritte: ["A2"] });
    assert.equal(r.ok, false);
    assert.equal(r.grund, "git-config-gesperrt");
    assert.equal(r.zurueckgenommen, true);
    rmSync(`${h.gitGlobal}.lock`);
    assert.equal(umstellungsStand(h), vor);
    assert.ok(!existsSync(`${h.gitGlobal}.lock`));
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// A8: Absturz nach dem Schreiben / nach dem Commit
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
for (const punkt of ["A8:nach-schreiben", "A8:nach-commit"]) {
  test(`Absturz bei ${punkt} (Stand nicht vermerkt) → Rückweg stellt den Vault her (Datei weg bzw. Revert des Commits)`, async () => {
    const h = umstellungsFixture(["backup-pfad-gueltig"]);
    try {
      const vor = umstellungsStand(h);
      await assert.rejects(starte(h, { schritte: ["A8"], abbruchBei: punkt }), TestAbbruch);
      assert.ok(existsSync(join(h.a.vault, ".kortex")), "der Gerätemerker steht");
      assert.equal((await zurueck(h, { alles: true })).ok, true);
      assert.equal(umstellungsStand(h), vor);
    } finally { h.weg(); }
  });
}

test("A0: Absturz zwischen Kopieren und Vermerken von .git/config.vor-kortex → Rückweg räumt die Kopie weg", async () => {
  const h = umstellungsFixture([]);
  try {
    const vor = umstellungsStand(h);
    await assert.rejects(starte(h, { schritte: ["A0"], abbruchBei: "A0:nach-kopie" }), TestAbbruch);
    assert.ok(existsSync(join(h.a.vault, ".git", "config.vor-kortex")));
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.equal(umstellungsStand(h), vor);
    assert.ok(!existsSync(join(h.a.vault, ".git", "config.vor-kortex")));
  } finally { h.weg(); }
});

test("A1: Absturz nach dem Schreiben des Merkers, vor dem Vermerken von hashNachher → Rückweg entfernt genau unsere Schlüssel", async () => {
  const h = umstellungsFixture(["backup-pfad-gueltig"]);
  try {
    const vor = umstellungsStand(h);
    await assert.rejects(starte(h, { schritte: ["A1"], abbruchBei: "A1:nach-schreiben" }), TestAbbruch);
    assert.ok(existsSync(join(h.a.support, "backup")));
    assert.equal((await zurueck(h, { alles: true })).ok, true);
    assert.equal(umstellungsStand(h), vor);
  } finally { h.weg(); }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// 13 Vertrauen vor A0 · 14 roter A9
// ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("Nicht vertrauter Vault: Probelauf und Phase A enden VOR A0 mit eigenem Code (nicht-vertraut, Exit 6), nichts wird angelegt", async () => {
  const h = umstellungsFixture(["hooks-alt-sh"]);
  try {
    const z = h.z();
    z.vertrautPruefer = () => false;
    const vor = baumStand(h.a.basis);
    for (const f of [() => probelauf(z, { bestaetigt: true }), () => { freigabe(z); return phaseA(z, { bestaetigt: true }); }]) {
      await assert.rejects(f(), (e) => e.code === "nicht-vertraut" && e.exit === 6 && /nicht als deiner bestätigt/.test(e.message));
    }
    assert.ok(!existsSync(join(ablageOrdner(z), "vor-kortex.bundle")), "kein A0");
    assert.ok(!existsSync(join(h.a.vault, ".git", "config.vor-kortex")));
    assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.startsWith(`kortex-probelauf-${kennung(z.vault)}-`)), []);
    void vor;
  } finally { h.weg(); }
});

test("Roter A9: die Phase gilt NICHT als abgeschlossen (phase bleibt leer), kein Vertrauensvermerk, Ergebnis „mit Warnungen“; Weitermachen nach Behebung schließt ab", async () => {
  const h = umstellungsFixture(["plist-alt-anderer"]);
  try {
    const r = await starte(h);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.mitWarnungen, true);
    assert.equal(r.a9.ampel, "rot");
    assert.equal(r.phase, null);
    const zu = liesZustand(h.z());
    assert.equal(zu.phase, null);
    assert.equal(zu.vertrauen, undefined);
    assert.equal(zu.a9.ampel, "rot");
    const r2 = await starte(h, { entscheidungen: { dienstAnderer: true } });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.a9.ampel, "gruen", JSON.stringify(r2.a9));
    assert.equal(r2.phase, "A");
    assert.equal(liesZustand(h.z()).vertrauen, "vermerken");
  } finally { h.weg(); }
});

void inhaltsStand; void KERN; void dirname;
