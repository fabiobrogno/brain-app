// Fließende Absätze: fest umbrochene Absätze erscheinen als ein Textfluss, die Datei bleibt Byte für Byte gleich.
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

const lese = (p) => readFileSync(join(vault, p));
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
async function oeffne(page, pfad) {
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector(".cm-content .cm-line");
}
// Text jeder sichtbaren Editorzeile (.cm-line)
const zeilen = (page) => page.locator(".cm-line").evaluateAll((els) => els.map((e) => e.textContent));
// Code in der Seite ausführen: f({ CM, view }, arg) mit dem Bundle (dasselbe Modul wie die App) und der Editor-View.
// Kein eval: die Seite erlaubt es per CSP nicht, Playwright übergibt die Funktion über das Protokoll.
const imEditor = async (page, f, arg) => {
  const h = await page.evaluateHandle(async () => {
    const CM = await import("/vendor/codemirror.bundle.js");
    return { CM, view: CM.EditorView.findFromDOM(document.querySelector(".cm-editor")) };
  });
  try { return await h.evaluate(f, arg); } finally { await h.dispose(); }
};
// Alle versteckten Bereiche (atomare Bereiche) der aktuellen Darstellung: [[von, bis], …]
const versteckt = (page) => imEditor(page, ({ CM, view }) => {
  const aus = [];
  for (const f of view.state.facet(CM.EditorView.atomicRanges)) f(view).between(0, view.state.doc.length, (von, bis) => { aus.push([von, bis]); });
  return aus;
});
const docZeilen = (page) => imEditor(page, ({ CM, view }) => view.state.doc.lines);
const ohneFokus = (page) => page.evaluate(() => document.activeElement?.blur());
// In die erste Textzeile des Absatzes klicken. Bewusst am oberen Zeilenrand und links: unter einer H1 (margin-bottom 14px) weicht das
// Höhenmodell von CodeMirror um 14px vom Bild ab, ein Klick in die Zeilenmitte landet sonst eine Zeile tiefer.
const klicke = (page, text) => page.locator(".cm-line", { hasText: text }).first().click({ position: { x: 24, y: 3 } });
const warteGespeichert = (page) => expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });

const FLIESS = "# Fließtext\n\nDer erste Satz steht in der ersten Zeile und ist\nbewusst fest umbrochen, so wie es die Wiki-Seiten\n  im Brain haben, mit mehreren Zeilen pro Absatz.\n\nZweiter Absatz.\n";
const FLIESS_ABSATZ = "Der erste Satz steht in der ersten Zeile und ist bewusst fest umbrochen, so wie es die Wiki-Seiten im Brain haben, mit mehreren Zeilen pro Absatz.";

test("fest umbrochener Absatz erscheint als EINE Zeile, die Wörter mit genau einem Leerzeichen", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  await oeffne(page, "10_notizen/fliess.md");
  await expect.poll(() => zeilen(page)).toEqual(["Fließtext", "", FLIESS_ABSATZ, "", "Zweiter Absatz.", ""]);
  // Im Dokument sind es weiter 8 Zeilen, der Text ist unverändert (auch die Einrückung der dritten Zeile)
  expect(await docZeilen(page)).toBe(8);
  expect(await imEditor(page, ({ CM, view }) => view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak))).toBe(FLIESS);
  // jede Zeilenfuge ist ein Widget mit genau einem Leerzeichen
  await expect(page.locator(".cm-line .cm-umbruch")).toHaveCount(2);
  await expect(page.locator(".cm-line .cm-umbruch").first()).toHaveText(" ");
});

