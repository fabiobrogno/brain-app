// .tools/tests/test-pflege-entscheidungen.mjs — B3 Task 10: Die Entscheidung des Nutzers löst den Kasten deterministisch auf (ohne KI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, symlinkSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, committe, JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
const A = await import("../tageslauf/konflikt-aufloesen.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { schreibeEntscheidung, listeEntscheidungen } = await import("../entscheidungen.mjs");
const { konfliktKaesten } = await import("../konflikte.mjs");
const { konfliktRueckfragen, listeRueckfragen } = await import("../rueckfragen.mjs");
isoliere();

const SEITE = "09_wiki/wissen/orion.md";
const K1 = ['> [!KONFLIKT] offen — Du entscheidest', '> A: "Orion läuft auf Port 3309" — Quelle: [[30_wissen/a]]',
  '> B: "Orion läuft auf Port 3310" — Quelle: [[30_wissen/b]]'].join("\n");
const K2 = ['> [!KONFLIKT] offen — Du entscheidest', '> A: "Orion hat 2 Kerne" — Quelle: [[30_wissen/c]]',
  '> B: "Orion hat 4 Kerne" — Quelle: [[30_wissen/d]]'].join("\n");
const orion = (fm = {}) => seite({ name: "orion", description: "Orion", ...fm },
  `# Orion\n\n${Array.from({ length: 6 }, (_, i) => `Absatz ${i + 1}.`).join("\n\n")}\n\n${K1}\n\nMehr Text.\n\n${K2}\n`);

async function lauf(v, opt = {}) {
  const ctx = pflegeCtx(v, opt);
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try { return { ctx, kopie, posten: await A.entscheidungSchritt(ctx, kopie) }; }
  catch (e) { verwerfeArbeitskopie(v, kopie); throw e; }
}

test("Entscheidung B mit Notiz: Kasten wird ein Satz mit Quelle und Vermerk, anderer Kasten bleibt, rev 2; nach dem Merge archiviert", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const { id } = schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "b", notiz: "neuer Server", fingerabdruck: fp }, new Date(JETZT - 3600e3));
  const { ctx, kopie, posten } = await lauf(v);
  assert.equal(posten.length, 1);
  const [p] = posten;
  assert.equal(p.erg.ok, true, JSON.stringify(p.erg));
  assert.deepEqual(p.aktion, { entscheidung: id, wahl: "b", fp });
  assert.equal(p.erg.info.verliererNoch, false);
  const t = readFileSync(join(kopie.pfad, SEITE), "utf8");
  assert.ok(t.includes("\nOrion läuft auf Port 3310 — Quelle: [[30_wissen/b]] _(Konflikt entschieden am 22.10.2026: B gilt — neuer Server)_\n"), t);
  assert.doesNotMatch(t, /3309/);
  assert.equal(konfliktKaesten(t).konflikte.length, 1);
  assert.match(t, /^rev: 2$/m);
  assert.match(git(kopie.pfad, "log", "-1", "--format=%s"), /^pflege\(\d{8}-\d{6}\): entscheidung orion\.md: B gilt \(neuer Server\) \[entscheidung-[a-z0-9-]+\]$/);
  assert.ok(existsSync(join(v, "00_inbox/_entscheidungen", `${id}.md`)), "vor dem Merge bleibt der Auftrag liegen");
  assert.equal(P.uebernehmePflege(ctx, kopie).ok, true);
  assert.deepEqual(p.nachMerge("x"), { verschoben: `90_archiv/entscheidungen-erledigt/${id}.md` });
  assert.deepEqual(listeEntscheidungen(v), []);
  verwerfeArbeitskopie(v, kopie);
});

