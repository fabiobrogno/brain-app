// Bewegung mit Bedeutung (Paket P4): der eine Ort für alles, was sich im Studio bewegt. Dauern und Kurven kommen aus den Tokens in studio.css
// (--d-1 … --d-6, --ease-out, --ease-feder), nie aus festen Zahlen; „Bewegung reduzieren“ (System oder Einstellung) setzt sie auf 0 ms, dann tun die Helfer hier nichts.
//
// Grundregeln:
//  1. Inhalt hängt nie an einer Animation. Jede Bewegung ist Zugabe: der Endzustand steht im normalen Stil, nie erst nach `animationend`, `transitionend` oder einem Bild (rAF).
//     WebKit pausiert Animationen und rAF in einem Fenster, das nicht sichtbar ist; darum gibt es das Ruhenetz (unten), das stehengebliebene Animationen zu Ende setzt.
//  2. Es bewegen sich nur transform und opacity (Ausnahme: das Zuklappen eines gelöschten Eintrags, eine einzelne Höhe für ~200 ms).
//  3. Die Helfer lesen Layout nur einmal vorab und schreiben dann gesammelt (kein Hin und Her).
import { h } from "./hilfen.js";
import { wenigBewegung } from "./popover.js";
import { symbol } from "./symbole.js";

export const ruhig = wenigBewegung;
const stil = () => getComputedStyle(document.documentElement);
// Dauer eines Tokens in ms (0 bei „Bewegung reduzieren“)
export const dauer = (token = "--d-2") => { const w = parseFloat(stil().getPropertyValue(token)); return Number.isFinite(w) ? w : 0; };
export const kurve = (token = "--ease-out") => stil().getPropertyValue(token).trim() || "ease-out";

// Spielt eine Web-Animation mit Tokens ab; liefert die Animation oder null (ohne Bewegung / ohne Unterstützung).
// fuellen "backwards": vor dem Start gilt der Anfangszustand (Verzögerung), danach der normale Stil.
export function spiele(el, keyframes, { d = "--d-2", e = "--ease-out", verzug = 0, fuellen = "backwards" } = {}) {
  if (!el || typeof el.animate !== "function" || ruhig()) return null;
  const ms = dauer(d);
  if (ms <= 0) return null;
  try { return el.animate(keyframes, { duration: ms, easing: kurve(e), delay: verzug, fill: fuellen }); } catch { return null; }
}

// ======================================================= Ruhenetz
// Ein Fenster, das nicht sichtbar ist (verdeckt, minimiert, noch nicht in den Vordergrund geholt), pausiert in WebKit Animationen und requestAnimationFrame.
// Eine Einblend-Animation (Anfang: Deckkraft 0) bliebe dann am Anfang stehen, der Inhalt wäre unsichtbar. Das Ruhenetz sieht nach, ob eine endliche Animation
// vorankommt; kommt sie nicht voran, setzt es sie zu Ende (der Endzustand ist immer der normale Stil des Elements). Läuft alle 500 ms und bei Sichtbarkeits-/Fokuswechsel.
// Dauerläufer (Drehen, Schimmern) bleiben unberührt.
let netzAn = false;
export function ruhenetz() {
  if (netzAn || typeof document.getAnimations !== "function") return;
  netzAn = true;
  const gesehen = new WeakMap();
  const pruefe = () => {
    const jetzt = performance.now();
    for (const a of document.getAnimations()) {
      let t;
      try { t = a.effect?.getComputedTiming(); } catch { continue; }
      if (!t || t.iterations === Infinity || t.endTime === Infinity || a.playState === "finished" || a.playState === "idle") continue;
      const zeit = Number(a.currentTime) || 0;
      const g = gesehen.get(a) || { w: jetzt, z: zeit };
      gesehen.set(a, g);
      const vergangen = jetzt - g.w, vorangekommen = zeit - g.z;
      // stehengeblieben: nach 0,6 s wirklicher Zeit weniger als ein Drittel davon gespielt, oder weit über die eigene Länge hinaus
      // Ein verborgenes Dokument (Fenster nicht sichtbar) spielt nichts ab: dort gilt sofort der Endzustand
      if (document.hidden || (vergangen > 600 && vorangekommen < vergangen * 0.34) || vergangen > t.endTime + 2000) { try { a.finish(); } catch { try { a.cancel(); } catch { /* weg */ } } }
    }
  };
  setInterval(pruefe, 500);
  for (const [ziel, ereignis] of [[document, "visibilitychange"], [window, "focus"], [window, "pageshow"]]) ziel.addEventListener(ereignis, () => setTimeout(pruefe, 700));
}

