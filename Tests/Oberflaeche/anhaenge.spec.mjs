// Bilder und Anhänge (Runde 3, Paket 3a): Einfügen und Ziehen, Anzeige im Editor (Bild, Chip), Lightbox, Grenzen mit Hinweis, externe Bilder nur mit Zustimmung,
// SVG ohne Skripte, Frag-Anzeige, Rückfrage beim Löschen. Echter Server, echter Vault (Wegwerf-Kopie), echter Editor; das Netz ist abgeklemmt (page.route).
// Bilder zum Ansehen: ANHAENGE_BILD=<Ordner> npx playwright test anhaenge.spec.mjs (fotografiert nur die Seite, nie den Bildschirm).
import { test, expect } from "./basis.mjs";
import zlib from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server, seitenfehler;
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const BILDER = process.env.ANHAENGE_BILD || "";
const foto = async (page, name) => { if (!BILDER) return; mkdirSync(BILDER, { recursive: true }); await page.waitForTimeout(400); await page.screenshot({ path: join(BILDER, `${name}.png`) }); };

// Ein echtes PNG (Verlauf mit Kreis), damit Bilder auf den Fotos etwas zeigen
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(typ, daten) { const l = Buffer.alloc(4); l.writeUInt32BE(daten.length); const t = Buffer.concat([Buffer.from(typ), daten]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(t)); return Buffer.concat([l, t, c]); }
function png(w, h, [r, g, b]) {
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    roh[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3, d = Math.hypot(x - w / 2, y - h / 2), kreis = d < h / 3;
      roh[i] = kreis ? 255 : Math.round(r * (1 - x / w) + 40); roh[i + 1] = kreis ? 255 : Math.round(g * (y / h) + 30); roh[i + 2] = kreis ? 255 : Math.round(b * (x / w) + 40);
    }
  }
  const kopf = Buffer.alloc(13); kopf.writeUInt32BE(w, 0); kopf.writeUInt32BE(h, 4); kopf[8] = 8; kopf[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", kopf), chunk("IDAT", zlib.deflateSync(roh)), chunk("IEND", Buffer.alloc(0))]);
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n" + "x".repeat(20000));
const SVG_BOESE = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120" onload="window.__pwn=1"><script>window.__pwn=2</script><rect width="200" height="120" rx="14" fill="#7a5fd6"/><circle cx="100" cy="60" r="34" fill="#fff"/></svg>';

test.beforeEach(() => { seitenfehler = []; });
test.afterEach(() => { server?.stopp(); expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

async function start(optionen = {}, einst = null, vorher = null) {
  ({ vault } = baueVault());
  const support = optionen?.support;
  server = await starteServer(vault, support ? { support } : {});
  if (einst) writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify(einst));
  vorher?.(vault);
}
const lies = (p) => readFileSync(join(vault, p));
const anhaenge = (ordner = "_anhaenge") => (existsSync(join(vault, ordner)) ? readdirSync(join(vault, ordner)).sort() : []);
async function oeffne(page, pfad = NOTIZ, { app = false } = {}) {
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  if (app) await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); return Promise.resolve({ ok: true }); } } } }; });
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
const docText = (page) => imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak));
const cursorAnEnde = (page) => imEditor(page, ({ view }) => { view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus(); });
const cursorAnAnfang = (page) => imEditor(page, ({ view }) => { view.dispatch({ selection: { anchor: 0 } }); view.focus(); });
const warteGespeichert = (page) => expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 6000 });
const toastMit = (page, text) => page.locator("#toast-host .toast", { hasText: text });
// Datei wie aus der Zwischenablage oder vom Ziehen (echte File/DataTransfer-Objekte; nur der Auslöser ist künstlich)
const einfuegen = (page, { name, typ, base64, text }) => page.evaluate(({ name, typ, base64, text }) => {
  const dt = new DataTransfer();
  if (base64) dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type: typ }));
  if (text) dt.setData("text/plain", text);
  document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, { name, typ, base64: base64?.toString("base64"), text });
