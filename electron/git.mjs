// electron/git.mjs — „Ist git da?“ für die Einrichtung (Aktion git-pruefen), ohne den Hauptprozess zu blockieren: asynchron, nur über den absoluten Pfad (nie der nackte Name, der im
// PATH relativ gesucht würde) und mit der bereinigten Umgebung für Kindprozesse. Nur `git --version`, nie eine Installation. Antwortform wie werkstatt/browser-ordner.mjs#pruefeGit.
import { execFile } from "node:child_process";

export function pruefeGitAsync({ gitPfad, umgebung, lauf = execFile }) {
  return new Promise((ok) => {
    const pfad = gitPfad();
    if (!pfad) return ok({ stand: "fehlt" });
    try {
      lauf(pfad, ["--version"], { env: umgebung(), timeout: 8000, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
        if (err && err.code === "ENOENT") return ok({ stand: "fehlt" });
        if (err) return ok({ stand: "defekt", meldung: String(stderr || err.message || "").trim().slice(0, 200) });
        ok({ stand: "vorhanden", version: String(stdout || "").trim().replace(/^git version\s+/, "") });
      });
    } catch { ok({ stand: "nicht-pruefbar" }); }
  });
}
