// umstellung/phase-a.mjs — Phase A der Umstellung (Paket P7b, Plan docs/plaene/p7-umstellung.md Abschnitt 3): alles AUSSERHALB des versionierten Vault-Inhalts, Schritt für Schritt,
// jeder mit Rückweg und Protokoll im Support-Ordner. Die Schritte sind idempotent; ein Fehler nimmt NUR den betroffenen Schritt zurück und hält an; ein Absturz mitten in der
// Phase lässt sich mit „Weitermachen“ (erneut starten) oder „Rückgängig machen“ (rueckweg.mjs) beenden, weil die Rückweg-Angaben vor dem ersten Schreiben eines Schritts stehen.
//
// Nichts läuft ohne ausdrückliche Bestätigung (`bestaetigt: true`, CLI --ja) – ohne sie liefert phaseA() nur den PLAN (lesend). Am Original läuft sie nur nach einem grünen
// Probelauf für DENSELBEN Stand (Fingerabdruck, siehe probelauf.mjs). Ablauf: Sperre → A0 Sicherung → A1–A8 → A9 Prüfung am Original → Zustand „Phase A“.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { kernVersion } from "../pfade.mjs";
import { erstelleBefund } from "./befund.mjs";
import {
  SCHRITTE, ALLE_IDS, UmstellungsFehler, normalisiereEntscheidungen, waehleProfile, schrittKontext, bereitFehler,
} from "./schrittliste.mjs";
import {
  liesZustand, schreibeZustand, protokolliere, setzeSperre, loeseSperre, setzeVaultSperre, loeseVaultSperre, pruefeSperre, ablageOrdner, sicherungsOrdner, stempel, jetztIso, oeffneAblage, hashText,
} from "./protokoll.mjs";
import { momentaufnahme, fingerabdruck, pruefeAmOriginal, ampel } from "./pruefung.mjs";
import { leseProbelaufMerker } from "./probelauf-merker.mjs";
import { vermerkeUmgestellt } from "./vertrauen-merker.mjs";

// Prüfmarke für Tests: simuliert den Abbruch des Prozesses (kein Rückweg des laufenden Schritts, die Sperre wird gelöst)
export class TestAbbruch extends Error { constructor(wo) { super(`Testabbruch ${wo}`); this.name = "TestAbbruch"; } }

export const entscheidungenHash = (ent) => hashText(JSON.stringify(Object.fromEntries(Object.entries(ent).sort())));

// → [{ id, titel, noetig, text, … }] – nur lesend (Schritt A9 und die Vorbedingungen stehen am Ende)
export function planPhaseA(z, { entscheidungen = {} } = {}) {
  const ent = normalisiereEntscheidungen(entscheidungen);
  const ctx = { entscheidungen: ent, profile: waehleProfile(z, ent) };
  return SCHRITTE.map((s) => { let p; try { p = s.plan(z, ctx); } catch (e) { p = { noetig: false, text: "Konnte nicht geprüft werden.", grund: "plan-fehler" }; } return { id: s.id, titel: s.titel, ...p }; })
    .concat([{ id: "A9", titel: "Prüfung am Original", noetig: true, text: "Kortex prüft zum Schluss, ob alles läuft (nur lesend)." }]);
}

// Zustand für die Oberfläche (nur lesend, keine Werte)
export function standPhaseA(z) {
  const zu = liesZustand(z);
  const s = pruefeSperre(z);
  const merker = leseProbelaufMerker(z);
  let gueltig = false;
  if (merker && merker.ergebnis === "gruen") { try { gueltig = merker.fingerabdruck === fingerabdruck(momentaufnahme(z, { mitStatus: false })); } catch { gueltig = false; } }
  return {
    phase: zu.phase, kernVersion: zu.kernVersion, schritte: Object.fromEntries(Object.entries(zu.schritte).map(([id, e]) => [id, { status: e.status, zeit: e.zeit, anzahl: e.anzahl, grund: e.grund }])),
    laeuft: s.belegt, unterbrochen: s.unterbrochen || (!!zu.laeuft && !s.belegt),
    probelauf: merker ? { zeit: merker.zeit, ampel: merker.ergebnis, gueltig } : null, a9: zu.a9 || null,
    bundle: existsSync(join(ablageOrdner(z), "vor-kortex.bundle")),
  };
}

