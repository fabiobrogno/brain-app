// Einstieg ohne Vault: Willkommen-Karte (vier Wege), Name/Ort, Klonen, Versionsverlauf-Rückfrage, KI verbinden (der gemeinsame Ablauf aus ki-verbinden.js).
// Wird per dynamischem import() geladen und hat beim Import keine Nebenwirkungen.
import { h, speichereLokal, leseLokal, arbeitBeginnt } from "./hilfen.js";
import { textfeld, knopf as baueKnopf } from "./bausteine.js";
import * as API from "./api.js";
import { symbol } from "./symbole.js";
import { erzeugeKiVerbinden } from "./ki-verbinden.js";
import { markenLogo } from "./marken.js";
import { TW } from "./texte-willkommen.js";

const api = API.api;
const STANDARD_ORDNER = "~/Kortex";
const KI_GESEHEN = "ki-schritt-gesehen";

let zaehler = 0;
const nid = (p) => `${p}-${++zaehler}`;
const sicher = (fn) => { try { return Promise.resolve(fn()).catch(() => null); } catch { return Promise.resolve(null); } };
const kurzPfad = (p) => (p ? String(p).replace(/^\/Users\/[^/]+(?=\/|$)/, "~") : STANDARD_ORDNER);
const pfadVon = (v) => (typeof v === "string" && v) || (typeof v?.pfad === "string" && v.pfad) || null;
const pfadAusAntwort = (r) => (typeof r?.pfad === "string" && r.pfad) || (typeof r?.vault?.pfad === "string" && r.vault.pfad) || (typeof r?.vault === "string" && r.vault) || null;

// 404 ohne eigene Erklärung = Weg gibt es im Backend (noch) nicht.
const istNichtDa = (e) => [404, 405, 501].includes(e?.status) && (!e?.message || /^(nicht gefunden|das hat nicht geklappt)\.?$/i.test(String(e.message).trim()));
function meldungVon(e) {
  if (istNichtDa(e)) return TW.fehler.nochNicht;
  const m = typeof e?.message === "string" ? e.message.trim() : "";
  return m || TW.fehler.allgemein;
}

// ---------------------------------------------------------------- Stil und Host
let stilWartet = null;
function ladeStil() {
  if (stilWartet) return stilWartet;
  const vorhanden = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /willkommen\.css/.test(l.getAttribute("href") || ""));
  if (vorhanden) return (stilWartet = Promise.resolve());
  stilWartet = new Promise((ok) => {
    const l = h("link", { rel: "stylesheet", href: new URL("willkommen.css", import.meta.url).href });
    l.addEventListener("load", () => ok());
    l.addEventListener("error", () => ok());
    setTimeout(ok, 1500);
    document.head.append(l);
  });
  return stilWartet;
}
function holeHost() {
  let host = document.getElementById("willkommen-host");
  if (!host) { host = h("div", { id: "willkommen-host", hidden: true }); document.body.append(host); }
  return host;
}
const sichtbar = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
const fokussierbare = (wurzel) => [...wurzel.querySelectorAll("button:not(:disabled), input:not(:disabled), a[href], [tabindex='0']")].filter(sichtbar);
function haltFokus(wurzel, e) {
  const f = fokussierbare(wurzel);
  if (!f.length) { e.preventDefault(); return; }
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && (i === f.length - 1 || i === -1)) { e.preventDefault(); f[0].focus(); }
}
const spinner = () => h("span", { klasse: "w-dreh", "aria-hidden": "true" });

// ---------------------------------------------------------------- Ordner wählen
// App: nativer Ordner-Dialog ({pfad} | null). Browser (Antwort undefined): Textfeld „Pfad zum Ordner“.
export async function waehleOrdner(titel) {
  let antwort;
  try { antwort = await API.aktionMitAntwort?.("ordner-waehlen"); } catch { antwort = undefined; }
  if (antwort === undefined) return pfadDialog(titel);
  const pfad = typeof antwort === "string" ? antwort : antwort?.pfad;
  return pfad ? String(pfad) : null;
}

