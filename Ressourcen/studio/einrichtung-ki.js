// Schritt „KI“ des Einrichtungs-Assistenten (Übergangsvariante): die erkannten Programme als Zeilen mit Schalter, Konto und Stufe, dahinter „Weitere Programme“
// mit den echten Logos. Alles Echte läuft über die vorhandene API (kiErkennen, kiKonten, mcpVerbinden mit Konto und Stufe, kiPflegeSetzen) — nichts wird nur angezeigt.
// Sobald der Baustein „KI-Auswahl“ (Branch feat/ki-katalog) auf main ist, ersetzt er `baueListe` und `baueKatalog`; Erkennung, Verbinden und Bühne bleiben hier.
import { h } from "./hilfen.js";
import { api } from "./api.js";
import { symbol } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { segment, umschalter, knopf as baueKnopf, mitLaden } from "./bausteine.js";
import { TE } from "./texte-einrichtung.js";

export const KI_NAME = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", "claude-desktop": "Claude Desktop", gemini: "Gemini CLI", copilot: "GitHub Copilot", zed: "Zed", opencode: "OpenCode", warp: "Warp" };
// Reihenfolge der Anzeige: die drei Hauptprogramme zuerst
const REIHE = ["claude", "codex", "cursor", "gemini", "copilot", "claude-desktop", "zed", "opencode", "warp"];
const SEITE = {
  claude: "https://claude.com/claude-code", codex: "https://developers.openai.com/codex", cursor: "https://cursor.com", gemini: "https://github.com/google-gemini/gemini-cli",
  copilot: "https://github.com/features/copilot", zed: "https://zed.dev", opencode: "https://opencode.ai", warp: "https://www.warp.dev", "claude-desktop": "https://claude.ai/download",
};
const STUFEN = ["lesen", "posteingang", "erweitert"];
const ALIAS = { "cursor-agent": "cursor" };
const PFLEGE_STUFE = "mittel"; // „Wie bisher“ (texte-konten.js): kleines Modell für Urteile, größeres für Prüfung und Pflege

const meldungVon = (e) => (typeof e?.message === "string" && e.message.trim()) || TE.vault.fehlerStandard;
const versionVon = (v) => { const m = /\d+(?:\.\d+)+/.exec(String(v || "")); return m ? m[0] : null; };

