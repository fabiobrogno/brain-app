// Hauptfenster (Paket P3): Kopfzeile mit Suchfeld, Seitenleiste (Schnell erfassen, Zähler, Favoriten, Ordner, KI-Zeile), „Frag deinen Vault“ als rechte Spalte,
// Statusleiste (Wörter, Format, Platz für P7), Tastatur (⌘1–3, ⌘K, ⌘J, ⌘\), Palette mit Ausweg zu Frag, enge Fenster, hell und dunkel, „Bewegung reduzieren“.
// Bilder: UI_P3_BILDER=/Ordner npx playwright test hauptfenster.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

const BILDER = process.env.UI_P3_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name) => { if (BILDER) { await page.waitForTimeout(400); await page.screenshot({ path: join(BILDER, `${name}.png`) }); } };

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); server = null; });

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
// Erkannte KI-Programme (GET /api/ki/erkennen, nur lesend); die KI-Zeile liest bewusst nicht /api/ki/konten (das legt beim Lesen Konten an)
const erkennen = (ids) => ({ agenten: ids.map((id) => ({ id, name: id, version: "1", pfad: "/usr/bin/" + id })), katalog: ids.map((id) => ({ id, gefunden: true, version: "1", quelle: "cli" })), cursorDa: false, programme: [] });
async function start(page, { breite = 1440, hoehe = 900, pfad = NOTIZ, ki = ["claude", "codex", "cursor"] } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  await mockeV2(page, vault);
  await page.route("**/api/ki/erkennen**", (r) => r.fulfill({ json: erkennen(ki) }));
  await page.goto(server.url + (pfad ? "?pfad=" + encodeURIComponent(pfad) : ""));
  await page.waitForFunction(() => window.__studioBereit === true);
  if (pfad) await page.waitForSelector(".cm-content .cm-line");
}
const box = (page, sel) => page.locator(sel).first().boundingBox();
const gleitet = (page) => page.evaluate(() => new Promise((ok) => setTimeout(ok, 450)));

test("Aufbau: Kopfzeile mit Suchfeld in der Mitte, Knöpfe rechts; Seitenleiste mit Vault, Schnell erfassen, Bereichen, Frag und KI-Zeile; Statusleiste mit Wörtern und Format", async ({ page }) => {
  await start(page);
  const kopf = await box(page, "#kopf");
  const seite = await box(page, "#seite");
  expect(kopf.height).toBe(44);
  expect(Math.round(kopf.x)).toBe(Math.round(seite.width)); // die Kopfzeile beginnt rechts neben der Seitenleiste
  const suche = await box(page, "#kopf-suche"), frag = await box(page, "#knopf-frage"), verlauf = await box(page, "#knopf-verlauf"), info = await box(page, "#knopf-info");
  expect(suche.x).toBeLessThan(verlauf.x);
  expect(verlauf.x).toBeLessThan(info.x);
  expect(info.x).toBeLessThan(frag.x); // rechts: Verlauf, Seitenleiste (Eigenschaften), Frag
  await expect(page.locator("#kopf-suche")).toContainText("Suchen oder Befehl");
  await expect(page.locator("#kopf-suche kbd")).toHaveText(["⌘", "K"]);
  await expect(page.locator("#knopf-frage")).toContainText("Frag");
  // Seitenleiste
  await expect(page.locator("#vault-wechsler")).toBeVisible();
  await expect(page.locator("#fuss-merken")).toContainText("Schnell erfassen");
  await expect(page.locator("#fuss-merken")).toContainText("Leer");
  await expect(page.locator("#fuss-neu")).toBeVisible();
  const namen = await page.locator("#bereiche .eintrag .name").allTextContents();
  expect(namen).toEqual(["Posteingang", "Alle Notizen", "Aufgaben", "Frag deinen Vault"]);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("3");
  await expect(page.locator('[data-bereich="alle"] .zahl')).toHaveText("12");
  await expect(page.locator('[data-abschnitt="ordner"]')).toBeVisible();
  // Wissen und Archiv gibt es weiter, jetzt unter „Sichten“
  await expect(page.locator('[data-abschnitt="sichten"] [data-bereich="wissen"]')).toBeVisible();
  await expect(page.locator('[data-abschnitt="sichten"] [data-bereich="archiv"]')).toBeVisible();
  // KI-Zeile unten mit Logos: drei erkannte Programme (Claude, Codex, Cursor)
  const ki = page.locator("#ki-zeile");
  await expect(ki).toBeVisible();
  await expect(ki).toContainText("3 KIs");
  await expect(ki.locator(".ki-logo")).toHaveCount(3);
  const kiBox = await ki.boundingBox(), seiteBox = await box(page, "#seite");
  expect(kiBox.y + kiBox.height).toBeLessThanOrEqual(seiteBox.y + seiteBox.height + 1);
  // Statusleiste: Wörter und Format der offenen Notiz, leerer Platz für P7
  await expect(page.locator('[data-st="woerter"]')).toHaveText("14 Wörter");
  await expect(page.locator('[data-st="format"]')).toHaveText("Markdown");
  await expect(page.locator('[data-st="platz-kontingent"]')).toBeHidden();
  await expect(page.locator('[data-st="platz-kontingent"]')).toHaveAttribute("data-slot", "kontingent");
  await expect(page.locator('[data-st="sync"]')).toBeVisible();
  await bild(page, "01-aufbau");
});

