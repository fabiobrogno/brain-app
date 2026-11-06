// Suchindex der Werkstatt (gemeinsam/suchindex.mjs): Qualität (Gewichtung, Tippfehler, Umlaute, Phrasen, Filter, Seiten, Auszüge), inkrementelles Aktualisieren,
// Nicht-Blockieren (Speichern während des Aufbaus), Gleichwertigkeit zur Kern-Suche (minisuche) bei den Messfragen, Anbindung an Handler und Live-Ereignisse.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, renameSync, mkdirSync, utimesSync, cpSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmp, schreibe, pfad, WURZEL } from "./hilfe.mjs";
import { baueGrossVault } from "./gross-vault.mjs";

const { erzeugeSuchindex, parseFrage, falteText, tokenisiere, analysiere } = await import(pfad("gemeinsam", "suchindex.mjs"));
const { falteText: falteClient } = await import(pfad("studio", "suchfalte.js"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { minisuche, leereMinisucheCache } = await import(pfad("kern", "minisuche.mjs"));

const bereit = async (d, o = {}) => { const i = erzeugeSuchindex({ wurzel: d, ...o }); i.starte(); await i.ruhe(); return i; };
const pfade = (r) => r.treffer.map((t) => t.pfad);

function korpus() {
  const d = tmp();
  schreibe(d, "a.md", "# Allgemeines\n\nHier steht etwas über Überstunden und Ärger im Büro.\n");
  schreibe(d, "b.md", "# Ärger mit Amazon\n\nnichts weiter\n");
  schreibe(d, "c.md", "Kein Titel, aber AMAZON-Konto hier. Die Fakt-Zeile ist wichtig.\n");
  schreibe(d, "09_wiki/kaffee.md", "---\nname: Kaffee\naliases: [Espresso, Bohnen]\ntyp: thema\nstatus: aktiv\ntags: [getraenk, morgen]\n---\n# Kaffee\n\nKurzer Text.\n\n## Zubereitung\n\nKaffee wird mit heißem Wasser gebrüht. #wach\n");
  schreibe(d, "09_wiki/_index.md", "# generiert\namazon amazon\n");
  schreibe(d, "09_wiki/INDEX.md", "# Index\namazon amazon\n");
  schreibe(d, ".tools/x.md", "# amazon\n");
  schreibe(d, "bild.png", "amazon");
  schreibe(d, "projekte/alpha/plan.md", "---\ntyp: projekt\nstatus: offen\n---\n# Plan Alpha\n\nDas Budget für Alpha steht. Zweite Zeile mit Budget.\n");
  return d;
}

test("Wörter falten: Umlaute, ß, Akzente; Studio und Werkstatt falten gleich", () => {
  assert.equal(falteText("Müller Straße ÄÖÜ"), "mueller strasse aeoeue");
  assert.equal(falteText("Café déjà"), "cafe deja");
  assert.deepEqual(tokenisiere("Fakt-Zeile: Über 3,5%"), ["fakt", "zeile", "ueber", "3", "5"]);
  for (const s of ["Ärger Übung ß", "Café déjà vu", "ØÆŒ łı", "plain ascii 123", "Ῥόδος Ωmega", "日本語 text"]) assert.equal(falteClient(s), falteText(s), s);
});

test("Frage lesen: Wörter, Phrasen, Ausschluss, Filter", () => {
  const q = parseFrage('kaffee "genaue Wörter" -milch typ:Projekt ordner:"09 wiki" geändert:<7d x:y');
  assert.deepEqual(q.terme.map((t) => t.token + (t.phrase ? "*" : "")), ["kaffee", "genaue*", "woerter*", "x", "y"]);
  assert.deepEqual(q.phrasen, [["genaue", "woerter"]]);
  assert.deepEqual(q.ausschluss, ["milch"]);
  assert.deepEqual(q.filter.map((f) => [f.schluessel, f.wert]), [["typ", "Projekt"], ["ordner", "09 wiki"], ["geaendert", "<7d"]]);
  assert.equal(q.filter[0].roh, "typ:Projekt");
  assert.deepEqual(parseFrage("   ").terme, []);
  assert.deepEqual(parseFrage("http://x.de").terme.map((t) => t.token), ["http", "x", "de"]); // kein Filter
});

test("Analyse: Titel, Alias, Tags (Kopf und #Tag im Text), Typ, Status, Überschriften zählen mit Gewicht", () => {
  const { doc, zaehl } = analysiere("09_wiki/kaffee.md", "---\nname: Kaffee\naliases: [Espresso]\ntags: [getraenk]\ntyp: Thema\nstatus: Aktiv\n---\n# Kaffee\n\n## Zubereitung\n\nText mit #wach und `#1`.\n\n```\n# kein Titel\n```\n");
  assert.equal(doc.titel, "Kaffee"); assert.deepEqual(doc.aliasF, ["espresso"]); assert.equal(doc.typ, "thema"); assert.equal(doc.status, "aktiv");
  assert.deepEqual([...doc.tags].sort(), ["getraenk", "wach"]); assert.equal(doc.ordnerF, "09_wiki");
  assert.ok(zaehl.get("kaffee") >= 8 && zaehl.get("espresso") >= 6 && zaehl.get("zubereitung") >= 3 && zaehl.get("wach") >= 4);
  assert.ok(!zaehl.has("kein") || zaehl.get("kein") === 1); // Code-Block zählt nur als Text, nicht als Überschrift
});

test("Suche: Titel vor Text, Umlaute, Tippfehler, Wortanfang, generierte/versteckte/fremde Dateien nie", async () => {
  const i = await bereit(korpus());
  assert.deepEqual(pfade(i.suche({ q: "ärger" })), ["b.md", "a.md"], "Titel-Treffer zuerst");
  assert.deepEqual(pfade(i.suche({ q: "UEBERSTUNDEN" })), ["a.md"]);
  assert.deepEqual(pfade(i.suche({ q: "überstunden" })), ["a.md"]);
  assert.deepEqual(pfade(i.suche({ q: "amazon" })).sort(), ["b.md", "c.md"], "_index.md, INDEX.md, .tools, Bilder nie");
  assert.deepEqual(pfade(i.suche({ q: "über büro" })), ["a.md"], "mehrere Wörter = UND");
  assert.equal(pfade(i.suche({ q: "kafee" }))[0], "09_wiki/kaffee.md", "Tippfehler (fehlendes f)");
  assert.equal(pfade(i.suche({ q: "kaffe" }))[0], "09_wiki/kaffee.md", "Wortanfang und Tippfehler");
  assert.equal(pfade(i.suche({ q: "kaff" }))[0], "09_wiki/kaffee.md", "Wortanfang");
  assert.equal(pfade(i.suche({ q: "espresso" }))[0], "09_wiki/kaffee.md", "Alias");
  assert.equal(pfade(i.suche({ q: "zubereitung" }))[0], "09_wiki/kaffee.md", "Überschrift");
  assert.equal(pfade(i.suche({ q: "getraenk" }))[0], "09_wiki/kaffee.md", "Tag im Kopf");
  assert.equal(pfade(i.suche({ q: "wach" }))[0], "09_wiki/kaffee.md", "#Tag im Text");
  assert.deepEqual(i.suche({ q: "   " }).treffer, []);
  assert.deepEqual(i.suche({ q: "gibtesnicht" }).treffer, []);
  assert.equal(i.suche({ q: "zzqqxx yyqqww" }).gesamt, 0);
  assert.equal(i.suche({ q: "amazon" }).locker, null);
  const l = i.suche({ q: "amazon budget" }); // kein Dokument hat beide: mindestens eins
  assert.deepEqual(l.locker, { gefunden: 1, von: 2 }); assert.ok(l.gesamt >= 3);
});

test("Gewichtung: Titel schlägt Überschrift schlägt Text; genauer Titel steht oben", async () => {
  const d = tmp();
  schreibe(d, "text.md", "# Etwas anderes\n\n" + "Das Wort Pilz kommt hier im Text vor. ".repeat(6));
  schreibe(d, "kopf.md", "# Anderes\n\n## Pilz\n\nkurz\n");
  schreibe(d, "titel.md", "# Pilz\n\nkurz\n");
  schreibe(d, "titel-lang.md", "# Pilz im Wald und andere Dinge\n\nkurz\n");
  const i = await bereit(d);
  assert.deepEqual(pfade(i.suche({ q: "pilz" })), ["titel.md", "titel-lang.md", "kopf.md", "text.md"]);
});

test("Phrasen: nur in dieser Reihenfolge, auch über Bindestrich und Zeilenumbruch hinweg; Ausschluss", async () => {
  const d = korpus();
  const i = await bereit(d);
  assert.deepEqual(pfade(i.suche({ q: '"Fakt-Zeile"' })), ["c.md"]);
  assert.deepEqual(pfade(i.suche({ q: '"fakt zeile"' })), ["c.md"]);
  assert.deepEqual(pfade(i.suche({ q: '"zeile fakt"' })), []);
  assert.deepEqual(pfade(i.suche({ q: '"ärger im büro"' })), ["a.md"]);
  assert.deepEqual(pfade(i.suche({ q: 'ist "fakt zeile"' })), ["c.md"]);
  assert.deepEqual(pfade(i.suche({ q: "amazon -konto" })), ["b.md"]);
  const t = i.suche({ q: '"Fakt-Zeile"' }).treffer[0];
  assert.equal(t.zeile, 1); assert.match(t.auszug, /Fakt-Zeile/);
  assert.deepEqual(t.stellen[0].marken.map(([a, b]) => t.stellen[0].text.slice(a, b)), ["Fakt", "Zeile"]);
});

test("Filter: ordner, typ, tag, status, geändert; nur Filter listet; Facetten", async () => {
  const d = korpus();
  utimesSync(join(d, "a.md"), new Date(Date.now() - 40 * 86400e3), new Date(Date.now() - 40 * 86400e3));
  const i = await bereit(d);
  assert.deepEqual(pfade(i.suche({ q: "typ:thema" })), ["09_wiki/kaffee.md"]);
  assert.deepEqual(pfade(i.suche({ q: "typ:Projekt budget" })), ["projekte/alpha/plan.md"]);
  assert.deepEqual(pfade(i.suche({ q: "ordner:wiki" })), ["09_wiki/kaffee.md"], "09_wiki = wiki");
  assert.deepEqual(pfade(i.suche({ q: "ordner:projekte/alpha" })), ["projekte/alpha/plan.md"]);
  assert.deepEqual(pfade(i.suche({ q: 'ordner:"09_wiki"' })), ["09_wiki/kaffee.md"]);
  assert.deepEqual(pfade(i.suche({ q: "tag:getraenk" })), ["09_wiki/kaffee.md"]);
  assert.deepEqual(pfade(i.suche({ q: "tag:#wach" })), ["09_wiki/kaffee.md"]);
  assert.deepEqual(pfade(i.suche({ q: "status:offen" })), ["projekte/alpha/plan.md"]);
  assert.deepEqual(pfade(i.suche({ q: "ärger geändert:<7d" })), ["b.md"], "a.md ist 40 Tage alt");
  assert.deepEqual(pfade(i.suche({ q: "ärger geaendert:>30d" })), ["a.md"]);
  assert.deepEqual(pfade(i.suche({ q: "ärger geaendert:>=2000-01-01" })).sort(), ["a.md", "b.md"]);
  assert.deepEqual(pfade(i.suche({ q: "typ:thema typ:projekt" })).sort(), ["09_wiki/kaffee.md", "projekte/alpha/plan.md"], "gleicher Schlüssel = oder");
  assert.deepEqual(pfade(i.suche({ q: "typ:thema status:offen" })), [], "verschiedene Schlüssel = und");
  assert.deepEqual(pfade(i.suche({ q: "amazon -typ:thema" })).sort(), ["b.md", "c.md"]);
  const u = i.suche({ q: "typ:x geaendert:kaputt" });
  assert.equal(u.filter.find((f) => f.schluessel === "geaendert").gueltig, false);
  const f = i.suche({ q: "ärger", facetten: true });
  assert.deepEqual(f.facetten.typ, []); assert.equal(f.gesamt, 2);
  const g = i.suche({ q: "typ:thema", facetten: true }); // Facetten eines Schlüssels ohne dessen eigenen Filter: beide Typen bleiben wählbar
  assert.deepEqual(g.facetten.typ.map((x) => x.wert).sort(), ["projekt", "thema"]);
  assert.deepEqual(g.facetten.ordner.map((x) => x.wert), ["09_wiki"]);
});

test("Seiten: offset/limit, Gesamtzahl, mehr", async () => {
  const d = tmp();
  for (let i = 0; i < 75; i++) schreibe(d, `n/${String(i).padStart(2, "0")}.md`, `# Seite ${i}\n\nfoo bar ${i}\n`);
  const i = await bereit(d);
  const a = i.suche({ q: "foo" });
  assert.equal(a.treffer.length, 30); assert.equal(a.gesamt, 75); assert.equal(a.mehr, true); assert.equal(a.limit, 30); assert.equal(a.offset, 0);
  const b = i.suche({ q: "foo", offset: 30 });
  assert.equal(b.treffer.length, 30); assert.equal(b.mehr, true);
  const c = i.suche({ q: "foo", offset: 60, limit: 30 });
  assert.equal(c.treffer.length, 15); assert.equal(c.mehr, false);
  assert.equal(new Set([...pfade(a), ...pfade(b), ...pfade(c)]).size, 75, "keine Doppelten, nichts fehlt");
  assert.equal(i.suche({ q: "foo", limit: 500 }).treffer.length, 50, "höchstens 50 je Seite");
});

test("Auszüge: Zeile, Spalte, Markierungen, Fundstellen, Kopfzeilen zuletzt, Fenster um den Treffer", async () => {
  const d = korpus();
  const i = await bereit(d);
  const t = i.suche({ q: "budget" }).treffer[0];
  const zeilen = readFileSync(join(d, t.pfad), "utf8").split("\n");
  assert.equal(zeilen[t.zeile - 1].slice(t.spalte, t.spalte + t.laenge), "Budget", "Zeile und Spalte zeigen auf das Wort");
  assert.ok(t.anzahl >= 2);
  assert.equal(t.stellen[0].marken.length >= 1, true);
  const [a, b] = t.stellen[0].marken[0];
  assert.equal(t.stellen[0].text.slice(a, b), "Budget");
  const k = i.suche({ q: "zubereitung kaffee" }).treffer[0];
  assert.equal(k.pfad, "09_wiki/kaffee.md");
  assert.ok(!/^name:/.test(k.stellen[0].text) && !/^aliases:/.test(k.stellen[0].text), "Kopfzeilen kommen nach dem Text");
  assert.deepEqual(k.titelMarken.map(([x, y]) => k.titel.slice(x, y)), ["Kaffee"]);
  assert.equal(i.suche({ q: "gebruehrt" }).treffer[0]?.stellen[0].text.includes("gebrüht"), true, "Fuzzy: markiert wird das echte Wort");
  const lang = tmp();
  schreibe(lang, "lang.md", "# Lang\n\n" + "wort ".repeat(120) + "Nadel " + "wort ".repeat(120) + "\n");
  const j = await bereit(lang);
  const s = j.suche({ q: "nadel" }).treffer[0].stellen[0];
  assert.ok(s.text.length < 200 && s.text.startsWith("… ") && s.text.endsWith(" …"), s.text);
  assert.equal(s.text.slice(s.marken[0][0], s.marken[0][1]), "Nadel");
});

test("Inkrementell: neue, geänderte, gelöschte, umbenannte Dateien über aendere(); Ordner weg/neu über pruefeNeu()", async () => {
  const d = korpus();
  const i = await bereit(d);
  assert.deepEqual(pfade(i.suche({ q: "pflaume" })), []);
  schreibe(d, "neu.md", "# Neu\n\nPflaume im Text.\n");
  i.aendere("neu.md"); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "pflaume" })), ["neu.md"]);
  writeFileSync(join(d, "neu.md"), "# Neu\n\nKirsche statt Obst.\n");
  i.aendere("neu.md"); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "pflaume" })), []); assert.deepEqual(pfade(i.suche({ q: "kirsche" })), ["neu.md"]);
  renameSync(join(d, "neu.md"), join(d, "anders.md"));
  i.aendere(["neu.md", "anders.md"]); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "kirsche" })), ["anders.md"]);
  unlinkSync(join(d, "anders.md"));
  i.aendere("anders.md"); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "kirsche" })), []);
  assert.equal(i.stand().dokumente, 5);
  // ganzer Ordner von außen (git checkout, Verschieben): Abgleich
  mkdirSync(join(d, "neuordner"), { recursive: true });
  schreibe(d, "neuordner/x.md", "# X\n\nMirabelle.\n");
  schreibe(d, "neuordner/y.md", "# Y\n\nMirabelle auch.\n");
  i.pruefeNeu(); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "mirabelle" })).sort(), ["neuordner/x.md", "neuordner/y.md"]);
  renameSync(join(d, "neuordner"), join(d, "umbenannt"));
  i.pruefeNeu(); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "mirabelle" })).sort(), ["umbenannt/x.md", "umbenannt/y.md"]);
  // unlesbare Wurzel: nichts wird gelöscht
  assert.equal(i.stand().dokumente, 7);
});

