// Einstieg ohne Vault: Willkommen-Karte (vier Wege), Name/Ort, Klonen, Versionsverlauf-Rückfrage, KI verbinden.
// Wird per dynamischem import() geladen und hat beim Import keine Nebenwirkungen.
import { h, dialog, speichereLokal, leseLokal, arbeitBeginnt } from "./hilfen.js";
import { textfeld, knopf as baueKnopf, setzeLaedt, kiAuswahl } from "./bausteine.js";
import * as API from "./api.js";
import { symbol } from "./symbole.js";
import { kiLogoName, kiKatalog } from "./ki-logos.js";
import { markenLogo } from "./marken.js";
import { TW } from "./texte-willkommen.js";

const api = API.api;
const STANDARD_ORDNER = "~/Kortex";
const KI_GESEHEN = "ki-schritt-gesehen";
// „Kortex-Hinweise einschalten“ (POST /api/kit/hooks): die Werkstatt hat diese Route noch nicht. Der Knopf bleibt aus, bis es sie gibt.
const HINWEISE_VERFUEGBAR = false;

let zaehler = 0;
const nid = (p) => `${p}-${++zaehler}`;
const sicher = (fn) => { try { return Promise.resolve(fn()).catch(() => null); } catch { return Promise.resolve(null); } };
const kuerze = (t, max = 56) => (String(t).length > max ? `${String(t).slice(0, max - 1).trimEnd()}…` : String(t));
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

// ---------------------------------------------------------------- KI verbinden (Inhalt, wiederverwendbar)
// Die Wahl der KI ist der Baustein kiAuswahl (bausteine.js, Katalog: gemeinsam/ki-katalog.json): oben die gefundenen bzw. beliebten KIs als Karten,
// darunter „Weitere KIs anzeigen“. Gewählt werden können die KIs, bei denen sich Kortex selbst eintragen kann (`verbindbar`); mehrere gleichzeitig.
const VORWAHL = ["claude", "codex", "cursor"];

// Ergebnis von GET /api/ki/erkennen → { [id]: { gefunden, version } }. Neue Werkstatt: Feld `katalog`; ältere Antworten (und Testattrappen) nur mit agenten/programme/cursorDa.
export function erkennungAus(ki) {
  if (!ki) return {};
  if (Array.isArray(ki.katalog)) return Object.fromEntries(ki.katalog.filter((k) => k && typeof k.id === "string").map((k) => [k.id, { gefunden: k.gefunden === true, version: typeof k.version === "string" ? k.version : null }]));
  const agenten = Array.isArray(ki.agenten) ? ki.agenten.filter((a) => a && (a.pfad || a.version)) : [];
  const m = {};
  const agent = (id) => agenten.find((a) => a.id === id);
  for (const id of ["claude", "codex", "gemini", "opencode"]) if (agent(id)) m[id] = { gefunden: true, version: agent(id).version || null };
  if (agent("cursor-agent") || ki.cursorDa === true) m.cursor = { gefunden: true, version: agent("cursor-agent")?.version || null };
  for (const p of Array.isArray(ki.programme) ? ki.programme : []) if (p && p.gefunden && typeof p.id === "string") m[p.id] = { gefunden: true, version: typeof p.version === "string" ? p.version : null };
  return m;
}

async function ladeKiDaten() {
  const [ki, info, nz] = await Promise.all([sicher(() => api.kiErkennen()), sicher(() => api.info()), sicher(() => api.notizen())]);
  return { erkannt: !!ki, erkennung: erkennungAus(ki), info, notizen: Array.isArray(nz?.notizen) ? nz.notizen : null };
}

// Vorgewählt: Claude Code, wenn vorhanden (oder wenn die Erkennung selbst nicht antwortet); sonst die erste gefundene KI, die sich verbinden lässt.
function vorwahl(d) {
  if (!d.erkannt) return ["claude"];
  const da = (id) => d.erkennung[id]?.gefunden === true;
  if (da("claude")) return ["claude"];
  const erste = kiKatalog().find((e) => e.verbindbar && da(e.id));
  return erste ? [erste.id] : [];
}

