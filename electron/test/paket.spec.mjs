// Rauchtest des GEBAUTEN Pakets (Paket W2c): die installierte oder entpackte App startet, die Werkstatt läuft mit dem MITGELIEFERTEN Node (nicht mit einem aus dem PATH, nicht mit Electron),
// und die MCP-Einträge zeigen auf stabile Pfade im Support-Ordner. Läuft nur, wenn der Job „paket“ KORTEX_PAKET_PROGRAMM setzt (Pfad der ausführbaren Datei der installierten App:
// Windows <LOCALAPPDATA>\Programs\Kortex\Kortex.exe, deb /opt/Kortex/kortex, AppImage squashfs-root/kortex). Jeder Start: eigenes Temp-HOME und Support-Ordner (test/start.mjs), kein PATH mit node.
import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { starteApp, baueUmgebung } from "./start.mjs";

const PROGRAMM = process.env.KORTEX_PAKET_PROGRAMM, PROGRAMM2 = process.env.KORTEX_PAKET_PROGRAMM2;
const WIN = process.platform === "win32";
const NODE_SOLL = readFileSync(new URL("../../scripts/node-version.txt", import.meta.url), "utf8").trim();
const EXE = WIN ? "node.exe" : "node";
test.skip(!PROGRAMM, "KORTEX_PAKET_PROGRAMM fehlt (nur der Job paket setzt es)");

// PATH ohne node: nur die Systemordner. Gäbe es dort ein node, bewiese der Test nichts.
// Ein AppImage selbst startet ohne FUSE (CI): es entpackt sich bei jedem Start in einen eigenen Ordner unter /tmp — genau der wechselnde Pfad, um den es geht
const mitArt = (programm, extra = {}) => ({ programm, extra: { PATH: pfadOhneNode(), ...(programm.endsWith(".AppImage") ? { APPIMAGE_EXTRACT_AND_RUN: "1" } : {}), ...extra } });
const pfadOhneNode = () => (WIN ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : "/usr/bin:/bin");
test.beforeAll(() => { if (!WIN) for (const p of ["/usr/bin/node", "/bin/node"]) if (existsSync(p)) throw new Error(`${p} existiert: der Test könnte ein Node aus dem PATH nicht von dem im Paket unterscheiden`); });

// Ausführbare Dateien bzw. Befehlszeilen der Kinder eines Prozesses
function kinder(pid) {
  if (WIN) {
    const skript = `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | ForEach-Object { $_.ExecutablePath }`;
    return execFileSync("powershell", ["-NoProfile", "-Command", skript], { encoding: "utf8" }).split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  }
  return execFileSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" }).split("\n")
    .map((z) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(z)).filter((m) => m && Number(m[2]) === pid).map((m) => m[3]);
}

let lauf;
test.afterEach(async () => { await lauf?.stopp(); lauf = null; });

const info = (fenster) => fenster.evaluate(() => fetch("/api/info").then((r) => r.json()));

