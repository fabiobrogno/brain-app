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

// Die Kennungen der Prozesse, die gerade registriert sind (nur lesen; für Tests und Diagnose).
export const laufendePids = () => [...laufende].map((e) => e.kind.pid).filter((p) => p !== undefined);

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
    if (wirdBeendet) return ablehnen(new HttpFehler(503, "Kortex Studio wird gerade beendet."));
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

// Streaming-Variante von `starte` (Frag deinen Vault, docs/plaene/ki-konten.md §4): das Programm läuft in einer eigenen Prozessgruppe, jede Zeile von stdout geht
// sofort an `onZeile` (ein Chunk kann mehrere Zeilen enthalten, eine Zeile mehrere Chunks). Grenzen: Gesamtfrist, Gesamtmenge von stdout, Länge einer Zeile —
// bei Überschreitung wird sanft beendet (stopp). Wirft nie; Fehler stehen im Ergebnis.
//   o: cwd, env, stdin (Text, wird geschrieben und geschlossen), onZeile(text), frist (ms), maxBytes, maxZeile, stderrBytes (letzte Bytes von stderr, die behalten werden)
//   → { kind, stopp(grund), fertig: Promise<{ code, signal, grund, stderr, gestartet }> }
//   stopp(grund): SIGINT an die Gruppe (beendet den Turn von `claude -p`), nach 2 s SIGTERM, nach 5 s SIGKILL. Mehrfaches Aufrufen ist harmlos (der erste Grund zählt).
//   grund: null (ohne Eingriff beendet) | der Text von stopp(…) | "frist" | "ausgabe" | "zeile" | "start" (Programm fehlt oder ließ sich nicht starten).
export function starteStrom(programm, args, o = {}) {
  const { cwd, env, stdin, onZeile = () => {}, frist = 120_000, maxBytes = 1024 * 1024, maxZeile = 256 * 1024, stderrBytes = 4096 } = o;
  const gestartet = Date.now();
  const nichts = (g) => ({ kind: null, stopp: () => {}, fertig: Promise.resolve({ code: null, signal: null, grund: g, stderr: "", gestartet }) });
  if (wirdBeendet) return nichts("start");
  let kind;
  try { kind = spawn(programm, args, { cwd, env, detached: true, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true }); }
  catch { return nichts("start"); }
  const eintrag = registriere(kind, cwd);
  if (stdin !== undefined) { kind.stdin.on("error", () => { /* Programm schon fertig */ }); kind.stdin.end(stdin); kind.once("exit", () => kind.stdin.destroy()); }
  let grund = null, gestoppt = false, rest = Buffer.alloc(0), menge = 0, fehl = Buffer.alloc(0);
  const timer = new Set();
  const spaeter = (ms, f) => { const t = setTimeout(f, ms); timer.add(t); return t; };
  const gruppe = (sig) => { try { process.kill(-kind.pid, sig); } catch { try { kind.kill(sig); } catch { /* schon weg */ } } };
  const stopp = (g = "abgebrochen") => {
    if (grund === null) grund = g;
    if (gestoppt) return;
    gestoppt = true;
    gruppe("SIGINT");
    spaeter(2000, () => gruppe("SIGTERM"));
    spaeter(5000, () => beendeGruppe(kind));
  };
  const zeilen = (chunk) => {
    rest = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let i;
    while ((i = rest.indexOf(10)) >= 0) {
      const zeile = rest.subarray(0, i).toString("utf8").replace(/\r$/, "");
      rest = rest.subarray(i + 1);
      if (zeile) { try { onZeile(zeile); } catch { /* ein Fehler beim Aufrufer bricht den Strom nicht ab */ } }
    }
    if (rest.length > maxZeile) { rest = Buffer.alloc(0); stopp("zeile"); }
  };
  kind.stdout.on("data", (d) => {
    menge += d.length;
    if (menge > maxBytes) { stopp("ausgabe"); return; }
    if (grund === "zeile") return;
    zeilen(d);
  });
  kind.stderr.on("data", (d) => { fehl = Buffer.concat([fehl, d]); if (fehl.length > stderrBytes) fehl = fehl.subarray(fehl.length - stderrBytes); });
  kind.stdout.on("error", () => { /* Kanal zu: egal */ }); kind.stderr.on("error", () => { /* Kanal zu: egal */ });
  spaeter(frist, () => stopp("frist"));
  const fertig = new Promise((aufloesen) => {
    let erledigt = false;
    const ende = (code, signal, start = false) => {
      if (erledigt) return;
      erledigt = true;
      for (const t of timer) clearTimeout(t);
      timer.clear();
      laufende.delete(eintrag);
      beendeGruppe(kind); // Reste der Gruppe (MCP-Server, Hooks) aufräumen, auch wenn der Hauptprozess selbst schon weg ist
      try { kind.stdout.destroy(); kind.stderr.destroy(); } catch { /* weg */ }
      if (rest.length && grund === null) { try { onZeile(rest.toString("utf8")); } catch { /* egal */ } }
      aufloesen({ code: code ?? null, signal: signal ?? null, grund: start ? "start" : grund, stderr: fehl.toString("utf8"), gestartet });
    };
    kind.on("error", () => ende(null, null, true));
    // „exit“ vor „close“: hält ein Enkelprozess die Kanäle offen, warten wir höchstens kurz auf die letzten Daten
    kind.on("exit", (code, signal) => { spaeter(1000, () => ende(code, signal)); });
    kind.on("close", (code, signal) => ende(code, signal));
  });
  return { kind, stopp, fertig };
}
