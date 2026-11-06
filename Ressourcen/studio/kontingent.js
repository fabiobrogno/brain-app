// Anzeige des Kontingents der KI-Konten (Paket P7) — ein eigenständiger Baustein ohne Abhängigkeit von der Seite, in die er eingesetzt wird:
//   · reine Funktionen: balkenKlasse (Farbstufen), fensterAnsicht / kontoAnsicht (was steht da: Prozent, „voll“, Rücksetzzeit, Zustand, nächster Schritt)
//   · Bausteine: kontingentBlock (Einstellungen: beide Balken mit Prozent und Rücksetzzeit je Konto), kontingentKompakt (Frag-Feld), miniBalken (Statusleiste), optionSub (Auswahl im Frag-Feld)
//   · kontingentStand(api): der gemeinsame Stand aus GET /api/ki/kontingent (Abfrage alle 60 s solange das Fenster sichtbar ist, alle 3 s solange Codex noch gefragt wird)
//   · erzeugeKontoLeiste(z): der Abschnitt der Statusleiste — ein Eintrag je Konto mit Dichte-Leiter —, das Popover „Kontingent“ und das Rechtsklick-Menü. Die Statusleiste (app.js)
//     setzt nur `leiste.knoten()` (und `messKnoten()`) ein; der Knoten bleibt derselbe Knoten und zeichnet sich selbst neu.
// Kortex liest dafür keine Anmeldedaten: Claude Code meldet sein Kontingent an die Statuszeile, Codex antwortet dem Programm selbst (Werkstatt: werkstatt/kontingent.mjs).
// Paket E5 (Kontingent wie Orca): Dichte-Leiter der Statusleiste (gemessen, nicht nach festen Breiten), Popover „Kontingent“ mit allen Konten, ruhig veraltet, verbraucht/übrig,
// Rechtsklick-Menü der Statusleiste; die Regeln selbst stehen als reine Funktionen in kontingent-regeln.js (Kopie von gemeinsam/kontingent-regeln.mjs).
// Muster: Orca R/components/status-bar/InlineProviderUsage.tsx, ProviderDetailsMenu.tsx, ClaudeSwitcherMenu.tsx und provider-extra-usage-section.tsx (barColor) @9bccd67 (MIT, Lovecast Inc.):
// je Anbieter ein Abschnitt mit Balken, „NN %“ und Rücksetzzeit; Klick öffnet ein Menü mit Konto-Wechsel; Balken grau unter 60 %, gelb 60–79 %, rot ab 80 %.
import { h, dialog, toast } from "./hilfen.js";
import { knopf as baueKnopf, segment } from "./bausteine.js";
import { symbol, GROESSE } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { oeffnePopover } from "./popover.js";
import { oeffneMenue as oeffneKontextMenue } from "./menue.js";
import { TKO } from "./texte-kontingent.js";
import { alterMin, istRuhigAlt, warnzeichenNoetig, angezeigtProzent, waehleDichte, waehleSichtbare, naechsterTakt, DICHTE } from "./kontingent-regeln.js";

// ============================================================ Optionen (App-Einstellungen, einstellungen.json)
// kiKontingentStatusleiste: Eintrag in der Statusleiste · kiKontingentAnzeige: verbraucht | uebrig · statusWoerter / statusFormat: die beiden Teile rechts · mitteilungenKontingent: 80/100 %.
// Eine Quelle für Statusleiste, Popover, Einstellungen: app.js ruft `setze` mit den Werten aus GET /api/einstellungen (und nach jedem Speichern); alle Anzeigen hören mit `abonniere`.
const OPT_STANDARD = { kiKontingentStatusleiste: true, kiKontingentAnzeige: "verbraucht", statusWoerter: true, statusFormat: true, mitteilungenKontingent: true };
const OPT_GUELTIG = {
  kiKontingentStatusleiste: (v) => typeof v === "boolean", kiKontingentAnzeige: (v) => v === "verbraucht" || v === "uebrig",
  statusWoerter: (v) => typeof v === "boolean", statusFormat: (v) => typeof v === "boolean", mitteilungenKontingent: (v) => typeof v === "boolean",
};
export const kontingentOptionen = (() => {
  const werte = { ...OPT_STANDARD }, hoerer = new Set();
  return {
    werte,
    modus: () => (werte.kiKontingentAnzeige === "uebrig" ? "uebrig" : "verbraucht"),
    // Nur gültige, geänderte Werte zählen; gemeldet wird einmal (null/unbekannt/ungültig → ignoriert)
    setze(neu) {
      let geaendert = false;
      for (const k of Object.keys(OPT_STANDARD)) if (neu && Object.hasOwn(neu, k) && OPT_GUELTIG[k](neu[k]) && neu[k] !== werte[k]) { werte[k] = neu[k]; geaendert = true; }
      if (geaendert) for (const f of [...hoerer]) { try { f(werte); } catch { /* ein Hörer darf die anderen nicht stören */ } }
      return geaendert;
    },
    abonniere(f) { hoerer.add(f); return () => hoerer.delete(f); },
  };
})();
// Schreibt Werte in einstellungen.json (sofort sichtbar, bei einem Fehler zurück auf den alten Wert). Einmal neu lesen, wenn die Datei zwischendurch anders wurde (409).
export async function schreibeAppEinstellung(api, neu) {
  const alt = {};
  for (const k of Object.keys(neu)) alt[k] = kontingentOptionen.werte[k];
  kontingentOptionen.setze(neu);
  try {
    for (let i = 0; i < 2; i++) {
      const d = await api.einstellungen();
      try {
        const r = await api.einstellungenSchreiben(neu, d.stand);
        kontingentOptionen.setze(r.werte);
        window.dispatchEvent(new CustomEvent("kortex-einstellungen")); // die Seite „Einstellungen“ liest neu
        return r;
      } catch (e) { if (!(e?.status === 409 && i === 0)) throw e; }
    }
  } catch (e) {
    kontingentOptionen.setze(alt);
    toast(TKO.fehlerSpeichern, { fehler: true, ms: 6000 });
    return null;
  }
  return null;
}

