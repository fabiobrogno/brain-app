// Dialoge für den Abgleich mit Konflikten und für „Frühere Fassung zurückholen“ (Vorschau per Diff, dann als neue Fassung gesichert).
// Kein innerHTML mit fremden Daten: alles über h() und textContent. Die Entscheidungen gehen an die Werkstatt, die sie prüft und ausführt.
import { h, dialog, arbeitBeginnt, toast, dateiName, ordnerVon } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { api as standardApi, gitGesperrt, ausgangUnklar, zeitText } from "./api.js";
import { TV } from "./texte-verlauf.js";
import { ladeVerlaufCss, parseDiff, diffKarte, istRohGit, detailsBlock } from "./verlauf.js";

const T = TV.abgleich, Z = TV.zurueckholen;
const zeichen = (name, groesse) => { const s = symbol(name, groesse); s.setAttribute("aria-hidden", "true"); return s; };
const MAX_ZEILEN = 1500;
const MAX_VORSCHAU_ZEICHEN = 20000;
const KURZE_ZEILEN = 8; // so viele Zeilen zeigt die zugeklappte Fassung
// Datum im Namen der Zusatzdatei: Berliner Tag, wie ihn die Werkstatt vergibt
const heuteBerlin = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

// Meldungszeile im Dialog. Roher Text der Versionsverwaltung wird durch einen ruhigen Satz ersetzt, das Original ist aufklappbar.
function meldungBox() {
  const el = h("div", { klasse: "rm-meldung", "aria-live": "polite" });
  const zeige = (art, text, sym, roh = null) => {
    el.className = "rm-meldung" + (art ? " " + art : "");
    const rohText = roh && istRohGit(roh) ? roh : null;
    el.replaceChildren(...(text ? [sym ? zeichen(sym, 14) : null, h("div", { klasse: "rm-meldung-text" }, h("span", { text }), rohText ? detailsBlock(rohText) : null)].filter(Boolean) : []));
  };
  return { el, zeige };
}
// Ist die Meldung der Werkstatt roher Text, zählt der Ersatzsatz; sonst ihr eigener Satz.
const klarText = (err, ersatz) => (err?.message && !istRohGit(err.message) ? err.message : ersatz);

// Kleines Fenster „Technische Details“ (für Toasts und Fehler, die nicht in den Satz passen).
export function zeigeFehlerDetails({ text, titel = TV.roh.titel } = {}) {
  const kopieren = h("button", { klasse: "knopf gross", type: "button", text: TV.roh.kopieren });
  const zu = h("button", { klasse: "knopf primaer gross", type: "button", text: TV.roh.schliessen });
  const box = h("div", { klasse: "dialog rm-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "roh-titel", "data-dialog": "details" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("info", 18)), h("h2", { klasse: "rm-titel", id: "roh-titel", text: titel })),
    h("p", { klasse: "rm-text", text: TV.roh.hinweis }),
    h("pre", { klasse: "roh-text gross", tabindex: "0", text: String(text || "") }),
    h("div", { klasse: "rm-fuss" }, kopieren, zu));
  const d = dialog({ eigen: box });
  zu.addEventListener("click", () => d.schliessen());
  kopieren.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(String(text || "")); toast(TV.roh.kopiert); } catch { /* ohne Zwischenablage */ }
  });
  return d;
}

