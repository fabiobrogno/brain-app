// Schreiben im Alltag: ⌘N (sofort, ohne Dialog), Tagesnotiz mit Kalender, Neue Notiz aus Vorlage (Wahl, Vorschau), Zurück/Vor mit Cursor und Scrollposition.
// Echte Werkstatt gegen einen Wegwerf-Vault im Temp-Ordner; die Uhr steht fest auf Donnerstag, 5. November 2026 (Berlin).
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const JETZT = new Date("2026-11-05T10:07:03+01:00");
let vault, server;

const LANG = "# Langer Text\n\n" + Array.from({ length: 160 }, (_, i) => `Zeile ${i + 1} mit etwas Text, damit die Seite wirklich scrollt.`).join("\n\n") + "\n";
const VORLAGEN = {
  "Vorlagen/Besprechung.md": "---\ntyp: besprechung\ndatum: {{datum}}\n---\n# {{titel}}\n\n{{datum:TT.MM.JJJJ}}, {{zeit}} Uhr\n\n## Agenda\n\n- {{cursor}}\n",
  "Vorlagen/Projekt.md": "---\ntyp: projekt\n---\n## Ziel\n\n{{cursor}}\n\n## Schritte\n",
  "Vorlagen/Tagesnotiz.md": "---\ndatum: {{datum}}\n---\n# {{datum:WWWW, T. MMMM JJJJ}}\n\n## Fokus\n\n- {{cursor}}\n",
};

function schreibeDateien(dateien) {
  for (const [p, inhalt] of Object.entries(dateien)) { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), inhalt); }
}
test.beforeEach(async ({ page }) => {
  ({ vault } = baueVault());
  schreibeDateien({ "10_notizen/lang.md": LANG, "brain.config.json": JSON.stringify({ name: "Kortex", ordner: { vorlagen: "Vorlagen" }, automatik: {} }) + "\n" });
  // Die Werkstatt bekommt eine ausdrücklich gebaute Umgebung: HOME im Temp-Ordner, nichts von den Orten des Rechners (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*, GIT_CONFIG_* …)
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "kortex-schreiben-home-")));
  server = await starteServer(vault, { umgebung: { PATH: process.env.PATH, HOME: home, TMPDIR: home, TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, ".gitconfig") } });
  await page.clock.setFixedTime(JETZT);
});
test.afterEach(() => server?.stopp());

const lese = (p) => readFileSync(join(vault, p), "utf8");
const da = (p) => existsSync(join(vault, p));
async function start(page, pfad = null) {
  await page.goto(server.url + (pfad ? "?pfad=" + encodeURIComponent(pfad) : ""));
  await page.waitForSelector("#bereiche .eintrag");
  if (pfad) await page.waitForSelector(".cm-content .cm-line");
}
const zeilen = (page) => page.locator(".cm-content .cm-line");
const bildVon = async (page, name) => { await page.waitForTimeout(450); return page.locator("#app").screenshot({ path: join(process.env.KORTEX_BILDER || "/tmp", `schreiben-${name}.png`) }).catch(() => {}); };

test("⌘N legt sofort eine leere Notiz an: kein Dialog, Cursor in der Titelzeile, Datei erst mit Inhalt, Name aus dem Titel im Posteingang", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  const vorher = readdirSync(join(vault, "00_inbox")).sort();
  await page.keyboard.press("Meta+n");
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(".dialog")).toHaveCount(0);
  await expect(zeilen(page).first()).toHaveText("# ");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Neue Notiz");
  await expect(page.locator("#editor .cm-editor")).toHaveClass(/cm-focused/);
  // noch nichts getippt: keine Datei
  expect(readdirSync(join(vault, "00_inbox")).sort()).toEqual(vorher);
  await page.keyboard.type("Käse-Idee für März");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Käse-Idee für März");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  expect(lese("00_inbox/kaese-idee-fuer-maerz.md")).toBe("# Käse-Idee für März\n");
  // weitertippen: dieselbe Datei, der Name bleibt
  await page.keyboard.press("Enter"); await page.keyboard.type("Mehr Text");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  expect(lese("00_inbox/kaese-idee-fuer-maerz.md")).toBe("# Käse-Idee für März\nMehr Text\n");
  expect(readdirSync(join(vault, "00_inbox")).filter((n) => n.startsWith("kaese"))).toEqual(["kaese-idee-fuer-maerz.md"]);
  // die Notiz ist in der Liste und im Posteingang
  await expect(page.locator("#liste-koerper")).toContainText("Käse-Idee für März");
  await bildVon(page, "neue-notiz");
});

