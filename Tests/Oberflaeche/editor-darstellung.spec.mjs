// Editor-Darstellung vollständig (R4-2): Callouts (Arten, Falten, Rohtext am Cursor), Code-Blöcke (Farben hell/dunkel, Zäune nur am Cursor, Sprachmarke,
// Kopieren ohne Zäune), neue Notiz ohne nacktes „#“, Tabelle und Bild per Pfeiltasten ohne Sprung. Der gespeicherte Text ändert sich durch die Darstellung nie.
// UI_SHOTS=<Ordner> schreibt Fotos (r42-*.png).
import { test, expect } from "./basis.mjs";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

const BILDER = process.env.UI_SHOTS;
let vault, server, seitenfehler;
const schreibe = (p, text) => { mkdirSync(dirname(join(vault, p)), { recursive: true }); writeFileSync(join(vault, p), text); };
test.beforeEach(async () => { seitenfehler = []; ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

async function oeffne(page, pfad) {
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.stack); seitenfehler.push(e.message); });
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
const foto = async (page, name, wahl = "#editor") => { if (!BILDER) return; mkdirSync(BILDER, { recursive: true }); await page.locator(wahl).screenshot({ path: join(BILDER, `r42-${name}.png`) }); };
const schema = (farbe) => (farbe === "light" ? "hell" : "dunkel");

// Eine Farbe als Bild (zlib, ohne Abhängigkeit): echtes Bild mit Höhe, damit Sprünge messbar sind
function png(b, h, [r, g, bl]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (typ, d) => { const t = Buffer.concat([Buffer.from(typ), d]); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]); };
  const kopf = Buffer.alloc(13); kopf.writeUInt32BE(b, 0); kopf.writeUInt32BE(h, 4); kopf[8] = 8; kopf[9] = 2;
  const zeile = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: b }, () => [r, g, bl]).flat())]);
  const roh = Buffer.concat(Array.from({ length: h }, () => zeile));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", kopf), chunk("IDAT", deflateSync(roh)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- Callouts
const ARTEN = ["note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote"];
const ALIASE = { summary: "abstract", tldr: "abstract", hint: "tip", important: "tip", check: "success", done: "success", help: "question", faq: "question", caution: "warning", attention: "warning", fail: "failure", missing: "failure", error: "danger", cite: "quote", Tipp: "tip", NOTE: "note", unbekannt: "note" };
const calloutNotiz = [
  "# Callouts", "",
  ...ARTEN.flatMap((a) => [`> [!${a}] Titel ${a}`, `> Inhalt von ${a} mit **fett** und [[Link]]`, ""]),
  ...Object.keys(ALIASE).flatMap((a) => [`> [!${a}]`, `> Rumpf ${a}`, ""]),
  "> [!faq]- Zugeklappt per Minus", "> Versteckter Rumpf eins", "> Versteckter Rumpf zwei", "",
  "> [!tip]+ Offen per Plus", "> Sichtbarer Rumpf", "",
  "> Normales Zitat", "",
  "ENDE", "",
].join("\n");

