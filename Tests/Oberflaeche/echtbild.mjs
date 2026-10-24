// Screenshots mit einem echten Vault (Kopie!): node echtbild.mjs <vault> <ausgabe-ordner> [seite.md]
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumPfad } from "./browser.mjs";

const [vault, aus, seite] = process.argv.slice(2);
const HIER = dirname(fileURLToPath(import.meta.url));
const dienst = spawn(process.execPath, [join(HIER, "../../Ressourcen/werkstatt/entwicklung.mjs"), vault, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const url = await new Promise((ok) => dienst.stdout.on("data", (d) => { const m = String(d).match(/Bereit: (\S+)/); if (m) ok(m[1]); }));
const browser = await chromium.launch({ executablePath: chromiumPfad() });
try {
  for (const schema of ["light", "dark"]) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: schema, deviceScaleFactor: 2 });
    await p.goto(url);
    await p.waitForTimeout(1200);
    if (seite) {
      await p.keyboard.press("Meta+k");
      await p.waitForSelector(".palette input:focus");
      await p.keyboard.type(seite);
      await p.waitForTimeout(400);
      await p.keyboard.press("Enter");
      await p.waitForTimeout(1500);
    }
    await p.screenshot({ path: join(aus, `echt-${schema}.png`) });
    await p.close();
  }
} finally {
  await browser.close();
  dienst.kill();
}
