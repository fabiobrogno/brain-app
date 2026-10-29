// tageslauf/einordnen.mjs — Schritt 3 (0 Tokens, Spec §5.2/K9): Zielseite je Vorschlag. Reihenfolge: Alias
// (.logs/aliasse.json, genau eine Seite) → BM25 über Titel, name, description, fragen, auch_genannt der Wiki-Seiten,
// nur über MIN_GUETE und mit Abstand ABSTAND zum Zweiten (sonst lieber warten). `stand` → Projektseite, deren
// repo/pfade zum quelle_ordner passt. MIN_GUETE wird im Probelauf (Task 15) am echten Bestand geprüft.
// Bei `mehrdeutig` liefert einordnen zusätzlich `kandidaten: [{ seite, guete }]` — die bis zu MAX_KANDIDATEN (5, früher 3: im Probelauf fehlte die passende Seite oft)
// besten Treffer der Suche, die mindestens MIN_KANDIDAT_ANTEIL der Güte von Platz 1 haben. Die Suchanfrage ist Titel + Text des Vorschlags (nicht nur der Titel); die Karten
// tragen Namen, Überschrift, auch_genannt, description und fragen der Seite. Ist unter diesen Top N IRGENDEINE kritische Seite (auch auf Platz 2 bis N), gibt es
// keine Wahl: `kandidaten: []` und `detail: "kritisch-unter-kandidaten"` (Opus-Review B2, Befund #4) — sonst könnte Haiku unter den schwächeren
// Seiten wählen und die Kritisch-Sperre umgehen, obwohl der Fakt vielleicht zur kritischen Seite gehört. Der Tageslauf lässt Haiku unter den
// Kandidaten wählen (abgleich.mjs#waehleSeite); einordnen selbst wählt nie.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { walk } from "../vault-dateien.mjs";
import { ordner, entferneBom } from "../pfade.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { leseSeitenFelder } from "../seitenfelder.mjs";
import { findeProjektseite, gitWurzel } from "../projekt.mjs";
import { leseFm } from "./bestand.mjs";

export const MIN_GUETE = 6, ABSTAND = 1.25, MAX_KANDIDATEN = 5;
// Mindestgüte eines Kandidaten im Verhältnis zu Platz 1: ein deutlich schwächerer Treffer ist kein ernsthafter Ort für den Fakt und soll Haiku
// nicht zu einer Wahl verleiten. 0,8 = 1/ABSTAND: Platz 2 erfüllt das im Mehrdeutig-Fall immer, die Grenze trifft also den dritten Treffer.
// Weniger als 2 Kandidaten → keine Wahl. Am echten Bestand im nächsten Probelauf prüfen (probe-aktionen.jsonl: `kandidaten`).
export const MIN_KANDIDAT_ANTEIL = 0.8;
const fwd = (p) => String(p).split("\\").join("/");
const woerter = (t) => String(t).normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const liste = (w) => (Array.isArray(w) ? w : w ? [w] : []).map(String);

