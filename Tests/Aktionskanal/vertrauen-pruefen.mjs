#!/usr/bin/env node
// Attrappe der Vertrauensprüfung (nur für scripts/teste-aktionskanal.sh): `node vertrauen-pruefen.mjs <vault>` antwortet genau
// {"erlaubt":true}, wenn die Datei <BRAIN_APP_SUPPORT>/stub-vertrauen existiert, sonst {"erlaubt":false}. Jeder Aufruf steht in
// STUB_LOG — so sieht der Test, wann die App fragt und was sie daraus macht. Die echte CLI (Ressourcen/werkstatt) liest den Merker
// vertrauen.json; hier zählt nur die Swift-Seite: ohne „erlaubt“ startet nichts aus dem Vault.
// Technischer Fehler (Review SW-5): Steht in <BRAIN_APP_SUPPORT>/stub-pruef-fehler eine Zahl n > 0, scheitern die nächsten n Aufrufe
// (kein JSON, Exit 3) und zählen die Zahl herunter — die App muss das als „Prüfung fehlgeschlagen“ behandeln, nicht als „nicht
// freigegeben“, und die Prüfung einmal wiederholen.
import { appendFileSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
const support = process.env.BRAIN_APP_SUPPORT ?? "";
const protokoll = (o) => { if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, JSON.stringify({ pruefung: o }) + "\n"); };

const fehlerDatei = `${support}/stub-pruef-fehler`;
let offen = 0;
try { offen = support !== "" && existsSync(fehlerDatei) ? Number.parseInt(readFileSync(fehlerDatei, "utf8"), 10) || 0 : 0; } catch { offen = 0; }
if (offen > 0) {
  if (offen > 1) writeFileSync(fehlerDatei, String(offen - 1)); else rmSync(fehlerDatei, { force: true });
  protokoll({ vault: process.argv[2] ?? null, technischerFehler: true });
  process.stderr.write("Attrappe: simulierter technischer Fehler\n");
  process.exit(3);
}

const erlaubt = support !== "" && existsSync(`${support}/stub-vertrauen`);
protokoll({ vault: process.argv[2] ?? null, erlaubt });
process.stdout.write(JSON.stringify({ erlaubt }) + "\n");
