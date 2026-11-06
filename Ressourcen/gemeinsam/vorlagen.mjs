// gemeinsam/vorlagen.mjs — Vorlagen und Tagesnotiz: EINE Regel für Platzhalter, Datumsformate, Kopf (Frontmatter) und den Pfad der Tagesnotiz.
// Studio (Neue Notiz aus Vorlage, Tagesnotiz, Kalender) und Tests rechnen damit gleich. Reine Funktionen, keine Abhängigkeiten außer zeit.mjs;
// „heute“ und die Uhrzeit kommen aus der Zeitzone des Macs (zeit.mjs), eingespritzt wird sie nur in Tests (Parameter `zone`).
// Die Studio-Kopie (Ressourcen/studio/vorlagen.js) erzeugt scripts/erzeuge-gemeinsam-kopien.mjs — nicht von Hand ändern.
//
// Platzhalter in einer Vorlage (Groß/klein egal, Leerzeichen in den Klammern erlaubt):
//   {{titel}}            der Titel der neuen Notiz (im Kopf als gültiger YAML-Text)
//   {{datum}}            JJJJ-MM-TT          {{datum:FORMAT}}   zum Beispiel {{datum:TT.MM.JJJJ}} oder {{datum:WWWW, T. MMMM JJJJ}}
//   {{zeit}}             HH:mm               {{zeit:FORMAT}}
//   {{cursor}}           hier steht der Cursor nach dem Einfügen (der erste zählt, weitere entfallen)
// Formatzeichen: JJJJ JJ · MMMM MMM MM M · TT T · WWWW WWW (Wochentag) · KW (Kalenderwoche) · HH mm ss. Text in [eckigen Klammern] bleibt wörtlich.
// Unbekannte Platzhalter bleiben unverändert stehen.
import { ortsZeit, plusTageIso, wochentagIso } from "./zeit.mjs";

export const STANDARD = Object.freeze({ vorlagenOrdner: "Vorlagen", tagesnotizOrdner: "Tagebuch", tagesnotizFormat: "JJJJ-MM-TT", tagesnotizVorlage: "" });

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WOCHENTAGE_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const zwei = (n) => String(n).padStart(2, "0");

