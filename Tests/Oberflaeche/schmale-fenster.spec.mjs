// R4-7 „Schmale Fenster und Split View“: bei 1440/1024/820/720/600 px (hell + dunkel) ragt nichts über den Rand, es gibt kein horizontales Scrollen, die Hauptflächen sind
// erreichbar, und beim Ziehen des Fensters wechseln die Stufen ohne Sprung. UI_SHOTS=<Ordner> legt Fotos ab (r47-*.png).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const BREITEN = [1440, 1024, 820, 720, 600];
const shots = () => { const d = process.env.UI_SHOTS || "screenshots"; mkdirSync(d, { recursive: true }); return d; };
const foto = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: join(shots(), `r47-${name}.png`) }); };
async function start(page, { breite, hoehe = 800, dunkel = false } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  await page.emulateMedia({ colorScheme: dunkel ? "dark" : "light" });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
  await page.waitForTimeout(150);
}
/** Misst, was über den Rand ragt: Elemente, deren sichtbarer Rahmen (nach Abzug abgeschnittener Vorfahren) weiter als die Fensterbreite reicht, Behälter, deren Inhalt breiter ist als sie selbst,
 *  überlappende Teile der Kopfzeile und waagerechtes Scrollen. */
const messe = (page) => page.evaluate(() => {
  const vw = window.innerWidth, ragt = [];
  const klammer = (el) => { // rechte Kante, bis zu der ein Vorfahr das Element abschneidet
    let grenze = Infinity;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== "visible" || s.contain.includes("paint") || s.overflow === "clip") grenze = Math.min(grenze, p.getBoundingClientRect().right);
    }
    return grenze;
  };
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden" || el.closest("[hidden]")) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > vw + 1 && klammer(el) > vw + 1) ragt.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + [...el.classList].join(".")) + ` r=${Math.round(r.right)}`);
  }
  const d = document.documentElement;
  const breiter = [];
  for (const id of ["kopf", "status", "haupt", "liste", "seite", "info"]) {
    const e = document.getElementById(id); if (!e || e.clientWidth < 3 || getComputedStyle(e).display === "none") continue;
    if (e.scrollWidth > e.clientWidth + 1) breiter.push(`${id} ${e.scrollWidth}>${e.clientWidth}`);
  }
  const teile = ["#kopf .kopf-links", "#kopf-suche", "#kopf .kopf-rechts"].map((q) => document.querySelector(q)?.getBoundingClientRect()).filter(Boolean);
  const ueberlappt = teile.some((a, i) => teile.slice(i + 1).some((b) => a.right > b.left + 1));
  return { ragt: ragt.slice(0, 12), breiter, ueberlappt, scroll: Math.max(d.scrollWidth, document.body.scrollWidth) - vw, sx: window.scrollX };
});
const ok = (m) => { expect(m.ragt, "ragt über den Rand").toEqual([]); expect(m.breiter, "Behälter läuft über").toEqual([]); expect(m.ueberlappt, "Kopfzeile überlappt").toBe(false); expect(m.scroll).toBeLessThanOrEqual(0); expect(m.sx).toBe(0); };
const attr = (page, n) => page.evaluate((n) => document.getElementById("app").dataset[n] ?? "", n);
const box = (page, sel) => page.locator(sel).first().boundingBox();
const imFenster = async (page, sel, breite) => { const b = await box(page, sel); expect(b, sel).not.toBeNull(); expect(b.x, sel).toBeGreaterThanOrEqual(-0.5); expect(b.x + b.width, sel).toBeLessThanOrEqual(breite + 0.5); return b; };
async function oeffneNotiz(page) {
  await page.locator("#liste-koerper .karte").first().click();
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await page.waitForTimeout(150);
}

const FLAECHEN = {
  liste: async () => {},
  editor: async (page) => { await oeffneNotiz(page); },
  posteingang: async (page) => { await page.keyboard.press("Meta+1"); await page.waitForTimeout(300); },
  aufgaben: async (page) => { await page.keyboard.press("Meta+4"); await page.waitForSelector(".au", { timeout: 8000 }); },
  frag: async (page) => { await oeffneNotiz(page); await page.keyboard.press("Meta+j"); await page.waitForSelector('[data-frage="panel"]'); },
  einstellungen: async (page) => { await page.keyboard.press("Meta+,"); await page.waitForTimeout(500); },
};
for (const dunkel of [false, true]) for (const breite of BREITEN) for (const [name, oeffne] of Object.entries(FLAECHEN)) {
  test(`${name} bei ${breite} px ${dunkel ? "dunkel" : "hell"}: nichts ragt über den Rand, kein waagerechtes Scrollen`, async ({ page }) => {
    await start(page, { breite, dunkel });
    await oeffne(page);
    await page.waitForTimeout(300);
    const m = await messe(page);
    await foto(page, `${name}-${breite}${dunkel ? "-dunkel" : ""}`);
    ok(m);
    if (name === "editor") { const e = await imFenster(page, "#editor", breite); expect(e.width).toBeGreaterThanOrEqual(420); }
  });
}

