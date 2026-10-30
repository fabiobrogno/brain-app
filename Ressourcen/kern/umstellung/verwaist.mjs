// umstellung/verwaist.mjs — verwaiste Einbindungen in der globalen git-Konfiguration (Paket P7d, Plan 3.3 „der Befund soll verwaiste Einbindungen erkennen“).
//
// Schritt A2 bindet die Datei je Vault per includeIf "gitdir:<Vault>/.git" in die globale Konfiguration ein, als Block zwischen Marken (git-umzug.mjs). Wird der Vault verschoben oder
// gelöscht, zeigt dieser Block ins Leere: sicheres Versagen (dann fehlt nur die Anmeldehilfe), aber Müll. Der Befund (E29) zählt solche Blöcke; „Aufräumen“ (Schritt V1, nur auf
// ausdrücklichen Wunsch) nimmt sie aus der globalen Konfiguration und legt die Datei je Vault samt Block-Text in die Sicherung. Rückweg: Block und Datei kommen zurück.
// Nur UNSERE Blöcke (mit den Marken von Kortex) werden angefasst – fremde includeIf-Einträge des Nutzers nie.
import { readFileSync, existsSync, rmSync, rmdirSync, copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { echtesDateiZiel, sichereDatei, sicherungsPfad, hashDatei } from "./protokoll.mjs";
import { entferneBlock, setzeBlock, markeAnfang, markeEnde } from "./git-umzug.mjs";

export const id = "V1";
export const titel = "Verwaiste git-Einbindungen aufräumen";

const lies = (datei) => { try { return readFileSync(datei, "utf8"); } catch { return null; } };
const RE_BLOCK = /^# >>> Kortex-Umstellung ([0-9a-f]{8,64}) \(von Kortex verwaltet[^\n]*>>>$/gm;
const unquote = (s) => String(s).replace(/\\(["\\])/g, "$1");
const entmaskiere = (s) => String(s).replace(/\\([\\*?[])/g, "$1");

// → [{ k, vaulte: [Pfad…], datei: Pfad | null, vaultDa, dateiDa, text }] – alle Blöcke von Kortex in der globalen Konfiguration
export function leseBloecke(gitGlobal) {
  const text = lies(echtesDateiZiel(gitGlobal));
  if (text === null) return [];
  const aus = [];
  for (const m of text.matchAll(RE_BLOCK)) {
    const k = m[1];
    const von = m.index, ende = text.indexOf(markeEnde(k), von);
    if (ende < 0) continue;
    const roh = text.slice(von, ende + markeEnde(k).length);
    const vaulte = [];
    for (const g of roh.matchAll(/^\[includeIf "gitdir(?:\/i)?:((?:[^"\\]|\\.)*)"\]$/gm)) {
      const muster = entmaskiere(unquote(g[1]));
      const v = muster.replace(/\/\.git\/worktrees\/$/, "").replace(/\/\.git$/, "");
      if (v && !vaulte.includes(v)) vaulte.push(v);
    }
    const pm = /^\tpath = "((?:[^"\\]|\\.)*)"$/m.exec(roh);
    const datei = pm ? unquote(pm[1]) : null;
    aus.push({ k, vaulte, datei, text: roh + "\n", vaultDa: vaulte.some((v) => existsSync(join(v, ".git"))), dateiDa: !!datei && existsSync(datei) });
  }
  return aus;
}
// verwaist = keiner der Vault-Pfade des Blocks hat (noch) einen Versionsverlauf; dazu zählt ein Block mit mehr als 20 Zeilen nicht (nur von uns geschriebene Form)
export const findeVerwaiste = (gitGlobal) => leseBloecke(gitGlobal).filter((b) => b.vaulte.length > 0 && !b.vaultDa);

export function plan(z) {
  const n = findeVerwaiste(z.gitGlobal).length;
  return { noetig: n > 0, text: n > 0 ? `${n} ${n === 1 ? "Eintrag" : "Einträge"} in deinen persönlichen Einstellungen für den Versionsverlauf ${n === 1 ? "zeigt" : "zeigen"} auf Vaults, die es nicht mehr gibt.` : "Keine verwaisten Einträge.", anzahl: n };
}

export function wende(z, ctx) {
  const liste = findeVerwaiste(z.gitGlobal);
  if (!liste.length) return { status: "nichts" };
  const sicherung = sichereDatei(z, ctx.sicherungsDir, echtesDateiZiel(z.gitGlobal), "gitconfig-global.vor-v1");
  const undo = { global: { sicherung: sicherung && sicherung.rel, hashVorher: hashDatei(echtesDateiZiel(z.gitGlobal)) }, bloecke: liste.map((b) => ({ k: b.k, text: b.text, datei: b.datei, dateiSicherung: null, dateiHash: null })) };
  // Rückweg-Angaben stehen vor dem ersten Schreiben; die Datei je Vault wandert in die Sicherung (Kopie, dann entfernen)
  for (const eintrag of undo.bloecke) {
    if (eintrag.datei && existsSync(eintrag.datei)) {
      const s = sichereDatei(z, ctx.sicherungsDir, eintrag.datei, `pervault-${eintrag.k}.gitconfig`);
      eintrag.dateiSicherung = s && s.rel; eintrag.dateiHash = s && s.hash;
    }
  }
  ctx.merkeUndo(undo);
  let n = 0;
  for (const eintrag of undo.bloecke) {
    if (entferneBlock(z.gitGlobal, eintrag.k)) n++;
    if (eintrag.datei && eintrag.dateiSicherung && hashDatei(eintrag.datei) === eintrag.dateiHash) { rmSync(eintrag.datei, { force: true }); try { rmdirSync(dirname(eintrag.datei)); } catch { /* nicht leer */ } }
  }
  ctx.pruefpunkt("nach-bloecke");
  undo.global.hashNachher = hashDatei(echtesDateiZiel(z.gitGlobal));
  ctx.merkeUndo(undo);
  return { status: "ok", anzahl: n };
}
export function nachpruefen(z) { return findeVerwaiste(z.gitGlobal).length === 0; }

export function zurueck(z, ctx, undo) {
  const hinweise = [];
  if (!undo || !undo.bloecke) return { status: "nichts", hinweise };
  let n = 0;
  for (const eintrag of undo.bloecke) {
    if (eintrag.datei && eintrag.dateiSicherung && !existsSync(eintrag.datei)) {
      mkdirSync(dirname(eintrag.datei), { recursive: true, mode: 0o700 });
      copyFileSync(sicherungsPfad(z, eintrag.dateiSicherung), eintrag.datei); chmodSync(eintrag.datei, 0o600);
    }
    const jetzt = lies(echtesDateiZiel(z.gitGlobal));
    if (jetzt !== null && jetzt.includes(markeAnfang(eintrag.k))) continue;       // schon wieder da
    setzeBlock(z.gitGlobal, eintrag.k, eintrag.text.endsWith("\n") ? eintrag.text : eintrag.text + "\n");
    n++;
  }
  return { status: n ? "ok" : "nichts", hinweise };
}
