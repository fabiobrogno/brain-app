// ERZEUGT von scripts/erzeuge-gemeinsam-kopien.mjs aus Ressourcen/gemeinsam/kontingent-regeln.mjs — nicht von Hand ändern.
// gemeinsam/kontingent-regeln.mjs — die Regeln des Kontingents als reine Funktionen (Paket E5). Keine Importe, keine Uhr, kein Dateizugriff: Werkstatt (Node) und Studio (Kopie
// `studio/kontingent-regeln.js`, erzeugt von scripts/erzeuge-gemeinsam-kopien.mjs) rechnen mit genau derselben Fassung; die Hülle (Swift oder eine andere) hat damit nichts zu tun.
//   · Takt der Abfragen (planeAbfrage, naechsterTakt, leseRetryAfter) — nur bei sichtbarem Fenster, Aktivieren frischt auf, Retry-After bindet, Fehlerpause
//   · Dichte-Leiter der Statusleiste (DICHTE, waehleDichte, waehleSichtbare)
//   · ruhig veraltet (alterMin, istRuhigAlt, warnzeichenNoetig)
//   · verbraucht/übrig (angezeigtProzent)
//   · Schwellen 80 % und 100 % höchstens einmal je Fenster und Konto (planeSchwellen)
// Die monotone Regel (im selben Fenster steigt der Verbrauch nur) steht in kortex-statuszeile.mjs, weil sie dort beim Schreiben der Werte gebraucht wird und diese Datei eigenständig bleiben muss.
// Muster: Orca src/main/rate-limits/service/service-types.ts:99–121, service-polling.ts, src/renderer/src/components/status-bar/status-bar-density.ts, StatusBarProviderSegment.tsx
// (CALM_STALE_USAGE_MAX_AGE_MS), src/shared/usage-percentage-display.ts @239e17f (MIT, Lovecast Inc.).

// ───────────── Takt ─────────────
export const TAKT_MS = 15 * 60_000;              // Orca: DEFAULT_POLL_MS — alle 15 Minuten
export const MIN_NEU_MS = 5 * 60_000;            // Orca: MIN_REFETCH_MS — frühestens 5 Minuten nach der letzten Abfrage (auch beim Aktivieren des Fensters)
export const VERALTET_MS = 30 * 60_000;          // Orca: STALE_THRESHOLD_MS — nach 30 Minuten „veraltet“
export const FEHLER_PAUSE_MIN_MS = 30_000;       // Orca: ACTIVE_FAILURE_REFETCH_MS — bei Fehlern 30 s …
export const FEHLER_PAUSE_MAX_MS = 15 * 60_000;  // … bis höchstens 15 Minuten
export const MAX_FEHLER_FOLGE = 8;               // Orca: MAX_ACTIVE_FAILURE_STREAK — danach pausiert das automatische Abfragen (von Hand geht es weiter)
export const MAX_RETRY_AFTER_MS = 24 * 3_600_000; // Orca: LONG_STALE_THRESHOLD_MS — Retry-After bindet bis zu 24 Stunden

// Wartezeit nach dem n-ten Fehlschlag in Folge: 30 s, 60 s, 2 min … höchstens 15 min
export const fehlerPause = (anzahl) => Math.min(FEHLER_PAUSE_MAX_MS, FEHLER_PAUSE_MIN_MS * 2 ** Math.max(0, anzahl - 1));

// Retry-After (Sekunden oder HTTP-Datum, auch in einem Fehlertext) → Wartezeit in ms, begrenzt auf 1 s … 24 h; nicht Erkennbares → null
export function leseRetryAfter(roh, jetzt = Date.now()) {
  let ms = null;
  if (typeof roh === "number" && Number.isFinite(roh)) ms = roh * 1000;
  else if (typeof roh === "string") {
    const m = /retry[-\s]?after\D{0,6}(\d{1,9})(?!\d|\s*[A-Za-z]{3},)/i.exec(roh) || /^\s*(\d{1,9})\s*$/.exec(roh);
    if (m) ms = Number(m[1]) * 1000;
    else {
      const d = /retry[-\s]?after\s*[:=]?\s*([A-Za-z]{3},[^\n;]{10,40}GMT)/i.exec(roh) || /^\s*([A-Za-z]{3},[^\n;]{10,40}GMT)\s*$/.exec(roh);
      const t = d ? Date.parse(d[1]) : NaN;
      if (Number.isFinite(t)) ms = t - jetzt;
    }
  }
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, Math.round(ms)));
}

