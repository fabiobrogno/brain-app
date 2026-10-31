// Die Seite „Einstellungen“ (Paket P5): ganzflächig über dem Studio, eigene Seitenleiste mit Gruppen (Kortex / Wissen / Verbindungen / Mehr), „Zurück zu Kortex“ (Esc),
// Suche (⌘F), jede Einstellung als Zeile mit Titel, Beschreibung und Stichwörtern (Register: texte-einstellungen.js). Es gibt keinen Speichern-Knopf: jede Änderung gilt sofort
// (Textfelder 700 ms nach der letzten Eingabe, beim Verlassen und beim Schließen). Die Werte kommen aus GET /api/einstellungen (Vault: brain.config.json wie `brain einstellungen`,
// App: einstellungen.json) und gehen mit dem `stand` zurück — hat inzwischen jemand anderes geändert (CLI, KI, zweites Fenster), lädt die Seite neu und sagt es.
// Aufbau und Verhalten nach Orca (Settings.tsx, SettingsSidebar.tsx, settings-search.ts, use-settings-page-effects.ts @9bccd67, MIT, Lovecast Inc.): Seite mit eigener Seitenleiste,
// Suche mit gewichteter Wertung, markierte und je Bereich gezählte Treffer, Sprungziel leuchtet kurz auf. Wird per dynamischem import() geladen und hat beim Import keine Nebenwirkungen.
import { h, dialog, dialogOffen, toast, vorMinuten } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import {
  knopf as baueKnopf, segment, umschalter, auswahl, textfeld, leerBlock, skelett, wenigBewegung,
  einstellZeile, einstellAbschnitt, einstellMarke, einstellChips, einstellRegler, einstellPfad,
} from "./bausteine.js";
import { oeffneMenue, menueOffen } from "./menue.js";
import { popoverOffen } from "./popover.js";
import { markenLogo } from "./marken.js";
import { BEREICHE, GRUPPEN, TE, STANDARD_VORSCHLAEGE } from "./texte-einstellungen.js";
import { suche as sucheIn, zerlege, vorschlaege } from "./einstellungen-suche.js";
import { erzeugeKi } from "./einstellungen-ki.js";
import { erzeugeTasten, tastenAbschnitte } from "./einstellungen-tasten.js";
import { TKZ } from "./texte-tasten.js";

export const BLINK_MS = 1600; // Sprungziel leuchtet kurz auf (Orca: 3000 ms; ruhiger)

// Zustand der einen offenen Seite
const Z = {
  offen: false, api: null, k: null, host: null, bereich: "allgemein", suche: "", ergebnis: null, daten: null,
  steuer: new Map(),        // Schlüssel → { setze(wert), offen(), sofort(), el }
  bereichKnoten: new Map(), // Bereichs-ID → <section>
  zeilen: new Map(),        // Zeilen-ID → Element
  wartend: {}, ki: null, tasten: null, kiBraucht: 0, laeuft: null, davor: null, zielTimer: 0, gespTimer: 0, dynamisch: new Map(), stilGeladen: null, taste: null, nachladenLaeuft: false, ladeNr: 0,
};
export const istOffen = () => Z.offen;

// ============================================================ Adresse: #einstellungen/<bereich>?ziel=<zeile>
export function leseHash(hash = location.hash) {
  const m = /^#einstellungen(?:\/([a-z-]+))?(?:\?(.*))?$/.exec(String(hash || ""));
  if (!m) return null;
  const bereich = BEREICHE.some((b) => b.id === m[1]) ? m[1] : null;
  const ziel = m[2] ? new URLSearchParams(m[2]).get("ziel") : null;
  return { bereich, ziel: ziel && /^[a-z0-9-]{1,60}$/.test(ziel) ? ziel : null };
}
const schreibeHash = (bereich, ziel) => { try { history.replaceState(null, "", `${location.pathname}${location.search}#einstellungen/${bereich}${ziel ? `?ziel=${ziel}` : ""}`); } catch { /* ohne Verlauf */ } };
const loescheHash = () => { try { if (leseHash()) history.replaceState(null, "", location.pathname + location.search); } catch { /* ohne Verlauf */ } };

// ============================================================ Stil
function ladeEineDatei(name) {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes(name))) return Promise.resolve();
  return new Promise((ok) => {
    const l = h("link", { rel: "stylesheet", href: new URL(name, import.meta.url).href });
    l.addEventListener("load", () => ok());
    l.addEventListener("error", () => ok());
    setTimeout(ok, 1500);
    document.head.append(l);
  });
}
function ladeStil() {
  if (Z.stilGeladen) return Z.stilGeladen;
  Z.stilGeladen = Promise.all([ladeEineDatei("einstellungen.css"), ladeEineDatei("einstellungen-ki.css"), ladeEineDatei("einstellungen-tasten.css")]).then(() => {});
  return Z.stilGeladen;
}

// ============================================================ Werte lesen und schreiben
const wertVon = (k) => Z.daten?.werte?.[k];
const quelleVon = (k) => Z.daten?.schema?.[k]?.quelle || null;
const vaultSperre = () => !Z.daten?.vault ? "keinVault" : (Z.daten.vault.vertraut ? null : "nurAnsehen");
const gesperrtFuer = (k) => quelleVon(k) === "vault" && vaultSperre() !== null;

async function lade() {
  const nr = ++Z.ladeNr;
  const d = await Z.api.einstellungen();
  if (nr !== Z.ladeNr) return Z.daten; // ein neuerer Abruf ist unterwegs
  Z.daten = d;
  return d;
}

// Zeigt „Speichert …“ / „Gespeichert“ oben rechts
function zeigeStand(art) {
  const g = Z.host?.querySelector("[data-stand]");
  if (!g) return;
  clearTimeout(Z.gespTimer);
  g.dataset.stand = art;
  if (art === "gespeichert") Z.gespTimer = setTimeout(() => { if (g.dataset.stand === "gespeichert") g.dataset.stand = ""; }, 1500);
}

