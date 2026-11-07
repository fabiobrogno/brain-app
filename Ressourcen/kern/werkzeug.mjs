// werkzeug.mjs — der Programmpfad, über den der Kern git startet (execFileSync/spawnSync/spawn), NIE der nackte Name "git" (der ginge
// über PATH/eine Shell-Suche) und NIE ein Pfad aus dem Vault.
//
// Kern-Umzug P4 (Sicherheit): Programme kommen nicht aus Vault-Daten. Früher galt brain.config.json → werkzeuge.git vor allem anderen;
// ein geklonter fremder Vault konnte so beim bloßen `brain status` ein beliebiges Programm starten. Der Eintrag wird nicht mehr gelesen
// (der Parameter cfg bleibt aus Gründen der Aufrufer, sein Inhalt zählt nicht).
//
// macOS/Linux: git-sicher (Shell-Skript neben diesem Modul) — es sucht git an festen Orten und startet es gehärtet (kein fsmonitor, keine
// Hooks, keine Programme aus der Repo-Konfiguration; Näheres im Kopf der Datei und in Tests/Kern/test-git-sicher.mjs).
// win32: dieselbe Schranke in Node (git-sicher.mjs, dieselben Regeln), erreichbar über einen kleinen .exe-Starter (windows-start.mjs/.cs: Windows startet aus Node
// nur .exe, und eine .cmd würde die Argumente durch cmd.exe umdeuten). Den echten git sucht git-sicher.mjs selbst (MinGit der App, absoluter PATH, Program Files).
import { join } from "node:path";
import { homedir } from "node:os";
import { KERN, geprueftVaultsVertraut, vaultVertraut, supportOrdner } from "./pfade.mjs";
import { starterFuer } from "./windows-start.mjs";

// Workspace-Trust (P5): Solange ein Vault dieses Prozesses nicht vertraut ist (vertrauen.mjs), startet der Kern GAR KEIN git — gitBefehl liefert dann
// `git-gesperrt` (sagt es und endet mit Exit 126; Windows: derselbe Starter mit git-gesperrt.mjs), nie ein echtes git. `ohneVault: true` nur für Aufrufe, die keinen Vault berühren
// (Wiederherstellen einer Sicherung in einen neuen Ordner): sie laufen weiter durch git-sicher.
// `vault`: für Einstiege, die den Vault nicht über pruefeVault gefunden haben (die Commit-Prüfung im Hook) — dann zählt dieser Vault.
export function gitBefehl({ plattform = process.platform, home = homedir(), ohneVault = false, vault = null } = {}) {
  const name = !ohneVault && !(vault ? vaultVertraut(vault) : geprueftVaultsVertraut()) ? "git-gesperrt" : "git-sicher";
  if (plattform === "win32") return windowsStarter(name, { home, plattform });
  return join(KERN, name);
}

// Der Starter liegt im Support-Ordner (Kern und Vault sind nur zu lesen). Lässt er sich nicht anlegen (kein csc, Platte voll), ist das Ergebnis ein Pfad, den es nicht
// gibt: der Aufruf scheitert mit ENOENT, es läuft nie ein ungeschütztes git (fail-closed).
let gemeldet = false;
function windowsStarter(name, { home, plattform }) {
  const support = supportOrdner({ home, plattform });
  try { return starterFuer(name, { support }); } catch (e) {
    if (!gemeldet) { gemeldet = true; process.stderr.write(`Kortex: Der git-Starter lässt sich nicht anlegen (${String(e?.message || e).split("\n")[0].slice(0, 200)}). Der Kern startet kein git.\n`); }
    return join(support, "git-sicher", "nicht-verfuegbar", `${name}.exe`);
  }
}
