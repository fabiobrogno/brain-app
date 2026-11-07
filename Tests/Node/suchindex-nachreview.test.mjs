// Suchindex: Befunde des zweiten Reviews — veraltete Treffer nach externem Löschen, Teilwort-Suche, Ordnerlauf ohne Blockade, begrenzte Auszüge,
// Seitengrenze, NFD-Markierung, gewachsene Dateien, Obergrenze der Notizen, df nach Änderungen, Markup als Text.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, utimesSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { erzeugeSuchindex } = await import(pfad("gemeinsam", "suchindex.mjs"));
const { falteText, WORT } = await import(pfad("studio", "suchfalte.js"));
const bereit = async (d, o = {}) => { const i = erzeugeSuchindex({ wurzel: d, ...o }); i.starte(); await i.ruhe(); return i; };
const pfade = (r) => r.treffer.map((t) => t.pfad);

test("1 Nach externem Löschen ohne Ereignis: nie gelöschte Dateien als Treffer, auch wenn mehr als `limit` gelöscht sind; gesamt zählt sie nicht", async () => {
  const d = tmp();
  for (let n = 0; n < 100; n++) schreibe(d, `top/p${String(n).padStart(3, "0")}.md`, `# Projekt ${n}\n\nProjekt Projekt Projekt\n`);
  for (let n = 0; n < 40; n++) schreibe(d, `rest/r${n}.md`, `# Notiz ${n}\n\nein Wort: projekt einmal\n`);
  const i = await bereit(d);
  const vorher = i.suche({ q: "projekt", limit: 30 });
  assert.equal(vorher.gesamt, 140);
  assert.ok(pfade(vorher).every((p) => p.startsWith("top/")));
  for (let n = 0; n < 100; n++) unlinkSync(join(d, `top/p${String(n).padStart(3, "0")}.md`)); // ohne aendere(): der Index weiß es nicht
  const r = i.suche({ q: "projekt", limit: 30 });
  assert.equal(r.treffer.length, 30);
  assert.ok(pfade(r).every((p) => p.startsWith("rest/")), pfade(r).join(","));
  assert.equal(r.gesamt, 40);
  assert.equal(r.mehr, true);
  const r2 = i.suche({ q: "projekt", limit: 30, offset: 30 });
  assert.equal(r2.treffer.length, 10); assert.equal(r2.mehr, false);
});

test("2 Teilwörter: Teil eines Kompositums (Steuererklärung), camelCase (userName), CJK-Folgen; genaue Wörter stehen vorn", async () => {
  const d = tmp();
  schreibe(d, "steuer.md", "# Steuer\n\nDie Steuererklärung für 2024 ist fällig.\n");
  schreibe(d, "code.md", "# Code\n\nconst userName = lade(); und getUserName()\n");
  schreibe(d, "erk.md", "# Erklärung\n\nEine Erklärung zur Sache.\n");
  schreibe(d, "cjk.md", "# 日本\n\n私は日本語のテキストを書きます。\n");
  const i = await bereit(d);
  assert.ok(pfade(i.suche({ q: "erklärung" })).includes("steuer.md"), "Kompositum");
  assert.equal(pfade(i.suche({ q: "erklärung" }))[0], "erk.md", "genaues Wort steht vor dem Teilwort");
  assert.ok(pfade(i.suche({ q: "name" })).includes("code.md"), "camelCase");
  assert.deepEqual(pfade(i.suche({ q: "日本語" })), ["cjk.md"]);
  assert.ok(pfade(i.suche({ q: "テキスト" })).includes("cjk.md"), "Teil einer CJK-Folge");
  assert.ok(pfade(i.suche({ q: "語" })).includes("cjk.md"), "einzelnes CJK-Zeichen");
  const t = i.suche({ q: "erklärung" }).treffer.find((x) => x.pfad === "steuer.md");
  assert.ok(t.stellen.length && t.stellen[0].marken.length, "das ganze Wort wird markiert");
});

