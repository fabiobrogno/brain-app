// gemeinsam/ki-schema.mjs: feste Ausgabeschemata und strenge Prüfung (fail-closed). Rein, ohne Prozesse.
import test from "node:test";
import assert from "node:assert/strict";
import { pfad } from "./hilfe.mjs";

const S = await import(pfad("gemeinsam", "ki-schema.mjs"));
const { pruefeAntwort, schemaFuer, istKiNein, parseJsonAntwort, warnungenFuerErsatz, LIMITS } = S;

const EINTRAG = "Wir sollten das Atlas Projekt besprechen. Rechnung   März\nablegen.";
const ctxP = { eintrag: EINTRAG, kandidaten: ["k1", "k2", "k3"], ordner: ["o1", "o2"] };
const gut = { art: "verlinken", ziel: "k2", beleg: "Atlas Projekt", begruendung: "Der Titel kommt vor.", sicherheit: "mittel" };
const P = (v, ctx = ctxP) => pruefeAntwort("posteingang", { vorschlaege: Array.isArray(v) ? v : [v] }, ctx);
const anzahl = (v, ctx) => P(v, ctx).daten.vorschlaege.length;

test("Posteingang: gültige Vorschläge aller Arten werden bereinigt übernommen", () => {
  const r = P([
    gut,
    { art: "verschieben", ziel: "o1", beleg: "Rechnung März ablegen", begruendung: "Gehört zu Finanzen.", sicherheit: "hoch" },
    { art: "aufgabe", aufgabe: { text: "Rechnung ablegen", faellig: "2026-11-30" }, beleg: "Rechnung März", begruendung: "Eine Aufgabe.", sicherheit: "hoch" },
  ]);
  assert.equal(r.ok, true); assert.equal(r.verworfen, 0);
  assert.deepEqual(r.daten.vorschlaege.map((v) => v.art), ["verlinken", "verschieben", "aufgabe"]);
  assert.deepEqual(r.daten.vorschlaege[2].aufgabe, { text: "Rechnung ablegen", faellig: "2026-11-30" });
  const t = P({ art: "tags", tags: ["Projekt/Atlas", "projekt/atlas", "finanzen"], beleg: "Atlas Projekt", begruendung: "Tags.", sicherheit: "mittel" });
  assert.deepEqual(t.daten.vorschlaege[0].tags, ["Projekt/Atlas", "projekt/atlas", "finanzen"], "Tags nach tags.mjs geprüft, Schreibweise bleibt");
  assert.ok(t.daten.vorschlaege[0].tags.every((x) => !x.startsWith("#")));
  const d = P({ art: "duplikat", ziel: "k1", beleg: "Atlas Projekt", begruendung: "Dasselbe.", sicherheit: "hoch" });
  assert.equal(d.daten.vorschlaege[0].ziel, "k1");
});

test("Posteingang: Ziele nur als Kennungen aus der gesendeten Liste, und nur vom passenden Typ", () => {
  for (const ziel of ["k4", "k99", "k0", "k13", "o3", "o9", "../x.md", "/etc/passwd", "10_projekte/Atlas.md", "K1", "k1 ", "k1\n", "k1/../k2", "", null, 1, ["k1"], { id: "k1" }]) assert.equal(anzahl({ ...gut, ziel }), 0, JSON.stringify(ziel));
  assert.equal(anzahl({ ...gut, ziel: "o1" }), 0, "verlinken verlangt eine Notiz, keinen Ordner");
  assert.equal(anzahl({ ...gut, art: "verschieben", ziel: "k1" }), 0, "verschieben verlangt einen Ordner");
  assert.equal(anzahl({ ...gut, art: "verschieben", ziel: "o1" }), 1);
  assert.equal(anzahl({ ...gut, ziel: "k3" }, { ...ctxP, kandidaten: ["k1", "k2"] }), 0, "k3 gibt es in dieser Anfrage nicht");
  assert.equal(anzahl({ ...gut, art: "duplikat", ziel: "k2" }, { ...ctxP, kandidaten: [] }), 0, "ohne Kandidaten kein Ziel");
});

