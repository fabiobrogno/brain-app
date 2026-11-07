// windows-start.mjs — legt unter Windows den .exe-Starter für ein Node-Skript des Kerns an (git-sicher.mjs, git-gesperrt.mjs) und gibt dessen Pfad zurück.
// Warum ein Starter: Node startet unter Windows nur .exe-Dateien; eine .cmd ginge nur über cmd.exe (Argumente mit % ^ & | < > " werden dort umgedeutet — für die
// Schranke vor git inakzeptabel), siehe windows-start.cs. Der Starter wird beim ersten Gebrauch mit dem csc des .NET Framework übersetzt (liegt auf jedem Windows; das gilt
// auch im Browser-Modus und auf der Kommandozeile, nicht nur in der Electron-Hülle) und je Konfiguration (Name, Node, Skript) einmal neben seine .ini kopiert:
//   <Support>/git-sicher/start-<Kennung der Quelle>.exe             der übersetzte, geprüfte Starter (einmal)
//   <Support>/git-sicher/<name>-<Kennung>/<name>.exe + .exe.ini     Kopie mit Programm und Skript
// Die Kennung enthält Node- und Skriptpfad: zieht die App um (neue Kern-Kopie, neues Node), entsteht ein neuer Ordner, nie eine veraltete .ini; Ordner einer früheren
// Konfiguration desselben Namens (und frühere Starter-Übersetzungen) werden nach einem Tag aufgeräumt.
// Das Übersetzen ist gehärtet: csc läuft mit dem Support-Ordner als Arbeitsordner (nie dem Vault), ohne csc.rsp (/noconfig) und mit vollen Pfaden für die Bibliotheken
// (csc suchte sonst /r:System.dll zuerst im Arbeitsordner). Die Übersetzung geht in eine Temp-Datei; ein Probelauf OHNE .ini muss Exit 125 liefern, erst dann wird
// sie atomar umbenannt (gleichzeitige Erstübersetzungen stören sich nicht). Die .ini steht vor der .exe; die .exe wird zuletzt umbenannt (gibt es sie, ist alles da).
// Schlägt etwas fehl, wirft die Funktion — gitBefehl fängt das und liefert einen Pfad, den es nicht gibt (git startet dann nicht: fail-closed).
import { existsSync, mkdirSync, writeFileSync, copyFileSync, renameSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { KERN } from "./pfade.mjs";

const QUELLE = join(KERN, "windows-start.cs");
const EIN_TAG = 24 * 3600 * 1000;
const sha = (...teile) => createHash("sha256").update(teile.join("\0")).digest("hex");

export function cscPfad(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  for (const f of ["Framework64", "Framework"]) {
    const p = join(root, "Microsoft.NET", f, "v4.0.30319", "csc.exe");
    if (existsSync(p)) return p;
  }
  throw new Error("csc.exe (.NET Framework) nicht gefunden");
}
// Temp-Name neben dem Ziel; die Endung .exe bleibt (für den Probelauf)
const tmpName = (ziel) => {
  const z = `${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  return ziel.endsWith(".exe") ? `${ziel.slice(0, -4)}.${z}.exe` : `${ziel}.${z}`;
};
// Umbenennen; verliert man ein Rennen (Ziel schon da), ist das in Ordnung
function stelleBereit(von, nach) {
  try { renameSync(von, nach); } catch (e) { rmSync(von, { force: true }); if (!existsSync(nach)) throw e; }
}
// Aufräumen: Einträge in `basis`, die `passt` erfüllen, nicht `behalte` sind und länger als einen Tag nicht angefasst wurden. Ein laufender Starter lässt sich nicht löschen: der Fehler zählt nicht.
export function raeumeAuf(basis, passt, behalte) {
  let namen = []; try { namen = readdirSync(basis); } catch { return; }
  for (const n of namen) {
    if (n === behalte || !passt.test(n)) continue;
    const p = join(basis, n);
    try { if (Date.now() - statSync(p).mtimeMs > EIN_TAG) rmSync(p, { recursive: true, force: true }); } catch { /* in Gebrauch */ }
  }
}

export function uebersetzeStarter(basis, { env = process.env } = {}) {
  const name = `start-${sha(readFileSync(QUELLE)).slice(0, 16)}.exe`;
  const exe = join(basis, name);
  if (existsSync(exe)) return exe;
  mkdirSync(basis, { recursive: true });
  const csc = cscPfad(env), fw = dirname(csc);
  const roh = tmpName(exe);
  const r = spawnSync(csc, ["/nologo", "/noconfig", "/target:exe", `/r:${join(fw, "mscorlib.dll")}`, `/r:${join(fw, "System.dll")}`, `/out:${roh}`, QUELLE],
    { cwd: basis, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (r.status !== 0) { rmSync(roh, { force: true }); throw new Error(`Starter lässt sich nicht übersetzen: ${r.stdout}${r.stderr}`); }
  // Probelauf ohne .ini: ein Starter ohne Konfiguration startet nichts und endet mit 125. Alles andere wird verworfen.
  const probe = spawnSync(roh, [], { cwd: basis, encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (probe.status !== 125) { rmSync(roh, { force: true }); throw new Error(`Starter-Probelauf ohne .ini: Exit ${probe.status} statt 125`); }
  stelleBereit(roh, exe);
  raeumeAuf(basis, /^start-[0-9a-f]{16}\.exe$/, name);
  return exe;
}

// name: "git-sicher" / "git-gesperrt" (Skript <name>.mjs im Kern; `skript` nur für Tests mit eigenen Attrappen). → Pfad der .exe.
export function starterFuer(name, { support, node = process.execPath, skript = join(KERN, `${name}.mjs`) } = {}) {
  const basis = join(support, "git-sicher");
  const ini = [node, skript].join("\n") + "\n";
  const ordnerName = `${name}-${sha(name, node, skript).slice(0, 16)}`;
  const ordner = join(basis, ordnerName);
  const exe = join(ordner, `${name}.exe`);
  if (existsSync(exe) && existsSync(`${exe}.ini`)) return exe;
  const start = uebersetzeStarter(basis);
  mkdirSync(ordner, { recursive: true });
  const iniTmp = tmpName(`${exe}.ini`);
  writeFileSync(iniTmp, ini, "utf8");
  stelleBereit(iniTmp, `${exe}.ini`);
  const exeTmp = tmpName(exe);
  copyFileSync(start, exeTmp);
  stelleBereit(exeTmp, exe);
  raeumeAuf(basis, { test: (n) => n.startsWith(`${name}-`) && /^[0-9a-f]{16}$/.test(n.slice(name.length + 1)) }, ordnerName);
  return exe;
}
