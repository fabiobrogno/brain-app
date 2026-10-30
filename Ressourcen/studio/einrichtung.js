// Einrichtungs-Assistent „Kortex einrichten“ (ein Fenster, vier Schritte, rechts die Bühne). Ersetzt den SwiftUI-Assistenten und die Willkommenskarte beim ersten Start.
// Alles Echte läuft über die vorhandene API (Vault anlegen/öffnen/klonen, GitHub-Gerätecode, Sicherung, KI-Konten, Probe); die App (Swift) liefert nur, was das System
// braucht: git prüfen/installieren, Ordner wählen, Browser öffnen, Zwischenablage, Fenster schließen. Dem Prototyp (wizard.html) nachgebaut; Muster aus Orca (siehe einrichtung.css).
// Aufruf: einrichtung.html[?ab=vault|sicherung|ki] — mit ab beginnt der Assistent beim Schritt für einen schon vorhandenen Vault (Menü „Kortex einrichten …“).
import { h, dialog, toast, leseLokal } from "./hilfen.js";
import { api, aktion, aktionMitAntwort, inApp, ausgangUnklar } from "./api.js";
import { knopf as baueKnopf, textfeld, umschalter, wenigBewegung } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { markenLogo } from "./marken.js";
import { TE } from "./texte-einrichtung.js";
import { erzeugeBuehne, markeSvg, windungFortschritt } from "./einrichtung-buehne.js";
import { erzeugeKi } from "./einrichtung-ki.js";

const $ = (s, r = document) => r.querySelector(s);
const win = $("#win"), panes = $("#panes"), stepperEl = $("#stepper"), fussEl = $("#fuss"), buehneEl = $("#buehne");
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ruhig = () => wenigBewegung();

// ---------------------------------------------------------------- Hilfen
const kurzPfad = (p) => (p ? String(p).replace(/^\/Users\/[^/]+(?=\/|$)/, "~") : "");
const letzter = (p) => String(p || "").replace(/\/+$/, "").split("/").pop() || "";
const meldungVon = (e) => {
  if (ausgangUnklar(e)) return typeof e?.message === "string" && e.status === 504 ? e.message : TE.verbindungWeg;
  if ([404, 405, 501].includes(e?.status) && (!e?.message || /^(nicht gefunden|das hat nicht geklappt)\.?$/i.test(String(e.message).trim()))) return TE.nichtDa;
  const m = typeof e?.message === "string" ? e.message.trim() : "";
  return m || TE.vault.fehlerStandard;
};

// Ordnername aus dem Namen des Vaults (wie VaultAuswahl.ordnername in Swift): ohne „/“, „:“ und Steuerzeichen, nicht versteckt, höchstens 80 Zeichen; leer → „Kortex“.
function ordnername(name) {
  let t = [...String(name)].map((c) => (c.codePointAt(0) < 32 || c === "/" || c === ":" ? "-" : c)).join("").trim();
  while (t.startsWith(".")) t = t.slice(1);
  t = t.slice(0, 80).trim();
  return t || "Kortex";
}
// Vorschlag für den Repository-Namen (wie RepoName.vorschlag in Swift): klein, Umlaute ausgeschrieben, Unerlaubtes wird „-“.
function repoVorschlag(name) {
  let s = String(name).toLowerCase();
  for (const [von, nach] of [["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"]]) s = s.split(von).join(nach);
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let aus = "";
  for (const z of s) {
    const ok = /[a-z0-9._-]/.test(z);
    const c = ok ? z : "-";
    if (c === "-" && aus.endsWith("-")) continue;
    aus += c;
  }
  aus = aus.replace(/^[-.]+|[-.]+$/g, "");
  if (aus.endsWith(".git")) aus = aus.slice(0, -4).replace(/^[-.]+|[-.]+$/g, "");
  if (aus.length > 100) aus = aus.slice(0, 100).replace(/[-.]+$/g, "");
  return aus && !aus.endsWith(".git") ? aus : "brain";
}
function repoNameFehler(name) {
  if (!name) return TE.sicherung.repoName.leer;
  if (name.length > 100 || !/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === ".." || /\.git$/i.test(name)) return TE.sicherung.repoName.ungueltig;
  return null;
}
// Adresse zum Klonen: „github.com/name/vault“ (mit oder ohne https://) oder eine ganze https-/ssh-Adresse. → { url, name } oder null
function klonAdresse(roh) {
  const t = String(roh || "").trim();
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i.exec(t);
  if (m) return { url: `https://github.com/${m[1]}/${m[2]}${m[3] ? ".git" : ""}`, name: m[2], github: true };
  m = /^(?:https:\/\/|ssh:\/\/|git@)\S+$/i.exec(t);
  if (m) { const n = letzter(t.replace(/\.git$/i, "").replace(/^.*[:/]/, (x) => x)); return { url: t, name: n || "vault", github: false }; }
  return null;
}

// ---------------------------------------------------------------- Zustand
const SCHRITTE = TE.schritte;
const S = {
  step: 0, max: 0, dir: 1, busy: null,
  git: "pruefe", gitMeldung: "", gitPollt: false,
  weg: "neu", name: "Kortex", ort: null /* gewählter Elternordner für „Neuer Vault“ */, ordner: null /* { pfad, breit, notizen, ordner, mehr } */, vertraut: true, url: "",
  vault: null /* { pfad, name, schluessel } */, vaultFertig: false, klonFehler: null, wasAnDa: false,
  sync: "start" /* start | code | abgelaufen | abgelehnt | ok | aus | gesichert | blockiert | nichtVerfuegbar | laedt */, syncGeladen: false,
  code: null, sekunden: 899, ablaufMs: 0, login: null, schonRemote: null, repo: "", repoFertig: null, syncFehler: null, syncText: "", vergeben: null, angelegt: null, codeLauf: 0, klonWartet: false,
  probe: "bereit",
  beiOrdnerAuswahl: false,
};
const ki = erzeugeKi({
  vaultPfad: () => S.vault?.pfad || null,
  beiAenderung: () => { renderFuss(); renderBuehne(); },
  kopiere, melde: (text) => toast(text),
});

const buehne = erzeugeBuehne(buehneEl, { fensterEl: win });
const windung = windungFortschritt();
const hero = baueHero();
buehneEl.append(hero.el);

