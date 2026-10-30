// test-umstellung-phase-a.mjs — Paket P7b: Phase A der Umstellung (Plan docs/plaene/p7-umstellung.md Abschnitt 3 und 5).
// Geprüft wird: der ganze Durchlauf an einem Kit-Vault mit vielen Altlasten · Idempotenz · Rückweg „alles“ stellt den Stand Byte für Byte her · je Schritt Hin- und Rückweg ·
// ein Rückweg überschreibt nichts, was inzwischen geändert wurde · Abbruch nach/in jedem Schritt → Rückweg vollständig, Weitermachen geht · ein Fehler nimmt nur seinen Schritt zurück ·
// die Entscheidungen des Nutzers · nichts ohne --ja und ohne grünen Probelauf. Nur Temp-HOME/-Support/-gitconfig; launchctl, claude und codex nur als Attrappe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { umstellungsFixture, freigabe, umstellungsStand } from "./umstellung-hilfe.mjs";
import { GEHEIM } from "./fixture-altvault.mjs";
import { phaseA, TestAbbruch } from "../umstellung/phase-a.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { liesZustand, liesProtokoll, ablageOrdner } from "../umstellung/protokoll.mjs";
import { kennung } from "../umstellung/ziele.mjs";
import { KERN } from "../pfade.mjs";

const REICH = ["kit-versioniert", "hookspath-relativ", "credential-helper", "hooks-alt-sh", "statusline-alt", "zwei-profile", "commands-marke", "mcp-claude-alt", "mcp-codex-alt", "mcp-cursor-alt", "plist-alt-dieser-profil", "backup-pfad-gueltig", "hooks-fremd"];
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const starte = (h, opt = {}) => { freigabe(h.z(), opt.entscheidungen); return phaseA(h.z(), { bestaetigt: true, ...opt }); };
const zurueck = (h, opt = {}) => rueckweg(h.z(), { bestaetigt: true, ...opt });
const gitC = (h, ...a) => spawnSync("/usr/bin/git", ["-C", h.a.vault, ...a], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).stdout.trim();
const gitSicher = (h, ...a) => spawnSync("/bin/sh", [join(KERN, "git-sicher"), "-C", h.a.vault, ...a], { encoding: "utf8", env: { ...process.env } });
const befehle = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((x) => x.command));

test("Phase A ohne --ja: nur der Plan, nichts geschrieben; mit --ja aber ohne Probelauf: abgelehnt", async () => {
  const h = umstellungsFixture(REICH);
  try {
    const vorher = umstellungsStand(h);
    const plan = await phaseA(h.z(), {});
    assert.equal(plan.plan, true);
    assert.deepEqual(plan.schritte.map((s) => s.id), ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]);
    assert.ok(plan.schritte.find((s) => s.id === "A4").noetig);
    await assert.rejects(phaseA(h.z(), { bestaetigt: true }), /Probelauf/);
    assert.equal(umstellungsStand(h), vorher);
    assert.ok(!existsSync(join(ablageOrdner(h.z()), "zustand.json")) || !liesZustand(h.z()).phase);
  } finally { h.weg(); }
});

