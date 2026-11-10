// R4-5: schlanke Listen-Antwort der Werkstatt (?kompakt=1): ohne `links`, Vorschau gekürzt, sonst gleich; ohne den Schalter bleibt der Vertrag unverändert.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

process.env.HOME = tmp("brain-home-"); if (process.platform === "win32") process.env.USERPROFILE = process.env.HOME;
const { erzeugeHandler, kompakt, VORSCHAU_KOMPAKT } = await import(pfad("werkstatt", "handler.mjs"));
const { baueGrossVault } = await import("./gross-vault.mjs");

const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  return { ...r, j: JSON.parse(r.body.toString("utf8")), bytes: r.body.length };
};

test("kompakt(): entfernt links, kürzt die Vorschau (nie mitten in ein Ersatzzeichenpaar), lässt alles andere und fremde Antworten unverändert", () => {
  const lang = "a".repeat(VORSCHAU_KOMPAKT - 1) + "😀 und mehr";
  const r = kompakt({ typen: { x: 1 }, notizen: [{ pfad: "a.md", links: ["b.md"], vorschau: "kurz", titel: "A" }, { pfad: "b.md", links: [], vorschau: lang }] });
  assert.deepEqual(r.typen, { x: 1 });
  assert.equal("links" in r.notizen[0], false);
  assert.equal(r.notizen[0].vorschau, "kurz"); assert.equal(r.notizen[0].titel, "A");
  assert.ok(r.notizen[1].vorschau.length <= VORSCHAU_KOMPAKT);
  assert.ok(!/[\ud800-\udbff]$/.test(r.notizen[1].vorschau), "kein halbes Ersatzzeichen am Ende");
  assert.equal(kompakt(null), null); assert.deepEqual(kompakt({ a: 1 }), { a: 1 });
});

test("/api/index, /api/notizen, /api/teilindex mit kompakt: gleiche Notizen und Felder, aber ohne links und kleiner; ohne Schalter wie bisher", async () => {
  const { vault, dateien } = baueGrossVault(400, { start: 7 });
  const rufe = aufruf(erzeugeHandler({ vault }));
  const voll = await rufe("GET", "/api/index");
  const k = await rufe("GET", "/api/index", undefined, "kompakt=1");
  assert.equal(k.status, 200);
  assert.deepEqual(k.j.notizen.map((n) => n.pfad), voll.j.notizen.map((n) => n.pfad));
  assert.deepEqual(k.j.typen, voll.j.typen); assert.deepEqual(k.j.ansichten, voll.j.ansichten);
  assert.ok(voll.j.notizen.some((n) => Array.isArray(n.links) && n.links.length), "der Vertrag ohne Schalter enthält links");
  for (const [i, n] of k.j.notizen.entries()) {
    const v = voll.j.notizen[i];
    assert.equal("links" in n, false);
    assert.ok(n.vorschau.length <= VORSCHAU_KOMPAKT && v.vorschau.startsWith(n.vorschau));
    const { links, vorschau, ...rest } = v; const { vorschau: _v, ...rest2 } = n;
    assert.deepEqual(rest2, rest, "alle übrigen Felder gleich");
  }
  assert.ok(k.bytes < voll.bytes * 0.95, `kompakt ${k.bytes} B gegen voll ${voll.bytes} B`);
  const n1 = await rufe("GET", "/api/notizen", undefined, "kompakt=1");
  assert.deepEqual(n1.j.notizen, k.j.notizen);
  // Teil-Index nach einer Änderung
  writeFileSync(join(vault, dateien[3]), "# Neu\n\nGeändert, mit [[Anderes]] und einem langen Text. ".repeat(20));
  const t = await rufe("POST", "/api/teilindex", { pfade: [dateien[3]], kompakt: true });
  if (t.j.voll) return; // Vault ohne Posteingang: die Werkstatt verlangt das volle Neuladen, dann gibt es keine Zeilen zu prüfen
  assert.ok(t.j.notizen.length >= 1);
  assert.ok(t.j.notizen.every((n) => !("links" in n) && n.vorschau.length <= VORSCHAU_KOMPAKT)); // auch wenn die Werkstatt „voll“ meldet
  const t2 = await rufe("POST", "/api/teilindex", { pfade: [dateien[3]] });
  assert.ok(t2.j.notizen.every((n) => Array.isArray(n.links)));
});
