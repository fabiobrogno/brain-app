// Seite „Einstellungen“ (Paket P5), gegen die echte Werkstatt mit Wegwerf-Vault und eigenem Support-Ordner (nie die echten Orte des Rechners).
// Öffnen (⌘, · Zahnrad-Menü · Adresse), Esc/„Zurück“, jeder Bereich hell und dunkel, sofort speichern (Schalter, Segment, Menü, Regler, Liste, Textfeld 700 ms),
// Konflikt (409 → neu laden + Hinweis), Änderung von außen (CLI) erscheint live, Suche (Treffer, Markierung, Zählung, null Treffer, ⌘F, ↓), Sprungziel, Vertrauen,
// enge Fenster. UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
const BEFEHLE = JSON.parse(readFileSync(new URL("../../Ressourcen/gemeinsam/tastenkuerzel-register.json", import.meta.url), "utf8")).befehle.length; // eine Zeile je Befehl im Bereich „Tastenkürzel“
const CONFIG = { name: "Kortex", automatik: { tageslauf: "probe", ernteOhneThema: ["Gesundheit", "Gehalt"], ernteNichtIn: ["Tagebuch/", "Finanzen/privat/"] } };
test.beforeEach(async () => {
  ({ vault } = baueVault());
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify(CONFIG, null, 2) + "\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `einst-${name}.png`);
const foto = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: shot(name) }); }; // die Seite blendet 180 ms ein
const config = () => JSON.parse(readFileSync(join(vault, "brain.config.json"), "utf8"));
const appDatei = () => { const p = join(server.support, "einstellungen.json"); return existsSync(p) && readFileSync(p, "utf8").trim() ? JSON.parse(readFileSync(p, "utf8")) : {}; };
const seite = (page) => page.locator("[data-einstellungen]");
const IDS = ["allgemein", "darstellung", "tasten", "mitteilungen", "vaults", "ki", "automatik", "sicherung", "mobil", "datenschutz", "erweitert", "ueber"];
const NAMEN = { allgemein: "Allgemein", darstellung: "Darstellung", tasten: "Tastenkürzel", mitteilungen: "Mitteilungen", vaults: "Vaults", ki: "KI & Konten", automatik: "Pflege & Automatik", sicherung: "Sicherung & GitHub", mobil: "iPhone & iPad", datenschutz: "Datenschutz", erweitert: "Erweitert", ueber: "Über Kortex" };

async function start(page, { hash = "", breite = 1440, hoehe = 900, dunkel = false } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url + hash);
  await page.waitForSelector("#app:not([hidden])");
  await expect(page.locator("#vault-name")).toBeVisible();
  await page.waitForFunction(() => window.__studioBereit === true);
}
const oeffne = async (page, bereich = "allgemein") => {
  // Nach dem Neuladen öffnet die Seite aus der Adresse (#einstellungen/…) von selbst, und zwar asynchron: erst abwarten, bis sie steht — sonst überschreibt sie den Bereich, den dieser Aufruf gleich wählt.
  if ((await page.evaluate(() => location.hash)).startsWith("#einstellungen")) await expect(page.locator('.e-punkt[aria-current="true"]')).toBeVisible();
  await page.evaluate((b) => { location.hash = `#einstellungen/${b}`; }, bereich);
  await expect(seite(page)).toBeVisible();
  await expect(page.locator(`.e-punkt[data-bereich="${bereich}"][aria-current="true"]`)).toBeVisible();
};
const zeileVon = (page, id) => page.locator(`[data-zeile="${id}"]`);
const wartePut = (page) => page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");

