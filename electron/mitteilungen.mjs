// electron/mitteilungen.mjs — Mitteilungen des Systems aus dem Aktivitätsprotokoll (Paket W2b). Dieselben Regeln wie die Mac-App (BrainCore/Mitteilungen.swift: MitteilungsPlaner, MitteilungsAblauf,
// MitteilungsEinstellungen, MitteilungsZiel): Schalter je Art (gemeinsam/aktivitaet.mjs ART_SCHALTER), Sammelfenster (gleiche Art-Familie, Handelnder und Vault werden EINE Mitteilung), höchstens
// 4 je Minute (der Rest einmal als „Weitere N Mitteilungen“), Pause für gleiche Abweisungen, 5-s-Sperre je Schlüssel, nur im Hintergrund, Kontingent-Warnungen bei 80 % und 100 % (Art `kontingent`,
// die Werkstatt entscheidet, wann). Gelesen wird mit `leseEreignisse` aus gemeinsam/aktivitaet.mjs (kein zweiter Leser). Reine Logik OHNE `import "electron"`; die Uhr kommt von außen.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SCHALTER = ["mitteilungenNurImHintergrund", "mitteilungenTon", "mitteilungenAbgelegt", "mitteilungenAbgewiesen", "mitteilungenRueckfragen", "mitteilungenSicherung", "mitteilungenKontingent", "mitteilungenPflege"];
const STANDARD = { mitteilungenNurImHintergrund: true, mitteilungenTon: false, mitteilungenAbgelegt: true, mitteilungenAbgewiesen: true, mitteilungenRueckfragen: true, mitteilungenSicherung: true, mitteilungenKontingent: true, mitteilungenPflege: false };

/** Schalter aus <support>/einstellungen.json (flache Wahrheitswerte). Nie ein Fehler: fehlt/kaputt/kein Objekt → Standard; Schlüssel ohne echten Wahrheitswert → Standard dieses Schlüssels. */
export function leseEinstellungen(support) {
  const e = { ...STANDARD };
  try {
    const datei = join(support, "einstellungen.json");
    if (statSync(datei).size > 1_000_000) return e;
    const j = JSON.parse(readFileSync(datei, "utf8"));
    if (j && typeof j === "object" && !Array.isArray(j)) for (const k of SCHALTER) if (typeof j[k] === "boolean") e[k] = j[k];
  } catch { /* Standard */ }
  return e;
}
/** Darf zu dieser Art überhaupt eine Mitteilung entstehen? `rueckgaengig`, `datei-aktion` und unbekannte Arten nie. */
export const erlaubt = (art, e, artSchalter) => { const s = artSchalter[art]; return typeof s === "string" && e[s] === true; };

/** Klick: ablage-aufgabe → Aufgaben, ablage-notiz → Posteingang, alles andere → Aktivitätsprotokoll (Namen = StudioBefehl). */
export const zielFuer = (art) => (art === "ablage-aufgabe" ? "aufgaben" : art === "ablage-notiz" ? "posteingang" : "aktivitaet");

const STEUER = /[\p{Cc}\p{Cf}]/u;
const ohneSteuer = (s) => Array.from(String(s)).filter((c) => !STEUER.test(c)).join("");

/** „Probe-Mitteilung senden“: umgeht Schalter, Sammelfenster und Drosselung; Klick öffnet das Aktivitätsprotokoll. */
export const probeMitteilung = ({ ton = false, kennung = "kortex-probe" } = {}) => ({
  kennung, gruppe: "kortex-probe", titel: "Kortex", untertitel: null, text: "So sehen Mitteilungen von Kortex aus.", ton, ziel: "aktivitaet", istProbe: true,
});

