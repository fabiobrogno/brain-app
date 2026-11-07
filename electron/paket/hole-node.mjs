// electron/paket/hole-node.mjs — holt das offizielle Node (dieselbe Version wie die Mac-App: scripts/node-version.txt) für Windows und Linux, prüft die SHA-256 gegen SHASUMS256.txt
// von nodejs.org (wie scripts/hole-node.sh) und legt Programm + LICENSE + manifest.json unter electron/build/node/<system>-<arch>/ ab. Das Paket (extraResources) nimmt den Ordner mit.
//   node electron/paket/hole-node.mjs win-x64 | linux-x64 | linux-arm64
// manifest.json = { version, sha256 (des Programms), size } — dieselbe Form wie am Mac plus size; die Hülle prüft damit beim Start (laufzeit.mjs).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, "..", "..");
export const ZIELE = {
  "win-x64": { archiv: (v) => `node-${v}-win-x64.zip`, innen: (v) => `node-${v}-win-x64`, programm: "node.exe" },
  "linux-x64": { archiv: (v) => `node-${v}-linux-x64.tar.xz`, innen: (v) => `node-${v}-linux-x64`, programm: "bin/node" },
  "linux-arm64": { archiv: (v) => `node-${v}-linux-arm64.tar.xz`, innen: (v) => `node-${v}-linux-arm64`, programm: "bin/node" },
};

export const liesVersion = (datei = join(WURZEL, "scripts", "node-version.txt")) => {
  const v = readFileSync(datei, "utf8").trim();
  if (!/^v\d+\.\d+\.\d+$/.test(v)) throw new Error(`node-version.txt ungültig: ${v}`);
  return v;
};

/** Zeile „<sha256>  <name>“ aus SHASUMS256.txt → Prüfsumme oder null. */
export function suchePruefsumme(text, name) {
  for (const z of String(text).split("\n")) {
    const m = /^([0-9a-f]{64})\s+(\S+)$/.exec(z.trim());
    if (m && m[2] === name) return m[1];
  }
  return null;
}

export function sha256Datei(pfad) { return createHash("sha256").update(readFileSync(pfad)).digest("hex"); }

async function lade(url, ziel) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status}): ${url}`);
  writeFileSync(ziel, Buffer.from(await r.arrayBuffer()));
}

function entpacke(archiv, ziel, dateien) {
  // .tar.xz: tar (GNU oder bsd). .zip: unter Windows das bsdtar des Systems (Git Bash legt ein GNU-tar davor, das kein zip kann), sonst tar/unzip; Rückfall unter Windows: Expand-Archive
  const tar = process.platform === "win32" && archiv.endsWith(".zip") ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  let r = spawnSync(tar, ["-xf", archiv, "-C", ziel, ...dateien], { encoding: "utf8" });
  if (r.status !== 0 && archiv.endsWith(".zip")) r = spawnSync("unzip", ["-q", "-o", archiv, ...dateien, "-d", ziel], { encoding: "utf8" });
  if (r.status !== 0 && archiv.endsWith(".zip") && process.platform === "win32") r = spawnSync("powershell", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force", archiv, ziel], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Entpacken fehlgeschlagen: ${(r.stderr || r.error?.message || "").slice(0, 300)}`);
}

/** → Ordner mit Programm, LICENSE und manifest.json. Die Downloads liegen in `<basis>/cache`; die Prüfsumme wird bei jedem Lauf neu geprüft. */
export async function holeNode(ziel, { version = liesVersion(), basis = join(WURZEL, "electron", "build"), quelle = "https://nodejs.org/dist" } = {}) {
  const t = ZIELE[ziel];
  if (!t) throw new Error(`Unbekanntes Ziel „${ziel}“ (${Object.keys(ZIELE).join(", ")})`);
  const cache = join(basis, "cache");
  mkdirSync(cache, { recursive: true });
  const sums = join(cache, `SHASUMS256-${version}.txt`);
  if (!existsSync(sums)) await lade(`${quelle}/${version}/SHASUMS256.txt`, sums);
  const name = t.archiv(version);
  const archiv = join(cache, name);
  if (!existsSync(archiv)) await lade(`${quelle}/${version}/${name}`, archiv);
  const soll = suchePruefsumme(readFileSync(sums, "utf8"), name);
  if (!soll || soll !== sha256Datei(archiv)) { rmSync(archiv, { force: true }); throw new Error(`Prüfsumme stimmt nicht für ${name} — Download verworfen.`); }
  const tmp = mkdtempSync(join(tmpdir(), "kortex-node-"));
  try {
    const innen = t.innen(version);
    entpacke(archiv, tmp, [`${innen}/${t.programm}`, `${innen}/LICENSE`]);
    const out = join(basis, "node", ziel);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const exe = ziel.startsWith("win") ? "node.exe" : "node";
    copyFileSync(join(tmp, innen, t.programm), join(out, exe));
    copyFileSync(join(tmp, innen, "LICENSE"), join(out, "LICENSE"));
    if (!ziel.startsWith("win")) chmodSync(join(out, exe), 0o755);
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify({ version, sha256: sha256Datei(join(out, exe)), size: statSync(join(out, exe)).size })}\n`);
    return out;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  holeNode(process.argv[2] || "").then((o) => console.log(`Node bereit: ${o}`), (e) => { console.error(e.message); process.exit(1); });
}
