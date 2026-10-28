// .tools/projekt.mjs — Projekt-Bezug einer Sitzung oder Datei (0 Tokens, nur Dateisystem, kein git-Aufruf): Git-Wurzel
// und Projekt-Schlüssel (K11/K13), die Projektseite im Wiki (bis M2a in session-start.mjs) und der Projekt-Steckbrief
// (K14, Spec §12.2): feste Felder pruefen/ziel/fallen der Projektseite + Stack/Versionen frisch aus den Manifesten im
// Repo (nie gepflegt, immer aktuell). Alles wörtlich mit Quelle; Zeilen mit Zugangsdaten fallen weg; gekürzt wird nur
// in ganzen Zeilen.
import { existsSync, realpathSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname, resolve, sep, basename, relative } from "node:path";
import { entferneBom } from "./pfade.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { kuerze, ganzeZeilen } from "./verlauf.mjs";

// ---------- Git-Wurzel, Projekt-Schlüssel ----------

// Nächster Ordner aufwärts mit .git (Ordner oder Datei — Worktrees haben eine .git-Datei), kanonisch (Symlinks wie
// /var → /private/var aufgelöst). Ein nicht (mehr) existierender Pfad wird ab dem nächsten existierenden Vorfahren gesucht.
export function gitWurzel(start) {
  if (typeof start !== "string" || !start) return null;
  let dir = resolve(start);
  for (;;) {
    try { dir = realpathSync(dir); break; } catch {}
    const hoch = dirname(dir);
    if (hoch === dir) break;
    dir = hoch;
  }
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const hoch = dirname(dir);
    if (hoch === dir) return null;
    dir = hoch;
  }
}

// „Gleiches Projekt" (K13, Spec: nur gleiches Git-Repo bzw. gleicher Vault zählt): Git-Wurzel, sonst der Vault, wenn
// cwd darin liegt, sonst null (zählt nicht — z. B. Sitzungen direkt im Home-Ordner).
export function projektSchluessel(vault, cwd) {
  if (typeof cwd !== "string" || !cwd) return null;
  const w = gitWurzel(cwd);
  if (w) return w;
  const echt = (p) => { try { return realpathSync(resolve(p)); } catch { return resolve(p); } };
  const v = echt(vault), c = echt(cwd);
  return c === v || c.startsWith(v + sep) ? v : null;
}

// ---------- Projektseite (aus session-start.mjs hierher verschoben, Verhalten unverändert) ----------

const ohneQuotes = (s) => String(s).trim().replace(/^["']|["']$/g, "").trim();
// Werte eines Frontmatter-Schlüssels: „k: wert", „k: [a, b]" oder „k:" mit „- a"-Zeilen darunter.
export function fmWerte(text, schluessel) {
  const t = entferneBom(text);
  if (!/^---\r?\n/.test(t)) return [];
  const zeilen = t.split(/\r?\n/), out = [];
  let aktiv = false;
  for (let i = 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.trim() === "---") break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(z);
    if (m) {
      aktiv = schluessel.includes(m[1]);
      const w = m[2].trim();
      if (aktiv && w) out.push(...(w.startsWith("[") ? w.replace(/^\[|\]$/g, "").split(",") : [w]).map(ohneQuotes).filter(Boolean));
      continue;
    }
    const l = /^\s*-\s+(.*)$/.exec(z);
    if (aktiv && l) out.push(ohneQuotes(l[1]));
    else if (z.trim()) aktiv = false;
  }
  return out;
}
export const basisName = (p) => String(p).split("\\").join("/").replace(/\/+$/, "").split("/").pop().replace(/\.git$/i, "").toLowerCase();
const normSeite = (s) => String(s).toLowerCase().replace(/\.md$/, "").replace(/^(thema|entitaet|quelle)_/, "").replace(/[\s_]+/g, "-");
export function dateiKopf(datei, max = 4096) {
  const fd = openSync(datei, "r");
  try { const b = Buffer.alloc(max); const n = readSync(fd, b, 0, max, 0); return b.subarray(0, n).toString("utf8"); }
  finally { closeSync(fd); }
}
// Wiki-Seiten (ohne generierte/Schema-Dateien „_…" und ohne ich.md), absolute Pfade.
function wikiSeiten(vault, wikiOrdner) {
  const out = [];
  const lauf = (dir) => {
    let eintraege; try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) lauf(full);
      else if (e.isFile() && e.name.endsWith(".md") && e.name !== "ich.md") out.push(full);
    }
  };
  lauf(join(vault, wikiOrdner));
  return out;
}
// Genau eine passende Wiki-Seite für die Namen (Ordnername/Repo-Name) — sonst null. Vault-relativ mit „/".
export function findeProjektseite(vault, wikiOrdner, namen) {
  const ziele = new Set([...namen].filter(Boolean).map(basisName));
  if (!ziele.size) return null;
  const seiten = wikiSeiten(vault, wikiOrdner);
  const perFm = [], perName = [];
  const zieleNorm = new Set([...ziele].map(normSeite));
  for (const f of seiten) {
    let werte = [];
    try { werte = fmWerte(dateiKopf(f), ["repo", "pfade"]); } catch {}
    if (werte.some((w) => ziele.has(basisName(w)))) perFm.push(f);
    else if (zieleNorm.has(normSeite(basename(f)))) perName.push(f);
  }
  const treffer = perFm.length ? perFm : perName;
  return treffer.length === 1 ? relative(vault, treffer[0]).split("\\").join("/") : null;
}

// ---------- K14: Steckbrief ----------