test("Öffnen: ⌘, öffnet die Seite, Esc und „Zurück zu Kortex“ schließen sie, der Fokus kehrt zurück, die Adresse wird gepflegt", async ({ page }) => {
  await start(page);
  await expect(seite(page)).toBeHidden();
  await page.keyboard.press("Meta+,");
  await expect(seite(page)).toBeVisible();
  await expect(page.locator("[data-einst=titel]")).toHaveText("Allgemein");
  await expect(page.locator(".e-zurueck")).toContainText("Zurück zu Kortex");
  await expect(page.locator(".e-zurueck kbd")).toHaveText("esc");
  expect(await page.evaluate(() => location.hash)).toBe("#einstellungen/allgemein");
  await expect(page.locator("#app")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe("");
  await expect(page.locator("#app")).not.toHaveAttribute("inert", "");
  await page.keyboard.press("Meta+,");
  await expect(seite(page)).toBeVisible();
  await page.click('[data-aktion="einst-zurueck"]');
  await expect(seite(page)).toBeHidden();
  // über das Zahnrad der Statusleiste
  await page.click('[data-st="einstellungen"]');
  await page.click('[data-menue="einstellungen-seite"]');
  await expect(seite(page)).toBeVisible();
  // das Menü der Statusleiste gibt es weiter (nichts ging verloren): Darstellung, Lizenzen …
  await page.keyboard.press("Escape");
  await page.click('[data-st="einstellungen"]');
  await expect(page.locator('[data-menue="lizenzen"]')).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Adresse #einstellungen/<bereich>?ziel= beim Start; die Menü-Befehlsschnittstelle der App (window.studio.befehl) öffnet die Seite", async ({ page }) => {
  await start(page, { hash: "#einstellungen/vaults" });
  await expect(seite(page)).toBeVisible();
  await expect(page.locator("[data-einst=titel]")).toHaveText("Vaults");
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  await page.evaluate(() => window.studio.befehl("einstellungen"));
  await expect(seite(page)).toBeVisible();
  await expect(page.locator("[data-einst=titel]")).toHaveText("Vaults"); // sie öffnet dort, wo man zuletzt war
});

for (const dunkel of [false, true]) {
  test(`Jeder Bereich (${dunkel ? "dunkel" : "hell"}): Titel, Gruppen, Zeilen da, nichts läuft über, keine Fehler in der Konsole`, async ({ page }) => {
    const fehler = [];
    page.on("pageerror", (e) => fehler.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });
    await start(page, { dunkel });
    await oeffne(page, "allgemein");
    const gruppen = await page.locator(".e-gruppe").allTextContents();
    expect(gruppen.map((g) => g.toLowerCase())).toEqual(["kortex", "wissen", "verbindungen", "mehr"]);
    await expect(page.locator(".e-punkt")).toHaveCount(12);
    expect(await page.locator(".e-punkt .t").allTextContents()).toEqual(IDS.map((i) => NAMEN[i]));
    for (const id of IDS) {
      await page.click(`.e-punkt[data-bereich="${id}"]`);
      await expect(page.locator("[data-einst=titel]")).toHaveText(NAMEN[id]);
      await expect(page.locator(`.e-punkt[data-bereich="${id}"]`)).toHaveAttribute("aria-current", "true");
      expect(await page.evaluate(() => location.hash)).toBe(`#einstellungen/${id}`);
      const n = await page.locator("[data-zeile]").count();
      expect(n, id).toBeGreaterThan(0);
      await page.waitForTimeout(250);
      const ueber = await page.evaluate(() => { const i = document.querySelector("[data-einst=inhalt]"); return i.scrollWidth - i.clientWidth; });
      expect(ueber, `${id}: waagerechter Überlauf`).toBeLessThanOrEqual(1);
      await foto(page, `${id}-${dunkel ? "dunkel" : "hell"}`);
    }
    expect(fehler).toEqual([]);
  });
}

test("Platzhalter: iPhone „bald“, Tastenkürzel zeigen die Belegung des Registers (der Editor: tastenkuerzel.spec.mjs); KI & Konten ist keine Platzhalter-Seite mehr (Programme, Matrix, Schutz, Pflege, Eintragungen)", async ({ page }) => {
  await start(page);
  await oeffne(page, "mobil");
  await expect(page.locator(".e-punkt[data-bereich=mobil] .e-bald")).toHaveText("bald");
  await expect(zeileVon(page, "mobil-bald")).toContainText("Kommt mit der iPhone-App");
  await page.click('.e-punkt[data-bereich="tasten"]');
  await expect(zeileVon(page, "kz-neue-notiz").locator("kbd")).toHaveText(["⌘", "N"]);
  await expect(zeileVon(page, "kz-schnell-merken").locator("kbd")).toHaveText(["⇧", "⌘", "M"]);
  await page.click('.e-punkt[data-bereich="ki"]');
  await expect(page.locator(".e-intro")).toContainText("Hier siehst du, welche Konten angemeldet sind");
  for (const id of ["ki-konten", "ki-zugriff", "ki-schutz", "ki-pflege", "ki-hooks", "ki-git", "ki-dienst", "ki-aktivitaet", "ki-ehrlich"]) await expect(zeileVon(page, id)).toBeAttached();
  await expect(page.locator('.dialog[data-dialog="ki-konten"]')).toHaveCount(0); // der frühere Dialog ist in den Bereich umgezogen
});

