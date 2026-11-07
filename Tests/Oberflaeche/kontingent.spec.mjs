// Kontingent (Paket P7): Statusleiste mit aktivem Konto und Mini-Balken, Konto-Menü (wechseln, Konten und Rechte öffnen), Balken 5 Std / Woche in „KI & Konten“, Einwilligung und Rückweg für die
// Statuszeile, Frag-Feld mit Kontingent und „voll“ samt Rücksetzzeit, Fehlerzustände (nicht abrufbar, veraltet …) — hell und dunkel. Die Routen /api/ki/kontingent und /api/ki/konten sind
// Attrappen (mocks-kontingent.mjs, mocks-konten.mjs) mit fester Uhr (13:00 Uhr in Berlin); der Rest läuft gegen die echte Werkstatt. Zeitzone und Sprache sind festgelegt (Rücksetzzeiten).
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert). UI_RUNDE=<n>: Teil des Dateinamens.
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten } from "./mocks-konten.mjs";
import { mockeKontingent, ZUSTAND as Z, JETZT } from "./mocks-kontingent.mjs";

test.use({ timezoneId: "Europe/Berlin", locale: "de-DE" });

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const runde = process.env.UI_RUNDE ? `r${process.env.UI_RUNDE}-` : "";
const foto = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: join(process.env.UI_SHOTS || "screenshots", `kt-${runde}${name}.png`) }); };
const FIRMA = "/Users/test/Firma-Vault";
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const PRIVAT = { id: "k_aaaa0001", programm: "claude", programmName: "Claude Code", name: "Privat", standard: true, ordner: "~/.claude", pfad: "/Users/test/.claude", vorhanden: true, verbunden: true };
const ARBEIT = { id: "k_aaaa0002", programm: "claude", programmName: "Claude Code", name: "Arbeit", standard: false, ordner: "~/.claude-arbeit", pfad: "/Users/test/.claude-arbeit", vorhanden: true, verbunden: true };
const KUNDE = { id: "k_aaaa0006", programm: "claude", programmName: "Claude Code", name: "Kunde", standard: false, ordner: "~/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", pfad: "/Users/test/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", verwaltet: true, vorhanden: true, verbunden: true };
const FIRMA_K = { id: "k_aaaa0004", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", pfad: "/Users/test/.claude-firma", vorhanden: true, verbunden: false };
const CODEX = { id: "k_aaaa0003", programm: "codex", programmName: "Codex", name: "Codex", standard: true, ordner: "~/.codex", pfad: "/Users/test/.codex", vorhanden: true, verbunden: true };
const CURSOR = { id: "k_aaaa0005", programm: "cursor", programmName: "Cursor", name: "Cursor", standard: true, ordner: "~/.cursor", pfad: "/Users/test/.cursor", vorhanden: true, verbunden: true };
const ALLE = [PRIVAT, FIRMA_K, CODEX, CURSOR];
const PROGRAMME = [
  { id: "claude", name: "Claude Code", art: "terminal", pfad: "/opt/homebrew/bin/claude", version: "2.1.80", quelle: "cli", befehl: "claude" },
  { id: "codex", name: "Codex", art: "terminal", pfad: "/opt/homebrew/bin/codex", version: "0.48.0", quelle: "cli", befehl: "codex" },
  { id: "cursor", name: "Cursor", art: "editor", pfad: "/Applications/Cursor.app", version: "1.7.2", quelle: "app", befehl: null },
];
const WERTE = () => ({ k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0004: Z.nichtEingerichtet(), k_aaaa0003: Z.codexOk(9, 71), k_aaaa0005: Z.nichtAbrufbar("Cursor") });

async function start(page, { konten = ALLE, werte = WERTE(), dunkel = false, hash = null, breite = 1440, hoehe = 900, kontingent = {}, login = {} } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await mockeV2(page, vault);
  const k = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA, name: "Firma" }], konten, programme: PROGRAMME,
    login: { k_aaaa0001: "angemeldet", k_aaaa0002: "angemeldet", k_aaaa0003: "angemeldet", k_aaaa0006: "angemeldet", k_aaaa0004: "nicht-angemeldet", ...login }, zuletzt: { k_aaaa0004: "2026-10-30T09:00:00.000Z" } });
  const kt = await mockeKontingent(page, { konten, werte, aktiv: () => k.aktiv, ...kontingent }); // das aktive Konto kommt aus derselben Quelle wie in der Werkstatt (ki-konten.json)
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  if (hash) { await page.evaluate((h) => { location.hash = h; }, hash); await expect(page.locator("[data-einstellungen]")).toBeVisible(); }
  return { k, kt };
}
const leiste = (page) => page.locator('[data-st="kontingent"]');
// Der volle Verbrauch steht im Unterbereich „Kontingent“ (Karte je Konto); in der Kontenliste steht nur der Mini-Balken
const konto = (page, id) => page.locator(`.kx-kt-karte[data-konto="${id}"]`);
const spalte = (page, id) => konto(page, id).locator(`[data-kt-konto="${id}"]`);
const breiteVon = (loc) => loc.evaluate((e) => parseFloat(e.style.width));
const dlg = (page, name) => page.locator(`.dialog[data-dialog="${name}"]`);
const fehlerSammler = (page) => { const f = []; page.on("pageerror", (e) => f.push(e.message)); return f; };