test("Eine leer verlassene neue Notiz hinterlässt keine Datei; ein zweites ⌘N ersetzt den leeren Entwurf", async ({ page }) => {
  await start(page);
  const vorher = readdirSync(join(vault, "00_inbox")).sort();
  await page.keyboard.press("Meta+n");
  await page.keyboard.press("Meta+n");
  await expect(zeilen(page).first()).toHaveText("# ");
  await page.keyboard.type("   ");
  await page.locator("#liste-koerper [data-karte]").first().click();
  await expect(page.locator("#pfad .krume.aktuell")).not.toHaveText("Neue Notiz");
  await page.waitForTimeout(600);
  expect(readdirSync(join(vault, "00_inbox")).sort()).toEqual(vorher);
});

test("Neue Notiz: Wechsel zu einer anderen Notiz sichert den Text, Namensgleichheit bekommt -2; auch aus Seitenleiste, Liste und Menübefehl", async ({ page }) => {
  await start(page);
  for (const [i, auslöser] of ["fuss", "liste", "menue"].entries()) {
    if (auslöser === "fuss") await page.click("#fuss-neu");
    else if (auslöser === "liste") await page.click("#knopf-neu");
    else await page.evaluate(() => window.studio.befehl("neu"));
    await expect(page.locator(".dialog")).toHaveCount(0);
    await page.keyboard.type("Gleicher Titel");
    await page.evaluate(() => window.studio.schreiben.neueNotiz()); // leeres Ersatz-Entwurf: sichert die vorige
    await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Neue Notiz");
    const name = i === 0 ? "gleicher-titel.md" : `gleicher-titel-${i + 1}.md`;
    await expect.poll(() => da("00_inbox/" + name)).toBe(true);
  }
});

