// R4-3 „Tastatur, Fokus und Kontrast“, gegen die echte Werkstatt mit Wegwerf-Vault: Bereichswechsel (F6), linke Seitenleiste (⌃⌘S), Hell/Dunkel-Kürzel, Esc als ein Stapel mit Fokus-Rückgabe,
// ⌘J/⇧⌘H/⇧⌘B setzen den Fokus ins Panel, Fokus immer sichtbar (Tab-Lauf), kein natives title, Kürzel in Palette und Hilfe. Die Kontrastprüfung (Fokusring, kleiner Text) steht in darstellung.spec.mjs.
// UI_SHOTS=<Ordner> legt die Bildschirmfotos dort ab (r43-*.png).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const shots = () => { const d = process.env.UI_SHOTS || "screenshots"; mkdirSync(d, { recursive: true }); return d; };
const foto = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: join(shots(), `r43-${name}.png`) }); };
async function start(page, { breite = 1440, hoehe = 900, dunkel = false } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
}
// öffnet die erste Notiz der Liste und legt den Cursor in den Editor
async function oeffneNotiz(page) {
  await page.locator("#liste-koerper .karte").first().click();
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await page.locator("#editor .cm-content").click();
}
// Name der Region, in der der Fokus liegt (Seitenleiste, Liste, Haupt/Editor, Info, Frag), sonst "" (nirgends) oder der Elementname
const region = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return ""; return a.closest("#seite") ? "seite" : a.closest("#liste") ? "liste" : a.closest("#haupt") ? "haupt" : a.closest("#frage") ? "frage" : a.closest("#info") ? "info" : a.closest("#kopf") ? "kopf" : "sonst"; });

test("F6 und ⇧F6 springen Seitenleiste → Liste → Editor → Info und zurück; ausgeblendete Bereiche werden übersprungen", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  const reihe = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press("F6"); reihe.push(await region(page)); }
  expect(reihe).toEqual(["info", "seite", "liste", "haupt"]); // aus dem Editor: weiter zur Info-Spalte, dann rund herum
  const rueck = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Shift+F6"); rueck.push(await region(page)); }
  expect(rueck).toEqual(["liste", "seite", "info", "haupt"]);
  // Info-Spalte aus (⌥⌘I): F6 überspringt sie
  await page.keyboard.press("Alt+Meta+i");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "aus");
  await page.keyboard.press("F6"); // vom Editor
  expect(await region(page)).toBe("seite");
  // Frag offen: die rechte Spalte ist das Frag-Panel
  await page.keyboard.press("Meta+j");
  await expect(page.locator("#app")).toHaveAttribute("data-frage", "an");
  await expect.poll(() => region(page)).toBe("frage"); // der Fokus geht verzögert ins Panel: erst abwarten
  await page.keyboard.press("Shift+F6");
  await page.keyboard.press("Shift+F6");
  await page.keyboard.press("Shift+F6");
  expect(await region(page)).toBe("liste");
  await page.keyboard.press("F6"); await page.keyboard.press("F6");
  expect(await region(page)).toBe("frage");
});

test("⌃⌘S blendet die linke Seitenleiste ein und aus (Knopf, Kürzel, Palette); aus = nicht erreichbar, Fokus in der Liste", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  await expect(page.locator("#seite")).toBeVisible();
  const breiteAn = (await page.locator("#liste").boundingBox()).x;
  expect(breiteAn).toBeGreaterThan(150);
  await page.keyboard.press("F6"); await page.keyboard.press("F6"); // Editor → Info → Seitenleiste
  expect(await region(page)).toBe("seite");
  await page.keyboard.press("Control+Meta+s");
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
  await expect(page.locator("#seite")).toBeHidden();
  await expect.poll(async () => (await page.locator("#liste").boundingBox()).x).toBeLessThan(2);
  expect(await region(page)).toBe("liste"); // der Fokus bleibt nicht im Verborgenen
  await expect(page.locator("#knopf-seite")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab"); // nie in die verborgene Spalte
  expect(await region(page)).not.toBe("seite");
  // Zustand bleibt nach Neuladen
  await page.reload(); await page.waitForFunction(() => window.__studioBereit === true);
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
  // wieder ein: per Knopf
  await page.locator("#knopf-seite").click();
  await expect(page.locator("#seite")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "an");
  // und per Palette (mit Kürzel)
  await page.keyboard.press("Meta+k");
  const eintrag = page.locator('.pal-eintrag[data-pal="befehl"]', { has: page.locator(".n", { hasText: /Seitenleiste links/ }) });
  await expect(eintrag.locator(".r")).toHaveText("⌃⌘S");
  await eintrag.click();
  await expect(page.locator("#app")).toHaveAttribute("data-seite", "aus");
});

