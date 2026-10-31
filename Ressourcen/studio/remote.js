// Dialog „Remote hinzufügen“: Adresse eingeben, prüfen lassen, verbinden.
import { h, dialog, dialogEinmalig, arbeitBeginnt, ausTabelle } from "./hilfen.js";
import { textfeld, knopf as baueKnopf, setzeLaedt } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { markenLogo } from "./marken.js";
import { api, gitGesperrt, ausgangUnklar, zeitText, ladeStandNeu } from "./api.js";
import { TV } from "./texte-verlauf.js";
import { istRohGit, detailsBlock } from "./verlauf.js";

const CSS_URL = new URL("./verlauf.css", import.meta.url).href;
function ladeCss() {
  if (document.querySelector("link[data-verlauf-css]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = CSS_URL; l.setAttribute("data-verlauf-css", "");
  document.head.append(l);
}

// Eine Git-Adresse: https://…, ssh://…, git://…, file://…, name@host:pfad oder ein absoluter Pfad. Keine Leerzeichen.
export function istGitAdresse(s) {
  if (!s || /\s/.test(s)) return false;
  return /^(https?|ssh|git|file):\/\/\S+$/i.test(s) || /^[\w.-]+@[\w.-]+:\S+$/.test(s) || /^(\/|~\/)\S+$/.test(s);
}

const zeichen = (name, groesse) => { const s = symbol(name, groesse); s.setAttribute("aria-hidden", "true"); return s; };

// beiStandNeu(stand): die App frischt nach unklarem Ausgang (Zeitüberschreitung) Info, Vault-Liste und Git-Status auf.
export function oeffneRemoteDialog(opt = {}) { return dialogEinmalig("remote", () => baueRemoteDialog(opt)); }
function baueRemoteDialog({ beiFertig, beiStandNeu } = {}) {
  ladeCss();
  let verbunden = false;
  let gemeldet = false;
  let laeuft = false;
  const melde = () => { if (gemeldet) return; gemeldet = true; beiFertig?.(); };

  const adressFeld = textfeld({ id: "rm-adresse", platzhalter: TV.remote.platzhalter, beschreibung: "rm-hinweis rm-meldung", daten: { "data-feld": "adresse" } });
  const eingabe = adressFeld.input;
  const meldung = h("div", { klasse: "rm-meldung", id: "rm-meldung", "aria-live": "polite" });
  const knopf = baueKnopf({ variante: "primaer", typ: "submit", aktion: "verbinden", daten: { form: "rm-form" }, kinder: [h("span", { text: TV.remote.verbinden })] });
  const abbrechen = baueKnopf({ text: TV.remote.abbrechen, aktion: "abbrechen" });
  const form = h("form", { klasse: "rm-form", id: "rm-form", novalidate: true },
    h("div", { klasse: "feld" }, h("label", { for: "rm-adresse", text: TV.remote.label }), adressFeld.el),
    h("p", { klasse: "rm-hinweis", id: "rm-hinweis", text: TV.remote.hinweis }),
    meldung);

  // Einheitliche Dialoghülle (hilfen.js): Titel, ein Satz, Inhalt, Fußleiste mit einem Hauptknopf rechts; Enter verbindet, Esc schließt.
  const d = dialog({ titel: TV.remote.titel, satz: TV.remote.erklaerung, rumpf: [form], knoepfe: [abbrechen, knopf], beiSchliessen: () => { if (verbunden) melde(); } });
  d.box.setAttribute("data-dialog", "remote");
  const kopf = d.box.querySelector(".dialog-kopf");
  kopf?.classList.add("rm-titel");
  // Dezentes Symbol vor dem Titel: bei einer GitHub-Adresse deren Logo, sonst die Wolke
  const kopfZeichen = h("span", { klasse: "rm-zeichen" }, zeichen("wolke", 20));
  const zeigeKopfzeichen = (adresse) => kopfZeichen.replaceChildren(/(^|[@/.])github\.com([:/]|$)/i.test(adresse) ? markenLogo("github", 20, { dekorativ: true }) : zeichen("wolke", 20));
  kopf?.prepend(kopfZeichen);
  d.box.querySelector(".dialog-satz")?.classList.add("rm-text");

  const zeige = (art, text, symbolName, kopf, roh = null) => {
    meldung.className = "rm-meldung" + (art ? " " + art : "");
    meldung.replaceChildren(...(text ? [symbolName ? zeichen(symbolName, 14) : null, h("div", { klasse: "rm-meldung-text" }, h("span", null, ...(kopf ? [h("strong", { text: kopf }), " "] : []), text), roh ? detailsBlock(roh) : null)].filter(Boolean) : []));
    eingabe.setAttribute("aria-invalid", art === "fehlertext" || art === "hinweis" ? "true" : "false");
  };
  const beschaeftigt = (an) => {
    laeuft = an;
    eingabe.disabled = an;
    setzeLaedt(knopf, an); // Spinner im Knopf (erscheint erst nach ~140 ms), die Breite bleibt
    abbrechen.disabled = an;
  };

  abbrechen.addEventListener("click", () => d.schliessen());
  eingabe.addEventListener("input", () => { zeigeKopfzeichen(eingabe.value); if (!laeuft) zeige("", ""); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (laeuft || verbunden) return;
    const url = eingabe.value.trim();
    if (!url) { zeige("hinweis", TV.remote.leer, "info"); eingabe.focus(); return; }
    if (!istGitAdresse(url)) { zeige("hinweis", TV.remote.ungueltig, "info"); eingabe.focus(); return; }
    zeige("", ""); beschaeftigt(true);
    meldung.className = "rm-meldung";
    const wartetext = h("span", { text: TV.remote.prueft });
    meldung.replaceChildren(h("span", { klasse: "rm-spinner", "aria-hidden": "true" }), wartetext);
    // große Vaults können bis zu zwei Minuten brauchen: nach ein paar Sekunden sagen, dass es normal ist
    const spaet = setTimeout(() => { wartetext.textContent = `${TV.remote.prueft} ${TV.remote.dauert}`; }, 6000);
    const ende = arbeitBeginnt("remote"); // Schließen des Fensters fragt nach, solange das läuft
    try {
      const r = await api.gitRemote(url);
      clearTimeout(spaet);
      verbunden = true;
      eingabe.disabled = true; setzeLaedt(knopf, false); knopf.disabled = true; abbrechen.disabled = true;
      zeige("erfolg", r?.ergebnis === "gesendet" ? TV.remote.erfolgGesendet : r?.ergebnis === "geholt" ? TV.remote.erfolgGeholt : TV.remote.erfolg, "haken");
      setTimeout(() => { melde(); d.schliessen(); }, r?.ergebnis === "gesendet" || r?.ergebnis === "geholt" ? 1600 : 800);
    } catch (err) {
      clearTimeout(spaet);
      if (gitGesperrt(err)) zeige("fehlertext", TV.remote.gesperrt, "warnung");
      else if (ausgangUnklar(err)) {
        // Ob es geklappt hat, ist unklar: Stand neu holen (die Statusleiste zeigt dann das Remote) und ehrlich sagen
        const stand = await ladeStandNeu();
        if (stand.ok) { try { await beiStandNeu?.(stand); } catch (x) { console.error(x); } zeige("hinweis", zeitText(err), "info"); }
        else zeige("fehlertext", istRohGit(err?.message) ? TV.remote.fehler : (err?.message || TV.remote.fehler), "warnung", undefined, istRohGit(err?.message) ? err.message : null);
      } else {
        const t = err?.daten?.fehler || err?.message || TV.remote.fehler;
        const roh = istRohGit(t);
        zeige("fehlertext", roh ? TV.remote.fehler : t, "warnung", ausTabelle(TV.remote.arten, err?.daten?.art), roh ? t : null);
      }
      beschaeftigt(false);
      eingabe.focus();
    } finally { ende(); }
  });
  return d;
}