const namenListe = (namen) => (namen.length <= 1 ? namen.join("") : `${namen.slice(0, -1).join(", ")} und ${namen[namen.length - 1]}`);

// Ein Bereich mit Live-Region für Ergebnis/Fehler unter einer Aktion.
function meldeZone() {
  const knoten = h("div", { klasse: "w-aktion-unten", "aria-live": "polite" });
  return {
    knoten,
    leer: () => knoten.replaceChildren(),
    arbeit: (text) => knoten.replaceChildren(h("div", { klasse: "w-arbeit links" }, spinner(), h("span", { text }))),
    fehler: (text) => knoten.replaceChildren(h("div", { klasse: "w-fehlerbox fehlertext", role: "alert" }, symbol("warnung", 14), h("span", { text }))),
  };
}

function baueKiInhalt({ kompakt = false, beiVerbunden } = {}) {
  const titelId = nid("w-t");
  const titel = h("h2", { klasse: "w-titel", id: titelId, text: TW.ki.titel });
  const text = h("p", { klasse: "w-untertitel", text: TW.ki.text });
  const kachel = h("div", { klasse: "w-kachel-gross ton-grau" }, symbol("stecker", 24));
  const kopf = kompakt ? null : h("header", { klasse: "w-ki-kopf" }, kachel, titel, text);
  const inhalt = h("div", { klasse: "w-ki-inhalt" },
    h("div", { klasse: "w-laedt", role: "status" }, spinner(), h("span", { text: TW.ki.sucheLaeuft })));
  const wurzel = h("div", { klasse: "w-ki" + (kompakt ? " kompakt" : ""), "data-bereich": "ki" }, kopf, inhalt);

  ladeKiDaten().then((d) => {
    const hatAgenten = Object.values(d.erkennung).some((x) => x.gefunden);
    if (kopf) {
      kachel.className = `w-kachel-gross ${hatAgenten ? "ton-gruen" : "ton-grau"}`;
      kachel.replaceChildren(symbol(hatAgenten ? "kreis-haken" : "stecker", 24));
      titel.textContent = hatAgenten ? TW.ki.titel : TW.ki.titelOptional;
      text.textContent = hatAgenten ? TW.ki.text : TW.ki.textOptional;
    }
    const teile = [];
    const claudeDa = d.erkannt ? d.erkennung.claude?.gefunden === true : true;
    const verbinden = baueVerbinden({ beiVerbunden, erkennung: d.erkennung, vorgewaehlt: vorwahl(d) });
    teile.push(verbinden.auswahl.el);
    const zeilen = [verbinden];
    if (HINWEISE_VERFUEGBAR && claudeDa && d.info?.kit?.vorhanden) zeilen.push(baueHinweise());
    if (claudeDa || hatAgenten) zeilen.push(baueProbe(d.notizen));
    teile.push(h("div", { klasse: "w-gruppe", "data-gruppe": "aktionen" }, zeilen.map((x) => x.knoten)));
    inhalt.replaceChildren(...teile);
  });

  return { knoten: wurzel, titelId };
}

// Erfolg: der Beschreibungstext der Zeile wird zur Bestätigung (Häkchen + Satz), Live-Region meldet es.
function zeigeOk(beschreibung, zone, text) {
  zone.leer();
  beschreibung.replaceChildren(h("div", { klasse: "w-ok" }, symbol("kreis-haken", 14), h("span", { text })));
}

