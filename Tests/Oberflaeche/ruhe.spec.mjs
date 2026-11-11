// Ruhiger Editor (R4-1): nichts im Fenster bewegt sich, nur weil man tippt oder den Cursor bewegt.
// Misst Pixel: (1) die Elemente unter einem Block verschieben sich beim Betreten mit dem Cursor um höchstens 1 px (je Blocktyp, beide
// Umbruch-Modi, hell und dunkel); (2) in der Kopfzeile bleiben Suchfeld und Titel beim Tippen pixelgleich.
// UI_SHOTS=<Ordner> schreibt Fotos (r41-*.png). Läuft in Chromium und in WebKit (Engine der Mac-App, playwright.webkit.config.mjs).
import { test, expect } from "./basis.mjs";
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

const BILDER = process.env.UI_SHOTS;
let vault, server, seitenfehler;
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
async function starte(fliessend) {
  seitenfehler = [];
  ({ vault } = baueVault());
  const support = mkdtempSync(join(tmpdir(), "brain-ui-support-"));
  if (fliessend !== undefined) writeFileSync(join(support, "einstellungen.json"), JSON.stringify({ zeilenFliessend: fliessend }));
  server = await starteServer(vault, { support });
}
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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// Fest umbrochener Absatz mit drei Zeilen, dann je Blocktyp ein Block, ganz unten die Messlinie ENDE.
const NOTIZ = [
  "---", "titel: Ruhe", "---", "# Ruhige Seite", "",
  "Absatzanfang steht in der ersten Zeile und ist bewusst fest umbrochen,", "die zweite Zeile gehört dazu, genau wie in einem Import aus einer", "Wiki-Seite, und die dritte Zeile beendet den Absatz.", "",
  "## Zwischenüberschrift", "",
  "- Listenpunkt eins", "- Listenpunkt zwei", "",
  "- [ ] Aufgabe offen", "- [x] Aufgabe erledigt", "",
  "> Zitatzeile mit etwas Text", "",
  "> [!tipp] Calloutkopf", "> Calloutinhalt", "",
  "```js", "const code = 1;", "```", "",
  "| Spalte A | Spalte B |", "| --- | --- |", "| eins | zwei |", "",
  "![[ruhe-bild.png]]", "",
  "ENDE", "",
].join("\n");
const BLOECKE = [["Überschrift 1", "Ruhige Seite", 3], ["Absatz", "ist bewusst fest umbrochen"], ["Absatz Zeile 2", "genau wie in einem Import"], ["Überschrift 2", "Zwischenüberschrift"],
  ["Liste", "Listenpunkt eins"], ["Aufgabe", "Aufgabe offen"], ["Zitat", "Zitatzeile"], ["Callout", "Calloutinhalt"], ["Code-Zaun", "```js"], ["Code", "const code"], ];
// Tabelle und Bild sind Quelltext-Blöcke: nur wer mit den Pfeiltasten hineinläuft, sieht den Markdown-Text (Tabelle 3 Zeilen statt Gitter,
// Bild Rohzeile + Bild). Wer sie benutzt (Zelle anklicken, Bild anklicken), sieht keinen Sprung – das wird geprüft; der Pfeiltasten-Weg wird nur protokolliert.
const BEDIENUNG = [["Tabelle (Zelle anklicken)", ".cm-tabelle td", "eins"], ["Bild (anklicken, Vollbild zu)", ".cm-anhang-bild", null]];
const QUELLTEXT = [["Tabelle (Pfeiltasten, Quelltext)", "eins | zwei"], ["Bild (Pfeiltasten, Quelltext)", "ruhe-bild.png"]];

// y der Messlinie ENDE (Dokumentposition → Koordinate)
const messe = (page) => imEditor(page, ({ view }) => {
  const pos = view.state.doc.toString().indexOf("\nENDE") + 1;
  const c = view.coordsAtPos(pos);
  return Math.round((c.top + view.scrollDOM.scrollTop) * 10) / 10;
});
const setzeCursor = (page, text, versatz = 3) => imEditor(page, ({ view }, { text, versatz }) => {
  view.focus();
  const pos = view.state.doc.toString().indexOf(text) + versatz;
  view.dispatch({ selection: { anchor: pos } });
}, { text, versatz });

