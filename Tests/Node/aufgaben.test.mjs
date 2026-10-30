// Aufgaben (Studio-Routen, Pfadschutz, Vertrauen, MCP-Werkzeuge, Rang-Logik über die Werkstatt). Das Format selbst prüft Tests/Kern/test-aufgaben.mjs.
// Nur Wegwerf-Ordner in os.tmpdir(); Kindprozesse (MCP) mit ausdrücklich gebauter Umgebung.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tmp, schreibe, pfad, echt as echtHilfe } from "./hilfe.mjs";

const { HttpFehler } = await import(pfad("gemeinsam", "basis.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { bearbeite, WERKZEUGE } = await import(pfad("mcp", "brain-mcp.mjs"));
const { AUFGABEN_WERKZEUGE, quelleVon } = await import(pfad("mcp", "aufgaben-werkzeuge.mjs"));

// Die Suite setzt KORTEX_VAULT_VERTRAUT=alle; diese Tests prüfen die echte Vertrauensprüfung.
const echt = (fn) => () => echtHilfe(fn);
const JETZT = new Date("2026-10-30T10:00:00Z");
const vaultOrdner = () => { const d = tmp("brain-aufg-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "notiz.md", "# Notiz\n"); return d; };
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const lesen = (d, rel) => readFileSync(join(d, rel), "utf8");
const feld = (d, rel, k) => new RegExp(`^${k}: (.*)$`, "m").exec(lesen(d, rel))?.[1];
const dateien = (d) => (existsSync(join(d, "05_aufgaben")) ? readdirSync(join(d, "05_aufgaben")).sort() : []);
const titel = (r) => r.j.aufgaben.map((a) => a.titel);

// ───────────────────────────── Routen ─────────────────────────────

test("GET /api/aufgaben: leerer Vault → leere Liste, Zähler 0, vertraut", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const r = await rufe("GET", "/api/aufgaben");
  assert.equal(r.status, 200);
  assert.deepEqual(r.j, { ordner: "05_aufgaben", vertraut: true, zaehler: { offen: 0, ueberfaellig: 0 }, aufgaben: [] });
  assert.equal(existsSync(join(d, "05_aufgaben")), false, "Lesen legt nichts an");
});

test("POST /api/aufgaben legt eine Datei an (Quelle mensch), GET listet sie mit Vorschau, ohne den ganzen Text", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const p = await rufe("POST", "/api/aufgaben", { titel: "Lieferanten anrufen", text: "Zeile eins.\n\n".padEnd(400, "x"), prioritaet: "hoch", faellig: "2099-01-05" });
  assert.equal(p.status, 200, JSON.stringify(p.j));
  assert.match(p.j.pfad, /^05_aufgaben\/\d{4}-\d{2}-\d{2}-lieferanten-anrufen\.md$/);
  assert.equal(p.j.aufgabe.quelle, "mensch");
  assert.equal(feld(d, p.j.pfad, "typ"), "aufgabe");
  assert.equal(feld(d, p.j.pfad, "prioritaet"), "hoch");
  const l = await rufe("GET", "/api/aufgaben");
  assert.equal(l.j.aufgaben.length, 1);
  assert.equal(l.j.aufgaben[0].titel, "Lieferanten anrufen");
  assert.ok(l.j.aufgaben[0].vorschau.length <= 160 && l.j.aufgaben[0].vorschau.endsWith("…"));
  assert.ok(!("text" in l.j.aufgaben[0]));
  assert.deepEqual(l.j.zaehler, { offen: 1, ueberfaellig: 0 });
});

test("POST: ungültige Eingaben → 400 mit Alltagsmeldung, es entsteht nichts; ein Rang von außen wird ignoriert", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  for (const [e, re] of [[{}, /Titel/], [{ titel: "  " }, /Titel/], [{ titel: "X", faellig: "bald" }, /Datum/], [{ titel: "X", prioritaet: "x" }, /Priorität/], [{ titel: "X", status: "y" }, /Status/], [{ titel: "X", quelle: "bot" }, /Quelle/]]) {
    const r = await rufe("POST", "/api/aufgaben", e);
    assert.equal(r.status, 400, JSON.stringify(e)); assert.match(r.j.fehler, re);
  }
  assert.deepEqual(dateien(d), []);
  const a = await rufe("POST", "/api/aufgaben", { titel: "A" }), b = await rufe("POST", "/api/aufgaben", { titel: "B", rang: -5 });
  assert.deepEqual([a.j.aufgabe.rang, b.j.aufgabe.rang], [1000, 2000]);
  assert.equal((await rufe("DELETE", "/api/aufgaben")).status, 405);
  assert.equal((await rufe("GET", "/api/aufgaben/05_aufgaben/x.md")).status, 405);
});

test("PATCH /api/aufgaben/<pfad>: Status, Priorität, Fälligkeit — nur diese Datei ändert sich, der Text bleibt", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const a = (await rufe("POST", "/api/aufgaben", { titel: "A", text: "Details" })).j.pfad, b = (await rufe("POST", "/api/aufgaben", { titel: "B" })).j.pfad;
  const vorB = lesen(d, b);
  const r = await rufe("PATCH", `/api/aufgaben/${a}`, { status: "in-arbeit", prioritaet: "hoch", faellig: "2099-02-01" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.aufgabe.status, r.j.aufgabe.prioritaet, r.j.aufgabe.faellig, r.j.aufgabe.vorschau], ["in-arbeit", "hoch", "2099-02-01", "Details"]);
  assert.deepEqual(r.j.geaendert, [a]);
  assert.equal(lesen(d, b), vorB);
  assert.match(lesen(d, a), /\nDetails\n$/);
  const r2 = await rufe("PATCH", `/api/aufgaben/${a}`, { faellig: null });
  assert.equal(r2.j.aufgabe.faellig, null); assert.doesNotMatch(lesen(d, a), /faellig:/);
  assert.equal((await rufe("PATCH", `/api/aufgaben/${a}`, { status: "fertig" })).status, 400);
  assert.equal((await rufe("PATCH", `/api/aufgaben/${a}`, { text: "ersetzt" })).status, 400, "der Text wird in der Datei bearbeitet, nicht über das Board");
  assert.equal((await rufe("PATCH", `/api/aufgaben/${a}`)).status, 400);
});

