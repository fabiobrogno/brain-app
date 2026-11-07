// Runde 3b: Tabellen im Editor, Formatieren (Kürzel), Einfügen aus der Zwischenablage, schwebende Format-Leiste.
// Echter Server, echter Vault (Wegwerf-Kopie), echter Editor. UI_SHOTS=<Ordner>: Bildschirmfotos dort (hell und dunkel).
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server, seitenfehler;
test.beforeEach(async () => { seitenfehler = []; ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

const BILDER = process.env.UI_SHOTS;
const lese = (p) => readFileSync(join(vault, p), "utf8");
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
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
const auswahl = (page, von, bis = von) => imEditor(page, ({ view }, [a, b]) => { view.focus(); view.dispatch({ selection: { anchor: a, head: b } }); }, [von, bis]);
const auswahlText = (page) => imEditor(page, ({ view }) => { const r = view.state.selection.main; return view.state.sliceDoc(r.from, r.to); });
const warteGespeichert = (page) => expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
const bild = async (page, name, thema) => { if (BILDER) { mkdirSync(BILDER, { recursive: true }); await page.screenshot({ path: join(BILDER, `${name}-${thema}.png`), clip: await page.locator("#editor").boundingBox() }); } };
const zelle = (page, z, s) => page.locator(`.cm-tabelle [data-z="${z}"][data-s="${s}"] .cm-tz`);
const zellenTexte = (page) => page.locator(".cm-tabelle tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll(".cm-tz")].map((c) => c.dataset.roh)));

const TAB = "# Tabelle\n\n| Name | Rolle |\n| :-- | --: |\n| Anna | Leitung |\n| Bo | Technik |\n\nDanach Text.\n";

// ------------------------------------------------------------------ Tabellen
test("Tabelle: erscheint als Tabelle (Kopf, Zeilen, Ausrichtung), der Text bleibt unverändert; hell und dunkel", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  await expect(page.locator(".cm-tabelle")).toHaveCount(1);
  expect(await zellenTexte(page)).toEqual([["Name", "Rolle"], ["Anna", "Leitung"], ["Bo", "Technik"]]);
  await expect(page.locator(".cm-tabelle thead th")).toHaveCount(2);
  await expect(page.locator(".cm-tabelle thead th").nth(1)).toHaveCSS("text-align", "right");
  await expect(page.locator(".cm-tabelle thead th").first()).toHaveCSS("text-align", "left");
  expect(await dok(page)).toBe(TAB);
  // die Pipe-Zeilen sind nicht als Textzeilen zu sehen
  await expect(page.locator(".cm-line", { hasText: "| Anna" })).toHaveCount(0);
  await page.emulateMedia({ colorScheme: "light" });
  await bild(page, "tabelle", "hell");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".cm-tabelle")).toBeVisible();
  await bild(page, "tabelle", "dunkel");
  // Kontrast der Zellen: Text hebt sich vom Grund ab (nicht gleiche Farbe)
  const farben = await page.locator(".cm-tabelle td").first().evaluate((el) => { const c = getComputedStyle(el.firstChild); return [c.color, getComputedStyle(el.closest("table")).backgroundColor]; });
  expect(farben[0]).not.toBe(farben[1]);
});

test("Tabelle: Zelle bearbeiten schreibt ausgerichtet in die Datei zurück, Fokus bleibt beim Tippen in der Zelle", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  await zelle(page, 1, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Maria Magdalena");
  await expect(zelle(page, 1, 0)).toBeFocused();
  expect(await dok(page)).toBe("# Tabelle\n\n| Name                 |   Rolle |\n| :------------------- | ------: |\n| Anna Maria Magdalena | Leitung |\n| Bo                   | Technik |\n\nDanach Text.\n");
  await warteGespeichert(page);
  // Spalten sind in der Datei ausgerichtet (jede Zeile gleich lang)
  const zeilen = lese("10_notizen/tab.md").split("\n").filter((z) => z.startsWith("|"));
  expect(new Set(zeilen.map((z) => z.length)).size).toBe(1);
  expect(zeilen[2]).toContain("Anna Maria Magdalena");
});