test("Tagesnotiz: ⇧⌘D legt Tagebuch/2026-11-05.md an und öffnet sie; Tageswechsel erzeugt erst beim Schreiben eine Datei; Kalender mit Punkten", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+Shift+d");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Donnerstag, 5. November 2026");
  await expect.poll(() => da("Tagebuch/2026-11-05.md")).toBe(true);
  expect(lese("Tagebuch/2026-11-05.md")).toBe("# Donnerstag, 5. November 2026\n");
  const nav = page.locator("#tag-nav");
  await expect(nav).toBeVisible();
  await expect(nav.locator('[data-tag="kalender"]')).toHaveText("Do., 5. Nov.");
  await expect(nav.locator('[data-tag="heute"]')).toHaveCount(0);
  await bildVon(page, "tagesnotiz");
  // ein Tag zurück: Entwurf, keine Datei
  await nav.locator('[data-tag="zurueck"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Mittwoch, 4. November 2026");
  await expect(nav.locator('[data-tag="kalender"]')).toHaveText("Mi., 4. Nov.");
  await expect(nav.locator('[data-tag="heute"]')).toBeVisible();
  expect(da("Tagebuch/2026-11-04.md")).toBe(false);
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Gestern war ruhig.");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  expect(lese("Tagebuch/2026-11-04.md")).toBe("# Mittwoch, 4. November 2026\nGestern war ruhig.");
  // vor, vor: morgen ist noch leer; weiter zurück ohne zu schreiben legt nichts an
  await nav.locator('[data-tag="vor"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Donnerstag, 5. November 2026");
  await nav.locator('[data-tag="vor"]').click();
  await expect(nav.locator('[data-tag="kalender"]')).toHaveText("Fr., 6. Nov.");
  await nav.locator('[data-tag="vor"]').click();
  await expect(nav.locator('[data-tag="kalender"]')).toHaveText("Sa., 7. Nov.");
  expect(da("Tagebuch/2026-11-06.md") || da("Tagebuch/2026-11-07.md")).toBe(false);
  // Kalender: Punkte an den Tagen mit Notiz
  await nav.locator('[data-tag="kalender"]').click();
  const kal = page.locator(".bs-kal");
  await expect(kal).toBeVisible();
  await expect(kal.locator(".bs-kal-titel")).toHaveText("November 2026");
  await expect(kal.locator('[data-datum="2026-11-05"]')).toHaveClass(/mit-eintrag/);
  await expect(kal.locator('[data-datum="2026-11-04"]')).toHaveClass(/mit-eintrag/);
  await expect(kal.locator('[data-datum="2026-11-03"]')).not.toHaveClass(/mit-eintrag/);
  await expect(kal.locator("[data-schnell]")).toHaveCount(1);
  await bildVon(page, "kalender");
  await kal.locator('[data-datum="2026-11-04"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Mittwoch, 4. November 2026");
  await expect(page.locator(".bs-kal")).toHaveCount(0);
  expect(readdirSync(join(vault, "Tagebuch")).sort()).toEqual(["2026-11-04.md", "2026-11-05.md"]);
  // „Heute“ in der Kopfzeile springt zurück
  await nav.locator('[data-tag="heute"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Donnerstag, 5. November 2026");
});

test("Tagesnotiz: Vorlage „Tagesnotiz“ im Vorlagenordner wird benutzt ({{datum}} ist der Tag der Notiz), eigener Ordner und Format aus den Einstellungen", async ({ page }) => {
  schreibeDateien(VORLAGEN);
  await start(page);
  await page.keyboard.press("Meta+Shift+d");
  await expect.poll(() => da("Tagebuch/2026-11-05.md")).toBe(true);
  expect(lese("Tagebuch/2026-11-05.md")).toBe("---\ndatum: 2026-11-05\n---\n# Donnerstag, 5. November 2026\n\n## Fokus\n\n- \n");
  // Cursor steht hinter dem „- “ (aus {{cursor}}): getippter Text landet dort
  await page.keyboard.type("Wichtigstes zuerst");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  expect(lese("Tagebuch/2026-11-05.md")).toContain("- Wichtigstes zuerst\n");
  // Tag davor: {{datum}} im Kopf ist der 4.11.
  await page.locator('#tag-nav [data-tag="zurueck"]').click();
  await expect.poll(() => page.evaluate(() => window.studio.ed.text())).toContain("datum: 2026-11-04");
  // Einstellungen: anderer Ordner und Format
  const antwort = await page.evaluate(async () => {
    const g = await (await fetch("/api/einstellungen")).json();
    const r = await fetch("/api/einstellungen", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ werte: { tagesnotizOrdner: "Journal/Tage", tagesnotizFormat: "TT.MM.JJJJ" }, stand: g.stand }) });
    return { ok: r.ok, text: await r.text() };
  });
  expect(antwort.ok, antwort.text).toBe(true);
  await page.reload();
  await page.waitForSelector("#bereiche .eintrag");
  await page.keyboard.press("Meta+Shift+d");
  await expect.poll(() => da("Journal/Tage/05.11.2026.md")).toBe(true);
});

