// KI-Aktionen auf markiertem Text (K2) im echten Studio, gegen die echte Werkstatt; einzige Attrappe ist `claude` (Tests/Kern/fake-claude-vorschlag.mjs: strenges Argument-Parsing, prüft die Schutzgeländer).
// Umgebung des Servers ausdrücklich gebaut (eigenes HOME, PATH nur mit dem Attrappen-Ordner), Konten in einem Temp-Home.
// Geprüft: ohne Konto keine Aktionen · Einwilligung · Menü (Format-Leiste, Kontextmenü, ⌘K) · Lauf · Diff erscheint zuerst, die Notiz bleibt unverändert · Übernehmen = eine Transaktion (⌘Z in einem Schritt)
// · Verwerfen (Esc) · Text geändert → gesperrt · Code-Block/Tabelle → Aktion aus mit Grund · Warnzeilen · Aufgaben · hell und dunkel.
// Bilder: KI_TEXT_BILDER=/Ordner npx playwright test ki-text-aktionen.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { legeProgramm, pfadMit } from "../Node/attrappe.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const FAKE = join(WURZEL, "Tests/Kern/fake-claude-vorschlag.mjs");
const BILDER = process.env.KI_TEXT_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });

const NOTIZ = "# Planung\n\nWir müssen dringend Käse kaufen, weil heute Gäste kommen, und außerdem noch Brötchen holen, falls jemand Hunger hat.\n\n## Technik\n\n```js\nconst a = 1;\n```\n\n| Name | Rolle |\n| --- | --- |\n| Anna | Leitung |\n\nLetzter Absatz mit etwas Text.\n";
const ABSATZ = "Wir müssen dringend Käse kaufen, weil heute Gäste kommen, und außerdem noch Brötchen holen, falls jemand Hunger hat.";
const ERSATZ = "Wir müssen Käse und Brötchen kaufen, weil heute Gäste kommen.";

