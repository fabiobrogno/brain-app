// Integration #93 (Entwurfs-Journal) + #95 (Umbenennen/Verschieben) + #96 (⌘N, Tagesnotiz): Werkstatt-Seite.
// Entwürfe neuer Notizen unter `entwurf:<id>` samt meta, Entwürfe ziehen bei Umbenennen/Verschieben mit, der konfigurierte Vorlagenordner ist geschützt.
// Nur Wegwerf-Ordner, nie ein echter Vault oder Support-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const entwurf = await import(pfad("gemeinsam", "entwurf.mjs"));
const ablage = await import(pfad("gemeinsam", "ablage.mjs"));
const { entwurfSchluessel } = await import(pfad("studio", "entwurf.js"));

function aufbau(dateien = {}, config = "{}\n") {
  const d = tmp("sint-vault-"), support = tmp("sint-support-");
  schreibe(d, "brain.config.json", config);
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  return { d, support, v: oeffneVault(d, { support, heute: "2026-11-05" }) };
}
async function fehler(fn) { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); }
const fehlerSync = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); };

test("Punkt 1: Entwurf einer neuen Notiz (Schlüssel entwurf:<id>) trägt meta, wird aufgelistet, gelesen und gelöscht", () => {
  const { d, support, v } = aufbau();
  const key = entwurfSchluessel("abc-123");
  assert.equal(key, "entwurf:abc-123");
  const meta = { pfad: "Tagebuch/2026-11-05.md", ordner: "Tagebuch", tag: "2026-11-05" };
  entwurf.schreibeEntwurf(support, d, { pfad: key, basisHash: null, text: "# Heute\nText\n", meta });
  const l = entwurf.listeEntwuerfe(support, d);
  assert.equal(l.length, 1); assert.equal(l[0].pfad, key); assert.deepEqual(l[0].meta, meta);
  const p = v.entwurfPruefen(key);
  assert.equal(p.entwurf.text, "# Heute\nText\n"); assert.deepEqual(p.entwurf.meta, meta); assert.equal(p.datei, null);
  assert.equal(entwurf.loescheEntwurf(support, d, key), true);
  assert.equal(entwurf.listeEntwuerfe(support, d).length, 0);
  entwurf.schreibeEntwurf(support, d, { pfad: "10/a.md", text: "x" });
  assert.equal(entwurf.leseEntwurf(support, d, "10/a.md").meta, null, "ohne meta bleibt alles wie bisher");
  assert.equal(fehlerSync(() => entwurf.schreibeEntwurf(support, d, { pfad: key, text: "x", meta: "kein Objekt" })).status, 400);
  assert.equal(fehlerSync(() => entwurf.schreibeEntwurf(support, d, { pfad: key, text: "x", meta: { a: "x".repeat(3000) } })).status, 400);
});

test("Punkt 5: Umbenennen einer Notiz zieht ihren Entwurf mit (Zeit, Text, Basis bleiben) — kein Waise", async () => {
  const { d, support, v } = aufbau({ "10/Kaffee.md": "# Kaffee\n" });
  entwurf.schreibeEntwurf(support, d, { pfad: "10/Kaffee.md", basisHash: "h1", text: "# Kaffee\nungespeichert\n" });
  const vor = entwurf.leseEntwurf(support, d, "10/Kaffee.md");
  await v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md" });
  v.entwurfVerschieben({ von: "10/Kaffee.md", nach: "10/Espresso.md" }); // das Studio meldet es nach dem Erfolg
  assert.equal(entwurf.leseEntwurf(support, d, "10/Kaffee.md"), null);
  const nach = entwurf.leseEntwurf(support, d, "10/Espresso.md");
  assert.deepEqual({ ...nach, pfad: "x", zeit: 0 }, { ...vor, pfad: "x", zeit: 0 }); assert.equal(nach.pfad, "10/Espresso.md");
  assert.ok(Date.parse(nach.zeit) >= Date.parse(vor.zeit), "die Zeit ist erneuert: der Entwurf bleibt neuer als die vom Umbenennen neu geschriebene Datei");
  assert.deepEqual(entwurf.listeEntwuerfe(support, d).map((e) => e.pfad), ["10/Espresso.md"]);
  assert.equal(ablage.liste(support, d, null).length, 0, "nichts in der Ablage");
});

