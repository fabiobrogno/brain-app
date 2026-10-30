// Sperre in Claude Code und Oberfläche der KI-Konten (docs/plaene/ki-konten.md, Paket P2): Leseverbot (permissions.deny) schreiben und entfernen, „Strenger Schutz“ (Sandbox),
// Routen /api/ki/standard, /schutz, /hinweis, /vorher, Anzeige des Zustands. Nur Wegwerf-Orte unter dem Temp-Ordner; HOME wird für den Handler im selben Prozess gesetzt und
// nach jedem Test zurückgesetzt. Nie ein echtes ~/.claude: die Werkstatt verweigert im Testmodus jedes Schreiben außerhalb des Temp-Ordners (eigener Test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync, readdirSync, existsSync, realpathSync, chmodSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const S = await import(pfad("gemeinsam", "claude-sperre.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const HOOKS = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0" }] }] } };
const profil = (home, name = "", inhalt = {}) => {
  const p = join(home, name ? `.claude-${name}` : ".claude");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "settings.json"), JSON.stringify(inhalt, null, 2) + "\n");
  return realpathSync(p);
};
const settings = (p) => JSON.parse(readFileSync(join(p, "settings.json"), "utf8"));
const baks = (p) => readdirSync(p).filter((n) => n.startsWith("settings.json.bak-"));
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
async function mitHome(home, fn) {
  const alt = process.env.HOME; process.env.HOME = home;
  try { return await fn(); } finally { process.env.HOME = alt; }
}
function aufbau({ konten = [["a", HOOKS], ["b", {}]], vaults = 2 } = {}) {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const profile = konten.map(([n, inhalt]) => profil(home, n, inhalt));
  const vs = Array.from({ length: vaults }, neuesVault);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: vs.map((p, i) => ({ name: `V${i + 1}`, pfad: p, farbe: "#5B8DEF" })), aktiv: vs[0] }));
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n");
  const h = erzeugeHandler({ vault: vs[0], vaultOptionen: { support: s }, mcpPfad: join(mcp, "brain-mcp.mjs") });
  return { home, s, profile, vs, rufe: aufruf(h) };
}
// Die Einstellungsregeln (Kortex-Einstellungen, Einstellungsdateien des Profils, .mcp.json) gehören zum Leseverbot; die Tests prüfen sie getrennt von den Regeln für Vaults.
const istEinst = (r) => /\.mcp\.json|\.claude\/settings|settings\.json|\.claude\.json|vaults\.json|ki-konten\.json|brain-support-/.test(r);
const ohneEinst = (liste) => (liste || []).filter((r) => !istEinst(r));
const nurEinst = (liste) => (liste || []).filter(istEinst);
const kontoVon = (j, p) => j.konten.find((k) => k.ordner.endsWith(p.split("/").pop()));

// ───────────────────────────── Regeln: Pfadformen ─────────────────────────────
test("Regel: absoluter Pfad mit //, gitignore- und Regelzeichen werden maskiert, Leerzeichen und Umlaute bleiben, beide Pfadformen bei Symlinks", () => {
  assert.equal(S.regelPfad("/Users/x/Vault"), "//Users/x/Vault");
  assert.equal(S.regelPfad("/Users/x/Mein [Vault] (a)*?"), "//Users/x/Mein \\[Vault\\] (a)\\*\\?", "Klammern bleiben unmaskiert (die Doku maskiert sie nicht)");
  assert.equal(S.regelPfad("/Users/x/a\\b"), "//Users/x/a\\\\b");
  assert.equal(S.regelPfad("/Users/x/Büro Äö ß/Wiki"), "//Users/x/Büro Äö ß/Wiki");
  assert.equal(S.regelPfad("/Users/x/Vault/"), "//Users/x/Vault", "kein doppelter Schrägstrich am Ende");
  const echt = tmp("brain-echt-"), verweis = join(tmp("brain-verweis-"), "link");
  symlinkSync(echt, verweis);
  const regeln = S.vaultRegeln(verweis, echt);
  assert.deepEqual(regeln, [`Read(//${verweis.slice(1)}/**)`, `Edit(//${verweis.slice(1)}/**)`, `Read(//${echt.slice(1)}/**)`, `Edit(//${echt.slice(1)}/**)`]);
  assert.deepEqual(S.vaultRegeln(echt, echt), [`Read(//${echt.slice(1)}/**)`, `Edit(//${echt.slice(1)}/**)`], "gleiche Form nur einmal");
  assert.throws(() => S.vaultRegeln("/Users/x/a\nb"), /Steuerzeichen/);
  // NFC und NFD: beide Schreibweisen, wenn sie sich unterscheiden (macOS speichert Umlaute zerlegt)
  const nfd = S.vaultRegeln("/Users/x/Bücher".normalize("NFD"));
  assert.ok(nfd.includes(`Read(//Users/x/${"Bücher".normalize("NFC")}/**)`) && nfd.includes(`Read(//Users/x/${"Bücher".normalize("NFD")}/**)`), JSON.stringify(nfd));
  assert.equal(S.vaultRegeln("/Users/x/Buecher").length, 2, "ohne Umlaut nur eine Form");
  assert.deepEqual(S.sandboxPfade(verweis, echt), [verweis, echt], "in der Sandbox ist /pfad absolut, ohne Maskierung");
});

