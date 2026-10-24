#!/usr/bin/env node
// Attrappe der Vertrauensprüfung (nur für scripts/teste-aktionskanal.sh): `node vertrauen-pruefen.mjs <vault>` antwortet genau
// {"erlaubt":true}, wenn die Datei <BRAIN_APP_SUPPORT>/stub-vertrauen existiert, sonst {"erlaubt":false}. Jeder Aufruf steht in
// STUB_LOG — so sieht der Test, wann die App fragt und was sie daraus macht. Die echte CLI (Ressourcen/werkstatt) liest den Merker
// vertrauen.json; hier zählt nur die Swift-Seite: ohne „erlaubt“ startet nichts aus dem Vault.
import { appendFileSync, existsSync } from "node:fs";
const support = process.env.BRAIN_APP_SUPPORT ?? "";
const erlaubt = support !== "" && existsSync(`${support}/stub-vertrauen`);
if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, JSON.stringify({ pruefung: { vault: process.argv[2] ?? null, erlaubt } }) + "\n");
process.stdout.write(JSON.stringify({ erlaubt }) + "\n");