test("Sofort speichern: Schalter und Segment schreiben in brain.config.json (wie `brain einstellungen`), ‚Gespeichert‘ erscheint, nach dem Neuladen steht es noch da", async ({ page }) => {
  await start(page);
  await oeffne(page, "automatik");
  await expect(page.locator('[data-schluessel="tageslauf"] [data-wert="probe"]')).toHaveAttribute("aria-checked", "true");
  const put1 = wartePut(page);
  await page.click('[data-schluessel="tageslauf"] [data-wert="an"]');
  const r1 = await put1;
  expect(r1.status()).toBe(200);
  const body = JSON.parse(r1.request().postData());
  expect(body.werte).toEqual({ tageslauf: "an" });
  expect(body.stand).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}$/);
  await expect(page.locator(".e-stand .an-gespeichert")).toBeVisible();
  expect(config().automatik.tageslauf).toBe("an");
  expect(config().name).toBe("Kortex"); // der Rest der Datei bleibt
  const put2 = wartePut(page);
  await page.click('[data-schluessel="wochenbericht"]');
  await put2;
  expect(config().automatik.wochenbericht).toBe(false);
  // Zahl-Menü (Auswahl) in „Erweitert“
  await page.click('.e-punkt[data-bereich="erweitert"]');
  const put3 = wartePut(page);
  await page.click('[data-schluessel="gesundheitInbox"]');
  await page.click('.bs-liste [role="option"][data-wert="5"]');
  await put3;
  expect(config().automatik.gesundheitInbox).toBe(5);
  await expect(page.locator('[data-schluessel="gesundheitInbox"]')).toContainText("5 Dateien");
  // Neuladen: die Werte kommen aus der Datei
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await oeffne(page, "automatik");
  await expect(page.locator('[data-schluessel="tageslauf"] [data-wert="an"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-schluessel="wochenbericht"]')).toHaveAttribute("aria-checked", "false");
});

test("Liste (Themen, Ordner): Eintrag hinzufügen und entfernen speichert sofort; doppelte und ungültige Einträge werden abgewiesen", async ({ page }) => {
  await start(page);
  await oeffne(page, "vaults");
  const wort = zeileVon(page, "ernte-ohne-thema");
  await expect(wort.locator(".ez-chip")).toHaveText(["Gesundheit", "Gehalt"]);
  await wort.locator('[data-aktion="chip-plus"]').click();
  const feld = wort.locator(".ez-chip-feld input");
  await expect(feld).toBeFocused();
  await feld.fill("gehalt");
  await feld.press("Enter");
  await expect(wort.locator(".bs-fehler")).toContainText("steht schon in der Liste");
  await feld.fill("Steuern");
  const put = wartePut(page);
  await feld.press("Enter");
  await put;
  expect(config().automatik.ernteOhneThema).toEqual(["Gesundheit", "Gehalt", "Steuern"]);
  await wort.locator('.ez-chip[data-eintrag="Gehalt"] .ez-chip-x').click();
  await expect.poll(() => config().automatik.ernteOhneThema).toEqual(["Gesundheit", "Steuern"]);
  // Esc im Feld bricht nur das Hinzufügen ab, die Seite bleibt offen
  await wort.locator('[data-aktion="chip-plus"]').click();
  await page.keyboard.type("verworfen");
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeVisible();
  await expect(wort.locator(".ez-chip-feld")).toHaveCount(0);
  expect(config().automatik.ernteOhneThema).toEqual(["Gesundheit", "Steuern"]);
});

test("Textfeld (Pfad): 700 ms nach der letzten Eingabe gespeichert, beim Verlassen sofort, leer = Standard; Schließen der Seite schreibt Wartendes", async ({ page }) => {
  await start(page);
  await oeffne(page, "erweitert");
  const feld = page.locator('[data-schluessel="gedaechtnisWurzel"]');
  await expect(feld).toHaveValue("~/.claude-gedaechtnis");
  await feld.click();
  await feld.fill("~/Gedaechtnis-A");
  await page.waitForTimeout(350);
  expect(config().automatik.gedaechtnisWurzel).toBeUndefined(); // noch nicht: es wird weiter getippt
  await expect.poll(() => config().automatik?.gedaechtnisWurzel, { timeout: 4000 }).toBe("~/Gedaechtnis-A");
  // Verlassen speichert sofort
  await feld.fill("~/Gedaechtnis-B");
  await page.locator('[data-schluessel="gedaechtnisKonten"]').scrollIntoViewIfNeeded();
  await page.locator(".e-kopf h1").click(); // Fokus weg
  await expect.poll(() => config().automatik.gedaechtnisWurzel, { timeout: 400 }).toBe("~/Gedaechtnis-B");
  // Schließen mit Wartendem
  await feld.fill("~/Gedaechtnis-C");
  await page.keyboard.press("Escape"); // Esc im Feld: Wert kommt zuerst an die Datei? — das Feld liegt in der Seite, Esc schließt sie
  await expect(seite(page)).toBeHidden();
  await expect.poll(() => config().automatik.gedaechtnisWurzel, { timeout: 4000 }).toBe("~/Gedaechtnis-C");
  // leer = Standard (der Schlüssel verschwindet aus der Datei)
  await oeffne(page, "erweitert");
  await page.locator('[data-schluessel="gedaechtnisWurzel"]').fill("");
  await expect.poll(() => config().automatik.gedaechtnisWurzel, { timeout: 4000 }).toBeUndefined();
  await expect(page.locator('[data-schluessel="gedaechtnisWurzel"]')).toHaveAttribute("placeholder", "~/.claude-gedaechtnis"); // leer heißt Standard; der Standard steht als Platzhalter da
});

