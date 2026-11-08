// Ungelinkte Erwähnungen (gemeinsam/erwaehnungen.mjs, erwaehnungen-index.mjs): Erkennung mit Grenzfällen, Verlinken mit Vorschau, Journal, Rückgängig und Fremdänderung, beide Richtungen
// über den Suchindex. Nur Wegwerf-Ordner (tmp), keine KI, kein Netz.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const E = await import(pfad("gemeinsam", "erwaehnungen.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

// ───────────────────────────── Erkennung ─────────────────────────────
const finde = (text, titel, aliasse = []) => {
  const namen = E.namenEinerNotiz({ titel, aliasse });
  const ab = E.baueAbgleicher(namen.map((n) => ({ id: "ziel", name: n })));
  return E.findeNamen(text, ab, { nurId: "ziel" }).map((t) => t.treffer);
};

test("Wortgrenzen: ganze Wörter, Bindestrich zählt als Grenze, Unterstrich und Zusammensetzung nicht", () => {
  assert.deepEqual(finde("Ich trinke Kaffee. Kaffee, Kaffee!", "Kaffee"), ["Kaffee", "Kaffee", "Kaffee"]);
  assert.deepEqual(finde("Die Kaffeemaschine und der Kaffeeduft", "Kaffee"), []);
  assert.deepEqual(finde("Ohne Kaffee_alt und kaffee2 und 1kaffee", "Kaffee"), []);
  assert.deepEqual(finde("Kaffee-Maschine", "Kaffee"), ["Kaffee"]);
  assert.deepEqual(finde("(Kaffee) „Kaffee“ 'Kaffee'", "Kaffee"), ["Kaffee", "Kaffee", "Kaffee"]);
});

test("Groß/klein, Umlaute und Unicode-Form sind egal", () => {
  for (const t of ["mühle", "MÜHLE", "Muehle", "MUEHLE", "Mühle", "Mühle"]) assert.equal(finde(`Bei der ${t} vorbei`, "Mühle").length, 1, t);
  assert.deepEqual(finde("Die STRASSE und die Straße", "Straße"), ["STRASSE", "Straße"]);
  assert.deepEqual(finde("Café und cafe", "Café"), ["Café", "cafe"]);
  assert.deepEqual(finde("Das Mühlenrad", "Mühle"), [], "Mühlenrad ist ein anderes Wort");
  assert.deepEqual(finde("Wir zahlen, nicht zählen", "Zählen"), ["zählen"], "ein bloßes „zahlen“ ist ein anderes Wort als „Zählen“");
  assert.deepEqual(finde("Muhle und Mühle", "Mühle"), ["Mühle"], "kein Falten von ü zu u");
});

test("Mehrwort-Namen: Leerzeichen, Tabs, Bindestrich und Unterstrich gelten gleich, ein Zeilenumbruch bricht ab", () => {
  assert.deepEqual(finde("Neue Idee, neue  idee, neue\tIdee, neue-idee, neue_idee", "Neue Idee"), ["Neue Idee", "neue  idee", "neue\tIdee", "neue-idee", "neue_idee"]);
  assert.deepEqual(finde("Das ist eine neue\nIdee", "Neue Idee"), []);
  assert.deepEqual(finde("Eine Neue Ideen-Liste", "Neue Idee"), [], "Ideen ≠ Idee");
});

test("Aliasse zählen wie der Titel; ungeeignete Namen nicht", () => {
  assert.deepEqual(finde("Das ist der KI-Assistent von Claude", "Künstliche Intelligenz", ["Claude", "KI"]), ["Claude"], "„KI“ hat weniger als drei Buchstaben");
  assert.equal(E.bereiteName("ab"), null);
  assert.equal(E.bereiteName("2024"), null);
  assert.equal(E.bereiteName("a [[b]] c"), null);
  assert.equal(E.bereiteName("x|y der"), null);
  assert.ok(E.bereiteName("Kaffee"));
});