// Änderung eines Werts: sofort in der Oberfläche, dann (gesammelt) an die Werkstatt
function aendere(schluessel, wert) {
  if (!Z.daten || gesperrtFuer(schluessel)) return;
  Z.daten.werte[schluessel] = wert === null ? Z.daten.schema[schluessel]?.standard : wert; // null = zurück auf den Standard
  Z.wartend[schluessel] = wert;
  if (quelleVon(schluessel) === "app") Z.k?.wendeAn?.(Z.daten.werte);
  speichere();
}
async function speichere() {
  if (Z.laeuft) return Z.laeuft;
  Z.laeuft = (async () => {
    try {
      while (Object.keys(Z.wartend).length) {
        const patch = Z.wartend; Z.wartend = {};
        zeigeStand("speichert");
        try {
          const r = await Z.api.einstellungenSchreiben(patch, Z.daten.stand);
          Z.daten = { ...Z.daten, ...r, werte: { ...r.werte, ...Z.wartend } };
          delete Z.daten.ok;
          Z.k?.wendeAn?.(Z.daten.werte);
          zeigeStand("gespeichert");
          if (!Object.keys(Z.wartend).length) aktualisiereSteuerungen();
        } catch (e) {
          Z.wartend = {};
          zeigeStand("");
          try { await lade(); } catch { /* unten */ }
          aktualisiereSteuerungen(true);
          Z.k?.wendeAn?.(Z.daten?.werte);
          const art = e?.daten?.art;
          if (e?.status === 409 && art === "konflikt") toast(TE.konflikt, { ms: 7000 });
          else if (e?.status === 409 && art === "nicht-vertraut") toast(TE.nichtVertraut, { fehler: true, ms: 6000 });
          else if (e?.status === 409 && e?.daten?.keinVault) toast(TE.keinVault, { fehler: true });
          else toast(e?.message || TE.fehlerSpeichern, { fehler: true, ms: 6000 });
        }
      }
    } finally { Z.laeuft = null; }
  })();
  return Z.laeuft;
}
const warteAufSpeichern = async () => { while (Z.laeuft) await Z.laeuft; };

// Änderungen von außen (CLI, KI, anderes Fenster): neu lesen und Steuerungen nachführen, ohne ein Feld zu stören, in dem gerade getippt wird
async function nachladen() {
  if (!Z.offen || Z.nachladenLaeuft || Z.laeuft || Object.keys(Z.wartend).length) return;
  Z.nachladenLaeuft = true;
  try {
    const alt = Z.daten?.stand;
    const d = await lade();
    if (d?.stand !== alt) { Z.k?.wendeAn?.(d.werte); aktualisiereSteuerungen(); }
  } catch { /* beim nächsten Ereignis wieder */ }
  finally { Z.nachladenLaeuft = false; }
}

// Alle Steuerungen auf die gelesenen Werte bringen; gesperrte (kein Vault / nur ansehen) deaktivieren; Hinweise zeigen
function aktualisiereSteuerungen(auchOffene = false) {
  for (const [k, s] of Z.steuer) {
    const w = wertVon(k);
    if (w !== undefined && (auchOffene || !s.offen?.())) s.setze(w);
    s.zeile?.classList.toggle("gesperrt", gesperrtFuer(k));
    if (s.zeile) s.zeile.querySelector(".ez-r")?.toggleAttribute("inert", gesperrtFuer(k));
  }
  for (const [id, knoten] of Z.bereichKnoten) aktualisiereHinweis(id, knoten);
  for (const f of Z.dynamisch.values()) { try { f(); } catch { /* eine Zeile darf die anderen nicht stoppen */ } }
}

// ============================================================ Zeilen aus dem Register
const hatVaultSchluessel = (b) => b.abschnitte.some((a) => a.zeilen.some((z) => z.schluessel && quelleVon(z.schluessel) === "vault"));
function hinweisText(b) {
  const sp = vaultSperre();
  const fehler = Z.daten?.fehler;
  if (hatVaultSchluessel(b) && sp === "keinVault") return TE.keinVaultHinweis;
  if (hatVaultSchluessel(b) && sp === "nurAnsehen") return TE.nurAnsehen;
  if (hatVaultSchluessel(b) && fehler?.vault) return fehler.vault;
  if (["darstellung", "mitteilungen"].includes(b.id) && fehler?.app) return fehler.app;
  return "";
}
function aktualisiereHinweis(id, knoten) {
  const b = BEREICHE.find((x) => x.id === id);
  const el = knoten.querySelector("[data-hinweis]");
  if (!b || !el) return;
  const t = hinweisText(b);
  el.hidden = !t;
  el.querySelector("span").textContent = t;
}

function regelSteuerung(schluessel, zeile, s) { Z.steuer.set(schluessel, { ...s, zeile }); if (gesperrtFuer(schluessel)) { zeile.classList.add("gesperrt"); zeile.querySelector(".ez-r")?.setAttribute("inert", ""); } }

function bauSchalter(z) {
  const k = z.schluessel;
  const s = umschalter({ an: !!wertVon(k), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (v) => aendere(k, v) });
  return { steuerung: s, reg: { setze: (w) => { s.an = !!w; } } };
}
function bauSegment(z) {
  const k = z.schluessel;
  const opt = z.optionen.map(([w, t]) => ({ wert: String(w), text: t }));
  const roh = new Map(z.optionen.map(([w]) => [String(w), w]));
  const s = segment({ optionen: opt, wert: String(wertVon(k)), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (w) => aendere(k, roh.get(w)) });
  return { steuerung: s, reg: { setze: (w) => { s.value = String(w); } } };
}
function bauZahl(z) {
  const k = z.schluessel;
  const wrap = h("span", { klasse: "ez-zahl" });
  const text = (n) => (n === 0 ? z.nullText : `${n} ${n === 1 && z.einheitEin ? z.einheitEin : z.einheit}`);
  let aktuell = null;
  const bau = (w) => {
    const stufen = [...new Set([...z.stufen, w])].sort((a, b) => a - b);
    aktuell = w;
    const a = auswahl({ optionen: stufen.map((n) => ({ wert: n, text: text(n) })), wert: w, label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (n) => { aktuell = n; aendere(k, n); } });
    wrap.replaceChildren(a);
  };
  bau(wertVon(k));
  return { steuerung: wrap, reg: { setze: (w) => { if (w !== aktuell) bau(w); } } };
}
function bauRegler(z) {
  const k = z.schluessel, sc = Z.daten.schema[k];
  const r = einstellRegler({ min: sc.min, max: sc.max, wert: wertVon(k), label: z.titel, textKlein: TE.schriftKlein, textGross: TE.schriftGross, daten: { "data-schluessel": k },
    aufEingabe: (n) => { Z.k?.wendeAn?.({ ...Z.daten.werte, [k]: n }); }, aufAenderung: (n) => aendere(k, n) });
  return { steuerung: r.el, reg: { setze: (w) => r.setze(w), offen: () => document.activeElement === r.input } };
}
// Prüfung eines Listeneintrags nach der Art des Schlüssels (wie im Kern: Ordner ≤ 300 Zeichen, Wörter ≤ 60, Werkzeugnamen nach Muster)
function pruefeEintrag(k) {
  return (text, liste) => {
    if (/[\u0000-\u001f\u007f]/.test(text)) return TE.eintragZeichen;
    if (liste.some((x) => x.toLowerCase() === text.toLowerCase())) return TE.eintragDoppelt;
    if (k === "ernteOhneThema" && text.length > 60) return TE.eintragLang;
    if (k === "ernteNichtIn" && text.length > 300) return TE.eintragLang;
    if (k === "mcpVertraut" && !/^[\w.:*-]{1,200}$/.test(text)) return TE.eintragZeichen;
    return "";
  };
}
function bauListe(z) {
  const k = z.schluessel;
  const max = k === "ernteOhneThema" ? 50 : 20;
  const c = einstellChips({ werte: wertVon(k) || [], label: z.titel, platzhalter: z.platzhalter, mono: !!z.mono, plusText: z.plusText, max, pruefe: pruefeEintrag(k),
    textEntfernen: TE.eintragEntfernen, textNeu: TE.eintragNeu, aufAenderung: (liste) => aendere(k, liste) });
  c.el.dataset.schluessel = k;
  return { steuerung: c.el, reg: { setze: (w) => c.setze(w || []), offen: () => !!c.el.querySelector(".ez-chip-feld input:focus") } };
}
// Pfad (typ „pfad“): Textfeld in fester Schrift, 700 ms nach der letzten Eingabe gespeichert; leer = zurück auf den Standard
function bauPfad(z) {
  const k = z.schluessel;
  const standard = Z.daten.schema[k]?.standard || "";
  const p = einstellPfad({ wert: wertVon(k) ?? standard, platzhalter: standard, label: z.titel, breite: 260,
    pruefe: (t) => (t.length > 300 ? TE.eintragLang : /[\u0000-\u001f\u007f]/.test(t) ? TE.eintragZeichen : ""),
    aufSpeichern: (t) => aendere(k, t === "" ? null : t) });
  p.input.dataset.schluessel = k;
  return { steuerung: p.el, reg: { setze: (w) => p.setze(w ?? standard), offen: () => p.offen() || document.activeElement === p.input, sofort: () => p.sofort() } };
}
const BAUER = { schalter: bauSchalter, segment: bauSegment, zahl: bauZahl, regler: bauRegler, liste: bauListe, pfad: bauPfad };