test("Darstellung: Thema, Schriftgröße (Regler) und Bewegung gelten sofort und bleiben (App-Datei einstellungen.json)", async ({ page }) => {
  await start(page);
  await oeffne(page, "darstellung");
  await page.click('[data-thema="dunkel"]');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('[data-thema="dunkel"]')).toHaveAttribute("aria-checked", "true");
  await page.click('[data-thema="hell"]');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.click('[data-thema="system"]');
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  // Schriftgröße: Pfeiltasten am Regler
  const regler = page.locator('[data-schluessel="schriftgroesse"]');
  await regler.focus();
  const put = wartePut(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await put;
  await expect.poll(() => appDatei().schriftgroesse).toBe(17);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--editor-schrift"))).toBe("17px");
  await expect(zeileVon(page, "schriftgroesse").locator(".ez-regler-wert")).toHaveText("17 px");
  // Bewegung „Reduziert“
  const put2 = wartePut(page);
  await page.click('[data-schluessel="bewegung"] [data-wert="reduziert"]');
  await put2;
  await expect(page.locator("html")).toHaveAttribute("data-bewegung", "reduziert");
  expect(appDatei()).toEqual({ schriftgroesse: 17, bewegung: "reduziert" });
  expect(config().automatik.schriftgroesse).toBeUndefined(); // App-Werte stehen nie im Vault
  // nach dem Neuladen gilt es wieder (Editor mit 17 px)
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(page.locator("html")).toHaveAttribute("data-bewegung", "reduziert");
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await page.waitForSelector(".cm-content .cm-line");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".cm-content")).fontSize)).toBe("17px");
  // Breite Textspalte (Geräte-Wahl des Studios)
  await oeffne(page, "darstellung");
  await page.click('[data-einst="breit"]');
  await expect(page.locator("#haupt")).toHaveAttribute("data-breite", "breit");
});

test("Konflikt: antwortet die Werkstatt 409 (jemand hat inzwischen geändert), lädt die Seite neu, zeigt die neuen Werte und sagt es", async ({ page }) => {
  await start(page);
  await oeffne(page, "automatik");
  let gesendet = 0;
  await page.route("**/api/einstellungen", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    gesendet++;
    // „jemand“ ändert die Datei, bevor die Anfrage ankommt
    const c = config(); c.automatik.hinweise = "hoch"; writeFileSync(join(vault, "brain.config.json"), JSON.stringify(c, null, 2) + "\n");
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ fehler: "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.", art: "konflikt" }) });
  });
  await page.click('[data-schluessel="tageslauf"] [data-wert="aus"]');
  await expect(page.locator(".toast")).toContainText("gerade woanders geändert");
  expect(gesendet).toBe(1);
  // die Oberfläche zeigt wieder, was in der Datei steht — nicht die abgewiesene Änderung
  await expect(page.locator('[data-schluessel="tageslauf"] [data-wert="probe"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-schluessel="hinweise"] [data-wert="hoch"]')).toHaveAttribute("aria-checked", "true");
  expect(config().automatik.tageslauf).toBe("probe");
  await page.unroute("**/api/einstellungen");
  // danach geht es wieder
  const put = wartePut(page);
  await page.click('[data-schluessel="tageslauf"] [data-wert="aus"]');
  expect((await put).status()).toBe(200);
  expect(config().automatik.tageslauf).toBe("aus");
  expect(config().automatik.hinweise).toBe("hoch");
});

