// Posteingang aus der Konfiguration (ordner.inbox) im Studio: Bereich „Posteingang“, maschinelle Unterordner (_vorschlaege …) und der Pfad oben folgen dem
// konfigurierten Ordner; ein ungültiger Eintrag fällt nicht still zurück, sondern zeigt einen Hinweis. Gegen das echte Backend mit Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let server;
test.afterEach(() => server?.stopp());
function schreibe(vault, rel, text) { mkdirSync(join(vault, rel, ".."), { recursive: true }); writeFileSync(join(vault, rel), text); }
async function aufbau(config) {
  const { vault } = baueVault();
  schreibe(vault, "brain.config.json", JSON.stringify(config));
  schreibe(vault, "Eingang/idee.md", "# Eine Idee\n\nText.\n");
  schreibe(vault, "Eingang/_vorschlaege/v1.md", "# Maschinell\n\nText.\n");
  git(vault, "add", "--", "."); git(vault, "commit", "-q", "-m", "Eingang");
  server = await starteServer(vault);
  return vault;
}

test("konfigurierter Posteingang „Eingang“: der Bereich zeigt dessen Notizen, _-Unterordner zählen als maschinell, der Pfad nennt „Posteingang“", async ({ page }) => {
  await aufbau({ ordner: { inbox: "Eingang" } });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator('#liste-koerper [data-karte][data-pfad="Eingang/idee.md"]')).toBeVisible();
  await expect(page.locator('#liste-koerper [data-karte][data-pfad="Eingang/_vorschlaege/v1.md"]')).toHaveCount(0);
  await page.locator('#liste-koerper [data-karte][data-pfad="Eingang/idee.md"]').click();
  await expect(page.locator("#pfad")).toContainText("Posteingang");
  await expect(page.locator(".toast.fehler")).toHaveCount(0);
  // eine Notiz im maschinellen Unterordner: der Pfad nennt ebenfalls den Posteingang (Bereich „maschine“)
  await page.goto(server.url + "?pfad=" + encodeURIComponent("Eingang/_vorschlaege/v1.md"));
  await expect(page.locator("#pfad")).toContainText("Posteingang");
});

test("ungültiger Posteingang in der Konfiguration: ein sichtbarer Hinweis statt stillem Zurückfallen", async ({ page }) => {
  await aufbau({ ordner: { inbox: ".versteckt" } });
  await page.goto(server.url);
  const hinweis = page.locator(".toast.fehler");
  await expect(hinweis).toContainText("ordner.inbox");
  await expect(hinweis).toContainText(".versteckt");
  await expect(hinweis).toContainText("00_inbox");
});
