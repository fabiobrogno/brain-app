// Ungelinkte Erwähnungen in der Info-Spalte (zwei Abschnitte), ohne KI:
//   „Ungelinkte Erwähnungen“  Wo steht der Titel (oder ein Alias) dieser Notiz in anderen Notizen im Klartext, ohne Link? Je Stelle „Verlinken“, dazu „Alle verlinken“ mit Vorschau.
//                             Geschrieben wird in der Werkstatt (POST /api/erwaehnungen/verlinken): hash-geprüft, mit Journal und EINEM Eintrag im Aktivitätsprotokoll; „Rückgängig“ nimmt ihn zurück.
//   „Diese Notiz erwähnt …“   Welche Titel anderer Notizen stehen im Klartext in dieser Notiz? Hier setzt der Editor den Link selbst (eine Änderung im offenen Text; gespeichert wird über den
//                             gewohnten sicheren Weg mit Drei-Wege-Zusammenführung), darum geht ⌘Z und „Rückgängig“ im Hinweis.
// Die Regeln des Findens stehen in gemeinsam/erwaehnungen.mjs (Wortgrenzen, Umlaute, kein Code/Link/Kopf). Dieses Modul kennt die App nur über `ctx`.
import { h, dialog, toast, dateiName, ohneEndung } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { knopf as baueKnopf, setzeLaedt } from "./bausteine.js";
import { api } from "./api.js";
import { TE } from "./texte-erwaehnungen.js";
import { TD } from "./texte-dateiaktionen.js";

// Vorher/Nachher um die Änderung herum zeigen (die Stelle steht sonst oft hinter dem Zeilenende des Auszugs)
function fensterPaar(v, n) {
  let i = 0;
  while (i < v.length && v[i] === n[i]) i++;
  const von = Math.max(0, i - 22), plus = n.length - v.length;
  const schnitt = (t, bis) => (von > 0 ? "… " : "") + t.slice(von, bis) + (bis < t.length ? " …" : "");
  return { vorher: schnitt(v, i + 24), nachher: schnitt(n, i + 24 + plus) };
}
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const NOTIZEN_ZUERST = 6, STELLEN_ZUERST = 3, AUTOMATISCH = 6;

