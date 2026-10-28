// .tools/tests/test-tageslauf-bestand.mjs — Bestand, Protokoll, Budget (B2, Task 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, fakeKi, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const K = await import("../tageslauf/ki.mjs");
isoliere();
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });

test("leseFm/schreibeFm: Rundreise; typ/art roh, Strings JSON, Listen und Booleans", () => {
  const text = B.schreibeFm({ typ: "vorschlag", art: "fakt", titel: 'Er sagt "ja": gut', liste: ["a", "b"], kritisch: true }, "\n# T\n");
  assert.match(text, /^---\ntyp: vorschlag\nart: fakt\ntitel: "Er sagt \\"ja\\": gut"\n/);
  const { fm, rumpf, ok } = B.leseFm(text);
  assert.equal(ok, true);
  assert.equal(fm.titel, 'Er sagt "ja": gut');
  assert.deepEqual(fm.liste, ["a", "b"]);
  assert.equal(fm.kritisch, true);
  assert.equal(rumpf, "\n# T\n");
  assert.equal(B.leseFm("ohne").ok, false);
});

test("ladeVorschlaege: zitat/herkunft/fundstelle, _warten, neueste zuerst, Kaputtes übersprungen", () => {
  const v = neuerTestVault();
  legeVorschlagAn(v, { id: "a1", erstellt: "2026-10-01T10:00:00Z", zitat: "Z", herkunft: "du", fundstelle: "s1#u-1" });
  legeVorschlagAn(v, { id: "b2", erstellt: "2026-10-05T10:00:00Z", unterordner: "_warten", warten_seit: "2026-10-06T00:00:00Z", warten_grund: "keine-seite" });
  writeFileSync(join(v, "00_inbox", "_vorschlaege", "kaputt.md"), "kein Frontmatter");
  const l = B.ladeVorschlaege(v);
  assert.deepEqual(l.map((x) => x.id), ["b2", "a1"]);
  assert.deepEqual([l[1].zitat, l[1].herkunft, l[1].fundstelle, l[1].titel, l[1].text], ["Z", "du", "s1#u-1", "Titel", "Text."]);
  assert.deepEqual([l[0].unterordner, l[0].wartenGrund], ["_warten", "keine-seite"]);
  assert.equal(B.ladeVorschlag(v, "_vorschlaege", "a1").id, "a1");
  assert.equal(B.ladeVorschlag(v, "_vorschlaege", "../x"), null);
});

test("verschiebeVorschlag: nie überschreiben (-2), Wiki als Ziel verboten, Probe ändert nichts", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  legeVorschlagAn(v, { id: "x1" });
  mkdirSync(join(v, "90_archiv", "z"), { recursive: true });
  writeFileSync(join(v, "90_archiv", "z", "x1.md"), "alt");
  const probe = ctxFuer(v, { probe: true });
  assert.equal(B.verschiebeVorschlag(probe, B.ladeVorschlaege(v)[0], "90_archiv/z"), "90_archiv/z/x1.md");
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "x1.md")));
  assert.throws(() => B.verschiebeVorschlag(ctx, B.ladeVorschlaege(v)[0], "09_wiki/x"));
  assert.equal(B.verschiebeVorschlag(ctx, B.ladeVorschlaege(v)[0], "90_archiv/z", { zitat: "neu" }), "90_archiv/z/x1-2.md");
  assert.equal(readFileSync(join(v, "90_archiv", "z", "x1.md"), "utf8"), "alt");
  assert.match(readFileSync(join(v, "90_archiv", "z", "x1-2.md"), "utf8"), /zitat: "neu"/);
  assert.ok(!existsSync(join(v, "00_inbox", "_vorschlaege", "x1.md")));
});

test("aussortieren/ablehnen/warten: Ordner je Grund, Aktion notiert, warten_seit bleibt", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  legeVorschlagAn(v, { id: "a" }); legeVorschlagAn(v, { id: "b" }); legeVorschlagAn(v, { id: "c" });
  const [c, b, a] = B.ladeVorschlaege(v).sort((x, y) => y.id.localeCompare(x.id));
  assert.equal(B.aussortieren(ctx, a, "dublette"), "90_archiv/vorschlaege-aussortiert/dublette/a.md");
  assert.equal(B.ablehnen(ctx, b, "rueckfrage-a"), "90_archiv/vorschlaege-abgelehnt/b.md");
  assert.equal(B.warten(ctx, c, "keine-seite"), "00_inbox/_warten/c.md");
  assert.throws(() => B.aussortieren(ctx, B.ladeVorschlaege(v)[0], "../böse"));
  const w = B.ladeVorschlaege(v)[0];
  const seit = w.wartenSeit;
  B.warten(ctxFuer(v, { jetzt: JETZT + 86400e3 }), w, "pruefung-rot", "SECRETS: x");
  const w2 = B.ladeVorschlaege(v)[0];
  assert.deepEqual([w2.wartenSeit, w2.wartenGrund, w2.fm.warten_befund], [seit, "pruefung-rot", "SECRETS: x"]);
  assert.deepEqual(ctx.aktionen.map((x) => x.stufe), ["aussortieren", "abgelehnt", "warten"]);
});

