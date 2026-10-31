// Dialoge für „Frühere Fassung zurückholen“ und „Technische Details“ (Vorschau per Diff, dann als neue Fassung gesichert).
// Kein innerHTML mit fremden Daten: alles über h() und textContent. Die Entscheidungen gehen an die Werkstatt, die sie prüft und ausführt.
import { h, dialog, arbeitBeginnt, toast } from "./hilfen.js";
import { knopf as baueKnopf, setzeLaedt } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { api as standardApi, gitGesperrt, ausgangUnklar, zeitText } from "./api.js";
import { TV } from "./texte-verlauf.js";
import { ladeVerlaufCss, parseDiff, diffKarte, istRohGit, detailsBlock } from "./verlauf.js";

const T = TV.abgleich, Z = TV.zurueckholen;
const zeichen = (name, groesse) => { const s = symbol(name, groesse); s.setAttribute("aria-hidden", "true"); return s; };
const MAX_ZEILEN = 1500;
const MAX_VORSCHAU_ZEICHEN = 20000;

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
  const kopieren = baueKnopf({ text: TV.roh.kopieren, groesse: "l" });
  const zu = baueKnopf({ text: TV.roh.schliessen, variante: "primaer", groesse: "l" });
  const box = h("div", { klasse: "dialog rm-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "roh-titel", "data-dialog": "details" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("info", 20)), h("h2", { klasse: "rm-titel", id: "roh-titel", text: titel })),
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

// Die Konflikt-Ansicht (Abgleich mit Konflikten) steht in konflikt.js; Daten und Abschluss liefert der Kern.

// ---------------------------------------------------------------- Frühere Fassung zurückholen
// Vorschau (Unterschied aktuell → gewählte Fassung), dann Bestätigung; die Werkstatt sichert als NEUEN Commit.
// beiFertig({ pfad, sha, unveraendert }) · beiSichern() öffnet den Sichern-Dialog, wenn die Datei offene Änderungen hat.
export function oeffneZurueckholen({ pfad, sha, wann, api = standardApi, beiFertig, beiSichern, beiStandNeu } = {}) {
  ladeVerlaufCss();
  const datei = String(pfad || "").split("/").pop();
  const meldung = meldungBox();
  let laeuft = false, bereit = false;
  const knopf = baueKnopf({ text: Z.zurueckholen, variante: "primaer", groesse: "l", aktion: "zurueckholen", disabled: true });
  const abbrechen = baueKnopf({ text: Z.abbrechen, groesse: "l", aktion: "zurueckholen-abbrechen" });
  const sichern = baueKnopf({ text: Z.jetztSichern, groesse: "l", aktion: "zurueckholen-sichern", hidden: true });
  const karte = h("div", { klasse: "zh-vorschau", hidden: true });
  const stat = h("span", { klasse: "vd-stat" });
  const vorschauKopf = h("p", { klasse: "ab-hinweis", text: Z.laedt, role: "status" });
  const lade = h("div", { klasse: "ab-sk-block zh-lade", "aria-busy": "true" }, h("span", { klasse: "ab-sk" }), h("span", { klasse: "ab-sk k" }), h("span", { klasse: "ab-sk m" }));
  const sicher = h("p", { klasse: "zh-sicher", hidden: true }, zeichen("schild", 14), h("span", { text: Z.sicher }));
  const box = h("div", { klasse: "dialog rm-dialog ab-dialog zh-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "zh-titel", "data-dialog": "zurueckholen" },
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("uhr", 20)), h("h2", { klasse: "rm-titel", id: "zh-titel", text: Z.titel })),
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
    laeuft = true; setzeLaedt(knopf, true); abbrechen.disabled = true;
    meldung.zeige("hinweis", T.arbeitet, null);
    const ende = arbeitBeginnt("commit");
    try {
      const r = await api.zurueckholen(pfad, sha);
      ende();
      d.schliessen();
      toast(r?.unveraendert ? Z.schonAktuell : Z.fertig, { ms: 6000 });
      beiFertig?.({ pfad, sha, unveraendert: !!r?.unveraendert });
    } catch (err) {
      ende(); laeuft = false; setzeLaedt(knopf, false); abbrechen.disabled = false;
      if (gitGesperrt(err)) meldung.zeige("fehlertext", TV.diff.gesperrt, "warnung");
      else if (ausgangUnklar(err)) { try { await beiStandNeu?.(err); } catch (x) { console.error(x); } meldung.zeige("hinweis", zeitText(err), "info"); }
      else if (err?.status === 409 && err?.daten?.konflikt) meldung.zeige("fehlertext", Z.konflikt, "warnung");
      else if (err?.status === 409 && err?.daten?.art === "ungesichert") { meldung.zeige("hinweis", Z.ungesichert, "info"); sichern.hidden = !beiSichern; }
      else { meldung.zeige("fehlertext", klarText(err, Z.scheitert), "warnung", err?.message); knopf.disabled = false; }
    }
  });
  return d;
}
