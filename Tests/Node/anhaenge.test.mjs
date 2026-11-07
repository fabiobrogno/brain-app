// Anhänge (Runde 3, Paket 3a): Regeln, Prüfung am Inhalt, SVG-Bereinigung, Ablage, Auflösen, unbenutzte Anhänge, Umbenennen/Verschieben, Routen der Werkstatt, externe Bilder.
// Nur Wegwerf-Ordner (tmp), nie ein echter Vault; das Netz ist ein lokaler Testserver (mit BRAIN_EXTERN_LOKAL).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync, symlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const R = await import(pfad("gemeinsam", "anhang-regeln.mjs"));
const A = await import(pfad("gemeinsam", "anhaenge.mjs"));
const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 2)]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#c33"/></svg>');
const JETZT = () => new Date(2026, 10, 7, 14, 32, 5); // 07.11.2026 14:32:05 Ortszeit
const fehler = async (fn) => { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); };
const vault = (dateien = {}) => { const d = tmp("anh-vault-"); schreibe(d, "brain.config.json", "{}\n"); for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t); return d; };

// ───────────────────────────── Regeln ─────────────────────────────

test("Regeln: Endungen, Bildtypen, Dateien, Slug, Zeitstempel, Größe", () => {
  assert.equal(R.endungVon("Foto.JPG"), "jpg");
  assert.equal(R.endungVon("ohne"), "");
  assert.ok(["png", "jpg", "jpeg", "gif", "webp", "svg"].every((e) => R.istBildName("x." + e)));
  assert.ok(!R.istBildName("x.pdf") && R.istAnhangName("x.pdf") && R.istAnhangName("x.docx"));
  for (const schlecht of ["a.html", "a.js", "a.exe", "a.app", "a.sh", "a.bat", "a.command", "a.md", "a.json", "a"]) assert.ok(!R.istAnhangName(schlecht), schlecht);
  assert.equal(R.slugAnhang("Müller – Übersicht (final).PNG"), "mueller-uebersicht-final");
  assert.equal(R.slugAnhang("???.png"), "datei");
  assert.equal(R.zeitstempel(JETZT()), "2026-11-07-143205");
  assert.equal(R.groesseText(500), "500 Byte");
  assert.equal(R.groesseText(2.4 * 1024 * 1024), "2,4 MB");
  assert.equal(R.groesseText(830 * 1024), "830 KB");
  assert.equal(R.einbettungsText("a.png"), "![[a.png]]");
});

test("Regeln: Einbettung lesen (Breite, Beschreibung), lokaler Pfad, Adresse", () => {
  const lies = (t) => [...t.matchAll(new RegExp(R.EINBETTUNG.source, "g"))].map((m) => R.einbettungAus(m));
  assert.deepEqual(lies("![[a.png]] und ![[b c.jpg|300]] und ![[d.png|Alt Text]] ![[e.png#x|20x10]]"), [
    { ziel: "a.png", breite: null, alt: "" }, { ziel: "b c.jpg", breite: 300, alt: "" }, { ziel: "d.png", breite: null, alt: "Alt Text" }, { ziel: "e.png", breite: 20, alt: "" }]);
  assert.equal(R.lokalerPfad("a%20b/c.png?x=1#y"), "a b/c.png");
  assert.equal(R.lokalerPfad("<./x.png>"), "./x.png");
  assert.equal(R.lokalerPfad("https://x.de/a.png"), null);
  assert.equal(R.lokalerPfad("data:image/png;base64,AAAA"), null);
  assert.equal(R.lokalerPfad("//x.de/a.png"), null);
  assert.equal(R.anhangUrl("../a b.png", "n/x.md"), "/_anhang?ziel=..%2Fa%20b.png&von=n%2Fx.md");
});

// ───────────────────────────── Prüfung am Inhalt ─────────────────────────────

test("Prüfung: Bilder erkennt Kortex am Inhalt, Dokumente müssen zur Endung passen", () => {
  assert.deepEqual(A.pruefeAnhang({ name: "x.png", buf: PNG }), { endung: "png", art: "bild", mime: "image/png" });
  assert.equal(A.pruefeAnhang({ name: "image", buf: PNG }).endung, "png"); // Zwischenablage: kein Name
  assert.equal(A.pruefeAnhang({ name: "foto.png", buf: JPG }).endung, "jpg"); // der Inhalt zählt
  assert.equal(A.pruefeAnhang({ name: "x.svg", buf: SVG }).art, "bild");
  assert.equal(A.pruefeAnhang({ name: "r.pdf", buf: PDF }).art, "datei");
  assert.equal(A.pruefeAnhang({ name: "t.docx", buf: ZIP }).endung, "docx");
  assert.equal(A.pruefeAnhang({ name: "n.txt", buf: Buffer.from("Hallo Welt äöü\n") }).endung, "txt");
});