test("Tabelle: Pipe in einer Zelle wird als \\| geschrieben und wieder als | gezeigt; Markdown in Zellen wird gerendert, beim Bearbeiten roh gezeigt", async ({ page }) => {
  schreibe("10_notizen/tab.md", "| a | b |\n| - | - |\n| **fett** und `code` | [Link](https://x.org) |\n");
  await oeffne(page, "10_notizen/tab.md");
  await expect(zelle(page, 1, 0).locator(".cm-fett")).toHaveText("fett");
  await expect(zelle(page, 1, 0).locator(".cm-code")).toHaveText("code");
  await expect(zelle(page, 1, 1).locator(".cm-link")).toHaveText("Link");
  await zelle(page, 1, 0).click();
  await expect(zelle(page, 1, 0)).toHaveText("**fett** und `code`");
  await page.keyboard.press("End");
  await page.keyboard.type(" x|y");
  expect(await dok(page)).toContain("\\|");
  await zelle(page, 0, 0).click(); // Fokus weg: wieder gerendert, der Text mit | bleibt
  await expect(zelle(page, 1, 0).locator(".cm-fett")).toHaveText("fett");
  expect(await dok(page)).toMatch(/x\\\|y/);
  await expect(zelle(page, 1, 0)).toContainText("x|y");
});

test("Tabelle: Tab/⇧Tab springen zwischen Zellen, am Ende kommt eine neue Zeile, Enter fügt eine Zeile ein", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  await zelle(page, 0, 0).click();
  await page.keyboard.press("Tab");
  await expect(zelle(page, 0, 1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(zelle(page, 1, 0)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(zelle(page, 0, 1)).toBeFocused();
  // zur letzten Zelle und Tab: neue Zeile, Fokus in ihrer ersten Zelle
  await zelle(page, 2, 1).click();
  await page.keyboard.press("Tab");
  await expect(zelle(page, 3, 0)).toBeFocused();
  expect(await zellenTexte(page)).toEqual([["Name", "Rolle"], ["Anna", "Leitung"], ["Bo", "Technik"], ["", ""]]);
  await page.keyboard.type("Cy");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Test");
  expect(await dok(page)).toContain("| Cy   |    Test |");
  // Enter: neue Zeile unter der aktuellen, gleiche Spalte
  await zelle(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await expect(zelle(page, 2, 1)).toBeFocused();
  expect(await zellenTexte(page)).toEqual([["Name", "Rolle"], ["Anna", "Leitung"], ["", ""], ["Bo", "Technik"], ["Cy", "Test"]]);
  // Enter in der Kopfzeile: Zeile direkt unter dem Kopf
  await zelle(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await expect(zelle(page, 1, 0)).toBeFocused();
  expect((await zellenTexte(page))[1]).toEqual(["", ""]);
  // Esc: zurück in den Text, der Cursor steht hinter der Tabelle
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content")).toBeFocused();
  const nachher = await imEditor(page, ({ view }) => { const l = view.state.doc.lineAt(view.state.selection.main.head); return l.text; });
  expect(nachher).toBe("");
});

test("Tabelle: Kontextmenü — Zeile/Spalte einfügen und löschen, Ausrichtung, Als Text bearbeiten, Tabelle löschen", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  const menue = async (z, s, eintrag) => { await zelle(page, z, s).click({ button: "right" }); await page.locator(`.menue [data-menue="${eintrag}"]`).click(); };
  await menue(1, 0, "tab-zeile-unten");
  expect(await zellenTexte(page)).toEqual([["Name", "Rolle"], ["Anna", "Leitung"], ["", ""], ["Bo", "Technik"]]);
  await menue(2, 0, "tab-zeile-loeschen");
  expect((await zellenTexte(page)).length).toBe(3);
  await menue(1, 1, "tab-spalte-rechts");
  expect(await zellenTexte(page)).toEqual([["Name", "Rolle", "Spalte 3"], ["Anna", "Leitung", ""], ["Bo", "Technik", ""]]);
  await menue(0, 2, "tab-spalte-loeschen");
  expect((await zellenTexte(page))[0]).toEqual(["Name", "Rolle"]);
  await menue(1, 0, "tab-mitte");
  await expect(page.locator(".cm-tabelle thead th").first()).toHaveCSS("text-align", "center");
  expect(await dok(page)).toContain("| :--: |");
  await menue(0, 1, "tab-spalte-links");
  expect((await zellenTexte(page))[0]).toEqual(["Name", "Spalte 3", "Rolle"]);
  await warteGespeichert(page);
  expect(lese("10_notizen/tab.md")).toContain("| Name | Spalte 3 |");
  // Als Text bearbeiten: der Cursor steht in der Tabelle, der Quelltext ist sichtbar
  await menue(1, 0, "tab-quelltext");
  await expect(page.locator(".cm-tabelle")).toHaveCount(0);
  await expect(page.locator(".cm-line", { hasText: "| Anna" })).toHaveCount(1);
  // Cursor hinaus: wieder Tabelle
  await auswahl(page, (await dok(page)).length);
  await expect(page.locator(".cm-tabelle")).toHaveCount(1);
  await zelle(page, 0, 0).click({ button: "right" });
  await page.locator('.menue [data-menue="tab-loeschen"]').click();
  await expect(page.locator(".cm-tabelle")).toHaveCount(0);
  expect(await dok(page)).not.toContain("|");
  await bild(page, "tabelle-geloescht", "hell");
});

test("Tabelle: Kontextmenü sieht in hell und dunkel richtig aus", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  for (const thema of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: thema });
    await zelle(page, 1, 1).click({ button: "right" });
    await expect(page.locator(".menue")).toBeVisible();
    await page.waitForTimeout(300); // Einblenden abwarten
    if (BILDER) {
      mkdirSync(BILDER, { recursive: true });
      const m = await page.locator(".menue").boundingBox(), t = await page.locator(".cm-tabelle").boundingBox();
      const x = Math.max(0, Math.min(m.x, t.x) - 20), y = Math.max(0, Math.min(m.y, t.y) - 20);
      await page.screenshot({ path: join(BILDER, `tabelle-menue-${thema === "dark" ? "dunkel" : "hell"}.png`), clip: { x, y, width: Math.min(1440 - x, Math.max(m.x + m.width, t.x + t.width) - x + 20), height: Math.max(m.y + m.height, t.y + t.height) - y + 20 } });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".menue")).toHaveCount(0);
  }
});

