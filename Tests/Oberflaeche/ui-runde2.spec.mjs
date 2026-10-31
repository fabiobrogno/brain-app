// UI-Feinschliff Runde 2: responsive Kopfzeilen (800/1000/1400 px), Popover-Kollision, Fokus-Erhalt der Statusleiste,
// Lint (keine nativen <select>/Textfelder/Systemknöpfe mehr im Studio), leere Zustände mit Aktion — gegen das echte Backend mit Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { STUDIO } from "./modul-seite.mjs";

const BREITEN = [800, 1000, 1400];

function aufgabe(vault, name, titel, status, extra = "") {
  mkdirSync(join(vault, "05_aufgaben"), { recursive: true });
  writeFileSync(join(vault, "05_aufgaben", `${name}.md`), `---\ntyp: aufgabe\ntitel: ${JSON.stringify(titel)}\nstatus: ${status}\nprioritaet: normal\n${extra}rang: 1000\nerstellt: 2026-10-20T08:00:00Z\ngeaendert: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}\nquelle: mensch\n---\n`);
}

let vault, server;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  aufgabe(vault, "a", "Lieferanten anrufen", "offen", "faellig: 2026-10-01\n");
  aufgabe(vault, "b", "Steuer vorbereiten", "in-arbeit");
  aufgabe(vault, "c", "Auf Antwort warten", "warten");
  git(vault, "add", "--", "05_aufgaben");
  git(vault, "commit", "-q", "-m", "Aufgaben");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function start(page, breite, hoehe = 800) {
  await page.setViewportSize({ width: breite, height: hoehe });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
}

