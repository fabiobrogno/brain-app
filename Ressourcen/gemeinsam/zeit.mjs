// gemeinsam/zeit.mjs — EINE Regel für „heute“ und Tageszeiten: die Zeitzone des Macs (Ortszeit), überall.
// Werkstatt (Dateinamen im Posteingang, Fälligkeiten, Verlauf nach Tagen, Sicherungsnamen), MCP und Studio (Board, „überfällig“, Filter) rechnen damit
// gleich; früher rechnete die Werkstatt in Berliner Zeit und das Studio in Ortszeit, abends oder nach der Zeitumstellung stimmten Datei und Anzeige nicht überein.
// Ohne Angabe gilt die Zeitzone des Prozesses (Node: Umgebungsvariable TZ bzw. Systemeinstellung; Browser: die des Macs). Eine Zone wird NUR eingespritzt
// (Parameter `zone`), wenn jemand eine feste Rechnung braucht: die CI-Tests (Runner laufen in UTC) setzen „Europe/Berlin“ — das ist der einzige Ort für Berlin.
// Reine Funktionen, keine Abhängigkeiten. Die Studio-Kopie (Ressourcen/studio/zeit.js) erzeugt scripts/erzeuge-gemeinsam-kopien.mjs — nicht von Hand ändern.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// Zone prüfen: unbekannte Namen fallen auf die Zone des Prozesses zurück (statt zu werfen)
function zoneOderNichts(zone) {
  if (!zone || typeof zone !== "string") return undefined;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { return undefined; }
}

// Mit fester Zone darf man zwischenspeichern; der Standard (Zone des Prozesses) nicht: Node liest TZ beim Anlegen, ein späteres process.env.TZ = … soll wirken.
const formate = new Map();
function formatierer(zone, optionen) {
  if (!zone) return new Intl.DateTimeFormat("sv-SE", optionen);
  const schluessel = zone + "|" + JSON.stringify(optionen);
  let f = formate.get(schluessel);
  if (!f) { f = new Intl.DateTimeFormat("sv-SE", { ...optionen, timeZone: zone }); formate.set(schluessel, f); }
  return f;
}

/** Name der Zeitzone, in der gerechnet wird (die eingespritzte `zone` oder die des Prozesses). */
export function zeitzone(zone) { return zoneOderNichts(zone) || new Intl.DateTimeFormat().resolvedOptions().timeZone; }

/** „JJJJ-MM-TT“ des Zeitpunkts d in der Zeitzone des Macs (oder der eingespritzten `zone`). */
export function heuteIso(d = new Date(), zone) {
  return formatierer(zoneOderNichts(zone), { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** „JJJJMMTT-HHMMSS“ der Ortszeit (Dateinamen von Sicherungen). */
export function stempel(d = new Date(), zone) {
  const t = Object.fromEntries(formatierer(zoneOderNichts(zone), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return `${t.year}${t.month}${t.day}-${t.hour}${t.minute}${t.second}`;
}

/** ISO-Datum plus n Kalendertage (reine Kalenderrechnung, keine Sommerzeit-Fallen). Ungültiges Datum → null. */
export function plusTageIso(iso, n) {
  const m = ISO.exec(String(iso ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Wochentag eines ISO-Datums: 0 = Sonntag … 6 = Samstag; ungültig → null. */
export function wochentagIso(iso) {
  const m = ISO.exec(String(iso ?? ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null;
}
