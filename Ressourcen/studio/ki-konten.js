// „KI-Konten“ (Paket P2, Plan docs/plaene/ki-konten.md, Abschnitt 3.1): Liste der KI-Konten, je Vault „Wer darf diesen Vault sehen?“ (Stufe je Konto), Übersicht aller Vaults,
// Standard für neue Konten, Pflege (Konto und wie viel KI je Vault), Leseverbot in Claude Code und „Strenger Schutz“. Die Routen der Werkstatt (werkstatt/konten.mjs) tun die Arbeit; hier steht nur, was der Nutzer sieht und
// entscheidet. Geschrieben wird nur nach einem Klick; ein Sperren fragt vorher nach und sagt ehrlich, was es schützt und was nicht. Kein innerHTML mit fremden Daten: alles über h().
import { h, dialog, toast } from "./hilfen.js";
import { knopf as baueKnopf, auswahl, segment, textfeld, hakenFeld } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { kiLogo, kiLogoId } from "./ki-logos.js";
import { api as standardApi } from "./api.js";
import { TK } from "./texte-konten.js";

// ---------------------------------------------------------------- Stylesheet (lädt sich selbst, einmalig)
const CSS_URL = new URL("./ki-konten.css", import.meta.url).href;
export function ladeKontenCss() {
  const da = document.querySelector("link[data-konten-css]");
  if (da) return da._bereit || Promise.resolve();
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS_URL;
  l.setAttribute("data-konten-css", "");
  l._bereit = new Promise((ok) => { l.onload = ok; l.onerror = ok; setTimeout(ok, 2500); });
  document.head.append(l);
  return l._bereit;
}

const STUFEN = ["gesperrt", "lesen", "posteingang", "erweitert"];
const NEUE = ["gesperrt", "lesen", "posteingang"];
const zeichen = (name, groesse = 14) => symbol(name, groesse);
const stufeName = (s) => TK.stufen[s]?.name || s;
const gleicherPfad = (a, b) => String(a || "").normalize("NFC").toLowerCase() === String(b || "").normalize("NFC").toLowerCase();

// Marke vor einer Zeile: Zustand nie nur durch Farbe (Symbol und Text daneben)
function marke(art) {
  const sym = art === "gruen" ? "haken" : art === "rot" ? "schliessen" : art === "warn" ? "warnung" : null;
  return h("span", { klasse: "kk-marke", "data-marke": art, "aria-hidden": "true" }, sym ? zeichen(sym, 12) : null);
}

// Eine Auswahl aus Stufen als Knopfgruppe (radiogroup): Pfeiltasten bewegen den Fokus, Leertaste/Enter/Klick wählt.
function segmente({ stufen, wert, label, daten, beiWahl, gesperrt = false }) {
  const gruppe = h("div", { klasse: "kk-seg", role: "radiogroup", "aria-label": label, ...daten });
  const knoepfe = stufen.map((s) => {
    const aktiv = s === wert;
    const b = h("button", {
      type: "button", klasse: "kk-seg-knopf", role: "radio", "aria-checked": String(aktiv), tabindex: aktiv || (wert === undefined && s === stufen[0]) ? "0" : "-1",
      "data-stufe-wahl": s, disabled: gesperrt, aufClick: () => { if (!aktiv) beiWahl(s); },
    }, h("span", { text: (TK.stufen[s]?.name) || TK.vault.neueKontenStufen[s] || s }));
    return b;
  });
  gruppe.addEventListener("keydown", (e) => {
    const i = knoepfe.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % knoepfe.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + knoepfe.length) % knoepfe.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = knoepfe.length - 1;
    if (n === null) return;
    e.preventDefault();
    knoepfe.forEach((k, j) => k.setAttribute("tabindex", j === n ? "0" : "-1"));
    knoepfe[n].focus();
  });
  gruppe.append(...knoepfe);
  return gruppe;
}

