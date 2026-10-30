// test-umstellung-konto.mjs — Paket P2 (docs/plaene/ki-konten.md): die Umstellung schreibt Hook-Befehle und MCP-Einträge mit `--konto <id>`, die Kennung kommt aus der Liste der
// KI-Konten (<Support>/ki-konten.json) je Profil/Programm. Ohne Liste bleibt es die Altform. Nur Temp-HOME/-Support; claude und codex nur als Attrappe (fake-mcp-lib).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { umstellungsFixture, freigabe, umstellungsStand } from "./umstellung-hilfe.mjs";
import { phaseA } from "../umstellung/phase-a.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { einstufung, ohneKonto } from "../umstellung/mcp-lage.mjs";
import { kontoLeser } from "../umstellung/konto.mjs";

const IDS = { std: "k_00000001", privat: "k_00000002", codex: "k_00000003", cursor: "k_00000004" };
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const starte = (h, opt = {}) => { freigabe(h.z(), opt.entscheidungen); return phaseA(h.z(), { bestaetigt: true, ...opt }); };
const zurueck = (h, opt = {}) => rueckweg(h.z(), { bestaetigt: true, ...opt });
const befehle = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((x) => x.command));
const echt = (p) => realpathSync(p);

// legt die Liste der KI-Konten an (so, wie die Werkstatt sie führt): ein Konto je Programm-Ordner
function schreibeListe(h, { ohne = [] } = {}) {
  for (const o of [".cursor", ".codex", ".claude", ".claude-privat"]) mkdirSync(join(h.a.home, o), { recursive: true });
  const konten = {
    [IDS.std]: { programm: "claude", ordner: echt(join(h.a.home, ".claude")), standard: true, name: "Claude Code", ordnerKennung: "", seit: "2026-10-30T00:00:00.000Z" },
    [IDS.privat]: { programm: "claude", ordner: echt(join(h.a.home, ".claude-privat")), standard: false, name: "Privat", ordnerKennung: "", seit: "2026-10-30T00:00:00.000Z" },
    [IDS.codex]: { programm: "codex", ordner: echt(join(h.a.home, ".codex")), standard: true, name: "Codex", ordnerKennung: "", seit: "2026-10-30T00:00:00.000Z" },
    [IDS.cursor]: { programm: "cursor", ordner: echt(join(h.a.home, ".cursor")), standard: true, name: "Cursor", ordnerKennung: "", seit: "2026-10-30T00:00:00.000Z" },
  };
  for (const o of ohne) delete konten[o];
  writeFileSync(join(h.a.support, "ki-konten.json"), JSON.stringify({ version: 1, konten, vaults: {} }, null, 2));
}