// ---------------------------------------------------------- Sonderzeilen (eigene Steuerung)
const kbdGruppe = (tasten) => h("span", { klasse: "ez-tasten", "aria-label": tasten.join(" ") }, tasten.map((t) => h("kbd", { text: t })));
const pillText = (text, ton) => einstellMarke(text, ton);
const knopfS = (o) => baueKnopf({ groesse: "s", ...o });

function themaKarten() {
  const lies = () => Z.k.theme.lies();
  const kachel = (wert, name, art) => {
    const b = h("button", { type: "button", klasse: "ez-thema", role: "radio", "aria-checked": String(lies() === wert), "data-thema": wert },
      h("span", { klasse: `ez-thema-bild ${art}`, "aria-hidden": "true" },
        h("span", { klasse: "s" }, h("i", { klasse: "a" }), h("i"), h("i"), h("i", { style: "width:70%" })),
        h("span", { klasse: "m" }, h("i", { style: "width:60%;height:7px" }), h("i"), h("i", { style: "width:80%" }), h("i", { style: "width:50%" }))),
      h("b", { text: name }), h("span", { klasse: "haken", "aria-hidden": "true" }, symbol("haken", GROESSE.klein)));
    b.addEventListener("click", () => { Z.k.theme.setze(wert); zeige(); });
    return b;
  };
  const kacheln = [kachel("system", TE.thema.system, "sys"), kachel("hell", TE.thema.hell, "hell"), kachel("dunkel", TE.thema.dunkel, "dunkel")];
  const el = h("div", { klasse: "ez-themen", role: "radiogroup", "aria-label": "Thema" }, kacheln);
  const zeige = () => kacheln.forEach((b) => b.setAttribute("aria-checked", String(lies() === b.dataset.thema)));
  el.addEventListener("keydown", (ev) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const i = kacheln.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const n = kacheln[(i + d + kacheln.length) % kacheln.length];
    n.click(); n.focus();
  });
  Z.dynamisch.set("thema", zeige);
  return el;
}

