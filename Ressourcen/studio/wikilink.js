// ERZEUGT von scripts/erzeuge-gemeinsam-kopien.mjs aus Ressourcen/gemeinsam/wikilink.mjs — nicht von Hand ändern.
// gemeinsam/wikilink.mjs — EINE Regel, wohin ein [[Wikilink]] zeigt. Genutzt von der Werkstatt (Notiz-Index: Verknüpfungen, Rückverweise), vom
// Studio (Klick auf einen Link, fehlende Links, Vervollständigung, „Anlegen“) und vom MCP-Server (Seite lesen). Reine Funktionen, keine Abhängigkeiten.
// Die Studio-Kopie (Ressourcen/studio/wikilink.js) erzeugt scripts/erzeuge-gemeinsam-kopien.mjs — nicht von Hand ändern.
//
// Die Regel (Reihenfolge = Vorrang):
//   1. Pfad (mit oder ohne Endung; auch nur das Endstück, z. B. „wissen/kaffee“) und Dateiname
//   2. Titel der Notiz (erste Überschrift „# …“, sonst Titel im Datei-Kopf, sonst Dateiname)
//   3. Alias (aliases / alias / auch_genannt im Datei-Kopf)
//   Jede Stufe zuerst GENAU (Groß/klein und Unicode-Form egal), dann TOLERANT: Umlaute und Akzente (ä = ae = a), ß = ss, und Leerzeichen, „-“ und „_“
//   zählen gleich — so trifft [[Neue Idee]] auch „neue-idee.md“ und [[Muehle]] die „Mühle“.
//   Gibt es mehrere Treffer: genauer Pfad vor Endstück, dann derselbe Ordner wie die Notiz mit dem Link, dann der kürzere Pfad, dann alphabetisch.
//   Relative Ziele („./x“, „../x“) gelten ab dem Ordner der Notiz.
// Ein Eintrag ist { pfad, titel?, aliasse? } mit Pfad relativ zum Vault, „/“ als Trenner.

/** Groß/klein und Unicode-Form egal. */
export const falte = (s) => String(s).normalize("NFC").toLowerCase();

const ENDUNG = /\.(md|txt)$/i;
const ohneEndung = (p) => String(p).replace(ENDUNG, "");

/**
 * Tolerante Schlüssel eines Namens: [ae-Form, a-Form] (nur wenn sie sich unterscheiden). Alles klein, Akzente weg, Trenner (Leerraum, „-“, „_“) = ein Leerzeichen.
 * „Müller-Liste“ → ["mueller liste", "muller liste"].
 */
export function lockerFormen(s) {
  const basis = falte(s).replace(/[\s_-]+/g, " ").trim();
  const ae = basis.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const ohneAkzent = (t) => t.normalize("NFD").replace(/\p{M}+/gu, "").replace(/ß/g, "ss");
  const a = ohneAkzent(basis);
  const b = ohneAkzent(ae);
  return b === a ? [b] : [b, a];
}

const STUFEN = ["ende", "titel", "alias"];