test("A4 und A5: Hook-Befehle und MCP-Einträge tragen --konto <id> des jeweiligen Profils/Programms; der Rückweg stellt den Stand her", async () => {
  const h = umstellungsFixture(["hooks-alt-sh", "zwei-profile", "mcp-claude-alt", "mcp-codex-alt", "mcp-cursor-alt"]);
  try {
    // das zweite Profil hat einen eigenen alten MCP-Eintrag
    writeFileSync(join(h.a.home, ".claude-privat", ".claude.json"), JSON.stringify({ mcpServers: { brain: json(join(h.a.home, ".claude.json")).mcpServers.brain } }, null, 2));
    schreibeListe(h);
    const vor = umstellungsStand(h);
    const r = await starte(h, { schritte: ["A4", "A5"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const server = join(h.a.support, "bin", "kern", "mcp", "brain-mcp.mjs"), node = join(h.a.support, "bin", "node");
    // Hooks je Profil mit der Kennung des Profils
    for (const [profil, id] of [[".claude", IDS.std], [".claude-privat", IDS.privat]]) {
      const hooks = befehle(json(join(h.a.home, profil, "settings.json"))).filter((c) => / hook /.test(c));
      // neun Hooks des Installers, jeder mit der Kennung (ein schon vorher vorhandener Hook ohne Argumente, den der Installer nicht als seinen erkennt, zählt nicht mit)
      const mit = hooks.filter((c) => new RegExp(` --konto ${id}(?:\\s|\\|)`).test(c));
      assert.ok(mit.length >= 9, `${profil}: ${mit.length} Hooks mit Kennung`);
      assert.ok(hooks.every((c) => !c.includes("--konto") || c.includes(` --konto ${id}`)), `${profil}: keine fremde Kennung`);
    }
    // MCP: Claude (Standard und Profil), Codex, Cursor
    assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.brain.args, [server, "--konto", IDS.std]);
    assert.equal(json(join(h.a.home, ".claude.json")).mcpServers.brain.command, node);
    assert.deepEqual(json(join(h.a.home, ".claude-privat", ".claude.json")).mcpServers.brain.args, [server, "--konto", IDS.privat]);
    assert.deepEqual(json(join(h.a.home, ".cursor", "mcp.json")).mcpServers.brain.args, [server, "--konto", IDS.cursor]);
    const toml = readFileSync(join(h.a.home, ".codex", "config.toml"), "utf8");
    assert.match(toml, new RegExp(`args = \\["${server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*"--konto",\\s*"${IDS.codex}"\\]`));
    // zweiter Lauf: nichts mehr zu tun (die Einträge sind „gleich“, auch mit Kennung)
    const nach = umstellungsStand(h);
    assert.equal((await starte(h, { schritte: ["A4", "A5"] })).ok, true);
    assert.equal(umstellungsStand(h), nach, "idempotent");
    // Rückweg
    assert.equal((await zurueck(h, { schritte: ["A5", "A4"] })).ok, true);
    await zurueck(h, { schritte: ["A0"] });
    assert.equal(json(join(h.a.home, ".claude.json")).mcpServers.brain.args.includes("--konto"), false, "wieder der alte Eintrag");
    assert.equal(umstellungsStand(h), vor, "der Rückweg stellt den Stand her");
  } finally { h.weg(); }
});

test("Ein Programm, das die Liste nicht kennt, bleibt in der Altform (ohne --konto); nichts wird geraten", async () => {
  const h = umstellungsFixture(["hooks-alt-sh", "zwei-profile", "mcp-claude-alt", "mcp-codex-alt"]);
  try {
    schreibeListe(h, { ohne: [IDS.privat, IDS.codex] });
    assert.equal((await starte(h, { schritte: ["A4", "A5"] })).ok, true);
    const server = join(h.a.support, "bin", "kern", "mcp", "brain-mcp.mjs");
    assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.brain.args, [server, "--konto", IDS.std]);
    assert.ok(!readFileSync(join(h.a.home, ".codex", "config.toml"), "utf8").includes("--konto"), "Codex ist nicht in der Liste");
    const privat = befehle(json(join(h.a.home, ".claude-privat", "settings.json"))).filter((c) => / hook /.test(c));
    assert.ok(privat.length > 0 && privat.every((c) => !c.includes("--konto")), "das Profil ist nicht in der Liste");
  } finally { h.weg(); }
});

test("Ohne Liste oder mit beschädigter Liste: Altform wie bisher", async () => {
  for (const inhalt of [null, "kein json"]) {
    const h = umstellungsFixture(["hooks-alt-sh", "mcp-claude-alt"]);
    try {
      if (inhalt !== null) writeFileSync(join(h.a.support, "ki-konten.json"), inhalt);
      assert.equal((await starte(h, { schritte: ["A4", "A5"] })).ok, true);
      assert.deepEqual(json(join(h.a.home, ".claude.json")).mcpServers.brain.args, [join(h.a.support, "bin", "kern", "mcp", "brain-mcp.mjs")]);
      assert.ok(befehle(json(join(h.a.home, ".claude", "settings.json"))).every((c) => !c.includes("--konto")));
    } finally { h.weg(); }
  }
});

test("Einstufung: --konto am Ende gehört zu Kortex — mit bekannter Kennung „gleich“ nur bei derselben Kennung, sonst „alt“; ohne bekannte Kennung bleibt ein Eintrag mit Kennung „gleich“", () => {
  const soll = { node: "/s/bin/node", server: "/s/bin/kern/mcp/brain-mcp.mjs" };
  const bekannt = () => false;
  const e = (args) => ({ command: soll.node, args });
  assert.equal(einstufung(e([soll.server]), soll, bekannt), "gleich");
  assert.equal(einstufung(e([soll.server, "--konto", IDS.std]), soll, bekannt), "gleich", "Liste unbekannt: nichts anfassen");
  assert.equal(einstufung(e([soll.server]), { ...soll, konto: IDS.std }, bekannt), "alt", "fehlende Kennung wird ergänzt");
  assert.equal(einstufung(e([soll.server, "--konto", IDS.privat]), { ...soll, konto: IDS.std }, bekannt), "alt", "andere Kennung wird berichtigt");
  assert.equal(einstufung(e([soll.server, "--konto", IDS.std]), { ...soll, konto: IDS.std }, bekannt), "gleich");
  assert.equal(einstufung(e([soll.server, "--konto", "nicht-gueltig"]), { ...soll, konto: IDS.std }, bekannt), "anders", "eine ungültige Kennung ist kein Kortex-Eintrag");
  assert.equal(einstufung({ command: "/usr/bin/foo", args: ["--konto", IDS.std] }, { ...soll, konto: IDS.std }, bekannt), "anders");
  assert.deepEqual(ohneKonto(["a", "--konto", IDS.std]), { args: ["a"], konto: IDS.std });
  assert.deepEqual(ohneKonto(["a"]), { args: ["a"], konto: null });
});

test("kontoLeser: findet das Konto über Programm und echten Ort; mehrere Treffer über die Ordnerkennung; fehlende/kaputte Liste → null", () => {
  const h = umstellungsFixture(["zwei-profile"]);
  try {
    assert.equal(kontoLeser(h.a.support)("claude", join(h.a.home, ".claude")), null, "keine Liste");
    schreibeListe(h);
    const lies = kontoLeser(h.a.support);
    assert.equal(lies("claude", join(h.a.home, ".claude")), IDS.std);
    assert.equal(lies("claude", join(h.a.home, ".claude-privat")), IDS.privat);
    assert.equal(lies("codex", join(h.a.home, ".claude")), null, "anderes Programm");
    assert.equal(lies("claude", join(h.a.home, ".claude-gibtsnicht")), null);
    writeFileSync(join(h.a.support, "ki-konten.json"), "{");
    assert.equal(kontoLeser(h.a.support)("claude", join(h.a.home, ".claude")), null, "kaputt");
  } finally { h.weg(); }
});
