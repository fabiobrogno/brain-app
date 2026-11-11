// Schrägstrich-Menü im Editor: Öffnen, Filtern (deutsch/englisch), Wählen je Eintragsart, Esc, nicht in Code/Datei-Kopf/Wort, ⌘Z als eine Transaktion,
// „Nichts gefunden“ ohne Höhensprung, Platz unten, Mitgehen beim Scrollen, Zoom, Barrierefreiheit, hell und dunkel.
// Echter Server, echter Vault (Wegwerf-Kopie), echter Editor. UI_SHOTS=<Ordner>: Seitenfotos (nie der Bildschirm).
import { test, expect } from "./basis.mjs";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { heuteText } from "../../Ressourcen/studio/schraegstrich-logik.js";

let vault, server, seitenfehler;
test.beforeEach(async () => { seitenfehler = []; ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

const BILDER = process.env.UI_SHOTS;
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
const NOTIZ = "10_notizen/slash.md";
async function oeffne(page, text = "Anfang\n\n") {
  schreibe(NOTIZ, "x\n");
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await setze(page, text);
}
const imEditor = async (page, f, arg) => {
  const h = await page.evaluateHandle(async () => {
    const CM = await import("/vendor/codemirror.bundle.js");
    return { CM, view: CM.EditorView.findFromDOM(document.querySelector(".cm-editor")) };
  });
  try { return await h.evaluate(f, arg); } finally { await h.dispose(); }
};
const dok = (page) => imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length));
// Text setzen, Cursor ans Ende (oder an pos), Fokus in den Editor
const setze = (page, text, pos = null) => imEditor(page, ({ view }, [t, p]) => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t }, selection: { anchor: p ?? t.length } });
  view.focus();
}, [text, pos]);
const menue = (page) => page.locator(".sm[data-offen='ja']");
const eintraege = (page) => page.locator(".sm [role=option][data-eintrag]");
const namen = (page) => eintraege(page).locator(".sm-name").allTextContents();
const bild = async (page, name, thema) => {
  if (!BILDER) return;
  mkdirSync(BILDER, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(BILDER, `slash-${name}-${thema}.png`), clip: await page.locator("#editor").boundingBox() });
};
const beideThemen = async (page, name, pruefe) => {
  for (const thema of ["hell", "dunkel"]) {
    await page.emulateMedia({ colorScheme: thema === "hell" ? "light" : "dark" });
    await page.waitForTimeout(120);
    if (pruefe) await pruefe(thema);
    await bild(page, name, thema);
  }
};

