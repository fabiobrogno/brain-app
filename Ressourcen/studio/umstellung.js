// „Vault umstellen“ (P7c): die Oberfläche für die Umstellung eines Vaults aus der Kit-Zeit (Plan docs/plaene/p7-umstellung.md, Abschnitt 7).
// Die Werkstatt-Routen (werkstatt/umstellung.mjs) tun die Arbeit; hier steht nur, was der Nutzer sieht und entscheidet:
//   Befund in vier Gruppen · Entscheidungen · Schritt 1 Probelauf an einer Kopie · Schritt 2 Umstellen · Rückweg · Protokoll · Kopie löschen.
// Geschrieben wird nur nach einem Klick (die Routen verlangen bestaetigt: true). Kein innerHTML mit fremden Daten: alles über h() und textContent.
import { h, dialog, arbeitBeginnt, toast, speichereLokal, leseLokal } from "./hilfen.js";
import { knopf as baueKnopf, hakenFeld } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { api as standardApi, nichtVertraut, ausgangUnklar } from "./api.js";
import { TU } from "./texte-umstellung.js";

// ---------------------------------------------------------------- Stylesheet (lädt sich selbst, einmalig)
const CSS_URL = new URL("./umstellung.css", import.meta.url).href;
export function ladeUmstellungCss() {
  const da = document.querySelector("link[data-umstellung-css]");
  if (da) return da._bereit || Promise.resolve();
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS_URL;
  l.setAttribute("data-umstellung-css", "");
  l._bereit = new Promise((ok) => { l.onload = ok; l.onerror = ok; setTimeout(ok, 2500); });
  document.head.append(l);
  return l._bereit;
}

const zeichen = (name, groesse = 14) => { const s = symbol(name, groesse); s.setAttribute("aria-hidden", "true"); return s; };
const ALLE_SCHRITTE = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
const ENT_BOOL = ["gitSchluessel", "verweiseAufloesen", "remoteEntfernen", "remoteBestaetigen", "hooksErsetzen", "mcpAnders", "dienstAnderer"];
// Welche Frage des Befunds (Feld „aktion“) welche Entscheidung der Werkstatt-Whitelist ist. Fragen ohne Eintrag hier kennen die Schritte der Phase A nicht: sie stehen unter „Nur zur Info“.
const AKTION_ZU_ENT = {
  "git-schluessel-verschieben": "gitSchluessel", "git-verweise-aufloesen": "verweiseAufloesen", "remote-entfernen": "remoteEntfernen", "sicherung-bestaetigen": "remoteBestaetigen",
  "hooks-ersetzen-fragen": "hooksErsetzen", "mcp-umstellen-fragen": "mcpAnders", "dienst-umstellen-fragen": "dienstAnderer", "weitere-macs-fragen": "weitereMacs",
};
const STANDARD = { gitSchluessel: true, verweiseAufloesen: false, remoteEntfernen: false, remoteBestaetigen: false, hooksErsetzen: false, mcpAnders: false, dienstAnderer: false };

// Befund → vier Gruppen. Blocker, die erst das spätere Aufräumen betreffen (blockiertPhase „B“), sperren nichts und stehen bei den Infos.
export function teileBefund(befund) {
  const g = { auto: [], frage: [], hinweis: [], blocker: [] };
  for (const f of befund?.funde || []) {
    if (f.schwere === "blocker") (f.blockiertPhase === "B" ? g.hinweis : g.blocker).push(f.blockiertPhase === "B" ? { ...f, spaeter: true } : f);
    else if (f.schwere === "frage") (AKTION_ZU_ENT[f.aktion] ? g.frage : g.hinweis).push(f);
    else if (g[f.schwere]) g[f.schwere].push(f);
  }
  return g;
}
// Fängt die Umstellung schon an, ist sie fertig oder hängt sie? (Rückweg-Liste zeigen)
const hatUmstellung = (stand) => !!stand && (stand.phase === "A" || Object.values(stand.schritte || {}).some((s) => ["ok", "fehler", "laeuft"].includes(s?.status)));
const unterbrochen = (stand) => !!stand && stand.phase !== "A" && (stand.unterbrochen === true || Object.values(stand.schritte || {}).some((s) => ["ok", "laeuft"].includes(s?.status)));

const uhrzeit = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ""; return new Date(t).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }); };
// Schritte A0–A9, Prüfpunkte K1–K9 des Probelaufs und „Kopie“ (Kopie gelöscht) im Protokoll
const schrittName = (id) => (Object.hasOwn(TU.schritte, id) ? TU.schritte[id] : /^K[0-9]$/.test(String(id)) ? TU.protokoll.pruefpunkt(String(id).slice(1)) : id);

function details(text) {
  return h("details", { klasse: "um-details" }, h("summary", { text: TU.details }), h("pre", { tabindex: "0", text }));
}
// Marke vor einer Zeile: Zustand nie nur durch Farbe (Symbol + Text daneben)
function marke(art) {
  const sym = art === "gruen" ? "haken" : art === "rot" ? "schliessen" : art === "warn" ? "warnung" : art === "laeuft" ? "sync" : null;
  return h("span", { klasse: "um-marke", "data-marke": art, "aria-hidden": "true" }, sym ? zeichen(sym, 12) : null);
}
const ampelArt = (status) => (status === "gruen" ? "gruen" : status === "rot" ? "rot" : "aus");
const statusArt = (status) => (status === "ok" ? "gruen" : status === "fehler" || status === "rot" ? "rot" : status === "laeuft" ? "laeuft" : status === "zurueck" ? "warn" : "aus");

