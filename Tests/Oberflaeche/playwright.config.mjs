import { defineConfig } from "@playwright/test";
import { chromiumPfad } from "./browser.mjs";
// Zeitzone der Tests: Berlin, eingespritzt (Browser UND Werkstatt, die der Test startet): die App rechnet überall in der Zeitzone des Macs, die CI-Runner laufen in UTC.
// Einzelne Tests setzen per test.use({ timezoneId }) und starteServer({ umgebung }) eine andere.
process.env.TZ = "Europe/Berlin";
export default defineConfig({
  testDir: ".", testMatch: "*.spec.mjs", timeout: 30000, workers: 1, reporter: "list",
  use: { timezoneId: "Europe/Berlin", trace: "retain-on-failure", launchOptions: { executablePath: chromiumPfad() }, viewport: { width: 1440, height: 900 } },
});