test("Posteingang: Aufzählungen, Felder, Typen, Längen", () => {
  assert.equal(anzahl({ ...gut, art: "löschen" }), 0);
  assert.equal(anzahl({ ...gut, art: "verlinken " }), 0);
  assert.equal(anzahl({ ...gut, sicherheit: "sehr hoch" }), 0);
  assert.equal(anzahl({ ...gut, zusatz: 1 }), 0, "unbekanntes Feld");
  assert.equal(anzahl({ ...gut, pfad: "x" }), 0);
  assert.equal(anzahl({ ...gut, tags: ["a"] }), 0, "Feld einer anderen Art");
  assert.equal(anzahl({ ...gut, aufgabe: { text: "x" } }), 0);
  assert.equal(anzahl({ ...gut, begruendung: 5 }), 0);
  assert.equal(anzahl({ ...gut, begruendung: "" }), 0);
  assert.equal(anzahl({ ...gut, begruendung: "x".repeat(LIMITS.begruendung) }), 1);
  assert.equal(anzahl({ ...gut, begruendung: "x".repeat(LIMITS.begruendung + 1) }), 0);
  assert.equal(anzahl({ art: "aufgabe", aufgabe: { text: "x".repeat(141) }, beleg: "Atlas Projekt", begruendung: "a", sicherheit: "hoch" }), 0);
  assert.equal(anzahl({ art: "aufgabe", aufgabe: { text: "ok", faellig: "2026-02-30" }, beleg: "Atlas Projekt", begruendung: "a", sicherheit: "hoch" }), 0, "unmögliches Datum");
  assert.equal(anzahl({ art: "aufgabe", aufgabe: { text: "ok", faellig: "morgen" }, beleg: "Atlas Projekt", begruendung: "a", sicherheit: "hoch" }), 0);
  assert.equal(anzahl({ art: "aufgabe", aufgabe: { text: "ok", extra: 1 }, beleg: "Atlas Projekt", begruendung: "a", sicherheit: "hoch" }), 0);
  assert.equal(anzahl({ art: "aufgabe", ziel: "k1", aufgabe: { text: "ok" }, beleg: "Atlas Projekt", begruendung: "a", sicherheit: "hoch" }), 0, "eine Aufgabe hat kein Ziel");
  for (const tags of [[], ["a b"], ["#"], ["123"], ["x".repeat(101)], ["a", "b", "c", "d", "e", "f"], [1], "tag", ["ok", "böse tag"]]) assert.equal(anzahl({ art: "tags", tags, beleg: "Atlas Projekt", begruendung: "a", sicherheit: "hoch" }), 0, JSON.stringify(tags));
});

test("Beleg: wörtlich im gesendeten Text (NFC und Leerraum normalisiert), mindestens 3 Zeichen, höchstens 200", () => {
  assert.equal(anzahl({ ...gut, beleg: "Rechnung März ablegen" }), 1, "mehrfacher Leerraum und Zeilenumbruch zählen als ein Leerzeichen");
  assert.equal(anzahl({ ...gut, beleg: "Rechnung Mürz" }, { ...ctxP, eintrag: "Die Rechnung März" }), 0, "ä (NFC) ist nicht u + Trema… aber:");
  assert.equal(anzahl({ ...gut, beleg: "Rechnung März" }, { ...ctxP, eintrag: "Die Rechnung März" }), 1, "NFD im Beleg, NFC im Text: gleich");
  assert.equal(anzahl({ ...gut, beleg: "atlas projekt" }), 0, "Groß-/Kleinschreibung zählt");
  assert.equal(anzahl({ ...gut, beleg: "Atlas Projekte" }), 0);
  assert.equal(anzahl({ ...gut, beleg: "At" }), 0);
  assert.equal(anzahl({ ...gut, beleg: "   " }), 0);
  assert.equal(anzahl({ ...gut, beleg: "x".repeat(201) }, { ...ctxP, eintrag: "x".repeat(300) }), 0);
  assert.equal(anzahl({ ...gut, beleg: "x".repeat(200) }, { ...ctxP, eintrag: "x".repeat(300) }), 1);
  assert.equal(anzahl({ ...gut, beleg: "Atlas Projekt" }, { ...ctxP, eintrag: "" }), 0);
});

