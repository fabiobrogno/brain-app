// KI-Konten: solange ein Konto „neu, noch nicht eingetragen“ ist (die Liste kennt es nicht, GET /api/ki/konten meldet es unter `neu`), gilt für Aufrufe, die ihm zuzuordnen sind, die
// strenge Regel: höchstens „gesperrt“, bis der Nutzer es ausdrücklich einträgt. Geprüft mit dem ECHTEN MCP-Server über stdio und echten `--konto`-Aufrufen (Kindprozess mit
// ausdrücklich gebauter Umgebung, nichts vom Rechner), dazu die Hook-Seite (kontoStufe mit vollständiger Umgebung) für das Standardprofil. Nur Wegwerf-Orte im Temp-Ordner.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const KERN = await import(pfad("kern", "ki-konten.mjs"));
const { erzeugeKonten } = await import(pfad("werkstatt", "konten.mjs"));
const { erkenneKonten } = await import(pfad("werkstatt", "konten-erkennung.mjs"));
const kinder = [];
after(() => { for (const k of kinder) try { k.kill("SIGKILL"); } catch { /* weg */ } });

// Bekanntes Konto A (posteingang im offenen Vault); Profil C liegt auf der Platte, steht aber nicht in der Liste: neu.
function szenario({ standardProfil = false } = {}) {
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const vault = realpathSync(tmp("vault-"));
  schreibe(vault, "brain.config.json", "{}\n");
  schreibe(vault, "09_wiki/w/thema.md", "# Thema\n\nDas Zebra frisst Gras.\n");
  schreibe(vault, "00_inbox/n.md", "# N\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Offen", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  const profil = (n) => { const p = join(home, n); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil(".claude-a");
  K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "A", ordnerKennung: K.kennungVon(a) } },
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "posteingang", konten: { k_aaaaaaaa: "posteingang" } } } }));
  const c = profil(".claude-c"); // neu: nicht in der Liste
  const std = standardProfil ? profil(".claude") : null; // das Standardprofil, ebenfalls nicht in der Liste
  return { home, support, vault, a, c, std };
}
const neuGemeldet = (s) => erzeugeKonten({ support: s.support, home: () => s.home, vaults: () => [{ pfad: s.vault, name: "Offen" }], erkennung: () => erkenneKonten({ home: s.home, programme: [] }), quelleVon: () => "bestaetigt" })
  .stand({ lesend: true }).neu.map((k) => k.ordner.replace(/^.*\//, ""));

function starteMcp(s, args = [], envExtra = {}) {
  const env = baueTestUmgebung({ HOME: s.home, BRAIN_APP_SUPPORT: s.support, KORTEX_VAULT_VERTRAUT: "alle", ...envExtra });
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), ...args], { stdio: ["pipe", "pipe", "pipe"], env, cwd: s.home });
  kinder.push(p);
  const wartende = [], antworten = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  const naechste = () => new Promise((ok) => { const a = antworten.shift(); if (a) ok(a); else wartende.push(ok); });
  let n = 0;
  const frage = async (method, params) => { const id = ++n; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const a = await naechste(); assert.equal(a.id, id); return a; };
  const rufe = async (name, a = {}) => { const r = (await frage("tools/call", { name, arguments: a })).result; return { text: r.content.map((x) => x.text).join("\n"), fehler: r.isError === true }; };
  const werkzeuge = async () => (await frage("tools/list")).result.tools.map((t) => t.name);
  const ende = () => new Promise((ok) => { p.on("close", ok); p.stdin.end(); });
  return { rufe, werkzeuge, ende };
}
const KEIN_ZUGRIFF = /kein Vault freigegeben/;
const gesperrt = async (m, was) => {
  const r = await m.rufe("brain_suchen", { frage: "zebra" });
  assert.equal(r.fehler, true, `${was}: ${r.text}`); assert.match(r.text, KEIN_ZUGRIFF, was);
  assert.ok(!(await m.werkzeuge()).includes("brain_merken"), `${was}: kein brain_merken`);
  const v = await m.rufe("brain_vaults"); assert.ok(!v.text.includes("Offen"), `${was}: der Vault taucht nicht auf`);
};