test("Farbschwellen wie Orca: unter 60 grau, 60–79 gelb, ab 80 rot (59, 60, 79, 80, 100)", async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => { const m = await import("/kontingent.js"); return [0, 59, 59.9, 60, 79, 79.9, 80, 100].map(m.balkenKlasse); });
  expect(r).toEqual(["grau", "grau", "grau", "gelb", "gelb", "gelb", "rot", "rot"]);
  for (const [p, stufe] of [[59, "grau"], [60, "gelb"], [79, "gelb"], [80, "rot"]]) {
    const el = await page.evaluate(async ([pp]) => { const m = await import("/kontingent.js"); const b = m.kontingentBlock({ status: "ok", quelle: "statuszeile", session: { usedPercent: pp, windowMinutes: 300, resetsAt: null }, weekly: null }, { jetzt: 0 }); return b.querySelector(".kt-balken").dataset.stufe; }, [p]);
    expect(el, `${p} %`).toBe(stufe);
  }
});

test("Voll: 100 % heißt „voll“ mit Rücksetzzeit im Frag-Feld (dunkel); die Leiste und das Popover zeigen es in kontingent-leiste.spec.mjs", async ({ page }) => {
  await start(page, { dunkel: true, konten: [PRIVAT, ARBEIT, CODEX], werte: { k_aaaa0001: Z.claudeOk(100, 18), k_aaaa0002: Z.claudeOk(12, 20), k_aaaa0003: Z.codexOk(9, 71) } });
  // Frag-Feld: Auswahl nennt „voll“, darunter ein Satz mit der Rücksetzzeit und dem Rat, ein anderes Konto zu wählen
  await page.click("#knopf-frage");
  const hinweis = page.locator('[data-frage="kontingent"] [data-kt="voll"]');
  await expect(hinweis).toBeVisible();
  await expect(hinweis).toContainText("Privat ist voll, wieder ab 15:14. Wähle ein anderes Konto");
  await page.click('[data-frage="konto"]');
  await expect(page.locator('.bs-opt[data-wert="k_aaaa0001"] .bs-opt-sub')).toHaveText("voll · wieder ab 15:14");
  await expect(page.locator('.bs-opt[data-wert="k_aaaa0002"] .bs-opt-sub')).toHaveText("12 % · 5 Std");
  await foto(page, "frage-voll-dunkel");
  await page.click('.bs-opt[data-wert="k_aaaa0002"]');
  await expect(page.locator('[data-frage="kontingent"] [data-kt="voll"]')).toHaveCount(0);
  await expect(page.locator('[data-frage="kontingent"] [data-fenster="session"] .kt-prozent')).toHaveText("12 %");
});

test("Frag-Feld (hell): Auswahl mit Kontingent je Konto, Balken unter der Auswahl", async ({ page }) => {
  await start(page, { konten: [PRIVAT, ARBEIT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0002: Z.claudeOk(71, 63), k_aaaa0003: Z.codexOk(9, 71) } });
  await page.click("#knopf-frage");
  await expect(page.locator('[data-frage="kontingent"] [data-fenster="session"] .kt-prozent')).toHaveText("42 %");
  await expect(page.locator('[data-frage="kontingent"] [data-fenster="weekly"] .kt-prozent')).toHaveText("18 %");
  await expect(page.locator('[data-frage="kontingent"] [data-kt="voll"]')).toHaveCount(0);
  await page.click('[data-frage="konto"]');
  await expect(page.locator('.bs-opt[data-wert="k_aaaa0002"] .bs-opt-sub')).toHaveText("71 % · 5 Std");
  await foto(page, "frage-hell");
});

