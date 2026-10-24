// Screenshots der v2-Oberfläche: node v2-bilder.mjs <vault> [ausgabe-ordner] [seite.md] [bereich]
// Hell + Dunkel, 1440×900 (Faktor 2). Fehlende v2-Routen des Backends werden mit Attrappen aus dem Ordner ergänzt.
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromiumPfad } from "./browser.mjs";
import { mockeV2 } from "./mocks.mjs";

const [vault, aus = "screenshots", seite, bereich] = process.argv.slice(2);
const HIER = dirname(fileURLToPath(import.meta.url));
mkdirSync(aus, { recursive: true });
const dienst = spawn(process.execPath, [join(process.env.BRAIN_WURZEL || join(HIER, "../.."), "Ressourcen/werkstatt/entwicklung.mjs"), vault, "0"], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, BRAIN_TESTMODUS: "1" } });
const url = await new Promise((ok) => dienst.stdout.on("data", (d) => { const m = String(d).match(/Bereit: (\S+)/); if (m) ok(m[1]); }));
const browser = await chromium.launch({ executablePath: chromiumPfad() });
const ruhe = (p, ms = 700) => p.waitForTimeout(ms);
try {
  for (const [schema, name] of [["light", "hell"], ["dark", "dunkel"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: schema, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("FEHLER:", e.message));
    p.on("console", (m) => { if (m.type() === "error") console.log("konsole:", m.text()); });
    await mockeV2(p, vault);
    await p.goto(url);
    await p.waitForSelector("[data-karte]", { timeout: 15000 }).catch(() => {});
    await ruhe(p, 1500);
    if (bereich) { await p.click(`[data-bereich="${bereich}"]`); await ruhe(p); }
    await p.screenshot({ path: join(aus, `v2-hauptfenster-${name}.png`) });
    if (seite) {
      await p.keyboard.press("Meta+k");
      await p.waitForSelector(".palette input:focus");
      await p.keyboard.type(seite);
      await ruhe(p, 400);
      await p.keyboard.press("Enter");
      await ruhe(p, 1800);
      await p.screenshot({ path: join(aus, `v2-notiz-${name}.png`) });
    }
    await p.click('[data-st="verlauf"]').catch(() => {});
    await ruhe(p, 1500);
    await p.screenshot({ path: join(aus, `v2-verlauf-modus-${name}.png`) });
    await ctx.close();
  }
} finally {
  await browser.close();
  dienst.kill();
}
