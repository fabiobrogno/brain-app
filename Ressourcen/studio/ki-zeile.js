// KI-Zeile unten in der Seitenleiste des Hauptfensters (Paket P3): „3 KIs · 1 braucht dich“ mit den Logos der KI-Programme.
// Ehrlich gezählt und ohne Nebenwirkung: Die Zahl sind die KI-Programme, die Kortex auf diesem Mac erkannt hat (GET /api/ki/erkennen, nur lesend — NICHT /api/ki/konten:
// das gleicht beim Lesen die Konten-Liste ab und legt neue Konten gesperrt an, das darf eine Anzeige beim Start nicht auslösen). „braucht dich“ sind die offenen Rückfragen
// im Vault (das, worauf eine KI von dir wartet); eine abgelaufene Anmeldung erkennt Kortex erst am Fehlschlag eines Aufrufs und rät sie hier nicht.
// Ein Klick führt zu „KI & Konten“ in den Einstellungen, ohne erkannte KI zu „KI verbinden“.
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { T } from "./texte.js";

// z: { erkannt(): string[] | null (Kennungen der erkannten Programme, null = noch unbekannt), rueckfragen(): number, oeffneKonten(), oeffneKi(), vorhanden(): boolean }
export function baueKiZeile(host, z) {
  function zeichne() {
    const erkannt = z.erkannt();
    if (!z.vorhanden() || erkannt === null) { host.hidden = true; host.replaceChildren(); return; }
    const K = T.kiZeile;
    const programme = [...new Set(erkannt)];
    const braucht = Math.max(0, Number(z.rueckfragen()) || 0);
    host.hidden = false;
    if (!programme.length) {
      host.dataset.zustand = "keine";
      host.title = K.keineTitel;
      host.setAttribute("aria-label", K.keine);
      host.replaceChildren(symbol("funke", 14), h("span", { klasse: "ki-text", text: K.keine }));
      host.onclick = () => z.oeffneKi();
      return;
    }
    const text = braucht ? `${K.anzahl(programme.length)} · ${braucht === 1 ? K.braucht(braucht) : K.brauchenMehr(braucht)}` : K.anzahl(programme.length);
    host.dataset.zustand = braucht ? "braucht" : "ruhig";
    host.title = K.titel(programme.length, braucht);
    host.setAttribute("aria-label", text);
    const logos = programme.map((p) => kiLogo(p, 14, { dekorativ: true })).filter(Boolean).slice(0, 3);
    host.replaceChildren(...[symbol("funke", 14), h("span", { klasse: "ki-text", text }), braucht ? h("span", { klasse: "ki-warn", "aria-hidden": "true" }) : null, logos.length ? h("span", { klasse: "ki-logos" }, ...logos) : null].filter(Boolean));
    host.onclick = () => z.oeffneKonten();
  }
  return { zeichne };
}