test("Durchlauf: alle Schritte wirken, A9 grün, Idempotenz, Rückweg „alles“ stellt den Stand Byte für Byte her", async () => {
  const h = umstellungsFixture(REICH);
  try {
    const vor = umstellungsStand(h);
    const mcpVorher = json(join(h.a.home, ".claude.json")).mcpServers.brain;
    const r = await starte(h);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.phase, "A");
    assert.equal(r.a9.ampel, "gruen", JSON.stringify(r.a9));
    const st = Object.fromEntries(r.schritte.map((s) => [s.id, s.status]));
    for (const id of ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A8"]) assert.equal(st[id], "ok", `${id}: ${JSON.stringify(r.schritte)}`);
    const z = h.z();
    // A0: Bundle, config.vor-kortex
    assert.ok(existsSync(join(ablageOrdner(z), "vor-kortex.bundle")));
    assert.ok(existsSync(join(h.a.vault, ".git", "config.vor-kortex")));
    // A1: Sicherungsordner im Support-Ordner, Config unverändert
    assert.equal(json(join(h.a.support, "backup", `${kennung(h.a.vault)}.json`)).pfad, join(h.a.basis, "sicherung"));
    assert.equal(json(join(h.a.vault, "brain.config.json")).backup.pfad, join(h.a.basis, "sicherung"));
    // A2: credential.* nicht mehr lokal, aber wirksam (über die Datei je Vault), Reihenfolge und leerer Reset bleiben
    assert.equal(spawnSync("/usr/bin/git", ["-C", h.a.vault, "config", "--local", "--get-all", "credential.helper"], { encoding: "utf8" }).status, 1);
    const werte = spawnSync("/usr/bin/git", ["-C", h.a.vault, "config", "--get-all", "-z", "credential.helper"], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).stdout.split("\0").slice(0, -1);
    assert.deepEqual(werte, ["", "osxkeychain", `store --file /x/${GEHEIM}`]);
    assert.equal(gitSicher(h, "status", "--porcelain").status, 0, "git-sicher läuft jetzt");
    // A3
    assert.equal(gitC(h, "config", "--local", "core.hooksPath"), join(h.a.support, "bin", "kern", "git-hooks"));
    // A4: beide Profile in neuer Form, Fremdes bleibt
    for (const p of [".claude", ".claude-privat"]) { const s = json(join(h.a.home, p, "settings.json")); assert.ok(befehle(s).some((c) => c.includes("kortex' hook session-start")), p); assert.ok(!befehle(s).some((c) => c.includes("session-start.sh")), p); }
    assert.ok(befehle(json(join(h.a.home, ".claude", "settings.json"))).some((c) => c.includes(`echo fertig ${GEHEIM}`)), "fremder Hook bleibt");
    // A5
    const neu = json(join(h.a.home, ".claude.json")).mcpServers.brain;
    assert.deepEqual([neu.command, neu.args], [join(h.a.support, "bin", "node"), [join(h.a.support, "bin", "kern", "mcp", "brain-mcp.mjs")]]);
    assert.match(readFileSync(join(h.a.home, ".codex", "config.toml"), "utf8"), /brain-mcp\.mjs/);
    assert.equal(json(join(h.a.home, ".cursor", "mcp.json")).mcpServers.brain.command, join(h.a.support, "bin", "node"));
    // A6: neue plist über den Starter, Profil bleibt, launchctl nur als Attrappe
    const plist = readFileSync(join(h.a.home, "Library", "LaunchAgents", "de.brain.tageslauf.plist"), "utf8");
    assert.ok(plist.includes(join(h.a.support, "bin", "kortex")) && !/BRAIN_VAULT|node-start/.test(plist));
    assert.ok(plist.includes(join(h.a.home, ".claude-privat")), "Claude-Profil des Dienstes bleibt");
    assert.ok(h.zeilen(h.log).some((l) => l.startsWith("bootstrap")));
    // A8: Gerätemerker und kernVersion im Vault, ein Commit
    const geraete = readdirSync(join(h.a.vault, ".kortex", "geraete"));
    assert.equal(geraete.length, 1);
    assert.ok(json(join(h.a.vault, ".kortex", "geraete", geraete[0])).phaseA);
    assert.ok(json(join(h.a.vault, "brain.config.json")).kernVersion);
    assert.equal(gitC(h, "log", "-1", "--format=%s"), "Kortex: Gerät umgestellt");
    // der alte Werkzeug-Ordner bleibt liegen (Phase B), nichts von den Notizen angefasst
    assert.ok(existsSync(join(h.a.vault, ".tools", "VERSION")));
    // Protokoll: keine Werte
    const prot = readFileSync(join(ablageOrdner(z), "protokoll.jsonl"), "utf8");
    assert.ok(!prot.includes(GEHEIM) && !prot.includes(h.a.home), "keine Werte im Protokoll");
    assert.equal(liesZustand(z).phase, "A");
    assert.equal(liesZustand(z).vertrauen, "vermerken");
    // Idempotenz: ein zweiter Lauf ändert nichts
    const nachEins = umstellungsStand(h);
    const r2 = await starte(h);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(umstellungsStand(h), nachEins, "zweiter Lauf ändert nichts");
    // Rückweg alles
    const rw = await zurueck(h, { alles: true });
    assert.equal(rw.ok, true);
    assert.equal(umstellungsStand(h), vor, "Rückweg stellt Home, Support, globale git-Konfiguration, Vault-Dateien und .git/config her");
    const alt = json(join(h.a.home, ".claude.json")).mcpServers.brain;
    assert.deepEqual([alt.command, alt.args], [mcpVorher.command, mcpVorher.args]);
    assert.equal(liesZustand(h.z()).phase, null);
    assert.ok(liesProtokoll(h.z()).some((e) => e.ereignis === "rueckweg"));
  } finally { h.weg(); }
});

