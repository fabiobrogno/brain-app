// Frag deinen Vault (P4): Panel, Streaming, Quellen, Abbruch, sicheres Rendern, leere Zustände, hell/dunkel — gegen die echte Werkstatt und den echten MCP-Server.
// Das einzige Attrappe ist `claude` (Tests/Kern/fake-claude-frage.mjs: strenges Argument-Parsing, prüft die Schutzgeländer). Umgebung des Servers ausdrücklich gebaut (eigenes HOME,
// PATH nur mit dem Attrappen-Ordner), Konten in einem Temp-Home, nichts vom Rechner des Entwicklers. Bilder: UI_FRAGE_BILDER=/Ordner npx playwright test frage.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const FAKE = join(WURZEL, "Tests/Kern/fake-claude-frage.mjs");
const BILDER = process.env.UI_FRAGE_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name) => { if (BILDER) { await page.waitForTimeout(350); await page.screenshot({ path: join(BILDER, `${name}.png`) }); } };

let vault, server, bin, home;
// stufen: je Konto die Stufe im Vault; mitClaude: false → kein `claude` im Suchpfad; vertraut: false → Vault von außen geöffnet
async function aufbauen({ stufen = { a: "lesen", b: "lesen", g: "gesperrt", c: "lesen" }, mitClaude = true, vertraut = true } = {}) {
  ({ vault } = baueVault());
  vault = realpathSync(vault);
  const wurzel = realpathSync(mkdtempSync(join(tmpdir(), "brain-ui-frage-")));
  home = join(wurzel, "home"); bin = join(wurzel, "bin"); const support = join(wurzel, "support");
  for (const d of [home, bin, support]) mkdirSync(d);
  const profil = (n) => { const p = join(home, n); mkdirSync(p); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil(".claude-arbeit"), b = profil(".claude-privat"), g = profil(".claude-geheim"), c = profil(".codex");
  const ein = (id, programm, ordner, name, extra = {}) => [id, { programm, ordner, standard: false, name, ordnerKennung: K.kennungVon(ordner), ...extra }];
  K.aendere(support, () => ({ version: 1,
    konten: Object.fromEntries([ein("k_aaaaaaaa", "claude", a, "Arbeit", { abo: "max" }), ein("k_bbbbbbbb", "claude", b, "Privat", { abo: "api" }), ein("k_cccccccc", "codex", c, "Codex-Konto"), ein("k_dddddddd", "claude", g, "Geheimkonto")]),
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufen.a, k_bbbbbbbb: stufen.b, k_cccccccc: stufen.c, k_dddddddd: stufen.g } } } }));
  if (mitClaude) {
    writeFileSync(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
    chmodSync(join(bin, "claude"), 0o755);
  }
  server = await starteServer(vault, { vertraut, support, umgebung: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, LANG: "de_DE.UTF-8", BRAIN_CLAUDE_EXTRA: "" } });
  return { wurzel };
}
const szenario = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
test.afterEach(() => { server?.stopp(); server = null; });

async function oeffneStudio(page) {
  await page.goto(server.url);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
}
const panel = (page) => page.locator('[data-frage="panel"]');
async function oeffnePanel(page) {
  await page.click("#knopf-frage");
  await expect(panel(page)).toBeVisible();
}
const waehleKonto = async (page, id) => { await page.click('[data-frage="konto"]'); await page.click(`.bs-opt[data-wert="${id}"]`); };
const frageStellen = async (page, text) => {
  await page.fill('[data-frage="eingabe"]', text);
  await page.click('[data-aktion="frage-senden"]');
};

