// Design-System v2 (Paket P1): Tokens, Kontrast, Schrift, Auswahl-Rezept — gegen die echte Oberfläche mit Wegwerf-Vault.
// Gestaltungswerte nach Orca (MIT, Copyright (c) 2026 Lovecast Inc.), siehe THIRD-PARTY-NOTICES.md und docs/plaene/design-wizards.md.
import { test, expect } from "./basis.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { STUDIO } from "./modul-seite.mjs";

let server;
test.beforeEach(async () => { const { vault } = baueVault(); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

async function start(page, schema) {
  await page.emulateMedia({ colorScheme: schema });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte]");
  await page.evaluate(() => document.fonts.ready);
}

// Löst Tokens in der gerade aktiven Farbvariante zu rgb-Zahlen auf (light-dark() und color-mix() inklusive) und rechnet WCAG-Kontrast.
const PRUEFER = () => {
  const probe = document.createElement("div");
  document.body.append(probe);
  const rgb = (token) => {
    probe.style.color = `var(${token})`;
    const c = getComputedStyle(probe).color;
    const m = c.match(/[\d.]+/g).map(Number);
    if (c.startsWith("color(")) return m.slice(0, 3).map((v) => v * 255);
    return m.slice(0, 3);
  };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const kontrast = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const erg = { kontrast: {}, werte: {} };
  for (const [fg, bgs, min] of [
    ["--text", ["--papier", "--seite", "--erhoben", "--hover", "--auswahl"], 4.5],
    ["--text-2", ["--papier", "--seite", "--erhoben"], 4.5],
    ["--text-3", ["--papier", "--seite", "--erhoben", "--hover"], 3],
    ["--akzent", ["--papier", "--seite", "--erhoben"], 4.5],
    ["--akzent-text", ["--akzent"], 4.5],
    ["--akzent-tinte", ["--papier", "--seite"], 4.5],
  ]) for (const bg of bgs) erg.kontrast[`${fg} auf ${bg}`] = { ist: Math.round(kontrast(fg, bg) * 100) / 100, min };
  for (const t of ["--papier", "--seite", "--erhoben", "--text", "--text-2", "--text-3", "--akzent"]) erg.werte[t] = rgb(t).map((v) => Math.round(v)).join(",");
  probe.remove();
  return erg;
};

for (const [schema, text3, papier] of [["light", "140,140,140", "255,255,255"], ["dark", "120,120,120", "10,10,10"]]) {
  test(`Kontrast (${schema}): Text ≥ 4,5:1, Tertiärtext ≥ 3:1 auf allen Flächen`, async ({ page }) => {
    await start(page, schema);
    const { kontrast, werte } = await page.evaluate(PRUEFER);
    const zu_schwach = Object.entries(kontrast).filter(([, k]) => k.ist < k.min).map(([n, k]) => `${n}: ${k.ist} < ${k.min}`);
    expect(zu_schwach).toEqual([]);
    // die freigegebenen Werte aus dem Prototyp: Tertiärtext #8c8c8c (hell) / #787878 (dunkel), Papier #fff / #0a0a0a
    expect(werte["--text-3"]).toBe(text3);
    expect(werte["--papier"]).toBe(papier);
  });
}

test("Tokens: Radien, Höhenstufen, Bewegung wie im Prototyp (aus Orca abgeleitet)", async ({ page }) => {
  await start(page, "light");
  const t = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const lies = (n) => cs.getPropertyValue(n).trim().replace(/\s+/g, " ");
    return Object.fromEntries(["--r-s", "--r", "--r-l", "--r-xl", "--r-2xl", "--ease-out", "--ease-flow", "--d-fast", "--d", "--d-layout", "--schatten-klein", "--schatten-float", "--schatten-dialog"].map((n) => [n, lies(n)]));
  });
  expect([t["--r-s"], t["--r"], t["--r-l"], t["--r-xl"], t["--r-2xl"]]).toEqual(["6px", "8px", "10px", "14px", "18px"]);
  expect(t["--ease-out"]).toBe("cubic-bezier(.16, 1, .3, 1)");
  expect(t["--ease-flow"]).toBe("cubic-bezier(.22, 1, .36, 1)");
  expect([t["--d-fast"], t["--d"], t["--d-layout"]]).toEqual(["120ms", "180ms", "760ms"]);
  // drei Höhenstufen sind gesetzt und unterscheiden sich (xs < floating < Dialog)
  const blur = (s) => Math.max(...[...s.matchAll(/(?:^|\s|,)(\d+)px\s+(\d+)px(?=\s*(?:rgba?|light-dark|,|$))/g)].map((m) => +m[2]));
  expect(blur(t["--schatten-klein"])).toBeLessThan(blur(t["--schatten-float"]));
  expect(blur(t["--schatten-float"])).toBeLessThan(blur(t["--schatten-dialog"]));
});

