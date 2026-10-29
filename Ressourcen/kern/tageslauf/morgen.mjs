// tageslauf/morgen.mjs — Sitzungsstart-Zeile des Tageslaufs (Spec §5.5). 0 Tokens: liest letzter.json und zählt die
// offenen Rückfragen live (ohne hint.log — für die Zahl ist die Reihenfolge egal). Schalter aus, noch kein Lauf oder ein
// Lauf in der anderen Betriebsart als der Schalter (z. B. letzter Lauf Probe, Schalter jetzt „an“) → null: dann gilt im
// Sitzungsstart weiter alles wie bisher. Wirft nie.
// Einschwingphase: Im scharfen Betrieb steht „Einschwingen R/N geprüft“ (R = beantwortet „stimmt“; dazu „· O offen“, „· F falsch“ und bei keinem freien
// Platz „— Automatik wartet auf deine Prüfung“, siehe einschwingen.mjs#einschwingText) in der Zeile, solange die Phase läuft; danach, bei `einschwingen: 0`
// und in der Probe (dort wird nie gezählt) nicht. Die Probe-Zeile nennt die Phase als Ausblick. Gibt es noch keine Tageslauf-Zeile (Schalter „an“, aber
// noch kein scharfer Lauf), liefert einschwingZeile die Angabe allein — der Sitzungsstart zeigt sie dann zusätzlich, OHNE dass die Zeile die
// Vorschlags-/Lektionszähler ersetzt (TAGESLAUF_ERSETZT hängt nur an morgenZeile).
// Autostufe „aus“: kommt sie aus dem Start (Lernmodus, Zustand grund start — letzter.json trägt lernmodus), steht „Lernmodus: Automatik ab 20 bestätigten Urteilen in Folge (jetzt x/20)“ statt der
// Fehler-Formulierung; x wird live aus den Prüfungen gelesen (Rückweg-Stand). Kommt „aus“ aus Fehlern, bleibt die Fehler-Formulierung. Die Probe nennt den Lernmodus als Ausblick.
import { leseAutomatik } from "../einstellungen.mjs";
import { leseLetzter } from "./protokoll.mjs";
import { einschwingStand, einschwingText } from "./einschwingen.mjs";
import { ladeAutostufe, rueckwegStand, istLernmodus, ZURUECK_NACH } from "./autostufe.mjs";
import { ladeOffene } from "./ruecknahmen.mjs";
import { sichtbare, listeRueckfragen } from "../rueckfragen.mjs";

const TAG = 86400e3;
const kurzDatum = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "?" : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
};