test("Pfade mit Sonderzeichen: Leerzeichen, Umlaute, Klammern (unmaskiert), eckige Klammern (maskiert) in der settings.json und gehen wieder heraus", () => {
  const p = tmp("brain-profil-"), vault = join(tmp("brain-vaults-"), "Büro [Firma] (neu)");
  mkdirSync(vault);
  const regeln = S.vaultRegeln(vault);
  const r = S.tragRegelnEin(p, regeln);
  assert.deepEqual(r.angelegt, ["permissions", "deny"], "Kortex meldet, welche Behälter es angelegt hat");
  assert.ok(settings(p).permissions.deny.every((x) => x.includes("\\[Firma\\] (neu)")));
  S.nimmRegelnHeraus(p, regeln, r.angelegt);
  assert.deepEqual(settings(p), {}, "nichts bleibt übrig: die Behälter hat Kortex angelegt, also nimmt es sie wieder mit");
  // …aber leere Behälter, die schon da waren, bleiben stehen
  writeFileSync(join(p, "settings.json"), JSON.stringify({ permissions: { deny: [] } }));
  const r2 = S.tragRegelnEin(p, regeln);
  assert.deepEqual(r2.angelegt, [], "nichts angelegt");
  S.nimmRegelnHeraus(p, regeln, r2.angelegt);
  assert.deepEqual(settings(p), { permissions: { deny: [] } }, "der leere Behälter des Nutzers bleibt");
});

