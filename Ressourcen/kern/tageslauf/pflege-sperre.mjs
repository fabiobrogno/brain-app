// tageslauf/pflege-sperre.mjs — W4: Der Themen-Guard (ernteOhneThema, ernteNichtIn) filtert die Eingabe der KI — aber Sonnet darf die ganze
// Arbeitskopie lesen. Darum werden vor jedem Sonnet-Lauf alle Dateien, die ein ausgeschlossenes Thema nennen oder in einem ausgeschlossenen
// Ordner liegen, aus der ARBEITSKOPIE entfernt (nie aus dem echten Vault) und danach per `git checkout` wiederhergestellt. Legt die KI so
// eine Datei neu an, merkt sich ctx.pflegeGesperrtBeruehrt den Pfad — einheit() verwirft dann die Einheit. Fail-closed: ohne lesbare
// Einstellungen wird nichts entfernt, weil dann gar keine KI läuft (b3.mjs: Schritte brauchen konfigLesbar).
import { readdirSync, lstatSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { istAusgeschlossen } from "../ernte.mjs";
import { ALT_KIT_ORDNER } from "../pfade.mjs";
import { git } from "./arbeitskopie.mjs";
import { pflegeGrund, konfigLesbar } from "./pflege-thema.mjs";

// .kortex = Gerätemerker der Umstellung (P7b): Pflege und KI fassen ihn nie an
const UEBERSPRINGEN = new Set([".git", ALT_KIT_ORDNER, ".claude", ".kortex", ".logs", "node_modules"]);
const TEXT = /\.(md|txt|json|csv|yml|yaml)$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const fwd = (p) => String(p).split("\\").join("/");

function dateien(wurzel, rel = "", out = []) {
  let namen = [];
  try { namen = readdirSync(join(wurzel, rel)); } catch { return out; }
  for (const n of namen) {
    if (UEBERSPRINGEN.has(n) && !rel) continue;
    const r = rel ? `${rel}/${n}` : n;
    let st;
    try { st = lstatSync(join(wurzel, r)); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) dateien(wurzel, r, out);
    else if (st.isFile() && TEXT.test(n) && st.size <= MAX_BYTES) out.push(r);
  }
  return out;
}

// → { entfernt: [rel…], stelleHer(): [rel…] (die neu angelegten, dann wiederhergestellten Pfade) }
export function sperreAusgeschlossenes(ctx, kopiePfad) {
  const leer = { entfernt: [], stelleHer: () => [] };
  if (!konfigLesbar(ctx)) return leer;
  const weg = [];
  for (const rel of dateien(kopiePfad)) {
    let text = "";
    try { text = readFileSync(join(kopiePfad, rel), "utf8"); } catch { continue; }
    let ausgeschlossen = false;
    try { ausgeschlossen = !!pflegeGrund(ctx, rel, text) || istAusgeschlossen(join(ctx.vault, rel), ctx.werte.ernteNichtIn); } catch { ausgeschlossen = true; }
    if (!ausgeschlossen) continue;
    // nur Dateien, die git kennt, lassen sich wiederherstellen (die kopierte Inbox-Notiz ist geprüft und nie ausgeschlossen)
    try { git(ctx.vault, kopiePfad, ["ls-files", "--error-unmatch", "--", rel]); } catch { continue; }
    try { unlinkSync(join(kopiePfad, rel)); weg.push(fwd(rel)); } catch { /* bleibt — dann sieht die KI sie, die Eingabe-Filter gelten weiter */ }
  }
  if (weg.length) (ctx.pflegeInfo ??= {}).kopieGesperrt = Math.max(ctx.pflegeInfo.kopieGesperrt || 0, weg.length);
  return { entfernt: weg, stelleHer: () => {
    const neu = weg.filter((rel) => existsSync(join(kopiePfad, rel)));          // die KI hat die Datei wieder angelegt
    for (let i = 0; i < weg.length; i += 100) {
      try { git(ctx.vault, kopiePfad, ["checkout", "--", ...weg.slice(i, i + 100)]); } catch { /* der Wächter in einheit() merkt es */ }
    }
    return neu;
  } };
}