const ziehen = (page, { name, typ, base64 }, ziel = ".cm-content") => page.evaluate(({ name, typ, base64, ziel }) => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type: typ }));
  const el = document.querySelector(ziel), r = el.getBoundingClientRect(), o = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 20 };
  el.dispatchEvent(new DragEvent("dragenter", o)); el.dispatchEvent(new DragEvent("dragover", o));
  const ueber = document.querySelector(".cm-editor").classList.contains("anhang-ziehen");
  el.dispatchEvent(new DragEvent("drop", o));
  return ueber;
}, { name, typ, base64: base64.toString("base64"), ziel });
const bildGeladen = (page, sel = ".cm-anhang-img") => page.locator(sel).first().evaluate((i) => new Promise((ok) => { if (i.complete && i.naturalWidth) ok(i.naturalWidth); else { i.addEventListener("load", () => ok(i.naturalWidth)); i.addEventListener("error", () => ok(0)); } }));

test("Einfügen eines Bildes: Datei im Anhänge-Ordner, ![[…]] im Text, Bild im Editor, Lightbox — hell und dunkel", async ({ page }) => {
  await start();
  await oeffne(page);
  await cursorAnEnde(page);
  await einfuegen(page, { name: "image.png", typ: "image/png", base64: png(480, 300, [200, 90, 60]) });
  await expect(page.locator(".cm-anhang-img")).toHaveCount(1, { timeout: 8000 });
  const dateien = anhaenge();
  expect(dateien).toHaveLength(1);
  expect(dateien[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-image\.png$/);
  expect(lies(`_anhaenge/${dateien[0]}`).subarray(0, 4).toString("hex")).toBe("89504e47");
  expect(await docText(page)).toContain(`![[${dateien[0]}]]`);
  // Cursor in der Zeile: Text und Bild dahinter; Cursor weg: nur das Bild
  await expect(page.locator(".cm-anhang-dahinter")).toHaveCount(1);
  await cursorAnAnfang(page);
  await expect(page.locator(".cm-anhang-dahinter")).toHaveCount(0);
  await expect(page.locator(".cm-content")).not.toContainText("![[");
  expect(await bildGeladen(page)).toBe(480);
  await warteGespeichert(page);
  expect(lies(NOTIZ).toString()).toContain(`![[${dateien[0]}]]`);
  await foto(page, "01-bild-hell");
  await page.emulateMedia({ colorScheme: "dark" });
  await foto(page, "02-bild-dunkel");
  // Lightbox: Klick auf das Bild, Esc schließt, der Fokus kehrt in den Editor zurück
  await page.locator(".cm-anhang-bild").first().click();
  await expect(page.locator(".anhang-lightbox")).toBeVisible();
  await expect(page.locator(".anhang-lb-bild")).toHaveAttribute("src", /\/_anhang\?ziel=/);
  expect(await bildGeladen(page, ".anhang-lb-bild")).toBe(480);
  const k = await page.locator(".anhang-lb-bild").boundingBox();
  expect(k.width).toBeGreaterThan(300);
  await foto(page, "03-lightbox-dunkel");
  await page.keyboard.press("Escape");
  await expect(page.locator(".anhang-lightbox")).toHaveCount(0);
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".cm-anhang-bild").first().click();
  await foto(page, "04-lightbox-hell");
  await page.locator(".anhang-lb-zu").click();
  await expect(page.locator(".anhang-lightbox")).toHaveCount(0);
});

test("Breite Bilder skalieren auf die Spalte, ![[x.png|200]] hat feste Breite, ein fehlendes Bild zeigt einen Hinweis", async ({ page }) => {
  await start(null, null, (v) => {
    mkdirSync(join(v, "_anhaenge"), { recursive: true });
    writeFileSync(join(v, "_anhaenge/breit.png"), png(2400, 800, [220, 120, 40]));
    writeFileSync(join(v, "_anhaenge/klein.png"), png(60, 40, [40, 120, 220]));
    writeFileSync(join(v, "10_notizen/bilder.md"), "# Bilder\n\n![[breit.png]]\n\n![[klein.png|200]]\n\n![[gibts-nicht.png]]\n\nSchluss.\n");
  });
  await oeffne(page, "10_notizen/bilder.md");
  await cursorAnEnde(page);
  await expect(page.locator(".cm-anhang-img")).toHaveCount(2);
  await expect(page.locator(".cm-anhang-bild.fehlt")).toContainText("gibts-nicht.png", { timeout: 8000 });
  const spalte = (await page.locator(".cm-content").boundingBox()).width;
  const breit = await page.locator('.cm-anhang-bild[data-ziel="breit.png"]').boundingBox();
  expect(breit.width).toBeLessThanOrEqual(spalte + 1);
  expect(breit.width).toBeGreaterThan(200);
  const klein = await page.locator('.cm-anhang-bild[data-ziel="klein.png"] img').boundingBox();
  expect(Math.round(klein.width)).toBe(200);
  await foto(page, "05-skalierung");
});

