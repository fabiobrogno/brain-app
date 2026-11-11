// R4-2 Härtung (Review): zugeklapptes Callout verliert nie unsichtbar Text, fehlende Sprach-Teile werden nur einmal angefragt,
// leere Titelzeile nimmt den Cursor nie vor das unsichtbare „#“, Kopier-Knopf und Falt-Pfeil sind per Tastatur bedienbar.
import { test, expect } from "./basis.mjs";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server, seitenfehler;
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
test.beforeEach(async () => { seitenfehler = []; ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

async function oeffne(page, pfad) {
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector(".cm-content .cm-line");
}
const imEditor = async (page, f, arg) => {
  const h = await page.evaluateHandle(async () => {
    const CM = await import("/vendor/codemirror.bundle.js");
    return { CM, view: CM.EditorView.findFromDOM(document.querySelector(".cm-editor")) };
  });
  try { return await h.evaluate(f, arg); } finally { await h.dispose(); }
};
const dok = (page) => imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length));
const setzeCursor = (page, text, versatz = 3) => imEditor(page, ({ view }, { text, versatz }) => {
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(text) + versatz } });
}, { text, versatz });

for (const taste of ["Delete", "Alt+Delete", "Meta+Delete"]) {
  test(`Zugeklapptes Callout: ${taste} am Kopfende löscht den versteckten Rumpf nicht (Datei bleibt gleich), das Callout klappt auf`, async ({ page }) => {
    const notiz = "# C\n\n> [!faq]- Zu\n> Geheim eins\n> Geheim zwei\n\nENDE\n";
    schreibe("10_notizen/del.md", notiz);
    await oeffne(page, "10_notizen/del.md");
    await expect(page.locator(".cm-callout-zu")).toHaveCount(1);
    await setzeCursor(page, "Zu", 2);
    await page.keyboard.press(taste);
    await page.waitForTimeout(1500);
    expect(await dok(page)).toBe(notiz);
    expect(readFileSync(join(vault, "10_notizen/del.md"), "utf8")).toBe(notiz);
    await expect(page.locator(".cm-line", { hasText: "Geheim zwei" })).toHaveCount(1);
  });
}

test("Zugeklapptes Callout: Tippen am Kopfende trifft den Rumpf nicht (bleibt zu)", async ({ page }) => {
  schreibe("10_notizen/del2.md", "# C\n\n> [!faq]- Zu\n> Geheim eins\n\nENDE\n");
  await oeffne(page, "10_notizen/del2.md");
  await setzeCursor(page, "Zu", 2);
  await page.keyboard.type("x");
  expect(await dok(page)).toBe("# C\n\n> [!faq]- Zux\n> Geheim eins\n\nENDE\n");
  await expect(page.locator(".cm-callout-zu")).toHaveCount(1);
});

test("Sprach-Teil lädt nicht: höchstens eine Anfrage je Teil, Block bleibt sichtbar", async ({ page }) => {
  const bund = readFileSync(join(process.cwd(), "../../Ressourcen/studio/vendor/codemirror.bundle.js"), "utf8");
  const fest = new Set([...bund.matchAll(/from\s*"\.\/(sprache-[^"]+\.js)"|import\s*"\.\/(sprache-[^"]+\.js)"/g)].map((m) => m[1] || m[2]));
  const anfragen = {};
  await page.route(/\/vendor\/sprache-[^/]+\.js$/, (route) => {
    const name = route.request().url().split("/").pop();
    if (fest.has(name)) return route.continue();
    anfragen[name] = (anfragen[name] || 0) + 1;
    return route.abort();
  });
  schreibe("10_notizen/spr.md", "```json\n{ \"a\": 1 }\n```\n\n```py\nx = 1\n```\n");
  await oeffne(page, "10_notizen/spr.md");
  await page.waitForTimeout(3000);
  await setzeCursor(page, "x = 1", 2);
  await page.keyboard.type("2");
  await page.waitForTimeout(1500);
  expect(Object.keys(anfragen).length).toBeGreaterThan(0);
  for (const [n, z] of Object.entries(anfragen)) expect(z, `Anfragen für ${n}`).toBeLessThanOrEqual(1);
  await expect(page.locator(".cm-codeblock").first()).toBeVisible();
});

test("Neue Notiz: Pos1, ⌘← und Pfeil links setzen den Cursor nie vor das unsichtbare „#“", async ({ page }) => {
  schreibe("10_notizen/start.md", "# Start\n");
  await oeffne(page, "10_notizen/start.md");
  for (const taste of ["Home", "Meta+ArrowLeft", "ArrowLeft"]) {
    await page.keyboard.press("Meta+n");
    await expect(page.locator(".cm-platzhalter")).toHaveText("Titel");
    await page.keyboard.press(taste);
    await page.keyboard.type("X");
    expect(await dok(page), taste).toBe("# X\n");
    await page.keyboard.press("Meta+z");
  }
});

test("Tastatur: Kopier-Knopf und Falt-Pfeil sind fokussierbar, bei Fokus sichtbar, Enter und Leertaste lösen aus", async ({ page }) => {
  const notiz = "```js\nconst a = 1;\n```\n\n> [!note]- Zu\n> Rumpf\n\nENDE\n";
  schreibe("10_notizen/tab.md", notiz);
  await oeffne(page, "10_notizen/tab.md");
  await page.evaluate(() => { window.__kopiert = []; navigator.clipboard.writeText = (t) => { window.__kopiert.push(t); return Promise.resolve(); }; });
  await setzeCursor(page, "ENDE", 1);
  const knopf = page.locator(".cm-code-kopieren");
  await knopf.focus();
  await expect(knopf).toBeFocused();
  await expect.poll(() => knopf.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.__kopiert)).toEqual(["const a = 1;", "const a = 1;"]);
  const pfeil = page.locator(".cm-callout-pfeil");
  await pfeil.focus();
  await expect(pfeil).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-line", { hasText: "Rumpf" })).toHaveCount(1);
  await expect(page.locator(".cm-callout-pfeil")).toHaveAttribute("aria-expanded", "true");
  expect(await dok(page)).toBe(notiz);
});
