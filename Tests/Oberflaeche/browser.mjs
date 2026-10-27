// Nutzt einen schon vorhandenen Chromium aus dem Playwright-Cache (kein Download nötig).
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function chromiumPfad() {
  const wurzel = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(wurzel)) return undefined;
  const ordner = readdirSync(wurzel).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const o of ordner) {
    for (const arch of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
      const p = join(wurzel, o, arch, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
