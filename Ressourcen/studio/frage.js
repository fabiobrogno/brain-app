// „Frag deinen Vault“ — das Panel rechts im Studio (docs/plaene/ki-konten.md §4). Eine Frage an die installierte KI-CLI eines KI-Kontos; die KI liest den Vault nur über
// Kortex, nur lesend. Nichts wird gespeichert: Frage und Antwort leben nur im Speicher dieses Fensters.
// Ablauf: POST /api/frage/start → Long-Poll GET /api/frage/stand (Text, Werkzeuge, Quellen) → fertig. Abbrechen: POST /api/frage/abbrechen.
// Die Antwort wird als Text gerendert (frage-markdown.js): kein HTML, keine Links; anklickbar sind nur Seiten, die es im Vault gibt.
import { api } from "./api.js";
import { h, leseLokal, speichereLokal, dialogOffen } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { TF } from "./texte-frage.js";
import { rendereMarkdown } from "./frage-markdown.js";

const wartePause = (ms) => new Promise((r) => setTimeout(r, ms));

// z: { vaultPfad(): string|null, oeffneSeite(pfad), oeffneVertrauen(): Dialog|null, oeffneKi(): void }
export function erzeugeFragePanel(z) {
  const host = document.getElementById("frage-host");
  let offen = false;
  let bereit = null, bereitFehler = null, laedt = false;
  let konto = null, modell = leseLokal("frage.modell", "klein"), text = "";
  let lauf = null; // { id, frage, kontoId, kontoName, abo, ab, textAb, epoche, antwort, status, quellen, verweise, unbekannt, gekuerzt, fertig, ergebnis, abbrechend }
  let prueft = 0, fixiert = true;

  const kopf = h("header", { klasse: "frage-kopf" },
    h("div", { klasse: "frage-titel" }, symbol("frage", 16), h("h2", { id: "frage-titel", text: TF.titel })),
    h("button", { klasse: "knopf-icon", type: "button", "data-aktion": "frage-zu", title: `${TF.schliessen} (Esc)`, "aria-label": TF.schliessen, aufClick: () => schliesse() }, symbol("schliessen", 12)));
  const leer = h("div", { klasse: "frage-leer", hidden: true, "data-frage": "leer" });
  const formular = h("form", { klasse: "frage-form", hidden: true, "data-frage": "formular", novalidate: true });
  const ausgabe = h("div", { klasse: "frage-ausgabe", "data-frage": "ausgabe" });
  const rumpf = h("div", { klasse: "frage-rumpf" }, leer, formular, ausgabe);
  const fuss = h("footer", { klasse: "frage-fuss", "data-frage": "fuss" }, symbol("schild", 12), h("span", { text: `${TF.nichtGespeichert} ${TF.nurLesen}` }));
  const panel = h("aside", { id: "frage", klasse: "frage", role: "complementary", "aria-labelledby": "frage-titel", hidden: true, "data-frage": "panel" }, kopf, rumpf, fuss);
  host.replaceChildren(panel);
  rumpf.addEventListener("scroll", () => { fixiert = rumpf.scrollHeight - rumpf.scrollTop - rumpf.clientHeight < 40; });

  // ---------- Daten ----------
  const vaultSchluessel = () => z.vaultPfad() || "";
  async function ladeBereit() {
    const nr = ++prueft;
    laedt = true; bereitFehler = null;
    zeichneRumpf();
    try { const b = await api.frageBereit(); if (nr !== prueft) return; bereit = b; }
    catch (e) { if (nr !== prueft) return; bereit = null; bereitFehler = e.message || TF.bereitFehler; }
    laedt = false;
    const erlaubte = (bereit?.konten || []).filter((k) => k.erlaubt);
    const gemerkt = leseLokal(`frage.konto@${vaultSchluessel()}`, null);
    konto = erlaubte.find((k) => k.id === konto)?.id || erlaubte.find((k) => k.id === gemerkt)?.id || erlaubte[0]?.id || null;
    zeichneRumpf();
    if (offen && !lauf) setTimeout(() => formular.querySelector("textarea")?.focus(), 0);
  }
  const kontoDaten = (id) => (bereit?.konten || []).find((k) => k.id === id) || null;

  // ---------- Leere Zustände ----------
  function leerZustand() {
    if (!bereit) return bereitFehler ? { ...TF.leer.kontenDefekt, text: bereitFehler, aktion: ladeBereit } : null;
    if (!bereit.vertraut) return { ...TF.leer.nichtVertraut, symbol: "schild", aktion: () => beobachte(z.oeffneVertrauen()), art: "nicht-vertraut" };
    if (!bereit.claude) return { ...TF.leer.keinClaude, aktion: ladeBereit, art: "kein-claude" };
    if (bereit.kontenDefekt) return { ...TF.leer.kontenDefekt, aktion: ladeBereit, art: "konten-defekt" };
    if (!bereit.konten.some((k) => k.erlaubt)) {
      const t = bereit.konten.length ? TF.leer.nurAndere : TF.leer.keinKonto;
      return { ...t, aktion: () => { z.oeffneKi(); }, art: bereit.konten.length ? "nur-andere" : "kein-konto" };
    }
    return null;
  }
  // Wartet, bis ein Dialog (Vertrauen) zu ist, und prüft dann neu
  function beobachte(d) {
    if (!d || !d.box) return;
    const t = setInterval(() => { if (!d.box.isConnected) { clearInterval(t); ladeBereit(); } }, 300);
    setTimeout(() => clearInterval(t), 10 * 60_000);
  }
  function zeichneLeer(l) {
    const knoepfe = [];
    if (l.aktion) knoepfe.push(h("button", { klasse: "knopf primaer", type: "button", "data-aktion": "frage-leer-aktion", text: l.knopf, aufClick: () => l.aktion() }));
    if (l.art && l.aktion !== ladeBereit) knoepfe.push(h("button", { klasse: "knopf", type: "button", "data-aktion": "frage-neu-pruefen", text: "Noch einmal prüfen", aufClick: () => ladeBereit() }));
    leer.replaceChildren(h("div", { klasse: "frage-leer-zeichen" }, symbol(l.symbol || "frage", 24)), h("h3", { text: l.titel }), h("p", { text: l.text }), h("div", { klasse: "frage-leer-knoepfe" }, ...knoepfe));
    if (l.art) leer.dataset.grund = l.art; else delete leer.dataset.grund;
  }

  // ---------- Formular ----------
  function zeichneFormular() {
    const erlaubte = (bereit?.konten || []).filter((k) => k.erlaubt);
    const andere = (bereit?.konten || []).filter((k) => !k.erlaubt);
    const laeuft = !!(lauf && !lauf.fertig);
    const gruppe = h("div", { klasse: "frage-konten", role: "radiogroup", "aria-label": TF.konto, "data-frage": "konten" });
    const waehle = (id) => { if (laeuft) return; konto = id; speichereLokal(`frage.konto@${vaultSchluessel()}`, id); zeichneFormular(); formular.querySelector("textarea")?.focus(); };
    erlaubte.forEach((k, i) => {
      const b = h("button", { klasse: "frage-konto", type: "button", role: "radio", "aria-checked": String(k.id === konto), tabindex: k.id === konto ? "0" : "-1", "data-konto": k.id, disabled: laeuft && k.id !== konto, title: TF.kontoHinweis,
        aufClick: () => waehle(k.id),
        aufKeydown: (e) => {
          const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          waehle(erlaubte[(i + d + erlaubte.length) % erlaubte.length].id);
          formular.querySelector(`[data-konto="${erlaubte[(i + d + erlaubte.length) % erlaubte.length].id}"]`)?.focus();
        } },
        kiLogo(k.programm, 16, { dekorativ: true }) || symbol("claude", 16), h("span", { klasse: "frage-konto-name", text: k.name }));
      gruppe.append(b);
    });
    const modellGruppe = h("div", { klasse: "frage-modell", role: "radiogroup", "aria-label": TF.modell, "data-frage": "modell" },
      ...bereit.modelle.map((m) => h("button", { klasse: "frage-segment", type: "button", role: "radio", "aria-checked": String(m === modell), "data-modell": m, title: TF.modellHinweis[m] || "", disabled: laeuft,
        aufClick: () => { modell = m; speichereLokal("frage.modell", m); zeichneFormular(); } }, TF.modelle[m] || m)));
    const eingabe = h("textarea", { klasse: "frage-eingabe", rows: "3", maxlength: String(bereit.grenzen.frageMax), placeholder: TF.platzhalter, "aria-label": TF.titel, spellcheck: "true", disabled: laeuft, "data-frage": "eingabe" });
    eingabe.value = text;
    eingabe.addEventListener("input", () => { text = eingabe.value; knopf.disabled = !text.trim(); });
    eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); sende(); } });
    const knopf = h("button", { klasse: "knopf primaer", type: "submit", "data-aktion": "frage-senden", disabled: !text.trim() }, h("span", { text: TF.fragen }), h("kbd", { text: TF.fragenKurz }));
    const k = kontoDaten(konto);
    const hinweise = [k ? h("p", { klasse: "frage-weg", "data-frage": "weg", text: TF.weg(k.name, TF.anbieter) }) : null,
      andere.length ? h("p", { klasse: "frage-hinweis", "data-frage": "nur-claude", text: TF.leer.nurClaude }) : null];
    formular.replaceChildren(
      h("div", { klasse: "frage-zeile" }, h("span", { klasse: "frage-label", text: TF.konto }), gruppe),
      h("div", { klasse: "frage-zeile" }, h("span", { klasse: "frage-label", text: TF.modell }), modellGruppe),
      eingabe,
      h("div", { klasse: "frage-aktionen" }, knopf),
      ...hinweise);
  }
  formular.addEventListener("submit", (e) => { e.preventDefault(); sende(); });

  function zeichneRumpf() {
    if (laedt && !bereit) { leer.hidden = false; formular.hidden = true; ausgabe.hidden = true; leer.replaceChildren(h("p", { klasse: "leise", text: "Lade …" })); return; }
    const l = leerZustand();
    leer.hidden = !l; formular.hidden = !!l || !!lauf; ausgabe.hidden = !!l; // mit einer Frage (laufend oder fertig) zeigt das Panel nur Frage, Antwort und Quellen
    if (l) { zeichneLeer(l); return; }
    zeichneFormular();
    zeichneAusgabe();
  }

  // ---------- Ausgabe ----------
  function stufenPille(stufe) {
    return h("span", { klasse: `frage-stufe ${stufe}`, "data-stufe": stufe }, h("span", { klasse: `punkt ${stufe}`, "aria-hidden": "true" }), TF.stufen[stufe] || TF.stufen.unbekannt);
  }
  function zeichneAusgabe() {
    if (!lauf) { ausgabe.replaceChildren(); return; }
    const l = lauf, teile = [];
    teile.push(h("section", { klasse: "frage-block frage-gefragt", "data-frage": "gefragt" },
      h("h3", { klasse: "frage-label", text: `${TF.deineFrage} · ${l.kontoName} · ${TF.modelle[l.modell] || l.modell}` }), h("p", { klasse: "frage-gefragt-text", text: l.frage })));
    if (!l.fertig) {
      teile.push(h("div", { klasse: "frage-status", "data-frage": "status" },
        h("span", { klasse: "frage-punkte", "aria-hidden": "true" }), h("span", { klasse: "frage-status-text", role: "status", text: l.abbrechend ? "Wird abgebrochen …" : l.status || TF.wartet }),
        h("button", { klasse: "knopf", type: "button", "data-aktion": "frage-abbrechen", disabled: !!l.abbrechend, aufClick: () => abbrechen() }, TF.abbrechen)));
    }
    if (l.antwort) {
      const a = h("div", { klasse: "frage-antwort", "data-frage": "antwort", "aria-busy": String(!l.fertig) });
      a.append(rendereMarkdown(l.antwort, { verweise: l.verweise, oeffne: (p) => z.oeffneSeite(p) }));
      teile.push(h("section", { klasse: "frage-block" }, h("h3", { klasse: "frage-label", text: TF.antwort }), a, l.gekuerzt ? h("p", { klasse: "frage-hinweis", text: TF.gekuerzt }) : null));
    }
    const e = l.ergebnis;
    if (l.fertig && e && !e.ok) {
      const stumm = e.abgebrochen === true;
      teile.push(h("div", { klasse: `frage-meldung${stumm ? " abbruch" : " fehler"}`, role: stumm ? "status" : "alert", "data-frage": stumm ? "abgebrochen" : "fehler" },
        stumm ? null : h("strong", { text: `${TF.fehlerTitel}. ` }), h("span", { text: e.fehler || TF.abgebrochen })));
    }
    if (l.quellen.length || (l.fertig && e?.ok)) {
      const q = h("section", { klasse: "frage-block frage-quellen", "data-frage": "quellen" }, h("h3", { klasse: "frage-label", text: TF.quellen }));
      if (l.quellen.length) {
        const liste = h("ul", { klasse: "frage-quellenliste" });
        for (const s of l.quellen) {
          liste.append(h("li", null, h("button", { klasse: "frage-quelle", type: "button", "data-pfad": s.pfad, "data-art": s.art, title: s.pfad, aufClick: () => z.oeffneSeite(s.pfad) },
            h("span", { klasse: "frage-quelle-titel", text: s.titel }), h("span", { klasse: "frage-quelle-pfad", text: s.pfad }),
            h("span", { klasse: "frage-quelle-meta" }, stufenPille(s.stufe), h("span", { klasse: `frage-art ${s.art}`, text: TF.quelleArt[s.art] || s.art })))));
        }
        q.append(liste);
      } else q.append(h("p", { klasse: "frage-hinweis", text: TF.keineQuellen }));
      if (l.unbekannt > 0) q.append(h("p", { klasse: "frage-hinweis", "data-frage": "unbekannt", text: TF.unbekannt(l.unbekannt) }));
      teile.push(q);
    }
    if (l.fertig && e?.ok) {
      const v = TF.verbrauchText(e, l.abo, l.kontoName);
      if (v) teile.push(h("p", { klasse: "frage-verbrauch", "data-frage": "verbrauch", title: TF.verbrauch.titel }, h("span", { klasse: "frage-label", text: `${TF.verbrauch.titel}: ` }), v));
    }
    if (l.fertig) teile.push(h("div", { klasse: "frage-aktionen" }, h("button", { klasse: "knopf", type: "button", "data-aktion": "frage-neue", text: TF.neu, aufClick: () => neueFrage() })));
    ausgabe.replaceChildren(...teile);
    if (!l.fertig && fixiert) rumpf.scrollTop = rumpf.scrollHeight; // während des Schreibens mitlaufen, solange niemand nach oben gescrollt hat
  }

  // ---------- Frage stellen ----------
  const statusAus = (ereignisse) => {
    for (let i = ereignisse.length - 1; i >= 0; i--) {
      const e = ereignisse[i];
      if (e.art === "werkzeug") return e.name === "suchen" ? TF.sucht(e.detail) : e.name === "lesen" ? TF.liest(e.detail || "") : e.name === "kontext" ? TF.kontextHolt : TF.abgelehnt;
      if (e.art === "wiederholt") return TF.wiederholt;
    }
    return null;
  };
  async function sende() {
    const frage = text.trim();
    if (!frage || (lauf && !lauf.fertig) || !konto) return;
    const k = kontoDaten(konto);
    const neu = { id: null, frage, modell, kontoId: konto, kontoName: k?.name || "", abo: k?.abo || null, ab: 0, textAb: 0, epoche: 0, antwort: "", status: TF.wartet, quellen: [], verweise: {}, unbekannt: 0, gekuerzt: false, fertig: false, ergebnis: null, abbrechend: false };
    lauf = neu;
    zeichneRumpf();
    ausgabe.querySelector('[data-aktion="frage-abbrechen"]')?.focus(); // der Fokus bleibt im Panel (Esc bricht ab)
    let id;
    try { ({ id } = await api.frageStart(frage, konto, modell)); }
    catch (e) {
      neu.fertig = true; neu.ergebnis = { ok: false, fehler: e.message || TF.fehlerStart };
      zeichneRumpf();
      if (e.daten?.art === "nicht-vertraut" || e.daten?.art === "kein-zugriff" || e.daten?.art === "kein-claude") ladeBereit();
      return;
    }
    neu.id = id;
    pollen(neu);
  }
  async function pollen(l) {
    let fehler = 0;
    while (!l.fertig && lauf === l) {
      let r;
      try { r = await api.frageStand({ id: l.id, ab: l.ab, text: l.textAb, epoche: l.epoche }); fehler = 0; }
      catch (e) {
        if (e.status === 404 || ++fehler > 3) { l.fertig = true; l.ergebnis = { ok: false, fehler: TF.fehlerVerbindung }; break; }
        await wartePause(400); continue;
      }
      if (lauf !== l) return;
      l.antwort = r.epoche !== l.epoche ? r.text : l.antwort + r.text;
      l.epoche = r.epoche; l.textAb = r.textAb; l.ab = r.n;
      l.quellen = r.quellen; l.verweise = r.verweise || {}; l.unbekannt = r.unbekannt || 0; l.gekuerzt = !!r.gekuerzt;
      l.status = statusAus(r.ereignisse) || (l.antwort ? TF.schreibt : l.status);
      if (r.fertig) { l.fertig = true; l.ergebnis = r.ergebnis; }
      zeichneAusgabe();
    }
    if (lauf !== l) return;
    zeichneRumpf();
    if (l.ergebnis?.ok) ansage(`${TF.antwort} ist fertig.`);
  }
  async function abbrechen() {
    if (!lauf || lauf.fertig || lauf.abbrechend) return;
    lauf.abbrechend = true;
    zeichneAusgabe();
    try { await api.frageAbbrechen(lauf.id); } catch { /* die Werkstatt beendet die Frage sonst nach der Frist */ }
  }
  function neueFrage() {
    lauf = null; text = "";
    zeichneRumpf();
    formular.querySelector("textarea")?.focus();
  }
  const knopfZustand = () => document.getElementById("knopf-frage")?.setAttribute("aria-pressed", String(offen));
  function ansage(t) { const a = document.getElementById("status-ansage"); if (a) a.textContent = t; }

  // ---------- Öffnen und Schließen ----------
  function oeffne() {
    if (!z.vaultPfad()) return;
    offen = true; panel.hidden = false; document.getElementById("app")?.setAttribute("data-frage", "an"); knopfZustand();
    fixiert = true;
    ladeBereit();
    setTimeout(() => formular.querySelector("textarea")?.focus(), 0);
  }
  function schliesse() {
    if (!offen) return;
    if (lauf && !lauf.fertig) abbrechen(); // ein Fenster, das zu ist, fragt nicht weiter
    offen = false; panel.hidden = true; document.getElementById("app")?.removeAttribute("data-frage"); knopfZustand();
    document.getElementById("knopf-frage")?.focus();
  }
  const umschalten = () => (offen ? schliesse() : oeffne());
  // Esc: läuft eine Frage, bricht es sie ab, sonst schließt es das Panel — wenn der Fokus im Panel oder nirgends ist und kein Dialog offen ist
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !offen || dialogOffen()) return;
    const a = document.activeElement;
    if (a && a !== document.body && !panel.contains(a)) return;
    e.preventDefault(); e.stopPropagation();
    if (lauf && !lauf.fertig) abbrechen(); else schliesse();
  });
  window.addEventListener("pagehide", () => { if (lauf && !lauf.fertig && lauf.id) { try { api.frageAbbrechen(lauf.id); } catch { /* egal */ } } });
  // Vault gewechselt: alles vergessen (die Werkstatt hat die Frage schon beendet)
  function zuruecksetzen() {
    prueft++; lauf = null; text = ""; bereit = null; bereitFehler = null; konto = null; laedt = false;
    ausgabe.replaceChildren(); formular.replaceChildren();
    if (offen) { offen = false; panel.hidden = true; document.getElementById("app")?.removeAttribute("data-frage"); knopfZustand(); }
  }
  return { oeffne, schliesse, umschalten, zuruecksetzen, istOffen: () => offen, laeuft: () => !!(lauf && !lauf.fertig) };
}
