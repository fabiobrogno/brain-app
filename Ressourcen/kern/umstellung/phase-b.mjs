// umstellung/phase-b.mjs — Phase B der Umstellung: der alte Werkzeug-Ordner geht ins Archiv, der Vault wird bereinigt (Paket P7d, Plan docs/plaene/p7-umstellung.md Abschnitt 4 und 6).
//
// Nichts läuft ohne ausdrückliche Bestätigung (`bestaetigt: true`, CLI --ja) – ohne sie liefert phaseB() nur den PLAN samt Freigabe-Tor (tor.mjs, lesend). Am Original läuft Phase B nur,
// wenn das Tor ganz offen ist (inklusive grünem, frischem Probelauf an einer Kopie, probelauf-b.mjs). Ablauf: Sperre → B0 Sicherung → B1 Archiv → B2 Einstellungen → B3 Commit → B4 Prüfung.
// Der Zustand bleibt `phase: "A"` (Phase B ist eine Zugabe, die Oberfläche liest `phaseB`); `zustand.phaseB = { status: "fertig" | "mitWarnungen", zeit, kernVersion, archiv }`.
// Rückweg: rueckweg.mjs (`zurueck --schritt B3,B2,B1` oder `--alles`): git revert des Commits, dann kommt das Archiv zurück.
import { join } from "node:path";
import { kernVersion, ALT_KIT_ORDNER } from "../pfade.mjs";
import { erstelleBefund } from "./befund.mjs";
import { UmstellungsFehler, bereitFehler, waehleProfile, schrittKontext, TestAbbruch, undoListe } from "./schrittliste.mjs";
import { SCHRITTE_B } from "./phase-b-schritte.mjs";
import { liesZustand, schreibeZustand, protokolliere, setzeSperre, loeseSperre, setzeVaultSperre, loeseVaultSperre, setzePhaseBSperre, loesePhaseBSperre, sicherungsOrdner, stempel, jetztIso, oeffneAblage } from "./protokoll.mjs";
import { kriterium1, kriterium2, kriterium3, kriterium4, ampel } from "./pruefung.mjs";
import { pruefeVertrauen } from "./phase-a.mjs";
import { pruefeTor } from "./tor.mjs";
import { probelaufBStand } from "./probelauf-b-merker.mjs";
import { lexists } from "./baum.mjs";

export { TestAbbruch };

// Entscheidungen der Phase B: keineAltenMacs (Bestätigung des Nutzers), bewusst (Liste von Fund-IDs, die der Nutzer quittiert hat), nachbarkopie (Probekopie notfalls neben dem Vault)
export function normalisiereEntscheidungenB(roh) {
  const e = { keineAltenMacs: false, bewusst: [], nachbarkopie: false };
  if (roh && typeof roh === "object" && !Array.isArray(roh)) {
    if (roh.keineAltenMacs === true) e.keineAltenMacs = true;
    if (roh.nachbarkopie === true) e.nachbarkopie = true;
    if (Array.isArray(roh.bewusst)) e.bewusst = [...new Set(roh.bewusst.filter((x) => typeof x === "string" && /^E\d{1,2}$/.test(x)))];
  }
  return e;
}

// → { ok, plan: true, bestaetigt: false, tor, schritte } – nur lesend
export function planPhaseB(z, { entscheidungen = {}, jetzt = Date.now() } = {}) {
  const ent = normalisiereEntscheidungenB(entscheidungen);
  const tor = z.probe ? { frei: true, bedingungen: [], offen: [] } : pruefeTor(z, { entscheidungen: ent, jetzt });
  const schritte = SCHRITTE_B.map((s) => { let p; try { p = s.plan(z, {}); } catch { p = { noetig: false, text: "Konnte nicht geprüft werden.", grund: "plan-fehler" }; } return { id: s.id, titel: s.titel, ...p }; })
    .concat([{ id: "B4", titel: "Prüfung am Original", noetig: true, text: "Kortex prüft zum Schluss, ob alles läuft (nur lesend)." }]);
  return { ok: true, plan: true, bestaetigt: false, tor, schritte };
}

