// Aufgaben-Board: Seitenleiste, Spalten, Karten, Schnell erfassen, Ziehen, Tastatur, Filter, Vertrauen — gegen das echte Backend mit Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const jetzt = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const ALT = "2020-01-01T00:00:00Z";

// schreibt eine Aufgaben-Datei im Format aus docs/plaene/aufgaben.md
function aufgabe(vault, name, f, text = "") {
  const d = { status: "offen", prioritaet: "normal", rang: 1000, quelle: "mensch", erstellt: "2026-10-20T08:00:00Z", geaendert: jetzt(), ...f };
  const z = ["---", "typ: aufgabe", `titel: ${JSON.stringify(d.titel)}`, `status: ${d.status}`, `prioritaet: ${d.prioritaet}`];
  if (d.faellig) z.push(`faellig: ${d.faellig}`);
  z.push(`rang: ${d.rang}`, `erstellt: ${d.erstellt}`, `geaendert: ${d.geaendert}`, `quelle: ${d.quelle}`, "---");
  mkdirSync(join(vault, "05_aufgaben"), { recursive: true });
  writeFileSync(join(vault, "05_aufgaben", `${name}.md`), z.join("\n") + "\n" + (text ? `\n${text}\n` : ""));
  return `05_aufgaben/${name}.md`;
}
const lese = (vault, p) => readFileSync(join(vault, p), "utf8");
const feld = (vault, p, k) => new RegExp(`^${k}: (.*)$`, "m").exec(lese(vault, p))?.[1];

