// gemeinsam/plattform.mjs — die EINE Stelle für Unterschiede zwischen macOS, Windows und Linux (Plan docs/plaene/plattformen-windows-linux.md, Paket W0).
// Neue Betriebssystem-Befehle im Node-Code gehören hierher, nicht verstreut in andere Dateien. Alles ist über `plattform`/`env`/`home` einspritzbar (Tests).
// Eine Kopie liegt wortgleich in kern/plattform.mjs (der Kern importiert nichts aus gemeinsam/); Tests/Node/plattform.test.mjs vergleicht beide.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { execFile, execFileSync, spawnSync, spawn } from "node:child_process";

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

// Pfad in Regeln von Claude Code (permissions.deny: `Read(//<pfad>/**)`): dort gilt auch unter Windows die POSIX-Form, `C:\\Users\\x` heißt `/c/Users/x`. Andere Pfade bleiben wie sie sind.
export const claudePfadform = (p) => { const m = /^([A-Za-z]):[\\/](.*)$/.exec(String(p)); return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}` : String(p); };

// ───────────── macOS-only ─────────────
export const NICHT_VERFUEGBAR = "nicht verfügbar auf diesem System";
// Führt `fn` nur am Mac aus. Sonst ein sauberes Ergebnis statt eines Absturzes: { ok:false, nichtVerfuegbar:true, text:"<was>: nicht verfügbar auf diesem System" }.
export function nurMac(was, fn, { plattform = process.platform } = {}) {
  if (!istMac(plattform)) return { ok: false, nichtVerfuegbar: true, text: `${was}: ${NICHT_VERFUEGBAR}` };
  return { ok: true, wert: fn() };
}

// ───────────── Prozesse ─────────────
// Langform eines Pfads. Windows legt Temp-Ordner in Kurzform an (C:\Users\RUNNER~1\…), Programme melden die lange: wer Pfade später mit deren Angaben vergleicht, nimmt vorher diese Form.
// macOS/Linux: der Pfad bleibt, wie er ist.
export const langerPfad = (p, { plattform = process.platform, aufloesen = realpathSync.native } = {}) => { if (!istWindows(plattform)) return p; try { return aufloesen(p); } catch { return p; } };

// `detached` für Kinder MIT Ein-/Ausgabekanälen: macOS/Linux eigene Prozessgruppe (beendeBaum trifft sie); Windows nie — `detached` heißt dort „ohne Konsole", und ein Kind
// mit Kanälen liefert dann keine Ausgabe (Starter, Skripte); beendet wird dort per taskkill /T.
export const eigeneGruppe = (plattform = process.platform) => !istWindows(plattform);
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

// Windows: alle Prozesse mit Name und Befehlszeile → [{ pid, name, befehl }] oder null (PowerShell nicht verfügbar / zu langsam). Es gibt dort weder pgrep noch lsof; ein Arbeitsordner
// fremder Prozesse ist nicht abfragbar, nur die Befehlszeile. Auf macOS/Linux nicht gebraucht (dort pgrep/lsof) → null.
export function prozessListe({ plattform = process.platform, ausfuehren = execFileSync } = {}) {
  if (!istWindows(plattform)) return null;
  try {
    const aus = String(ausfuehren("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, $_.CommandLine }"],
      { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, maxBuffer: 32 * 1024 * 1024 }));
    return aus.split(/\r?\n/).map((z) => /^(\d+)\|([^|]*)\|(.*)$/.exec(z)).filter(Boolean).map((m) => ({ pid: Number(m[1]), name: m[2], befehl: m[3] }));
  } catch { return null; }
}
const vorwaerts = (s) => String(s).split("\\").join("/").toLowerCase();
// PIDs der Prozesse, deren Befehlszeile einen der Texte (Pfade, mit „\“ oder „/“) enthält; null = nicht prüfbar. Nur Windows (sonst null).
export function prozesseMitBefehlszeile(texte, o = {}) {
  const liste = prozessListe(o);
  if (!liste) return null;
  const t = texte.map(vorwaerts);
  return liste.filter((p) => t.some((x) => vorwaerts(p.befehl).includes(x))).map((p) => p.pid);
}
// Läuft ein git-Prozess in diesem Vault? macOS/Linux: lsof (Arbeitsordner aller git-Prozesse; `lsof` = Pfad des Programms oder null → „ja“, also vorsichtig).
// Windows: git.exe-Prozesse, deren Befehlszeile den Vault nennt (`git -C <Vault> …`); ein Prozess, der nur dort GESTARTET wurde, ist nicht zu sehen. PowerShell fehlt → „ja“.
export function gitLaeuftIn(wurzel, { plattform = process.platform, lsof = null, env = process.env, lauf = execFile, ausfuehren = execFileSync } = {}) {
  return new Promise((ok) => {
    if (istWindows(plattform)) {
      const liste = prozessListe({ plattform, ausfuehren });
      if (!liste) return ok(true);
      const w = vorwaerts(wurzel);
      return ok(liste.some((p) => /^git(\.exe)?$/i.test(p.name) && vorwaerts(p.befehl).includes(w)));
    }
    lauf(lsof || "/usr/sbin/lsof", ["-a", "-d", "cwd", "-c", "git", "-Fn"], { env, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err && err.code === "ENOENT") return ok(true);
      const orte = String(out || "").split("\n").filter((z) => z.startsWith("n")).map((z) => z.slice(1));
      ok(orte.some((o) => o === wurzel || o.startsWith(wurzel + "/")));
    });
  });
}

// Startzeit eines Prozesses (gegen PID-Wiederverwendung bei Sperren). Werkstatt und MCP-Server laufen mit verschiedenem LANG/LC_ALL/TZ, die Ausgabe von ps hängt davon ab —
// darum absoluter Pfad und feste Umgebung (C, UTC). Windows: PowerShell (ISO-Zeit in UTC). Leer = unbekannt.
export const PS_ENV = { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/bin:/usr/bin" };
// Unter Windows kostet jede Abfrage einen PowerShell-Start (oft 1–3 s; auf den CI-Runnern mehr). Darum merkt sich Kortex Treffer: die Startzeit des EIGENEN Prozesses ändert sich nie (für immer),
// die eines fremden gilt 10 s (die Sperre des Browser-Dienstes fragt beim Warten auf einen startenden Dienst wiederholt dieselbe PID). Leer (= unbekannt) wird nie gemerkt.
// Der Speicher gilt nur für das echte System (`ausfuehren` nicht ersetzt) oder wenn ihn der Aufrufer (Tests) mitgibt.
const FREMD_MS = 10_000;
const START_SPEICHER = new Map();
export function prozessStart(pid, { plattform = process.platform, ausfuehren = execFileSync, speicher = ausfuehren === execFileSync ? START_SPEICHER : null, jetzt = Date.now } = {}) {
  const schluessel = `${plattform}:${Number(pid)}`;
  const gemerkt = speicher?.get(schluessel);
  if (gemerkt && gemerkt.bis > jetzt()) return gemerkt.wert;
  const wert = frageProzessStart(pid, plattform, ausfuehren);
  if (speicher && wert) speicher.set(schluessel, { wert, bis: Number(pid) === process.pid ? Infinity : jetzt() + FREMD_MS });
  return wert;
}
function frageProzessStart(pid, plattform, ausfuehren) {
  if (istWindows(plattform)) {
    try {
      // .NET direkt statt `Get-Process` (lädt kein Cmdlet-Modul, spart beim Start)
      return String(ausfuehren("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `([System.Diagnostics.Process]::GetProcessById(${Number(pid)})).StartTime.ToUniversalTime().ToString('o')`],
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

// ───────────── Standardbrowser öffnen ─────────────
// Nur Adressen der eigenen Werkstatt (http://127.0.0.1:<port>/…) — nie etwas anderes, nie über eine Shell. macOS `open` · Windows `rundll32 url.dll,FileProtocolHandler`
// (kein `cmd /c start`: dort bräche ein `&` in der Adresse die Zeile) · Linux `xdg-open`, sonst `gio open`. KORTEX_BROWSER=<Programm> wählt einen bestimmten Browser (bekommt die Adresse als einziges Argument).
export const eigeneAdresse = (url) => /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/[\w\-./?=&%~]*$/.test(String(url));
// Oder die Startdatei `kortex-start-<kennung>.html` (absoluter Pfad): die Einlass-Karte steht dann nicht in der Befehlszeile (auf Linux für jeden Benutzer lesbar), sondern nur in dieser 0600-Datei.
export const istStartDatei = (p) => /^(\/|[A-Za-z]:[\\/])/.test(String(p)) && /(^|[\\/])kortex-start-[\w-]+\.html$/.test(String(p)) && !/[\0\r\n]/.test(String(p));
export function browserBefehle(url, { plattform = process.platform, env = process.env } = {}) {
  if (!eigeneAdresse(url) && !istStartDatei(url)) return [];
  const eigener = env.KORTEX_BROWSER;
  const liste = eigener && !/\.(cmd|bat)$/i.test(eigener) ? [[eigener, [url]]] : []; // .cmd/.bat startet Node ohne Shell nicht (EINVAL)
  if (istMac(plattform)) liste.push(["open", [url]]);
  else if (istWindows(plattform)) liste.push(["rundll32", ["url.dll,FileProtocolHandler", url]]);
  else liste.push(["xdg-open", [url]], ["gio", ["open", url]]);
  return liste;
}
// Öffnet `url` im Standardbrowser → { ok:true } | { ok:false, text }. `starte` ist einspritzbar (Tests); es liefert ein Prozessobjekt mit on("error"/"exit").
export async function oeffneImBrowser(url, { plattform = process.platform, env = process.env, starte = spawn, frist = 4000 } = {}) {
  const befehle = browserBefehle(url, { plattform, env });
  if (!befehle.length) return { ok: false, text: "Adresse nicht erlaubt" };
  let letzter = "kein Programm zum Öffnen gefunden";
  for (const [programm, argumente] of befehle) {
    const r = await new Promise((fertig) => {
      let kind;
      try { kind = starte(programm, argumente, { detached: true, stdio: "ignore", windowsHide: true }); } catch (e) { return fertig({ ok: false, text: String(e?.message || e) }); }
      const uhr = setTimeout(() => { try { kind.unref?.(); } catch { /* egal */ } fertig({ ok: true }); }, frist); // läuft weiter (Browser bleibt offen): als gestartet werten
      kind.on("error", (e) => { clearTimeout(uhr); fertig({ ok: false, text: e.code === "ENOENT" ? `${programm} nicht gefunden` : String(e.message) }); });
      kind.on("exit", (code) => { clearTimeout(uhr); try { kind.unref?.(); } catch { /* egal */ } fertig(code === 0 || code === null ? { ok: true } : { ok: false, text: `${programm} endete mit ${code}` }); });
    });
    if (r.ok) return r;
    letzter = r.text;
  }
  return { ok: false, text: letzter };
}
