// Schritt „KI“ des Einrichtungs-Assistenten: die Wahl der KI ist der Baustein kiAuswahl (bausteine.js, Katalog gemeinsam/ki-katalog.json): oben die gefundenen bzw. beliebten
// KIs als Karten, darunter „Weitere KIs anzeigen“ mit der durchsuchbaren Liste und den echten Logos. Unter den Karten steht für jede gewählte KI eine Zeile mit Konto und Stufe.
// Alles Echte läuft über die vorhandene API (kiErkennen, kiKonten, mcpVerbinden mit Konto und Stufe, kiPflegeSetzen) — nichts wird nur angezeigt.
import { h } from "./hilfen.js";
import { api } from "./api.js";
import { symbol } from "./symbole.js";
import { kiLogo, kiKatalog, kiLogoName } from "./ki-logos.js";
import { segment, knopf as baueKnopf, mitLaden, kiAuswahl } from "./bausteine.js";
import { erkennungAus } from "./willkommen.js";
import { TE } from "./texte-einrichtung.js";

const STUFEN = ["lesen", "posteingang", "erweitert"];
const PFLEGE_STUFE = "mittel"; // „Wie bisher“ (texte-konten.js): kleines Modell für Urteile, größeres für Prüfung und Pflege

const meldungVon = (e) => (typeof e?.message === "string" && e.message.trim()) || TE.vault.fehlerStandard;
const versionVon = (v) => { const m = /\d+(?:\.\d+)+/.exec(String(v || "")); return m ? m[0] : null; };
const name = (id) => kiLogoName(id) || id;

