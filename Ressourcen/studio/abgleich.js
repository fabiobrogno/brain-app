// Dialoge für den Abgleich mit Konflikten und für „Frühere Fassung zurückholen“ (Vorschau per Diff, dann als neue Fassung gesichert).
// Kein innerHTML mit fremden Daten: alles über h() und textContent. Die Entscheidungen gehen an die Werkstatt, die sie prüft und ausführt.
import { h, dialog, arbeitBeginnt, toast } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { api as standardApi, gitGesperrt, ausgangUnklar, zeitText } from "./api.js";
import { TV } from "./texte-verlauf.js";
import { ladeVerlaufCss, parseDiff, diffZeile } from "./verlauf.js";

const T = TV.abgleich, Z = TV.zurueckholen;
const zeichen = (name, groesse) => { const s = symbol(name, groesse); s.setAttribute("aria-hidden", "true"); return s; };
const MAX_ZEILEN = 1500;
const MAX_VORSCHAU_ZEICHEN = 20000;
// Datum im Namen der Zusatzdatei: Berliner Tag, wie ihn die Werkstatt vergibt
const heuteBerlin = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

function meldungBox() {
  const el = h("div", { klasse: "rm-meldung", "aria-live": "polite" });
  const zeige = (art, text, sym) => {
    el.className = "rm-meldung" + (art ? " " + art : "");
    el.replaceChildren(...(text ? [sym ? zeichen(sym, 14) : null, h("span", { text })].filter(Boolean) : []));
  };
  return { el, zeige };
}