test("Steuer- und Formatzeichen (Unicode-Tags, bidi, Null-Breite, Steuerzeichen) und Zeilenumbrüche in einzeiligen Texten: Vorschlag fällt weg", () => {
  const tag = String.fromCodePoint(0xe0041), zw = String.fromCodePoint(0x200b), bidi = String.fromCodePoint(0x202e), bom = String.fromCodePoint(0xfeff), nul = String.fromCodePoint(0);
  for (const b of [`ok${tag}`, `ok${zw}`, `ok${bidi}`, `${bom}ok`, `ok${nul}`, "ok\nzwei", "ok\ttab", "ok x", "ok\u001bx"]) assert.equal(anzahl({ ...gut, begruendung: b }), 0, JSON.stringify(b));
  // weitere unsichtbare Träger: Variation Selectors, Zeichenverbinder, Füllzeichen, weiches Trennzeichen, Hangul-Filler, Bidi-Marke
  for (const c of [0xfe00, 0xfe01, 0xe0100, 0x200d, 0x200c, 0xad, 0x180e, 0x206a, 0xfff9, 0x3164, 0x61c, 0x34f, 0xffa0, 0x115f]) assert.equal(anzahl({ ...gut, begruendung: `ok${String.fromCodePoint(c)}` }), 0, c.toString(16));
  assert.equal(anzahl({ ...gut, begruendung: "Mit Emoji 😀 ❤\ufe0f und Umlauten äöü." }), 1, "Emoji (mit Darstellungsauswahl) und Umlaute sind erlaubt");
});

test("Anzahl: höchstens 3 Vorschläge, Dubletten fallen weg, der Rest zählt als verworfen", () => {
  const v = (z) => ({ ...gut, ziel: z });
  const r = P([v("k1"), v("k1"), v("k2"), v("k3"), { ...gut, ziel: "o1" }, v("k2")]);
  assert.equal(r.daten.vorschlaege.length, 3);
  assert.deepEqual(r.daten.vorschlaege.map((x) => x.ziel), ["k1", "k2", "k3"]);
  assert.equal(r.verworfen, 3);
});

test("Antwort als Ganzes: kein Objekt, Zusatzfelder oben, fehlendes oder falsches Hauptfeld → { ok: false }; „vorschau“ ist als Marke erlaubt", () => {
  for (const roh of [null, "text", 5, [], { vorschlaege: "x" }, { vorschlaege: {} }, { zusatz: 1 }, { vorschlaege: [], zusatz: 1 }, { vorschau: true }, { vorschlaege: [], vorschau: "ja" }]) {
    assert.equal(pruefeAntwort("posteingang", roh, ctxP).ok, false, JSON.stringify(roh));
  }
  assert.equal(pruefeAntwort("unbekannt", {}, ctxP).ok, false);
  const r = pruefeAntwort("posteingang", { vorschlaege: [gut], vorschau: true }, ctxP);
  assert.equal(r.ok, true); assert.equal(r.vorschau, true);
  assert.equal(pruefeAntwort("posteingang", { vorschlaege: [] }, ctxP).ok, true, "eine leere Liste ist eine gültige Antwort");
});