// ============================================================ reine Funktionen
export const balkenKlasse = (p) => (p >= 80 ? "rot" : p >= 60 ? "gelb" : "grau"); // Orca barColor: wörtlich
const ZAHL = (x) => typeof x === "number" && Number.isFinite(x);

// Ein Fenster (session | weekly) → was angezeigt wird. `jetzt` in ms (Uhr der Werkstatt, damit Tests und Anzeige übereinstimmen).
// `modus`: verbraucht | uebrig (Anzeige; die Stufenfarbe richtet sich immer nach dem Verbrauch). Standard: die Einstellung.
export function fensterAnsicht(w, art, jetzt, modus = kontingentOptionen.modus()) {
  if (!w || !ZAHL(w.usedPercent)) return { vorhanden: false };
  const p = Math.min(100, Math.max(0, w.usedPercent));
  if (ZAHL(w.resetsAt) && w.resetsAt <= jetzt) return { vorhanden: true, abgelaufen: true, prozent: 0, balken: angezeigtProzent(0, modus), stufe: "grau", prozentText: TKO.zurueckgesetzt, resetText: null, voll: false };
  const voll = p >= 100;
  const rest = ZAHL(w.resetsAt) ? (art === "session" ? TKO.restDauer(w.resetsAt - jetzt) : TKO.bisZeit(w.resetsAt, jetzt)) : null;
  return {
    vorhanden: true, abgelaufen: false, prozent: p, balken: angezeigtProzent(p, modus), stufe: balkenKlasse(p), voll,
    prozentText: voll ? TKO.voll : TKO.prozent(angezeigtProzent(p, modus)),
    resetText: voll && ZAHL(w.resetsAt) ? TKO.wiederAb(w.resetsAt, jetzt) : rest,
    resetsAt: ZAHL(w.resetsAt) ? w.resetsAt : null,
  };
}

const minutenSeit = (iso, jetzt) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.floor((jetzt - t) / 60000)) : null; };

// Ein Konto (Eintrag aus /api/ki/kontingent) → { hatWerte, session, weekly, voll, wiederAb, kurz, text, knopf, art, warnung }
//   hatWerte: mindestens ein Fenster mit Zahl · voll: ein Fenster ist bei 100 % (wiederAb = frühester Zeitpunkt, an dem das Konto wieder kann: das späteste Ende der vollen Fenster)
//   kurz: ein Wort für Statusleiste/Zeile · text: Erklärung MIT dem nächsten Schritt · knopf: Beschriftung der möglichen Aktion (nur Claude: „Kontingent anzeigen …“)
export function kontoAnsicht(e, jetzt, modus = kontingentOptionen.modus()) {
  if (!e) return { hatWerte: false, session: { vorhanden: false }, weekly: { vorhanden: false }, voll: false, wiederAb: null, warnung: null, knopf: null, kurz: TKO.status["nicht-abrufbar"].kurz, text: TKO.status["nicht-abrufbar"].text, art: "nicht-abrufbar" };
  const session = fensterAnsicht(e.session, "session", jetzt, modus), weekly = fensterAnsicht(e.weekly, "weekly", jetzt, modus);
  const hatWerte = session.vorhanden || weekly.vorhanden;
  const vollFenster = [session, weekly].filter((f) => f.voll);
  const voll = vollFenster.length > 0;
  const wiederAb = voll ? Math.max(...vollFenster.map((f) => f.resetsAt || 0)) || null : null;
  // Ruhig veraltet: ab 10 Minuten steht grau „Stand vor N Min“; das Warnzeichen (`warnzeichen`) nur nach einem gescheiterten Abruf UND bei einem Wert, der älter als 30 Minuten ist
  const alter = alterMin(e.aktualisiert, jetzt);
  const aus = { hatWerte, session, weekly, voll, wiederAb, art: e.status, codex: e.quelle === "codex", warnung: null, knopf: null, alter, standText: alter === null ? null : TKO.ruhig.stand(alter),
    ruhig: hatWerte && istRuhigAlt(e, jetzt), warnzeichen: hatWerte && warnzeichenNoetig(e, jetzt), programm: e.programm || null };
  const alt = e.aktualisiert ? TKO.vor(minutenSeit(e.aktualisiert, jetzt) ?? 0) : null;
  switch (e.status) {
    case "ok": return { ...aus, kurz: "", text: "" };
    case "veraltet": return { ...aus, kurz: TKO.vor(minutenSeit(e.aktualisiert, jetzt) ?? 0), text: TKO.veraltet(alt, aus.codex), warnung: "veraltet" };
    case "fehler-mit-wert": return { ...aus, kurz: TKO.fehlerKurz[e.fehlerArt] || TKO.fehlerKurz.sonst, text: TKO.fehler[e.fehlerArt] || TKO.fehler.sonst, warnung: "fehler" };
    case "fehler": return { ...aus, hatWerte: false, kurz: TKO.fehlerKurz[e.fehlerArt] || TKO.fehlerKurz.sonst, text: TKO.fehler[e.fehlerArt] || TKO.fehler.sonst, warnung: "fehler" };
    case "keine-werte": return { ...aus, hatWerte: false, kurz: TKO.status["keine-werte"].kurz, text: TKO.leer[e.programm] || (e.quelle === "codex" ? TKO.leer.codex : TKO.leer.claude), leer: true };
    case "nicht-abrufbar": return { ...aus, hatWerte: false, kurz: TKO.status["nicht-abrufbar"].kurz, text: e.programmName ? TKO.nichtAbrufbarVon(e.programmName) : TKO.status["nicht-abrufbar"].text };
    default: {
      const t = TKO.status[e.status] || TKO.status["nicht-abrufbar"];
      return { ...aus, hatWerte: false, kurz: t.kurz, text: t.text, knopf: t.knopf || null };
    }
  }
}

