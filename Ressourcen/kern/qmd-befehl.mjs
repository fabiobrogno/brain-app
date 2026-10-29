// qmd-befehl.mjs — Windows kennt keine Unix-Symlinks: node_modules/.bin/qmd.cmd lässt sich ohne
// shell:true nicht direkt per spawnSync starten (ENOENT/falscher Exit). Löst stattdessen über das
// @tobilu/qmd-Paket (liegt bei npms Windows-Layout im selben Ordner wie der .cmd-Shim) den echten
// JS-Entry auf und startet den mit `node <entry>`. Andere Plattformen: das private qmd der App (<Support-Ordner>/bin/qmd,
// `npm i -g --prefix <Support-Ordner>`; Lese-Rückfall: der alte Ort ~/.brain-kit) per absolutem Pfad — dieser Ordner steht in keinem
// PATH, den Claude Code/Hooks sehen —, sonst "qmd" (PATH/Symlink).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { homedir } from "node:os";
import { kitOrte } from "./pfade.mjs";

// Mindest-Arbeitsspeicher (GB, 10^9 Byte wie os.totalmem) für Suchprofil „voll“ — doctor und Installation warnen darunter.
export const VOLL_AB_GB = 15;

// Ort des privaten qmd (pfade.mjs#kitOrte: Support-Ordner der App, dann der alte Kit-Ort). npm legt bei --prefix den
// Starter unter Unix nach <prefix>/bin, unter Windows direkt nach <prefix> (qmd.cmd + node_modules daneben).
export function qmdPrivatBin(home = homedir()) {
  for (const ort of kitOrte({ home })) {
    const bin = join(ort, "bin", "qmd");
    if (existsSync(bin)) return bin;
  }
  return null;
}
const kitSuchpfad = (pfad, home) => [pfad, ...kitOrte({ home, plattform: "win32" })].join(";");

// Intern: PATH-Einträge (win32-Delimiter ";", unabhängig vom Host-Betriebssystem, damit das auch beim
// Testen auf macOS/Linux simulierbar ist) nach qmd.cmd absuchen und das @tobilu/qmd-Paketverzeichnis
// daneben zurückgeben.
function findePaketVerzeichnis(pfad) {
  for (const dir of String(pfad).split(";").filter(Boolean)) {
    if (!existsSync(join(dir, "qmd.cmd"))) continue;
    const paket = join(dir, "node_modules", "@tobilu", "qmd");
    if (existsSync(join(paket, "package.json"))) return paket;
  }
  return null;
}

// Der qmd-Starter (bin/qmd) startet sein eigentliches CLI über den Programmnamen „node“ — ohne node im PATH (frische
// Rechner mit privatem Node, Hooks/GUI-Apps mit Minimal-PATH) scheitert er. Darum laufen wir ihn mit dem
// laufenden Node und hängen dessen Ordner an den PATH an, den alle Kindprozesse erben.
function mitNode(entry) {
  const nodeDir = dirname(process.execPath);
  const teile = (process.env.PATH ?? "").split(delimiter);
  if (!teile.includes(nodeDir)) process.env.PATH = [...teile.filter(Boolean), nodeDir].join(delimiter);
  return { cmd: process.execPath, vorArgs: [entry] };
}

export function qmdBefehl(plattform = process.platform, pfad = process.env.PATH ?? "", home = homedir()) {
  if (plattform !== "win32") {
    const privat = qmdPrivatBin(home);
    if (!privat) return { cmd: "qmd", vorArgs: [] };
    try { return mitNode(realpathSync(privat)); } catch { return { cmd: privat, vorArgs: [] }; }
  }
  const paket = findePaketVerzeichnis(kitSuchpfad(pfad, home));
  if (!paket) return { cmd: "qmd", vorArgs: [] };
  try {
    const pkg = JSON.parse(readFileSync(join(paket, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.qmd;
    if (!bin) return { cmd: "qmd", vorArgs: [] };
    return mitNode(join(paket, bin));
  } catch { return { cmd: "qmd", vorArgs: [] }; }
}

// Der Aufruf, den ALLE Aufrufer nehmen (brain search/refresh, doctor, search-refresh): QMD_BIN (Tests) geht vor der Plattform-Auflösung. Endet es auf
// .mjs/.js, ist es ein Node-Skript und wird über process.execPath gestartet (Windows kann .cmd/.bat ohne shell:true nicht direkt spawnen, CVE-2024-27980) —
// sonst direkt, ohne vorArgs. Nie shell:true. Leer/ungesetzt → qmdBefehl(…). Die Tests setzen QMD_BIN auf den Fake (setup.mjs, plattform.sh): so ruft keine
// Suite je das echte qmd — dessen `embed` lädt mit frischem Test-HOME das Embedding-Modell (333 MB, Netz) herunter.
export function qmdAufruf(env = process.env, ...befehlArgs) {
  const bin = env?.QMD_BIN;
  if (!bin) return qmdBefehl(...befehlArgs);
  return /\.(mjs|js)$/.test(bin) ? { cmd: process.execPath, vorArgs: [bin] } : { cmd: bin, vorArgs: [] };
}

// Für modulPfad() in qmd-vector.mjs: dasselbe Paketverzeichnis, aber ohne den Bin-Umweg — dist/index.js
// liegt im Paket-Root, unabhängig vom bin-Feld. Nur auf win32 relevant (sonst reicht die PATH-Suche dort).
export function qmdPaketVerzeichnisWin32(pfad = process.env.PATH ?? "", home = homedir()) {
  return findePaketVerzeichnis(kitSuchpfad(pfad, home));
}
