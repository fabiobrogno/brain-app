// Anmelde-Panel „Im Browser anmelden“ (Paket E3, Plan docs/plaene/einrichtung-und-konten-wie-orca.md 4.4): die Anmeldung bei Claude Code oder Codex im Fenster, ohne Terminal.
// Eigenständiger Baustein für den Einrichtungs-Ablauf (E2) und die Konten-Einstellungen (E4):
//
//   const a = starteAnmeldung("claude", { neu: "Firma" } | "<konto-kennung>", { host?, ordner?, beiFertig?, beiTerminal?, terminal? });
//   a.knoten      Element (wird in `host` gehängt, wenn gegeben)
//   a.ergebnis    Promise<{ phase: "ok"|"abgebrochen"|"terminal"|"fehler"|"timeout", konto? }>   — immer aufgelöst, nie abgelehnt
//   a.abbrechen() bricht ab (Werkstatt beendet das Programm und räumt das neue Konto weg), a.zerstoere() = abbrechen + Panel entfernen
//
// Ablauf: Die Werkstatt startet das Programm (werkstatt/anmelden.mjs); das Panel fragt alle 1,2 s nach dem Stand. Hat die Werkstatt Adresse (und bei Codex den Gerätecode),
// zeigt es „Im Browser anmelden“ (öffnet über die Aktion `extern` der Hülle), „Link kopieren“, bei Claude optional „Code einfügen“ und leise den Rest der Zeit.
// Der leise Link „Im Terminal anmelden“ ist immer da: der bisherige Weg über das Terminal. Geht im Fenster etwas schief, tritt er in den Vordergrund — nie ein Hängen.
// Die Oberfläche sieht nur Adresse und Gerätecode, nie Token oder Dateien des Logins.
import { h } from "./hilfen.js";
import { knopf, textfeld } from "./bausteine.js";
import { api, aktion, inApp } from "./api.js";
import { symbol } from "./symbole.js";
import { markenLogo } from "./marken.js";
import { TA } from "./texte-anmeldung.js";

const TAKT_MS = 1200;

