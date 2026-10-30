// werkstatt/ki-programme/jsonc.mjs — JSON mit Kommentaren und nachgestellten Kommas (JSONC), wie es VS Code, Zed und OpenCode
// in ihren Einstellungen erlauben. Keine Fremdbibliothek.
//   parseJsonc(text)                     → Wert (wirft bei ungültigem Text)
//   setzeEigenschaft(text, pfad, name, wert) → neuer Text: setzt/ersetzt pfad.name und lässt ALLES andere Zeichen für Zeichen stehen
//                                          (Kommentare, Einrückung, Reihenfolge); fehlende Zwischenobjekte werden angelegt
//   entferneEigenschaft(text, pfad, name)    → neuer Text ohne pfad.name (oder derselbe Text, wenn es sie nicht gibt)
// Beide Änderungsfunktionen prüfen ihr Ergebnis selbst: wird der neue Text nicht genau zu dem Wert, den die Änderung am geparsten Wert
// ergäbe, werfen sie — die Datei wird dann nie angefasst.
import { isDeepStrictEqual } from "node:util";

const WS = /\s/;

// ---------- Baum mit Positionen ----------
function scanne(text) {
  let i = 0;
  const fehler = (was) => { throw new SyntaxError(`${was} (Position ${i})`); };
  const ueberspringe = () => {
    for (;;) {
      const c = text[i];
      if (c !== undefined && WS.test(c)) { i++; continue; }
      if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
      if (c === "/" && text[i + 1] === "*") {
        const ende = text.indexOf("*/", i + 2);
        if (ende < 0) fehler("Kommentar nicht beendet");
        i = ende + 2; continue;
      }
      return;
    }
  };
  const zeichenkette = () => {
    const start = i; i++;
    for (;;) {
      const c = text[i];
      if (c === undefined || c === "\n") fehler("Zeichenkette nicht beendet");
      if (c === "\\") { i += 2; continue; }
      i++;
      if (c === '"') break;
    }
    return { typ: "text", start, ende: i, wert: JSON.parse(text.slice(start, i)) };
  };
  const wert = () => {
    ueberspringe();
    const c = text[i];
    if (c === "{") return objekt();
    if (c === "[") return liste();
    if (c === '"') return zeichenkette();
    const start = i;
    while (i < text.length && !WS.test(text[i]) && !",]}/".includes(text[i])) i++;
    if (i === start) fehler("Wert erwartet");
    const roh = text.slice(start, i);
    let v;
    try { v = JSON.parse(roh); } catch { fehler("Ungültiger Wert"); }
    return { typ: "einfach", start, ende: i, wert: v };
  };
  const objekt = () => {
    const start = i; i++;
    const eintraege = [];
    for (;;) {
      ueberspringe();
      if (text[i] === "}") { i++; break; }
      if (text[i] !== '"') fehler("Name erwartet");
      const name = zeichenkette();
      ueberspringe();
      if (text[i] !== ":") fehler("Doppelpunkt erwartet");
      i++;
      const w = wert();
      eintraege.push({ name: name.wert, nameStart: name.start, wert: w });
      ueberspringe();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; break; }
      fehler("Komma oder Klammer erwartet");
    }
    return { typ: "objekt", start, ende: i, eintraege };
  };
  const liste = () => {
    const start = i; i++;
    const elemente = [];
    for (;;) {
      ueberspringe();
      if (text[i] === "]") { i++; break; }
      elemente.push(wert());
      ueberspringe();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; break; }
      fehler("Komma oder Klammer erwartet");
    }
    return { typ: "liste", start, ende: i, elemente };
  };
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const wurzel = wert();
  ueberspringe();
  if (i < text.length) fehler("Unerwartetes Zeichen nach dem Wert");
  return wurzel;
}

const zuWert = (n) => {
  if (n.typ === "objekt") return Object.fromEntries(n.eintraege.map((e) => [e.name, zuWert(e.wert)]));
  if (n.typ === "liste") return n.elemente.map(zuWert);
  return n.wert;
};

export const parseJsonc = (text) => zuWert(scanne(text));

// ---------- Änderungen am Text ----------
const letzterEintrag = (obj, name) => { for (let k = obj.eintraege.length - 1; k >= 0; k--) if (obj.eintraege[k].name === name) return obj.eintraege[k]; return null; };