test("Panel: Knopf und ⌘J öffnen, Esc schließt; nur erlaubte Konten mit Logo und Name; Hinweis „Nichts wird gespeichert“", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press("Meta+j");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator("#knopf-frage")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-frage="eingabe"]').focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await page.click("#knopf-frage");
  await expect(panel(page)).toBeVisible();
  // Konten: Arbeit und Privat (Claude), Logo + Name; das gesperrte „Geheimkonto“ und Codex sind nicht wählbar
  const wahl = page.locator('[data-frage="konto"]'); // Baustein „Auswahl“ (bausteine.js), kein natives <select>
  await expect(wahl).toContainText("Arbeit");
  await expect(wahl.locator(".ki-logo")).toHaveCount(1);
  await expect(panel(page).locator("select")).toHaveCount(0);
  await wahl.click();
  await expect(page.locator(".bs-opt")).toHaveCount(2);
  await expect(page.locator(".bs-opt").nth(0)).toContainText("Arbeit");
  await expect(page.locator(".bs-opt").nth(1)).toContainText("Privat");
  await expect(page.locator(".bs-opt .ki-logo")).toHaveCount(2);
  await bild(page, "01b-konto-auswahl-hell");
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-opt")).toHaveCount(0);
  await expect(panel(page)).toBeVisible(); // Esc schloss nur die Liste
  await expect(panel(page)).not.toContainText("Geheimkonto");
  await expect(page.locator('[data-frage="modell"] .bs-seg')).toHaveCount(2);
  await expect(page.locator('[data-frage="nur-claude"]')).toContainText("Nur Claude Code");
  await expect(page.locator('[data-frage="weg"]')).toContainText("gehen an Anthropic über das Konto „Arbeit“");
  await expect(page.locator('[data-frage="fuss"]')).toContainText("Nichts wird gespeichert");
  await waehleKonto(page, "k_bbbbbbbb");
  await expect(page.locator('[data-frage="weg"]')).toContainText("Konto „Privat“");
  await expect(page.locator('[data-aktion="frage-senden"]')).toBeDisabled(); // ohne Text kein Senden
  // ⌘J über den Befehl in der Palette ebenso
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Frag deinen");
  await expect(page.locator(".pal-liste")).toContainText("Frag deinen Vault");
  await bild(page, "01-panel-bereit-hell");
});

test("Streaming: Status, wachsende Antwort, Quellen nur aus dem Vault (klickbar), Verbrauch je Abo, Neue Frage", async ({ page }) => {
  await aufbauen();
  szenario({ deltaMs: 140, antwort: "Kaffee ist ein Heißgetränk aus gerösteten Bohnen und wird weltweit getrunken. Siehe [[09_wiki/wissen/Kaffee.md]] und [[09_wiki/wissen/Gibt-es-nicht.md]]." });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await frageStellen(page, "Was ist Kaffee?");
  await expect(page.locator('[data-frage="gefragt"]')).toContainText("Was ist Kaffee?");
  await expect(page.locator('[data-frage="status"]')).toBeVisible();
  await expect(page.locator('[data-aktion="frage-abbrechen"]')).toBeVisible();
  await expect(page.locator('[data-frage="eingabe"]')).toBeHidden(); // während der Frage zeigt das Panel nur Frage, Antwort und Quellen
  await expect(page.locator('[data-frage="gefragt"]')).toContainText("Arbeit");
  // die Antwort wächst: erst ein Anfang, dann mehr
  const antwort = page.locator('[data-frage="antwort"]');
  await expect(antwort).toContainText("Kaffee ist");
  const frueh = (await antwort.textContent()).length;
  await bild(page, "02-streaming-hell");
  await expect(page.locator('[data-frage="status"]')).toBeHidden({ timeout: 15000 });
  const spaet = (await antwort.textContent()).length;
  expect(spaet).toBeGreaterThan(frueh);
  await expect(antwort).toContainText("gerösteten Bohnen und wird weltweit getrunken");
  // Verweis auf eine vorhandene Seite ist ein Knopf, die erfundene nur durchgestrichener Text
  await expect(antwort.locator("button.md-wiki")).toHaveCount(1);
  await expect(antwort.locator(".md-wiki.nein")).toHaveCount(1);
  // Quellen: nur Seiten, die es gibt; Kaffee zuerst (genannt), mit Prüf-Stufe
  const quellen = page.locator(".frage-quelle");
  await expect(quellen.first()).toHaveAttribute("data-pfad", "09_wiki/wissen/Kaffee.md");
  await expect(quellen.first()).toContainText("Kaffee");
  await expect(quellen.first().locator(".frage-stufe")).toHaveCount(1);
  await expect(quellen.first().locator(".frage-art")).toHaveText("genannt");
  for (const p of await quellen.evaluateAll((l) => l.map((x) => x.dataset.pfad))) expect(existsSync(join(vault, p)), p).toBe(true);
  await expect(page.locator('[data-frage="unbekannt"]')).toContainText("eine Seite, die es nicht gibt");
  // Abo „max“: Kontingent
  await expect(page.locator('[data-frage="verbrauch"]')).toContainText("zählt zum Kontingent deines Abos");
  await expect(page.locator('[data-frage="verbrauch"]')).toContainText("1.700 Tokens");
  await bild(page, "03-antwort-quellen-hell");
  // ein Klick auf die Quelle öffnet die Seite, das Panel bleibt
  await quellen.first().click();
  await expect(page.locator("#pfad")).toContainText("Kaffee");
  await expect(panel(page)).toBeVisible();
  // Neue Frage: alles leer, Eingabe frei; Konto Privat (API): Kosten statt Kontingent
  await page.click('[data-aktion="frage-neue"]');
  await expect(page.locator('[data-frage="antwort"]')).toHaveCount(0);
  await expect(page.locator('[data-frage="eingabe"]')).toBeEnabled();
  await expect(page.locator('[data-frage="eingabe"]')).toHaveValue("");
  szenario({ antwort: "Reise im Mai. [[10_notizen/Reise nach Lissabon.md]]", kosten: 0.0345 });
  await waehleKonto(page, "k_bbbbbbbb");
  await frageStellen(page, "Wann ist die Reise?");
  await expect(page.locator('[data-frage="verbrauch"]')).toContainText("ca. 0,03 $ (Schätzung von Claude Code)", { timeout: 15000 });
  await expect(page.locator('[data-frage="verbrauch"]')).not.toContainText("Kontingent");
  // Nichts liegt im Vault: kein Verlauf, keine Datei
  expect(existsSync(join(vault, ".logs", "mcp.log"))).toBe(false);
});

