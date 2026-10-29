// tageslauf/pflege-stand.mjs — Was B3 sich zwischen Läufen merkt (.logs/tageslauf/pflege-stand.json, git-ignoriert):
//   tag           Kalendertag des letzten scharfen B3-Laufs (höchstens einmal je Tag)
//   inbox[name]   { sha, versuche, letzter, grund } fehlgeschlagener Inbox-Notizen (höchstens 2 Versuche je Inhalt)
//   konsolidiert[seite]  Datum der letzten Konsolidierung (höchstens alle 30 Tage)
//   haeufungen[schluessel] Datum, an dem eine Häufung als „passt nicht" geprüft wurde (30 Tage Ruhe)
// Probemodus schreibt nie. Lesen wirft nie (kaputt → {}).
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { TL_DIR } from "./protokoll.mjs";
import { loeschePatchDatei } from "./pflege-patch.mjs";

export const STAND_DATEI = (vault) => join(TL_DIR(vault), "pflege-stand.json");
export function leseStand(vault) {
  try {
    const j = JSON.parse(readFileSync(STAND_DATEI(vault), "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}
export function aendereStand(ctx, f) {
  if (ctx.probe) return;
  const s = leseStand(ctx.vault);
  f(s);
  mkdirSync(TL_DIR(ctx.vault), { recursive: true });
  const tmp = `${STAND_DATEI(ctx.vault)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, STAND_DATEI(ctx.vault));
}

// Lernmodus (Autostufe „aus“): was die Pflege dir als Rückfrage vorgelegt hat. stand.lern[<einheit-schluessel>] =
//   { sha, status: "vorgelegt" | "freigegeben" | "abgelehnt" | "gescheitert", rueckfrage?, zeit }
// sha = Fingerabdruck des Inhalts, auf den sich die Frage bezieht — ändert sich die Quelle, ist es eine neue Frage.
export const LERN_STATUS = ["vorgelegt", "freigegeben", "abgelehnt", "gescheitert"];
export const lernEintrag = (vault, schluessel, stand = leseStand(vault)) => {
  const e = stand.lern?.[schluessel];
  return e && typeof e === "object" ? e : null;
};
// Gespeicherter Patch (pflege-patch.mjs: patch, patch_sha, meta, meta_sha) bleibt beim Statuswechsel vorgelegt → freigegeben erhalten
// (gleicher sha); in jedem anderen Status (abgelehnt, gescheitert) und beim Löschen wird er samt Datei entfernt.
const PATCH_FELDER = ["patch", "patch_sha", "meta", "meta_sha"];
export function setzeLern(ctx, schluessel, eintrag) {
  if (typeof schluessel !== "string" || !schluessel) return;
  aendereStand(ctx, (s) => {
    const alt = s.lern?.[schluessel];
    const behalten = alt && alt.sha === eintrag.sha && ["vorgelegt", "freigegeben"].includes(eintrag.status);
    const neu = { zeit: ctx.heute, ...(behalten ? Object.fromEntries(PATCH_FELDER.filter((f) => alt[f] !== undefined).map((f) => [f, alt[f]])) : {}), ...eintrag };
    if (alt?.patch && neu.patch !== alt.patch) loeschePatchDatei(ctx.vault, alt.patch);
    (s.lern ??= {})[schluessel] = neu;
  });
}
export function loescheLern(ctx, schluessel) {
  aendereStand(ctx, (s) => {
    if (s.lern?.[schluessel]?.patch) loeschePatchDatei(ctx.vault, s.lern[schluessel].patch);
    if (s.lern) delete s.lern[schluessel];
  });
}