function pfadDialog(titel) {
  return new Promise((ok) => {
    const host = document.getElementById("willkommen-host");
    const davor = document.activeElement;
    const id = nid("w-pfad");
    const pfadFeld = textfeld({ id: `${id}-feld`, platzhalter: TW.pfad.platzhalter, beschreibung: `${id}-hilfe`, daten: { "data-feld": "pfad" } });
    const eingabe = pfadFeld.input;
    const fehler = h("div", { klasse: "fehlertext", role: "alert" });
    const abbrechen = baueKnopf({ text: TW.abbrechen, aktion: "pfad-abbrechen" });
    const uebernehmen = baueKnopf({ text: TW.pfad.uebernehmen, variante: "primaer", aktion: "pfad-uebernehmen" });
    const box = h("div", { klasse: "w-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": `${id}-titel`, "data-schritt": "pfad" },
      h("h2", { id: `${id}-titel`, text: titel || TW.pfad.titel }),
      h("div", { klasse: "feld" },
        h("label", { for: `${id}-feld`, text: TW.pfad.feld }), pfadFeld.el,
        h("div", { klasse: "mini", id: `${id}-hilfe`, text: TW.pfad.hilfe })),
      fehler,
      h("div", { klasse: "w-modal-fuss" }, abbrechen, uebernehmen));
    const schleier = h("div", { klasse: "w-schleier" }, box);
    const zu = (wert) => {
      document.removeEventListener("keydown", taste, true);
      schleier.remove();
      host?.removeAttribute("inert");
      if (davor && document.contains(davor)) davor.focus?.();
      ok(wert);
    };
    const taste = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zu(null); }
      else if (e.key === "Tab") haltFokus(box, e);
    };
    const nimm = () => {
      const w = eingabe.value.trim();
      if (!w) { fehler.textContent = TW.pfad.leer; eingabe.focus(); return; }
      if (!/^[/~]/.test(w)) { fehler.textContent = TW.pfad.relativ; eingabe.focus(); return; }
      zu(w);
    };
    abbrechen.addEventListener("click", () => zu(null));
    uebernehmen.addEventListener("click", nimm);
    eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nimm(); } });
    eingabe.addEventListener("input", () => { fehler.textContent = ""; });
    schleier.addEventListener("mousedown", (e) => { if (e.target === schleier) zu(null); });
    document.addEventListener("keydown", taste, true);
    host?.setAttribute("inert", "");
    document.body.append(schleier);
    setTimeout(() => eingabe.focus(), 0);
  });
}

// ---------------------------------------------------------------- Karte
const WEGE = [
  { id: "vorlage", symbol: "rakete", ton: "ton-akzent" },
  { id: "leer", symbol: "plus", ton: "ton-gelb" },
  { id: "ordner", symbol: "ordner-offen", ton: "ton-gruen" },
  { id: "klonen", marke: "github", ton: "ton-grau" },
];

let aktiv = null;