function knotenAm(wurzel, pfad) {
  let n = wurzel;
  for (const p of pfad) {
    if (!n || n.typ !== "objekt") return null;
    const e = letzterEintrag(n, p);
    if (!e) return null;
    n = e.wert;
  }
  return n;
}

// Zeileneinrückung (Leerzeichen/Tabs) der Zeile, in der `pos` liegt.
function einrueckungVon(text, pos) {
  const zeilenStart = text.lastIndexOf("\n", pos - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(zeilenStart, pos));
  return m ? m[0] : "";
}

// Wert als Text: mehrzeilig mit der Einrückung der Umgebung (`basis`); `einheit` ist eine Einrückungsstufe der Datei.
function serialisiere(wert, basis, einheit) {
  return JSON.stringify(wert, null, einheit).split("\n").join("\n" + basis);
}

function einheitDerDatei(text, wurzel) {
  // Einrückung der ersten Eigenschaft der obersten Ebene, sonst zwei Leerzeichen
  const e = wurzel.eintraege[0];
  if (e) {
    const ein = einrueckungVon(text, e.nameStart);
    const zeilenStart = text.lastIndexOf("\n", e.nameStart - 1) + 1;
    if (ein && text.slice(zeilenStart, e.nameStart) === ein) return ein;
  }
  return "  ";
}

// Fügt `"name": wert` in das Objekt `obj` ein (am Ende, mit Komma passend zu vorhandenen Einträgen).
function fuegeEin(text, obj, name, wert, einheit) {
  const zeileDavor = einrueckungVon(text, obj.start);
  const eigenschaft = `${JSON.stringify(name)}: ${serialisiere(wert, zeileDavor + einheit, einheit)}`;
  if (!obj.eintraege.length) {
    // leeres Objekt (evtl. mit Kommentaren darin): Inhalt zwischen den Klammern bleibt, die Eigenschaft kommt davor
    const innen = text.slice(obj.start + 1, obj.ende - 1);
    if (/^\s*$/.test(innen) && !innen.includes("\n")) return text.slice(0, obj.start + 1) + `\n${zeileDavor + einheit}${eigenschaft}\n${zeileDavor}` + text.slice(obj.ende - 1);
    return text.slice(0, obj.ende - 1).replace(/\s*$/, "") + `\n${zeileDavor + einheit}${eigenschaft}\n${zeileDavor}` + text.slice(obj.ende - 1);
  }
  const letzter = obj.eintraege[obj.eintraege.length - 1];
  const nachLetztem = letzter.wert.ende;
  // gibt es nach dem letzten Wert schon ein Komma (nachgestelltes Komma)? Kommentare dazwischen bleiben stehen.
  let k = nachLetztem; let hatKomma = false;
  for (;;) {
    while (k < obj.ende - 1 && WS.test(text[k])) k++;
    if (text.startsWith("//", k)) { while (k < obj.ende - 1 && text[k] !== "\n") k++; continue; }
    if (text.startsWith("/*", k)) { k = text.indexOf("*/", k + 2) + 2; continue; }
    break;
  }
  if (text[k] === ",") hatKomma = true;
  const ein = einrueckungVon(text, letzter.nameStart);
  const mehrzeilig = text.slice(obj.start, letzter.nameStart).includes("\n");
  if (hatKomma) {
    const nachKomma = k + 1;
    const rest = text.slice(nachKomma, obj.ende - 1);
    // alles bis zur schließenden Klammer bleibt; die neue Eigenschaft kommt direkt hinter das Komma
    const vorKlammer = /\s*$/.exec(rest)[0];
    const kern = rest.slice(0, rest.length - vorKlammer.length);
    return text.slice(0, nachKomma) + kern + (mehrzeilig ? `\n${ein}` : " ") + eigenschaft + "," + vorKlammer + text.slice(obj.ende - 1);
  }
  return text.slice(0, nachLetztem) + "," + (mehrzeilig ? `\n${ein}` : " ") + eigenschaft + text.slice(nachLetztem);
}

function pruefeErgebnis(neu, erwartet) {
  let ist;
  try { ist = parseJsonc(neu); } catch { throw new Error("Ergebnis nicht lesbar"); }
  if (!isDeepStrictEqual(ist, erwartet)) throw new Error("Ergebnis weicht ab");
}

