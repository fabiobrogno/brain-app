// Umbenennen, Verschieben und Papierkorb im Studio: Kontextmenü (Notizkarten, Ordner, Titel im Editor), Umbenennen direkt an Ort und Stelle, Ordner-Wähler,
// Ziehen und Ablegen, F2 / ⌘⌫, die Ansicht „Papierkorb“. Die Arbeit macht die Werkstatt (gemeinsam/dateiaktionen.mjs, Routen /api/notiz/*, /api/ordner/*, /api/papierkorb/*);
// hier steht der Ablauf: speichern → Vorschau („N Verweise in M Notizen“) → bestätigen, wenn Verweise betroffen sind → sofort zeigen (optimistisch) → ausführen → bei Fehler zurückrollen.
// Eine Aktion ist EIN Eintrag im Aktivitätsprotokoll; „Rückgängig“ im Hinweis nimmt genau diesen Eintrag zurück (POST /api/aktivitaet/rueckgaengig).
import { h, dialog, dialogOffen, toast, dateiName, ohneEndung, ordnerVon } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { knopf as baueKnopf, textfeld, leerBlock } from "./bausteine.js";
import { oeffneMenue } from "./menue.js";
import { api } from "./api.js";
import { lockerFormen } from "./wikilink.js";
import { TD } from "./texte-dateiaktionen.js";

const MIME = "application/x-kortex-eintrag";
const FESTE_ORDNER = (S) => new Set([S.inboxOrdner || "00_inbox", S.aufgabenOrdner || "05_aufgaben", "09_wiki", "90_archiv", "01_vorlagen", S.vorlagenOrdner || "01_vorlagen"].map((x) => String(x).toLowerCase()));
const ungueltigerName = (n) => /[\/\\:\u0000-\u001f]/.test(n) || n.startsWith(".");
const naechster = (liste, i, d) => (liste.length ? (i + d + liste.length) % liste.length : 0);