test("Paket: die Werkstatt läuft mit dem mitgelieferten Node; MCP-Eintrag und Statuszeile zeigen auf stabile Pfade im Support-Ordner", async () => {
  lauf = await starteApp(mitArt(PROGRAMM));
  const { app, fenster, support } = lauf;
  expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true);
  const lz = await app.evaluate(() => globalThis.__kortex.laufzeit);
  expect(lz.node).toBe(join(support, "bin", EXE));
  expect(lz.programm).toBe(join(support, "node", NODE_SOLL, EXE));
  expect(lz.kern).toBe(join(support, "bin", "kern"));
  // das Node im Support-Ordner ist das mitgelieferte (Version) und läuft
  expect(execFileSync(lz.node, ["--version"], { encoding: "utf8" }).trim()).toBe(NODE_SOLL);
  // die Werkstatt ist ein Kind der App und läuft mit genau diesem Node
  const pid = await app.evaluate(() => process.pid);
  const gefunden = kinder(pid).filter((k) => k.toLowerCase().includes("werkstatt.mjs") || k.toLowerCase() === lz.programm.toLowerCase());
  expect(gefunden.length, `Kinder: ${kinder(pid).join(" | ")}`).toBeGreaterThan(0);
  expect(gefunden.some((k) => k.toLowerCase().startsWith(lz.programm.toLowerCase()))).toBe(true);
  // MCP-Eintrag: stabiles Node und stabiler Kern-Pfad — nichts im Paket (AppImage: wechselnder Einhängepunkt)
  const i = await info(fenster);
  expect(i.mcpBefehl).toBeTruthy();
  expect(i.mcpBefehl).toContain(lz.node);
  expect(i.mcpBefehl).toContain(join(support, "bin", "kern", "mcp", "brain-mcp.mjs"));
  expect(i.mcpBefehl).not.toContain(dirname(PROGRAMM));
  expect(existsSync(join(support, "bin", "kern", "mcp", "brain-mcp.mjs"))).toBe(true);
  expect(existsSync(join(support, "bin", "kern", "brain.mjs"))).toBe(true);
  // der Kern im Support-Ordner ist ein Verweis (Symlink/Junction) auf eine Versionskopie
  expect(lstatSync(join(support, "bin", "kern")).isSymbolicLink()).toBe(true);
  expect(realpathSync(join(support, "bin", "kern")).startsWith(realpathSync(join(support, "kern")))).toBe(true);
  // Paket-Inhalt: Updates sind eingerichtet (GitHub), Ressourcen ohne Entwürfe und Tests
  const res = join(dirname(PROGRAMM), "resources");
  expect(readFileSync(join(res, "app-update.yml"), "utf8")).toMatch(/provider: github/);
  for (const weg of ["icon-entwuerfe", "AppSymbole", "AppIcon.icns", "node.entitlements"]) expect(existsSync(join(res, "Ressourcen", weg)), weg).toBe(false);
  expect(existsSync(join(res, "Ressourcen", "kern", "mcp", "brain-mcp.mjs"))).toBe(true);
  // GitHub-Anmeldung: die Client-ID aus der Info.plist kommt in der Werkstatt an (Karte nicht „nicht verfügbar“)
  expect(await fenster.evaluate(() => fetch("/api/github/konto").then((r) => r.json()))).toMatchObject({ verfuegbar: true });
  // Menüeintrag „Nach Updates suchen …“ ist aktiv (installierte App), die Meldungen im Testlauf sammelt der Test statt Fenster zu zeigen
  expect(await app.evaluate(() => globalThis.__kortex.update.moeglich)).toBe(true);
});

test("Paket: der Pfad bleibt stabil, wenn die App von einem anderen Ort startet (AppImage hängt sich bei jedem Start woanders ein)", async () => {
  test.skip(!PROGRAMM2, "KORTEX_PAKET_PROGRAMM2 fehlt (zweite Kopie der App an anderem Ort)");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "kortex-paket-")));
  try {
    const befehle = [], ziele = [];
    for (const programm of [PROGRAMM, PROGRAMM2]) {
      lauf = await starteApp({ ...mitArt(programm), home });
      befehle.push((await info(lauf.fenster)).mcpBefehl);
      ziele.push(readlinkSync(join(lauf.support, "bin", "kern")));
      await lauf.stopp(); lauf = null;
    }
    expect(befehle[0]).toBeTruthy();
    expect(befehle[1]).toBe(befehle[0]);
    expect(ziele[1]).toBe(ziele[0]);
  } finally { rmSync(home, { recursive: true, force: true, maxRetries: 3 }); }
});