// ---------------------------------------------------------------- System (App) oder Browser
async function kopiere(text) {
  const a = await aktionMitAntwort("kopieren", text);
  if (a !== undefined) return a?.ok === true;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
function oeffneExtern(url) { if (!aktion("extern", url)) window.open(url, "_blank", "noopener"); }

// Ordner wählen: in der App der System-Dialog ({pfad, breit?, notizen?, ordner?, mehr?} oder null), im Browser (Entwicklung) ein Pfadfeld.
async function waehleOrdner(titel, vorschlag) {
  let a;
  try { a = await aktionMitAntwort("ordner-waehlen", { titel, ...(vorschlag ? { vorschlag } : {}) }); } catch { a = undefined; }
  if (a === undefined) { const p = await pfadDialog(titel); return p ? { pfad: p } : null; }
  const pfad = typeof a === "string" ? a : a?.pfad;
  return pfad ? { ...(typeof a === "object" ? a : {}), pfad: String(pfad) } : null;
}
function pfadDialog(titel) {
  return new Promise((ok) => {
    const feld = textfeld({ platzhalter: TE.ordnerFallback.platzhalter, label: TE.ordnerFallback.feld, daten: { "data-feld": "pfad" } });
    const nein = baueKnopf({ text: TE.abbrechen, aktion: "pfad-abbrechen" });
    const ja = baueKnopf({ text: TE.ordnerFallback.ok, variante: "primaer", aktion: "pfad-uebernehmen" });
    let fertig = false;
    const d = dialog({ titel: titel || TE.ordnerFallback.titel, rumpf: feld.el, knoepfe: [nein, ja], beiSchliessen: () => { if (!fertig) { fertig = true; ok(null); } } });
    const nimm = () => {
      const w = feld.input.value.trim();
      if (!w) return feld.fehler(TE.ordnerFallback.leer);
      if (!/^[/~]/.test(w)) return feld.fehler(TE.ordnerFallback.relativ);
      fertig = true; d.schliessen(); ok(w);
    };
    nein.addEventListener("click", () => d.schliessen());
    ja.addEventListener("click", nimm);
  });
}

// ---------------------------------------------------------------- Vorgaben aus dem Zustand
const wegName = () => TE.vault.wege[S.weg];
function vaultOrt() {
  if (S.vault && S.vaultFertig) return kurzPfad(S.vault.pfad);
  if (S.weg === "beispiel") return "~/Kortex-Beispiel";
  if (S.weg === "oeffnen") return S.ordner ? kurzPfad(S.ordner.pfad) : TE.vault.ordnerWaehlen;
  if (S.weg === "klonen") { const a = klonAdresse(S.url); return `~/${ordnername(a?.name || "vault")}`; }
  return kurzPfad(zielOrdnerNeu());
}
function vaultName() {
  if (S.vault && S.vaultFertig) return S.vault.name;
  if (S.weg === "beispiel") return "Beispiel";
  if (S.weg === "oeffnen") return S.ordner ? (S.ordner.breit ? letzter(S.ordner.pfad) || "~" : letzter(S.ordner.pfad)) : "Dein Ordner";
  if (S.weg === "klonen") return klonAdresse(S.url)?.name || "Vault";
  return S.name.trim() || "Kortex";
}
const zielOrdnerNeu = () => (S.ort ? `${S.ort.replace(/\/+$/, "")}/${ordnername(S.name)}` : `~/${ordnername(S.name)}`);
// Schlüssel der Eingaben des Schritts „Vault“: bleibt er gleich, ist der Vault schon da und „Weiter“ legt nichts noch einmal an.
const vaultSchluessel = () => JSON.stringify([S.weg, S.name.trim(), S.ort, S.ordner?.pfad ?? null, S.vertraut, S.weg === "klonen" ? klonAdresse(S.url)?.url : null]);
const gitBereit = () => S.git === "ok" || S.git === "unbekannt";

// ---------------------------------------------------------------- Stepper
function renderStepper() {
  const knoepfe = SCHRITTE.slice(1).map((name, i) => {
    const n = i + 1;
    const b = h("button", { type: "button", "aria-label": TE.schrittAria(n, name), title: name, "data-sprung": String(n), klasse: n < S.step ? "erledigt" : "", "aria-current": n === S.step ? "step" : null,
      disabled: n > S.max || !!S.busy || null });
    return b;
  });
  const stand = S.step > 0 ? h("span", { klasse: "e-stand" }, h("b", { text: SCHRITTE[S.step] }), ` · ${S.step} von 4`) : null;
  stepperEl.replaceChildren(...knoepfe, stand, ...(S.step > 0 ? [windung.el] : []));
  windung.setze(S.step, ruhig());
}
stepperEl.addEventListener("click", (e) => { const b = e.target.closest("[data-sprung]"); if (b && !b.disabled && !S.busy) geheZu(+b.dataset.sprung); });

// ---------------------------------------------------------------- Fußleiste
function primaer() {
  switch (S.step) {
    case 1: {
      if (S.vault && S.vaultFertig && S.vault.schluessel === vaultSchluessel()) return { label: TE.weiter, ok: true, taste: true };
      const ok = S.weg === "oeffnen" ? !!S.ordner && !S.ordner.breit : S.weg === "klonen" ? !!klonAdresse(S.url) : true;
      return { label: wegName().knopf, ok };
    }
    case 2:
      if (S.sync === "laedt") return { label: TE.weiter, ok: false };
      if (S.sync === "start") return { label: TE.sicherung.anmelden, ok: true };
      if (S.sync === "code") return { label: TE.sicherung.warteKnopf, ok: false, lade: true };
      if (S.sync === "abgelaufen" || S.sync === "abgelehnt") return { label: S.sync === "abgelaufen" ? TE.sicherung.abgelaufenKnopf : TE.sicherung.abgelehntKnopf, ok: true };
      return { label: TE.weiter, ok: true };
    case 3: {
      const n = ki.offen().length;
      if (!ki.z.geladen) return { label: TE.ki.knopfOhne, ok: false };
      if (n) return { label: TE.ki.knopf(n), ok: true };
      return { label: ki.verbundene().length ? TE.weiter : TE.ki.knopfOhne, ok: true };
    }
    case 4: return { label: TE.fertig.studio, ok: true };
  }
  return { label: TE.weiter, ok: true };
}
const zurueckKnopf = baueKnopf({ text: TE.zurueck, symbol: "pfeil-links", aktion: "zurueck", aufKlick: () => zurueck() });
const weiterKnopf = baueKnopf({ variante: "primaer", aktion: "weiter", aufKlick: () => weiter() });
weiterKnopf.classList.remove("nur-symbol"); // der Inhalt kommt erst in renderFuss
const spaeterKnopf = baueKnopf({ text: TE.spaeter, variante: "leise", aktion: "spaeter", aufKlick: () => zeigeSpaeter() });
fussEl.append(spaeterKnopf, h("div", { klasse: "e-rechts" }, zurueckKnopf, weiterKnopf));
function renderFuss() {
  const p = primaer();
  const label = S.busy || p.label;
  weiterKnopf.replaceChildren(...(S.busy || p.lade ? [h("span", { klasse: "e-lade", style: "border-top-color:currentColor" })] : []), h("span", { text: label }),
    ...(S.busy || p.lade ? [] : [h("span", { klasse: "e-chip-key", text: TE.weiterTastenHinweis })]));
  weiterKnopf.disabled = !!S.busy || !p.ok;
  zurueckKnopf.disabled = !!S.busy;
  spaeterKnopf.disabled = !!S.busy;
  spaeterKnopf.style.visibility = S.step === 4 ? "hidden" : "";
}

// ---------------------------------------------------------------- Panes
let aktuellesPane = null;
function paneKopf(titel, text) { return [h("h1", { text: titel }), h("p", { klasse: "e-sub", text })]; }
function paneHuelle(...kinder) { return h("div", { klasse: "e-pane" }, ...kinder); }
function baueSchritt() {
  switch (S.step) {
    case 1: return paneVault();
    case 2: return paneSicherung();
    case 3: return paneKi();
    case 4: return paneFertig();
  }
  return null;
}
function wechslePane() {
  const alt = panes.querySelector(".e-pane:not(.raus)");
  const neu = baueSchritt();
  if (alt) { alt.style.setProperty("--dir", S.dir); alt.classList.remove("rein"); alt.classList.add("raus"); setTimeout(() => alt.remove(), 240); }
  aktuellesPane = neu;
  if (!neu) return;
  neu.classList.add("rein"); neu.style.setProperty("--dir", S.dir);
  panes.append(neu);
  setTimeout(() => neu.classList.remove("rein"), 700);
}
// Einen Teil des Schritts neu zeichnen (die Eingabe im Rest bleibt stehen)
function erneuere(id, bauer) {
  const alt = aktuellesPane?.querySelector(`#${id}`);
  if (!alt) return;
  const neu = bauer();
  alt.replaceWith(neu);
}

// ---------- Schritt 1: Vault
const WEGE = ["neu", "beispiel", "oeffnen", "klonen"];
function wegBild(id) {
  if (id === "neu") return h("div", { klasse: "e-mb" }, h("div", { klasse: "e-mb-zeilen" }, h("i"), h("i"), h("i")));
  if (id === "beispiel") return h("div", { klasse: "e-mb" }, h("div", { klasse: "e-mb-karten" }, h("i"), h("i"), h("i")));
  const links = id === "oeffnen" ? symbol("ordner-offen", 16) : markenLogo("github", 16, { dekorativ: true });
  const rechts = id === "oeffnen" ? markeSvg(16) : symbol("ordner", 16);
  return h("div", { klasse: "e-mb" }, h("div", { klasse: "e-mb-paar" }, h("span", { klasse: "e-gross" }, links), h("span", { klasse: "e-pf" }, h("i"), h("i"), h("i")), h("span", { klasse: "e-gross" }, rechts)));
}
function paneVault() {
  const gruppe = h("div", { klasse: "e-wege", role: "radiogroup", "aria-label": TE.vault.wegeAria },
    WEGE.map((id) => {
      const w = TE.vault.wege[id];
      const b = h("button", { type: "button", klasse: "e-weg", role: "radio", "aria-checked": String(S.weg === id), tabindex: S.weg === id ? "0" : "-1", "data-weg": id },
        h("div", { klasse: "e-weg-bild" }, wegBild(id)), h("span", { klasse: "e-weg-haken" }, symbol("haken", 12)),
        h("div", { klasse: "e-weg-text" }, h("b", null, w.t, w.empfohlen ? h("span", { klasse: "e-badge brand e-empf", text: w.empfohlen }) : null), h("span", { text: w.h })));
      b.addEventListener("click", () => waehleWeg(id));
      return b;
    }));
  gruppe.addEventListener("keydown", (e) => {
    const b = e.target.closest(".e-weg"); if (!b) return;
    const i = WEGE.indexOf(b.dataset.weg);
    const d = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const n = (i + d + 4) % 4; waehleWeg(WEGE[n]); gruppe.querySelector(`.e-weg[data-weg="${WEGE[n]}"]`).focus();
  });
  const bereits = S.wasAnDa && S.vault ? h("p", { klasse: "e-hint", text: TE.vault.schonEinVault(S.vault.name) }) : null;
  return paneHuelle(...paneKopf(TE.vault.titel, TE.vault.text), h("div", { klasse: "e-koerper" }, gruppe, vaultDetail(), bereits));
}
function waehleWeg(id) {
  if (S.weg === id || S.busy) return;
  S.weg = id;
  aktuellesPane?.querySelectorAll(".e-weg").forEach((b) => { const an = b.dataset.weg === id; b.setAttribute("aria-checked", String(an)); b.tabIndex = an ? 0 : -1; });
  erneuere("e-detail", vaultDetail); renderFuss(); renderBuehne();
}
function ortZeile(text, mitAendern) {
  const ortText = h("span", { klasse: "e-mono", id: "ort-text", text });
  return h("div", { klasse: "e-ort" }, symbol("ordner", 14), ortText,
    mitAendern ? baueKnopf({ text: TE.vault.aendern, variante: "leise", klasse: "e-xs", aktion: "ort", aufKlick: waehleOrt }) : null);
}
async function waehleOrt() {
  const a = await waehleOrdner(TE.vault.ortTitel, S.ort || undefined);
  if (a) { S.ort = a.pfad; const t = $("#ort-text"); if (t) t.textContent = kurzPfad(zielOrdnerNeu()); renderBuehne(); renderFuss(); }
}
function vaultDetail() {
  const detail = (...k) => h("div", { klasse: "e-detail", id: "e-detail" }, ...k);
  if (S.weg === "neu") {
    const feld = textfeld({ wert: S.name, maxlaenge: 80, label: TE.vault.name, klasse: "e-feld-gross", daten: { "data-feld": "name" },
      beiEingabe: (w) => { S.name = w; const t = $("#ort-text"); if (t) t.textContent = kurzPfad(zielOrdnerNeu()); renderBuehne(); renderFuss(); } });
    return detail(h("div", { klasse: "e-feld-reihe" }, h("span", { klasse: "e-label", text: TE.vault.name }), feld.el),
      h("div", { klasse: "e-feld-reihe" }, h("span", { klasse: "e-label", text: TE.vault.ort }), ortZeile(kurzPfad(zielOrdnerNeu()), true)));
  }
  if (S.weg === "beispiel") {
    return detail(h("div", { klasse: "e-meldung" }, symbol("buch", 14), h("span", { text: TE.vault.beispielText })),
      h("div", { klasse: "e-feld-reihe" }, h("span", { klasse: "e-label", text: TE.vault.ort }), ortZeile("~/Kortex-Beispiel", false)));
  }
  if (S.weg === "oeffnen") {
    if (!S.ordner) {
      const b = h("button", { type: "button", klasse: "e-ablage", "data-aktion": "waehle" }, symbol("ordner-plus", 20), h("span", null, h("b", { style: "color:var(--text);font-weight:500", text: TE.vault.ordnerWaehlen })));
      b.addEventListener("click", ordnerWahl);
      return detail(b);
    }
    const o = S.ordner;
    const zaehlung = typeof o.notizen === "number" ? TE.vault.ordnerZaehlung(o.notizen, o.ordner ?? 0, o.mehr) : TE.vault.ordnerGewaehlt;
    const aendern = baueKnopf({ text: o.breit ? TE.vault.anderenWaehlen : TE.vault.ordnerAendern, variante: "leise", klasse: "e-xs", aktion: "waehle", aufKlick: ordnerWahl });
    if (o.breit) {
      const dort = h("button", { type: "button", klasse: "e-leise-link", "data-aktion": "dort-anlegen", text: TE.vault.dortAnlegen });
      dort.addEventListener("click", () => { S.ort = o.pfad; S.ordner = null; S.weg = "neu"; wechslePaneInhalt(); });
      return detail(h("div", { klasse: "e-wahl-ordner schlecht" }, h("span", { klasse: "e-ico" }, symbol("warnung", 16)), h("div", { klasse: "e-t" }, h("b", { text: kurzPfad(o.pfad) }), h("span", { text: o.breit.name || TE.vault.breitTitel })), aendern),
        h("div", { klasse: "e-meldung schlecht" }, symbol("info", 14), h("span", null, `${TE.vault.zuBreit()} `, dort)));
    }
    const schalter = umschalter({ an: S.vertraut, label: TE.vault.selbstAngelegt, aufAenderung: (w) => { S.vertraut = w; renderFuss(); }, daten: { "data-aktion": "vertraut" } });
    return detail(h("div", { klasse: "e-wahl-ordner" }, h("span", { klasse: "e-ico" }, symbol("ordner", 16)), h("div", { klasse: "e-t" }, h("b", { text: kurzPfad(o.pfad) }), h("span", { text: zaehlung })), aendern),
      h("div", { klasse: "e-schalt-zeile" }, h("div", null, h("b", { text: TE.vault.selbstAngelegt }), h("span", { text: TE.vault.selbstAngelegtText })), schalter));
  }
  // klonen
  const a = klonAdresse(S.url);
  const meld = h("div", { klasse: "e-meldung", id: "url-text" });
  const zeigeMeldung = () => { const ok = !!klonAdresse(S.url); meld.replaceChildren(symbol(ok ? "schloss" : "info", 14), h("span", { text: ok ? TE.vault.urlPrivat : S.url.trim() ? TE.vault.urlUngueltig : TE.vault.urlBeispiel })); };
  const feld = textfeld({ wert: S.url, platzhalter: TE.vault.urlPlatzhalter, label: TE.vault.urlLabel, klasse: "e-feld-gross e-mono-feld", daten: { "data-feld": "url" },
    beiEingabe: (w) => { S.url = w; feld.input.setAttribute("aria-invalid", String(!!w.trim() && !klonAdresse(w))); zeigeMeldung(); renderBuehne(); renderFuss(); } });
  zeigeMeldung();
  if (a) feld.input.setAttribute("aria-invalid", "false");
  return detail(h("div", { klasse: "e-feld" }, h("label", { klasse: "e-label", for: feld.input.id, text: TE.vault.urlLabel }), feld.el), meld,
    S.klonFehler ? h("div", { klasse: "e-meldung schlecht", role: "alert" }, symbol("warnung", 14), h("span", { text: S.klonFehler.text })) : null,
    S.klonFehler?.anmelden ? baueKnopf({ text: TE.vault.klonAnmelden, groesse: "s", symbol: "schloss", aktion: "klon-anmelden", aufKlick: () => { S.klonWartet = true; S.klonFehler = null; erneuere("e-detail", vaultDetail); geheZu(2); } }) : null);
}
async function ordnerWahl() {
  const a = await waehleOrdner(TE.vault.ordnerTitel, S.ordner?.pfad);
  if (!a) return;
  S.ordner = { pfad: a.pfad, breit: a.breit ?? null, notizen: a.notizen, ordner: a.ordner, mehr: !!a.mehr };
  erneuere("e-detail", vaultDetail); renderFuss(); renderBuehne();
}
function wechslePaneInhalt() { // Inhalt von Schritt 1 komplett neu (nach „Dort einen neuen Vault anlegen“)
  const alt = aktuellesPane; const neu = paneVault(); alt?.replaceWith(neu); aktuellesPane = neu; renderFuss(); renderBuehne();
}

// ---------- Schritt 2: Sicherung
function paneSicherung() {
  const klonen = S.weg === "klonen";
  return paneHuelle(...paneKopf(klonen ? TE.sicherung.titelKlonen : TE.sicherung.titel, klonen ? TE.sicherung.textKlonen : TE.sicherung.text), syncKoerper());
}
function codeKnoten(alt) {
  const z = (S.code?.code || "").split("");
  return h("div", { klasse: "e-code" + (alt ? " alt" : ""), role: "img", "aria-label": TE.sicherung.codeAria(S.code?.code || "") },
    z.map((c, i) => (c === "-" ? h("span", { klasse: "strich", text: "–" }) : h("span", { style: `animation-delay:${i * 45}ms`, text: c }))));
}
const zeitText = () => `${Math.floor(S.sekunden / 60)}:${String(S.sekunden % 60).padStart(2, "0")}`;
function syncKoerper() {
  const k = h("div", { klasse: "e-koerper", id: "e-sync" });
  const erg = k.append.bind(k);
  k.append = (...n) => erg(...n.filter(Boolean));
  const fehler = S.syncFehler ? h("div", { klasse: "e-meldung schlecht", role: "alert", "data-bereich": "sync-fehler" }, symbol("warnung", 14), h("span", { text: S.syncFehler })) : null;
  const leiseLink = (text, aktionName, fn) => h("div", { style: "text-align:center" }, (() => { const b = h("button", { type: "button", klasse: "e-leise-link", "data-aktion": aktionName, text }); b.addEventListener("click", fn); return b; })());
  switch (S.sync) {
    case "laedt":
      k.append(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-lade" }), h("span", { klasse: "e-shimmer", text: TE.ki.sucht })));
      break;
    case "start":
      k.append(h("div", { klasse: "e-karte" },
        h("div", { klasse: "e-karte-kopf" }, h("span", { klasse: "e-kachel-40" }, markenLogo("github", 20, { dekorativ: true })), h("div", null, h("b", { text: TE.sicherung.kopf }), h("span", { text: TE.sicherung.kopfText }))),
        h("ul", { klasse: "e-vorteile" }, [["verlauf", TE.sicherung.vorteile[0]], ["schloss", TE.sicherung.vorteile[1]], ["laptop", TE.sicherung.vorteile[2]]].map(([s, t]) => h("li", null, symbol(s, 16), t))),
        h("p", { klasse: "e-hint", style: "margin:0", text: TE.sicherung.hinweis })), fehler, leiseLink(TE.sicherung.ohne, "ohne", () => { S.sync = "aus"; S.syncFehler = null; neuSync(); }));
      break;
    case "code": case "abgelaufen": case "abgelehnt": {
      const alt = S.sync !== "code";
      const kop = baueKnopf({ text: TE.sicherung.kopieren, groesse: "s", symbol: "kopieren", aktion: "kopieren", disabled: alt, aufKlick: async () => { if (await kopiere(S.code.code)) toast(TE.sicherung.kopiert); } });
      const gh = baueKnopf({ text: TE.sicherung.githubOeffnen, groesse: "s", aktion: "github-oeffnen", disabled: alt, nach: [symbol("extern", 12)], aufKlick: () => { oeffneExtern(S.code.url); toast(TE.sicherung.githubGeoeffnet); } });
      const status = h("div", { klasse: "e-code-status", "aria-live": "polite" },
        ...(S.sync === "code" ? [h("span", { klasse: "e-lade" }), h("span", { klasse: "e-shimmer", text: TE.sicherung.wartet }), h("span", { klasse: "e-zeit e-tnum", id: "zeit", text: zeitText() })]
          : [h("span", { klasse: "e-badge warn" }, symbol("uhr", 12), S.sync === "abgelaufen" ? TE.sicherung.abgelaufen : TE.sicherung.abgelehnt),
            h("span", { style: "color:var(--text-2)", text: S.sync === "abgelaufen" ? TE.sicherung.abgelaufenText : TE.sicherung.abgelehntText })]));
      k.append(h("div", { klasse: "e-code-karte" }, h("span", { klasse: "e-cap", text: TE.sicherung.code }), codeKnoten(alt), h("div", { klasse: "e-code-akt" }, kop, gh), status),
        h("ol", { klasse: "e-mini-schritte" }, TE.sicherung.mini.map((t) => h("li", { text: t }))), fehler,
        leiseLink(TE.sicherung.abbrechen, "abbrechen", brecheAnmeldungAb));
      break;
    }
    case "ok": {
      const konto = h("div", { klasse: "e-konto" }, h("span", { klasse: "e-avatar", text: (S.login || "GH").slice(0, 2).toUpperCase() }),
        h("div", { klasse: "e-t" }, h("b", { text: S.login || TE.sicherung.angemeldet }), h("span", null, symbol("kreis-haken", 12), TE.sicherung.angemeldet)),
        baueKnopf({ text: TE.sicherung.anderesKonto, variante: "leise", klasse: "e-xs", aktion: "anderes", aufKlick: () => { S.sync = "start"; neuSync(); } }));
      if (S.schonRemote) {
        k.append(konto, h("div", { klasse: "e-meldung gut" }, symbol("kreis-haken", 14), h("span", { text: TE.sicherung.schonVerbunden(S.schonRemote) })));
        break;
      }
      const feld = textfeld({ wert: S.repo, label: TE.sicherung.repoLabel, klasse: "e-feld-gross e-mono-feld", daten: { "data-feld": "repo" }, beiEingabe: (w) => { S.repo = w; S.vergeben = null; S.syncFehler = null; $("#sync-fehler-ort")?.replaceChildren(); renderBuehne(); } });
      feld.feld.prepend(h("span", { klasse: "e-pre e-mono", text: `${S.login || "…"}/` }));
      feld.feld.append(h("span", { klasse: "e-badge" }, symbol("schloss", 12), TE.sicherung.privat));
      k.append(konto, h("div", { klasse: "e-feld" }, h("label", { klasse: "e-label", for: feld.input.id, text: TE.sicherung.repoLabel }), feld.el, h("span", { klasse: "e-hint", text: TE.sicherung.repoHinweis })),
        h("div", { id: "sync-fehler-ort" }, fehler,
          S.vergeben ? baueKnopf({ text: TE.sicherung.vorhandenNehmen(S.vergeben), groesse: "s", aktion: "vorhanden-nehmen", aufKlick: async () => { const name = S.vergeben; S.syncFehler = null; if (await sichereMit(S.login, name, false)) geheZu(3); } }) : null),
        h("div", { klasse: "e-schalt-zeile" }, h("div", null, h("b", { text: TE.sicherung.abgleich }), h("span", { text: TE.sicherung.abgleichText }))));
      break;
    }
    case "gesichert":
      k.append(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-kreis" }, symbol("wolke-hoch", 24)), h("b", { text: TE.sicherung.schonGesichert }), h("p", { text: TE.sicherung.schonGesichertText })));
      break;
    case "blockiert":
      k.append(h("div", { klasse: "e-warnkarte" }, symbol("warnung", 16), h("div", null, h("b", { text: TE.sicherung.blockiert }), h("p", { text: S.syncText })),
        h("div", { klasse: "e-akt" }, baueKnopf({ text: TE.git.nochmal, groesse: "s", aktion: "sync-neu", aufKlick: () => { S.syncGeladen = false; ladeSync(); } }))),
        leiseLink(TE.sicherung.ohne, "ohne", () => { S.sync = "aus"; neuSync(); }));
      break;
    case "nichtVerfuegbar":
      k.append(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-kreis" }, symbol("laptop", 24)), h("b", { text: TE.sicherung.lokalTitel }), h("p", { text: TE.sicherung.nichtVerfuegbar })));
      break;
    default: // "aus"
      k.append(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-kreis" }, symbol("laptop", 24)), h("b", { text: TE.sicherung.lokalTitel }), h("p", { text: TE.sicherung.lokalText }),
        baueKnopf({ text: TE.sicherung.doch, variante: "leise", groesse: "s", symbol: null, kinder: [markenLogo("github", 14, { dekorativ: true })], klasse: "e-doch", aktion: "doch", aufKlick: () => { S.sync = S.login ? "ok" : "start"; neuSync(); } })));
  }
  return k;
}
function neuSync() { erneuere("e-sync", syncKoerper); renderFuss(); renderBuehne(); }

// Zustand der Sicherung aus der Wirklichkeit: ist der Vault schon mit einem Server verbunden, gibt es ein GitHub-Konto?
async function ladeSync() {
  if (S.syncGeladen || (!S.vault && !S.klonWartet)) return;
  S.syncGeladen = true; S.sync = "laedt"; neuSync();
  const [konto, bereit] = await Promise.allSettled([api.githubKonto(), api.sicherungBereit()]);
  const kt = konto.status === "fulfilled" ? konto.value : null, br = bereit.status === "fulfilled" ? bereit.value : null;
  S.login = kt?.login || null;
  S.repo = S.repo || repoVorschlag(S.vault?.name || "vault");
  const klonen = S.weg === "klonen";
  if (br?.zustand === "gesichert" && !klonen) S.sync = "gesichert";
  else if (br?.zustand === "blockiert" && !klonen) { S.sync = "blockiert"; S.syncText = br.text || TE.sicherung.blockiert; }
  else if (kt && kt.verfuegbar === false) S.sync = "nichtVerfuegbar";
  else if (kt?.angemeldet) { S.sync = "ok"; S.schonRemote = br?.zustand === "gesichert" ? (S.repoFertig || TE.sicherung.diesenServer) : null; }
  else S.sync = "start";
  neuSync();
  if (S.klonWartet && S.sync === "ok") await nachAnmeldung(S.login); // schon angemeldet: gleich zurück zum Klonen
}

// GitHub-Gerätecode: Code holen, Countdown, Zustand der Werkstatt alle 2 s
let codeTimer = null, pollTimer = null;
function stoppeCode() { clearInterval(codeTimer); clearTimeout(pollTimer); codeTimer = pollTimer = null; S.codeLauf++; }
async function starteAnmeldung() {
  stoppeCode();
  const lauf = S.codeLauf;
  S.syncFehler = null;
  S.busy = TE.sicherung.codeHolt; renderFuss();
  let r;
  try { r = await api.githubAnmelden(); }
  catch (e) {
    S.busy = null; S.sync = "start";
    S.syncFehler = e?.status === 502 || ausgangUnklar(e) ? TE.sicherung.keinNetz : meldungVon(e);
    neuSync(); return;
  }
  if (lauf !== S.codeLauf) return;
  S.busy = null;
  S.code = { code: String(r.code), url: String(r.url) };
  const ms = Date.parse(r.ablauf);
  S.ablaufMs = Number.isFinite(ms) ? ms : Date.now() + 899000;
  S.sekunden = Math.max(0, Math.round((S.ablaufMs - Date.now()) / 1000));
  S.sync = "code";
  neuSync();
  codeTimer = setInterval(() => {
    if (S.sync !== "code") return clearInterval(codeTimer);
    S.sekunden = Math.max(0, Math.round((S.ablaufMs - Date.now()) / 1000));
    const z = $("#zeit"); if (z) z.textContent = zeitText();
    if (S.sekunden <= 0) { stoppeCode(); S.sync = "abgelaufen"; neuSync(); }
  }, 1000);
  const frage = async () => {
    if (lauf !== S.codeLauf || S.sync !== "code") return;
    let z = null;
    try { z = await api.githubZustand(); } catch { /* kurz kein Netz: weiter versuchen */ }
    if (lauf !== S.codeLauf || S.sync !== "code") return;
    if (z?.zustand === "fertig") { stoppeCode(); await nachAnmeldung(z.login); return; }
    if (z?.zustand === "abgelaufen") { stoppeCode(); S.sync = "abgelaufen"; neuSync(); return; }
    if (z?.zustand === "abgelehnt") { stoppeCode(); S.sync = "abgelehnt"; if (z.grund === "schluesselbund") S.syncFehler = TE.sicherung.schluesselbund; neuSync(); return; }
    pollTimer = setTimeout(frage, 2000);
  };
  pollTimer = setTimeout(frage, 1500);
}
async function nachAnmeldung(login) {
  S.login = login || S.login || null;
  S.sync = "ok"; S.syncFehler = null;
  let bereit = null; try { bereit = await api.sicherungBereit(); } catch { /* unten */ }
  S.schonRemote = bereit?.zustand === "gesichert" ? TE.sicherung.diesenServer : null;
  neuSync();
  toast(TE.sicherung.verbunden);
  if (S.klonWartet) { S.klonWartet = false; await warte(500); geheZu(1); weiter(); }
}
async function brecheAnmeldungAb() {
  stoppeCode();
  try { await api.githubAbbrechen(); } catch { /* nur das Warten endet */ }
  S.sync = "start"; S.syncFehler = null; neuSync();
}
// Repository anlegen (oder ein vorhandenes nehmen) und den Vault damit verbinden
async function sichereMit(besitzer, name, neuAnlegen) {
  S.busy = neuAnlegen ? TE.sicherung.repoLegtAn : TE.sicherung.repoVerbindet; renderFuss();
  try {
    let repo = S.angelegt && S.angelegt.name === name ? S.angelegt : null;
    if (neuAnlegen && !repo) { repo = await api.githubRepoAnlegen(name); S.angelegt = repo; S.busy = TE.sicherung.repoVerbindet; renderFuss(); }
    const b = repo?.besitzer || besitzer;
    await api.sicherungVerbinden(b, repo?.name || name);
    S.repoFertig = `${b}/${repo?.name || name}`; S.angelegt = null; S.syncFehler = null; S.vergeben = null;
    S.busy = null; toast(TE.sicherung.gesichertToast);
    return true;
  } catch (e) {
    S.busy = null;
    if (e?.status === 409 && e?.daten?.art === "name") { S.vergeben = name; S.syncFehler = TE.sicherung.vergeben(name); }
    else if (e?.status === 409 && e?.daten?.art === "gesichert") { S.repoFertig = TE.sicherung.diesenServer; S.syncFehler = null; S.busy = null; return true; }
    else if (e?.status === 401 || e?.daten?.art === "anmeldung" || e?.daten?.art === "nicht-angemeldet") { S.sync = "start"; S.syncFehler = TE.sicherung.fehlerAnmeldung; }
    else if (e?.status === 502 && e?.daten?.art === "netz") S.syncFehler = TE.sicherung.keinNetz;
    else S.syncFehler = meldungVon(e);
    neuSync();
    return false;
  }
}

// ---------- Schritt 3: KI
function paneKi() { return paneHuelle(...paneKopf(TE.ki.titel, TE.ki.text), h("div", { klasse: "e-koerper" }, ki.wurzel)); }

// ---------- Schritt 4: Fertig
function paneFertig() {
  const verb = ki.verbundene();
  const zeile = (delay, ico, neutral, titel, sub, mono, aendernZiel, aendernText, extra) => h("div", { klasse: "e-z rein", style: `animation-delay:${delay}ms` },
    h("span", { klasse: "e-ico" + (neutral ? " neutral" : "") }, symbol(ico, 16)), h("div", { klasse: "e-t" }, h("b", { text: titel }), h("span", { klasse: mono ? "e-mono" : "", text: sub })), extra || null,
    baueKnopf({ text: aendernText || TE.fertig.aendern, variante: "leise", klasse: "e-xs", aktion: `aendern-${aendernZiel}`, aufKlick: () => geheZu(aendernZiel) }));
  const gesichert = S.repoFertig || S.sync === "gesichert" || (S.sync === "ok" && S.schonRemote);
  const syncZ = gesichert
    ? zeile(80, "wolke-hoch", false, S.repoFertig && S.repoFertig !== TE.sicherung.diesenServer ? TE.fertig.gesichert : TE.fertig.gesichertSchon, S.repoFertig && S.repoFertig !== TE.sicherung.diesenServer ? `${S.repoFertig} · privat` : "", true, 2)
    : zeile(80, "laptop", true, TE.fertig.nurMac, TE.fertig.nurMacText, false, 2, TE.fertig.einschalten);
  const logos = verb.length ? h("span", { klasse: "e-logos-stapel" }, verb.map((p) => h("span", { klasse: "e-logo-tile" }, kiLogo(p.id, 12, { dekorativ: true })))) : null;
  const kiZ = verb.length
    ? zeile(160, "funke", false, verb.map((p) => p.name).join(", "), verb.map((p) => TE.ki.stufen[ki.z.ki[p.id].stufe].name).join(" · "), false, 3, null, logos)
    : zeile(160, "gehirn", true, TE.fertig.keineKi, TE.fertig.keineKiText, false, 3);
  const pflegeZ = ki.z.pflege ? zeile(240, "sync", false, TE.fertig.pflege, TE.fertig.pflegeText(ki.z.pflege.name), false, 3) : null;
  const zusammen = h("div", { klasse: "e-zusammen" }, zeile(0, "ordner", false, TE.fertig.vault(S.vault?.name || vaultName()), kurzPfad(S.vault?.pfad || ""), true, 1), syncZ, kiZ, pflegeZ);
  return paneHuelle(...paneKopf(TE.fertig.titel, TE.fertig.text), h("div", { klasse: "e-koerper" }, zusammen, probeKnoten(verb), tastenKnoten()));
}
function tastenKnoten() {
  return h("div", { klasse: "e-tasten" }, TE.fertig.tasten.map(([a, b, t]) => h("span", null, h("kbd", { klasse: "e-kbd", text: a }), h("kbd", { klasse: "e-kbd", text: b, style: b.length > 1 ? "min-width:44px" : "" }), ` ${t}`)));
}
function probeKnoten(verb) {
  if (!verb.length) {
    return h("div", { klasse: "e-probe" }, h("div", { klasse: "e-schalt-zeile" }, h("div", null, h("b", { text: TE.fertig.schnell }), h("span", { text: TE.fertig.schnellText })),
      h("span", { style: "display:flex;gap:3px" }, h("kbd", { klasse: "e-kbd", text: "⌥" }), h("kbd", { klasse: "e-kbd", style: "min-width:44px", text: "Leer" }))));
  }
  const ki0 = verb.find((p) => p.id === "claude") || verb[0];
  const frage = textfeld({ wert: TE.fertig.probeFrage, label: TE.fertig.probeFrageAria, klasse: "e-probe-eingabe", daten: { "data-feld": "probe" } });
  frage.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.metaKey) { e.preventDefault(); e.stopPropagation(); probe(frage.input.value, antwort); } });
  const senden = baueKnopf({ symbol: "pfeil-oben", variante: "primaer", label: TE.fertig.fragen, aktion: "probe", klasse: "e-icon", aufKlick: () => probe(frage.input.value, antwort) });
  const antwort = h("div", { klasse: "e-antwort", id: "antwort", "aria-live": "polite", hidden: true });
  return h("div", { klasse: "e-probe", id: "probe" },
    h("div", { klasse: "e-probe-kopf" }, h("span", { klasse: "e-cap", text: TE.fertig.probe }), h("span", { klasse: "e-badge" }, kiLogo(ki0.id, 12, { dekorativ: true }), `${ki0.name} · ${TE.ki.stufen[ki.z.ki[ki0.id].stufe].name}`)),
    h("div", { klasse: "e-probe-feld" }, frage.el, senden), antwort);
}
// Probe: eine echte Suche über denselben Weg, den die KI nimmt (MCP); das Ergebnis erscheint Wort für Wort, mit den Fundstellen als Chips
async function probe(frageText, a) {
  if (S.probe === "laeuft") return;
  const q = String(frageText || "").trim(); if (!q) return;
  S.probe = "laeuft";
  a.hidden = false; a.replaceChildren(h("span", { klasse: "e-shimmer", text: TE.fertig.probeSucht }));
  let r = null, fehler = null;
  try { r = await api.probe(q); } catch (e) { fehler = meldungVon(e); }
  const treffer = Array.isArray(r?.treffer) ? r.treffer : [];
  const satz = fehler ? TE.fertig.probeFehler(fehler) : treffer.length ? TE.fertig.probeTreffer(treffer.length) : TE.fertig.probeKeine;
  a.replaceChildren();
  const text = h("span", { klasse: "e-caret" }); a.append(text);
  for (const w of satz.split(/(?<= )/)) { text.insertAdjacentText("beforebegin", w); await warte(ruhig() ? 0 : 34); }
  for (const t of treffer.slice(0, 3)) { text.insertAdjacentElement("beforebegin", h("span", { klasse: "e-quelle", title: t.pfad || "" }, symbol("notiz", 12), String(t.titel || t.pfad || ""))); text.insertAdjacentText("beforebegin", " "); await warte(ruhig() ? 0 : 60); }
  text.classList.remove("e-caret"); S.probe = "fertig";
}