export function seitenKarten(vault) {
  const wiki = ordner(vault).wiki;
  const out = [];
  for (const f of walk(vault)) {
    const rel = fwd(f.rel);
    if (!rel.startsWith(`${wiki}/`) || !istWikiSeite(rel, wiki)) continue;
    let text;
    try { text = entferneBom(readFileSync(f.full, "utf8")); } catch { continue; }
    const { fm, rumpf } = leseFm(text);
    const h1 = (rumpf.match(/^# (.+)$/m) || [, ""])[1];
    const namen = [fm.name, h1, ...liste(fm.auch_genannt)].filter(Boolean).map(String);
    const tokens = woerter([...namen, String(fm.description || ""), ...liste(fm.fragen)].join(" "));
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    // kritisch fail-safe wie in B1 (seitenfelder.mjs): jeder Wert außer false gilt als kritisch — nie nur das Literal true.
    out.push({ seite: rel, kritisch: leseSeitenFelder(text).kritisch, namen, tf, laenge: tokens.length });
  }
  return out;
}

// Liest .logs/aliasse.json im Format von brain-index (aliasse.mjs#aliasIndex: {version, seiten: {id: [alias]}, namen:
// {name: [id]}}) und, für ältere Stände, das flache {alias: seite}. Nur ausdrückliche Aliasse (auch_genannt), die auf
// genau EINE Seite zeigen — mehrdeutige Namen ordnen nichts zu (lieber Suche/Warten als falsche Seite).
export function ladeAliasse(vault) {
  try {
    const j = JSON.parse(readFileSync(`${vault}/.logs/aliasse.json`, "utf8"));
    if (j && typeof j === "object" && j.version && j.namen && typeof j.namen === "object") {
      const seiten = j.seiten && typeof j.seiten === "object" ? j.seiten : {};
      return Object.entries(j.namen)
        .filter(([a, ids]) => a && Array.isArray(ids) && ids.length === 1 && (seiten[ids[0]] || []).includes(a))
        .map(([a, ids]) => [a.toLowerCase(), ids[0]]);
    }
    return Object.entries(j).filter(([a, s]) => a && typeof s === "string").map(([a, s]) => [a.toLowerCase(), s]);
  } catch { return []; }
}
// Seite zu einem Namen: voller vault-relativer Pfad, Pfad im Wiki, oder Dateiname (mit oder ohne .md).
export function seiteZu(karten, name) {
  const n = fwd(name).replace(/\.md$/, "") + ".md";
  return karten.find((k) => k.seite === n) || karten.find((k) => k.seite.endsWith(`/${n}`))
    || karten.find((k) => basename(k.seite) === basename(n)) || null;
}

export function bm25(karten, frage) {
  const q = [...new Set(woerter(frage))];
  if (!q.length || !karten.length) return [];
  const N = karten.length, avg = karten.reduce((s, k) => s + k.laenge, 0) / N || 1;
  const df = new Map(q.map((w) => [w, karten.filter((k) => k.tf.has(w)).length]));
  return karten.map((k) => {
    let s = 0;
    for (const w of q) {
      const f = k.tf.get(w) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * k.laenge) / avg));
    }
    return { seite: k.seite, guete: s, karte: k };
  }).filter((t) => t.guete > 0).sort((a, b) => b.guete - a.guete);
}

export function einordnen(vault, v, { karten, aliasse = [], minGuete = MIN_GUETE, minKandidatAnteil = MIN_KANDIDAT_ANTEIL }) {
  if (v.art === "stand") {
    const wurzel = gitWurzel(v.quelleOrdner);
    const rel = wurzel ? findeProjektseite(vault, ordner(vault).wiki, [wurzel]) : null;
    const k = rel ? karten.find((x) => x.seite === fwd(rel)) : null;
    return k ? { seite: k.seite, kritisch: k.kritisch, wie: "projekt" } : { seite: null, grund: "keine-projektseite" };
  }
  const text = `${v.titel} ${v.text}`;
  const tokens = new Set(woerter(text));
  const perAlias = new Set();
  for (const [alias, s] of aliasse) {
    const w = woerter(alias);
    if (w.length && w.every((x) => tokens.has(x))) { const k = seiteZu(karten, s); if (k) perAlias.add(k); }
  }
  if (perAlias.size === 1) { const [k] = perAlias; return { seite: k.seite, kritisch: k.kritisch, wie: "alias" }; }
  const t = bm25(karten, text);
  if (!t.length || t[0].guete < minGuete) return { seite: null, grund: "keine-seite", guete: t[0]?.guete ?? 0 };
  if (t[1] && t[0].guete < ABSTAND * t[1].guete) {
    const top = t.slice(0, MAX_KANDIDATEN);
    if (top.some((x) => x.karte.kritisch)) return { seite: null, grund: "mehrdeutig", guete: t[0].guete, kandidaten: [], detail: "kritisch-unter-kandidaten" };
    const kandidaten = top.filter((x) => x.guete >= minKandidatAnteil * t[0].guete).map((x) => ({ seite: x.seite, guete: x.guete }));
    return { seite: null, grund: "mehrdeutig", guete: t[0].guete, kandidaten };
  }
  return { seite: t[0].seite, kritisch: t[0].karte.kritisch, wie: "suche", guete: t[0].guete };
}
