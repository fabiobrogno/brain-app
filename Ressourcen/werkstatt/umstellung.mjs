// werkstatt/umstellung.mjs — Umstellung eines Vaults aus der Kit-Zeit (Pakete P7a und P7b, Plan docs/plaene/p7-umstellung.md):
//   GET  /api/umstellung/befund      → Befund (kern/umstellung/befund.mjs), nur lesend (P7a)
//   GET  /api/umstellung/stand       → { phase, schritte, laeuft, unterbrochen, probelauf: {zeit, ampel, gueltig}, a9, bundle } (nur lesend)
//   POST /api/umstellung/probelauf   { bestaetigt: true, entscheidungen? }                      → Ampel je Kriterium (Probelauf an einer Kopie; ohne `bestaetigt` nur der Plan)
//   POST /api/umstellung/phase-a     { bestaetigt: true, entscheidungen?, schritte? }           → Ergebnis je Schritt A0–A9 (ohne `bestaetigt` nur der Plan; verlangt einen grünen Probelauf)
//   POST /api/umstellung/rueckweg    { bestaetigt: true, alles?: true | schritte: ["A4"] }      → Ergebnis je Schritt (ohne `bestaetigt` nur, was sich zurücknehmen lässt)
// Die Logik lebt im Kern; die Werkstatt ruft den Starter der App (`kortex umstellung … --vault <v> --json`, Muster verdrahtung.mjs) und reicht das Ergebnis durch. Es steht nie ein
// Wert in einer Antwort (kein Hook-Befehl, kein MCP-Eintrag, kein git-Wert). Geschrieben wird NUR mit `bestaetigt: true` im Body – das setzt die Oberfläche erst nach dem Klick des Nutzers.
// Vertrauen (P5): ein erfolgreich umgestellter Vault gilt als vertraut. `vermerkeVertrauen` ist die Anschlussstelle: sie ruft `erlaube` aus gemeinsam/vertrauen.mjs, sobald es das Modul
// gibt (Branch feat/vault-vertrauen / P5), sonst bleibt sie ein stiller Leerlauf. Siehe kern/umstellung/vertrauen-merker.mjs.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { HttpFehler, kindUmgebung } from "../gemeinsam/basis.mjs";
import { starte, neueFrist } from "../gemeinsam/prozess.mjs";
import { erkenneProfile } from "./profile.mjs";

const FRIST_LESEN = 60_000;
// länger als das Kopieren im Kern (KOPIE_FRIST_MS = 30 min) plus der Rest des Probelaufs
export const FRIST_SCHREIBEN = 45 * 60_000;
const BOOL = ["gitSchluessel", "verweiseAufloesen", "remoteEntfernen", "remoteBestaetigen", "hooksErsetzen", "mcpAnders", "dienstAnderer", "nachbarkopie"];
const SCHRITT = /^A[0-9]$/;

// Entscheidungen aus dem Body → "a=ja,b=nein,profile=<pfad>+<pfad>" (nur bekannte Schlüssel, nur Profile aus der erkannten Liste)
export function entscheidungenArgument(e, profile) {
  if (e === undefined || e === null) return "";
  if (typeof e !== "object" || Array.isArray(e)) throw new HttpFehler(400, "„entscheidungen“ muss ein Objekt sein.");
  const teile = [];
  for (const k of BOOL) if (e[k] !== undefined) { if (typeof e[k] !== "boolean") throw new HttpFehler(400, `„${k}“ muss true oder false sein.`); teile.push(`${k}=${e[k] ? "ja" : "nein"}`); }
  if (e.weitereMacs !== undefined) { if (e.weitereMacs !== "ja" && e.weitereMacs !== "nein") throw new HttpFehler(400, "„weitereMacs“ muss „ja“ oder „nein“ sein."); teile.push(`weitereMacs=${e.weitereMacs}`); }
  if (e.profile !== undefined) {
    if (!Array.isArray(e.profile) || e.profile.some((p) => typeof p !== "string")) throw new HttpFehler(400, "„profile“ muss eine Liste von Pfaden sein.");
    const erlaubt = new Set(profile.map((p) => p.pfad));
    if (e.profile.some((p) => !erlaubt.has(p) || p.includes("+") || p.includes(","))) throw new HttpFehler(409, "Eines der Claude-Profile gibt es nicht mehr. Suche die Profile bitte neu.", { art: "profil-weg" });
    teile.push(`profile=${e.profile.join("+")}`);
  }
  return teile.join(",");
}

