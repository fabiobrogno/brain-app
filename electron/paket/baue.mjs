// electron/paket/baue.mjs — baut die installierbaren Pakete der Electron-Hülle (Paket W2c). Veröffentlicht NIE: electron-builder läuft mit `publish: never`, das Ergebnis liegt in electron/build/pakete/.
//   node electron/paket/baue.mjs win|linux [--arch x64|arm64] [--version <X.Y.Z[-beta.N]>] [--generic-url <http://127.0.0.1:PORT>] [--ausgabe <Name>] [--dir]
//   --version      Vorgabe: CFBundleShortVersionString aus Ressourcen/Info.plist (die EINE Quelle der Version), oder KORTEX_VERSION
//   --generic-url  nur für den Update-Test: die App fragt dort statt bei GitHub nach Updates (latest*.yml)
//   --ausgabe      Ordnername unter electron/build/ (Vorgabe: pakete); der Ordner wird vorher geleert
//   --dir          nur entpackter Ordner statt Installer (schneller Test)
// Schritte: Node holen (mit Prüfsumme) → Ressourcen zusammenstellen → electron-builder. Die Signatur ist aus (Betas unsigniert).
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, Platform, Arch } from "electron-builder";
import { appVersion } from "../info-plist.mjs";
import { holeNode } from "./hole-node.mjs";
import { stageRessourcen } from "./ressourcen.mjs";
import { baueKonfig } from "./konfig.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const ELECTRON = join(HIER, "..");
const WURZEL = join(ELECTRON, "..");

function liesArgumente(argv) {
  const o = { system: argv[0], arch: "x64", version: process.env.KORTEX_VERSION || null, genericUrl: null, ausgabe: "pakete", dir: false };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--arch") o.arch = argv[++i];
    else if (argv[i] === "--version") o.version = argv[++i];
    else if (argv[i] === "--generic-url") o.genericUrl = argv[++i];
    else if (argv[i] === "--ausgabe") o.ausgabe = argv[++i];
    else if (argv[i] === "--dir") o.dir = true;
    else throw new Error(`Unbekanntes Argument: ${argv[i]}`);
  }
  if (!["win", "linux"].includes(o.system)) throw new Error("Erstes Argument: win oder linux");
  if (!["x64", "arm64"].includes(o.arch)) throw new Error("--arch: x64 oder arm64");
  if (o.system === "win" && o.arch !== "x64") throw new Error("Windows: nur x64");
  return o;
}

export async function baue(argv) {
  const o = liesArgumente(argv);
  const version = o.version || appVersion(join(WURZEL, "Ressourcen", "Info.plist"));
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error(`Ungültige Version: ${version}`);
  const repo = (process.env.GITHUB_REPOSITORY || "fabiobrogno/brain-app").split("/");
  const basis = join(ELECTRON, "build");
  const ziel = `${o.system}-${o.arch}`;
  await holeNode(ziel, { basis });
  const ressourcen = stageRessourcen({ wurzel: WURZEL, ziel: join(basis, "ressourcen"), version });
  if (!/^[A-Za-z0-9._-]+$/.test(o.ausgabe)) throw new Error("--ausgabe: nur ein einfacher Ordnername");
  const ausgabe = join(basis, o.ausgabe);
  rmSync(ausgabe, { recursive: true, force: true });
  mkdirSync(ausgabe, { recursive: true });
  const konfig = baueKonfig({ version, owner: repo[0], repo: repo[1], genericUrl: o.genericUrl, ressourcen: "build/ressourcen", ausgabe });
  const plattform = o.system === "win" ? Platform.WINDOWS : Platform.LINUX;
  const arch = o.arch === "arm64" ? Arch.arm64 : Arch.x64;
  const ergebnis = await build({ projectDir: ELECTRON, targets: plattform.createTarget(o.dir ? ["dir"] : undefined, arch), config: konfig, publish: "never" });
  for (const d of ergebnis) console.log(`Paket: ${d}`);
  if (!existsSync(ausgabe)) throw new Error("Kein Ausgabeordner");
  return { version, ausgabe, dateien: ergebnis };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  baue(process.argv.slice(2)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
}
