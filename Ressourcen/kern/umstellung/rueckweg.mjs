// umstellung/rueckweg.mjs — „Umstellung rückgängig machen“ (Paket P7b, Plan Abschnitt 5.2 und 5.3): einzelne Schritte oder alles, in umgekehrter Reihenfolge (A8 → A0).
// Die Rückweg-Angaben jedes Schritts stehen im Support-Ordner (vor dem ersten Schreiben des Schritts abgelegt, siehe schrittliste.mjs). Regel für Dateien anderer Programme: eine
// Sicherung wird nur zurückgespielt, wenn die Datei seit unserem Schreiben unverändert ist (Hash); sonst nehmen wir nur unsere Einträge heraus und sagen es (`hinweise`) – nie
// Änderungen des Nutzers überschreiben. Ein Rückweg ist selbst idempotent: ein zweiter Lauf findet nichts mehr zu tun.
import { SCHRITTE, ALLE_IDS, UmstellungsFehler, normalisiereEntscheidungen, waehleProfile, undoListe } from "./schrittliste.mjs";
import { SCHRITTE_B } from "./phase-b-schritte.mjs";
import * as V1 from "./verwaist.mjs";

// Reihenfolge der Schritte vorwärts: A0–A8, dann B0–B3 (Phase B), V1 (verwaiste Einbindungen aufräumen, nur auf ausdrücklichen Wunsch, nie bei „alles“); zurück läuft sie umgekehrt
const REIHE = [...SCHRITTE, ...SCHRITTE_B, V1];
const IDS_ALLES = [...SCHRITTE, ...SCHRITTE_B].map((s) => s.id);
const IDS_GUELTIG = [...ALLE_IDS, ...REIHE.map((s) => s.id), "B4"];
import {
  liesZustand, schreibeZustand, protokolliere, setzeSperre, loeseSperre, setzeVaultSperre, loeseVaultSperre, setzePhaseBSperre, loesePhaseBSperre, stempel, jetztIso, oeffneAblage, sicherungsOrdner,
} from "./protokoll.mjs";

// → Liste [{ id, titel, hatRueckweg, status }] – nur lesend
export function planRueckweg(z) {
  const zu = liesZustand(z);
  return REIHE.map((s) => ({ id: s.id, titel: s.titel, status: (zu.schritte[s.id] || {}).status || null, hatRueckweg: undoListe(z, zu, s.id).length > 0 }));
}

export async function rueckweg(z, { schritte = null, alles = false, entscheidungen = {}, bestaetigt = false } = {}) {
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, schritte: planRueckweg(z) };
  for (const id of schritte || []) if (!IDS_GUELTIG.includes(id)) throw new UmstellungsFehler("unbekannter-schritt", `Unbekannter Schritt: ${id}`, 64);
  if (!alles && !(schritte && schritte.length)) throw new UmstellungsFehler("nichts-gewaehlt", "Nenne einen Schritt (--schritt A4) oder alles (--alles).", 64);
  oeffneAblage(z);
  if (!setzeSperre(z)) throw new UmstellungsFehler("laeuft-schon", "Die Umstellung läuft gerade. Warte, bis sie fertig ist.", 5);
  const vaultSperre = setzeVaultSperre(z);
  const mitB = alles || (schritte || []).some((id) => /^B/.test(id));
  if (mitB) setzePhaseBSperre(z);          // die Werkstatt wartet mit Speichern/Abgleichen
  const ent = normalisiereEntscheidungen(entscheidungen);
  const zustand = liesZustand(z);
  const profile = waehleProfile(z, ent);
  const wahl = alles ? new Set([...ALLE_IDS, ...IDS_ALLES]) : new Set(schritte);
  const sicherungsDir = sicherungsOrdner(z, `rueckweg-${stempel()}`);
  const ergebnis = [], hinweise = [];
  try {
    for (const s of [...REIHE].reverse()) {
      if (!wahl.has(s.id)) continue;
      const liste = undoListe(z, zustand, s.id);
      if (!liste.length) { ergebnis.push({ id: s.id, titel: s.titel, status: "nichts" }); continue; }
      protokolliere(z, { schritt: s.id, ereignis: "start", grund: "rueckweg" });
      let n = 0, gesichert = 0; const hw = [];
      const c = { entscheidungen: ent, profile, sicherungsDir, merkeUndo() { /* der Rückweg hinterlässt keine Rückweg-Angaben */ }, nachDaten: undefined };
      try {
        for (const undo of liste) { const r = s.zurueck(z, c, undo); if (r && r.status === "ok") n++; if (r && r.gesichert) gesichert += r.gesichert; for (const h of (r && r.hinweise) || []) if (!hw.includes(h)) hw.push(h); }
      } catch (e) {
        const grund = String((e && e.message) || "fehler").split("\n")[0].slice(0, 80);
        protokolliere(z, { schritt: s.id, ereignis: "fehler", grund: `rueckweg:${grund}` });
        ergebnis.push({ id: s.id, titel: s.titel, status: "fehler", grund });
        hinweise.push(`${s.id}:rueckweg-fehler`);
        continue;                                           // die übrigen Schritte trotzdem zurücknehmen
      }
      // Konnte der Schritt nicht wirklich zurückgenommen werden (der Nutzer arbeitet gerade mit dem Versionsverlauf, Platz fehlt …), bleibt er, wie er ist – ein neuer Versuch findet alles wieder
      const offen = hw.some((h) => ["git-beschaeftigt", "revert-fehlgeschlagen", "archiv-nicht-zurueck", "zu-wenig-platz"].includes(h));
      if (!offen) zustand.schritte[s.id] = { ...(zustand.schritte[s.id] || {}), status: "zurueck", zeit: jetztIso(), hinweise: hw.length ? hw : undefined };
      protokolliere(z, { schritt: s.id, ereignis: "rueckweg", anzahl: n, grund: hw[0] });
      ergebnis.push({ id: s.id, titel: s.titel, status: n && !offen ? "zurueck" : "nichts", hinweise: hw, ...(gesichert ? { gesichert } : {}) });
      for (const h of hw) hinweise.push(`${s.id}:${h}`);
      // Die Schritte von Phase B hängen voneinander ab (erst der Commit, dann die Dateien, dann der Ordner): geht ein Schritt nicht, bleiben die übrigen unberührt, sonst entstünde ein Mischzustand
      if (offen && /^B/.test(s.id)) { hinweise.push(`${s.id}:rest-nicht-angefasst`); break; }
    }
    // Phase B ist zurückgenommen, sobald der alte Ordner oder der Commit zurück sind
    if (ergebnis.some((e) => ["B1", "B3"].includes(e.id) && e.status === "zurueck")) { delete zustand.phaseB; delete zustand.b4; }
    if (alles && !hinweise.some((h) => h.endsWith(":rest-nicht-angefasst"))) { zustand.phase = null; zustand.laeuft = null; delete zustand.a9; delete zustand.vertrauen; delete zustand.phaseA; delete zustand.phaseB; delete zustand.b4; }
    schreibeZustand(z, zustand);
    const gesichertGesamt = ergebnis.reduce((a, e) => a + (e.gesichert || 0), 0);
    return { ok: true, alles, schritte: ergebnis, hinweise, ...(gesichertGesamt ? { gesichert: gesichertGesamt } : {}) };
  } finally {
    loeseSperre(z);
    if (mitB) loesePhaseBSperre(z);
    if (vaultSperre.ok) loeseVaultSperre(z);
  }
}
