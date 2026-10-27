// Korrekturen aus dem Opus-Review (Paket „editor“): Datei-Kopf (K1, k5), Dreifachklick auf Listenpunkte (W1), Cursor am Zeilenanfang (W2),
// CRLF-Dateien (W3), Prüf-Signale über Positionen (k1), Formel-/Kommentarblöcke (k6).
// Echter Server, echter Vault (Wegwerf-Kopie), echter Editor; die View wird über das Bundle erreicht (dasselbe Modul wie die App).
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server, seitenfehler;
test.beforeEach(async () => { seitenfehler = []; ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

const lese = (p) => readFileSync(join(vault, p)).toString("utf8");
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
async function oeffne(page, pfad) {
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector(".cm-content .cm-line");
}
const zeilen = (page) => page.locator(".cm-line").evaluateAll((els) => els.map((e) => e.textContent));
// Code in der Seite ausführen: f({ CM, view }, arg) mit dem Bundle und der Editor-View (kein eval: die Seite erlaubt es per CSP nicht)
const imEditor = async (page, f, arg) => {
  const h = await page.evaluateHandle(async () => {
    const CM = await import("/vendor/codemirror.bundle.js");
    return { CM, view: CM.EditorView.findFromDOM(document.querySelector(".cm-editor")) };
  });
  try { return await h.evaluate(f, arg); } finally { await h.dispose(); }
};
const docText = (page) => imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak));
const auswahl = (page) => imEditor(page, ({ view }) => { const r = view.state.selection.main; return { anchor: r.anchor, head: r.head, fokus: view.hasFocus, text: view.state.sliceDoc(r.from, r.to, view.state.lineBreak) }; });
const versteckt = (page) => imEditor(page, ({ CM, view }) => {
  const aus = [];
  for (const f of view.state.facet(CM.EditorView.atomicRanges)) f(view).between(0, view.state.doc.length, (von, bis) => { aus.push([von, bis]); });
  return aus;
});
const fokusImEditor = (page) => page.evaluate(() => !!document.activeElement?.closest(".cm-content"));
const ohneFokus = (page) => page.evaluate(() => document.activeElement?.blur());
const warteGespeichert = (page) => expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
const oben = (page, sel) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().top));
const einfuegen = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData("text/plain", t);
  document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
// Bildschirmstelle mitten in einem Wort des (verbundenen) Textes
const koord = (page, suche) => imEditor(page, ({ view }, s) => {
  const pos = view.state.doc.toString().indexOf(s) + Math.floor(s.length / 2);
  const r = view.coordsAtPos(pos);
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}, suche);
// Wie viele atomare Bereiche (verbundene Umbrüche) liegen in [von, bis]?
const verbundenIn = async (page, von, bis) => (await versteckt(page)).filter(([a, b]) => a >= von && b <= bis).length;
const markeZuZeile = async (page, text) => (await oben(page, ".cm-signal-rot")) - (await oben(page, `.cm-line:has-text("${text}")`)); // Rand der Marke: 13 px unter der Zeile

const KOPF = "---\ntitel: Kopf\nstand: 2026-10-24\nkritisch: true\n---\n";
const KOPF_TEXT = KOPF + "# Titel A\n\nText mit\nzwei Zeilen.\n";

// ======================================================================= K1: Datei-Kopf zugeklappt = Cursor nie darin
test("K1 a: Kopf zuklappen mit Cursor darin setzt ihn hinter den Kopf, Rückwärts-Löschen und Tippen ändern nur den sichtbaren Text", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await page.locator(".cm-fm-zu").click();
  await page.locator(".cm-line", { hasText: "stand: 2026" }).click();
  await page.keyboard.press("End");
  expect((await auswahl(page)).head).toBeLessThan(KOPF.length); // der Cursor steht im offenen Kopf
  await page.locator(".cm-fm-auf").click(); // zuklappen
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  expect((await auswahl(page)).head).toBe(KOPF.length); // hinter dem Kopf: Anfang von „# Titel A“
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("99");
  await warteGespeichert(page);
  // Der Kopf ist unberührt, „99“ steht sichtbar vor der Überschrift
  expect(lese("10_notizen/kopf.md")).toBe(KOPF + "99# Titel A\n\nText mit\nzwei Zeilen.\n");
});