// Alle sichtbaren Bedienelemente und Überschriften: liegen sie im Fenster und werden sie von keinem waagerecht abschneidenden Vorfahren gekappt?
// (Das Board darf seine Spalten waagerecht scrollen: .au-brett ist die einzige erlaubte Ausnahme.)
async function abgeschnitten(page) {
  return page.evaluate(() => {
    const fehler = [];
    const zeug = document.querySelectorAll("button, input, h2, h3, [role=combobox], .st, .pille, .speicherstand, .au-zahl");
    for (const e of zeug) {
      if (!e.checkVisibility?.({ visibilityProperty: true, opacityProperty: false })) continue;
      if (e.closest(".au-brett, .abschnitt-kopf, #info, [aria-hidden=true], .bs-nur-lesen, .kein-ansage, #menue-host, #dialog-host")) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""} "${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24)}"`;
      if (r.left < -1 || r.right > innerWidth + 1) { fehler.push(`${name} außerhalb des Fensters (${Math.round(r.left)}–${Math.round(r.right)} von ${innerWidth})`); continue; }
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible") continue;
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 1 || r.left < ar.left - 1) { fehler.push(`${name} wird von ${a.tagName.toLowerCase()}${a.id ? "#" + a.id : "." + String(a.className).split(" ")[0]} abgeschnitten`); break; }
      }
    }
    return fehler;
  });
}

for (const breite of BREITEN) {
  test.describe(`Breite ${breite}px`, () => {
    test("Aufgaben-Board: Kopfzeile, Filter und Statusleiste ragen nirgends heraus", async ({ page }) => {
      await start(page, breite);
      await page.click('[data-bereich="aufgaben"]');
      await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
      await expect(page.locator("[data-karte-aufgabe]").first()).toBeVisible();
      expect(await abgeschnitten(page)).toEqual([]);
      // Filter: breit = Chips, schmal (Board < 900 px) = ein „Filter“-Knopf mit Popover
      const schmal = breite - 250 < 900;
      await expect(page.locator("[data-filter-knopf]")).toBeVisible({ visible: schmal });
      await expect(page.locator('[data-filter="prio"]')).toBeVisible({ visible: !schmal });
      if (schmal) {
        await page.click("[data-filter-knopf]");
        const menue = page.locator(".menue.au-filter-menue");
        await expect(menue).toBeVisible();
        await menue.locator('[data-menue="filter-prio-hoch"]').click();
        await expect(page.locator("[data-filter-zahl]")).toHaveText("1");
        await expect(page.locator("[data-aufgaben-gefiltert]")).toBeVisible(); // keine Aufgabe mit hoher Priorität: Hinweis mit Aktion
        await page.click('[data-aktion="filter-zurueck"]');
        await expect(page.locator("[data-filter-zahl]")).toBeHidden();
      }
      expect(await abgeschnitten(page)).toEqual([]);
    });

    test("Notizen und Posteingang: Listenkopf, Werkzeugleiste, Seitenleiste und Statusleiste im Fenster", async ({ page }) => {
      await start(page, breite);
      for (const bereich of ["alle", "inbox"]) {
        await page.click(`[data-bereich="${bereich}"]`);
        await page.locator("#liste-koerper [data-karte]").first().click();
        await page.waitForTimeout(250);
        expect(await abgeschnitten(page), bereich).toEqual([]);
      }
    });
  });
}

test("Popover-Kollision: Menüs am Rand und in niedrigen Fenstern liegen vollständig im Fenster", async ({ page }) => {
  await start(page, 800, 420);
  const einstellungen = page.locator('[data-st="einstellungen"]');
  await einstellungen.click();
  const menue = page.locator(".menue").last();
  await expect(menue).toBeVisible();
  await page.waitForTimeout(250);
  let b = await menue.boundingBox();
  expect(b.x).toBeGreaterThanOrEqual(8 - 1);
  expect(b.y).toBeGreaterThanOrEqual(8 - 1);
  expect(b.x + b.width).toBeLessThanOrEqual(800 - 8 + 1);
  expect(b.y + b.height).toBeLessThanOrEqual(420 - 8 + 1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".menue")).toHaveCount(0);

  // Auswahl-Chip ganz rechts im Board + sehr schmales Fenster: Liste klappt nach links/oben, nie über den Rand
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator('[data-filter="faellig"]')).toBeVisible();
  await page.setViewportSize({ width: 560, height: 360 });
  await page.click("[data-filter-knopf]");
  const liste = page.locator(".menue").last();
  await expect(liste).toBeVisible();
  await page.waitForTimeout(250);
  b = await liste.boundingBox();
  expect(b.x).toBeGreaterThanOrEqual(7);
  expect(b.x + b.width).toBeLessThanOrEqual(560 - 7);
  expect(b.y).toBeGreaterThanOrEqual(7);
  expect(b.y + b.height).toBeLessThanOrEqual(360 - 7);
  await page.keyboard.press("Escape");
});

test("Popover-Motor: Fläche am rechten Rand richtet sich links aus statt abgeschnitten zu werden", async ({ page }) => {
  await start(page, 1000);
  // Anker direkt am rechten Rand, Fläche breiter als der Platz rechts davon
  const ergebnis = await page.evaluate(async () => {
    const m = await import("/popover.js");
    const anker = document.createElement("button");
    anker.textContent = "Rand";
    anker.style.cssText = "position:fixed;right:4px;top:200px;width:60px;height:28px;z-index:99";
    document.body.append(anker);
    const box = document.createElement("div");
    box.style.cssText = "width:280px;height:120px;background:#fff";
    m.oeffnePopover(anker, box, {});
    await new Promise((r) => setTimeout(r, 250));
    const r = box.getBoundingClientRect();
    const aussen = { links: r.left, rechts: innerWidth - r.right, oben: r.top, unten: innerHeight - r.bottom, seite: box.dataset.seite };
    m.schliessePopover();
    anker.remove();
    return aussen;
  });
  expect(ergebnis.links).toBeGreaterThanOrEqual(7);
  expect(ergebnis.rechts).toBeGreaterThanOrEqual(7);
  expect(ergebnis.unten).toBeGreaterThanOrEqual(7);
});

test("Statusleiste behält den Tastaturfokus beim Neuzeichnen", async ({ page }) => {
  await start(page, 1400);
  const theme = page.locator('[data-st="theme"]');
  await theme.focus();
  await expect(theme).toBeFocused();
  await page.keyboard.press("Enter"); // Theme wechseln → die Leiste wird neu gezeichnet
  await expect(theme).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(theme).toBeFocused();
  // auch das periodische/ereignisgesteuerte Neuzeichnen (Netzwechsel) lässt den Fokus stehen
  const verlauf = page.locator('[data-st="verlauf"]');
  await verlauf.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(400);
  await expect(page.locator('[data-st="verlauf"]')).toBeFocused();
});

test("Leere Zustände: freundlicher Text und eine Aktion (Suche ohne Treffer, Ansicht ohne Notizen)", async ({ page }) => {
  await start(page, 1400);
  await page.click('[data-bereich="alle"]');
  await page.click("#knopf-suche");
  await page.fill("#suche", "zzzqqqxxx");
  await expect(page.locator('[data-suche="leer"]')).toBeVisible();
  await page.click('[data-aktion="suche-loeschen"]');
  await expect(page.locator("#suche")).toHaveValue("");
  await expect(page.locator("#suche")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.click('[data-bereich="archiv"]');
  await expect(page.locator('[data-leer="liste"]')).toBeVisible();
  await page.click('[data-aktion="alle-notizen"]');
  await expect(page.locator("#liste-koerper [data-karte]").first()).toBeVisible();
});

test("Ansichtswechsel blendet in höchstens 200 ms (--d-2) ein und beachtet „Bewegung reduzieren“", async ({ page }) => {
  await start(page, 1400);
  const dauer = await page.evaluate(() => { const a = document.createElement("div"); a.className = "ansicht-wechsel"; a.innerHTML = '<div id="liste-koerper"></div>'; document.body.append(a); const d = getComputedStyle(a.firstChild).animationDuration; a.remove(); return d; });
  expect(parseFloat(dauer) * (dauer.endsWith("ms") ? 1 : 1000)).toBeLessThanOrEqual(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator("#app")).not.toHaveClass(/ansicht-wechsel/);
});

// ---------- Lint: keine nativen Felder und Systemknöpfe mehr im Studio ----------
test.describe("Lint Studio-Quellen", () => {
  const dateien = readdirSync(STUDIO).filter((f) => /\.(js|html)$/.test(f));
  const quellen = Object.fromEntries(dateien.map((f) => [f, readFileSync(join(STUDIO, f), "utf8")]));
  const treffer = (re, ausser = []) => Object.entries(quellen).filter(([f]) => !ausser.includes(f)).flatMap(([f, s]) => s.split("\n").map((z, i) => (!/^\s*\/\//.test(z) && re.test(z) ? `${f}:${i + 1}: ${z.trim().slice(0, 110)}` : null)).filter(Boolean));

  test("kein natives <select> und kein <textarea>", () => {
    expect(treffer(/<select\b|h\("select"|createElement\("select"\)/)).toEqual([]);
    expect(treffer(/<textarea\b|h\("textarea"|createElement\("textarea"\)/, ["bausteine.js"])).toEqual([]);
  });
  test("keine eigenen Textfelder: nur textfeld() aus bausteine.js", () => {
    expect(treffer(/h\("input", \{[^}]*type: "(text|search|password|email|url|number|date|time)"/, ["bausteine.js"])).toEqual([]);
    expect(treffer(/<input\b[^>]*type="(text|password|email|url|number|date|time)"/)).toEqual([]);
  });
  test("keine Systemknöpfe: Aktionsknöpfe (.knopf) entstehen nur über knopf() aus bausteine.js", () => {
    expect(treffer(/h\("button", \{[^}]*klasse: [`"]knopf[ `"]/, ["bausteine.js"])).toEqual([]);
    expect(treffer(/<button\b[^>]*class="knopf[ "]/)).toEqual([]);
  });
  test("Checkbox und Radio nur im Stil der Bausteine (hakenFeld oder die globale Regel in bausteine.css)", () => {
    expect(treffer(/h\("input", \{[^}]*type: "checkbox"/, ["bausteine.js", "abgleich.js"])).toEqual([]);
    const css = readFileSync(join(STUDIO, "bausteine.css"), "utf8");
    expect(css).toContain("input[type=checkbox], input[type=radio] { -webkit-appearance: none; appearance: none;");
  });
});
