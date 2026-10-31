// „Frag deinen Vault“ — das Panel rechts im Studio (docs/plaene/ki-konten.md §4). Eine Frage an die installierte KI-CLI eines KI-Kontos; die KI liest den Vault nur über
// Kortex, nur lesend. Nichts wird gespeichert: Frage und Antwort leben nur im Speicher dieses Fensters.
// Ablauf: POST /api/frage/start → Long-Poll GET /api/frage/stand (Text, Werkzeuge, Quellen) → fertig. Abbrechen: POST /api/frage/abbrechen.
// Die Antwort wird als Text gerendert (frage-markdown.js): kein HTML, keine Links; anklickbar sind nur Seiten, die es im Vault gibt.
import { api } from "./api.js";
import { h, leseLokal, speichereLokal, dialogOffen } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { TF } from "./texte-frage.js";
import { rendereMarkdown } from "./frage-markdown.js";
import { auswahl, segment, textbereich, knopf as baueKnopf } from "./bausteine.js";
import { kontingentStand, kontingentKompakt, kontoAnsicht, optionSub, FRAGE_KONTO_EREIGNIS } from "./kontingent.js";

const wartePause = (ms) => new Promise((r) => setTimeout(r, ms));

// z: { vaultPfad(): string|null, oeffneSeite(pfad), oeffneVertrauen(): Dialog|null, oeffneKi(): void, beiUmschalten?(offen): void }
// Das Panel sitzt in der rechten Spalte des Hauptfensters (#frage-host); offen/zu steuert data-frage am #app, das Gleiten übernimmt frage.css.
export function erzeugeFragePanel(z) {
  const host = document.getElementById("frage-host");
  let offen = false;
  let bereit = null, bereitFehler = null, laedt = false;
  let konto = null, modell = leseLokal("frage.modell", "klein"), text = "";
  let lauf = null; // { id, frage, kontoId, kontoName, abo, ab, textAb, epoche, antwort, status, quellen, verweise, unbekannt, gekuerzt, fertig, ergebnis, abbrechend }
  let prueft = 0, fixiert = true;

  const kopf = h("header", { klasse: "frage-kopf" },
    h("div", { klasse: "frage-titel" }, symbol("funke", 16), h("h2", { id: "frage-titel", text: TF.titel })),
    baueKnopf({ symbol: "schliessen", variante: "leise", groesse: "s", aktion: "frage-zu", titel: `${TF.schliessen} (Esc)`, label: TF.schliessen, aufKlick: () => schliesse() }));
  const leer = h("div", { klasse: "frage-leer", hidden: true, "data-frage": "leer" });
  const formular = h("form", { klasse: "frage-form", hidden: true, "data-frage": "formular", novalidate: true });
  const ausgabe = h("div", { klasse: "frage-ausgabe", "data-frage": "ausgabe" });
  const rumpf = h("div", { klasse: "frage-rumpf" }, leer, formular, ausgabe);
  const fuss = h("footer", { klasse: "frage-fuss", "data-frage": "fuss" }, symbol("schild", 12), h("span", { text: `${TF.nichtGespeichert} ${TF.nurLesen}` }));
  const panel = h("aside", { id: "frage", klasse: "frage", role: "complementary", "aria-labelledby": "frage-titel", inert: true, "data-frage": "panel" }, kopf, rumpf, fuss);
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
    // Die Wahl kann auch in den Einstellungen (KI & Konten → Frag deinen Vault) geändert worden sein: die gemerkten Werte gelten zuerst
    const gemerkt = leseLokal(`frage.konto@${vaultSchluessel()}`, null);
    modell = leseLokal("frage.modell", modell);
    konto = erlaubte.find((k) => k.id === gemerkt)?.id || erlaubte.find((k) => k.id === konto)?.id || erlaubte[0]?.id || null;
    zeichneRumpf();
    if (offen && !lauf) setTimeout(() => formular.querySelector("textarea")?.focus(), 0);
  }
  const kontoDaten = (id) => (bereit?.konten || []).find((k) => k.id === id) || null;

  // Kontingent (P7): beide Balken des gewählten Kontos unter der Auswahl; ist es voll, steht da, ab wann es wieder geht. Ein eigener Behälter, damit ein neuer Stand das Formular nicht neu baut.
  const kt = kontingentStand(api);
  const ktHost = h("div", { klasse: "frage-kt", "data-frage": "kontingent" });
  function fuelleKt() {
    const k = kontoDaten(konto);
    if (!k || !bereit) { ktHost.replaceChildren(); return; }
    const jetzt = kt.jetzt();
    const andereFrei = (bereit.konten || []).filter((x) => x.erlaubt && x.id !== konto).some((x) => !kontoAnsicht(kt.eintrag(x.id), jetzt).voll);
    ktHost.replaceChildren(kontingentKompakt(kt.eintrag(konto), { jetzt, name: k.name, andereFrei }));
  }
  kt.abonniere(() => fuelleKt());
  // Das Konto wurde in der Statusleiste gewechselt: dieselbe Wahl gilt hier (nur ein Konto, das dieser Vault für Frag erlaubt)
  window.addEventListener(FRAGE_KONTO_EREIGNIS, (ev) => {
    const d = ev.detail || {};
    if (!bereit || d.vault !== vaultSchluessel() || d.id === konto) return;
    if (!bereit.konten.some((x) => x.erlaubt && x.id === d.id)) return;
    konto = d.id;
    if (!lauf && !formular.hidden) { zeichneFormular(); } else fuelleKt();
  });

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
    if (l.aktion) knoepfe.push(baueKnopf({ text: l.knopf, variante: "primaer", aktion: "frage-leer-aktion", aufKlick: () => l.aktion() }));
    if (l.art && l.aktion !== ladeBereit) knoepfe.push(baueKnopf({ text: "Noch einmal prüfen", aktion: "frage-neu-pruefen", aufKlick: () => ladeBereit() }));
    leer.replaceChildren(h("div", { klasse: "frage-leer-zeichen" }, symbol(l.symbol || "frage", 24)), h("h3", { text: l.titel }), h("p", { text: l.text }), h("div", { klasse: "frage-leer-knoepfe" }, ...knoepfe));
    if (l.art) leer.dataset.grund = l.art; else delete leer.dataset.grund;
  }

  // ---------- Formular ----------
  function zeichneFormular() {
    const erlaubte = (bereit?.konten || []).filter((k) => k.erlaubt);
    const andere = (bereit?.konten || []).filter((k) => !k.erlaubt);
    const k = kontoDaten(konto);
    // Bedienelemente aus bausteine.js (Auswahl mit Logo, Segment, Textbereich, Knopf), nicht die nativen des Systems
    const jetztKt = kt.jetzt();
    const kontoWahl = auswahl({ optionen: erlaubte.map((x) => ({ wert: x.id, text: x.name, logo: x.programm, sub: optionSub(kt.eintrag(x.id), jetztKt) })), wert: konto, label: TF.konto, breit: true, daten: { "data-frage": "konto", title: TF.kontoHinweis },
      aufAenderung: (id) => { konto = id; speichereLokal(`frage.konto@${vaultSchluessel()}`, id); window.dispatchEvent(new CustomEvent(FRAGE_KONTO_EREIGNIS, { detail: { vault: vaultSchluessel(), id } })); zeichneFormular(); formular.querySelector("textarea")?.focus(); } });
    const modellWahl = segment({ optionen: bereit.modelle.map((m) => ({ wert: m, text: TF.modelle[m] || m, daten: { title: TF.modellHinweis[m] || "" } })), wert: modell, label: TF.modell, daten: { "data-frage": "modell" },
      aufAenderung: (m) => { modell = m; speichereLokal("frage.modell", m); } });
    const eingabe = textbereich({ platzhalter: TF.platzhalter, label: TF.titel, minZeilen: 3, maxZeilen: 9, daten: { "data-frage": "eingabe", maxlength: String(bereit.grenzen.frageMax) }, wert: text,
      beiEingabe: (t) => { text = t; senden.disabled = !t.trim(); } });
    eingabe.textarea.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); sende(); } });
    const senden = baueKnopf({ text: TF.fragen, variante: "primaer", typ: "submit", aktion: "frage-senden" });
    senden.append(h("kbd", { text: TF.fragenKurz }));
    senden.disabled = !text.trim();
    const hinweise = [k ? h("p", { klasse: "frage-weg", "data-frage": "weg", text: TF.weg(k.name, TF.anbieter) }) : null,
      andere.length ? h("p", { klasse: "frage-hinweis", "data-frage": "nur-claude", text: TF.leer.nurClaude }) : null];
    formular.replaceChildren(
      h("div", { klasse: "frage-zeile" }, h("span", { klasse: "frage-label", text: TF.konto }), kontoWahl),
      ktHost,
      h("div", { klasse: "frage-zeile" }, h("span", { klasse: "frage-label", text: TF.modell }), modellWahl),
      eingabe.el,
      h("div", { klasse: "frage-aktionen" }, senden),
      ...hinweise.filter(Boolean)); // ohne Filter schriebe replaceChildren(null) das Wort „null“ ins Panel
    eingabe.passe();
    kt.start(); fuelleKt();
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
        baueKnopf({ text: TF.abbrechen, aktion: "frage-abbrechen", groesse: "s", aufKlick: () => abbrechen(), laedt: !!l.abbrechend })));
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
    if (l.fertig) teile.push(h("div", { klasse: "frage-aktionen" }, baueKnopf({ text: TF.neu, aktion: "frage-neue", aufKlick: () => neueFrage() })));
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
  // Während des Schreibens höchstens alle 250 ms neu zeichnen (das Markdown wird jedes Mal ganz gebaut); das Ende zeichnet sofort (zeichneRumpf).
  let letzteZeichnung = 0, zeichenTimer = null;
  const zeichneJetzt = () => { clearTimeout(zeichenTimer); zeichenTimer = null; letzteZeichnung = Date.now(); zeichneAusgabe(); };
  function planeAusgabe() {
    const warte = 250 - (Date.now() - letzteZeichnung);
    if (warte <= 0) zeichneJetzt(); else if (!zeichenTimer) zeichenTimer = setTimeout(zeichneJetzt, warte);
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
      planeAusgabe();
    }
    if (lauf !== l) return;
    clearTimeout(zeichenTimer); zeichenTimer = null;
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
    if (offen) return;
    offen = true; panel.inert = false; z.beiUmschalten?.(true); document.getElementById("app")?.setAttribute("data-frage", "an"); knopfZustand();
    fixiert = true;
    ladeBereit();
    setTimeout(() => formular.querySelector("textarea")?.focus(), 0);
  }
  function schliesse() {
    if (!offen) return;
    if (lauf && !lauf.fertig) abbrechen(); // ein Fenster, das zu ist, fragt nicht weiter
    offen = false; panel.inert = true; z.beiUmschalten?.(false); document.getElementById("app")?.removeAttribute("data-frage"); knopfZustand();
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
    if (offen) { offen = false; panel.inert = true; z.beiUmschalten?.(false); document.getElementById("app")?.removeAttribute("data-frage"); knopfZustand(); }
  }
  // Öffnet das Panel mit einem vorbereiteten Text im Feld (Befehlspalette: ⌘↩). Gesendet wird nichts: die Frage geht erst nach deinem Klick auf „Fragen“.
  function oeffneMit(t) {
    if (!z.vaultPfad()) return;
    if (lauf && lauf.fertig) neueFrage();
    if (!lauf) text = String(t || "").slice(0, 2000);
    oeffne();
    if (!lauf && bereit) zeichneRumpf();
    setTimeout(() => { const f = formular.querySelector("textarea"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 0);
  }
  return { oeffne, oeffneMit, schliesse, umschalten, zuruecksetzen, istOffen: () => offen, laeuft: () => !!(lauf && !lauf.fertig) };
}