test("Aktionen, Prüfungen, Cache, letzter.json; Probe schreibt keine Prüfungen und Aktionen nach probe-aktionen", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  P.notiere(ctx, { id: "a", stufe: "uebernehmen", commit: "c1", auto: true });
  P.notiere(ctx, { id: "b", stufe: "uebernehmen", commit: "c2", auto: false });
  P.notiere(ctx, { id: "c", stufe: "uebernehmen", commit: "c3", auto: true });
  P.notiere(ctx, { id: "c", stufe: "zurueck" });
  P.schreibeAktionen(ctx);
  assert.deepEqual(P.autoUebernahmen(P.leseAktionen(v)).map((a) => a.id), ["a"]);
  P.merkePruefung(ctx, { art: "w7", fehler: true, ref: "rf-1" });
  P.merkePruefung(ctx, { art: "stichprobe", fehler: false, ref: "rf-2" });
  P.merkePruefung(ctx, { art: "aufgehoben", ref: "rf-1" });
  assert.deepEqual(P.lesePruefungen(v).map((p) => p.ref), ["rf-2"]);
  const probe = ctxFuer(v, { probe: true });
  P.merkePruefung(probe, { art: "w7", fehler: true, ref: "rf-3" });
  P.notiere(probe, { id: "p", stufe: "uebernehmen" }); P.schreibeAktionen(probe);
  assert.equal(P.lesePruefungen(v).length, 1);
  assert.ok(existsSync(join(P.TL_DIR(v), "probe-aktionen.jsonl")));
  ctx.cache.belege.x = { ergebnis: "ok" }; P.speichereCache(ctx);
  assert.deepEqual(P.ladeCache(v).belege.x, { ergebnis: "ok" });
  P.schreibeLetzter(v, { lauf: "l1" }); assert.equal(P.leseLetzter(v).lauf, "l1");
  assert.match(ctx.lauf, /^20261022-030000$/);
});

test("hinweisNutzung: zählt hits je Seite ab seitMs", () => {
  const v = neuerTestVault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "hint.log"), [
    "2026-10-01T10:00:00 sid=a hits=09_wiki/a.md ms=1",
    "2026-10-10T10:00:00 sid=a hits=09_wiki/a.md,09_wiki/b.md ms=1",
    "2026-10-11T10:00:00 sid=a hits=- ms=1", ""].join("\n"));
  const n = P.hinweisNutzung(v, { seitMs: Date.parse("2026-10-05T00:00:00Z") });
  assert.equal(n.get("09_wiki/a.md").length, 1);
  assert.equal(n.get("09_wiki/b.md").length, 1);
});

test("Budget: Aufrufe und Minuten begrenzen", () => {
  let t = 0;
  const b = K.neuesBudget({ aufrufe: 2, minuten: 1 }, () => t);
  assert.equal(b.frei(), true); b.zaehle(); b.zaehle();
  assert.equal(b.frei(), false);
  const c = K.neuesBudget({ aufrufe: 9, minuten: 1 }, () => t);
  t = 61000;
  assert.equal(c.frei(), false); assert.equal(c.zeitUm(), true);
});

test("kiAufruf: zählt Aufrufe/Tokens; Budget leer → budget; ohne claude → ohneKi; 3 Fehler in Folge → ohneKi", async () => {
  const v = neuerTestVault();
  fakeKi([], { standard: "hallo" });
  const ctx = ctxFuer(v, { budget: { aufrufe: 1, minuten: 15 } });
  assert.deepEqual(await K.kiAufruf(ctx, { system: "S", eingabe: "E" }), { text: "hallo" });
  assert.equal(ctx.aufrufe, 1); assert.ok(ctx.tokens.ein > 0);
  assert.deepEqual(await K.kiAufruf(ctx, { system: "S", eingabe: "E" }), { budget: true });
  const ohne = ctxFuer(v, { claudeBefehl: null });
  assert.deepEqual(await K.kiAufruf(ohne, { system: "S", eingabe: "E" }), { ohneKi: true });
  assert.equal(ohne.ohneKi, true);
  fakeKi([], { exit: 1 });
  const kaputt = ctxFuer(v);
  for (let i = 0; i < 3; i++) assert.ok((await K.kiAufruf(kaputt, { system: "S", eingabe: "E" })).fehler);
  assert.equal(kaputt.ohneKi, true);
  assert.deepEqual(await K.kiAufruf(kaputt, { system: "S", eingabe: "E" }), { ohneKi: true });
});