test("Nichts im Datei-Kopf, in Code, Links, Adressen, Überschriften, Kommentaren, Formeln und Tags", () => {
  const text = [
    "---", "titel: Kaffee", "tags: [Kaffee]", "---",
    "# Kaffee-Überschrift", "",
    "Setext Kaffee", "=====", "",
    "Echter Kaffee im Text.", "",
    "```", "Kaffee im Zaun", "```", "",
    "~~~js", "Kaffee in Tilden", "~~~", "",
    "    Kaffee im eingerückten Block", "",
    "Inline `Kaffee` und ``Kaffee `x` Kaffee`` Code.",
    "Link [[Kaffee]] und [[Kaffee|der Kaffee]] und ![[Kaffee]].",
    "Markdown [Kaffee](kaffee.md) und [mehr](https://x.de/Kaffee) und ![Kaffee](bild.png).",
    "Ref [Kaffee][1] und Fußnote[^Kaffee].",
    "Adresse https://kaffee.de/Kaffee und www.Kaffee.de und kaffee@Kaffee.de und <https://k.de/Kaffee>.",
    "<span title=\"Kaffee\">x</span> <!-- Kaffee --> #Kaffee @Kaffee",
    "Formel $Kaffee + 1$ und Preis 5$ für Kaffee.",
    "$$", "Kaffee", "$$",
    "[1]: https://kaffee.de Kaffee",
    "Noch ein Kaffee am Ende.",
  ].join("\n");
  const t = finde(text, "Kaffee");
  assert.equal(t.length, 3, JSON.stringify(t));
  const stellen = E.stellenAus(text, E.findeNamen(text, E.baueAbgleicher(E.namenEinerNotiz({ titel: "Kaffee" }).map((n) => ({ id: "z", name: n }))), { nurId: "z" }));
  assert.deepEqual(stellen.map((s) => s.auszug), ["Echter Kaffee im Text.", "Formel $Kaffee + 1$ und Preis 5$ für Kaffee.", "Noch ein Kaffee am Ende."]);
});

test("Ein längerer Name einer anderen Notiz gewinnt; ein Name zweier Notizen ist mehrdeutig", () => {
  const a = E.baueAbgleicher([
    { id: "kaffee", name: E.bereiteName("Kaffee") },
    { id: "maschine", name: E.bereiteName("Kaffee Maschine") },
  ]);
  const r = E.findeNamen("Eine Kaffee Maschine und ein Kaffee.", a);
  assert.deepEqual(r.map((x) => [x.id, x.treffer]), [["maschine", "Kaffee Maschine"], ["kaffee", "Kaffee"]]);
  const b = E.baueAbgleicher([{ id: "x", name: E.bereiteName("Mühle") }, { id: "y", name: E.bereiteName("Muehle") }]);
  assert.deepEqual(E.findeNamen("Eine Mühle", b).map((x) => x.id), [null]);
});

test("Links setzen: [[Titel]] bei gleichem Text, sonst [[Titel|Text]]; alles andere bleibt Byte für Byte", () => {
  const text = "\ufeffZeile eins\r\nIch mag kaffee und Kaffee.\r\nEnde";
  const ab = E.baueAbgleicher([{ id: "z", name: E.bereiteName("Kaffee") }]);
  const tr = E.findeNamen(text, ab, { nurId: "z" });
  assert.equal(tr.length, 2);
  const stellen = tr.map((t) => ({ start: t.start, ende: t.ende, treffer: t.treffer, link: E.linkFuer(text, t, "Kaffee") }));
  assert.deepEqual(stellen.map((s) => s.link), ["[[Kaffee|kaffee]]", "[[Kaffee]]"]);
  assert.equal(E.setzeLinks(text, stellen), "\ufeffZeile eins\r\nIch mag [[Kaffee|kaffee]] und [[Kaffee]].\r\nEnde");
  assert.equal(E.linkFuer(text, tr[0], "wissen/kaffee|Kaffee"), "[[wissen/kaffee|kaffee]]");
  assert.equal(E.linkFuer(text, tr[1], "wissen/kaffee|Kaffee"), "[[wissen/kaffee|Kaffee]]");
});

