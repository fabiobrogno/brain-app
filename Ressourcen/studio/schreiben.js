// Schreiben im Alltag: neue Notiz (sofort, ohne Dialog), Tagesnotiz mit Tageswechsel und Kalender, Vorlagen mit Wahl und Vorschau, Zurück/Vor durch die geöffneten Notizen.
// Die Logik der Platzhalter und Pfade steht in vorlagen.js (gemeinsam/vorlagen.mjs), das Modell von Zurück/Vor in seitenverlauf.js; hier hängt die Oberfläche daran.
// app.js gibt alles mit, was an seinem Zustand hängt (ctx): offene Notiz, Entwurf, Index. Kein eigener Zustand ausser dem Verlauf.
import { h, dialog, toast, dateiName, ohneEndung, ordnerVon, sucheGrad } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { textfeld, knopf as baueKnopf, oeffneDatumsauswahl } from "./bausteine.js";
import { oeffneMenue } from "./menue.js";
import * as V from "./vorlagen.js";
import { heuteIso, plusTageIso } from "./zeit.js";
import { erzeugeSeitenverlauf } from "./seitenverlauf.js";
import { TS } from "./texte-schreiben.js";
import { T } from "./texte.js";

const TAG_KURZ = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
const tagKurz = (iso) => { const [j, m, t] = iso.split("-").map(Number); return TAG_KURZ.format(new Date(j, m - 1, t)); };