// Prüfung am Original nach Phase B (Plan 4.2 B6): Kriterien 1–4 wie in Phase A, dazu „der alte Ordner ist weg“
export async function pruefeB4(z, { profile }) {
  const ctx = { profile };
  const liste = [kriterium1(z), kriterium2(z, ctx), kriterium3(z, { testCommit: false }), kriterium4(z, ctx, { vorschau: false })];
  liste.push(lexists(join(z.vault, ALT_KIT_ORDNER))
    ? { nr: 5, id: "kit-weg", titel: "Der alte Werkzeug-Ordner ist aus dem Vault verschwunden", status: "rot", grund: "kit-noch-da" }
    : { nr: 5, id: "kit-weg", titel: "Der alte Werkzeug-Ordner ist aus dem Vault verschwunden", status: "gruen" });
  return liste;
}

export function standPhaseB(z, { jetzt = Date.now() } = {}) {
  const zu = liesZustand(z);
  const pb = zu.phaseB || null;
  const schritte = Object.fromEntries(Object.entries(zu.schritte).filter(([id]) => /^B\d$/.test(id)).map(([id, e]) => [id, { status: e.status, zeit: e.zeit, anzahl: e.anzahl, grund: e.grund }]));
  const laeuft = Object.values(schritte).some((s) => s.status === "laeuft");
  const b1 = undoListe(z, zu, "B1")[0] || null;
  const aktiv = Object.entries(schritte).some(([id, s]) => id !== "B0" && ["ok", "laeuft", "fehler"].includes(s.status));      // zurückgenommene Schritte und die reine Sicherung (B0) zählen nicht
  return { status: pb ? pb.status : (aktiv ? (laeuft ? "unterbrochen" : "begonnen") : null), zeit: pb ? pb.zeit : null, archiv: pb && pb.archiv ? pb.archiv : (b1 && b1.archiv) || null, probelauf: probelaufBStand(z, jetzt), schritte, b4: zu.b4 || null };
}

