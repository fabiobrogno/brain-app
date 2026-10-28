// .tools/tageslauf/einschwingen.mjs — Einschwingphase des Tageslaufs (B2) als echtes Tor. Die ersten N automatischen Übernahmen
// (Einstellung automatik.einschwingen, Standard 20, 0 = aus → kein Tor, Verhalten wie ohne Phase) prüft der Mensch einzeln, BEVOR die
// Automatik weiterläuft. Das ersetzt das Abnahme-Tor der Spec (20 zufällige 🟢 prüfen, erst bei 20/20 Schalter an) — im Kit selbst stand es nirgends.
// Zählgrößen (nie gespeichert, immer neu aus Protokoll + Antworten gelesen — es gibt keinen Zähler, der veralten oder abweichen könnte):
//   A = in der Phase automatisch übernommene (gemergte) Fakten: Aktionen in aktionen.jsonl mit einschwingen: true (der Lauf kennzeichnet jede
//       Übernahme, die ein Platz des Tors war; seit Befund #7 steht sie direkt nach dem Merge in der Datei)
//   R = davon beantwortet „stimmt“ · F = „stimmt nicht“ (oder von Hand zurückgenommen, ohne dass geantwortet wurde) · O = offen = A − R − F
//   Woher R/F kommen: pruefungen.jsonl (Antworten der Stichproben mit quelle einschwingen, geschrieben von antworten.mjs). „stimmt nicht“ gewinnt vor
//   „stimmt“, eine Antwort geht vor einer späteren Rücknahme, jede Übernahme zählt einmal. Fehlende/kaputte Dateien zählen als 0, nichts wirft.
// Phase aktiv, solange R < N (N später erhöht → läuft ab dem Stand weiter; auf ≤ R gesenkt → beendet).
// Tor (nur im echten Lauf, VOR dem Schreiben): frei = max(0, min(N − R − O, 10 − O)) automatische Übernahmen. So passen alle offenen
// Einschwing-Stichproben in den Rückfragen-Deckel (10), und es werden nie mehr Übernahmen offen, als bis N noch fehlen. Weitere 🟢 → ⏸ warten
// mit Grund „einschwingen“ (bleiben in der Inbox, kommen im nächsten Lauf wieder; der Cache macht das billig). Ein „stimmt nicht“ nimmt die
// Übernahme zurück (antworten.mjs, bestehender Weg) und stellt die Autostufe sofort auf eng (einschwingenBremse → autostufe.mjs#erzwingeAutostufe);
// F zählt nicht als R, die Phase verlängert sich also von selbst, bis N richtige vorliegen.
// Verlorene Rückfragen: jede offene Übernahme (O) hat immer eine Einschwing-Stichprobe — fehlt sie (gelöscht, nie angelegt, Absturz nach dem
// Merge), legt der Lauf sie neu an. Das ist besser als ein Ablauf: ein Ablauf würde die Übernahme als „geprüft“ werten oder aus der Zählung nehmen,
// obwohl nie jemand sie gesehen hat; das Neuanlegen lässt das Tor nie dauerhaft hängen UND nie ungeprüft aufgehen.
// Probemodus: kein Tor, nichts zählen, nichts anlegen — nur ausweisen, wie viele der 🟢 das Tor im echten Lauf durchließe (Bericht).
import { leseAutomatik } from "../einstellungen.mjs";
import { legeRueckfrageAn, listeRueckfragen, archiviereRueckfrage, istEinschwingStichprobe, EINSCHWING_QUELLE, DECKEL } from "../rueckfragen.mjs";
import { notiere, leseAktionen, lesePruefungen } from "./protokoll.mjs";
import { ladeAutostufe, erzwingeAutostufe } from "./autostufe.mjs";

export const FALSCH_STUFE = "eng";   // „stimmt nicht“ in der Phase: sofort so vorsichtig — und nicht „aus“, damit weitere Übernahmen die Phase noch füllen können
const kurz = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const istPhasenUebernahme = (a) => Boolean(a) && a.einschwingen === true && a.auto === true && (a.stufe === "uebernehmen" || a.stufe === "stand")
  && typeof a.id === "string" && a.id !== "";