// beiVerbunden: wird erst nach geglücktem Verbinden mit Claude gerufen (200, auch { schonVerbunden: true }), nie beim bloßen Schließen.
// Danach läuft automatisch der Selbsttest. Er prüft nur unseren Server, nicht ob die fremde App ihn schon geladen hat.
// Mehrere gewählte KIs werden nacheinander verbunden; was nicht klappt (Rückfrage „umstellen?“, Befehl zum Kopieren, Fehler), steht je KI darunter,
// die übrigen sind trotzdem verbunden. Ein erneuter Klick ist unschädlich (schon Verbundenes meldet 200).
function baueVerbinden({ beiVerbunden, erkennung = {}, vorgewaehlt = [] } = {}) {
  const zone = meldeZone();
  let sel = [...vorgewaehlt];
  const name = (id) => kiLogoName(id) || id;
  const namen = () => sel.map(name);
  const ok = new Set(), probleme = new Map(); // ok: verbundene ids, probleme: id → Fehler dieses Laufs
  let gesperrt = false; // während des Selbsttests bleibt die Auswahl stehen, sonst stimmt der App-Name im Ergebnis nicht
  const knopf = baueKnopf({ variante: "primaer", aktion: "claude-verbinden" });
  const beschreibung = h("div", { klasse: "w-aktion-text", "aria-live": "polite" });
  const auswahl = kiAuswahl({ erkennung, wert: sel, mehrfach: true, waehlbar: (e) => e.verbindbar, daten: { "data-bereich": "ziel-wahl" },
    aufAenderung: (ids) => { if (gesperrt || knopf.getAttribute("aria-busy") === "true") { auswahl.setzeWert(sel); return; } sel = ids; ok.clear(); probleme.clear(); zone.leer(); zeichneKnopf(); } });

  function zeichneKnopf() {
    knopf.className = "knopf bs-knopf primaer";
    knopf.disabled = sel.length === 0;
    const label = sel.length === 0 ? TW.ki.verbindenLeer : sel.length === 1 ? TW.ki.verbindenMit(name(sel[0])) : TW.ki.verbindenMehrere(sel.length);
    knopf.replaceChildren(document.createTextNode(label));
    const fehlend = sel.filter((id) => erkennung[id]?.gefunden !== true && Object.keys(erkennung).length > 0);
    const text = sel.length === 0 ? TW.ki.waehleEine : sel.length === 1 ? TW.ki.verbindenTextFuer(name(sel[0])) : TW.ki.verbindenTextMehrere(namenListe(namen()));
    beschreibung.replaceChildren(document.createTextNode(text + (fehlend.length ? " " + TW.ki.nichtInstalliert(namenListe(fehlend.map(name))) : "")));
  }

  async function selbsttest(appName) {
    gesperrt = true; auswahl.sperre(true);
    zone.arbeit(TW.ki.selbsttestLaeuft);
    try {
      const r = await api.mcpSelbsttest();
      const n = Array.isArray(r?.werkzeuge) ? r.werkzeuge.length : 0;
      zone.knoten.replaceChildren(h("div", { klasse: "w-ergebnis", "data-bereich": "selbsttest" }, symbol("kreis-haken", 14),
        h("span", { text: TW.ki.selbsttestOk(n, appName) })));
    } catch (e) {
      zone.knoten.replaceChildren(h("div", { klasse: "w-fehlerbox fehlertext", role: "alert", "data-bereich": "selbsttest" }, symbol("warnung", 14), h("span", { text: TW.ki.selbsttestFehlt(meldungVon(e)) })));
    } finally { gesperrt = false; auswahl.sperre(false); }
  }
  async function erfolg(ids) {
    setzeLaedt(knopf, false);
    knopf.className = "knopf bs-knopf fertig";
    knopf.replaceChildren(symbol("haken", 14), TW.ki.verbundenKnopf);
    const ns = ids.map(name);
    beschreibung.replaceChildren(h("div", { klasse: "w-ok" }, symbol("kreis-haken", 14),
      h("span", { text: ids.length === 1 ? (ids[0] === "claude" ? TW.ki.verbunden : TW.ki.verbundenFuer(ns[0])) : TW.ki.verbundenMehrere(namenListe(ns)) })));
    if (ids.includes("claude")) { try { beiVerbunden?.(); } catch (e) { console.error(e); } }
    await selbsttest(namenListe(ns));
  }

  // Ein Problem je KI: Rückfrage (es gibt schon einen Eintrag „brain“, der woanders hinzeigt: 409 art „anders“), Befehl zum Kopieren oder Fehlertext.
  function problemBlock(id, e) {
    const befehl = typeof e?.daten?.befehl === "string" ? e.daten.befehl : null;
    if (e?.status === 409 && e?.daten?.art === "anders") {
      const nein = baueKnopf({ text: TW.ki.nichtUmstellen, aktion: "nicht-umstellen" });
      const ja = baueKnopf({ text: TW.ki.umstellen, variante: "primaer", aktion: "umstellen" });
      nein.addEventListener("click", () => { probleme.delete(id); zeichneProbleme(); knopf.focus(); });
      ja.addEventListener("click", () => lauf([id], new Set([id])));
      const t = id === "codex" ? TW.ki.codexAnders : id === "cursor" ? TW.ki.cursorAnders : id === "claude" ? TW.ki.anders : TW.ki.andersFuer(name(id));
      setTimeout(() => nein.focus(), 0);
      return h("div", { klasse: "w-frage", "data-bereich": "umstellen", "data-ziel": id, role: "group" }, h("div", { klasse: "w-aktion-text", text: t }), h("div", { klasse: "w-frage-knoepfe" }, nein, ja));
    }
    if (befehl) {
      const kaputt = e?.daten?.art === "kaputt" ? [h("div", { klasse: "w-fehlerbox fehlertext", role: "alert" }, symbol("warnung", 14), h("span", { text: e.message }))] : [];
      return h("div", { "data-ziel": id }, ...kaputt, befehlBlock(befehl, id === "cursor" ? TW.ki.cursorKaputt : id !== "claude" && id !== "codex" ? TW.ki.kaputtFuer(name(id)) : undefined));
    }
    return h("div", { klasse: "w-fehlerbox fehlertext", role: "alert", "data-ziel": id }, symbol("warnung", 14), h("span", { text: sel.length > 1 ? `${name(id)}: ${meldungVon(e)}` : meldungVon(e) }));
  }
  function zeichneProbleme() {
    if (!probleme.size) { zone.leer(); return; }
    const teile = [];
    if (ok.size && sel.length > 1) teile.push(h("div", { klasse: "w-ok", "data-bereich": "teil-ok" }, symbol("kreis-haken", 14), h("span", { text: TW.ki.teilVerbunden(namenListe([...ok].map(name))) })));
    for (const [id, e] of probleme) teile.push(problemBlock(id, e));
    zone.knoten.replaceChildren(...teile);
  }

  // ids der Reihe nach verbinden; `umstellen`: ids, bei denen der vorhandene Eintrag ersetzt werden soll
  async function lauf(ids, umstellen = new Set()) {
    setzeLaedt(knopf, true);
    gesperrt = true; auswahl.sperre(true);
    zone.arbeit(TW.ki.verbindet);
    for (const id of ids) {
      try {
        await api.mcpVerbinden({ ziel: id, ...(umstellen.has(id) ? { umstellen: true } : {}) });
        ok.add(id); probleme.delete(id);
      } catch (e) { ok.delete(id); probleme.set(id, e); }
    }
    gesperrt = false; auswahl.sperre(false);
    setzeLaedt(knopf, false);
    if (!probleme.size && sel.every((id) => ok.has(id))) { await erfolg(sel.slice()); return; }
    zeichneProbleme();
    if (!document.activeElement || document.activeElement === document.body) knopf.focus();
  }
  knopf.addEventListener("click", () => { if (!sel.length) return; ok.clear(); probleme.clear(); lauf(sel.slice()); });
  zeichneKnopf();
  return { knoten: h("div", { klasse: "w-aktion", "data-zeile": "verbinden" }, beschreibung, knopf, zone.knoten), knopf, auswahl };
}

