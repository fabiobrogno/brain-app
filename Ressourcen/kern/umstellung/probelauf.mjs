// umstellung/probelauf.mjs — der Probelauf an einer Kopie (Paket P7b, Plan docs/plaene/p7-umstellung.md Abschnitt 2): alle Schritte der Phase A laufen zuerst an einer Kopie des Vaults,
// vollständig abgeschottet, und werden gegen die Prüfkriterien (pruefung.mjs) gehalten. Erst ein grüner Probelauf für DENSELBEN Stand schaltet Phase A am Original frei.
//
//  Kopie       APFS-Klon (cp -c, fast kein Platz) in $TMPDIR/kortex-probelauf-<Kennung>-…; geht das nicht (anderes Laufwerk, kein APFS): Nachbarordner auf demselben Laufwerk,
//              sonst eine volle Kopie (art: "voll"). Die Kopie behält .git (mit origin), damit die git-Prüfungen echt sind.
//  Abschottung eigener Support-Ordner (vaults.json mit der Kopie als aktivem Vault, ohne Merker remoteBestaetigt → kein Push), eigene globale git-Konfiguration (Kopie der echten),
//              GIT_ALLOW_PROTOCOL ohne bekanntes Protokoll (kein Netz), kein launchctl (plist nur rendern + plutil -lint), Claude-Einstellungen und MCP nur im Speicher bzw. nur lesend.
//  Original    Momentaufnahme vorher/nachher (Hashes von .git/config, brain.config.json, git status, HEAD, settings.json samt Änderungszeit je Profil, plist, globaler git-Konfiguration,
//              MCP-Einträgen): jede Abweichung macht den Probelauf rot (Kriterium 9).
//  Ergebnis    Ampel je Kriterium + Merker im Support-Ordner. Die Kopie wird nach Erfolg gelöscht, nach einem Fehler behalten (7 Tage; die Oberfläche bietet „Kopie jetzt löschen“).
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync, lstatSync, existsSync, readdirSync, realpathSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { kernVersion, ALT_KIT_ORDNER } from "../pfade.mjs";
import { probeZiele, kennung, ordnerGroesseGrob, raeumeWeg, freierPlatz } from "./ziele.mjs";
import { gitVerzeichnis } from "./git-lage.mjs";
import { erstelleBefund } from "./befund.mjs";
import { bereitFehler, normalisiereEntscheidungen, waehleProfile, UmstellungsFehler, SCHRITTE } from "./schrittliste.mjs";
import { phaseA, entscheidungenHash, pruefeVertrauen } from "./phase-a.mjs";
import { protokolliere, jetztIso, oeffneAblage } from "./protokoll.mjs";
import { momentaufnahme, fingerabdruck, unterschiede, kriterium1, kriterium2, kriterium3, kriterium4, kriterium5, kriterium6, kriterium7, ampel } from "./pruefung.mjs";
import { schreibeProbelaufMerker, loescheProbelaufMerker } from "./probelauf-merker.mjs";
import { vertraueProbeKopie } from "./vertrauen-merker.mjs";
import { profilAusPlist, LABEL } from "../tageslauf/dienst.mjs";

// Frist des Kopierens; die Werkstatt wartet länger (werkstatt/umstellung.mjs: FRIST_SCHREIBEN ≥ KOPIE_FRIST_MS + Rest des Probelaufs)
export const KOPIE_FRIST_MS = 30 * 60_000;
const PUFFER = 64 * 1024 * 1024;              // Reserve für Protokoll, Bundle, Test-Commit …
const FAKTOR = 1.2;

// Standard-Kopierer: macOS klont (cp -c), sonst/zur Not normal kopieren. `art`: "klon" | "voll". Verweise werden nie verfolgt (cp -R kopiert sie als Verweise).
export function kopiereVault(quelle, ziel, { art = "klon", plattform = process.platform } = {}) {
  const flags = art === "klon" && plattform === "darwin" ? "-cR" : "-R";
  const r = spawnSync("/bin/cp", [flags, quelle, ziel], { encoding: "utf8", timeout: KOPIE_FRIST_MS, windowsHide: true });
  if (r.status !== 0) { try { rmSync(ziel, { recursive: true, force: true }); } catch { /* weg */ } const e = new Error(String(r.stderr || "cp fehlgeschlagen").split("\n")[0]); e.code = /cross-device|different/i.test(r.stderr || "") ? "EXDEV" : /not supported|ENOTSUP/i.test(r.stderr || "") ? "ENOTSUP" : "EIO"; throw e; }
  return { art: flags === "-cR" ? "klon" : "voll" };
}