// ======================================================= Hüpfen, Landen, Einblenden, Zuklappen
// Zähler hüpft (Posteingang bekommt etwas): kurz größer, federnd zurück.
export function huepfe(el) {
  return spiele(el, [{ transform: "scale(1)" }, { transform: "scale(1.5)", offset: 0.35 }, { transform: "scale(1)" }], { d: "--d-3", e: "--ease-feder", fuellen: "none" });
}
// Karte landet federnd in ihrer Spalte: ein kleiner Sprung nach oben und zurück, dazu ein Leuchtring.
export function lande(el) {
  return spiele(el, [{ transform: "scale(1.04)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--akzent) 30%, transparent)" }, { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" }], { d: "--d-4", e: "--ease-feder", fuellen: "none" });
}
// Neuer Eintrag in einer Liste: Einblenden mit kleinem Versatz.
export function blendeEin(el, verzug = 0) {
  return spiele(el, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { d: "--d-2", verzug });
}
// Gelöschter Eintrag: die Hülle (Kopie des Eintrags) klappt in der Höhe zu und blendet aus; danach ist sie weg (Timer, nicht an das Ende der Animation gebunden).
export function klappeZu(huelle, hoehe) {
  const ms = dauer("--d-2");
  if (ruhig() || ms <= 0 || !huelle || typeof huelle.animate !== "function") { huelle?.remove(); return; }
  try { huelle.animate([{ height: hoehe + "px", opacity: 1 }, { height: "0px", opacity: 0 }], { duration: ms, easing: kurve("--ease-out"), fill: "forwards" }); } catch { /* der Timer räumt auf */ }
  setTimeout(() => huelle.remove(), ms + 40);
}

// Etwas fliegt von einer Stelle zu einem Ziel (erfasste Notiz → Posteingang). von: Element oder Rechteck. Gezeichnet wird eine kleine Marke mit dem Text.
// beiAnkunft kommt von einem Timer (nicht von der Animation) und läuft auch ohne Bewegung (sofort).
export function fliege(von, ziel, { text = "", symbolName = "notiz", beiAnkunft } = {}) {
  const ms = dauer("--d-4");
  if (ruhig() || ms <= 0 || !ziel || !ziel.isConnected || typeof Element.prototype.animate !== "function") { beiAnkunft?.(); return null; }
  const a = von.getBoundingClientRect ? von.getBoundingClientRect() : von, z = ziel.getBoundingClientRect();
  const chip = h("div", { klasse: "flug-chip", "aria-hidden": "true" }, symbol(symbolName, 14), h("span", { text: String(text).slice(0, 40) }));
  document.body.append(chip);
  const b = chip.getBoundingClientRect();
  const ax = a.left + a.width / 2 - b.width / 2, ay = a.top + a.height / 2 - b.height / 2;
  const zx = z.left + z.width / 2 - b.width / 2, zy = z.top + z.height / 2 - b.height / 2;
  const bogen = Math.min(120, Math.abs(zy - ay) * 0.35 + 24);
  const f = (x, y, s, o) => ({ transform: `translate(${x}px, ${y}px) scale(${s})`, opacity: o });
  try {
    chip.animate([f(ax, ay, 1, 0), { ...f(ax + (zx - ax) * 0.2, ay + (zy - ay) * 0.15 - bogen, 1, 1), offset: 0.22 }, { ...f(zx + (ax - zx) * 0.1, zy - 4, 0.8, 1), offset: 0.85 }, f(zx, zy, 0.3, 0)],
      { duration: ms * 1.4, easing: kurve("--ease-out"), fill: "both" });
  } catch { /* der Timer räumt auf */ }
  setTimeout(() => { chip.remove(); beiAnkunft?.(); }, ms * 1.4 - 40);
  return chip;
}

// ======================================================= Antwort Wort für Wort
// Blendet in einem fertig gebauten Baum (Markdown der Antwort) alle Wörter ein, die hinter dem Zeichen `ab` liegen (Zeichen des reinen Textes); schon gezeigte bleiben still.
// Es wird nichts verzögert: der Text steht sofort im DOM, nur die Deckkraft der neuen Wörter läuft über wenige Millisekunden auf (gestaffelt, höchstens `fenster` ms insgesamt).
// Gibt die Länge des Textes zurück (der nächste Aufruf bekommt sie als `ab`). Ohne Bewegung: nichts wird verpackt.
export function worteEinblenden(wurzel, ab, { fenster = 180 } = {}) {
  const gesamt = wurzel.textContent.length;
  if (ruhig() || dauer("--d-2") <= 0 || ab >= gesamt) return gesamt;
  const neu = [];
  let versatz = 0;
  const gehe = (n) => {
    for (const k of [...n.childNodes]) {
      if (k.nodeType === 3) { const ende = versatz + k.nodeValue.length; if (ende > ab && k.nodeValue.trim()) neu.push({ k, von: Math.max(0, ab - versatz) }); versatz = ende; }
      else if (k.nodeType === 1) { if (k.tagName === "PRE") versatz += k.textContent.length; else gehe(k); }
    }
  };
  gehe(wurzel);
  const woerter = neu.reduce((s, { k, von }) => s + (k.nodeValue.slice(von).match(/\S+/g) || []).length, 0);
  if (!woerter) return gesamt;
  const schritt = Math.min(28, fenster / woerter);
  let i = 0;
  for (const { k, von } of neu) {
    const t = k.nodeValue, teile = t.slice(von).split(/(\s+)/), frag = document.createDocumentFragment();
    if (von > 0) frag.append(document.createTextNode(t.slice(0, von)));
    for (const w of teile) {
      if (!w) continue;
      if (/^\s+$/.test(w)) frag.append(document.createTextNode(w));
      else { const s = document.createElement("span"); s.className = "wort-neu"; s.style.animationDelay = Math.round(i++ * schritt) + "ms"; s.textContent = w; frag.append(s); }
    }
    k.replaceWith(frag);
  }
  return gesamt;
}

// ======================================================= Scrollkanten
// Wo ein Bereich weiter scrollen lässt, läuft der Inhalt zur Kante hin aus (data-kante="oben|unten|beide"; Stil: bewegung.css). Gilt für alle Elemente mit data-kanten
// (auch später entstandene). Gelesen wird scrollTop/scrollHeight einmal je Änderung, geschrieben nur ein Attribut.
const kantenGesehen = new WeakSet();
function kantenAn(el) {
  if (kantenGesehen.has(el)) return;
  kantenGesehen.add(el);
  let wartet = false;
  const lauf = () => {
    wartet = false;
    const oben = el.scrollTop > 2, unten = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
    const w = oben && unten ? "beide" : oben ? "oben" : unten ? "unten" : "";
    if (w) { if (el.dataset.kante !== w) el.dataset.kante = w; } else if (el.dataset.kante) delete el.dataset.kante;
  };
  const plane = () => { if (!wartet) { wartet = true; setTimeout(lauf, 0); } };
  el.addEventListener("scroll", plane, { passive: true });
  if (typeof ResizeObserver === "function") new ResizeObserver(plane).observe(el);
  new MutationObserver(plane).observe(el, { childList: true });
  plane();
}
export function kantenInstallieren() {
  const suche = () => document.querySelectorAll("[data-kanten]").forEach(kantenAn);
  suche();
  let t = 0;
  new MutationObserver(() => { if (!t) t = setTimeout(() => { t = 0; suche(); }, 120); }).observe(document.body, { childList: true, subtree: true });
}

// ======================================================= Tooltips für Symbolknöpfe
// Jeder Knopf mit `title` (ohne Text, nur Symbol) bekommt statt des trägen System-Tooltips den eigenen (.bs-tipp): nach 500 ms bei der Maus, sofort bei Tastaturfokus.
// Das `title` wird nur solange der Tooltip gezeigt wird entfernt (kein doppelter) und danach wieder gesetzt; der zugängliche Name bleibt (aria-label wird bei Bedarf ergänzt).
let tippEl = null, tippTimer = 0, tippAnker = null;
function tippWeg() {
  clearTimeout(tippTimer);
  tippEl?.remove(); tippEl = null;
  if (tippAnker && tippAnker.dataset.tippText != null) { tippAnker.setAttribute("title", tippAnker.dataset.tippText); delete tippAnker.dataset.tippText; }
  tippAnker = null;
}
function tippZeige(el) {
  const text = el.getAttribute("title") || el.dataset.tippText;
  if (!text || !el.isConnected) return;
  tippWeg();
  if (!el.getAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", text);
  el.dataset.tippText = text; el.removeAttribute("title"); tippAnker = el;
  tippEl = h("div", { klasse: "bs-tipp", role: "tooltip", text });
  (document.getElementById("menue-host") || document.body).append(tippEl);
  const r = el.getBoundingClientRect(), bw = tippEl.offsetWidth, bh = tippEl.offsetHeight;
  const unten = r.top - bh - 8 < 8;
  tippEl.style.left = Math.round(Math.max(8, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 8))) + "px";
  tippEl.style.top = Math.round(unten ? r.bottom + 8 : r.top - bh - 8) + "px";
  tippEl.getBoundingClientRect();
  tippEl.classList.add("offen");
}
export function tippsInstallieren() {
  const ziel = (e) => { const t = e.target instanceof Element ? e.target.closest("button[title], [role=button][title], a[title], [data-tipp-text]") : null; return t && !t.closest(".menue, .bs-liste") ? t : null; };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const t = ziel(e);
    if (!t || t === tippAnker) return;
    tippWeg(); clearTimeout(tippTimer);
    tippTimer = setTimeout(() => tippZeige(t), 500);
  });
  document.addEventListener("pointerout", (e) => { const t = ziel(e); if (t && !t.contains(e.relatedTarget)) tippWeg(); });
  document.addEventListener("pointerdown", tippWeg, true);
  document.addEventListener("focusin", (e) => { const t = ziel(e); if (t && t.matches(":focus-visible")) tippZeige(t); });
  document.addEventListener("focusout", tippWeg);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") tippWeg(); }, true);
  window.addEventListener("blur", tippWeg);
}
