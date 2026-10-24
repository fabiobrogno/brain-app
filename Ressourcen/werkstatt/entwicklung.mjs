#!/usr/bin/env node
// werkstatt/entwicklung.mjs — derselbe Handler über HTTP, nur 127.0.0.1 (Entwicklung und Playwright-Tests; die App
// startet das nie). Aufruf: node entwicklung.mjs <vault> [port]   (Port auch per BRAIN_PORT, Standard 4517, 0 = frei)
import { createServer } from "node:http";
import { erzeugeHandler, MAX_KOERPER } from "./handler.mjs";
import { HttpFehler } from "../gemeinsam/vault.mjs";

const vault = process.argv[2] || process.env.BRAIN_VAULT;
if (!vault) { process.stderr.write("Aufruf: node entwicklung.mjs <vault> [port]\n"); process.exit(2); }
const portWunsch = Number(process.argv[3] ?? process.env.BRAIN_PORT ?? 4517);
let handler;
try { handler = erzeugeHandler({ vault }); }
catch (e) { process.stderr.write(`${e instanceof HttpFehler ? e.message : e}\n`); process.exit(2); }

const server = createServer(async (req, res) => {
  const host = String(req.headers.host || "");
  const port = server.address().port;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403); return res.end("Host nicht erlaubt"); } // gegen DNS-Rebinding
  const teile = [];
  let groesse = 0, zuGross = false;
  for await (const stueck of req) { groesse += stueck.length; if (groesse > MAX_KOERPER) { zuGross = true; break; } teile.push(stueck); }
  if (zuGross) { res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" }); return res.end('{"fehler":"Anfrage zu groß"}'); }
  const url = new URL(req.url, "http://127.0.0.1");
  let r;
  try { r = await handler({ methode: req.method, pfad: url.pathname, query: url.search.slice(1), body: teile.length ? Buffer.concat(teile) : undefined }); }
  catch { r = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: Buffer.from('{"fehler":"Interner Fehler"}') }; }
  res.writeHead(r.status, r.headers || {});
  res.end(req.method === "HEAD" ? undefined : r.body);
  if (r.stopp) { server.close(() => process.exit(0)); server.closeAllConnections?.(); }
});
server.listen(portWunsch, "127.0.0.1", () => {
  process.stdout.write(`Bereit: http://127.0.0.1:${server.address().port}/\n`);
});
server.on("error", (e) => { process.stderr.write(`Start fehlgeschlagen: ${e.message}\n`); process.exit(1); });
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