export async function phaseB(z, { entscheidungen = {}, bestaetigt = false, jetzt = Date.now(), abbruchNach = null, abbruchIn = null, abbruchBei = null, ohneVaultSperre = false } = {}) {
  const ent = normalisiereEntscheidungenB(entscheidungen);
  if (!bestaetigt) return planPhaseB(z, { entscheidungen: ent, jetzt });
  const bf = bereitFehler(z);
  if (bf) throw bf;
  if (!z.probe) {
    pruefeVertrauen(z);
    const tor = pruefeTor(z, { entscheidungen: ent, jetzt, befund: erstelleBefund({ vault: z.vault, home: z.home, support: z.support, claudeHomes: null }) });
    if (!tor.frei) { const erste = tor.bedingungen.find((c) => !c.erfuellt); throw new UmstellungsFehler("tor-zu", `Das Aufräumen ist noch nicht freigegeben: ${erste.text} Es wurde nichts verändert.`, 4); }
  }
  oeffneAblage(z);
  if (!setzeSperre(z)) throw new UmstellungsFehler("laeuft-schon", "Die Umstellung läuft gerade schon. Warte, bis sie fertig ist.", 5);
  let vaultSperre = { ok: false };
  if (!ohneVaultSperre) {
    vaultSperre = setzeVaultSperre(z);
    if (!vaultSperre.ok) { loeseSperre(z); throw new UmstellungsFehler("vault-belegt", "Im Vault arbeitet gerade etwas anderes (zum Beispiel das Einarbeiten von Notizen). Versuche es in ein paar Minuten noch einmal.", 5); }
  }
  setzePhaseBSperre(z);                 // die Werkstatt wartet mit Speichern/Abgleichen, bis Phase B fertig ist
  const zustand = liesZustand(z);
  const lauf = stempel();
  const sicherungsDir = sicherungsOrdner(z, `phase-b-${lauf}`);
  const profile = waehleProfile(z, {});
  const ergebnis = [];
  zustand.laeuft = { pid: process.pid, zeit: jetztIso(), phase: "B" };
  schreibeZustand(z, zustand);
  try {
    for (const s of SCHRITTE_B) {
      const vorher = zustand.schritte[s.id] || {};
      zustand.schritte[s.id] = { ...vorher, status: "laeuft", zeit: jetztIso() };
      zustand.laeuft = { ...zustand.laeuft, schritt: s.id };
      schreibeZustand(z, zustand);
      protokolliere(z, { schritt: s.id, ereignis: "start" });
      const c = schrittKontext(z, { schritt: s, entscheidungen: ent, profile, lauf, sicherungsDir, zustand, abbruchBei });
      let res;
      try {
        res = s.wende(z, c);
        if (abbruchIn === s.id) throw new TestAbbruch(`in ${s.id}`);
        if (res.status === "ok" && s.nachpruefen && !s.nachpruefen(z, c)) throw new Error("nachpruefung-fehlgeschlagen");
      } catch (e) {
        if (e instanceof TestAbbruch) throw e;
        let rueck = null;
        c.imFehler = true;
        try { rueck = c.undo ? s.zurueck(z, c, c.undo) : null; } catch { /* der Rückweg meldet sich unten */ }
        const grund = String((e && e.message) || "fehler").split("\n")[0].slice(0, 80);
        const sauber = c.undo ? !!rueck && !(rueck.hinweise && rueck.hinweise.length) : true;
        const rueckHinweise = rueck && rueck.hinweise && rueck.hinweise.length ? rueck.hinweise : undefined;
        zustand.schritte[s.id] = { ...(zustand.schritte[s.id] || {}), status: "fehler", zeit: jetztIso(), grund, zurueckgenommen: sauber, ...(rueckHinweise ? { rueckwegHinweise: rueckHinweise } : {}) };
        zustand.laeuft = null;
        schreibeZustand(z, zustand);
        protokolliere(z, { schritt: s.id, ereignis: "fehler", grund, sicherung: zustand.schritte[s.id].undo });
        if (rueck) protokolliere(z, { schritt: s.id, ereignis: "rueckweg", grund: sauber ? "nach-fehler" : "nach-fehler-unvollstaendig" });
        return { ok: false, fehlerBei: s.id, grund, schritte: [...ergebnis, { id: s.id, titel: s.titel, status: "fehler", grund }], zurueckgenommen: sauber, ...(rueckHinweise ? { rueckwegHinweise: rueckHinweise } : {}) };
      }
      const bleibt = res.status === "nichts" && vorher.status === "ok";
      zustand.schritte[s.id] = bleibt ? { ...vorher } : { ...(zustand.schritte[s.id] || {}), status: res.status, zeit: jetztIso(), anzahl: res.anzahl, grund: res.grund };
      // Rückweg-Angaben eines früheren, unterbrochenen oder erledigten Laufs bleiben IMMER stehen (ein erneuter Lauf, der „nichts“ zu tun findet, darf sie nicht verwaisen lassen)
      if (!bleibt && res.status !== "ok" && !(vorher.undo && ["laeuft", "ok", "fehler"].includes(vorher.status))) delete zustand.schritte[s.id].undo;
      schreibeZustand(z, zustand);
      protokolliere(z, { schritt: s.id, ereignis: res.status === "ok" ? "ok" : res.status, anzahl: res.anzahl, grund: res.grund, sicherung: zustand.schritte[s.id].undo });
      ergebnis.push({ id: s.id, titel: s.titel, status: res.status, anzahl: res.anzahl, grund: res.grund, details: res.details });
      if (abbruchNach === s.id) throw new TestAbbruch(`nach ${s.id}`);
    }
    // B4: Prüfung am Original (lesend)
    protokolliere(z, { schritt: "B4", ereignis: "start" });
    const kriterien = await pruefeB4(z, { profile });
    const b4 = { zeit: jetztIso(), ampel: ampel(kriterien), kriterien: kriterien.map((k) => ({ nr: k.nr, id: k.id, titel: k.titel, status: k.status, grund: k.grund })) };
    zustand.b4 = b4;
    protokolliere(z, { schritt: "B4", ereignis: b4.ampel === "gruen" ? "ok" : "fehler", anzahl: kriterien.filter((k) => k.status === "rot").length });
    ergebnis.push({ id: "B4", titel: "Prüfung am Original", status: b4.ampel === "gruen" ? "ok" : "rot", kriterien: b4.kriterien });
    const b1 = undoListe(z, zustand, "B1")[0] || null;
    const rot = b4.ampel === "rot";
    zustand.phaseB = { status: rot ? "mitWarnungen" : "fertig", zeit: (zustand.phaseB && zustand.phaseB.zeit) || jetztIso(), kernVersion: kernVersion(), archiv: b1 ? b1.archiv : (zustand.phaseB && zustand.phaseB.archiv) || null };
    zustand.laeuft = null;
    schreibeZustand(z, zustand);
    return { ok: true, phaseB: zustand.phaseB.status, archiv: zustand.phaseB.archiv, schritte: ergebnis, b4, ...(rot ? { mitWarnungen: true, hinweis: "pruefung-rot" } : { sichernAngebot: true }) };
  } finally {
    loeseSperre(z);
    loesePhaseBSperre(z);
    if (vaultSperre.ok) loeseVaultSperre(z);
  }
}