test("Neue Notiz aus Vorlage: ⌥⌘N öffnet die Wahl mit Suche und Vorschau; mit Titel entsteht die Notiz, ohne Titel steht der Cursor in der Titelzeile bzw. bei {{cursor}}", async ({ page }) => {
  schreibeDateien(VORLAGEN);
  await start(page);
  await page.keyboard.press("Meta+Alt+n");
  const wahl = page.locator(".vw");
  await expect(wahl).toBeVisible();
  await expect(wahl.locator("[data-vorlage]")).toHaveText(["Besprechung", "Projekt", "Tagesnotiz"]);
  await expect(wahl.locator('[aria-selected="true"]')).toHaveText("Besprechung");
  const vorschau = wahl.locator('[data-vorschau="text"]');
  await expect(vorschau).toContainText("datum: 2026-11-05");
  await expect(vorschau).toContainText("05.11.2026, 10:07 Uhr");
  await expect(wahl.locator('[data-vorschau="cursor"]')).toHaveCount(1);
  await bildVon(page, "vorlagen-wahl");
  // Suche filtert, Vorschau folgt
  await page.keyboard.type("proj");
  await expect(wahl.locator("[data-vorlage]")).toHaveText(["Projekt"]);
  await expect(vorschau).toContainText("## Ziel");
  // Titel tippen: die Vorschau zeigt ihn sofort (die Vorlage Projekt hat keine Überschrift: der Titel kommt unter den Kopf)
  await page.fill('[data-feld="vorlage-titel"]', "Alpha: Neustart");
  await expect(vorschau).toContainText("# Alpha: Neustart");
  await page.keyboard.press("Enter");
  await expect(wahl).toHaveCount(0);
  await expect.poll(() => da("00_inbox/alpha-neustart.md")).toBe(true);
  expect(lese("00_inbox/alpha-neustart.md")).toBe("---\ntyp: projekt\n---\n# Alpha: Neustart\n\n## Ziel\n\n\n\n## Schritte\n");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Alpha: Neustart");
  // ohne Titel: ein Entwurf, der Cursor steht bei {{cursor}}, die Datei entsteht erst mit dem Schreiben
  await page.keyboard.press("Meta+Alt+n");
  await page.keyboard.press("Enter"); // erste Vorlage (Besprechung), kein Titel
  await expect(wahl).toHaveCount(0);
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Neue Notiz");
  // der Cursor steht bei {{cursor}} (hinter „- “ unter „Agenda“): dort landet der Text, die Titelzeile bleibt leer und wartet auf ihren Titel
  await page.keyboard.type("Punkt A");
  await page.waitForTimeout(1500);
  expect(readdirSync(join(vault, "00_inbox")).filter((n) => /punkt|rueck/.test(n))).toEqual([]);
  await page.evaluate(() => { const v = window.studio.ed.view; const z = v.state.doc.toString().indexOf("# \n") + 2; v.dispatch({ selection: { anchor: z } }); });
  await page.keyboard.type("Rückblick");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Rückblick");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  expect(lese("00_inbox/rueckblick.md")).toBe("---\ntyp: besprechung\ndatum: 2026-11-05\n---\n# Rückblick\n\n05.11.2026, 10:07 Uhr\n\n## Agenda\n\n- Punkt A\n");
});

test("Neue Notiz aus Vorlage: ohne Vorlagen erklärt die Wahl, wo sie liegen; über ⌘K erreichbar", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Vorlage");
  await page.locator('.palette [data-pal="befehl"]', { hasText: "Neue Notiz aus Vorlage" }).click();
  await expect(page.locator(".vw")).toBeVisible();
  await expect(page.locator('.vw [data-vorschau="keine"]')).toContainText("Vorlagen");
  await page.keyboard.press("Escape");
  await expect(page.locator(".vw")).toHaveCount(0);
});

test("Palette: Heute, Neue Notiz, Zurück und Vor stehen mit ihren Kürzeln drin", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+k");
  const pal = (t) => page.locator('.palette [data-pal="befehl"]', { hasText: t });
  await page.keyboard.type("Heute");
  await expect(pal("Heute (Tagesnotiz)")).toBeVisible();
  await expect(pal("Heute (Tagesnotiz)").locator("kbd")).toHaveText(["⇧", "⌘", "D"]);
  await pal("Heute (Tagesnotiz)").click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Donnerstag, 5. November 2026");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Zurück");
  await expect(pal("Zurück").locator("kbd")).toHaveText(["⌥", "⌘", "←"]);
});