for (const farbe of ["light", "dark"]) {
  test(`Callouts: alle Arten und Aliase gezeichnet, Titel, Falten, Rohtext am Cursor, Datei bleibt gleich (${schema(farbe)})`, async ({ page }) => {
    schreibe("10_notizen/co.md", calloutNotiz);
    await page.setViewportSize({ width: 1440, height: 4600 }); // die ganze Notiz im Fenster (der Editor zeichnet nur Sichtbares)
    await page.emulateMedia({ colorScheme: farbe });
    await oeffne(page, "10_notizen/co.md");
    const vorher = await dok(page);
    expect(vorher).toBe(calloutNotiz);
    for (const a of ARTEN) await expect(page.locator(`.cm-callout-${a}.cm-callout-anfang`).first(), `Art ${a}`).toBeAttached();
    // Standardtitel (deutsch) bei Kopf ohne Titel und Titel aus der Datei
    await expect(page.locator(".cm-callout-anfang", { hasText: "Titel tip" }).locator(".cm-callout-titel")).toHaveText("Titel tip");
    await expect(page.locator(".cm-callout-anfang.cm-callout-abstract", { hasText: "Zusammenfassung" }).first()).toBeAttached();
    await expect(page.locator(".cm-callout-anfang.cm-callout-note", { hasText: "Unbekannt" })).toBeAttached(); // unbekannter Typ = Notiz, Titel aus dem Typ
    // Alias zeichnet wie die Art
    for (const [alias, art] of Object.entries(ALIASE)) await expect(page.locator(`.cm-callout-${art} .cm-callout-symbol`).filter({ hasText: /./ }).first(), alias).toBeAttached();
    // Marken: weder „[!“ noch „> “ sichtbar (transparent oder ersetzt), Rumpf steht
    const sichtbar = await page.evaluate(() => [...document.querySelectorAll(".cm-callout-anfang .cm-line, .cm-callout-anfang")].map((l) => l.textContent).join("|"));
    expect(sichtbar).not.toContain("[!");
    // Fett und Link im Rumpf bleiben gezeichnet
    await expect(page.locator(".cm-callout .cm-fett").first()).toBeAttached();
    await expect(page.locator(".cm-callout .cm-wiki").first()).toBeAttached();
    // Falten: „-“ zu, „+“ offen
    await expect(page.locator(".cm-line", { hasText: "Versteckter Rumpf" })).toHaveCount(0);
    await expect(page.locator(".cm-line", { hasText: "Sichtbarer Rumpf" })).toHaveCount(1);
    await expect(page.locator(".cm-callout-zu")).toHaveCount(1);
    await expect(page.locator(".cm-callout-pfeil.zu")).toHaveCount(1);
    await page.locator(".cm-callout-pfeil.zu").click();
    await expect(page.locator(".cm-line", { hasText: "Versteckter Rumpf eins" })).toHaveCount(1);
    await expect(page.locator(".cm-callout-pfeil.zu")).toHaveCount(0);
    await page.locator(".cm-callout-zu, .cm-callout-faltbar", { hasText: "Offen per Plus" }).locator(".cm-callout-pfeil").click();
    await expect(page.locator(".cm-line", { hasText: "Sichtbarer Rumpf" })).toHaveCount(0);
    await page.locator(".cm-callout-faltbar", { hasText: "Offen per Plus" }).locator(".cm-callout-symbol").click();
    await expect(page.locator(".cm-line", { hasText: "Sichtbarer Rumpf" })).toHaveCount(1);
    // Rohtext am Cursor: Kopfzeile zeigt „> [!tip]“, Rumpfzeile zeigt „>“ (sichtbar), die anderen bleiben gezeichnet
    await imEditor(page, ({ view }) => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Inhalt von note") + 3 } }); });
    await expect(page.locator(".cm-line", { hasText: "Inhalt von note" }).locator(".cm-marke").first()).toHaveText(">");
    await imEditor(page, ({ view }) => { view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Titel info") + 3 } }); });
    await expect(page.locator(".cm-line", { hasText: "Titel info" })).toContainText("> [!info] Titel info");
    // Die Darstellung hat den Text nie verändert
    expect(await dok(page)).toBe(calloutNotiz);
  });
}

for (const farbe of ["light", "dark"]) {
  test(`Callouts: Fotos mit Auswahl der Arten, zugeklappt und Cursor im Callout (${schema(farbe)})`, async ({ page }) => {
    const notiz = ["# Callouts im Alltag", "", "Ein Absatz davor, damit man den Abstand sieht.", "",
      "> [!note] Notiz", "> Ein ruhiger Hinweis mit **fettem** Wort und einem [[Link]].", "",
      "> [!tip] Tipp mit zwei Zeilen", "> Erste Zeile des Tipps.", "> Zweite Zeile des Tipps.", "",
      "> [!warning]- Warnung, zugeklappt", "> Das sieht man nur, wenn man sie aufklappt.", "",
      "> [!success]+ Erfolg, offen und faltbar", "> Alles hat geklappt.", "",
      "> [!danger]", "> Gefahr ohne eigenen Titel.", "",
      "> [!question] Frage", "> Wie sieht ein Cursor im Callout aus?", "",
      "> [!bug] Fehlerbericht", "> Reproduzierbar.", "", "> [!example] Beispiel", "> `Code` im Callout.", "", "> [!quote] Zitat", "> Weniger ist mehr.", "",
      "> Und ein ganz normales Zitat zum Vergleich.", "", "Danach geht der Text weiter.", ""].join("\n");
    schreibe("10_notizen/cofoto.md", notiz);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.emulateMedia({ colorScheme: farbe });
    await oeffne(page, "10_notizen/cofoto.md");
    await page.waitForTimeout(300);
    await foto(page, `callouts-${schema(farbe)}`);
    await imEditor(page, ({ view }) => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Zweite Zeile") + 4 } }); });
    await page.waitForTimeout(200);
    await foto(page, `callouts-cursor-${schema(farbe)}`);
  });
}

test("Callouts: Datei bleibt bytegleich (CRLF, Umlaute, Callout in Liste und in Zitat), Rückgängig nach Falten ändert nichts", async ({ page }) => {
  const text = "# Titel\r\n\r\n> [!warning]- Achtung ÄÖÜ\r\n> Rumpf 1\r\n> Rumpf 2\r\n\r\n- Punkt\r\n  > [!info] In Liste\r\n  > Inhalt\r\n\r\n> Zitat\r\n> > [!note] Verschachtelt\r\n> > Innen\r\n\r\nEnde\r\n";
  schreibe("10_notizen/bytes.md", text);
  await oeffne(page, "10_notizen/bytes.md");
  await expect(page.locator(".cm-callout-warning.cm-callout-zu")).toHaveCount(1);
  await page.locator(".cm-callout-pfeil").first().click();
  await page.locator(".cm-callout-pfeil").first().click();
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(1200);
  expect(readFileSync(join(vault, "10_notizen/bytes.md"), "utf8")).toBe(text);
  expect(await imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak))).toBe(text);
  await expect(page.locator("#speicherstand")).not.toHaveAttribute("data-zustand", "ungespeichert");
});

test("Callouts: Tastatur Mod-Alt-[ klappt zu, Mod-Alt-] klappt auf; Cursor im Rumpf geht dabei in die Kopfzeile", async ({ page }) => {
  schreibe("10_notizen/fa.md", "# F\n\n> [!note]+ Offen\n> Rumpf A\n> Rumpf B\n\nENDE\n");
  await oeffne(page, "10_notizen/fa.md");
  await imEditor(page, ({ view }) => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Rumpf B") + 2 } }); });
  await page.keyboard.press("Meta+Alt+[");
  await expect(page.locator(".cm-line", { hasText: "Rumpf" })).toHaveCount(0);
  await expect(page.locator(".cm-callout-zu")).toHaveCount(1);
  await page.keyboard.press("Meta+Alt+]");
  await expect(page.locator(".cm-line", { hasText: "Rumpf B" })).toHaveCount(1);
});

// Pixelmessung wie ruhe.spec.mjs: y der Linie ENDE, wenn der Cursor in einen Block geht
const messe = (page) => imEditor(page, ({ view }) => {
  const pos = view.state.doc.toString().indexOf("\nENDE") + 1;
  const c = view.coordsAtPos(pos);
  return Math.round((c.top + view.scrollDOM.scrollTop) * 10) / 10;
});
const setzeCursor = (page, text, versatz = 3) => imEditor(page, ({ view }, { text, versatz }) => {
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(text) + versatz } });
}, { text, versatz });