test("Live: eine Änderung von außen (brain einstellungen im Terminal) erscheint sofort auf der offenen Seite, ohne ein Feld zu stören", async ({ page }) => {
  await start(page);
  await oeffne(page, "automatik");
  await expect(page.locator('[data-schluessel="tageslauf"] [data-wert="probe"]')).toHaveAttribute("aria-checked", "true");
  const c = config(); c.automatik.tageslauf = "an"; c.automatik.wochenbericht = false; c.automatik.ernteOhneThema = ["Neu"];
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify(c, null, 2) + "\n");
  await expect(page.locator('[data-schluessel="tageslauf"] [data-wert="an"]')).toHaveAttribute("aria-checked", "true", { timeout: 10000 });
  await expect(page.locator('[data-schluessel="wochenbericht"]')).toHaveAttribute("aria-checked", "false");
  await page.click('.e-punkt[data-bereich="vaults"]');
  await expect(zeileVon(page, "ernte-ohne-thema").locator(".ez-chip")).toHaveText(["Neu"]);
  // die App-Datei von außen
  writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify({ bewegung: "reduziert" }));
  await expect(page.locator("html")).toHaveAttribute("data-bewegung", "reduziert", { timeout: 10000 });
});

test("Suche: Wertung, Markierung, Zählung je Bereich, Sortierung; Klick auf einen Bereich springt dorthin", async ({ page }) => {
  await start(page);
  await oeffne(page, "allgemein");
  await page.locator('[data-einst="suche"]').fill("kontingent");
  await expect(page.locator("[data-einst=titel]")).toHaveText("Suche");
  await expect(page.locator("[data-einst=treffer]")).toHaveText("1 Treffer für „kontingent“");
  await expect(page.locator("mark")).toHaveText(["Kontingent"]);
  await expect(page.locator(".e-punkt[data-bereich=mitteilungen] .treffer")).toHaveText("1");
  await expect(page.locator(".e-punkt[data-bereich=allgemein]")).toHaveClass(/aus/);
  await expect(page.locator(".e-punkt[aria-current=true]")).toHaveCount(0);
  await expect(page.locator("[data-zeile]:visible")).toHaveCount(1);
  await foto(page, "suche-hell");
  // mehrere Bereiche, Sortierung nach Wertung (Titel vor Beschreibung)
  await page.locator('[data-einst="suche"]').fill("schrift");
  const n = await page.locator("[data-einst=treffer]").innerText();
  expect(n).toMatch(/^\d+ Treffer für „schrift“$/);
  const bereiche = await page.locator(".e-bereich:visible").evaluateAll((l) => l.map((e) => e.dataset.bereich));
  expect(bereiche[0]).toBe("darstellung"); // Titel „Schriftgröße im Editor“ (650) vor allem anderen
  await expect(page.locator('.e-bereich[data-bereich="darstellung"] mark').first()).toHaveText("Schrift");
  // Bereichsname getroffen: der ganze Bereich
  await page.locator('[data-einst="suche"]').fill("Darstellung");
  await expect(page.locator('.e-bereich[data-bereich="darstellung"] [data-zeile]:visible')).toHaveCount(4);
  expect(await page.locator(".e-bereich:visible").first().getAttribute("data-bereich")).toBe("darstellung");
  // ohne Umlaut, Groß/Klein egal
  await page.locator('[data-einst="suche"]').fill("KURZEL");
  await expect(page.locator(".e-punkt[data-bereich=tasten] .treffer")).toBeVisible();
  await expect(page.locator("[data-zeile]:visible")).toHaveCount(BEFEHLE); // der Bereichsname passt: alle Zeilen des Bereichs (ein Befehl je Zeile, aus dem Register der Tastenkürzel)
  // Klick auf einen Bereich in der Trefferliste scrollt dorthin, die Suche bleibt
  await page.locator('[data-einst="suche"]').fill("e");
  const anzahl = await page.locator(".e-punkt .treffer").count();
  expect(anzahl).toBeGreaterThan(3);
  await page.click('.e-punkt[data-bereich="ueber"]');
  await expect(page.locator('[data-einst="suche"]')).toHaveValue("e");
  // leeren: zurück zum zuletzt gewählten Bereich, Markierungen weg
  await page.locator('[data-einst="suche"]').fill("");
  await expect(page.locator("[data-einst=titel]")).toHaveText("Allgemein");
  await expect(page.locator("mark")).toHaveCount(0);
  await expect(page.locator(".e-punkt[data-bereich=allgemein]")).toHaveAttribute("aria-current", "true");
});

