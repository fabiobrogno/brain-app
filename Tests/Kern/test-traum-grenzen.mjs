// .tools/tests/test-traum-grenzen.mjs — Grenzen und Sicherheitsnetze des Traums: manipulierter Patch, ersetzte Rückfrage, Wurzel ohne Git, Anwenden schlägt fehl (Rücknahme),
// Probe-Antwort, KI-Fehler, Themen im Projekt-Schlüssel, Zugangsdaten im vorhandenen Gedächtnis, zu großer Diff, Einstellungen, Rechte der KI, Kommandozeile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { isoliere, git, JETZT } from "./tageslauf-hilfe.mjs";
import { fakeSonnet, FAKE_SONNET } from "./pflege-hilfe.mjs";
import { nutzer } from "./verlauf-fixture.mjs";
import { traumAufbau, traumRegel, GUTER_TRAUM, DATEIEN, KEY, fm, VERLAUF } from "./traum-hilfe.mjs";
// Zugangsdaten- und Pfad-Muster der Fixtures zur Laufzeit zusammensetzen — der Publish-Check darf im Quelltext nichts Echtes sehen.
const j = (...t) => t.join("");
const U = j("/Us", "ers/x");
const T = await import("../tageslauf/traum.mjs");
const R = await import("../rueckfragen.mjs");
const A = await import("../tageslauf/antworten.mjs");
const K = await import("../tageslauf/pflege-ki.mjs");
const S = await import("../einstellungen.mjs");
isoliere();

const rfTraum = (v) => R.listeRueckfragen(v).filter((r) => r.typ === "traum");
const vorlegen = async (a, regel = traumRegel(GUTER_TRAUM)) => { const s = fakeSonnet([regel]); await T.traumSchritt(a.ctx()); return { s, rf: rfTraum(a.v)[0] }; };
const wurzelStand = (a) => Object.fromEntries(readdirSync(a.dir).sort().map((n) => [n, readFileSync(join(a.dir, n), "utf8")]));

test("Freigabe gilt genau diesem Patch: wurde die gespeicherte Patch-Datei verändert, wird nichts angewendet", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  const datei = join(a.v, ".logs/tageslauf/traum-vorschlaege", `${rf.id}.patch`);
  writeFileSync(datei, `${readFileSync(datei, "utf8")}\n`);                 // ein Byte mehr
  const vorher = wurzelStand(a);
  R.beantworte(a.v, rf.id, "uebernehmen");
  const c1 = a.ctx();
  assert.equal(A.wendeAntwortenAn(c1).erledigt, 1);
  assert.ok(c1.aktionen.some((x) => x.stufe === "antwort" && x.grund === "uebernehmen: patch-fehlt"), JSON.stringify(c1.aktionen.map((x) => x.grund)));
  assert.deepEqual(wurzelStand(a), vorher, "Wurzel unverändert");
  assert.equal(git(a.wurzel, "log", "--oneline").split("\n").length, 1);
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "veraltet");
  assert.equal(rfTraum(a.v).length, 0);
});

test("eine Antwort auf eine ersetzte Rückfrage (andere ID im Stand) wendet nichts an", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  const stand = T.leseTraumStand(a.v);
  stand.projekte[KEY].rueckfrage = "rf-ersetzt-traum-000000";
  writeFileSync(join(a.v, ".logs/tageslauf/traum-stand.json"), JSON.stringify(stand));
  R.beantworte(a.v, rf.id, "uebernehmen");
  assert.equal(A.wendeAntwortenAn(a.ctx()).erledigt, 1);
  assert.equal(git(a.wurzel, "log", "--oneline").split("\n").length, 1, "nichts committet");
  assert.ok(!readFileSync(join(a.dir, "MEMORY.md"), "utf8").includes("feedback_emoji"));
});

test("ein neuer Traum löst den alten, noch offenen Vorschlag ab (Rückfrage ins Archiv, Patch weg)", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  a.committe("feedback_deutsch.md", `${readFileSync(join(a.dir, "feedback_deutsch.md"), "utf8")}Noch eine Zeile.\n`);
  const morgen = a.ctx({ jetzt: JETZT + 20 * 3600e3 });
  morgen.heute = "2026-10-23";
  await T.traumSchritt(morgen);
  const rfs = rfTraum(a.v);
  assert.equal(rfs.length, 1);
  assert.notEqual(rfs[0].id, rf.id, "neue Rückfrage");
  assert.ok(existsSync(join(a.v, "90_archiv", "rueckfragen-verfallen", `${rf.id}.md`)), "die alte liegt im Archiv");
  assert.ok(!existsSync(join(a.v, ".logs/tageslauf/traum-vorschlaege", `${rf.id}.patch`)));
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].rueckfrage, rfs[0].id);
});