let vault, server, p;
// Grundausstattung: 6 Aufgaben in allen Spalten, eine überfällig, eine von Claude, eine alt erledigt
function saeen(v) {
  p = {
    a: aufgabe(v, "2026-10-20-lieferanten-anrufen", { titel: "Lieferanten anrufen", rang: 1000, prioritaet: "hoch", faellig: "2026-10-01" }, "Wegen der neuen Kaffeemühle."),
    b: aufgabe(v, "2026-10-21-steuer-vorbereiten", { titel: "Steuer vorbereiten", rang: 2000, faellig: "2099-01-01" }),
    c: aufgabe(v, "2026-10-22-angebot-pruefen", { titel: "Angebot prüfen", rang: 3000, quelle: "ki:claude-code", prioritaet: "niedrig" }),
    d: aufgabe(v, "2026-10-23-website-text", { titel: "Website-Text schreiben", status: "in-arbeit", rang: 1000 }),
    e: aufgabe(v, "2026-10-24-antwort-abwarten", { titel: "Auf Antwort warten", status: "warten", rang: 1000 }),
    f: aufgabe(v, "2026-10-25-fertig-neu", { titel: "Frisch erledigt", status: "erledigt", rang: 1000 }),
    g: aufgabe(v, "2026-09-01-fertig-alt", { titel: "Längst erledigt", status: "erledigt", rang: 2000, geaendert: ALT }),
  };
  git(v, "add", "--", "05_aufgaben");
  git(v, "commit", "-q", "-m", "Aufgaben");
}
test.beforeEach(async () => { ({ vault } = baueVault()); saeen(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const karte = (page, pfad) => page.locator(`[data-karte-aufgabe][data-pfad="${pfad}"]`);
const spalte = (page, s) => page.locator(`[data-spalte="${s}"]`);
const titelIn = (page, s) => spalte(page, s).locator(".au-karte .au-titel").allTextContents();
async function oeffneBoard(page) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
  await expect(karte(page, p.a)).toBeVisible();
}
// Filter-Chip öffnen und den Eintrag per Rolle wählen (Combobox → Option)
async function waehleFilter(page, name, wert) {
  await page.locator(`[data-filter="${name}"]`).click();
  await page.locator(`[role="listbox"] [role="option"][data-wert="${wert}"]`).click();
}
const geaendertSeit = () => git(vault, "status", "--porcelain").toString().split("\n").filter(Boolean).map((z) => z.slice(3));

test("Seitenleiste: „Aufgaben“ steht direkt unter Posteingang und zählt die offenen (nicht die erledigten)", async ({ page }) => {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]");
  const ids = await page.locator("#bereiche [data-bereich]").evaluateAll((l) => l.map((e) => e.dataset.bereich));
  expect(ids.slice(0, 2)).toEqual(["inbox", "aufgaben"]);
  await expect(page.locator('[data-bereich="aufgaben"] .name')).toHaveText("Aufgaben");
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("5"); // a b c d e — zwei erledigte zählen nicht
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveClass(/warn/); // eine ist überfällig
  // Aufgaben-Dateien erscheinen nicht unter „Alle Notizen“
  await page.click('[data-bereich="alle"]');
  await expect(page.locator(`#liste-koerper [data-pfad="${p.a}"]`)).toHaveCount(0);
});

test("Board: vier Spalten, Karten in der richtigen Spalte und Reihenfolge; Priorität, Fälligkeit, Quelle", async ({ page }) => {
  await oeffneBoard(page);
  const namen = await page.locator(".au-spalte-kopf h3").allTextContents();
  expect(namen).toEqual(["Offen", "In Arbeit", "Warten", "Erledigt"]);
  expect(await titelIn(page, "offen")).toEqual(["Lieferanten anrufen", "Steuer vorbereiten", "Angebot prüfen"]);
  expect(await titelIn(page, "in-arbeit")).toEqual(["Website-Text schreiben"]);
  expect(await titelIn(page, "warten")).toEqual(["Auf Antwort warten"]);
  expect(await titelIn(page, "erledigt")).toEqual(["Frisch erledigt"]); // die alte ist eingeklappt
  await expect(page.locator("[data-aufgaben-zahl]")).toHaveText("5 offen · 1 überfällig");
  // Priorität (Text, nie nur Farbe), Fälligkeit überfällig hervorgehoben, Quelle
  await expect(karte(page, p.a).locator(".au-chip.prio.hoch")).toHaveText("Hoch");
  await expect(karte(page, p.a)).toHaveClass(/ueberfaellig/);
  await expect(karte(page, p.a).locator(".au-chip.faellig.ueber")).toContainText("Überfällig");
  await expect(karte(page, p.b).locator(".au-chip.faellig")).not.toHaveClass(/ueber/);
  await expect(karte(page, p.c).locator(".au-chip.prio.niedrig")).toHaveText("Niedrig");
  await expect(karte(page, p.a).locator('.au-quelle[data-quelle="mensch"]')).toBeVisible();
  await expect(karte(page, p.c).locator('.au-quelle[data-quelle="ki:claude-code"] [data-ki-logo="claude"]')).toBeVisible();
  await expect(karte(page, p.a).locator(".au-vorschau")).toContainText("Kaffeemühle");
});

test("Erledigte Aufgaben nach 7 Tagen eingeklappt; ein Knopf zeigt sie", async ({ page }) => {
  await oeffneBoard(page);
  await expect(karte(page, p.g)).toHaveCount(0);
  await page.click("[data-alte-umschalten]");
  await expect(karte(page, p.g)).toBeVisible();
  expect(await titelIn(page, "erledigt")).toEqual(["Frisch erledigt", "Längst erledigt"]);
  await page.click("[data-alte-umschalten]");
  await expect(karte(page, p.g)).toHaveCount(0);
});

test("Schnell erfassen: Enter legt eine Datei an, Karte erscheint in „Offen“, Zähler steigt, Eingabe bleibt im Fokus", async ({ page }) => {
  await oeffneBoard(page);
  const vorher = readdirSync(join(vault, "05_aufgaben")).length;
  await page.locator("[data-aufgabe-eingabe]").fill("Zahnarzt anrufen: Termin verschieben");
  await page.keyboard.press("Enter");
  await expect(spalte(page, "offen").locator(".au-karte .au-titel").last()).toHaveText("Zahnarzt anrufen: Termin verschieben");
  await expect(page.locator("[data-aufgabe-eingabe]")).toHaveValue("");
  await expect(page.locator("[data-aufgabe-eingabe]")).toBeFocused();
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("6");
  const dateien = readdirSync(join(vault, "05_aufgaben"));
  expect(dateien.length).toBe(vorher + 1);
  const neu = dateien.find((n) => n.endsWith("zahnarzt-anrufen-termin-verschieben.md"));
  expect(neu).toMatch(/^\d{4}-\d{2}-\d{2}-zahnarzt-anrufen-termin-verschieben\.md$/);
  const text = lese(vault, `05_aufgaben/${neu}`);
  expect(text).toMatch(/^---\ntyp: aufgabe\ntitel: "Zahnarzt anrufen: Termin verschieben"\nstatus: offen\nprioritaet: normal\nrang: 4000\n/);
  expect(text).toContain("\nquelle: mensch\n");
  // leere Eingabe legt nichts an
  await page.keyboard.press("Enter");
  expect(readdirSync(join(vault, "05_aufgaben")).length).toBe(vorher + 1);
});

test("Ziehen in eine andere Spalte ändert nur diese Datei (Status und Rang)", async ({ page }) => {
  await oeffneBoard(page);
  await karte(page, p.b).dragTo(spalte(page, "in-arbeit").locator(".au-karten"));
  await expect(spalte(page, "in-arbeit").locator(`[data-pfad="${p.b}"]`)).toBeVisible();
  await expect.poll(() => feld(vault, p.b, "status")).toBe("in-arbeit");
  expect(await titelIn(page, "in-arbeit")).toEqual(["Website-Text schreiben", "Steuer vorbereiten"]); // ans Ende gezogen
  expect(Number(feld(vault, p.b, "rang"))).toBeGreaterThan(1000);
  expect(geaendertSeit()).toEqual([p.b]);
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("5");
});

test("Ziehen innerhalb der Spalte: neue Stelle zwischen den Nachbarn, nur die gezogene Datei ändert sich", async ({ page }) => {
  await oeffneBoard(page);
  // „Angebot prüfen“ (3. Karte) über „Steuer vorbereiten“ (2. Karte) ziehen
  const ziel = karte(page, p.b);
  const box = await ziel.boundingBox();
  await karte(page, p.c).dragTo(ziel, { targetPosition: { x: box.width / 2, y: 4 } });
  await expect.poll(async () => (await titelIn(page, "offen")).join("|")).toBe("Lieferanten anrufen|Angebot prüfen|Steuer vorbereiten");
  await expect.poll(() => feld(vault, p.c, "rang")).toBe("1500");
  expect(geaendertSeit()).toEqual([p.c]);
  // nach dem Neuladen bleibt die Reihenfolge
  await page.reload();
  await page.click('[data-bereich="aufgaben"]');
  await expect(karte(page, p.c)).toBeVisible();
  expect(await titelIn(page, "offen")).toEqual(["Lieferanten anrufen", "Angebot prüfen", "Steuer vorbereiten"]);
});

test("Tastatur: Alt+Pfeile verschieben, Pfeile wechseln die Karte, Enter öffnet die Datei, „Zurück“ führt zum Board", async ({ page }) => {
  await oeffneBoard(page);
  await karte(page, p.a).focus();
  await page.keyboard.press("ArrowDown");
  await expect(karte(page, p.b)).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(spalte(page, "in-arbeit").locator(`[data-pfad="${p.b}"]`)).toBeVisible();
  await expect(karte(page, p.b)).toBeFocused();
  await expect.poll(() => feld(vault, p.b, "status")).toBe("in-arbeit");
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(async () => (await titelIn(page, "in-arbeit")).join("|")).toBe("Steuer vorbereiten|Website-Text schreiben");
  // Jeder Schritt wartet, bis Datei UND Anzeige den neuen Stand haben und die Karte wieder den Fokus hat: die Antwort der Werkstatt zeichnet das Board neu und überholt sonst
  // eine zweite Taste, die schon gedrückt wurde (auf dem langsamen Runner ging „Links“ dann von der falschen Spalte aus).
  const schiebe = async (taste, soll) => {
    await page.keyboard.press(taste);
    await expect.poll(() => feld(vault, p.b, "status")).toBe(soll);
    await expect(spalte(page, soll).locator(`[data-pfad="${p.b}"]`)).toBeVisible();
    await expect(karte(page, p.b)).toBeFocused();
    await page.waitForTimeout(400);
  };
  await schiebe("Alt+ArrowRight", "warten");
  await schiebe("Alt+ArrowRight", "erledigt");
  await schiebe("Alt+ArrowLeft", "warten");
  // Enter öffnet die Datei im Editor
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("Datei-Kopf"); // der Kopf der Aufgabe, im Editor eingeklappt
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeHidden();
  await page.click("#au-zurueck");
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
});

test("Karte anklicken öffnet die Datei im Editor; Änderungen dort erscheinen im Board", async ({ page }) => {
  await oeffneBoard(page);
  await karte(page, p.a).click();
  await expect(page.locator(".cm-content")).toContainText("Kaffeemühle");
  await expect(page.locator("#pfad")).toContainText("Aufgaben");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\nNotiz vom Editor");
  await page.keyboard.press("Meta+s");
  await page.click("#au-zurueck");
  await expect(karte(page, p.a).locator(".au-vorschau")).toContainText("Notiz vom Editor");
});

test("Menü an der Karte: Spalte, Priorität und Fälligkeit ändern (jeweils eine Datei)", async ({ page }) => {
  await oeffneBoard(page);
  await karte(page, p.b).hover();
  await karte(page, p.b).locator("[data-aufgabe-menue]").click();
  await page.locator('[data-menue="prio-hoch"]').click();
  await expect.poll(() => feld(vault, p.b, "prioritaet")).toBe("hoch");
  await expect(karte(page, p.b).locator(".au-chip.prio.hoch")).toBeVisible();
  await karte(page, p.b).click({ button: "right" });
  await page.locator('[data-menue="faellig-heute"]').click();
  await expect.poll(() => feld(vault, p.b, "faellig")).toBe(new Date().toLocaleDateString("sv-SE"));
  await expect(karte(page, p.b).locator(".au-chip.faellig.heute")).toContainText("Heute");
  await karte(page, p.b).click({ button: "right" });
  await page.locator('[data-menue="spalte-warten"]').click();
  await expect.poll(() => feld(vault, p.b, "status")).toBe("warten");
  expect(geaendertSeit()).toEqual([p.b]);
});

test("Filter: Priorität, Quelle, Fälligkeit; zurücksetzen; Auswahl bleibt nach dem Neuladen", async ({ page }) => {
  await oeffneBoard(page);
  await waehleFilter(page, "prio", "hoch");
  expect(await titelIn(page, "offen")).toEqual(["Lieferanten anrufen"]);
  expect(await titelIn(page, "in-arbeit")).toEqual([]);
  await page.click("[data-filter-reset]");
  expect(await titelIn(page, "offen")).toHaveLength(3);
  await waehleFilter(page, "quelle", "ki");
  expect(await titelIn(page, "offen")).toEqual(["Angebot prüfen"]);
  await waehleFilter(page, "quelle", "mensch");
  expect(await titelIn(page, "offen")).toEqual(["Lieferanten anrufen", "Steuer vorbereiten"]);
  await waehleFilter(page, "faellig", "ueberfaellig");
  expect(await titelIn(page, "offen")).toEqual(["Lieferanten anrufen"]);
  await page.reload();
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator('[data-filter="faellig"]')).toHaveAttribute("data-wert", "ueberfaellig");
  await expect(page.locator('[data-filter="quelle"]')).toHaveAttribute("data-wert", "mensch");
  await page.click("[data-filter-reset]");
  await waehleFilter(page, "faellig", "ohne");
  expect(await titelIn(page, "offen")).toEqual(["Angebot prüfen"]);
  await waehleFilter(page, "faellig", "heute");
  await expect(page.locator("[data-aufgaben-gefiltert]")).toBeVisible();
});