// ---------------------------------------------------------------------- Einstellungen → KI & Konten
test("Einstellungen: Balken 5 Std / Woche mit Prozent und Rücksetzzeit je Konto; Codex mit „Neu laden“; Cursor ehrlich nicht abrufbar (hell)", async ({ page }) => {
  await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent" });
  await expect(konto(page, "k_aaaa0001")).toBeVisible();
  const p = spalte(page, "k_aaaa0001");
  await expect(p.locator('[data-fenster="session"] .kt-prozent')).toHaveText("42 %");
  await expect(p.locator('[data-fenster="session"] .kt-rest')).toHaveText("noch 2 h 14 min");
  await expect(p.locator('[data-fenster="weekly"] .kt-prozent')).toHaveText("18 %");
  await expect(p.locator('[data-fenster="weekly"] .kt-rest')).toHaveText("bis So 19:00");
  await expect(p.locator('[data-aktion="kt-aus"]')).toHaveText("Kontingent nicht mehr anzeigen");
  const c = spalte(page, "k_aaaa0003");
  await expect(c.locator('[data-fenster="session"] .kt-prozent')).toHaveText("9 %");
  await expect(c.locator('[data-fenster="weekly"] .kt-prozent')).toHaveText("71 %");
  await expect(c.locator('[data-aktion="kt-neu"]')).toBeDisabled(); // 5 Minuten noch nicht um
  await expect(spalte(page, "k_aaaa0005")).toContainText("Kontingent gibt Cursor nicht heraus.");
  const f = spalte(page, "k_aaaa0004");
  await expect(f).toContainText("Kontingent nicht eingerichtet");
  await expect(f.locator('[data-aktion="kt-anzeigen"]')).toHaveText("Kontingent anzeigen …");
  await foto(page, "einstellungen-hell");
});

test("Einstellungen dunkel: Zustände — noch keine Werte, ohne Kontingent, veraltet, geändert, Einstellungen kaputt, Codex nicht gefunden", async ({ page }) => {
  await start(page, { dunkel: true, hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT, ARBEIT, FIRMA_K, CODEX, CURSOR], werte: {
    k_aaaa0001: Z.keineWerte(), k_aaaa0002: Z.ohneKontingent(), k_aaaa0004: Z.defekt(), k_aaaa0003: Z.codexFehler("fehlt"), k_aaaa0005: Z.nichtAbrufbar("Cursor") } });
  await expect(spalte(page, "k_aaaa0001")).toContainText("Erscheint, sobald Claude Code das nächste Mal läuft");
  await expect(spalte(page, "k_aaaa0002")).toContainText("Claude Code hat für dieses Konto noch kein Kontingent gemeldet");
  await expect(spalte(page, "k_aaaa0002")).toContainText("Bei einer neuen Sitzung ist das normal: Stelle in Claude Code eine Frage, dann erscheinen die Werte.");
  await expect(spalte(page, "k_aaaa0002")).toContainText("API-Schlüssel statt deines Abos, oder Claude Code ist älter als Version 2.1.80");
  await expect(spalte(page, "k_aaaa0004")).toContainText("Repariere die Datei, dann geht es hier weiter.");
  await expect(spalte(page, "k_aaaa0003")).toContainText("Codex wurde nicht gefunden. Installiere Codex und klicke dann in den Einstellungen auf „Neu suchen“.");
  await foto(page, "einstellungen-zustaende-dunkel");
  // veraltet und geändert in einem zweiten Durchgang
});

test("Einstellungen: veraltet, geändert (mit Knopf), Codex wird gefragt, Codex mit abgelaufener Anmeldung — und es gibt keinen Absturz", async ({ page }) => {
  const f = fehlerSammler(page);
  await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT, ARBEIT, FIRMA_K, CODEX], werte: { k_aaaa0001: Z.claudeVeraltet(63, 20), k_aaaa0002: Z.geaendert(), k_aaaa0004: Z.nichtEingerichtet(), k_aaaa0003: Z.codexLaedt() } });
  await expect(spalte(page, "k_aaaa0001").locator('[data-fenster="session"] .kt-prozent')).toHaveText("63 %");
  await expect(spalte(page, "k_aaaa0001")).toContainText("Stand vor 1 Std");
  await expect(spalte(page, "k_aaaa0002")).toContainText("Statuszeile geändert");
  await expect(spalte(page, "k_aaaa0002").locator('[data-aktion="kt-anzeigen"]')).toBeVisible();
  await expect(spalte(page, "k_aaaa0003")).toContainText("Kortex fragt Codex nach dem Kontingent");
  await expect(spalte(page, "k_aaaa0003").locator('[data-aktion="kt-neu"]')).toHaveCount(0);
  expect(f).toEqual([]);
});