test("K1: Am Anfang der ersten Zeile hinter dem zugeklappten Kopf nimmt Rückwärts-Löschen (auch Alt, ⌘) den Zeilenumbruch hinter dem Kopf nicht", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await imEditor(page, ({ view }) => view.focus());
  expect((await auswahl(page)).head).toBe(KOPF.length); // nach dem Öffnen steht der Cursor hinter dem Kopf
  for (const taste of ["Backspace", "Alt+Backspace", "Meta+Backspace"]) await page.keyboard.press(taste);
  await page.waitForTimeout(1200); // länger als das Autospeichern (800 ms)
  expect(await docText(page)).toBe(KOPF_TEXT);
  expect(lese("10_notizen/kopf.md")).toBe(KOPF_TEXT);
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  // „Zeile löschen“ in der ersten Zeile danach bleibt möglich und lässt den Kopf heil (sie nimmt den Umbruch davor und den Text, nicht den Kopf)
  await page.keyboard.press("Shift+Meta+k");
  await warteGespeichert(page);
  expect(lese("10_notizen/kopf.md")).toBe(KOPF + "\nText mit\nzwei Zeilen.\n");
});

test("K1 b: Ein Suchtreffer im Datei-Kopf klappt ihn auf, der Cursor steht sichtbar in der Trefferzeile", async ({ page }) => {
  schreibe("10_notizen/kopf.md", "---\ntitel: Kopf\nbeschreibung: Seltenwort im Kopf\nstand: 2026-10-24\n---\n# Titel\n\nText mit\nzwei Zeilen.\n");
  schreibe("10_notizen/andere.md", "# Andere\n\nNichts.\n");
  await oeffne(page, "10_notizen/andere.md");
  await page.click("#knopf-suche");
  await page.locator("#suche").fill("Seltenwort");
  await page.locator('[data-suche="treffer"]').first().click();
  await expect(page.locator(".cm-fm-auf")).toBeVisible();
  await expect(page.locator(".cm-fm-zu")).toHaveCount(0);
  await expect(page.locator(".cm-line", { hasText: "Seltenwort" })).toBeVisible();
  const a = await imEditor(page, ({ view }) => ({ zeile: view.state.doc.lineAt(view.state.selection.main.head).text, fokus: view.hasFocus }));
  expect(a).toEqual({ zeile: "beschreibung: Seltenwort im Kopf", fokus: true });
});

