// Schritt „KI“ des Einrichtungs-Assistenten: die Wahl der KI ist der Baustein kiAuswahl (bausteine.js, Katalog gemeinsam/ki-katalog.json): oben die gefundenen bzw. beliebten
// KIs als Karten, darunter „Weitere KIs anzeigen“ mit der durchsuchbaren Liste und den echten Logos. Unter den Karten steht für jede gewählte KI eine Zeile mit Konto und Stufe
// (vorbelegt mit der Stufe, die das Konto in diesem Vault schon hat; eine Sperre bleibt, bis du ausdrücklich eine Stufe wählst), dahinter „Zusätzlich, wenn du möchtest“
// (Hooks bei Claude Code, Prüfung vor dem Speichern, Hintergrunddienst über /api/kern/verdrahten) und „Konfiguration kopieren“ für KIs, bei denen sich Kortex nicht selbst einträgt.
// Alles Echte läuft über die vorhandene API — nichts wird nur angezeigt.
import { h } from "./hilfen.js";
import { api } from "./api.js";
import { symbol } from "./symbole.js";
import { kiLogo, kiKatalog, kiLogoName } from "./ki-logos.js";
import { segment, umschalter, knopf as baueKnopf, mitLaden, kiAuswahl } from "./bausteine.js";
import { erkennungAus } from "./willkommen.js";
import { TE } from "./texte-einrichtung.js";

const STUFEN = ["lesen", "posteingang", "erweitert"];
const STUFEN_MIT_SPERRE = ["gesperrt", ...STUFEN];
const PFLEGE_STUFE = "mittel"; // „Wie bisher“ (texte-konten.js): kleines Modell für Urteile, größeres für Prüfung und Pflege

const meldungVon = (e) => (typeof e?.message === "string" && e.message.trim()) || TE.vault.fehlerStandard;
const versionVon = (v) => { const m = /\d+(?:\.\d+)+/.exec(String(v || "")); return m ? m[0] : null; };
const name = (id) => kiLogoName(id) || id;