export function erzeugeDateiaktionen(ctx) {
  const { S } = ctx;
  let laeuft = false;       // eine Aktion zugleich
  let ziehend = null;       // { art, pfad } während des Ziehens
  let edit = null;          // laufende Umbenennung an Ort und Stelle: { art, pfad, text }
  const selbstAngewandt = new Set(); // Protokoll-Ids der Vorgänge dieses Studios (schon angewandt): ihr Live-Ereignis ändert den Ort der offenen Notiz nicht noch einmal

  // ───────────── Pfade und Zustand ─────────────
  const istFest = (pfad) => !pfad.includes("/") && FESTE_ORDNER(S).has(pfad.toLowerCase());
  // Nach Segmenten (NFC-gefaltet), nicht nach Zeichen: ein Ordner „Übungen“ als NFD im Dateisystem und als NFC im Link ist nicht gleich lang
  const falteSeg = (x) => String(x).normalize("NFC");
  const unterPfad = (p, von) => { const ps = p.split("/"), vs = von.split("/"); return ps.length >= vs.length && vs.every((v, i) => falteSeg(ps[i]) === falteSeg(v)) ? ps.slice(vs.length) : null; };
  const abbilder = (typ, von, nach) => (p) => { const rest = unterPfad(p, von); return rest && (typ === "ordner" || !rest.length) ? [nach, ...rest].join("/") : p; };
  const nachName = (pfad, name) => (ordnerVon(pfad) ? ordnerVon(pfad) + "/" : "") + name;
  const notiz = (pfad) => S.nMap.get(pfad);
  const geschuetzt = (pfad) => { const n = notiz(pfad); const e = S.eintraege.get(pfad); return !!(n?.generiert || e?.schreibschutz); };

  function schnappschuss() {
    return { baum: S.baum, eintraege: S.eintraege, notizen: S.notizen, nMap: S.nMap, pfad: S.pfad, zuletzt: S.zuletzt, favoriten: S.favoriten, offen: S.offen, sicht: S.sicht, ansichtMitglieder: S.ansichtMitglieder, papierkorbAnzahl: S.papierkorbAnzahl };
  }
  function stelleHer(s) { Object.assign(S, s); ctx.nachAenderung(); }

  // Sofort zeigen, was kommt: Baum, Index, offene Notiz, Zuletzt, Favoriten, aufgeklappte Ordner. Rückweg: stelleHer(schnappschuss()).
  function wendeAn({ typ, von, nach, titel = null, entfernen = false }) {
    const abb = abbilder(typ, von, nach);
    const drin = (p) => { const r = unterPfad(p, von); return !!r && (typ === "ordner" || !r.length); };
    if (entfernen) {
      S.baum = S.baum.filter((e) => !drin(e.pfad));
      S.notizen = S.notizen.filter((n) => !drin(n.pfad));
      S.zuletzt = S.zuletzt.filter((p) => !drin(p));
      S.favoriten = new Set([...S.favoriten].filter((p) => !drin(p)));
      S.papierkorbAnzahl = (S.papierkorbAnzahl || 0) + 1;
    } else {
      S.baum = S.baum.map((e) => (drin(e.pfad) ? { ...e, pfad: abb(e.pfad) } : e));
      S.notizen = S.notizen.map((n) => (drin(n.pfad) ? { ...n, pfad: abb(n.pfad), bereich: ctx.bereichVonPfad(abb(n.pfad)), ...(titel !== null && n.pfad === von ? { titel } : {}) } : n));
      S.zuletzt = S.zuletzt.map(abb);
      S.favoriten = new Set([...S.favoriten].map(abb));
    }
    S.eintraege = new Map(S.baum.map((e) => [e.pfad, e]));
    S.nMap = new Map(S.notizen.map((n) => [n.pfad, n]));
    S.ansichtMitglieder = Object.fromEntries(Object.entries(S.ansichtMitglieder || {}).map(([k, l]) => [k, l.filter((n) => !entfernen || !drin(n.pfad)).map((n) => S.nMap.get(abb(n.pfad)) || n)]));
    if (typ === "ordner") S.offen = new Set([...S.offen].map(abb).filter((p) => !(entfernen && drin(p))));
    if (S.sicht.art === "ordner" && drin(S.sicht.id)) S.sicht = entfernen ? { art: "bereich", id: "alle" } : { ...S.sicht, id: abb(S.sicht.id) };
    if (S.pfad && drin(S.pfad)) {
      if (entfernen) ctx.schliesseDatei(); else S.pfad = abb(S.pfad);
    }
    ctx.nachAenderung({ speichern: true });
  }

  // ───────────── Aufruf der Werkstatt ─────────────
  const rufe = (typ, art, daten) => api.dateiAktion(typ, art === "loeschen" ? "loeschen" : art, daten);
  const fehlerText = (e) => (e?.status === 409 && e?.daten?.art === "belegt" ? TD.toast.belegt : e?.message || TD.toast.fehler);

  // ───────────── Bestätigen mit Vorschau ─────────────
  const kurz = (s, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  function vorschauListe(liste, mehr) {
    const zeilen = liste.slice(0, 6).map((e) => h("li", { klasse: "da-vz" },
      h("div", { klasse: "da-vz-kopf" }, symbol("notiz", 14), h("span", { klasse: "da-vz-titel", text: e.titel || ohneEndung(dateiName(e.pfad)) }), e.anzahl ? h("span", { klasse: "da-vz-zahl", text: String(e.anzahl) }) : null),
      e.zeilen?.[0] ? h("div", { klasse: "da-vz-code" }, h("span", { klasse: "da-vorher", text: kurz(e.zeilen[0].vorher) }), h("span", { klasse: "da-pfeil" }, symbol("pfeil", 12)), h("span", { klasse: "da-nachher", text: kurz(e.zeilen[0].nachher) })) : null));
    const rest = liste.length - zeilen.length + (mehr || 0);
    return h("ul", { klasse: "da-vorschau", "data-feld": "vorschau" }, zeilen, rest > 0 ? h("li", { klasse: "da-vz-mehr", text: TD.vorschau.mehr(rest) }) : null);
  }
  function bestaetige({ art, typ, vorschau, name }) {
    return new Promise((fertig) => {
      let ja = false;
      let rumpf, titel, satz, knopf;
      if (art === "loeschen") {
        const verl = vorschau.verlinktVon || [];
        titel = typ === "ordner" ? TD.loeschen.titelOrdner : TD.loeschen.titelNotiz;
        satz = verl.length ? undefined : TD.loeschen.satzOrdner(vorschau.notizenImOrdner || 0);
        rumpf = verl.length ? [h("p", { klasse: "da-satz" }, h("b", { text: `„${name}“ ` }), TD.loeschen.verlinkt(verl.length) + "."), vorschauListe(verl.map((v) => ({ pfad: v.pfad, titel: v.titel, anzahl: v.anzahl, zeilen: [] })), 0), h("p", { klasse: "leise da-hinweis", text: TD.loeschen.satzVerlinkt })] : [];
        knopf = TD.loeschen.knopf;
      } else {
        titel = art === "umbenennen" ? TD.vorschau.titelUmbenennen : TD.vorschau.titelVerschieben;
        const datei = vorschau.nach && vorschau.nach !== vorschau.von && typ === "datei" ? h("p", { klasse: "da-datei", "data-feld": "datei" }, symbol("notiz", 12), h("span", { text: vorschau.von }), h("span", { klasse: "da-pfeil" }, symbol("pfeil", 12)), h("span", { text: vorschau.nach })) : null;
        rumpf = [h("p", { klasse: "da-satz", "data-feld": "satz" }, TD.vorschau.verweise(vorschau.verweise, vorschau.notizen)), datei, vorschauListe(vorschau.liste || [], vorschau.mehr),
          vorschau.uebersprungen?.length ? h("p", { klasse: "leise da-hinweis", text: TD.vorschau.uebersprungen(vorschau.uebersprungen.length) }) : null];
        knopf = art === "umbenennen" ? TD.vorschau.umbenennenKnopf : TD.vorschau.verschiebenKnopf;
      }
      const d = dialog({ titel, satz, breit: false, rumpf, knoepfe: [
        baueKnopf({ text: TD.vorschau.abbrechen, aktion: "abbrechen", aufKlick: () => d.schliessen() }),
        baueKnopf({ text: knopf, variante: art === "loeschen" ? "gefahr" : "primaer", aktion: "bestaetigen", aufKlick: () => { ja = true; d.schliessen(); } })], beiSchliessen: () => fertig(ja) });
      d.box.setAttribute("data-dialog", "dateiaktion");
      if (art === "loeschen") d.box.querySelector('[data-aktion="bestaetigen"]')?.classList.add("primaer");
    });
  }

  // Ein Pfad (Notiz oder Ordner) hat sich geändert: Zurück/Vor folgt, ein offener Entwurf ohne Datei (fester Pfad der Tagesnotiz, Ordner) auch, und die Werkstatt zieht gemerkte
  // Entwürfe mit. typ: "datei" | "ordner" | null (unbekannt, z. B. aus einem Live-Ereignis: gilt für beides)
  function pfadGeaendert(typ, von, nach) {
    if (!von || !nach || von === nach) return;
    const sch = ctx.schreiben?.();
    if (typ !== "ordner") sch?.umbenannt(von, nach);
    if (typ !== "datei") sch?.ordnerUmbenannt(von, nach);
    const e = S.entwurf, abb = abbilder("ordner", von, nach);
    if (e) { if (e.pfad) e.pfad = abb(e.pfad); if (e.ordner) e.ordner = abb(e.ordner); }
    ctx.entwurfVerschoben?.(von, nach);
  }

  // Ordner der Tagesnotizen (App-Einstellung): Umbenennen/Verschieben des Ordners (oder eines Elternordners) fragt einmal nach und zieht die Einstellung mit, damit „Heute“
  // nicht still einen neuen Ordner am alten Ort anlegt. Notizen darin lassen sich wie alle anderen umbenennen.
  const tagOrdner = () => String(ctx.tagesnotizOrdner?.() || "").replace(/^\/+|\/+$/g, "");
  const beruehrtTagOrdner = (spec) => spec.typ === "ordner" && !!tagOrdner() && !!unterPfad(tagOrdner(), spec.pfad);
  function bestaetigeTagOrdner(art) {
    return new Promise((fertig) => {
      let ja = false;
      const d = dialog({ titel: TD.tagOrdner.titel, satz: art === "loeschen" ? TD.tagOrdner.loeschen : TD.tagOrdner.umbenennen, knoepfe: [
        baueKnopf({ text: TD.tagOrdner.abbrechen, aktion: "abbrechen", aufKlick: () => d.schliessen() }),
        baueKnopf({ text: TD.tagOrdner.weiter, variante: "primaer", aktion: "tag-ordner-weiter", aufKlick: () => { ja = true; d.schliessen(); } })], beiSchliessen: () => fertig(ja) });
      d.box.setAttribute("data-dialog", "tag-ordner");
    });
  }
  async function folgeTagOrdner(typ, von, nach) {
    const alt = tagOrdner();
    if (typ !== "ordner" || !alt || !von || !nach || von === nach || !unterPfad(alt, von)) return;
    try { await ctx.setzeTagesnotizOrdner([nach, ...unterPfad(alt, von)].join("/")); }
    catch { toast(TD.tagOrdner.einstellungFehler, { fehler: true, ms: 10000 }); }
  }

  // ───────────── Der Ablauf einer Aktion ─────────────
  // spec: { art: "umbenennen"|"verschieben"|"loeschen", typ: "datei"|"ordner", pfad, daten: {titel|dateiname|name|ziel…}, nach (neuer Pfad, nur zum Anzeigen), titel (neuer Titel) }
  async function fuehre(spec) {
    if (laeuft || !spec.pfad) return false; // ein Entwurf ohne Datei (S.pfad leer) hat nichts umzubenennen
    laeuft = true;
    let frei = () => {};
    try {
      if (!(await ctx.sichereVorWechsel())) return false;
      if (beruehrtTagOrdner(spec) && !(await bestaetigeTagOrdner(spec.art))) return false;
      frei = ctx.sperre();
      const anzeigeName = notiz(spec.pfad)?.titel || dateiName(spec.pfad);
      // Anhänge, die nur diese Notiz benutzt: Kortex fragt, was damit geschehen soll (mit in den Papierkorb oder behalten), nie endgültig löschen
      let anhangWahl = { anhaenge: [] };
      if (spec.art === "loeschen" && spec.typ === "datei" && ctx.anhaenge) { anhangWahl = await ctx.anhaenge.vorLoeschen(spec.pfad); if (anhangWahl.abbruch) return false; }
      let vorschau;
      for (let versuch = 0; versuch < 2; versuch++) {
        vorschau = await rufe(spec.typ, spec.art, { ...spec.daten, pfad: spec.pfad, vorschau: true });
        if (vorschau.unveraendert) return false;
        const fragen = spec.art === "loeschen" ? ((vorschau.verlinktVon?.length || 0) > 0 || spec.typ === "ordner") : (vorschau.verweise > 0 || vorschau.uebersprungen?.length > 0);
        if (fragen && !(await bestaetige({ art: spec.art, typ: spec.typ, vorschau, name: anzeigeName }))) return false;
        const nach = spec.art === "loeschen" ? null : vorschau.nach;
        const snap = schnappschuss();
        wendeAn({ typ: spec.typ, von: spec.pfad, nach: nach || spec.pfad, titel: spec.titel ?? null, entfernen: spec.art === "loeschen" });
        let erg;
        try { erg = await rufe(spec.typ, spec.art, { ...spec.daten, pfad: spec.pfad, token: vorschau.token, ...(vorschau.hash ? { basisHash: vorschau.hash } : {}) }); }
        catch (e) {
          stelleHer(snap);
          if (e.status === 409 && e.daten?.art === "vorschau-veraltet" && versuch === 0) { toast(TD.vorschau.veraltet); continue; }
          toast(fehlerText(e), { fehler: true });
          return false;
        }
        await nachErfolg(spec, erg);
        if (anhangWahl.anhaenge.length) await ctx.anhaenge.nachLoeschen(anhangWahl.anhaenge);
        return true;
      }
      return false;
    } catch (e) {
      toast(fehlerText(e), { fehler: true });
      return false;
    } finally { frei(); laeuft = false; }
  }

  async function nachErfolg(spec, erg) {
    const text = spec.art === "umbenennen" ? TD.toast.umbenannt : spec.art === "verschieben" ? TD.toast.verschoben : TD.toast.papierkorb;
    if (spec.art === "loeschen") ctx.schreiben?.().entfernt(spec.pfad, spec.typ === "ordner");
    else { if (erg.aktivitaetId) selbstAngewandt.add(erg.aktivitaetId); pfadGeaendert(spec.typ, erg.von, erg.nach); await folgeTagOrdner(spec.typ, erg.von, erg.nach); }
    await ctx.ladeBaum();
    ladeKorbZahl();
    if (S.pfad && spec.art !== "loeschen") {
      const abb = abbilder(spec.typ, erg.von, erg.nach);
      // Hat sich die offene Notiz selbst geändert (Titel, Verweise), kommt ihr Text frisch von der Platte
      if ((erg.geaendert || []).includes(abb(S.pfad)) || erg.pfad === S.pfad) await ctx.offeneNeuLaden();
    }
    ctx.planeGit();
    toast(text, { ms: 8000, aktion: erg.aktivitaetId ? { text: TD.toast.rueckgaengig, tun: () => zurueck(erg.aktivitaetId) } : undefined });
  }

  // Rückgängig (und danach Wiederholen) über den Eintrag im Aktivitätsprotokoll
  async function zurueck(id, { teilweise = false, wieder = false } = {}) {
    if (!(await ctx.sichereVorWechsel())) return;
    let r;
    try { r = await (wieder ? api.aktivitaetWiederherstellen(id, undefined, teilweise) : api.aktivitaetRueckgaengig(id, undefined, teilweise)); }
    catch (e) {
      if (e.status === 409 && e.daten?.art === "geaendert" && !teilweise) {
        const n = (e.daten.dateien || []).length || 1;
        const d = dialog({ titel: TD.rueckgaengigGeaendert.titel, satz: TD.rueckgaengigGeaendert.satz(n), knoepfe: [
          baueKnopf({ text: TD.rueckgaengigGeaendert.abbrechen, aufKlick: () => d.schliessen() }),
          baueKnopf({ text: TD.rueckgaengigGeaendert.knopf, variante: "primaer", aktion: "trotzdem", aufKlick: () => { d.schliessen(); zurueck(id, { teilweise: true, wieder }); } })] });
        return;
      }
      toast(fehlerText(e), { fehler: true });
      return;
    }
    if (r.protokollId) selbstAngewandt.add(r.protokollId);
    pfadGeaendert(r.typ === "ordner" ? "ordner" : r.typ === "datei" ? "datei" : null, r.von, r.nach);
    await folgeTagOrdner(r.typ, r.von, r.nach);
    // Wo liegt die offene Notiz jetzt?
    if (S.pfad && r.von && r.nach && r.von !== r.nach) {
      const abb = abbilder(r.typ === "ordner" ? "ordner" : "datei", r.von, r.nach);
      S.pfad = abb(S.pfad);
    }
    if (S.sicht.art === "ordner" && r.typ === "ordner" && r.von && r.nach) S.sicht = { ...S.sicht, id: abbilder("ordner", r.von, r.nach)(S.sicht.id) };
    await ctx.ladeBaum();
    ladeKorbZahl();
    if (S.pfad && !S.eintraege.has(S.pfad)) ctx.schliesseDatei(); else if (S.pfad) await ctx.offeneNeuLaden();
    ctx.nachAenderung({ speichern: true });
    const art = r.vorgangArt || "umbenennen";
    toast(wieder ? "Wieder ausgeführt" : TD.toast.zurueck[art] || TD.toast.zurueck.umbenennen, { ms: 6000, aktion: wieder ? undefined : { text: "Wiederholen", tun: () => zurueck(id, { wieder: true }) } });
  }

  // ───────────── Umbenennen: Notiz ─────────────
  const dateinameFolgtTitel = (n, pfad) => {
    const basis = ohneEndung(dateiName(pfad)), titel = n?.titel || basis;
    return lockerFormen(basis)[0] === lockerFormen(titel)[0];
  };
  // ort: "karte" (Titel in der Liste) oder "titel" (Titel in der Kopfzeile des Editors)
  function umbenennenNotiz(pfad, ort = null) {
    if (!pfad || geschuetzt(pfad)) return;
    const n = notiz(pfad);
    const o = ort || (S.pfad === pfad ? "titel" : "karte");
    const ziel = ctx.titelElement(pfad, o);
    const alt = n?.titel || ohneEndung(dateiName(pfad));
    beginneInline({ art: "datei", pfad, ort: o, ziel, text: alt, pruefe: (t) => (t.length > 200 ? TD.umbenennen.zuLang : null), beiFertig: (neu) => {
      if (neu === alt) return;
      fuehre({ art: "umbenennen", typ: "datei", pfad, daten: { titel: neu, dateinameAusTitel: dateinameFolgtTitel(n, pfad) }, titel: neu });
    } });
  }
  // ───────────── Umbenennen: Ordner ─────────────
  function umbenennenOrdner(pfad) {
    if (!pfad || istFest(pfad)) return;
    const ziel = document.querySelector(`#baum .zeile[data-pfad="${CSS.escape(pfad)}"] .name`);
    const alt = dateiName(pfad);
    beginneInline({ art: "ordner", pfad, ziel, text: alt, pruefe: (t) => (ungueltigerName(t) ? TD.umbenennen.ungueltig : t.length > 200 ? TD.umbenennen.zuLang : null), beiFertig: (neu) => {
      if (neu === alt) return;
      fuehre({ art: "umbenennen", typ: "ordner", pfad, daten: { name: neu } });
    } });
  }

  // Ein Eingabefeld statt des Textes (kein Fensterwechsel, kein Dialog). Enter und Klick daneben übernehmen, Esc verwirft. Zeichnet die Oberfläche währenddessen neu, kommt das Feld mit dem getippten Text zurück.
  function beginneInline(o) {
    if (!o.ziel || !o.ziel.isConnected) return;
    if (edit) beendeInline(true);
    edit = { ...o, getippt: o.text };
    baueInline();
  }
  function baueInline() {
    if (!edit) return;
    const ziel = edit.art === "ordner" ? document.querySelector(`#baum .zeile[data-pfad="${CSS.escape(edit.pfad)}"] .name`) : (edit.ziel?.isConnected ? edit.ziel : ctx.titelElement(edit.pfad, edit.ort));
    if (!ziel) return;
    edit.ziel = ziel;
    const karte = ziel.closest("[data-karte]");
    if (karte) karte.draggable = false;
    const zeile = ziel.closest(".zeile");
    if (zeile) zeile.draggable = false;
    const feld = textfeld({ wert: edit.getippt, label: edit.art === "ordner" ? TD.umbenennen.ordner : TD.umbenennen.notiz, klasse: "inline-feld", groesse: "s", daten: { "data-inline": edit.art } });
    const input = feld.input;
    input.classList.add("inline-name");
    const hinweis = h("div", { klasse: "inline-hinweis", role: "alert", hidden: true });
    ziel.hidden = true;
    ziel.after(feld.el, hinweis);
    input.dataset.fertig = "0";
    const pruefen = () => { const t = input.value.trim(); const f = !t ? TD.umbenennen.leer : edit.pruefe(t); if (f && t) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); hinweis.hidden = !f || !t; hinweis.textContent = f && t ? f : ""; input.title = f && t ? f : ""; return f; };
    input.addEventListener("input", () => { edit.getippt = input.value; pruefen(); });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "Enter") { e.preventDefault(); uebernehmen(input, hinweis, pruefen); }
      else if (e.key === "Escape") { e.preventDefault(); beendeInline(true); }
    });
    for (const ev of ["click", "dblclick", "mousedown", "pointerdown", "dragstart"]) input.addEventListener(ev, (e) => e.stopPropagation());
    // Zeichnet die Oberfläche neu (Live-Ereignis, Fensterfokus), meldet Chromium „blur“, solange das Feld noch im Dokument hängt. Sofort entschieden, endete
    // das Umbenennen dabei, ein gültiger halb getippter Name wurde sogar übernommen. Darum erst nach dem laufenden Schritt entscheiden: Ist das Feld dann
    // nicht mehr im Dokument, war es das Neuzeichnen, und nachZeichnen() bringt es zurück.
    input.addEventListener("blur", () => { queueMicrotask(() => { if (edit && input.isConnected && document.activeElement !== input) uebernehmen(input, hinweis, pruefen, true); }); });
    const erneut = edit.gebaut;
    edit.gebaut = true;
    requestAnimationFrame(() => {
      if (!input.isConnected) return;
      input.focus({ preventScroll: true });
      if (erneut) { input.setSelectionRange(input.value.length, input.value.length); pruefen(); } else input.select(); // nach dem Neuzeichnen weiter am Ende tippen, nicht alles ersetzen
    });
  }
  function uebernehmen(input, hinweis, pruefen, ausBlur = false) {
    if (!edit) return;
    const t = input.value.trim().replace(/\s+/g, " ");
    const fehler = pruefen();
    if (!t || t === edit.text) { beendeInline(true); return; }
    if (fehler) {
      if (ausBlur) { beendeInline(true); return; }
      input.classList.remove("wackeln"); void input.offsetWidth; input.classList.add("wackeln");
      return;
    }
    const fertig = edit.beiFertig;
    beendeInline(false);
    fertig(t);
  }
  function beendeInline(verwerfen) {
    const e = edit;
    edit = null;
    if (!e) return;
    for (const x of document.querySelectorAll(".inline-feld, .inline-hinweis")) x.remove();
    if (e.ziel) e.ziel.hidden = false;
    const k = e.ziel?.closest?.("[data-karte]"); if (k) k.draggable = true;
    const z = e.ziel?.closest?.(".zeile"); if (z) z.draggable = !istFest(z.dataset.pfad || "");
    if (verwerfen && document.activeElement === document.body) ctx.fokusZurueck?.();
  }
  const nachZeichnen = () => { if (edit) { for (const x of document.querySelectorAll(".inline-feld, .inline-hinweis")) x.remove(); baueInline(); } };

  // ───────────── Verschieben: Ordner wählen ─────────────
  function waehleOrdner({ typ, pfad }) {
    return new Promise((fertig) => {
      const aktuell = ordnerVon(pfad);
      const ausgeschlossen = (p) => typ === "ordner" && !!unterPfad(p, pfad);
      const alle = [{ pfad: "", name: TD.verschieben.wurzel, tiefe: 0 }, ...S.baum.filter((e) => e.art === "ordner" && !ausgeschlossen(e.pfad)).map((e) => ({ pfad: e.pfad, name: dateiName(e.pfad), tiefe: e.pfad.split("/").length }))];
      const feld = textfeld({ platzhalter: TD.verschieben.platzhalter, label: TD.verschieben.platzhalter, klasse: "pal-feld", symbol: "ordner", daten: { role: "combobox", "aria-expanded": "true", "aria-controls": "ov-liste" } });
      const liste = h("div", { klasse: "pal-liste", role: "listbox", id: "ov-liste", "data-kanten": true });
      let eintraege = [], idx = 0, gewaehlt = null;
      const norm = (s) => lockerFormen(s)[0] || "";
      const zeichne = () => {
        const q = norm(feld.input.value.trim());
        eintraege = q ? alle.filter((o) => o.pfad && (norm(o.pfad).includes(q))).sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)) || a.pfad.length - b.pfad.length || a.pfad.localeCompare(b.pfad, "de"))
          : alle;
        if (idx >= eintraege.length) idx = Math.max(0, eintraege.length - 1);
        liste.replaceChildren(...(eintraege.length ? eintraege.map((o, i) => {
          const hier = o.pfad === aktuell;
          return h("div", { klasse: "pal-eintrag ov-eintrag" + (hier ? " ov-hier" : ""), role: "option", "aria-selected": String(i === idx), "aria-disabled": hier ? "true" : null, "data-ordner": o.pfad, style: q ? null : `--ov-tiefe:${Math.max(0, o.tiefe - 1)}`,
            aufMouseenter: () => { idx = i; markiere(); }, aufClick: () => waehle(i) },
            symbol(o.pfad ? "ordner" : "vault", 16), h("span", { klasse: "n", text: o.name }), h("span", { klasse: "r", text: hier ? TD.verschieben.hier : (q && ordnerVon(o.pfad)) || "" }));
        }) : [h("div", { klasse: "ov-leer", text: TD.verschieben.leer })]));
      };
      const markiere = () => { [...liste.querySelectorAll(".pal-eintrag")].forEach((el, i) => el.setAttribute("aria-selected", String(i === idx))); liste.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); };
      const waehle = (i) => { const o = eintraege[i]; if (!o || o.pfad === aktuell) return; gewaehlt = o.pfad; d.schliessen(); };
      feld.input.addEventListener("input", () => { idx = 0; zeichne(); });
      feld.input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); idx = naechster(eintraege, idx, 1); markiere(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); idx = naechster(eintraege, idx, -1); markiere(); }
        else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); waehle(idx); }
      });
      (feld.el.querySelector(".bs-feld") || feld.el).append(h("kbd", { klasse: "pal-esc", text: TD.verschieben.esc }));
      const name = typ === "ordner" ? dateiName(pfad) : (notiz(pfad)?.titel || ohneEndung(dateiName(pfad)));
      const kopf = h("div", { klasse: "ov-kopf" }, symbol(typ === "ordner" ? "ordner" : "notiz", 14), h("span", { text: TD.verschieben.titel(name) }));
      const fuss = h("footer", { klasse: "pal-fuss" }, h("span", { klasse: "pal-hinweis" }, h("kbd", { text: "↑" }), h("kbd", { text: "↓" }), TD.verschieben.waehlen), h("span", { klasse: "pal-hinweis" }, h("kbd", { text: "↵" }), TD.verschieben.verschiebenKnopf));
      const d = dialog({ eigen: h("div", { klasse: "palette ordner-waehler", role: "dialog", "aria-modal": "true", "aria-label": TD.verschieben.titel(name), "data-dialog": "ordner-waehler" }, kopf, feld.el, liste, fuss), beiSchliessen: () => fertig(gewaehlt) });
      feld.input.focus();
      zeichne();
    });
  }
  async function verschiebe(typ, pfad, ziel) {
    if (typ === "ordner" && istFest(pfad)) return;
    if (ordnerVon(pfad) === ziel) return;
    if (typ === "ordner" && unterPfad(ziel, pfad)) { toast(TD.verschieben.ordnerSelbst, { fehler: true }); return; }
    return fuehre({ art: "verschieben", typ, pfad, daten: { ziel } });
  }
  async function verschiebenNotiz(pfad) { if (dialogOffen() || !pfad || geschuetzt(pfad)) return; const ziel = await waehleOrdner({ typ: "datei", pfad }); if (ziel !== null) verschiebe("datei", pfad, ziel); }
  async function verschiebenOrdner(pfad) { if (dialogOffen() || !pfad || istFest(pfad)) return; const ziel = await waehleOrdner({ typ: "ordner", pfad }); if (ziel !== null) verschiebe("ordner", pfad, ziel); }

  const papierkorbNotiz = (pfad) => { if (!pfad || geschuetzt(pfad)) return; return fuehre({ art: "loeschen", typ: "datei", pfad, daten: {} }); };
  const papierkorbOrdner = (pfad) => { if (!pfad || istFest(pfad)) return; return fuehre({ art: "loeschen", typ: "ordner", pfad, daten: {} }); };

  // ───────────── Kontextmenü ─────────────
  function ankerBei(x, y) {
    const a = h("div", { klasse: "da-anker", style: `position:fixed;left:${Math.round(x)}px;top:${Math.round(y)}px;width:0;height:0;pointer-events:none` });
    document.body.append(a);
    return a;
  }
  function menueBei(ev, eintraege) {
    ev.preventDefault(); ev.stopPropagation();
    if (!eintraege.length) return;
    const a = ankerBei(ev.clientX, ev.clientY);
    oeffneMenue(a, eintraege, { breite: 224, beiZu: () => setTimeout(() => a.remove(), 150) });
  }
  function notizEintraege(pfad, { oeffnen = true, ort = "karte" } = {}) {
    const aus = [];
    if (oeffnen) aus.push({ name: TD.menue.oeffnen, symbol: "notiz", id: "oeffnen", tun: () => ctx.oeffne(pfad) });
    const extra = ctx.zusatzEintraege?.("notiz", pfad) || []; // Export, Kopieren, Teilen (export.js): nur lesend, darum auch bei geschützten Notizen
    if (extra.length) { if (aus.length) aus.push({ trenner: true }); aus.push(...extra); }
    if (!geschuetzt(pfad)) {
      if (aus.length) aus.push({ trenner: true });
      aus.push({ name: TD.menue.umbenennen, symbol: "stift", sub: "F2", id: "umbenennen", tun: () => umbenennenNotiz(pfad, ort) });
      aus.push({ name: TD.menue.verschieben, symbol: "ordner-offen", id: "verschieben", tun: () => verschiebenNotiz(pfad) });
      aus.push({ trenner: true });
      aus.push({ name: TD.menue.papierkorb, symbol: "papierkorb", sub: "⌘⌫", id: "papierkorb", gefahr: true, tun: () => papierkorbNotiz(pfad) });
    }
    return aus;
  }
  const kartenMenue = (ev, pfad) => menueBei(ev, notizEintraege(pfad));
  // Titel im Editor: das Menü gilt der offenen Notiz; „Umbenennen“ ändert den Titel dort, wo er steht
  const titelMenue = (ev) => { if (S.pfad) menueBei(ev, notizEintraege(S.pfad, { oeffnen: false, ort: "titel" })); };
  function ordnerMenue(ev, pfad) {
    const aus = [{ name: TD.menue.oeffnen, symbol: "ordner-offen", id: "oeffnen", tun: () => ctx.waehleSicht({ art: "ordner", id: pfad }) }, ...(ctx.zusatzEintraege?.("ordner", pfad) || [])];
    if (istFest(pfad)) aus.push({ trenner: true }, { leer: TD.schutz.festerOrdner });
    else aus.push({ trenner: true },
      { name: TD.menue.umbenennen, symbol: "stift", sub: "F2", id: "umbenennen", tun: () => umbenennenOrdner(pfad) },
      { name: TD.menue.verschieben, symbol: "ordner-offen", id: "verschieben", tun: () => verschiebenOrdner(pfad) },
      { trenner: true }, { name: TD.menue.papierkorb, symbol: "papierkorb", sub: "⌘⌫", id: "papierkorb", gefahr: true, tun: () => papierkorbOrdner(pfad) });
    menueBei(ev, aus);
  }

  // ───────────── Ziehen und Ablegen ─────────────
  function ziehbar(el, art, pfad) {
    if (art === "ordner" && istFest(pfad)) return;
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      if (edit) { e.preventDefault(); return; }
      ziehend = { art, pfad };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(MIME, JSON.stringify({ art, pfad }));
      e.dataTransfer.setData("text/plain", pfad);
      const name = art === "ordner" ? dateiName(pfad) : (notiz(pfad)?.titel || ohneEndung(dateiName(pfad)));
      const bild = h("div", { klasse: "zieh-bild" }, symbol(art === "ordner" ? "ordner" : "notiz", 14), h("span", { text: kurz(name, 36) }));
      document.body.append(bild);
      e.dataTransfer.setDragImage(bild, 14, 16);
      setTimeout(() => bild.remove(), 0);
      requestAnimationFrame(() => el.classList.add("zieht"));
      document.documentElement.dataset.ziehen = art;
    });
    el.addEventListener("dragend", () => { el.classList.remove("zieht"); aufraeumenZiehen(); });
  }
  function aufraeumenZiehen() {
    ziehend = null;
    delete document.documentElement.dataset.ziehen;
    for (const x of document.querySelectorAll(".drop-ziel, .drop-nein")) x.classList.remove("drop-ziel", "drop-nein");
  }
  const darfAblegen = (zielOrdner) => {
    if (!ziehend) return false;
    if (ordnerVon(ziehend.pfad) === zielOrdner) return false;
    if (ziehend.art === "ordner" && (zielOrdner === ziehend.pfad || zielOrdner.startsWith(ziehend.pfad + "/"))) return false;
    return true;
  };
  function ablegeZiel(el, zielOrdner) {
    let tief = 0;
    el.addEventListener("dragenter", (e) => { if (!ziehend) return; tief++; e.preventDefault(); });
    el.addEventListener("dragover", (e) => {
      if (!ziehend) return;
      const ok = darfAblegen(zielOrdner);
      if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
      el.classList.toggle("drop-ziel", ok); el.classList.toggle("drop-nein", !ok && zielOrdner !== ordnerVon(ziehend.pfad));
    });
    el.addEventListener("dragleave", () => { tief = Math.max(0, tief - 1); if (!tief) el.classList.remove("drop-ziel", "drop-nein"); });
    el.addEventListener("drop", (e) => {
      if (!ziehend) return;
      const z = ziehend;
      const ok = darfAblegen(zielOrdner);
      tief = 0; el.classList.remove("drop-ziel", "drop-nein");
      if (!ok) return;
      e.preventDefault(); e.stopPropagation();
      aufraeumenZiehen();
      verschiebe(z.art, z.pfad, zielOrdner);
    });
  }

  // ───────────── Papierkorb ─────────────
  let korbListe = [], groesseKorb = 0;
  async function ladeKorbZahl() {
    try { const r = await api.papierkorb(); korbListe = r.eintraege || []; S.papierkorbAnzahl = korbListe.length + (r.hinweise || []).length; ctx.zeichneBereiche?.(); } catch { /* ältere Werkstatt: kein Papierkorb */ }
  }
  const tageSeit = (iso) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400e3));
  async function zeichnePapierkorb(host) {
    host.replaceChildren(h("div", { klasse: "korb-laden", "aria-busy": "true" }));
    let r;
    try { r = await api.papierkorb(); } catch (e) { host.replaceChildren(h("div", { klasse: "leer-liste" }, h("p", { text: e.message }))); return; }
    if (!(S.sicht.art === "bereich" && S.sicht.id === "papierkorb")) return;
    korbListe = r.eintraege || []; S.papierkorbAnzahl = korbListe.length + (r.hinweise || []).length; ctx.zeichneBereiche?.();
    const hinweise = [...(r.hinweise || []).map(hinweisKarte), ...(r.quarantaene?.anzahl ? [quarantaeneKarte(r.quarantaene)] : [])];
    groesseKorb = r.groesse || 0;
    if (!korbListe.length && hinweise.length) { host.replaceChildren(...hinweise); return; }
    if (!korbListe.length) { host.replaceChildren(leerBlock({ symbol: "papierkorb", titel: TD.korb.leerTitel, text: TD.korb.leerText, daten: { "data-leer": "papierkorb" } })); return; }
    const kopf = h("div", { klasse: "korb-kopf" }, h("span", { klasse: "leise", text: TD.korb.leerText }),
      r.aelter ? h("div", { klasse: "korb-alt", "data-korb-alt": "" }, h("span", { text: TD.korb.aeltere(r.aelter) }), baueKnopf({ text: TD.korb.aeltereLeeren, groesse: "s", variante: "leise", aktion: "alte-leeren", aufKlick: () => alteLeeren(r.aelter) })) : null,
      baueKnopf({ text: TD.korb.alleLeeren, groesse: "s", variante: "leise", aktion: "papierkorb-leeren", aufKlick: () => leeren() }));
    host.replaceChildren(...hinweise, kopf, ...korbListe.map(korbKarte));
  }
  // Ein Vorgang, der nach einem Abbruch nicht eindeutig zurückgefahren werden konnte: sichtbar, mit Weg
  function hinweisKarte(x) {
    return h("div", { klasse: "karte korb-karte korb-hinweis", role: "alert", "data-hinweis": x.id },
      h("div", { klasse: "karte-kopf" }, h("div", { klasse: "karte-titel", text: x.unvollstaendig ? TD.korb.unvollstaendigTitel : TD.korb.unklarTitel }), h("div", { klasse: "karte-marken" }, symbol("warnung", 14))),
      h("div", { klasse: "karte-vorschau", text: x.unvollstaendig ? TD.korb.unvollstaendigText(x.ort) : x.fremd ? TD.korb.fremdText(x.von) : TD.korb.unklarText(x.von, x.nach) }),
      h("div", { klasse: "karte-fuss" }, h("span", { text: x.ort })),
      x.unvollstaendig ? null : h("div", { klasse: "korb-aktionen" }, baueKnopf({ text: x.fremd ? TD.korb.ausblenden : TD.korb.unklarErledigt, groesse: "s", aktion: "hinweis-erledigt", aufKlick: async () => {
        try { await api.papierkorbHinweisErledigt(x.id); await zeichnePapierkorb(document.getElementById("liste-koerper")); ladeKorbZahl(); } catch (err) { toast(fehlerText(err), { fehler: true }); } } })));
  }
  const quarantaeneKarte = (q) => h("div", { klasse: "karte korb-karte korb-hinweis", "data-quarantaene": "" }, h("div", { klasse: "karte-vorschau", text: TD.korb.quarantaene(q.anzahl, q.ort) }));
  function korbKarte(e) {
    const tage = tageSeit(e.zeit);
    const karte = h("div", { klasse: "karte korb-karte", role: "option", "data-korb": e.id, "data-pfad": e.pfad, title: e.pfad },
      h("div", { klasse: "karte-kopf" }, h("div", { klasse: "karte-titel", text: e.titel || e.name }), h("div", { klasse: "karte-marken" }, symbol(e.typ === "ordner" ? "ordner" : "notiz", 14))),
      h("div", { klasse: "karte-vorschau", text: e.nurImFinder ? TD.korb.nurImFinder(e.ort) : (e.ordner ? `${e.ordner}` : "") }),
      h("div", { klasse: "karte-fuss" }, h("span", { text: `${TD.korb.geloeschtVor(tage)} · ${e.typ === "ordner" ? TD.korb.ordner(e.anzahl) : TD.korb.notiz}` }), h("span", { text: e.alt ? TD.korb.alt : (e.aelterKorb ? TD.korb.aelterKorb : "") })),
      h("div", { klasse: "korb-aktionen" },
        baueKnopf({ text: TD.korb.wiederherstellen, groesse: "s", aktion: "wiederherstellen", symbol: "zuruecksetzen", aufKlick: () => wiederherstellen(e) }),
        baueKnopf({ text: TD.korb.endgueltig, groesse: "s", variante: "leise", aktion: "endgueltig", klasse: "korb-gefahr", aufKlick: () => endgueltig(e) })));
    return karte;
  }
  async function wiederherstellen(e, name = null) {
    try {
      const r = await api.papierkorbWiederherstellen(e.id, name);
      toast(TD.korb.wiederhergestellt(e.titel || e.name), { aktion: { text: "Öffnen", tun: () => (e.typ === "ordner" ? ctx.waehleSicht({ art: "ordner", id: r.pfad }) : ctx.oeffne(r.pfad)) } });
      await ctx.ladeBaum(); await zeichnePapierkorb(document.getElementById("liste-koerper"));
    } catch (err) {
      if (err.status === 409 && err.daten?.art === "belegt") { fragNeuenNamen(e); return; }
      toast(fehlerText(err), { fehler: true });
    }
  }
  function fragNeuenNamen(e) {
    const start = e.typ === "ordner" ? `${dateiName(e.pfad)} (wiederhergestellt)` : dateiName(e.pfad).replace(/(\.[^.]+)?$/, " (wiederhergestellt)$1");
    const feld = textfeld({ wert: start, label: TD.korb.neuerName });
    const d = dialog({ titel: TD.korb.belegtTitel, satz: TD.korb.belegtSatz, rumpf: [h("div", { klasse: "feld" }, h("label", { text: TD.korb.neuerName }), feld.el)], knoepfe: [
      baueKnopf({ text: TD.vorschau.abbrechen, aufKlick: () => d.schliessen() }),
      baueKnopf({ text: TD.korb.belegtKnopf, variante: "primaer", aktion: "mit-neuem-namen", aufKlick: () => { const n = feld.input.value.trim(); if (!n) return; d.schliessen(); wiederherstellen(e, n); } })] });
    feld.input.focus(); feld.input.select();
  }
  function endgueltig(e) {
    const d = dialog({ titel: TD.korb.endgueltigTitel(e.titel || e.name), satz: TD.korb.endgueltigSatz, knoepfe: [
      baueKnopf({ text: TD.vorschau.abbrechen, aufKlick: () => d.schliessen() }),
      baueKnopf({ text: TD.korb.endgueltigKnopf, variante: "gefahr", aktion: "endgueltig-bestaetigen", aufKlick: async () => {
        d.schliessen();
        try { await api.papierkorbEndgueltig({ id: e.id }); await zeichnePapierkorb(document.getElementById("liste-koerper")); } catch (err) { toast(fehlerText(err), { fehler: true }); }
      } })] });
    d.box.querySelector('[data-aktion="endgueltig-bestaetigen"]')?.classList.add("primaer");
  }
  // Kein automatisches Leeren: ältere Einträge werden nur auf Klick und nach Rückfrage gelöscht
  function alteLeeren(n) {
    const d = dialog({ titel: TD.korb.aeltereTitel, satz: TD.korb.aeltereSatz(n), knoepfe: [
      baueKnopf({ text: TD.vorschau.abbrechen, aufKlick: () => d.schliessen() }),
      baueKnopf({ text: TD.korb.leerenKnopf, variante: "gefahr", aktion: "alte-leeren-bestaetigen", aufKlick: async () => {
        d.schliessen();
        try { const r = await api.papierkorbEndgueltig({ aelterAlsTage: 30 }); toast(TD.korb.geloescht(r.geloescht)); await zeichnePapierkorb(document.getElementById("liste-koerper")); } catch (err) { toast(fehlerText(err), { fehler: true }); }
      } })] });
    d.box.querySelector('[data-aktion="alte-leeren-bestaetigen"]')?.classList.add("primaer");
  }
  function leeren() {
    const n = korbListe.length;
    const mb = groesseKorb > 1048576 ? `${(groesseKorb / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(groesseKorb / 1024))} KB`;
    const d = dialog({ titel: TD.korb.leerenTitel, satz: `${TD.korb.leerenSatz(n)} ${TD.korb.leerenGroesse(mb)}`, knoepfe: [
      baueKnopf({ text: TD.vorschau.abbrechen, aufKlick: () => d.schliessen() }),
      baueKnopf({ text: TD.korb.leerenKnopf, variante: "gefahr", aktion: "leeren-bestaetigen", aufKlick: async () => {
        d.schliessen();
        try { const r = await api.papierkorbEndgueltig({ alle: true }); toast(TD.korb.geloescht(r.geloescht)); await zeichnePapierkorb(document.getElementById("liste-koerper")); } catch (err) { toast(fehlerText(err), { fehler: true }); }
      } })] });
    d.box.querySelector('[data-aktion="leeren-bestaetigen"]')?.classList.add("primaer");
  }

  // ───────────── Tasten: F2 und ⌘⌫ ─────────────
  // Nicht über das Register der Tastenkürzel: die Rücktaste ist dort bewusst nicht belegbar. ⌘⌫ im Text bleibt „bis Zeilenanfang löschen“ — es gilt nur außerhalb von Eingabefeldern und Editor.
  function taste(e) {
    if (!S.info?.vault || dialogOffen() || e.isComposing) return false;
    const a = document.activeElement;
    const imFeld = !!a?.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor");
    const inSeite = !!a?.closest?.("#seite");
    const inListe = !!a?.closest?.("#liste");
    const ordnerWahl = (inSeite || a === document.body) && S.sicht.art === "ordner" && (inSeite) ? S.sicht.id : null;
    if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (edit || (imFeld && !a.closest?.(".cm-editor"))) return false;
      if (ordnerWahl) { umbenennenOrdner(ordnerWahl); return true; }
      if (S.pfad && !(ctx.istAufgabenBoard?.())) { umbenennenNotiz(S.pfad); return true; }
      return false;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (imFeld) return false;
      if (ordnerWahl) { papierkorbOrdner(ordnerWahl); return true; }
      // nur, wenn die Notiz sichtbar im Fokus steht (Liste oder Hauptbereich), nie aus dem Nichts (body, Kopfzeile) und nie im Aufgaben-Board
      if (S.pfad && !ctx.istAufgabenBoard?.() && (inListe || a?.closest?.("#haupt"))) { papierkorbNotiz(S.pfad); return true; }
      return false;
    }
    return false;
  }
  document.addEventListener("keydown", (e) => { if (taste(e)) { e.preventDefault(); e.stopPropagation(); } }, true);

  // Live-Ereignis „aktivitaet“ der Art datei-aktion/rueckgaengig mit zwei Pfaden [jetzt, vorher]: liegt die offene Notiz (oder ihr Ordner) dort, folgt sie.
  // Ausgenommen sind Vorgänge dieses Studios: deren Ortswechsel ist schon angewandt. Kam das Ereignis (die Werkstatt bündelt Ereignisse) erst nach einem
  // „Rückgängig“ an, schob es die offene Notiz sonst an den alten Ort zurück, obwohl die Datei wieder am ursprünglichen liegt (Wackler umbenennen.spec).
  function folgeVerschiebung(liste) {
    for (const e of liste || []) {
      if (e.typ !== "aktivitaet" || !["datei-aktion", "rueckgaengig"].includes(e.art) || !Array.isArray(e.pfade) || e.pfade.length !== 2) continue;
      if (e.id && selbstAngewandt.has(e.id)) continue;
      const [jetzt, vorher] = e.pfade;
      pfadGeaendert(null, vorher, jetzt); // auch ohne offene Notiz: Zurück/Vor und Entwürfe folgen
      if (!S.pfad) continue;
      const rest = unterPfad(S.pfad, vorher);
      if (!rest) continue;
      S.pfad = [jetzt, ...rest].join("/");
      ctx.nachAenderung({ speichern: true });
    }
  }

  return {
    folgeVerschiebung, kartenMenue, titelMenue, ordnerMenue, ziehbar, ablegeZiel, nachZeichnen,
    umbenennenNotiz, umbenennenOrdner, verschiebenNotiz, verschiebenOrdner, papierkorbNotiz, papierkorbOrdner,
    zeichnePapierkorb, ladeKorbZahl, istFest, geschuetzt, laeuft: () => laeuft, bearbeitet: () => !!edit,
    // nur für Tests und app.js
    _verschiebe: verschiebe, _fuehre: fuehre, _zurueck: zurueck,
  };
}