test("Änderungen von außen (Datei im Vault) erscheinen nach dem Zurückkehren ins Fenster", async ({ page }) => {
  await oeffneBoard(page);
  const neu = aufgabe(vault, "2026-10-29-von-claude", { titel: "Von Claude angelegt", quelle: "ki:claude-code", rang: 9000 });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(karte(page, neu)).toBeVisible();
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("6");
});

test("Leerer Vault: freundlicher Hinweis; nach der ersten Aufgabe erscheint das Board", async ({ page }) => {
  server.stopp();
  const leer = baueVault().vault;
  server = await starteServer(leer);
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]");
  await page.click('[data-bereich="aufgaben"]');
  await expect(page.locator("[data-aufgaben-leer]")).toContainText("Noch keine Aufgaben");
  await page.locator("[data-aufgabe-eingabe]").fill("Erste Aufgabe");
  await page.keyboard.press("Enter");
  await expect(spalte(page, "offen").locator(".au-karte")).toHaveCount(1);
  expect(existsSync(join(leer, "05_aufgaben"))).toBe(true);
});

test("Vault noch nicht bestätigt: lesen ja, anlegen und ziehen nein; Hinweis mit „Bestätigen“", async ({ page }) => {
  server.stopp();
  server = await starteServer(vault, { vertraut: false });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]");
  await page.keyboard.press("Escape");
  await page.click('[data-bereich="aufgaben"]');
  await expect(karte(page, p.a)).toBeVisible();
  await expect(page.locator("[data-aufgaben-hinweis]")).toBeVisible();
  await expect(page.locator("[data-aufgabe-eingabe]")).toBeDisabled();
  await expect(karte(page, p.a)).toHaveAttribute("data-ziehbar", "false");
  // auch die Werkstatt verweigert das Schreiben
  const r = await page.evaluate(async (pfad) => {
    const a = await fetch("/api/aufgaben", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titel: "Böse" }) });
    const b = await fetch("/api/aufgaben/" + pfad, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "erledigt" }) });
    return [a.status, (await a.json()).art, b.status];
  }, p.a);
  expect(r).toEqual([409, "nicht-vertraut", 409]);
  expect(feld(vault, p.a, "status")).toBe("offen");
});