test("Prüfung: abgelehnt werden ausführbare und aktive Typen, falsche Inhalte, leere und zu große Dateien", async () => {
  const ablehnen = (arg, status) => fehler(() => A.pruefeAnhang(arg)).then((e) => assert.equal(e.status, status, JSON.stringify(e.extra)));
  await ablehnen({ name: "x.exe", buf: Buffer.from("MZ....") }, 415);
  await ablehnen({ name: "x.html", buf: Buffer.from("<script>alert(1)</script>") }, 415);
  await ablehnen({ name: "x.js", buf: Buffer.from("alert(1)") }, 415);
  await ablehnen({ name: "x.command", buf: Buffer.from("#!/bin/sh\n") }, 415);
  await ablehnen({ name: "x.png", buf: Buffer.from("<html>kein Bild</html>") }, 415); // Bildendung, Inhalt kein Bild
  await ablehnen({ name: "x.pdf", buf: Buffer.from("kein PDF") }, 415);
  await ablehnen({ name: "x.pdf", buf: PNG }, 415); // Bild im PDF-Gewand
  await ablehnen({ name: "x.zip", buf: PDF }, 415);
  await ablehnen({ name: "x.txt", buf: Buffer.from([0, 1, 2, 3, 0]) }, 415);
  await ablehnen({ name: "x.png", buf: Buffer.alloc(0) }, 400);
  await ablehnen({ name: "x.png", buf: PNG, maxBytes: 10 }, 413);
  const e = await fehler(() => A.pruefeAnhang({ name: "x.pdf", buf: Buffer.alloc(3 * 1024 * 1024, 1), maxBytes: 2 * 1024 * 1024 }));
  assert.match(e.message, /3 MB groß/); assert.match(e.message, /2 MB/); // der Hinweis nennt beide Größen
  assert.equal(e.extra.art, "zu-gross");
});

// ───────────────────────────── SVG ─────────────────────────────

test("SVG: Skripte, Fremdinhalt, Ereignisse und Adressen nach außen entfallen, Formen bleiben", () => {
  const boese = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)" width="10">
<script>alert(1)</script><script/><a xlink:href="javascript:alert(1)"><rect width="5" onclick="x()" style="fill:url(http://e.example/x)"/></a>
<foreignObject><div onmouseover="x()">hi</div><iframe src="x"></iframe></foreignObject>
<use href="http://e.example/y.svg#a"/><use xlink:href="#ok"/><image href="https://e.example/t.png"/><image href="data:image/png;base64,AAAA"/>
<circle r="3" fill="url(#g)" stroke="jav&#x61;script:alert(1)"/><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="href" to="x"/>
<style>@import url(http://e.example/x.css); .a{fill:red}</style><style>.b{fill:url(#g)}</style><path d="M0 0L5 5"/></svg>`;
  const aus = A.bereinigeSvg(boese);
  for (const verboten of ["script", "onload", "onclick", "onmouseover", "foreignObject", "iframe", "javascript", "e.example", "ENTITY", "DOCTYPE", "/etc/passwd", "animate", "<set", "@import", "<a "]) assert.ok(!aus.toLowerCase().includes(verboten.toLowerCase()), `${verboten} in ${aus}`);
  for (const bleibt of ["<svg", "<rect", "<circle", '<use xlink:href="#ok"', "<path", 'data:image/png;base64,AAAA', 'fill="url(#g)"', ".b{fill:url(#g)}"]) assert.ok(aus.includes(bleibt), `${bleibt} fehlt in ${aus}`);
  assert.ok(!aus.includes(".a{fill:red}"), "ein Style-Block mit @import entfällt ganz");
  assert.doesNotThrow(() => A.bereinigeSvg(SVG.toString()));
});

test("SVG: Text vor und nach dem Wurzelelement entfällt, kein <svg> = Fehler, Sonderzeichen bleiben gültig", async () => {
  assert.equal(A.bereinigeSvg('hallo <svg width="1"><text>a &lt; b &amp; c</text></svg> danach'), '<svg width="1"><text>a &lt; b &amp; c</text></svg>');
  for (const nein of ["", "<html><body>x</body></html>", "<script>alert(1)</script>", "kein svg"]) assert.equal((await fehler(() => A.bereinigeSvg(nein))).status, 415);
  assert.equal(A.bereinigeSvg('<svg><text>5 < 6</text></svg>'), "<svg><text>5 &lt; 6</text></svg>");
});

// ───────────────────────────── Ablage ─────────────────────────────

test("speichereAnhang: Standardort, Name aus Datum und Slug, nie überschreiben, eindeutig im Vault", () => {
  const d = vault({ "10_notizen/n.md": "# N\n" });
  const a = A.speichereAnhang({ wurzel: d, notiz: "10_notizen/n.md", name: "Mein Bild.PNG", buf: PNG, einstellungen: {}, jetzt: JETZT });
  assert.equal(a.pfad, "_anhaenge/2026-11-07-143205-mein-bild.png");
  assert.equal(a.name, "2026-11-07-143205-mein-bild.png");
  assert.equal(a.einbettung, "![[2026-11-07-143205-mein-bild.png]]");
  assert.equal(a.art, "bild"); assert.equal(a.groesse, PNG.length);
  assert.ok(readFileSync(join(d, a.pfad)).equals(PNG));
  const b = A.speichereAnhang({ wurzel: d, notiz: "10_notizen/n.md", name: "Mein Bild.png", buf: PNG, einstellungen: {}, jetzt: JETZT }); // gleiche Sekunde, gleicher Name
  assert.equal(b.pfad, "_anhaenge/2026-11-07-143205-mein-bild-2.png");
  const c = A.speichereAnhang({ wurzel: d, name: "x", buf: PNG, einstellungen: {}, jetzt: JETZT });
  assert.equal(c.pfad, "_anhaenge/2026-11-07-143205-x.png");
  assert.equal(A.speichereAnhang({ wurzel: d, name: "???", buf: PNG, einstellungen: {}, jetzt: JETZT }).pfad, "_anhaenge/2026-11-07-143205-datei.png", "ohne brauchbaren Namen: „datei“");
  assert.deepEqual(readdirSync(join(d, "_anhaenge")).sort(), ["2026-11-07-143205-datei.png", "2026-11-07-143205-mein-bild-2.png", "2026-11-07-143205-mein-bild.png", "2026-11-07-143205-x.png"]);
  // Derselbe Name liegt schon an anderer Stelle im Vault: der neue weicht aus (die Auflösung über den Namen bleibt eindeutig)
  schreibe(d, "alt/2026-11-07-143205-bild.png", PNG);
  const e = A.speichereAnhang({ wurzel: d, name: "bild.png", buf: PNG, einstellungen: {}, jetzt: JETZT });
  assert.equal(e.name, "2026-11-07-143205-bild-2.png");
});

