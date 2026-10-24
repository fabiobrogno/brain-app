// gemeinsam/basis.mjs — Fehlerart mit HTTP-Status und der Pfad-Schutz (Studio-Spec §5). Keine Abhängigkeiten.
import { realpathSync, lstatSync } from "node:fs";
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
    if (s.startsWith(".") || s === "node_modules") throw new HttpFehler(403, "Dieser Ort ist gesperrt.");
    segmente.push(s);
  }
  if (!segmente.length) throw new HttpFehler(400, "Der Pfad fehlt oder ist ungültig.");
  return segmente;
}

const imVault = (echt, wurzel) => echt === wurzel || echt.startsWith(wurzel + sep);

// Absoluter Pfad im Vault; der nächste vorhandene Vorfahre (bzw. das Ziel selbst) muss per realpath im Vault liegen,
// damit kein Symlink nach draußen führt — auch beim Anlegen neuer Dateien.
export function loese(wurzel, rel) {
  const segmente = sauber(rel);
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
