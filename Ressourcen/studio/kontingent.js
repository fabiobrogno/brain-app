// Anzeige des Kontingents der KI-Konten (Paket P7) — ein eigenständiger Baustein ohne Abhängigkeit von der Seite, in die er eingesetzt wird:
//   · reine Funktionen: balkenKlasse (Farbstufen), fensterAnsicht / kontoAnsicht (was steht da: Prozent, „voll“, Rücksetzzeit, Zustand, nächster Schritt)
//   · Bausteine: kontingentBlock (Einstellungen: beide Balken mit Prozent und Rücksetzzeit je Konto), kontingentKompakt (Frag-Feld), miniBalken (Statusleiste), optionSub (Auswahl im Frag-Feld)
//   · kontingentStand(api): der gemeinsame Stand aus GET /api/ki/kontingent (Abfrage alle 60 s solange das Fenster sichtbar ist, alle 3 s solange Codex noch gefragt wird)
//   · erzeugeKontoLeiste(z): der Abschnitt der Statusleiste — aktives Konto mit Mini-Balken — und das Konto-Menü (Konto wechseln, Konten und Rechte öffnen). Die Statusleiste (app.js,
//     später die neue aus dem Hauptfenster) setzt nur `leiste.knoten()` ein; der Knoten bleibt derselbe Knoten und zeichnet sich selbst neu.
// Kortex liest dafür keine Anmeldedaten: Claude Code meldet sein Kontingent an die Statuszeile, Codex antwortet dem Programm selbst (Werkstatt: werkstatt/kontingent.mjs).
// Muster: Orca R/components/status-bar/InlineProviderUsage.tsx, ProviderDetailsMenu.tsx, ClaudeSwitcherMenu.tsx und provider-extra-usage-section.tsx (barColor) @9bccd67 (MIT, Lovecast Inc.):
// je Anbieter ein Abschnitt mit Balken, „NN %“ und Rücksetzzeit; Klick öffnet ein Menü mit Konto-Wechsel; Balken grau unter 60 %, gelb 60–79 %, rot ab 80 %.
import { h, leseLokal, speichereLokal } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { oeffnePopover } from "./popover.js";
import { TKO } from "./texte-kontingent.js";

// ============================================================ reine Funktionen
export const balkenKlasse = (p) => (p >= 80 ? "rot" : p >= 60 ? "gelb" : "grau"); // Orca barColor: wörtlich
const ZAHL = (x) => typeof x === "number" && Number.isFinite(x);

// Ein Fenster (session | weekly) → was angezeigt wird. `jetzt` in ms (Uhr der Werkstatt, damit Tests und Anzeige übereinstimmen).
export function fensterAnsicht(w, art, jetzt) {
  if (!w || !ZAHL(w.usedPercent)) return { vorhanden: false };
  const p = Math.min(100, Math.max(0, w.usedPercent));
  if (ZAHL(w.resetsAt) && w.resetsAt <= jetzt) return { vorhanden: true, abgelaufen: true, prozent: 0, stufe: "grau", prozentText: TKO.zurueckgesetzt, resetText: null, voll: false };
  const voll = p >= 100;
  const rest = ZAHL(w.resetsAt) ? (art === "session" ? TKO.restDauer(w.resetsAt - jetzt) : TKO.bisZeit(w.resetsAt, jetzt)) : null;
  return {
    vorhanden: true, abgelaufen: false, prozent: p, stufe: balkenKlasse(p), voll,
    prozentText: voll ? TKO.voll : TKO.prozent(p),
    resetText: voll && ZAHL(w.resetsAt) ? TKO.wiederAb(w.resetsAt, jetzt) : rest,
    resetsAt: ZAHL(w.resetsAt) ? w.resetsAt : null,
  };
}

const minutenSeit = (iso, jetzt) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.floor((jetzt - t) / 60000)) : null; };

