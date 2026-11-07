import { defineConfig } from "@playwright/test";
// Electron-Test (Paket W2a): eine App je Test, mit eigenem Temp-HOME und Support-Ordner (test/start.mjs); darum nacheinander, ohne Parallelität.
export default defineConfig({
  testDir: "test", testMatch: "*.spec.mjs", timeout: 60_000, workers: 1, reporter: "list",
  use: { trace: "retain-on-failure" },
});
