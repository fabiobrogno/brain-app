// gemeinsam/app-einstellungen.mjs — die Einstellungen der App selbst (nicht eines Vaults): <support>/einstellungen.json.
// Was zu einem Vault gehört (Pflege, Automatik, Sicherung …), steht weiter in dessen brain.config.json#automatik (kern/einstellungen.mjs, auch
// `brain einstellungen`); hier liegt nur, was für den ganzen Mac gilt: Darstellung, Mitteilungen. Eine Wahrheit je Wert — die Seite „Einstellungen“
// (werkstatt/einstellungen.mjs) führt beide Speicher in einer Route zusammen.
// Optimistische Sperre wie im Kern: `stand` = SHA-256 der rohen Dateibytes (fehlt die Datei: der Stand des leeren Textes). Geschrieben wird atomar
// (tmp + rename), nur geänderte Werte stehen in der Datei, `null` entfernt einen Wert (zurück auf den Standard). Eine kaputte Datei wird nie
// stillschweigend überschrieben: lesen liefert die Standardwerte und einen Fehlertext, schreiben meldet 500, bis sie repariert oder entfernt ist.
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HttpFehler } from "./basis.mjs";

export const DATEI = "einstellungen.json";

// Gleiche Form wie das Schema des Kerns (werte | typ + Grenzen), damit die Oberfläche beide gleich behandelt.
export const APP_SCHEMA = {
  // Darstellung (Paket „Darstellung“): alle Werte gelten sofort im ganzen Studio (studio/darstellung.js wendet sie an). Listen der Werte: studio/darstellung.js (Tests prüfen, dass beide übereinstimmen).
  erscheinung: { werte: ["system", "hell", "dunkel"], standard: "system" },
  schemaHell: { werte: ["standard", "papier", "kontrast"], standard: "standard" },
  schemaDunkel: { werte: ["standard", "graphit", "mitternacht", "kontrast"], standard: "standard" },
  akzent: { werte: ["indigo", "blau", "violett", "rosa", "rot", "orange", "bernstein", "gruen", "graphit"], standard: "indigo" },
  dichte: { typ: "ganzzahl", min: 0, max: 4, standard: 2 },
  editorSchrift: { werte: ["geist", "serif", "mono"], standard: "geist" },
  schriftgroesse: { typ: "ganzzahl", min: 12, max: 22, standard: 16 },
  oberflaeche: { werte: [90, 100, 110, 125], standard: 100 },
  zeilenbreite: { werte: ["schmal", "normal", "breit", "voll"], standard: "normal" },
  codeSchrift: { werte: ["geist", "system", "menlo"], standard: "geist" },
  // Format-Leiste über markiertem Text im Editor (Runde 3b)
  formatLeiste: { typ: "boolean", standard: true },
  // Zeilenumbrüche im Editor (Runde 4): aus = fest umbrochene Absätze wie getippt; an = als Fließtext, ohne beim Betreten aufzuklappen
  zeilenFliessend: { typ: "boolean", standard: false },
  symbole: { werte: ["einfarbig", "farbig"], standard: "einfarbig" },
  // Seitenleiste durchscheinend (Fenstermaterial der Hülle; ohne Hülle-Fähigkeit blendet die Oberfläche die Zeile aus, der Wert bleibt gemerkt)
  seitenleisteDurchscheinend: { typ: "boolean", standard: true },
  bewegung: { werte: ["system", "reduziert"], standard: "system" },
  // Dock-Symbol (Swift: AppSymbol; Dateien Ressourcen/AppSymbole): gilt, solange Kortex läuft; „standard“ = AppIcon.icns, die App setzt dann kein eigenes Bild
  appSymbol: { werte: ["standard", "dunkel", "graphit", "papier", "smaragd"], standard: "standard" },
  // Mitteilungen: gemerkt wird die Wahl jetzt, ausgelöst werden die Mitteilungen mit Paket P8
  mitteilungenNurImHintergrund: { typ: "boolean", standard: true },
  mitteilungenTon: { typ: "boolean", standard: false },
  mitteilungenAbgelegt: { typ: "boolean", standard: true },
  mitteilungenAbgewiesen: { typ: "boolean", standard: true },
  mitteilungenRueckfragen: { typ: "boolean", standard: true },
  mitteilungenSicherung: { typ: "boolean", standard: true },
  mitteilungenKontingent: { typ: "boolean", standard: true },
  mitteilungenPflege: { typ: "boolean", standard: false },
  // KI & Konten: E-Mail und Tarif eines Kontos zeigt Kortex nur, wenn das Programm sie selbst nennt (`claude auth status`); gespeichert wird davon nie etwas. Aus = Kortex fragt sie gar nicht erst ab.
  kiKontonamen: { typ: "boolean", standard: true },
  // Kontingent (Paket E5): Eintrag je Konto in der Statusleiste an/aus, Anzeige „verbraucht“ oder „übrig“ (Balken und Prozent; die Farbe folgt immer dem Verbrauch). Wörter und Format der Statusleiste lassen sich einzeln ausblenden
  // (Rechtsklick auf die Leiste). Die Mitteilung bei 80 % und 100 % ist `mitteilungenKontingent` (oben).
  kiKontingentStatusleiste: { typ: "boolean", standard: true },
  kiKontingentAnzeige: { werte: ["verbraucht", "uebrig"], standard: "verbraucht" },
  statusWoerter: { typ: "boolean", standard: true },
  statusFormat: { typ: "boolean", standard: true },
  // „Entfernen“ eines Kortex-Kontos fragt vorher nach; „Nicht mehr fragen“ in der Rückfrage stellt das aus (nur beim Bestätigen), hier kommt man zurück.
  kiKontoEntfernenFragen: { typ: "boolean", standard: true },
  // Schreiben: Tagesnotiz (gemeinsam/vorlagen.mjs). Ordner relativ zum Vault, Format mit JJJJ MM TT … (siehe dort); leer/null = Standard. Der Vorlagenordner ist Sache des Vaults (brain.config.json: ordner.vorlagen).
  // Die Vorlage der Tagesnotiz ist der Name (oder Pfad) einer Notiz im Vorlagenordner; leer = keine Vorlage.
  tagesnotizOrdner: { typ: "pfad", standard: "Tagebuch" },
  tagesnotizFormat: { typ: "pfad", standard: "JJJJ-MM-TT" },
  tagesnotizVorlage: { typ: "pfad", standard: "" },
  // Anhänge (Runde 3, Paket 3a; gemeinsam/anhaenge.mjs): Ort „vault“ = <Ordner> an der Wurzel des Vaults, „notiz“ = <Ordner> im Ordner der Notiz; größte Datei in MB; externe Bilder (https) nur laden, wenn das hier an ist
  // (sonst Platzhalter mit Klick). Der Ordnername ist ein einfacher Pfad im Vault.
  anhaengeOrt: { werte: ["vault", "notiz"], standard: "vault" },
  anhaengeOrdner: { typ: "pfad", standard: "_anhaenge" },
  anhaengeMaxMB: { typ: "ganzzahl", min: 1, max: 100, standard: 20 },
  externeBilder: { typ: "boolean", standard: false },
  // Sicherung: Fassungen automatisch anlegen = nach dem Speichern im Studio legt Kortex lokal eine Version an (nur Notizen; die Hintergrund-Sicherung lädt sie danach hoch, wenn GitHub eingerichtet ist).
  // Automatisch abgleichen = vorbereitet, Standard aus und noch ohne Wirkung („kommt bald“): gemerkt wird die Wahl, ausgelöst wird nichts.
  fassungenAutomatisch: { typ: "boolean", standard: true },
  abgleichAutomatisch: { typ: "boolean", standard: false },
};
// Ältere oder gleichwertige Schreibweisen werden beim Lesen übernommen (nie beim Schreiben erzeugt): `breit: true` und `thema` aus der Zeit, als Lesebreite und Thema nur im Browserspeicher
// lagen (das Studio schreibt sie beim ersten Start hierher), und die Namen „ny“/„sf“ der Editor-Schrift aus dem Entwurf.
export function migriere(j) {
  const m = { ...j };
  if (m.zeilenbreite === undefined && m.breit === true) m.zeilenbreite = "breit";
  if (m.erscheinung === undefined && ["hell", "dunkel", "system"].includes(m.thema)) m.erscheinung = m.thema;
  if (m.editorSchrift === "ny") m.editorSchrift = "serif";
  if (m.editorSchrift === "sf") m.editorSchrift = "mono";
  if (m.codeSchrift === "sf") m.codeSchrift = "system";
  if (m.symbole === "color") m.symbole = "farbig";
  if (m.symbole === "mono") m.symbole = "einfarbig";
  delete m.breit; delete m.thema;
  return m;
}
export const APP_STANDARD = Object.fromEntries(Object.entries(APP_SCHEMA).map(([k, s]) => [k, s.standard]));