test("Wurzel ist kein Git-Repo → nichts angewendet, Dateien unverändert", async () => {
  const a = traumAufbau({ ohneWurzelGit: true });
  const { rf } = await vorlegen(a);
  const vorher = wurzelStand(a);
  R.beantworte(a.v, rf.id, "uebernehmen");
  const c2 = a.ctx();
  A.wendeAntwortenAn(c2);
  assert.ok(c2.aktionen.some((x) => x.grund === "uebernehmen: wurzel-kein-git"), JSON.stringify(c2.aktionen.map((x) => x.grund)));
  assert.deepEqual(wurzelStand(a), vorher);
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "veraltet");
});

test("Anwenden schlägt fehl (Git-Sperre) → alles zurück, kein Commit, Wurzel wie vorher, Rückfrage erledigt", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  const vorher = wurzelStand(a), kopf = git(a.wurzel, "rev-parse", "HEAD");
  writeFileSync(join(a.wurzel, ".git", "index.lock"), "");                  // ein anderer Git-Prozess hält den Index
  R.beantworte(a.v, rf.id, "uebernehmen");
  const c3 = a.ctx();
  assert.equal(A.wendeAntwortenAn(c3).erledigt, 1);
  assert.ok(c3.aktionen.some((x) => /^uebernehmen: patch-nicht-anwendbar/.test(x.grund)), JSON.stringify(c3.aktionen.map((x) => x.grund)));
  assert.deepEqual(wurzelStand(a), vorher);
  assert.equal(git(a.wurzel, "rev-parse", "HEAD"), kopf);
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "veraltet");
  assert.ok(!existsSync(join(a.v, ".logs/tageslauf/traum-vorschlaege", `${rf.id}.patch`)));
});

// ---------- Anwenden unter der Gedächtnis-Sperre (Befund 2) ----------
test("Anwenden braucht die Sperre der Wurzel: ist sie belegt (z. B. SessionEnd-Abgleich), bleibt die Antwort offen — nichts angewendet, nichts verbraucht; danach klappt es", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  const vorher = wurzelStand(a), kopf = git(a.wurzel, "rev-parse", "HEAD");
  const sperre = `${a.wurzel}.lock`;
  writeFileSync(sperre, `${process.pid} ${new Date().toISOString()}\n`);          // ein anderer Lauf hält die Wurzel
  R.beantworte(a.v, rf.id, "uebernehmen");
  const c1 = a.ctx();
  c1.sperreWarteMs = 30;                                                           // Test: nicht 10 s warten
  const erg = A.wendeAntwortenAn(c1);
  assert.equal(erg.fehler, 1, "kein Erfolg, kein Verbrauch der Rückfrage");
  assert.ok(c1.aktionen.some((x) => x.stufe === "fehler" && /später erneut/.test(x.grund)), JSON.stringify(c1.aktionen.map((x) => x.grund)));
  assert.deepEqual(wurzelStand(a), vorher, "Wurzel unverändert");
  assert.equal(git(a.wurzel, "rev-parse", "HEAD"), kopf);
  assert.equal(rfTraum(a.v).length, 1, "die beantwortete Rückfrage bleibt offen");
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "vorgelegt");
  assert.ok(existsSync(join(a.v, ".logs/tageslauf/traum-vorschlaege", `${rf.id}.patch`)), "der Patch bleibt für den nächsten Versuch");
  assert.ok(existsSync(sperre), "eine fremde Sperre wird nie angefasst");
  rmSync(sperre);
  const c2 = a.ctx();
  assert.equal(A.wendeAntwortenAn(c2).erledigt, 1);
  assert.equal(git(a.wurzel, "log", "--oneline").split("\n").length, 2, "jetzt angewendet");
  assert.ok(!existsSync(sperre), "die eigene Sperre ist wieder frei");
});