function vaultZeilen(host) {
  const farbeVon = (v) => (/^#[0-9a-fA-F]{6}$/.test(v.farbe || "") ? v.farbe : "var(--akzent)");
  const zeichne = (liste) => {
    host.replaceChildren(...liste.map((v) => {
      const mehr = baueKnopf({ symbol: "punkte", variante: "leise", groesse: "s", label: `${TE.vaultMehr}: ${v.name}`, daten: { "data-aktion": "vault-mehr" }, aufKlick: (ev) => {
        oeffneMenue(ev.currentTarget, [
          ...(v.aktiv ? [] : [{ name: TE.vaultWechseln, symbol: "ordner-offen", id: "vault-wechseln", tun: () => Z.k.vaultWechseln(v.pfad) }]),
          ...(v.aktiv && Z.k.inApp ? [{ name: TE.imFinder, symbol: "ordner", id: "vault-finder", tun: () => Z.k.zeigeVault() }] : []),
          { trenner: true },
          { name: TE.vaultAusKortex, symbol: "papierkorb", id: "vault-entfernen", gefahr: true, tun: () => Z.k.vaultEntfernen(v) },
        ], { rechts: true });
      } });
      return h("div", { klasse: "ez-vault", "data-vault": v.pfad },
        h("span", { klasse: "ez-vault-kachel", style: `background:${farbeVon(v)}`, "aria-hidden": "true", text: (v.name.trim()[0] || "V").toUpperCase() }),
        h("div", { klasse: "ez-vault-text" },
          h("b", {}, h("span", { text: v.name }), v.aktiv ? einstellMarke(TE.vaultOffen, "akzent") : null, !v.vorhanden ? einstellMarke(TE.vaultFehlt, "warn") : null),
          h("div", { klasse: "ez-vault-meta" }, h("span", { klasse: "mono", title: v.pfad, text: Z.k.kurzPfad(v.pfad) }), h("span", { text: v.git ? TE.vaultGit : TE.vaultKeinGit }))),
        h("div", { klasse: "ez-vault-akt" },
          v.aktiv && v.vorhanden && Z.k.inApp ? knopfS({ text: TE.imFinder, variante: "leise", aufKlick: () => Z.k.zeigeVault(), daten: { "data-aktion": "vault-finder" } }) : null,
          mehr));
    }));
  };
  const lade2 = async () => {
    try { const r = await Z.api.vaults(); zeichne(r?.vaults || []); }
    catch { host.replaceChildren(h("div", { klasse: "ez-leise", text: TE.fehlerLaden })); }
  };
  host.replaceChildren(skelett("ez-skelett", 56));
  lade2();
  return lade2;
}

function githubZeile(host) {
  const zeige = async () => {
    let k = null;
    try { k = await Z.api.githubKonto(); } catch { k = null; }
    if (!k || k.verfuegbar === false) { host.replaceChildren(h("div", { klasse: "ez-github" }, markenLogo("github", 20, { dekorativ: true }), h("div", { klasse: "ez-github-text" }, h("b", { text: "GitHub" }), h("span", { text: TE.githubNichtVerfuegbar })))); return; }
    if (k.angemeldet) {
      host.replaceChildren(h("div", { klasse: "ez-github", "data-zustand": "angemeldet" },
        h("span", { klasse: "ez-avatar", "aria-hidden": "true", text: (k.login || "G").slice(0, 2).toUpperCase() }),
        h("div", { klasse: "ez-github-text" }, h("b", {}, h("span", { text: k.login || "GitHub" }), einstellMarke(TE.githubAngemeldet, "ok")), h("span", { text: TE.githubAmGitHub === "" ? "" : "Zugriff nur auf Repositories, die Kortex selbst anlegt." })),
        knopfS({ text: TE.githubAbmelden, daten: { "data-aktion": "github-abmelden" }, aufKlick: abmelden })));
    } else {
      host.replaceChildren(h("div", { klasse: "ez-github", "data-zustand": "abgemeldet" }, markenLogo("github", 20, { dekorativ: true }),
        h("div", { klasse: "ez-github-text" }, h("b", {}, h("span", { text: "GitHub" }), einstellMarke(TE.githubNicht)), h("span", { text: "Für die Sicherung im Netz: privat und nur für dich sichtbar." })),
        knopfS({ text: TE.githubAnmelden, variante: "primaer", daten: { "data-aktion": "github-anmelden" }, aufKlick: () => Z.k.oeffneRemote() })));
    }
  };
  const abmelden = () => {
    const d = dialog({ titel: TE.githubAbmeldenTitel, satz: TE.githubAbmeldenText, knoepfe: [
      baueKnopf({ text: TE.reset.abbrechen, aufKlick: () => d.schliessen() }),
      baueKnopf({ text: TE.githubAbmelden, variante: "primaer", aktion: "github-abmelden-ja", aufKlick: async () => {
        try { await Z.api.githubAbmelden(); d.schliessen(); toast(TE.githubAbgemeldet); zeige(); } catch (e) { d.schliessen(); toast(e.message, { fehler: true }); }
      } })] });
  };
  host.replaceChildren(skelett("ez-skelett", 52));
  zeige();
  return zeige;
}

function sicherungVault(host) {
  const zeige = async () => {
    let g = Z.k.git();
    try { g = await Z.api.status(); } catch (e) { g = e?.daten?.gitGesperrt ? { repo: true, gesperrt: true } : g; }
    const zeile = (titel, text, marke, aktion) => host.replaceChildren(h("div", { klasse: "ez-sicherung", "data-zustand": titel.zustand }, h("div", { klasse: "ez-github-text" }, h("b", {}, h("span", { text: titel.text }), marke), h("span", { text })), aktion));
    if (!Z.daten?.vault) return zeile({ text: TE.keinVaultOffen, zustand: "keinVault" }, TE.keinVaultHinweis, null, null);
    if (!g) return zeile({ text: TE.sichBlockiert, zustand: "blockiert" }, TE.fehlerLaden, einstellMarke("?", "warn"), knopfS({ text: TE.nochmal, aufKlick: zeige }));
    if (g.gesperrt) return zeile({ text: TE.sichBlockiert, zustand: "blockiert" }, TE.gitGesperrt, einstellMarke(TE.vertrauenAus, "warn"), null);
    if (!g.repo) return zeile({ text: TE.sichNurMac, zustand: "ohne-git" }, TE.gitOhne, null, null);
    if (g.remote && g.upstream) {
      const spaet = g.letzterSync ? ` · zuletzt abgeglichen ${vorMinuten(g.letzterSync)}` : "";
      const stand = g.vor > 0 ? einstellMarke(TE.sichZuSenden(g.vor), "warn") : g.zurueck > 0 ? einstellMarke(TE.sichZuHolen(g.zurueck), "warn") : einstellMarke(TE.sichAktuell, "ok");
      return zeile({ text: TE.sichGesichert, zustand: "gesichert" }, `${g.upstream}${spaet}`, stand, knopfS({ text: TE.sichJetzt, daten: { "data-aktion": "sync" }, aufKlick: () => { Z.k.sync(); } }));
    }
    if (g.remote) return zeile({ text: TE.sichBereit, zustand: "bereit" }, "Der Vault ist mit einem Server verbunden, aber es wurde noch nichts gesendet.", null, knopfS({ text: TE.sichJetzt, daten: { "data-aktion": "sync" }, aufKlick: () => { Z.k.sync(); } }));
    return zeile({ text: TE.sichNurMac, zustand: "nur-mac" }, "Dieser Vault liegt nur auf deinem Mac. Mit einer Sicherung bei GitHub liegt zusätzlich eine Kopie im Netz.", null,
      knopfS({ text: TE.sichEinrichten, variante: "primaer", daten: { "data-aktion": "sicherung-einrichten" }, aufKlick: () => Z.k.oeffneRemote() }));
  };
  host.replaceChildren(skelett("ez-skelett", 52));
  zeige();
  return zeige;
}

function vertrauenZeile(host) {
  const zeige = () => {
    const v = Z.k.info()?.vertrauen;
    if (!Z.k.info()?.vault || !v) { host.replaceChildren(h("span", { klasse: "ez-leise", text: TE.keinVaultOffen })); return; }
    host.replaceChildren(
      einstellMarke(v.erlaubt ? TE.vertrauenAn : TE.vertrauenAus, v.erlaubt ? "ok" : "warn"),
      v.erlaubt ? knopfS({ text: TE.vertrauenEntziehen, daten: { "data-aktion": "vertrauen-entziehen" }, aufKlick: () => Z.k.vertrauen.entziehen() })
        : knopfS({ text: TE.vertrauenGeben, variante: "primaer", daten: { "data-aktion": "vertrauen-geben" }, aufKlick: () => Z.k.vertrauen.erlauben() }));
  };
  zeige();
  return zeige;
}

function zuruecksetzenDialog() {
  const sp = vaultSperre();
  const d = dialog({ titel: TE.reset.titel, satz: sp ? TE.reset.textNurApp : TE.reset.text, knoepfe: [
    baueKnopf({ text: TE.reset.abbrechen, aufKlick: () => d.schliessen() }),
    baueKnopf({ text: TE.reset.ja, variante: "gefahr", aktion: "reset-ja", aufKlick: async () => {
      const werte = {};
      for (const [k, s] of Object.entries(Z.daten.schema)) if (s.quelle === "app" || !sp) werte[k] = null;
      d.schliessen();
      try {
        const r = await Z.api.einstellungenSchreiben(werte, Z.daten.stand);
        Z.daten = { ...Z.daten, ...r }; delete Z.daten.ok;
        Z.k?.wendeAn?.(Z.daten.werte);
        aktualisiereSteuerungen(true);
        toast(TE.reset.erledigt);
      } catch (e) {
        try { await lade(); aktualisiereSteuerungen(true); } catch { /* egal */ }
        toast(e?.status === 409 && e?.daten?.art === "konflikt" ? TE.konflikt : (e?.message || TE.fehlerSpeichern), { fehler: true, ms: 6000 });
      }
    } })] });
}

// Zeilen mit eigener Steuerung: id → ({ z, zeile }) → Steuerung (Knoten) oder { steuerung, unten, voll }
const SONDER = {
  "version-info": () => ({ steuerung: null, titel: `Kortex ${Z.k.version() || TE.versionDev}` }),
  thema: () => ({ voll: themaKarten() }),
  breit: () => {
    const s = umschalter({ an: !!Z.k.breit.lies(), label: TE.seite, daten: { "data-einst": "breit" }, aufAenderung: (v) => Z.k.breit.setze(v) });
    Z.dynamisch.set("breit", () => { s.an = !!Z.k.breit.lies(); });
    return { steuerung: s };
  },
  "vaults-liste": () => { const host = h("div", { klasse: "ez-vaults", "data-vaults": "liste" }); Z.dynamisch.set("vaults", vaultZeilen(host)); return { voll: host }; },
  vertrauen: () => { const host = h("div", { klasse: "ez-inline" }); Z.dynamisch.set("vertrauen", vertrauenZeile(host)); return { steuerung: host }; },
  // KI & Konten (Paket P6): einstellungen-ki.js baut die Inhalte, hier hängen sie als Zeilen im Register (Suche, Sprungziele)
  "ki-uebersicht": () => ({ voll: Z.ki.host("uebersicht") }),
  "ki-konten": () => ({ voll: Z.ki.host("konten") }),
  "ki-zugriff": () => ({ voll: Z.ki.host("zugriff") }),
  "ki-schutz": () => ({ voll: Z.ki.host("schutz") }),
  "ki-frage-konto": () => ({ steuerung: Z.ki.host("frage-konto") }),
  "ki-frage-modell": () => ({ steuerung: Z.ki.host("frage-modell") }),
  "ki-pflege": () => ({ voll: Z.ki.host("pflege") }),
  "ki-hooks": () => ({ steuerung: Z.ki.host("arbeit-hooks"), unten: Z.ki.host("arbeit-hooks-unten") }),
  "ki-git": () => ({ steuerung: Z.ki.host("arbeit-git"), unten: Z.ki.host("arbeit-git-unten") }),
  "ki-dienst": () => ({ steuerung: Z.ki.host("arbeit-dienst"), unten: Z.ki.host("arbeit-dienst-unten") }),
  "ki-aktivitaet": () => ({ voll: Z.ki.host("aktivitaet") }),
  "ki-ehrlich": () => ({ voll: Z.ki.host("ehrlich") }),
  "github-konto": () => { const host = h("div", { klasse: "ez-voll-innen", "data-github": "" }); Z.dynamisch.set("github", githubZeile(host)); return { voll: host }; },
  "sicherung-vault": () => { const host = h("div", { klasse: "ez-voll-innen", "data-sicherung": "" }); Z.dynamisch.set("sicherung", sicherungVault(host)); return { voll: host }; },
  "git-technik": () => {
    const host = h("span", { klasse: "ez-inline" });
    const f = () => {
      const g = Z.k.git();
      host.replaceChildren(einstellMarke(g?.repo && !g?.gesperrt ? TE.gitAn : TE.gitAus, g?.repo && !g?.gesperrt ? "ok" : ""));
      zeileText("git-technik", g?.gesperrt ? TE.gitGesperrt : g?.repo ? TE.gitMit(g.zweig || "main") : TE.gitOhne);
    };
    Z.dynamisch.set("git", f); f();
    return { steuerung: host };
  },
  "mobil-bald": () => ({ voll: h("div", { klasse: "ez-bald" }, h("span", { klasse: "ez-bald-zeichen" }, symbol("handy", GROESSE.kachel)), h("b", { text: TE.mobilBald }), einstellMarke(TE.bald, "akzent")) }),
  "ds-nutzungsdaten": (z) => ({ marke: pillText(z.badge) }),
  "ds-absturz": (z) => ({ marke: pillText(z.badge) }),
  "ds-wege": () => ({ steuerung: null }),
  "ds-geheimnisse": (z) => ({ steuerung: pillText(z.badge, "ok") }),
  "ds-themen": () => ({ steuerung: knopfS({ text: TE.zuDenVaults, daten: { "data-aktion": "zu-vaults" }, aufKlick: () => navigiere("vaults", "ernte-ohne-thema") }) }),
  "ds-zugriff": () => ({ steuerung: knopfS({ text: TE.zuKonten, daten: { "data-aktion": "zu-ki" }, aufKlick: () => navigiere("ki", "ki-zugriff") }) }),
  "mcp-verbinden": () => ({ steuerung: knopfS({ text: TE.kiVerbinden, daten: { "data-aktion": "mcp-verbinden" }, aufKlick: () => Z.k.oeffneKi() }) }),
  "datei-vault": () => ({ steuerung: Z.k.inApp && Z.daten?.vault ? knopfS({ text: TE.imFinderZeigen, variante: "leise", daten: { "data-aktion": "datei-vault" }, aufKlick: () => Z.k.aktion("ordner-zeigen", "brain.config.json") }) : null }),
  "datei-app": () => ({ steuerung: einstellMarke("einstellungen.json") }),
  zuruecksetzen: () => ({ steuerung: knopfS({ text: TE.reset.knopf, variante: "gefahr", daten: { "data-aktion": "zuruecksetzen" }, aufKlick: zuruecksetzenDialog }) }),
  "ueber-app": () => ({ voll: ueberKarte() }),
};
function ueberKarte() {
  return h("div", { klasse: "ez-ueber" },
    h("span", { klasse: "ez-ueber-icon", "aria-hidden": "true" }, symbol("marke", 56)),
    h("div", { klasse: "ez-ueber-text" }, h("h3", { text: "Kortex" }), h("p", { "data-feld": "version", text: `Version ${Z.k.version() || TE.versionDev} · ${TE.macosHinweis}` }), h("p", { text: "Dein Wissen als Ordner. Deine KI mit deinem Abo." })));
}
function zeileText(id, text) { const e = Z.zeilen.get(id); if (e?.textEl) { e.textEl.textContent = text; e.originalText = text; } }

function bauZeile(b, a, z) {
  let steuerung = null, reg = null, voll = null, unten = null, marke = z.experiment ? einstellMarke(TE.experiment) : null, titel = z.titel;
  if (z.sonder) {
    if (z.kuerzelId) { const r = Z.tasten.zeile(z); steuerung = r.steuerung; marke = r.marke; } // Tastenkürzel (P10): einstellungen-tasten.js
    else if (z.taste) steuerung = kbdGruppe(z.taste);
    else {
      const r = SONDER[z.id]?.(z) || {};
      steuerung = r.steuerung || null; voll = r.voll || null; unten = r.unten || null; marke = r.marke || marke; titel = r.titel || titel;
      if (z.badge && z.id.startsWith("lizenz-")) steuerung = pillText(z.badge);
    }
  } else if (BAUER[z.art]) {
    const r = BAUER[z.art](z);
    steuerung = r.steuerung; reg = r.reg;
  }
  const zeile = einstellZeile({ id: z.id, titel, text: z.text, steuerung: voll ? null : steuerung, unten, marke, hoch: z.art === "liste" || z.art === "regler", klasse: voll ? "ez-voll ez-ohne-kopf" : "" });
  if (z.id.startsWith("lizenz-")) zeile.classList.add("ez-lizenz");
  if (voll) zeile.append(voll);
  zeile.originalTitel = titel;
  if (titel !== z.titel) zeile.titelEl.textContent = titel;
  if (reg) regelSteuerung(z.schluessel, zeile, reg);
  if (z.kuerzelId) Z.tasten.nachbau(z, zeile);
  Z.zeilen.set(z.id, zeile);
  return zeile;
}

function bauAbschnittRechts(b, a) {
  if (b.id === "ki" && a.id === "konten") return Z.ki.kopfKnoepfe();
  if (b.id === "vaults" && a.id === "liste") return knopfS({ text: TE.vaultHinzu, symbol: "plus", daten: { "data-aktion": "vault-hinzufuegen" }, aufKlick: () => Z.k.vaultOeffnen() });
  if (b.id === "ueber" && a.id === "lizenzen") return knopfS({ text: TE.alleHinweise, variante: "leise", daten: { "data-aktion": "lizenzen" }, aufKlick: () => Z.k.oeffneLizenzen() });
  return null;
}

function bauBereich(b) {
  const sec = h("section", { klasse: "e-bereich", "data-bereich": b.id },
    h("div", { klasse: "e-bereich-titel" }, symbol(b.symbol, GROESSE.text), h("span", { text: b.name })),
    b.intro ? h("p", { klasse: "e-intro", text: b.intro }) : null,
    b.id === "tasten" ? Z.tasten.leiste() : null, // Suche, Filter, „Alle zurücksetzen“
    h("div", { klasse: "ez-hinweis", "data-hinweis": "", role: "status", hidden: true }, symbol("info", GROESSE.text), h("span")));
  for (const a of b.abschnitte) {
    const titel = b.id === "vaults" && a.id === "dieser" ? TE.vaultFuer(Z.daten?.vault?.name || "…") : a.titel;
    const zeilen = a.zeilen.map((z) => bauZeile(b, a, z));
    const abschnitt = einstellAbschnitt({ id: `${b.id}-${a.id}`, titel, text: a.text, rechts: bauAbschnittRechts(b, a), zeilen });
    abschnitt.dataset.abschnittOrig = a.id;
    sec.append(abschnitt);
  }
  Z.bereichKnoten.set(b.id, sec);
  aktualisiereHinweis(b.id, sec);
  if (b.id === "tasten") Z.tasten.zeichneAlle();
  return sec;
}
const holeBereich = (b) => Z.bereichKnoten.get(b.id) || bauBereich(b);

// ============================================================ Gerüst, Seitenleiste, Suche
function baueGeruest() {
  const such = textfeld({ typ: "search", platzhalter: TE.suchen, label: TE.suchenLabel, groesse: "m", daten: { "data-einst": "suche", "aria-keyshortcuts": "Meta+F" } });
  such.feld.append(h("span", { klasse: "e-suche-tasten", "aria-hidden": "true" }, h("kbd", { text: "⌘" }), h("kbd", { text: "F" })));
  such.input.addEventListener("input", () => { Z.suche = such.input.value; such.feld.classList.toggle("hat-text", !!Z.suche); zeichneInhalt(); });
  such.input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); if (such.input.value) { such.input.value = ""; such.input.dispatchEvent(new Event("input", { bubbles: true })); } else schliesse(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); ersteSteuerung(); }
  });
  const zurueck = h("button", { type: "button", klasse: "e-zurueck", title: TE.zurueckTitel, "data-aktion": "einst-zurueck", aufClick: () => schliesse() },
    symbol("pfeil-links", GROESSE.text), h("span", { text: TE.zurueck }), h("kbd", { text: "esc" }));
  const liste = h("nav", { klasse: "e-liste", "aria-label": TE.seitenleiste });
  liste.addEventListener("click", (ev) => { const b = ev.target.closest("[data-bereich]"); if (b) waehleBereich(b.dataset.bereich); });
  liste.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const alle = [...liste.querySelectorAll("button[data-bereich]")];
    const i = alle.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    alle[(i + (ev.key === "ArrowDown" ? 1 : alle.length - 1)) % alle.length].focus();
  });
  const nav = h("aside", { klasse: "e-nav" }, zurueck, h("div", { klasse: "e-suche" }, such.el), liste,
    h("div", { klasse: "e-fuss" }, symbol("info", GROESSE.klein), h("span", { text: TE.fuss })));
  const kopf = h("header", { klasse: "e-kopf" }, h("h1", { "data-einst": "titel" }), h("span", { klasse: "wo", "data-einst": "treffer", "aria-live": "polite" }),
    h("span", { klasse: "e-stand", "data-stand": "", role: "status" }, h("span", { klasse: "an-speichert" }, h("span", { klasse: "ez-dreh", "aria-hidden": "true" }), TE.speichertGerade), h("span", { klasse: "an-gespeichert" }, symbol("haken", GROESSE.klein), TE.gespeichert)));
  const bereiche = h("div", { klasse: "e-bereiche", "data-einst": "bereiche" });
  const inhalt = h("main", { klasse: "e-inhalt", tabindex: "-1", "data-einst": "inhalt" }, h("div", { klasse: "e-blatt" }, kopf, bereiche));
  inhalt.addEventListener("scroll", () => inhalt.classList.toggle("gerollt", inhalt.scrollTop > 4), { passive: true });
  const status = h("footer", { klasse: "e-status" },
    h("span", { klasse: "e-status-punkt", "aria-hidden": "true" }), h("span", { text: TE.statusDatei }), h("span", { klasse: "e-status-dateien mono", "data-einst": "dateien" }),
    h("span", { klasse: "e-status-version", text: `Kortex ${Z.k.version() || TE.versionDev}` }));
  const wurzel = h("div", { klasse: "einst", role: "dialog", "aria-modal": "true", "aria-label": TE.seite, "data-einstellungen": "" }, nav, inhalt, status);
  Z.suchfeld = such;
  return wurzel;
}