test("Zurück/Vor: ⌥⌘← und ⌥⌘→ stellen Cursor und Scrollposition je Notiz wieder her; Knöpfe, Liste per Rechtsklick, Maustasten 4/5", async ({ page }) => {
  await start(page, "10_notizen/lang.md");
  const scroller = page.locator(".cm-scroller");
  // Ausgangslage: Cursor in Zeile 40, dann tief gescrollt
  await page.evaluate(() => {
    const v = window.studio.ed.view;
    const pos = v.state.doc.line(40).from + 7;
    v.dispatch({ selection: { anchor: pos } });
  });
  await scroller.evaluate((e) => { e.scrollTop = 2400; });
  await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBeGreaterThan(2000);
  // Zustand = Cursor + die Nummer der ersten sichtbaren „Zeile n“ (die Pixel hängen von gemessenen und geschätzten Zeilenhöhen ab, eine Zeile Abweichung ist dieselbe Stelle)
  const zustand = () => page.evaluate(() => {
    const z = window.studio.ed.zustand(), r = document.querySelector(".cm-scroller").getBoundingClientRect();
    const l = [...document.querySelectorAll(".cm-line")].find((x) => x.getBoundingClientRect().bottom > r.top + 4 && /^Zeile \d+/.test(x.textContent));
    return { anker: z.anker, kopf: z.kopf, oben: l ? Number(/^Zeile (\d+)/.exec(l.textContent)[1]) : -1 };
  });
  const gleich = (a, b) => a.anker === b.anker && a.kopf === b.kopf && Math.abs(a.oben - b.oben) <= 1;
  const merk = await zustand();
  expect(merk.oben).toBeGreaterThan(40);
  const nav = (id) => page.locator(`#nav-${id}`);
  await expect(nav("zurueck")).toHaveAttribute("aria-disabled", "true");
  // zweite Notiz öffnen (Palette)
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Reise nach");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await expect(nav("zurueck")).toHaveAttribute("aria-disabled", "false");
  await expect(nav("vor")).toHaveAttribute("aria-disabled", "true");
  // dritte Notiz: Cursor ans Ende setzen
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Meta+k"); await page.keyboard.type("Kaffee"); await page.keyboard.press("Enter");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Kaffee");
  // zurück, zurück: wieder bei lang.md, Cursor und Scroll wie vorher
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  const reiseEnde = await page.evaluate(() => { const v = window.studio.ed.view; return v.state.selection.main.head === v.state.doc.length; });
  expect(reiseEnde).toBe(true);
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Langer Text");
  await expect.poll(async () => gleich(await zustand(), merk)).toBe(true);
  await expect(nav("zurueck")).toHaveAttribute("aria-disabled", "true");
  await expect(nav("vor")).toHaveAttribute("aria-disabled", "false");
  // Vor per ⌥⌘→, dann Knopf, dann Maustaste 4 (zurück) und 5 (vor)
  await page.keyboard.press("Meta+Alt+ArrowRight");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await nav("vor").click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Kaffee");
  await page.evaluate(() => window.dispatchEvent(new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true })));
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await page.evaluate(() => window.dispatchEvent(new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true })));
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Kaffee");
  // Deutsche Tastatur: ⌘Ü (code BracketLeft) und ⌘+ (BracketRight) lösen NICHTS aus (⌘[ und ⌘] sind nicht belegt)
  await page.evaluate(() => { for (const [key, code] of [["ü", "BracketLeft"], ["+", "BracketRight"], ["[", "BracketLeft"]]) window.dispatchEvent(new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true })); });
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Kaffee");
  // Rechtsklick auf Zurück: Liste der Einträge, Klick springt dorthin
  await nav("zurueck").click({ button: "right" });
  const menue = page.locator(".verlauf-menue");
  await expect(menue.locator(".m-eintrag")).toHaveText([/Reise nach Lissabon/, /Langer Text/]);
  await bildVon(page, "verlauf-menue");
  await menue.locator(".m-eintrag", { hasText: "Langer Text" }).click();

  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Langer Text");
  await expect.poll(async () => gleich(await zustand(), merk)).toBe(true);
  // eine neue Notiz nach Zurück schneidet „Vor“ ab, wie im Browser
  await page.keyboard.press("Meta+k"); await page.keyboard.type("Espresso"); await page.keyboard.press("Enter");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Espresso");
  await expect(nav("vor")).toHaveAttribute("aria-disabled", "true");
});