// ---------------------------------------------------------------- Hinweis für das Studio (Banner und Einstellungen)
// → { altlasten, umgestellt, angefangen } oder null, wenn nichts zu melden ist. Billig zuerst (ein lstat), der Befund nur bei altem Werkzeug-Ordner.
export async function leseUmstellungHinweis(api = standardApi) {
  const hw = await api.umstellungHinweis();
  if (!hw?.altesWerkzeug) return null;
  const [befund, stand] = await Promise.all([api.umstellungBefund(), api.umstellungStand()]);
  const umgestellt = stand?.phase === "A";
  const altlasten = befund?.kitZeit === true && !umgestellt;
  if (!altlasten && !umgestellt) return null;
  return { altlasten, umgestellt, angefangen: unterbrochen(stand) };
}
export function baueUmstellungBanner({ beiOeffnen, beiZu } = {}) {
  ladeUmstellungCss();
  const auf = baueKnopf({ text: TU.banner.knopf, variante: "primaer", aktion: "umstellung-banner-oeffnen", aufKlick: () => beiOeffnen?.() });
  const zu = baueKnopf({ text: TU.banner.zu, aktion: "umstellung-banner-zu", titel: TU.banner.zuTitel, aufKlick: () => beiZu?.() });
  return h("div", { klasse: "banner kit um-banner", role: "status", "data-banner": "umstellung" },
    zeichen("info", 14),
    h("div", { klasse: "b-text" }, h("div", { klasse: "b-titel", text: TU.banner.titel }), h("div", { klasse: "b-sub", text: TU.banner.text })),
    auf, zu);
}

