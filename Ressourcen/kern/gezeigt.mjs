// .tools/gezeigt.mjs — je Sitzung gemerkt, was schon eingespielt wurde (Steckbrief, Regeln, geprüfte Repos), damit
// nichts doppelt in den Kontext kommt (K2/K14). Datei .logs/gezeigt/<sid>.txt, eine Zeile je Schlüssel; nur die eigene
// Sitzung schreibt ihre Datei. Wirft nie.
import { readFileSync, appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ordnerVon = (vault) => join(vault, ".logs", "gezeigt");
const sauber = (sid) => String(sid || "").replace(/[^\w-]/g, "").slice(0, 64);

export function gezeigtListe(vault, sid) {
  const s = sauber(sid);
  if (!s) return new Set();
  try { return new Set(readFileSync(join(ordnerVon(vault), `${s}.txt`), "utf8").split("\n").filter(Boolean)); }
  catch { return new Set(); }
}
export function merkeGezeigt(vault, sid, ...schluessel) {
  const s = sauber(sid);
  if (!s || !schluessel.length) return;
  try {
    mkdirSync(ordnerVon(vault), { recursive: true });
    appendFileSync(join(ordnerVon(vault), `${s}.txt`), schluessel.map((k) => String(k).replace(/[\r\n]+/g, " ")).join("\n") + "\n");
  } catch {}
}
export function raeumeGezeigtAuf(vault, jetzt = Date.now(), maxMs = 2 * 86400000) {
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)); } catch { return; }
  for (const n of namen) {
    const p = join(ordnerVon(vault), n);
    try { if (jetzt - statSync(p).mtimeMs > maxMs) unlinkSync(p); } catch {}
  }
}