// ───────────────────────────── Leseverbot über die Route ─────────────────────────────
test("Sperren mit claudeSperre schreibt Read- und Edit-Verbot in die settings.json genau dieses Kontos; Entsperren nimmt nur die eigenen Regeln heraus, Fremdes bleibt", async () => {
  const { home, s, profile: [pa, pb], vs: [v1, v2], rufe } = aufbau({ konten: [["a", HOOKS], ["b", { permissions: { allow: ["Bash(ls:*)"], deny: ["Read(//etc/**)", "Bash(rm:*)"], defaultMode: "default" }, model: "opus", env: { X: "1" } }]] });
  await mitHome(home, async () => {
    let r = await rufe("GET", "/api/ki/konten");
    const b = kontoVon(r.j, pb), a = kontoVon(r.j, pa);
    assert.equal(b.schutz.moeglich, true);
    const vorherB = readFileSync(join(pb, "settings.json"), "utf8");
    // ohne claudeSperre: nur die Stufe in Kortex, die Einstellungen von Claude Code bleiben Byte für Byte
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "gesperrt" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.claude.aktion, "nichts");
    assert.equal(readFileSync(join(pb, "settings.json"), "utf8"), vorherB);
    assert.equal(baks(pb).length, 0);
    // mit claudeSperre
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.claude.aktion, "eingetragen");
    const soll = [`Read(//${v1.slice(1)}/**)`, `Edit(//${v1.slice(1)}/**)`];
    assert.deepEqual(r.j.claude.regeln, soll);
    const sb = settings(pb);
    assert.deepEqual(ohneEinst(sb.permissions.deny), ["Read(//etc/**)", "Bash(rm:*)", ...soll], "Fremdes bleibt, die eigenen kommen dazu");
    // dazu die Einstellungsregeln: Support-Ordner, Einstellungsdateien des Profils, Projektdateien (die KI darf ihre Kennung und die Sperren nicht umschreiben)
    const einst = nurEinst(sb.permissions.deny);
    for (const erwartet of [`Edit(//${s.slice(1)}/**)`, `Read(//${s.slice(1)}/vaults.json)`, `Read(//${s.slice(1)}/ki-konten.json*)`, `Edit(//${pb.slice(1)}/settings.json)`, `Read(//${pb.slice(1)}/settings.json*)`, `Edit(//${pb.slice(1)}/.claude.json)`, "Edit(**/.mcp.json)", "Edit(**/.claude/settings.json)", "Edit(**/.claude/settings.local.json)"]) assert.ok(einst.includes(erwartet), erwartet);
    assert.deepEqual(sb.permissions.allow, ["Bash(ls:*)"]);
    assert.equal(sb.permissions.defaultMode, "default"); assert.equal(sb.model, "opus"); assert.deepEqual(sb.env, { X: "1" });
    assert.equal(baks(pb).length, 1, "eine Sicherung vor dem Schreiben");
    assert.equal(readFileSync(join(pb, baks(pb)[0]), "utf8"), vorherB, "die Sicherung ist die Fassung davor");
    assert.deepEqual(settings(pa), HOOKS, "das andere Konto bleibt unberührt");
    assert.equal(baks(pa).length, 0);
    // der Merker nennt, was Kortex eingetragen hat
    const d = K.liesKonten(s).daten;
    assert.deepEqual(d.eingetragen[b.id].claudeDeny[v1], soll);
    assert.deepEqual(d.eingetragen[b.id].claudeDeny["@einstellungen"], einst, "auch die Einstellungsregeln sind als von Kortex vermerkt");
    assert.equal((statSync(K.kontenPfad(s)).mode & 0o777), 0o600);
    // Zustand in der Anzeige
    r = await rufe("GET", "/api/ki/konten");
    assert.equal(kontoVon(r.j, pb).schutz.vaults[v1], "aktiv");
    assert.equal(kontoVon(r.j, pb).schutz.vaults[v2], "aus", "v2 ist (wie jeder Vault für ein nie zugeordnetes Konto) gesperrt, aber ohne Leseverbot in Claude Code");
    assert.equal(kontoVon(r.j, pa).schutz.vaults[v2], undefined, "a ist verbunden und behält die Rechte von heute: nichts gesperrt");
    await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v2, stufe: "lesen" });
    assert.equal(kontoVon((await rufe("GET", "/api/ki/konten")).j, pb).schutz.vaults[v2], undefined, "nur gesperrte Vaults erscheinen");
    // zweites Eintragen ändert nichts (idempotent, keine zweite Sicherung)
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.deepEqual(ohneEinst(settings(pb).permissions.deny), ["Read(//etc/**)", "Bash(rm:*)", ...soll]);
    assert.equal(baks(pb).length, 1);
    // der Nutzer nimmt eine Regel selbst heraus → Anzeige „fehlt“, erneutes Eintragen stellt sie wieder her
    const doc = settings(pb); doc.permissions.deny = doc.permissions.deny.filter((x) => x !== soll[1]); writeFileSync(join(pb, "settings.json"), JSON.stringify(doc, null, 2));
    r = await rufe("GET", "/api/ki/konten");
    assert.equal(kontoVon(r.j, pb).schutz.vaults[v1], "fehlt");
    await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.ok(settings(pb).permissions.deny.includes(soll[1]));
    // Entsperren (jede Stufe über gesperrt) nimmt genau die eigenen Regeln heraus
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "lesen" });
    assert.equal(r.j.claude.aktion, "entfernt");
    assert.deepEqual(settings(pb).permissions.deny, ["Read(//etc/**)", "Bash(rm:*)"], "mit dem letzten Leseverbot gehen auch die Einstellungsregeln");
    assert.deepEqual(settings(pb).permissions.allow, ["Bash(ls:*)"]);
    assert.equal(K.liesKonten(s).daten.eingetragen, undefined, "kein Vermerk mehr");
    // noch einmal entsperren: nichts zu tun
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "posteingang" });
    assert.equal(r.j.claude.aktion, "nichts");
    // ein zweiter Vault, claudeSperre:false bei gesperrt entfernt ebenfalls
    await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v2, stufe: "gesperrt", claudeSperre: true });
    assert.equal(ohneEinst(settings(pb).permissions.deny).length, 4);
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v2, stufe: "gesperrt", claudeSperre: false });
    assert.equal(r.j.claude.aktion, "entfernt");
    assert.deepEqual(settings(pb).permissions.deny, ["Read(//etc/**)", "Bash(rm:*)"]);
    // Eingaben
    assert.equal((await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v1, stufe: "gesperrt", claudeSperre: "ja" })).status, 400);
  });
});