test("Rang konfliktarm: Ziehen ändert nur die gezogene Datei; zwischen zwei Nachbarn gilt die Mitte; bei Gleichstand wird nummeriert und gemeldet", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const neu = async (t) => (await rufe("POST", "/api/aufgaben", { titel: t })).j.pfad;
  const [a, b, c] = [await neu("A"), await neu("B"), await neu("C")];
  const vor = { a: lesen(d, a), b: lesen(d, b) };
  // C zwischen A und B
  const r = await rufe("PATCH", `/api/aufgaben/${c}`, { status: "offen", platz: { davor: a, danach: b } });
  assert.equal(r.j.aufgabe.rang, 1500); assert.deepEqual(r.j.geaendert, [c]);
  assert.equal(lesen(d, a), vor.a); assert.equal(lesen(d, b), vor.b);
  assert.deepEqual(titel(await rufe("GET", "/api/aufgaben")), ["A", "C", "B"]);
  // in die Spalte „warten“ ohne Platz → ans Ende dort; Rang beginnt bei 1000
  const w = await rufe("PATCH", `/api/aufgaben/${a}`, { status: "warten" });
  assert.deepEqual([w.j.aufgabe.status, w.j.aufgabe.rang], ["warten", 1000]);
  // Gleichstand (zwei Geräte haben gleichzeitig angelegt): Platz zwischen zwei gleichen Rängen → Spalte neu nummeriert
  const e = vaultOrdner(); const rufeE = aufruf(erzeugeHandler({ vault: e }));
  for (const [n, t] of [["2026-10-30-a", "A"], ["2026-10-30-b", "B"], ["2026-10-30-c", "C"]]) {
    mkdirSync(join(e, "05_aufgaben"), { recursive: true });
    writeFileSync(join(e, "05_aufgaben", `${n}.md`), `---\ntyp: aufgabe\ntitel: ${t}\nstatus: offen\nrang: 1000\nerstellt: 2026-10-30T10:00:00Z\n---\n`);
  }
  const g = await rufeE("PATCH", "/api/aufgaben/05_aufgaben/2026-10-30-c.md", { status: "offen", platz: { davor: "05_aufgaben/2026-10-30-a.md", danach: "05_aufgaben/2026-10-30-b.md" } });
  assert.equal(g.status, 200, JSON.stringify(g.j));
  assert.ok(g.j.geaendert.length >= 2 && g.j.geaendert[0] === "05_aufgaben/2026-10-30-c.md", "Nachbarn mitgezogen: " + g.j.geaendert);
  assert.deepEqual(titel(await rufeE("GET", "/api/aufgaben")), ["A", "C", "B"]);
});

