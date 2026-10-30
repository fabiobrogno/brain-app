// umstellung/rueckweg.mjs — „Umstellung rückgängig machen“ (Paket P7b, Plan Abschnitt 5.2 und 5.3): einzelne Schritte oder alles, in umgekehrter Reihenfolge (A8 → A0).
// Die Rückweg-Angaben jedes Schritts stehen im Support-Ordner (vor dem ersten Schreiben des Schritts abgelegt, siehe schrittliste.mjs). Regel für Dateien anderer Programme: eine
// Sicherung wird nur zurückgespielt, wenn die Datei seit unserem Schreiben unverändert ist (Hash); sonst nehmen wir nur unsere Einträge heraus und sagen es (`hinweise`) – nie
// Änderungen des Nutzers überschreiben. Ein Rückweg ist selbst idempotent: ein zweiter Lauf findet nichts mehr zu tun.
import { SCHRITTE, ALLE_IDS, UmstellungsFehler, normalisiereEntscheidungen, waehleProfile, undoListe } from "./schrittliste.mjs";
import {
  liesZustand, schreibeZustand, protokolliere, setzeSperre, loeseSperre, setzeVaultSperre, loeseVaultSperre, stempel, jetztIso, oeffneAblage, sicherungsOrdner,
} from "./protokoll.mjs";

// → Liste [{ id, titel, hatRueckweg, status }] – nur lesend
export function planRueckweg(z) {
  const zu = liesZustand(z);
  return SCHRITTE.map((s) => ({ id: s.id, titel: s.titel, status: (zu.schritte[s.id] || {}).status || null, hatRueckweg: undoListe(z, zu, s.id).length > 0 }));
}

export async function rueckweg(z, { schritte = null, alles = false, entscheidungen = {}, bestaetigt = false } = {}) {
  if (!bestaetigt) return { ok: true, plan: true, bestaetigt: false, schritte: planRueckweg(z) };
  for (const id of schritte || []) if (!ALLE_IDS.includes(id)) throw new UmstellungsFehler("unbekannter-schritt", `Unbekannter Schritt: ${id}`, 64);
  if (!alles && !(schritte && schritte.length)) throw new UmstellungsFehler("nichts-gewaehlt", "Nenne einen Schritt (--schritt A4) oder alles (--alles).", 64);
  oeffneAblage(z);
  if (!setzeSperre(z)) throw new UmstellungsFehler("laeuft-schon", "Die Umstellung läuft gerade. Warte, bis sie fertig ist.", 5);
  const vaultSperre = setzeVaultSperre(z);
  const ent = normalisiereEntscheidungen(entscheidungen);
  const zustand = liesZustand(z);
  const profile = waehleProfile(z, ent);
  const wahl = alles ? new Set(ALLE_IDS) : new Set(schritte);
  const sicherungsDir = sicherungsOrdner(z, `rueckweg-${stempel()}`);
  const ergebnis = [], hinweise = [];
  try {
    for (const s of [...SCHRITTE].reverse()) {
      if (!wahl.has(s.id)) continue;
      const liste = undoListe(z, zustand, s.id);
      if (!liste.length) { ergebnis.push({ id: s.id, titel: s.titel, status: "nichts" }); continue; }
      protokolliere(z, { schritt: s.id, ereignis: "start", grund: "rueckweg" });
      let n = 0; const hw = [];
      const c = { entscheidungen: ent, profile, sicherungsDir, merkeUndo() { /* der Rückweg hinterlässt keine Rückweg-Angaben */ }, nachDaten: undefined };
      try {
        for (const undo of liste) { const r = s.zurueck(z, c, undo); if (r && r.status === "ok") n++; for (const h of (r && r.hinweise) || []) if (!hw.includes(h)) hw.push(h); }
      } catch (e) {
        const grund = String((e && e.message) || "fehler").split("\n")[0].slice(0, 80);
        protokolliere(z, { schritt: s.id, ereignis: "fehler", grund: `rueckweg:${grund}` });
        ergebnis.push({ id: s.id, titel: s.titel, status: "fehler", grund });
        hinweise.push(`${s.id}:rueckweg-fehler`);
        continue;                                           // die übrigen Schritte trotzdem zurücknehmen
      }
      zustand.schritte[s.id] = { ...(zustand.schritte[s.id] || {}), status: "zurueck", zeit: jetztIso(), hinweise: hw.length ? hw : undefined };
      protokolliere(z, { schritt: s.id, ereignis: "rueckweg", anzahl: n, grund: hw[0] });
      ergebnis.push({ id: s.id, titel: s.titel, status: n ? "zurueck" : "nichts", hinweise: hw });
      for (const h of hw) hinweise.push(`${s.id}:${h}`);
    }
    if (alles) { zustand.phase = null; zustand.laeuft = null; delete zustand.a9; delete zustand.vertrauen; }
    schreibeZustand(z, zustand);
    return { ok: true, alles, schritte: ergebnis, hinweise };
  } finally {
    loeseSperre(z);
    if (vaultSperre.ok) loeseVaultSperre(z);
  }
}
