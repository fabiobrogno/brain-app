// Flüssige Bedienung im echten Studio (Werkstatt + Wegwerf-Vault): Skelett statt Leer-Flackern, optimistische Updates mit Rückrollen,
// Ziehen mit Zeiger (Platzhalter, Anheben, Spalte hebt sich, Esc), kein Layout-Shift, Datumsauswahl im Kartenmenü, Dialoge mit Bausteinen.
// Bilder: KORTEX_BILDER=/Ordner npx playwright test fluessig.spec.mjs (hell + dunkel)
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const jetzt = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
function aufgabe(vault, name, f) {
  const d = { status: "offen", prioritaet: "normal", rang: 1000, quelle: "mensch", erstellt: "2026-10-20T08:00:00Z", geaendert: jetzt(), ...f };
  const z = ["---", "typ: aufgabe", `titel: ${JSON.stringify(d.titel)}`, `status: ${d.status}`, `prioritaet: ${d.prioritaet}`];
  if (d.faellig) z.push(`faellig: ${d.faellig}`);
  z.push(`rang: ${d.rang}`, `erstellt: ${d.erstellt}`, `geaendert: ${d.geaendert}`, `quelle: ${d.quelle}`, "---", "");
  mkdirSync(join(vault, "05_aufgaben"), { recursive: true });
  writeFileSync(join(vault, "05_aufgaben", `${name}.md`), z.join("\n"));
  return `05_aufgaben/${name}.md`;
}
const lese = (vault, p) => readFileSync(join(vault, p), "utf8");
const feld = (vault, p, k) => new RegExp(`^${k}: (.*)$`, "m").exec(lese(vault, p))?.[1];

let vault, server, p;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  p = {
    a: aufgabe(vault, "2026-10-20-lieferanten-anrufen", { titel: "Lieferanten anrufen", rang: 1000, prioritaet: "hoch", faellig: "2026-10-01" }),
    b: aufgabe(vault, "2026-10-21-steuer-vorbereiten", { titel: "Steuer vorbereiten", rang: 2000, faellig: "2099-01-01" }),
    c: aufgabe(vault, "2026-10-22-angebot-pruefen", { titel: "Angebot prüfen", rang: 3000, quelle: "ki:claude-code", prioritaet: "niedrig" }),
    d: aufgabe(vault, "2026-10-23-website-text", { titel: "Website-Text schreiben", status: "in-arbeit", rang: 1000 }),
    e: aufgabe(vault, "2026-10-24-antwort-abwarten", { titel: "Auf Antwort warten", status: "warten", rang: 1000 }),
    f: aufgabe(vault, "2026-10-25-fertig-neu", { titel: "Frisch erledigt", status: "erledigt", rang: 1000 }),
  };
  git(vault, "add", "--", "05_aufgaben");
  git(vault, "commit", "-q", "-m", "Aufgaben");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

const karte = (page, pfad) => page.locator(`[data-karte-aufgabe][data-pfad="${pfad}"]`);
const spalte = (page, s) => page.locator(`[data-spalte="${s}"]`);
const titelIn = (page, s) => spalte(page, s).locator(".au-karte .au-titel").allTextContents();
async function zumBoard(page) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
}
const bilderOrdner = () => { const o = process.env.KORTEX_BILDER; if (o) mkdirSync(o, { recursive: true }); return o; };
const schirm = async (page, schema) => { await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" }); };

test("Skelett statt leerer Spalten: erst nach 150 ms sichtbar, danach ersetzt es die echten Karten ohne Sprung der Kopfzeile", async ({ page }) => {
  let frei;
  const tor = new Promise((r) => { frei = r; });
  await page.route("**/api/aufgaben", async (route) => { if (route.request().method() === "GET") await tor; await route.continue(); });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
  const sk = page.locator(".bs-skelett").first();
  await expect(page.locator(".bs-skelett")).toHaveCount(8); // zwei je Spalte
  expect(await sk.evaluate((e) => parseFloat(getComputedStyle(e).opacity))).toBeLessThan(0.5); // noch nicht eingeblendet (Verzögerung 150 ms)
  await expect.poll(() => sk.evaluate((e) => parseFloat(getComputedStyle(e).opacity))).toBeGreaterThan(0.95);
  await expect(page.locator(".au-spalte-leer")).toHaveCount(0); // kein „Hierher ziehen“-Flackern
  const kopf = await page.locator(".au-kopf").boundingBox();
  const brett = await page.locator(".au-brett").boundingBox();
  frei();
  await expect(karte(page, p.a)).toBeVisible();
  await expect(page.locator(".bs-skelett")).toHaveCount(0);
  expect(await page.locator(".au-kopf").boundingBox()).toEqual(kopf);
  expect(await page.locator(".au-brett").boundingBox()).toEqual(brett);
});

test("Board und Filter-Popover: kein Layout-Shift (CLS) und Anker bleiben an ihrem Platz", async ({ page }) => {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.waitForTimeout(500); // die App ist aufgebaut; gemessen wird ab dem Öffnen des Boards
  await page.evaluate(() => {
    window.__cls = []; window.__clsSumme = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__clsSumme += e.value; window.__cls.push([e.value, e.sources.map((s) => (s.node?.className || s.node?.nodeName) + "")]); } }).observe({ type: "layout-shift" });
  });
  await page.click('[data-bereich="aufgaben"]');
  await expect(karte(page, p.a)).toBeVisible();
  await page.waitForTimeout(400);
  const orte = () => page.evaluate(() => [...document.querySelectorAll(".au-kopf button, .au-kopf input, .au-spalte")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.height)]; }));
  const vorher = await orte();
  await page.locator('[data-filter="prio"]').click();
  await expect(page.getByRole("listbox")).toBeVisible();
  expect(await orte()).toEqual(vorher);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.waitForTimeout(200);
  const cls = await page.evaluate(() => ({ summe: window.__clsSumme, eintraege: window.__cls }));
  expect(cls.summe, JSON.stringify(cls.eintraege)).toBeLessThan(0.02);
});

