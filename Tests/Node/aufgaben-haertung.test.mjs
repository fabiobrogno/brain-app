// Aufgaben — Härtung nach dem Review von PR #50 (Werkstatt und MCP): Quelle, Mengen, Index-Bereich, Ordnername, Sitzungen. Kern-Seite: Tests/Kern/test-aufgaben-haertung.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { bearbeite } = await import(pfad("mcp", "brain-mcp.mjs"));
const { MAX_ANLAGEN_SITZUNG, MAX_OFFENE_KI } = await import(pfad("mcp", "aufgaben-werkzeuge.mjs"));

const vaultOrdner = (cfg = {}) => { const d = tmp("brain-aufg-h-"); schreibe(d, "brain.config.json", JSON.stringify(cfg)); return d; };
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const feld = (d, rel, k) => new RegExp(`^${k}: (.*)$`, "m").exec(readFileSync(join(d, rel), "utf8"))?.[1];
let nr = 0;
const mcp = async (v, name, args, sitzung) => (await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name, arguments: args } }, undefined, sitzung)).result;
const text = (r) => r.content.map((c) => c.text).join("\n");
const kopf = (t, q = "mensch", status = "offen") => `---\ntyp: aufgabe\ntitel: ${t}\nstatus: ${status}\nrang: 1\nquelle: ${q}\n---\n`;

test("4 Quelle: die Route POST /api/aufgaben setzt immer „mensch“ — eine Quelle in der Anfrage zählt nicht", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  for (const quelle of ["ki:claude-code", "ki:gemini", "mensch", "bot", 5, null]) {
    const r = await rufe("POST", "/api/aufgaben", { titel: `T ${quelle}`, quelle });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.aufgabe.quelle, "mensch"); assert.equal(feld(d, r.j.pfad, "quelle"), "mensch");
  }
});

test("4 Quelle: MCP schreibt ki:<client>, die KI kann sie nicht überschreiben", async () => {
  const d = vaultOrdner(); const v = oeffneVault(d, { jetzt: () => new Date("2026-10-30T10:00:00Z") });
  const s = { klient: "Cursor", angelegt: 0 };
  const r = await mcp(v, "brain_aufgabe_anlegen", { titel: "Per MCP", quelle: "mensch" }, s);
  assert.ok(!r.isError, text(r));
  assert.equal(feld(d, text(r).replace("Aufgabe angelegt: ", ""), "quelle"), "ki:cursor");
});

test("3 MCP-Mengen: höchstens 30 Anlagen je Verbindung, jede Verbindung zählt für sich; ab 1000 offenen KI-Aufgaben Abweisung mit klarer Meldung", async () => {
  const d = vaultOrdner(); const v = oeffneVault(d, { jetzt: () => new Date("2026-10-30T10:00:00Z") });
  const a = { klient: "claude-code", angelegt: 0 }, b = { klient: "codex", angelegt: 0 };
  for (let i = 0; i < MAX_ANLAGEN_SITZUNG; i++) assert.ok(!(await mcp(v, "brain_aufgabe_anlegen", { titel: `A ${i}` }, a)).isError, `Anlage ${i}`);
  const zuViel = await mcp(v, "brain_aufgabe_anlegen", { titel: "Eine zu viel" }, a);
  assert.equal(zuViel.isError, true); assert.match(text(zuViel), new RegExp(`schon ${MAX_ANLAGEN_SITZUNG} Aufgaben angelegt`));
  assert.ok(!(await mcp(v, "brain_aufgabe_anlegen", { titel: "Andere Verbindung" }, b)).isError, "eine andere Verbindung hat ihr eigenes Konto");
  assert.equal(readdirSync(join(d, "05_aufgaben")).length, MAX_ANLAGEN_SITZUNG + 1);
  // Gesamtgrenze: viele offene KI-Aufgaben (von Hand angelegt), erledigte und menschliche zählen nicht
  const w = vaultOrdner(); const vw = oeffneVault(w); mkdirSync(join(w, "05_aufgaben"));
  for (let i = 0; i < MAX_OFFENE_KI - 1; i++) writeFileSync(join(w, "05_aufgaben", `2026-10-01-ki-${i}.md`), kopf(`K${i}`, "ki:claude-code"));
  for (let i = 0; i < 50; i++) writeFileSync(join(w, "05_aufgaben", `2026-10-01-m-${i}.md`), kopf(`M${i}`));
  for (let i = 0; i < 50; i++) writeFileSync(join(w, "05_aufgaben", `2026-10-01-e-${i}.md`), kopf(`E${i}`, "ki:codex", "erledigt"));
  const s = { klient: "codex", angelegt: 0 };
  assert.ok(!(await mcp(vw, "brain_aufgabe_anlegen", { titel: "Die 1000." }, s)).isError);
  const voll = await mcp(vw, "brain_aufgabe_anlegen", { titel: "Die 1001." }, s);
  assert.equal(voll.isError, true); assert.match(text(voll), /1000 offene Aufgaben von KI-Programmen/);
  assert.equal((await aufruf(erzeugeHandler({ vault: w }))("POST", "/api/aufgaben", { titel: "Der Mensch darf" })).status, 200, "die Grenze gilt nur für die KI");
});

