// Export (gemeinsam/export.mjs): Markdown-Bündel mit Bildern, eigenständiges HTML, Fragment, ZIP, Sicherheit (kein rohes HTML, keine Netz- oder fremden Bilder). Nur Wegwerf-Ordner (tmp).
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const E = await import(pfad("gemeinsam", "export.mjs"));
const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
function aufbau() {
  const d = tmp("exp-vault-"), support = tmp("exp-support-"), aussen = tmp("exp-aussen-");
  schreibe(d, "brain.config.json", "{}\n");
  writeFileSync(join(aussen, "geheim.png"), "GEHEIM");
  mkdirSync(join(d, "n/bilder"), { recursive: true });
  writeFileSync(join(d, "n/bilder/a.png"), PNG);
  writeFileSync(join(d, "n/bilder/gross name.png"), Buffer.concat([PNG, Buffer.from("x")]));
  try { symlinkSync(join(aussen, "geheim.png"), join(d, "n/bilder/link.png")); } catch { /* Windows ohne Symlink-Recht: das Bild fehlt dann, der Export lässt den Verweis unberührt */ }
  schreibe(d, "n/eins.md", "---\ntitle: Eins\ntags: [t]\n---\n# Eins\n\nText ![Bild A](bilder/a.png) und ![[gross name.png|200]] und ![x](../../geheim.png) ![y](bilder/link.png) ![z](https://evil.example/p.png) ![w](bilder/fehlt.png)\n\n```\n![code](bilder/a.png)\n```\n");
  schreibe(d, "n/zwei.md", "Ohne Überschrift #tag\n\n![nochmal](bilder/a.png)\n");
  schreibe(d, "n/unter/drei.md", "# Drei\n\n![hoch](../bilder/a.png)\n");
  schreibe(d, "n/_index.md", "# generiert\n");
  schreibe(d, "09_wiki/_index.md", "# generiert\n");
  schreibe(d, ".versteckt/x.md", "# x\n");
  const v = oeffneVault(d, { support, heute: "2026-11-05" });
  return { d, support, v, aussen };
}

