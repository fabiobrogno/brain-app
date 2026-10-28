import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sucheMitRerank, entscheide } from "../such-kern.mjs";

const dir = mkdtempSync(join(tmpdir(), "karten-"));
writeFileSync(join(dir, "thema_a.md"), "# A\nasin sku"); writeFileSync(join(dir, "thema_x-y.md"), "# XY\npush release");
const map = { paths: { "thema-a.md": "09_wiki/f/thema_a.md", "thema-x-y.md": "09_wiki/f/thema_x-y.md" },
  pages: { "09_wiki/f/thema_a.md": { description: "A" }, "09_wiki/f/thema_x-y.md": { description: "XY" } }, bySource: {} };
const store = { searchVector: async () => [
  { filepath: "qmd://brainkarten/thema-x-y.md", score: 0.42 }, { filepath: "qmd://brainkarten/thema-a.md", score: 0.31 }, { filepath: "qmd://brainkarten/unbekannt.md", score: 0.2 } ] };
const reranker = async (q, docs) => docs.map(d => ({ file: d.file, score: d.text.includes("asin") ? 0.73 : 0.5 }));

test("sucheMitRerank: Top-3 über wiki-map aufgelöst (auch Bindestrich-Namen), unbekannte Karte → rr null", async () => {
  const r = await sucheMitRerank({ query: "join asin", store, reranker, kartenDir: dir, map });
  assert.deepEqual(r.map(x => [x.file.split("/").pop(), x.rr]), [["thema-x-y.md", 0.5], ["thema-a.md", 0.73], ["unbekannt.md", null]]);
});
test("sucheMitRerank: Reranker wirft → alle rr null, Vektor-Scores bleiben", async () => {
  const r = await sucheMitRerank({ query: "x", store, reranker: async () => { throw new Error("kaputt"); }, kartenDir: dir, map });
  assert.ok(r.every(x => x.rr === null) && r[0].score === 0.42);
});
test("entscheide: nur rr ≥ Schwelle, sortiert nach rr, Vektor-Score egal", () => {
  const res = [{ file: "qmd://brainkarten/thema-x-y.md", score: 0.42, rr: 0.5 }, { file: "qmd://brainkarten/thema-a.md", score: 0.31, rr: 0.73 }];
  assert.deepEqual(entscheide(res, map, new Set(), { rerankSchwelle: 0.55, max: 2 }).map(h => h.page), ["09_wiki/f/thema_a.md"]);
  assert.deepEqual(entscheide(res, map, new Set(["09_wiki/f/thema_a.md"]), { rerankSchwelle: 0.55, max: 2 }), []);
});

// Nachbau von QMD 2.5 searchVec (store.js searchVec): k = 3×limit nächste Abschnitte über ALLE Sammlungen
// (sqlite-vec erlaubt k ≤ 4096), erst DANACH nach Sammlung filtern und auf limit kürzen. Echter Befund 22.10.:
// 8371 Vektoren, davon 69 Karten und 6541 verwaiste alter Fassungen — bei limit 20 (k = 60) blieb oft keine Karte
// übrig → Dienst antwortet ok mit [] → Hook loggt weg=dienst-vektor top=0.000 hits=- (716×, nie ein Treffer).
const qmdWieEcht = (alle, kMax = 4096) => ({ aufrufe: [], async searchVector(q, { limit = 20, collection } = {}) {
  this.aufrufe.push(limit);
  if (limit * 3 > kMax) throw new Error(`k value in knn query too large, provided ${limit * 3} and the limit is ${kMax}`);
  return alle.slice(0, limit * 3).filter(x => !collection || x.filepath.startsWith(`qmd://${collection}/`)).slice(0, limit);
} });
const fremd = Array.from({ length: 200 }, (_, i) => ({ filepath: `qmd://brain/00-inbox/vorschlag-${i}.md`, score: 0.7 - i / 1000 }));
const gedraengt = [...fremd, { filepath: "qmd://brainkarten/thema-a.md", score: 0.47 }, { filepath: "qmd://brainkarten/thema-x-y.md", score: 0.43 }];

test("sucheMitRerank: Karten hinter >60 näheren Fremd-Abschnitten (QMD filtert erst nach k=3×limit) → trotzdem gefunden und gererankt", async () => {
  const r = await sucheMitRerank({ query: "join asin", store: qmdWieEcht(gedraengt), reranker, kartenDir: dir, map, limit: 20, top: 3 });
  assert.deepEqual(r.map(x => [x.file.split("/").pop(), x.score, x.rr]), [["thema-a.md", 0.47, 0.73], ["thema-x-y.md", 0.43, 0.5]]);
});
test("sucheMitRerank: Ergebnis bleibt auf limit gekürzt, auch wenn das weite Fenster mehr Karten liefert", async () => {
  const viele = Array.from({ length: 30 }, (_, i) => ({ filepath: `qmd://brainkarten/k${i}.md`, score: 0.6 - i / 100 }));
  const r = await sucheMitRerank({ query: "x", store: qmdWieEcht([...fremd, ...viele]), reranker, kartenDir: dir, map, limit: 5, top: 3 });
  assert.equal(r.length, 5);
  assert.deepEqual(r.map(x => x.file), viele.slice(0, 5).map(x => x.filepath));
});
test("sucheMitRerank: QMD mit kleinerer k-Grenze (weites Fenster wirft) → Rückfall auf limit, kein Absturz", async () => {
  const store = qmdWieEcht(gedraengt.slice(150), 120);
  const r = await sucheMitRerank({ query: "x", store, reranker, kartenDir: dir, map, limit: 20, top: 3 });
  assert.equal(store.aufrufe.at(-1), 20);
  assert.deepEqual(r.map(x => x.file.split("/").pop()), ["thema-a.md", "thema-x-y.md"]);
});