export const istIso = (s) => {
  const m = ISO.exec(String(s ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

/** ISO-Kalenderwoche (1–53) eines ISO-Datums; die Woche gehört dem Jahr ihres Donnerstags. */
export function kalenderwoche(iso) {
  const m = ISO.exec(String(iso));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const wt = (d.getUTCDay() + 6) % 7; // Montag = 0
  d.setUTCDate(d.getUTCDate() - wt + 3); // Donnerstag dieser Woche
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return 1 + Math.floor((d - jan1) / 86400000 / 7);
}

const FORMAT_ZEICHEN = /\[([^\]]*)\]|JJJJ|JJ|MMMM|MMM|MM|M|TT|T|WWWW|WWW|KW|HH|mm|ss/g;

/**
 * Datum und Uhrzeit nach einem Format schreiben. `teile`: { iso: "JJJJ-MM-TT", h?: "HH", m?: "mm", s?: "ss" } (Uhrzeit fehlt → 00).
 * Beispiele: „TT.MM.JJJJ“ → 05.11.2026 · „WWWW, T. MMMM JJJJ“ → Donnerstag, 5. November 2026 · „JJJJ-[KW]KW“ → 2026-KW45
 */
export function formatiereDatum(format, teile) {
  const m = ISO.exec(String(teile?.iso ?? ""));
  if (!m) return "";
  const j = +m[1], mo = +m[2], t = +m[3];
  const wt = wochentagIso(teile.iso);
  return String(format ?? "").replace(FORMAT_ZEICHEN, (z, woertlich) => {
    switch (z) {
      case "JJJJ": return String(j).padStart(4, "0");
      case "JJ": return zwei(j % 100);
      case "MMMM": return MONATE[mo - 1];
      case "MMM": return MONATE_KURZ[mo - 1];
      case "MM": return zwei(mo);
      case "M": return String(mo);
      case "TT": return zwei(t);
      case "T": return String(t);
      case "WWWW": return WOCHENTAGE[wt];
      case "WWW": return WOCHENTAGE_KURZ[wt];
      case "KW": return zwei(kalenderwoche(teile.iso));
      case "HH": return teile.h ?? "00";
      case "mm": return teile.m ?? "00";
      case "ss": return teile.s ?? "00";
      default: return woertlich ?? z; // [wörtlich]
    }
  });
}

/** Überschrift einer Tagesnotiz: „Donnerstag, 5. November 2026“. */
export const tagesTitel = (iso) => formatiereDatum("WWWW, T. MMMM JJJJ", { iso });

// ---------------------------------------------------------------------------------------------------------------- Vorlage füllen
const MARKE = "\uE000"; // privates Zeichen: so kann ein Titel nie einen Cursor einschleusen
const CURSOR = /\{\{\s*cursor\s*\}\}/gi;
const PLATZHALTER = /\{\{\s*(titel|datum|zeit)\s*(?::([^{}]*?))?\s*\}\}/gi;

/** Grenzen des Kopfes: { kopfEnde, restStart } (Offsets im Text) oder null. Der Kopf beginnt in Zeile 1 mit --- und endet mit --- oder ... */
export function kopfGrenzen(text) {
  const t = String(text ?? "");
  if (!/^---[ \t]*(\r?\n|$)/.test(t)) return null;
  const re = /\r?\n(---|\.\.\.)[ \t]*(?=\r?\n|$)/g;
  re.lastIndex = 3;
  const m = re.exec(t);
  if (!m) return null;
  const kopfEnde = m.index + m[0].length;
  const rest = /^\r?\n/.exec(t.slice(kopfEnde));
  return { kopfEnde, restStart: kopfEnde + (rest ? rest[0].length : 0) };
}

// Ein Titel als Wert im Kopf: so, dass der Kopf gültig bleibt (Doppelpunkt, #, Anführungszeichen …)
function yamlWert(s, davor) {
  if (davor === '"') return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (davor === "'") return s.replace(/'/g, "''");
  if (s === "" || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /[:#]\s|\s#|:$|\s$/.test(s) || /^(true|false|null|yes|no|on|off|~|[-+]?\d[\d_.,:eE+-]*)$/i.test(s)) return JSON.stringify(s);
  return s;
}

function ersetzePlatzhalter(s, { titel, tage, inKopf }) {
  return s.replace(PLATZHALTER, (alles, name, format, versatz) => {
    const n = name.toLowerCase();
    if (n === "titel") {
      if (format !== undefined) return alles; // {{titel:x}} gibt es nicht
      return inKopf ? yamlWert(titel, s[versatz - 1]) : titel;
    }
    return formatiereDatum(format !== undefined && format !== "" ? format : n === "datum" ? "JJJJ-MM-TT" : "HH:mm", tage);
  });
}

/**
 * Füllt eine Vorlage. → { text, cursor } mit cursor = Offset im fertigen Text oder null (kein {{cursor}}).
 * `jetzt`/`zone`: Zeitpunkt und Zeitzone der Uhrzeit; `iso` setzt den Kalendertag für {{datum}} fest (Tagesnotiz eines anderen Tages).
 * Zeilenenden werden zu \n.
 */
export function renderVorlage(text, { titel = "", jetzt = new Date(), zone, iso } = {}) {
  const tage = ortsZeit(jetzt, zone);
  if (iso !== undefined && iso !== null) { if (!istIso(iso)) throw new TypeError("iso muss ein gültiges Datum JJJJ-MM-TT sein"); tage.iso = iso; }
  const einzeilig = String(titel ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").split(MARKE).join("").trim();
  const quelle = String(text ?? "").replace(/\r\n?/g, "\n").split(MARKE).join("").replace(CURSOR, MARKE);
  const g = kopfGrenzen(quelle);
  const kopf = g ? ersetzePlatzhalter(quelle.slice(0, g.restStart), { titel: einzeilig, tage, inKopf: true }) : "";
  const rumpf = ersetzePlatzhalter(g ? quelle.slice(g.restStart) : quelle, { titel: einzeilig, tage, inKopf: false });
  const fertig = kopf + rumpf;
  const i = fertig.indexOf(MARKE);
  return { text: fertig.split(MARKE).join(""), cursor: i < 0 ? null : i };
}

// Erste Überschrift der Ebene 1 im Rumpf (außerhalb von Code-Blöcken): { start, ende } der Zeile (ohne \n) oder null
function ersteUeberschrift(text, ab) {
  let pos = ab, code = false;
  while (pos <= text.length) {
    let ende = text.indexOf("\n", pos);
    if (ende < 0) ende = text.length;
    const zeile = text.slice(pos, ende);
    if (/^(```|~~~)/.test(zeile)) code = !code;
    else if (!code && /^#[ \t]/.test(zeile + " ") && !/^##/.test(zeile)) return { start: pos, ende };
    if (ende >= text.length) break;
    pos = ende + 1;
  }
  return null;
}

/**
 * Der Text einer neuen Notiz aus einer Vorlage: Platzhalter gefüllt, der Kopf der Vorlage bleibt GANZ OBEN (genau einmal), und hat der Rumpf keine
 * Überschrift der Ebene 1, steht der Titel als „# Titel“ direkt unter dem Kopf. Ohne Vorlage (null) entsteht „# Titel“.
 * Cursor: bei {{cursor}} dort; sonst (Titel leer) hinter der ersten Überschrift, damit man den Titel tippt, sonst am Ende.
 * → { text, cursor }
 */
export function baueNotizText({ vorlage = null, titel = "", jetzt, zone, iso } = {}) {
  const t = String(titel ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  const r = vorlage === null || vorlage === undefined ? { text: "", cursor: null } : renderVorlage(vorlage, { titel: t, jetzt, zone, iso });
  let text = r.text, cursor = r.cursor;
  const g = kopfGrenzen(text);
  const rumpfStart = g ? g.restStart : 0;
  let h1 = ersteUeberschrift(text, rumpfStart);
  if (!h1) {
    const zeile = `# ${t}`.trimEnd() + (t ? "" : " ");
    const einfuegen = zeile + (text.slice(rumpfStart).trim() ? "\n\n" : "\n");
    text = text.slice(0, rumpfStart) + einfuegen + text.slice(rumpfStart);
    if (cursor !== null && cursor >= rumpfStart) cursor += einfuegen.length;
    h1 = { start: rumpfStart, ende: rumpfStart + zeile.length };
  }
  if (!text.endsWith("\n")) { text += "\n"; }
  if (cursor === null) cursor = t ? text.length : h1.ende;
  return { text, cursor: Math.min(cursor, text.length) };
}

/**
 * Titel einer Notiz für den Dateinamen: die erste nicht leere Überschrift der Ebene 1, sonst die erste nicht leere Zeile (ohne Markdown-Zeichen).
 * Leer (nur „# “ oder nichts) → null: so eine Notiz bekommt keine Datei. ersatz: false = eine leere Titelzeile „# “ ist KEIN Titel, auch wenn darunter Text steht
 * (das Studio wartet beim Tippen auf den Titel und nimmt den Ersatz erst beim Verlassen der Notiz, damit nie Text verloren geht).
 */
export function titelAusText(text, { ersatz = true } = {}) {
  const t = String(text ?? "").replace(/\r\n?/g, "\n");
  const g = kopfGrenzen(t);
  const rumpf = t.slice(g ? g.restStart : 0);
  let ersteZeile = null, code = false;
  for (const zeile of rumpf.split("\n")) {
    if (/^(```|~~~)/.test(zeile)) code = !code;
    if (!ersatz && !code && /^#[ \t]*$/.test(zeile)) return null; // eine leere Titelzeile wartet auf ihren Titel: ohne Ersatz kein Titel
    const h1 = !code && /^#[ \t]+(.*\S.*)$/.exec(zeile);
    if (h1) return h1[1].replace(/[ \t]+#+[ \t]*$/, "").trim().slice(0, 200) || null;
    if (ersteZeile === null && zeile.trim() && !/^#{1,6}[ \t]*$/.test(zeile)) ersteZeile = zeile;
  }
  if (ersteZeile === null) return null;
  const rein = ersteZeile.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+)/, "").replace(/[*_`~]/g, "").trim();
  return rein.slice(0, 80) || null;
}

// ---------------------------------------------------------------------------------------------------------------- Tagesnotiz
// Einstellungen säubern: Ordner und Format kommen aus der Seite „Einstellungen“ und sind nur Text. Nichts darf aus dem Vault hinausführen.
function sauberePfadteile(s) {
  return String(s ?? "").split("/").map((x) => x.replace(/[\u0000-\u001f\u007f:\\]/g, "-").trim()).filter((x) => x && x !== "." && x !== "..");
}
export function tagesnotizEinstellungen(roh = {}) {
  const ordner = sauberePfadteile(roh.tagesnotizOrdner).join("/") || STANDARD.tagesnotizOrdner;
  const format = String(roh.tagesnotizFormat ?? "").trim() || STANDARD.tagesnotizFormat;
  return { ordner, format };
}

/** Pfad der Tagesnotiz eines Tages: „Tagebuch/2026-11-05.md“ (Ordner und Format aus den Einstellungen). */
export function tagesnotizPfad(einstellungen, iso) {
  if (!istIso(iso)) return null;
  const { ordner, format } = tagesnotizEinstellungen(einstellungen);
  const name = sauberePfadteile(formatiereDatum(format, { iso })).join("/").replace(/\.md$/i, "") || iso;
  return `${ordner}/${name}.md`;
}

const REGEX_SONDER = /[.*+?^${}()|[\]\\]/g;
/**
 * Zu welchem Tag gehört dieser Pfad? Gegenprobe: der Pfad muss genau dem entsprechen, den `tagesnotizPfad` für diesen Tag bildet (kein Zufallstreffer).
 * Zahlenformate werden direkt gelesen; Formate mit Namen (MMMM, WWWW …) probiert die Funktion rund um `heute` durch (±800 Tage). → ISO-Datum oder null.
 */
export function tagesnotizDatum(einstellungen, pfad, heute) {
  if (typeof pfad !== "string") return null;
  const { ordner, format } = tagesnotizEinstellungen(einstellungen);
  if (!pfad.startsWith(ordner + "/")) return null;
  const bestaetigt = (iso) => (iso && istIso(iso) && tagesnotizPfad(einstellungen, iso) === pfad ? iso : null);
  const gruppen = [];
  let quelle = "", letzte = 0, ok = true;
  for (const m of format.matchAll(FORMAT_ZEICHEN)) {
    quelle += format.slice(letzte, m.index).replace(REGEX_SONDER, "\\$&");
    letzte = m.index + m[0].length;
    const z = m[0];
    if (z[0] === "[") quelle += (m[1] ?? "").replace(REGEX_SONDER, "\\$&");
    else if (z === "JJJJ") { quelle += "(\\d{4})"; gruppen.push("j4"); }
    else if (z === "JJ") { quelle += "(\\d{2})"; gruppen.push("j2"); }
    else if (z === "MM") { quelle += "(\\d{2})"; gruppen.push("m"); }
    else if (z === "M") { quelle += "(\\d{1,2})"; gruppen.push("m"); }
    else if (z === "TT") { quelle += "(\\d{2})"; gruppen.push("t"); }
    else if (z === "T") { quelle += "(\\d{1,2})"; gruppen.push("t"); }
    else { ok = false; break; }
  }
  if (ok) {
    quelle += format.slice(letzte).replace(REGEX_SONDER, "\\$&");
    const hat = (k) => gruppen.some((g) => g === k);
    if ((hat("j4") || hat("j2")) && hat("m") && hat("t")) {
      const m = new RegExp(`^${quelle}$`).exec(pfad.slice(ordner.length + 1).replace(/\.md$/i, ""));
      if (m) {
        const w = {};
        gruppen.forEach((g, i) => { w[g] = m[i + 1]; });
        const jahr = w.j4 ?? String(2000 + +w.j2);
        return bestaetigt(`${jahr}-${zwei(+w.m)}-${zwei(+w.t)}`);
      }
      return null;
    }
  }
  if (!istIso(heute)) return null;
  for (let n = 0; n <= 800; n++) {
    for (const s of n === 0 ? [0] : [-1, 1]) {
      const iso = plusTageIso(heute, s * n);
      if (tagesnotizPfad(einstellungen, iso) === pfad) return iso;
    }
  }
  return null;
}

/** Name einer Vorlage für die Anzeige: Dateiname ohne Endung. */
export const vorlagenName = (pfad) => String(pfad ?? "").split("/").pop().replace(/\.(md|txt)$/i, "");

/** Pfad liegt in dem Ordner (Groß/klein egal wie im Dateisystem des Macs): „Vorlagen/Projekt.md“ in „Vorlagen“. */
export function imOrdner(pfad, ordner) {
  const o = sauberePfadteile(ordner).join("/").toLowerCase();
  return !!o && String(pfad ?? "").toLowerCase().startsWith(o + "/");
}
