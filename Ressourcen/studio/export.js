// Export und Teilen im Studio: Notiz, Auswahl oder Ordner als Markdown (Bilder als Dateien daneben), HTML (eine Datei) oder PDF; „Als Markdown kopieren“, „Formatiert kopieren“,
// „Teilen“ (nur in der Mac-App). Die Werkstatt baut das Bündel (gemeinsam/export.mjs, POST /api/export); den Ort wählt der Nutzer im Speichern-Dialog der Hülle:
//   App und Electron: Aktion `export-speichern` (Datei oder Ordner schreiben) und `export-pdf` (HTML → PDF); App: `teilen` (Teilen-Menü des Systems).
//   Browser: Download (mehrere Dateien als ZIP); PDF über die Druckansicht des Browsers — so steht es im Dialog.
// Nichts wird hochgeladen. HTML und PDF folgen der gewählten Schrift der Darstellung, aber mit hellem Drucklayout.
import { h, dialog, dialogOffen, toast, dateiName, ohneEndung } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { knopf as baueKnopf, segment, setzeLaedt } from "./bausteine.js";
import { api, aktionMitAntwort, inApp, imElectron } from "./api.js";
import { TEX } from "./texte-tags.js";

const SCHRIFTEN = new Set(["geist", "serif", "mono"]);
export const kannSpeichern = () => inApp() || imElectron();
export const kannTeilen = () => inApp();

// Fehlertext der Werkstatt oder der Hülle
const fehlerText = (e) => (e && e.message && e.status ? e.message : TEX.toast.fehler);

function ladeHerunter(name, daten, typ) {
  const blob = new Blob([daten], { type: typ });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name, style: "display:none" });
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
const ausBase64 = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

// Druckansicht im Browser: ein neues Fenster mit dem HTML, das den Druckdialog öffnet (dort „Als PDF sichern“)
function druckeImBrowser(html) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open(); w.document.write(html.replace("</body>", `<script>addEventListener("load",function(){setTimeout(function(){focus();print()},300)})<\/script></body>`)); w.document.close();
  return true;
}