test("Frische beim Antworten: eine ohne Meldung geänderte Datei wird erkannt, bevor ein falscher Auszug erscheint", async () => {
  const d = korpus();
  const i = await bereit(d);
  assert.deepEqual(pfade(i.suche({ q: "ärger" })), ["b.md", "a.md"]);
  writeFileSync(join(d, "b.md"), "# Ärger mit Amazon\n\nund jetzt steht hier Pfirsich und Ärger\n");
  const r = i.suche({ q: "ärger" }); // b.md hat sich geändert (Größe): der Treffer wird neu gelesen
  assert.match(r.treffer.find((t) => t.pfad === "b.md").stellen.map((s) => s.text).join(" "), /Ärger/);
  assert.deepEqual(pfade(i.suche({ q: "pfirsich" })), ["b.md"], "der Index kennt den neuen Text jetzt");
  unlinkSync(join(d, "a.md"));
  assert.ok(!pfade(i.suche({ q: "ärger" })).includes("a.md"), "gelöscht: nie ein Treffer");
});

test("Unter-Vaults bleiben draußen, wenn der Vault sie ausschließt (MCP-Regel)", async () => {
  const d = tmp();
  schreibe(d, "aussen.md", "# Außen\n\nGeheimnis außen.\n");
  schreibe(d, "innen/brain.config.json", "{}");
  schreibe(d, "innen/geheim.md", "# Innen\n\nGeheimnis innen.\n");
  const v = oeffneVault(d, { ohneUnterVaults: true });
  const r = await v.sucheIndex({ q: "geheimnis" });
  assert.deepEqual(pfade(r), ["aussen.md"]);
  const v2 = oeffneVault(d);
  assert.deepEqual(pfade(await v2.sucheIndex({ q: "geheimnis" })).sort(), ["aussen.md", "innen/geheim.md"]);
});

