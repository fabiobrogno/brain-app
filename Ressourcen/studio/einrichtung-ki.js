// Schritt „KI“ der Einrichtung (Paket E2): eine Liste der gefundenen Programme, je Zeile EIN Knopf „Verbinden“. Konto-Wahl nur, wenn es mehr als ein Konto gibt (kleine Auswahl in der Zeile);
// der Zugriff in diesem Vault steht als Vorgabe „Posteingang“ mit „Ändern“; die stille Prüfung nach dem Eintragen (ein lesender Aufruf über den Kortex-Server) endet als Haken in der Zeile.
// Darunter die Zeile „Kontingent in Kortex anzeigen“ (Vorgabe an). Die Regeln sind die des Ablaufs in ki-verbinden.js, hier nur ohne Unterschritte:
//  · ein vom Nutzer gesperrtes Konto bleibt gesperrt, bis er ausdrücklich eine Stufe wählt (die Werkstatt hält die Sperre auch gegen eine Vorgabe)
//  · ein fremder Eintrag „brain“ wird nur nach Rückfrage umgestellt; scheitert das Eintragen, steht der Befehl zum Kopieren da
//  · Anmelden (Claude Code, Codex): `starteAnmeldung` aus einrichtung-anmeldung.js (Haken für Paket E3)
import { h } from "./hilfen.js";
import { api as standardApi } from "./api.js";
import { symbol } from "./symbole.js";
import { kiKatalog, kiLogo, kiLogoName } from "./ki-logos.js";
import { knopf as baueKnopf, umschalter } from "./bausteine.js";
import { oeffneMenue } from "./menue.js";
import { ANMELDBAR, pruefeKontoAnmeldung, erkennungAus } from "./ki-verbinden.js";
import { starteAnmeldung } from "./einrichtung-anmeldung.js";
import { TE } from "./texte-einrichtung.js";

const KONTO_EREIGNIS = "kortex-konten"; // app.js: die Konto-Leiste holt ihren Stand neu
const STUFEN = ["gesperrt", "lesen", "posteingang"]; // „Erweitert“ (tägliche Pflege) gibt es in den Einstellungen
const MIT_ZUGRIFF = ["lesen", "posteingang", "erweitert"];
const name = (id) => kiLogoName(id) || id;
const meldungVon = (e) => (typeof e?.message === "string" && e.message.trim()) || TE.vault.fehlerStandard;
const versionVon = (v) => { const m = /\d+(?:\.\d+)+/.exec(String(v || "")); return m ? m[0] : null; };