// ---------------------------------------------------------------- Dialog
// vault = Pfad des offenen Vaults (vorgewählt), beiZu() meldet das Schließen, beiAenderung() meldet eine geänderte Stufe.
export function oeffneKontenDialog({ api = standardApi, vault = null, beiZu, beiAenderung } = {}) {
  ladeKontenCss();
  const S = {
    daten: null, laedt: true, fehler: null, ansicht: "vault", vaultPfad: vault, beschaeftigt: false,
    meldung: null,            // Satz, wenn die Einstellungen von Claude Code nicht geändert werden konnten
    umbenenne: null,          // Konto-Kennung, deren Name gerade bearbeitet wird
    namensFehler: null,
    pflegeStatus: {},         // letzter/nächster Lauf je Vault-Pfad (GET /api/ki/pflege)
    pflegeEntwurf: {},        // eine noch unvollständige Wahl (Stufe gewählt, Konto fehlt) je Vault-Pfad
    pflegeFehler: null,
    frage: null,              // offene Bestätigung: { art: "sperren", konto, vault, claude } | { art: "streng", konto } | { art: "vorher" }
  };
  let tot = false;

  const intro = h("p", { klasse: "kk-intro", "data-kk": "intro", text: TK.intro });
  const secMeldung = h("div", { klasse: "kk-sektion", "data-kk": "meldung", "aria-live": "polite" });
  const secFrage = h("div", { klasse: "kk-sektion", "data-kk": "frage" });
  const secHinweis = h("div", { klasse: "kk-sektion", "data-kk": "hinweis" });
  const secKonten = h("section", { klasse: "kk-sektion", "data-kk": "konten" });
  const secZugriff = h("section", { klasse: "kk-sektion", "data-kk": "zugriff" });
  const secPflege = h("section", { klasse: "kk-sektion", "data-kk": "pflege-abschnitt" });
  const secStreng = h("section", { klasse: "kk-sektion", "data-kk": "streng-abschnitt" });
  const secEhrlich = h("section", { klasse: "kk-sektion", "data-kk": "ehrlich" });
  const rumpf = h("div", { klasse: "kk-rumpf" }, h("div", { klasse: "kk-haupt" }, secMeldung, secFrage, secHinweis, secKonten, secZugriff, secPflege, secStreng, secEhrlich));
  const zuKnopf = baueKnopf({ text: TK.schliessen, variante: "primaer", groesse: "l", aktion: "konten-schliessen", aufKlick: () => d.schliessen() });
  const box = h("div", { klasse: "dialog kk-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "kk-titel", "data-dialog": "ki-konten" },
    h("div", { klasse: "kk-kopf" }, h("h2", { klasse: "kk-titel", id: "kk-titel", text: TK.titel }), intro),
    rumpf,
    h("div", { klasse: "kk-fuss" }, baueKnopf({ text: TK.neuSuchen, aktion: "konten-neu-suchen", aufKlick: () => lade() }), h("span", { klasse: "kk-fuss-platz" }), zuKnopf));
  const d = dialog({ eigen: box, beiSchliessen: () => { tot = true; beiZu?.(); } });
  setTimeout(() => zuKnopf.focus(), 10);

  // ----- Hilfen
  const konten = () => S.daten?.konten || [];
  const vaults = () => S.daten?.vaults || [];
  const aktuellerVault = () => vaults().find((v) => v.pfad === S.vaultPfad) || vaults().find((v) => gleicherPfad(v.pfad, S.vaultPfad)) || vaults()[0] || null;
  const stufeVon = (k, v) => S.daten?.zugriff?.[k.id]?.[v.pfad] || "gesperrt";
  const kontoMitId = (id) => konten().find((k) => k.id === id) || null;
  const fehlerSatz = (e) => (e?.status === 0 ? TK.fehlerAllgemein : e?.message || TK.fehlerAllgemein);

  // Antwort der Werkstatt übernehmen. Bei einem Fehler in den Einstellungen von Claude Code steht die Meldung oben.
  function uebernimm(antwort) {
    if (!antwort) return null;
    const { claude, warnungen, ...rest } = antwort;
    if (Array.isArray(warnungen) && warnungen.length) S.warnung = warnungen.join(" ");
    const stand = rest.stand && rest.stand.konten ? rest.stand : rest; // „Neu verbinden“ liefert den Stand in .stand
    if (stand.konten) S.daten = stand;
    return claude || null;
  }
  async function lade() {
    S.laedt = true; S.fehler = null; zeichneAlles();
    try {
      const stand = await api.kiKonten();
      if (tot) return;
      S.daten = stand;
      if (!aktuellerVault()) S.vaultPfad = null; else S.vaultPfad = aktuellerVault().pfad;
    } catch (e) { if (tot) return; S.fehler = e; }
    S.laedt = false;
    zeichneAlles();
    ladePflegeStatus();
  }
  // Letzter/nächster Lauf des gewählten Vaults. Ein Fehler zeigt nur eine Zeile im Pflege-Block, nie den ganzen Dialog als kaputt.
  async function ladePflegeStatus() {
    const v = aktuellerVault();
    if (!v || S.fehler || !S.daten) return;
    try { const st = await api.kiPflege(v.pfad); if (tot) return; S.pflegeStatus[v.pfad] = st; S.pflegeFehler = null; }
    catch (e) { if (tot) return; S.pflegeFehler = e; }
    zeichnePflege();
  }
  // Führt eine Änderung aus; währenddessen sind die Knöpfe gesperrt. fn() → Antwort der Werkstatt.
  async function tue(fn, { erfolg } = {}) {
    if (S.beschaeftigt) return null;
    S.beschaeftigt = true; S.meldung = null; S.warnung = null; zeichneMeldung(); box.setAttribute("aria-busy", "true");
    try {
      const antwort = await fn();
      if (tot) return null;
      const claude = uebernimm(antwort);
      if (claude?.aktion === "fehler") S.meldung = TK.sperre.fehlerSatz(claude.fehler || "");
      else if (erfolg) { const t = erfolg(claude); if (t) toast(t); }
      beiAenderung?.();
      return antwort;
    } catch (e) {
      if (!tot) { S.meldung = fehlerSatz(e); }
      return null;
    } finally { S.beschaeftigt = false; if (!tot) zeichneAlles(); }
  }

  // ----- Aktionen
  async function waehleStufe(k, v, stufe) {
    const alt = stufeVon(k, v);
    if (stufe === alt || S.beschaeftigt) return;
    if (stufe === "gesperrt") { S.frage = { art: "sperren", konto: k.id, vault: v.pfad, claude: k.programm === "claude" }; zeichneAlles(); zeigeFrage(); return; }
    S.frage = null;
    await tue(() => api.kiZugriff({ konto: k.id, vault: v.pfad, stufe }), {
      erfolg: (claude) => (claude?.aktion === "entfernt" ? TK.sperre.entfernt : TK.vault.stufeGesetzt(k.name, stufeName(stufe))),
    });
  }
  async function bestaetigeSperren(frage, claudeSperre) {
    const k = kontoMitId(frage.konto), v = vaults().find((x) => x.pfad === frage.vault);
    S.frage = null;
    if (!k || !v) { zeichneAlles(); return; }
    await tue(() => api.kiZugriff({ konto: k.id, vault: v.pfad, stufe: "gesperrt", ...(frage.claude ? { claudeSperre } : {}) }), {
      erfolg: (claude) => (claude?.aktion === "eingetragen" ? TK.sperre.eingetragen : TK.vault.stufeGesetzt(k.name, stufeName("gesperrt"))),
    });
  }
  async function setzeStandard(v, stufe) {
    await tue(() => api.kiStandard(v.pfad, stufe), { erfolg: () => TK.vault.neueKontenGespeichert });
  }
  async function schalteStreng(k, an) {
    S.frage = null;
    await tue(() => api.kiSchutz(k.id, an), { erfolg: () => (an ? TK.streng.erfolgAn : TK.streng.erfolgAus) });
  }
  // Pflege: Konto und Stufe eines Vaults speichern. Ohne Konto geht nur „Ohne KI“; wählt der Nutzer eine Stufe vor dem Konto, merkt sich der Block die Wahl (Entwurf) und sagt, was fehlt.
  async function setzePflege(v, konto, stufe) {
    if (S.beschaeftigt) return;
    if (stufe !== "aus" && !konto) { S.pflegeEntwurf[v.pfad] = { konto: null, stufe }; zeichnePflege(); return; }
    delete S.pflegeEntwurf[v.pfad];
    const k = kontoMitId(konto);
    await tue(() => api.kiPflegeSetzen({ vault: v.pfad, konto: konto || null, stufe }), { erfolg: () => (stufe === "aus" ? TK.pflege.gespeichertAus : TK.pflege.gespeichert(k?.name || "", TK.pflege.stufen[stufe].name)) });
    ladePflegeStatus();
  }
  async function pflegeJetzt() {
    const antwort = await tue(() => api.kiPflegeJetzt(), { erfolg: () => TK.pflege.jetztGestartet });
    if (antwort) setTimeout(() => { if (!tot) ladePflegeStatus(); }, 2500);
  }
  async function speichereName(k, text) {
    const name = String(text).replace(/\s+/g, " ").trim();
    if (!name) { S.namensFehler = TK.konten.nameLeer; zeichneKonten(); return; }
    if (name.length > 40) { S.namensFehler = TK.konten.nameZuLang; zeichneKonten(); return; }
    S.namensFehler = null; S.umbenenne = null;
    await tue(() => api.kiKontoName(k.id, name), { erfolg: () => TK.konten.benannt });
  }
  const zeigeFrage = () => requestAnimationFrame(() => { if (!tot) { secFrage.scrollIntoView({ block: "nearest" }); secFrage.querySelector("button.primaer, button")?.focus(); } });

  // ----- Zeichnen
  // Beim Neuzeichnen bleibt der Fokus dort, wo er war (Stufenwahl, Ansichtswahl, Strenger Schutz): sonst fiele er nach jeder Wahl auf die Seite zurück.
  function merkeFokus() {
    const a = document.activeElement;
    if (!a || !box.contains(a)) return () => {};
    const konto = a.closest("[data-konto]")?.getAttribute("data-konto") || null;
    let finde = null;
    if (a.matches("[data-stufe-wahl]")) { const gruppe = a.closest("[data-kk]")?.getAttribute("data-kk"); const wert = a.getAttribute("data-stufe-wahl"); finde = () => secZugriff.querySelector(`${konto ? `[data-konto="${konto}"] ` : ""}[data-kk="${gruppe}"] [data-stufe-wahl="${wert}"]`); }
    else if (a.matches("[data-ansicht]")) { const w = a.getAttribute("data-ansicht"); finde = () => secZugriff.querySelector(`[data-ansicht="${w}"]`); }
    else if (a.matches('[data-aktion="streng-an"], [data-aktion="streng-aus"]')) finde = () => secStreng.querySelector(`[data-kk="streng"][data-konto="${konto}"] button:not(:disabled)`);
    else if (a.matches('[data-aktion="konto-umbenennen"]')) finde = () => secKonten.querySelector(`[data-konto="${konto}"] [data-aktion="konto-umbenennen"]`);
    return () => { const n = finde?.(); if (n && !n.disabled) n.focus(); };
  }
  function zeichneAlles() {
    const wieder = merkeFokus();
    zeichneMeldung(); zeichneFrage(); zeichneHinweis(); zeichneKonten(); zeichneZugriff(); zeichnePflege(); zeichneStreng(); zeichneEhrlich();
    box.setAttribute("aria-busy", S.beschaeftigt ? "true" : "false");
    wieder();
  }
  // Nach einer Rückfrage zurück zur gewählten Zeile
  const fokusAufKonto = (id) => requestAnimationFrame(() => { if (!tot) (secZugriff.querySelector(`[data-konto="${id}"] [role="radio"][aria-checked="true"]`) || secZugriff.querySelector(`tr[data-konto="${id}"] select`))?.focus(); });
  function zeichneMeldung() {
    secMeldung.replaceChildren();
    if (S.warnung) secMeldung.append(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "warnung-text" }, marke("warn"), h("p", { text: S.warnung })));
    if (!S.meldung) return;
    secMeldung.append(h("div", { klasse: "kk-karte fehler", role: "alert", "data-kk": "meldung-text" }, marke("rot"), h("p", { text: S.meldung })));
  }
  function zeichneHinweis() {
    secHinweis.replaceChildren();
    if (S.fehler || !S.daten || S.daten.hinweis !== "defekt-neu") return;
    const knoepfe = [
      baueKnopf({ text: TK.defekt.verstanden, aktion: "konten-hinweis-verstanden", disabled: S.beschaeftigt, aufKlick: () => tue(() => api.kiHinweis()) }),
    ];
    if (S.daten.vorherDa) knoepfe.push(baueKnopf({ text: TK.defekt.vorher, aktion: "konten-vorher", disabled: S.beschaeftigt, aufKlick: () => { S.frage = { art: "vorher" }; zeichneAlles(); zeigeFrage(); } }));
    secHinweis.append(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "defekt" },
      h("div", { klasse: "kk-karte-kopf" }, marke("warn"), h("div", { klasse: "kk-karte-titel", text: TK.defekt.titel })),
      h("p", { text: S.daten.hinweisGrund === "geloescht" ? TK.defekt.textGeloescht : TK.defekt.text }),
      h("div", { klasse: "kk-knoepfe" }, knoepfe)));
  }

  // Bestätigungen: Sperren, Strenger Schutz, frühere Fassung
  function zeichneFrage() {
    secFrage.replaceChildren();
    const f = S.frage;
    if (!f) return;
    const abbrechen = baueKnopf({ text: TK.sperren.abbrechen, aktion: "konten-frage-abbrechen", aufKlick: () => { S.frage = null; zeichneAlles(); if (f.konto) fokusAufKonto(f.konto); } });
    if (f.art === "sperren") {
      const k = kontoMitId(f.konto), v = vaults().find((x) => x.pfad === f.vault);
      if (!k || !v) return;
      const datei = `${k.ordner}/settings.json`;
      const hakenZeile = f.claude ? hakenFeld({ checked: true, text: TK.sperren.claudeHaken, klasse: "kk-wahl", daten: { id: "kk-claude-haken", "data-kk": "claude-haken" } }) : null;
      const haken = hakenZeile?.input || null;
      const ja = baueKnopf({ text: TK.sperren.ja, variante: "primaer", aktion: "konten-sperren-ja", aufKlick: () => bestaetigeSperren(f, haken ? haken.checked : false) });
      secFrage.append(h("div", { klasse: "kk-karte bestaetigung", role: "group", "aria-labelledby": "kk-frage-titel", "data-kk": "frage-sperren" },
        h("div", { klasse: "kk-karte-titel", id: "kk-frage-titel", text: TK.sperren.titel(k.name, v.name) }),
        h("div", { klasse: "kk-block" }, h("div", { klasse: "kk-block-titel", text: TK.sperren.schuetztTitel }), h("p", { text: TK.sperren.schuetzt })),
        f.claude
          ? h("div", { klasse: "kk-block" }, h("div", { klasse: "kk-block-titel", text: TK.sperren.claudeTitel }),
            hakenZeile,
            h("p", { klasse: "mini", text: TK.sperren.claudeText(datei) }), h("p", { klasse: "mini", text: TK.sperren.claudeWirkt }))
          : h("div", { klasse: "kk-block" }, h("div", { klasse: "kk-block-titel", text: TK.sperren.andereTitel(k.programmName) }), h("p", { text: TK.sperren.andere(k.programmName) })),
        h("div", { klasse: "kk-block" }, h("div", { klasse: "kk-block-titel", text: TK.sperren.grenzenTitel }), h("p", { text: TK.sperren.grenzen })),
        h("div", { klasse: "kk-knoepfe" }, abbrechen, ja)));
    } else if (f.art === "streng") {
      const k = kontoMitId(f.konto);
      if (!k) return;
      secFrage.append(h("div", { klasse: "kk-karte bestaetigung", role: "group", "aria-labelledby": "kk-frage-titel", "data-kk": "frage-streng" },
        h("div", { klasse: "kk-karte-titel", id: "kk-frage-titel", text: TK.streng.dialogTitel(k.name) }),
        h("p", { text: TK.streng.dialogWas }),
        h("p", { text: TK.streng.dialogEinstellungen }),
        h("div", { klasse: "kk-block" }, h("div", { klasse: "kk-block-titel", text: TK.streng.dialogFolgenTitel }), h("p", { text: TK.streng.dialogFolgen })),
        h("p", { klasse: "mini", text: TK.streng.dialogRueckweg }),
        h("div", { klasse: "kk-knoepfe" }, abbrechen, baueKnopf({ text: TK.streng.dialogJa, variante: "primaer", aktion: "konten-streng-ja", aufKlick: () => schalteStreng(k, true) }))));
    } else if (f.art === "vorher") {
      secFrage.append(h("div", { klasse: "kk-karte bestaetigung", role: "group", "aria-labelledby": "kk-frage-titel", "data-kk": "frage-vorher" },
        h("div", { klasse: "kk-karte-titel", id: "kk-frage-titel", text: TK.defekt.vorherTitel }),
        h("p", { text: TK.defekt.vorherText }),
        h("div", { klasse: "kk-knoepfe" }, abbrechen, baueKnopf({ text: TK.defekt.vorherJa, variante: "primaer", aktion: "konten-vorher-ja", aufKlick: async () => { S.frage = null; await tue(() => api.kiVorher(), { erfolg: () => TK.defekt.vorherErfolg }); } }))));
    }
  }

  // Liste der Konten: Logo, Name (umbenennbar), Programm · Ordner, verbunden ja/nein; bei Claude Code der Strenge Schutz
  function zeichneKonten() {
    secKonten.replaceChildren();
    if (S.laedt) { secKonten.append(h("p", { klasse: "kk-laedt", role: "status", text: TK.laedt })); return; }
    if (S.fehler) {
      secKonten.append(h("div", { klasse: "kk-karte fehler", role: "alert" }, marke("rot"), h("p", { text: S.fehler?.message || TK.fehlerLaden }),
        baueKnopf({ text: TK.nochmal, aktion: "konten-nochmal", aufKlick: () => lade() })));
      return;
    }
    secKonten.append(h("h3", { klasse: "kk-gruppe-titel", text: TK.konten.titel }));
    if (!konten().length) { secKonten.append(h("p", { klasse: "kk-leer", "data-kk": "keine-konten", text: TK.keineKonten })); return; }
    const liste = h("ul", { klasse: "kk-konten", "data-kk": "konten-liste" });
    for (const k of konten()) liste.append(kontoZeile(k));
    secKonten.append(liste);
  }
  function logoFuer(k) {
    return kiLogoId(k.programm) ? kiLogo(k.programm, 20, { dekorativ: true }) : zeichen("person", 20);
  }
  function kontoZeile(k) {
    const li = h("li", { klasse: "kk-konto", "data-konto": k.id, "data-programm": k.programm });
    const kopf = h("div", { klasse: "kk-konto-kopf" });
    const name = S.umbenenne === k.id
      ? namensFeld(k)
      : h("div", { klasse: "kk-konto-name" }, h("span", { klasse: "kk-name", "data-kk": "name", text: k.name }),
        h("button", { klasse: "knopf-text", type: "button", "data-aktion": "konto-umbenennen", "aria-label": TK.konten.umbenennenFuer(k.name), disabled: S.beschaeftigt, text: TK.konten.umbenennen, aufClick: () => { S.umbenenne = k.id; S.namensFehler = null; zeichneKonten(); const f = secKonten.querySelector('[data-kk="name-feld"]'); f?.focus(); f?.select(); } }));
    const chips = h("div", { klasse: "kk-chips" },
      h("span", { klasse: "kk-chip", "data-kk": "verbunden", "data-verbunden": String(!!k.verbunden) }, marke(k.verbunden ? "gruen" : "aus"), h("span", { text: k.verbunden ? TK.konten.verbunden : TK.konten.nichtVerbunden })),
      k.vorhanden === false ? h("span", { klasse: "kk-chip", "data-kk": "nicht-gefunden" }, marke("warn"), h("span", { text: TK.konten.nichtGefunden })) : null);
    kopf.append(h("span", { klasse: "kk-logo" }, logoFuer(k)), h("div", { klasse: "kk-konto-text" }, name,
      h("div", { klasse: "kk-meta", "data-kk": "meta", text: TK.konten.programmOrdner(k.programmName || k.programm, k.ordner) })), chips);
    li.append(kopf);
    // Altform: Eintrag oder Hooks ohne --konto → mit Konto neu verbinden (ändert nur die Einträge von Kortex, nie die Stufe)
    if (k.altform && (k.altform.mcp || k.altform.hooks)) {
      li.append(h("div", { klasse: "kk-altform", "data-kk": "altform" }, marke("warn"),
        h("div", { klasse: "kk-altform-text" }, h("div", { klasse: "kk-block-titel", text: TK.konten.altformTitel }), h("div", { klasse: "mini", text: TK.konten.altformText })),
        baueKnopf({ text: TK.konten.altformKnopf, aktion: "konto-neu-verbinden", aufKlick: () => tue(() => api.kiNeuVerbinden(k.id), { erfolg: () => TK.konten.altformErfolg }) })));
    }
    return li;
  }
  function namensFeld(k) {
    const tf = textfeld({ klasse: "kk-eingabe", wert: k.name, maxlaenge: 60, label: TK.konten.nameFeld, groesse: "s", daten: { "data-kk": "name-feld", "aria-invalid": S.namensFehler ? "true" : null } });
    const feld = tf.input;
    feld.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); speichereName(k, feld.value); } });
    return h("div", { klasse: "kk-konto-name bearbeiten" },
      tf.el,
      baueKnopf({ text: TK.konten.speichern, variante: "primaer", aktion: "konto-name-speichern", aufKlick: () => speichereName(k, feld.value) }),
      baueKnopf({ text: TK.konten.abbrechen, aktion: "konto-name-abbrechen", aufKlick: () => { S.umbenenne = null; S.namensFehler = null; zeichneKonten(); } }),
      S.namensFehler ? h("div", { klasse: "kk-fehlertext", role: "alert", text: S.namensFehler }) : null);
  }
  // Strenger Schutz: nur Claude Code, aus der Werkstatt gemeldet (schutz.moeglich); ein eigener Abschnitt unter der Wahl der Stufen
  function zeichneStreng() {
    secStreng.replaceChildren();
    if (S.laedt || S.fehler || !S.daten) return;
    const claude = konten().filter((k) => k.schutz?.moeglich);
    if (!claude.length) return;
    secStreng.append(h("h3", { klasse: "kk-gruppe-titel", text: TK.streng.titel }), h("p", { klasse: "mini", text: TK.streng.hilfe }));
    const warn = [...new Set(claude.flatMap((k) => (k.schutz.strenger ? k.schutz.warnungen || [] : []).map((w) => `${k.name}: ${TK.streng.warnungen[w] || w}`)))];
    if (claude.some((k) => k.schutz.strenger)) warn.push(TK.streng.projektHinweis);
    if (warn.length) secStreng.append(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "streng-warnung" }, marke("warn"), h("ul", { klasse: "kk-punkte" }, warn.map((t) => h("li", { text: t })))));
    const liste = h("ul", { klasse: "kk-konten", "data-kk": "streng-liste" });
    for (const k of claude) liste.append(strengZeile(k));
    secStreng.append(liste);
  }
  function strengZeile(k) {
    const s = k.schutz;
    const gesperrte = vaults().filter((v) => stufeVon(k, v) === "gesperrt").length;
    const an = !!s.strenger;
    const zustand = an ? (s.strengerAktiv ? TK.streng.an : TK.streng.inaktiv) : TK.streng.aus;
    const knopf = an
      ? baueKnopf({ text: TK.streng.ausschalten, aktion: "streng-aus", aufKlick: () => schalteStreng(k, false) })
      : baueKnopf({ text: TK.streng.einschalten, aktion: "streng-an", disabled: gesperrte === 0, aufKlick: () => { S.frage = { art: "streng", konto: k.id }; zeichneAlles(); zeigeFrage(); } });
    return h("li", { klasse: "kk-streng", "data-kk": "streng", "data-konto": k.id, "data-streng": an ? "an" : "aus" },
      h("span", { klasse: "kk-logo" }, logoFuer(k)),
      h("div", { klasse: "kk-streng-text" },
        h("div", { klasse: "kk-streng-kopf" }, h("span", { klasse: "kk-name", text: k.name }), h("span", { klasse: "kk-streng-zustand", "data-kk": "streng-zustand", text: zustand })),
        !an && gesperrte === 0 ? h("div", { klasse: "mini", text: TK.streng.keinGesperrter }) : null),
      knopf);
  }

  // Wer darf diesen Vault sehen? — pro Vault oder als Übersicht aller Vaults
  function zeichneZugriff() {
    secZugriff.replaceChildren();
    if (S.laedt || S.fehler || !S.daten) return;
    const kopf = h("div", { klasse: "kk-zugriff-kopf" }, h("h3", { klasse: "kk-gruppe-titel", text: TK.vault.titel }));
    const hatMatrix = vaults().length >= 2 && konten().length >= 2;
    if (!hatMatrix) S.ansicht = "vault";
    if (hatMatrix) {
      kopf.append(h("div", { klasse: "kk-ansicht", role: "group", "aria-label": TK.vault.titel },
        ...["vault", "matrix"].map((a) => h("button", { type: "button", klasse: "kk-ansicht-knopf", "aria-pressed": String(S.ansicht === a), "data-ansicht": a, text: a === "vault" ? TK.vault.ansichtVault : TK.vault.ansichtMatrix,
          aufClick: () => { S.ansicht = a; zeichneZugriff(); } }))));
    }
    secZugriff.append(kopf);
    if (!vaults().length) { secZugriff.append(h("p", { klasse: "kk-leer", "data-kk": "kein-vault", text: TK.vault.keinVault })); return; }
    if (!konten().length) { secZugriff.append(h("p", { klasse: "kk-leer", text: TK.vault.keineKonten })); return; }
    if (S.ansicht === "matrix") zeichneMatrix(); else zeichneVaultAnsicht();
    secZugriff.append(legende());
  }
  // ---- Pflege: Konto und wie viel KI, je Vault. Konten zur Wahl nur mit Stufe „Erweitert“ für diesen Vault; die Liste der Schritte sagt in Alltagssprache, was bei der gewählten Stufe passiert.
  const zeitText = (iso) => { try { return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
  function zeichnePflege() {
    secPflege.replaceChildren();
    if (S.laedt || S.fehler || !S.daten || !konten().length || !vaults().length) return;
    const v = aktuellerVault();
    if (!v) return;
    const P = TK.pflege;
    const p = v.pflege || { gesetzt: false, wirksam: "alt" };
    const entwurf = S.pflegeEntwurf[v.pfad] || null;
    const kontoId = entwurf ? entwurf.konto : p.konto || null;
    const stufe = entwurf ? entwurf.stufe : p.gesetzt ? p.stufe : "mittel";
    secPflege.append(h("div", { klasse: "kk-zugriff-kopf" }, h("h3", { klasse: "kk-gruppe-titel", text: P.titel })), h("p", { klasse: "mini", "data-kk": "pflege-intro", text: P.intro }));
    if (S.ansicht === "matrix" && vaults().length > 1) secPflege.append(vaultAuswahl());
    else if (vaults().length > 1) secPflege.append(h("div", { klasse: "kk-vault-name", "data-kk": "pflege-vault" }, zeichen("vault", 14), h("span", { text: v.name })));
    // Hinweis aus der Migration des Dienstes, Problem der Einstellung
    const hinweis = (S.daten.pflegeHinweise || []).find((x) => gleicherPfad(x.vault, v.schluessel || v.pfad) || gleicherPfad(x.vault, v.pfad));
    if (hinweis) {
      const k = kontoMitId(hinweis.konto);
      secPflege.append(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "pflege-migration" }, marke("warn"),
        h("p", { text: hinweis.grund === "stufe" ? P.migration.stufe(k?.name || "") : P.migration["kein-konto"] })));
    } else if (p.problem && p.gesetzt) {
      secPflege.append(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "pflege-problem", "data-problem": p.problem }, marke("warn"), h("p", { text: P.problem[p.problem] || P.problem.unlesbar })));
    }
    // Die plist des Dienstes trägt noch das alte feste Konto (Neuschreiben offen oder gescheitert): sagen, warum
    if (S.daten.pflegePlist && S.daten.pflegePlist.offen) {
      secPflege.append(h("div", { klasse: "kk-karte warn", role: "status", "data-kk": "pflege-plist", "data-grund": S.daten.pflegePlist.grund }, marke("warn"),
        h("div", { klasse: "kk-block" }, h("div", { klasse: "kk-block-titel", text: P.plist.titel }), h("p", { text: P.plist.text }), h("p", { klasse: "mini", text: P.plist.grund[S.daten.pflegePlist.grund] || P.plist.grund.fehler }))));
    }
    // Konto: nur Claude-Code-Konten mit „Erweitert“ in diesem Vault
    const eignung = konten().filter((k) => k.programm === "claude" && stufeVon(k, v) === "erweitert");
    const optionen = eignung.map((k) => ({ wert: k.id, text: k.name, logo: kiLogoId(k.programm) ? k.programm : undefined, sub: k.ordner }));
    const gewaehlt = kontoMitId(kontoId);
    if (gewaehlt && !optionen.some((o) => o.wert === gewaehlt.id)) optionen.push({ wert: gewaehlt.id, text: gewaehlt.name, logo: kiLogoId(gewaehlt.programm) ? gewaehlt.programm : undefined, sub: stufeName(stufeVon(gewaehlt, v)) });
    const zeile = h("div", { klasse: "kk-pflege-zeile" });
    if (!optionen.length) {
      zeile.append(h("div", { klasse: "kk-karte schmal", "data-kk": "pflege-kein-konto" }, marke("aus"), h("p", { text: P.keinKonto })));
    } else {
      const wahl = auswahl({ optionen, wert: kontoId || "",   // "" = noch keins gewählt (zeigt den Platzhalter; undefined nähme die erste Option)
         platzhalter: P.kontoPlatzhalter, label: P.konto, breit: true, daten: { "data-kk": "pflege-konto" },
        aufAenderung: (w) => { const n = S.pflegeEntwurf[v.pfad]; setzePflege(v, w, n ? n.stufe : p.gesetzt && p.stufe !== "aus" ? p.stufe : "mittel"); } });
      zeile.append(h("div", { klasse: "kk-pflege-feld" }, h("span", { klasse: "kk-block-titel", "aria-hidden": "true", text: P.konto }), wahl));
    }
    const seg = segment({ optionen: ["klein", "mittel", "aus"].map((s) => ({ wert: s, text: P.stufen[s].name, daten: { "data-stufe-wahl": s } })), wert: stufe, label: P.stufe, daten: { "data-kk": "pflege-stufe" },
      aufAenderung: (s) => {
        let k = kontoId;
        if (!k && s !== "aus" && eignung.length === 1) k = eignung[0].id;     // genau ein Konto zur Wahl: kein zweiter Klick nötig
        setzePflege(v, k, s);
      } });
    zeile.append(h("div", { klasse: "kk-pflege-feld" }, h("span", { klasse: "kk-block-titel", "aria-hidden": "true", text: P.stufe }), seg));
    secPflege.append(zeile);
    secPflege.append(h("p", { klasse: "kk-stufentext", "data-kk": "pflege-stufentext", text: P.stufen[stufe].text }));
    if (entwurf && !entwurf.konto) secPflege.append(h("p", { klasse: "kk-fehlertext", role: "status", "data-kk": "pflege-waehle-zuerst", text: P.waehleZuerst }));
    if (!p.gesetzt && !entwurf) secPflege.append(h("p", { klasse: "mini", "data-kk": "pflege-alt", text: P.alt }));

    // Was die Pflege tut
    const gruppe = (titel, zustandAn, punkte, kennung) => h("div", { klasse: "kk-tut-gruppe", "data-kk": kennung, "data-aktiv": String(zustandAn) },
      h("div", { klasse: "kk-tut-kopf" }, marke(zustandAn ? "gruen" : "aus"), h("span", { klasse: "kk-block-titel", text: titel }), h("span", { klasse: "kk-tut-zustand", text: zustandAn ? P.aktiv : P.ruht })),
      h("ul", { klasse: "kk-punkte" }, punkte.map((x) => h("li", { text: x }))));
    secPflege.append(h("div", { klasse: "kk-karte schmal", "data-kk": "pflege-tut" }, h("div", { klasse: "kk-block-titel", text: P.tutTitel }),
      gruppe(P.immer, true, P.immerListe, "tut-immer"),
      gruppe(P.haikuTitel, stufe !== "aus", P.mitKiListe.haiku, "tut-haiku"),
      gruppe(P.sonnetTitel, stufe === "mittel", P.mitKiListe.sonnet, "tut-sonnet")));

    // Letzter und nächster Lauf, Jetzt pflegen
    const st = S.pflegeStatus[v.pfad];
    const lauf = h("div", { klasse: "kk-karte schmal", "data-kk": "pflege-lauf" }, h("div", { klasse: "kk-block-titel", text: P.lauf }));
    if (S.pflegeFehler && !st) lauf.append(h("p", { klasse: "kk-fehlertext", text: P.fehlerLaden }));
    else if (st) {
      const l = st.letzter;
      if (!l || !l.zeit) lauf.append(h("p", { "data-kk": "pflege-letzter", text: P.nochNie }));
      else {
        lauf.append(h("div", { klasse: "kk-lauf-zeile", "data-kk": "pflege-letzter", "data-status": l.status }, marke(l.erfolgreich ? "gruen" : "warn"),
          h("span", { text: `${P.letzter(zeitText(l.zeit))} — ${P.status[l.status] || P.status.unbekannt} · ${P.zahlen(l.aufrufe, l.tokEin, l.tokAus)}` })));
        if (l.modus === "probe") lauf.append(h("p", { klasse: "mini", text: P.probe }));
        if (l.grund && !l.erfolgreich) lauf.append(h("p", { klasse: "mini", "data-kk": "pflege-grund", text: l.grund }));
      }
      const n = st.naechster || {};
      lauf.append(h("p", { "data-kk": "pflege-naechster", text: n.art === "dienst" ? P.naechster.dienst(n.fruehestens ? zeitText(n.fruehestens) : null) : P.naechster[n.art] || "" }));
      const offen = gleicherPfad(v.pfad, vault);
      const knopf = baueKnopf({ text: P.jetzt, variante: "primaer", aktion: "pflege-jetzt", daten: { "data-kk": "pflege-jetzt" }, aufKlick: () => pflegeJetzt() });
      if (!offen || st.schalter === "aus" || S.beschaeftigt) knopf.disabled = true;
      lauf.append(h("div", { klasse: "kk-pflege-jetzt" }, knopf,
        !offen ? h("span", { klasse: "mini", text: P.jetztNurOffener }) : st.schalter === "probe" ? h("span", { klasse: "mini", text: P.jetztProbe }) : null));
    }
    secPflege.append(lauf);
  }

  function vaultAuswahl() {
    if (vaults().length === 1) return h("div", { klasse: "kk-vault-name", "data-kk": "vault-name" }, zeichen("vault", 14), h("span", { text: vaults()[0].name }));
    const sel = auswahl({ optionen: vaults().map((v) => ({ wert: v.pfad, text: v.name })), wert: aktuellerVault()?.pfad || "", label: TK.vault.wahl, daten: { "data-kk": "vault-wahl" }, klasse: "kk-auswahl",
      aufAenderung: (pfad) => { S.vaultPfad = pfad; S.frage = null; zeichneAlles(); ladePflegeStatus(); } });
    return h("div", { klasse: "kk-vault-wahl" }, h("span", { klasse: "kk-vault-label", "aria-hidden": "true", text: TK.vault.wahl }), sel);
  }
  function zeichneVaultAnsicht() {
    const v = aktuellerVault();
    secZugriff.append(vaultAuswahl());
    const liste = h("ul", { klasse: "kk-zeilen", "data-kk": "zugriff-liste" });
    for (const k of konten()) {
      const stufe = stufeVon(k, v);
      const li = h("li", { klasse: "kk-zeile", "data-konto": k.id, "data-stufe": stufe });
      li.append(
        h("div", { klasse: "kk-zeile-kopf" },
          h("span", { klasse: "kk-logo" }, logoFuer(k)),
          h("span", { klasse: "kk-name", text: k.name }),
          segmente({ stufen: STUFEN, wert: stufe, label: TK.vault.zeileFuer(k.name, v.name), daten: { "data-kk": "stufen" }, gesperrt: S.beschaeftigt, beiWahl: (s) => waehleStufe(k, v, s) })),
        h("p", { klasse: "kk-stufentext", "data-kk": "stufentext", text: TK.stufen[stufe].text }));
      if (stufe === "gesperrt") li.append(sperrZustand(k, v));
      liste.append(li);
    }
    secZugriff.append(liste);
    // Standard für neue Konten
    const e = v;
    secZugriff.append(h("div", { klasse: "kk-neu", "data-kk": "neue-konten" },
      h("div", { klasse: "kk-neu-text" }, h("div", { klasse: "kk-block-titel", text: TK.vault.neueKonten }), h("div", { klasse: "mini", text: TK.vault.neueKontenHilfe })),
      segmente({ stufen: NEUE, wert: e.neueKonten || "gesperrt", label: `${TK.vault.neueKonten}: ${v.name}`, daten: { "data-kk": "neue-stufen" }, gesperrt: S.beschaeftigt, beiWahl: (s) => setzeStandard(v, s) })));
  }
  // Zustand der Sperre in Claude Code für ein gesperrtes Konto in einem Vault (nur bei Claude Code), sonst der ehrliche Satz
  function sperrZustand(k, v) {
    if (!k.schutz?.moeglich) return h("div", { klasse: "kk-sperrzustand", "data-kk": "sperrzustand", "data-zustand": "kortex" }, marke("aus"), h("span", { text: TK.sperre.anderesProgramm(k.programmName || k.programm) }));
    const schluessel = v.schluessel || v.pfad;
    const z = k.schutz.vaults?.[schluessel] || k.schutz.vaults?.[v.pfad] || "aus";
    const gut = z === "aktiv" || z === "eigene";
    const knopf = gut ? null : h("button", { klasse: "knopf-text", type: "button", "data-aktion": "leseverbot-eintragen", disabled: S.beschaeftigt || z === "defekt",
      text: z === "fehlt" || z === "veraltet" ? TK.sperre.erneuern : TK.sperre.eintragen, aufClick: () => { S.frage = { art: "sperren", konto: k.id, vault: v.pfad, claude: true }; zeichneAlles(); zeigeFrage(); } });
    return h("div", { klasse: "kk-sperrzustand", "data-kk": "sperrzustand", "data-zustand": z }, marke(gut ? "gruen" : z === "aus" ? "aus" : "warn"), h("span", { text: TK.sperre[z] || TK.sperre.aus }), knopf);
  }
  function zeichneMatrix() {
    const tabelle = h("table", { klasse: "kk-matrix", "data-kk": "matrix" });
    tabelle.append(h("caption", { klasse: "kk-matrix-hinweis", text: TK.vault.matrixHinweis }));
    tabelle.append(h("thead", {}, h("tr", {}, h("th", { scope: "col", text: TK.vault.matrixKonto }), vaults().map((v) => h("th", { scope: "col", "data-vault": v.pfad, text: v.name })))));
    const koerper = h("tbody");
    for (const k of konten()) {
      const tr = h("tr", { "data-konto": k.id }, h("th", { scope: "row" }, h("span", { klasse: "kk-matrix-konto" }, h("span", { klasse: "kk-logo" }, logoFuer(k)), h("span", { text: k.name }))));
      for (const v of vaults()) {
        const sel = auswahl({ optionen: STUFEN.map((s) => ({ wert: s, text: stufeName(s) })), wert: stufeVon(k, v), label: TK.vault.zeileFuer(k.name, v.name), groesse: "s", disabled: S.beschaeftigt,
          daten: { "data-kk": "matrix-zelle" }, aufAenderung: (neu) => { sel.setze(stufeVon(k, v)); waehleStufe(k, v, neu); } });
        tr.append(h("td", { "data-vault": v.pfad }, sel));
      }
      koerper.append(tr);
    }
    tabelle.append(koerper);
    secZugriff.append(h("div", { klasse: "kk-matrix-rahmen" }, tabelle));
  }
  function legende() {
    return h("details", { klasse: "kk-legende", "data-kk": "legende", open: true }, h("summary", { text: TK.vault.legende }),
      h("dl", {}, STUFEN.flatMap((s) => [h("dt", { text: TK.stufen[s].name }), h("dd", { text: TK.stufen[s].text })])));
  }

  function zeichneEhrlich() {
    secEhrlich.replaceChildren();
    if (S.laedt || S.fehler || !S.daten || !konten().length) return;
    secEhrlich.append(h("div", { klasse: "kk-karte schmal", "data-kk": "ehrlich-karte" }, h("div", { klasse: "kk-block-titel", text: TK.ehrlich.titel }),
      h("ul", { klasse: "kk-punkte" }, [TK.ehrlich.kennung, TK.ehrlich.claude, TK.ehrlich.andere, TK.ehrlich.keine].map((t) => h("li", { text: t })))));
  }

  zeichneAlles();
  lade();
  return d;
}
