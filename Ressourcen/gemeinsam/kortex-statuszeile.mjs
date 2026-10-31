#!/usr/bin/env node
// kortex-statuszeile.mjs — die Statuszeile von Kortex für Claude Code (Paket P7, Kontingent). Eigenständig: keine Importe außer Node, denn die App legt eine Kopie
// unter <Support>/kontingent/bin/ ab (stabiler Ort, überlebt App-Updates). Aufruf durch Claude Code, nie durch Kortex: `node kortex-statuszeile.mjs --konto <id>`; Claude Code
// schreibt bei jedem Neuzeichnen der Statuszeile ein JSON auf stdin und zeigt, was auf stdout steht.
//
// Kette statt Ersetzen:
//  · Hatte der Nutzer schon eine Statuszeile, steht ihr Befehl in <Support>/kontingent/kette/<konto>.json. Das Skript ruft ihn mit derselben Eingabe auf und gibt seine Ausgabe
//    BYTEGLEICH weiter (stdout, stderr, Exit-Code). Ohne frühere Statuszeile bleibt die Ausgabe leer — genau wie vorher.
//  · Zusätzlich merkt es sich aus der Eingabe NUR `rate_limits.five_hour` und `rate_limits.seven_day` (Prozent, Fensterlänge, Rücksetzzeit) in
//    <Support>/kontingent/<konto>.json (atomar: Temp-Datei im selben Ordner, dann umbenennen; Rechte 0600; höchstens alle 15 s). Kein Token, kein Text aus der Sitzung,
//    kein Pfad, kein Modellname: der Rest der Eingabe wird nie gelesen, geschweige denn gespeichert.
//  · Das Skript scheitert nie: ungültiges JSON, fehlendes Feld, nicht beschreibbarer Ordner → trotzdem läuft die Kette und der Exit-Code ist der der Kette (sonst 0).
// Muster: Orca src/shared/claude-statusline-rate-limits.ts @9bccd67 (MIT, Lovecast Inc.) — Claude Code >= 2.1.80 liefert `rate_limits` an die Statuszeile; Prozent aus
// `used_percentage` (oder dem verwandten `utilization`), Rücksetzzeit als Epochensekunden (oder ISO-Text, falls sich das Schema ändert).
import { readFileSync, readSync, writeFileSync, renameSync, statSync, mkdirSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const FORMAT = 1;
export const MIN_SCHREIB_ABSTAND_MS = 15_000; // Orca: CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS = 15
export const FENSTER_5H = 300, FENSTER_WOCHE = 10080;
const MAX_PARSEN = 1024 * 1024;   // größere Eingaben werden nicht ausgewertet (die Kette bekommt sie trotzdem)
const MAX_EINGABE = 16 * 1024 * 1024;
const KETTE_FRIST_MS = 8000;
const MAX_AUSGABE = 8 * 1024 * 1024;
const KONTO_OK = /^[A-Za-z0-9_-]{1,64}$/;

const endlich = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

// Ein Fenster aus der Eingabe → { usedPercent (0–100), windowMinutes, resetsAt (ms | null) } oder null.
export function leseFenster(roh, minuten) {
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const p = endlich(roh.used_percentage) ?? endlich(roh.utilization); // utilization: verwandtes Feld (0–100), damit eine Schemaänderung nicht alles verdunkelt
  if (p === undefined) return null;
  let resetsAt = null;
  if (typeof roh.resets_at === "number" && Number.isFinite(roh.resets_at) && roh.resets_at > 0) resetsAt = roh.resets_at * 1000; // Epochensekunden
  else if (typeof roh.resets_at === "string" && roh.resets_at.trim()) { const t = Date.parse(roh.resets_at); if (Number.isFinite(t)) resetsAt = t; } // ISO-Text
  return { usedPercent: Math.min(100, Math.max(0, p)), windowMinutes: minuten, resetsAt };
}
// Die ganze Eingabe (schon geparst) → { session, weekly } oder null, wenn es kein Kontingent gibt.
export function leseStatuszeile(eingabe) {
  if (typeof eingabe !== "object" || eingabe === null) return null;
  const rl = eingabe.rate_limits;
  if (typeof rl !== "object" || rl === null) return null;
  const session = leseFenster(rl.five_hour, FENSTER_5H), weekly = leseFenster(rl.seven_day, FENSTER_WOCHE);
  return session || weekly ? { session, weekly } : null;
}

function schreibeAtomar(ziel, text) {
  const ordner = dirname(ziel);
  mkdirSync(ordner, { recursive: true, mode: 0o700 });
  const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, ziel);
  } catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
}

