// tageslauf/bestand.mjs — Vorschläge für den Tageslauf (B2, Spec §5.2): lesen mit ALLEN Frontmatter-Feldern
// (auch zitat/herkunft/fundstelle aus B1 und warten_*), verschieben ohne Überschreiben, nie ins Wiki, nie aus dem Vault.
// Probemodus (ctx.probe): rechnet nur den Zielpfad aus, ändert nichts. Unzulässiges Ziel → wirft.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, unlinkSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { ordner, entferneBom } from "../pfade.mjs";
import { ID_MUSTER, liegtImWiki } from "../vorschlaege.mjs";
import { notiere } from "./protokoll.mjs";
import { THEMA_GRUND } from "../thema-ausschluss.mjs";

const fwd = (p) => String(p).split("\\").join("/");
const GRUND = /^[a-z0-9-]{1,40}$/;
const zeitZ = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";
export const UNTERORDNER = { vorschlaege: "_vorschlaege", warten: "_warten", rueckfrage: "_rueckfragen/vorschlaege" };

export function leseFm(text) {
  const zeilen = entferneBom(String(text)).replace(/\r\n?/g, "\n").split("\n");
  const ende = zeilen[0] === "---" ? zeilen.indexOf("---", 1) : -1;
  if (ende < 0) return { fm: {}, rumpf: zeilen.join("\n"), ok: false };
  const fm = {};
  for (const z of zeilen.slice(1, ende)) {
    const m = z.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (!m) continue;
    const w = m[2].trim();
    if (/^["[{]/.test(w)) { try { fm[m[1]] = JSON.parse(w); continue; } catch {} }
    fm[m[1]] = w === "true" ? true : w === "false" ? false : /^-?\d{1,9}$/.test(w) ? Number(w) : w;
  }
  return { fm, rumpf: zeilen.slice(ende + 1).join("\n"), ok: true };
}
// Nur für Vorschlags-/Rückfrage-/Beleg-Dateien (eigenes Format). Wiki-Seiten ändert schreiben.mjs zeilenweise.
export function schreibeFm(fm, rumpf) {
  const z = Object.entries(fm).filter(([, w]) => w !== undefined && w !== null)
    .map(([k, w]) => `${k}: ${k === "typ" || k === "art" ? String(w) : JSON.stringify(w)}`);
  return `---\n${z.join("\n")}\n---\n${rumpf}`;
}

const s = (w) => (w === undefined || w === null ? "" : String(w));
function alsVorschlag(id, datei, unterordner, text) {
  const { fm, rumpf, ok } = leseFm(text);
  if (!ok || fm.typ !== "vorschlag") return null;
  let r = rumpf.replace(/^\n+/, "");
  let titel = s(fm.titel);
  if (r.startsWith("# ")) {
    const nl = r.indexOf("\n");
    titel = titel || r.slice(2, nl < 0 ? undefined : nl).trim();
    r = nl < 0 ? "" : r.slice(nl + 1);
  }
  return {
    id, datei, unterordner, fm, rumpf, art: s(fm.art), titel, text: r.trim(),
    quelleOrdner: s(fm.quelle_ordner), quelleSitzung: s(fm.quelle_sitzung), erstellt: s(fm.erstellt),
    zitat: s(fm.zitat), herkunft: s(fm.herkunft), fundstelle: s(fm.fundstelle),
    regel: s(fm.regel), warum: s(fm.warum), wie: s(fm.wie), ziel: s(fm.ziel),
    wartenSeit: s(fm.warten_seit), wartenGrund: s(fm.warten_grund),
  };
}

export function ladeVorschlaege(vault, { unterordner = [UNTERORDNER.vorschlaege, UNTERORDNER.warten] } = {}) {
  const inbox = join(vault, ordner(vault).inbox);
  const out = [];
  for (const u of unterordner) {
    const dir = join(inbox, u);
    let namen = [];
    try { if (lstatSync(dir).isSymbolicLink()) continue; namen = readdirSync(dir); } catch { continue; }
    for (const n of namen) {
      const id = n.endsWith(".md") ? n.slice(0, -3) : "";
      if (!ID_MUSTER.test(id)) continue;
      const datei = join(dir, n);
      try { if (!lstatSync(datei).isFile()) continue; const v = alsVorschlag(id, datei, u, readFileSync(datei, "utf8")); if (v) out.push(v); } catch {}
    }
  }
  return out.sort((a, b) => b.erstellt.localeCompare(a.erstellt) || a.id.localeCompare(b.id));
}
export function ladeVorschlag(vault, unterordner, id) {
  if (!ID_MUSTER.test(String(id))) return null;
  const datei = join(vault, ordner(vault).inbox, unterordner, `${id}.md`);
  try { return lstatSync(datei).isFile() ? alsVorschlag(id, datei, unterordner, readFileSync(datei, "utf8")) : null; } catch { return null; }
}
// Vorschlag an einem vault-relativen Pfad (z. B. „verschoben" aus aktionen.jsonl) — für Rücknahmen.
export function ladeVorschlagDatei(vault, rel) {
  const teile = fwd(rel).split("/");
  if (!rel || teile.includes("..") || fwd(rel).startsWith("/")) return null;
  const id = teile[teile.length - 1].replace(/\.md$/, "");
  if (!ID_MUSTER.test(id)) return null;
  const datei = join(vault, rel);
  try { return lstatSync(datei).isFile() ? alsVorschlag(id, datei, teile.slice(0, -1).join("/"), readFileSync(datei, "utf8")) : null; } catch { return null; }
}

// zielRel: vault-relativer Ordner. felder: werden ins Frontmatter übernommen. → vault-relativer Zielpfad.
export function verschiebeVorschlag(ctx, v, zielRel, felder = {}) {
  const vault = ctx.vault;
  const wikiRel = ordner(vault).wiki;
  if (fwd(zielRel).split("/").includes("..") || fwd(zielRel) === wikiRel || fwd(zielRel).startsWith(`${wikiRel}/`)) throw new Error("Zielordner unzulässig");
  if (ctx.probe) return fwd(join(zielRel, `${v.id}.md`));
  const zielDir = join(vault, zielRel);
  mkdirSync(zielDir, { recursive: true });
  const vaultEcht = realpathSync(vault), dirEcht = realpathSync(zielDir);
  if (!fwd(dirEcht).startsWith(fwd(vaultEcht) + "/") || liegtImWiki(vault, dirEcht)) throw new Error("Zielordner unzulässig");
  const inhalt = schreibeFm({ ...v.fm, ...felder }, v.rumpf);
  for (let n = 1; n <= 99; n++) {
    const ziel = join(dirEcht, n === 1 ? `${v.id}.md` : `${v.id}-${n}.md`);
    try { writeFileSync(ziel, inhalt, { flag: "wx" }); }
    catch (e) { if (e.code === "EEXIST") continue; throw e; }
    unlinkSync(v.datei);
    v.datei = ziel;
    return fwd(relative(vaultEcht, ziel));
  }
  throw new Error("Kein freier Dateiname");
}
export function setzeVorschlagFelder(ctx, v, felder) {
  Object.assign(v.fm, felder);
  for (const [k, w] of Object.entries(felder)) {
    const schl = k.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    if (schl in v) v[schl] = s(w);
  }
  if (!ctx.probe) writeFileSync(v.datei, schreibeFm(v.fm, v.rumpf));
}

// extra: weitere Felder für den Protokolleintrag (z. B. { muster } der festen Regeln) — nie Text des Vorschlags.
export function aussortieren(ctx, v, grund, extra = {}) {
  if (!GRUND.test(grund)) throw new Error("Ungültiger Grund");
  const ziel = verschiebeVorschlag(ctx, v, `${ordner(ctx.vault).archiv}/vorschlaege-aussortiert/${grund}`);
  // Themen-Ausschluss: der Titel könnte das ausgeschlossene Wort tragen — im Protokoll steht nur der Grund. Ein Belege-Cache-Eintrag
  // (hält das Zitat) fällt mit weg.
  const themaWeg = grund === THEMA_GRUND;
  if (themaWeg && ctx.cache?.belege) delete ctx.cache.belege[v.id];
  notiere(ctx, { id: v.id, stufe: "aussortieren", ziel, grund, ...(themaWeg ? {} : { titel: v.titel }), verschoben: ctx.probe ? null : ziel, ...extra });
  return ziel;
}
export function ablehnen(ctx, v, grund) {
  const ziel = verschiebeVorschlag(ctx, v, `${ordner(ctx.vault).archiv}/vorschlaege-abgelehnt`);
  notiere(ctx, { id: v.id, stufe: "abgelehnt", ziel, grund, titel: v.titel, verschoben: ctx.probe ? null : ziel });
  return ziel;
}
// Warten (§5.2 ⏸): <inbox>/_warten/ mit warten_seit (bleibt beim erneuten Warten), warten_grund, warten_befund.
// Liegt er schon dort mit demselben Grund und ohne neuen Befund → nichts tun, nichts notieren.
export function warten(ctx, v, grund, befund = "") {
  const felder = { warten_seit: v.wartenSeit || zeitZ(ctx.jetzt), warten_grund: grund, ...(befund ? { warten_befund: String(befund).slice(0, 300) } : {}) };
  if (v.unterordner === UNTERORDNER.warten) {
    if (v.wartenGrund === grund && !befund) return fwd(relative(ctx.vault, v.datei));
    setzeVorschlagFelder(ctx, v, felder);
    notiere(ctx, { id: v.id, stufe: "warten", ziel: "", grund: befund ? `${grund}: ${befund}`.slice(0, 200) : grund, titel: v.titel });
    return fwd(relative(ctx.vault, v.datei));
  }
  const ziel = verschiebeVorschlag(ctx, v, `${ordner(ctx.vault).inbox}/${UNTERORDNER.warten}`, felder);
  notiere(ctx, { id: v.id, stufe: "warten", ziel, grund: befund ? `${grund}: ${befund}`.slice(0, 200) : grund, titel: v.titel });
  return ziel;
}