export function morgenZeile(vault, { jetzt = Date.now() } = {}) {
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler || werte.tageslauf === "aus") return null;
    const l = leseLetzter(vault);
    if (!l?.lauf) return null;
    if (l.modus !== werte.tageslauf) return null;
    const z = l.zahlen || {};
    const q = l.fehlerquote || { fehler: 0, geprueft: 0 };
    const teile = [];
    if (l.modus === "probe") {
      const n = werte.einschwingen;
      teile.push(`Brain-Probelauf (${kurzDatum(l.zeit)}): würde ${z.uebernommen ?? 0} übernehmen · ${z.aussortiert ?? 0} aussortieren · ${z.rueckfragenNeu ?? 0} Rückfragen stellen — nichts geändert; scharf schalten mit dem Schalter „tageslauf: an“`
        + (n > 0 ? ` — die ersten ${n} Übernahmen prüfst du dann einzeln (Einschwingphase)` : ""));
    } else {
      let offen = z.rueckfragen ?? 0;
      try { const s = sichtbare(vault, { jetzt, nutzung: new Map() }); offen = s.fragen.length + s.wartend; } catch {}
      teile.push(`Brain hat gelernt (${kurzDatum(l.zeit)}): ${z.uebernommen ?? 0} übernommen · ${z.aussortiert ?? 0} aussortiert · ${offen} Rückfragen offen${offen ? " — „Rückfragen“ sagen" : ""} · Fehlerquote ${q.fehler}/${q.geprueft}`);
    }
    if (l.modus === "an") { const t = einschwingText(einschwingStand(vault, werte)); if (t) teile.push(t); }
    if (l.modus === "an") { const n = ladeOffene(vault).liste.length; if (n > 0) teile.push(`Rücknahme offen: ${n}`); }   // Befund N6: gescheiterte „stimmt nicht“-Rücknahmen, live gelesen
    if (l.modus === "an" && l.protokoll === "nicht-schreibbar") teile.push("Protokoll nicht schreibbar — keine automatischen Übernahmen");   // Befund N3: nie still
    if (l.autostufe === "eng") teile.push("Autostufe eng (nur Werkzeug-Belege automatisch)");
    if (l.autostufe === "aus") {
      if (l.modus === "probe" && l.lernmodus === true) teile.push("Lernmodus: scharf beginnt die Automatik bei „aus“ — sie schreibt nichts selbst, erst nach 20 bestätigten Urteilen in Folge");
      else if (l.modus === "an" && l.lernmodus === true && istLernmodus(ladeAutostufe(vault))) {
        const x = rueckwegStand(vault)?.folge ?? 0;
        teile.push(`Lernmodus: Automatik ab ${ZURUECK_NACH} bestätigten Urteilen in Folge (jetzt ${x}/${ZURUECK_NACH})`);
      } else teile.push(`Autostufe aus: Fehlerquote ${q.fehler}/${q.geprueft} — Rückfragen beantworten bringt die Automatik zurück`);   // Rückweg (N5)
    }
    const erfolg = Date.parse(l.letzterErfolg || "");
    const seit = Number.isFinite(erfolg) ? erfolg : Date.parse(l.seit || "");
    if (Number.isFinite(seit) && jetzt - seit > 3 * TAG) {
      const grund = l.uebersprungen?.grund || l.grund || l.status;
      teile.push(`seit ${Math.floor((jetzt - seit) / TAG)} Tagen kein erfolgreicher Lauf${grund ? ` (${grund})` : ""}`);
    }
    return teile.join(" · ");
  } catch { return null; }
}

// Nur die Einschwing-Angabe, als eigene Sitzungsstart-Zeile: Schalter „an“, Phase läuft (null bei Probe, aus, N=0, beendet). Wirft nie.
export function einschwingZeile(vault) {
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler || werte.tageslauf !== "an") return null;
    const t = einschwingText(einschwingStand(vault, werte));
    return t ? `Brain: ${t}` : null;
  } catch { return null; }
}

// Laute Sicherheitszeile (B3-Härtung): offene Rückfrage „integritaet“ = die Pflege-KI hat etwas verändert, das sie nie anfassen darf.
// Unabhängig vom Schalter „tageslauf“ und immer die erste Zeile des Sitzungsstarts. Nur Pfadnamen (bereinigt, nie Inhalt); einzeilig. Wirft nie.
export function integritaetsZeile(vault) {
  try {
    const offen = listeRueckfragen(vault).filter((r) => r.typ === "integritaet" && !r.antwort);
    if (!offen.length) return null;
    const einzeln = (x) => String(x).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
    const pfade = [...new Set(offen.flatMap((r) => (Array.isArray(r.fm.pfade) ? r.fm.pfade : []).map(einzeln)).filter(Boolean))];
    const liste = `${pfade.slice(0, 3).join(", ")}${pfade.length > 3 ? ` (+${pfade.length - 3} weitere)` : ""}`;
    const datum = offen.map((r) => r.erstellt).filter(Boolean).sort().pop();
    return `ACHTUNG Brain-Sicherheit: Integrität verletzt${datum ? ` (${kurzDatum(datum)})` : ""}: ${liste || "Pfade siehe Rückfrage"} — die automatische Pflege wurde gestoppt. `
      + "Bitte selbst prüfen (git status, .git/hooks, .git/config), diese Meldung NICHT selbst abhaken — danach unter „Rückfragen“ als geprüft quittieren.";
  } catch { return null; }
}
