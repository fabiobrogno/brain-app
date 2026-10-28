// .tools/tests/test-pflege-integration.mjs — B3 Task 11: B3 im echten Tageslauf (fake-sonnet), brain zurueck über die CLI,
// Schalter, Antwort „stimmt noch" verlängert auch pruefen_bis, W7 auf Pflege-Seiten, Hinweis „laut Web-Recherche", DRIFT im Lint,
// Themen-Guard (ernteOhneThema/ernteNichtIn) in allen KI-Wegen, Lernmodus (Autostufe aus) im echten Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, git, KIT, JETZT } from "./tageslauf-hilfe.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx, seite, FAKE_SONNET_BEFEHL } from "./pflege-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const { tageslauf } = await import("../tageslauf.mjs");
const { SCHEMA, STANDARD } = await import("../einstellungen.mjs");
const { schreibeEntscheidung, listeEntscheidungen } = await import("../entscheidungen.mjs");
const { konfliktKaesten } = await import("../konflikte.mjs");
const R = await import("../rueckfragen.mjs");
const A = await import("../tageslauf/antworten.mjs");
const PR = await import("../tageslauf/protokoll.mjs");
const S = await import("../tageslauf/pflege-stand.mjs");
const I = await import("../tageslauf/inbox-schritt.mjs");
const { plusTage } = await import("../tageslauf/veraltet.mjs");
const { seitenStatus } = await import("../hint-core.mjs");
isoliere();

const ORION = "09_wiki/wissen/orion.md", TEE = "09_wiki/wissen/tee.md";
const KASTEN = ['> [!KONFLIKT] offen — Du entscheidest', '> A: "Orion läuft auf Port 3309" — Quelle: [[30_wissen/a]]',
  '> B: "Orion läuft auf Port 3310" — Quelle: [[30_wissen/b]]'].join("\n");
const SEITEN = {
  [ORION]: seite({ name: "orion", description: "Orion" }, `# Orion\n\n${Array.from({ length: 6 }, (_, i) => `Absatz ${i + 1}.`).join("\n\n")}\n\n${KASTEN}\n`),
  [TEE]: seite({ name: "tee", description: "Tee" }, "# Tee\n\n## Matcha\n\nMatcha ist gemahlen.\n"),
};
const NOTIZ = "# Tee-Notiz\n\nMatcha enthält Koffein.\n";
const lauf = (v, jetzt = JETZT) => tageslauf(v, { claudeBefehl: FAKE_SONNET_BEFEHL, jetzt });
const REGEL = { wenn: "QUELLE: 00_inbox/tee-notiz.md", antwort: '{"ziel":"30_wissen/tee-notiz.md","seiten":["09_wiki/wissen/tee.md"],"kurz":"Koffein"}',
  anhaengen: { [TEE]: "Matcha enthält Koffein.\n" } };

function aufbau(pflegeIntelligenz, extra = {}, inbox = { "tee-notiz.md": NOTIZ }) {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox, automatik: { tageslauf: "an", pflegeIntelligenz, ...extra } });
  schreibeEntscheidung(v, { seite: ORION, nr: 1, wahl: "b" }, new Date(JETZT - 3600e3));
  return { v, s: fakeSonnet([REGEL]) };
}

test("Schalter pflegeIntelligenz: aus | probe | an, Standard aus", () => {
  assert.deepEqual(SCHEMA.pflegeIntelligenz.werte, ["aus", "probe", "an"]);
  assert.equal(STANDARD.pflegeIntelligenz, "aus");
});