test("Zusammenfassung: Belege nur aus den gesendeten Zeilen; ein Satz mit unbekanntem Beleg fällt ganz weg; höchstens 5 Sätze", () => {
  const ctx = { zeilen: ["z1", "z2", "z3"] };
  const Z = (s) => pruefeAntwort("zusammenfassung", { saetze: s }, ctx);
  const r = Z([{ text: "Drei neue Notizen.", belege: ["z1", "z2", "z1"] }, { text: "Unbekannt.", belege: ["z1", "z9"] }, { text: "Ohne Beleg.", belege: [] }, { text: "Pfad.", belege: ["../x"] },
    { text: "x".repeat(241), belege: ["z1"] }, { text: "Zu viele.", belege: ["z1", "z2", "z3", "z1", "z2"] }, { text: "Zusatz", belege: ["z1"], extra: 1 }]);
  assert.deepEqual(r.daten.saetze, [{ text: "Drei neue Notizen.", belege: ["z1", "z2"] }]);
  assert.equal(r.verworfen, 6);
  assert.equal(Z(Array.from({ length: 8 }, () => ({ text: "Satz", belege: ["z1"] }))).daten.saetze.length, 5);
});

test("Erwähnungen: jede gesendete Fundstelle höchstens einmal, Urteil aus der Aufzählung, Grund begrenzt", () => {
  const ctx = { fundstellen: ["f1", "f2"] };
  const E = (u) => pruefeAntwort("erwaehnungen", { urteile: u }, ctx).daten.urteile;
  assert.deepEqual(E([{ id: "f1", gemeint: "ja", grund: "Passt." }, { id: "f1", gemeint: "nein", grund: "Doppelt." }, { id: "f2", gemeint: "vielleicht", grund: "x" }, { id: "f3", gemeint: "ja", grund: "x" },
    { id: "f2", gemeint: "unklar", grund: "x".repeat(121) }, { id: "f2", gemeint: "unklar", grund: "Kurz." }]).map((x) => `${x.id}:${x.gemeint}`), ["f1:ja", "f2:unklar"]);
});

test("Ersatz: Länge höchstens 2 × Auswahl + 500, mehrzeilig erlaubt, Steuerzeichen verboten; Warnzeilen für Neues", () => {
  const auswahl = "Ein Satz mit [[Atlas]].";
  const Er = (e, a = auswahl) => pruefeAntwort("ersatz", { ersatz: e }, { auswahl: a });
  assert.equal(Er("Zwei\nZeilen\tmit Tab").ok, true);
  assert.equal(Er("").ok, true, "ein leerer Ersatz (Auswahl löschen) ist formal gültig; das Studio zeigt ihn im Vergleich");
  assert.equal(Er("x".repeat(auswahl.length * 2 + 500)).ok, true);
  assert.equal(Er("x".repeat(auswahl.length * 2 + 501)).ok, false);
  assert.equal(Er(5).ok, false); assert.equal(Er(null).ok, false);
  assert.equal(Er("a\u0000b").ok, false); assert.equal(Er(`a${String.fromCodePoint(0xe0041)}`).ok, false); assert.equal(Er("a‮b").ok, false);
  assert.equal(pruefeAntwort("ersatz", { ersatz: "x", extra: 1 }, { auswahl }).ok, false);
  const w = Er("Neu: [[Geheim]] und ![b](http://evil.example/p.png) und <script>x</script> und https://evil.example/a\n```\ncode\n```\n---\nfm: 1\n---").daten.warnungen.map((x) => x.art).sort();
  assert.deepEqual(w, ["bild", "code", "front-matter", "html", "link-extern", "wikilink"].sort());
  assert.deepEqual(warnungenFuerErsatz("a [[X]] https://a.example", "b [[X]] https://a.example"), [], "was die Auswahl schon hatte, ist keine Warnung");
});