test("Tabelle: neue Zeile über die Schaltfläche unter der Tabelle", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  await page.locator(".cm-tabelle-huelle").hover();
  await page.locator(".cm-tab-plus").click();
  await expect(zelle(page, 3, 0)).toBeFocused();
  expect((await zellenTexte(page)).length).toBe(4);
});

test("Tabelle einfügen: Palette und Kürzel, Cursor in der ersten Überschrift; Rohtext-Modus markiert den Text", async ({ page }) => {
  schreibe("10_notizen/leer.md", "# Leer\n\nEin Absatz.\n\nLetzter.\n");
  await oeffne(page, "10_notizen/leer.md");
  await auswahl(page, "# Leer\n\nEin Absatz.".length);
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Tabelle einfügen");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-tabelle")).toHaveCount(1);
  await expect(zelle(page, 0, 0)).toBeFocused();
  expect(await dok(page)).toBe("# Leer\n\nEin Absatz.\n\n| Spalte 1 | Spalte 2 | Spalte 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n|          |          |          |\n\nLetzter.\n");
  await page.keyboard.type("Wer");
  await expect(zelle(page, 0, 0)).toHaveText("Wer");
  await warteGespeichert(page);
  // Kürzel am Ende der Notiz (Zeile mit Text)
  await auswahl(page, (await dok(page)).length - 1);
  await page.keyboard.press("Alt+Shift+Meta+t");
  await expect(page.locator(".cm-tabelle")).toHaveCount(2);
  expect((await dok(page)).match(/\| Spalte 1 \|/g).length).toBe(1);
});

