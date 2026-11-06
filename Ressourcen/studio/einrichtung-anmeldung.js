// „Anmelden im Overlay“ (Paket E3): der KI-Schritt der Einrichtung ruft `starteAnmeldung(programm, konto, …)`, wenn ein Programm angemeldet sein muss, bevor es sich verbinden lässt.
// Umsetzung: das Anmelde-Panel aus anmeldung.js (Im Browser anmelden, Link kopieren, Code einfügen, Gerätecode) — ohne Terminal. Der leise Link „Im Terminal anmelden“ im Panel führt auf den
// bisherigen Weg (`baueAnmeldung` aus ki-verbinden.js: Terminal-App mit Abfrage im Hintergrund), dessen Oberfläche dann unter dem Panel steht.
//
// Vertrag (unverändert):
//   starteAnmeldung(programm, konto, { api, wurzel, beiAngemeldet, beiAbbruch }) → { stoppe(), laeuft() }
//     programm  "claude" | "codex" (ANMELDBAR in ki-verbinden.js)
//     konto     Konto aus GET /api/ki/konten ({ id, programm, name, standard, pfad|ordner, … }); neue Konten legt E4 (konto-neu/-fertig/-abbruch) vorher an
//     wurzel    Element in der Zeile, in das die Anmeldung ihre Oberfläche setzt (leer, solange nichts läuft)
//     beiAngemeldet(r)  die Anmeldung ist bestätigt ({ zustand: "angemeldet" }) — danach verbindet die Zeile das Programm
//     beiAbbruch()      der Nutzer bricht ab oder die Zeit ist um — die Zeile geht zurück auf „Verbinden“
import { h } from "./hilfen.js";
import { baueAnmeldung } from "./ki-verbinden.js";
import { starteAnmeldung as starteImFenster } from "./anmeldung.js";

export function starteAnmeldung(programm, konto, { api, wurzel, beiAngemeldet, beiAbbruch } = {}) {
  let aktiv = true, alt = null;
  const leer = () => wurzel?.replaceChildren();
  const ende = (fn, arg) => { if (!aktiv) return; aktiv = false; leer(); try { fn?.(arg); } catch (e) { console.error(e); } };
  const host = h("div", { klasse: "e-anm", "data-bereich": "anmeldung", "data-programm": programm });
  const unten = h("div", { klasse: "e-anm-terminal" });
  wurzel?.replaceChildren(host);

  const panel = starteImFenster(programm, konto.id, {
    host, ordner: konto.standard ? null : (konto.pfad ?? undefined),
    beiZeitablauf: () => ende(beiAbbruch), // die Frist ist um: wie ein Abbruch, die Zeile geht zurück auf „Verbinden“
    // Der bisherige Weg: Terminal öffnen, im Hintergrund nach dem Anmeldestand fragen
    terminal: async () => {
      alt = baueAnmeldung({ api, kt: konto, beiAngemeldet: (r) => ende(beiAngemeldet, r), beiAbbruch: () => ende(beiAbbruch), beiZeit: () => ende(beiAbbruch) });
      unten.append(alt.liste, alt.befehl, alt.fehlerEl, alt.hinweis, h("div", { klasse: "e-anm-knoepfe" }, alt.knoepfe.abbruch, alt.knoepfe.nochmal, alt.knoepfe.jetzt));
      host.append(unten);
      alt.start();
    },
  });
  panel.ergebnis.then((e) => {
    if (e.phase === "ok") ende(beiAngemeldet, { zustand: "angemeldet" });
    else if (e.phase === "abgebrochen") ende(beiAbbruch);
    // phase "terminal": der alte Weg übernimmt (beiAngemeldet/beiAbbruch kommen von ihm)
  });
  return { stoppe: () => { aktiv = false; try { alt?.stoppe(); } catch { /* egal */ } panel.zerstoere(); leer(); }, laeuft: () => aktiv };
}