test("⌥⌘L schaltet Hell und Dunkel um", async ({ page }) => {
  await start(page);
  const modus = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  const vorher = await modus();
  await page.keyboard.press("Alt+Meta+l");
  await expect.poll(modus).not.toBe(vorher);
  await page.keyboard.press("Alt+Meta+l");
  await expect.poll(modus).toBe(vorher);
});

test("Palette und Kürzelhilfe zeigen die neuen Kürzel; die Hilfe listet jeden Befehl des Registers samt festen Tasten", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+k");
  for (const [name, kuerzel] of [[/Nächster Bereich/, "F6"], [/Vorheriger Bereich/, "⇧F6"], [/Seitenleiste links/, "⌃⌘S"], [/Hell und Dunkel/, "⌥⌘L"]]) {
    await expect(page.locator('.pal-eintrag[data-pal="befehl"]', { has: page.locator(".n", { hasText: name }) }).locator(".r")).toHaveText(kuerzel);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+/");
  const hilfe = page.locator(".dialog .kuerzel");
  await expect(hilfe).toBeVisible();
  const text = await hilfe.innerText();
  for (const s of ["Nächster Bereich", "Vorheriger Bereich", "Seitenleiste links ein- und ausblenden", "Hell und Dunkel umschalten", "Verlauf ein- und ausblenden", "Mitteilungen", "Frag deinen Vault", "Notiz oder Ordner umbenennen", "Notiz in den Papierkorb legen", "Karte verschieben", "Schließt immer das Oberste"]) expect(text).toContain(s);
  const anzahl = await hilfe.locator("dt").count();
  expect(anzahl).toBeGreaterThan(40);
  await foto(page, "kuerzelhilfe");
});

// ------------------------------------------------------------------ Esc-Stapel
const flaechen = {
  palette: { auf: (p) => p.keyboard.press("Meta+k"), offen: (p) => p.locator(".palette"), },
  hilfe: { auf: (p) => p.keyboard.press("Meta+/"), offen: (p) => p.locator(".dialog .kuerzel") },
  einstellungen: { auf: (p) => p.keyboard.press("Meta+,"), offen: (p) => p.locator("[data-einstellungen]") },
  verlauf: { auf: (p) => p.keyboard.press("Meta+Shift+h"), offen: (p) => p.locator('#app[data-modus="verlauf"]') },
  frag: { auf: (p) => p.keyboard.press("Meta+j"), offen: (p) => p.locator('#app[data-frage="an"]') },
  mitteilungen: { auf: (p) => p.keyboard.press("Meta+Shift+b"), offen: (p) => p.locator(".glocke") },
  vaultmenue: { auf: (p) => p.locator("#vault-wechsler").click(), offen: (p) => p.locator(".menue") },
  suche: { auf: (p) => p.keyboard.press("Meta+Shift+f"), offen: (p) => p.locator("#liste-suche:not([hidden])") },
};
for (const [name, f] of Object.entries(flaechen)) {
  test(`Esc-Matrix: ${name} öffnen → Esc schließt es, der Fokus kehrt zurück`, async ({ page }) => {
    await start(page);
    await oeffneNotiz(page);
    // Fokusanker: ein Knopf der Kopfzeile bzw. der Editor (je nach Fläche), von dem aus geöffnet wird
    const anker = name === "vaultmenue" ? "#vault-wechsler" : "#editor .cm-content";
    const zielNachEsc = name === "mitteilungen" ? "#knopf-glocke" : anker; // das Popover gibt den Fokus an seinen Knopf zurück
    if (name === "vaultmenue") await page.locator("#vault-wechsler").focus(); else await page.locator(anker).focus();
    await f.auf(page);
    await expect(f.offen(page).first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(f.offen(page)).toHaveCount(0, { timeout: 5000 });
    // Fokus ist nicht im Nichts: er steht wieder am Auslöser (Editor bzw. Menüknopf), bei der Suche in der Liste
    await expect.poll(async () => page.evaluate((a) => { const x = document.activeElement; return !!x && x !== document.body && (x.matches(a) || !!x.closest(a)); }, name === "suche" ? "#liste-koerper" : zielNachEsc), { message: `Fokus nach Esc (${name})` }).toBe(true);
  });
}

test("Esc schließt immer das Oberste: Dialog vor Panel, Verlauf vor Frag, Frag vor nichts; jede Taste genau eine Schicht", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  await page.keyboard.press("Meta+j");
  await expect(page.locator("#app")).toHaveAttribute("data-frage", "an");
  await page.keyboard.press("Meta+Shift+h");
  await expect(page.locator("#app")).toHaveAttribute("data-modus", "verlauf");
  await page.keyboard.press("Meta+/"); // Dialog über allem
  await expect(page.locator(".dialog .kuerzel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog .kuerzel")).toHaveCount(0);
  await expect(page.locator("#app")).toHaveAttribute("data-modus", "verlauf"); // nur der Dialog ging zu
  await expect(page.locator("#app")).toHaveAttribute("data-frage", "an");
  await page.locator("#knopf-verlauf").focus(); // Fokus irgendwo, nicht im Panel: gilt trotzdem
  await page.keyboard.press("Escape");
  await expect(page.locator("#app")).not.toHaveAttribute("data-modus", "verlauf"); // Verlauf zu
  await expect(page.locator("#app")).toHaveAttribute("data-frage", "an"); // Frag bleibt
  await page.keyboard.press("Escape");
  await expect(page.locator("#app")).not.toHaveAttribute("data-frage", "an");
});