// ---------- Stufen ----------
const tabbar = (page, sel) => page.evaluate((sel) => { const w = document.querySelector(sel); return !!w && !w.closest("[inert]") && getComputedStyle(w).visibility !== "hidden" && w.getClientRects().length > 0; }, sel);

for (const breite of [820, 720, 600]) {
  test(`Seitenleiste bei ${breite} px: eingeklappt, Knopf und ⌃⌘S legen sie als Überlagerung darüber; Esc, Klick daneben und ein Ziel schließen sie; Fokus kehrt zurück`, async ({ page }) => {
    await start(page, { breite });
    expect(await attr(page, "seite")).toBe("aus");
    expect(await tabbar(page, "#seite")).toBe(false); // nicht per Tab erreichbar
    const listeVorher = await box(page, "#liste");
    await page.locator("#knopf-seite").click();
    await expect(page.locator("#app")).toHaveAttribute("data-seite", "schwebt");
    await page.waitForTimeout(350);
    const s = await imFenster(page, "#seite", breite);
    expect(s.width).toBeGreaterThanOrEqual(199);
    expect((await box(page, "#liste")).width).toBeCloseTo(listeVorher.width, 0); // die Liste springt nicht
    ok(await messe(page));
    await foto(page, `seite-ueber-${breite}`);
    expect(await page.evaluate(() => !!document.activeElement?.closest("#seite"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("knopf-seite");
    // Tastatur: ⌃⌘S öffnet, Klick auf die Fläche daneben schließt
    await page.keyboard.press("Control+Meta+s");
    await expect(page.locator("#app")).toHaveAttribute("data-seite", "schwebt");
    await page.mouse.click(breite - 8, 400);
    await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
    // ein Ziel schließt sie und wirkt
    await page.keyboard.press("Control+Meta+s");
    await page.locator("#seite .eintrag", { hasText: "Aufgaben" }).first().click();
    await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
    await expect(page.locator("#app")).toHaveAttribute("data-modus", "aufgaben");
  });
}

test("Seitenleiste: 1440 → schmal → breit; die Überlagerung schließt beim Aufweiten, die Spalte steht wieder in der Reihe", async ({ page }) => {
  await start(page, { breite: 1440 });
  expect(await attr(page, "seite")).toBe("an");
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
  await page.keyboard.press("Control+Meta+s");
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "schwebt");
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "an");
  expect((await box(page, "#seite")).width).toBeGreaterThan(190);
});

for (const breite of [1024, 820, 720]) {
  test(`Eigenschaften bei ${breite} px: eingeklappt, der Knopf öffnet sie als Überlagerung rechts (Editor wird nicht gequetscht), Esc schließt`, async ({ page }) => {
    await start(page, { breite });
    await oeffneNotiz(page);
    expect(await attr(page, "info")).toBe("aus");
    const vorher = await box(page, "#editor");
    await page.locator("#knopf-info").click();
    await expect(page.locator("#app")).toHaveAttribute("data-info", "an");
    await expect(page.locator("#app")).toHaveAttribute("data-info-ueber", "ja");
    await page.waitForTimeout(350);
    const i = await imFenster(page, "#info", breite);
    expect(i.width).toBeGreaterThanOrEqual(240);
    const nachher = await box(page, "#editor");
    expect(Math.round(nachher.width)).toBe(Math.round(vorher.width)); expect(Math.round(nachher.x)).toBe(Math.round(vorher.x));
    await imFenster(page, "#knopf-info", breite);
    ok(await messe(page));
    await foto(page, `info-ueber-${breite}`);
    await page.keyboard.press("Escape");
    await expect(page.locator("#app")).toHaveAttribute("data-info", "aus");
  });
}

test("Wechsel bei 600 px: Liste → Notiz öffnen zeigt den Editor allein, „Notizen“ bringt die Liste zurück; Pfeiltasten in der Liste bleiben in der Liste", async ({ page }) => {
  await start(page, { breite: 600 });
  expect(await attr(page, "wechsel")).toBe("liste");
  await expect(page.locator("#knopf-liste")).toBeHidden();
  await page.locator("#liste-koerper").focus();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  expect(await attr(page, "wechsel")).toBe("liste"); // Auswählen mit den Pfeilen öffnet den Editor nicht
  await page.keyboard.press("Enter");
  await expect(page.locator("#app")).toHaveAttribute("data-wechsel", "haupt");
  await expect(page.locator("#knopf-liste")).toBeVisible();
  expect(await tabbar(page, "#liste")).toBe(false);
  expect((await box(page, "#editor")).width).toBeGreaterThanOrEqual(420);
  await page.locator("#knopf-liste").click();
  await expect(page.locator("#app")).toHaveAttribute("data-wechsel", "liste");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("liste-koerper");
  await foto(page, "wechsel-liste-600");
  await page.locator("#liste-koerper .karte").nth(2).click();
  await expect(page.locator("#app")).toHaveAttribute("data-wechsel", "haupt");
  // die Palette öffnet eine Notiz im Wechsel-Fenster ebenfalls im Editor
  await page.locator("#knopf-liste").click();
  await page.keyboard.press("Meta+k"); await page.keyboard.type("Espresso"); await page.waitForTimeout(400); await page.keyboard.press("Enter");
  await expect(page.locator("#app")).toHaveAttribute("data-wechsel", "haupt");
  await expect(page.locator("#pfad .krume.aktuell")).toContainText("Espresso");
  // ab 680 px kein Wechsel mehr: beide Spalten stehen nebeneinander
  await page.setViewportSize({ width: 720, height: 800 });
  await expect.poll(() => attr(page, "wechsel")).toBe("");
  await expect(page.locator("#liste")).toBeVisible(); await expect(page.locator("#editor")).toBeVisible();
});

test("Kopfzeile bei 600 px: Werkzeuge und Verlauf im Menü „…“, per Tastatur erreichbar", async ({ page }) => {
  await start(page, { breite: 600 });
  await oeffneNotiz(page);
  await expect(page.locator("#knopf-mehr")).toBeVisible();
  await expect(page.locator("#w-favorit")).toBeHidden();
  await page.locator("#knopf-mehr").focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".menue")).toBeVisible();
  await foto(page, "kopf-menue-600");
  await page.locator(".menue >> text=/Favorit/").first().click();
  await expect(page.locator("#knopf-mehr")).toBeVisible();
  await page.locator("#knopf-mehr").focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".menue")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Hauptflächen bei 720 px erreichbar: Aufgaben-Board (waagerecht scrollbar), Posteingang, Frag, Einstellungen", async ({ page }) => {
  await start(page, { breite: 720 });
  await page.keyboard.press("Meta+4");
  await page.waitForSelector(".au");
  const b = await page.evaluate(() => { const e = document.querySelector("[data-aufgaben-brett]"); return { sb: e.scrollWidth, cb: e.clientWidth, ov: getComputedStyle(e).overflowX }; });
  if (b.sb > b.cb) expect(b.ov).toBe("auto");
  await page.keyboard.press("Meta+1"); await page.waitForTimeout(300);
  await expect(page.locator("#liste-koerper")).toBeVisible();
  await page.keyboard.press("Meta+j"); await expect(page.locator('[data-frage="panel"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+,"); await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Stufenwechsel beim Ziehen des Fensters (1440 → 600 und zurück): kein Überstand in keinem Schritt, der Editor springt nur an den Stufengrenzen, nichts schwingt", async ({ page }) => {
  await start(page, { breite: 1440 });
  await oeffneNotiz(page);
  const lauf = async (von, bis, schritt) => {
    const reihe = [];
    for (let w = von; schritt < 0 ? w >= bis : w <= bis; w += schritt) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(30);
      const m = await messe(page);
      expect(m.ragt, `ragt bei ${w}`).toEqual([]); expect(m.scroll, `scroll bei ${w}`).toBeLessThanOrEqual(0); expect(m.breiter, `breiter bei ${w}`).toEqual([]);
      const e = await box(page, "#editor");
      reihe.push({ w, stufe: await page.evaluate(() => ["seite", "info", "infoUeber", "wechsel"].map((k) => document.getElementById("app").dataset[k] ?? "").join("/")), breite: Math.round(e.width) });
    }
    return reihe;
  };
  const ab = await lauf(1440, 600, -8);
  const auf = await lauf(600, 1440, 8);
  for (const reihe of [ab, auf]) {
    expect(reihe.every((r) => r.breite >= 420), "Editor behält ≥ 420 px").toBe(true);
    let stufen = 0, sprung = 0;
    for (let i = 1; i < reihe.length; i++) {
      if (reihe[i].stufe !== reihe[i - 1].stufe) stufen++;
      else sprung = Math.max(sprung, Math.abs(Math.abs(reihe[i].breite - reihe[i - 1].breite) - 8)); // innerhalb einer Stufe ändert sich der Editor höchstens so viel wie das Fenster
    }
    expect(stufen, "Stufenwechsel insgesamt").toBeLessThanOrEqual(4);
    expect(sprung, "Sprung innerhalb einer Stufe").toBeLessThanOrEqual(9);
  }
  // dieselben Stufen auf dem Hin- und Rückweg: keine Schwingung an den Grenzen
  expect(ab.map((r) => `${r.w}:${r.stufe}`).sort()).toEqual(auf.map((r) => `${r.w}:${r.stufe}`).sort());
});
