// gemeinsam/notizen.mjs — Notiz-Index für Brain Studio v2 (Spec v2 §1/§5): Titel, Vorschau, Typ, Bereich, Prüf-Stufe, Links
// (aufgelöst auf Pfade), Entstehungszeit aus Git, Kontext einer Notiz (Beziehungen, Rückverweise, Info), Typen und Ansichten.
// Je Datei wird nur neu gelesen, wenn sich Änderungszeit oder Größe geändert haben; die Verknüpfungen werden bei jeder Anfrage
// aus den (gecachten) Rohlinks neu aufgelöst, weil eine neue Datei ein bisher loses [[Ziel]] erfüllen kann. Keine Abhängigkeiten.
import { readdirSync, statSync, realpathSync, readFileSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BEARBEITBAR, generiertName, wikiGeneriert, gesperrterName, falte, imVault, HttpFehler, loese } from "./basis.mjs";
import { pruefeText, berlinHeute, istDatum, plusTage } from "./pruefung.mjs";
import { git } from "./git.mjs";

const GROSS = 1024 * 1024;        // größere Dateien: nur der Anfang wird gelesen (Titel/Vorschau/Kopf)
const ANFANG = 64 * 1024;
const MAX_FELDER = 40, MAX_WERT = 300, MAX_LISTE = 20, VORSCHAU = 200;
const SIEBEN_TAGE = 7 * 24 * 3600 * 1000;

