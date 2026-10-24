// Brain Studio — Oberfläche. Zustand, Seitenleiste, Editor-Anbindung, Infospalte, Statusleiste, Dialoge.
import { T, PRODUKT } from "./texte.js";
import { api, aktion, inApp } from "./api.js";
import { erstelleEditor } from "./editor.js";
import { h, dialog, dialogOffen, toast, vorMinuten, dateiName, ohneEndung, ordnerVon, istBearbeitbar, speichereLokal, leseLokal, leseEntwurf, speichereEntwurf, sucheGrad, suchFormen } from "./hilfen.js";

const $ = (id) => document.getElementById(id);
const MOD_META = /Mac|iPhone|iPad/.test(navigator.platform || "");

const S = {
  info: null, baum: [], eintraege: new Map(),
  bereich: leseLokal("bereich", "alle"),
  offen: new Set(leseLokal("offen", [])),
  pfad: null, hash: null, schutz: false, dirty: false, konflikt: null, speichert: false, nochmal: false, bearbeitbar: true,
  pruef: new Map(),      // "pfad|geaendert" -> stufe
  aktuellePruefung: null,
  git: null, gesundheit: null, rueckfragen: null, syncLaeuft: false,
  zuletzt: leseLokal("zuletzt", []),
  suche: { aktiv: false, treffer: [], auswahl: 0 },
  infoAn: leseLokal("infoAn", true),
  ladeNr: 0,
};

document.title = PRODUKT;
$("suche").placeholder = T.suche.platzhalter;
document.querySelector('[data-t="neu"]').textContent = T.seitenleiste.neu;
document.querySelector('[data-t="merken"]').textContent = T.seitenleiste.merken;