async function starteKarte({ modus = "start", beiFertig, beiAbbruch, beiStandNeu, beiVerbunden, anfang } = {}) {
  await ladeStil();
  if (aktiv && aktiv.karte?.isConnected) { aktiv.fokus(); return aktiv; }
  const host = holeHost();
  const app = document.getElementById("app");
  const davor = document.activeElement;
  const z = { modus, pfad: null, name: undefined, ordner: undefined, url: "", beschaeftigt: false, aktuell: null };
  let ende;
  const endePromise = new Promise((ok) => { ende = ok; });

  const karte = h("div", { klasse: "w-karte", role: "dialog", "aria-modal": "true", "data-modus": modus, "aria-busy": "false" });
  host.replaceChildren(karte);

  function schliesse() {
    host.removeEventListener("keydown", beiTaste);
    host.hidden = true;
    host.replaceChildren();
    if (app) app.inert = false;
    aktiv = null;
    if (davor && document.contains(davor)) davor.focus?.();
  }
  function abschluss() {
    const pfad = z.pfad;
    schliesse();
    try { beiFertig?.({ pfad }); } catch (e) { console.error(e); }
    ende({ pfad });
  }
  function abbrechen() {
    schliesse();
    try { beiAbbruch?.(); } catch (e) { console.error(e); }
    ende(null);
  }
  function beiTaste(e) {
    if (e.defaultPrevented) return;
    if (e.key === "Tab") { haltFokus(host, e); return; }
    if (e.key !== "Escape" || z.beschaeftigt) return;
    const s = z.aktuell;
    if (s?.escape) { e.preventDefault(); s.escape(); }
    else if (s?.zurueck) { e.preventDefault(); s.zurueck(); }
    else if (z.modus === "neu" && s?.abbrechbar) { e.preventDefault(); abbrechen(); }
  }

  function zeige(s) {
    z.aktuell = s;
    karte.dataset.schritt = s.name;
    karte.setAttribute("aria-labelledby", s.titelId);
    const ecken = [];
    if (s.zurueck) ecken.push(h("button", { klasse: "w-ecke links", type: "button", "data-aktion": "zurueck", aufClick: () => { if (!z.beschaeftigt) s.zurueck(); } }, symbol("pfeil-links", 14), TW.zurueck));
    if (z.modus === "neu" && s.abbrechbar) ecken.push(h("button", { klasse: "w-ecke rechts", type: "button", "data-aktion": "abbrechen", text: TW.abbrechen, aufClick: () => { if (!z.beschaeftigt) abbrechen(); } }));
    s.knoten.classList.add("w-schritt");
    s.knoten.classList.toggle("mit-ecke", !!s.zurueck);
    s.knoten.classList.add("w-sperre"); // ein Doppelklick auf einen Weg darf nicht im nächsten Schritt landen
    setTimeout(() => s.knoten.classList.remove("w-sperre"), 260);
    karte.replaceChildren(...ecken, s.knoten);
    setTimeout(() => { if (z.aktuell === s) s.fokus?.(); }, 0);
  }

  // art: was gerade läuft („oeffnen“, „neu“, „klonen“) – das Schließen des Fensters fragt nach, solange es läuft
  async function mitFortschritt(s, text, fn, art = "vault") {
    if (z.beschaeftigt) return;
    z.beschaeftigt = true;
    const ende = arbeitBeginnt(art);
    karte.setAttribute("aria-busy", "true");
    const gesperrt = [...karte.querySelectorAll("button, input")].filter((e) => !e.disabled);
    gesperrt.forEach((e) => { e.disabled = true; });
    s.meldung.replaceChildren(h("div", { klasse: "w-arbeit" }, spinner(), h("span", { text })));
    try { await fn(); }
    finally {
      ende();
      z.beschaeftigt = false;
      karte.setAttribute("aria-busy", "false");
      gesperrt.forEach((e) => { e.disabled = false; });
    }
  }
  function zeigeFehler(s, e) {
    s.meldung.replaceChildren(h("div", { klasse: "w-fehlerbox fehlertext", role: "alert" }, symbol("warnung", 14), h("span", { text: typeof e === "string" ? e : meldungVon(e) })));
    setTimeout(() => { if (z.aktuell === s) s.fokusNachFehler?.(); }, 0);
  }
  const leereMeldung = (s) => s.meldung.replaceChildren();

  // Unklarer Ausgang (Zeitüberschreitung der Brücke): Stand neu holen (Info, Vault-Liste, Git-Status) und ehrlich melden.
  // Hat die Werkstatt inzwischen einen anderen Vault geöffnet, hat der Weg geklappt: wie nach Erfolg weitermachen.
  async function behandleFehler(s, e) {
    if (API.ausgangUnklar(e)) {
      const stand = await API.ladeStandNeu();
      if (stand.ok) {
        const gewechselt = !!(await sicher(() => beiStandNeu?.(stand)));
        if (gewechselt) { z.pfad = pfadVon(stand.info?.vault) || z.pfad; return abschluss(); }
        e = new Error(API.zeitText(e));
      }
    }
    if (s) zeigeFehler(s, e); else zeige(schrittFehler(e));
  }

  // Nach jedem Erfolg Info neu lesen: ist jetzt ein Vault aktiv?
  async function nachVault(hinweis) {
    const info = await sicher(() => api.info());
    if (info && !info.vault) throw new Error(TW.fehler.allgemein);
    z.pfad = pfadVon(info?.vault) || hinweis || z.pfad;
    if (z.modus === "ordner" || (z.modus === "neu" && leseLokal(KI_GESEHEN, false))) return abschluss();
    zeige(schrittKi());
  }

  // ------------------------------------------------------------ Schritt: Willkommen
  function schrittWahl() {
    const titelId = nid("w-t");
    const meldung = h("div", { klasse: "w-meldung", "aria-live": "polite" });
    const zeilen = WEGE.map((w) => h("button", { klasse: `w-weg ${w.ton}`, type: "button", "data-weg": w.id, aufClick: () => waehleWeg(w.id) },
      h("span", { klasse: "w-kachel" }, w.marke ? markenLogo(w.marke, 20, { dekorativ: true }) : symbol(w.symbol, 20)),
      h("span", { klasse: "w-weg-text" }, h("span", { klasse: "w-weg-titel", text: TW.wege[w.id].titel }), h("span", { klasse: "w-weg-text2", text: TW.wege[w.id].text }))));
    let zeile = zeilen[0];
    zeilen.forEach((el) => el.addEventListener("focus", () => { zeile = el; }));
    // Ein Hauptweg (die Vorlage), die übrigen ruhig gruppiert darunter (Muster aus Orcas „Add a project“, MIT; siehe THIRD-PARTY-NOTICES.md).
    zeilen[0].classList.add("haupt");
    const andere = h("div", { klasse: "w-andere" }, h("h3", { klasse: "w-abschnitt", text: TW.willkommen.andere }), h("div", { klasse: "w-gruppe-wege" }, zeilen.slice(1)));
    const liste = h("div", { klasse: "w-wege", role: "group", "aria-label": TW.willkommen.wegeLabel, aufKeydown: (e) => {
      const i = zeilen.indexOf(document.activeElement);
      let n = null;
      if (e.key === "ArrowDown") n = (i + 1) % zeilen.length;
      else if (e.key === "ArrowUp") n = (i <= 0 ? zeilen.length : i) - 1;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = zeilen.length - 1;
      if (n !== null) { e.preventDefault(); zeilen[n].focus(); }
    } }, zeilen[0], andere);
    const s = {
      name: "wahl", titelId, abbrechbar: true, meldung,
      knoten: h("div", null,
        h("header", { klasse: "w-kopf" },
          h("div", { klasse: "w-logo" }, symbol("marke", 56)),
          h("h1", { klasse: "w-titel", id: titelId, text: TW.willkommen.titel }),
          h("p", { klasse: "w-untertitel", text: TW.willkommen.untertitel })),
        h("hr", { klasse: "w-trenner" }),
        liste, meldung,
        h("p", { klasse: "w-fuss-text" }, TW.willkommen.fuss.split(". ").map((satz, i, a) => h("span", { klasse: "w-satz" }, i === 0 ? symbol("schild", 14) : null, i < a.length - 1 ? `${satz}.` : satz)))),
      fokus: () => zeilen[0].focus(),
      fokusNachFehler: () => zeile.focus(),
    };
    function waehleWeg(id) {
      if (z.beschaeftigt) return;
      leereMeldung(s);
      if (id === "vorlage" || id === "leer") zeige(schrittName(id));
      else if (id === "klonen") zeige(schrittKlonen());
      else ordnerWeg(s);
    }
    return s;
  }

  // ------------------------------------------------------------ Weg 3: vorhandenen Ordner öffnen
  async function ordnerWeg(s) {
    const pfad = await waehleOrdner(TW.ordner.dialogTitel);
    if (!pfad) { s.fokusNachFehler?.(); return; } // Abbruch: still zurück
    await mitFortschritt(s, TW.ordner.arbeit, () => oeffnePfad(pfad, s), "oeffnen");
  }
  async function oeffnePfad(pfad, s) {
    try {
      const r = await api.vaultOeffnen(pfad);
      const info = await sicher(() => api.info());
      if (info && !info.vault) throw new Error(TW.fehler.allgemein);
      z.pfad = pfadVon(info?.vault) || pfadAusAntwort(r) || pfad;
      if (r?.git === false || info?.git === false) { zeige(schrittGit(pfad)); return; }
      await nachVault(pfadAusAntwort(r) || pfad);
    } catch (e) { await behandleFehler(s, e); }
  }

  // ------------------------------------------------------------ Schritt: Name und Ort (Weg 1/2)
  function schrittName(art) {
    const t = TW.name[art];
    const titelId = nid("w-t");
    const meldung = h("div", { klasse: "w-meldung", "aria-live": "polite" });
    const feldId = nid("w-f");
    const nameFeld = textfeld({ id: feldId, wert: z.name ?? TW.name.vorgabe, maxlaenge: 80, daten: { "data-feld": "name" } });
    const eingabe = nameFeld.input;
    const ortPfad = h("b", { text: kurzPfad(z.ordner) });
    const hilfe = h("p", { klasse: "mini w-hilfe", text: TW.name.freigabe });
    hilfe.hidden = !!z.ordner;
    const wechseln = baueKnopf({ text: TW.name.andererOrdner, aktion: "ordner-wechseln", aufKlick: async () => {
      const p = await waehleOrdner(TW.name.dialogTitel);
      if (p) { z.ordner = p; ortPfad.textContent = kurzPfad(p); hilfe.hidden = true; }
      wechseln.focus();
    } });
    const knopf = baueKnopf({ text: TW.name.anlegen, variante: "primaer", groesse: "l", klasse: "w-voll", aktion: "anlegen" });
    const s = {
      name: "name", titelId, abbrechbar: true, meldung, zurueck: () => zeige(schrittWahl()),
      knoten: h("div", null,
        h("header", { klasse: "w-kopf" }, h("div", { klasse: `w-kachel-gross ${art === "vorlage" ? "ton-akzent" : "ton-gelb"}` }, symbol(art === "vorlage" ? "rakete" : "plus", 24)),
          h("h2", { klasse: "w-titel klein", id: titelId, text: t.titel }),
          h("p", { klasse: "w-untertitel", text: t.text })),
        h("div", { klasse: "w-formular" },
          h("div", { klasse: "feld" }, h("label", { for: feldId, text: TW.name.feld }), nameFeld.el),
          h("div", { klasse: "w-ort" }, h("span", { klasse: "w-ort-symbol" }, symbol("ordner", 16)), h("span", { klasse: "w-ort-text" }, `${TW.name.ortVor} `, ortPfad), wechseln),
          hilfe, knopf),
        meldung),
      fokus: () => { eingabe.focus(); eingabe.select(); },
      fokusNachFehler: () => eingabe.focus(),
    };
    eingabe.addEventListener("input", () => { z.name = eingabe.value; });
    const tun = () => {
      const name = eingabe.value.trim();
      if (!name) return zeigeFehler(s, TW.name.keinName);
      if (/[/\\]/.test(name)) return zeigeFehler(s, TW.name.schraegstrich);
      z.name = name;
      mitFortschritt(s, t.arbeit, async () => {
        try { const r = await api.vaultNeu(art, name, z.ordner); await nachVault(pfadAusAntwort(r)); }
        catch (e) { await behandleFehler(s, e); }
      }, "neu");
    };
    knopf.addEventListener("click", tun);
    eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tun(); } });
    return s;
  }

  // ------------------------------------------------------------ Schritt: von GitHub klonen (Weg 4)
  function schrittKlonen() {
    const titelId = nid("w-t");
    const meldung = h("div", { klasse: "w-meldung", "aria-live": "polite" });
    const feldId = nid("w-f");
    const urlFeld = textfeld({ id: feldId, wert: z.url || "", platzhalter: TW.klonen.urlPlatzhalter, daten: { "data-feld": "url" } });
    const eingabe = urlFeld.input;
    const ortPfad = h("b", { text: kurzPfad(z.ordner) });
    const wechseln = baueKnopf({ text: TW.klonen.andererOrdner, aktion: "ordner-wechseln", aufKlick: async () => {
      const p = await waehleOrdner(TW.klonen.dialogTitel);
      if (p) { z.ordner = p; ortPfad.textContent = kurzPfad(p); }
      wechseln.focus();
    } });
    const knopf = baueKnopf({ text: TW.klonen.knopf, variante: "primaer", groesse: "l", klasse: "w-voll", aktion: "klonen" });
    const s = {
      name: "klonen", titelId, abbrechbar: true, meldung, zurueck: () => zeige(schrittWahl()),
      knoten: h("div", null,
        h("header", { klasse: "w-kopf" }, h("div", { klasse: "w-kachel-gross ton-grau" }, markenLogo("github", 24, { dekorativ: true })),
          h("h2", { klasse: "w-titel klein", id: titelId, text: TW.klonen.titel }),
          h("p", { klasse: "w-untertitel", text: TW.klonen.text })),
        h("div", { klasse: "w-formular" },
          h("div", { klasse: "feld" }, h("label", { for: feldId, text: TW.klonen.urlFeld }), urlFeld.el),
          h("div", { klasse: "feld" }, h("label", { text: TW.klonen.zielFeld }),
            h("div", { klasse: "w-ort" }, h("span", { klasse: "w-ort-symbol" }, symbol("ordner", 16)), h("span", { klasse: "w-ort-text" }, `${TW.klonen.ortVor} `, ortPfad), wechseln)),
          h("p", { klasse: "mini w-hilfe", text: TW.klonen.anmeldung }),
          knopf),
        meldung),
      fokus: () => eingabe.focus(),
      fokusNachFehler: () => eingabe.focus(),
    };
    eingabe.addEventListener("input", () => { z.url = eingabe.value; });
    const tun = () => {
      const url = eingabe.value.trim();
      if (!url) return zeigeFehler(s, TW.klonen.keineUrl);
      if (!/^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|git@|\/)/i.test(url)) return zeigeFehler(s, TW.klonen.urlFormat);
      z.url = url;
      mitFortschritt(s, TW.klonen.arbeit, async () => {
        try { const r = await api.vaultKlonen(url, z.ordner); await nachVault(pfadAusAntwort(r)); }
        catch (e) { await behandleFehler(s, e); }
      }, "klonen");
    };
    knopf.addEventListener("click", tun);
    eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tun(); } });
    return s;
  }

  // ------------------------------------------------------------ Schritt: Versionsverlauf einschalten?
  function schrittGit(pfad) {
    const titelId = nid("w-t");
    const meldung = h("div", { klasse: "w-meldung", "aria-live": "polite" });
    const weiter = () => nachVault(pfad).catch((e) => zeigeFehler(s, e));
    const ein = baueKnopf({ text: TW.git.einschalten, variante: "primaer", groesse: "l", aktion: "git-einschalten" });
    const ohne = baueKnopf({ text: TW.git.ohne, groesse: "l", aktion: "git-ohne", aufKlick: () => { if (!z.beschaeftigt) weiter(); } });
    const s = {
      name: "git", titelId, meldung, escape: () => weiter(),
      knoten: h("div", null,
        h("header", { klasse: "w-kopf" }, h("div", { klasse: "w-kachel-gross ton-akzent" }, symbol("zweig", 24)),
          h("h2", { klasse: "w-titel klein", id: titelId, text: TW.git.titel }),
          h("p", { klasse: "w-untertitel", text: TW.git.text }),
          h("p", { klasse: "mini w-kopf-hilfe", text: TW.git.hilfe })),
        h("div", { klasse: "w-fuss-knoepfe" }, ohne, ein),
        meldung),
      fokus: () => ein.focus(),
      fokusNachFehler: () => ein.focus(),
    };
    ein.addEventListener("click", () => mitFortschritt(s, TW.git.arbeit, async () => {
      try {
        const r = await api.vaultOeffnen(pfad, { gitEinschalten: true });
        // Eingeschaltet werden sollte es, ist es aber nicht (git:false): nie still zum nächsten Schritt, sondern sagen, was los ist
        if (r?.git === false) { zeigeFehler(s, TW.git.fehlgeschlagen); return; }
        await nachVault(pfad);
      } catch (e) { await behandleGitFehler(s, e, pfad); }
    }, "oeffnen"));
    return s;
  }

  // Unklarer Ausgang beim Einschalten (die Brücke hat aufgegeben, oder die Werkstatt hat ihre Frist gerissen und zurückgenommen).
  // Der Ordner ist durch den ersten Schritt schon offen und aktiv: dass die Werkstatt „einen anderen Vault als die App“ hat, sagt hier
  // also nichts (die App kennt ihn noch nicht) und darf nie als Erfolg gelten. Entscheidend ist, ob jetzt wirklich ein Verlauf da ist.
  async function behandleGitFehler(s, e, pfad) {
    if (!API.ausgangUnklar(e)) return behandleFehler(s, e);
    const stand = await API.ladeStandNeu();
    // Die Werkstatt antwortet nicht mehr: bei status 0 bleibt es bei der Verbindungsmeldung; ihr 504-Satz spräche von „nicht eingetragen“ (falsch: der Ordner ist es)
    if (!stand.ok) return zeigeFehler(s, e?.status === 504 ? TW.git.zeit : e);
    const inzwischenEin = stand.info?.git === true && (!z.pfad || stand.info.vault === z.pfad);
    if (!inzwischenEin) return zeigeFehler(s, TW.git.zeit); // der Schritt bleibt stehen, „Ohne Verlauf weiter“ geht weiter
    try { await nachVault(pfad); } catch (x) { zeigeFehler(s, x); }
  }

  // ------------------------------------------------------------ Schritt: Arbeit / Fehler (nur Ordner-Flow)
  function schrittArbeit(titelText, text) {
    const titelId = nid("w-t");
    const meldung = h("div", { klasse: "w-meldung", "aria-live": "polite" });
    return {
      name: "arbeit", titelId, meldung,
      knoten: h("div", { klasse: "w-arbeit-seite" },
        h("h2", { klasse: "w-titel klein", id: titelId, text: titelText }),
        h("div", { klasse: "w-arbeit", role: "status" }, spinner(), h("span", { text }))),
    };
  }
  function schrittFehler(e) {
    const titelId = nid("w-t");
    const meldung = h("div", { klasse: "w-meldung", "aria-live": "polite" });
    const zu = baueKnopf({ text: TW.schliessen, groesse: "l", aktion: "schliessen", aufKlick: () => abbrechen() });
    const nochmal = baueKnopf({ text: TW.ordner.anderer, variante: "primaer", groesse: "l", aktion: "anderer-ordner", aufKlick: async () => {
      const p = await waehleOrdner(TW.ordner.dialogTitel);
      if (!p) { nochmal.focus(); return; }
      zeige(schrittArbeit(TW.ordner.arbeitTitel, TW.ordner.arbeit));
      z.beschaeftigt = true;
      const ende = arbeitBeginnt("oeffnen");
      try { await oeffnePfad(p, null); } finally { ende(); z.beschaeftigt = false; }
    } });
    return {
      name: "fehler", titelId, meldung, escape: () => abbrechen(),
      knoten: h("div", null,
        h("header", { klasse: "w-kopf" }, h("div", { klasse: "w-kachel-gross ton-gelb" }, symbol("warnung", 24)),
          h("h2", { klasse: "w-titel klein", id: titelId, text: TW.fehler.titel })),
        h("div", { klasse: "w-fehlerbox fehlertext gross", role: "alert" }, symbol("warnung", 14), h("span", { text: meldungVon(e) })),
        h("div", { klasse: "w-fuss-knoepfe" }, zu, nochmal)),
      fokus: () => nochmal.focus(),
    };
  }

  // ------------------------------------------------------------ Schritt: KI verbinden
  // Der Ablauf „KI verbinden“ (ki-verbinden.js) ist derselbe wie im Dialog der Statusleiste; hier mit eigenen Knöpfen in der Karte. „Später“ und „Weiter“ enden beide beim Abschluss der Karte.
  function schrittKi() {
    const titelId = nid("w-t");
    const weiter = () => { speichereLokal(KI_GESEHEN, true); abschluss(); };
    let info = null;
    const fluss = erzeugeKiVerbinden({ rahmen: "karte", fuss: "eigen", vorwahl: true, abbrechenText: TW.ki.spaeter, ohneKiText: TW.ki.weiter,
      vaultPfad: () => info?.vault || null, vaultName: () => info?.name || "",
      beiVerbunden: () => { try { beiVerbunden?.(); } catch (e) { console.error(e); } },
      beiFertig: () => { fluss.zerstoere(); weiter(); } });
    // der Vault ist erst jetzt offen: die Stufen gelten für ihn, deshalb nach dem Lesen der Werkstatt noch einmal laden
    sicher(() => api.info()).then((i) => { info = i; if (i?.vault) fluss.lade(); });
    return {
      name: "ki", titelId, meldung: null,
      knoten: h("div", { "aria-labelledby": titelId }, h("span", { id: titelId, klasse: "bs-nur-lesen", text: TW.ki.dialogTitel }), fluss.el),
      fokus: () => fluss.el.querySelector(".ka-karte, .knopf.primaer")?.focus(),
    };
  }

  // ------------------------------------------------------------ Start
  host.addEventListener("keydown", beiTaste);
  host.hidden = false;
  if (app) app.inert = true;
  aktiv = { karte, fokus: () => z.aktuell?.fokus?.(), schliessen: abbrechen, ende: endePromise };
  if (anfang?.oeffnen) {
    zeige(schrittArbeit(TW.ordner.arbeitTitel, TW.ordner.arbeit));
    z.beschaeftigt = true;
    const ende = arbeitBeginnt("oeffnen");
    oeffnePfad(anfang.oeffnen, null).finally(() => { ende(); z.beschaeftigt = false; });
  } else zeige(schrittWahl());
  return aktiv;
}