test("Anlegen ist optimistisch: die Karte steht sofort da, die Werkstatt bestätigt später; Eingabe leer und im Fokus", async ({ page }) => {
  await zumBoard(page);
  await expect(karte(page, p.a)).toBeVisible();
  let frei;
  const tor = new Promise((r) => { frei = r; });
  await page.route("**/api/aufgaben", async (route) => { if (route.request().method() === "POST") await tor; await route.continue(); });
  const eingabe = page.getByRole("textbox", { name: "Neue Aufgabe" });
  await eingabe.fill("Sofort sichtbar");
  const t0 = Date.now();
  await page.keyboard.press("Enter");
  await expect(spalte(page, "offen").locator(".au-karte.vorlaeufig .au-titel")).toHaveText("Sofort sichtbar", { timeout: 400 });
  expect(Date.now() - t0).toBeLessThan(600);
  await expect(eingabe).toHaveValue("");
  await expect(eingabe).toBeFocused();
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("5"); // zählt noch den Stand der Werkstatt
  frei();
  await expect(spalte(page, "offen").locator(".au-karte.vorlaeufig")).toHaveCount(0);
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("6");
  expect((await titelIn(page, "offen")).at(-1)).toBe("Sofort sichtbar");
  expect(git(vault, "status", "--porcelain").toString()).toContain("sofort-sichtbar");
});

test("Scheitert das Anlegen, verschwindet die Karte mit Hinweis wieder und der Text steht im Feld", async ({ page }) => {
  await zumBoard(page);
  await expect(karte(page, p.a)).toBeVisible();
  await page.route("**/api/aufgaben", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ fehler: "Platte voll" }) });
    else await route.continue();
  });
  const eingabe = page.getByRole("textbox", { name: "Neue Aufgabe" });
  await eingabe.fill("Geht schief");
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast.fehler")).toBeVisible();
  await expect(spalte(page, "offen").getByText("Geht schief")).toHaveCount(0);
  await expect(eingabe).toHaveValue("Geht schief");
  await expect(eingabe).toBeFocused();
});

test("Schnelles doppeltes Enter legt nur eine Aufgabe an (kein doppeltes Netzwerk)", async ({ page }) => {
  await zumBoard(page);
  await expect(karte(page, p.a)).toBeVisible();
  let posts = 0;
  await page.route("**/api/aufgaben", async (route) => { if (route.request().method() === "POST") posts++; await route.continue(); });
  await page.getByRole("textbox", { name: "Neue Aufgabe" }).fill("Nur einmal");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(spalte(page, "offen").getByText("Nur einmal")).toHaveCount(1);
  expect(posts).toBe(1);
});

