// „Frag deinen Vault“ in der Vorschau (scripts/vorschau.sh --mit-ki), gegen die echte Werkstatt und den echten claude-Platzhalter aus Sources/BrainCore/VorschauPlatzhalter.swift (zwischen den Marken):
// Die Frage endet nicht mehr mit „Vorschau-Schutz: KORTEX_VORSCHAU fehlt“, sondern zeigt eine gekennzeichnete Beispielantwort mit Quellen aus dem Vault; scheitert sie trotzdem, steht ein verständlicher Text da.
// Alles im Temp-Ordner (Vorschau-Ordner mit Marke, HOME darin), nie das echte claude oder HOME. Bilder: UI_VORSCHAU_BILDER=/Ordner npx playwright test vorschau-frage.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const BILDER = process.env.UI_VORSCHAU_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name) => { if (BILDER) { await page.waitForTimeout(400); await page.screenshot({ path: join(BILDER, `${name}.png`) }); } };

// Skript des claude-Platzhalters aus der Swift-Datei: Raw-String zwischen den Marken, `\#(schutz)` durch den Schutzblock ersetzt, Einrückung entfernt.
function platzhalterSkript() {
  const swift = readFileSync(join(WURZEL, "Sources/BrainCore/VorschauPlatzhalter.swift"), "utf8");
  const block = (anfang, ende) => {
    const i = swift.indexOf(anfang), j = swift.indexOf(ende, i + anfang.length);
    const zeilen = swift.slice(i + anfang.length, j).replace(/^\n/, "").split("\n");
    const einzug = Math.min(...zeilen.filter((z) => z.trim()).map((z) => z.match(/^ */)[0].length));
    return zeilen.map((z) => z.slice(einzug)).join("\n").replace(/\n+$/, "\n");
  };
  return block('static let claude = #"""', '"""#').replace("\\#(schutz)", block('static let schutz = """', '"""').replace(/\n$/, ""));
}

let server, vo;
async function aufbauen({ skript = platzhalterSkript() } = {}) {
  vo = realpathSync(mkdtempSync(join(tmpdir(), "kortex-vorschau-ui-")));
  writeFileSync(join(vo, ".kortex-vorschau"), "");
  for (const d of ["home", "support", "bin", "tmp"]) mkdirSync(join(vo, d));
  const home = join(vo, "home"), support = join(vo, "support"), bin = join(vo, "bin");
  // Vault wie der Assistent ihn anlegt: im Vorschau-Home, mit Seiten und Git
  const vault = join(home, "Kortex");
  const seiten = {
    "brain.config.json": "{}\n",
    "09_wiki/wissen/So funktioniert dein Vault.md": "---\ntitel: So funktioniert dein Vault\ntyp: thema\n---\n# So funktioniert dein Vault\n\nWie dein Vault aufgebaut ist: Inbox für Neues, Wiki für Belegtes, eine Regeldatei für jede KI.\n",
    "09_wiki/wissen/Wiki-Schema.md": "# Wiki-Schema\n\nDas Wiki sammelt belegtes Wissen.\n",
    "00_inbox/Willkommen.md": "# Willkommen\n\nDeine erste Notiz.\n",
  };
  mkdirSync(vault);
  git(vault, "init", "-q", "-b", "main");
  for (const [p, t] of Object.entries(seiten)) { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), t); }
  git(vault, "add", "--", ...Object.keys(seiten));
  git(vault, "commit", "-q", "-m", "Brain angelegt");
  const profil = join(home, ".claude"); mkdirSync(profil); writeFileSync(join(profil, "settings.json"), "{}");
  const ordner = realpathSync(profil), v = realpathSync(vault);
  K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner, standard: true, name: "Claude Code", ordnerKennung: K.kennungVon(ordner), abo: "max" } },
    vaults: { [v]: { ordnerKennung: K.kennungVon(v), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen" } } } }));
  writeFileSync(join(bin, "claude"), skript);
  chmodSync(join(bin, "claude"), 0o755);
  server = await starteServer(v, { support, umgebung: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, KORTEX_VORSCHAU: vo, TMPDIR: join(vo, "tmp") + "/", LANG: "de_DE.UTF-8", BRAIN_CLAUDE_EXTRA: "" } });
}
test.afterEach(() => { server?.stopp(); server = null; });

async function frageStellen(page, text) {
  await page.goto(server.url);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
  await page.click("#knopf-frage");
  await expect(page.locator('[data-frage="panel"]')).toBeVisible();
  await page.fill('[data-frage="eingabe"]', text);
  await page.click('[data-aktion="frage-senden"]');
}

test("Vorschau: Frag deinen Vault zeigt eine gekennzeichnete Beispielantwort mit Quellen aus dem Vault statt „KORTEX_VORSCHAU fehlt“", async ({ page }) => {
  await aufbauen();
  await page.setViewportSize({ width: 1440, height: 900 });
  await frageStellen(page, "Wie funktioniert dein Vault?");
  const antwort = page.locator('[data-frage="antwort"]');
  await expect(antwort).toContainText("Vorschau: So würde eine Antwort aussehen", { timeout: 15000 });
  await expect(page.locator('[data-frage="fehler"]')).toHaveCount(0);
  await expect(antwort).not.toContainText("KORTEX_VORSCHAU");
  await expect(antwort).toContainText("Platzhalter statt Claude Code");
  // zwei echte Seiten des Vorschau-Vaults als Quellen (klickbar), die passende zuerst
  const quellen = page.locator(".frage-quelle");
  await expect(quellen).toHaveCount(2);
  await expect(quellen.first()).toHaveAttribute("data-pfad", "09_wiki/wissen/So funktioniert dein Vault.md");
  await expect(page.locator('[data-frage="panel"]')).not.toContainText("Das hat nicht geklappt");
  await bild(page, "frage-beispielantwort-1440");
});

test("Vorschau: scheitert der Platzhalter doch, steht „In der Vorschau antwortet ein Platzhalter statt Claude“ da — kein interner Fehler", async ({ page }) => {
  await aufbauen({ skript: "#!/bin/sh\necho 'Vorschau-Schutz: etwas Internes' >&2\nexit 97\n" });
  await frageStellen(page, "Was steht im Vault?");
  const f = page.locator('[data-frage="fehler"]');
  await expect(f).toContainText("Das hat nicht geklappt", { timeout: 15000 });
  await expect(f).toContainText("In der Vorschau antwortet ein Platzhalter statt Claude Code");
  await expect(f).not.toContainText("Vorschau-Schutz");
  await expect(f).not.toContainText("beendet");
  await bild(page, "frage-platzhalter-fehler-1440");
});
