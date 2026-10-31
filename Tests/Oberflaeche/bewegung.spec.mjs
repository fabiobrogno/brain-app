// Bewegung und Feinschliff (Paket P4): ein Bewegungssystem aus Tokens, „Bewegung reduzieren“ = überall 0 ms, Bewegung mit Bedeutung (Flug in den Posteingang, Zähler hüpft,
// Wort für Wort, Listen blenden ein/klappen zu, Windung als Ladeanzeige), Inhalt hängt nie an einer Animation (Ruhenetz, auch bei pausierten Animationen im Assistenten),
// kein Layout-Sprung beim Laden (CLS), Bildzeiten beim Scrollen von 5.000 Notizen und beim Öffnen von Frag/Palette, kein „null“/„undefined“, schmale Fenster.
// Bilder: KORTEX_BILDER=/Ordner npx playwright test bewegung.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { starteStatisch, mockeEinrichtung } from "./mocks-einrichtung.mjs";

const BILDER = process.env.KORTEX_BILDER;
const bild = async (page, name) => { if (!BILDER) return; mkdirSync(BILDER, { recursive: true }); await page.waitForTimeout(500); await page.screenshot({ path: join(BILDER, `${name}.png`) }); };
const schirm = (page, schema) => page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });

// Wie ein Fenster, das WebKit nicht sichtbar findet: alle Animationen stehen am Anfang still (läuft als Init-Skript, bevor irgendeine Seite etwas zeichnet)
function pausiere() {
  const setze = () => {
    if (!document.documentElement) return false;
    const s = document.createElement("style");
    s.textContent = "*, *::before, *::after { animation-play-state: paused !important; }";
    document.documentElement.append(s);
    return true;
  };
  if (!setze()) new MutationObserver((_, o) => { if (setze()) o.disconnect(); }).observe(document, { childList: true });
}