// Der echte Weg des Pakets für git: Kern-Kopie im Support-Ordner, das mitgelieferte Node, am Mac/Linux das Shell-Skript git-sicher, unter Windows der .exe-Starter (kern/windows-start.*)
// mit seiner .ini auf genau dieses Node und diese Kern-Kopie. Der Test startet git über den Pfad, den `gitBefehl` des installierten Kerns liefert (Umgebung wie in der Produktion: keine Testschalter).
test("Paket: der installierte Kern startet git über die Vertrauensschranke (Vault ansehen und committen; ohne Vertrauen gesperrt)", async () => {
  lauf = await starteApp(mitArt(PROGRAMM));
  const { app, home, support } = lauf;
  const lz = await app.evaluate(() => globalThis.__kortex.laufzeit);
  const env = baueUmgebung(home);
  delete env.BRAIN_TESTMODUS; delete env.KORTEX_VAULT_VERTRAUT; // Produktion: die Schranke gilt ohne Testschalter
  for (const k of ["ProgramFiles", "ProgramFiles(x86)"]) if (process.env[k]) env[k] = process.env[k];
  const vault = join(home, "git-vault"); mkdirSync(vault);
  const echt = (...a) => execFileSync("git", ["-C", vault, ...a], { env, encoding: "utf8", windowsHide: true });
  echt("init", "-q", "-b", "main"); writeFileSync(join(vault, "a.md"), "a\n"); echt("add", "--", "."); echt("commit", "-q", "-m", "Start");
  const wahl = (code) => execFileSync(lz.node, ["--input-type=module", "-e", `import { gitBefehl } from ${JSON.stringify(pathToFileURL(join(lz.kern, "werkzeug.mjs")).href)}; ${code}`], { env, encoding: "utf8", windowsHide: true });
  const sicher = wahl("process.stdout.write(gitBefehl({ ohneVault: true }));");
  const gesperrt = wahl("process.stdout.write(gitBefehl());");
  console.log(`GIT-SCHRANKE: sicher=${sicher} gesperrt=${gesperrt}`);
  if (WIN) {
    expect(sicher).toMatch(/git-sicher\.exe$/); expect(gesperrt).toMatch(/git-gesperrt\.exe$/);
    expect(sicher.toLowerCase().startsWith(join(support, "git-sicher").toLowerCase())).toBe(true);
    const ini = readFileSync(`${sicher}.ini`, "utf8").split(/\r?\n/);
    expect(ini[0].toLowerCase()).toBe(lz.node.toLowerCase()); // das mitgelieferte Node im Support-Ordner
    expect(ini[1].toLowerCase()).toBe(join(realpathSync(lz.kern), "git-sicher.mjs").toLowerCase()); // die Kern-Kopie im Support-Ordner
    expect(ini[1].toLowerCase().startsWith(realpathSync(join(support, "kern")).toLowerCase())).toBe(true);
  } else {
    expect(sicher).toMatch(/git-sicher$/); expect(gesperrt).toMatch(/git-gesperrt$/);
  }
  // echter Aufruf über die Schranke: lesen, schreiben, committen
  const lauf1 = (programm, args) => spawnSync(programm, ["-C", vault, ...args], { env, encoding: "utf8", windowsHide: true });
  const st = lauf1(sicher, ["status", "--porcelain"]); expect(st.status, st.stderr).toBe(0);
  writeFileSync(join(vault, "b.md"), "b\n");
  expect(lauf1(sicher, ["add", "--", "b.md"]).status).toBe(0);
  const c = lauf1(sicher, ["commit", "-q", "-m", "Über die Schranke"]); expect(c.status, c.stderr).toBe(0);
  const log = lauf1(sicher, ["log", "-1", "--format=%s"]); expect(log.stdout.trim()).toBe("Über die Schranke");
  console.log(`GIT-SCHRANKE: commit über ${sicher}: ${log.stdout.trim()}`);
  // ohne Vertrauen: gesperrt, es läuft kein git
  const g = lauf1(gesperrt, ["status"]); expect(g.status).toBe(126); expect(g.stderr).toMatch(/noch nicht als deiner bestätigt/);
  // eine Konfiguration, die ein Programm startet, wird auch im Paket verweigert
  echt("config", "core.fsmonitor", "echo x");
  const v = lauf1(sicher, ["status", "--porcelain"]); expect(v.status).toBe(126); expect(v.stderr).toMatch(/Erlaubnisliste/);
});