test("3 Ordnerlauf: ein flacher Ordner mit 20.000 Notizen hält die Ereignisschleife nie lange fest", async () => {
  const d = tmp();
  for (let n = 0; n < 20000; n++) writeFileSync(join(d, `n${n}.md`), `# N ${n}\n\nwort${n % 50}\n`);
  let letzter = performance.now(), maxVerzug = 0;
  const wache = setInterval(() => { const t = performance.now(); maxVerzug = Math.max(maxVerzug, t - letzter - 1); letzter = t; }, 1);
  const i = erzeugeSuchindex({ wurzel: d });
  i.starte();
  const t0 = performance.now(); await i.ruhe(); const bau = performance.now() - t0;
  const verzugBau = maxVerzug;
  letzter = performance.now(); maxVerzug = 0; // Abgleich eines unveränderten Ordners
  i.pruefeNeu(); await i.ruhe();
  clearInterval(wache);
  console.log(`# Ordnerlauf 20000 flach: Aufbau ${Math.round(bau)} ms (Verzug max ${Math.round(verzugBau)} ms), Verzug beim Abgleich max ${Math.round(maxVerzug)} ms`);
  assert.equal(i.stand().dokumente, 20000);
  // Windows: Dateizugriffe und Prozesse sind dort langsamer und der Runner teilt sich die Kerne (gemessen: einzelne Läufe mit 500 ms Verzug beim Abgleich) — die Grenze sichert dort nur „nicht Sekunden“.
  const grenze = Math.max(process.platform === "win32" ? 1500 : 45, bau / 12);
  assert.ok(verzugBau < grenze, `Aufbau: Schleife stand ${verzugBau} ms (Aufbau ${bau} ms)`);
  assert.ok(maxVerzug < grenze, `Abgleich: Schleife stand ${maxVerzug} ms (Aufbau ${bau} ms)`);
});

test("4 Auszüge lesen nur den Anfang großer Dateien und halten ein Zeitbudget ein", async () => {
  const d = tmp();
  const fuell = "füllwort ".repeat(30_000); // 270 KB
  for (let n = 0; n < 40; n++) schreibe(d, `g${n}.md`, `# Groß ${n}\n\nAnfang ohne Treffer.\n${fuell}\nganzhintenwort\n${fuell}\n`); // Treffer bei ≈ 270 KB: im Index, aber jenseits der ersten 64 KB
  schreibe(d, "klein.md", "# Klein\n\nganzhintenwort steht vorn.\n");
  const i = await bereit(d);
  const r = i.suche({ q: "ganzhintenwort", limit: 50 });
  assert.equal(r.treffer.length, 41);
  const g = r.treffer.find((t) => t.pfad === "g0.md");
  assert.deepEqual(g.stellen, [], "Treffer jenseits der ersten 64 KB wird nicht gesucht");
  assert.equal(g.auszug, "Anfang ohne Treffer.", "stattdessen die erste Inhaltszeile");
  assert.ok(r.treffer.find((t) => t.pfad === "klein.md").stellen.length > 0);
  assert.ok(r.dauerMs < 1000, `${r.dauerMs} ms`);
  // Phrase über große Dateien: bleibt im Zeitrahmen
  const p = i.suche({ q: '"füllwort füllwort"', limit: 5 });
  assert.equal(p.treffer.length, 5);
  assert.ok(p.dauerMs < 1500, `${p.dauerMs} ms`);
});

test("6 Seitengrenze: tiefer als 2000 gibt es keine Wiederholung — mehr = false, keine Duplikate", async () => {
  const d = tmp();
  for (let n = 0; n < 2100; n++) schreibe(d, `a/n${String(n).padStart(4, "0")}.md`, `# N ${n}\n\nseitenwort\n`);
  const i = await bereit(d);
  const alle = new Set();
  let offset = 0, mehr = true, seiten = 0;
  while (mehr && seiten < 100) {
    const r = i.suche({ q: "seitenwort", limit: 50, offset });
    for (const p of pfade(r)) { assert.ok(!alle.has(p), `doppelt: ${p}`); alle.add(p); }
    offset += r.treffer.length; mehr = r.mehr; seiten++;
  }
  assert.ok(offset <= 2050 && alle.size === offset, `offset ${offset}`);
  assert.equal(mehr, false);
  const tief = i.suche({ q: "seitenwort", limit: 50, offset: 2500 });
  assert.deepEqual(tief.treffer, []); assert.equal(tief.mehr, false);
});

test("7 NFD-Text wird gefunden und vollständig markiert (Müller als u + Trema)", async () => {
  const d = tmp();
  const nfd = "Müller";
  schreibe(d, "m.md", `# ${nfd} GmbH\n\nHerr ${nfd} schrieb gestern.\n`);
  const i = await bereit(d);
  for (const q of ["müller", "Mueller", nfd]) {
    const r = i.suche({ q });
    assert.deepEqual(pfade(r), ["m.md"], q);
    const t = r.treffer[0];
    assert.deepEqual(t.titelMarken, [[0, nfd.length]], "Titel: ganzes Wort inkl. Akzent");
    assert.ok(t.stellen.length, "Fundstelle");
    const s = t.stellen[0], [von, bis] = s.marken[0];
    assert.equal(s.text.slice(von, bis), nfd);
  }
  // Studio markiert mit derselben Wortregel
  assert.deepEqual([...`Herr ${nfd} ok`.matchAll(WORT)].map((m) => m[0]), ["Herr", nfd, "ok"]);
  assert.equal(falteText(nfd), "mueller");
});