// → { ziel: N, A, R, F, O, aktiv, frei (null ohne aktive Phase), offene: [Aktionen], erledigt: [IDs mit Antwort/Rücknahme] } — `werte` optional (sonst frisch gelesen). Wirft nie.
export function einschwingStand(vault, werte) {
  let w = werte;
  if (!w) { try { w = leseAutomatik(vault).werte; } catch { w = {}; } }
  const ziel = Number.isInteger(w?.einschwingen) && w.einschwingen >= 0 ? w.einschwingen : 20;
  let aktionen = [], pruefungen = [];
  try { aktionen = leseAktionen(vault); } catch { /* als leer gelesen */ }
  try { pruefungen = lesePruefungen(vault); } catch { /* als leer gelesen */ }
  const phasen = new Map();
  for (const a of aktionen) if (istPhasenUebernahme(a) && !phasen.has(a.id)) phasen.set(a.id, a);
  const zurueck = new Set(aktionen.filter((a) => a && a.stufe === "zurueck" && typeof a.id === "string").map((a) => a.id));
  const urteil = new Map();
  for (const p of pruefungen) {
    if (!p || p.art !== "stichprobe" || p.quelle !== EINSCHWING_QUELLE || typeof p.aktion !== "string" || !phasen.has(p.aktion)) continue;
    urteil.set(p.aktion, p.fehler ? "falsch" : urteil.get(p.aktion) === "falsch" ? "falsch" : "richtig");
  }
  let R = 0, F = 0;
  const offene = [], erledigt = [];
  for (const [id, a] of phasen) {
    const u = urteil.get(id) || (zurueck.has(id) ? "falsch" : "offen");
    if (u === "offen") { offene.push(a); continue; }
    erledigt.push(id);
    if (u === "richtig") R++; else F++;
  }
  const O = offene.length;
  const aktiv = ziel > 0 && R < ziel;
  return { ziel, A: phasen.size, R, F, O, aktiv, frei: aktiv ? Math.max(0, Math.min(ziel - R - O, DECKEL - O)) : null, offene, erledigt };
}

// Text für Morgenzeile und Sitzungsstart (null, wenn die Phase nicht läuft).
export function einschwingText(e) {
  if (!e || !e.aktiv) return null;
  let t = `Einschwingen ${e.R}/${e.ziel} geprüft`;
  if (e.O > 0) t += ` · ${e.O} offen`;
  if (e.F > 0) t += ` · ${e.F} falsch`;
  if (e.frei === 0 && e.O > 0) t += " — Automatik wartet auf deine Prüfung";
  return t;
}

// Schreibt ein „stimmt nicht“ der Phase, das neuer ist als der letzte Autostufen-Wechsel, die Stufe sofort auf eng (nie lockern). Zustandslos: gilt
// auch, wenn der Fehler in einem früheren, abgebrochenen Lauf angewendet wurde. → true, wenn sich die Stufe geändert hat.
export function einschwingenBremse(ctx) {
  if (ctx.probe || !(ctx.werte?.einschwingen > 0)) return false;
  const seit = String(ladeAutostufe(ctx.vault).seit);
  const neuerFehler = lesePruefungen(ctx.vault).some((p) => p && p.art === "stichprobe" && p.quelle === EINSCHWING_QUELLE && p.fehler && String(p.zeit) > seit);
  return neuerFehler ? erzwingeAutostufe(ctx, FALSCH_STUFE, "Einschwing-Stichprobe: stimmt nicht") : false;
}

