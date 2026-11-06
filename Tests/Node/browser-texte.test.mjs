// „Kortex im Browser“ (läuft auch unter Windows und Linux): Einrichtung und Einstellungen sagen dort nie „Mac“, „Finder“, „Apple“ oder „macOS“; die App behält ihre Wörter.
import test from "node:test";
import assert from "node:assert/strict";
import { pfad } from "./hilfe.mjs";

const MAC = /\bMacs?\b|macOS|Finder|Apple|LaunchAgents/;
const UNBERUEHRT = new Set(["id", "schluessel", "woerter", "art", "sonder"]);
const MODULE = [["texte-einrichtung.js", ["TE"]], ["texte-einstellungen.js", ["BEREICHE", "TE"]], ["texte-ki-einstellungen.js", ["TKE"]], ["texte-konten.js", ["TK"]], ["texte-ki-verbinden.js", ["TKV"]]];
const BEISPIELE = [[], ["Beispiel"], [2], [1, 3], ["a", "b"], [{}]];

function sammle(x, schluessel, aus, wo) {
  if (typeof x === "string") { if (!UNBERUEHRT.has(schluessel)) aus.push([wo, x]); return; }
  if (typeof x === "function") { for (const a of BEISPIELE) { let r; try { r = x(...a); } catch { continue; } sammle(r, schluessel, aus, `${wo}()`); } return; }
  if (Array.isArray(x)) { x.forEach((e, i) => sammle(e, schluessel, aus, `${wo}[${i}]`)); return; }
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) sammle(v, k, aus, `${wo}.${k}`);
}
const texte = async (m, namen, q) => { const mod = await import(`${pfad("studio", m)}?${q}`); return namen.map((n) => [n, mod[n]]); };

test("Browser-Modus: kein Text in Einrichtung und Einstellungen nennt Mac, Finder, Apple oder macOS", async () => {
  globalThis.window = { kortexHuelle: {} };
  try {
    const rest = [];
    for (const [m, namen] of MODULE) for (const [n, wert] of await texte(m, namen, "browser")) {
      const aus = []; sammle(wert, n, aus, `${m}:${n}`);
      assert.ok(aus.length > 5, `${m}:${n} hat Texte`);
      for (const [wo, t] of aus) if (MAC.test(t)) rest.push(`${wo}: ${t.slice(0, 80)}`);
    }
    assert.deepEqual(rest, []);
    const einst = (await texte("texte-einstellungen.js", ["TE"], "browser"))[0][1];
    assert.equal(einst.imFinderZeigen, "Im Dateimanager zeigen");
    assert.equal(einst.imFinder, "Im Dateimanager");
    assert.equal(einst.vaultNurMac, "Nur auf diesem Rechner");
  } finally { delete globalThis.window; }
});

test("App-Modus: die Wörter bleiben, die Objekte sind dieselben", async () => {
  const einst = (await texte("texte-einstellungen.js", ["TE"], "app"))[0][1];
  assert.equal(einst.imFinderZeigen, "Im Finder zeigen");
  assert.equal(einst.vaultNurMac, "Nur auf diesem Mac");
  const { plattformTexte } = await import(pfad("studio", "plattform-texte.js"));
  const x = { a: "Im Finder" };
  assert.equal(plattformTexte(x, { browser: false }), x);
  assert.equal(plattformTexte(x, { browser: true }).a, "Im Dateimanager");
  // die App erkennt sich an der Brücke, auch wenn die Browser-Hülle fehlt
  globalThis.window = { kortexHuelle: {}, webkit: { messageHandlers: { aktion: {} } } };
  try { assert.equal((await texte("texte-einstellungen.js", ["TE"], "app-mit-huelle"))[0][1].imFinder, "Im Finder"); } finally { delete globalThis.window; }
});
