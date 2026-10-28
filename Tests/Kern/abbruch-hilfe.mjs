// .tools/tests/abbruch-hilfe.mjs — Hilfen für Tests, in denen ein Tageslauf nach dem Merge hart stirbt (SIGKILL, kein finally):
// der Lauf selbst steckt in lauf-abbruch-kind.mjs. Nie echtes claude (BRAIN_CLAUDE zeigt auf fake-claude, das die Tests über fakeKi setzen).
import assert from "node:assert/strict";
import { existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";

const KIND = join(fileURLToPath(new URL(".", import.meta.url)), "lauf-abbruch-kind.mjs");

// Ein hart abgestürzter Lauf lässt seine Arbeitskopie liegen (gleiche Lauf-Nummer wegen festem JETZT) — darum je Test ein eigener Cache-Ordner.
export async function mitEigenemCache(f) {
  const alt = process.env.BRAIN_TAGESLAUF_CACHE;
  process.env.BRAIN_TAGESLAUF_CACHE = tempOrdner("caches-abbruch");
  try { return await f(); } finally { process.env.BRAIN_TAGESLAUF_CACHE = alt; }
}

// Startet einen scharfen Lauf in einem eigenen Prozess, der beim Verschieben des ersten übernommenen Vorschlags stirbt.
export function hartAbbrechen(vault) {
  const r = spawnSync(process.execPath, [KIND, vault, String(JETZT)], { env: process.env, encoding: "utf8", timeout: 120000 });
  assert.equal(r.signal, "SIGKILL", `der Hilfsprozess muss hart sterben: status ${r.status}, signal ${r.signal}\n${r.stdout}\n${r.stderr}`);
}

// Nach einem harten Abbruch bleibt die Ingest-Sperre liegen; sie verfällt nach 30 min — hier: 31 min später.
export function alteSperre(vault) {
  const f = join(vault, ".logs", "ingest.lock");
  assert.ok(existsSync(f), "die Sperre des abgestürzten Laufs liegt noch da");
  const alt = new Date(Date.now() - 31 * 60e3);
  utimesSync(f, alt, alt);
}