test("loeseKastenAuf: beide → zwei Listenpunkte, Einrückung bleibt, Quelle darf fehlen; fremder Fingerabdruck → null", () => {
  const t = `- Punkt\n  > [!KONFLIKT] offen\n  > A: "eins" — Quelle: [[30_wissen/a]]\n  > B: "zwei"\n- Weiter\n`;
  const fp = konfliktKaesten(t).konflikte[0].fp;
  assert.equal(A.loeseKastenAuf(t, { fp, wahl: "beide", datum: "22.10.2026" }),
    "- Punkt\n  - eins — Quelle: [[30_wissen/a]]\n  - zwei _(Konflikt entschieden am 22.10.2026: beide gelten)_\n- Weiter\n");
  assert.equal(A.loeseKastenAuf(t, { fp, wahl: "a", notiz: "x", datum: "22.10.2026" }),
    "- Punkt\n  eins — Quelle: [[30_wissen/a]] _(Konflikt entschieden am 22.10.2026: A gilt — x)_\n- Weiter\n");
  assert.equal(A.loeseKastenAuf(t, { fp: "000000000000", wahl: "a", datum: "22.10.2026" }), null);
  assert.equal(A.loeseKastenAuf(t, { fp, wahl: "spaeter", datum: "22.10.2026" }), null);
});

test("kritische Seite bleibt für /ingest; Kasten von Hand entfernt → Entscheidung archiviert (Probe: liegen lassen)", async () => {
  let v = neuerPflegeVault({ seiten: { [SEITE]: orion({ kritisch: true }) } });
  schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "a" });
  let r = await lauf(v);
  assert.deepEqual(r.posten.map((p) => p.erg.grund), ["kritisch"]);
  assert.deepEqual(r.ctx.pflegeInfo.entscheidungen.kritisch, [SEITE]);
  assert.equal(listeEntscheidungen(v).length, 1);
  assert.equal(git(r.kopie.pfad, "log", "-1", "--format=%s"), "start");
  verwerfeArbeitskopie(v, r.kopie);

  v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "a" });
  committe(v, SEITE, orion().replace(`${K1}\n\n`, ""));
  r = await lauf(v, { probe: true });
  assert.deepEqual(r.posten.map((p) => p.erg.grund), ["kasten-weg"]);
  assert.equal(listeEntscheidungen(v).length, 1, "Probe verschiebt nichts");
  verwerfeArbeitskopie(v, r.kopie);
  r = await lauf(v);
  assert.match(r.posten[0].aktion.verschoben, /^90_archiv\/entscheidungen-erledigt\/[a-z0-9-]+\.md$/);
  assert.equal(listeEntscheidungen(v).length, 0);
  verwerfeArbeitskopie(v, r.kopie);
});

test("höchstens 5 je Lauf, je ein Commit; verworfene Aussage steht noch anderswo → Hinweis", async () => {
  const W = "09_wiki/wissen/werte.md";
  const kaesten = Array.from({ length: 6 }, (_, i) => ["> [!KONFLIKT] offen", `> A: "Wert ${i} ist ${i}0" — Quelle: [[30_wissen/a${i}]]`,
    `> B: "Wert ${i} ist ${i}1" — Quelle: [[30_wissen/b${i}]]`].join("\n"));
  const v = neuerPflegeVault({ seiten: { [W]: seite({ name: "werte", description: "Werte" },
    `# Werte\n\nWert 0 ist 01 stand früher hier.\n\n${kaesten.join("\n\n")}\n`) } });
  for (let i = 0; i < 6; i++) schreibeEntscheidung(v, { seite: W, nr: i + 1, wahl: "a" }, new Date(JETZT - (i + 1) * 60e3));
  const { ctx, kopie, posten } = await lauf(v);
  assert.equal(posten.length, 5);
  assert.ok(posten.every((p) => p.erg.ok), JSON.stringify(posten.map((p) => p.erg.grund)));
  assert.deepEqual(posten.map((p) => p.erg.info.verliererNoch), [true, false, false, false, false]);
  assert.equal(git(kopie.pfad, "log", "--format=%s").split("\n").filter((s) => s.startsWith("pflege(")).length, 5);
  assert.equal(ctx.pflegeInfo.entscheidungen.offen, 1);
  assert.match(readFileSync(join(kopie.pfad, W), "utf8"), /^rev: 6$/m);
  verwerfeArbeitskopie(v, kopie);
});

