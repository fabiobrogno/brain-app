// .tools/tests/pflege-zurueck-hilfe.mjs — gemeinsame Bausteine der Rücknahme-Tests (B3 Task 6): echte Pflege-Commits über
// einheit() (T2) + ff-Merge + Aktionsprotokoll, wie B3 sie später erzeugt.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { seitenText, JETZT } from "./tageslauf-hilfe.mjs";
const P = await import("../tageslauf/pflege-kopie.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { neuerLauf, notiere, schreibeAktionen } = await import("../tageslauf/protokoll.mjs");

export const SEITE = "09_wiki/wissen/orion.md";
export const RUMPF = `# Orion\n\n## Überblick\n\n${Array.from({ length: 8 }, (_, i) => `Absatz ${i + 1}.`).join("\n\n")}\n`;
export const orion = (name = "orion") => seitenText({ fm: { name, description: name }, rumpf: RUMPF.replace("# Orion", `# ${name}`) });
export const lies = (v, rel) => readFileSync(join(v, rel), "utf8");
export const ersetze = (w, rel, alt, neu) => writeFileSync(join(w, rel), lies(w, rel).replace(alt, neu));
export const schreibe = (w, rel, t) => { mkdirSync(dirname(join(w, rel)), { recursive: true }); writeFileSync(join(w, rel), t); };

// Ein Pflege-Commit wie in B3: einheit() in der Pflege-Kopie, ff-Merge, Aktion protokolliert.
export async function pflegeCommit(v, { id, art = "konsolidieren", titel = "orion", arbeit, aktion = {}, jetzt = JETZT }) {
  const ctx = neuerLauf(v, { jetzt, claudeBefehl: null });
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try {
    const e = await P.einheit(ctx, kopie, { id, art, titel, arbeit });
    assert.equal(e.ok, true, JSON.stringify(e));
    const m = P.uebernehmePflege(ctx, kopie);
    assert.equal(m.ok, true);
    const hash = m.commits.get(e.id);
    notiere(ctx, { id: e.id, stufe: "pflege", art, titel, ziel: e.seiten[0] || "", commit: hash, seiten: e.seiten, ...aktion });
    schreibeAktionen(ctx);
    return { hash, lauf: ctx.lauf, id: e.id };
  } finally { verwerfeArbeitskopie(v, kopie); }
}
