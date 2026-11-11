// Editor-Bündel (R4-2): codemirror.bundle.js lädt Sprach-Teile als eigene Dateien nach. Jede Datei, die das Bündel (rekursiv) einbindet, muss
// da sein, keine sprache-*.js darf verwaist liegen, und die Werkstatt muss jede als JavaScript mit CSP ausliefern (gemeinsamer statisch()-Weg aller Hüllen).
// Wichtig nach jedem Neubau des Bündels (z. B. beim Zusammenführen mit R4-4): `npm run bauen` in Werkzeuge/editor-bundle.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./hilfe.mjs";
import { pfad } from "./hilfe.mjs";

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const VENDOR = join(pfad("studio"), "vendor");

function verfolge() {
  const gesehen = new Set(), offen = ["codemirror.bundle.js"], fehlt = [];
  while (offen.length) {
    const f = offen.pop();
    if (gesehen.has(f)) continue;
    gesehen.add(f);
    if (!existsSync(join(VENDOR, f))) { fehlt.push(f); continue; }
    const text = readFileSync(join(VENDOR, f), "utf8");
    for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*)["']\.\/([^"']+\.js)["']/g)) offen.push(m[1]);
  }
  return { gesehen, fehlt };
}

test("Bündel: alle eingebundenen Dateien existieren, keine Sprach-Datei liegt verwaist", () => {
  const { gesehen, fehlt } = verfolge();
  assert.deepEqual(fehlt, [], "eingebundene, aber fehlende Dateien");
  const da = readdirSync(VENDOR).filter((n) => /^sprache-.+\.js$/.test(n));
  assert.ok(da.length >= 5, "Sprach-Dateien gefunden");
  assert.deepEqual(da.filter((n) => !gesehen.has(n)), [], "verwaiste sprache-*.js (alter Bau? `npm run bauen` löscht sie)");
});

test("Werkstatt liefert Bündel und alle Sprach-Teile als text/javascript mit CSP", async () => {
  const h = erzeugeHandler({ vault: tmp() });
  const { gesehen } = verfolge();
  for (const f of gesehen) {
    const r = await h({ methode: "GET", pfad: "/vendor/" + f, query: null });
    assert.equal(r.status, 200, f);
    assert.match(r.headers["Content-Type"], /^text\/javascript/, f);
    assert.match(r.headers["Content-Security-Policy"], /script-src 'self'/, f);
    assert.equal(r.headers["X-Content-Type-Options"], "nosniff", f);
  }
});
