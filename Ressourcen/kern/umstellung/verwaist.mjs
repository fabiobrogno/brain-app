// umstellung/verwaist.mjs — verwaiste Einbindungen in der globalen git-Konfiguration (Paket P7d, Plan 3.3 „der Befund soll verwaiste Einbindungen erkennen“).
//
// Schritt A2 bindet die Datei je Vault per includeIf "gitdir:<Vault>/.git" in die globale Konfiguration ein, als Block zwischen Marken (git-umzug.mjs). Wird der Vault verschoben oder
// gelöscht, zeigt dieser Block ins Leere: sicheres Versagen (dann fehlt nur die Anmeldehilfe), aber Müll. Der Befund (E29) zählt solche Blöcke; „Aufräumen“ (Schritt V1, nur auf
// ausdrücklichen Wunsch) nimmt sie aus der globalen Konfiguration und legt die Datei je Vault samt Block-Text in die Sicherung. Rückweg: Block und Datei kommen zurück.
// Nur UNSERE Blöcke (mit den Marken von Kortex, höchstens 20 Zeilen) werden angefasst – fremde includeIf-Einträge des Nutzers nie. Als verwaist gilt ein Block nur, wenn
//  · keiner seiner Vault-Pfade einen Versionsverlauf hat,
//  · das Laufwerk erreichbar ist (Pfade unter /Volumes/<Name> mit nicht eingehängtem Laufwerk sind „nicht erreichbar“, nie verwaist) und
//  · Kortex den Vault nicht (mehr) in seiner Vault-Liste (vaults.json) führt.
// Gelöscht oder wiederhergestellt wird die Datei je Vault nur unter <Support>/git/<Kennung>.gitconfig – jeder andere Pfad im Block bleibt unberührt.
import { readFileSync, existsSync, rmSync, rmdirSync, copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { echtesDateiZiel, sichereDatei, sicherungsPfad, hashDatei } from "./protokoll.mjs";
import { kennungen } from "./ziele.mjs";
import { entferneBlock, setzeBlock, markeAnfang, markeEnde } from "./git-umzug.mjs";

export const id = "V1";
export const titel = "Verwaiste Einbindungen im Versionsverlauf aufräumen";

const lies = (datei) => { try { return readFileSync(datei, "utf8"); } catch { return null; } };
const RE_BLOCK = /^# >>> Kortex-Umstellung ([0-9a-f]{8,64}) \(von Kortex verwaltet[^\n]*>>>$/gm;
const unquote = (s) => String(s).replace(/\\(["\\])/g, "$1");
const entmaskiere = (s) => String(s).replace(/\\([\\*?[])/g, "$1");
const MAX_ZEILEN = 20;      // der Block von Kortex hat 6 Zeilen; alles Längere hat der Nutzer erweitert und wird nicht angefasst

// Pfade unter /Volumes/<Name>, deren Laufwerk gerade nicht eingehängt ist, sind nicht erreichbar (externe Platte, Netzlaufwerk)
const unerreichbar = (v, volumen) => v.startsWith(`${volumen}/`) && !existsSync(join(volumen, v.slice(volumen.length + 1).split("/")[0]));
// Vaults, die Kortex kennt (vaults.json im Support-Ordner)
function bekannteVaults(support) {
  if (!support) return [];
  try { const j = JSON.parse(readFileSync(join(support, "vaults.json"), "utf8")); return (Array.isArray(j && j.vaults) ? j.vaults : []).map((e) => e && e.pfad).filter((p) => typeof p === "string").map((p) => resolve(p)); } catch { return []; }
}

// → [{ k, vaulte: [Pfad…], datei: Pfad | null, vaultDa, dateiDa, unerreichbar, bekannt, text }] – alle Blöcke von Kortex in der globalen Konfiguration. Optionen: volumen (Standard /Volumes), support (für vaults.json)
export function leseBloecke(gitGlobal, { volumen = "/Volumes", support = null } = {}) {
  const text = lies(echtesDateiZiel(gitGlobal));
  if (text === null) return [];
  const bekannt = bekannteVaults(support);
  const aus = [];
  for (const m of text.matchAll(RE_BLOCK)) {
    const k = m[1];
    const von = m.index, ende = text.indexOf(markeEnde(k), von);
    if (ende < 0) continue;
    const roh = text.slice(von, ende + markeEnde(k).length);
    if (roh.split("\n").length > MAX_ZEILEN) continue;
    const vaulte = [];
    for (const g of roh.matchAll(/^\[includeIf "gitdir(?:\/i)?:((?:[^"\\]|\\.)*)"\]$/gm)) {
      const muster = entmaskiere(unquote(g[1]));
      const v = muster.replace(/\/\.git\/worktrees\/$/, "").replace(/\/\.git$/, "");
      if (v && !vaulte.includes(v)) vaulte.push(v);
    }
    const pm = /^\tpath = "((?:[^"\\]|\\.)*)"$/m.exec(roh);
    const datei = pm ? unquote(pm[1]) : null;
    aus.push({
      k, vaulte, datei, text: roh + "\n", vaultDa: vaulte.some((v) => existsSync(join(v, ".git"))), dateiDa: !!datei && existsSync(datei),
      unerreichbar: vaulte.some((v) => unerreichbar(v, volumen)),
      bekannt: vaulte.some((v) => bekannt.includes(resolve(v)) || kennungen(v).includes(k)) || bekannt.some((p) => kennungen(p).includes(k)),
    });
  }
  return aus;
}
// verwaist = keiner der Vault-Pfade des Blocks hat (noch) einen Versionsverlauf, das Laufwerk ist erreichbar und Kortex kennt den Vault nicht mehr
export const findeVerwaiste = (gitGlobal, opt) => leseBloecke(gitGlobal, opt).filter((b) => b.vaulte.length > 0 && !b.vaultDa && !b.unerreichbar && !b.bekannt);
// die Datei je Vault liegt immer genau hier (git-umzug.mjs#dateiJeVault)
const erwarteteDatei = (support, k) => join(support, "git", `${k}.gitconfig`);
const optionen = (z) => ({ volumen: z.volumenWurzel || "/Volumes", support: z.support });

export function plan(z) {
  const n = findeVerwaiste(z.gitGlobal, optionen(z)).length;
  return { noetig: n > 0, text: n > 0 ? `${n} ${n === 1 ? "Eintrag" : "Einträge"} in deinen persönlichen Einstellungen für den Versionsverlauf ${n === 1 ? "zeigt" : "zeigen"} auf Vaults, die es nicht mehr gibt.` : "Keine verwaisten Einträge.", anzahl: n };
}

export function wende(z, ctx) {
  const liste = findeVerwaiste(z.gitGlobal, optionen(z));
  if (!liste.length) return { status: "nichts" };
  const sicherung = sichereDatei(z, ctx.sicherungsDir, echtesDateiZiel(z.gitGlobal), "gitconfig-global.vor-v1");
  // `datei` nur, wenn sie genau an der erwarteten Stelle im Support-Ordner liegt: alles andere im Block wird nie angefasst
  const undo = {
    global: { sicherung: sicherung && sicherung.rel, hashVorher: hashDatei(echtesDateiZiel(z.gitGlobal)) },
    bloecke: liste.map((b) => ({ k: b.k, text: b.text, datei: b.datei === erwarteteDatei(z.support, b.k) ? b.datei : null, dateiSicherung: null, dateiHash: null })),
  };
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
export function nachpruefen(z) { return findeVerwaiste(z.gitGlobal, optionen(z)).length === 0; }

export function zurueck(z, ctx, undo) {
  const hinweise = [];
  if (!undo || !undo.bloecke) return { status: "nichts", hinweise };
  let n = 0;
  for (const eintrag of undo.bloecke) {
    if (eintrag.datei && eintrag.datei === erwarteteDatei(z.support, eintrag.k) && eintrag.dateiSicherung && !existsSync(eintrag.datei)) {
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