test("speichereAnhang: Ort „notiz“, eigener Ordnername, ungültige Ordner fallen auf den Standard zurück", () => {
  const d = vault({ "a/b/n.md": "# N\n" });
  assert.equal(A.speichereAnhang({ wurzel: d, notiz: "a/b/n.md", name: "x.png", buf: PNG, einstellungen: { anhaengeOrt: "notiz" }, jetzt: JETZT }).pfad, "a/b/_anhaenge/2026-11-07-143205-x.png");
  assert.equal(A.speichereAnhang({ wurzel: d, notiz: "a/b/n.md", name: "m.png", buf: PNG, einstellungen: { anhaengeOrdner: "Medien/Bilder" }, jetzt: JETZT }).pfad, "Medien/Bilder/2026-11-07-143205-m.png");
  assert.equal(A.speichereAnhang({ wurzel: d, notiz: "n.md", name: "y.png", buf: PNG, einstellungen: { anhaengeOrt: "notiz" }, jetzt: JETZT }).pfad, "_anhaenge/2026-11-07-143205-y.png"); // Notiz an der Wurzel
  for (const schlecht of ["../aus", ".versteckt", "a/../../b", "node_modules", "a:b", ""]) {
    assert.equal(A.anhangEinstellungen({ anhaengeOrdner: schlecht }).ordner, "_anhaenge", schlecht);
  }
  assert.equal(A.anhangEinstellungen({ anhaengeMaxMB: 5 }).maxBytes, 5 * 1024 * 1024);
  assert.equal(A.anhangEinstellungen({ anhaengeMaxMB: 5000 }).maxMB, 100, "zu groß: auf die Obergrenze begrenzt");
  assert.equal(A.anhangEinstellungen({ anhaengeMaxMB: "x" }).maxMB, 20, "ungültig = Standard");
  assert.equal(A.anhangEinstellungen({}).externeBilder, false);
});

test("speichereAnhang: SVG wird bereinigt abgelegt, Grenzen gelten, große Dateien tragen einen Hinweis", async () => {
  const d = vault();
  const s = A.speichereAnhang({ wurzel: d, name: "g.svg", buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><rect/></svg>'), einstellungen: {}, jetzt: JETZT });
  const text = readFileSync(join(d, s.pfad), "utf8");
  assert.ok(text.includes("<rect/>") && !/script|onload/.test(text), text);
  const e = await fehler(() => A.speichereAnhang({ wurzel: d, name: "x.pdf", buf: Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]), einstellungen: { anhaengeMaxMB: 1 }, jetzt: JETZT }));
  assert.equal(e.status, 413);
  assert.deepEqual(readdirSync(join(d, "_anhaenge")), [s.name], "nichts Halbes bleibt liegen");
  const gross = A.speichereAnhang({ wurzel: d, name: "x.pdf", buf: Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]), einstellungen: {}, jetzt: JETZT });
  assert.equal(gross.gross, true);
});

test("speichereAnhang: kein Schreiben über eine Verknüpfung aus dem Vault heraus", async (t) => {
  const d = vault(), aussen = tmp("anh-aussen-");
  try { symlinkSync(aussen, join(d, "_anhaenge"), "junction"); } catch { return t.skip("keine Verknüpfungen möglich"); }
  await fehler(() => A.speichereAnhang({ wurzel: d, name: "x.png", buf: PNG, einstellungen: {}, jetzt: JETZT }));
  assert.deepEqual(readdirSync(aussen), []);
});

// ───────────────────────────── Auflösen ─────────────────────────────

