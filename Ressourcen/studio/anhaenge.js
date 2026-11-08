// Anhänge im Studio (Paket 3a, Runde 3): Dateien aus Zwischenablage und Ziehen in die Werkstatt hochladen, `![[datei]]` einfügen, Anhänge auflösen und öffnen,
// Lightbox, externe Bilder (nur mit Zustimmung), Rückfrage beim Löschen einer Notiz. Der Editor (editor-anhaenge.js) und die Frag-Anzeige (frage-markdown.js) benutzen dieses Modul;
// die Regeln (Typen, Namen, Schreibweise) stehen in anhang-regeln.js (Kopie von gemeinsam/anhang-regeln.mjs), die Arbeit auf der Platte macht die Werkstatt (werkstatt/anhaenge.mjs).
//
// Wie die Dateien ins Studio kommen: als DOM-Ereignis (paste/drop → File), in allen Hüllen gleich (Mac-App/WKWebView, Electron, Browser). Die Bytes gehen in Stücken über die Werkstatt
// (der Nachrichtenkanal der Mac-App nimmt höchstens 8 MB je Anfrage). Liefert ein System keine Datei (nur „Files“ im Typ, aber keine Bytes), sagt Kortex das ehrlich und nennt den Weg über Ziehen.
import { h, dialog, toast } from "./hilfen.js";
import { knopf as baueKnopf } from "./bausteine.js";
import { symbol, GROESSE } from "./symbole.js";
import { TAN } from "./texte-anhaenge.js";
import { anhangUrl, externBildUrl, groesseText, istBildName, istAnhangName, endungVon } from "./anhang-regeln.js";