test("K1 c: Rückgängig in den Kopf klappt ihn auf, statt den Cursor unsichtbar darin zu lassen", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await page.locator(".cm-fm-zu").click();
  await page.locator(".cm-line", { hasText: "titel: Kopf" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("X");
  await page.locator(".cm-fm-auf").click(); // zuklappen
  await page.waitForTimeout(700); // eigene Rückgängig-Gruppe (CodeMirror gruppiert Eingaben unter 500 ms)
  await page.locator(".cm-line", { hasText: "zwei Zeilen" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("Y");
  await page.waitForTimeout(700);
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(700);
  await page.keyboard.press("Meta+z");
  expect(await docText(page)).toBe(KOPF_TEXT);
  await expect(page.locator(".cm-fm-auf")).toBeVisible(); // aufgeklappt: die Änderung im Kopf ist zu sehen
  await expect(page.locator(".cm-fm-zu")).toHaveCount(0);
  expect((await auswahl(page)).head).toBeLessThan(KOPF.length);
});

test("K1 d: Zurück aus dem Rohmodus mit Cursor im Kopf: Kopf zu, Cursor dahinter, Rückwärts-Löschen ändert nichts", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await page.click("#w-roh");
  await page.locator(".cm-line", { hasText: "stand: 2026" }).click();
  await page.keyboard.press("End");
  expect((await auswahl(page)).head).toBeLessThan(KOPF.length);
  await page.click("#w-roh"); // Vorschau: der Kopf klappt zu
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  expect((await auswahl(page)).head).toBe(KOPF.length);
  await imEditor(page, ({ view }) => view.focus());
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1200);
  expect(lese("10_notizen/kopf.md")).toBe(KOPF_TEXT);
});

test("K1 e: Ein Kopf, der erst durch Tippen entsteht, bleibt offen", async ({ page }) => {
  schreibe("10_notizen/leer.md", "");
  await oeffne(page, "10_notizen/leer.md");
  await page.locator(".cm-content").click();
  await page.keyboard.type("---\ntitel: Neu\n---");
  await expect(page.locator(".cm-fm-auf")).toBeVisible();
  await expect(page.locator(".cm-fm-zu")).toHaveCount(0);
  expect(await zeilen(page)).toEqual(["---", "titel: Neu", "---"]);
  await page.keyboard.press("Backspace"); // der Cursor steht sichtbar am Ende der schließenden Zeile und löscht dort
  await expect.poll(() => zeilen(page)).toEqual(["---", "titel: Neu", "--"]);
});

test("K1: Der zugeklappte Kopf ist atomar und nimmt nie einen Cursor auf: Pfeile und Sprünge klappen ihn auf, sobald der Cursor hinein will", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  expect(await versteckt(page)).toContainEqual([0, KOPF.length - 1]); // [0, Ende der schließenden Zeile]
  await page.locator(".cm-line", { hasText: "Text mit" }).click({ position: { x: 24, y: 3 } });
  // Niemals ein Cursor in einem zugeklappten Kopf (Ränder eingeschlossen); wer hinein will, sieht ihn aufgeklappt
  const pruefe = async (taste) => {
    await page.keyboard.press(taste);
    const r = await imEditor(page, ({ view }) => ({ kopf: view.state.selection.main.head, zu: !!document.querySelector(".cm-fm-zu") }));
    if (r.zu) expect(r.kopf, `nach ${taste}`).toBeGreaterThan(KOPF.length - 1);
  };
  for (const t of ["ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "Home", "ArrowLeft", "ArrowDown", "ArrowRight", "Meta+ArrowUp", "ArrowDown", "Meta+ArrowDown", "PageUp"]) await pruefe(t);
});

test("K1: Pfeil links oder hoch aus der ersten Zeile hinter dem zugeklappten Kopf klappt ihn auf und zeigt den Cursor darin", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  for (const taste of ["ArrowLeft", "ArrowUp"]) {
    await page.reload();
    await page.waitForSelector(".cm-content .cm-line");
    await expect(page.locator(".cm-fm-zu")).toBeVisible();
    await imEditor(page, ({ view }) => view.focus());
    expect((await auswahl(page)).head).toBe(KOPF.length); // der Cursor steht hinter dem Kopf
    await page.keyboard.press(taste);
    await expect(page.locator(".cm-fm-auf"), `nach ${taste}`).toBeVisible();
    await expect(page.locator(".cm-fm-zu")).toHaveCount(0);
    expect((await auswahl(page)).head).toBeLessThan(KOPF.length); // der Cursor steht im jetzt sichtbaren Kopf
  }
});

test("K1: Eine Ersetzung im zugeklappten Kopf (Alle ersetzen) klappt ihn auf, damit die Änderung zu sehen ist", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  await imEditor(page, ({ view }) => {
    const p = view.state.doc.toString().indexOf("2026");
    view.dispatch({ changes: [{ from: p, to: p + 4, insert: "2027" }], userEvent: "input.replace.all" });
  });
  await expect(page.locator(".cm-fm-auf")).toBeVisible();
  expect(await docText(page)).toBe(KOPF_TEXT.replace("2026", "2027"));
});

test("K1: ⌘A und Löschen entfernt weiterhin alles, auch den zugeklappten Kopf", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await imEditor(page, ({ view }) => view.focus());
  await page.keyboard.press("Meta+a");
  await expect(page.locator(".cm-fm-zu")).toBeVisible(); // ⌘A allein klappt den Kopf nicht auf
  await page.keyboard.press("Backspace");
  await expect.poll(() => docText(page)).toBe("");
});