function pruefeVorbedingungen(z, ent, { schritte }) {
  const bf = bereitFehler(z);
  if (bf) throw bf;
  if (z.probe) return;
  // Blocker der Phase A (Befund): Einstellungen kaputt, Ordnernamen ungültig, Verknüpfungen aus dem Vault …
  const befund = erstelleBefund({ vault: z.vault, home: z.home, support: z.support, claudeHomes: null });
  if (!befund.umstellbar) throw new UmstellungsFehler("blocker", "Vorher muss etwas behoben werden (siehe Befund). Es wurde nichts verändert.", 4);
  const merker = leseProbelaufMerker(z);
  if (!merker) throw new UmstellungsFehler("probelauf-fehlt", "Kortex probiert zuerst alles an einer Kopie aus. Starte bitte den Probelauf, bevor du umstellst. Es wurde nichts verändert.", 4);
  if (merker.ergebnis !== "gruen") throw new UmstellungsFehler("probelauf-rot", "Der Probelauf war nicht in Ordnung. Am Original wird deshalb nichts geändert. Schau dir den Bericht an.", 4);
  const jetzt = fingerabdruck(momentaufnahme(z, { mitStatus: false }));
  if (merker.fingerabdruck !== jetzt || merker.entscheidungen !== entscheidungenHash(ent)) throw new UmstellungsFehler("probelauf-veraltet", "Seit dem Probelauf hat sich etwas geändert (oder du hast anders gewählt). Starte den Probelauf bitte noch einmal. Es wurde nichts verändert.", 4);
}

