// werkstatt/umstellung.mjs — Umstellung eines Vaults aus der Kit-Zeit (Paket P7a, Plan docs/plaene/p7-umstellung.md). Bisher NUR LESEN:
//   GET /api/umstellung/befund → Befund (kern/umstellung/befund.mjs): { version, kernVersion, kitZeit, umstellbar, zaehlung, profile, funde: [{ id, kategorie, schwere, ort, anzahl, aktion, phase, text, … }] }
// Die Logik lebt im Kern; die Werkstatt ruft den Starter der App (`kortex umstellung befund --vault <v> --json --claude-home <profil>…`, Muster verdrahtung.mjs) und reicht das
// Ergebnis durch. Der Befund enthält nur Kategorien, Zählungen und Schlüsselnamen – nie Werte (kein Hook-Befehl, kein MCP-Eintrag, kein git-Wert).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { HttpFehler, kindUmgebung } from "../gemeinsam/basis.mjs";
import { starte, neueFrist } from "../gemeinsam/prozess.mjs";
import { erkenneProfile } from "./profile.mjs";

const FRIST = 60_000;

export function erzeugeUmstellung({ starter, support = null }) {
  async function befund(v) {
    if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
    if (!existsSync(starter)) throw new HttpFehler(409, "Der Starter von Kortex fehlt noch. Starte Kortex einmal neu, dann wird er angelegt — danach geht es hier weiter.", { art: "kein-starter" });
    const profile = erkenneProfile();
    const args = ["umstellung", "befund", "--vault", v.wurzel, "--json", ...profile.flatMap((p) => ["--claude-home", p.pfad])];
    const r = await starte(starter, args, {
      cwd: homedir(), env: kindUmgebung(support ? { BRAIN_APP_SUPPORT: support } : {}), timeout: FRIST, frist: neueFrist(FRIST), fehlt: "Der Starter von Kortex wurde nicht gefunden.",
      zuLange: "Die Suche nach Altlasten hat zu lange gedauert und wurde abgebrochen. Es wurde nichts verändert — versuche es noch einmal.",
    });
    let j = null;
    try { j = JSON.parse(String(r.stdout || "").trim().split("\n").pop()); } catch { /* unten */ }
    if (r.code === 127) throw new HttpFehler(409, "Kortex ist noch nicht vollständig bereit (Node oder der Kern fehlt). Starte Kortex neu und versuche es noch einmal.", { art: "kein-starter" });
    if (r.code !== 0 || !j || !Array.isArray(j.funde)) throw new HttpFehler(502, "Die Suche nach Altlasten hat nicht geklappt. Es wurde nichts verändert.");
    return j;
  }
  return { befund };
}