test("KI-Zeile: ohne erkannte KI „KI verbinden“; offene Rückfragen als „braucht dich“; sie liest nichts, was Konten anlegt", async ({ page }) => {
  const abgefragt = [];
  page.on("request", (r) => { if (/\/api\/ki\/konten/.test(r.url())) abgefragt.push(r.url()); });
  await start(page, { ki: [] });
  await expect(page.locator("#ki-zeile")).toContainText("KI verbinden");
  await expect(page.locator("#ki-zeile .ki-logo")).toHaveCount(0);
  expect(abgefragt).toEqual([]); // GET /api/ki/konten gleicht die Konten-Liste ab (Nebenwirkung): die Seitenleiste fragt es nie beim Start
  // offene Rückfragen: „1 braucht dich“
  await page.route("**/api/rueckfragen", (r) => r.fulfill({ json: { verfuegbar: true, offen: 2 } }));
  await page.route("**/api/ki/erkennen**", (r) => r.fulfill({ json: erkennen(["claude"]) }));
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(page.locator("#ki-zeile")).toContainText("1 KI · 2 brauchen dich");
  await expect(page.locator("#ki-zeile")).toHaveAttribute("data-zustand", "braucht");
});

test("Tastatur: ⌘1 Posteingang, ⌘2 Alle Notizen, ⌘3 Aufgaben, ⌘K Palette, ⌘J Frag, ⌘\\ Eigenschaften; Esc schließt", async ({ page }) => {
  await start(page);
  const app = page.locator("#app");
  await page.keyboard.press("Meta+1");
  await expect(page.locator("#liste-titel")).toContainText("Posteingang");
  await expect(page.locator('[data-bereich="inbox"]')).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Meta+3");
  await expect(app).toHaveAttribute("data-modus", "aufgaben");
  await expect(page.locator("#pfad")).toContainText("Aufgaben");
  await page.keyboard.press("Meta+2");
  await expect(page.locator("#liste-titel")).toContainText("Alle Notizen");
  await expect(app).toHaveAttribute("data-modus", "liste");
  // ⌘\ blendet die Eigenschaften aus und wieder ein
  await expect(app).toHaveAttribute("data-info", "an");
  await page.keyboard.press("Meta+\\");
  await expect(app).toHaveAttribute("data-info", "aus");
  await expect(page.locator("#knopf-info")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Meta+\\");
  await expect(app).toHaveAttribute("data-info", "an");
  // ⌘K und Esc
  await page.keyboard.press("Meta+k");
  await expect(page.locator(".palette input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".palette")).toHaveCount(0);
  // das Suchfeld in der Kopfzeile öffnet dieselbe Palette
  await page.click("#kopf-suche");
  await expect(page.locator(".palette input")).toBeFocused();
  await page.keyboard.press("Escape");
  // ⌘J: Frag auf, Esc zu
  await page.keyboard.press("Meta+j");
  await expect(app).toHaveAttribute("data-frage", "an");
  await expect(page.locator('[data-bereich]').first()).toBeVisible();
  await expect(page.locator('[data-aktion="frage-oeffnen"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-frage="panel"] button').first().focus();
  await page.keyboard.press("Escape");
  await expect(app).not.toHaveAttribute("data-frage", "an");
  // ⌘1–3 auch aus dem Editor heraus, nicht aber, solange ein Dialog offen ist
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+1");
  await expect(page.locator("#liste-titel")).toContainText("Posteingang");
});

test("Frag deinen Vault: öffnet gleitend als rechte Spalte (kein Sprung), schiebt den Editor beiseite, schließt gleitend; Seitenleisten-Zeile und Kopf-Knopf zeigen den Zustand", async ({ page }) => {
  await start(page);
  const app = page.locator("#app");
  const spalten = () => page.evaluate(() => getComputedStyle(document.getElementById("app")).gridTemplateColumns.split(" ").map(parseFloat));
  const vorher = await spalten();
  await page.click("#knopf-frage");
  // mitten im Gleiten ist die rechte Spalte weder am Anfang noch am Ziel
  await page.waitForTimeout(80);
  const mitte = await spalten();
  await gleitet(page);
  const nachher = await spalten();
  expect(nachher[3]).toBe(380);
  expect(mitte[3]).not.toBe(vorher[3]);
  expect(Math.abs(mitte[3] - nachher[3]) + Math.abs(mitte[3] - vorher[3])).toBeGreaterThan(0);
  expect(nachher[2]).toBeLessThan(vorher[2] + 100); // der Editor gibt Platz ab (Eigenschaften waren schon offen: 304 → 380)
  expect(await box(page, '[data-frage="panel"]')).toMatchObject({ width: 380 });
  await expect(page.locator("#knopf-frage")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#info")).toBeHidden(); // die Eigenschaften machen den Platz frei
  await bild(page, "02-frage-offen");
  // Eigenschaften-Knopf holt sie zurück und schließt Frag
  await page.click("#knopf-info");
  await expect(app).not.toHaveAttribute("data-frage", "an");
  await gleitet(page);
  await expect(page.locator('[data-frage="panel"]')).toBeHidden();
  await expect(page.locator("#info")).toBeVisible();
  expect((await spalten())[3]).toBe(vorher[3]);
  // über die Zeile in der Seitenleiste
  await page.click('[data-aktion="frage-oeffnen"]');
  await expect(app).toHaveAttribute("data-frage", "an");
  await page.click('[data-aktion="frage-zu"]');
  await expect(page.locator('[data-frage="panel"]')).toBeHidden();
});

test("Frag deinen Vault mit „Bewegung reduzieren“: ohne Gleiten, sofort da und sofort weg", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page);
  const breite = () => page.evaluate(() => getComputedStyle(document.getElementById("app")).gridTemplateColumns.split(" ").map(parseFloat)[3]);
  await page.click("#knopf-frage");
  await page.waitForTimeout(30);
  expect(await breite()).toBe(380);
  await expect(page.locator('[data-frage="panel"]')).toBeVisible();
  await page.click("#knopf-frage");
  await expect(page.locator('[data-frage="panel"]')).toBeHidden({ timeout: 300 });
});

test("Palette: Zuletzt geöffnet, Befehle mit Tasten, Ausweg „Frag deinen Vault“; ⌘↵ öffnet Frag mit dem getippten Text im Feld", async ({ page }) => {
  await page.route("**/api/frage/bereit", (r) => r.fulfill({ json: { vault: "vault", vertraut: true, claude: true, kontenDefekt: false, laeuft: false, konten: [{ id: "k_aaaa0001", name: "Arbeit", programm: "claude", erlaubt: true }], grenzen: { frageMax: 2000, frist: 60000 }, modelle: ["klein", "mittel"] } }));
  await start(page);
  await page.keyboard.press("Meta+k");
  const pal = page.locator(".palette");
  await expect(pal.locator(".pal-gruppe").first()).toHaveText("Zuletzt geöffnet");
  await expect(pal.locator(".pal-esc")).toHaveText("esc");
  await expect(pal.locator('[data-pal="befehl"]', { hasText: "Aufgaben-Board öffnen" }).locator("kbd")).toHaveText(["⌘", "3"]);
  await expect(pal.locator(".pal-fuss")).toContainText("Frag deinen Vault");
  await bild(page, "03-palette");
  await page.keyboard.type("Was haben wir zu Kaffee entschieden");
  await expect(pal.locator('[data-pal="frage"]')).toContainText("Frag deinen Vault");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("#app")).toHaveAttribute("data-frage", "an");
  await expect(page.locator('[data-frage="eingabe"]')).toHaveValue("Was haben wir zu Kaffee entschieden");
  await expect(page.locator('[data-frage="eingabe"]')).toBeFocused();
  await expect(page.locator('[data-aktion="frage-senden"]')).toBeEnabled();
  // gesendet wurde nichts
  await expect(page.locator('[data-frage="ausgabe"] > *')).toHaveCount(0);
  // der Ausweg als Eintrag: Pfeil nach unten bis „Frag deinen Vault“, Enter
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("zzzqqq");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-frage="eingabe"]')).toHaveValue("zzzqqq");
});

test("Favoriten: einzelne Notizen unter der Zeile „Favoriten“ in der Seitenleiste, Klick öffnet sie", async ({ page }) => {
  await start(page);
  await expect(page.locator('[data-abschnitt="favoriten"]')).toBeHidden();
  await page.click("#w-favorit");
  await expect(page.locator('[data-abschnitt="favoriten"] [data-favorit]')).toHaveText("Reise nach Lissabon");
  await page.locator('[data-bereich="wissen"]').click();
  await page.locator('[data-karte]').first().click();
  await expect(page.locator("#pfad .krume.aktuell")).not.toHaveText("Reise nach Lissabon");
  await page.click('[data-favorit]');
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
});

test("Aufgaben-Board: Kopfzeile bleibt (Brotkrume, Suche, Knöpfe), Notiz-Werkzeuge entfallen", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+3");
  await expect(page.locator("#kopf")).toBeVisible();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Aufgaben");
  await expect(page.locator("#werkzeuge")).toBeHidden();
  await expect(page.locator("#kopf-suche")).toBeVisible();
  await expect(page.locator("#knopf-frage")).toBeVisible();
  await expect(page.locator('[data-st="woerter"]')).toBeHidden();
  await bild(page, "04-board");
  // Frag schiebt auch das Board beiseite (rechte Spalte), das Board behält den Rest
  const vorher = await box(page, "#aufgaben-host");
  await page.keyboard.press("Meta+j");
  await gleitet(page);
  const nachher = await box(page, "#aufgaben-host"), p = await box(page, '[data-frage="panel"]');
  expect(Math.round(vorher.width - nachher.width)).toBe(380);
  expect(nachher.x + nachher.width).toBeLessThanOrEqual(p.x + 1);
});