const standVon = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
export const LEERER_STAND = standVon("");

export function istGueltig(schema, wert) {
  if (schema.werte) return schema.werte.includes(wert);
  if (schema.typ === "boolean") return typeof wert === "boolean";
  if (schema.typ === "ganzzahl") return Number.isInteger(wert) && wert >= schema.min && wert <= schema.max;
  if (schema.typ === "pfad") return typeof wert === "string" && wert.trim().length >= 1 && wert.length <= 300 && !/[\u0000-\u001f\u007f]/.test(wert);
  return false;
}

// → { werte (Standard + Gespeichertes, nur Gültiges), gespeichert (nur was in der Datei steht), stand, fehler (Text oder null) }
export function leseApp(support) {
  const datei = join(support, DATEI);
  let text = "";
  try { text = readFileSync(datei, "utf8"); }
  catch (e) { if (e.code !== "ENOENT") return { werte: { ...APP_STANDARD }, gespeichert: {}, stand: LEERER_STAND, fehler: "Die Einstellungen der App konnten nicht gelesen werden.", text: null }; }
  const stand = standVon(text);
  if (!text.trim()) return { werte: { ...APP_STANDARD }, gespeichert: {}, stand, fehler: null, text };
  let j;
  try { j = JSON.parse(text); } catch { j = undefined; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { werte: { ...APP_STANDARD }, gespeichert: {}, stand, fehler: "Die Datei mit den Einstellungen der App ist beschädigt. Kortex nutzt die Standardwerte, bis sie repariert oder gelöscht ist.", text };
  const gespeichert = {};
  j = migriere(j);
  for (const [k, schema] of Object.entries(APP_SCHEMA)) if (k in j && istGueltig(schema, j[k])) gespeichert[k] = j[k];
  return { werte: { ...APP_STANDARD, ...gespeichert }, gespeichert, stand, fehler: null, text };
}

// Prüft neu gegen das Schema (unbekannt/ungültig → 400, null = zurück auf Standard). Rein, ohne Dateizugriff.
export function pruefeApp(neu) {
  if (neu === null || typeof neu !== "object" || Array.isArray(neu)) throw new HttpFehler(400, "Einstellungen müssen ein Objekt sein.");
  const geprueft = {};
  for (const [k, wert] of Object.entries(neu)) {
    const schema = Object.hasOwn(APP_SCHEMA, k) ? APP_SCHEMA[k] : undefined;
    if (!schema) throw new HttpFehler(400, `Unbekannte Einstellung „${k}“.`);
    if (wert !== null && !istGueltig(schema, wert)) throw new HttpFehler(400, `Ungültiger Wert für „${k}“.`);
    geprueft[k] = wert;
  }
  return geprueft;
}

// Schreibt die geprüften Werte (zusammengeführt mit dem, was schon dort steht). stand = der Stand, auf dem der Nutzer aufbaute: weicht die Datei ab → 409.
export function schreibeApp(support, neu, stand) {
  const geprueft = pruefeApp(neu);
  const jetzt = leseApp(support);
  if (jetzt.fehler) throw new HttpFehler(500, `Einstellungen der App nicht geschrieben: ${jetzt.fehler}`);
  if (jetzt.stand !== String(stand)) throw new HttpFehler(409, "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.", { art: "konflikt" });
  const zusammen = { ...jetzt.gespeichert };
  for (const [k, w] of Object.entries(geprueft)) { if (w === null) delete zusammen[k]; else zusammen[k] = w; }
  const inhalt = Object.keys(zusammen).length ? JSON.stringify(zusammen, null, 2) + "\n" : "";
  mkdirSync(support, { recursive: true });
  const datei = join(support, DATEI), tmp = `${datei}.${process.pid}.tmp`;
  try { writeFileSync(tmp, inhalt); renameSync(tmp, datei); }
  catch (e) { try { unlinkSync(tmp); } catch { /* egal */ } throw new HttpFehler(500, `Schreiben fehlgeschlagen: ${e.code || e.message}`); }
  return { stand: standVon(inhalt) };
}
