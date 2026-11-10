// „Mit KI prüfen“ über der Liste „Ungelinkte Erwähnungen“ (K4, docs/plaene/ki-runde.md). Die KI sortiert nur: je Fundstelle ein Badge („gemeint“, „wohl nicht“, „unklar“) mit Grund als Tooltip,
// dazu der Filter „Unwahrscheinliche ausblenden“. Verlinken bleibt exakt der vorhandene Weg (erwaehnungen.js); die KI verlinkt nie.
// Der Client schickt nur den Notizpfad: die Werkstatt bestimmt die Fundstellen selbst aus dem Index. Das Urteil kommt mit Notiz und Stelle zurück (aus dem Speicher der Werkstatt), das Studio ordnet es
// den gezeigten Stellen zu (Pfad + Start + Treffer, danach Pfad + Treffer + Umgebung, falls sich Positionen durch ein Verlinken verschoben haben).
// Ablauf wie „Mit KI zusammenfassen“ (K1): kein Konto mit Stufe „lesen“ → kein Knopf · keine Einwilligung → Dialog · Lauf mit Fortschritt und Abbrechen · Ergebnis.
// Keine Layoutsprünge: der Badge sitzt in der Zeile „Z. 12“, die es ohnehin gibt (gleiche Höhe, sanft eingeblendet); der Knoten mit Knopf und Status wird nur umgehängt, nie neu gebaut.
import { h } from "./hilfen.js";
import { knopf as baueKnopf, umschalter, tooltip } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { api } from "./api.js";
import { TE } from "./texte-erwaehnungen.js";
import { TV } from "./texte-ki-vorschlag.js";
import { kiStatus, kiFunktionen, oeffneEinwilligung, kontingentZeile, wasWirdGesendet, starteVorschlag } from "./ki-vorschlag.js";

export const MIN_TREFFER = 3; // darunter lohnt sich der Aufruf nicht: kein Knopf
const schluessel = (pfad, start, treffer) => `${pfad}\u0000${start}\u0000${treffer}`;
const schluessel2 = (pfad, treffer, vor, nach) => `${pfad}\u0000${treffer}\u0000${vor}\u0000${nach}`;
const runden = (n) => Math.max(100, Math.round(n / 100) * 100);