test("Rollback fasst nur an, was dem Stand direkt nach dem eigenen Anwenden entspricht — eine zwischenzeitlich fremd geschriebene Zeile geht nie verloren", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  const fremd = "Fremde Zeile aus einem Abgleich.\n";
  const c = a.ctx();
  // Testhaken: NACH dem Anwenden schreibt jemand (am Sperr-Schutz vorbei) in eine vom Patch berührte Datei → die Prüfsumme des Ergebnisses stimmt nicht mehr, der Rollback läuft.
  c.haken = { nachTraumAnwenden: (_ctx, wurzel) => writeFileSync(join(wurzel, KEY, "feedback_deutsch.md"), `${readFileSync(join(wurzel, KEY, "feedback_deutsch.md"), "utf8")}${fremd}`) };
  R.beantworte(a.v, rf.id, "uebernehmen");
  const kopf = git(a.wurzel, "rev-parse", "HEAD");
  assert.equal(A.wendeAntwortenAn(c).erledigt, 1);
  assert.equal(git(a.wurzel, "rev-parse", "HEAD"), kopf, "kein Commit");
  assert.ok(readFileSync(join(a.dir, "feedback_deutsch.md"), "utf8").includes(fremd), "die fremde Zeile ist NICHT zurückgesetzt worden");
  assert.ok(c.aktionen.some((x) => /patch-nicht-anwendbar/.test(x.grund) && /nicht zurückgesetzt/.test(x.grund)), JSON.stringify(c.aktionen.map((x) => x.grund)));
  // die übrigen, unveränderten Dateien des Patches sind auf HEAD zurück
  assert.equal(readFileSync(join(a.dir, "MEMORY.md"), "utf8"), DATEIEN["MEMORY.md"]);
  assert.ok(!existsSync(join(a.dir, "feedback_emoji.md")), "die neue Datei des Patches ist wieder weg");
  assert.ok(!existsSync(`${a.wurzel}.lock`), "Sperre frei");
});

test("Probe-Lauf des Tageslaufs: eine Antwort „Übernehmen“ wird nur notiert — Wurzel, Rückfrage und Stand bleiben", async () => {
  const a = traumAufbau();
  const { rf } = await vorlegen(a);
  R.beantworte(a.v, rf.id, "uebernehmen");
  const vorher = wurzelStand(a);
  const ctx = a.ctx({ probe: true });
  A.wendeAntwortenAn(ctx);
  assert.deepEqual(wurzelStand(a), vorher);
  assert.equal(rfTraum(a.v).length, 1, "Rückfrage bleibt liegen");
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "vorgelegt");
  assert.ok(ctx.aktionen.some((x) => x.stufe === "antwort" && /Probe/.test(x.grund)));
});

test("KI-Fehler: Status ki-fehler, kein Vorschlag; zwei Fehler in Folge → keine weiteren Projekte heute", async () => {
  const a = traumAufbau();
  for (const k of ["-Users-test-zwei", "-Users-test-drei"]) {
    mkdirSync(join(a.wurzel, k), { recursive: true });
    writeFileSync(join(a.wurzel, k, "MEMORY.md"), `# ${k}\n${"- [E](feedback_a.md) — a\n".repeat(160)}`);
  }
  const s = fakeSonnet([], { exit: 1 });
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(s.anzahl(), 2, "nach zwei Fehlern in Folge kein dritter Aufruf");
  assert.deepEqual(ctx.traumBericht.projekte.map((p) => p.status), ["ki-fehler", "ki-fehler"]);
  assert.equal(ctx.traumBericht.ohneKi, true);
  assert.equal(rfTraum(a.v).length, 0);
  assert.deepEqual(T.leseTraumStand(a.v).projekte, {}, "ein Fehler hinterlässt keinen Stand");
});

test("ohne claude: kein Aufruf, Hinweis im Bericht; unlesbare Einstellungen und fehlende Wurzel ebenso", async () => {
  const a = traumAufbau();
  const s = fakeSonnet([traumRegel(GUTER_TRAUM)]);
  const ohne = a.ctx({ claudeBefehl: null });
  assert.deepEqual(await T.traumSchritt(ohne), { lauf: false, grund: "ohne-ki" });
  assert.match(T.traumBerichtZeilen(ohne).join("\n"), /keine KI erreichbar/);
  const kaputt = a.ctx();
  delete kaputt.werte.traumOhneThema;
  assert.deepEqual(await T.traumSchritt(kaputt), { lauf: false, grund: "config" });
  const b = traumAufbau({ automatik: { gedaechtnisWurzel: join(a.wurzel, "gibt-es-nicht") } });
  assert.deepEqual(await T.traumSchritt(b.ctx()), { lauf: false, grund: "wurzel-fehlt" });
  assert.equal(s.anzahl(), 0);
  assert.ok(!existsSync(join(a.v, ".logs/tageslauf/traum-stand.json")), "kein Tages-Riegel, solange der Traum gar nicht laufen konnte");
});

