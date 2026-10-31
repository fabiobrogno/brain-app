// umstellung/probelauf-b.mjs — der Probelauf für Phase B an einer Kopie (Paket P7d, Plan Abschnitt 2.3 „Phase-B-Probelauf“ und 4.1 Nr. 5). Wie in Phase A: Pflicht, bevor am Original etwas angeboten wird.
//
// Die Kopie (APFS-Klon in Temp, siehe probelauf.mjs) bekommt einen eigenen Support-Ordner mit eigener Ablage: Archiv, Sicherungen und Protokoll von Phase B liegen dort, nichts davon am Original.
// An der Kopie läuft Phase B (B0–B3) mit denselben Funktionen wie am Original, danach die Prüfung (Kriterien 1–5), dann der RÜCKWEG (Revert, Archiv zurück) mit Vergleich Byte für Byte, und
// zuletzt der Vergleich „Original unberührt“. Erst ein grüner Probelauf (Merker probelauf-b.json, gilt 24 Stunden und nur für denselben Stand) öffnet die Bedingung „Probelauf“ des Tors.
import { mkdtempSync, chmodSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { kernVersion, ALT_KIT_ORDNER } from "../pfade.mjs";
import { merkerDateiFuer } from "../backup.mjs";
import { probeZiele, kennung, ordnerGroesseGrob, raeumeWeg, gitLauf } from "./ziele.mjs";
import { erstelleBefund } from "./befund.mjs";
import { bereitFehler, UmstellungsFehler } from "./schrittliste.mjs";
import { SCHRITTE_B } from "./phase-b-schritte.mjs";
import { phaseB, normalisiereEntscheidungenB } from "./phase-b.mjs";
import { rueckweg } from "./rueckweg.mjs";
import { pruefeVertrauen } from "./phase-a.mjs";
import { protokolliere, jetztIso, oeffneAblage, liesZustand, hashDatei } from "./protokoll.mjs";
import { momentaufnahme, unterschiede, ampel } from "./pruefung.mjs";
import { kopiereVault, legeKopieAn, sichereKopieGit, schreibeProbeSupport, raeumeAlteProben } from "./probelauf.mjs";
import { schreibeProbelaufBMerker, loescheProbelaufBMerker, fingerabdruckB } from "./probelauf-b-merker.mjs";
import { baumHash, lexists } from "./baum.mjs";

const T6 = { nr: 6, id: "rueckweg", titel: "Der Rückweg stellt den alten Zustand Byte für Byte wieder her" };
const T7 = { nr: 7, id: "original", titel: "Dein Original wurde nicht verändert" };

export function planProbelaufB(z) {
  return { kopie: "APFS-Klon in einem Temp-Ordner (braucht fast keinen Platz), wird danach gelöscht", groesseGrob: ordnerGroesseGrob(z.vault), schritte: SCHRITTE_B.map((s) => ({ id: s.id, titel: s.titel })) };
}

// Unterstützung der Kopie: Gerätekennung und Sicherungsmerker dieses Macs, damit B2 sie wie am Original findet (die Kennung hängt am Pfad des Vaults)
function uebernimmMerker(z, pz) {
  const gid = join(z.support, "umstellung", "geraet.json");
  if (existsSync(gid)) { mkdirSync(join(pz.support, "umstellung"), { recursive: true, mode: 0o700 }); copyFileSync(gid, join(pz.support, "umstellung", "geraet.json")); }
  const von = merkerDateiFuer(z.vault, z.support), nach = merkerDateiFuer(pz.vault, pz.support);
  if (existsSync(von)) { mkdirSync(dirname(nach), { recursive: true, mode: 0o700 }); copyFileSync(von, nach); chmodSync(nach, 0o600); }
}
const treeVon = (pz) => { const r = gitLauf(pz, ["rev-parse", "--verify", "-q", "HEAD^{tree}"]); return r.status === 0 ? r.stdout.trim() : null; };
const stand = (pz) => ({
  kit: lexists(join(pz.vault, ALT_KIT_ORDNER)) ? baumHash(join(pz.vault, ALT_KIT_ORDNER)) : null, config: hashDatei(join(pz.vault, "brain.config.json")), gitignore: hashDatei(join(pz.vault, ".gitignore")), tree: treeVon(pz),
});

export async function probelaufB(z, { entscheidungen = {}, bestaetigt = false, kopierer = kopiereVault, behalten = false, nachbarkopie = false } = {}) {
  const ent = normalisiereEntscheidungenB(entscheidungen);
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, ...planProbelaufB(z) };
  const bf = bereitFehler(z);
  if (bf) throw bf;
  pruefeVertrauen(z);
  if (liesZustand(z).phase !== "A") throw new UmstellungsFehler("nicht-umgestellt", "Phase A ist noch nicht abgeschlossen. Stelle zuerst um. Es wurde nichts verändert.", 4);
  const befund = erstelleBefund({ vault: z.vault, home: z.home, support: z.support, claudeHomes: null });
  if (!befund.umstellbar) throw new UmstellungsFehler("blocker", "Vorher muss etwas behoben werden (siehe Befund). Es wurde nichts verändert.", 4);
  oeffneAblage(z);
  raeumeAlteProben(z);
  const vorher = momentaufnahme(z);
  const fpVorher = fingerabdruckB(z);
  const wurzel = mkdtempSync(join(tmpdir(), `kortex-probelauf-${kennung(z.vault)}-`));
  chmodSync(wurzel, 0o700);
  let kopie = null, nachbar = null;
  const aufraeumen = () => { raeumeWeg(wurzel); if (nachbar) raeumeWeg(nachbar); };
  try {
    const k = legeKopieAn(z, wurzel, kopierer, { nachbarkopie: nachbarkopie || ent.nachbarkopie === true });
    kopie = k.kopie; if (k.nachbar) nachbar = k.kopie;
    sichereKopieGit(kopie);
    schreibeProbeSupport(z, wurzel, kopie);
    const pz = probeZiele(z, { wurzel, kopie });
    pz.kopieArt = k.art;
    uebernimmMerker(z, pz);
    const davor = stand(pz);

    // --- Phase B an der Kopie ---------------------------------------------------------------------------------------------------
    const lauf = await phaseB(pz, { entscheidungen: ent, bestaetigt: true, ohneVaultSperre: true });
    for (const s of lauf.schritte || []) protokolliere(z, { lauf: "probe", schritt: s.id, ereignis: s.status === "ok" ? "ok" : s.status === "fehler" ? "fehler" : s.status === "rot" ? "fehler" : s.status, anzahl: s.anzahl, grund: s.grund });
    let kriterien = [];
    if (lauf.ok) {
      kriterien = (lauf.b4.kriterien || []).map((c) => ({ nr: c.nr, id: c.id, titel: c.titel, status: c.status, ...(c.grund ? { grund: c.grund } : {}) }));
      // 6: der Rückweg an der Kopie
      const r = await rueckweg(pz, { schritte: ["B3", "B2", "B1"], bestaetigt: true });
      const danach = stand(pz);
      const fehler = r.schritte.find((s) => s.status === "fehler");
      let grund = null;
      if (fehler || (r.hinweise || []).length) grund = "rueckweg-unvollstaendig";
      else if (danach.kit !== davor.kit) grund = "kit-weicht-ab";
      else if (danach.config !== davor.config) grund = "config-weicht-ab";
      else if (danach.gitignore !== davor.gitignore) grund = "gitignore-weicht-ab";
      else if (danach.tree !== davor.tree) grund = "verlauf-weicht-ab";
      kriterien.push(grund ? { ...T6, status: "rot", grund, hinweise: [...(r.hinweise || []), ...r.schritte.filter((x) => x.status === "fehler").map((x) => `${x.id}:${x.grund}`)] } : { ...T6, status: "gruen" });
    } else {
      kriterien = [{ nr: 0, id: "schritt", titel: `Ein Schritt (${lauf.fehlerBei}) hat an der Kopie nicht geklappt`, status: "rot", grund: lauf.grund }];
    }
    // 7: das Original ist unberührt
    const nachher = momentaufnahme(z);
    const diff = unterschiede(vorher, nachher);
    const fpNachher = fingerabdruckB(z);
    kriterien.push(diff.length || fpNachher !== fpVorher ? { ...T7, status: "rot", grund: "original-veraendert", bereiche: diff } : { ...T7, status: "gruen" });
    const farbe = ampel(kriterien);
    for (const c of kriterien) protokolliere(z, { lauf: "probe", schritt: `KB${c.nr}`, ereignis: c.status === "rot" ? "fehler" : "ok", grund: c.grund });
    const merker = {
      zeit: jetztIso(), ergebnis: farbe, fingerabdruck: fpVorher, entscheidungen: "", kernVersion: kernVersion(), kopieArt: k.art,
      kriterien: kriterien.map((c) => ({ nr: c.nr, id: c.id, status: c.status, ...(c.grund ? { grund: c.grund } : {}) })),
    };
    if (farbe === "gruen") schreibeProbelaufBMerker(z, merker); else loescheProbelaufBMerker(z);
    const behaltenOrt = farbe === "rot" || behalten ? (nachbar || wurzel) : null;
    if (!behaltenOrt) aufraeumen();
    return { ok: farbe === "gruen", ampel: farbe, kopieArt: k.art, kriterien, schritte: lauf.schritte, fehlerBei: lauf.fehlerBei, merker: farbe === "gruen", kopieBehalten: behaltenOrt ? { wurzel, kopie } : null };
  } catch (e) {
    aufraeumen();
    throw e;
  }
}
