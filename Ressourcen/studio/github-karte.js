// Karte „Bei GitHub anmelden“ (Gerätecode): Code groß, ein Knopf kopiert ihn und öffnet GitHub, dann Warten, dann Kontoname.
// Eigenständiger Baustein: der Assistent bindet ihn als Schritt ein (baueGitHubKarte → { knoten, start }). Ist die Anmeldung in dieser
// Version nicht eingerichtet (keine Client-ID), bleibt der Knoten `hidden` und start() liefert false.
// Das Token sieht die Oberfläche nie: die Werkstatt liefert nur Zustand, Code und Kontoname.
import { h } from "./hilfen.js";
import { api, aktion, inApp } from "./api.js";
import { symbol } from "./symbole.js";
import { TW } from "./texte-willkommen.js";

const T = TW.github;
const TAKT_MS = 2000;

// beiAngemeldet({ login }): einmal, sobald ein Konto angemeldet ist (auch wenn es schon vorher angemeldet war).
export function baueGitHubKarte({ beiAngemeldet } = {}) {
  const inhalt = h("div", { klasse: "w-github-inhalt", "aria-live": "polite" });
  const knoten = h("section", { klasse: "w-aktion w-github", "data-bereich": "github", hidden: true }, inhalt);
  let uhr = null, lebt = true, gemeldet = false;
  const halt = () => { clearTimeout(uhr); uhr = null; };
  const setze = (...k) => inhalt.replaceChildren(...k.filter(Boolean));
  const fehlerBox = (text) => h("div", { klasse: "w-fehlerbox fehlertext", role: "alert" }, symbol("warnung", 15), h("span", { text }));

  const zeigeStart = (meldung) => setze(
    h("h3", { klasse: "w-abschnitt" }, symbol("github", 14), h("span", { text: T.titel })), h("div", { klasse: "w-aktion-text", text: T.text }),
    meldung ? fehlerBox(meldung) : null,
    h("button", { klasse: "knopf primaer", type: "button", "data-aktion": "github-anmelden", text: meldung ? T.nochmal : T.anmelden, aufClick: starte }));

  const zeigeFertig = (login) => {
    setze(h("div", { klasse: "w-ok", "data-zustand": "fertig" }, symbol("kreis-haken", 15), h("span", { text: T.erfolg(login) })),
      h("button", { klasse: "knopf", type: "button", "data-aktion": "github-abmelden", text: T.abmelden, aufClick: abmelden }));
    if (!gemeldet) { gemeldet = true; try { beiAngemeldet?.({ login: login || null }); } catch (e) { console.error(e); } }
  };

  function zeigeWarten(z) {
    const meld = h("div", { klasse: "w-aktion-text", role: "status" });
    const knopf = h("button", { klasse: "knopf primaer", type: "button", "data-aktion": "github-kopieren-oeffnen", text: T.kopierenOeffnen });
    knopf.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(z.code); meld.textContent = T.kopiert; } catch { meld.textContent = T.kopierFehler; }
      if (!(inApp() && aktion("extern", z.url))) window.open(z.url, "_blank", "noopener");
    });
    setze(h("div", { klasse: "w-aktion-text", text: T.anleitung }),
      h("div", { klasse: "w-github-code", "aria-label": T.codeLabel, "data-code": "", text: z.code }),
      knopf, meld,
      h("div", { klasse: "w-arbeit links" }, h("span", { klasse: "w-dreh", "aria-hidden": "true" }), h("span", { text: T.wartet })),
      h("button", { klasse: "knopf", type: "button", "data-aktion": "github-abbrechen", text: T.abbrechen, aufClick: abmelden }));
  }

  async function beobachte() {
    halt();
    if (!lebt) return;
    let z;
    try { z = await api.githubZustand(); } catch { uhr = setTimeout(beobachte, TAKT_MS); return; } // kurz weg (Schlaf, Neustart): weiter versuchen
    if (!lebt) return;
    if (z.zustand === "wartet") { zeigeWarten(z); uhr = setTimeout(beobachte, TAKT_MS); }
    else if (z.zustand === "fertig") zeigeFertig(z.login);
    else if (z.zustand === "abgelaufen") zeigeStart(T.abgelaufen);
    else if (z.zustand === "abgelehnt") zeigeStart(z.grund === "schluesselbund" ? T.abgelehntBund : T.abgelehnt);
    else zeigeStart();
  }

  async function starte() {
    halt();
    try { const r = await api.githubAnmelden(); zeigeWarten(r); uhr = setTimeout(beobachte, TAKT_MS); }
    catch (e) { zeigeStart(e?.message || T.fehler); }
  }
  async function abmelden() {
    halt(); gemeldet = false;
    try { await api.githubAbmelden(); zeigeStart(); } catch (e) { setze(fehlerBox(e?.message || T.fehler)); }
  }

  // Erster Blick: schon angemeldet? Sonst Startzustand. false = Anmeldung nicht eingerichtet (Karte bleibt unsichtbar).
  async function start() {
    let k;
    try { k = await api.githubKonto(); } catch { return false; }
    if (!k?.verfuegbar) { knoten.hidden = true; return false; }
    knoten.hidden = false;
    if (k.angemeldet) zeigeFertig(k.login); else await beobachte();
    return true;
  }
  const zerstoere = () => { lebt = false; halt(); };
  return { knoten, start, zerstoere };
}
