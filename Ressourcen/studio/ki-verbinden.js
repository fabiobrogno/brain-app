// „KI verbinden“ — EIN Ablauf für die ganze App (Paket P9). Er ersetzt die drei früheren Varianten (Dialog in willkommen.js, KI-Schritt des Assistenten, Panel in den Einstellungen):
//   1 Wählen   kiAuswahl (Baustein), gefundene Programme oben, schon verbundene sind markiert
//   2 Konto    ein vorhandenes Konto oder „Konto hinzufügen“ (eigener Ordner); ist es nicht angemeldet: „Im Terminal anmelden …“ mit Abfrage im Hintergrund, abbrechbar
//   3 Stufe    für den offenen Vault, vorbelegt mit der jetzigen Stufe; ein gesperrtes Konto bleibt gesperrt, bis du ausdrücklich eine Stufe wählst (Regel aus dem Assistenten)
//   4 Prüfen   Kortex trägt sich ein und ruft EINMAL den Kortex-Server auf (POST /api/mcp/pruefen: brain_vaults, rein lesend, kein Modellaufruf): „… sieht deinen Vault“ oder ein klarer Fehler
//   5 Fertig   Zusammenfassung; auf Wunsch „Kontingent anzeigen“ (Einwilligung, wie in den Einstellungen) und ein Hinweis auf das Leseverbot für gesperrte Vaults
// Wer ihn benutzt (nichts davon baut eigene Logik): die Statusleiste, die Befehlspalette und das Konto-Menü (oeffneKiVerbinden → Dialog), der Assistent (fuss: "host", die Fußleiste
// gehört dem Assistenten), die Willkommen-Karte (fuss: "eigen", rahmen: "karte") und die Einstellungen (Dialog, mit vorgewähltem Programm/Konto). Auch das Anmelden im Terminal
// (baueAnmeldung) liegt hier und wird von den Einstellungen (Konto-Menü „Neu anmelden …“) mitbenutzt.
// Gestaltung nach dem Prototyp (app.html#verbinden=1): Orca-Muster „Agent wählen“ (AgentStep.tsx @9bccd67, MIT, Lovecast Inc.), von Hand nachgebaut; kein Quelltext von Orca.
import { h, dialog, toast } from "./hilfen.js";
import { api as standardApi } from "./api.js";
import { symbol } from "./symbole.js";
import { kiLogo, kiKatalog, kiLogoName } from "./ki-logos.js";
import { knopf as baueKnopf, segment, textfeld, kiAuswahl, mitLaden } from "./bausteine.js";
import { markeSvg } from "./windung.js";
import { TKV } from "./texte-ki-verbinden.js";
import { TE } from "./texte-einrichtung.js";
import { TK } from "./texte-konten.js";
import { TKE } from "./texte-ki-einstellungen.js";

export const ANMELDBAR = ["claude", "codex"];
export const ANMELDE_MS = 10 * 60_000; // Orca: Claude-Anmeldung läuft nach 10 Minuten ab
export const TAKT_MS = 3000;
const STUFEN = ["lesen", "posteingang", "erweitert"];
const STUFEN_MIT_SPERRE = ["gesperrt", ...STUFEN];
const PFLEGE_STUFE = "mittel"; // „Wie bisher“ (texte-konten.js): kleines Modell für Urteile, größeres für Prüfung und Pflege
const KONTO_EREIGNIS = "kortex-konten"; // app.js: die Konto-Leiste holt ihren Stand neu

const name = (id) => kiLogoName(id) || id;
const meldungVon = (e) => (typeof e?.message === "string" && e.message.trim()) || TKV.pruefen.fehlerStandard;
const versionVon = (v) => { const m = /\d+(?:\.\d+)+/.exec(String(v || "")); return m ? m[0] : null; };
const ruhig = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.bewegung === "reduziert"; } catch { return false; } };
const warte = (ms) => new Promise((ok) => setTimeout(ok, ruhig() ? 0 : ms));
const slug = (n) => String(n).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "konto";
const marke = (art) => h("span", { klasse: "kk-marke", "data-marke": art, "aria-hidden": "true" }, art === "rot" ? symbol("schliessen", 12) : art === "warn" ? symbol("warnung", 12) : null);

// Der Anmeldestand eines Kontos: das Programm selbst fragen (App: Swift, `claude auth status` bzw. `codex login status`), das Ergebnis der Werkstatt melden (sie merkt sich, ob das Konto
// früher angemeldet war → „abgelaufen“). Kortex liest nie Anmeldedaten. → { zustand: angemeldet | abgelaufen | nicht-angemeldet | unbekannt, zuletzt }
export async function pruefeKontoAnmeldung(api, kt) {
  try {
    const st = await api.kiAnmeldestatus(kt.programm, kt.standard ? null : kt.pfad);
    const z = st?.zustand === "angemeldet" || st?.zustand === "nicht-angemeldet" ? st.zustand : "unbekannt";
    const r = await api.kiAnmeldung(kt.id, z);
    return { zustand: r.zustand, zuletzt: r.zuletzt || null };
  } catch { return { zustand: "unbekannt" }; }
}

