// Hüllen-Vertrag (Ressourcen/studio/huellen-vertrag.json): jede Aktion, die das Studio aufruft, steht im Vertrag; Vertrag und Swift (AppAktion.pruefe) nennen dieselben Namen;
// die Aktionen „nur bei offener Einrichtung“ sind genau die, die EinrichtungsOverlay.nurAusEinrichtung in Swift kennt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const vertrag = JSON.parse(readFileSync(join(W, "Ressourcen/studio/huellen-vertrag.json"), "utf8"));
const namen = vertrag.aktionen.map((a) => a.name);

test("Vertrag: Namen eindeutig, jede Aktion mit Wert, Antwort und Zweck", () => {
  assert.equal(new Set(namen).size, namen.length);
  for (const a of vertrag.aktionen) { assert.ok("wert" in a && a.antwort && a.zweck, a.name); }
});

test("das Studio ruft nur Aktionen aus dem Vertrag auf", () => {
  const dir = join(W, "Ressourcen/studio");
  const fremd = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/\baktion(?:MitAntwort)?\(\s*"([a-z-]+)"/g)) if (!namen.includes(m[1])) fremd.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(fremd, []);
});

test("Vertrag und Swift nennen dieselben Aktionen", () => {
  const swift = readFileSync(join(W, "Sources/BrainCore/AppAktion.swift"), "utf8");
  const inSwift = [...swift.matchAll(/^ {8}case "([a-z-]+)":/gm)].map((m) => m[1]).sort();
  assert.deepEqual(inSwift, [...namen].sort());
});

test("„nur bei offener Einrichtung“ stimmt mit Swift überein", () => {
  const swift = readFileSync(join(W, "Sources/BrainCore/EinrichtungsOverlay.swift"), "utf8");
  const zeile = /case \.gitPruefen[^\n]*return true/.exec(swift)?.[0] || "";
  const swiftNamen = { gitPruefen: "git-pruefen", gitInstallieren: "git-installieren", kopieren: "kopieren", einrichtungEnde: "einrichtung-ende", einrichtungSchritt: "einrichtung-schritt" };
  const ausSwift = Object.entries(swiftNamen).filter(([k]) => zeile.includes("." + k)).map(([, v]) => v).sort();
  const ausVertrag = vertrag.aktionen.filter((a) => a.nurBeiOffenerEinrichtung).map((a) => a.name).sort();
  assert.deepEqual(ausVertrag, ausSwift);
  assert.equal(ausSwift.length, 5);
});

test("Befehle der Hülle an das Studio sind im Studio vorhanden", () => {
  const app = readFileSync(join(W, "Ressourcen/studio/app.js"), "utf8");
  for (const b of vertrag.huellenBefehle) assert.ok(b.name === "hinweis" ? app.includes("window.studio.hinweis") : app.includes(`${b.name}: (arg)`), b.name);
});