test("Suche ohne Treffer: Hinweis mit Suchwort und Vorschlägen (Klick setzt die Suche), kein leerer Bildschirm", async ({ page }) => {
  await start(page, { dunkel: true });
  await oeffne(page, "allgemein");
  await page.locator('[data-einst="suche"]').fill("xyzzy");
  const leer = page.locator('[data-einst="leer"]');
  await expect(leer).toBeVisible();
  await expect(leer.locator("b")).toHaveText("Keine Einstellung zu „xyzzy“");
  await expect(leer).toContainText("Notizen findest du mit ⌘K im Hauptfenster");
  await expect(leer.locator("[data-vorschlag]")).toHaveText(["Konto", "Kürzel", "GitHub", "dunkel"]);
  await expect(page.locator("[data-einst=treffer]")).toHaveText("");
  await expect(page.locator(".e-punkt.aus")).toHaveCount(12);
  await foto(page, "suche-leer-dunkel");
  await leer.locator('[data-vorschlag="dunkel"]').click();
  await expect(page.locator('[data-einst="suche"]')).toHaveValue("dunkel");
  await expect(leer).toHaveCount(0);
  await expect(page.locator('[data-zeile="thema"]')).toBeVisible();
  // Tippfehler: Vorschlag aus dem Register
  await page.locator('[data-einst="suche"]').fill("kontinget");
  await expect(leer.locator("[data-vorschlag]").first()).toHaveText(/ontingent/i);
});

test("Tastatur: ⌘F springt ins Suchfeld, ↓ führt in die Liste, Esc leert die Suche und schließt dann die Seite; ↑↓ in der Seitenleiste", async ({ page }) => {
  await start(page);
  await oeffne(page, "allgemein");
  await page.keyboard.press("Meta+f");
  await expect(page.locator('[data-einst="suche"]')).toBeFocused();
  await page.keyboard.type("tageslauf");
  await page.keyboard.press("ArrowDown");
  const fokus = await page.evaluate(() => document.activeElement?.closest("[data-zeile]")?.dataset.zeile);
  expect(fokus).toBe("tageslauf");
  await page.locator('[data-einst="suche"]').focus();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-einst="suche"]')).toHaveValue("");
  await expect(seite(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  // Das ⌘F der Seite sucht nicht in der Notiz dahinter
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md") + "#einstellungen/allgemein");
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(seite(page)).toBeVisible();
  await page.keyboard.press("Meta+f");
  await expect(page.locator('[data-einst="suche"]')).toBeFocused();
  await expect(page.locator(".cm-search")).toHaveCount(0);
  // Pfeiltasten in der Seitenleiste
  await page.locator('.e-punkt[data-bereich="allgemein"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.e-punkt[data-bereich="darstellung"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-einst=titel]")).toHaveText("Darstellung");
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
  await expect(page.locator('.e-punkt[data-bereich="ueber"]')).toBeFocused();
});

test("Sprungziel: #einstellungen/<bereich>?ziel=<zeile> holt die Zeile in die Mitte und lässt sie kurz aufleuchten; Verweise zwischen Bereichen", async ({ page }) => {
  await start(page, { hash: "#einstellungen/automatik?ziel=gedaechtnis-teilen", hoehe: 700 });
  const z = zeileVon(page, "gedaechtnis-teilen");
  await expect(z).toHaveClass(/blink/);
  await expect(z).toBeInViewport();
  await foto(page, "sprungziel");
  await expect(z).not.toHaveClass(/blink/, { timeout: 4000 }); // nach ~1,6 s wieder ruhig
  // Verweis „Bei den Vaults festlegen“ (Datenschutz → Vaults)
  await page.click('.e-punkt[data-bereich="datenschutz"]');
  await page.click('[data-aktion="zu-vaults"]');
  await expect(page.locator("[data-einst=titel]")).toHaveText("Vaults");
  await expect(zeileVon(page, "ernte-ohne-thema")).toHaveClass(/blink/);
  expect(await page.evaluate(() => location.hash)).toBe("#einstellungen/vaults?ziel=ernte-ohne-thema");
  // ein unbekanntes Ziel schadet nicht
  await page.evaluate(() => { location.hash = "#einstellungen/gibtsnicht?ziel=x"; });
  await page.waitForTimeout(200);
  await expect(seite(page)).toBeVisible();
});

test("Vaults, Sicherung, Über: Liste mit offenem Vault, Vertrauen, Stand der Sicherung, Version und Lizenzen", async ({ page }) => {
  await start(page);
  await oeffne(page, "vaults");
  const v = page.locator(".ez-vault").first();
  await expect(v).toContainText("vault");
  await expect(v.locator(".ez-marke")).toHaveText("offen");
  await expect(zeileVon(page, "vertrauen")).toContainText("Vertraut");
  await expect(page.locator('[data-aktion="vault-hinzufuegen"]')).toBeVisible();
  await page.click('[data-aktion="vertrauen-entziehen"]');
  await expect(page.locator(".dialog")).toBeVisible(); // die bestehende Rückfrage
  await page.keyboard.press("Escape");
  await page.click('.e-punkt[data-bereich="sicherung"]');
  await expect(page.locator("[data-sicherung] [data-zustand]")).toHaveAttribute("data-zustand", "gesichert");
  await expect(page.locator('[data-zeile="git-technik"]')).toContainText("aktiv");
  await page.click('.e-punkt[data-bereich="ueber"]');
  await expect(page.locator(".ez-ueber h3")).toHaveText("Kortex");
  await expect(page.locator(".ez-ueber [data-feld=version]")).toContainText(/^Version \S+ · macOS 26 oder neuer$/);
  await expect(page.locator(".ez-lizenz")).toHaveCount(6);
  await page.click('[data-aktion="lizenzen"]');
  await expect(page.locator(".dialog")).toBeVisible();
});

test("Datenschutz: ehrliche Aussagen (keine Nutzungsdaten, keine Absturzberichte, Geheimnisse bleiben draußen) und Verweise", async ({ page }) => {
  await start(page);
  await oeffne(page, "datenschutz");
  await expect(zeileVon(page, "ds-nutzungsdaten")).toContainText("Kortex sammelt keine Nutzungsdaten");
  await expect(zeileVon(page, "ds-nutzungsdaten").locator(".ez-marke")).toHaveText("aus");
  await expect(zeileVon(page, "ds-geheimnisse").locator(".ez-marke")).toHaveText("immer an");
  await expect(page.locator("[data-zeile] input, [data-zeile] [role=switch]")).toHaveCount(0); // es gibt nichts abzuschalten
});

test("Vault nur zum Ansehen (kein Vertrauen): Einstellungen des Vaults sind gesperrt und sagen warum, die der App gehen; PUT wird abgewiesen", async ({ page }) => {
  server.stopp();
  server = await starteServer(vault, { vertraut: false });
  await start(page);
  // die Frage „Kommt dieser Vault von dir?“ erscheint von selbst; weg damit
  await page.keyboard.press("Escape");
  await oeffne(page, "automatik");
  await expect(page.locator('.e-bereich[data-bereich="automatik"] [data-hinweis]')).toContainText("nur zum Ansehen geöffnet");
  await expect(zeileVon(page, "tageslauf")).toHaveClass(/gesperrt/);
  await expect(zeileVon(page, "tageslauf").locator(".ez-r")).toHaveAttribute("inert", "");
  await page.click('.e-punkt[data-bereich="darstellung"]');
  await expect(zeileVon(page, "bewegung")).not.toHaveClass(/gesperrt/);
  const put = wartePut(page);
  await page.click('[data-schluessel="bewegung"] [data-wert="reduziert"]');
  expect((await put).status()).toBe(200);
  const stand = await page.evaluate(async () => (await (await fetch("/api/einstellungen")).json()).stand);
  const r = await page.evaluate(async (s) => { const x = await fetch("/api/einstellungen", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ werte: { tageslauf: "an" }, stand: s }) }); return { status: x.status, j: await x.json() }; }, stand);
  expect(r.status).toBe(409); expect(r.j.art).toBe("nicht-vertraut");
  expect(config().automatik.tageslauf).toBe("probe");
});