export function erzeugeExport(ctx) {
  const { S } = ctx;
  const schrift = () => (SCHRIFTEN.has(S.darst?.editorSchrift) ? S.darst.editorSchrift : "geist");
  const titelVon = (pfad) => S.nMap?.get(pfad)?.titel || ohneEndung(dateiName(pfad));

  // Eine offene Notiz mit ungespeicherten Änderungen: erst sichern, damit der Export den Stand zeigt
  async function sichere(pfade) { if (S.pfad && pfade.includes(S.pfad)) return ctx.sichereVorWechsel(); return true; }

  async function speichere(r) {
    // → { ok, name } | { ok:false, grund }
    if (kannSpeichern()) {
      const a = await aktionMitAntwort("export-speichern", { name: r.name, haupt: r.haupt, ordner: !!r.ordner, dateien: r.dateien });
      if (!a) return { ok: false, grund: "fehler" };
      return a.ok ? { ok: true, name: a.name || r.name } : { ok: false, grund: a.grund || "fehler" };
    }
    // Browser: eine Datei = Download; mehrere (Markdown mit Bildern, Ordner) kommen als ZIP (zip: true bei der Anfrage)
    const d = r.dateien[0];
    if (d.text !== undefined) ladeHerunter(d.pfad, d.text, d.pfad.endsWith(".html") ? "text/html" : "text/markdown");
    else ladeHerunter(d.pfad, ausBase64(d.base64), "application/zip");
    return { ok: true, name: d.pfad };
  }

  async function fuehreAus({ pfade, ordner, format }) {
    if (!(await sichere(pfade))) return { ok: false, grund: "abbruch" };
    const direkt = kannSpeichern();
    if (format === "pdf") {
      const r = await api.exportiere({ ...(pfade.length ? { pfade } : {}), ...(ordner ? { ordner } : {}), format: "html", schrift: schrift() });
      if (kannSpeichern()) {
        const a = await aktionMitAntwort("export-pdf", { name: r.name.replace(/\.html$/i, ".pdf"), html: r.html });
        if (!a) return { ok: false, grund: "fehler" };
        return a.ok ? { ok: true, name: a.name || r.name.replace(/\.html$/i, ".pdf"), hinweise: r.hinweise } : { ok: false, grund: a.grund || "fehler" };
      }
      return druckeImBrowser(r.html) ? { ok: true, name: null, hinweise: r.hinweise, gedruckt: true } : { ok: false, grund: "popup" };
    }
    const args = { ...(pfade.length ? { pfade } : {}), ...(ordner ? { ordner } : {}), format, schrift: schrift() };
    let r = await api.exportiere(args);
    if (!direkt && r.dateien.length > 1) r = { ...(await api.exportiere({ ...args, zip: true })), hinweise: r.hinweise }; // Browser: mehrere Dateien als ZIP
    const s = await speichere(r);
    return { ...s, hinweise: r.hinweise };
  }

  // ───────────── Dialog ─────────────
  function oeffneDialog({ pfade = [], ordner = null, name = null } = {}) {
    if (dialogOffen() || (!pfade.length && !ordner)) return;
    const titel = ordner ? TEX.dialog.titelOrdner(name || dateiName(ordner)) : pfade.length === 1 ? TEX.dialog.titel(name || titelVon(pfade[0])) : TEX.dialog.titelMehrere(pfade.length);
    let format = "markdown", laeuft = false;
    const pdfText = kannSpeichern() ? TEX.dialog.pdf : TEX.dialog.pdfBrowser;
    const beschreibung = h("p", { klasse: "ex-beschreibung", "data-feld": "ex-beschreibung" });
    const optionen = [{ wert: "markdown", text: TEX.dialog.markdown.name, daten: { "data-format": "markdown" } }, { wert: "html", text: TEX.dialog.html.name, daten: { "data-format": "html" } }, { wert: "pdf", text: pdfText.name, daten: { "data-format": "pdf" } }];
    const text = { markdown: TEX.dialog.markdown.text, html: TEX.dialog.html.text, pdf: pdfText.text };
    const aktualisiere = () => {
      beschreibung.textContent = text[format] + (!kannSpeichern() && format === "markdown" && (ordner || pfade.length > 1) ? " " + TEX.dialog.zipBrowser : "");
      ok.querySelector(".bs-knopf-text").textContent = format === "pdf" && !kannSpeichern() ? TEX.dialog.knopfDrucken : TEX.dialog.knopf;
    };
    const wahl = segment({ optionen, wert: format, label: TEX.dialog.format, daten: { "data-feld": "ex-format" }, aufAenderung: (w) => { format = w; aktualisiere(); } });
    const ok = baueKnopf({ text: TEX.dialog.knopf, variante: "primaer", aktion: "exportieren", aufKlick: async () => {
      if (laeuft) return;
      laeuft = true; setzeLaedt(ok, true);
      try {
        const r = await fuehreAus({ pfade, ordner, format });
        if (r.ok) {
          d.schliessen();
          if (r.name) toast(TEX.toast.gespeichert(r.name), { ms: 6000 });
          if (r.hinweise?.length) toast(TEX.toast.hinweis(r.hinweise.length), { ms: 8000, unter: r.hinweise.slice(0, 3).join(" ") });
        } else if (r.grund === "abgebrochen") { /* Dialog des Systems abgebrochen: der Export-Dialog bleibt offen */ }
        else if (r.grund === "popup") toast(TEX.toast.druckPopup, { fehler: true });
        else if (r.grund !== "abbruch") toast(TEX.toast.fehler, { fehler: true });
      } catch (e) { toast(fehlerText(e), { fehler: true }); }
      finally { laeuft = false; setzeLaedt(ok, false); }
    } });
    const d = dialog({ titel, satz: TEX.dialog.satz, rumpf: [h("div", { klasse: "ex-format" }, wahl), beschreibung], knoepfe: [baueKnopf({ text: TEX.dialog.abbrechen, aktion: "abbrechen", aufKlick: () => d.schliessen() }), ok] });
    d.box.setAttribute("data-dialog", "export");
    aktualisiere();
    return d;
  }

  // ───────────── Kopieren ─────────────
  async function kopiereText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Rückfall unten */ }
    const t = h("textarea", { style: "position:fixed;left:-9999px;top:0", "aria-hidden": "true" });
    t.value = text; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    return ok;
  }
  async function liesMarkdown(pfad) {
    if (S.pfad === pfad && ctx.editorText) return ctx.editorText();
    return (await api.datei(pfad)).inhalt;
  }
  async function kopiereMarkdown(pfad) {
    try { toast((await kopiereText(await liesMarkdown(pfad))) ? TEX.toast.markdownKopiert : TEX.toast.kopierenFehler, { ms: 2500 }); }
    catch (e) { toast(fehlerText(e), { fehler: true }); }
  }
  async function kopiereFormatiert(pfad) {
    try {
      if (!(await sichere([pfad]))) return;
      const r = await api.exportiere({ pfade: [pfad], format: "fragment" });
      const md = await liesMarkdown(pfad);
      let ok = false;
      try {
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([r.html], { type: "text/html" }), "text/plain": new Blob([md], { type: "text/plain" }) })]);
          ok = true;
        }
      } catch { ok = false; }
      if (!ok) { // Rückfall: unsichtbar rendern, markieren, kopieren (nimmt Formatierung mit)
        const el = h("div", { style: "position:fixed;left:-9999px;top:0;background:#fff;color:#000", "aria-hidden": "true" });
        el.innerHTML = r.html; document.body.append(el);
        const sel = getSelection(); const rg = document.createRange(); rg.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(rg);
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        sel.removeAllRanges(); el.remove();
      }
      toast(ok ? TEX.toast.formatiertKopiert : TEX.toast.kopierenFehler, { ms: 2500, fehler: !ok });
    } catch (e) { toast(fehlerText(e), { fehler: true }); }
  }
  async function teilen(pfad) {
    try {
      if (!(await sichere([pfad]))) return;
      const r = await api.exportiere({ pfade: [pfad], format: "markdown" });
      const md = r.dateien.find((x) => x.pfad === r.haupt);
      const a = await aktionMitAntwort("teilen", { name: r.name, text: md.text });
      if (!a?.ok) toast(TEX.toast.teilenFehler, { fehler: true });
    } catch (e) { toast(fehlerText(e), { fehler: true }); }
  }

  // Einträge für die Kontextmenüs (dateiaktionen.js: ctx.zusatzEintraege) und die Befehlspalette
  function eintraege(art, pfad) {
    if (art === "ordner") return [{ name: TEX.menue.exportieren, symbol: "extern", id: "exportieren", tun: () => oeffneDialog({ ordner: pfad, name: dateiName(pfad) }) }];
    return [
      { name: TEX.menue.exportieren, symbol: "extern", id: "exportieren", tun: () => oeffneDialog({ pfade: [pfad] }) },
      { name: TEX.menue.markdownKopieren, symbol: "kopieren", id: "markdown-kopieren", tun: () => kopiereMarkdown(pfad) },
      { name: TEX.menue.formatiertKopieren, symbol: "kopieren", id: "formatiert-kopieren", tun: () => kopiereFormatiert(pfad) },
      ...(kannTeilen() ? [{ name: TEX.menue.teilen, symbol: "pfeil-oben", id: "teilen", tun: () => teilen(pfad) }] : []),
    ];
  }
  const befehle = () => (S.pfad && S.info?.vault ? [
    [TEX.palette.exportieren, "", () => oeffneDialog({ pfade: [S.pfad] })],
    [TEX.palette.markdownKopieren, "", () => kopiereMarkdown(S.pfad)],
    [TEX.palette.formatiertKopieren, "", () => kopiereFormatiert(S.pfad)],
    ...(kannTeilen() ? [[TEX.palette.teilen, "", () => teilen(S.pfad)]] : []),
  ] : []);

  return { oeffneDialog, eintraege, befehle, kopiereMarkdown, kopiereFormatiert, teilen, fuehreAus };
}
