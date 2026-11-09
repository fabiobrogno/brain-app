// KI-Vorschläge (K4): „Erwähnungen mit KI prüfen“ — der Sammler bestimmt die Fundstellen selbst aus dem Index (der Client schickt nur den Notizpfad), höchstens 25 Stellen mit je ±200 Zeichen
// Kontext (ohne Datei-Kopf) und dem Titel der Zielnotiz; Quellen mit `ki: nein` kommen nirgends vor; Urteile gelten nur für gesendete Fundstellen (fremde und doppelte Kennungen fallen weg);
// Einwilligung je Vault fail-closed; verlinkt wird nie von der KI. Nie das echte `claude` (Tests/Kern/fake-claude-vorschlag.mjs).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pfad, schreibe } from "./hilfe.mjs";
import { szenarioV } from "./ki-vorschlag-hilfe.mjs";

const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
const { pruefeAntwort } = await import(pfad("gemeinsam", "ki-schema.mjs"));
after(() => { beendeAlleProzesse(); });

const ZIEL = "10_projekte/Zebraquarz.md";
const START = { funktion: "erwaehnungen", pfad: ZIEL };
const satz = (i, name = "Zebraquarz") => `Heute sprechen wir über ${name} in Runde ${i} und planen die nächsten Schritte genau.`;

// Ein Vault mit der Zielnotiz „Zebraquarz“ und vier Quellen (davon eine mit `ki: nein` und eine mit Datei-Kopf, der nie hinausgeht)
function vaultMitQuellen({ viele = false } = {}) {
  const s = szenarioV();
  schreibe(s.vault, ZIEL, "# Zebraquarz\n\nDas Projekt.\n");
  schreibe(s.vault, "20_finanzen/Quelle Eins.md", `# Quelle Eins\n\n${satz(1)}\n`);
  schreibe(s.vault, "20_finanzen/Quelle Zwei.md", `---\nbeschreibung: KOPF-GEHEIM-NIE-SENDEN\n---\n# Quelle Zwei\n\n${satz(2)}\n\n${satz(3)}\n`);
  schreibe(s.vault, "20_finanzen/Quelle Drei.md", `# Quelle Drei\n\n${satz(4)}\n`);
  schreibe(s.vault, "20_finanzen/Quelle Nein.md", `---\nki: nein\n---\n# Quelle Nein\n\nQUELLE-NEIN-GEHEIM ${satz(5)}\n`);
  if (viele) for (let n = 0; n < 4; n++) schreibe(s.vault, `30_viele/Viele ${n}.md`, `# Viele ${n}\n\n${Array.from({ length: 8 }, (_, i) => satz(i + 1)).join("\n\n")}\n`);
  return s;
}

test("Sammler: Fundstellen aus dem Index, Kennungen f1…, Titel der Zielnotiz, ±200 Zeichen Kontext ohne Datei-Kopf; `ki: nein` nirgends; stdin = gesendet", async () => {
  const s = vaultMitQuellen();
  const { start, stand } = await s.anfrage(START);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.equal(stand.ergebnis.funktion, "erwaehnungen");
  const roh = s.aufrufe()[0].stdin;
  assert.equal(roh, start.gesendet);
  for (const verboten of ["QUELLE-NEIN-GEHEIM", "Quelle Nein", "KOPF-GEHEIM-NIE-SENDEN", "20_finanzen", "10_projekte", ".md"]) assert.ok(!roh.includes(verboten), `„${verboten}“ geht nie an die KI`);
  const paket = JSON.parse(roh);
  assert.equal(paket.aufgabe, "erwaehnungen");
  assert.deepEqual(Object.keys(paket.daten).sort(), ["fundstellen", "ziel"]);
  assert.deepEqual(paket.daten.ziel, { titel: "Zebraquarz" });
  assert.deepEqual(paket.daten.fundstellen.map((f) => f.id), ["f1", "f2", "f3", "f4"], "vier Stellen in drei erlaubten Notizen");
  for (const f of paket.daten.fundstellen) {
    assert.deepEqual(Object.keys(f).sort(), ["id", "nach", "treffer", "vor"]);
    assert.equal(f.treffer, "Zebraquarz");
    assert.ok(f.vor.length <= 200 && f.nach.length <= 200);
    assert.match(f.vor, /Heute sprechen wir über$/);
  }
  assert.equal(start.ausgenommen, 1, "die Stelle in der Notiz mit „ki: nein“ wird nur gezählt");
  // Das Ergebnis: Notiz und Stelle aus dem Speicher der Werkstatt, ein Urteil je Fundstelle
  assert.deepEqual(stand.ergebnis.urteile.map((u) => u.id), ["f1", "f2", "f3", "f4"]);
  assert.deepEqual(stand.ergebnis.urteile.map((u) => u.gemeint), ["ja", "nein", "unklar", "ja"]);
  for (const u of stand.ergebnis.urteile) { assert.ok(u.pfad.startsWith("20_finanzen/") && !u.pfad.includes("Nein")); assert.equal(u.treffer, "Zebraquarz"); assert.ok(Number.isInteger(u.start)); }
});