test("loeseAnhang: Name (Notiz-Ordner, Anhänge-Ordner, überall), relative Pfade, nie außerhalb, nur Anhang-Typen", (t) => {
  const d = vault({ "n/x.md": "# X\n" });
  schreibe(d, "_anhaenge/a.png", PNG); schreibe(d, "n/lokal.png", PNG); schreibe(d, "n/_anhaenge/b.png", PNG); schreibe(d, "tief/er/c.pdf", PDF);
  schreibe(d, "n/f.png", PNG); schreibe(d, "z/f.png", PNG);
  const r = (ziel, von = "n/x.md") => A.loeseAnhang(d, { von, ziel })?.rel ?? null;
  assert.equal(r("a.png"), "_anhaenge/a.png");
  assert.equal(r("A.PNG"), "_anhaenge/a.png", "Groß/klein egal");
  assert.equal(r("lokal.png"), "n/lokal.png");
  assert.equal(r("b.png"), "n/_anhaenge/b.png");
  assert.equal(r("c.pdf"), "tief/er/c.pdf", "irgendwo im Vault");
  assert.equal(r("f.png"), "n/f.png", "der Ordner der Notiz geht vor");
  assert.equal(r("f.png", "z/y.md"), "z/f.png");
  assert.equal(r("../_anhaenge/a.png"), "_anhaenge/a.png", "relativ zur Notiz");
  assert.equal(r("_anhaenge/a.png"), "_anhaenge/a.png", "ab Vault-Wurzel");
  assert.equal(r("tief/er/c.pdf"), "tief/er/c.pdf");
  assert.equal(r("fehlt.png"), null);
  for (const schlecht of ["../../etc/passwd.png", "../../../x.png", "/etc/hosts.png", "brain.config.json", "n/x.md", ".kortex-lokal/x.png", "https://e.example/a.png", "a.png\0", "", "n/"]) assert.equal(r(schlecht), null, schlecht);
  const aussen = tmp("anh-aussen-"); writeFileSync(join(aussen, "geheim.png"), PNG);
  try { symlinkSync(join(aussen, "geheim.png"), join(d, "n/link.png")); } catch { return t.skip("keine Verknüpfungen möglich (der Rest ist geprüft)"); }
  assert.equal(r("link.png"), null, "eine Verknüpfung aus dem Vault heraus wird nicht ausgeliefert");
});

test("anhangZieleIn: Wikilink und Markdown, nicht in Code und nicht im Kopf", () => {
  const t = "---\nbild: ![[kopf.png]]\n---\n![[a.png]] ![b](bilder/b%20c.png) [pdf](d.pdf) [[Notiz]] ![x](https://e.example/e.png)\n`![[code.png]]`\n```\n![[block.png]]\n```\n";
  assert.deepEqual(A.anhangZieleIn(t), [{ ziel: "a.png", art: "wiki" }, { ziel: "bilder/b c.png", art: "md" }, { ziel: "d.pdf", art: "md" }]);
});

test("Notiz-Index: Anhänge sind keine Links auf Notizen (kein „offener Link“ für ![[bild.png]])", async () => {
  const { wikilinkZiele } = await import(pfad("gemeinsam", "notizen.mjs"));
  assert.deepEqual(wikilinkZiele("![[a.png]] [[Notiz]] ![[b.pdf|x]] [[Ordner/Seite#Kopf]] ![[Einbettung]]"), ["Notiz", "Ordner/Seite", "Einbettung"]);
});

test("unbenutzteAnhaenge: nur, was keine andere Notiz benutzt", () => {
  const d = vault({
    "a.md": "# A\n![[nur-a.png]] ![[geteilt.png]] ![](bilder/nur-a2.png) ![](https://e.example/x.png)\n",
    "b.md": "# B\n![[geteilt.png]]\n",
    "c.md": "# C\nkein Bild\n",
  });
  schreibe(d, "_anhaenge/nur-a.png", PNG); schreibe(d, "_anhaenge/geteilt.png", PNG); schreibe(d, "bilder/nur-a2.png", PNG); schreibe(d, "_anhaenge/frei.png", PNG);
  const u = A.unbenutzteAnhaenge({ wurzel: d, notiz: "a.md", einstellungen: {} });
  assert.deepEqual(u.map((x) => x.pfad).sort(), ["_anhaenge/nur-a.png", "bilder/nur-a2.png"]);
  assert.equal(u[0].art, "bild"); assert.ok(u[0].groesse > 0);
  assert.deepEqual(A.unbenutzteAnhaenge({ wurzel: d, notiz: "c.md", einstellungen: {} }), []);
  assert.deepEqual(A.unbenutzteAnhaenge({ wurzel: d, notiz: "fehlt.md", einstellungen: {} }), []);
  // Ein Link in einem Code-Block zählt nicht als Benutzung
  writeFileSync(join(d, "c.md"), "# C\n```\n![[nur-a.png]]\n```\n");
  assert.equal(A.unbenutzteAnhaenge({ wurzel: d, notiz: "a.md", einstellungen: {} }).length, 2);
  writeFileSync(join(d, "c.md"), "# C\n![[nur-a.png]]\n");
  assert.deepEqual(A.unbenutzteAnhaenge({ wurzel: d, notiz: "a.md", einstellungen: {} }).map((x) => x.pfad), ["bilder/nur-a2.png"]);
});

// ───────────────────────────── Umbenennen und Verschieben ─────────────────────────────