test("Tageslauf mit Pflege an: zwei pflege-Commits, Bericht-Abschnitt, Lauf ok; zweiter Lauf am Tag ohne Pflege; brain zurueck nimmt beides zurück", async () => {
  const { v, s } = aufbau("an");
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const betreffe = git(v, "log", "--format=%s", "main").split("\n").filter((x) => x.startsWith("pflege(")).join("\n");
  assert.match(betreffe, /entscheidung orion\.md: B gilt/);
  assert.match(betreffe, /inbox tee-notiz\.md \[inbox-tee-notiz\]/);
  assert.equal(betreffe.split("\n").length, 2);
  assert.equal(konfliktKaesten(readFileSync(join(v, ORION), "utf8")).konflikte.length, 0);
  assert.equal(existsSync(join(v, "00_inbox/tee-notiz.md")), false);
  assert.ok(existsSync(join(v, "90_archiv/inbox-eingearbeitet/tee-notiz.md")));
  assert.deepEqual(listeEntscheidungen(v), []);
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /\n### Pflege \(B3\)\n- scharf · Sonnet 1\/3/);
  assert.match(bericht, /- Inbox eingearbeitet: tee-notiz\.md → 09_wiki\/wissen\/tee\.md/);
  assert.match(bericht, /- KI-Aufrufe B3: Sonnet 1 · Haiku 0 · Tokens Eingabe [1-9]\d* \/ Cache-Lesen 0 \/ Ausgabe [1-9]\d* \(getrennt von den B2-Zählern/);
  assert.ok(bericht.indexOf("### Pflege (B3)") < bericht.indexOf("### Fehler"));
  assert.equal((await lauf(v, JETZT + 3600e3)).status, "ok");
  assert.equal(s.anzahl(), 1, "B3 läuft höchstens einmal je Tag");
  const cli = spawnSync(process.execPath, [join(KIT, "tageslauf", "zurueck.mjs"), v, r.lauf], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Pflege zurückgenommen: 2 Änderung\(en\) \(Commit [0-9a-f]{8}\), 1 Notiz\(en\) zurück in der Inbox/);
  assert.equal(konfliktKaesten(readFileSync(join(v, ORION), "utf8")).konflikte.length, 1);
  assert.equal(readFileSync(join(v, "00_inbox/tee-notiz.md"), "utf8"), NOTIZ);
  assert.doesNotMatch(readFileSync(join(v, TEE), "utf8"), /Koffein/);
});

test("Klein 1: /ingest läuft beim Tageslauf → Pflege übersprungen (Bericht), Nachlauf beim nächsten stündlichen Takt nur für B3 (ohne B2), danach nicht fällig", async () => {
  const { v, s } = aufbau("an");
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "ingest.lock"), `ingest ${process.pid}\n`);
  const r1 = await tageslauf(v, { claudeBefehl: FAKE_SONNET_BEFEHL, jetzt: JETZT, wennFaellig: true });
  assert.equal(r1.status, "ok", JSON.stringify(r1));
  assert.equal(s.anzahl(), 0);
  assert.match(readFileSync(join(v, r1.bericht), "utf8"), /- Pflege übersprungen: \/ingest lief gerade/);
  assert.ok(existsSync(join(v, "00_inbox/tee-notiz.md")));
  const letzter1 = JSON.parse(readFileSync(join(v, ".logs/tageslauf/letzter.json"), "utf8"));
  unlinkSync(join(v, ".logs", "ingest.lock"));
  const r2 = await tageslauf(v, { claudeBefehl: FAKE_SONNET_BEFEHL, jetzt: JETZT + 3600e3, wennFaellig: true });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.equal(s.anzahl(), 1, "der Nachlauf hat die Inbox-Notiz bearbeitet");
  assert.equal(existsSync(join(v, "00_inbox/tee-notiz.md")), false);
  const bericht = readFileSync(join(v, r2.bericht), "utf8");
  assert.match(bericht, /nur Pflege \(Nachlauf\)/);
  const letzter2 = JSON.parse(readFileSync(join(v, ".logs/tageslauf/letzter.json"), "utf8"));
  assert.equal(letzter2.letzterErfolg, letzter1.letzterErfolg, "der Nachlauf ist kein B2-Lauf: letzter Erfolg unverändert");
  const r3 = await tageslauf(v, { claudeBefehl: FAKE_SONNET_BEFEHL, jetzt: JETZT + 2 * 3600e3, wennFaellig: true });
  assert.deepEqual([r3.status, r3.grund], ["uebersprungen", "nicht fällig"]);
});

test("Pflege-Schalter probe bei scharfem Tageslauf: main, Inbox und Entscheidung unverändert, Bericht sagt Probe", async () => {
  const { v } = aufbau("probe");
  const head = git(v, "rev-parse", "HEAD");
  const r = await lauf(v);
  assert.equal(r.status, "ok");
  assert.equal(git(v, "rev-parse", "HEAD"), head);
  assert.ok(existsSync(join(v, "00_inbox/tee-notiz.md")));
  assert.equal(listeEntscheidungen(v).length, 1);
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /\n### Pflege \(B3\)\n- Probe \(nichts übernommen\)/);
});