test("markdownZuHtml: Block- und Inline-Elemente", () => {
  const h = E.markdownZuHtml("# T\n\nA **b** *c* ~~d~~ ==e== `f<g>` [l](https://x.de) #tag [[W|Alias]]\n\n- [x] a\n  - b\n- [ ] c\n\n3. x\n4. y\n\n> q\n> > innen\n\n| A | B |\n| :-- | --: |\n| 1 | 2 |\n\n---\n");
  for (const teil of ["<h1>T</h1>", "<strong>b</strong>", "<em>c</em>", "<del>d</del>", "<mark>e</mark>", "<code>f&lt;g&gt;</code>", '<a href="https://x.de">l</a>', '<span class="tag">#tag</span>', '<span class="wiki">Alias</span>', '<input type="checkbox" disabled checked>', '<ol start="3">', "<blockquote><p>q</p>", 'style="text-align:right"', "<hr>"]) assert.ok(h.includes(teil), teil + "\n" + h);
});
test("markdownZuHtml: kein rohes HTML, keine gefährlichen Links, Bilder nur über den Auflöser", () => {
  const h = E.markdownZuHtml("<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c](vbscript:x) ![d](https://evil.example/x.png) <https://ok.de>\n\n[e](https://x.de \"t\")\n");
  assert.doesNotMatch(h, /<script|<img src=x|href="javascript|href="data|href="vbscript|<img/i);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /href="https:\/\/ok\.de"/);
  assert.match(h, /bild-fehlt/);
});
test("markdownZuHtml: Code-Zäune und Setext-Überschriften, Aufzählungen nach Absatz", () => {
  const h = E.markdownZuHtml("Titel\n=====\n\nUnter\n-----\n\n~~~py\n# kein Heading\n**nicht fett**\n~~~\n\nAbsatz\n- Punkt\n");
  assert.match(h, /<h1>Titel<\/h1>/); assert.match(h, /<h2>Unter<\/h2>/);
  assert.match(h, /<pre><code class="language-py"># kein Heading\n\*\*nicht fett\*\*<\/code><\/pre>/);
  assert.match(h, /<p>Absatz<\/p>\n<ul><li>Punkt<\/li><\/ul>/);
});
test("zipBauen: gültiges Archiv (Einträge lesbar, CRC passt)", () => {
  const zip = E.zipBauen([{ pfad: "a.txt", daten: Buffer.from("hallo ".repeat(50)) }, { pfad: "ü/b.png", daten: PNG }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const ende = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(zip.readUInt16LE(ende + 10), 2);
  const zb = zip.readUInt32LE(ende + 16);
  assert.equal(zip.readUInt32LE(zb), 0x02014b50);
  const methode = zip.readUInt16LE(zb + 10), gr = zip.readUInt32LE(zb + 20), ur = zip.readUInt32LE(zb + 24), off = zip.readUInt32LE(zb + 42);
  const nl = zip.readUInt16LE(off + 26);
  const daten = zip.subarray(off + 30 + nl, off + 30 + nl + gr);
  assert.equal(methode, 8);
  assert.equal(inflateRawSync(daten).toString(), "hallo ".repeat(50));
  assert.equal(ur, 300);
});

test("Markdown-Export einer Notiz: .md mit bilder/-Dateien daneben, Verweise umgeschrieben, Code bleibt, fremde und fehlende Bilder bleiben unberührt und gemeldet", () => {
  const { v } = aufbau();
  const r = v.exportiere({ pfade: ["n/eins.md"], format: "markdown" });
  assert.equal(r.ok, true); assert.equal(r.name, "Eins.md"); assert.equal(r.haupt, "Eins.md"); assert.equal(r.ordner, false);
  const md = r.dateien.find((x) => x.pfad === "Eins.md").text;
  assert.match(md, /^---\ntitle: Eins/, "Kopf bleibt");
  const bilder = r.dateien.filter((x) => x.pfad.startsWith("bilder/"));
  assert.equal(bilder.length, 2);
  assert.ok(bilder.every((b) => /^bilder\/[0-9a-f]{8}-[^/ ]+\.png$/.test(b.pfad) && b.base64));
  assert.match(md, /!\[Bild A\]\(bilder\/[0-9a-f]{8}-a\.png\)/);
  assert.match(md, /!\[\]\(bilder\/[0-9a-f]{8}-gross-name\.png\)/);
  assert.match(md, /!\[x\]\(\.\.\/\.\.\/geheim\.png\)/); // außerhalb: unverändert
  assert.match(md, /!\[y\]\(bilder\/link\.png\)/, "Symlink aus dem Vault hinaus wird nicht kopiert");
  assert.match(md, /!\[z\]\(https:\/\/evil\.example\/p\.png\)/);
  assert.match(md, /```\n!\[code\]\(bilder\/a\.png\)\n```/, "im Code bleibt es");
  assert.ok(r.hinweise.some((h) => /fehlt\.png/.test(h)));
  assert.ok(!r.dateien.some((x) => x.base64 && Buffer.from(x.base64, "base64").toString().includes("GEHEIM")));
});

test("Markdown-Export eines Ordners: Struktur, gemeinsamer bilder/-Ordner, relative Pfade nach oben, generierte und versteckte Dateien fehlen", () => {
  const { v } = aufbau();
  const r = v.exportiere({ ordner: "n", format: "markdown" });
  assert.equal(r.ordner, true); assert.equal(r.name, "n");
  const namen = r.dateien.map((x) => x.pfad).sort();
  assert.deepEqual(namen.filter((p) => p.endsWith(".md")), ["n/eins.md", "n/unter/drei.md", "n/zwei.md"]);
  assert.equal(namen.filter((p) => p.startsWith("n/bilder/")).length, 2, "a.png nur einmal, auch wenn drei Notizen es nutzen");
  assert.match(r.dateien.find((x) => x.pfad === "n/unter/drei.md").text, /!\[hoch\]\(\.\.\/bilder\//);
  assert.match(r.dateien.find((x) => x.pfad === "n/zwei.md").text, /!\[nochmal\]\(bilder\//);
  assert.equal(r.notizen, 3);
});

test("HTML-Export: eine eigenständige Datei, Bilder und Schrift eingebettet, nichts Externes, helles Layout, Titel ohne Kopf", () => {
  const { v } = aufbau();
  const r = v.exportiere({ pfade: ["n/eins.md"], format: "html", schrift: "serif" });
  assert.equal(r.dateien.length, 1); assert.equal(r.name, "Eins.html");
  const h = r.dateien[0].text;
  assert.match(h, /^<!doctype html>/);
  assert.match(h, /<title>Eins<\/title>/);
  assert.match(h, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="Bild A">/);
  assert.match(h, /width="200"/);
  assert.match(h, /ui-serif/);
  assert.doesNotMatch(h, /<link |<script|@import|src="https?:|url\(https?:/i);
  assert.doesNotMatch(h, /title: Eins|tags: \[t\]/, "Kopf wird nicht ausgegeben");
  assert.match(h, /color-scheme:light/);
  assert.match(h, /@page/);
  const g = v.exportiere({ pfade: ["n/eins.md"], format: "html", schrift: "geist" }).dateien[0].text;
  assert.match(g, /@font-face\{font-family:"Geist".*data:font\/woff2;base64,/s);
  assert.doesNotMatch(v.exportiere({ pfade: ["n/eins.md"], format: "html", schrift: "unbekannt<>" }).dateien[0].text, /unbekannt/);
});

test("HTML-Export mehrerer Notizen: Inhaltsverzeichnis, Abschnitte, Titel aus Dateiname wenn keine Überschrift", () => {
  const { v } = aufbau();
  const r = v.exportiere({ pfade: ["n/eins.md", "n/zwei.md"], format: "html" });
  const h = r.dateien[0].text;
  assert.match(h, /<nav class="inhalt">.*<li>Eins<\/li><li>zwei<\/li>/s);
  assert.equal((h.match(/<section class="notiz">/g) || []).length, 2);
  assert.match(h, /<h1>zwei<\/h1>/);
  assert.equal(r.name, "Kortex-Export.html");
});

test("Fragment (formatiert kopieren): nur der Körper, mit Bildern als data:", () => {
  const { v } = aufbau();
  const r = v.exportiere({ pfade: ["n/eins.md"], format: "fragment" });
  assert.ok(!r.dateien);
  assert.match(r.html, /^<h1>Eins<\/h1>/);
  assert.doesNotMatch(r.html, /<html|<style/);
  assert.match(r.html, /data:image\/png/);
});

test("ZIP-Export: ein Archiv statt mehrerer Dateien (für den Browser)", () => {
  const { v } = aufbau();
  const r = v.exportiere({ ordner: "n", format: "markdown", zip: true });
  assert.equal(r.dateien.length, 1); assert.equal(r.dateien[0].pfad, "n.zip");
  assert.equal(Buffer.from(r.dateien[0].base64, "base64").readUInt32LE(0), 0x04034b50);
});

test("Fehlerfälle: unbekanntes Format, kein Pfad, Pfad außerhalb, versteckter Ordner, Nicht-Notiz, ungültige Anfrage", () => {
  const { v } = aufbau();
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e.status; } return 0; };
  assert.equal(code(() => v.exportiere({ pfade: ["n/eins.md"], format: "pdf" })), 400);
  assert.equal(code(() => v.exportiere({ format: "html" })), 400);
  assert.equal(code(() => v.exportiere({ pfade: ["../x.md"], format: "html" })), 403);
  assert.equal(code(() => v.exportiere({ pfade: [".versteckt/x.md"], format: "html" })), 403);
  assert.equal(code(() => v.exportiere({ pfade: ["n/bilder/a.png"], format: "html" })), 415);
  assert.equal(code(() => v.exportiere({ ordner: "gibtsnicht", format: "html" })), 404);
  assert.equal(code(() => v.exportiere(null)), 400);
});

test("Route POST /api/export: Bündel als JSON, nur POST", async () => {
  const { d, support } = aufbau();
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { modus: "poll", pollMs: 80, entprellMs: 40 } });
  const a = await h({ methode: "POST", pfad: "/api/export", query: null, body: Buffer.from(JSON.stringify({ pfade: ["n/zwei.md"], format: "markdown" })) });
  assert.equal(a.status, 200);
  assert.equal(JSON.parse(a.body.toString()).dateien[0].pfad, "zwei.md");
  assert.equal((await h({ methode: "GET", pfad: "/api/export", query: null })).status, 405);
});