test("K1: CRLF-Datei mit Kopf: der Cursor beginnt am Anfang der ersten Zeile hinter dem Kopf, eine reine Kopf-Datei lädt (früher: Absturz)", async ({ page }) => {
  schreibe("10_notizen/crlf-kopf.md", "---\r\ntitel: Kopf\r\n---\r\n# Titel\r\n\r\nText mit\r\nzwei Zeilen.\r\n");
  schreibe("10_notizen/crlf-nurkopf.md", "---\r\na: b\r\n---\r\n");
  await oeffne(page, "10_notizen/crlf-kopf.md");
  expect(await imEditor(page, ({ view }) => { const l = view.state.doc.lineAt(view.state.selection.main.head); return { zeile: l.text, spalte: view.state.selection.main.head - l.from }; })).toEqual({ zeile: "# Titel", spalte: 0 });
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  // Reine Kopf-Datei: die Position hinter dem Kopf wurde im Rohtext gerechnet (CRLF = 2 Zeichen) und lag hinter dem Dokumentende
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/crlf-nurkopf.md"));
  await page.waitForSelector(".cm-content"); // es gibt womöglich gar keine sichtbare Zeile: der Kopf deckt alles
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  const len = await imEditor(page, ({ view }) => view.state.doc.length);
  expect((await auswahl(page)).head).toBe(len);
  await page.locator(".cm-fm-zu").click(); // aufklappen, wieder zuklappen: der Kopf hat hinter sich keinen Platz, der Cursor bleibt am Ende
  await expect(page.locator(".cm-fm-auf")).toBeVisible();
  await page.locator(".cm-fm-auf").click();
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
});

// ======================================================================= k5: Datei-Kopf per Tastatur
test("k5: Der Datei-Kopf lässt sich per Tastatur auf- und zuklappen, der Fokus bleibt im Editor", async ({ page }) => {
  schreibe("10_notizen/kopf.md", KOPF_TEXT);
  await oeffne(page, "10_notizen/kopf.md");
  await page.locator(".cm-fm-zu").focus();
  await page.keyboard.press("Enter"); // aufklappen
  await expect(page.locator(".cm-fm-auf")).toBeVisible();
  expect(await fokusImEditor(page)).toBe(true);
  await expect(page.locator(".cm-fm-auf")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".cm-fm-auf")).toHaveAttribute("aria-expanded", "true");
  await page.locator(".cm-fm-auf").focus();
  await page.keyboard.press("Space"); // zuklappen
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  expect(await fokusImEditor(page)).toBe(true);
  await expect(page.locator(".cm-fm-zu")).toHaveAttribute("aria-expanded", "false");
  await page.locator(".cm-fm-zu").focus();
  await page.keyboard.press("Space"); // aufklappen
  await page.locator(".cm-fm-auf").focus();
  await page.keyboard.press("Enter"); // zuklappen
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  expect(await fokusImEditor(page)).toBe(true);
  // Der Fokus im Editor heißt: es lässt sich gleich weiterschreiben, und der Kopf bleibt unberührt
  await page.keyboard.type("x");
  await warteGespeichert(page);
  expect(lese("10_notizen/kopf.md")).toBe(KOPF + "x# Titel A\n\nText mit\nzwei Zeilen.\n");
});

// ======================================================================= W1: Dreifachklick auf verbundene Listenpunkte
for (const [name, text, wort, gewaehlt, danach] of [
  ["Listenpunkt", "- Erster Punkt, der sich über zwei Zeilen erstreckt und fest\n  umbrochen ist.\n- Zweiter Punkt kurz.\n- Dritter Punkt kurz.\n", "Punkt, der",
    "- Erster Punkt, der sich über zwei Zeilen erstreckt und fest\n  umbrochen ist.\n", "- Zweiter Punkt kurz.\n- Dritter Punkt kurz.\n"],
  ["Aufgabe", "- [ ] Erste Aufgabe, die sich über zwei Zeilen erstreckt und\n  fest umbrochen ist.\n- [ ] Nächste Aufgabe.\n", "Aufgabe, die",
    "- [ ] Erste Aufgabe, die sich über zwei Zeilen erstreckt und\n  fest umbrochen ist.\n", "- [ ] Nächste Aufgabe.\n"],
  ["nummerierter Punkt", "1. Erster Punkt, der sich über zwei Zeilen erstreckt und\n   fest umbrochen ist.\n2. Zweiter Punkt kurz.\n", "Punkt, der",
    "1. Erster Punkt, der sich über zwei Zeilen erstreckt und\n   fest umbrochen ist.\n", "2. Zweiter Punkt kurz.\n"],
  ["eingerückter Absatz", "   Eingerückter Absatz mit drei Leerzeichen, der sich über\n   zwei Zeilen erstreckt.\n\nNächster Absatz.\n", "Absatz mit drei",
    "   Eingerückter Absatz mit drei Leerzeichen, der sich über\n   zwei Zeilen erstreckt.\n", "\nNächster Absatz.\n"],
]) {
  test(`W1: Dreifachklick auf einen verbundenen ${name} wählt alle Zeilen samt Marke/Einrückung, Löschen hinterlässt keinen Rest`, async ({ page }) => {
    schreibe("10_notizen/w1.md", text);
    await oeffne(page, "10_notizen/w1.md");
    const p = await koord(page, wort);
    await page.mouse.click(p.x, p.y, { clickCount: 3 });
    expect((await auswahl(page)).text).toBe(gewaehlt);
    await page.keyboard.press("Backspace");
    await warteGespeichert(page);
    expect(lese("10_notizen/w1.md")).toBe(danach);
  });
}