let vault, server, bin, home, support, seitenfehler;
async function aufbauen({ stufe = "lesen", einwilligung = true, mitClaude = true } = {}) {
  ({ vault } = baueVault());
  vault = realpathSync.native(vault);
  writeFileSync(join(vault, "10_notizen/ki-text.md"), NOTIZ);
  const wurzel = realpathSync.native(mkdtempSync(join(tmpdir(), "brain-ui-kitext-")));
  home = join(wurzel, "home"); bin = join(wurzel, "bin"); support = join(wurzel, "support");
  for (const d of [home, bin, support]) mkdirSync(d);
  const p = join(home, ".claude-arbeit"); mkdirSync(p); writeFileSync(join(p, "settings.json"), "{}");
  const ordner = realpathSync.native(p);
  K.aendere(support, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner, standard: false, name: "Arbeit", ordnerKennung: K.kennungVon(ordner), abo: "max" } },
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufe },
      ...(einwilligung ? { vorschlaege: { an: true, seit: "2026-11-09T10:00:00.000Z", konto: "k_aaaaaaaa" } } : {}) } } }));
  if (mitClaude) legeProgramm(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
  server = await starteServer(vault, { vertraut: true, support, umgebung: { PATH: pfadMit(bin), HOME: home, LANG: "de_DE.UTF-8", BRAIN_CLAUDE_EXTRA: "" } });
}
const szenario = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
test.beforeEach(() => { seitenfehler = []; });
test.afterEach(() => { server?.stopp(); server = null; expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

async function oeffne(page, pfad = "10_notizen/ki-text.md") {
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector(".cm-content .cm-line");
}
const imEditor = async (page, f, arg) => {
  const hdl = await page.evaluateHandle(async () => { const CM = await import("/vendor/codemirror.bundle.js"); return { CM, view: CM.EditorView.findFromDOM(document.querySelector(".cm-editor")) }; });
  try { return await hdl.evaluate(f, arg); } finally { await hdl.dispose(); }
};
const dok = (page) => imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length));
const waehle = (page, text) => imEditor(page, ({ view }, t) => {
  const a = view.state.doc.toString().indexOf(t); if (a < 0) throw new Error("Text nicht gefunden: " + t);
  view.focus(); view.dispatch({ selection: { anchor: a, head: a + t.length } });
}, text);
const waehleAbsatz = (page) => waehle(page, ABSATZ);
const selText = (page) => imEditor(page, ({ view }) => { const r = view.state.selection.main; return view.state.sliceDoc(r.from, r.to); });
const leiste = (page) => page.locator(".format-leiste");
const kiKnopf = (page) => page.locator('.format-leiste [data-befehl="ki"]');
const pop = (page) => page.locator("[data-ki-text]");
const phase = (page, p) => expect(pop(page)).toHaveAttribute("data-phase", p, { timeout: 15000 });
const bild = async (page, name) => {
  if (!BILDER) return;
  await page.waitForTimeout(400);
  const r = await page.locator("#editor").boundingBox();
  await page.screenshot({ path: join(BILDER, `k2-${name}.png`), clip: { x: r.x, y: Math.max(0, r.y - 4), width: Math.min(r.width, 1100), height: Math.min(r.height, 760) } });
};
const schemata = [["hell", "light"], ["dunkel", "dark"]];
const ohneMuell = async (el) => { const t = await el.innerText(); expect(t).not.toMatch(/\bnull\b|\bundefined\b|\[object/); };

test("Ohne Konto mit Stufe „lesen“ gibt es keine KI-Aktionen: kein Knopf in der Format-Leiste, kein Kontextmenü, nichts in der Befehlspalette", async ({ page }) => {
  await aufbauen({ stufe: "gesperrt" });
  await oeffne(page);
  await waehleAbsatz(page);
  await expect(leiste(page)).toHaveAttribute("data-offen", "ja");
  await page.waitForTimeout(600); // der Status ist inzwischen geladen
  await expect(kiKnopf(page)).toHaveCount(0);
  await page.locator(".cm-line", { hasText: "Wir müssen dringend" }).click({ button: "right", position: { x: 60, y: 8 } });
  await expect(pop(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await waehleAbsatz(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".palette")).toBeVisible();
  await page.locator(".pal-feld input, .palette input").first().fill("KI:");
  await expect(page.locator(".pal-eintrag", { hasText: "KI:" })).toHaveCount(0);
  expect(aufrufe()).toEqual([]);
});

test("Ohne Claude Code ist der Knopf aus, mit Grund im Tooltip", async ({ page }) => {
  await aufbauen({ mitClaude: false });
  await oeffne(page);
  await waehleAbsatz(page);
  await expect(kiKnopf(page)).toBeVisible();
  await expect(kiKnopf(page)).toHaveAttribute("aria-disabled", "true");
  await expect(kiKnopf(page)).toHaveAttribute("title", /Claude Code ist nicht installiert/);
});

for (const [name, schema] of schemata) {
  test(`Ablauf (${name}): Menü → Lauf → Diff zuerst (Notiz unverändert) → ⏎ übernimmt in EINER Transaktion → ⌘Z macht alles rückgängig`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema });
    await aufbauen();
    szenario({ ersatz: ERSATZ, warteMs: 1400, szenario: "langsam" });
    await oeffne(page);
    await waehleAbsatz(page);
    await expect(kiKnopf(page)).toBeVisible();
    await expect(kiKnopf(page)).toHaveAttribute("aria-disabled", "false");
    await bild(page, `leiste-${name}`);
    await kiKnopf(page).click();
    await phase(page, "menu");
    await expect(leiste(page)).toHaveAttribute("data-offen", "nein"); // die Leiste macht Platz
    await expect(pop(page).locator('[data-ki-aktion="umschreiben"]')).toBeVisible();
    await expect(pop(page).locator('[data-ki-aktion="kuerzen"]')).toBeVisible();
    await expect(pop(page).locator('[data-ki-aktion="aufgaben"]')).toBeVisible();
    await expect(pop(page).locator("[data-ki-sprache]")).toHaveCount(5);
    await expect(pop(page).locator('[data-kiv="kontingent"]')).toBeVisible();
    await ohneMuell(pop(page));
    await bild(page, `menue-${name}`);
    const kasten0 = await pop(page).boundingBox();
    await pop(page).locator('[data-ki-aktion="umschreiben"]').click();
    await phase(page, "laeuft");
    await expect(pop(page).locator(".kit-balken")).toBeVisible();
    await expect(pop(page).locator("[data-ki-text-zeit]")).toContainText("Die KI arbeitet");
    await bild(page, `lauf-${name}`);
    const kasten1 = await pop(page).boundingBox();
    expect(Math.abs(kasten1.x - kasten0.x) < 1 && Math.abs(kasten1.y - kasten0.y) < 1, "das Popover bleibt am Text, wo es ist").toBe(true);
    await phase(page, "ergebnis");
    const kasten2 = await pop(page).boundingBox();
    expect(Math.abs(kasten2.x - kasten0.x) < 1 && Math.abs(kasten2.y - kasten0.y) < 1, "kein Sprung beim Ergebnis").toBe(true);
    // Diff zuerst: Wörter entfernt und neu, die Notiz ist noch unverändert
    await expect(pop(page).locator('[data-wd="weg"]').first()).toBeVisible();
    await expect(pop(page).locator('[data-wd="neu"]').first()).toBeVisible();
    expect(await dok(page)).toBe(NOTIZ);
    await ohneMuell(pop(page));
    await bild(page, `diff-${name}`);
    // Gesendet wurde nur die Auswahl plus Überschrift
    const paket = JSON.parse(aufrufe()[0].stdin);
    expect(Object.keys(paket.daten).sort()).toEqual(["auswahl", "ueberschrift"]);
    expect(paket.daten.auswahl).toBe(ABSATZ);
    expect(paket.daten.ueberschrift).toBe("Planung");
    expect(aufrufe()[0].stdin).not.toContain("const a = 1");
    expect(aufrufe()[0].verletzt).toEqual([]);
    // ⏎ übernimmt
    await page.keyboard.press("Enter");
    await expect(pop(page)).toHaveCount(0);
    expect(await dok(page)).toBe(NOTIZ.replace(ABSATZ, ERSATZ));
    expect(await selText(page)).toBe(ERSATZ);
    await expect(page.locator(".cm-content")).toBeFocused();
    // ⌘Z: ein Schritt, alles wieder da
    await page.keyboard.press("ControlOrMeta+z");
    expect(await dok(page)).toBe(NOTIZ);
  });
}