export function erzeugeKi({ vaultPfad, beiAenderung, kopiere, melde }) {
  const z = { geladen: false, erkennung: {}, konten: [], ki: {}, busy: null, pflege: null };
  const wurzel = h("div", { klasse: "e-ki-wurzel", id: "ki-koerper" });
  const zeilenEl = h("div", { klasse: "e-ki-liste", id: "ki-zeilen" });
  const hinweisEl = h("div", { klasse: "e-ki-hinweis", hidden: true });
  let auswahl = null;
  const zeilen = new Map(); // id → { el, aktual }

  const gewaehlt = () => (auswahl ? auswahl.wert() : []);
  const an = () => gewaehlt().filter((id) => z.ki[id]);
  const offen = () => an().filter((id) => !z.ki[id].verbunden);
  const verbundene = () => Object.keys(z.ki).filter((id) => z.ki[id].verbunden && gewaehlt().includes(id)).map((id) => ({ id, name: name(id) }));
  const gefunden = (id) => z.erkennung[id]?.gefunden === true;
  const kontenVon = (id) => z.konten.filter((k) => k.programm === id && k.vorhanden !== false).map((k) => ({ id: k.id, name: k.name || name(id), standard: !!k.standard }));

  // Vorgewählt: Claude Code, wenn vorhanden (oder die Erkennung antwortet nicht); sonst die erste gefundene KI, bei der sich Kortex eintragen kann
  function vorwahl(erkannt) {
    if (!erkannt) return ["claude"];
    if (gefunden("claude")) return ["claude"];
    const erste = kiKatalog().find((e) => e.verbindbar && gefunden(e.id));
    return erste ? [erste.id] : [];
  }

  function zustandFuer(id) {
    if (!z.ki[id]) {
      const konten = kontenVon(id);
      z.ki[id] = { konto: (konten.find((k) => k.standard) || konten[0])?.id ?? null, stufe: "posteingang", verbunden: false, status: null };
    }
    return z.ki[id];
  }

  // ---------------------------------------------------------------- Erkennung
  async function lade(neu = false) {
    const [erk, kon] = await Promise.allSettled([api.kiErkennen(neu), api.kiKonten()]);
    const e = erk.status === "fulfilled" ? erk.value : null;
    z.konten = kon.status === "fulfilled" && Array.isArray(kon.value?.konten) ? kon.value.konten : [];
    z.erkennung = erkennungAus(e);
    const erkannt = !!e;
    if (!auswahl) {
      auswahl = kiAuswahl({ erkennung: z.erkennung, wert: vorwahl(erkannt), mehrfach: true, waehlbar: (k) => k.verbindbar, daten: { "data-bereich": "ziel-wahl" },
        aufAenderung: () => { if (z.busy) { auswahl.setzeWert(an()); return; } for (const id of gewaehlt()) zustandFuer(id); zeichneZeilen(); beiAenderung(); } });
      wurzel.replaceChildren(auswahl.el, hinweisEl, zeilenEl);
    } else auswahl.setzeErkennung(z.erkennung);
    z.geladen = true;
    for (const id of gewaehlt()) zustandFuer(id);
    zeichneZeilen(); beiAenderung();
  }
  function sucht() { wurzel.replaceChildren(h("div", { klasse: "e-abschnitt-kopf" }, h("span", { klasse: "e-shimmer", text: TE.ki.sucht }))); }
  sucht();

  // ---------------------------------------------------------------- Zeilen je gewählter KI
  function baueZeile(id) {
    const k = zustandFuer(id);
    const konten = kontenVon(id);
    const status = h("span", { klasse: "e-ki-status" });
    const version = z.erkennung[id]?.version ? TE.ki.version(versionVon(z.erkennung[id].version) || z.erkennung[id].version) : (gefunden(id) ? TE.ki.versionUnbekannt : TE.ki.nichtInstalliertKurz);
    const untertitel = konten.length > 1 ? `${version} · ${TE.ki.konten(konten.length)}` : version;
    const kopf = h("div", { klasse: "e-ki-kopf" }, h("span", { klasse: "e-logo-tile" }, kiLogo(id, 20, { dekorativ: true })),
      h("div", { klasse: "e-t" }, h("b", { text: name(id) }), h("span", { text: untertitel })), status);
    const kontoSeg = konten.length > 1 ? segment({ label: TE.ki.konto, groesse: "s", wert: k.konto, optionen: konten.map((c) => ({ wert: c.id, text: c.name })), aufAenderung: (w) => { k.konto = w; k.verbunden = false; k.status = null; aktual(); beiAenderung(); } }) : null;
    const stufeSeg = segment({ label: TE.ki.darf, groesse: "s", wert: k.stufe, optionen: STUFEN.map((s) => ({ wert: s, text: TE.ki.stufen[s].name })), aufAenderung: (w) => { k.stufe = w; k.verbunden = false; k.status = null; aktual(); beiAenderung(); } });
    const stufeText = h("p", { klasse: "e-stufe-text" });
    const meldung = h("div", { klasse: "e-ki-meldung", "aria-live": "polite" });
    const einst = h("div", { klasse: "e-ki-einst" },
      kontoSeg ? h("div", { klasse: "e-reihe" }, h("span", { klasse: "e-cap", text: TE.ki.konto }), kontoSeg) : null,
      h("div", { klasse: "e-reihe" }, h("span", { klasse: "e-cap", text: TE.ki.darf }), stufeSeg), stufeText, meldung);
    const el = h("div", { klasse: "e-ki-zeile", "data-ki": id, "data-an": "true" }, kopf, h("div", { klasse: "e-ki-mehr" }, h("div", null, einst)));

    function aktual() {
      el.classList.toggle("verbunden", k.verbunden);
      stufeText.textContent = TE.ki.stufen[k.stufe].text;
      status.className = "e-ki-status" + (k.verbunden ? " ok" : "");
      status.replaceChildren(...(k.verbunden ? [symbol("kreis-haken", 12), TE.ki.verbunden] : k.status?.art === "verbindet" ? [h("span", { klasse: "e-shimmer", text: TE.ki.verbindet })] : []));
      meldung.replaceChildren(...meldungKnoten(id, k));
    }
    zeilen.set(id, { el, aktual });
    aktual();
    return el;
  }
  function meldungKnoten(id, k) {
    const s = k.status;
    if (!s) return [];
    if (s.art === "gesperrt") return [h("p", { klasse: "e-hint", text: TE.ki.gesperrtBleibt })];
    if (s.art === "anders") {
      const nein = baueKnopf({ text: TE.ki.nichtAendern, groesse: "s", aktion: "nicht-umstellen", aufKlick: () => { k.status = null; zeilen.get(id)?.aktual(); } });
      const ja = baueKnopf({ text: TE.ki.umstellen, variante: "primaer", groesse: "s", aktion: "umstellen", aufKlick: async () => { await verbindeEine(id, true); beiAenderung(); } });
      return [h("div", { klasse: "e-frage", role: "group", "data-bereich": "umstellen" }, h("p", { klasse: "e-hint", text: TE.ki.anders(name(id)) }), h("div", { klasse: "e-frage-knoepfe" }, nein, ja))];
    }
    if (s.art === "fehler") return [h("div", { klasse: "e-meldung schlecht", role: "alert" }, symbol("warnung", 14), h("span", { text: s.text })), ...(s.befehl ? [befehlBlock(s.befehl)] : [])];
    return [];
  }
  function befehlBlock(befehl) {
    const knopf = baueKnopf({ text: TE.ki.befehlKopieren, groesse: "s", symbol: "kopieren", aktion: "befehl-kopieren", aufKlick: async () => { if (await kopiere(befehl)) melde(TE.ki.befehlKopiert); } });
    return h("div", { klasse: "e-befehl", "data-bereich": "befehl" }, h("p", { klasse: "e-hint", text: TE.ki.befehl }), h("div", { klasse: "e-befehl-zeile" }, h("code", { text: befehl, tabindex: "0" }), knopf));
  }
  function zeichneZeilen() {
    zeilen.clear();
    const ids = gewaehlt().filter((id) => kiKatalog().some((e) => e.id === id && e.verbindbar));
    zeilenEl.replaceChildren(...ids.map(baueZeile));
    const keine = auswahl && !Object.values(z.erkennung).some((x) => x.gefunden);
    hinweisEl.hidden = !keine;
    if (keine) {
      const erneut = baueKnopf({ text: TE.ki.erneut, groesse: "s", symbol: "sync", klasse: "e-erneut", aktion: "suchen", aufKlick: async () => { await mitLaden(erneut, () => lade(true)); if (!Object.values(z.erkennung).some((x) => x.gefunden)) melde(TE.ki.nichtsNeues); } });
      hinweisEl.replaceChildren(h("p", { klasse: "e-hint", text: TE.ki.leerText }), erneut);
    }
  }

  // ---------------------------------------------------------------- Verbinden
  async function verbindeEine(id, umstellen = false) {
    const k = zustandFuer(id);
    k.status = { art: "verbindet" }; zeilen.get(id)?.aktual();
    try {
      const r = await api.mcpVerbinden({ ziel: id, umstellen, konto: k.konto || undefined, zugriff: k.stufe, zugriffAusdruecklich: true });
      k.verbunden = true;
      k.status = r?.zugriffGrund === "vom-nutzer-gesperrt" ? { art: "gesperrt" } : null;
      // Erweitert = das Konto pflegt den Vault täglich im Hintergrund (nur ein Konto je Vault; das erste gewinnt)
      if (k.stufe === "erweitert" && k.konto && !z.pflege && vaultPfad()) {
        try { await api.kiPflegeSetzen({ vault: vaultPfad(), konto: k.konto, stufe: PFLEGE_STUFE }); z.pflege = { konto: k.konto, name: kontenVon(id).find((c) => c.id === k.konto)?.name || name(id) }; }
        catch (e) { melde(meldungVon(e)); }
      }
    } catch (e) {
      k.verbunden = false;
      if (e?.status === 409 && e?.daten?.art === "anders" && !umstellen) k.status = { art: "anders" };
      else k.status = { art: "fehler", text: TE.ki.fehler(name(id), e?.status === 404 && !e?.daten?.befehl ? TE.ki.nichtGefunden(name(id)) : meldungVon(e)), befehl: typeof e?.daten?.befehl === "string" ? e.daten.befehl : null };
    }
    zeilen.get(id)?.aktual();
  }

  // Alle gewählten, noch nicht verbundenen: nacheinander. Rückgabe: true = alle gewählten sind verbunden (oder keine gewählt).
  async function verbinde() {
    z.busy = true; z.pflege = null; auswahl?.sperre(true);
    for (const id of offen()) await verbindeEine(id);
    z.busy = null; auswahl?.sperre(false);
    return offen().length === 0;
  }

  return {
    z, wurzel, lade, an, offen, verbundene, verbinde,
    // Ansicht für die Bühne: gefundene und gewählte KIs, höchstens vier
    buehne() {
      const ids = [...new Set([...kiKatalog().filter((e) => e.verbindbar && gefunden(e.id)).map((e) => e.id), ...gewaehlt()])].slice(0, 4);
      return {
        modus: `${z.geladen}:${ids.join(",")}`,
        programme: ids.map((id) => ({ id, name: name(id), an: gewaehlt().includes(id), stufeName: TE.ki.stufen[z.ki[id]?.stufe || "posteingang"].name })),
        keine: z.geladen && !Object.values(z.erkennung).some((x) => x.gefunden),
      };
    },
  };
}
