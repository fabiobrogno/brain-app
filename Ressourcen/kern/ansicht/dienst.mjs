#!/usr/bin/env node
// ansicht/dienst.mjs — Ansicht-Dienst (Spec §3.A, §3b.1): lokaler HTTP-Dienst nur auf 127.0.0.1, Port
// zufällig, für die 3D-Ansicht und die Steuerzentrale. Nur node:http, keine Abhängigkeit. Die Anfrage-Logik
// (Routing, alle Sicherheitsprüfungen) steckt in dienst-lib.mjs; hier nur Socket, Lebensdauer und Handler.
// Nutzung: node ansicht/dienst.mjs <vault>   (gestartet von dienst-start.mjs, losgelöst)
// stdout: genau eine Zeile „bereit <port>“, sobald dienst.json geschrieben ist — danach nichts mehr.
// Ende: SIGTERM/SIGINT, POST /api/stopp, oder Leerlauf (Standard 30 min, BRAIN_DIENST_LEERLAUF_MS) — räumt
// dienst.json auf (nur die eigene, falls inzwischen ein anderer Dienst sie ersetzt hat).
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { behandle, vaultIdVon, MAX_KOERPER } from "./dienst-lib.mjs";
import { erzeugeHandler } from "./handler.mjs";
import { vaultPfadOderEnde } from "../pfade.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const vault = process.argv[2] || vaultPfadOderEnde([]);
const LEERLAUF_MS = Number(process.env.BRAIN_DIENST_LEERLAUF_MS) > 0 ? Number(process.env.BRAIN_DIENST_LEERLAUF_MS) : 30 * 60 * 1000;
// Zugangsschlüssel für /api (32 Byte, je Start neu); Feldname in dienst.json und kontext: "token"
const zugang = randomBytes(32).toString("hex");
const vaultId = vaultIdVon(vault);
const dienstDatei = join(vault, ".logs", "ansicht", "dienst.json");

// stdout gehört dem Starter nur bis „bereit“; danach ist die Pipe zu — Schreibfehler dort nie fatal.
process.stdout.on("error", () => {});

const handler = erzeugeHandler();

// ---- Lebensdauer
let port = 0;
let leerlauf = null;
const weckeLeerlauf = () => { clearTimeout(leerlauf); leerlauf = setTimeout(() => beende(), LEERLAUF_MS); };

let beendet = false;
function beende() {
  if (beendet) return;
  beendet = true;
  clearTimeout(leerlauf);
  try {
    const j = JSON.parse(readFileSync(dienstDatei, "utf8"));
    if (j.pid === process.pid && zugang === j.token) rmSync(dienstDatei, { force: true });
  } catch {}
  server.close();
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 50).unref();
}
process.on("SIGTERM", beende);
process.on("SIGINT", beende);
process.on("SIGHUP", beende);

function schreibeDienstDatei() {
  mkdirSync(dirname(dienstDatei), { recursive: true });
  const tmp = `${dienstDatei}.${process.pid}.tmp`;
  const inhalt = { port, pid: process.pid, "token": zugang, vaultId, start: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(inhalt) + "\n", { mode: 0o600 });
  renameSync(tmp, dienstDatei);
}

// ---- HTTP
const server = http.createServer((req, res) => {
  const roh = String(req.url || "/");
  const q = roh.indexOf("?");
  const pfad = q < 0 ? roh : roh.slice(0, q);
  const query = new URLSearchParams(q < 0 ? "" : roh.slice(q + 1));
  const teile = [];
  let laenge = 0, fertig = false;
  const weiter = async (zuGross) => {
    if (fertig) return;
    fertig = true;
    let r;
    try {
      r = await behandle({ methode: req.method, pfad, query, headers: req.headers, body: laenge ? Buffer.concat(teile) : undefined },
        { vault, "token": zugang, port, handler, ansichtDir: HIER, vaultId });
    } catch {
      r = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: Buffer.from('{"fehler":"Interner Fehler"}') };
    }
    if (r.status !== 403) weckeLeerlauf(); // fremde/abgelehnte Anfragen halten den Dienst nicht am Leben
    const h = { ...r.headers, "Content-Length": r.body ? r.body.length : 0 };
    if (zuGross) h.Connection = "close";
    if (zuGross) res.on("finish", () => req.destroy());
    if (r.stopp) res.on("finish", beende);
    res.writeHead(r.status, h);
    res.end(r.body);
  };
  req.on("data", (d) => {
    if (fertig) return;
    laenge += d.length;
    teile.push(d);
    if (laenge > MAX_KOERPER) weiter(true); // nicht weiterlesen — lib antwortet 413 (nach den Sicherheitsprüfungen)
  });
  req.on("end", () => weiter(false));
  req.on("error", () => { fertig = true; });
});
server.requestTimeout = 30 * 1000;
server.headersTimeout = 10 * 1000;
// Verbindungen ohne ein einziges Byte (greifen weder headers- noch requestTimeout) nach 15 s Ruhe schließen
// (Testhaken BRAIN_DIENST_RUHE_MS),
// und nie mehr als 64 gleichzeitig offen halten.
server.maxConnections = 64;
const RUHE_MS = Number(process.env.BRAIN_DIENST_RUHE_MS) > 0 ? Number(process.env.BRAIN_DIENST_RUHE_MS) : 15 * 1000; // Testhaken
server.on("connection", (s) => s.setTimeout(RUHE_MS, () => s.destroy()));
server.on("error", () => process.exit(1));

// Läuft schon ein ANDERER erreichbarer Dienst für diesen Vault (dienst.json zeigt auf ihn), ist dieser
// überzählig (paralleler Start, oder ein beschäftigter Dienst wurde für tot gehalten) → sich selbst beenden.
async function andererLaeuft() {
  let j;
  try { j = JSON.parse(readFileSync(dienstDatei, "utf8")); } catch { return false; }
  if (!j || j.pid === process.pid) return false;
  try {
    const { laufender } = await import(pathToFileURL(join(HIER, "dienst-start.mjs")).href);
    const r = await laufender(vault, { timeoutMs: 1500 });
    return !!(r && r.pid !== process.pid);
  } catch { return false; }
}

server.listen(0, "127.0.0.1", async () => {
  port = server.address().port;
  if (await andererLaeuft()) { server.close(); process.exit(0); }
  try { schreibeDienstDatei(); } catch { process.exit(1); }
  weckeLeerlauf();
  setInterval(async () => { if (!beendet && await andererLaeuft()) beende(); }, 60 * 1000).unref();
  process.stdout.write(`bereit ${port}\n`);
});