function renderNav(treffer) {
  const liste = Z.host.querySelector(".e-liste");
  const aktiv = document.activeElement?.closest?.(".e-liste") ? document.activeElement.dataset?.bereich : null;
  let html = [];
  for (const g of GRUPPEN) {
    const bs = BEREICHE.filter((b) => b.gruppe === g);
    if (!bs.length) continue;
    html.push(h("div", { klasse: "e-gruppe", text: g }));
    for (const b of bs) {
      const n = treffer ? (treffer.find((x) => x.id === b.id)?.treffer || 0) : null;
      html.push(h("button", { type: "button", klasse: `e-punkt${treffer && !n ? " aus" : ""}`, "data-bereich": b.id, "aria-current": String(!treffer && Z.bereich === b.id) },
        symbol(b.symbol, GROESSE.norm), h("span", { klasse: "t", text: b.name }),
        b.id === "ki" && Z.kiBraucht > 0 ? h("span", { klasse: "e-braucht", "aria-label": TE.braucht, title: TE.braucht }) : null,
        treffer ? (n ? h("span", { klasse: "treffer", "aria-label": TE.trefferJeBereich(n), text: String(n) }) : null) : (b.bald ? h("span", { klasse: "e-bald", text: TE.bald }) : null)));
    }
  }
  liste.replaceChildren(...html);
  if (aktiv) liste.querySelector(`[data-bereich="${aktiv}"]`)?.focus({ preventScroll: true });
}