// Soll jetzt abgefragt werden? Rein: alles kommt als Eingabe.
//   e: { jetzt, sichtbar (Studio-Fenster sichtbar), aktiviert (das Fenster wurde gerade aktiv), neu (Klick auf „Auffrischen“), laeuft (eine Abfrage ist im Gang),
//        letzterVersuch (ms | 0), fehlerFolge (Anzahl Fehler in Folge), retryBis (ms | 0: bindende Wartezeit des Anbieters) }
//   → { abfragen: boolean, grund, warteMs (bis wann frühestens: ms | null) }
export function planeAbfrage(e) {
  const jetzt = e.jetzt, seit = jetzt - (e.letzterVersuch || 0), folge = e.fehlerFolge || 0;
  if (e.laeuft) return { abfragen: false, grund: "laeuft", warteMs: null };
  if (!e.sichtbar) return { abfragen: false, grund: "unsichtbar", warteMs: null }; // nur solange das Studio-Fenster zu sehen ist
  if ((e.retryBis || 0) > jetzt) return { abfragen: false, grund: "retry-after", warteMs: e.retryBis - jetzt }; // bindet auch beim Auffrischen von Hand
  if (!e.letzterVersuch) return { abfragen: true, grund: "erste", warteMs: 0 };
  if (e.neu) return seit >= MIN_NEU_MS ? { abfragen: true, grund: "neu", warteMs: 0 } : { abfragen: false, grund: "zu-frueh", warteMs: MIN_NEU_MS - seit };
  if (folge >= MAX_FEHLER_FOLGE) return { abfragen: false, grund: "fehler-pause", warteMs: null }; // erst ein Klick auf „Auffrischen“ nimmt es wieder auf
  const noetig = folge ? fehlerPause(folge) : e.aktiviert ? MIN_NEU_MS : TAKT_MS; // Aktivieren: ab 5 Minuten alt; sonst der Takt von 15 Minuten
  return seit >= noetig ? { abfragen: true, grund: e.aktiviert ? "aktiviert" : "takt", warteMs: 0 } : { abfragen: false, grund: "zu-frueh", warteMs: noetig - seit };
}

// Wann sieht das Studio das nächste Mal nach (ms) — null = gar nicht (Fenster unsichtbar: beim Aktivieren geht es sofort weiter)
export function naechsterTakt({ sichtbar, schnell = false, abfrageMs = 60_000, schnellMs = 3000 }) {
  if (!sichtbar) return null;
  return schnell ? schnellMs : abfrageMs;
}

// ───────────── ruhig veraltet ─────────────
export const RUHIG_AB_MIN = 10;     // ab hier steht grau „Stand vor N Min“ (Prototyp)
export const WARNUNG_AB_MIN = 30;   // Orca: STALE_THRESHOLD_MS — erst darüber UND nach einem Fehler erscheint das Warnzeichen
const ZAHL = (x) => typeof x === "number" && Number.isFinite(x);

// Alter des Standes in Minuten (aufgerundet nie: ganze Minuten), null ohne Zeitangabe
export function alterMin(aktualisiert, jetzt) {
  const t = typeof aktualisiert === "string" ? Date.parse(aktualisiert) : aktualisiert;
  return ZAHL(t) ? Math.max(0, Math.floor((jetzt - t) / 60000)) : null;
}
export const istRuhigAlt = (e, jetzt) => { const a = alterMin(e && e.aktualisiert, jetzt); return a !== null && a >= RUHIG_AB_MIN; };
// Das Warnzeichen NUR, wenn die letzte Abfrage scheiterte UND der Wert älter als 30 Minuten ist. Alles andere ist ruhig: grauer Stand, kein Zeichen.
export function warnzeichenNoetig(e, jetzt) {
  if (!e || e.status !== "fehler-mit-wert") return false;
  const a = alterMin(e.aktualisiert, jetzt);
  return a !== null && a > WARNUNG_AB_MIN;
}

// ───────────── verbraucht / übrig ─────────────
export const ANZEIGE = ["verbraucht", "uebrig"];
// Prozent, wie sie angezeigt werden (Balken und Zahl); die Stufenfarbe richtet sich immer nach dem VERBRAUCH
export function angezeigtProzent(verbraucht, modus) {
  const p = Math.min(100, Math.max(0, ZAHL(verbraucht) ? verbraucht : 0));
  return modus === "uebrig" ? 100 - p : p;
}

// ───────────── Dichte-Leiter der Statusleiste ─────────────
// Fünf Stufen, gemessen an der verfügbaren Breite (nicht an festen Haltepunkten): voll → kompakt → knappstes Fenster → „+N“ → nur Symbol.
export const DICHTE = ["voll", "kompakt", "knappstes", "plus-n", "symbol"];
// breiten[i] = so breit ist Stufe i (gemessen); gewählt wird die geräumigste Stufe, die passt, sonst die engste. Ungemessene Stufen (undefined) gelten als „passt nicht“, die engste passt immer.
export function waehleDichte(breiten, verfuegbar, toleranz = 1) {
  const letzte = DICHTE.length - 1;
  for (let i = 0; i < letzte; i++) {
    const b = breiten[i];
    if (ZAHL(b) && b <= verfuegbar + toleranz) return i;
  }
  return letzte;
}
// Welche Konten bleiben, wenn nur Platz für wenige ist („+N“): dringende (ab 80 %, voll, Warnzeichen) bleiben immer, sonst das dringendste eines; der Rest wird zu „+N“.
//   konten: [{ id, prozent (knappstes Fenster, Verbrauch), dringend }] in Anzeigereihenfolge → { sichtbar: [id…], mehr: n }
export function waehleSichtbare(konten) {
  if (!konten.length) return { sichtbar: [], mehr: 0 };
  let sichtbar = konten.filter((k) => k.dringend).map((k) => k.id);
  if (!sichtbar.length) {
    const top = konten.reduce((a, k) => ((k.prozent ?? -1) > (a.prozent ?? -1) ? k : a), konten[0]);
    sichtbar = [top.id];
  }
  return { sichtbar, mehr: konten.length - sichtbar.length };
}

