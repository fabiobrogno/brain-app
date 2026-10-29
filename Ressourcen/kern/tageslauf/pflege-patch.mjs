// tageslauf/pflege-patch.mjs — Lernmodus (Autostufe „aus“): Was dir als Rückfrage gezeigt wurde, ist genau das, was nach „Übernehmen“
// angewendet wird. Beim Vorlegen wird der Patch der Einheit (Commit der Vorschlags-Kopie, ohne _log.md) unter
// .logs/tageslauf/pflege-vorschlaege/<rueckfrage-id>.patch gespeichert; sein sha256 (und der der Meta-Angaben, die die Diff-Prüfung
// der Einheit braucht) steht im Lern-Eintrag in pflege-stand.json. Nach „Übernehmen“ rechnet nie wieder eine KI: der Patch wird per
// `git apply --3way` auf die Pflege-Arbeitskopie angewendet und läuft durch dieselben Prüfungen wie jede Einheit (einheit()).
// Angewendet wird er aber nur, wenn jede berührte Datei noch GENAU so ist wie bei der Vorlage (Blob-sha je Datei, `seitenSha` in den
// versiegelten Meta-Angaben): `git apply --3way` allein ließe eine inzwischen geänderte Seite konfliktfrei durchgehen, und der User hätte
// dann etwas freigegeben, das so nie vor ihm lag. Weicht eine Datei ab (oder fehlt der Seitenstand), wird nichts gemergt: Freigabe verfällt,
// die Einheit wird neu vorgelegt. Misslingt `git apply` trotzdem (Konflikt), gilt dasselbe.
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ordner } from "../pfade.mjs";
import { TL_DIR } from "./protokoll.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { gitRoh, sammleDiff } from "./pflege-kopie.mjs";
import { lernEintrag } from "./pflege-stand.mjs";
import { pflegeGrund, hinzugefuegt, zaehleGrund } from "./pflege-thema.mjs";

export const PATCH_DIR = (vault) => join(TL_DIR(vault), "pflege-vorschlaege");
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const sha = (t) => createHash("sha256").update(String(t)).digest("hex");
const metaText = (m) => JSON.stringify(m ?? {});
export const patchDatei = (vault, id) => join(PATCH_DIR(vault), `${id}.patch`);
export const PATCH_FEHLT = "patch-nicht-anwendbar";
// Freigabe-Durchgang ohne gültigen Patch (Freigabe verfallen, Patch fehlt oder beschädigt): die Einheit wird abgebrochen — NIE auf den normalen
// KI-Weg zurückfallen (der User hat einen bestimmten Diff gesehen, nichts anderes darf übernommen werden). b3 löscht die Freigabe und legt neu vor.
export const ohnePatch = (basis, ziel, extra = {}) => ({ erg: { ...basis, ok: false, grund: PATCH_FEHLT,
  befunde: [{ pfad: "-", regel: "patch", meldung: "Kein gültiger gespeicherter Patch — die Freigabe verfällt, die Einheit wird neu vorgelegt" }] }, ziel, ...extra });

// Der Patch einer gelungenen Einheit: Commit gegen seinen Vorgänger, alle Dateien außer dem Protokoll (_log.md wird bei der Anwendung neu geschrieben).
// Voller Hash, binär-sicher, ohne Pfad-Quoting — das Ergebnis endet immer mit einem Zeilenumbruch (git apply verlangt ihn).
export function erzeugePatch(ctx, kopie, commit) {
  const log = `${ordner(ctx.vault).wiki}/_log.md`;
  return gitRoh(ctx.vault, kopie.pfad, ["-c", "core.quotepath=off", "diff", "--binary", "--full-index", "--no-color", `${commit}^`, commit, "--", ".", `:(exclude)${log}`]);
}
// Anzeige für die Rückfrage: dieselben Dateien, kleiner Kontext, nur Dateikopf („Datei: <pfad>“) + Zeilen. Die technischen Kopfzeilen
// (index, ---, +++, new/deleted file mode …) werden NUR vor dem ersten @@ je Datei entfernt — danach ist jede Zeile Inhalt (ein
// hinzugefügtes „++ x“ erscheint als „+++ x“ und darf nie verschluckt werden: gezeigt wird alles, was gilt).
const KOPF_ZEILE = /^(index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to)/;
export function patchAnzeige(ctx, kopie, commit) {
  const log = `${ordner(ctx.vault).wiki}/_log.md`;
  const t = gitRoh(ctx.vault, kopie.pfad, ["-c", "core.quotepath=off", "diff", "--no-color", "-U2", `${commit}^`, commit, "--", ".", `:(exclude)${log}`]);
  const out = [];
  let imKopf = false;
  for (const z of t.split("\n")) {
    if (z.startsWith("diff --git ")) { imKopf = true; out.push(z.replace(/^diff --git a\/.* b\/(.*)$/, "Datei: $1")); continue; }
    if (imKopf && z.startsWith("@@")) imKopf = false;
    if (imKopf && KOPF_ZEILE.test(z)) continue;
    out.push(z);
  }
  return out.join("\n").trim();
}

