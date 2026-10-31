// Das Kortex-Zeichen „Windung“ (Ressourcen/icon-entwuerfe/kortex-3-windung.svg, Zeichenpfad im 1024er-Raster): eine durchgehende Linie in sechs Bahnen.
// Hier liegt nur das Zeichen und seine Ladeanzeige, damit das Studio (Frag, Abgleich) es nutzen kann, ohne den ganzen Assistenten zu laden;
// einrichtung-buehne.js führt es weiter (markeSvg, windungFortschritt, WINDUNG).
export const WINDUNG = "M412 262H618A50 50 0 0 1 618 362H356A50 50 0 0 0 356 462H668A50 50 0 0 1 668 562H356A50 50 0 0 0 356 662H618A50 50 0 0 1 618 762H412";
const SVG = "http://www.w3.org/2000/svg";
export const svgEl = (name, attrs = {}) => { const e = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };

// Das App-Zeichen als SVG (fester Pfad, keine Daten von außen). zeichnen: die Linie zeichnet sich beim Start selbst.
export function markeSvg(groesse = 24, { zeichnen = false } = {}) {
  const svg = svgEl("svg", { class: "e-marke" + (zeichnen ? " zeichnen" : ""), viewBox: "230 200 564 624", width: groesse, height: groesse, "aria-hidden": "true" });
  svg.append(svgEl("path", { pathLength: 1, d: WINDUNG, fill: "none", stroke: "currentColor", "stroke-width": 52, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  return svg;
}

// Ladeanzeige statt Drehkringel (Paket P4, Idee aus Prototyp B): die Windung liegt als feine Spur da, ein Lichtstreifen läuft Bahn für Bahn hindurch.
// Der Lauf ist reines CSS (bewegung.css, .windung-laden); ohne Bewegung steht die Windung ruhig da und atmet nur leise (Lebenszeichen). Die Anzeige trägt keinen Inhalt:
// der Text daneben („Lade …“, „Gleiche ab …“) sagt, was passiert; das Zeichen selbst ist für Screenreader unsichtbar.
export function windungLaden(groesse = 16) {
  const svg = svgEl("svg", { class: "windung-laden sym", viewBox: "230 200 564 624", width: Math.round(groesse * 0.9), height: groesse, "aria-hidden": "true", focusable: "false" });
  const a = { d: WINDUNG, fill: "none", "stroke-width": 58, "stroke-linecap": "round", "stroke-linejoin": "round", pathLength: 1 };
  svg.append(svgEl("path", { ...a, class: "wl-spur" }), svgEl("path", { ...a, class: "wl-lauf" }));
  return svg;
}