test("Umbenennen/Verschieben: Einbettungen bleiben gültig (Name) und Pfade werden nachgezogen", async () => {
  const d = vault({
    "alt/n.md": "# N\n![[2026-bild.png]]\n![rel](../bilder/rel.png)\n![[bilder/pfad.png]]\n![ext](https://e.example/x.png)\n",
    "bilder/x.md": "# Anderes\n![[2026-bild.png]]\n",
  });
  schreibe(d, "_anhaenge/2026-bild.png", PNG); schreibe(d, "bilder/rel.png", PNG); schreibe(d, "bilder/pfad.png", PNG);
  const v = oeffneVault(d, { support: tmp("anh-support-"), heute: "2026-11-07" });
  const loest = (von, ziel) => A.loeseAnhang(d, { von, ziel })?.rel ?? null;
  // Notiz verschieben: der Name löst weiter auf, der relative Pfad zeigt danach auf dieselbe Datei
  await v.verschieben({ pfad: "alt/n.md", typ: "datei", ziel: "tief/ordner" }).catch(async () => { mkdirSync(join(d, "tief/ordner"), { recursive: true }); return v.verschieben({ pfad: "alt/n.md", typ: "datei", ziel: "tief/ordner" }); });
  const text = readFileSync(join(d, "tief/ordner/n.md"), "utf8");
  assert.ok(text.includes("![[2026-bild.png]]"), text);
  assert.ok(text.includes("![rel](../../bilder/rel.png)"), text);
  assert.equal(loest("tief/ordner/n.md", "2026-bild.png"), "_anhaenge/2026-bild.png");
  assert.equal(loest("tief/ordner/n.md", "../../bilder/rel.png"), "bilder/rel.png");
  assert.equal(loest("tief/ordner/n.md", "bilder/pfad.png"), "bilder/pfad.png");
  // Umbenennen der Notiz ändert nichts an den Bildern
  await v.umbenennen({ pfad: "tief/ordner/n.md", typ: "datei", dateiname: "neu.md" });
  const neu = readFileSync(join(d, "tief/ordner/neu.md"), "utf8");
  assert.ok(neu.includes("![[2026-bild.png]]") && neu.includes("![rel](../../bilder/rel.png)") && neu.includes("![ext](https://e.example/x.png)"), neu);
  // Der Ordner mit den Bildern zieht um: Pfad-Einbettungen und Markdown-Bilder folgen, die Einbettung über den Namen braucht nichts
  await v.umbenennen({ pfad: "bilder", typ: "ordner", name: "medien" });
  const nach = readFileSync(join(d, "tief/ordner/neu.md"), "utf8");
  assert.ok(nach.includes("![rel](../../medien/rel.png)") && nach.includes("![[medien/pfad.png]]") && nach.includes("![[2026-bild.png]]"), nach);
  assert.equal(readFileSync(join(d, "medien/x.md"), "utf8").includes("![[2026-bild.png]]"), true);
  assert.equal(loest("tief/ordner/neu.md", "../../medien/rel.png"), "medien/rel.png");
});

test("Löschen: Anhänge gehen in den Papierkorb und lassen sich zurückholen; nur mit anhang:true, nur Anhang-Typen", async () => {
  const d = vault({ "n.md": "# N\n![[a.png]]\n" });
  schreibe(d, "_anhaenge/a.png", PNG);
  const v = oeffneVault(d, { support: tmp("anh-support-"), heute: "2026-11-07" });
  assert.equal((await fehler(() => v.loeschen({ pfad: "_anhaenge/a.png", typ: "datei" }))).status, 415, "ohne anhang:true kein Weg an Notizen vorbei");
  assert.equal((await fehler(() => v.loeschen({ pfad: "brain.config.json", typ: "datei", anhang: true }))).status, 415);
  assert.equal((await fehler(() => v.verschieben({ pfad: "_anhaenge/a.png", typ: "datei", ziel: "x", anhang: true }))).status, 415);
  const r = await v.loeschen({ pfad: "_anhaenge/a.png", typ: "datei", anhang: true });
  assert.ok(r.ok && r.vorgang);
  assert.ok(!existsSync(join(d, "_anhaenge/a.png")), "aus dem Vault verschwunden");
  const korb = await v.papierkorb();
  const eintrag = korb.eintraege.find((e) => e.pfad === "_anhaenge/a.png");
  assert.ok(eintrag, "liegt im Papierkorb");
  const zurueck = await v.papierkorbWiederherstellen({ id: eintrag.id });
  assert.ok(zurueck.ok !== false);
  assert.ok(readFileSync(join(d, "_anhaenge/a.png")).equals(PNG), "Bytes unverändert zurück");
});

// ───────────────────────────── Routen der Werkstatt ─────────────────────────────

const studio = () => { const s = tmp("anh-studio-"); schreibe(s, "index.html", "<!doctype html>"); return s; };
function server(dateien = {}, einst = null) {
  const d = vault(dateien), support = tmp("anh-support-");
  if (einst) writeFileSync(join(support, "einstellungen.json"), JSON.stringify(einst));
  const h = erzeugeHandler({ vault: d, studioDir: studio(), appVersion: "9.9.9", vaultOptionen: { support } });
  const rufe = async (methode, p, daten, query) => {
    const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* Binär */ }
    return { ...r, j };
  };
  const lade = async (buf, name, notiz = "") => {
    const s = await rufe("POST", "/api/anhang/start", { name, groesse: buf.length, ...(notiz ? { notiz } : {}) });
    if (s.status !== 200) return s;
    const stueck = 1000;
    for (let nr = 0, o = 0; o < buf.length; nr++, o += stueck) {
      const t = await rufe("POST", "/api/anhang/teil", { id: s.j.id, nr, daten: buf.subarray(o, o + stueck).toString("base64") });
      assert.equal(t.status, 200, JSON.stringify(t.j));
    }
    return rufe("POST", "/api/anhang/ende", { id: s.j.id });
  };
  return { d, support, rufe, lade, h };
}