test("Menü an der Karte: Änderung erscheint sofort, auch wenn die Werkstatt langsam ist; Fehler rollt zurück", async ({ page }) => {
  await zumBoard(page);
  await expect(karte(page, p.b)).toBeVisible();
  let frei;
  const tor = new Promise((r) => { frei = r; });
  await page.route("**/api/aufgaben/**", async (route) => { if (route.request().method() === "PATCH") await tor; await route.continue(); });
  await karte(page, p.b).click({ button: "right" });
  await page.locator('[data-menue="prio-hoch"]').click();
  await expect(karte(page, p.b).locator(".au-chip.prio.hoch")).toBeVisible({ timeout: 400 });
  expect(feld(vault, p.b, "prioritaet")).toBe("normal"); // auf der Platte noch nichts
  frei();
  await expect.poll(() => feld(vault, p.b, "prioritaet")).toBe("hoch");
  // Fehler: zurückrollen
  await page.unroute("**/api/aufgaben/**");
  await page.route("**/api/aufgaben/**", (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ fehler: "kaputt" }) }) : route.continue());
  await karte(page, p.b).click({ button: "right" });
  await page.locator('[data-menue="prio-niedrig"]').click();
  await expect(page.locator(".toast.fehler")).toBeVisible();
  await expect(karte(page, p.b).locator(".au-chip.prio.hoch")).toBeVisible();
  await expect(karte(page, p.b).locator(".au-chip.prio.niedrig")).toHaveCount(0);
});

test("Datumsauswahl im Kartenmenü: „Datum wählen …“ öffnet den Kalender, Schnellwahl „Morgen“ setzt die Fälligkeit", async ({ page }) => {
  await zumBoard(page);
  await karte(page, p.c).click({ button: "right" });
  await page.locator('[data-menue="faellig-datum"]').click();
  const kal = page.getByRole("dialog", { name: "Datum wählen" });
  await expect(kal).toBeVisible();
  await kal.getByRole("button", { name: "Morgen" }).click();
  const morgen = new Date(); morgen.setDate(morgen.getDate() + 1);
  await expect.poll(() => feld(vault, p.c, "faellig")).toBe(morgen.toLocaleDateString("sv-SE"));
  await expect(karte(page, p.c).locator(".au-chip.faellig")).toContainText("Morgen");
  await expect(karte(page, p.c)).toBeFocused(); // Fokus bleibt nach der Aktion auf der Karte
});

test("Ziehen: Karte schwebt angehoben am Zeiger, Platzhalter zeigt die Stelle, die Zielspalte hebt sich; Esc bricht ab, Loslassen speichert", async ({ page }) => {
  await zumBoard(page);
  await expect(karte(page, p.b)).toBeVisible();
  const q = await karte(page, p.b).boundingBox();
  const ziel = await spalte(page, "in-arbeit").boundingBox();
  await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width / 2 + 2, q.y + q.height / 2 + 1); // unter der Schwelle: noch kein Ziehen
  await expect(page.locator(".au-schwebt")).toHaveCount(0);
  await page.mouse.move(ziel.x + ziel.width / 2, ziel.y + 200, { steps: 8 });
  const geist = page.locator(".au-schwebt");
  await expect(geist).toHaveCount(1);
  await expect(geist).toHaveClass(/angehoben/);
  await expect.poll(() => geist.evaluate((e) => getComputedStyle(e).scale)).toBe("1.035");
  expect(await geist.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe("none");
  await expect(page.locator(".au-karte.platzhalter")).toHaveCount(1);
  await expect(spalte(page, "in-arbeit")).toHaveClass(/au-ziel/);
  await expect(spalte(page, "in-arbeit").locator(".au-karte.platzhalter")).toHaveCount(1); // Platzhalter liegt in der Zielspalte
  await expect(spalte(page, "offen")).not.toHaveClass(/au-ziel/);
  // Esc: zurück an den Ursprung, nichts geschrieben
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".au-schwebt")).toHaveCount(0);
  await expect(page.locator(".au-karte.platzhalter")).toHaveCount(0);
  expect(await titelIn(page, "offen")).toEqual(["Lieferanten anrufen", "Steuer vorbereiten", "Angebot prüfen"]);
  expect(feld(vault, p.b, "status")).toBe("offen");
  // Noch einmal und loslassen
  await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
  await page.mouse.down();
  await page.mouse.move(ziel.x + ziel.width / 2, ziel.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".au-schwebt")).toHaveCount(0);
  await expect(spalte(page, "in-arbeit").locator(`[data-pfad="${p.b}"]`)).toBeVisible();
  await expect.poll(() => feld(vault, p.b, "status")).toBe("in-arbeit");
  expect(await titelIn(page, "in-arbeit")).toEqual(["Website-Text schreiben", "Steuer vorbereiten"]);
  // der Klick nach dem Ziehen öffnet die Datei nicht
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
});