const kopieMit = (obj, pfad, name, wert) => {
  const kopie = structuredClone(obj);
  let n = kopie;
  for (const p of pfad) { if (!n[p] || typeof n[p] !== "object" || Array.isArray(n[p])) n[p] = {}; n = n[p]; }
  if (wert === undefined) delete n[name]; else n[name] = wert;
  return kopie;
};

export function setzeEigenschaft(text, pfad, name, wert) {
  const wurzel = scanne(text);
  if (wurzel.typ !== "objekt") throw new Error("Oberste Ebene ist kein Objekt");
  const erwartet = kopieMit(zuWert(wurzel), pfad, name, wert);
  const einheit = einheitDerDatei(text, wurzel);
  // tiefstes vorhandenes Objekt auf dem Pfad; was fehlt, wird als verschachtelter Wert angelegt
  let n = wurzel; let tiefe = 0;
  while (tiefe < pfad.length) {
    const e = letzterEintrag(n, pfad[tiefe]);
    if (!e) break;
    if (e.wert.typ !== "objekt") throw new Error(`„${pfad[tiefe]}“ ist kein Objekt`);
    n = e.wert; tiefe++;
  }
  let neu;
  const e = tiefe === pfad.length ? letzterEintrag(n, name) : null;
  if (e) {
    const basis = einrueckungVon(text, e.nameStart);
    neu = text.slice(0, e.wert.start) + serialisiere(wert, basis, einheit) + text.slice(e.wert.ende);
  } else {
    // fehlende Ebenen von innen nach außen zu einem Wert verpacken
    const fehlend = pfad.slice(tiefe);
    let einzufuegen = wert, nameEins = name;
    for (let k = fehlend.length - 1; k >= 0; k--) { einzufuegen = { [nameEins]: einzufuegen }; nameEins = fehlend[k]; }
    neu = fuegeEin(text, n, nameEins, einzufuegen, einheit);
  }
  pruefeErgebnis(neu, erwartet);
  return neu;
}

export function entferneEigenschaft(text, pfad, name) {
  const wurzel = scanne(text);
  if (wurzel.typ !== "objekt") throw new Error("Oberste Ebene ist kein Objekt");
  const obj = knotenAm(wurzel, pfad);
  if (!obj || obj.typ !== "objekt") return text;
  const k = obj.eintraege.findLastIndex((x) => x.name === name);
  if (k < 0) return text;
  if (obj.eintraege.filter((x) => x.name === name).length > 1) throw new Error("Name mehrfach vorhanden");
  const erwartet = kopieMit(zuWert(wurzel), pfad, name, undefined);
  const e = obj.eintraege[k];
  // Bereich: ab Zeilenanfang (falls vorher nur Leerraum), bis hinter das Komma/den Zeilenumbruch
  let von = e.nameStart, bis = e.wert.ende;
  let j = bis; while (j < obj.ende && WS.test(text[j]) && text[j] !== "\n") j++;
  const hatKomma = text[j] === ",";
  if (hatKomma) bis = j + 1;
  const zeilenStart = text.lastIndexOf("\n", von - 1) + 1;
  const nurLeer = /^[ \t]*$/.test(text.slice(zeilenStart, von));
  let neu;
  if (nurLeer) {
    let ende = bis; while (ende < text.length && (text[ende] === " " || text[ende] === "\t")) ende++;
    if (text[ende] === "\r") ende++;
    if (text[ende] === "\n") ende++; else ende = bis;
    neu = text.slice(0, zeilenStart) + text.slice(ende);
  } else neu = text.slice(0, von) + text.slice(bis);
  // war es der letzte Eintrag ohne eigenes Komma, bleibt beim Vorgänger ein überzähliges Komma: erlaubt in JSONC, aber wir räumen es auf
  if (!hatKomma && k > 0) {
    const vor = obj.eintraege[k - 1];
    const komma = neu.indexOf(",", vor.wert.ende);
    if (komma >= 0 && /^\s*$/.test(neu.slice(vor.wert.ende, komma))) neu = neu.slice(0, komma) + neu.slice(komma + 1);
  }
  pruefeErgebnis(neu, erwartet);
  return neu;
}
