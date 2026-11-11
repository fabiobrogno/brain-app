// gemeinsam/erwaehnungen-index.mjs — ungelinkte Erwähnungen über den Suchindex (gemeinsam/suchindex.mjs, #92). Die Regeln des Findens stehen in erwaehnungen.mjs.
//
// Zwei Richtungen, beide ohne KI:
//   · erwaehnungen(pfad)  „Wo steht der Titel/Alias DIESER Notiz in anderen Notizen, ohne Link?“
//       1. Aus den Titeln und Aliassen dieser Notiz werden Wortgruppen. Der Suchindex nennt aus dem Speicher alle Notizen, die diese Wörter enthalten (Kandidaten, kein Plattenzugriff).
//       2. Nur die Kandidaten werden gelesen und genau geprüft (neueste zuerst, höchstens `budgetMs` je Aufruf, höchstens 1500 Dateien). Das Ergebnis je Datei wird mit
//          Änderungszeit und Größe gemerkt: eine unveränderte Datei wird nie ein zweites Mal gelesen. Ist das Zeitbudget aufgebraucht, nennt die Antwort `offen` (noch ungeprüfte
//          Kandidaten); der nächste Aufruf macht dort weiter. So bleibt jeder Aufruf kurz, auch bei 20.000 Notizen und einem häufigen Wort als Titel.
//   · erwaehntVon(pfad, text)  „Welche Titel anderer Notizen stehen in DIESEM Text, ohne Link?“ Der Text kommt vom Aufrufer (auch ungespeicherte Eingaben). Dafür hält der Namenssatz die
//       gefalteten Namen aller Notizen im Speicher; er führt sich über den Suchindex selbst fort (neue Einträge hängen nur hinten an) und baut sich in Scheiben von wenigen Millisekunden auf.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MODI, MAX_TREFFER, namenEinerNotiz, baueAbgleicher, findeNamen, stellenAus, linkFuer, findeWieder, setzeLinks, zeilenStarts } from "./erwaehnungen.mjs";
import { HttpFehler } from "./basis.mjs";
import { baueWikiIndex, linkText, ordnerVonPfad } from "./wikilink.mjs";

export const MAX_TEXT = 256 * 1024;      // größere Notizen werden nicht nach Erwähnungen durchsucht (ein Durchlauf bliebe nicht im Zeitbudget)
const MAX_BYTES = MAX_TEXT;
const MAX_ALLE_DATEIEN = 200, MAX_ALLE_BYTES = 20 * 1024 * 1024; // „Alle verlinken“: so viel auf einmal (Journal!)
const MAX_KANDIDATEN = 1500;
const MAX_STELLEN_JE_NOTIZ = 8;
const MAX_NOTIZEN_ANZEIGE = 60;
const CACHE_MAX = 6000;
const SCHEIBE_MS = 6;
const HASH = (buf) => createHash("sha256").update(buf).digest("hex");
const stamm = (rel) => rel.split("/").pop().replace(/\.(md|txt)$/i, "");