test("Aufgaben (Editor): Belege wörtlich in der Auswahl, höchstens 10, Datum geprüft", () => {
  const ctx = { auswahl: "Morgen die Steuer erledigen und den Vertrag senden." };
  const A = (l) => pruefeAntwort("aufgaben", { aufgaben: l }, ctx);
  const r = A([{ text: "Steuer erledigen", beleg: "die Steuer erledigen", faellig: "2026-11-10" }, { text: "Erfunden", beleg: "das steht nirgends" }, { text: "Vertrag senden", beleg: "den Vertrag senden", faellig: "bald" }]);
  assert.equal(r.daten.aufgaben.length, 1); assert.equal(r.verworfen, 2);
  assert.equal(A(Array.from({ length: 14 }, (_, i) => ({ text: `A${i}`, beleg: "die Steuer" }))).daten.aufgaben.length, 10);
});

test("ki: nein — alle Schreibweisen im Kopf, nie im Text; ohne Kopf oder mit „ki: ja“ erlaubt", () => {
  for (const k of ["ki: nein", "ki: Nein", "KI: NEIN", "ki: no", "ki: false", "ki: aus", "ki: off", "ki: 0", 'ki: "nein"', "ki: 'nein'", "ki:nein", "ki: nein # nur intern", "  ki: nein", "ki:\n  - nein", "ki: [nein]"]) {
    assert.equal(istKiNein(`---\n${k}\n---\n# T\n`), true, k);
    assert.equal(istKiNein(`---\r\ntitel: x\r\n${k.replace(/\n/g, "\r\n")}\r\n---\r\n# T\r\n`), true, `CRLF ${k}`);
  }
  assert.equal(istKiNein(`﻿---\nki: nein\n---\n# T\n`), true, "mit BOM");
  for (const t of ["# T\n\nki: nein\n", "---\ntitel: x\n---\nki: nein\n", "---\nki: ja\n---\n", "---\nki: true\n---\n", "---\nkind: nein\n---\n", "---\nki-notiz: nein\n---\n", "", "---\nki: nein\n"]) assert.equal(istKiNein(t), t === "---\nki: nein\n", JSON.stringify(t));
  assert.equal(istKiNein(null), false); assert.equal(istKiNein(undefined), false);
});

test("JSON aus Text: nackt, mit Code-Zaun, nie ein Array oder Text davor und danach", () => {
  assert.deepEqual(parseJsonAntwort('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonAntwort('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonAntwort('```\n{"a":1}\n```'), { a: 1 });
  for (const x of ['[1]', 'Hier: {"a":1}', '{"a":1} danke', "", "   ", null, 5, "{kaputt", "x".repeat(300_000)]) assert.equal(parseJsonAntwort(x), null, String(x).slice(0, 20));
});

test("Schemas für --json-schema: fest, ohne Zusatzfelder, Kennungen als Aufzählung, Längen gesetzt", () => {
  const sp = schemaFuer("posteingang", { kandidaten: ["k1", "k2"], ordner: ["o1"] });
  assert.equal(sp.additionalProperties, false);
  const item = sp.properties.vorschlaege.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.ziel.enum, ["k1", "k2", "o1"]);
  assert.equal(item.properties.begruendung.maxLength, 160); assert.equal(item.properties.beleg.maxLength, 200);
  assert.equal(sp.properties.vorschlaege.maxItems, 3);
  assert.deepEqual(item.properties.art.enum, ["verlinken", "verschieben", "duplikat", "aufgabe", "tags"]);
  assert.equal(schemaFuer("ersatz", { auswahlLaenge: 100 }).properties.ersatz.maxLength, 700);
  assert.equal(schemaFuer("zusammenfassung", {}).properties.saetze.items.properties.belege.items.enum.length, 60);
  assert.equal(schemaFuer("erwaehnungen", {}).properties.urteile.items.properties.id.enum.length, 25);
  assert.equal(schemaFuer("aufgaben", {}).properties.aufgaben.maxItems, 10);
  assert.equal(schemaFuer("gibt-es-nicht"), null);
  for (const f of S.FUNKTIONEN) JSON.stringify(schemaFuer(f, {})); // lässt sich als JSON schreiben (Argument der CLI)
});