test("Alles zurücksetzen fragt vorher; danach gelten die Standardwerte (Vault und App), Vaults und Notizen bleiben", async ({ page }) => {
  await start(page);
  await oeffne(page, "darstellung");
  const put = wartePut(page);
  await page.click('[data-schluessel="bewegung"] [data-wert="reduziert"]');
  await put;
  await page.click('.e-punkt[data-bereich="erweitert"]');
  await page.click('[data-aktion="zuruecksetzen"]');
  await expect(page.locator(".dialog")).toContainText("Alle Einstellungen zurücksetzen?");
  await page.click('.dialog [data-aktion="reset-ja"]');
  await expect(page.locator(".toast")).toContainText("Einstellungen zurückgesetzt");
  await expect.poll(() => config().automatik ?? {}).toEqual({});
  expect(appDatei()).toEqual({});
  await expect(page.locator("html")).not.toHaveAttribute("data-bewegung", /.*/);
  expect(existsSync(join(vault, "10_notizen", "Reise nach Lissabon.md"))).toBe(true);
  expect(config().name).toBe("Kortex");
});

test("Enge Fenster (640/800/1000 px): nichts wird abgeschnitten, die Seitenleiste schrumpft, die Suche bleibt benutzbar", async ({ page }) => {
  for (const breite of [640, 800, 1000]) {
    await start(page, { breite, hoehe: 720 });
    await oeffne(page, "automatik");
    for (const id of ["automatik", "vaults", "erweitert", "darstellung"]) {
      await page.click(`.e-punkt[data-bereich="${id}"]`);
      await page.waitForTimeout(120);
      const probleme = await page.evaluate(() => {
        const f = [], inhalt = document.querySelector("[data-einst=inhalt]"), ir = inhalt.getBoundingClientRect();
        if (inhalt.scrollWidth - inhalt.clientWidth > 1) f.push(`Inhalt läuft waagerecht über (${inhalt.scrollWidth} > ${inhalt.clientWidth})`);
        for (const e of inhalt.querySelectorAll("button, input, .ez-titel, .ez-chip, .bs-segment")) {
          if (!e.checkVisibility?.()) continue;
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.right > ir.right + 1 || r.left < ir.left - 1) f.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} „${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24)}“ ragt aus dem Inhalt (${Math.round(r.left)}–${Math.round(r.right)} von ${Math.round(ir.left)}–${Math.round(ir.right)})`);
        }
        return f;
      });
      expect(probleme, `${breite}px ${id}`).toEqual([]);
    }
    if (breite === 640) await foto(page, "eng-640");
    if (breite === 800) await foto(page, "eng-800");
  }
});

// ---------- Befund aus P1: Geist ist breiter; die schmalsten Stellen bei der Mindestgröße des Fensters (1100 × 700) ----------
test("Statusleiste bei kleinem Fenster: auch mit langem Vault-Namen und vielen Änderungen bleibt das Zahnrad (Einstellungen) im Fenster", async ({ page }) => {
  for (const breite of [1100, 1000, 900]) {
    await start(page, { breite, hoehe: 700 });
    // Der breiteste Zustand der Leiste, jedes Mal gleich: das Gesundheits-Zeichen kommt sonst erst nach einem eigenen Abruf dazu (und ein späteres Neuzeichnen setzt den eingesetzten Text zurück) —
    // gemessen würde mal die schmale, mal die breite Leiste. Darum Gesundheit festlegen, abwarten, erst dann den langen Text einsetzen und messen.
    await page.route("**/api/gesundheit", (route) => route.fulfill({ json: { ampel: "gelb", warnungen: [1, 2], pruefungen: [] } }));
    await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
    await page.waitForSelector(".cm-content .cm-line");
    await expect(page.locator('[data-st="gesundheit"]')).toBeVisible();
    await expect(page.locator('[data-st="claude"]')).toBeVisible();
    await page.evaluate(() => {
      const set = (sel, t) => { const e = document.querySelector(sel); const s = e && [...e.querySelectorAll("span")].pop(); if (s) s.textContent = t; };
      set('[data-st="vault"]', "Firmenwissen-Projekt-Alpha");
      set('[data-st="geaendert"]', "128 geändert, nicht gesichert");
    });
    const r = await page.evaluate(() => {
      const s = document.getElementById("status"), sr = s.getBoundingClientRect(), f = [];
      for (const e of s.querySelectorAll(".st")) { const b = e.getBoundingClientRect(); if (b.right > sr.right + 0.5 || b.left < sr.left - 0.5) f.push(`${e.dataset.st} ${Math.round(b.left)}–${Math.round(b.right)}`); }
      return { scroll: s.scrollWidth - s.clientWidth, f };
    });
    expect(r, `${breite}px`).toEqual({ scroll: 0, f: [] });
    await expect(page.locator('[data-st="einstellungen"]')).toBeInViewport();
  }
});

test("Verlauf bei der kleinsten Fensterbreite: der Tag steht vollständig da („Freitag, 30. Oktober 2026“), „Ungesicherte Änderungen“ bricht um statt mit „…“ zu enden", async ({ page }) => {
  await start(page, { breite: 1100, hoehe: 700 });
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await page.waitForSelector(".cm-content .cm-line");
  await page.click('[data-st="verlauf"]');
  await expect(page.locator(".vl-tagkopf").first()).toBeVisible();
  const r = await page.evaluate(() => {
    const tag = document.querySelector(".vl-tagkopf"), text = tag.querySelector(".vl-tagtext"), tr = text.getBoundingClientRect(), kr = tag.getBoundingClientRect();
    const msg = document.querySelector(".vl-ungesichert .vl-nachricht");
    return { tagVoll: text.scrollWidth <= text.clientWidth + 1 && tr.right <= kr.right + 1, tagText: text.textContent, msgAbgeschnitten: msg ? msg.scrollHeight > msg.clientHeight + 1 : null, msgText: msg?.textContent, metaRechts: [...document.querySelectorAll(".vl-meta")].every((m) => m.scrollWidth <= m.clientWidth + 1) };
  });
  expect(r.tagVoll).toBe(true);
  expect(r.tagText).toMatch(/^\w+, \d+\. \w+ \d{4}$/);
  expect(r.msgAbgeschnitten).toBe(false);
  expect(r.msgText).toBe("Ungesicherte Änderungen");
  expect(r.metaRechts).toBe(true);
  await foto(page, "verlauf-1100");
});