function setzeMarkierung(zeile, vor) {
  const stuecke = (text) => (vor ? zerlege(text, vor).map((t) => (t.treffer ? h("mark", { text: t.text }) : t.text)) : [text]);
  zeile.titelEl?.replaceChildren(...stuecke(zeile.originalTitel));
  zeile.textEl?.replaceChildren(...stuecke(zeile.originalText));
}

// Inhalt je nach Suchtext: ein Bereich oder die Trefferliste aller Bereiche
function zeichneInhalt({ scrollNachOben = true } = {}) {
  const wurzel = Z.host.querySelector("[data-einst=bereiche]");
  const kopfTitel = Z.host.querySelector("[data-einst=titel]"), kopfWo = Z.host.querySelector("[data-einst=treffer]");
  const inhalt = Z.host.querySelector("[data-einst=inhalt]");
  const q = Z.suche.trim();
  Z.host.classList.toggle("suchmodus", !!q);
  wurzel.querySelector(".e-leer")?.remove();
  if (!q) {
    Z.ergebnis = null;
    const b = BEREICHE.find((x) => x.id === Z.bereich) || BEREICHE[0];
    for (const z of Z.zeilen.values()) setzeMarkierung(z, null);
    for (const sec of Z.bereichKnoten.values()) { sec.hidden = false; for (const e of sec.querySelectorAll("[data-zeile], .ez-abschnitt")) e.hidden = false; }
    wurzel.replaceChildren(holeBereich(b));
    aktualisiereHinweis(b.id, Z.bereichKnoten.get(b.id));
    kopfTitel.textContent = b.name; kopfWo.textContent = "";
    renderNav(null);
  } else {
    const r = sucheIn(q, BEREICHE);
    Z.ergebnis = r;
    kopfTitel.textContent = TE.suche;
    if (!r.gesamt) {
      kopfWo.textContent = "";
      const vs = vorschlaege(q, BEREICHE, STANDARD_VORSCHLAEGE);
      wurzel.replaceChildren(h("div", { klasse: "e-leer", "data-einst": "leer" },
        h("span", { klasse: "e-leer-zeichen" }, symbol("suche", GROESSE.kachel)),
        h("b", { text: TE.keine(q) }),
        h("p", {}, TE.keineText, " ", h("kbd", { text: "⌘" }), h("kbd", { text: "K" }), " ", TE.keineText2),
        h("div", { klasse: "e-vorschlaege", role: "group", "aria-label": TE.vielleicht }, vs.map((w) => h("button", { type: "button", "data-vorschlag": w, aufClick: () => setzeSuche(w) }, w)))));
    } else {
      kopfWo.textContent = TE.treffer(r.gesamt, r.vor.roh);
      const knoten = [];
      for (const br of r.bereiche) {
        const b = BEREICHE.find((x) => x.id === br.id);
        const sec = holeBereich(b);
        sec.hidden = false;
        for (const a of sec.querySelectorAll(".ez-abschnitt")) {
          let n = 0;
          for (const zeile of a.querySelectorAll("[data-zeile]")) {
            const ok = br.zeilen.has(zeile.dataset.zeile);
            zeile.hidden = !ok;
            if (ok) { n++; setzeMarkierung(zeile, r.vor); } else setzeMarkierung(zeile, null);
          }
          a.hidden = n === 0;
        }
        sec.querySelector("[data-hinweis]")?.toggleAttribute("hidden", true);
        knoten.push(sec);
      }
      wurzel.replaceChildren(...knoten);
    }
    renderNav(r.bereiche);
  }
  if (scrollNachOben) inhalt.scrollTop = 0;
  // Fußzeile: wo die Werte dieser Seite liegen (Tastenkürzel: eigene Datei)
  Z.host.querySelector("[data-einst=dateien]").textContent = (!q && Z.bereich === "tasten" ? [TKZ.datei] : [Z.daten?.dateien?.vault, Z.daten?.dateien?.app]).filter(Boolean).join(" · ");
}
function setzeSuche(text) { const i = Z.suchfeld.input; i.value = text; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); }

