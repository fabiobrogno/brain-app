// .tools/tests/neue-seiten-hilfe.mjs — gemeinsame Hilfen der Tests zu B3 Task 9 (neue Seiten aus dem Wartebereich).
// Kein Test (heißt nicht test-*.mjs), damit kein Testlauf beim Importieren doppelt läuft.
import { legeVorschlagAn, JETZT } from "./tageslauf-hilfe.mjs";
import { pflegeCtx, seite } from "./pflege-hilfe.mjs";

export const SEITEN = { "09_wiki/wissen/kaffee.md": seite({ name: "kaffee", description: "Kaffee" }, "# Kaffee\n\nText.\n") };
export const warte = (v, id, titel, text, sitzung, felder = {}) => legeVorschlagAn(v, { id, art: "fakt", titel, text, sitzung,
  unterordner: "_warten", zitat: text, herkunft: "du", fundstelle: `${sitzung}#u1 2026-10-20T10:00:00Z`,
  warten_grund: "keine-seite", warten_seit: "2026-10-20T10:00:00Z", ...felder });
export function pizza(v, felder = {}) {
  warte(v, "v-pizza-1", "Pizzaofen Temperatur", "Der Pizzaofen heizt auf 450 Grad.", "s1", felder);
  warte(v, "v-pizza-2", "Pizzaofen Holz", "Der Pizzaofen braucht Buchenholz.", "s1", felder);
  warte(v, "v-pizza-3", "Pizzaofen Dauer", "Eine Pizza ist im Pizzaofen nach 90 Sekunden fertig.", "s2", felder);
  warte(v, "v-katze", "Katze", "Die Katze heißt Mimi.", "s3");
}
export const ENTWURF = { passt: true, name: "pizzaofen", titel: "Pizzaofen", description: "Der Pizzaofen im Garten: Temperatur, Holz, Backzeit.",
  bereich: "wissen", fragen: ["Wie heiß wird der Pizzaofen?", "Welches Holz für den Pizzaofen?"] };

// Ein Schritt-Lauf in einer frischen Pflege-Arbeitskopie. vorab(ctx) darf den ctx vor dem Lauf anpassen.
export async function lauf(v, { tag = 0, autostufe, vorab, probe = false } = {}) {
  const N = await import("../tageslauf/neue-seiten.mjs");
  const P = await import("../tageslauf/pflege-kopie.mjs");
  const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
  const ctx = pflegeCtx(v, { jetzt: JETZT + tag * 86400e3, probe });
  if (autostufe) ctx.autostufe = autostufe;
  vorab?.(ctx);
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try { return { ctx, kopie, posten: await N.neueSeitenSchritt(ctx, kopie) }; }
  catch (e) { verwerfeArbeitskopie(v, kopie); throw e; }
}
