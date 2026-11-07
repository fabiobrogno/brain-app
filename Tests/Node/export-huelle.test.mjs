// Export in der Electron-Hülle (electron/export-schreiben.mjs, Aktionen export-speichern, export-pdf, teilen in electron/aktionen.mjs): Prüfung, Schreiben, Dialog-Injektion.
// Reine Logik ohne Electron (Dialog und PDF-Erzeugung kommen als Attrappen hinein); das echte printToPDF prüft electron/test/huelle.spec.mjs. Nur Wegwerf-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmp, WURZEL } from "./hilfe.mjs";

const X = await import(pathToFileURL(join(WURZEL, "..", "electron", "export-schreiben.mjs")).href);
const { erzeugeAktionen } = await import(pathToFileURL(join(WURZEL, "..", "electron", "aktionen.mjs")).href);
const PNG = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
const buendel = (dateien, o = {}) => ({ name: "Atlas.md", haupt: "Atlas.md", dateien, ...o });
const ok = [{ pfad: "Atlas.md", text: "# Atlas\n![](bilder/a1b2c3d4-karte.png)\n" }, { pfad: "bilder/a1b2c3d4-karte.png", base64: PNG }];

test("pruefeBuendel: gültiges Bündel, Pfade, Namen, Größen, Duplikate", () => {
  const b = X.pruefeBuendel(buendel(ok));
  assert.equal(b.name, "Atlas.md"); assert.equal(b.dateien.length, 2); assert.equal(b.dateien[1].daten.length, 8); assert.equal(b.ordner, false);
  for (const schlecht of ["../x.md", "/etc/passwd", "a/../b.md", "a//b.md", ".versteckt/x.md", "a\\b.md", "C:x.md", "a/./b", "", "x\0y.md", "a/‮b.md", "a/b/c/d/e/f/g/h/i.md"]) {
    assert.equal(X.pruefeBuendel(buendel([ok[0], { pfad: schlecht, text: "böse" }])), null, JSON.stringify(schlecht));
  }
  assert.equal(X.pruefeBuendel(buendel(ok, { haupt: "fehlt.md" })), null, "Hauptdatei muss im Bündel stehen");
  assert.equal(X.pruefeBuendel(buendel(ok, { name: "../Atlas.md" })), null);
  assert.equal(X.pruefeBuendel(buendel(ok, { name: ".versteckt" })), null);
  assert.equal(X.pruefeBuendel(buendel([{ pfad: "Atlas.md", text: "x" }, { pfad: "atlas.md", text: "y" }])), null, "gleicher Pfad, anders geschrieben");
  assert.equal(X.pruefeBuendel(buendel([{ pfad: "Atlas.md", base64: "%%%" }])), null);
  assert.equal(X.pruefeBuendel(buendel([{ pfad: "Atlas.md" }])), null);
  assert.equal(X.pruefeBuendel(buendel([])), null);
  assert.equal(X.pruefeBuendel(buendel(ok, { ordner: "ja" })), null, "ordner nur als Boolean");
  assert.ok(X.pruefeBuendel(buendel(ok, { ordner: true })));
  for (const nichts of [null, undefined, "x", 5, [], {}]) assert.equal(X.pruefeBuendel(nichts), null);
  assert.equal(X.pruefeBuendel(buendel(Array.from({ length: X.MAX_DATEIEN + 1 }, (_, i) => ({ pfad: `d${i}.md`, text: "x" })), { haupt: "d0.md" })), null);
});
test("pruefePdf und pruefeTeilen", () => {
  assert.deepEqual(X.pruefePdf({ name: "A", html: "<p>x</p>" }), { name: "A.pdf", html: "<p>x</p>" });
  assert.equal(X.pruefePdf({ name: "A.PDF", html: "x" }).name, "A.PDF");
  for (const s of [{ name: "../A", html: "x" }, { name: "A", html: "" }, { name: "A" }, null, "x"]) assert.equal(X.pruefePdf(s), null);
  assert.deepEqual(X.pruefeTeilen({ name: "A", text: "t" }), { name: "A", text: "t" });
  assert.equal(X.pruefeTeilen({ name: "A/B", text: "t" }), null);
});