function waehleBereich(id) {
  if (Z.suche.trim()) { // In der Trefferliste springt ein Klick zum Bereich (statt die Suche zu verlassen)
    const sec = Z.bereichKnoten.get(id);
    if (sec && !sec.hidden) sec.scrollIntoView({ block: "start", behavior: wenigBewegung() ? "auto" : "smooth" });
    return;
  }
  Z.bereich = id;
  schreibeHash(id);
  zeichneInhalt();
}
// Von einer Zeile zu einer anderen (Datenschutz → Vaults): Suche leeren, Bereich wählen, Zeile aufleuchten lassen
function navigiere(bereich, ziel) {
  if (Z.suche) { Z.suchfeld.input.value = ""; Z.suchfeld.feld.classList.remove("hat-text"); Z.suche = ""; }
  Z.bereich = bereich;
  schreibeHash(bereich, ziel);
  zeichneInhalt({ scrollNachOben: !ziel });
  if (ziel) springeZu(ziel);
}
// Sprungziel: Zeile in die Mitte holen und kurz aufleuchten lassen
function springeZu(id) {
  const zeile = Z.zeilen.get(id);
  if (!zeile || !zeile.isConnected) return false;
  clearTimeout(Z.zielTimer);
  for (const e of Z.host.querySelectorAll(".ez.blink")) e.classList.remove("blink");
  zeile.scrollIntoView({ block: "center", behavior: wenigBewegung() ? "auto" : "smooth" });
  void zeile.offsetWidth;
  zeile.classList.add("blink");
  Z.zielTimer = setTimeout(() => zeile.classList.remove("blink"), BLINK_MS);
  return true;
}
function ersteSteuerung() {
  const wurzel = Z.host.querySelector("[data-einst=bereiche]");
  const f = [...wurzel.querySelectorAll("button:not(:disabled), input:not(:disabled), [tabindex='0']")].find((e) => e.offsetParent !== null && !e.closest("[hidden]") && !e.closest("[inert]"));
  (f || Z.host.querySelector(".e-punkt[aria-current=true]") || Z.host.querySelector(".e-punkt"))?.focus();
}