test("Einschalten bei einem Konto von Kortex: ein Klick, ein Dialog mit den Zusagen, kein zweites Bestätigen — der Aufruf trägt einwilligung, nicht bestaetigt", async ({ page }) => {
  const { kt } = await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT, KUNDE], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0006: Z.nichtEingerichtet({ verwaltet: true, bestaetigungNoetig: false }) },
    login: {} });
  const z = spalte(page, "k_aaaa0006");
  await expect(z.locator('[data-aktion="kt-anzeigen"]')).toBeVisible();
  await z.locator('[data-aktion="kt-anzeigen"]').click();
  const d = dlg(page, "kt-einwilligung");
  await expect(d).toBeVisible();
  await expect(d).toContainText("Kontingent für „Kunde“ anzeigen");
  await expect(d.locator('[data-kt="punkte"] li')).toHaveCount(4);
  await expect(d).toContainText("Kortex liest dafür keine Anmeldedaten und fragt Anthropic nicht selbst.");
  await expect(d).toContainText("Hast du schon eine Statuszeile, ruft Kortex sie weiter auf.");
  await expect(d.locator('[data-kt="bestaetigung"]')).toHaveCount(0);
  expect(kt.log("POST")).toHaveLength(0);       // vor dem Klick im Dialog geschieht nichts
  await foto(page, "einwilligung-hell");
  await d.locator('[data-aktion="kt-einschalten"]').click();
  await expect.poll(() => kt.log("POST").length).toBe(1);
  expect(kt.log("POST")[0].body).toEqual({ konto: "k_aaaa0006", an: true, einwilligung: true });
  await expect(spalte(page, "k_aaaa0006")).toContainText("Erscheint, sobald Claude Code das nächste Mal läuft");
  await expect(spalte(page, "k_aaaa0006").locator('[data-aktion="kt-aus"]')).toBeVisible();
});

test("Einschalten beim System-Standard (~/.claude): Dialog MIT Bestätigung in der Seite (Sicherung, markierter Eintrag, Rückweg) — erst „Ja“ löst den Aufruf mit bestaetigt aus", async ({ page }) => {
  const { kt } = await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT], werte: { k_aaaa0001: Z.nichtEingerichtet({ fremdeStatuszeile: true }) } });
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-anzeigen"]').click();
  const d = dlg(page, "kt-einwilligung");
  await expect(d.locator('[data-kt="bestaetigung"]')).toBeVisible();
  await expect(d.locator('[data-kt="bestaetigung"]')).toContainText("Einstellungen von „Privat“ ändern?");
  await expect(d.locator('[data-kt="bestaetigung"]')).toContainText("Vorher legt Kortex eine Kopie der Datei an");
  await expect(d.locator('[data-kt="bestaetigung"]')).toContainText("Beim Ausschalten bekommst du die Datei genau so zurück, wie sie vorher war, solange du sie nicht inzwischen geändert hast. Sonst nimmt Kortex nur seinen eigenen Eintrag heraus.");
  await expect(d.locator('[data-aktion="kt-einschalten"]')).toHaveText("Ja, in diesem Konto eintragen");
  await foto(page, "einwilligung-standard-hell");
  // Abbrechen: nichts geschieht
  await d.getByRole("button", { name: "Abbrechen" }).click();
  await expect(d).toHaveCount(0);
  expect(kt.log("POST")).toHaveLength(0);
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-anzeigen"]').click();
  await dlg(page, "kt-einwilligung").locator('[data-aktion="kt-einschalten"]').click();
  await expect.poll(() => kt.log("POST").length).toBe(1);
  expect(kt.log("POST")[0].body).toEqual({ konto: "k_aaaa0001", an: true, einwilligung: true, bestaetigt: true });
  await expect(page.locator(".toast").last()).toContainText("Deine bisherige Statuszeile läuft unverändert weiter.");
});

