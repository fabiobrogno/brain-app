// ERZEUGT von scripts/erzeuge-gemeinsam-kopien.mjs aus Ressourcen/gemeinsam/kurzformen.mjs — nicht von Hand ändern.
// gemeinsam/kurzformen.mjs — Kurzformen im Text einer Aufgabe: Priorität und Fälligkeit werden beim Tippen erkannt und aus dem Titel genommen.
// Genutzt von der Werkstatt/dem MCP-Werkzeug (brain_aufgabe_anlegen) und vom Studio (Board „Neue Aufgabe“, „Schnell merken“ als Aufgabe).
// Das native Erfassen-Fenster hat dieselbe Logik in Swift (Sources/BrainCore/Erfassen/Kurzformen.swift); BEIDE Tests lesen dieselben Fälle aus
// Tests/Gemeinsam/kurzformen-faelle.json — ändert sich eine Regel, ändert sich der Fall dort, und beide Seiten müssen mitziehen.
// Die Studio-Kopie (Ressourcen/studio/kurzformen.js) erzeugt scripts/erzeuge-gemeinsam-kopien.mjs — nicht von Hand ändern.
//
// Die Regeln sind bewusst eng, damit normaler Text nicht versehentlich etwas auslöst. Sie gelten nur für die ERSTE Zeile (der Titel);
// weitere Zeilen bleiben unverändert als Text der Aufgabe.
//
// Priorität — ein eigenes Wort: `!hoch`, `!normal`, `!niedrig` oder `!!` (= hoch). Es darf überall in der ersten Zeile stehen.
// Fälligkeit — erkannt wird sie in drei Fällen:
//  1. mit Markierung `@`: `@morgen`, `@freitag`, `@12.11.`, `@2026-11-03`;
//  2. nach `bis` oder `fällig` (optional mit `zum`/`am`): `bis morgen`, `fällig Freitag`, `bis zum 12.11.`;
//  3. ohne Markierung ganz am Anfang oder ganz am Ende der Zeile, aber nur als Wort oder ISO-Datum: `morgen Steuer machen`,
//     `Steuer machen übermorgen`, `Zahnarzt anrufen in 3 Tagen`, `Bericht nächste Woche`, `Rechnung 2026-11-03`.
// Erkannte Wörter: `heute`, `morgen`, `übermorgen`, Wochentage (`Montag` … `Sonntag`; immer der NÄCHSTE, auch wenn heute dieser Tag ist),
// `in N Tagen`, `in N Wochen`, `nächste Woche` (= nächster Montag), `JJJJ-MM-TT`, und nur mit `@` oder `bis`/`fällig`: `TT.MM.`
// und `TT.MM.JJJJ` (ohne Jahr: das nächste Mal, dass dieser Tag kommt). Bleibt vom Titel nichts übrig, wird nichts erkannt.
//
// „heute“ ist ein Kalendertag (`JJJJ-MM-TT`) in der Zeitzone des Macs; ihn liefert zeit.mjs (heuteIso). Die Funktionen rechnen nur mit Kalendertagen.
import { heuteIso, plusTageIso, wochentagIso } from "./zeit.js";

/** Die Regeln in einfachen Worten (Hilfe im Fenster); dieselben Sätze wie in Kurzformen.regeln (Swift). */
export const REGELN = [
  "!hoch · !normal · !niedrig · !! — Priorität (überall in der ersten Zeile)",
  "@morgen · @freitag · @12.11. · @2026-11-03 — Fälligkeit mit @",
  "bis morgen · fällig Freitag · bis zum 12.11. — Fälligkeit nach „bis“ oder „fällig“",
  "morgen … oder … übermorgen — heute, morgen, übermorgen, Wochentag, in 3 Tagen, in 2 Wochen, nächste Woche, 2026-11-03: ohne Zeichen nur ganz vorn oder hinten",
];

// ---------- kleine Helfer (wie in Swift: trimmingCharacters, Int(…)) ----------
const kappe = (s, zeichen) => { let a = 0, b = s.length; while (a < b && zeichen.includes(s[a])) a++; while (b > a && zeichen.includes(s[b - 1])) b--; return s.slice(a, b); };
const ganzzahl = (s) => (/^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);
const gueltigesDatum = (j, m, t) => { const d = new Date(Date.UTC(j, m - 1, t)); return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t; }; // 31.02. ergäbe sonst den 3. März
const iso = (j, m, t) => `${String(j).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`;

// ---------- Priorität ----------
function prio(wort) {
  switch (kappe(wort.toLowerCase(), ",.;:")) {
    case "!hoch": case "!!": return "hoch";
    case "!normal": return "normal";
    case "!niedrig": return "niedrig";
    default: return null;
  }
}

