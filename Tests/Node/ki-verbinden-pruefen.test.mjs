// KI verbinden, Schritt „Prüfen“ (POST /api/mcp/pruefen): ein echter, rein lesender Aufruf (brain_vaults) über den ECHTEN Kortex-MCP-Server (stdio), als das gewählte Konto.
// Kein Modellaufruf. Ein Konto ohne Zugriff bekommt eine klare Fehlerantwort mit dem nächsten Schritt; das Aktivitätsprotokoll bleibt leer (Prüfung ist keine KI-Nutzung).
// Nur Wegwerf-Ordner (HOME, Support, Vaults); nie ein echtes Konto, nie das echte claude.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const HOME = tmp("pruefen-home-");
process.env.HOME = HOME;
for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"]) delete process.env[k];

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};

function szenario() {
  const support = tmp("pruefen-support-");
  const offen = realpathSync(tmp("pruefen-offen-")), anderer = realpathSync(tmp("pruefen-anderer-"));
  for (const v of [offen, anderer]) { schreibe(v, "brain.config.json", "{}\n"); schreibe(v, "09_wiki/w/thema.md", "# Thema\n\nDas Zebra frisst Gras.\n"); }
  const profil = (n) => { const p = join(HOME, `.claude-${n}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil("a"), b = profil("b");
  const liste = (aktiv) => writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Offen", pfad: offen, farbe: "#5B8DEF" }, { name: "Anderer", pfad: anderer, farbe: "#E5734F" }], aktiv }));
  liste(offen);
  K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "Privat", ordnerKennung: K.kennungVon(a) },
      k_bbbbbbbb: { programm: "claude", ordner: b, standard: false, name: "Firma", ordnerKennung: K.kennungVon(b) } },
    vaults: { [offen]: { ordnerKennung: K.kennungVon(offen), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen", k_bbbbbbbb: "gesperrt" } },
      [anderer]: { ordnerKennung: K.kennungVon(anderer), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "gesperrt", k_bbbbbbbb: "gesperrt" } } } }));
  const rufe = aufruf(erzeugeHandler({ vault: offen, vaultOptionen: { support }, kontenHome: HOME }));
  return { support, offen, anderer, liste, rufe };
}

test("Prüfen als berechtigtes Konto: ein Aufruf brain_vaults, Antwort nennt Vault und Werkzeuge", async () => {
  const s = szenario();
  const r = await s.rufe("POST", "/api/mcp/pruefen", { konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.equal(r.j.vault, "Offen");
  assert.equal(r.j.konto, "k_aaaaaaaa");
  assert.ok(r.j.werkzeuge >= 1);
  assert.deepEqual(Object.keys(r.j).sort(), ["konto", "ok", "vault", "werkzeuge"], "keine Inhalte, keine Pfade");
});

test("Prüfen als gesperrtes Konto: 409 kein-zugriff mit nächstem Schritt, kein Wort über andere Vaults", async () => {
  const s = szenario();
  const r = await s.rufe("POST", "/api/mcp/pruefen", { konto: "k_bbbbbbbb" });
  assert.equal(r.status, 409);
  assert.equal(r.j.art, "kein-zugriff");
  assert.match(r.j.fehler, /KI & Konten/);
  assert.ok(!r.j.fehler.includes("Anderer"));
});

test("Prüfen ohne Konto wählt wie die Probe ein Konto, das lesen darf; unbekanntes Konto → 404", async () => {
  const s = szenario();
  const r = await s.rufe("POST", "/api/mcp/pruefen", {});
  assert.equal(r.status, 200); assert.equal(r.j.konto, "k_aaaaaaaa");
  assert.equal((await s.rufe("POST", "/api/mcp/pruefen", { konto: "k_gibtsnicht" })).status, 404);
});

test("Prüfen: nicht aktiver Vault → 409; nur POST", async () => {
  const s = szenario();
  s.liste(s.anderer);
  const r = await s.rufe("POST", "/api/mcp/pruefen", { konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-aktiv");
  assert.equal((await s.rufe("GET", "/api/mcp/pruefen")).status, 405);
});

test("Prüfen ist keine KI-Nutzung: das Aktivitätsprotokoll bleibt leer", async () => {
  const s = szenario();
  await s.rufe("POST", "/api/mcp/pruefen", { konto: "k_aaaaaaaa" });
  await s.rufe("POST", "/api/mcp/pruefen", { konto: "k_bbbbbbbb" });
  assert.equal(A.leseEreignisse(s.support, A.kennungVault(s.offen), {}).length, 0);
});

test("Prüfen: Server ohne brain_vaults → 502, Server fehlt → 404", async () => {
  const s = szenario();
  const skripte = tmp("pruefen-fake-");
  schreibe(skripte, "ohne.mjs", `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (z) => { const m = JSON.parse(z);
  if (m.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "x", version: "1" } } }));
  if (m.method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "anderes" }] } }));
  if (m.method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "x" }] } })); });\n`);
  const ohne = aufruf(erzeugeHandler({ vault: s.offen, mcpPfad: join(skripte, "ohne.mjs"), vaultOptionen: { support: s.support }, kontenHome: HOME }));
  const f = await ohne("POST", "/api/mcp/pruefen", { konto: "k_aaaaaaaa" });
  assert.equal(f.status, 502); assert.match(f.j.fehler, /brain_vaults/);
  const weg = aufruf(erzeugeHandler({ vault: s.offen, mcpPfad: join(skripte, "gibtsnicht.mjs"), vaultOptionen: { support: s.support }, kontenHome: HOME }));
  assert.equal((await weg("POST", "/api/mcp/pruefen", {})).status, 404);
});