test("Abbrechen: die Frage endet sofort, der Text bleibt, „Neue Frage“ erscheint; Esc bricht ebenfalls ab", async ({ page }) => {
  await aufbauen();
  szenario({ warteMs: 60000 });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await frageStellen(page, "Was ist Kaffee?");
  await expect(page.locator('[data-frage="status"]')).toBeVisible();
  await expect.poll(() => existsSync(join(bin, "wartet")), { timeout: 15000 }).toBe(true);
  const pid = readFileSync(join(bin, "wartet"), "utf8");
  await page.click('[data-aktion="frage-abbrechen"]');
  await expect(page.locator('[data-frage="abgebrochen"]')).toContainText("Abgebrochen.", { timeout: 10000 });
  await expect(page.locator('[data-aktion="frage-neue"]')).toBeVisible();
  await bild(page, "04-abgebrochen-hell");
  await expect.poll(() => { try { process.kill(Number(pid), 0); return false; } catch { return true; } }, { timeout: 5000 }).toBe(true);
  // zweiter Weg: Esc im Panel
  await page.click('[data-aktion="frage-neue"]');
  szenario({ warteMs: 60000 });
  rmSync(join(bin, "wartet"), { force: true });
  await frageStellen(page, "Noch eine Frage");
  await expect.poll(() => existsSync(join(bin, "wartet")), { timeout: 15000 }).toBe(true);
  await page.locator('[data-frage="panel"]').focus();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-frage="abgebrochen"]')).toBeVisible({ timeout: 10000 });
  await expect(panel(page)).toBeVisible();
  // Panel schließen während einer Frage bricht ab
  await page.click('[data-aktion="frage-neue"]');
  rmSync(join(bin, "wartet"), { force: true });
  await frageStellen(page, "Und noch eine");
  await expect.poll(() => existsSync(join(bin, "wartet")), { timeout: 15000 }).toBe(true);
  const pid3 = readFileSync(join(bin, "wartet"), "utf8");
  await page.click('[data-aktion="frage-zu"]');
  await expect.poll(() => { try { process.kill(Number(pid3), 0); return false; } catch { return true; } }, { timeout: 8000 }).toBe(true);
});