test("Leere Zustände: Vault ohne Notizen zeigt je einen Satz und eine Aktion in Liste und Editor", async ({ page }) => {
  server.stopp();
  ({ vault } = baueVault({ leer: true }));
  server = await starteServer(vault);
  await start(page, { pfad: null });
  await expect(page.locator('[data-leer="liste"]')).toBeVisible();
  await expect(page.locator("#leer")).toBeVisible();
  await expect(page.locator('[data-st="woerter"]')).toBeHidden();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Alle Notizen");
  await bild(page, "05-leer");
});

for (const schema of ["light", "dark"]) {
  test(`Alle Bereiche sichtbar und ohne Überlauf (${schema}), Texte lesbar`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema });
    await start(page);
    for (const sel of ["#seite", "#kopf", "#liste", "#haupt", "#info", "#status", "#vault-wechsler", "#fuss-merken", "#bereiche", "#ki-zeile", "#kopf-suche", "#knopf-frage", "#knopf-verlauf", "#knopf-info"]) {
      await expect(page.locator(sel), sel).toBeVisible();
    }
    const m = await page.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); };
      const grund = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba?\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return "rgb(255,255,255)"; };
      const p = (sel) => { const e = document.querySelector(sel); return kontrast(getComputedStyle(e).color, grund(e)); };
      const kopf = document.getElementById("kopf"), st = document.getElementById("status"), se = document.getElementById("seite");
      return { schema: matchMedia("(prefers-color-scheme: dark)").matches, ueberlaufKopf: kopf.scrollWidth - kopf.clientWidth, ueberlaufStatus: st.scrollWidth - st.clientWidth, ueberlaufSeite: se.scrollWidth - se.clientWidth,
        k: { eintrag: p("#bereiche .eintrag .name"), kopfSuche: p(".kopf-suche-text"), frag: p("#knopf-frage"), ki: p("#ki-zeile .ki-text"), erfassen: p(".erfassen-text") }, seiteGrund: grund(se) };
    });
    expect(m.schema).toBe(schema === "dark");
    expect(m.ueberlaufKopf).toBe(0); expect(m.ueberlaufStatus).toBe(0); expect(m.ueberlaufSeite).toBe(0);
    expect(m.k.eintrag).toBeGreaterThan(4.5); expect(m.k.frag).toBeGreaterThan(4.5); expect(m.k.ki).toBeGreaterThan(4.5); expect(m.k.erfassen).toBeGreaterThan(4.5);
    expect(m.k.kopfSuche).toBeGreaterThan(3); // Platzhalter (--text-3): mindestens 3:1
    expect(schema === "dark" ? m.seiteGrund : "").toBe(schema === "dark" ? "rgb(18, 18, 18)" : "");
    await bild(page, `06-alles-${schema}`);
  });
}