export const MAX_MB_STANDARD = 20;
const STUECK = 2 * 1024 * 1024;
const kurzHost = (adresse) => { try { return new URL(adresse).hostname || adresse; } catch { return String(adresse).slice(0, 40); } };

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// z: { api, aktionMitAntwort, pfad(): Pfad der offenen Notiz|"", darfSchreiben(): boolean, ansicht(): EditorView|null, fokus(), shell(): "app"|"electron"|"browser" }
export function erzeugeAnhaenge(z) {
  let einst = { ort: "vault", ordner: "_anhaenge", maxMB: MAX_MB_STANDARD, externeBilder: false };
  const geladen = new Set();   // externe Bilder, die der Nutzer in dieser Sitzung angeklickt hat (Adresse)
  const aufgeloest = new Map(); // "von|ziel" → Promise<{ pfad, name, groesse, art }|null>
  let neuZeichnen = () => {};   // setzt der Editor (Widgets neu bauen, wenn sich etwas ändert)

  const api = {
    // Einstellungen der App (werte aus GET /api/einstellungen); gibt wahr zurück, wenn sich etwas geändert hat, das die Anzeige betrifft
    setzeEinstellungen(w) {
      const neu = { ort: w?.anhaengeOrt === "notiz" ? "notiz" : "vault", ordner: typeof w?.anhaengeOrdner === "string" && w.anhaengeOrdner.trim() ? w.anhaengeOrdner.trim() : "_anhaenge",
        maxMB: Number.isInteger(w?.anhaengeMaxMB) ? w.anhaengeMaxMB : MAX_MB_STANDARD, externeBilder: w?.externeBilder === true };
      const anders = neu.externeBilder !== einst.externeBilder;
      einst = neu;
      if (anders) neuZeichnen();
      return anders;
    },
    einstellungen: () => einst,
    beiNeuZeichnen(f) { neuZeichnen = f; },
    vergiss() { aufgeloest.clear(); },

    // ---------- Auflösen ----------
    bildUrl: (ziel, von) => anhangUrl(ziel, von),
    aufloesen(ziel, von = "") {
      const k = `${von}|${ziel}`;
      // Nur Treffer bleiben im Gedächtnis: ein Anhang, den es noch nicht gab, soll beim nächsten Zeichnen neu gesucht werden
      if (!aufgeloest.has(k)) aufgeloest.set(k, z.api.anhangAufloesen(ziel, von).catch(() => null).then((r) => { if (!r) aufgeloest.delete(k); return r; }));
      return aufgeloest.get(k);
    },
    // Externe Bilder: Einstellung an oder in dieser Sitzung angeklickt
    externErlaubt: (adresse) => einst.externeBilder || geladen.has(adresse),
    erlaubeExtern(adresse) { geladen.add(adresse); neuZeichnen(); },
    externUrl: (adresse) => externBildUrl(adresse),
    kurzHost,

    // ---------- Öffnen ----------
    // Anhang mit dem Programm des Systems öffnen (Hüllen-Vertrag: anhang-oeffnen; Browser: neuer Tab). Aufruf direkt im Klick (Popup-Sperre des Browsers).
    async oeffne(ziel, von = "") {
      const r = await api.aufloesen(ziel, von);
      const name = r?.name || ziel.split("/").pop();
      if (!r) { toast(TAN.dateiFehlt(name), { fehler: true }); return false; }
      let a;
      try { a = await z.aktionMitAntwort("anhang-oeffnen", r.pfad); } catch { a = undefined; }
      if (a && a.ok === true) return true;
      toast(TAN.dateiNichtOeffnen(name), { fehler: true });
      return false;
    },

    // ---------- Lightbox ----------
    lightbox(src, alt = "") {
      if (document.querySelector(".anhang-lightbox")) return;
      const davor = document.activeElement;
      const zu = () => { document.removeEventListener("keydown", taste, true); box.remove(); try { davor?.focus?.({ preventScroll: true }); } catch { /* weg */ } };
      const taste = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zu(); } else if (e.key === "Tab") { e.preventDefault(); } };
      const knopf = h("button", { type: "button", klasse: "anhang-lb-zu", "aria-label": TAN.lightbox.schliessen, title: TAN.lightbox.schliessen, "data-aktion": "lightbox-zu", aufClick: (e) => { e.stopPropagation(); zu(); } }, symbol("schliessen", GROESSE.mittel));
      const bild = h("img", { klasse: "anhang-lb-bild", src, alt, draggable: "false" });
      const box = h("div", { klasse: "anhang-lightbox", role: "dialog", "aria-modal": "true", "aria-label": alt ? `${TAN.lightbox.titel}: ${alt}` : TAN.lightbox.titel, "data-dialog": "lightbox", aufClick: zu },
        knopf, bild, h("div", { klasse: "anhang-lb-unter" }, alt ? h("span", { klasse: "anhang-lb-name", text: alt }) : null, h("span", { klasse: "anhang-lb-hinweis", text: TAN.lightbox.hinweis })));
      bild.addEventListener("click", (e) => e.stopPropagation());
      document.body.append(box);
      document.addEventListener("keydown", taste, true);
      knopf.focus({ preventScroll: true });
    },

    // ---------- Einfügen und Ziehen ----------
    // Dateien aus der Zwischenablage oder vom Ziehen → hochladen, `![[name]]` an `pos` einfügen. Gibt die Zahl der eingefügten Dateien zurück.
    async dateien(dateien, pos = null) {
      const view = z.ansicht();
      if (!view) return 0;
      if (!z.darfSchreiben()) { toast(TAN.nurLesen, { fehler: true }); return 0; }
      const grenze = einst.maxMB * 1024 * 1024;
      const fertig = [];
      for (const datei of dateien) {
        const name = datei.name || "datei";
        if (!datei.size) { toast(TAN.leer(name), { fehler: true }); continue; }
        if (datei.size > grenze) { toast(TAN.zuGross(name, groesseText(datei.size), groesseText(grenze)), { fehler: true, ms: 9000 }); continue; }
        try {
          if (datei.size > 1024 * 1024) toast(TAN.hochladen(name), { ms: 2500 });
          const r = await hochladen(datei, name);
          fertig.push(r);
          if (r.gross) toast(TAN.gross(r.name, groesseText(r.groesse)), { ms: 9000 });
        } catch (e) {
          toast(e?.status === 415 ? (e.message || TAN.falscherTyp(name)) : e?.status === 413 ? e.message : (e?.message || TAN.fehler(name)), { fehler: true, ms: 9000 });
        }
      }
      if (!fertig.length) return 0;
      // Einfügen: Bilder und Dateien je auf eigener Zeile (Block), an der Stelle von Zeiger oder Cursor
      const doc = view.state.doc;
      const stelle = Math.max(0, Math.min(doc.length, Number.isInteger(pos) ? pos : view.state.selection.main.head));
      const zeile = doc.lineAt(stelle);
      const vor = doc.sliceString(zeile.from, stelle).trim() !== "", nach = doc.sliceString(stelle, zeile.to).trim() !== "";
      const text = (vor ? "\n" : "") + fertig.map((r) => r.einbettung).join("\n") + (nach ? "\n" : "");
      view.dispatch({ changes: { from: stelle, insert: text }, selection: { anchor: stelle + text.length }, userEvent: "input.paste", scrollIntoView: true });
      view.focus();
      if (fertig.length > 1) toast(TAN.mehrere(fertig.length), { ms: 2500 });
      return fertig.length;
    },
    // Die Zwischenablage nannte Dateien, gab aber keine her: ehrlicher Hinweis je Hülle
    pasteLeerHinweis() { toast(TAN.pasteLeer[z.shell()] || TAN.pasteLeer.browser, { fehler: true, ms: 9000 }); },

    // ---------- Beim Löschen einer Notiz ----------
    // Vor dem Löschen: gibt es Anhänge, die nur diese Notiz benutzt? Dann fragt Kortex. → { abbruch: true } | { anhaenge: [...] (zum Mitlöschen nach dem Löschen) }
    async vorLoeschen(pfad) {
      let liste = [];
      try { liste = (await z.api.anhangUnbenutzt(pfad)).anhaenge || []; } catch { return { anhaenge: [] }; } // ohne Auskunft bleibt alles, wie es ist
      if (!liste.length) return { anhaenge: [] };
      const wahl = await new Promise((fertig) => {
        let antwort = "abbruch";
        const zeilen = liste.slice(0, 5).map((a) => h("li", { klasse: "anhang-loeschen-zeile", "data-pfad": a.pfad }, symbol(a.art === "bild" ? "ansicht" : "notiz", GROESSE.text), h("span", { klasse: "anhang-loeschen-name", text: a.name }), h("span", { klasse: "anhang-loeschen-groesse", text: groesseText(a.groesse) })));
        const d = dialog({ titel: TAN.loeschen.titel, satz: TAN.loeschen.satz(liste.length), rumpf: [h("ul", { klasse: "anhang-loeschen-liste" }, zeilen, liste.length > 5 ? h("li", { klasse: "anhang-loeschen-mehr", text: TAN.loeschen.mehr(liste.length - 5) }) : null),
          h("p", { klasse: "leise da-hinweis", text: TAN.loeschen.hinweis })], knoepfe: [
          baueKnopf({ text: TAN.loeschen.abbrechen, aktion: "abbrechen", aufKlick: () => { antwort = "abbruch"; d.schliessen(); } }),
          baueKnopf({ text: TAN.loeschen.behalten, variante: "primaer", aktion: "anhaenge-behalten", aufKlick: () => { antwort = "behalten"; d.schliessen(); } }),
          baueKnopf({ text: TAN.loeschen.mit, aktion: "anhaenge-mitloeschen", aufKlick: () => { antwort = "mit"; d.schliessen(); } })], beiSchliessen: () => fertig(antwort) });
        d.box.setAttribute("data-dialog", "anhaenge-loeschen");
      });
      if (wahl === "abbruch") return { abbruch: true };
      return { anhaenge: wahl === "mit" ? liste : [] };
    },
    // Nach dem Löschen der Notiz: gewählte Anhänge in den Papierkorb
    async nachLoeschen(anhaenge) {
      if (!anhaenge?.length) return;
      try {
        const r = await z.api.anhangLoeschen(anhaenge.map((a) => a.pfad));
        const ok = r.ergebnisse.filter((x) => x.ok).length;
        toast(ok === anhaenge.length ? TAN.loeschen.fertig(ok) : TAN.loeschen.teilweise(ok, anhaenge.length), { ms: 6000, fehler: ok < anhaenge.length });
        api.vergiss();
      } catch { toast(TAN.loeschen.fehler, { fehler: true }); }
    },
  };

  async function hochladen(datei, name) {
    const s = await z.api.anhangStart(name, datei.size, z.pfad() || "");
    for (let nr = 0, off = 0; off < datei.size; nr++, off += STUECK) {
      const bytes = new Uint8Array(await datei.slice(off, off + STUECK).arrayBuffer());
      await z.api.anhangTeil(s.id, nr, base64(bytes));
    }
    const r = await z.api.anhangEnde(s.id);
    api.vergiss();
    return r;
  }
  return api;
}

export { istBildName, istAnhangName, endungVon };