for (const farbe of ["light", "dark"]) {
  test(`Ruhe: Cursor in Callout (offen, zugeklappt, ohne Titel, in Liste) und in Code verschiebt nichts (${schema(farbe)})`, async ({ page }) => {
    const notiz = [
      "# Ruhe", "",
      "> [!tip] Mit Titel", "> Erste Rumpfzeile", "> Zweite Rumpfzeile", "",
      "> [!danger]", "> Ohne Titel", "",
      "> [!example]- Zu", "> Verdeckt", "",
      "- Liste", "  > [!info] In der Liste", "  > Innen", "",
      "```python", "def f(x):", "    return x * 2  # doppelt", "```", "",
      "```", "ohne Sprache", "```", "",
      "ENDE", "",
    ].join("\n");
    schreibe("10_notizen/ruhe2.md", notiz);
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.emulateMedia({ colorScheme: farbe });
    await oeffne(page, "10_notizen/ruhe2.md");
    await setzeCursor(page, "ENDE", 1);
    await page.waitForTimeout(500);
    const basis = await messe(page);
    const stellen = [["Kopf mit Titel", "Mit Titel", 2], ["Rumpf 1", "Erste Rumpfzeile"], ["Rumpf 2", "Zweite Rumpfzeile"], ["Kopf ohne Titel", "[!danger]", 4], ["Rumpf ohne Titel", "Ohne Titel"],
      ["Kopf zugeklappt", "[!example]", 4], ["Kopf in Liste", "In der Liste", 3], ["Rumpf in Liste", "Innen"], ["Zaun auf", "```python", 5], ["Code", "def f"], ["Code 2", "return x"], ["Zaun zu", "```\n\n```", 1],
      ["Zaun ohne Sprache", "```\nohne", 2], ["Code ohne Sprache", "ohne Sprache", 3]];
    const abw = {};
    for (const [name, text, v] of stellen) {
      await setzeCursor(page, text, v ?? 3);
      await page.waitForTimeout(120);
      abw[name] = Math.round(((await messe(page)) - basis) * 10) / 10;
      await setzeCursor(page, "ENDE", 1);
      await page.waitForTimeout(80);
      expect(Math.abs((await messe(page)) - basis), `zurück nach ${name}`).toBeLessThanOrEqual(1);
    }
    console.log("Δy r42", farbe, JSON.stringify(abw));
    for (const [name, d] of Object.entries(abw)) expect(Math.abs(d), `Sprung: ${name}`).toBeLessThanOrEqual(1);
  });
}

