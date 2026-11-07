// electron/paket/ressourcen.mjs — stellt aus Ressourcen/ den Ordner zusammen, der als `<resources>/Ressourcen` ins Paket kommt: alles, was die Werkstatt, der Kern, das Studio und der
// MCP-Server brauchen; ohne Entwürfe (icon-entwuerfe), Mac-Symbole (AppIcon.icns, AppSymbole), Mac-Rechte (node.entitlements) und Tests (es gibt keine unter Ressourcen/; der Test prüft das).
// Wie scripts/baue-app.sh: der MCP-Server samt gemeinsamem Code kommt zusätzlich in den Kern (kern/mcp, kern/gemeinsam; die MCP-Einträge zeigen auf den stabilen Pfad <support>/bin/kern),
// kern/VERSION = App-Version, dazu die Lizenzhinweise. kern/.stempel = SHA-256 über alle Kerndateien (die Hülle erkennt daran, ob ihre Kopie im Support-Ordner aktuell ist).
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const AUSGELASSEN = new Set(["icon-entwuerfe", "AppSymbole", "AppIcon.icns", "node.entitlements"]);

/** SHA-256 über Pfade und Inhalte aller Dateien unter `ordner` (sortiert, ohne `.stempel`). */
export function stempelVon(ordner) {
  const h = createHash("sha256");
  const gehe = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) gehe(p);
      else if (n !== ".stempel") h.update(relative(ordner, p).split(sep).join("/")).update("\0").update(readFileSync(p)).update("\0");
    }
  };
  gehe(ordner);
  return h.digest("hex");
}

export function stageRessourcen({ wurzel, ziel, version, fuses = "release" }) {
  const quelle = join(wurzel, "Ressourcen");
  if (!existsSync(join(quelle, "werkstatt", "werkstatt.mjs"))) throw new Error("Ressourcen/werkstatt/werkstatt.mjs fehlt");
  rmSync(ziel, { recursive: true, force: true });
  mkdirSync(ziel, { recursive: true });
  for (const n of readdirSync(quelle)) {
    if (AUSGELASSEN.has(n)) continue;
    cpSync(join(quelle, n), join(ziel, n), { recursive: true });
  }
  // Die Info.plist ist im Paket die Quelle für Version (Werkstatt: appVersionLesen) und GitHub-Client-ID; die Version ist die des Pakets (bei Test-Builds nicht die der Mac-App)
  const plist = join(ziel, "Info.plist");
  writeFileSync(plist, readFileSync(plist, "utf8").replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${version}$2`));
  for (const f of ["THIRD-PARTY-NOTICES.md", "LICENSE"]) if (!existsSync(join(wurzel, f))) throw new Error(`${f} fehlt — ohne Lizenzhinweise darf kein Paket entstehen`);
  copyFileSync(join(wurzel, "THIRD-PARTY-NOTICES.md"), join(ziel, "THIRD-PARTY-NOTICES.md"));
  copyFileSync(join(wurzel, "THIRD-PARTY-NOTICES.md"), join(ziel, "studio", "THIRD-PARTY-NOTICES.md"));
  copyFileSync(join(wurzel, "LICENSE"), join(ziel, "LICENSE"));
  // Welche Fuse-Variante das Paket ist: die Hülle beendet sich im Paket bei --inspect/--remote-debugging-port, außer in der Test-Variante
  writeFileSync(join(ziel, "paket.json"), `${JSON.stringify({ fuses })}\n`);
  const kern = join(ziel, "kern");
  if (!existsSync(join(kern, "brain.mjs"))) throw new Error("Ressourcen/kern/brain.mjs fehlt");
  rmSync(join(kern, "mcp"), { recursive: true, force: true });
  rmSync(join(kern, "gemeinsam"), { recursive: true, force: true });
  cpSync(join(quelle, "mcp"), join(kern, "mcp"), { recursive: true });
  cpSync(join(quelle, "gemeinsam"), join(kern, "gemeinsam"), { recursive: true });
  writeFileSync(join(kern, "VERSION"), `${version}\n`);
  writeFileSync(join(kern, ".stempel"), `${stempelVon(kern)}\n`);
  return ziel;
}
