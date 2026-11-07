// electron/paket/pruefe-fuses.mjs — liest die Fuses einer gebauten Electron-Programmdatei und vergleicht sie mit der Soll-Variante (konfig.mjs: fusesFuer). Exit 1 bei jeder Abweichung.
//   node electron/paket/pruefe-fuses.mjs <Programmdatei> release|test
import fuses from "@electron/fuses"; // CommonJS
const { getCurrentFuseWire, FuseV1Options } = fuses;
const AN = 0x31; // "1" im Fuse-Draht (0x30 = aus)
import { fileURLToPath } from "node:url";
import { fusesFuer } from "./konfig.mjs";

const NAMEN = {
  runAsNode: FuseV1Options.RunAsNode,
  enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
  enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
  grantFileProtocolExtraPrivileges: FuseV1Options.GrantFileProtocolExtraPrivileges,
};

/** → Liste der Abweichungen (leer = stimmt). */
export async function pruefeFuses(programm, variante) {
  const ist = await getCurrentFuseWire(programm);
  const soll = fusesFuer(variante);
  const fehler = [];
  for (const [name, index] of Object.entries(NAMEN)) {
    const ein = ist[index] === AN;
    if (ein !== soll[name]) fehler.push(`${name}: ist ${ein ? "an" : "aus"}, soll ${soll[name] ? "an" : "aus"}`);
  }
  return fehler;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  pruefeFuses(process.argv[2], process.argv[3] || "release").then((f) => {
    if (f.length) { console.error(`Fuses weichen ab (${process.argv[3] || "release"}):\n  ${f.join("\n  ")}`); process.exit(1); }
    console.log(`Fuses ok (${process.argv[3] || "release"}): ${process.argv[2]}`);
  }, (e) => { console.error(e?.message || e); process.exit(1); });
}