// ---------------------------------------------------------------- Bühne
function ordnerChips() {
  if (S.weg === "beispiel") return [["inbox", "Posteingang", ""], ["notiz", "Notizen", ""], ["aufgaben", "Aufgaben", ""]];
  if (S.weg === "oeffnen") {
    if (!S.ordner) return [["ordner-plus", "Ordner wählen", ""]];
    if (S.ordner.breit) return [["warnung", TE.vault.breitTitel, ""]];
    const o = S.ordner;
    return [["inbox", "Posteingang", "neu"], ["notiz", "Notizen", typeof o.notizen === "number" ? o.notizen : ""], ["ordner", "Ordner", typeof o.ordner === "number" ? o.ordner : ""]];
  }
  return [["inbox", "Posteingang", ""], ["notiz", "Notizen", ""], ["aufgaben", "Aufgaben", ""]];
}
function renderBuehne() {
  const fokus = { 1: "ordner", 2: "gh", 3: "ki" }[S.step] || null;
  const chips = ordnerChips();
  const gesichertDa = !!S.repoFertig || S.sync === "gesichert";
  const ghStatus = S.step < 1 ? "weg" : S.step < 2 && S.max < 2 ? "platz" : gesichertDa || S.sync === "ok" ? "ok" : S.sync === "aus" || S.sync === "nichtVerfuegbar" ? "lokal" : S.sync === "code" ? "wartet" : "start";
  const schild = ghStatus === "platz" ? TE.buehne.platzSicherung : ghStatus === "ok" ? "" : ghStatus === "lokal" ? TE.buehne.nurMac : ghStatus === "wartet" ? TE.buehne.wartet : "GitHub";
  const repoText = ghStatus === "ok" ? (S.repoFertig ? S.repoFertig.split("/").pop() : S.login ? S.login : "GitHub") : "";
  const kb = ki.buehne();
  const keineKI = kb.keine && (S.step >= 3 || S.max >= 3);
  const platz = S.step >= 1 && ((S.step < 3 && S.max < 3) || keineKI) ? (keineKI ? "keine" : "schritt") : "aus";
  buehne.zeige({
    schritt: S.step, max: S.max, fokus, vaultName: vaultName(), vaultOrt: vaultOrt(),
    ordner: { schluessel: [S.weg, !!S.ordner, !!S.ordner?.breit, S.ordner?.notizen, S.ordner?.ordner].join("|"), chips: chips.map(([s, t, z]) => ({ symbol: s, text: t, zahl: z })) },
    gh: { zustand: ghStatus, schild: ghStatus === "ok" ? repoText : schild, schildSymbol: ghStatus === "ok" && S.repoFertig ? "schloss" : null },
    ki: { modus: kb.modus, programme: kb.programme, platz },
  });
}