function befehlBlock(befehl, hinweis = TW.ki.befehl) {
  const meld = h("div", { klasse: "mini", "aria-live": "polite" });
  const kopieren = baueKnopf({ aktion: "befehl-kopieren", kinder: [symbol("kopieren", 14), TW.ki.befehlKopieren] });
  kopieren.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(befehl); meld.textContent = TW.ki.befehlKopiert; }
    catch { meld.textContent = TW.ki.kopierFehler; }
  });
  return h("div", { "data-bereich": "befehl" },
    h("div", { klasse: "w-aktion-text", text: hinweis }),
    h("div", { klasse: "w-befehl" }, h("code", { text: befehl, tabindex: "0" }), kopieren),
    meld);
}

function baueHinweise() {
  const zone = meldeZone();
  const knopf = baueKnopf({ text: TW.ki.hinweise, aktion: "hinweise-einschalten" });
  const beschreibung = h("div", { klasse: "w-aktion-text", "aria-live": "polite", text: TW.ki.hinweiseText });
  knopf.addEventListener("click", async () => {
    setzeLaedt(knopf, true);
    zone.arbeit(TW.ki.hinweiseLaeuft);
    try {
      await api.kitHooks();
      setzeLaedt(knopf, false);
      knopf.className = "knopf bs-knopf fertig";
      knopf.replaceChildren(symbol("haken", 14), TW.ki.hinweiseKnopfOk);
      zeigeOk(beschreibung, zone, TW.ki.hinweiseOk);
    } catch (e) {
      setzeLaedt(knopf, false);
      zone.fehler(meldungVon(e));
    }
  });
  return { knoten: h("div", { klasse: "w-aktion", "data-zeile": "hinweise" }, beschreibung, knopf, zone.knoten), knopf };
}

