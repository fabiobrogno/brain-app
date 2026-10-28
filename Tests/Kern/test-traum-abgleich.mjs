// .tools/tests/test-traum-abgleich.mjs — Traum (tageslauf/traum.mjs) und Abgleich (gedaechtnis.mjs) greifen ineinander: gleiches Konflikt-Format, gleiche Projekt-Schlüssel,
// Traum-Übernahme wird vom nächsten Abgleich verteilt (nie zurückgedreht), der Traum gleicht vor seinem Lauf ab. Alles mit Fake-Konten und Fake-Sonnet in Temp-Ordnern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isoliere, git, JETZT } from "./tageslauf-hilfe.mjs";
import { fakeSonnet, FAKE_SONNET } from "./pflege-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { traumAufbau, traumRegel, GUTER_TRAUM, DATEIEN, KEY, fm, VERLAUF } from "./traum-hilfe.mjs";
import { gleicheAb, blobHash, konfliktZeile, istKonfliktKopie } from "../gedaechtnis.mjs";
const T = await import("../tageslauf/traum.mjs");
const E = await import("../tageslauf/traum-eingabe.mjs");
const R = await import("../rueckfragen.mjs");
const A = await import("../tageslauf/antworten.mjs");
isoliere();

const rfTraum = (v) => R.listeRueckfragen(v).filter((r) => r.typ === "traum");
const memoryDir = (a, i, key = KEY) => join(a.konten[i], "projects", key, "memory");
const liesDir = (dir) => Object.fromEntries(readdirSync(dir).sort().map((n) => [n, readFileSync(join(dir, n), "utf8")]));
const abgleichen = (a, extra = {}) => gleicheAb({ wurzel: a.wurzel, konten: a.konten, anwenden: true, ...extra });
// Die Fake-Konten gelten für den Abgleich erst als Claude-Konten, wenn sie settings.json oder projects/ haben.
const mitKonten = (a) => { for (const k of a.konten) { mkdirSync(join(k, "projects"), { recursive: true }); writeFileSync(join(k, "settings.json"), "{}\n"); } return a; };
const eingespielt = (opt) => { const a = mitKonten(traumAufbau(opt)); const r = abgleichen(a); assert.equal(r.ok, true, JSON.stringify(r.fehler)); return a; };
const manifest = (a, konto, key = KEY) => JSON.parse(readFileSync(join(a.wurzel, ".abgleich", konto, `${key}.json`), "utf8"));
const manifestNamen = (a) => readdirSync(join(a.wurzel, ".abgleich")).sort();

