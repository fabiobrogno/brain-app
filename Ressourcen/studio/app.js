// Brain Studio v2 — Oberfläche. Vier Spalten: Seitenleiste · Notizliste · Editor · Eigenschaften, Statusleiste.
// Zustand, Navigation, Editor-Anbindung (verlustfrei), Speichern/Konflikt, Dialoge, Vault-Verwaltung.
import { T, PRODUKT } from "./texte.js";
import { api, aktion, aktionMitAntwort, inApp, gitGesperrt, andererVault, ausgangUnklar, zeitText as zeitFehlerText, ladeStandNeu } from "./api.js";
import { erstelleEditor } from "./editor.js";
import { h, dialog, dialogOffen, schliesseDialoge, toast, vorMinuten, dateiName, ohneEndung, ordnerVon, istBearbeitbar, speichereLokal, leseLokal, leseEntwurf, speichereEntwurf, sucheGrad, suchFormen, ausTabelle, arbeitBeginnt, laufendeArbeiten } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { diffAnsicht } from "./diff.js";
import { oeffneMenue, schliesseMenue } from "./menue.js";
import { baueAktionen, istZurueckgestellt, spaeterBis } from "./posteingang.js";
import { datumKurz, datumLang, datumZeit, istDatumText, bytesText, setzeTypFarbe, typSymbol, typName, wortAnzahl, relativ, pluralisiere, vorschauText, typTextFarbe } from "./format.js";

const $ = (id) => document.getElementById(id);
const MOD_META = /Mac|iPhone|iPad/.test(navigator.platform || "");

const S = {
  info: null, vaultListe: null,
  baum: [], eintraege: new Map(),            // Dateibaum (Wikilinks, Ordner)
  notizen: [], nMap: new Map(),              // Notiz-Index
  typen: [], typMap: new Map(), ansichten: [], ansichtMitglieder: {}, ansichtAusApi: false,
  sicht: { art: "bereich", id: "alle" }, vorVerlauf: null,
  sortierung: "geaendert",
  sichtListe: [], gerendert: 0,
  offen: new Set(), zu: new Set(), favoriten: new Set(),
  pfad: null, hash: null, schutz: false, dirty: false, konflikt: null, speichert: false, nochmal: false, bearbeitbar: true,
  pruef: new Map(), aktuellePruefung: null,
  git: null, gesundheit: null, rueckfragen: null, syncLaeuft: false, syncFehler: null, ki: null, kiVerbunden: false,
  zuletzt: [], suche: { aktiv: false, treffer: [], auswahl: 0, frage: "" },
  infoAn: leseLokal("infoAn", true), roh: leseLokal("roh", false), breit: leseLokal("breit", false), theme: leseLokal("theme", "system"),
  ladeNr: 0, bereit: false,
  zeigeZurueckgestellt: false,               // Posteingang: false = offene Notizen, true = die mit „Später“ zurückgestellten
};
const lokal = {
  k: (n) => n + "@" + (S.info?.vault || ""),
  lies: (n, f) => leseLokal(lokal.k(n), f),
  schreib: (n, v) => speichereLokal(lokal.k(n), v),
};

document.title = PRODUKT;
$("suche").placeholder = T.suche.platzhalter;
document.querySelector('[data-t="neu"]').textContent = T.seitenleiste.neu;
document.querySelector('[data-t="merken"]').textContent = T.seitenleiste.merken;
document.querySelectorAll("[data-sym]").forEach((el) => el.replaceWith(symbol(el.dataset.sym, 16)));
$("knopf-suche").replaceChildren(symbol("suche", 16));
$("knopf-neu").replaceChildren(symbol("plus", 16));
$("suche-zu").replaceChildren(symbol("schliessen", 12));
$("vault-pfeil").replaceChildren(symbol("chevron-auf-ab", 14));

// ======================================================= Erscheinungsbild
function wendeThemeAn() {
  const r = document.documentElement;
  if (S.theme === "hell") r.dataset.theme = "light"; else if (S.theme === "dunkel") r.dataset.theme = "dark"; else delete r.dataset.theme;
}
function setzeTheme(t) { S.theme = t; speichereLokal("theme", t); wendeThemeAn(); zeichneStatus(); }
const istDunkel = () => matchMedia("(prefers-color-scheme: dark)").matches ? S.theme !== "hell" : S.theme === "dunkel";
wendeThemeAn();

// ======================================================= Editor
let speicherTimer = null;
const ed = erstelleEditor($("editor"), {
  roh: () => S.roh,
  wikiAufloesen: (ziel) => loeseWikiAuf(ziel),
  wikiFarbe: (pfad) => { const n = S.nMap.get(pfad); const typ = n?.typ ? (S.typMap.get(n.typ) || { name: n.typ }) : null; return typ ? typTextFarbe(typ) : null; },
  wikiZiele: () => wikiZiele(),
  wikiOeffnen: (ziel) => { const d = loeseWikiAuf(ziel); if (d) oeffne(d); else toast(`„${ziel}“ gibt es noch nicht.`, { aktion: { text: "Anlegen", tun: () => legeWikiZielAn(ziel) } }); },
  speichernJetzt: () => { clearTimeout(speicherTimer); speichere(); },
  geaendert: () => {
    if (S.schutz || !S.bearbeitbar) return;
    S.dirty = true;
    if (S.konflikt) { zeigeStand("konflikt"); return; }
    zeigeStand("ungespeichert");
    clearTimeout(speicherTimer);
    speicherTimer = setTimeout(speichere, 800);
  },
});

// Wikilink-Auflösung: Pfad ohne Endung, sonst Dateiname (ohne Endung), Groß/klein egal
function dateien() { return S.baum.filter((e) => e.art === "datei" && istBearbeitbar(e.pfad)); }
let wikiIndex = null;
function wikiKarte() {
  if (wikiIndex) return wikiIndex;
  const nachPfad = new Map(), nachName = new Map();
  for (const d of dateien()) {
    nachPfad.set(ohneEndung(d.pfad).toLowerCase(), d.pfad);
    const n = ohneEndung(dateiName(d.pfad)).toLowerCase();
    if (!nachName.has(n)) nachName.set(n, d.pfad);
  }
  return (wikiIndex = { nachPfad, nachName });
}
function loeseWikiAuf(ziel) {
  const k = wikiKarte();
  const z = ziel.trim().replace(/\.md$/i, "").toLowerCase();
  return k.nachPfad.get(z) || k.nachName.get(z) || k.nachName.get(z.split("/").pop()) || null;
}
function wikiZiele() {
  const zaehler = new Map();
  const liste = dateien();
  for (const d of liste) { const n = ohneEndung(dateiName(d.pfad)); zaehler.set(n, (zaehler.get(n) || 0) + 1); }
  return liste.map((d) => {
    const n = ohneEndung(dateiName(d.pfad));
    return { name: zaehler.get(n) > 1 ? ohneEndung(d.pfad) : n, pfad: d.pfad, ordner: ordnerVon(d.pfad) };
  });
}
async function legeWikiZielAn(ziel) {
  try {
    const ordner = ordnerVon(S.pfad || "") || (S.baum.find((e) => e.pfad === "00_inbox") ? "00_inbox" : "");
    const r = await api.neu(ordner, ziel.split("/").pop());
    await ladeBaum();
    oeffne(r.pfad);
  } catch (e) { toast(e.message, { fehler: true }); }
}

// ======================================================= Datei öffnen / speichern
async function oeffne(pfad, { zeile, ausListe } = {}) {
  if (pfad === S.pfad) { schliesseDiff(); if (zeile) ed.springeZu(zeile); else if (!ausListe) ed.fokus(); return true; }
  if (S.konflikt) { toast(`Löse zuerst den Konflikt in „${ohneEndung(dateiName(S.pfad))}“.`, { fehler: true }); return false; }
  const nr = ++S.ladeNr;
  // Erst sichern: gewechselt wird nur, wenn nichts verloren geht (K-1)
  if (!(await sichereVorWechsel())) return false;
  if (nr !== S.ladeNr || S.konflikt) return false;
  let d;
  try { d = await api.datei(pfad); }
  catch (e) { toast(e.status === 403 || e.status === 404 ? T.fehler.laden : e.message, { fehler: true }); return false; }
  if (nr !== S.ladeNr) return false;
  if (S.dirty) { // während des Ladens weitergetippt: nicht überschreiben
    clearTimeout(speicherTimer);
    if (!(await sichereVorWechsel()) || nr !== S.ladeNr) return false;
  }
  S.pfad = d.pfad; S.hash = d.hash; S.schutz = !!d.schreibschutz; S.dirty = false; S.konflikt = null;
  S.bearbeitbar = istBearbeitbar(d.pfad);
  S.aktuellePruefung = null;
  ed.setzeText(d.inhalt, { nurLesen: S.schutz || !S.bearbeitbar });
  ed.setzeSignale([]);
  schliesseDiff();
  $("leer").hidden = true; $("editor").hidden = false;
  zeigeBanner(); zeigeStand(S.schutz ? "schutz" : "gespeichert", true);
  zuletztMerken(d.pfad);
  klappeAuf(d.pfad);
  markiereAuswahl(); zeichnePfad(); zeichneWerkzeuge(); zeichneOrdner(); setzeFenstertitel();
  ladeInfo();
  if (zeile) ed.springeZu(zeile);
  else if (!ausListe && !document.querySelector(".schleier")) ed.fokus();
  lokal.schreib("pfad", d.pfad);
  return true;
}

// Speichern ist immer EINE laufende Promise; Aufrufer können sie abwarten.
let laufendesSpeichern = null, letzterFehler = null;
function speichere() {
  if (!S.pfad || S.schutz || !S.bearbeitbar || S.konflikt || !S.dirty) return laufendesSpeichern || Promise.resolve();
  if (laufendesSpeichern) { S.nochmal = true; return laufendesSpeichern; }
  laufendesSpeichern = speichereEinmal().finally(() => {
    laufendesSpeichern = null;
    if (S.nochmal) { S.nochmal = false; if (S.dirty && !S.konflikt && !letzterFehler) speichere(); }
  });
  return laufendesSpeichern;
}
async function speichereEinmal() {
  const pfad = S.pfad, text = ed.text();
  S.speichert = true; letzterFehler = null; zeigeStand("speichert");
  try {
    const r = await api.speichern(pfad, text, S.hash);
    if (S.pfad === pfad) {
      S.hash = r.hash;
      if (ed.text() === text) { S.dirty = false; zeigeStand("gespeichert"); } else zeigeStand("ungespeichert");
    }
    planeGitRefresh(); planeBaumRefresh();
  } catch (e) {
    if (e.status === 409 && S.pfad === pfad) { S.konflikt = { aktuellerHash: e.daten?.aktuellerHash || null }; zeigeBanner(); zeigeStand("konflikt"); }
    else {
      letzterFehler = e.message && e.message !== T.fehler.allgemein ? e.message : T.fehler.speichern;
      zeigeStand("fehler", false, letzterFehler);
    }
  } finally { S.speichert = false; }
}
// Wartet laufendes Speichern ab und speichert, bis nichts mehr offen ist. true = alles gesichert.
async function speichereAlles() {
  for (let i = 0; i < 8; i++) {
    while (laufendesSpeichern) await laufendesSpeichern;
    if (!S.dirty) return true;
    if (!S.pfad || S.schutz || !S.bearbeitbar || S.konflikt) return false;
    clearTimeout(speicherTimer);
    await speichere();
    if (letzterFehler) return false;
  }
  return !S.dirty;
}
// Vor jedem Dateiwechsel: gesichert oder bewusst verworfen. false = nicht wechseln.
async function sichereVorWechsel() {
  clearTimeout(speicherTimer);
  for (;;) {
    if (await speichereAlles()) return true;
    if (S.konflikt) { // nicht still abbrechen: sagen, warum der Wechsel nicht geht
      toast(T.konflikt.erstLoesen(S.nMap.get(S.pfad)?.titel || ohneEndung(dateiName(S.pfad || ""))), { fehler: true });
      return false;
    }
    const wahl = await fragSpeicherFehler();
    if (wahl === "verwerfen") { clearTimeout(speicherTimer); S.dirty = false; return true; }
    if (wahl !== "nochmal") return false;
  }
}
function fragSpeicherFehler() {
  return new Promise((fertig) => {
    let wahl = null;
    const zu = (w) => { wahl = w; d.schliessen(); };
    const d = dialog({
      titel: T.speicherFehler.titel,
      rumpf: [h("p", { text: letzterFehler || T.speicherFehler.text }), h("p", { klasse: "leise", text: T.speicherFehler.text })],
      knoepfe: [
        h("button", { klasse: "knopf", "data-aktion": "verwerfen", text: T.speicherFehler.verwerfen, aufClick: () => zu("verwerfen") }),
        h("button", { klasse: "knopf", "data-aktion": "kopieren", text: T.speicherFehler.kopieren, aufClick: async () => {
          try { await navigator.clipboard.writeText(ed.text()); toast(T.speicherFehler.kopiert); } catch { toast(T.speicherFehler.kopierFehler, { fehler: true }); } } }),
        h("button", { klasse: "knopf primaer", "data-aktion": "nochmal", text: T.speicherFehler.nochmal, aufClick: () => zu("nochmal") }),
      ],
      beiSchliessen: () => fertig(wahl),
    });
    d.box.setAttribute("data-dialog", "speicherfehler");
  });
}

async function konfliktNeuLaden() {
  const pfad = S.pfad;
  try {
    const d = await api.datei(pfad);
    S.hash = d.hash; S.konflikt = null; S.dirty = false;
    ed.setzeText(d.inhalt, { nurLesen: !!d.schreibschutz });
    zeigeBanner(); zeigeStand("gespeichert"); ladeInfo();
  } catch (e) { toast(e.message, { fehler: true }); }
}
function konfliktBehalten() {
  if (S.konflikt?.aktuellerHash) S.hash = S.konflikt.aktuellerHash;
  S.konflikt = null; S.dirty = true; zeigeBanner(); speichere();
}

function zeigeStand(art, still, text) {
  const e = $("speicherstand");
  e.className = "speicherstand" + (art === "fehler" || art === "konflikt" ? " fehler" : "");
  e.dataset.zustand = art;
  e.textContent = art === "gespeichert" ? T.editor.gespeichert : art === "speichert" ? T.editor.speichert : art === "ungespeichert" ? T.editor.ungespeichert
    : art === "konflikt" ? T.editor.ungespeichert : art === "fehler" ? (text || T.fehler.speichern) : "";
  if (art === "fehler") e.title = e.textContent;
}

function zeigeBanner() {
  const host = $("banner-host");
  host.replaceChildren();
  if (!S.pfad) return;
  if (S.konflikt) {
    host.append(h("div", { klasse: "banner warn", role: "alert", "data-banner": "konflikt" },
      h("div", { klasse: "b-text" }, h("div", { klasse: "b-titel", text: T.konflikt.titel }), h("div", { klasse: "b-sub", text: T.konflikt.text })),
      h("button", { klasse: "knopf", text: T.konflikt.neuLaden, aufClick: konfliktNeuLaden, "data-aktion": "neu-laden" }),
      h("button", { klasse: "knopf primaer", text: T.konflikt.behalten, aufClick: konfliktBehalten, "data-aktion": "behalten" })));
  } else if (S.schutz) {
    host.append(h("div", { klasse: "banner schutz", "data-banner": "schutz" }, symbol("schild", 14), h("span", { text: T.editor.schreibschutz })));
  } else if (!S.bearbeitbar) {
    host.append(h("div", { klasse: "banner schutz" }, h("span", { text: T.editor.nichtBearbeitbar })));
  }
}

function setzeFenstertitel() {
  const n = S.pfad ? S.nMap.get(S.pfad) : null;
  const name = S.info?.name || PRODUKT;
  const titel = n ? `${n.titel || ohneEndung(dateiName(S.pfad))} — ${name}` : name;
  document.title = titel;
  aktion("titel", titel);
}

// ======================================================= Index (Notizen, Typen, Ansichten)
// Wie der Werkstatt-Index: _-Ordner im Posteingang sind maschinell, Vorlagen und Agenten-Anweisungen in der Wurzel keine Notizen
const bereichVonPfad = (p) => (/^90_/.test(p) ? "archiv" : /^00_inbox\/_/.test(p) ? "maschine" : p.startsWith("01_vorlagen/") ? "vorlage"
  : /^(claude|agents|gemini)\.md$/i.test(p) ? "system" : p.startsWith("00_inbox/") ? "inbox" : p.startsWith("09_wiki/") ? "wissen" : "notiz");