// ---------------------------------------------------------------- Code
const CODE = {
  js: "const x = 1; // Zahl\nfunction f(a) { return `s${a}` + 'text'; }",
  ts: "interface A { n: number }\nlet a: A = { n: 2 };",
  json: '{ "name": "k", "n": 3, "ok": true }',
  py: "def f(x):\n    return x * 2  # doppelt",
  sh: "echo \"hallo\" | grep h # Kommentar\nexport X=1",
  swift: "func f(_ x: Int) -> Int { return x + 1 }",
  yaml: "name: kortex\nliste:\n  - eins # Kommentar",
  html: '<div class="a">Text</div>',
  css: "a { color: #fff; margin: 0 }",
  sql: "SELECT id, name FROM t WHERE id = 3;",
  md: "# Titel\n\n**fett**",
};
const codeNotiz = ["# Code", "", ...Object.entries(CODE).flatMap(([s, c]) => ["```" + s, c, "```", ""]), "```", "ohne Sprache", "```", "", "ENDE", ""].join("\n");

for (const farbe of ["light", "dark"]) {
  test(`Code: Syntaxfarben für alle Sprachen, Zäune nur am Cursor, Sprachmarke, Farbe ohne Sprung (${schema(farbe)})`, async ({ page }) => {
    schreibe("10_notizen/code.md", codeNotiz);
    await page.setViewportSize({ width: 1440, height: 2200 });
    await page.emulateMedia({ colorScheme: farbe });
    await oeffne(page, "10_notizen/code.md");
    // Sprachen laden nach: erst dann sind die Farben da, die Höhe bleibt gleich
    const hoehe0 = await page.evaluate(() => document.querySelector(".cm-content").getBoundingClientRect().height);
    await expect.poll(() => page.locator(".cm-content [class*=syn-]").count(), { timeout: 8000 }).toBeGreaterThan(20);
    await page.waitForTimeout(800);
    const hoehe1 = await page.evaluate(() => document.querySelector(".cm-content").getBoundingClientRect().height);
    expect(Math.abs(hoehe1 - hoehe0), "Höhe vor und nach dem Nachladen der Sprachen").toBeLessThanOrEqual(1);
    for (const s of Object.keys(CODE)) {
      const zeile = page.locator(".cm-codeblock", { hasText: CODE[s].split("\n")[0].slice(0, 12) }).first();
      expect(await zeile.locator("[class*=syn-]").count(), `Farben in ${s}`).toBeGreaterThan(0);
    }
    // Farben: Schlüsselwort ≠ Textfarbe, Zeichenfolge ≠ Schlüsselwort
    const farben = await page.evaluate(() => {
      const c = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
      return { kw: c(".cm-codeblock .syn-kw"), str: c(".cm-codeblock .syn-str"), com: c(".cm-codeblock .syn-com"), text: getComputedStyle(document.querySelector(".cm-content")).color };
    });
    expect(farben.kw).not.toBe(farben.text);
    expect(farben.str).not.toBe(farben.kw);
    expect(farben.com).not.toBe(farben.text);
    // Zäune ohne Cursor unsichtbar, Sprachmarke rechts oben, Kopier-Knopf da
    await setzeCursor(page, "ENDE", 1);
    const text = await page.evaluate(() => document.querySelector(".cm-content").innerText);
    expect(text).not.toContain("```");
    await expect(page.locator(".cm-code-sprache").first()).toHaveText("js");
    expect(await page.locator(".cm-code-kopieren").count()).toBe(Object.keys(CODE).length + 1);
    const lage = await page.evaluate(() => { const z = document.querySelector(".cm-codeblock-anfang").getBoundingClientRect(), k = document.querySelector(".cm-code-kopf").getBoundingClientRect(); return { rechts: z.right - k.right, oben: k.top - z.top }; });
    expect(lage.rechts).toBeGreaterThan(0); expect(lage.rechts).toBeLessThan(30); expect(lage.oben).toBeLessThan(12);
    // Cursor in der Zaunzeile zeigt den Zaun, Cursor im Code zeigt keinen
    await setzeCursor(page, "```js", 5);
    await expect(page.locator(".cm-line", { hasText: "```js" })).toHaveCount(1);
    await setzeCursor(page, "const x", 3);
    expect(await page.evaluate(() => document.querySelector(".cm-content").innerText)).not.toContain("```");
    await setzeCursor(page, "ENDE", 1);
    await page.waitForTimeout(200);
    await foto(page, `code-${schema(farbe)}`);
    expect(await dok(page)).toBe(codeNotiz);
  });
}