test("Lernmodus im echten Lauf: Entscheidung wird umgesetzt, die Inbox-Notiz kommt nur als markierte Rückfrage mit Diff; nach „Übernehmen“ merged der nächste Lauf sie", async () => {
  const { v, s } = aufbau("an", { einschwingen: 0, autostufeStart: undefined });
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const betreffe = git(v, "log", "--format=%s", "main").split("\n").filter((x) => x.startsWith("pflege("));
  assert.equal(betreffe.length, 1, "nur die Entscheidung (deterministisch) wurde gemergt");
  assert.match(betreffe[0], /entscheidung orion\.md: B gilt/);
  assert.ok(existsSync(join(v, "00_inbox/tee-notiz.md")), "Notiz bleibt in der Inbox");
  assert.doesNotMatch(readFileSync(join(v, TEE), "utf8"), /Koffein/);
  assert.equal(s.anzahl(), 1, "die KI hat den Vorschlag gerechnet");
  const rf = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  assert.equal(rf.length, 1);
  assert.equal(R.istAutostufeRueckfrage(rf[0]), true);
  assert.match(rf[0].beschreibung, /\+Matcha enthält Koffein\./);
  assert.match(rf[0].beschreibung, /Datei: 09_wiki\/wissen\/tee\.md/, "Diff zeigt die Seite");
  assert.match(rf[0].beschreibung, /Datei: 30_wissen\/tee-notiz\.md/, "… und die einsortierte Quelle (alle geänderten Dateien)");
  const lernV = S.lernEintrag(v, "inbox:tee-notiz.md");
  assert.match(lernV.patch_sha, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(v, ".logs/tageslauf/pflege-vorschlaege", `${rf[0].id}.patch`)), "Patch liegt auf Platte");
  assert.equal(rf[0].fm.pflege, "inbox:tee-notiz.md");
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /Lernmodus \(nichts Inhaltliches ohne deine Freigabe\)/);
  assert.match(bericht, /- Vorschlag als Rückfrage: Inbox tee-notiz\.md/);
  assert.equal(git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length, 1);
  // Tag 2: Der Nutzer übernimmt → B3 wendet GENAU den gezeigten Patch an. Würde eine Neu-Rechnung jetzt etwas anderes liefern (B),
  // darf das nie gemergt werden, und die KI wird für die Freigabe gar nicht erst gerufen.
  R.beantworte(v, rf[0].id, "uebernehmen");
  writeFileSync(process.env.FAKE_SONNET_REGELN, JSON.stringify([{ ...REGEL, anhaengen: { [TEE]: "Matcha enthält VIEL Koffein und Gold.\n" } }]));
  const r3 = await lauf(v, JETZT + 86400e3);
  assert.equal(r3.status, "ok", JSON.stringify(r3));
  assert.equal(s.anzahl(), 1, "die Freigabe rechnet nicht neu — kein zweiter Sonnet-Aufruf");
  assert.match(readFileSync(join(v, TEE), "utf8"), /Matcha enthält Koffein\./);
  assert.doesNotMatch(readFileSync(join(v, TEE), "utf8"), /VIEL|Gold/, "gemergt wird A (gezeigt), nie B (neu gerechnet)");
  assert.equal(existsSync(join(v, "00_inbox/tee-notiz.md")), false);
  assert.ok(existsSync(join(v, "90_archiv/inbox-eingearbeitet/tee-notiz.md")));
  assert.ok(existsSync(join(v, "30_wissen/tee-notiz.md")), "einsortierte Quelle stammt aus dem Patch");
  assert.equal(S.lernEintrag(v, "inbox:tee-notiz.md"), null);
  assert.equal(existsSync(join(v, ".logs/tageslauf/pflege-vorschlaege", `${rf[0].id}.patch`)), false, "Patch nach dem Merge aufgeräumt");
});