// Schreibt den Stand für das Konto (höchstens alle 15 s). → true, wenn geschrieben wurde.
export function zeichneAuf(kontingentOrdner, konto, eingabe, jetzt = Date.now()) {
  if (!KONTO_OK.test(konto)) return false;
  const ziel = join(kontingentOrdner, `${konto}.json`);
  try { const d = jetzt - statSync(ziel).mtimeMs; if (d >= 0 && d < MIN_SCHREIB_ABSTAND_MS) return false; } catch { /* noch keine Datei */ }
  const k = leseStatuszeile(eingabe);
  const stand = k ? { v: FORMAT, geschrieben: new Date(jetzt).toISOString(), session: k.session, weekly: k.weekly } : { v: FORMAT, geschrieben: new Date(jetzt).toISOString(), ohne: true };
  schreibeAtomar(ziel, JSON.stringify(stand) + "\n");
  return true;
}

function liesKette(kontingentOrdner, konto) {
  try {
    const j = JSON.parse(readFileSync(join(kontingentOrdner, "kette", `${konto}.json`), "utf8"));
    return j && typeof j.command === "string" && j.command.trim() ? j.command : null;
  } catch { return null; }
}

// Alles von stdin (ein nicht blockierender Kanal meldet kurz EAGAIN: dann warten und weiterlesen; Ende = leer oder Fehler).
function liesStdin() {
  const teile = []; let n = 0;
  const puffer = Buffer.alloc(65536);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let wartet = 0; n < MAX_EINGABE;) {
    let gelesen;
    try { gelesen = readSync(0, puffer, 0, puffer.length, null); }
    catch (e) { if (e && e.code === "EAGAIN" && wartet++ < 2000) { Atomics.wait(pause, 0, 0, 5); continue; } break; }
    if (gelesen === 0) break;
    n += gelesen; teile.push(Buffer.from(puffer.subarray(0, gelesen)));
  }
  return Buffer.concat(teile);
}

const schreibe = (strom, teile) => new Promise((ok) => { if (!teile.length) return ok(); try { strom.write(Buffer.concat(teile), () => ok()); } catch { ok(); } });

// Ruft die frühere Statuszeile auf (eigene Prozessgruppe: beim Zeitlimit endet auch, was sie gestartet hat) und reicht Ausgabe und Exit-Code durch. → Promise<Exit-Code>
function rufeKette(befehl, roh) {
  return new Promise((fertig) => {
    let kind;
    try { kind = spawn("/bin/sh", ["-c", befehl], { stdio: ["pipe", "pipe", "pipe"], env: process.env, detached: true }); }
    catch { return fertig(0); }
    const aus = [], fehl = [];
    let menge = 0, ende = false;
    const beendeAlles = () => { try { process.kill(-kind.pid, "SIGKILL"); } catch { try { kind.kill("SIGKILL"); } catch { /* weg */ } } };
    const schluss = (code) => {
      if (ende) return;
      ende = true; clearTimeout(uhr);
      Promise.all([schreibe(process.stdout, aus), schreibe(process.stderr, fehl)]).then(() => fertig(code));
    };
    const uhr = setTimeout(() => { beendeAlles(); schluss(1); }, KETTE_FRIST_MS);
    const sammle = (liste) => (d) => { menge += d.length; if (menge > MAX_AUSGABE) { beendeAlles(); return schluss(1); } liste.push(d); };
    kind.stdout.on("data", sammle(aus)); kind.stderr.on("data", sammle(fehl));
    kind.stdout.on("error", () => {}); kind.stderr.on("error", () => {}); kind.stdin.on("error", () => { /* Programm liest nicht: egal */ });
    kind.on("error", () => schluss(0));
    kind.on("close", (code, signal) => schluss(typeof code === "number" ? code : signal ? 1 : 0));
    kind.stdin.end(roh);
  });
}

async function hauptprogramm() {
  const i = process.argv.indexOf("--konto");
  const konto = i > 0 ? String(process.argv[i + 1] || "") : "";
  const kontingentOrdner = dirname(dirname(fileURLToPath(import.meta.url))); // <Support>/kontingent/bin/kortex-statuszeile.mjs → <Support>/kontingent
  const roh = liesStdin();
  let eingabe = null;
  try { if (roh.length <= MAX_PARSEN) eingabe = JSON.parse(roh.toString("utf8")); } catch { /* ungültiges JSON: nichts aufzeichnen, die Kette bekommt die Eingabe trotzdem unverändert */ }
  try { if (eingabe !== null) zeichneAuf(kontingentOrdner, konto, eingabe); } catch { /* nie ein Grund, die Statuszeile zu stören */ }
  const befehl = KONTO_OK.test(konto) ? liesKette(kontingentOrdner, konto) : null;
  return befehl ? rufeKette(befehl, roh) : 0;
}

const alsProgramm = () => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (alsProgramm()) {
  let code = 0;
  try { code = await hauptprogramm(); } catch { code = 0; }
  process.exit(code);
}