function fmBlock(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entferneBom(String(text)));
  return m ? m[1] : "";
}
// Liste aus dem Frontmatter: bevorzugt JSON (`k: ["a", "b, mit Komma"]`, wie quellen/fragen), sonst fmWerte.
export function fmListe(text, schluessel) {
  const m = new RegExp(`^${schluessel}:\\s*(\\[.*\\])\\s*$`, "m").exec(fmBlock(text));
  if (m) {
    try {
      const a = JSON.parse(m[1]);
      if (Array.isArray(a)) return a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
    } catch {}
  }
  return fmWerte(text, [schluessel]);
}
// Projektseite = repo:/pfade: im Frontmatter oder typ: entitaet im Bereich projekte/ (relImWiki relativ zum Wiki-Ordner).
export function istProjektseite(relImWiki, fm) {
  const rel = String(relImWiki).split("\\").join("/");
  return /^(repo|pfade):/m.test(fm) || (rel.startsWith("projekte/") && /^typ:\s*entitaet\s*$/m.test(fm));
}

export const MANIFESTE = ["package.json", "Package.swift", "go.mod", "pyproject.toml", "Cargo.toml"];
const MAX_MANIFEST = 64 * 1024;
function tomlAbschnitt(t, abschnitt, schluessel) {
  const out = [];
  let drin = false;
  for (const z of t.split(/\r?\n/)) {
    const k = /^\s*\[([^\]]+)\]\s*$/.exec(z);
    if (k) { drin = k[1].trim() === abschnitt; continue; }
    if (!drin) continue;
    const m = /^\s*([\w-]+)\s*=\s*"([^"]*)"/.exec(z);
    if (m && schluessel.includes(m[1])) out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}
const LESER = {
  "package.json": (t) => {
    let j;
    try { j = JSON.parse(t); } catch { return []; }
    if (!j || typeof j !== "object") return [];
    const a = [];
    if (typeof j.name === "string") a.push(`${j.name}${typeof j.version === "string" ? ` ${j.version}` : ""}`);
    if (j.engines && typeof j.engines === "object") for (const [k, v] of Object.entries(j.engines)) a.push(`engines.${k} ${v}`);
    if (typeof j.packageManager === "string") a.push(`packageManager ${j.packageManager}`);
    const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
    const namen = Object.keys(deps);
    if (namen.length) a.push(`Abhängigkeiten: ${namen.slice(0, 8).map((k) => `${k} ${deps[k]}`).join(", ")}${namen.length > 8 ? ` (+${namen.length - 8})` : ""}`);
    return a;
  },
  "Package.swift": (t) => {
    const a = [];
    const v = /^\/\/\s*swift-tools-version:\s*([\w.]+)/m.exec(t);
    if (v) a.push(`swift-tools-version ${v[1]}`);
    const p = /platforms:\s*\[([^\]]*)\]/m.exec(t);
    if (p) a.push(`platforms ${p[1].replace(/\s+/g, " ").trim()}`);
    return a;
  },
  "go.mod": (t) => {
    const a = [];
    const m = /^module\s+(\S+)/m.exec(t);
    if (m) a.push(`module ${m[1]}`);
    const g = /^go\s+(\S+)/m.exec(t);
    if (g) a.push(`go ${g[1]}`);
    return a;
  },
  "pyproject.toml": (t) => tomlAbschnitt(t, "project", ["name", "version", "requires-python"]),
  "Cargo.toml": (t) => tomlAbschnitt(t, "package", ["name", "version", "edition", "rust-version"]),
};
// Stack/Versionen wörtlich aus den Manifesten in der Repo-Wurzel (nur Wurzel, je Datei ≤ 64 KB). Kaputtes → still weg.
export function stackAusManifesten(wurzel) {
  const out = [];
  for (const datei of MANIFESTE) {
    let t;
    try {
      const p = join(wurzel, datei);
      if (statSync(p).size > MAX_MANIFEST) continue;
      t = entferneBom(readFileSync(p, "utf8"));
    } catch { continue; }
    const angaben = LESER[datei](t).filter(Boolean).map((a) => kuerze(a, 200));
    if (angaben.length) out.push({ datei, angaben });
  }
  return out;
}

export const STECKBRIEF_MAX = 1200;
// Rangfolge: Prüfen, Ziel, Fallen, Stack. Passt eine Zeile nicht mehr, fällt sie ganz weg (Hinweis mit Quelle).
export function steckbrief(vault, seiteRel, { wurzel = null, max = STECKBRIEF_MAX } = {}) {
  let text = "";
  try { text = dateiKopf(join(vault, seiteRel), 16384); } catch { return ""; }
  const zeilen = [];
  const pruefen = fmListe(text, "pruefen"), ziel = fmListe(text, "ziel"), fallen = fmListe(text, "fallen");
  if (pruefen.length) zeilen.push(`- Prüfen: ${pruefen.map((p) => `\`${p}\``).join(" · ")}`);
  if (ziel.length) zeilen.push(`- Ziel: ${ziel.join(" · ")}`);
  for (const f of fallen) zeilen.push(`- Falle: ${f}`);
  if (wurzel) for (const s of stackAusManifesten(wurzel)) zeilen.push(`- Stack laut ${s.datei}: ${s.angaben.join(" · ")}`);
  const sauber = zeilen.filter((z) => !hatSecretsImKontext(z));
  if (!sauber.length) return "";
  const kopfzeile = `Projekt-Steckbrief (wörtlich aus ${seiteRel}${wurzel ? " und den Manifesten im Repo" : ""}):`;
  const hinweis = (n) => `(${n} weitere Angaben in ${seiteRel})`;
  const { text: rumpf, weggelassen } = ganzeZeilen(sauber, max - kopfzeile.length - hinweis(99).length - 2);
  return [kopfzeile, rumpf, weggelassen ? hinweis(weggelassen) : ""].filter(Boolean).join("\n");
}