// S: Zustand des Studios (S.info.vault, S.info.name)
export function erzeugeKiErwaehnungen({ S }) {
  const knoten = h("div", { klasse: "erw-ki", "data-erw-ki": "", hidden: true });
  const zeile = h("div", { klasse: "erw-ki-zeile" });
  const status = h("div", { klasse: "erw-ki-status", "data-erw-ki-status": "", hidden: true, "aria-live": "polite" });
  knoten.append(zeile, status);

  let pfad = null, zahl = 0, host = null;
  let bereit = null, bereitFuer = null, st = kiStatus(null, "erwaehnungen"), ktVoll = false, knopfEl = null, ktZeile = null, sigZeile = "", prueft = false;
  let zustand = { phase: "ruhig" }, lauf = null, nr = 0, uhr = 0, gesendetOffen = false;
  let urteile = new Map(), urteile2 = new Map(), filter = false;

  // ---------- Status ----------
  async function frisch() {
    try { bereit = await api.kiVorschlagBereit(); } catch { bereit = null; }
    bereitFuer = `${S.info?.vault || ""}|${pfad}`;
    st = kiStatus(bereit, "erwaehnungen");
    zeichneZeile();
    return st;
  }
  function sperrGrund() {
    if (st.gesperrt) return TE.ki.gesperrt[st.gesperrt];
    if (ktVoll) return TE.ki.kontingentVoll;
    return null;
  }
  const sichtbar = () => !!pfad && zahl >= MIN_TREFFER && st.sichtbar;

  // ---------- Zeile: Knopf + Kontingent (oder der Grund, warum er aus ist) ----------
  function zeichneZeile() {
    knoten.hidden = !sichtbar();
    if (knoten.hidden) return;
    const sig = JSON.stringify([st.gesperrt, st.konto?.id, st.konto?.abo, st.einwilligung]);
    if (sig !== sigZeile || !knopfEl) {
      sigZeile = sig;
      knopfEl = baueKnopf({ text: TE.ki.knopf, groesse: "s", symbol: "funke", aktion: "erw-ki", aufKlick: () => klick() });
      ktZeile?.stopp();
      const kz = ktZeile = kontingentZeile({ api, konto: st.konto.id, abo: st.konto.abo || null, beiAenderung: (z) => { ktVoll = !!z.voll; setzeSperre(); } });
      zeile.replaceChildren(knopfEl, h("span", { klasse: "erw-ki-grund", "data-erw-ki-grund": "", hidden: true }), kz.knoten);
    }
    setzeSperre();
  }
  function setzeSperre() {
    if (!knopfEl) return;
    const grund = sperrGrund(), laeuft = zustand.phase === "laeuft";
    knopfEl.disabled = !!grund || laeuft;
    knopfEl.title = grund || "";
    const g = zeile.querySelector("[data-erw-ki-grund]"), k = zeile.querySelector("[data-kiv=kontingent]");
    if (g) { g.hidden = !grund; g.textContent = grund || ""; }
    if (k) k.hidden = !!grund && !ktVoll;
  }

  // ---------- Klick: Einwilligung → Lauf ----------
  async function klick() {
    if (zustand.phase === "laeuft" || prueft || !pfad) return;
    prueft = true;
    try { await frisch(); } finally { prueft = false; }
    if (!sichtbar() || sperrGrund()) return;
    if (!st.einwilligung) {
      const funktionen = kiFunktionen(bereit);
      oeffneEinwilligung({ api, bereit, vault: S.info?.vault || "", vaultName: S.info?.name || "", funktionen: funktionen.length ? funktionen : ["erwaehnungen"], nachher: async () => { await frisch(); if (st.einwilligung && !sperrGrund()) starte(); } });
      return;
    }
    starte();
  }
  function starte() {
    const mein = ++nr, fuer = pfad;
    lauf?.abbrechen();
    urteile = new Map(); urteile2 = new Map();
    zustand = { phase: "laeuft", start: Date.now(), gesendet: null, wirdAbgebrochen: false };
    zeichneStatus(); zeichneZeile(); anwenden();
    clearInterval(uhr); uhr = setInterval(() => { const z = status.querySelector("[data-erw-ki-zeit]"); if (z && zustand.phase === "laeuft" && zustand.gesendet) z.textContent = TV.lauf.arbeitet(Math.floor((Date.now() - zustand.start) / 1000)); }, 1000);
    const l = starteVorschlag({ api, wiederholeBeiLaeuft: true, eingabe: { funktion: "erwaehnungen", konto: st.konto.id, pfad: fuer },
      beiStart: (s) => { if (mein !== nr) return; zustand.gesendet = s.gesendet; zustand.ausgenommen = s.ausgenommen || 0; zustand.geprueft = s.geprueft; zustand.gesamt = s.gesamt; zeichneStatus(); } });
    lauf = l;
    l.fertig.then(({ ergebnis }) => {
      if (mein !== nr || pfad !== fuer) return;
      clearInterval(uhr);
      if (ergebnis.ok) {
        for (const u of ergebnis.urteile) { urteile.set(schluessel(u.pfad, u.start, u.treffer), u); urteile2.set(schluessel2(u.pfad, u.treffer, u.vor, u.nach), u); }
        zustand = { ...zustand, phase: "ergebnis", ergebnis };
      } else if (ergebnis.abgebrochen) zustand = { ...zustand, phase: "abgebrochen" };
      else zustand = { ...zustand, phase: "fehler", text: ergebnis.fehler || TV.lauf.fehlerAllgemein, vorschau: ergebnis.vorschau === true };
      zeichneStatus(); zeichneZeile(); anwenden();
    }).catch(async (err) => {
      if (mein !== nr) return;
      clearInterval(uhr);
      zustand = { ...zustand, phase: "fehler", text: err?.message || TV.lauf.fehlerAllgemein };
      zeichneStatus(); zeichneZeile();
      if (String(err?.daten?.art || "").startsWith("einwilligung")) await frisch();
    });
  }
  function abbrechen() {
    if (zustand.phase !== "laeuft" || zustand.wirdAbgebrochen) return;
    zustand.wirdAbgebrochen = true; zeichneStatus();
    lauf?.abbrechen();
  }
  function schliesse() { nr++; clearInterval(uhr); zustand = { phase: "ruhig" }; urteile = new Map(); urteile2 = new Map(); filter = false; status.hidden = true; status.replaceChildren(); zeichneZeile(); anwenden(); }

  // ---------- Status unter dem Knopf ----------
  const zaehle = () => { const z = { ja: 0, nein: 0, unklar: 0 }; for (const u of urteile.values()) z[u.gemeint]++; return z; };
  function zeichneStatus() {
    const p = zustand.phase;
    status.hidden = p === "ruhig";
    if (p === "ruhig") { status.replaceChildren(); return; }
    status.dataset.phase = p;
    const gesendet = zustand.gesendet ? wasWirdGesendet({ gesendet: zustand.gesendet, ausgenommen: zustand.ausgenommen, offen: gesendetOffen, beiUmschalten: (auf) => { gesendetOffen = auf; } }) : null;
    const zu = p === "laeuft" ? null : h("button", { type: "button", klasse: "erw-ki-zu", "data-aktion": "erw-ki-zu", "aria-label": TE.ki.schliessen, title: TE.ki.schliessen, aufClick: schliesse }, symbol("schliessen", 12));
    let inhalt;
    if (p === "laeuft") {
      inhalt = [h("div", { klasse: "erw-ki-balken", "aria-hidden": "true" }, h("i")),
        h("div", { klasse: "erw-ki-reihe" }, h("span", { klasse: "erw-ki-text", "data-erw-ki-zeit": "", text: zustand.wirdAbgebrochen ? TE.ki.brichAb : zustand.gesendet ? TV.lauf.arbeitet(Math.floor((Date.now() - zustand.start) / 1000)) : TV.lauf.startet }),
          baueKnopf({ text: TV.lauf.abbrechen, groesse: "s", aktion: "erw-ki-abbrechen", disabled: zustand.wirdAbgebrochen, aufKlick: abbrechen })), gesendet];
    } else if (p === "ergebnis") {
      const e = zustand.ergebnis, z = zaehle(), tokens = Object.values(e.tokens || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const schalter = umschalter({ an: filter, text: TE.ki.filter, daten: { "data-erw-ki-filter": "" }, aufAenderung: (an) => { filter = an; anwenden(); zeichneZahl(); } });
      inhalt = [h("div", { klasse: "erw-ki-reihe" }, h("span", { klasse: "erw-ki-text", "data-erw-ki-zahlen": "", text: TE.ki.zusammen(z.ja, z.nein, z.unklar) }),
          e.vorschau ? h("span", { klasse: "erw-ki-marke", "data-erw-ki-marke": "", text: TE.ki.vorschauMarke }) : null, tokens > 0 ? h("span", { klasse: "erw-ki-klein", "data-erw-ki-tokens": "", text: `~${runden(tokens).toLocaleString("de-DE")} Tokens` }) : null),
        schalter,
        h("p", { klasse: "erw-ki-klein", "data-erw-ki-ausgeblendet": "" }),
        e.gesamt > e.geprueft ? h("p", { klasse: "erw-ki-klein", "data-erw-ki-teil": "", text: TE.ki.teil(e.geprueft, e.gesamt) }) : null,
        h("p", { klasse: "erw-ki-klein", text: TE.ki.hinweis }), gesendet];
    } else {
      inhalt = [h("p", { klasse: "erw-ki-text", "data-erw-ki-meldung": "", text: p === "abgebrochen" ? TV.lauf.abgebrochen : zustand.text }),
        h("div", { klasse: "erw-ki-reihe" }, baueKnopf({ text: TV.lauf.nochEinmal, groesse: "s", aktion: "erw-ki-neu", disabled: !!sperrGrund(), aufKlick: () => klick() })), gesendet];
    }
    status.replaceChildren(...[zu, ...inhalt].filter(Boolean));
    if (p === "ergebnis") zeichneZahl();
  }
  // Zahl der ausgeblendeten Stellen (nur die gerade gezeigten) unter dem Schalter
  function zeichneZahl() {
    const el = status.querySelector("[data-erw-ki-ausgeblendet]");
    if (!el) return;
    const n = host ? host.querySelectorAll("[data-erw-stelle][hidden]").length : 0;
    el.textContent = filter && n > 0 ? TE.ki.ausgeblendet(n) : "";
    el.hidden = !el.textContent;
  }

  // ---------- Badges und Filter auf die gezeigten Stellen legen ----------
  const urteilFuer = (el) => {
    const d = el.dataset;
    return urteile.get(schluessel(d.erwPfad, d.erwStart, d.erwTreffer)) || urteile2.get(schluessel2(d.erwPfad, d.erwTreffer, d.erwVor, d.erwNach)) || null;
  };
  function legeAuf(stelle) {
    const platz = stelle.querySelector("[data-erw-badge-platz]");
    const u = zustand.phase === "ergebnis" ? urteilFuer(stelle) : null;
    if (platz) {
      const vorher = platz.firstElementChild;
      if (!u) { if (vorher) platz.replaceChildren(); }
      else if (!vorher || vorher.dataset.erwBadge !== u.gemeint || vorher.dataset.erwGrund !== u.grund) {
        const b = h("span", { klasse: "erw-badge neu", "data-erw-badge": u.gemeint, "data-erw-grund": u.grund, "aria-label": TE.ki.badgeTitel(u.gemeint, u.grund), text: TE.ki.badge[u.gemeint] });
        tooltip(b, TE.ki.badgeTitel(u.gemeint, u.grund), { verzoegerung: 250 });
        platz.replaceChildren(b);
        requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove("neu"))); // sanft einblenden
      }
    }
    stelle.hidden = !!(filter && u && u.gemeint === "nein");
  }
  // wurzel: der Abschnitt (alle Stellen darin) oder ein Block / eine Stellenliste
  function anwenden(wurzel = host) {
    if (!wurzel) return;
    for (const s of wurzel.querySelectorAll("[data-erw-stelle]")) legeAuf(s);
    for (const b of wurzel.querySelectorAll(".erw-notiz")) {
      const alle = b.querySelectorAll("[data-erw-stelle]");
      b.hidden = alle.length > 0 && [...alle].every((s) => s.hidden) && !b.querySelector(".erw-mehr");
    }
    zeichneZahl();
    try { schnittstelle.beiAenderung?.(); } catch (e) { console.error(e); }
  }
  // Ist die Stelle (Daten wie in den data-erw-Feldern) durch den Filter „wohl nicht“ ausgeblendet? Auch für Stellen, die gerade nicht gezeichnet sind (hinter „weitere Notizen“).
  const ausgeblendet = (s) => !!(filter && zustand.phase === "ergebnis" && (urteile.get(schluessel(s.pfad, s.start, s.treffer)) || urteile2.get(schluessel2(s.pfad, s.treffer, s.vor ?? "", s.nach ?? "")))?.gemeint === "nein");

  // ---------- Schnittstelle zu erwaehnungen.js ----------
  // melde: bei jedem Zeichnen der Liste (zahl = Stellen insgesamt; host = der Abschnitt). Wechselt die Notiz, gehört alles Gezeigte zum alten Stand.
  function melde({ pfad: p, zahl: n, host: hostEl }) {
    if (p !== pfad) { lauf?.abbrechen(); lauf = null; nr++; clearInterval(uhr); zustand = { phase: "ruhig" }; urteile = new Map(); urteile2 = new Map(); filter = false; status.hidden = true; status.replaceChildren(); pfad = p; bereitFuer = null; }
    zahl = n; host = hostEl;
    zeichneZeile();
    if (n >= MIN_TREFFER && bereitFuer !== `${S.info?.vault || ""}|${pfad}`) { bereitFuer = `${S.info?.vault || ""}|${pfad}`; frisch(); }
  }
  function keineListe(p) { if (p !== pfad) melde({ pfad: p, zahl: 0, host: null }); else { zahl = 0; zeichneZeile(); } }
  function vergessen() { lauf?.abbrechen(); lauf = null; nr++; clearInterval(uhr); ktZeile?.stopp(); ktZeile = null; pfad = null; zahl = 0; host = null; bereit = null; bereitFuer = null; st = kiStatus(null, "erwaehnungen"); sigZeile = ""; knopfEl = null; zustand = { phase: "ruhig" }; urteile = new Map(); urteile2 = new Map(); filter = false; zeile.replaceChildren(); status.replaceChildren(); knoten.hidden = true; }
  window.addEventListener("pagehide", () => { if (zustand.phase === "laeuft") lauf?.abbrechen(); });

  const schnittstelle = { knoten, melde, keineListe, anwenden, vergessen, ausgeblendet, beiAenderung: null, _zustand: () => zustand };
  return schnittstelle;
}
