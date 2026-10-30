// Popover-Motor für alle schwebenden Flächen des Studios (Menüs, Auswahllisten, Datumsauswahl, Tooltips teilen sich nur die Maße).
// Eine Fläche ist gleichzeitig offen. Der Motor setzt die Fläche an den Anker (nach unten, bei Platzmangel nach oben), blendet sie ein
// (Übergang statt Sprung), schließt bei Klick daneben, Esc, Fenster-Blur, Größenänderung und Scrollen außerhalb und gibt den Fokus zurück.
// Beim Schließen bleibt für ~110 ms ein „Geist“ (Kopie ohne data-/id-/role-/aria-Attribute und ohne die Klasse .menue) stehen, der ausblendet:
// so bleibt nie ein zweites, ansprechbares Menü im DOM, wenn sofort das nächste aufgeht.
// Keine Importe aus hilfen.js (hilfen.js fragt popoverOffen() ab → sonst ein Zyklus).

let aktiv = null;
export const popoverOffen = () => !!aktiv;
export const popoverAnker = () => aktiv?.anker ?? null;
export const schliessePopover = (fokus = false) => aktiv?.zu(fokus);
export const wenigBewegung = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const GEIST_MS = 110;
const ENTSCHAERFT = /^(data-|aria-|id$|role$|name$|for$|tabindex$|href$)/;

function geist(box) {
  const klon = box.cloneNode(true);
  for (const e of [klon, ...klon.querySelectorAll("*")]) for (const a of [...e.attributes]) if (ENTSCHAERFT.test(a.name)) e.removeAttribute(a.name);
  klon.classList.add("offen"); // Ausgangszustand des Geists: sichtbar; beim Ausblenden fällt „offen“ weg
  if (klon.classList.contains("menue")) klon.classList.replace("menue", "menue-geist");
  klon.classList.add("bs-geist");
  klon.setAttribute("aria-hidden", "true");
  klon.inert = true;
  return klon;
}

// anker: Element, an dem die Fläche hängt (bekommt aria-expanded). box: die fertige Fläche.
// Optionen: rechts (rechtsbündig zum Anker), oben (bevorzugt über dem Anker), gleicheBreite, minBreite, abstand, beiZu(), beiTaste(ev) → true wenn behandelt,
// tabSchliesst (Standard ja), fokusVerlustSchliesst (Standard nein), fokusZurueck (Standard ja).
export function oeffnePopover(anker, box, o = {}) {
  schliessePopover();
  const { rechts = false, oben = false, gleicheBreite = false, minBreite, abstand = 6, beiZu, beiTaste, tabSchliesst = true, fokusVerlustSchliesst = false, fokusZurueck = true } = o;
  const host = document.getElementById("menue-host") || document.body;
  box.classList.add("bs-pop");
  host.append(box);
  if (gleicheBreite) box.style.minWidth = Math.round(anker.getBoundingClientRect().width) + "px";
  else if (minBreite) box.style.minWidth = minBreite + "px";

  const platz = () => {
    const a = anker.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let x = rechts ? a.right - bw : a.left;
    x = Math.max(8, Math.min(x, window.innerWidth - bw - 8));
    const passtUnten = a.bottom + abstand + bh <= window.innerHeight - 8;
    const passtOben = a.top - abstand - bh >= 8;
    const unten = oben ? !passtOben : passtUnten || !passtOben;
    let y = unten ? a.bottom + abstand : a.top - abstand - bh;
    y = Math.max(8, Math.min(y, window.innerHeight - bh - 8));
    box.style.left = Math.round(x) + "px";
    box.style.top = Math.round(y) + "px";
    box.style.transformOrigin = `${Math.round(Math.min(Math.max(a.left + a.width / 2 - x, 12), bw - 12))}px ${unten ? "0" : "100%"}`;
    box.dataset.seite = unten ? "unten" : "oben";
  };
  platz();
  anker.setAttribute?.("aria-expanded", "true");
  box.getBoundingClientRect(); // Ausgangszustand festschreiben, dann einblenden
  box.classList.add("offen");

  const taste = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); zu(true); return; }
    if (ev.key === "Tab" && tabSchliesst) { zu(); return; }
    if (beiTaste?.(ev)) { ev.preventDefault(); ev.stopPropagation(); }
  };
  const aussen = (ev) => { if (!box.contains(ev.target) && !anker.contains?.(ev.target)) zu(); };
  const scroll = (ev) => { if (!box.contains(ev.target)) zu(); };
  const zuFenster = () => zu();
  const fokusWeg = (ev) => { if (ev.relatedTarget && !box.contains(ev.relatedTarget) && !anker.contains?.(ev.relatedTarget)) zu(); };
  document.addEventListener("keydown", taste, true);
  document.addEventListener("pointerdown", aussen, true);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("blur", zuFenster);
  window.addEventListener("resize", zuFenster);
  if (fokusVerlustSchliesst) box.addEventListener("focusout", fokusWeg);

  function zu(fokus = false) {
    if (aktiv?.box !== box) return;
    aktiv = null;
    document.removeEventListener("keydown", taste, true);
    document.removeEventListener("pointerdown", aussen, true);
    document.removeEventListener("scroll", scroll, true);
    window.removeEventListener("blur", zuFenster);
    window.removeEventListener("resize", zuFenster);
    anker.setAttribute?.("aria-expanded", "false");
    const klon = wenigBewegung() ? null : geist(box);
    box.remove();
    if (klon) {
      klon.style.cssText = box.style.cssText;
      host.append(klon);
      klon.getBoundingClientRect();
      klon.classList.remove("offen");
      klon.classList.add("zu");
      setTimeout(() => klon.remove(), GEIST_MS + 20);
    }
    if (fokus && fokusZurueck) anker.focus?.({ preventScroll: true });
    beiZu?.();
  }
  aktiv = { box, anker, zu };
  return { zu, box, platz };
}
