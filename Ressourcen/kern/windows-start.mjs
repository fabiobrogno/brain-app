// windows-start.mjs — legt unter Windows den .exe-Starter für ein Node-Skript des Kerns an (git-sicher.mjs, git-gesperrt.mjs) und gibt dessen Pfad zurück.
// Warum ein Starter: Node startet unter Windows nur .exe-Dateien; eine .cmd ginge nur über cmd.exe (Argumente mit % ^ & | < > " werden dort umgedeutet — für die
// Schranke vor git inakzeptabel), siehe windows-start.cs. Der Starter wird beim ersten Gebrauch mit dem csc des .NET Framework übersetzt (liegt auf jedem Windows)
// und je Konfiguration (Programm, Skript, Name) einmal neben seine .ini kopiert:
//   <Support>/git-sicher/start-<Kennung der Quelle>.exe          der übersetzte Starter (einmal)
//   <Support>/git-sicher/<Kennung der Konfiguration>/<name>.exe  Kopie + <name>.exe.ini (Programm, Skript, Umgebung)
// Die Kennung der Konfiguration enthält Node-Pfad und Skriptpfad: zieht die App um oder wechselt das Node, entsteht ein neuer Ordner, nie eine veraltete .ini.
// Atomar: die .ini steht vor der .exe; die .exe wird zuletzt umbenannt (gibt es sie, ist alles da). Schlägt etwas fehl, wirft die Funktion — gitBefehl fängt das
// und liefert einen Pfad, den es nicht gibt (git startet dann nicht: fail-closed).
import { existsSync, mkdirSync, writeFileSync, copyFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { KERN } from "./pfade.mjs";

const QUELLE = join(KERN, "windows-start.cs");
const sha = (...teile) => createHash("sha256").update(teile.join("\0")).digest("hex");

function cscPfad(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  for (const f of ["Framework64", "Framework"]) {
    const p = join(root, "Microsoft.NET", f, "v4.0.30319", "csc.exe");
    if (existsSync(p)) return p;
  }
  throw new Error("csc.exe (.NET Framework) nicht gefunden");
}
const tmpName = (ziel) => `${ziel}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
// Umbenennen; verliert man ein Rennen (Ziel schon da), ist das in Ordnung
function stelleBereit(von, nach) {
  try { renameSync(von, nach); } catch (e) { rmSync(von, { force: true }); if (!existsSync(nach)) throw e; }
}

export function uebersetzeStarter(basis) {
  const exe = join(basis, `start-${sha(readFileSync(QUELLE)).slice(0, 16)}.exe`);
  if (existsSync(exe)) return exe;
  mkdirSync(basis, { recursive: true });
  const roh = tmpName(exe);
  const r = spawnSync(cscPfad(), ["/nologo", "/target:exe", `/out:${roh}`, QUELLE], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (r.status !== 0) { rmSync(roh, { force: true }); throw new Error(`Starter lässt sich nicht übersetzen: ${r.stdout}${r.stderr}`); }
  stelleBereit(roh, exe);
  return exe;
}

// name: "git-sicher" | "git-gesperrt" (Skript <name>.mjs im Kern; `skript` nur für Tests mit eigenen Attrappen). → Pfad der .exe.
export function starterFuer(name, { support, node = process.execPath, umgebung = process.versions.electron ? ["ELECTRON_RUN_AS_NODE=1"] : [], skript = join(KERN, `${name}.mjs`) } = {}) {
  const basis = join(support, "git-sicher");
  const ini = [node, skript, ...umgebung].join("\n") + "\n";
  const ordner = join(basis, sha(name, node, skript, ...umgebung).slice(0, 16));
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
  return exe;
}