test("⌘J ohne KI-Konto: der Fokus geht ins Panel, Esc schließt es, der Fokus kehrt in den Editor zurück", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  await page.keyboard.press("Meta+j");
  await expect(page.locator("#app")).toHaveAttribute("data-frage", "an");
  await expect.poll(() => region(page)).toBe("frage");
  await foto(page, "frag-fokus");
  await page.keyboard.press("Escape");
  await expect(page.locator("#app")).not.toHaveAttribute("data-frage", "an");
  await expect.poll(() => region(page)).toBe("haupt");
  // Esc aus dem Editor heraus schließt ein offenes Frag-Panel, auch wenn der Fokus nicht darin liegt
  await page.keyboard.press("Meta+j");
  await expect.poll(() => region(page)).toBe("frage");
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#app")).not.toHaveAttribute("data-frage", "an");
});

test("⇧⌘H setzt den Fokus in den Verlauf und gibt ihn beim Schließen zurück; ⇧⌘B ebenso für Mitteilungen", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  await page.keyboard.press("Meta+Shift+h");
  await expect(page.locator("#app")).toHaveAttribute("data-modus", "verlauf");
  await expect.poll(() => region(page), { timeout: 8000 }).toBe("liste");
  await page.keyboard.press("Meta+Shift+h");
  await expect(page.locator("#app")).not.toHaveAttribute("data-modus", "verlauf");
  await expect.poll(() => region(page)).toBe("haupt");
  await page.keyboard.press("Meta+Shift+b");
  await expect(page.locator(".glocke")).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest(".glocke"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".glocke")).toHaveCount(0);
  await expect.poll(() => region(page)).not.toBe("");
});

test("Esc im Editor: Textauswahl und Format-Leiste zuerst, dann weiter nach unten", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  await page.keyboard.press("Meta+a");
  await expect(page.locator('.format-leiste[data-offen="ja"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('.format-leiste[data-offen="ja"]')).toHaveCount(0);
  expect(await page.evaluate(() => getSelection().isCollapsed || document.querySelector(".cm-selectionBackground") === null)).toBe(true);
});

// ------------------------------------------------------------------ Fokus immer sichtbar
test("Tab-Lauf: nach jedem Tab liegt der Fokus auf einem Element mit sichtbarem Fokus (Ring oder Feld-Rahmen)", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  await page.locator("#knopf-neu").focus();
  const schlecht = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { weg: true };
      const cs = getComputedStyle(a);
      const ring = (cs.boxShadow && cs.boxShadow !== "none") || (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none");
      const feld = !!a.closest(".bs-feld, .cm-editor, .palette") || a.tagName === "TEXTAREA" || a.tagName === "INPUT";
      const kind = [...a.querySelectorAll("*")].some((k) => { const s = getComputedStyle(k); return s.boxShadow !== "none"; }) && !!a.closest("#liste-koerper");
      const liste = a.id === "liste-koerper" && !!document.querySelector('#liste-koerper [aria-selected="true"]');
      return { ok: ring || feld || kind || liste, name: `${a.tagName.toLowerCase()}#${a.id}.${a.className}`.slice(0, 80), sichtbar: a.getClientRects().length > 0 };
    });
    if (r.weg || !r.ok || !r.sichtbar) schlecht.push(`${i}: ${JSON.stringify(r)}`);
  }
  expect(schlecht).toEqual([]);
});