// Stand der berührten Dateien einer Einheit VOR ihrem Commit: { pfad: Blob-sha | null (Datei gab es nicht) }, ohne _log.md. Kommt beim Vorlegen in die
// Meta-Angaben des Patches (meta.seitenSha) — bei der Freigabe prüft seitenAbweichung, ob die Dateien noch so sind.
export function seitenStand(ctx, kopie, commit) {
  const log = `${ordner(ctx.vault).wiki}/_log.md`;
  const namen = gitRoh(ctx.vault, kopie.pfad, ["-c", "core.quotepath=off", "diff", "--name-only", "--no-renames", "-z", `${commit}^`, commit, "--", ".", `:(exclude)${log}`])
    .split("\0").filter(Boolean);
  const out = {};
  for (const n of namen) out[n] = blobSha(ctx.vault, kopie.pfad, `${commit}^`, n);
  return out;
}
function blobSha(vault, kopiePfad, rev, pfad) {
  try { return gitRoh(vault, kopiePfad, ["rev-parse", "--verify", "-q", `${rev}:${pfad}`]).trim() || null; } catch { return null; }
}
// → Pfade, deren aktueller Stand (HEAD der Arbeitskopie) vom gespeicherten abweicht. Fehlt der Seitenstand ganz, gilt „alles unbekannt“ → ["?"].
export function seitenAbweichung(ctx, kopiePfad, soll) {
  if (!soll || typeof soll !== "object" || Array.isArray(soll) || !Object.keys(soll).length) return ["?"];
  return Object.entries(soll).filter(([pfad, sha]) => blobSha(ctx.vault, kopiePfad, "HEAD", pfad) !== (sha ?? null)).map(([pfad]) => pfad);
}