for (const breite of [1100, 1180]) {
  test(`Enges Fenster ${breite} px: Kopfzeile, Seitenleiste und Statusleiste laufen nicht über; Frag liegt darüber, wenn kein Platz ist; Editor bleibt lesbar`, async ({ page }) => {
    await start(page, { breite, hoehe: 700 });
    const r = await page.evaluate(() => {
      const aus = (id) => { const e = document.getElementById(id); return e.scrollWidth - e.clientWidth; };
      return { kopf: aus("kopf"), status: aus("status"), seite: aus("seite"), body: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(r).toEqual({ kopf: 0, status: 0, seite: 0, body: 0 });
    for (const sel of ["#kopf-suche", "#knopf-frage", "#knopf-verlauf", "#knopf-info", "#fuss-merken", "#ki-zeile", '[data-st="einstellungen"]']) await expect(page.locator(sel), sel).toBeInViewport();
    const editor = await box(page, "#editor");
    expect(editor.width).toBeGreaterThanOrEqual(420);
    // alle Knöpfe der Kopfzeile liegen innerhalb der Kopfzeile
    const kopf = await box(page, "#kopf");
    for (const sel of ["#kopf-suche", "#knopf-frage", "#knopf-verlauf", "#knopf-info"]) { const b = await box(page, sel); expect(b.x + b.width, sel).toBeLessThanOrEqual(kopf.x + kopf.width + 0.5); }
    await bild(page, `07-eng-${breite}`);
    await page.keyboard.press("Meta+j");
    await expect(page.locator("#app")).toHaveAttribute("data-frage-modus", "deckt");
    await gleitet(page);
    const nachher = await box(page, "#editor");
    expect(Math.round(nachher.width)).toBe(Math.round(editor.width)); // der Editor wird nicht gequetscht: das Panel liegt darüber
    const p = await box(page, '[data-frage="panel"]');
    expect(p.x + p.width).toBeLessThanOrEqual(breite + 0.5);
    await bild(page, `08-eng-frage-${breite}`);
    await page.keyboard.press("Escape");
    await page.locator('[data-frage="panel"]').focus().catch(() => {});
  });
}

test("Breites Fenster 1440: Frag schiebt den Editor beiseite (kein Überlappen), Editor behält mindestens 400 px", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+j");
  await expect(page.locator("#app")).toHaveAttribute("data-frage-modus", "schiebt");
  await gleitet(page);
  const e = await box(page, "#editor"), p = await box(page, '[data-frage="panel"]');
  expect(e.width).toBeGreaterThanOrEqual(400);
  expect(e.x + e.width).toBeLessThanOrEqual(p.x + 1);
});

test("Alt-Leer-Feld und Stift in der Seitenleiste: Schnell erfassen und Neue Notiz öffnen ihre Dialoge", async ({ page }) => {
  await start(page);
  await page.click("#fuss-merken");
  await expect(page.locator('[data-dialog="merken"], .dialog').first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.click("#fuss-neu");
  await expect(page.locator('[data-feld="titel"]')).toBeVisible();
});
