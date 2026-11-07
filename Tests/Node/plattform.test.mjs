// Plattform-Schicht (W0): Support-Ordner, Prozessbaum, Gerätekennung, Startzeit, Credential-Helper, nurMac — alles mit eingespritzter Plattform, läuft auf jedem Runner gleich.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../../Ressourcen/gemeinsam/plattform.mjs";
import { supportOrte } from "../../Ressourcen/kern/pfade.mjs";

const WURZEL = join(fileURLToPath(import.meta.url), "..", "..", "..");

test("kern/plattform.mjs ist wortgleich mit gemeinsam/plattform.mjs", () => {
  const lies = (o) => readFileSync(join(WURZEL, "Ressourcen", o, "plattform.mjs"), "utf8");
  assert.equal(lies("kern"), lies("gemeinsam"));
});

test("Support-Ordner je System; gleiche Regel wie kern/pfade.mjs", () => {
  const e = {};
  assert.equal(P.supportOrdner({ home: "/h", env: e, plattform: "darwin" }), join("/h", "Library", "Application Support", "Kortex"));
  assert.equal(P.supportOrdner({ home: "/h", env: { APPDATA: "/a/Roaming" }, plattform: "win32" }), join("/a/Roaming", "Kortex"));
  assert.equal(P.supportOrdner({ home: "/h", env: { XDG_DATA_HOME: "/x" }, plattform: "linux" }), join("/x", "Kortex"));
  assert.equal(P.supportOrdner({ home: "/h", env: e, plattform: "linux" }), join("/h", ".local", "share", "Kortex"));
  assert.equal(P.supportOrdner({ home: "/h", env: { BRAIN_APP_SUPPORT: "/t" }, plattform: "linux" }), "/t");
  for (const plattform of ["darwin", "win32", "linux"]) {
    const o = { home: "/h", env: { APPDATA: "/a", XDG_DATA_HOME: "/x" }, plattform };
    assert.equal(P.supportOrdner(o), supportOrte(o)[0]);
  }
});

test("nurMac: auf anderen Systemen ein sauberes Ergebnis, am Mac läuft die Funktion", () => {
  let lief = false;
  for (const plattform of ["win32", "linux"]) {
    const r = P.nurMac("launchctl", () => { lief = true; }, { plattform });
    assert.equal(r.ok, false); assert.equal(r.nichtVerfuegbar, true); assert.match(r.text, /nicht verfügbar auf diesem System/);
  }
  assert.equal(lief, false);
  assert.deepEqual(P.nurMac("x", () => 7, { plattform: "darwin" }), { ok: true, wert: 7 });
});

test("beendeBaum: Windows ruft taskkill /T /F nur mit der eigenen PID, sonst Rückfall auf kind.kill", () => {
  const aufrufe = [];
  P.beendeBaum({ pid: 4242, kill() { aufrufe.push("kill"); } }, "SIGKILL", { plattform: "win32", lauf: (c, a) => { aufrufe.push([c, ...a]); return { status: 0 }; } });
  assert.deepEqual(aufrufe, [["taskkill", "/PID", "4242", "/T", "/F"]]);
  const fehl = [];
  P.beendeBaum({ pid: 4243, kill(s) { fehl.push(s); } }, "SIGTERM", { plattform: "win32", lauf: () => ({ status: 1 }) });
  assert.deepEqual(fehl, ["SIGTERM"]);
  P.beendeBaum(null); P.beendeBaum({});
});

test("geraeteKennung: macOS ioreg, Linux machine-id, Windows MachineGuid", () => {
  assert.equal(P.geraeteKennung({ plattform: "darwin", ausfuehren: () => '  "IOPlatformUUID" = "AB12-CD34"\n' }), "AB12-CD34");
  assert.equal(P.geraeteKennung({ plattform: "linux", lies: () => "abc123\n" }), "abc123");
  assert.equal(P.geraeteKennung({ plattform: "linux", lies: () => { throw new Error("fehlt"); } }), "");
  const reg = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    11111111-2222-3333-4444-555555555555\r\n";
  assert.equal(P.geraeteKennung({ plattform: "win32", ausfuehren: (c, a) => { assert.equal(c, "reg"); assert.ok(a.includes("MachineGuid")); return reg; } }), "11111111-2222-3333-4444-555555555555");
  assert.equal(P.geraeteKennung({ plattform: "win32", ausfuehren: () => { throw new Error("x"); } }), "");
});

