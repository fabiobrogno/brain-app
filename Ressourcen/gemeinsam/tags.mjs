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
const TEIL = "[\\p{L}\\p{N}_-]+";
const NAME = `${TEIL}(?:\\/${TEIL})*`;
const NAME_GANZ = new RegExp(`^${NAME}$`, "u");
const TAG_IM_TEXT = new RegExp(`(?<=^|[\\s(,;])#(${NAME})`, "gu");
const TOKEN = new RegExp(`(#?)(${NAME})`, "gu");
const KOPF_SCHLUESSEL = /^(tags|tag|schlagworte|keywords)\s*:(.*)$/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const UEBERSCHRIFT = /^ {0,3}#{1,6}(?:[ \t]|$)/;

export const schluesselVon = (tag) => String(tag).normalize("NFC").toLowerCase();
const istTag = (n) => n.length <= TAG_MAX && /[^\p{N}\/]/u.test(n) && NAME_GANZ.test(n);

// Prüft einen vom Nutzer eingegebenen Tag-Namen → bereinigter Name (ohne #) oder null.
export function pruefeTagName(roh) {
  if (typeof roh !== "string") return null;
  const n = roh.normalize("NFC").trim().replace(/^#/, "");
  return istTag(n) ? n : null;
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
      for (let j = 1; j < ende; j++) {
        const z = zeilen[j];
        let wertAb = -1;
        const m = KOPF_SCHLUESSEL.exec(z.replace(/\r$/, ""));
        if (m) {
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
          aus.push({ von, bis: von + t[2].length, tag: t[2], wo: "kopf" });
        }
      }
      start = ende + 1;
    }
  }

  // ---- Text ----
  const st = { kommentar: false };
  let offen = null;
  for (i = start; i < zeilen.length; i++) {
    const z0 = zeilen[i];
    const f = FENCE.exec(z0);
    if (offen) { if (f && f[1][0] === offen.z && f[1].length >= offen.n && !z0.slice(f[0].length).trim()) offen = null; continue; }
    if (f) { offen = { z: f[1][0], n: f[1].length }; continue; }
    if (!z0.includes("#") && !z0.includes("<!--") && !st.kommentar) continue;
    if (!st.kommentar && UEBERSCHRIFT.test(z0)) continue;
    const z = maskiere(z0, st);
    if (!z.includes("#")) continue;
    for (const m of z.matchAll(TAG_IM_TEXT)) {
      if (!istTag(m[1])) continue;
      const von = off[i] + m.index + 1;
      aus.push({ von, bis: von + m[1].length, tag: m[1], wo: "text" });
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
const unter = (t, alt) => { const a = schluesselVon(t), b = schluesselVon(alt); return a === b ? "" : a.startsWith(b + "/") ? t.slice(alt.length) : null; };

/**
 * Tag `alt` (samt allem darunter) in `neu` umbenennen. → { text, anzahl } — anzahl = ersetzte Stellen; text bleibt gleich, wenn nichts zu tun ist.
 * Die Schreibweise von `neu` wird genau so übernommen; der Rest (Zeilenenden, Quotes, Kommentare) bleibt bytegleich.
 */
export function benenneTagUm(text, alt, neu) {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stellen = findeTags(text).filter((s) => unter(s.tag, alt) !== null);
  if (!stellen.length) return { text, anzahl: 0 };
  let aus = "", ab = 0;
  for (const s of stellen) {
    aus += text.slice(ab, s.von + bom) + neu + unter(s.tag, alt);
    ab = s.bis + bom;
  }
  aus += text.slice(ab);
  return { text: aus, anzahl: stellen.length };
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
/**
 * Tag-Index eines Vaults: liest jede Notiz nur neu, wenn sich Änderungszeit oder Größe ändern. Kein Beobachter, keine Hintergrundarbeit.
 * deps: { wurzel (echter Pfad), gesperrt(name), generiert(rel), ueberspringeOrdner(abs), bearbeitbar: RegExp }
 */
export function erzeugeTagIndex({ wurzel, gesperrt = () => false, generiert = () => false, ueberspringeOrdner = () => false, bearbeitbar = /\.(md|txt)$/i }) {
  const cache = new Map(); // rel → { k, tags }
  let letzter = null, letzteZeit = 0;
  function lauf() {
    const gesehen = new Set(), aus = [];
    const geh = (rel) => {
      const abs = rel ? join(wurzel, rel) : wurzel;
      let liste; try { liste = readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const d of liste) {
        if (gesperrt(d.name)) continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        const a = join(abs, d.name);
        if (d.isDirectory()) { if (!ueberspringeOrdner(a)) geh(r); continue; }
        if (!bearbeitbar.test(d.name)) continue;
        let st;
        try { if (d.isSymbolicLink()) { const echt = realpathSync(a); if (!echt.startsWith(wurzel)) continue; st = statSync(echt); } else st = statSync(a); } catch { continue; }
        if (!st.isFile() || st.size > MAX_BYTES) continue;
        const k = `${st.mtimeMs}:${st.size}`;
        let c = cache.get(r);
        if (!c || c.k !== k) { let t; try { t = readFileSync(a, "utf8"); } catch { continue; } c = { k, tags: generiert(r, a) ? [] : extrahiereTags(t) }; cache.set(r, c); }
        gesehen.add(r);
        aus.push({ pfad: r, tags: c.tags });
      }
    };
    geh("");
    for (const r of cache.keys()) if (!gesehen.has(r)) cache.delete(r);
    return aus;
  }
  // frisch: nach eigenen Schreibvorgängen; sonst gilt ein Lauf 0,3 s lang (mehrere Anfragen der Oberfläche in einem Zug)
  function eintraege({ frisch = false } = {}) {
    if (frisch || !letzter || Date.now() - letzteZeit > 300) { letzter = lauf(); letzteZeit = Date.now(); }
    return letzter;
  }
  return {
    eintraege,
    liste: (o) => zaehleTags(eintraege(o)),
    // Notizen, die den Tag (oder einen darunter) tragen: [{ pfad, tags }]
    notizen: (tag, o) => eintraege(o).filter((e) => e.tags.some((t) => unter(t, tag) !== null)),
  };
}
