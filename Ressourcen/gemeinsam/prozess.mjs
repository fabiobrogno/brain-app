// gemeinsam/prozess.mjs — Kindprozesse für Git und `claude`: je Prozess eine eigene Prozessgruppe (detached), harte Zeitlimits mit
// Gesamtfrist je Route, bei Ablauf wird die GANZE Gruppe beendet (Hooks, ssh, git-remote-*, Merge-Treiber), und beim Beenden der
// Werkstatt (SIGTERM) lässt sich alles Laufende auf einmal abräumen. Keine Abhängigkeiten außer basis.mjs.
import { spawn } from "node:child_process";
import { HttpFehler } from "./basis.mjs";

const laufende = new Set(); // { kind, cwd, start }
let wirdBeendet = false;

// Gesamtfrist einer Route: jeder Aufruf bekommt nur, was übrig ist (rest), nie die volle Einzelfrist.
export function neueFrist(ms) {
  const ende = Date.now() + ms;
  return { ms, rest: () => Math.max(0, ende - Date.now()), abgelaufen: () => Date.now() >= ende };
}

export function beendeGruppe(kind) {
  if (!kind || kind.pid === undefined) return;
  try { process.kill(-kind.pid, "SIGKILL"); } catch { try { kind.kill("SIGKILL"); } catch { /* schon weg */ } }
}

// Merkt einen von außen gestarteten Prozess (z. B. der MCP-Server der Probe), damit er beim Beenden mit abgeräumt wird.
export function registriere(kind, cwd = null) {
  const e = { kind, cwd, start: Date.now() };
  laufende.add(e);
  kind.once("exit", () => laufende.delete(e));
  return e;
}

// Alles Laufende beenden (synchron, SIGKILL an die Gruppen); danach starten keine neuen Prozesse mehr. → [{ pid, cwd, start }]
export function beendeAlleProzesse() {
  wirdBeendet = true;
  const infos = [];
  for (const e of laufende) { infos.push({ pid: e.kind.pid, cwd: e.cwd, start: e.start }); beendeGruppe(e.kind); }
  laufende.clear();
  return infos;
}
export const beendetGerade = () => wirdBeendet;

// → { code, stdout, stderr } — o.stdin (Text) wird in den Standardeingang geschrieben (sonst bleibt er zu). stdout ist ein Buffer bei buffer:true, sonst Text. Wirft HttpFehler:
//   504 bei Zeitlimit/abgelaufener Frist (extra.gestartet = Startzeit ms; die Prozessgruppe ist dann schon beendet),
//   500 wenn das Programm fehlt (o.fehlt) oder zu viel ausgibt, 503 während die Werkstatt beendet wird.
export function starte(programm, args, o = {}) {
  const { cwd, env, timeout, stdin, frist = null, maxBuffer = 64 * 1024 * 1024, buffer = false, fehlt = `${programm} wurde nicht gefunden.`,
    zuLange = "Der Vorgang hat zu lange gebraucht und wurde abgebrochen." } = o;
  return new Promise((aufloesen, ablehnen) => {
    if (wirdBeendet) return ablehnen(new HttpFehler(503, "Brain Studio wird gerade beendet."));
    let limit = timeout > 0 ? timeout : Infinity;
    if (frist) limit = Math.min(limit, frist.rest());
    const gestartet = Date.now();
    if (limit <= 0) return ablehnen(new HttpFehler(504, zuLange, { gestartet }));
    let kind;
    try { kind = spawn(programm, args, { cwd, env, detached: true, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true }); }
    catch (e) { return ablehnen(new HttpFehler(500, e && e.code === "ENOENT" ? fehlt : `${programm} ließ sich nicht starten.`)); }
    const eintrag = registriere(kind, cwd);
    if (stdin !== undefined) { kind.stdin.on("error", () => { /* Programm schon fertig */ }); kind.stdin.end(stdin); kind.once("exit", () => kind.stdin.destroy()); } // z. B. `git credential`: Zugangsdaten nie als Argument
    const aus = [], fehl = [];
    let groesse = 0, fertig = false, uhr = null, nachlauf = null, ausgang = null;
    const ende = (fehler, wert) => {
      if (fertig) return;
      fertig = true; clearTimeout(uhr); clearTimeout(nachlauf); laufende.delete(eintrag);
      if (fehler) ablehnen(fehler); else aufloesen(wert);
    };
    const kanaeleZu = () => { try { kind.stdout.destroy(); kind.stderr.destroy(); } catch { /* weg */ } };
    const ergebnis = () => ({ code: ausgang === null || ausgang === undefined ? 1 : ausgang, stdout: buffer ? Buffer.concat(aus) : Buffer.concat(aus).toString("utf8"), stderr: Buffer.concat(fehl).toString("utf8") });
    const sammle = (liste) => (d) => {
      groesse += d.length;
      if (groesse > maxBuffer) { beendeGruppe(kind); kanaeleZu(); return ende(new HttpFehler(500, "Das Programm hat zu viel Ausgabe geliefert.")); }
      liste.push(d);
    };
    kind.stdout.on("data", sammle(aus)); kind.stderr.on("data", sammle(fehl));
    kind.stdout.on("error", () => { /* Kanal zu: egal */ }); kind.stderr.on("error", () => { /* Kanal zu: egal */ });
    kind.on("error", (e) => ende(new HttpFehler(500, e && e.code === "ENOENT" ? fehlt : `${programm} ließ sich nicht starten.`)));
    // „exit“ vor „close“: Hält ein Enkelprozess die Kanäle offen, warten wir höchstens kurz auf die letzten Daten.
    kind.on("exit", (code) => { if (fertig) return; ausgang = code; nachlauf = setTimeout(() => { kanaeleZu(); ende(null, ergebnis()); }, 1000); });
    kind.on("close", (code) => { if (ausgang === null || ausgang === undefined) ausgang = code; ende(null, ergebnis()); });
    if (Number.isFinite(limit)) {
      uhr = setTimeout(() => { // Zeitlimit: ganze Gruppe weg, Kanäle frei, nicht länger warten
        beendeGruppe(kind); kanaeleZu();
        ende(new HttpFehler(504, zuLange, { gestartet }));
      }, limit);
    }
  });
}