test("Listenpunkte mit eingerückter Fortsetzung, auch verschachtelt, nummeriert und als Aufgabe: fließend, Einrückung unsichtbar", async ({ page }) => {
  schreibe("10_notizen/liste.md", [
    "# Liste", "",
    "- Erster Punkt, der sich über zwei Zeilen erstreckt und fest umbrochen",
    "  ist, damit man die Einrückung sieht.",
    "- Zweiter Punkt kurz.",
    "  - Verschachtelt mit einer langen Zeile, die fest umbrochen wurde und",
    "    dann in der Fortsetzung weitergeht.",
    "1. Nummeriert mit einer Fortsetzung, die auch",
    "   eingerückt ist.",
    "- [ ] Aufgabe mit zwei Zeilen, die ebenfalls",
    "  fließen soll.", "",
  ].join("\n"));
  await oeffne(page, "10_notizen/liste.md");
  await expect.poll(() => zeilen(page)).toEqual([
    "Liste", "",
    "• Erster Punkt, der sich über zwei Zeilen erstreckt und fest umbrochen ist, damit man die Einrückung sieht.",
    "• Zweiter Punkt kurz.",
    "  • Verschachtelt mit einer langen Zeile, die fest umbrochen wurde und dann in der Fortsetzung weitergeht.", // nur die echte Einrückung des Listenpunkts
    "1. Nummeriert mit einer Fortsetzung, die auch eingerückt ist.",
    "• [ ] Aufgabe mit zwei Zeilen, die ebenfalls fließen soll.",
    "",
  ]);
  for (const z of await zeilen(page)) expect(z.trimStart()).not.toMatch(/\S {2,}\S/); // nirgends doppelter Abstand
  expect(await docZeilen(page)).toBe(12);
});

test("Leerzeichen und Tabulator am Zeilenende verdoppeln den Abstand nicht", async ({ page }) => {
  schreibe("10_notizen/ende.md", "# Ende\n\nWort eins \nWort zwei\t\nWort drei  \nhart getrennt\n");
  await oeffne(page, "10_notizen/ende.md");
  // „eins “ (ein Leerzeichen) und „zwei<Tab>“ gelten als weicher Umbruch: genau ein Leerzeichen; „drei  “ (zwei) ist ein harter Umbruch
  await expect.poll(() => zeilen(page)).toEqual(["Ende", "", "Wort eins Wort zwei Wort drei  ", "hart getrennt", ""]);
});

test("nicht verbunden: Code, Tabelle, Zitat/Callout, Überschrift, harter Umbruch, HTML, Setext", async ({ page }) => {
  schreibe("10_notizen/block.md", [
    "# Probe", "",
    "Absatz vorher mit", "zwei Zeilen.", "",
    "> Zitat oder Callout über", "> mehrere Zeilen.", "",
    "| A | B |", "|---|---|", "| 1 | 2 |", "",
    "```js", "const a = 1;", "const b = 2;", "```", "",
    "    eingerückter Code", "    zweite Zeile", "",
    "Harter Umbruch  ", "bleibt sichtbar", "und der Rest", "fließt weiter.", "",
    "Backslash\\", "auch sichtbar.", "",
    "<div>", "html", "</div>", "",
    "Setext", "Titel", "=====", "",
  ].join("\n"));
  await oeffne(page, "10_notizen/block.md");
  await expect.poll(() => zeilen(page)).toEqual([
    "Probe", "",
    "Absatz vorher mit zwei Zeilen.", "",                                  // zum Vergleich: der gewöhnliche Absatz fließt
    "> Zitat oder Callout über", "> mehrere Zeilen.", "",              // Zitat/Callout
    "| A | B |", "|---|---|", "| 1 | 2 |", "",                            // Tabelle
    "```js", "const a = 1;", "const b = 2;", "```", "",                    // eingezäunter Code
    "    eingerückter Code", "    zweite Zeile", "",                        // eingerückter Code
    "Harter Umbruch  ", "bleibt sichtbar und der Rest fließt weiter.", "", // harter Umbruch bleibt, der Rest fließt
    "Backslash\\", "auch sichtbar.", "",                                    // harter Umbruch mit Backslash
    "<div>", "html", "</div>", "",                                         // HTML-Block
    "Setext", "Titel", "=====", "",                                        // Überschrift (Setext)
  ]);
});