// ---------------------------------------------------------------- Abgleich mit Konflikten
// dateien: [{ pfad, art }] aus 409 { konflikt, dateien } bzw. Status.konflikt.dateien (art: beide | meine-geloescht | andere-geloescht | nur-meine | nur-andere).
// beiFertig({ zweiteDateien }) nach dem Zusammenführen · beiAbgebrochen() nach „Abgleich abbrechen“ · beiStandNeu(stand) nach unklarem Ausgang.
export function oeffneKonfliktDialog({ dateien, api = standardApi, datum, beiFertig, beiAbgebrochen, beiStandNeu } = {}) {
  ladeVerlaufCss();
  const liste = (dateien || []).map((d) => (typeof d === "string" ? { pfad: d, art: "beide" } : d));
  const wahl = new Map();
  let laeuft = false;
  const meldung = meldungBox();
  const knopf = h("button", { klasse: "knopf primaer gross", type: "button", "data-aktion": "konflikt-zusammenfuehren", text: T.zusammenfuehren });
  const spaeter = h("button", { klasse: "knopf gross", type: "button", "data-aktion": "konflikt-spaeter", text: T.spaeter });
  const abbrechen = h("button", { klasse: "knopf gross ab-abbrechen", type: "button", "data-aktion": "konflikt-abbrechen", text: T.abbrechen, title: T.abbrechenHinweis });
  const hinweis = h("span", { klasse: "ab-offen" });
  const fortschrittText = h("span", { klasse: "ab-fortschritt-text", "aria-live": "polite" });
  const fuell = h("span", { klasse: "ab-balken-fuell" });
  const balken = h("div", { klasse: "ab-balken", role: "progressbar", "aria-label": T.fortschrittLabel, "aria-valuemin": "0", "aria-valuemax": String(liste.length), "aria-valuenow": "0" }, fuell);
  const fortschritt = h("div", { klasse: "ab-fortschritt", "data-fortschritt": "" }, fortschrittText, balken);
  if (!liste.length) fortschritt.hidden = true;
  const kartenEl = new Map();

  const aktualisiere = () => {
    const gesamt = liste.length;
    const fertig = liste.filter((d) => wahl.has(d.pfad)).length;
    const offen = gesamt - fertig;
    knopf.disabled = laeuft || offen > 0;
    spaeter.disabled = laeuft; abbrechen.disabled = laeuft;
    hinweis.textContent = offen ? T.waehle(offen) : "";
    fortschrittText.textContent = offen || !gesamt ? T.fortschritt(fertig, gesamt) : T.alleGeloest;
    balken.setAttribute("aria-valuenow", String(fertig));
    fuell.style.width = gesamt ? `${Math.round((fertig / gesamt) * 100)}%` : "0%";
    fortschritt.classList.toggle("fertig", gesamt > 0 && !offen);
    for (const [pfad, el] of kartenEl) {
      const g = wahl.has(pfad);
      el.classList.toggle("geloest", g);
      el.dataset.zustand = g ? "geloest" : "offen";
      const marke = el.querySelector(".ab-marke");
      marke.replaceChildren(...(g ? [zeichen("haken", 12), h("span", { text: "Gelöst" })] : [h("span", { text: "Offen" })]));
    }
  };

  // Vorschau laden: nacheinander, damit viele Dateien die Werkstatt nicht überrollen
  let kette = Promise.resolve();
  const ladeVorschau = (pfad) => {
    const lauf = () => api.gitKonflikt(pfad).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }));
    const p = kette.then(lauf);
    kette = p.then(() => {});
    return p;
  };

  const karten = liste.map((d, index) => {
    const art = ["meine-geloescht", "andere-geloescht", "nur-meine", "nur-andere"].includes(d.art) ? d.art : "beide";
    // Kacheln: je Seite eine Wahl. text = Beschriftung, titel = Überschrift der Fassung
    const kacheln = art === "beide"
      ? [["meine", T.spalteMeine, T.dieseBehalten], ["andere", T.spalteAndere, T.dieseUebernehmen]]
      : art === "meine-geloescht"
        ? [["meine", T.spalteMeine, T.meineGeloeschtLassen], ["andere", T.spalteAndere, T.andereBehalten]]
        : art === "andere-geloescht"
          ? [["meine", T.spalteMeine, T.meineBehalten], ["andere", T.spalteAndere, T.andereLoeschen]]
          : art === "nur-meine" ? [["meine", T.spalteMeine, T.behalten], ["andere", T.spalteAndere, T.weglassen]] : [["meine", T.spalteMeine, T.weglassen], ["andere", T.spalteAndere, T.uebernehmen]];
    const name = `ab-wahl-${index}`;
    const waehle = (wert) => { wahl.set(d.pfad, wert); aktualisiere(); };
    const koerper = {};
    const meta = {};
    const kachelEls = kacheln.map(([wert, titel, text]) => {
      const radio = h("input", { type: "radio", name, value: wert, "data-wahl": wert, klasse: "ab-radio", aufChange: () => waehle(wert) });
      const kopf = h("label", { klasse: "ab-kachel-kopf" }, radio,
        h("span", { klasse: "ab-kachel-titel" }, h("span", { klasse: "ab-kachel-name", text: titel }), h("span", { klasse: "ab-kachel-wahl", text })));
      meta[wert] = h("span", { klasse: "ab-kachel-meta" });
      koerper[wert] = h("div", { klasse: "ab-kachel-koerper" }, h("div", { klasse: "ab-sk-block", "aria-busy": "true" }, h("span", { klasse: "ab-sk" }), h("span", { klasse: "ab-sk k" }), h("span", { klasse: "ab-sk m" })));
      const kachel = h("div", { klasse: "ab-kachel", "data-seite": wert }, h("div", { klasse: "ab-kachel-oben" }, kopf, meta[wert]), koerper[wert]);
      // Ein Klick irgendwo auf die Kachel wählt sie (außer beim Markieren von Text)
      kachel.addEventListener("click", (e) => {
        if (e.target.closest("label, input")) return;
        if (String(window.getSelection?.() || "")) return;
        if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
        radio.focus();
      });
      return kachel;
    });
    const beide = art === "beide"
      ? (() => {
        const r = h("input", { type: "radio", name, value: "beide", "data-wahl": "beide", klasse: "ab-radio", aufChange: () => waehle("beide") });
        return h("label", { klasse: "ab-beide" }, r, h("span", null, h("span", { klasse: "ab-optext", text: T.beide }), h("span", { klasse: "ab-zusatz", text: T.beideHinweis(datum || heuteBerlin()) })));
      })()
      : null;

    const umschalter = h("button", { klasse: "ab-link", type: "button", "data-aktion": "konflikt-vorschau", "aria-expanded": "false", hidden: true, text: T.ganze });
    const raster = h("div", { klasse: "ab-kacheln", role: "presentation" }, kachelEls);
    umschalter.addEventListener("click", () => {
      const auf = umschalter.getAttribute("aria-expanded") !== "true";
      umschalter.setAttribute("aria-expanded", String(auf));
      umschalter.textContent = auf ? T.weniger : T.ganze;
      raster.classList.toggle("ganz", auf);
    });

    const fuelle = (ergebnis) => {
      if (!ergebnis.ok) {
        const gesperrt = gitGesperrt(ergebnis.e);
        for (const wert of Object.keys(koerper)) {
          const nochmal = h("button", { klasse: "ab-link", type: "button", text: TV.fehler.nochmal });
          nochmal.addEventListener("click", () => { for (const k of Object.values(koerper)) k.replaceChildren(h("div", { klasse: "ab-sk-block" }, h("span", { klasse: "ab-sk" }), h("span", { klasse: "ab-sk k" }))); ladeVorschau(d.pfad).then(fuelle); });
          koerper[wert].replaceChildren(h("p", { klasse: "ab-hinweis fehlertext", text: gesperrt ? TV.diff.gesperrt : T.vorschauFehler }), gesperrt ? null : nochmal);
        }
        return;
      }
      const datei = ergebnis.r?.datei || {};
      const seiten = { meine: datei.meine, andere: datei.andere };
      const gleich = seiten.meine?.text != null && seiten.meine.text === seiten.andere?.text;
      let maxZeilen = 0;
      for (const wert of Object.keys(koerper)) {
        const s = seiten[wert], gegen = seiten[wert === "meine" ? "andere" : "meine"];
        if (s === null || s === undefined) { koerper[wert].replaceChildren(h("p", { klasse: "ab-leer", text: T.geloescht })); meta[wert].textContent = ""; continue; }
        if (s.text === null || s.text === undefined) { koerper[wert].replaceChildren(h("p", { klasse: "ab-leer", text: T.keinText })); meta[wert].textContent = ""; continue; }
        const roh = s.text.length > MAX_VORSCHAU_ZEICHEN ? s.text.slice(0, MAX_VORSCHAU_ZEICHEN) : s.text;
        const zeilen = roh.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
        const andereZeilen = !gleich && gegen?.text != null ? new Set(gegen.text.replace(/\r\n/g, "\n").split("\n")) : null;
        maxZeilen = Math.max(maxZeilen, zeilen.length);
        meta[wert].textContent = T.zeilenZahl(s.text ? s.text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length : 0);
        koerper[wert].replaceChildren(
          h("pre", { klasse: "ab-text" }, zeilen.map((z) => h("span", { klasse: "ab-z" + (andereZeilen && z.trim() && !andereZeilen.has(z) ? " anders" : ""), text: z === "" ? " " : z }))),
          ...(s.text.length > MAX_VORSCHAU_ZEICHEN ? [h("p", { klasse: "ab-hinweis", text: T.gekuerzt })] : []));
      }
      if (gleich) raster.after(h("p", { klasse: "ab-hinweis ab-gleich", text: T.gleich }));
      umschalter.hidden = maxZeilen <= KURZE_ZEILEN;
      raster.classList.toggle("lang", maxZeilen > KURZE_ZEILEN);
    };
    ladeVorschau(d.pfad).then(fuelle);

    const name2 = dateiName(d.pfad), ordner = ordnerVon(d.pfad);
    const karte = h("fieldset", { klasse: "ab-karte", "data-datei": d.pfad, "data-zustand": "offen" },
      h("legend", { klasse: "ab-datei", title: d.pfad }, zeichen("notiz", 14), h("span", { klasse: "ab-datei-name", text: name2 }), ordner ? h("span", { klasse: "ab-datei-ordner", text: ordner }) : null, h("span", { klasse: "ab-marke" })),
      art !== "beide" ? h("p", { klasse: "ab-hinweis", text: art === "meine-geloescht" ? T.meineGeloescht : art === "andere-geloescht" ? T.andereGeloescht : art === "nur-meine" ? T.nurMeine : T.nurAndere }) : null,
      raster, umschalter, beide);
    kartenEl.set(d.pfad, karte);
    return karte;
  });

  const box = h("div", { klasse: "dialog rm-dialog ab-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "ab-titel", "data-dialog": "konflikt" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen warn" }, zeichen("warnung", 18)), h("h2", { klasse: "rm-titel", id: "ab-titel", text: liste.length ? T.titel : T.leerTitel })),
    h("p", { klasse: "rm-text", text: liste.length ? T.erklaerung : T.leerText }),
    fortschritt,
    h("div", { klasse: "ab-liste" }, karten),
    meldung.el,
    h("div", { klasse: "ab-fuss" }, abbrechen, hinweis, h("span", { klasse: "sp" }), spaeter, knopf));
  const d = dialog({ eigen: box });
  aktualisiere();

  const fehlerZeigen = async (err, standard) => {
    if (gitGesperrt(err)) { meldung.zeige("fehlertext", TV.diff.gesperrt, "warnung"); return; }
    if (ausgangUnklar(err)) { try { await beiStandNeu?.(err); } catch (x) { console.error(x); } meldung.zeige("hinweis", zeitText(err), "info"); return; }
    meldung.zeige("fehlertext", klarText(err, standard), "warnung", err?.message);
  };
  const beschaeftigt = (an, text) => { laeuft = an; aktualisiere(); if (an) meldung.zeige("hinweis", text, null); };

  knopf.addEventListener("click", async () => {
    if (laeuft || knopf.disabled) return;
    beschaeftigt(true, T.arbeitet);
    const ende = arbeitBeginnt("sync");
    try {
      const r = await api.gitKonfliktLoesen(liste.map((x) => ({ pfad: x.pfad, wahl: wahl.get(x.pfad) })));
      ende(); laeuft = false;
      d.schliessen();
      toast(r?.zweiteDateien?.length ? T.fertigZweite(r.zweiteDateien.length) : T.fertig, { ms: 7000 });
      if (r?.versteckteBehalten?.length) toast(T.versteckteBehalten(r.versteckteBehalten.length), { ms: 9000 });
      beiFertig?.(r || {});
    } catch (err) { ende(); beschaeftigt(false); await fehlerZeigen(err, T.fehler); }
  });
  abbrechen.addEventListener("click", async () => {
    if (laeuft) return;
    beschaeftigt(true, T.arbeitet);
    const ende = arbeitBeginnt("sync");
    try {
      await api.gitKonfliktAbbrechen();
      ende(); laeuft = false;
      d.schliessen();
      toast(T.abgebrochen);
      beiAbgebrochen?.();
    } catch (err) { ende(); beschaeftigt(false); await fehlerZeigen(err, T.fehler); }
  });
  spaeter.addEventListener("click", () => { if (!laeuft) d.schliessen(); });
  return d;
}