test("Schrift: Geist (Text) und Geist Mono (Code) sind eingebettet, offline ausgeliefert und aktiv", async ({ page }) => {
  await start(page, "light");
  const r = await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 14px "Geist"'), document.fonts.load('400 14px "Geist Mono"')]);
    const fam = (el) => getComputedStyle(el).fontFamily;
    return { body: fam(document.body), mono: getComputedStyle(document.documentElement).getPropertyValue("--mono"), geist: document.fonts.check('14px "Geist"'), geistMono: document.fonts.check('14px "Geist Mono"'),
      geladen: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")), spacing: getComputedStyle(document.body).letterSpacing, groesse: getComputedStyle(document.body).fontSize };
  });
  expect(r.body.startsWith('Geist')).toBe(true);
  expect(r.mono).toMatch(/Geist Mono/);
  expect(r.geist && r.geistMono).toBe(true);
  expect(r.geladen).toEqual(expect.arrayContaining(["Geist", "Geist Mono"]));
  expect(r.groesse).toBe("14px");
  expect(parseFloat(r.spacing)).toBeCloseTo(0.14, 2); // .01em bei 14 px
  for (const f of ["Geist-Variable.woff2", "GeistMono-Variable.woff2", "OFL.txt"]) {
    const a = await page.request.get(server.url + "vendor/fonts/" + f);
    expect(a.status(), f).toBe(200);
  }
  // nichts wird von außen geladen: die Schrift steht in Ressourcen/studio/vendor/fonts, die CSS verweist nur relativ darauf
  const css = readFileSync(join(STUDIO, "studio.css"), "utf8");
  expect(css).toMatch(/url\("vendor\/fonts\/Geist-Variable\.woff2"\)/);
  expect(css).not.toMatch(/url\(\s*["']?https?:/);
});

test("Auswahl-Rezept: gewählte Zeile in Seitenleiste und Liste ist grau mit Ring, nicht in Akzent", async ({ page }) => {
  for (const schema of ["light", "dark"]) {
    await start(page, schema);
    await page.locator("#liste-koerper [data-karte]").first().click();
    await expect(page.locator('.karte[aria-selected="true"]')).toBeVisible();
    const stil = await page.evaluate(() => {
      const s = (sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return { bg: c.backgroundColor, schatten: c.boxShadow, farbe: c.color }; };
      return { nav: s('.eintrag[aria-current="true"]'), karte: s('.karte[aria-selected="true"]') };
    });
    for (const k of ["nav", "karte"]) {
      expect(stil[k].schatten, `${schema} ${k}`).toMatch(/inset/);
      const [r, g, b] = stil[k].bg.match(/[\d.]+/g).map(Number);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${schema} ${k}: Auswahlfläche ist neutral grau`).toBeLessThanOrEqual(2);
    }
  }
});

test("Bausteine: Maße im Prototyp-Stil (Knopf 32/28, Feld 32, Schalter 32×18, Dialog Radius 14, Palette 640 breit)", async ({ page }) => {
  await start(page, "light");
  const m = await page.evaluate(async () => {
    const mod = await import("/bausteine.js");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;z-index:99;padding:16px;display:grid;gap:8px;background:var(--papier)";
    const k = mod.knopf({ text: "Prüfen", variante: "primaer", groesse: "m" });
    const ks = mod.knopf({ text: "Klein", groesse: "s" });
    const f = mod.textfeld({ platzhalter: "x", name: "x" });
    const sw = mod.umschalter({ label: "Test", an: false, aufAenderung: () => {} });
    host.append(k, ks, f.el, sw);
    document.body.append(host);
    const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const erg = { knopf: box(k)[1], klein: box(ks)[1], radius: getComputedStyle(k).borderRadius, feld: box(host.querySelector(".bs-feld"))[1] };
    erg.schalter = box(sw);
    host.remove();
    return erg;
  });
  expect(m.knopf).toBe(32);
  expect(m.klein).toBe(28);
  expect(m.radius).toBe("8px");
  expect(m.feld).toBe(32);
  expect(m.schalter).toEqual([32, 18]);
  // Dialog und Palette
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(350); // Eintrittsanimation (zoom 180 ms) abwarten
  const pal = await page.locator(".palette").boundingBox();
  expect(Math.round(pal.width)).toBe(640);
  expect(await page.locator(".palette").evaluate((e) => getComputedStyle(e).borderRadius)).toBe("14px");
});