test("8 Gewachsene Dateien (> 1 MB) verlassen den Index beim Abgleich; an der Obergrenze werden bekannte Notizen weiter aktualisiert", async () => {
  const d = tmp();
  schreibe(d, "w.md", "---\ntyp: wachs\n---\n# Wachs\n\nwachswort\n");
  schreibe(d, "b.md", "# B\n\nbwort\n");
  const i = await bereit(d);
  assert.equal(i.stand().dokumente, 2);
  writeFileSync(join(d, "w.md"), "---\ntyp: wachs\n---\n# Wachs\n\nwachswort " + "x".repeat(1_100_000));
  i.pruefeNeu(); await i.ruhe();
  assert.equal(i.stand().dokumente, 1);
  const r = i.suche({ q: "typ:wachs", facetten: true });
  assert.equal(r.gesamt, 0); assert.deepEqual(r.facetten.typ, []);
  assert.deepEqual(pfade(i.suche({ q: "wachswort" })), []);

  const e = tmp();
  for (const n of ["alpha", "bravo", "charlie"]) schreibe(e, `${n}.md`, `# ${n}\n\n${n}inhalt\n`);
  const k = await bereit(e, { maxDokumente: 3 });
  schreibe(e, "neu.md", "# Neu\n\nzuvielwort\n");
  k.aendere("neu.md"); await k.ruhe();
  assert.deepEqual(pfade(k.suche({ q: "zuvielwort" })), [], "eine vierte Notiz kommt nicht hinein");
  writeFileSync(join(e, "bravo.md"), "# bravo\n\nneuerinhaltwort\n");
  k.aendere("bravo.md"); await k.ruhe();
  assert.deepEqual(pfade(k.suche({ q: "neuerinhaltwort" })), ["bravo.md"], "bekannte Notiz wird aktualisiert");
  assert.deepEqual(pfade(k.suche({ q: "bravoinhalt" })), []);
  assert.equal(k.stand().dokumente, 3);
});

test("9 Häufigkeit zählt nur lebende Notizen: oft gespeicherte Notizen unterdrücken die Tippfehler-Suche nicht", async () => {
  const d = tmp();
  schreibe(d, "tag.md", "# Tag\n\ntomate im Salat\n");
  schreibe(d, "tipp.md", "# Tipp\n\nZutat tomtae falsch geschrieben\n");
  const i = await bereit(d);
  for (let n = 0; n < 6; n++) { // Autospeichern: jede Fassung bekommt eine neue Nummer, die alte bleibt tot
    writeFileSync(join(d, "tag.md"), `# Tag\n\ntomate im Salat, Fassung ${n}\n`);
    const t = new Date(Date.now() + (n + 1) * 5000); utimesSync(join(d, "tag.md"), t, t);
    i.aendere("tag.md"); await i.ruhe();
  }
  assert.ok(i.stand().tot >= 6);
  const r = i.suche({ q: "tomate" });
  assert.deepEqual(pfade(r).sort(), ["tag.md", "tipp.md"], "Tippfehler-Suche läuft, weil nur eine lebende Notiz „tomate“ enthält");
});

test("Markup in Titeln und Auszügen kommt als Text an; die Bausteine der Ergebnisliste bauen nie HTML aus Notizinhalt", async () => {
  const d = tmp();
  const boese = "<img src=x onerror=alert(1)>";
  schreibe(d, "x.md", `# ${boese} <script>alert(2)</script>\n\nText mit ${boese} und <b>fett</b> markupwort.\n`);
  const i = await bereit(d);
  const t = i.suche({ q: "markupwort" }).treffer[0];
  assert.ok(t.stellen[0].text.includes(boese) && t.stellen[0].text.includes("<b>fett</b>"), "Auszug unverändert als Text, nie umgebaut");
  assert.ok(!/<(img|script)/i.test(t.titel) || t.titel.includes("<"), "Titel ist Text (bereinigt oder unverändert)");
  const quelle = readFileSync(pfad("studio", "suche.js"), "utf8");
  assert.equal([...quelle.matchAll(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/g)].length, 0, "suche.js: keine HTML-Zuweisung");
});