/** Index über alle Notizen bauen. `eintraege`: [{ pfad, titel?, aliasse? }]. */
export function baueWikiIndex(eintraege) {
  const roh = [];
  for (const e of eintraege || []) {
    if (!e || typeof e.pfad !== "string" || !e.pfad) continue;
    const ohne = ohneEndung(e.pfad);
    const teile = ohne.split("/");
    roh.push({ pfad: e.pfad, titel: typeof e.titel === "string" && e.titel.trim() ? e.titel : teile[teile.length - 1], aliasse: Array.isArray(e.aliasse) ? e.aliasse.filter((a) => typeof a === "string" && a.trim()) : [],
      ohne, teile, dir: teile.slice(0, -1).join("/") });
  }
  const dazu = (m, schluessel, e) => { const l = m.get(schluessel); if (l) { if (l[l.length - 1] !== e) l.push(e); } else m.set(schluessel, [e]); };
  const genau = { ende: new Map(), titel: new Map(), alias: new Map() };
  for (const e of roh) {
    for (let i = 0; i < e.teile.length; i++) dazu(genau.ende, falte(e.teile.slice(i).join("/")), e);
    dazu(genau.titel, falte(e.titel), e);
    for (const a of e.aliasse) dazu(genau.alias, falte(a), e);
  }
  // Die toleranten Schlüssel (Umlaute, Trenner) kosten Zeit: erst bauen, wenn ein genauer Treffer fehlt (offene Links, Vervollständigung)
  let lockerSatz = null;
  const locker = () => {
    if (lockerSatz) return lockerSatz;
    const satz = { ende: new Map(), titel: new Map(), alias: new Map() };
    for (const e of roh) {
      for (let i = 0; i < e.teile.length; i++) for (const f of lockerFormen(e.teile.slice(i).join("/"))) dazu(satz.ende, f, e);
      for (const f of lockerFormen(e.titel)) dazu(satz.titel, f, e);
      for (const a of e.aliasse) for (const f of lockerFormen(a)) dazu(satz.alias, f, e);
    }
    return (lockerSatz = satz);
  };
  return { roh, genau, locker, nachPfad: new Map(roh.map((e) => [e.pfad, e])) };
}

const rangVergleich = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

function waehle(kandidaten, exaktPfad, vonDir) {
  let best = null, bestRang = null;
  for (const k of kandidaten) {
    const rang = [falte(k.ohne) === exaktPfad ? 0 : 1, k.dir === vonDir ? 0 : 1, k.teile.length];
    if (!best || rangVergleich(rang, bestRang) < 0 || (rangVergleich(rang, bestRang) === 0 && k.pfad < best.pfad)) { best = k; bestRang = rang; }
  }
  return best;
}

// Relative Ziele („./x“, „../x“) ab dem Ordner der Notiz; null = führt aus dem Vault heraus
function absolutes(ziel, vonDir) {
  let t = ziel.trim();
  if (t.startsWith("./") || t.startsWith("../")) {
    const seg = vonDir ? vonDir.split("/") : [];
    for (const s of t.split("/")) { if (s === "." || s === "") continue; if (s === "..") { if (!seg.length) return null; seg.pop(); } else seg.push(s); }
    t = seg.join("/");
  }
  return t.replace(/^\/+/, "");
}

/**
 * Wohin zeigt [[ziel]] von einer Notiz im Ordner `vonDir` aus? → Eintrag { pfad, titel, … } oder null (der Link ist offen).
 * Ein Anker („#Abschnitt“) und ein Anzeigetext („|Text“) gehören nicht zum Ziel; wer sie übergibt, bekommt sie abgeschnitten.
 */