test("Sicher gerendert: HTML aus der Antwort bleibt Text, keine Skripte, keine Bilder, keine Links; Markdown wird Struktur", async ({ page }) => {
  await aufbauen();
  szenario({ ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [],
    antwort: "# Titel\n\n**fett** und `code` <img src=x onerror=\"window.__xss=1\"> <script>window.__xss=2</script>\n\n- Punkt eins\n- Punkt zwei\n\n[böse](javascript:alert(1)) und [gut](https://example.org/x)\n\n```\n<b>roh</b>\n```\n\n| a | b |\n|---|---|\n| 1 | <i>2</i> |\n\n[[09_wiki/wissen/Kaffee.md]] <a href=\"https://example.org\">link</a>" });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await frageStellen(page, "Test");
  const antwort = page.locator('[data-frage="antwort"]');
  await expect(antwort).toContainText("fett", { timeout: 15000 });
  await expect(page.locator('[data-aktion="frage-neue"]')).toBeVisible();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  for (const verboten of ["img", "script", "a", "iframe", "i", "b", "svg", "style"]) await expect(antwort.locator(verboten)).toHaveCount(0);
  await expect(antwort.locator("strong")).toHaveText("fett");
  await expect(antwort.locator("h3")).toHaveText("Titel");
  await expect(antwort.locator("li")).toHaveCount(2);
  await expect(antwort.locator("table")).toHaveCount(1);
  await expect(antwort).toContainText('<img src=x onerror="window.__xss=1">'); // sichtbar als Text
  await expect(antwort).toContainText("<script>window.__xss=2</script>");
  await expect(antwort).toContainText("<b>roh</b>");
  await expect(antwort).toContainText("(https://example.org/x)");
  await expect(antwort).not.toContainText("javascript:alert"); // die Adresse eines Nicht-Web-Links wird gar nicht gezeigt
  await expect(antwort.locator("[href], [src], [onerror], [onclick]")).toHaveCount(0);
  await bild(page, "05-sicheres-rendern-hell");
});

