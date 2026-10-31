// KI-Zeile unten in der Seitenleiste des Hauptfensters (Paket P3): „3 KIs · 1 braucht dich“ mit den Logos der KI-Programme.
// Ehrlich gezählt: Die Zahl sind die KI-Konten, die Kortex kennt (GET /api/ki/konten); „braucht dich“ sind die offenen Rückfragen im Vault
// (das, worauf eine KI von dir wartet). Eine Anmeldung, die abgelaufen ist, erkennt Kortex erst am Fehlschlag eines Aufrufs — sie wird hier nicht geraten.
// Ein Klick führt zu „KI & Konten“ in den Einstellungen, ohne KI zu „KI verbinden“.
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { T } from "./texte.js";

// z: { api, rueckfragen(): number, oeffneKonten(), oeffneKi(), vorhanden(): boolean }
export function baueKiZeile(host, z) {
  let konten = null; // null = unbekannt (noch nicht geladen oder Fehler)
  let nr = 0;

  function zeichne() {
    if (!z.vorhanden()) { host.hidden = true; host.replaceChildren(); return; }
    const K = T.kiZeile;
    const liste = konten || [];
    const programme = [...new Set(liste.map((k) => k.programm).filter(Boolean))];
    const braucht = Math.max(0, Number(z.rueckfragen()) || 0);
    host.hidden = false;
    if (konten === null) { host.hidden = true; host.replaceChildren(); return; }
    if (!liste.length) {
      host.dataset.zustand = "keine";
      host.title = K.keineTitel;
      host.setAttribute("aria-label", K.keine);
      host.replaceChildren(symbol("funke", 14), h("span", { klasse: "ki-text", text: K.keine }));
      host.onclick = () => z.oeffneKi();
      return;
    }
    const text = braucht ? `${K.anzahl(liste.length)} · ${braucht === 1 ? K.braucht(braucht) : K.brauchenMehr(braucht)}` : K.anzahl(liste.length);
    host.dataset.zustand = braucht ? "braucht" : "ruhig";
    host.title = K.titel(liste.length, braucht);
    host.setAttribute("aria-label", text);
    const logos = programme.map((p) => kiLogo(p, 14, { dekorativ: true })).filter(Boolean).slice(0, 3);
    host.replaceChildren(...[symbol("funke", 14), h("span", { klasse: "ki-text", text }), braucht ? h("span", { klasse: "ki-warn", "aria-hidden": "true" }) : null, logos.length ? h("span", { klasse: "ki-logos" }, ...logos) : null].filter(Boolean));
    host.onclick = () => z.oeffneKonten();
  }

  async function lade() {
    const mein = ++nr;
    try {
      const r = await z.api.kiKonten();
      if (mein !== nr) return;
      konten = Array.isArray(r?.konten) ? r.konten : null;
    } catch { if (mein !== nr) return; konten = null; }
    zeichne();
  }
  function zuruecksetzen() { nr++; konten = null; zeichne(); }
  return { lade, zeichne, zuruecksetzen };
}