// Alte Probekopien dieses Vaults (nach einem Fehler oder Abbruch liegen geblieben) wegräumen: ältere als 7 Tage – so lange bleibt eine rote Kopie zur Ansicht. → Anzahl
export function raeumeAlteProben(z, { tage = 7, jetzt = Date.now() } = {}) {
  let n = 0;
  const praefix = `kortex-probelauf-${kennung(z.vault)}-`;
  let namen = [];
  try { namen = readdirSync(tmpdir()); } catch { return 0; }
  for (const name of namen) {
    if (!name.startsWith(praefix)) continue;
    const p = join(tmpdir(), name);
    try { if (jetzt - lstatSync(p).mtimeMs > tage * 86_400_000) { rmSync(p, { recursive: true, force: true }); n++; } } catch { /* bleibt */ }
  }
  return n;
}

// → { kopie, art, nachbar } – legt die Probekopie an. Reihenfolge: Klon in Temp → (nur mit ausdrücklicher Zustimmung, Entscheidung `nachbarkopie`: Klon im Nachbarordner des
// Vaults auf demselben Laufwerk) → volle Kopie in Temp. Vor jedem Versuch wird der freie Platz geprüft (volle Kopie: Größe × 1,2 + Puffer).
export function legeKopieAn(z, wurzel, kopierer, { nachbarkopie = false } = {}) {
  const ziel = join(wurzel, "vault");
  const groesse = ordnerGroesseGrob(z.vault);
  const versuche = [
    { ort: ziel, art: "klon", nachbar: false },
    ...(nachbarkopie ? [{ ort: join(dirname(z.vault), `kortex-probelauf-${kennung(z.vault)}-${randomBytes(3).toString("hex")}`), art: "klon", nachbar: true }] : []),
    { ort: ziel, art: "voll", nachbar: false },
  ];
  let letzter = null, platzMangel = false;
  for (const v of versuche) {
    const noetig = v.art === "voll" ? Math.ceil(groesse * FAKTOR) + PUFFER : PUFFER;
    if (freierPlatz(z, dirname(v.ort)) < noetig) { platzMangel = true; continue; }
    try { const r = kopierer(z.vault, v.ort, { art: v.art }); return { kopie: v.ort, art: (r && r.art) || v.art, nachbar: v.nachbar }; }
    catch (e) { letzter = e; try { rmSync(v.ort, { recursive: true, force: true }); } catch { /* weg */ } }
  }
  if (platzMangel && !letzter) throw new UmstellungsFehler("zu-wenig-platz", "Für die Probekopie ist nicht genug freier Platz da. Am Original wurde nichts geändert.", 1);
  throw new UmstellungsFehler("kopie-fehlgeschlagen", `Die Probekopie konnte nicht angelegt werden (${(letzter && letzter.code) || "Fehler"}). Am Original wurde nichts geändert.`, 1);
}

// Die Kopie muss ein in sich geschlossener Versionsverlauf sein: kein .git außerhalb, keine fremden Objektspeicher; Verweise im .git-Ordner (die cp als Verweise ins ORIGINAL
// mitbrächte) werden durch echte Kopien ersetzt – sonst schriebe git in der Kopie ins Original. Sonst Abbruch (die Kopie wird dann gelöscht).
export function sichereKopieGit(kopie) {
  const gv = gitVerzeichnis(kopie);
  if (gv.art === "keins") return;
  if (gv.art !== "ordner" || gv.draussen || gv.alternates) throw new UmstellungsFehler("kopie-git", "Der Versionsverlauf dieses Vaults liegt nicht vollständig im Vault-Ordner. Eine Probekopie wäre nicht abgeschottet; es wurde nichts geändert.", 4);
  for (const rel of gv.verweise) {
    const p = join(kopie, ".git", rel);
    let ziel;
    try { ziel = realpathSync(p); } catch { throw new UmstellungsFehler("kopie-git", "Im Versionsverlauf zeigt eine Verknüpfung ins Leere. Es wurde nichts geändert.", 4); }
    if (ordnerGroesseGrob(ziel) > 50 * 1024 * 1024) throw new UmstellungsFehler("kopie-git", "Eine Verknüpfung im Versionsverlauf zeigt auf etwas sehr Großes. Es wurde nichts geändert.", 4);
    rmSync(p, { force: true });
    cpSync(ziel, p, { recursive: true, dereference: true });
  }
}

