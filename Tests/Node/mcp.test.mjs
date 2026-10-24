import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const kinder = [];
after(() => { for (const k of kinder) k.kill("SIGKILL"); }); // auch nach einem Fehlschlag keine Waisen
const SKRIPT = pfad("mcp", "brain-mcp.mjs");
const kopf = "---\nname: x\ntyp: thema\nquellen: [\"a\"]\nquellen_sha: [\"0123456789abcdef\"]\nrev: 1\n---\n";

function wiki() {
  const d = repo();
  schreibe(d, "09_wiki/firma/thema_amazon.md", kopf + "# Amazon-Thema\n\n- Fakt · Stand 21.10.2026 · [[firma/belege/2026-10/b1]]\n");
  schreibe(d, "09_wiki/firma/thema_streit.md", kopf + "# Streit\n\nAmazon strittig\n> [!KONFLIKT] offen — Du entscheidest\n");
  schreibe(d, "00_inbox/notiz.md", "# Notiz\n\nAmazon-Idee mit Ärger\n");
  schreibe(d, "09_wiki/_index.md", "# Wiki-Verzeichnis (generiert — nicht editieren)\n");
  g(d, "add", "--", "09_wiki", "00_inbox"); g(d, "commit", "-q", "-m", "Wiki angelegt");
  return d;
}