test("Pfadschutz: nur Dateien direkt im Aufgaben-Ordner; Ausbruch, Verschlüsseltes, Nicht-Aufgaben und Unbekanntes werden abgelehnt", async () => {
  const d = vaultOrdner();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const a = (await rufe("POST", "/api/aufgaben", { titel: "A" })).j.pfad;
  schreibe(d, "05_aufgaben/kein-kopf.md", "# Nur Text\n");
  const stat = async (p, erwartet, daten = { status: "erledigt" }) => { const r = await rufe("PATCH", `/api/aufgaben/${p}`, daten); assert.equal(r.status, erwartet, `${p} → ${r.status} ${JSON.stringify(r.j)}`); return r; };
  await stat("notiz.md", 400);                                  // Notiz im Vault, keine Aufgabe
  await stat("../aussen.md", 403); await stat("05_aufgaben/../notiz.md", 403); await stat("%2e%2e/notiz.md", 403); await stat("%2e%2e%2fnotiz.md", 403);
  await stat("%2Fetc%2Fpasswd", 403); await stat("%00", 400); await stat("%E0%A4%A", 400);
  await stat(".brain-tmp-x", 403); await stat(".git/config", 403);
  await stat("05_aufgaben/unter/x.md", 400); await stat("05_aufgaben/gibts-nicht.md", 404); await stat("05_aufgaben/kein-kopf.md", 422);
  await stat(a, 403, { platz: { davor: "../notiz.md" } });
  assert.equal(feld(d, a, "status"), "offen"); assert.equal(lesen(d, "notiz.md"), "# Notiz\n");
});

test("Pfadschutz: ein Aufgaben-Ordner, der als Verweis aus dem Vault hinauszeigt, wird weder gelesen noch beschrieben", async () => {
  const d = vaultOrdner(), draussen = tmp("brain-draussen-");
  schreibe(draussen, "x.md", "---\ntyp: aufgabe\ntitel: Fremd\n---\n");
  symlinkSync(draussen, join(d, "05_aufgaben"));
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  assert.equal((await rufe("GET", "/api/aufgaben")).status, 403);
  assert.equal((await rufe("POST", "/api/aufgaben", { titel: "Böse" })).status, 403);
  assert.equal((await rufe("PATCH", "/api/aufgaben/05_aufgaben/x.md", { status: "erledigt" })).status, 403);
  assert.deepEqual(readdirSync(draussen), ["x.md"]);
  assert.match(lesen(draussen, "x.md"), /^---\ntyp: aufgabe\ntitel: Fremd\n---\n$/);
});

test("Eine einzelne Aufgabe als Symlink oder mit mehreren Namen wird nicht angefasst; der Ordnername ist konfigurierbar", async () => {
  const d = vaultOrdner();
  schreibe(d, "brain.config.json", JSON.stringify({ ordner: { aufgaben: "todo" } }));
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const a = (await rufe("POST", "/api/aufgaben", { titel: "A" })).j;
  assert.match(a.pfad, /^todo\//); assert.equal((await rufe("GET", "/api/aufgaben")).j.ordner, "todo");
  schreibe(d, "geheim.md", "---\ntyp: aufgabe\ntitel: Geheim\n---\n");
  symlinkSync(join(d, "geheim.md"), join(d, "todo", "link.md"));
  assert.deepEqual(titel(await rufe("GET", "/api/aufgaben")), ["A"], "Verweise zählen nicht");
  assert.equal((await rufe("PATCH", "/api/aufgaben/todo/link.md", { status: "erledigt" })).status, 422);
  assert.doesNotMatch(lesen(d, "geheim.md"), /status/);
});

// ───────────────────────────── Vertrauen ─────────────────────────────

test("Vertrauen: ohne Bestätigung lesen ja, anlegen und ändern nein (409 nicht-vertraut); nach der Bestätigung geht beides", echt(async () => {
  const d = vaultOrdner(), s = tmp("brain-support-");
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support: s } }));
  const l = await rufe("GET", "/api/aufgaben");
  assert.equal(l.status, 200); assert.equal(l.j.vertraut, false);
  const p = await rufe("POST", "/api/aufgaben", { titel: "Nicht erlaubt" });
  assert.equal(p.status, 409); assert.equal(p.j.art, "nicht-vertraut"); assert.deepEqual(dateien(d), []);
  schreibe(d, "05_aufgaben/x.md", "---\ntyp: aufgabe\ntitel: X\nstatus: offen\n---\n");
  const c = await rufe("PATCH", "/api/aufgaben/05_aufgaben/x.md", { status: "erledigt" });
  assert.equal(c.status, 409); assert.equal(c.j.art, "nicht-vertraut"); assert.equal(feld(d, "05_aufgaben/x.md", "status"), "offen");
  const v = await rufe("POST", "/api/vertrauen", { erlauben: true, vault: d });
  assert.equal(v.status, 200);
  assert.equal((await rufe("POST", "/api/aufgaben", { titel: "Jetzt erlaubt" })).status, 200);
  assert.equal((await rufe("PATCH", "/api/aufgaben/05_aufgaben/x.md", { status: "erledigt" })).status, 200);
  assert.equal((await rufe("GET", "/api/aufgaben")).j.vertraut, true);
}));

