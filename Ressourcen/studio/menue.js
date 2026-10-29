// Kleines Popover-Menü: Eintragsliste, Tastatur (↑↓ Enter Esc), schließt bei Klick daneben. Kein innerHTML mit fremden Daten.
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";

// Vault-Farbe (aus der Vault-Liste, also Daten): nur #RRGGBB oder var(--akzent), direkt als CSS-Variable gesetzt
const vaultFarbe = (farbe) => {
  const el = h("span", { klasse: "m-farbe" });
  if (/^#[0-9a-fA-F]{6}$/.test(String(farbe))) el.style.setProperty("--vault-farbe", farbe);
  return el;
};

let offen = null;
export const menueOffen = () => !!offen;
export function schliesseMenue() { offen?.zu(); }

// eintraege: [{ name, symbol?, logo? (KI-Logo, ki-logos.js), farbe?, sub?, haken?, gefahr?, tun?, daten? } | { trenner:true } | { gruppe:"Text" } | { leer:"Text" } | { segmente:[{name, symbol?, aktiv, tun}] }]
export function oeffneMenue(anker, eintraege, { rechts = false, oben = false, breite, beiZu, klasse = "" } = {}) {
  schliesseMenue();
  const host = document.getElementById("menue-host");
  const box = h("div", { klasse: "menue " + klasse, role: "menu" });
  if (breite) box.style.minWidth = breite + "px";
  const knoepfe = [];
  for (const e of eintraege) {
    if (e.trenner) { box.append(h("div", { klasse: "m-trenner", role: "separator" })); continue; }
    if (e.gruppe) { box.append(h("div", { klasse: "m-gruppe", text: e.gruppe })); continue; }
    if (e.leer) { box.append(h("div", { klasse: "m-leer", text: e.leer })); continue; }
    if (e.segmente) {
      box.append(h("div", { klasse: "m-segmente", role: "group" }, e.segmente.map((s) =>
        h("button", { type: "button", "aria-pressed": String(!!s.aktiv), "data-wert": s.wert ?? "", aufClick: () => { s.tun(); zu(); } }, s.symbol ? symbol(s.symbol, 14) : null, h("span", { text: s.name })))));
      continue;
    }
    const b = h("button", { type: "button", klasse: "m-eintrag" + (e.gefahr ? " gefahr" : ""), role: "menuitem", "data-menue": e.id || e.name, "data-aktiv": "false",
      aufClick: () => { zu(); e.tun?.(e.daten); } },
      e.farbe ? vaultFarbe(e.farbe) : e.logo ? kiLogo(e.logo, 16, { dekorativ: true }) : e.symbol ? symbol(e.symbol, 16) : null,
      h("span", { klasse: "m-name", text: e.name }),
      e.sub ? h("span", { klasse: "m-sub", text: e.sub }) : null,
      e.haken !== undefined ? h("span", { klasse: "m-haken" }, e.haken ? symbol("haken", 14) : null) : null);
    if (e.klasse) b.classList.add(e.klasse);
    box.append(b); knoepfe.push(b);
  }
  host.append(box);
  const a = anker.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let x = rechts ? a.right - bw : a.left;
  let y = oben ? a.top - bh - 6 : a.bottom + 6;
  x = Math.max(8, Math.min(x, window.innerWidth - bw - 8));
  if (y + bh > window.innerHeight - 8) y = Math.max(8, a.top - bh - 6);
  box.style.left = x + "px"; box.style.top = y + "px";
  box.style.transformOrigin = `${rechts ? "top right" : "top left"}`;
  anker.setAttribute?.("aria-expanded", "true");
  let idx = -1;
  const markiere = (i) => { idx = i; knoepfe.forEach((k, n) => k.setAttribute("data-aktiv", String(n === i))); knoepfe[i]?.scrollIntoView({ block: "nearest" }); };
  const taste = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); zu(true); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); markiere((idx + 1) % knoepfe.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); markiere((idx - 1 + knoepfe.length) % knoepfe.length); }
    else if (ev.key === "Enter" && idx >= 0) { ev.preventDefault(); ev.stopPropagation(); knoepfe[idx].click(); }
    else if (ev.key === "Tab") { zu(); }
  };
  const aussen = (ev) => { if (!box.contains(ev.target) && !anker.contains?.(ev.target)) zu(); };
  const zu = (fokus) => {
    if (offen?.box !== box) return;
    box.remove(); offen = null;
    document.removeEventListener("keydown", taste, true);
    document.removeEventListener("pointerdown", aussen, true);
    window.removeEventListener("blur", zuBlur); window.removeEventListener("resize", zuBlur);
    anker.setAttribute?.("aria-expanded", "false");
    if (fokus) anker.focus?.();
    beiZu?.();
  };
  const zuBlur = () => zu();
  document.addEventListener("keydown", taste, true);
  document.addEventListener("pointerdown", aussen, true);
  window.addEventListener("blur", zuBlur); window.addEventListener("resize", zuBlur);
  offen = { box, zu };
  return { schliessen: zu, box };
}