// ---------- c) Traum-Übernahme → Abgleich ----------
test("Traum-Übernahme: der nächste Abgleich verteilt den Traum-Stand an BEIDE Konten und dreht ihn nicht zurück; Manifeste stimmen; danach nichts zu tun", async () => {
  const a = eingespielt({ automatik: { gedaechtnisTeilen: "an" } });
  for (const i of [0, 1]) assert.deepEqual(liesDir(memoryDir(a, i)), DATEIEN, `Ausgangslage: Konto ${i} hat den Stand der Wurzel`);
  const s = fakeSonnet([traumRegel(GUTER_TRAUM)]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(s.anzahl(), 1);
  assert.equal(ctx.traumBericht.projekte[0].status, "vorgelegt", JSON.stringify(ctx.traumBericht.projekte[0]));
  R.beantworte(a.v, rfTraum(a.v)[0].id, "uebernehmen");
  A.wendeAntwortenAn(a.ctx());
  const traumStand = liesDir(a.dir);
  assert.ok(traumStand["feedback_emoji.md"], "der Traum-Commit liegt in der Wurzel");
  assert.match(git(a.wurzel, "log", "-1", "--format=%s"), /^traum\(/);
  for (const i of [0, 1]) assert.ok(!existsSync(join(memoryDir(a, i), "feedback_emoji.md")), "die Konten kennen den Traum-Stand noch nicht");

  const r = abgleichen(a);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.nichtsZuTun, false);
  assert.deepEqual(liesDir(a.dir), traumStand, "die Wurzel behält den Traum-Stand (nicht zurückgedreht)");
  for (const i of [0, 1]) assert.deepEqual(liesDir(memoryDir(a, i)), traumStand, `Konto ${i} hat den Traum-Stand`);
  assert.ok(!readdirSync(a.dir).some(istKonfliktKopie), "keine Konflikt-Kopien");
  const namen = manifestNamen(a);
  assert.equal(namen.length, 2);
  const soll = Object.fromEntries(Object.entries(traumStand).map(([n, t]) => [n, blobHash(Buffer.from(t, "utf8"))]));
  for (const n of namen) assert.deepEqual(manifest(a, n), soll, `Manifest ${n} = Traum-Stand`);
  assert.equal(abgleichen(a).nichtsZuTun, true);
  assert.equal(git(a.wurzel, "status", "--porcelain"), "", "die Wurzel ist sauber committet");
});

test("Traum-Übernahme und eine Änderung eines Kontos im selben Abgleich: beides bleibt (Traum nicht zurückgedreht, Konto-Datei nicht verloren)", async () => {
  const a = eingespielt({ automatik: { gedaechtnisTeilen: "an" } });
  fakeSonnet([traumRegel(GUTER_TRAUM)]);
  await T.traumSchritt(a.ctx());
  R.beantworte(a.v, rfTraum(a.v)[0].id, "uebernehmen");
  A.wendeAntwortenAn(a.ctx());
  writeFileSync(join(memoryDir(a, 1), "reference_neu.md"), `${fm("reference_neu", "reference")}\nNeu aus Konto B.\n`);     // Konto B legt zwischendurch etwas Neues an
  const r = abgleichen(a);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const stand = liesDir(a.dir);
  assert.ok(stand["feedback_emoji.md"] && stand["reference_neu.md"]);
  for (const i of [0, 1]) assert.deepEqual(liesDir(memoryDir(a, i)), stand, `Konto ${i}`);
  assert.equal(abgleichen(a).nichtsZuTun, true);
});

test("Tageslauf: Antworten werden VOR dem Konten-Abgleich angewendet — eine noch nicht abgeglichene Konto-Änderung an einer berührten Datei entwertet die Freigabe nicht (Befund 3)", async () => {
  const a = eingespielt({ automatik: { gedaechtnisTeilen: "an" } });
  fakeSonnet([traumRegel(GUTER_TRAUM)]);
  await T.traumSchritt(a.ctx());
  const rf = rfTraum(a.v)[0];
  R.beantworte(a.v, rf.id, "uebernehmen");
  // Konto A schreibt (noch nicht abgeglichen) in eine vom Patch berührte Datei der Konten — der Abgleich DANACH würde sie in die Wurzel tragen und den Fingerabdruck ändern
  writeFileSync(join(memoryDir(a, 0), "feedback_deutsch.md"), `${DATEIEN["feedback_deutsch.md"]}Zeile aus Konto A.\n`);
  const { tageslauf } = await import("../tageslauf.mjs");
  const { FAKE_SONNET_BEFEHL } = await import("./pflege-hilfe.mjs");
  const r = await tageslauf(a.v, { nurAntworten: true, claudeBefehl: FAKE_SONNET_BEFEHL, jetzt: JETZT + 3600e3 });
  assert.ok(["ok", "teilweise"].includes(r.status), JSON.stringify(r));
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "angewendet", "die Freigabe wurde noch auf dem Stand angewendet, auf dem der Traum rechnete");
  assert.ok(git(a.wurzel, "log", "--format=%s").split("\n").some((x) => /^traum\(/.test(x)), "Traum-Commit in der Wurzel");
});

// ---------- b) Konflikt-Kopie aufgelöst: Traum → Abgleich ----------
test("Konflikt-Kopie: der Abgleich schreibt Name und _konflikte.md, der Traum erkennt GENAU das; nach „Übernehmen“ räumt der nächste Abgleich die aufgelöste Kopie überall weg", async () => {
  const a = eingespielt({ automatik: { gedaechtnisTeilen: "an" }, verlaeufe: [] });
  const namen = manifestNamen(a);
  const kontoB = namen[1];
  // beide Konten ändern dieselbe Zeile verschieden → der Abgleich legt die Konflikt-Kopie an (Name des zweiten Kontos steht im Dateinamen)
  writeFileSync(join(memoryDir(a, 0), "feedback_deutsch.md"), DATEIEN["feedback_deutsch.md"].replace("Auch Statuszeilen.", "Auch Statuszeilen (A)."));
  writeFileSync(join(memoryDir(a, 1), "feedback_deutsch.md"), DATEIEN["feedback_deutsch.md"].replace("Auch Statuszeilen.", "Auch Statuszeilen (B)."));
  const r = abgleichen(a);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const kopieName = `feedback_deutsch.konflikt-${kontoB}.md`;
  assert.equal(r.plan.projekte[0].konflikte[0].kopie, kopieName);
  const projekt = E.leseProjekt(a.wurzel, KEY);
  assert.deepEqual(projekt.konflikte, [kopieName], "der Traum findet die Kopie");
  assert.equal(projekt.hatKonfliktListe, true, "… und den Eintrag, den der Abgleich geschrieben hat");
  assert.ok(E.anlassFuer(projekt, []).gruende.some((g) => /Konflikt-Kopien \(1\)/.test(g)));

  // der Traum löst auf: Kopie bleibt (status: aufgeloest), die Zeile verschwindet aus _konflikte.md
  const original = readFileSync(join(a.dir, "feedback_deutsch.md"), "utf8"), kopieText = readFileSync(join(a.dir, kopieName), "utf8");
  const aufgeloest = `${kopieText.replace(/\n---\n/, "\nstatus: aufgeloest\n---\n")}\nAufgelöst in feedback_deutsch.md\n`;     // status: aufgeloest als eigene Zeile im Frontmatter
  // Die Zeile der Kopie wird WÖRTLICH übernommen (nicht umformuliert): so hat jede Zeile eine Herkunft, und die aufgelöste Kopie geht nicht verloren.
  fakeSonnet([traumRegel({ dateien: { "feedback_deutsch.md": original.replace("Auch Statuszeilen (A).", "Auch Statuszeilen (A).\nAuch Statuszeilen (B)."), [kopieName]: aufgeloest, "_konflikte.md": "" },
    bericht: [{ datei: "feedback_deutsch.md", art: "konflikt", grund: "beide Fassungen zusammengeführt", beleg: "" }, { datei: kopieName, art: "konflikt", grund: "aufgelöst in feedback_deutsch.md", beleg: "" }] })]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(ctx.traumBericht.projekte[0].status, "vorgelegt", JSON.stringify(ctx.traumBericht.projekte[0]));
  R.beantworte(a.v, rfTraum(a.v)[0].id, "uebernehmen");
  A.wendeAntwortenAn(a.ctx());
  assert.ok(existsSync(join(a.dir, kopieName)), "der Traum löscht nie");
  assert.equal(E.leseProjekt(a.wurzel, KEY).konflikte.length, 0, "aufgelöst zählt für den Traum nicht mehr als Anlass");
  assert.equal(E.anlassFuer(E.leseProjekt(a.wurzel, KEY), []).gruende.length, 0);

  const r2 = abgleichen(a);
  assert.equal(r2.ok, true, JSON.stringify(r2.fehler));
  assert.deepEqual(r2.plan.projekte[0].aufgeloeste, [kopieName]);
  for (const dir of [a.dir, memoryDir(a, 0), memoryDir(a, 1)]) {
    assert.ok(!readdirSync(dir).some(istKonfliktKopie), `keine Kopie mehr in ${dir}`);
    assert.ok(!readdirSync(dir).includes("_konflikte.md"), "die leere Liste entfällt");
  }
  assert.match(readFileSync(join(a.dir, "feedback_deutsch.md"), "utf8"), /Statuszeilen \(A\)\.\nAuch Statuszeilen \(B\)\./, "die zusammengeführte Fassung gilt (beide Zeilen, wörtlich)");
  assert.deepEqual(liesDir(memoryDir(a, 0)), liesDir(a.dir));
  assert.deepEqual(liesDir(memoryDir(a, 1)), liesDir(a.dir));
  assert.equal(abgleichen(a).nichtsZuTun, true);
});

test("Traum-Eingabe liest Konflikt-Kopien nur im Format des Abgleichs: Namensmuster ODER exakter Eintrag; aufgelöste und lose Zeilen zählen nicht", () => {
  const w = tempOrdner("wurzel-konflikt");
  const dir = join(w, KEY);
  mkdirSync(dir, { recursive: true });
  const fmOffen = `${fm("a", "feedback")}\nText\n`, fmAufg = `${fm("a", "feedback", "Beschreibung", "status: aufgeloest\n")}\nAufgelöst in a.md\n`;
  const schreibe = (n, t) => writeFileSync(join(dir, n), t);
  schreibe("MEMORY.md", "# x\n");
  schreibe("a.md", fmOffen);
  schreibe("a.konflikt-konto-b.md", fmOffen);                               // Namensmuster, offen
  schreibe("c.konflikt-konto-b.md", fmAufg);                                // aufgelöst → kein Anlass
  schreibe("lose.md", fmOffen);
  schreibe("d.md", fmOffen);
  schreibe("_konflikte.md", [konfliktZeile({ datum: "2026-10-22", konto: "konto-b", datei: "a.md", kopie: "a.konflikt-konto-b.md" }),
    konfliktZeile({ datum: "2026-10-22", konto: "konto-b", datei: "c.md", kopie: "c.konflikt-konto-b.md" }),
    "- lose.md ist irgendwie anders", "- d.konflikt-x.md", ""].join("\n"));
  let p = E.leseProjekt(w, KEY);
  assert.deepEqual(p.konflikte, ["a.konflikt-konto-b.md"], "nur die offene Kopie; die aufgelöste und lose Zeilen zählen nicht");
  assert.equal(p.hatKonfliktListe, true);
  schreibe("_konflikte.md", "# Offene Konflikte im gemeinsamen Gedächtnis\n\nNur Kopf.\n");
  schreibe("a.konflikt-konto-b.md", fmAufg);
  p = E.leseProjekt(w, KEY);
  assert.deepEqual(p.konflikte, []);
  assert.equal(p.hatKonfliktListe, false, "Kopf ohne Einträge ist kein Anlass");
  assert.equal(E.anlassFuer(p, []).gruende.length, 0);
});

// ---------- d) der Traum gleicht vor seinem Lauf ab ----------
test("Traum gleicht das Projekt VOR dem Lauf ab (gedaechtnisTeilen=an): er träumt auf dem aktuellen Stand der Konten; bei „aus“ nicht", async () => {
  const neu = (a) => writeFileSync(join(memoryDir(a, 1), "feedback_neu_aus_b.md"), `${fm("feedback_neu_aus_b", "feedback")}\nNeu aus Konto B.\n`);
  const an = eingespielt({ automatik: { gedaechtnisTeilen: "an" } });
  neu(an);
  const s = fakeSonnet([traumRegel({ bericht: [] })]);
  await T.traumSchritt(an.ctx());
  assert.ok(existsSync(join(an.dir, "feedback_neu_aus_b.md")), "die Wurzel kennt die Datei aus Konto B jetzt");
  assert.ok(existsSync(join(memoryDir(an, 0), "feedback_neu_aus_b.md")), "und Konto A auch");
  assert.equal(s.anzahl(), 1);
  assert.match(s.aufrufe()[0].eingabe, /feedback_neu_aus_b\.md/, "der Traum sah die neue Datei");
  assert.match(git(an.wurzel, "log", "-1", "--format=%s"), /^gedaechtnis: abgleichen/);

  const aus = eingespielt({});                                              // Standard: gedaechtnisTeilen aus
  neu(aus);
  const s2 = fakeSonnet([traumRegel({ bericht: [] })]);
  await T.traumSchritt(aus.ctx());
  assert.ok(!existsSync(join(aus.dir, "feedback_neu_aus_b.md")), "ohne Teilen kein Abgleich durch den Traum");
  assert.equal(s2.anzahl(), 1);
  assert.doesNotMatch(s2.aufrufe()[0].eingabe, /feedback_neu_aus_b\.md/);
});

test("Probe: der Traum gleicht vor dem Lauf nur im Trockenlauf ab — nichts wird verändert, ein Hinweis nennt den ausstehenden Abgleich", async () => {
  const a = eingespielt({ automatik: { gedaechtnisTeilen: "an" } });
  writeFileSync(join(memoryDir(a, 1), "feedback_neu_aus_b.md"), `${fm("feedback_neu_aus_b", "feedback")}\nNeu aus Konto B.\n`);
  fakeSonnet([traumRegel({ bericht: [] })]);
  const ctx = a.ctx({ probe: true });
  await T.traumSchritt(ctx);
  assert.ok(!existsSync(join(a.dir, "feedback_neu_aus_b.md")), "Probe schreibt nicht in die Wurzel");
  assert.ok(ctx.traumBericht.hinweise.some((h) => /Abgleich für .* steht aus/.test(h)), JSON.stringify(ctx.traumBericht.hinweise));
});

test("Fehler beim Abgleich → dieses Projekt wird übersprungen, der Lauf geht mit den anderen weiter", async () => {
  const key2 = "-Users-test-zwei";
  const a = eingespielt({ automatik: { gedaechtnisTeilen: "an" } });
  // zweites Projekt: in der Wurzel und im Verlauf von Konto A; Konto B hat dort einen nicht beschreibbaren Projektordner → der Abgleich scheitert beim Verteilen
  const dir2 = join(a.wurzel, key2);
  mkdirSync(dir2, { recursive: true });
  writeFileSync(join(dir2, "MEMORY.md"), "# zwei\n- [Eins](feedback_a.md) — a\n");
  writeFileSync(join(dir2, "feedback_a.md"), `${fm("feedback_a", "feedback")}\nText\n`);
  git(a.wurzel, "add", "--", `${key2}/MEMORY.md`, `${key2}/feedback_a.md`);
  git(a.wurzel, "commit", "-qm", "zwei");
  a.verlauf({ id: "22222222-bbbb", projekt: key2, eintraege: VERLAUF });
  const sperrDir = join(a.konten[1], "projects", key2);
  mkdirSync(sperrDir, { recursive: true });
  const s = fakeSonnet([traumRegel({ bericht: [] })]);
  const ctx = a.ctx();
  chmodSync(sperrDir, 0o555);
  let r;
  try { r = await T.traumSchritt(ctx); } finally { chmodSync(sperrDir, 0o755); }
  assert.deepEqual(r, { lauf: true, projekte: 1 });
  assert.equal(ctx.traumBericht.uebersprungen["abgleich-fehler"], 1);
  assert.ok(ctx.traumBericht.hinweise.some((h) => /Abgleich vor dem Traum fehlgeschlagen für -Users-test-zwei/.test(h)), JSON.stringify(ctx.traumBericht.hinweise));
  assert.equal(s.anzahl(), 1, "das andere Projekt wurde geträumt");
  assert.match(s.aufrufe()[0].eingabe, new RegExp(`PROJEKT: ${KEY}`));
  assert.match(T.traumBerichtZeilen(ctx).join("\n"), /1 Abgleich fehlgeschlagen/);
});

// ---------- f) Projekt-Schlüssel ----------
const cli = (a, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL("../tageslauf/traum.mjs", import.meta.url)), a.v, ...args],
  { encoding: "utf8", env: { ...process.env, BRAIN_CLAUDE: FAKE_SONNET } });

