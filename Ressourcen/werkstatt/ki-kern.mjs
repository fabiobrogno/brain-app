// werkstatt/ki-kern.mjs — der gemeinsame Kern von „Frag deinen Vault“ (frage.mjs) und den KI-Vorschlägen (ki-vorschlag.mjs): ein Aufruf der installierten Claude-Code-CLI mit denselben
// Grenzen. Gemeinsam sind: Umgebung des Kindprozesses (ausdrücklich gebaut), Konto- und Vault-Prüfung (Vertrauen, Stufe ≥ „lesen“ für genau diesen Vault mit Doppelprüfung),
// Temp-Ordner außerhalb des Vaults, Start mit Frist/Ausgabegrenzen/Prozessgruppe, Abbruch (SIGINT → SIGTERM → SIGKILL), Leerlauf-Wache, Texte der Abbruchgründe.
// Hier steht nichts, was zu einer der beiden Funktionen allein gehört (Werkzeuge, MCP, Schemas): das macht jede selbst. Plan: docs/plaene/ki-runde.md, Abschnitt 7 (K0).
import { mkdtempSync, rmSync, realpathSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter, sep } from "node:path";
import { HttpFehler, bereinigterPfad, vorschauOrdnerAus } from "../gemeinsam/basis.mjs";
import { starteStrom } from "../gemeinsam/prozess.mjs";
import { findeProgramm } from "../gemeinsam/ki.mjs";
import { stufeFuer, darfMindestens, kontoStufe } from "../gemeinsam/ki-konten.mjs";
import { mitProfil } from "./profile.mjs";

export const MODELLE = { klein: "haiku", mittel: "sonnet" }; // CLI-Aliasse (bleiben aktuell, keine festen ids)

export const nfc = (s) => String(s).normalize("NFC");
export const kuerze = (s, n) => (String(s).length <= n ? String(s) : `${String(s).slice(0, n - 1)}…`);
export const sauberText = (s, n) => kuerze(String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(), n);
export const ganz = (w) => { const n = Number.parseInt(w, 10); return Number.isInteger(n) && n >= 0 ? n : 0; };

// Umgebung des Kindprozesses: AUSDRÜCKLICH gebaut, nie die der Werkstatt geerbt (kein API-Schlüssel, kein BRAIN_VAULT, kein GITHUB_TOKEN …). Das Konto wählt CLAUDE_CONFIG_DIR.
export function baueFrageUmgebung({ basis, home, claudePfad, konto }) {
  const e = {
    PATH: [dirname(claudePfad), bereinigterPfad(basis.PATH), "/usr/bin", "/bin"].filter(Boolean).join(delimiter),
    HOME: home,
    LANG: basis.LANG || "en_US.UTF-8",
    BRAIN_ERNTE: "1", // Selbstaufruf-Schutz: sollte doch ein Kortex-Hook laufen, endet er sofort
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", // persönliche CLAUDE.md und Memory des Profils bleiben draußen (Doku „env-vars“); die Anmeldung ist davon unberührt
  };
  if (basis.TMPDIR) e.TMPDIR = basis.TMPDIR;
  if (basis.NODE_EXTRA_CA_CERTS) e.NODE_EXTRA_CA_CERTS = basis.NODE_EXTRA_CA_CERTS; // Firmen-Zertifikate bleiben (wie kindUmgebung)
  if (basis.BRAIN_TESTMODUS === "1") e.BRAIN_TESTMODUS = "1";
  // Nur in der Vorschau (Marke im Ordner, HOME darin) und nur diese eine Variable: die Platzhalter der KI-Programme verlangen sie, sonst verweigern sie die Arbeit.
  const vorschau = vorschauOrdnerAus(basis, home);
  if (vorschau) e.KORTEX_VORSCHAU = vorschau;
  return mitProfil(e, { pfad: konto.ordner, standard: konto.standard === true });
}

export const ABBRUCH_TEXT = {
  nutzer: "Abgebrochen.",
  frist: "Die Frage hat zu lange gedauert und wurde beendet.",
  vault: "Abgebrochen, weil ein anderer Vault geöffnet wurde.",
  leerlauf: "Abgebrochen, weil das Studio nicht mehr nachgefragt hat.",
  ausgabe: "Die Ausgabe wurde zu groß und die Frage deshalb abgebrochen.",
  zeile: "Die Ausgabe wurde zu groß und die Frage deshalb abgebrochen.",
  ende: "Abgebrochen, weil Kortex beendet wird.",
};