for (const [name, ende] of [["mit --- geschlossen", "---"], ["mit ... geschlossen", "..."]]) {
  test(`Datei-Kopf wird nie verbunden, der Text danach schon (${name})`, async ({ page }) => {
    // Mit „...“ geschlossen sieht lezer-markdown den Kopf als dreizeiligen Absatz: hier greift die Aussparung des Datei-Kopfs
    const text = `---\ntitel: Kopf\nstand: 2026-10-24\n${ende}\n\nText mit\nzwei Zeilen.\n`;
    schreibe("10_notizen/kopf.md", text);
    await oeffne(page, "10_notizen/kopf.md");
    await expect.poll(() => zeilen(page)).toEqual(["", "Text mit zwei Zeilen.", ""]); // der Kopf ist eingeklappt (Block-Widget): sichtbar sind Leerzeile und Text
    const nachText = text.indexOf("Text mit") + "Text mit".length;
    const kopfBis = text.indexOf("\n" + ende) + 1 + ende.length;
    // Der zugeklappte Kopf ist seit der K1-Korrektur selbst atomar ([0, Ende der schließenden Zeile]: der Cursor kann nicht hinein);
    // verbundene Umbrüche gibt es weiterhin nur im Text danach, keinen im Kopf.
    expect(await versteckt(page)).toEqual([[0, kopfBis], [nachText, nachText + 1]]);
  });
}

test("Absatz mit Prüf-Signal bleibt unverbunden, Randmarke und andere Absätze unberührt", async ({ page }) => {
  schreibe("09_wiki/wissen/Signalprobe.md", [
    "---", "titel: Signalprobe", "stand: 2026-10-24", "---",
    "# Signalprobe", "",
    "Dieser Absatz hat keine Markierung und", "fließt deshalb zusammen.", "",
    "Ein Absatz mit einer Prüf-Zeile, bei dem", "PRÜFBEDÜRFTIG: diese Zeile trägt ein Signal", "und danach noch ein Rest.", "",
    "Noch ein Absatz ohne Markierung,", "der ebenfalls fließt.", "",
  ].join("\n"));
  await oeffne(page, "09_wiki/wissen/Signalprobe.md");
  await expect(page.locator(".cm-signal-rot")).toHaveCount(1, { timeout: 8000 }); // das echte Backend hat die Zeile markiert (die gelbe Marke ist der unsichtbare Platzhalter der Spalte)
  await expect.poll(() => zeilen(page)).toEqual([
    "Signalprobe", "",
    "Dieser Absatz hat keine Markierung und fließt deshalb zusammen.", "",
    "Ein Absatz mit einer Prüf-Zeile, bei dem", "PRÜFBEDÜRFTIG: diese Zeile trägt ein Signal", "und danach noch ein Rest.", "",
    "Noch ein Absatz ohne Markierung, der ebenfalls fließt.", "",
  ]);
  // Die Randmarke steht in der Zeile des Signals: unterhalb der ersten und oberhalb der letzten Zeile des Absatzes
  const oben = (sel) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().top);
  const marke = await oben(".cm-signal-rot");
  const erste = await oben('.cm-line:has-text("Ein Absatz mit einer Prüf-Zeile")'), letzte = await oben('.cm-line:has-text("und danach noch ein Rest.")');
  expect(marke).toBeGreaterThan(erste);
  expect(marke).toBeLessThan(letzte);
});

test("Klick in den Absatz (Fokus) zeigt ihn roh, Fokus weg verbindet ihn wieder", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  await oeffne(page, "10_notizen/fliess.md");
  await expect.poll(() => zeilen(page).then((z) => z.length)).toBe(6);
  await klicke(page, "bewusst fest");
  await expect.poll(() => zeilen(page)).toEqual(["Fließtext", "", "Der erste Satz steht in der ersten Zeile und ist", "bewusst fest umbrochen, so wie es die Wiki-Seiten", "  im Brain haben, mit mehreren Zeilen pro Absatz.", "", "Zweiter Absatz.", ""]);
  expect(await versteckt(page)).toEqual([]);
  await ohneFokus(page);
  await expect.poll(() => zeilen(page)).toEqual(["Fließtext", "", FLIESS_ABSATZ, "", "Zweiter Absatz.", ""]);
  expect((await versteckt(page)).length).toBe(2);
});

