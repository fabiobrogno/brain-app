// Einrichtung „Kortex einrichten“ (Paket E2): ein Overlay IM Studio (kein eigenes Fenster) mit drei Schritten — Vault · KI · Sicherung. Über Schritt 1 steht der Willkommens-Kopf (Zeichen,
// Augenbraue, Titel); es gibt kein eigenes Willkommen und kein „Fertig“-Bild: das Ende ist das Schließen des Overlays. Erfüllte Schritte entfallen von selbst (KI, wenn für diesen Vault
// schon eine verbunden ist; Sicherung, wenn es ein Remote gibt oder der Vault von GitHub kam). git wird still geprüft, eine Karte erscheint nur, wenn es fehlt.
// Gestaltung nach dem Prototyp E0 (eine Karte, Pillen, Fußleiste mit ⌘↩); Muster aus Orca (siehe einrichtung.css).
// Die Schritte selbst sind eigene Module (einrichtung-vault.js, -ki.js, -sicherung.js); hier liegen Kopf, Pillen, Fußleiste, Reihenfolge, Tastatur, git und das Ende.
// Alles Echte läuft über die vorhandene API; die Hülle (App) liefert nur, was das System braucht (Hüllen-Vertrag, `huellen-vertrag.json`): git prüfen/installieren, Ordner wählen, Browser,
// Zwischenablage, „Overlay offen“ (`einrichtung-sitzung`), „Schritt erledigt“ (`einrichtung-schritt`) und das Ende (`einrichtung-ende`).
// Aufruf: `oeffneEinrichtung({ ab, weg, beiEnde })` (einrichtung-studio.js; Menü ⌘E, Karte, Seitenleiste, Befehl `einrichtung`). `ab` = "vault" | "ki" | "sicherung" beginnt dort (die Hülle
// rechnet es aus `einrichtung.json` aus), `weg` = "neu" | "oeffnen" | "klonen" | "beispiel" wählt den Weg im Vault-Schritt. `beiEnde({ art, zeichen, vertrauenFuer })` bekommt das Ende.
import { h, dialog, toast } from "./hilfen.js";
import { api, aktion, aktionMitAntwort } from "./api.js";
import { knopf as baueKnopf, textfeld, wenigBewegung } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { TE } from "./texte-einrichtung.js";
import { PRODUKT } from "./texte.js";
import { markeSvg } from "./windung.js";
import { erzeugeVault, WEGE, letzter } from "./einrichtung-vault.js";
import { erzeugeKi } from "./einrichtung-ki.js";
import { erzeugeSicherung } from "./einrichtung-sicherung.js";

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ruhig = () => wenigBewegung();

// Es gibt höchstens ein offenes Overlay (die Karte, das Menü und der Befehl öffnen nie ein zweites).
let offen = null;
// Der Rest des Studios, solange das Overlay offen ist: nicht bedienbar (`inert`), auch nicht per Tab oder Kürzel. Dialoge und Hinweise bleiben davor erreichbar.
const HINTERGRUND = ["app", "willkommen-host", "einstellungen-host"];
const SCHRITTE = ["vault", "ki", "sicherung"];