test("Code: Syntaxfarben erreichen auf --seite in allen Schemata mindestens 4,5 : 1", async ({ page }) => {
  schreibe("10_notizen/code.md", "```js\nconst x = 1;\n```\n");
  await oeffne(page, "10_notizen/code.md");
  const ergebnis = await page.evaluate(() => {
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const zahlen = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const probe = document.createElement("span"); document.body.append(probe);
    const aus = [];
    for (const pal of ["hell-standard", "hell-papier", "hell-kontrast", "dunkel-standard", "dunkel-graphit", "dunkel-mitternacht", "dunkel-kontrast"]) {
      document.documentElement.setAttribute("data-pal", pal);
      const cs = getComputedStyle(document.documentElement);
      probe.style.background = "var(--seite)"; const grund = zahlen(getComputedStyle(probe).backgroundColor);
      for (const n of ["kw", "str", "num", "com", "fn", "def", "prop", "typ", "tag", "op", "meta"]) {
        probe.style.color = `var(--syn-${n})`;
        aus.push({ pal, n, k: Math.round(kontrast(zahlen(getComputedStyle(probe).color), grund) * 100) / 100 });
      }
      void cs;
    }
    document.documentElement.removeAttribute("data-pal");
    return aus;
  });
  const zu_schwach = ergebnis.filter((e) => e.k < 4.5);
  expect(zu_schwach, "Farben unter 4,5 : 1").toEqual([]);
});

test("Code: Kopieren liefert den Code ohne Zäune; Knopf ändert Cursor und Text nicht", async ({ page }) => {
  const notiz = "# K\n\n```py\ndef f(x):\n    return x\n\n# Leerzeile oben\n```\n\nText\n\n```\nohne Schluss";
  schreibe("10_notizen/kop.md", notiz);
  await oeffne(page, "10_notizen/kop.md");
  await page.evaluate(() => { window.__kopiert = []; navigator.clipboard.writeText = (t) => { window.__kopiert.push(t); return Promise.resolve(); }; });
  await setzeCursor(page, "Text", 1);
  const knoepfe = page.locator(".cm-code-kopieren");
  await expect(knoepfe).toHaveCount(2);
  await page.locator(".cm-codeblock-anfang").first().hover();
  await knoepfe.first().click();
  await knoepfe.nth(1).click();
  const kopiert = await page.evaluate(() => window.__kopiert);
  expect(kopiert).toEqual(["def f(x):\n    return x\n\n# Leerzeile oben", "ohne Schluss"]);
  await expect(page.locator(".cm-code-kopieren.kopiert").first()).toBeAttached();
  expect(await dok(page)).toBe(notiz);
  expect(await imEditor(page, ({ view }) => view.state.selection.main.head)).toBe(notiz.indexOf("Text") + 1);
});