// ---------------------------------------------------------------- Frühere Fassung zurückholen
// Vorschau (Unterschied aktuell → gewählte Fassung), dann Bestätigung; die Werkstatt sichert als NEUEN Commit.
// beiFertig({ pfad, sha, unveraendert }) · beiSichern() öffnet den Sichern-Dialog, wenn die Datei offene Änderungen hat.
export function oeffneZurueckholen({ pfad, sha, wann, api = standardApi, beiFertig, beiSichern, beiStandNeu } = {}) {
  ladeVerlaufCss();
  const datei = String(pfad || "").split("/").pop();
  const meldung = meldungBox();
  let laeuft = false, bereit = false;
  const knopf = h("button", { klasse: "knopf primaer gross", type: "button", "data-aktion": "zurueckholen", text: Z.zurueckholen, disabled: true });
  const abbrechen = h("button", { klasse: "knopf gross", type: "button", "data-aktion": "zurueckholen-abbrechen", text: Z.abbrechen });
  const sichern = h("button", { klasse: "knopf gross", type: "button", "data-aktion": "zurueckholen-sichern", text: Z.jetztSichern, hidden: true });
  const karte = h("div", { klasse: "zh-vorschau", hidden: true });
  const stat = h("span", { klasse: "vd-stat" });
  const vorschauKopf = h("p", { klasse: "ab-hinweis", text: Z.laedt, role: "status" });
  const lade = h("div", { klasse: "ab-sk-block zh-lade", "aria-busy": "true" }, h("span", { klasse: "ab-sk" }), h("span", { klasse: "ab-sk k" }), h("span", { klasse: "ab-sk m" }));
  const sicher = h("p", { klasse: "zh-sicher", hidden: true }, zeichen("schild", 14), h("span", { text: Z.sicher }));
  const box = h("div", { klasse: "dialog rm-dialog ab-dialog zh-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "zh-titel", "data-dialog": "zurueckholen" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("uhr", 18)), h("h2", { klasse: "rm-titel", id: "zh-titel", text: Z.titel })),
    h("p", { klasse: "rm-text", text: Z.text(datei, wann || Z.wannUnbekannt) }),
    h("div", { klasse: "zh-kopf" }, vorschauKopf, stat),
    lade, karte, sicher, meldung.el,
    h("div", { klasse: "rm-fuss" }, abbrechen, sichern, knopf));
  const d = dialog({ eigen: box });
  abbrechen.addEventListener("click", () => d.schliessen());
  sichern.addEventListener("click", () => { d.schliessen(); beiSichern?.(); });

  (async () => {
    await ladeVerlaufCss();
    let r;
    try { r = await api.zurueckholenVorschau(pfad, sha); }
    catch (e) {
      lade.hidden = true;
      vorschauKopf.textContent = gitGesperrt(e) ? TV.diff.gesperrt : klarText(e, Z.fehler);
      vorschauKopf.classList.add("fehlertext");
      if (!gitGesperrt(e) && e?.message && istRohGit(e.message)) vorschauKopf.after(detailsBlock(e.message));
      return;
    }
    lade.hidden = true;
    if (r.unveraendert) { vorschauKopf.textContent = Z.keinUnterschied; return; }
    vorschauKopf.textContent = Z.vorschau;
    const dd = parseDiff(r.diff);
    if (dd.binaer && !dd.zeilen.some((x) => x.art !== "k")) vorschauKopf.textContent = TV.diff.keinText;
    else {
      karte.replaceChildren(diffKarte(dd.zeilen.slice(0, MAX_ZEILEN), "zeilen"));
      karte.hidden = false;
      stat.replaceChildren(...[dd.plus ? h("span", { klasse: "vl-plus", title: TV.diff.plusZeilen(dd.plus), text: "+" + dd.plus }) : null, dd.minus ? h("span", { klasse: "vl-weg", title: TV.diff.minusZeilen(dd.minus), text: "−" + dd.minus }) : null].filter(Boolean));
      if (dd.zeilen.length > MAX_ZEILEN) vorschauKopf.textContent = `${Z.vorschau} ${TV.diff.gekuerzt(dd.zeilen.length, MAX_ZEILEN)}`;
    }
    if (r.ungesichert) { meldung.zeige("hinweis", Z.ungesichert, "info"); sichern.hidden = !beiSichern; return; }
    sicher.hidden = false;
    bereit = true; knopf.disabled = false; knopf.focus();
  })();

  knopf.addEventListener("click", async () => {
    if (laeuft || !bereit) return;
    laeuft = true; knopf.disabled = true; abbrechen.disabled = true;
    meldung.zeige("hinweis", T.arbeitet, null);
    const ende = arbeitBeginnt("commit");
    try {
      const r = await api.zurueckholen(pfad, sha);
      ende();
      d.schliessen();
      toast(r?.unveraendert ? Z.schonAktuell : Z.fertig, { ms: 6000 });
      beiFertig?.({ pfad, sha, unveraendert: !!r?.unveraendert });
    } catch (err) {
      ende(); laeuft = false; abbrechen.disabled = false;
      if (gitGesperrt(err)) meldung.zeige("fehlertext", TV.diff.gesperrt, "warnung");
      else if (ausgangUnklar(err)) { try { await beiStandNeu?.(err); } catch (x) { console.error(x); } meldung.zeige("hinweis", zeitText(err), "info"); }
      else if (err?.status === 409 && err?.daten?.konflikt) meldung.zeige("fehlertext", Z.konflikt, "warnung");
      else if (err?.status === 409 && err?.daten?.art === "ungesichert") { meldung.zeige("hinweis", Z.ungesichert, "info"); sichern.hidden = !beiSichern; }
      else { meldung.zeige("fehlertext", klarText(err, Z.scheitert), "warnung", err?.message); knopf.disabled = false; }
    }
  });
  return d;
}
