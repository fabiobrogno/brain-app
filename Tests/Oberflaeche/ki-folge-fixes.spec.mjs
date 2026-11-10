// Folge-Fixes aus dem Review der KI-Runde (docs/plaene/ki-runde.md, Abschnitt 14), im echten Studio gegen die echte Werkstatt; einzige Attrappe ist `claude` (Tests/Kern/fake-claude-vorschlag.mjs).
// Geprüft: neue KI-Funktion → die alte Einwilligung gilt für sie nicht, der Dialog nennt sie · unsichtbare Zeichen im Paket sind in „Was wird gesendet?“ sichtbar ·
// „Als Aufgabe anlegen“ schreibt einen Protokolleintrag ohne Inhalt. Bilder: FOLGE_BILDER=/Ordner npx playwright test ki-folge-fixes.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { legeProgramm, pfadMit } from "../Node/attrappe.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const FAKE = join(WURZEL, "Tests/Kern/fake-claude-vorschlag.mjs");
const BILDER = process.env.FOLGE_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });

const TAG = String.fromCodePoint(0xe0041); // unsichtbares Unicode-Tag-Zeichen
const ABSATZ = `Wir müssen dringend Käse kaufen${TAG}, weil heute Gäste kommen, und außerdem noch Brötchen holen.`;
const NOTIZ = `# Planung\n\n${ABSATZ}\n\nLetzter Absatz.\n`;

let vault, server, bin, home, support, seitenfehler;
// funktionen: undefined = alte Einwilligung ohne Liste · Array = gespeicherte Liste
async function aufbauen({ funktionen } = {}) {
  ({ vault } = baueVault());
  vault = realpathSync.native(vault);
  writeFileSync(join(vault, "10_notizen/ki-text.md"), NOTIZ);
  const wurzel = realpathSync.native(mkdtempSync(join(tmpdir(), "brain-ui-kifolge-")));
  home = join(wurzel, "home"); bin = join(wurzel, "bin"); support = join(wurzel, "support");
  for (const d of [home, bin, support]) mkdirSync(d);
  const p = join(home, ".claude-arbeit"); mkdirSync(p); writeFileSync(join(p, "settings.json"), "{}");
  const ordner = realpathSync.native(p);
  K.aendere(support, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner, standard: false, name: "Arbeit", ordnerKennung: K.kennungVon(ordner), abo: "max" } },
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen" },
      vorschlaege: { an: true, seit: "2026-11-09T10:00:00.000Z", konto: "k_aaaaaaaa", ...(funktionen ? { funktionen } : {}) } } } }));
  legeProgramm(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
  server = await starteServer(vault, { vertraut: true, support, umgebung: { PATH: pfadMit(bin), HOME: home, LANG: "de_DE.UTF-8", BRAIN_CLAUDE_EXTRA: "" } });
}
const szenario = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
test.beforeEach(() => { seitenfehler = []; });
test.afterEach(() => { server?.stopp(); server = null; expect(seitenfehler, "Fehler in der Seite").toEqual([]); });

async function oeffne(page) {
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/ki-text.md"));
  await page.waitForSelector(".cm-content .cm-line");
}
const waehleAbsatz = (page) => page.evaluateHandle(async (t) => {
  const CM = await import("/vendor/codemirror.bundle.js");
  const view = CM.EditorView.findFromDOM(document.querySelector(".cm-editor"));
  const a = view.state.doc.toString().indexOf(t); if (a < 0) throw new Error("Text nicht gefunden");
  view.focus(); view.dispatch({ selection: { anchor: a, head: a + t.length } });
}, ABSATZ);
const pop = (page) => page.locator("[data-ki-text]");
const phase = (page, p) => expect(pop(page)).toHaveAttribute("data-phase", p, { timeout: 15000 });
const starteAktion = async (page, aktion) => { await waehleAbsatz(page); await page.locator('.format-leiste [data-befehl="ki"]').click(); await pop(page).locator(`[data-ki-aktion="${aktion}"]`).click(); };
const foto = async (page, locator, name) => { if (!BILDER) return; await page.waitForTimeout(500); await locator.screenshot({ path: join(BILDER, `${name}.png`) }); };
const schemata = [["hell", "light"], ["dunkel", "dark"]];