test("Ziehen einer PDF: Chip mit Name und Größe, Klick öffnet über die Hülle (anhang-oeffnen)", async ({ page }) => {
  await start();
  await oeffne(page, NOTIZ, { app: true });
  const ueber = await ziehen(page, { name: "Rechnung März.pdf", typ: "application/pdf", base64: PDF });
  expect(ueber, "beim Darüberziehen zeigt der Editor die Ablagefläche").toBe(true);
  await expect(page.locator(".cm-anhang-chip")).toHaveCount(1, { timeout: 8000 });
  const dateien = anhaenge();
  expect(dateien).toHaveLength(1);
  expect(dateien[0]).toMatch(/-rechnung-maerz\.pdf$/);
  await cursorAnAnfang(page);
  await expect(page.locator(".cm-anhang-chip .cm-anhang-name")).toHaveText(dateien[0]);
  await expect(page.locator(".cm-anhang-chip .cm-anhang-zusatz")).toHaveText(/KB/);
  await expect(page.locator(".cm-editor")).not.toHaveClass(/anhang-ziehen/);
  await foto(page, "06-chip");
  await page.locator(".cm-anhang-chip").click();
  await expect.poll(() => page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "anhang-oeffnen"))).toEqual([{ aktion: "anhang-oeffnen", wert: `_anhaenge/${dateien[0]}` }]);
});

test("Browser ohne Hülle: der Chip meldet ehrlich, wenn sich nichts öffnen lässt", async ({ page }) => {
  await start(null, null, (v) => { mkdirSync(join(v, "_anhaenge"), { recursive: true }); writeFileSync(join(v, "_anhaenge/a.pdf"), PDF); writeFileSync(join(v, "10_notizen/pdf.md"), "# PDF\n\n![[a.pdf]]\n\n![[fehlt.pdf]]\n"); });
  await oeffne(page, "10_notizen/pdf.md");
  await cursorAnEnde(page);
  await expect(page.locator('.cm-anhang-chip[data-ziel="a.pdf"][data-pfad="_anhaenge/a.pdf"]')).toBeVisible();
  await expect(page.locator('.cm-anhang-chip.fehlt[data-ziel="fehlt.pdf"]')).toBeVisible();
  await page.locator('.cm-anhang-chip[data-ziel="fehlt.pdf"]').click();
  await expect(toastMit(page, "nicht gefunden")).toBeVisible();
  await page.locator('.cm-anhang-chip[data-ziel="a.pdf"]').click();
  await expect(toastMit(page, "ließ sich nicht öffnen")).toBeVisible();
});

test("Grenzen: zu große Datei und falscher Typ werden mit Hinweis abgelehnt, nichts landet im Vault", async ({ page }) => {
  await start(null, { anhaengeMaxMB: 1 });
  await oeffne(page);
  await cursorAnEnde(page);
  await einfuegen(page, { name: "gross.pdf", typ: "application/pdf", base64: Buffer.concat([PDF, Buffer.alloc(1_600_000, 1)]) });
  await expect(toastMit(page, "1,5 MB")).toContainText("Erlaubt sind 1 MB");
  await einfuegen(page, { name: "setup.exe", typ: "application/x-msdownload", base64: Buffer.from("MZ....") });
  await expect(toastMit(page, "nicht ab").first()).toBeVisible();
  await einfuegen(page, { name: "leer.png", typ: "image/png", base64: Buffer.alloc(0) });
  await einfuegen(page, { name: "falsch.png", typ: "image/png", base64: Buffer.from("<html>kein Bild</html>") });
  await expect(toastMit(page, "kein gültiges Bild")).toBeVisible();
  expect(anhaenge()).toEqual([]);
  expect(await docText(page)).not.toContain("![[");
  await foto(page, "07-grenzen");
});

