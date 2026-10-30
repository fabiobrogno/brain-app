// umstellung/aufraeumen.mjs — Aufräumen nach der Umstellung (Paket P7d, Plan Abschnitt 4.2 „Nach 30 Tagen bietet Kortex an …“ und Risiko 3). NUR AUF KLICK: Kortex bietet an, löscht nie von selbst.
//
// Angebote (`angebote`, nur lesend):
//   verwaist       Einbindungen von Vaults, die es nicht mehr gibt, aus den persönlichen Einstellungen für den Versionsverlauf nehmen (Schritt V1, Rückweg: `zurueck --schritt V1`) – sofort möglich
//   archiv         das Archiv des alten Werkzeug-Ordners (kit-<Datum>) in den Papierkorb legen – ab 30 Tage nach dem Datum im Namen
//   sicherungen    Kopien mit möglichen Zugangsdaten (Sicherungen der Umstellung, .git/config.vor-kortex, .bak-Dateien von Claude) in den Papierkorb – 30 Tage nach Phase B
//   bundles        die Sicherungen des Versionsverlaufs (vor-kortex.bundle, vor-phase-b.bundle) in den Papierkorb – 30 Tage nach Phase B
// „Papierkorb“ heißt: Finder-Papierkorb (Zurücklegen bleibt möglich); nur wenn das nicht geht, wird in ~/.Trash verschoben. Gelöscht wird nie. Was wohin wandert, bestimmt allein dieses Modul
// (nie ein Pfad von außen). Die Sicherungen der Umstellung zu entfernen heißt auch: die Umstellung lässt sich danach nicht mehr zurücknehmen – das steht im Angebotstext.
import { readdirSync, lstatSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { UmstellungsFehler, schrittKontext, undoListe } from "./schrittliste.mjs";
import { liesZustand, schreibeZustand, protokolliere, ablageOrdner, setzeSperre, loeseSperre, oeffneAblage, sicherungsOrdner, stempel, jetztIso } from "./protokoll.mjs";
import { baumGroesse, lexists } from "./baum.mjs";
import * as V1 from "./verwaist.mjs";

export const FRIST_TAGE = 30;
export const WAS = ["verwaist", "archiv", "sicherungen", "bundles"];
const TAG_MS = 86_400_000;

const archivDatum = (name) => { const m = /^kit-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/.exec(name); return m ? Date.parse(`${m[1]}T00:00:00Z`) : NaN; };
function archive(z) {
  let namen = [];
  try { namen = readdirSync(ablageOrdner(z)); } catch { return []; }
  return namen.filter((n) => /^kit-\d{4}-\d{2}-\d{2}(?:-\d+)?$/.test(n)).map((n) => ({ name: n, pfad: join(ablageOrdner(z), n), zeit: archivDatum(n) })).filter((a) => { try { return lstatSync(a.pfad).isDirectory(); } catch { return false; } });
}
function phaseBZeit(zustand) { const t = zustand.phaseB && zustand.phaseB.status === "fertig" ? Date.parse(zustand.phaseB.zeit) : NaN; return Number.isFinite(t) ? t : null; }

// Dateien/Ordner der Gruppen `sicherungen` und `bundles` (nur, was es gibt)
export function sicherungsPfade(z, zustand = liesZustand(z)) {
  const ablage = ablageOrdner(z);
  const kopien = [join(ablage, "sicherungen"), join(z.vault, ".git", "config.vor-kortex")];
  // .bak-Dateien, die die Umstellung bei den Claude-Profilen angelegt hat (A4 hat sie mit Hash vermerkt)
  for (const u of undoListe(z, zustand, "A4")) for (const p of (u && u.profile) || []) for (const b of p.bakNeu || []) if (b && typeof b.pfad === "string" && /\.bak-/.test(basename(b.pfad))) kopien.push(b.pfad);
  const bundles = [join(ablage, "vor-kortex.bundle"), join(ablage, "vor-phase-b.bundle")];
  return { sicherungen: kopien.filter(lexists), bundles: bundles.filter(lexists) };
}
const groesse = (pfade) => pfade.reduce((a, p) => { try { const l = lstatSync(p); return a + (l.isDirectory() ? baumGroesse(p).bytes : l.size); } catch { return a; } }, 0);

// → [{ id, titel, text, anzahl, bytes?, faellig, tage?, ab? }] – nur lesend. `faellig`: darf jetzt angeboten werden.
export function angebote(z, { jetzt = Date.now() } = {}) {
  const aus = [];
  const zustand = liesZustand(z);
  let waisen = 0; try { waisen = V1.findeVerwaiste(z.gitGlobal).length; } catch { /* keine globale Konfiguration */ }
  if (waisen > 0) aus.push({ id: "verwaist", titel: "Verwaiste Einträge im Versionsverlauf aufräumen", text: `${waisen} ${waisen === 1 ? "Eintrag" : "Einträge"} in deinen persönlichen Einstellungen für den Versionsverlauf ${waisen === 1 ? "gehört" : "gehören"} zu Vaults, die es nicht mehr gibt. Kortex kann ${waisen === 1 ? "ihn" : "sie"} entfernen; das lässt sich zurücknehmen.`, anzahl: waisen, faellig: true, rueckweg: "zurueck --schritt V1" });
  for (const a of archive(z)) {
    const tage = Number.isFinite(a.zeit) ? Math.floor((jetzt - a.zeit) / TAG_MS) : 0;
    aus.push({ id: "archiv", name: a.name, titel: "Archiv des alten Werkzeug-Ordners in den Papierkorb legen", text: tage >= FRIST_TAGE ? `Der alte Werkzeug-Ordner liegt seit ${tage} Tagen im Archiv. Wenn alles läuft, kannst du ihn in den Papierkorb legen (Zurücklegen bleibt im Finder möglich).` : `Der alte Werkzeug-Ordner liegt im Archiv; Kortex bietet das Aufräumen nach ${FRIST_TAGE} Tagen an.`,
      anzahl: 1, bytes: baumGroesse(a.pfad).bytes, tage, faellig: tage >= FRIST_TAGE, ab: FRIST_TAGE });
  }
  const bz = phaseBZeit(zustand);
  if (bz !== null) {
    const tage = Math.floor((jetzt - bz) / TAG_MS), faellig = tage >= FRIST_TAGE;
    const sp = sicherungsPfade(z, zustand);
    if (sp.sicherungen.length) aus.push({ id: "sicherungen", titel: "Sicherungskopien der Umstellung in den Papierkorb legen", text: faellig ? `Die Sicherungskopien der Umstellung (Einstellungen von Claude und git, ${sp.sicherungen.length} Stellen) können Zugangsdaten enthalten und werden nicht mehr gebraucht, wenn alles läuft. Danach lässt sich die Umstellung nicht mehr zurücknehmen.` : `Die Sicherungskopien der Umstellung bleiben ${FRIST_TAGE} Tage nach dem Aufräumen liegen.`, anzahl: sp.sicherungen.length, bytes: groesse(sp.sicherungen), tage, faellig, ab: FRIST_TAGE });
    if (sp.bundles.length) aus.push({ id: "bundles", titel: "Sicherungen des Versionsverlaufs in den Papierkorb legen", text: faellig ? `Die Sicherungen des Versionsverlaufs (${sp.bundles.length} ${sp.bundles.length === 1 ? "Datei" : "Dateien"}) waren die letzte Rettung. Wenn dein Vault läuft und gesichert ist, kannst du sie wegräumen.` : `Die Sicherungen des Versionsverlaufs bleiben ${FRIST_TAGE} Tage nach dem Aufräumen liegen.`, anzahl: sp.bundles.length, bytes: groesse(sp.bundles), tage, faellig, ab: FRIST_TAGE });
  }
  return aus;
}

// Finder-Papierkorb (Zurücklegen bleibt möglich); in der Testumgebung und als Rückfall: Verschieben nach ~/.Trash. Tests können z.papierkorb(pfad) setzen.
export function inPapierkorb(z, pfad) {
  if (typeof z.papierkorb === "function") return z.papierkorb(pfad);
  const test = z.env && (z.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || z.env.BRAIN_TESTMODUS === "1");
  if (!test && z.plattform === "darwin" && existsSync("/usr/bin/osascript")) {
    const r = spawnSync("/usr/bin/osascript", ["-e", "on run argv", "-e", 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', "-e", "end run", pfad], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    if (r.status === 0 && !lexists(pfad)) return "finder";
  }
  const korb = join(z.home, ".Trash");
  mkdirSync(korb, { recursive: true });
  let ziel = join(korb, basename(pfad)), i = 1;
  while (lexists(ziel)) ziel = join(korb, `${basename(pfad)} ${++i}`);
  renameSync(pfad, ziel);
  return "verschoben";
}

function fuehreSchrittAus(z, s, bestaetigt) {
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, was: "verwaist", ...s.plan(z) };
  oeffneAblage(z);
  if (!setzeSperre(z)) throw new UmstellungsFehler("laeuft-schon", "Die Umstellung läuft gerade. Warte, bis sie fertig ist.", 5);
  try {
    const zustand = liesZustand(z), lauf = stempel();
    const c = schrittKontext(z, { schritt: s, entscheidungen: {}, profile: [], lauf, sicherungsDir: sicherungsOrdner(z, `aufraeumen-${lauf}`), zustand });
    protokolliere(z, { schritt: s.id, ereignis: "start" });
    let res;
    try {
      res = s.wende(z, c);
      if (res.status === "ok" && s.nachpruefen && !s.nachpruefen(z, c)) throw new Error("nachpruefung-fehlgeschlagen");
    } catch (e) {
      try { if (c.undo) s.zurueck(z, c, c.undo); } catch { /* unten gemeldet */ }
      const grund = String((e && e.message) || "fehler").split("\n")[0].slice(0, 80);
      zustand.schritte[s.id] = { ...(zustand.schritte[s.id] || {}), status: "fehler", zeit: jetztIso(), grund };
      schreibeZustand(z, zustand);
      protokolliere(z, { schritt: s.id, ereignis: "fehler", grund });
      return { ok: false, was: "verwaist", fehlerBei: s.id, grund };
    }
    zustand.schritte[s.id] = { ...(zustand.schritte[s.id] || {}), status: res.status, zeit: jetztIso(), anzahl: res.anzahl };
    schreibeZustand(z, zustand);
    protokolliere(z, { schritt: s.id, ereignis: res.status === "ok" ? "ok" : res.status, anzahl: res.anzahl, sicherung: zustand.schritte[s.id].undo });
    return { ok: true, was: "verwaist", bestaetigt: true, geaendert: res.status === "ok", anzahl: res.anzahl || 0 };
  } finally { loeseSperre(z); }
}

// Führt EIN Angebot aus (nur mit bestaetigt). `name`: bei `archiv` der Name des Archivs (kit-<Datum>), sonst nicht nötig. Ohne bestaetigt: nur das Angebot (lesend).
export function raeume(z, { was, name = null, bestaetigt = false, jetzt = Date.now() } = {}) {
  if (!WAS.includes(was)) throw new UmstellungsFehler("unbekannt", "Unbekanntes Angebot.", 64);
  if (was === "verwaist") return fuehreSchrittAus(z, V1, bestaetigt);
  const liste = angebote(z, { jetzt }).filter((a) => a.id === was && (was !== "archiv" || a.name === name));
  if (!liste.length) throw new UmstellungsFehler("nichts-da", "Dazu gibt es gerade nichts aufzuräumen.", 4);
  const angebot = liste[0];
  if (!angebot.faellig) throw new UmstellungsFehler("noch-nicht", `Das bietet Kortex erst ${FRIST_TAGE} Tage nach dem Aufräumen an.`, 4);
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, was, angebot };
  oeffneAblage(z);
  if (!setzeSperre(z)) throw new UmstellungsFehler("laeuft-schon", "Die Umstellung läuft gerade. Warte, bis sie fertig ist.", 5);
  try {
    const zustand = liesZustand(z);
    const pfade = was === "archiv" ? [join(ablageOrdner(z), name)] : sicherungsPfade(z, zustand)[was];
    let n = 0, uebrig = 0;
    for (const p of pfade) { try { inPapierkorb(z, p); n++; } catch { uebrig++; } }
    zustand.aufgeraeumt = { ...(zustand.aufgeraeumt || {}), [was]: jetztIso() };
    schreibeZustand(z, zustand);
    protokolliere(z, { schritt: "V2", ereignis: uebrig ? "fehler" : "ok", anzahl: n, grund: `${was}-papierkorb` });
    return { ok: uebrig === 0, was, bestaetigt: true, anzahl: n, uebrig };
  } finally { loeseSperre(z); }
}