test("Tabelle im Rohtext: Tab und ⇧Tab springen von Zelle zu Zelle und richten aus, Enter fügt eine Zeile ein", async ({ page }) => {
  schreibe("10_notizen/tab.md", "# Roh\n\n| a | b |\n|-|-|\n| 1 | langer Inhalt |\n");
  await oeffne(page, "10_notizen/tab.md");
  await page.click("#w-roh");
  await expect(page.locator(".cm-tabelle")).toHaveCount(0);
  await expect(page.locator(".cm-line", { hasText: "langer Inhalt" })).toHaveCount(1);
  await auswahl(page, "# Roh\n\n| ".length); // in der Zelle „a“
  await page.keyboard.press("Tab");
  expect(await dok(page)).toBe("# Roh\n\n| a   | b             |\n| --- | ------------- |\n| 1   | langer Inhalt |\n");
  expect(await auswahlText(page)).toBe("b");
  await page.keyboard.press("Tab");
  expect(await auswahlText(page)).toBe("1");
  await page.keyboard.press("Shift+Tab");
  expect(await auswahlText(page)).toBe("b");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); // 1 → langer Inhalt → neue Zeile
  expect((await dok(page)).split("\n").filter((z) => z.startsWith("|")).length).toBe(4);
  await page.keyboard.type("neu");
  await page.keyboard.press("Enter");
  const zeilen = (await dok(page)).split("\n").filter((z) => z.startsWith("|"));
  expect(zeilen.length).toBe(5);
  expect(zeilen[4]).toMatch(/^\|\s+\|\s+\|$/);
  // zurück zur Vorschau: wieder eine Tabelle
  await page.click("#w-roh");
  await auswahl(page, 0);
  await expect(page.locator(".cm-tabelle")).toHaveCount(1);
});