test("Projekt-Schlüssel mit ausgeschlossenem Thema wird übersprungen; vorhandene Zugangsdaten im Gedächtnis werden gemeldet (Datei + Zeile, nie der Wert)", async () => {
  const a = traumAufbau({ dateien: { ...DATEIEN, "feedback_deutsch.md": `${DATEIEN["feedback_deutsch.md"]}${j("pass", "wort: ", "geheim12345")}\n` } });
  const k2 = join(a.wurzel, "-Users-test-minecraft-welt");
  mkdirSync(k2, { recursive: true });
  writeFileSync(join(k2, "MEMORY.md"), `# welt\n${"- [E](x.md) — a\n".repeat(160)}`);
  const s = fakeSonnet([traumRegel({ bericht: [] })]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(s.anzahl(), 1, "nur das erlaubte Projekt");
  assert.equal(ctx.traumBericht.uebersprungen.thema, 1);
  assert.ok(!/minecraft/i.test(s.aufrufe()[0].eingabe + s.aufrufe()[0].system));
  const e = ctx.traumBericht.projekte[0];
  assert.deepEqual(e.vorhandeneSecrets.map((x) => x.datei), ["feedback_deutsch.md"]);
  const text = T.traumBerichtZeilen(ctx).join("\n");
  assert.match(text, /Zugangsdaten-Muster im Gedächtnis: feedback_deutsch\.md Zeile \d+ \(Wert nicht gezeigt\)/);
  assert.ok(!text.includes("geheim12345"));
});

// Befund 6: Zugangsdaten im Gedächtnis gehen nie an die KI und nie auf die Konsole — Zeilen mit Muster werden wie Thema-Zeilen durch einen Platzhalter ersetzt.
const GEHEIM = j("pass", "wort: ", "geheim12345");
const mitGeheimnis = { ...DATEIEN, "feedback_deutsch.md": `${fm("feedback_deutsch", "feedback", "Antworten immer auf Deutsch")}\nAlle Texte auf Deutsch schreiben.\nAuch Zwischenmeldungen.\n${GEHEIM}\nAuch Statuszeilen.\n` };
// Antwort der KI: die Geheimnis-Zeile ist nur ein Platzhalter (Nr. 2: Nr. 1 ist die Jarvis-Zeile in MEMORY.md), dazu eine gültige Änderung (Zeile wörtlich aus feedback_deutsch2.md).
const KI_MIT_PLATZHALTER = { dateien: { "feedback_deutsch.md": `${fm("feedback_deutsch", "feedback", "Antworten immer auf Deutsch")}\nAlle Texte auf Deutsch schreiben.\nAuch Zwischenmeldungen.\n<!-- traum-geschuetzt-2 -->\nAuch Statuszeilen.\nGilt immer.\n`,
    "feedback_deutsch2.md": `${fm("feedback_deutsch2", "feedback", "Deutsch antworten")}\nZusammengeführt in feedback_deutsch.md\nBitte Deutsch antworten.\nGilt immer.\n` },      // die Quelle derselben Art bekommt den Hinweis (sonst keine Herkunft)
  bericht: [{ datei: "feedback_deutsch.md", art: "zusammengefuehrt", grund: "Zeile aus feedback_deutsch2.md ergänzt", beleg: "" }, { datei: "feedback_deutsch2.md", art: "zusammengefuehrt", grund: "Zeile nach feedback_deutsch.md übernommen", beleg: "" }] };

test("Zugangsdaten im Gedächtnis: die KI sieht nur einen Platzhalter (Eingabe-Maskierung), die Meldung „im Gedächtnis“ bleibt, die Datei bleibt beim Anwenden unverändert", async () => {
  const a = traumAufbau({ dateien: mitGeheimnis });
  const dump = join(a.v, "..", "baum-geheim.json");
  const hilfe = fileURLToPath(new URL("./traum-baum-dump.mjs", import.meta.url));
  fakeSonnet([{ ...traumRegel(KI_MIT_PLATZHALTER), befehle: [[hilfe, dump]] }]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  const baum = JSON.parse(readFileSync(dump, "utf8"));
  assert.ok(!baum.inhalt.includes("geheim12345"), "der Wert steht nirgends im Arbeitsordner der KI");
  assert.match(baum.inhalt, /gedaechtnis\/feedback_deutsch\.md\n[\s\S]*<!-- traum-geschuetzt-2 -->/, "stattdessen ein Platzhalter");
  const e = ctx.traumBericht.projekte[0];
  assert.equal(e.status, "vorgelegt", JSON.stringify(e));
  assert.deepEqual(e.vorhandeneSecrets, [{ datei: "feedback_deutsch.md", zeile: 11 }], "Meldung bleibt (Datei + Zeile, nie der Wert)");
  const rf = rfTraum(a.v)[0];
  assert.ok(!rf.beschreibung.includes("geheim12345"), "auch die Rückfrage (Diff-Kontext) zeigt nur den Platzhalter");
  assert.match(rf.beschreibung, /traum-geschuetzt-2/);
  R.beantworte(a.v, rf.id, "uebernehmen");
  A.wendeAntwortenAn(a.ctx());
  const datei = readFileSync(join(a.dir, "feedback_deutsch.md"), "utf8");
  assert.ok(datei.includes(GEHEIM), "die Originalzeile ist wieder an ihrem Platz — der Traum löscht nie etwas");
  assert.match(datei, /Auch Statuszeilen\.\nGilt immer\./);
});

test("Zugangsdaten im Gedächtnis: lässt die KI den Platzhalter weg, bleibt die Datei, wie sie war (nichts geht verloren)", async () => {
  const a = traumAufbau({ dateien: mitGeheimnis });
  fakeSonnet([traumRegel({ dateien: { "feedback_deutsch.md": KI_MIT_PLATZHALTER.dateien["feedback_deutsch.md"].replace("<!-- traum-geschuetzt-2 -->\n", "") }, bericht: KI_MIT_PLATZHALTER.bericht })]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  const e = ctx.traumBericht.projekte[0];
  assert.ok(e.verworfen.some((v) => v.datei === "feedback_deutsch.md" && v.regel === "geschuetzt"), JSON.stringify(e.verworfen));
  assert.ok(!(e.dateien || []).includes("feedback_deutsch.md"));
});

test("CLI --probe: der Diff auf der Konsole enthält nie Zugangsdaten (auch nicht als Kontextzeile); die Ausgabe-Funktion entfernt Treffer samt Hinweis", () => {
  const a = traumAufbau({ dateien: mitGeheimnis });
  fakeSonnet([traumRegel(KI_MIT_PLATZHALTER)]);
  const p = cli(a, "--probe");
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /```diff\n[\s\S]*feedback_deutsch\.md/, "der Diff ist da …");
  assert.ok(!p.stdout.includes("geheim12345"), "… ohne Zugangsdaten");
  const text = T.ausgabeOhneSecrets(["- ok", `- ${GEHEIM}`, "```diff", `+ ${GEHEIM}`, "```"]);
  assert.ok(!text.includes("geheim12345"));
  assert.match(text, /^- ok\n```diff\n```/);
  assert.match(text, /2 Zeile\(n\) mit möglichen Zugangsdaten aus der Ausgabe entfernt/);
  assert.equal(T.ausgabeOhneSecrets(["- ok", "- auch ok"]), "- ok\n- auch ok", "ohne Treffer unverändert, ohne Zusatzzeile");
});

test("zu großer Diff: nicht als Rückfrage vorgelegt (Status zu-gross), nichts gespeichert", async () => {
  const lang = Array.from({ length: 400 }, (_, i) => `Zeile ${i} mit etwas Text, damit der Diff wirklich groß wird.`).join("\n");
  const satz = "Zeile mit etwas Text, damit der Diff wirklich groß wird.";
  const a = traumAufbau({ dateien: { ...DATEIEN, "project_gross.md": `${fm("project_gross", "project")}\nalt\n`, "MEMORY.md": `${DATEIEN["MEMORY.md"]}- [G](project_gross.md) — g\n` },
    verlaeufe: [{ id: "11111111-aaaa", konto: 0, vorMs: 2 * 3600e3, eintraege: [...VERLAUF, nutzer(satz)] }] });
  const s = fakeSonnet([traumRegel({ dateien: { "project_gross.md": `${fm("project_gross", "project")}\n${lang}\n` }, bericht: [{ datei: "project_gross.md", art: "ueberholt", grund: "ausgebaut", beleg: satz }] })]);   // jede neue Zeile braucht ein Zitat, das sie trägt
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(s.anzahl(), 1);
  assert.equal(ctx.traumBericht.projekte[0].status, "zu-gross");
  assert.equal(rfTraum(a.v).length, 0);
  assert.deepEqual(T.leseTraumStand(a.v).projekte[KEY].status, "zu-gross");
});

test("Gedächtnis ändert sich WÄHREND des Traums → Vorschlag wird nicht vorgelegt (Status gedaechtnis-geaendert)", async () => {
  const a = traumAufbau();
  fakeSonnet([{ ...traumRegel(GUTER_TRAUM), aussen: { [join(a.dir, "feedback_deutsch.md")]: `${DATEIEN["feedback_deutsch.md"]}Von einem anderen Prozess ergänzt.\n` } }]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(ctx.traumBericht.projekte[0].status, "gedaechtnis-geaendert");
  assert.equal(rfTraum(a.v).length, 0);
  assert.match(T.traumBerichtZeilen(ctx).join("\n"), /Gedächtnis hat sich während des Traums geändert/);
});

test("nichts zu ändern: leerer Bericht, unveränderte Dateien → Status nichts, keine Rückfrage, Stand merkt es sich für heute", async () => {
  const a = traumAufbau();
  const s = fakeSonnet([traumRegel({ bericht: [] })]);
  const ctx = a.ctx();
  await T.traumSchritt(ctx);
  assert.equal(ctx.traumBericht.projekte[0].status, "nichts");
  assert.equal(rfTraum(a.v).length, 0);
  assert.equal(T.leseTraumStand(a.v).projekte[KEY].status, "nichts");
  assert.equal(T.leseTraumStand(a.v).tag.scharf, ctx.heute);
  assert.equal(s.anzahl(), 1);
});

test("die KI bekommt Rechte nur im Arbeitsordner; Vault, Wurzel und Konten sind zusätzlich für sie gesperrt", () => {
  const { tempOrdner } = { tempOrdner: (n) => join(process.env.BRAIN_TAGESLAUF_CACHE, n) };
  const kopie = tempOrdner("arbeit");
  mkdirSync(kopie, { recursive: true });
  const r = K.sonnetRechte(kopie, { vault: `${U}/brain`, sperren: [`${U}/.claude-gedaechtnis`, `${U}/.claude`] });
  for (const p of [`/${U}/brain`, `/${U}/.claude-gedaechtnis`, `/${U}/.claude`]) {
    assert.ok(r.verboten.includes(`Read(${p}/**)`) && r.verboten.includes(`Edit(${p}/**)`), p);
  }
  const args = K.sonnetArgs("SYS", kopie, { werkzeuge: "Read,Edit,Write,Glob,Grep", maxRunden: 50, maxUsd: 1.5 });
  const w = (f) => args[args.indexOf(f) + 1];
  assert.deepEqual([w("--tools"), w("--max-turns"), w("--max-budget-usd"), w("--permission-mode")], ["Read,Edit,Write,Glob,Grep", "50", "1.5", "dontAsk"]);
  const standard = K.sonnetArgs("SYS", kopie);
  assert.equal(standard[standard.indexOf("--tools") + 1], "Read,Edit,Write,Glob,Grep,Bash", "B3 bleibt unverändert");
});

test("Einstellungen: traum aus|probe|an (Standard aus), traumProjekteMax 1–20, Wurzel/Konten/Themen mit Standard; ungültiges wird abgelehnt", () => {
  assert.deepEqual(S.SCHEMA.traum.werte, ["aus", "probe", "an"]);
  assert.equal(S.STANDARD.traum, "aus");
  assert.equal(S.STANDARD.traumProjekteMax, 5);
  assert.deepEqual(S.STANDARD.traumOhneThema, [], "veröffentlichtes Kit: keine privaten Wörter als Standard");
  assert.equal(S.STANDARD.gedaechtnisWurzel, "~/.claude-gedaechtnis");
  assert.deepEqual(S.STANDARD.gedaechtnisKonten, ["~/.claude"], "veröffentlichtes Kit: nur das Standard-Konto, weitere trägt man selbst ein");
  assert.ok(["traum", "traumProjekteMax", "traumOhneThema", "gedaechtnisWurzel", "gedaechtnisKonten"].every((k) => S.SCHEMA[k].ohneMaske));
  const a = traumAufbau();
  const { stand } = S.leseAutomatik(a.v);
  S.schreibeAutomatik(a.v, { traum: "probe", traumProjekteMax: 3, gedaechtnisWurzel: "~/anderswo", traumOhneThema: ["Geheimprojekt"] }, stand);
  const w = S.leseAutomatik(a.v).werte;
  assert.deepEqual([w.traum, w.traumProjekteMax, w.gedaechtnisWurzel, w.traumOhneThema], ["probe", 3, "~/anderswo", ["Geheimprojekt"]]);
  for (const schlecht of [{ traum: "ja" }, { traumProjekteMax: 0 }, { traumProjekteMax: 21 }, { gedaechtnisWurzel: "" }, { gedaechtnisWurzel: 5 }, { gedaechtnisWurzel: "a\nb" }]) {
    assert.throws(() => S.schreibeAutomatik(a.v, schlecht, S.leseAutomatik(a.v).stand), (e) => e.code === 400, JSON.stringify(schlecht));
  }
});

// ---------- Kommandozeile ----------
const cli = (a, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL("../tageslauf/traum.mjs", import.meta.url)), a.v, ...args],
  { encoding: "utf8", env: { ...process.env, BRAIN_CLAUDE: FAKE_SONNET } });

test("CLI --probe: rechnet und zeigt den Abschnitt „Traum“ mit Diff, legt nichts an; ohne --probe bei traum=an eine Rückfrage", () => {
  const a = traumAufbau({ basis: Date.now() });
  const s = fakeSonnet([traumRegel(GUTER_TRAUM)]);
  const p = cli(a, "--probe");
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /### Traum/);
  assert.match(p.stdout, /Probe \(nichts vorgelegt/);
  assert.match(p.stdout, /```diff\n[\s\S]*Datei: MEMORY\.md/);
  assert.equal(rfTraum(a.v).length, 0);
  assert.equal(s.anzahl(), 1);
  const echt = cli(a);                                                         // von Hand: Tages-Riegel gilt nicht, traum=an → Rückfrage
  assert.equal(echt.status, 0, echt.stderr);
  assert.match(echt.stdout, /scharf \(Vorschläge kommen als Rückfrage\)/);
  assert.equal(rfTraum(a.v).length, 1);
  assert.equal(s.anzahl(), 2);
  const nur = cli(a, "--projekt", "-Users-gibt-es-nicht");
  assert.equal(nur.status, 0);
  assert.match(nur.stdout, /nicht in der Gedächtnis-Wurzel/);
  assert.equal(s.anzahl(), 2);
  assert.equal(cli(a, "--projekt").status, 64);
  assert.equal(cli(a, "--unbekannt").status, 64);
});

test("CLI bei traum=probe oder aus: von Hand immer nur Probe (Rückfragen nur bei traum=an)", () => {
  const a = traumAufbau({ automatik: { traum: "probe" }, basis: Date.now() });
  fakeSonnet([traumRegel(GUTER_TRAUM)]);
  const r = cli(a);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Probe/);
  assert.match(r.stdout, /traum=an/);
  assert.equal(rfTraum(a.v).length, 0);
});

test("brain traum: derselbe Weg über brain.mjs", () => {
  const a = traumAufbau({ basis: Date.now() });
  fakeSonnet([traumRegel(GUTER_TRAUM)]);
  const brain = fileURLToPath(new URL("../brain.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [brain, "traum", "--projekt", KEY, "--probe"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: a.v, BRAIN_CLAUDE: FAKE_SONNET } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /### Traum[\s\S]*Datei: MEMORY\.md/);
});

test("Tageslauf läuft schon → CLI wartet nicht, meldet es und bricht mit 1 ab", async () => {
  const a = traumAufbau();
  fakeSonnet([traumRegel(GUTER_TRAUM)]);
  const Z = await import("../tageslauf/zeitplan.mjs");
  assert.ok(Z.nimmSperre(a.v));
  try {
    const r = cli(a, "--probe");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Tageslauf läuft gerade/);
  } finally { Z.gibSperreFrei(a.v); }
});