test("Enter im Absatz: die neue Zeile ist sofort sichtbar, nur dieser Absatz ist roh", async ({ page }) => {
  schreibe("10_notizen/zwei.md", "# Zwei\n\nAbsatz eins mit\nzwei Zeilen.\n\nAbsatz zwei mit\nzwei Zeilen.\n");
  await oeffne(page, "10_notizen/zwei.md");
  await klicke(page, "Absatz eins mit zwei Zeilen.");
  // Cursor hinter „Absatz“ setzen (Home/End und Klicks in die Zeilenmitte sind unter einer H1 wegen des 14px-Versatzes unzuverlässig)
  await imEditor(page, ({ view }, p) => view.dispatch({ selection: { anchor: p } }), "# Zwei\n\nAbsatz".length);
  await page.keyboard.press("Enter");
  await expect.poll(() => docZeilen(page)).toBe(9);
  // Absatz eins roh mit der neuen Zeile (Enter nimmt das Leerzeichen nach dem Cursor mit), Absatz zwei fließt weiter
  expect(await zeilen(page)).toEqual(["Zwei", "", "Absatz", "eins mit", "zwei Zeilen.", "", "Absatz zwei mit zwei Zeilen.", ""]);
  // Cursor weg: auch der neue Umbruch wird zu einem Leerzeichen
  await ohneFokus(page);
  await expect.poll(() => zeilen(page)).toEqual(["Zwei", "", "Absatz eins mit zwei Zeilen.", "", "Absatz zwei mit zwei Zeilen.", ""]);
});

test("Auswahl über mehrere Absätze zeigt alle berührten roh, den Rest nicht", async ({ page }) => {
  schreibe("10_notizen/drei.md", "# Drei\n\nAbsatz eins mit\nzwei Zeilen.\n\nAbsatz zwei mit\nzwei Zeilen.\n\nAbsatz drei mit\nzwei Zeilen.\n");
  await oeffne(page, "10_notizen/drei.md");
  await klicke(page, "Absatz eins mit zwei Zeilen.");
  await page.keyboard.press("Meta+ArrowUp"); // ganz nach oben, dann bis in Absatz zwei auswählen
  await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => imEditor(page, ({ CM, view }) => view.state.doc.lineAt(view.state.selection.main.head).number)).toBe(7);
  const z = await zeilen(page);
  expect(z).toContain("Absatz eins mit");                  // roh
  expect(z).toContain("Absatz zwei mit");                  // roh
  expect(z).toContain("Absatz drei mit zwei Zeilen.");     // fließt weiter
});

test("Rohmodus verbindet nichts, zurück stellt den Fluss wieder her", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  await oeffne(page, "10_notizen/fliess.md");
  await expect.poll(() => zeilen(page).then((z) => z.length)).toBe(6);
  await page.click("#w-roh");
  await expect.poll(() => zeilen(page)).toEqual(["# Fließtext", "", "Der erste Satz steht in der ersten Zeile und ist", "bewusst fest umbrochen, so wie es die Wiki-Seiten", "  im Brain haben, mit mehreren Zeilen pro Absatz.", "", "Zweiter Absatz.", ""]);
  expect(await versteckt(page)).toEqual([]);
  await page.click("#w-roh");
  await expect.poll(() => zeilen(page)).toEqual(["Fließtext", "", FLIESS_ABSATZ, "", "Zweiter Absatz.", ""]);
});