// → { patch, patch_sha, meta, meta_sha } für den Lern-Eintrag; schreibt die Patch-Datei atomar. Probe: nichts schreiben (null).
export function speicherePatch(ctx, id, text, meta) {
  if (ctx.probe || !ID.test(String(id)) || !text) return null;
  mkdirSync(PATCH_DIR(ctx.vault), { recursive: true });
  const ziel = patchDatei(ctx.vault, id), tmp = `${ziel}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, ziel);
  return { patch: String(id), patch_sha: sha(text), meta, meta_sha: sha(metaText(meta)) };
}
export function loeschePatchDatei(vault, id) {
  if (!ID.test(String(id ?? ""))) return;
  try { rmSync(patchDatei(vault, id), { force: true }); } catch { /* weg oder nicht löschbar */ }
}
// Gespeicherter Patch + Meta eines Lern-Eintrags, nur wenn beide Hashes stimmen. Sonst null (nie ein Patch ohne Prüfsumme).
export function ladePatch(vault, eintrag) {
  try {
    if (!eintrag || !ID.test(String(eintrag.patch)) || !eintrag.patch_sha || !eintrag.meta_sha) return null;
    const text = readFileSync(patchDatei(vault, eintrag.patch), "utf8");
    if (sha(text) !== eintrag.patch_sha || sha(metaText(eintrag.meta)) !== eintrag.meta_sha) return null;
    return { text, meta: eintrag.meta ?? {} };
  } catch { return null; }
}
// Freigegeben UND unverändert: nur dann darf eine Einheit im Lernmodus gemergt werden. → { text, meta } | null
export function freigabePatch(vault, schluessel, sha16, stand) {
  const e = lernEintrag(vault, schluessel, stand);
  if (!e || e.status !== "freigegeben" || e.sha !== sha16) return null;
  if (!e.rueckfrage || e.patch !== e.rueckfrage) return null;           // der Patch gehört zu genau der Rückfrage, die der User beantwortet hat
  return ladePatch(vault, e);
}

// Patch auf die Arbeitskopie anwenden (Index + Arbeitsbaum). Misslingt es (Seite inzwischen geändert → Konflikt), bleibt die Kopie
// im unbestimmten Zustand — der Aufrufer (einheit → verwerfen) setzt sie zurück.
export function wendePatchAn(ctx, kopiePfad, text) {
  const tmp = join(PATCH_DIR(ctx.vault), `anwenden-${process.pid}.tmp.patch`);
  try {
    mkdirSync(PATCH_DIR(ctx.vault), { recursive: true });
    writeFileSync(tmp, text);
    gitRoh(ctx.vault, kopiePfad, ["apply", "--3way", "--whitespace=nowarn", tmp]);
    return { ok: true };
  } catch (e) {
    return { ok: false, meldung: String(e?.stderr || e?.message || "git apply fehlgeschlagen").split("\n").map((z) => z.trim()).filter(Boolean).slice(0, 2).join(" | ").slice(0, 160) };
  } finally { try { rmSync(tmp, { force: true }); } catch { /* egal */ } }
}

// Gemeinsamer arbeit()-Weg der Schritte für eine freigegebene Einheit: Patch anwenden statt neu rechnen. Danach nur noch der
// Themen-Guard über den neu hinzugefügten Text (die Einstellung kann sich seit der Rückfrage geändert haben); alles Weitere
// (rev, _log, Diff-Prüfung mit den gespeicherten Meta-Angaben, Integrität, Lint) macht einheit() wie bei jeder Einheit.
// → { ok:false, grund, befunde } | { ok:true, ...Meta für einheit() }
export function patchArbeit(ctx, kopiePfad, fg) {
  const weg = seitenAbweichung(ctx, kopiePfad, fg.meta?.seitenSha);
  if (weg.length) {
    return { ok: false, grund: PATCH_FEHLT, befunde: [{ pfad: weg[0] === "?" ? "-" : weg[0], regel: "seite-geaendert",
      meldung: weg[0] === "?" ? "Stand der Seiten bei der Vorlage unbekannt" : `Seite seit der Vorlage geändert (${weg.length} Datei${weg.length > 1 ? "en" : ""}) — nichts angewendet` }] };
  }
  const a = wendePatchAn(ctx, kopiePfad, fg.text);
  if (!a.ok) return { ok: false, grund: PATCH_FEHLT, befunde: [{ pfad: "-", regel: "patch", meldung: a.meldung }] };
  const wiki = ordner(ctx.vault).wiki;
  for (const d of sammleDiff(ctx.vault, { pfad: kopiePfad })) {
    if (d.status === "geloescht" || typeof d.neu !== "string" || !istWikiSeite(d.pfad, wiki)) continue;
    const tg = pflegeGrund(ctx, hinzugefuegt(d.alt, d.neu));
    if (tg) { zaehleGrund(ctx, tg); return { ok: false, grund: "thema-ausgeschlossen", befunde: [{ pfad: d.pfad, regel: "thema", meldung: "Der neue Text nennt ein ausgeschlossenes Thema" }] }; }
  }
  const m = fg.meta || {};
  return { ok: true, neueQuellen: m.neueQuellen || [], neueBelege: m.neueBelege || [], umgezogen: m.umgezogen || [], aufgeloest: m.aufgeloest || [],
    ...(Array.isArray(m.seiten) ? { nurSeiten: m.seiten } : {}) };
}