// ---------------------------------------------------------------- Ablauf
function geheZu(n) {
  if (n === S.step || S.busy) return;
  if (S.step === 2 && n !== 2 && S.sync === "code") { stoppeCode(); api.githubAbbrechen().catch(() => {}); S.sync = "start"; }
  S.dir = n > S.step ? 1 : -1;
  S.step = n; S.max = Math.max(S.max, n);
  renderStepper(); renderFuss(); renderBuehne();
  if (n > 0) wechslePane(); else { panes.replaceChildren(); aktuellesPane = null; }
  buehne.linienBald(1100);
  document.activeElement?.blur?.(); // ↩ gilt vom Rumpf aus (siehe Tastatur); kein Fokusring auf dem Hauptknopf nach einem Schrittwechsel
  if (n === 2) ladeSync();
  if (n === 3 && !ki.z.geladen) ki.lade();
}
function zurueck() { if (!S.busy && S.step > 0) geheZu(S.step - 1); }

async function mitBusy(text, fn) {
  S.busy = text; renderFuss(); renderStepper();
  try { return await fn(); } finally { S.busy = null; renderFuss(); renderStepper(); }
}

async function weiter() {
  const p = primaer();
  if (S.busy || !p.ok) return;
  if (S.step === 0) return geheZu(1);
  if (S.step === 1) {
    if (S.vault && S.vaultFertig && S.vault.schluessel === vaultSchluessel()) return geheZu(2);
    if (S.weg === "neu" && !S.name.trim()) { toast(TE.vault.nameLeer, { fehler: true }); return; }
    if (S.weg === "neu" && /[/\\]/.test(S.name)) { toast(TE.vault.nameSchraegstrich, { fehler: true }); return; }
    const ok = await legeVaultAn();
    if (ok) geheZu(2);
    return;
  }
  if (S.step === 2) {
    if (S.sync === "start") return starteAnmeldung();
    if (S.sync === "abgelaufen" || S.sync === "abgelehnt") return starteAnmeldung();
    if (S.sync === "ok" && !S.schonRemote && !S.repoFertig) {
      const name = S.repo.trim();
      const f = repoNameFehler(name);
      if (f) { S.syncFehler = f; neuSync(); return; }
      if (!(await sichereMit(S.login, name, true))) return;
    }
    return geheZu(3);
  }
  if (S.step === 3) {
    if (ki.offen().length) {
      S.busy = TE.ki.arbeit(ki.offen().length); renderFuss(); renderBuehne();
      const alle = await ki.verbinde();
      S.busy = null; renderFuss(); renderBuehne();
      if (!alle) return; // Fehler stehen in den Zeilen, der Nutzer entscheidet
    }
    return geheZu(4);
  }
  if (S.step === 4) return oeffneStudio();
}