// ------------------------------------------------------------------ Öffnen, Filtern, Wählen
test("Öffnen: „/“ in leerer Zeile zeigt alle Einträge gruppiert; Rücktaste bis vor „/“ schließt; Klick außerhalb schließt", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/");
  await expect(menue(page)).toBeVisible();
  expect(await namen(page)).toEqual(["Text", "Überschrift 1", "Überschrift 2", "Überschrift 3", "Aufgabe", "Aufzählung", "Nummerierung", "Zitat", "Callout", "Codeblock", "Trennlinie", "Tabelle", "Bild oder Datei", "Link zu Notiz", "Datum heute"]);
  await expect(page.locator(".sm-kopf")).toHaveText(["Text", "Listen", "Blöcke", "Einfügen"]);
  await expect(page.locator(".sm [role=listbox]")).toHaveCount(1);
  await expect(page.locator(".sm [role=option][aria-selected=true]")).toHaveCount(1);
  await page.keyboard.type("ta");
  await expect(menue(page)).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(menue(page)).toBeVisible(); // „/“ steht noch
  await page.keyboard.press("Backspace");
  await expect(menue(page)).toHaveCount(0);
  expect(await dok(page)).toBe("Anfang\n\n");
  // nach Leerzeichen in einer Zeile mit Text
  await page.keyboard.type("Wort /");
  await expect(menue(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(menue(page)).toHaveCount(0);
  expect(await dok(page)).toBe("Anfang\n\nWort /");
});

test("Filtern: unscharf, deutsch und englisch (h2, überschrift, todo, tabelle, table, ueberschrift)", async ({ page }) => {
  await oeffne(page);
  const filter = async (text) => { await setze(page, "Anfang\n\n"); await page.keyboard.type("/" + text); return namen(page); };
  expect((await filter("h2"))[0]).toBe("Überschrift 2");
  expect(await filter("überschrift")).toEqual(["Überschrift 1", "Überschrift 2", "Überschrift 3"]);
  expect(await filter("ueberschrift")).toEqual(["Überschrift 1", "Überschrift 2", "Überschrift 3"]);
  expect((await filter("todo"))[0]).toBe("Aufgabe");
  expect((await filter("tabelle"))[0]).toBe("Tabelle");
  expect((await filter("table"))[0]).toBe("Tabelle");
  expect((await filter("quote"))[0]).toBe("Zitat");
  expect((await filter("bild"))[0]).toBe("Bild oder Datei");
  expect((await filter("heute"))[0]).toBe("Datum heute");
  expect((await filter("tbl"))[0]).toBe("Tabelle"); // unscharf: Buchstaben in Reihenfolge
  await expect(page.locator(".sm-kopf")).toHaveCount(0); // gefiltert: eine Liste nach Treffer, keine Gruppenköpfe
});

const ANFANG = "Anfang\n\n";
const WAHL = [
  { name: "Text", dok: "## Alt ", tippe: "text", erwartet: "Alt " },
  { name: "Überschrift 1", tippe: "h1", erwartet: ANFANG + "# " },
  { name: "Überschrift 2", tippe: "h2", erwartet: ANFANG + "## " },
  { name: "Überschrift 3", tippe: "h3", erwartet: ANFANG + "### " },
  { name: "Aufgabe", tippe: "todo", erwartet: ANFANG + "- [ ] " },
  { name: "Aufzählung", tippe: "aufz", erwartet: ANFANG + "- " },
  { name: "Nummerierung", tippe: "nummer", erwartet: ANFANG + "1. " },
  { name: "Zitat", tippe: "zitat", erwartet: ANFANG + "> " },
  { name: "Callout", tippe: "callout", erwartet: ANFANG + "> [!note] \n> \n" },
  { name: "Codeblock", tippe: "codeblock", erwartet: ANFANG + "```\n\n```\n" },
  { name: "Trennlinie", tippe: "trenn", erwartet: ANFANG + "---\n" },
  { name: "Datum heute", tippe: "datum", erwartet: () => ANFANG + heuteText() },
];
for (const w of WAHL) {
  test(`Wählen: ${w.name} (⏎) setzt den Text in EINER Transaktion; ⌘Z stellt den Zustand davor her`, async ({ page }) => {
    await oeffne(page, w.dok || ANFANG);
    await page.keyboard.type("/" + w.tippe);
    await expect(menue(page)).toBeVisible();
    await expect(eintraege(page).first().locator(".sm-name")).toHaveText(w.name);
    const vorWahl = await dok(page);
    await page.keyboard.press("Enter");
    await expect(menue(page)).toHaveCount(0);
    expect(await dok(page)).toBe(typeof w.erwartet === "function" ? w.erwartet() : w.erwartet);
    expect(await dok(page)).not.toContain("/");
    await page.keyboard.press("Meta+z");
    expect(await dok(page)).toBe(vorWahl); // vor dem Einfügen: das „/Filter“ steht wieder da
  });
}

test("Wählen: Aufzählung per Tab und per Klick; Pfeiltasten wählen", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); // Überschrift 2
  await expect(page.locator(".sm [aria-selected=true] .sm-name")).toHaveText("Überschrift 2");
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); // um das Ende herum: Datum
  await expect(page.locator(".sm [aria-selected=true] .sm-name")).toHaveText("Datum heute");
  await page.keyboard.press("Backspace"); // „/“ weg, Menü zu
  await page.keyboard.type("/aufz");
  await page.keyboard.press("Tab");
  expect(await dok(page)).toBe(ANFANG + "- ");
  await setze(page, ANFANG);
  await page.keyboard.type("/");
  await page.locator(".sm [data-eintrag=zitat]").click();
  expect(await dok(page)).toBe(ANFANG + "> ");
  await expect(menue(page)).toHaveCount(0);
});

