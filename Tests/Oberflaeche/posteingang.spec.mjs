// Posteingang sichten (FBL-68/71): Verwerfen, Später und „In Seite übernehmen“ direkt an der Karte — gegen das echte Backend, mit Git-Prüfung.
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const IDEE = "00_inbox/2026-10-20_lieferanten-idee.md", MEETING = "00_inbox/2026-10-22_notiz-meeting.md", GEDANKE = "00_inbox/2026-10-23_gedanke.md";
const karte = (page, pfad) => page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"]`);
const lese = (p) => readFileSync(join(vault, p), "utf8");
const letzteNachricht = () => git(vault, "log", "-1", "--format=%s").toString().trim();
const anzahlCommits = () => Number(git(vault, "rev-list", "--count", "HEAD").toString().trim());

async function start(page) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="inbox"]');
  await expect(karte(page, IDEE)).toBeVisible();
}
async function aktion(page, pfad, name) {
  const k = karte(page, pfad);
  await k.hover();
  await k.locator(`[data-aktion="${name}"]`).click();
}

test("Karten im Posteingang tragen Übernehmen, Später und Verwerfen; andere Bereiche nicht", async ({ page }) => {
  await start(page);
  const k = karte(page, MEETING);
  await k.hover();
  await expect(k.locator('[data-aktion="uebernehmen"]')).toBeVisible();
  await expect(k.locator('[data-aktion="spaeter"]')).toBeVisible();
  await expect(k.locator('[data-aktion="verwerfen"]')).toBeVisible();
  await page.click('[data-bereich="alle"]');
  await expect(page.locator('#liste-koerper [data-aktion="verwerfen"]')).toHaveCount(0);
});

test("Verwerfen: Karte weg, Zähler runter, Notiz bytegleich im Archiv, ein Commit, Meldung", async ({ page }) => {
  await start(page);
  const vorher = lese(MEETING), n0 = anzahlCommits();
  await aktion(page, MEETING, "verwerfen");
  await expect(karte(page, MEETING)).toHaveCount(0);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("2");
  await expect(page.locator(".toast").last()).toContainText("verworfen");
  expect(existsSync(join(vault, MEETING))).toBe(false);
  expect(lese("90_archiv/verworfen/2026-10-22_notiz-meeting.md")).toBe(vorher);
  expect(anzahlCommits()).toBe(n0 + 1);
  expect(letzteNachricht()).toBe("Posteingang: „Meeting-Notiz“ verworfen");
  expect(git(vault, "status", "--porcelain").toString().trim()).toBe("");
  await expect(page.locator('[data-bereich="archiv"] .zahl')).toHaveText("1");
});

test("Verwerfen der gerade geöffneten Notiz leert den Editor", async ({ page }) => {
  await start(page);
  await karte(page, GEDANKE).click();
  await expect(page.locator(".cm-content")).toContainText("loser Gedanke");
  await aktion(page, GEDANKE, "verwerfen");
  await expect(karte(page, GEDANKE)).toHaveCount(0);
  await expect(page.locator("#leer")).toBeVisible();
  await expect(page.locator("#editor")).toBeHidden();
  expect(existsSync(join(vault, "90_archiv/verworfen/2026-10-23_gedanke.md"))).toBe(true);
});

