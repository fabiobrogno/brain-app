// Härtung der Nutzungsmessung (Review FBL-72): Git-Schutz, lange Zeilen, nicht lesbare Protokolle, Symlinks, Probe/Selbsttest zählen nicht.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync, symlinkSync, statSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const N = await import(pfad("gemeinsam", "nutzung.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const SKRIPT = pfad("mcp", "brain-mcp.mjs");
const LOG = (d) => join(d, ".logs", "mcp.log");
const zeilen = (d) => readFileSync(LOG(d), "utf8").split("\n").filter(Boolean);
const kopf = "---\nname: x\ntyp: thema\nquellen: [\"a\"]\nquellen_sha: [\"0123456789abcdef\"]\nrev: 1\n---\n";

test("Git-Vault ohne .gitignore: .logs/ bringt eine eigene .gitignore mit *, git status bleibt sauber (auch bei vorhandenem .logs)", () => {
  const d = repo();
  N.protokolliere(d, { werkzeug: "brain_lesen", seiten: ["a.md"] });
  assert.equal(readFileSync(join(d, ".logs", ".gitignore"), "utf8"), "*\n");
  assert.equal(g(d, "status", "--porcelain").trim(), "");
  const e = repo(); mkdirSync(join(e, ".logs")); // das Kit hat .logs schon angelegt, ohne Schutz
  N.protokolliere(e, { werkzeug: "brain_lesen", seiten: ["a.md"] });
  assert.equal(g(e, "status", "--porcelain").trim(), "");
  writeFileSync(join(e, ".logs", ".gitignore"), "# eigene\n");
  N.protokolliere(e, { werkzeug: "brain_lesen", seiten: ["a.md"] });
  assert.equal(readFileSync(join(e, ".logs", ".gitignore"), "utf8"), "# eigene\n", "eine vorhandene .gitignore bleibt");
});

test("Lange Zeilen: Rotation auch nach Größe, die Datei bleibt unter der Lesegrenze, die Auswertung zeigt weiter Aufrufe", () => {
  const d = tmp();
  mkdirSync(join(d, ".logs"));
  const lang = encodeURIComponent(Array.from({ length: 20 }, (_, i) => `09_wiki/ein/langer/ordner/pfad/mit/vielen/ebenen/seite_${i}.md`).join("\t"));
  const zeile = (i) => `2026-10-28T00:00:00 sid=mcp werkzeug=brain_suchen hits=${lang} ms=${i} ok=1`;
  assert.ok(zeile(0).length > 1300);
  writeFileSync(LOG(d), Array.from({ length: 1000 }, (_, i) => zeile(i)).join("\n") + "\n"); // > 1,3 MB, aber nur 1000 Zeilen
  N.protokolliere(d, { werkzeug: "brain_lesen", seiten: ["neu.md"], jetzt: new Date("2026-10-29T00:00:00Z") });
  assert.ok(statSync(LOG(d)).size <= 600_000, `Größe ${statSync(LOG(d)).size}`);
  assert.match(zeilen(d).at(-1), /hits=neu\.md/);
  const w = N.wertAus(d, []);
  assert.equal(w.protokoll, true); assert.equal(w.fehler, null); assert.ok(w.aufrufe > 100);
});

test("Zu große Datei (> 2 MB, von Hand angewachsen): gelesen werden die letzten 2 MB, nie „leer“", () => {
  const d = tmp();
  mkdirSync(join(d, ".logs"));
  const zeile = (i) => `2026-10-28T00:00:00 sid=mcp werkzeug=brain_lesen hits=${encodeURIComponent("09_wiki/s" + (i % 7) + ".md")} ms=1 ok=1`;
  writeFileSync(LOG(d), Array.from({ length: 40000 }, (_, i) => zeile(i)).join("\n") + "\n");
  assert.ok(statSync(LOG(d)).size > 2 * 1024 * 1024);
  const w = N.wertAus(d, []);
  assert.equal(w.protokoll, true); assert.equal(w.fehler, null);
  assert.ok(w.aufrufe > 20000 && w.aufrufe < 40000, `Aufrufe ${w.aufrufe}`);
});