test("Tabelle: Pfeil nach oben/unten verlässt sie, CRLF-Dateien bleiben CRLF", async ({ page }) => {
  schreibe("10_notizen/crlf-tab.md", "# T\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\nEnde\r\n");
  await oeffne(page, "10_notizen/crlf-tab.md");
  await zelle(page, 1, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await warteGespeichert(page);
  const datei = lese("10_notizen/crlf-tab.md");
  expect(JSON.stringify(datei)).toBe(JSON.stringify("# T\r\n\r\n| a   | b   |\r\n| --- | --- |\r\n| 1x  | 2   |\r\n\r\nEnde\r\n"));
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.type("!");
  await warteGespeichert(page);
  expect(lese("10_notizen/crlf-tab.md")).toContain("\r\n!\r\n".replace("!", "!Ende".slice(0, 1)) ) ;
});

// ------------------------------------------------------------------ Formatieren
const taste = (page, k) => page.keyboard.press(k);
const ZEILE = "# Titel\n\nein Wort und mehr Text\n";

test("Format: ⌘B, ⌘I, ⇧⌘C (Code), ⇧⌘X (durchgestrichen) schalten Auswahl und Wort am Cursor um", async ({ page }) => {
  schreibe("10_notizen/f.md", ZEILE);
  await oeffne(page, "10_notizen/f.md");
  const p0 = "# Titel\n\n".length;
  await auswahl(page, p0 + 4, p0 + 8); // „Wort“
  await taste(page, "Meta+b");
  expect(await dok(page)).toBe("# Titel\n\nein **Wort** und mehr Text\n");
  expect(await auswahlText(page)).toBe("Wort"); // Auswahl bleibt innen: ein zweiter Druck nimmt es zurück
  await taste(page, "Meta+b");
  expect(await dok(page)).toBe(ZEILE);
  await taste(page, "Meta+i");
  expect(await dok(page)).toBe("# Titel\n\nein *Wort* und mehr Text\n");
  await taste(page, "Meta+i");
  await taste(page, "Shift+Meta+c");
  expect(await dok(page)).toBe("# Titel\n\nein `Wort` und mehr Text\n");
  await taste(page, "Shift+Meta+c");
  await taste(page, "Shift+Meta+x");
  expect(await dok(page)).toBe("# Titel\n\nein ~~Wort~~ und mehr Text\n");
  await taste(page, "Shift+Meta+x");
  expect(await dok(page)).toBe(ZEILE);
  // am Cursor ohne Auswahl: das Wort
  await auswahl(page, p0 + 6);
  await taste(page, "Meta+b");
  expect(await dok(page)).toBe("# Titel\n\nein **Wort** und mehr Text\n");
  await taste(page, "Meta+b"); // Cursor im fetten Wort: zurück
  expect(await dok(page)).toBe(ZEILE);
  // Cursor in einer leeren Zeile: zwei Marken, der Cursor steht dazwischen
  await auswahl(page, "# Titel\n".length);
  await taste(page, "Meta+b");
  expect(await dok(page)).toBe("# Titel\n****\nein Wort und mehr Text\n");
  await page.keyboard.type("x");
  expect(await dok(page)).toBe("# Titel\n**x**\nein Wort und mehr Text\n");
});

test("Format: Link (⌘L), markierte Adresse, Link am Cursor auflösen", async ({ page }) => {
  schreibe("10_notizen/f.md", "# Titel\n\nSiehe Kortex und https://example.org/a.\n");
  await oeffne(page, "10_notizen/f.md");
  const p0 = "# Titel\n\n".length;
  await auswahl(page, p0 + 6, p0 + 12); // „Kortex“
  await taste(page, "Meta+l");
  expect(await dok(page)).toBe("# Titel\n\nSiehe [Kortex](https://) und https://example.org/a.\n");
  expect(await auswahlText(page)).toBe("https://"); // die Adresse ist zum Überschreiben markiert
  await page.keyboard.type("kortex.app");
  expect(await dok(page)).toContain("[Kortex](kortex.app)");
  await taste(page, "Meta+l"); // Cursor im Link: Link auflösen
  expect(await dok(page)).toBe("# Titel\n\nSiehe Kortex und https://example.org/a.\n");
  const t = await dok(page);
  const a = t.indexOf("https://example.org/a");
  await auswahl(page, a, a + "https://example.org/a".length);
  await taste(page, "Meta+l");
  expect(await dok(page)).toContain("[Linktext](https://example.org/a)");
  expect(await auswahlText(page)).toBe("Linktext");
});

test("Format: Überschriften ⌥⇧⌘1–4 (noch einmal = Absatz), Listen ⇧⌘8/7/9 schalten Zeilen um", async ({ page }) => {
  schreibe("10_notizen/f.md", "erste Zeile\nzweite Zeile\ndritte Zeile\n");
  await oeffne(page, "10_notizen/f.md");
  await auswahl(page, 3);
  await taste(page, "Alt+Shift+Meta+2");
  expect(await dok(page)).toBe("## erste Zeile\nzweite Zeile\ndritte Zeile\n");
  await taste(page, "Alt+Shift+Meta+3");
  expect((await dok(page)).split("\n")[0]).toBe("### erste Zeile");
  await taste(page, "Alt+Shift+Meta+3");
  expect((await dok(page)).split("\n")[0]).toBe("erste Zeile");
  await taste(page, "Alt+Shift+Meta+1");
  expect((await dok(page)).split("\n")[0]).toBe("# erste Zeile");
  await taste(page, "Alt+Shift+Meta+4");
  expect((await dok(page)).split("\n")[0]).toBe("#### erste Zeile");
  await taste(page, "Alt+Shift+Meta+4");
  // Auswahl über alle Zeilen: Aufzählung, Nummerierung, Aufgaben, dann wieder aus
  await auswahl(page, 0, (await dok(page)).length - 1);
  await taste(page, "Shift+Meta+8");
  expect(await dok(page)).toBe("- erste Zeile\n- zweite Zeile\n- dritte Zeile\n");
  await taste(page, "Shift+Meta+7");
  expect(await dok(page)).toBe("1. erste Zeile\n2. zweite Zeile\n3. dritte Zeile\n");
  await taste(page, "Shift+Meta+9");
  expect(await dok(page)).toBe("- [ ] erste Zeile\n- [ ] zweite Zeile\n- [ ] dritte Zeile\n");
  await taste(page, "Shift+Meta+9");
  expect(await dok(page)).toBe("erste Zeile\nzweite Zeile\ndritte Zeile\n");
  // Überschrift auf Listenpunkt ersetzt die Marke
  await auswahl(page, 2);
  await taste(page, "Shift+Meta+8");
  await taste(page, "Alt+Shift+Meta+2");
  expect((await dok(page)).split("\n")[0]).toBe("## erste Zeile");
});

test("Format: Rückgängig macht eine Formatierung in einem Schritt rückgängig; im Schreibschutz tut sich nichts", async ({ page }) => {
  schreibe("10_notizen/f.md", ZEILE);
  await oeffne(page, "10_notizen/f.md");
  const p0 = "# Titel\n\n".length;
  await auswahl(page, p0, p0 + 3);
  await taste(page, "Meta+b");
  expect(await dok(page)).toContain("**ein**");
  await taste(page, "Meta+z");
  expect(await dok(page)).toBe(ZEILE);
});

test("Format: ⌘B und ⌘I in einer Tabellenzelle wirken auf den Text der Zelle", async ({ page }) => {
  schreibe("10_notizen/tab.md", TAB);
  await oeffne(page, "10_notizen/tab.md");
  await zelle(page, 1, 0).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await taste(page, "Meta+b");
  expect(await dok(page)).toContain("| **Anna** |");
  await taste(page, "Meta+b");
  expect(await dok(page)).toContain("| Anna ");
  expect(await dok(page)).not.toContain("**");
  await taste(page, "Meta+i");
  expect(await dok(page)).toContain("*Anna*");
});

// ------------------------------------------------------------------ Einfügen
// Einfügen wie aus der Zwischenablage: ein echtes paste-Ereignis mit text/html und text/plain
const fuegeEin = (page, { html = "", text = "", dateien = false }) => page.evaluate(({ html, text }) => {
  const dt = new DataTransfer();
  if (html) dt.setData("text/html", html);
  if (text) dt.setData("text/plain", text);
  const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector(".cm-content").dispatchEvent(e);
  return e.defaultPrevented;
}, { html, text });

const WORD_HTML = `<html><body><!--StartFragment--><h1 style="margin-top:12pt"><span>Projekt<o:p></o:p></span></h1><p class=MsoNormal>Ein <b>wichtiger</b> Absatz mit <a href="https://example.org/x">Link</a>.<o:p></o:p></p><table border=1><tr><td><p>Name</p></td><td><p>Rolle</p></td></tr><tr><td><p>Anna</p></td><td><p>Leitung</p></td></tr></table><script>window.__boese = 1</script><style>p{color:red}</style><!--EndFragment--></body></html>`;

test("Einfügen: HTML aus Word/Web wird sauberes Markdown (Überschrift, fett, Link, Tabelle), ohne Skript und Style", async ({ page }) => {
  schreibe("10_notizen/e.md", "# E\n\nAnfang: \n");
  await oeffne(page, "10_notizen/e.md");
  await auswahl(page, "# E\n\n".length);
  await page.keyboard.press("Meta+ArrowRight"); // ans Zeilenende
  const verhindert = await fuegeEin(page, { html: WORD_HTML, text: "Projekt\nEin wichtiger Absatz mit Link.\nName\tRolle" });
  expect(verhindert).toBe(true);
  const t = await dok(page);
  expect(t).toBe("# E\n\nAnfang: \n\n# Projekt\n\nEin **wichtiger** Absatz mit [Link](https://example.org/x).\n\n| Name | Rolle |\n| --- | --- |\n| Anna | Leitung |\n");
  expect(t).not.toMatch(/boese|<|color:red/);
  expect(await page.evaluate(() => window.__boese)).toBeUndefined();
});

test("Einfügen: reiner Text bleibt reiner Text; HTML ohne Struktur (Code aus einem Editor) auch", async ({ page }) => {
  schreibe("10_notizen/e.md", "# E\n\n");
  await oeffne(page, "10_notizen/e.md");
  await auswahl(page, "# E\n\n".length);
  await fuegeEin(page, { html: '<meta charset="utf-8"><div style="font-family:Menlo;white-space:pre"><span style="color:#fff">const a = 1;</span></div>', text: "const a = 1;" });
  expect(await dok(page)).toBe("# E\n\nconst a = 1;");
  await fuegeEin(page, { text: " *nur* Text_" });
  expect(await dok(page)).toBe("# E\n\nconst a = 1; *nur* Text_");
});

test("Einfügen: ⇧⌘V (nur Text) ignoriert das HTML genau einmal; Adresse über markiertem Text wird ein Link", async ({ page }) => {
  schreibe("10_notizen/e.md", "# E\n\nLink-Text hier\n");
  await oeffne(page, "10_notizen/e.md");
  await auswahl(page, "# E\n\n".length);
  await page.evaluate(() => window.studio.ed.merkeNurText());
  await fuegeEin(page, { html: "<p><b>fett</b> und <a href='https://x.org'>Link</a></p>", text: "fett und Link" });
  expect(await dok(page)).toBe("# E\n\nfett und LinkLink-Text hier\n");
  // danach gilt wieder die Umwandlung
  await auswahl(page, 0);
  await fuegeEin(page, { html: "<p><b>fett</b></p>", text: "fett" });
  expect((await dok(page)).startsWith("**fett**")).toBe(true);
  // markierter Text + Adresse
  const t = await dok(page);
  const a = t.indexOf("Link-Text");
  await auswahl(page, a, a + 9);
  await fuegeEin(page, { text: "https://example.org/seite" });
  expect(await dok(page)).toContain("[Link-Text](https://example.org/seite)");
});

test("Einfügen: in einem Codeblock bleibt HTML unberührt (Standard: reiner Text)", async ({ page }) => {
  schreibe("10_notizen/e.md", "```\nx\n```\n");
  await oeffne(page, "10_notizen/e.md");
  await auswahl(page, 5);
  await fuegeEin(page, { html: "<p><b>fett</b></p>", text: "fett" });
  expect(await dok(page)).toBe("```\nxfett\n```\n");
});

test("Einfügen: Tabelle aus HTML mitten in einer Zeile beginnt in einer eigenen Zeile", async ({ page }) => {
  schreibe("10_notizen/e.md", "# E\n\nText davor\n");
  await oeffne(page, "10_notizen/e.md");
  await auswahl(page, "# E\n\nText".length);
  await fuegeEin(page, { html: "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>", text: "A\tB\n1\t2" });
  expect(await dok(page)).toBe("# E\n\nText\n\n| A | B |\n| --- | --- |\n| 1 | 2 | davor\n");
});

// ------------------------------------------------------------------ Format-Leiste
test("Format-Leiste: erscheint über markiertem Text, Knöpfe formatieren, zeigt den Zustand; hell und dunkel", async ({ page }) => {
  schreibe("10_notizen/f.md", ZEILE);
  await oeffne(page, "10_notizen/f.md");
  const leiste = page.locator(".format-leiste");
  const p0 = "# Titel\n\n".length;
  await expect(leiste).toHaveCount(0);
  await auswahl(page, p0 + 4, p0 + 8);
  await expect(leiste).toHaveAttribute("data-offen", "ja");
  // sie liegt über der Auswahl, nicht darauf
  const lb = await leiste.boundingBox();
  const sel = await imEditor(page, ({ view }) => { const c = view.coordsAtPos(view.state.selection.main.from); return { top: c.top, left: c.left }; });
  expect(lb.y + lb.height).toBeLessThanOrEqual(sel.top);
  await page.emulateMedia({ colorScheme: "light" });
  await bild(page, "format-leiste", "hell");
  await leiste.locator('[data-befehl="fett"]').click();
  expect(await dok(page)).toBe("# Titel\n\nein **Wort** und mehr Text\n");
  await expect(page.locator(".cm-content")).toBeFocused(); // der Editor behält den Fokus
  expect(await auswahlText(page)).toBe("Wort");
  await expect(leiste.locator('[data-befehl="fett"]')).toHaveAttribute("aria-pressed", "true");
  await leiste.locator('[data-befehl="fett"]').click();
  expect(await dok(page)).toBe(ZEILE);
  await page.emulateMedia({ colorScheme: "dark" });
  await bild(page, "format-leiste", "dunkel");
  await leiste.locator('[data-befehl="ueberschrift2"]').click();
  expect((await dok(page)).split("\n")[2]).toBe("## ein Wort und mehr Text");
  await expect(leiste.locator('[data-befehl="ueberschrift2"]')).toHaveAttribute("aria-pressed", "true");
  await leiste.locator('[data-befehl="listeAufgabe"]').click();
  expect((await dok(page)).split("\n")[2]).toBe("- [ ] ein Wort und mehr Text");
  // ohne Auswahl keine Leiste
  await auswahl(page, 2);
  await expect(leiste).toHaveAttribute("data-offen", "nein");
});

test("Format-Leiste: Maustaste gedrückt (Ziehen) zeigt sie noch nicht, danach erscheint sie; Esc blendet aus", async ({ page }) => {
  schreibe("10_notizen/f.md", ZEILE);
  await oeffne(page, "10_notizen/f.md");
  const leiste = page.locator(".format-leiste");
  const zeile = page.locator(".cm-line", { hasText: "ein Wort" });
  const b = await zeile.boundingBox();
  await page.mouse.move(b.x + 5, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + b.height / 2, { steps: 4 });
  await expect(page.locator('.format-leiste[data-offen="ja"]')).toHaveCount(0); // während des Ziehens bleibt sie weg
  await page.mouse.up();
  await expect(leiste).toHaveAttribute("data-offen", "ja");
  await page.keyboard.press("ArrowRight"); // Auswahl aufgehoben
  await expect(leiste).toHaveAttribute("data-offen", "nein");
});

test("Format-Leiste: abgeschaltet in der Datei (formatLeiste: false) erscheint sie nie, die Kürzel gelten weiter", async ({ page }) => {
  writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify({ formatLeiste: false }));
  schreibe("10_notizen/f.md", ZEILE);
  await oeffne(page, "10_notizen/f.md");
  const p0 = "# Titel\n\n".length;
  await auswahl(page, p0 + 4, p0 + 8);
  await page.waitForTimeout(300);
  await expect(page.locator(".format-leiste")).toHaveCount(0);
  await taste(page, "Meta+b");
  expect(await dok(page)).toContain("**Wort**");
});

test("Format-Leiste: Schalter unter Einstellungen → Darstellung schreibt formatLeiste in die Datei und blendet die Leiste aus", async ({ page }) => {
  schreibe("10_notizen/f.md", ZEILE);
  await oeffne(page, "10_notizen/f.md");
  const p0 = "# Titel\n\n".length;
  await auswahl(page, p0 + 4, p0 + 8);
  await expect(page.locator(".format-leiste")).toHaveAttribute("data-offen", "ja");
  await page.evaluate(() => { location.hash = "#einstellungen/darstellung"; });
  const schalter = page.locator('[data-zeile="format-leiste"] [role="switch"]');
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  if (BILDER) { mkdirSync(BILDER, { recursive: true }); await page.locator('[data-zeile="format-leiste"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(BILDER, "einstellung-format-leiste-hell.png") }); }
  await schalter.click();
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => JSON.parse(readFileSync(join(server.support, "einstellungen.json"), "utf8")).formatLeiste).toBe(false);
  await page.evaluate(() => { location.hash = ""; });
  await auswahl(page, p0 + 4, p0 + 9);
  await page.waitForTimeout(300);
  await expect(page.locator(".format-leiste")).not.toHaveAttribute("data-offen", "ja");
});