export function erzeugeSchreiben(ctx) {
  const { S, ed, api } = ctx;
  const einst = () => ({ ...V.STANDARD, ...(ctx.einstellungen?.() || {}) });
  const tagPfad = (iso) => V.tagesnotizPfad(einst(), iso);

  // ============================================================ Neue Notiz
  // Sofort eine leere Seite mit dem Cursor in der Titelzeile; die Datei entsteht erst, wenn etwas drinsteht (app.js: festigeEntwurf).
  // Mit Titel (Palette „Neue Notiz „x“ anlegen“) entsteht die Datei gleich.
  async function neueNotiz({ titel = "" } = {}) {
    if (ctx.gesperrt?.()) return false;
    const r = V.baueNotizText({ titel });
    const ok = await ctx.oeffneEntwurf({ text: r.text, cursor: r.cursor, ordner: ctx.inboxName() });
    if (ok && titel.trim()) await ctx.festigeEntwurf({ sofort: true });
    return ok;
  }

  // ============================================================ Vorlagen
  const vorlagenOrdner = () => einst().vorlagenOrdner;
  function vorlagenListe() {
    const o = vorlagenOrdner();
    return S.baum.filter((e) => e.art === "datei" && /\.(md|txt)$/i.test(e.pfad) && V.imOrdner(e.pfad, o) && !dateiName(e.pfad).startsWith("_") && !dateiName(e.pfad).startsWith("."))
      .map((e) => ({ pfad: e.pfad, name: V.vorlagenName(e.pfad) }))
      .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" }));
  }
  const inhaltCache = new Map(); // pfad → Promise<string>
  function vorlagenInhalt(pfad) {
    let p = inhaltCache.get(pfad);
    if (!p) { p = api.datei(pfad).then((d) => String(d.inhalt ?? "")); p.catch(() => inhaltCache.delete(pfad)); inhaltCache.set(pfad, p); }
    return p;
  }
  const vergesseVorlagen = () => inhaltCache.clear();

  async function neueNotizAusVorlage(pfad, titel) {
    let text;
    try { text = await api.datei(pfad).then((d) => String(d.inhalt ?? "")); }
    catch { toast(TS.vorlage.ladeFehler, { fehler: true }); return false; }
    const r = V.baueNotizText({ vorlage: text, titel });
    const ok = await ctx.oeffneEntwurf({ text: r.text, cursor: r.cursor, ordner: ctx.inboxName() });
    if (ok && titel.trim()) await ctx.festigeEntwurf({ sofort: true });
    return ok;
  }

  // Vorschau: der Text der Vorlage so, wie die Notiz würde — Kopf gedämpft, Überschriften kräftig, Cursor als kleiner Strich
  function vorschauEl(text, cursor) {
    const g = V.kopfGrenzen(text);
    const zeilen = text.replace(/\n$/, "").split("\n");
    const el = h("div", { klasse: "vw-text", "data-vorschau": "text" });
    let off = 0, inKopf = !!g;
    zeilen.forEach((z, i) => {
      const ende = off + z.length;
      const klasse = ["vw-z"];
      if (inKopf) klasse.push("kopf");
      else if (/^#{1,6}\s/.test(z) || /^#{1,6}$/.test(z)) klasse.push("ueb", "e" + Math.min(3, z.match(/^#+/)[0].length));
      else if (/^\s*[-*]\s/.test(z) || /^\s*[-*]$/.test(z)) klasse.push("liste");
      const zeile = h("div", { klasse: klasse.join(" ") });
      if (cursor !== null && cursor >= off && cursor <= ende) {
        const k = cursor - off;
        zeile.append(document.createTextNode(z.slice(0, k)), h("span", { klasse: "vw-cursor", "data-vorschau": "cursor" }), document.createTextNode(z.slice(k)));
      } else zeile.textContent = z === "" ? " " : z;
      if (z.trim() === "" && !zeile.firstChild) zeile.textContent = " ";
      el.append(zeile);
      if (inKopf && g && ende + 1 >= g.kopfEnde) inKopf = false;
      off = ende + 1;
    });
    return el;
  }

  function oeffneVorlagenWahl() {
    if (ctx.gesperrt?.() || ctx.dialogOffen?.()) return;
    vergesseVorlagen();
    const liste = vorlagenListe();
    const feld = textfeld({ platzhalter: TS.vorlage.suche, label: TS.vorlage.suche, klasse: "pal-feld", symbol: "suche", daten: { "data-feld": "vorlage-suche", role: "combobox", "aria-expanded": "true", "aria-controls": "vw-liste" } });
    const titelFeld = textfeld({ platzhalter: TS.vorlage.titelPlatzhalter, label: TS.vorlage.titelFeld, groesse: "m", daten: { "data-feld": "vorlage-titel" } });
    const suche = feld.input, titel = titelFeld.input;
    const listeEl = h("div", { klasse: "pal-liste vw-liste", role: "listbox", id: "vw-liste", "data-kanten": true });
    const vorschauHost = h("div", { klasse: "vw-vorschau", "data-vorschau": "host" });
    let sichtbar = liste, idx = 0, nr = 0;

    const waehleAus = () => sichtbar[idx] || null;
    function zeichneListe() {
      const q = suche.value.trim();
      sichtbar = q ? liste.map((v) => ({ v, g: sucheGrad(v.name, q) })).filter((x) => x.g).sort((a, b) => a.g - b.g || a.v.name.localeCompare(b.v.name, "de")).map((x) => x.v) : liste;
      idx = Math.min(idx, Math.max(0, sichtbar.length - 1));
      if (!liste.length) {
        listeEl.replaceChildren(h("div", { klasse: "vw-leer", "data-vorschau": "keine" }, symbol("vorlage", 20), h("b", { text: TS.vorlage.keine }), h("span", { text: TS.vorlage.keineText(vorlagenOrdner()) })));
      } else if (!sichtbar.length) listeEl.replaceChildren(h("div", { klasse: "pal-gruppe", text: TS.vorlage.nichtsPasst }));
      else listeEl.replaceChildren(h("div", { klasse: "pal-gruppe", text: TS.vorlage.gruppe }), ...sichtbar.map((v, i) =>
        h("div", { klasse: "pal-eintrag", role: "option", "data-vorlage": v.pfad, "aria-selected": String(i === idx), aufMouseenter: () => { if (idx !== i) { idx = i; markiere(); zeichneVorschau(); } }, aufClick: () => { idx = i; markiere(); zeichneVorschau(); titel.focus(); } },
          symbol("vorlage", 16), h("span", { klasse: "n", text: v.name }))));
      markiere();
      zeichneVorschau();
    }
    function markiere() {
      [...listeEl.querySelectorAll(".pal-eintrag")].forEach((e, i) => e.setAttribute("aria-selected", String(i === idx)));
      listeEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
    async function zeichneVorschau() {
      const v = waehleAus();
      const mein = ++nr;
      if (!v) { vorschauHost.replaceChildren(h("div", { klasse: "vw-platz", text: liste.length ? TS.vorlage.waehle : "" })); anlegenKnopf.disabled = true; return; }
      anlegenKnopf.disabled = false;
      let text;
      try { text = await vorlagenInhalt(v.pfad); } catch { if (mein === nr) vorschauHost.replaceChildren(h("div", { klasse: "vw-platz", text: TS.vorlage.ladeFehler })); return; }
      if (mein !== nr) return;
      const r = V.baueNotizText({ vorlage: text, titel: titel.value });
      vorschauHost.replaceChildren(h("div", { klasse: "vw-kopf" }, h("span", { klasse: "vw-name", text: v.name }), h("span", { klasse: "vw-hinweis", text: TS.vorlage.vorschau })), vorschauEl(r.text, r.cursor));
    }
    function los() {
      const v = waehleAus();
      if (!v) return;
      const t = titel.value.trim();
      d.schliessen();
      setTimeout(() => neueNotizAusVorlage(v.pfad, t), 0);
    }
    const anlegenKnopf = baueKnopf({ text: TS.vorlage.anlegen, variante: "primaer", aktion: "vorlage-anlegen", aufKlick: los });
    suche.addEventListener("input", () => { idx = 0; zeichneListe(); });
    titel.addEventListener("input", () => zeichneVorschau());
    const pfeile = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); idx = (idx + 1) % Math.max(1, sichtbar.length); markiere(); zeichneVorschau(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idx = (idx + sichtbar.length - 1) % Math.max(1, sichtbar.length); markiere(); zeichneVorschau(); }
      else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); los(); }
    };
    suche.addEventListener("keydown", pfeile);
    titel.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") pfeile(e); });
    (feld.el.querySelector(".bs-feld") || feld.el).append(h("kbd", { klasse: "pal-esc", text: T.palette.esc }));
    const fuss = h("footer", { klasse: "vw-fuss" },
      h("div", { klasse: "vw-titel" }, titelFeld.el),
      h("span", { klasse: "vw-ablage" }, symbol("inbox", 12), h("span", { text: T.bereiche.inbox })),
      anlegenKnopf);
    const d = dialog({ eigen: h("div", { klasse: "palette vw", role: "dialog", "aria-modal": "true", "aria-label": TS.vorlage.titel, "data-dialog": "vorlagen-wahl" },
      feld.el, h("div", { klasse: "vw-rumpf" }, listeEl, vorschauHost), fuss) });
    suche.focus();
    zeichneListe();
  }

  // ============================================================ Tagesnotiz
  async function tagesVorlage() {
    const e = einst();
    const gesucht = (e.tagesnotizVorlage || "Tagesnotiz").trim();
    const liste = vorlagenListe();
    const norm = (s) => String(s).normalize("NFC").toLowerCase();
    const treffer = liste.find((v) => norm(v.pfad) === norm(gesucht) || norm(v.pfad) === norm(gesucht + ".md") || norm(v.name) === norm(ohneEndung(gesucht)));
    if (!treffer) { if (e.tagesnotizVorlage) toast(TS.tag.vorlageFehlt(e.tagesnotizVorlage), { fehler: true }); return null; }
    try { return await api.datei(treffer.pfad).then((d) => String(d.inhalt ?? "")); } catch { return null; }
  }

  // Öffnet die Tagesnotiz von iso. Gibt es sie, öffnet sie sich; sonst entsteht ein Entwurf auf dem festen Pfad (Datei erst beim Schreiben) —
  // außer sofort: dann liegt die Datei gleich da („Heute“ per Kürzel oder Palette: die Notiz für heute soll es danach geben).
  async function oeffneTag(iso, { sofort = false } = {}) {
    if (ctx.gesperrt?.()) return false;
    const pfad = tagPfad(iso);
    if (!pfad) return false;
    let da = ctx.existiert(pfad);
    if (!da) { try { await api.datei(pfad); da = true; } catch { da = false; } } // der Index kann hinterherhinken (anderes Gerät, KI)
    if (da) { const ok = await ctx.oeffne(pfad, { tagesnotiz: true }); return ok; }
    const vorlage = await tagesVorlage();
    const r = V.baueNotizText({ vorlage, titel: V.tagesTitel(iso), iso });
    const ok = await ctx.oeffneEntwurf({ text: r.text, cursor: r.cursor, pfad, ordner: ordnerVon(pfad), tag: iso });
    if (ok && sofort) {
      await ctx.festigeEntwurf({ sofort: true });
      toast(TS.tag.angelegt(V.tagesTitel(iso)), { ms: 2600 });
    }
    return ok;
  }
  const heute = () => oeffneTag(heuteIso(), { sofort: true });

  // Welcher Tag ist offen? (Notiz oder Entwurf einer Tagesnotiz) → ISO oder null
  function offenerTag() {
    if (S.entwurf?.tag) return S.entwurf.tag;
    if (!S.pfad) return null;
    return V.tagesnotizDatum(einst(), S.pfad, heuteIso());
  }
  const hatNotiz = (iso) => { const p = tagPfad(iso); return !!p && ctx.existiert(p); };

  function oeffneKalender(anker) {
    const iso = offenerTag() || heuteIso();
    oeffneDatumsauswahl(anker, { wert: iso, schnell: "heute", kein: false, markiert: hatNotiz, beiWahl: (x) => { if (x) oeffneTag(x); } });
  }

  // Kopfzeile: ‹ Do., 5. Nov. › [Heute] — nur bei einer Tagesnotiz
  function zeichneTagNavigation() {
    const host = document.getElementById("tag-nav");
    if (!host) return;
    const iso = offenerTag();
    if (!iso || !S.info?.vault) { host.hidden = true; host.replaceChildren(); return; }
    const knopf = (daten, label, sym, tun, tippText) => h("button", { type: "button", klasse: "knopf-icon klein tag-pfeil", "aria-label": label, title: tippText || label, ...daten, aufClick: tun }, symbol(sym, GROESSE.text));
    const zurueck = knopf({ "data-tag": "zurueck" }, TS.tag.vorher, "chevron-rechts", () => oeffneTag(plusTageIso(iso, -1)));
    zurueck.firstChild.style.transform = "rotate(180deg)";
    const vor = knopf({ "data-tag": "vor" }, TS.tag.nachher, "chevron-rechts", () => oeffneTag(plusTageIso(iso, 1)));
    const label = h("button", { type: "button", klasse: "tag-label", "data-tag": "kalender", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": `${TS.tag.kalender}: ${V.tagesTitel(iso)}`, title: TS.tag.kalender,
      aufClick: (e) => oeffneKalender(e.currentTarget) }, symbol("kalender", GROESSE.text), h("span", { text: tagKurz(iso) }));
    const jetzt = heuteIso();
    const zuHeute = iso === jetzt ? null : h("button", { type: "button", klasse: "tag-heute", "data-tag": "heute", title: TS.tag.zuHeute, aufClick: () => oeffneTag(jetzt, { sofort: true }), text: TS.tag.heute });
    host.hidden = false;
    host.dataset.tag = iso;
    host.replaceChildren(zurueck, label, vor, ...(zuHeute ? [zuHeute] : []));
  }

  // ============================================================ Zurück und Vor
  const verlauf = erzeugeSeitenverlauf();
  let gehtGerade = false;
  const titelVon = (pfad) => ctx.titelVon?.(pfad) || ohneEndung(dateiName(pfad));

  // app.js ruft: nach jedem Öffnen (nicht über Zurück/Vor), beim Verlassen einer Notiz, beim Öffnen eines Entwurfs
  const betreten = (pfad) => { verlauf.betreten(pfad); zeichnePfeile(); };
  const verlasse = () => { if (S.pfad) verlauf.verlassen(S.pfad, ed.zustand()); };
  const entwurfOffen = () => { verlauf.betreteEntwurf(); zeichnePfeile(); };

  async function geheZu(r, ausgesucht = null) {
    if (gehtGerade) return;
    gehtGerade = true;
    try {
      for (let versuche = 0; versuche < 50; versuche++) {
        const e = ausgesucht !== null ? verlauf.bei(ausgesucht) : verlauf.naechster(r);
        if (!e) return;
        if (!ctx.existiert(e.pfad)) { verlauf.entferne(e.pfad); zeichnePfeile(); if (ausgesucht !== null) return; continue; }
        let fehlt = false;
        const ok = await ctx.oeffne(e.pfad, { verlauf: true, zustand: e.zustand, beiFehlt: () => { fehlt = true; } });
        if (ok) { if (ausgesucht !== null) verlauf.springe(ausgesucht); else verlauf.gehe(r); zeichnePfeile(); return; }
        if (!fehlt) return; // nicht gewechselt (Konflikt, Speichern gescheitert): der Verlauf bleibt, wo er ist
        verlauf.entferne(e.pfad); zeichnePfeile();
        if (ausgesucht !== null) return;
      }
    } finally { gehtGerade = false; }
  }
  const zurueck = () => geheZu(-1);
  const vor = () => geheZu(1);

  function menueFuer(r, anker) {
    const eintraege = verlauf.aufzaehlen(r).slice(0, 14).map(({ i, pfad }) => ({ name: titelVon(pfad), sub: ordnerVon(pfad) || undefined, symbol: "notiz", daten: i, tun: () => geheZu(r, i) }));
    if (!eintraege.length) return;
    oeffneMenue(anker, [{ gruppe: r < 0 ? TS.verlauf.zurueckListe : TS.verlauf.vorListe }, ...eintraege], { klasse: "verlauf-menue" });
  }

  let pfeilZurueck = null, pfeilVor = null;
  function baueNavigation() {
    const host = document.getElementById("nav-pfeile");
    if (!host) return;
    const mach = (r, sym, text, id) => {
      const b = h("button", { type: "button", klasse: "knopf-icon nav-pfeil", id, "data-nav": r < 0 ? "zurueck" : "vor", "aria-label": text, title: text, aufClick: () => { if (b.dataset.lang === "1") { b.dataset.lang = ""; return; } geheZu(r); } }, symbol(sym, GROESSE.norm));
      if (r > 0) b.firstChild.style.transform = "rotate(180deg)";
      // Rechtsklick und langes Drücken: die Liste der Einträge
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); menueFuer(r, b); });
      let timer = 0;
      b.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; b.dataset.lang = ""; timer = setTimeout(() => { b.dataset.lang = "1"; menueFuer(r, b); }, 450); });
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => clearTimeout(timer));
      return b;
    };
    pfeilZurueck = mach(-1, "chevron-rechts", TS.verlauf.zurueck, "nav-zurueck");
    pfeilZurueck.firstChild.style.transform = "rotate(180deg)";
    pfeilVor = mach(1, "chevron-rechts", TS.verlauf.vor, "nav-vor");
    pfeilVor.firstChild.style.transform = "";
    host.replaceChildren(pfeilZurueck, pfeilVor);
    zeichnePfeile();
  }
  function zeichnePfeile() {
    if (!pfeilZurueck) return;
    const z = ctx.kuerzel?.("zurueck"), v = ctx.kuerzel?.("vor");
    pfeilZurueck.setAttribute("aria-disabled", String(!verlauf.kannZurueck()));
    pfeilVor.setAttribute("aria-disabled", String(!verlauf.kannVor()));
    const zielZ = verlauf.naechster(-1), zielV = verlauf.naechster(1);
    pfeilZurueck.title = `${TS.verlauf.zurueck}${zielZ ? `: ${titelVon(zielZ.pfad)}` : ""}${z ? ` (${z})` : ""}`;
    pfeilVor.title = `${TS.verlauf.vor}${zielV ? `: ${titelVon(zielV.pfad)}` : ""}${v ? ` (${v})` : ""}`;
    pfeilZurueck.setAttribute("aria-label", TS.verlauf.zurueck); pfeilVor.setAttribute("aria-label", TS.verlauf.vor);
  }

  // Maustasten 4 und 5 (Zurück/Vor der Maus) und die Wischgeste mit zwei Fingern nach rechts/links — nur wenn nichts Waagerechtes darunter scrollen kann
  function installiereGesten() {
    const taste = (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type === "mouseup") (e.button === 3 ? zurueck : vor)();
    };
    for (const t of ["mousedown", "mouseup", "auxclick"]) window.addEventListener(t, taste, true);
    let summe = 0, letzte = 0, gesperrtBis = 0;
    const kannWaagerecht = (el) => { for (let x = el; x && x !== document.documentElement; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll)/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 1) return true; } return false; };
    window.addEventListener("wheel", (e) => {
      const jetzt = performance.now();
      if (e.ctrlKey || jetzt < gesperrtBis) return;
      if (Math.abs(e.deltaX) < 2 * Math.abs(e.deltaY) || kannWaagerecht(e.target)) { summe = 0; return; }
      if (jetzt - letzte > 220) summe = 0;
      letzte = jetzt; summe += e.deltaX;
      if (Math.abs(summe) > 180) { const r = summe < 0 ? -1 : 1; summe = 0; gesperrtBis = jetzt + 900; e.preventDefault(); geheZu(r); }
    }, { passive: false });
  }

  return {
    neueNotiz, oeffneVorlagenWahl, neueNotizAusVorlage, vorlagenListe, vergesseVorlagen, heute, oeffneTag, offenerTag, zeichneTagNavigation, oeffneKalender,
    zurueck, vor, betreten, verlasse, entwurfOffen, baueNavigation, zeichnePfeile, installiereGesten, verlauf,
    zuruecksetzen: () => { verlauf.leeren(); inhaltCache.clear(); zeichnePfeile(); zeichneTagNavigation(); },
    // andere Teile der App (Umbenennen, Verschieben, Löschen) melden Pfadänderungen so
    umbenannt: (alt, neu) => { verlauf.umbenannt(alt, neu); zeichnePfeile(); },
    ordnerUmbenannt: (alt, neu) => { verlauf.ordnerUmbenannt(alt, neu); zeichnePfeile(); },
    entfernt: (pfad) => { verlauf.entferne(pfad); zeichnePfeile(); },
  };
}
