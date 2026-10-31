// Die Bühne des Einrichtungs-Assistenten: rechts entsteht Schritt für Schritt der eigene Kortex. In der Mitte das App-Zeichen (der Vault), rechts die Ordner,
// oben rechts GitHub, links die KI-Programme — mit Linien, die sich zeichnen und (wenn verbunden) Daten fließen lassen. Was noch kommt, steht gestrichelt als
// Platzhalter da; der aktive Teil ist hell, der Rest gedimmt. Das Modul kennt nur ein kleines Ansichtsmodell (`zeige(vm)`), nie den Ablauf.
//
// vm = { schritt, max, fokus: "ordner"|"gh"|"ki"|null, vaultName, vaultOrt,
//        ordner: { schluessel, chips: [{ symbol, text, zahl }] },
//        gh: { zustand: "weg"|"platz"|"start"|"wartet"|"ok"|"lokal", schild: Text, schildSymbol?: "schloss" },
//        ki: { modus: Schlüssel der Liste, programme: [{ id, name, an, stufe, stufeName }], platz: "aus"|"schritt"|"keine", platzText },
//        weicheBewegung: boolean }
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { markenLogo } from "./marken.js";
import { TE } from "./texte-einrichtung.js";

// Kortex-Zeichen „Windung“ (Ressourcen/icon-entwuerfe/kortex-3-windung.svg, Zeichenpfad im 1024er-Raster): eine durchgehende Linie in sechs Bahnen.
export const WINDUNG = "M412 262H618A50 50 0 0 1 618 362H356A50 50 0 0 0 356 462H668A50 50 0 0 1 668 562H356A50 50 0 0 0 356 662H618A50 50 0 0 1 618 762H412";
const SVG = "http://www.w3.org/2000/svg";
const svgEl = (name, attrs = {}) => { const e = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };

// Das App-Zeichen als SVG (fester Pfad, keine Daten von außen). zeichnen: die Linie zeichnet sich beim Start selbst.
export function markeSvg(groesse = 24, { zeichnen = false } = {}) {
  const svg = svgEl("svg", { class: "e-marke" + (zeichnen ? " zeichnen" : ""), viewBox: "230 200 564 624", width: groesse, height: groesse, "aria-hidden": "true" });
  svg.append(svgEl("path", { pathLength: 1, d: WINDUNG, fill: "none", stroke: "currentColor", "stroke-width": 52, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  return svg;
}

// Fortschritt als Windung (Idee aus Prototyp B): die Linie des Zeichens füllt sich Bahn für Bahn, ein Punkt wandert mit. n von 4.
export function windungFortschritt() {
  const svg = svgEl("svg", { class: "e-windung", viewBox: "230 200 564 624", width: 20, height: 22, role: "img" });
  const spur = svgEl("path", { class: "e-windung-spur", d: WINDUNG, fill: "none", "stroke-width": 54, "stroke-linecap": "round", "stroke-linejoin": "round" });
  const zug = svgEl("path", { class: "e-windung-zug", pathLength: 1, d: WINDUNG, fill: "none", "stroke-width": 54, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": "0 1" });
  const punkt = svgEl("circle", { class: "e-windung-punkt", r: 62, cx: 412, cy: 262 });
  svg.append(spur, zug, punkt);
  let stand = 0, lauf = 0;
  const setze = (f) => {
    stand = f;
    zug.setAttribute("stroke-dasharray", `${Math.max(f, 0.0001)} 1`);
    const laenge = spur.getTotalLength();
    const p = spur.getPointAtLength(Math.min(Math.max(f, 0), 1) * laenge);
    punkt.setAttribute("cx", p.x.toFixed(1)); punkt.setAttribute("cy", p.y.toFixed(1));
  };
  return {
    el: svg,
    // n = 1…4 (Schritt), 0 = noch nicht begonnen. ruhig: ohne Übergang.
    setze(n, ruhig = false) {
      const ziel = Math.min(Math.max(n, 0), 4) / 4;
      svg.setAttribute("aria-label", `Fortschritt: ${Math.round(ziel * 4)} von 4`);
      const nr = ++lauf;
      if (ruhig || Math.abs(ziel - stand) < 0.001) { setze(ziel); return; }
      const von = stand, t0 = performance.now(), dauer = 700;
      const frame = (t) => {
        if (nr !== lauf) return;
        const k = Math.min((t - t0) / dauer, 1), e = 1 - Math.pow(1 - k, 4); // ease-out
        setze(von + (ziel - von) * e);
        if (k < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
  };
}

const ysFuer = (n) => (n <= 1 ? [44] : n === 2 ? [32, 58] : n === 3 ? [22, 44, 66] : [16, 34, 52, 70]);

export function erzeugeBuehne(wurzel, { fensterEl }) {
  const win = fensterEl;
  wurzel.replaceChildren();
  const zeichen = h("div", { klasse: "e-app-zeichen", id: "app-zeichen" }, markeSvg(60, { zeichnen: true }));
  const vName = h("b", { id: "v-name", text: "Kortex" });
  const vOrt = h("span", { id: "v-ort", text: "~/Kortex" });
  const vault = h("div", { klasse: "e-knoten e-vault", id: "k-vault" }, zeichen, h("div", { klasse: "e-vault-schild" }, vName, vOrt));
  const ordnerEl = h("div", { id: "k-ordner" });
  const ghKachel = h("div", { klasse: "e-gh-kachel", id: "gh-kachel" });
  const ghSchild = h("div", { klasse: "e-gh-schild", id: "gh-schild" });
  const gh = h("div", { klasse: "e-knoten e-gh versteckt", id: "k-gh", "data-zustand": "weg" }, ghKachel, ghSchild);
  const kiEl = h("div", { id: "k-ki" });
  const platzText = h("span", { klasse: "e-platz-text", text: "Schritt 3" });
  const kiPlatz = h("div", { klasse: "e-knoten e-ki e-ki-platz platzhalter versteckt", id: "k-ki-platz", "data-linie": "kplatz", style: "--y:44" },
    h("div", { klasse: "e-ki-kachel" }, symbol("gehirn", GROESSE_KI)), h("span", { klasse: "e-ki-n", text: TE.platzhalterStufe.ki }), platzText);
  const svg = svgEl("svg", { class: "e-linien", id: "linien", "aria-hidden": "true" });
  wurzel.append(h("div", { klasse: "e-raster" }), h("div", { klasse: "e-glut" }), h("div", { klasse: "e-orbit" }), h("div", { klasse: "e-orbit o2" }), svg, vault, ordnerEl, gh, kiEl, kiPlatz);

  let ordnerSchluessel = null;
  let kiSchluessel = null;
  let letzt = null;

  function zeige(vm) {
    letzt = vm;
    wurzel.dataset.step = String(vm.schritt);
    win.dataset.step = String(vm.schritt);
    if (vm.fokus) wurzel.dataset.fokus = vm.fokus; else delete wurzel.dataset.fokus;
    vName.textContent = vm.vaultName;
    vOrt.textContent = vm.vaultOrt;

    // Ordner (rechts)
    if (vm.ordner.schluessel !== ordnerSchluessel) {
      ordnerSchluessel = vm.ordner.schluessel;
      const chips = vm.ordner.chips;
      ordnerEl.replaceChildren(...chips.map((c, i) => h("div", { klasse: "e-knoten e-ordner", "data-linie": `o${i}`, style: `--y:${chips.length === 1 ? 70 : 56 + i * 13}` },
        h("span", { klasse: "e-chip pop", style: `animation-delay:${i * 70}ms` }, symbol(c.symbol, 14), c.text, c.zahl !== "" && c.zahl !== undefined ? h("span", { klasse: "e-n", text: ` ${c.zahl}` }) : null))));
    }
    ordnerEl.querySelectorAll(".e-knoten").forEach((k) => {
      k.classList.toggle("versteckt", vm.schritt < 1);
      k.classList.toggle("gedimmt", !!vm.fokus && vm.fokus !== "ordner");
    });

    // GitHub (oben rechts)
    const z = vm.gh.zustand;
    gh.classList.toggle("versteckt", z === "weg");
    gh.classList.toggle("platzhalter", z === "platz");
    gh.classList.toggle("gedimmt", !!vm.fokus && vm.fokus !== "gh");
    gh.dataset.zustand = z;
    const ghZeichen = z === "lokal" ? symbol("laptop", 24) : z === "platz" ? symbol("wolke-hoch", 20) : markenLogo("github", 24, { dekorativ: true });
    ghKachel.replaceChildren(ghZeichen);
    ghSchild.replaceChildren(...(vm.gh.schildSymbol ? [symbol(vm.gh.schildSymbol, 12)] : []), vm.gh.schild || "");

    // KI (links)
    const ki = vm.ki;
    if (ki.modus !== kiSchluessel) {
      kiSchluessel = ki.modus;
      const ys = ysFuer(ki.programme.length);
      kiEl.replaceChildren(...ki.programme.map((p, i) => h("div", { klasse: "e-knoten e-ki versteckt", "data-ki": p.id, "data-linie": `k${p.id}`, style: `--y:${ys[i]}` },
        h("div", { klasse: "e-ki-kachel" }, kiLogo(p.id, GROESSE_KI, { dekorativ: true })), h("span", { klasse: "e-ki-n", text: p.name }), h("span", { klasse: "e-badge brand e-stufe" }))));
    }
    for (const k of kiEl.querySelectorAll(".e-ki")) {
      const p = ki.programme.find((x) => x.id === k.dataset.ki);
      if (!p) continue;
      const sichtbar = vm.schritt >= 3 || vm.max >= 3;
      k.classList.toggle("versteckt", !sichtbar);
      k.classList.toggle("an", p.an && sichtbar);
      k.classList.toggle("gedimmt", !!vm.fokus && vm.fokus !== "ki");
      k.querySelector(".e-stufe").textContent = p.stufeName;
    }
    kiPlatz.classList.toggle("versteckt", ki.platz === "aus");
    platzText.textContent = ki.platz === "keine" ? TE.ki.platzKeine : TE.ki.platzSchritt;
    kiPlatz.classList.toggle("gedimmt", !!vm.fokus && vm.fokus !== "ki");
    linienBald();
  }

  // Linien: Bézier von der Mitte des Vault-Zeichens zu jedem Knoten, in Pixeln (folgt dem Layout in jedem Frame)
  function zeichneLinien() {
    if (!letzt) return;
    const vm = letzt;
    const r = wurzel.getBoundingClientRect();
    const v = zeichen.getBoundingClientRect();
    const vx = v.left + v.width / 2 - r.left, vy = v.top + v.height / 2 - r.top;
    const ziele = [...wurzel.querySelectorAll("[data-linie]")];
    if (!gh.classList.contains("versteckt")) ziele.push(gh);
    const gesehen = new Set();
    for (const el of ziele) {
      const id = el.dataset.linie || "gh";
      gesehen.add(id);
      const kachel = el.querySelector(".e-ki-kachel, .e-gh-kachel, .e-chip") || el;
      const b = kachel.getBoundingClientRect();
      const tx = b.left + b.width / 2 - r.left, ty = b.top + b.height / 2 - r.top;
      const links = tx < vx;
      const sx = vx + (links ? -v.width / 2 : v.width / 2) * 0.92, sy = vy;
      const ex = links ? b.right - r.left : b.left - r.left, ey = ty;
      const mx = (sx + ex) / 2;
      const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} C${mx.toFixed(1)} ${sy.toFixed(1)} ${mx.toFixed(1)} ${ey.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      let g = svg.querySelector(`g[data-id="${CSS.escape(id)}"]`);
      if (!g) {
        g = svgEl("g", { "data-id": id });
        g.append(svgEl("path", { class: "e-basis neu", pathLength: 1 }), svgEl("path", { class: "e-fluss", pathLength: 1 }));
        svg.append(g);
        setTimeout(() => g.querySelector(".e-basis").classList.remove("neu"), 900);
      }
      g.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
      const sichtbar = !el.classList.contains("versteckt") && vm.schritt > 0;
      const aktiv = (id.startsWith("k") && el.classList.contains("an")) || (id === "gh" && el.dataset.zustand === "ok") || (id.startsWith("o") && vm.schritt >= 1 && (vm.schritt === 1 || vm.schritt === 4 || vm.max > 1));
      g.classList.toggle("aus", !sichtbar);
      g.classList.toggle("aktiv", aktiv);
      g.classList.toggle("fliesst", aktiv && (vm.schritt === 4 || (id === "gh" && vm.schritt === 2) || (id.startsWith("k") && vm.schritt === 3)));
      g.style.opacity = sichtbar && el.classList.contains("gedimmt") ? 0.35 : "";
      g.classList.toggle("platz", el.classList.contains("platzhalter"));
    }
    svg.querySelectorAll("g[data-id]").forEach((g) => { if (!gesehen.has(g.dataset.id)) g.remove(); });
  }
  let linienBis = 0;
  function linienBald(ms = 1000) {
    const start = !linienBis || performance.now() > linienBis;
    linienBis = Math.max(linienBis, performance.now() + ms);
    if (start) requestAnimationFrame(function tick() { zeichneLinien(); if (performance.now() < linienBis) requestAnimationFrame(tick); else linienBis = 0; });
  }
  new ResizeObserver(() => linienBald(200)).observe(wurzel);

  return { zeige, linienBald, zeichen };
}

const GROESSE_KI = 20;