test("Kontext: höchstens 200 Zeichen davor und danach, auch bei langen Zeilen", async () => {
  const s = szenarioV();
  schreibe(s.vault, ZIEL, "# Zebraquarz\n\nDas Projekt.\n");
  for (const n of [1, 2, 3]) schreibe(s.vault, `20_finanzen/Lang ${n}.md`, `# Lang ${n}\n\n${"a".repeat(500)} Zebraquarz ${"b".repeat(500)}\n`);
  const { stand } = await s.anfrage(START);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  const paket = JSON.parse(s.aufrufe()[0].stdin);
  assert.equal(paket.daten.fundstellen.length, 3);
  for (const f of paket.daten.fundstellen) { assert.ok(f.vor.length >= 199 && f.vor.length <= 200 && f.nach.length >= 199 && f.nach.length <= 200); assert.ok(/^a+$/.test(f.vor) && /^b+$/.test(f.nach)); }
});

test("Grenze 25: höchstens 25 Fundstellen im Paket, der Rest wird nur gezählt", async () => {
  const s = vaultMitQuellen({ viele: true });
  const { start, stand } = await s.anfrage(START);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  const paket = JSON.parse(s.aufrufe()[0].stdin);
  assert.equal(paket.daten.fundstellen.length, 25);
  assert.deepEqual(paket.daten.fundstellen.map((f) => f.id), Array.from({ length: 25 }, (_, i) => `f${i + 1}`));
  assert.equal(start.geprueft, 25);
  assert.ok(start.gesamt > 25, `gesamt ${start.gesamt}`);
  assert.ok(stand.ergebnis.urteile.length <= 25);
});

test("Urteile nur für gesendete Fundstellen: fremde, doppelte und fehlerhafte Einträge fallen weg, nie ein Pfad", async () => {
  const s = vaultMitQuellen();
  s.szen({ szenario: "fremdes-ziel" });
  const { stand } = await s.anfrage(START);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.deepEqual(stand.ergebnis.urteile.map((u) => [u.id, u.gemeint]), [["f1", "ja"], ["f3", "unklar"]], "f1 nur einmal (die erste), f99, ein Pfad und das Zusatzfeld fallen weg");
  assert.equal(stand.ergebnis.verworfen, 4);
  assert.ok(!JSON.stringify(stand.ergebnis).includes("geheim.md"));
});

test("Mehr als 25 Urteile, Kennung f26 und überlange Gründe: verworfen", async () => {
  const s = vaultMitQuellen();
  s.szen({ szenario: "injektion-befolgt" });
  let r = await s.anfrage(START);
  assert.deepEqual(r.stand.ergebnis.urteile.map((u) => u.id), ["f1", "f2", "f3", "f4"], "f26 war nie gesendet");
  s.szen({ szenario: "zu-lang" });
  r = await s.anfrage(START);
  assert.equal(r.stand.ergebnis.ok, false, "kein einziges gültiges Urteil: nichts wird gezeigt");
  s.szen({ szenario: "schema-falsch" });
  r = await s.anfrage(START);
  assert.equal(r.stand.ergebnis.ok, false);
  s.szen({ szenario: "kaputt" });
  r = await s.anfrage(START);
  assert.equal(r.stand.ergebnis.ok, false);
});