test("Menü „Aufgabe erfassen“ (Befehl der App) öffnet das Board mit dem Eingabefeld im Fokus", async ({ page }) => {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]");
  await page.evaluate(() => window.studio.befehl("aufgabe-erfassen"));
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
  await expect(page.locator("[data-aufgabe-eingabe]")).toBeFocused();
  await page.evaluate(() => window.studio.befehl("posteingang"));
  await expect(page.locator('[data-ansicht="aufgaben"]')).toBeHidden();
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator("[data-aufgabe-eingabe]")).toBeFocused();
});

test("Eigener Ordnername (ordner.aufgaben): Seitenleiste, Board, Brotkrumen und „Alle Notizen“ folgen der Konfiguration", async ({ page }) => {
  server.stopp();
  const { vault: v } = baueVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { aufgaben: "todo" } }));
  mkdirSync(join(v, "todo"), { recursive: true });
  const datei = (n, t, status) => { writeFileSync(join(v, "todo", n), `---\ntyp: aufgabe\ntitel: ${t}\nstatus: ${status}\nprioritaet: normal\nrang: 1000\nerstellt: 2026-10-20T08:00:00Z\ngeaendert: ${jetzt()}\nquelle: mensch\n---\n`); return `todo/${n}`; };
  const a = datei("2026-10-20-eins.md", "Eins", "offen");
  datei("2026-10-20-zwei.md", "Zwei", "erledigt");
  git(v, "add", "--", "todo", "brain.config.json"); git(v, "commit", "-q", "-m", "todo");
  server = await starteServer(v);
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]");
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("1");
  await page.click('[data-bereich="alle"]');
  await expect(page.locator(`#liste-koerper [data-pfad="${a}"]`)).toHaveCount(0);
  await page.click('[data-bereich="aufgaben"]');
  await expect(karte(page, a)).toBeVisible();
  await karte(page, a).click();
  await expect(page.locator("#pfad")).toContainText("Aufgaben");
});

for (const schema of ["light", "dark"]) {
  test(`Bilder (${schema}): Board für die Sichtprüfung`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema });
    await oeffneBoard(page);
    await page.addStyleTag({ content: "*{animation:none!important}" });
    await page.waitForTimeout(300);
    const ziel = process.env.BILDER_AUFGABEN;
    if (!ziel) return;
    mkdirSync(ziel, { recursive: true });
    await page.screenshot({ path: join(ziel, `board-${schema}.png`) });
    await karte(page, p.b).hover();
    await karte(page, p.b).locator("[data-aufgabe-menue]").click();
    await page.screenshot({ path: join(ziel, `menue-${schema}.png`) });
    await page.keyboard.press("Escape");
    await waehleFilter(page, "prio", "hoch");
    await page.screenshot({ path: join(ziel, `filter-${schema}.png`) });
  });
}
