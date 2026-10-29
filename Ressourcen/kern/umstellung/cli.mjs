#!/usr/bin/env node
// umstellung/cli.mjs — „kortex umstellung befund [--json] [--claude-home <ordner>]…“ (Paket P7a, nur lesend).
// brain.mjs ruft dieses Skript mit dem Vault als erstem Argument auf (auch wenn der Vault für den Kern ungültig ist: das IST dann ein Fund des Befunds).
//   Aufruf:  cli.mjs <vault> befund [--json] [--claude-home <ordner>]…
// Ausgabe: --json genau eine JSON-Zeile (Befund, siehe befund.mjs), sonst der Klartext-Bericht. Exit 0, auch wenn etwas gefunden wurde; Exit 2 ohne Vault; Exit 64 bei falschem Aufruf.
import { erstelleBefund } from "./befund.mjs";
import { befundText } from "./bericht.mjs";

const [vault, befehl, ...rest] = process.argv.slice(2);
if (befehl !== "befund") {
  console.error("Nutzung: kortex umstellung befund [--json] [--claude-home <ordner>]…");
  process.exit(64);
}
if (!vault) { console.error("Kein Vault gefunden. Gib ihn mit --vault <pfad> an, setze BRAIN_VAULT oder wähle in der Kortex-App einen aktiven Vault."); process.exit(2); }
const claudeHomes = [];
let json = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--json") json = true;
  else if (rest[i] === "--claude-home" && rest[i + 1]) claudeHomes.push(rest[++i]);
  else { console.error(`Unbekannte Option: ${rest[i]} — erlaubt: --json, --claude-home <ordner>`); process.exit(64); }
}
const befund = erstelleBefund({ vault, claudeHomes });
console.log(json ? JSON.stringify(befund) : befundText(befund).trimEnd());