export function erzeugeKi({ vaultPfad, beiAenderung, oeffneExtern, kopiere, melde }) {
  const z = { geladen: false, laedt: false, programme: [], weitere: [], ki: {}, weitereOffen: false, busy: null, pflege: null, suchtNeu: false, fehler: null };
  const wurzel = h("div", { klasse: "e-ki-wurzel", id: "ki-koerper" });
  let zeilen = new Map();

  // ---------------------------------------------------------------- Erkennung
  async function lade(neu = false) {
    z.laedt = true; z.fehler = null; zeichne();
    const [erk, kon] = await Promise.allSettled([api.kiErkennen(neu), api.kiKonten()]);
    const e = erk.status === "fulfilled" ? erk.value : null;
    const konten = kon.status === "fulfilled" && Array.isArray(kon.value?.konten) ? kon.value.konten : [];
    const gefunden = new Map();
    const merke = (id, version) => { if (!gefunden.has(id)) gefunden.set(id, { id, version: version || null }); else if (version && !gefunden.get(id).version) gefunden.get(id).version = version; };
    for (const a of e?.agenten ?? []) if (a && (a.pfad || a.version)) merke(ALIAS[a.id] || a.id, versionVon(a.version));
    if (e?.cursorDa) merke("cursor", null);
    for (const p of e?.programme ?? []) if (p?.gefunden) merke(p.id, versionVon(p.version));
    const bekannt = [...gefunden.values()].filter((p) => Object.hasOwn(KI_NAME, p.id)).sort((a, b) => REIHE.indexOf(a.id) - REIHE.indexOf(b.id));
    const alt = z.ki;
    z.programme = bekannt.map((p) => ({
      ...p, name: KI_NAME[p.id],
      konten: konten.filter((k) => k.programm === p.id && k.vorhanden !== false).map((k) => ({ id: k.id, name: k.name || KI_NAME[p.id], standard: !!k.standard })),
    }));
    z.weitere = REIHE.filter((id) => !gefunden.has(id));
    z.ki = {};
    z.programme.forEach((p, i) => {
      const vorher = alt[p.id];
      const standardKonto = p.konten.find((k) => k.standard) || p.konten[0];
      z.ki[p.id] = vorher && p.konten.some((k) => k.id === vorher.konto) ? { ...vorher } : { an: i === 0, konto: standardKonto?.id ?? null, stufe: "posteingang", verbunden: false, status: null };
    });
    z.laedt = false; z.geladen = true; z.fehler = erk.status === "rejected" ? meldungVon(erk.reason) : null;
    zeichne(); beiAenderung();
  }

  const an = () => z.programme.filter((p) => z.ki[p.id].an);
  const offen = () => an().filter((p) => !z.ki[p.id].verbunden);
  const verbundene = () => z.programme.filter((p) => z.ki[p.id].verbunden);

  // ---------------------------------------------------------------- Zeilen
  function baueZeile(p) {
    const k = z.ki[p.id];
    const status = h("span", { klasse: "e-ki-status" });
    const schalter = umschalter({ an: k.an, label: TE.ki.verbindenAria(p.name), aufAenderung: (w) => { if (z.busy) { schalter.an = k.an; return; } k.an = w; k.verbunden = false; k.status = null; aktual(); beiAenderung(); }, daten: { tabindex: "0" } });
    const kopf = h("div", { klasse: "e-ki-kopf" }, h("span", { klasse: "e-logo-tile", "data-ki-kachel": p.id }, kiLogo(p.id, 20, { dekorativ: true })),
      h("div", { klasse: "e-t" }, h("b", { text: p.name }), h("span", { text: untertitel(p) })), status, schalter);
    kopf.addEventListener("click", (e) => { if (e.target.closest(".bs-schalter")) return; schalter.click(); });
    const kontoSeg = p.konten.length > 1 ? segment({ label: TE.ki.konto, groesse: "s", wert: k.konto, optionen: p.konten.map((c) => ({ wert: c.id, text: c.name })), aufAenderung: (w) => { k.konto = w; k.verbunden = false; k.status = null; aktual(); beiAenderung(); } }) : null;
    const stufeSeg = segment({ label: TE.ki.darf, groesse: "s", wert: k.stufe, optionen: STUFEN.map((s) => ({ wert: s, text: TE.ki.stufen[s].name })), aufAenderung: (w) => { k.stufe = w; k.verbunden = false; k.status = null; aktual(); beiAenderung(); } });
    const stufeText = h("p", { klasse: "e-stufe-text" });
    const meldung = h("div", { klasse: "e-ki-meldung", "aria-live": "polite" });
    const einst = h("div", { klasse: "e-ki-einst" },
      kontoSeg ? h("div", { klasse: "e-reihe" }, h("span", { klasse: "e-cap", text: TE.ki.konto }), kontoSeg) : null,
      h("div", { klasse: "e-reihe" }, h("span", { klasse: "e-cap", text: TE.ki.darf }), stufeSeg), stufeText, meldung);
    const el = h("div", { klasse: "e-ki-zeile", "data-ki": p.id, "data-an": String(k.an) }, kopf, h("div", { klasse: "e-ki-mehr" }, h("div", null, einst)));

    function aktual() {
      el.dataset.an = String(k.an);
      el.classList.toggle("verbunden", k.verbunden);
      if (schalter.an !== k.an) schalter.an = k.an;
      stufeText.textContent = TE.ki.stufen[k.stufe].text;
      status.className = "e-ki-status" + (k.verbunden ? " ok" : "");
      status.replaceChildren(...(k.verbunden ? [symbol("kreis-haken", 12), TE.ki.verbunden] : k.status?.art === "verbindet" ? [h("span", { klasse: "e-shimmer", text: TE.ki.verbindet })] : []));
      meldung.replaceChildren(...meldungKnoten(p, k));
    }
    function meldungKnoten(prog, kz) {
      const s = kz.status;
      if (!s) return [];
      if (s.art === "gesperrt") return [h("p", { klasse: "e-hint", text: TE.ki.gesperrtBleibt })];
      if (s.art === "anders") {
        const nein = baueKnopf({ text: TE.ki.nichtAendern, groesse: "s", aktion: "nicht-umstellen", aufKlick: () => { kz.status = null; aktual(); } });
        const ja = baueKnopf({ text: TE.ki.umstellen, variante: "primaer", groesse: "s", aktion: "umstellen", aufKlick: async () => { await verbindeEine(prog, true); beiAenderung(); } });
        return [h("div", { klasse: "e-frage", role: "group", "data-bereich": "umstellen" }, h("p", { klasse: "e-hint", text: TE.ki.anders(prog.name) }), h("div", { klasse: "e-frage-knoepfe" }, nein, ja))];
      }
      if (s.art === "fehler") {
        return [h("div", { klasse: "e-meldung schlecht", role: "alert" }, symbol("warnung", 14), h("span", { text: s.text })), ...(s.befehl ? [befehlBlock(s.befehl)] : [])];
      }
      return [];
    }
    zeilen.set(p.id, aktual);
    aktual();
    return el;
  }

  function befehlBlock(befehl) {
    const knopf = baueKnopf({ text: TE.ki.befehlKopieren, groesse: "s", symbol: "kopieren", aktion: "befehl-kopieren", aufKlick: async () => { if (await kopiere(befehl)) melde(TE.ki.befehlKopiert, "kopieren"); } });
    return h("div", { klasse: "e-befehl", "data-bereich": "befehl" }, h("p", { klasse: "e-hint", text: TE.ki.befehl }), h("div", { klasse: "e-befehl-zeile" }, h("code", { text: befehl, tabindex: "0" }), knopf));
  }

  // ---------------------------------------------------------------- Liste und Katalog
  function baueListe() { zeilen = new Map(); return h("div", { klasse: "e-ki-liste" }, z.programme.map(baueZeile)); }

  function baueKatalog() {
    const knopfMehr = h("button", { type: "button", klasse: "e-mehr-knopf", "aria-expanded": String(z.weitereOffen), "data-aktion": "weitere" },
      symbol("chevron-rechts", 12), z.weitereOffen ? TE.ki.mehrAus : TE.ki.mehr(z.weitere.length));
    knopfMehr.addEventListener("click", () => {
      z.weitereOffen = !z.weitereOffen; zeichne();
      if (z.weitereOffen) wurzel.querySelector(".e-weitere")?.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    return [knopfMehr, ...(z.weitereOffen ? [h("div", { klasse: "e-weitere", "data-bereich": "weitere" }, z.weitere.map((id) => linkKachel(id, 14)))] : [])];
  }
  function linkKachel(id, g, kurz = false) {
    const a = h("a", { href: SEITE[id], "data-ki-link": id, title: TE.ki.anleitungOeffnet }, h("span", { klasse: "e-logo-tile" }, kiLogo(id, g, { dekorativ: true })), kurz ? KI_NAME[id].replace(" Code", "") : KI_NAME[id], symbol("extern", 12));
    a.addEventListener("click", (e) => { e.preventDefault(); oeffneExtern(SEITE[id]); });
    return a;
  }

  function leer() {
    const erneut = baueKnopf({ text: TE.ki.erneut, groesse: "s", symbol: "sync", klasse: "e-erneut", aktion: "suchen", aufKlick: async () => { z.suchtNeu = true; await mitLaden(erneut, () => lade(true)); z.suchtNeu = false; if (!z.programme.length) melde(TE.ki.nichtsNeues, "info"); } });
    return h("div", { klasse: "e-leer" }, h("span", { klasse: "e-kreis" }, symbol("gehirn", 24)), h("b", { text: TE.ki.leerTitel }), h("p", { text: TE.ki.leerText }),
      h("div", { klasse: "e-beliebt" }, ["claude", "cursor", "codex"].map((id) => linkKachel(id, 14, true))), erneut);
  }

  function zeichne() {
    if (!z.geladen) { wurzel.replaceChildren(h("div", { klasse: "e-abschnitt-kopf" }, h("span", { klasse: "e-shimmer", text: TE.ki.sucht }))); return; }
    if (!z.programme.length) { wurzel.replaceChildren(leer()); return; }
    wurzel.replaceChildren(
      h("div", { klasse: "e-abschnitt-kopf" }, TE.ki.gefunden, h("span", { klasse: "e-n", text: String(z.programme.length) })),
      baueListe(), ...baueKatalog());
  }

  const untertitel = (p) => {
    const v = p.version ? TE.ki.version(p.version) : TE.ki.versionUnbekannt;
    return p.konten.length > 1 ? `${v} · ${TE.ki.konten(p.konten.length)}` : p.konten.length === 1 ? `${v} · ${TE.ki.konten(1)}` : v;
  };

  // ---------------------------------------------------------------- Verbinden
  async function verbindeEine(p, umstellen = false) {
    const k = z.ki[p.id];
    k.status = { art: "verbindet" }; zeilen.get(p.id)?.();
    try {
      const r = await api.mcpVerbinden({ ziel: p.id, umstellen, konto: k.konto || undefined, zugriff: k.stufe, zugriffAusdruecklich: true });
      k.verbunden = true;
      k.status = r?.zugriffGrund === "vom-nutzer-gesperrt" ? { art: "gesperrt" } : null;
      // Erweitert = das Konto pflegt den Vault täglich im Hintergrund (nur ein Konto je Vault; das erste gewinnt)
      if (k.stufe === "erweitert" && k.konto && !z.pflege && vaultPfad()) {
        try { await api.kiPflegeSetzen({ vault: vaultPfad(), konto: k.konto, stufe: PFLEGE_STUFE }); z.pflege = { konto: k.konto, name: p.konten.find((c) => c.id === k.konto)?.name || p.name }; }
        catch (e) { melde(meldungVon(e), "warnung"); }
      }
    } catch (e) {
      k.verbunden = false;
      if (e?.status === 409 && e?.daten?.art === "anders" && !umstellen) k.status = { art: "anders" };
      else k.status = { art: "fehler", text: TE.ki.fehler(p.name, e?.status === 404 && !e?.daten?.befehl ? TE.ki.nichtGefunden(p.name) : meldungVon(e)), befehl: typeof e?.daten?.befehl === "string" ? e.daten.befehl : null };
    }
    zeilen.get(p.id)?.();
  }

  // Alle gewählten, noch nicht verbundenen: nacheinander. Rückgabe: true = alle gewählten sind verbunden (oder keine gewählt).
  async function verbinde() {
    z.busy = true; z.pflege = null;
    for (const p of offen()) await verbindeEine(p);
    z.busy = null;
    return offen().length === 0;
  }

  return {
    z, wurzel, lade, an, offen, verbundene, verbinde,
    zeichne,
    // Ansicht für die Bühne
    buehne() {
      const progs = z.programme.slice(0, 4);
      return { modus: `${z.geladen}:${progs.map((p) => p.id).join(",")}`, programme: progs.map((p) => ({ id: p.id, name: p.name, an: z.ki[p.id].an, stufeName: TE.ki.stufen[z.ki[p.id].stufe].name })), keine: z.geladen && !z.programme.length };
    },
  };
}