export function starteAnmeldung(programm, konto, opt = {}) {
  const neuName = konto && typeof konto === "object" && typeof konto.neu === "string" ? konto.neu : null;
  const kontoId = typeof konto === "string" ? konto : null;
  const inhalt = h("div", { klasse: "an-inhalt", "aria-live": "polite" });
  const knoten = h("section", { klasse: "an", "data-bereich": "anmeldung", "data-programm": programm, "data-phase": "start" },
    h("h3", { klasse: "an-titel" }, markenLogo(programm === "codex" ? "codex" : "claude", 16, { dekorativ: true }), h("span", { text: TA.titel(programm) })), inhalt);
  let aufgeloest = null, id = null, uhr = null, tick = null, lebt = true, fertig = false, endeMs = null, restEl = null, stand = null, terminalOffen = false;
  const ergebnis = new Promise((r) => { aufgeloest = r; });
  const setze = (phase, ...kinder) => { knoten.dataset.phase = phase; inhalt.replaceChildren(...kinder.flat().filter(Boolean)); restEl = inhalt.querySelector(".an-rest"); };
  const meldung = (text, art = "fehler") => h("div", { klasse: `an-meldung ${art}`, role: art === "fehler" ? "alert" : "status" }, symbol(art === "ok" ? "kreis-haken" : "warnung", 14), h("span", { text }));
  const beende = (erg) => { if (fertig) return; fertig = true; halt(); try { aufgeloest(erg); } catch { /* egal */ } try { opt.beiFertig?.(erg); } catch (e) { console.error(e); } };
  const halt = () => { clearTimeout(uhr); uhr = null; clearInterval(tick); tick = null; };

  // ---- Hilfen
  async function kopiere(text, merk) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = text.length <= 400 && !!(inApp() && aktion("kopieren", text)); }
    merk.textContent = ok ? merk.dataset.ok : TA.kopierFehler;
  }
  const oeffne = (url) => { if (!(inApp() && aktion("extern", url))) window.open(url, "_blank", "noopener"); };
  const terminalLink = (betont = false) => knopf({ text: TA.terminal, variante: betont ? "sekundaer" : "leise", groesse: "s", klasse: "an-terminal", aufKlick: terminalWeg, daten: { "data-test": "an-terminal" } });
  const formatRest = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return TA.rest(Math.floor(s / 60), s % 60); };
  const zeigeRest = () => { if (restEl && endeMs !== null) restEl.textContent = formatRest(endeMs - Date.now()); };

  // ---- Zustände
  function zeigeStart() {
    setze("start", h("div", { klasse: "an-arbeit" }, h("span", { klasse: "an-dreh", "aria-hidden": "true" }), h("span", { text: TA.startet })),
      h("div", { klasse: "an-fuss" }, knopf({ text: TA.abbrechen, variante: "leise", groesse: "s", aufKlick: abbrechen, daten: { "data-test": "an-abbrechen" } }), terminalLink()));
  }
  function zeigeWarten(z) {
    const kopiert = h("div", { klasse: "an-kopiert", role: "status", "data-ok": TA.linkKopiert });
    const codeBox = h("div", { klasse: "an-code-feld", hidden: true });
    const sendeMeld = h("div", { klasse: "an-kopiert", role: "status" });
    const zeilen = [];
    if (z.code) zeilen.push(h("div", { klasse: "an-text", text: TA.geraetecodeText }), h("div", { klasse: "an-code", "aria-label": TA.geraetecode, "data-code": "", text: z.code }));
    else zeilen.push(h("div", { klasse: "an-text", text: TA.browserText }));
    const knoepfe = [knopf({ text: TA.imBrowser, variante: "primaer", symbol: "extern", aufKlick: () => oeffne(z.url), daten: { "data-test": "an-browser" } }),
      knopf({ text: TA.linkKopieren, symbol: "kopieren", aufKlick: () => { kopiert.dataset.ok = TA.linkKopiert; kopiere(z.url, kopiert); }, daten: { "data-test": "an-link" } })];
    if (z.code) knoepfe.push(knopf({ text: TA.codeKopieren, symbol: "kopieren", aufKlick: () => { kopiert.dataset.ok = TA.codeKopiert; kopiere(z.code, kopiert); }, daten: { "data-test": "an-code-kopieren" } }));
    zeilen.push(h("div", { klasse: "an-knoepfe" }, knoepfe), kopiert);
    if (z.codeMoeglich) {
      const feld = textfeld({ label: TA.codeLabel, platzhalter: TA.codeLabel, daten: { "data-test": "an-code-feld", spellcheck: "false" }, klasse: "an-code-eingabe" });
      const senden = knopf({ text: TA.codeSenden, aufKlick: async () => {
        const wert = feld.input.value.trim();
        if (!wert) { feld.fokus(); return; }
        senden.disabled = true; sendeMeld.textContent = "";
        try { await api.kiAnmeldeCode(id, wert); feld.input.value = ""; sendeMeld.textContent = TA.codeGesendet; }
        catch (e) { feld.fehler(e?.status === 400 ? TA.codeFalsch : TA.codeGeht); }
        senden.disabled = false;
      }, daten: { "data-test": "an-code-senden" } });
      feld.input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); senden.click(); } });
      codeBox.append(h("div", { klasse: "an-text", text: TA.codeText }), h("div", { klasse: "an-code-zeile" }, feld.el, senden), sendeMeld);
      const auf = knopf({ text: TA.codeEinfuegen, variante: "leise", groesse: "s", aufKlick: () => { codeBox.hidden = !codeBox.hidden; auf.setAttribute("aria-expanded", String(!codeBox.hidden)); if (!codeBox.hidden) feld.fokus(); }, daten: { "data-test": "an-code-einfuegen", "aria-expanded": "false" } });
      zeilen.push(auf, codeBox);
    }
    restEl = h("span", { klasse: "an-rest", "data-test": "an-rest" });
    zeilen.push(h("div", { klasse: "an-arbeit" }, h("span", { klasse: "an-dreh", "aria-hidden": "true" }), h("span", { text: TA.wartet }), restEl),
      h("div", { klasse: "an-fuss" }, knopf({ text: TA.abbrechen, variante: "leise", groesse: "s", aufKlick: abbrechen, daten: { "data-test": "an-abbrechen" } }), terminalLink()));
    setze("wait", zeilen);
    zeigeRest();
  }
  // Das Panel baut sich nur neu, wenn sich Adresse/Code/Möglichkeit ändern — nie bei jedem Takt (sonst verliert das Code-Feld Fokus und Text).
  const schluessel = (z) => `${z.phase}|${z.url}|${z.code}|${z.codeMoeglich}`;

  function zeigeEnde(z) {
    halt();
    if (z.phase === "ok") {
      setze("ok", meldung(z.konto?.name ? TA.fertigNeu(z.konto.name) : TA.fertig, "ok"));
      beende({ phase: "ok", ...(z.konto ? { konto: z.konto } : {}) });
    } else if (z.phase === "abgebrochen") {
      setze("abgebrochen", h("div", { klasse: "an-text", text: TA.abgebrochen }));
      beende({ phase: "abgebrochen" });
    } else {
      const schl = TA.fehlerVonGrund[z.grund];
      const text = z.phase === "timeout" ? TA.abgelaufen : TA[schl] || TA.allgemein;
      setze(z.phase === "timeout" ? "timeout" : "fehler", meldung(text),
        h("div", { klasse: "an-fuss" }, knopf({ text: TA.nochmal, variante: z.rueckfall ? "sekundaer" : "primaer", aufKlick: neuStart, daten: { "data-test": "an-nochmal" } }), terminalLink(!!z.rueckfall)));
      // Das Ergebnis bleibt offen: „Noch einmal“ oder der Terminal-Weg beenden es.
    }
  }

  // ---- Abläufe
  async function neuStart() {
    halt(); id = null; stand = null;
    zeigeStart();
    try {
      const r = await api.kiAnmeldeStart(programm, kontoId ?? { neu: neuName });
      if (!lebt) { api.kiAnmeldeAbbruch(r.id).catch(() => {}); return; }
      id = r.id; verarbeite(r); planeAbfrage();
    } catch (e) {
      if (!lebt) return;
      const art = e?.daten?.art;
      if (art === "laeuft-schon" && e.daten.id) { id = e.daten.id; planeAbfrage(); return; } // dieselbe Anmeldung weiterführen (z. B. Panel neu geöffnet)
      const text = art === "nicht-gefunden" ? TA.nichtGefunden : art === "zu-oft" || art === "zu-viele" ? TA.zuOft : e?.message || TA.allgemein;
      setze("fehler", meldung(text), h("div", { klasse: "an-fuss" }, knopf({ text: TA.nochmal, aufKlick: neuStart, daten: { "data-test": "an-nochmal" } }), terminalLink(true)));
    }
  }
  function verarbeite(z) {
    if (!lebt || fertig) return;
    if (["ok", "timeout", "error", "abgebrochen"].includes(z.phase)) { zeigeEnde(z); return; }
    if (z.phase === "wait") {
      endeMs = z.verbleibendMs == null ? null : Date.now() + z.verbleibendMs;
      if (!stand || schluessel(stand) !== schluessel(z)) zeigeWarten(z);
    } else if (z.phase === "start") { endeMs = null; if (!stand || stand.phase !== "start") zeigeStart(); }
    stand = z;
  }
  function planeAbfrage() {
    halt();
    tick = setInterval(zeigeRest, 1000);
    const lauf = async () => {
      if (!lebt || fertig || !id) return;
      try { verarbeite(await api.kiAnmeldeStand(id)); }
      catch (e) { if (e?.status === 404) { setze("fehler", meldung(TA.allgemein), h("div", { klasse: "an-fuss" }, knopf({ text: TA.nochmal, aufKlick: neuStart }), terminalLink(true))); return; } /* kurz weg: weiter versuchen */ }
      if (lebt && !fertig && knoten.dataset.phase !== "fehler" && knoten.dataset.phase !== "timeout") uhr = setTimeout(lauf, TAKT_MS);
    };
    uhr = setTimeout(lauf, TAKT_MS);
  }
  async function abbrechen() {
    if (fertig) return;
    const alt = id; id = null; halt();
    if (alt) { try { await api.kiAnmeldeAbbruch(alt); } catch { /* die Werkstatt räumt spätestens nach der Frist auf */ } }
    setze("abgebrochen", h("div", { klasse: "an-text", text: TA.abgebrochen }));
    beende({ phase: "abgebrochen" });
  }
  // Der bisherige Weg: Terminal. Eine laufende Anmeldung im Fenster wird zuerst beendet (nie zwei Anmeldungen am selben Ordner).
  async function terminalWeg() {
    if (terminalOffen) return;
    terminalOffen = true;
    const alt = id; id = null; halt();
    if (alt) { try { await api.kiAnmeldeAbbruch(alt); } catch { /* egal */ } }
    try {
      if (typeof opt.terminal === "function") await opt.terminal({ programm, konto });
      else {
        let ordner = opt.ordner ?? null;
        if (neuName) ordner = (await api.kiKontoNeu({ programm, name: neuName })).neuesKonto.pfad;
        else if (kontoId && opt.ordner === undefined) { const k = ((await api.kiKonten()).konten || []).find((x) => x.id === kontoId); ordner = k && !k.standard ? k.pfad : null; }
        await api.kiAnmelden(programm, ordner);
      }
      setze("terminal", meldung(TA.terminalOffen, "ok"));
      try { opt.beiTerminal?.(); } catch (e) { console.error(e); }
      beende({ phase: "terminal" });
    } catch (e) {
      terminalOffen = false;
      setze("fehler", meldung(e?.message || TA.terminalFehler), h("div", { klasse: "an-fuss" }, knopf({ text: TA.nochmal, aufKlick: neuStart }), terminalLink(true)));
    }
  }
  const zerstoere = () => { lebt = false; const alt = id; id = null; halt(); if (alt && !fertig) api.kiAnmeldeAbbruch(alt).catch(() => {}); knoten.remove(); beende({ phase: "abgebrochen" }); };

  if (opt.host) opt.host.append(knoten);
  neuStart();
  return { knoten, ergebnis, abbrechen, zerstoere };
}
