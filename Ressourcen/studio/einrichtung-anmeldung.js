// HAKEN „Anmelden im Overlay“ (Paket E3 setzt hier an). Der KI-Schritt der Einrichtung ruft `starteAnmeldung(programm, konto, …)`, wenn ein Programm angemeldet sein muss, bevor es sich
// verbinden lässt. Dieses Modul ist die EINZIGE Stelle, die E3 ersetzt: die Zeile im KI-Schritt kennt nur den Vertrag unten.
//
// Vertrag:
//   starteAnmeldung(programm, konto, { api, wurzel, beiAngemeldet, beiAbbruch }) → { stoppe(), laeuft() }
//     programm  "claude" | "codex" (ANMELDBAR in ki-verbinden.js)
//     konto     Konto aus GET /api/ki/konten ({ id, programm, name, standard, pfad|ordner, … })
//     wurzel    Element in der Zeile, in das die Anmeldung ihre Oberfläche setzt (leer, solange nichts läuft)
//     beiAngemeldet(r)  die Anmeldung ist bestätigt ({ zustand: "angemeldet" }) — danach verbindet die Zeile das Programm
//     beiAbbruch()      der Nutzer bricht ab oder die Zeit ist um — die Zeile geht zurück auf „Verbinden“
//
// Heutiger Weg (bis E3): die bestehende Anmeldung über die Terminal-App mit Abfrage im Hintergrund (`baueAnmeldung`, auch in den Einstellungen im Einsatz).
import { h } from "./hilfen.js";
import { baueAnmeldung } from "./ki-verbinden.js";

export function starteAnmeldung(programm, konto, { api, wurzel, beiAngemeldet, beiAbbruch } = {}) {
  const a = baueAnmeldung({ api, kt: konto,
    beiAngemeldet: (r) => { wurzel?.replaceChildren(); beiAngemeldet?.(r); },
    beiAbbruch: () => { wurzel?.replaceChildren(); beiAbbruch?.(); } });
  const karte = h("div", { klasse: "e-anm", "data-bereich": "anmeldung", "data-programm": programm }, a.liste, a.befehl, a.fehlerEl, a.hinweis,
    h("div", { klasse: "e-anm-knoepfe" }, a.knoepfe.abbruch, a.knoepfe.nochmal, a.knoepfe.jetzt));
  wurzel?.replaceChildren(karte);
  a.start();
  return { stoppe: () => { a.stoppe(); wurzel?.replaceChildren(); }, laeuft: () => a.laeuft() };
}