export function findeWikiZiel(index, ziel, vonDir = "") {
  if (!index || typeof ziel !== "string") return null;
  const t = absolutes(ziel.replace(/[|#].*$/s, ""), vonDir);
  if (!t) return null;
  const ohne = t.replace(ENDUNG, "");
  const exakt = falte(ohne);
  for (const [holeSatz, formen] of [[() => index.genau, (s) => [falte(s)]], [() => index.locker(), lockerFormen]]) {
    const satz = holeSatz();
    for (const stufe of STUFEN) {
      const vorgemerkt = new Set();
      for (const s of [t, ohne]) {
        for (const f of formen(s)) {
          if (vorgemerkt.has(f)) continue;
          vorgemerkt.add(f);
          const kand = satz[stufe].get(f);
          if (kand && kand.length) return waehle(kand, exakt, vonDir);
        }
      }
    }
  }
  return null;
}

/** Wie findeWikiZiel, aber nur der Pfad (oder null). */
export const loeseWikiLink = (index, ziel, vonDir = "") => findeWikiZiel(index, ziel, vonDir)?.pfad ?? null;

/** Ordner einer Notiz („a/b/c.md“ → „a/b“). */
export const ordnerVonPfad = (pfad) => { const t = String(pfad || "").split("/"); t.pop(); return t.join("/"); };

/**
 * Was in die Klammern gehört, damit der Link sicher bei `pfad` landet: der Titel, wenn er eindeutig dorthin führt; sonst der Pfad ohne Endung
 * mit dem Titel als Anzeigetext („wissen/kaffee|Kaffee“).
 */
export function linkText(index, pfad, vonDir = "") {
  const e = index.nachPfad.get(pfad);
  if (!e) return ohneEndung(pfad);
  const titel = e.titel.replace(/[\[\]|#\n]/g, " ").replace(/\s+/g, " ").trim();
  if (titel && loeseWikiLink(index, titel, vonDir) === pfad) return titel;
  const kurz = e.ohne;
  return titel && titel !== kurz ? `${kurz}|${titel}` : kurz;
}

// ---------- Vorschläge beim Tippen von [[ ----------

/** Levenshtein-Abstand, abgebrochen sobald er über `max` liegt (→ max + 1). */
function abstand(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let vor = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const jetzt = [i];
    let kleinste = i;
    for (let j = 1; j <= b.length; j++) {
      jetzt[j] = Math.min(vor[j] + 1, jetzt[j - 1] + 1, vor[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (jetzt[j] < kleinste) kleinste = jetzt[j];
    }
    if (kleinste > max) return max + 1;
    vor = jetzt;
  }
  return vor[b.length];
}

/** Wertung eines Namens für die Eingabe q (beide schon locker gefaltet): kleiner = besser, null = passt nicht. `tippfehler: false` lässt die teure Stufe aus. */
export function unscharf(q, text, { tippfehler = true } = {}) {
  if (!q) return 3;
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  const woerter = text.split(" ");
  if (woerter.some((w) => w.startsWith(q))) return 2;
  if (text.includes(q)) return 3;
  // Wortanfänge nacheinander („pa“ → „Projekt Alpha“, „proj al“)
  const teile = q.split(" ").filter(Boolean);
  if (teile.length > 1) {
    let ab = 0, ok = true;
    for (const t of teile) { const i = woerter.findIndex((w, k) => k >= ab && w.startsWith(t)); if (i < 0) { ok = false; break; } ab = i + 1; }
    if (ok) return 3.5;
  }
  const anfaenge = woerter.map((w) => w[0]).join("");
  if (q.length >= 2 && !q.includes(" ") && anfaenge.startsWith(q)) return 4;
  // Buchstaben in Reihenfolge („kfe“ → „Kaffee“): je mehr Lücken, desto schlechter
  if (q.length >= 2 && !q.includes(" ")) {
    let pos = -1, luecken = 0;
    for (const c of q) { const i = text.indexOf(c, pos + 1); if (i < 0) { pos = -2; break; } if (pos >= 0) luecken += i - pos - 1; pos = i; }
    if (pos >= 0 && luecken <= Math.max(3, q.length)) return 5 + luecken / 100;
  }
  // Tippfehler: ein Zeichen daneben, zu viel oder zu wenig, gegen den Anfang des Namens oder ein Wort („kafee“ → „Kaffee“)
  if (tippfehler && q.length >= 4) {
    const max = q.length >= 8 ? 2 : 1;
    let best = max + 1;
    for (const w of [text, ...woerter]) {
      best = Math.min(best, abstand(q, w, max), abstand(q, w.slice(0, q.length), max), abstand(q, w.slice(0, q.length + 1), max));
    }
    if (best <= max) return 6 + best;
  }
  return null;
}

/**
 * Vorschläge für `[[getippt`: Titel (mit Ordner als Detail), Aliasse und Dateinamen, unscharf (Tippfehler, Wortanfänge, Umlaute).
 * → [{ pfad, titel, ordner, dateiname, alias|null, text (was in die Klammern kommt), rang }], beste zuerst, höchstens `max`.
 * Ohne Eingabe: die ersten `max` nach `bevorzugt` (zuletzt geöffnete Pfade zuerst), dann alphabetisch.
 */
export function schlageWikiZieleVor(index, getippt, { vonDir = "", max = 40, bevorzugt = [] } = {}) {
  const vorn = new Map(bevorzugt.map((p, i) => [p, i]));
  const q = lockerFormen(String(getippt || "").replace(/[|#].*$/s, "").replace(ENDUNG, ""))[0] || "";
  const liste = [], getroffen = new Set();
  // Zwei Durchgänge: erst ohne Tippfehler-Stufe (billig); nur wenn das kaum etwas ergibt, mit — bei zehntausenden Notizen sonst bei jedem Tastendruck spürbar
  for (const tippfehler of [false, true]) {
    if (tippfehler && (liste.length >= 8 || !q)) break;
    for (const e of index.roh) {
      if (tippfehler && getroffen.has(e)) continue;
      let rang = null, alias = null;
      if (!q) rang = 3;
      else {
        // Die gefalteten Namen merkt sich der Eintrag (bei jedem Tastendruck neu zu falten wäre bei tausenden Notizen spürbar)
        if (!e.formen) e.formen = [[e.titel, 0, lockerFormen(e.titel)], ...e.aliasse.map((a) => [a, 0.4, lockerFormen(a)]), [e.teile[e.teile.length - 1], 0.2, lockerFormen(e.teile[e.teile.length - 1])]];
        for (const [name, zuschlag, formen] of e.formen) {
          for (const f of formen) {
            const r = unscharf(q, f, { tippfehler });
            if (r !== null && (rang === null || r + zuschlag < rang)) { rang = r + zuschlag; alias = zuschlag === 0.4 ? name : null; }
          }
        }
        if (rang === null && !tippfehler && q.includes("/")) { // Pfade: nur wenn getippt wurde, was nach einem Pfad aussieht
          if (!e.pfadForm) e.pfadForm = lockerFormen(e.ohne)[0];
          const r = unscharf(q, e.pfadForm, { tippfehler });
          if (r !== null) rang = r + 0.6;
        }
      }
      if (rang === null) continue;
      getroffen.add(e);
      liste.push({ pfad: e.pfad, titel: e.titel, ordner: e.dir, dateiname: e.teile[e.teile.length - 1], alias, text: "", rang });
    }
  }
  liste.sort((a, b) => a.rang - b.rang || (vorn.has(a.pfad) ? vorn.get(a.pfad) : 1e9) - (vorn.has(b.pfad) ? vorn.get(b.pfad) : 1e9)
    || a.titel.length - b.titel.length || a.titel.localeCompare(b.titel, "de") || (a.pfad < b.pfad ? -1 : 1));
  const aus = liste.slice(0, max);
  for (const v of aus) v.text = linkText(index, v.pfad, vonDir);
  return aus;
}

/**
 * Titel, Dateiname und Ordner für „Anlegen“: aus dem Ziel eines offenen Links. `[[Neue Idee]]` → Titel „Neue Idee“ im Ordner der Notiz;
 * `[[projekte/Neue Idee]]` → Titel „Neue Idee“ im Ordner „projekte“; `[[./x]]` / `[[../x]]` gelten ab dem Ordner der Notiz.
 * Der Titel kommt als „# Titel“ in die Datei: damit trifft der Link sie sofort (Regel Stufe 2), auch wenn der Dateiname anders aussieht.
 */
export function zielZuNeuerNotiz(ziel, vonDir = "") {
  const t = absolutes(String(ziel || "").replace(/[|#].*$/s, ""), vonDir);
  if (!t) return null;
  const teile = t.replace(ENDUNG, "").split("/").filter(Boolean);
  const titel = (teile.pop() || "").replace(/\s+/g, " ").trim();
  if (!titel) return null;
  return { titel, ordner: teile.length ? teile.join("/") : null };
}
