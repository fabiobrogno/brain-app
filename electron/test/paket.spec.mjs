// Rauchtest des GEBAUTEN Pakets (Paket W2c): die installierte oder entpackte App startet, die Werkstatt läuft mit dem MITGELIEFERTEN Node (nicht mit einem aus dem PATH, nicht mit Electron),
// und die MCP-Einträge zeigen auf stabile Pfade im Support-Ordner. Läuft nur, wenn der Job „paket“ KORTEX_PAKET_PROGRAMM setzt (Pfad der ausführbaren Datei der installierten App:
// Windows <LOCALAPPDATA>\Programs\Kortex\Kortex.exe, deb /opt/Kortex/kortex, AppImage squashfs-root/kortex). Jeder Start: eigenes Temp-HOME und Support-Ordner (test/start.mjs), kein PATH mit node.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { starteApp } from "./start.mjs";

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