test("Excel/Word: Vorschaubild plus Text in der Zwischenablage = der Text gewinnt, nichts wird abgelegt", async ({ page }) => {
  await start();
  await oeffne(page);
  await cursorAnEnde(page);
  await einfuegen(page, { name: "vorschau.png", typ: "image/png", base64: png(40, 20, [1, 2, 3]), text: "a\tb\n1\t2" });
  await page.waitForTimeout(300);
  expect(anhaenge()).toEqual([]);
});

test("Schreibgeschützte Notiz: kein Einfügen, Hinweis", async ({ page }) => {
  await start();
  await oeffne(page, "09_wiki/INDEX.md");
  await einfuegen(page, { name: "x.png", typ: "image/png", base64: png(20, 20, [1, 2, 3]) });
  await expect(toastMit(page, "schreibgeschützt")).toBeVisible();
  expect(anhaenge()).toEqual([]);
});

test("Eigener Ordner und Ort „neben der Notiz“ aus den Einstellungen", async ({ page }) => {
  await start(null, { anhaengeOrt: "notiz", anhaengeOrdner: "Medien" });
  await oeffne(page);
  await cursorAnEnde(page);
  await einfuegen(page, { name: "Foto Strand.jpg", typ: "image/png", base64: png(120, 80, [10, 120, 90]) });
  await expect(page.locator(".cm-anhang-img")).toHaveCount(1, { timeout: 8000 });
  expect(anhaenge("10_notizen/Medien")).toHaveLength(1);
  expect(anhaenge("10_notizen/Medien")[0]).toMatch(/-foto-strand\.png$/); // PNG-Inhalt: die Endung folgt dem Inhalt
  expect(anhaenge()).toEqual([]);
});

