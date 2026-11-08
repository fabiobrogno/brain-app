// ERZEUGT von scripts/erzeuge-gemeinsam-kopien.mjs aus Ressourcen/gemeinsam/anhang-regeln.mjs — nicht von Hand ändern.
// gemeinsam/anhang-regeln.mjs — EINE Regel für Anhänge (Bilder, PDFs, Dateien in Notizen): welche Typen es gibt, was inline als Bild gezeigt wird, wie ein Name aussieht
// und wie eine Einbettung im Text geschrieben und gelesen wird. Reine Funktionen, keine Abhängigkeiten. Genutzt von der Werkstatt (gemeinsam/anhaenge.mjs) und vom
// Studio (Editor, Frag deinen Vault). Die Studio-Kopie (Ressourcen/studio/anhang-regeln.js) erzeugt scripts/erzeuge-gemeinsam-kopien.mjs — nicht von Hand ändern.
//
// Format im Text (Obsidian-kompatibel): `![[datei.png]]`, mit Breite `![[datei.png|300]]`; gelesen werden auch `![Alt](pfad/datei.png)` und `![[ordner/datei.png]]`.
// Der Name ist im Vault eindeutig (Datum, Uhrzeit, Slug), deshalb löst Kortex ihn über den Dateinamen auf (gemeinsam/anhaenge.mjs#loeseAnhang).

/** Was inline als Bild gezeigt wird (nur diese; SVG nur als <img>, nie als Dokument). */
export const BILD_TYPEN = Object.freeze({
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
});
/** Weitere harmlose Dateien: erscheinen als Chip und öffnen mit dem Programm des Systems. Ausführbares und aktive Inhalte (html, js, exe, app, sh, bat, command …) fehlen mit Absicht. */
export const DATEI_TYPEN = Object.freeze({
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", rtf: "application/rtf", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
});
export const ANHANG_TYPEN = Object.freeze({ ...BILD_TYPEN, ...DATEI_TYPEN });

/** Endung ohne Punkt, klein („Foto.JPG“ → „jpg“); leer, wenn keine. */
export const endungVon = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? "")) || [, ""])[1].toLowerCase();
export const istBildName = (name) => Object.hasOwn(BILD_TYPEN, endungVon(name));
export const istAnhangName = (name) => Object.hasOwn(ANHANG_TYPEN, endungVon(name));
export const mimeFuer = (name) => ANHANG_TYPEN[endungVon(name)] || "application/octet-stream";

/** Standardgrenzen (Einstellungen: anhaengeMaxMB). */
export const MAX_MB_STANDARD = 20, MAX_MB_GRENZE = 100;
/** Ab dieser Größe weist Kortex darauf hin, dass der Vault (Git, Abgleich) dadurch wächst. */
export const GROSS_HINWEIS_BYTES = 5 * 1024 * 1024;

/** „2,4 MB“, „830 KB“, „12 Byte“ (deutsch). */
export function groesseText(bytes) {
  const n = Number(bytes) || 0;
  const f = (x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(".", ",").replace(/,0$/, ""));
  if (n >= 1024 * 1024) return `${f(n / 1024 / 1024)} MB`;
  if (n >= 1024) return `${f(n / 1024)} KB`;
  return `${n} Byte`;
}

/** Kurzname für Dateien aus der Zwischenablage oder mit Sonderzeichen: klein, ohne Umlaute und Zeichen außerhalb von a-z, 0-9 und „-“. */
export function slugAnhang(name, max = 40) {
  const stamm = String(name ?? "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const t = stamm.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return t || "datei";
}

/** Zeitstempel für Dateinamen: JJJJ-MM-TT-HHMMSS in der Ortszeit des Prozesses. */
export function zeitstempel(d = new Date()) {
  const z = (x, n = 2) => String(x).padStart(n, "0");
  return `${z(d.getFullYear(), 4)}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/** Der Text, den Kortex für einen Anhang in die Notiz schreibt. */
export const einbettungsText = (name) => `![[${name}]]`;

// ![[ziel]] oder ![[ziel|Breite]] (Obsidian: Zahl = Breite in Pixel, sonst Beschreibung). Ziel ohne | # [ ] und Zeilenumbruch.
export const EINBETTUNG = /!\[\[([^\[\]\n|#]+?)(?:#[^\[\]\n|]*)?(?:\|([^\[\]\n]*))?\]\]/g;

/** Ein Treffer der Einbettung → { ziel, breite (Zahl|null), alt (Text|"") }. */
export function einbettungAus(m) {
  const ziel = String(m[1]).trim();
  const rest = m[2] === undefined ? "" : String(m[2]).trim();
  const zahl = /^(\d{1,4})(?:x\d{1,4})?$/.exec(rest);
  return { ziel, breite: zahl ? Math.min(4000, Number(zahl[1])) : null, alt: zahl ? "" : rest };
}

/** Adresse mit Schema (https:, data:, mailto: …) oder „//“: kein Pfad im Vault. */
export const istAdresse = (s) => /^[a-z][a-z0-9+.-]*:/i.test(String(s)) || String(s).startsWith("//");

/** Markdown-Ziel `bild.png`, `./a/bild.png`, `a%20b.png` → lesbarer Pfad ohne Prozent-Kodierung, Abfrage und Anker (oder null bei Adressen). */
export function lokalerPfad(roh) {
  let s = String(roh ?? "").trim();
  if (!s || istAdresse(s)) return null;
  s = s.replace(/^<|>$/g, "");
  const i = s.search(/[?#]/);
  if (i >= 0) s = s.slice(0, i);
  try { s = decodeURIComponent(s); } catch { /* bleibt */ }
  return s || null;
}

/** Adresse, unter der die Werkstatt einen Anhang ausliefert (kein /api/…: die Mac-App reicht nur diese Pfade als Seitenabruf durch). `von` = Notiz, für relative Ziele. */
export function anhangUrl(ziel, von = "") {
  // Das Ziel steht in der Abfrage, nicht im Pfad: „../“ würde schon der Browser auflösen
  return `/_anhang?ziel=${encodeURIComponent(ziel)}${von ? `&von=${encodeURIComponent(von)}` : ""}`;
}
/** Adresse eines externen Bildes über die Werkstatt (nur nach Zustimmung des Nutzers). */
export const externBildUrl = (adresse) => `/_extern-bild?url=${encodeURIComponent(adresse)}`;
