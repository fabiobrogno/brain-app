// Tastenkürzel im Studio (Paket P10): der Zustand (Register + eigene Kürzel), das Auslösen der Befehle bei einem Tastendruck und das Speichern über GET/PUT /api/tastenkuerzel.
// Eine Quelle: das Register (gemeinsam/tastenkuerzel-register.json, hier als tastenkuerzel-register.js) nennt alle Befehle mit Standardkürzel — Studio, Menüs der App und globale
// Kürzel lesen dasselbe. Wer einen neuen Befehl mit Kürzel braucht, trägt ihn ins Register ein und meldet seine Aktion mit anmelden(id, tun) an; mehr nicht.
// Eigene Kürzel gelten sofort (kein Neustart): Änderungen kommen aus dem Editor (Einstellungen → Tastenkürzel) oder per Live-Ereignis (die App oder ein zweites Fenster hat geschrieben).
// Die reine Logik (Schreibweise, Konflikte, reservierte Kürzel) steht in tastenkuerzel-logik.js und wird auch in Node getestet.
import { REGISTER } from "./tastenkuerzel-register.js";
import * as L from "./tastenkuerzel-logik.js";
import { api, aktion, aktionMitAntwort, inApp } from "./api.js";

export { REGISTER, L as logik };
export const istMac = () => /Mac|iPhone|iPad/.test(navigator.platform || "");
const befehl = (id) => REGISTER.befehle.find((b) => b.id === id) || null;
// Globale Kürzel löst macOS aus (die App meldet sie an); das Studio horcht nur auf die übrigen
const WEB = { ...REGISTER, befehle: REGISTER.befehle.filter((b) => !b.global) };

const Z = { ueber: {}, stand: null, fehler: null, belegung: L.wirksam(REGISTER, {}), suche: L.nachschlagen(WEB, {}), geladen: false };
const hoerer = new Set();
const aktionen = new Map(); // id → { tun, wenn }

function berechne() {
  Z.belegung = L.wirksam(REGISTER, Z.ueber);
  Z.suche = L.nachschlagen(WEB, Z.ueber);
}
const melde = () => { for (const f of [...hoerer]) { try { f(); } catch { /* ein Hörer darf die anderen nicht stoppen */ } } };
export const beiAenderung = (f) => { hoerer.add(f); return () => hoerer.delete(f); };

// ---- Lesen
export const zustand = () => ({ ueberschrieben: { ...Z.ueber }, belegung: { ...Z.belegung }, stand: Z.stand, fehler: Z.fehler, geladen: Z.geladen });
export const kuerzelVon = (id) => Z.belegung[id] ?? null;
export const anzeigeTeile = (id) => (kuerzelVon(id) ? L.anzeigeTeile(kuerzelVon(id), REGISTER) : []);
export const anzeige = (id) => anzeigeTeile(id).join("");
export const geaendert = (id) => L.istGeaendert(REGISTER, Z.ueber, id);
export const standardVon = (id) => befehl(id)?.standard ?? null;
export const konflikteFuer = (id, kuerzel) => L.konflikte(REGISTER, Z.belegung, id, kuerzel);
export const konfliktIds = () => L.konfliktIds(REGISTER, Z.belegung);
export const anzahlGeaendert = () => REGISTER.befehle.filter((b) => geaendert(b.id)).length;

// ---- Laden und Speichern
function uebernimm(d) {
  Z.ueber = L.saeubere(REGISTER, d?.ueberschrieben);
  Z.stand = d?.stand ?? null; Z.fehler = d?.fehler || null; Z.geladen = true;
  berechne(); melde();
}
export async function lade() {
  try { uebernimm(await api.tastenkuerzel()); return true; }
  catch { return false; } // ohne Werkstatt gelten die Standardkürzel
}
// aenderung: { werte: { id: "Cmd+T" | null }, zurueck: ["id"] | "alle" }. Gilt sofort (optimistisch); schlägt das Speichern fehl, wird neu gelesen und der Fehler weitergegeben.
export async function schreibe(aenderung) {
  const vorher = { ...Z.ueber };
  const neu = aenderung.zurueck === "alle" ? {} : { ...Z.ueber };
  if (Array.isArray(aenderung.zurueck)) for (const id of aenderung.zurueck) delete neu[id];
  for (const [id, w] of Object.entries(aenderung.werte || {})) neu[id] = w;
  Z.ueber = neu; berechne(); melde();
  try {
    if (Z.stand === null) await lade(); // noch nie gelesen: erst den Stand holen
    const r = await api.tastenkuerzelSchreiben(aenderung, Z.stand);
    uebernimm(r);
    if (inApp()) aktion("kuerzel-geaendert"); // die App liest die Datei neu: Menüs und globale Kürzel folgen sofort
    return r;
  } catch (e) {
    Z.ueber = vorher; berechne(); melde();
    await lade();
    throw e;
  }
}
// Globales Kürzel: erst fragt die App, ob macOS es hergibt (belegt, reserviert, Systemkürzel). → { ok: true } | { ok: false, text } ; ohne App (Browser) gibt es nichts zu melden
export async function pruefeGlobal(id, kuerzel) {
  if (!inApp() || !befehl(id)?.global) return { ok: true };
  const r = await aktionMitAntwort("kuerzel-global", { id, kuerzel });
  if (r && typeof r === "object" && r.ok === false) return { ok: false, text: String(r.text || "Dieses Kürzel lässt sich nicht anmelden.") };
  return { ok: true };
}

// ---- Auslösen
// Aktion eines Befehls anmelden; wenn(e) → false: das Kürzel gilt jetzt nicht (z. B. kein Vault offen, Dialog offen) und der Tastendruck bleibt unberührt
export function anmelden(id, tun, wenn = null) {
  if (!befehl(id)) throw new Error(`Befehl „${id}“ steht nicht im Register der Tastenkürzel.`);
  aktionen.set(id, { tun, wenn });
}
export const angemeldet = () => [...aktionen.keys()];
export function findeBefehl(e) {
  const text = L.ereignisText(e, { mac: istMac() });
  return text ? Z.suche.get(text) || null : null;
}
// Tastendruck behandeln: true = ein Befehl wurde ausgelöst (der Druck ist verbraucht)
export function behandle(e) {
  const id = findeBefehl(e);
  const a = id && aktionen.get(id);
  if (!a || (a.wenn && !a.wenn(e))) return false;
  e.preventDefault(); e.stopPropagation();
  a.tun(e);
  return true;
}