// Kurzer Text für die Auswahl im Frag-Feld: „42 % · 5 Std“ oder „voll · wieder ab 14:30“; ohne Werte leer
export function optionSub(e, jetzt) {
  const k = kontoAnsicht(e, jetzt);
  if (!k.hatWerte) return "";
  if (k.voll) return TKO.frag.optionVoll(TKO.wiederAb(k.wiederAb, jetzt));
  const f = k.session.vorhanden && !k.session.abgelaufen ? ["session", k.session] : k.weekly.vorhanden && !k.weekly.abgelaufen ? ["weekly", k.weekly] : null;
  return f ? TKO.frag.optionProzent(f[1].prozent, TKO.fenster[f[0]]) : "";
}

// ============================================================ Bausteine
const balken = (f) => {
  const fuell = h("i", { "aria-hidden": "true" });
  fuell.style.width = `${Math.max(0, Math.min(100, f.balken ?? f.prozent))}%`; // verbraucht: der Verbrauch · übrig: der Rest
  return h("span", { klasse: "kt-balken", "data-stufe": f.stufe, "data-voll": f.voll ? "ja" : null, "aria-hidden": "true" }, fuell);
};
function zeile(art, f) {
  return h("div", { klasse: "kt-zeile", "data-fenster": art, "data-stufe": f.stufe, "data-abgelaufen": f.abgelaufen ? "ja" : null, role: "group", "aria-label": `${TKO.fensterLang[art]}: ${f.prozentText}${f.resetText ? `, ${f.resetText}` : ""}` },
    h("span", { klasse: "kt-name", text: TKO.fenster[art] }), balken(f), h("span", { klasse: "kt-prozent", text: f.prozentText }),
    f.resetText ? h("span", { klasse: "kt-rest", text: f.resetText }) : null);
}

// Die leise Zeile unter den Balken: grau „Stand vor N Min“ (ab 10 Minuten); das Warnzeichen mit „Abruf fehlgeschlagen“ NUR nach einem gescheiterten Abruf bei einem Wert über 30 Minuten.
// Ein Hinweis zu Pause (8 Fehler in Folge) oder Wartezeit des Anbieters (Retry-After) steht in derselben Zeile.
function standNotiz(k, e, jetzt) {
  const teile = [];
  if (e?.pausiert) teile.push(TKO.ruhig.pausiert);
  else if (e?.wartetBis && Date.parse(e.wartetBis) > jetzt) teile.push(TKO.ruhig.wartet(new Date(e.wartetBis).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })));
  if (k.warnzeichen) {
    return h("p", { klasse: "kt-hinweis kt-w-fehler", "data-kt": "hinweis", "data-warn": "ja", role: "status", title: [TKO.ruhig.warnTitel, ...teile].join(" ") }, symbol("warnung", GROESSE.klein), h("span", { text: [TKO.ruhig.abrufFehler(k.standText), ...teile].join(" ") }));
  }
  if (!k.ruhig && !teile.length) return null;
  return h("p", { klasse: "kt-stand", "data-kt": "stand", title: k.text || null }, h("span", { text: [k.ruhig ? k.standText : null, ...teile].filter(Boolean).join(" · ") }));
}

// Die beiden Balken eines Kontos (Einstellungen, Menü). Ohne Werte: der Zustand in einem Satz (mit dem nächsten Schritt) und, wenn es eine gibt, die Aktion.
// o: { jetzt, aktion: { text, tun } | null, klein: bool }
export function kontingentBlock(e, { jetzt = Date.now(), aktion = null, klein = false } = {}) {
  const k = kontoAnsicht(e, jetzt);
  const box = h("div", { klasse: `kt-block${klein ? " kt-klein" : ""}`, "data-kt": "block", "data-status": e?.status || "unbekannt", "data-voll": k.voll ? "ja" : null });
  if (k.hatWerte) {
    box.append(h("div", { klasse: "kt-zeilen" }, k.session.vorhanden ? zeile("session", k.session) : null, k.weekly.vorhanden ? zeile("weekly", k.weekly) : null));
    const notiz = standNotiz(k, e, jetzt);
    if (notiz) box.append(notiz);
  } else {
    // „nicht abrufbar“ und „noch keine Werte“ sagen alles in einem Satz; sonst steht der Zustand fett vorn, dann folgt der nächste Schritt
    const inhalt = e?.status === "nicht-abrufbar" || k.leer ? [k.text] : [h("b", { text: `${k.kurz}.` }), " ", k.text];
    box.append(h("p", { klasse: `kt-hinweis${k.warnung ? ` kt-w-${k.warnung}` : ""}`, "data-kt": "hinweis", role: "status" }, symbol(e?.status === "laedt" ? "sanduhr" : "info", GROESSE.klein), h("span", {}, ...inhalt)));
  }
  if (aktion) box.append(aktion);
  return box;
}

