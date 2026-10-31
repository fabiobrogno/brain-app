// Bereich „KI & Konten“ der Seite „Einstellungen“ (Paket P6). Hier zieht die frühere Ansicht „KI-Konten“ (ki-konten.js) hin: Programme und Konten, Zugriffs-Matrix, Schutz-Ampel,
// Frag-Standard, Pflege je Vault, die früheren Schalter des Assistenten (Hooks, Prüfung vor dem Speichern, Hintergrunddienst) und das Aktivitätsprotokoll. Die Routen der Werkstatt
// (werkstatt/konten.mjs, verdrahtung.mjs) tun die Arbeit, die App (Swift) erkennt die Programme über den PATH der Login-Shell und öffnet das Terminal zum Anmelden;
// hier steht nur, was der Nutzer sieht und entscheidet. Kortex liest nie Anmeldedaten und keinen Schlüsselbund: es fragt das Programm selbst, ob man angemeldet ist.
// Geschrieben wird nur nach einem Klick; ein Sperren fragt vorher nach und sagt ehrlich, was es schützt und was nicht. Kein innerHTML mit fremden Daten: alles über h().
// Aufbau und Verhalten nach Orca (AgentDetectionCatalog.tsx, claude-login-session.ts, claude-profile-paths.ts, usage-error-copy.ts @9bccd67, MIT, Lovecast Inc.):
// Programmkarte mit Pfad und Version, Konto = eigener Konfigurationsordner, Anmelden im Programm selbst, Fehlertexte mit dem nächsten Schritt.
import { h, dialog, toast, vorMinuten, leseLokal, speichereLokal } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { knopf as baueKnopf, segment, umschalter, auswahl, textfeld, hakenFeld, kiAuswahl, leerBlock, skelett, einstellMarke } from "./bausteine.js";
import { oeffneMenue } from "./menue.js";
import { kiLogo, kiLogoId, kiLogoName, kiKatalog } from "./ki-logos.js";
import { TK } from "./texte-konten.js";
import { TKE as T } from "./texte-ki-einstellungen.js";
import { kontingentStand, kontingentBlock, kontoAnsicht } from "./kontingent.js";
import { TKO } from "./texte-kontingent.js";
import { popoverOffen } from "./popover.js";

export const STUFEN = ["gesperrt", "lesen", "posteingang", "erweitert"];
const NEUE = ["gesperrt", "lesen", "posteingang"];
const ANMELDBAR = ["claude", "codex"];
export const ANMELDE_MS = 10 * 60_000; // Orca: Claude-Anmeldung läuft nach 10 Minuten ab
const TAKT_MS = 3000;