test("Punkt 5: ein Ordner zieht alle Entwürfe darunter mit; fremde Pfade mit gleichem Anfang und Entwürfe neuer Notizen bleiben", () => {
  const { d, support, v } = aufbau({ "a/x.md": "x", "a/b/y.md": "y", "ab/z.md": "z" });
  for (const p of ["a/x.md", "a/b/y.md", "ab/z.md"]) entwurf.schreibeEntwurf(support, d, { pfad: p, text: `Entwurf ${p}` });
  entwurf.schreibeEntwurf(support, d, { pfad: "entwurf:k1", text: "neu", meta: { ordner: "a" } });
  assert.deepEqual(v.entwurfVerschieben({ von: "a", nach: "c" }), { bewegt: 2 });
  assert.deepEqual(entwurf.listeEntwuerfe(support, d).map((e) => e.pfad).sort(), ["ab/z.md", "c/b/y.md", "c/x.md", "entwurf:k1"]);
  assert.equal(entwurf.leseEntwurf(support, d, "c/b/y.md").text, "Entwurf a/b/y.md");
});

test("Punkt 5: gibt es am Ziel schon einen Entwurf, bleibt der neuere, der ältere liegt in der Ablage", () => {
  const { d, support } = aufbau({ "a.md": "a", "b.md": "b" });
  entwurf.schreibeEntwurf(support, d, { pfad: "a.md", text: "ALT" });
  const t = Date.now() + 5;
  while (Date.now() < t); // andere Zeit
  entwurf.schreibeEntwurf(support, d, { pfad: "b.md", text: "NEU" });
  entwurf.verschiebeEntwuerfe(support, d, "a.md", "b.md");
  assert.equal(entwurf.leseEntwurf(support, d, "b.md").text, "NEU");
  assert.equal(entwurf.leseEntwurf(support, d, "a.md"), null);
  assert.ok(ablage.liste(support, d, "b.md").some((f) => f.grund === "entwurf-verworfen" && ablage.lese(support, d, f.id).inhalt === "ALT"));
  assert.throws(() => entwurf.verschiebeEntwuerfe(support, d, "../x", "b.md"), HttpFehler);
});

test("Punkt 6: der konfigurierte Vorlagenordner (ordner.vorlagen) ist wie 01_vorlagen geschützt; Notizen darin lassen sich umbenennen", async () => {
  const { d, v } = aufbau({ "Schablonen/Besprechung.md": "# {{titel}}\n", "10/x.md": "x", "Tagebuch/2026-11-05.md": "# t\n" }, JSON.stringify({ ordner: { vorlagen: "Schablonen" } }) + "\n");
  assert.equal((await fehler(() => v.umbenennen({ pfad: "Schablonen", typ: "ordner", name: "Neu" }))).status, 403);
  assert.equal((await fehler(() => v.loeschen({ pfad: "Schablonen", typ: "ordner" }))).status, 403);
  assert.equal((await fehler(() => v.verschieben({ pfad: "Schablonen", typ: "ordner", ziel: "10" }))).status, 403);
  const r = await v.umbenennen({ pfad: "Schablonen/Besprechung.md", titel: "Sitzung", dateiname: "Sitzung.md" });
  assert.equal(r.ok, true); assert.ok(existsSync(`${d}/Schablonen/Sitzung.md`));
  // der Tagesnotiz-Ordner ist App-Einstellung und nicht fest: der Server lässt ihn zu (das Studio fragt vorher und zieht die Einstellung mit)
  const t = await v.umbenennen({ pfad: "Tagebuch", typ: "ordner", name: "Journal" });
  assert.equal(t.ok, true); assert.ok(existsSync(`${d}/Journal/2026-11-05.md`));
});