test("Werkstatt: Hochladen in Stücken, Ausliefern mit sicheren Kopfzeilen, 404 für alles andere", async () => {
  const w = server({ "n/x.md": "# X\n" });
  const png = Buffer.concat([PNG, Buffer.alloc(3500, 7)]); // mehrere Stücke; Bytes hinter dem Ende stören ein PNG nicht
  const e = await w.lade(png, "Screenshot.png", "n/x.md");
  assert.equal(e.status, 200, JSON.stringify(e.j));
  assert.match(e.j.pfad, /^_anhaenge\/\d{4}-\d{2}-\d{2}-\d{6}-screenshot\.png$/);
  assert.equal(e.j.einbettung, `![[${e.j.name}]]`);
  assert.ok(readFileSync(join(w.d, e.j.pfad)).equals(png));
  const g = await w.rufe("GET", "/_anhang", undefined, new URLSearchParams({ ziel: e.j.name, von: "n/x.md" }));
  assert.equal(g.status, 200);
  assert.equal(g.headers["Content-Type"], "image/png");
  assert.equal(g.headers["X-Content-Type-Options"], "nosniff");
  assert.match(g.headers["Content-Security-Policy"], /^sandbox;/);
  assert.match(g.headers["Content-Disposition"], /^inline;/);
  assert.ok(g.body.equals(png));
  for (const q of [{ ziel: "fehlt.png" }, { ziel: "brain.config.json" }, { ziel: "../../etc/passwd.png" }, { ziel: "n/x.md" }, {}]) assert.equal((await w.rufe("GET", "/_anhang", undefined, new URLSearchParams(q))).status, 404, JSON.stringify(q));
  assert.equal((await w.rufe("POST", "/_anhang")).status, 405);
});

test("Werkstatt: PDF wird als Chip-Datei abgelegt und beim Ausliefern nicht inline gezeigt (Office), PDF inline", async () => {
  const w = server();
  const p = await w.lade(PDF, "Rechnung 2026.pdf");
  assert.equal(p.status, 200); assert.equal(p.j.art, "datei");
  const g = await w.rufe("GET", "/_anhang", undefined, new URLSearchParams({ ziel: p.j.name }));
  assert.equal(g.headers["Content-Type"], "application/pdf"); assert.match(g.headers["Content-Disposition"], /^inline; filename="[\x20-\x7e]+"$/);
  const z = await w.lade(ZIP, "Daten.docx");
  const gz = await w.rufe("GET", "/_anhang", undefined, new URLSearchParams({ ziel: z.j.name }));
  assert.match(gz.headers["Content-Disposition"], /^attachment;/);
});

test("Werkstatt: Grenzen mit Hinweis (zu groß, falscher Typ, leer, unvollständig, abgelaufen, falsche Reihenfolge)", async () => {
  const w = server({}, { anhaengeMaxMB: 1 });
  const gross = await w.rufe("POST", "/api/anhang/start", { name: "x.png", groesse: 3 * 1024 * 1024 });
  assert.equal(gross.status, 413); assert.match(gross.j.fehler, /3 MB/); assert.match(gross.j.fehler, /1 MB/); assert.equal(gross.j.art, "zu-gross");
  const exe = await w.rufe("POST", "/api/anhang/start", { name: "setup.exe", groesse: 10 });
  assert.equal(exe.status, 415); assert.equal(exe.j.art, "typ");
  assert.equal((await w.rufe("POST", "/api/anhang/start", { name: "x.png", groesse: 0 })).status, 400);
  assert.equal((await w.rufe("POST", "/api/anhang/start", { name: "x.png" })).status, 400);
  assert.equal((await w.lade(Buffer.from("<html>"), "falsch.png")).status, 415, "Inhalt kein Bild");
  const s = await w.rufe("POST", "/api/anhang/start", { name: "x.png", groesse: 100 });
  assert.equal((await w.rufe("POST", "/api/anhang/teil", { id: s.j.id, nr: 1, daten: "AAAA" })).status, 400, "Reihenfolge");
  await w.rufe("POST", "/api/anhang/teil", { id: s.j.id, nr: 0, daten: Buffer.alloc(10).toString("base64") });
  assert.equal((await w.rufe("POST", "/api/anhang/ende", { id: s.j.id })).status, 400, "unvollständig");
  assert.equal((await w.rufe("POST", "/api/anhang/ende", { id: s.j.id })).status, 410, "die Sitzung ist danach weg");
  const s2 = await w.rufe("POST", "/api/anhang/start", { name: "y.png", groesse: 5 });
  assert.equal((await w.rufe("POST", "/api/anhang/teil", { id: s2.j.id, nr: 0, daten: Buffer.alloc(9).toString("base64") })).status, 400, "mehr als angekündigt");
  assert.equal((await w.rufe("POST", "/api/anhang/teil", { id: "gibtsnicht", nr: 0, daten: "AAAA" })).status, 410);
  assert.equal((await w.rufe("POST", "/api/anhang/teil", { id: s2.j.id, nr: 0, daten: "keine base64 !!" })).status, 410, "Sitzung nach Fehler weg");
});