test("Lernmodus K1: Patch nicht mehr anwendbar (Seite inzwischen geändert) → nichts gemergt, Freigabe verfällt, die Einheit wird NEU vorgelegt", async () => {
  const { v, s } = aufbau("an", { einschwingen: 0, autostufeStart: undefined });
  await lauf(v);
  const rf = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  assert.equal(rf.length, 1);
  R.beantworte(v, rf[0].id, "uebernehmen");
  // Der Nutzer ändert dieselbe Stelle der Seite von Hand (direkt auf main), bevor B3 die Freigabe anwendet
  writeFileSync(join(v, TEE), readFileSync(join(v, TEE), "utf8").replace("Matcha ist gemahlen.", "Matcha ist fein gemahlen."));
  git(v, "add", "--", TEE); git(v, "commit", "-qm", "von Hand");
  const head = git(v, "rev-parse", "HEAD");
  const r2 = await lauf(v, JETZT + 86400e3);
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.equal(git(v, "rev-parse", "HEAD"), head, "kein Merge");
  assert.doesNotMatch(readFileSync(join(v, TEE), "utf8"), /Koffein/);
  assert.ok(existsSync(join(v, "00_inbox/tee-notiz.md")), "Notiz bleibt in der Inbox");
  assert.ok(PR.leseAktionen(v).some((a) => a.stufe === "pflege-verworfen" && a.grund === "patch-nicht-anwendbar"));
  const neu = R.listeRueckfragen(v).filter((x) => x.fm.pflege && !x.antwort);
  assert.equal(neu.length, 1, "neue Rückfrage statt Freigabe");
  assert.notEqual(neu[0].id, rf[0].id);
  assert.equal(S.lernEintrag(v, "inbox:tee-notiz.md").status, "vorgelegt");
  assert.equal(s.anzahl(), 2, "nur das Neu-Vorlegen rechnet (Durchgang 2)");
  assert.match(neu[0].beschreibung, /fein gemahlen|Koffein/);
});

test("Lernmodus N2-4: Seite seit der Vorlage geändert (konfliktfrei, an anderer Stelle) → der Patch wird NICHT angewendet, Freigabe verfällt, neu vorgelegt", async () => {
  const { v, s } = aufbau("an", { einschwingen: 0, autostufeStart: undefined });
  await lauf(v);
  const rf = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  assert.equal(rf.length, 1);
  assert.match(JSON.stringify(S.lernEintrag(v, "inbox:tee-notiz.md").meta.seitenSha), /tee\.md/, "der Seitenstand steht in den (versiegelten) Meta-Angaben");
  R.beantworte(v, rf[0].id, "uebernehmen");
  // Der Nutzer ergänzt die Seite von Hand an einer ganz anderen Stelle — git apply --3way käme damit konfliktfrei durch
  writeFileSync(join(v, TEE), readFileSync(join(v, TEE), "utf8").replace("# Tee\n", "# Tee\n\nVon Hand ergänzt.\n"));
  git(v, "add", "--", TEE); git(v, "commit", "-qm", "von Hand");
  const head = git(v, "rev-parse", "HEAD");
  const r2 = await lauf(v, JETZT + 86400e3);
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.equal(git(v, "rev-parse", "HEAD"), head, "kein Merge");
  assert.doesNotMatch(readFileSync(join(v, TEE), "utf8"), /Koffein/);
  assert.match(readFileSync(join(v, TEE), "utf8"), /Von Hand ergänzt\./, "die Handänderung bleibt");
  assert.ok(existsSync(join(v, "00_inbox/tee-notiz.md")));
  const verworfen = PR.leseAktionen(v).find((a) => a.stufe === "pflege-verworfen" && a.grund === "patch-nicht-anwendbar");
  assert.ok(verworfen, "Grund im Protokoll");
  assert.match(verworfen.befund || "", /seite-geaendert/);
  const neu = R.listeRueckfragen(v).filter((x) => x.fm.pflege && !x.antwort);
  assert.equal(neu.length, 1, "neue Rückfrage statt Freigabe");
  assert.notEqual(neu[0].id, rf[0].id);
  assert.match(neu[0].beschreibung, /Von Hand ergänzt\./, "der neue Diff zeigt die Seite, wie sie jetzt ist");
  assert.equal(s.anzahl(), 2);
});

test("Lernmodus K1: veränderte Patch-Datei (Prüfsumme stimmt nicht) → nie angewendet, Freigabe verfällt, neu vorgelegt", async () => {
  const { v } = aufbau("an", { einschwingen: 0, autostufeStart: undefined });
  await lauf(v);
  const rf = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  R.beantworte(v, rf[0].id, "uebernehmen");
  const datei = join(v, ".logs/tageslauf/pflege-vorschlaege", `${rf[0].id}.patch`);
  writeFileSync(datei, readFileSync(datei, "utf8").replace("Koffein.", "Koffein und Gold."));
  const head = git(v, "rev-parse", "HEAD");
  await lauf(v, JETZT + 86400e3);
  assert.equal(git(v, "rev-parse", "HEAD"), head);
  assert.doesNotMatch(readFileSync(join(v, TEE), "utf8"), /Gold|Koffein/);
  const neu = R.listeRueckfragen(v).filter((x) => x.fm.pflege && !x.antwort);
  assert.equal(neu.length, 1);
  assert.notEqual(neu[0].id, rf[0].id);
});

