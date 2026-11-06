// Schritt „Vault“ der Einrichtung (Paket E2). Hauptweg: „Neuer Vault“ (Vorgabe ~/Kortex, „Ort ändern …“ über das eigene Menü und die Ordnerwahl der Hülle). Darunter „Andere Wege“:
// Ordner öffnen · Von GitHub holen (Feld für den Speicher, geprüft) · Beispiel ansehen. Für Ordner öffnen und Von GitHub holen steht die Zeile „Diesem Ordner vertrauen“ (Vorgabe aus):
// sie ersetzt die Frage, die früher NACH der Einrichtung im Studio kam. Das Modul kennt nur diesen Schritt; Fußleiste, Kopf und Ablauf gehören dem Overlay (einrichtung.js).
import { h } from "./hilfen.js";
import { api as standardApi, ausgangUnklar } from "./api.js";
import { symbol } from "./symbole.js";
import { markenLogo } from "./marken.js";
import { knopf as baueKnopf, textfeld, umschalter } from "./bausteine.js";
import { oeffneMenue } from "./menue.js";
import { TE } from "./texte-einrichtung.js";

export const WEGE = ["neu", "oeffnen", "klonen", "beispiel"];
export const STANDARD_ORT = "~/Kortex";

export const kurzPfad = (p) => (p ? String(p).replace(/^\/Users\/[^/]+(?=\/|$)/, "~") : "");
export const letzter = (p) => String(p || "").replace(/\/+$/, "").split("/").pop() || "";
export const meldungVon = (e) => {
  if (ausgangUnklar(e)) return typeof e?.message === "string" && e.status === 504 ? e.message : TE.verbindungWeg;
  if ([404, 405, 501].includes(e?.status) && (!e?.message || /^(nicht gefunden|das hat nicht geklappt)\.?$/i.test(String(e.message).trim()))) return TE.nichtDa;
  const m = typeof e?.message === "string" ? e.message.trim() : "";
  return m || TE.vault.fehlerStandard;
};
// Ordnername aus dem Namen (wie VaultAuswahl.ordnername in Swift): ohne „/“, „:“ und Steuerzeichen, nicht versteckt, höchstens 80 Zeichen; leer → „Kortex“.
export function ordnername(name) {
  let t = [...String(name)].map((c) => (c.codePointAt(0) < 32 || c === "/" || c === ":" ? "-" : c)).join("").trim();
  while (t.startsWith(".")) t = t.slice(1);
  t = t.slice(0, 80).trim();
  return t || "Kortex";
}
// Adresse zum Klonen: „name/vault“, „github.com/name/vault“ (mit oder ohne https://) oder eine ganze https-/ssh-Adresse. → { url, name, github } oder null
export function klonAdresse(roh) {
  const t = String(roh || "").trim();
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i.exec(t);
  if (m) return { url: `https://github.com/${m[1]}/${m[2]}${m[3] ? ".git" : ""}`, name: m[2], github: true };
  m = /^([\w.-]+)\/([\w.-]+?)(\.git)?$/.exec(t);
  if (m && m[1] !== "." && m[1] !== ".." && m[2] !== "." && m[2] !== "..") return { url: `https://github.com/${m[1]}/${m[2]}${m[3] ? ".git" : ""}`, name: m[2], github: true };
  m = /^(?:https:\/\/|ssh:\/\/|git@)\S+$/i.exec(t);
  if (m) { const n = letzter(t.replace(/\.git$/i, "").replace(/^.*[:/]/, (x) => x)); return { url: t, name: n || "vault", github: false }; }
  return null;
}

/**
 * @param {{ api?: object, waehleOrdner: (titel: string, vorschlag?: string) => Promise<({pfad: string}|null)>, beiAenderung: () => void, gitBereit: () => boolean }} p
 */