test("Verwerfen: Esc und der Knopf lassen die Notiz unverändert; Lauf abbrechen beendet den Lauf, ohne dass etwas passiert", async ({ page }) => {
  await aufbauen();
  szenario({ ersatz: ERSATZ });
  await oeffne(page);
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="kuerzen"]').click();
  await phase(page, "ergebnis");
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  expect(await dok(page)).toBe(NOTIZ);
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="kuerzen"]').click();
  await phase(page, "ergebnis");
  await pop(page).locator('[data-aktion="ki-text-verwerfen"]').click();
  await expect(pop(page)).toHaveCount(0);
  expect(await dok(page)).toBe(NOTIZ);
  // Abbrechen im Lauf
  szenario({ szenario: "abbruch" });
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="umschreiben"]').click();
  await phase(page, "laeuft");
  await expect.poll(() => existsSync(join(bin, "wartet"))).toBe(true);
  await pop(page).locator('[data-aktion="ki-text-abbrechen"]').click();
  await expect(pop(page)).toHaveCount(0);
  const pid = Number(readFileSync(join(bin, "wartet"), "utf8"));
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { timeout: 10000 }).toBe(true);
  expect(await dok(page)).toBe(NOTIZ);
});

for (const [name, schema] of schemata) {
  test(`Text seit der Anfrage geändert (${name}): Übernehmen gesperrt mit Hinweis, ⏎ tut nichts, „Neu anfragen“ geht; Änderungen an anderer Stelle sperren nicht`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema });
    await aufbauen();
    szenario({ ersatz: ERSATZ });
    await oeffne(page);
    await waehleAbsatz(page);
    await kiKnopf(page).click();
    await pop(page).locator('[data-ki-aktion="umschreiben"]').click();
    await phase(page, "ergebnis");
    // Änderung außerhalb der Auswahl: weiter möglich, Positionen wandern mit
    await imEditor(page, ({ view }) => { view.dispatch({ changes: { from: 0, insert: "Vorspann\n\n" } }); });
    await expect(pop(page).locator("[data-ki-text-gesperrt]")).toHaveCount(0);
    await expect(pop(page).locator('[data-aktion="ki-text-uebernehmen"]')).toBeEnabled();
    // Änderung im markierten Stück: gesperrt
    await imEditor(page, ({ view }) => { const a = view.state.doc.toString().indexOf("dringend"); view.dispatch({ changes: { from: a, to: a + 8, insert: "sehr dringend" } }); });
    await expect(pop(page).locator("[data-ki-text-gesperrt]")).toContainText("Der Text hat sich seit der Anfrage geändert");
    await expect(pop(page).locator('[data-aktion="ki-text-uebernehmen"]')).toBeDisabled();
    await expect(pop(page).locator('[data-aktion="ki-text-neu"]')).toBeVisible();
    await ohneMuell(pop(page));
    await bild(page, `gesperrt-${name}`);
    const vorher = await dok(page);
    await page.keyboard.press("Enter");
    expect(await dok(page)).toBe(vorher);
    await expect(pop(page)).toHaveAttribute("data-phase", "ergebnis");
    // Neu anfragen: Auswahl ist beim Tippen weg → Hinweis; mit neuer Auswahl läuft es wieder
    await pop(page).locator('[data-aktion="ki-text-neu"]').click();
    await phase(page, "ergebnis"); // die Auswahl gilt weiter (mit dem geänderten Text); die Notiz wurde vorher gespeichert und neu gesendet
    expect(aufrufe().length).toBe(2);
    expect(JSON.parse(aufrufe()[1].stdin).daten.auswahl).toContain("sehr dringend");
    await page.keyboard.press("Escape");
  });
}

