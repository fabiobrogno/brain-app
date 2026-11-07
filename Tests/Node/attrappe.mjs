// Tests/Node/attrappe.mjs — Platzhalter-Programme (claude, codex, git, Starter …) und Plattform-Hilfen für Tests, die auf macOS, Linux UND Windows laufen
// (Plattform-Paket „Windows grün“, docs/plaene/plattformen-windows-linux.md Abschnitt 8).
//
// macOS/Linux: `legeProgramm(pfad, inhalt)` schreibt die Datei und macht sie ausführbar — genau wie vorher `writeFileSync` + `chmodSync(…, 0o755)`.
// Windows startet aus Node nur .exe-Dateien (kein `#!/bin/sh`, keine .cmd ohne Shell). Dort schreibt `legeProgramm` das Skript neben den Pfad (`<pfad>.sh` bzw.
// `<pfad>.cjs`) und kopiert einen kleinen Starter als `<pfad>.exe` daneben (attrappe-start.cs, einmal je Lauf mit dem csc des .NET Framework übersetzt); der Starter
// ruft sh.exe (Git for Windows) bzw. node.exe mit dem Skript auf. Die Programmsuche der App (absoluterPfad/findeProgramm) findet unter Windows `<name>.exe`.
// Die Attrappen halten ihre Schutzgeländer ein: sie schreiben nichts außerhalb des Temp-Ordners (das prüfen die Skripte selbst, wie bisher).
import { writeFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const WIN = process.platform === "win32";
const HIER = dirname(fileURLToPath(import.meta.url));

// `test(name, { skip: nurUnix("Grund") }, fn)`: unter Windows übersprungen (mit Grund in der Ausgabe), sonst läuft der Test.
export const nurUnix = (grund) => (WIN ? `nur macOS/Linux: ${grund}` : false);
// Dasselbe für Linux (nicht macOS und nicht Windows), z. B. wenn ein Programm fehlt.
export const nurMacTest = (grund) => (process.platform === "darwin" ? false : `nur macOS: ${grund}`);

// ───────────── Windows: sh.exe und PATH ─────────────
let shGemerkt;
export function shPfad() {
  if (!WIN) return "/bin/sh";
  if (shGemerkt !== undefined) return shGemerkt;
  const r = spawnSync("where", ["sh"], { encoding: "utf8", windowsHide: true });
  const zeilen = String(r.stdout || "").split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  // Git for Windows legt sh.exe in <Git>\bin und <Git>\usr\bin: beide gehen; usr\bin zuerst (dort liegen auch cat, dirname, sleep …)
  shGemerkt = zeilen.find((z) => /[\\/]usr[\\/]bin[\\/]sh\.exe$/i.test(z)) || zeilen[0] || null;
  return shGemerkt;
}
// Ordner mit den Hilfsprogrammen von sh (Git for Windows: <Git>\usr\bin), sonst ""
export function shHilfsordner() {
  const sh = shPfad();
  if (!WIN || !sh) return "";
  const kandidaten = [dirname(sh), join(dirname(dirname(sh)), "usr", "bin")];
  return kandidaten.find((d) => existsSync(join(d, "cat.exe"))) || "";
}
// Grundpfad für PATH-Umgebungen von Tests: macOS/Linux "/usr/bin:/bin" (wie bisher), Windows die System-Ordner und die Hilfsprogramme von sh.
export function systemPfad(unix = "/usr/bin:/bin") {
  if (!WIN) return unix;
  const root = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
  return [shHilfsordner(), join(root, "System32"), root, dirname(process.execPath)].filter(Boolean).join(delimiter);
}
// `bin` vor dem Systempfad: `${bin}:/usr/bin:/bin` heißt hier pfadMit(bin)
export const pfadMit = (...ordner) => [...ordner, systemPfad()].join(delimiter);

// ───────────── Starter übersetzen ─────────────
let starterGemerkt = null;
function starterExe() {
  if (starterGemerkt) return starterGemerkt;
  const quelle = join(HIER, "attrappe-start.cs");
  const kennung = createHash("sha256").update(readFileSync(quelle)).digest("hex").slice(0, 12);
  const ordner = join(tmpdir(), `kortex-attrappe-${kennung}`);
  const exe = join(ordner, "start.exe");
  if (!existsSync(exe)) {
    mkdirSync(ordner, { recursive: true });
    const csc = join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const roh = join(ordner, `start-${process.pid}.exe`);
    const r = spawnSync(csc, ["/nologo", "/target:exe", `/out:${roh}`, quelle], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) throw new Error(`Attrappen-Starter lässt sich nicht übersetzen (${csc}): ${r.stdout}${r.stderr}`);
    try { renameSync(roh, exe); } catch { /* ein anderer Testprozess war schneller */ }
  }
  starterGemerkt = exe;
  return exe;
}

// ───────────── Programm anlegen ─────────────
// `pfad` ohne Endung (…/bin/claude). `inhalt` beginnt mit "#!/bin/sh" (oder "#!<node>"). Gibt `pfad` zurück.
export function legeProgramm(pfad, inhalt) {
  if (!WIN) { writeFileSync(pfad, inhalt); chmodSync(pfad, 0o755); return pfad; }
  const sh = /^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba)?sh\b/.test(inhalt) || !/^#!/.test(inhalt);
  const skript = pfad + (sh ? ".sh" : ".cjs");
  writeFileSync(skript, inhalt);
  const exe = pfad + ".exe";
  copyFileSync(starterExe(), exe);
  const interpreter = sh ? shPfad() : process.execPath;
  if (!interpreter) throw new Error("sh.exe nicht gefunden (Git for Windows)");
  writeFileSync(exe + ".ini", [interpreter, sh ? shHilfsordner() : "", skript.split("\\").join("/")].join("\n") + "\n");
  return pfad;
}
// Pfad, unter dem ein Test das angelegte Programm ansprechen kann (Windows: die .exe).
export const programmPfad = (pfad) => (WIN ? pfad + ".exe" : pfad);

// Dateimodus (z. B. 0o600): Windows kennt ihn nicht (immer 0o666/0o444). `modus(pfad, erwartet)` liefert dort den erwarteten Wert zurück, sonst den echten.
export const modus = (pfad, erwartet) => (WIN ? erwartet : statSync(pfad).mode & 0o777);
