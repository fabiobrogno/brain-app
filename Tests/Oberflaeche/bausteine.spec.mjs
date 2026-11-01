// Bausteine (Ressourcen/studio/bausteine.js): Tastatur, ARIA, Hell/Dunkel, Datumsauswahl, Filter-Chips, Ladezustand, Layout-Ruhe.
// Läuft ohne App auf einer Testseite mit allen Bausteinen (bausteine-seite.mjs). Bilder: KORTEX_BILDER=/Ordner npx playwright test bausteine.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { starteDateien } from "./modul-seite.mjs";
import { oeffneBausteine } from "./bausteine-seite.mjs";

let dateien;
test.beforeAll(async () => { dateien = await starteDateien(); });
test.afterAll(() => dateien?.stopp());
test.beforeEach(async ({ page }) => { await oeffneBausteine(page, dateien.url); });

const t = (page, name) => page.locator(`[data-test="${name}"], [data-filter="${name}"]`);
const ereignisse = (page) => page.evaluate(() => window.__ereignis);
const liste = (page) => page.getByRole("listbox");

test.describe("Auswahl", () => {
  test("ARIA: Combobox mit Listbox und Optionen; der gewählte Wert ist aria-selected", async ({ page }) => {
    const box = t(page, "ordner");
    await expect(box).toHaveRole("combobox");
    await expect(box).toHaveAttribute("aria-expanded", "false");
    await expect(box).toHaveAccessibleName(/Ordner.*10_notizen/);
    await box.click();
    await expect(box).toHaveAttribute("aria-expanded", "true");
    await expect(liste(page)).toBeVisible();
    await expect(liste(page).getByRole("option")).toHaveCount(4);
    await expect(liste(page).getByRole("option", { name: "10_notizen" })).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveAttribute("aria-controls", /bs-liste/);
    await expect(box).toHaveAttribute("aria-activedescendant", /bs-liste/);
  });

  test("Tastatur: ↓↑ bewegen, Enter wählt, Esc schließt und der Fokus bleibt auf dem Knopf", async ({ page }) => {
    const box = t(page, "ordner");
    await box.focus();
    await page.keyboard.press("ArrowDown");
    await expect(liste(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(liste(page).getByRole("option", { name: "20_projekte" })).toHaveAttribute("data-aktiv", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(liste(page).getByRole("option", { name: "00_inbox" })).toHaveAttribute("data-aktiv", "true");
    await page.keyboard.press("Enter");
    await expect(liste(page)).toHaveCount(0);
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute("data-wert", "00_inbox");
    expect(await ereignisse(page)).toEqual([["ordner", "00_inbox"]]);
    await page.keyboard.press("Enter");
    await expect(liste(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(liste(page)).toHaveCount(0);
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute("aria-expanded", "false");
    expect((await ereignisse(page)).length).toBe(1); // Esc ändert nichts
  });

  test("Tippen springt zum Eintrag; Home/End; Maus wählt; Klick daneben schließt", async ({ page }) => {
    const box = t(page, "ordner");
    await box.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("09");
    await expect(liste(page).getByRole("option", { name: "09_wiki" })).toHaveAttribute("data-aktiv", "true");
    await page.keyboard.press("End");
    await expect(liste(page).getByRole("option", { name: "09_wiki" })).toHaveAttribute("data-aktiv", "true");
    await page.keyboard.press("Home");
    await expect(liste(page).getByRole("option", { name: "00_inbox" })).toHaveAttribute("data-aktiv", "true");
    await page.mouse.click(5, 5);
    await expect(liste(page)).toHaveCount(0);
    await box.click();
    await liste(page).getByRole("option", { name: "20_projekte" }).click();
    await expect(box).toHaveAttribute("data-wert", "20_projekte");
    await expect(box).toContainText("20_projekte");
  });

  test("Icons und Logos je Eintrag; verstecktes Feld trägt den Wert für Formulare", async ({ page }) => {
    const ki = t(page, "ki");
    await expect(ki.locator("[data-ki-logo]")).toBeVisible();
    await ki.click();
    await expect(liste(page).locator("[data-ki-logo]")).toHaveCount(3);
    await expect(liste(page).locator(".bs-haken-slot svg")).toHaveCount(1); // Häkchen nur beim gewählten Wert
    await liste(page).getByRole("option", { name: "Gemini" }).click();
    await expect(ki.locator("[data-ki-logo='gemini']")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('[data-test="ordner"]').closest(".bs-auswahl").value)).toBe("10_notizen");
    expect(await page.evaluate(() => document.querySelector('[data-test="ordner"]').parentElement.querySelector("input[type=hidden]").value)).toBe("10_notizen");
  });

  test("Platzhalter ohne Wert; Popover öffnet nach oben, wenn unten kein Platz ist", async ({ page }) => {
    await expect(t(page, "leer")).toContainText("Wählen");
    await page.setViewportSize({ width: 1000, height: 330 });
    const box = t(page, "ordner");
    await box.scrollIntoViewIfNeeded();
    await box.click();
    const a = await box.boundingBox();
    const l = await liste(page).boundingBox();
    expect(l.y + l.height).toBeLessThanOrEqual(330 - 7);
    expect(l.y).toBeGreaterThanOrEqual(7);
    expect(l.y + l.height <= a.y + 1 || l.y >= a.y + a.height - 1).toBeTruthy(); // nie über dem Anker selbst
  });
});

test.describe("Filter-Chips", () => {
  test("Standard: neutral; Auswahl färbt den Chip; ✕ setzt zurück; ARIA-Namen", async ({ page }) => {
    const chip = page.locator(".bs-chip").first();
    const knopf = t(page, "prio").first();
    await expect(chip).toHaveAttribute("data-aktiv", "false");
    await expect(knopf).toHaveAccessibleName("Priorität: Alle");
    await knopf.click();
    await liste(page).getByRole("option", { name: "Hoch" }).click();
    await expect(chip).toHaveAttribute("data-aktiv", "true");
    await expect(knopf).toHaveAccessibleName("Priorität: Hoch");
    await expect(knopf).toHaveCSS("color", "rgb(76, 63, 198)"); // Akzent-Tinte (hell, #4C3FC6) auf weicher Akzentfläche, nach dem Übergang
    expect(await ereignisse(page)).toEqual([["prio", "hoch"]]);
    await chip.getByRole("button", { name: "Priorität zurücksetzen" }).click();
    await expect(chip).toHaveAttribute("data-aktiv", "false");
    await expect(knopf).toHaveAccessibleName("Priorität: Alle");
    expect(await ereignisse(page)).toEqual([["prio", "hoch"], ["prio", "alle"]]);
  });

  test("Vorbelegter Chip ist aktiv; das ✕ liegt im Platz des Chevrons (Chip behält Höhe und Breite)", async ({ page }) => {
    const chip = page.locator(".bs-chip").nth(1);
    await expect(chip).toHaveAttribute("data-aktiv", "true");
    const vorher = await chip.boundingBox();
    await t(page, "quelle").click();
    await liste(page).getByRole("option", { name: "Alle" }).click();
    await expect(chip).toHaveAttribute("data-aktiv", "false");
    const nachher = await chip.boundingBox();
    expect(Math.abs(vorher.height - nachher.height)).toBeLessThan(0.5);
    const x = await chip.locator(".bs-chip-x").boundingBox();
    expect(x.x).toBeGreaterThanOrEqual(nachher.x);
    expect(x.x + x.width).toBeLessThanOrEqual(nachher.x + nachher.width + 0.5);
  });

  test("Tastatur: Chip per Enter öffnen, ↓ + Enter wählt, Fokus bleibt", async ({ page }) => {
    const knopf = t(page, "faellig");
    await knopf.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(knopf).toHaveAccessibleName("Fällig: Heute");
    await expect(knopf).toBeFocused();
  });
});

test.describe("Textfelder", () => {
  test("Fokusring in der Akzentfarbe, Platzhalter, echtes <input>", async ({ page }) => {
    const input = t(page, "name");
    await expect(input).toHaveAttribute("placeholder", "Name der Notiz");
    expect(await input.evaluate((e) => e.tagName)).toBe("INPUT");
    const feld = input.locator("xpath=..");
    const ohne = await feld.evaluate((e) => getComputedStyle(e).boxShadow);
    await input.focus();
    await expect.poll(() => feld.evaluate((e) => getComputedStyle(e).borderColor)).toMatch(/0\.3568\d* 0\.3058\d* 0\.8392\d* \/ 0\.55|rgba\(91, 78, 214, 0\.55\)/); // Akzent 55 % (Design-System v2: --akzent-linie)
    const mit = await feld.evaluate((e) => getComputedStyle(e).boxShadow);
    expect(mit).not.toBe(ohne);
    expect(mit).not.toBe("none");
  });

  test("Löschen-Knopf erscheint mit Text, leert, gibt den Fokus zurück und meldet input", async ({ page }) => {
    const input = t(page, "suche");
    const weg = page.getByRole("button", { name: "Eingabe löschen" }).first();
    await expect(input).toHaveRole("searchbox");
    await expect(weg).toBeHidden();
    await input.fill("kaffee");
    await expect(weg).toBeVisible();
    await page.evaluate(() => { window.__eingabe = 0; document.querySelector('[data-test="suche"]').addEventListener("input", () => window.__eingabe++); });
    await weg.click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(weg).toBeHidden();
    expect(await page.evaluate(() => window.__eingabe)).toBe(1);
  });

  test("Inline-Fehler: role=alert, aria-invalid, aria-describedby; Tippen räumt ihn ab", async ({ page }) => {
    const input = t(page, "adresse");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    const fehler = page.getByRole("alert").filter({ hasText: "keine Git-Adresse" });
    await expect(fehler).toBeVisible();
    const id = await fehler.getAttribute("id");
    await expect(input).toHaveAttribute("aria-describedby", new RegExp(id));
    const rot = await input.locator("xpath=..").evaluate((e) => getComputedStyle(e).borderColor);
    expect(rot).not.toBe("rgb(91, 78, 214)");
    await input.press("End");
    await input.pressSequentially("x");
    await expect(fehler).toBeHidden();
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Mehrzeiliges Feld wächst mit dem Text bis zur Höchstzeile und scrollt danach", async ({ page }) => {
    const area = t(page, "bereich");
    const h0 = (await area.boundingBox()).height;
    await area.fill("eins\nzwei\ndrei\nvier");
    await expect.poll(async () => (await area.boundingBox()).height).toBeGreaterThan(h0 + 10);
    const h1 = (await area.boundingBox()).height;
    await area.fill(Array.from({ length: 20 }, (_, i) => `Zeile ${i}`).join("\n"));
    await expect.poll(async () => (await area.boundingBox()).height).toBeGreaterThan(h1);
    const hMax = (await area.boundingBox()).height;
    await area.fill(Array.from({ length: 40 }, (_, i) => `Zeile ${i}`).join("\n"));
    expect(Math.abs((await area.boundingBox()).height - hMax)).toBeLessThan(1);
    expect(await area.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  });
});

test.describe("Knöpfe", () => {
  test("Höhen: S = 28 px, M = 32 px; Varianten sichtbar verschieden", async ({ page }) => {
    expect((await t(page, "sekundaer").boundingBox()).height).toBe(32);
    expect((await t(page, "klein").boundingBox()).height).toBe(28);
    expect((await t(page, "ordner").boundingBox()).height).toBe(32);
    expect((await t(page, "ki").boundingBox()).height).toBe(28);
    expect((await t(page, "name").locator("xpath=..").boundingBox()).height).toBe(32);
    const bg = (n) => t(page, n).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await bg("primaer")).toBe("rgb(91, 78, 214)");
    expect(await bg("primaer")).not.toBe(await bg("sekundaer"));
    expect(await t(page, "gefahr").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(204, 81, 68)");
    await expect(t(page, "aus")).toBeDisabled();
  });

  test("Ladezustand: Spinner, keine Breitenänderung, Klicks ignoriert, Fokus bleibt", async ({ page }) => {
    const k = t(page, "lade");
    const vorher = (await k.boundingBox());
    await k.click();
    expect(await ereignisse(page)).toEqual([["lade-klick"]]);
    await page.evaluate(() => window.__B.setzeLaedt(window.__lade, true));
    await expect(k).toHaveAttribute("aria-busy", "true");
    const nachher = await k.boundingBox();
    expect(nachher.width).toBe(vorher.width);
    expect(nachher.height).toBe(vorher.height);
    expect(await k.evaluate((e) => getComputedStyle(e, "::after").content)).toBe('""');
    await k.focus();
    await k.click({ force: true });
    await page.keyboard.press("Enter");
    expect((await ereignisse(page)).length).toBe(1); // nichts dazugekommen
    await expect(k).toBeFocused();
    await page.evaluate(() => window.__B.setzeLaedt(window.__lade, false));
    await expect(k).not.toHaveAttribute("aria-busy", "true");
    await k.click();
    expect((await ereignisse(page)).length).toBe(2);
  });
});

test.describe("Segment, Switch, Checkbox, Radio", () => {
  test("Segment: radiogroup, Pfeiltasten wechseln, der Daumen gleitet", async ({ page }) => {
    const seg = t(page, "segment");
    await expect(seg).toHaveRole("radiogroup");
    await expect(seg.getByRole("radio")).toHaveCount(3);
    await expect(seg.getByRole("radio", { name: "Liste" })).toBeChecked();
    const daumen = seg.locator(".bs-daumen");
    const x0 = (await daumen.boundingBox()).x;
    await seg.getByRole("radio", { name: "Liste" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(seg.getByRole("radio", { name: "Board" })).toBeChecked();
    await expect(seg.getByRole("radio", { name: "Board" })).toBeFocused();
    await expect.poll(async () => (await daumen.boundingBox()).x).toBeGreaterThan(x0 + 20);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(seg.getByRole("radio", { name: "Kalender" })).toBeChecked(); // läuft rund
    expect(await ereignisse(page)).toEqual([["segment", "board"], ["segment", "liste"], ["segment", "kalender"]]);
  });

  test("Umschalter: role=switch, Leertaste und Klick auf die Beschriftung schalten", async ({ page }) => {
    const s = t(page, "schalter");
    await expect(s).toHaveRole("switch");
    await expect(s).toHaveAttribute("aria-checked", "false");
    await s.focus();
    await page.keyboard.press("Space");
    await expect(s).toHaveAttribute("aria-checked", "true");
    await page.getByText("Benachrichtigungen").click();
    await expect(s).toHaveAttribute("aria-checked", "false");
    expect(await ereignisse(page)).toEqual([["schalter", true], ["schalter", false]]);
  });

  test("Checkbox und Radio im eigenen Stil sind echte Eingaben (check/uncheck funktionieren)", async ({ page }) => {
    const c = t(page, "haken"), r1 = t(page, "radio1"), r2 = t(page, "radio2");
    expect(await c.evaluate((e) => getComputedStyle(e).appearance)).toBe("none");
    await expect(c).toBeChecked();
    await c.uncheck();
    await expect(c).not.toBeChecked();
    await c.check();
    await expect(c).toBeChecked();
    await r2.check();
    await expect(r1).not.toBeChecked();
    // Die Hintergrundfarbe läuft nach dem Anhaken 120 ms lang von „leer" zum Akzent (CSS-Übergang). Ein sofortiges getComputedStyle misst mitten im Übergang
    // (früher flackernd: rgb(92, 79, 214) statt rgb(91, 78, 214)). toHaveCSS wiederholt, bis der Endwert EXAKT erreicht ist — die Erwartung bleibt dieselbe.
    await expect(c).toHaveCSS("background-color", "rgb(91, 78, 214)");
    expect(await r2.evaluate((e) => getComputedStyle(e).borderRadius)).toMatch(/50%|8px/);
  });
});

test.describe("Datumsauswahl", () => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const montag = () => { const d = new Date(); d.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7))); return iso(d); };
  const kal = (page) => page.getByRole("dialog", { name: "Datum wählen" });

  test("Schnellwahl Heute / Morgen / Nächste Woche setzen das Datum", async ({ page }) => {
    const k = t(page, "datum");
    await expect(k).toContainText("Kein Datum");
    for (const [name, wert] of [["Heute", plus(0)], ["Morgen", plus(1)], ["Nächste Woche", montag()]]) {
      await k.click();
      await expect(kal(page)).toBeVisible();
      await kal(page).getByRole("button", { name, exact: true }).click();
      await expect(kal(page)).toHaveCount(0);
      await expect(k).toHaveAttribute("data-wert", wert);
      await expect(k).toBeFocused(); // Fokus kehrt zurück
    }
    expect((await ereignisse(page)).map((e) => e[1])).toEqual([plus(0), plus(1), ...(montag() === plus(1) ? [] : [montag()])]); // sonntags ist „Nächste Woche“ = morgen: derselbe Wert löst kein weiteres Ereignis aus
  });

  test("Kalender: Raster mit 6 Wochen, heute markiert, Tastatur (←→↑↓, Bild↑↓), Enter wählt, Esc schließt", async ({ page }) => {
    const k = t(page, "datum");
    await k.click();
    const raster = kal(page).getByRole("grid");
    await expect(raster.getByRole("gridcell")).toHaveCount(42);
    await expect(raster.locator(`[data-datum="${plus(0)}"]`)).toHaveAttribute("aria-current", "date");
    const fokus = () => page.evaluate(() => document.activeElement?.dataset?.datum);
    await expect.poll(fokus).toBe(plus(0));
    await page.keyboard.press("ArrowRight");
    await expect.poll(fokus).toBe(plus(1));
    await page.keyboard.press("ArrowDown");
    await expect.poll(fokus).toBe(plus(8));
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await expect.poll(fokus).toBe(plus(0));
    await page.keyboard.press("PageDown");
    const d = new Date(); d.setMonth(d.getMonth() + 1, Math.min(d.getDate(), 28));
    await expect.poll(fokus).toBe(iso(d));
    await page.keyboard.press("Enter");
    await expect(kal(page)).toHaveCount(0);
    await expect(k).toHaveAttribute("data-wert", iso(d));
    await k.click();
    await expect(raster.locator(`[data-datum="${iso(d)}"]`)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(kal(page)).toHaveCount(0);
    await expect(k).toBeFocused();
    expect(await ereignisse(page)).toHaveLength(1);
  });

  test("Monatswechsel mit den Pfeilen, Tag anklicken, „Kein Datum“ löscht", async ({ page }) => {
    const k = t(page, "datum");
    await k.click();
    const titel = kal(page).locator(".bs-kal-titel");
    const vorher = await titel.textContent();
    await kal(page).getByRole("button", { name: "Nächster Monat" }).click();
    await expect(titel).not.toHaveText(vorher);
    await kal(page).getByRole("button", { name: "Voriger Monat" }).click();
    await expect(titel).toHaveText(vorher);
    await kal(page).getByRole("gridcell", { name: new RegExp(`^${new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(new Date(new Date().getFullYear(), new Date().getMonth(), 15))}`) }).first().click();
    await expect(k).not.toContainText("Kein Datum");
    await k.click();
    await kal(page).getByRole("button", { name: "Kein Datum" }).click();
    await expect(k).toContainText("Kein Datum");
    await expect(k).toHaveAttribute("data-wert", "");
    expect((await ereignisse(page)).at(-1)[1]).toBeNull();
  });
});

test.describe("Tooltip und Toast", () => {
  test("Tooltip erscheint nach kurzer Verzögerung, hat role=tooltip und verschwindet beim Verlassen", async ({ page }) => {
    const k = t(page, "tipp");
    await expect(k).toHaveAttribute("aria-describedby", /bs-tipp/);
    await k.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Das ist ein Tooltip");
    await page.mouse.move(600, 600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await k.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); // Tastaturfokus zeigt ihn sofort
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("Toast erscheint im Toast-Host", async ({ page }) => {
    await t(page, "toast").click();
    await expect(page.locator("#toast-host .toast")).toHaveText("Gespeichert.");
  });
});

test.describe("Hell, Dunkel, reduzierte Bewegung", () => {
  const farben = (page) => page.evaluate(() => {
    const bg = (s) => getComputedStyle(document.querySelector(s)).backgroundColor;
    return { primaer: bg('[data-test="primaer"]'), seite: getComputedStyle(document.body).backgroundColor };
  });
  test("Akzent hell #5B4ED6, dunkel #A89FFF; Popover folgt dem Schema", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(async () => (await farben(page)).primaer).toBe("rgb(91, 78, 214)");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(async () => (await farben(page)).primaer).toBe("rgb(168, 159, 255)");
    await t(page, "ordner").click();
    const pop = await liste(page).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(pop).not.toBe("rgba(0, 0, 0, 0)");
    await expect(liste(page).getByRole("option", { name: "10_notizen" }).locator(".bs-haken-slot")).toHaveCSS("color", "rgb(168, 159, 255)");
  });

  test("Explizites Umschalten per data-theme gewinnt gegen das System", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect.poll(async () => (await farben(page)).primaer).toBe("rgb(168, 159, 255)");
  });

  test("prefers-reduced-motion: Popover ohne Übergang, Skelett sofort sichtbar", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await t(page, "ordner").click();
    expect(await liste(page).evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
    await expect(liste(page)).toHaveCSS("opacity", "1");
  });

  test("Normale Bewegung: Popover blendet in 100–200 ms ein", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await t(page, "ordner").click();
    const dauer = await liste(page).evaluate((e) => getComputedStyle(e).transitionDuration);
    const maxMs = Math.max(...dauer.split(",").map((s) => parseFloat(s) * 1000));
    expect(maxMs).toBeGreaterThanOrEqual(100);
    expect(maxMs).toBeLessThanOrEqual(200);
  });
});

test.describe("Ruhe im Layout", () => {
  test("Öffnen eines Popovers und Auswählen verschiebt nichts: Anker und Nachbarn bleiben, kein Layout-Shift", async ({ page }) => {
    await page.evaluate(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift" }); // erst ab jetzt: der Aufbau der Testseite zählt nicht
    });
    const orte = () => page.evaluate(() => [...document.querySelectorAll("#bs button, #bs input, #bs textarea")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
    const vorher = await orte();
    const box = t(page, "ordner");
    await box.click();
    await expect(liste(page)).toBeVisible();
    expect(await orte()).toEqual(vorher);
    await liste(page).getByRole("option", { name: "20_projekte" }).click();
    await expect(liste(page)).toHaveCount(0);
    const nachher = await orte();
    // der gewählte Name ist ebenso lang wie der alte → nur Breite des Auswahlknopfs darf sich ändern, nie Position/Höhe der Zeile
    nachher.forEach((o, i) => { expect(o[1]).toBe(vorher[i][1]); expect(o[3]).toBe(vorher[i][3]); });
    await t(page, "prio").click();
    await liste(page).getByRole("option", { name: "Hoch" }).click(); // Chip wird aktiv (✕ im Chevron-Platz)
    await t(page, "datum").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.01);
  });

  test("Bilder", async ({ page }) => {
    test.skip(!process.env.KORTEX_BILDER, "nur mit KORTEX_BILDER");
    mkdirSync(process.env.KORTEX_BILDER, { recursive: true });
    await page.setViewportSize({ width: 940, height: 1080 });
    for (const schema of ["hell", "dunkel"]) {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
      await page.screenshot({ path: join(process.env.KORTEX_BILDER, `bausteine-${schema}.png`) });
      await t(page, "ordner").click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(process.env.KORTEX_BILDER, `bausteine-${schema}-auswahl.png`), clip: { x: 0, y: 0, width: 940, height: 420 } });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await t(page, "datum").click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(process.env.KORTEX_BILDER, `bausteine-${schema}-datum.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await t(page, "prio").click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(process.env.KORTEX_BILDER, `bausteine-${schema}-chip.png`), clip: { x: 0, y: 100, width: 940, height: 300 } });
      await page.keyboard.press("Escape");
    }
  });
});