test("Eine Regel, die der Nutzer schon selbst hat, gehört ihm: Kortex vermerkt sie nicht und entfernt sie nie", async () => {
  const { home, profile: [pa], vs: [v1], rufe, s } = aufbau({ konten: [["a", {}]], vaults: 1 });
  const lese = `Read(//${v1.slice(1)}/**)`, edit = `Edit(//${v1.slice(1)}/**)`;
  writeFileSync(join(pa, "settings.json"), JSON.stringify({ permissions: { deny: [lese] } }));
  await mitHome(home, async () => {
    const a = kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.deepEqual(ohneEinst(settings(pa).permissions.deny), [lese, edit]);
    assert.deepEqual(K.liesKonten(s).daten.eingetragen[a.id].claudeDeny[v1], [edit], "nur das Hinzugekommene ist vermerkt");
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "lesen" });
    assert.deepEqual(settings(pa).permissions.deny, [lese], "die eigene Regel des Nutzers bleibt (und nur sie)");
  });
});

test("settings.json als Symlink (Dotfiles): das Ziel wird geändert, der Link bleibt, Rechte bleiben; Sicherung neben dem Pfad", async () => {
  const { home, profile: [pa], vs: [v1], rufe } = aufbau({ konten: [["a", {}]], vaults: 1 });
  const ziel = join(tmp("brain-dotfiles-"), "settings-echt.json");
  writeFileSync(ziel, JSON.stringify({ model: "x" }, null, 2) + "\n"); chmodSync(ziel, 0o640);
  const link = join(pa, "settings.json");
  mkdirSync(join(pa, "projects")); // so erkennt Kortex das Profil auch mit einem Symlink als settings.json
  const fs = await import("node:fs"); fs.rmSync(link); symlinkSync(ziel, link);
  await mitHome(home, async () => {
    const a = kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
    const r = await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.equal(r.j.claude.aktion, "eingetragen", JSON.stringify(r.j.claude));
    assert.ok(lstatSync(link).isSymbolicLink(), "der Link bleibt ein Link");
    assert.equal(JSON.parse(readFileSync(ziel, "utf8")).model, "x");
    assert.equal(ohneEinst(JSON.parse(readFileSync(ziel, "utf8")).permissions.deny).length, 2);
    assert.equal(statSync(ziel).mode & 0o777, 0o640, "die Rechte der bisherigen Datei bleiben");
    assert.equal(baks(pa).length, 1);
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "lesen" });
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.deepEqual(JSON.parse(readFileSync(ziel, "utf8")), { model: "x" });
    assert.deepEqual(readdirSync(pa).filter((n) => n.includes(".tmp-")), [], "keine Temp-Reste");
  });
});

test("Kaputte settings.json (kein JSON, falsche Form): Stufe gilt in Kortex, Claude Code bleibt Byte für Byte unverändert, die Antwort sagt es; keine Sicherung, kein Temp-Rest", async () => {
  for (const inhalt of ["{ kaputt", "[]", JSON.stringify({ permissions: "nein" }), JSON.stringify({ permissions: { deny: "x" } })]) {
    const { home, profile: [pa], vs: [v1], rufe, s } = aufbau({ konten: [["a", {}]], vaults: 1 });
    await mitHome(home, async () => {
      const a = kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
      writeFileSync(join(pa, "settings.json"), inhalt);
      const r = await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
      assert.equal(r.status, 200);
      assert.equal(r.j.zugriff[a.id][v1], "gesperrt", "die Stufe in Kortex gilt trotzdem");
      assert.equal(r.j.claude.aktion, "fehler", inhalt);
      assert.match(r.j.claude.fehler, /Claude Code/);
      assert.equal(readFileSync(join(pa, "settings.json"), "utf8"), inhalt);
      assert.equal(baks(pa).length, 0);
      assert.deepEqual(readdirSync(pa).filter((n) => n.includes(".tmp")), []);
      assert.equal(K.liesKonten(s).daten.eingetragen, undefined, "kein Vermerk ohne Regel");
    });
  }
});

