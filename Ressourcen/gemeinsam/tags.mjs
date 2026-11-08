// gemeinsam/tags.mjs — Tags einer Notiz erkennen, im ganzen Vault zählen und umbenennen. Rein (Text rein, Text raus) bis auf den Tag-Index, der den Vault liest.
//
// Was ein Tag ist (EINE Regel für Seitenleiste, Vervollständigung, Suche `tag:` und MCP):
//   · Front-Matter: Schlüssel tags / tag / schlagworte / keywords. Wert als Liste ([a, b]), Blockliste (- a) oder Text (a, b · a b). Ein führendes # ist erlaubt.
//   · Im Text: #tag, auch verschachtelt (#projekt/atlas). Zeichen: Buchstaben (Unicode), Ziffern, _ und -, getrennt durch / ohne leere Teile. Ein Tag aus Ziffern allein (#123) ist keiner.
//     Vor dem # steht Zeilenanfang, Leerraum oder ( , ; — nie ein Wort- oder URL-Zeichen (Seite#abschnitt, &#39;, a#b).
//   · Nicht gezählt: Code-Zäune (``` und ~~~), Code in `Backticks`, Überschriften (# Titel), Links ([Text](url#teil), https://…#teil), [[Wiki#Abschnitt]], <html>, <!-- Kommentare -->, \#maskiert.
//   · Groß/klein ist egal (#Atlas = #atlas); angezeigt wird die häufigste Schreibweise. Ein verschachtelter Tag zählt auch für seine Eltern (#a/b zählt für a).
import { readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseKopf } from "./notizen.mjs";

export const TAG_MAX = 100;
const TEIL = "[\\p{L}\\p{N}_-][\\p{L}\\p{M}\\p{N}_-]*"; // Marken (\\p{M}, z. B. NFD-Umlaute) gehören dazu, aber nie an den Anfang
const NAME = `${TEIL}(?:\\/${TEIL})*`;
const NAME_GANZ = new RegExp(`^${NAME}$`, "u");
const TAG_IM_TEXT = new RegExp(`(?<=^|[\\s(,;])#(${NAME})`, "gu");
const TOKEN = new RegExp(`(#?)(${NAME})`, "gu");
const KOPF_SCHLUESSEL = /^(tags|tag|schlagworte|keywords)\s*:(.*)$/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const UEBERSCHRIFT = /^ {0,3}#{1,6}(?:[ \t]|$)/;

export const schluesselVon = (tag) => String(tag).normalize("NFC").toLowerCase();
const istTag = (n) => n.normalize("NFC").length <= TAG_MAX && /[^\p{N}\p{M}\/]/u.test(n) && NAME_GANZ.test(n);