test("Wählen: Zeile mit Text und Listen: Präfix ersetzt, Einzug bleibt; Block hinter Text mit Leerzeile", async ({ page }) => {
  await oeffne(page, "# Titel\n\n  - Punkt ");
  await page.keyboard.type("/todo");
  await page.keyboard.press("Enter");
  expect(await dok(page)).toBe("# Titel\n\n  - [ ] Punkt ");
  await setze(page, "Absatz ");
  await page.keyboard.type("/trenn");
  await page.keyboard.press("Enter");
  expect(await dok(page)).toBe("Absatz \n\n---\n");
  await setze(page, "Absatz /\n\nNach");
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
  await setze(page, "Absatz ");
  await page.keyboard.type("/code");
  await page.keyboard.press("Enter");
  expect(await dok(page)).toBe("Absatz \n\n```\n\n```\n");
});

test("Wählen: Tabelle (vorhandene Logik), Cursor in der ersten Zelle; ⌘Z entfernt die Tabelle samt Eingabe in einem Schritt", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-tabelle")).toHaveCount(1);
  expect(await dok(page)).toContain("| Spalte 1 |");
  expect(await dok(page)).not.toContain("/");
  await expect(page.locator(".cm-tabelle .cm-tz:focus")).toHaveCount(1);
  await page.locator(".cm-content").focus();
  await imEditor(page, ({ view }) => view.focus());
  await page.keyboard.press("Meta+z");
  expect(await dok(page)).toBe(ANFANG + "/table");
});

test("Wählen: Bild/Datei öffnet den Dateidialog der Hülle und legt den Anhang ab", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/bild");
  const dialog = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const wahl = await dialog;
  await wahl.setFiles({ name: "notizzettel.txt", mimeType: "text/plain", buffer: Buffer.from("Hallo aus dem Dateidialog") });
  await expect.poll(() => dok(page)).toContain("![[");
  expect(await dok(page)).not.toContain("/bild");
  await expect.poll(() => readdirSync(join(vault, "_anhaenge")).filter((n) => n.endsWith("notizzettel.txt")).length).toBe(1);
});

test("Wählen: Link zu Notiz setzt „[[]]“ und öffnet die Vorschläge für Notizen", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/link");
  await page.keyboard.press("Enter");
  expect(await dok(page)).toBe(ANFANG + "[[]]");
  await expect(page.locator(".cm-tooltip-autocomplete.cm-wikiliste")).toBeVisible();
  await page.keyboard.type("Kaff");
  await expect(page.locator(".cm-tooltip-autocomplete li").first()).toContainText("Kaffee");
  await page.keyboard.press("Enter");
  expect(await dok(page)).toBe(ANFANG + "[[Kaffee]]");
});

// ------------------------------------------------------------------ Esc und Orte, an denen es kein Menü gibt
test("Esc schließt, das „/…“ bleibt stehen und das Weitertippen öffnet es nicht neu; ein neues „/“ schon", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/h2");
  await expect(menue(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menue(page)).toHaveCount(0);
  expect(await dok(page)).toBe(ANFANG + "/h2");
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await expect(menue(page)).toHaveCount(0);
  await page.keyboard.type(" /");
  await expect(menue(page)).toBeVisible();
});

const NICHT = [
  ["im Codeblock", "```js\nlet a = 1;\n", "x /"],
  ["im Codeblock (offen am Ende, nach Leerzeile)", "```\n\n", "/"],
  ["im Inline-Code", "`a ", "/"],
  ["im Datei-Kopf", "---\ntitel: A\ntags: [a]\n---\nText\n", "/", 24],
  ["mitten im Wort (und/oder)", "Kaffee und", "/oder"],
  ["in einer Adresse (https://)", "Siehe https:", "//kortex.example/pfad"],
  ["in einem Pfad (a/b)", "Ordner a", "/b"],
  ["im Wikilink", "Text [[Seite /", "x"],
  ["vor einem Wort (Cursor mitten im Wort)", "ab cd", "/", 5],
];
for (const [titel, text, tippe, pos] of NICHT) {
  test(`Kein Menü ${titel}`, async ({ page }) => {
    await oeffne(page, text);
    if (pos !== undefined) await setze(page, text, pos);
    await page.keyboard.type(tippe);
    await page.waitForTimeout(150);
    await expect(menue(page)).toHaveCount(0);
  });
}

