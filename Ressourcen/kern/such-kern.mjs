// Kern der Hinweis-Suche mit Reranker — Store, Reranker und wiki-map injiziert (testbar, im Dienst wiederverwendet).
// Kartentexte werden je Anfrage frisch gelesen (klein; ein Ingest baut sie neu).
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { decide } from "./hint-core.mjs";

const ohneSchema = (f) => String(f).replace(/^qmd:\/\/[^/]+\//, "");

// Karte zu einem QMD-Treffer: wiki-map kennt den handelisierten Namen → Wiki-Seite; die Karte heißt wie deren Basename
function kartenText(file, map, kartenDir) {
  const seite = map.paths?.[ohneSchema(file)];
  if (!seite) return null;
  try { return readFileSync(join(kartenDir, basename(seite)), "utf8"); } catch { return null; }
}

// QMD (2.5, store.js searchVec) holt k = 3×limit nächste Abschnitte über ALLE Sammlungen und filtert ERST DANACH nach
// Sammlung. Karteikarten sind nur ein kleiner Teil der Vektoren (22.10.: 69 von 8371 — der Rest Vault-Abschnitte und
// verwaiste Vektoren alter Fassungen, die `qmd update` nie löscht). Mit limit 20 (k = 60) blieb so bei ~40 % der Fragen
// keine einzige Karte übrig → leere Antwort, kein Hinweis (Log: weg=dienst-vektor top=0.000). Darum mit dem größten
// Fenster fragen, das sqlite-vec erlaubt (k ≤ 4096 → limit ≤ 1365), und selbst auf limit kürzen; die Karten-Treffer
// bleiben nach Score sortiert. Wirft QMD beim weiten Fenster (andere k-Grenze/anderer Faktor) → altes Verhalten.
export const KARTEN_FENSTER = 1365;
export async function kartenVektor(store, query, { limit = 20, collection = "brainkarten" } = {}) {
  let r;
  try { r = await store.searchVector(query, { limit: Math.max(limit, KARTEN_FENSTER), collection }); }
  catch { r = await store.searchVector(query, { limit, collection }); }
  return (Array.isArray(r) ? r : []).slice(0, limit);
}

export async function sucheMitRerank({ query, store, reranker, kartenDir, map, limit = 20, top = 3 }) {
  const r = (await kartenVektor(store, query, { limit, collection: "brainkarten" })).map(x => ({ file: x.filepath, score: x.score, rr: null }));
  const docs = [];
  for (const x of r.slice(0, top)) { const text = kartenText(x.file, map, kartenDir); if (text) docs.push({ file: x.file, text }); }
  if (docs.length) {
    try { for (const s of await reranker(query, docs)) { const t = r.find(x => x.file === s.file); if (t) t.rr = s.score; } }
    catch { /* Reranker gescheitert → rr bleibt null, Aufrufer entscheidet über Vektor-Scores */ }
  }
  return r;
}

export function entscheide(results, map, seen, { rerankSchwelle, max = 2 }) {
  const ok = results.filter(x => typeof x.rr === "number" && x.rr >= rerankSchwelle).sort((a, b) => b.rr - a.rr);
  return decide(ok.map(x => ({ file: x.file, score: x.rr })), map, seen, { schwelle: 0, max });
}