// --- je Schritt: Hinweg wirkt, Rückweg stellt den Stand her -----------------------------------------------------------------------------------------------------
const MIT_AGENTS = (a) => a.schreibe(join(a.vault, "AGENTS.md"), `# Agenten\nSuche: node ${a.vault}/.tools/brain.mjs search\n`);
const SCHRITT_FAELLE = {
  A1: { faelle: ["backup-pfad-gueltig"] },
  A2: { faelle: ["credential-helper", "ssh-command", "url-insteadof", "remote-prune", "remote-lokal-pfad", "git-verweis-exclude"], ent: { remoteEntfernen: true, verweiseAufloesen: true } },
  A3: { faelle: ["hookspath-relativ"] },
  A4: { faelle: ["hooks-alt-sh", "zwei-profile", "commands-marke", "statusline-alt"] },
  A5: { faelle: ["mcp-claude-alt", "mcp-codex-alt", "mcp-cursor-alt"] },
  A6: { faelle: ["plist-alt-dieser-profil", "zwei-profile"] },
  A7: { faelle: [], vorher: (h) => MIT_AGENTS(h.a) },
  A8: { faelle: [] },
};
for (const [id, def] of Object.entries(SCHRITT_FAELLE)) {
  test(`Schritt ${id}: wirkt (und nur er), Rückweg stellt den Stand her, zweiter Lauf tut nichts`, async () => {
    const h = umstellungsFixture(def.faelle);
    try {
      if (def.vorher) def.vorher(h);
      const vor = umstellungsStand(h);
      const r = await starte(h, { entscheidungen: def.ent || {}, schritte: [id] });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.schritte.find((s) => s.id === id).status, "ok", JSON.stringify(r.schritte));
      const nach = umstellungsStand(h);
      assert.notEqual(nach, vor, `${id} hat etwas geändert`);
      assert.equal((await starte(h, { entscheidungen: def.ent || {}, schritte: [id] })).ok, true);
      assert.equal(umstellungsStand(h), nach, "zweiter Lauf ändert nichts");
      const rw = await zurueck(h, { schritte: [id], entscheidungen: def.ent || {} });
      assert.equal(rw.ok, true);
      if (id === "A0") return;
      // A0 war automatisch mit dabei: sein Rückweg räumt nur die Kopie in .git/ weg
      await zurueck(h, { schritte: ["A0"] });
      assert.equal(umstellungsStand(h), vor, `Rückweg von ${id} stellt den Stand her`);
    } finally { h.weg(); }
  });
}

// --- Rückweg überschreibt nichts, was inzwischen geändert wurde ---------------------------------------------------------------------------------------------------
test("Rückweg A4: eine inzwischen geänderte settings.json wird nicht überschrieben (nur unsere Einträge gehen), A1 und A5 ebenso", async () => {
  const h = umstellungsFixture(["hooks-alt-sh", "backup-pfad-gueltig", "mcp-cursor-alt"]);
  try {
    assert.equal((await starte(h, { schritte: ["A1", "A4", "A5"] })).ok, true);
    const s = join(h.a.home, ".claude", "settings.json");
    const doc = json(s); doc.eigenerSchluessel = "meins"; writeFileSync(s, JSON.stringify(doc, null, 2) + "\n");
    const m = join(h.a.support, "backup", `${kennung(h.a.vault)}.json`);
    writeFileSync(m, JSON.stringify({ ...json(m), meinSchluessel: 1 }) + "\n");
    const c = join(h.a.home, ".cursor", "mcp.json");
    const cd = json(c); cd.mcpServers.meiner = { command: "x" }; writeFileSync(c, JSON.stringify(cd, null, 2) + "\n");
    const rw = await zurueck(h, { schritte: ["A5", "A4", "A1"] });
    assert.equal(rw.ok, true);
    assert.equal(json(s).eigenerSchluessel, "meins", "geänderte settings.json bleibt");
    assert.ok(!befehle(json(s)).some((x) => x.includes("kortex' hook session-start")), "unser Hook-Eintrag ist trotzdem weg (und nur er: die schon vorher vorhandenen bleiben)");
    assert.ok(befehle(json(s)).some((x) => x.includes("session-start.sh")), "der alte Eintrag ist wieder da");
    assert.ok(rw.hinweise.some((x) => x.startsWith("A4:")), JSON.stringify(rw.hinweise));
    assert.equal(json(m).meinSchluessel, 1, "fremder Schlüssel im Merker bleibt");
    assert.equal(json(m).pfad, undefined, "unser Pfad ist weg");
    assert.deepEqual(json(c).mcpServers.meiner, { command: "x" });
    assert.equal(json(c).mcpServers.brain.args[0].includes("/.tools/"), true, "Cursor-Eintrag ist wieder der alte");
  } finally { h.weg(); }
});