test("Ein einfacher Klick ohne Ziehen öffnet weiterhin die Datei", async ({ page }) => {
  await zumBoard(page);
  await karte(page, p.a).click();
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("Dialoge mit Bausteinen: Neue Notiz (Ordner-Auswahl, Textfeld) und Schnell merken (Textbereich), Fokus und Tastatur", async ({ page }) => {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]");
  await page.keyboard.press("Meta+n");
  const dlg = page.locator(".dialog");
  await expect(dlg).toBeVisible();
  const titel = dlg.getByRole("textbox");
  await expect(titel).toBeFocused();
  const ordner = dlg.getByRole("combobox", { name: /Ordner/ });
  await ordner.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".bs-liste")).toBeVisible();
  await page.keyboard.press("Escape"); // schließt nur die Liste, nicht den Dialog
  await expect(page.locator(".bs-liste")).toHaveCount(0);
  await expect(dlg).toBeVisible();
  await expect(ordner).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+m");
  const text = page.locator('[data-feld="text"]');
  await expect(text).toBeFocused();
  const h0 = (await text.boundingBox()).height;
  await text.fill(Array.from({ length: 10 }, (_, i) => `Zeile ${i}`).join("\n"));
  await expect.poll(async () => (await text.boundingBox()).height).toBeGreaterThan(h0 + 40);
});

for (const schema of ["hell", "dunkel"]) {
  test(`Bilder (${schema}): Board, Filter, Ziehen, Datum, Dialoge`, async ({ page }) => {
    const ziel = bilderOrdner();
    test.skip(!ziel, "nur mit KORTEX_BILDER");
    await schirm(page, schema);
    await page.setViewportSize({ width: 1440, height: 900 });
    await zumBoard(page);
    await expect(karte(page, p.a)).toBeVisible();
    await page.waitForTimeout(300);
    const s = (n, opt = {}) => page.screenshot({ path: join(ziel, `${n}-${schema}.png`), ...opt });
    await s("board");
    await page.locator('[data-filter="prio"]').click();
    await page.waitForTimeout(250);
    await s("board-filter-offen", { clip: { x: 250, y: 0, width: 900, height: 330 } });
    await page.getByRole("option", { name: "Hoch" }).click();
    await page.waitForTimeout(250);
    await s("board-filter-aktiv", { clip: { x: 250, y: 0, width: 1190, height: 260 } });
    await page.getByRole("button", { name: "Priorität zurücksetzen" }).click();
    // Ziehen mitten in der Bewegung
    const q = await karte(page, p.b).boundingBox();
    const z = await spalte(page, "in-arbeit").boundingBox();
    await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + z.width / 2 + 12, z.y + 150, { steps: 10 });
    await page.waitForTimeout(350);
    await s("board-ziehen");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // Kartenmenü und Datum
    await karte(page, p.c).hover();
    await karte(page, p.c).locator("[data-aufgabe-menue]").click();
    await page.waitForTimeout(250);
    await s("board-kartenmenue");
    await page.locator('[data-menue="faellig-datum"]').click();
    await page.waitForTimeout(300);
    await s("board-datum");
    await page.keyboard.press("Escape");
    // Dialoge
    await page.keyboard.press("Meta+n");
    await page.waitForTimeout(300);
    await s("dialog-neu");
    await page.locator(".dialog").getByRole("combobox").click();
    await page.waitForTimeout(250);
    await s("dialog-neu-auswahl");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+Shift+m");
    await page.locator('[data-feld="text"]').fill("Eine flüchtige Idee,\nüber mehrere Zeilen,\nfür später.");
    await page.waitForTimeout(250);
    await s("dialog-merken");
    await page.keyboard.press("Escape");
    writeFileSync(join(vault, "00_inbox", "frisch.md"), "# Frisch\n");
    writeFileSync(join(vault, "05_aufgaben", "2026-10-20-lieferanten-anrufen.md"), lese(vault, p.a) + "\nGeändert.\n");
    await page.goto(server.url);
    await page.waitForSelector('[data-st="geaendert"]');
    await page.locator('[data-st="geaendert"]').click();
    await page.waitForTimeout(350);
    await s("dialog-sichern");
    await page.keyboard.press("Escape");
    await page.locator('[data-st="einstellungen"]').first().click();
    await page.waitForTimeout(300);
    await s("menue-einstellungen");
    await page.keyboard.press("Escape");
    await page.locator('[data-st="nutzung"]').first().click();
    await page.waitForTimeout(350);
    await s("dialog-nutzung");
  });
}