test("SVG: Skripte und Ereignisse werden vor dem Speichern entfernt, das Bild erscheint, nichts läuft", async ({ page }) => {
  await start();
  await oeffne(page);
  await cursorAnEnde(page);
  await einfuegen(page, { name: "logo.svg", typ: "image/svg+xml", base64: Buffer.from(SVG_BOESE) });
  await expect(page.locator(".cm-anhang-img")).toHaveCount(1, { timeout: 8000 });
  const [datei] = anhaenge();
  const svg = lies(`_anhaenge/${datei}`).toString();
  expect(svg).toContain("<rect");
  expect(svg).not.toMatch(/script|onload|__pwn/);
  expect(await bildGeladen(page)).toBeGreaterThan(0);
  // Direkt aufgerufen (neuer Tab): die Kopfzeilen sperren Skripte auch dann
  const r = await page.request.get(`${server.url}_anhang?ziel=${encodeURIComponent(datei)}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toBe("image/svg+xml");
  expect(r.headers()["content-security-policy"]).toMatch(/^sandbox/);
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await page.evaluate(() => window.__pwn)).toBeUndefined();
  // Von Hand abgelegte, unbereinigte SVG wird nur bereinigt ausgeliefert
  writeFileSync(join(vault, "_anhaenge/hand.svg"), SVG_BOESE);
  const h = await page.request.get(`${server.url}_anhang?ziel=hand.svg`);
  expect(await h.text()).not.toMatch(/script|onload/);
  await foto(page, "08-svg");
});

test("Externe Bilder: Platzhalter ohne Netz, erst der Klick lädt (über die Werkstatt), danach bleibt das Bild", async ({ page }) => {
  await start(null, null, (v) => writeFileSync(join(v, "10_notizen/extern.md"), "# Extern\n\nText davor.\n\n![Katze](https://bilder.example.org/katze.png)\n\nText danach.\n"));
  const anfragen = [];
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (!u.startsWith(server.url)) { anfragen.push(u); return route.abort(); }
    if (u.includes("/_extern-bild")) { anfragen.push(u); return route.fulfill({ status: 200, contentType: "image/png", body: png(300, 180, [60, 140, 200]) }); }
    return route.fallback();
  });
  await oeffne(page, "10_notizen/extern.md");
  await cursorAnAnfang(page);
  const platzhalter = page.locator(".cm-anhang-extern");
  await expect(platzhalter).toHaveCount(1);
  await expect(platzhalter).toContainText("bilder.example.org");
  await expect(platzhalter).toContainText("Klicken zum Laden");
  await foto(page, "09-extern-platzhalter-hell");
  await page.emulateMedia({ colorScheme: "dark" });
  await foto(page, "10-extern-platzhalter-dunkel");
  await page.waitForTimeout(300);
  expect(anfragen, "ohne Klick geht keine Anfrage hinaus, auch nicht an die Werkstatt").toEqual([]);
  await platzhalter.click();
  await expect(page.locator(".cm-anhang-img")).toHaveCount(1);
  expect(await bildGeladen(page)).toBe(300);
  expect(anfragen).toHaveLength(1);
  expect(anfragen[0]).toContain(`/_extern-bild?url=${encodeURIComponent("https://bilder.example.org/katze.png")}`);
  expect(anfragen.some((u) => u.startsWith("https://bilder.example.org")), "die Seite selbst ruft nie die fremde Adresse auf").toBe(false);
  await foto(page, "11-extern-geladen-dunkel");
  expect(await docText(page)).toContain("![Katze](https://bilder.example.org/katze.png)"); // der Text bleibt, wie er war
});

test("Externe Bilder: mit der Einstellung „Bilder aus dem Internet laden“ erscheinen sie ohne Klick; http bleibt gesperrt; fremde Schemata bleiben Text", async ({ page }) => {
  await start({}, { externeBilder: true }, (v) => writeFileSync(join(v, "10_notizen/extern.md"),
    "# Extern\n\n![A](https://bilder.example.org/a.png)\n\n![B](http://unsicher.example.org/b.png)\n\n![C](javascript:alert(1))\n\n![D](data:text/html;base64,PHNjcmlwdD4=)\n"));
  const anfragen = [];
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (!u.startsWith(server.url)) { anfragen.push(u); return route.abort(); }
    if (u.includes("/_extern-bild")) { anfragen.push(u); return route.fulfill({ status: 200, contentType: "image/png", body: png(100, 60, [60, 140, 200]) }); }
    return route.fallback();
  });
  await oeffne(page, "10_notizen/extern.md");
  await cursorAnAnfang(page);
  await expect(page.locator(".cm-anhang-img")).toHaveCount(1);
  expect(await bildGeladen(page)).toBe(100);
  await expect(page.locator(".cm-anhang-extern.gesperrt")).toContainText("unsicher.example.org");
  await expect(page.locator(".cm-anhang-extern.gesperrt")).toContainText("Nur https");
  await expect(page.locator(".cm-content")).toContainText("javascript:alert(1)");
  await expect(page.locator(".cm-content")).toContainText("data:text/html");
  expect(anfragen).toHaveLength(1);
  expect(anfragen[0]).toContain("/_extern-bild?url=");
});

test("Bilder in Markdown-Schreibweise ![Alt](pfad) erscheinen, Umbenennen und Verschieben der Notiz lassen sie sichtbar", async ({ page }) => {
  await start(null, null, (v) => {
    mkdirSync(join(v, "10_notizen/bilder"), { recursive: true });
    writeFileSync(join(v, "10_notizen/bilder/strand.png"), png(200, 120, [30, 160, 120]));
    mkdirSync(join(v, "_anhaenge"), { recursive: true });
    writeFileSync(join(v, "_anhaenge/2026-01-01-000000-karte.png"), png(180, 100, [160, 60, 120]));
    writeFileSync(join(v, "10_notizen/md.md"), "# Markdown\n\n![Strand](bilder/strand.png)\n\n![[2026-01-01-000000-karte.png]]\n\nEnde.\n");
  });
  await oeffne(page, "10_notizen/md.md");
  await cursorAnEnde(page);
  await expect(page.locator(".cm-anhang-img")).toHaveCount(2);
  expect(await page.locator(".cm-anhang-img").evaluateAll((l) => Promise.all(l.map((i) => new Promise((ok) => { if (i.complete) ok(i.naturalWidth); else i.addEventListener("load", () => ok(i.naturalWidth)); }))))).toEqual([200, 180]);
  // Notiz in einen anderen Ordner verschieben (die Werkstatt zieht den relativen Pfad nach), dann neu öffnen
  const r = await page.evaluate(async () => (await fetch("/api/notiz/verschieben", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pfad: "10_notizen/md.md", ziel: "00_inbox" }) })).json());
  expect(r.ok).toBe(true);
  const neu = lies("00_inbox/md.md").toString();
  expect(neu).toContain("![Strand](../10_notizen/bilder/strand.png)");
  expect(neu).toContain("![[2026-01-01-000000-karte.png]]");
  await page.goto(server.url + "?pfad=" + encodeURIComponent("00_inbox/md.md"));
  await page.waitForSelector(".cm-content .cm-line");
  await cursorAnEnde(page);
  await expect(page.locator(".cm-anhang-img")).toHaveCount(2);
  expect(await page.locator(".cm-anhang-img").evaluateAll((l) => Promise.all(l.map((i) => new Promise((ok) => { if (i.complete) ok(i.naturalWidth); else i.addEventListener("load", () => ok(i.naturalWidth)); }))))).toEqual([200, 180]);
});

test("Rohtext: ![[…]] bleibt Text, ein Codeblock zeigt kein Bild", async ({ page }) => {
  await start(null, null, (v) => {
    mkdirSync(join(v, "_anhaenge"), { recursive: true });
    writeFileSync(join(v, "_anhaenge/a.png"), png(50, 50, [9, 9, 9]));
    writeFileSync(join(v, "10_notizen/code.md"), "# Code\n\n```\n![[a.png]]\n```\n\nInline `![[a.png]]` hier.\n\n![[a.png]]\n");
  });
  await oeffne(page, "10_notizen/code.md");
  await cursorAnAnfang(page);
  await expect(page.locator(".cm-anhang-img")).toHaveCount(1); // nur die freie Zeile
  await expect(page.locator(".cm-content")).toContainText("![[a.png]]"); // Code und Inline-Code zeigen den Text
});

test("Frag deinen Vault: lokale Bilder erscheinen, externe Bild-Adressen werden nie geladen, HTML bleibt Text", async ({ page }) => {
  await start(null, null, (v) => { mkdirSync(join(v, "_anhaenge"), { recursive: true }); writeFileSync(join(v, "_anhaenge/a.png"), png(120, 80, [30, 100, 200])); });
  const anfragen = [];
  await page.route("**/*", (route) => { const u = route.request().url(); if (!u.startsWith(server.url)) { anfragen.push(u); return route.abort(); } return route.fallback(); });
  await oeffne(page);
  const r = await page.evaluate(async () => {
    const { rendereMarkdown } = await import("/frage-markdown.js");
    const geoeffnet = [];
    const f = rendereMarkdown("Hier: ![[a.png]] und ![Alt](a.png) sowie ![Tracker](https://boese.example.org/pixel.png?daten=geheim) und ![[nicht-da.png]] <img src=x onerror=window.__pwn=1> und [[Seite]]",
      { verweise: {}, bild: { url: (z) => `/_anhang?ziel=${encodeURIComponent(z)}`, lightbox: (src, alt) => geoeffnet.push([src, alt]) } });
    const host = document.createElement("div"); host.className = "frage-antwort"; host.append(f); document.body.append(host);
    await new Promise((ok) => setTimeout(ok, 600));
    const imgs = [...host.querySelectorAll("img")];
    imgs[0]?.click();
    return { bilder: imgs.map((i) => [i.getAttribute("src"), i.naturalWidth]), extern: host.querySelector(".md-bild-extern")?.textContent, fehlt: host.querySelector(".md-bild-fehlt")?.textContent,
      html: host.innerHTML.includes("<img src=\"x\""), text: host.textContent, geoeffnet, pwn: window.__pwn ?? null };
  });
  expect(r.bilder).toEqual([["/_anhang?ziel=a.png", 120], ["/_anhang?ziel=a.png", 120]]);
  expect(r.extern).toContain("boese.example.org");
  expect(r.fehlt).toContain("nicht-da.png");
  expect(r.text).toContain("<img src=x onerror=window.__pwn=1>"); // als Text, nie als Element
  expect(r.html).toBe(false);
  expect(r.pwn).toBeNull();
  expect(r.geoeffnet).toHaveLength(1);
  expect(anfragen, "keine Anfrage an fremde Adressen").toEqual([]);
  // Ohne `bild` (wie bisher) bleibt alles Text
  const ohne = await page.evaluate(async () => { const { rendereMarkdown } = await import("/frage-markdown.js"); const h = document.createElement("div"); h.append(rendereMarkdown("![[a.png]]", {})); return h.querySelectorAll("img").length; });
  expect(ohne).toBe(0);
});

// Notiz über das Kontextmenü ihrer Karte in den Papierkorb legen
async function notizLoeschen(page, pfad) {
  await oeffne(page, pfad);
  await page.locator(`[data-karte][data-pfad="${pfad}"]`).first().click({ button: "right" });
  await page.waitForSelector(".menue.offen");
  await page.locator('.menue.offen .m-eintrag[data-menue="papierkorb"]').click();
}

test("Löschen einer Notiz: Anhänge, die nur sie benutzt, fragen nach — mit in den Papierkorb, behalten, abbrechen", async ({ page }) => {
  const einrichten = (v) => {
    mkdirSync(join(v, "_anhaenge"), { recursive: true });
    writeFileSync(join(v, "_anhaenge/nur-hier.png"), png(60, 40, [1, 2, 3]));
    writeFileSync(join(v, "_anhaenge/geteilt.png"), png(60, 40, [4, 5, 6]));
    writeFileSync(join(v, "10_notizen/mit-bildern.md"), "# Mit Bildern\n\n![[nur-hier.png]] ![[geteilt.png]]\n");
    writeFileSync(join(v, "10_notizen/andere.md"), "# Andere\n\n![[geteilt.png]]\n");
  };
  const loesche = (pfad) => notizLoeschen(page, pfad);
  // 1. Abbrechen: nichts ändert sich
  await start(null, null, einrichten);
  await loesche("10_notizen/mit-bildern.md");
  const dlg = page.locator('[data-dialog="anhaenge-loeschen"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("nur-hier.png");
  await expect(dlg).not.toContainText("geteilt.png");
  await expect(dlg.locator('[data-aktion="anhaenge-behalten"]')).toHaveClass(/primaer/); // „Behalten“ ist die Vorgabe (Enter), „Mit löschen“ nicht
  await expect(dlg.locator('[data-aktion="anhaenge-mitloeschen"]')).not.toHaveClass(/primaer/);
  await foto(page, "12-loeschen-frage");
  await dlg.locator('[data-aktion="abbrechen"]').click();
  await page.waitForTimeout(300);
  expect(existsSync(join(vault, "10_notizen/mit-bildern.md"))).toBe(true);
  expect(existsSync(join(vault, "_anhaenge/nur-hier.png"))).toBe(true);
  server.stopp();
  // 2. Behalten: Notiz im Papierkorb, Anhänge bleiben
  await start(null, null, einrichten);
  await loesche("10_notizen/mit-bildern.md");
  await page.locator('[data-dialog="anhaenge-loeschen"] [data-aktion="anhaenge-behalten"]').click();
  await expect.poll(() => existsSync(join(vault, "10_notizen/mit-bildern.md"))).toBe(false);
  expect(existsSync(join(vault, "_anhaenge/nur-hier.png"))).toBe(true);
  server.stopp();
  // 3. Mit löschen: auch der Anhang kommt in den Papierkorb (nicht endgültig), der geteilte bleibt
  await start(null, null, einrichten);
  await loesche("10_notizen/mit-bildern.md");
  await page.locator('[data-dialog="anhaenge-loeschen"] [data-aktion="anhaenge-mitloeschen"]').click();
  await expect.poll(() => existsSync(join(vault, "_anhaenge/nur-hier.png"))).toBe(false);
  expect(existsSync(join(vault, "10_notizen/mit-bildern.md"))).toBe(false);
  expect(existsSync(join(vault, "_anhaenge/geteilt.png"))).toBe(true);
  await expect(toastMit(page, "Papierkorb").last()).toBeVisible();
  const korb = await page.evaluate(async () => (await fetch("/api/papierkorb")).json());
  expect(korb.eintraege.map((e) => e.pfad).sort()).toEqual(["10_notizen/mit-bildern.md", "_anhaenge/nur-hier.png"]);
});

test("Eine Notiz ohne eigene Anhänge wird wie bisher ohne Rückfrage gelöscht", async ({ page }) => {
  await start(null, null, (v) => writeFileSync(join(v, "10_notizen/leer.md"), "# Leer\n\nNichts.\n"));
  await notizLoeschen(page, "10_notizen/leer.md");
  await expect.poll(() => existsSync(join(vault, "10_notizen/leer.md"))).toBe(false);
  await expect(page.locator('[data-dialog="anhaenge-loeschen"]')).toHaveCount(0);
});