// Hauptfunktion. Optionen: entscheidungen, schritte (Liste von IDs; sonst alle), bestaetigt, abbruchNach/abbruchIn (nur Tests).
export async function phaseA(z, { entscheidungen = {}, schritte = null, bestaetigt = false, abbruchNach = null, abbruchIn = null, ohneVaultSperre = false } = {}) {
  const ent = normalisiereEntscheidungen(entscheidungen);
  if (z.probe) ent.remoteBestaetigen = false;                 // der Probelauf bestätigt nie ein Online-Ziel
  const plan = planPhaseA(z, { entscheidungen: ent });
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, schritte: plan };
  for (const id of schritte || []) if (!ALLE_IDS.includes(id)) throw new UmstellungsFehler("unbekannter-schritt", `Unbekannter Schritt: ${id}`, 64);
  pruefeVorbedingungen(z, ent, { schritte });
  oeffneAblage(z);
  if (!setzeSperre(z)) throw new UmstellungsFehler("laeuft-schon", "Die Umstellung läuft gerade schon. Warte, bis sie fertig ist.", 5);
  let vaultSperre = { ok: false };
  if (!ohneVaultSperre) {
    vaultSperre = setzeVaultSperre(z);
    if (!vaultSperre.ok) { loeseSperre(z); throw new UmstellungsFehler("vault-belegt", "Im Vault arbeitet gerade etwas anderes (zum Beispiel das Einarbeiten von Notizen). Versuche es in ein paar Minuten noch einmal.", 5); }
  }
  const zustand = liesZustand(z);
  const lauf = stempel();
  const sicherungsDir = sicherungsOrdner(z, lauf);
  const profile = waehleProfile(z, ent);
  const wahl = schritte && schritte.length ? new Set(schritte) : new Set(ALLE_IDS);
  if (wahl.size && !wahl.has("A0") && !(zustand.schritte.A0 && zustand.schritte.A0.status === "ok")) wahl.add("A0");   // ohne Sicherung geht nichts
  const ergebnis = [];
  zustand.kernVersion = kernVersion();
  zustand.laeuft = { pid: process.pid, zeit: jetztIso() };
  schreibeZustand(z, zustand);
  try {
    for (const s of SCHRITTE) {
      if (!wahl.has(s.id)) continue;
      const vorher = zustand.schritte[s.id] || {};
      zustand.schritte[s.id] = { ...vorher, status: "laeuft", zeit: jetztIso() };
      zustand.laeuft = { ...zustand.laeuft, schritt: s.id };
      schreibeZustand(z, zustand);
      protokolliere(z, { schritt: s.id, ereignis: "start" });
      const c = schrittKontext(z, { schritt: s, entscheidungen: ent, profile, lauf, sicherungsDir, zustand });
      let res;
      try {
        res = s.wende(z, c);
        if (abbruchIn === s.id) throw new TestAbbruch(`in ${s.id}`);
        if (res.status === "ok" && s.nachpruefen && !s.nachpruefen(z, c)) throw new Error("nachpruefung-fehlgeschlagen");
      } catch (e) {
        if (e instanceof TestAbbruch) throw e;
        // nur dieser Schritt wird zurückgenommen, die Phase hält an
        let rueck = null;
        try { rueck = c.undo ? s.zurueck(z, c, c.undo) : null; } catch { /* der Rückweg meldet sich unten */ }
        const grund = String((e && e.message) || "fehler").split("\n")[0].slice(0, 80);
        zustand.schritte[s.id] = { ...(zustand.schritte[s.id] || {}), status: "fehler", zeit: jetztIso(), grund, zurueckgenommen: !!rueck };
        zustand.laeuft = null;
        schreibeZustand(z, zustand);
        protokolliere(z, { schritt: s.id, ereignis: "fehler", grund, sicherung: zustand.schritte[s.id].undo });
        if (rueck) protokolliere(z, { schritt: s.id, ereignis: "rueckweg", grund: "nach-fehler" });
        return { ok: false, fehlerBei: s.id, grund, schritte: [...ergebnis, { id: s.id, titel: s.titel, status: "fehler", grund }], zurueckgenommen: !!rueck };
      }
      // „nichts“ nach einem früheren „ok“ lässt das frühere Ergebnis (und seine Rückweg-Angaben) stehen
      const bleibt = res.status === "nichts" && vorher.status === "ok";
      zustand.schritte[s.id] = bleibt ? { ...vorher } : { ...(zustand.schritte[s.id] || {}), status: res.status, zeit: jetztIso(), anzahl: res.anzahl, grund: res.grund };
      if (!bleibt && res.status !== "ok") delete zustand.schritte[s.id].undo;
      schreibeZustand(z, zustand);
      protokolliere(z, { schritt: s.id, ereignis: res.status === "ok" ? "ok" : res.status, anzahl: res.anzahl, grund: res.grund, sicherung: zustand.schritte[s.id].undo, hashVorher: c.undo && c.undo.hashVorher, hashNachher: c.undo && c.undo.hashNachher });
      ergebnis.push({ id: s.id, titel: s.titel, status: res.status, anzahl: res.anzahl, grund: res.grund, details: res.details });
      if (abbruchNach === s.id) throw new TestAbbruch(`nach ${s.id}`);
    }
    // A9: Prüfung am Original (lesend)
    let a9 = null;
    if (wahl.has("A9")) {
      protokolliere(z, { schritt: "A9", ereignis: "start" });
      const kriterien = await pruefeAmOriginal(z, { profile });
      a9 = { zeit: jetztIso(), ampel: ampel(kriterien), kriterien: kriterien.map((k) => ({ nr: k.nr, id: k.id, titel: k.titel, status: k.status, grund: k.grund })) };
      zustand.a9 = a9;
      protokolliere(z, { schritt: "A9", ereignis: a9.ampel === "gruen" ? "ok" : "fehler", anzahl: kriterien.filter((k) => k.status === "rot").length });
      ergebnis.push({ id: "A9", titel: "Prüfung am Original", status: a9.ampel === "gruen" ? "ok" : "rot", kriterien: a9.kriterien });
    }
    const fertig = SCHRITTE.every((s) => zustand.schritte[s.id] && ["ok", "nichts", "uebersprungen"].includes(zustand.schritte[s.id].status));
    if (fertig && (!schritte || !schritte.length)) {
      zustand.phase = "A";
      zustand.weitereMacs = ent.weitereMacs;
      zustand.vertrauen = vermerkeUmgestellt().vermerken ? "vermerken" : null;   // die Werkstatt trägt den Vault als vertraut ein (vertrauen-merker.mjs)
    }
    zustand.laeuft = null;
    schreibeZustand(z, zustand);
    return { ok: true, phase: zustand.phase, schritte: ergebnis, a9, hinweis: a9 && a9.ampel === "rot" ? "pruefung-rot" : undefined };
  } finally {
    loeseSperre(z);
    if (vaultSperre.ok) loeseVaultSperre(z);
  }
}