const SICHTBAR = new Set(["inbox", "notiz", "wissen"]); // erscheinen in „Alle Notizen“, Typen und Ansichten
const istNotiz = (n) => SICHTBAR.has(n.bereich) && !n.generiert;
function notizenAusBaum() {
  return dateien().map((e) => ({
    pfad: e.pfad, titel: e.titel || ohneEndung(dateiName(e.pfad)), vorschau: "", typ: null, bereich: bereichVonPfad(e.pfad),
    geaendert: e.geaendert, erstellt: null, stufe: "grau", links: [], felder: {}, generiert: !!e.schreibschutz,
  }));
}
function typenAusNotizen() {
  const m = new Map();
  for (const n of S.notizen) if (n.typ && istNotiz(n)) m.set(n.typ, (m.get(n.typ) || 0) + 1);
  return [...m].map(([name, anzahl]) => ({ name, anzahl, farbe: null, symbol: "notiz" })).sort((a, b) => b.anzahl - a.anzahl);
}
const neuesteZuerst = (a, b) => (Date.parse(b.geaendert) || 0) - (Date.parse(a.geaendert) || 0);
function leiteAnsichtenAb(apiAnsichten) {
  const heute = new Date().toLocaleDateString("sv-SE");
  const basis = S.notizen.filter(istNotiz);
  const abgelaufen = (n) => [n.felder?.pruefen_bis, n.felder?.verfall].some((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) < heute);
  S.ansichtMitglieder = {
    abgelaufen: basis.filter((n) => n.bereich === "wissen" && abgelaufen(n)),
    strittig: basis.filter((n) => n.stufe === "rot"),
    ungeprueft: basis.filter((n) => n.bereich === "wissen" && n.stufe === "gelb" && !abgelaufen(n)),
    zuletzt: [...basis].sort(neuesteZuerst).slice(0, 25),
  };
  // Trägt jede Notiz ihre Ansichten selbst (Feld `ansichten`, so liefert es der Werkstatt-Index), gilt das und nicht die Ableitung
  if (S.notizen.some((n) => Array.isArray(n.ansichten))) {
    for (const id of Object.keys(S.ansichtMitglieder)) S.ansichtMitglieder[id] = S.notizen.filter((n) => istNotiz(n) && Array.isArray(n.ansichten) && n.ansichten.includes(id));
  }
  // Liefert die Schnittstelle selbst Mitglieder (pfade), gelten diese
  S.ansichtAusApi = false;
  for (const a of apiAnsichten || []) {
    if (Array.isArray(a.pfade)) { S.ansichtMitglieder[a.id] = a.pfade.map((p) => S.nMap.get(p)).filter(Boolean); S.ansichtAusApi = true; }
  }
}
async function ladeIndex() {
  const [n, t, a] = await Promise.allSettled([api.notizen(), api.typen(), api.ansichten()]);
  S.notizen = n.status === "fulfilled" && Array.isArray(n.value?.notizen) ? n.value.notizen : notizenAusBaum();
  S.nMap = new Map(S.notizen.map((x) => [x.pfad, x]));
  S.typen = t.status === "fulfilled" && Array.isArray(t.value?.typen) ? t.value.typen : typenAusNotizen();
  S.typMap = new Map(S.typen.map((x) => [x.name, x]));
  S.ansichten = a.status === "fulfilled" && Array.isArray(a.value?.ansichten) ? a.value.ansichten : [];
  leiteAnsichtenAb(S.ansichten);
}
async function ladeBaum() {
  try {
    const r = await api.baum();
    S.baum = r.eintraege || [];
    S.eintraege = new Map(S.baum.map((e) => [e.pfad, e]));
    wikiIndex = null;
  } catch (e) { toast(e.message, { fehler: true }); return; }
  await ladeIndex();
  // Nur neu zeichnen, wenn sich am Index etwas geändert hat (Fokuswechsel und Speichern lassen die Liste sonst flackern)
  const sig = S.notizen.length + ":" + S.notizen.map((n) => `${n.pfad}|${n.geaendert}|${n.titel}|${n.stufe}|${n.typ}|${n.felder?.spaeter_bis || ""}`).join(";") + "#" + S.baum.length;
  const geaendert = sig !== S.sig; S.sig = sig;
  if (geaendert) { zeichneSeite(); if (S.sicht.art !== "verlauf") zeichneListe({ behalte: true }); zeichnePfad(); }
  zeichneStatus(); zeigeLeer();
}

// ======================================================= Sicht (Seitenleiste → Liste)
const BEREICHE = [
  ["inbox", "inbox"], ["rueckfragen", "info"], ["alle", "notiz"], ["wissen", "buch"], ["archiv", "archiv"],
];
const ANSICHTEN = ["abgelaufen", "strittig", "ungeprueft", "zuletzt"];
const gleicheSicht = (a, b) => a.art === b.art && (a.id ?? null) === (b.id ?? null);
function waehleSicht(sicht, { merken = true } = {}) {
  if (S.sicht.art !== "verlauf" || sicht.art !== "verlauf") { /* weiter */ }
  if (sicht.art !== "verlauf") S.vorVerlauf = null;
  schliesseSuche(false);
  if (!gleicheSicht(S.sicht, sicht)) S.zeigeZurueckgestellt = false;
  S.sicht = sicht;
  if (merken && sicht.art !== "verlauf") lokal.schreib("sicht", sicht);
  $("app").dataset.modus = sicht.art === "verlauf" ? "verlauf" : "liste";
  zeichneSeite(); zeichneListe();
  $("liste-koerper").scrollTop = 0;
}
function zaehler() {
  const z = { inbox: 0, alle: 0, wissen: 0, archiv: 0 };
  for (const n of S.notizen) {
    if (n.bereich === "archiv") z.archiv++;
    else if (istNotiz(n)) { z.alle++; if (n.bereich === "inbox" && !istZurueckgestellt(n)) z.inbox++; if (n.bereich === "wissen") z.wissen++; }
  }
  return z;
}
function sichtNotizen() {
  const { art, id } = S.sicht;
  const l = S.notizen;
  if (art === "bereich") {
    if (id === "inbox") return l.filter((n) => n.bereich === "inbox" && !n.generiert && istZurueckgestellt(n) === S.zeigeZurueckgestellt);
    if (id === "alle") return l.filter(istNotiz);
    if (id === "wissen") return l.filter((n) => n.bereich === "wissen" && !n.generiert);
    if (id === "archiv") return l.filter((n) => n.bereich === "archiv");
  }
  if (art === "ansicht") return S.ansichtMitglieder[id] || [];
  if (art === "typ") return l.filter((n) => n.typ === id && istNotiz(n));
  if (art === "ordner") return l.filter((n) => n.pfad.startsWith(id + "/"));
  if (art === "favoriten") return l.filter((n) => S.favoriten.has(n.pfad));
  return l;
}
function sortiere(liste) {
  const k = S.sortierung;
  const a = [...liste];
  if (k === "titel") a.sort((x, y) => (x.titel || "").localeCompare(y.titel || "", "de", { numeric: true, sensitivity: "base" }));
  else if (k === "erstellt") a.sort((x, y) => (Date.parse(y.erstellt) || 0) - (Date.parse(x.erstellt) || 0) || neuesteZuerst(x, y));
  else a.sort(neuesteZuerst);
  return a;
}
function sichtTitel() {
  const { art, id } = S.sicht;
  if (S.suche.aktiv) return { text: T.liste.suchergebnisse, symbol: "suche" };
  if (art === "bereich") return { text: T.bereiche[id], symbol: BEREICHE.find((b) => b[0] === id)?.[1] };
  if (art === "ansicht") return { text: T.ansichten[id], symbol: "filter" };
  if (art === "typ") return { text: typName(id), symbol: typSymbol(S.typMap.get(id)?.symbol) };
  if (art === "ordner") return { text: dateiName(id), symbol: "ordner" };
  if (art === "favoriten") return { text: T.abschnitte.favoriten, symbol: "stern" };
  if (art === "verlauf") return { text: T.liste.verlauf, symbol: "verlauf" };
  return { text: "", symbol: null };
}

// ======================================================= Seitenleiste
function abschnitt(id, titel, inhalt, { zaehlerText } = {}) {
  const sec = document.querySelector(`[data-abschnitt="${id}"]`);
  sec.dataset.zu = String(S.zu.has(id));
  sec.replaceChildren(
    h("div", { klasse: "abschnitt-kopf" },
      h("button", { klasse: "abschnitt-titel", "aria-expanded": String(!S.zu.has(id)), "data-abschnitt-knopf": id, aufClick: () => {
        S.zu.has(id) ? S.zu.delete(id) : S.zu.add(id); lokal.schreib("zu", [...S.zu]); zeichneSeite(); } }, symbol("chevron-unten", 12), h("span", { text: titel }))),
    h("div", { klasse: "abschnitt-inhalt" }, inhalt));
}
function eintragEl({ id, data, symbolName, name, zahl, aktiv, typ, zahlKlasse, tun, titel }) {
  const el = h("button", { klasse: "eintrag", type: "button", ...data, "aria-current": aktiv ? "true" : "false", title: titel || null, aufClick: tun },
    symbol(symbolName, 16), h("span", { klasse: "name", text: name }), zahl !== undefined && zahl !== null ? h("span", { klasse: "zahl" + (zahlKlasse ? " " + zahlKlasse : ""), text: String(zahl) }) : null);
  return typ ? setzeTypFarbe(el, typ) : el;
}
function zeichneBereiche() {
  const z = zaehler();
  const rf = S.rueckfragen && S.rueckfragen.verfuegbar !== false && Number.isFinite(S.rueckfragen.offen) ? S.rueckfragen.offen : null;
  const zeilen = BEREICHE.filter(([id]) => id !== "rueckfragen" || rf !== null).map(([id, sym]) =>
    eintragEl({ data: { "data-bereich": id }, symbolName: sym, name: T.bereiche[id], zahl: id === "rueckfragen" ? rf : z[id], zahlKlasse: id === "rueckfragen" && rf ? "warn" : "",
      aktiv: S.sicht.art === "bereich" && S.sicht.id === id, tun: () => waehleSicht({ art: "bereich", id }) }));
  $("bereiche").replaceChildren(...zeilen);
}
function zeichneFavoriten() {
  const sec = $("favoriten-abschnitt");
  const n = S.notizen.filter((x) => S.favoriten.has(x.pfad)).length;
  sec.hidden = n === 0 && S.sicht.art !== "favoriten";
  if (sec.hidden) { sec.replaceChildren(); return; }
  abschnitt("favoriten", T.abschnitte.favoriten, [eintragEl({ data: { "data-ansicht": "favoriten" }, symbolName: "stern", name: T.abschnitte.favoriten, zahl: n, aktiv: S.sicht.art === "favoriten", tun: () => waehleSicht({ art: "favoriten" }) })]);
}
function zeichneAnsichten() {
  const zeilen = ANSICHTEN.map((id) => {
    const n = (S.ansichtMitglieder[id] || []).length;
    return eintragEl({ data: { "data-ansicht": id }, symbolName: id === "zuletzt" ? "uhr" : id === "strittig" ? "warnung" : id === "abgelaufen" ? "verlauf" : "filter",
      name: T.ansichten[id], zahl: n, zahlKlasse: (id === "strittig" || id === "abgelaufen") && n ? "warn" : "", titel: T.ansichtenHinweis[id],
      aktiv: S.sicht.art === "ansicht" && S.sicht.id === id, tun: () => waehleSicht({ art: "ansicht", id }) });
  });
  abschnitt("ansichten", T.abschnitte.ansichten, zeilen);
}
function zeichneTypen() {
  const zeilen = S.typen.length ? S.typen.map((t) =>
    eintragEl({ data: { "data-typ": t.name }, symbolName: typSymbol(t.symbol), name: typName(t.name), zahl: t.anzahl, typ: t, aktiv: S.sicht.art === "typ" && S.sicht.id === t.name, tun: () => waehleSicht({ art: "typ", id: t.name }) }))
    : [h("div", { klasse: "hinweis-leer", text: "Noch keine Typen. Gib einer Notiz im Datei-Kopf ein Feld „typ:“." })];
  abschnitt("typen", T.abschnitte.typen, zeilen);
}

// ---- Ordnerbaum (eingeklappt, nur Ordner)
function baueOrdnerBaum() {
  const wurzel = { pfad: "", kinder: [] };
  const knoten = new Map([["", wurzel]]);
  for (const e of S.baum) if (e.art === "ordner") {
    const k = { pfad: e.pfad, name: dateiName(e.pfad), kinder: [] };
    knoten.set(e.pfad, k);
  }
  for (const [p, k] of knoten) if (p) (knoten.get(ordnerVon(p)) || wurzel).kinder.push(k);
  const anzahl = new Map();
  for (const n of S.notizen) { let o = ordnerVon(n.pfad); while (o) { anzahl.set(o, (anzahl.get(o) || 0) + 1); o = ordnerVon(o); } }
  const sortiere = (k) => { k.kinder = k.kinder.filter((c) => anzahl.get(c.pfad)); k.kinder.sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true })); k.kinder.forEach(sortiere); };
  sortiere(wurzel);
  wurzel.kinder.sort((a, b) => Number(/^90_/.test(a.name)) - Number(/^90_/.test(b.name)) || a.name.localeCompare(b.name, "de", { numeric: true }));
  return { wurzel, anzahl };
}
function zeichneOrdner() {
  const { wurzel, anzahl } = baueOrdnerBaum();
  const zeilen = [];
  const tief = (k, t, archiv) => {
    for (const c of k.kinder) {
      const arch = archiv || (t === 0 && /^90_/.test(c.name));
      const offen = S.offen.has(c.pfad), hatKinder = c.kinder.length > 0;
      zeilen.push(h("div", { klasse: "zeile" + (arch ? " archiv" : ""), role: "treeitem", "aria-expanded": hatKinder ? String(offen) : null, "aria-current": S.sicht.art === "ordner" && S.sicht.id === c.pfad ? "true" : "false",
        style: `--tiefe:${t}`, "data-pfad": c.pfad, title: c.pfad, aufClick: () => waehleSicht({ art: "ordner", id: c.pfad }) },
        h("span", { klasse: "pfeil" + (offen ? " offen" : "") + (hatKinder ? "" : " leer"), role: "button", "aria-label": offen ? "Zuklappen" : "Aufklappen",
          aufClick: (ev) => { ev.stopPropagation(); offen ? S.offen.delete(c.pfad) : S.offen.add(c.pfad); lokal.schreib("offen", [...S.offen]); zeichneOrdner(); } }, symbol("chevron-rechts", 12)),
        (() => { const s = symbol(offen && hatKinder ? "ordner-offen" : "ordner", 16); s.classList.add("ordner-sym"); return s; })(),
        h("span", { klasse: "name", text: c.name }), h("span", { klasse: "dim", text: String(anzahl.get(c.pfad) || 0) })));
      if (offen) tief(c, t + 1, arch);
    }
  };
  tief(wurzel, 0, false);
  const baum = h("div", { id: "baum", klasse: "baum", role: "tree" }, zeilen.length ? zeilen : h("div", { klasse: "hinweis-leer", text: T.seitenleiste.leerBaum }));
  abschnitt("ordner", T.abschnitte.ordner, baum);
}
function klappeAuf(pfad) {
  let o = ordnerVon(pfad), geaendert = false;
  while (o) { if (!S.offen.has(o)) { S.offen.add(o); geaendert = true; } o = ordnerVon(o); }
  if (geaendert) { lokal.schreib("offen", [...S.offen]); }
}
function zeichneSeite() {
  zeichneBereiche(); zeichneFavoriten(); zeichneAnsichten(); zeichneTypen(); zeichneOrdner();
}