test("Schema-Ebene: Urteile nur mit Kennung aus der Liste, ja/nein/unklar, Grund ≤ 120, keine Zusatzfelder; jede Kennung höchstens einmal", () => {
  const ctx = { fundstellen: ["f1", "f2", "f3"] };
  const gut = { id: "f1", gemeint: "ja", grund: "Passt." };
  const n = (x) => pruefeAntwort("erwaehnungen", { urteile: [x] }, ctx).daten.urteile.length;
  assert.equal(n(gut), 1);
  for (const x of [{ ...gut, id: "f4" }, { ...gut, id: "k1" }, { ...gut, id: "f01" }, { ...gut, id: "../x" }, { ...gut, gemeint: "vielleicht" }, { ...gut, gemeint: true }, { ...gut, grund: "" }, { ...gut, grund: "x".repeat(121) },
    { ...gut, grund: "a\u{e0041}" }, { ...gut, extra: 1 }, { ...gut, pfad: "x" }, null, "f1"]) assert.equal(n(x), 0, JSON.stringify(x));
  const doppelt = pruefeAntwort("erwaehnungen", { urteile: [gut, { ...gut, gemeint: "nein" }, { id: "f2", gemeint: "nein", grund: "Ein Wort." }] }, ctx);
  assert.deepEqual(doppelt.daten.urteile.map((u) => u.id), ["f1", "f2"]);
  assert.equal(doppelt.verworfen, 1);
});

test("`ki: nein`: die Zielnotiz geht nie hinaus; Fundstellen nur in `ki: nein`-Notizen: kein Aufruf", async () => {
  const s = szenarioV();
  schreibe(s.vault, "10_projekte/Zebra Nein.md", "---\nki: nein\n---\n# Zebra Nein\n\nGeheim.\n");
  for (const n of [1, 2, 3]) schreibe(s.vault, `20_finanzen/Q ${n}.md`, `# Q ${n}\n\n${satz(n, "Zebra Nein")}\n`);
  let r = await s.api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", funktion: "erwaehnungen", pfad: "10_projekte/Zebra Nein.md" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "ki-nein");
  schreibe(s.vault, ZIEL, "# Zebraquarz\n\nDas Projekt.\n");
  for (const n of [1, 2, 3]) schreibe(s.vault, `20_finanzen/Nein ${n}.md`, `---\nki: nein\n---\n# Nein ${n}\n\n${satz(n)}\n`);
  r = await s.api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", ...START });
  assert.equal(r.status, 409); assert.equal(r.j.art, "nichts-zu-pruefen"); assert.equal(r.j.ausgenommen, 3);
  assert.deepEqual(s.aufrufe(), []);
});

test("Opt-in fail-closed: ohne Einwilligung, mit gesperrtem Konto oder fremdem Pfad geht nichts hinaus", async () => {
  const aus = vaultMitQuellen();
  aus.setze({ a: "lesen" }, { einwilligung: false });
  let r = await aus.api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", ...START });
  assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung");
  assert.deepEqual(aus.aufrufe(), []);
  const gesperrt = vaultMitQuellen();
  gesperrt.setze({ a: "gesperrt" });
  r = await gesperrt.api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", ...START });
  assert.notEqual(r.status, 200);
  assert.deepEqual(gesperrt.aufrufe(), []);
  const s = vaultMitQuellen();
  for (const p of [undefined, "", "../../etc/passwd", "gibt-es-nicht.md"]) {
    r = await s.api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", funktion: "erwaehnungen", ...(p === undefined ? {} : { pfad: p }) });
    assert.ok(r.status >= 400 && r.status < 500, `${p}: ${r.status}`);
  }
  assert.deepEqual(s.aufrufe(), []);
});

test("Nichts wird geschrieben: kein Verlinken durch die KI, der Vault bleibt unverändert; `anwenden` nimmt keine Erwähnung an", async () => {
  const s = vaultMitQuellen();
  const vorher = s.abbild(s.vault);
  s.szen({ szenario: "injektion-befolgt" });
  const { stand } = await s.anfrage(START);
  assert.equal(stand.ergebnis.ok, true);
  assert.deepEqual(s.abbild(s.vault), vorher);
  const z = await s.api("POST", "/api/ki/vorschlag/anwenden", { id: "f1", token: "x" });
  assert.ok(z.status >= 400);
  assert.deepEqual(s.abbild(s.vault), vorher);
});
