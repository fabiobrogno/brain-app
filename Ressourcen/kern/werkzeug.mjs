// werkzeug.mjs — der Programmpfad, über den der Kern git startet (execFileSync/spawnSync/spawn), NIE der nackte Name "git" (der ginge
// über PATH/eine Shell-Suche) und NIE ein Pfad aus dem Vault.
//
// Kern-Umzug P4 (Sicherheit): Programme kommen nicht aus Vault-Daten. Früher galt brain.config.json → werkzeuge.git vor allem anderen;
// ein geklonter fremder Vault konnte so beim bloßen `brain status` ein beliebiges Programm starten. Der Eintrag wird nicht mehr gelesen
// (der Parameter cfg bleibt aus Gründen der Aufrufer, sein Inhalt zählt nicht).
//
// macOS/Linux: git-sicher (Shell-Skript neben diesem Modul) — es sucht git an festen Orten und startet es gehärtet (kein fsmonitor, keine
// Hooks, keine Programme aus der Repo-Konfiguration; Näheres im Kopf der Datei und in Tests/Kern/test-git-sicher.mjs).
// win32: der private MinGit der App (<Support-Ordner>/git, Lese-Rückfall ~/.brain-kit), sonst "git" — ohne diese Härtung (die App ist
// nur für macOS gebaut; die Windows-Zweige des Kerns bleiben bis auf Weiteres ungehärtet).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { kitOrte, KERN } from "./pfade.mjs";

export function gitBefehl({ plattform = process.platform, home = homedir() } = {}) {
  if (plattform === "win32") {
    for (const ort of kitOrte({ home, plattform })) {
      const mingit = join(ort, "git", "cmd", "git.exe");
      if (existsSync(mingit)) return mingit;
    }
    return "git";
  }
  return join(KERN, "git-sicher");
}