for (const farbe of ["light", "dark"]) {
  for (const fliessend of [false, true]) {
    test(`Blöcke: Cursor-Eintritt verschiebt nichts (${fliessend ? "fließend" : "wie getippt"}, ${farbe === "light" ? "hell" : "dunkel"})`, async ({ page }) => {
      await starte(fliessend);
      schreibe("10_notizen/ruhe-bild.png", PNG);
      schreibe("10_notizen/ruhe.md", NOTIZ);
      await page.setViewportSize({ width: 1440, height: 1700 }); // die ganze Notiz im Bild: kein Scrollen, alles gemessen
      await page.emulateMedia({ colorScheme: farbe });
      await oeffne(page, "10_notizen/ruhe.md");
      await setzeCursor(page, "ENDE", 1); // Ausgangslage: Cursor unten, kein Block darüber ist aktiv
      await page.waitForTimeout(300);
      const basis = await messe(page);
      const sprung = {}, zurueck = {};
      for (const [name, text, versatz] of BLOECKE) {
        await setzeCursor(page, text, versatz ?? 3);
        await page.waitForTimeout(120);
        sprung[name] = Math.round((await messe(page) - basis) * 10) / 10;
        await setzeCursor(page, "ENDE", 1);
        await page.waitForTimeout(60);
        zurueck[name] = Math.round(((await messe(page)) - basis) * 10) / 10;
      }
      const bedient = {};
      for (const [name, wahl] of BEDIENUNG) {
        await page.locator(wahl).first().click();
        await page.waitForTimeout(150);
        bedient[name] = Math.round((await messe(page) - basis) * 10) / 10;
        await page.keyboard.press("Escape");
        await setzeCursor(page, "ENDE", 1);
        await page.waitForTimeout(100);
        expect(Math.abs((await messe(page)) - basis), `zurück auf ENDE nach ${name}`).toBeLessThanOrEqual(1);
      }
      const quelltext = {};
      for (const [name, text] of QUELLTEXT) {
        await setzeCursor(page, text);
        await page.waitForTimeout(120);
        quelltext[name] = Math.round((await messe(page) - basis) * 10) / 10;
        await setzeCursor(page, "ENDE", 1);
      }
      console.log("Quelltext-Blöcke (nicht geprüft)", JSON.stringify(quelltext));
      console.log("Δy", farbe, fliessend ? "fliessend" : "getippt", JSON.stringify(sprung), "zurück", JSON.stringify(zurueck));
      if (BILDER) {
        mkdirSync(BILDER, { recursive: true });
        await setzeCursor(page, "genau wie in einem Import");
        await page.locator("#editor").screenshot({ path: join(BILDER, `r41-bloecke-${fliessend ? "fliessend" : "getippt"}-${farbe === "light" ? "hell" : "dunkel"}.png`) });
      }
      for (const [name, d] of Object.entries(bedient)) expect(Math.abs(d), `Sprung beim Bedienen: ${name}`).toBeLessThanOrEqual(1);
      for (const [name, d] of Object.entries(sprung)) expect(Math.abs(d), `Sprung beim Betreten: ${name}`).toBeLessThanOrEqual(1);
      for (const [name, d] of Object.entries(zurueck)) expect(Math.abs(d), `Sprung beim Verlassen: ${name}`).toBeLessThanOrEqual(1);
    });
  }
}

test("Absatz: fest umbrochene Zeilen erscheinen wie getippt, mit dem Schalter fließend (ohne Aufklappen)", async ({ page }) => {
  await starte(false);
  schreibe("10_notizen/ruhe.md", NOTIZ);
  await oeffne(page, "10_notizen/ruhe.md");
  await expect(page.locator(".cm-line .cm-umbruch")).toHaveCount(0);
  await expect(page.locator(".cm-line", { hasText: "Absatzanfang" })).toHaveText(/umbrochen,$/);
  server.stopp();
  await starte(true);
  schreibe("10_notizen/ruhe.md", NOTIZ);
  await oeffne(page, "10_notizen/ruhe.md");
  await expect(page.locator(".cm-line .cm-umbruch")).toHaveCount(2);
  await setzeCursor(page, "genau wie in einem Import");
  await expect(page.locator(".cm-line .cm-umbruch")).toHaveCount(2); // Cursor im Absatz: bleibt fließend
});