test("Tabellen: in Zeilen einer Tabelle (mit oder ohne führendes |) wird nie verlinkt; ohne Trennzeile ist es keine Tabelle", () => {
  const ab = E.baueAbgleicher([{ id: "z", name: E.bereiteName("Kaffee") }]);
  const n = (t) => E.findeNamen(t, ab, { nurId: "z" }).length;
  assert.equal(n("Kaffee | 3\n--- | ---\nKaffee | 4\n\nKaffee im Text."), 1, "nur der Satz außerhalb der Tabelle");
  assert.equal(n("| Name | Preis |\n|:--|--:|\n| Kaffee | 3 |\n\nKaffee danach."), 1);
  assert.equal(n("Coffee | Kaffee\nund Kaffee"), 2, "ohne Trennzeile ist es keine Tabelle");
  const t = "Kaffee | 3\n--- | ---\nKaffee | 4\n";
  const [, lauf] = [0, E.findeNamen(t, ab, { nurId: "z" })];
  assert.equal(lauf.length, 0);
});

test("Ausgeschlossen: [Kaffee], Kaffee.md, %%…%%, <pre>, HTML-Blöcke", () => {
  const ab = E.baueAbgleicher([{ id: "z", name: E.bereiteName("Kaffee") }]);
  const n = (t) => E.findeNamen(t, ab, { nurId: "z" }).length;
  assert.equal(n("Siehe [Kaffee] und Kaffee.md und %%Kaffee%% hier."), 0);
  assert.equal(n("<pre>\nKaffee\n</pre>\n\nKaffee echt."), 1);
  assert.equal(n("<details>\nKaffee\n</details>"), 0);
});

test("Stelle wiederfinden: nach Änderungen davor, bei Änderung an der Stelle nicht", () => {
  const ab = E.baueAbgleicher([{ id: "z", name: E.bereiteName("Kaffee") }]);
  const alt = "Ein Satz mit Kaffee darin.\nNoch einer.";
  const [t0] = E.findeNamen(alt, ab, { nurId: "z" });
  const gezeigt = E.stellenAus(alt, [t0])[0];
  const davor = "Neue erste Zeile.\n" + alt;
  assert.ok(E.findeWieder(davor, E.findeNamen(davor, ab, { nurId: "z" }), gezeigt), "verschoben, aber derselbe Satz");
  const geaendert = "Ein Satz mit Kaffee und Tee darin.\nNoch einer.";
  assert.equal(E.findeWieder(geaendert, E.findeNamen(geaendert, ab, { nurId: "z" }), gezeigt), null, "die Umgebung ist eine andere");
});

