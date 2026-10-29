// tageslauf/pflege-zurueck.mjs — „brain zurueck" für Pflege-Commits von B3 (Spec §5.4, §7). Pflege-Änderungen sind frei
// formuliert — darum je Datei ein Drei-Wege-Merge rückwärts (`git merge-file`: aktuell ⟵ Commit-Stand → Stand davor) statt der
// gezielten Gegenänderung aus zurueck.mjs. Strukturfelder werden vorher gleichgezogen und danach gerechnet: rev = rev auf main
// + 1 (einmal je Seite), quellen/quellen_sha und herkunft_web verlieren genau die Einträge, die der Commit dazugetan hat.
// _log.md wird nie zurückgedreht (append-only), es bekommt einen NEUEN Eintrag oben. Neue Dateien des Commits werden gelöscht
// (nur, wenn sie seitdem unverändert sind); eine einsortierte Rohquelle kommt zurück in die Inbox und wird für die Pflege
// gesperrt (sonst würde sie morgen genauso wieder eingearbeitet). Kollidiert irgendeine Datei eines Commits mit späteren
// Änderungen, bleibt DIESER Commit ganz stehen („von Hand geändert"). Ein neuer Commit „zurueck: … (pflege)", normaler
// pre-commit, ff-Merge, Ingest-Sperre. Jede Rücknahme zählt als Fehler (§6.3) — Pflege-Änderungen sind immer automatisch.
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, lstatSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ordner, ladeConfig } from "../pfade.mjs";
import { gitBefehl } from "../werkzeug.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { ladeVorschlagDatei, ablehnen } from "./bestand.mjs";
import { neuerLauf, laufId, notiere, merkePruefung, leseAktionen, schreibeAktionen } from "./protokoll.mjs";
import { git, legeArbeitskopieAn, verwerfeArbeitskopie, uebernehmen, nimmIngestSperre, gibIngestSperreFrei } from "./arbeitskopie.mjs";
import { leseFeld, setzeFeld, fuegeLogEin, logZeit, sha16 } from "./schreiben.mjs";
import { gitRoh, BETREFF_PFLEGE } from "./pflege-kopie.mjs";
import { aendereStand } from "./pflege-stand.mjs";

const BELEG_DATEI = /^[^/]+\/belege\/\d{4}-\d{2}\/[a-z0-9-]{1,80}\.md$/;
const STRUKTUR = ["rev", "quellen", "quellen_sha", "herkunft_web"];
const lf = (t) => String(t ?? "").replace(/\r\n/g, "\n");
const fwd = (p) => String(p).split("\\").join("/");

export function findePflegeCommits(vault, { lauf = null, ids = null, aktionen = leseAktionen(vault) } = {}) {
  const schon = new Set(aktionen.filter((a) => a.stufe === "zurueck" && a.von).map((a) => a.von));
  let log = "";
  try { log = git(vault, vault, ["log", "--format=%H%x09%s", "--grep=^pflege(", "main"]); } catch { return []; }
  const out = [];
  for (const z of log.split("\n").filter(Boolean)) {
    const [hash, betreff = ""] = z.split("\t");
    const m = betreff.match(BETREFF_PFLEGE);
    if (!m || schon.has(hash) || (lauf && m[1] !== lauf) || (ids && !ids.includes(m[2]))) continue;
    out.push({ hash, lauf: m[1], id: m[2], aktion: aktionen.find((a) => a.stufe === "pflege" && a.commit === hash) || null });
  }
  return out;
}

// git merge-file -p <aktuell> <basis> <ziel>: trägt die Änderung basis→ziel in aktuell ein. Exit 0 = sauber, 1..127 = Anzahl
// Konflikte (→ null), sonst Fehler (→ wirft).
export function mergeDatei(aktuell, basis, ziel, { gitPfad = "git" } = {}) {
  const d = mkdtempSync(join(tmpdir(), "brain-zurueck-"));
  try {
    const p = (n, t) => { const f = join(d, n); writeFileSync(f, t); return f; };
    const r = spawnSync(gitPfad, ["merge-file", "-p", "-q", p("aktuell", aktuell), p("basis", basis), p("ziel", ziel)],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status === null || r.status > 127) throw new Error("merge-file nicht ausführbar");
    return r.status === 0 ? r.stdout : null;
  } finally { rmSync(d, { recursive: true, force: true }); }
}

