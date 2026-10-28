#!/usr/bin/env node
// werkstatt/werkstatt.mjs — Brücke zwischen Brain Studio (Swift-App) und dem Vault, Protokoll wie
// ~/brain/.tools/ansicht/bruecke.mjs (Spec §4): je Zeile ein JSON-Objekt (UTF-8) über stdin/stdout.
//   Start:   → {"bereit":true,"version":"<app-version>","vaultId":"<id>"}
//   Anfrage: ← {"id":1,"methode":"GET","pfad":"/api/datei","query":"pfad=a.md"|null,"body":"<base64>"|null}
//   Antwort: → {"id":1,"status":200,"headers":{…},"body":"<base64>"}
// Pfade ohne /api/ = statische Datei aus ../studio/. Ende: stdin zu, SIGTERM/SIGINT oder POST /api/stopp —
// immer erst nach dem Schreiben aller Antworten. Aufruf: node werkstatt.mjs [<vault>] — ohne Argument gilt der aktive Vault aus
// <support>/vaults.json, und gibt es keinen, startet die Werkstatt ohne Vault (/api/info → {vault:null}, vaultId null).
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { erzeugeHandler, appVersionLesen, MAX_KOERPER } from "./handler.mjs";
import { HttpFehler } from "../gemeinsam/vault.mjs";
import { beendeLaufendes } from "../gemeinsam/git.mjs";
import { beendeVorgaenge } from "../gemeinsam/vaults.mjs";
import { bereinigePfad, vorschauFehler } from "../gemeinsam/basis.mjs";

// Vorschau („wie frisch installiert“) nur mit umgelenktem Benutzerordner — sonst gar nicht erst starten (nichts wird angefasst).
const vorschauProblem = vorschauFehler();
if (vorschauProblem) { process.stderr.write(`Vorschau-Schutz: ${vorschauProblem}\n`); process.exit(2); }
bereinigePfad(); // kein leerer oder relativer PATH-Eintrag: ein `git` (oder anderes Programm) aus einem fremden Vault startet nie (Vertrauen v2, §8)
const vault = process.argv[2] || process.env.BRAIN_VAULT || undefined; // das Argument hat Vorrang vor vaults.json
let handler;
try { handler = erzeugeHandler(vault ? { vault } : {}); }
catch (e) { process.stderr.write(`${e instanceof HttpFehler ? e.message : e}\n`); process.exit(2); }

const MAX_ZEILE = 2 * MAX_KOERPER + 4096; // base64 (×4/3) + JSON-Hülle; größere Zeilen sind nie gültig
const aktiverPfad = handler.aktuellerVaultPfad();
const vaultId = aktiverPfad ? createHash("sha256").update(realpathSync(aktiverPfad)).digest("hex").slice(0, 16) : null;
const JSON_TYP = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

process.stdout.on("error", () => process.exit(0)); // App weg → still beenden

const sende = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const fehlerAntwort = (id, status, meldung) =>
  ({ id, status, headers: JSON_TYP, body: Buffer.from(JSON.stringify({ fehler: meldung })).toString("base64") });

let offen = 0, stdinZu = false, beendet = false;
function beende() {
  if (beendet) return;
  beendet = true;
  process.stdout.write("", () => process.exit(0)); // Callback erst, wenn alles Vorherige geschrieben ist
}
const vielleichtEnde = () => { if (stdinZu && offen === 0) beende(); };

async function bearbeite(zeile) {
  if (zeile.length > MAX_ZEILE) return void sende(fehlerAntwort(null, 413, "Anfrage zu groß"));
  let a;
  try { a = JSON.parse(zeile); } catch { return void sende(fehlerAntwort(null, 400, "ungültige Anfrage")); }
  const id = Number.isInteger(a?.id) ? a.id : null;
  if (id === null || typeof a.pfad !== "string" || !a.pfad.startsWith("/")) return void sende(fehlerAntwort(id, 400, "ungültige Anfrage"));
  let pfad = a.pfad;
  let query = typeof a.query === "string" ? a.query : "";
  const q = pfad.indexOf("?");
  if (q >= 0) { if (!query) query = pfad.slice(q + 1); pfad = pfad.slice(0, q); }
  const body = typeof a.body === "string" && a.body.length ? Buffer.from(a.body, "base64") : undefined;
  if (body && body.length > MAX_KOERPER) return void sende(fehlerAntwort(id, 413, "Anfrage zu groß"));
  let r;
  try { r = await handler({ methode: a.methode || "GET", pfad, query, body }); }
  catch { r = { status: 500, headers: JSON_TYP, body: Buffer.from('{"fehler":"Interner Fehler"}') }; }
  sende({ id, status: r.status, headers: r.headers || {}, body: (r.body || Buffer.alloc(0)).toString("base64") });
  if (r.stopp) beende();
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (zeile) => {
  if (beendet || !zeile.trim()) return;
  offen++;
  bearbeite(zeile).finally(() => { offen--; vielleichtEnde(); });
});
rl.on("close", () => { stdinZu = true; vielleichtEnde(); });
// SIGTERM/SIGINT (die App beendet uns nach 2 s): zuerst laufende Git-Prozessgruppen beenden und einen gerade laufenden Merge des Abgleichs
// mit `git merge --abort` zurücknehmen (synchron, höchstens ~1,5 s) — sonst bliebe der Vault halb zusammengeführt —, dann zurücknehmen, was
// ein laufendes Anlegen/Klonen/„Git einschalten“ schon im Dateisystem angelegt hat (dessen catch läuft nach dem Beenden nie mehr), dann beenden.
const abraeumenUndEnde = () => {
  try { beendeLaufendes(); } catch { /* beenden wir trotzdem */ }
  try { beendeVorgaenge(); } catch { /* beenden wir trotzdem */ }
  beende();
};
process.on("SIGTERM", abraeumenUndEnde);
process.on("SIGINT", abraeumenUndEnde);
sende({ bereit: true, version: appVersionLesen(), vaultId });