export const SATZ = Object.freeze({
  weitere: (n) => (n === 1 ? "Eine weitere Mitteilung in Kortex." : `Weitere ${n} Mitteilungen in Kortex.`),
});
/** Der Satz je Ereignisart: fest, aus Art, Grund und Zahl — nie Freitext aus dem Protokoll (wie MitteilungsPlaner.satz). */
export function satz(art, grund, anzahl) {
  switch (art) {
    case "ablage-aufgabe": return `hat ${anzahl === 1 ? "eine Aufgabe" : `${anzahl} Aufgaben`} angelegt.`;
    case "ablage-notiz": return `hat ${anzahl === 1 ? "eine Notiz" : `${anzahl} Notizen`} im Posteingang abgelegt.`;
    case "aenderung": return anzahl === 1 ? "hat eine Aufgabe geändert." : `hat ${anzahl} Aufgaben geändert.`;
    case "abweisung":
      if (grund === "gelesen-ohne-leseverbot") return "hat in einem gesperrten Vault gelesen. Das Leseverbot ist nicht eingeschaltet.";
      return anzahl === 1 ? "wurde abgewiesen." : `wurde ${anzahl}-mal abgewiesen.`;
    case "pflege": return "Pflege fertig.";
    case "pflege-fehler": return "Die Pflege lief nicht ganz durch.";
    case "sicherung-konflikt": return "Sicherung: Die Fassungen auf zwei Geräten widersprechen sich. Löse den Konflikt im Studio.";
    case "sicherung-fehler": return "Die Online-Sicherung hat nicht geklappt.";
    case "anmeldung-abgelaufen": return "muss sich neu anmelden.";
    case "kontingent":
      switch (grund) {
        case "5h-80": return "hat 80 % des 5-Stunden-Kontingents verbraucht.";
        case "5h-100": return "hat das 5-Stunden-Kontingent aufgebraucht.";
        case "woche-80": return "hat 80 % des Wochen-Kontingents verbraucht.";
        case "woche-100": return "hat das Wochen-Kontingent aufgebraucht.";
        default: return "hat fast das ganze Kontingent verbraucht.";
      }
    default: return "Es gibt Neues in Kortex.";
  }
}
// Art-Familie für die Gruppierung: Abweisungen unterscheiden den Grund, Kontingent je Konto und Fenster/Schwelle (80 % und 100 % verschwinden nie in einer Mitteilung)
const familie = (e) => (e.art === "abweisung" ? `abweisung-${e.grund ?? ""}` : e.art === "kontingent" ? `kontingent-${e.konto ?? ""}-${e.grund ?? ""}` : e.art);
const GERECHNET = ["ablage-aufgabe", "ablage-notiz", "abweisung", "aenderung", "anmeldung-abgelaufen", "kontingent"];

/**
 * Der Planer (MitteilungsPlaner). opt: { artSchalter, bekannteProgramme: [Namen], jetzt(): ms, start?: ms, regeln? { sammelfenster, maxProMinute, abweisungsPause, burstSperre } in Sekunden }
 * aufnehmen(ereignisse, einstellungen) · faellige(einstellungen, istVorne) → Mitteilungen · wartende()
 */
