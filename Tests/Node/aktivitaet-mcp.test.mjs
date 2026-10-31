// Aktivitätsprotokoll (P8a) und der MCP-Server: der ECHTE Server über stdio (mit --konto) schreibt Ablagen, Änderungen und Abweisungen ins Protokoll des Vaults.
// Abweisungen: Konto gesperrt (gebundener und in der App aktiver Vault), Stufe zu niedrig; nie Inhalt, nie ein Titel. Wegwerf-Ordner, Kindprozess-Umgebung ausdrücklich gebaut.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const kinder = [];
after(() => { for (const k of kinder) try { k.kill("SIGKILL"); } catch { /* weg */ } });

const GEHEIM = "Nordlicht-Geheimtitel"; // Titel und Text der KI: dürfen nie im Protokoll stehen
function szenario() {
  const home = tmp("akt-home-"), support = tmp("akt-support-");
  const offen = realpathSync(tmp("akt-vault-offen-")), zu = realpathSync(tmp("akt-vault-zu-"));
  for (const v of [offen, zu]) { schreibe(v, "brain.config.json", "{}\n"); schreibe(v, "09_wiki/w/thema.md", "# Thema\n\nDas Zebra frisst Gras.\n"); }
  const profil = (n) => { const p = join(home, `.claude-${n}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil("a");
  const schreibeListe = (aktiv) => writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Offen", pfad: offen, farbe: "#5B8DEF" }, { name: "Zu", pfad: zu, farbe: "#E5734F" }], aktiv }));
  schreibeListe(offen);
  const setze = (stufeOffen, stufeZu = "gesperrt") => K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "Privat", ordnerKennung: K.kennungVon(a) } },
    vaults: { [offen]: { ordnerKennung: K.kennungVon(offen), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufeOffen } },
      [zu]: { ordnerKennung: K.kennungVon(zu), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufeZu } } } }));
  setze("posteingang");
  const lies = (v, opt = {}) => A.leseEreignisse(support, A.kennungVault(v), opt);
  return { home, support, offen, zu, a, schreibeListe, setze, lies };
}

function starteMcp(s, args = [], envExtra = {}) {
  const env = baueTestUmgebung({ HOME: s.home, BRAIN_APP_SUPPORT: s.support, KORTEX_VAULT_VERTRAUT: "alle", ...envExtra });
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), ...args], { stdio: ["pipe", "pipe", "pipe"], env, cwd: s.home });
  kinder.push(p);
  const wartende = [], antworten = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  const naechste = () => new Promise((ok) => { const x = antworten.shift(); if (x) ok(x); else wartende.push(ok); });
  let n = 0;
  const frage = async (method, params) => { const id = ++n; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const x = await naechste(); assert.equal(x.id, id); return x; };
  const start = () => frage("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } });
  const rufe = async (name, a = {}) => { const r = (await frage("tools/call", { name, arguments: a })).result; return { text: r.content.map((c) => c.text).join("\n"), fehler: r.isError === true }; };
  const ende = () => new Promise((ok) => { p.on("close", ok); p.stdin.end(); });
  return { start, rufe, ende };
}
const sha = (v, rel) => createHash("sha256").update(readFileSync(join(v, rel))).digest("hex");

test("Ablagen: eine Notiz und eine Aufgabe der KI stehen mit Konto, Programm, Pfad und Rückgängig-Hash im Protokoll — ohne Titel und Text", async () => {
  const s = szenario();
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen]);
  await m.start();
  const n = await m.rufe("brain_merken", { text: `${GEHEIM} steht hier im Text.`, titel: GEHEIM });
  assert.equal(n.fehler, false, n.text);
  const notiz = /Gemerkt in (\S+)\./.exec(n.text)[1];
  const t = await m.rufe("brain_aufgabe_anlegen", { titel: GEHEIM, text: GEHEIM });
  assert.equal(t.fehler, false, t.text);
  const aufgabe = /Aufgabe angelegt: (\S+)$/.exec(t.text)[1];
  const st = await m.rufe("brain_aufgabe_status", { pfad: aufgabe, status: "erledigt" });
  assert.equal(st.fehler, false, st.text);
  await m.ende();
  const e = s.lies(s.offen);
  assert.deepEqual(e.map((x) => x.art), ["ablage-notiz", "ablage-aufgabe", "aenderung"]);
  const [en, ea, ec] = e;
  assert.equal(en.konto, "k_aaaaaaaa"); assert.equal(en.programm, "claude"); assert.equal(en.wer, "Claude Code · Privat"); assert.equal(en.quelle, "ki:claude-code");
  assert.deepEqual(en.pfade, [notiz]); assert.deepEqual(en.rueckgaengig, { art: "ablage-entfernen", pfad: notiz, hash: sha(s.offen, notiz) });
  assert.deepEqual(ea.pfade, [aufgabe]); assert.equal(ea.rueckgaengig.hash.length, 64);
  assert.equal(ec.rueckgaengig, undefined, "eine Statusänderung ist keine Ablage und lässt sich nicht so zurücknehmen"); assert.deepEqual(ec.pfade, [aufgabe]);
  assert.equal(ea.vaultName, s.offen.split("/").pop());
  const roh = readFileSync(A.ereignisDatei(s.support, A.kennungVault(s.offen)), "utf8");
  assert.ok(!roh.includes("Geheimtitel") || /[0-9]-nordlicht-geheimtitel/.test(roh), "kein Titel und kein Text im Protokoll (höchstens der Dateiname, der daraus entstand)");
  assert.ok(!roh.includes("steht hier im Text") && !roh.includes('"text":"Nordlicht'), roh);
  assert.deepEqual(s.lies(s.zu), [], "der andere Vault hat kein Ereignis");
});

test("Abweisung „gesperrt“: das Konto darf den gebundenen Vault nicht sehen → ein Ereignis (Stufe „Gesperrt“ hat gewirkt), kein Inhalt; die Wiederholung wird gedrosselt", async () => {
  const s = szenario();
  s.setze("gesperrt");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen]);
  await m.start();
  for (const [name, a] of [["brain_suchen", { frage: "Zebra" }], ["brain_lesen", { pfad: "09_wiki/w/thema.md" }], ["brain_suchen", { frage: "Zebra" }]]) {
    const r = await m.rufe(name, a);
    assert.equal(r.fehler, true); assert.ok(!r.text.includes("Zebra frisst"));
  }
  await m.ende();
  const e = s.lies(s.offen);
  assert.equal(e.length, 2, "suchen und lesen sind zwei verschiedene Werkzeuge, die zweite Suche ist gedrosselt");
  for (const x of e) {
    assert.equal(x.art, "abweisung"); assert.equal(x.grund, "gesperrt"); assert.equal(x.konto, "k_aaaaaaaa"); assert.equal(x.wer, "Claude Code · Privat");
    assert.match(x.text, /wollte den Vault „.+“ lesen und wurde abgewiesen\. Stufe „Gesperrt“ hat gewirkt\./);
  }
  assert.deepEqual(e.map((x) => x.werkzeug).sort(), ["brain_lesen", "brain_suchen"]);
  assert.ok(!readFileSync(A.ereignisDatei(s.support, A.kennungVault(s.offen)), "utf8").includes("Zebra"));
});

test("Abweisung „stufe“: nur lesen und ein Werkzeug mit Stufe „Posteingang“ → Ereignis mit der nötigen Stufe; in der Werkzeugliste fehlt es ohnehin", async () => {
  const s = szenario();
  s.setze("lesen");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen]);
  await m.start();
  const r = await m.rufe("brain_merken", { text: "Neues" });
  assert.equal(r.fehler, true); assert.match(r.text, /nur lesen/);
  await m.ende();
  const [x, ...rest] = s.lies(s.offen);
  assert.equal(rest.length, 0);
  assert.equal(x.art, "abweisung"); assert.equal(x.grund, "stufe"); assert.equal(x.mindest, "posteingang"); assert.equal(x.werkzeug, "brain_merken");
  assert.match(x.text, /eine Notiz ablegen und wurde abgewiesen\. Dafür braucht ihr Konto die Stufe „Posteingang“\./);
});

test("Abweisung beim Server ohne Vault-Argument: der in der App aktive Vault ist für das Konto gesperrt → Ereignis in DEREN Protokoll (nicht im anderen)", async () => {
  const s = szenario();
  s.setze("posteingang", "gesperrt");
  s.schreibeListe(s.zu);
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  await m.start();
  const r = await m.rufe("brain_suchen", { frage: "Zebra" });
  assert.equal(r.fehler, true); assert.match(r.text, /kein Vault freigegeben/);
  await m.ende();
  const e = s.lies(s.zu);
  assert.equal(e.length, 1); assert.equal(e[0].art, "abweisung"); assert.equal(e[0].grund, "gesperrt");
  assert.deepEqual(s.lies(s.offen), []);
});

test("Unbekanntes Konto (--konto mit falscher Kennung): Abweisung ohne Konto, mit dem Namen des MCP-Clients", async () => {
  const s = szenario();
  const m = starteMcp(s, ["--konto", "k_99999999", s.offen]);
  await m.start();
  const r = await m.rufe("brain_suchen", { frage: "Zebra" });
  assert.equal(r.fehler, true);
  await m.ende();
  const [x] = s.lies(s.offen);
  assert.equal(x.art, "abweisung"); assert.equal(x.konto, null); assert.equal(x.wer, "Claude Code"); assert.equal(x.quelle, "ki:claude-code");
});

test("Läuft der Server unter Claude Code (CLAUDE_CONFIG_DIR gesetzt) UND mit --konto, ist es dasselbe Konto: die Abweisung nennt es", async () => {
  const s = szenario();
  s.setze("gesperrt");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen], { CLAUDE_CONFIG_DIR: s.a });
  await m.start();
  await m.rufe("brain_suchen", { frage: "Zebra" });
  await m.ende();
  const [x] = s.lies(s.offen);
  assert.equal(x.konto, "k_aaaaaaaa"); assert.equal(x.wer, "Claude Code · Privat");
});

test("BRAIN_NUTZUNG=aus (Probe-Frage und Selbsttest der App) schreibt nichts ins Protokoll", async () => {
  const s = szenario();
  s.setze("gesperrt");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen], { BRAIN_NUTZUNG: "aus" });
  await m.start();
  await m.rufe("brain_suchen", { frage: "Zebra" });
  await m.ende();
  assert.deepEqual(s.lies(s.offen), []);
});
