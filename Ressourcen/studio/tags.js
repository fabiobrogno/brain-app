// Tags im Studio: Bereich „Tags“ in der Seitenleiste (Zähler, Baum für verschachtelte Tags, Klick = Filter der Notizliste), Vervollständigung beim Tippen von # (tags-quelle.js),
// Einträge in der Befehlspalette (⌘K: „#projekt“) und „Tag im ganzen Vault umbenennen“ mit Vorschau, EINEM Eintrag im Verlauf und Rückgängig.
// Die Arbeit macht die Werkstatt (gemeinsam/tags.mjs, Routen /api/tags, /api/tags/umbenennen); die Regel, was ein Tag ist, steht nur dort.
import { h, dialog, dialogOffen, toast, dateiName, ohneEndung } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { knopf as baueKnopf, textfeld } from "./bausteine.js";
import { oeffneMenue } from "./menue.js";
import { api } from "./api.js";
import { TTG } from "./texte-tags.js";

export const schluessel = (t) => String(t).normalize("NFC").toLowerCase();
const TEIL = "[\\p{L}\\p{N}_-][\\p{L}\\p{M}\\p{N}_-]*"; // wie gemeinsam/tags.mjs (Marken, nie am Anfang)
const NAME_GANZ = new RegExp(`^${TEIL}(?:\\/${TEIL})*$`, "u");
export const pruefeName = (roh) => { const n = String(roh || "").normalize("NFC").trim().replace(/^#/, ""); return n.length <= 100 && /[^\p{N}\p{M}\/]/u.test(n) && NAME_GANZ.test(n) ? n : null; };
const unter = (t, alt) => { const a = schluessel(t), b = schluessel(alt); return a === b || a.startsWith(b + "/"); };

// Baum aus der flachen Liste [{ name, anzahl, direkt }]: Eltern stehen schon darin (mit direkt 0)
export function baueTagBaum(liste) {
  const wurzel = { kinder: [] };
  const knoten = new Map([["", wurzel]]);
  const sortiert = [...liste].sort((a, b) => schluessel(a.name).localeCompare(schluessel(b.name), "de"));
  for (const t of sortiert) {
    const teile = t.name.split("/");
    const k = { name: t.name, label: teile[teile.length - 1], anzahl: t.anzahl, direkt: t.direkt, kinder: [], schl: schluessel(t.name) };
    knoten.set(k.schl, k);
    const eltern = knoten.get(schluessel(teile.slice(0, -1).join("/"))) || wurzel;
    eltern.kinder.push(k);
  }
  return wurzel;
}

// Vorschläge für „#get“: Tags, deren Name (oder ein Teil nach /) so beginnt oder es enthält; häufige zuerst
export function schlageTagsVor(liste, getippt, max = 30) {
  const q = schluessel(getippt || "");
  const wert = (t) => { const k = schluessel(t.name); if (!q) return 3; if (k === q) return -1; if (k.startsWith(q)) return 0; if (k.split("/").some((s) => s.startsWith(q))) return 1; return k.includes(q) ? 2 : 9; };
  return liste.map((t) => ({ t, w: wert(t) })).filter((x) => x.w < 9).sort((a, b) => a.w - b.w || b.t.anzahl - a.t.anzahl || (schluessel(a.t.name) < schluessel(b.t.name) ? -1 : 1)).slice(0, max).map((x) => x.t);
}

export function erzeugeTags(ctx) {
  const { S } = ctx;
  let daten = { tags: [], notizen: 0 };
  const mitgl = new Map(); // Tag (Schlüssel) → Menge der Pfade; wird nur für die gewählte Sicht geholt (die Werkstatt schickt keine Gesamtzuordnung)
  let nr = 0, timer = 0;
  const offen = new Set();
  let offenGeladen = null, gezeichnet = "";
  const leseOffen = () => { const v = S.info?.vault || ""; if (offenGeladen !== v) { offenGeladen = v; offen.clear(); for (const k of ctx.lokal.lies("tagOffen", [])) offen.add(k); } };
  const speichereOffen = () => ctx.lokal.schreib("tagOffen", [...offen]);

  async function laden() {
    if (!S.info?.vault) { daten = { tags: [], notizen: 0 }; mitgl.clear(); ctx.zeichneSeite?.(); return; }
    const mein = ++nr;
    let r;
    try { r = await api.tags(); } catch { return; } // ältere Werkstatt oder Fehler: der Bereich bleibt, wie er war
    if (mein !== nr || !r || !Array.isArray(r.tags)) return;
    const sig = JSON.stringify(r.tags);
    const alt = daten.sig;
    daten = { tags: r.tags, notizen: r.notizen || 0, sig };
    if (sig !== alt) zeichne();
    if (S.sicht.art === "tag") ladeMitglieder(S.sicht.id); // die Liste der gewählten Sicht folgt den Änderungen
  }
  // gebündelt: viele Ereignisse hintereinander (Live, Speichern) → ein Abruf
  function planeLaden(ms) { clearTimeout(timer); timer = setTimeout(laden, ms ?? (daten.sig === undefined ? 0 : 500)); } // der erste Abruf sofort

  const hat = (pfad, tag) => !!mitgl.get(schluessel(tag))?.has(pfad);
  async function ladeMitglieder(tag) {
    const k = schluessel(tag);
    let r;
    try { r = await api.tagNotizen(tag); } catch { return; }
    if (S.sicht.art !== "tag" || schluessel(S.sicht.id) !== k) return; // inzwischen eine andere Sicht
    const neu = new Set((r.notizen || []).map((e) => e.pfad));
    const alt = mitgl.get(k);
    mitgl.clear(); mitgl.set(k, neu);
    if (!alt || alt.size !== neu.size || [...neu].some((p) => !alt.has(p))) ctx.nachTags?.();
  }
  const liste = () => daten.tags;
  const anzahlVon = (tag) => daten.tags.find((t) => schluessel(t.name) === schluessel(tag))?.anzahl || 0;
  const anzeigeName = (tag) => daten.tags.find((t) => schluessel(t.name) === schluessel(tag))?.name || tag;

  // ───────────── Seitenleiste ─────────────
  function zeichne() {
    const sec = document.querySelector('[data-abschnitt="tags"]');
    if (!sec) return;
    leseOffen();
    const aktiv = S.sicht.art === "tag";
    sec.hidden = !daten.tags.length && !aktiv;
    // Nur neu zeichnen, wenn sich etwas ändert: ein Neuzeichnen nimmt der gerade fokussierten Zeile den Fokus und schließt ein offenes Menü
    const sig = JSON.stringify([daten.sig, [...offen], aktiv ? S.sicht.id : null, S.zu.has("tags"), sec.hidden]);
    if (sig === gezeichnet && sec.childElementCount) return;
    gezeichnet = sig;
    if (sec.hidden) { sec.replaceChildren(); return; }
    const wurzel = baueTagBaum(daten.tags);
    const zeilen = [];
    const tief = (k, t) => {
      for (const c of k.kinder) {
        const istOffen = offen.has(c.schl), hatKinder = c.kinder.length > 0;
        const gewaehlt = aktiv && schluessel(S.sicht.id) === c.schl;
        const zeile = h("div", { klasse: "zeile tag-zeile", role: "treeitem", "aria-expanded": hatKinder ? String(istOffen) : null, "aria-current": gewaehlt ? "true" : "false", style: `--tiefe:${t}`,
          "data-tag": c.name, title: TTG.zeile(c.name, c.anzahl), tabindex: "0",
          aufClick: () => ctx.waehleSicht({ art: "tag", id: c.name }), aufContextmenu: (e) => menue(e, c.name),
          aufKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.waehleSicht({ art: "tag", id: c.name }); } } },
          h("span", { klasse: "pfeil" + (istOffen ? " offen" : "") + (hatKinder ? "" : " leer"), role: "button", "aria-label": istOffen ? "Zuklappen" : "Aufklappen",
            aufClick: (ev) => { ev.stopPropagation(); istOffen ? offen.delete(c.schl) : offen.add(c.schl); speichereOffen(); zeichne(); } }, symbol("chevron-rechts", 12)),
          h("span", { klasse: "tag-raute", "aria-hidden": "true", text: "#" }),
          h("span", { klasse: "name", text: c.label }), h("span", { klasse: "dim", text: String(c.anzahl) }));
        zeilen.push(zeile);
        if (istOffen) tief(c, t + 1);
      }
    };
    tief(wurzel, 0);
    ctx.abschnitt("tags", TTG.abschnitt, h("div", { id: "tag-baum", klasse: "baum", role: "tree" }, zeilen.length ? zeilen : h("div", { klasse: "hinweis-leer", text: TTG.leer })));
    // ein gewählter Tag in einem zugeklappten Zweig: Eltern aufklappen
  }
  function klappeAuf(tag) {
    leseOffen();
    const teile = String(tag).split("/");
    let geaendert = false;
    for (let i = 1; i < teile.length; i++) { const k = schluessel(teile.slice(0, i).join("/")); if (!offen.has(k)) { offen.add(k); geaendert = true; } }
    if (geaendert) { speichereOffen(); }
  }

  function menue(ev, tag) {
    ev.preventDefault(); ev.stopPropagation();
    const a = h("div", { klasse: "da-anker", style: `position:fixed;left:${Math.round(ev.clientX)}px;top:${Math.round(ev.clientY)}px;width:0;height:0;pointer-events:none` });
    document.body.append(a);
    oeffneMenue(a, [
      { name: TTG.menue.oeffnen, symbol: "notiz", id: "tag-oeffnen", tun: () => ctx.waehleSicht({ art: "tag", id: tag }) },
      { name: TTG.menue.suche, symbol: "suche", id: "tag-suche", tun: () => ctx.oeffneSuche?.(`tag:${tag}`) },
      { trenner: true },
      { name: TTG.menue.umbenennen, symbol: "stift", id: "tag-umbenennen", tun: () => umbenennen(tag) },
    ], { breite: 224, beiZu: () => setTimeout(() => a.remove(), 150) });
  }

  // ───────────── Umbenennen ─────────────
  const fehlerText = (e) => (e?.status === 400 ? e.message : e?.message || TTG.umbenennen.fehler);
  let umbenennenLaeuft = false;
  async function umbenennen(alt, { vorgabe = "" } = {}) {
    if (dialogOffen() || umbenennenLaeuft || !alt) return;
    const altName = anzeigeName(alt);
    let vorschau = null, neu = null;
    const feld = textfeld({ wert: vorgabe || altName, platzhalter: TTG.umbenennen.platzhalter, label: TTG.umbenennen.label, daten: { "data-feld": "tag-neu" } });
    const inhalt = h("div", { klasse: "tag-vorschau", "data-feld": "tag-vorschau", "aria-live": "polite" });
    const ok = baueKnopf({ text: TTG.umbenennen.knopf, variante: "primaer", aktion: "tag-umbenennen", disabled: true, aufKlick: () => ausfuehren() });
    const pruefeKnopf = baueKnopf({ text: TTG.umbenennen.vorschau, aktion: "tag-vorschau", aufKlick: () => zeigeVorschau() });
    const d = dialog({ titel: TTG.umbenennen.titel(altName), satz: TTG.umbenennen.satz, rumpf: [feld.el, inhalt], knoepfe: [
      baueKnopf({ text: TTG.umbenennen.abbrechen, aktion: "abbrechen", aufKlick: () => d.schliessen() }), pruefeKnopf, ok] });
    d.box.setAttribute("data-dialog", "tag-umbenennen");
    // Enter im Feld = Vorschau; erst die Vorschau schaltet „Umbenennen“ frei
    const eingabe = feld.input;
    eingabe.addEventListener("input", () => { vorschau = null; neu = null; ok.disabled = true; inhalt.replaceChildren(); feld.fehler(""); });
    eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (vorschau && !ok.disabled) ausfuehren(); else zeigeVorschau(); } });
    setTimeout(() => { eingabe.focus(); eingabe.select(); }, 0);

    async function zeigeVorschau() {
      const roh = eingabe.value;
      if (!roh.trim()) { feld.fehler(TTG.umbenennen.leer); return; }
      const n = pruefeName(roh);
      if (!n) { feld.fehler(TTG.umbenennen.ungueltig); return; }
      if (n === altName) { feld.fehler(TTG.umbenennen.gleich); return; }
      inhalt.replaceChildren(h("p", { klasse: "leise", text: TTG.umbenennen.pruefe }));
      let r;
      try { r = await api.tagUmbenennen({ alt: altName, neu: n, vorschau: true }); }
      catch (e) { inhalt.replaceChildren(h("p", { klasse: "da-hinweis", role: "alert", text: fehlerText(e) })); return; }
      if (eingabe.value !== roh) return;
      vorschau = r; neu = n;
      if (r.unveraendert) { inhalt.replaceChildren(h("p", { klasse: "da-hinweis", "data-feld": "tag-nichts", text: TTG.umbenennen.nichts })); ok.disabled = true; return; }
      const zeilen = (r.liste || []).slice(0, 8).map((e) => h("li", { klasse: "da-vz" }, h("div", { klasse: "da-vz-kopf" }, symbol("notiz", 14),
        h("span", { klasse: "da-vz-titel", text: e.titel || ohneEndung(dateiName(e.pfad)) }), h("span", { klasse: "da-vz-zahl", text: String(e.anzahl) }))));
      const rest = (r.liste || []).length - zeilen.length + (r.mehr || 0);
      inhalt.replaceChildren(...[
        h("p", { klasse: "da-satz", "data-feld": "tag-satz", text: TTG.umbenennen.satzVorschau(r.verweise, r.notizen) }),
        h("ul", { klasse: "da-vorschau", "data-feld": "vorschau" }, zeilen, rest > 0 ? h("li", { klasse: "da-vz-mehr", text: TTG.umbenennen.mehr(rest) }) : null),
        r.zusammen ? h("p", { klasse: "da-hinweis", "data-feld": "tag-zusammen", text: TTG.umbenennen.zusammen(n) }) : null,
        r.uebersprungen?.length ? h("p", { klasse: "leise da-hinweis", text: TTG.umbenennen.uebersprungen(r.uebersprungen.length) }) : null].filter(Boolean));
      ok.disabled = false;
    }

    async function ausfuehren() {
      if (!vorschau || !neu || umbenennenLaeuft) return;
      umbenennenLaeuft = true;
      const token = vorschau.token, neuName = neu;
      let frei = () => {};
      try {
        if (!(await ctx.sichereVorWechsel())) return;
        frei = ctx.sperre();
        let erg;
        try { erg = await api.tagUmbenennen({ alt: altName, neu: neuName, token }); }
        catch (e) {
          if (e.status === 409 && e.daten?.art === "vorschau-veraltet") { toast(TTG.umbenennen.veraltet); frei(); frei = () => {}; umbenennenLaeuft = false; await zeigeVorschau(); return; }
          toast(fehlerText(e), { fehler: true }); return;
        }
        d.schliessen();
        await nachErfolg(altName, neuName, erg);
      } finally { frei(); umbenennenLaeuft = false; }
    }
  }

  async function nachErfolg(alt, neu, erg) {
    if (S.sicht.art === "tag" && unter(S.sicht.id, alt)) { const rest = S.sicht.id.slice(alt.length); S.sicht = { ...S.sicht, id: neu + rest }; ctx.merkeSicht?.(); }
    await ctx.ladeBaum();
    await laden();
    if (S.pfad && (erg.geaendert || []).includes(S.pfad)) await ctx.offeneNeuLaden();
    ctx.planeGit?.();
    ctx.nachAenderung?.({ speichern: true });
    toast(TTG.toast.umbenannt(alt, neu, erg.notizen), { ms: 9000, aktion: erg.aktivitaetId ? { text: TTG.toast.rueckgaengig, tun: () => zurueck(erg.aktivitaetId, alt, neu) } : undefined });
  }
  async function zurueck(id, alt, neu) {
    if (!(await ctx.sichereVorWechsel())) return;
    try { await api.aktivitaetRueckgaengig(id); }
    catch (e) { toast(e.status === 409 ? TTG.toast.zurueckFehler : fehlerText(e), { fehler: true }); return; }
    if (S.sicht.art === "tag" && unter(S.sicht.id, neu)) { S.sicht = { ...S.sicht, id: alt + S.sicht.id.slice(neu.length) }; ctx.merkeSicht?.(); }
    await ctx.ladeBaum();
    await laden();
    if (S.pfad) await ctx.offeneNeuLaden();
    ctx.nachAenderung?.({ speichern: true });
    toast(TTG.toast.zurueck, { ms: 5000 });
  }

  // ───────────── Befehlspalette ─────────────
  // „#“ am Anfang oder „tag:“: nur Tags; sonst Tags, deren Name zum getippten Wort passt (höchstens 4, nach den Notizen)
  function paletteTreffer(q) {
    const t = String(q || "").trim();
    if (!t || t.startsWith(">")) return { nur: false, liste: [] };
    const nur = t.startsWith("#") || /^tag:/i.test(t);
    const wort = t.replace(/^#|^tag:/i, "").trim();
    if (!nur && wort.length < 2) return { nur: false, liste: [] };
    const liste = schlageTagsVor(daten.tags, wort, nur ? 12 : 4).filter((x) => nur || schluessel(x.name).includes(schluessel(wort)));
    return { nur, liste };
  }

  return { laden, planeLaden, zeichne, hat, ladeMitglieder, liste, anzahlVon, anzeigeName, umbenennen, paletteTreffer, klappeAuf, vorschlaege: (getippt) => schlageTagsVor(daten.tags, getippt), vorhanden: () => daten.tags.length > 0 };
}