// ======================================================= Notizliste
function zeichneListenKopf() {
  const t = sichtTitel();
  $("liste-titel").replaceChildren(...(t.symbol ? [symbol(t.symbol, 16)] : []), h("span", { text: t.text }));
  const verlauf = S.sicht.art === "verlauf";
  $("knopf-sort").hidden = verlauf || S.suche.aktiv;
  $("knopf-suche").hidden = verlauf;
  $("knopf-neu").hidden = verlauf;
  const sk = $("knopf-sort");
  sk.replaceChildren(symbol("sortierung", 13), h("span", { text: T.sortierung[S.sortierung] }));
  let zu = document.getElementById("verlauf-zu");
  if (verlauf && !zu) { zu = h("button", { id: "verlauf-zu", klasse: "knopf-icon", title: "Verlauf schließen", "aria-label": "Verlauf schließen", aufClick: schliesseVerlauf }, symbol("schliessen", 14)); document.querySelector(".liste-werkzeuge").append(zu); }
  if (!verlauf) zu?.remove();
}
function leerZustand() {
  const { art, id } = S.sicht;
  const t = art === "favoriten" ? T.liste.leerFavoriten : art === "ansicht" ? T.liste.leerAnsicht : art === "bereich" && id === "inbox" ? T.liste.leerInbox : T.liste.leer;
  return h("div", { klasse: "leer-liste", "data-leer": "liste" }, h("div", { klasse: "zeichen" }, symbol(art === "ansicht" ? "kreis-haken" : "notiz", 22)), h("h3", { text: t.titel }), h("p", { text: t.text }),
    art === "bereich" && (id === "inbox" || id === "alle") ? h("button", { klasse: "knopf primaer", text: T.seitenleiste.neu, aufClick: () => oeffneNeu() }) : null,
    h("div", { klasse: "kurz" }, h("span", null, h("kbd", { text: "⌘K" }), "suchen"), h("span", null, h("kbd", { text: "⌘N" }), "neu")));
}
function baueKarte(n) {
  const typ = n.typ ? (S.typMap.get(n.typ) || { name: n.typ }) : null;
  const stufe = n.stufe && n.stufe !== "grau" ? n.stufe : null;
  const karte = h("div", { klasse: "karte" + (n.generiert ? " schutz" : "") + (n.bereich === "archiv" ? " archiv" : ""), role: "option", "data-karte": "", "data-pfad": n.pfad, title: n.pfad,
    "aria-selected": String(S.pfad === n.pfad),
    aufClick: () => oeffneAusListe(n.pfad) },
    h("div", { klasse: "karte-kopf" },
      h("div", { klasse: "karte-titel", text: n.titel || T.liste.ohneTitel }),
      h("div", { klasse: "karte-marken" },
        symbol(typ ? typSymbol(typ.symbol) : "notiz", 15),
        stufe ? h("span", { klasse: "punkt " + stufe, "data-punkt": n.pfad, title: T.stufen[stufe] || "" }) : null)),
    h("div", { klasse: "karte-vorschau", text: vorschauText(n.vorschau) }),
    h("div", { klasse: "karte-fuss" }, h("span", { text: datumKurz(n.geaendert) }),
      istZurueckgestellt(n) ? h("span", { klasse: "pe-marke", "data-spaeter": spaeterBis(n), text: T.posteingang.bis(datumKurz(spaeterBis(n))) }) : n.erstellt ? h("span", { text: `${T.liste.erstellt} ${datumKurz(n.erstellt)}` }) : null),
    n.bereich === "inbox" && !n.generiert && S.sicht.art === "bereich" && S.sicht.id === "inbox" ? baueAktionen(n, posteingangCtx) : null);
  return typ ? setzeTypFarbe(karte, typ) : karte;
}
const CHUNK = 120;
function rendereMehr(bis) {
  const host = $("liste-koerper");
  const ziel = Math.min(S.sichtListe.length, bis ?? S.gerendert + CHUNK);
  const frag = document.createDocumentFragment();
  for (let i = S.gerendert; i < ziel; i++) frag.append(baueKarte(S.sichtListe[i]));
  host.append(frag);
  S.gerendert = ziel;
}
let verlaufInst = null;
function zeichneListe({ behalte = false } = {}) {
  zeichneListenKopf();
  const host = $("liste-koerper");
  const scroll = behalte ? host.scrollTop : 0;
  if (S.sicht.art === "verlauf") { zeichneVerlauf(); return; }
  verlaufInst?.zerstoere?.(); verlaufInst = null;
  if (S.suche.aktiv) { zeichneSuchergebnisse(); return; }
  if (S.sicht.art === "bereich" && S.sicht.id === "rueckfragen") { zeichneRueckfragenKarte(); return; }
  S.sichtListe = sortiere(sichtNotizen());
  S.gerendert = 0;
  host.replaceChildren();
  const leiste = posteingangLeiste();
  if (leiste) host.append(leiste);
  if (!S.sichtListe.length) { host.append(S.zeigeZurueckgestellt ? h("div", { klasse: "leer-liste", "data-leer": "zurueckgestellt" }, h("p", { text: T.posteingang.leerZurueckgestellt })) : leerZustand()); return; }
  const bisAuswahl = S.pfad ? S.sichtListe.findIndex((n) => n.pfad === S.pfad) : -1;
  rendereMehr(Math.max(CHUNK, scroll ? Math.ceil((scroll + host.clientHeight) / 90) + 20 : 0, bisAuswahl >= 0 ? bisAuswahl + 5 : 0));
  host.scrollTop = scroll;
}
$("liste-koerper").addEventListener("scroll", (e) => {
  const el = e.currentTarget;
  if (S.gerendert < S.sichtListe.length && el.scrollTop + el.clientHeight > el.scrollHeight - 700 && !S.suche.aktiv && S.sicht.art !== "verlauf") rendereMehr();
}, { passive: true });
function markiereAuswahl() {
  const host = $("liste-koerper");
  let gefunden = null;
  host.querySelectorAll("[data-karte]").forEach((k) => { const an = k.dataset.pfad === S.pfad; k.setAttribute("aria-selected", String(an)); if (an) gefunden = k; });
  if (!gefunden && S.pfad && !S.suche.aktiv && S.sicht.art !== "verlauf") {
    const i = S.sichtListe.findIndex((n) => n.pfad === S.pfad);
    if (i >= S.gerendert) { rendereMehr(i + 10); gefunden = host.querySelector(`[data-karte][data-pfad="${CSS.escape(S.pfad)}"]`); if (gefunden) gefunden.setAttribute("aria-selected", "true"); }
  }
  gefunden?.scrollIntoView({ block: "nearest" });
}
let listenTimer = null;
function oeffneAusListe(pfad) {
  clearTimeout(listenTimer);
  listenTimer = setTimeout(() => oeffne(pfad, { ausListe: true }), 40);
  host_fokus();
}
const host_fokus = () => { if (!S.suche.aktiv) $("liste-koerper").focus({ preventScroll: true }); };
$("liste-koerper").addEventListener("keydown", (e) => {
  if (S.sicht.art === "verlauf") return;
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(e.key)) return;
  if (e.target.closest?.(".karte-aktionen, .pe-leiste")) return; // Enter/Pfeile gehören den Knöpfen dort
  const liste = S.suche.aktiv ? S.suche.treffer : S.sichtListe;
  if (!liste.length) return;
  e.preventDefault();
  if (e.key === "Enter") { if (S.pfad) ed.fokus(); return; }
  let i = liste.findIndex((n) => n.pfad === S.pfad);
  i = e.key === "Home" ? 0 : e.key === "End" ? liste.length - 1 : e.key === "ArrowDown" ? Math.min(liste.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
  if (i >= S.gerendert && !S.suche.aktiv) rendereMehr(i + 20);
  const p = liste[i].pfad;
  oeffneAusListe(p);
  const k = $("liste-koerper").querySelector(`[data-karte][data-pfad="${CSS.escape(p)}"]`);
  $("liste-koerper").querySelectorAll("[data-karte]").forEach((x) => x.setAttribute("aria-selected", String(x === k)));
  k?.scrollIntoView({ block: "nearest" });
});
// ---- Posteingang sichten (FBL-68/71): Leiste, Kontext für posteingang.js
function posteingangLeiste() {
  if (!(S.sicht.art === "bereich" && S.sicht.id === "inbox")) return null;
  const n = S.notizen.filter((x) => istZurueckgestellt(x)).length;
  if (!n && !S.zeigeZurueckgestellt) return null;
  return h("div", { klasse: "pe-leiste" },
    h("button", { klasse: "pe-schalter", type: "button", "data-aktion": "zurueckgestellt-umschalten", "aria-pressed": String(S.zeigeZurueckgestellt),
      text: S.zeigeZurueckgestellt ? T.posteingang.zurueckZumPosteingang : T.posteingang.zurueckgestellt(n),
      aufClick: () => { S.zeigeZurueckgestellt = !S.zeigeZurueckgestellt; zeichneListe(); } }));
}
// Datei schließen, wenn die Werkstatt sie verschoben hat
function schliesseDatei() {
  clearTimeout(speicherTimer);
  S.pfad = null; S.hash = null; S.dirty = false; S.konflikt = null; S.schutz = false; S.aktuellePruefung = null;
  ed.setzeText("", { nurLesen: false });
  zeigeBanner(); zeichnePfad(); zeichneWerkzeuge(); setzeFenstertitel(); ladeInfo(); zeigeLeer();
  lokal.schreib("pfad", null);
}
const posteingangCtx = {
  offenerPfad: () => S.pfad,
  sichereVorWechsel: () => sichereVorWechsel(),
  oeffne: (pfad) => oeffne(pfad),
  // Offene Datei während einer Werkstatt-Aktion schreibgeschützt halten; gibt die Freigabe zurück (tut nichts, wenn die Datei nicht offen ist)
  sperre: (pfad) => {
    if (S.pfad !== pfad || S.konflikt) return () => {};
    clearTimeout(speicherTimer);
    const vorher = S.schutz;
    S.schutz = true; ed.setzeText(ed.text(), { nurLesen: true });
    return () => { if (S.pfad === pfad) { S.schutz = vorher; ed.setzeText(ed.text(), { nurLesen: vorher || !S.bearbeitbar }); } };
  },
  // Wiki-Seiten, in die sich eine Notiz übernehmen lässt: Bereich Wissen, nicht generiert, keine Belege/Verwaltungsdateien
  wikiSeiten: () => S.notizen.filter((x) => x.bereich === "wissen" && !x.generiert && !/(^|\/)belege\//.test(x.pfad) && !dateiName(x.pfad).startsWith("_"))
    .map((x) => ({ pfad: x.pfad, titel: x.titel || ohneEndung(dateiName(x.pfad)) })).sort((a, b) => a.titel.localeCompare(b.titel, "de", { numeric: true, sensitivity: "base" })),
  wikiBereiche: () => S.baum.filter((e) => e.art === "ordner" && /^09_wiki\/[^/]+$/.test(e.pfad)).map((e) => dateiName(e.pfad)).filter((x) => !x.startsWith("_") && x.toLowerCase() !== "belege"),
  // Nach einer Aktion der Werkstatt: Datei im Editor schließen bzw. neu laden, Index und Versionsstand neu holen
  nachAktion: async ({ weg, neuLaden } = {}) => {
    if (weg && S.pfad === weg) schliesseDatei();
    await ladeBaum();
    if (S.pfad && (neuLaden || []).includes(S.pfad)) await konfliktNeuLaden();
    planeGitRefresh();
  },
};
function zeichneRueckfragenKarte() {
  const host = $("liste-koerper");
  const n = Number(S.rueckfragen?.offen) || 0;
  S.sichtListe = [];
  host.replaceChildren(h("div", { klasse: "leer-liste", "data-leer": "rueckfragen" }, h("div", { klasse: "zeichen" }, symbol("info", 22)), h("h3", { text: T.liste.rueckfragen.titel }),
    h("p", { text: n ? T.liste.rueckfragen.text(n) : "Keine offenen Fragen." }), h("p", { text: T.liste.rueckfragen.hinweis }),
    h("button", { klasse: "knopf", text: T.liste.rueckfragen.kopieren, aufClick: async () => { try { await navigator.clipboard.writeText("/rueckfragen"); toast(T.liste.rueckfragen.kopiert); } catch { /* ohne Zwischenablage */ } } })));
}

// ---- Sortierung
$("knopf-sort").addEventListener("click", (e) => {
  oeffneMenue(e.currentTarget, [{ gruppe: T.sortierung.menue }, ...["geaendert", "titel", "erstellt"].map((k) => ({ name: T.sortierung[k], haken: S.sortierung === k, id: k, tun: () => { S.sortierung = k; lokal.schreib("sort", k); zeichneListe(); $("liste-koerper").scrollTop = 0; } }))], { });
});

// ---- Suche im Vault (Liste)
let sucheTimer = null, sucheNr = 0;
const sucheEl = $("suche");
function oeffneSuche() {
  if (S.sicht.art === "verlauf") schliesseVerlauf();
  $("liste-suche").hidden = false; S.suche.aktiv = true;
  zeichneListenKopf();
  if (!S.suche.frage) $("liste-koerper").replaceChildren(h("div", { klasse: "hinweis-leer", text: "Tippe, um im ganzen Vault zu suchen." }));
  sucheEl.focus(); sucheEl.select();
}
function schliesseSuche(neuZeichnen = true) {
  clearTimeout(sucheTimer); sucheNr++;
  const war = S.suche.aktiv;
  S.suche = { aktiv: false, treffer: [], auswahl: 0, frage: "" };
  sucheEl.value = ""; $("liste-suche").hidden = true;
  if (war && neuZeichnen) zeichneListe();
}
$("knopf-suche").addEventListener("click", () => (S.suche.aktiv ? schliesseSuche() : oeffneSuche()));
$("suche-zu").addEventListener("click", () => schliesseSuche());
sucheEl.addEventListener("input", () => {
  clearTimeout(sucheTimer);
  const q = sucheEl.value.trim();
  S.suche.frage = q;
  if (!q) { S.suche.treffer = []; $("liste-koerper").replaceChildren(h("div", { klasse: "hinweis-leer", text: "Tippe, um im ganzen Vault zu suchen." })); return; }
  sucheTimer = setTimeout(async () => {
    const nr = ++sucheNr;
    try {
      const r = await api.suche(q);
      if (nr !== sucheNr) return;
      S.suche.treffer = r.treffer || []; S.suche.auswahl = 0;
      zeichneSuchergebnisse();
    } catch (e) { toast(e.message, { fehler: true }); }
  }, 180);
});
sucheEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { schliesseSuche(); $("liste-koerper").focus({ preventScroll: true }); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const n = S.suche.treffer.length;
    if (!n) return;
    e.preventDefault();
    S.suche.auswahl = (S.suche.auswahl + (e.key === "ArrowDown" ? 1 : n - 1)) % n; zeichneSuchergebnisse();
  } else if (e.key === "Enter") {
    const t = S.suche.treffer[S.suche.auswahl];
    if (t) oeffne(t.pfad, { zeile: t.zeile });
  }
});
function zeichneSuchergebnisse() {
  const host = $("liste-koerper");
  zeichneListenKopf();
  if (!S.suche.frage) return;
  if (!S.suche.treffer.length) { host.replaceChildren(h("div", { klasse: "leer-liste", "data-suche": "leer" }, h("div", { klasse: "zeichen" }, symbol("suche", 22)), h("h3", { text: T.liste.leerSuche.titel }), h("p", { text: T.liste.leerSuche.text }))); return; }
  host.replaceChildren(...S.suche.treffer.map((t, i) => {
    const n = S.nMap.get(t.pfad);
    const typ = n?.typ ? (S.typMap.get(n.typ) || { name: n.typ }) : null;
    const karte = h("div", { klasse: "karte", role: "option", "data-suche": "treffer", "data-karte": "", "data-pfad": t.pfad, "aria-selected": String(i === S.suche.auswahl), aufClick: () => oeffne(t.pfad, { zeile: t.zeile }) },
      h("div", { klasse: "karte-kopf" }, h("div", { klasse: "karte-titel", text: t.titel || ohneEndung(dateiName(t.pfad)) }), h("div", { klasse: "karte-marken" }, symbol(typ ? typSymbol(typ.symbol) : "notiz", 15))),
      t.auszug ? h("div", { klasse: "auszug", text: t.auszug }) : null, h("div", { klasse: "pfadzeile", text: t.pfad }));
    return typ ? setzeTypFarbe(karte, typ) : karte;
  }));
  host.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}
function fokusSuche() { oeffneSuche(); }

// ======================================================= Verlauf-Modus (Module: verlauf.js)
async function zeichneVerlauf() {
  const host = $("liste-koerper");
  verlaufInst?.zerstoere?.(); verlaufInst = null;
  host.replaceChildren(h("div", { klasse: "skelett" }, h("i"), h("i"), h("i")));
  try {
    const m = await import("./verlauf.js");
    if (S.sicht.art !== "verlauf") return;
    host.replaceChildren();
    verlaufInst = m.zeichneVerlauf(host, { api, beiDatei: zeigeDiff, beiGesperrt: oeffneVertrauen });
  } catch (e) {
    host.replaceChildren(h("div", { klasse: "leer-liste" }, h("div", { klasse: "zeichen" }, symbol("verlauf", 22)), h("h3", { text: T.liste.verlauf }), h("p", { text: "Der Verlauf ist gerade nicht verfügbar." })));
  }
}
function oeffneVerlauf() {
  if (S.sicht.art === "verlauf") { schliesseVerlauf(); return; }
  S.vorVerlauf = S.sicht;
  waehleSicht({ art: "verlauf" }, { merken: false });
  zeichneStatus();
}
function schliesseVerlauf() {
  schliesseDiff();
  const zurueck = S.vorVerlauf || { art: "bereich", id: "alle" };
  S.vorVerlauf = null;
  waehleSicht(zurueck);
  zeichneStatus();
}
let diffInst = null;
async function zeigeDiff(d) {
  const host = $("diff-host");
  diffInst?.zerstoere?.(); diffInst = null;
  host.hidden = false; host.replaceChildren();
  try {
    const m = await import("./verlauf.js");
    diffInst = m.zeigeDiff(host, { api, ...d, beiSchliessen: schliesseDiff, beiWiederherstellen: async ({ pfad, sha }) => {
      schliesseDiff();
      if (S.pfad !== pfad) { if (!(await oeffne(pfad, { ausListe: true }))) return; }
      await stelleWiederHer(pfad, sha);
    } });
  } catch { host.hidden = true; toast(T.fehler.allgemein, { fehler: true }); }
}
function schliesseDiff() { diffInst?.zerstoere?.(); diffInst = null; const host = $("diff-host"); host.hidden = true; host.replaceChildren(); }