test("Werkstatt: eigener Ort und Ordner aus den Einstellungen; SVG kommt bereinigt an und wird bereinigt ausgeliefert", async () => {
  const w = server({ "a/n.md": "# N\n" }, { anhaengeOrt: "notiz", anhaengeOrdner: "Medien" });
  const e = await w.lade(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>1</script><rect/></svg>'), "logo.svg", "a/n.md");
  assert.equal(e.status, 200);
  assert.match(e.j.pfad, /^a\/Medien\/\d{4}-\d{2}-\d{2}-\d{6}-logo\.svg$/);
  assert.ok(!/script|onload/.test(readFileSync(join(w.d, e.j.pfad), "utf8")));
  // Von Hand abgelegte, unbereinigte SVG: ausgeliefert wird trotzdem bereinigt
  schreibe(w.d, "a/Medien/hand.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="1"/></svg>');
  const g = await w.rufe("GET", "/_anhang", undefined, new URLSearchParams({ ziel: "hand.svg", von: "a/n.md" }));
  assert.equal(g.status, 200); assert.equal(g.headers["Content-Type"], "image/svg+xml");
  assert.ok(g.body.toString().includes("<circle") && !g.body.toString().includes("script"));
  schreibe(w.d, "a/Medien/kaputt.svg", "<html>kein svg</html>");
  assert.equal((await w.rufe("GET", "/_anhang", undefined, new URLSearchParams({ ziel: "kaputt.svg", von: "a/n.md" }))).status, 404);
});

test("Werkstatt: Rückfrage beim Löschen einer Notiz (unbenutzt) und Löschen in den Papierkorb", async () => {
  const w = server({ "a.md": "# A\n![[nur-a.png]] ![[geteilt.png]]\n", "b.md": "# B\n![[geteilt.png]]\n" });
  schreibe(w.d, "_anhaenge/nur-a.png", PNG); schreibe(w.d, "_anhaenge/geteilt.png", PNG);
  const u = await w.rufe("GET", "/api/anhang/unbenutzt", undefined, new URLSearchParams({ pfad: "a.md" }));
  assert.deepEqual(u.j.anhaenge.map((x) => x.pfad), ["_anhaenge/nur-a.png"]);
  assert.equal((await w.rufe("GET", "/api/anhang/unbenutzt")).status, 400);
  const l = await w.rufe("POST", "/api/anhang/loeschen", { pfade: ["_anhaenge/nur-a.png"] });
  assert.equal(l.status, 200); assert.equal(l.j.ok, true);
  assert.ok(!existsSync(join(w.d, "_anhaenge/nur-a.png")) && existsSync(join(w.d, "_anhaenge/geteilt.png")));
  const korb = await w.rufe("GET", "/api/papierkorb");
  assert.ok(korb.j.eintraege.some((e) => e.pfad === "_anhaenge/nur-a.png"), "im Papierkorb, nicht endgültig gelöscht");
  // Nicht-Anhänge und fremde Pfade lehnt die Route je Eintrag ab
  const schlecht = await w.rufe("POST", "/api/anhang/loeschen", { pfade: ["a.md", "../x.png", "brain.config.json"] });
  assert.equal(schlecht.j.ok, false); assert.ok(schlecht.j.ergebnisse.every((x) => !x.ok));
  assert.ok(existsSync(join(w.d, "a.md")) && existsSync(join(w.d, "brain.config.json")));
  assert.equal((await w.rufe("POST", "/api/anhang/loeschen", { pfade: [] })).status, 400);
  // Über die Notiz-Route lässt sich ein Anhang nicht löschen, auch nicht mit anhang:true
  const x = await w.rufe("POST", "/api/notiz/loeschen", { pfad: "_anhaenge/geteilt.png", anhang: true });
  assert.equal(x.status, 415); assert.ok(existsSync(join(w.d, "_anhaenge/geteilt.png")));
});

test("Werkstatt: ohne Vault geht nichts (409), /_anhang antwortet 404", async () => {
  const h = erzeugeHandler({ vault: null, studioDir: studio(), appVersion: "9.9.9", vaultOptionen: { support: tmp("anh-support-") } });
  const r = await h({ methode: "POST", pfad: "/api/anhang/start", query: null, body: Buffer.from(JSON.stringify({ name: "x.png", groesse: 5 })) });
  assert.equal(r.status, 409);
  assert.equal((await h({ methode: "GET", pfad: "/_anhang", query: "ziel=x.png" })).status, 404);
});

// ───────────────────────────── Externe Bilder ─────────────────────────────

test("IP-Prüfung: privat, Loopback, Link-Local, Carrier und Dokumentation sind nicht öffentlich", () => {
  for (const nein of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "2001:db8::1", "keine ip", ""]) assert.equal(A.istOeffentlicheIp(nein), false, nein);
  for (const ja of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(A.istOeffentlicheIp(ja), true, ja);
});

function bildServer(routen) {
  const s = http.createServer((req, res) => { const f = routen[req.url.split("?")[0]]; if (f) f(req, res); else { res.statusCode = 404; res.end("nein"); } });
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok({ port: s.address().port, basis: `http://127.0.0.1:${s.address().port}`, schliesse: () => new Promise((z) => { s.closeAllConnections?.(); s.close(z); }) })));
}
const liefere = (typ, body) => (req, res) => { res.setHeader("Content-Type", typ); res.end(body); };