// Konten und Vault-Prüfung. support/konten/basisEnv wie bei der Frage.
export function erzeugeKontenZugriff({ support, konten, basisEnv }) {
  // lesend: das Bereit-Signal (GET) legt nie eine Liste an; erst eine gestellte Anfrage (POST) darf sie anlegen, wenn sie fehlt
  const ladeKonten = ({ lesend = false } = {}) => {
    let d = konten.lade();
    if (!d && !lesend) { try { konten.synchronisiere(); } catch { /* unten */ } d = konten.lade(); }
    return d;
  };
  const claudePfad = () => findeProgramm("claude", basisEnv);
  const vertraut = (v) => { try { return v.vertrauenStand().erlaubt === true; } catch { return false; } };

  // Darf dieses Konto den Vault lesen? Zwei Fragen an die gemeinsame Logik (gemeinsam/ki-konten.mjs, keine eigene Kopie): die Stufe in der Liste der Werkstatt, und dieselbe Bestimmung, die
  // der MCP-Server später selbst macht (Konto aus --konto UND CLAUDE_CONFIG_DIR/CODEX_HOME, alle Orte der Liste inkl. Standard-Support, strengstes Ergebnis). Beides muss „lesen“ oder mehr sagen.
  const darfLesen = (v, id, k, daten) => darfMindestens(stufeFuer(daten, v.wurzel, id), "lesen")
    && darfMindestens(kontoStufe(v.wurzel, { support, arg: id, env: k.standard === true ? {} : { [k.programm === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"]: k.ordner } }), "lesen");

  // Vertrauen, Liste, Konto, Stufe, Programm — in dieser Reihenfolge. → { daten, konto }
  function pruefeKonto(v, kontoId, { vertrauensText, programmText }) {
    if (!vertraut(v)) throw new HttpFehler(409, vertrauensText, { art: "nicht-vertraut" });
    const daten = ladeKonten();
    if (!daten) throw new HttpFehler(409, "Die Liste der KI-Konten ist gerade nicht verfügbar. Öffne Kortex neu und versuche es noch einmal.", { art: "konten" });
    const keinZugriff = new HttpFehler(409, "Dieses KI-Konto darf diesen Vault nicht lesen. Gib ihn unter „KI-Konten“ frei oder wähle ein anderes Konto.", { art: "kein-zugriff" });
    if (typeof kontoId !== "string" || !Object.hasOwn(daten.konten, kontoId)) throw keinZugriff;
    if (!darfLesen(v, kontoId, daten.konten[kontoId], daten)) throw keinZugriff; // die Stufe kommt aus der Liste der Werkstatt, nie aus der Anfrage
    const konto = daten.konten[kontoId];
    if (konto.programm !== "claude") throw new HttpFehler(409, programmText, { art: "programm" });
    return { daten, konto };
  }
  // Claude Code gefunden, Konto-Ordner da. → Pfad des Programms
  function claudeBereit(konto) {
    const claude = claudePfad();
    if (!claude) throw new HttpFehler(404, "Claude Code wurde nicht gefunden. Installiere es und öffne Kortex neu.", { art: "kein-claude" });
    if (konto.standard !== true) { let ok = false; try { ok = lstatSync(konto.ordner).isDirectory(); } catch { /* fehlt */ } if (!ok) throw new HttpFehler(409, "Der Ordner dieses KI-Kontos fehlt.", { art: "konto-ordner" }); }
    return claude;
  }
  return { ladeKonten, claudePfad, vertraut, darfLesen, pruefeKonto, claudeBereit };
}

// Leerer Temp-Ordner nur für diesen Lauf, nie im Vault.
export function legeTempAn(v, tempBasis, praefix) {
  const temp = realpathSync(mkdtempSync(join(tempBasis || tmpdir(), praefix)));
  if (temp === v.wurzel || temp.startsWith(v.wurzel + sep)) {
    try { rmSync(temp, { recursive: true, force: true }); } catch { /* bleibt liegen */ }
    throw new HttpFehler(500, "Der Temp-Ordner liegt im Vault. Der Lauf wurde nicht gestartet.");
  }
  return temp;
}

// Startet `claude` ohne Shell (Argumente als Liste), Eingabe über stdin, cwd = temp. `run` braucht { temp, fertig, endet, letzterAbruf }; der Kern setzt run.stopp und run.wache
// und räumt am Ende Wache und Temp-Ordner auf, bevor er beiEnde(ende) ruft. → { fertig }
export function starteKiLauf({ run, claude, args, env, stdin, grenzen: G, onZeile, beiEnde }) {
  const lauf = starteStrom(claude, args, { cwd: run.temp, env, stdin, frist: G.frist, maxBytes: G.ausgabe, maxZeile: G.zeile, onZeile });
  // ab jetzt „endet“: ein neuer Lauf ist sofort möglich, der Prozess folgt SIGINT → SIGTERM → SIGKILL
  run.stopp = (grund) => { run.endet = true; lauf.stopp(grund); };
  run.wache = setInterval(() => { if (!run.fertig && Date.now() - run.letzterAbruf > G.leerlauf) run.stopp("leerlauf"); }, Math.min(2000, Math.max(50, G.leerlauf / 2)));
  run.wache.unref?.();
  const ende = (e) => {
    clearInterval(run.wache);
    try { rmSync(run.temp, { recursive: true, force: true }); } catch { /* bleibt im Temp-Ordner liegen */ }
    beiEnde(e);
  };
  lauf.fertig.then(ende, () => ende({ code: null, grund: "start", stderr: "" }));
  return lauf;
}