// ============================================================================================================================================
// Anmelden im Terminal: Schritte, Befehl, Abfrage alle TAKT_MS bis angemeldet oder 10 Minuten um. Eine Quelle für den Ablauf „KI verbinden“ und die Einstellungen.
//   o: { api, kt (Konto), pruefe(kt) → { zustand }, beiAngemeldet(), beiEnde() (Abbruch/Zeit) }
//   → { liste, befehl, fehlerEl, hinweis, knoepfe: { abbruch, nochmal, jetzt }, start(), stoppe(), laeuft() }  — wer es einsetzt, legt die Knoten ab
export function baueAnmeldung({ api, kt, pruefe = (k) => pruefeKontoAnmeldung(api, k), beiAngemeldet, beiAbbruch, abbruchText = TKE.anmeldung.abbrechen } = {}) {
  const st = { schritt: 1, fehler: null, ende: false, zeit: false };
  let timer = 0, frist = 0, laeuft = false, aktiv = false;
  const schritte = [TKE.anmeldung.schritt1, TKE.anmeldung.schritt2, TKE.anmeldung.schritt3];
  const liste = h("ul", { klasse: "kx-schritte", "data-kx": "schritte" });
  const befehl = h("div", { klasse: "kx-terminal", "data-kx": "befehl", hidden: true });
  const fehlerEl = h("div", { klasse: "kk-karte fehler", role: "alert", hidden: true, "data-kx": "anmelde-fehler" });
  const hinweis = h("p", { klasse: "mini", text: TKE.anmeldung.hinweisBrowser });
  const abbruch = baueKnopf({ text: abbruchText, aktion: "anmelden-abbrechen", aufKlick: () => { stoppe(); beiAbbruch?.(); } });
  const jetzt = baueKnopf({ text: TKE.anmeldung.jetztPruefen, variante: "primaer", aktion: "anmelden-pruefen", aufKlick: () => abfrage(true) });
  const nochmal = baueKnopf({ text: TKE.anmeldung.nochmal, variante: "primaer", aktion: "anmelden-nochmal", hidden: true, aufKlick: () => start() });
  const zeichne = () => {
    liste.replaceChildren(...schritte.map((t, i) => {
      const nr = i + 1, fertig = st.schritt > nr || st.ende, an = !st.fehler && !st.ende && st.schritt === nr;
      return h("li", { klasse: `kx-schritt${fertig ? " fertig" : an ? " laeuft" : ""}`, "data-s": String(nr) }, h("span", { klasse: "kx-st", "aria-hidden": "true" }, fertig ? symbol("haken", 12) : null),
        h("span", { text: nr === 1 && st.schritt === 1 && !st.fehler && !st.ende ? TKE.anmeldung.schritt1Wartet : t }));
    }));
    nochmal.hidden = !st.fehler && !st.zeit; jetzt.hidden = !!st.fehler || !!st.zeit || st.schritt < 2 || st.ende;
    fehlerEl.hidden = !st.fehler && !st.zeit;
    if (st.fehler) fehlerEl.replaceChildren(marke("rot"), h("p", { text: st.fehler }));
    else if (st.zeit) fehlerEl.replaceChildren(marke("warn"), h("p", { text: TKE.anmeldung.zeit }));
  };
  const stoppe = () => { clearTimeout(timer); timer = 0; aktiv = false; };
  async function abfrage(manuell = false) {
    if (laeuft || st.ende) return;
    laeuft = true;
    if (st.schritt === 2) { st.schritt = 3; zeichne(); }
    try {
      const r = await pruefe(kt);
      if (r?.zustand === "angemeldet") { if (!aktiv) return; st.ende = true; stoppe(); zeichne(); try { beiAngemeldet?.(r); } catch (e) { console.error(e); } return; }
    } finally { laeuft = false; }
    if (st.ende || !aktiv) return;
    st.schritt = 2; zeichne();
    if (Date.now() > frist) { st.zeit = true; stoppe(); zeichne(); return; }
    if (!manuell || !timer) timer = setTimeout(() => { timer = 0; abfrage(); }, TAKT_MS);
  }
  async function start() {
    stoppe(); st.fehler = null; st.zeit = false; st.schritt = 1; st.ende = false; aktiv = true; zeichne();
    try {
      const r = await api.kiAnmelden(kt.programm, kt.standard ? null : kt.pfad);
      if (!aktiv) return; // inzwischen abgebrochen
      const zeile = r?.anzeige || r?.befehl;
      if (zeile) { befehl.hidden = false; befehl.replaceChildren(h("div", {}, h("span", { klasse: "kx-dollar", text: "$ " }), h("span", { text: zeile })), h("div", { klasse: "kx-warte", text: TKE.anmeldung.wartetAuf })); }
      st.schritt = 2; frist = Date.now() + ANMELDE_MS; zeichne();
      timer = setTimeout(() => { timer = 0; abfrage(); }, TAKT_MS);
    } catch (e) { aktiv = false; st.fehler = e?.message || TKE.anmeldung.fehlerStart; zeichne(); }
  }
  zeichne();
  return { liste, befehl, fehlerEl, hinweis, knoepfe: { abbruch, nochmal, jetzt }, start, stoppe, laeuft: () => aktiv, zustand: st };
}