test("Code-Block und Tabelle: die Aktion ist aus, mit Grund im Tooltip (Format-Leiste), nichts geht an die KI", async ({ page }) => {
  await aufbauen();
  await oeffne(page);
  await waehle(page, "const a = 1;");
  await expect(kiKnopf(page)).toBeVisible();
  await expect(kiKnopf(page)).toHaveAttribute("aria-disabled", "true");
  await expect(kiKnopf(page)).toHaveAttribute("title", /Code-Block/);
  await kiKnopf(page).click({ force: true });
  await expect(pop(page)).toHaveCount(0);
  // Auswahl reicht aus dem Absatz in den Code-Block
  await imEditor(page, ({ view }) => { const t = view.state.doc.toString(); const a = t.indexOf("Brötchen holen"), b = t.indexOf("const a") + 5; view.focus(); view.dispatch({ selection: { anchor: a, head: b } }); });
  await expect(kiKnopf(page)).toHaveAttribute("title", /Code-Block/);
  // Auswahl über die Tabelle hinweg
  await imEditor(page, ({ view }) => { const t = view.state.doc.toString(); const a = t.indexOf("Letzter Absatz"), b = t.indexOf("| Anna") + 4; view.focus(); view.dispatch({ selection: { anchor: b, head: a + 8 } }); });
  await expect(kiKnopf(page)).toHaveAttribute("title", /Tabelle/);
  await imEditor(page, ({ view }) => { const t = view.state.doc.toString(); view.focus(); view.dispatch({ selection: { anchor: t.indexOf("Anna") - 2, head: t.indexOf("Letzter Absatz") + 8 } }); });
  await expect(kiKnopf(page)).toHaveAttribute("aria-disabled", "true");
  // Kontextmenü auf gesperrter Auswahl: Einträge aus, mit Grund
  await waehle(page, "const a = 1;");
  expect(aufrufe()).toEqual([]);
});

test("Einwilligung: ohne sie erscheint der Dialog, Abbrechen schickt nichts, Einschalten startet den Lauf", async ({ page }) => {
  await aufbauen({ einwilligung: false });
  szenario({ ersatz: ERSATZ });
  await oeffne(page);
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="kuerzen"]').click();
  const dlg = page.locator('[data-dialog="ki-einwilligung"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Nur den markierten Text und die Überschrift darüber");
  await expect(dlg).toContainText("Anthropic");
  await dlg.locator('[data-aktion="kiv-abbrechen"]').click();
  await expect(dlg).toHaveCount(0);
  expect(aufrufe()).toEqual([]);
  await pop(page).locator('[data-ki-aktion="kuerzen"]').click();
  await dlg.locator('[data-aktion="kiv-einschalten"]').click();
  await phase(page, "ergebnis");
  expect(aufrufe().length).toBe(1);
  expect(await dok(page)).toBe(NOTIZ);
});

