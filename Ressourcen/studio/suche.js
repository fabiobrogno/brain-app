// Bausteine der Volltext-Suche (Ansicht „Im Vault suchen“ und Abschnitt „Im Inhalt“ der Palette): Markierungen, Treffer-Karten, Filterchips.
// Die Werkstatt liefert Texte samt Markierungs-Bereichen ([[von, bis], …] in UTF-16-Einheiten des Textes); hier entstehen daraus <mark>-Elemente
// (nie innerHTML: Notizinhalt ist Fremdtext).
import { h, dateiName, ohneEndung } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { filterChip } from "./bausteine.js";
import { T } from "./texte.js";
import { ohneMarkdown, neueMarken } from "./suche-text.js";
export { ohneMarkdown, nachAbdeckung } from "./suche-text.js";

const TV = T.volltext;

// → Knoten: Text mit <mark> an den Bereichen (sortiert, nicht überlappend; ungültige werden übersprungen). Markdown-Zeichen werden vorher entfernt (roh: true lässt sie stehen).
export function markiert(text, marken, { roh = false } = {}) {
  let s = String(text ?? "");
  if (!roh) { const o = ohneMarkdown(s); marken = neueMarken(marken, o.karte); s = o.text; }
  const aus = [];
  let pos = 0;
  for (const [von, bis] of [...(marken || [])].sort((a, b) => a[0] - b[0])) {
    if (!(von >= pos && bis > von && bis <= s.length)) continue;
    if (von > pos) aus.push(s.slice(pos, von));
    aus.push(h("mark", { klasse: "treffer", text: s.slice(von, bis) }));
    pos = bis;
  }
  if (pos < s.length) aus.push(s.slice(pos));
  return aus;
}

// Eine Treffer-Karte: Titel (markiert), bis zu drei Fundstellen (jede springt an ihre Stelle), Pfad. Rückgabe: Element mit data-suche="treffer".
// o: { i, ausgewaehlt, typ (Typ-Objekt oder null), symbolFuer(typ), oeffne(t, stelle|null) }
export function trefferKarte(t, o) {
  const stellen = (t.stellen || []).map((st) => h("div", { klasse: "fundstelle", "data-suche": "stelle", role: "button", tabindex: "-1", title: `${TV.palette.zeile(st.zeile)}`,
    aufClick: (e) => { e.stopPropagation(); o.oeffne(t, st); } },
    h("span", { klasse: "fund-zeile", text: String(st.zeile) }),
    h("span", { klasse: "fund-text" }, ...(st.abschnitt ? [h("span", { klasse: "fund-abschnitt", text: `${TV.abschnitt} ${st.abschnitt} · ` })] : []), ...markiert(st.text, st.marken))));
  return h("div", { klasse: "karte such-karte", role: "option", "data-suche": "treffer", "data-karte": "", "data-pfad": t.pfad, "aria-selected": String(!!o.ausgewaehlt), aufClick: () => o.oeffne(t, t.stellen?.[0] || null) },
    h("div", { klasse: "karte-kopf" },
      h("div", { klasse: "karte-titel" }, ...markiert(t.titel || ohneEndung(dateiName(t.pfad)), t.titelMarken)),
      h("div", { klasse: "karte-marken" }, o.symbolFuer ? o.symbolFuer(o.typ) : symbol("notiz", 14))),
    stellen.length ? h("div", { klasse: "fundstellen" }, stellen) : (t.auszug ? h("div", { klasse: "auszug", text: ohneMarkdown(t.auszug).text }) : null),
    h("div", { klasse: "pfadzeile" }, h("span", { klasse: "pfad-text", text: t.pfad }), t.anzahl > 1 ? h("span", { klasse: "anzahl", text: TV.stellen(t.anzahl) }) : null));
}

// Filter-Chips unter dem Suchfeld. Die Eingabe bleibt die Wahrheit: ein Chip schreibt/entfernt sein „schluessel:wert“ im Text (aufWahl(schluessel, wert|"")).
// facetten: { typ: [{ wert, anzahl }], ordner, tag, status } oder null · filter: Liste der gerade gültigen Filter aus der Antwort
export function chipLeiste(facetten, filter, aufWahl) {
  const aktiv = (k) => (filter || []).find((f) => f.schluessel === k && !f.neg && f.gueltig !== false)?.wert ?? "";
  const chips = [];
  const mach = (k, optionen) => {
    const a = aktiv(k);
    const opt = [{ wert: "", text: TV.chips.alle }, ...optionen];
    if (a && !opt.some((o) => o.wert === a)) opt.push({ wert: a, text: a });
    chips.push(filterChip({ label: TV.chips[k], optionen: opt, wert: a, standard: "", daten: { "data-filter": k, "data-such-chip": k }, aufAenderung: (w) => aufWahl(k, w) }));
  };
  for (const k of ["typ", "ordner", "tag", "status"]) {
    const liste = facetten?.[k] || [];
    if (liste.length || aktiv(k)) mach(k, liste.map((f) => ({ wert: f.wert, text: f.wert, sub: String(f.anzahl) })));
  }
  const z = aktiv("geaendert");
  const zeitOpt = TV.zeit.map(([wert, text]) => ({ wert, text }));
  const aw = z || "";
  if (aw && !zeitOpt.some((o) => o.wert === aw)) zeitOpt.push({ wert: aw, text: aw });
  chips.push(filterChip({ label: TV.chips.geaendert, optionen: zeitOpt, wert: aw, standard: "", daten: { "data-filter": "geaendert", "data-such-chip": "geaendert" }, aufAenderung: (w) => aufWahl("geaendert", w) }));
  return h("div", { klasse: "such-chips", role: "group", "aria-label": "Filter" }, chips);
}

// Text → Eingabe mit gesetztem/entferntem Filter. roh = Wortlaut des bisherigen Filters aus der Antwort (damit genau er verschwindet).
export function mitFilter(eingabe, bisherige, schluessel, wert) {
  let t = String(eingabe);
  for (const f of bisherige || []) if (f.schluessel === schluessel && !f.neg && f.roh) t = t.replace(new RegExp("(^|\\s)" + f.roh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=\\s|$)"), "$1 "); // nur das ganze Wort, nicht „xtyp:a“
  t = t.replace(/\s+/g, " ").trim();
  if (wert) t = (t + " " + schluessel + ":" + (/\s/.test(wert) ? `"${wert}"` : wert)).trim();
  return t;
}