export function erzeugeUmstellung({ starter, support = null, vertrauen = null }) {
  const env = () => kindUmgebung(support ? { BRAIN_APP_SUPPORT: support } : {});

  async function lauf(v, befehl, extra, frist, { json = true } = {}) {
    if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
    if (!existsSync(starter)) throw new HttpFehler(409, "Der Starter von Kortex fehlt noch. Starte Kortex einmal neu, dann wird er angelegt — danach geht es hier weiter.", { art: "kein-starter" });
    const profile = erkenneProfile();
    const args = ["umstellung", befehl, "--vault", v.wurzel, ...(json ? ["--json"] : []), ...extra, ...profile.flatMap((p) => ["--claude-home", p.pfad])];
    const r = await starte(starter, args, {
      cwd: homedir(), env: env(), timeout: frist, frist: neueFrist(frist), fehlt: "Der Starter von Kortex wurde nicht gefunden.",
      zuLange: "Das hat zu lange gedauert und wurde abgebrochen. Was schon geändert war, lässt sich rückgängig machen.",
    });
    let j = null;
    try { j = JSON.parse(String(r.stdout || "").trim().split("\n").pop()); } catch { /* unten */ }
    if (r.code === 127) throw new HttpFehler(409, "Kortex ist noch nicht vollständig bereit (Node oder der Kern fehlt). Starte Kortex neu und versuche es noch einmal.", { art: "kein-starter" });
    return { r, j, profile };
  }
  // Fehler des Kerns (Exit 3 nicht bereit, 4 Vorbedingung, 5 läuft schon …) → HttpFehler mit dem Satz des Kerns
  function fehlerAus(r, j, was) {
    const meldung = j && typeof j.meldung === "string" ? j.meldung : null;
    // „nicht vertraut“ (Exit 6, P5) und „läuft schon“ (Exit 5) sind verschiedene Lagen mit verschiedenen Sätzen – der feste Code des Kerns entscheidet, nicht der Exit-Code allein
    if (r.code === 6 || (j && j.fehler === "nicht-vertraut")) return new HttpFehler(409, meldung || "Dieser Vault ist in Kortex noch nicht als deiner bestätigt. Bestätige ihn zuerst, dann geht die Umstellung.", { art: "nicht-vertraut", code: "nicht-vertraut" });
    if (r.code === 3) return new HttpFehler(409, meldung || "Kortex ist noch nicht ganz eingerichtet.", { art: "nicht-stabil", code: j && j.fehler });
    if (r.code === 4) return new HttpFehler(409, meldung || "Eine Voraussetzung fehlt.", { art: "vorbedingung", code: j && j.fehler });
    if (r.code === 5) return new HttpFehler(409, meldung || "Es läuft gerade schon etwas.", { art: "belegt", code: (j && j.fehler) || "laeuft-schon" });
    if (r.code === 2) return new HttpFehler(409, meldung || "Dieser Ordner ist kein Vault.", { keinVault: true });
    return new HttpFehler(502, `${was} hat nicht geklappt. Am Original wurde nichts Halbes hinterlassen.`, { code: j && j.fehler });
  }

  async function befund(v) {
    const { r, j } = await lauf(v, "befund", [], FRIST_LESEN);
    if (r.code !== 0 || !j || !Array.isArray(j.funde)) throw new HttpFehler(502, "Die Suche nach Altlasten hat nicht geklappt. Es wurde nichts verändert.");
    return j;
  }
  async function stand(v) {
    const { r, j } = await lauf(v, "stand", [], FRIST_LESEN);
    if (r.code !== 0 || !j || typeof j !== "object") throw fehlerAus(r, j, "Das Abfragen des Stands");
    return j;
  }

  function schrittArgs(b, { nurEine = false } = {}) {
    const s = [];
    if (b.schritte !== undefined) {
      if (!Array.isArray(b.schritte) || b.schritte.length > 12 || b.schritte.some((x) => typeof x !== "string" || !SCHRITT.test(x))) throw new HttpFehler(400, "„schritte“ muss eine Liste wie [\"A1\", \"A4\"] sein.");
      if (b.schritte.length) s.push("--schritt", b.schritte.join(","));
    }
    return s;
  }
  async function schreibend(v, befehl, was, b, extraArgs, { vertrauenNachher = false } = {}) {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpFehler(400, "Der Body muss ein Objekt sein.");
    const profile = erkenneProfile();
    const bestaetigt = b.bestaetigt === true;                      // nur ein ausdrückliches true schreibt; alles andere liefert den Plan
    const ent = entscheidungenArgument(b.entscheidungen, profile);
    const { r, j } = await lauf(v, befehl, [...extraArgs, ...(ent ? ["--entscheide", ent] : []), ...(bestaetigt ? ["--ja"] : [])], FRIST_SCHREIBEN);
    if (!j || typeof j !== "object" || (r.code !== 0 && !(r.code === 1 && "ok" in j))) throw fehlerAus(r, j, was);
    if (vertrauenNachher && bestaetigt && j.ok === true && j.phase === "A") await vermerkeVertrauen(v);
    return j;
  }
  // P5-Anschluss (siehe Kopf): kein Fehler, wenn es das Vertrauensmodul noch nicht gibt
  async function vermerkeVertrauen(v) {
    try {
      const m = vertrauen || await import("../gemeinsam/vertrauen.mjs");
      if (m && typeof m.erlaube === "function") m.erlaube(v.wurzel, { support, quelle: "bestaetigt" });
    } catch { /* P5 fehlt oder kein Merker schreibbar: die Umstellung gilt trotzdem */ }
  }

  return {
    befund, stand,
    probelauf: (v, b) => schreibend(v, "probelauf", "Der Probelauf", b || {}, []),
    phaseA: (v, b) => schreibend(v, "phase-a", "Die Umstellung", b || {}, schrittArgs(b || {}), { vertrauenNachher: true }),
    rueckweg: (v, b) => {
      b = b || {};
      const extra = [...schrittArgs(b)];
      if (b.alles === true) extra.push("--alles");
      return schreibend(v, "zurueck", "Das Rückgängigmachen", b, extra);
    },
  };
}