function starte(vault) {
  const p = spawn(process.execPath, [SKRIPT, vault], { stdio: ["pipe", "pipe", "pipe"] });
  kinder.push(p);
  const antworten = [], wartende = [];
  let stderr = ""; p.stderr.on("data", (c) => (stderr += c));
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  const naechste = () => new Promise((ok) => { const a = antworten.shift(); if (a) ok(a); else wartende.push(ok); });
  const ende = new Promise((ok) => p.on("close", (code) => ok(code)));
  let n = 0;
  const frage = async (method, params) => { const id = ++n; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const a = await naechste(); assert.equal(a.id, id); return a; };
  const rufe = (name, args) => frage("tools/call", { name, arguments: args });
  return { p, frage, rufe, naechste, ende, stderr: () => stderr, melde: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n") };
}
const textVon = (a) => a.result.content.map((c) => c.text).join("\n");

test("MCP: initialize übernimmt unterstützte Version, sonst die neueste; Benachrichtigung ohne Antwort; ping", async () => {
  const s = starte(wiki());
  let a = await s.frage("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(a.jsonrpc, "2.0"); assert.equal(a.result.protocolVersion, "2024-11-05");
  assert.deepEqual(a.result.capabilities, { tools: {} }); assert.equal(a.result.serverInfo.name, "brain");
  s.melde("notifications/initialized");
  a = await s.frage("initialize", { protocolVersion: "1999-01-01" });
  assert.equal(a.result.protocolVersion, "2025-06-18");
  a = await s.frage("initialize", { protocolVersion: "2025-03-26" });
  assert.equal(a.result.protocolVersion, "2025-03-26");
  a = await s.frage("ping"); assert.deepEqual(a.result, {});
  a = await s.frage("gibtsnicht"); assert.equal(a.error.code, -32601);
  s.p.stdin.write("kein json\n");
  a = await s.naechste(); assert.equal(a.error.code, -32700); assert.equal(a.id, null);
  s.p.stdin.write(JSON.stringify({ id: 1, method: "ping" }) + "\n");
  a = await s.naechste(); assert.equal(a.error.code, -32600);
  s.p.stdin.end();
  assert.equal(await s.ende, 0);
  assert.equal(s.stderr(), "");
});

test("MCP: tools/list nennt genau die fünf Werkzeuge mit Schema", async () => {
  const s = starte(wiki());
  const a = await s.frage("tools/list");
  assert.deepEqual(a.result.tools.map((t) => t.name).sort(), ["brain_gesundheit", "brain_lesen", "brain_merken", "brain_suchen", "brain_verlauf"]);
  for (const t of a.result.tools) { assert.equal(t.inputSchema.type, "object"); assert.ok(t.description.length > 10); }
  assert.deepEqual(a.result.tools.find((t) => t.name === "brain_suchen").inputSchema.required, ["frage"]);
  s.p.stdin.end(); await s.ende;
});

test("MCP: brain_suchen mit Prüf-Stufe, Anzahl-Grenze, keine Treffer", async () => {
  const s = starte(wiki());
  let t = textVon(await s.rufe("brain_suchen", { frage: "amazon" }));
  assert.match(t, /09_wiki\/firma\/thema_amazon\.md — Amazon-Thema \[grün\]/);
  assert.match(t, /09_wiki\/firma\/thema_streit\.md — Streit \[rot\]/);
  assert.match(t, /00_inbox\/notiz\.md — Notiz \[grau\]/);
  assert.doesNotMatch(t, /_index/);
  t = textVon(await s.rufe("brain_suchen", { frage: "amazon", anzahl: 1 }));
  assert.equal(t.split("\n").filter((z) => /^\d+\. /.test(z)).length, 1);
  assert.match(textVon(await s.rufe("brain_suchen", { frage: "ärger" })), /notiz\.md/);
  assert.equal(textVon(await s.rufe("brain_suchen", { frage: "zzzzzz" })), "Keine Treffer.");
  const f = await s.rufe("brain_suchen", {});
  assert.equal(f.result.isError, true);
  s.p.stdin.end(); await s.ende;
});

test("MCP: brain_lesen liefert Inhalt, Signale und Stand; Pfad-Schutz; Fehler als isError", async () => {
  const s = starte(wiki());
  let t = textVon(await s.rufe("brain_lesen", { pfad: "09_wiki/firma/thema_streit.md" }));
  assert.match(t, /Prüf-Stufe: rot/); assert.match(t, /Offener Konflikt-Kasten/); assert.match(t, /\(Zeile \d+\)/);
  assert.match(t, /# Streit/); assert.match(t, /Geändert: \d{4}-\d\d-\d\d \d\d:\d\d/);
  t = textVon(await s.rufe("brain_lesen", { pfad: "09_wiki/_index.md" }));
  assert.match(t, /Schreibgeschützt/);
  for (const p of ["../x.md", "/etc/passwd", ".git/config", "fehlt.md"]) {
    const a = await s.rufe("brain_lesen", { pfad: p });
    assert.equal(a.result.isError, true, p);
    assert.ok(a.result.content[0].text.length > 3);
  }
  s.p.stdin.end(); await s.ende;
});

test("MCP: brain_merken schreibt nur in 00_inbox, nie ins Wiki; Namensgleichheit -2", async () => {
  const d = wiki();
  const vorher = readdirSync(join(d, "09_wiki", "firma")).sort();
  const s = starte(d);
  const a = await s.rufe("brain_merken", { text: "Neue Erkenntnis über Amazon", titel: "Erkenntnis ../../09_wiki/x" });
  const m = /Gemerkt in (\S+\.md)\./.exec(textVon(a));
  assert.ok(m, textVon(a));
  assert.match(m[1], /^00_inbox\/\d{4}-\d\d-\d\d_erkenntnis-09-wiki-x\.md$/);
  assert.equal(readFileSync(join(d, m[1]), "utf8"), "# Erkenntnis ../../09_wiki/x\n\nNeue Erkenntnis über Amazon\n");
  const b = await s.rufe("brain_merken", { text: "Nochmal", titel: "Erkenntnis ../../09_wiki/x" });
  assert.match(textVon(b), /-2\.md/);
  assert.equal((await s.rufe("brain_merken", { text: "" })).result.isError, true);
  assert.deepEqual(readdirSync(join(d, "09_wiki", "firma")).sort(), vorher, "Wiki unverändert");
  assert.equal(g(d, "status", "--porcelain").split("\n").filter((z) => z && !z.includes("00_inbox/")).join(""), "", "nur Inbox angefasst");
  // ein Werkzeug, das ins Wiki schreibt, gibt es nicht
  const u = await s.frage("tools/call", { name: "brain_schreiben", arguments: { pfad: "09_wiki/x.md", inhalt: "x" } });
  assert.equal(u.error.code, -32602);
  s.p.stdin.end(); await s.ende;
});

test("MCP: unbekanntes Werkzeug → JSON-RPC-Fehler", async () => {
  const s = starte(wiki());
  let a = await s.frage("tools/call", { name: "gibtsnicht", arguments: {} });
  assert.equal(a.error.code, -32602); assert.match(a.error.message, /gibtsnicht/);
  a = await s.frage("tools/call", {});
  assert.equal(a.error.code, -32602);
  s.p.stdin.end(); await s.ende;
});

test("MCP: brain_gesundheit ohne Kit und mit Kit (Kurzfassung)", async () => {
  const d = wiki();
  const s = starte(d);
  assert.match(textVon(await s.rufe("brain_gesundheit", {})), /nicht verfügbar/);
  s.p.stdin.end(); await s.ende;
  schreibe(d, ".tools/brain.mjs", `console.log(JSON.stringify({version:1,ampel:"rot",warnungen:2,pruefungen:[
    {id:"a",name:"Messlatte",stufe:"rot",text:"verfehlt 0/97",befunde:[{stufe:"rot",kurz:"Messlatte verfehlt"}]},
    {id:"b",name:"Suchindex",stufe:"gruen",text:"alles gut",befunde:[]}]}));`);
  const s2 = starte(d);
  const t = textVon(await s2.rufe("brain_gesundheit", {}));
  assert.match(t, /Ampel: rot · 2 Warnung/); assert.match(t, /Messlatte \[rot\]: verfehlt 0\/97/); assert.match(t, /Messlatte verfehlt/); assert.doesNotMatch(t, /Suchindex/);
  s2.p.stdin.end(); await s2.ende;
});

test("MCP: brain_verlauf zeigt Git-Verlauf", async () => {
  const d = wiki();
  writeFileSync(join(d, "00_inbox/notiz.md"), "# Notiz\n\nGeändert\n"); g(d, "add", "--", "00_inbox/notiz.md"); g(d, "commit", "-q", "-m", "Notiz geändert");
  const s = starte(d);
  const t = textVon(await s.rufe("brain_verlauf", { pfad: "00_inbox/notiz.md" }));
  assert.match(t, /Notiz geändert/); assert.match(t, /Wiki angelegt/);
  assert.equal(t.split("\n").length, 2);
  assert.equal(textVon(await s.rufe("brain_verlauf", { pfad: "00_inbox/notiz.md", max: 1 })).split("\n").length, 1);
  assert.match(textVon(await s.rufe("brain_verlauf", { pfad: "nirgends.md" })), /Kein Verlauf/);
  assert.equal((await s.rufe("brain_verlauf", { pfad: "../x" })).result.isError, true);
  s.p.stdin.end(); await s.ende;
});

test("MCP: Stapel (Array) und stdin zu → sauberes Ende; ohne Vault Exit 2", async () => {
  const s = starte(wiki());
  s.p.stdin.write(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]) + "\n");
  const a = await s.naechste();
  assert.ok(Array.isArray(a)); assert.deepEqual(a.map((x) => x.id), [1, 2]);
  s.p.stdin.end();
  assert.equal(await s.ende, 0);
  const code = await new Promise((ok) => spawn(process.execPath, [SKRIPT, join(tmp(), "nix")], { stdio: "ignore" }).on("close", ok));
  assert.equal(code, 2);
});