// ───────────────────────────── MCP ─────────────────────────────

let nr = 0;
const mcp = async (v, name, args) => (await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name, arguments: args } })).result;
const mcpText = (r) => r.content.map((c) => c.text).join("\n");
const vault = (d, extra = {}) => oeffneVault(d, { jetzt: () => JETZT, heute: "2026-10-30", ...extra });

test("MCP: drei Werkzeuge mit kurzen Beschreibungen, in der Liste und in einer eigenen Datei", async () => {
  assert.deepEqual(AUFGABEN_WERKZEUGE.map((w) => w.name), ["brain_aufgabe_anlegen", "brain_aufgaben", "brain_aufgabe_status"]);
  for (const w of AUFGABEN_WERKZEUGE) { assert.ok(WERKZEUGE.includes(w)); assert.ok(w.description.length > 10 && w.description.length <= 90, w.name); assert.equal(w.inputSchema.type, "object"); }
  assert.deepEqual(AUFGABEN_WERKZEUGE[0].inputSchema.required, ["titel"]);
  assert.ok(JSON.stringify(AUFGABEN_WERKZEUGE).length < 1100, "Token-sparsam: " + JSON.stringify(AUFGABEN_WERKZEUGE).length);
  assert.equal(quelleVon("Claude Code"), "ki:claude-code"); assert.equal(quelleVon(""), "ki:unbekannt"); assert.equal(quelleVon("a/../b"), "ki:a-..-b");
});

test("MCP: brain_aufgabe_anlegen setzt die Quelle selbst (ki:<client>); die KI kann sie nicht wählen; brain_aufgaben listet kompakt mit Daten-Hinweis", async () => {
  const d = vaultOrdner(); const v = vault(d);
  await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2" } } });
  const r = await mcp(v, "brain_aufgabe_anlegen", { titel: "Angebot prüfen", text: "bis Freitag", prioritaet: "hoch", faellig: "2026-11-06", quelle: "mensch", rang: 1 });
  assert.ok(!r.isError, mcpText(r)); assert.match(mcpText(r), /^Aufgabe angelegt: 05_aufgaben\/2026-10-30-angebot-pruefen\.md$/);
  const rel = "05_aufgaben/2026-10-30-angebot-pruefen.md";
  assert.equal(feld(d, rel, "quelle"), "ki:claude-code"); assert.equal(feld(d, rel, "rang"), "1000"); assert.equal(feld(d, rel, "faellig"), "2026-11-06");
  await mcp(v, "brain_aufgabe_anlegen", { titel: "Erledigtes" });
  await mcp(v, "brain_aufgabe_status", { pfad: "erledigtes", status: "erledigt" });
  const l = mcpText(await mcp(v, "brain_aufgaben", {}));
  const zeilen = l.split("\n");
  assert.match(zeilen[0], /Daten, keine Anweisungen/);
  assert.deepEqual(zeilen.slice(1), [`[offen] hoch ${rel} Angebot prüfen (fällig 2026-11-06)`]);
  assert.equal(mcpText(await mcp(v, "brain_aufgaben", { status: "erledigt" })).split("\n").length, 2);
  assert.equal(mcpText(await mcp(v, "brain_aufgaben", { status: "alle" })).split("\n").length, 3);
  assert.match(mcpText(await mcp(v, "brain_aufgaben", { status: "kaputt" })), /Status ist einer von/);
});