// ============================================================ Öffnen und Schließen
function beiTaste(ev) {
  if (!Z.offen || ev.defaultPrevented) return;
  const meta = ev.metaKey || ev.ctrlKey;
  if (meta && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "f") { ev.preventDefault(); Z.suchfeld.input.focus(); Z.suchfeld.input.select(); return; }
  if (ev.key === "Escape" && !dialogOffen() && !menueOffen() && !popoverOffen()) { ev.preventDefault(); schliesse(); }
}

export async function oeffneEinstellungen({ api, kontext, bereich = null, ziel = null } = {}) {
  if (Z.offen) { if (bereich || ziel) navigiere(bereich || Z.bereich, ziel); return true; }
  Z.api = api; Z.k = kontext; Z.offen = true; Z.davor = document.activeElement;
  Z.steuer.clear(); Z.bereichKnoten.clear(); Z.zeilen.clear(); Z.dynamisch.clear(); Z.wartend = {}; Z.suche = "";
  Z.bereich = bereich && BEREICHE.some((b) => b.id === bereich) ? bereich : (Z.bereich || "allgemein");
  await ladeStil();
  let host = document.getElementById("einstellungen-host");
  if (!host) { host = h("div", { id: "einstellungen-host" }); document.body.append(host); }
  Z.host = host;
  host.hidden = false;
  host.replaceChildren(h("div", { klasse: "einst-laedt", role: "status" }, h("span", { klasse: "ez-dreh", "aria-hidden": "true" }), h("span", { text: TE.laedt })));
  document.getElementById("app")?.setAttribute("inert", "");
  Z.taste = beiTaste;
  document.addEventListener("keydown", Z.taste);
  window.addEventListener("kortex-einstellungen", nachladen);
  try { await lade(); }
  catch {
    if (!Z.offen) return false;
    host.replaceChildren(h("div", { klasse: "einst-laedt" }, leerBlock({ symbol: "warnung", titel: TE.fehlerLaden, aktion: { text: TE.nochmal, tun: () => { schliesse({ fokus: false }); oeffneEinstellungen({ api, kontext, bereich, ziel }); } } }),
      baueKnopf({ text: TE.zurueck, variante: "leise", aufKlick: () => schliesse() })));
    return false;
  }
  if (!Z.offen) return false;
  Z.kiBraucht = 0;
  const bt = BEREICHE.find((b) => b.id === "tasten");
  if (bt && !bt.abschnitte.length) bt.abschnitte = tastenAbschnitte(); // eine Zeile je Befehl aus dem Register (tastenkuerzel-register.js), damit auch die Suche der Seite sie findet
  Z.tasten = erzeugeTasten({ inApp: Z.k.inApp, beiSpeichern: zeigeStand });
  Z.ki = erzeugeKi({ api, k: kontext, beiBraucht: (n) => { if (n === Z.kiBraucht) return; Z.kiBraucht = n; if (Z.host?.querySelector(".e-liste")) renderNav(Z.ergebnis ? Z.ergebnis.bereiche : null); } });
  host.replaceChildren(baueGeruest());
  zeichneInhalt();
  Z.ki.start();
  aktualisiereSteuerungen();
  schreibeHash(Z.bereich, ziel);
  requestAnimationFrame(() => { if (ziel) springeZu(ziel); });
  (Z.host.querySelector(".e-punkt[aria-current=true]") || Z.host.querySelector("[data-einst=inhalt]"))?.focus({ preventScroll: true });
  return true;
}

export async function schliesse({ fokus = true } = {}) {
  if (!Z.offen) return;
  for (const s of Z.steuer.values()) { try { s.sofort?.(); } catch { /* egal */ } }
  Z.offen = false;
  Z.ki?.ende(); Z.ki = null;
  Z.tasten?.ende(); Z.tasten = null;
  document.removeEventListener("keydown", Z.taste);
  window.removeEventListener("kortex-einstellungen", nachladen);
  clearTimeout(Z.zielTimer); clearTimeout(Z.gespTimer);
  loescheHash();
  document.getElementById("app")?.removeAttribute("inert");
  if (Z.host) { Z.host.hidden = true; Z.host.replaceChildren(); }
  Z.steuer.clear(); Z.bereichKnoten.clear(); Z.zeilen.clear(); Z.dynamisch.clear();
  const davor = Z.davor; Z.davor = null;
  if (fokus && davor && document.contains(davor)) davor.focus?.({ preventScroll: true });
  Z.k?.beiZu?.();
  await warteAufSpeichern();
}

// Vor dem Beenden der App: wartende Eingaben und laufendes Speichern abschließen
export async function flushe() {
  for (const s of Z.steuer.values()) { try { s.sofort?.(); } catch { /* egal */ } }
  await warteAufSpeichern();
}