// ───────────────────────────── Namenssatz ─────────────────────────────
class Namenssatz {
  constructor(ziel) { this.ziel = ziel; this.leere(); }
  leere() {
    this.epoche = 0; this.bis = 0; this.warte = []; this.tot = -1;
    this.nach = new Map();                                     // rel → { rel, nr, titel, aliasse, namen: [...], ziel: bool }
    this.erst = { ae: new Map(), a: new Map() };               // erstes Wort → [{ id: rel, name, folge, luecken }] (lazy sortiert)
    this.besitzer = { ae: new Map(), a: new Map() };           // Folge → Set(rel)
    this.schmutzig = new Set();
    this.fertig = false;
  }
  entferne(rel) {
    const e = this.nach.get(rel);
    if (!e) return;
    this.nach.delete(rel);
    for (const n of e.namen) for (const m of MODI) {
      const folge = n.seq[m], k = folge.join(" ");
      const l = this.erst[m].get(folge[0]);
      if (l) { const neu = l.filter((x) => x.id !== rel); if (neu.length) this.erst[m].set(folge[0], neu); else this.erst[m].delete(folge[0]); }
      const b = this.besitzer[m].get(k);
      if (b) { b.delete(rel); if (!b.size) this.besitzer[m].delete(k); }
    }
  }
  fuegeEin(d) {
    this.entferne(d.rel);
    const namen = this.ziel(d.rel) ? namenEinerNotiz({ titel: d.titel, aliasse: d.aliasse }) : [];
    this.nach.set(d.rel, { rel: d.rel, nr: d.nr, titel: d.titel, aliasse: d.aliasse, namen });
    for (const n of namen) for (const m of MODI) {
      const folge = n.seq[m], k = folge.join(" ");
      const l = this.erst[m].get(folge[0]);
      const eintrag = { id: d.rel, name: n, folge, luecken: n.luecken };
      if (l) { l.push(eintrag); this.schmutzig.add(l); } else this.erst[m].set(folge[0], [eintrag]);
      const b = this.besitzer[m].get(k);
      if (b) b.add(d.rel); else this.besitzer[m].set(k, new Set([d.rel]));
    }
  }
  // Abgleicher über ALLE Namen (für die Richtung „diese Notiz erwähnt …“)
  abgleicher() {
    return {
      modi: this.erst,
      ordne: () => { for (const l of this.schmutzig) l.sort((a, b) => b.folge.length - a.folge.length); this.schmutzig.clear(); },
      mehrdeutig: (m, c) => (this.besitzer[m].get(c.folge.join(" "))?.size ?? 0) > 1,
    };
  }
  // Führt den Satz mit dem Suchindex nach, höchstens `ms` Millisekunden. → true, wenn nichts mehr offen ist
  // Ein Stück (200 Notizen) verarbeitet jeder Aufruf immer: Wird der Prozess auf einem ausgelasteten Rechner kurz verdrängt, ist das Budget sonst schon vor dem ersten
  // Stück verbraucht, und der Satz käme nie voran, solange nur kurze Aufrufe kommen.
  sync(idx, ms = SCHEIBE_MS) {
    const t0 = performance.now();
    if (idx.epoche() !== this.epoche) { this.leere(); this.epoche = idx.epoche(); }
    const d = idx.dokumente(this.bis);
    if (d.epoche !== this.epoche) return false;
    this.bis = d.bis;
    if (d.dokumente.length) this.warte.push(...d.dokumente);
    let erstes = true;
    while (this.warte.length) {
      if (!erstes && performance.now() - t0 > ms) { this.fertig = false; return false; }
      erstes = false;
      const stueck = this.warte.splice(0, 200);
      for (const doc of stueck) { if (idx.lebtNr(doc.nr)) this.fuegeEin(doc); }
    }
    this.fertig = idx.istFertig();
    // Tote Einträge (Notiz gelöscht oder ersetzt): prüfen, wenn sich die Zahl der Toten geändert hat
    const st = idx.stand();
    if (st.tot !== this.tot) { this.tot = st.tot; for (const [rel, e] of this.nach) if (!idx.lebtNr(e.nr)) this.entferne(rel); }
    return true;
  }
}

