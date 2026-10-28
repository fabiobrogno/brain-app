// .tools/tageslauf/veraltet.mjs — K7 „Prüfen nach Nutzung" (Spec §7.6, App-Spec K7), 0 Tokens.
// Abgelaufene Seiten (gueltigkeit.mjs) nach (Nutzung + 1) × Tage über der Frist; Nutzung = Brain-Hinweise der letzten 90 Tage
// (hint.log). Projektseiten (K14) prüft der Lauf zuerst selbst: Zeigt pfade/repo auf ein lokales Git-Repo ohne Commit seit dem
// Stand der Seite, verlängert er sie (Feld-Aufträge stand + pruefen_bis; sie laufen durch das B2-Schreiben, ein Commit je Feld,
// rückgängig per brain zurueck). Sonst eine Rückfrage „veraltet" (≤ 3 neue je Lauf, nie zwei zur selben Seite). Kritische
// Seiten bekommen nur Rückfragen. Seiten, die in 180 Tagen nie als Hinweis kamen und seit 180 Tagen keinen Commit hatten →
// nur Bericht „Archiv-Kandidat" — und nur, wenn das Hinweis-Log überhaupt 180 Tage zurückreicht (sonst wäre „nie genutzt" geraten).
import { readFileSync, statSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { walk } from "../vault-dateien.mjs";
import { ordner } from "../pfade.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { gueltigkeit } from "../gueltigkeit.mjs";
import { leseSeitenFelder } from "../seitenfelder.mjs";
import { fmWerte, istProjektseite, gitWurzel } from "../projekt.mjs";
import { legeRueckfrageAn, listeRueckfragen } from "../rueckfragen.mjs";
import { notiere, hinweisNutzung } from "./protokoll.mjs";
import { git } from "./arbeitskopie.mjs";

export const K7_JE_LAUF = 3, ARCHIV_TAGE = 180, VERLAENGERN_TAGE = 90, NUTZUNG_TAGE = 90;
const TAG = 86400e3;
const fwd = (p) => String(p).split("\\").join("/");
const slug = (s) => String(s).toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
const fmText = (t) => { const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(String(t)); return m ? m[1] : ""; };

export function plusTage(tag, n) {
  const [j, m, t] = String(tag).split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, t + n)).toISOString().slice(0, 10);
}
export function verlaengerung(text, heute) {
  return [{ feld: "stand", wert: heute },
    ...(/^pruefen_bis:/m.test(fmText(text)) ? [{ feld: "pruefen_bis", wert: plusTage(heute, VERLAENGERN_TAGE) }] : [])];
}

// Letzter Commit je Wiki-Datei (Autor-Datum, ms) aus EINEM git log über main.
export function letzteCommits(vault) {
  const m = new Map();
  let aus = "";
  try { aus = git(vault, vault, ["-c", "core.quotePath=false", "log", "--format=%x01%at", "--name-only", "main", "--", ordner(vault).wiki]); }
  catch { return m; }
  let t = 0;
  for (const z of aus.split("\n")) {
    if (z.startsWith("\x01")) { t = Number(z.slice(1)) * 1000; continue; }
    const p = z.trim();
    if (p && !m.has(p)) m.set(p, t);                                  // neueste zuerst → erster Treffer = letzter Commit
  }
  return m;
}

export function repoOrdner(text, { home = homedir() } = {}) {
  for (const w of fmWerte(text, ["pfade", "repo"])) {
    const p = w === "~" || w.startsWith("~/") ? join(home, w.slice(1)) : w;
    if (!isAbsolute(p)) continue;
    try { if (statSync(p).isDirectory()) { const g = gitWurzel(p); if (g) return g; } } catch {}
  }
  return null;
}
export function repoAenderungen(vault, dir, seitMs) {
  try {
    const aus = git(vault, dir, ["log", `--since=${new Date(seitMs).toISOString()}`, "--format=%s", "-n", "20", "HEAD"]);
    const betreffe = aus.split("\n").filter(Boolean);
    return { commits: betreffe.length, betreffe: betreffe.slice(0, 3) };
  } catch { return null; }
}