test("prozessStart: ps mit fester Umgebung (C, UTC) bzw. PowerShell; Fehler = leer", () => {
  let env;
  assert.equal(P.prozessStart(7, { plattform: "linux", ausfuehren: (c, a, o) => { env = o.env; return "Thu Jan  1 00:00:00 1970\n"; } }), "Thu Jan  1 00:00:00 1970");
  assert.equal(env.LC_ALL, "C"); assert.equal(env.TZ, "UTC");
  assert.match(P.prozessStart(7, { plattform: "win32", ausfuehren: (c) => { assert.equal(c, "powershell.exe"); return "2026-01-01T00:00:00.0000000Z\r\n"; } }), /^2026-01-01T/);
  assert.equal(P.prozessStart(7, { plattform: "linux", ausfuehren: () => { throw new Error("x"); } }), "");
  // eigener Prozess: stabiler Wert über zwei Abfragen (leer, wo das System ihn nicht liefert)
  assert.equal(P.prozessStart(process.pid), P.prozessStart(process.pid));
});

test("credentialHelper je System", () => {
  assert.equal(P.credentialHelper({ plattform: "darwin" }), "osxkeychain");
  assert.equal(P.credentialHelper({ plattform: "win32" }), "manager");
  assert.equal(P.credentialHelper({ plattform: "linux", vorhanden: () => true }), "libsecret");
  assert.match(P.credentialHelper({ plattform: "linux", vorhanden: () => false }), /^cache/);
});

test("prozessStart: der eigene Prozess wird nur einmal erfragt, ein fremder höchstens alle 10 s; leer wird nie gemerkt (Windows: jede Abfrage ist ein PowerShell-Start)", () => {
  let aufrufe = 0, wert = "2026-01-01T00:00:00.0000000Z\r\n", t = 1000;
  const o = { plattform: "win32", ausfuehren: () => { aufrufe++; return wert; }, speicher: new Map(), jetzt: () => t };
  for (let i = 0; i < 5; i++) assert.match(P.prozessStart(process.pid, o), /^2026-01-01T/);
  assert.equal(aufrufe, 1, "eigener Prozess: einmal");
  for (let i = 0; i < 5; i++) P.prozessStart(4242, o);
  assert.equal(aufrufe, 2, "fremder Prozess: einmal innerhalb von 10 s");
  t += 11_000; P.prozessStart(4242, o);
  assert.equal(aufrufe, 3, "danach wieder fragen (PID kann wiederverwendet sein)");
  t += 20_000; P.prozessStart(process.pid, o);
  assert.equal(aufrufe, 3, "der eigene Wert gilt für immer");
  wert = ""; P.prozessStart(777, o); P.prozessStart(777, o);
  assert.equal(aufrufe, 5, "unbekannt (leer) wird nicht gemerkt");
  // mit ersetzter Abfrage und ohne Speicher (Tests) wird nie gemerkt
  let n = 0; for (let i = 0; i < 3; i++) P.prozessStart(9, { plattform: "linux", ausfuehren: () => { n++; return "x"; } });
  assert.equal(n, 3);
});

test("claudePfadform: Laufwerkspfade in der POSIX-Form von Claude Code (C:\\Users\\x -> /c/Users/x), alles andere bleibt; eigeneGruppe nur ohne Windows", () => {
  assert.equal(P.claudePfadform("C:\\Users\\Ada\\Vault"), "/c/Users/Ada/Vault");
  assert.equal(P.claudePfadform("d:/Daten/V"), "/d/Daten/V");
  assert.equal(P.claudePfadform("/Users/ada/Vault"), "/Users/ada/Vault");
  assert.equal(P.eigeneGruppe("win32"), false); assert.equal(P.eigeneGruppe("darwin"), true); assert.equal(P.eigeneGruppe("linux"), true);
});

test("schreibeAufBestehendes: überschreibt und kürzt eine vorhandene Datei, legt keine neue an", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const d = mkdtempSync(join(tmpdir(), "brain-sb-"));
  const p = join(d, "zeiger");
  writeFileSync(p, "lang lang lang lang\n");
  P.schreibeAufBestehendes(p, "kurz\n");
  assert.equal(readFileSync(p, "utf8"), "kurz\n");
  assert.throws(() => P.schreibeAufBestehendes(join(d, "gibt-es-nicht"), "x"), /ENOENT/);
  assert.equal(existsSync(join(d, "gibt-es-nicht")), false);
});