// ---------- Fälligkeit ----------
const WOCHENTAGE = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6 };

/** Zeichen am Ende eines Worts, die nicht zum Datumswort gehören. */
const rein = (s, punkt) => kappe(s, punkt ? ",;:!?" : ",;:!?.");

/** Tage bis zum NÄCHSTEN Vorkommen des Wochentags (0 = Sonntag … 6 = Samstag); ist heute dieser Tag, sind es 7. */
function naechster(ziel, heute) {
  const d = (ziel - wochentagIso(heute) + 7) % 7;
  return d === 0 ? 7 : d;
}

function isoDatum(s) {
  const t = s.split("-");
  if (t.length !== 3 || t[0].length !== 4 || t[1].length !== 2 || t[2].length !== 2) return null;
  const j = ganzzahl(t[0]), m = ganzzahl(t[1]), d = ganzzahl(t[2]);
  if (j === null || m === null || d === null || !gueltigesDatum(j, m, d)) return null;
  return s;
}

function deutschesDatum(s, heute) {
  const t = s.split(".");
  if (t[t.length - 1] === "") t.pop(); else if (t.length === 2) return null; // „3.11“ ohne Schlusspunkt: eher eine Versionsnummer
  if (!(t.length === 2 || t.length === 3) || !t.every((x) => x !== "" && /^\d+$/.test(x))) return null;
  const tag = ganzzahl(t[0]), monat = ganzzahl(t[1]);
  if (tag === null || monat === null || t[0].length > 2 || t[1].length > 2) return null;
  const aktuell = Number(heute.slice(0, 4));
  if (t.length === 3) {
    if (!(t[2].length === 2 || t[2].length === 4)) return null;
    let jahr = ganzzahl(t[2]);
    if (jahr === null) return null;
    if (t[2].length === 2) jahr += 2000;
    return gueltigesDatum(jahr, monat, tag) ? iso(jahr, monat, tag) : null;
  }
  for (const jahr of [aktuell, aktuell + 1]) {
    if (gueltigesDatum(jahr, monat, tag)) { const d = iso(jahr, monat, tag); if (d >= heute) return d; }
  }
  return null;
}

/** Ein Datumsausdruck ab Wort `i`; `laenge` = wie viele Wörter er belegt. `numerisch` erlaubt `TT.MM.[JJJJ]`. */
function ausdruck(w, i, numerisch, heute) {
  if (i >= w.length) return null;
  const plus = (tage) => plusTageIso(heute, tage);
  const a = rein(w[i], false).toLowerCase();
  if (a === "heute") return { datum: plus(0), laenge: 1 };
  if (a === "morgen") return { datum: plus(1), laenge: 1 };
  if (a === "übermorgen" || a === "uebermorgen") return { datum: plus(2), laenge: 1 };
  if (Object.hasOwn(WOCHENTAGE, a)) return { datum: plus(naechster(WOCHENTAGE[a], heute)), laenge: 1 };
  // „in 3 Tagen“, „in 2 Wochen“, „nächste Woche“
  if (a === "in" && i + 2 < w.length) {
    const n = rein(w[i + 1], false);
    const einheit = rein(w[i + 2], false).toLowerCase();
    const zahl = n.length <= 3 ? ganzzahl(n) : null;
    if (zahl !== null && zahl >= 1) {
      if (["tag", "tage", "tagen"].includes(einheit)) return { datum: plus(zahl), laenge: 3 };
      if (["woche", "wochen"].includes(einheit)) return { datum: plus(zahl * 7), laenge: 3 };
    }
  }
  if (["nächste", "naechste", "nächsten", "naechsten"].includes(a) && i + 1 < w.length && rein(w[i + 1], false).toLowerCase() === "woche") {
    return { datum: plus(naechster(1, heute)), laenge: 2 };
  }
  const z = rein(w[i], numerisch);
  const d = isoDatum(z);
  if (d) return { datum: d, laenge: 1 };
  if (numerisch) { const dd = deutschesDatum(z, heute); if (dd) return { datum: dd, laenge: 1 }; }
  return null;
}