test("Ausschalten: Rückfrage, dann der Rückweg; ein Fehler der Werkstatt steht als Satz mit dem nächsten Schritt da", async ({ page }) => {
  const { kt } = await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT], werte: { k_aaaa0001: Z.claudeOk(42, 18) } });
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-aus"]').click();
  const d = dlg(page, "kt-ausschalten");
  await expect(d).toContainText("Kontingent für „Privat“ nicht mehr anzeigen?");
  await expect(d).toContainText("Kortex stellt die Einstellungen von Claude Code wieder her.");
  expect(kt.log("POST")).toHaveLength(0);
  await d.locator('[data-aktion="kt-ausschalten"]').click();
  await expect.poll(() => kt.log("POST").length).toBe(1);
  expect(kt.log("POST")[0].body).toEqual({ konto: "k_aaaa0001", an: false, einwilligung: true });
  await expect(page.locator(".toast").last()).toContainText("Deine Einstellungen sind wieder genau wie vorher.");
  await expect(spalte(page, "k_aaaa0001")).toContainText("Kontingent nicht eingerichtet");
  // Fehler
  kt.schalterFehler = "Die Einstellungen von Claude Code (settings.json) sind kaputt oder nicht lesbar. Kortex ändert nichts daran — bitte zuerst reparieren, dann geht es hier weiter.";
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-anzeigen"]').click();
  await dlg(page, "kt-einwilligung").locator('[data-aktion="kt-einschalten"]').click();
  await expect(page.locator(".toast.fehler, .toast").last()).toContainText("bitte zuerst reparieren, dann geht es hier weiter.");
});

test("Tastatur: Dialog per Tab erreichbar, Esc bricht ab, nichts wird geschrieben", async ({ page }) => {
  const { kt } = await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT], werte: { k_aaaa0001: Z.nichtEingerichtet() } });
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-anzeigen"]').focus();
  await page.keyboard.press("Enter");
  await expect(dlg(page, "kt-einwilligung")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg(page, "kt-einwilligung")).toHaveCount(0);
  expect(kt.log("POST")).toHaveLength(0);
});

test("Neu verknüpfen und Reparieren: Zustand mit Knopf, der Aufruf läuft nach dem Dialog, der Hinweis nennt, was geschah (nicht „eingetragen“)", async ({ page }) => {
  const { kt } = await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT, ARBEIT], werte: { k_aaaa0001: Z.neuVerknuepfen(), k_aaaa0002: Z.reparieren() } });
  await expect(spalte(page, "k_aaaa0001")).toContainText("Statuszeile gehört zu einer früheren Kennung");
  await expect(spalte(page, "k_aaaa0001")).toContainText("deine eigene Statuszeile geht dabei nicht verloren");
  await expect(spalte(page, "k_aaaa0001").locator('[data-aktion="kt-anzeigen"]')).toHaveText("Neu verknüpfen …");
  await expect(spalte(page, "k_aaaa0002")).toContainText("Node oder das Skript von Kortex liegt nicht mehr dort");
  await expect(spalte(page, "k_aaaa0002").locator('[data-aktion="kt-anzeigen"]')).toHaveText("Reparieren …");
  await expect(spalte(page, "k_aaaa0002").locator('[data-aktion="kt-aus"]')).toBeVisible();
  await foto(page, "einstellungen-reparieren-hell");
  await spalte(page, "k_aaaa0002").locator('[data-aktion="kt-anzeigen"]').click();
  await dlg(page, "kt-einwilligung").locator('[data-aktion="kt-einschalten"]').click();
  await expect(page.locator(".toast").last()).toContainText("Die Statuszeile für „Arbeit“ ist repariert.");
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-anzeigen"]').click();
  await dlg(page, "kt-einwilligung").locator('[data-aktion="kt-einschalten"]').click();
  await expect(page.locator(".toast").last()).toContainText("Die Statuszeile für „Privat“ ist neu verknüpft.");
  expect(kt.log("POST").map((a) => a.body.konto)).toEqual(["k_aaaa0002", "k_aaaa0001"]);
});

test("Ausschalten, wenn die Statuszeile schon weg war: der Hinweis sagt „war schon aus“ statt „Einstellungen wie vorher“", async ({ page }) => {
  const { kt } = await start(page, { hash: "#einstellungen/ki?ziel=ki-kontingent", konten: [PRIVAT], werte: { k_aaaa0001: Z.claudeOk(42, 18) } });
  kt.aktion = "schon-weg";
  await spalte(page, "k_aaaa0001").locator('[data-aktion="kt-aus"]').click();
  await dlg(page, "kt-ausschalten").locator('[data-aktion="kt-ausschalten"]').click();
  await expect(page.locator(".toast").last()).toContainText("war schon aus: Die Statuszeile von Kortex stand nicht mehr in den Einstellungen.");
  await expect(page.locator(".toast").last()).not.toContainText("wieder genau wie vorher");
});
