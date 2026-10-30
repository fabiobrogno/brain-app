// Kleines Popover-Menü: Eintragsliste, Tastatur (↑↓ Enter Esc), schließt bei Klick daneben. Kein innerHTML mit fremden Daten.
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { oeffnePopover, schliessePopover } from "./popover.js";

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
// Der Motor (popover.js) setzt, blendet ein/aus, schließt bei Klick daneben/Esc/Tab und gibt den Fokus zurück; hier bleibt nur die Menü-Tastatur (↑↓ Home End Enter, Tippen springt).
export function oeffneMenue(anker, eintraege, { rechts = false, oben = false, breite, beiZu, klasse = "" } = {}) {
  const box = h("div", { klasse: "menue " + klasse, role: "menu" });
  const knoepfe = [];
  let p = null;
  for (const e of eintraege) {
    if (e.trenner) { box.append(h("div", { klasse: "m-trenner", role: "separator" })); continue; }
    if (e.gruppe) { box.append(h("div", { klasse: "m-gruppe", role: "presentation", text: e.gruppe })); continue; }
    if (e.leer) { box.append(h("div", { klasse: "m-leer", text: e.leer })); continue; }
    if (e.segmente) {
      box.append(h("div", { klasse: "m-segmente", role: "group" }, e.segmente.map((s) =>
        h("button", { type: "button", "aria-pressed": String(!!s.aktiv), "data-wert": s.wert ?? "", aufClick: () => { s.tun(); p?.zu(); } }, s.symbol ? symbol(s.symbol, 14) : null, h("span", { text: s.name })))));
      continue;
    }
    const haken = e.haken !== undefined;
    const b = h("button", { type: "button", klasse: "m-eintrag" + (e.gefahr ? " gefahr" : ""), role: haken ? "menuitemradio" : "menuitem", "aria-checked": haken ? String(!!e.haken) : null,
      "data-menue": e.id || e.name, "data-aktiv": "false", tabindex: "-1", aufClick: () => { p?.zu(); e.tun?.(e.daten); } },
      e.farbe ? vaultFarbe(e.farbe) : e.logo ? kiLogo(e.logo, 16, { dekorativ: true }) : e.symbol ? symbol(e.symbol, 16) : null,
      h("span", { klasse: "m-name", text: e.name }),
      e.sub ? h("span", { klasse: "m-sub", text: e.sub }) : null,
      haken ? h("span", { klasse: "m-haken" }, e.haken ? symbol("haken", 14) : null) : null);
    if (e.klasse) b.classList.add(e.klasse);
    box.append(b); knoepfe.push(b);
  }
  let idx = -1, puffer = "", zeit = 0;
  const markiere = (i) => { idx = i; knoepfe.forEach((k, n) => k.setAttribute("data-aktiv", String(n === i))); knoepfe[i]?.scrollIntoView({ block: "nearest" }); };
  const beiTaste = (ev) => {
    if (!knoepfe.length) return false;
    if (ev.key === "ArrowDown") { markiere((idx + 1) % knoepfe.length); return true; }
    if (ev.key === "ArrowUp") { markiere((idx - 1 + knoepfe.length) % knoepfe.length); return true; }
    if (ev.key === "Home") { markiere(0); return true; }
    if (ev.key === "End") { markiere(knoepfe.length - 1); return true; }
    if (ev.key === "Enter" && idx >= 0) { knoepfe[idx].click(); return true; }
    if (ev.key.length === 1 && /\S/.test(ev.key) && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const jetzt = Date.now();
      puffer = jetzt - zeit > 700 ? ev.key : puffer + ev.key; zeit = jetzt;
      const n = knoepfe.length;
      for (let k = 1; k <= n; k++) {
        const i = (idx + k) % n;
        if (knoepfe[i].textContent.trim().toLowerCase().startsWith(puffer.toLowerCase())) { markiere(i); return true; }
      }
    }
    return false;
  };
  p = oeffnePopover(anker, box, { rechts, oben, minBreite: breite, beiTaste, beiZu: () => { offen = null; beiZu?.(); } });
  offen = p;
  return { schliessen: p.zu, box };
}
