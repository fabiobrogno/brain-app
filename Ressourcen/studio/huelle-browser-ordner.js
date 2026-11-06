// Ordnerwahl der Browser-Hülle (Aktion `ordner-waehlen`, Paket W1). Ein Browser kennt keinen Ordner-Dialog, der einen echten Pfad liefert (showDirectoryPicker gibt nur ein Handle
// ohne Pfad, und die Werkstatt braucht den Pfad). Darum: ein Dialog mit Pfadfeld, Liste der zuletzt benutzten Ordner und einer Liste der Unterordner, die der Dienst auf dem Rechner
// liest (/_kortex/ordner/*). Antwort wie am Mac: { pfad, breit?, notizen?, ordner?, mehr? } oder null (Abbruch). Eigene Bausteine, keine nativen Felder außer dem Textfeld.
import { h, dialog } from "./hilfen.js";
import { knopf as baueKnopf, textfeld } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { TBR } from "./texte-browser.js";

const T = TBR.ordner;
async function post(pfad, daten) {
  const r = await fetch(pfad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten), cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
const GRUENDE = { "kein-absoluter-pfad": T.nichtAbsolut, "nicht-gefunden": T.nichtGefunden, "kein-ordner": T.keinOrdner, "nicht-lesbar": T.nichtLesbar };

export function waehleOrdner({ titel, vorschlag } = {}) {
  return new Promise((fertig) => {
    let erledigt = false, start = null;
    const win = /Win/i.test(navigator.platform || navigator.userAgent || "");
    const feld = textfeld({ label: T.feld, platzhalter: win ? T.platzhalter.win : T.platzhalter.posix, daten: { "data-feld": "pfad" }, klasse: "e-mono-feld" });
    const zuletztHost = h("div", { klasse: "hb-chips", "data-bereich": "zuletzt" });
    const liste = h("div", { klasse: "hb-liste", role: "list", "data-bereich": "unterordner" });
    const ordnerButton = (name, pfad, sym = "ordner") => h("button", { type: "button", klasse: "hb-zeile", role: "listitem", "data-pfad": pfad, title: pfad, aufClick: () => { feld.input.value = pfad; feld.sync(); feld.fehler(""); zeige(pfad); } }, symbol(sym, 14), h("span", { text: name }));
    async function zeige(pfad) {
      liste.replaceChildren(h("div", { klasse: "e-hint", text: T.laedt }));
      let r; try { r = await post("/_kortex/ordner/liste", { pfad }); } catch { liste.replaceChildren(h("div", { klasse: "e-hint", text: T.fehler })); return; }
      if (erledigt) return;
      if (!r.ok) { liste.replaceChildren(h("div", { klasse: "e-hint", text: GRUENDE[r.grund] || T.fehler })); return; }
      const knoten = [];
      if (r.eltern !== null) knoten.push(ordnerButton(T.hoch, r.eltern, "pfeil-oben"));
      for (const o of r.ordner) knoten.push(ordnerButton(o.name, o.pfad));
      if (!r.ordner.length) knoten.push(h("div", { klasse: "e-hint", text: T.leer }));
      liste.replaceChildren(...knoten);
    }
    const nein = baueKnopf({ text: T.abbrechen, aktion: "ordner-abbrechen" });
    const ja = baueKnopf({ text: T.waehlen, variante: "primaer", aktion: "ordner-uebernehmen" });
    const rumpf = h("div", { klasse: "hb-ordner" }, feld.el, zuletztHost, liste);
    const d = dialog({ titel: titel || T.titel, satz: T.satz, rumpf, knoepfe: [nein, ja], breit: true, beiSchliessen: () => { if (!erledigt) { erledigt = true; fertig(null); } } });
    nein.addEventListener("click", () => d.schliessen());
    ja.addEventListener("click", async () => {
      const w = feld.input.value.trim();
      if (!w) return feld.fehler(T.leerFeld);
      let r; try { r = await post("/_kortex/ordner/pruefen", { pfad: w, merke: true }); } catch { return feld.fehler(T.fehler); }
      if (!r.ok) return feld.fehler(GRUENDE[r.grund] || T.fehler);
      erledigt = true; d.schliessen(); fertig({ pfad: r.pfad, ...(r.breit ? { breit: r.breit } : {}), notizen: r.notizen, ordner: r.ordner, ...(r.mehr ? { mehr: true } : {}) });
    });
    feld.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); ja.click(); } });
    (async () => {
      try { start = await (await fetch("/_kortex/ordner/start", { cache: "no-store" })).json(); } catch { start = null; }
      if (erledigt) return;
      const chips = [...(start?.zuletzt || []).map((p) => [p, p]), ...(start?.orte || []).map((p) => [p.split(/[\\/]/).filter(Boolean).pop() || p, p])];
      const einmal = new Set();
      zuletztHost.replaceChildren(...chips.filter(([, p]) => !einmal.has(p) && einmal.add(p)).slice(0, 10).map(([name, p]) => h("button", { type: "button", klasse: "hb-chip", "data-pfad": p, title: p, text: name, aufClick: () => { feld.input.value = p; feld.sync(); feld.fehler(""); zeige(p); } })));
      const anfang = vorschlag || start?.zuletzt?.[0] || start?.home || "";
      if (vorschlag) { feld.input.value = vorschlag; feld.sync(); }
      zeige(anfang);
      feld.fokus();
    })();
  });
}