// ───────────────────────────── Vault: beide Richtungen, Verlinken, Rückgängig ─────────────────────────────
function aufbau(dateien) {
  const d = tmp("erw-vault-"), support = tmp("erw-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  const v = oeffneVault(d, { support, heute: "2026-11-05" });
  return { d, support, v };
}
const lies = (d, p) => readFileSync(join(d, p), "utf8");
const KAFFEE = "---\naliases: [Bohnenbrühe]\n---\n# Kaffee\n\nDer Text über Kaffee.\n";

test("Erwähnungen: nur echte Stellen, mit Zeile, Auszug und Markierung; verlinkte, Code und die Notiz selbst nicht", async () => {
  const { v } = aufbau({
    "wissen/kaffee.md": KAFFEE,
    "notizen/a.md": "# A\n\nHeute gab es Kaffee und später Bohnenbrühe.\nDer [[Kaffee]] ist verlinkt.\n```\nKaffee im Code\n```\n",
    "notizen/b.md": "# B\n\nNur Kaffeemaschine hier.\n",
    "notizen/c.md": "# C\n\nKaffee\n",
    "notizen/d.md": "# D\n\nTee.\n",
  });
  const r = await v.erwaehnungen("wissen/kaffee.md");
  assert.equal(r.vollstaendig, true);
  assert.deepEqual(r.notizen.map((n) => n.pfad).sort(), ["notizen/a.md", "notizen/c.md"]);
  const a = r.notizen.find((n) => n.pfad === "notizen/a.md");
  assert.deepEqual(a.stellen.map((s) => [s.zeile, s.treffer, s.art]), [[3, "Kaffee", "titel"], [3, "Bohnenbrühe", "alias"]]);
  assert.equal(a.stellen[0].auszug, "Heute gab es Kaffee und später Bohnenbrühe.");
  assert.deepEqual(a.stellen[0].markierung, [13, 19]);
  assert.equal(r.anzahlStellen, 3);
  assert.deepEqual(r.namen, ["Kaffee", "Bohnenbrühe"]);
});

test("Erwähnungen: eine zweite Notiz mit gleichem Titel macht den Namen mehrdeutig, ein längerer Titel überdeckt", async () => {
  const { v } = aufbau({
    "a/kaffee.md": "# Kaffee\n", "b/kaffee-zwei.md": "# Kaffee\n",
    "c/tee.md": "# Tee\n", "c/gruen.md": "# Grüner Tee\n",
    "x/text.md": "# X\n\nKaffee und Tee und Grüner Tee.\n",
  });
  const k = await v.erwaehnungen("a/kaffee.md");
  assert.equal(k.notizen.length, 0);
  assert.equal(k.mehrdeutig, true);
  const t = await v.erwaehnungen("c/tee.md");
  assert.deepEqual(t.notizen[0].stellen.map((s) => s.treffer), ["Tee"], "„Grüner Tee“ gehört der anderen Notiz");
  const g = await v.erwaehnungen("c/gruen.md");
  assert.deepEqual(g.notizen[0].stellen.map((s) => s.treffer), ["Grüner Tee"]);
});

test("Gegenrichtung: Diese Notiz erwähnt … (auch ungespeicherter Text), ohne die Notiz selbst und ohne verlinkte", async () => {
  const { v } = aufbau({
    "wissen/kaffee.md": KAFFEE, "wissen/tee.md": "# Tee\n", "wissen/mühle.md": "# Mühle\n", "00_inbox/idee.md": "# Idee\n", "x/aktuell.md": "# Aktuell\n",
  });
  const text = "# Aktuell\n\nKaffee, [[Tee]], die Muehle und Idee, dazu Aktuell selbst.\n";
  const r = await v.erwaehntVon("x/aktuell.md", text);
  assert.deepEqual(r.notizen.map((n) => n.pfad).sort(), ["wissen/kaffee.md", "wissen/mühle.md"], "Tee ist verlinkt, die Inbox-Notiz ist kein Ziel, die eigene nicht");
  assert.equal(r.notizen.find((n) => n.pfad === "wissen/mühle.md").stellen[0].treffer, "Muehle");
});

test("Verlinken: Vorschau, ein Ort, Journal und Aktivität, Rückgängig und Wiederherstellen", async () => {
  const { d, v, support } = aufbau({
    "wissen/kaffee.md": KAFFEE,
    "notizen/a.md": "# A\n\nGab Kaffee.\n\nNoch Kaffee.\n",
    "notizen/b.md": "# B\n\nKaffee hier.\n",
  });
  const r0 = await v.erwaehnungen("wissen/kaffee.md");
  const a = r0.notizen.find((n) => n.pfad === "notizen/a.md");
  const stelle = { pfad: "notizen/a.md", start: a.stellen[1].start, treffer: "Kaffee", vor: a.stellen[1].vor, nach: a.stellen[1].nach };
  const vor = await v.verlinke({ ziel: "wissen/kaffee.md", stellen: [stelle], vorschau: true });
  assert.equal(vor.verweise, 1); assert.equal(vor.notizen, 1); assert.equal(vor.liste[0].zeilen[0].nachher, "Noch [[Kaffee]].");
  assert.equal(lies(d, "notizen/a.md"), "# A\n\nGab Kaffee.\n\nNoch Kaffee.\n", "die Vorschau schreibt nichts");
  const e = await v.verlinke({ ziel: "wissen/kaffee.md", stellen: [stelle], token: vor.token });
  assert.equal(e.ok, true); assert.deepEqual(e.dateien, [{ pfad: "notizen/a.md", anzahl: 1 }]);
  assert.equal(lies(d, "notizen/a.md"), "# A\n\nGab Kaffee.\n\nNoch [[Kaffee]].\n");
  assert.equal(lies(d, "notizen/b.md"), "# B\n\nKaffee hier.\n");
  assert.ok(e.vorgang && e.aktivitaetId);
  const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
  const ev = A.leseEreignisse(support, A.kennungVault(d)).find((x) => x.id === e.aktivitaetId);
  assert.equal(ev.art, "datei-aktion"); assert.deepEqual(ev.pfade, ["notizen/a.md"]); assert.match(ev.text, /1 Erwähnung von „Kaffee“ verlinkt/);
  assert.equal(ev.rueckgaengig.art, "vorgang");
  // Rückgängig
  const z = await v.vorgangZurueck({ id: e.vorgang });
  assert.equal(z.ok, true);
  assert.equal(lies(d, "notizen/a.md"), "# A\n\nGab Kaffee.\n\nNoch Kaffee.\n");
  // Wiederherstellen
  await v.vorgangWieder({ id: e.vorgang });
  assert.equal(lies(d, "notizen/a.md"), "# A\n\nGab Kaffee.\n\nNoch [[Kaffee]].\n");
  // Die Erwähnung ist weg, sobald der Index die Änderung kennt
  v.suchindexAendere(["notizen/a.md"]); await v.suchindexRuhe();
  const r1 = await v.erwaehnungen("wissen/kaffee.md");
  assert.deepEqual(r1.notizen.find((n) => n.pfad === "notizen/a.md").stellen.map((s) => s.zeile), [3]);
});

test("Rückgängig nach einer weiteren Änderung der Notiz: 409 und nichts wird überschrieben", async () => {
  const { d, v } = aufbau({ "wissen/kaffee.md": "# Kaffee\n", "n/a.md": "# A\n\nKaffee.\n" });
  const r0 = await v.erwaehnungen("wissen/kaffee.md");
  const s = r0.notizen[0].stellen[0];
  const e = await v.verlinke({ ziel: "wissen/kaffee.md", stellen: [{ pfad: "n/a.md", start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }] });
  writeFileSync(join(d, "n/a.md"), lies(d, "n/a.md") + "Neuer Absatz von Hand.\n");
  await assert.rejects(() => v.vorgangZurueck({ id: e.vorgang }), (err) => err.status === 409 && err.extra?.art === "geaendert");
  assert.match(lies(d, "n/a.md"), /Neuer Absatz von Hand/);
  assert.match(lies(d, "n/a.md"), /\[\[Kaffee\]\]/);
});

test("Fremdänderung zwischen Anzeige und Klick: verschobene Stelle wird gefunden, geänderte übersprungen, nichts Falsches geschrieben", async () => {
  const { d, v } = aufbau({ "wissen/kaffee.md": "# Kaffee\n", "n/a.md": "# A\n\nGab es Kaffee.\n", "n/b.md": "# B\n\nGab es Kaffee.\n" });
  const r0 = await v.erwaehnungen("wissen/kaffee.md");
  const st = (p) => { const s = r0.notizen.find((n) => n.pfad === p).stellen[0]; return { pfad: p, start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }; };
  // a: oben ein Absatz dazu (Stelle verschoben, Umgebung gleich) · b: der Satz wurde umgeschrieben
  writeFileSync(join(d, "n/a.md"), "# A\n\nNeuer Absatz oben.\n\nGab es Kaffee.\n");
  writeFileSync(join(d, "n/b.md"), "# B\n\nGab es Kaffee und Tee.\n");
  const e = await v.verlinke({ ziel: "wissen/kaffee.md", stellen: [st("n/a.md"), st("n/b.md")] });
  assert.equal(lies(d, "n/a.md"), "# A\n\nNeuer Absatz oben.\n\nGab es [[Kaffee]].\n");
  assert.equal(lies(d, "n/b.md"), "# B\n\nGab es Kaffee und Tee.\n");
  assert.deepEqual(e.dateien.map((x) => x.pfad), ["n/a.md"]);
  assert.equal(e.uebersprungen.length, 1); assert.equal(e.uebersprungen[0].pfad, "n/b.md");
});

test("Fremdänderung nach der Vorschau („Alle verlinken“): veraltetes Token → 409 vorschau-veraltet, nichts geschrieben", async () => {
  const { d, v } = aufbau({ "wissen/kaffee.md": "# Kaffee\n", "n/a.md": "# A\n\nKaffee.\n", "n/b.md": "# B\n\nKaffee.\n" });
  const vor = await v.verlinke({ ziel: "wissen/kaffee.md", alle: true, vorschau: true });
  assert.equal(vor.verweise, 2); assert.equal(vor.notizen, 2);
  writeFileSync(join(d, "n/b.md"), "# B\n\nKaffee. Dazu Kaffee.\n");
  await assert.rejects(() => v.verlinke({ ziel: "wissen/kaffee.md", alle: true, token: vor.token }), (err) => err.status === 409 && err.extra?.art === "vorschau-veraltet");
  assert.equal(lies(d, "n/a.md"), "# A\n\nKaffee.\n");
  const neu = await v.verlinke({ ziel: "wissen/kaffee.md", alle: true, vorschau: true });
  assert.equal(neu.verweise, 3);
  const e = await v.verlinke({ ziel: "wissen/kaffee.md", alle: true, token: neu.token });
  assert.equal(e.ok, true);
  assert.equal(lies(d, "n/b.md"), "# B\n\n[[Kaffee]]. Dazu [[Kaffee]].\n");
  await v.vorgangZurueck({ id: e.vorgang });
  assert.equal(lies(d, "n/a.md"), "# A\n\nKaffee.\n"); assert.equal(lies(d, "n/b.md"), "# B\n\nKaffee. Dazu Kaffee.\n");
});

test("Verlinken schreibt nie in Geschütztes: Archiv, Vorlagen und die Notiz selbst bleiben unberührt; Eingaben werden geprüft", async () => {
  const { d, v } = aufbau({ "wissen/kaffee.md": "# Kaffee\n", "90_archiv/alt.md": "Kaffee\n", "01_vorlagen/v.md": "Kaffee\n", "n/ok.md": "Kaffee\n" });
  const r = await v.erwaehnungen("wissen/kaffee.md");
  assert.deepEqual(r.notizen.map((n) => n.pfad), ["n/ok.md"]);
  const e = await v.verlinke({ ziel: "wissen/kaffee.md", stellen: [{ pfad: "90_archiv/alt.md", start: 0, treffer: "Kaffee" }, { pfad: "wissen/kaffee.md", start: 2, treffer: "Kaffee" }] });
  assert.equal(e.unveraendert, true);
  assert.equal(lies(d, "90_archiv/alt.md"), "Kaffee\n");
  await assert.rejects(() => v.verlinke({ ziel: "wissen/kaffee.md", stellen: [] }), (err) => err.status === 400);
  await assert.rejects(() => v.verlinke({ ziel: "../x.md", alle: true }), (err) => err.status === 400 || err.status === 403);
  await assert.rejects(() => v.verlinke({ ziel: "wissen/kaffee.md", stellen: [{ pfad: "n/ok.md", start: -1, treffer: "x" }] }), (err) => err.status === 400);
});

test("Linkziel: Titel genügt, wenn er eindeutig ist; führt der Titel woandershin (gleichnamige Datei), steht der Pfad im Link", async () => {
  const { d, v } = aufbau({ "a/kaffee.md": "# Espresso\n", "b/espresso.md": "# Anders\n", "n/x.md": "Ein Espresso am Morgen.\n", "m/tee.md": "# Tee\n", "n/y.md": "Ein Tee am Abend.\n" });
  const e = await v.verlinke({ ziel: "a/kaffee.md", alle: true });
  assert.equal(e.ok, true);
  assert.equal(lies(d, "n/x.md"), "Ein [[a/kaffee|Espresso]] am Morgen.\n", "[[Espresso]] würde die Datei b/espresso.md treffen");
  const t = await v.verlinke({ ziel: "m/tee.md", alle: true });
  assert.equal(t.ok, true);
  assert.equal(lies(d, "n/y.md"), "Ein [[Tee]] am Abend.\n");
});

test("Links für den offenen Text: auch ungespeichert, mit Wiederfinden nach Änderungen, Tabellenzeilen und Vorschauzeilen; schreibt nichts", async () => {
  const { d, v } = aufbau({ "wissen/kaffee.md": "# Kaffee\n", "wissen/tee.md": "# Tee\n", "x/a.md": "# A\n\nAlt.\n" });
  const text = "# A\n\nKaffee und Tee am Morgen.\n\n| a | b |\n|---|---|\n| Kaffee | tee |\n\nUnd Kaffee.\n";
  const alle = await v.erwaehnungenLinks({ pfad: "x/a.md", text, alle: true });
  assert.deepEqual(alle.aenderungen.map((a) => [a.link, a.zeile]), [["[[Kaffee]]", 3], ["[[Tee]]", 3], ["[[Kaffee]]", 9]], "die Tabelle bleibt unberührt");
  assert.equal(alle.uebersprungen, 0);
  assert.equal(alle.aenderungen[0].nachher, "[[Kaffee]] und Tee am Morgen.");
  // einzelne Stelle, Text inzwischen weitergetippt (Stelle verschoben)
  const r0 = await v.erwaehntVon("x/a.md", text);
  const s = r0.notizen.find((n) => n.pfad === "wissen/tee.md").stellen[0];
  const neu = "# A\n\nNeuer Absatz.\n\n" + text.slice(5);
  const e = await v.erwaehnungenLinks({ pfad: "x/a.md", text: neu, stellen: [{ ziel: "wissen/tee.md", start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }] });
  assert.equal(e.aenderungen.length, 1); assert.equal(neu.slice(e.aenderungen[0].start, e.aenderungen[0].ende), "Tee");
  // Stelle, die es im übergebenen Text nicht mehr gibt
  const weg = await v.erwaehnungenLinks({ pfad: "x/a.md", text: "# A\n\nNichts mehr.\n", stellen: [{ ziel: "wissen/tee.md", start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }] });
  assert.deepEqual(weg, { aenderungen: [], uebersprungen: 1 });
  assert.equal(lies(d, "x/a.md"), "# A\n\nAlt.\n", "geschrieben wird hier nichts");
  await assert.rejects(() => v.erwaehnungenLinks({ pfad: "x/a.md", stellen: [] }), (err) => err.status === 400);
  await assert.rejects(() => v.erwaehnungenLinks({ pfad: "x/a.md", text: "x", stellen: [] }), (err) => err.status === 400);
});

test("Routen: GET /api/erwaehnungen, POST /aus und /verlinken mit Vorschau; Rückgängig über das Protokoll", async () => {
  const support = tmp("erw-r-support-"), d = tmp("erw-r-vault-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, "wissen/kaffee.md", "# Kaffee\n"); schreibe(d, "n/a.md", "# A\n\nKaffee!\n"); schreibe(d, "n/tee.md", "# Tee\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { modus: "poll", pollMs: 80, entprellMs: 40 } });
  const rufe = async (methode, p, daten) => { const [pf, q] = p.split("?"); const r = await h({ methode, pfad: pf, query: q || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* */ } return { status: r.status, j }; };
  const g = await rufe("GET", "/api/erwaehnungen?pfad=" + encodeURIComponent("wissen/kaffee.md"));
  assert.equal(g.status, 200); assert.equal(g.j.notizen[0].pfad, "n/a.md");
  assert.equal((await rufe("POST", "/api/erwaehnungen", {})).status, 405);
  assert.equal((await rufe("GET", "/api/erwaehnungen")).status, 400);
  const aus = await rufe("POST", "/api/erwaehnungen/aus", { pfad: "n/a.md", text: "# A\n\nTee und Kaffee, noch ungespeichert.\n" });
  assert.equal(aus.status, 200); assert.deepEqual(aus.j.notizen.map((n) => n.pfad).sort(), ["n/tee.md", "wissen/kaffee.md"]);
  const s = g.j.notizen[0].stellen[0];
  const vorschau = await rufe("POST", "/api/erwaehnungen/verlinken", { ziel: "wissen/kaffee.md", stellen: [{ pfad: "n/a.md", start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }], vorschau: true });
  assert.equal(vorschau.status, 200); assert.equal(vorschau.j.liste[0].zeilen[0].nachher, "[[Kaffee]]!");
  const e = await rufe("POST", "/api/erwaehnungen/verlinken", { ziel: "wissen/kaffee.md", stellen: [{ pfad: "n/a.md", start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach }], token: vorschau.j.token });
  assert.equal(e.status, 200); assert.equal(lies(d, "n/a.md"), "# A\n\n[[Kaffee]]!\n");
  assert.ok(e.j.aktivitaetId);
  const z = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.j.aktivitaetId });
  assert.equal(z.status, 200); assert.equal(z.j.art, "zurueck");
  assert.equal(lies(d, "n/a.md"), "# A\n\nKaffee!\n");
  const log = (await rufe("GET", "/api/aktivitaet?art=rueckgaengig")).j.ereignisse[0];
  assert.match(log.text, /Verlinken zurückgenommen/);
  assert.ok(!existsSync(join(d, "x")));
});