test("Externe Bilder: ohne Erlaubnis nur https und nie private Adressen; mit Test-Erlaubnis lokal", async () => {
  for (const [adresse, status] of [["http://example.org/a.png", 400], ["ftp://example.org/a.png", 400], ["file:///etc/passwd", 400], ["javascript:alert(1)", 400], ["nonsense", 400], ["https://user:pass@example.org/a.png", 400],
    ["https://127.0.0.1/a.png", 403], ["https://[::1]/a.png", 403], ["https://10.0.0.5/a.png", 403], ["https://169.254.169.254/latest/meta-data", 403], ["https://localhost/a.png", 403], ["https://drucker.local/a.png", 403], ["https://intern.internal/a.png", 403]]) {
    assert.equal((await fehler(() => A.holeExternBild(adresse))).status, status, adresse);
  }
  const b = await bildServer({ "/a.png": liefere("image/png", PNG), "/html": liefere("text/html", "<script>alert(1)</script>"), "/falsch.png": liefere("image/png", "<html>"), "/svg": liefere("image/svg+xml", SVG),
    "/gross": liefere("image/png", Buffer.concat([PNG, Buffer.alloc(2000)])), "/weg": (req, res) => { res.statusCode = 302; res.setHeader("Location", "/a.png"); res.end(); },
    "/intern": (req, res) => { res.statusCode = 302; res.setHeader("Location", "http://127.0.0.1:1/x.png"); res.end(); }, "/schleife": (req, res) => { res.statusCode = 302; res.setHeader("Location", "/schleife"); res.end(); } });
  try {
    assert.equal((await fehler(() => A.holeExternBild(`${b.basis}/a.png`))).status, 400, "http ohne Erlaubnis");
    const o = { erlaubeLokal: true };
    const r = await A.holeExternBild(`${b.basis}/a.png`, o);
    assert.equal(r.typ, "image/png"); assert.ok(r.body.equals(PNG));
    assert.equal((await A.holeExternBild(`${b.basis}/svg`, o)).typ, "image/svg+xml");
    assert.equal((await A.holeExternBild(`${b.basis}/weg`, o)).typ, "image/png", "Weiterleitung folgt");
    assert.equal((await fehler(() => A.holeExternBild(`${b.basis}/html`, o))).status, 415, "kein Bildtyp");
    assert.equal((await fehler(() => A.holeExternBild(`${b.basis}/falsch.png`, o))).status, 415, "Typ gesagt, Inhalt kein Bild");
    assert.equal((await fehler(() => A.holeExternBild(`${b.basis}/gross`, { ...o, maxBytes: 500 }))).status, 413);
    assert.equal((await fehler(() => A.holeExternBild(`${b.basis}/schleife`, o))).status, 502, "zu viele Weiterleitungen");
    assert.equal((await fehler(() => A.holeExternBild(`${b.basis}/fehlt`, o))).status, 502);
  } finally { await b.schliesse(); }
});

test("Externe Bilder: Weiterleitung auf eine private Adresse wird abgelehnt (ohne Erlaubnis nie erreichbar)", async () => {
  // Der Server ist lokal; ohne erlaubeLokal kommt man gar nicht erst hin: schon die erste Adresse scheitert an der Prüfung
  const b = await bildServer({ "/a.png": liefere("image/png", PNG) });
  try { assert.equal((await fehler(() => A.holeExternBild(`https://127.0.0.1:${b.port}/a.png`))).status, 403); } finally { await b.schliesse(); }
});

test("Werkstatt: /_extern-bild ohne Test-Erlaubnis nie lokal, mit BRAIN_EXTERN_LOKAL liefert Bilder mit sicheren Kopfzeilen", async () => {
  const w = server();
  const b = await bildServer({ "/a.png": liefere("image/png", PNG) });
  try {
    const nein = await w.rufe("GET", "/_extern-bild", undefined, new URLSearchParams({ url: `${b.basis}/a.png` }));
    assert.ok(nein.status >= 400, "ohne die Test-Erlaubnis geht http und Loopback nicht");
    process.env.BRAIN_EXTERN_LOKAL = "1";
    try {
      const ja = await w.rufe("GET", "/_extern-bild", undefined, new URLSearchParams({ url: `${b.basis}/a.png` }));
      assert.equal(ja.status, 200); assert.equal(ja.headers["Content-Type"], "image/png"); assert.match(ja.headers["Content-Security-Policy"], /sandbox/); assert.equal(ja.headers["X-Content-Type-Options"], "nosniff");
      assert.ok(ja.body.equals(PNG));
    } finally { delete process.env.BRAIN_EXTERN_LOKAL; }
    assert.equal((await w.rufe("GET", "/_extern-bild", undefined, new URLSearchParams({ url: "" }))).status, 400);
  } finally { await b.schliesse(); }
});

after(() => { delete process.env.BRAIN_EXTERN_LOKAL; });
