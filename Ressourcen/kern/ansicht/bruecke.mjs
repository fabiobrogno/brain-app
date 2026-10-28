#!/usr/bin/env node
// .tools/ansicht/bruecke.mjs — Ansicht-Brücke für die Brain-App (App-Spec §5.2, Baustein 4): dieselben Routen wie
// der HTTP-Dienst (dienst-lib.mjs#behandleIntern), aber über stdin/stdout statt über einen Port. Nur die App, die
// diesen Prozess startet, kann mit ihm reden — darum entfallen hier Host-, Herkunfts- und Token-Prüfung.
// Protokoll: je Zeile ein JSON-Objekt (UTF-8).
//   Start:   → {"bereit":true,"version":"<kit-version>","vaultId":"<id>"}
//   Anfrage: ← {"id":<zahl>,"methode":"GET","pfad":"/api/daten","query":"seit=1"|null,"body":"<base64>"|null}
//   Antwort: → {"id":<zahl>|null,"status":200,"headers":{…},"body":"<base64>"}
// Ende: stdin geschlossen, SIGTERM/SIGINT oder POST /api/stopp — immer erst nach dem Schreiben aller Antworten.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { behandleIntern, vaultIdVon, MAX_KOERPER } from "./dienst-lib.mjs";
import { erzeugeHandler } from "./handler.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const vault = process.argv[2] || process.env.BRAIN_VAULT || join(HIER, "..", "..");
// base64 (×4/3) + JSON-Hülle: größere Anfragezeilen sind nie gültig und werden mit 413 abgewiesen
const MAX_ZEILE = 2 * MAX_KOERPER + 4096;
const handler = erzeugeHandler();
const vaultId = vaultIdVon(vault);
const version = (() => { try { return readFileSync(join(HIER, "..", "VERSION"), "utf8").trim(); } catch { return "?"; } })();
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
  let r;
  try {
    r = await behandleIntern({ methode: a.methode || "GET", pfad, query: new URLSearchParams(query), headers: {}, body },
      { vault, handler, ansichtDir: HIER, vaultId, version });
  } catch {
    r = { status: 500, headers: JSON_TYP, body: Buffer.from('{"fehler":"Interner Fehler"}') };
  }
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
process.on("SIGTERM", beende);
process.on("SIGINT", beende);
sende({ bereit: true, version, vaultId });