test("Rohmodus schon beim Öffnen: auch beim Dateiwechsel wird nichts verbunden", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  schreibe("10_notizen/fliess2.md", "# Zwei\n\nErste Zeile\nzweite Zeile\n");
  await oeffne(page, "10_notizen/fliess.md");
  await page.click("#w-roh");
  await page.reload();
  await page.waitForSelector(".cm-content .cm-line");
  await expect.poll(() => docZeilen(page)).toBe(8);
  expect((await zeilen(page)).length).toBe(8);
  await page.evaluate(() => document.querySelector('[data-karte][data-pfad="10_notizen/fliess2.md"]')?.click());
  await expect(page.locator("#pfad")).toContainText("Zwei");
  await expect.poll(() => zeilen(page)).toEqual(["# Zwei", "", "Erste Zeile", "zweite Zeile", ""]);
});

test("unverändert laden schreibt nichts; tippen und löschen speichert dieselben Bytes (LF)", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  const vorher = lese("10_notizen/fliess.md");
  await oeffne(page, "10_notizen/fliess.md");
  await page.waitForTimeout(1200);
  expect(lese("10_notizen/fliess.md").equals(vorher)).toBe(true);
  await klicke(page, "bewusst fest");
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await warteGespeichert(page);
  expect(lese("10_notizen/fliess.md").equals(vorher)).toBe(true);
});

test("ein getipptes Zeichen im Absatz ändert genau dieses Zeichen (LF)", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  const vorher = lese("10_notizen/fliess.md").toString("utf8");
  await oeffne(page, "10_notizen/fliess.md");
  await klicke(page, "bewusst fest");
  await page.keyboard.type("Ü");
  await warteGespeichert(page);
  const pos = await imEditor(page, ({ CM, view }) => view.state.sliceDoc(0, view.state.selection.main.head - 1, view.state.lineBreak).length);
  const nachher = lese("10_notizen/fliess.md").toString("utf8");
  expect(nachher).toBe(vorher.slice(0, pos) + "Ü" + vorher.slice(pos));
  expect(nachher.length).toBe(vorher.length + 1);
});

