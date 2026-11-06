// Die Checkliste „Einrichtung n/4“ in der Seitenleiste (Paket E2, nach Orca „Landing“-Checkliste): vier Punkte mit Ring — KI verbinden, Sicherung, Kontingent anzeigen, Mitteilungen.
// Eingeklappt, bis man sie öffnet; ausblendbar (Rückgängig im Hinweis). Sie liest nur (KI-Konten, Sicherung, Kontingent), nie schreibend; ein Klick öffnet den Schritt der Einrichtung
// bzw. die Einstellungen. Sie erscheint erst nach einer Einrichtung auf diesem Gerät. Wer die Liste ausgeblendet hat oder alles erledigt ist, sieht nur noch den leisen Eintrag „Kortex einrichten …“ darunter (`einrichtung-zeile`).
// Gemerkt wird nur Bequemlichkeit pro Gerät (ein-/ausgeklappt, ausgeblendet, „Mitteilungen“ angesehen) im Browser-Speicher; die Zustände der Punkte kommen immer aus der Wirklichkeit.
import { h, toast } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { TE } from "./texte-einrichtung.js";

const SCHLUESSEL = "kortex-einrichtung-liste";
const KONTINGENT_EINGETRAGEN = ["ok", "veraltet", "keine-werte", "ohne-kontingent"]; // Status der Statuszeile von Claude Code (werkstatt/kontingent.mjs), die „eingetragen“ heißen
const lies = () => { try { const w = JSON.parse(localStorage.getItem(SCHLUESSEL) || "{}"); return w && typeof w === "object" ? w : {}; } catch { return {}; } };
const schreib = (w) => { try { localStorage.setItem(SCHLUESSEL, JSON.stringify(w)); } catch { /* ohne Speicher gilt die Liste nur für diese Sitzung */ } };

// Ring (Orca: Fortschrittsring): 4 Teile
function ring(n, m) {
  const r = 7, u = 2 * Math.PI * r;
  const ns = "http://www.w3.org/2000/svg";
  const k = (t, a) => { const e = document.createElementNS(ns, t); for (const [x, v] of Object.entries(a)) e.setAttribute(x, v); return e; };
  const svg = k("svg", { class: "e-ring", viewBox: "0 0 18 18", width: "18", height: "18", "aria-hidden": "true" });
  svg.append(k("circle", { class: "bg", cx: 9, cy: 9, r }), k("circle", { class: "fg", cx: 9, cy: 9, r, "stroke-dasharray": `${u}`, "stroke-dashoffset": `${u * (1 - n / m)}` }));
  return svg;
}

/**
 * @param {{ host: HTMLElement, zeile: HTMLElement, api: object, aktiv: () => boolean, vault: () => (string|null), anfordern: (o: {ab: string}) => void, einstellungen: (o: object) => void }} p
 *   host: Platz der Liste · zeile: der leise Eintrag „Kortex einrichten …“ (sichtbar, wenn die Liste nicht da ist) · aktiv: läuft in der App
 */
