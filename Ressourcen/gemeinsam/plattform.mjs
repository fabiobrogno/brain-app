// gemeinsam/plattform.mjs — die EINE Stelle für Unterschiede zwischen macOS, Windows und Linux (Plan docs/plaene/plattformen-windows-linux.md, Paket W0).
// Neue Betriebssystem-Befehle im Node-Code gehören hierher, nicht verstreut in andere Dateien. Alles ist über `plattform`/`env`/`home` einspritzbar (Tests).
// Eine Kopie liegt wortgleich in kern/plattform.mjs (der Kern importiert nichts aus gemeinsam/); Tests/Node/plattform.test.mjs vergleicht beide.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

export const istMac = (plattform = process.platform) => plattform === "darwin";
export const istWindows = (plattform = process.platform) => plattform === "win32";

// ───────────── Support-Ordner ─────────────
// Basis der App-Daten: macOS ~/Library/Application Support · Windows %APPDATA% · Linux $XDG_DATA_HOME bzw. ~/.local/share (dieselbe Regel wie kern/pfade.mjs).
export const supportBasis = ({ home = homedir(), env = process.env, plattform = process.platform } = {}) => {
  if (plattform === "darwin") return join(home, "Library", "Application Support");
  if (plattform === "win32") return env.APPDATA || join(home, "AppData", "Roaming");
  return env.XDG_DATA_HOME || join(home, ".local", "share");
};
// Support-Ordner der App; BRAIN_APP_SUPPORT lenkt ihn um (Tests, Vorschau).
export const supportOrdner = (o = {}) => (o.env || process.env).BRAIN_APP_SUPPORT || join(supportBasis(o), "Kortex");
// Standardort laut Benutzereintrag des Systems (nicht aus HOME) → Pfad oder null.
export const standardSupport = (o = {}) => { try { return join(supportBasis({ ...o, home: o.home || userInfo().homedir }), "Kortex"); } catch { return null; } };

// ───────────── macOS-only ─────────────
export const NICHT_VERFUEGBAR = "nicht verfügbar auf diesem System";
// Führt `fn` nur am Mac aus. Sonst ein sauberes Ergebnis statt eines Absturzes: { ok:false, nichtVerfuegbar:true, text:"<was>: nicht verfügbar auf diesem System" }.
export function nurMac(was, fn, { plattform = process.platform } = {}) {
  if (!istMac(plattform)) return { ok: false, nichtVerfuegbar: true, text: `${was}: ${NICHT_VERFUEGBAR}` };
  return { ok: true, wert: fn() };
}

// ───────────── Prozesse ─────────────
// Beendet einen EIGENEN Kindprozess samt Nachkommen. macOS/Linux: Prozessgruppe (Kind wurde mit detached gestartet), Rückfall nur das Kind.
// Windows: `taskkill /T /F` auf genau diese PID (kein Namens- oder Fremdbezug), Rückfall kind.kill().
export function beendeBaum(kind, signal = "SIGKILL", { plattform = process.platform, lauf = spawnSync } = {}) {
  if (!kind || kind.pid === undefined) return;
  if (istWindows(plattform)) {
    try { const r = lauf("taskkill", ["/PID", String(kind.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10_000 }); if (r && r.status === 0) return; } catch { /* Rückfall */ }
    try { kind.kill(signal); } catch { /* schon weg */ }
    return;
  }
  try { process.kill(-kind.pid, signal); } catch { try { kind.kill(signal); } catch { /* schon weg */ } }
}

// Startzeit eines Prozesses (gegen PID-Wiederverwendung bei Sperren). Werkstatt und MCP-Server laufen mit verschiedenem LANG/LC_ALL/TZ, die Ausgabe von ps hängt davon ab —
// darum absoluter Pfad und feste Umgebung (C, UTC). Windows: PowerShell (ISO-Zeit in UTC). Leer = unbekannt.
export const PS_ENV = { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/bin:/usr/bin" };
export function prozessStart(pid, { plattform = process.platform, ausfuehren = execFileSync } = {}) {
  if (istWindows(plattform)) {
    try {
      return String(ausfuehren("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],
        { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true })).trim();
    } catch { return ""; }
  }
  for (const ps of ["/bin/ps", "/usr/bin/ps"]) {
    try { return ausfuehren(ps, ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 3000, env: PS_ENV, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* nächster Pfad */ }
  }
  return "";
}

// ───────────── Geräte-Identität ─────────────
// Hardware-ID: macOS IOPlatformUUID · Linux /etc/machine-id · Windows MachineGuid (Registry). Leer = unbekannt (der Aufrufer fällt auf den Rechnernamen zurück).
export function geraeteKennung({ plattform = process.platform, ausfuehren = execFileSync, lies = (p) => readFileSync(p, "utf8") } = {}) {
  if (istMac(plattform)) {
    try { const t = ausfuehren("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 3000, env: PS_ENV, stdio: ["ignore", "pipe", "ignore"] }); return (/"IOPlatformUUID" = "([0-9A-Fa-f-]+)"/.exec(t) || [])[1] || ""; } catch { return ""; }
  }
  if (istWindows(plattform)) {
    try {
      const t = String(ausfuehren("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }));
      return (/MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]+)/.exec(t) || [])[1] || "";
    } catch { return ""; }
  }
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) { try { const v = lies(p).trim(); if (v) return v; } catch { /* nächster Ort */ } }
  return "";
}
export const rechnerName = () => hostname();

// ───────────── Zugangsdaten für git ─────────────
// Name des git-Credential-Helpers: macOS osxkeychain · Windows manager (Git Credential Manager) · Linux libsecret, sonst cache (nur im Speicher, 1 Stunde).
export function credentialHelper({ plattform = process.platform, vorhanden = existsSync } = {}) {
  if (istMac(plattform)) return "osxkeychain";
  if (istWindows(plattform)) return "manager";
  const libsecret = ["/usr/lib/git-core/git-credential-libsecret", "/usr/libexec/git-core/git-credential-libsecret", "/usr/share/doc/git/contrib/credential/libsecret/git-credential-libsecret"];
  return libsecret.some((p) => vorhanden(p)) ? "libsecret" : "cache --timeout=3600";
}