export function erzeugePlaner({ artSchalter, bekannteProgramme = ["Claude Code", "Codex"], jetzt = Date.now, start = jetzt(), regeln = {} }) {
  const R = { sammelfenster: 5, maxProMinute: 4, abweisungsPause: 600, burstSperre: 5, ...regeln };
  const bekannt = new Set(bekannteProgramme);
  let gruppen = [], zustellzeiten = [], ueberzaehlig = 0, zaehler = 0;
  const letzteAbweisung = new Map();
  let letzteZustellung = new Map();
  const sek = (a, b) => (a - b) / 1000;
  const kennung = (t) => `kortex-${Math.trunc(t)}-${++zaehler}`;

  // Der Handelnde, wenn er aus einem bekannten Programm (und höchstens einem kurzen Kontonamen) besteht: „Claude Code · Privat“. Sonst null.
  function bekannterHandelnder(wer) {
    if (typeof wer !== "string") return null;
    const teile = wer.split(" · ");
    if (teile.length > 2 || !bekannt.has(teile[0])) return null;
    if (teile.length === 2 && (!teile[1] || Array.from(teile[1]).length > 40 || STEUER.test(teile[1]))) return null;
    return wer;
  }

  function mitteilung(ereignisse, ton, t) {
    const erstes = ereignisse[0], letztes = ereignisse[ereignisse.length - 1];
    const gesamt = ereignisse.reduce((s, e) => s + (e.anzahl ?? 1), 0);
    const wer = bekannterHandelnder(erstes.wer);
    const text = satz(erstes.art, erstes.grund, erstes.art === "abweisung" ? ereignisse.length : gesamt);
    // Ohne bekannten Handelnden ist der Satz ein Systemsatz; bei Handelnden-Sätzen steht „Eine KI“ davor.
    const anzeige = wer === null && GERECHNET.includes(erstes.art) ? `Eine KI ${text}` : text;
    const untertitel = typeof erstes.vaultName === "string" ? Array.from(ohneSteuer(erstes.vaultName)).slice(0, 60).join("") || null : null;
    return { kennung: kennung(t), gruppe: `kortex-${erstes.vault ?? "alle"}-${familie(erstes)}`, titel: wer ?? "Kortex", untertitel, text: anzeige, ton, ziel: zielFuer(erstes.art), art: erstes.art, vault: erstes.vault ?? null, id: letztes.id, istProbe: false };
  }

  return {
    wartende: () => gruppen.length,
    aufnehmen(ereignisse, einstellungen) {
      const t = jetzt();
      for (const e of ereignisse) {
        if (e.art === "rueckgaengig" || !erlaubt(e.art, einstellungen, artSchalter) || !(Date.parse(e.zeit) >= start)) continue;
        const schluessel = [familie(e), e.wer ?? "", e.vault ?? ""].join("|");
        const g = gruppen.find((x) => x.schluessel === schluessel);
        if (g) g.ereignisse.push(e); else gruppen.push({ schluessel, aufgenommen: t, ereignisse: [e] });
      }
    },
    /** Die Mitteilungen, die jetzt entstehen sollen. `istVorne`: Kortex ist vorn und sichtbar — mit „nur im Hintergrund“ entsteht dann keine (das Studio zeigt einen Toast). */
    faellige(einstellungen, istVorne) {
      const t = jetzt();
      zustellzeiten = zustellzeiten.filter((z) => sek(t, z) < 60);
      letzteZustellung = new Map([...letzteZustellung].filter(([, z]) => sek(t, z) < 60));
      const unterdrueckt = einstellungen.mitteilungenNurImHintergrund && istVorne;
      const ton = einstellungen.mitteilungenTon;
      const aus = [];
      if (ueberzaehlig > 0) {
        if (unterdrueckt) ueberzaehlig = 0;
        else if (zustellzeiten.length < R.maxProMinute) {
          aus.push({ kennung: kennung(t), gruppe: "kortex-sammlung", titel: "Kortex", untertitel: null, text: SATZ.weitere(ueberzaehlig), ton, ziel: "aktivitaet", istProbe: false });
          zustellzeiten.push(t); ueberzaehlig = 0;
        }
      }
      const faellig = gruppen.filter((g) => sek(t, g.aufgenommen) >= R.sammelfenster);
      gruppen = gruppen.filter((g) => !faellig.includes(g));
      for (const g of faellig) {
        const ereignisse = g.ereignisse.filter((e) => erlaubt(e.art, einstellungen, artSchalter)); // Schalter können sich während des Fensters geändert haben
        const erstes = ereignisse[0];
        if (!erstes || unterdrueckt) continue;
        const abweisung = erstes.art === "abweisung" ? [erstes.wer ?? "", erstes.vault ?? "", erstes.grund ?? ""].join("|") : null;
        if (abweisung && letzteAbweisung.has(abweisung) && sek(t, letzteAbweisung.get(abweisung)) < R.abweisungsPause) continue;
        if (letzteZustellung.has(g.schluessel) && sek(t, letzteZustellung.get(g.schluessel)) < R.burstSperre) continue;
        if (zustellzeiten.length >= R.maxProMinute) { ueberzaehlig++; continue; }
        aus.push(mitteilung(ereignisse, ton, t));
        zustellzeiten.push(t);
        letzteZustellung.set(g.schluessel, t);
        if (abweisung) letzteAbweisung.set(abweisung, t);
      }
      return aus;
    },
  };
}

/**
 * Der Leser (AktivitaetsLeser): meldet nur, was NACH dem Anlegen dazukommt. Er benutzt `leseEreignisse` und `protokollKennungen` aus gemeinsam/aktivitaet.mjs (abh) und liest eine Datei nur neu,
 * wenn sich Größe oder Zeitstempel geändert haben. Schon gemeldete Kennungen kommen nie noch einmal (Schutz bei Rotation der Datei).
 * abh: { support, leseEreignisse(support, kennung), protokollKennungen(support), dateiStand(kennung) → string|null }
 */
export function erzeugeLeser(abh) {
  const gesehen = new Set(), stand = new Map();
  const MAX = 2000;
  const merke = (id) => { if (gesehen.has(id)) return false; gesehen.add(id); if (gesehen.size > MAX) gesehen.delete(gesehen.values().next().value); return true; };
  const lies = (kennung) => { const s = abh.dateiStand(kennung); if (s === stand.get(kennung)) return null; stand.set(kennung, s); return abh.leseEreignisse(abh.support, kennung); };
  // Beim Anlegen steht jede vorhandene Datei am Ende: gemeldet wird nur, was danach dazukommt
  for (const k of abh.protokollKennungen(abh.support)) for (const e of lies(k) || []) merke(e.id);
  return {
    neueEreignisse() {
      const aus = [];
      for (const k of abh.protokollKennungen(abh.support)) for (const e of lies(k) || []) if (merke(e.id)) aus.push(e);
      return aus;
    },
  };
}
