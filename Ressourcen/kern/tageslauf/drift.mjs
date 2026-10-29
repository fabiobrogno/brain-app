// tageslauf/drift.mjs — K4 Drift-Liste (Spec §7.5, App-Spec K4). <wiki>/_ausgemustert.md nennt ausgemusterte Begriffe,
// je Zeile „- alter Begriff → neuer Begriff" (auch „->"; ein Zusatz in Klammern am Ende zählt nicht). Lint (DRIFT, nur melden)
// und der Tageslauf (Hinweis bei Vorschlägen) zeigen lebende Erwähnungen. Nicht gezählt: Frontmatter, Code-Blöcke und
// Inline-Code, Zitate (Zeilen mit „>"), durchgestrichener Text (~~…~~), reine Wikilink-Ziele ([[ziel]], der Anzeigetext
// [[ziel|Text]] zählt), Zeilen, die alt UND neu nennen („heißt jetzt Neu, früher Alt"), alles außerhalb der Wiki-Seiten
// (Rohquellen, Archiv, „_"-Dateien). Ganzes Wort, Groß/Klein egal. 0 Tokens, liest nur.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walk } from "../vault-dateien.mjs";
import { ordner, entferneBom } from "../pfade.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";

export const DRIFT_DATEI = "_ausgemustert.md";
const PFEIL = /^\s*[-*]\s+(.+?)\s*(?:→|->)\s*(.+?)\s*$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wort = (s) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(s)}(?![\\p{L}\\p{N}])`, "iu");
const saeubere = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").replace(/^["„“'»]+|["“”'«]+$/g, "").trim();
const fwd = (p) => String(p).split("\\").join("/");

// Zeilen ohne Frontmatter (Frontmatter-Zeilen → null, damit die Zeilennummern stimmen).
function zeilenOhneFm(text) {
  const z = entferneBom(String(text ?? "")).replace(/\r\n?/g, "\n").split("\n");
  if (z[0] === "---") { const e = z.indexOf("---", 1); if (e > 0) return z.map((x, i) => (i <= e ? null : x)); }
  return z;
}

// Prosa einer Zeile: ohne Durchgestrichenes, Inline-Code und Link-Ziele (Anzeigetext eines Links bleibt).
const prosa = (z) => z.replace(/~~[^~]*~~/g, " ").replace(/`[^`\n]*`/g, " ")
  .replace(/\[\[[^\]|]*(?:\|([^\]]*))?\]\]/g, (_, anzeige) => (anzeige ? ` ${anzeige} ` : " "));

export function leseDriftListe(text) {
  const eintraege = [], fehler = [];
  let zaun = false;
  zeilenOhneFm(text).forEach((z, i) => {
    if (z === null) return;
    if (/^\s*(```|~~~)/.test(z)) { zaun = !zaun; return; }
    if (zaun || !/^\s*[-*]\s+\S/.test(z)) return;
    const m = PFEIL.exec(z);
    const alt = m ? saeubere(m[1]) : "", neu = m ? saeubere(m[2]) : "";
    if (!alt || !neu || alt.length > 80 || neu.length > 80 || alt.toLowerCase() === neu.toLowerCase()) {
      fehler.push({ zeile: i + 1, text: z.trim().slice(0, 80) });
      return;
    }
    eintraege.push({ alt, neu, muster: wort(alt), neuMuster: wort(neu) });
  });
  return { eintraege, fehler };
}

export function driftFunde(text, eintraege) {
  const out = [];
  if (!eintraege?.length) return out;
  let zaun = false;
  zeilenOhneFm(text).forEach((z, i) => {
    if (z === null) return;
    if (/^\s*(```|~~~)/.test(z)) { zaun = !zaun; return; }
    if (zaun || /^\s*>/.test(z)) return;
    const t = prosa(z);
    for (const e of eintraege) if (e.muster.test(t) && !e.neuMuster.test(t)) out.push({ alt: e.alt, neu: e.neu, zeile: i + 1 });
  });
  return out;
}

export function ladeDriftListe(vault) {
  try { return { ...leseDriftListe(readFileSync(join(vault, ordner(vault).wiki, DRIFT_DATEI), "utf8")), da: true }; }
  catch { return { eintraege: [], fehler: [], da: false }; }
}

export function driftBefunde(vault, liste = ladeDriftListe(vault)) {
  const wiki = ordner(vault).wiki;
  const out = [];
  if (!liste.eintraege.length) return out;
  for (const f of walk(vault)) {
    const rel = fwd(f.rel);
    if (!istWikiSeite(rel, wiki)) continue;
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    const gesehen = new Set();
    for (const d of driftFunde(text, liste.eintraege)) {
      if (gesehen.has(d.alt)) continue;
      gesehen.add(d.alt);
      out.push({ seite: rel.slice(wiki.length + 1), alt: d.alt, neu: d.neu });
    }
  }
  return out;
}

// Lint-Zeilen ohne Zeilennummern (wie alle Lint-Befunde — der pre-commit vergleicht Befundzeilen mit HEAD).
export function driftLintZeilen(vault) {
  const liste = ladeDriftListe(vault);
  return [
    ...liste.fehler.map((f) => `DRIFT-LISTE: ${DRIFT_DATEI} — „${f.text}“ unlesbar (Format: - alter Begriff → neuer Begriff)`),
    ...driftBefunde(vault, liste).map((b) => `DRIFT: ${b.seite} — „${b.alt}“ ist ausgemustert → „${b.neu}“`),
  ];
}

export function vorschlagDrift(text, eintraege) {
  const d = driftFunde(String(text ?? ""), eintraege)[0];
  return d ? { alt: d.alt, neu: d.neu } : null;
}