test("Projekt-Schlüssel: Traum und Abgleich zählen dieselben Projekte (Aufbau und Temp-/Scratchpad-Ausschluss aus EINER Funktion)", () => {
  const a = mitKonten(traumAufbau({ automatik: { gedaechtnisTeilen: "an" } }));
  const echt = ["-Users-test-drei", "-Users-test-zwei"];
  const unecht = ["-private-var-folders-ab-T-sache", "-tmp-etwas", "-var-folders-ab-T-x", "-Users-test-scratchpad-abc", "_traum", "Projekt_mit_Unterstrich", "-Users-test-a.b"];
  for (const n of [...echt, ...unecht]) { mkdirSync(join(a.wurzel, n), { recursive: true }); writeFileSync(join(a.wurzel, n, "MEMORY.md"), "# x\n"); }
  const traum = E.listeProjekte(a.wurzel);
  const abgleich = gleicheAb({ wurzel: a.wurzel, konten: a.konten }).plan.projekte.map((p) => p.projekt).sort();
  assert.deepEqual(traum, [...echt, KEY].sort());
  assert.deepEqual(abgleich, traum, "Traum und Abgleich sehen dieselben Projekte");
  const aus = gleicheAb({ wurzel: a.wurzel, konten: a.konten }).plan.uebersprungen.map((u) => u.projekt).sort();
  assert.deepEqual(aus, ["-Users-test-scratchpad-abc", "-private-var-folders-ab-T-sache", "-tmp-etwas", "-var-folders-ab-T-x"].sort(), "Temp-/Scratchpad-Projekte nennt der Abgleich als übersprungen");
  // CLI: ein Temp- oder unechter Schlüssel ist kein gültiger --projekt-Wert
  for (const schlecht of ["-tmp-etwas", "_traum", "-Users-test-a.b"]) assert.equal(cli(a, "--projekt", schlecht).status, 64, schlecht);
  assert.equal(E.istEchterProjektSchluessel(KEY), true);
});