const stufeName = (s) => TK.stufen[s]?.name || s;
const gleich = (a, b) => String(a || "").normalize("NFC").toLowerCase() === String(b || "").normalize("NFC").toLowerCase();
const initiale = (n) => (String(n || "?").trim()[0] || "?").toUpperCase();
const slug = (n) => String(n).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "konto"; // wie werkstatt/konten.mjs#ordnerKennzeichen
const programmName = (id) => kiLogoName(id) || id;
const vaultFarbe = (v) => (/^#[0-9a-fA-F]{6}$/.test(v?.farbe || "") ? v.farbe : null);
const fehlerSatz = (e) => (e?.status === 0 ? TK.fehlerAllgemein : e?.message || TK.fehlerAllgemein);
const marke = (art) => h("span", { klasse: "kk-marke", "data-marke": art, "aria-hidden": "true" }, art === "gruen" ? symbol("haken", 12) : art === "rot" ? symbol("schliessen", 12) : art === "warn" ? symbol("warnung", 12) : null);

// Logo in einer Kachel (Programmkarte, Matrix); ohne Katalog-Eintrag ein neutrales Symbol
function logoKachel(id, groesse = 36) {
  const inner = kiLogoId(id) ? kiLogo(id, Math.round(groesse * 0.5), { dekorativ: true }) : symbol("person", Math.round(groesse * 0.5));
  const el = h("span", { klasse: "kx-logo", "aria-hidden": "true" }, inner);
  el.style.setProperty("--kx-g", `${groesse}px`);
  return el;
}
const vaultKachel = (v) => {
  const el = h("span", { klasse: "kx-vk", "aria-hidden": "true", text: initiale(v?.name) });
  const f = vaultFarbe(v);
  if (f) el.style.background = f;
  return el;
};

// ======================================================================================================================================
// o: { api, k (Kontext der Seite: inApp, kurzPfad, info(), oeffneRemote …), vault(): offener Vault der Seite | null, oeffneKi() }
export function erzeugeKi(o) {
  const { api, k: kontext } = o;
  const S = {
    konten: null, kontenRoh: null, kontenFehler: null, programme: null, programmeFehler: null, suchtProgramme: false, anm: new Map(), pflege: {}, pflegeFehler: {}, pflegeEntwurf: {},
    kern: null, kernFehler: null, kernBusy: null, kernFehlerText: {}, kernFrageErsetzen: false, profilWahl: null,
    frage: null, frageFehler: null, verbindenOffen: false, verbindenWahl: [], umbenenne: null, namensFehler: null, beschaeftigt: false, meldung: null, warnung: null, tot: false,
    aktivFilter: "alle", wartend: new Set(), uberwacht: new Set(),
  };
  const ktStand = kontingentStand(api); // Kontingent je Konto (P7, kontingent.js): derselbe Stand wie in der Statusleiste
  const hosts = new Map();      // Name → Element
  const zeichner = {};          // Name → () => void
  const offeneDialoge = new Set();
  const zu = () => S.tot;

  // ---------------------------------------------------------------- Hilfen
  const konten = () => S.konten?.konten || [];
  const vaults = () => S.konten?.vaults || [];
  const kontoMit = (id) => konten().find((x) => x.id === id) || null;
  const stufeVon = (kt, v) => S.konten?.zugriff?.[kt.id]?.[v.pfad] || "gesperrt";
  const offenerVault = () => o.vault?.() || null;
  const offenerVaultPfad = () => { const v = offenerVault(); return v?.pfad || v?.wurzel || kontext.info?.()?.vault || null; };
  const kurz = (p) => kontext.kurzPfad?.(p) ?? p;
  const sperrenVon = (kt) => vaults().filter((v) => stufeVon(kt, v) === "gesperrt");

  function host(name) {
    let el = hosts.get(name);
    if (!el) { el = h("div", { klasse: `kx-host kxh-${name}`, "data-kx-host": name }); hosts.set(name, el); }
    queueMicrotask(() => { if (!zu()) zeichne(name); });
    return el;
  }
  function zeichne(name) {
    const f = zeichner[name], el = hosts.get(name);
    if (!f || !el) return;
    try { f(el); } catch (e) { console.error("einstellungen-ki", name, e); el.replaceChildren(h("div", { klasse: "kx-fehler" }, T.ladeFehler)); }
  }
  const zeichneAlle = () => { for (const n of Object.keys(zeichner)) zeichne(n); };
  // Zeichnet neu und lässt den Fokus dort, wo er war (data-fokus-id)
  const behalteFokus = (fn) => {
    const a = document.activeElement;
    const id = a?.closest?.("[data-kx-fokus]")?.getAttribute("data-kx-fokus") || a?.getAttribute?.("data-kx-fokus") || null;
    fn();
    if (id) requestAnimationFrame(() => { const n = document.querySelector(`[data-kx-fokus="${CSS.escape(id)}"]`); const ziel = n?.matches("button,[tabindex]") ? n : n?.querySelector("button:not(:disabled)"); if (ziel && document.activeElement === document.body) ziel.focus({ preventScroll: true }); });
  };
  const eigenerDialog = (cfg) => { const d = dialog({ ...cfg, beiSchliessen: () => { offeneDialoge.delete(d); cfg.beiSchliessen?.(); } }); offeneDialoge.add(d); return d; };

  // Antwort der Werkstatt übernehmen (Stand der Konten steckt in der Antwort oder in .stand)
  function uebernimm(antwort) {
    if (!antwort) return null;
    const { claude, warnungen, ...rest } = antwort;
    if (Array.isArray(warnungen) && warnungen.length) S.warnung = warnungen.join(" ");
    const stand = rest.stand && rest.stand.konten ? rest.stand : rest;
    if (stand.konten) { S.konten = stand; S.kontenRoh = JSON.stringify(stand); }
    return claude || null;
  }
  // Eine Änderung ausführen; währenddessen sind die Knöpfe gesperrt. fn() → Antwort der Werkstatt.
  async function tue(fn, { erfolg } = {}) {
    if (S.beschaeftigt) return null;
    S.beschaeftigt = true; S.meldung = null; S.warnung = null; zeichne("uebersicht");
    try {
      const antwort = await fn();
      if (zu()) return null;
      const claude = uebernimm(antwort);
      if (claude?.aktion === "fehler") S.meldung = TK.sperre.fehlerSatz(claude.fehler || "");
      else if (erfolg) { const t = erfolg(claude, antwort); if (t) toast(t); }
      return antwort;
    } catch (e) {
      if (!zu()) { S.meldung = fehlerSatz(e); toast(S.meldung, { fehler: true, ms: 6000 }); }
      return null;
    } finally { S.beschaeftigt = false; if (!zu()) behalteFokus(zeichneAlle); }
  }

  // ---------------------------------------------------------------- Laden
  async function ladeKonten() {
    S.kontenFehler = null;
    let neu = null;
    try { neu = await api.kiKonten(); }
    catch (e) { if (zu()) return; S.kontenFehler = e; }
    if (zu()) return;
    // Unverändert (z. B. ein Ereignis der Werkstatt ohne neue Werte): nichts neu zeichnen, ein offenes Menü bleibt offen
    const roh = neu ? JSON.stringify(neu) : null;
    if (neu && S.kontenRoh === roh && !S.kontenFehler) return;
    if (neu) { S.konten = neu; S.kontenRoh = roh; }
    behalteFokus(zeichneAlle);
    if (S.konten) { pruefeAnmeldungen(); ladePflege(); }
  }
  async function ladeProgramme(neu = false) {
    S.suchtProgramme = true; S.programmeFehler = null; zeichne("konten"); zeichne("uebersicht");
    try { S.programme = await api.kiProgramme(neu); }
    catch (e) { if (zu()) return; S.programmeFehler = e; }
    S.suchtProgramme = false;
    if (zu()) return;
    auswahlBaustein?.setzeErkennung(erkennungsKarte());
    zeichne("konten"); zeichne("uebersicht"); zeichneArbeit();
  }
  async function ladeKern() {
    S.kernFehler = null;
    try { S.kern = await api.kernStand(); if (!S.profilWahl) S.profilWahl = null; }
    catch (e) { if (zu()) return; S.kernFehler = e; }
    if (zu()) return;
    zeichneArbeit();
  }
  async function ladeFrage() {
    S.frageFehler = null;
    try { S.frage = await api.frageBereit(); }
    catch (e) { if (zu()) return; S.frage = null; S.frageFehler = e; }
    if (zu()) return;
    zeichne("frage-konto"); zeichne("frage-modell");
  }
  async function ladePflege() {
    await Promise.all(vaults().map(async (v) => {
      try { S.pflege[v.pfad] = await api.kiPflege(v.pfad); delete S.pflegeFehler[v.pfad]; }
      catch (e) { S.pflegeFehler[v.pfad] = e; }
    }));
    if (zu()) return;
    zeichne("pflege"); zeichne("aktivitaet");
  }
  // Anmeldestand je Claude-/Codex-Konto: das Programm selbst fragen (App), das Ergebnis der Werkstatt melden (sie merkt sich, ob das Konto früher angemeldet war)
  async function pruefeKonto(kt) {
    if (!ANMELDBAR.includes(kt.programm) || kt.vorhanden === false) return;
    S.anm.set(kt.id, { zustand: "prueft" });
    try {
      const st = await api.kiAnmeldestatus(kt.programm, kt.standard ? null : kt.pfad);
      const z = st?.zustand === "angemeldet" || st?.zustand === "nicht-angemeldet" ? st.zustand : "unbekannt";
      const r = await api.kiAnmeldung(kt.id, z);
      S.anm.set(kt.id, { zustand: r.zustand, zuletzt: r.zuletzt || null });
    } catch { S.anm.set(kt.id, { zustand: "unbekannt" }); }
    return S.anm.get(kt.id);
  }
  async function pruefeAnmeldungen() {
    const liste = konten().filter((x) => ANMELDBAR.includes(x.programm) && x.vorhanden !== false);
    for (const x of liste) S.anm.set(x.id, { zustand: "prueft" });
    zeichne("konten"); zeichne("uebersicht");
    await Promise.all(liste.map(async (x) => { await pruefeKonto(x); if (!zu()) { zeichne("konten"); zeichne("uebersicht"); } }));
  }
  const anmZustand = (kt) => (ANMELDBAR.includes(kt.programm) ? S.anm.get(kt.id)?.zustand || (kt.vorhanden === false ? "unbekannt" : "prueft") : null);

  // ================================================================== Übersicht (Meldungen und Kacheln)
  zeichner.uebersicht = (el) => {
    const teile = [];
    if (S.warnung) teile.push(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "warnung-text" }, marke("warn"), h("p", { text: S.warnung })));
    if (S.meldung) teile.push(h("div", { klasse: "kk-karte fehler", role: "alert", "data-kk": "meldung-text" }, marke("rot"), h("p", { text: S.meldung })));
    if (S.kontenFehler) {
      teile.push(h("div", { klasse: "kk-karte fehler", role: "alert", "data-kx": "konten-fehler" }, marke("rot"), h("p", { text: S.kontenFehler?.message || T.ladeFehler }),
        baueKnopf({ text: T.nochmal, groesse: "s", aktion: "konten-nochmal", aufKlick: () => ladeKonten() })));
    }
    if (S.konten && S.konten.hinweis === "defekt-neu") {
      const knoepfe = [baueKnopf({ text: TK.defekt.verstanden, groesse: "s", aktion: "konten-hinweis-verstanden", aufKlick: () => tue(() => api.kiHinweis()) })];
      if (S.konten.vorherDa) knoepfe.push(baueKnopf({ text: TK.defekt.vorher, groesse: "s", aktion: "konten-vorher", aufKlick: vorherDialog }));
      teile.push(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "defekt" },
        h("div", { klasse: "kk-karte-kopf" }, marke("warn"), h("div", { klasse: "kk-karte-titel", text: TK.defekt.titel })),
        h("p", { text: S.konten.hinweisGrund === "geloescht" ? TK.defekt.textGeloescht : TK.defekt.text }), h("div", { klasse: "kk-knoepfe" }, knoepfe)));
    }
    const kacheln = h("div", { klasse: "kx-kacheln", "data-kx": "kacheln" });
    const kachel = (z, warn = false, kennung) => h("div", { klasse: `kx-kachel${warn ? " warn" : ""}`, "data-kachel": kennung }, h("b", { text: z.zahl }), h("span", { text: z.text }));
    if (!S.konten) kacheln.append(...[0, 1, 2, 3].map(() => skelett("ez-skelett", 62)));
    else {
      const pruefbar = konten().filter((x) => ANMELDBAR.includes(x.programm) && x.vorhanden !== false);
      const zust = pruefbar.map((x) => anmZustand(x));
      const ok = zust.filter((z) => z === "angemeldet").length;
      const braucht = zust.filter((z) => z === "abgelaufen" || z === "nicht-angemeldet").length;
      o.beiBraucht?.(braucht);
      const sperren = konten().reduce((n, x) => n + sperrenVon(x).length, 0);
      const progs = (S.programme?.programme || []).length;
      kacheln.append(kachel(T.kacheln.angemeldet(ok, pruefbar.length), false, "angemeldet"), kachel(T.kacheln.anmeldungNoetig(braucht), braucht > 0, "anmeldung"),
        kachel(S.programme ? T.kacheln.programme(progs) : { zahl: T.kacheln.sucht, text: "Programme" }, false, "programme"), kachel(T.kacheln.sperren(sperren), false, "sperren"));
    }
    el.replaceChildren(...teile, kacheln);
  };

  // ================================================================== Programme und Konten
  let verbKnopf = null, panel = null;
  const kopfKnoepfe = () => {
    const suchen = baueKnopf({ text: T.programme.neuSuchen, symbol: "sync", variante: "leise", groesse: "s", titel: T.programme.neuSuchenTitel, daten: { "data-aktion": "neu-suchen" }, aufKlick: () => neuSuchen() });
    const verb = baueKnopf({ text: T.programme.verbinden, symbol: "plus", groesse: "s", daten: { "data-aktion": "ki-verbinden-auf", "aria-expanded": "false" }, aufKlick: () => verbindenUmschalten() });
    verbKnopf = verb;
    return h("span", { klasse: "kx-kopf-knoepfe" }, suchen, verb);
  };
  async function neuSuchen() {
    await Promise.all([ladeProgramme(true), ladeKern(), ladeKonten(), ladeFrage()]);
  }

  // ---- KI verbinden (kiAuswahl)
  let auswahlBaustein = null;
  function verbindenUmschalten(an = !S.verbindenOffen) {
    S.verbindenOffen = an;
    if (!an) panel = null;
    verbKnopf?.setAttribute("aria-expanded", String(an));
    zeichne("konten");
    if (an) requestAnimationFrame(() => hosts.get("konten")?.querySelector("[data-kx=verbinden]")?.scrollIntoView({ block: "nearest" }));
  }
  function erkennungsKarte() {
    if (!S.programme) return null;
    return Object.fromEntries(S.programme.programme.map((p) => [p.id, { gefunden: true, version: p.version }]));
  }
  function verbindenPanel() {
    if (panel) return panel;
    const knopfOk = baueKnopf({ text: T.programme.verbindenKnopf1, variante: "primaer", groesse: "s", disabled: true, daten: { "data-aktion": "ki-verbinden-ok" } });
    const fehler = h("div", { klasse: "kx-verb-fehler", role: "alert", hidden: true });
    auswahlBaustein = kiAuswahl({ erkennung: erkennungsKarte(), wert: S.verbindenWahl, mehrfach: true, waehlbar: (e) => e.verbindbar, label: T.programme.verbindenTitel,
      aufAenderung: (ids) => { S.verbindenWahl = ids; knopfOk.disabled = !ids.length; knopfOk.querySelector(".bs-knopf-text").textContent = ids.length > 1 ? T.programme.verbindenKnopfN(ids.length) : T.programme.verbindenKnopf1; } });
    knopfOk.disabled = !S.verbindenWahl.length;
    const abbruch = baueKnopf({ text: T.programme.abbrechen, variante: "leise", groesse: "s", aufKlick: () => verbindenUmschalten(false) });
    knopfOk.addEventListener("click", async () => {
      const ids = [...S.verbindenWahl];
      if (!ids.length) return;
      auswahlBaustein.sperre(true); fehler.hidden = true; fehler.replaceChildren();
      let ok = 0; const probleme = [];
      for (const id of ids) {
        try { await api.mcpVerbinden({ ziel: id }); ok++; }
        catch (e) { probleme.push({ id, e }); }
      }
      auswahlBaustein.sperre(false);
      if (ok) { toast(T.programme.verbindenOk(ok)); if (ids.includes("claude") && !probleme.some((x) => x.id === "claude")) kontext.beiVerbunden?.(); }
      if (probleme.length) {
        fehler.hidden = false;
        fehler.replaceChildren(...probleme.map(({ id, e }) => h("div", {}, h("p", { text: T.programme.verbindenFehler(programmName(id), e?.message || TK.fehlerAllgemein) }),
          e?.daten?.befehl ? h("div", { klasse: "kx-befehl-zeile" }, h("span", { text: T.programme.verbindenBefehl }), h("code", { klasse: "mono", text: e.daten.befehl })) : null)));
      } else { S.verbindenWahl = []; verbindenUmschalten(false); }
      await Promise.all([ladeKonten(), ladeProgramme(false)]);
    });
    panel = h("div", { klasse: "kx-verbinden ez-karte", "data-kx": "verbinden" },
      h("div", { klasse: "kx-verb-kopf" }, h("div", {}, h("b", { text: T.programme.verbindenTitel }), h("span", { text: T.programme.verbindenText })),
        baueKnopf({ symbol: "schliessen", variante: "leise", groesse: "s", label: T.programme.verbindenZu, aufKlick: () => verbindenUmschalten(false) })),
      h("div", { klasse: "kx-verb-koerper" }, auswahlBaustein.el, fehler), h("div", { klasse: "kx-verb-fuss" }, abbruch, knopfOk));
    return panel;
  }

  // ---- Kontingent je Konto (P7): zwei Balken mit Prozent und Rücksetzzeit; ohne Werte der Zustand mit dem nächsten Schritt
  const textKnopf = (text, id, kt, aufKlick, extra = {}) => h("button", { klasse: "knopf-text", type: "button", "data-aktion": id, "data-konto": kt.id, text, aufClick: aufKlick, ...extra });
  function kontingentSpalte(kt) {
    const e = ktStand.eintrag(kt.id);
    if (!e) return null;
    const aktionen = h("div", { klasse: "kt-aktionen" });
    if (e.programm === "claude") {
      if (["nicht-eingerichtet", "geaendert", "neu-verknuepfen", "reparieren"].includes(e.status)) aktionen.append(baueKnopf({ text: TKO.status[e.status].knopf, groesse: "s", daten: { "data-aktion": "kt-anzeigen", "data-konto": kt.id }, aufKlick: () => kontingentEinschalten(kt, e) }));
      if (e.eingetragen) aktionen.append(textKnopf(TKO.ausschalten, "kt-aus", kt, () => kontingentAusschalten(kt)));
    } else if (e.programm === "codex" && e.status !== "laedt") {
      const spaeter = ktStand.neuAb();
      aktionen.append(textKnopf(TKO.neuLaden, "kt-neu", kt, () => { ktStand.neuLaden(); }, spaeter ? { disabled: true, title: TKO.neuLadenSpaeter(new Date(spaeter).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })) } : { title: TKO.neuLadenTitel }));
    }
    const werte = kontoAnsicht(e, ktStand.jetzt()).hatWerte;
    return h("div", { klasse: "kt-spalte", "data-kt-konto": kt.id, "data-layout": werte ? "werte" : "text" }, kontingentBlock(e, { jetzt: ktStand.jetzt(), aktion: aktionen.childNodes.length ? aktionen : null }));
  }
  // Einschalten: erst der Klick auf „Kontingent anzeigen …“, dann dieser Dialog. Orte außerhalb von Kortex (System-Standard ~/.claude u. a.) brauchen zusätzlich die Bestätigung hier in der Seite.
  function kontingentEinschalten(kt, e) {
    const verwaltet = e?.verwaltet === true || kt.verwaltet === true;
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
      await ktStand.holen(); if (!zu()) behalteFokus(() => zeichne("konten"));
    } });
    const d = eigenerDialog({ titel: E.titel(kt.name), satz: E.satz, rumpf, knoepfe: [baueKnopf({ text: E.abbrechen, aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "kt-einwilligung";
  }
  function kontingentAusschalten(kt) {
    const ja = baueKnopf({ text: TKO.entfernenJa, variante: "primaer", aktion: "kt-ausschalten", aufKlick: async () => {
      d.schliessen();
      try { const r = await api.kiStatuszeile({ konto: kt.id, an: false }); toast(r?.aktion === "schon-weg" ? TKO.schonWeg(kt.name) : TKO.entfernt(kt.name, r?.exakt !== false), { ms: 6000 }); }
      catch (err) { toast(err?.status === 0 ? TKO.fehlerSchalten : (err?.message || TKO.fehlerSchalten), { fehler: true, ms: 9000 }); }
      await ktStand.holen(); if (!zu()) behalteFokus(() => zeichne("konten"));
    } });
    const d = eigenerDialog({ titel: TKO.entfernenTitel(kt.name), rumpf: [h("p", { klasse: "dialog-satz", text: TKO.entfernenText })], knoepfe: [baueKnopf({ text: TKO.einwilligung.abbrechen, aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "kt-ausschalten";
  }
  // Ein neuer Stand (alle 60 s, bei Änderungen, nach dem Einschalten): nur neu zeichnen, solange kein Menü offen ist
  const beiKontingent = () => { if (!zu() && !popoverOffen()) behalteFokus(() => zeichne("konten")); };

  // ---- Konto-Zeile
  function statusMarke(kt) {
    const z = anmZustand(kt);
    if (z === null) return kt.verbunden ? einstellMarke(TK.konten.verbunden, "ok") : einstellMarke(TK.konten.nichtVerbunden);
    return { prueft: einstellMarke(T.anmeldung.prueft), angemeldet: einstellMarke(T.anmeldung.angemeldet, "ok"), abgelaufen: einstellMarke(T.anmeldung.abgelaufen, "warn"), "nicht-angemeldet": einstellMarke(T.anmeldung.nicht, "warn"), unbekannt: einstellMarke(T.anmeldung.unbekannt) }[z];
  }
  const punktKlasse = (kt) => { const z = anmZustand(kt); return z === "angemeldet" ? "" : z === "abgelaufen" || z === "nicht-angemeldet" ? "warn" : z === null ? (kt.verbunden ? "" : "aus") : "aus"; };
  const ordnerText = (kt) => (kt.verwaltet ? `Kortex · ${String(kt.pfad || "").split("/").pop()}` : kt.ordner);

  function namensFeld(kt) {
    const tf = textfeld({ klasse: "kk-eingabe", wert: kt.name, maxlaenge: 60, label: TK.konten.nameFeld, groesse: "s", daten: { "data-kk": "name-feld", "aria-invalid": S.namensFehler ? "true" : null } });
    tf.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); speichereName(kt, tf.input.value); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); S.umbenenne = null; zeichne("konten"); } });
    return h("div", { klasse: "kx-name-edit" }, tf.el,
      baueKnopf({ text: TK.konten.speichern, variante: "primaer", groesse: "s", aktion: "konto-name-speichern", aufKlick: () => speichereName(kt, tf.input.value) }),
      baueKnopf({ text: TK.konten.abbrechen, groesse: "s", aktion: "konto-name-abbrechen", aufKlick: () => { S.umbenenne = null; S.namensFehler = null; zeichne("konten"); } }),
      S.namensFehler ? h("div", { klasse: "kk-fehlertext", role: "alert", text: S.namensFehler }) : null);
  }
  async function speichereName(kt, text) {
    const name = String(text).replace(/\s+/g, " ").trim();
    if (!name) { S.namensFehler = TK.konten.nameLeer; zeichne("konten"); return; }
    if (name.length > 40) { S.namensFehler = TK.konten.nameZuLang; zeichne("konten"); return; }
    S.namensFehler = null; S.umbenenne = null;
    await tue(() => api.kiKontoName(kt.id, name), { erfolg: () => TK.konten.benannt });
  }
  function kontoMenue(ev, kt) {
    const eintraege = [];
    if (ANMELDBAR.includes(kt.programm)) eintraege.push({ name: T.anmeldung.neuAnmelden, symbol: "stift", id: "konto-neu-anmelden", tun: () => anmeldenDialog(kt) });
    if (!kt.verbunden && kt.vorhanden !== false) eintraege.push({ name: T.programme.verbindenKnopf, symbol: "stecker", id: "konto-verbinden", tun: () => verbindeKonto(kt) });
    if (eintraege.length) eintraege.push({ trenner: true });
    if (kt.verwaltet) eintraege.push({ name: T.entfernen.menue, symbol: "papierkorb", id: "konto-entfernen", gefahr: true, tun: () => entfernenDialog(kt) });
    else eintraege.push({ leer: T.entfernen.nichtMoeglich });
    oeffneMenue(ev.currentTarget, eintraege, { rechts: true });
  }
  async function verbindeKonto(kt) {
    try { await api.mcpVerbinden({ ziel: kt.programm, konto: kt.id }); toast(T.programme.verbindenOk(1)); if (kt.programm === "claude") kontext.beiVerbunden?.(); await ladeKonten(); }
    catch (e) { toast(e?.daten?.befehl ? `${T.programme.verbindenBefehl} ${e.daten.befehl}` : (e?.message || TK.fehlerAllgemein), { fehler: !e?.daten?.befehl, ms: 12000 }); }
  }

  function kontoZeile(kt) {
    const z = anmZustand(kt);
    const braucht = z === "abgelaufen" || z === "nicht-angemeldet";
    const li = h("div", { klasse: "kx-konto", "data-konto": kt.id, "data-programm": kt.programm, "data-anmeldung": z || "", "data-kx-fokus": `konto-${kt.id}` });
    const av = h("span", { klasse: "kx-av", "aria-hidden": "true" }, initiale(kt.name), h("i", { klasse: `kx-punkt ${punktKlasse(kt)}` }));
    const name = S.umbenenne === kt.id ? namensFeld(kt)
      : h("div", { klasse: "kx-n" }, h("b", {}, h("span", { "data-kk": "name", text: kt.name }), statusMarke(kt)),
        h("span", { klasse: "kx-sub", "data-kk": "meta", title: kt.pfad || kt.ordner }, h("span", { klasse: "mono", text: ordnerText(kt) }), h("span", { text: ` · ${kt.verbunden ? TK.konten.verbunden : TK.konten.nichtVerbunden}` }), kt.vorhanden === false ? h("span", { text: ` · ${TK.konten.nichtGefunden}` }) : null));
    const rechts = h("div", { klasse: "kx-akt" },
      braucht ? baueKnopf({ text: T.anmeldung.anmelden, variante: "primaer", groesse: "s", daten: { "data-aktion": "konto-anmelden", "data-konto": kt.id }, aufKlick: () => anmeldenDialog(kt) }) : null,
      S.umbenenne === kt.id ? null : h("button", { klasse: "knopf-text kx-umbenennen", type: "button", "data-aktion": "konto-umbenennen", "aria-label": TK.konten.umbenennenFuer(kt.name), disabled: S.beschaeftigt, text: TK.konten.umbenennen,
        aufClick: () => { S.umbenenne = kt.id; S.namensFehler = null; zeichne("konten"); const f = hosts.get("konten")?.querySelector('[data-kk="name-feld"]'); f?.focus(); f?.select(); } }),
      baueKnopf({ symbol: "punkte", variante: "leise", groesse: "s", label: `Mehr: ${kt.name}`, daten: { "data-aktion": "konto-mehr" }, aufKlick: (ev) => kontoMenue(ev, kt) }));
    const ktSpalte = kontingentSpalte(kt);
    li.append(h("div", { klasse: `kx-zeile${ktSpalte ? (ktSpalte.dataset.layout === "text" ? " kt-unten" : " kt-mit") : ""}` }, av, name, ktSpalte, rechts));
    // Hinweiszeilen: abgelaufene Anmeldung (mit der Folge für die Pflege), Altform ohne Kontokennung
    if (z === "abgelaufen") {
      const pv = vaults().filter((v) => v.pflege?.gesetzt && v.pflege.konto === kt.id && v.pflege.stufe !== "aus").map((v) => `„${v.name}“`);
      li.append(h("div", { klasse: "kx-hinweis warn", role: "status", "data-kx": "hinweis-abgelaufen" }, symbol("warnung", GROESSE.text),
        h("span", { text: pv.length ? T.anmeldung.abgelaufenPflege(kt.name, pv.join(", ")) : T.anmeldung.abgelaufenHinweis(kt.name) }),
        baueKnopf({ text: T.anmeldung.neuAnmelden, groesse: "s", daten: { "data-aktion": "konto-neu-anmelden" }, aufKlick: () => anmeldenDialog(kt) })));
    } else if (z === "nicht-angemeldet") {
      li.append(h("div", { klasse: "kx-hinweis", role: "status", "data-kx": "hinweis-nicht" }, symbol("info", GROESSE.text), h("span", { text: T.anmeldung.nichtHinweis(kt.name) })));
    }
    if (kt.altform && (kt.altform.mcp || kt.altform.hooks)) {
      li.append(h("div", { klasse: "kx-hinweis warn", "data-kk": "altform" }, symbol("warnung", GROESSE.text),
        h("span", {}, h("b", { text: `${TK.konten.altformTitel}. ` }), TK.konten.altformText),
        baueKnopf({ text: TK.konten.altformKnopf, groesse: "s", aktion: "konto-neu-verbinden", aufKlick: () => tue(() => api.kiNeuVerbinden(kt.id), { erfolg: () => TK.konten.altformErfolg }) })));
    }
    return li;
  }

  // ---- Programmkarten
  function programmKarte(id, fund, liste) {
    const eintrag = kiKatalog().find((e) => e.id === id);
    const art = fund?.art || eintrag?.art || "terminal";
    const kopfText = h("div", { klasse: "kx-t" },
      h("b", {}, h("span", { text: programmName(id) }), h("span", { klasse: "kx-art", text: T.programme.art[art] || art })),
      fund ? h("span", { klasse: "kx-pfad" }, h("span", { klasse: "mono", title: fund.pfad || "", text: fund.pfad ? kurz(fund.pfad) : "" }), fund.version ? h("span", { text: ` · ${T.programme.version(fund.version)}` }) : null)
        : h("span", { klasse: "kx-pfad" }, T.programme.nichtGefunden));
    const kopf = h("div", { klasse: "kx-prog-kopf" }, logoKachel(id, 36), kopfText,
      fund && ANMELDBAR.includes(id) ? baueKnopf({ text: T.programme.kontoHinzu, symbol: "plus", groesse: "s", daten: { "data-aktion": "konto-hinzu", "data-programm": id }, label: T.programme.kontoHinzuFuer(programmName(id)), aufKlick: () => kontoNeuDialog(id) }) : null);
    const karte = h("section", { klasse: "kx-prog", "data-programm": id, "data-gefunden": String(!!fund) }, kopf);
    if (liste.length) for (const kt of liste) karte.append(kontoZeile(kt));
    else if (fund) {
      karte.append(h("div", { klasse: "kx-zeile kx-leer-zeile" }, h("span", { klasse: "kx-sub", text: T.programme.ohneKonto }),
        eintrag?.verbindbar ? baueKnopf({ text: T.programme.verbindenKnopf, groesse: "s", daten: { "data-aktion": "programm-verbinden", "data-programm": id }, aufKlick: async () => { try { await api.mcpVerbinden({ ziel: id }); toast(T.programme.verbindenOk(1)); await Promise.all([ladeKonten(), ladeProgramme(false)]); } catch (e) { toast(e?.daten?.befehl ? `${T.programme.verbindenBefehl} ${e.daten.befehl}` : (e?.message || TK.fehlerAllgemein), { fehler: !e?.daten?.befehl, ms: 12000 }); } } }) : h("span", { klasse: "kx-sub", text: T.programme.nichtVerbindbar })));
    }
    if (!fund && liste.length) karte.append(h("div", { klasse: "kx-hinweis", "data-kx": "hinweis-nicht-gefunden" }, symbol("info", GROESSE.text), h("span", { text: T.programme.nichtGefundenText })));
    return karte;
  }

  zeichner.konten = (el) => {
    const teile = [];
    if (S.verbindenOffen) teile.push(verbindenPanel());
    if (S.programmeFehler && !S.programme) {
      teile.push(leerBlock({ symbol: "warnung", titel: T.programme.fehler, aktion: { text: T.programme.neuSuchen, tun: () => neuSuchen() }, daten: { "data-kx": "programme-fehler" } }));
      el.replaceChildren(...teile); return;
    }
    if ((!S.programme && S.suchtProgramme) || (!S.programme && !S.konten)) {
      teile.push(h("div", { klasse: "kx-sucht", role: "status", "data-kx": "sucht" }, h("span", { klasse: "ez-dreh", "aria-hidden": "true" }), h("span", { text: T.programme.sucht })), skelett("ez-skelett", 96));
      el.replaceChildren(...teile); return;
    }
    const funde = S.programme?.programme || [];
    const alleKonten = konten();
    const reihenfolge = new Map(kiKatalog().map((e, i) => [e.id, i]));
    const ids = [...new Set([...alleKonten.map((x) => x.programm), ...funde.filter((p) => kiKatalog().find((e) => e.id === p.id)?.verbindbar).map((p) => p.id)])].sort((a, b) => (reihenfolge.get(a) ?? 999) - (reihenfolge.get(b) ?? 999));
    if (S.programme?.nurBrowser) teile.push(h("p", { klasse: "kx-browser", "data-kx": "nur-browser", text: T.programme.nurBrowser }));
    if (!ids.length) {
      teile.push(leerBlock({ symbol: "funke", titel: T.programme.keine, text: T.programme.keineText, aktion: { text: T.programme.neuSuchen, tun: () => neuSuchen() }, daten: { "data-kx": "keine-programme" } }));
    } else {
      const karten = h("div", { klasse: "kx-progs", "data-kx": "programm-liste" });
      for (const id of ids) karten.append(programmKarte(id, funde.find((p) => p.id === id) || null, alleKonten.filter((x) => x.programm === id)));
      teile.push(karten);
    }
    // Gefunden, aber ohne Eintragsmöglichkeit; und die beliebten Programme, die es hier nicht gibt
    const stumm = funde.filter((p) => !ids.includes(p.id));
    if (stumm.length) teile.push(h("p", { klasse: "kx-weitere", "data-kx": "weitere-gefunden" }, h("b", { text: "Außerdem gefunden: " }), stumm.map((p) => p.name).join(", "), `. ${T.programme.nichtVerbindbar}`));
    if (S.programme) {
      const fehlt = kiKatalog().filter((e) => e.beliebt && e.verbindbar && !funde.some((p) => p.id === e.id));
      if (fehlt.length) {
        teile.push(h("details", { klasse: "kx-nicht-da", "data-kx": "nicht-da" }, h("summary", { text: `${T.programme.nichtDa} (${fehlt.length})` }),
          h("p", { text: T.programme.nichtDaText }),
          h("div", { klasse: "kx-nicht-da-liste" }, fehlt.map((e) => h("span", { klasse: "kx-nd", "data-ki": e.id }, logoKachel(e.id, 22), h("span", { text: e.name }),
            h("button", { type: "button", klasse: "knopf-text", "data-aktion": "ki-website", "data-ki": e.id, text: T.programme.website, "aria-label": `${T.programme.website}: ${e.name}`, aufClick: () => oeffneWebsite(e.website) }))))));
      }
    }
    el.replaceChildren(...teile);
  };
  function oeffneWebsite(url) {
    if (kontext.inApp) kontext.aktion?.("extern", url);
    else { try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* ohne Fenster */ } }
  }

  // ---- Konto hinzufügen
  function kontoNeuDialog(programm) {
    const pname = programmName(programm);
    let stufe = "gesperrt";
    const fehlerEl = h("div", { klasse: "kk-fehlertext", role: "alert", hidden: true, "data-kx": "neu-fehler" });
    const ordnerEl = h("span", { klasse: "mono", "data-kx": "neu-ordner" });
    const name = textfeld({ klasse: "kx-eingabe", wert: "", platzhalter: T.neu.namePlatzhalter, label: T.neu.name, maxlaenge: 60, daten: { "data-kx": "neu-name" } });
    const zeigeOrdner = () => { ordnerEl.textContent = `Kortex/ki-konten-ordner/${programm}-${slug(name.input.value || "konto")}`; };
    name.input.addEventListener("input", () => { zeigeOrdner(); fehlerEl.hidden = true; });
    zeigeOrdner();
    const seg = segment({ optionen: [{ wert: "gesperrt", text: TK.stufen.gesperrt.name }, { wert: "lesen", text: TK.stufen.lesen.name }], wert: stufe, label: T.neu.anfang, daten: { "data-kx": "neu-stufe" }, aufAenderung: (s) => { stufe = s; } });
    const ok = baueKnopf({ text: T.neu.anlegen, variante: "primaer", aktion: "konto-neu-ok", aufKlick: async () => {
      const n = name.input.value.replace(/\s+/g, " ").trim();
      if (!n) { fehlerEl.textContent = T.neu.leer; fehlerEl.hidden = false; name.input.focus(); return; }
      if (n.length > 40) { fehlerEl.textContent = T.neu.zuLang; fehlerEl.hidden = false; return; }
      ok.setAttribute("aria-busy", "true");
      try {
        const r = await api.kiKontoNeu({ programm, name: n, stufe });
        uebernimm(r);
        d.schliessen();
        toast(T.neu.angelegt(n));
        behalteFokus(zeichneAlle);
        const neu = kontoMit(r.neuesKonto?.id);
        if (neu) { pruefeKonto(neu).then(() => { zeichne("konten"); zeichne("uebersicht"); }); anmeldenDialog(neu); }
        ladePflege();
      } catch (e) { ok.removeAttribute("aria-busy"); fehlerEl.textContent = fehlerSatz(e); fehlerEl.hidden = false; }
    } });
    const d = eigenerDialog({ titel: T.neu.titel(pname), satz: T.neu.text, rumpf: [
      h("div", { klasse: "kx-feld" }, h("span", { klasse: "kx-label", text: T.neu.name }), name.el),
      h("div", { klasse: "kx-feld" }, h("span", { klasse: "kx-label", text: T.neu.ordner }), h("div", { klasse: "kx-ordner-anzeige" }, ordnerEl), h("p", { klasse: "mini", text: T.neu.ordnerText })),
      h("div", { klasse: "kx-feld" }, h("span", { klasse: "kx-label", text: T.neu.anfang }), seg), fehlerEl,
    ], knoepfe: [baueKnopf({ text: T.neu.abbrechen, aufKlick: () => d.schliessen() }), ok] });
    d.box.dataset.dialog = "konto-neu";
  }

  // ---- Konto entfernen
  function entfernenDialog(kt) {
    const ok = baueKnopf({ text: T.entfernen.ja, variante: "gefahr", aktion: "konto-entfernen-ja", aufKlick: async () => {
      d.schliessen();
      // Erst der Ordner in den Papierkorb (App: Swift über den Finder-Papierkorb, sonst die Werkstatt), danach das Konto aus der Liste
      await tue(async () => { await api.kiOrdnerPapierkorb(kt); return api.kiKontoEntfernen(kt.id); }, { erfolg: () => T.entfernen.erledigt(kt.name) });
      S.anm.delete(kt.id);
      zeichne("konten"); zeichne("uebersicht");
      ladePflege();
    } });
    const d = eigenerDialog({ titel: T.entfernen.titel(kt.name), rumpf: [h("p", { klasse: "dialog-satz", text: T.entfernen.text }), h("p", { klasse: "dialog-satz", text: T.entfernen.text2 })], knoepfe: [baueKnopf({ text: T.entfernen.abbrechen, aufKlick: () => d.schliessen() }), ok] });
    d.box.dataset.dialog = "konto-entfernen";
  }

  // ---- Anmelden: das Programm öffnet das Terminal, Kortex fragt nur, ob die Anmeldung da ist
  function anmeldenDialog(kt) {
    const name = `${programmName(kt.programm)} · ${kt.name}`;
    const st = { schritt: 1, fehler: null, ende: false, versuch: 0 };
    let timer = 0, frist = 0, laeuft = false;
    const schritte = [T.anmeldung.schritt1, T.anmeldung.schritt2, T.anmeldung.schritt3];
    const liste = h("ul", { klasse: "kx-schritte", "data-kx": "schritte" });
    const befehl = h("div", { klasse: "kx-terminal", "data-kx": "befehl", hidden: true });
    const fehlerEl = h("div", { klasse: "kk-karte fehler", role: "alert", hidden: true, "data-kx": "anmelde-fehler" });
    const abbruch = baueKnopf({ text: T.anmeldung.abbrechen, aktion: "anmelden-abbrechen", aufKlick: () => d.schliessen() });
    const jetzt = baueKnopf({ text: T.anmeldung.jetztPruefen, variante: "primaer", aktion: "anmelden-pruefen", aufKlick: () => pruefe(true) });
    const nochmal = baueKnopf({ text: T.anmeldung.nochmal, variante: "primaer", aktion: "anmelden-nochmal", hidden: true, aufKlick: () => starte() });
    const zeichneSchritte = () => {
      liste.replaceChildren(...schritte.map((t, i) => {
        const nr = i + 1, fertig = st.schritt > nr || st.ende, aktiv = !st.fehler && !st.ende && st.schritt === nr;
        return h("li", { klasse: `kx-schritt${fertig ? " fertig" : aktiv ? " laeuft" : ""}`, "data-s": String(nr) }, h("span", { klasse: "kx-st", "aria-hidden": "true" }, fertig ? symbol("haken", 12) : null), h("span", { text: nr === 1 && st.schritt === 1 && !st.fehler && !st.ende ? T.anmeldung.schritt1Wartet : t }));
      }));
      nochmal.hidden = !st.fehler && !st.zeit; jetzt.hidden = !!st.fehler || !!st.zeit || st.schritt < 2 || st.ende;
      fehlerEl.hidden = !st.fehler; if (st.fehler) fehlerEl.replaceChildren(marke("rot"), h("p", { text: st.fehler }));
    };
    const stoppe = () => { clearTimeout(timer); timer = 0; S.uberwacht.delete(stoppe); };
    S.uberwacht.add(stoppe);
    async function pruefe(manuell = false) {
      if (laeuft || st.ende) return;
      laeuft = true;
      if (st.schritt === 2) { st.schritt = 3; zeichneSchritte(); }
      try {
        const r = await pruefeKonto(kt);
        if (r?.zustand === "angemeldet") { st.ende = true; stoppe(); zeichneSchritte(); setTimeout(() => d.schliessen(), 700); toast(T.anmeldung.fertig(name)); zeichne("konten"); zeichne("uebersicht"); return; }
      } finally { laeuft = false; }
      if (st.ende) return;
      st.schritt = 2; zeichneSchritte();
      if (Date.now() > frist) { st.zeit = true; stoppe(); zeichneSchritte(); fehlerEl.hidden = false; fehlerEl.replaceChildren(marke("warn"), h("p", { text: T.anmeldung.zeit })); return; }
      if (!manuell || !timer) timer = setTimeout(() => { timer = 0; pruefe(); }, TAKT_MS);
    }
    async function starte() {
      stoppe(); st.fehler = null; st.zeit = false; st.schritt = 1; st.ende = false; zeichneSchritte();
      try {
        const r = await api.kiAnmelden(kt.programm, kt.standard ? null : kt.pfad);
        const zeile = r?.anzeige || r?.befehl;
        if (zeile) { befehl.hidden = false; befehl.replaceChildren(h("div", {}, h("span", { klasse: "kx-dollar", text: "$ " }), h("span", { text: zeile })), h("div", { klasse: "kx-warte", text: T.anmeldung.wartetAuf })); }
        st.schritt = 2; frist = Date.now() + ANMELDE_MS; zeichneSchritte();
        timer = setTimeout(() => { timer = 0; pruefe(); }, TAKT_MS); S.uberwacht.add(stoppe);
      } catch (e) { st.fehler = e?.message || T.anmeldung.fehlerStart; zeichneSchritte(); }
    }
    const d = eigenerDialog({ titel: T.anmeldung.dialogTitel(name), satz: T.anmeldung.dialogText, rumpf: [liste, befehl, h("p", { klasse: "mini", text: T.anmeldung.hinweisBrowser }), fehlerEl],
      knoepfe: [abbruch, nochmal, jetzt], beiSchliessen: () => stoppe() });
    d.box.dataset.dialog = "anmelden";
    zeichneSchritte();
    starte();
  }

  // ================================================================== Zugriff (Matrix)
  // Stufen-Knopf einer Zelle (eigener Knopf, nicht der quadratische Symbolknopf der Bausteine)
  const stufenKnopf = (stufe, daten, label, aufKlick) => {
    const b = h("button", { type: "button", klasse: "kx-stufe", role: "button", "aria-haspopup": "menu", "aria-label": label, disabled: S.beschaeftigt || null, ...daten, aufClick: aufKlick },
      h("span", { klasse: "kx-pkt", "data-s": stufe, "aria-hidden": "true" }), h("span", { klasse: "kx-stufe-text", text: stufeName(stufe) }), symbol("chevron-unten", 12));
    return b;
  };
  const stufeKnopf = (kt, v, stufe) => {
    const zusatz = stufe === "gesperrt" ? sperrKennzeichen(kt, v) : null;
    const b = stufenKnopf(stufe, { "data-s": stufe, "data-kk": "matrix-zelle", "data-konto": kt.id, "data-vault": v.pfad, "data-stufe": stufe }, T.zugriff.wahl(kt.name, v.name, stufeName(stufe)), (ev) => stufenMenue(ev, kt, v, stufe));
    const wrap = h("div", { klasse: "kx-zelle" }, b);
    if (zusatz) wrap.append(zusatz);
    return wrap;
  };
  // Unter einer gesperrten Zelle: was die Sperre wirklich hält (nur Kortex, Leseverbot, streng)
  function sperrKennzeichen(kt, v) {
    if (!kt.schutz?.moeglich) return h("span", { klasse: "kx-schutz", "data-kx": "sperrzustand", "data-zustand": "kortex", title: T.zugriff.nurKortexTitel, text: T.zugriff.nurKortex });
    const z = kt.schutz.vaults?.[v.schluessel || v.pfad] || kt.schutz.vaults?.[v.pfad] || "aus";
    const gut = z === "aktiv" || z === "eigene";
    if (gut && kt.schutz.strenger && kt.schutz.strengerAktiv) return h("span", { klasse: "kx-schutz ok", "data-kx": "sperrzustand", "data-zustand": "streng", title: T.zugriff.strengTitel }, symbol("schild", 12), T.zugriff.streng);
    if (gut) return h("span", { klasse: "kx-schutz ok", "data-kx": "sperrzustand", "data-zustand": z, title: T.zugriff.leseverbotTitel }, symbol("schild", 12), T.zugriff.leseverbot);
    return h("button", { type: "button", klasse: "kx-schutz warn", "data-kx": "sperrzustand", "data-zustand": z, "data-aktion": "leseverbot-eintragen", title: TK.sperre[z] || TK.sperre.aus, disabled: S.beschaeftigt || z === "defekt",
      aufClick: () => sperrDialog(kt, v, true) }, symbol("warnung", 12), T.zugriff.nurKortex);
  }
  function stufenMenue(ev, kt, v, aktuell) {
    oeffneMenue(ev.currentTarget, STUFEN.map((s) => ({ name: stufeName(s), sub: T.zugriff.legende[s], haken: s === aktuell, id: `stufe-${s}`, tun: () => waehleStufe(kt, v, s) })), { breite: 250 });
  }
  async function waehleStufe(kt, v, stufe) {
    if (stufe === stufeVon(kt, v) || S.beschaeftigt) return;
    if (stufe === "gesperrt") { sperrDialog(kt, v); return; }
    if (stufeVon(kt, v) === "gesperrt") { entsperrDialog(kt, v, stufe); return; } // aus einer Sperre heraus: erst kurz nachfragen
    await setzeStufe(kt, v, stufe);
  }
  const setzeStufe = (kt, v, stufe) => tue(() => api.kiZugriff({ konto: kt.id, vault: v.pfad, stufe }), { erfolg: (claude) => (claude?.aktion === "entfernt" ? TK.sperre.entfernt : TK.vault.stufeGesetzt(kt.name, stufeName(stufe))) });
  // Eine Sperre aufheben nimmt auch ein von Kortex eingetragenes Leseverbot heraus: darum eine kurze Rückfrage in der Seite
  function entsperrDialog(kt, v, stufe) {
    const ja = baueKnopf({ text: T.entsperren.ja, variante: "primaer", aktion: "entsperren-ja", aufKlick: () => { d.schliessen(); setzeStufe(kt, v, stufe); } });
    const d = eigenerDialog({ titel: T.entsperren.titel(kt.name, v.name), rumpf: [h("p", { klasse: "dialog-satz", text: T.entsperren.text(stufeName(stufe)) })], knoepfe: [baueKnopf({ text: T.entsperren.abbrechen, aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "entsperren";
  }
  // Sperren fragt vorher nach und sagt ehrlich, was es schützt und was nicht (Text und Ablauf aus der früheren Ansicht)
  function sperrDialog(kt, v, nurLeseverbot = false) {
    const claude = kt.programm === "claude";
    const datei = `${kt.ordner}/settings.json`;
    const haken = claude ? hakenFeld({ checked: true, text: TK.sperren.claudeHaken, klasse: "kk-wahl", daten: { "data-kk": "claude-haken" } }) : null;
    const ja = baueKnopf({ text: nurLeseverbot ? TK.sperre.eintragen.replace(" …", "") : TK.sperren.ja, variante: "primaer", symbol: "schild", aktion: "konten-sperren-ja", aufKlick: async () => {
      const mitVerbot = haken ? haken.input.checked : false;
      d.schliessen();
      await tue(() => api.kiZugriff({ konto: kt.id, vault: v.pfad, stufe: "gesperrt", ...(claude ? { claudeSperre: mitVerbot } : {}) }),
        { erfolg: (c) => (c?.aktion === "eingetragen" ? TK.sperre.eingetragen : TK.vault.stufeGesetzt(kt.name, stufeName("gesperrt"))) });
    } });
    const block = (titel, ...kinder) => h("div", { klasse: "kx-block" }, h("div", { klasse: "kk-block-titel", text: titel }), ...kinder);
    const d = eigenerDialog({ titel: TK.sperren.titel(kt.name, v.name), rumpf: [
      block(TK.sperren.schuetztTitel, h("p", { text: TK.sperren.schuetzt })),
      claude ? h("div", { klasse: "kx-kasten" }, block(TK.sperren.claudeTitel, haken,
        h("details", { klasse: "kx-genau", "data-kx": "genau" }, h("summary", { text: "Was genau eingetragen wird" }), h("p", { klasse: "mini", text: TK.sperren.claudeText(datei) }), h("p", { klasse: "mini", text: TK.sperren.claudeWirkt }))))
        : h("div", { klasse: "kx-kasten" }, h("p", { text: TK.sperren.andere(programmName(kt.programm)) })),
      h("div", { klasse: "kx-kasten warn" }, block(TK.sperren.grenzenTitel, h("p", { text: TK.sperren.grenzen }))),
    ], knoepfe: [baueKnopf({ text: TK.sperren.abbrechen, aktion: "konten-frage-abbrechen", aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "sperren";
  }
  async function standardSetzen(v, stufe) { await tue(() => api.kiStandard(v.pfad, stufe), { erfolg: () => TK.vault.neueKontenGespeichert }); }

  zeichner.zugriff = (el) => {
    if (S.kontenFehler && !S.konten) { el.replaceChildren(); return; }
    if (!S.konten) { el.replaceChildren(skelett("ez-skelett", 120)); return; }
    if (!vaults().length) { el.replaceChildren(h("p", { klasse: "kx-leer", "data-kk": "kein-vault", text: T.zugriff.keinVault })); return; }
    if (!konten().length) { el.replaceChildren(h("p", { klasse: "kx-leer", "data-kk": "keine-konten", text: T.zugriff.keineKonten })); return; }
    const kopf = h("tr", {}, h("th", { scope: "col", text: T.zugriff.kopfKonto }), vaults().map((v) => h("th", { scope: "col", "data-vault": v.pfad }, h("span", { klasse: "kx-vk-kopf" }, vaultKachel(v), h("span", { text: v.name })))));
    const zeilen = konten().map((kt) => h("tr", { "data-konto": kt.id, "data-programm": kt.programm },
      h("th", { scope: "row" }, h("span", { klasse: "kx-kz" }, logoKachel(kt.programm, 22), h("span", {}, h("span", { klasse: "kx-kz-name", text: programmName(kt.programm) }), h("small", { text: `${kt.name} · ${ordnerText(kt)}` })))),
      vaults().map((v) => h("td", { "data-vault": v.pfad }, stufeKnopf(kt, v, stufeVon(kt, v))))));
    const neu = h("tr", { klasse: "kx-standard", "data-kk": "neue-konten" },
      h("th", { scope: "row" }, h("span", { klasse: "kx-kz" }, h("span", { klasse: "kx-plus", "aria-hidden": "true" }, symbol("plus", 12)), h("span", {}, h("span", { klasse: "kx-kz-name", text: T.zugriff.neueKonten }), h("small", { text: T.zugriff.neueKontenSub })))),
      vaults().map((v) => {
        const s = v.neueKonten || "gesperrt";
        const b = stufenKnopf(s, { "data-s": s, "data-kk": "neue-stufen", "data-vault": v.pfad, "data-stufe": s }, T.zugriff.standardFuer(v.name),
          (ev) => oeffneMenue(ev.currentTarget, NEUE.map((x) => ({ name: stufeName(x), sub: T.zugriff.legende[x], haken: x === s, id: `standard-${x}`, tun: () => standardSetzen(v, x) })), { breite: 250 }));
        return h("td", { "data-vault": v.pfad }, h("div", { klasse: "kx-zelle" }, b));
      }));
    const legende = h("div", { klasse: "kx-legende", "data-kk": "legende" }, STUFEN.map((s) => h("span", { "data-s": s }, h("i", { klasse: "kx-pkt", "data-s": s }), h("b", { text: stufeName(s) }), ` ${T.zugriff.legende[s]}`)));
    el.replaceChildren(h("div", { klasse: "kx-matrix-rahmen" }, h("div", { klasse: "kx-matrix-scroll" }, h("table", { klasse: "kx-matrix", "data-kk": "matrix" }, h("thead", {}, kopf), h("tbody", {}, ...zeilen, neu))), legende));
  };

  // ================================================================== Wie fest ist die Sperre?
  async function schalteStreng(kt, an) {
    await tue(() => api.kiSchutz(kt.id, an), { erfolg: () => (an ? TK.streng.erfolgAn : TK.streng.erfolgAus) });
  }
  function strengDialog(kt) {
    const ja = baueKnopf({ text: TK.streng.dialogJa, variante: "primaer", aktion: "konten-streng-ja", aufKlick: () => { d.schliessen(); schalteStreng(kt, true); } });
    const d = eigenerDialog({ titel: TK.streng.dialogTitel(kt.name), rumpf: [
      h("p", { klasse: "dialog-satz", text: TK.streng.dialogWas }), h("p", { klasse: "dialog-satz", text: TK.streng.dialogEinstellungen }),
      h("div", { klasse: "kx-block" }, h("div", { klasse: "kk-block-titel", text: TK.streng.dialogFolgenTitel }), h("p", { klasse: "dialog-satz", text: TK.streng.dialogFolgen })), h("p", { klasse: "mini", text: TK.streng.dialogRueckweg }),
    ], knoepfe: [baueKnopf({ text: TK.sperren.abbrechen, aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "streng";
  }
  // Ausschalten fragt kurz nach: danach können Shell-Befehle die gesperrten Vaults wieder lesen
  function strengAusDialog(kt) {
    const ja = baueKnopf({ text: T.schutz.ausJa, variante: "primaer", aktion: "streng-aus-ja", aufKlick: () => { d.schliessen(); schalteStreng(kt, false); } });
    const d = eigenerDialog({ titel: T.schutz.ausTitel(kt.name), rumpf: [h("p", { klasse: "dialog-satz", text: T.schutz.ausText })], knoepfe: [baueKnopf({ text: T.schutz.ausAbbrechen, aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "streng-aus";
  }
  function stufenBox(nr, titel, zustand, text, extra) {
    const an = zustand === "an";
    return h("div", { klasse: `kx-stufe3-box ${an ? "an" : "aus"}`, "data-stufe-nr": String(nr), "data-zustand": zustand },
      h("div", { klasse: "kx-s3-k" }, h("span", { klasse: "kx-s3-z", "aria-hidden": "true", text: String(nr) }), h("b", { text: titel })), h("p", { text }), extra || null);
  }
  function schutzKarte(kt) {
    const a = kt.schutz.ampel;
    const gesperrt = sperrenVon(kt);
    const ohneVerbot = gesperrt.filter((v) => { const z = kt.schutz.vaults?.[v.schluessel || v.pfad] || kt.schutz.vaults?.[v.pfad] || "aus"; return !(z === "aktiv" || z === "eigene"); });
    const an = !!kt.schutz.strenger;
    const schalter = umschalter({ an, label: T.schutz.schalter(kt.name), daten: { "data-kk": "streng", "data-konto": kt.id, "data-streng": an ? "an" : "aus" }, aufAenderung: (v) => { if (v) { schalter.an = false; strengDialog(kt); } else { schalter.an = true; strengAusDialog(kt); } } });
    if (!an && gesperrt.length === 0) { schalter.setAttribute("disabled", ""); schalter.title = TK.streng.keinGesperrter; }
    const z2 = a.stufen[1].zustand, z3 = a.stufen[2].zustand;
    const z2Text = z2 === "teil" ? T.schutz.stufe2Zustand.teil(a.wirksam, a.gesperrt) : T.schutz.stufe2Zustand[z2] || T.schutz.stufe2Zustand.aus;
    const z3Text = z3 === "aus" && gesperrt.length === 0 ? T.schutz.stufe3Zustand.leer : T.schutz.stufe3Zustand[z3];
    const eintragen = ohneVerbot.length && z2 !== "defekt" ? baueKnopf({ text: T.schutz.eintragen, groesse: "s", daten: { "data-aktion": "leseverbot-eintragen", "data-konto": kt.id }, disabled: S.beschaeftigt, aufKlick: () => sperrDialog(kt, ohneVerbot[0], true) }) : null;
    const markeText = T.schutz.marke[a.farbe] || "";
    const kopf = h("div", { klasse: "kx-schutz-kopf" }, logoKachel(kt.programm, 28),
      h("div", { klasse: "kx-schutz-titel" }, h("b", { text: `${programmName(kt.programm)} · ${kt.name}` }), h("span", { text: T.schutz.gesperrt(gesperrt.map((v) => v.name)) })),
      h("span", { klasse: `kx-ampel ${a.farbe}`, "data-kx": "ampel", "data-farbe": a.farbe }, h("i", { "aria-hidden": "true" }), markeText), schalter);
    const warn = a.moeglich && kt.schutz.strenger ? [...new Set([...(kt.schutz.warnungen || []).map((w) => TK.streng.warnungen[w] || w), TK.streng.projektHinweis])] : [];
    return h("div", { klasse: "kx-schutz-karte", "data-kk": "streng-karte", "data-konto": kt.id, "data-farbe": a.farbe, "data-kx-fokus": `schutz-${kt.id}` }, kopf,
      h("div", { klasse: "kx-ampel-schutz", "data-kx": "stufen" }, stufenBox(1, T.schutz.stufe1, "an", T.schutz.stufe1Text(gesperrt.length)),
        stufenBox(2, T.schutz.stufe2, z2 === "an" ? "an" : "aus", z2Text, eintragen), stufenBox(3, T.schutz.stufe3, z3 === "an" ? "an" : "aus", z3Text)),
      warn.length ? h("div", { klasse: "kx-hinweis warn", role: "status", "data-kk": "streng-warnung" }, symbol("warnung", GROESSE.text), h("ul", { klasse: "kk-punkte" }, warn.map((t) => h("li", { text: t })))) : null);
  }
  zeichner.schutz = (el) => {
    if (!S.konten) { el.replaceChildren(skelett("ez-skelett", 120)); return; }
    const claude = konten().filter((x) => x.schutz?.moeglich);
    const andere = konten().filter((x) => !x.schutz?.moeglich && x.programm !== "claude");
    const teile = [];
    if (!claude.length) teile.push(h("p", { klasse: "kx-leer", "data-kx": "kein-claude", text: T.schutz.keinClaude }));
    for (const kt of claude) teile.push(schutzKarte(kt));
    if (andere.length) {
      const namen = [...new Set(andere.map((x) => programmName(x.programm)))].join(", ");
      teile.push(h("div", { klasse: "kx-schutz-karte kx-andere", "data-kx": "andere-programme" }, h("div", { klasse: "kx-schutz-kopf" }, h("span", { klasse: "kx-s3-z grau", "aria-hidden": "true", text: "1" }),
        h("div", { klasse: "kx-schutz-titel" }, h("b", { text: T.schutz.anderePrograme }), h("span", { text: T.schutz.andereText(namen) })))));
    }
    el.replaceChildren(h("div", { klasse: "kx-schutz-liste" }, ...teile));
  };

  // ================================================================== Frag-Standard
  const fragKonten = () => (S.frage?.konten || []).filter((x) => x.erlaubt);
  const fragVault = () => offenerVaultPfad() || "";
  function fragLeer() {
    if (S.frageFehler) return T.frage.hinweisKeinVault;
    if (!S.frage) return null;
    if (!offenerVault() && !kontext.info?.()?.vault) return T.frage.hinweisKeinVault;
    if (!S.frage.vertraut) return T.frage.hinweisNichtVertraut;
    if (!S.frage.claude) return T.frage.hinweisKeinClaude;
    if (!fragKonten().length) return T.frage.hinweisKeinKonto;
    return null;
  }
  zeichner["frage-konto"] = (el) => {
    if (!S.frage && !S.frageFehler) { el.replaceChildren(skelett("ez-skelett", 32)); return; }
    const grund = fragLeer();
    if (grund) { el.replaceChildren(h("span", { klasse: "ez-leise", "data-kx": "frage-leer", title: grund, text: S.frageFehler ? T.frage.kein : !S.frage.vertraut ? T.frage.nichtVertraut : !fragKonten().length ? T.frage.keinKonto : T.frage.keinVault })); return; }
    const gemerkt = leseLokal(`frage.konto@${fragVault()}`, null);
    const wahl = fragKonten().find((x) => x.id === gemerkt)?.id || fragKonten()[0].id;
    el.replaceChildren(auswahl({ optionen: fragKonten().map((x) => ({ wert: x.id, text: x.name, logo: x.programm })), wert: wahl, label: T.frage.konto, daten: { "data-kx": "frage-konto-wahl" },
      aufAenderung: (id) => { speichereLokal(`frage.konto@${fragVault()}`, id); toast(T.stufeGesetzt(T.frage.konto, fragKonten().find((x) => x.id === id)?.name || "")); } }));
  };
  zeichner["frage-modell"] = (el) => {
    const modelle = S.frage?.modelle?.length ? S.frage.modelle : ["klein", "mittel"];
    const aktuell = leseLokal("frage.modell", "klein");
    el.replaceChildren(segment({ optionen: modelle.map((m) => ({ wert: m, text: T.frage.modelle[m] || m })), wert: modelle.includes(aktuell) ? aktuell : modelle[0], label: T.frage.modell, daten: { "data-kx": "frage-modell-wahl" },
      aufAenderung: (m) => speichereLokal("frage.modell", m) }));
  };

  // ================================================================== Pflege je Vault
  const zeitText = (iso) => { try { return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
  async function setzePflege(v, konto, stufe) {
    if (S.beschaeftigt) return;
    if (stufe !== "aus" && !konto) { S.pflegeEntwurf[v.pfad] = { konto: null, stufe }; zeichne("pflege"); return; }
    delete S.pflegeEntwurf[v.pfad];
    const kt = kontoMit(konto);
    await tue(() => api.kiPflegeSetzen({ vault: v.pfad, konto: konto || null, stufe }), { erfolg: () => (stufe === "aus" ? TK.pflege.gespeichertAus : TK.pflege.gespeichert(kt?.name || "", TK.pflege.stufen[stufe].name)) });
    ladePflege();
  }
  async function pflegeJetzt() {
    const a = await tue(() => api.kiPflegeJetzt(), { erfolg: () => TK.pflege.jetztGestartet });
    if (a) setTimeout(() => { if (!zu()) ladePflege(); }, 2500);
  }
  function pflegeZeile(v) {
    const p = v.pflege || { gesetzt: false, wirksam: "alt" };
    const entwurf = S.pflegeEntwurf[v.pfad] || null;
    const kontoId = entwurf ? entwurf.konto : p.konto || null;
    const stufe = entwurf ? entwurf.stufe : p.gesetzt ? p.stufe : "mittel";
    const eignung = konten().filter((x) => x.programm === "claude" && stufeVon(x, v) === "erweitert");
    const optionen = eignung.map((x) => ({ wert: x.id, text: `${programmName(x.programm)} · ${x.name}`, logo: kiLogoId(x.programm) ? x.programm : undefined }));
    const gewaehlt = kontoMit(kontoId);
    if (gewaehlt && !optionen.some((x) => x.wert === gewaehlt.id)) optionen.push({ wert: gewaehlt.id, text: `${programmName(gewaehlt.programm)} · ${gewaehlt.name}`, logo: kiLogoId(gewaehlt.programm) ? gewaehlt.programm : undefined });
    const wahl = optionen.length ? auswahl({ optionen, wert: kontoId || "", platzhalter: T.pflege.kontoPlatzhalter, label: T.pflege.konto(v.name), groesse: "s", daten: { "data-kk": "pflege-konto" },
      aufAenderung: (w) => { const n = S.pflegeEntwurf[v.pfad]; setzePflege(v, w, n ? n.stufe : p.gesetzt && p.stufe !== "aus" ? p.stufe : "mittel"); } })
      : h("span", { klasse: "kx-kein-konto", "data-kk": "pflege-kein-konto", text: T.pflege.keinKonto });
    const seg = segment({ optionen: ["klein", "mittel", "aus"].map((s) => ({ wert: s, text: TK.pflege.stufen[s].name, daten: { "data-stufe-wahl": s } })), wert: stufe, label: T.pflege.stufe(v.name), groesse: "s", daten: { "data-kk": "pflege-stufe" },
      aufAenderung: (s) => { let kt = kontoId; if (!kt && s !== "aus" && eignung.length === 1) kt = eignung[0].id; setzePflege(v, kt, s); } });
    const st = S.pflege[v.pfad];
    const sub = h("div", { klasse: "kx-pflege-sub" });
    const hinweis = (S.konten.pflegeHinweise || []).find((x) => gleich(x.vault, v.schluessel || v.pfad) || gleich(x.vault, v.pfad));
    if (entwurf && !entwurf.konto) sub.append(h("span", { klasse: "kx-warn", "data-kk": "pflege-waehle-zuerst", text: TK.pflege.waehleZuerst }));
    else if (hinweis) sub.append(h("span", { klasse: "kx-warn", "data-kk": "pflege-migration", text: hinweis.grund === "stufe" ? TK.pflege.migration.stufe(kontoMit(hinweis.konto)?.name || "") : TK.pflege.migration["kein-konto"] }));
    else if (p.problem && p.gesetzt) sub.append(h("span", { klasse: "kx-warn", "data-kk": "pflege-problem", "data-problem": p.problem, text: TK.pflege.problem[p.problem] || TK.pflege.problem.unlesbar }));
    else if (S.pflegeFehler[v.pfad] && !st) sub.append(h("span", { klasse: "kx-warn", text: T.pflege.status.fehler }));
    else if (st) {
      const l = st.letzter;
      if (!l || !l.zeit) sub.append(h("span", { "data-kk": "pflege-letzter", text: T.pflege.status.nochNie }));
      else sub.append(h("span", { "data-kk": "pflege-letzter", "data-status": l.status, klasse: l.erfolgreich ? "" : "kx-warn", text: T.pflege.status.lauf(zeitText(l.zeit), TK.pflege.status[l.status] || TK.pflege.status.unbekannt, TK.pflege.zahlen(l.aufrufe, l.tokEin, l.tokAus)) }),
        l.grund && !l.erfolgreich ? h("span", { klasse: "kx-warn", "data-kk": "pflege-grund", text: ` — ${l.grund}` }) : null);
      if (st.schalter === "aus") sub.append(h("span", { klasse: "kx-warn", text: ` ${T.pflege.status.aus}` }));
    }
    const offen = gleich(v.pfad, offenerVaultPfad()) || gleich(v.schluessel, offenerVaultPfad());
    const jetzt = baueKnopf({ text: TK.pflege.jetzt, variante: "leise", groesse: "s", daten: { "data-kk": "pflege-jetzt" }, aktion: "pflege-jetzt", disabled: !offen || !st || st.schalter === "aus" || S.beschaeftigt, titel: !offen ? TK.pflege.jetztNurOffener : st?.schalter === "probe" ? TK.pflege.jetztProbe : undefined, aufKlick: () => pflegeJetzt() });
    return h("div", { klasse: "kx-pflege-zeile", "data-vault": v.pfad, "data-kx-fokus": `pflege-${v.pfad}` },
      h("span", { klasse: "kx-pflege-name" }, vaultKachel(v), h("b", { text: v.name })), h("div", { klasse: "kx-pflege-felder" }, wahl, seg), jetzt, sub);
  }
  zeichner.pflege = (el) => {
    if (!S.konten) { el.replaceChildren(skelett("ez-skelett", 90)); return; }
    if (!vaults().length) { el.replaceChildren(h("p", { klasse: "kx-leer", text: TK.vault.keinVault })); return; }
    const teile = [];
    if (S.konten.pflegePlist?.offen) teile.push(h("div", { klasse: "kx-hinweis warn", role: "status", "data-kk": "pflege-plist", "data-grund": S.konten.pflegePlist.grund }, symbol("warnung", GROESSE.text),
      h("span", {}, h("b", { text: `${TK.pflege.plist.titel}. ` }), TK.pflege.plist.text, " ", TK.pflege.plist.grund[S.konten.pflegePlist.grund] || TK.pflege.plist.grund.fehler)));
    teile.push(...vaults().map(pflegeZeile));
    // Was die Pflege tut (für den geöffneten Vault)
    const v = vaults().find((x) => gleich(x.pfad, offenerVaultPfad())) || vaults()[0];
    const p = v.pflege || {}, stufe = S.pflegeEntwurf[v.pfad]?.stufe || (p.gesetzt ? p.stufe : "mittel");
    const gruppe = (titel, an, punkte, kennung) => h("div", { klasse: "kx-tut", "data-kk": kennung, "data-aktiv": String(an) }, h("div", { klasse: "kx-tut-kopf" }, marke(an ? "gruen" : "aus"), h("b", { text: titel }), h("span", { text: an ? TK.pflege.aktiv : TK.pflege.ruht })), h("ul", { klasse: "kk-punkte" }, punkte.map((x) => h("li", { text: x }))));
    teile.push(h("details", { klasse: "kx-tut-details", "data-kk": "pflege-tut" }, h("summary", { text: `${T.pflege.details} (${v.name}: ${TK.pflege.stufen[stufe].name})` }),
      h("p", { klasse: "mini", "data-kk": "pflege-stufentext", text: TK.pflege.stufen[stufe].text }),
      gruppe(TK.pflege.immer, true, TK.pflege.immerListe, "tut-immer"), gruppe(TK.pflege.haikuTitel, stufe !== "aus", TK.pflege.mitKiListe.haiku, "tut-haiku"), gruppe(TK.pflege.sonnetTitel, stufe === "mittel", TK.pflege.mitKiListe.sonnet, "tut-sonnet")));
    el.replaceChildren(...teile);
  };

  // ================================================================== Kortex bei der Arbeit (früher im Assistenten): Hooks, Prüfung vor dem Speichern, Hintergrunddienst
  // Gelesen und geschrieben wird über genau die Routen des Assistenten: GET /api/kern/stand und POST /api/kern/verdrahten — keine eigene Logik, eine Quelle.
  const profile = () => S.kern?.profile || [];
  const claudeProfilStand = (pfad) => S.kern?.claude?.profile?.[pfad] || null;
  const aktiveProfile = () => profile().filter((p) => claudeProfilStand(p.pfad)?.aktiv);
  const gewaehlteProfile = () => {
    const da = profile().map((p) => p.pfad);
    if (S.profilWahl) return da.filter((x) => S.profilWahl.includes(x));
    const akt = aktiveProfile().map((p) => p.pfad);
    if (akt.length) return akt;
    const std = profile().find((p) => p.standard);
    return std ? [std.pfad] : profile().length === 1 ? da : [];
  };
  async function verdrahte(was, an, extra = {}) {
    if (S.kernBusy) return;
    S.kernBusy = was; delete S.kernFehlerText[was]; S.kernFrageErsetzen = false;
    zeichneArbeit();
    try {
      let daten = { was, an, ...extra };
      if (was === "claude") {
        const profile2 = an ? gewaehlteProfile() : aktiveProfile().map((p) => p.pfad);
        if (an && !profile2.length) throw Object.assign(new Error(T.arbeit.waehleProfil), { lokal: true });
        daten = { was, an, profile: profile2 };
      }
      const r = await api.kernVerdrahten(daten);
      if (r?.stand) S.kern = r.stand;
      toast(an ? T.arbeit.an(T.arbeit.namen[was]) : T.arbeit.aus(T.arbeit.namen[was]));
    } catch (e) {
      if (was === "git" && an && e?.status === 409 && e?.daten?.art === "anders") S.kernFrageErsetzen = true;
      else S.kernFehlerText[was] = e?.message || TK.fehlerAllgemein;
    }
    S.kernBusy = null;
    if (!zu()) zeichneArbeit();
  }
  function zeichneArbeit() { for (const n of ["arbeit-hooks", "arbeit-hooks-unten", "arbeit-git", "arbeit-git-unten", "arbeit-dienst", "arbeit-dienst-unten"]) zeichne(n); }
  const fehlerKarte = (was) => (S.kernFehlerText[was] ? h("div", { klasse: "kx-hinweis fehler", role: "alert", "data-kx": `arbeit-fehler-${was}` }, marke("rot"), h("span", { text: S.kernFehlerText[was] })) : null);
  const kernSchalter = (was, an, ok, titel) => {
    const s = umschalter({ an, label: titel, daten: { "data-kx": `arbeit-${was}`, "data-aktion": `arbeit-${was}` }, aufAenderung: (v) => verdrahte(was, v) });
    if (!ok || S.kernBusy) s.setAttribute("disabled", "");
    if (S.kernBusy === was) s.setAttribute("aria-busy", "true");
    return s;
  };
  const keinStand = () => {
    if (S.kernFehler && !S.kern) return h("span", { klasse: "ez-leise", "data-kx": "arbeit-nicht-lesbar", text: T.arbeit.fehlerLesen });
    return null;
  };
  zeichner["arbeit-hooks"] = (el) => {
    if (!S.kern && !S.kernFehler) { el.replaceChildren(skelett("ez-skelett", 24)); return; }
    const k0 = keinStand(); if (k0) { el.replaceChildren(k0); return; }
    if (!S.kern.starter?.vorhanden) { el.replaceChildren(h("span", { klasse: "ez-leise", "data-kx": "arbeit-kein-starter", text: T.arbeit.nichtMoeglich.kein })); return; }
    const gefunden = (S.programme?.programme || []).some((p) => p.id === "claude");
    if (!profile().length) { el.replaceChildren(h("span", { klasse: "ez-leise", "data-kx": "arbeit-kein-profil", text: gefunden ? T.arbeit.keinProfil : T.arbeit.keinClaude })); return; }
    const an = aktiveProfile().length > 0;
    el.replaceChildren(kernSchalter("claude", an, true, T.arbeit.schalter.claude));
  };
  // unten: Profilwahl und Fehler (eigener Knoten unter dem Text der Zeile)
  zeichner["arbeit-hooks-unten"] = (el) => {
    if (!S.kern || !profile().length) { el.replaceChildren(); return; }
    const teile = [];
    if (profile().length > 1) {
      const gew = gewaehlteProfile();
      teile.push(h("div", { klasse: "kx-profile", "data-kx": "profile" }, h("b", { text: T.arbeit.profile }), h("span", { klasse: "mini", text: T.arbeit.profileText }),
        profile().map((p) => hakenFeld({ checked: gew.includes(p.pfad), text: `${p.name}${p.standard ? ` ${T.arbeit.profilStandard}` : ""}${claudeProfilStand(p.pfad)?.aktiv ? ` — ${T.arbeit.profilAktiv}` : ""}`, daten: { "data-profil": p.pfad },
          aufChange: (an) => { const cur = gewaehlteProfile(); S.profilWahl = an ? [...new Set([...cur, p.pfad])] : cur.filter((x) => x !== p.pfad); } }))));
    }
    const f = fehlerKarte("claude"); if (f) teile.push(f);
    el.replaceChildren(...teile);
  };
  zeichner["arbeit-git"] = (el) => {
    if (!S.kern && !S.kernFehler) { el.replaceChildren(skelett("ez-skelett", 24)); return; }
    const k0 = keinStand(); if (k0) { el.replaceChildren(k0); return; }
    const g = S.kern.git || {};
    if (!g.moeglich) { el.replaceChildren(h("span", { klasse: "ez-leise", "data-kx": "arbeit-git-nein", text: offenerVaultPfad() ? T.arbeit.nichtMoeglich.keinGit : T.arbeit.nichtMoeglich.keinVault })); return; }
    el.replaceChildren(kernSchalter("git", !!g.aktiv, true, T.arbeit.schalter.git));
  };
  zeichner["arbeit-git-unten"] = (el) => {
    const teile = [];
    if (S.kernFrageErsetzen) teile.push(h("div", { klasse: "kx-hinweis warn", "data-kx": "arbeit-ersetzen" }, symbol("warnung", GROESSE.text), h("span", { text: T.arbeit.ersetzenFrage }),
      h("span", { klasse: "kx-akt" }, baueKnopf({ text: T.arbeit.nichtAendern, groesse: "s", daten: { "data-aktion": "git-nicht-aendern" }, aufKlick: () => { S.kernFrageErsetzen = false; zeichneArbeit(); } }),
        baueKnopf({ text: T.arbeit.ersetzen, variante: "primaer", groesse: "s", daten: { "data-aktion": "git-ersetzen" }, aufKlick: () => verdrahte("git", true, { ersetzen: true }) }))));
    const f = fehlerKarte("git"); if (f) teile.push(f);
    el.replaceChildren(...teile);
  };
  zeichner["arbeit-dienst"] = (el) => {
    if (!S.kern && !S.kernFehler) { el.replaceChildren(skelett("ez-skelett", 24)); return; }
    const k0 = keinStand(); if (k0) { el.replaceChildren(k0); return; }
    const d = S.kern.dienst || {};
    if (!d.verfuegbar) { el.replaceChildren(h("span", { klasse: "ez-leise", "data-kx": "arbeit-dienst-nein", text: T.arbeit.nichtMoeglich.dienst })); return; }
    el.replaceChildren(kernSchalter("dienst", !!d.eingerichtet, true, T.arbeit.schalter.dienst));
  };
  zeichner["arbeit-dienst-unten"] = (el) => { const f = fehlerKarte("dienst"); el.replaceChildren(...(f ? [f] : [])); };

  // ================================================================== Aktivität (vorbereitet)
  zeichner.aktivitaet = (el) => {
    const teile = [];
    const filter = h("div", { klasse: "kx-filter", role: "group", "aria-label": "Filter" }, ["alle", "abweisungen"].map((f) => h("button", { type: "button", klasse: "kx-filter-knopf", "aria-pressed": String(S.aktivFilter === f), "data-filter": f, text: T.aktivitaet.filter[f],
      aufClick: () => { S.aktivFilter = f; zeichne("aktivitaet"); } })));
    teile.push(filter);
    const eintraege = [];
    if (S.konten) for (const v of vaults()) {
      const l = S.pflege[v.pfad]?.letzter;
      if (!l?.zeit) continue;
      const kt = kontoMit(v.pflege?.konto);
      eintraege.push({ zeit: l.zeit, kt, v, text: T.aktivitaet.pflege(kt ? `${programmName(kt.programm)} · ${kt.name}` : "", v.name, TK.pflege.status[l.status] || TK.pflege.status.unbekannt), warn: !l.erfolgreich });
    }
    eintraege.sort((a, b) => String(b.zeit).localeCompare(String(a.zeit)));
    if (S.aktivFilter === "abweisungen") teile.push(h("div", { klasse: "kx-bald", "data-kx": "aktivitaet-bald" }, symbol("glocke", GROESSE.text), h("div", {}, h("b", { text: T.aktivitaet.bald }), h("span", { text: T.aktivitaet.baldText })), einstellMarke(T.aktivitaet.baldMarke, "akzent")));
    else {
      if (eintraege.length) teile.push(h("ul", { klasse: "kx-akt-liste", "data-kx": "aktivitaet-liste" }, eintraege.slice(0, 8).map((e) => h("li", { klasse: e.warn ? "warn" : "", "data-vault": e.v.pfad }, logoKachel(e.kt?.programm || "claude", 24),
        h("div", {}, h("b", { text: e.text }), h("span", { klasse: "kx-d", text: `Vault ${e.v.name}` })), h("time", { datetime: e.zeit, text: vorMinuten(e.zeit) })))));
      else teile.push(h("p", { klasse: "kx-leer", "data-kx": "aktivitaet-leer", text: T.aktivitaet.leer }));
      teile.push(h("div", { klasse: "kx-bald", "data-kx": "aktivitaet-bald" }, symbol("glocke", GROESSE.text), h("div", {}, h("b", { text: T.aktivitaet.bald }), h("span", { text: T.aktivitaet.baldText })), einstellMarke(T.aktivitaet.baldMarke, "akzent")));
    }
    el.replaceChildren(...teile);
  };

  // ================================================================== Ehrlich
  zeichner.ehrlich = (el) => {
    const zeilen = [["gruen", "Immer:", "Kortex' eigene Wege (Suche, Lesen, Hinweise, Ablegen) halten sich an die Stufe jedes Kontos."], ["gruen", "Claude Code:", TK.ehrlich.claude.replace(/^Claude Code:\s*/, "")],
      ["warn", "Andere Programme:", TK.ehrlich.andere.replace(/^Alle anderen Programme:\s*/, "")], ["warn", "Kennung:", TK.ehrlich.kennung], ["warn", "Echte Trennung", TK.ehrlich.keine.replace(/^Eine echte Trennung zwischen Konten gibt es nur/, "gibt es nur")]];
    el.replaceChildren(h("ul", { klasse: "kx-ehrlich-liste", "data-kk": "ehrlich-karte" }, zeilen.map(([art, kopf, text]) => h("li", { "data-art": art }, marke(art), h("span", {}, h("b", { text: `${kopf} ` }), text)))));
  };

  // ---------------------------------------------------------------- frühere Fassung zurückholen
  function vorherDialog() {
    const ja = baueKnopf({ text: TK.defekt.vorherJa, variante: "primaer", aktion: "konten-vorher-ja", aufKlick: async () => { d.schliessen(); await tue(() => api.kiVorher(), { erfolg: () => TK.defekt.vorherErfolg }); } });
    const d = eigenerDialog({ titel: TK.defekt.vorherTitel, satz: TK.defekt.vorherText, rumpf: [], knoepfe: [baueKnopf({ text: TK.sperren.abbrechen, aufKlick: () => d.schliessen() }), ja] });
  }

  // ---------------------------------------------------------------- Lebenszyklus
  const beiKonten = () => { if (!zu()) ladeKonten(); };
  window.addEventListener("kortex-konten", beiKonten);
  let gestartet = false, ktAb = null;
  function start() {
    if (gestartet) return;
    gestartet = true;
    ladeKonten(); ladeProgramme(false); ladeKern(); ladeFrage();
    ktAb = ktStand.abonniere(beiKontingent); ktStand.start();
  }
  function ende() {
    S.tot = true;
    window.removeEventListener("kortex-konten", beiKonten);
    ktAb?.();
    for (const f of [...S.uberwacht]) { try { f(); } catch { /* egal */ } }
    for (const d of [...offeneDialoge]) { try { d.schliessen(); } catch { /* egal */ } }
    hosts.clear();
  }
  return { host, start, ende, kopfKnoepfe, neuSuchen, verbindenUmschalten, zeichne, zeichneAlle, state: S };
}
