// Mitteilungen und Aktivität (Paket P8a, Studio-Seite). Die Werkstatt führt je Vault ein Protokoll (gemeinsam/aktivitaet.mjs): wer hat wann was abgelegt, geändert, wurde abgewiesen …
// Hier: die API für Glocke und Mitteilungsliste (P8b) und der Hinweis unten rechts (Toast) bei neuen Ereignissen. Gezeichnet wird in hilfen.js (toast) und einstellungen-ki.js (Protokoll).
// Dieses Modul rührt beim Laden nichts im DOM an (Tests laden es auch ohne Seite); `toast` und `api` kommen von außen.
//   const m = erzeugeMitteilungen({ api, toast, beiAnsehen });
//   m.liste({ art, seit, nur, vault, limit }) · m.ungelesen() · m.abonniere(fn) → abmelden · m.markiereGelesen({ ids } | { alle: true })
//   m.rueckgaengig(id | [ids]) · m.verarbeiteLive(ereignisse) · m.ladeNeu() · m.deckt(seitMs)
import { TM } from "./texte-mitteilungen.js";
import { kiLogo, kiLogoId } from "./ki-logos.js";

// Arten des Protokolls (Parität mit gemeinsam/aktivitaet.mjs: Tests/Node/aktivitaet-paritaet.test.mjs)
export const ARTEN = ["ablage-aufgabe", "ablage-notiz", "aenderung", "abweisung", "pflege", "pflege-fehler", "sicherung-konflikt", "sicherung-fehler", "anmeldung-abgelaufen", "rueckgaengig"];
// Schalter der Mitteilungen je Art (Einstellungen → Mitteilungen, einstellungen.json). Gespiegelt aus gemeinsam/aktivitaet.mjs (ART_SCHALTER) und Sources/BrainCore/Mitteilungen.swift.
export const ART_SCHALTER = {
  "ablage-aufgabe": "mitteilungenAbgelegt", "ablage-notiz": "mitteilungenAbgelegt", aenderung: "mitteilungenAbgelegt",
  abweisung: "mitteilungenAbgewiesen",
  "sicherung-konflikt": "mitteilungenSicherung", "sicherung-fehler": "mitteilungenSicherung",
  "pflege-fehler": "mitteilungenRueckfragen", "anmeldung-abgelaufen": "mitteilungenRueckfragen",
  pflege: "mitteilungenPflege",
  rueckgaengig: null, // die Bestätigung eines Klicks: nie eine Mitteilung
};
// Standard der Schalter, solange nichts gespeichert ist
export const SCHALTER_STANDARD = { mitteilungenAbgelegt: true, mitteilungenAbgewiesen: true, mitteilungenSicherung: true, mitteilungenRueckfragen: true, mitteilungenPflege: false };
const ABLAGEN = new Set(["ablage-aufgabe", "ablage-notiz", "aenderung"]);

// Darf zu dieser Art ein Hinweis erscheinen? werte = Werte aus GET /api/einstellungen (unbekannt/fehlend → Standard); unbekannte Arten nie.
export function istArtAn(art, werte) {
  if (!Object.hasOwn(ART_SCHALTER, art)) return false;
  const s = ART_SCHALTER[art];
  if (s === null) return false;
  return typeof werte?.[s] === "boolean" ? werte[s] : SCHALTER_STANDARD[s] === true;
}

// ---------------------------------------------------------------- reine Funktionen
// „wollte … lesen und wurde abgewiesen. Stufe „Gesperrt“ hat gewirkt.“ → { erster (ohne Schlusspunkt), ersterVoll (mit), rest }
export function saetze(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])\s+(\S.*)$/.exec(t);
  const ersterVoll = m ? m[1] : t;
  return { erster: ersterVoll.replace(/[.]+$/, ""), ersterVoll, rest: m ? m[2] : "" };
}
// Art-Familie für das Bündeln: Ablagen und Änderungen je für sich, die übrigen nach ihrem Schalter (Sicherung, Rückfragen …)
export const familie = (art) => (ABLAGEN.has(art) || art === "abweisung" ? art : ART_SCHALTER[art] || art);
// Wohin „Ansehen“ führt: Aufgaben-Board · Posteingang · sonst das Aktivitätsprotokoll (Einstellungen → KI & Konten)
export const zielVon = (art) => (art === "ablage-aufgabe" ? "aufgaben" : art === "ablage-notiz" ? "posteingang" : "protokoll");