// ======================================================= Editor
let speicherTimer = null;
const ed = erstelleEditor($("editor"), {
  wikiAufloesen: (ziel) => loeseWikiAuf(ziel),
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
  const liste = dateien().filter((d) => !d.schreibschutz || true);
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
async function oeffne(pfad, { zeile } = {}) {
  if (pfad === S.pfad) { if (zeile) ed.springeZu(zeile); else ed.fokus(); return true; }
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
  ed.setzeText(d.inhalt, { nurLesen: S.schutz || !S.bearbeitbar });
  ed.setzeSignale([]);
  $("leer").hidden = true; $("editor").hidden = false;
  zeigeBanner(); zeigeStand(S.schutz ? "schutz" : "gespeichert", true);
  zuletztMerken(d.pfad);
  klappeAuf(d.pfad);
  zeichneBaum(); zeichnePfad();
  ladeInfo();
  if (zeile) ed.springeZu(zeile);
  else if (!document.querySelector(".schleier")) ed.fokus();
  speichereLokal("pfad", d.pfad);
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
    if (S.konflikt) return false;
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
    host.append(h("div", { klasse: "banner schutz", "data-banner": "schutz" }, h("span", { text: "🔒" }), h("span", { text: T.editor.schreibschutz })));
  } else if (!S.bearbeitbar) {
    host.append(h("div", { klasse: "banner schutz" }, h("span", { text: T.editor.nichtBearbeitbar })));
  }
}

// ======================================================= Seitenleiste
const BEREICHE = [
  ["inbox", "00_inbox/", '<path d="M2.5 9.5l1.6-5a1 1 0 011-.7h5.8a1 1 0 011 .7l1.6 5v2.3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V9.5zm0 0h3.2l.6 1.4h3.4l.6-1.4h3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'],
  ["wiki", "09_wiki/", '<path d="M3 3.5h4.2c.5 0 .8.3.8.8v8.7c0-.5-.4-.8-.8-.8H3zm10 0H8.8c-.5 0-.8.3-.8.8v8.7c0-.5.4-.8.8-.8H13z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'],
  ["notizen", null, '<path d="M4 2.5h6l2.5 2.5v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-9.5a1 1 0 011-1zM6 8h4M6 10.5h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'],
  ["alle", null, '<path d="M2.5 4.5a1 1 0 011-1h3l1.3 1.5h4.7a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1v-7.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'],
];
const imBereich = (pfad, b) => b === "inbox" ? pfad.startsWith("00_inbox/") : b === "wiki" ? pfad.startsWith("09_wiki/") : b === "notizen" ? !pfad.startsWith("09_wiki/") && !pfad.startsWith("00_inbox/") : true;
const bereichWurzel = (b) => (b === "inbox" ? "00_inbox" : b === "wiki" ? "09_wiki" : "");

function zeichneBereiche() {
  const inboxN = dateien().filter((d) => d.pfad.startsWith("00_inbox/")).length;
  const nav = $("bereiche");
  nav.replaceChildren(...BEREICHE.map(([id, , icon]) =>
    h("button", { klasse: "bereich", "data-bereich": id, "aria-current": S.bereich === id ? "true" : "false",
      aufClick: () => { S.bereich = id; speichereLokal("bereich", id); loescheSuche(); zeichneBereiche(); zeichneBaum(); } },
      h("span", { html: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${icon}</svg>` }),
      h("span", { text: T.bereiche[id] }),
      id === "inbox" && inboxN ? h("span", { klasse: "zahl", text: String(inboxN) }) : null)));
}

function baueBaum() {
  // Knoten: {pfad, art, name, kinder[]}; nur .md/.txt-Dateien und Ordner, die welche enthalten
  const wurzel = { pfad: "", kinder: [] };
  const knoten = new Map([["", wurzel]]);
  const praefix = bereichWurzel(S.bereich);
  const eintraege = S.baum.filter((e) => (e.art === "ordner" || istBearbeitbar(e.pfad)) && imBereich(e.pfad, S.bereich) || (praefix && e.pfad === praefix));
  const sicher = (pfad) => {
    if (knoten.has(pfad)) return knoten.get(pfad);
    const eltern = sicher(ordnerVon(pfad));
    const k = { pfad, art: "ordner", name: dateiName(pfad), kinder: [] };
    eltern.kinder.push(k); knoten.set(pfad, k); return k;
  };
  for (const e of eintraege) {
    if (e.pfad === praefix) continue;
    if (e.art === "datei") { const eltern = sicher(ordnerVon(e.pfad)); eltern.kinder.push({ pfad: e.pfad, art: "datei", name: dateiName(e.pfad), schutz: e.schreibschutz }); }
  }
  // Ordner nur mit Dateien darunter
  const leer = (k) => k.art === "datei" ? false : k.kinder.every(leer);
  const bereinige = (k) => { if (k.art === "datei") return; k.kinder = k.kinder.filter((c) => c.art === "datei" || !leer(c)); k.kinder.forEach(bereinige); };
  bereinige(wurzel);
  const sortiere = (k, invers) => {
    if (k.art === "datei") return;
    k.kinder.sort((a, b) => (a.art !== b.art ? (a.art === "ordner" ? -1 : 1) : invers && a.art === "datei" ? b.name.localeCompare(a.name, "de") : a.name.localeCompare(b.name, "de", { numeric: true })));
    k.kinder.forEach((c) => sortiere(c, invers));
  };
  sortiere(wurzel, S.bereich === "inbox");
  // Archiv-Ordner (90_*) ganz ans Ende der obersten Ebene
  const istArchiv = (k) => k.art === "ordner" && /^90_/.test(k.name);
  if (!praefix) wurzel.kinder.sort((a, b) => Number(istArchiv(a)) - Number(istArchiv(b)));
  let start = wurzel;
  if (praefix) start = knoten.get(praefix) || { kinder: [] };
  return start;
}

function zaehleDateien(k) { return k.art === "datei" ? 1 : (k.kinder || []).reduce((s, c) => s + zaehleDateien(c), 0); }

let beobachter = null;
function zeichneBaum() {
  const host = $("baum");
  if (S.suche.aktiv) return zeichneSuche();
  const wurzel = baueBaum();
  const zeilen = [];
  const tief = (k, t, archiv = false) => {
    for (const c of k.kinder) {
      const arch = archiv || (t === 0 && c.art === "ordner" && /^90_/.test(c.name));
      if (c.art === "ordner") {
        const offen = S.offen.has(c.pfad);
        zeilen.push(h("div", { klasse: "zeile ordner" + (arch ? " archiv" : ""), role: "treeitem", "aria-expanded": String(offen), style: `--tiefe:${t}`, "data-pfad": c.pfad,
          aufClick: () => { offen ? S.offen.delete(c.pfad) : S.offen.add(c.pfad); speichereLokal("offen", [...S.offen]); zeichneBaum(); } },
          h("span", { klasse: "pfeil" + (offen ? " offen" : ""), text: "›" }), h("span", { klasse: "name", text: c.name }), h("span", { klasse: "dim", text: String(zaehleDateien(c)) })));
        if (offen) tief(c, t + 1, arch);
      } else {
        const e = S.eintraege.get(c.pfad);
        const stufe = pruefStufeFuer(c.pfad, e);
        zeilen.push(h("div", { klasse: "zeile datei" + (c.schutz ? " schutz" : "") + (arch ? " archiv" : ""), role: "treeitem", "aria-selected": String(S.pfad === c.pfad), style: `--tiefe:${t}`, "data-pfad": c.pfad, title: c.pfad,
          aufClick: () => oeffne(c.pfad) },
          h("span", { klasse: "pfeil" }), h("span", { klasse: "name", text: ohneEndung(c.name) }),
          h("span", { klasse: "punkt " + (stufe || ""), "data-punkt": c.pfad })));
      }
    }
  };
  // Flache Dateien der obersten Ebene direkt zeigen
  tief(wurzel, 0);
  if (!zeilen.length) host.replaceChildren(h("div", { klasse: "hinweis-leer", text: T.seitenleiste.leerBaum }));
  else host.replaceChildren(...zeilen);
  beobachtePunkte();
}

function pruefStufeFuer(pfad, e) {
  if (!pfad.startsWith("09_wiki/")) return null;
  return S.pruef.get(pfad + "|" + (e?.geaendert ?? "")) || null;
}
const warteschlange = [];
let laufende = 0;
function beobachtePunkte() {
  beobachter?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  beobachter = new IntersectionObserver((eintraege) => {
    for (const x of eintraege) if (x.isIntersecting) {
      const p = x.target.dataset.pfad;
      beobachter.unobserve(x.target);
      if (p && p.startsWith("09_wiki/") && !pruefStufeFuer(p, S.eintraege.get(p))) { warteschlange.push(p); pumpe(); }
    }
  }, { root: $("baum"), rootMargin: "120px" });
  $("baum").querySelectorAll(".zeile.datei").forEach((z) => { if (z.dataset.pfad.startsWith("09_wiki/")) beobachter.observe(z); });
}
function pumpe() {
  while (laufende < 4 && warteschlange.length) {
    const p = warteschlange.shift();
    const e = S.eintraege.get(p);
    laufende++;
    api.pruefung(p).then((r) => {
      S.pruef.set(p + "|" + (e?.geaendert ?? ""), r.stufe);
      const el = $("baum").querySelector(`[data-punkt="${CSS.escape(p)}"]`);
      if (el) el.className = "punkt " + r.stufe;
    }).catch(() => {}).finally(() => { laufende--; pumpe(); });
  }
}

function klappeAuf(pfad) {
  let o = ordnerVon(pfad), geaendert = false;
  while (o) { if (!S.offen.has(o)) { S.offen.add(o); geaendert = true; } o = ordnerVon(o); }
  if (geaendert) speichereLokal("offen", [...S.offen]);
}

// ---- Suche im Vault
let sucheTimer = null, sucheNr = 0;
const sucheEl = $("suche");
sucheEl.addEventListener("input", () => {
  clearTimeout(sucheTimer);
  const q = sucheEl.value.trim();
  if (!q) { loescheSuche(); zeichneBaum(); return; }
  sucheTimer = setTimeout(async () => {
    const nr = ++sucheNr;
    try {
      const r = await api.suche(q);
      if (nr !== sucheNr) return;
      S.suche = { aktiv: true, treffer: r.treffer || [], auswahl: 0 };
      zeichneSuche();
    } catch (e) { toast(e.message, { fehler: true }); }
  }, 180);
});
sucheEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { sucheEl.value = ""; loescheSuche(); zeichneBaum(); sucheEl.blur(); ed.fokus(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!S.suche.aktiv) return;
    e.preventDefault();
    const n = S.suche.treffer.length;
    if (n) { S.suche.auswahl = (S.suche.auswahl + (e.key === "ArrowDown" ? 1 : n - 1)) % n; zeichneSuche(); }
  } else if (e.key === "Enter" && S.suche.aktiv) {
    const t = S.suche.treffer[S.suche.auswahl];
    if (t) oeffne(t.pfad, { zeile: t.zeile });
  }
});
function loescheSuche() { clearTimeout(sucheTimer); sucheNr++; S.suche = { aktiv: false, treffer: [], auswahl: 0 }; }
function zeichneSuche() {
  const host = $("baum");
  if (!S.suche.treffer.length) { host.replaceChildren(h("div", { klasse: "hinweis-leer", "data-suche": "leer", text: T.suche.keine })); return; }
  host.replaceChildren(...S.suche.treffer.map((t, i) =>
    h("div", { klasse: "treffer", role: "option", "data-suche": "treffer", "aria-selected": String(i === S.suche.auswahl), aufClick: () => oeffne(t.pfad, { zeile: t.zeile }) },
      h("span", { klasse: "t", text: t.titel || ohneEndung(dateiName(t.pfad)) }),
      t.auszug ? h("span", { klasse: "a", text: t.auszug }) : null,
      h("span", { klasse: "p", text: t.pfad }))));
  host.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}
function fokusSuche() { sucheEl.focus(); sucheEl.select(); }

// ======================================================= Kopfzeile
function zeichnePfad() {
  const p = $("pfad");
  if (!S.pfad) { p.replaceChildren(); return; }
  const teile = S.pfad.split("/");
  const name = ohneEndung(teile.pop());
  const kinder = [];
  teile.forEach((t) => { kinder.push(h("span", { text: t }), h("span", { klasse: "sep", text: "/" })); });
  kinder.push(h("b", { text: name }));
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

// ======================================================= Infospalte
let infoNr = 0;
async function ladeInfo() {
  const nr = ++infoNr, pfad = S.pfad;
  const host = $("info");
  if (!pfad) { host.replaceChildren(); zeichnePille(null); return; }
  const kopf = h("div", { klasse: "info-sektion", "data-sektion": "pruefung" }, h("h3", { text: T.info.pruefung }), h("div", { klasse: "leise", text: "…" }));
  const verlaufEl = h("div", { klasse: "info-sektion", "data-sektion": "verlauf" }, h("h3", { text: T.info.verlauf }));
  const rueckEl = h("div", { klasse: "info-sektion", "data-sektion": "rueck" }, h("h3", { text: T.info.rueckverweise }));
  host.replaceChildren(kopf, verlaufEl, rueckEl);

  api.pruefung(pfad).then((pr) => {
    if (nr !== infoNr) return;
    S.aktuellePruefung = pr;
    S.pruef.set(pfad + "|" + (S.eintraege.get(pfad)?.geaendert ?? ""), pr.stufe);
    const pu = $("baum").querySelector(`[data-punkt="${CSS.escape(pfad)}"]`); if (pu) pu.className = "punkt " + pr.stufe;
    zeichnePille(pr);
    const sig = pr.signale || [];
    kopf.replaceChildren(h("h3", { text: T.info.pruefung }),
      h("div", { klasse: "stufe-kopf " + pr.stufe }, h("i"), h("span", { text: T.stufen[pr.stufe] || "" })),
      h("p", { klasse: "stufe-text", text: pr.zusammenfassung || T.stufenHinweis[pr.stufe] || "" }),
      sig.length ? h("ul", { klasse: "signal-liste" }, sig.map((s) =>
        h("li", { klasse: s.zeile ? "sprung" : "", aufClick: s.zeile ? () => ed.springeZu(s.zeile) : null },
          h("span", { klasse: "art " + signalStufe(s) }), h("span", { text: s.text || s.art }), s.zeile ? h("span", { klasse: "z", text: `${T.suche.zeile} ${s.zeile}` }) : null)))
        : (pr.stufe === "grau" ? null : h("p", { klasse: "leise", text: T.info.keineSignale })));
    ed.setzeSignale(sig.filter((s) => s.zeile).map((s) => ({ zeile: s.zeile, stufe: signalStufe(s), text: s.text })));
  }).catch(() => { if (nr === infoNr) { kopf.replaceChildren(h("h3", { text: T.info.pruefung }), h("p", { klasse: "leise", text: T.fehler.allgemein })); zeichnePille(null); } });

  // Verlauf
  if (S.info && !S.info.git) verlaufEl.append(h("p", { klasse: "leise", text: T.info.keinGit }));
  else api.verlauf(pfad, 30).then((r) => {
    if (nr !== infoNr) return;
    const liste = r.eintraege || [];
    const offenMit = [];
    const geaendert = S.git?.geaendert?.find((g) => g.pfad === pfad);
    if (geaendert) offenMit.push(fassung({ nachricht: T.info.arbeitsstand, zeit: null, kurz: "", arbeitsstand: true }, pfad));
    liste.forEach((x) => offenMit.push(fassung(x, pfad)));
    if (!offenMit.length) verlaufEl.append(h("p", { klasse: "leise", text: T.info.keinVerlauf }));
    else verlaufEl.append(...offenMit);
  }).catch((e) => { if (nr === infoNr) verlaufEl.append(h("p", { klasse: "leise", text: e.status === 400 || e.status === 404 ? T.info.keinVerlauf : e.message })); });

  // Rückverweise
  const basis = ohneEndung(dateiName(pfad));
  api.suche("[[" + basis).then((r) => {
    if (nr !== infoNr) return;
    const gesehen = new Set();
    const t = (r.treffer || []).filter((x) => x.pfad !== pfad && !gesehen.has(x.pfad) && gesehen.add(x.pfad));
    if (!t.length) rueckEl.append(h("p", { klasse: "leise", text: T.info.keineRueck }));
    else rueckEl.append(...t.map((x) => h("a", { klasse: "rueck", "data-rueck": x.pfad, aufClick: () => oeffne(x.pfad, { zeile: x.zeile }) }, h("span", { text: x.titel || ohneEndung(dateiName(x.pfad)) }), h("span", { klasse: "p", text: x.pfad }))));
  }).catch(() => rueckEl.append(h("p", { klasse: "leise", text: T.info.keineRueck })));
}
const signalStufe = (s) => s.stufe || (/konflikt|zweifel|pruefbed|prüfbed|rot/i.test(s.art || "") ? "rot" : "gelb");

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
      } catch (e) { rumpf.replaceChildren(h("div", { klasse: "fehlertext", text: e.message })); }
    }
  } }, h("span", { klasse: "nachricht", text: x.nachricht }), h("span", { klasse: "meta", text: x.arbeitsstand ? "" : [x.autor, zeitText(x.zeit)].filter(Boolean).join(" · ") }));
  kopf.addEventListener("keydown", (e) => { if (e.key === "Enter") kopf.click(); });
  wurzel.append(kopf, rumpf);
  return wurzel;
}
function diffAnsicht(text) {
  if (!text || !text.trim()) return h("div", { klasse: "leise", text: T.info.keineAenderung });
  const zeilen = text.split("\n").filter((z, i, a) => !(i === a.length - 1 && z === ""));
  return h("div", { klasse: "diff", "data-diff": "" }, zeilen.map((z) => {
    const k = /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(z) ? "k" : z.startsWith("@@") ? "h" : z[0] === "+" ? "p" : z[0] === "-" ? "m" : "";
    return h("div", { klasse: k, text: z || " " });
  }));
}
async function stelleWiederHer(pfad, sha) {
  if (S.pfad !== pfad || S.schutz) return;
  try {
    const f = await api.fassung(pfad, sha);
    if (f.inhalt.includes("\r") && ed.view.state.lineBreak === "\n") { ed.setzeText(f.inhalt); S.dirty = true; ed.view.dispatch({}); zeigeStand("ungespeichert"); clearTimeout(speicherTimer); speicherTimer = setTimeout(speichere, 800); }
    else ed.ersetzeAlles(f.inhalt);
    toast(T.info.wiederhergestellt);
  } catch (e) { toast(e.message, { fehler: true }); }
}

// ======================================================= Statusleiste
const stEl = $("status");
function zeichneStatus() {
  const g = S.git, kinder = [];
  if (!S.info) { stEl.replaceChildren(); return; }
  if (!S.info.git || (g && !g.repo)) {
    kinder.push(h("span", { klasse: "st", "data-st": "kein-git", title: "Dieser Ordner ist nicht mit Git gesichert." }, h("span", { klasse: "d grau" }), h("span", { text: T.status.keinGit })));
  } else if (g) {
    const min = g.letzterSync ? vorMinuten(g.letzterSync) : null;
    const text = S.syncLaeuft ? T.status.gleicheAb : !g.remote ? T.status.keinRemote : min === null ? T.status.nieGesichert : T.status.gesichert(T.status.vorMin(min));
    const farbe = S.syncLaeuft ? "dreht" : !g.remote || min === null ? "grau" : g.vor > 0 || g.zurueck > 0 || g.geaendert.length ? "gelb" : "";
    kinder.push(h("button", { klasse: "st", "data-st": "sync", title: T.status.abgleichen, "aria-label": T.status.abgleichen, aufClick: sync }, h("span", { klasse: "d " + farbe }), h("span", { text })));
    kinder.push(h("span", { klasse: "trenner" }));
    kinder.push(h("span", { klasse: "st", "data-st": "zweig", title: g.upstream ? `Verbunden mit ${g.upstream}` : "Kein Remote-Zweig" }, h("span", { klasse: "zeichen", text: "⎇" }), h("span", { text: g.zweig || "–" }),
      g.upstream ? h("span", { text: `↑${g.vor} ↓${g.zurueck}` }) : null));
    const n = g.geaendert.length;
    kinder.push(h("span", { klasse: "trenner" }));
    kinder.push(h("button", { klasse: "st" + (n ? " hervor" : ""), "data-st": "geaendert", title: "Änderungen sichern (⌘⇧G)", aufClick: oeffneCommit }, h("span", { text: n ? T.status.geaendert(n) : T.status.sauber })));
  }
  const inboxN = dateien().filter((d) => d.pfad.startsWith("00_inbox/")).length;
  kinder.push(h("span", { klasse: "trenner" }));
  kinder.push(h("button", { klasse: "st", "data-st": "inbox", aufClick: () => { S.bereich = "inbox"; speichereLokal("bereich", "inbox"); loescheSuche(); zeichneBereiche(); zeichneBaum(); } }, h("span", { text: T.status.inbox(inboxN) })));
  const gs = S.gesundheit;
  if (S.rueckfragen && S.rueckfragen.verfuegbar !== false && Number.isFinite(S.rueckfragen.offen)) {
    kinder.push(h("span", { klasse: "trenner" }));
    kinder.push(h("span", { klasse: "st" + (S.rueckfragen.offen ? " hervor" : ""), "data-st": "rueckfragen", title: T.status.rueckfragenHinweis }, h("span", { text: T.status.rueckfragen(S.rueckfragen.offen) })));
  }
  if (gs && gs.verfuegbar !== false) {
    const w = Array.isArray(gs.warnungen) ? gs.warnungen.length : Number(gs.warnungen) || 0;
    const ampel = String(gs.ampel || "").toLowerCase();
    const farbe = /rot|red/.test(ampel) ? "rot" : /gelb|yellow|orange/.test(ampel) || w ? "gelb" : "";
    kinder.push(h("button", { klasse: "st", "data-st": "gesundheit", aufClick: oeffneGesundheit }, h("span", { klasse: "d " + farbe }), h("span", { text: T.status.gesundheit }), h("span", { text: w ? `⚠ ${w}` : "✓" })));
  }
  kinder.splice(kinder.length - 0, 0);
  stEl.replaceChildren(...kinder);
}
setInterval(() => { if (S.git) zeichneStatus(); }, 30000);

let gitTimer = null, baumTimer = null;
async function ladeGit() {
  try { S.git = await api.status(); } catch { S.git = null; }
  zeichneStatus();
  if (S.pfad) { /* Verlauf-Kopf „Ungesicherte Änderungen“ bleibt beim Öffnen aktuell */ }
}
function planeGitRefresh() { clearTimeout(gitTimer); gitTimer = setTimeout(ladeGit, 1200); }
function planeBaumRefresh() { clearTimeout(baumTimer); baumTimer = setTimeout(ladeBaum, 1500); }
async function ladeGesundheit() {
  try { S.gesundheit = await api.gesundheit(); } catch { S.gesundheit = null; }
  try { S.rueckfragen = await api.rueckfragen(); } catch { S.rueckfragen = null; }
  zeichneStatus();
}

async function sync() {
  if (S.syncLaeuft) return;
  if (S.dirty) { clearTimeout(speicherTimer); await speichereAlles(); }
  S.syncLaeuft = true; zeichneStatus();
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
    toast(e.status === 409 && e.daten?.dateien?.length ? `${e.message} Betroffen: ${e.daten.dateien.slice(0, 3).join(", ")}` : e.message, { fehler: true });
  } finally { S.syncLaeuft = false; await ladeGit(); }
}

// ======================================================= Commit-Dialog
async function oeffneCommit() {
  if (dialogOffen()) return;
  clearTimeout(speicherTimer);
  await speichereAlles();
  await ladeGit();
  if (!S.git?.repo) { toast(T.status.keinGit); return; }
  const liste = S.git.geaendert;
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
    try { await api.commit(msg.value.trim(), gewaehlt); d.schliessen(); toast(T.commit.fertig); await ladeGit(); ladeInfo(); }
    catch (e) { fehlerEl.hidden = false; fehlerEl.replaceChildren(document.createTextNode(e.message), ...(e.daten?.ausgabe ? [h("pre", { text: e.daten.ausgabe })] : [])); knopf.disabled = false; }
  };
  knopf.addEventListener("click", tun);
  msg.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tun(); } });
  msg.select();
}

// ======================================================= Neu / Merken / Gesundheit
function oeffneNeu(vorTitel) {
  if (dialogOffen()) return;
  const ordner = S.baum.filter((e) => e.art === "ordner" && !e.schreibschutz).map((e) => e.pfad);
  const vorgabe = S.pfad && ordnerVon(S.pfad) ? ordnerVon(S.pfad) : ordner.includes("00_inbox") ? "00_inbox" : ordner[0] || "";
  const sel = h("select", { "data-feld": "ordner" }, ordner.length ? ordner.map((o) => h("option", { value: o, selected: o === vorgabe, text: o })) : h("option", { value: "", text: "Hauptordner" }));
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
const stufenKlasse = (s) => (/rot|red|fehler/i.test(s || "") ? "rot" : /gelb|warn|yellow/i.test(s || "") ? "gelb" : /gr[uü]n|ok|green/i.test(s || "") ? "gruen" : "grau");

// ======================================================= Palette
function oeffnePalette(vorgabe = "") {
  if (dialogOffen()) return;
  const befehle = [
    [T.befehle.neu, "⌘N", oeffneNeu], [T.befehle.merken, "⌘⇧M", oeffneMerken], [T.befehle.commit, "⌘⇧G", oeffneCommit], [T.befehle.sync, "", sync],
    [T.befehle.suche, "⌘⇧F", fokusSuche], [T.befehle.inNotiz, "⌘F", () => ed.suchen()], [T.befehle.info, "⌘⌥I", umschalteInfo], [T.befehle.gesundheit, "", oeffneGesundheit],
    ...(inApp() ? [[T.befehle.ordner, "", () => aktion("ordner-zeigen", S.pfad || undefined)], [T.befehle.ansicht, "", () => aktion("ansicht")]] : []),
    [T.befehle.mcp, "", verbindeMcp],
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
    eintraege = [...notizen.map((d) => ({ typ: "notiz", p: d.pfad, titel: d.titel })), ...bef.map(([t, k, f]) => ({ typ: "befehl", t, k, f }))];
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
async function verbindeMcp() {
  try { await api.mcpVerbinden(); toast(T.mcp.ok); }
  catch (e) {
    const befehl = e.daten?.befehl;
    if (befehl) { try { await navigator.clipboard.writeText(befehl); } catch { /* ohne Zwischenablage */ } toast(`${T.mcp.befehl} ${befehl}`, { ms: 12000 }); }
    else toast(e.message, { fehler: true });
  }
}

// ======================================================= Info ein/aus
function umschalteInfo() {
  S.infoAn = !S.infoAn; speichereLokal("infoAn", S.infoAn);
  $("app").dataset.info = S.infoAn ? "an" : "aus";
  $("knopf-info").setAttribute("aria-pressed", String(S.infoAn));
}
$("app").dataset.info = S.infoAn ? "an" : "aus";
$("knopf-info").setAttribute("aria-pressed", String(S.infoAn));
$("knopf-info").addEventListener("click", umschalteInfo);
$("knopf-neu").addEventListener("click", oeffneNeu);
$("fuss-neu").addEventListener("click", oeffneNeu);
$("fuss-merken").addEventListener("click", oeffneMerken);

// ======================================================= Tastatur
window.addEventListener("keydown", (e) => {
  const mod = MOD_META ? e.metaKey : e.ctrlKey;
  if (!mod || e.isComposing) return;
  const k = e.key.toLowerCase();
  const tun = (f) => { e.preventDefault(); e.stopPropagation(); f(); };
  if (k === "s" && !e.shiftKey) tun(() => { clearTimeout(speicherTimer); speichere(); });
  else if (k === "n" && !e.shiftKey) tun(oeffneNeu);
  else if (k === "m" && e.shiftKey) tun(oeffneMerken);
  else if ((k === "k" || k === "p") && !e.shiftKey && !e.altKey) tun(() => oeffnePalette());
  else if (k === "f" && e.shiftKey) tun(fokusSuche);
  else if (k === "f" && !e.shiftKey && !e.altKey && !dialogOffen() && S.pfad && !e.target.closest?.("input, textarea, select")) tun(() => ed.suchen());
  else if ((k === "i" || e.code === "KeyI") && e.altKey) tun(umschalteInfo);
  else if (k === "g" && e.shiftKey) tun(oeffneCommit);
}, true);

window.addEventListener("beforeunload", () => { if (S.dirty) { clearTimeout(speicherTimer); speichere(); } });
window.addEventListener("focus", () => { planeGitRefresh(); ladeBaum(); });
// Schnittstelle für Menüs der App
window.studio = { bereit: false, neu: oeffneNeu, merken: oeffneMerken, commit: oeffneCommit, info: umschalteInfo, palette: () => oeffnePalette(), sync, suche: fokusSuche };
// Menübefehle der App (StudioBefehl in AppAktion.swift): window.studio.befehl("<name>").
// Kommt ein Befehl vor dem fertigen Start, wartet er in einer Schlange.
const MENUE_BEFEHLE = { neu: oeffneNeu, merken: oeffneMerken, infospalte: umschalteInfo, palette: () => oeffnePalette(), commit: oeffneCommit, sync, suche: fokusSuche };
const wartendeBefehle = [];
window.studio.befehl = (name) => {
  const f = MENUE_BEFEHLE[name];
  if (!f) return;
  if (!window.studio.bereit) { wartendeBefehle.push(f); return; }
  f();
};
// Vor Schließen/Beenden der App: sichert alles und meldet, ob nichts verloren geht (max. 5 s).
window.studio.vorSchliessen = () => {
  const arbeit = (async () => {
    clearTimeout(speicherTimer);
    if (await speichereAlles()) return { ok: true };
    return { ok: false, grund: S.konflikt ? "konflikt" : letzterFehler || T.fehler.speichern };
  })().catch((e) => ({ ok: false, grund: e?.message || "fehler" }));
  const frist = new Promise((r) => setTimeout(() => r({ ok: false, grund: "zeitueberschreitung" }), 5000));
  return Promise.race([arbeit, frist]);
};
function markiereBereit() {
  window.studio.bereit = true; window.__studioBereit = true;
  while (wartendeBefehle.length) { try { wartendeBefehle.shift()(); } catch { /* ein Befehl darf die anderen nicht stoppen */ } }
}

// ======================================================= Kit-Vertrauen (W-5)
// Nur sichtbar, wenn das Backend das Feld liefert; ohne `kit` verhält sich die Oberfläche wie bisher.
function zeigeKitHinweis() {
  const host = $("kit-host");
  host.replaceChildren();
  const kit = S.info?.kit;
  if (!kit || !kit.vorhanden || kit.vertraut || S.kitJetztNicht) return;
  const zu = (erlauben) => async () => {
    if (!erlauben) { S.kitJetztNicht = true; zeigeKitHinweis(); return; }
    try {
      await api.kitVertrauen(true);
      S.info.kit = { ...kit, vertraut: true };
      zeigeKitHinweis();
      await ladeGesundheit();
    } catch (e) { toast(e.message, { fehler: true }); }
  };
  host.append(h("div", { klasse: "banner kit", role: "status", "data-banner": "kit" },
    h("div", { klasse: "b-text" }, h("div", { klasse: "b-sub", text: T.kit.hinweis })),
    h("button", { klasse: "knopf", "data-aktion": "kit-spaeter", text: T.kit.spaeter, aufClick: zu(false) }),
    h("button", { klasse: "knopf primaer", "data-aktion": "kit-erlauben", text: T.kit.erlauben, aufClick: zu(true) })));
}

// ======================================================= Start
function zuletztMerken(p) { S.zuletzt = [p, ...S.zuletzt.filter((x) => x !== p)].slice(0, 12); speichereLokal("zuletzt", S.zuletzt); }

async function ladeBaum() {
  try {
    const r = await api.baum();
    S.baum = r.eintraege || [];
    S.eintraege = new Map(S.baum.map((e) => [e.pfad, e]));
    wikiIndex = null;
  } catch (e) { toast(e.message, { fehler: true }); return; }
  zeichneBereiche(); zeichneBaum(); zeichneStatus(); zeigeLeer();
}

function zeigeLeer() {
  const hatDateien = dateien().length > 0;
  const el = $("leer");
  if (S.pfad) { el.hidden = true; $("editor").hidden = false; return; }
  $("editor").hidden = true; el.hidden = false;
  if (!hatDateien) {
    el.replaceChildren(
      h("div", { klasse: "zeichen", html: '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M6 3.5h8l4 4v12a1 1 0 01-1 1H6a1 1 0 01-1-1v-15a1 1 0 011-1zM14 3.5v4h4M8.5 12h7M8.5 15.5h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      h("h2", { text: T.leer.titel }), h("p", { text: T.leer.text }),
      h("div", null, h("button", { klasse: "knopf primaer gross", "data-aktion": "erste", text: T.leer.knopf, aufClick: oeffneNeu })),
      S.info && !S.info.git ? h("p", { klasse: "mini", text: "Dieser Ordner ist noch nicht mit Git gesichert. Du kannst trotzdem schreiben." }) : null);
  } else {
    el.replaceChildren(
      h("div", { klasse: "zeichen", html: '<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"/></svg>' }),
      h("h2", { text: T.editor.leer }), h("p", { text: T.editor.leerHinweis }),
      h("div", { klasse: "kurz" }, h("span", null, h("kbd", { text: "⌘K" }), "Springen"), h("span", null, h("kbd", { text: "⌘N" }), "Neu"), h("span", null, h("kbd", { text: "⌘⇧M" }), "Merken")));
  }
}

async function start() {
  $("editor").hidden = true;
  try { S.info = await api.info(); }
  catch (e) { $("leer").hidden = false; $("leer").replaceChildren(h("h2", { text: T.fehler.verbindung }), h("p", { text: e.message })); return; }
  $("vault-name").textContent = S.info.name || PRODUKT;
  await ladeBaum();
  zeigeKitHinweis();
  ladeGit(); ladeGesundheit();
  setInterval(ladeGit, 15000); setInterval(ladeGesundheit, 120000);
  const wunsch = new URLSearchParams(location.search).get("pfad") || leseLokal("pfad", null);
  if (wunsch && S.eintraege.has(wunsch)) await oeffne(wunsch);
  markiereBereit();
}
start();
