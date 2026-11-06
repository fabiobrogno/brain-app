#!/usr/bin/env node
// werkstatt/start.mjs — „Kortex im Browser“ starten (Paket W1, Vorschau für Windows und Linux; am Mac zum Testen).
//   node Ressourcen/werkstatt/start.mjs [--vault <Ordner>] [--port <n>] [--nicht-oeffnen] [--beenden] [--hilfe]
// Startet die Werkstatt NUR auf 127.0.0.1 (freier Port), mit Zugangsschutz, und öffnet den Standardbrowser mit einer Einlass-Karte (einmal gültig).
// Läuft schon eine Instanz (Sperrdatei im Support-Ordner), öffnet ein zweiter Start nur den Browser auf der laufenden. Beenden: Strg+C oder `--beenden`.
// Ausgabe: „Bereit: <Adresse>“ bzw. „Läuft bereits: <Adresse>“ — die Adresse enthält nie ein Token.
import { supportOrdner, oeffneImBrowser } from "../gemeinsam/plattform.mjs";
import { bereinigePfad, vorschauFehler } from "../gemeinsam/basis.mjs";
import { HttpFehler } from "../gemeinsam/vault.mjs";
import { beanspruche, leseSperre, lebt, sperrDatei } from "./browser-sperre.mjs";
import { unlinkSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const HILFE = `Kortex im Browser (Vorschau)
  kortex [--vault <Ordner>] [--port <n>] [--nicht-oeffnen]   starten (oder den Browser auf der laufenden Instanz öffnen)
  kortex --beenden                                           die laufende Instanz beenden
Der Dienst hört nur auf 127.0.0.1; ohne den Link, den Kortex im Browser öffnet, kommt niemand hinein.`;

function lies(argv) {
  const o = { vault: undefined, port: 0, oeffnen: true, beenden: false, hilfe: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") o.vault = argv[++i];
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--nicht-oeffnen") o.oeffnen = false;
    else if (a === "--beenden") o.beenden = true;
    else if (a === "--hilfe" || a === "-h") o.hilfe = true;
    else return { fehler: `Unbekannte Angabe: ${a}` };
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) return { fehler: "Ungültiger Port" };
  return o;
}
const aus = (t) => process.stdout.write(`${t}\n`);
const fehler = (t) => process.stderr.write(`${t}\n`);

// Beim laufenden Dienst eine Einlass-Karte holen (mit dem Geheimnis aus der Sperrdatei) → Adresse mit Karte | null (antwortet nicht)
async function ruf(sperre, pfad) {
  try {
    const r = await fetch(`http://127.0.0.1:${sperre.port}${pfad}`, { method: "POST", headers: { Authorization: `Bearer ${sperre.geheimnis}` }, signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Die Karte kommt nie in die Befehlszeile des Browsers (auf Linux für jeden Benutzer lesbar): der Browser öffnet eine Startdatei (0600) im Support-Ordner, die auf /?t=<Karte> weiterleitet.
function raeumeStartdateien(support) {
  try { for (const n of readdirSync(support)) if (/^kortex-start-[\w-]+\.html$/.test(n)) { const p = join(support, n); if (Date.now() - statSync(p).mtimeMs > 120_000) unlinkSync(p); } } catch { /* egal */ }
}
async function oeffneBrowser(port, geheimnisOderKarte) {
  const karte = typeof geheimnisOderKarte === "function" ? geheimnisOderKarte() : geheimnisOderKarte;
  raeumeStartdateien(support);
  const datei = join(support, `kortex-start-${randomBytes(9).toString("base64url")}.html`);
  const ziel = `http://127.0.0.1:${port}/?t=${karte}`;
  writeFileSync(datei, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${ziel}"><title>Kortex</title><p>Kortex öffnet sich …</p>`, { mode: 0o600 });
  setTimeout(() => { try { unlinkSync(datei); } catch { /* weg */ } }, 60_000).unref();
  const r = await oeffneImBrowser(datei);
  if (!r.ok) fehler(`Der Browser ließ sich nicht öffnen (${r.text}). Starte Kortex mit KORTEX_BROWSER=<Programm> oder öffne http://127.0.0.1:${port}/ nach einem neuen Start von Hand.`);
  return r.ok;
}

const o = lies(process.argv.slice(2));
if (o.fehler) { fehler(`${o.fehler}\n${HILFE}`); process.exit(2); }
if (o.hilfe) { aus(HILFE); process.exit(0); }
const problem = vorschauFehler();
if (problem) { fehler(`Vorschau-Schutz: ${problem}`); process.exit(2); }
bereinigePfad(); // kein leerer oder relativer PATH-Eintrag (Vertrauen v2, §8)
const support = supportOrdner();

if (o.beenden) {
  const s = leseSperre(support);
  if (!s || !lebt(s) || !s.port) { aus("Kortex im Browser läuft nicht."); process.exit(0); }
  const r = await ruf(s, "/_kortex/beenden");
  aus(r ? "Kortex im Browser wird beendet." : "Der Dienst antwortet nicht.");
  process.exit(r ? 0 : 1);
}

// Eine Instanz je Support-Ordner: Sperre beanspruchen, sonst auf die laufende Instanz zeigen
let gehalten = false;
for (let versuch = 0; versuch < 60 && !gehalten; versuch++) {
  const b = beanspruche(support);
  if (b.ok) { gehalten = true; break; }
  const andere = b.andere;
  if (andere?.port && andere.geheimnis) {
    const k = await ruf(andere, "/_kortex/einlass");
    if (k?.karte) {
      aus(`Läuft bereits: http://127.0.0.1:${andere.port}/`);
      if (o.oeffnen) await oeffneBrowser(andere.port, k.karte);
      process.exit(0);
    }
    // Prozess lebt, antwortet aber nicht (hängt oder ist fremd): nichts anfassen
    fehler(`Eine andere Instanz (Prozess ${andere.pid}) hält die Sperre, antwortet aber nicht. Beende sie oder lösche ${sperrDatei(support)}.`);
    process.exit(1);
  }
  if (andere?.lebt) { await warte(100); continue; } // die andere startet gerade (noch ohne Port)
  await warte(50); // verwaist: beanspruche() hat sie schon entfernt, nächster Versuch
}
if (!gehalten) { fehler("Die Sperre ließ sich nicht erwerben."); process.exit(1); }

const { starteBrowserDienst } = await import("./browser-dienst.mjs");
let dienst;
try { dienst = await starteBrowserDienst({ vault: o.vault || process.env.BRAIN_VAULT || undefined, port: o.port, support, sperre: true }); }
catch (e) {
  const { gibFrei } = await import("./browser-sperre.mjs");
  gibFrei(support);
  fehler(`Start fehlgeschlagen: ${e instanceof HttpFehler ? e.message : e?.message || e}`);
  process.exit(e instanceof HttpFehler ? 2 : 1);
}
aus(`Bereit: ${dienst.adresse}`);
aus("Beenden mit Strg+C.");
if (o.oeffnen) await oeffneBrowser(dienst.port, () => dienst.zugang.neueKarte());
const ab = () => { dienst.stoppe().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on("SIGTERM", ab);
process.on("SIGINT", ab);
dienst.beendet.then(() => process.exit(0));