// ── Frontmatter roh (Zeilen bleiben wörtlich; setzeFeld würde jede Zeile neu als JSON schreiben) ──
function fm(text) {
  const t = lf(text);
  const ende = t.startsWith("---\n") ? t.indexOf("\n---", 3) : -1;
  if (ende < 0) return null;
  const roh = t.slice(4, ende);
  return { zeilen: roh ? roh.split("\n") : [], rest: t.slice(ende) };
}
const zeileVon = (f, feld) => f.zeilen.find((z) => z.startsWith(`${feld}:`)) ?? null;
function mitZeile(f, feld, zeile) {
  const i = f.zeilen.findIndex((z) => z.startsWith(`${feld}:`));
  if (zeile === null) { if (i >= 0) f.zeilen.splice(i, 1); }
  else if (i >= 0) f.zeilen[i] = zeile;
  else f.zeilen.push(zeile);
}
const alsText = (f) => `---\n${f.zeilen.join("\n")}${f.rest}`;
function liste(f, feld) {
  const z = zeileVon(f, feld);
  if (z === null) return [];
  const w = z.slice(feld.length + 1).trim();
  if (!w) throw new Error("liste");                    // YAML-Blockliste: nicht anfassen → Datei gilt als nicht zurücknehmbar
  const a = JSON.parse(w);
  if (!Array.isArray(a)) throw new Error("liste");
  return a.map(String);
}
const mehrfach = (a) => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return m; };
function dazu(vorher, nachher) {                        // Mehrfachmenge nachher − vorher
  const m = mehrfach(nachher);
  for (const x of vorher) if (m.get(x) > 0) m.set(x, m.get(x) - 1);
  return m;
}
const ohne = (l, weg) => l.filter((x) => { if (weg.get(x) > 0) { weg.set(x, weg.get(x) - 1); return false; } return true; });

// vor = Datei vor dem Pflege-Commit, nach = Datei im Pflege-Commit, jetzt = Datei auf main. → null bei Konflikt
// (und bei allem, was nicht sicher zurückzurechnen ist: YAML-Blocklisten, kaputtes Frontmatter) — wirft nie.
export function rueckwaertsText(texte, merge = mergeDatei) {
  try { return rueckwaertsTextRoh(texte, merge); } catch { return null; }
}
function rueckwaertsTextRoh({ vor, nach, jetzt }, merge) {
  const ov = fm(vor), on = fm(nach), oj = fm(jetzt);
  if (!ov || !on || !oj) {
    const m = merge(lf(jetzt), lf(nach), lf(vor));
    return m === null ? null : { text: m, unveraendert: m === lf(jetzt) };
  }
  const paare = (f) => { const q = liste(f, "quellen"), s = liste(f, "quellen_sha"); return q.map((x, i) => JSON.stringify([x, s[i] ?? ""])); };
  const q = ohne(paare(oj), dazu(paare(ov), paare(on))).map((x) => JSON.parse(x));
  const w = ohne(liste(oj, "herkunft_web"), dazu(liste(ov, "herkunft_web"), liste(on, "herkunft_web")));
  const nv = fm(vor), nn = fm(nach);
  for (const f of [nv, nn]) for (const feld of STRUKTUR) mitZeile(f, feld, zeileVon(oj, feld));
  const m = merge(alsText(oj), alsText(nn), alsText(nv));
  if (m === null) return null;
  const e = fm(m);
  if (!e) return null;
  if (zeileVon(oj, "quellen") !== null || q.length) {
    mitZeile(e, "quellen", `quellen: ${JSON.stringify(q.map((x) => x[0]))}`);
    mitZeile(e, "quellen_sha", `quellen_sha: ${JSON.stringify(q.map((x) => x[1]))}`);
  }
  mitZeile(e, "herkunft_web", w.length ? `herkunft_web: ${JSON.stringify(w)}` : null);
  const text = alsText(e);
  return { text, unveraendert: text === lf(jetzt) };
}

function dateienDesCommits(vault, hash) {
  const t = gitRoh(vault, vault, ["diff-tree", "--no-commit-id", "-r", "--no-renames", "--name-status", "-z", hash]).split("\0").filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < t.length; i += 2) out.push({ status: t[i][0], pfad: fwd(t[i + 1]) });
  return out;
}