// ---- Zusatz (Korrektheit): nur anwenden, was eindeutig entschieden ist ----------------------------------------------------

const imArchiv = (v) => { try { return readdirSync(join(v, "90_archiv/entscheidungen-erledigt")); } catch { return []; } };
const entscheidungsDatei = (v, id) => join(v, "00_inbox/_entscheidungen", `${id}.md`);

test("Kasten seither geändert (Fingerabdruck passt nicht): Seite bleibt, kein Commit, Auftrag archiviert, neuer Kasten wird neu gefragt", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const { id } = schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "a", fingerabdruck: fp });
  const geaendert = orion().replace("Port 3310", "Port 3311");            // B-Aussage seither anders → anderer Fingerabdruck
  committe(v, SEITE, geaendert);
  const { ctx, kopie, posten } = await lauf(v);
  assert.deepEqual(posten.map((p) => p.erg.grund), ["kasten-weg"]);
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "");
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), `edit ${SEITE}`, "kein Pflege-Commit");
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), geaendert);
  assert.deepEqual(imArchiv(v), [`${id}.md`]);
  assert.equal(listeEntscheidungen(v).length, 0);
  assert.ok(konfliktRueckfragen(ctx) >= 1, "der geänderte Kasten bekommt eine neue Rückfrage");
  assert.ok(listeRueckfragen(v).some((r) => r.typ === "konflikt" && r.fm.fp === konfliktKaesten(geaendert).konflikte[0].fp));
  verwerfeArbeitskopie(v, kopie);
});

test("nicht eindeutig: ohne Fingerabdruck, „später“ und fremder Fingerabdruck verändern nichts", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const dir = join(v, "00_inbox/_entscheidungen");
  const datei = (wahl, fpZeile) => ["---", "typ: entscheidung", `seite: ${JSON.stringify(SEITE)}`, "konflikt: 1", `wahl: ${wahl}`, ...fpZeile,
    'notiz: ""', "erstellt: 2026-10-22T01:00:00Z", "---", "", "# Entscheidung", ""].join("\n");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ohne-fp.md"), datei("a", []));
  writeFileSync(join(dir, "spaeter.md"), datei("spaeter", [`fingerabdruck: ${fp}`]));
  writeFileSync(join(dir, "fremd.md"), datei("a", ["fingerabdruck: 0123456789ab"]));
  const { kopie, posten } = await lauf(v);
  assert.deepEqual(posten.map((p) => p.erg.grund).sort(), ["kasten-weg", "ohne-fingerabdruck"]);
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), orion());
  assert.deepEqual(listeEntscheidungen(v).map((e) => e.id).sort(), ["ohne-fp", "spaeter"], "„später“ und ohne Fingerabdruck bleiben liegen");
  verwerfeArbeitskopie(v, kopie);
});

test("zwei Aufträge zum selben Kasten: die neueste gilt, die ältere wird danach archiviert", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const alt = schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "a", fingerabdruck: fp }, new Date(JETZT - 7200e3)).id;
  const altText = readFileSync(entscheidungsDatei(v, alt), "utf8");
  const neu = schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "b", fingerabdruck: fp }, new Date(JETZT - 3600e3)).id;
  writeFileSync(entscheidungsDatei(v, alt), altText);                      // schreibeEntscheidung räumt die alte weg — hier absichtlich wieder da
  let r = await lauf(v);
  assert.equal(r.posten.length, 1);
  assert.equal(r.posten[0].aktion.entscheidung, neu);
  assert.equal(r.posten[0].aktion.wahl, "b");
  assert.equal(P.uebernehmePflege(r.ctx, r.kopie).ok, true);
  r.posten[0].nachMerge("x");
  verwerfeArbeitskopie(v, r.kopie);
  r = await lauf(v);
  assert.deepEqual(r.posten.map((p) => [p.aktion.entscheidung, p.erg.grund]), [[alt, "kasten-weg"]]);
  assert.deepEqual(imArchiv(v).sort(), [`${alt}.md`, `${neu}.md`].sort());
  verwerfeArbeitskopie(v, r.kopie);
});

