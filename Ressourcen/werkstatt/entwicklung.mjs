#!/usr/bin/env node
// werkstatt/entwicklung.mjs — derselbe Handler über HTTP, nur 127.0.0.1 (Entwicklung und Playwright-Tests; die App
// startet das nie). Aufruf: node entwicklung.mjs [<vault>] [port]   (Port auch per BRAIN_PORT, Standard 4517, 0 = frei)
// Ohne Vault-Argument (oder mit "-" als Platzhalter vor dem Port) gilt der aktive Vault aus <support>/vaults.json, sonst „kein Vault“.
// SICHERHEIT: Dieser Server hat KEIN Zugriffs-Token — jeder Prozess desselben Benutzers, der 127.0.0.1:<port> erreicht, spricht mit der Werkstatt. Geschützt ist er nur gegen Browser-Querzugriffe
// (Host- und Origin-Prüfung, nur JSON). Er ist ausschließlich für Entwicklung und Playwright-Tests da; die App startet ihn nie (sie spricht über den Nachrichtenkanal brain://).
import { createServer } from "node:http";
import { erzeugeHandler, MAX_KOERPER } from "./handler.mjs";
import { HttpFehler } from "../gemeinsam/vault.mjs";
import { beendeLaufendes } from "../gemeinsam/git.mjs";
import { beendeAlleProzesse } from "../gemeinsam/prozess.mjs";
import { beendeVorgaenge } from "../gemeinsam/vaults.mjs";
import { bereinigePfad } from "../gemeinsam/basis.mjs";

bereinigePfad(); // kein leerer oder relativer PATH-Eintrag (Vertrauen v2, §8)
const vaultArg = process.argv[2];
const vault = (vaultArg && vaultArg !== "-" ? vaultArg : undefined) || process.env.BRAIN_VAULT || undefined;
const portWunsch = Number(process.argv[3] ?? process.env.BRAIN_PORT ?? 4517);
let handler;
try { handler = erzeugeHandler(vault ? { vault } : {}); }
catch (e) { process.stderr.write(`${e instanceof HttpFehler ? e.message : e}\n`); process.exit(2); }

const server = createServer(async (req, res) => {
  const host = String(req.headers.host || "");
  const port = server.address().port;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403); return res.end("Host nicht erlaubt"); } // gegen DNS-Rebinding
  // CSRF: Browser schicken bei fremden Seiten einen Origin mit — nur die eigene Adresse ist erlaubt (ohne Origin = kein Browser-Querzugriff).
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" }); return res.end('{"fehler":"Herkunft nicht erlaubt"}');
  }
  const teile = [];
  let groesse = 0, zuGross = false;
  for await (const stueck of req) { groesse += stueck.length; if (groesse > MAX_KOERPER) { zuGross = true; break; } teile.push(stueck); }
  // Schreibende Anfragen mit Inhalt müssen JSON sein (kein Formular/text/plain von fremden Seiten).
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && teile.length && !/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || ""))) {
    res.writeHead(415, { "Content-Type": "application/json; charset=utf-8" }); return res.end('{"fehler":"Nur JSON erlaubt"}');
  }
  if (zuGross) { res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" }); return res.end('{"fehler":"Anfrage zu groß"}'); }
  const url = new URL(req.url, "http://127.0.0.1");
  let r;
  try { r = await handler({ methode: req.method, pfad: url.pathname, query: url.search.slice(1), body: teile.length ? Buffer.concat(teile) : undefined }); }
  catch { r = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: Buffer.from('{"fehler":"Interner Fehler"}') }; }
  res.writeHead(r.status, r.headers || {});
  res.end(req.method === "HEAD" ? undefined : r.body);
  if (r.stopp) { try { beendeAlleProzesse(); } catch { /* egal */ } server.close(() => process.exit(0)); server.closeAllConnections?.(); }
});
server.listen(portWunsch, "127.0.0.1", () => {
  process.stdout.write(`Bereit: http://127.0.0.1:${server.address().port}/\n`);
});
server.on("error", (e) => { process.stderr.write(`Start fehlgeschlagen: ${e.message}\n`); process.exit(1); });
const abraeumenUndEnde = () => {
  try { beendeLaufendes(); } catch { /* beenden wir trotzdem */ }
  try { beendeVorgaenge(); } catch { /* beenden wir trotzdem */ } // halbes Anlegen/Klonen/„Git einschalten“ zurücknehmen
  process.exit(0);
};
process.on("SIGTERM", abraeumenUndEnde);
process.on("SIGINT", abraeumenUndEnde);