test("Fehlt die settings.json ganz, legt Kortex sie an (nur permissions.deny); beim Entsperren ist sie wieder leer", async () => {
  const { home, profile: [pa], vs: [v1], rufe } = aufbau({ konten: [["a", {}]], vaults: 1 });
  const fs = await import("node:fs"); fs.rmSync(join(pa, "settings.json"));
  mkdirSync(join(pa, "projects"));
  await mitHome(home, async () => {
    const a = kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
    const r = await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.equal(r.j.claude.aktion, "eingetragen");
    assert.deepEqual(Object.keys(settings(pa)), ["permissions"]);
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "lesen" });
    assert.deepEqual(settings(pa), {});
  });
});

test("Nur Claude Code und nur bekannte Konten; im Testmodus nie außerhalb des Temp-Ordners", async () => {
  const { home, profile: [pa], vs: [v1], rufe, s } = aufbau({ konten: [["a", {}]], vaults: 1 });
  mkdirSync(join(home, ".codex")); writeFileSync(join(home, ".codex", "config.toml"), "model = \"x\"\n");
  await mitHome(home, async () => {
    let r = await rufe("GET", "/api/ki/konten");
    const codex = r.j.konten.find((k) => k.programm === "codex");
    assert.ok(codex, "Codex erkannt");
    assert.equal(codex.schutz.moeglich, false);
    r = await rufe("PUT", "/api/ki/zugriff", { konto: codex.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.equal(r.j.claude.aktion, "nicht-moeglich");
    assert.equal(existsSync(join(home, ".codex", "settings.json")), false);
    assert.equal((await rufe("POST", "/api/ki/schutz", { konto: codex.id, sandbox: true, bestaetigt: true })).status, 409);
    assert.equal((await rufe("POST", "/api/ki/schutz", { konto: "k_00000000", sandbox: true, bestaetigt: true })).status, 409);
    // ein Konto mit Ordner außerhalb des Temp-Ordners (z. B. das echte ~/.claude): Kortex schreibt im Testmodus nie dorthin
    const a = kontoVon(r.j, pa) || kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
    K.aendere(s, (d) => { d.konten[a.id].ordner = "/Users/niemand/.claude"; return d; });
    const r2 = await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    assert.equal(r2.j.claude.aktion, "fehler");
    assert.match(r2.j.claude.fehler, /Testmodus/);
    assert.equal(existsSync("/Users/niemand"), false);
  });
});

// ───────────────────────────── Strenger Schutz ─────────────────────────────
test("Strenger Schutz: nur mit Bestätigung und nur mit einem gesperrten Vault; schreibt Sandbox-Einstellungen mit denyRead, führt sie mit den Sperren nach, der Rückweg stellt die früheren Werte wieder her", async () => {
  const eigen = { sandbox: { enabled: false, allowUnsandboxedCommands: true, filesystem: { denyRead: ["/fremd/pfad"], allowWrite: ["/x"] }, excludedCommands: ["git"] }, model: "x" };
  const { home, profile: [pa], vs: [v1, v2], rufe, s } = aufbau({ konten: [["a", eigen]], vaults: 2 });
  await mitHome(home, async () => {
    const a = kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
    // ohne Bestätigung: 400, nichts geschrieben
    let r = await rufe("POST", "/api/ki/schutz", { konto: a.id, sandbox: true });
    assert.equal(r.status, 400); assert.equal(r.j.art, "bestaetigung");
    // ohne gesperrten Vault: 409
    r = await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "lesen" });
    r = await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v2, stufe: "lesen" });
    r = await rufe("POST", "/api/ki/schutz", { konto: a.id, sandbox: true, bestaetigt: true });
    assert.equal(r.status, 409); assert.equal(r.j.art, "kein-gesperrter-vault");
    assert.deepEqual(settings(pa), eigen);
    // Vault sperren (mit Leseverbot), dann Strenger Schutz
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt", claudeSperre: true });
    r = await rufe("POST", "/api/ki/schutz", { konto: a.id, sandbox: true, bestaetigt: true });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    let sb = settings(pa);
    assert.equal(sb.sandbox.enabled, true); assert.equal(sb.sandbox.allowUnsandboxedCommands, false); assert.equal(sb.sandbox.failIfUnavailable, true);
    const dr = sb.sandbox.filesystem.denyRead, dw = sb.sandbox.filesystem.denyWrite;
    assert.equal(dr[0], "/fremd/pfad", "Fremdes bleibt vorn stehen");
    for (const erwartet of [v1, `${s}/vaults.json`, `${s}/ki-konten.json`, `${pa}/settings.json`]) assert.ok(dr.includes(erwartet), `denyRead: ${erwartet}`);
    for (const erwartet of [v1, s, pa]) assert.ok(dw.includes(erwartet), `denyWrite: ${erwartet}`);
    assert.ok(nurEinst(sb.permissions.deny).length > 0, "der Strenge Schutz bringt die Einstellungsregeln mit");
    assert.deepEqual(sb.sandbox.filesystem.allowWrite, ["/x"]); assert.deepEqual(sb.sandbox.excludedCommands, ["git"]);
    assert.equal(sb.model, "x");
    assert.equal(kontoVon(r.j, pa).schutz.strenger, true); assert.equal(kontoVon(r.j, pa).schutz.strengerAktiv, true);
    // ein weiterer gesperrter Vault wird nachgeführt, ein entsperrter fällt heraus
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v2, stufe: "gesperrt" });
    assert.ok(settings(pa).sandbox.filesystem.denyRead.includes(v1) && settings(pa).sandbox.filesystem.denyRead.includes(v2));
    assert.ok(settings(pa).sandbox.filesystem.denyWrite.includes(v2));
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "lesen" });
    assert.ok(!settings(pa).sandbox.filesystem.denyRead.includes(v1) && settings(pa).sandbox.filesystem.denyRead.includes(v2));
    assert.ok(!settings(pa).sandbox.filesystem.denyWrite.includes(v1));
    assert.deepEqual(ohneEinst(settings(pa).permissions.deny), [], "das Leseverbot für v1 ist mit dem Entsperren heraus (die Einstellungsregeln bleiben, solange der Strenge Schutz an ist)");
    // aus: die früheren Werte kommen zurück, Fremdes bleibt
    r = await rufe("POST", "/api/ki/schutz", { konto: a.id, sandbox: false });
    assert.equal(r.status, 200);
    sb = settings(pa);
    assert.deepEqual(sb, eigen, "genau der Zustand von vorher");
    assert.equal(K.liesKonten(s).daten.schutz, undefined); assert.equal(K.liesKonten(s).daten.eingetragen, undefined);
  });
});