// Ein Konto (Eintrag aus /api/ki/kontingent) → { hatWerte, session, weekly, voll, wiederAb, kurz, text, knopf, art, warnung }
//   hatWerte: mindestens ein Fenster mit Zahl · voll: ein Fenster ist bei 100 % (wiederAb = frühester Zeitpunkt, an dem das Konto wieder kann: das späteste Ende der vollen Fenster)
//   kurz: ein Wort für Statusleiste/Zeile · text: Erklärung MIT dem nächsten Schritt · knopf: Beschriftung der möglichen Aktion (nur Claude: „Kontingent anzeigen …“)
export function kontoAnsicht(e, jetzt) {
  if (!e) return { hatWerte: false, session: { vorhanden: false }, weekly: { vorhanden: false }, voll: false, wiederAb: null, warnung: null, knopf: null, kurz: TKO.status["nicht-abrufbar"].kurz, text: TKO.status["nicht-abrufbar"].text, art: "nicht-abrufbar" };
  const session = fensterAnsicht(e.session, "session", jetzt), weekly = fensterAnsicht(e.weekly, "weekly", jetzt);
  const hatWerte = session.vorhanden || weekly.vorhanden;
  const vollFenster = [session, weekly].filter((f) => f.voll);
  const voll = vollFenster.length > 0;
  const wiederAb = voll ? Math.max(...vollFenster.map((f) => f.resetsAt || 0)) || null : null;
  const aus = { hatWerte, session, weekly, voll, wiederAb, art: e.status, codex: e.quelle === "codex", warnung: null, knopf: null };
  const alt = e.aktualisiert ? TKO.vor(minutenSeit(e.aktualisiert, jetzt) ?? 0) : null;
  switch (e.status) {
    case "ok": return { ...aus, kurz: "", text: "" };
    case "veraltet": return { ...aus, kurz: TKO.vor(minutenSeit(e.aktualisiert, jetzt) ?? 0), text: TKO.veraltet(alt, aus.codex), warnung: "veraltet" };
    case "fehler-mit-wert": return { ...aus, kurz: TKO.fehlerKurz[e.fehlerArt] || TKO.fehlerKurz.sonst, text: TKO.fehler[e.fehlerArt] || TKO.fehler.sonst, warnung: "fehler" };
    case "fehler": return { ...aus, hatWerte: false, kurz: TKO.fehlerKurz[e.fehlerArt] || TKO.fehlerKurz.sonst, text: TKO.fehler[e.fehlerArt] || TKO.fehler.sonst, warnung: "fehler" };
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
  fuell.style.width = `${Math.max(0, Math.min(100, f.prozent))}%`;
  return h("span", { klasse: "kt-balken", "data-stufe": f.stufe, "data-voll": f.voll ? "ja" : null, "aria-hidden": "true" }, fuell);
};
function zeile(art, f) {
  return h("div", { klasse: "kt-zeile", "data-fenster": art, "data-stufe": f.stufe, "data-abgelaufen": f.abgelaufen ? "ja" : null, role: "group", "aria-label": `${TKO.fensterLang[art]}: ${f.prozentText}${f.resetText ? `, ${f.resetText}` : ""}` },
    h("span", { klasse: "kt-name", text: TKO.fenster[art] }), balken(f), h("span", { klasse: "kt-prozent", text: f.prozentText }),
    f.resetText ? h("span", { klasse: "kt-rest", text: f.resetText }) : null);
}

// Die beiden Balken eines Kontos (Einstellungen, Menü). Ohne Werte: der Zustand in einem Satz (mit dem nächsten Schritt) und, wenn es eine gibt, die Aktion.
// o: { jetzt, aktion: { text, tun } | null, klein: bool }
export function kontingentBlock(e, { jetzt = Date.now(), aktion = null, klein = false } = {}) {
  const k = kontoAnsicht(e, jetzt);
  const box = h("div", { klasse: `kt-block${klein ? " kt-klein" : ""}`, "data-kt": "block", "data-status": e?.status || "unbekannt", "data-voll": k.voll ? "ja" : null });
  if (k.hatWerte) {
    box.append(h("div", { klasse: "kt-zeilen" }, k.session.vorhanden ? zeile("session", k.session) : null, k.weekly.vorhanden ? zeile("weekly", k.weekly) : null));
    if (k.warnung) box.append(h("p", { klasse: `kt-hinweis kt-w-${k.warnung}`, "data-kt": "hinweis", role: "status" }, symbol("warnung", GROESSE.klein), h("span", { text: k.text })));
  } else {
    // „nicht abrufbar“ sagt schon alles in einem Satz; sonst steht der Zustand fett vorn, dann folgt der nächste Schritt
    const inhalt = e?.status === "nicht-abrufbar" ? [k.text] : [h("b", { text: `${k.kurz}.` }), " ", k.text];
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
  async function holen(neu = false) {
    if (S.holt) return S.holt;
    S.holt = (async () => {
      try {
        const d = await api.kiKontingent(neu);
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
    S.timer = setTimeout(() => { if (typeof document !== "undefined" && document.visibilityState === "hidden") { planen(); return; } holen(); }, brauchtSchnell() ? laedtMs : abfrageMs);
  }
  const sichtbar = () => { if (S.laeuft && document.visibilityState === "visible") holen(); };
  return {
    state: S, jetzt, holen, neuLaden: async () => { if (S.holt) await S.holt; return holen(true); }, // läuft gerade eine Abfrage, kommt die frühere danach (sonst ginge der Klick verloren)
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

// ============================================================ Statusleiste und Konto-Menü
export const FRAGE_KONTO_EREIGNIS = "kortex-frage-konto";
const frageSchluessel = (vault) => `frage.konto@${vault || ""}`;

// z: { stand (kontingentStand), vaultPfad(): string|null, vaultName(): string, oeffneKonten(): void, oeffneKi(): void }
// Alles kommt aus GET /api/ki/kontingent (Konten, Stufe im offenen Vault, Werte): die Leiste fragt nichts anderes ab und gleicht nichts ab.
export function erzeugeKontoLeiste(z) {
  const stand = z.stand;
  const el = h("button", { type: "button", klasse: "st kt-leiste", "data-st": "kontingent", "aria-haspopup": "menu", "aria-expanded": "false", hidden: true });
  let offenMenue = null, letzterVault = undefined;

  const konten = () => stand.state.daten?.konten || [];
  const vault = () => z.vaultPfad?.() || null;
  const darfFrag = (k) => k.programm === "claude" && (k.stufe || "gesperrt") !== "gesperrt";
  function aktivesKonto() {
    const frei = konten().filter(darfFrag);
    const gemerkt = leseLokal(frageSchluessel(vault()), null);
    return frei.find((k) => k.id === gemerkt) || frei[0] || null;
  }
  function waehle(k) {
    speichereLokal(frageSchluessel(vault()), k.id);
    window.dispatchEvent(new CustomEvent(FRAGE_KONTO_EREIGNIS, { detail: { vault: vault(), id: k.id } }));
    zeichne();
  }

  // ---- Statusleistenknopf
  function zeichne() {
    if (vault() !== letzterVault) { const erster = letzterVault === undefined; letzterVault = vault(); if (!erster) stand.holen(); } // anderer Vault: die Stufen gelten neu
    const jetzt = stand.jetzt();
    if (!stand.state.daten && !stand.state.fehler) { el.hidden = true; return; }
    el.hidden = false;
    if (!stand.state.daten) { // die Werkstatt hat noch nie geantwortet: ehrlich „nicht abrufbar“, ein Klick zeigt den nächsten Schritt
      el.dataset.zustand = "fehler"; el.removeAttribute("data-konto");
      el.title = TKO.leiste.ladeFehler; el.setAttribute("aria-label", `${TKO.status["nicht-abrufbar"].kurz}. ${TKO.leiste.ladeFehler}`);
      el.replaceChildren(symbol("warnung", GROESSE.text), h("span", { klasse: "kt-name-text", text: TKO.status["nicht-abrufbar"].kurz }));
      return;
    }
    const k = aktivesKonto();
    if (!k) {
      el.dataset.zustand = "leer"; el.removeAttribute("data-konto");
      el.title = TKO.leiste.keinKontoTitel; el.setAttribute("aria-label", TKO.leiste.keinKonto);
      el.replaceChildren(symbol("stecker", GROESSE.text), h("span", { klasse: "kt-name-text", text: TKO.leiste.keinKonto }));
      return;
    }
    const e = stand.eintrag(k.id);
    const ans = kontoAnsicht(e, jetzt);
    el.dataset.zustand = ans.hatWerte ? (ans.voll ? "voll" : "werte") : "ohne";
    el.dataset.konto = k.id;
    const werteText = ans.hatWerte ? [ans.session.vorhanden ? `${TKO.fenster.session} ${ans.session.prozentText}${ans.session.resetText ? `, ${ans.session.resetText}` : ""}` : null, ans.weekly.vorhanden ? `${TKO.fenster.weekly} ${ans.weekly.prozentText}${ans.weekly.resetText ? `, ${ans.weekly.resetText}` : ""}` : null].filter(Boolean).join(" · ") : ans.kurz;
    el.title = `${TKO.leiste.knopfTitel(k.name)} — ${werteText}`;
    el.setAttribute("aria-label", `${TKO.leiste.knopfTitel(k.name)}${ans.hatWerte ? `. ${ans.session.vorhanden ? `${TKO.fenster.session} ${ans.session.prozentText}` : `${TKO.fenster.weekly} ${ans.weekly.prozentText}`}` : `. ${ans.kurz}`}`);
    el.replaceChildren(kiLogo(k.programm, 14, { dekorativ: true }), h("span", { klasse: "kt-name-text", text: k.name }), miniBalken(e, jetzt));
  }
  stand.abonniere(() => { zeichne(); if (offenMenue) offenMenue.neu(); });
  window.addEventListener(FRAGE_KONTO_EREIGNIS, () => zeichne());
  window.addEventListener("kortex-konten", () => stand.holen());

  // ---- Menü
  function menueZeile(k, jetzt, aktiv) {
    const stufe = k.stufe || "gesperrt";
    const gesperrt = stufe === "gesperrt";
    const waehlbar = darfFrag(k);
    const e = stand.eintrag(k.id);
    const kopf = h("span", { klasse: "kt-m-kopf" }, kiLogo(k.programm, 16, { dekorativ: true }), h("span", { klasse: "kt-m-name", text: k.name }),
      gesperrt ? h("span", { klasse: "kt-m-marke kt-gesperrt" }, symbol("schloss", GROESSE.klein), TKO.leiste.gesperrt)
        : h("span", { klasse: "kt-m-marke", "data-stufe": stufe }, aktiv ? [symbol("haken", GROESSE.klein)] : null));
    const rumpf = h("span", { klasse: "kt-m-rumpf" }, gesperrt
      ? h("span", { klasse: "kt-leise", text: TKO.leiste.gesperrtGrund })
      : kontingentBlock(e, { jetzt, klein: true }));
    const nurInfo = !gesperrt && !waehlbar;
    const b = h("button", { type: "button", klasse: "kt-m-zeile", role: waehlbar ? "menuitemradio" : "menuitem", "aria-checked": waehlbar ? String(aktiv) : null, "aria-disabled": gesperrt ? "true" : null, tabindex: "-1",
      "data-konto": k.id, "data-programm": k.programm, "data-aktiv": aktiv ? "ja" : "nein", "data-gesperrt": gesperrt ? "ja" : "nein", "data-wahl": waehlbar ? "ja" : "nein", title: nurInfo ? TKO.leiste.nurFrag : gesperrt ? TKO.leiste.gesperrtGrund : "",
      aufClick: () => { if (!waehlbar) return; waehle(k); offenMenue?.zu(true); } }, kopf, rumpf);
    return b;
  }
  function baueMenue() {
    const jetzt = stand.jetzt();
    const box = h("div", { klasse: "kt-menue", role: "menu", "data-kt": "menue", "aria-label": TKO.leiste.menueKopf(z.vaultName?.() || "") });
    const neuAb = stand.neuAb();
    const neuKnopf = h("button", { type: "button", klasse: "kt-m-neu", "data-aktion": "kt-neu", disabled: neuAb ? true : null, tabindex: "-1",
      title: neuAb ? TKO.neuLadenSpaeter(new Date(neuAb).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })) : TKO.neuLadenTitel, "aria-label": TKO.neuLaden,
      aufClick: async () => { await stand.neuLaden(); } }, symbol("sync", GROESSE.text));
    const zeiten = (stand.state.daten?.konten || []).map((x) => x.aktualisiert).filter(Boolean).map(Date.parse).filter(Number.isFinite);
    const juengster = zeiten.length ? Math.floor((jetzt - Math.max(...zeiten)) / 60000) : null;
    box.append(h("div", { klasse: "kt-m-titel" }, h("b", { text: TKO.leiste.menueKopf(z.vaultName?.() || "") }), h("span", { klasse: "kt-m-stand", text: juengster === null ? "" : TKO.stand(Math.max(0, juengster)) }), neuKnopf));
    const liste = h("div", { klasse: "kt-m-liste", role: "group" });
    const aktiv = aktivesKonto();
    if (stand.state.fehler && !konten().length) liste.append(h("p", { klasse: "kt-leise", "data-kt": "fehler", text: TKO.leiste.ladeFehler }));
    else if (!konten().length) liste.append(h("p", { klasse: "kt-leise", text: TKO.leiste.keineKonten }));
    for (const k of konten()) liste.append(menueZeile(k, jetzt, aktiv?.id === k.id));
    box.append(liste, h("div", { klasse: "m-trenner kt-trenner", role: "separator" }),
      h("button", { type: "button", klasse: "kt-m-aktion", role: "menuitem", tabindex: "-1", "data-aktion": "kt-ki-verbinden", aufClick: () => { offenMenue?.zu(); z.oeffneKi?.(); } }, symbol("stecker", GROESSE.norm), h("span", { text: TKO.leiste.kiVerbinden })),
      h("button", { type: "button", klasse: "kt-m-aktion", role: "menuitem", tabindex: "-1", "data-aktion": "kt-konten", aufClick: () => { offenMenue?.zu(); z.oeffneKonten?.(); } }, symbol("schild", GROESSE.norm), h("span", { text: TKO.leiste.kontenRechte }), h("kbd", { text: "⌘," })),
      h("p", { klasse: "kt-m-fuss", text: TKO.fussnote }));
    return box;
  }
  function oeffneMenue() {
    if (offenMenue) { offenMenue.zu(true); return; }
    const box = baueMenue();
    const knoepfe = () => [...box.querySelectorAll("button:not(:disabled)")];
    let idx = -1;
    const markiere = (i) => { const l = knoepfe(); if (!l.length) return; idx = (i + l.length) % l.length; l.forEach((b, n) => b.setAttribute("data-fokus", String(n === idx))); l[idx].focus({ preventScroll: true }); };
    const beiTaste = (ev) => {
      if (ev.key === "ArrowDown") { markiere(idx + 1); return true; }
      if (ev.key === "ArrowUp") { markiere(idx < 0 ? -1 : idx - 1); return true; }
      if (ev.key === "Home") { markiere(0); return true; }
      if (ev.key === "End") { markiere(-1); return true; }
      return false;
    };
    const p = oeffnePopover(el, box, { oben: true, rechts: true, minBreite: 380, beiTaste, beiZu: () => { offenMenue = null; } });
    offenMenue = {
      zu: (fokus) => p.zu(fokus),
      // Stand hat sich geändert: Inhalt ersetzen, ohne das Menü zu schließen
      neu() { const n = baueMenue(); box.replaceChildren(...n.childNodes); idx = -1; p.platz(); },
    };
    // Der aktive Eintrag bekommt den Fokus
    const a = box.querySelector('.kt-m-zeile[data-aktiv="ja"]') || box.querySelector(".kt-m-zeile");
    a?.focus({ preventScroll: true });
    stand.holen();
  }
  el.addEventListener("click", () => oeffneMenue());

  return { knoten: () => el, aktualisiere: () => stand.holen(), zeichne, menueOffen: () => !!offenMenue, schliesse: () => offenMenue?.zu() };
}