function freierName(dir, rel) {
  const p = join(dir, rel);
  if (!existsSync(p)) return p;
  const stamm = p.replace(/\.md$/i, "");
  for (let n = 1; n < 100; n++) { const z = `${stamm}-zurueck${n === 1 ? "" : `-${n}`}.md`; if (!existsSync(z)) return z; }
  return `${stamm}-zurueck-${Date.now()}.md`;
}
// Rohquelle zurück in die Inbox: bevorzugt die archivierte Original-Notiz, sonst der Inhalt aus dem Commit.
function rohquelleZurueck(c, { pfad, text, k }) {
  const o = ordner(c.vault);
  const q = fwd(k.aktion?.quelle || "");
  const rel = q.startsWith(`${o.inbox}/`) && !q.split("/").includes("..") ? q.slice(o.inbox.length + 1) : basename(pfad);
  const inboxDir = join(c.vault, o.inbox);
  const ziel = freierName(inboxDir, rel);
  const arch = fwd(k.aktion?.verschoben || "");
  let inhalt = text;
  try {
    mkdirSync(dirname(ziel), { recursive: true });
    const archDatei = arch.startsWith(`${o.archiv}/`) && !arch.split("/").includes("..") ? join(c.vault, arch) : null;
    if (archDatei && existsSync(archDatei) && lstatSync(archDatei).isFile()) { inhalt = readFileSync(archDatei, "utf8"); renameSync(archDatei, ziel); }
    else writeFileSync(ziel, text, { flag: "wx" });
  } catch { return null; }
  const name = fwd(relative(inboxDir, ziel));
  aendereStand(c, (s) => { (s.inbox ??= {})[name] = { sha: sha16(inhalt), versuche: 2, gesperrt: true, grund: "zurueckgenommen", letzter: c.heute }; });
  notiere(c, { id: k.id, stufe: "zurueckverschoben", ziel: `${o.inbox}/${name}`, grund: "Rohquelle zurück in die Inbox (für die Pflege gesperrt)" });
  return `${o.inbox}/${name}`;
}

// Ohne mitgegebenen ctx (CLI) schreibt nimmPflegeZurueck sein eigenes Aktionsprotokoll — genau einmal, am Ende.
export function nimmPflegeZurueck(vault, opt = {}) {
  const c = opt.ctx || neuerLauf(vault, { jetzt: opt.jetzt ?? Date.now(), claudeBefehl: null });
  try { return zuruecknehmenMit(vault, c, opt); }
  finally { if (!opt.ctx) schreibeAktionen(c); }
}