test("Zu viele tote Einträge: der Index baut sich im Hintergrund neu und bleibt dabei antwortbereit", async () => {
  const d = korpus();
  const i = await bereit(d, { totSchwelle: 4 });
  for (let n = 0; n < 8; n++) { writeFileSync(join(d, "b.md"), `# Ärger mit Amazon\n\nVersion ${n} ${"x".repeat(n)}\n`); i.aendere("b.md"); await i.ruhe(); }
  assert.deepEqual(pfade(i.suche({ q: "version" })), ["b.md"]);
  await i.ruhe();
  assert.ok(i.stand().tot < 4, JSON.stringify(i.stand()));
  assert.deepEqual(pfade(i.suche({ q: "ärger" })).sort(), ["a.md", "b.md"]);
  assert.equal(i.stand().dokumente, 5);
});

test("Gleichwertig zur Kern-Suche: die Messfragen der Kern-Fixture und ein Korpus finden mindestens so gut wie minisuche", async () => {
  const K = 5;
  const trifft = (liste, erwartet) => liste.slice(0, K).some((p) => erwartet.includes(p.split("/").pop()));
  const lade = (datei) => (JSON.parse(readFileSync(datei, "utf8")).positiv || []).filter((c) => c && typeof c.prompt === "string" && Array.isArray(c.erwartet));
  const d = tmp();
  cpSync(join(WURZEL, "..", "Tests", "Kern", "fixture"), d, { recursive: true });
  const SEITEN = { "09_wiki/firma/amazon/thema_retouren.md": ["Amazon Retouren", "Retouren werden im Seller Central geprüft. Der Kunde bekommt die Erstattung nach Wareneingang."],
    "09_wiki/firma/amazon/thema_gebuehren.md": ["Amazon Gebühren", "Die Verkaufsgebühr liegt je nach Kategorie bei acht bis fünfzehn Prozent."],
    "09_wiki/firma/shop/thema_versand.md": ["Versand im Shop", "Pakete gehen mit DHL raus. Ab fünfzig Euro Bestellwert ist der Versand frei."],
    "09_wiki/themen/thema_tageslauf.md": ["Tageslauf", "Nachts läuft die Pflege im Tageslauf: erst die Inbox sichten, dann veraltete Seiten prüfen."],
    "09_wiki/themen/thema_backup.md": ["Sicherung", "Das Backup des Vaults läuft täglich als Git-Commit auf den Server."],
    "09_wiki/projekte/projekt_garten.md": ["Gartenplanung", "Im Frühjahr werden Tomaten vorgezogen. Die Beete bekommen im April Kompost."] };
  for (const [rel, [titel, text]] of Object.entries(SEITEN)) schreibe(d, rel, `---\nname: ${titel}\ntyp: thema\n---\n\n# ${titel}\n\n${text}\n`);
  const fragen = [...lade(join(WURZEL, "kern", "kit", "vorlage-eval.json")),
    ...[["Retouren", "thema_retouren.md"], ["Backup", "thema_backup.md"], ["Tomaten", "projekt_garten.md"], ["Wie läuft die Pflege im Tageslauf ab?", "thema_tageslauf.md"], ["Was passiert mit Retouren bei Amazon?", "thema_retouren.md"],
      ["Wann wird der Versand im Shop kostenlos?", "thema_versand.md"], ["Was kostet mich die Verkaufsgebühr bei Amazon?", "thema_gebuehren.md"], ["Amazon Gebühren", "thema_gebuehren.md"]].map(([prompt, datei]) => ({ prompt, erwartet: [datei] }))];
  const i = await bereit(d);
  leereMinisucheCache();
  let mini = 0, neu = 0;
  for (const f of fragen) {
    const erw = f.erwartet.map((p) => p.split("/").pop());
    if (trifft(minisuche(d, f.prompt, K).map((t) => t.pfad), erw)) mini++;
    if (trifft(pfade(i.suche({ q: f.prompt, limit: K })), erw)) neu++;
  }
  console.log(`# Recall@${K}: Kern-Suche ${mini}/${fragen.length}, Suchindex ${neu}/${fragen.length}`);
  assert.ok(neu >= mini, `Suchindex ${neu} < Kern-Suche ${mini}`);
});

