// brain_umbenennen und brain_verschieben (MCP): der ECHTE Server über stdio, Konto mit Stufe „Erweitert“ (sonst fehlen die Werkzeuge), nur in einem bestätigten Vault.
// Die Logik ist dieselbe wie im Studio (gemeinsam/dateiaktionen.mjs); hier zählt: Stufe, Vertrauen, Eintrag im Protokoll mit Konto und Rückgängig, Verweise folgen.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const kinder = [];
after(() => { for (const k of kinder) try { k.kill("SIGKILL"); } catch { /* weg */ } });

function szenario() {
  const home = tmp("akt-home-"), support = tmp("akt-support-");
  const offen = realpathSync(tmp("akt-vault-offen-")), zu = realpathSync(tmp("akt-vault-zu-"));
  for (const v of [offen, zu]) { schreibe(v, "brain.config.json", "{}\n"); schreibe(v, "09_wiki/w/thema.md", "# Thema\n\nDas Zebra frisst Gras.\n"); schreibe(v, "notizen/Alt.md", "# Alt\n"); schreibe(v, "notizen/Link.md", "# Link\n[[Alt]] [[09_wiki/w/thema]]\n"); mkdirSync(join(v, "ziel")); schreibe(v, "ziel/.keep", ""); }
  const profil = (n) => { const p = join(home, `.claude-${n}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil("a");
  const schreibeListe = (aktiv) => writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Offen", pfad: offen, farbe: "#5B8DEF" }, { name: "Zu", pfad: zu, farbe: "#E5734F" }], aktiv }));
  schreibeListe(offen);
  const setze = (stufeOffen, stufeZu = "gesperrt") => K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "Privat", ordnerKennung: K.kennungVon(a) } },
    vaults: { [offen]: { ordnerKennung: K.kennungVon(offen), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufeOffen } },
      [zu]: { ordnerKennung: K.kennungVon(zu), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufeZu } } } }));
  setze("erweitert");
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

test("Umbenennen und Verschieben über MCP: Verweise folgen, Eintrag mit Konto und Rückgängig, Rückgängig stellt Byte für Byte her", async () => {
  const s = szenario();
  const vorher = readFileSync(join(s.offen, "notizen/Link.md"), "utf8");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen]);
  await m.start();
  const u = await m.rufe("brain_umbenennen", { pfad: "notizen/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  assert.equal(u.fehler, false, u.text);
  assert.match(u.text, /Umbenannt: notizen\/Alt\.md → notizen\/Neu\.md \(1 Verweis in 1 Notiz angepasst\)/);
  assert.equal(readFileSync(join(s.offen, "notizen/Link.md"), "utf8"), "# Link\n[[Neu]] [[09_wiki/w/thema]]\n");
  const v = await m.rufe("brain_verschieben", { pfad: "Neu", ziel: "ziel" }); // auch über Titel/Alias auffindbar wie bei brain_lesen
  assert.equal(v.fehler, false, v.text);
  assert.equal(readFileSync(join(s.offen, "notizen/Link.md"), "utf8"), "# Link\n[[Neu]] [[09_wiki/w/thema]]\n", "der Titel trifft weiter");
  assert.ok(existsSync(join(s.offen, "ziel/Neu.md")));
  await m.ende();
  const e = s.lies(s.offen, { arten: ["aenderung"] });
  assert.equal(e.length, 2);
  assert.equal(e[0].konto, "k_aaaaaaaa"); assert.equal(e[0].wer, "Claude Code · Privat"); assert.equal(e[0].rueckgaengig.art, "vorgang");
  assert.deepEqual(e[0].pfade, ["notizen/Neu.md", "notizen/Alt.md"]);
  // Studio-Seite: dasselbe Journal, Rückgängig über die Funktion der Werkstatt
  const vault = oeffneVault(s.offen, { support: s.support });
  await vault.vorgangZurueck({ id: e[1].rueckgaengig.id });
  await vault.vorgangZurueck({ id: e[0].rueckgaengig.id });
  assert.equal(readFileSync(join(s.offen, "notizen/Link.md"), "utf8"), vorher);
  assert.ok(existsSync(join(s.offen, "notizen/Alt.md")) && !existsSync(join(s.offen, "ziel/Neu.md")));
});

test("Stufe: mit „Posteingang“ fehlen die Werkzeuge in der Liste und ein Aufruf wird abgewiesen (Eintrag „stufe“); nichts ändert sich", async () => {
  const s = szenario();
  s.setze("posteingang");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen]);
  await m.start();
  const liste = (await (async () => { const r = await m.rufe("brain_umbenennen", { pfad: "notizen/Alt.md", titel: "Neu" }); return r; })());
  assert.equal(liste.fehler, true);
  assert.ok(existsSync(join(s.offen, "notizen/Alt.md")));
  await m.ende();
  const e = s.lies(s.offen);
  assert.equal(e.length, 1); assert.equal(e[0].art, "abweisung"); assert.equal(e[0].grund, "stufe"); assert.equal(e[0].mindest, "erweitert");
});

test("Unbestätigter Vault: kein Umbenennen, kein Verschieben; ungültige Eingaben und Pfade außerhalb werden abgewiesen", async () => {
  const s = szenario();
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen], { KORTEX_VAULT_VERTRAUT: undefined });
  await m.start();
  const a = await m.rufe("brain_umbenennen", { pfad: "notizen/Alt.md", titel: "Neu" });
  assert.equal(a.fehler, true); assert.match(a.text, /nicht als deiner bestätigt/);
  assert.ok(existsSync(join(s.offen, "notizen/Alt.md")));
  await m.ende();
  const m2 = starteMcp(s, ["--konto", "k_aaaaaaaa", s.offen]);
  await m2.start();
  for (const [name, args] of [["brain_umbenennen", { pfad: "notizen/Alt.md" }], ["brain_umbenennen", { pfad: "../x.md", titel: "x" }], ["brain_verschieben", { pfad: "notizen/Alt.md", ziel: "../" }], ["brain_verschieben", { pfad: "notizen/Alt.md", ziel: "gibt-es-nicht" }], ["brain_verschieben", { pfad: "/etc/hosts", ziel: "ziel" }]]) {
    const r = await m2.rufe(name, args);
    assert.equal(r.fehler, true, `${name} ${JSON.stringify(args)}: ${r.text}`);
  }
  assert.ok(existsSync(join(s.offen, "notizen/Alt.md")));
  await m2.ende();
});