// Für das Frag-Feld: beide Balken klein, bei „voll“ ein Satz mit der Rücksetzzeit; leer, wenn es nichts zu zeigen gibt
export function kontingentKompakt(e, { jetzt = Date.now(), name = "", andereFrei = false } = {}) {
  const k = kontoAnsicht(e, jetzt);
  const el = h("div", { klasse: "kt-kompakt", "data-kt": "kompakt", "data-voll": k.voll ? "ja" : null });
  if (k.hatWerte) {
    el.append(h("div", { klasse: "kt-zeilen" }, k.session.vorhanden ? zeile("session", k.session) : null, k.weekly.vorhanden ? zeile("weekly", k.weekly) : null));
    if (k.voll) el.append(h("p", { klasse: "kt-voll", "data-kt": "voll", role: "status" }, symbol("warnung", GROESSE.klein), h("span", { text: (andereFrei ? TKO.frag.voll : TKO.frag.vollOhneAnderes)(name, TKO.wiederAb(k.wiederAb, jetzt)) })));
  } else if (e && e.status !== "nicht-eingerichtet") {
    el.append(h("p", { klasse: "kt-leise", "data-kt": "leise" }, k.kurz, k.text ? ` · ${k.text}` : ""));
  }
  return el;
}

// Statusleiste: Mini-Balken (5 Std) mit Prozent; ohne Werte nur der Gedankenstrich-Zustand
export function miniBalken(e, jetzt) {
  const k = kontoAnsicht(e, jetzt);
  const f = k.session.vorhanden ? k.session : k.weekly?.vorhanden ? k.weekly : null;
  if (!k.hatWerte || !f) return h("span", { klasse: "kt-mini ohne-werte", "data-kt": "mini" }, h("span", { klasse: "kt-mini-text", text: k.kurz || "–" }));
  return h("span", { klasse: "kt-mini", "data-kt": "mini", "data-stufe": f.stufe, "data-voll": k.voll ? "ja" : null },
    balken(f), h("span", { klasse: "kt-mini-text", text: f.prozentText }),
    f.resetText ? h("span", { klasse: "kt-mini-rest", text: f.resetText }) : null);
}

// ============================================================ Gemeinsamer Stand
// Eine Instanz je Fenster (kontingentStand(api)). Abfrage der Werkstatt alle 60 s (nur solange das Fenster sichtbar ist), alle 3 s solange Codex noch gefragt wird; die Werkstatt selbst
// fragt Codex höchstens alle 15 Minuten (frühestens 5 Minuten nach der letzten Abfrage) — wie oft die Oberfläche nachsieht, ändert daran nichts.
export function erzeugeKontingentStand({ api, abfrageMs = 60_000, laedtMs = 3000 } = {}) {
  const S = { daten: null, fehler: null, empfangen: 0, holt: null, timer: 0, laeuft: false, hoerer: new Set(), roh: "" };
  const melde = () => { for (const f of [...S.hoerer]) { try { f(S); } catch { /* ein Hörer darf die anderen nicht stören */ } } };
  const jetzt = () => (S.daten && Number.isFinite(Date.parse(S.daten.jetzt)) ? Date.parse(S.daten.jetzt) + (Date.now() - S.empfangen) : Date.now());
  async function holen(neu = false, aktiviert = false) {
    if (S.holt) return S.holt;
    S.holt = (async () => {
      try {
        const d = await api.kiKontingent(neu, aktiviert);
        S.daten = d; S.empfangen = Date.now(); S.fehler = null;
        melde(); // auch ohne neue Werte: die Rücksetzzeiten laufen mit („noch 2 h 14 min“)
      } catch (e) { S.fehler = e; melde(); }
      finally { S.holt = null; }
      planen();
      return S.daten;
    })();
    return S.holt;
  }
  const brauchtSchnell = () => (S.daten?.konten || []).some((k) => k.status === "laedt" || k.laedt === true);
  function planen() {
    clearTimeout(S.timer);
    if (!S.laeuft) return;
    // Nur solange das Studio-Fenster zu sehen ist (kontingent-regeln.js#naechsterTakt); ein verdecktes Fenster fragt nicht, das Sichtbarwerden holt den Stand nach
    const ms = naechsterTakt({ sichtbar: typeof document === "undefined" || document.visibilityState !== "hidden", schnell: brauchtSchnell(), abfrageMs, schnellMs: laedtMs });
    if (ms === null) return;
    S.timer = setTimeout(() => holen(), ms);
  }
  // Aktivieren: der Stand wird neu gelesen; Codex fragt die Werkstatt nur, wenn die letzte Abfrage älter als 5 Minuten ist
  const sichtbar = () => { if (!S.laeuft) return; if (document.visibilityState === "visible") holen(false, true); else clearTimeout(S.timer); };
  return {
    api, state: S, jetzt, holen, neuLaden: async () => { if (S.holt) await S.holt; return holen(true); }, // läuft gerade eine Abfrage, kommt die frühere danach (sonst ginge der Klick verloren)
    start() { if (S.laeuft) return; S.laeuft = true; document.addEventListener("visibilitychange", sichtbar); holen(); },
    stopp() { S.laeuft = false; clearTimeout(S.timer); document.removeEventListener("visibilitychange", sichtbar); },
    eintrag: (id) => (S.daten?.konten || []).find((k) => k.id === id) || null,
    abonniere(f) { S.hoerer.add(f); return () => S.hoerer.delete(f); },
    // „Neu laden“ ist erst wieder möglich, wenn bei jedem Codex-Konto die 5 Minuten seit der letzten Abfrage um sind (Claude-Werte liegen schon lokal: sie lassen sich immer neu lesen)
    neuAb() {
      const codex = (S.daten?.konten || []).filter((k) => k.quelle === "codex" && k.neuAb);
      if (!codex.length) return null;
      const fruehestens = Math.min(...codex.map((k) => Date.parse(k.neuAb)));
      return fruehestens > jetzt() ? fruehestens : null;
    },
  };
}
let geteilt = null;
export function kontingentStand(api) { if (!geteilt) geteilt = erzeugeKontingentStand({ api }); return geteilt; }
export const _zuruecksetzen = () => { geteilt?.stopp(); geteilt = null; }; // nur für Tests