// ======================================================================= W2: Cursor am Zeilenanfang zählt als „im Absatz“
const W2 = "# Liste\n\n- Erster Punkt, der sich über zwei Zeilen erstreckt und fest umbrochen\n  ist, damit man die Einrückung sieht.\n\n- [ ] Aufgabe mit zwei Zeilen, die ebenfalls\n  fest umbrochen ist.\n\n   Eingerückter Absatz mit drei Leerzeichen,\n   der fortgesetzt wird.\n\n1. Nummer mit zwei Zeilen, die ebenfalls\n   fest umbrochen sind.\n\nNormaler Absatz\nmit zwei Zeilen.\n";
test("W2: Der Cursor am Zeilenanfang, vor der Listenmarke, zwischen Marke und Aufgabe oder vor der Einrückung hält den Absatz roh", async ({ page }) => {
  schreibe("10_notizen/w2.md", W2);
  await oeffne(page, "10_notizen/w2.md");
  // Absatz = [Zeilenanfang der ersten, Ende der letzten Zeile]; für jede Spalte vor dem Text muss der Absatz roh sein (kein verbundener Umbruch darin)
  const absaetze = [["- Erster Punkt", 2], ["- [ ] Aufgabe", 6], ["   Eingerückter Absatz", 3], ["1. Nummer", 3]];
  await page.locator(".cm-line", { hasText: "Normaler Absatz" }).click({ position: { x: 24, y: 3 } }); // der Editor hat den Fokus
  for (const [anfang, textSpalte] of absaetze) {
    const { von, bis } = await imEditor(page, ({ view }, a) => {
      const d = view.state.doc, t = d.toString(), von = t.indexOf(a), l = d.lineAt(von);
      return { von: l.from, bis: d.lineAt(t.indexOf("\n\n", von)).to };
    }, anfang);
    for (let spalte = 0; spalte <= textSpalte; spalte++) {
      await imEditor(page, ({ view }, p) => view.dispatch({ selection: { anchor: p } }), von + spalte);
      expect((await auswahl(page)).fokus).toBe(true);
      expect(await verbundenIn(page, von, bis), `Cursor in Spalte ${spalte} vor „${anfang}“`).toBe(0);
    }
    // Zum Gegenbeweis: ohne Fokus ist derselbe Absatz verbunden
    await ohneFokus(page);
    await expect.poll(() => verbundenIn(page, von, bis), { message: `ohne Fokus „${anfang}“` }).toBeGreaterThan(0);
    await page.locator(".cm-line", { hasText: "Normaler Absatz" }).click({ position: { x: 24, y: 3 } });
  }
});

test("W2: Home im umbrochenen Listenpunkt lässt ihn roh (der Text springt nicht)", async ({ page }) => {
  schreibe("10_notizen/w2.md", W2);
  await oeffne(page, "10_notizen/w2.md");
  const vorher = await zeilen(page);
  await page.locator(".cm-line", { hasText: "Erster Punkt" }).click({ position: { x: 200, y: 8 } });
  const roh = await zeilen(page);
  expect(roh).toContain("- Erster Punkt, der sich über zwei Zeilen erstreckt und fest umbrochen"); // roh: zwei Zeilen mit Marke
  await page.keyboard.press("Home");
  expect(await zeilen(page)).toEqual(roh);
  expect((await auswahl(page)).fokus).toBe(true);
  await page.keyboard.press("ArrowRight");
  expect(await zeilen(page)).toEqual(roh);
  expect(vorher).not.toEqual(roh);
});