// Vault anlegen / öffnen / klonen — die vorhandene API; Erfolg = ein Vault ist aktiv (info.vault)
async function legeVaultAn() {
  const art = S.weg;
  const text = TE.vault.arbeit[art];
  return mitBusy(text, async () => {
    try {
      let r;
      if (art === "neu") r = await api.vaultNeu("vorlage", S.name.trim() || "Kortex", zielOrdnerNeu());
      else if (art === "beispiel") r = await legeBeispielAn();
      else if (art === "oeffnen") {
        r = await api.vaultOeffnen(S.ordner.pfad, S.vertraut ? { gitEinschalten: true } : undefined);
        const pfad = pfadAusAntwort(r) || S.ordner.pfad;
        if (S.vertraut) { try { await api.vertrauen(true, pfad); } catch { /* das Studio fragt dann einmal */ } }
      } else {
        const a = klonAdresse(S.url);
        r = await api.vaultKlonen(a.url, `~/${ordnername(a.name)}`);
      }
      const info = await api.info().catch(() => null);
      if (info && !info.vault) throw new Error(TE.vault.fehlerStandard);
      const pfad = info?.vault || pfadAusAntwort(r);
      S.vault = { pfad, name: info?.name || vaultName(), schluessel: vaultSchluessel() };
      S.vaultFertig = true; S.syncGeladen = false; S.sync = "start"; S.schonRemote = null; S.repoFertig = null; S.angelegt = null; S.repo = repoVorschlag(S.vault.name);
      S.klonFehler = null;
      ki.z.pflege = null; for (const k of Object.values(ki.z.ki)) k.verbunden = false;
      toast(TE.vault.bereit(S.vault.name));
      return true;
    } catch (e) {
      if (S.weg === "klonen" && [403, 404].includes(e?.status)) { S.klonFehler = { text: TE.vault.klonAnmeldung, anmelden: true }; }
      else if (S.weg === "klonen") S.klonFehler = { text: meldungVon(e) };
      else S.klonFehler = null;
      if (S.weg !== "klonen") toast(meldungVon(e), { fehler: true });
      erneuere("e-detail", vaultDetail);
      return false;
    }
  });
}
const pfadAusAntwort = (r) => (typeof r?.pfad === "string" && r.pfad) || (typeof r?.vault?.pfad === "string" && r.vault.pfad) || (typeof r?.vault === "string" && r.vault) || null;
async function legeBeispielAn() {
  let letzterFehler = null;
  for (let n = 1; n <= 9; n++) {
    const name = n === 1 ? "Kortex-Beispiel" : `Kortex-Beispiel ${n}`;
    try { return await api.vaultNeu("vorlage", "Kortex-Beispiel", `~/${name}`); }
    catch (e) { letzterFehler = e; if (e?.status !== 409) throw e; }
  }
  throw Object.assign(new Error(TE.vault.beispielBelegt), { status: letzterFehler?.status });
}