// Prüft einen vom Nutzer eingegebenen Tag-Namen → bereinigter Name (ohne #) oder null.
export function pruefeTagName(roh) {
  if (typeof roh !== "string") return null;
  const n = roh.normalize("NFC").trim().replace(/^#/, "");
  return istTag(n) ? n : null; // der Name kommt immer als NFC zurück
}

// Zeile unbrauchbar machen, wo ein # kein Tag sein kann (gleiche Länge, damit die Positionen stimmen)
const platt = (s) => "x".repeat(s.length);
function maskiere(z, st) {
  if (st.kommentar) {
    const e = z.indexOf("-->");
    if (e < 0) return platt(z);
    st.kommentar = false;
    z = platt(z.slice(0, e + 3)) + z.slice(e + 3);
  }
  if (z.includes("<!--")) {
    z = z.replace(/<!--[\s\S]*?-->/g, platt);
    const o = z.indexOf("<!--");
    if (o >= 0) { st.kommentar = true; z = z.slice(0, o) + platt(z.slice(o)); }
  }
  if (z.includes("`")) z = z.replace(/(`+)[\s\S]*?\1/g, platt);
  if (z.includes("[[")) z = z.replace(/\[\[[^\]\n]*\]\]/g, platt);
  if (z.includes("](")) z = z.replace(/\]\([^)\n]*\)/g, platt);
  if (z.includes("://") || z.includes("www.")) z = z.replace(/(?:https?:\/\/|www\.)[^\s<>)\]]+/g, platt);
  if (z.includes("<")) z = z.replace(/<[^>\n]*>/g, platt);
  if (z.includes("\\#")) z = z.replace(/\\#/g, "xx");
  return z;
}

/**
 * Alle Tag-Stellen eines Textes: [{ von, bis, tag, wo: "kopf" | "text" }] — von/bis sind Positionen des Namens ohne # im Text.
 * Die Reihenfolge entspricht dem Text.
 */
export function findeTags(text) {
  if (typeof text !== "string" || (!text.includes("#") && !/tag|schlagwort|keyword/i.test(text.slice(0, 4000)))) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const aus = [];
  const zeilen = text.split("\n");
  let pos = 0, i = 0;
  const off = [];
  for (const z of zeilen) { off.push(pos); pos += z.length + 1; }

  // ---- Kopf ----
  let start = 0;
  if (/^---[ \t]*\r?$/.test(zeilen[0] ?? "")) {
    let ende = -1;
    for (let j = 1; j < zeilen.length; j++) if (/^(---|\.\.\.)[ \t]*\r?$/.test(zeilen[j])) { ende = j; break; }
    if (ende > 0) {
      let modus = null; // "block" | "liste"
      let feld = -1;
      for (let j = 1; j < ende; j++) {
        const z = zeilen[j];
        let wertAb = -1;
        const m = KOPF_SCHLUESSEL.exec(z.replace(/\r$/, ""));
        if (m) {
          feld = j;
          wertAb = z.indexOf(":") + 1;
          const w = m[2].trim();
          modus = w === "" ? "block" : w.startsWith("[") && !/\]\s*(#.*)?$/.test(w) ? "liste" : null;
        } else if (modus === "block") {
          if (/^\s*-(\s|$)/.test(z)) wertAb = z.indexOf("-") + 1;
          else if (z.trim() !== "") modus = null;
        } else if (modus === "liste") {
          wertAb = 0;
          if (/\]/.test(z)) modus = null;
        }
        if (wertAb < 0) continue;
        let wert = z.slice(wertAb).replace(/\r$/, "");
        const k = /\s#\s.*$|\s#$/.exec(wert); // YAML-Kommentar (# nach Leerraum, selbst gefolgt von Leerraum)
        if (k) wert = wert.slice(0, k.index);
        for (const t of wert.matchAll(TOKEN)) {
          if (!istTag(t[2])) continue;
          const von = off[j] + wertAb + t.index + t[1].length;
          aus.push({ von, bis: von + t[2].length, tag: t[2].normalize("NFC"), wo: "kopf", feld, hash: t[1] === "#" });
        }
      }
      start = ende + 1;
    }
  }

  // ---- Text ----
  const st = { kommentar: false };
  let offen = null, html = null; // html: { bis: "</pre>" | null } — null = bis zur Leerzeile
  let davorLeer = true, davorCode = false, liste = false;
  for (i = start; i < zeilen.length; i++) {
    const z0 = zeilen[i];
    const f = FENCE.exec(z0);
    if (offen) { if (f && f[1][0] === offen.z && f[1].length >= offen.n && !z0.slice(f[0].length).trim()) offen = null; continue; }
    if (f) { offen = { z: f[1][0], n: f[1].length }; davorLeer = false; continue; }
    const leer = !z0.trim();
    // HTML-Block (<pre>, <script>, <style>, <textarea> bis zum Schluss-Tag; <div>, <table> … bis zur Leerzeile): nie gelesen, nie umgeschrieben
    if (html) {
      if (html.bis ? new RegExp(html.bis, "i").test(z0) : leer) html = null;
      davorLeer = leer; continue;
    }
    const hm = !leer && /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i.exec(z0);
    if (hm) { if (!new RegExp(`</${hm[1]}>`, "i").test(z0)) html = { bis: `</${hm[1]}>` }; davorLeer = false; continue; }
    if (!leer && /^ {0,3}<\/?(div|details|table|section|article|aside|blockquote|center|figure|form|header|footer|nav|ul|ol|dl)(?=[\s>/]|$)/i.test(z0)) { if (!/<\/(div|details|table|section|article|aside|blockquote|center|figure|form|header|footer|nav|ul|ol|dl)>\s*$/i.test(z0)) html = { bis: null }; davorLeer = false; continue; }
    // eingerückter Code: 4 Leerzeichen oder Tab nach einer Leerzeile (oder Code davor), nie innerhalb einer Liste (dort ist die Einrückung Listeninhalt)
    const eingerueckt = /^(?: {4}|\t)/.test(z0) && !leer;
    if (eingerueckt && (davorLeer || davorCode) && !liste) { davorCode = true; davorLeer = false; continue; }
    davorCode = false;
    if (leer) { davorLeer = true; continue; }
    davorLeer = false;
    if (/^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(z0)) liste = true;
    else if (!/^\s/.test(z0)) liste = false;
    if (!z0.includes("#") && !z0.includes("<!--") && !st.kommentar) continue;
    if (!st.kommentar && UEBERSCHRIFT.test(z0)) continue;
    const z = maskiere(z0, st);
    if (!z.includes("#")) continue;
    for (const m of z.matchAll(TAG_IM_TEXT)) {
      if (!istTag(m[1])) continue;
      const von = off[i] + m.index + 1;
      aus.push({ von, bis: von + m[1].length, tag: m[1].normalize("NFC"), wo: "text" });
    }
  }
  return aus;
}

// Eindeutige Tags einer Notiz in Textreihenfolge (je Schlüssel die erste Schreibweise)
export function extrahiereTags(text) {
  const gesehen = new Map();
  for (const s of findeTags(text)) { const k = schluesselVon(s.tag); if (!gesehen.has(k)) gesehen.set(k, s.tag); }
  return [...gesehen.values()];
}

// Gehört der Tag `t` zu `alt` (gleich oder darunter)? → Rest nach `alt` (leer oder "/…") oder null
const unter = (t, alt) => { const a = schluesselVon(t), b = schluesselVon(alt); return a === b ? "" : a.startsWith(b + "/") ? t.slice(alt.normalize("NFC").length) : null; };

/**
 * Tag `alt` (samt allem darunter) in `neu` umbenennen. → { text, anzahl } — anzahl = ersetzte Stellen; text bleibt gleich, wenn nichts zu tun ist.
 * Die Schreibweise von `neu` wird genau so übernommen; der Rest (Zeilenenden, Quotes, Kommentare) bleibt bytegleich.
 */
export function benenneTagUm(text, alt, neu) {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const alle = findeTags(text);
  const stellen = alle.filter((s) => unter(s.tag, alt) !== null);
  if (!stellen.length) return { text, anzahl: 0 };
  const neuTag = (s) => neu + unter(s.tag, alt);
  // Zusammenführen: steht der neue Tag in derselben Liste im Kopf schon (oder wird er dort doppelt), entfällt der umbenannte Eintrag
  const weg = new Set();
  const ersetzt = new Set(stellen);
  const feste = new Map(); // Feld → Schlüssel der nicht umbenannten Einträge
  for (const s of alle) if (s.wo === "kopf" && !ersetzt.has(s)) { if (!feste.has(s.feld)) feste.set(s.feld, new Set()); feste.get(s.feld).add(schluesselVon(s.tag)); }
  const gesehen = new Map();
  for (const s of stellen) {
    if (s.wo !== "kopf") continue;
    const k = schluesselVon(neuTag(s));
    if (!gesehen.has(s.feld)) gesehen.set(s.feld, new Set());
    if ((feste.get(s.feld) || new Set()).has(k) || gesehen.get(s.feld).has(k)) weg.add(s); else gesehen.get(s.feld).add(k);
  }
  let aus = "", ab = 0, anzahl = 0;
  for (const s of stellen) {
    anzahl++;
    let von = s.von + bom, bis = s.bis + bom;
    if (weg.has(s)) {
      // den ganzen Eintrag samt # und Anführungszeichen und einem Komma entfernen; ein Listenpunkt (- tag) verschwindet mit seiner Zeile
      if (s.hash) von--;
      if (/["']/.test(text[von - 1] || "") && text[von - 1] === text[bis]) { von--; bis++; }
      const zStart = text.lastIndexOf("\n", von - 1) + 1;
      let zEnde = text.indexOf("\n", bis); if (zEnde < 0) zEnde = text.length;
      if (/^\s*-\s*$/.test(text.slice(zStart, von)) && !text.slice(bis, zEnde).trim()) { von = zStart; bis = Math.min(text.length, zEnde + 1); }
      else {
        const nach = /^[ \t]*,[ \t]*/.exec(text.slice(bis));
        const davor = /,[ \t]*$/.exec(text.slice(0, von));
        if (nach) bis += nach[0].length; else if (davor) von -= davor[0].length;
      }
      aus += text.slice(ab, von);
      ab = bis;
      continue;
    }
    aus += text.slice(ab, von) + neuTag(s);
    ab = bis;
  }
  aus += text.slice(ab);
  return { text: aus, anzahl };
}

/**
 * Zählt Tags über viele Notizen. eintrag: [{ pfad, tags }] → { tags: [{ name, anzahl, direkt }], notizen, zuordnung: { pfad: [tag] } }
 *   direkt = Notizen, die genau diesen Tag tragen; anzahl = Notizen mit diesem Tag oder einem darunter. Eltern ohne eigene Notiz stehen mit direkt 0 in der Liste.
 */
export function zaehleTags(eintraege) {
  const direkt = new Map(), gesamt = new Map(), schreib = new Map();
  let mitTags = 0;
  for (const e of eintraege) {
    if (!e.tags.length) continue;
    mitTags++;
    const ds = new Set(), gs = new Set();
    for (const t of e.tags) {
      const teile = t.split("/");
      const k = schluesselVon(t);
      ds.add(k);
      for (let n = 1; n <= teile.length; n++) {
        const name = teile.slice(0, n).join("/"), kk = schluesselVon(name);
        gs.add(kk);
        const s = schreib.get(kk) || new Map(); s.set(name, (s.get(name) || 0) + 1); schreib.set(kk, s);
      }
    }
    for (const k of ds) direkt.set(k, (direkt.get(k) || 0) + 1);
    for (const k of gs) gesamt.set(k, (gesamt.get(k) || 0) + 1);
  }
  const tags = [...gesamt].map(([k, anzahl]) => {
    const s = [...schreib.get(k)].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return { name: s[0][0], anzahl, direkt: direkt.get(k) || 0 };
  }).sort((a, b) => schluesselVon(a.name).localeCompare(schluesselVon(b.name), "de"));
  const zuordnung = {};
  for (const e of eintraege) if (e.tags.length) zuordnung[e.pfad] = e.tags;
  return { tags, notizen: mitTags, zuordnung };
}

const MAX_BYTES = 1024 * 1024;
const SCHEIBE_MS = 6;         // so lange arbeitet der erste Lauf am Stück; dann kommen andere Anfragen dran
const TTL_MS = 30_000;        // ohne Änderungsmeldung (z. B. im MCP-Server) gleicht ein Lauf höchstens alle 30 s nach
const warte = () => new Promise((ok) => setImmediate(ok));
/**
 * Tag-Index eines Vaults: hält je Notiz die Tags im Speicher und bleibt über Änderungsmeldungen aktuell — wie der Suchindex (#92):
 *   · aendere(rel | [rel]) — eine Notiz wurde geschrieben, angelegt, umbenannt oder gelöscht: nur sie wird neu gelesen (kein Gang durch den Vault).
 *   · markiereVoll() — „alles“-Ereignis (Versionswechsel, Ordner): der nächste Zugriff gleicht alle Dateien nach Änderungszeit und Größe ab.
 *   · Der erste Lauf und jeder Abgleich arbeiten in Scheiben von 6 ms mit setImmediate dazwischen; Anfragen warten höchstens eine Scheibe.
 *   · Die Zählung (liste) wird bis zur nächsten Änderung gemerkt.
 * deps: { wurzel (echter Pfad), gesperrt(name), generiert(rel, abs), ueberspringeOrdner(abs), bearbeitbar: RegExp }
 */
export function erzeugeTagIndex({ wurzel, gesperrt = () => false, generiert = () => false, ueberspringeOrdner = () => false, bearbeitbar = /\.(md|txt)$/i }) {
  const cache = new Map(); // rel → { k, tags }
  let voll = true, lauf = null, zeit = 0, zaehlung = null;
  const lies = (rel, abs, st) => {
    const k = `${st.mtimeMs}:${st.size}`;
    const c = cache.get(rel);
    if (c && c.k === k) return c;
    let t; try { t = readFileSync(abs, "utf8"); } catch { return null; }
    const neu = { k, tags: generiert(rel, abs) ? [] : extrahiereTags(t) };
    cache.set(rel, neu);
    return neu;
  };
  function statVon(abs, d) {
    try {
      if (!d || d.isSymbolicLink()) { const echt = realpathSync(abs); if (!echt.startsWith(wurzel)) return null; const st = statSync(echt); return st.isFile() ? st : null; }
      const st = statSync(abs); return st.isFile() ? st : null;
    } catch { return null; }
  }
  // Eine Notiz neu lesen (oder vergessen, wenn sie weg ist)
  function aendere(rels) {
    for (const rel of Array.isArray(rels) ? rels : [rels]) {
      if (typeof rel !== "string" || !bearbeitbar.test(rel) || rel.split("/").some(gesperrt)) continue;
      const abs = join(wurzel, ...rel.split("/"));
      const st = statVon(abs, null);
      cache.delete(rel); // neu einlesen, auch wenn Zeit und Größe zufällig gleich blieben
      if (st && st.size <= MAX_BYTES) lies(rel, abs, st);
    }
    zaehlung = null;
  }
  async function abgleich() {
    const gesehen = new Set();
    let t0 = Date.now();
    const stapel = [""];
    while (stapel.length) {
      const rel = stapel.pop();
      const abs = rel ? join(wurzel, rel) : wurzel;
      let liste; try { liste = readdirSync(abs, { withFileTypes: true }); } catch { continue; }
      for (const d of liste) {
        if (gesperrt(d.name)) continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        const a = join(abs, d.name);
        if (d.isDirectory()) { if (!ueberspringeOrdner(a)) stapel.push(r); continue; }
        if (!bearbeitbar.test(d.name)) continue;
        const st = statVon(a, d);
        if (!st || st.size > MAX_BYTES) continue;
        if (lies(r, a, st)) gesehen.add(r);
        if (Date.now() - t0 > SCHEIBE_MS) { await warte(); t0 = Date.now(); }
      }
      if (Date.now() - t0 > SCHEIBE_MS) { await warte(); t0 = Date.now(); }
    }
    for (const r of cache.keys()) if (!gesehen.has(r)) cache.delete(r);
    zaehlung = null;
  }
  // Bereit machen: beim ersten Mal, nach markiereVoll() und nach 30 s ohne Meldung gleicht ein Lauf ab; gleichzeitige Aufrufer teilen ihn
  async function bereit() {
    if (!voll && Date.now() - zeit <= TTL_MS) return;
    if (!lauf) lauf = abgleich().then(() => { voll = false; zeit = Date.now(); }).finally(() => { lauf = null; });
    await lauf;
  }
  const eintraege = () => [...cache].map(([pfad, c]) => ({ pfad, tags: c.tags }));
  return {
    aendere, bereit,
    markiereVoll() { voll = true; },
    async liste({ zuordnung = false } = {}) {
      await bereit();
      if (!zaehlung) zaehlung = zaehleTags(eintraege());
      if (zuordnung) return zaehlung;
      const { zuordnung: _z, ...ohne } = zaehlung;
      return ohne;
    },
    // Notizen, die den Tag (oder einen darunter) tragen: [{ pfad, tags }]
    async notizen(tag) { await bereit(); return eintraege().filter((e) => e.tags.some((t) => unter(t, tag) !== null)); },
  };
}