// ---------------------------------------------------------------- Neue Notiz
for (const farbe of ["light", "dark"]) {
  test(`Neue Notiz: Platzhalter „Titel“ statt nacktem „#“, eigene Info-Spalte, Tippen ersetzt den Platzhalter (${schema(farbe)})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: farbe });
    schreibe("10_notizen/start.md", "# Start\n");
    await oeffne(page, "10_notizen/start.md");
    await page.keyboard.press("Meta+n");
    await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Neue Notiz");
    await expect(page.locator(".cm-platzhalter")).toHaveText("Titel");
    const zeile = page.locator(".cm-line").first();
    await expect(zeile).toHaveText("Titel"); // kein „#“ im sichtbaren Text, auch nicht mit dem Cursor in der Zeile
    expect(await dok(page)).toBe("# \n");
    // Cursor sitzt vor dem Platzhalter
    const lage = await page.evaluate(() => {
      const p = document.querySelector(".cm-platzhalter").getBoundingClientRect();
      const c = document.querySelector(".cm-cursor")?.getBoundingClientRect();
      return { pl: p.left, cx: c ? c.left : null };
    });
    expect(lage.cx).not.toBeNull();
    expect(lage.cx).toBeLessThanOrEqual(lage.pl + 1);
    // Info-Spalte der noch ungespeicherten Notiz
    const info = page.locator("#info");
    await expect(info).toContainText("Neue Notiz");
    await expect(info).toContainText("Noch nicht gespeichert");
    await expect(info).not.toContainText("Wähle links eine Notiz");
    await foto(page, `neue-notiz-${schema(farbe)}`, "#app");
    await page.keyboard.type("Meine Idee");
    await expect(page.locator(".cm-platzhalter")).toHaveCount(0);
    await expect(page.locator(".cm-line").first()).toContainText("Meine Idee");
    expect(await dok(page)).toBe("# Meine Idee\n");
    await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
    await expect(page.locator("#info")).not.toContainText("Noch nicht gespeichert");
  });
}

// ---------------------------------------------------------------- Tabelle und Bild per Pfeiltasten
const NOTIZ_BT = [
  "# Tasten", "", "Zeile davor", "",
  "| Spalte A | Spalte B |", "| --- | --- |", "| eins | zwei |", "| drei | vier |", "",
  "Zeile zwischen", "",
  "![[tasten-bild.png]]", "",
  "Zeile danach", "",
  "ENDE", "",
].join("\n");

for (const farbe of ["light", "dark"]) {
  test(`Tabelle und Bild per Pfeiltasten: 0 px Sprung beim Hineinlaufen, Fokus in der Zelle, Bild wird übersprungen (${schema(farbe)})`, async ({ page }) => {
    schreibe("10_notizen/tasten-bild.png", png(360, 140, [90, 120, 220]));
    schreibe("10_notizen/tasten.md", NOTIZ_BT);
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.emulateMedia({ colorScheme: farbe });
    await oeffne(page, "10_notizen/tasten.md");
    await page.waitForSelector(".cm-anhang-img");
    await expect.poll(() => page.evaluate(() => document.querySelector(".cm-anhang-bild")?.classList.contains("geladen"))).toBe(true);
    await setzeCursor(page, "ENDE", 1);
    await page.waitForTimeout(400);
    const basis = await messe(page);
    // Tabelle von oben: ArrowDown aus der Leerzeile davor
    await setzeCursor(page, "Zeile davor", 12);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".cm-tabelle .cm-tz:focus")).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement.closest("[data-z]")?.dataset.z + "/" + document.activeElement.closest("[data-z]")?.dataset.s)).toBe("0/0");
    await page.waitForTimeout(150);
    const dTab1 = (await messe(page)) - basis;
    expect(Math.abs(dTab1), "Sprung Tabelle von oben").toBeLessThanOrEqual(1);
    expect(await page.locator(".cm-tabelle").count()).toBe(1); // das Gitter bleibt stehen, kein Quelltext
    await foto(page, `tabelle-tastatur-${schema(farbe)}`, "#editor");
    await page.keyboard.press("Escape"); // aus der Tabelle heraus
    // Tabelle von unten: ArrowUp aus der Leerzeile dahinter → letzte Zeile
    await setzeCursor(page, "Zeile zwischen", -1);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".cm-tabelle .cm-tz:focus")).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement.closest("[data-z]")?.dataset.z)).toBe("2");
    await page.waitForTimeout(150);
    expect(Math.abs((await messe(page)) - basis), "Sprung Tabelle von unten").toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    // Bild von oben: ArrowDown aus der Leerzeile davor springt über das Bild, nichts bewegt sich
    await setzeCursor(page, "![[tasten", -1);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    expect(Math.abs((await messe(page)) - basis), "Sprung Bild von oben (1)").toBeLessThanOrEqual(1);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    expect(Math.abs((await messe(page)) - basis), "Sprung Bild von oben (2)").toBeLessThanOrEqual(1);
    await expect(page.locator(".cm-anhang-dahinter")).toHaveCount(0); // nie Rohzeile plus Bild
    const kopf = await imEditor(page, ({ view }) => view.state.doc.lineAt(view.state.selection.main.head).text);
    expect(["Zeile danach", "![[tasten-bild.png]]", ""]).toContain(kopf);
    // Von unten zurück
    await setzeCursor(page, "Zeile danach", -1);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    expect(Math.abs((await messe(page)) - basis), "Sprung Bild von unten").toBeLessThanOrEqual(1);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    expect(Math.abs((await messe(page)) - basis), "Sprung Bild von unten (2)").toBeLessThanOrEqual(1);
    await expect(page.locator(".cm-anhang-dahinter")).toHaveCount(0);
    // Horizontal: Pfeil rechts am Ende der Leerzeile vor der Tabelle
    await setzeCursor(page, "Zeile davor", 12);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    const f = await page.locator(".cm-tabelle .cm-tz:focus").count();
    expect(f === 1 || Math.abs((await messe(page)) - basis) <= 1).toBe(true);
    await page.keyboard.press("Escape");
    await setzeCursor(page, "ENDE", 1);
    await page.waitForTimeout(200);
    expect(Math.abs((await messe(page)) - basis)).toBeLessThanOrEqual(1);
    await foto(page, `bild-tastatur-${schema(farbe)}`, "#editor");
    expect(await dok(page)).toBe(NOTIZ_BT); // nichts davon hat den Text berührt
  });
}

test("Bild: Cursor mitten im Text der Einbettung zeigt den Rohtext (Klick, Suchsprung), Rohmodus immer; Löschen am Rand entfernt die ganze Einbettung", async ({ page }) => {
  schreibe("10_notizen/tasten-bild.png", png(120, 60, [200, 90, 90]));
  schreibe("10_notizen/bild.md", "# B\n\nvor ![[tasten-bild.png]] nach\n\nENDE\n");
  await oeffne(page, "10_notizen/bild.md");
  await expect(page.locator(".cm-anhang-bild")).toHaveCount(1);
  await setzeCursor(page, "tasten-bild", 3); // mitten im Namen
  await expect(page.locator(".cm-anhang-dahinter")).toHaveCount(1);
  await expect(page.locator(".cm-line", { hasText: "![[tasten-bild.png]]" })).toHaveCount(1);
  await setzeCursor(page, "nach", 0); // Cursor in der Zeile, aber nicht in der Einbettung: Bild bleibt gezeichnet
  await expect(page.locator(".cm-anhang-dahinter")).toHaveCount(0);
  await expect(page.locator(".cm-anhang-bild")).toHaveCount(1);
  // Backspace direkt hinter dem Bild löscht die ganze Einbettung (atomar), ⌘Z bringt sie zurück
  await setzeCursor(page, " nach", 0);
  await page.keyboard.press("Backspace");
  expect(await dok(page)).toBe("# B\n\nvor  nach\n\nENDE\n");
  await page.keyboard.press("Meta+z");
  expect(await dok(page)).toBe("# B\n\nvor ![[tasten-bild.png]] nach\n\nENDE\n");
});