test("3 Liste: GET /api/aufgaben meldet abgeschnitten; die KI-Liste kennzeichnet es", async () => {
  const d = vaultOrdner(); const v = oeffneVault(d); mkdirSync(join(d, "05_aufgaben"));
  for (let i = 0; i < 5003; i++) writeFileSync(join(d, "05_aufgaben", `2026-10-01-x${String(i).padStart(5, "0")}.md`), kopf(`T${i}`));
  const r = await aufruf(erzeugeHandler({ vault: d }))("GET", "/api/aufgaben");
  assert.equal(r.j.abgeschnitten, true); assert.equal(r.j.aufgaben.length, 5000);
  const k = await mcp(v, "brain_aufgaben", {}, { klient: "x", angelegt: 0 });
  assert.match(text(k), /nur die neuesten/); assert.ok(text(k).split("\n").length < 50, "Antwort bleibt klein");
  const neu = await aufruf(erzeugeHandler({ vault: d }))("POST", "/api/aufgaben", { titel: "Zu viele" });
  assert.equal(neu.status, 409); assert.match(neu.j.fehler, /mehr als 5000/);
});

test("6 Index: Bereich „aufgabe“ nur für direkte Kinder des konfigurierten Ordners mit typ aufgabe (Groß/Klein egal); /api/notizen nennt den Ordner", async () => {
  const d = vaultOrdner({ ordner: { aufgaben: "todo" } });
  schreibe(d, "todo/2026-10-30-a.md", kopf("A").replace("typ: aufgabe", "typ: Aufgabe"));
  schreibe(d, "todo/unter/2026-10-30-b.md", kopf("B"));          // tiefer: keine Aufgabe des Boards
  schreibe(d, "todo/_vorlage.md", kopf("Vorlage"));              // _-Datei: nie
  schreibe(d, "todo/notiz.md", "---\ntyp: thema\n---\n# Notiz\n");
  schreibe(d, "05_aufgaben/2026-10-30-c.md", kopf("C"));         // der Standardordner gilt hier nicht mehr
  const r = await aufruf(erzeugeHandler({ vault: d }))("GET", "/api/notizen");
  assert.equal(r.j.aufgabenOrdner, "todo");
  const bereich = Object.fromEntries(r.j.notizen.map((n) => [n.pfad, n.bereich]));
  assert.equal(bereich["todo/2026-10-30-a.md"], "aufgabe");
  assert.notEqual(bereich["todo/unter/2026-10-30-b.md"], "aufgabe");
  assert.notEqual(bereich["todo/_vorlage.md"], "aufgabe");
  assert.notEqual(bereich["todo/notiz.md"], "aufgabe");
  assert.notEqual(bereich["05_aufgaben/2026-10-30-c.md"], "aufgabe");
  // Seitenleisten-Zähler und Board-Zahl kommen aus derselben Regel: Index zählt genau die Aufgaben, die das Board listet
  const board = (await aufruf(erzeugeHandler({ vault: d }))("GET", "/api/aufgaben")).j.aufgaben.map((a) => a.pfad);
  assert.deepEqual(board, ["todo/2026-10-30-a.md"]);
  assert.deepEqual(r.j.notizen.filter((n) => n.bereich === "aufgabe").map((n) => n.pfad), board);
});

test("2/7 Route: Ordnername der Konfiguration in anderer Groß-/Kleinschreibung als auf der Platte — Anlegen, Ändern und Liste gehen", async () => {
  const d = vaultOrdner({ ordner: { aufgaben: "Todo" } }); mkdirSync(join(d, "todo"));
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const p = await rufe("POST", "/api/aufgaben", { titel: "Groß Klein" });
  assert.equal(p.status, 200, JSON.stringify(p.j)); assert.match(p.j.pfad, /^todo\//);
  const c = await rufe("PATCH", `/api/aufgaben/${p.j.pfad}`, { status: "erledigt" });
  assert.equal(c.status, 200, JSON.stringify(c.j)); assert.equal(feld(d, p.j.pfad, "status"), "erledigt");
  assert.equal((await rufe("GET", "/api/aufgaben")).j.aufgaben.length, 1);
});