function faelligIn(w, heute) {
  // 1. mit @ und 2. nach „bis“/„fällig“: erste Fundstelle von links
  for (let i = 0; i < w.length; i++) {
    const wort = w[i];
    if (wort.startsWith("@") && wort.length > 1) {
      const d = ausdruck([wort.slice(1)], 0, true, heute);
      if (d && d.laenge === 1 && w.length > 1) return { datum: d.datum, wort, von: i, bis: i + 1 };
      continue;
    }
    const klein = kappe(wort.toLowerCase(), ":");
    if (!(klein === "bis" || klein === "fällig" || klein === "faellig")) continue;
    let j = i + 1;
    if (j < w.length && ["zum", "am"].includes(w[j].toLowerCase())) j += 1;
    const d = ausdruck(w, j, true, heute);
    if (d && w.length > d.laenge + (j - i)) {
      const bis = j + d.laenge;
      return { datum: d.datum, wort: w.slice(i, bis).join(" "), von: i, bis };
    }
  }
  // 3. ohne Markierung: ganz vorn, sonst ganz hinten
  const vorn = ausdruck(w, 0, false, heute);
  if (vorn && w.length > vorn.laenge) return { datum: vorn.datum, wort: w.slice(0, vorn.laenge).join(" "), von: 0, bis: vorn.laenge };
  for (let i = Math.max(1, w.length - 4); i < w.length; i++) {
    // „bis morgen“ ohne weiteren Text: kein Titel „bis“ mit Datum
    if (["bis", "fällig", "faellig", "zum", "am"].includes(kappe(w[i - 1].toLowerCase(), ":"))) continue;
    const d = ausdruck(w, i, false, heute);
    if (d && i + d.laenge === w.length) return { datum: d.datum, wort: w.slice(i).join(" "), von: i, bis: w.length };
  }
  return null;
}

/**
 * Liest die Kurzformen aus einer Eingabe.
 * @param {string} eingabe  Text (erste nicht leere Zeile = Titel)
 * @param {{heute?: string, prioritaet?: boolean, faellig?: boolean}} [optionen]  heute = Kalendertag „JJJJ-MM-TT“ (Standard: heute in der Zeitzone des Macs)
 * @returns {{titel: string, text: string, prioritaet: string|null, faellig: string|null, prioritaetWort: string|null, faelligWort: string|null}}
 */
export function liesKurzformen(eingabe, { heute, prioritaet: erkennePrio = true, faellig: erkenneFaellig = true } = {}) {
  const tag = typeof heute === "string" && /^\d{4}-\d{2}-\d{2}$/.test(heute) ? heute : heuteIso();
  const leer = { titel: "", text: "", prioritaet: null, faellig: null, prioritaetWort: null, faelligWort: null };
  const zeilen = String(eingabe ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const start = zeilen.findIndex((z) => z.trim() !== "");
  if (start < 0) return leer;
  const ergebnis = { ...leer, text: zeilen.slice(start + 1).join("\n").trim() };
  let woerter = zeilen[start].split(/[ \t]+/).filter((x) => x !== "");

  if (erkennePrio) {
    const uebrig = woerter.filter((x) => prio(x) === null);
    // Besteht die Zeile nur aus Prioritätswörtern, bleibt sie der Titel (nichts erkennen).
    const erstes = woerter.find((x) => prio(x) !== null);
    if (erstes !== undefined && uebrig.length > 0) {
      ergebnis.prioritaet = prio(erstes);
      ergebnis.prioritaetWort = erstes;
      woerter = uebrig;
    }
  }
  if (erkenneFaellig) {
    const t = faelligIn(woerter, tag);
    if (t) {
      ergebnis.faellig = t.datum;
      ergebnis.faelligWort = t.wort;
      woerter = [...woerter.slice(0, t.von), ...woerter.slice(t.bis)];
    }
  }
  ergebnis.titel = woerter.join(" ");
  return ergebnis;
}

/** „heute“, „morgen“ oder „Fr., 31.10.“ (anderes Jahr: „Mo., 04.01.2027“) für ein Datum `JJJJ-MM-TT`; unlesbar → das Datum selbst. */
export function faelligText(isoDatumText, heute) {
  const tag = typeof heute === "string" && /^\d{4}-\d{2}-\d{2}$/.test(heute) ? heute : heuteIso();
  const t = String(isoDatumText).split("-").filter((x) => x !== "").map((x) => ganzzahl(x)).filter((x) => x !== null);
  if (t.length !== 3 || !gueltigesDatum(t[0], t[1], t[2])) return isoDatumText;
  const tage = Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(+tag.slice(0, 4), +tag.slice(5, 7) - 1, +tag.slice(8, 10))) / 86400000);
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  const kurz = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."][wochentagIso(iso(t[0], t[1], t[2]))];
  return `${kurz}, ${String(t[2]).padStart(2, "0")}.${String(t[1]).padStart(2, "0")}.` + (t[0] !== Number(tag.slice(0, 4)) ? String(t[0]) : "");
}
