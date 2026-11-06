// Hilfen für die Tests von „Kortex im Browser“ (Paket W1): startet den echten Startbefehl (Ressourcen/werkstatt/start.mjs) als Kindprozess mit ausdrücklich gebauter Umgebung —
// eigenes HOME und eigener Support-Ordner in Temp, nie der echte Benutzerordner, nie CLAUDE_CONFIG_DIR/CODEX_HOME/XDG_*/GIT_CONFIG_* des Testlaufs. Beendet werden nur eigene Prozesse (`--beenden`, sonst kill der eigenen PID).
import { spawn } from "node:child_process";
import { request } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, WURZEL } from "./hilfe.mjs";

export const START = join(WURZEL, "werkstatt", "start.mjs");

export function sauberUmgebung({ home, support, extra = {} }) {
  const e = {
    PATH: process.env.PATH, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", TZ: "Europe/Berlin", KORTEX_VAULT_VERTRAUT: "alle",
  };
  for (const k of ["SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG"]) if (process.env[k] !== undefined) e[k] = process.env[k];
  return { ...e, ...extra };
}
export function neueUmgebung() {
  const home = tmp("kortex-browser-home-");
  const support = join(home, "support");
  mkdirSync(support, { recursive: true });
  return { home, support };
}

// Startet start.mjs → { adresse, port, ausgabe(), beendet (Promise → Exitcode), stopp(), kind }
export async function starte({ home, support, args = [], extra = {}, fristMs = 20000 } = {}) {
  if (!home) ({ home, support } = neueUmgebung());
  const kind = spawn(process.execPath, [START, "--nicht-oeffnen", ...args], { stdio: ["ignore", "pipe", "pipe"], env: sauberUmgebung({ home, support, extra }), windowsHide: true });
  let puffer = "";
  const beendet = new Promise((ok) => kind.on("exit", (c) => ok(c)));
  kind.stdout.on("data", (d) => { puffer += d; });
  kind.stderr.on("data", (d) => { puffer += d; });
  const gefunden = await new Promise((ok, nein) => {
    const frist = setTimeout(() => nein(new Error("Start meldet sich nicht: " + puffer)), fristMs);
    const pruefe = () => { const m = /(Bereit|Läuft bereits): (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(puffer); if (m) { clearTimeout(frist); ok(m); } };
    kind.stdout.on("data", pruefe); kind.stderr.on("data", pruefe);
    beendet.then((c) => { pruefe(); if (!/(Bereit|Läuft bereits): /.test(puffer)) { clearTimeout(frist); nein(new Error(`start.mjs beendet (${c}): ${puffer}`)); } });
    pruefe();
  });
  return { adresse: gefunden[2], port: Number(gefunden[3]), art: gefunden[1], home, support, kind, beendet, ausgabe: () => puffer, stopp: () => { try { kind.kill(); } catch { /* weg */ } return beendet; } };
}

// HTTP mit frei wählbaren Kopfzeilen (fetch erlaubt kein eigenes Host/Origin) → { status, kopf, text }
export function rufe({ port, pfad = "/", methode = "GET", kopf = {}, body }) {
  return new Promise((ok, nein) => {
    const r = request({ host: "127.0.0.1", port, path: pfad, method: methode, headers: { ...(body !== undefined ? { "Content-Length": Buffer.byteLength(body) } : {}), ...kopf } }, (res) => {
      const teile = []; res.on("data", (d) => teile.push(d)); res.on("end", () => ok({ status: res.statusCode, kopf: res.headers, text: Buffer.concat(teile).toString("utf8") }));
    });
    r.on("error", nein);
    if (body !== undefined) r.write(body);
    r.end();
  });
}
export const sperre = (support) => JSON.parse(readFileSync(join(support, "browser-dienst.json"), "utf8"));
// Einlass-Karte wie der Startbefehl: mit dem Geheimnis der Sperrdatei → Karte
export async function karte(dienst) {
  const s = sperre(dienst.support);
  const r = await rufe({ port: dienst.port, pfad: "/_kortex/einlass", methode: "POST", kopf: { Authorization: `Bearer ${s.geheimnis}`, Host: `127.0.0.1:${dienst.port}` }, body: "" });
  return r.status === 200 ? JSON.parse(r.text).karte : null;
}
// Karte einlösen → Cookie-Zeile "name=wert" für spätere Anfragen
export async function meldeAn(dienst) {
  const k = await karte(dienst);
  const r = await rufe({ port: dienst.port, pfad: `/?t=${k}`, kopf: { Host: `127.0.0.1:${dienst.port}` } });
  const c = String(r.kopf["set-cookie"] || "").split(";")[0];
  return { cookie: c, antwort: r, karte: k };
}
