// Dialog „Remote hinzufügen“: Adresse eingeben, prüfen lassen, verbinden.
import { h, dialog } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { api } from "./api.js";
import { TV } from "./texte-verlauf.js";

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

export function oeffneRemoteDialog({ beiFertig } = {}) {
  ladeCss();
  let verbunden = false;
  let gemeldet = false;
  let laeuft = false;
  const melde = () => { if (gemeldet) return; gemeldet = true; beiFertig?.(); };

  const eingabe = h("input", { type: "text", id: "rm-adresse", "data-feld": "adresse", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: TV.remote.platzhalter, "aria-describedby": "rm-hinweis rm-meldung" });
  const meldung = h("div", { klasse: "rm-meldung", id: "rm-meldung", "aria-live": "polite" });
  const knopf = h("button", { klasse: "knopf primaer gross", type: "submit", "data-aktion": "verbinden" }, h("span", { text: TV.remote.verbinden }));
  const abbrechen = h("button", { klasse: "knopf gross", type: "button", "data-aktion": "abbrechen", text: TV.remote.abbrechen });
  const zu = h("button", { klasse: "knopf-icon rm-zu", type: "button", "aria-label": TV.remote.schliessen, title: TV.remote.schliessen }, zeichen("schliessen", 14));
  const form = h("form", { klasse: "rm-form", novalidate: true },
    h("div", { klasse: "feld" }, h("label", { for: "rm-adresse", text: TV.remote.label }), eingabe),
    h("p", { klasse: "rm-hinweis", id: "rm-hinweis", text: TV.remote.hinweis }),
    meldung,
    h("div", { klasse: "rm-fuss" }, abbrechen, knopf));
  const box = h("div", { klasse: "dialog rm-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "rm-titel", "data-dialog": "remote" },
    zu,
    h("div", { klasse: "rm-kopf" }, h("span", { klasse: "rm-zeichen" }, zeichen("wolke", 18)), h("h2", { klasse: "rm-titel", id: "rm-titel", text: TV.remote.titel })),
    h("p", { klasse: "rm-text", text: TV.remote.erklaerung }),
    form);

  const d = dialog({ eigen: box, beiSchliessen: () => { if (verbunden) melde(); } });

  const zeige = (art, text, symbolName, kopf) => {
    meldung.className = "rm-meldung" + (art ? " " + art : "");
    meldung.replaceChildren(...(text ? [symbolName ? zeichen(symbolName, 14) : null, h("span", null, ...(kopf ? [h("strong", { text: kopf }), " "] : []), text)].filter(Boolean) : []));
    eingabe.setAttribute("aria-invalid", art === "fehlertext" || art === "hinweis" ? "true" : "false");
  };
  const beschaeftigt = (an) => {
    laeuft = an;
    eingabe.disabled = an;
    knopf.disabled = an;
    abbrechen.disabled = an;
    knopf.replaceChildren(...(an ? [h("span", { klasse: "rm-spinner", "aria-hidden": "true" }), h("span", { text: TV.remote.verbinden })] : [h("span", { text: TV.remote.verbinden })]));
  };

  zu.addEventListener("click", () => d.schliessen());
  abbrechen.addEventListener("click", () => d.schliessen());
  eingabe.addEventListener("input", () => { if (!laeuft) zeige("", ""); });
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
    try {
      const r = await api.gitRemote(url);
      clearTimeout(spaet);
      verbunden = true;
      eingabe.disabled = true; knopf.disabled = true; abbrechen.disabled = true;
      knopf.replaceChildren(h("span", { text: TV.remote.verbinden }));
      zeige("erfolg", r?.ergebnis === "gesendet" ? TV.remote.erfolgGesendet : r?.ergebnis === "geholt" ? TV.remote.erfolgGeholt : TV.remote.erfolg, "haken");
      setTimeout(() => { melde(); d.schliessen(); }, r?.ergebnis === "gesendet" || r?.ergebnis === "geholt" ? 1600 : 800);
    } catch (err) {
      clearTimeout(spaet);
      beschaeftigt(false);
      zeige("fehlertext", err?.daten?.fehler || err?.message || TV.remote.fehler, "warnung", TV.remote.arten[err?.daten?.art]);
      eingabe.focus();
    }
  });
  return d;
}