test("Beim Bewegen in ein vorhandenes „/…“ öffnet sich nichts; Einfügen von Text mit „/“ auch nicht", async ({ page }) => {
  await oeffne(page, "Satz /h2 Ende");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  await expect(menue(page)).toHaveCount(0);
  await setze(page, "A ");
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData("text/plain", "/");
    document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  await expect(menue(page)).toHaveCount(0);
});

// ------------------------------------------------------------------ Höhe, Lage, Mitgehen
test("„Nichts gefunden“: eine Zeile, das Menü bleibt gleich hoch und an derselben Stelle", async ({ page }) => {
  await oeffne(page);
  await page.keyboard.type("/tab");
  await expect(eintraege(page)).toHaveCount(1);
  await page.waitForTimeout(150); // die Lage wird nach dem Update gemessen: erst danach steht sie
  const vorher = await page.locator(".sm").boundingBox();
  await page.keyboard.type("x");
  await expect(page.locator(".sm-leer")).toHaveText("Nichts gefunden");
  await expect(eintraege(page)).toHaveCount(0);
  await page.waitForTimeout(150);
  const nachher = await page.locator(".sm").boundingBox();
  expect(Math.abs(nachher.height - vorher.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(nachher.y - vorher.y)).toBeLessThanOrEqual(1);
  // ohne Treffer gehen Tasten an den Editor: ⏎ macht einen Zeilenumbruch und das Menü geht zu
  await page.keyboard.press("Enter");
  await expect(menue(page)).toHaveCount(0);
  expect(await dok(page)).toBe(ANFANG + "/tabx\n");
});

test("Am unteren Fensterrand klappt das Menü nach oben (und bleibt beim Filtern an der Schreibmarke); sonst nach unten", async ({ page }) => {
  const lang = Array.from({ length: 120 }, (_, i) => `Zeile ${i + 1}`).join("\n\n") + "\n\n";
  await oeffne(page, lang);
  await imEditor(page, ({ CM, view }) => { view.dispatch({ effects: CM.EditorView.scrollIntoView(view.state.doc.length, { y: "end", yMargin: 6 }) }); view.focus(); });
  await page.keyboard.type("/");
  await expect(menue(page)).toBeVisible();
  await expect(page.locator(".sm")).toHaveAttribute("data-seite", "oben");
  const caret = await imEditor(page, ({ view }) => { const c = view.coordsAtPos(view.state.selection.main.head - 1); return { top: c.top, bottom: c.bottom }; });
  const m = await page.locator(".sm").boundingBox();
  expect(m.y + m.height).toBeLessThanOrEqual(caret.top + 1);
  expect(m.y).toBeGreaterThanOrEqual(0);
  const untenVorher = m.y + m.height;
  await beideThemen(page, "unten-rand-offen");
  await page.keyboard.type("tab");
  await expect(eintraege(page)).toHaveCount(1);
  const m2 = await page.locator(".sm").boundingBox();
  expect(Math.abs(m2.y + m2.height - untenVorher)).toBeLessThanOrEqual(1); // die Unterkante bleibt an der Schreibmarke, das Menü schrumpft nach unten
  await beideThemen(page, "unten-rand");
  // oben im Text: nach unten
  await page.keyboard.press("Escape");
  await setze(page, ANFANG);
  await page.keyboard.type("/");
  await expect(page.locator(".sm")).toHaveAttribute("data-seite", "unten");
});

test("Beim Scrollen bleibt das Menü an der Schreibmarke; mit Oberflächen-Zoom 125 % sitzt es ebenfalls an ihr", async ({ page }) => {
  const lang = Array.from({ length: 120 }, (_, i) => `Zeile ${i + 1}`).join("\n\n") + "\n\n";
  await oeffne(page, lang);
  await imEditor(page, ({ view }) => { view.dispatch({ selection: { anchor: view.state.doc.line(40).from } }); view.focus(); });
  await imEditor(page, ({ view }) => { const l = view.lineBlockAt(view.state.selection.main.head); view.scrollDOM.scrollTop = l.top - 200; });
  await page.keyboard.type("/");
  await expect(menue(page)).toBeVisible();
  const abstand = async () => {
    const c = await imEditor(page, ({ view }) => { const r = view.coordsAtPos(view.state.selection.main.head - 1); return { top: r.top, bottom: r.bottom, left: r.left }; });
    const m = await page.locator(".sm").boundingBox();
    return { dy: Math.round(m.y - c.bottom), dx: Math.round(m.x - c.left) };
  };
  const a1 = await abstand();
  await imEditor(page, ({ view }) => { view.scrollDOM.scrollTop += 60; });
  await page.waitForTimeout(120);
  const a2 = await abstand();
  expect(Math.abs(a2.dy - a1.dy)).toBeLessThanOrEqual(2);
  expect(Math.abs(a1.dy)).toBeLessThan(14);
  // Zoom
  await page.evaluate(() => { document.documentElement.style.setProperty("--ui-zoom", "1.25"); window.dispatchEvent(new Event("resize")); });
  await page.waitForTimeout(250);
  const a3 = await abstand();
  expect(Math.abs(a3.dy)).toBeLessThan(16);
  expect(Math.abs(a3.dx)).toBeLessThan(6);
  // weggescrollt: Menü verschwindet aus dem Blick
  await imEditor(page, ({ view }) => { view.scrollDOM.scrollTop = 0; });
  await page.waitForTimeout(150);
  await expect(page.locator(".sm")).toHaveCSS("visibility", "hidden");
});

// ------------------------------------------------------------------ Zugänglichkeit und Erscheinung
test("Barrierefreiheit: listbox/option, aria-activedescendant folgt der Auswahl, Rollen werden danach zurückgesetzt", async ({ page }) => {
  await oeffne(page);
  const rolleVorher = await page.locator(".cm-content").getAttribute("role");
  await page.keyboard.type("/");
  const c = page.locator(".cm-content");
  const aktiv = async () => (await c.getAttribute("aria-activedescendant")) || "";
  const id0 = await aktiv();
  await expect(page.locator(`#${id0}`)).toHaveAttribute("aria-selected", "true");
  await expect(c).toHaveAttribute("aria-controls", /sm-liste-/);
  await page.keyboard.press("ArrowDown");
  const id1 = await aktiv();
  expect(id1).not.toBe(id0);
  await expect(page.locator(`#${id1}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`#${id0}`)).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".sm [role=option]").first()).toBeVisible();
  await expect(page.locator(".sm [role=group]")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(c).not.toHaveAttribute("aria-activedescendant", /.+/);
  await expect(c).not.toHaveAttribute("aria-controls", /.+/);
  expect(await c.getAttribute("role")).toBe(rolleVorher);
});

test("Hell und dunkel: Menü offen und gefiltert, „Nichts gefunden“; kein „null“ oder „undefined“ im Text; Fotos", async ({ page }) => {
  await oeffne(page, "# Planung\n\nEin Absatz zum Einstieg, damit das Menü über Text liegt.\n\n");
  await page.keyboard.type("/");
  await expect(menue(page)).toBeVisible();
  const kein = async () => { const t = await page.locator(".sm").innerText(); expect(t).not.toMatch(/null|undefined|NaN/); };
  await beideThemen(page, "offen", kein);
  await page.keyboard.type("ueb");
  await expect(eintraege(page)).toHaveCount(3);
  await beideThemen(page, "gefiltert", kein);
  await page.keyboard.type("zz");
  await expect(page.locator(".sm-leer")).toBeVisible();
  await beideThemen(page, "nichts", kein);
  // Kontrast: der gewählte Eintrag hebt sich vom Grund ab
  await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace");
  const farben = await page.locator(".sm-eintrag[aria-selected=true]").evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el.closest(".sm")).backgroundColor]);
  expect(farben[0]).not.toBe(farben[1]);
});