// Beim Lauf-Start, NACH den Antworten (R, F, O sind jetzt aktuell, ein „stimmt nicht“ hat die Autostufe schon verschärft): der Tor-Stand für diesen Lauf.
export function einschwingenStart(ctx) {
  try { einschwingenBremse(ctx); }
  catch (e) { notiere(ctx, { id: "lauf", stufe: "fehler", grund: `einschwingen-bremse: ${kurz(e?.message)}` }); }
  const s = einschwingStand(ctx.vault, ctx.werte);
  // Fail-closed (N3): Ist das Protokoll nicht gesund (ctx.protokollKaputt), sieht das Tor seine eigenen Übernahmen nicht — dann vergibt es keine Plätze.
  ctx.einschwingen = { ziel: s.ziel, A: s.A, R: s.R, F: s.F, O: s.O, aktiv: s.aktiv, frei: ctx.protokollKaputt && s.aktiv ? 0 : s.frei, frei0: s.frei, wartend: 0, neu: 0, probeM: 0, probeK: 0,
    beendet: Boolean(ctx.einschwingenVorher?.aktiv) && !s.aktiv };
  return ctx.einschwingen;
}

// Ein 🟢-Kandidat (automatische Übernahme) will geschrieben werden. → "frei" (kein Tor: keine Phase oder Probe) | "platz" (ein Platz ist verbraucht,
// die Übernahme wird als Einschwing-Übernahme gekennzeichnet) | "warten" (Phase, kein Platz mehr frei). Im Probemodus wird nur mitgezählt.
export function einschwingTor(ctx) {
  const e = ctx.einschwingen || einschwingenStart(ctx);
  if (!e.aktiv) return "frei";
  if (ctx.probe) { e.probeM++; if (e.probeM <= e.frei0) e.probeK++; return "frei"; }
  if (e.frei > 0) { e.frei--; return "platz"; }
  e.wartend++;
  return "warten";
}

// Schritt 7b, nach dem Merge: jede offene Einschwing-Übernahme ohne Stichprobe (neu dazugekommen, verloren, gelöscht, nie angelegt) bekommt ihre Frage;
// offene Fragen zu Übernahmen, die schon beantwortet/zurückgenommen sind, werden archiviert. Wirft nie wegen einer einzelnen Rückfrage — Fehler stehen
// als Aktion „fehler“ im Protokoll. → { …Stand, neu, wartend, beendet }
export function einschwingenSchritt(ctx) {
  const s = einschwingStand(ctx.vault, ctx.werte);
  const alt = ctx.einschwingen || {};
  const erg = { ...alt, ziel: s.ziel, A: s.A, R: s.R, F: s.F, O: s.O, aktiv: s.aktiv, frei: ctx.protokollKaputt && s.aktiv ? 0 : s.frei, neu: 0, wartend: alt.wartend || 0 };
  if (ctx.probe || s.ziel <= 0) return erg;
  const fragen = listeRueckfragen(ctx.vault).filter(istEinschwingStichprobe);
  const erledigt = new Set(s.erledigt);
  for (const r of fragen) {
    if (r.antwort || !erledigt.has(String(r.fm.aktion || ""))) continue;
    try { archiviereRueckfrage(ctx, r); } catch (e) { notiere(ctx, { id: r.id, stufe: "fehler", grund: `einschwingen-archivieren: ${kurz(e?.message)}` }); }
  }
  if (!s.aktiv) return erg;
  const vorhanden = new Set(fragen.map((r) => String(r.fm.aktion || "")));
  for (const a of s.offene) {
    if (vorhanden.has(a.id)) continue;
    try {
      legeRueckfrageAn(ctx, { typ: "stichprobe", frage: `Stimmt das? ${a.titel || a.id}`, seite: a.ziel || "", grund: "einschwingen",
        beschreibung: `Automatisch übernommen am ${String(a.zeit).slice(0, 10)} auf ${a.ziel}.\nZitat: „${a.zitat || ""}“\nQuelle: ${a.fundstelle || "-"}\n`
          + `Einschwingphase: ${s.R} von ${s.ziel} automatischen Übernahmen sind bestätigt — die ersten prüfst du einzeln, danach läuft es von selbst.`,
        felder: { aktion: a.id, commit: a.commit || "", quelle: EINSCHWING_QUELLE } });
      erg.neu++;
    } catch (e) {
      notiere(ctx, { id: a.id, stufe: "fehler", ziel: a.ziel, grund: `einschwingen: ${kurz(e?.message)}` });   // beim nächsten Lauf neuer Versuch (O zählt weiter)
    }
  }
  return erg;
}
