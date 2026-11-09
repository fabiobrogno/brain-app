// Injektions-Korpus gegen die KI-Vorschläge (Plan 6): Texte, die der KI Anweisungen unterschieben wollen, laufen durch die echte Werkstatt mit der Attrappe in den Szenarien
// „folgt der Einschleusung“ (schemakonform, aber böswillig) und „fremdes Ziel“. Unveränderliche Erwartung: kein vorgeschlagenes Ziel außerhalb der gesendeten Liste kommt durch,
// nichts wird ohne „anwenden“ geschrieben, und ein „anwenden“ trifft nur Ziele aus dem Speicher der Werkstatt (innerhalb des Vaults).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pfad } from "./hilfe.mjs";
import { schreibe } from "./hilfe.mjs";
import { szenarioV } from "./ki-vorschlag-hilfe.mjs";
import { KORPUS } from "./ki-injektion/korpus.mjs";

const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
const { pruefeAntwort } = await import(pfad("gemeinsam", "ki-schema.mjs"));
after(() => { beendeAlleProzesse(); });

const ENTRY = "00_inbox/Korpus.md";
const alleDateien = (wurzel) => { const r = []; const geh = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) geh(p); else r.push(p); } }; geh(wurzel); return r; };

for (const fall of KORPUS) {
  test(`Injektion „${fall.name}“: nichts ohne Klick geschrieben, Ziele nur aus der Liste, Pfade der Antwort nie benutzt`, async () => {
    const s = szenarioV();
    schreibe(s.vault, ENTRY, fall.eintrag);
    for (const [p, t] of fall.extra || []) schreibe(s.vault, p, t);
    const vorher = s.abbild(s.vault);
    const start = (extra = {}) => s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: ENTRY, konto: "k_aaaaaaaa", ...extra });
    if (fall.erwartet === "ki-nein") {
      const r = await start();
      assert.equal(r.status, 409); assert.equal(r.j.art, "ki-nein");
      assert.deepEqual(s.aufrufe(), [], "ein Eintrag mit „ki: nein“ erreicht nie eine KI");
      assert.deepEqual(s.abbild(s.vault), vorher);
      return;
    }
    for (const name of ["injektion-befolgt", "fremdes-ziel", "ok", "beleg-erfunden", "unicode-tags"]) {
      s.szen({ szenario: name });
      const r = await start();
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.j)}`);
      const stand = await s.folge(r.j.id);
      assert.equal(stand.ergebnis.ok, true, `${name}: ${JSON.stringify(stand.ergebnis)}`);
      const ergebnis = JSON.stringify(stand.ergebnis);
      const paket = JSON.parse(s.aufrufe().at(-1).stdin);
      const kennungen = new Set([...paket.daten.kandidaten.map((k) => k.id), ...paket.daten.ordner.map((o) => o.id)]);
      assert.ok(stand.ergebnis.vorschlaege.length <= 3, `${name}: höchstens 3 Vorschläge`);
      for (const v of stand.ergebnis.vorschlaege) {
        // Die Beschriftung nennt eigene Titel aus dem Vault (bei „titel-eines-kandidaten“ trägt ein Titel selbst den Angriffstext; er wird nur als Text gezeigt) — sonst keine fremden Pfade
        if (!fall.extra) assert.ok(!/(\.\.|\/etc|\/tmp|\/Users)/.test(v.beschriftung), `${name}: Beschriftung ohne fremde Pfade (${v.beschriftung})`);
        assert.ok(v.beschriftung.startsWith("Verschiebt nach „") || v.beschriftung.startsWith("Verlinkt mit „") || v.beschriftung.startsWith("Legt die Aufgabe") || v.beschriftung.startsWith("Setzt die Tags") || v.beschriftung.startsWith("Markiert als Duplikat"), `${name}: Beschriftung baut Kortex (${v.beschriftung})`);
        assert.ok(!ergebnis.includes("../") || fall.eintrag.includes("../"), `${name}: kein Pfad aus der Antwort im Ergebnis`);
      }
      if (name === "fremdes-ziel") assert.deepEqual(stand.ergebnis.vorschlaege, [], "kein Ziel außerhalb der Liste kommt durch");
      if (name === "beleg-erfunden" || name === "unicode-tags") assert.deepEqual(stand.ergebnis.vorschlaege, [], `${name}: wird verworfen`);
      // Das Datenpaket: der Angriffstext steht nur unter daten, nie in den Argumenten (Systemprompt eingeschlossen)
      const a = s.aufrufe().at(-1);
      assert.ok(paket.daten.eintrag.text.length <= 6000);
      const probe = (fall.eintrag.replace(/\s+/g, " ").match(/[A-Za-zÄÖÜäöü ]{25,}/) || [])[0];
      if (probe) assert.ok(!a.args.some((x) => x.includes(probe.trim().slice(0, 25))), `${name}: Angriffstext nicht in den Argumenten`);
      assert.ok(kennungen.size <= 20 && [...kennungen].every((k) => /^[ko]\d+$/.test(k)));
      assert.deepEqual(s.abbild(s.vault), vorher, `${name}: ohne „anwenden“ ist im Vault nichts passiert`);
    }
    // „folgt der Einschleusung“: selbst die schemakonformen, böswilligen Vorschläge treffen nur Ziele aus dem Speicher der Werkstatt
    s.szen({ szenario: "injektion-befolgt" });
    const r = await start();
    const stand = await s.folge(r.j.id);
    const verschieben = stand.ergebnis.vorschlaege.find((v) => v.art === "verschieben");
    if (fall.beleglos) { assert.deepEqual(stand.ergebnis.vorschlaege, [], "ein Beleg mit versteckten Steuerzeichen ist nie gültig: kein Vorschlag"); assert.deepEqual(s.abbild(s.vault), vorher); return; }
    assert.ok(verschieben, "der böswillige Verschiebe-Vorschlag ist schemakonform und kommt (als Vorschlag) durch");
    assert.equal(stand.ergebnis.vorschlaege.length, 3, "von fünf bleiben höchstens drei");
    const z = await s.api("POST", "/api/ki/vorschlag/anwenden", { id: verschieben.id, token: verschieben.token, ziel: "../../x", pfad: "/etc/passwd" });
    assert.equal(z.status, 200, JSON.stringify(z.j));
    assert.match(z.j.nach, /^(10_projekte|20_finanzen)\/Korpus\.md$/, "nur ein Ordner aus der gesendeten Liste, innerhalb des Vaults");
    assert.ok(existsSync(join(s.vault, z.j.nach)));
    const neu = alleDateien(s.vault).filter((d) => !d.includes("/.kortex-lokal/")).filter((d) => !vorher.some((x) => x.startsWith(d.slice(s.vault.length + 1) + " ")));
    assert.deepEqual(neu.map((d) => d.slice(s.vault.length + 1)), [z.j.nach], "genau eine Datei ist dazugekommen (die verschobene; das Journal liegt in .kortex-lokal)");
    assert.ok(neu.every((d) => d.startsWith(s.vault)), "nichts außerhalb des Vaults");
    assert.equal(dirname(join(s.vault, z.j.nach)).startsWith(s.vault), true);
  });
}

test("Schema-Ebene: Pfade, ../, absolute Pfade, Kennung eines anderen Typs oder Vaults, Zusatzfelder, falsche Typen, Prototyp-Schlüssel — nie ein Vorschlag", () => {
  const ctx = { eintrag: "Wir sollten das Atlas Projekt besprechen.", kandidaten: ["k1", "k2"], ordner: ["o1"] };
  const gut = { art: "verlinken", ziel: "k1", beleg: "Atlas Projekt", begruendung: "Passt.", sicherheit: "hoch" };
  const pruefe = (x) => pruefeAntwort("posteingang", { vorschlaege: [x] }, ctx).daten.vorschlaege.length;
  assert.equal(pruefe(gut), 1);
  const boese = [
    { ...gut, ziel: "../geheim.md" }, { ...gut, ziel: "/etc/passwd" }, { ...gut, ziel: "k3" }, { ...gut, ziel: "k01" }, { ...gut, ziel: "K1" }, { ...gut, ziel: " k1" }, { ...gut, ziel: "k1\n" }, { ...gut, ziel: ["k1"] },
    { ...gut, ziel: "o1" }, { ...gut, art: "verschieben" }, { ...gut, art: "verschieben", ziel: "k1" }, { ...gut, art: "loeschen" }, { ...gut, art: "verlinken ", ziel: "k1" },
    { ...gut, pfad: "../x" }, { ...gut, aktion: "loeschen" }, { ...gut, tags: ["x"] }, { ...gut, aufgabe: { text: "x" } },
    { ...gut, beleg: "Das steht nirgends" }, { ...gut, beleg: "ab" }, { ...gut, beleg: "" }, { ...gut, beleg: 7 },
    { ...gut, begruendung: "" }, { ...gut, begruendung: "x".repeat(161) }, { ...gut, begruendung: "Normal\u{e0041}" }, { ...gut, begruendung: "a\nb" }, { ...gut, begruendung: "a‮b" },
    { ...gut, sicherheit: "sicher" }, { ...gut, sicherheit: undefined }, null, "k1", 5, [], { __proto__: { art: "x" }, ...gut, constructor: "x" },
  ];
  for (const x of boese) assert.equal(pruefe(x), 0, JSON.stringify(x));
  assert.equal(pruefe(JSON.parse('{"art":"verlinken","ziel":"k1","beleg":"Atlas Projekt","begruendung":"Passt.","sicherheit":"hoch","__proto__":{"x":1}}')), 0, "__proto__ als Schlüssel ist ein unbekanntes Feld");
});