test("Kopfzeile: Tippen verschiebt Suchfeld und Titel nicht, der Titel bleibt ungekürzt (1440 px, Info-Spalte offen)", async ({ page }) => {
  await starte();
  const pfad = "10_notizen/Eine Notiz mit längerem Titel.md";
  schreibe(pfad, "# Eine Notiz mit längerem Titel\n\nText.\n");
  await oeffne(page, pfad);
  const kopf = () => page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const t = document.querySelector(".pfad .krume.aktuell");
    const rund = (x) => Math.round(x * 10) / 10;
    return { suche: rund(r("#kopf-suche").left), suchB: rund(r("#kopf-suche").width), titel: rund(t.getBoundingClientRect().width), gekuerzt: t.scrollWidth > t.clientWidth,
      stand: document.querySelector("#speicherstand").dataset.zustand, standB: rund(r("#speicherstand").width) };
  });
  await expect.poll(async () => (await kopf()).stand).toBe("gespeichert");
  const vorher = await kopf();
  if (BILDER) { mkdirSync(BILDER, { recursive: true }); await page.locator("#kopf").screenshot({ path: join(BILDER, "r41-kopf-gespeichert.png") }); }
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  const gesehen = new Set([vorher.stand]);
  let foto = false;
  const bis = Date.now() + 3200;
  while (Date.now() < bis) {
    await page.keyboard.type("abc ", { delay: 40 });
    const k = await kopf();
    gesehen.add(k.stand);
    expect(k.suche, "Suchfeld x").toBe(vorher.suche);
    expect(k.suchB, "Suchfeld Breite").toBe(vorher.suchB);
    expect(k.titel, "Titelbreite").toBe(vorher.titel);
    expect(k.standB, "Breite des Speicherstands").toBe(vorher.standB);
    expect(k.gekuerzt, "Titel gekürzt").toBe(vorher.gekuerzt);
    if (BILDER && !foto && k.stand === "ungespeichert") { foto = true; await page.locator("#kopf").screenshot({ path: join(BILDER, "r41-kopf-tippen.png") }); }
  }
  expect(gesehen.has("ungespeichert"), "der Test hat den Zustand „nicht gespeichert“ gesehen").toBe(true);
  await expect.poll(async () => (await kopf()).stand, { timeout: 8000 }).toBe("gespeichert");
  const nachher = await kopf();
  expect(nachher.suche).toBe(vorher.suche);
  expect(nachher.titel).toBe(vorher.titel);
  expect(vorher.gekuerzt, "Titel bei 1440 px nicht gekürzt").toBe(false);
});

test("Einstellungen → Darstellung: Schalter „Zeilenumbrüche fließend“ schreibt zeilenFliessend und wirkt sofort im offenen Editor", async ({ page }) => {
  await starte();
  schreibe("10_notizen/ruhe.md", NOTIZ);
  await oeffne(page, "10_notizen/ruhe.md");
  await expect(page.locator(".cm-line .cm-umbruch")).toHaveCount(0);
  await page.evaluate(() => { location.hash = "#einstellungen/darstellung"; });
  const zeile = page.locator('[data-zeile="zeilen-fliessend"]');
  const schalter = zeile.locator('[role="switch"]');
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  if (BILDER) {
    mkdirSync(BILDER, { recursive: true });
    for (const farbe of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: farbe });
      await zeile.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(BILDER, `r41-einstellung-${farbe === "light" ? "hell" : "dunkel"}.png`) });
    }
  }
  await schalter.click();
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => JSON.parse(readFileSync(join(server.support, "einstellungen.json"), "utf8")).zeilenFliessend).toBe(true);
  await page.evaluate(() => { location.hash = ""; });
  await page.waitForSelector(".cm-content .cm-line");
  await expect(page.locator(".cm-line .cm-umbruch")).toHaveCount(2);
});