// ======================================================================= W3: CRLF-Datei, eingefügter oder getippter Text
const CRLF_SEITE = "# Seite\r\n\r\nEnde\r\n\r\nPRÜFBEDÜRFTIG: diese Zeile trägt ein Signal und\r\nwird hier fortgesetzt.\r\n\r\nEin normaler Absatz\r\nmit zwei Zeilen.\r\n";
const apiSignalZeile = (page, pfad) => page.evaluate(async (p) => (await (await fetch("/api/pruefung?pfad=" + encodeURIComponent(p))).json()).signale.filter((s) => s.zeile).map((s) => s.zeile), pfad);

test("W3: Einfügen von LF-Text in eine CRLF-Datei bleibt CRLF; Editor und Backend zählen die Zeilen gleich, Randmarke und Signal-Absatz stimmen", async ({ page }) => {
  schreibe("09_wiki/wissen/Seite.md", CRLF_SEITE);
  await oeffne(page, "09_wiki/wissen/Seite.md");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 });
  await page.locator(".cm-line", { hasText: "Ende" }).click();
  await page.keyboard.press("End");
  await einfuegen(page, "\nNeu eins\nNeu zwei"); // die Zwischenablage liefert auf macOS LF
  await warteGespeichert(page);
  const datei = lese("09_wiki/wissen/Seite.md");
  expect(datei).toBe(CRLF_SEITE.replace("Ende\r\n", "Ende\r\nNeu eins\r\nNeu zwei\r\n"));
  expect(datei.match(/(?<!\r)\n/g)).toBeNull(); // kein einzelnes LF
  expect(await imEditor(page, ({ view }) => view.state.doc.lines)).toBe(datei.split(/\r?\n/).length); // Editor und Backend zählen gleich
  // Neu geöffnet (frische Signale vom Backend): die Randmarke sitzt an der PRÜFBEDÜRFTIG-Zeile, und genau dieser Absatz bleibt unverbunden
  await page.reload();
  await page.waitForSelector(".cm-content .cm-line");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 });
  await ohneFokus(page);
  const pz = await imEditor(page, ({ view }) => { const d = view.state.doc; for (let n = 1; n <= d.lines; n++) if (d.line(n).text.startsWith("PRÜFBEDÜRFTIG")) return n; return null; });
  expect(await apiSignalZeile(page, "09_wiki/wissen/Seite.md")).toEqual([pz]);
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeGreaterThanOrEqual(10);
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeLessThanOrEqual(16);
  expect(await zeilen(page)).toContain("wird hier fortgesetzt."); // eigene Zeile, nicht verbunden
});

test("W3: Getippter oder ersetzter Text mit LF in einer CRLF-Datei bekommt CRLF (nie gemischte Zeilenenden); LF-Dateien bleiben LF", async ({ page }) => {
  schreibe("10_notizen/crlf.md", "# CRLF\r\n\r\nErste Zeile\r\nzweite Zeile\r\n");
  schreibe("10_notizen/lf.md", "# LF\n\nErste Zeile\nzweite Zeile\n");
  await oeffne(page, "10_notizen/crlf.md");
  const vorher = await imEditor(page, ({ view }) => view.state.doc.lines);
  await imEditor(page, ({ view }) => {
    const p = view.state.doc.toString().indexOf("Erste Zeile");
    view.dispatch({ changes: { from: p, insert: "a\nb\r\nc" }, selection: { anchor: p + 5 }, userEvent: "input.type" });
  });
  expect(await imEditor(page, ({ view }) => view.state.doc.lines)).toBe(vorher + 2); // drei Zeilen statt einer, nicht EINE Zeile mit Steuerzeichen
  expect((await auswahl(page)).head).toBe(13); // die Auswahl blieb gültig: „# CRLF“, Umbruch, Leerzeile, Umbruch = 8, dazu die fünf eingefügten Stellen
  expect(await docText(page)).toBe("# CRLF\r\n\r\na\r\nb\r\nc" + "Erste Zeile\r\nzweite Zeile\r\n");
  await warteGespeichert(page);
  expect(lese("10_notizen/crlf.md").match(/(?<!\r)\n/g)).toBeNull();
  // Die Rückgängig-Liste enthält den Schritt, und er lässt sich zurücknehmen
  await imEditor(page, ({ view }) => view.focus());
  await page.keyboard.press("Meta+z");
  expect(await docText(page)).toBe("# CRLF\r\n\r\nErste Zeile\r\nzweite Zeile\r\n");
  await warteGespeichert(page);
  // LF-Datei: nichts ändert sich (CodeMirror trennt dort bei jedem Umbruch)
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/lf.md"));
  await page.waitForSelector(".cm-content .cm-line");
  await einfuegen(page, "x\r\ny\nz");
  expect(await docText(page)).toBe("x\ny\nz# LF\n\nErste Zeile\nzweite Zeile\n");
});