// ======================================================= Kopfzeile: Brotkrumen, Werkzeuge, Pille
function zeichnePfad() {
  const p = $("pfad");
  if (!S.pfad) { p.replaceChildren(); p.removeAttribute("title"); return; }
  const n = S.nMap.get(S.pfad);
  const bereich = n?.bereich || bereichVonPfad(S.pfad);
  const teile = ordnerVon(S.pfad) ? ordnerVon(S.pfad).split("/") : [];
  const bereichWurzel = bereich === "inbox" || bereich === "maschine" ? "00_inbox" : bereich === "wissen" ? "09_wiki" : bereich === "vorlage" ? "01_vorlagen" : null;
  const bereichText = bereich === "inbox" || bereich === "maschine" ? T.bereiche.inbox : bereich === "wissen" ? T.bereiche.wissen : bereich === "archiv" ? T.bereiche.archiv
    : bereich === "vorlage" ? T.bereiche.vorlagen : "Notizen";
  const zuBereich = () => (bereich === "vorlage" ? waehleSicht({ art: "ordner", id: "01_vorlagen" })
    : waehleSicht({ art: "bereich", id: bereich === "maschine" ? "inbox" : ["inbox", "wissen", "archiv"].includes(bereich) ? bereich : "alle" }));
  const kinder = [h("span", { klasse: "krume link", text: bereichText, aufClick: zuBereich })];
  let acc = "";
  teile.forEach((t) => {
    acc = acc ? acc + "/" + t : t;
    if (acc === bereichWurzel) return;
    const ziel = acc;
    kinder.push(h("span", { klasse: "sep" }, symbol("chevron-rechts", 12)), h("span", { klasse: "krume link", text: t, title: ziel, aufClick: () => waehleSicht({ art: "ordner", id: ziel }) }));
  });
  kinder.push(h("span", { klasse: "sep" }, symbol("chevron-rechts", 12)), h("span", { klasse: "krume aktuell", text: n?.titel || ohneEndung(dateiName(S.pfad)) }));
  p.replaceChildren(...kinder);
  p.title = S.pfad;
}
function zeichnePille(pr) {
  const el = $("pille");
  if (!pr) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "pille " + pr.stufe;
  el.dataset.stufe = pr.stufe;
  el.replaceChildren(h("i"), h("span", { text: T.stufen[pr.stufe] || T.stufen.unbekannt }));
  el.title = T.stufenHinweis[pr.stufe] || "";
}
function werkzeugKnopf(id, sym, titel, tun, { gedrueckt, label } = {}) {
  return h("button", { id, klasse: "knopf-icon", type: "button", title: titel, "aria-label": label || titel, "aria-pressed": gedrueckt === undefined ? null : String(!!gedrueckt), aufClick: tun }, symbol(sym, 16));
}
function zeichneWerkzeuge() {
  const k = [];
  if (S.pfad) {
    const fav = S.favoriten.has(S.pfad);
    k.push(werkzeugKnopf("w-favorit", fav ? "stern-voll" : "stern", fav ? T.werkzeuge.favoritWeg : T.werkzeuge.favorit, umschalteFavorit, { gedrueckt: fav }));
    k.push(werkzeugKnopf("w-roh", "code", S.roh ? T.werkzeuge.vorschau : T.werkzeuge.roh, umschalteRoh, { gedrueckt: S.roh }));
    k.push(werkzeugKnopf("w-breit", "breite", S.breit ? T.werkzeuge.schmal : T.werkzeuge.breit, umschalteBreit, { gedrueckt: S.breit }));
    k.push(werkzeugKnopf("w-gliederung", "gliederung", T.werkzeuge.gliederung, (e) => zeigeGliederung(e.currentTarget)));
  }
  k.push(werkzeugKnopf("knopf-info", "eigenschaften", T.werkzeuge.eigenschaften, umschalteInfo, { gedrueckt: $("app").dataset.info === "an", label: T.eigenschaften.titel }));
  $("werkzeuge").replaceChildren(...k);
  $("haupt").dataset.breite = S.breit ? "breit" : "normal";
  $("editor").dataset.roh = S.roh ? "an" : "aus";
}
function umschalteFavorit() {
  if (!S.pfad) return;
  S.favoriten.has(S.pfad) ? S.favoriten.delete(S.pfad) : S.favoriten.add(S.pfad);
  lokal.schreib("favoriten", [...S.favoriten]);
  zeichneWerkzeuge(); zeichneFavoriten();
  if (S.sicht.art === "favoriten") zeichneListe({ behalte: true });
}
function umschalteRoh() { S.roh = !S.roh; speichereLokal("roh", S.roh); ed.setzeRoh(); zeichneWerkzeuge(); }
function umschalteBreit() { S.breit = !S.breit; speichereLokal("breit", S.breit); zeichneWerkzeuge(); }
function ueberschriften() {
  const text = ed.text().split(/\r?\n|\r/);
  const r = [];
  let code = false, kopf = text[0] === "---";
  for (let i = 0; i < text.length; i++) {
    const z = text[i];
    if (kopf) { if (i > 0 && (z === "---" || z === "...")) kopf = false; continue; }
    if (/^\s*(```|~~~)/.test(z)) { code = !code; continue; }
    if (code) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(z);
    if (m) r.push({ ebene: m[1].length, text: m[2], zeile: i + 1 });
  }
  return r;
}
function zeigeGliederung(anker) {
  const liste = ueberschriften();
  const min = Math.min(...liste.map((x) => x.ebene), 6);
  oeffneMenue(anker, liste.length ? [{ gruppe: T.werkzeuge.gliederung }, ...liste.map((x) => ({ name: x.text, klasse: "gliederung-eintrag", id: "z" + x.zeile, tun: () => ed.springeZu(x.zeile) }))] : [{ leer: T.werkzeuge.keineGliederung }], { rechts: true, breite: 240 });
  document.querySelectorAll(".gliederung-eintrag").forEach((el, i) => el.style.setProperty("--ebene", String(liste[i].ebene - min)));
}

// ======================================================= Eigenschaften
let infoNr = 0;
const SCHUTZ_FELDER = new Set(["typ", "type", "title", "titel", "quellen_sha"]);
const IM_WAHRHEITSBLOCK = new Set(["stand", "pruefen_bis", "quelle", "herkunft", "quellen", "kritisch"]);
const FELD_NAMEN = { name: "Name", description: "Beschreibung", fragen: "Fragen", quellen: "Quellen", rev: "Revision", verfall: "Verfällt nach", ersetzt_durch: "Ersetzt durch", zweifel: "Zweifel" };
const hatWiki = (w) => (typeof w === "string" && /\[\[[^\]]+\]\]/.test(w)) || (Array.isArray(w) && w.some(hatWiki));
const wikiZiel = (s) => { const m = /\[\[([^\]|#]+)/.exec(String(s)); return m ? m[1].trim() : String(s).trim(); };
const schoenerName = (k) => ausTabelle(FELD_NAMEN, k) || (() => { const s = String(k).replace(/[_-]+/g, " ").trim(); return s ? s[0].toUpperCase() + s.slice(1) : k; })();
function reihe(k, wert, opts = {}) {
  return h("div", { klasse: "reihe" + (opts.dim ? " dim" : ""), "data-feld": opts.feld || null }, h("div", { klasse: "k", title: typeof k === "string" ? k : null }, opts.symbol ? symbol(opts.symbol, 14) : null, h("span", { text: k })),
    h("div", { klasse: "w" + (opts.rechts ? " rechts" : "") + (opts.leise ? " leise" : "") }, wert));
}
function feldWert(w) {
  if (w === null || w === undefined || w === "") return { n: h("span", { text: "–" }), leise: true };
  if (typeof w === "boolean") return { n: h("span", { text: w ? "Ja" : "Nein" }) };
  if (Array.isArray(w)) {
    if (!w.length) return { n: h("span", { text: "–" }), leise: true };
    if (w.length <= 4 && w.every((x) => String(x).length <= 26)) return { n: h("div", { klasse: "chips" }, w.map((x) => h("span", { klasse: "chip neutral", text: String(x) }))) };
    // lange Listen: eine Zeile, die sich aufklappen lässt
    const liste = h("ul", { klasse: "wert-liste", hidden: true }, w.map((x) => h("li", { text: String(x) })));
    const knopf = h("button", { type: "button", klasse: "wert-auf", "aria-expanded": "false", aufClick: () => { const auf = liste.hidden; liste.hidden = !auf; knopf.setAttribute("aria-expanded", String(auf)); knopf.classList.toggle("offen", auf); } }, symbol("chevron-rechts", 12), h("span", { text: pluralisiere(w.length, "Eintrag", "Einträge") }));
    return { n: h("div", null, knopf, liste) };
  }
  if (typeof w === "string" && istDatumText(w)) return { n: h("span", { text: datumKurz(w) }) };
  if (typeof w === "string" && w.length > 110) {
    // lange Texte: vier Zeilen, der Rest klappt auf
    const t = h("div", { klasse: "wert-text zu", text: w });
    const knopf = h("button", { type: "button", klasse: "wert-mehr", "aria-expanded": "false", text: "Mehr anzeigen", aufClick: () => { const zu = t.classList.toggle("zu"); knopf.textContent = zu ? "Mehr anzeigen" : "Weniger anzeigen"; knopf.setAttribute("aria-expanded", String(!zu)); } });
    return { n: h("div", null, t, knopf) };
  }
  if (typeof w === "object") return { n: h("span", { text: JSON.stringify(w) }) };
  return { n: h("span", { text: String(w) }) };
}
function sektion(id, titel, ...kinder) {
  return h("div", { klasse: "info-sektion", "data-sektion": id }, titel ? h("h3", { text: titel }) : null, ...kinder);
}
function zielKnopf(ziel) {
  const pfad = S.nMap.has(ziel) ? ziel : loeseWikiAuf(ziel);
  const n = pfad ? S.nMap.get(pfad) : null;
  if (!pfad) return h("div", { klasse: "ziel fehlt", "data-ziel-fehlt": ziel, title: T.eigenschaften.offenEntfernt }, symbol("link", 14), h("span", { klasse: "t", text: ohneEndung(dateiName(ziel)) }));
  const typ = n?.typ ? (S.typMap.get(n.typ) || { name: n.typ }) : null;
  const knopf = h("button", { klasse: "ziel", type: "button", "data-ziel": pfad, title: pfad, aufClick: () => oeffne(pfad, { ausListe: true }) }, symbol(typ ? typSymbol(typ.symbol) : "notiz", 14), h("span", { klasse: "t", text: n?.titel || ohneEndung(dateiName(pfad)) }));
  return typ ? setzeTypFarbe(knopf, typ) : knopf;
}
function infoGeruest() {
  const kopf = h("div", { klasse: "info-kopf" }, symbol("zahnrad", 16), h("h2", { text: T.eigenschaften.titel }),
    h("button", { klasse: "knopf-icon", type: "button", title: T.eigenschaften.schliessen, "aria-label": T.eigenschaften.schliessen, aufClick: umschalteInfo }, symbol("schliessen", 14)));
  const inhalt = h("div", { klasse: "info-inhalt" });
  $("info").replaceChildren(kopf, inhalt);
  return inhalt;
}
async function holeKontext(pfad) {
  try { return await api.notizKontext(pfad); }
  catch {
    // Ältere Werkstatt ohne Kontext-Route: aus Index und Suche zusammensetzen
    const n = S.nMap.get(pfad);
    const felder = n?.felder || {};
    const beziehungen = Object.entries(felder).filter(([, w]) => hatWiki(w)).map(([feld, w]) => ({ feld, ziele: (Array.isArray(w) ? w : [w]).map(wikiZiel) }));
    let rueck = [];
    try { const r = await api.suche("[[" + ohneEndung(dateiName(pfad))); const g = new Set(); rueck = (r.treffer || []).filter((x) => x.pfad !== pfad && !g.has(x.pfad) && g.add(x.pfad)).map((x) => ({ pfad: x.pfad, titel: x.titel })); } catch { /* leer */ }
    return { felder, beziehungen, rueckverweise: rueck, info: { woerter: null, bytes: null, geaendert: n?.geaendert || null, erstellt: n?.erstellt || null } };
  }
}
async function ladeInfo() {
  const nr = ++infoNr, pfad = S.pfad;
  const inhalt = infoGeruest();
  if (!pfad) { inhalt.append(h("div", { klasse: "info-leer", text: T.eigenschaften.leer })); zeichnePille(null); return; }
  const n = S.nMap.get(pfad);
  const wahrheit = sektion("pruefung", T.eigenschaften.wahrheit, h("div", { klasse: "status-karte" }, h("div", { klasse: "leise", text: T.eigenschaften.zuPruefen })));
  const feldSek = sektion("felder", null);
  const bezSek = sektion("beziehungen", T.eigenschaften.beziehungen);
  const verwSek = sektion("verweise", T.eigenschaften.verweise);
  const rueckSek = sektion("rueck", T.eigenschaften.rueck);
  const infoSek = sektion("info", T.eigenschaften.info);
  const verlaufSek = sektion("verlauf", T.eigenschaften.verlauf);
  bezSek.hidden = verwSek.hidden = rueckSek.hidden = true;
  inhalt.append(wahrheit, feldSek, bezSek, verwSek, rueckSek, infoSek, verlaufSek);

  // Wahrheitsstatus
  api.pruefung(pfad).then((pr) => {
    if (nr !== infoNr) return;
    S.aktuellePruefung = pr;
    S.pruef.set(pfad + "|" + (S.eintraege.get(pfad)?.geaendert ?? ""), pr.stufe);
    const nn = S.nMap.get(pfad);
    if (nn && nn.stufe !== pr.stufe && nn.bereich === "wissen") { nn.stufe = pr.stufe; const el = document.querySelector(`[data-punkt="${CSS.escape(pfad)}"]`); if (el) el.className = "punkt " + pr.stufe; }
    zeichnePille(pr);
    const sig = pr.signale || [];
    const felder = nn?.felder || {};
    const anzeige = sig.filter((x) => x.art !== "stand" && x.art !== "belegt");
    const karte = h("div", { klasse: "status-karte", "data-stufe": pr.stufe },
      h("div", { klasse: "stufe-kopf " + pr.stufe }, h("i"), h("span", { text: T.stufen[pr.stufe] || "" })),
      h("p", { klasse: "stufe-text", text: pr.zusammenfassung || T.stufenHinweis[pr.stufe] || "" }),
      anzeige.length ? h("ul", { klasse: "signal-liste" }, anzeige.map((x) =>
        h("li", { klasse: x.zeile ? "sprung" : "", aufClick: x.zeile ? () => ed.springeZu(x.zeile) : null },
          h("span", { klasse: "art " + signalStufe(x) }), h("span", { text: x.text || x.art }), x.zeile ? h("span", { klasse: "z", text: `${T.suche.zeile} ${x.zeile}` }) : null)))
        : (pr.stufe === "grau" ? null : h("p", { klasse: "stufe-text leise", text: T.info.keineSignale })));
    const zus = [];
    if (pr.stufe !== "grau") {
      const stand = felder.stand || sig.find((x) => x.art === "stand")?.text?.replace(/^Stand\s+/, "");
      if (stand) zus.push(reihe(T.eigenschaften.stand, h("span", { text: datumKurz(stand) || stand }), { rechts: true, symbol: "uhr", feld: "stand" }));
      if (felder.pruefen_bis) zus.push(reihe(T.eigenschaften.pruefenBis, h("span", { text: datumKurz(felder.pruefen_bis) || String(felder.pruefen_bis) }), { rechts: true, symbol: "verlauf", feld: "pruefen_bis" }));
      const her = felder.quelle || felder.herkunft;
      const nQuellen = Array.isArray(felder.quellen) ? felder.quellen.length : 0;
      if (her || nQuellen) zus.push(reihe(T.eigenschaften.herkunft, h("span", { text: her ? String(her) : pluralisiere(nQuellen, "Quelle", "Quellen") }), { rechts: true, symbol: "buch", feld: "herkunft" }));
      const belegt = sig.find((x) => x.art === "belegt");
      if (belegt) zus.push(reihe(T.eigenschaften.belege, h("span", { text: belegt.text.replace(/^(\d+).*/, (m, n) => pluralisiere(+n, "belegter Fakt", "belegte Fakten")) }), { rechts: true, symbol: "kreis-haken", feld: "belege" }));
      if (felder.kritisch === true || /^true$/i.test(String(felder.kritisch || ""))) zus.push(reihe(T.eigenschaften.kritisch, h("span", { text: "nur von Hand" }), { rechts: true, symbol: "schild", feld: "kritisch" }));
    }
    wahrheit.replaceChildren(h("h3", { text: T.eigenschaften.wahrheit }), karte, ...(zus.length ? [h("div", { klasse: "reihen", style: "margin-top:6px" }, zus)] : []));
    ed.setzeSignale(sig.filter((s) => s.zeile).map((s) => ({ zeile: s.zeile, stufe: signalStufe(s), text: s.text })));
  }).catch(() => { if (nr === infoNr) { wahrheit.replaceChildren(h("h3", { text: T.eigenschaften.wahrheit }), h("p", { klasse: "leise", text: T.fehler.allgemein })); zeichnePille(null); } });

  // Typ, Felder, Beziehungen, Rückverweise, Info
  holeKontext(pfad).then((k) => {
    if (nr !== infoNr) return;
    const felder = k.felder || {};
    const typId = n?.typ || felder.typ || felder.type || null;
    const typ = typId ? (S.typMap.get(typId) || { name: typId }) : null;
    const zeilen = [reihe(T.eigenschaften.typ, typ ? setzeTypFarbe(h("span", { klasse: "chip", "data-typ-chip": typ.name }, symbol(typSymbol(typ.symbol), 13), typName(typ.name)), typ) : h("span", { text: T.eigenschaften.keinTyp }), { symbol: "thema", leise: !typ, feld: "typ" })];
    const wissen = n?.bereich === "wissen";
    const rest = Object.entries(felder).filter(([key, w]) => !SCHUTZ_FELDER.has(key.toLowerCase()) && !key.startsWith("_") && !hatWiki(w) && !(wissen && IM_WAHRHEITSBLOCK.has(key.toLowerCase())));
    for (const [key, w] of rest) { const f = feldWert(w); zeilen.push(reihe(schoenerName(key), f.n, { leise: f.leise, feld: key })); }
    feldSek.replaceChildren(h("div", { klasse: "reihen" }, zeilen));
    if (!Object.keys(felder).length && !typ) feldSek.append(h("p", { klasse: "leise", style: "margin:8px 0 0", text: T.eigenschaften.keineFelder }));
    const bez = (k.beziehungen || []).filter((b) => (b.ziele || []).length);
    bezSek.hidden = !bez.length;
    if (bez.length) bezSek.replaceChildren(h("h3", { text: T.eigenschaften.beziehungen }), ...bez.map((b) => h("div", { klasse: "beziehung", "data-beziehung": b.feld }, h("div", { klasse: "k", text: schoenerName(b.feld) }), h("div", { klasse: "ziele" }, b.ziele.map(zielKnopf)))));
    // Links im Text (ohne die schon als Beziehung gezeigten); lange Listen erst gekürzt
    const schonGezeigt = new Set(bez.flatMap((b) => b.ziele));
    const vw = (k.verweise || []).filter((z) => !schonGezeigt.has(z) && z !== pfad);
    verwSek.hidden = !vw.length;
    if (vw.length) {
      const kurz = 8, ziele = h("div", { klasse: "ziele" }, vw.slice(0, kurz).map(zielKnopf));
      const mehr = vw.length > kurz ? h("button", { klasse: "wert-mehr", type: "button", text: T.eigenschaften.alleVerweise(vw.length), aufClick: () => { ziele.replaceChildren(...vw.map(zielKnopf)); mehr.remove(); } }) : null;
      verwSek.replaceChildren(h("h3", { text: T.eigenschaften.verweise }), ziele, ...(mehr ? [mehr] : []));
    }
    const rv = k.rueckverweise || [];
    rueckSek.hidden = false;
    rueckSek.replaceChildren(h("h3", { text: T.eigenschaften.rueck }), ...(rv.length ? [h("div", { klasse: "ziele" }, rv.map((x) => zielKnopf(x.pfad)))] : [h("p", { klasse: "leise", style: "margin:0", text: T.info.keineRueck })]));
    const i = k.info || {};
    const woerter = i.woerter ?? (pfad === S.pfad ? wortAnzahl(ed.text()) : null);
    const bytes = i.bytes ?? (pfad === S.pfad ? new Blob([ed.text()]).size : null);
    infoSek.replaceChildren(h("h3", { text: T.eigenschaften.info }), h("div", { klasse: "reihen" }, [
      reihe(T.eigenschaften.geaendert, h("span", { text: datumKurz(i.geaendert || n?.geaendert) || "–" }), { rechts: true }),
      reihe(T.eigenschaften.erstellt, h("span", { text: datumKurz(i.erstellt || n?.erstellt) || "–" }), { rechts: true }),
      reihe(T.eigenschaften.woerter, h("span", { text: woerter === null ? "–" : woerter.toLocaleString("de-DE") }), { rechts: true }),
      reihe(T.eigenschaften.groesse, h("span", { text: bytes === null ? "–" : bytesText(bytes) }), { rechts: true })]));
  });

  // Verlauf dieser Notiz
  if (istGitGesperrt()) verlaufSek.append(h("p", { klasse: "leise", text: T.info.gitGesperrt }));
  else if (S.info && !S.info.git) verlaufSek.append(h("p", { klasse: "leise", text: T.info.keinGit }));
  else api.verlauf(pfad, 30).then((r) => {
    if (nr !== infoNr) return;
    const liste = r.eintraege || [];
    const offenMit = [];
    const geaendert = S.git?.geaendert?.find((g) => g.pfad === pfad);
    if (geaendert) offenMit.push(fassung({ nachricht: T.info.arbeitsstand, zeit: null, kurz: "", arbeitsstand: true }, pfad));
    liste.forEach((x) => offenMit.push(fassung(x, pfad)));
    if (!offenMit.length) verlaufSek.append(h("p", { klasse: "leise", style: "margin:0", text: T.info.keinVerlauf }));
    else verlaufSek.append(...offenMit);
  }).catch((e) => { if (nr === infoNr) verlaufSek.append(h("p", { klasse: "leise", style: "margin:0", text: gitGesperrt(e) ? T.info.gitGesperrt : e.status === 400 || e.status === 404 ? T.info.keinVerlauf : e.message })); });
}
const signalStufe = (s) => s.stufe || (/konflikt|zweifel|pruefbed|prüfbed|rot/i.test(s.art || "") ? "rot" : s.art === "belegt" ? "gruen" : /^(stand|kritisch)$/.test(s.art || "") ? "grau" : "gelb");

function zeitText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fassung(x, pfad) {
  const rumpf = h("div", { klasse: "fassung-rumpf", hidden: true });
  const wurzel = h("div", { klasse: "fassung", "data-sha": x.sha || "arbeitsstand" });
  let geladen = false;
  const kopf = h("div", { klasse: "fassung-kopf", role: "button", tabindex: "0", aufClick: async () => {
    const auf = rumpf.hidden;
    rumpf.hidden = !auf; wurzel.classList.toggle("offen", auf);
    if (auf && !geladen) {
      geladen = true;
      rumpf.replaceChildren(h("div", { klasse: "leise", text: T.info.diffLaedt }));
      try {
        const d = await api.diff(pfad, x.arbeitsstand ? undefined : x.sha);
        rumpf.replaceChildren(diffAnsicht(d.diff));
        if (!x.arbeitsstand) rumpf.append(h("button", { klasse: "knopf", "data-aktion": "wiederherstellen", text: T.info.wiederherstellen, aufClick: () => stelleWiederHer(pfad, x.sha) }));
      } catch (e) { rumpf.replaceChildren(h("div", { klasse: "fehlertext", text: gitGesperrt(e) ? T.fehler.gitGesperrt : e.message })); }
    }
  } }, h("span", { klasse: "nachricht", text: x.nachricht }), h("span", { klasse: "meta", text: x.arbeitsstand ? "" : [x.autor, zeitText(x.zeit)].filter(Boolean).join(" · ") }));
  kopf.addEventListener("keydown", (e) => { if (e.key === "Enter") kopf.click(); });
  wurzel.append(kopf, rumpf);
  return wurzel;
}
async function stelleWiederHer(pfad, sha) {
  if (S.pfad !== pfad || S.schutz) return;
  try {
    const f = await api.fassung(pfad, sha);
    if (f.inhalt.includes("\r") && ed.view.state.lineBreak === "\n") { ed.setzeText(f.inhalt); S.dirty = true; ed.view.dispatch({}); zeigeStand("ungespeichert"); clearTimeout(speicherTimer); speicherTimer = setTimeout(speichere, 800); }
    else ed.ersetzeAlles(f.inhalt);
    toast(T.info.wiederhergestellt);
  } catch (e) { toast(gitGesperrt(e) ? T.fehler.gitGesperrt : e.message, { fehler: true }); }
}

// ======================================================= Statusleiste
const stEl = $("status");
function st(id, kinder, { klick, titel, klasse = "", tag = null } = {}) {
  const el = h(klick ? "button" : "span", { klasse: "st" + (klasse ? " " + klasse : ""), "data-st": id, title: titel || null, type: klick ? "button" : null, aufClick: klick || null }, ...kinder);
  return el;
}
const punktEl = (farbe) => h("span", { klasse: "d " + (farbe || "") });
function syncText(g) {
  if (S.syncLaeuft) return { text: T.status.gleicheAb, farbe: "dreht" };
  if (S.syncFehler) return { text: S.syncFehler === "konflikt" ? T.status.konflikt : T.status.fehler, farbe: "rot" };
  if (!g.remote) return { text: T.status.nieGesichert, farbe: "grau" };
  if (g.zurueck > 0) return { text: T.status.pullNoetig, farbe: "gelb" };
  const min = g.letzterSync ? vorMinuten(g.letzterSync) : null;
  if (min === null) return { text: T.status.nieGesichert, farbe: "grau" };
  return { text: T.status.gesichert(T.status.vorMin(min)), farbe: g.vor > 0 || g.geaendert.length ? "gelb" : "" };
}
function zeichneStatus() {
  const g = S.git, k = [];
  if (!S.info || !S.info.vault) { stEl.replaceChildren(); return; }
  k.push(st("vault", [symbol("vault", 14), h("span", { text: S.info.name || PRODUKT })], { titel: S.info.vault }));
  if (S.info.appVersion) k.push(st("version", [symbol("info", 14), h("span", { text: S.info.appVersion })], { titel: T.status.version(S.info.appVersion) }));
  k.push(h("span", { klasse: "trenner" }));
  const vertrauen = vertrauenVon(S.info);
  if (istGitGesperrt()) {
    // Statt der Git-Angaben: gesperrt, bis der Nutzer dem Vault vertraut (Klick öffnet die Frage)
    k.push(st("git-gesperrt", [symbol("schild", 14), h("span", { text: T.status.gitGesperrt })], { klick: oeffneVertrauen, titel: T.status.gitGesperrtTitel, klasse: "warn" }));
  } else if (!S.info.git || (g && !g.repo)) {
    k.push(st("kein-git", [punktEl("grau"), h("span", { text: T.status.keinGit })], { titel: "Dieser Ordner ist nicht mit Git gesichert." }));
  } else if (g) {
    k.push(st("zweig", [symbol("zweig", 14), h("span", { text: g.zweig || "–" }), ...(g.upstream ? [h("span", { text: `↑${g.vor} ↓${g.zurueck}` })] : [])], { titel: g.upstream ? `Verbunden mit ${g.upstream}` : "Kein Remote-Zweig" }));
    if (!g.remote) k.push(st("remote", [symbol("wolke", 14), h("span", { text: T.status.keinRemote })], { klick: oeffneRemote, titel: T.status.remoteTitel, klasse: "warn" }));
    else k.push(st("remote", [symbol("wolke", 14), h("span", { text: g.upstream ? g.upstream.split("/")[0] : "Remote" })], { titel: g.upstream || "Remote" }));
    k.push(h("span", { klasse: "trenner" }));
    const sy = syncText(g);
    k.push(st("sync", [punktEl(sy.farbe), h("span", { text: sy.text })], { klick: sync, titel: T.status.abgleichen }));
    k.push(h("span", { klasse: "trenner" }));
    const n = g.geaendert.length;
    k.push(st("geaendert", [symbol("commit", 14), h("span", { text: n ? T.status.geaendert(n) : T.status.sauber })], { klick: oeffneCommit, titel: "Änderungen sichern (⌘⇧G)", klasse: n ? "hervor" : "" }));
    k.push(st("verlauf", [symbol("verlauf", 14), h("span", { text: T.status.verlauf })], { klick: oeffneVerlauf, titel: T.status.verlaufTitel, klasse: S.sicht.art === "verlauf" ? "aktiv" : "" }));
  }
  k.push(h("span", { klasse: "sp" }));
  if (vertrauen && vertrauen.noetig && !vertrauen.erlaubt && !istGitGesperrt()) {
    k.push(st("vertrauen", [symbol("schild", 14), h("span", { text: T.status.nichtVertraut })], { klick: oeffneVertrauen, titel: T.status.nichtVertrautTitel, klasse: "warn" }));
  }
  const verbunden = S.kiVerbunden || S.ki?.agenten?.some((a) => a.id === "claude" && a.verbunden === true);
  k.push(st("claude", [symbol("claude", 14), h("span", { text: T.status.claude }), symbol(verbunden ? "haken" : "schliessen", 12)], { klick: oeffneKi, titel: verbunden ? T.status.claudeVerbunden : T.status.claudeNicht, klasse: verbunden ? "gut" : "" }));
  const gs = S.gesundheit;
  if (gs && gs.verfuegbar !== false) {
    const w = Array.isArray(gs.warnungen) ? gs.warnungen.length : Number(gs.warnungen) || 0;
    const ampel = String(gs.ampel || "").toLowerCase();
    const farbe = /rot|red/.test(ampel) ? "rot" : /gelb|yellow|orange/.test(ampel) || w ? "gelb" : "";
    k.push(st("gesundheit", [symbol(farbe ? "warnung" : "herz", 14), h("span", { text: T.status.gesundheit }), h("span", { text: w ? String(w) : "✓" })], { klick: oeffneGesundheit, klasse: farbe === "rot" ? "schlecht" : farbe ? "warn" : "gut" }));
  }
  k.push(st("nutzung", [symbol("verlauf", 14), h("span", { text: T.status.nutzung })], { klick: oeffneNutzung, titel: T.status.nutzungTitel }));
  k.push(h("span", { klasse: "trenner" }));
  k.push(st("theme", [symbol(istDunkel() ? "sonne" : "mond", 14)], { klick: () => setzeTheme(istDunkel() ? "hell" : "dunkel"), titel: istDunkel() ? T.status.zuHell : T.status.zuDunkel }));
  k.push(st("einstellungen", [symbol("zahnrad", 14)], { klick: (e) => oeffneEinstellungen(e.currentTarget), titel: T.status.einstellungen }));
  stEl.replaceChildren(...k);
}
setInterval(() => { if (S.git) zeichneStatus(); }, 30000);

let gitTimer = null, baumTimer = null;
async function ladeGit() {
  try { S.git = await api.status(); }
  catch (e) { S.git = gitGesperrt(e) ? { repo: true, gesperrt: true, grund: e.daten?.fehler || null } : null; }
  zeichneStatus();
}
function planeGitRefresh() { clearTimeout(gitTimer); gitTimer = setTimeout(ladeGit, 1200); }
function planeBaumRefresh() { clearTimeout(baumTimer); baumTimer = setTimeout(ladeBaum, 1500); }
async function ladeGesundheit() {
  try { S.gesundheit = await api.gesundheit(); } catch { S.gesundheit = null; }
  try { S.rueckfragen = await api.rueckfragen(); } catch { S.rueckfragen = null; }
  zeichneStatus(); zeichneBereiche();
}
async function ladeKi() {
  try { S.ki = await api.kiErkennen(); } catch { S.ki = null; }
  zeichneStatus();
}

async function sync() {
  if (S.syncLaeuft) return;
  if (istGitGesperrt()) { await zeigeGitGesperrt(); return; }
  if (S.dirty) { clearTimeout(speicherTimer); await speichereAlles(); }
  S.syncLaeuft = true; S.syncFehler = null; zeichneStatus();
  const ende = arbeitBeginnt("sync"); // Schließen des Fensters fragt nach, solange das läuft
  try {
    const r = await api.sync();
    toast(T.status.abgeglichen[r.ergebnis] || T.status.abgeglichen.aktuell);
    await ladeBaum();
    const pfad = S.pfad;
    if (pfad) {
      const d = await api.datei(pfad).catch(() => null);
      // erst NACH dem Laden prüfen: inzwischen getippt oder Datei gewechselt?
      if (d && S.pfad === pfad && d.hash !== S.hash) {
        if (S.dirty || S.speichert) { if (!S.konflikt) { S.konflikt = { aktuellerHash: d.hash }; zeigeBanner(); zeigeStand("konflikt"); } }
        else { S.hash = d.hash; ed.setzeText(d.inhalt, { nurLesen: !!d.schreibschutz }); }
      }
    }
  } catch (e) {
    if (gitGesperrt(e)) { S.syncFehler = null; await zeigeGitGesperrt(); }
    else if (ausgangUnklar(e)) { S.syncFehler = null; await nachZeitueberschreitung(e); } // Ausgang unklar: keinen Fehlerzustand behaupten, der neu geladene Git-Status zeigt es
    else {
      S.syncFehler = e.status === 409 ? "konflikt" : "fehler";
      toast(e.status === 409 && e.daten?.dateien?.length ? `${e.message} Betroffen: ${e.daten.dateien.slice(0, 3).join(", ")}` : e.message, { fehler: true });
    }
  } finally { ende(); S.syncLaeuft = false; await ladeGit(); ladeInfoLeise().then(() => fragVertrauenEinmal()); if (S.sicht.art === "verlauf") verlaufInst?.aktualisieren?.(); }
}

// Unklarer Ausgang (die Brücke hat die Frist gerissen, oder die Werkstatt hat zurückgenommen): Info, Vault-Liste und Git-Status
// neu holen und ehrlich sagen, dass wir nicht wissen, ob es geklappt hat. Antwortet die Werkstatt gar nicht, bleibt die Verbindungsmeldung.
async function nachZeitueberschreitung(e) {
  const stand = await ladeStandNeu();
  if (!stand.ok) { toast(e.message, { fehler: true }); return false; }
  if (vaultGewechselt(stand)) { aktion("vault-gewechselt"); await ladeAlles(); }
  else uebernehmeStand(stand);
  toast(zeitFehlerText(e), { ms: 12000 });
  return true;
}
const vaultGewechselt = (stand) => (stand?.info?.vault || null) !== (S.info?.vault || null);
// Gleicher Vault: nur die Anzeige auffrischen (Name, Vault-Liste, Git-Status); Editor und Eingaben bleiben unberührt
function uebernehmeStand(stand) {
  if (stand.info) setzeInfo(stand.info);
  if (stand.vaults) S.vaultListe = stand.vaults;
  if (stand.git) S.git = stand.git;
  vaultKopf(); zeichneStatus();
}
// Für die Willkommen-Karte: Anzeige auffrischen; true = die Werkstatt hat inzwischen einen anderen Vault geöffnet (die Karte macht dann wie nach Erfolg weiter)
async function karteStandNeu(stand) {
  if (vaultGewechselt(stand)) return true;
  uebernehmeStand(stand);
  return false;
}

// ======================================================= Remote, KI, Einstellungen (Module laden bei Bedarf)
async function oeffneRemote() {
  try { const m = await import("./remote.js"); m.oeffneRemoteDialog({ beiFertig: () => { ladeGit(); }, beiStandNeu: (stand) => { uebernehmeStand(stand); } }); }
  catch { toast("Das geht in dieser Version noch nicht.", { fehler: true }); }
}
async function oeffneKi() {
  // „verbunden“ gilt erst nach geglücktem Verbinden, nicht schon beim bloßen Schließen des Dialogs
  try { const m = await import("./willkommen.js"); m.oeffneKiDialog({ beiFertig: () => { ladeKi(); }, beiVerbunden: () => { S.kiVerbunden = true; zeichneStatus(); } }); }
  catch { try { await api.mcpVerbinden(); S.kiVerbunden = true; toast(T.mcp.ok); zeichneStatus(); } catch (e) { toast(e.daten?.befehl ? `${T.mcp.befehl} ${e.daten.befehl}` : e.message, { fehler: !e.daten?.befehl, ms: 12000 }); } }
}
function oeffneEinstellungen(anker) {
  oeffneMenue(anker, [
    { gruppe: T.status.darstellung },
    { segmente: [{ name: T.status.system, wert: "system", aktiv: S.theme === "system", tun: () => setzeTheme("system") }, { name: T.status.hell, wert: "hell", symbol: "sonne", aktiv: S.theme === "hell", tun: () => setzeTheme("hell") }, { name: T.status.dunkel, wert: "dunkel", symbol: "mond", aktiv: S.theme === "dunkel", tun: () => setzeTheme("dunkel") }] },
    { trenner: true },
    { name: S.breit ? T.werkzeuge.schmal : T.werkzeuge.breit, symbol: "breite", id: "breite", tun: () => { umschalteBreit(); } },
    { name: T.befehle.mcp, symbol: "claude", id: "ki", tun: oeffneKi },
    ...(inApp() ? [{ name: T.befehle.ordner, symbol: "ordner", id: "finder", tun: () => aktion("ordner-zeigen", S.pfad || undefined) }, { name: T.befehle.ansicht, symbol: "ansicht", id: "uebersicht", tun: oeffneUebersicht }] : []),
    { trenner: true },
    { name: `${PRODUKT} ${S.info?.appVersion || ""}`.trim(), symbol: "info", id: "version", tun: () => {} },
  ], { rechts: true, oben: true, breite: 240 });
}

// „Übersicht öffnen“: die App antwortet { ok: true } oder { ok: false, grund } (Spec §8). Ohne Vertrauen oder ohne Kit öffnet sich nichts,
// und das sagen wir: bei „nicht-vertraut“ kommt die Frage, bei „kein-kit“ und „pruefung-fehlgeschlagen“ ein Satz. Im Browser (keine App) tut der Aufruf nichts.
async function oeffneUebersicht() {
  const r = await aktionMitAntwort("ansicht");
  if (!r || r.ok !== false) return;
  if (r.grund === "kein-kit") { toast(T.uebersicht.keinKit); return; }
  if (r.grund === "pruefung-fehlgeschlagen") { toast(T.uebersicht.pruefung, { fehler: true }); return; }
  if (r.grund === "nicht-vertraut") {
    await ladeInfoLeise(); // die App prüft frisch: unseren Stand angleichen, bevor wir fragen
    const v = vertrauenVon(S.info);
    if (v && !v.erlaubt) { toast(T.uebersicht.nichtVertraut); oeffneVertrauen(); }
    else toast(T.uebersicht.nichtBestaetigt, { fehler: true }); // wir halten den Vault für vertraut, die App nicht: ehrlich sagen
    return;
  }
  toast(T.uebersicht.nichtGeoeffnet, { fehler: true });
}

// ======================================================= Commit-Dialog
async function oeffneCommit() {
  if (dialogOffen()) return;
  clearTimeout(speicherTimer);
  await speichereAlles();
  await ladeGit();
  if (istGitGesperrt()) { await zeigeGitGesperrt(); return; }
  if (!S.git?.repo) { toast(T.status.keinGit); return; }
  const liste = S.git.geaendert || [];
  if (!liste.length) { toast(T.commit.nichts); return; }
  const haken = new Map(liste.map((g) => [g.pfad, true]));
  const msg = h("input", { type: "text", "data-feld": "nachricht", value: T.commit.vorbelegt(liste.map((g) => ohneEndung(dateiName(g.pfad))), liste.length) });
  const fehlerEl = h("div", { klasse: "fehlertext", hidden: true });
  const knopf = h("button", { klasse: "knopf primaer", text: T.commit.sichern, "data-aktion": "commit" });
  const boxen = liste.map((g) => {
    const cb = h("input", { type: "checkbox", checked: true, "data-datei": g.pfad, aufChange: () => { haken.set(g.pfad, cb.checked); aktualisiere(); } });
    return h("label", null, cb, h("span", { klasse: "n", text: g.pfad, title: g.pfad }), h("span", { klasse: "c", text: T.commit.codes[g.code?.trim()] || T.commit.codes[g.code?.trim()?.[0]] || "geändert" }));
  });
  const aktualisiere = () => { knopf.disabled = ![...haken.values()].some(Boolean); };
  const setzeAlle = (v) => { boxen.forEach((l) => { const c = l.querySelector("input"); c.checked = v; haken.set(c.dataset.datei, v); }); aktualisiere(); };
  const d = dialog({
    titel: T.commit.titel, breit: true,
    rumpf: [
      h("div", { klasse: "feld" }, h("label", { text: T.commit.nachricht }), msg),
      h("div", { klasse: "feld" }, h("label", null, h("span", { text: `${T.commit.dateien} · ${liste.length}` }), h("span", { klasse: "mini" }, h("a", { text: T.commit.alle, aufClick: () => setzeAlle(true) }), " · ", h("a", { text: T.commit.keine, aufClick: () => setzeAlle(false) }))), h("div", { klasse: "dateiliste" }, boxen)),
      fehlerEl,
    ],
    knoepfe: [h("button", { klasse: "knopf", text: T.commit.abbrechen, aufClick: () => d.schliessen() }), knopf],
  });
  const tun = async () => {
    const gewaehlt = [...haken].filter(([, v]) => v).map(([k]) => k);
    if (!gewaehlt.length) { fehlerEl.hidden = false; fehlerEl.textContent = T.commit.nichtsGewaehlt; return; }
    if (!msg.value.trim()) { fehlerEl.hidden = false; fehlerEl.textContent = T.commit.keineNachricht; return; }
    knopf.disabled = true;
    const ende = arbeitBeginnt("commit"); // Schließen des Fensters fragt nach, solange das läuft
    try { await api.commit(msg.value.trim(), gewaehlt); d.schliessen(); toast(T.commit.fertig); await ladeGit(); ladeInfo(); if (S.sicht.art === "verlauf") verlaufInst?.aktualisieren?.(); }
    catch (e) {
      if (gitGesperrt(e)) { d.schliessen(); await zeigeGitGesperrt(); }
      else if (e?.status === 504) {
        // Die Werkstatt hat ihre Frist gerissen und zurückgenommen („Es wurde nichts gesichert“): der Ausgang ist nicht unklar.
        // Dialog, Nachricht und Auswahl bleiben, der Satz steht im Dialog, der Knopf ist wieder frei (wie im Remote-Dialog).
        ende();
        fehlerEl.hidden = false; fehlerEl.textContent = zeitFehlerText(e);
        aktualisiere();
        const stand = await ladeStandNeu(); // die Anzeige im Hintergrund auffrischen
        if (stand.ok && vaultGewechselt(stand)) { d.schliessen(); aktion("vault-gewechselt"); await ladeAlles(); toast(zeitFehlerText(e), { ms: 12000 }); }
        else if (stand.ok) uebernehmeStand(stand);
      }
      else if (ausgangUnklar(e)) { d.schliessen(); await nachZeitueberschreitung(e); ladeInfo(); if (S.sicht.art === "verlauf") verlaufInst?.aktualisieren?.(); } // status 0: die Brücke hat aufgegeben, ob gesichert wurde, ist offen
      else { fehlerEl.hidden = false; fehlerEl.replaceChildren(document.createTextNode(e.message), ...(e.daten?.ausgabe ? [h("pre", { text: e.daten.ausgabe })] : [])); knopf.disabled = false; }
    } finally { ende(); }
  };
  knopf.addEventListener("click", tun);
  msg.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tun(); } });
  msg.select();
}

// ======================================================= Neu / Merken / Gesundheit
function oeffneNeu(vorTitel) {
  if (dialogOffen()) return;
  const ordner = S.baum.filter((e) => e.art === "ordner" && !e.schreibschutz).map((e) => e.pfad);
  const vorOrdner = S.sicht.art === "ordner" ? S.sicht.id : S.pfad && ordnerVon(S.pfad) ? ordnerVon(S.pfad) : ordner.includes("00_inbox") ? "00_inbox" : ordner[0] || "";
  const sel = h("select", { "data-feld": "ordner" }, ordner.length ? ordner.map((o) => h("option", { value: o, selected: o === vorOrdner, text: o })) : h("option", { value: "", text: "Hauptordner" }));
  const titel = h("input", { type: "text", "data-feld": "titel", placeholder: T.neu.platzhalter, value: typeof vorTitel === "string" ? vorTitel : "" });
  const fehlerEl = h("div", { klasse: "fehlertext", hidden: true });
  const tun = async () => {
    if (!titel.value.trim()) { titel.focus(); return; }
    try { const r = await api.neu(sel.value, titel.value.trim()); d.schliessen(); await ladeBaum(); await oeffne(r.pfad); planeGitRefresh(); }
    catch (e) { fehlerEl.hidden = false; fehlerEl.textContent = e.message; }
  };
  const d = dialog({ titel: T.neu.titel, rumpf: [h("div", { klasse: "feld" }, h("label", { text: T.neu.name }), titel), h("div", { klasse: "feld" }, h("label", { text: T.neu.ordner }), sel), fehlerEl],
    knoepfe: [h("button", { klasse: "knopf", text: T.commit.abbrechen, aufClick: () => d.schliessen() }), h("button", { klasse: "knopf primaer", text: T.neu.anlegen, "data-aktion": "anlegen", aufClick: tun })] });
  titel.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tun(); } });
}
function oeffneMerken() {
  if (dialogOffen()) return;
  const entwurf = leseEntwurf("merken") || {};
  const text = h("textarea", { "data-feld": "text", placeholder: T.merken.text, autofocus: true, text: entwurf.text || "" });
  const titel = h("input", { type: "text", "data-feld": "titel", placeholder: T.merken.titelFeld, value: entwurf.titel || "" });
  let abgelegt = false;
  const fehlerEl = h("div", { klasse: "fehlertext", hidden: true });
  const tun = async () => {
    if (!text.value.trim()) { text.focus(); return; }
    try {
      const r = await api.merken(text.value, titel.value.trim() || undefined);
      abgelegt = true; d.schliessen(); toast(T.merken.fertig, { aktion: { text: T.merken.offen, tun: () => oeffne(r.pfad) } });
      await ladeBaum(); planeGitRefresh();
    } catch (e) { fehlerEl.hidden = false; fehlerEl.textContent = e.message; }
  };
  const d = dialog({ titel: T.merken.titel,
    // Esc/Klick daneben verliert nichts: der Text bleibt als Entwurf, bis er abgelegt wird
    beiSchliessen: () => { if (abgelegt || !text.value.trim()) { speichereEntwurf("merken", null); } else { speichereEntwurf("merken", { text: text.value, titel: titel.value }); toast(T.merken.entwurf); } },
    rumpf: [h("div", { klasse: "feld" }, text), h("div", { klasse: "feld" }, titel), fehlerEl, h("div", { klasse: "mini", text: "⌘↩ zum Ablegen" })],
    knoepfe: [h("button", { klasse: "knopf", text: T.commit.abbrechen, aufClick: () => d.schliessen() }), h("button", { klasse: "knopf primaer", text: T.merken.sichern, "data-aktion": "merken", aufClick: tun })] });
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); tun(); } });
}
async function oeffneGesundheit() {
  if (dialogOffen()) return;
  if (!S.gesundheit) await ladeGesundheit();
  const g = S.gesundheit;
  const inhalt = !g || g.verfuegbar === false ? [h("p", { klasse: "leise", text: T.gesundheit.keine })]
    : (g.pruefungen || []).map((p) => h("div", { klasse: "gesundheit-pruefung" },
      h("div", { klasse: "k" }, h("span", { klasse: "punkt " + stufenKlasse(p.stufe) }), h("span", { text: p.name || p.id })),
      p.text ? h("p", { text: p.text }) : null,
      (p.befunde || []).length ? h("ul", null, (p.befunde || []).slice(0, 8).map((b) => h("li", { text: b.kurz }))) : null));
  dialog({ titel: T.gesundheit.titel, breit: true, rumpf: inhalt.length ? inhalt : [h("p", { klasse: "leise", text: T.gesundheit.ok })], knoepfe: [] });
}
// Lokale Nutzungsmessung (FBL-72): was die KI per MCP abruft, aus .logs/mcp.log (GET /api/nutzung).
async function oeffneNutzung() {
  if (dialogOffen()) return;
  let w = null, fehler = false;
  try { w = await api.nutzung(); } catch { fehler = true; }
  const N = T.nutzung;
  const seiteEl = (p, rechts) => h("li", { klasse: "nutzung-zeile" },
    h("button", { klasse: "knopf-text nutzung-seite", "data-pfad": p, title: p, text: ohneEndung(dateiName(p)), aufClick: () => { d.schliessen(); oeffne(p); } }),
    h("span", { klasse: "leise", text: rechts || "" }));
  const rumpf = [h("p", { klasse: "leise", text: N.lokal })];
  if (fehler || !w) rumpf.push(h("p", { klasse: "fehlertext", text: N.fehler }));
  else if (w.fehler) rumpf.push(h("p", { klasse: "fehlertext", "data-fehler": "nutzung", text: N.protokollFehler(w.fehler) }));
  else if (!w.protokoll) rumpf.push(h("p", { "data-leer": "nutzung", text: N.keine }));
  else {
    rumpf.push(h("p", { text: N.kopf(w.aufrufe, datumKurz(w.seit)) }));
    rumpf.push(h("h4", { text: N.meist }));
    rumpf.push(w.meistgenutzt.length ? h("ul", { klasse: "nutzung-liste", "data-liste": "meist" }, w.meistgenutzt.map((e) => seiteEl(e.pfad, `${N.mal(e.anzahl)} · ${relativ(e.zuletzt)}`))) : h("p", { klasse: "leise", text: N.meistLeer }));
    rumpf.push(h("h4", { text: N.nie }));
    rumpf.push(w.nieGenutztGesamt ? h("p", { klasse: "leise", text: N.nieHinweis(w.nieGenutzt.length, w.nieGenutztGesamt) }) : h("p", { klasse: "leise", text: N.nieLeer }));
    if (w.nieGenutzt.length) rumpf.push(h("ul", { klasse: "nutzung-liste", "data-liste": "nie" }, w.nieGenutzt.map((p) => seiteEl(p))));
  }
  const d = dialog({ titel: N.titel, breit: true, rumpf, knoepfe: [] });
}
const stufenKlasse = (s) => (/rot|red|fehler/i.test(s || "") ? "rot" : /gelb|warn|yellow/i.test(s || "") ? "gelb" : /gr[uü]n|ok|green/i.test(s || "") ? "gruen" : "grau");

// ======================================================= Palette
function oeffnePalette(vorgabe = "") {
  if (dialogOffen()) return;
  const befehle = [
    [T.befehle.neu, "⌘N", oeffneNeu], [T.befehle.merken, "⌘⇧M", oeffneMerken], [T.befehle.commit, "⌘⇧G", oeffneCommit], [T.befehle.sync, "", sync],
    [T.befehle.suche, "⌘⇧F", fokusSuche], [T.befehle.inNotiz, "⌘F", () => ed.suchen()], [T.befehle.info, "⌘⌥I", umschalteInfo], [T.befehle.gesundheit, "", oeffneGesundheit], [T.befehle.nutzung, "", oeffneNutzung],
    [T.liste.verlauf, "", oeffneVerlauf],
    ...(inApp() ? [[T.befehle.ordner, "", () => aktion("ordner-zeigen", S.pfad || undefined)], [T.befehle.ansicht, "", oeffneUebersicht]] : []),
    [T.befehle.mcp, "", oeffneKi],
  ];
  const eingabe = h("input", { type: "text", placeholder: T.palette.platzhalter, "aria-label": T.palette.platzhalter, autocomplete: "off", spellcheck: "false", value: vorgabe, role: "combobox" });
  const liste = h("div", { klasse: "pal-liste", role: "listbox" });
  let eintraege = [], idx = 0;
  const grad = (d, q) => {
    const gleich = (x) => suchFormen(x).some((f) => suchFormen(q).includes(f));
    if (gleich(d.titel || "") || gleich(ohneEndung(dateiName(d.pfad)))) return -1; // genau getroffen
    const t = sucheGrad(d.titel || "", q);
    if (t) return t - 1; // Titel zählt vor Dateiname/Pfad
    const n = sucheGrad(ohneEndung(dateiName(d.pfad)), q);
    if (n) return 2 + n - 1;
    return sucheGrad(ohneEndung(d.pfad), q) ? 4 : 5;
  };
  const zeichne = () => {
    const q = eingabe.value.trim();
    const nur = q.startsWith(">");
    const qq = nur ? q.slice(1).trim() : q;
    const notizen = nur ? [] : (qq ? dateien().map((d) => ({ d, r: grad(d, qq) })).filter((x) => x.r < 5).sort((a, b) => a.r - b.r || a.d.pfad.length - b.d.pfad.length || a.d.pfad.localeCompare(b.d.pfad)).slice(0, 12).map((x) => x.d)
      : S.zuletzt.filter((p) => S.eintraege.has(p)).slice(0, 6).map((p) => S.eintraege.get(p)));
    const bef = befehle.filter(([t]) => !qq || sucheGrad(t, qq));
    eintraege = [...notizen.map((d) => ({ typ: "notiz", p: d.pfad, titel: S.nMap.get(d.pfad)?.titel || d.titel })), ...bef.map(([t, k, f]) => ({ typ: "befehl", t, k, f }))];
    // Ausdrücklicher Eintrag am Ende: nie still „Neue Notiz“ öffnen
    if (qq && !nur) eintraege.push({ typ: "anlegen", t: T.palette.anlegen(qq), k: "", titel: qq });
    const nurAnlegen = eintraege.length === 1 && eintraege[0].typ === "anlegen";
    idx = nurAnlegen ? -1 : Math.min(Math.max(idx, 0), Math.max(0, eintraege.length - 1));
    const teile = [];
    if (notizen.length) teile.push(h("div", { klasse: "pal-gruppe", text: qq ? T.palette.notizen : "Zuletzt" }));
    let i = 0;
    for (const e of eintraege) {
      if (e.typ === "befehl" && i === notizen.length) teile.push(h("div", { klasse: "pal-gruppe", text: T.palette.befehle }));
      if (e.typ === "anlegen" && (i > 0 || nurAnlegen)) teile.push(h("div", { klasse: "pal-gruppe", text: T.palette.nichtsGefunden && nurAnlegen ? T.palette.nichtsGefunden : "Anlegen" }));
      const mein = i;
      const name = e.typ === "notiz" ? (e.titel || ohneEndung(dateiName(e.p))) : e.t;
      teile.push(h("div", { klasse: "pal-eintrag", role: "option", "aria-selected": String(i === idx), "data-pal": e.typ, aufMouseenter: () => { idx = mein; markiere(); }, aufClick: () => waehle(mein) },
        h("span", { klasse: "n", text: name }),
        h("span", { klasse: "r", text: e.typ === "notiz" ? e.p : e.k })));
      i++;
    }
    liste.replaceChildren(...teile);
  };
  const markiere = () => { [...liste.querySelectorAll(".pal-eintrag")].forEach((el, i) => el.setAttribute("aria-selected", String(i === idx))); liste.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); };
  const waehle = (i) => { const e = eintraege[i]; if (!e) return; d.schliessen(); setTimeout(() => (e.typ === "notiz" ? oeffne(e.p) : e.typ === "anlegen" ? oeffneNeu(e.titel) : e.f()), 0); };
  eingabe.addEventListener("input", () => { idx = 0; zeichne(); });
  eingabe.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); idx = (idx + 1) % Math.max(1, eintraege.length); markiere(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = (idx + eintraege.length - 1) % Math.max(1, eintraege.length); markiere(); }
    else if (e.key === "Enter") { e.preventDefault(); waehle(idx); }
  });
  const d = dialog({ eigen: h("div", { klasse: "palette", role: "dialog", "aria-modal": "true" }, eingabe, liste) });
  eingabe.focus(); // sofort, nicht erst im nächsten Takt: schnell getippte Zeichen dürfen nicht verloren gehen
  zeichne();
}

// ======================================================= Eigenschaften ein/aus
// Ist das Fenster zu schmal, klappt die Spalte von selbst ein (die Einstellung bleibt); ein Klick holt sie trotzdem.
const infoSichtbar = () => S.infoAn && (!S.infoEng || S.infoErzwungen);
function umschalteInfo() {
  if (infoSichtbar()) { S.infoAn = false; S.infoErzwungen = false; }
  else { S.infoAn = true; S.infoErzwungen = !!S.infoEng; }
  speichereLokal("infoAn", S.infoAn);
  begrenzeBreiten();
}
$("app").dataset.info = S.infoAn ? "an" : "aus";
$("knopf-neu").addEventListener("click", () => oeffneNeu());
$("fuss-neu").addEventListener("click", () => oeffneNeu());
$("fuss-merken").addEventListener("click", oeffneMerken);

// ======================================================= Spaltenbreiten (Ziehen, Tastatur, Doppelklick = Standard)
const GRENZEN = { seite: [200, 380], liste: [248, 560], info: [248, 520] };
const standardBreite = (n) => (window.innerWidth < 1200 ? { seite: 224, liste: 272, info: 272 } : { seite: 252, liste: 308, info: 304 })[n];
const W = { seite: 252, liste: 308, info: 304 }; // gewünschte Breiten (gezogen, gespeichert)
const E = { ...W }; // tatsächliche Breiten, wenn das Fenster nicht für alle Wünsche reicht
const EDITOR_MIN = 420, EDITOR_MIN_MIT_INFO = 560;
function wendeBreitenAn() {
  const app = $("app");
  app.style.setProperty("--b-seite", E.seite + "px"); app.style.setProperty("--b-liste", E.liste + "px"); app.style.setProperty("--b-info-voll", E.info + "px");
}
function begrenzeBreiten() {
  for (const n of ["seite", "liste", "info"]) W[n] = Math.min(GRENZEN[n][1], Math.max(GRENZEN[n][0], W[n]));
  // Neben der Eigenschaften-Spalte soll der Editor mindestens 560 px behalten, sonst klappt sie ein
  S.infoEng = window.innerWidth < GRENZEN.seite[0] + GRENZEN.liste[0] + GRENZEN.info[0] + EDITOR_MIN_MIT_INFO;
  if (!S.infoEng) S.infoErzwungen = false;
  const zeige = infoSichtbar();
  Object.assign(E, W);
  let uebrig = window.innerWidth - E.seite - E.liste - (zeige ? E.info : 0) - (zeige && !S.infoErzwungen ? EDITOR_MIN_MIT_INFO : EDITOR_MIN);
  for (const n of zeige ? ["info", "liste", "seite"] : ["liste", "seite"]) {
    if (uebrig >= 0) break;
    const nimm = Math.min(E[n] - GRENZEN[n][0], -uebrig); E[n] -= nimm; uebrig += nimm;
  }
  $("app").dataset.info = zeige ? "an" : "aus";
  $("knopf-info")?.setAttribute("aria-pressed", String(zeige));
  wendeBreitenAn();
}
const speichereBreiten = () => speichereLokal("breiten", W);
function richteGriffeEin() {
  const gespeichert = leseLokal("breiten", null);
  for (const n of ["seite", "liste", "info"]) W[n] = gespeichert && Number.isFinite(gespeichert[n]) ? gespeichert[n] : standardBreite(n);
  begrenzeBreiten();
  const app = $("app");
  document.querySelectorAll(".griff").forEach((g) => {
    const name = g.dataset.griff;
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const start = e.clientX, b0 = E[name]; // vom sichtbaren Stand aus ziehen
      app.classList.add("zieht"); g.classList.add("aktiv");
      const move = (ev) => { W[name] = b0 + (name === "info" ? start - ev.clientX : ev.clientX - start); begrenzeBreiten(); };
      const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up); app.classList.remove("zieht"); g.classList.remove("aktiv"); speichereBreiten(); };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
    });
    g.addEventListener("dblclick", () => { W[name] = standardBreite(name); begrenzeBreiten(); speichereBreiten(); });
    g.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      W[name] = E[name] + (e.key === "ArrowRight" ? 16 : -16) * (name === "info" ? -1 : 1); begrenzeBreiten(); speichereBreiten();
    });
  });
  window.addEventListener("resize", begrenzeBreiten);
}

// ======================================================= Tastatur
function oeffneKuerzel() {
  if (dialogOffen()) return;
  const K = T.kuerzel;
  const d = dialog({
    titel: K.titel, breit: true,
    rumpf: [h("div", { klasse: "kuerzel" }, ...K.gruppen.map((g) => h("section", null, h("h3", { text: g.name }),
      h("dl", null, ...g.zeilen.flatMap(([tasten, was]) => [h("dt", null, ...tasten.split(" ").map((x) => h("kbd", { text: x }))), h("dd", { text: was })])))))],
    knoepfe: [h("button", { klasse: "knopf primaer", text: K.schliessen, aufClick: () => d.schliessen() })],
  });
}
window.addEventListener("keydown", (e) => {
  const mod = MOD_META ? e.metaKey : e.ctrlKey;
  if (!mod || e.isComposing) return;
  const k = e.key.toLowerCase();
  const tun = (f) => { e.preventDefault(); e.stopPropagation(); f(); };
  if (k === "s" && !e.shiftKey) tun(() => { clearTimeout(speicherTimer); speichere(); });
  else if (k === "n" && !e.shiftKey) tun(() => oeffneNeu());
  else if (k === "m" && e.shiftKey) tun(oeffneMerken);
  else if ((k === "k" || k === "p") && !e.shiftKey && !e.altKey) tun(() => oeffnePalette());
  else if (k === "f" && e.shiftKey) tun(fokusSuche);
  else if (k === "f" && !e.shiftKey && !e.altKey && !dialogOffen() && S.pfad && !e.target.closest?.("input, textarea, select")) tun(() => ed.suchen());
  else if ((k === "i" || e.code === "KeyI") && e.altKey) tun(umschalteInfo);
  else if (k === "g" && e.shiftKey) tun(oeffneCommit);
  else if ((k === "/" || e.code === "Slash") && !e.shiftKey && !e.altKey) tun(oeffneKuerzel);
}, true);

window.addEventListener("beforeunload", () => { if (S.dirty) { clearTimeout(speicherTimer); speichere(); } });
window.addEventListener("focus", () => { planeGitRefresh(); if (S.info?.vault) { ladeBaum(); ladeInfoLeise().then(() => fragVertrauenEinmal()); } });

// ======================================================= Vaults
async function ladeVaults() {
  try { S.vaultListe = await api.vaults(); } catch { S.vaultListe = null; }
  const aktiv = (S.vaultListe?.vaults || []).find((v) => v.pfad === (S.vaultListe?.aktiv || S.info?.vault));
  if (aktiv?.farbe && /^#[0-9a-fA-F]{6}$/.test(aktiv.farbe)) $("vault-farbe").style.setProperty("--vault-farbe", aktiv.farbe);
}
function vaultKopf() {
  const name = S.info?.name || PRODUKT;
  $("vault-name").textContent = name;
  $("vault-farbe").textContent = (name.trim()[0] || "B").toUpperCase();
}
async function wechsleVault(pfad) {
  if (!(await sichereVorWechsel())) return;
  try { await api.vaultAktiv(pfad); } catch (e) { toast(e.message, { fehler: true }); return; }
  aktion("vault-gewechselt");
  await ladeAlles();
  toast(T.vault.gewechselt(S.info?.name || PRODUKT));
}
async function oeffneVaultMenue() {
  const anker = $("vault-wechsler");
  if (anker.getAttribute("aria-expanded") === "true") { schliesseMenue(); return; }
  await ladeVaults();
  const liste = S.vaultListe?.vaults || [];
  const aktiv = S.vaultListe?.aktiv || S.info?.vault;
  const eintraege = [
    { gruppe: T.vault.liste },
    ...(liste.length ? liste.map((v) => ({ name: v.name, farbe: v.farbe || "var(--akzent)", sub: v.pfad === aktiv ? T.vault.aktiv : "", haken: v.pfad === aktiv, id: "vault", daten: v, tun: () => { if (v.pfad !== aktiv) wechsleVault(v.pfad); } })) : [{ leer: T.vault.keine }]),
    { trenner: true },
    { name: T.vault.oeffnen, symbol: "ordner-offen", id: "oeffnen", tun: () => vaultOeffnen() },
    { name: T.vault.neu, symbol: "plus", id: "neu", tun: () => vaultNeu() },
    ...(liste.length ? [{ trenner: true }, { name: T.vault.entfernen, symbol: "papierkorb", id: "entfernen", tun: () => vaultEntfernenMenue() }] : []),
  ];
  oeffneMenue(anker, eintraege, { breite: 232 });
}
$("vault-wechsler").addEventListener("click", oeffneVaultMenue);
async function vaultOeffnen() {
  if (!(await sichereVorWechsel())) return;
  try { const m = await import("./willkommen.js"); m.oeffneOrdnerFlow({ beiFertig: async () => { aktion("vault-gewechselt"); await ladeAlles(); }, beiStandNeu: karteStandNeu, beiVerbunden: () => { S.kiVerbunden = true; } }); }
  catch { toast("Das geht in dieser Version noch nicht.", { fehler: true }); }
}
async function vaultNeu() {
  if (!(await sichereVorWechsel())) return;
  try { const m = await import("./willkommen.js"); m.zeigeWillkommen({ modus: "neu", beiFertig: async () => { aktion("vault-gewechselt"); await ladeAlles(); }, beiAbbruch: () => {}, beiStandNeu: karteStandNeu, beiVerbunden: () => { S.kiVerbunden = true; } }); }
  catch { toast("Das geht in dieser Version noch nicht.", { fehler: true }); }
}
function vaultEntfernenMenue() {
  const liste = S.vaultListe?.vaults || [];
  oeffneMenue($("vault-wechsler"), [{ gruppe: T.vault.entfernen }, ...liste.map((v) => ({ name: v.name, farbe: v.farbe || "var(--akzent)", id: "entf", daten: v, tun: () => bestaetigeEntfernen(v) }))], { breite: 232 });
}
function bestaetigeEntfernen(v) {
  const d = dialog({ titel: T.vault.entfernenFrage(v.name), rumpf: [h("p", { text: T.vault.entfernenText }), h("p", { klasse: "mini", text: v.pfad })],
    knoepfe: [h("button", { klasse: "knopf", text: T.commit.abbrechen, aufClick: () => d.schliessen() }), h("button", { klasse: "knopf primaer", "data-aktion": "entfernen", text: T.vault.entfernen, aufClick: async () => {
      try {
        // IMMER zuerst sichern: ob der offene Vault betroffen ist, entscheidet erst die Werkstatt (Pfade können verschieden geschrieben sein)
        if (!(await sichereVorWechsel())) return;
        const vorher = S.info?.vault || null;
        await api.vaultEntfernen(v.pfad); d.schliessen(); toast(T.vault.entfernt); aktion("vault-gewechselt");
        let neu = null;
        try { neu = await api.info(); } catch { /* unten */ }
        // Der offene Vault war es (oder die Werkstatt antwortet nicht): alles neu laden. Sonst nur die Liste – Editor und Eingaben bleiben.
        if (!neu || (neu.vault || null) !== vorher) await ladeAlles(); else await ladeVaults();
      } catch (e) { toast(e.message, { fehler: true }); }
    } })] });
}

// ======================================================= Menübefehle der App
const MENUE_BEFEHLE = {
  neu: () => oeffneNeu(), merken: oeffneMerken, infospalte: umschalteInfo, palette: () => oeffnePalette(), commit: oeffneCommit, sync, suche: fokusSuche,
  "vault-oeffnen": vaultOeffnen, "vault-wechseln": oeffneVaultMenue, verlauf: oeffneVerlauf,
  posteingang: () => waehleSicht({ art: "bereich", id: "inbox" }), alle: () => waehleSicht({ art: "bereich", id: "alle" }), wissen: () => waehleSicht({ art: "bereich", id: "wissen" }),
  "hell-dunkel": () => setzeTheme(istDunkel() ? "hell" : "dunkel"),
};
// Ohne Vault gelten nur der Einstieg (Ordner öffnen) und die Darstellung; alles andere wird still verworfen
const OHNE_VAULT_ERLAUBT = new Set(["vault-oeffnen", "hell-dunkel"]);
const wartendeBefehle = [];
function fuehreBefehlAus(name) {
  const f = MENUE_BEFEHLE[name];
  if (!f || (!S.info?.vault && !OHNE_VAULT_ERLAUBT.has(name))) return;
  f();
}
window.studio = { bereit: false, neu: () => oeffneNeu(), merken: oeffneMerken, commit: oeffneCommit, info: umschalteInfo, palette: () => oeffnePalette(), sync, suche: fokusSuche };
window.studio.befehl = (name) => {
  if (!MENUE_BEFEHLE[name]) return;
  if (!window.studio.bereit) { wartendeBefehle.push(name); return; }
  fuehreBefehlAus(name);
};
// Vor Schließen/Beenden der App: sichert alles und meldet, ob nichts verloren geht (max. 5 s).
window.studio.vorSchliessen = () => {
  const arbeit = (async () => {
    clearTimeout(speicherTimer);
    if (!(await speichereAlles())) return { ok: false, grund: S.konflikt ? "konflikt" : letzterFehler || T.fehler.speichern };
    // Läuft noch ein Abgleich, Sichern, Klonen, Öffnen, Anlegen oder Remote-Verbinden, geht es wie bei ungespeicherten Eingaben: die App fragt nach
    const laeuft = laufendeArbeiten()[0];
    if (laeuft) return { ok: false, grund: ausTabelle(T.laeuft, laeuft) || T.laeuft.sonst };
    return { ok: true };
  })().catch((e) => ({ ok: false, grund: e?.message || "fehler" }));
  const frist = new Promise((r) => setTimeout(() => r({ ok: false, grund: "zeitueberschreitung" }), 5000));
  return Promise.race([arbeit, frist]);
};
function markiereBereit() {
  window.studio.bereit = true; window.__studioBereit = true;
  while (wartendeBefehle.length) { try { fuehreBefehlAus(wartendeBefehle.shift()); } catch { /* ein Befehl darf die anderen nicht stoppen */ } }
}

// ======================================================= Vertrauen (Spec §8)
// Nichts aus einem Vault startet ein Programm, bevor der Nutzer ihm vertraut hat: Kit-Werkzeuge (.tools), Git-Hooks, Git-Einstellungen.
// info.vertrauen = { erlaubt, noetig, geaendert, gitGesperrt, gruende: [{ art, text }] }; eine ältere Werkstatt kennt nur info.kit.
function vertrauenVon(info) {
  if (!info?.vault) return null;
  const v = info.vertrauen;
  if (v && typeof v === "object") {
    return { erlaubt: !!v.erlaubt, noetig: !!v.noetig, geaendert: !!v.geaendert, gitGesperrt: !!v.gitGesperrt,
      gruende: (Array.isArray(v.gruende) ? v.gruende : []).filter((g) => g && typeof g === "object") };
  }
  const kit = info.kit;
  if (kit && kit.vorhanden) return { erlaubt: !!kit.vertraut, noetig: true, geaendert: false, gitGesperrt: false, gruende: [{ art: "kit" }] };
  return null;
}
const istGitGesperrt = () => !!(S.info?.vertrauen?.gitGesperrt || S.git?.gesperrt);
const grundText = (g) => (typeof g.text === "string" && g.text.trim() ? g.text.trim() : ausTabelle(T.vertrauen.gruende, g.art) || T.vertrauen.gruende.sonst);

// Von selbst fragen wir je Vault und Sitzung einmal (und noch einmal, wenn sich der Code danach ändert); später geht es über die Statusleiste.
const vertrauenGefragt = new Set();
function fragVertrauenEinmal() {
  const v = vertrauenVon(S.info);
  if (!v || !v.noetig || v.erlaubt) return;
  const schluessel = S.info.vault + (v.geaendert ? "|geaendert" : "");
  if (vertrauenGefragt.has(schluessel)) return;
  // Erst eintragen, wenn die Frage wirklich aufgeht: sonst bliebe dieser Vault für den Rest der Sitzung ungefragt
  if (oeffneVertrauen()) vertrauenGefragt.add(schluessel);
}

// Die offene Frage gehört zu GENAU einem Vault: dem, dessen Name und Pfad im Dialog stehen. Wechselt der Vault, geht sie mit zu
// (zuruecksetzen), und erlaubt wird nur, was gezeigt wurde: der Pfad geht beim Klick mit (POST /api/kit/vertrauen { erlauben, vault }).
let vertrauenFrage = null; // { d, fuer }
function oeffneVertrauen() {
  const v = vertrauenVon(S.info);
  if (!v) return null;
  if (v.erlaubt) { toast(T.vertrauen.schon); return null; }
  const fuer = S.info.vault;
  if (vertrauenFrage) {
    if (vertrauenFrage.fuer === fuer && vertrauenFrage.d.box.isConnected) return vertrauenFrage.d; // schon offen, für denselben Vault
    vertrauenFrage.d.schliessen(); // gehörte zu einem anderen Vault
  }
  const gruende = v.gruende.length ? v.gruende : [{ art: istGitGesperrt() ? "git" : "sonst" }];
  const fehlerEl = h("div", { klasse: "fehlertext", role: "alert", hidden: true });
  // „Nicht jetzt“ hat den Fokus: ein versehentliches Enter erteilt kein Vertrauen
  const nein = h("button", { klasse: "knopf", type: "button", "data-aktion": "vertrauen-spaeter", text: T.vertrauen.spaeter, autofocus: true, aufClick: () => d.schliessen() });
  const ja = h("button", { klasse: "knopf primaer", type: "button", "data-aktion": "vertrauen-erlauben", text: T.vertrauen.erlauben });
  const d = dialog({
    titel: T.vertrauen.titel, breit: true,
    beiSchliessen: () => { if (vertrauenFrage?.d === d) vertrauenFrage = null; },
    rumpf: [
      v.geaendert ? h("p", { klasse: "vt-geaendert", "data-vertrauen": "geaendert", text: T.vertrauen.geaendert }) : null,
      h("p", { klasse: "mini vt-vault", title: fuer, text: `${S.info.name || PRODUKT} · ${fuer.replace(/^\/Users\/[^/]+(?=\/|$)/, "~")}` }),
      h("p", { text: T.vertrauen.intro }),
      h("ul", { klasse: "vt-gruende", "data-liste": "gruende" }, gruende.map((g) =>
        h("li", { "data-grund": typeof g.art === "string" ? g.art : "sonst" }, symbol(g.art === "kit" ? "code" : "zweig", 14), h("span", { text: grundText(g) })))),
      h("p", { klasse: "leise", text: T.vertrauen.folge }),
      v.gitGesperrt || istGitGesperrt() ? h("p", { klasse: "vt-git", "data-vertrauen": "git-gesperrt", text: T.vertrauen.gitGesperrt }) : null,
      h("p", { klasse: "mini", text: T.vertrauen.vorsicht }),
      fehlerEl,
    ],
    knoepfe: [nein, ja],
  });
  vertrauenFrage = { d, fuer };
  d.box.setAttribute("data-dialog", "vertrauen");
  d.box.setAttribute("data-vault", fuer);
  ja.addEventListener("click", async () => {
    // Zwischen Öffnen und Klick kann der Vault gewechselt haben: dann wird nichts erlaubt, sondern für den jetzigen neu gefragt
    if (S.info?.vault !== fuer) { d.schliessen(); oeffneVertrauen(); return; }
    ja.disabled = nein.disabled = true; ja.textContent = T.vertrauen.speichert; fehlerEl.hidden = true;
    let fehler = null;
    try { if (!(await vertrauenSetzen(true, fuer))) fehler = T.vertrauen.nichtGespeichert; }
    catch (e) {
      // Die Werkstatt hat inzwischen einen anderen Vault offen: nichts wurde erlaubt, die Oberfläche war veraltet
      if (andererVault(e)) { await nachAnderemVault(d); return; }
      fehler = e.message || T.vertrauen.nichtGespeichert;
    }
    if (!fehler) { d.schliessen(); toast(T.vertrauen.erteilt); return; }
    fehlerEl.hidden = false; fehlerEl.textContent = fehler;
    ja.disabled = nein.disabled = false; ja.textContent = T.vertrauen.erlauben;
  });
  return d;
}

// 409 anderer-vault: die Frage gehörte zu einem Vault, den die Werkstatt nicht (mehr) offen hat. Sie hat nichts erlaubt; hier die Frage
// zu, den Stand neu holen (anderer Vault: alles neu laden, das fragt dann für den jetzigen Vault von selbst).
async function nachAnderemVault(d) {
  d.schliessen();
  toast(T.vertrauen.andererVault, { fehler: true, ms: 8000 });
  const stand = await ladeStandNeu();
  if (stand.ok && vaultGewechselt(stand)) { aktion("vault-gewechselt"); await ladeAlles(); }
  else { await ladeInfoLeise(); oeffneVertrauen(); }
}

// POST /api/kit/vertrauen { erlauben, vault } → { kit, vertrauen }. Danach sagt die App Bescheid (Swift prüft neu), und Info, Git-Status, Index und Gesundheit
// werden neu geladen. Fiel die Git-Sperre weg, zeigen Verlauf-Ansicht und Notiz-Verlauf wieder den Verlauf statt „Git gesperrt“.
// true = der Vault ist jetzt vertraut.
async function vertrauenSetzen(erlauben, vault) {
  const warGesperrt = istGitGesperrt();
  const r = await api.kitVertrauen(erlauben, vault); // wirft bei Fehler: dann ist nichts passiert
  aktion("vertrauen-geaendert");
  if (r?.vertrauen && S.info && S.info.vault === vault) S.info = { ...S.info, vertrauen: r.vertrauen, ...(r.kit ? { kit: r.kit } : {}) };
  zeichneStatus();
  const nachAntwort = vertrauenVon(S.info);
  const [infoOk] = await Promise.all([ladeInfoLeise(), ladeGit(), ladeBaum(), ladeGesundheit()]);
  const jetzt = infoOk ? vertrauenVon(S.info) : nachAntwort;
  if (warGesperrt && !istGitGesperrt() && S.info?.vault === vault) {
    if (S.sicht.art === "verlauf") verlaufInst?.aktualisieren?.();
    ladeInfo(); // „Verlauf“ der offenen Notiz in den Eigenschaften
  }
  return !erlauben || !jetzt || jetzt.erlaubt;
}

// Info desselben Vaults übernehmen. Ging dabei das Vertrauen verloren (ein Abgleich hat anderen Code oder andere Hooks geholt), sagt die
// Oberfläche es der App (sie prüft neu und schließt die Übersicht) und die Frage kommt noch einmal (Spec §8, Vertrauen v2).
function setzeInfo(neu) {
  const davor = S.info && neu && S.info.vault === neu.vault ? vertrauenVon(S.info) : null;
  S.info = neu;
  const jetzt = vertrauenVon(neu);
  if (davor?.erlaubt && jetzt && !jetzt.erlaubt) {
    vertrauenGefragt.delete(neu.vault); vertrauenGefragt.delete(neu.vault + "|geaendert");
    aktion("vertrauen-geaendert");
  }
}

// Info der Werkstatt leise auffrischen (Vertrauen, Git-Kennzeichen): nur für denselben Vault
async function ladeInfoLeise() {
  if (!S.info?.vault) return false;
  try {
    const i = await api.info();
    if ((i.vault || null) !== S.info?.vault) return false;
    setzeInfo(i); zeichneStatus();
    return true;
  } catch { return false; }
}

// Eine Git-Aktion wurde abgewiesen, weil der Vault noch nicht vertraut ist: Stand auffrischen, dann die Frage zeigen
async function zeigeGitGesperrt() {
  await ladeInfoLeise(); await ladeGit();
  const v = vertrauenVon(S.info);
  if (v && !v.erlaubt) oeffneVertrauen(); else toast(T.fehler.gitGesperrt, { fehler: true });
}

// ======================================================= Start
function zuletztMerken(p) { S.zuletzt = [p, ...S.zuletzt.filter((x) => x !== p)].slice(0, 12); lokal.schreib("zuletzt", S.zuletzt); }

function zeigeLeer() {
  const hatDateien = dateien().length > 0;
  const el = $("leer");
  if (S.pfad) { el.hidden = true; $("editor").hidden = false; return; }
  $("editor").hidden = true; el.hidden = false;
  if (!hatDateien) {
    el.replaceChildren(
      h("div", { klasse: "zeichen" }, symbol("notiz", 26)),
      h("h2", { text: T.leer.titel }), h("p", { text: T.leer.text }),
      h("div", null, h("button", { klasse: "knopf primaer gross", "data-aktion": "erste", text: T.leer.knopf, aufClick: () => oeffneNeu() })),
      S.info && !S.info.git ? h("p", { klasse: "mini", style: "margin-top:14px", text: "Dieser Ordner ist noch nicht mit Git gesichert. Du kannst trotzdem schreiben." }) : null);
  } else {
    el.replaceChildren(
      h("div", { klasse: "zeichen" }, symbol("marke", 28)),
      h("h2", { text: T.editor.leer }), h("p", { text: T.editor.leerHinweis }),
      h("div", { klasse: "kurz" }, h("span", null, h("kbd", { text: "⌘K" }), "Springen"), h("span", null, h("kbd", { text: "⌘N" }), "Neu"), h("span", null, h("kbd", { text: "⌘⇧M" }), "Merken")));
  }
}

async function zeigeWillkommenFlow() {
  $("app").hidden = true;
  const host = $("willkommen-host");
  try {
    const m = await import("./willkommen.js");
    m.zeigeWillkommen({ modus: "start", beiFertig: async () => { aktion("vault-gewechselt"); await ladeAlles(); }, beiStandNeu: karteStandNeu, beiVerbunden: () => { S.kiVerbunden = true; } });
  } catch {
    host.hidden = false;
    host.replaceChildren(h("div", { klasse: "leer", style: "position:static;min-height:100vh" }, h("h2", { text: `Willkommen bei ${PRODUKT}` }), h("p", { text: "Der Einstieg ist gerade nicht verfügbar." })));
  }
}

let intervalle = false;
function zuruecksetzen() {
  clearTimeout(speicherTimer); clearTimeout(gitTimer); clearTimeout(baumTimer);
  S.pfad = null; S.hash = null; S.dirty = false; S.konflikt = null; S.schutz = false; S.speichert = false; S.aktuellePruefung = null;
  S.notizen = []; S.nMap = new Map(); S.baum = []; S.eintraege = new Map(); S.git = null; S.gesundheit = null; S.rueckfragen = null; S.syncFehler = null;
  S.suche = { aktiv: false, treffer: [], auswahl: 0, frage: "" }; S.vorVerlauf = null;
  S.sichtListe = []; S.gerendert = 0;
  ed.setzeText("", { nurLesen: false });
  schliesseDialoge(); // offene Dialoge (Vertrauen, Sichern, Neue Notiz …) gehören zum alten Vault; für den neuen fragt ladeAlles selbst
  schliesseDiff(); schliesseSuche(false);
  $("banner-host").replaceChildren(); $("pille").hidden = true; $("speicherstand").textContent = "";
  $("pfad").replaceChildren(); $("info").replaceChildren();
}
async function ladeAlles() {
  zuruecksetzen();
  $("editor").hidden = true;
  $("app").hidden = false;
  try { S.info = await api.info(); }
  catch (e) { $("leer").hidden = false; $("leer").replaceChildren(h("h2", { text: T.fehler.verbindung }), h("p", { text: e.message })); return; }
  if (!S.info.vault) { await zeigeWillkommenFlow(); markiereBereit(); return; } // auch der Einstieg ist „bereit“: Menübefehle (Ordner öffnen) gehen sofort
  $("willkommen-host").hidden = true; $("willkommen-host").replaceChildren();
  S.offen = new Set(lokal.lies("offen", [])); S.zu = new Set(lokal.lies("zu", [])); S.favoriten = new Set(lokal.lies("favoriten", [])); S.zuletzt = lokal.lies("zuletzt", []);
  S.sortierung = lokal.lies("sort", "geaendert");
  const sicht = lokal.lies("sicht", null);
  S.sicht = sicht && sicht.art && sicht.art !== "verlauf" ? sicht : { art: "bereich", id: "alle" };
  $("app").dataset.modus = "liste";
  vaultKopf(); setzeFenstertitel();
  zeichneWerkzeuge();
  await ladeBaum();
  if (S.sicht.art === "ordner" && !S.eintraege.has(S.sicht.id)) S.sicht = { art: "bereich", id: "alle" };
  if (S.sicht.art === "typ" && !S.typMap.has(S.sicht.id)) S.sicht = { art: "bereich", id: "alle" };
  zeichneSeite(); zeichneListe();
  fragVertrauenEinmal();
  ladeGit(); ladeGesundheit(); ladeKi(); ladeVaults();
  if (!intervalle) { intervalle = true; setInterval(ladeGit, 15000); setInterval(ladeGesundheit, 120000); }
  ladeInfo();
  const wunsch = new URLSearchParams(location.search).get("pfad") || lokal.lies("pfad", null);
  if (wunsch && S.eintraege.has(wunsch)) await oeffne(wunsch, { ausListe: true });
  zeigeLeer();
  markiereBereit();
}

richteGriffeEin();
ladeAlles();