test("Neues, nicht eingetragenes Konto: `--konto` mit einer Kennung, die die Liste nicht kennt, bekommt nichts — das bekannte Konto A schon (Gegenprobe)", async () => {
  const s = szenario();
  assert.deepEqual(neuGemeldet(s), [".claude-c"], "Voraussetzung: C ist neu, noch nicht eingetragen");
  const fremd = starteMcp(s, ["--konto", "k_cccccccc"]);
  await gesperrt(fremd, "--konto k_cccccccc (unbekannt)");
  await fremd.ende();
  const a = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  assert.equal((await a.rufe("brain_suchen", { frage: "zebra" })).fehler, false, "A ist eingetragen und darf");
  assert.equal((await a.rufe("brain_merken", { text: "x", titel: "gegenprobe" })).fehler, false);
  await a.ende();
});

test("Neues Konto über seine Umgebung: CLAUDE_CONFIG_DIR zeigt auf das nicht eingetragene Profil — mit oder ohne `--konto` des bekannten Kontos gilt das strengere (gesperrt)", async () => {
  const s = szenario();
  const ohne = starteMcp(s, [], { CLAUDE_CONFIG_DIR: s.c });
  await gesperrt(ohne, "Altform ohne --konto im neuen Profil");
  await ohne.ende();
  const widerspruch = starteMcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: s.c });
  await gesperrt(widerspruch, "--konto A, aber Umgebung = neues Profil C");
  await widerspruch.ende();
  const richtig = starteMcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: s.a });
  assert.equal((await richtig.rufe("brain_suchen", { frage: "zebra" })).fehler, false, "Argument und Umgebung nennen dasselbe, eingetragene Konto");
  await richtig.ende();
});

test("Das Standardprofil ist neu (nicht eingetragen): unter Claude Code ohne CLAUDE_CONFIG_DIR läuft genau dieses Profil — der Server und die Hooks lassen es nicht mit dem Recht der bekannten Konten durch", async () => {
  const s = szenario({ standardProfil: true });
  assert.deepEqual(neuGemeldet(s).sort(), [".claude", ".claude-c"]);
  // MCP-Server unter Claude Code (CLAUDECODE=1: die Umgebung ist unverändert vererbt, eine fehlende Variable heißt Standardprofil)
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDECODE: "1" });
  await gesperrt(m, "CLAUDECODE=1, Standardprofil unbekannt");
  await m.ende();
  // derselbe Server ohne Claude Code (eine fehlende Variable ist „keine Angabe“): wie bisher
  const o = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  assert.equal((await o.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  await o.ende();
  // Hook-Seite (Kern und gemeinsame Hälfte gleich): vollständige Umgebung, nichts gesetzt
  for (const H of [K, KERN]) {
    assert.equal(H.kontoStufe(s.vault, { support: s.support, env: { HOME: s.home }, programm: "claude", vollstaendig: true }), "gesperrt");
    assert.equal(H.kontoStufe(s.vault, { support: s.support, arg: "k_aaaaaaaa", env: { HOME: s.home }, programm: "claude", vollstaendig: true }), "gesperrt");
    assert.equal(H.kontoStufe(s.vault, { support: s.support, arg: "k_aaaaaaaa", env: { HOME: s.home, CLAUDE_CONFIG_DIR: s.a }, programm: "claude", vollstaendig: true }), "posteingang", "ausdrücklich im eingetragenen Profil: erlaubt");
  }
});

test("Ausdrücklich eingetragen (Abgleich): das Standardprofil und C sind dann bekannt und gesperrt, bis der Nutzer etwas freigibt — nie lockerer als „gesperrt“ von selbst", () => {
  const s = szenario({ standardProfil: true });
  const k = erzeugeKonten({ support: s.support, home: () => s.home, vaults: () => [{ pfad: s.vault, name: "Offen" }], erkennung: () => erkenneKonten({ home: s.home, programme: [] }), quelleVon: () => "bestaetigt" });
  k.abgleich();
  const d = K.liesKonten(s.support).daten;
  for (const ordner of [s.c, s.std]) {
    const id = Object.keys(d.konten).find((x) => d.konten[x].ordner === ordner);
    assert.ok(id, ordner);
    assert.equal(K.stufeFuer(d, s.vault, id), "gesperrt");
    assert.equal(K.kontoStufe(s.vault, { support: s.support, env: { CLAUDE_CONFIG_DIR: ordner }, programm: "claude", vollstaendig: true }), "gesperrt");
  }
  // das Standardprofil ist jetzt eingetragen (gesperrt): ein Hook ohne Variable bekommt dessen Recht — nicht mehr „unbekannt“
  assert.equal(K.kontoStufe(s.vault, { support: s.support, env: { HOME: s.home }, programm: "claude", vollstaendig: true }), "gesperrt");
});