function zuruecknehmenMit(vault, c, { lauf = null, ids = null, jetzt = c.jetzt } = {}) {
  if (c.probe) return { ok: false, grund: "probe" };
  const commits = findePflegeCommits(vault, { lauf, ids });
  if (!commits.length) return { ok: false, grund: "nichts-gefunden" };
  if (!nimmIngestSperre(vault)) return { ok: false, grund: "ingest-laeuft" };
  const o = ordner(vault);
  const gitPfad = gitBefehl({ cfg: ladeConfig(vault) });
  const merge = (a, b, z) => mergeDatei(a, b, z, { gitPfad });
  let kopie = null;
  try {
    kopie = legeArbeitskopieAn(vault, `zurueck-${laufId(new Date(jetzt))}-pflege`);
    const zeige = (rev, p) => gitRoh(vault, vault, ["show", `${rev}:${p}`]);
    const texte = new Map();                                                   // pfad → neuer Text | null (= löschen)
    const aktuell = (p) => (texte.has(p) ? texte.get(p) : existsSync(join(kopie.pfad, p)) ? readFileSync(join(kopie.pfad, p), "utf8") : null);
    const erledigt = [], uebersprungen = [], rohquellen = [];
    for (const k of commits) {                                                 // neueste zuerst
      const plan = new Map(), roh = [];
      let ok = true;
      try {
        for (const d of dateienDesCommits(vault, k.hash)) {
          if (d.pfad === `${o.wiki}/_log.md`) continue;
          const jetztText = aktuell(d.pfad);
          if (d.status === "A") {
            if (jetztText === null) continue;                                  // schon weg
            const nach = zeige(k.hash, d.pfad);
            if (lf(jetztText) !== lf(nach)) { ok = false; break; }
            plan.set(d.pfad, null);
            if (!istWikiSeite(d.pfad, o.wiki) && !BELEG_DATEI.test(d.pfad)) roh.push({ pfad: d.pfad, text: nach, k });
          } else if (d.status === "M" && jetztText !== null) {
            const r = rueckwaertsText({ vor: zeige(`${k.hash}^`, d.pfad), nach: zeige(k.hash, d.pfad), jetzt: jetztText }, merge);
            if (!r) { ok = false; break; }
            if (!r.unveraendert) plan.set(d.pfad, r.text);
          } else { ok = false; break; }
        }
      } catch { ok = false; }
      if (!ok) { uebersprungen.push({ id: k.id, grund: "von-hand-geaendert" }); continue; }
      if (!plan.size) { uebersprungen.push({ id: k.id, grund: "schon-rueckgaengig" }); continue; }
      for (const [p, t] of plan) texte.set(p, t);
      rohquellen.push(...roh);
      erledigt.push(k);
    }
    if (!erledigt.length) {
      const alleSchon = uebersprungen.every((u) => u.grund === "schon-rueckgaengig");
      return { ok: false, grund: alleSchon ? "nichts-gefunden" : "von-hand-geaendert", uebersprungen };
    }
    const info = [], add = [];
    for (const [p, t] of texte) {
      const kurz = istWikiSeite(p, o.wiki) ? p.slice(o.wiki.length + 1) : null;
      if (t === null) { git(vault, kopie.pfad, ["rm", "-q", "--", p]); if (kurz) info.push(`${kurz} (gelöscht)`); continue; }
      let text = t;
      if (kurz) {
        let alt = NaN;
        try { alt = Number(leseFeld(readFileSync(join(kopie.pfad, p), "utf8"), "rev")); } catch {}
        if (Number.isInteger(alt) && alt >= 1) { text = setzeFeld(text, "rev", alt + 1); info.push(`${kurz} (rev ${alt + 1})`); }
        else info.push(kurz);
      }
      writeFileSync(join(kopie.pfad, p), text);
      add.push(p);
    }
    const logRel = `${o.wiki}/_log.md`, logDatei = join(kopie.pfad, logRel);
    const altLog = existsSync(logDatei) ? readFileSync(logDatei, "utf8") : "# Ingest-Protokoll (append-only, neuester Eintrag oben)\n";
    writeFileSync(logDatei, fuegeLogEin(altLog, [
      `## ${logZeit(new Date(jetzt))} — zurueck: ${erledigt.length} Pflege-Änderung(en) zurückgenommen`,
      `- Seiten geändert/gelöscht: ${info.join(", ") || "keine"}`,
      `- Zurückgenommen: ${erledigt.map((k) => `${k.id} (pflege ${k.hash.slice(0, 8)})`).join(", ").slice(0, 400)}`].join("\n")));
    try {
      git(vault, kopie.pfad, ["add", "--", logRel, ...add]);
      git(vault, kopie.pfad, ["commit", "-q", "-m", `zurueck: ${erledigt.map((k) => k.id).join(", ").slice(0, 100)} (pflege)`]);
    } catch { return { ok: false, grund: "pruefung-rot", uebersprungen }; }
    const m = uebernehmen(vault, kopie);
    if (!m.ok) return { ok: false, grund: m.grund, uebersprungen };
    let commit = null;
    try { commit = git(vault, vault, ["rev-parse", "HEAD"]); } catch { /* nur Anzeige */ }
    for (const k of erledigt) {                       // erst Protokoll, dann die Dateiverschiebungen (dürfen einzeln scheitern)
      const seite = k.aktion?.ziel || "";
      notiere(c, { id: k.id, stufe: "zurueck", ziel: seite, von: k.hash, commit, grund: "zurückgenommen (Pflege)" });
      try { merkePruefung(c, { art: "zurueck", fehler: true, ref: `zurueck:${k.hash}`, seite, aktion: k.id }); } catch { /* Protokoll nicht schreibbar */ }
      for (const rel of k.aktion?.vorschlaege || []) {
        try { const v = ladeVorschlagDatei(vault, rel); if (v) ablehnen(c, v, "zurueckgenommen"); } catch { /* bleibt im Archiv */ }
      }
    }
    const inbox = rohquellen.map((r) => rohquelleZurueck(c, r)).filter(Boolean);
    return { ok: true, zurueck: erledigt.length, commit, inbox, uebersprungen };
  } catch { return { ok: false, grund: "fehler" }; }
  finally {
    if (kopie) verwerfeArbeitskopie(vault, kopie);
    gibIngestSperreFrei(vault);
  }
}