// ---------------------------------------------------------------- Öffentliche Einstiege
// modus "start": kein Vault vorhanden (kein Abbrechen). modus "neu": aus dem Vault-Wechsler, mit „Abbrechen“.
// beiStandNeu(stand): die App frischt nach unklarem Ausgang (Zeitüberschreitung) ihre Anzeige auf und meldet true, wenn ein anderer Vault aktiv ist.
// beiVerbunden: nur nach geglücktem „Mit Claude verbinden“.
export async function zeigeWillkommen({ modus = "start", beiFertig, beiAbbruch, beiStandNeu, beiVerbunden } = {}) {
  const k = await starteKarte({ modus, beiFertig, beiAbbruch, beiStandNeu, beiVerbunden });
  return { schliessen: k.schliessen, ende: k.ende };
}

// „Vault öffnen …“ aus dem Wechsler: Ordner wählen, öffnen, ggf. Versionsverlauf anbieten. Löst nach Abschluss auf: {pfad} | null.
export async function oeffneOrdnerFlow({ beiFertig, beiStandNeu, beiVerbunden } = {}) {
  const pfad = await waehleOrdner(TW.ordner.dialogTitel);
  if (!pfad) return null;
  const k = await starteKarte({ modus: "ordner", beiFertig, beiStandNeu, beiVerbunden, anfang: { oeffnen: pfad } });
  return k.ende;
}