test("Strenger Schutz aus: ein Wert, den der Nutzer inzwischen selbst geändert hat, bleibt; fehlende Schalter werden wieder entfernt", async () => {
  const { home, profile: [pa], vs: [v1], rufe } = aufbau({ konten: [["a", {}]], vaults: 1 });
  await mitHome(home, async () => {
    const a = kontoVon((await rufe("GET", "/api/ki/konten")).j, pa);
    await rufe("PUT", "/api/ki/zugriff", { konto: a.id, vault: v1, stufe: "gesperrt" });
    await rufe("POST", "/api/ki/schutz", { konto: a.id, sandbox: true, bestaetigt: true });
    const doc = settings(pa); doc.sandbox.failIfUnavailable = false; doc.sandbox.network = { allowedDomains: ["example.org"] }; writeFileSync(join(pa, "settings.json"), JSON.stringify(doc));
    await rufe("POST", "/api/ki/schutz", { konto: a.id, sandbox: false });
    assert.deepEqual(settings(pa), { sandbox: { failIfUnavailable: false, network: { allowedDomains: ["example.org"] } } });
  });
});

// ───────────────────────────── Standard, Hinweis, früherer Stand ─────────────────────────────
test("Standard für neue Konten: PUT /api/ki/standard setzt neueKonten je Vault; nur gesperrt, lesen, posteingang; nur Vaults der App", async () => {
  const { home, vs: [v1, v2], rufe, s } = aufbau({ konten: [["a", HOOKS]] });
  await mitHome(home, async () => {
    let r = await rufe("GET", "/api/ki/konten");
    assert.ok(r.j.vaults.every((v) => v.neueKonten === "gesperrt"));
    r = await rufe("PUT", "/api/ki/standard", { vault: v2, stufe: "lesen" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.vaults.find((v) => v.pfad === v2).neueKonten, "lesen"); assert.equal(r.j.vaults.find((v) => v.pfad === v1).neueKonten, "gesperrt");
    // ein neu erkanntes Konto bekommt die Stufe, die der Vault vorgibt
    profil(home, "neu");
    r = await rufe("GET", "/api/ki/konten");
    const neu = kontoVon(r.j, join(home, ".claude-neu"));
    assert.equal(r.j.zugriff[neu.id][v2], "gesperrt", "neu erkannte Konten starten gesperrt (Entscheidung 1); der Standard gilt für bekannte Konten ohne eigenen Eintrag");
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v2, "k_00000000"), "gesperrt");
    for (const schlecht of [{ vault: v1, stufe: "erweitert" }, { vault: v1, stufe: "admin" }, { stufe: "lesen" }]) assert.equal((await rufe("PUT", "/api/ki/standard", schlecht)).status, 400, JSON.stringify(schlecht));
    assert.equal((await rufe("PUT", "/api/ki/standard", { vault: tmp("fremd-"), stufe: "lesen" })).status, 404);
    assert.equal((await rufe("GET", "/api/ki/standard")).status, 405);
  });
});