// Ereignisse (neueste zuletzt oder beliebig) in Gruppen gleicher (Art-Familie, wer, Vault); die Reihenfolge der ersten Treffer bleibt.
export function gruppiere(ereignisse) {
  const gruppen = new Map();
  for (const e of ereignisse) {
    if (!e || typeof e.art !== "string") continue;
    const k = `${familie(e.art)}|${e.wer || ""}|${e.vaultName || ""}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(e);
  }
  return [...gruppen.values()];
}

// Inhalt eines Hinweises zu einer Gruppe gleichartiger Ereignisse:
//   { fett (wer), text, unter, ziel, programm, abweisung, rueckgaengigIds (nur wenn ALLE zurücknehmbar sind), ids }
export function baueHinweis(gruppe) {
  const e0 = gruppe[0], n = gruppe.length;
  const wer = e0.wer || null;
  const neuester = gruppe[gruppe.length - 1];
  const { erster, rest } = saetze(n === 1 ? e0.text : neuester.text);
  let text;
  if (n === 1) text = erster;
  else if (TM.mehrere[e0.art]) text = TM.mehrere[e0.art](n);
  else text = `${erster} ${TM.weitere(n - 1)}`; // gemischte Hinweise (Sicherung, Rückfragen): der neueste Satz, dazu die Zahl der übrigen
  const unter = [TM.ort[e0.art], e0.vaultName ? TM.vault(e0.vaultName) : null, n === 1 && e0.art === "abweisung" ? rest : null].filter(Boolean).join(" · ");
  const alleZurueck = gruppe.every((e) => e.rueckgaengig === true || e.rueckgaengigMoeglich === true);
  return {
    fett: wer, text, unter: unter || null, ziel: zielVon(e0.art), programm: e0.programm || null, abweisung: e0.art === "abweisung",
    rueckgaengigIds: alleZurueck ? gruppe.map((e) => e.id).filter(Boolean) : [], ids: gruppe.map((e) => e.id).filter(Boolean),
  };
}

// Zeile des Protokolls: { wer, satz (ohne Handelnden), rest (zweiter Satz, z. B. „Stufe … hat gewirkt.“) }
export function zeilenText(e) {
  const { ersterVoll, rest } = saetze(e.text);
  return { wer: e.wer || null, satz: ersterVoll, rest };
}

// Meldung zu einem Fehler des Rückgängig-Wegs (Werkstatt: 404 · 400 · 409 art geaendert | schon-zurueck | nicht-vertraut | kein-vault)
export function rueckgaengigMeldung(e) {
  const art = e?.daten?.art || null, werkstatt = typeof e?.daten?.fehler === "string" && e.daten.fehler ? e.daten.fehler : null;
  if (e?.status === 0) return { art: "verbindung", meldung: TM.keineVerbindung, neutral: false };
  if (art === "geaendert") return { art, meldung: werkstatt || TM.geaendert, neutral: false, rueckfrage: true }; // NICHT löschen: der Nutzer entscheidet
  if (art === "schon-zurueck") return { art, meldung: TM.schonZurueck, neutral: true };
  if (art === "nicht-vertraut") return { art, meldung: werkstatt || TM.nichtVertraut, neutral: false };
  if (art === "kein-vault") return { art, meldung: werkstatt || TM.keinVault, neutral: false };
  if (e?.status === 404) return { art: "unbekannt", meldung: TM.unbekannt, neutral: true };
  if (e?.status === 400) return { art: "nicht-moeglich", meldung: werkstatt || TM.nichtMoeglich, neutral: false };
  return { art: art || "fehler", meldung: werkstatt || TM.allgemein, neutral: false };
}

// Nimmt EINE Ablage zurück. → { ok: true, art: "entfernt" | "schon-weg" } oder { ok: false, art, meldung, neutral, rueckfrage? }. Wirft nie.
export async function fuehreRueckgaengigAus(api, id, vault) {
  try {
    const r = await api.aktivitaetRueckgaengig(id, vault);
    return { ok: true, art: r?.art === "schon-weg" ? "schon-weg" : "entfernt", ...(r?.pfad ? { pfad: r.pfad } : {}) };
  } catch (e) { return { ok: false, ...rueckgaengigMeldung(e) }; }
}

// ---------------------------------------------------------------- die Instanz
// opt: { api, toast, beiAnsehen(ziel, ereignisse), bündelMs (600), bündelMaxMs (3000), schalter (() => Werte, nur Tests) }
export function erzeugeMitteilungen({ api, toast, beiAnsehen, buendelMs = 600, buendelMaxMs = 3000, schalter = null } = {}) {
  const fenster = typeof window !== "undefined" ? window : null;
  const S = { ereignisse: [], ungelesen: 0, gesamt: 0, werte: null, letzteAblage: 0 };
  const abonnenten = new Set();
  const gesehen = new Set();
  const wartend = new Map(); // Schlüssel → { ereignisse, timer, erster }

  function melde() {
    for (const f of [...abonnenten]) { try { f({ ungelesen: S.ungelesen, ereignisse: S.ereignisse }); } catch { /* ein Zuhörer darf die anderen nicht stören */ } }
    try { fenster?.dispatchEvent(new CustomEvent("kortex-aktivitaet")); } catch { /* ohne Fenster */ }
  }
  const abonniere = (fn) => { abonnenten.add(fn); return () => abonnenten.delete(fn); };

  // ---- Abruf
  const ohneFilter = (o) => !o.art && !o.seit && !o.nur && (!o.vault || o.vault !== "alle");
  async function liste(o = {}) {
    const r = await api.aktivitaet(o);
    const ereignisse = Array.isArray(r?.ereignisse) ? r.ereignisse : [];
    // Zähler und Zwischenspeicher folgen nur dem ungefilterten Abruf des offenen Vaults (Glocke und Liste)
    if (ohneFilter(o) && typeof r?.ungelesen === "number") {
      S.ereignisse = ereignisse; S.ungelesen = r.ungelesen; S.gesamt = typeof r.gesamt === "number" ? r.gesamt : ereignisse.length;
      melde();
    }
    return { ...r, ereignisse };
  }
  let ladend = null, nochmal = false;
  async function ladeNeu() {
    if (ladend) { nochmal = true; return ladend; }
    ladend = (async () => {
      try { await liste({ limit: 100 }); } catch { /* ältere Werkstatt oder keine Verbindung: der Stand bleibt */ }
    })();
    try { await ladend; } finally { ladend = null; }
    if (nochmal) { nochmal = false; return ladeNeu(); }
  }

  async function markiereGelesen(o = {}) {
    const daten = o.alle ? { alle: true } : { ids: Array.isArray(o.ids) ? o.ids : [] };
    if (!o.alle && !daten.ids.length) return { ok: true, ungelesen: S.ungelesen };
    const r = await api.aktivitaetGelesen(daten);
    const ids = new Set(daten.ids || []);
    for (const e of S.ereignisse) if (o.alle || ids.has(e.id)) e.gelesen = true;
    S.ungelesen = typeof r?.ungelesen === "number" ? r.ungelesen : o.alle ? 0 : Math.max(0, S.ungelesen - daten.ids.length);
    melde();
    return r;
  }

  // ---- Rückgängig: id oder Liste von ids. Meldet das Ergebnis selbst (Hinweis); gibt die Ergebnisse zurück.
  async function rueckgaengig(ids, { vault, still = false } = {}) {
    const liste_ = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    const ergebnisse = [];
    for (const id of liste_) ergebnisse.push({ id, ...(await fuehreRueckgaengigAus(api, id, vault)) });
    const ok = ergebnisse.filter((x) => x.ok);
    const zurueck = new Set(ok.map((x) => x.id));
    for (const e of S.ereignisse) if (zurueck.has(e.id)) { e.rueckgaengigMoeglich = false; e.zurueckgenommen = new Date().toISOString(); }
    if (ok.length) melde();
    if (!still) {
      const falsch = ergebnisse.find((x) => !x.ok);
      if (!falsch) toast?.(ok.length > 1 ? TM.zurueckMehrere(ok.length) : TM.zurueck, { ms: 3200 });
      else {
        const text = ok.length ? `${TM.teilweise(ok.length, ergebnisse.length)} ${falsch.meldung}` : falsch.meldung;
        const e0 = S.ereignisse.find((x) => x.id === falsch.id);
        toast?.(text, { fehler: !falsch.neutral && !falsch.rueckfrage, ms: falsch.rueckfrage ? 9000 : 6000,
          ...(falsch.rueckfrage ? { aktionen: [{ text: TM.ansehen, tun: () => beiAnsehen?.(zielVon(e0?.art), e0 ? [e0] : []) }] } : {}) });
      }
    }
    return { ok: ergebnisse.length > 0 && ergebnisse.every((x) => x.ok), ergebnisse };
  }

  // ---- Einstellungen (Schalter) für den Hinweis
  async function ladeSchalter() {
    if (schalter) { try { S.werte = schalter() || null; } catch { /* Standard */ } return S.werte; }
    try { const d = await api.einstellungen(); S.werte = d?.werte && typeof d.werte === "object" ? d.werte : S.werte; } catch { /* es gelten die letzten Werte oder der Standard */ }
    return S.werte;
  }

  // ---- Hinweis unten rechts: gleiche (Art-Familie, wer, Vault) innerhalb kurzer Zeit werden EIN Hinweis
  function reihEin(e) {
    const k = `${familie(e.art)}|${e.wer || ""}|${e.vaultName || ""}`;
    let g = wartend.get(k);
    if (!g) { g = { ereignisse: [], erster: Date.now(), timer: null }; wartend.set(k, g); }
    g.ereignisse.push(e);
    clearTimeout(g.timer);
    g.timer = setTimeout(() => zeige(k), Math.max(0, Math.min(buendelMs, buendelMaxMs - (Date.now() - g.erster))));
  }
  async function zeige(k) {
    const g = wartend.get(k);
    if (!g) return;
    wartend.delete(k);
    await ladeSchalter(); // frisch: wer gerade einen Schalter umgelegt hat, soll nicht noch einen Hinweis bekommen
    const erlaubt = g.ereignisse.filter((e) => istArtAn(e.art, S.werte));
    if (!erlaubt.length || typeof toast !== "function") return;
    const hin = baueHinweis(erlaubt);
    const aktionen = [{ text: TM.ansehen, primaer: true, tun: () => beiAnsehen?.(hin.ziel, erlaubt) }];
    if (hin.rueckgaengigIds.length) aktionen.push({ text: TM.rueckgaengig, tun: () => rueckgaengig(hin.rueckgaengigIds) });
    toast(hin.text, { fett: hin.fett, unter: hin.unter, logo: hin.programm && kiLogoId(hin.programm) ? kiLogo(hin.programm, 18, { dekorativ: true }) : null, aktionen, ms: 7000, fehler: hin.abweisung });
  }

  // ---- Live: Ereignisse typ „aktivitaet“ aus dem vorhandenen Strom (die anderen Typen werden übergangen)
  function verarbeiteLive(ereignisse) {
    let neu = false, nachladen = false;
    for (const e of Array.isArray(ereignisse) ? ereignisse : []) {
      if (!e || e.typ !== "aktivitaet") continue;
      if (e.art === "zustand" || e.art === "rueckgaengig") { nachladen = true; continue; } // gelesen / zurückgenommen: der Stand der Werkstatt gilt
      if (!Object.hasOwn(ART_SCHALTER, e.art)) continue;
      if (e.id && gesehen.has(e.id)) continue; // dasselbe Ereignis zweimal gemeldet
      if (e.id) gesehen.add(e.id);
      if (ABLAGEN.has(e.art)) S.letzteAblage = Date.now();
      // Steht es schon in der Liste (ein Abruf war schneller als die Meldung), zählt es nicht doppelt; den Hinweis bekommt es trotzdem
      if (!e.id || !S.ereignisse.some((x) => x.id === e.id)) {
        S.ereignisse = [{
          id: e.id, art: e.art, zeit: e.zeit || new Date().toISOString(), wer: e.wer, text: e.text, programm: e.programm ?? null, konto: e.konto ?? null, vaultName: e.vaultName, pfade: e.pfade,
          grund: e.grund, gelesen: false, rueckgaengigMoeglich: e.rueckgaengig === true, zurueckgenommen: null,
        }, ...S.ereignisse].slice(0, 200);
        S.ungelesen++; S.gesamt++;
        neu = true;
      }
      if (ART_SCHALTER[e.art] !== null) reihEin(e);
    }
    if (neu) melde();
    if (nachladen) ladeNeu();
  }
  // Hat in den letzten `seitMs` Millisekunden ein Ablage-Ereignis den Pfad schon abgedeckt? (dann braucht der alte Hinweis „Claude hat eine Aufgabe angelegt“ nicht mehr zu kommen)
  const deckt = (seitMs) => S.letzteAblage > seitMs;

  fenster?.addEventListener("kortex-einstellungen", () => { ladeSchalter(); });

  return { liste, ungelesen: () => S.ungelesen, abonniere, markiereGelesen, rueckgaengig, verarbeiteLive, ladeNeu, ladeSchalter, deckt, ereignisse: () => S.ereignisse };
}