test("W3: Ablegen (Drop) von LF-Text in eine CRLF-Datei bleibt CRLF", async ({ page }) => {
  schreibe("10_notizen/crlf.md", "# CRLF\r\n\r\nErste Zeile\r\nzweite Zeile\r\n");
  await oeffne(page, "10_notizen/crlf.md");
  const r = await page.locator(".cm-line", { hasText: "Erste Zeile" }).boundingBox();
  // Ablegen genau zwischen „E“ und „r“: die Schriftbreite ist je Plattform verschieden, daher aus dem Text gemessen.
  await page.evaluate(({ y }) => {
    const zeile = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.includes("Erste Zeile"));
    const walker = document.createTreeWalker(zeile, NodeFilter.SHOW_TEXT);
    const t = walker.nextNode(); const g = document.createRange(); g.setStart(t, 1); g.setEnd(t, 1);
    const x = g.getBoundingClientRect().left;
    const dt = new DataTransfer(); dt.setData("text/plain", "p\nq");
    document.querySelector(".cm-content").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { y: r.y + r.height / 2 });
  expect(await docText(page)).toBe("# CRLF\r\n\r\nEp\r\nqrste Zeile\r\nzweite Zeile\r\n");
  expect(await imEditor(page, ({ view }) => view.state.doc.lines)).toBe(6);
});

test("W3: Gemischte Datei (schon mit LF und CRLF gespeichert): Randmarke, Signal-Absatz und Sprung aus der Signalliste stimmen mit den Zeilen des Backends", async ({ page }) => {
  schreibe("09_wiki/wissen/Gemischt.md", "# Gemischt\r\n\r\nEnde\nNeu eins\nNeu zwei\r\n\r\nPRÜFBEDÜRFTIG: diese Zeile trägt ein Signal und\r\nwird hier fortgesetzt.\r\n\r\nEin normaler Absatz\r\nmit zwei Zeilen.\r\n");
  await oeffne(page, "09_wiki/wissen/Gemischt.md");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 });
  await ohneFokus(page);
  expect(await apiSignalZeile(page, "09_wiki/wissen/Gemischt.md")).toEqual([7]); // das Backend zählt jedes \n
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeGreaterThanOrEqual(10);
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeLessThanOrEqual(16);
  const z = await zeilen(page);
  expect(z).toContain("PRÜFBEDÜRFTIG: diese Zeile trägt ein Signal und"); // der Signal-Absatz bleibt unverbunden …
  expect(z).toContain("wird hier fortgesetzt.");
  expect(z).toContain("Ein normaler Absatz mit zwei Zeilen."); // … der andere fließt
  // Sprung aus der Signalliste der Eigenschaften landet in der PRÜFBEDÜRFTIG-Zeile (nicht zwei Zeilen darüber)
  await page.locator(".signal-liste li.sprung").first().click();
  expect(await imEditor(page, ({ view }) => view.state.doc.lineAt(view.state.selection.main.head).text)).toBe("PRÜFBEDÜRFTIG: diese Zeile trägt ein Signal und");
});

