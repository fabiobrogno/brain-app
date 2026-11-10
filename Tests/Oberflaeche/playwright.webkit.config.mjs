import { defineConfig } from "@playwright/test";
// WebKit = die Engine der Mac-App (WKWebView). Nur die Spezifikationen, deren Messungen engine-abhängig sind (Zeilenhöhen, Layout):
//   npx playwright test -c playwright.webkit.config.mjs        (einmalig: npx playwright install webkit)
process.env.TZ = "Europe/Berlin";
export default defineConfig({
  testDir: ".", testMatch: ["ruhe.spec.mjs"], timeout: 45000, workers: 1, reporter: "list",
  use: { browserName: "webkit", timezoneId: "Europe/Berlin", trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
});