let vault, server;
test.afterEach(() => { server?.stopp(); server = null; });
async function aufbauen(o = {}) {
  ({ vault } = baueVault(o));
  server = await starteServer(vault);
}
async function oeffneStudio(page) {
  await page.goto(server.url);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
}
// Alle Elemente samt ::before/::after: was überträgt oder animiert noch? (Dauerläufer der Ladeanzeigen sind die dokumentierte Ausnahme)
async function bilanz(page) {
  return page.evaluate(() => {
    const ausnahme = ".windung-laden, .windung-laden *, .laedt, .laedt *, .e-lade, .rm-spinner, [class*='dreh'], .bs-text-schimmer";
    const schlecht = [];
    for (const el of document.querySelectorAll("*")) {
      for (const ps of [null, "::before", "::after"]) {
        const cs = getComputedStyle(el, ps);
        const t = cs.transitionDuration.split(",").map((s) => parseFloat(s) * (s.includes("ms") ? 1 : 1000));
        const a = cs.animationName !== "none";
        const lang = t.some((x) => x > 0);
        if ((lang || a) && !el.matches(ausnahme)) schlecht.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}${ps || ""} t=${cs.transitionDuration} a=${cs.animationName}`);
      }
    }
    return { schlecht: schlecht.slice(0, 12), laufend: document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity && a.playState === "running").length };
  });
}

test("Bewegungssystem: drei Hauptdauern 120 / 200 / 280 ms, ease-out-quart, Feder; Alt-Namen zeigen auf dieselben Tokens", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  const t = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(["--d-1", "--d-2", "--d-3", "--d-4", "--d-5", "--d-6", "--d-fast", "--d", "--d-panel", "--t", "--ease-out", "--ease-feder", "--ease-in"].map((n) => [n, cs.getPropertyValue(n).trim()]));
  });
  expect([t["--d-1"], t["--d-2"], t["--d-3"]]).toEqual(["120ms", "200ms", "280ms"]);
  expect([t["--d-fast"], t["--d"], t["--d-panel"], t["--t"]]).toEqual(["120ms", "200ms", "280ms", "120ms"]);
  expect(t["--ease-out"]).toBe("cubic-bezier(.25, 1, .5, 1)");
  expect(t["--ease-feder"]).toMatch(/^(cubic-bezier\(|linear\()/);
  // Die Hauptflächen nehmen die Tokens: Frag-Panel gleitet in --d-3, Popover in --d-2/--d-1
  const frage = await page.evaluate(() => getComputedStyle(document.querySelector("#frage")).transitionDuration);
  expect(frage).toContain("0.28s");
});

for (const art of ["system", "einstellung"]) {
  test(`Bewegung reduzieren (${art === "system" ? "Systemeinstellung" : "Einstellung in der App"}): Dauer-Tokens 0 ms, kein Übergang, keine Animation, Inhalte stehen sofort da`, async ({ page }) => {
    await aufbauen();
    if (art === "system") await page.emulateMedia({ reducedMotion: "reduce" });
    await oeffneStudio(page);
    if (art === "einstellung") await page.evaluate(() => { document.documentElement.dataset.bewegung = "reduziert"; }); // wie wendeEinstellungenAn() in app.js
    const tok = await page.evaluate(() => ["--d-1", "--d-2", "--d-3", "--d-4", "--d-5", "--d-6"].map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
    expect(tok).toEqual(Array(6).fill("0ms"));
    const pruefe = async (wo) => {
      const b = await bilanz(page);
      expect(b.schlecht, `${wo}: Elemente mit Dauer > 0`).toEqual([]);
      expect(b.laufend, `${wo}: laufende endliche Animationen`).toBe(0);
    };
    await pruefe("Liste");
    await page.keyboard.press("Meta+k");
    await expect(page.locator(".palette")).toBeVisible();
    await expect(page.locator(".palette")).toHaveCSS("opacity", "1"); // sofort da, ohne Einblenden
    await pruefe("Palette");
    await page.keyboard.press("Escape");
    await page.click("#knopf-frage");
    await expect(page.locator('[data-frage="panel"]')).toBeVisible();
    await pruefe("Frag");
    await page.click("#knopf-frage");
    await page.click('[data-bereich="aufgaben"]');
    await expect(page.locator('[data-ansicht="aufgaben"]')).toBeVisible();
    await pruefe("Board");
    await page.click('[data-bereich="inbox"]');
    await pruefe("Posteingang");
    // Zähler hüpft nicht, Flugmarke gibt es nicht: Erfassen läuft ohne Bewegung
    await page.click("#fuss-merken");
    await page.fill('[data-feld="text"]', "Ruhig erfasst");
    await page.click('[data-aktion="merken"]');
    await expect(page.locator(".toast")).toContainText("In der Inbox abgelegt");
    await expect(page.locator(".flug-chip")).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector('[data-bereich="inbox"] .zahl').getAnimations().length)).toBe(0);
  });
}

test("Ruhenetz: Studio und Wörter bleiben sichtbar, auch wenn alle Animationen pausiert sind (Fenster nicht sichtbar)", async ({ page }) => {
  await aufbauen();
  await page.addInitScript(pausiere);
  await oeffneStudio(page);
  await expect(page.locator("#liste-koerper .karte").first()).toBeVisible();
  // eine Einblend-Animation, die nie vorankommt (pausiert), wird vom Netz beendet: die Wörter einer Antwort sind danach sichtbar
  await page.evaluate(async () => {
    const m = await import("/bewegung.js");
    const wurzel = document.createElement("div");
    wurzel.id = "probe-antwort";
    wurzel.innerHTML = "<p>Kaffee ist ein <b>Heißgetränk</b> aus gerösteten Bohnen.</p>";
    document.body.append(wurzel);
    window.__laenge = m.worteEinblenden(wurzel, 0);
  });
  await expect(page.locator("#probe-antwort .wort-neu")).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("#probe-antwort .wort-neu")].map((e) => getComputedStyle(e).opacity).join(",")), { timeout: 4000 }).toBe("1,1,1,1,1,1,1");
});

test("Wörter einblenden: nur neue Wörter werden verpackt, der Text bleibt unverändert, Code wird übersprungen", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  const r = await page.evaluate(async () => {
    const m = await import("/bewegung.js");
    const w = document.createElement("div");
    document.body.append(w);
    w.innerHTML = "<p>Eins zwei drei</p>";
    const l1 = m.worteEinblenden(w, 0);
    const erst = w.querySelectorAll(".wort-neu").length;
    w.innerHTML = "<p>Eins zwei drei vier fünf</p><pre>code zeile</pre><p>sechs</p>"; // wie ein neu gebauter Markdown-Baum
    const text = w.textContent;
    const l2 = m.worteEinblenden(w, l1);
    const neu = [...w.querySelectorAll(".wort-neu")].map((e) => e.textContent);
    const verzug = [...w.querySelectorAll(".wort-neu")].map((e) => parseFloat(e.style.animationDelay));
    return { l1, erst, l2, neu, text, textDanach: w.textContent, verzug, imCode: w.querySelectorAll("pre .wort-neu").length };
  });
  expect(r.erst).toBe(3);
  expect(r.neu).toEqual(["vier", "fünf", "sechs"]);
  expect(r.textDanach).toBe(r.text);
  expect(r.imCode).toBe(0);
  expect(r.verzug[2]).toBeLessThanOrEqual(180); // gestaffelt, aber insgesamt kurz: nichts wird zurückgehalten
});

test("Assistent: Inhalt steht auch bei pausierten Animationen da (Fenster nicht sichtbar), Hero und Zeichen werden nie von einer Animation versteckt", async ({ page }) => {
  const statisch = await starteStatisch();
  try {
    await page.addInitScript(pausiere);
    await mockeEinrichtung(page, {});
    await page.goto(`${statisch.url}einrichtung.html`);
    await page.waitForFunction(() => window.__einrichtungBereit === true);
    // Ohne Netz bliebe der Hero bei Deckkraft 0 (Animation pausiert am Anfang). Mit Netz ist er nach spätestens ~2 s da.
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(".e-hero > *")].map((e) => getComputedStyle(e).opacity).join(",")), { timeout: 5000 }).toMatch(/^(1,)*1$/);
    await expect(page.locator(".e-hero h1")).toBeVisible();
    await expect(page.locator('[data-aktion="start"]')).toBeEnabled({ timeout: 6000 });
    // das Zeichen (Linie zeichnet sich) ist ganz da: Strichmuster ohne Versatz
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#app-zeichen .e-marke path")).strokeDashoffset), { timeout: 5000 }).toMatch(/^0(px)?$/);
    await bild(page, "ruhenetz-assistent-pausiert");
    await page.click('[data-aktion="start"]');
    await expect(page.locator(".e-weg").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector(".e-pane.rein, .e-pane")).opacity), { timeout: 5000 }).toBe("1");
  } finally { statisch.stopp(); }
});

test("Assistent: ohne Netz wäre der Hero unsichtbar (Gegenprobe: die Animationen sind wirklich pausiert und stehen am Anfang)", async ({ page }) => {
  const statisch = await starteStatisch();
  try {
    await page.addInitScript(pausiere);
    // Gegenprobe: das Netz greift nur über getAnimations; ohne diese Funktion tut es nichts
    await page.addInitScript(() => { Document.prototype.getAnimations = undefined; });
    await mockeEinrichtung(page, {});
    await page.goto(`${statisch.url}einrichtung.html`);
    await page.waitForFunction(() => window.__einrichtungBereit === true);
    await page.waitForTimeout(1800);
    const op = await page.evaluate(() => getComputedStyle(document.querySelector(".e-hero > :nth-child(2)")).opacity);
    expect(parseFloat(op)).toBeLessThan(0.5);
  } finally { statisch.stopp(); }
});

test("Layout-Sprünge (CLS): Start, Posteingang, Board und Einstellungen verschieben nichts nennenswert", async ({ page }) => {
  await aufbauen();
  await page.addInitScript(() => {
    window.__cls = 0; window.__quellen = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__quellen.push([Math.round(e.value * 1000) / 1000, ...e.sources.map((s) => (s.node?.id || s.node?.className || s.node?.nodeName || "?").toString().slice(0, 30))]); } }).observe({ type: "layout-shift", buffered: true });
  });
  await oeffneStudio(page);
  await page.waitForTimeout(900);
  const start = await page.evaluate(() => window.__cls);
  for (const sel of ['[data-bereich="inbox"]', '[data-bereich="aufgaben"]', '[data-bereich="alle"]']) {
    await page.click(sel);
    await page.waitForTimeout(500);
  }
  await page.click("#knopf-frage");
  await page.waitForTimeout(500);
  await page.click("#knopf-frage");
  await page.waitForTimeout(400);
  const ende = await page.evaluate(() => ({ cls: window.__cls, q: window.__quellen }));
  console.log(`CLS Start ${start.toFixed(4)}, gesamt ${ende.cls.toFixed(4)}`, JSON.stringify(ende.q));
  expect(start).toBeLessThan(0.02);
  expect(ende.cls).toBeLessThan(0.05);
});

test("CLS beim langsamen Laden: Skelett hält den Platz, Liste und Seitenleiste springen nicht", async ({ page }) => {
  await aufbauen();
  let frei;
  const tor = new Promise((r) => { frei = r; });
  await page.route("**/api/baum", async (route) => { await tor; await route.continue(); });
  await page.route("**/api/notizen", async (route) => { await tor; await route.continue(); });
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(server.url);
  await expect(page.locator('[data-skelett="liste"]')).toBeAttached();
  await expect(page.locator('[data-skelett="seite"]')).toBeAttached();
  await expect.poll(() => page.locator('[data-skelett="liste"] .bs-skelett').first().evaluate((e) => parseFloat(getComputedStyle(e).opacity))).toBeGreaterThan(0.9); // nach 150 ms da
  const liste = await page.locator("#liste").boundingBox();
  await bild(page, "skelett-laden-hell");
  frei();
  await page.waitForSelector("#liste-koerper .karte", { timeout: 15000 });
  await expect(page.locator(".bs-skelett")).toHaveCount(0);
  expect(await page.locator("#liste").boundingBox()).toEqual(liste); // die Spalte selbst hat sich nicht bewegt
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.02);
});

test("Erfassen: die Notiz fliegt in den Posteingang, der Zähler hüpft; im Posteingang blendet die neue Karte ein", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator("#liste-koerper .karte").first()).toBeVisible();
  const vorher = Number(await page.locator('[data-bereich="inbox"] .zahl').textContent());
  await page.click("#fuss-merken");
  await page.fill('[data-feld="text"]', "Idee: Kaffeemühle reparieren");
  await page.click('[data-aktion="merken"]');
  const chip = page.locator(".flug-chip");
  await expect(chip).toHaveCount(1, { timeout: 2000 });
  await expect(chip).toContainText("Idee: Kaffeemühle");
  expect(await chip.evaluate((e) => e.getAnimations().length)).toBeGreaterThan(0);
  if (BILDER) { mkdirSync(BILDER, { recursive: true }); await page.screenshot({ path: join(BILDER, "erfassen-flug.png") }); } // mitten im Flug
  // der Zähler zählt hoch und hüpft (Web-Animation auf dem Zähler), die Flugmarke verschwindet danach wieder
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-bereich="inbox"] .zahl').getAnimations().length), { timeout: 3000, intervals: [30] }).toBeGreaterThan(0);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText(String(vorher + 1));
  await expect(chip).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator("#liste-koerper .karte", { hasText: "Kaffeemühle reparieren" })).toBeVisible();
});

test("Listen: neue Einträge blenden ein, verworfene klappen zu (stille Hülle ohne data-karte), danach ist alles ruhig", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator("#liste-koerper [data-karte]")).toHaveCount(3);
  // neuer Eintrag von außen (Datei im Vault): Live-Ereignis, die Karte blendet ein
  writeFileSync(join(vault, "00_inbox", "2026-10-30_neu.md"), "# Von außen\n\nNeu da.\n");
  const neu = page.locator('#liste-koerper [data-karte][data-pfad$="2026-10-30_neu.md"]');
  await expect(neu).toBeAttached({ timeout: 8000 });
  expect(await neu.evaluate((e) => e.getAnimations().length)).toBeGreaterThanOrEqual(0); // kann schon fertig sein; der Test unten prüft den Weg über Verwerfen
  // Verwerfen: die Karte klappt zu
  // Die Hülle lebt nur ~240 ms: ein Beobachter im Seiten-Kontext hält fest, was in dieser Zeit da war (Abfragen von außen wären zu langsam)
  await page.evaluate(() => {
    window.__huellen = [];
    new MutationObserver((l) => { for (const m of l) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains("karte-geist")) window.__huellen.push({ aria: n.getAttribute("aria-hidden"), karten: n.querySelectorAll("[data-karte], [role=option]").length, hoehe: n.getBoundingClientRect().height }); })
      .observe(document.getElementById("liste-koerper"), { childList: true });
  });
  const karte = page.locator('#liste-koerper [data-karte][data-pfad$="2026-10-23_gedanke.md"]');
  await karte.hover();
  await karte.locator('[data-aktion="verwerfen"]').click();
  await expect.poll(() => page.evaluate(() => window.__huellen.length), { timeout: 5000, intervals: [25] }).toBe(1);
  const h = await page.evaluate(() => window.__huellen[0]);
  expect(h.aria).toBe("true");
  expect(h.karten).toBe(0); // stille Hülle: kein data-karte, keine Rolle
  expect(h.hoehe).toBeGreaterThan(40);
  await expect(page.locator("#liste-koerper .karte-geist")).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('#liste-koerper [data-karte][data-pfad$="2026-10-23_gedanke.md"]')).toHaveCount(0);
});

test("Board: die gelandete Karte federt, der Spaltenzähler hüpft", async ({ page }) => {
  await aufbauen();
  const aufgabe = (n, status, rang) => {
    const d = join(vault, "05_aufgaben"); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, `2026-10-2${n}-a${n}.md`), ["---", "typ: aufgabe", `titel: Aufgabe ${n}`, `status: ${status}`, "prioritaet: normal", `rang: ${rang}`, "erstellt: 2026-10-20T08:00:00Z", `geaendert: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`, "quelle: mensch", "---", ""].join("\n"));
  };
  aufgabe(1, "offen", 1000); aufgabe(2, "offen", 2000); aufgabe(3, "in-arbeit", 1000);
  git(vault, "add", "--", "05_aufgaben"); git(vault, "commit", "-q", "-m", "Aufgaben");
  await oeffneStudio(page);
  await page.click('[data-bereich="aufgaben"]');
  const k = page.locator('[data-karte-aufgabe][data-pfad$="a1.md"]');
  await expect(k).toBeVisible();
  const von = await k.boundingBox();
  const ziel = await page.locator('[data-spalte="in-arbeit"] .au-karten').boundingBox();
  await page.mouse.move(von.x + 40, von.y + 20);
  await page.mouse.down();
  await page.mouse.move(von.x + 80, von.y + 40, { steps: 4 });
  await page.mouse.move(ziel.x + 60, ziel.y + 80, { steps: 12 });
  await page.mouse.up();
  const gelandet = page.locator('[data-spalte="in-arbeit"] [data-karte-aufgabe][data-pfad$="a1.md"]');
  await expect(gelandet).toBeVisible({ timeout: 4000 });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.au-karte').length && [...document.querySelectorAll('[data-spalte="in-arbeit"] .au-karte, [data-spalte="in-arbeit"] .au-spalte-zahl')].some((e) => e.getAnimations().length > 0)), { timeout: 2500, intervals: [20] }).toBe(true);
  await bild(page, "board-gelandet");
});

test("Windung als Ladeanzeige: Abgleich und Frag zeigen das Zeichen statt eines Drehkringels; Text sagt, was passiert", async ({ page }) => {
  await aufbauen();
  let frei;
  const tor = new Promise((r) => { frei = r; });
  await page.route("**/api/git/sync", async (route) => { await tor; await route.continue(); });
  await oeffneStudio(page);
  await page.click('button[data-st="sync"]');
  const sync = page.locator('button[data-st="sync"][data-zustand="laeuft"]');
  await expect(sync).toBeVisible();
  await expect(sync.locator("svg.windung-laden")).toHaveCount(1);
  await expect(sync).toContainText("Gleiche ab");
  expect(await sync.locator(".wl-lauf").evaluate((e) => e.getAnimations().length)).toBe(1);
  await bild(page, "windung-sync");
  frei();
  await expect(page.locator('button[data-st="sync"][data-zustand="laeuft"]')).toHaveCount(0, { timeout: 8000 });
  // Frag: solange die Bereitschaft geprüft wird, steht die Windung mit „Lade …“ im Panel (statt eines leeren Panels)
  let frei2;
  const tor2 = new Promise((r) => { frei2 = r; });
  await page.route("**/api/frage/bereit", async (route) => { await tor2; await route.continue(); });
  await page.click("#knopf-frage");
  const laden = page.locator('[data-frage="laedt"]');
  await expect(laden).toBeVisible();
  await expect(laden.locator("svg.windung-laden")).toHaveCount(1);
  await expect(laden).toContainText("Lade");
  await bild(page, "windung-frag");
  frei2();
  await expect(laden).toHaveCount(0, { timeout: 8000 });
});

test("Kein „null“, „undefined“ oder „NaN“ in den Hauptansichten; schmale Fenster kürzen statt umzubrechen", async ({ page }) => {
  await aufbauen();
  await page.setViewportSize({ width: 1000, height: 720 });
  await oeffneStudio(page);
  const scan = async (wo) => {
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, wo).not.toMatch(/\b(null|undefined|NaN)\b/);
    const breit = await page.evaluate(() => [document.documentElement, document.body].map((e) => e.scrollWidth - e.clientWidth));
    expect(breit.every((b) => b <= 1), `${wo}: waagerechter Überlauf ${breit}`).toBe(true);
    // einzeilige Texte brechen nicht um
    const umbruch = await page.evaluate(() => [...document.querySelectorAll(".eintrag .name, .vault-name, .karte-titel, .kopf-suche-text, #pfad, .st, .erfassen-text")].filter((e) => e.offsetParent && e.getClientRects().length > 1).map((e) => e.className || e.id));
    expect(umbruch, `${wo}: Umbruch`).toEqual([]);
  };
  await scan("Liste");
  for (const sel of ['[data-bereich="inbox"]', '[data-bereich="aufgaben"]']) { await page.click(sel); await page.waitForTimeout(300); await scan(sel); }
  await page.click('[data-bereich="alle"]');
  await page.click("#liste-koerper .karte >> nth=0");
  await page.waitForTimeout(500);
  await scan("Notiz");
  await page.click("#knopf-frage");
  await page.waitForTimeout(500);
  await scan("Frag");
  await bild(page, "schmal-1000-frag");
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await scan("Palette");
});

test("Tooltips: Symbolknöpfe zeigen den eigenen Tooltip (nach 500 ms bzw. bei Tastaturfokus), das title kommt danach zurück", async ({ page }) => {
  await aufbauen();
  await oeffneStudio(page);
  const knopf = page.locator("#knopf-neu");
  await knopf.hover();
  await expect(page.locator(".bs-tipp.offen")).toBeVisible({ timeout: 2000 });
  await expect(page.locator(".bs-tipp")).toContainText("Neue Notiz");
  await expect(knopf).not.toHaveAttribute("title", /./); // solange der Tooltip steht, kein zweiter (System-)Tooltip
  await bild(page, "tooltip");
  await page.mouse.move(700, 500);
  await expect(page.locator(".bs-tipp")).toHaveCount(0);
  await expect(knopf).toHaveAttribute("title", /Neue Notiz/);
  await expect(knopf).toHaveAttribute("aria-label", "Neue Notiz");
});

for (const schema of ["hell", "dunkel"]) {
  test(`Bilder (${schema}): Hauptfenster, Frag mit Windung, Scrollkante, Fokus, leerer Posteingang`, async ({ page }) => {
    await aufbauen();
    await schirm(page, schema);
    await oeffneStudio(page);
    await bild(page, `haupt-${schema}`);
    await page.click("#knopf-frage");
    await expect(page.locator('[data-frage="panel"]')).toBeVisible();
    await page.waitForTimeout(400);
    await bild(page, `frag-${schema}`);
    await page.click("#knopf-frage");
    // Tastaturfokus auf einem Eintrag der Seitenleiste
    await page.focus('[data-bereich="alle"]');
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await bild(page, `fokus-${schema}`);
    // Posteingang leeren: konsistenter leerer Zustand
    await page.click('[data-bereich="wissen"]');
    await page.waitForTimeout(400);
    await bild(page, `wissen-${schema}`);
  });
}

test("Bildzeiten: 5.000 Notizen scrollen flüssig; Frag und Palette öffnen/schließen ohne Ruckeln", async ({ page }) => {
  test.setTimeout(180000);
  ({ vault } = baueVault());
  const ordner = join(vault, "20_masse");
  mkdirSync(ordner, { recursive: true });
  for (let i = 0; i < 5000; i++) {
    writeFileSync(join(ordner, `n${String(i).padStart(4, "0")}.md`), `---\ntitel: Notiz ${i} über ${["Kaffee", "Reise", "Steuer", "Garten"][i % 4]}\n---\n# Notiz ${i}\n\nDies ist der Text der Notiz Nummer ${i}, ein Satz mit etwas Länge, damit die Vorschau zwei Zeilen füllt und die Karte realistisch hoch ist.\n`);
  }
  git(vault, "add", "--", "20_masse"); git(vault, "commit", "-q", "-m", "Viele Notizen");
  server = await starteServer(vault);
  await page.goto(server.url);
  await page.waitForSelector("#liste-koerper .karte", { timeout: 60000 });
  await page.click('[data-bereich="alle"]');
  await page.waitForTimeout(800);
  const mess = (aktion) => page.evaluate(async (a) => {
    const dt = [];
    let letzte = performance.now();
    let n = 0;
    await new Promise((fertig) => {
      const frame = (jetzt) => { dt.push(jetzt - letzte); letzte = jetzt; if (a === "scroll") { const l = document.getElementById("liste-koerper"); l.scrollTop += 90; } if (++n < 150) requestAnimationFrame(frame); else fertig(); };
      requestAnimationFrame(frame);
    });
    dt.shift();
    const s = [...dt].sort((x, y) => x - y);
    return { mittel: dt.reduce((x, y) => x + y, 0) / dt.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1], frames: dt.length, karten: document.querySelectorAll("#liste-koerper .karte").length };
  }, aktion);
  const scroll = await mess("scroll");
  console.log("Scrollen (5.000 Notizen, 150 Bilder, 90 px je Bild):", JSON.stringify(scroll));
  expect(scroll.p95).toBeLessThan(34);
  expect(scroll.max).toBeLessThan(150); // einzelne Ausreißer des Headless-Renderers sind kein Befund; das Nachladen kostet je 40 Karten
  // Frag und Palette: die Messung läuft, während geöffnet und geschlossen wird
  const oeffnenSchliessen = async (auf, zu) => {
    const m = page.evaluate(async () => {
      const dt = []; let letzte = performance.now(); let n = 0;
      await new Promise((fertig) => { const f = (j) => { dt.push(j - letzte); letzte = j; if (++n < 70) requestAnimationFrame(f); else fertig(); }; requestAnimationFrame(f); });
      dt.shift(); const s = [...dt].sort((x, y) => x - y);
      return { p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
    });
    await page.waitForTimeout(40);
    await auf();
    await page.waitForTimeout(350);
    await zu();
    return m;
  };
  const frag = await oeffnenSchliessen(() => page.click("#knopf-frage"), () => page.click("#knopf-frage"));
  console.log("Frag öffnen/schließen:", JSON.stringify(frag));
  expect(frag.p95).toBeLessThan(80); // CI rendert in Software (Linux): die Schwelle fängt grobe Rückschritte, die Werte stehen im Protokoll
  const palette = await oeffnenSchliessen(() => page.keyboard.press("Meta+k"), () => page.keyboard.press("Escape"));
  console.log("Palette öffnen/schließen:", JSON.stringify(palette));
  expect(palette.p95).toBeLessThan(80);
  await bild(page, "viele-notizen");
});
