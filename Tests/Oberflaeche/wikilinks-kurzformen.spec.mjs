// Wikilinks (Anlegen, Auflösung, Vervollständigung), Kurzformen (Board, Schnell merken), Info-Spalte nach dem Speichern, Kürzel-Hinweis, Zeitzonen —
// die Abläufe aus dem Funktions-Audit vom 2. 11. 2026 (K1, W2, W4, S1, S2) gegen die echte Werkstatt mit Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
const lese = (p) => readFileSync(join(vault, p), "utf8");
const feld = (p, k) => new RegExp(`^${k}: (.*)$`, "m").exec(lese(p))?.[1];
const schreib = (p, inhalt) => { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), inhalt); };

test.beforeEach(async () => {
  ({ vault } = baueVault());
  schreib("10_notizen/Ideen.md", "# Ideen\n\nNeu: [[Neue Idee]]\n");
  schreib("10_notizen/thema_so-funktioniert.md", "# So funktioniert dein Vault\n\nText.\n");
  schreib("10_notizen/Straße.md", "---\naliases: [Weg]\n---\n# Straße nach Rom\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function oeffne(page, pfad) {
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector(".cm-content .cm-line");
}
async function ansEnde(page) { await page.locator(".cm-content").click(); await page.keyboard.press("Meta+ArrowDown"); }

// ───────────────────────────── K1: Anlegen ─────────────────────────────

test("K1: [[Neue Idee]] → „Anlegen“ → der Link ist danach nicht mehr offen, ein weiterer Klick öffnet nur und legt nichts doppelt an", async ({ page }) => {
  await oeffne(page, "10_notizen/Ideen.md");
  const link = page.locator('.cm-wiki[data-ziel="Neue Idee"]');
  await expect(link).toHaveClass(/cm-wiki-fehlt/);
  await link.click();
  await expect(page.locator("#toast-host .toast")).toContainText("gibt es noch nicht");
  await page.locator("#toast-host .toast a", { hasText: "Anlegen" }).click();
  await expect(page.locator("#pfad")).toHaveAttribute("title", "10_notizen/neue-idee.md");
  expect(lese("10_notizen/neue-idee.md")).toBe("# Neue Idee\n");
  // zurück zur ersten Notiz: der Link ist aufgelöst (Titel, nicht Dateiname)
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette input:focus");
  await page.keyboard.type("Ideen");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pfad")).toHaveAttribute("title", "10_notizen/Ideen.md");
  await expect(page.locator('.cm-wiki[data-ziel="Neue Idee"]')).not.toHaveClass(/cm-wiki-fehlt/);
  // Klick öffnet die Notiz, ohne Hinweis „gibt es noch nicht“ und ohne zweite Datei
  await page.locator('.cm-wiki[data-ziel="Neue Idee"]').click();
  await expect(page.locator("#pfad")).toHaveAttribute("title", "10_notizen/neue-idee.md");
  await expect(page.locator("#toast-host .toast", { hasText: "gibt es noch nicht" })).toHaveCount(0);
  expect(readdirSync(join(vault, "10_notizen")).filter((n) => n.startsWith("neue-idee"))).toEqual(["neue-idee.md"]);
});

test("K1: eine Notiz mit anderem Dateinamen wird über Titel und Alias gefunden (Studio und Werkstatt lösen gleich auf)", async ({ page }) => {
  schreib("10_notizen/Links.md", "# Links\n\n[[So funktioniert dein Vault]] [[Straße nach Rom]] [[Strasse nach Rom]] [[Weg]] [[Gibt es nicht]]\n");
  await oeffne(page, "10_notizen/Links.md");
  const offen = await page.locator(".cm-wiki-fehlt").evaluateAll((l) => l.map((e) => e.getAttribute("data-ziel")));
  expect(offen).toEqual(["Gibt es nicht"]);
  // Rückverweise der Zielseite kommen aus derselben Auflösung der Werkstatt
  await page.locator('.cm-wiki[data-ziel="So funktioniert dein Vault"]').click();
  await expect(page.locator("#pfad")).toHaveAttribute("title", "10_notizen/thema_so-funktioniert.md");
  await expect(page.locator('[data-sektion="rueck"] [data-ziel="10_notizen/Links.md"]')).toBeVisible({ timeout: 5000 });
});

test("Anlegen eines Ziels, das es nach der Regel schon gibt: die Werkstatt öffnet es und legt nichts an", async ({ page }) => {
  await oeffne(page, "10_notizen/Ideen.md");
  // eine Fremdänderung legt die Zielseite an, das Studio weiß es (noch) nicht: der Link steht noch offen
  schreib("10_notizen/versteckt.md", "# Neue Idee\n\nvon außen\n");
  await page.locator('.cm-wiki[data-ziel="Neue Idee"]').click();
  await page.locator("#toast-host .toast a", { hasText: "Anlegen" }).click().catch(() => {}); // war der Index schon frisch, ist der Link zu und es gibt keinen Anlegen-Knopf
  await expect(page.locator("#pfad")).toHaveAttribute("title", "10_notizen/versteckt.md");
  expect(readdirSync(join(vault, "10_notizen")).filter((n) => n.startsWith("neue-idee"))).toEqual([]);
});

// ───────────────────────────── S3: Vervollständigung ─────────────────────────────

test("Vervollständigung: Titel statt Dateiname, mit Ordner als Detail, unscharf (Tippfehler), mit Tastatur", async ({ page }) => {
  await oeffne(page, "10_notizen/Ideen.md");
  await ansEnde(page);
  await page.keyboard.type("\n[[so funk");
  const liste = page.locator(".cm-tooltip-autocomplete");
  await expect(liste).toContainText("So funktioniert dein Vault");
  await expect(liste).toContainText("10_notizen");
  await expect(liste).not.toContainText("thema_so-funktioniert");
  await expect(page.locator('.cm-tooltip-autocomplete [aria-selected="true"]')).toContainText("So funktioniert dein Vault");
  await page.waitForTimeout(400); // CodeMirror ignoriert Enter kurz nach dem Öffnen
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("[[So funktioniert dein Vault]]");
  // Tippfehler und Alias
  await page.keyboard.type("\n[[strase");
  await expect(liste).toContainText("Straße nach Rom");
  await page.keyboard.press("Escape");
  await expect(liste).toHaveCount(0);
  await page.keyboard.type(" ");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("\n[[Weg");
  await expect(liste).toContainText("Weg → Straße nach Rom");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("[[Straße nach Rom]]");
  // die eingefügten Links sind aufgelöst
  await page.keyboard.press("Meta+s");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(page.locator('.cm-wiki[data-ziel="So funktioniert dein Vault"]')).not.toHaveClass(/cm-wiki-fehlt/);
});

test("Vervollständigung: ↑↓ wählen, Esc schließt", async ({ page }) => {
  await oeffne(page, "10_notizen/Ideen.md");
  await ansEnde(page);
  await page.keyboard.type("\n[[");
  const liste = page.locator(".cm-tooltip-autocomplete");
  await expect(liste.locator("[role=option]").nth(2)).toBeVisible();
  await page.waitForTimeout(400);
  const gewaehlt = () => liste.locator('[aria-selected="true"]').innerText();
  const erste = await gewaehlt();
  await page.keyboard.press("ArrowDown");
  expect(await gewaehlt()).not.toBe(erste);
  await page.keyboard.press("ArrowUp");
  expect(await gewaehlt()).toBe(erste);
  await page.keyboard.press("Escape");
  await expect(liste).toHaveCount(0);
});

// ───────────────────────────── W2: Kurzformen ─────────────────────────────

// Freitag, 30.10.2026, 13:00 Berlin — „morgen“ ist der 31.10.
const FEST = new Date("2026-10-30T12:00:00Z");

async function oeffneBoard(page) {
  await page.clock.setFixedTime(FEST);
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
}
const aufgabenDateien = () => (existsSync(join(vault, "05_aufgaben")) ? readdirSync(join(vault, "05_aufgaben")).filter((n) => n.endsWith(".md")).sort() : []);

test("W2 Board: „Steuererklärung abgeben morgen !hoch“ → Titel ohne Kurzformen, Fälligkeit und Priorität gesetzt; Chips zeigen es vorher", async ({ page }) => {
  await oeffneBoard(page);
  const eingabe = page.locator("[data-aufgabe-eingabe]");
  await eingabe.fill("Steuererklärung abgeben morgen !hoch");
  await expect(page.locator('[data-kurzformen] [data-kurz="prio"]')).toContainText("Priorität Hoch");
  await expect(page.locator('[data-kurzformen] [data-kurz="faellig"]')).toContainText("Fällig morgen");
  await page.keyboard.press("Enter");
  await expect(page.locator(".au-karte .au-titel", { hasText: "Steuererklärung abgeben" })).toBeVisible();
  await expect.poll(aufgabenDateien).toHaveLength(1);
  const p = "05_aufgaben/" + aufgabenDateien()[0];
  expect(feld(p, "titel")).toContain("Steuererklärung abgeben"); expect(feld(p, "titel")).not.toMatch(/morgen|!hoch/);
  expect(feld(p, "prioritaet")).toBe("hoch");
  expect(feld(p, "faellig")).toBe("2026-10-31");
  await expect(page.locator("[data-kurzformen]")).toBeHidden();
  await expect(page.locator(".au-karte .au-chip.faellig")).toContainText("Morgen");
});

test("W2 Board: „bis 2026-11-10“, @-Schreibweise und Zurücknehmen einer Erkennung per Chip", async ({ page }) => {
  await oeffneBoard(page);
  const eingabe = page.locator("[data-aufgabe-eingabe]");
  await eingabe.fill("Rechnung zahlen bis 2026-11-10");
  await page.keyboard.press("Enter");
  await expect.poll(aufgabenDateien).toHaveLength(1);
  let p = "05_aufgaben/" + aufgabenDateien()[0];
  expect(feld(p, "faellig")).toBe("2026-11-10"); expect(feld(p, "titel")).toContain("Rechnung zahlen");
  await eingabe.fill("Bericht morgen");
  await page.locator('[data-kurzformen] [data-kurz="faellig"]').click(); // „so nicht lesen“
  await expect(page.locator("[data-kurzformen]")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect.poll(aufgabenDateien).toHaveLength(2);
  const neu = aufgabenDateien().map((n) => "05_aufgaben/" + n).find((n) => feld(n, "titel").includes("Bericht"));
  expect(feld(neu, "titel")).toContain("Bericht morgen"); expect(feld(neu, "faellig")).toBeUndefined();
  // ohne Kurzform bleibt alles wie vorher
  await eingabe.fill("Blumen gießen");
  await expect(page.locator("[data-kurzformen]")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect.poll(aufgabenDateien).toHaveLength(3);
  p = "05_aufgaben/" + aufgabenDateien().find((n) => n.includes("blumen"));
  expect(feld(p, "prioritaet")).toBe("normal"); expect(feld(p, "faellig")).toBeUndefined();
});

test("W2 Schnell merken: als Aufgabe gelten die Kurzformen, als Notiz bleibt der Text unverändert", async ({ page }) => {
  await page.clock.setFixedTime(FEST);
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.keyboard.press("Meta+Shift+m");
  await page.fill('[data-feld="text"]', "Zahnarzt anrufen @freitag !niedrig");
  await expect(page.locator("[data-kurzformen]")).toBeHidden(); // als Notiz: keine Chips
  await page.locator('[data-feld="art"] [data-wert="aufgabe"]').click();
  await expect(page.locator('[data-kurzformen] [data-kurz="prio"]')).toContainText("Priorität Niedrig");
  await expect(page.locator('[data-kurzformen] [data-kurz="faellig"]')).toContainText("Fällig Fr., 06.11.");
  await page.click('[data-aktion="merken"]');
  await expect.poll(aufgabenDateien).toHaveLength(1);
  const p = "05_aufgaben/" + aufgabenDateien()[0];
  expect(feld(p, "titel")).toContain("Zahnarzt anrufen"); expect(feld(p, "titel")).not.toMatch(/@freitag|!niedrig/);
  expect(feld(p, "prioritaet")).toBe("niedrig"); expect(feld(p, "faellig")).toBe("2026-11-06");
  expect(readdirSync(join(vault, "00_inbox")).filter((n) => n.includes("zahnarzt"))).toEqual([]);
  // als Notiz
  await expect(page.locator('[data-feld="text"]')).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+m");
  await page.fill('[data-feld="text"]', "Ideen morgen !hoch");
  await page.click('[data-aktion="merken"]');
  await expect.poll(() => readdirSync(join(vault, "00_inbox")).filter((n) => n.includes("ideen-morgen"))).toHaveLength(1);
});

// ───────────────────────────── W4: Info-Spalte ─────────────────────────────

test("W4: die Info-Spalte zeigt nach dem Speichern die neuen Wörter und die neue Größe (nicht den Stand vom Öffnen)", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "an");
  const reihe = (name) => page.locator('[data-sektion="info"] .reihe', { has: page.locator(".k", { hasText: name }) }).locator(".w");
  const woerter = async () => Number((await reihe("Wörter").innerText()).replace(/\D/g, ""));
  await expect.poll(woerter).toBeGreaterThan(3);
  const vorher = await woerter();
  await ansEnde(page);
  const neu = Array.from({ length: 40 }, (_, i) => `wort${i}`).join(" ");
  await page.keyboard.type("\n\n" + neu);
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  const wirklich = lese("10_notizen/Reise nach Lissabon.md").split(/\s+/).filter(Boolean).length;
  expect(wirklich).toBeGreaterThanOrEqual(vorher + 40);
  await expect.poll(woerter, { timeout: 5000 }).toBe(wirklich);
  await expect(reihe("Größe")).toHaveText(`${Buffer.byteLength(lese("10_notizen/Reise nach Lissabon.md"))} B`);
});

test("W4: auch die Rückverweise-Spalte folgt dem Speichern (neu gesetzter Link)", async ({ page }) => {
  await oeffne(page, "10_notizen/thema_so-funktioniert.md");
  await expect(page.locator('[data-sektion="rueck"]')).toContainText("Keine");
  schreib("10_notizen/Zeiger.md", "# Zeiger\n\n[[So funktioniert dein Vault]]\n");
  await ansEnde(page);
  await page.keyboard.type("\nmehr Text");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  await expect(page.locator('[data-sektion="rueck"] [data-ziel="10_notizen/Zeiger.md"]')).toBeVisible({ timeout: 5000 });
});

// ───────────────────────────── S1: Kürzel-Hinweis ─────────────────────────────

test("S1: der Hinweis neben „Schnell erfassen“ zeigt das Kürzel aus dem Register (Standard ⌃⌥ Leertaste) und folgt Änderungen sofort", async ({ page }) => {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  const hinweis = page.locator("#fuss-merken .erfassen-taste");
  await expect(hinweis).toHaveText("⌃⌥ Leertaste");
  await expect(page.locator("#fuss-merken")).toHaveAttribute("title", /⌃⌥Leertaste/);
  await page.evaluate(async () => { const kz = await import("./tastenkuerzel.js"); await kz.schreibe({ werte: { "schnell-erfassen": "Ctrl+Alt+Shift+K" } }); });
  await expect(hinweis).toHaveText("⌃⌥⇧ K");
  await page.evaluate(async () => { const kz = await import("./tastenkuerzel.js"); await kz.schreibe({ werte: { "schnell-erfassen": null } }); });
  await expect(hinweis).toBeHidden();
  await page.evaluate(async () => { const kz = await import("./tastenkuerzel.js"); await kz.schreibe({ zurueck: ["schnell-erfassen"] }); });
  await expect(hinweis).toHaveText("⌃⌥ Leertaste");
  // nach dem Neuladen gilt die gespeicherte Belegung
  await page.evaluate(async () => { const kz = await import("./tastenkuerzel.js"); await kz.schreibe({ werte: { "schnell-erfassen": "Ctrl+Shift+Space" } }); });
  await page.reload();
  await expect(page.locator("#fuss-merken .erfassen-taste")).toHaveText("⌃⇧ Leertaste");
});

// ───────────────────────────── S2: Zeitzonen ─────────────────────────────

// 23:30 UTC am 30.10.2026: in Berlin schon der 31., in Los Angeles noch der 30., in Auckland schon der 31. (mittags)
const SPAET = new Date("2026-10-30T23:30:00Z");
for (const [zone, heute, morgen, ueberfaellig] of [["Europe/Berlin", "2026-10-31", "2026-11-01", true], ["America/Los_Angeles", "2026-10-30", "2026-10-31", false], ["Pacific/Auckland", "2026-10-31", "2026-11-01", true]]) {
  test.describe(`Zeitzone ${zone}`, () => {
    test.use({ timezoneId: zone });
    test(`S2 ${zone}: „morgen“ und „heute“ im Board und in der Karte rechnen in der Ortszeit des Macs`, async ({ page }) => {
      schreib("05_aufgaben/2026-10-20-gestern-faellig.md",
        "---\ntyp: aufgabe\ntitel: \"Gestern fällig\"\nstatus: offen\nprioritaet: normal\nfaellig: 2026-10-30\nrang: 1000\nerstellt: 2026-10-20T08:00:00Z\ngeaendert: 2026-10-20T08:00:00Z\nquelle: mensch\n---\n");
      await page.clock.setFixedTime(SPAET);
      await page.goto(server.url);
      await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
      await page.click('[data-bereich="aufgaben"]');
      await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
      // die Karte mit Fälligkeit „30.10.“: in Los Angeles heute, sonst überfällig
      const chip = page.locator(".au-karte", { hasText: "Gestern fällig" }).locator(".au-chip.faellig");
      if (ueberfaellig) await expect(chip).toHaveClass(/ueber/); else await expect(chip).toHaveClass(/heute/);
      await page.locator("[data-aufgabe-eingabe]").fill("Steuer morgen");
      await page.keyboard.press("Enter");
      await expect.poll(aufgabenDateien).toHaveLength(2);
      const neu = await expect.poll(() => aufgabenDateien().map((n) => "05_aufgaben/" + n).find((n) => (feld(n, "titel") ?? "").includes("Steuer"))).toBeTruthy().then(() => aufgabenDateien().map((n) => "05_aufgaben/" + n).find((n) => (feld(n, "titel") ?? "").includes("Steuer")));
      expect(feld(neu, "faellig")).toBe(morgen);
      await page.locator("[data-aufgabe-eingabe]").fill("Heute Müll rausbringen");
      await page.keyboard.press("Enter");
      await expect.poll(aufgabenDateien).toHaveLength(3);
      const m = await expect.poll(() => aufgabenDateien().map((n) => "05_aufgaben/" + n).find((n) => (feld(n, "titel") ?? "").includes("Müll"))).toBeTruthy().then(() => aufgabenDateien().map((n) => "05_aufgaben/" + n).find((n) => (feld(n, "titel") ?? "").includes("Müll")));
      expect(feld(m, "faellig")).toBe(heute);
    });
  });
}