test("Später: Menü, Karte verschwindet bis zum Datum, Leiste „Zurückgestellt“, wieder zeigen; Kopf und Commits stimmen", async ({ page }) => {
  await start(page);
  const n0 = anzahlCommits();
  await aktion(page, IDEE, "spaeter");
  await page.locator('[data-menue="spaeter-3"]').click();
  await expect(karte(page, IDEE)).toHaveCount(0);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("2");
  expect(lese(IDEE)).toMatch(/^---\nspaeter_bis: \d{4}-\d{2}-\d{2}\n---\n# Lieferanten-Idee\n/);
  expect(anzahlCommits()).toBe(n0 + 1);
  expect(letzteNachricht()).toMatch(/^Posteingang: „Lieferanten-Idee“ zurückgestellt bis \d{4}-\d{2}-\d{2}$/);
  // die Leiste führt zu den zurückgestellten Karten
  const schalter = page.locator('[data-aktion="zurueckgestellt-umschalten"]');
  await expect(schalter).toHaveText("Zurückgestellt (1)");
  await schalter.click();
  await expect(karte(page, IDEE)).toBeVisible();
  await expect(karte(page, IDEE).locator("[data-spaeter]")).toContainText("Später");
  await expect(karte(page, MEETING)).toHaveCount(0);
  // wieder zeigen
  await aktion(page, IDEE, "spaeter");
  await page.locator('[data-menue="spaeter-weg"]').click();
  await expect(page.locator('[data-leer="zurueckgestellt"]')).toBeVisible();
  await page.locator('[data-aktion="zurueckgestellt-umschalten"]').click();
  await expect(karte(page, IDEE)).toBeVisible();
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("3");
  expect(lese(IDEE)).toBe("# Lieferanten-Idee\n\nNeue Kaffeemühle prüfen. Siehe [[Kaffee]].\n");
  expect(letzteNachricht()).toBe("Posteingang: „Lieferanten-Idee“ wieder im Posteingang");
});

test("In Seite übernehmen (bestehende Seite): Dialog, Suche, Abschnitt angehängt, Notiz im Archiv, ein Commit, „Seite öffnen“", async ({ page }) => {
  await start(page);
  const n0 = anzahlCommits(), alt = lese("09_wiki/wissen/Kaffee.md");
  await aktion(page, IDEE, "uebernehmen");
  const dlg = page.locator("#dialog-host .dialog");
  await expect(dlg).toContainText("in eine Seite übernehmen");
  await expect(dlg.locator('[data-aktion="uebernehmen-ok"]')).toBeDisabled();
  await dlg.locator('[data-feld="seitensuche"]').fill("kaffee");
  await expect(dlg.locator("[data-seite]")).not.toHaveCount(0);
  await dlg.locator('[data-seite="09_wiki/wissen/Kaffee.md"]').click();
  await expect(dlg.locator('[data-aktion="uebernehmen-ok"]')).toBeEnabled();
  await dlg.locator('[data-aktion="uebernehmen-ok"]').click();
  await expect(dlg).toHaveCount(0);
  await expect(karte(page, IDEE)).toHaveCount(0);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("2");
  const neu = lese("09_wiki/wissen/Kaffee.md");
  expect(neu.startsWith(alt.replace(/\n$/, ""))).toBe(true);
  expect(neu).toContain("## Lieferanten-Idee (aus dem Posteingang)");
  expect(neu).toContain("Neue Kaffeemühle prüfen. Siehe [[Kaffee]].");
  expect(existsSync(join(vault, "90_archiv/uebernommen/2026-10-20_lieferanten-idee.md"))).toBe(true);
  expect(anzahlCommits()).toBe(n0 + 1);
  expect(letzteNachricht()).toBe("Posteingang: „Lieferanten-Idee“ in „wissen/Kaffee“ übernommen");
  expect(git(vault, "status", "--porcelain").toString().trim()).toBe("");
  await page.locator(".toast a", { hasText: "Seite öffnen" }).click();
  await expect(page.locator(".cm-content")).toContainText("Lieferanten-Idee");
});

test("In Seite übernehmen (neue Seite): Titel und Bereich, Seite mit Kopf angelegt", async ({ page }) => {
  await start(page);
  await aktion(page, GEDANKE, "uebernehmen");
  const dlg = page.locator("#dialog-host .dialog");
  await dlg.locator('[data-modus="neu"]').click();
  await dlg.locator('[data-feld="neuTitel"]').fill("Loser Gedanke");
  await dlg.locator('[data-aktion="uebernehmen-ok"]').click();
  await expect(dlg).toHaveCount(0);
  const seite = "09_wiki/wissen/thema_loser-gedanke.md";
  expect(lese(seite)).toMatch(/^---\nname: loser-gedanke\ndescription: "Loser Gedanke"\ntyp: thema\nstand: \d{4}-\d{2}-\d{2}\nquellen: \["90_archiv\/uebernommen\/2026-10-23_gedanke\.md"\]\n---\n# Loser Gedanke\n\nEin loser Gedanke ohne Überschrift\.\n/);
  expect(letzteNachricht()).toBe("Posteingang: „2026-10-23_gedanke“ in „wissen/thema_loser-gedanke“ übernommen");
  await expect(karte(page, GEDANKE)).toHaveCount(0);
});

test("Fehler sind sichtbar: scheitert der Commit (Hook), bleibt alles wie vorher und die Meldung erscheint", async ({ page }) => {
  const hook = join(vault, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'PRUEFUNG sagt nein'\nexit 1\n"); chmodSync(hook, 0o755);
  server.stopp(); server = await starteServer(vault); // der Hook gehört zum Fingerabdruck des Vaults: erst danach wird Vertrauen erteilt
  await start(page);
  const vorher = lese(MEETING), kopf = git(vault, "rev-parse", "HEAD").toString();
  await aktion(page, MEETING, "verwerfen");
  await expect(page.locator(".toast.fehler")).toBeVisible();
  await expect(karte(page, MEETING)).toBeVisible();
  expect(lese(MEETING)).toBe(vorher);
  expect(existsSync(join(vault, "90_archiv"))).toBe(false);
  expect(git(vault, "rev-parse", "HEAD").toString()).toBe(kopf);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("3");
});