// Studio öffnen: das Zeichen wächst ins Fenster, dann übernimmt die App (schließt dieses Fenster, öffnet das Studio)
async function oeffneStudio() {
  S.busy = TE.fertig.studioBusy; renderFuss(); renderStepper();
  win.classList.add("oeffnet");
  buehne.linienBald(1200);
  await warte(ruhig() ? 80 : 1150);
  await beende("fertig");
}
async function beende(art) {
  const a = await aktionMitAntwort("einrichtung-ende", { art });
  if (a === undefined) location.href = "index.html"; // Browser (Entwicklung): kein App-Fenster, das Studio selbst ist die nächste Seite
}

// ---------- Später
function zeigeSpaeter() {
  if (S.busy || dialogDa()) return;
  const hatVault = !!(S.vault && S.vaultFertig);
  const nein = baueKnopf({ text: TE.spaeterDialog.weiter, variante: "leise", aktion: "spaeter-nein" });
  const ja = baueKnopf({ text: TE.spaeterDialog.ja, variante: "primaer", aktion: "spaeter-ja" });
  const d = dialog({ titel: TE.spaeterDialog.titel, satz: `${hatVault ? TE.spaeterDialog.mitVault : TE.spaeterDialog.ohneVault} ${TE.spaeterDialog.rest}`, knoepfe: [nein, ja] });
  nein.addEventListener("click", () => d.schliessen());
  ja.addEventListener("click", async () => {
    d.schliessen();
    S.busy = TE.beschaeftigt; renderFuss(); renderStepper();
    if (!hatVault && !S.wasAnDa) {
      try { await api.vaultNeu("vorlage", "Kortex", "~/Kortex"); } catch { toast(TE.spaeterDialog.vaultFehler, { fehler: true }); }
    }
    toast(TE.spaeterDialog.toast);
    await warte(ruhig() ? 80 : 700);
    await beende("spaeter");
  });
  setTimeout(() => ja.focus(), 0);
}
const dialogDa = () => !!document.querySelector("#dialog-host .schleier");