test("Lernmodus K1: Diff länger als die Anzeige-Grenze → keine Rückfrage, „zu groß für eine Freigabe“ im Bericht", async () => {
  const gross = `# Tee-Notiz\n\n${Array.from({ length: 400 }, (_, i) => `Matcha-Fakt Nummer ${i} steht fest.`).join("\n")}\n`;
  const { v } = aufbau("an", { einschwingen: 0, autostufeStart: undefined }, { "tee-notiz.md": gross });
  const zeilen = gross.split("\n").slice(2).join("\n");
  fakeSonnet([{ ...REGEL, anhaengen: { [TEE]: zeilen } }]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(R.listeRueckfragen(v).filter((x) => x.fm.pflege).length, 0);
  assert.ok(PR.leseAktionen(v).some((a) => a.stufe === "pflege-verworfen" && a.grund === "zu-gross"), JSON.stringify(PR.leseAktionen(v).filter((a) => /pflege/.test(a.stufe))));
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /nicht übernommen — Inbox tee-notiz\.md: zu groß für eine Freigabe/);
});

test("Themen-Guard Inbox: Notiz mit ausgeschlossenem Wort erreicht die KI nie, Nachbarnotiz läuft; im Bericht nur die Zahl", async () => {
  const geheim = "# Zebra-Notiz\n\nDas weiße Zebra mag Matcha.\n";
  const { v, s } = aufbau("an", { ernteOhneThema: ["zebra"] }, { "a-zebra.md": geheim, "tee-notiz.md": NOTIZ });
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(s.anzahl(), 1);
  assert.ok(!s.aufrufe().some((a) => /zebra/i.test(a.eingabe)), "nichts davon an die KI");
  assert.ok(existsSync(join(v, "00_inbox/a-zebra.md")), "Notiz bleibt unangetastet liegen");
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /Themen-Ausschluss: 1 Notiz\(en\)\/Seite\(n\)\/Fakt\(en\) nicht an die KI gegeben \(thema-ausgeschlossen 1\)/);
  assert.doesNotMatch(bericht, /zebra/i);
  assert.doesNotMatch(readFileSync(join(v, ".logs/tageslauf/aktionen.jsonl"), "utf8"), /zebra/i);
});

test("Themen-Guard Inbox: ernteNichtIn — Notiz nennt einen Pfad im ausgeschlossenen Ordner", async () => {
  const { v, s } = aufbau("an", { ernteNichtIn: ["/mnt/privat"] }, { "pfad.md": "# Notiz\n\nSiehe /mnt/privat/plan.txt für Matcha.\n", "tee-notiz.md": NOTIZ });
  await lauf(v);
  assert.equal(s.anzahl(), 1);
  assert.ok(existsSync(join(v, "00_inbox/pfad.md")));
  assert.equal(PR.leseAktionen(v).some((a) => a.id === "inbox-pfad"), false);
});

test("Themen-Guard: Sonnet schreibt ein ausgeschlossenes Thema ins Wiki → Einheit verworfen, nichts gemerged", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "tee-notiz.md": NOTIZ }, automatik: { tageslauf: "an", pflegeIntelligenz: "an", ernteOhneThema: ["zebra"] } });
  fakeSonnet([{ ...REGEL, anhaengen: { [TEE]: "Matcha mag das Zebra.\n" } }]);
  const head = git(v, "rev-parse", "HEAD");
  const r = await lauf(v);
  assert.equal(r.status, "ok");
  assert.equal(git(v, "rev-parse", "HEAD"), head);
  assert.ok(PR.leseAktionen(v).some((a) => a.stufe === "pflege-verworfen" && a.grund === "thema-ausgeschlossen"));
  assert.ok(existsSync(join(v, "00_inbox/tee-notiz.md")));
});