export function erzeugeVault({ api = standardApi, waehleOrdner, beiAenderung = () => {}, gitBereit = () => true } = {}) {
  const V = { weg: "neu", ort: STANDARD_ORT, ordner: null /* { pfad, breit, notizen, ordner, mehr } */, verlauf: true, url: "", vertrauen: false, klonFehler: null };
  const wurzel = h("div", { klasse: "e-koerper e-vault", id: "e-vault", "data-bereich": "vault" });
  const aenderung = () => { try { beiAenderung(); } catch (e) { console.error(e); } };

  // ---------------------------------------------------------------- Vorgaben aus dem Zustand
  const neuName = () => ordnername(letzter(V.ort) || "Kortex");
  const schluessel = () => JSON.stringify([V.weg, V.ort, V.ordner?.pfad ?? null, V.verlauf, V.vertrauen, V.weg === "klonen" ? klonAdresse(V.url)?.url : null]);
  function primaer() {
    const w = TE.vault.wege[V.weg];
    if (!gitBereit()) return { label: w.knopf, ok: false };
    const ok = V.weg === "oeffnen" ? !!V.ordner && !V.ordner.breit : V.weg === "klonen" ? !!klonAdresse(V.url) : true;
    return { label: w.knopf, ok };
  }

  // ---------------------------------------------------------------- Zeichnen
  const rd = () => h("span", { klasse: "e-rd" }, symbol("haken", 12));
  const tile = (inhalt) => h("span", { klasse: "e-tile" }, inhalt);
  function option(id, klasse, kinder) {
    const b = h("div", { klasse: `e-opt ${klasse}`, role: "radio", "aria-checked": String(V.weg === id), tabindex: V.weg === id ? "0" : "-1", "data-weg": id }, ...kinder, rd());
    b.addEventListener("click", () => waehleWeg(id));
    return b;
  }
  function pfadMenue(anker) {
    const eintraege = [...new Set([V.ort, STANDARD_ORT, "~/Documents/Kortex"])].map((p) => ({ name: p, symbol: "ordner", haken: V.ort === p, id: `ort-${p}`, tun: () => { V.ort = p; V.weg = "neu"; zeichne(); aenderung(); } }));
    oeffneMenue(anker, [{ gruppe: TE.vault.ortMenue }, ...eintraege, { trenner: true }, { name: TE.vault.ortAnderen, symbol: "ordner-offen", id: "ort-anderen", tun: async () => {
      const a = await waehleOrdner(TE.vault.ortTitel, V.ort.startsWith("~") ? undefined : V.ort);
      if (a?.pfad) { V.ort = `${a.pfad.replace(/\/+$/, "")}/${STANDARD_ORT.slice(2)}`; V.weg = "neu"; zeichne(); aenderung(); }
    } }]);
  }
  function ortZeile() {
    const b = baueKnopf({ text: TE.vault.ortAendern, variante: "leise", klasse: "e-xs e-ort-aendern", aktion: "ort", aufKlick: (ev) => { ev.stopPropagation(); pfadMenue(b); } });
    b.setAttribute("aria-haspopup", "menu");
    return h("div", { klasse: "e-pathrow" }, h("span", { klasse: "e-chipp", id: "v-ort" }, symbol("ordner", 14), h("span", { text: kurzPfad(V.ort) })), b);
  }
  function ordnerZeile() {
    const o = V.ordner;
    const knopf = baueKnopf({ text: TE.vault.ordnerAnderen, variante: "leise", klasse: "e-xs", aktion: "waehle", aufKlick: ordnerWahl });
    return h("div", { klasse: "e-pathrow" }, h("span", { klasse: "e-chipp", id: "v-ordner" }, symbol("ordner", 14), h("span", { text: kurzPfad(o.pfad) })), knopf,
      o.breit ? null : h("span", { klasse: "e-hint", "data-feld": "zaehlung", text: typeof o.notizen === "number" ? TE.vault.ordnerZaehlung(o.notizen, o.ordner ?? 0, o.mehr) : TE.vault.ordnerGewaehlt }));
  }
  function detail() {
    const teile = [];
    if (V.weg === "oeffnen") {
      if (!V.ordner) {
        const b = h("button", { type: "button", klasse: "e-ablage", "data-aktion": "waehle" }, symbol("ordner-plus", 20), h("b", { text: TE.vault.ordnerWaehlen }));
        b.addEventListener("click", ordnerWahl);
        teile.push(b);
      } else {
        teile.push(ordnerZeile());
        if (V.ordner.breit) {
          const dort = h("button", { type: "button", klasse: "e-leise-link", "data-aktion": "dort-anlegen", text: TE.vault.dortAnlegen });
          dort.addEventListener("click", () => { V.ort = `${V.ordner.pfad.replace(/\/+$/, "")}/Kortex`; V.ordner = null; V.weg = "neu"; zeichne(); aenderung(); });
          teile.push(h("div", { klasse: "e-meldung schlecht", "data-bereich": "zu-breit" }, symbol("info", 14), h("span", null, `${TE.vault.zuBreit()} `, dort)));
        } else {
          const schalter = umschalter({ an: V.verlauf, label: TE.vault.verlauf, aufAenderung: (w) => { V.verlauf = w; aenderung(); }, daten: { "data-aktion": "verlauf" } });
          teile.push(h("div", { klasse: "e-schalt-zeile" }, h("div", null, h("b", { text: TE.vault.verlauf }), h("span", { text: TE.vault.verlaufText })), schalter));
        }
      }
    } else if (V.weg === "klonen") {
      const ungueltig = !!V.url.trim() && !klonAdresse(V.url);
      const meld = h("div", { klasse: "e-invalid", id: "url-text", role: ungueltig ? "alert" : null, hidden: !ungueltig || null, text: TE.vault.repoUngueltig });
      const feld = textfeld({ wert: V.url, platzhalter: TE.vault.repoPlatzhalter, label: TE.vault.repoLabel, klasse: "e-feld-gross e-mono-feld", daten: { "data-feld": "url" },
        beiEingabe: (w) => { V.url = w; const bad = !!w.trim() && !klonAdresse(w); feld.input.setAttribute("aria-invalid", String(bad)); feld.el.classList.toggle("e-schlecht", bad); meld.hidden = !bad; if (V.klonFehler) { V.klonFehler = null; fehlerOrt.replaceChildren(); } aenderung(); } });
      const fehlerOrt = h("div", { id: "klon-fehler-ort" });
      const zeigeFehler = () => {
        fehlerOrt.replaceChildren(...(V.klonFehler ? [h("div", { klasse: "e-meldung schlecht", role: "alert", "data-bereich": "klon-fehler" }, symbol("warnung", 14), h("span", { text: V.klonFehler.text })),
          ...(V.klonFehler.anmelden ? [baueKnopf({ text: TE.vault.klonAnmelden, groesse: "s", symbol: "schloss", aktion: "klon-anmelden", aufKlick: () => V.beiKlonAnmelden?.() })] : []),
          ...(V.klonFehler.andere ? [h("div", { klasse: "e-ki-frage-knoepfe" }, baueKnopf({ text: TE.vault.klonAbbrechen, groesse: "s", aktion: "klon-abbrechen", aufKlick: () => { V.klonFehler = null; V.url = ""; waehleWeg("neu"); } }), baueKnopf({ text: TE.vault.klonAndere, variante: "primaer", groesse: "s", aktion: "klon-andere", aufKlick: () => { V.klonFehler = null; V.url = ""; zeichne(); aenderung(); wurzel.querySelector('[data-feld="url"]')?.focus(); } }))] : [])] : []));
      };
      V.zeigeKlonFehler = zeigeFehler;
      feld.input.setAttribute("aria-invalid", String(ungueltig)); if (ungueltig) feld.el.classList.add("e-schlecht");
      zeigeFehler();
      teile.push(h("div", { klasse: "e-feld" }, h("label", { klasse: "e-label", for: feld.input.id, text: TE.vault.repoLabel }), feld.el, meld, h("span", { klasse: "e-hint", text: TE.vault.repoPrivat })), fehlerOrt);
    }
    if (V.weg === "oeffnen" && V.ordner && !V.ordner.breit || V.weg === "klonen") {
      const sw = umschalter({ an: V.vertrauen, label: TE.vault.vertrauen, aufAenderung: (w) => { V.vertrauen = w; aenderung(); }, daten: { "data-aktion": "vertrauen" } });
      teile.push(h("div", { klasse: "e-trust", "data-bereich": "vertrauen" }, symbol("schild", 20), h("div", { klasse: "e-tx" }, h("b", { text: TE.vault.vertrauen }), h("p", { text: TE.vault.vertrauenText })), sw));
    }
    return teile;
  }
  // Die Unterzeile (Ordner, Repository, Vertrauen) klappt direkt unter der gewählten Karte auf; die andere bleibt zu und leer
  const aufklappbar = (id) => id === "oeffnen" || id === "klonen";
  function unterzeile(id) {
    const an = V.weg === id;
    return h("div", { klasse: "e-sub-x" + (an ? " open" : ""), "data-detail": id, id: `e-detail-${id}` }, h("div", null, h("div", { klasse: "e-inner" }, ...(an ? detail() : []))));
  }
  function zeichne() {
    const gruppe = h("div", { klasse: "e-wege", role: "radiogroup", "aria-label": TE.vault.wegeAria },
      option("neu", "e-opt-main", [tile(symbol("ordner-plus", 20)), h("div", { klasse: "e-tx" },
        h("b", null, TE.vault.wege.neu.t, h("span", { klasse: "e-badge brand e-empf", text: TE.vault.wege.neu.empfohlen })), h("p", { text: TE.vault.wege.neu.h }), ortZeile())]),
      h("div", { klasse: "e-sech", text: TE.vault.andereWege }),
      ...[["oeffnen", symbol("ordner-offen", 20)], ["klonen", markenLogo("github", 20, { dekorativ: true })], ["beispiel", symbol("buch", 20)]].flatMap(([id, ico]) => [
        option(id, "e-opt-row", [tile(ico), h("div", { klasse: "e-tx" }, h("b", { text: TE.vault.wege[id].t }), h("p", { text: TE.vault.wege[id].h }))]),
        ...(aufklappbar(id) ? [unterzeile(id)] : [])]));
    gruppe.addEventListener("keydown", (e) => {
      const b = e.target.closest?.(".e-opt"); if (!b || e.target !== b) return;
      const i = WEGE.indexOf(b.dataset.weg);
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (d === undefined && !(e.key === " " || (e.key === "Enter" && !e.metaKey && !e.ctrlKey))) return;
      e.preventDefault();
      const n = d === undefined ? i : (i + d + WEGE.length) % WEGE.length;
      waehleWeg(WEGE[n]); wurzel.querySelector(`.e-opt[data-weg="${WEGE[n]}"]`)?.focus();
    });
    wurzel.replaceChildren(gruppe);
  }
  function waehleWeg(id) {
    if (V.weg === id || V.gesperrt) return;
    V.weg = id;
    wurzel.querySelectorAll(".e-opt").forEach((b) => { const an = b.dataset.weg === id; b.setAttribute("aria-checked", String(an)); b.tabIndex = an ? 0 : -1; });
    // Die Unterzeilen klappen auf oder zu (grid-template-rows, wie im Prototyp); der Inhalt der zugeklappten wird erst nach der Bewegung geleert
    for (const w of ["oeffnen", "klonen"]) {
      const sub = wurzel.querySelector(`[data-detail="${w}"]`), inner = sub?.querySelector(".e-inner");
      if (!sub) continue;
      if (w === id) { inner.replaceChildren(...detail()); requestAnimationFrame(() => requestAnimationFrame(() => sub.classList.add("open"))); }
      else { sub.classList.remove("open"); setTimeout(() => { if (V.weg !== w) inner.replaceChildren(); }, ruhigMs()); }
    }
    aenderung();
    if (aufklappbar(id)) { zeigeUnterzeile(id, ruhigMs() ? 420 : 0); if (id === "klonen") setTimeout(() => wurzel.querySelector('[data-feld="url"]')?.focus({ preventScroll: true }), ruhigMs() ? 420 : 0); }
  }
  // Die aufgeklappte Unterzeile soll ganz zu sehen sein (die Karte scrollt, wenn sie nicht passt): nach der Bewegung, mit „nearest“ nur so weit wie nötig
  function zeigeUnterzeile(id, nach = 0) {
    setTimeout(() => wurzel.querySelector(`[data-detail="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: ruhigMs() ? "smooth" : "auto" }), nach);
  }
  const ruhigMs = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500; } catch { return 500; } };
  async function ordnerWahl() {
    const a = await waehleOrdner(TE.vault.ordnerTitel, V.ordner?.pfad);
    if (!a) return;
    V.ordner = { pfad: a.pfad, breit: a.breit ?? null, notizen: a.notizen, ordner: a.ordner, mehr: !!a.mehr };
    zeichne(); aenderung(); zeigeUnterzeile("oeffnen", 60);
    wurzel.querySelector(".e-opt[data-weg=\"oeffnen\"]")?.focus?.({ preventScroll: true });
  }
  zeichne();

  // ---------------------------------------------------------------- Anlegen / öffnen / klonen — die vorhandene API; Erfolg = ein Vault ist aktiv (info.vault)
  const pfadAusAntwort = (r) => (typeof r?.pfad === "string" && r.pfad) || (typeof r?.vault?.pfad === "string" && r.vault.pfad) || (typeof r?.vault === "string" && r.vault) || null;
  async function legeBeispielAn() {
    let letzterFehler = null;
    for (let n = 1; n <= 9; n++) {
      const name = n === 1 ? "Kortex-Beispiel" : `Kortex-Beispiel ${n}`;
      try { return await api.vaultNeu("vorlage", "Kortex-Beispiel", `~/${name}`); }
      catch (e) { letzterFehler = e; if (e?.status !== 409) throw e; }
    }
    throw Object.assign(new Error(TE.vault.beispielBelegt), { status: letzterFehler?.status });
  }
  /** → { ok:true, vault:{pfad,name,schluessel}, weg, vertrauen:{ gefragt, erteilt } } | { ok:false, fehler } (Fehler stehen schon im Schritt; der Aufrufer zeigt nichts mehr) */
  async function legeAn({ toast }) {
    const art = V.weg;
    try {
      let r;
      if (art === "neu") r = await api.vaultNeu("vorlage", neuName(), V.ort);
      else if (art === "beispiel") r = await legeBeispielAn();
      else if (art === "oeffnen") r = await api.vaultOeffnen(V.ordner.pfad, V.verlauf ? { gitEinschalten: true } : undefined);
      else { const a = klonAdresse(V.url); r = await api.vaultKlonen(a.url, `~/${ordnername(a.name)}`); }
      const info = await api.info().catch(() => null);
      if (info && !info.vault) throw new Error(TE.vault.fehlerStandard);
      const pfad = info?.vault || pfadAusAntwort(r);
      const vault = { pfad, name: info?.name || (art === "neu" ? neuName() : art === "beispiel" ? "Kortex-Beispiel" : art === "oeffnen" ? letzter(V.ordner.pfad) : klonAdresse(V.url)?.name || "Vault"), schluessel: schluessel() };
      // Vertrauen: nur auf Wunsch und nur für diesen einen Vault (die Werkstatt prüft den Pfad noch einmal). Die Frage nach der Einrichtung entfällt, wenn sie hier gestellt war.
      const vertrauen = { gefragt: art === "oeffnen" || art === "klonen", erteilt: false };
      if (vertrauen.gefragt && V.vertrauen) {
        try { await api.vertrauen(true, pfad); vertrauen.erteilt = true; }
        catch (e) { vertrauen.gefragt = false; toast(meldungVon(e), { fehler: true }); } // nicht erteilt: das Studio fragt danach wie bisher
      }
      V.klonFehler = null;
      return { ok: true, vault, weg: art, vertrauen };
    } catch (e) {
      if (art === "klonen" && [403, 404].includes(e?.status)) {
        // Nur wer noch nicht bei GitHub angemeldet ist, bekommt die Anmeldung angeboten. Wer es schon ist, bekommt keine Schleife: klare Meldung, andere Adresse oder abbrechen.
        let angemeldet = false; try { angemeldet = (await api.githubKonto())?.angemeldet === true; } catch { /* unbekannt: die Anmeldung anbieten */ }
        V.klonFehler = angemeldet ? { text: TE.vault.klonKeinZugriff, andere: true } : { text: TE.vault.klonAnmeldung, anmelden: true };
      }
      else if (art === "klonen") V.klonFehler = { text: meldungVon(e) };
      else { V.klonFehler = null; toast(meldungVon(e), { fehler: true }); }
      if (art === "klonen") zeichne();
      return { ok: false, fehler: e };
    }
  }

  return {
    v: V, wurzel, primaer, legeAn, schluessel, waehleWeg, neuName,
    sperre(an) { V.gesperrt = !!an; },
    setzeWeg(w) { if (WEGE.includes(w)) { V.weg = w; zeichne(); } },
    klonAnmelden(f) { V.beiKlonAnmelden = f; },
    zeichne,
  };
}