// ---------------------------------------------------------------- Willkommen (Schritt 0) und die stille Prüfung von git
function baueHero() {
  const start = baueKnopf({ text: TE.willkommen.start, variante: "primaer", klasse: "e-gross", aktion: "start", daten: { id: "start" }, disabled: true,
    nach: [h("span", { klasse: "e-chip-key", text: TE.weiterTastenHinweis })], aufKlick: () => { if (!start.disabled) { S.weg = S.weg || "neu"; geheZu(1); } } });
  const schon = baueKnopf({ text: TE.willkommen.schon, variante: "leise", klasse: "e-gross", aktion: "schon", daten: { id: "schon" }, aufKlick: () => { S.weg = "oeffnen"; geheZu(1); } });
  const vorab = h("div", { klasse: "e-vorab", id: "vorab", "aria-live": "polite" });
  const el = h("div", { klasse: "e-hero", id: "hero" },
    h("div", { klasse: "e-eyebrow", text: TE.willkommen.eyebrow }),
    h("h1", null, TE.willkommen.titel1, h("br"), h("span", { klasse: "e-verlauf", text: TE.willkommen.titel2 })),
    h("p", { text: TE.willkommen.text }),
    h("div", { klasse: "e-hero-akt" }, start, schon), vorab);
  return { el, start, schon, vorab };
}
async function pruefeGit() {
  const v = hero.vorab;
  S.git = "pruefe"; hero.start.disabled = true; hero.schon.disabled = true;
  v.replaceChildren(h("span", { klasse: "e-vorab-zeile" }, h("span", { klasse: "e-lade" }), h("span", { klasse: "e-shimmer", text: TE.willkommen.pruefe })));
  const t0 = performance.now();
  let a;
  try { a = await aktionMitAntwort("git-pruefen"); } catch { a = undefined; }
  // Die Prüfung ist schnell; das Bild bleibt trotzdem einen Moment stehen (nichts flackert), wie im Prototyp
  const rest = (ruhig() ? 200 : 900) - (performance.now() - t0);
  if (rest > 0) await warte(rest);
  const stand = a === undefined ? "unbekannt" : String(a?.stand || "nicht-pruefbar");
  S.gitMeldung = typeof a?.meldung === "string" ? a.meldung : "";
  if (stand === "vorhanden" || stand === "unbekannt") {
    S.git = stand === "vorhanden" ? "ok" : "unbekannt";
    hero.el.classList.remove("git-fehlt");
    hero.start.disabled = false; hero.schon.disabled = false;
    v.replaceChildren(h("span", { klasse: "e-vorab-zeile", style: "animation:e-pop 400ms var(--ease-flow) both" }, symbol("kreis-haken", 14), TE.willkommen.bereit));
    return;
  }
  S.git = stand;
  hero.el.classList.add("git-fehlt");
  zeigeGitKarte(stand);
}
function zeigeGitKarte(stand) {
  const v = hero.vorab;
  if (stand === "installiert") { zeigeGitInstalliert(); return; }
  const titel = stand === "defekt" ? TE.git.defektTitel : stand === "nicht-pruefbar" ? TE.git.nichtPruefbarTitel : TE.git.titel;
  const text = stand === "defekt" ? TE.git.defekt(S.gitMeldung || TE.git.defektStandard) : stand === "nicht-pruefbar" ? TE.git.nichtPruefbar : TE.git.text;
  const aktionen = h("div", { klasse: "e-akt" });
  if (stand === "fehlt") aktionen.append(baueKnopf({ text: TE.git.installieren, variante: "primaer", groesse: "s", aktion: "git-installieren", daten: { id: "git-install" }, aufKlick: installiereGit }), h("span", { klasse: "e-hint", text: TE.git.erlaubnis }));
  else aktionen.append(baueKnopf({ text: TE.git.nochmal, groesse: "s", aktion: "git-nochmal", aufKlick: pruefeGit }));
  v.replaceChildren(h("div", { klasse: "e-warnkarte", "data-bereich": "git" }, symbol("warnung", 16), h("div", null, h("b", { text: titel }), h("p", { text })), aktionen));
}
function zeigeGitInstalliert(meldung) {
  hero.vorab.replaceChildren(h("div", { klasse: "e-warnkarte", "data-bereich": "git" }, symbol("warnung", 16), h("div", null, h("b", { text: TE.git.titel }), h("p", { text: meldung || TE.git.laeuftHinweis })),
    h("div", { klasse: "e-akt" }, h("span", { klasse: "e-lade" }), h("span", { klasse: "e-hint e-shimmer", text: TE.git.laeuft, style: "white-space:nowrap" }), h("span", { klasse: "e-balken unbestimmt" }, h("i")))));
}
async function installiereGit() {
  let r;
  try { r = await aktionMitAntwort("git-installieren"); } catch { r = undefined; }
  if (r && r.ok === false) { hero.vorab.querySelector(".e-warnkarte p").textContent = TE.git.startFehler(r.meldung); return; }
  if (r?.stand === "vorhanden") return pruefeGit();
  zeigeGitInstalliert();
  // Apples Installation hat keinen Fortschritt, den wir sehen können: alle 3 Sekunden nachsehen, ob git da ist (nichts wird behauptet)
  S.gitPollt = true;
  for (let n = 0; n < 1200 && S.gitPollt; n++) {
    await warte(3000);
    let a; try { a = await aktionMitAntwort("git-pruefen"); } catch { a = undefined; }
    const st = String(a?.stand || "");
    if (st === "vorhanden") { S.gitPollt = false; return pruefeGit(); }
    if (st === "fehlt") { S.gitPollt = false; S.git = "fehlt"; hero.el.classList.add("git-fehlt"); zeigeGitKarte("fehlt"); toast(TE.git.abgebrochen, { fehler: true }); return; }
    if (st === "defekt" || st === "nicht-pruefbar") { S.gitPollt = false; S.gitMeldung = a?.meldung || ""; zeigeGitKarte(st); return; }
  }
}