// ============================================================================================================================================
// Der Ablauf selbst.
//   o.api          Schnittstelle (Standard: api.js)
//   o.vaultPfad()  offener Vault (für die Stufe)
//   o.vaultName()  Anzeigename des offenen Vaults
//   o.rahmen       "dialog" (Statusleiste, Palette, Einstellungen) | "karte" (Willkommen-Karte) | "assistent" (Schritt im Einrichtungs-Assistenten)
//   o.fuss         "eigen" (Knöpfe im Ablauf) | "host" (der Assistent zeigt Haupt- und Zurück-Knopf selbst: fuss(), primaerTun(), zurueckTun())
//   o.start        { programm, konto, schritt } — vorgewählt (Einstellungen: „Verbinden“ an einem Konto oder Programm)
//   o.vorwahl      true = ein gefundenes, noch nicht verbundenes Programm vorwählen (Dialog); false = erst wählen lassen (Assistent)
//   o.kopiere(text) → Promise<boolean> (Zwischenablage; im Assistenten über die App) · o.melde(text) (Toast)
//   o.beiVerbunden({ id, konto, stufe })   nach geglückter Prüfung · o.beiAenderung()  Zustand hat sich geändert (Host: Fußleiste neu)
//   o.beiFertig({ verbunden })  Ablauf zu Ende („Fertig“ / Abbrechen / Später) · o.zeigeEinstellungen(ziel)  „Ansehen“ beim Leseverbot
//   o.abbrechenText  Beschriftung von „Abbrechen“ im ersten Schritt (Karte: „Später“) · o.ohneKiText
export function erzeugeKiVerbinden(o = {}) {
  const api = o.api || standardApi;
  const rahmen = o.rahmen || "dialog", fussHost = o.fuss === "host";
  const vaultPfad = () => o.vaultPfad?.() || null;
  const vaultName = () => o.vaultName?.() || "";
  const vaultRef = () => (vaultName() ? `„${vaultName()}“` : TKV.stufe.vaultFallback); // „Mein Vault“ oder, ohne Namen, „deinem Vault“
  const Z = {
    geladen: false, ladeFehler: null, erkennung: {}, erkannt: false, konten: [], zugriff: {}, vaults: [], neuKonten: [], abgleichVersucht: false,
    schritt: "waehlen", prog: null, konto: null, stufe: "posteingang", stufeGewaehlt: false, vorbelegt: null,
    anm: new Map(), anmeldung: null, neuOffen: false, neuEl: null, sucht: false,
    lauf: null, ergebnis: null, verbunden: [], pflege: null, tot: false, kontingent: null, lade: 0, busy: false, angefangen: false,
    ki: {}, // je Programm: { konto, stufe, verbunden } — für den Assistenten (Fertig-Seite, Bühne)
  };
  const wurzel = h("div", { klasse: "kv", "data-rahmen": rahmen, "data-fuss": fussHost ? "host" : "eigen", "data-kv": "" });
  const kopfEl = h("div", { klasse: "kv-kopf" });
  const rumpfEl = h("div", { klasse: "kv-rumpf" });
  const fussEl = h("div", { klasse: "kv-fuss" + (rahmen === "dialog" ? " dialog-fuss" : "") }); // im Dialog gilt Enter für den Hauptknopf (hilfen.js)
  wurzel.append(kopfEl, rumpfEl, fussEl);
  let auswahl = null;

  // ---------------------------------------------------------------- Hilfen
  const gefunden = (id) => Z.erkennung[id]?.gefunden === true;
  const kontenVon = (id) => Z.konten.filter((k) => k.programm === id && k.vorhanden !== false);
  const kontoMit = (id) => Z.konten.find((k) => k.id === id) || null;
  const verbundeneIds = () => [...new Set([...Z.konten.filter((k) => k.verbunden).map((k) => k.programm), ...Z.verbunden.map((v) => v.id)])];
  const schritteListe = () => ["waehlen", ...(ANMELDBAR.includes(Z.prog) ? ["konto"] : []), "stufe", "pruefen", "fertig"];
  const nummer = () => { const l = schritteListe(), i = l.indexOf(Z.schritt); return { n: i + 1, von: l.length - 1 }; };
  const aenderung = () => { try { o.beiAenderung?.(); } catch (e) { console.error(e); } };
  const stufeName = (s) => TE.ki.stufen[s]?.name || s;

  // Die Stufe, die ein Konto in DIESEM Vault schon hat (GET /api/ki/konten, nach Pfad geschlüsselt); null = unbekannt
  function stufeAktuell(konto) {
    const p = vaultPfad();
    if (!konto || !p) return null;
    const s = Z.zugriff?.[konto]?.[p];
    return STUFEN_MIT_SPERRE.includes(s) ? s : null;
  }
  // Vorbelegung: die jetzige Stufe, sonst „Posteingang“. Ausdrücklich gewählt ist eine Stufe erst, wenn du sie selbst anklickst.
  function belegeStufe() {
    const a = stufeAktuell(Z.konto);
    Z.stufe = a || "posteingang"; Z.vorbelegt = a; Z.stufeGewaehlt = false;
  }
  const sperreBleibt = () => Z.stufe === "gesperrt" && !Z.stufeGewaehlt;
  function waehleProgramm(id) {
    Z.prog = id;
    const konten = kontenVon(id);
    Z.konto = (konten.find((k) => k.standard) || konten[0])?.id ?? null;
    belegeStufe();
  }
  function waehleKonto(id) { Z.konto = id; belegeStufe(); }
  const aktuellesKonto = () => kontoMit(Z.konto);
  const anmZustand = (k) => (k && ANMELDBAR.includes(k.programm) ? Z.anm.get(k.id)?.zustand || "prueft" : null);

  // ---------------------------------------------------------------- Laden
  async function lade(neu = false) {
    const nr = ++Z.lade;
    Z.sucht = true; Z.ladeFehler = null;
    const [erk, kon] = await Promise.allSettled([api.kiErkennen(neu), api.kiKonten()]); // beide rein lesend
    if (Z.tot || nr !== Z.lade) return;
    const e = erk.status === "fulfilled" ? erk.value : null;
    let kv = kon.status === "fulfilled" ? kon.value : null;
    // Fehlt die Liste oder ist sie beschädigt, legt der ausdrückliche Abgleich sie an (höchstens einmal); neu gefundene Konten trägt nur ein Klick ein
    if (kv && kv.zustand !== "ok" && !Z.abgleichVersucht) { Z.abgleichVersucht = true; try { kv = await api.kiKontenAbgleich(); } catch { /* der Ablauf geht ohne Liste weiter */ } if (Z.tot || nr !== Z.lade) return; }
    Z.konten = Array.isArray(kv?.konten) ? kv.konten : [];
    Z.zugriff = kv?.zugriff && typeof kv.zugriff === "object" ? kv.zugriff : {};
    Z.vaults = Array.isArray(kv?.vaults) ? kv.vaults : [];
    Z.neuKonten = Array.isArray(kv?.neu) ? kv.neu : [];
    Z.erkennung = erkennungAus(e);
    Z.erkannt = !!e;
    if (!e && !kv) Z.ladeFehler = true;
    Z.geladen = true; Z.sucht = false;
    if (!Z.angefangen) {
      // einmal beim ersten Laden: vorgewähltes Konto/Programm (Einstellungen), sonst die Vorwahl des Dialogs
      Z.angefangen = true;
      const st = o.start || {};
      const kto = st.konto ? kontoMit(st.konto) : null;
      if (kto) { waehleProgramm(kto.programm); waehleKonto(kto.id); }
      else if (st.programm) waehleProgramm(st.programm);
      else if (!st.konto && o.vorwahl !== false) { const v = vorwahl(); if (v) waehleProgramm(v); }
      if (Z.prog && st.schritt) Z.schritt = st.schritt === "konto" && !ANMELDBAR.includes(Z.prog) ? "stufe" : st.schritt;
      if (Z.prog && st.kontoNeu && ANMELDBAR.includes(Z.prog)) { Z.schritt = "konto"; Z.neuOffen = true; }
      if (Z.schritt === "konto") pruefeAnmeldungen();
    } else if (Z.prog) { if (!Z.konto || !kontoMit(Z.konto)) waehleProgramm(Z.prog); else if (!Z.stufeGewaehlt) belegeStufe(); }
    zeichne();
    aenderung();
  }
  // Vorgewählt (Dialog): ein gefundenes, noch nicht verbundenes Programm; sonst Claude Code, wenn vorhanden; sonst das erste gefundene, das sich verbinden lässt
  function vorwahl() {
    if (!Z.erkannt) return "claude";
    const verbunden = new Set(verbundeneIds());
    const frei = kiKatalog().find((e) => e.verbindbar && gefunden(e.id) && !verbunden.has(e.id));
    if (frei) return gefunden("claude") && !verbunden.has("claude") ? "claude" : frei.id;
    return null;
  }
  async function pruefeAnmeldungen() {
    const liste = kontenVon(Z.prog).filter((k) => ANMELDBAR.includes(k.programm));
    for (const k of liste) if (!Z.anm.has(k.id)) Z.anm.set(k.id, { zustand: "prueft" });
    await Promise.all(liste.map(async (k) => { const r = await pruefeKontoAnmeldung(api, k); if (Z.tot) return; Z.anm.set(k.id, r); if (Z.schritt === "konto") zeichne(); }));
  }

  // ---------------------------------------------------------------- Rahmen: Kopf, Fuß
  function logoKachel(id, g = 15) { return h("span", { klasse: "kv-logo" }, kiLogo(id, g, { dekorativ: true })); }
  function zeichneKopf() {
    const { n, von } = nummer();
    const p = Z.prog;
    let teile = [];
    if (Z.schritt === "waehlen") teile = [h("h2", { klasse: "kv-titel", text: TKV.titel })];
    else if (Z.schritt === "konto") teile = [logoKachel(p), h("h2", { klasse: "kv-titel", text: TKV.konto.titel(name(p)) })];
    else if (Z.schritt === "stufe") teile = [logoKachel(p), h("h2", { klasse: "kv-titel", text: TKV.stufe.titel(name(p), vaultRef()) })];
    else if (Z.schritt === "pruefen") teile = [logoKachel(p), h("h2", { klasse: "kv-titel", text: TKV.pruefen.titel(name(p)) })];
    if (Z.schritt !== "fertig") teile.push(h("span", { klasse: "kv-schritt", "aria-label": TKV.schrittAria(n, von, TKV.schritte[Z.schritt]), text: TKV.schritt(n, von) }));
    kopfEl.replaceChildren(...teile);
    kopfEl.hidden = Z.schritt === "fertig" || (rahmen === "assistent" && Z.schritt === "waehlen");
  }

  // Der Fuß als Beschreibung: { links, knoepfe: [{ text, variante, aktion, ok, lade, tun }] }; der Host (Assistent) zeigt den Hauptknopf selbst
  function fussBeschreibung() {
    const T = TKV;
    switch (Z.schritt) {
      case "waehlen": {
        const hat = !!Z.prog;
        return { links: { text: Z.sucht ? T.waehlen.sucht : T.waehlen.neuSuchen, symbol: "sync", aktion: "ki-neu-suchen", tun: () => neuSuchen(), lade: Z.sucht },
          zu: { text: o.abbrechenText || T.waehlen.abbrechen, aktion: "ki-abbrechen", tun: () => beende() },
          haupt: { text: hat ? T.waehlen.weiter : (o.ohneKiText || (fussHost ? (Z.verbunden.length ? T.fertig.weiter : T.waehlen.ohneKi) : T.waehlen.weiter)), ok: hat || fussHost || !!o.ohneKiText, aktion: "ki-weiter", tun: () => hat ? weiter() : beende(), ohneKi: !hat && (fussHost || !!o.ohneKiText) } };
      }
      case "konto": {
        const laeuft = !!Z.anmeldung?.laeuft();
        return { zurueck: { text: T.konto.zurueck, aktion: "ki-zurueck", tun: () => zurueck() }, haupt: { text: T.konto.weiter, ok: !laeuft && !Z.neuOffen, aktion: "ki-weiter", tun: () => weiter() } };
      }
      case "stufe": return { zurueck: { text: T.stufe.zurueck, aktion: "ki-zurueck", tun: () => zurueck() }, haupt: { text: T.stufe.verbinden, ok: true, aktion: "ki-verbinden", tun: () => starteLauf() } };
      case "pruefen": {
        const l = Z.lauf;
        if (l?.fehler || l?.frage || l?.befehl) return { zurueck: { text: T.pruefen.zurueck, aktion: "ki-zurueck", tun: () => zurueck() }, haupt: l.frage ? null : { text: T.pruefen.nochmal, ok: true, aktion: "ki-nochmal", tun: () => starteLauf(), variante: "primaer" } };
        return { zu: { text: T.pruefen.abbrechen, aktion: "ki-abbrechen", tun: () => beende() }, haupt: null };
      }
      default: return { links: { text: T.fertig.weitere, aktion: "ki-weitere", tun: () => nochEine() },
        rechte: o.zeigeEinstellungen && rahmen === "dialog" ? { text: T.fertig.rechte, aktion: "ki-rechte", tun: () => { o.zeigeEinstellungen("ki-zugriff"); beende(); } } : null,
        haupt: { text: rahmen === "assistent" ? T.fertig.weiter : T.fertig.fertig, ok: true, aktion: "ki-fertig", tun: () => beende(), ohneKi: false } };
    }
  }
  function zeichneFuss() {
    fussEl.hidden = fussHost;
    if (fussHost) return;
    const b = fussBeschreibung();
    const k = [];
    if (b.links) k.push(baueKnopf({ text: b.links.text, symbol: b.links.symbol, variante: "leise", groesse: "s", klasse: "kv-links", aktion: b.links.aktion, aufKlick: b.links.tun, laedt: b.links.lade }));
    if (b.rechte) k.push(baueKnopf({ text: b.rechte.text, variante: "leise", groesse: "s", klasse: "kv-links", aktion: b.rechte.aktion, aufKlick: b.rechte.tun }));
    if (b.zurueck) k.push(baueKnopf({ text: b.zurueck.text, symbol: "pfeil-links", variante: "leise", groesse: "s", klasse: "kv-links", aktion: b.zurueck.aktion, aufKlick: b.zurueck.tun }));
    if (b.zu) k.push(baueKnopf({ text: b.zu.text, variante: "leise", groesse: "m", aktion: b.zu.aktion, aufKlick: b.zu.tun }));
    if (b.haupt) k.push(baueKnopf({ text: b.haupt.text, variante: b.haupt.ohneKi ? "sekundaer" : "primaer", aktion: b.haupt.aktion, disabled: !b.haupt.ok, laedt: !!b.haupt.lade, aufKlick: b.haupt.tun }));
    fussEl.replaceChildren(...k);
  }

  // ---------------------------------------------------------------- Zeichnen
  let letzterSchritt = null;
  function zeichne() {
    if (Z.tot) return;
    zeichneKopf();
    const rein = letzterSchritt !== Z.schritt; letzterSchritt = Z.schritt;
    const knoten = { waehlen: rumpfWaehlen, konto: rumpfKonto, stufe: rumpfStufe, pruefen: rumpfPruefen, fertig: rumpfFertig }[Z.schritt]();
    rumpfEl.dataset.schritt = Z.schritt;
    rumpfEl.replaceChildren(...[].concat(knoten));
    if (rein && !ruhig()) { rumpfEl.classList.remove("kv-rein"); void rumpfEl.offsetWidth; rumpfEl.classList.add("kv-rein"); }
    zeichneFuss();
  }

  // ---- 1 · Wählen
  function baueAuswahl() {
    auswahl = kiAuswahl({ erkennung: Z.erkannt ? Z.erkennung : null, wert: Z.prog ? [Z.prog] : [], mehrfach: false, waehlbar: (e) => e.verbindbar, beliebteAnzahl: 4, verbunden: verbundeneIds(), daten: { "data-bereich": "ziel-wahl" },
      aufAenderung: (ids) => { if (Z.busy) { auswahl.setzeWert(Z.prog ? [Z.prog] : []); return; } if (ids[0] && ids[0] !== Z.prog) waehleProgramm(ids[0]); zeichneKopf(); zeichneFuss(); aenderung(); } });
    return auswahl;
  }
  function rumpfWaehlen() {
    if (!Z.geladen) return [h("div", { klasse: "kv-laedt", role: "status" }, h("span", { klasse: "kv-dreh", "aria-hidden": "true" }), h("span", { klasse: "kv-shimmer", text: TKV.laedt }))];
    if (!auswahl) baueAuswahl();
    else { auswahl.setzeErkennung(Z.erkannt ? Z.erkennung : null); auswahl.setzeVerbunden(verbundeneIds()); auswahl.setzeWert(Z.prog ? [Z.prog] : []); }
    const teile = [h("p", { klasse: "kv-text", text: rahmen === "dialog" ? TKV.waehlen.text : TKV.waehlen.textKarte })];
    if (Z.ladeFehler) teile.push(h("div", { klasse: "kv-meldung fehler", role: "alert" }, symbol("warnung", 14), h("span", { text: TKV.waehlen.ladeFehler })));
    teile.push(auswahl.el);
    if (Z.geladen && Z.erkannt && !Object.values(Z.erkennung).some((x) => x.gefunden)) teile.push(h("p", { klasse: "kv-hinweis", "data-bereich": "keine-ki", text: TKV.waehlen.keineKi }));
    if (Z.neuKonten.length) {
      const namen = Z.neuKonten.map((k) => (k.name ? `„${k.name}“` : k.programmName)).join(", ");
      const eintragen = baueKnopf({ text: TE.ki.neuKontenEintragen, groesse: "s", aktion: "konten-eintragen", aufKlick: async () => { try { await mitLaden(eintragen, () => api.kiKontenAbgleich()); await lade(false); } catch (e) { melde(meldungVon(e)); } } });
      teile.push(h("div", { klasse: "kv-neu", "data-bereich": "neue-konten" }, h("p", { klasse: "kv-hinweis", text: TE.ki.neuKonten(namen, Z.neuKonten.some((k) => k.startet === "teils")) }), eintragen));
    }
    const kopieren = baueKnopf({ text: TKV.waehlen.konfigKopieren, groesse: "s", symbol: "kopieren", aktion: "konfig-kopieren", aufKlick: async () => {
      try { const r = await mitLaden(kopieren, () => api.mcpKonfiguration()); if (r?.json && await kopiere(r.json)) melde(TKV.waehlen.konfigKopiert); else melde(TKV.waehlen.konfigFehler); } catch (e) { melde(meldungVon(e)); } } });
    teile.push(h("div", { klasse: "kv-konfig" }, h("span", {}, h("b", { text: TKV.waehlen.konfigTitel }), ` ${TKV.waehlen.konfigKurz}`), kopieren));
    // Im Assistenten gehört die Fußleiste dem Host: „Neu suchen“ (ein Programm wurde inzwischen installiert) steht dann hier im Schritt
    if (fussHost) teile.push(baueKnopf({ text: Z.sucht ? TKV.waehlen.sucht : TKV.waehlen.neuSuchen, symbol: "sync", variante: "leise", groesse: "s", aktion: "ki-neu-suchen", laedt: Z.sucht, aufKlick: () => neuSuchen() }));
    return teile;
  }

  // ---- 2 · Konto
  function kontoZeile(k) {
    const z = anmZustand(k);
    const an = Z.konto === k.id;
    const ton = z === "angemeldet" ? "ok" : z === "abgelaufen" || z === "nicht-angemeldet" ? "warn" : "";
    return h("button", { type: "button", klasse: "kv-konto", role: "radio", "aria-checked": String(an), "data-konto": k.id, "data-anmeldung": z || "",
      aufClick: () => { if (Z.anmeldung?.laeuft() || Z.busy) return; if (Z.konto !== k.id) { stoppeAnmeldung(); waehleKonto(k.id); zeichne(); aenderung(); } } },
      h("span", { klasse: "kv-radio", "aria-hidden": "true" }),
      h("span", { klasse: "kv-konto-text" }, h("b", { text: k.name }), h("span", { klasse: "mono", text: k.verwaltet ? `Kortex · ${String(k.pfad || "").split("/").pop()}` : k.ordner })),
      z ? h("span", { klasse: `kv-marke${ton ? ` ${ton}` : ""}`, text: TKV.konto.zustand[z] || z }) : null);
  }
  function neuFormular() {
    const pname = name(Z.prog);
    const feld = textfeld({ klasse: "kv-eingabe", wert: "", platzhalter: TKV.konto.namePlatzhalter, label: TKV.konto.name, maxlaenge: 60, daten: { "data-kx": "neu-name" } });
    const fehlerEl = h("div", { klasse: "kk-fehlertext", role: "alert", hidden: true, "data-kx": "neu-fehler" });
    const ordnerEl = h("span", { klasse: "mono", "data-kx": "neu-ordner" });
    const zeigeOrdner = () => { ordnerEl.textContent = `Kortex/ki-konten-ordner/${Z.prog}-${slug(feld.input.value || "konto")}`; };
    feld.input.addEventListener("input", () => { zeigeOrdner(); fehlerEl.hidden = true; });
    zeigeOrdner();
    const ok = baueKnopf({ text: TKV.konto.anlegen, variante: "primaer", groesse: "s", aktion: "konto-neu-ok", aufKlick: async () => {
      const n = feld.input.value.replace(/\s+/g, " ").trim();
      if (!n) { fehlerEl.textContent = TKV.konto.leer; fehlerEl.hidden = false; feld.input.focus(); return; }
      if (n.length > 40) { fehlerEl.textContent = TKV.konto.zuLang; fehlerEl.hidden = false; return; }
      ok.setAttribute("aria-busy", "true");
      try {
        const r = await api.kiKontoNeu({ programm: Z.prog, name: n, stufe: "gesperrt" }); // ein neues Konto startet gesperrt: die Stufe wählst du im nächsten Schritt
        Z.neuOffen = false;
        await lade(false);
        const neu = r?.neuesKonto?.id && kontoMit(r.neuesKonto.id);
        if (neu) { waehleKonto(neu.id); Z.anm.set(neu.id, { zustand: "nicht-angemeldet" }); zeichne(); melde(TKV.konto.angelegt(n)); starteAnmeldung(); }
      } catch (e) { ok.removeAttribute("aria-busy"); fehlerEl.textContent = e?.message || TK.fehlerAllgemein; fehlerEl.hidden = false; }
    } });
    const zu = baueKnopf({ text: TKV.konto.abbrechen, variante: "leise", groesse: "s", aktion: "konto-neu-abbrechen", aufKlick: () => { Z.neuOffen = false; zeichne(); aenderung(); } });
    feld.input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); ok.click(); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); zu.click(); } });
    setTimeout(() => feld.input.focus(), 0);
    return h("div", { klasse: "kv-neu-form", "data-kv": "konto-neu", "data-esc-eigen": "" }, h("b", { text: TKV.konto.hinzuTitel(pname) }),
      h("div", { klasse: "kv-feld" }, h("span", { klasse: "kv-label", text: TKV.konto.name }), feld.el),
      h("div", { klasse: "kv-feld" }, h("span", { klasse: "kv-label", text: TE.ki.konto }), ordnerEl), h("p", { klasse: "mini", text: TKV.konto.ordnerText }), fehlerEl,
      h("div", { klasse: "kv-reihe-knoepfe" }, zu, ok));
  }
  function stoppeAnmeldung() { Z.anmeldung?.stoppe(); Z.anmeldung = null; }
  function starteAnmeldung() {
    const k = aktuellesKonto(); if (!k || !ANMELDBAR.includes(k.programm)) return;
    stoppeAnmeldung();
    const a = Z.anmeldung = baueAnmeldung({ api, kt: k,
      beiAngemeldet: (r) => { if (Z.anmeldung !== a) return; Z.anm.set(k.id, r); Z.anmeldung = null; zeichne(); aenderung(); },
      beiAbbruch: () => { if (Z.anmeldung !== a) return; Z.anmeldung = null; Z.anm.set(k.id, { zustand: Z.anm.get(k.id)?.zustand === "abgelaufen" ? "abgelaufen" : "nicht-angemeldet" }); zeichne(); aenderung(); } });
    Z.anmeldung.start(); zeichne(); aenderung();
  }
  function rumpfKonto() {
    const p = Z.prog, konten = kontenVon(p), k = aktuellesKonto();
    const teile = [h("p", { klasse: "kv-text", text: TKV.konto.text })];
    if (!konten.length) teile.push(h("p", { klasse: "kv-hinweis", "data-bereich": "ohne-konto", text: TKV.konto.keine(name(p)) }));
    else teile.push(h("div", { klasse: "kv-konten", role: "radiogroup", "aria-label": TE.ki.konto }, konten.map(kontoZeile)));
    if (!Z.neuOffen) teile.push(baueKnopf({ text: TKV.konto.hinzu, symbol: "plus", groesse: "s", aktion: "konto-hinzu", aufKlick: () => { if (Z.anmeldung?.laeuft()) stoppeAnmeldung(); Z.neuOffen = true; zeichne(); aenderung(); } }));
    else teile.push(Z.neuEl ||= neuFormular()); // einmal gebaut: ein Neuzeichnen (Anmeldestand kommt) darf den getippten Namen nicht wegnehmen
    if (!Z.neuOffen) Z.neuEl = null;
    const z = anmZustand(k);
    if (k && !Z.neuOffen) {
      if (Z.anmeldung) {
        const a = Z.anmeldung;
        teile.push(h("div", { klasse: "kv-anmelden", "data-kv": "anmelden", "data-lauf": "an" }, h("p", { klasse: "kv-text", text: TKE.anmeldung.dialogText }), a.liste, a.befehl, a.hinweis, a.fehlerEl,
          h("div", { klasse: "kv-reihe-knoepfe" }, a.knoepfe.abbruch, a.knoepfe.nochmal, a.knoepfe.jetzt)));
      } else if (z === "angemeldet") {
        teile.push(h("div", { klasse: "kv-meldung ok", role: "status", "data-kv": "angemeldet" }, symbol("kreis-haken", 14), h("span", { text: TKV.konto.angemeldetOk(k.name) })));
      } else if (z === "nicht-angemeldet" || z === "abgelaufen") {
        teile.push(h("div", { klasse: "kv-meldung warn kv-anmelde-hinweis", role: "status", "data-kv": "nicht-angemeldet" },
          h("div", {}, h("b", { text: z === "abgelaufen" ? TKV.konto.abgelaufen(k.name) : TKV.konto.nichtAngemeldet(k.name) }), h("span", { text: ` ${TKV.konto.nichtAngemeldetText}` }), h("span", { klasse: "kv-leise", text: ` ${TKV.konto.spaeterAnmelden}` })),
          baueKnopf({ text: z === "abgelaufen" ? TKV.konto.neuAnmelden : TKV.konto.anmelden, variante: "primaer", groesse: "s", aktion: "konto-anmelden", aufKlick: () => starteAnmeldung() })));
      }
    }
    return teile;
  }

  // ---- 3 · Stufe
  function rumpfStufe() {
    const p = Z.prog, claude = p === "claude";
    const optionen = (Z.vorbelegt === "gesperrt" || Z.stufe === "gesperrt" ? STUFEN_MIT_SPERRE : STUFEN)
      .map((s) => ({ wert: s, text: stufeName(s), ...(s === "erweitert" && !claude ? { daten: { disabled: true, title: TKV.stufe.nurClaude } } : {}) }));
    const text = h("p", { klasse: "kv-stufe-text", "data-kv": "stufe-text" });
    const hinweisG = h("p", { klasse: "kv-hinweis", "data-bereich": "gesperrt" });
    const setze = () => {
      text.textContent = TE.ki.stufen[Z.stufe].text;
      hinweisG.hidden = !(Z.stufe === "gesperrt");
      hinweisG.textContent = sperreBleibt() ? TKV.stufe.gesperrtBleibt : TKV.stufe.gesperrtGewaehlt;
    };
    const seg = segment({ label: TKV.stufe.darf, groesse: "m", wert: Z.stufe, optionen, daten: { "data-kv": "stufe" }, aufAenderung: (w) => { Z.stufe = w; Z.stufeGewaehlt = true; setze(); hinweisG.hidden = true; aenderung(); } });
    setze();
    const p0 = vaultPfad();
    const andere = Z.vaults.filter((v) => v.pfad !== p0);
    const andereZeile = h("div", { klasse: "kv-andere", "data-kv": "andere-vaults" },
      h("div", { klasse: "kv-reihe" }, h("span", { klasse: "kv-cap", text: TKV.stufe.andere }),
        andere.length ? h("ul", { klasse: "kv-vaultliste" }, andere.map((v) => { const s = Z.zugriff?.[Z.konto]?.[v.pfad] || "gesperrt"; return h("li", { "data-vault": v.pfad, "data-stufe": s }, symbol(s === "gesperrt" ? "schloss" : "ordner", 12), h("b", { text: v.name }), h("span", { text: stufeName(s) })); })) : h("span", { klasse: "kv-leise", text: TKV.stufe.andereKeine })),
      andere.length ? h("p", { klasse: "mini", text: TKV.stufe.andereText }) : null);
    const teile = [h("div", { klasse: "kv-reihe" }, h("span", { klasse: "kv-cap", text: TKV.stufe.darf }), seg), text, hinweisG, andereZeile];
    const k = aktuellesKonto();
    if (k && ANMELDBAR.includes(p)) teile.splice(1, 0, h("div", { klasse: "kv-reihe kv-konto-zeile" }, h("span", { klasse: "kv-cap", text: TE.ki.konto }), h("span", { klasse: "kv-konto-name", text: k.name })));
    if (p !== "claude") teile.push(h("div", { klasse: "kv-info", "data-bereich": "kein-leseverbot" }, symbol("info", 12), h("span", { text: TKV.stufe.keinLeseverbot(name(p)) })));
    return teile;
  }

  // ---- 4 · Prüfen
  const ZEILEN = ["programm", "anmeldung", "eintragen", "probe"];
  function rumpfPruefen() {
    const l = Z.lauf || { zeilen: {}, texte: {} };
    const p = Z.prog;
    const li = (id) => {
      const s = l.zeilen[id] || "";
      const t = TKV.pruefen.schritte[id];
      return h("li", { klasse: s, "data-s": id, "data-zustand": s || "wartet" }, h("span", { klasse: "kv-st", "aria-hidden": "true" }, s === "ok" ? symbol("haken", 12) : s === "warn" ? h("span", { klasse: "kv-st-z", text: "!" }) : s === "fehler" ? symbol("schliessen", 12) : null),
        h("span", { text: typeof t === "function" ? t(name(p)) : t }), l.texte[id] ? h("span", { klasse: "mono", text: l.texte[id] }) : null);
    };
    const teile = [h("ol", { klasse: "kv-schritte", id: "kv-schritte", "data-kv": "schritte-lauf" }, ZEILEN.filter((id) => id !== "anmeldung" || ANMELDBAR.includes(p)).map(li))];
    if (l.fehler) {
      teile.push(h("div", { klasse: "kv-meldung fehler", role: "alert", "data-kv": "fehler", "data-art": l.fehler.art || "" }, symbol("warnung", 14), h("div", {}, h("span", { text: l.fehler.text }))));
      if (l.fehler.art === "kein-zugriff") teile.push(baueKnopf({ text: TKV.pruefen.stufeAendern, groesse: "s", aktion: "ki-stufe-aendern", aufKlick: () => { Z.lauf = null; Z.schritt = "stufe"; zeichne(); aenderung(); } }));
    }
    if (l.frage) {
      const nein = baueKnopf({ text: TKV.pruefen.nichtAendern, groesse: "s", aktion: "nicht-umstellen", aufKlick: () => { Z.lauf = null; Z.schritt = "stufe"; zeichne(); aenderung(); } });
      const ja = baueKnopf({ text: TKV.pruefen.umstellen, variante: "primaer", groesse: "s", aktion: "umstellen", aufKlick: () => starteLauf({ umstellen: true }) });
      teile.push(h("div", { klasse: "kv-frage", role: "group", "data-bereich": "umstellen" }, h("p", { klasse: "kv-text", text: TKV.pruefen.anders(name(p)) }), h("div", { klasse: "kv-reihe-knoepfe" }, nein, ja)));
      setTimeout(() => nein.focus(), 0);
    }
    if (l.befehl) {
      const kopieren = baueKnopf({ text: TKV.pruefen.befehlKopieren, groesse: "s", symbol: "kopieren", aktion: "befehl-kopieren", aufKlick: async () => { if (await kopiere(l.befehl)) melde(TKV.pruefen.befehlKopiert); } });
      teile.push(h("div", { klasse: "kv-befehl", "data-bereich": "befehl" }, h("p", { klasse: "kv-text", text: TKV.pruefen.befehl }), h("div", { klasse: "kv-befehl-zeile" }, h("code", { text: l.befehl, tabindex: "0" }), kopieren)));
    }
    return teile;
  }
  async function starteLauf({ umstellen = false } = {}) {
    if (Z.busy && !umstellen) return;
    const p = Z.prog, k = aktuellesKonto();
    const l = Z.lauf = { zeilen: {}, texte: {}, fehler: null, frage: null, befehl: null, nr: (Z.lauf?.nr || 0) + 1 };
    const nr = l.nr, aktiv = () => !Z.tot && Z.lauf === l && nr === l.nr;
    Z.busy = true; Z.schritt = "pruefen"; zeichne(); aenderung();
    const setze = (id, s, text) => { if (!aktiv()) return; l.zeilen[id] = s; if (text !== undefined) l.texte[id] = text; zeichne(); };
    const ende = (fehler) => { if (!aktiv()) { Z.busy = false; return; } Z.busy = false; Object.assign(l, fehler || {}); zeichne(); aenderung(); };
    // 1 Programm gefunden
    setze("programm", "laeuft");
    await warte(250);
    if (Z.erkannt && !gefunden(p)) { l.zeilen.programm = "warn"; l.texte.programm = TKV.pruefen.nichtGefunden; } else { l.zeilen.programm = "ok"; l.texte.programm = Z.erkennung[p]?.version ? TKV.pruefen.version(versionVon(Z.erkennung[p].version) || Z.erkennung[p].version) : ""; }
    // 2 Anmeldung (nur Claude Code und Codex): nur ansehen, nie blockieren
    if (ANMELDBAR.includes(p)) {
      setze("anmeldung", "laeuft");
      let z = k ? Z.anm.get(k.id)?.zustand : null;
      if (k && (!z || z === "prueft")) z = (await pruefeKontoAnmeldung(api, k)).zustand;
      if (!aktiv()) { Z.busy = false; return; }
      if (k) Z.anm.set(k.id, { zustand: z });
      l.zeilen.anmeldung = z === "angemeldet" ? "ok" : z === "nicht-angemeldet" || z === "abgelaufen" ? "warn" : "ok";
      l.texte.anmeldung = z === "angemeldet" ? TKV.pruefen.angemeldet : z === "nicht-angemeldet" || z === "abgelaufen" ? TKV.pruefen.nichtAngemeldetKurz : TKV.pruefen.unbekanntKurz;
      zeichne();
    }
    // 3 Kortex eintragen (die einzige schreibende Stufe). Eine Stufe geht nur mit, wenn sie gilt: ein vom Nutzer gesperrtes Konto bleibt gesperrt, die Werkstatt hält die Sperre.
    setze("eintragen", "laeuft");
    let r;
    try {
      r = await api.mcpVerbinden({ ziel: p, umstellen, konto: Z.konto || undefined, ...(sperreBleibt() ? {} : { zugriff: Z.stufe, zugriffAusdruecklich: Z.stufeGewaehlt }) });
    } catch (e) {
      if (e?.status === 409 && e?.daten?.art === "anders" && !umstellen) { l.zeilen.eintragen = "warn"; return ende({ frage: true }); }
      l.zeilen.eintragen = "fehler";
      const befehl = typeof e?.daten?.befehl === "string" ? e.daten.befehl : null;
      return ende({ fehler: { text: TKV.pruefen.fehler(name(p), e?.status === 404 && !befehl ? TKV.pruefen.nichtGefundenText(name(p)) : meldungVon(e)), art: "verbinden" }, befehl });
    }
    if (!aktiv()) { Z.busy = false; return; }
    l.zeilen.eintragen = "ok"; l.texte.eintragen = r?.schonVerbunden ? TKV.pruefen.schonEingetragen : "";
    // Erweitert = das Konto pflegt den Vault täglich im Hintergrund (nur ein Konto je Vault; das erste gewinnt)
    if (Z.stufe === "erweitert" && Z.konto && !sperreBleibt() && vaultPfad() && r?.zugriffGrund !== "vom-nutzer-gesperrt") {
      // nur wenn für diesen Vault noch kein Konto pflegt (die Pflege eines anderen Kontos überschreibt der Ablauf nie)
      const vp = Z.vaults.find((x) => x.pfad === vaultPfad())?.pflege;
      if (!Z.pflege && !vp?.gesetzt) { try { await api.kiPflegeSetzen({ vault: vaultPfad(), konto: Z.konto, stufe: PFLEGE_STUFE }); if (vp) vp.gesetzt = true; Z.pflege = { konto: Z.konto, name: k?.name || name(p), imDienst: null }; } catch (e) { melde(meldungVon(e)); } }
    }
    // 4 Probe: ein echter, rein lesender Aufruf über den Kortex-Server als dieses Konto
    setze("probe", "laeuft");
    let pr;
    // ohne Konto-Auswahl prüft die Werkstatt als Standardkonto dieses Programms
    try { pr = await api.mcpPruefen({ konto: Z.konto || undefined, programm: p }); }
    catch (e) {
      l.zeilen.probe = "fehler";
      const keinZugriff = e?.daten?.art === "kein-zugriff";
      return ende({ fehler: { text: keinZugriff ? TKV.pruefen.keinZugriff(name(p)) : TKV.pruefen.fehler(name(p), meldungVon(e)), art: e?.daten?.art || "pruefen" } });
    }
    if (!aktiv()) { Z.busy = false; return; }
    l.zeilen.probe = "ok";
    Z.ergebnis = { ok: true, vault: pr?.vault || vaultName(), mitKonto: !!pr?.konto };
    // geglückt: merken, melden, Stand auffrischen, weiter
    const eintrag = { id: p, name: name(p), konto: Z.konto, kontoName: k?.name || null, stufe: sperreBleibt() || r?.zugriffGrund === "vom-nutzer-gesperrt" ? "gesperrt" : Z.stufe, vault: vaultRef() };
    Z.verbunden = [...Z.verbunden.filter((x) => x.id !== p), eintrag];
    Z.ki[p] = { konto: Z.konto, stufe: eintrag.stufe, verbunden: true };
    try { o.beiVerbunden?.({ id: p, konto: Z.konto, stufe: eintrag.stufe }); } catch (e) { console.error(e); }
    try { window.dispatchEvent(new CustomEvent(KONTO_EREIGNIS)); } catch { /* ohne Fenster */ }
    zeichne(); aenderung();
    await warte(700);
    if (!aktiv()) { Z.busy = false; return; }
    await lade(false); // Konten und Zugriffe neu lesen (Fertig-Seite: Leseverbot, Kontingent)
    if (!aktiv()) { Z.busy = false; return; }
    Z.busy = false;
    Z.schritt = "fertig"; Z.kontingent = null; zeichne(); aenderung();
    ladeKontingent();
  }

  // ---- 5 · Fertig
  async function ladeKontingent() {
    const k = aktuellesKonto();
    if (Z.prog !== "claude" || !k) return;
    try {
      const m = await import("./kontingent.js");
      const stand = m.kontingentStand(api);
      await stand.holen();
      if (Z.tot || Z.schritt !== "fertig") return;
      const e = stand.eintrag(k.id);
      Z.kontingent = { eintrag: e, kt: k, modul: m, stand };
      zeichne();
    } catch { /* ohne Kontingent bleibt die Zeile weg */ }
  }
  function rumpfFertig() {
    const v = Z.verbunden.find((x) => x.id === Z.prog) || { id: Z.prog, name: name(Z.prog), stufe: Z.stufe, vault: vaultRef() };
    const k = aktuellesKonto();
    const gesperrt = Z.vaults.filter((x) => x.pfad !== vaultPfad() && (Z.zugriff?.[Z.konto]?.[x.pfad] || "gesperrt") === "gesperrt");
    const sperreHier = v.stufe === "gesperrt";
    const text = sperreHier ? TKV.fertig.gesperrtBleibt(v.vault) : TKV.fertig.darf(v.vault, stufeName(v.stufe));
    const teile = [h("div", { klasse: "kv-erfolg", "data-kv": "fertig" },
      h("div", { klasse: "kv-paar" }, h("span", { klasse: "kv-logo gross" }, kiLogo(v.id, 20, { dekorativ: true })), h("span", { klasse: "kv-linie" }), h("span", { klasse: "kv-logo gross marke" }, markeSvg(22))),
      h("b", { text: TKV.fertig.titel(v.name) }),
      h("p", { text: `${text}${gesperrt.length ? ` ${TKV.fertig.andere(gesperrt.length)}` : ""} ${TKV.fertig.neustart(v.name)}` }),
      Z.ergebnis ? h("div", { klasse: "kv-ergebnis", "data-bereich": "probe-ergebnis" }, symbol("kreis-haken", 14), h("span", { text: Z.ergebnis.mitKonto ? TKV.pruefen.ok(v.name) : TKV.pruefen.okOhneKonto(v.name) })) : null,
      k && ANMELDBAR.includes(v.id) ? h("span", { klasse: "kv-leise", text: TKV.fertig.konto(k.name) }) : null)];
    const optional = [];
    const kt = Z.kontingent;
    if (kt && kt.eintrag && ["nicht-eingerichtet", "geaendert", "neu-verknuepfen", "reparieren"].includes(kt.eintrag.status)) {
      optional.push(h("div", { klasse: "kv-opt", "data-kv": "kontingent" }, h("div", {}, h("b", { text: TKV.fertig.kontingentTitel }), h("span", { text: TKV.fertig.kontingentText })),
        baueKnopf({ text: TKV.fertig.kontingentKnopf, groesse: "s", aktion: "kt-anzeigen", aufKlick: () => kt.modul.kontingentEinwilligung({ api, kt: kt.kt, eintrag: kt.eintrag, nachher: async () => { await kt.stand.holen(); Z.kontingent = { ...kt, eintrag: kt.stand.eintrag(kt.kt.id) }; zeichne(); } }) })));
    }
    const schutz = k?.schutz;
    if (v.id === "claude" && gesperrt.length && schutz?.moeglich && !gesperrt.every((x) => schutz.vaults?.[x.schluessel || x.pfad] === "aktiv" || schutz.vaults?.[x.pfad] === "aktiv")) {
      optional.push(h("div", { klasse: "kv-opt hinweis", "data-kv": "leseverbot" }, h("div", {}, h("b", { text: TKV.fertig.leseverbotTitel }), h("span", { text: TKV.fertig.leseverbotText(gesperrt.length) })),
        o.zeigeEinstellungen ? baueKnopf({ text: TKV.fertig.leseverbotKnopf, groesse: "s", aktion: "leseverbot-ansehen", aufKlick: () => { o.zeigeEinstellungen("ki-zugriff"); beende(); } }) : null));
    }
    if (optional.length) teile.push(h("div", { klasse: "kv-optional" }, optional));
    if (fussHost) teile.push(baueKnopf({ text: TKV.fertig.weitere, symbol: "plus", groesse: "s", klasse: "kv-weitere", aktion: "ki-weitere", aufKlick: () => nochEine() }));
    return teile;
  }

  // ---------------------------------------------------------------- Ablauf
  const kopiere = async (t) => { try { if (o.kopiere) return await o.kopiere(t); await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  const melde = (t) => { if (o.melde) o.melde(t); else toast(t); };
  async function neuSuchen() {
    if (Z.sucht) return;
    const vorher = Object.values(Z.erkennung).filter((x) => x.gefunden).length;
    Z.sucht = true; zeichneFuss();
    await lade(true);
    if (Object.values(Z.erkennung).filter((x) => x.gefunden).length <= vorher) melde(TKV.waehlen.nichtsNeues);
  }
  function weiter() {
    if (Z.schritt === "waehlen") {
      if (!Z.prog) return;
      Z.schritt = ANMELDBAR.includes(Z.prog) ? "konto" : "stufe";
      if (Z.schritt === "konto") { zeichne(); pruefeAnmeldungen(); aenderung(); return; }
    } else if (Z.schritt === "konto") { stoppeAnmeldung(); Z.schritt = "stufe"; Z.neuOffen = false; }
    zeichne(); aenderung();
  }
  function zurueck() {
    const l = schritteListe(), i = l.indexOf(Z.schritt);
    if (Z.schritt === "pruefen") { Z.lauf = null; Z.busy = false; }
    if (Z.schritt === "konto") stoppeAnmeldung();
    if (i > 0) { Z.schritt = l[i - 1]; Z.neuOffen = false; zeichne(); aenderung(); }
  }
  function nochEine() {
    stoppeAnmeldung();
    Z.prog = null; Z.konto = null; Z.lauf = null; Z.ergebnis = null; Z.schritt = "waehlen"; Z.neuOffen = false; Z.kontingent = null;
    auswahl = null;
    zeichne(); aenderung();
  }
  function beende() {
    stoppeAnmeldung();
    try { o.beiFertig?.({ verbunden: Z.verbunden.slice() }); } catch (e) { console.error(e); }
  }
  function zerstoere() { Z.tot = true; stoppeAnmeldung(); }
  // Hauptknopf und Zurück für den Host (Assistent): → true, wenn der Host selbst weitergehen soll
  function primaerTun() {
    const b = fussBeschreibung();
    if (!b.haupt?.ok) return false;
    if (Z.schritt === "fertig" || (Z.schritt === "waehlen" && b.haupt.ohneKi)) return true;
    b.haupt.tun?.();
    return false;
  }
  function zurueckTun() {
    if (Z.busy) return true;
    if (Z.schritt === "waehlen" || Z.schritt === "fertig") return false;
    zurueck();
    return true;
  }
  function fuss() {
    const b = fussBeschreibung();
    return { primaer: b.haupt ? { text: b.haupt.text, ok: b.haupt.ok !== false, lade: !!b.haupt.lade } : { text: TKV.fertig.weiter, ok: false }, kannZurueck: Z.schritt !== "waehlen" && Z.schritt !== "fertig", beschaeftigt: !!Z.busy, schritt: Z.schritt };
  }

  zeichne();
  if (!o.lazy) lade(); // lazy: der Host (Assistent) ruft lade() selbst, wenn der Schritt dran ist
  return {
    el: wurzel, z: Z, lade, zeichne, fuss, primaerTun, zurueckTun, zerstoere, beende, nochEine, neuSuchen,
    verbundene: () => Z.verbunden.map((v) => ({ id: v.id, name: v.name })),
    schritt: () => Z.schritt, istBeschaeftigt: () => !!Z.busy, laeuftAnmeldung: () => !!Z.anmeldung?.laeuft(), abbrechenLogin: () => { if (Z.anmeldung?.laeuft()) { Z.anmeldung.knoepfe.abbruch.click(); return true; } return false; },
    // Neuer Vault (Assistent): was zum alten gehörte (Auswahl, Stufen, Pflege, Eintragungen), gilt nicht mehr; gelesen wird erneut, sobald der Schritt dran ist
    vaultGewechselt() { stoppeAnmeldung(); Z.verbunden = []; Z.ki = {}; Z.pflege = null; Z.prog = null; Z.konto = null; Z.lauf = null; Z.ergebnis = null; Z.schritt = "waehlen"; Z.geladen = false; Z.angefangen = false; Z.neuOffen = false; auswahl = null; letzterSchritt = null; zeichne(); },
  };
}

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

// ============================================================================================================================================
// Als Dialog (Statusleiste, Befehlspalette, Konto-Menü, Einstellungen). Löst den Ablauf auf, der Dialog schließt mit Esc oder „Abbrechen“.
// opt: wie erzeugeKiVerbinden (api, vaultPfad, vaultName, start, beiVerbunden, zeigeEinstellungen, kopiere) + beiFertig({ verbunden }) beim Schließen (egal wie)
export function oeffneKiVerbinden(opt = {}) {
  let d = null, fluss = null;
  fluss = erzeugeKiVerbinden({ ...opt, rahmen: "dialog", fuss: "eigen", vorwahl: opt.vorwahl !== false, beiFertig: () => d?.schliessen() });
  const box = h("div", { klasse: "dialog kv-box", role: "dialog", "aria-modal": "true", "aria-label": TKV.dialogAria, "data-dialog": "ki-verbinden" }, fluss.el);
  d = dialog({ eigen: box, beiSchliessen: () => { fluss.zerstoere(); try { opt.beiFertig?.({ verbunden: fluss.z.verbunden.slice() }); } catch (e) { console.error(e); } } });
  return { ...d, fluss };
}