test("Themen-Guard Konsolidieren: Seite mit ausgeschlossenem Wort ist kein Kandidat", async () => {
  const Z = (t) => `- ${t} · Stand 0${1}.10.2026 · [[30_wissen/belege/2026-10/k1]]`;
  const fakten = Array.from({ length: 5 }, (_, i) => Z(`Aussage ${i} über das Zebra`)).join("\n");
  const v = neuerPflegeVault({ seiten: { "09_wiki/wissen/z.md": seite({ name: "z", description: "Z" }, `# Z\n\n## Fakten\n\n${fakten}\n`) },
    automatik: { tageslauf: "an", pflegeIntelligenz: "an", ernteOhneThema: ["zebra"] } });
  const K = await import("../tageslauf/konsolidieren.mjs");
  const ctx = pflegeCtx(v);
  assert.deepEqual(K.konsolidierKandidaten(ctx), []);
  assert.equal(ctx.pflegeInfo.thema["thema-ausgeschlossen"], 1);
  const ohne = pflegeCtx(neuerPflegeVault({ seiten: { "09_wiki/wissen/z.md": seite({ name: "z", description: "Z" }, `# Z\n\n## Fakten\n\n${fakten}\n`) } }));
  assert.equal(K.konsolidierKandidaten(ohne).length, 1, "ohne die Wortliste wäre sie Kandidat");
});

test("Antwort „stimmt noch“ auf veraltet: stand UND pruefen_bis verlängert (zweiter Auftrag ohne Rückfrage)", () => {
  const v = neuerPflegeVault({ seiten: { [ORION]: seite({ name: "orion", description: "Orion", stand: "2026-01-01", pruefen_bis: "2026-04-01" }, "# Orion\n") } });
  const ctx = pflegeCtx(v);
  const id = R.legeRueckfrageAn(ctx, { typ: "veraltet", frage: "Stimmt orion.md noch?", seite: ORION, grund: "k7" });
  R.beantworte(v, id, "stimmt-noch");
  const r = A.wendeAntwortenAn(pflegeCtx(v));
  assert.deepEqual(r.auftraege.map((a) => [a.feld, a.wert, a.ref, !!a.rueckfrage]),
    [["stand", ctx.heute, id, true], ["pruefen_bis", plusTage(ctx.heute, 90), `${id}-frist`, false]]);
});

test("W7 auf einer Seite, die die Pflege geschrieben hat, zählt als Fehler", () => {
  const v = neuerPflegeVault({ seiten: SEITEN });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "w7.jsonl"), JSON.stringify({ v: 1, seite: TEE, sitzung: "s9", uuid: "u1", zeit: "2026-10-21T12:00:00Z", zitat: "Das stimmt nicht" }) + "\n");
  const aktionen = [{ id: "inbox-x", stufe: "pflege", art: "inbox", commit: "c1", ziel: TEE, seiten: [TEE], zeit: "2026-10-01T00:00:00Z" }];
  A.w7Eingang(pflegeCtx(v), { aktionen });
  assert.deepEqual(PR.lesePruefungen(v).map((p) => [p.art, p.fehler, p.seite]), [["w7", true, TEE]]);
});

test("Brain-Hinweis: Seite mit herkunft_web zeigt „(teils laut Web-Recherche)“", () => {
  const v = neuerPflegeVault({ seiten: { ...SEITEN, [TEE]: seite({ name: "tee", description: "Tee", herkunft_web: ["Matcha"] }, "# Tee\n") } });
  assert.match(seitenStatus(v, TEE).zusatz, /\(teils laut Web-Recherche\)/);
  assert.doesNotMatch(seitenStatus(v, ORION).zusatz, /Web-Recherche/);
});

test("Lint meldet DRIFT im vollen Lauf, nie im pre-commit (--struktur)", () => {
  const v = tempOrdner("Drift Brän");
  writeFileSync(join(v, "brain.config.json"), "{}");
  mkdirSync(join(v, "09_wiki", "wissen"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "_ausgemustert.md"), "# Ausgemustert\n\n- Altname → Neuname\n");
  writeFileSync(join(v, "09_wiki", "wissen", "a.md"), "---\nname: a\ndescription: A\ntyp: thema\n---\n\n# A\n\nAltname läuft.\n");
  const home = tempOrdner("home");
  const lint = (...a) => spawnSync(process.execPath, [join(KIT, "brain-lint.mjs"), v, ...a],
    { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 30000, windowsHide: true }).stdout || "";
  assert.match(lint(), /- DRIFT: wissen\/a\.md — „Altname“ ist ausgemustert → „Neuname“/);
  assert.doesNotMatch(lint("--struktur"), /DRIFT/);
});