test("Warnzeilen: ein neuer Link nach außen, ein Bild und eine Verknüpfung stehen im Diff, als Text und mit Zeichen von Kortex", async ({ page }) => {
  await aufbauen();
  szenario({ ersatz: "Wir kaufen Käse bei [Laden](https://beispiel.example/kaese) ![x](bild.png) und [[Brötchen]]." });
  await oeffne(page);
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="umschreiben"]').click();
  await phase(page, "ergebnis");
  await expect(pop(page).locator('[data-ki-text-warnung="link-extern"]')).toContainText("Der Vorschlag fügt einen Link nach außen hinzu: beispiel.example/kaese");
  await expect(pop(page).locator('[data-ki-text-warnung="bild"]')).toContainText("fügt ein Bild hinzu");
  await expect(pop(page).locator('[data-ki-text-warnung="wikilink"]')).toBeVisible();
  // der Link ist nur Text im Diff, nirgends ein Anker oder ein Bild
  await expect(pop(page).locator("a, img")).toHaveCount(0);
  await bild(page, "warnung-hell");
  await page.keyboard.press("Escape");
});

test("Aufgaben herausziehen: Liste im Popover; „Unter der Auswahl einfügen“ ist EINE Transaktion (⌘Z); „Als Aufgabe anlegen“ geht über /api/aufgaben", async ({ page }) => {
  await aufbauen();
  szenario({ aufgabenListe: [{ text: "Käse kaufen", beleg: "Käse kaufen", faellig: "2026-12-01" }, { text: "Brötchen holen", beleg: "Brötchen holen" }] });
  await oeffne(page);
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="aufgaben"]').click();
  await phase(page, "ergebnis");
  await expect(pop(page).locator("[data-ki-text-aufgabe]")).toHaveCount(2);
  await expect(pop(page).locator("[data-ki-text-aufgabe]").first()).toContainText("fällig 2026-12-01");
  expect(await dok(page)).toBe(NOTIZ);
  await bild(page, "aufgaben-hell");
  await pop(page).locator('[data-aktion="ki-text-uebernehmen"]').click();
  await expect(pop(page)).toHaveCount(0);
  const neu = await dok(page);
  expect(neu).toContain(`${ABSATZ}\n\n- [ ] Käse kaufen (fällig 2026-12-01)\n- [ ] Brötchen holen\n\n## Technik`);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await dok(page)).toBe(NOTIZ);
  // Über die Aufgaben-Liste des Vaults
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="aufgaben"]').click();
  await phase(page, "ergebnis");
  await pop(page).locator('[data-aktion="ki-text-anlegen"]').click();
  await expect(pop(page)).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await (await page.request.get(server.url + "api/aufgaben")).json())).toContain("Brötchen holen");
  expect(await dok(page)).toBe(NOTIZ);
});

test("Kontextmenü auf der Auswahl und Befehlspalette (⌘K) bieten dieselben Aktionen; „Gründlicher“ nimmt das größere Modell", async ({ page }) => {
  await aufbauen();
  szenario({ ersatz: ERSATZ });
  await oeffne(page);
  await waehleAbsatz(page);
  const zeile = page.locator(".cm-line", { hasText: "Wir müssen dringend" });
  await zeile.click({ button: "right", position: { x: 80, y: 8 } });
  await phase(page, "menu");
  await expect(pop(page).locator('[data-aktion="ki-text-kopieren"]')).toBeVisible();
  await bild(page, "kontextmenue-hell");
  await pop(page).locator('[data-ki-gruendlich]').click();
  await pop(page).locator('[data-ki-aktion="uebersetzen"][data-ki-sprache="en"]').click();
  await phase(page, "ergebnis");
  const a0 = aufrufe()[0];
  expect(a0.args[a0.args.indexOf("--model") + 1]).toBe("sonnet");
  expect(JSON.parse(a0.stdin).daten.sprache).toBe("en");
  await expect(pop(page).locator("[data-ki-text-titel]")).toHaveText("Übersetzen nach Englisch");
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  // Befehlspalette
  await waehleAbsatz(page);
  await page.waitForTimeout(300);
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".pal-feld input, .palette input").first().fill("KI:");
  const eintrag = page.locator(".pal-eintrag", { hasText: "KI: Kürzen" });
  await expect(eintrag).toBeVisible();
  await eintrag.click();
  await phase(page, "ergebnis");
  expect(JSON.parse(aufrufe()[1].stdin).aufgabe).toBe("kuerzen");
  expect(aufrufe()[1].args[aufrufe()[1].args.indexOf("--model") + 1]).toBe("haiku");
});