// ───────────── Schwellen 80 % und 100 % ─────────────
export const SCHWELLEN = [80, 100];
export const FENSTER_ARTEN = ["session", "weekly"];
const GLEICH_MS = 60_000; // Rücksetzzeiten innerhalb von 60 s sind dasselbe Fenster (wie die monotone Regel)
export const gleichesFenster = (a, b) => (a === null || b === null || a === undefined || b === undefined ? a === b : Math.abs(a - b) <= GLEICH_MS);

// Merkt je Konto und Fenster (session | weekly), welche Schwellen in WELCHEM Fenster schon gemeldet wurden.
//   vorher: { <kontoId>: { session: { resetsAt, gemeldet: [80, 100] }, weekly: {…} } } · konten: [{ id, programm, name, session, weekly }] (session/weekly: { usedPercent, resetsAt })
//   o: { jetzt, aktiv (Schalter „Mitteilung bei 80 und 100 %“) }
//   → { ereignisse: [{ konto, programm, name, fenster, schwelle, prozent }], nachher }
// Je Fenster und Konto höchstens eine Meldung je Schwelle; ein neues Fenster (andere Rücksetzzeit, > 60 s Unterschied, oder das alte ist abgelaufen) beginnt von vorn. Springt der Verbrauch über beide
// Schwellen auf einmal, kommt nur die höchste (100 %), 80 % gilt dann als mitgemeldet. Ist der Schalter aus, wird der Stand trotzdem gemerkt (Einschalten meldet nichts nach).
export function planeSchwellen(vorher, konten, { jetzt, aktiv = true } = {}) {
  const nachher = {};
  const ereignisse = [];
  for (const k of konten) {
    const alt = vorher && vorher[k.id] && typeof vorher[k.id] === "object" ? vorher[k.id] : {};
    const neu = {};
    for (const art of FENSTER_ARTEN) {
      const w = k[art];
      const gemerkt = alt[art] && typeof alt[art] === "object" ? alt[art] : null;
      if (!w || !ZAHL(w.usedPercent)) { if (gemerkt && ZAHL(gemerkt.resetsAt) && gemerkt.resetsAt > jetzt) neu[art] = gemerkt; continue; } // keine Zahl: das gemerkte Fenster bleibt, solange es läuft
      const resetsAt = ZAHL(w.resetsAt) ? w.resetsAt : null;
      if (resetsAt !== null && resetsAt <= jetzt) continue; // dieses Fenster ist schon vorbei (alter Stand einer ruhenden Sitzung): zählt nicht, nichts wird gemerkt
      const abgelaufen = !!gemerkt && ZAHL(gemerkt.resetsAt) && gemerkt.resetsAt <= jetzt;
      // ohne Rücksetzzeit gilt das zuletzt bekannte, noch laufende Fenster (nie erneut 80 % melden); ein neues erkennt man dann nur am Absinken unter die erste Schwelle
      const selbes = !!gemerkt && !abgelaufen && (resetsAt === null ? w.usedPercent >= SCHWELLEN[0] : gleichesFenster(gemerkt.resetsAt ?? null, resetsAt));
      const gemeldet = new Set(selbes && Array.isArray(gemerkt.gemeldet) ? gemerkt.gemeldet.filter(ZAHL) : []);
      const erreicht = SCHWELLEN.filter((s) => w.usedPercent >= s && !gemeldet.has(s));
      if (erreicht.length) {
        for (const s of erreicht) gemeldet.add(s);
        if (aktiv) ereignisse.push({ konto: k.id, programm: k.programm, name: k.name, fenster: art, schwelle: Math.max(...erreicht), prozent: Math.round(w.usedPercent) });
      }
      // Rücksetzzeit des Fensters festhalten: bei gleichem Fenster die frühere (stabil), sonst die neue
      neu[art] = { resetsAt: selbes ? (gemerkt.resetsAt ?? null) : resetsAt, gemeldet: [...gemeldet].sort((a, b) => a - b) };
    }
    if (neu.session || neu.weekly) nachher[k.id] = neu;
  }
  return { ereignisse, nachher };
}