test("schreibeBuendel: Einzeldatei mit Bildern daneben; der Nutzer benennt um; Bilder werden nie überschrieben, Texte ersetzt", () => {
  const ziel = tmp("exp-h-");
  const b = X.pruefeBuendel(buendel(ok));
  assert.equal(X.schreibeBuendel(b, join(ziel, "Reise.md")), "Reise.md");
  assert.match(readFileSync(join(ziel, "Reise.md"), "utf8"), /^# Atlas/);
  assert.equal(readFileSync(join(ziel, "bilder/a1b2c3d4-karte.png")).length, 8);
  assert.equal(existsSync(join(ziel, "Atlas.md")), false);
  writeFileSync(join(ziel, "bilder/a1b2c3d4-karte.png"), "fremd");
  writeFileSync(join(ziel, "Reise.md"), "alt");
  X.schreibeBuendel(b, join(ziel, "Reise.md"));
  assert.equal(readFileSync(join(ziel, "bilder/a1b2c3d4-karte.png"), "utf8"), "fremd");
  assert.match(readFileSync(join(ziel, "Reise.md"), "utf8"), /^# Atlas/);
  assert.deepEqual(readdirSync(ziel).filter((n) => n.startsWith(".kortex-export")), [], "keine Temp-Reste");
});
test("schreibeBuendel: Ordner ersetzt den ersten Pfadteil durch den gewählten Namen", () => {
  const wurzel = tmp("exp-h-");
  const b = X.pruefeBuendel(buendel([{ pfad: "n/eins.md", text: "1" }, { pfad: "n/unter/zwei.md", text: "2" }, { pfad: "n/bilder/x.png", base64: PNG }], { name: "n", haupt: "n/eins.md", ordner: true }));
  X.schreibeBuendel(b, join(wurzel, "Mein Export"));
  assert.equal(readFileSync(join(wurzel, "Mein Export/unter/zwei.md"), "utf8"), "2");
  assert.ok(existsSync(join(wurzel, "Mein Export/bilder/x.png")));
  assert.equal(existsSync(join(wurzel, "n")), false);
});
test("schreibeBuendel: nie durch Symlinks (Ordner bilder, Hauptdatei) und nichts nach draußen", { skip: process.platform === "win32" }, () => {
  const wurzel = tmp("exp-h-"), aussen = tmp("exp-aussen-");
  symlinkSync(aussen, join(wurzel, "bilder"));
  assert.throws(() => X.schreibeBuendel(X.pruefeBuendel(buendel(ok)), join(wurzel, "Atlas.md")), (e) => e.grund === "ausserhalb");
  assert.equal(existsSync(join(aussen, "a1b2c3d4-karte.png")), false);
  const ziel = tmp("exp-h-");
  writeFileSync(join(aussen, "ziel.md"), "geheim");
  symlinkSync(join(aussen, "ziel.md"), join(ziel, "Atlas.md"));
  assert.throws(() => X.schreibeBuendel(X.pruefeBuendel(buendel([{ pfad: "Atlas.md", text: "neu" }])), join(ziel, "Atlas.md")), (e) => e.grund === "verweis");
  assert.equal(readFileSync(join(aussen, "ziel.md"), "utf8"), "geheim");
});

// ───────────── Aktionen mit eingespritztem Dialog und PDF-Erzeugung ─────────────
function huelle(ueberschreibe = {}) {
  const log = [], dialoge = [];
  const stumm = () => {};
  const abh = {
    support: "/x", vaultPfad: async () => null, openExternal: stumm, showItemInFolder: stumm, schreibeZwischenablage: stumm, waehleOrdner: async () => null, mitteilung: () => true,
    darstellung: stumm, fensterTitel: stumm, fensterZoom: stumm, befehlAnStudio: stumm, protokoll: (z) => log.push(z), einrichtung: { lese: () => ({}), schreibe: stumm },
    ordner: { pruefeOrdner: () => ({ ok: false }) }, git: { pruefen: async () => ({}), hinweis: () => "" },
    waehleSpeichern: async (o) => { dialoge.push(o); return null; }, pdfRendern: async () => null, ...ueberschreibe,
  };
  return { h: erzeugeAktionen(abh), log, dialoge };
}
test("Aktion export-speichern: Dialog bekommt Name und Art; Abbruch schreibt nichts; Ziel schreibt; Protokoll ohne Namen", async () => {
  const ziel = tmp("exp-h-");
  const a = huelle({ waehleSpeichern: async () => null });
  assert.deepEqual(await a.h.aktion("export-speichern", buendel(ok)), { ok: false, grund: "abgebrochen" });
  const b2dialoge = [];
  const b2 = huelle({ waehleSpeichern: async (o) => { b2dialoge.push(o); return join(ziel, "Neu.md"); } });
  assert.deepEqual(await b2.h.aktion("export-speichern", buendel(ok)), { ok: true, name: "Neu.md" });
  assert.deepEqual(b2dialoge, [{ name: "Atlas.md", ordner: false }]);
  assert.ok(existsSync(join(ziel, "bilder/a1b2c3d4-karte.png")));
  assert.deepEqual(b2.log, ["aktion export-speichern"]);
  // ungültig: kein Dialog, keine Wirkung
  const c = huelle({ waehleSpeichern: async () => { assert.fail("kein Dialog bei ungültigem Wert"); } });
  assert.deepEqual(await c.h.aktion("export-speichern", buendel([{ pfad: "../x.md", text: "x" }])), { ok: false, grund: "ungueltig" });
  assert.deepEqual(await c.h.aktion("export-speichern"), { ok: false, grund: "ungueltig" });
  // Schreibfehler → { ok:false, grund:"fehler" }, nie ein Wurf
  const d = huelle({ waehleSpeichern: async () => join(ziel, "gibt/es/nicht/Datei.md"), schreibeBuendel: () => { throw Object.assign(new Error("x"), { grund: "ausserhalb" }); } });
  assert.deepEqual(await d.h.aktion("export-speichern", buendel(ok)), { ok: false, grund: "fehler" });
});
test("Aktion export-pdf: Dialog mit Endung pdf, dann Erzeugung aus dem HTML (Injektion), dann geschrieben; Abbruch erzeugt nichts; leere Erzeugung ist ein Fehler", async () => {
  const ziel = tmp("exp-h-");
  const dialoge = [], htmls = [];
  const a = huelle({ waehleSpeichern: async (o) => { dialoge.push(o); return join(ziel, "Atlas.pdf"); }, pdfRendern: async (html) => { htmls.push(html); return Buffer.from("%PDF-1.4 attrappe"); } });
  assert.deepEqual(await a.h.aktion("export-pdf", { name: "Atlas", html: "<h1>Atlas</h1>" }), { ok: true, name: "Atlas.pdf" });
  assert.deepEqual(dialoge, [{ name: "Atlas.pdf", ordner: false, endung: "pdf" }]);
  assert.deepEqual(htmls, ["<h1>Atlas</h1>"]);
  assert.equal(readFileSync(join(ziel, "Atlas.pdf"), "utf8"), "%PDF-1.4 attrappe");
  const b = huelle({ waehleSpeichern: async () => null, pdfRendern: async () => assert.fail("nach Abbruch wird nichts erzeugt") });
  assert.deepEqual(await b.h.aktion("export-pdf", { name: "A", html: "x" }), { ok: false, grund: "abgebrochen" });
  const c = huelle({ waehleSpeichern: async () => join(ziel, "Leer.pdf"), pdfRendern: async () => null });
  assert.deepEqual(await c.h.aktion("export-pdf", { name: "Leer", html: "x" }), { ok: false, grund: "fehler" });
  assert.equal(existsSync(join(ziel, "Leer.pdf")), false);
  assert.deepEqual(await c.h.aktion("export-pdf", { name: "../x", html: "x" }), { ok: false, grund: "ungueltig" });
  assert.deepEqual(a.log.filter((z) => z.includes("Atlas")), [], "keine Namen im Protokoll");
});
test("Aktion teilen: in der Electron-Hülle nicht verfügbar (ehrlich), nie ein Fehler", async () => {
  assert.deepEqual(await huelle().h.aktion("teilen", { name: "A", text: "t" }), { ok: false, grund: "nicht-verfuegbar" });
});