function baueProbe(notizen) {
  const zone = meldeZone();
  const frage = (notizen?.find((n) => n?.titel)?.titel) || TW.ki.probeStandard;
  const knopf = baueKnopf({ text: TW.ki.probeKnopf, aktion: "probe" });
  knopf.addEventListener("click", async () => {
    if (notizen && notizen.length === 0) {
      zone.knoten.replaceChildren(h("div", { klasse: "w-ergebnis leer", "data-bereich": "probe-ergebnis" }, TW.ki.probeLeer));
      return;
    }
    setzeLaedt(knopf, true);
    zone.arbeit(TW.ki.probeLaeuft);
    try {
      const r = await api.probe(frage);
      const treffer = Array.isArray(r?.treffer) ? r.treffer : [];
      if (!treffer.length) zone.knoten.replaceChildren(h("div", { klasse: "w-ergebnis leer", "data-bereich": "probe-ergebnis" }, TW.ki.probeKeine));
      else zone.knoten.replaceChildren(h("div", { klasse: "w-ergebnis", "data-bereich": "probe-ergebnis" },
        h("div", { klasse: "w-ergebnis-titel" }, symbol("kreis-haken", 14), h("span", { text: TW.ki.probeTitel(treffer.length) })),
        h("ul", null, treffer.slice(0, 3).map((t) => h("li", null, symbol("notiz", 14), h("span", { text: t.titel || t.pfad || "" }))))));
    } catch (e) { zone.fehler(meldungVon(e)); }
    finally { setzeLaedt(knopf, false); }
  });
  const text = h("div", { klasse: "w-aktion-text", text: TW.ki.probeText(kuerze(frage)) });
  return { knoten: h("div", { klasse: "w-aktion", "data-zeile": "probe" }, text, knopf, zone.knoten), knopf };
}

// beiFertig: beim Schließen des Dialogs (egal wie). beiVerbunden: nur nach geglücktem Verbinden mit Claude.
export async function oeffneKiDialog({ beiFertig, beiVerbunden } = {}) {
  await ladeStil();
  const ki = baueKiInhalt({ kompakt: true, beiVerbunden });
  const fertig = baueKnopf({ text: TW.ki.fertig, variante: "primaer", aktion: "ki-fertig" });
  const d = dialog({ titel: TW.ki.dialogTitel, rumpf: ki.knoten, knoepfe: [fertig], breit: true, beiSchliessen: () => { try { beiFertig?.({}); } catch (e) { console.error(e); } } });
  fertig.addEventListener("click", () => d.schliessen());
  return d;
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
  function schrittKi() {
    const ki = baueKiInhalt({ kompakt: false, beiVerbunden });
    const weiter = () => { speichereLokal(KI_GESEHEN, true); abschluss(); };
    const spaeter = baueKnopf({ text: TW.ki.spaeter, groesse: "l", aktion: "ki-spaeter", aufKlick: weiter });
    const fertig = baueKnopf({ text: TW.ki.weiter, variante: "primaer", groesse: "l", aktion: "ki-weiter", aufKlick: weiter });
    return {
      name: "ki", titelId: ki.titelId, meldung: null,
      knoten: h("div", null, ki.knoten, h("div", { klasse: "w-fuss-knoepfe" }, spaeter, fertig)),
      fokus: () => fertig.focus(),
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
