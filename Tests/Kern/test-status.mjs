// brain status: Gesamtzustand für die Menüleiste der App — schreibt nur abgeleitete Caches (git-ignoriert,
// z. B. .logs/pflege-bericht.json), nie Wissen; 0 Tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { brainStatus, bewerte, statusText } from "../status.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
function vault({ mitWerkzeug = true } = {}) {
  const v = mkdtempSync(join(tmpdir(), "status-"));
  cpSync(join(HIER, "fixture"), v, { recursive: true });
  if (mitWerkzeug) { mkdirSync(join(v, ".tools"), { recursive: true }); writeFileSync(join(v, ".tools", "brain.mjs"), "// stub\n"); }
  process.on("exit", () => rmSync(v, { recursive: true, force: true }));
  return v;
}

test("bewerte: Fehler schlägt alles, Arbeit ergibt Hinweis, sonst ok", () => {
  assert.equal(bewerte({ fehler: true, berichtFehlt: false, zuTun: 0, vorschlaege: 0 }), "problem");
  assert.equal(bewerte({ fehler: false, berichtFehlt: false, zuTun: 2, vorschlaege: 0 }), "hinweis");
  assert.equal(bewerte({ fehler: false, berichtFehlt: false, zuTun: 0, vorschlaege: 1 }), "hinweis");
  assert.equal(bewerte({ fehler: false, berichtFehlt: true, zuTun: 0, vorschlaege: 0 }), "hinweis");
  assert.equal(bewerte({ fehler: false, berichtFehlt: false, zuTun: 0, vorschlaege: 0 }), "ok");
});

test("brainStatus: Form stimmt für ein normales Brain", async () => {
  const s = await brainStatus(vault());
  assert.match(s.version, /^\d+\.\d+\.\d+/);
  assert.equal(s.quellVault, false);
  assert.ok(["ok", "hinweis"].includes(s.zustand), s.zustand);
  for (const k of ["vorschlaege", "konflikte", "abgelaufen", "zuTun"]) assert.equal(typeof s.zahlen[k], "number", k);
  assert.ok(Array.isArray(s.meldungen));
});

test("brainStatus: beschädigte brain.config.json → problem mit Alltags-Meldung", async () => {
  const v = vault();
  writeFileSync(join(v, "brain.config.json"), "{ kaputt");
  const s = await brainStatus(v);
  assert.equal(s.zustand, "problem");
  assert.ok(s.meldungen.some((m) => m.includes("beschädigt")));
});

test("brainStatus: Ordner ohne Werkzeuge → problem", async () => {
  const s = await brainStatus(vault({ mitWerkzeug: false }));
  assert.equal(s.zustand, "problem");
  assert.ok(s.meldungen.some((m) => m.includes("kein Brain-Ordner")));
});

test("brainStatus: Quell-Vault wird erkannt", async () => {
  const v = vault();
  mkdirSync(join(v, ".tools", "kit"), { recursive: true });
  writeFileSync(join(v, ".tools", "kit", "export.mjs"), "// stub\n");
  assert.equal((await brainStatus(v)).quellVault, true);
});

test("statusText: Symbol und Zahlen", () => {
  const t = statusText({ version: "0.6.0", quellVault: true, zustand: "hinweis", meldungen: ["X"], zahlen: { vorschlaege: 2, konflikte: 1, abgelaufen: 0, zuTun: 3 } });
  assert.match(t, /^⚠ Brain 0\.6\.0 \(Entwickler-Brain\)/);
  assert.match(t, /Vorschläge: 2 · Konflikte: 1 · abgelaufen: 0 · zu tun: 3/);
});

test("CLI: brain status --json → genau eine JSON-Zeile, Exit 0", () => {
  const v = vault();
  const r = spawnSync(process.execPath, [join(HIER, "..", "brain.mjs"), "status", "--json"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  assert.equal(r.status, 0, r.stderr);
  const zeilen = r.stdout.trim().split("\n");
  assert.equal(zeilen.length, 1);
  assert.ok(["ok", "hinweis", "problem"].includes(JSON.parse(zeilen[0]).zustand));
});