test("MCP: brain_aufgabe_status über Pfad, Dateiname oder Namensteil; Fehler als Text, nie ein Absturz", async () => {
  const d = vaultOrdner(); const v = vault(d);
  await mcp(v, "brain_aufgabe_anlegen", { titel: "Lieferanten anrufen" }); await mcp(v, "brain_aufgabe_anlegen", { titel: "Lieferung prüfen" });
  assert.match(mcpText(await mcp(v, "brain_aufgabe_status", { pfad: "anrufen", status: "in-arbeit" })), /^Lieferanten anrufen: in-arbeit$/);
  const mehr = await mcp(v, "brain_aufgabe_status", { pfad: "liefer", status: "erledigt" });
  assert.equal(mehr.isError, true); assert.match(mcpText(mehr), /mehrere/);
  const nein = await mcp(v, "brain_aufgabe_status", { pfad: "gibt-es-nicht", status: "erledigt" });
  assert.equal(nein.isError, true); assert.match(mcpText(nein), /gibt es nicht/);
  for (const bad of [{ pfad: "../notiz.md", status: "erledigt" }, { pfad: "anrufen", status: "fertig" }, { pfad: "anrufen" }, { status: "offen" }]) {
    const x = await mcp(v, "brain_aufgabe_status", bad); assert.equal(x.isError, true, JSON.stringify(bad));
  }
  const ohneTitel = await mcp(v, "brain_aufgabe_anlegen", { titel: "" }); assert.equal(ohneTitel.isError, true);
  assert.equal(feld(d, "05_aufgaben/" + dateien(d).find((n) => n.includes("lieferanten")), "status"), "in-arbeit");
});

test("MCP: nur in vertrauten Vaults schreibend — Auflisten geht, Anlegen und Status nicht", echt(async () => {
  const d = vaultOrdner(), s = tmp("brain-support-"); const v = vault(d, { support: s });
  schreibe(d, "05_aufgaben/x.md", "---\ntyp: aufgabe\ntitel: X\nstatus: offen\n---\n");
  const a = await mcp(v, "brain_aufgabe_anlegen", { titel: "Böse" });
  assert.equal(a.isError, true); assert.match(mcpText(a), /noch nicht als deiner bestätigt/);
  const b = await mcp(v, "brain_aufgabe_status", { pfad: "x", status: "erledigt" });
  assert.equal(b.isError, true); assert.equal(feld(d, "05_aufgaben/x.md", "status"), "offen");
  assert.deepEqual(dateien(d), ["x.md"]);
  const l = await mcp(v, "brain_aufgaben", {}); assert.ok(!l.isError); assert.match(mcpText(l), /X/);
}));

test("MCP als Kindprozess: Client-Name aus initialize wird zur Quelle; Umgebung ausdrücklich gebaut (kein Konto des Entwicklers)", async () => {
  const d = vaultOrdner();
  const env = { PATH: process.env.PATH, HOME: tmp("brain-home-"), BRAIN_APP_SUPPORT: tmp("brain-support-"), BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_NUTZUNG: "aus" };
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), d], { stdio: ["pipe", "pipe", "pipe"], env });
  after(() => p.kill("SIGKILL"));
  const antworten = new Map(), warte = new Map();
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = warte.get(o.id); if (w) w(o); else antworten.set(o.id, o); });
  const frage = (id, method, params) => new Promise((ok) => { if (antworten.has(id)) return ok(antworten.get(id)); warte.set(id, ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await frage(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Codex CLI", version: "1" } });
  const a = await frage(2, "tools/call", { name: "brain_aufgabe_anlegen", arguments: { titel: "Per Kindprozess" } });
  assert.ok(!a.result.isError, JSON.stringify(a));
  assert.equal(feld(d, "05_aufgaben/" + dateien(d)[0], "quelle"), "ki:codex-cli");
  const t = await frage(3, "tools/list", {});
  assert.ok(t.result.tools.some((x) => x.name === "brain_aufgaben"));
  p.stdin.end();
});