test("Nicht blockierend: Aufbau in Scheiben — die Ereignisschleife steht nie lange, Speichern über den Handler bleibt unter 50 ms", async () => {
  const g = baueGrossVault(5000, { start: 7 });
  const h = erzeugeHandler({ vault: g.vault, studioDir: tmp(), appVersion: "t" });
  const rufe = async (methode, p, daten, query) => { const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); return { ...r, j: JSON.parse(r.body.toString("utf8")) }; };
  let letzter = performance.now(), maxVerzug = 0;
  const wache = setInterval(() => { const t = performance.now(); maxVerzug = Math.max(maxVerzug, t - letzter - 2); letzter = t; }, 2);
  const t0 = performance.now();
  const erste = rufe("GET", "/api/suche", undefined, `q=${encodeURIComponent(g.wort())}&limit=5`); // stößt den Aufbau an (wartet höchstens 350 ms, dann vorläufige Antwort)
  const speicherZeiten = [];
  for (let n = 0; n < 12; n++) {
    const datei = g.dateien[n * 37];
    const lies = await rufe("GET", "/api/datei", undefined, `pfad=${encodeURIComponent(datei)}`);
    const t = performance.now();
    const r = await rufe("PUT", "/api/datei", { pfad: datei, inhalt: lies.j.inhalt + `\nZeile ${n}\n`, basisHash: lies.j.hash });
    speicherZeiten.push(performance.now() - t);
    assert.equal(r.status, 200);
    await new Promise((ok) => setTimeout(ok, 15));
  }
  const r1 = await erste;
  const waehrend = performance.now() - t0;
  clearInterval(wache);
  assert.equal(r1.status, 200);
  const stand = (await rufe("GET", "/api/suche", undefined, "q=zzz&limit=1")).j.aufbau;
  console.log(`# Aufbau 5000: Verzug der Schleife max ${Math.round(maxVerzug)} ms, Speichern max ${Math.round(Math.max(...speicherZeiten))} ms, nach ${Math.round(waehrend)} ms, Aufbau fertig: ${stand.fertig}`);
  // Aufbau läuft zu Ende; die gespeicherten Dateien sind danach auffindbar
  const i2 = await bereit(g.vault);
  // Robust gegen Last (CI-Runner, parallele Tests): großzügige feste Grenze UND nie so lang wie ein ganzer Aufbau am Stück. Der Aufbau selbst dauert unter derselben Last
  // entsprechend länger (bauMs), die Grenzen wandern also mit.
  const bau = Math.max(1, i2.stand().bauMs);
  const grenze = (min, anteil) => Math.max(min, bau * anteil);
  assert.ok(Math.max(...speicherZeiten) < grenze(250, 0.5), `Speichern während des Aufbaus: ${Math.max(...speicherZeiten)} ms (Aufbau ${bau} ms)`);
  assert.ok(maxVerzug < grenze(250, 0.4), `Ereignisschleife stand ${maxVerzug} ms (Aufbau ${bau} ms)`);
  assert.equal(i2.stand().dokumente, 5000);
  assert.ok(pfade(i2.suche({ q: "Zeile" })).length > 0);
});