export function erzeugeKi({ api = standardApi, vaultPfad, vaultName, beiAenderung = () => {}, kopiere, melde = () => {} } = {}) {
  const Z = { geladen: false, sucht: false, erkennung: {}, erkannt: false, konten: [], zugriff: {}, zeilen: new Map(), kontingent: true, kontingentGesetzt: null, tot: false, lade: 0, abgleichVersucht: false, sicherungEntfaellt: false };
  const wurzel = h("div", { klasse: "e-ki-wurzel", id: "ki-koerper", "data-bereich": "ki" });
  const aenderung = () => { try { beiAenderung(); } catch (e) { console.error(e); } };

  // ---------------------------------------------------------------- Hilfen
  const gefunden = (id) => Z.erkennung[id]?.gefunden === true;
  const programme = () => kiKatalog().filter((e) => e.verbindbar && gefunden(e.id));
  const kontenVon = (id) => Z.konten.filter((k) => k.programm === id && k.vorhanden !== false);
  const kontoMit = (id) => Z.konten.find((k) => k.id === id) || null;
  const stufeAktuell = (kontoId) => {
    const p = vaultPfad();
    const s = kontoId && p ? Z.zugriff?.[kontoId]?.[p] : null;
    return [...STUFEN, "erweitert"].includes(s) ? s : null;
  };
  function zeile(id) {
    let z = Z.zeilen.get(id);
    if (!z) {
      z = { id, konto: null, stufe: "posteingang", ausdruecklich: false, zustand: "bereit", fehler: null, befehl: null, frage: false, anmeldung: null, anmEl: h("div", { klasse: "e-kr-anm" }), version: null, ergebnisStufe: null };
      Z.zeilen.set(id, z);
    }
    return z;
  }
  const sperreBleibt = (z) => z.stufe === "gesperrt" && !z.ausdruecklich;
  // Zeile mit dem Stand der Wirklichkeit abgleichen, ohne einen laufenden Vorgang zu stören
  function beleg(z) {
    if (["verbindet", "prueft", "anmeldung"].includes(z.zustand)) return;
    const konten = kontenVon(z.id);
    if (!z.konto || !kontoMit(z.konto)) z.konto = (konten.find((k) => k.standard) || konten[0])?.id ?? null;
    const aktuell = stufeAktuell(z.konto);
    if (!z.ausdruecklich) z.stufe = aktuell || "posteingang";
    const k = kontoMit(z.konto);
    const hatZugriff = !!k && k.verbunden === true && MIT_ZUGRIFF.includes(aktuell);
    if (hatZugriff && z.zustand !== "fehler") { z.zustand = "ok"; z.ergebnisStufe = aktuell; }
    else if (z.zustand === "ok" && !hatZugriff && !z.eigenerLauf) z.zustand = "bereit";
    z.version = Z.erkennung[z.id]?.version || null;
  }

  // ---------------------------------------------------------------- Laden (rein lesend)
  async function lade(neu = false) {
    const nr = ++Z.lade;
    Z.sucht = true; zeichne();
    const [erk, kon] = await Promise.allSettled([api.kiErkennen(neu), api.kiKonten()]);
    if (Z.tot || nr !== Z.lade) return;
    const e = erk.status === "fulfilled" ? erk.value : null;
    let kv = kon.status === "fulfilled" ? kon.value : null;
    // Fehlt die Liste oder ist sie beschädigt, legt der ausdrückliche Abgleich sie an (höchstens einmal)
    if (kv && kv.zustand !== "ok" && !Z.abgleichVersucht) { Z.abgleichVersucht = true; try { kv = await api.kiKontenAbgleich(); } catch { /* ohne Liste weiter */ } if (Z.tot || nr !== Z.lade) return; }
    Z.konten = Array.isArray(kv?.konten) ? kv.konten : [];
    Z.zugriff = kv?.zugriff && typeof kv.zugriff === "object" ? kv.zugriff : {};
    Z.erkennung = erkennungAus(e);
    Z.erkannt = !!e;
    Z.geladen = true; Z.sucht = false;
    for (const p of programme()) beleg(zeile(p.id));
    // Konten ohne gefundenes Programm (z. B. nur über den Ordner da) zählen für „schon verbunden“, bekommen aber keine Zeile
    zeichne(); aenderung();
  }
  // Ist für DIESEN Vault schon eine KI verbunden (Konto verbunden und mit Zugriff)? Dann entfällt der Schritt.
  const schonVerbunden = () => Z.geladen && Z.konten.some((k) => k.verbunden === true && MIT_ZUGRIFF.includes(stufeAktuell(k.id)));

  // ---------------------------------------------------------------- Verbinden
  async function verbinde(id) {
    const z = zeile(id), k = kontoMit(z.konto);
    if (["verbindet", "prueft", "anmeldung"].includes(z.zustand)) return;
    z.fehler = null; z.befehl = null; z.frage = false;
    // Angemeldet? Nur bei Programmen mit eigener Anmeldung; das Ergebnis dieser Prüfung entscheidet nur, ob zuerst angemeldet wird (nie Zugangsdaten lesen).
    if (ANMELDBAR.includes(id) && k) {
      z.zustand = "prueft"; zeichne(); aenderung();
      const st = await pruefeKontoAnmeldung(api, k);
      if (Z.tot) return;
      if (st.zustand === "nicht-angemeldet" || st.zustand === "abgelaufen") {
        z.zustand = "anmeldung"; zeichne(); aenderung();
        z.anmeldung = starteAnmeldung(id, k, { api, wurzel: z.anmEl,
          beiAngemeldet: () => { z.anmeldung = null; z.zustand = "bereit"; fuehreAus(id); },
          beiAbbruch: () => { z.anmeldung = null; z.zustand = "bereit"; zeichne(); aenderung(); } });
        return;
      }
    }
    await fuehreAus(id);
  }
  async function fuehreAus(id, { umstellen = false } = {}) {
    const z = zeile(id), k = kontoMit(z.konto), n = name(id);
    z.zustand = "verbindet"; z.eigenerLauf = true; z.fehler = null; z.befehl = null; z.frage = false; zeichne(); aenderung();
    let r;
    try {
      r = await api.mcpVerbinden({ ziel: id, umstellen, konto: z.konto || undefined, ...(sperreBleibt(z) ? {} : { zugriff: z.stufe, zugriffAusdruecklich: z.ausdruecklich }) });
    } catch (e) {
      if (Z.tot) return;
      if (e?.status === 409 && e?.daten?.art === "anders" && !umstellen) { z.zustand = "bereit"; z.frage = true; zeichne(); aenderung(); return; }
      const befehl = typeof e?.daten?.befehl === "string" ? e.daten.befehl : null;
      z.zustand = "fehler"; z.befehl = befehl;
      z.fehler = TE.ki.fehler(n, e?.status === 404 && !befehl ? TE.ki.nichtGefunden(n) : meldungVon(e));
      zeichne(); aenderung(); return;
    }
    if (Z.tot) return;
    // stille Prüfung: ein echter, rein lesender Aufruf über den Kortex-Server als dieses Konto
    try { await api.mcpPruefen({ konto: z.konto || undefined, programm: id }); }
    catch (e) {
      if (Z.tot) return;
      z.zustand = "fehler"; z.fehler = e?.daten?.art === "kein-zugriff" ? TE.ki.keinZugriff(n) : TE.ki.fehler(n, meldungVon(e));
      zeichne(); aenderung(); return;
    }
    if (Z.tot) return;
    z.ergebnisStufe = sperreBleibt(z) || r?.zugriffGrund === "vom-nutzer-gesperrt" ? "gesperrt" : z.stufe;
    z.zustand = "ok";
    try { window.dispatchEvent(new CustomEvent(KONTO_EREIGNIS)); } catch { /* ohne Fenster */ }
    zeichne(); aenderung();
    if (id === "claude" && k && Z.kontingent) await schalteKontingent(k, true);
    await lade(false); // Konten und Zugriffe neu lesen (der Stand in der Zeile kommt aus der Wirklichkeit)
    z.eigenerLauf = false;
  }
  // Das Kontingent von Claude Code (Statuszeile): erst jetzt, nach dem Verbinden und nur bei eingeschaltetem Schalter; die Zeile darunter sagt vorher, was sich ändert.
  async function schalteKontingent(k, an) {
    try { await api.kiStatuszeile({ konto: k.id, an, bestaetigt: k.verwaltet !== true }); Z.kontingentGesetzt = an ? k.id : null; }
    catch (e) { melde(TE.ki.kontingentFehler); console.error(e); }
  }
  const claudeKonto = () => { const z = Z.zeilen.get("claude"); return z?.zustand === "ok" ? kontoMit(z.konto) : null; };
  async function kontingentSchalter(an) {
    Z.kontingent = an;
    const k = claudeKonto();
    if (an && k && Z.kontingentGesetzt !== k.id) await schalteKontingent(k, true);
    else if (!an && Z.kontingentGesetzt) { const alt = kontoMit(Z.kontingentGesetzt); if (alt) await schalteKontingent(alt, false); }
    aenderung();
  }

  // ---------------------------------------------------------------- Zeichnen
  function stufeMenue(anker, z) {
    oeffneMenue(anker, [{ gruppe: TE.ki.zugriffMenue }, ...STUFEN.map((s) => ({ name: TE.ki.stufen[s].name, sub: s === "posteingang" ? TE.ki.vorgabe : undefined, haken: z.stufe === s, id: `stufe-${s}`,
      tun: () => { z.stufe = s; z.ausdruecklich = true; if (z.zustand === "ok") z.zustand = "bereit"; zeichne(); aenderung(); } }))]);
  }
  function kontoMenue(anker, z) {
    oeffneMenue(anker, [{ gruppe: TE.ki.kontoMenue }, ...kontenVon(z.id).map((k) => ({ name: k.name, sub: k.ordner || undefined, symbol: "person", haken: z.konto === k.id, id: `konto-${k.id}`,
      tun: () => { z.konto = k.id; z.ausdruecklich = false; z.zustand = "bereit"; beleg(z); zeichne(); aenderung(); } }))]);
  }
  function zeilenKnoten(p) {
    const z = zeile(p.id), konten = kontenVon(p.id), k = kontoMit(z.konto), n = p.name;
    const teile = [];
    const trenner = () => h("span", { klasse: "e-sepd", text: "·" });
    const sub = (...t) => t.forEach((x, i) => { if (teile.length && i === 0) teile.push(trenner()); teile.push(x); });
    const ok = z.zustand === "ok";
    if (ok) {
      if (k && (konten.length > 1 || ANMELDBAR.includes(p.id))) sub(h("span", { text: k.name }));
    } else {
      const v = versionVon(z.version);
      sub(h("span", { text: v ? TE.ki.version(v) : n }));
      if (konten.length > 1) {
        const b = h("button", { type: "button", klasse: "e-acsel", "data-aktion": "konto-waehlen", "data-ki": p.id, "aria-haspopup": "menu", disabled: z.zustand !== "bereit" && z.zustand !== "fehler" || null }, symbol("person", 12), h("span", { text: TE.ki.kontoWahl(k?.name || "—") }), symbol("chevron-unten", 12));
        b.addEventListener("click", () => kontoMenue(b, z));
        sub(b);
      }
    }
    const stufeText = ok ? TE.ki.stufen[z.ergebnisStufe || z.stufe].name : TE.ki.stufen[z.stufe].name;
    const aendern = h("button", { type: "button", klasse: "e-lnk e-ak", "data-aktion": "stufe-aendern", "data-ki": p.id, "aria-haspopup": "menu", text: TE.ki.aendern, disabled: z.zustand === "verbindet" || z.zustand === "prueft" || z.zustand === "anmeldung" || null });
    aendern.addEventListener("click", () => stufeMenue(aendern, z));
    sub(h("span", { "data-feld": "zugriff", text: TE.ki.zugriff(stufeText) }), aendern);
    let ct;
    if (ok) ct = h("span", { klasse: "e-tick", "data-zustand": "ok" }, h("span", { klasse: "e-tc" }, symbol("haken", 12)), TE.ki.verbunden);
    else if (z.zustand === "prueft" || z.zustand === "verbindet") ct = baueKnopf({ text: z.zustand === "prueft" ? TE.ki.pruefe : TE.ki.verbindet, disabled: true, laedt: true, aktion: "verbinden", daten: { "data-ki": p.id } });
    else if (z.zustand === "anmeldung") ct = h("span");
    else ct = baueKnopf({ text: z.zustand === "fehler" ? TE.ki.nochmal : TE.ki.verbinden, variante: "primaer", aktion: "verbinden", label: TE.ki.verbindenAria(n), daten: { "data-ki": p.id }, aufKlick: () => verbinde(p.id) });
    const extra = [];
    if (z.frage) {
      extra.push(h("div", { klasse: "e-ki-frage", role: "group", "data-bereich": "umstellen" }, h("span", { klasse: "e-hint", text: TE.ki.anders(n) }),
        h("span", { klasse: "e-ki-frage-knoepfe" },
          baueKnopf({ text: TE.ki.nichtAendern, groesse: "s", aktion: "nicht-umstellen", aufKlick: () => { z.frage = false; zeichne(); aenderung(); } }),
          baueKnopf({ text: TE.ki.umstellen, variante: "primaer", groesse: "s", aktion: "umstellen", aufKlick: () => fuehreAus(p.id, { umstellen: true }) }))));
    }
    if (z.fehler) {
      extra.push(h("div", { klasse: "e-meldung schlecht", role: "alert", "data-bereich": "ki-fehler" }, symbol("warnung", 14), h("span", { text: z.fehler })));
      if (z.befehl) extra.push(h("div", { klasse: "e-befehl", "data-bereich": "befehl" }, h("span", { klasse: "e-hint", text: TE.ki.befehl }),
        h("div", { klasse: "e-befehl-zeile" }, h("code", { text: z.befehl }),
          baueKnopf({ text: TE.ki.befehlKopieren, groesse: "s", aktion: "befehl-kopieren", aufKlick: async () => { if (await kopiere?.(z.befehl)) melde(TE.ki.befehlKopiert); } }))));
    }
    if (ok && z.ergebnisStufe === "gesperrt") extra.push(h("p", { klasse: "e-hint", "data-bereich": "gesperrt-bleibt", text: TE.ki.gesperrtBleibt }));
    if (z.zustand === "anmeldung") extra.push(z.anmEl);
    return h("div", { klasse: "e-kr", "data-ki": p.id, "data-zustand": z.zustand },
      h("span", { klasse: "e-tile" }, kiLogo(p.id, 18, { dekorativ: true })),
      h("div", { klasse: "e-tx" }, h("div", { klasse: "e-nm", text: n }), h("div", { klasse: "e-sb2" }, ...teile)),
      h("div", { klasse: "e-ct" }, ct), ...extra);
  }
  function zeichne() {
    if (Z.tot) return;
    const teile = [];
    if (!Z.geladen) {
      teile.push(h("div", { klasse: "e-leer", "data-bereich": "ki-laedt" }, h("span", { klasse: "e-lade" }), h("span", { klasse: "e-shimmer", text: TE.ki.sucht })));
    } else {
      const liste = programme();
      if (!liste.length) {
        teile.push(h("div", { klasse: "e-leer", "data-bereich": "ki-keine" }, h("span", { klasse: "e-kreis" }, symbol("suche", 24)), h("b", { text: TE.ki.keineTitel }), h("p", { text: TE.ki.keineText }),
          baueKnopf({ text: TE.ki.erneut, symbol: "sync", aktion: "erneut-suchen", laedt: Z.sucht, aufKlick: async () => {
            const vorher = Object.values(Z.erkennung).filter((x) => x.gefunden).length;
            await lade(true);
            if (Object.values(Z.erkennung).filter((x) => x.gefunden).length <= vorher) melde(TE.ki.nichtsNeues);
          } })));
      } else {
        teile.push(h("div", { klasse: "e-krows", "data-bereich": "ki-liste" }, liste.map((p) => zeilenKnoten(p))));
        if (gefunden("claude")) {
          const sw = umschalter({ an: Z.kontingent, label: TE.ki.kontingent, daten: { "data-aktion": "kontingent" }, aufAenderung: (w) => { kontingentSchalter(w); } });
          teile.push(h("div", { klasse: "e-qrow", "data-bereich": "kontingent" }, symbol("balken", 20), h("div", { klasse: "e-tx" }, h("b", { text: TE.ki.kontingent }), h("p", { text: TE.ki.kontingentText })), sw));
        }
      }
      if (Z.sicherungEntfaellt) teile.push(h("div", { klasse: "e-qhint", "data-bereich": "sicherung-entfaellt" }, symbol("wolke-hoch", 14), h("span", { text: TE.ki.sicherungEntfaellt })));
    }
    wurzel.replaceChildren(...teile);
  }
  zeichne();

  return {
    z: Z, wurzel, lade, schonVerbunden,
    setzeSicherungEntfaellt(an) { Z.sicherungEntfaellt = !!an; zeichne(); },
    /** Läuft gerade etwas (Prüfen, Verbinden, Anmelden)? Dann bleibt der Ablauf in diesem Schritt. */
    arbeitet: () => [...Z.zeilen.values()].some((z) => ["verbindet", "prueft", "anmeldung"].includes(z.zustand)),
    verbundene: () => programme().filter((p) => Z.zeilen.get(p.id)?.zustand === "ok").map((p) => p.id),
    kontingentAn: () => Z.kontingent,
    vaultGewechselt() { for (const z of Z.zeilen.values()) z.anmeldung?.stoppe(); Z.zeilen.clear(); Z.geladen = false; Z.kontingentGesetzt = null; zeichne(); },
    zerstoere() { Z.tot = true; for (const z of Z.zeilen.values()) z.anmeldung?.stoppe(); },
  };
}