// ---------------------------------------------------------------- Dialog
// vault = Pfad des offenen Vaults (merkt den Probelauf), vertraut = Stand aus /api/info (null = unbekannt), beiVertrauen() öffnet die Vertrauensfrage der App,
// beiAenderung() meldet der App, dass sich Umstellung oder Vertrauen geändert haben (Status der Menüleiste neu lesen, Hinweis neu prüfen).
export function oeffneUmstellungDialog({ api = standardApi, vault = null, vertraut = null, beiVertrauen, beiAenderung, beiZu } = {}) {
  ladeUmstellungCss();
  const S = {
    ansicht: "haupt", laedt: true, fehler: null, befund: null, stand: null, nichtVertraut: vertraut === false,
    ent: { ...STANDARD, profile: null, weitereMacs: null, nachbarkopie: false },
    probe: { laeuft: false, ergebnis: null, fehler: null, key: null, platzFehler: false },
    um: { frage: false, laeuft: false, ergebnis: null, fehler: null, live: null },
    rw: { liste: null, laeuft: null, ergebnis: null, frageAlles: false, fehler: null },
    kopie: { laeuft: false },
    protokoll: { laedt: false, daten: null, fehler: null },
  };
  let tot = false;
  const uhren = new Set();
  const fertigMelden = () => { try { beiAenderung?.(); } catch { /* die App meldet sich selbst */ } };

  // ----- Aufbau
  const intro = h("p", { klasse: "um-intro", "data-um": "intro" });
  const secHinweis = h("div", { klasse: "um-sektion", "data-um": "hinweis" });
  const secBefund = h("div", { klasse: "um-sektion", "data-um": "befund" });
  const secProbe = h("section", { klasse: "um-sektion", "data-um": "probe" });
  const secUmstellen = h("section", { klasse: "um-sektion", "data-um": "umstellen" });
  const secRueckweg = h("section", { klasse: "um-sektion", "data-um": "rueckweg" });
  const secKopie = h("div", { klasse: "um-sektion", "data-um": "kopie" });
  const haupt = h("div", { klasse: "um-haupt" }, secHinweis, secBefund, secProbe, secUmstellen, secRueckweg, secKopie);
  const secProtokoll = h("div", { klasse: "um-haupt", "data-um": "protokoll", hidden: true });
  const rumpf = h("div", { klasse: "um-rumpf" }, haupt, secProtokoll);
  const protokollKnopf = baueKnopf({ text: TU.protokoll.knopf, aktion: "umstellung-protokoll", aufKlick: () => zeigeProtokoll() });
  const zuKnopf = baueKnopf({ text: TU.schliessen, groesse: "l", aktion: "umstellung-schliessen", aufKlick: () => { if (S.ansicht === "protokoll") { S.ansicht = "haupt"; zeichneAnsicht(); } else d.schliessen(); } });
  const box = h("div", { klasse: "dialog um-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "um-titel", "data-dialog": "umstellung" },
    h("div", { klasse: "um-kopf" }, h("h2", { klasse: "um-titel", id: "um-titel", text: TU.titel }), intro),
    rumpf,
    h("div", { klasse: "um-fuss" }, protokollKnopf, h("span", { klasse: "um-fuss-platz" }), zuKnopf));
  const d = dialog({
    eigen: box,
    beiSchliessen: () => { tot = true; for (const u of uhren) clearInterval(u); uhren.clear(); beiZu?.(); },
  });
  // Fokus auf „Schließen“ (die sicherste Taste), nicht auf einen Schalter
  setTimeout(() => zuKnopf.focus(), 10);

  // ----- Entscheidungen, wie sie an die Werkstatt gehen (immer dieselbe Form: Probelauf und Umstellen müssen dieselben Entscheidungen bekommen)
  const profile = () => S.befund?.profile || [];
  function sendeEnt() {
    const e = {};
    for (const k of ENT_BOOL) e[k] = !!S.ent[k];
    e.nachbarkopie = !!S.ent.nachbarkopie;
    if (S.ent.weitereMacs === "ja" || S.ent.weitereMacs === "nein") e.weitereMacs = S.ent.weitereMacs;
    if (profile().length > 1 && Array.isArray(S.ent.profile)) e.profile = [...S.ent.profile];
    return e;
  }
  const entKey = () => JSON.stringify(sendeEnt());
  const gruenFuerEntscheidungen = () => {
    const p = S.stand?.probelauf;
    return !!p && p.ampel === "gruen" && p.gueltig === true && S.probe.key !== null && S.probe.key === entKey();
  };
  const blockiert = () => !!S.befund && S.befund.umstellbar === false;
  const geaendert = () => { S.um.frage = false; zeichneProbe(); zeichneUmstellen(); };

  // ----- Laden
  async function ladeStand() { try { S.stand = await api.umstellungStand(); } catch { /* der alte Stand bleibt */ } }
  async function ladeRueckweg() {
    if (!hatUmstellung(S.stand)) { S.rw.liste = null; return; }
    try { S.rw.liste = (await api.umstellungRueckwegListe()).schritte || []; } catch { S.rw.liste = null; }
  }
  function entscheidungenAufnehmen() {
    const ps = profile();
    S.ent.profile = ps.length > 1 ? (Array.isArray(S.ent.profile) ? S.ent.profile.filter((p) => ps.some((x) => x.pfad === p)) : ps.map((p) => p.pfad)) : null;
  }
  // Ein grüner Probelauf aus einer früheren Sitzung gilt nur, wenn wir wissen, mit welchen Entscheidungen er lief (merken wir uns je Vault und Zeitstempel)
  function probeWiederherstellen() {
    const p = S.stand?.probelauf;
    const gesp = leseLokal("umstellung-probe", null);
    if (!p || p.ampel !== "gruen" || !gesp || gesp.vault !== vault || gesp.zeit !== p.zeit || !gesp.ent) return;
    S.ent = { ...S.ent, ...gesp.ent, profile: Array.isArray(gesp.ent.profile) ? gesp.ent.profile : S.ent.profile, weitereMacs: gesp.ent.weitereMacs ?? null };
    entscheidungenAufnehmen();
    S.probe.key = entKey();
  }
  async function lade() {
    S.laedt = true; S.fehler = null; zeichneAlles();
    try {
      const [befund, stand] = await Promise.all([api.umstellungBefund(), api.umstellungStand()]);
      if (tot) return;
      S.befund = befund; S.stand = stand;
      entscheidungenAufnehmen();
      probeWiederherstellen();
      await ladeRueckweg();
    } catch (e) { if (tot) return; S.fehler = e; }
    S.laedt = false;
    zeichneAlles();
    if (S.stand?.laeuft) beobachteLauf();
  }
  // Läuft schon eine Umstellung (anderes Fenster, früherer Start): Fortschritt zeigen, bis sie fertig ist
  function beobachteLauf() {
    S.um.laeuft = true; S.um.live = S.stand?.schritte || null; zeichneUmstellen();
    const u = setInterval(async () => {
      await ladeStand();
      if (tot) return;
      S.um.live = S.stand?.schritte || null;
      if (S.stand && !S.stand.laeuft) { clearInterval(u); uhren.delete(u); S.um.laeuft = false; await lade(); } else zeichneSchrittListe();
    }, 2000);
    uhren.add(u);
  }

  // Das Ergebnis einer langen Arbeit steht oft ausserhalb des sichtbaren Ausschnitts: nach dem Zeichnen an den Anfang des Ausschnitts holen (sofort, ohne Animation)
  const zeigeStelle = (sec, auswahl) => requestAnimationFrame(() => { if (!tot) sec.querySelector(auswahl)?.scrollIntoView({ block: "start" }); });

  // ----- Fehler in Worte
  // → Satz oder null (nicht vertraut zeigt den eigenen Hinweis)
  function fehlerSatz(e) {
    if (nichtVertraut(e)) { S.nichtVertraut = true; zeichneHinweis(); zeichneProbe(); zeichneUmstellen(); zeigeStelle(secHinweis, '[data-um="nicht-vertraut"]'); return null; }
    if (e?.daten?.code === "zu-wenig-platz") { S.probe.platzFehler = true; return TU.fehler.platzMangel; }
    if (e?.status === 409 && e?.daten?.art === "kein-starter") return TU.fehler.keinStarter;
    if (e?.status === 409 && e?.daten?.art === "belegt") return e.message || TU.fehler.laeuftSchon;
    if (ausgangUnklar(e)) return TU.fehler.unklar;
    return e?.message || TU.fehler.allgemein;
  }

  // ----- Darstellung
  function zeichneAlles() { zeichneKopf(); zeichneHinweis(); zeichneBefund(); zeichneProbe(); zeichneUmstellen(); zeichneRueckweg(); zeichneKopie(); zeichneAnsicht(); }

  function zeichneAnsicht() {
    const protokoll = S.ansicht === "protokoll";
    haupt.hidden = protokoll; secProtokoll.hidden = !protokoll;
    protokollKnopf.hidden = protokoll;
    intro.hidden = protokoll || !intro.textContent;
    zuKnopf.textContent = protokoll ? TU.protokoll.schliessen : TU.schliessen;
    if (protokoll) zeichneProtokoll();
  }

  function zeichneKopf() {
    const fertig = S.stand?.phase === "A";
    let t = TU.intro;
    if (S.laedt) t = TU.laedt;
    else if (S.fehler) t = "";
    else if (fertig) t = TU.introFertig;
    else if (unterbrochen(S.stand)) t = TU.introUnterbrochen;
    else if (S.befund && S.befund.funde.length === 0) t = TU.introSauber;
    intro.textContent = t; intro.hidden = !t;
  }

  function zeichneHinweis() {
    const teile = [];
    if (S.laedt) teile.push(h("div", { klasse: "um-laedt", "aria-busy": "true" }, h("span", { klasse: "um-balken" }, h("span", { klasse: "um-balken-fuell" }))));
    if (S.fehler) {
      const satz = nichtVertraut(S.fehler) ? null : (S.fehler.message || TU.fehler.laden);
      teile.push(h("div", { klasse: "um-karte fehler", role: "alert", "data-um": "fehler" },
        h("p", { text: satz || TU.fehler.laden }),
        h("div", { klasse: "um-zeile-knoepfe" }, baueKnopf({ text: TU.fehler.nochmal, aktion: "umstellung-nochmal", aufKlick: () => lade() }))));
    }
    if (S.nichtVertraut) {
      teile.push(h("div", { klasse: "um-karte warn", role: "alert", "data-um": "nicht-vertraut" },
        h("p", { klasse: "um-karte-titel", text: TU.nichtVertraut.titel }),
        h("p", { text: TU.nichtVertraut.text }),
        h("div", { klasse: "um-zeile-knoepfe" }, baueKnopf({ text: TU.nichtVertraut.knopf, variante: "primaer", aktion: "umstellung-vertrauen", aufKlick: () => { d.schliessen(); beiVertrauen?.(); } }))));
    }
    secHinweis.replaceChildren(...teile);
  }

  // --- Befund: vier Gruppen
  function fundZeile(f, art) {
    return h("li", { klasse: "um-fund", "data-fund": f.kategorie },
      marke(art === "auto" ? "gruen" : art === "blocker" ? "rot" : art === "frage" ? "warn" : "aus"),
      h("div", { klasse: "um-fund-koerper" },
        h("p", { klasse: "um-fund-text", text: f.text }),
        f.spaeter ? h("p", { klasse: "mini", text: TU.blockerSpaeter }) : null,
        f.schwere === "frage" && !AKTION_ZU_ENT[f.aktion] ? h("p", { klasse: "mini", text: TU.keineEntscheidung }) : null,
        details(TU.detailsText(f))));
  }
  function entscheidungsBlock(key) {
    if (key === "weitereMacs") {
      const E = TU.entscheidung.weitereMacs;
      const name = "um-ent-weitereMacs";
      const radio = (wert, text) => hakenFeld({ typ: "radio", klasse: "um-wahl", text, name, wert, checked: S.ent.weitereMacs === wert, daten: { "data-ent": "weitereMacs" }, aufChange: () => { S.ent.weitereMacs = wert; geaendert(); zeichneBefund(); } });
      return h("fieldset", { klasse: "um-wahlgruppe", "data-wahl": "weitereMacs" }, h("legend", { text: E.frage }), radio("nein", E.nein), radio("ja", E.ja),
        S.ent.weitereMacs === "ja" ? h("p", { klasse: "mini", "data-um": "weitere-macs-hinweis", text: E.jaHinweis }) : null);
    }
    const E = TU.entscheidung[key];
    const name = `um-ent-${key}`;
    const radio = (wert, text) => hakenFeld({ typ: "radio", klasse: "um-wahl", text, name, wert: wert ? "ja" : "nein", checked: !!S.ent[key] === wert, daten: { "data-ent": key }, aufChange: () => { S.ent[key] = wert; geaendert(); } });
    return h("fieldset", { klasse: "um-wahlgruppe", "data-wahl": key }, radio(true, E.ja), radio(false, E.nein), h("p", { klasse: "mini", text: E.rueckweg }));
  }
  function profilBlock() {
    const ps = profile();
    if (ps.length < 2) return null;
    const boxen = ps.map((p) => hakenFeld({ klasse: "um-wahl", text: p.standard ? `${p.name} (${TU.profile.standard})` : p.name, checked: (S.ent.profile || []).includes(p.pfad), daten: { "data-profil": p.pfad },
      aufChange: (an1) => {
        const an = new Set(S.ent.profile || []);
        if (an1) an.add(p.pfad); else an.delete(p.pfad);
        S.ent.profile = ps.map((x) => x.pfad).filter((x) => an.has(x));
        geaendert(); zeichneBefund();
      } }));
    return h("fieldset", { klasse: "um-wahlgruppe", "data-wahl": "profile" }, h("legend", { text: TU.profile.titel }), boxen,
      h("p", { klasse: "mini", text: (S.ent.profile || []).length ? TU.profile.hinweis : TU.profile.keins }));
  }
  function gruppe(art, funde, extra) {
    const G = TU.gruppen[art];
    const kopf = h("div", { klasse: "um-gruppe-kopf" }, h("h3", { klasse: "um-gruppe-titel", text: G.titel }), h("span", { klasse: "um-zahl", "data-zahl": art, text: String(funde.length) }));
    const inhalt = [kopf, h("p", { klasse: "mini", text: G.hinweis })];
    if (!funde.length && !extra) inhalt.push(h("p", { klasse: "um-leer", text: G.leer }));
    if (art === "frage") {
      // je Entscheidung ein Block: erst die Sätze des Befunds, dann die Auswahl (einmal je Schlüssel)
      const nachKey = new Map();
      for (const f of funde) { const k = AKTION_ZU_ENT[f.aktion]; if (!nachKey.has(k)) nachKey.set(k, []); nachKey.get(k).push(f); }
      for (const [k, liste] of nachKey) inhalt.push(h("div", { klasse: "um-frage", "data-frage": k }, h("ul", { klasse: "um-liste" }, liste.map((f) => fundZeile(f, art))), entscheidungsBlock(k)));
    } else if (funde.length) inhalt.push(h("ul", { klasse: "um-liste" }, funde.map((f) => fundZeile(f, art))));
    if (extra) inhalt.push(extra);
    return h("div", { klasse: `um-karte um-gruppe${art === "blocker" && funde.length ? " fehler" : ""}`, "data-umstellung": `gruppe-${art}`, "data-art": art }, inhalt);
  }
  function zeichneBefund() {
    if (S.laedt || S.fehler || !S.befund || S.stand?.phase === "A") { secBefund.replaceChildren(); return; }
    const g = teileBefund(S.befund);
    const teile = [];
    if (g.blocker.length) teile.push(gruppe("blocker", g.blocker));
    teile.push(gruppe("auto", g.auto));
    teile.push(gruppe("frage", g.frage, profilBlock()));
    teile.push(gruppe("hinweis", g.hinweis));
    if (!g.blocker.length) teile.push(gruppe("blocker", g.blocker));
    secBefund.replaceChildren(...teile);
  }

  // --- Schritt 1: Probelauf
  function ampelListe(kriterien) {
    return h("ul", { klasse: "um-ampel", "data-um": "ampel" }, kriterien.map((c) => h("li", { klasse: "um-kriterium", "data-kriterium": c.id, "data-status": c.status },
      marke(ampelArt(c.status)),
      h("div", { klasse: "um-kriterium-koerper" },
        h("p", { klasse: "um-kriterium-titel" }, h("span", { text: c.titel }), h("span", { klasse: "um-kriterium-status", text: Object.hasOwn(TU.probe.ampel, c.status) ? TU.probe.ampel[c.status] : c.status })),
        c.status === "rot" ? h("p", { klasse: "um-hilfe", "data-um": "rot-hilfe", text: Object.hasOwn(TU.rotHilfe, c.id) ? TU.rotHilfe[c.id] : TU.probe.wasTunAllgemein }) : null))));
  }
  function zeichneProbe() {
    const fertig = S.stand?.phase === "A";
    secProbe.hidden = S.laedt || !!S.fehler || !S.befund || fertig;
    if (secProbe.hidden) { secProbe.replaceChildren(); return; }
    const p = S.probe;
    const gesperrt = blockiert();
    const teile = [h("h3", { klasse: "um-schritt-titel", text: TU.probe.titel }), h("p", { text: TU.probe.text }), h("p", { klasse: "mini", text: TU.probe.platz })];
    if (gesperrt) teile.push(h("p", { klasse: "um-sperre", "data-um": "sperre", text: TU.probe.gesperrt }), h("p", { klasse: "mini", text: TU.blockerSperre }));
    if (p.platzFehler) {
      teile.push(hakenFeld({ klasse: "um-wahl", text: TU.probe.nachbarkopie, checked: !!S.ent.nachbarkopie, daten: { "data-ent": "nachbarkopie" }, aufChange: (an) => { S.ent.nachbarkopie = an; geaendert(); } }),
        h("p", { klasse: "mini", text: TU.probe.nachbarkopieHinweis }));
    }
    if (p.laeuft) {
      teile.push(h("div", { klasse: "um-fortschritt", role: "status", "data-um": "probe-laeuft" }, h("span", { klasse: "um-balken", role: "progressbar", "aria-label": TU.probe.laeuft }, h("span", { klasse: "um-balken-fuell" })),
        h("p", { text: TU.probe.laeuft }), h("p", { klasse: "mini", text: TU.probe.laeuftHinweis })));
    } else {
      if (p.ergebnis && Array.isArray(p.ergebnis.kriterien)) {
        const ok = p.ergebnis.ok === true;
        teile.push(h("div", { klasse: `um-ergebnis ${ok ? "gruen" : "rot"}`, role: "status", "data-um": "probe-ergebnis", "data-ampel": ok ? "gruen" : "rot" },
          marke(ok ? "gruen" : "rot"), h("p", { klasse: "um-ergebnis-text", text: ok ? TU.probe.gruen : TU.probe.rot })));
        teile.push(ampelListe(p.ergebnis.kriterien));
        if (!ok) {
          teile.push(h("p", { klasse: "um-hilfe-kopf", text: TU.probe.wasTun }), h("p", { text: TU.probe.wasTunAllgemein }));
          if (p.ergebnis.kopieBehalten) teile.push(h("p", { klasse: "mini", text: TU.probe.wasTunKopie }));
        }
      } else if (S.stand?.probelauf?.ampel === "gruen" && gruenFuerEntscheidungen()) {
        teile.push(h("div", { klasse: "um-ergebnis gruen", role: "status", "data-um": "probe-ergebnis", "data-ampel": "gruen" }, marke("gruen"),
          h("p", { klasse: "um-ergebnis-text", text: `${TU.probe.gruenAlt} ${uhrzeit(S.stand.probelauf.zeit)}`.trim() })));
      } else if (S.stand?.probelauf?.ampel === "gruen" && S.probe.key !== null) {
        teile.push(h("p", { klasse: "um-sperre", "data-um": "probe-veraltet", text: TU.probe.veraltet }));
      }
      if (p.ergebnis?.ok === true && p.key !== null && p.key !== entKey()) teile.push(h("p", { klasse: "um-sperre", "data-um": "probe-veraltet", text: TU.probe.veraltet }));
      if (p.fehler) teile.push(h("p", { klasse: "fehlertext", role: "alert", "data-um": "probe-fehler", text: p.fehler }));
    }
    const hatErgebnis = !!p.ergebnis || !!S.stand?.probelauf;
    teile.push(h("div", { klasse: "um-zeile-knoepfe" },
      baueKnopf({ text: hatErgebnis ? TU.probe.wiederholen : TU.probe.start, variante: hatErgebnis ? "sekundaer" : "primaer", groesse: "l", aktion: "umstellung-probelauf", disabled: gesperrt || p.laeuft || S.um.laeuft || S.nichtVertraut, aufKlick: probelaufStarten, laedt: !!p.laeuft })));
    secProbe.replaceChildren(h("div", { klasse: "um-karte", "data-schritt": "1" }, teile));
  }
  async function probelaufStarten() {
    if (S.probe.laeuft) return;
    const key = entKey();
    S.probe = { ...S.probe, laeuft: true, fehler: null, ergebnis: null, key: null };
    zeichneProbe(); zeichneUmstellen();
    const ende = arbeitBeginnt("umstellung");
    try {
      const r = await api.umstellungProbelauf(sendeEnt());
      S.probe.ergebnis = r;
      await ladeStand();
      if (r.ok === true) {
        S.probe.key = key;
        speichereLokal("umstellung-probe", { vault, zeit: S.stand?.probelauf?.zeit || null, ent: sendeEnt() });
      }
    } catch (e) {
      const satz = fehlerSatz(e);
      S.probe.fehler = satz;
      if (ausgangUnklar(e)) await ladeStand();
    } finally {
      ende();
      S.probe.laeuft = false;
      if (!tot) { zeichneProbe(); zeichneUmstellen(); zeichneKopie(); zeigeStelle(secProbe, '[data-um="probe-ergebnis"], [data-um="probe-fehler"]'); }
    }
  }

  // --- Schritt 2: Umstellen
  function schrittZeilen(live, ergebnis) {
    const nachId = new Map();
    for (const [id, e] of Object.entries(live || {})) nachId.set(id, e?.status);
    for (const s of ergebnis?.schritte || []) nachId.set(s.id, s.status);
    return ALLE_SCHRITTE.map((id) => {
      let status = nachId.get(id) || "offen";
      if (id === "A9" && ergebnis?.a9) status = ergebnis.a9.ampel === "gruen" ? "ok" : "rot";
      const text = Object.hasOwn(TU.umstellen.status, status) ? TU.umstellen.status[status] : status;
      return h("li", { klasse: "um-schritt", "data-schritt": id, "data-status": status },
        marke(statusArt(status)), h("span", { klasse: "um-schritt-name", text: schrittName(id) }), h("span", { klasse: "um-schritt-status", text }));
    });
  }
  function zeichneSchrittListe() {
    const el = secUmstellen.querySelector('[data-um="schritte"]');
    if (el) el.replaceChildren(...schrittZeilen(S.um.live, S.um.ergebnis));
  }
  function fehlerBlock(r) {
    const name = schrittName(r.fehlerBei);
    const teile = [h("p", { klasse: "um-karte-titel", text: TU.umstellen.abgebrochen(r.fehlerBei, name) }), h("p", { text: r.zurueckgenommen === false ? TU.umstellen.abgebrochenOffen : TU.umstellen.abgebrochenText })];
    for (const code of r.rueckwegHinweise || []) teile.push(h("p", { klasse: "mini", text: Object.hasOwn(TU.hinweis, code) ? TU.hinweis[code] : TU.hinweisUnbekannt }));
    return h("div", { klasse: "um-ergebnis rot", role: "alert", "data-um": "umstellen-fehler" }, marke("rot"), h("div", { klasse: "um-ergebnis-koerper" }, teile));
  }
  function zeichneUmstellen() {
    secUmstellen.hidden = S.laedt || !!S.fehler || !S.befund;
    if (secUmstellen.hidden) { secUmstellen.replaceChildren(); return; }
    const fertig = S.stand?.phase === "A";
    const u = S.um;
    if (fertig) {
      secUmstellen.replaceChildren(h("div", { klasse: "um-karte gruen", "data-schritt": "2", "data-um": "fertig" },
        h("div", { klasse: "um-ergebnis gruen", role: "status" }, marke("gruen"), h("div", { klasse: "um-ergebnis-koerper" }, h("p", { klasse: "um-karte-titel", text: TU.umstellen.fertig }), h("p", { text: TU.umstellen.fertigNeustart })))));
      return;
    }
    const gruen = gruenFuerEntscheidungen();
    const teile = [h("h3", { klasse: "um-schritt-titel", text: TU.umstellen.titel }), h("p", { text: TU.umstellen.text })];
    if (!gruen && !u.laeuft && !u.ergebnis) teile.push(h("p", { klasse: "um-sperre", "data-um": "umstellen-gesperrt", text: S.probe.key !== null || S.stand?.probelauf?.ampel === "gruen" ? TU.probe.veraltet : TU.umstellen.gesperrt }));
    if (u.laeuft) {
      teile.push(h("div", { klasse: "um-fortschritt", role: "status", "data-um": "umstellen-laeuft" }, h("span", { klasse: "um-balken", role: "progressbar", "aria-label": TU.umstellen.laeuft }, h("span", { klasse: "um-balken-fuell" })),
        h("p", { text: TU.umstellen.laeuft }), h("p", { klasse: "mini", text: TU.umstellen.laeuftHinweis })));
    }
    if (u.laeuft || u.ergebnis || unterbrochen(S.stand)) teile.push(h("ul", { klasse: "um-schritte", "data-um": "schritte" }, schrittZeilen(u.laeuft ? u.live : S.stand?.schritte, u.ergebnis)));
    if (u.ergebnis) {
      const r = u.ergebnis;
      if (r.ok === false) teile.push(fehlerBlock(r));
      else if (r.mitWarnungen) {
        const rot = (r.a9?.kriterien || []).filter((c) => c.status === "rot");
        teile.push(h("div", { klasse: "um-ergebnis warn", role: "alert", "data-um": "umstellen-warnungen" }, marke("warn"),
          h("div", { klasse: "um-ergebnis-koerper" }, h("p", { klasse: "um-karte-titel", text: TU.umstellen.mitWarnungen }), h("p", { text: TU.umstellen.mitWarnungenText }), rot.length ? ampelListe(rot) : null)));
      } else if (r.ok === true) {
        teile.push(h("div", { klasse: "um-ergebnis gruen", role: "status", "data-um": "umstellen-fertig" }, marke("gruen"),
          h("div", { klasse: "um-ergebnis-koerper" }, h("p", { klasse: "um-karte-titel", text: TU.umstellen.fertig }), h("p", { text: TU.umstellen.fertigNeustart }))));
      }
    }
    if (u.fehler) teile.push(h("p", { klasse: "fehlertext", role: "alert", "data-um": "umstellen-fehler-text", text: u.fehler }));
    if (u.frage && !u.laeuft) {
      teile.push(h("div", { klasse: "um-bestaetigung", role: "alertdialog", "aria-label": TU.umstellen.frageTitel, "data-um": "bestaetigung" },
        h("p", { klasse: "um-karte-titel", text: TU.umstellen.frageTitel }), h("p", { text: TU.umstellen.frageText }), h("p", { klasse: "mini", text: TU.umstellen.frageNeustart }),
        h("div", { klasse: "um-zeile-knoepfe" },
          baueKnopf({ text: TU.umstellen.abbrechen, aktion: "umstellung-abbrechen", autofocus: true, aufKlick: () => { S.um.frage = false; zeichneUmstellen(); } }),
          baueKnopf({ text: TU.umstellen.bestaetigen, variante: "primaer", aktion: "umstellung-bestaetigen", aufKlick: phaseAStarten }))));
    } else if (!u.laeuft) {
      const weiter = unterbrochen(S.stand) || u.ergebnis?.ok === false;
      teile.push(h("div", { klasse: "um-zeile-knoepfe" },
        baueKnopf({ text: weiter ? TU.umstellen.weiter : TU.umstellen.start, variante: "primaer", groesse: "l", aktion: "umstellung-umstellen", disabled: !gruen || S.nichtVertraut || S.probe.laeuft, aufKlick: () => { S.um.frage = true; zeichneUmstellen(); } })));
    }
    secUmstellen.replaceChildren(h("div", { klasse: "um-karte", "data-schritt": "2" }, teile));
    if (u.frage && !u.laeuft) secUmstellen.querySelector('[data-aktion="umstellung-abbrechen"]')?.focus();
  }
  async function phaseAStarten() {
    if (S.um.laeuft || !gruenFuerEntscheidungen()) return;
    S.um = { frage: false, laeuft: true, ergebnis: null, fehler: null, live: S.stand?.schritte || {} };
    zeichneUmstellen(); zeichneProbe();
    const ende = arbeitBeginnt("umstellung");
    const u = setInterval(async () => {
      try { const s = await api.umstellungStand(); if (tot || !S.um.laeuft) return; S.um.live = s.schritte || {}; zeichneSchrittListe(); } catch { /* der nächste Takt */ }
    }, 1200);
    uhren.add(u);
    try {
      const r = await api.umstellungPhaseA(sendeEnt());
      S.um.ergebnis = r;
    } catch (e) {
      S.um.fehler = fehlerSatz(e);
      if (e?.status === 409 && e?.daten?.art === "vorbedingung") S.probe.key = null;   // „Probelauf nicht mehr aktuell“: erst noch einmal probieren
    } finally {
      clearInterval(u); uhren.delete(u); ende();
      S.um.laeuft = false;
      await ladeStand();
      await ladeRueckweg();
      fertigMelden();
      if (!tot) { zeichneAlles(); zeigeStelle(secUmstellen, '[data-um="fertig"], [data-um="umstellen-fertig"], [data-um="umstellen-warnungen"], [data-um="umstellen-fehler"], [data-um="umstellen-fehler-text"]'); }
    }
  }

  // --- Rückweg
  function hinweisSaetze(codes) {
    const gesehen = new Set();
    const teile = [];
    for (const c of codes) {
      const code = String(c).includes(":") ? String(c).split(":").slice(1).join(":") : String(c);
      const satz = Object.hasOwn(TU.hinweis, code) ? TU.hinweis[code] : TU.hinweisUnbekannt;
      if (gesehen.has(satz)) continue;
      gesehen.add(satz); teile.push(h("li", { text: satz }));
    }
    return teile;
  }
  function zeichneRueckweg() {
    // Nach „Alles zurücknehmen“ gibt es nichts mehr in der Liste – das Ergebnis bleibt trotzdem stehen
    secRueckweg.hidden = S.laedt || !!S.fehler || (!S.rw.liste && !S.rw.ergebnis && !S.rw.fehler);
    if (secRueckweg.hidden) { secRueckweg.replaceChildren(); return; }
    const R = TU.rueckweg;
    const teile = [h("h3", { klasse: "um-schritt-titel", text: R.titel }), h("p", { text: R.text })];
    const sichtbar = (S.rw.liste || []).filter((s) => s.id !== "A9");
    const zeilen = sichtbar.map((s) => {
      const status = s.status || "offen";
      const laeuftHier = S.rw.laeuft === s.id || S.rw.laeuft === "alles";
      return h("li", { klasse: "um-rw-zeile", "data-rueckweg": s.id, "data-status": status },
        marke(statusArt(status)), h("span", { klasse: "um-schritt-name", text: schrittName(s.id) }),
        h("span", { klasse: "um-schritt-status", text: Object.hasOwn(R.status, status) ? R.status[status] : status }),
        baueKnopf({ text: laeuftHier ? R.laeuft : R.schritt, aktion: "umstellung-rueckweg-schritt", disabled: !s.hatRueckweg || !!S.rw.laeuft || S.um.laeuft || S.probe.laeuft, aufKlick: () => zuruecknehmen({ schritte: [s.id] }), daten: { "data-schritt": s.id } }));
    });
    if (zeilen.length) teile.push(h("ul", { klasse: "um-rw-liste", "data-um": "rueckweg-liste" }, zeilen));
    const kannAlles = sichtbar.some((s) => s.hatRueckweg);
    if (S.rw.frageAlles && !S.rw.laeuft) {
      teile.push(h("div", { klasse: "um-bestaetigung", role: "alertdialog", "aria-label": R.allesFrage, "data-um": "rueckweg-bestaetigung" },
        h("p", { klasse: "um-karte-titel", text: R.allesFrage }), h("p", { text: R.allesText }),
        h("div", { klasse: "um-zeile-knoepfe" },
          baueKnopf({ text: TU.umstellen.abbrechen, aktion: "umstellung-rueckweg-nein", autofocus: true, aufKlick: () => { S.rw.frageAlles = false; zeichneRueckweg(); } }),
          baueKnopf({ text: R.allesBestaetigen, variante: "gefahr", aktion: "umstellung-rueckweg-alles-ja", aufKlick: () => zuruecknehmen({ alles: true }) }))));
    } else if (sichtbar.length) {
      teile.push(h("div", { klasse: "um-zeile-knoepfe" }, baueKnopf({ text: R.alles, aktion: "umstellung-rueckweg-alles", disabled: !kannAlles || !!S.rw.laeuft || S.um.laeuft || S.probe.laeuft, aufKlick: () => { S.rw.frageAlles = true; zeichneRueckweg(); } })));
    }
    if (S.rw.laeuft) teile.push(h("div", { klasse: "um-fortschritt", role: "status" }, h("span", { klasse: "um-balken", role: "progressbar", "aria-label": R.laeuft }, h("span", { klasse: "um-balken-fuell" })), h("p", { text: R.laeuft })));
    const e = S.rw.ergebnis;
    if (e && !S.rw.laeuft) {
      const codes = [...(e.hinweise || []), ...(e.schritte || []).flatMap((s) => s.hinweise || [])];
      const kein = (e.schritte || []).every((s) => s.status === "nichts");
      teile.push(h("div", { klasse: `um-ergebnis ${codes.length || (e.schritte || []).some((s) => s.status === "fehler") ? "warn" : "gruen"}`, role: "status", "data-um": "rueckweg-ergebnis" },
        marke(codes.length ? "warn" : "gruen"),
        h("div", { klasse: "um-ergebnis-koerper" },
          h("p", { klasse: "um-karte-titel", text: kein ? R.nichts : e.alles ? R.fertigAlles : R.fertigEinzeln }),
          h("ul", { klasse: "um-rw-ergebnis" }, (e.schritte || []).filter((s) => s.status !== "nichts").map((s) => h("li", { "data-ergebnis": s.id, "data-status": s.status, text: `${schrittName(s.id)}: ${Object.hasOwn(R.ergebnis, s.status) ? R.ergebnis[s.status] : s.status}` }))),
          codes.length ? h("div", { klasse: "um-hinweise", "data-um": "rueckweg-hinweise" }, h("p", { klasse: "um-karte-titel", text: R.hinweiseTitel }), h("ul", null, hinweisSaetze(codes)), h("p", { klasse: "mini", text: R.hinweiseText })) : null)));
    }
    if (S.rw.fehler) teile.push(h("p", { klasse: "fehlertext", role: "alert", "data-um": "rueckweg-fehler", text: S.rw.fehler }));
    secRueckweg.replaceChildren(h("div", { klasse: "um-karte", "data-schritt": "rueckweg" }, teile));
  }
  async function zuruecknehmen({ schritte, alles }) {
    if (S.rw.laeuft) return;
    S.rw = { ...S.rw, laeuft: alles ? "alles" : schritte[0], ergebnis: null, fehler: null, frageAlles: false };
    zeichneRueckweg();
    const ende = arbeitBeginnt("umstellung");
    try {
      S.rw.ergebnis = await api.umstellungRueckweg(alles ? { alles: true } : { schritte });
    } catch (e) {
      S.rw.fehler = fehlerSatz(e);
      if (ausgangUnklar(e)) await ladeStand();
    } finally {
      ende();
      S.rw.laeuft = null;
      try { S.befund = await api.umstellungBefund(); entscheidungenAufnehmen(); } catch { /* der alte Befund bleibt */ }
      await ladeStand();
      await ladeRueckweg();
      if (S.stand?.phase !== "A") { S.um = { frage: false, laeuft: false, ergebnis: null, fehler: null, live: null }; }
      fertigMelden();
      if (!tot) { zeichneAlles(); zeigeStelle(secRueckweg, '[data-um="rueckweg-ergebnis"], [data-um="rueckweg-fehler"]'); }
    }
  }

  // --- Kopie jetzt löschen
  function zeichneKopie() {
    const n = S.stand?.kopien || 0;
    secKopie.hidden = S.laedt || !!S.fehler || !n;
    if (secKopie.hidden) { secKopie.replaceChildren(); return; }
    secKopie.replaceChildren(h("div", { klasse: "um-karte schmal", "data-um": "kopie-karte" },
      h("p", { klasse: "um-kopie-text", text: `${TU.kopie.hinweis(n)} ${TU.kopie.frage}` }),
      h("div", { klasse: "um-zeile-knoepfe" }, baueKnopf({ text: TU.kopie.knopf, aktion: "umstellung-kopie-loeschen", disabled: S.kopie.laeuft || S.probe.laeuft || S.um.laeuft, aufKlick: kopieLoeschen }))));
  }
  async function kopieLoeschen() {
    if (S.kopie.laeuft) return;
    S.kopie.laeuft = true; zeichneKopie();
    try {
      const r = await api.umstellungKopieLoeschen();
      toast(r.uebrig ? TU.kopie.nichtGanz : r.geloescht ? TU.kopie.geloescht : TU.kopie.nichts, { fehler: !!r.uebrig });
      if (S.probe.ergebnis) S.probe.ergebnis = { ...S.probe.ergebnis, kopieBehalten: null };
    } catch (e) { toast(nichtVertraut(e) ? TU.nichtVertraut.text : (e?.message || TU.kopie.fehler), { fehler: true }); }
    S.kopie.laeuft = false;
    await ladeStand();
    if (!tot) { zeichneKopie(); zeichneProbe(); }
  }

  // --- Protokoll
  async function zeigeProtokoll() {
    S.ansicht = "protokoll";
    S.protokoll = { laedt: true, daten: null, fehler: null };
    zeichneAnsicht();
    try { S.protokoll.daten = await api.umstellungProtokoll(); } catch (e) { S.protokoll.fehler = e?.message || TU.protokoll.fehler; }
    S.protokoll.laedt = false;
    if (!tot) zeichneProtokoll();
  }
  function zeichneProtokoll() {
    const P = TU.protokoll, p = S.protokoll;
    const teile = [h("h3", { klasse: "um-schritt-titel", text: P.titel }), h("p", { text: P.text })];
    if (p.laedt) teile.push(h("div", { klasse: "um-laedt", "aria-busy": "true" }, h("span", { klasse: "um-balken" }, h("span", { klasse: "um-balken-fuell" }))));
    if (p.fehler) teile.push(h("p", { klasse: "fehlertext", role: "alert", text: P.fehler }));
    if (p.daten) {
      const ort = `${p.daten.ordner}/${p.daten.datei}`;
      teile.push(h("div", { klasse: "um-ort" }, h("span", { klasse: "um-ort-label", text: P.ort }), h("code", { klasse: "um-ort-pfad", "data-um": "protokoll-ort", text: ort }),
        baueKnopf({ text: P.kopieren, aktion: "umstellung-ort-kopieren", aufKlick: async () => { try { await navigator.clipboard.writeText(ort); toast(P.kopiert); } catch { /* ohne Zwischenablage */ } } })));
      if (!p.daten.zeilen.length) teile.push(h("p", { klasse: "um-leer", text: P.leer }));
      else {
        if (p.daten.gekuerzt) teile.push(h("p", { klasse: "mini", text: P.gekuerzt(p.daten.zeilen.length, p.daten.gesamt) }));
        teile.push(h("ol", { klasse: "um-prot", "data-um": "protokoll-zeilen" }, p.daten.zeilen.map((z) => h("li", { klasse: "um-prot-zeile", "data-ereignis": z.ereignis },
          h("span", { klasse: "um-prot-zeit", text: uhrzeit(z.zeit) }),
          h("span", { klasse: "um-prot-lauf", text: Object.hasOwn(P.lauf, z.lauf) ? P.lauf[z.lauf] : (z.lauf || "") }),
          h("span", { klasse: "um-prot-schritt", text: z.schritt ? schrittName(z.schritt) : "" }),
          h("span", { klasse: "um-prot-ereignis", text: [Object.hasOwn(P.ereignis, z.ereignis) ? P.ereignis[z.ereignis] : z.ereignis, z.anzahl !== undefined ? `(${z.anzahl})` : ""].filter(Boolean).join(" ") }),
          z.grund ? h("span", { klasse: "um-prot-grund", text: z.grund }) : null))));
      }
    }
    secProtokoll.replaceChildren(...teile);
  }

  lade();
  return { schliessen: d.schliessen, box, lade };
}