export function oeffneEinrichtung(opt = {}) {
  if (offen) { offen.nachVorn(); return offen; }
  const host = opt.host || document.getElementById("einrichtung-host");
  const mark = h("div", { klasse: "e-app-zeichen", id: "app-zeichen" }, markeSvg(60, { zeichnen: true }));
  const win = h("section", { klasse: "e-win", id: "win", "data-step": "vault", role: "dialog", "aria-modal": "true", "aria-label": TE.fenster },
    h("header", { klasse: "e-kopf" },
      h("div", { klasse: "e-top" }, mark, h("span", { klasse: "e-wm", text: PRODUKT })),
      h("nav", { klasse: "e-pills", id: "stepper", "aria-label": TE.fortschrittAria }),
      h("div", { klasse: "e-thd", id: "thd" })),
    h("div", { klasse: "e-body", id: "panes" }),
    h("footer", { klasse: "e-fuss", id: "fuss" }));
  const $ = (s, r = host) => r.querySelector(s);
  const panes = win.querySelector("#panes"), stepperEl = win.querySelector("#stepper"), fussEl = win.querySelector("#fuss"), thdEl = win.querySelector("#thd");
  const davor = document.activeElement;
  host.replaceChildren(h("div", { klasse: "e-zieh", "aria-hidden": "true" }), win);
  host.hidden = false;
  document.body.dataset.einrichtung = "offen";
  for (const id of HINTERGRUND) document.getElementById(id)?.setAttribute("inert", "");
  requestAnimationFrame(() => host.classList.add("an"));

  // ---------------------------------------------------------------- Zustand
  const S = {
    step: "vault", ansicht: null /* null | "klon-login" */, max: 0, dir: 1, busy: null, eintritt: null,
    git: "pruefe", gitMeldung: "", gitPollt: false,
    vault: null /* { pfad, name, schluessel, weg } */, vaultFertig: false, wasAnDa: false, klonVonGitHub: false,
    skip: { ki: false, sicherung: false }, vertrauenPfad: null,
  };

  // ---------------------------------------------------------------- System (App) oder Browser
  async function kopiere(text) {
    const a = await aktionMitAntwort("kopieren", text);
    if (a !== undefined) return a?.ok === true;
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
  function oeffneExtern(url) { if (!aktion("extern", url)) window.open(url, "_blank", "noopener"); }
  // Die Adresse des Gerätecodes kommt aus der Werkstatt: geöffnet wird sie nur als https-Adresse auf github.com (die App prüft es noch einmal).
  function oeffneGitHub(url) {
    let u; try { u = new URL(String(url)); } catch { return false; }
    if (u.protocol !== "https:" || !/^(www\.)?github\.com$/i.test(u.hostname)) return false;
    oeffneExtern(u.href); return true;
  }
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
  const meldeSchritt = (schritt) => { aktion("einrichtung-schritt", { schritt }); };

  // ---------------------------------------------------------------- Die drei Schritte
  const vault = erzeugeVault({ api, waehleOrdner, gitBereit: () => S.git === "ok" || S.git === "unbekannt", beiAenderung: () => renderFuss() });
  const ki = erzeugeKi({ api, vaultPfad: () => S.vault?.pfad || null, vaultName: () => S.vault?.name || "", beiAenderung: () => { renderFuss(); renderStepper(); }, kopiere, melde: (text) => toast(text) });
  const sicherung = erzeugeSicherung({ api, vaultName: () => S.vault?.name || "", beiAenderung: () => { renderFuss(); renderKopf(); renderStepper(); }, kopiere, oeffneGitHub });
  vault.klonAnmelden(() => klonLogin());
  sicherung.beiFertigSchritt(() => { meldeSchritt("sicherung"); ende("fertig"); });

  // Die Schritte, die gerade gelten. Ein erfüllter Schritt entfällt (auch aus den Pillen), außer die Hülle hat ihn ausdrücklich verlangt (`ab`).
  const entfaellt = (k) => (k === "ki" ? S.skip.ki : k === "sicherung" ? S.skip.sicherung : false) && S.eintritt !== k;
  const schritte = () => SCHRITTE.filter((k) => !entfaellt(k));
  const index = () => Math.max(0, schritte().indexOf(S.step));
  const letzterSchritt = () => S.step === schritte().at(-1);
  const naechster = () => schritte()[schritte().indexOf(S.step) + 1] || null;

  // ---------------------------------------------------------------- Kopf und Pillen
  function renderKopf() {
    const login = S.ansicht === "klon-login" || (S.step === "sicherung" && sicherung.ansicht() === "login");
    const n = index() + 1;
    let k;
    if (login) k = TE.kopf.sicherungLogin;
    else if (S.step === "vault") k = TE.kopf.vault;
    else k = { ...TE.kopf[S.step], eyebrow: TE.kopf[S.step].eyebrow(n) };
    thdEl.replaceChildren(h("div", { klasse: "e-eyebrow", text: k.eyebrow }), h("h1", { id: "e-titel", text: k.h }), h("p", { text: k.p }));
    win.dataset.step = S.step;
    win.dataset.kopf = S.step === "vault" && !login ? "gross" : "klein";
    win.setAttribute("aria-labelledby", "e-titel");
  }
  function renderStepper() {
    const liste = schritte(), i = index();
    const knoepfe = liste.map((k, nr) => {
      const name = TE.schritte[k];
      return h("button", { type: "button", klasse: "e-pill" + (nr < i ? " erledigt" : nr === i && !S.ansicht ? " aktiv" : ""), "aria-label": TE.schrittAria(nr + 1, liste.length, name), title: name, "data-sprung": k,
        "aria-current": nr === i && !S.ansicht ? "step" : null, disabled: nr > S.max || !!S.busy || !!S.ansicht || ki.arbeitet() || null }, h("i"));
    });
    stepperEl.replaceChildren(...knoepfe, h("span", { klasse: "e-stand", "data-feld": "stand", text: TE.stand(i + 1, liste.length) }));
  }
  stepperEl.addEventListener("click", (e) => { const b = e.target.closest("[data-sprung]"); if (b && !b.disabled && !S.busy) geheZu(b.dataset.sprung); });

  // ---------------------------------------------------------------- Fußleiste
  function primaer() {
    const letzt = letzterSchritt();
    const abschluss = (label) => ({ label: letzt ? TE.abschliessen : label, ok: true });
    if (S.ansicht === "klon-login") { const p = sicherung.primaer(); return { label: p.label, ok: p.ok, lade: p.lade }; }
    switch (S.step) {
      case "vault":
        if (S.vault && S.vaultFertig && S.vault.schluessel === vault.schluessel()) return abschluss(TE.weiter);
        return vault.primaer();
      case "ki":
        if (!ki.z.geladen) return { label: TE.weiter, ok: false };
        return { ...abschluss(TE.weiter), ok: !ki.arbeitet() };
      case "sicherung": {
        const p = sicherung.primaer();
        return p.abschluss ? { label: TE.abschliessen, ok: true } : p;
      }
    }
    return { label: TE.weiter, ok: true };
  }
  const zurueckKnopf = baueKnopf({ text: TE.zurueck, symbol: "pfeil-links", aktion: "zurueck", aufKlick: () => zurueck() });
  const weiterKnopf = baueKnopf({ variante: "primaer", aktion: "weiter", aufKlick: () => weiter() });
  weiterKnopf.classList.remove("nur-symbol"); // der Inhalt kommt erst in renderFuss
  const spaeterKnopf = baueKnopf({ text: TE.spaeter, variante: "leise", klasse: "e-spaeter", aktion: "spaeter", aufKlick: () => zeigeSpaeter() });
  fussEl.append(spaeterKnopf, h("div", { klasse: "e-rechts" }, zurueckKnopf, weiterKnopf));
  function renderFuss() {
    const p = primaer();
    const beschaeftigt = S.busy || sicherung.busy();
    const label = beschaeftigt || p.label;
    weiterKnopf.replaceChildren(...(beschaeftigt || p.lade ? [h("span", { klasse: "e-lade", style: "border-top-color:currentColor" })] : []), h("span", { text: label }),
      ...(beschaeftigt || p.lade ? [] : [h("span", { klasse: "e-chip-key", text: TE.weiterTastenHinweis })]));
    weiterKnopf.disabled = !!beschaeftigt || !p.ok;
    zurueckKnopf.disabled = !!beschaeftigt || ki.arbeitet();
    zurueckKnopf.hidden = index() === 0 && !S.ansicht;
    spaeterKnopf.disabled = !!beschaeftigt;
  }

  // ---------------------------------------------------------------- Panes (der Körper des Schritts, mit Bewegung beim Wechsel)
  let aktuellesPane = null;
  const gitHost = h("div", { id: "git-host", "data-bereich": "git-host" });
  const koerper = () => (S.ansicht === "klon-login" ? sicherung.wurzel : S.step === "vault" ? vault.wurzel : S.step === "ki" ? ki.wurzel : sicherung.wurzel);
  function baueSchritt() {
    const neu = h("div", { klasse: "e-pane" });
    if (S.step === "vault" && !S.ansicht) {
      neu.append(gitHost);
      if (S.wasAnDa && S.vault) neu.append(h("p", { klasse: "e-hint e-aktuell", text: `Aktueller Vault: ${S.vault.name}` }));
    }
    neu.append(koerper());
    return neu;
  }
  function wechslePane(animiert = true) {
    const alt = panes.querySelector(".e-pane:not(.raus)");
    const neu = baueSchritt();
    if (alt) { alt.style.setProperty("--dir", S.dir); alt.classList.remove("rein"); alt.classList.add("raus"); setTimeout(() => alt.remove(), 240); }
    aktuellesPane = neu;
    if (animiert) { neu.classList.add("rein"); neu.style.setProperty("--dir", S.dir); }
    panes.append(neu);
    if (animiert) setTimeout(() => neu.classList.remove("rein"), 700);
  }

  // ---------------------------------------------------------------- Ablauf
  function geheZu(k) {
    if (S.busy || ki.arbeitet()) return;
    if (k === S.step && !S.ansicht) return;
    if (S.step === "sicherung" && k !== "sicherung") sicherung.abbrechen();
    const liste = SCHRITTE.indexOf(k) - SCHRITTE.indexOf(S.step);
    S.dir = liste >= 0 ? 1 : -1;
    S.step = k; S.ansicht = null;
    S.max = Math.max(S.max, schritte().indexOf(k));
    renderStepper(); renderFuss(); renderKopf();
    wechslePane();
    document.activeElement?.blur?.(); // ↩ gilt vom Rumpf aus (siehe Tastatur); kein Fokusring auf dem Hauptknopf nach einem Schrittwechsel
    if (k === "sicherung") sicherung.lade({ klonen: S.klonVonGitHub });
  }
  function zurueck() {
    if (S.busy || ki.arbeitet()) return;
    if (S.ansicht === "klon-login") { sicherung.abbrechenLogin(); return; }
    const i = schritte().indexOf(S.step);
    if (i > 0) geheZu(schritte()[i - 1]);
  }
  async function mitBusy(text, fn) {
    S.busy = text; renderFuss(); renderStepper();
    try { return await fn(); } finally { S.busy = null; renderFuss(); renderStepper(); }
  }
  // Nach dem Vault: was ist schon erfüllt? (KI für diesen Vault verbunden · Remote da oder von GitHub geholt)
  async function pruefeErfuellt() {
    ki.vaultGewechselt?.();
    const [bereit] = await Promise.all([api.sicherungBereit().catch(() => null), ki.lade()]);
    S.skip.sicherung = S.klonVonGitHub || bereit?.zustand === "gesichert";
    S.skip.ki = ki.schonVerbunden();
    ki.setzeSicherungEntfaellt(S.skip.sicherung && S.step !== "sicherung");
    S.max = Math.max(S.max, schritte().indexOf(S.step));
    renderStepper();
  }
  // Der nächste Schritt, der noch gilt — oder das Ende
  async function gehWeiter() {
    const n = naechster();
    if (n) return geheZu(n);
    return ende("fertig");
  }

  async function weiter() {
    const p = primaer();
    if (S.busy || sicherung.busy() || !p.ok) return;
    if (S.ansicht === "klon-login") { await sicherung.weiter(); return; }
    if (S.step === "vault") {
      if (S.vault && S.vaultFertig && S.vault.schluessel === vault.schluessel()) { meldeSchritt("vault"); return gehWeiter(); }
      const r = await mitBusy(TE.vault.arbeit[vault.v.weg], () => vault.legeAn({ toast }));
      if (!r.ok) return;
      S.vault = { ...r.vault, weg: r.weg }; S.vaultFertig = true; S.wasAnDa = false;
      S.klonVonGitHub = r.weg === "klonen";
      S.vertrauenPfad = r.vertrauen.gefragt ? r.vault.pfad : S.vertrauenPfad;
      S.eintritt = null; S.max = 0;
      sicherung.zuruecksetzen(true);
      toast(TE.vault.bereit(S.vault.name));
      meldeSchritt("vault");
      await mitBusy(TE.beschaeftigt, pruefeErfuellt);
      return gehWeiter();
    }
    if (S.step === "ki") { meldeSchritt("ki"); return gehWeiter(); }
    if (S.step === "sicherung") {
      if (await sicherung.weiter()) { meldeSchritt("sicherung"); return ende("fertig"); }
    }
  }

  // „Von GitHub holen“ scheiterte am Zugriff (privates Repository): nur die Anmeldung, danach geht es zurück zum Klonen
  async function klonLogin() {
    S.ansicht = "klon-login"; S.dir = 1;
    renderStepper(); renderKopf(); renderFuss(); wechslePane();
    const ok = await sicherung.loginFuerKlon();
    if (S.ansicht !== "klon-login") return;
    S.ansicht = null; S.dir = -1;
    renderStepper(); renderKopf(); renderFuss(); wechslePane();
    sicherung.zuruecksetzen(false);
    if (ok) { await warte(ruhig() ? 0 : 500); weiter(); }
  }

  // ---------------------------------------------------------------- Ende: die App merkt es sich, das Overlay geht zu, das Studio lädt den Vault selbst in der Seite (`beiEnde`)
  async function ende(art) {
    const zeichenEl = win.querySelector("#app-zeichen");
    const zeichen = art === "fertig" && zeichenEl ? { el: zeichenEl.cloneNode(true), rect: zeichenEl.getBoundingClientRect() } : null;
    S.busy = S.busy || TE.beschaeftigt; renderFuss(); renderStepper();
    await aktionMitAntwort("einrichtung-ende", { art }); // im Browser (Entwicklung) ohne App: undefined, das Overlay geht trotzdem zu
    schliesse();
    try { await opt.beiEnde?.({ art, zeichen, vertrauenFuer: S.vertrauenPfad }); } catch { /* das Studio zeigt seinen Fehler selbst */ }
  }

  // ---------- Überspringen (Esc oder „Später“): kleine Rückfrage. Nichts wird angelegt; ohne Vault zeigt das Studio danach den leeren Zustand.
  let sperreBis = 0; // gegen gehaltenes oder doppeltes Esc: gleich nach dem Öffnen der Rückfrage gilt keine Taste (400 ms)
  function zeigeSpaeter() {
    if (S.busy || sicherung.busy() || dialogDa()) return;
    const nein = baueKnopf({ text: TE.spaeterDialog.weiter, variante: "leise", aktion: "spaeter-nein" });
    const ja = baueKnopf({ text: TE.spaeterDialog.ja, variante: "primaer", aktion: "spaeter-ja" });
    const d = dialog({ titel: TE.spaeterDialog.titel, satz: TE.spaeterDialog.satz, knoepfe: [nein, ja] });
    sperreBis = performance.now() + 400;
    nein.addEventListener("click", () => d.schliessen());
    ja.addEventListener("click", async () => {
      d.schliessen();
      toast(TE.spaeterDialog.toast);
      await ende("spaeter");
    });
    setTimeout(() => nein.focus(), 0); // Vorgabe ist das Weitermachen, nie das Überspringen
  }
  const dialogDa = () => !!document.querySelector("#dialog-host .schleier");

  // ---------------------------------------------------------------- git: still geprüft; eine Karte nur, wenn es fehlt
  async function pruefeGit() {
    S.git = "pruefe"; renderFuss();
    let a;
    try { a = await aktionMitAntwort("git-pruefen"); } catch { a = undefined; }
    const stand = a === undefined ? "unbekannt" : String(a?.stand || "nicht-pruefbar");
    S.gitMeldung = typeof a?.meldung === "string" ? a.meldung : "";
    if (stand === "vorhanden" || stand === "unbekannt") {
      S.git = stand === "vorhanden" ? "ok" : "unbekannt";
      gitHost.replaceChildren(); renderFuss();
      return;
    }
    S.git = stand; renderFuss();
    zeigeGitKarte(stand);
  }
  function zeigeGitKarte(stand) {
    if (stand === "installiert") { zeigeGitInstalliert(); return; }
    const titel = stand === "defekt" ? TE.git.defektTitel : stand === "nicht-pruefbar" ? TE.git.nichtPruefbarTitel : TE.git.titel;
    const text = stand === "defekt" ? TE.git.defekt(S.gitMeldung || TE.git.defektStandard) : stand === "nicht-pruefbar" ? TE.git.nichtPruefbar : TE.git.text;
    const aktionen = h("div", { klasse: "e-akt" });
    if (stand === "fehlt") aktionen.append(baueKnopf({ text: TE.git.installieren, variante: "primaer", groesse: "s", aktion: "git-installieren", daten: { id: "git-install" }, aufKlick: installiereGit }), h("span", { klasse: "e-hint", text: TE.git.erlaubnis }));
    else aktionen.append(baueKnopf({ text: TE.git.nochmal, groesse: "s", aktion: "git-nochmal", aufKlick: pruefeGit }));
    gitHost.replaceChildren(h("div", { klasse: "e-warnkarte", "data-bereich": "git" }, symbol("warnung", 16), h("div", null, h("b", { text: titel }), h("p", { text })), aktionen));
  }
  function zeigeGitInstalliert() {
    gitHost.replaceChildren(h("div", { klasse: "e-warnkarte", "data-bereich": "git" }, symbol("warnung", 16), h("div", null, h("b", { text: TE.git.titel }), h("p", { text: TE.git.laeuftHinweis })),
      h("div", { klasse: "e-akt" }, h("span", { klasse: "e-lade" }), h("span", { klasse: "e-hint e-shimmer", text: TE.git.laeuft, style: "white-space:nowrap" }), h("span", { klasse: "e-balken unbestimmt" }, h("i")))));
  }
  async function installiereGit() {
    let r;
    try { r = await aktionMitAntwort("git-installieren"); } catch { r = undefined; }
    if (r && r.ok === false) { gitHost.querySelector(".e-warnkarte p").textContent = TE.git.startFehler(r.meldung); return; }
    if (r?.stand === "vorhanden") return pruefeGit();
    S.git = "installiert"; renderFuss();
    zeigeGitInstalliert();
    // Apples Installation hat keinen Fortschritt, den wir sehen können: alle 3 Sekunden nachsehen, ob git da ist (nichts wird behauptet)
    S.gitPollt = true;
    for (let n = 0; n < 1200 && S.gitPollt; n++) {
      await warte(3000);
      let a; try { a = await aktionMitAntwort("git-pruefen"); } catch { a = undefined; }
      const st = String(a?.stand || "");
      if (st === "vorhanden") { S.gitPollt = false; return pruefeGit(); }
      if (st === "fehlt") { S.gitPollt = false; S.git = "fehlt"; renderFuss(); zeigeGitKarte("fehlt"); toast(TE.git.abgebrochen, { fehler: true }); return; }
      if (st === "defekt" || st === "nicht-pruefbar") { S.gitPollt = false; S.git = st; S.gitMeldung = a?.meldung || ""; renderFuss(); zeigeGitKarte(st); return; }
    }
  }

  // ---------------------------------------------------------------- Tastatur
  // Im Fang-Durchlauf (vor den Kürzeln des Studios): solange das Overlay offen ist, gehört die Tastatur ihm. Gehaltene Tasten wiederholen sich (`e.repeat`):
  // Esc öffnet die Rückfrage nur beim ersten Druck, und ein gehaltenes Esc oder ↩ gelangt nie in die Rückfrage hinein (sonst wäre sie sofort wieder zu oder bestätigt).
  let weiterGehalten = false;
  const taste = (e) => {
    if (dialogDa()) {
      const gesperrt = e.repeat || performance.now() < sperreBis;
      if (gesperrt && (e.key === "Escape" || e.key === "Enter")) { e.preventDefault(); e.stopImmediatePropagation(); }
      return; // sonst behandelt der Dialog Esc und Enter selbst
    }
    if (e.key === "Escape") {
      if (document.querySelector(".bs-pop.offen, .menue")) return; // ein offenes Menü schließt zuerst
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && !S.busy) zeigeSpaeter();
      return;
    }
    const tippt = e.target.matches?.("input, textarea, [contenteditable]");
    const eigen = e.target.closest?.("button, a, [role=radio], [role=switch], summary, select");
    if (e.key === "Enter" && !e.isComposing && (e.metaKey || e.ctrlKey || (!tippt && !eigen))) {
      e.preventDefault();
      if (e.repeat || weiterGehalten) return; // ⌘↩ gehalten geht nicht Schritt für Schritt durch den ganzen Ablauf
      weiterGehalten = true;
      weiter();
      return;
    }
    if (e.key === "[" && e.metaKey) { e.preventDefault(); if (!e.repeat) zurueck(); return; }
    if (!tippt && S.step === "vault" && !S.ansicht && !S.busy && /^[1-4]$/.test(e.key)) vault.waehleWeg(WEGE[+e.key - 1]);
  };
  const tasteLos = (e) => { if (e.key === "Enter" || e.key === "Meta" || e.key === "Control") weiterGehalten = false; };
  document.addEventListener("keydown", taste, true);
  document.addEventListener("keyup", tasteLos, true);

  // ---------------------------------------------------------------- Schließen
  let zu = false;
  function schliesse() {
    if (zu) return;
    zu = true;
    document.removeEventListener("keydown", taste, true);
    document.removeEventListener("keyup", tasteLos, true);
    S.gitPollt = false;
    sicherung.stoppe();
    ki.zerstoere();
    host.classList.remove("an");
    for (const id of HINTERGRUND) document.getElementById(id)?.removeAttribute("inert");
    delete document.body.dataset.einrichtung;
    if (offen === steuerung) offen = null;
    if (window.einrichtung === steuerung) delete window.einrichtung;
    aktion("einrichtung-sitzung", { offen: false }); // die Seite sagt der Hülle: das Overlay ist zu, die Rechte der Einrichtung enden
    const raeume = () => { if (!host.classList.contains("an")) { host.hidden = true; host.replaceChildren(); } };
    if (ruhig()) raeume(); else setTimeout(raeume, 260);
    if (davor && document.contains(davor)) davor.focus?.({ preventScroll: true });
  }

  // ---------------------------------------------------------------- Start
  async function start() {
    // Erst bestätigt die Seite der Hülle, dass das Overlay offen ist (das schaltet git, Zwischenablage, Schritt und Ende frei) — dann alles andere.
    try { await aktionMitAntwort("einrichtung-sitzung", { offen: true }); } catch { /* im Browser ohne App */ }
    if (zu) return;
    renderKopf(); renderStepper(); renderFuss(); wechslePane(false);
    const ab = SCHRITTE.includes(opt.ab) ? opt.ab : null;
    let info = null;
    if (ab) { try { info = await api.info(); } catch { info = undefined; } }
    if (zu) return;
    if (ab && info?.vault) {
      // Es gibt schon einen Vault (Menü „Kortex einrichten …“, Fortsetzen): die Einrichtung beginnt bei `ab`; was schon erfüllt ist, entfällt
      S.vault = { pfad: info.vault, name: info.name || letzter(info.vault), schluessel: vault.schluessel(), weg: "neu" };
      S.vaultFertig = true; S.wasAnDa = true; S.eintritt = ab; S.git = "unbekannt";
      await pruefeErfuellt();
      S.step = ab; S.max = schritte().indexOf(ab);
      renderKopf(); renderStepper(); renderFuss(); wechslePane(false);
      if (ab === "sicherung") sicherung.lade({ klonen: false });
      window.__einrichtungBereit = true;
      return;
    }
    if (opt.weg && WEGE.includes(opt.weg)) vault.setzeWeg(opt.weg);
    pruefeGit();
    window.__einrichtungBereit = true;
  }
  window.__einrichtungBereit = false;
  const steuerung = {
    zustand: S, ki, vault, sicherung, schliesse,
    nachVorn() { (host.querySelector(".e-win button:not(:disabled)") || win).focus?.({ preventScroll: true }); },
  };
  offen = steuerung;
  // Für die Tests der Oberfläche: der Zustand ist von außen lesbar (nie Eingaben des Nutzers verändern)
  window.einrichtung = steuerung;
  start();
  return steuerung;
}
