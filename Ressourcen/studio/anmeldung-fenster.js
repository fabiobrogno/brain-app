// „Im Browser anmelden“ in den Einstellungen und im Ablauf „KI verbinden“ (Paket E3, zweiter Teil): `baueAnmeldungImFenster` hat dieselbe Form wie `baueAnmeldung` (ki-verbinden.js:
// liste, befehl, hinweis, fehlerEl, knoepfe, start, stoppe, laeuft, zustand), setzt aber zuerst das Panel aus anmeldung.js ein (`panelEl`, vom Aufrufer zusätzlich eingehängt).
// Rückfall auf den bisherigen Weg (Terminal, Abfrage im Hintergrund), dessen Elemente dann erscheinen: wenn die Werkstatt die Anmeldung im Fenster nicht starten kann (Programm nicht gefunden,
// Route fehlt, Fehler beim Start), oder wenn der Nutzer im Panel „Im Terminal anmelden“ wählt. Die Elemente des alten Wegs bleiben bis dahin verborgen (Klasse an-aus).
import { h } from "./hilfen.js";
import { starteAnmeldung as starteImFenster } from "./anmeldung.js";

export function baueAnmeldungImFenster({ baueAlt, api, kt, pruefe, beiAngemeldet, beiAbbruch, beiZeit, abbruchText } = {}) {
  const alt = baueAlt({ api, kt, ...(pruefe ? { pruefe } : {}), beiAngemeldet, beiAbbruch, beiZeit, ...(abbruchText ? { abbruchText } : {}) });
  const altEls = () => [alt.liste, alt.befehl, alt.hinweis, alt.fehlerEl, alt.knoepfe.abbruch, alt.knoepfe.nochmal, alt.knoepfe.jetzt];
  const verberge = (an) => { for (const e of altEls()) e.classList.toggle("an-aus", an); };
  const panelEl = h("div", { klasse: "an-wirt", "data-kv-panel": "" });
  let panel = null, aktiv = false;
  const zumTerminal = () => { verberge(false); alt.start(); };
  const beende = (fn, arg) => { if (!aktiv) return; aktiv = false; try { fn?.(arg); } catch (e) { console.error(e); } };

  function start() {
    stoppe(); aktiv = true; verberge(true); panelEl.replaceChildren(); panelEl.hidden = false;
    let p = null;
    try {
      p = panel = starteImFenster(kt.programm, kt.id, {
        host: panelEl, ordner: kt.standard ? null : (kt.pfad ?? undefined),
        beiZeitablauf: () => beende(beiZeit || beiAbbruch),
        beiRueckfall: () => { if (panel === p) { panel = null; p.zerstoere(); panelEl.hidden = true; zumTerminal(); } }, // die Werkstatt kann es im Fenster nicht: gleich der bisherige Weg
        terminal: async () => { zumTerminal(); },
      });
    } catch { panelEl.hidden = true; zumTerminal(); return; }
    const mein = p;
    mein.ergebnis.then(async (e) => {
      if (panel !== mein || !aktiv) return;
      if (e.phase === "ok") { try { await pruefe?.(kt); } catch { /* der Anmeldestand wird beim nächsten Neuzeichnen gelesen */ } beende(beiAngemeldet, { zustand: "angemeldet" }); }
      else if (e.phase === "abgebrochen") beende(beiAbbruch);
      // phase „terminal“: der alte Weg übernimmt (er ruft beiAngemeldet/beiAbbruch/beiZeit selbst)
    });
  }
  function stoppe() { aktiv = false; try { alt.stoppe(); } catch { /* egal */ } if (panel) { const p = panel; panel = null; p.zerstoere(); } }
  return { liste: alt.liste, befehl: alt.befehl, hinweis: alt.hinweis, fehlerEl: alt.fehlerEl, knoepfe: alt.knoepfe, panelEl, start, stoppe, laeuft: () => aktiv || alt.laeuft(), zustand: alt.zustand };
}