const CRLF = "# CRLF 🙂\r\n\r\nDer erste Satz steht in der ersten Zeile und ist\r\nbewusst fest umbrochen, mit Umlauten äöü ß und 😀,\r\n  eingerückter Fortsetzung und einem Rest.\r\n\r\n- Punkt mit Fortsetzung, die fließen soll\r\n  und eingerückt ist.\r\n\r\nLetzte Zeile";
test("CRLF-Datei: fließend angezeigt, Laden/Tippen/Löschen speichert dieselben Bytes, Zeichen tippen ändert nur dieses", async ({ page }) => {
  schreibe("10_notizen/crlf-absatz.md", CRLF);
  const vorher = lese("10_notizen/crlf-absatz.md");
  await oeffne(page, "10_notizen/crlf-absatz.md");
  await expect.poll(() => zeilen(page)).toEqual([
    "CRLF 🙂", "",
    "Der erste Satz steht in der ersten Zeile und ist bewusst fest umbrochen, mit Umlauten äöü ß und 😀, eingerückter Fortsetzung und einem Rest.", "",
    "• Punkt mit Fortsetzung, die fließen soll und eingerückt ist.", "",
    "Letzte Zeile",
  ]);
  await page.waitForTimeout(1200);
  expect(lese("10_notizen/crlf-absatz.md").equals(vorher)).toBe(true);
  // tippen und löschen: dieselben Bytes
  await klicke(page, "Punkt mit Fortsetzung");
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await warteGespeichert(page);
  expect(lese("10_notizen/crlf-absatz.md").equals(vorher)).toBe(true);
  // ein Zeichen tippen: der gespeicherte Text unterscheidet sich nur um dieses Zeichen, kein einzelnes \n entsteht
  await klicke(page, "bewusst fest");
  await page.keyboard.type("Ä");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  const pos = await imEditor(page, ({ CM, view }) => view.state.sliceDoc(0, view.state.selection.main.head - 1, view.state.lineBreak).length);
  const nachher = lese("10_notizen/crlf-absatz.md").toString("utf8");
  expect(nachher).toBe(vorher.toString("utf8").slice(0, pos) + "Ä" + vorher.toString("utf8").slice(pos));
  expect(nachher.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
});

test("Doppel- und Dreifachklick wählen Wort bzw. Absatz, auf die man gezeigt hat, obwohl der erste Klick den Absatz auf roh schaltet", async ({ page }) => {
  // Zeilen von ~100 Zeichen wie im Brain: roh bricht der Editor sie anders um als verbunden, der Text springt beim ersten Klick.
  // Bewusst ohne H1 davor (der Versatz unter einer H1 würde schon die Position des ersten Klicks verfälschen, das ist ein eigener Befund).
  const absatz = (n) => `Absatz ${n}: Der Hinweis-Hook fragt bei jedem Prompt einen warmen Suchdienst im Speicher und, wenn der\nnicht antwortet, läuft ein Rückfall im Kindprozess, der den Reranker einmalig laden muss, danach geht es\nweiter mit Timeouts in Folge, die als Hänger gelten: Dienst wird hart beendet und zehn Minuten gesperrt.\n`;
  schreibe("10_notizen/mehrfach.md", absatz(1) + "\n" + absatz(2) + "\n" + absatz(3));
  await oeffne(page, "10_notizen/mehrfach.md");
  await expect.poll(() => zeilen(page).then((z) => z.length)).toBe(6); // drei verbundene Absätze, zwei Leerzeilen, das Zeilenende
  const mitte = (suche) => imEditor(page, ({ view }, [s, ab]) => {
    const t = view.state.doc.toString(), pos = t.indexOf(s, t.indexOf(ab));
    const r = view.coordsAtPos(pos + Math.floor(s.length / 2));
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  }, [suche, "Absatz 2"]);
  const auswahl = () => imEditor(page, ({ view }) => { const r = view.state.selection.main; return view.state.sliceDoc(r.from, r.to); });
  for (const wort of ["Suchdienst", "Reranker", "Hänger", "gesperrt"]) {
    const p = await mitte(wort);
    await page.mouse.dblclick(p.x, p.y);
    expect(await auswahl()).toBe(wort);
    await ohneFokus(page); // wieder verbunden, bevor das nächste Wort drankommt
    await expect.poll(() => zeilen(page).then((z) => z.length)).toBe(6);
  }
  const p = await mitte("Reranker");
  await page.mouse.click(p.x, p.y, { clickCount: 3 });
  expect(await auswahl()).toBe(absatz(2)); // der ganze Absatz samt Zeilenende
});

test("Pfeiltasten: der Cursor landet nie in einem versteckten Umbruch samt Einrückung", async ({ page }) => {
  schreibe("10_notizen/pfeile.md", "# Pfeile\n\nAbsatz eins mit\n  eingerückter zweiter\n  und dritter Zeile.\n\nAbsatz zwei mit\nzwei Zeilen.\n\n- Punkt mit\n  Fortsetzung.\n");
  await oeffne(page, "10_notizen/pfeile.md");
  await klicke(page, "Pfeile"); // Cursor in der Überschrift
  const pruefe = async (taste) => {
    await page.keyboard.press(taste);
    const r = await imEditor(page, ({ CM, view }) => {
      const kopf = view.state.selection.main.head, aus = [];
      for (const f of view.state.facet(CM.EditorView.atomicRanges)) f(view).between(0, view.state.doc.length, (von, bis) => { if (kopf > von && kopf < bis) aus.push([von, bis]); });
      return { kopf, aus };
    });
    expect(r.aus, `nach ${taste} bei Position ${r.kopf}`).toEqual([]);
  };
  for (let i = 0; i < 6; i++) await pruefe("ArrowDown");
  for (let i = 0; i < 6; i++) await pruefe("ArrowUp");
  await page.keyboard.press("Meta+ArrowUp");
  for (let i = 0; i < 80; i++) await pruefe("ArrowRight");
  for (let i = 0; i < 80; i++) await pruefe("ArrowLeft");
});

test("versteckte Umbrüche sind atomar: Pfeil rechts/links und Auswahl springen darüber hinweg", async ({ page }) => {
  schreibe("10_notizen/fliess.md", FLIESS);
  await oeffne(page, "10_notizen/fliess.md");
  await expect.poll(() => versteckt(page).then((v) => v.length)).toBe(2);
  // Erwartung aus dem Text: Zeile 3 endet vor dem Umbruch, Zeile 4 beginnt mit Text, Zeile 5 mit zwei Leerzeichen Einrückung
  const erwartet = await imEditor(page, ({ CM, view }) => {
    const d = view.state.doc, z3 = d.line(3), z4 = d.line(4), z5 = d.line(5);
    return [[z3.to, z4.from], [z4.to, z5.from + 2]];
  });
  expect(await versteckt(page)).toEqual(erwartet);
  // Ohne Fokus (der Absatz bleibt verbunden) mit den Standard-Befehlen der Pfeiltasten wandern
  const lauf = (taste, shift = false) => imEditor(page, ({ CM, view }, [t, s]) => {
    const b = CM.defaultKeymap.find((k) => k.key === t);
    (s ? b.shift : b.run)(view);
    const a = view.state.selection.main;
    return [a.anchor, a.head];
  }, [taste, shift]);
  const setze = (pos) => imEditor(page, ({ CM, view }, p) => { view.dispatch({ selection: { anchor: p } }); return view.hasFocus; }, pos);
  expect(await setze(erwartet[0][0])).toBe(false);
  expect(await lauf("ArrowRight")).toEqual([erwartet[0][1], erwartet[0][1]]);   // über Umbruch + Einrückung hinweg
  expect(await lauf("ArrowLeft")).toEqual([erwartet[0][0], erwartet[0][0]]);
  expect(await lauf("ArrowRight", true)).toEqual([erwartet[0][0], erwartet[0][1]]); // Auswahl mit Umschalt bleibt am Rand
  await setze(erwartet[1][1]);
  expect(await lauf("ArrowLeft")).toEqual([erwartet[1][0], erwartet[1][0]]);     // von der Fortsetzungszeile zurück an das Zeilenende davor
});

test("Wechsel der Datei bei fokussiertem Editor: der Absatz am Cursor ist sofort roh", async ({ page }) => {
  schreibe("10_notizen/start.md", "# Start\n\nSiehe [[Ziel-Seite]] für mehr.\n");
  schreibe("10_notizen/Ziel-Seite.md", "Erste Zeile des Absatzes,\nzweite Zeile des Absatzes.\n\nSpäterer Absatz mit\nzwei Zeilen.\n");
  await oeffne(page, "10_notizen/start.md");
  await klicke(page, "Siehe"); // Editor fokussiert
  await page.locator('.cm-wiki[data-ziel="Ziel-Seite"]').click(); // Wikilink im Text: Datei wechselt, der Fokus bleibt im Editor
  await expect(page.locator("#pfad")).toContainText("Ziel-Seite");
  // Cursor steht am Anfang des ersten Absatzes: dieser ist roh, der spätere fließt
  await expect.poll(() => zeilen(page)).toEqual(["Erste Zeile des Absatzes,", "zweite Zeile des Absatzes.", "", "Späterer Absatz mit zwei Zeilen.", ""]);
  expect(await imEditor(page, ({ CM, view }) => view.hasFocus)).toBe(true);
});

test("Schreibgeschützte Seiten bleiben immer fließend", async ({ page }) => {
  schreibe("09_wiki/INDEX.md", "<!-- generiert — nicht editieren -->\n# Index\n\nErste Zeile\nzweite Zeile.\n");
  await oeffne(page, "09_wiki/INDEX.md");
  await expect(page.locator('[data-banner="schutz"]')).toBeVisible();
  await expect.poll(() => zeilen(page)).toEqual(["<!-- generiert — nicht editieren -->", "Index", "", "Erste Zeile zweite Zeile.", ""]);
  await klicke(page, "Erste Zeile");
  await page.waitForTimeout(300);
  expect(await zeilen(page)).toEqual(["<!-- generiert — nicht editieren -->", "Index", "", "Erste Zeile zweite Zeile.", ""]);
});