test("Einrichtung (E2): die Sitzung bestätigt die Seite (immer erlaubt), die Schritte nennen dieselben Namen wie Swift", () => {
  const sitzung = vertrag.aktionen.find((a) => a.name === "einrichtung-sitzung");
  assert.ok(sitzung, "einrichtung-sitzung steht im Vertrag");
  assert.ok(!sitzung.nurBeiOffenerEinrichtung, "die Meldung selbst muss vor der Bestätigung gehen");
  const schritt = vertrag.aktionen.find((a) => a.name === "einrichtung-schritt");
  assert.equal(schritt?.nurBeiOffenerEinrichtung, true);
  const swift = readFileSync(join(W, "Sources/BrainCore/EinrichtungsZustand.swift"), "utf8");
  const faelle = /enum EinrichtungsSchritt[^{]*\{([\s\S]*?)\n\}/.exec(swift)?.[1] ?? "";
  const inSwift = [...faelle.matchAll(/^\s*case (\w+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(inSwift, ["vault", "ki", "sicherung"]);
  for (const n of inSwift) assert.ok(schritt.wert.includes(`"${n}"`), `Vertrag nennt den Schritt ${n}`);
  // Das Studio ruft beide auf (Sitzung beim Öffnen/Schließen/Laden, Schritt nach jedem erledigten Schritt)
  const dir = join(W, "Ressourcen/studio");
  const text = readdirSync(dir).filter((n) => n.endsWith(".js")).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
  assert.match(text, /aktion(?:MitAntwort)?\(\s*"einrichtung-sitzung"/);
  assert.match(text, /aktion(?:MitAntwort)?\(\s*"einrichtung-schritt"/);
});

test("Routen, die die Hülle statt der Werkstatt beantwortet (KiRoute.swift): alle im Vertrag, mit Browser-Verhalten, und in der Werkstatt als Rückfall vorhanden", () => {
  const swift = readFileSync(join(W, "Sources/BrainCore/KiRoute.swift"), "utf8");
  const inSwift = [];
  for (const z of swift.matchAll(/case ((?:"\/api\/[a-z\/-]+",?\s*)+): erwartet = "(GET|POST|PUT)"/g)) for (const p of z[1].matchAll(/"(\/api\/[a-z\/-]+)"/g)) inSwift.push(`${z[2]} ${p[1]}`);
  assert.ok(inSwift.length >= 4, "Routen in KiRoute.swift gefunden");
  const imVertrag = (vertrag.routen || []).map((r) => `${r.methode} ${r.pfad}`);
  assert.deepEqual([...imVertrag].sort(), [...inSwift].sort());
  const handler = readFileSync(join(W, "Ressourcen/werkstatt/handler.mjs"), "utf8");
  for (const r of vertrag.routen) {
    assert.ok(r.zweck && r.antwort && r.browser, `${r.pfad}: Zweck, Antwort und Browser-Verhalten`);
    assert.ok(handler.includes(`case "${r.pfad}"`), `${r.pfad}: Rückfall in der Werkstatt`);
  }
});

// ───────────── Electron-Hülle (Paket W2a, electron/) ─────────────
test("Electron-Hülle: kennt jede Aktion des Vertrags (und nur diese), mit Beschreibung im Feld `electron`", async () => {
  const { erzeugeAktionen } = await import(pathToFileURL(join(W, "electron/aktionen.mjs")).href);
  const stumm = () => {};
  const h = erzeugeAktionen({ support: "/x", vaultPfad: async () => null, openExternal: stumm, showItemInFolder: stumm, schreibeZwischenablage: stumm, waehleOrdner: async () => null, mitteilung: () => true,
    darstellung: stumm, fensterTitel: stumm, fensterZoom: stumm, befehlAnStudio: stumm, protokoll: stumm, einrichtung: { lese: () => ({}), schreibe: stumm }, ordner: { pruefeOrdner: () => ({ ok: false }) }, git: { pruefen: () => ({}), hinweis: () => "" } });
  assert.deepEqual([...h.namen].sort(), [...namen].sort());
  for (const a of vertrag.aktionen) assert.ok(typeof a.electron === "string" && a.electron.length > 10, `${a.name}: Feld electron`);
  // jede Aktion antwortet (nie unbekannt), auch mit leerem Wert: nie ein Fehler
  for (const n of namen) { const r = await h.aktion(n, undefined); assert.notEqual(r?.grund, "unbekannt", n); assert.notEqual(r?.grund, "fehler", n); }
  assert.deepEqual(await h.aktion("gibt-es-nicht"), { ok: false, grund: "unbekannt" });
});

test("Electron-Hülle: „nur bei offener Einrichtung“ ist dieselbe Liste wie im Vertrag und in der Browser-Hülle", async () => {
  const { NUR_EINRICHTUNG, ASYNCHRON } = await import(pathToFileURL(join(W, "electron/aktionen.mjs")).href);
  const ausVertrag = vertrag.aktionen.filter((a) => a.nurBeiOffenerEinrichtung).map((a) => a.name).sort();
  assert.deepEqual([...NUR_EINRICHTUNG].sort(), ausVertrag);
  const browser = readFileSync(join(W, "Ressourcen/studio/huelle-browser.js"), "utf8");
  const liste = /var NUR_EINRICHTUNG = \[([^\]]*)\]/.exec(browser)?.[1] ?? "";
  assert.deepEqual([...liste.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort(), ausVertrag);
  for (const n of ASYNCHRON) assert.ok(namen.includes(n), `asynchron: ${n} steht im Vertrag`);
});

test("Electron-Hülle: Routen der Hülle haben im Vertrag ein Electron-Verhalten (Rückfall der Werkstatt)", () => {
  for (const r of vertrag.routen) assert.ok(typeof r.electron === "string" && r.electron.length > 10, `${r.pfad}: Feld electron`);
});

test("Electron-Hülle: Preload gibt der Seite genau window.kortexHuelle (Sandbox-fähig, ohne eigene Werte-Liste), Fenster mit Isolation und Sandbox", () => {
  const preload = readFileSync(join(W, "electron/preload.cjs"), "utf8");
  assert.equal([...preload.matchAll(/exposeInMainWorld\(\s*"([^"]+)"/g)].map((m) => m[1]).join(), "kortexHuelle");
  assert.doesNotMatch(preload, /require\((?!"electron")/, "im Sandbox-Preload nur electron laden");
  const haupt = readFileSync(join(W, "electron/haupt.mjs"), "utf8");
  for (const [schluessel, soll] of [["contextIsolation", "true"], ["nodeIntegration", "false"], ["sandbox", "true"], ["webSecurity", "true"]]) assert.match(haupt, new RegExp(`${schluessel}: ${soll}`), schluessel);
});
