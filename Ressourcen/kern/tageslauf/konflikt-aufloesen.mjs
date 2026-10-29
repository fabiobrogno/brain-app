// tageslauf/konflikt-aufloesen.mjs — B3 §7.4: Entscheidungen anwenden. Die Entscheidung des Nutzers (<inbox>/_entscheidungen/<id>.md,
// aus dem Gehirn-Klick oder einer beantworteten konflikt-Rückfrage) löst den [!KONFLIKT]-Kasten DETERMINISTISCH auf — keine KI:
//   a / b  → EIN Satz: „<Aussage> — Quelle: [[…]] _(Konflikt entschieden am TT.MM.JJJJ: A gilt — <Notiz>)_"
//   beide  → zwei Listenpunkte, je mit Quelle, der zweite mit dem Vermerk
// Einrückung des Kastens bleibt (Kasten in einer Liste). Zuordnung nur über den Fingerabdruck (alte Aufträge ohne → /ingest).
// Kritische Seite → bleibt für /ingest. Kasten weg (Seite geändert) → Auftrag archivieren. Je Entscheidung eine Einheit
// (ein Commit), ≤ 5 je Lauf, neueste zuerst. Nach dem Merge: Auftrag → <archiv>/entscheidungen-erledigt/.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ordner } from "../pfade.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { konfliktKaesten } from "../konflikte.mjs";
import { listeEntscheidungen, entscheidungsOrdner, passtZu } from "../entscheidungen.mjs";
import { leseSeitenFelder } from "../seitenfelder.mjs";
import { datumDE } from "./schreiben.mjs";
import { einheit } from "./pflege-kopie.mjs";
import { kastenBereich, rumpfZeilen } from "./diffpruefung.mjs";