// ---------- Kopf (Frontmatter) ----------
const SCHLUESSEL = /^([^\s:#\-\[{][^:]*?)\s*:(?:\s+(.*))?$/;

function skalar(w) {
  w = String(w).trim();
  let m;
  if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(w))) return m[1].replace(/\\(["\\])/g, "$1").replace(/\\n/g, " ");
  if ((m = /^'((?:[^']|'')*)'/.exec(w))) return m[1].replace(/''/g, "'");
  return w.replace(/\s+#.*$/, "").trim();
}

// Inhalt zwischen den äußeren [ ] einer Inline-Liste → Einträge (Anführungszeichen und [[Links]] schützen Kommas).
function inlineListe(s) {
  const aus = [];
  let cur = "", q = null, tiefe = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "\\" && q === '"') { cur += s[++i] ?? ""; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[") tiefe++; else if (c === "]") tiefe--;
    if (c === "," && tiefe === 0) { aus.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) aus.push(cur);
  return aus.map(skalar).filter((x) => x !== "");
}

// → { felder: {schluessel: text | [text]}, roh: {schluessel: rohtext}, bis } — bis = Zahl der Kopfzeilen inkl. beider ---, 0 = kein Kopf.
// Liest Text, Inline-Listen [a, b], Block-Listen (- a) und Blocktexte (> / |); Verschachteltes wird übersprungen.
export function parseKopf(text) {
  const z = text.split(/\r?\n/);
  if (!/^---\s*$/.test(z[0] ?? "")) return { felder: {}, roh: {}, bis: 0 };
  let ende = -1;
  for (let i = 1; i < z.length; i++) if (/^(---|\.\.\.)\s*$/.test(z[i])) { ende = i; break; }
  if (ende < 0) return { felder: {}, roh: {}, bis: 0 };
  const felder = {}, roh = {};
  let i = 1;
  while (i < ende) {
    const m = SCHLUESSEL.exec(z[i]);
    if (!m) { i++; continue; }
    const schluessel = m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    const wert = (m[2] ?? "").trim();
    const start = i;
    i++;
    let v;
    if (wert === "" || wert.startsWith("#")) {
      let j = i;
      while (j < ende && !z[j].trim()) j++;
      if (j < ende && /^\s*-(\s|$)/.test(z[j])) { // Block-Liste
        const items = [];
        while (j < ende) {
          const lm = /^\s*-(?:\s+(.*))?$/.exec(z[j]);
          if (lm) { const t = skalar(lm[1] ?? ""); if (t !== "") items.push(t); j++; continue; }
          if (!z[j].trim()) { j++; continue; }
          break;
        }
        v = items; i = j;
      } else { // leer oder verschachtelt: eingerückte Zeilen gehören dazu und werden übersprungen
        while (i < ende && (/^\s+\S/.test(z[i]) || !z[i].trim())) i++;
        v = "";
      }
    } else if (/^[>|][+-]?\d*$/.test(wert)) { // Blocktext
      const teile = [];
      while (i < ende && (!z[i].trim() || /^\s/.test(z[i]))) { teile.push(z[i].trim()); i++; }
      v = wert[0] === ">" ? teile.join(" ").replace(/\s+/g, " ").trim() : teile.join("\n").trim();
    } else if (wert.startsWith("[") && !wert.startsWith("[[")) { // Inline-Liste, ggf. über mehrere Zeilen
      let s = wert;
      let n = 0;
      while (!/\]\s*(#.*)?$/.test(s) && i < ende && n++ < 30) { s += " " + z[i].trim(); i++; }
      const mm = /^\[(.*)\]\s*(?:#.*)?$/.exec(s);
      v = mm ? inlineListe(mm[1]) : skalar(wert);
    } else {
      v = skalar(wert);
    }
    felder[schluessel] = v;
    roh[schluessel] = z.slice(start, i).join("\n");
  }
  return { felder, roh, bis: ende + 1 };
}

const erster = (v) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const istWahr = (v) => /^(true|yes|ja|wahr|1)$/i.test(String(erster(v)).trim());
// Schneidet nie mitten in ein Zeichen aus zwei UTF-16-Einheiten (Emoji), sonst entstünde ein ungültiges Zeichen.
const schneide = (s, n) => (s.length <= n ? s : s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1]) ? n - 1 : n));
const kuerzeWert = (s) => (typeof s === "string" && s.length > MAX_WERT ? schneide(s, MAX_WERT) + "…" : s);
function kappe(felder) {
  const aus = {};
  let n = 0;
  for (const [k, v] of Object.entries(felder)) {
    if (++n > MAX_FELDER) break;
    aus[k] = Array.isArray(v) ? v.slice(0, MAX_LISTE).map(kuerzeWert) : kuerzeWert(v);
  }
  return aus;
}

// ---------- Text: Wikilinks, Markdown entfernen, Vorschau ----------
const WIKI = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
// Ziele aller [[…]] einer Zeile (Alias nach | und Anker nach # oder ^ entfernt; Inline-Code zählt nicht).
export function wikilinkZiele(zeile) {
  const aus = [];
  const s = zeile.replace(/`[^`]*`/g, "");
  for (const m of s.matchAll(WIKI)) {
    const t = m[2].split(/\\?\|/)[0].replace(/[#^].*$/, "").replace(/\\+$/, "").trim();
    if (t) aus.push(t);
  }
  return aus;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// Zustand eines Code-Blocks fortschreiben: gibt true zurück, wenn diese Zeile zum Code-Block gehört (Zaun eingeschlossen).
function zaun(zustand, zeile) {
  const m = FENCE.exec(zeile);
  if (zustand.offen) {
    if (m && m[1][0] === zustand.offen.z && m[1].length >= zustand.offen.n && !zeile.slice(m[0].length).trim()) zustand.offen = null;
    return true;
  }
  if (m) { zustand.offen = { z: m[1][0], n: m[1].length }; return true; }
  return false;
}

export function ohneMarkdown(s) {
  return String(s)
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, (_, z) => { const t = z.split(/\\?\|/); return (t[1] ?? t[0].replace(/[#^].*$/, "").split("/").pop()).trim(); })
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/(^|[\s(])_(?!\s)(.+?)(?<!\s)_(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function kuerze(s, n = VORSCHAU) {
  if (s.length <= n) return s;
  const schnitt = s.lastIndexOf(" ", n);
  return (schnitt > n * 0.6 ? s.slice(0, schnitt) : schneide(s, n)).replace(/[\s,;:.\-–—]+$/, "") + "…";
}

// Erster Absatz nach dem Kopf: ohne Überschriften, Code-Blöcke, Tabellen, Trennlinien, reine Bild-/Einbettungszeilen;
// Zitat-, Listen- und Aufgabenzeichen und [!Callout]-Marken werden abgestreift.
export function ersterAbsatz(zeilen, ab = 0) {
  const z = { offen: null };
  const aus = [];
  const ende = () => aus.length > 0;
  for (let i = ab; i < zeilen.length; i++) {
    if (zaun(z, zeilen[i])) { if (ende()) break; continue; }
    const t = zeilen[i].trim();
    if (!t) { if (ende()) break; continue; }
    if (/^#{1,6}(\s|$)/.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t) || t.startsWith("|") || /^!\[[^\]]*\]\([^)]*\)$/.test(t) || /^!\[\[[^\]]*\]\]$/.test(t)) { if (ende()) break; continue; }
    if (/^<!--.*-->$/.test(t)) continue;
    const l = t.replace(/^(?:>\s*)+/, "").replace(/^\[![\w-]+\][+-]?\s*/, "").replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim();
    if (!l) { if (ende()) break; continue; }
    aus.push(l.slice(0, 700)); // Zeilen ohne Umbruch (z. B. eingefügte Daten) nie ganz verarbeiten
    if (aus.join(" ").length > 500) break;
  }
  return kuerze(ohneMarkdown(aus.join(" ")));
}

// ---------- Eine Datei auswerten ----------
// Titel einer Datei (Suche, Befehlspalette, Notiz-Index): erste „# “-Überschrift außerhalb von Code-Blöcken > Kopf title/titel/name > Dateiname.
export function titelAus(rel, text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const k = parseKopf(text);
  const zeilen = text.split(/\r?\n/);
  const zust = { offen: null };
  for (let i = k.bis; i < zeilen.length; i++) {
    if (zaun(zust, zeilen[i])) continue;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(zeilen[i]);
    if (m) { const t = ohneMarkdown(schneide(m[1], 500)); if (t) return t; }
  }
  const fl = {};
  for (const [s, v] of Object.entries(k.felder)) fl[falte(s)] = v;
  return ohneMarkdown(schneide(String(erster(fl.title) || erster(fl.titel) || erster(fl.name) || ""), 500)) || rel.split("/").pop().replace(/\.(md|txt)$/i, "");
}

const KOPF_GENERIERT = /generiert\s+—\s+nicht\s+editieren/i;

// text ohne BOM; heute = "JJJJ-MM-TT". Reine Funktion (kein Plattenzugriff) — wird je Datei gecacht.
export function analysiere(rel, text, heute) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const name = rel.split("/").pop();
  const k = parseKopf(text);
  const zeilen = text.split(/\r?\n/);
  const fl = {};
  for (const [s, v] of Object.entries(k.felder)) fl[falte(s)] = v;

  let h1 = null;
  const links = [];
  for (const [feld, r] of Object.entries(k.roh)) if (r.includes("[[")) for (const l of r.split("\n")) for (const t of wikilinkZiele(l)) links.push(t);
  const zust = { offen: null };
  for (let i = k.bis; i < zeilen.length; i++) {
    const zl = zeilen[i];
    if (zaun(zust, zl)) continue;
    if (h1 === null) { const m = /^#\s+(.+?)\s*#*\s*$/.exec(zl); if (m) h1 = m[1]; }
    if (zl.includes("[[")) for (const t of wikilinkZiele(zl)) links.push(t);
  }

  const titelRoh = h1 !== null ? ohneMarkdown(schneide(h1, 500)) : "";
  const feldTitel = ohneMarkdown(schneide(String(erster(fl.title) || erster(fl.titel) || erster(fl.name) || ""), 500));
  const titel = titelRoh || feldTitel || name.replace(/\.(md|txt)$/i, "");
  const beschr = ohneMarkdown(schneide(String(erster(fl.description) || erster(fl.beschreibung) || ""), 1000));
  const vorschau = beschr ? kuerze(beschr) : ersterAbsatz(zeilen, k.bis);
  const typ = ohneMarkdown(String(erster(fl.typ) || erster(fl.type) || "")).toLowerCase().trim();

  const wiki = rel.startsWith("09_wiki/");
  const pr = wiki ? pruefeText(rel, text, { heute }) : null;
  const generiert = generiertName(name) || wikiGeneriert(rel, name) || KOPF_GENERIERT.test(zeilen.slice(0, 3).join("\n"));
  const aliasWerte = [fl.aliases, fl.alias, fl.auch_genannt].flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []));
  let abgelaufen = false;
  const pb = String(erster(fl.pruefen_bis));
  if (pb && istDatum(pb) && pb < heute) abgelaufen = true;
  const verfall = /^\d+$/.test(String(erster(fl.verfall))) ? +erster(fl.verfall) : null;
  const stand = String(erster(fl.stand));
  if (verfall !== null && istDatum(stand) && plusTage(stand, verfall) < heute) abgelaufen = true;

  return {
    titel, vorschau, typ, felder: kappe(k.felder), links,
    stufe: pr ? pr.stufe : null,
    belegt: !!pr && pr.signale.some((s) => s.art === "belegt"),
    hatStand: !!stand.trim(),
    abgelaufen, generiert,
    archiviert: istWahr(fl.archiviert) || istWahr(fl.archived),
    aliasse: aliasWerte.map((a) => ohneMarkdown(a)).filter(Boolean),
    istSeite: wiki && !name.startsWith("_") && !rel.split("/").includes("belege"), // Beleg-Dateien sind Nachweise, keine Aussagen
  };
}

// ---------- Typen: feste Farben/Symbole ----------
// Symbole kommen aus einer kleinen festen Liste, die die Oberfläche kennt: buch, zitat, wuerfel, rakete, person, waage, notiz, ordner.
const TYP_STIL = {
  thema: { farbe: "#4F7DF3", symbol: "buch" },
  quelle: { farbe: "#C9922A", symbol: "zitat" },
  entitaet: { farbe: "#9A6FD6", symbol: "wuerfel" },
  projekt: { farbe: "#E0693F", symbol: "rakete" },
  person: { farbe: "#D4578A", symbol: "person" },
  entscheidung: { farbe: "#2FA39A", symbol: "waage" },
  notiz: { farbe: "#7C8798", symbol: "notiz" },
};
const TYP_ALIAS = { themen: "thema", topic: "thema", topics: "thema", source: "quelle", quellen: "quelle", sources: "quelle", entity: "entitaet", entities: "entitaet",
  project: "projekt", projekte: "projekt", projects: "projekt", people: "person", personen: "person", decision: "entscheidung", entscheidungen: "entscheidung", decisions: "entscheidung",
  note: "notiz", notes: "notiz", notizen: "notiz" };
const ABGELEITET = ["#4FA877", "#4F7DF3", "#9A6FD6", "#E0693F", "#D4578A", "#2FA39A", "#C9922A", "#7C8798"];
export const STANDARD_STIL = { farbe: "#7C8798", symbol: "notiz" };

export function typStil(name) {
  const n = String(name).normalize("NFC").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").trim();
  const k = TYP_STIL[n] ? n : TYP_ALIAS[n];
  if (k) return { ...TYP_STIL[k] };
  let h = 5381;
  for (const c of n) h = ((h * 33) ^ c.codePointAt(0)) >>> 0;
  return { farbe: ABGELEITET[h % ABGELEITET.length], symbol: "notiz" };
}

// ---------- Index ----------
const gleichRang = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

export function erzeugeNotizIndex({ wurzel, jetzt = () => new Date(), heute }) {
  const heuteJetzt = () => (typeof heute === "function" ? heute() : heute) || berlinHeute(jetzt());
  const cache = new Map(); // rel → { k, heute, ...analysiere() }

  function geheDurch() {
    const aus = [];
    const geh = (relOrdner) => {
      let liste;
      try { liste = readdirSync(relOrdner ? join(wurzel, relOrdner) : wurzel, { withFileTypes: true }); } catch { return; }
      for (const d of liste) {
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        if (d.isDirectory()) { geh(rel); continue; }
        if (!BEARBEITBAR.test(d.name)) continue;
        const abs = join(wurzel, rel);
        let st;
        try {
          if (d.isSymbolicLink()) { const echt = realpathSync(abs); if (!imVault(echt, wurzel)) continue; st = statSync(echt); if (!st.isFile()) continue; }
          else if (d.isFile()) st = statSync(abs);
          else continue;
        } catch { continue; }
        aus.push({ rel, abs, st });
      }
    };
    geh("");
    return aus;
  }

  function leseText(abs, groesse) {
    if (groesse <= GROSS) return readFileSync(abs).toString("utf8");
    let fd;
    try { fd = openSync(abs, "r"); const b = Buffer.alloc(ANFANG); const n = readSync(fd, b, 0, ANFANG, 0); return b.subarray(0, n).toString("utf8"); }
    finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
  }

  // ----- Entstehungszeit: erster Git-Commit je Datei (Umbenennungen verfolgt), gecacht je HEAD -----
  const gk = { head: null, karte: null, laeuft: null };
  function wendeAn(karte, roh) {
    const t = roh.split("\0");
    let zeit = null;
    for (let i = 0; i < t.length; i++) {
      let tok = t[i];
      if (tok.startsWith("\x1e")) { zeit = tok.slice(1); continue; }
      tok = tok.replace(/^\n/, "");
      if (!tok) continue;
      const s = tok[0];
      if (s === "R" || s === "C") {
        const alt = (t[++i] ?? "").normalize("NFC"), neu = (t[++i] ?? "").normalize("NFC");
        if (s === "R") { const z = karte.get(alt) ?? zeit; karte.delete(alt); karte.set(neu, z); }
        else if (!karte.has(neu)) karte.set(neu, zeit);
      } else {
        const p = (t[++i] ?? "").normalize("NFC");
        if (s === "A") { if (!karte.has(p)) karte.set(p, zeit); }
        else if (s === "D") karte.delete(p);
      }
    }
  }
  async function ladeGitKarte() {
    if (!existsSync(join(wurzel, ".git")) || existsSync(join(wurzel, ".git", "shallow"))) return null;
    let head;
    try {
      const h = await git(wurzel, ["rev-parse", "--verify", "-q", "HEAD"]);
      if (h.code !== 0) return null;
      head = h.stdout.trim();
    } catch { return null; }
    if (gk.head === head && gk.karte) return gk.karte;
    if (gk.laeuft && gk.laeuft.head === head) return gk.laeuft.p;
    const p = (async () => {
      try {
        let karte = new Map(), bereich = head;
        if (gk.karte && gk.head && (await git(wurzel, ["merge-base", "--is-ancestor", gk.head, head])).code === 0) { karte = new Map(gk.karte); bereich = `${gk.head}..${head}`; }
        const r = await git(wurzel, ["log", "--reverse", "--no-color", "-z", "-M", "--name-status", "--format=%x1e%cI", bereich], { timeout: 120_000 });
        if (r.code !== 0) return null;
        wendeAn(karte, r.stdout);
        gk.head = head; gk.karte = karte;
        return karte;
      } catch { return null; }
    })().finally(() => { if (gk.laeuft && gk.laeuft.head === head) gk.laeuft = null; });
    gk.laeuft = { head, p };
    return p;
  }
  // Höchstens 1,5 s warten; danach liefert diese Anfrage Ersatzwerte (Datei-Erstellzeit), und die Karte wird im Hintergrund fertig.
  async function gitKarteMitFrist() {
    const p = ladeGitKarte();
    p.catch(() => {});
    return Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), 1500).unref())]);
  }
  const iso = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

  // ----- Hauptlauf -----
  async function index() {
    const heuteStr = heuteJetzt();
    const jetztMs = jetzt().getTime();
    const dateien = geheDurch();
    const gesehen = new Set();
    const roh = [];
    for (const d of dateien) {
      const k = `${d.st.mtimeMs}:${d.st.size}`;
      let c = cache.get(d.rel);
      if (!c || c.k !== k || c.heute !== heuteStr) {
        let text;
        try { text = leseText(d.abs, d.st.size); } catch { continue; } // inzwischen weg oder unlesbar
        c = { k, heute: heuteStr, ...analysiere(d.rel, text, heuteStr) };
        cache.set(d.rel, c);
      }
      gesehen.add(d.rel);
      const ohne = d.rel.replace(/\.(md|txt)$/i, "");
      const teile = ohne.split("/");
      roh.push({ rel: d.rel, st: d.st, c, ohne, teile, dir: teile.slice(0, -1).join("/") });
    }
    if (cache.size > gesehen.size) for (const key of [...cache.keys()]) if (!gesehen.has(key)) cache.delete(key);

    // Auflösung: Pfad (auch Endstück des Pfads) und Dateiname · Titel · Alias — Groß/klein und Unicode-Form egal
    const nachEnde = new Map(), nachTitel = new Map(), nachAlias = new Map();
    const eintrag = (m, schluessel, e) => { const l = m.get(schluessel); if (l) l.push(e); else m.set(schluessel, [e]); };
    for (const e of roh) {
      for (let i = 0; i < e.teile.length; i++) eintrag(nachEnde, falte(e.teile.slice(i).join("/")), e);
      eintrag(nachTitel, falte(e.c.titel), e);
      for (const a of e.c.aliasse) eintrag(nachAlias, falte(a), e);
    }
    const waehle = (kand, ziel, vonDir) => {
      let best = null, bestRang = null;
      for (const k of kand) {
        const rang = [falte(k.ohne) === ziel ? 0 : 1, k.dir === vonDir ? 0 : 1, k.teile.length];
        if (!best || gleichRang(rang, bestRang) < 0 || (gleichRang(rang, bestRang) === 0 && k.rel < best.rel)) { best = k; bestRang = rang; }
      }
      return best;
    };
    const loeseZiel = (z0, vonDir) => {
      let t = z0.trim();
      if (!t) return null;
      if (t.startsWith("./") || t.startsWith("../")) { // relativ zum Ordner der Notiz
        const seg = vonDir ? vonDir.split("/") : [];
        for (const s of t.split("/")) { if (s === "." || s === "") continue; if (s === "..") { if (!seg.length) return null; seg.pop(); } else seg.push(s); }
        t = seg.join("/");
      }
      t = t.replace(/^\/+/, "");
      const ohneEnde = t.replace(/\.(md|txt)$/i, "");
      for (const [m, s] of [[nachEnde, falte(t)], [nachEnde, falte(ohneEnde)], [nachTitel, falte(t)], [nachTitel, falte(ohneEnde)], [nachAlias, falte(t)], [nachAlias, falte(ohneEnde)]]) {
        const kand = m.get(s);
        if (kand && kand.length) return waehle(kand, falte(ohneEnde), vonDir);
      }
      return null;
    };

    const rueck = new Map(); // ziel-rel → Menge der Quell-rel (nur selbst geschriebene Notizen, keine generierten Verzeichnisse)
    for (const e of roh) {
      const ziele = [], offen = [];
      for (const z of e.c.links) {
        const g = loeseZiel(z, e.dir);
        if (g) { if (!ziele.includes(g.rel)) ziele.push(g.rel); } else if (!offen.includes(z)) offen.push(z);
      }
      e.ziele = ziele; e.offen = offen;
      if (!e.c.generiert) for (const r of ziele) if (r !== e.rel) { const s = rueck.get(r); if (s) s.add(e.rel); else rueck.set(r, new Set([e.rel])); }
    }

    const karte = await gitKarteMitFrist();
    const hatInbox = roh.some((e) => falte(e.teile[0]) === "00_inbox") || existsSync(join(wurzel, "00_inbox"));
    const zuletztAb = jetztMs - SIEBEN_TAGE;

    const zeilen = roh.map((e) => {
      const { c } = e;
      const oben = falte(e.teile[0]);
      const unterhalb = e.teile.slice(1, -1);
      let bereich;
      if (c.archiviert || /^90_/.test(oben)) bereich = "archiv";
      else if (oben === "00_inbox" && !unterhalb.some((s) => s.startsWith("_"))) bereich = "inbox"; // _-Ordner im Posteingang = maschinell verwaltet (Rückfragen, Vorschläge)
      else if (oben === "09_wiki") bereich = "wissen";
      else if (!hatInbox && !c.typ && !c.links.length && !rueck.has(e.rel)) bereich = "inbox"; // Vault ohne 00_inbox: lose Notizen ohne Typ und Verknüpfung
      else bereich = "notiz";
      const ansichten = [];
      if (!c.generiert) {
        if (c.abgelaufen) ansichten.push("abgelaufen");
        if (c.stufe === "rot") ansichten.push("strittig");
        if (c.istSeite && !c.belegt && !c.hatStand) ansichten.push("ungeprueft");
        if (e.st.mtimeMs >= zuletztAb) ansichten.push("zuletzt");
      }
      const git1 = karte ? karte.get(e.rel.normalize("NFC")) : undefined;
      const erstellt = (git1 && iso(git1)) || (e.st.birthtimeMs > 0 ? iso(e.st.birthtimeMs) : null);
      return { pfad: e.rel, titel: c.titel, vorschau: c.vorschau, typ: c.typ, bereich, geaendert: e.st.mtime.toISOString(), erstellt, stufe: c.stufe,
        links: e.ziele, felder: c.felder, generiert: c.generiert, ansichten, _offen: e.offen };
    });
    zeilen.sort((a, b) => (a.geaendert < b.geaendert ? 1 : a.geaendert > b.geaendert ? -1 : a.pfad < b.pfad ? -1 : 1));
    return { zeilen, rueck, roh, loeseZiel, karte };
  }

  const oeffentlich = (z) => { const { _offen, ...rest } = z; return rest; };

  async function notizen() {
    const { zeilen } = await index();
    return { notizen: zeilen.map(oeffentlich) };
  }

  async function typen() {
    const { zeilen } = await index();
    const zaehl = new Map();
    for (const z of zeilen) if (z.typ && !z.generiert) zaehl.set(z.typ, (zaehl.get(z.typ) || 0) + 1);
    const liste = [...zaehl].map(([name, anzahl]) => ({ name, anzahl, ...typStil(name) }));
    liste.sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, "de"));
    return { typen: liste, standard: { ...STANDARD_STIL } };
  }

  async function ansichten() {
    const { zeilen } = await index();
    const zaehl = { abgelaufen: 0, strittig: 0, ungeprueft: 0, zuletzt: 0 };
    for (const z of zeilen) for (const a of z.ansichten) zaehl[a]++;
    return { ansichten: ["abgelaufen", "strittig", "ungeprueft", "zuletzt"].map((id) => ({ id, anzahl: zaehl[id] })) };
  }

  async function kontext(pfad) {
    const { abs, rel } = loese(wurzel, pfad);
    if (!BEARBEITBAR.test(rel)) throw new HttpFehler(415, "Nur Markdown- und Textdateien haben einen Kontext.");
    let st, text;
    try { st = statSync(abs); if (!st.isFile()) throw 0; text = leseText(abs, st.size); } catch { throw new HttpFehler(404, "Diese Datei gibt es nicht."); }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const { zeilen, rueck, roh, loeseZiel } = await index();
    const dir = rel.split("/").slice(0, -1).join("/");
    const k = parseKopf(text);
    const aufgeloest = (t) => { const g = loeseZiel(t, dir); return g ? g.rel : t; };
    const beziehungen = [];
    for (const [feld, r] of Object.entries(k.roh)) {
      if (!r.includes("[[")) continue;
      const ziele = [];
      for (const l of r.split("\n")) for (const t of wikilinkZiele(l)) { const a = aufgeloest(t); if (!ziele.includes(a)) ziele.push(a); }
      if (ziele.length) beziehungen.push({ feld, ziele });
    }
    const verweise = [];
    const zust = { offen: null }, koerper = text.split(/\r?\n/);
    for (let i = k.bis; i < koerper.length; i++) {
      if (zaun(zust, koerper[i])) continue;
      if (koerper[i].includes("[[")) for (const t of wikilinkZiele(koerper[i])) { const a = aufgeloest(t); if (!verweise.includes(a)) verweise.push(a); }
    }
    const titelVon = new Map(zeilen.map((z) => [z.pfad, z.titel]));
    const rueckverweise = [...(rueck.get(rel) || [])].map((p) => ({ pfad: p, titel: titelVon.get(p) || p })).sort((a, b) => a.titel.localeCompare(b.titel, "de", { sensitivity: "base" }) || (a.pfad < b.pfad ? -1 : 1));
    const koerperText = koerper.slice(k.bis).join("\n");
    const mich = zeilen.find((z) => z.pfad === rel);
    return {
      felder: k.felder, beziehungen, verweise, rueckverweise,
      info: { woerter: (koerperText.match(/\S+/g) || []).length, bytes: st.size, geaendert: st.mtime.toISOString(), erstellt: mich ? mich.erstellt : null },
    };
  }

  return { notizen, typen, ansichten, kontext };
}