// --- Abbruch mitten in Phase A ------------------------------------------------------------------------------------------------------------------------------------
for (const [wo, id] of [["nach", "A0"], ["nach", "A1"], ["nach", "A2"], ["nach", "A3"], ["nach", "A4"], ["nach", "A5"], ["nach", "A6"], ["nach", "A8"], ["in", "A2"], ["in", "A4"], ["in", "A5"], ["in", "A6"], ["in", "A8"]]) {
  test(`Abbruch ${wo} ${id}: Rückweg „alles“ stellt den Stand her`, async () => {
    const h = umstellungsFixture(REICH);
    try {
      const vor = umstellungsStand(h);
      await assert.rejects(starte(h, { [wo === "nach" ? "abbruchNach" : "abbruchIn"]: id }), TestAbbruch);
      const z = h.z();
      assert.ok(liesZustand(z).laeuft, "der Absturz hinterlässt den Zustand „unterbrochen“");
      assert.ok(!existsSync(join(ablageOrdner(z), "laeuft")), "die Sperre ist gelöst");
      const rw = await zurueck(h, { alles: true });
      assert.equal(rw.ok, true);
      assert.equal(umstellungsStand(h), vor);
    } finally { h.weg(); }
  });
}

test("Abbruch nach A4 → Weitermachen beendet die Phase", async () => {
  const h = umstellungsFixture(REICH);
  try {
    await assert.rejects(starte(h, { abbruchNach: "A4" }), TestAbbruch);
    const r = await starte(h);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.phase, "A");
    assert.equal(r.a9.ampel, "gruen");
  } finally { h.weg(); }
});

test("Fehler in A5 (Programm verweigert): nur A5 wird zurückgenommen, die Schritte davor bleiben, die Phase hält an", async () => {
  const h = umstellungsFixture(["hooks-alt-sh", "mcp-claude-alt"]);
  try {
    const kaputt = join(h.a.basis, "claude-kaputt.mjs");
    writeFileSync(kaputt, "process.exit(1);\n");
    process.env.BRAIN_CLAUDE = kaputt;
    const vorMcp = readFileSync(join(h.a.home, ".claude.json"), "utf8");
    const r = await starte(h);
    assert.equal(r.ok, false);
    assert.equal(r.fehlerBei, "A5");
    assert.equal(liesZustand(h.z()).schritte.A4.status, "ok");
    assert.equal(liesZustand(h.z()).schritte.A5.status, "fehler");
    assert.equal(readFileSync(join(h.a.home, ".claude.json"), "utf8"), vorMcp, "der alte MCP-Eintrag steht unverändert");
    assert.ok(!liesZustand(h.z()).phase, "Phase A ist nicht abgeschlossen");
    assert.ok(!existsSync(join(h.a.vault, ".kortex")), "nach dem Fehler läuft kein weiterer Schritt");
  } finally { h.weg(); }
});

// --- Entscheidungen -----------------------------------------------------------------------------------------------------------------------------------------------
test("Entscheidungen: Online-Ziel nur nach Bestätigung (und nur https/ssh), lokales Remote nie als bestätigt", async () => {
  for (const fall of ["remote-https", "remote-ssh"]) {
    const h = umstellungsFixture([fall]);
    try {
      const m = () => { try { return json(join(h.a.support, "backup", `${kennung(h.a.vault)}.json`)); } catch { return {}; } };
      assert.equal((await starte(h, { schritte: ["A1"] })).ok, true);
      assert.equal(m().remoteBestaetigt, undefined, "ohne ausdrückliche Bestätigung nichts");
      assert.equal((await starte(h, { schritte: ["A1"], entscheidungen: { remoteBestaetigen: true } })).ok, true);
      assert.ok(m().remoteBestaetigt, fall);
      await zurueck(h, { schritte: ["A1"] });
      assert.equal(m().remoteBestaetigt, undefined);
    } finally { h.weg(); }
  }
  const h = umstellungsFixture(["remote-lokal-pfad"]);
  try {
    await starte(h, { schritte: ["A1"], entscheidungen: { remoteBestaetigen: true } });
    assert.ok(!existsSync(join(h.a.support, "backup", `${kennung(h.a.vault)}.json`)));
  } finally { h.weg(); }
});

