// Screenshots (hell + dunkel, 1440x900 und 1100x720) nach screenshots/.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { chromiumPfad } from "./browser.mjs";
import { starteServer } from "./start.mjs";

mkdirSync("screenshots", { recursive: true });
const { vault } = baueVault();
writeFileSync(vault + "/00_inbox/ungesichert.md", "# Neu\n");
const s = await starteServer(vault);
const b = await chromium.launch({ executablePath: chromiumPfad() });
for (const [w, hh] of [[1440, 900], [1100, 720]]) for (const farbe of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: w, height: hh }, colorScheme: farbe, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") console.log("konsole:", m.text()); });
  p.on("pageerror", (e) => console.log("fehler:", e.message));
  await p.goto(s.url + "?pfad=" + encodeURIComponent("09_wiki/wissen/Kaffee.md"));
  await p.waitForSelector(".cm-content .cm-line");
  await p.waitForTimeout(900);
  await p.screenshot({ path: `screenshots/editor-${w}-${farbe}.png` });
  if (w === 1440) {
    await p.click('[data-bereich="wiki"]'); await p.waitForTimeout(300);
    await p.keyboard.press("Meta+k"); await p.waitForTimeout(300);
    await p.screenshot({ path: `screenshots/palette-${farbe}.png` });
    await p.keyboard.press("Escape");
    await p.click('[data-st="geaendert"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: `screenshots/commit-${farbe}.png` });
  }
  await ctx.close();
}
await b.close(); s.stopp();
