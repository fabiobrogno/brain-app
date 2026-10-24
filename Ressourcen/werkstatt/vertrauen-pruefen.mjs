#!/usr/bin/env node
// werkstatt/vertrauen-pruefen.mjs — Vertrauensprüfung für Swift (Studio-v2-Spec §8):
//   node vertrauen-pruefen.mjs <vault>            → stdout genau {"erlaubt":true} oder {"erlaubt":false}, Exit 0
//   node vertrauen-pruefen.mjs --erlauben <vault> → erlaubt den Vault (Merker schreiben); NUR mit BRAIN_TESTMODUS=1 (Rauchtests),
//                                                   sonst Exit 2 mit Hinweis — im Betrieb erlaubt nur der Klick in der App.
// Liest denselben Merker (<support>/vertrauen.json, Support-Ordner wie die Werkstatt: BRAIN_APP_SUPPORT bzw. Standard) mit derselben
// Logik wie Werkstatt und MCP-Server (gemeinsam/vertrauen.mjs) und startet nichts aus dem Vault. Jeder Fehler ist ein „nein“.
import { pruefeVertrauen, erlaube } from "../gemeinsam/vertrauen.mjs";
import { testmodus, HttpFehler } from "../gemeinsam/basis.mjs";

const args = process.argv.slice(2);
const ausgabe = (erlaubt) => process.stdout.write(JSON.stringify({ erlaubt }) + "\n");

if (args[0] === "--erlauben") {
  if (!testmodus()) {
    process.stderr.write("--erlauben gibt es nur mit BRAIN_TESTMODUS=1 (für Rauchtests). Im Betrieb erlaubst du einen Vault in der App.\n");
    process.exit(2);
  }
  if (!args[1]) { process.stderr.write("Aufruf: vertrauen-pruefen.mjs --erlauben <vault>\n"); process.exit(2); }
  try { ausgabe(erlaube(args[1]).erlaubt === true); }
  catch (e) { process.stderr.write(`${e instanceof HttpFehler ? e.message : e}\n`); process.exit(1); }
} else {
  if (!args[0] || args[0].startsWith("-")) { process.stderr.write("Aufruf: vertrauen-pruefen.mjs <vault>\n"); process.exit(2); }
  let erlaubt = false;
  try { erlaubt = pruefeVertrauen(args[0]).erlaubt === true; } catch { erlaubt = false; }
  ausgabe(erlaubt);
}
