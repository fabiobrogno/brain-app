// Anmelde-Panel „Im Browser anmelden“ (Ressourcen/studio/anmeldung.js, Paket E3): Claude mit Adresse und optionalem Code, Codex mit Gerätecode, Warten mit leisem Countdown,
// Frist/Fehler mit Rückfall „Im Terminal anmelden“, Abbrechen, Hell/Dunkel. Läuft ohne App und ohne Werkstatt auf einer Testseite; die Routen /api/ki/anmeldelauf* sind Attrappen,
// die Hülle (window.webkit …aktion) ist eine Attrappe, die ihre Aufrufe mitschreibt. Kein Terminal, kein echtes Programm. Bilder: KORTEX_BILDER=/Ordner.
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { starteDateien } from "./modul-seite.mjs";

let dateien;
test.beforeAll(async () => { dateien = await starteDateien(); });
test.afterAll(() => dateien?.stopp());
const BILDER = process.env.KORTEX_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });

const SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="/studio.css"><link rel="stylesheet" href="/bausteine.css"><link rel="stylesheet" href="/anmeldung.css">
<style>body { background: var(--papier); } #host { width: 420px; margin: 24px; padding: 18px; background: var(--erhoben); border: 1px solid var(--linie); border-radius: 14px; }</style></head>
<body><div id="host"></div><div id="dialog-host"></div><div id="menue-host"></div><div id="toast-host"></div>
<script type="module">
import { starteAnmeldung } from "/anmeldung.js";
window.__starte = (programm, konto, opt) => { window.__a = starteAnmeldung(programm, konto, { host: document.getElementById("host"), ...opt }); window.__erg = null; window.__a.ergebnis.then((e) => { window.__erg = e; }); };
window.__bereit = true;
</script></body></html>`;

const URL_CLAUDE = "https://claude.ai/oauth/authorize?code=true&client_id=testkennung&response_type=code&state=zustand123";

// Skript der Attrappe: `ablauf` = Liste von Ständen, die die Abfrage der Reihe nach liefert (der letzte bleibt).
async function oeffne(page, { ablauf, thema = "light", startFehler = null, codeAntwort = 200 } = {}) {
  await page.emulateMedia({ colorScheme: thema });
  await page.addInitScript(() => {
    window.__aktionen = [];
    window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); return Promise.resolve({ ok: true }); } } } };
    window.__schreibe = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__schreibe.push(t); return Promise.resolve(); } }, configurable: true });
  });
  const ruf = { start: [], stand: 0, code: [], abbruch: [], terminal: [], neuesKonto: [] };
  let i = 0;
  await page.route(/\/__anmeldung\.html$/, (r) => r.fulfill({ contentType: "text/html", body: SEITE }));
  await page.route(/\/api\/ki\/anmeldelauf(\/code|\/abbrechen)?(\?.*)?$/, async (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname.endsWith("/code")) { ruf.code.push(JSON.parse(r.request().postData())); return codeAntwort === 200 ? json(200, { ok: true }) : json(codeAntwort, { fehler: "x", art: "ungueltig" }); }
    if (u.pathname.endsWith("/abbrechen")) { ruf.abbruch.push(JSON.parse(r.request().postData())); return json(200, { ok: true, phase: "abgebrochen" }); }
    if (m === "POST") { ruf.start.push(JSON.parse(r.request().postData())); if (startFehler) return json(startFehler.status, startFehler.body); return json(200, { ok: true, id: "a_test1", ...ablauf[0] }); }
    ruf.stand++; const s = ablauf[Math.min(++i, ablauf.length - 1)]; return json(200, { ok: true, id: "a_test1", ...s });
  });
  await page.route(/\/api\/ki\/(anmelden|konto-neu|konten)$/, async (r) => {
    const m = r.request().method();
    if (m === "POST" && r.request().url().endsWith("/anmelden")) { ruf.terminal.push(JSON.parse(r.request().postData())); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, anzeige: "claude auth login" }) }); }
    if (m === "POST") { ruf.neuesKonto.push(JSON.parse(r.request().postData())); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ausstehend: { id: "k_neu", programm: "claude", pfad: "/tmp/kortex/ki-konten-ordner/claude-firma" } }) }); }
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ konten: [{ id: "k_alt", programm: "claude", standard: false, pfad: "/tmp/kortex/ki-konten-ordner/claude-alt", ordner: "~/x" }] }) });
  });
  await page.goto(dateien.url + "__anmeldung.html");
  await page.waitForFunction(() => window.__bereit === true);
  return ruf;
}
const t = (page, n) => page.locator(`[data-test="${n}"]`);
const bild = async (page, name, thema) => { if (BILDER) await page.locator("#host").screenshot({ path: join(BILDER, `anmeldung-${name}-${thema === "dark" ? "dunkel" : "hell"}.png`) }); };

const STAND = {
  start: { phase: "start", url: null, code: null, codeMoeglich: false, verbleibendMs: 28000, grund: null, rueckfall: false },
  claude: { phase: "wait", url: URL_CLAUDE, code: null, codeMoeglich: true, verbleibendMs: 585000, grund: null, rueckfall: false },
  codex: { phase: "wait", url: "https://auth.openai.com/codex/device", code: "ABCD-12345", codeMoeglich: false, verbleibendMs: 890000, grund: null, rueckfall: false },
};

for (const thema of ["light", "dark"]) {
  test.describe(`Panel (${thema === "dark" ? "dunkel" : "hell"})`, () => {
    test("Claude: Start → Browser-Knopf, Link kopieren, Countdown, Code einfügen, fertig mit neuem Konto", async ({ page }) => {
      const ruf = await oeffne(page, { thema, ablauf: [STAND.start, STAND.claude, STAND.claude, { phase: "ok", konto: { id: "k_neu", name: "Firma", programm: "claude" } }] });
      await page.evaluate(() => window.__starte("claude", { neu: "Firma" }));
      await expect(page.locator(".an-titel")).toHaveText("Bei Claude Code anmelden");
      await expect(page.locator(".an-arbeit")).toContainText("Kortex startet die Anmeldung");
      await expect(t(page, "an-terminal")).toBeVisible(); // der leise Rückfall ist von Anfang an da
      expect(ruf.start).toEqual([{ programm: "claude", neu: "Firma" }]);
      await expect(t(page, "an-browser")).toBeVisible();
      await expect(t(page, "an-browser")).toHaveText("Im Browser anmelden");
      await expect(t(page, "an-link")).toHaveText("Link kopieren");
      await expect(t(page, "an-rest")).toHaveText(/^noch \d+:\d\d$/);
      await expect(page.locator(".an-code")).toHaveCount(0);
      await bild(page, "claude-wartet", thema);
      // Browser: Aktion `extern` der Hülle mit genau dieser Adresse
      await t(page, "an-browser").click();
      expect(await page.evaluate(() => window.__aktionen)).toEqual([{ aktion: "extern", wert: URL_CLAUDE }]);
      // Link kopieren
      await t(page, "an-link").click();
      await expect(page.locator(".an-kopiert").first()).toHaveText("Link kopiert.");
      expect(await page.evaluate(() => window.__schreibe)).toEqual([URL_CLAUDE]);
      // Code einfügen: eingeklappt, dann Feld; ein Takt der Abfrage lässt Fokus und Text stehen
      await expect(t(page, "an-code-feld")).toBeHidden();
      await t(page, "an-code-einfuegen").click();
      await expect(t(page, "an-code-feld")).toBeVisible();
      await t(page, "an-code-feld").fill("abcd1234#zustand");
      await bild(page, "claude-code", thema);
      await t(page, "an-code-senden").click();
      await expect.poll(() => ruf.code).toEqual([{ id: "a_test1", code: "abcd1234#zustand" }]);
      await expect(page.locator(".an-kopiert").last()).toContainText("Code gesendet");
      // Ende: Haken, Ergebnis mit Konto
      await expect(page.locator(".an-meldung.ok")).toHaveText("Konto „Firma“ ist angemeldet");
      await expect.poll(() => page.evaluate(() => window.__erg)).toEqual({ phase: "ok", konto: { id: "k_neu", name: "Firma", programm: "claude" } });
      await bild(page, "fertig", thema);
    });

    test("Codex: Gerätecode groß, Code kopieren, kein Codefeld", async ({ page }) => {
      const ruf = await oeffne(page, { thema, ablauf: [STAND.codex] });
      await page.evaluate(() => window.__starte("codex", "k_alt"));
      expect(ruf.start).toEqual([{ programm: "codex", konto: "k_alt" }]);
      await expect(page.locator(".an-titel")).toHaveText("Bei Codex anmelden");
      await expect(page.locator(".an-code")).toHaveText("ABCD-12345");
      await expect(t(page, "an-code-einfuegen")).toHaveCount(0);
      await t(page, "an-code-kopieren").click();
      await expect(page.locator(".an-kopiert").first()).toHaveText("Code kopiert.");
      expect(await page.evaluate(() => window.__schreibe)).toEqual(["ABCD-12345"]);
      await t(page, "an-browser").click();
      expect((await page.evaluate(() => window.__aktionen)).at(-1)).toEqual({ aktion: "extern", wert: "https://auth.openai.com/codex/device" });
      await bild(page, "codex", thema);
    });

    test("Fehler: keine Adresse → Meldung, „Noch einmal“ startet neu, Terminal-Link ist hervorgehoben und öffnet den bisherigen Weg (neues Konto wird dafür angelegt)", async ({ page }) => {
      const ruf = await oeffne(page, { thema, ablauf: [STAND.start, { phase: "error", url: null, code: null, codeMoeglich: false, verbleibendMs: null, grund: "keine-adresse", rueckfall: true }] });
      await page.evaluate(() => window.__starte("claude", { neu: "Firma" }));
      await expect(page.locator(".an-meldung.fehler")).toContainText("keine Anmeldeadresse");
      await expect(t(page, "an-nochmal")).toBeVisible();
      await bild(page, "fehler", thema);
      await t(page, "an-nochmal").click();
      await expect.poll(() => ruf.start.length).toBe(2);
      await expect(page.locator(".an-meldung.fehler")).toBeVisible();
      await t(page, "an-terminal").click();
      await expect(page.locator(".an-meldung.ok")).toContainText("Das Terminal ist offen");
      expect(ruf.neuesKonto).toEqual([{ programm: "claude", name: "Firma" }]);
      expect(ruf.terminal).toEqual([{ programm: "claude", ordner: "/tmp/kortex/ki-konten-ordner/claude-firma" }]);
      await expect.poll(() => page.evaluate(() => window.__erg)).toEqual({ phase: "terminal", ausstehend: { id: "k_neu", pfad: "/tmp/kortex/ki-konten-ordner/claude-firma" } });
    });

    test("Frist abgelaufen: Meldung „Die Zeit ist abgelaufen“; bestehendes Konto: Terminal-Weg mit dem Ordner des Kontos", async ({ page }) => {
      const ruf = await oeffne(page, { thema, ablauf: [STAND.claude, { phase: "timeout", url: URL_CLAUDE, code: null, codeMoeglich: false, verbleibendMs: null, grund: "abgelaufen", rueckfall: false }] });
      await page.evaluate(() => window.__starte("claude", "k_alt"));
      await expect(page.locator(".an-meldung.fehler")).toContainText("Die Zeit ist abgelaufen");
      await bild(page, "timeout", thema);
      await t(page, "an-terminal").click();
      await expect(page.locator(".an-meldung.ok")).toContainText("Das Terminal ist offen");
      expect(ruf.terminal).toEqual([{ programm: "claude", ordner: "/tmp/kortex/ki-konten-ordner/claude-alt" }]);
      expect(ruf.neuesKonto).toEqual([]);
    });
  });
}

test("Abbrechen: die Werkstatt wird benachrichtigt, das Ergebnis lautet „abgebrochen“", async ({ page }) => {
  const ruf = await oeffne(page, { ablauf: [STAND.claude] });
  await page.evaluate(() => window.__starte("claude", { neu: "Firma" }));
  await expect(t(page, "an-browser")).toBeVisible();
  await t(page, "an-abbrechen").click();
  await expect(page.locator(".an")).toContainText("Anmeldung abgebrochen");
  expect(ruf.abbruch).toEqual([{ id: "a_test1" }]);
  expect(await page.evaluate(() => window.__erg)).toEqual({ phase: "abgebrochen" });
});

test("Startfehler der Werkstatt (Programm fehlt, zu oft): ruhige Meldung statt Hängen; Terminal-Weg bleibt", async ({ page }) => {
  await oeffne(page, { ablauf: [STAND.start], startFehler: { status: 409, body: { fehler: "Claude Code wurde nicht gefunden.", art: "nicht-gefunden", rueckfall: true } } });
  await page.evaluate(() => window.__starte("claude", { neu: "Firma" }));
  await expect(page.locator(".an-meldung.fehler")).toContainText("nicht gefunden");
  await expect(t(page, "an-terminal")).toBeVisible();
});

test("zerstoere während des Wartens bricht ab und entfernt das Panel; ein falscher Code zeigt einen Fehler am Feld", async ({ page }) => {
  const ruf = await oeffne(page, { ablauf: [STAND.claude], codeAntwort: 400 });
  await page.evaluate(() => window.__starte("claude", { neu: "Firma" }));
  await t(page, "an-code-einfuegen").click();
  await t(page, "an-code-feld").fill("kaputt kaputt");
  await t(page, "an-code-senden").click();
  await expect(page.locator(".bs-fehler")).toContainText("sieht nicht richtig aus");
  await page.evaluate(() => window.__a.zerstoere());
  await expect(page.locator(".an")).toHaveCount(0);
  await expect.poll(() => ruf.abbruch.length).toBe(1);
});
