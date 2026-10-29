// regeln.mjs — K2 „Regeln am Read" (Spec §12.2): Beim Lesen einer Datei die dafür passenden Lektionen aus
// <wiki>/_lektionen.md wörtlich einspielen. Eine Lektion gilt für eine Datei, wenn eines ihrer Muster aus der Folgezeile
// „  Gilt für: `muster`, …" passt (Glob: `*` innerhalb eines Ordners, `**` über Ordner, `?` ein Zeichen, `~/` = Home;
// ohne führendes `/` passt das Muster auf das Pfadende). Am besten passende zuerst (spezifischstes Muster = meiste feste
// Zeichen); passt das Budget nicht, fallen ganze Regeln weg, nie wird eine gekürzt. Regeln mit Zugangsdaten werden nie
// eingespielt. 0 Tokens, nur Dateisystem. Wirft nie.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { entferneBom, ordner } from "./pfade.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";

export const REGEL_BUDGET = 1200;
const GILT_FUER = /^\s+Gilt für:\s*(.*)$/u;
const fwd = (p) => String(p).split("\\").join("/");

export function leseLektionen(vault, wikiOrdner = ordner(vault).wiki) {
  let text = "";
  try { text = entferneBom(readFileSync(join(vault, wikiOrdner, "_lektionen.md"), "utf8")).replace(/\r\n/g, "\n"); } catch { return []; }
  const out = [];
  let akt = null;
  const abschliessen = () => {
    if (akt?.muster.length) {
      const t = akt.zeilen.join("\n");
      out.push({ id: createHash("sha1").update(t).digest("hex").slice(0, 12), text: t, muster: akt.muster });
    }
    akt = null;
  };
  for (const z of text.split("\n")) {
    if (z.startsWith("- **")) { abschliessen(); akt = { zeilen: [z.trimEnd()], muster: [] }; continue; }
    if (akt && /^\s+\S/.test(z)) {
      const g = GILT_FUER.exec(z);
      if (g) akt.muster.push(...[...g[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean));
      else akt.zeilen.push(z.trimEnd());
      continue;
    }
    abschliessen();
  }
  abschliessen();
  return out;
}

export function musterZuRegex(muster, home = homedir()) {
  let m = fwd(String(muster).trim());
  if (m === "~" || m.startsWith("~/")) m = fwd(home).replace(/\/+$/, "") + m.slice(1);
  const absolut = m.startsWith("/") || /^[A-Za-z]:\//.test(m);
  let re = "";
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === "*" && m[i + 1] === "*") {
      if (m[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${absolut ? "^" : "(?:^|/)"}${re}$`, "u");
}
export const spezifitaet = (muster) => String(muster).replace(/[*?]/g, "").length + 1;

export function regelnFuer(vault, datei, { gezeigt = new Set(), max = REGEL_BUDGET, home = homedir(), cwd = "" } = {}) {
  const leer = { text: "", ids: [] };
  if (typeof datei !== "string" || !datei) return leer;
  const pfad = fwd(resolve(cwd || process.cwd(), datei));
  const wiki = ordner(vault).wiki;
  const passend = [];
  for (const r of leseLektionen(vault, wiki)) {
    if (gezeigt.has(`regel:${r.id}`) || hatSecretsImKontext(r.text)) continue;
    let best = 0;
    for (const m of r.muster) { try { if (musterZuRegex(m, home).test(pfad)) best = Math.max(best, spezifitaet(m)); } catch {} }
    if (best) passend.push({ ...r, best });
  }
  if (!passend.length) return leer;
  passend.sort((a, b) => b.best - a.best);
  const quelle = `${wiki}/_lektionen.md`;
  const kopf = `Brain-Regeln für diese Datei (wörtlich aus ${quelle}):`;
  const hinweis = (n) => `(${n} weitere passende ${n === 1 ? "Regel" : "Regeln"} in ${quelle})`;
  const rest = max - kopf.length - hinweis(99).length - 2;
  const gewaehlt = [];
  let laenge = 0;
  for (const r of passend) {
    const l = r.text.length + (gewaehlt.length ? 1 : 0);
    if (laenge + l <= rest) { gewaehlt.push(r); laenge += l; }
  }
  if (!gewaehlt.length) return leer;
  const weg = passend.length - gewaehlt.length;
  return { text: [kopf, ...gewaehlt.map((r) => r.text), ...(weg ? [hinweis(weg)] : [])].join("\n"), ids: gewaehlt.map((r) => r.id) };
}

// B2: Allgemeine Lektionen (ohne „Gilt für"-Zeile) kommen beim Sitzungsstart als kurze Liste. Nur die Regelzeile
// („- **Titel** — Regel"), neueste zuerst (neue stehen in _lektionen.md unten), ganze Zeilen bis `max` Zeichen;
// Regeln mit Zugangsdaten nie. Wirft nie.
export function allgemeineLektionen(vault, { max = 600, wikiOrdner = ordner(vault).wiki } = {}) {
  let text = "";
  try { text = entferneBom(readFileSync(join(vault, wikiOrdner, "_lektionen.md"), "utf8")).replace(/\r\n/g, "\n"); } catch { return []; }
  const eintraege = [];
  let akt = null;
  for (const z of text.split("\n")) {
    if (z.startsWith("- **")) { if (akt) eintraege.push(akt); akt = { zeile: z.trimEnd(), gilt: false }; continue; }
    if (akt && /^\s+\S/.test(z)) { if (GILT_FUER.test(z)) akt.gilt = true; continue; }
    if (akt) { eintraege.push(akt); akt = null; }
  }
  if (akt) eintraege.push(akt);
  const out = [];
  let platz = max;
  for (const e of eintraege.filter((x) => !x.gilt).reverse()) {
    if (hatSecretsImKontext(e.zeile)) continue;
    if (e.zeile.length + 1 > platz) break;
    out.push(e.zeile);
    platz -= e.zeile.length + 1;
  }
  return out;
}