export function erzeugeEinrichtungsListe({ host, zeile, api, aktiv, vault, anfordern, einstellungen }) {
  const S = { freigabe: lies().freigabe === true, offen: lies().offen === true, aus: lies().aus === true, mitteilungen: lies().mitteilungen === true, erledigt: { ki: false, sicherung: false, kontingent: false }, geladen: false, lauf: 0 };
  const speichern = () => schreib({ freigabe: S.freigabe, offen: S.offen, aus: S.aus, mitteilungen: S.mitteilungen });
  const punkte = () => [
    ["ki", TE.liste.punkte.ki, S.erledigt.ki, () => anfordern({ ab: "ki" })],
    ["sicherung", TE.liste.punkte.sicherung, S.erledigt.sicherung, () => anfordern({ ab: "sicherung" })],
    ["kontingent", TE.liste.punkte.kontingent, S.erledigt.kontingent, () => einstellungen({ bereich: "ki" })],
    ["mitteilungen", TE.liste.punkte.mitteilungen, S.mitteilungen, () => { S.mitteilungen = true; speichern(); zeichne(); einstellungen({ bereich: "mitteilungen" }); }],
  ];
  const anzahl = () => punkte().filter((p) => p[2]).length;

  function zeichne() {
    const sichtbar = aktiv() && S.freigabe && !!vault() && S.geladen && !S.aus && anzahl() < 4;
    host.hidden = !sichtbar;
    if (zeile) zeile.hidden = !aktiv() || sichtbar;
    if (!sichtbar) { host.replaceChildren(); return; }
    const n = anzahl(), liste = punkte();
    const kopf = h("button", { type: "button", klasse: "e-chk-h", "aria-expanded": String(S.offen), "data-aktion": "einrichtung-liste" }, ring(n, 4), h("span", { text: TE.liste.titel }),
      h("span", { klasse: "e-chk-n", "data-feld": "zaehler", text: TE.liste.zaehler(n, 4) }), symbol("chevron-unten", 14));
    kopf.addEventListener("click", () => { S.offen = !S.offen; speichern(); zeichne(); });
    const x = h("button", { type: "button", klasse: "e-chk-x", "aria-label": TE.liste.ausblendenAria, title: TE.liste.ausblenden, "data-aktion": "einrichtung-liste-aus" }, symbol("schliessen", 12));
    x.addEventListener("click", blendeAus);
    const ul = h("ul", { "data-bereich": "einrichtung-punkte" }, liste.map(([k, text, fertig, tun]) => {
      const b = h("button", { type: "button", klasse: "e-ci" + (fertig ? " erledigt" : ""), "data-punkt": k, "data-erledigt": String(!!fertig) },
        h("span", { klasse: "e-dotc" }, symbol("haken", 12)), h("span", { text }), h("span", { klasse: "e-chk-sr", text: fertig ? ` (${TE.liste.erledigt})` : ` (${TE.liste.offen})` }));
      b.addEventListener("click", tun);
      return h("li", null, b);
    }));
    const wurzel = h("div", { klasse: "e-chk", "data-offen": String(S.offen), role: "group", "aria-label": TE.liste.aria }, kopf, x, h("div", { klasse: "e-chk-b" }, h("div", null, ul)));
    host.replaceChildren(wurzel);
  }
  function blendeAus() {
    S.aus = true; speichern(); zeichne();
    toast(TE.liste.ausgeblendet, { aktion: { text: TE.liste.rueckgaengig, tun: () => { S.aus = false; speichern(); zeichne(); } } });
  }

  // Zustand aus der Wirklichkeit lesen (nur lesend): KI-Konten verbunden · Remote da · Statuszeile von Claude Code eingetragen
  async function aktualisiere() {
    const nr = ++S.lauf;
    if (!aktiv() || !vault()) { S.geladen = false; zeichne(); return; }
    const [kt, si, ko] = await Promise.allSettled([api.kiKonten(), api.sicherungBereit(), api.kiKontingent()]);
    if (nr !== S.lauf) return;
    const k = kt.status === "fulfilled" ? kt.value : null, s = si.status === "fulfilled" ? si.value : null, q = ko.status === "fulfilled" ? ko.value : null;
    S.erledigt = {
      ki: !!k?.konten?.some((c) => c.verbunden === true),
      sicherung: s?.zustand === "gesichert",
      kontingent: !!q?.konten?.some((c) => c.programm === "claude" && KONTINGENT_EINGETRAGEN.includes(c.status)),
    };
    S.geladen = true;
    zeichne();
  }
  // Die Liste erscheint erst, wenn auf diesem Gerät eine Einrichtung zu Ende ging (fertig oder „Später“ mit Vault): wer Kortex schon nutzt, wird nicht damit überrascht.
  const aktiviere = () => { if (!S.freigabe) { S.freigabe = true; speichern(); } };
  zeichne();
  return { aktualisiere, aktiviere, zeichne, zustand: S };
}