// ---------------------------------------------------------------- Tastatur
document.addEventListener("keydown", (e) => {
  if (dialogDa()) return; // der Dialog behandelt Esc und Enter selbst
  if (e.key === "Escape") { e.preventDefault(); if (S.step < 4 && !S.busy) zeigeSpaeter(); return; }
  const tippt = e.target.matches?.("input, textarea, [contenteditable]");
  const eigen = e.target.closest?.("button, a, [role=radio], [role=switch], summary, select");
  if (e.key === "Enter" && !e.isComposing && (e.metaKey || e.ctrlKey || (!tippt && !eigen))) {
    e.preventDefault();
    if (S.step === 0) { if (!hero.start.disabled) geheZu(1); } else weiter();
    return;
  }
  if (e.key === "[" && e.metaKey) { e.preventDefault(); zurueck(); return; }
  if (!tippt && S.step === 1 && !S.busy && /^[1-4]$/.test(e.key)) waehleWeg(WEGE[+e.key - 1]);
});

// ---------------------------------------------------------------- Start
async function start() {
  const param = new URLSearchParams(location.search);
  if (inApp()) document.documentElement.classList.add("e-app");
  try { const t = leseLokal("theme", "system"); if (t === "hell") document.documentElement.dataset.theme = "light"; else if (t === "dunkel") document.documentElement.dataset.theme = "dark"; } catch { /* System */ }
  document.title = TE.fenster;
  renderStepper(); renderFuss(); renderBuehne();
  // Gibt es schon einen Vault (Menü „Kortex einrichten …“) und wurde ab= verlangt, beginnt der Assistent dort
  const ab = { vault: 1, sicherung: 2, ki: 3 }[param.get("ab")];
  let info = null;
  if (ab) { try { info = await api.info(); } catch { info = null; } }
  if (ab && info?.vault) {
    S.vault = { pfad: info.vault, name: info.name || letzter(info.vault), schluessel: vaultSchluessel() };
    S.vaultFertig = true; S.wasAnDa = true; S.weg = "neu"; S.repo = repoVorschlag(S.vault.name);
    hero.start.disabled = false; hero.schon.disabled = false;
    S.max = ab; geheZu(ab);
  } else {
    pruefeGit();
  }
  window.__einrichtungBereit = true;
}
start();
// Für die Tests der Oberfläche: der Zustand ist von außen lesbar (nie Eingaben des Nutzers verändern)
window.einrichtung = { zustand: S, ki };