for (const [schema, farbe] of schemata) {
  test(`Neue KI-Funktion: die alte Einwilligung gilt nicht, der Dialog nennt die neue Funktion, nichts geht ohne Ja an eine KI (${schema})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: farbe, reducedMotion: "reduce" });
    await aufbauen({ funktionen: ["posteingang", "zusammenfassung", "erwaehnungen"] }); // „text“ kam später dazu
    szenario({ ersatz: "Wir müssen Käse und Brötchen kaufen." });
    await oeffne(page);
    await starteAktion(page, "kuerzen");
    const dlg = page.locator('[data-dialog="ki-einwilligung"]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-kiv="neu"]')).toContainText("Neu seit deiner letzten Zustimmung: Aktionen im Editor");
    await expect(dlg).toContainText("Neue KI-Funktion");
    expect(aufrufe()).toEqual([]);
    await foto(page, dlg, `folge-neue-funktion-${schema}`);
    await dlg.locator('[data-aktion="kiv-abbrechen"]').click();
    await expect(dlg).toHaveCount(0);
    expect(aufrufe(), "nach Abbrechen nichts gesendet").toEqual([]);
    await pop(page).locator('[data-ki-aktion="kuerzen"]').click();
    await dlg.locator('[data-aktion="kiv-einschalten"]').click();
    await phase(page, "ergebnis");
    expect(aufrufe().length).toBe(1);
    expect([...K.vorschlaegeFuer(K.liesKonten(support).daten, vault).funktionen].sort()).toEqual([...K.KI_FUNKTIONEN].sort());
    await page.keyboard.press("Escape");
  });
}

test("Eine alte Einwilligung ohne Liste deckt die vier heutigen Funktionen: kein Dialog, der Lauf startet", async ({ page }) => {
  await aufbauen();
  szenario({ ersatz: "Wir müssen Käse und Brötchen kaufen." });
  await oeffne(page);
  await starteAktion(page, "kuerzen");
  await phase(page, "ergebnis");
  await expect(page.locator('[data-dialog="ki-einwilligung"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
});

for (const [schema, farbe] of schemata) {
  test(`Unsichtbare Zeichen im Paket sind in „Was wird gesendet?“ als ⟦U+…⟧ sichtbar, mit Hinweiszeile (${schema})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: farbe, reducedMotion: "reduce" });
    await aufbauen();
    szenario({ ersatz: "Wir müssen Käse und Brötchen kaufen." });
    await oeffne(page);
    await starteAktion(page, "kuerzen");
    await phase(page, "ergebnis");
    await pop(page).locator('[data-aktion="kiv-gesendet"]').click();
    const paket = pop(page).locator('[data-kiv="paket"]');
    await expect(paket).toBeVisible();
    await expect(paket).toContainText("Käse kaufen⟦U+E0041⟧,");
    expect(await paket.innerText()).not.toContain(TAG);
    await expect(pop(page).locator('[data-kiv="unsichtbar"]')).toContainText("1 unsichtbares Zeichen");
    await foto(page, pop(page), `folge-unsichtbar-${schema}`);
    await page.keyboard.press("Escape");
  });
}

test("„Als Aufgabe anlegen“ schreibt einen Protokolleintrag „KI-Vorschlag übernommen“ ohne Inhalt", async ({ page }) => {
  await aufbauen();
  szenario({ aufgabenListe: [{ text: "Käse kaufen", beleg: "Käse kaufen" }, { text: "Brötchen holen", beleg: "Brötchen holen" }] });
  await oeffne(page);
  await starteAktion(page, "aufgaben");
  await phase(page, "ergebnis");
  await pop(page).locator('[data-aktion="ki-text-anlegen"]').click();
  await expect(pop(page)).toHaveCount(0);
  await expect.poll(async () => {
    const j = await (await page.request.get(server.url + "api/aktivitaet?art=datei-aktion")).json();
    return (j.ereignisse || []).filter((e) => e.wer === "KI-Vorschlag").map((e) => e.text);
  }, { timeout: 10000 }).toEqual(["KI-Vorschlag übernommen: 2 Aufgaben angelegt"]);
});