export function erzeugeKi({ vaultPfad, beiAenderung, kopiere, melde }) {
  const z = { geladen: false, erkennung: {}, konten: [], zugriff: {}, vaults: [], ki: {}, busy: null, pflege: null, zusatz: null, zusatzFehler: {}, zusatzFrage: null, zusatzBusy: null };
  const wurzel = h("div", { klasse: "e-ki-wurzel", id: "ki-koerper" });
  const zeilenEl = h("div", { klasse: "e-ki-liste", id: "ki-zeilen" });
  const hinweisEl = h("div", { klasse: "e-ki-hinweis", hidden: true });
  const konfigEl = h("div", { klasse: "e-ki-konfig" });
  const zusatzEl = h("div", { klasse: "e-zusatz", id: "ki-zusatz", hidden: true });
  let auswahl = null;
  const zeilen = new Map(); // id → { el, aktual }
  let zusatzGeladen = false;

  const gewaehlt = () => (auswahl ? auswahl.wert() : []);
  const an = () => gewaehlt().filter((id) => z.ki[id]);
  const offen = () => an().filter((id) => !z.ki[id].verbunden);
  const verbundene = () => Object.keys(z.ki).filter((id) => z.ki[id].verbunden && gewaehlt().includes(id)).map((id) => ({ id, name: name(id) }));
  const gefunden = (id) => z.erkennung[id]?.gefunden === true;
  const kontenVon = (id) => z.konten.filter((k) => k.programm === id && k.vorhanden !== false).map((k) => ({ id: k.id, name: k.name || name(id), standard: !!k.standard, ordner: k.ordner }));

  // Die Stufe, die ein Konto in DIESEM Vault schon hat (aus GET /api/ki/konten); null = unbekannt oder noch nicht eingetragen
  function stufeAktuell(konto) {
    const p = vaultPfad();
    if (!konto || !p) return null;
    const v = z.vaults.find((x) => x.pfad === p) || z.vaults.find((x) => x.schluessel === p);
    const s = z.zugriff?.[konto]?.[v?.schluessel ?? v?.pfad ?? p];
    return STUFEN_MIT_SPERRE.includes(s) ? s : null;
  }
  // Vorbelegung eines Kontos: seine jetzige Stufe, sonst „Posteingang“. stufeGewaehlt bleibt aus, bis du selbst eine Stufe anklickst: nur dann gilt die Wahl als ausdrücklich.
  function belege(k) {
    const a = stufeAktuell(k.konto);
    k.stufe = a || "posteingang";
    k.vorbelegt = a;
  }
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
      z.ki[id] = { konto: (konten.find((k) => k.standard) || konten[0])?.id ?? null, stufe: "posteingang", stufeGewaehlt: false, vorbelegt: null, verbunden: false, status: null };
      belege(z.ki[id]);
    }
    return z.ki[id];
  }
  const sperreBleibt = (k) => k.stufe === "gesperrt" && !k.stufeGewaehlt;

  // ---------------------------------------------------------------- Erkennung
  async function lade(neu = false) {
    const [erk, kon] = await Promise.allSettled([api.kiErkennen(neu), api.kiKonten()]);
    const e = erk.status === "fulfilled" ? erk.value : null;
    const kv = kon.status === "fulfilled" ? kon.value : null;
    z.konten = Array.isArray(kv?.konten) ? kv.konten : [];
    z.zugriff = kv?.zugriff && typeof kv.zugriff === "object" ? kv.zugriff : {};
    z.vaults = Array.isArray(kv?.vaults) ? kv.vaults : [];
    z.erkennung = erkennungAus(e);
    const erkannt = !!e;
    for (const id of Object.keys(z.ki)) if (!z.ki[id].stufeGewaehlt && !z.ki[id].verbunden) belege(z.ki[id]);
    if (!auswahl) {
      auswahl = kiAuswahl({ erkennung: z.erkennung, wert: vorwahl(erkannt), mehrfach: true, waehlbar: (k) => k.verbindbar, daten: { "data-bereich": "ziel-wahl" },
        aufAenderung: () => { if (z.busy) { auswahl.setzeWert(an()); return; } for (const id of gewaehlt()) zustandFuer(id); zeichneZeilen(); ladeZusatz(); beiAenderung(); } });
      wurzel.replaceChildren(auswahl.el, hinweisEl, zeilenEl, konfigEl, zusatzEl);
    } else auswahl.setzeErkennung(z.erkennung);
    z.geladen = true;
    for (const id of gewaehlt()) zustandFuer(id);
    zeichneZeilen(); zeichneKonfig(); beiAenderung();
    ladeZusatz();
  }
  function sucht() { wurzel.replaceChildren(h("div", { klasse: "e-abschnitt-kopf" }, h("span", { klasse: "e-shimmer", text: TE.ki.sucht }))); }
  sucht();
  // Neuer Vault im Assistenten: alles, was zum alten gehörte (Auswahl, Stufen, Pflege, Eintragungen), gilt nicht mehr; der Schritt liest neu
  function vaultGewechselt() { z.ki = {}; z.pflege = null; z.zusatz = null; z.zusatzFehler = {}; z.zusatzFrage = null; zusatzGeladen = false; z.geladen = false; auswahl = null; zeilen.clear(); sucht(); }

  // ---------------------------------------------------------------- Zeilen je gewählter KI
  function baueZeile(id) {
    const k = zustandFuer(id);
    const konten = kontenVon(id);
    const status = h("span", { klasse: "e-ki-status" });
    const trennen = h("button", { type: "button", klasse: "e-leise-link", "data-aktion": "trennen", text: TE.ki.trennen, hidden: true });
    trennen.addEventListener("click", () => trenneEine(id));
    const version = z.erkennung[id]?.version ? TE.ki.version(versionVon(z.erkennung[id].version) || z.erkennung[id].version) : (gefunden(id) ? TE.ki.versionUnbekannt : TE.ki.nichtInstalliertKurz);
    const untertitel = konten.length > 1 ? `${version} · ${TE.ki.konten(konten.length)}` : version;
    const kopf = h("div", { klasse: "e-ki-kopf" }, h("span", { klasse: "e-logo-tile" }, kiLogo(id, 20, { dekorativ: true })),
      h("div", { klasse: "e-t" }, h("b", { text: name(id) }), h("span", { text: untertitel })), status, trennen);
    const kontoSeg = konten.length > 1 ? segment({ label: TE.ki.konto, groesse: "s", wert: k.konto, optionen: konten.map((c) => ({ wert: c.id, text: c.name })),
      aufAenderung: (w) => { k.konto = w; k.verbunden = false; k.status = null; if (!k.stufeGewaehlt) belege(k); zeichneZeilen(); beiAenderung(); } }) : null;
    const optionen = (k.vorbelegt === "gesperrt" || k.stufe === "gesperrt" ? STUFEN_MIT_SPERRE : STUFEN).map((s) => ({ wert: s, text: TE.ki.stufen[s].name }));
    const stufeSeg = segment({ label: TE.ki.darf, groesse: "s", wert: k.stufe, optionen,
      aufAenderung: (w) => { k.stufe = w; k.stufeGewaehlt = true; k.verbunden = false; k.status = null; aktual(); beiAenderung(); } });
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
      trennen.hidden = !k.verbunden || !!z.busy;
      meldung.replaceChildren(...meldungKnoten(id, k));
    }
    zeilen.set(id, { el, aktual });
    aktual();
    return el;
  }
  function meldungKnoten(id, k) {
    const s = k.status;
    if (!s) return sperreBleibt(k) ? [h("p", { klasse: "e-hint", "data-bereich": "gesperrt", text: TE.ki.gesperrtBleibt })] : [];
    if (s.art === "gesperrt") return [h("p", { klasse: "e-hint", "data-bereich": "gesperrt", text: TE.ki.gesperrtBleibt })];
    if (s.art === "getrennt") return [h("p", { klasse: "e-hint", text: TE.ki.getrennt(name(id)) })];
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

  // „Eine andere KI?“: der Eintrag zum Kopieren für Programme, bei denen sich Kortex nicht selbst einträgt (Feld „mcpServers“ in deren MCP-Einstellungen)
  function zeichneKonfig() {
    const knopf = baueKnopf({ text: TE.ki.konfigKopieren, groesse: "s", symbol: "kopieren", aktion: "konfig-kopieren", aufKlick: async () => {
      try { const r = await mitLaden(knopf, () => api.mcpKonfiguration()); if (r?.json && await kopiere(r.json)) melde(TE.ki.konfigKopiert); else melde(TE.ki.konfigFehler); }
      catch (e) { melde(meldungVon(e)); }
    } });
    konfigEl.replaceChildren(h("div", { klasse: "e-schalt-zeile e-konfig-zeile" }, h("div", null, h("b", { text: TE.ki.konfigTitel }), h("span", { text: TE.ki.konfigText })), knopf));
  }

  // ---------------------------------------------------------------- Verbinden und Trennen
  async function verbindeEine(id, umstellen = false) {
    const k = zustandFuer(id);
    k.status = { art: "verbindet" }; zeilen.get(id)?.aktual();
    try {
      // Eine Stufe geht nur mit, wenn sie gilt: vorbelegt und nicht angefasst heißt „nicht ausdrücklich“ (ein vom Nutzer gesperrtes Konto bleibt dann gesperrt, die Werkstatt hält die Sperre);
      // ein gesperrtes Konto ohne Wahl schickt gar keine Stufe.
      const r = await api.mcpVerbinden({ ziel: id, umstellen, konto: k.konto || undefined, ...(sperreBleibt(k) ? {} : { zugriff: k.stufe, zugriffAusdruecklich: k.stufeGewaehlt }) });
      k.verbunden = true;
      k.status = r?.zugriffGrund === "vom-nutzer-gesperrt" || sperreBleibt(k) ? { art: "gesperrt" } : null;
      // Erweitert = das Konto pflegt den Vault täglich im Hintergrund (nur ein Konto je Vault; das erste gewinnt, auch über mehrere Läufe)
      if (k.stufe === "erweitert" && k.konto && !sperreBleibt(k) && !z.pflege && vaultPfad() && r?.zugriffGrund !== "vom-nutzer-gesperrt") {
        try { await api.kiPflegeSetzen({ vault: vaultPfad(), konto: k.konto, stufe: PFLEGE_STUFE }); z.pflege = { konto: k.konto, name: kontenVon(id).find((c) => c.id === k.konto)?.name || name(id), imDienst: null }; }
        catch (e) { melde(meldungVon(e)); }
      }
    } catch (e) {
      k.verbunden = false;
      if (e?.status === 409 && e?.daten?.art === "anders" && !umstellen) k.status = { art: "anders" };
      else k.status = { art: "fehler", text: TE.ki.fehler(name(id), e?.status === 404 && !e?.daten?.befehl ? TE.ki.nichtGefunden(name(id)) : meldungVon(e)), befehl: typeof e?.daten?.befehl === "string" ? e.daten.befehl : null };
    }
    zeilen.get(id)?.aktual();
  }
  // „Trennen“ nimmt nur den Eintrag von Kortex bei dieser KI wieder heraus (ein fremder Eintrag „brain“ bleibt stehen)
  async function trenneEine(id) {
    if (z.busy) return;
    const k = zustandFuer(id);
    k.status = { art: "verbindet" }; zeilen.get(id)?.aktual();
    try {
      await api.mcpTrennen({ ziel: id, konto: k.konto || undefined });
      k.verbunden = false; k.status = { art: "getrennt" };
    } catch (e) {
      k.status = { art: "fehler", text: TE.ki.fehler(name(id), meldungVon(e)), befehl: null };
    }
    zeilen.get(id)?.aktual(); beiAenderung();
  }

  // Alle gewählten, noch nicht verbundenen: nacheinander. Rückgabe: true = alle gewählten sind verbunden (oder keine gewählt).
  async function verbinde() {
    z.busy = true; auswahl?.sperre(true);
    for (const id of offen()) await verbindeEine(id);
    z.busy = null; auswahl?.sperre(false);
    for (const { aktual } of zeilen.values()) aktual();
    return offen().length === 0;
  }
  // Fertig-Text ehrlich: läuft die Pflege wirklich im Hintergrunddienst für diesen Vault (dienst.fuerVault), oder erst beim nächsten Sitzungsstart?
  async function ladePflege() {
    if (!z.pflege || !vaultPfad()) return;
    try { const r = await api.kiPflege(vaultPfad()); z.pflege.imDienst = r?.dienst?.fuerVault === true; } catch { z.pflege.imDienst = false; }
  }

  // ---------------------------------------------------------------- Zusätzlich, wenn du möchtest (Hooks, Prüfung, Hintergrunddienst)
  async function ladeZusatz() {
    if (zusatzGeladen || !vaultPfad() || !z.geladen) return;
    zusatzGeladen = true;
    try { z.zusatz = await api.kernStand(); } catch { z.zusatz = null; }
    zeichneZusatz();
  }
  const claudeProfil = () => {
    const stand = z.zusatz;
    const profile = Array.isArray(stand?.profile) ? stand.profile : [];
    if (!profile.length) return null;
    const k = z.ki.claude, konto = k && z.konten.find((c) => c.id === k.konto);
    const norm = (p) => String(p || "").replace(/^~/, "").replace(/\/+$/, "");
    return (konto && profile.find((p) => norm(p.pfad).endsWith(norm(konto.ordner)) && norm(konto.ordner))) || profile.find((p) => p.standard) || profile[0];
  };
  function zusatzZeile(was, titel, text, aktiv, schalten) {
    const fehler = z.zusatzFehler[was];
    const schalter = umschalter({ an: aktiv, label: titel, daten: { "data-aktion": `zusatz-${was}` }, aufAenderung: async (w) => {
      if (z.zusatzBusy) { schalter.an = aktiv; return; }
      z.zusatzBusy = was; z.zusatzFehler[was] = null; z.zusatzFrage = null; zeichneZusatz();
      try { const r = await schalten(w, false); if (r?.stand) z.zusatz = r.stand; }
      catch (e) {
        if (was === "git" && w && e?.status === 409 && e?.daten?.art === "anders") z.zusatzFrage = "git";
        else z.zusatzFehler[was] = meldungVon(e);
      }
      z.zusatzBusy = null; zeichneZusatz();
    } });
    return h("div", { klasse: "e-schalt-zeile e-zusatz-zeile", "data-zusatz": was },
      h("div", null, h("b", { text: titel }), h("span", { text }),
        z.zusatzBusy === was ? h("span", { klasse: "e-hint e-shimmer", text: TE.ki.zusatzArbeit }) : null,
        fehler ? h("span", { klasse: "e-meldung schlecht", role: "alert" }, symbol("warnung", 14), h("span", { text: fehler })) : null,
        was === "git" && z.zusatzFrage === "git" ? h("span", { klasse: "e-frage", role: "group", "data-bereich": "git-ersetzen" }, h("span", { klasse: "e-hint", text: TE.ki.zusatzGitErsetzen }),
          h("span", { klasse: "e-frage-knoepfe" },
            baueKnopf({ text: TE.ki.nichtAendern, groesse: "s", aktion: "git-nicht-ersetzen", aufKlick: () => { z.zusatzFrage = null; zeichneZusatz(); } }),
            baueKnopf({ text: TE.ki.zusatzErsetzen, variante: "primaer", groesse: "s", aktion: "git-ersetzen", aufKlick: async () => {
              z.zusatzBusy = "git"; z.zusatzFrage = null; zeichneZusatz();
              try { const r = await schalten(true, true); if (r?.stand) z.zusatz = r.stand; } catch (e) { z.zusatzFehler.git = meldungVon(e); }
              z.zusatzBusy = null; zeichneZusatz();
            } }))) : null),
      schalter);
  }
  function zeichneZusatz() {
    const s = z.zusatz;
    const zeilenListe = [];
    const claudeDa = gewaehlt().includes("claude") || gefunden("claude");
    const profil = claudeProfil();
    if (s && claudeDa && profil) {
      zeilenListe.push(zusatzZeile("claude", TE.ki.zusatz.claude.titel, TE.ki.zusatz.claude.text, s.claude?.profile?.[profil.pfad]?.aktiv === true,
        (an) => api.kernVerdrahten({ was: "claude", an, profile: [profil.pfad] })));
    }
    if (s?.git && s.git.moeglich === true && !s.git.fehler) {
      zeilenListe.push(zusatzZeile("git", TE.ki.zusatz.git.titel, TE.ki.zusatz.git.text, s.git.aktiv === true, (an, ersetzen) => api.kernVerdrahten({ was: "git", an, ...(ersetzen ? { ersetzen: true } : {}) })));
    }
    if (s?.dienst?.verfuegbar === true) {
      zeilenListe.push(zusatzZeile("dienst", TE.ki.zusatz.dienst.titel, TE.ki.zusatz.dienst.text, s.dienst.eingerichtet === true, (an) => api.kernVerdrahten({ was: "dienst", an })));
    }
    zusatzEl.hidden = !zeilenListe.length;
    zusatzEl.replaceChildren(...(zeilenListe.length ? [h("div", { klasse: "e-abschnitt-kopf" }, TE.ki.zusatz.kopf), ...zeilenListe] : []));
  }

  return {
    z, wurzel, lade, an, offen, verbundene, verbinde, ladePflege, vaultGewechselt,
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