export function erzeugeErwaehnungen(ctx) {
  const { S, ed } = ctx;

  // Auszug mit markiertem Treffer
  const auszugEl = (st) => {
    const [a, b] = st.markierung;
    return h("span", { klasse: "erw-auszug" }, st.auszug.slice(0, a), h("mark", { text: st.auszug.slice(a, b) }), st.auszug.slice(b));
  };
  const sektion = (id, titel) => h("div", { klasse: "info-sektion", "data-sektion": id }, h("h3", { text: titel }));
  const fuelle = (el, titel, ...kinder) => el.replaceChildren(h("h3", { text: titel }), ...kinder);
  const kannSchreiben = () => !!S.pfad && !S.schutz && S.bearbeitbar !== false && !S.konflikt;

  // ───────────── Vorschau „Alle verlinken“ ─────────────
  function vorschauListe(liste, mehr) {
    const zeilen = liste.slice(0, 6).map((e) => h("li", { klasse: "da-vz" },
      h("div", { klasse: "da-vz-kopf" }, symbol("notiz", 14), h("span", { klasse: "da-vz-titel", text: e.titel }), e.anzahl ? h("span", { klasse: "da-vz-zahl", text: String(e.anzahl) }) : null),
      e.zeilen?.[0] ? (() => { const f = fensterPaar(e.zeilen[0].vorher, e.zeilen[0].nachher); return h("div", { klasse: "da-vz-code" }, h("span", { klasse: "da-vorher", text: f.vorher }), h("span", { klasse: "da-pfeil" }, symbol("pfeil", 12)), h("span", { klasse: "da-nachher", text: f.nachher })); })() : null));
    const rest = liste.length - zeilen.length + (mehr || 0);
    return h("ul", { klasse: "da-vorschau", "data-feld": "vorschau" }, zeilen, rest > 0 ? h("li", { klasse: "da-vz-mehr", text: TE.vorschau.mehr(rest) }) : null);
  }
  function bestaetige({ titel, satz, liste, mehr, uebersprungen }) {
    return new Promise((fertig) => {
      let ja = false;
      const d = dialog({ titel, rumpf: [h("p", { klasse: "da-satz", "data-feld": "satz", text: satz }), vorschauListe(liste, mehr),
        uebersprungen ? h("p", { klasse: "leise da-hinweis", text: TE.vorschau.uebersprungen(uebersprungen) }) : null], knoepfe: [
        baueKnopf({ text: TE.vorschau.abbrechen, aktion: "abbrechen", aufKlick: () => d.schliessen() }),
        baueKnopf({ text: TE.vorschau.knopf, variante: "primaer", aktion: "bestaetigen", aufKlick: () => { ja = true; d.schliessen(); } })], beiSchliessen: () => fertig(ja) });
      d.box.setAttribute("data-dialog", "erwaehnungen");
    });
  }

  // ───────────── Rückgängig (Verlinken in anderen Notizen) über das Aktivitätsprotokoll ─────────────
  async function zurueck(id, teilweise = false) {
    if (!(await ctx.sichereVorWechsel())) return;
    try { await api.aktivitaetRueckgaengig(id, undefined, teilweise); }
    catch (e) {
      if (e.status === 409 && e.daten?.art === "geaendert" && !teilweise) {
        const n = (e.daten.dateien || []).length || 1;
        const d = dialog({ titel: TD.rueckgaengigGeaendert.titel, satz: TD.rueckgaengigGeaendert.satz(n), knoepfe: [
          baueKnopf({ text: TD.rueckgaengigGeaendert.abbrechen, aufKlick: () => d.schliessen() }),
          baueKnopf({ text: TD.rueckgaengigGeaendert.knopf, variante: "primaer", aktion: "trotzdem", aufKlick: () => { d.schliessen(); zurueck(id, true); } })] });
        return;
      }
      toast(e.message, { fehler: true });
      return;
    }
    toast(TE.toast.zurueck, { ms: 5000 });
    await nachAenderung();
  }
  async function nachAenderung(geaendert = []) {
    await ctx.ladeBaum?.();
    ctx.planeGit?.();
    if (S.pfad && geaendert.includes(S.pfad)) await ctx.offeneNeuLaden?.();
    ctx.ladeInfo?.({ leise: true });
  }

  // ───────────── Richtung 1: andere Notizen ─────────────
  async function verlinkeStellen(zielPfad, zielTitel, stellen, knopf) {
    if (knopf) setzeLaedt(knopf, true);
    try {
      if (!(await ctx.sichereVorWechsel())) return;
      const r = await api.verlinke({ ziel: zielPfad, stellen });
      const n = (r.dateien || []).reduce((a, d) => a + d.anzahl, 0);
      if (!n) { toast(TE.toast.nichtsVerlinkt); await nachAenderung(); return; }
      toast(TE.toast.verlinkt(n, zielTitel), { ms: 9000, aktion: r.aktivitaetId ? { text: TE.toast.rueckgaengig, tun: () => zurueck(r.aktivitaetId) } : undefined });
      if (r.uebersprungen?.length) toast(TE.toast.uebersprungen(r.uebersprungen.length), { ms: 5000 });
      await nachAenderung(r.geaendert || []);
    } catch (e) { toast(e.message, { fehler: true }); }
    finally { if (knopf) setzeLaedt(knopf, false); }
  }
  async function verlinkeAlle(zielPfad, zielTitel, knopf) {
    if (knopf) setzeLaedt(knopf, true);
    try {
      if (!(await ctx.sichereVorWechsel())) return;
      for (let versuch = 0; versuch < 2; versuch++) {
        const v = await api.verlinke({ ziel: zielPfad, alle: true, vorschau: true });
        if (!v.verweise) { toast(TE.vorschau.nichts); await nachAenderung(); return; }
        if (!(await bestaetige({ titel: TE.vorschau.titelEin(zielTitel), satz: TE.vorschau.satzEin(v.verweise, v.notizen), liste: v.liste || [], mehr: v.mehr, uebersprungen: v.uebersprungen?.length }))) return;
        let r;
        try { r = await api.verlinke({ ziel: zielPfad, alle: true, token: v.token }); }
        catch (e) { if (e.status === 409 && e.daten?.art === "vorschau-veraltet" && versuch === 0) { toast(TE.vorschau.veraltet); continue; } throw e; }
        const n = (r.dateien || []).reduce((a, d) => a + d.anzahl, 0);
        toast(TE.toast.verlinkt(n, zielTitel), { ms: 9000, aktion: r.aktivitaetId ? { text: TE.toast.rueckgaengig, tun: () => zurueck(r.aktivitaetId) } : undefined });
        await nachAenderung(r.geaendert || []);
        return;
      }
    } catch (e) { toast(e.message, { fehler: true }); }
    finally { if (knopf) setzeLaedt(knopf, false); }
  }

  // eine Notiz (mit ihren Stellen) als Block; aus: false = andere Notiz (Stelle liegt dort), true = Ziel (Stelle liegt in dieser Notiz)
  function notizBlock(n, { aus, zeigeVerlinken, beiVerlinken, beiOeffnen }) {
    const offen = { alle: false };
    const stellenHost = h("div", { klasse: "erw-stellen" });
    const zeichne = () => {
      const liste = offen.alle ? n.stellen : n.stellen.slice(0, STELLEN_ZUERST);
      const rest = n.anzahl - liste.length;
      stellenHost.replaceChildren(...[...liste.map((s) => {
        const verl = zeigeVerlinken ? baueKnopf({ text: (aus ? TE.aus : TE.ein).verlinken, groesse: "s", aktion: "erw-verlinken", aufKlick: (ev) => beiVerlinken(s, ev.currentTarget) }) : null;
        return h("div", { klasse: "erw-stelle", "data-erw-stelle": "" },
          h("button", { type: "button", klasse: "erw-auszug-knopf", title: aus ? undefined : TE.ein.oeffnen(n.titel), aufClick: () => beiOeffnen(s) }, h("span", { klasse: "erw-zeile", text: `Z. ${s.zeile}` }), auszugEl(s)), verl);
      }), rest > 0 ? h("button", { type: "button", klasse: "wert-mehr erw-mehr", text: TE.ein.weitereStellen(rest), aufClick: () => { offen.alle = true; zeichne(); } }) : null].filter(Boolean));
    };
    zeichne();
    return h("div", { klasse: "erw-notiz", "data-erw-notiz": n.pfad },
      h("button", { type: "button", klasse: "erw-titel", title: TE.ein.oeffnen(n.titel), aufClick: () => beiOeffnen(n.stellen[0]) }, symbol("notiz", 14), h("span", { klasse: "t", text: n.titel || ohneEndung(dateiName(n.pfad)) }), h("span", { klasse: "erw-zahl", text: String(n.anzahl) })),
      stellenHost);
  }

  function zeichneEin(host, r, { pfad, aktuell, pruefeWeiter }) {
    if (!aktuell()) return;
    if (!r.namen.length && !r.mehrdeutig) { host.hidden = true; return; }
    host.hidden = false;
    const kinder = [];
    if (r.mehrdeutig) { fuelle(host, TE.ein.titel, h("p", { klasse: "leise erw-leer", text: TE.ein.mehrdeutig })); return; }
    const weiter = r.offen > 0 || !r.vollstaendig;
    if (r.notizen.length) {
      const alle = baueKnopf({ text: TE.ein.alleVerlinken, groesse: "s", aktion: "erw-alle", aufKlick: (ev) => verlinkeAlle(pfad, r.titel, ev.currentTarget) });
      kinder.push(h("div", { klasse: "erw-kopf" }, h("span", { klasse: "erw-summe", "data-erw-summe": "", text: TE.ein.zusammen(r.anzahlStellen, r.anzahlNotizen) }), alle));
      const wurzel = h("div", { klasse: "erw-liste" });
      const zeichneListe = (alleNotizen) => {
        const zeig = alleNotizen ? r.notizen : r.notizen.slice(0, NOTIZEN_ZUERST);
        wurzel.replaceChildren(...[...zeig.map((n) => notizBlock(n, {
          aus: false, zeigeVerlinken: true,
          beiVerlinken: (s, knopf) => verlinkeStellen(pfad, r.titel, [{ pfad: n.pfad, start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }], knopf),
          beiOeffnen: async (s) => { if (!(await ctx.oeffne(n.pfad))) { /* oeffne meldet selbst */ } if (S.pfad === n.pfad && s) ed.springeZu(s.zeile, { spalte: s.spalte, laenge: s.ende - s.start }); },
        })), !alleNotizen && r.notizen.length > NOTIZEN_ZUERST ? h("button", { type: "button", klasse: "wert-mehr erw-mehr", text: TE.ein.weitereNotizen(r.notizen.length - NOTIZEN_ZUERST), aufClick: () => zeichneListe(true) }) : null].filter(Boolean));
      };
      zeichneListe(false);
      kinder.push(wurzel);
    } else if (!weiter) kinder.push(h("p", { klasse: "leise erw-leer", text: TE.ein.leer }));
    if (weiter) kinder.push(h("p", { klasse: "leise erw-weiter", "data-erw-weiter": "" }, TE.ein.weiter, r.automatischVorbei ? baueKnopf({ text: TE.ein.mehrPruefen, groesse: "s", aufKlick: pruefeWeiter }) : null));
    if (r.abgeschnitten) kinder.push(h("p", { klasse: "leise erw-weiter", text: TE.ein.nurErste(1500) }));
    fuelle(host, TE.ein.titel, ...kinder);
  }

  // Der erste Abruf wird abgewartet (die Spalte zeigt sofort etwas), weitere laufen im Hintergrund, solange die Werkstatt noch Kandidaten prüft
  async function ladeEin(host, o) {
    const { pfad, aktuell } = o;
    const einmal = async (i) => {
      let r;
      try { r = await api.erwaehnungen(pfad); } catch { if (aktuell()) fuelle(host, TE.ein.titel, h("p", { klasse: "leise erw-leer", text: TE.ein.fehler })); return false; }
      if (!aktuell()) return false;
      const weiter = r.offen > 0 || (!r.vollstaendig && !r.mehrdeutig && r.namen.length > 0);
      zeichneEin(host, { ...r, automatischVorbei: weiter && i === AUTOMATISCH - 1 }, { pfad, aktuell, pruefeWeiter: () => ladeEin(host, o) });
      return weiter;
    };
    let weiter = await einmal(0);
    (async () => {
      for (let i = 1; weiter && i < AUTOMATISCH; i++) {
        await warte(i < 3 ? 80 : 160);
        if (!aktuell()) return;
        weiter = await einmal(i);
      }
    })();
  }

  // ───────────── Richtung 2: die offene Notiz ─────────────
  const docText = () => ed.view.state.doc.toString();

  // Links in den offenen Text setzen (eine Änderung → ⌘Z geht); gibt { zurueckNehmen } zurück
  function setzeImEditor(aenderungen) {
    const view = ed.view, vor = view.state.doc;
    const tr = view.state.update({ changes: aenderungen.map((a) => ({ from: a.start, to: a.ende, insert: a.link })), userEvent: "input.verlinken", scrollIntoView: false });
    view.dispatch(tr);
    const inv = tr.changes.invert(vor), nach = view.state.doc;
    return () => {
      if (!view.state.doc.eq(nach)) { toast(TE.toast.seitherGeschrieben, { ms: 7000 }); return false; }
      view.dispatch({ changes: inv, userEvent: "input.verlinken-zurueck", scrollIntoView: false });
      toast(TE.toast.zurueckEditor, { ms: 4000 });
      return true;
    };
  }
  async function verlinkeImText(pfad, stellen, { alle = false } = {}) {
    for (let versuch = 0; versuch < 2; versuch++) {
      const text = docText();
      const r = await api.erwaehnungenLinks({ pfad, text, ...(alle ? { alle: true } : { stellen }) });
      if (S.pfad !== pfad) return null;
      if (docText() !== text) { if (versuch === 0) continue; return null; } // inzwischen weitergetippt: noch einmal mit dem neuen Stand
      return r;
    }
    return null;
  }

  function zeichneAus(host, r, { pfad, aktuell }) {
    if (!aktuell()) return;
    const schreibbar = kannSchreiben();
    if (!r.notizen.length) { fuelle(host, TE.aus.titel, h("p", { klasse: "leise erw-leer", text: TE.aus.leer })); return; }
    const kinder = [];
    kinder.push(h("div", { klasse: "erw-kopf" }, h("span", { klasse: "erw-summe", "data-erw-summe": "", text: TE.aus.zusammen(r.anzahlStellen, r.anzahlNotizen) }),
      schreibbar ? baueKnopf({ text: TE.aus.alleVerlinken, groesse: "s", aktion: "erw-alle", aufKlick: (ev) => alleImText(pfad, ev.currentTarget) }) : null));
    if (!schreibbar) kinder.push(h("p", { klasse: "leise erw-weiter", text: TE.aus.nurLesen }));
    const wurzel = h("div", { klasse: "erw-liste" });
    wurzel.append(...r.notizen.map((n) => notizBlock(n, {
      aus: true, zeigeVerlinken: schreibbar,
      beiVerlinken: async (s, knopf) => {
        setzeLaedt(knopf, true);
        try {
          const erg = await verlinkeImText(pfad, [{ ziel: n.pfad, start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }]);
          if (!erg || !erg.aenderungen.length) { toast(TE.toast.nichtsVerlinkt); ctx.ladeInfo?.({ leise: true }); return; }
          const zuruecknehmen = setzeImEditor(erg.aenderungen);
          toast(TE.toast.verlinktAus(erg.aenderungen.length), { ms: 7000, aktion: { text: TE.toast.rueckgaengig, tun: zuruecknehmen } });
          ctx.nachBearbeitung?.();
        } catch (e) { toast(e.message, { fehler: true }); }
        finally { setzeLaedt(knopf, false); }
      },
      beiOeffnen: (s) => { if (s && S.pfad === pfad) ed.springeZu(s.zeile, { spalte: s.spalte, laenge: s.ende - s.start }); },
    })));
    kinder.push(wurzel);
    fuelle(host, TE.aus.titel, ...kinder);
  }
  async function alleImText(pfad, knopf) {
    setzeLaedt(knopf, true);
    try {
      const erg = await verlinkeImText(pfad, null, { alle: true });
      if (!erg || !erg.aenderungen.length) { toast(TE.vorschau.nichts); return; }
      const je = new Map();
      for (const a of erg.aenderungen) { const t = S.nMap.get(a.ziel)?.titel || ohneEndung(dateiName(a.ziel)); const e = je.get(a.ziel) || je.set(a.ziel, { pfad: a.ziel, titel: t, anzahl: 0, zeilen: [] }).get(a.ziel); e.anzahl++; e.zeilen.push({ vorher: a.vorher, nachher: a.nachher }); }
      if (!(await bestaetige({ titel: TE.vorschau.titelAus, satz: TE.vorschau.satzAus(erg.aenderungen.length), liste: [...je.values()], mehr: 0, uebersprungen: erg.uebersprungen }))) return;
      const frisch = await verlinkeImText(pfad, null, { alle: true }); // der Text kann sich während der Vorschau geändert haben
      if (!frisch || !frisch.aenderungen.length) { toast(TE.toast.nichtsVerlinkt); return; }
      const zuruecknehmen = setzeImEditor(frisch.aenderungen);
      toast(TE.toast.verlinktAus(frisch.aenderungen.length), { ms: 8000, aktion: { text: TE.toast.rueckgaengig, tun: zuruecknehmen } });
      ctx.nachBearbeitung?.();
    } catch (e) { toast(e.message, { fehler: true }); }
    finally { setzeLaedt(knopf, false); }
  }
  async function ladeAus(host, { pfad, aktuell }) {
    let r;
    try { r = await api.erwaehntVon(pfad, docText()); } catch { if (aktuell()) fuelle(host, TE.aus.titel, h("p", { klasse: "leise erw-leer", text: TE.aus.fehler })); return; }
    zeichneAus(host, r, { pfad, aktuell });
    // Der Namenssatz baut sich im Hintergrund auf: bis er vollständig ist, gleich noch einmal nachsehen
    for (let i = 0; i < 4 && !r.vollstaendig && aktuell(); i++) {
      await warte(250 * (i + 1));
      if (!aktuell()) return;
      try { r = await api.erwaehntVon(pfad, docText()); } catch { return; }
      zeichneAus(host, r, { pfad, aktuell });
    }
  }

  // Die beiden Abschnitte für die offene Notiz. aktuell(): false, sobald die Spalte neu gebaut wurde (dann hören die Läufe auf)
  function sektionen({ pfad, aktuell }) {
    const ein = sektion("erw-ein", TE.ein.titel), aus = sektion("erw-aus", TE.aus.titel);
    ein.append(h("p", { klasse: "leise erw-leer", text: TE.ein.laedt }));
    aus.append(h("p", { klasse: "leise erw-leer", text: TE.aus.laedt }));
    return { ein, aus, lade: () => Promise.allSettled([ladeEin(ein, { pfad, aktuell }), ladeAus(aus, { pfad, aktuell })]) };
  }
  return { sektionen };
}