// ============================================================ Statusleiste: Segment „Kontingent“, Popover, Rechtsklick-Menü (Paket E5)
export const FRAGE_KONTO_EREIGNIS = "kortex-frage-konto";
const KT_PROGRAMME = ["claude", "codex"]; // Programme mit Kontingent; alle anderen sind „nicht abrufbar“ und stehen nur in den Einstellungen
const BRAUCHT_HANDLUNG = new Set(["nicht-eingerichtet", "geaendert", "neu-verknuepfen", "reparieren", "einstellungen-defekt", "nicht-abrufbar"]);
const knappstes = (a) => { const l = [["session", a.session], ["weekly", a.weekly]].filter(([, f]) => f.vorhanden); return l.length ? l.reduce((x, y) => (y[1].prozent > x[1].prozent ? y : x)) : null; };

// z: { stand (kontingentStand), vaultPfad(): string|null, vaultName(): string, oeffneKonten(): void, oeffneKi(): void }
// Ein Knopf in der Statusleiste mit einem Eintrag je Konto (Claude Code, Codex). Wie viel davon zu sehen ist, entscheidet die Breite (Dichte-Leiter, fünf Stufen):
//   voll (Name, 5 Std, Balken, Woche) → kompakt (Name, Prozent, Balken) → knappstes Fenster (nur Logo und Prozent) → „+N“ (ruhige Konten fallen weg, dringende bleiben) → nur Symbol.
// Gemessen wird vor dem Zeichnen: je Stufe steht unsichtbar eine Kopie (`messKnoten()`, neben dem Knopf), die verfügbare Breite ist die des Knopfes plus die freie Fläche rechts davon abzüglich dessen,
// was andere Teile der Leiste schon kürzen müssen. Der Knopf selbst ist der einzige Knoten (`knoten()`); die Statusleiste setzt ihn nur ein und ruft nach jedem Neuzeichnen `messe()`.
export function erzeugeKontoLeiste(z) {
  const stand = z.stand;
  const el = h("button", { type: "button", klasse: "st kt-leiste", "data-st": "kontingent", "aria-haspopup": "dialog", "aria-expanded": "false", hidden: true });
  const probe = h("span", { klasse: "kt-probe", "aria-hidden": "true" });
  probe.inert = true;
  const S = { stufe: 0, d: null, vault: undefined, raf: 0, wechsel: [], ro: null, beobachtet: null };
  let offenMenue = null, rechtsMenue = null, auffrischt = false;

  const konten = () => stand.state.daten?.konten || [];
  const vault = () => z.vaultPfad?.() || null;

  // ---- Daten: ein Eintrag je Konto mit Kontingent
  function daten(jetzt) {
    const modus = kontingentOptionen.modus();
    // Konten, die erst eine Handlung brauchen (nicht eingerichtet, Statuszeile geändert …) stehen nur im Popover und in den Einstellungen: die Leiste verspricht keine Werte, die nicht kommen
    const alle = konten().filter((k) => KT_PROGRAMME.includes(k.programm)).map((k) => { const e = stand.eintrag(k.id), a = kontoAnsicht(e, jetzt, modus); return { k, e, a, t: knappstes(a) }; })
      .filter((x) => x.t || !BRAUCHT_HANDLUNG.has(x.e?.status || "nicht-abrufbar"));
    const mit = alle.filter((x) => x.t);
    for (const x of mit) x.dringend = x.t[1].prozent >= 80 || x.a.voll || x.a.warnzeichen;
    return { alle, mit, modus, warn: alle.some((x) => x.a.warnzeichen), jetzt, erwartet: alle.some((x) => ["keine-werte", "ohne-kontingent", "laedt"].includes(x.e?.status)) };
  }
  const haupt = (a) => (a.session.vorhanden ? a.session : a.weekly);

  // ---- Eintrag eines Kontos in der gewünschten Dichte (0 voll · 1 kompakt · 2 knappstes Fenster)
  function eintrag(x, stufe, modus) {
    const { k, a, t } = x;
    const f = haupt(a), art = a.session.vorhanden ? "session" : "weekly";
    const pct = (w, klasse = "kt-pct") => h("span", { klasse, text: w.prozentText });
    const teile = [kiLogo(k.programm, 14, { dekorativ: true })];
    if (stufe === 0) {
      teile.push(h("span", { klasse: "kt-name-text", text: k.name }),
        h("span", { klasse: "kt-seg", text: `${TKO.segment.fensterKurz[art]} ${f.prozentText}${f.voll ? "" : ` ${TKO.anzeige[modus]}`}` }), balken(f));
      if (a.session.vorhanden && a.weekly.vorhanden) teile.push(h("span", { klasse: "kt-seg kt-woche", text: `${TKO.segment.fensterKurz.weekly} ${a.weekly.prozentText}` }));
    } else if (stufe === 1) teile.push(h("span", { klasse: "kt-name-text", text: k.name }), pct(f), balken(f));
    else teile.push(pct(t[1]));
    const tief = stufe >= 2 ? t[1] : f;
    return h("span", { klasse: "kt-eintrag", "data-konto": k.id, "data-programm": k.programm, "data-stufe": tief.stufe, "data-voll": a.voll ? "ja" : null, "data-ruhig": a.ruhig ? "ja" : null, "data-warn": a.warnzeichen ? "ja" : null }, ...teile);
  }

  // ---- Inhalt des Knopfes in Dichte `stufe` (0–4)
  function inhalt(stufe, d) {
    const warn = d.warn ? h("span", { klasse: "kt-warn", title: TKO.ruhig.warnTitel, "data-kt": "warnzeichen" }, symbol("warnung", GROESSE.text)) : null;
    if (!d.mit.length) return [symbol("tacho", GROESSE.text), stufe <= 1 ? h("span", { klasse: "kt-leer-text", text: d.erwartet ? (stufe === 0 ? TKO.segment.leerVoll : TKO.segment.leerKurz) : TKO.status["nicht-abrufbar"].kurz }) : null];
    if (stufe >= 4) return [warn || symbol("tacho", GROESSE.text)];
    let liste = d.mit, mehr = [];
    if (stufe === 3) {
      const w = waehleSichtbare(d.mit.map((x) => ({ id: x.k.id, prozent: x.t[1].prozent, dringend: x.dringend })));
      liste = d.mit.filter((x) => w.sichtbar.includes(x.k.id)); mehr = d.mit.filter((x) => !w.sichtbar.includes(x.k.id));
    }
    const st = stufe === 3 ? 2 : stufe;
    return [warn, h("span", { klasse: "kt-eintraege" }, liste.map((x) => eintrag(x, st, d.modus))),
      mehr.length ? h("span", { klasse: "kt-mehr", "data-kt": "mehr", title: TKO.segment.mehrTitel(mehr.length, mehr.map((x) => x.k.name).join(", ")) }, TKO.segment.mehr(mehr.length)) : null];
  }
  const beschreibung = (x) => {
    const t = [x.a.session.vorhanden ? `${TKO.fenster.session} ${x.a.session.prozentText}${x.a.session.voll ? "" : ` ${TKO.anzeige[kontingentOptionen.modus()]}`}${x.a.session.resetText ? `, ${x.a.session.resetText}` : ""}` : null,
      x.a.weekly.vorhanden ? `${TKO.fenster.weekly} ${x.a.weekly.prozentText}${x.a.weekly.voll ? "" : ` ${TKO.anzeige[kontingentOptionen.modus()]}`}${x.a.weekly.resetText ? `, ${x.a.weekly.resetText}` : ""}` : null].filter(Boolean).join(" · ");
    return `${x.k.name}: ${t}${x.a.ruhig ? ` (${x.a.standText})` : ""}`;
  };

  // ---- Zeichnen (Inhalt in der gemessenen Dichte; die Messkopien in allen fünf)
  function render() {
    const d = S.d;
    el.dataset.dichte = DICHTE[S.stufe];
    el.dataset.ton = d.mit.some((x) => x.dringend) ? "dringend" : "ruhig";
    const zeilen = d.mit.map(beschreibung);
    el.title = zeilen.length ? zeilen.join("\n") : d.erwartet ? TKO.segment.leerVoll : TKO.status["nicht-abrufbar"].kurz;
    el.setAttribute("aria-label", zeilen.length ? TKO.segment.aria(zeilen.join("; ")) : `${TKO.segment.titel}. ${TKO.leer.allgemein}`);
    el.replaceChildren(...inhalt(S.stufe, d).filter(Boolean)); // replaceChildren(null) schriebe „null“ in den Knopf
  }
  function zeichneProben() {
    probe.replaceChildren(...DICHTE.map((name, i) => h("button", { type: "button", klasse: "st kt-leiste", tabindex: "-1", "data-dichte": name }, ...inhalt(i, S.d))));
  }
  function zeichne() {
    if (vault() !== S.vault) { const erster = S.vault === undefined; S.vault = vault(); if (!erster) stand.holen(); } // anderer Vault: die Stufen gelten neu
    const jetzt = stand.jetzt();
    const aus = () => { el.hidden = true; el.removeAttribute("data-konten"); el.dataset.zustand = "aus"; probe.replaceChildren(); };
    if (!kontingentOptionen.werte.kiKontingentStatusleiste) { aus(); offenMenue?.zu(); return; }
    if (!stand.state.daten && !stand.state.fehler) { aus(); return; }
    if (!stand.state.daten) { // die Werkstatt hat noch nie geantwortet: ehrlich „nicht abrufbar“, ein Klick zeigt den nächsten Schritt
      el.hidden = false; el.dataset.zustand = "fehler"; el.removeAttribute("data-konten"); el.removeAttribute("data-dichte"); probe.replaceChildren();
      el.title = TKO.leiste.ladeFehler; el.setAttribute("aria-label", `${TKO.status["nicht-abrufbar"].kurz}. ${TKO.leiste.ladeFehler}`);
      el.replaceChildren(symbol("warnung", GROESSE.text), h("span", { klasse: "kt-name-text", text: TKO.status["nicht-abrufbar"].kurz }));
      return;
    }
    S.d = daten(jetzt);
    if (!S.d.alle.length) { aus(); return; } // kein Konto mit Kontingent: nichts zu zeigen (der Knopf „KI verbinden“ der Leiste bleibt)
    el.hidden = false;
    el.dataset.zustand = S.d.mit.length ? (S.d.mit.some((x) => x.a.voll) ? "voll" : "werte") : "ohne";
    el.dataset.konten = String(S.d.alle.length);
    zeichneProben();
    render();
    planeMessung();
  }

  // ---- Messen: die geräumigste Stufe, die passt (kontingent-regeln.js#waehleDichte)
  const planeMessung = () => { if (S.raf) return; S.raf = requestAnimationFrame(() => { S.raf = 0; messe(); }); };
  function messe() {
    if (el.hidden || !el.isConnected || !S.d || !probe.children.length) return;
    const bar = el.closest(".status");
    if (!bar) return;
    if (S.beobachtet !== bar) { S.ro?.disconnect(); S.beobachtet = bar; S.ro = new ResizeObserver(planeMessung); S.ro.observe(bar); S.ro.observe(el); document.fonts?.ready?.then(planeMessung); }
    const breiten = [...probe.children].map((b) => b.getBoundingClientRect().width);
    const platzRechts = bar.querySelector(":scope > .sp")?.getBoundingClientRect().width || 0;
    // Was andere Teile der Leiste schon kürzen müssen (Ellipse unterhalb ihrer eigenen Grenze, Überlauf der Leiste), geht vom Platz ab
    let defizit = Math.max(0, bar.scrollWidth - bar.clientWidth);
    for (const t of bar.querySelectorAll(":scope > .st > span")) {
      const erlaubt = parseFloat(getComputedStyle(t).maxWidth);
      defizit += Math.max(0, Math.min(t.scrollWidth, Number.isFinite(erlaubt) ? erlaubt : Infinity) - t.clientWidth);
    }
    const verfuegbar = el.getBoundingClientRect().width + platzRechts - defizit;
    let neu = waehleDichte(breiten, verfuegbar);
    // Schutz gegen Hin und Her (Schriften, die sich erst laden): mehr als vier Wechsel in einer halben Sekunde → die engere Stufe bleibt
    const jetzt = Date.now();
    S.wechsel = S.wechsel.filter((t) => jetzt - t < 500);
    if (neu !== S.stufe) {
      if (S.wechsel.length >= 4) neu = Math.max(neu, S.stufe); else S.wechsel.push(jetzt);
    }
    if (neu !== S.stufe) { S.stufe = neu; render(); }
  }

  stand.abonniere(() => { zeichne(); offenMenue?.neu(); });
  kontingentOptionen.abonniere(() => { zeichne(); offenMenue?.neu(); });
  // Das aktive Konto wurde gewechselt (Einstellungen, Frag-Feld): der Stand der Werkstatt trägt es, hier nur neu lesen
  window.addEventListener(FRAGE_KONTO_EREIGNIS, (ev) => {
    const k = konten().find((x) => x.id === ev.detail?.id);
    if (k) for (const x of konten()) if (x.programm === k.programm) x.aktiv = x.id === k.id;
    offenMenue?.neu();
  });
  window.addEventListener("kortex-konten", () => stand.holen());

  // ---- Popover „Kontingent“
  function gruppe(p, liste, jetzt) {
    const g = h("section", { klasse: "kt-gruppe", "data-programm": p, "aria-label": TKO.pop.programme[p] },
      h("div", { klasse: "kt-g-kopf" }, kiLogo(p, 14, { dekorativ: true }), h("span", { text: TKO.pop.programme[p] })));
    for (const k of liste) {
      const e = stand.eintrag(k.id);
      const mehrere = liste.length > 1;
      g.append(h("div", { klasse: "kt-konto", "data-konto": k.id, "data-programm": p, "data-aktiv": k.aktiv === true ? "ja" : "nein" },
        h("div", { klasse: "kt-k-kopf" }, h("span", { klasse: "kt-k-name", text: k.name }), mehrere && k.aktiv === true ? h("span", { klasse: "ez-marke ez-marke-akzent kt-aktiv", text: TKO.pop.aktiv }) : null),
        kontingentBlock(e, { jetzt, klein: true })));
    }
    return g;
  }
  function baueKopfUndRumpf() {
    const jetzt = stand.jetzt();
    const teile = [];
    const zeiten = konten().filter((k) => KT_PROGRAMME.includes(k.programm)).map((k) => stand.eintrag(k.id)?.aktualisiert).filter(Boolean).map(Date.parse).filter(Number.isFinite);
    const juengster = zeiten.length ? Math.floor((jetzt - Math.max(...zeiten)) / 60000) : null;
    const neuAb = stand.neuAb();
    const neuKnopf = h("button", { type: "button", klasse: "kt-m-neu", "data-aktion": "kt-neu", disabled: neuAb || auffrischt ? true : null, tabindex: "0",
      title: neuAb ? TKO.pop.auffrischenSpaeter(new Date(neuAb).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })) : TKO.pop.auffrischenTitel, "aria-label": TKO.pop.auffrischen,
      aufClick: async () => { auffrischt = true; offenMenue?.neu(); try { await stand.neuLaden(); } finally { auffrischt = false; offenMenue?.neu(); } } },
      h("span", { klasse: auffrischt ? "kt-dreht" : null }, symbol("sync", GROESSE.text)));
    teile.push(h("div", { klasse: "kt-m-titel", "data-kt": "kopf" }, h("b", { text: TKO.pop.titel }),
      h("span", { klasse: "kt-m-stand", "data-kt": "stand-kopf", text: auffrischt ? TKO.pop.aktualisiert : juengster === null ? "" : TKO.ruhig.stand(Math.max(0, juengster)) }), neuKnopf));
    const liste = h("div", { klasse: "kt-m-liste", role: "group", "aria-label": TKO.pop.titel });
    const gruppen = KT_PROGRAMME.map((p) => [p, konten().filter((k) => k.programm === p)]).filter(([, l]) => l.length);
    if (stand.state.fehler && !konten().length) liste.append(h("p", { klasse: "kt-leise", "data-kt": "fehler", text: TKO.leiste.ladeFehler }));
    else if (!gruppen.length) liste.append(h("p", { klasse: "kt-leise", "data-kt": "keine", text: TKO.pop.keine }));
    for (const [p, l] of gruppen) liste.append(gruppe(p, l, jetzt));
    teile.push(liste);
    return teile;
  }
  function baueMenue() {
    const box = h("div", { klasse: "kt-menue kt-pop", role: "dialog", "data-kt": "menue", "aria-label": TKO.pop.titel });
    const kopfRumpf = h("div", { klasse: "kt-pop-oben" }, ...baueKopfUndRumpf());
    const anzeige = segment({ optionen: TKO.anzeige.optionen, wert: kontingentOptionen.modus(), label: TKO.anzeige.label, groesse: "s", daten: { "data-kt": "anzeige" },
      aufAenderung: (w) => { schreibeAppEinstellung(stand.api, { kiKontingentAnzeige: w }); } });
    const fuss = h("div", { klasse: "kt-pop-fuss" }, anzeige,
      h("button", { type: "button", klasse: "kt-verwalten", "data-aktion": "kt-konten", aufClick: () => { offenMenue?.zu(); z.oeffneKonten?.(); } }, TKO.pop.verwalten));
    box.append(kopfRumpf, fuss);
    box._oben = kopfRumpf; box._anzeige = anzeige;
    return box;
  }
  function oeffneMenue() {
    if (offenMenue) { offenMenue.zu(true); return; }
    const box = baueMenue();
    const p = oeffnePopover(el, box, { oben: true, rechts: true, minBreite: 380, beiZu: () => { offenMenue = null; } });
    offenMenue = {
      zu: (fokus) => p.zu(fokus),
      // Der Stand oder eine Einstellung hat sich geändert: Kopf und Rumpf ersetzen, ohne das Fenster zu schließen (der Schalter unten bleibt, sein Daumen gleitet)
      neu() {
        const fokus = box.contains(document.activeElement) ? document.activeElement.dataset?.aktion : null;
        box._oben.replaceChildren(...baueKopfUndRumpf());
        if (box._anzeige.value !== kontingentOptionen.modus()) box._anzeige.value = kontingentOptionen.modus();
        p.platz();
        if (fokus) box.querySelector(`[data-aktion="${fokus}"]:not(:disabled)`)?.focus({ preventScroll: true });
      },
    };
    box.querySelector(".kt-m-neu")?.focus({ preventScroll: true });
    stand.holen();
  }
  el.addEventListener("click", () => oeffneMenue());

  // ---- Rechtsklick auf die Statusleiste: Teile ein- und ausblenden (Kontingent je Konto, Wörter, Format), gemerkt in den App-Einstellungen
  function rechtsklick(ev) {
    ev.preventDefault();
    offenMenue?.zu();
    const w = kontingentOptionen.werte;
    const anker = { getBoundingClientRect: () => ({ left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY, width: 0, height: 0 }), contains: () => false };
    const schalte = (schluessel) => () => { schreibeAppEinstellung(stand.api, { [schluessel]: !kontingentOptionen.werte[schluessel] }); };
    rechtsMenue = oeffneKontextMenue(anker, [
      { gruppe: TKO.menue.gruppe },
      { id: "st-kontingent", name: TKO.menue.kontingent, haken: !!w.kiKontingentStatusleiste, tun: schalte("kiKontingentStatusleiste") },
      { id: "st-woerter", name: TKO.menue.woerter, haken: !!w.statusWoerter, tun: schalte("statusWoerter") },
      { id: "st-format", name: TKO.menue.format, haken: !!w.statusFormat, tun: schalte("statusFormat") },
    ], { oben: true, klasse: "kt-rechts" });
    rechtsMenue.box.dataset.kt = "statusmenue";
  }

  return { knoten: () => el, messKnoten: () => probe, aktualisiere: () => stand.holen(), zeichne, messe: planeMessung, rechtsklick, menueOffen: () => !!offenMenue, schliesse: () => offenMenue?.zu(), dichte: () => DICHTE[S.stufe] };
}
// ============================================================ Einwilligung zur Statuszeile (eine Quelle für Einstellungen und „KI verbinden“)
// Einschalten: erst der Klick auf „Kontingent anzeigen …“, dann dieser Dialog. Orte außerhalb von Kortex (System-Standard ~/.claude u. a.) brauchen zusätzlich die Bestätigung hier.
// kt: das Konto (id, name, ordner|pfad, verwaltet) · eintrag: Eintrag aus GET /api/ki/kontingent · nachher(): nach dem Schließen (z. B. Stand neu holen) · dialogFn: der Dialog (Standard: dialog aus hilfen.js)
export function kontingentEinwilligung({ api, kt, eintrag, nachher, dialogFn = dialog } = {}) {
  const verwaltet = eintrag?.verwaltet === true || kt.verwaltet === true;
  const E = TKO.einwilligung, B = TKO.bestaetigung;
  const punkte = [E.punkte.keinToken, E.punkte.nurZahlen, E.punkte.kette, E.punkte.rueckweg];
  const rumpf = [h("ul", { klasse: "kt-liste", "data-kt": "punkte" }, punkte.map((t) => h("li", { text: t })))];
  if (!verwaltet) rumpf.push(h("div", { klasse: "kk-karte warn", role: "note", "data-kt": "bestaetigung" }, h("b", { klasse: "kk-karte-titel", text: B.titel(kt.name) }), h("p", { text: B.satz(kt.ordner || kt.pfad || "") }),
    h("ul", { klasse: "kt-liste" }, [B.punkte.sicherung, B.punkte.eintrag, B.punkte.rueckweg].map((t) => h("li", { text: t })))));
  const ja = baueKnopf({ text: verwaltet ? E.ja : B.ja, variante: "primaer", aktion: "kt-einschalten", aufKlick: async () => {
    d.schliessen();
    try {
      const r = await api.kiStatuszeile({ konto: kt.id, an: true, bestaetigt: !verwaltet });
      toast(r?.aktion === "repariert" ? E.repariert(kt.name) : r?.aktion === "neu-verknuepft" ? E.neuVerknuepft(kt.name) : r?.aktion === "schon-da" ? E.schonDa(kt.name) : `${E.fertig(kt.name)}${r?.kette ? ` ${E.fertigKette}` : ""}`, { ms: 6000 });
    } catch (err) { toast(err?.status === 0 ? TKO.fehlerSchalten : (err?.message || TKO.fehlerSchalten), { fehler: true, ms: 9000 }); }
    try { await nachher?.(); } catch (err) { console.error(err); }
  } });
  const d = dialogFn({ titel: E.titel(kt.name), satz: E.satz, rumpf, knoepfe: [baueKnopf({ text: E.abbrechen, aufKlick: () => d.schliessen() }), ja] });
  d.box.dataset.dialog = "kt-einwilligung";
  return d;
}