// ───────────────────────────── Erwähnungen ─────────────────────────────
// deps: { wurzel, index: () => Suchindex, darfZiel(rel), darfQuelle(rel) }
export function erzeugeErwaehnungen({ wurzel, index, darfZiel = () => true, darfQuelle = () => true }) {
  const satz = new Namenssatz(darfZiel);
  const cache = new Map(); // `${rel}|${mtime}|${größe}|${namenSchlüssel}` → { hash, stellen }
  let planer = null;
  const wartePause = (ms) => new Promise((ok) => setTimeout(ok, ms));

  async function bereit(fristMs = 350) {
    const ix = index();
    ix.starte();
    const bis = performance.now() + fristMs;
    while (!ix.istFertig() && performance.now() < bis) await wartePause(3);
    return ix;
  }
  // Der Namenssatz baut sich in Scheiben auf, auch ohne Anfrage (setImmediate, solange etwas fehlt; solange der Suchindex noch baut, alle 40 ms nachsehen)
  function waerme() {
    if (planer) return;
    const los = () => {
      planer = null;
      let weiter = false;
      try { const ix = index(); const aufgeholt = satz.sync(ix, SCHEIBE_MS); weiter = !aufgeholt || !ix.istFertig(); planer = weiter ? (aufgeholt ? setTimeout(los, 40) : setImmediate(los)) : null; if (planer?.unref) planer.unref(); } catch { planer = null; }
    };
    planer = setImmediate(los);
  }
  const ruhe = async () => { const ix = index(); ix.starte(); for (let i = 0; i < 20000; i++) { await ix.ruhe(); if (satz.sync(ix, 1000) && ix.istFertig()) return; await wartePause(2); } };
  function beende() { if (planer) { clearImmediate(planer); clearTimeout(planer); planer = null; } satz.leere(); cache.clear(); }

  const merke = (k, v) => { cache.set(k, v); if (cache.size > CACHE_MAX) { let n = 0; for (const key of cache.keys()) { cache.delete(key); if (++n >= CACHE_MAX / 10) break; } } };
  const titelVon = (rel) => satz.nach.get(rel)?.titel || stamm(rel);

  // Längere Namen anderer Notizen, die einen der eigenen Namen als Wortfolge enthalten („Kaffee Maschine“ enthält „Kaffee“)
  function laengere(eigene, selbst) {
    const aus = [];
    for (const [rel, e] of satz.nach) {
      if (rel === selbst) continue;
      for (const n of e.namen) {
        for (const mine of eigene) {
          if (n.laenge <= mine.laenge) continue;
          const f = n.seq.ae, g = mine.seq.ae;
          const i0 = f.indexOf(g[0]);
          if (i0 < 0) continue;
          for (let i = i0; i + g.length <= f.length; i++) { let ok = true; for (let j = 0; j < g.length; j++) if (f[i + j] !== g[j]) { ok = false; break; } if (ok) { aus.push({ id: `fremd:${rel}`, name: n }); i = f.length; break; } }
        }
      }
    }
    return aus;
  }
  // Ein Name, den eine zweite Notiz auch trägt, ist mehrdeutig und wird nie vorgeschlagen
  const eindeutig = (n) => MODI.every((m) => (satz.besitzer[m].get(n.seq[m].join(" "))?.size ?? 0) <= 1);
  function abgleicherFuer(pfad, namen) {
    const eigene = namen.map((n) => ({ id: pfad, name: n }));
    const lang = laengere(namen, pfad);
    return { abgleicher: baueAbgleicher([...eigene, ...lang]), schluessel: namen.map((n) => n.seq.ae.join(" ")).join("|") + "#" + lang.map((l) => l.id + l.name.text).sort().join("|") };
  }

  function liesText(rel) {
    let st, buf;
    try { const abs = join(wurzel, ...rel.split("/")); st = statSync(abs); if (!st.isFile() || st.size > MAX_BYTES) return null; buf = readFileSync(abs); } catch { return null; }
    const text = buf.toString("utf8");
    if (text.includes("�") && Buffer.compare(Buffer.from(text, "utf8"), buf) !== 0) return null;
    return { text, buf, st };
  }

  // ───────── Richtung 1: Wo steht diese Notiz im Klartext? ─────────
  async function erwaehnungen(pfad, { budgetMs = 25, warteMs = 350 } = {}) {
    const ix = await bereit(warteMs);
    const t0 = performance.now();
    waerme();
    satz.sync(ix, 4);
    const eintrag = satz.nach.get(pfad);
    const antwort = (extra) => ({ pfad, titel: eintrag?.titel || stamm(pfad), namen: [], notizen: [], anzahlStellen: 0, anzahlNotizen: 0, offen: 0, abgeschnitten: false, vollstaendig: false,
      aufbau: { index: ix.istFertig(), namen: satz.fertig }, ...extra });
    // Kennt der Namenssatz die Notiz (noch) nicht, ist nichts geprüft: „vollständig“ erst, wenn auch er aufgeholt hat (sonst hört die Oberfläche auf zu fragen)
    if (!eintrag || !eintrag.namen.length) return antwort({ vollstaendig: ix.istFertig() && satz.fertig, namen: [] });
    const namen = eintrag.namen.filter(eindeutig);
    if (!namen.length) return antwort({ vollstaendig: ix.istFertig() && satz.fertig, mehrdeutig: true });
    const gruppen = (n) => n.seq.ae.map((w) => [w]);
    const sammel = new Map();
    for (const n of namen) for (const k of ix.kandidaten(gruppen(n))) if (!sammel.has(k.rel)) sammel.set(k.rel, k);
    let kand = [...sammel.values()].filter((k) => k.rel !== pfad && darfQuelle(k.rel)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const abgeschnitten = kand.length > MAX_KANDIDATEN;
    if (abgeschnitten) kand = kand.slice(0, MAX_KANDIDATEN);
    const { abgleicher, schluessel: namenSchluessel } = abgleicherFuer(pfad, namen);
    const notizen = [];
    let offen = 0, stellenGesamt = 0;
    for (let i = 0; i < kand.length; i++) {
      if (performance.now() - t0 > budgetMs) { offen = kand.length - i; break; }
      const k = kand[i];
      let st; try { st = statSync(join(wurzel, ...k.rel.split("/"))); } catch { continue; }
      const key = `${k.rel}|${st.mtimeMs}|${st.size}|${namenSchluessel}`;
      let c = cache.get(key);
      if (!c) {
        const g = liesText(k.rel);
        if (!g) { merke(key, { hash: null, stellen: [] }); continue; }
        const treffer = findeNamen(g.text, abgleicher, { nurId: pfad });
        c = { hash: HASH(g.buf), anzahl: treffer.length, stellen: treffer.length ? stellenAus(g.text, treffer) : [] };
        merke(key, c);
      }
      if (c.stellen.length) { stellenGesamt += c.anzahl ?? c.stellen.length; notizen.push({ pfad: k.rel, titel: titelVon(k.rel), hash: c.hash, anzahl: c.anzahl ?? c.stellen.length, stellen: c.stellen.slice(0, MAX_STELLEN_JE_NOTIZ) }); }
    }
    return antwort({ namen: namen.map((n) => n.text), notizen: notizen.slice(0, MAX_NOTIZEN_ANZEIGE), anzahlNotizen: notizen.length, anzahlStellen: stellenGesamt, offen, abgeschnitten,
      vollstaendig: offen === 0 && !abgeschnitten && ix.istFertig() && satz.fertig });
  }

  // ───────── Richtung 2: Welche anderen Notizen nennt dieser Text im Klartext? ─────────
  async function erwaehntVon(pfad, text, { warteMs = 350 } = {}) {
    const ix = await bereit(warteMs);
    waerme();
    satz.sync(ix, 6);
    if (text.length > MAX_TEXT) throw new HttpFehler(413, "Diese Notiz ist zu groß, um nach Erwähnungen zu suchen.", { art: "zu-gross" });
    const alle = findeNamen(text, satz.abgleicher()).filter((t) => t.id !== null && t.id !== pfad && satz.nach.get(t.id));
    const treffer = alle.slice(0, MAX_TREFFER);
    const je = new Map();
    const st = stellenAus(text, treffer);
    treffer.forEach((t, i) => { let l = je.get(t.id); if (!l) je.set(t.id, (l = [])); l.push({ ...st[i], ziel: t.id }); });
    const notizen = [...je].map(([rel, stellen]) => ({ pfad: rel, titel: titelVon(rel), anzahl: stellen.length, stellen: stellen.slice(0, MAX_STELLEN_JE_NOTIZ) }));
    return { pfad, notizen: notizen.slice(0, MAX_NOTIZEN_ANZEIGE), anzahlNotizen: notizen.length, anzahlStellen: alle.length, vollstaendig: ix.istFertig() && satz.fertig, aufbau: { index: ix.istFertig(), namen: satz.fertig } };
  }

  // ───────── Verlinken: aus gezeigten Stellen werden neue Texte ─────────
  // ziel: Pfad der erwähnten Notiz · auswahl: [{ pfad, start, treffer, vor, nach, hash }] | "alle" · lies(rel) → { text, buf, hash, ... } aus dateiaktionen (mit Schreibschutz-Prüfung)
  // → { dateien: [{ pfad, text, anzahl, zeilen: [{ zeile, vorher, nachher }] }], uebersprungen: [{ pfad, grund }] }
  // Einzelne Stelle: hat die Notiz noch den Hash der Anzeige, gilt genau diese Stelle; sonst wird sie nur wiedergefunden, wenn ihre Umgebung davor und danach eindeutig ist.
  // „Alle“: nur Notizen, die auch die Liste zeigen würde (≤ 256 KB); höchstens 200 Notizen und 20 MB auf einmal, sonst 413 („in Teilen verlinken“).
  const KONFLIKT_MARKEN = /^<{7}( |$)[\s\S]*^>{7}( |$)/m;
  async function planeVerlinken(ziel, auswahl, lies) {
    const ix = await bereit(1500);
    if (!ix.istFertig()) throw new HttpFehler(409, "Der Suchindex baut noch auf. Bitte gleich noch einmal versuchen.", { art: "index-baut" });
    for (let i = 0; i < 400 && !satz.sync(ix, 15); i++) await wartePause(1);
    const eintrag = satz.nach.get(ziel);
    if (!eintrag || !eintrag.namen.length) return { dateien: [], uebersprungen: [{ pfad: ziel, grund: "hat keinen Namen, der sich verlinken lässt" }] };
    const eigene = eintrag.namen.filter(eindeutig);
    if (!eigene.length) return { dateien: [], uebersprungen: [{ pfad: ziel, grund: "Der Name gehört zu mehreren Notizen und ist nicht eindeutig" }] };
    const { abgleicher } = abgleicherFuer(ziel, eigene);
    const wikiIx = baueWikiIndex([...satz.nach.values()].map((e) => ({ pfad: e.rel, titel: e.titel, aliasse: e.aliasse })));
    const dateien = [], uebersprungen = [];
    let nachPfad, gesamtKandidaten = 0;
    if (auswahl === "alle") {
      const sammel = new Map();
      for (const n of eigene) for (const k of ix.kandidaten(n.seq.ae.map((w) => [w]))) if (!sammel.has(k.rel)) sammel.set(k.rel, k);
      const alle = [...sammel.values()].filter((k) => k.rel !== ziel && darfQuelle(k.rel)).sort((a, b) => b.mtimeMs - a.mtimeMs);
      gesamtKandidaten = alle.length;
      nachPfad = alle.slice(0, MAX_KANDIDATEN).map((k) => ({ pfad: k.rel, stellen: null }));
    } else {
      const je = new Map();
      for (const a of auswahl) { if (!a || typeof a.pfad !== "string" || a.pfad === ziel) continue; (je.get(a.pfad) || je.set(a.pfad, []).get(a.pfad)).push(a); }
      nachPfad = [...je].map(([p, s]) => ({ pfad: p, stellen: s }));
    }
    let bytes = 0, takt = performance.now();
    for (const { pfad, stellen } of nachPfad) {
      if (performance.now() - takt > 20) { await new Promise((ok) => setImmediate(ok)); takt = performance.now(); } // die Werkstatt bleibt ansprechbar
      if (!darfQuelle(pfad)) { uebersprungen.push({ pfad, grund: "wird von Kortex verwaltet" }); continue; }
      let n;
      try { n = lies(pfad); } catch (e) { uebersprungen.push({ pfad, grund: e && e.message ? e.message : "lässt sich nicht lesen" }); continue; }
      if (!n) { uebersprungen.push({ pfad, grund: "lässt sich nicht lesen" }); continue; }
      if (n.buf.length > MAX_TEXT) { if (stellen !== null) uebersprungen.push({ pfad, grund: "ist zu groß" }); continue; }
      if (KONFLIKT_MARKEN.test(n.text)) { uebersprungen.push({ pfad, grund: "enthält Konfliktmarken eines offenen Abgleichs" }); continue; }
      const aktuelle = findeNamen(n.text, abgleicher, { nurId: ziel });
      let gewaehlt;
      if (stellen === null) { if (aktuelle.length > MAX_TREFFER) { uebersprungen.push({ pfad, grund: "hat zu viele Stellen" }); continue; } gewaehlt = aktuelle; }
      else {
        gewaehlt = [];
        for (const s of stellen) {
          const f = typeof s.hash === "string" && s.hash === n.hash ? aktuelle.find((a) => a.start === s.start && a.treffer === s.treffer) : findeWieder(n.text, aktuelle, s);
          if (f && !gewaehlt.includes(f)) gewaehlt.push(f); else if (!f) uebersprungen.push({ pfad, grund: "Die Stelle hat sich inzwischen geändert.", treffer: s.treffer });
        }
      }
      if (!gewaehlt.length) continue;
      const ziele = linkText(wikiIx, ziel, ordnerVonPfad(pfad));
      const sets = gewaehlt.map((g) => ({ start: g.start, ende: g.ende, treffer: g.treffer, link: linkFuer(n.text, g, ziele) }));
      bytes += n.buf.length;
      dateien.push({ pfad, text: setzeLinks(n.text, sets), anzahl: sets.length, zeilen: vorschauZeilen(n.text, gewaehlt, sets), titel: titelVon(pfad) });
      if (auswahl === "alle" && (dateien.length > MAX_ALLE_DATEIEN || bytes > MAX_ALLE_BYTES)) throw new HttpFehler(413, `Das sind zu viele Notizen auf einmal (höchstens ${MAX_ALLE_DATEIEN} Notizen und 20 MB). Bitte in Teilen verlinken: einzelne Stellen oder Notizen nacheinander.`, { art: "zu-viele" });
    }
    return { dateien, uebersprungen, ziel, zielTitel: eintrag.titel, ...(auswahl === "alle" && gesamtKandidaten > MAX_KANDIDATEN ? { abgeschnitten: true, kandidaten: gesamtKandidaten, geprueft: MAX_KANDIDATEN } : {}) };
  }
  // die ersten drei Stellen einer Notiz als Vorher/Nachher-Zeilen
  function vorschauZeilen(text, gewaehlt, sets) {
    return stellenAus(text, gewaehlt.slice(0, 3)).map((a) => {
      const s = sets.find((x) => x.start === a.start);
      return { zeile: a.zeile, vorher: a.auszug, nachher: a.auszug.slice(0, a.markierung[0]) + s.link + a.auszug.slice(a.markierung[1]) };
    });
  }

  // ───────── Verlinken im offenen Text: nichts wird geschrieben; der Editor setzt die Änderungen selbst (und speichert über den sicheren Weg) ─────────
  // stellen: [{ ziel, start, treffer, vor, nach }] | "alle" → { aenderungen: [{ start, ende, link, ziel, zeile, vorher, nachher }], uebersprungen: n } (Positionen im übergebenen Text)
  async function linksFuerText(pfad, text, stellen) {
    const ix = await bereit(1500);
    if (!ix.istFertig()) throw new HttpFehler(409, "Der Suchindex baut noch auf. Bitte gleich noch einmal versuchen.", { art: "index-baut" });
    if (text.length > MAX_TEXT) throw new HttpFehler(413, "Diese Notiz ist zu groß, um nach Erwähnungen zu suchen.", { art: "zu-gross" });
    for (let i = 0; i < 400 && !satz.sync(ix, 15); i++) await wartePause(1);
    const treffer = findeNamen(text, satz.abgleicher()).filter((t) => t.id !== null && t.id !== pfad && satz.nach.get(t.id));
    const wikiIx = baueWikiIndex([...satz.nach.values()].map((e) => ({ pfad: e.rel, titel: e.titel, aliasse: e.aliasse })));
    const vonDir = ordnerVonPfad(pfad);
    const gewaehlt = [];
    let uebersprungen = 0;
    if (stellen === "alle") gewaehlt.push(...treffer);
    else for (const s of stellen) {
      const f = findeWieder(text, treffer.filter((t) => t.id === s.ziel), s);
      if (f && !gewaehlt.includes(f)) gewaehlt.push(f); else if (!f) uebersprungen++;
    }
    const aenderungen = [];
    if (gewaehlt.length > MAX_TREFFER) { uebersprungen += gewaehlt.length - MAX_TREFFER; gewaehlt.length = MAX_TREFFER; }
    const starts = zeilenStarts(text);
    for (const g of gewaehlt) {
      const link = linkFuer(text, { start: g.start, ende: g.ende, treffer: g.treffer }, linkText(wikiIx, g.id, vonDir));
      if (link === null) { uebersprungen++; continue; }
      const [st] = stellenAus(text, [g], starts);
      aenderungen.push({ start: g.start, ende: g.ende, link, ziel: g.id, zeile: st.zeile, vorher: st.auszug, nachher: st.auszug.slice(0, st.markierung[0]) + link + st.auszug.slice(st.markierung[1]) });
    }
    aenderungen.sort((a, b) => a.start - b.start);
    return { aenderungen, uebersprungen };
  }

  return { erwaehnungen, erwaehntVon, linksFuerText, planeVerlinken, ruhe, beende, waerme, stand: () => ({ namen: satz.nach.size, cache: cache.size, fertig: satz.fertig }), satz };
}
