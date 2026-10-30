// gemeinsam/aufgaben-vault.mjs — Aufgaben im Vault für Werkstatt (Studio) und MCP: die Brücke zwischen den Routen/Werkzeugen und dem Format-Modul des
// Kerns (kern/aufgaben.mjs, einzige Stelle, die das Dateiformat kennt). Dieses Modul bringt nur dazu, was ein Vault-Objekt ausmacht:
//   · Pfadschutz (basis.mjs loese/sauber) für jeden Pfad, der von außen kommt,
//   · Vertrauen: geschrieben wird nur in einen Vault, dem vertraut wird (vertrauen.mjs, Workspace-Trust P5); Lesen geht immer,
//   · Fehler des Kerns werden zu HttpFehler (Status + Alltagsmeldung).
// Der Kern wird erst beim ersten Aufruf geladen (wie die Minisuche in vault.mjs): fehlt er (Attrappen-Kern in Tests), antworten die Aufgaben mit 503.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpFehler, loese } from "./basis.mjs";

const NICHT_VERTRAUT = "Dieser Vault ist in Kortex noch nicht als deiner bestätigt, darum werden hier keine Aufgaben geschrieben. Bestätige ihn in den Einstellungen; Lesen geht schon jetzt.";
const VORSCHAU = 160;

// deps: { wurzel, kern (Ordner des Kerns), vertraut() → bool, jetzt() → Date }
export function erzeugeAufgaben(deps) {
  const { wurzel } = deps;
  let modul; // Promise | undefined
  const kernModul = () => {
    modul ??= import(pathToFileURL(join(deps.kern, "aufgaben.mjs")).href).catch(() => null);
    return modul.then((m) => {
      if (!m) { modul = undefined; throw new HttpFehler(503, "Aufgaben sind gerade nicht verfügbar (der Kern von Kortex fehlt)."); }
      return m;
    });
  };
  const uebersetze = (m, e) => {
    if (e instanceof m.AufgabeFehler) return new HttpFehler(e.code, e.message);
    return e;
  };
  const vorSchreiben = () => { if (!deps.vertraut()) throw new HttpFehler(409, NICHT_VERTRAUT, { art: "nicht-vertraut" }); };
  const kurz = (a) => {
    const { text, ...rest } = a;
    const einzeilig = text.replace(/\s+/g, " ").trim();
    return { ...rest, vorschau: einzeilig.length > VORSCHAU ? `${einzeilig.slice(0, VORSCHAU - 1)}…` : einzeilig };
  };

  // GET: alle Aufgaben, sortiert (rang), mit Zähler und Ordner. vertraut sagt der Oberfläche, ob sie schreiben darf.
  async function aufgaben() {
    const m = await kernModul();
    let l;
    try { l = m.liste(wurzel); } catch (e) { throw uebersetze(m, e); }
    return { ordner: m.ordnerName(wurzel), vertraut: deps.vertraut(), abgeschnitten: l.abgeschnitten === true, zaehler: m.zaehleAus(l, m.heuteBerlin(deps.jetzt())), aufgaben: l.map(kurz) };
  }

  // neue Aufgabe. e: { titel, text?, prioritaet?, faellig?, status?, bezug?, quelle? }. Die Quelle bestimmt der AUFRUFER im Programm, nie die Eingabe von außen:
  // die Route POST /api/aufgaben setzt sie fest auf „mensch“ (handler.mjs), der MCP-Server auf „ki:<client>“.
  async function anlegen(e) {
    const m = await kernModul();
    if (!e || typeof e !== "object") throw new HttpFehler(400, "Die Eingabe fehlt.");
    vorSchreiben();
    try {
      const r = m.legeAn(wurzel, { ...e, quelle: e.quelle ?? "mensch", rang: undefined }, { jetzt: deps.jetzt() });
      return { pfad: r.pfad, aufgabe: kurz(r.aufgabe) };
    } catch (err) { throw uebersetze(m, err); }
  }

  // PATCH: Felder ändern. e: { titel?, status?, prioritaet?, faellig?, rang?, bezug?, platz?: { davor, danach } }. Der Pfad kommt von außen und wird geschützt.
  async function aendern(pfad, e) {
    const m = await kernModul();
    if (!e || typeof e !== "object") throw new HttpFehler(400, "Die Eingabe fehlt.");
    const { rel } = loese(wurzel, pfad);
    vorSchreiben();
    try {
      const { platz, text, ...rest } = e;
      if (text !== undefined) throw new HttpFehler(400, "Den Text einer Aufgabe bearbeitest du in der Datei selbst.");
      const gut = (p) => (typeof p === "string" && p ? loese(wurzel, p).rel : null);
      const r = m.aendere(wurzel, rel, { ...rest, ...(platz && typeof platz === "object" ? { platz: { davor: gut(platz.davor), danach: gut(platz.danach) } } : {}) },
        { jetzt: deps.jetzt() });
      return { pfad: r.pfad, geaendert: r.geaendert, aufgabe: kurz(r.aufgabe) };
    } catch (err) { throw uebersetze(m, err); }
  }

  // Für MCP: Liste mit Filter (Status), nur das Nötige; und Status setzen über Pfad oder Dateiname.
  async function fuerKi({ status } = {}) {
    const m = await kernModul();
    let l;
    try { l = m.liste(wurzel, { kopf: true }); } catch (err) { throw uebersetze(m, err); }
    const abgeschnitten = l.abgeschnitten === true;
    if (status) {
      if (!m.STATUS.includes(status) && status !== "alle") throw new HttpFehler(400, `Der Status ist einer von: ${m.STATUS.join(", ")}, alle.`);
      if (status !== "alle") l = l.filter((a) => a.status === status);
    } else l = l.filter((a) => a.status !== "erledigt");
    const heute = m.heuteBerlin(deps.jetzt());
    return { aufgaben: l, abgeschnitten, zeilen: l.map((a) => m.zeile(a, { heute })), zaehler: m.zaehleAus(l, heute) };
  }
  async function findePfad(eingabe) {
    const m = await kernModul();
    try { return m.findePfad(wurzel, eingabe); } catch (err) { throw uebersetze(m, err); }
  }

  // Ordnername wie in der Konfiguration (für den Notiz-Index und die Oberfläche); ohne Kern der Standard
  async function ordnerName() {
    try { return (await kernModul()).ordnerName(wurzel); } catch { return "05_aufgaben"; }
  }

  return { aufgaben, anlegen, aendern, fuerKi, findePfad, vorSchreiben, ordnerName };
}