test("Handler: /api/suche mit Seiten und Filtern; eigene Schreibvorgänge und Live-Ereignisse halten den Index aktuell", async () => {
  const d = korpus();
  const h = erzeugeHandler({ vault: d, studioDir: tmp(), appVersion: "t" });
  const rufe = async (methode, p, daten, query) => { const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); return { ...r, j: JSON.parse(r.body.toString("utf8")) }; };
  let r = await rufe("GET", "/api/suche", undefined, "q=ärger&facetten=1");
  assert.deepEqual(pfade(r.j), ["b.md", "a.md"]);
  assert.equal(r.j.gesamt, 2); assert.equal(r.j.aufbau.fertig, true); assert.ok(r.j.facetten);
  r = await rufe("GET", "/api/suche", undefined, "q=typ%3Athema");
  assert.deepEqual(pfade(r.j), ["09_wiki/kaffee.md"]);
  // Speichern über die Oberfläche: sofort auffindbar
  const lies = (await rufe("GET", "/api/datei", undefined, "pfad=c.md")).j;
  await rufe("PUT", "/api/datei", { pfad: "c.md", inhalt: "# C\n\nQuitte statt Amazon.\n", basisHash: lies.hash });
  assert.deepEqual(pfade((await rufe("GET", "/api/suche", undefined, "q=quitte")).j), ["c.md"]);
  assert.ok(!pfade((await rufe("GET", "/api/suche", undefined, "q=konto")).j).includes("c.md"));
  const neu = (await rufe("POST", "/api/neu", { ordner: "", titel: "Brombeere" })).j.pfad;
  assert.deepEqual(pfade((await rufe("GET", "/api/suche", undefined, "q=brombeere")).j), [neu]);
  // Fremdes Schreiben + Live-Ereignis (die Werkstatt meldet es, der Index zieht nach), ohne dass die Datei beim Suchen schon auffällt
  schreibe(d, "fremd.md", "# Fremd\n\nHimbeere von außen.\n");
  h.ereignisse.melde({ typ: "notiz", art: "geaendert", pfad: "fremd.md" });
  await new Promise((ok) => setTimeout(ok, 30));
  assert.deepEqual(pfade((await rufe("GET", "/api/suche", undefined, "q=himbeere")).j), ["fremd.md"]);
  unlinkSync(join(d, "fremd.md"));
  h.ereignisse.melde({ typ: "notiz", art: "entfernt", pfad: "fremd.md" });
  await new Promise((ok) => setTimeout(ok, 30));
  assert.deepEqual(pfade((await rufe("GET", "/api/suche", undefined, "q=himbeere")).j), []);
  // Ordner kopiert: „alles“ löst den Abgleich aus
  mkdirSync(join(d, "kopie"), { recursive: true }); schreibe(d, "kopie/z.md", "# Z\n\nStachelbeere.\n");
  h.ereignisse.melde({ typ: "alles", grund: "test" });
  await new Promise((ok) => setTimeout(ok, 80));
  assert.deepEqual(pfade((await rufe("GET", "/api/suche", undefined, "q=stachelbeere")).j), ["kopie/z.md"]);
  // alte Route bleibt rückwärtskompatibel
  const t = (await rufe("GET", "/api/suche", undefined, "q=ärger")).j.treffer[0];
  for (const k of ["pfad", "titel", "auszug", "zeile"]) assert.ok(k in t, k);
});