test("Nicht lesbares Protokoll ist ein Fehler, nie „leer“: Symlink, Ordner statt Datei, .logs als Datei oder Symlink, fehlende Rechte", () => {
  const fremd = tmp(); writeFileSync(join(fremd, "ziel.log"), "2026-10-28T00:00:00 sid=mcp werkzeug=brain_lesen hits=a.md ms=1 ok=1\n");
  const a = tmp(); mkdirSync(join(a, ".logs")); symlinkSync(join(fremd, "ziel.log"), LOG(a));
  const b = tmp(); mkdirSync(join(b, ".logs", "mcp.log"), { recursive: true });
  const c = tmp(); writeFileSync(join(c, ".logs"), "Datei");
  const dd = tmp(); symlinkSync(fremd, join(dd, ".logs"));
  for (const v of [a, b, c, dd]) {
    const w = N.wertAus(v, ["09_wiki/x.md"]);
    assert.equal(w.protokoll, false); assert.equal(typeof w.fehler, "string"); assert.ok(w.fehler.length > 10); assert.deepEqual(w.nieGenutzt, []);
  }
  if (process.getuid && process.getuid() !== 0) {
    const e = tmp(); N.protokolliere(e, { werkzeug: "brain_lesen" }); chmodSync(LOG(e), 0o000);
    try { assert.equal(typeof N.wertAus(e, []).fehler, "string"); } finally { chmodSync(LOG(e), 0o644); }
  }
  assert.equal(N.wertAus(tmp(), []).fehler, null, "eine fehlende Datei ist neutral");
});

test("Schreiben folgt keinem Symlink: weder .logs/mcp.log noch .logs selbst", () => {
  const fremd = tmp(); const ziel = join(fremd, "ziel.log"); writeFileSync(ziel, "VORHER\n");
  const a = tmp(); mkdirSync(join(a, ".logs")); symlinkSync(ziel, LOG(a));
  assert.doesNotThrow(() => N.protokolliere(a, { werkzeug: "brain_lesen", seiten: ["a.md"] }));
  assert.equal(readFileSync(ziel, "utf8"), "VORHER\n");
  const b = tmp(); const fremdOrdner = tmp(); symlinkSync(fremdOrdner, join(b, ".logs"));
  N.protokolliere(b, { werkzeug: "brain_lesen", seiten: ["a.md"] });
  assert.deepEqual(readdirSync(fremdOrdner), [], "durch den Ordner-Symlink wurde nichts geschrieben");
});

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

test("Probe-Frage und Selbsttest der App zählen nicht als KI-Nutzung (BRAIN_NUTZUNG=aus), die KI selbst schon", async () => {
  const support = tmp("brain-support-");
  const d = repo();
  schreibe(d, "09_wiki/projekte/entitaet_garten.md", kopf + "# Garten\n\nAmazon Garten\n");
  g(d, "add", "--", "09_wiki"); g(d, "commit", "-q", "-m", "Wiki");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "v", pfad: realpathSync(d), farbe: "#5B8DEF" }], aktiv: realpathSync(d) }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support } });
  const post = (p, daten) => h({ methode: "POST", pfad: p, query: null, body: Buffer.from(JSON.stringify(daten)) });
  assert.equal((await post("/api/probe", { frage: "Garten" })).status, 200);
  assert.equal((await post("/api/mcp/selbsttest", {})).status, 200);
  assert.equal(existsSync(LOG(d)), false, "kein Protokoll durch Probe und Selbsttest");
  const s = starte(d);
  await s.rufe("brain_lesen", { pfad: "09_wiki/projekte/entitaet_garten.md" });
  s.p.stdin.end(); await s.ende;
  assert.equal(zeilen(d).length, 1);
});
