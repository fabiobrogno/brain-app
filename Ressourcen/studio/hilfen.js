// Kleine DOM-Helfer, Dialoge, Toasts. Kein innerHTML mit fremden Daten.
import { popoverOffen } from "./popover.js";
export function h(tag, attrs, ...kinder) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "klasse") e.className = v;
    else if (k.startsWith("auf")) e.addEventListener(k.slice(3).toLowerCase(), v);
    else if (k === "text") e.textContent = v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const k of kinder.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

// Wert aus einer festen Tabelle, nur wenn der Schlüssel wirklich darin steht (Schlüssel aus Daten wie „constructor“ liefern sonst Funktionen)
export const ausTabelle = (tabelle, schluessel) => (Object.hasOwn(tabelle, schluessel) ? tabelle[schluessel] : undefined);

// Arbeiten, die ein Schließen des Fensters abbrechen würde (Abgleich, Sichern, Klonen, Remote): vorSchliessen meldet sie wie ungespeicherte Eingaben.
const arbeiten = new Map();
export function arbeitBeginnt(art) {
  const id = Symbol(art);
  arbeiten.set(id, art);
  return () => { arbeiten.delete(id); };
}
export const laufendeArbeiten = () => [...arbeiten.values()];

let dialogZaehler = 0;
const offeneDialoge = new Set(); // die Schließen-Funktionen aller offenen Dialoge
// Öffnet einen Dialog. Gibt { schliessen } zurück. Esc schließt. Mehrfaches Schließen ist harmlos (beiSchliessen läuft nur einmal).
// Einheitliche Hülle: Titel, ein Satz (satz), Inhalt (rumpf), Fußleiste (knoepfe) mit GENAU EINEM Hauptknopf (.knopf.primaer) rechts.
// Enter bestätigt den Hauptknopf (auch aus einem Textfeld; im mehrzeiligen Feld mit ⌘/Strg+Enter), Esc schließt.
// Aufbau und Maße folgen dem Dialog-Muster von Orca (MIT, siehe THIRD-PARTY-NOTICES.md): Titel, Beschreibung, 16 px Abstand, Fußleiste rechts.
export function dialog({ titel, satz, rumpf, knoepfe = [], breit = false, beiSchliessen, eigen }) {
  const host = document.getElementById("dialog-host");
  const davor = document.activeElement;
  const id = "dlg" + ++dialogZaehler;
  let box;
  if (eigen) box = eigen;
  else {
    box = h("div", { klasse: "dialog" + (breit ? " breit" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": id, ...(satz ? { "aria-describedby": id + "-satz" } : {}) },
      h("div", { klasse: "dialog-kopf", id, text: titel }),
      satz ? h("p", { klasse: "dialog-satz", id: id + "-satz", text: satz }) : null,
      h("div", { klasse: "dialog-rumpf" }, rumpf),
      knoepfe.length ? h("div", { klasse: "dialog-fuss" }, knoepfe) : null);
  }
  // Mit einem mehrzeiligen Feld im Inhalt löst ⌘↩ (nicht Enter) den Hauptknopf aus: der Hinweis am Knopf sagt es.
  if (!eigen && box.querySelector(".dialog-rumpf textarea")) box.querySelector(".dialog-fuss .knopf.primaer")?.setAttribute("data-enter", "meta");
  const schleier = h("div", { klasse: "schleier" }, box);
  let geschlossen = false;
  const zu = () => {
    if (geschlossen) return;
    geschlossen = true;
    offeneDialoge.delete(zu);
    schleier.remove();
    document.removeEventListener("keydown", taste, true);
    beiSchliessen?.();
    if (davor && document.contains(davor)) davor.focus?.();
  };
  const taste = (e) => {
    if (e.key === "Escape") { if (popoverOffen()) return; e.preventDefault(); e.stopPropagation(); zu(); } // ein offenes Popover (Auswahl, Datum, Menü) schließt zuerst
    else if (e.key === "Enter" && !e.isComposing && !e.altKey && !e.shiftKey && !popoverOffen()) {
      // Enter = Hauptknopf der Fußleiste. Knöpfe, Links, Auswahlfelder und Listen behalten ihr eigenes Enter; ein mehrzeiliges Feld braucht ⌘/Strg dazu.
      const ziel = e.target;
      const eigenesEnter = ziel.closest?.("button, a, select, [role=combobox], [role=listbox], [role=option], summary");
      const mehrzeilig = ziel.tagName === "TEXTAREA" || ziel.isContentEditable;
      const haupt = box.querySelector(".dialog-fuss .knopf.primaer");
      if (haupt && !haupt.disabled && !eigenesEnter && (!mehrzeilig || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopImmediatePropagation(); haupt.click(); }
    } else if (e.key === "Tab") {
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
  offeneDialoge.add(zu);
  const erst = box.querySelector("[autofocus], input[type=text], textarea, input") || box.querySelector("button.primaer");
  setTimeout(() => erst?.focus(), 0);
  return { schliessen: zu, box };
}
export const dialogOffen = () => !!document.querySelector("#dialog-host .schleier");
// Beim Wechsel des Vaults: alle offenen Dialoge zu. Sie gehören zum alten Vault (Sichern, Neue Notiz, Vertrauen, Palette …);
// was jemand getippt hat, bleibt über beiSchliessen erhalten (z. B. der Entwurf bei „Schnell merken“).
export function schliesseDialoge() { for (const zu of [...offeneDialoge]) zu(); }

// Hinweis unten rechts. Einfach: toast("Text", { fehler, aktion: { text, tun }, ms }).
// Mit mehreren Aktionen (Mitteilungen, P8): { aktionen: [{ text, tun, primaer }], fett (hervorgehobener Anfang, z. B. der Name der KI), unter (graue Unterzeile), logo (Element links) }.
// Bei `aktionen` pausiert das Ausblenden, solange die Maus darüber ist oder ein Knopf den Fokus hat. Gibt das Element zurück.
export function toast(text, { fehler = false, aktion, aktionen, fett, unter, logo, ms = 4200 } = {}) {
  const host = document.getElementById("toast-host");
  const dauer = fehler ? ms + 2500 : ms;
  const reich = !!(aktionen?.length || fett || unter || logo);
  let t;
  if (!reich) {
    t = h("div", { klasse: "toast" + (fehler ? " fehler" : "") }, h("span", { text }),
      aktion ? h("a", { text: aktion.text, role: "button", aufClick: () => { aktion.tun(); t.remove(); } }) : null);
    host.append(t);
    setTimeout(() => t.remove(), dauer);
    return t;
  }
  const knoepfe = (aktionen || []).map((a) => h("button", { type: "button", klasse: "toast-knopf" + (a.primaer ? " primaer" : ""), text: a.text, aufClick: () => { t.remove(); try { a.tun(); } catch { /* der Hinweis ist schon weg */ } } }));
  t = h("div", { klasse: "toast reich" + (fehler ? " fehler" : ""), role: fehler ? "alert" : "status" },
    logo ? h("span", { klasse: "toast-logo", "aria-hidden": "true" }, logo) : null,
    h("div", { klasse: "toast-text" }, h("div", { klasse: "toast-titel" }, fett ? h("b", { text: fett }) : null, fett ? " " : null, text), unter ? h("div", { klasse: "toast-unter", text: unter }) : null),
    knoepfe.length ? h("div", { klasse: "toast-aktionen" }, knoepfe) : null);
  host.append(t);
  let timer = null, rest = dauer, start = 0;
  const plane = () => { clearTimeout(timer); start = Date.now(); timer = setTimeout(() => t.remove(), rest); };
  const halte = () => { clearTimeout(timer); rest = Math.max(2500, rest - (Date.now() - start)); };
  if (knoepfe.length) {
    t.addEventListener("mouseenter", halte); t.addEventListener("mouseleave", plane);
    t.addEventListener("focusin", halte); t.addEventListener("focusout", (e) => { if (!t.contains(e.relatedTarget) && !t.matches(":hover")) plane(); });
  }
  plane();
  return t;
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

// Entwürfe überleben das Schließen eines Dialogs (nur diese Sitzung).
export function speichereEntwurf(k, v) { try { v === null ? sessionStorage.removeItem("brain-studio.entwurf." + k) : sessionStorage.setItem("brain-studio.entwurf." + k, JSON.stringify(v)); } catch { /* ohne Speicher */ } }
export function leseEntwurf(k) { try { const v = sessionStorage.getItem("brain-studio.entwurf." + k); return v === null ? null : JSON.parse(v); } catch { return null; } }