test("Fehler: Meldung von Claude Code erscheint als Hinweis, Neue Frage geht", async ({ page }) => {
  await aufbauen();
  szenario({ art: "fehler", ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await frageStellen(page, "Test");
  const f = page.locator('[data-frage="fehler"]');
  await expect(f).toBeVisible({ timeout: 15000 });
  await expect(f).toContainText("Das hat nicht geklappt");
  await expect(f).toContainText("Invalid API key");
  await expect(f).toHaveAttribute("role", "alert");
  await page.click('[data-aktion="frage-neue"]');
  await expect(page.locator('[data-frage="fehler"]')).toHaveCount(0);
});

test("Leere Zustände: Vault nicht bestätigt, Claude Code fehlt, kein Konto erlaubt, nur Codex erlaubt — jeweils mit Weg zur Lösung", async ({ page }) => {
  // 1. nicht vertraut
  await aufbauen({ vertraut: false });
  await page.goto(server.url);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
  await page.keyboard.press("Escape"); // die Vertrauensfrage beim Öffnen
  await page.evaluate(() => document.querySelectorAll("#dialog-host .schleier").forEach((e) => e.remove()));
  await oeffnePanel(page);
  const leer = page.locator('[data-frage="leer"]');
  await expect(leer).toContainText("Dieser Vault ist noch nicht bestätigt");
  await expect(leer).toHaveAttribute("data-grund", "nicht-vertraut");
  await expect(leer.locator('[data-aktion="frage-leer-aktion"]')).toHaveText("Vault prüfen und bestätigen …");
  await expect(page.locator('[data-frage="eingabe"]')).toBeHidden();
  await bild(page, "06-leer-nicht-bestaetigt-hell");
  await leer.locator('[data-aktion="frage-leer-aktion"]').click();
  await expect(page.locator("#dialog-host [data-dialog='vertrauen']")).toBeVisible(); // der Weg zur Lösung: der Vertrauensdialog
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(leer).toBeHidden({ timeout: 8000 }); // nach der Bestätigung prüft das Panel von selbst neu
  await expect(page.locator('[data-frage="eingabe"]')).toBeVisible();
  server.stopp();
  // 2. Claude Code fehlt
  await aufbauen({ mitClaude: false });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(page.locator('[data-frage="leer"]')).toContainText("Claude Code ist nicht installiert");
  await expect(page.locator('[data-frage="leer"]')).toContainText("code.claude.com");
  await expect(page.locator('[data-frage="leer"] [data-aktion="frage-leer-aktion"]')).toHaveText("Noch einmal prüfen");
  await bild(page, "07-leer-kein-claude-hell");
  server.stopp();
  // 3. kein Konto darf lesen
  await aufbauen({ stufen: { a: "gesperrt", b: "gesperrt", g: "gesperrt", c: "gesperrt" } });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(page.locator('[data-frage="leer"]')).toContainText("Kein KI-Konto darf diesen Vault lesen");
  await expect(page.locator('[data-frage="leer"] [data-aktion="frage-leer-aktion"]')).toHaveText("KI verbinden und freigeben …");
  await expect(page.locator("body")).not.toContainText("Geheimkonto");
  await bild(page, "08-leer-kein-konto-hell");
  await page.locator('[data-frage="leer"] [data-aktion="frage-leer-aktion"]').click();
  await expect(page.locator("#dialog-host .dialog")).toBeVisible(); // der bestehende Dialog „KI verbinden“
  await page.keyboard.press("Escape");
  server.stopp();
  // 4. nur Codex erlaubt
  await aufbauen({ stufen: { a: "gesperrt", b: "gesperrt", g: "gesperrt", c: "lesen" } });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(page.locator('[data-frage="leer"]')).toContainText("Hier fragt bisher nur Claude Code");
});

for (const modus of ["hell", "dunkel"]) {
  test(`Aussehen ${modus}: Panel, Antwort und Quellen lesbar (kein Überlauf, Kontrast der Texte)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: modus === "dunkel" ? "dark" : "light" });
    await aufbauen();
    szenario({ antwort: "## Kaffee\n\nKaffee ist ein **Heißgetränk**.\n\n- aus [[09_wiki/wissen/Kaffee.md]]\n- und [[09_wiki/wissen/Mühle.md]]", lesen: ["09_wiki/wissen/Kaffee.md"] });
    await oeffneStudio(page);
    await oeffnePanel(page);
    await frageStellen(page, "Was ist Kaffee?");
    await expect(page.locator('[data-aktion="frage-neue"]')).toBeVisible({ timeout: 15000 });
    const k = await page.evaluate(() => {
      const p = document.querySelector('[data-frage="panel"]'), r = document.querySelector(".frage-rumpf");
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); };
      const farbe = (sel) => { const e = document.querySelector(sel); const s = getComputedStyle(e); return { text: s.color, grund: getComputedStyle(p).backgroundColor }; };
      const a = farbe(".frage-antwort"), q = farbe(".frage-quelle-titel"), l = farbe(".frage-label");
      return { breiteOk: r.scrollWidth <= r.clientWidth + 1, antwort: kontrast(a.text, a.grund), quelle: kontrast(q.text, a.grund), label: kontrast(l.text, a.grund), schema: matchMedia("(prefers-color-scheme: dark)").matches };
    });
    expect(k.schema).toBe(modus === "dunkel");
    expect(k.breiteOk).toBe(true);
    expect(k.antwort).toBeGreaterThan(4.5); expect(k.quelle).toBeGreaterThan(4.5); expect(k.label).toBeGreaterThan(3);
    await bild(page, `09-antwort-${modus}`);
    await page.click('[data-aktion="frage-neue"]');
    await bild(page, `10-bereit-${modus}`);
  });
}

test("Rechenzeit: Antworten mit pathologischem Markdown (Treppe aus Backticks, 80 KB) rendern in Bruchteilen einer Sekunde", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  const ms = await page.evaluate(async () => {
    const { rendereMarkdown } = await import("/frage-markdown.js");
    let treppe = ""; for (let i = 1; treppe.length < 80_000; i++) treppe += "`".repeat(i) + "a";
    const varianten = [treppe, "`a ".repeat(26_000), "**a ".repeat(20_000), "[[x ".repeat(20_000), "_a ".repeat(26_000), ("*".repeat(300) + "a").repeat(260), "x".repeat(80_000)];
    const t0 = performance.now();
    for (const v of varianten) rendereMarkdown(v);
    return performance.now() - t0;
  });
  expect(ms).toBeLessThan(1500);
});
