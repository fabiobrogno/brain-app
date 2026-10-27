import { defineConfig } from "@playwright/test";
import { chromiumPfad } from "./browser.mjs";
export default defineConfig({
  testDir: ".", testMatch: "*.spec.mjs", timeout: 30000, workers: 1, reporter: "list",
  use: { launchOptions: { executablePath: chromiumPfad() }, viewport: { width: 1440, height: 900 } },
});