export const ENTSCHEIDUNGEN_JE_LAUF = 5;
export const WAHL_TEXT = { a: "A gilt", b: "B gilt", beide: "beide gelten" };
const lf = (t) => String(t ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const einzeilig = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => einzeilig(s).toLowerCase();
const fwd = (p) => String(p).split("\\").join("/");

export function loeseKastenAuf(text, { fp, wahl, notiz = "", datum }) {
  if (!Object.hasOwn(WAHL_TEXT, wahl)) return null;
  const t = lf(text);
  const k = konfliktKaesten(t).konflikte.find((x) => x.fp === fp);
  const r = k ? kastenBereich(t, fp) : null;
  if (!k || !r) return null;
  const z = t.split("\n");
  const einzug = /^(\s*)/.exec(z[r.start])[1];
  const satz = (s) => `${s.text}${s.quelle ? ` — Quelle: [[${s.quelle}]]` : ""}`;
  const vermerk = ` _(Konflikt entschieden am ${datum}: ${WAHL_TEXT[wahl]}${notiz ? ` — ${einzeilig(notiz).slice(0, 200)}` : ""})_`;
  const neu = wahl === "beide" ? [`${einzug}- ${satz(k.a)}`, `${einzug}- ${satz(k.b)}${vermerk}`] : [`${einzug}${satz(wahl === "a" ? k.a : k.b)}${vermerk}`];
  z.splice(r.start, r.ende - r.start, ...neu);
  return z.join("\n");
}

export function archiviereEntscheidung(ctx, id) {
  if (ctx.probe) return null;
  const von = join(entscheidungsOrdner(ctx.vault), `${id}.md`);
  const dir = join(ctx.vault, ordner(ctx.vault).archiv, "entscheidungen-erledigt");
  try {
    mkdirSync(dir, { recursive: true });
    for (let n = 1; n < 100; n++) {
      const z = join(dir, n === 1 ? `${id}.md` : `${id}-${n}.md`);
      if (existsSync(z)) continue;
      renameSync(von, z);
      return fwd(relative(ctx.vault, z));
    }
  } catch { /* bleibt liegen → nächster Lauf */ }
  return null;
}

// Der Auftrag ist die Datei des Nutzers, aber was drinsteht, ist nur Text: nur eine echte Wiki-Seite IN der Arbeitskopie ist ein Ziel
// (kein „..“, kein absoluter Pfad, keine versteckten Ordner, kein Symlink aus der Kopie heraus) — sonst schriebe writeFileSync daran vorbei.
function zielGueltig(kopiePfad, seite, wiki) {
  if (/[\\\0-\x1f\x7f]/.test(seite) || seite.startsWith("/") || /^[A-Za-z]:/.test(seite)) return false;
  if (!istWikiSeite(seite, wiki) || seite.split("/").some((s) => !s || s === "." || s === ".." || s.startsWith("."))) return false;
  try {
    const datei = realpathSync(join(kopiePfad, seite));
    return datei.startsWith(realpathSync(kopiePfad) + sep);
  } catch (e) { return e?.code === "ENOENT"; }          // Seite gibt es nicht (mehr) → unten „kasten-weg“; sonstige Fehler → ungültig
}
const kastenIn = (text, e) => (text === null ? null : konfliktKaesten(lf(text)).konflikte.find((k) => passtZu(e, e.seite, k)) || null);
const lies = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

export async function entscheidungSchritt(ctx, kopie) {
  const alle = listeEntscheidungen(ctx.vault).filter((e) => Object.hasOwn(WAHL_TEXT, e.wahl));
  const posten = [], kritisch = [], gesehen = new Set();
  let bearbeitet = 0, i = 0;
  for (; i < alle.length; i++) {
    if (ctx.pflegeStopp || bearbeitet >= ENTSCHEIDUNGEN_JE_LAUF) break;
    const e = alle[i];
    const seite = fwd(e.seite);
    const titel = `${seite.split("/").pop()}: ${WAHL_TEXT[e.wahl]}${e.notiz ? ` (${einzeilig(e.notiz)})` : ""}`;
    const basis = { id: `entscheidung-${e.id}`.slice(0, 80).replace(/-+$/, ""), art: "entscheidung", titel };
    const kein = (grund, aktion = {}) => posten.push({ erg: { ...basis, ok: false, grund, befunde: [] }, ziel: seite, aktion: { entscheidung: e.id, ...aktion } });
    if (!e.fingerabdruck) { kein("ohne-fingerabdruck"); continue; }
    if (!zielGueltig(kopie.pfad, seite, ordner(ctx.vault).wiki)) { kein("ziel-ungueltig"); continue; }
    const kopieText = lies(join(kopie.pfad, seite));
    const k = kastenIn(kopieText, e);
    if (!k) {
      if (kastenIn(lies(join(ctx.vault, seite)), e)) continue;          // nur ungespeichert im Brain vorhanden → später
      kein("kasten-weg", { verschoben: archiviereEntscheidung(ctx, e.id) });
      continue;
    }
    if (gesehen.has(`${seite}\0${k.fp}`)) continue;                       // ältere Entscheidung zum selben Kasten
    gesehen.add(`${seite}\0${k.fp}`);
    if (leseSeitenFelder(kopieText).kritisch) { kritisch.push(seite); kein("kritisch"); continue; }
    bearbeitet++;
    const erg = await einheit(ctx, kopie, { ...basis, pruef: { nurSeiten: [seite] }, arbeit: async (p) => {
      const datei = join(p, seite);
      const neu = loeseKastenAuf(readFileSync(datei, "utf8"), { fp: k.fp, wahl: e.wahl, notiz: e.notiz, datum: datumDE(ctx.heute) });
      if (neu === null) return { ok: false, grund: "kasten-weg" };
      writeFileSync(datei, neu);
      const verlierer = e.wahl === "beide" ? "" : norm(e.wahl === "a" ? k.b.text : k.a.text);
      return { ok: true, aufgeloest: [k.fp], info: { wahl: e.wahl, verliererNoch: !!verlierer && norm(rumpfZeilen(neu).join(" ")).includes(verlierer) } };
    } });
    posten.push({ erg, ziel: seite, aktion: { entscheidung: e.id, wahl: e.wahl, fp: k.fp },
      ...(erg.ok ? { nachMerge: () => ({ verschoben: archiviereEntscheidung(ctx, e.id) }) } : {}) });
  }
  (ctx.pflegeInfo ??= {}).entscheidungen = { offen: alle.length - i, kritisch };
  return posten;
}