// ------------------------------------------------------------------ Tooltips
test("Kein sichtbares Element trägt ein natives title (alle Hauptansichten); der eigene Tooltip zeigt Text und Kürzel", async ({ page }) => {
  await start(page);
  await oeffneNotiz(page);
  const nativ = () => page.evaluate(() => [...document.querySelectorAll("[title]")].filter((e) => e.getClientRects().length > 0 || true).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 30)} = ${e.getAttribute("title").slice(0, 40)}`));
  const pruefe = async (wo) => { await page.waitForTimeout(80); expect(await nativ(), `native title in: ${wo}`).toEqual([]); };
  await pruefe("Notiz offen");
  expect(await page.locator("[data-tipp-text]").count()).toBeGreaterThan(8);
  await page.keyboard.press("Meta+Shift+h"); await page.waitForTimeout(900); await pruefe("Verlauf");
  await page.keyboard.press("Meta+Shift+h");
  await page.keyboard.press("Meta+j"); await pruefe("Frag");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Shift+b"); await pruefe("Mitteilungen");
  await page.keyboard.press("Escape");
  await page.locator('[data-bereich="aufgaben"]').click(); await page.waitForTimeout(500); await pruefe("Aufgaben");
  await page.locator('[data-bereich="alle"]').click();
  await page.keyboard.press("Meta+,"); await page.waitForTimeout(400); await pruefe("Einstellungen");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k"); await pruefe("Palette");
  await page.keyboard.press("Escape");
  // später gesetztes title (Skript) wird sofort übernommen
  await page.evaluate(() => { const b = document.createElement("button"); b.id = "t-probe"; b.title = "Probe (⌘P)"; document.body.append(b); });
  await pruefe("nachträglich gesetzt");
  await expect(page.locator("#t-probe")).toHaveAttribute("data-tipp-text", "Probe (⌘P)");
  await expect(page.locator("#t-probe")).toHaveAttribute("aria-label", "Probe (⌘P)");
  // Tooltip bei Maus (500 ms) und Tastaturfokus (sofort), mit Kürzel; Esc blendet ihn aus
  await page.locator("#knopf-neu").hover();
  await expect(page.locator(".bs-tipp.offen")).toContainText("Neue Notiz", { timeout: 2500 });
  await foto(page, "tooltip");
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-tipp")).toHaveCount(0);
  await page.mouse.move(700, 600);
  await page.locator("#knopf-info").focus();
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  await expect(page.locator(".bs-tipp.offen")).toBeVisible();
});

// ------------------------------------------------------------------ Fotos
for (const dunkel of [false, true]) {
  test(`Foto: Fokusring ${dunkel ? "dunkel" : "hell"}`, async ({ page }) => {
    await start(page, { dunkel });
    await oeffneNotiz(page);
    await page.locator("#knopf-info").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab"); // Tastaturfokus: der Ring erscheint
    await page.mouse.move(700, 850);
    await foto(page, `fokusring-${dunkel ? "dunkel" : "hell"}`);
    await page.keyboard.press("F6"); // Seitenleiste
    await page.keyboard.press("F6"); // Liste: gewählte Karte mit Ring
    expect(await region(page)).toBe("liste");
    await expect(page.locator("#liste-koerper")).toBeFocused();
    const ring = await page.locator('#liste-koerper [data-karte][aria-selected="true"]').evaluate((e) => getComputedStyle(e).boxShadow);
    expect(ring).not.toBe("none");
    await foto(page, `fokus-liste-${dunkel ? "dunkel" : "hell"}`);
  });
}
