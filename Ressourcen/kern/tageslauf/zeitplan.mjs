// tageslauf/zeitplan.mjs — Wann der Tageslauf läuft (Spec §5.1): fällig (letzter Erfolg > 20 h), Strom/Leerlauf
// (nur mit --dienst), Sperre (PID + Startzeit), losgelöster Start und Rückfall beim Sitzungsstart. Wirft nie.
// Testhaken: BRAIN_PMSET_DATEI / BRAIN_IOREG_DATEI (Ausgabe aus Datei), BRAIN_TAGESLAUF_SKRIPT (Skript beim Start).
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TL_DIR, leseLetzter } from "./protokoll.mjs";
import { leseAutomatik } from "../einstellungen.mjs";
import { dienstEingerichtet } from "./dienst.mjs";

export const FAELLIG_MS = 20 * 3600e3, RUECKFALL_MS = 36 * 3600e3, LEERLAUF_S = 600;
const SPERRE_MAX_MS = 2 * 3600e3, NICHT_GLEICH_WIEDER_MS = 3600e3;
const SPERRE = (vault) => join(TL_DIR(vault), "lauf.lock");
const START_MARKE = (vault) => join(TL_DIR(vault), "letzter-start");

export function faellig(vault, { jetzt = Date.now() } = {}) {
  const t = Date.parse(leseLetzter(vault)?.letzterErfolg || "");
  return !Number.isFinite(t) || jetzt - t > FAELLIG_MS;
}

// Geräte ohne Akku (kein „InternalBattery") zählen immer als am Netz.
export function parsePmset(text) { const t = String(text || ""); return { amNetz: /'AC Power'/.test(t) || !/InternalBattery/.test(t) }; }
export function parseIoreg(text) { const m = String(text || "").match(/"HIDIdleTime"\s*=\s*(\d+)/); return m ? Math.floor(Number(m[1]) / 1e9) : null; }
function lies(befehl, args, testDatei) {
  if (process.env[testDatei]) return readFileSync(process.env[testDatei], "utf8");
  return execFileSync(befehl, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
}
export const lesePmset = () => lies("/usr/bin/pmset", ["-g", "ps"], "BRAIN_PMSET_DATEI");
export const leseIoreg = () => lies("/usr/sbin/ioreg", ["-c", "IOHIDSystem"], "BRAIN_IOREG_DATEI");

// Nur mit --dienst: am Netz und ≥ 10 min keine Eingabe. Unlesbar → nicht laufen (lieber eine Stunde später).
export function bedingungen({ pmset = lesePmset, ioreg = leseIoreg } = {}) {
  let netz;
  try { netz = parsePmset(pmset()).amNetz; } catch { return { ok: false, grund: "Stromzustand unbekannt" }; }
  if (!netz) return { ok: false, grund: "läuft auf Akku" };
  let idle = null;
  try { idle = parseIoreg(ioreg()); } catch {}
  if (idle === null) return { ok: false, grund: "Leerlauf unbekannt" };
  if (idle < LEERLAUF_S) return { ok: false, grund: "Mac wird benutzt" };
  return { ok: true };
}

const pidLebtStandard = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// Sperre { pid, start }: frei, wenn die PID tot ist oder die Sperre > 2 h alt (PID-Wiederverwendung nach Neustart).
export function nimmSperre(vault, { jetzt = Date.now(), pidLebt = pidLebtStandard } = {}) {
  const f = SPERRE(vault);
  try { mkdirSync(dirname(f), { recursive: true }); } catch { return false; }
  for (let versuch = 0; versuch < 2; versuch++) {
    try { writeFileSync(f, JSON.stringify({ pid: process.pid, start: new Date(jetzt).toISOString() }), { flag: "wx" }); return true; }
    catch (e) { if (e.code !== "EEXIST") return false; }
    let alt = null;
    try { alt = JSON.parse(readFileSync(f, "utf8")); } catch {}
    const start = Date.parse(alt?.start || "");
    if (alt && Number.isInteger(alt.pid) && Number.isFinite(start) && jetzt - start < SPERRE_MAX_MS && pidLebt(alt.pid)) return false;
    try { unlinkSync(f); } catch {}
  }
  return false;
}
export function gibSperreFrei(vault) {
  try { if (JSON.parse(readFileSync(SPERRE(vault), "utf8")).pid === process.pid) unlinkSync(SPERRE(vault)); } catch {}
}

export function markeStart(vault, jetzt = Date.now()) {
  try { mkdirSync(TL_DIR(vault), { recursive: true }); writeFileSync(START_MARKE(vault), new Date(jetzt).toISOString() + "\n"); } catch {}
}
const letzterStart = (vault) => { try { return Date.parse(readFileSync(START_MARKE(vault), "utf8").trim()); } catch { return NaN; } };

const SKRIPT = () => process.env.BRAIN_TAGESLAUF_SKRIPT || join(dirname(fileURLToPath(import.meta.url)), "..", "tageslauf.mjs");
export function starteLosgeloest(vault, args = []) {
  if (process.env.BRAIN_ERNTE === "1") return { gestartet: false, grund: "Selbstaufruf" };
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const kind = spawn(process.execPath, [SKRIPT(), vault, ...args], { cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env: { ...env, BRAIN_VAULT: vault } });
    kind.on("error", () => {});
    kind.unref();
    return { gestartet: true };
  } catch { return { gestartet: false, grund: "Start fehlgeschlagen" }; }
}

// Rückfall beim Sitzungsstart (§5.1): ohne Dienst, wenn fällig; mit Dienst, wenn seit > 36 h kein Start. Ohne
// Leerlauf-Prüfung. Höchstens ein Start je Stunde (Marke letzter-start), damit nicht jede Sitzung einen Lauf anstößt.
export function starteWennFaellig(vault, { jetzt = Date.now(), home = homedir(), dienstDa = dienstEingerichtet } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return false;
  const { werte, fehler } = leseAutomatik(vault);
  if (fehler || werte.tageslauf === "aus") return false;
  const start = letzterStart(vault);
  const soll = dienstDa({ home })
    ? !Number.isFinite(start) || jetzt - start > RUECKFALL_MS
    : faellig(vault, { jetzt }) && (!Number.isFinite(start) || jetzt - start > NICHT_GLEICH_WIEDER_MS);
  if (!soll) return false;
  const r = starteLosgeloest(vault, ["--wenn-faellig"]);
  if (r.gestartet) markeStart(vault, jetzt);
  return r.gestartet === true;
}