// ---------------------------------------------------------------- Abgleich mit Konflikten
// dateien: [{ pfad, art }] aus 409 { konflikt, dateien } bzw. Status.konflikt.dateien (art: beide | meine-geloescht | andere-geloescht).
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
  const hinweis = h("span", { klasse: "ab-offen", "aria-live": "polite" });

  const aktualisiere = () => {
    const offen = liste.filter((d) => !wahl.has(d.pfad)).length;
    knopf.disabled = laeuft || offen > 0;
    spaeter.disabled = laeuft; abbrechen.disabled = laeuft;
    hinweis.textContent = offen ? T.waehle(offen) : "";
  };

  const karten = liste.map((d) => {
    const art = ["meine-geloescht", "andere-geloescht", "nur-meine", "nur-andere"].includes(d.art) ? d.art : "beide";
    const optionen = art === "beide"
      ? [["meine", T.meine], ["andere", T.andere], ["beide", T.beide, T.beideHinweis(datum || heuteBerlin())]]
      : art === "meine-geloescht"
        ? [["meine", T.meineGeloeschtLassen], ["andere", T.andereBehalten]]
        : art === "andere-geloescht"
          ? [["meine", T.meineBehalten], ["andere", T.andereLoeschen]]
          : art === "nur-meine" ? [["meine", T.behalten], ["andere", T.weglassen]] : [["meine", T.weglassen], ["andere", T.uebernehmen]];
    const name = `ab-wahl-${liste.indexOf(d)}`;
    const radios = optionen.map(([wert, text, zusatz]) => {
      const r = h("input", { type: "radio", name, value: wert, "data-wahl": wert, aufChange: () => { wahl.set(d.pfad, wert); aktualisiere(); } });
      return h("label", { klasse: "ab-option" }, r, h("span", null, h("span", { klasse: "ab-optext", text }), zusatz ? h("span", { klasse: "ab-zusatz", text: zusatz }) : null));
    });
    const vorschau = h("div", { klasse: "ab-vorschau", hidden: true });
    let geladen = false;
    const umschalter = h("button", { klasse: "ab-link", type: "button", "data-aktion": "konflikt-vorschau", "aria-expanded": "false", text: T.vorschau });
    umschalter.addEventListener("click", async () => {
      const auf = vorschau.hidden;
      vorschau.hidden = !auf; umschalter.setAttribute("aria-expanded", String(auf)); umschalter.textContent = auf ? T.vorschauZu : T.vorschau;
      if (!auf || geladen) return;
      geladen = true;
      vorschau.replaceChildren(h("p", { klasse: "ab-hinweis", text: T.vorschauLaedt }));
      try {
        const r = await api.gitKonflikt(d.pfad);
        const spalte = (titel, seite) => h("div", { klasse: "ab-spalte" }, h("div", { klasse: "ab-spaltenkopf", text: titel }),
          h("pre", { klasse: "ab-text", tabindex: "0", text: seite === null || seite === undefined ? T.geloescht : seite.text === null ? T.keinText : kuerze(seite.text) }));
        vorschau.replaceChildren(spalte(T.spalteMeine, r?.datei?.meine), spalte(T.spalteAndere, r?.datei?.andere));
      } catch (e) { geladen = false; vorschau.replaceChildren(h("p", { klasse: "ab-hinweis fehlertext", text: gitGesperrt(e) ? TV.diff.gesperrt : T.vorschauFehler })); }
    });
    return h("fieldset", { klasse: "ab-karte", "data-datei": d.pfad },
      h("legend", { klasse: "ab-datei", title: d.pfad, text: d.pfad }),
      art !== "beide" ? h("p", { klasse: "ab-hinweis", text: art === "meine-geloescht" ? T.meineGeloescht : art === "andere-geloescht" ? T.andereGeloescht : art === "nur-meine" ? T.nurMeine : T.nurAndere }) : null,
      h("div", { klasse: "ab-optionen", role: "radiogroup" }, radios), umschalter, vorschau);
  });

  const box = h("div", { klasse: "dialog rm-dialog ab-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "ab-titel", "data-dialog": "konflikt" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("warnung", 18)), h("h2", { klasse: "rm-titel", id: "ab-titel", text: liste.length ? T.titel : T.leerTitel })),
    h("p", { klasse: "rm-text", text: liste.length ? T.erklaerung : T.leerText }),
    h("div", { klasse: "ab-liste" }, karten),
    meldung.el,
    h("div", { klasse: "ab-fuss" }, abbrechen, hinweis, h("span", { klasse: "sp" }), spaeter, knopf));
  const d = dialog({ eigen: box });
  aktualisiere();

  const fehlerZeigen = async (err, standard) => {
    if (gitGesperrt(err)) { meldung.zeige("fehlertext", TV.diff.gesperrt, "warnung"); return; }
    if (ausgangUnklar(err)) { try { await beiStandNeu?.(err); } catch (x) { console.error(x); } meldung.zeige("hinweis", zeitText(err), "info"); return; }
    meldung.zeige("fehlertext", err?.message || standard, "warnung");
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

const kuerze = (s) => (s.length > MAX_VORSCHAU_ZEICHEN ? s.slice(0, MAX_VORSCHAU_ZEICHEN) + "\n" + T.gekuerzt : s);

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
  const karte = h("div", { klasse: "vd-karte ab-diff", hidden: true }, h("div", { klasse: "vd-zeilen", "data-diff": "" }));
  const vorschauKopf = h("p", { klasse: "ab-hinweis", text: Z.laedt, role: "status" });
  const box = h("div", { klasse: "dialog rm-dialog ab-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "zh-titel", "data-dialog": "zurueckholen" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("uhr", 18)), h("h2", { klasse: "rm-titel", id: "zh-titel", text: Z.titel })),
    h("p", { klasse: "rm-text", text: Z.text(datei, wann || Z.wannUnbekannt) }),
    vorschauKopf, karte, meldung.el,
    h("div", { klasse: "rm-fuss" }, abbrechen, sichern, knopf));
  const d = dialog({ eigen: box });
  abbrechen.addEventListener("click", () => d.schliessen());
  sichern.addEventListener("click", () => { d.schliessen(); beiSichern?.(); });

  (async () => {
    await ladeVerlaufCss();
    let r;
    try { r = await api.zurueckholenVorschau(pfad, sha); }
    catch (e) { vorschauKopf.textContent = gitGesperrt(e) ? TV.diff.gesperrt : (e?.message || Z.fehler); vorschauKopf.classList.add("fehlertext"); return; }
    if (r.unveraendert) { vorschauKopf.textContent = Z.keinUnterschied; return; }
    vorschauKopf.textContent = Z.vorschau;
    const dd = parseDiff(r.diff);
    if (dd.binaer && !dd.zeilen.some((x) => x.art !== "k")) vorschauKopf.textContent = TV.diff.keinText;
    else {
      karte.firstChild.replaceChildren(...dd.zeilen.slice(0, MAX_ZEILEN).map(diffZeile));
      karte.hidden = false;
      if (dd.zeilen.length > MAX_ZEILEN) vorschauKopf.textContent = `${Z.vorschau} ${TV.diff.gekuerzt(dd.zeilen.length, MAX_ZEILEN)}`;
    }
    if (r.ungesichert) { meldung.zeige("hinweis", Z.ungesichert, "info"); sichern.hidden = !beiSichern; return; }
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
      else { meldung.zeige("fehlertext", err?.message || Z.scheitert, "warnung"); knopf.disabled = false; }
    }
  });
  return d;
}
