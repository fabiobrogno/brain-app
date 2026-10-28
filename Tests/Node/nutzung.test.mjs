import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const N = await import(pfad("gemeinsam", "nutzung.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const SKRIPT = pfad("mcp", "brain-mcp.mjs");
const LOG = (d) => join(d, ".logs", "mcp.log");
const zeilen = (d) => readFileSync(LOG(d), "utf8").split("\n").filter(Boolean);
const kopf = "---\nname: x\ntyp: thema\nquellen: [\"a\"]\nquellen_sha: [\"0123456789abcdef\"]\nrev: 1\n---\n";

test("protokolliere: Zeile im Format des Kits (Zeit, sid, hits=Tab-kodiert wie hint.log), Ordner wird angelegt", () => {
  const d = tmp();
  N.protokolliere(d, { werkzeug: "brain_lesen", seiten: ["09_wiki/a b.md", "09_wiki/x,y.md"], ms: 12.4, jetzt: new Date("2026-10-28T10:11:12.999Z") });
  const z = zeilen(d);
  assert.equal(z.length, 1);
  assert.match(z[0], /^2026-10-28T10:11:12 sid=mcp werkzeug=brain_lesen hits=\S+ ms=12 ok=1$/);
  assert.deepEqual(N.seitenAusHits(/hits=(\S+)/.exec(z[0])[1]), ["09_wiki/a b.md", "09_wiki/x,y.md"]);
  N.protokolliere(d, { werkzeug: "brain_vaults" });
  assert.match(zeilen(d)[1], / hits=- ms=0 ok=1$/);
  N.protokolliere(d, { werkzeug: "evil tool\nname", seiten: ["tab\tweg.md", "", "ok.md", "ok.md"], ok: false });
  assert.match(zeilen(d)[2], / werkzeug=eviltoolname hits=ok\.md ms=0 ok=0$/);
  assert.equal(zeilen(d).length, 3, "kein Zeilenumbruch aus Eingaben");
});

test("protokolliere: wirft nie (.logs ist eine Datei, Ordner schreibgeschützt, Unsinn als Argument)", () => {
  const d = tmp(); schreibe(d, ".logs", "ich bin eine Datei");
  assert.doesNotThrow(() => N.protokolliere(d, { werkzeug: "brain_suchen", seiten: ["a.md"] }));
  const e = tmp(); mkdirSync(join(e, ".logs")); chmodSync(join(e, ".logs"), 0o500);
  try { assert.doesNotThrow(() => N.protokolliere(e, { werkzeug: "brain_suchen", seiten: ["a.md"] })); } finally { chmodSync(join(e, ".logs"), 0o700); }
  assert.doesNotThrow(() => N.protokolliere(null, null));
  assert.doesNotThrow(() => N.protokolliere(tmp(), { werkzeug: 5, seiten: "kein array", ms: NaN, jetzt: "kein datum" }));
});

test("Rotation: über 2000 Zeilen und 150 KB → die letzten 1000 bleiben, keine tmp-Reste; kleine Dateien werden nie gekürzt", () => {
  const d = tmp();
  mkdirSync(join(d, ".logs"));
  const lang = encodeURIComponent(Array.from({ length: 20 }, (_, i) => `09_wiki/ein/langer/ordner/pfad/seite_${i}.md`).join("\t"));
  const zeile = (i) => `2026-10-28T00:00:00 sid=mcp werkzeug=brain_suchen hits=${lang} ms=${i} ok=1`;
  writeFileSync(LOG(d), Array.from({ length: 2100 }, (_, i) => zeile(i)).join("\n") + "\n");
  N.protokolliere(d, { werkzeug: "brain_lesen", seiten: ["neu.md"], jetzt: new Date("2026-10-29T00:00:00Z") });
  const z = zeilen(d);
  assert.equal(z.length, 1000);
  assert.match(z.at(-1), /^2026-10-29T00:00:00 .*hits=neu\.md/);
  assert.match(z[0], / ms=1101 /); // 2101 Zeilen, die letzten 1000 → die erste behaltene ist die mit ms=1101
  assert.deepEqual(readdirSync(join(d, ".logs")), ["mcp.log"]);
  const k = tmp();
  for (let i = 0; i < 50; i++) N.protokolliere(k, { werkzeug: "brain_vaults" });
  assert.equal(zeilen(k).length, 50);
});

test("Auswertung: meistgenutzt (Anzahl, zuletzt), nie genutzt nur aus der Wiki-Liste, Fehlaufrufe zählen nicht, kaputte Zeilen werden übersprungen", () => {
  const d = tmp();
  const t = (min) => new Date(Date.UTC(2026, 9, 28, 10, min));
  N.protokolliere(d, { werkzeug: "brain_lesen", seiten: ["09_wiki/a.md"], jetzt: t(1) });
  N.protokolliere(d, { werkzeug: "brain_suchen", seiten: ["09_wiki/a.md", "09_wiki/b.md"], jetzt: t(2) });
  N.protokolliere(d, { werkzeug: "brain_kontext", seiten: ["09_wiki/a.md", "09_wiki/a.md"], jetzt: t(3) }); // doppelt in einer Zeile = ein Abruf
  N.protokolliere(d, { werkzeug: "brain_lesen", seiten: ["09_wiki/c.md"], ok: false, jetzt: t(4) });
  writeFileSync(LOG(d), readFileSync(LOG(d), "utf8") + "Müll ohne Zeit\n2026-13-99T99:99:99 kaputt\n\n");
  const w = N.wertAus(d, ["09_wiki/a.md", "09_wiki/b.md", "09_wiki/c.md", "09_wiki/d.md"]);
  assert.equal(w.protokoll, true); assert.equal(w.aufrufe, 3);
  assert.deepEqual(w.werkzeuge, { brain_lesen: 1, brain_suchen: 1, brain_kontext: 1 });
  assert.deepEqual(w.meistgenutzt, [{ pfad: "09_wiki/a.md", anzahl: 3, zuletzt: "2026-10-28T10:03:00Z" }, { pfad: "09_wiki/b.md", anzahl: 1, zuletzt: "2026-10-28T10:02:00Z" }]);
  assert.deepEqual(w.nieGenutzt, ["09_wiki/c.md", "09_wiki/d.md"]); assert.equal(w.nieGenutztGesamt, 2); assert.equal(w.wikiSeiten, 4);
  assert.equal(w.seit, "2026-10-28T10:01:00Z"); assert.equal(w.bis, "2026-10-28T10:04:00Z");
});

test("Auswertung ohne Protokoll: neutral (protokoll false, keine Liste „nie genutzt“, kein Fehler); Obergrenzen top/maxNie", () => {
  const d = tmp();
  assert.deepEqual(N.wertAus(d, ["09_wiki/a.md"]), { protokoll: false, aufrufe: 0, seit: null, bis: null, werkzeuge: {}, meistgenutzt: [], nieGenutzt: [], nieGenutztGesamt: 0, wikiSeiten: 1 });
  for (let i = 0; i < 15; i++) N.protokolliere(d, { werkzeug: "brain_lesen", seiten: [`09_wiki/s${i}.md`] });
  const viele = Array.from({ length: 80 }, (_, i) => `09_wiki/n${String(i).padStart(2, "0")}.md`);
  const w = N.wertAus(d, viele);
  assert.equal(w.meistgenutzt.length, 10); assert.equal(w.nieGenutzt.length, 50); assert.equal(w.nieGenutztGesamt, 80);
});

// ---------- MCP-Server schreibt das Protokoll ----------
const kinder = [];
after(() => { for (const k of kinder) k.kill("SIGKILL"); });
function starte(vault) {
  const p = spawn(process.execPath, [SKRIPT, vault], { stdio: ["pipe", "pipe", "pipe"] });
  kinder.push(p);
  const antworten = [], wartende = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  const naechste = () => new Promise((ok) => { const a = antworten.shift(); if (a) ok(a); else wartende.push(ok); });
  const ende = new Promise((ok) => p.on("close", ok));
  let n = 0;
  const rufe = async (name, args) => { const id = ++n; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n"); return naechste(); };
  return { p, rufe, ende };
}
function wiki() {
  const d = repo();
  schreibe(d, ".gitignore", ".logs/\n");
  schreibe(d, "09_wiki/projekte/entitaet_garten.md", kopf + "# Garten\n\nAmazon Garten\n");
  schreibe(d, "09_wiki/projekte/thema_ungenutzt.md", kopf + "# Ungenutzt\n\nNie gelesen\n");
  schreibe(d, "09_wiki/_index.md", "# Wiki-Verzeichnis (generiert — nicht editieren)\n");
  g(d, "add", "--", ".gitignore", "09_wiki"); g(d, "commit", "-q", "-m", "Wiki");
  return d;
}

test("MCP: jeder Werkzeugaufruf landet im Protokoll (Suche, Lesen, Kontext, Fehler, Vaults); Suchbegriffe nie; Git bleibt sauber", async () => {
  const d = wiki();
  const s = starte(d);
  let a = await s.rufe("brain_suchen", { frage: "Amazon Garten" });
  assert.ok(!a.result.isError);
  assert.deepEqual(a.result.content.map((c) => c.type), ["text"]);
  a = await s.rufe("brain_lesen", { pfad: "09_wiki/projekte/entitaet_garten.md" }); assert.ok(!a.result.isError);
  a = await s.rufe("brain_lesen", { pfad: "09_wiki/gibt-es-nicht.md" }); assert.equal(a.result.isError, true);
  a = await s.rufe("brain_kontext", { projekt: "garten" }); assert.ok(!a.result.isError);
  a = await s.rufe("brain_vaults", {}); assert.ok(!a.result.isError);
  s.p.stdin.end(); await s.ende;
  const z = zeilen(d);
  assert.equal(z.length, 5);
  const p = N.leseProtokoll(d);
  assert.deepEqual(p.map((x) => [x.werkzeug, x.ok]), [["brain_suchen", true], ["brain_lesen", true], ["brain_lesen", false], ["brain_kontext", true], ["brain_vaults", true]]);
  assert.ok(p[0].seiten.includes("09_wiki/projekte/entitaet_garten.md"));
  assert.deepEqual(p[1].seiten, ["09_wiki/projekte/entitaet_garten.md"]);
  assert.deepEqual(p[2].seiten, [], "Fehlaufruf nennt keine Seite");
  assert.ok(p[3].seiten.includes("09_wiki/projekte/entitaet_garten.md"));
  assert.ok(!z.join("\n").includes("Amazon"), "Suchbegriffe landen nie im Protokoll");
  assert.equal(g(d, "status", "--porcelain").trim(), "", ".logs ist ignoriert");
});

test("MCP: Protokoll nicht schreibbar → Antwort kommt trotzdem, nichts auf stderr", async () => {
  const d = wiki(); schreibe(d, ".logs", "Datei statt Ordner");
  const s = starte(d);
  let err = ""; s.p.stderr.on("data", (c) => (err += c));
  const a = await s.rufe("brain_lesen", { pfad: "09_wiki/projekte/entitaet_garten.md" });
  assert.ok(!a.result.isError); assert.match(a.result.content[0].text, /Garten/);
  s.p.stdin.end(); await s.ende;
  assert.equal(err, "");
});

test("Vault.nutzung() und GET /api/nutzung: meistgenutzt und nie genutzte Wiki-Seiten (ohne generierte)", async () => {
  const d = wiki();
  const s = starte(d);
  await s.rufe("brain_lesen", { pfad: "09_wiki/projekte/entitaet_garten.md" });
  await s.rufe("brain_lesen", { pfad: "09_wiki/projekte/entitaet_garten.md" });
  s.p.stdin.end(); await s.ende;
  const w = oeffneVault(d).nutzung();
  assert.equal(w.protokoll, true); assert.equal(w.aufrufe, 2);
  assert.deepEqual(w.meistgenutzt.map((x) => [x.pfad, x.anzahl]), [["09_wiki/projekte/entitaet_garten.md", 2]]);
  assert.deepEqual(w.nieGenutzt, ["09_wiki/projekte/thema_ungenutzt.md"], "_index.md ist generiert und zählt nicht");
  const studio = tmp(); schreibe(studio, "index.html", "<!doctype html>");
  const h = erzeugeHandler({ vault: d, studioDir: studio });
  const r = await h({ methode: "GET", pfad: "/api/nutzung", query: null });
  assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body.toString("utf8")), w);
  assert.equal((await h({ methode: "POST", pfad: "/api/nutzung", query: null, body: Buffer.from("{}") })).status, 405);
  assert.equal(oeffneVault(repo()).nutzung().protokoll, false);
});