export function schreibeProbeSupport(z, wurzel, kopie) {
  const support = join(wurzel, "support");
  mkdirSync(support, { recursive: true, mode: 0o700 });
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: kopie, name: "Probekopie" }], aktiv: kopie }, null, 2) + "\n", { mode: 0o600 });
  vertraueProbeKopie(support, kopie);
  // eigene globale git-Konfiguration: Kopie der echten (Rechte 0600), damit Anmeldehilfen & Co. wie im Alltag wirken – geschrieben wird nur die Kopie
  const gg = join(wurzel, "gitconfig");
  if (existsSync(z.gitGlobal)) { copyFileSync(z.gitGlobal, gg); chmodSync(gg, 0o600); } else writeFileSync(gg, "", { mode: 0o600 });
}

// Plan (lesend, ohne Bestätigung): was der Probelauf täte
export function planProbelauf(z) {
  return { kopie: "APFS-Klon in einem Temp-Ordner (braucht fast keinen Platz), wird danach gelöscht", groesseGrob: ordnerGroesseGrob(z.vault), schritte: SCHRITTE.map((s) => ({ id: s.id, titel: s.titel })) };
}

export async function probelauf(z, { entscheidungen = {}, bestaetigt = false, kopierer = kopiereVault, behalten = false } = {}) {
  // Die Entscheidungen so, wie sie gewählt wurden: der Merker hasht sie, Phase A vergleicht mit denselben (die Schritte an der Kopie bestätigen ein Online-Ziel nie – phaseA(probe) erzwingt es)
  const ent = normalisiereEntscheidungen(entscheidungen);
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, ...planProbelauf(z) };
  const bf = bereitFehler(z);
  if (bf) throw bf;
  pruefeVertrauen(z);
  const befund = erstelleBefund({ vault: z.vault, home: z.home, support: z.support, claudeHomes: null });
  if (!befund.umstellbar) throw new UmstellungsFehler("blocker", "Vorher muss etwas behoben werden (siehe Befund). Es wurde nichts verändert.", 4);
  oeffneAblage(z);
  raeumeAlteProben(z);
  const vorher = momentaufnahme(z);
  const wurzel = mkdtempSync(join(tmpdir(), `kortex-probelauf-${kennung(z.vault)}-`));
  chmodSync(wurzel, 0o700);
  let kopie = null, nachbar = null;
  const aufraeumen = () => { raeumeWeg(wurzel); if (nachbar) raeumeWeg(nachbar); };
  try {
    const k = legeKopieAn(z, wurzel, kopierer, { nachbarkopie: ent.nachbarkopie === true });
    kopie = k.kopie; if (k.nachbar) nachbar = k.kopie;
    sichereKopieGit(kopie);
    schreibeProbeSupport(z, wurzel, kopie);
    const pz = probeZiele(z, { wurzel, kopie });
    pz.kopieArt = k.art;
    const profile = waehleProfile(z, ent);

    // --- die Schritte der Phase A an der Kopie -------------------------------------------------------------------------------
    const lauf = await phaseA(pz, { entscheidungen: ent, schritte: SCHRITTE.map((s) => s.id), bestaetigt: true, ohneVaultSperre: true });
    for (const s of lauf.schritte || []) protokolliere(z, { lauf: "probe", schritt: s.id, ereignis: s.status === "ok" ? "ok" : s.status === "fehler" ? "fehler" : s.status, anzahl: s.anzahl, grund: s.grund });
    let kriterien = [];
    if (lauf.ok) {
      const altesProfil = (() => { try { return profilAusPlist(join(z.launchAgents, `${LABEL}.plist`)); } catch { return null; } })();
      const ctx = { profile, los: `${kennung(z.vault)}-${jetztIso()}`, endeZuEnde: true, altesProfil };
      kriterien = [kriterium1(pz), kriterium2(pz, ctx), kriterium3(pz, { testCommit: true }), kriterium4(pz, ctx, { vorschau: true }), await kriterium5(pz, ctx, { probe: true }), kriterium6(pz, ctx, { probe: true }), kriterium7(pz, ctx)];
      // 8: Phase-B-Probe – die Kopie ohne den alten Werkzeug-Ordner, die Kriterien 1–4 erneut
      kriterien.push(phaseBProbe(pz, ctx));
    } else {
      kriterien = [{ nr: 0, id: "schritt", titel: `Ein Schritt (${lauf.fehlerBei}) hat an der Kopie nicht geklappt`, status: "rot", grund: lauf.grund }];
    }
    // 9: das Original ist unberührt
    const nachher = momentaufnahme(z);
    const diff = unterschiede(vorher, nachher);
    kriterien.push(diff.length
      ? { nr: 9, id: "original", titel: "Dein Original wurde nicht verändert", status: "rot", grund: "original-veraendert", bereiche: diff }
      : { nr: 9, id: "original", titel: "Dein Original wurde nicht verändert", status: "gruen" });
    const farbe = ampel(kriterien);
    for (const c of kriterien) protokolliere(z, { lauf: "probe", schritt: `K${c.nr}`, ereignis: c.status === "rot" ? "fehler" : "ok", grund: c.grund });
    const merker = {
      zeit: jetztIso(), ergebnis: farbe, fingerabdruck: fingerabdruck(vorher), entscheidungen: entscheidungenHash(ent), kernVersion: kernVersion(), kopieArt: k.art,
      kriterien: kriterien.map((c) => ({ nr: c.nr, id: c.id, status: c.status, ...(c.grund ? { grund: c.grund } : {}) })),
    };
    if (farbe === "gruen") schreibeProbelaufMerker(z, merker); else loescheProbelaufMerker(z);
    const behaltenOrt = farbe === "rot" || behalten ? (nachbar || wurzel) : null;
    if (!behaltenOrt) aufraeumen(); else if (nachbar) { /* der Nachbar bleibt, die Temp-Wurzel mit Support-Ordner auch */ }
    return { ok: farbe === "gruen", ampel: farbe, kopieArt: k.art, kriterien, schritte: lauf.schritte, fehlerBei: lauf.fehlerBei, merker: farbe === "gruen", kopieBehalten: behaltenOrt ? { wurzel, kopie } : null };
  } catch (e) {
    aufraeumen();
    throw e;
  }
}

// Kriterium 8 (Plan 2.4): in der Kopie den alten Werkzeug-Ordner entfernen und 1–4 erneut prüfen. (Config bereinigen und Commit der Kopie gehören zu Phase B / P7d.)
function phaseBProbe(pz, ctx) {
  const t = (nr) => ({ nr: 8, id: "phase-b-probe", titel: "Auch ohne den alten Werkzeug-Ordner funktioniert alles" });
  const alt = join(pz.vault, ALT_KIT_ORDNER);
  let da = false; try { lstatSync(alt); da = true; } catch { /* keiner */ }
  if (!da) return { ...t(), status: "uebersprungen", grund: "kein-alter-ordner" };
  try { rmSync(alt, { recursive: true, force: true }); } catch { return { ...t(), status: "rot", grund: "ordner-nicht-entfernbar" }; }
  const teile = [kriterium1(pz), kriterium2(pz, ctx), kriterium3(pz, { testCommit: false }), kriterium4(pz, { ...ctx, endeZuEnde: false }, { vorschau: true })];
  const rot = teile.find((c) => c.status === "rot");
  return rot ? { ...t(), status: "rot", grund: `${rot.id}:${rot.grund}` } : { ...t(), status: "gruen" };
}