test("Zurück/Vor: eine verschwundene Notiz fällt lautlos weg; Umbenennen folgt, wenn die App es meldet; Wischgeste mit zwei Fingern", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  for (const t of ["Kaffee", "Espresso"]) { await page.keyboard.press("Meta+k"); await page.keyboard.type(t); await page.keyboard.press("Enter"); await expect(page.locator("#pfad .krume.aktuell")).toHaveText(t); }
  // Kaffee verschwindet von der Platte; die Liste weiß es nach dem Neuladen des Baums
  rmSync(join(vault, "09_wiki/wissen/Kaffee.md"));
  await expect(page.locator('#liste-koerper [data-pfad="09_wiki/wissen/Kaffee.md"]')).toHaveCount(0, { timeout: 15000 });
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.keyboard.press("Meta+Alt+ArrowRight");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Espresso");
  // Wischgeste: zwei Finger nach rechts (deltaX negativ) = zurück; senkrechtes Scrollen löst nichts aus
  const mitte = await page.locator(".cm-scroller").boundingBox();
  await page.mouse.move(mitte.x + 200, mitte.y + 200);
  await page.mouse.wheel(0, 300);
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Espresso");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(-60, 2);
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await expect(page.locator("#nav-vor")).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Meta+Alt+ArrowRight");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Espresso");
  // Umbenennen: die Meldung führt den Eintrag mit
  await page.evaluate(() => window.studio.schreiben.umbenannt("10_notizen/Reise nach Lissabon.md", "10_notizen/Reise nach Porto.md"));
  const stand = await page.evaluate(() => window.studio.schreiben.verlauf.zustandJetzt());
  expect(stand.liste).toContain("10_notizen/Reise nach Porto.md");
  expect(stand.liste).not.toContain("10_notizen/Reise nach Lissabon.md");
});

test("Zurück/Vor: aus einer neuen Notiz führt ⌥⌘← zur vorigen; ohne Vault geschieht nichts", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+n");
  await expect(zeilen(page).first()).toHaveText("# ");
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await expect(page.locator("#nav-vor")).toHaveAttribute("aria-disabled", "true");
});

test("Einstellungen: Seite „Schreiben“ mit Ordner, Format und Vorlage; Werte landen in der App-Datei und gelten sofort", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+,");
  await page.click('.e-punkt[data-bereich="schreiben"]');
  await expect(page.locator("[data-einst=titel]")).toHaveText("Schreiben");
  const feld = page.locator('[data-schluessel="tagesnotizOrdner"]');
  await expect(feld).toBeVisible();
  await expect(feld).toHaveValue("Tagebuch");
  await feld.fill("Journal");
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/api/einstellungen")).json()).werte.tagesnotizOrdner), { timeout: 8000 }).toBe("Journal");
  await bildVon(page, "einstellungen");
});

// ---- Review: nichts geht verloren
const setzeText = (page, text) => page.evaluate((t) => { const v = window.studio.ed.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }); }, text);
const inboxDateien = () => readdirSync(join(vault, "00_inbox"));

test("K1: ein Entwurf ohne Titel, dessen erste Zeilen sich nach dem Säubern leeren, geht beim Wechsel nicht verloren (Code, Listenrest, Trenner, Zitat, Nummer, nur Kopf)", async ({ page }) => {
  await start(page);
  const faelle = [
    ["# \n```\ncode\n```\n", "code.md"],
    ["# \n- [ ] \nText A\n", "text-a.md"],
    ["# \n***\nText B\n", "text-b.md"],
    ["# \n> \nText C\n", "text-c.md"],
    ["# \n1. \nText D\n", "text-d.md"],
    ["---\na: 1\n---\n# \n", "unbenannt.md"],
  ];
  for (const [text, datei] of faelle) {
    await page.keyboard.press("Meta+n");
    await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Neue Notiz");
    await setzeText(page, text);
    await page.locator("#liste-koerper [data-karte]").first().click(); // Wechsel zu einer anderen Notiz
    await expect.poll(() => inboxDateien().includes(datei), { message: datei }).toBe(true);
    expect(readFileSync(join(vault, "00_inbox", datei), "utf8")).toBe(text);
  }
});

test("K1: derselbe Fall beim Beenden (vorSchliessen): der Text wird gesichert, nicht verworfen", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+n");
  await setzeText(page, "# \n```\nnur Code\n```\n");
  const r = await page.evaluate(() => window.studio.vorSchliessen());
  expect(r.ok).toBe(true);
  expect(readFileSync(join(vault, "00_inbox", "nur-code.md"), "utf8")).toBe("# \n```\nnur Code\n```\n");
  // ein wirklich leerer Entwurf bleibt ohne Datei
  const vorher = inboxDateien().length;
  await page.keyboard.press("Meta+n");
  expect((await page.evaluate(() => window.studio.vorSchliessen())).ok).toBe(true);
  expect(inboxDateien().length).toBe(vorher);
});

