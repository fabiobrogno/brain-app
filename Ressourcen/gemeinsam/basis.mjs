// gemeinsam/basis.mjs — Fehlerart mit HTTP-Status und der Pfad-Schutz (Studio-Spec §5). Keine Abhängigkeiten.
import { realpathSync, lstatSync, readdirSync } from "node:fs";
import { join, sep, dirname } from "node:path";

// Fehler, die bis zur Oberfläche durchgereicht werden: Status + Alltagsmeldung (+ Zusatzfelder wie aktuellerHash).
export class HttpFehler extends Error {
  constructor(status, meldung, extra = {}) {
    super(meldung);
    this.status = status;
    this.extra = extra;
  }
}

export const MAX_DATEI = 5 * 1024 * 1024;

// Vergleichsform für Namen: APFS unterscheidet weder Groß/klein noch NFC/NFD — Sperren und Schreibschutz dürfen es auch nicht.
export const falte = (s) => String(s).normalize("NFC").toLowerCase();

// Umgebung für Kindprozesse (git, Kit, claude): nichts, womit sich fremder Code einschleusen ließe (NODE_OPTIONS,
// NODE_PATH, ELECTRON_RUN_AS_NODE, DYLD_*/LD_*). NODE_EXTRA_CA_CERTS bleibt (Firmen-Zertifikate für claude).
export function kindUmgebung(zusatz = {}) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if ((k.startsWith("NODE_") && k !== "NODE_EXTRA_CA_CERTS") || k.startsWith("ELECTRON_") || k.startsWith("DYLD_") || k.startsWith("LD_")) delete e[k];
  }
  return { ...e, ...zusatz };
}
export const testmodus = () => process.env.BRAIN_TESTMODUS === "1";

// Lexikalische Prüfung (ohne Plattenzugriff): relativer Vault-Pfad mit "/" → bereinigte Segmente.
// 400 bei Unsinn, 403 bei Ausbruch (.., absolut) und bei gesperrten Orten (führender Punkt, node_modules).
export function sauber(rel) {
  if (typeof rel !== "string" || !rel.trim() || rel.length > 1000) throw new HttpFehler(400, "Der Pfad fehlt oder ist ungültig.");
  if (/[\0\\]/.test(rel)) throw new HttpFehler(400, "Der Pfad enthält ungültige Zeichen.");
  if (rel.startsWith("/") || rel.startsWith("~") || /^[A-Za-z]:/.test(rel)) throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
  const segmente = [];
  for (const s of rel.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
    if (s.startsWith(".") || falte(s) === "node_modules") throw new HttpFehler(403, "Dieser Ort ist gesperrt.");
    segmente.push(s);
  }
  if (!segmente.length) throw new HttpFehler(400, "Der Pfad fehlt oder ist ungültig.");
  return segmente;
}

// Schreibweise der vorhandenen Ordner/Datei übernehmen („index.md“ trifft eine vorhandene „INDEX.md“): auf APFS dieselbe Datei.
// Gibt es den Namen exakt, bleibt er; sonst der (eindeutige) Treffer ohne Groß/klein und Unicode-Form.
function kanonisch(wurzel, segmente) {
  const aus = [];
  let ordner = wurzel;
  for (const s of segmente) {
    let name = s, gefunden = false;
    try {
      const namen = readdirSync(ordner);
      if (namen.includes(s)) gefunden = true;
      else {
        const treffer = namen.filter((n) => falte(n) === falte(s));
        if (treffer.length) { name = treffer.sort()[0]; gefunden = true; }
      }
    } catch { /* Ordner gibt es (noch) nicht → Rest unverändert */ }
    aus.push(name);
    if (!gefunden) { aus.push(...segmente.slice(aus.length)); break; }
    ordner = join(ordner, name);
  }
  return aus;
}

const imVault = (echt, wurzel) => echt === wurzel || echt.startsWith(wurzel + sep);

// Absoluter Pfad im Vault; der nächste vorhandene Vorfahre (bzw. das Ziel selbst) muss per realpath im Vault liegen,
// damit kein Symlink nach draußen führt — auch beim Anlegen neuer Dateien.
export function loese(wurzel, rel) {
  const segmente = kanonisch(wurzel, sauber(rel));
  const abs = join(wurzel, ...segmente);
  let p = abs;
  for (;;) {
    try { lstatSync(p); break; } catch { /* gibt es noch nicht → Vorfahre prüfen */ }
    const oben = dirname(p);
    if (oben === p) break;
    p = oben;
  }
  let echt;
  try { echt = realpathSync(p); } catch { throw new HttpFehler(403, "Dieser Pfad ist nicht erreichbar."); }
  if (!imVault(echt, wurzel)) throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
  return { abs, rel: segmente.join("/"), segmente };
}

export { imVault };
