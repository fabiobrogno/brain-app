// Kleine DOM-Helfer, Dialoge, Toasts. Kein innerHTML mit fremden Daten.
export function h(tag, attrs, ...kinder) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "klasse") e.className = v;
    else if (k.startsWith("auf")) e.addEventListener(k.slice(3).toLowerCase(), v);
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const k of kinder.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

let dialogZaehler = 0;
// Öffnet einen Dialog. Gibt { schliessen } zurück. Esc schließt.
export function dialog({ titel, rumpf, knoepfe = [], breit = false, beiSchliessen, eigen }) {
  const host = document.getElementById("dialog-host");
  const davor = document.activeElement;
  const id = "dlg" + ++dialogZaehler;
  let box;
  if (eigen) box = eigen;
  else {
    box = h("div", { klasse: "dialog" + (breit ? " breit" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": id },
      h("div", { klasse: "dialog-kopf", id, text: titel }),
      h("div", { klasse: "dialog-rumpf" }, rumpf),
      knoepfe.length ? h("div", { klasse: "dialog-fuss" }, knoepfe) : null);
  }
  const schleier = h("div", { klasse: "schleier" }, box);
  const zu = () => {
    schleier.remove();
    document.removeEventListener("keydown", taste, true);
    beiSchliessen?.();
    if (davor && document.contains(davor)) davor.focus?.();
  };
  const taste = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zu(); }
    else if (e.key === "Tab") {
      const f = [...box.querySelectorAll("button:not(:disabled), input, textarea, select, [tabindex='0']")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  schleier.addEventListener("mousedown", (e) => { if (e.target === schleier) zu(); });
  document.addEventListener("keydown", taste, true);
  host.append(schleier);
  const erst = box.querySelector("[autofocus], input[type=text], textarea, input") || box.querySelector("button.primaer");
  setTimeout(() => erst?.focus(), 0);
  return { schliessen: zu, box };
}
export const dialogOffen = () => !!document.querySelector("#dialog-host .schleier");

export function toast(text, { fehler = false, aktion, ms = 4200 } = {}) {
  const host = document.getElementById("toast-host");
  const t = h("div", { klasse: "toast" + (fehler ? " fehler" : "") }, h("span", { text }),
    aktion ? h("a", { text: aktion.text, role: "button", aufClick: () => { aktion.tun(); t.remove(); } }) : null);
  host.append(t);
  setTimeout(() => t.remove(), fehler ? ms + 2500 : ms);
}

export function vorMinuten(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}
export const dateiName = (pfad) => pfad.split("/").pop();
export const ohneEndung = (n) => n.replace(/\.(md|txt)$/i, "");
export const ordnerVon = (pfad) => (pfad.includes("/") ? pfad.slice(0, pfad.lastIndexOf("/")) : "");
export const istBearbeitbar = (pfad) => /\.(md|txt)$/i.test(pfad);

export function speichereLokal(k, v) { try { localStorage.setItem("brain-studio." + k, JSON.stringify(v)); } catch { /* ohne Speicher */ } }
export function leseLokal(k, fallback) { try { const v = localStorage.getItem("brain-studio." + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } }

// ---- Unscharfe Suche für die Befehlspalette
// Kleinschreibung, Umlaute (ä = ae oder a), Akzente weg, Unterstrich/Bindestrich/Schrägstrich/Punkt = Leerzeichen.
const trenner = (s) => s.replace(/[_\-/.\\]+/g, " ").replace(/\s+/g, " ").trim();
export function suchFormen(s) {
  const klein = String(s || "").normalize("NFC").toLowerCase();
  const ae = klein.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const a = klein.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
  const fix = (t) => trenner(t.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return [...new Set([fix(ae), fix(a)])];
}
// 0 = kein Treffer, 1 = alle Suchwörter beginnen ein Wort, 2 = alle kommen irgendwo vor
export function sucheGrad(text, frage) {
  const woerter = suchFormen(frage)[0].split(" ").filter(Boolean);
  if (!woerter.length) return 0;
  let best = 0;
  const frageFormen = suchFormen(frage);
  for (const q of frageFormen) {
    const ws = q.split(" ").filter(Boolean);
    for (const t of suchFormen(text)) {
      const tw = t.split(" ");
      if (ws.every((w) => tw.some((x) => x.startsWith(w)))) return 1;
      if (ws.every((w) => t.includes(w))) best = 2;
    }
  }
  return best;
}