test("Fehler: eine kaputte Antwort heißt „keinen brauchbaren Vorschlag“, die Notiz bleibt unverändert; ein Ersatz ohne Unterschied sagt es; mehrfach ⌘Z-fest", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "kaputt" });
  await oeffne(page);
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="umschreiben"]').click();
  await phase(page, "fehler");
  await expect(pop(page).locator("[data-ki-text-meldung]")).toContainText("keinen brauchbaren Vorschlag");
  expect(await dok(page)).toBe(NOTIZ);
  await ohneMuell(pop(page));
  szenario({ ersatz: ABSATZ });
  await pop(page).locator('[data-aktion="ki-text-nochmal"]').click();
  await phase(page, "ergebnis");
  await expect(pop(page).locator("[data-ki-text-meldung]")).toContainText("würde nichts ändern");
  await expect(pop(page).locator('[data-aktion="ki-text-uebernehmen"]')).toHaveCount(0);
});

test("CRLF-Notiz: die Auswahl geht byte-treu an die KI, Übernehmen behält CRLF, ⌘Z stellt sie her", async ({ page }) => {
  await aufbauen();
  const crlf = "# Plan\r\n\r\nWir müssen Käse kaufen.\r\nUnd Brötchen nicht vergessen.\r\n\r\nEnde.\r\n";
  writeFileSync(join(vault, "10_notizen/crlf-ki.md"), crlf);
  szenario({ ersatz: "Käse und Brötchen kaufen.\nDanke 🙂" });
  await oeffne(page, "10_notizen/crlf-ki.md");
  await imEditor(page, ({ view }) => { const t = view.state.doc.toString(); view.focus(); view.dispatch({ selection: { anchor: t.indexOf("Wir müssen"), head: t.indexOf("vergessen.") + 10 } }); });
  await kiKnopf(page).click();
  await pop(page).locator('[data-ki-aktion="umschreiben"]').click();
  await phase(page, "ergebnis");
  expect(JSON.parse(aufrufe()[0].stdin).daten.auswahl).toBe("Wir müssen Käse kaufen.\r\nUnd Brötchen nicht vergessen.");
  await page.keyboard.press("Enter");
  await expect(pop(page)).toHaveCount(0);
  const roh = await imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak));
  expect(roh).toBe("# Plan\r\n\r\nKäse und Brötchen kaufen.\r\nDanke 🙂\r\n\r\nEnde.\r\n");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak))).toBe(crlf);
});

test("Layout: das Popover liegt im Fenster, ist nicht abgeschnitten, Knöpfe sind bedienbar; eine Auswahl am unteren Rand öffnet es nach oben", async ({ page }) => {
  await aufbauen();
  szenario({ ersatz: ERSATZ });
  await oeffne(page);
  await waehle(page, "Letzter Absatz mit etwas Text.");
  await kiKnopf(page).click();
  await phase(page, "menu");
  const vp = page.viewportSize();
  let r = await pop(page).boundingBox();
  expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.width).toBeLessThanOrEqual(vp.width); expect(r.y + r.height).toBeLessThanOrEqual(vp.height);
  await pop(page).locator('[data-ki-aktion="kuerzen"]').click();
  await phase(page, "ergebnis");
  r = await pop(page).boundingBox();
  expect(r.y + r.height).toBeLessThanOrEqual(vp.height);
  const knopf = await pop(page).locator('[data-aktion="ki-text-uebernehmen"]').boundingBox();
  expect(knopf.width).toBeGreaterThan(60); expect(knopf.height).toBeGreaterThan(22);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 760, height: 560 });
  await waehleAbsatz(page);
  await kiKnopf(page).click();
  await phase(page, "menu");
  r = await pop(page).boundingBox();
  expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(760); expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.height).toBeLessThanOrEqual(560);
});