test("Entscheidungen: fremder core.hooksPath und fremder MCP-Eintrag bleiben ohne ausdrückliche Wahl; fremder Dienst eines anderen Vaults ebenso", async () => {
  const h = umstellungsFixture(["hookspath-fremd", "mcp-claude-fremd", "plist-alt-anderer"]);
  try {
    const vor = umstellungsStand(h);
    const r = await starte(h, { schritte: ["A3", "A5", "A6"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    for (const id of ["A3", "A6"]) assert.equal(r.schritte.find((s) => s.id === id).status, "uebersprungen", id);
    assert.equal(r.schritte.find((s) => s.id === "A5").status, "nichts");
    await zurueck(h, { schritte: ["A0"] });
    assert.equal(umstellungsStand(h), vor);
    // mit Wahl: ersetzt (und ist umkehrbar)
    const r2 = await starte(h, { schritte: ["A3", "A5", "A6"], entscheidungen: { hooksErsetzen: true, mcpAnders: true, dienstAnderer: true } });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(gitC(h, "config", "--local", "core.hooksPath"), join(h.a.support, "bin", "kern", "git-hooks"));
    assert.equal(json(join(h.a.home, ".claude.json")).mcpServers.brain.command, join(h.a.support, "bin", "node"));
    await zurueck(h, { alles: true, entscheidungen: { hooksErsetzen: true } });
    assert.equal(umstellungsStand(h), vor);
    assert.equal(json(join(h.a.home, ".claude.json")).mcpServers.brain.command, "/usr/bin/foo");
  } finally { h.weg(); }
});

test("Ein Eintrag nur auf Projektebene und fehlendes claude: übersprungen, nichts kaputt", async () => {
  const h = umstellungsFixture(["mcp-claude-projekt"]);
  try {
    const r = await starte(h, { schritte: ["A5"] });
    assert.equal(r.ok, true);
    assert.equal(r.schritte.find((s) => s.id === "A5").status, "uebersprungen");
  } finally { h.weg(); }
});

// --- git-umzug im Einzelnen -------------------------------------------------------------------------------------------------------------------------------------
test("git-umzug: die Einbindung wirkt im Vault und in verknüpften Arbeitsbäumen, aber nicht in einem anderen Repository; zwei includeIf; Rückweg entfernt sie", async () => {
  const h = umstellungsFixture(["credential-helper", "url-insteadof", "ssh-command"], { vaultName: "V [1]*x ä'" });
  try {
    assert.equal((await starte(h, { schritte: ["A2"] })).ok, true);
    const global = readFileSync(h.gitGlobal, "utf8");
    assert.equal((global.match(/\[includeIf /g) || []).length, 2, "zwei Einbindungen");
    assert.ok(/gitdir(\/i)?:[^"]*\.git\/worktrees\/"\]/.test(global), "Muster für verknüpfte Arbeitsbäume mit Schrägstrich am Ende");
    assert.ok(global.includes("\\\\*") && global.includes("\\\\["), "Sonderzeichen des Musters sind maskiert");
    const datei = join(h.a.support, "git", `${kennung(h.a.vault)}.gitconfig`);
    assert.equal((lstatSync(datei).mode & 0o777), 0o600);
    assert.equal(gitC(h, "config", "--get", "core.sshCommand"), `ssh -i /k/${GEHEIM}`);
    // verknüpfter Arbeitsbaum (wie die Arbeitskopien des Tageslaufs)
    const wt = join(h.a.basis, "arbeitsbaum");
    spawnSync("/usr/bin/git", ["-C", h.a.vault, "worktree", "add", "-q", "--detach", wt], { encoding: "utf8" });
    assert.equal(spawnSync("/usr/bin/git", ["-C", wt, "config", "--get", "core.sshCommand"], { encoding: "utf8" }).stdout.trim(), `ssh -i /k/${GEHEIM}`, "wirkt im Arbeitsbaum");
    // ein anderes Repository bekommt nichts davon
    const fremd = join(h.a.basis, "fremd");
    spawnSync("/usr/bin/git", ["init", "-q", fremd], { encoding: "utf8" });
    assert.equal(spawnSync("/usr/bin/git", ["-C", fremd, "config", "--get", "core.sshCommand"], { encoding: "utf8" }).stdout.trim(), "", "gilt nicht für andere Repositories");
    spawnSync("/usr/bin/git", ["-C", h.a.vault, "worktree", "remove", "--force", wt], { encoding: "utf8" });
    assert.equal((await zurueck(h, { schritte: ["A2"] })).ok, true);
    assert.ok(!readFileSync(h.gitGlobal, "utf8").includes("includeIf"));
    assert.ok(!existsSync(datei));
    assert.equal(gitC(h, "config", "--local", "core.sshCommand"), `ssh -i /k/${GEHEIM}`, "der Schlüssel steht wieder lokal");
  } finally { h.weg(); }
});

test("git-umzug: strukturelle Schlüssel bleiben (nicht verschiebbar), die verschiebbaren ziehen um", async () => {
  const h = umstellungsFixture(["credential-helper", "partialclone"]);
  try {
    const r = await starte(h, { schritte: ["A2"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.schritte.find((s) => s.id === "A2").details.strukturell > 0, true);
    assert.equal(gitC(h, "config", "--local", "extensions.partialclone"), "origin");
  } finally { h.weg(); }
});

test("GIT_ALLOW_PROTOCOL übersteht git-sicher (der Probelauf schottet das Netz damit ab)", () => {
  const h = umstellungsFixture([]);
  try {
    const bare = join(h.a.basis, "bare.git");
    spawnSync("/usr/bin/git", ["init", "-q", "--bare", bare]);
    const lauf = (env) => spawnSync("/bin/sh", [join(KERN, "git-sicher"), "-C", h.a.vault, "ls-remote", bare], { encoding: "utf8", env: { ...process.env, ...env } });
    assert.equal(lauf({}).status, 0, "ohne die Variable geht ls-remote");
    const r = lauf({ GIT_ALLOW_PROTOCOL: "kortex-probelauf" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not allowed|nicht erlaubt/i);
  } finally { h.weg(); }
});

test("Zwei Läufe gleichzeitig: die Sperre verhindert den zweiten; ein toter Prozess hinterlässt eine ersetzbare Sperre", async () => {
  const h = umstellungsFixture(["hooks-alt-sh"]);
  try {
    const z = h.z();
    mkdirSync(ablageOrdner(z), { recursive: true });
    writeFileSync(join(ablageOrdner(z), "laeuft"), JSON.stringify({ pid: process.ppid, zeit: new Date().toISOString() }));
    await assert.rejects(starte(h), /läuft gerade schon/);
    writeFileSync(join(ablageOrdner(z), "laeuft"), JSON.stringify({ pid: 2 ** 22 - 3, zeit: new Date().toISOString() }));
    assert.equal((await starte(h, { schritte: ["A4"] })).ok, true);
  } finally { h.weg(); }
});

test("Die Vault-Sperre (.logs/ingest.lock) hält Pflege und Tageslauf während Phase A fern und ist danach weg", async () => {
  const h = umstellungsFixture(["hooks-alt-sh"]);
  try {
    freigabe(h.z());
    mkdirSync(join(h.a.vault, ".logs"), { recursive: true });
    writeFileSync(join(h.a.vault, ".logs", "ingest.lock"), new Date().toISOString() + "\n");
    await assert.rejects(phaseA(h.z(), { bestaetigt: true }), /anderes|arbeitet/);
    writeFileSync(join(h.a.vault, ".logs", "ingest.lock"), "x");
    const alt = new Date(Date.now() - 3 * 3600_000);
    spawnSync("/usr/bin/touch", ["-t", alt.toISOString().replace(/\D/g, "").slice(0, 12), join(h.a.vault, ".logs", "ingest.lock")]);
    assert.equal((await starte(h, { schritte: ["A4"] })).ok, true);
    assert.ok(!existsSync(join(h.a.vault, ".logs", "ingest.lock")));
  } finally { h.weg(); }
});