test("Kasten nur ungespeichert im Brain: später, nichts archiviert, nichts geschrieben", async () => {
  const ohne = orion().replace(`${K1}\n\n`, "");
  const v = neuerPflegeVault({ seiten: { [SEITE]: ohne } });
  writeFileSync(join(v, SEITE), orion());                                   // Der Nutzer hat den Kasten im Brain (noch) nicht committet
  schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "a" });
  const { kopie, posten } = await lauf(v);
  assert.deepEqual(posten, []);
  assert.equal(listeEntscheidungen(v).length, 1);
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  verwerfeArbeitskopie(v, kopie);
});

test("Ziel aus dem Auftrag ist nur Text: „..“-Pfad und Symlink aus der Kopie heraus werden nie beschrieben", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const aussen = tempOrdner("aussen");
  const fremd = join(aussen, "fremd.md");
  writeFileSync(fremd, orion());
  symlinkSync(fremd, join(v, "09_wiki/wissen/link.md"));
  git(v, "add", "--", "09_wiki/wissen/link.md");
  git(v, "commit", "-qm", "link");
  const dir = join(v, "00_inbox/_entscheidungen");
  mkdirSync(dir, { recursive: true });
  const datei = (seite) => ["---", "typ: entscheidung", `seite: ${JSON.stringify(seite)}`, "konflikt: 1", "wahl: a", `fingerabdruck: ${fp}`,
    'notiz: ""', "erstellt: 2026-10-22T01:00:00Z", "---", "", "# Entscheidung", ""].join("\n");
  writeFileSync(join(dir, "traversal.md"), datei("09_wiki/../../../../../../../../../../.." + fremd));
  writeFileSync(join(dir, "link.md"), datei("09_wiki/wissen/link.md"));
  writeFileSync(join(dir, "absolut.md"), datei(fremd));
  const { kopie, posten } = await lauf(v);
  assert.deepEqual(posten.map((p) => p.erg.grund).sort(), ["ziel-ungueltig", "ziel-ungueltig", "ziel-ungueltig"]);
  assert.equal(readFileSync(fremd, "utf8"), orion(), "außerhalb unverändert");
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "link");
  assert.equal(listeEntscheidungen(v).length, 3, "bleiben liegen");
  verwerfeArbeitskopie(v, kopie);
});

test("Prüfung rot (pre-commit): nichts committet, Seite unverändert, Auftrag bleibt liegen", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() }, hook: "rot" });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const { id } = schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "beide", fingerabdruck: fp });
  const { kopie, posten } = await lauf(v);
  assert.deepEqual(posten.map((p) => [p.erg.ok, p.erg.grund]), [[false, "pruefung-rot"]]);
  assert.equal(posten[0].nachMerge, undefined);
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "");
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), orion());
  assert.ok(existsSync(entscheidungsDatei(v, id)));
  verwerfeArbeitskopie(v, kopie);
});

test("Ergebnis geht durch die Diff-Prüfung: _log-Eintrag, rev+1, Betreff; Probe schreibt nichts in den Vault", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const fp = konfliktKaesten(orion()).konflikte[0].fp;
  const { id } = schreibeEntscheidung(v, { seite: SEITE, nr: 1, wahl: "a", fingerabdruck: fp });
  const { ctx, kopie, posten } = await lauf(v, { probe: true });
  assert.equal(posten[0].erg.ok, true);
  assert.match(readFileSync(join(kopie.pfad, "09_wiki/_log.md"), "utf8"), /pflege\(\d{8}-\d{6}\): Konflikt entschieden: orion\.md: A gilt/);
  assert.equal(P.uebernehmePflege(ctx, kopie).grund, "probe");
  assert.equal(posten[0].nachMerge("x").verschoben, null, "Probe verschiebt nichts");
  assert.equal(readFileSync(join(v, SEITE), "utf8"), orion(), "Vault unberührt");
  assert.ok(existsSync(entscheidungsDatei(v, id)));
  verwerfeArbeitskopie(v, kopie);
});