test("Defekte ki-konten.json: Hinweis bleibt über mehrere Abfragen stehen, bis er quittiert wird; alles gesperrt; die frühere Fassung nur nach Bestätigung zurück", async () => {
  const { home, vs: [v1], rufe, s, profile: [pa] } = aufbau({ konten: [["a", HOOKS]], vaults: 1 });
  await mitHome(home, async () => {
    let r = await rufe("GET", "/api/ki/konten");
    const a = kontoVon(r.j, pa);
    assert.equal(r.j.hinweis, undefined);
    assert.equal(r.j.zugriff[a.id][v1], "posteingang");
    await rufe("POST", "/api/ki/konten", { id: a.id, name: "Zwei" }); // schreibt .vorher
    writeFileSync(K.kontenPfad(s), "{ kaputt");
    r = await rufe("GET", "/api/ki/konten");
    assert.equal(r.j.hinweis, "defekt-neu");
    assert.equal(r.j.vorherDa, true);
    const neu = kontoVon(r.j, pa); // nach dem Neuanfang hat das Konto eine neue Kennung
    assert.notEqual(neu.id, a.id);
    assert.equal(r.j.zugriff[neu.id][v1], "gesperrt");
    r = await rufe("GET", "/api/ki/konten");
    assert.equal(r.j.hinweis, "defekt-neu", "der Hinweis verschwindet nicht von allein");
    assert.equal(r.j.zugriff[neu.id][v1], "gesperrt");
    // früher Stand: ohne Bestätigung 400
    assert.equal((await rufe("POST", "/api/ki/vorher", {})).status, 400);
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v1, neu.id), "gesperrt");
    // quittieren
    r = await rufe("POST", "/api/ki/hinweis", {});
    assert.equal(r.j.hinweis, undefined);
    r = await rufe("GET", "/api/ki/konten");
    assert.equal(r.j.hinweis, undefined);
    // früherer Stand zurück: danach gilt wieder, was vorher galt
    writeFileSync(K.kontenPfad(s), "{ wieder kaputt");
    r = await rufe("GET", "/api/ki/konten"); assert.equal(r.j.hinweis, "defekt-neu");
    r = await rufe("POST", "/api/ki/vorher", { bestaetigt: true });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.hinweis, undefined);
    assert.equal(r.j.zugriff[a.id][v1], "posteingang", "die frühere Fassung (mit den früheren Rechten) ist wieder da");
  });
});

test("Anzeige: verbunden ja/nein je Konto (Hooks oder MCP-Eintrag „brain“), Programmname, kurzer Ordner", async () => {
  const { home, rufe, profile: [pa, pb] } = aufbau({ konten: [["a", HOOKS], ["b", {}]], vaults: 1 });
  await mitHome(home, async () => {
    const r = await rufe("GET", "/api/ki/konten");
    const a = kontoVon(r.j, pa), b = kontoVon(r.j, pb);
    assert.equal(a.verbunden, true); assert.equal(b.verbunden, false);
    assert.equal(a.programmName, "Claude Code");
    assert.ok(a.ordner.startsWith("~/.claude"), a.ordner);
    // MCP-Eintrag in der Claude-Konfiguration des Profils zählt auch
    writeFileSync(join(pb, ".claude.json"), JSON.stringify({ mcpServers: { brain: { command: "x" } } }));
    assert.equal(kontoVon((await rufe("GET", "/api/ki/konten")).j, pb).verbunden, true);
  });
});