export function veraltetKandidaten(vault, { jetzt = Date.now(), nutzung = new Map(), commits = new Map() } = {}) {
  const wiki = ordner(vault).wiki;
  const out = [];
  for (const f of walk(vault)) {
    const rel = fwd(f.rel);
    if (!istWikiSeite(rel, wiki)) continue;
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    const g = gueltigkeit(text, { letzterCommitMs: commits.get(rel) ?? null, jetzt });
    if (g.status !== "abgelaufen") continue;
    const n = (nutzung.get(rel) || []).length;
    out.push({ seite: rel, text, stand: g.stand, pruefenBis: g.pruefenBis, tageUeber: g.tageUeber, nutzung: n,
      wert: (n + 1) * Math.max(1, g.tageUeber), projekt: istProjektseite(rel.slice(wiki.length + 1), fmText(text)),
      kritisch: leseSeitenFelder(text).kritisch });
  }
  return out.sort((a, b) => b.wert - a.wert || a.seite.localeCompare(b.seite));
}

export function hintLogBeginn(vault) {
  try {
    const erste = readFileSync(join(vault, ".logs", "hint.log"), "utf8").split(/\r?\n/).find((z) => z.trim());
    const t = Date.parse(`${String(erste).slice(0, 19)}Z`);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}
export function archivKandidaten(vault, { jetzt = Date.now(), commits = letzteCommits(vault) } = {}) {
  const beginn = hintLogBeginn(vault);
  if (!beginn || jetzt - beginn < ARCHIV_TAGE * TAG) return { liste: [], zuJung: true };
  const nutzung = hinweisNutzung(vault, { seitMs: jetzt - ARCHIV_TAGE * TAG });
  const wiki = ordner(vault).wiki;
  const liste = walk(vault).map((f) => fwd(f.rel))
    .filter((rel) => istWikiSeite(rel, wiki) && !nutzung.has(rel) && (commits.get(rel) ?? jetzt) < jetzt - ARCHIV_TAGE * TAG);
  return { liste, zuJung: false };
}

const standMs = (stand) => (/^\d{4}-\d{2}-\d{2}$/.test(String(stand || "")) ? Date.parse(`${stand}T00:00:00Z`) : null);

export function veraltetSchritt(ctx, { home = homedir() } = {}) {
  const nutzung = hinweisNutzung(ctx.vault, { seitMs: ctx.jetzt - NUTZUNG_TAGE * TAG });
  const commits = letzteCommits(ctx.vault);
  const offen = new Set(listeRueckfragen(ctx.vault).filter((r) => r.typ === "veraltet").map((r) => r.seite));
  const auftraege = [];
  let neu = 0;
  for (const k of veraltetKandidaten(ctx.vault, { jetzt: ctx.jetzt, nutzung, commits })) {
    if (offen.has(k.seite)) continue;
    let repo = null;
    if (k.projekt) {
      const dir = repoOrdner(k.text, { home });
      if (dir) {
        repo = repoAenderungen(ctx.vault, dir, standMs(k.stand) ?? commits.get(k.seite) ?? 0);
        if (repo && repo.commits === 0 && !k.kritisch) {
          for (const f of verlaengerung(k.text, ctx.heute)) {
            auftraege.push({ art: "feld", seite: k.seite, feld: f.feld, wert: f.wert, titel: `Projekt unverändert — ${f.feld} verlängert`,
              ref: `k7-${slug(k.seite)}-${f.feld === "stand" ? "stand" : "frist"}`.slice(0, 80) });
          }
          notiere(ctx, { id: `k7-${slug(k.seite)}`.slice(0, 80), stufe: "hinweis", ziel: k.seite, grund: "k7-repo-unveraendert" });
          continue;
        }
      }
    }
    if (neu >= K7_JE_LAUF) continue;
    const repoText = repo ? `\nRepo: ${repo.commits} Commit(s) seit dem Stand${repo.betreffe.length ? ` (z. B. „${repo.betreffe[0]}“)` : ""}.` : "";
    legeRueckfrageAn(ctx, { typ: "veraltet", frage: `Stimmt ${basename(k.seite)} noch?`, seite: k.seite, grund: "k7",
      beschreibung: `Abgelaufen seit ${k.tageUeber} Tagen (Frist ${k.pruefenBis}). In den letzten 90 Tagen ${k.nutzung}× als Brain-Hinweis gezeigt.${repoText}` });
    offen.add(k.seite);
    neu++;
  }
  const archiv = archivKandidaten(ctx.vault, { jetzt: ctx.jetzt, commits });
  for (const a of archiv.liste.slice(0, 10)) notiere(ctx, { id: `archiv-${slug(a)}`.slice(0, 80), stufe: "archiv-kandidat", ziel: a, grund: "nie genutzt, seit 180 Tagen ohne Änderung" });
  return { auftraege, rueckfragen: neu, archiv };
}