// ======================================================================= k1: Signale über Positionen
const SIGNAL_SEITE = ["---", "titel: Signalprobe", "stand: 2026-10-24", "---", "# Signalprobe", "",
  "Erster Absatz", "", "PRÜFBEDÜRFTIG: diese Zeile trägt ein Signal und", "wird hier fortgesetzt.", "", "Ende", ""].join("\n");
test("k1: Einfügen oberhalb schiebt Randmarke und Signal-Absatz mit, der Absatz bleibt unverbunden", async ({ page }) => {
  schreibe("09_wiki/wissen/Signalprobe.md", SIGNAL_SEITE);
  await oeffne(page, "09_wiki/wissen/Signalprobe.md");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 });
  await page.locator(".cm-line", { hasText: "Erster Absatz" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Neuer Absatz");
  await warteGespeichert(page);
  await ohneFokus(page); // die Signale werden beim Speichern nicht neu geladen: sie müssen mitgewandert sein
  await expect.poll(() => zeilen(page)).toContain("PRÜFBEDÜRFTIG: diese Zeile trägt ein Signal und");
  expect(await zeilen(page)).toContain("wird hier fortgesetzt."); // nicht verbunden
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeGreaterThanOrEqual(10);
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeLessThanOrEqual(16);
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1);
});

test("k1: Enter am Anfang der Signal-Zeile schiebt die Randmarke mit dem Text nach unten, nicht auf die neue Leerzeile", async ({ page }) => {
  schreibe("09_wiki/wissen/Signalprobe.md", SIGNAL_SEITE);
  await oeffne(page, "09_wiki/wissen/Signalprobe.md");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 });
  await page.locator(".cm-line", { hasText: "PRÜFBEDÜRFTIG" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect.poll(() => markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeGreaterThanOrEqual(10);
  expect(await markeZuZeile(page, "PRÜFBEDÜRFTIG")).toBeLessThanOrEqual(16);
});

test("k1: Löschen der Signal-Zeile nimmt die Randmarke mit, sie springt nicht auf die Folgezeile", async ({ page }) => {
  schreibe("09_wiki/wissen/Signalprobe.md", SIGNAL_SEITE);
  await oeffne(page, "09_wiki/wissen/Signalprobe.md");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 });
  await page.locator(".cm-line", { hasText: "PRÜFBEDÜRFTIG" }).click();
  await page.keyboard.press("Shift+Meta+k"); // Zeile löschen
  await expect(page.locator(".cm-line", { hasText: "PRÜFBEDÜRFTIG" })).toHaveCount(0);
  await expect(page.locator(".cm-signal-rot")).toHaveCount(0);
  // Eine Änderung mitten in der Signal-Zeile lässt die Marke dagegen stehen
  await imEditor(page, ({ view }) => { const p = view.state.doc.toString().indexOf("wird hier"); view.dispatch({ changes: { from: p, to: p + 4, insert: "bleibt" }, userEvent: "input.type" }); });
  await expect(page.locator(".cm-signal-rot")).toHaveCount(0); // (die Signal-Zeile ist weg: es gibt nichts, woran die Marke hängen könnte)
});

// ======================================================================= k6: Formel- und Kommentarblöcke
test("k6: Formelblöcke ($$ … $$) und Kommentarblöcke (%% … %%) werden nicht verbunden, gewöhnliche Absätze daneben schon", async ({ page }) => {
  schreibe("10_notizen/formel.md", [
    "# Formeln", "",
    "$$", "a = b", "c = d", "$$", "",
    "%%", "Kommentar über", "zwei Zeilen", "%%", "",
    "$$ x = 1", "y = 2 $$", "",
    "Text vor der Formel", "$$", "e = m c^2", "$$", "",
    "Gewöhnlicher Absatz mit", "zwei Zeilen.", "",
  ].join("\n"));
  await oeffne(page, "10_notizen/formel.md");
  await expect.poll(() => zeilen(page)).toEqual([
    "Formeln", "",
    "$$", "a = b", "c = d", "$$", "",
    "%%", "Kommentar über", "zwei Zeilen", "%%", "",
    "$$ x = 1", "y = 2 $$", "",
    "Text vor der Formel", "$$", "e = m c^2", "$$", "",
    "Gewöhnlicher Absatz mit zwei Zeilen.", "",
  ]);
});