test("W1: Dauertippen ohne Titel schiebt das Sichern nicht endlos hinaus (Höchstwartezeit ab dem ersten Tastendruck)", async ({ page }) => {
  await start(page);
  await page.evaluate(() => { window.studio.entwurfHoechstWartenMs = 1500; });
  await page.keyboard.press("Meta+n");
  await page.evaluate(() => { const v = window.studio.ed.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); v.dispatch({ changes: { from: v.state.doc.length, insert: "\n" } }); });
  // alle 300 ms ein Zeichen: ein Debounce käme nie zum Zug
  const vorher = inboxDateien().length;
  for (let i = 0; i < 14; i++) { await page.keyboard.type("x"); await page.waitForTimeout(300); if (inboxDateien().length > vorher) break; }
  expect(inboxDateien().length).toBe(vorher + 1);
  await expect(page.locator("#pfad .krume.aktuell")).not.toHaveText("Neue Notiz");
});

test("W2: entsteht die Datei eines Tag-Entwurfs inzwischen anderswo, kommt der Text ans Ende der vorhandenen Notiz — kein Dialog, nichts verworfen", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+Shift+d");
  await expect.poll(() => da("Tagebuch/2026-11-05.md")).toBe(true);
  await page.locator('#tag-nav [data-tag="zurueck"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Mittwoch, 4. November 2026");
  writeFileSync(join(vault, "Tagebuch/2026-11-04.md"), "# Mittwoch, 4. November 2026\n\nVom anderen Gerät.\n"); // der Abgleich bringt sie dazwischen
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Mein eigener Text");
  await page.locator('#tag-nav [data-tag="heute"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Donnerstag, 5. November 2026");
  await expect(page.locator(".dialog")).toHaveCount(0);
  const text = lese("Tagebuch/2026-11-04.md");
  expect(text).toContain("Vom anderen Gerät.");
  expect(text).toContain("Mein eigener Text");
  expect(text.indexOf("Vom anderen")).toBeLessThan(text.indexOf("Mein eigener"));
});

test("W2: Verwerfen im Speicherfehler-Dialog lässt einen Entwurf nicht ohne Ablage verschwinden (Zwischenablage und lokale Kopie)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await start(page);
  await page.keyboard.press("Meta+n");
  await setzeText(page, "# Wichtig\nNicht verlieren\n");
  await page.route("**/api/neu", (r) => r.fulfill({ status: 500, json: { fehler: "kaputt" } }));
  await page.locator("#liste-koerper [data-karte]").first().click();
  await page.locator('[data-dialog="speicherfehler"] [data-aktion="verwerfen"]').click();
  await expect(page.locator(".dialog")).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("# Wichtig\nNicht verlieren\n");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("brain-studio.entwurf-verworfen")).text)).toBe("# Wichtig\nNicht verlieren\n");
});

test("Nach Review 2: eine frisch angelegte Notiz hat die richtige Basis — schreibt ein anderes Programm hinein, bevor sie gespeichert ist, gehen getippte Zeilen nicht verloren", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+n");
  await expect(zeilen(page).first()).toHaveText("# ");
  await page.keyboard.type("Basis-Test");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  const datei = "00_inbox/basis-test.md";
  expect(lese(datei)).toBe("# Basis-Test\n");
  // Speichern sperren, damit die nächste Eingabe sicher ungespeichert bleibt; dann schreibt ein anderes Programm oben in die Datei
  await page.route("**/api/datei", (route) => (route.request().method() !== "PUT" ? route.fallback() : route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"offline"}' })));
  await page.keyboard.press("Enter"); await page.keyboard.type("MEINE ZEILE");
  writeFileSync(join(vault, datei), "KI-OBEN\n# Basis-Test\n");
  await expect.poll(() => lese(datei), { timeout: 8000 }).toContain("MEINE ZEILE");
  expect(lese(datei)).toContain("KI-OBEN");
  await expect(page.locator('[data-banner="fremd-konflikt"]')).toHaveCount(0);
});
