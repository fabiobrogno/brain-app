// .tools/tests/test-tageslauf-autostufe.mjs — Fehlerquote, Autostufe normal → eng → aus → zurück, „bewährt" (B2, Task 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
const AS = await import("../tageslauf/autostufe.mjs");
const P = await import("../tageslauf/protokoll.mjs");
isoliere();
const TAG = 86400e3;
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const p = (fehler, tag) => ({ zeit: new Date(JETZT - (100 - tag) * TAG).toISOString(), art: "stichprobe", fehler });
const reihe = (ok, fehler, ab = 0) => [...Array.from({ length: ok }, (_, i) => p(false, ab + i)), ...Array.from({ length: fehler }, (_, i) => p(true, ab + ok + i))];
const J = new Date(JETZT).toISOString();

test("quote: nur die letzten 40 Prüfungen zählen", () => {
  assert.deepEqual(AS.quote([...reihe(0, 10), ...reihe(40, 0, 10)]), { fehler: 0, geprueft: 40 });
});

test("naechsteAutostufe: > 5 % → eng, > 15 % → aus (Grenzen exklusiv)", () => {
  const start = { stufe: "normal", seit: "1970-01-01T00:00:00.000Z" };
  assert.equal(AS.naechsteAutostufe(start, reihe(19, 1), J).stufe, "normal");
  assert.equal(AS.naechsteAutostufe(start, reihe(18, 2), J).stufe, "eng");
  assert.equal(AS.naechsteAutostufe(start, reihe(17, 3), J).stufe, "eng");
  assert.equal(AS.naechsteAutostufe(start, reihe(16, 4), J).stufe, "aus");
  assert.equal(AS.naechsteAutostufe(start, reihe(16, 4), J).seit, J);
});

test("naechsteAutostufe: eine Stufe zurück nach 20 fehlerfreien seit dem Wechsel; alte Fehler lösen nichts Neues aus", () => {
  const seit = new Date(JETZT - 50 * TAG).toISOString();
  const alt = reihe(18, 2, 0);
  const sauber = reihe(20, 0, 60);
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit }, [...alt, ...sauber.slice(0, 19)], J).stufe, "eng");
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit }, [...alt, ...sauber], J).stufe, "normal");
  assert.equal(AS.naechsteAutostufe({ stufe: "aus", seit }, [...alt, ...sauber], J).stufe, "eng");
  assert.equal(AS.naechsteAutostufe({ stufe: "normal", seit: J }, [...alt], J).stufe, "normal", "kein neuer Fehler seit dem Wechsel");
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit }, [...alt, ...reihe(2, 2, 60)], J).stufe, "aus", "neue Fehler → strenger");
});

test("aktualisiereAutostufe: liest Prüfungen, setzt ctx, schreibt autostufe.json nur außerhalb der Probe", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  for (let i = 0; i < 4; i++) P.merkePruefung(ctx, { art: "stichprobe", fehler: i < 2, ref: `r${i}` });
  assert.equal(AS.aktualisiereAutostufe(ctxFuer(v, { probe: true })).stufe, "aus");
  assert.ok(!existsSync(join(P.TL_DIR(v), "autostufe.json")));
  AS.aktualisiereAutostufe(ctx);
  assert.deepEqual([ctx.autostufe, ctx.quote], ["aus", { fehler: 2, geprueft: 4 }]);
  assert.equal(AS.ladeAutostufe(v).stufe, "aus");
  assert.equal(ctx.aktionen.at(-1).stufe, "autostufe");
  assert.deepEqual([AS.stichprobenJeWoche("normal"), AS.stichprobenJeWoche("eng")], [2, 4]);
});

test("bewaehrtePruefungen: automatische Übernahme > 30 Tage, seitdem als Hinweis gezeigt, unbeanstandet → einmal „bewährt“", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  const a = (id, tage, extra = {}) => ({ lauf: "L", zeit: new Date(JETZT - tage * TAG).toISOString(), id, stufe: "uebernehmen", ziel: `09_wiki/${id}.md`, commit: "c", auto: true, ...extra });
  const aktionen = [a("gut", 40), a("jung", 10), a("ungenutzt", 40), a("beanstandet", 40), a("hand", 40, { auto: false })];
  const nutzung = new Map(["gut", "jung", "beanstandet", "hand"].map((id) => [`09_wiki/${id}.md`, [JETZT - 5 * TAG]]));
  const pruefungen = [{ art: "w7", fehler: true, seite: "09_wiki/beanstandet.md", ref: "rf-x" }];
  assert.equal(AS.bewaehrtePruefungen(ctx, { aktionen, pruefungen, nutzung }), 1);
  const neu = P.lesePruefungen(v);
  assert.deepEqual(neu.map((x) => [x.art, x.ref, x.fehler]), [["bewaehrt", "bewaehrt:gut", false]]);
  // Im Betrieb steht alles in einer Datei: die frühere W7-Beanstandung bleibt sichtbar, „bewährt" ist schon vermerkt.
  assert.equal(AS.bewaehrtePruefungen(ctx, { aktionen, pruefungen: [...pruefungen, ...neu], nutzung }), 0, "nur einmal je Übernahme");
});

// --- Zusätzliche Tests: Grenzen, Zustandsdatei, Rückweg in zwei Stufen, Randfälle von „bewährt" ---
const START = { stufe: "normal", seit: "1970-01-01T00:00:00.000Z" };

test("naechsteAutostufe: Grenzen im vollen 40er-Fenster (2/40 = 5 % normal, 3/40 eng, 6/40 = 15 % eng, 7/40 aus)", () => {
  assert.equal(AS.naechsteAutostufe(START, reihe(38, 2), J).stufe, "normal");
  assert.equal(AS.naechsteAutostufe(START, reihe(37, 3), J).stufe, "eng");
  assert.equal(AS.naechsteAutostufe(START, reihe(34, 6), J).stufe, "eng");
  assert.equal(AS.naechsteAutostufe(START, reihe(33, 7), J).stufe, "aus");
});

test("naechsteAutostufe: ohne Prüfungen normal; Quote wird mitgeliefert; Eingabe wird nicht verändert", () => {
  assert.deepEqual(AS.naechsteAutostufe(undefined, [], J).stufe, "normal");
  assert.deepEqual(AS.naechsteAutostufe(null, [], J).quote, { fehler: 0, geprueft: 0 });
  const pr = reihe(17, 3), kopie = JSON.stringify(pr);
  AS.naechsteAutostufe(START, pr, J);
  assert.equal(JSON.stringify(pr), kopie);
});

test("naechsteAutostufe: unbekannte Stufe im Zustand → normal; Wechsel setzt „seit“, Verbleib behält es", () => {
  assert.equal(AS.naechsteAutostufe({ stufe: "kaputt", seit: J }, [], J).stufe, "normal");
  const seit = new Date(JETZT - 5 * TAG).toISOString();
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit }, reihe(10, 0, 96), J).seit, seit);
  assert.equal(AS.naechsteAutostufe(START, reihe(18, 2), J).seit, J);
});

test("naechsteAutostufe: Rückweg aus „aus“ geht nur eine Stufe je 20 fehlerfreien Prüfungen (aus → eng → normal)", () => {
  const f = reihe(30, 10, 0);                         // 25 % → aus
  const s1 = AS.naechsteAutostufe(START, f, J);
  assert.equal(s1.stufe, "aus");
  const nach20 = [...f, ...reihe(20, 0, 50)];
  const s2 = AS.naechsteAutostufe({ stufe: "aus", seit: new Date(JETZT - 55 * TAG).toISOString() }, nach20, J);
  assert.equal(s2.stufe, "eng", "nach 20 sauberen erst eine Stufe zurück");
  const nach40 = [...nach20, ...reihe(20, 0, 80)];
  const seitEng = new Date(JETZT - 25 * TAG).toISOString();
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit: seitEng }, nach40, J).stufe, "normal");
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit: seitEng }, [...nach20, ...reihe(19, 0, 80)], J).stufe, "eng", "bei 19 noch nicht");
});

test("naechsteAutostufe: ein Fehler mitten in der Reihe unterbricht die Folge (20 am Stück, nicht 20 insgesamt)", () => {
  const seit = new Date(JETZT - 50 * TAG).toISOString();
  const mitFehler = [...reihe(30, 0, 0), p(true, 40), ...reihe(19, 0, 50)];
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit }, mitFehler, J).stufe, "eng");
});

test("naechsteAutostufe: Prüfungen vor dem Wechsel zählen nicht für den Rückweg", () => {
  const seit = new Date(JETZT - 1 * TAG).toISOString();
  assert.equal(AS.naechsteAutostufe({ stufe: "eng", seit }, reihe(25, 0, 0), J).stufe, "eng");
});

test("ladeAutostufe: ohne Datei, mit kaputter Datei oder fremder Stufe → normal", () => {
  const v = neuerTestVault();
  assert.equal(AS.ladeAutostufe(v).stufe, "normal");
  const ctx = ctxFuer(v);
  AS.aktualisiereAutostufe(ctx);
  assert.equal(AS.ladeAutostufe(v).stufe, "normal");
  writeFileSync(join(P.TL_DIR(v), "autostufe.json"), "{kaputt");
  assert.equal(AS.ladeAutostufe(v).stufe, "normal");
  writeFileSync(join(P.TL_DIR(v), "autostufe.json"), JSON.stringify({ stufe: "turbo", seit: J }));
  assert.equal(AS.ladeAutostufe(v).stufe, "normal");
});

test("aktualisiereAutostufe: kaputte Zustandsdatei hebelt die Bremse nicht aus — sie wird aus den Prüfungen neu abgeleitet", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  for (let i = 0; i < 10; i++) P.merkePruefung(ctx, { art: "stichprobe", fehler: i < 3, ref: `k${i}` });
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(join(P.TL_DIR(v), "autostufe.json"), "kein json");
  const c2 = ctxFuer(v);
  AS.aktualisiereAutostufe(c2);
  assert.equal(c2.autostufe, "aus");
  assert.equal(AS.ladeAutostufe(v).stufe, "aus");
});

test("aktualisiereAutostufe: bleibt die Stufe gleich, bleibt „seit“ und es gibt keine Aktion; Wechsel nennt die Quote", () => {
  const v = neuerTestVault();
  const c1 = ctxFuer(v);
  for (let i = 0; i < 20; i++) P.merkePruefung(c1, { art: "stichprobe", fehler: i < 2, ref: `a${i}` });
  AS.aktualisiereAutostufe(c1);
  assert.equal(c1.autostufe, "eng");
  assert.match(c1.aktionen.at(-1).grund, /normal → eng \(Fehlerquote 2\/20\)/);
  const seit = AS.ladeAutostufe(v).seit;
  const c2 = ctxFuer(v, { jetzt: JETZT + TAG });
  AS.aktualisiereAutostufe(c2);
  assert.equal(c2.autostufe, "eng");
  assert.equal(c2.aktionen.length, 0);
  assert.equal(AS.ladeAutostufe(v).seit, seit);
});

test("aktualisiereAutostufe: Probemodus rechnet mit dem gespeicherten Zustand, ändert ihn aber nie", () => {
  const v = neuerTestVault();
  const c0 = ctxFuer(v, { jetzt: JETZT - 20 * TAG });
  for (let i = 0; i < 10; i++) P.merkePruefung(c0, { art: "stichprobe", fehler: i < 1, ref: `p${i}` });
  AS.aktualisiereAutostufe(c0);
  assert.equal(AS.ladeAutostufe(v).stufe, "eng");
  const c1 = ctxFuer(v, { jetzt: JETZT - 10 * TAG });
  for (let i = 0; i < 25; i++) P.merkePruefung(c1, { art: "stichprobe", fehler: false, ref: `q${i}` });
  const probe = ctxFuer(v, { probe: true });
  assert.equal(AS.aktualisiereAutostufe(probe).stufe, "normal");
  assert.equal(probe.autostufe, "normal");
  assert.equal(AS.ladeAutostufe(v).stufe, "eng", "Datei unverändert");
  assert.equal(AS.aktualisiereAutostufe(ctxFuer(v)).stufe, "normal", "echter Lauf schreibt denselben Wechsel");
  assert.equal(AS.ladeAutostufe(v).stufe, "normal");
});

test("stichprobenJeWoche: normal 2, eng 4, aus 4 (strenger heißt mehr Stichproben)", () => {
  assert.deepEqual(AS.STUFEN.map(AS.stichprobenJeWoche), [2, 4, 4]);
});

test("bewaehrtePruefungen: Randfälle — genau 30 Tage, Nutzung vor der Übernahme, ohne Commit, zurückgenommen, Probemodus", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  const a = (id, tage, extra = {}) => ({ lauf: "L", zeit: new Date(JETZT - tage * TAG).toISOString(), id, stufe: "uebernehmen", ziel: `09_wiki/${id}.md`, commit: "c", auto: true, ...extra });
  const aktionen = [a("genau30", 30), a("vorher", 40), a("ohnecommit", 40, { commit: undefined }), a("zurueck", 40), { lauf: "L2", zeit: J, id: "zurueck", stufe: "zurueck" }, a("stand", 45, { stufe: "stand" }), a("rest", 40, { stufe: "aussortieren" })];
  const nutzung = new Map([["09_wiki/genau30.md", [JETZT - TAG]], ["09_wiki/vorher.md", [JETZT - 41 * TAG]], ["09_wiki/ohnecommit.md", [JETZT - TAG]],
    ["09_wiki/zurueck.md", [JETZT - TAG]], ["09_wiki/stand.md", [JETZT - TAG]], ["09_wiki/rest.md", [JETZT - TAG]]]);
  assert.equal(AS.bewaehrtePruefungen(ctx, { aktionen, pruefungen: [], nutzung }), 1, "nur die Stand-Übernahme");
  assert.deepEqual(P.lesePruefungen(v).map((x) => x.ref), ["bewaehrt:stand"]);
  const probe = ctxFuer(v, { probe: true });
  assert.equal(AS.bewaehrtePruefungen(probe, { aktionen: [a("probe", 40)], pruefungen: [], nutzung: new Map([["09_wiki/probe.md", [JETZT - TAG]]]) }), 1);
  assert.deepEqual(P.lesePruefungen(v).map((x) => x.ref), ["bewaehrt:stand"], "Probe schreibt keine Prüfung");
});

test("bewaehrtePruefungen: ohne Eingaben nichts; Beanstandung ohne Seite blockiert nichts; „aufgehoben“ gibt die Seite wieder frei", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  assert.equal(AS.bewaehrtePruefungen(ctx), 0);
  const a = { lauf: "L", zeit: new Date(JETZT - 40 * TAG).toISOString(), id: "x", stufe: "uebernehmen", ziel: "09_wiki/x.md", commit: "c", auto: true };
  const nutzung = new Map([["09_wiki/x.md", [JETZT - TAG]]]);
  assert.equal(AS.bewaehrtePruefungen(ctx, { aktionen: [a], pruefungen: [{ art: "stichprobe", fehler: true, ref: "r" }], nutzung }), 1);
  const v2 = neuerTestVault();
  const c2 = ctxFuer(v2);
  P.merkePruefung(c2, { art: "w7", fehler: true, seite: "09_wiki/x.md", ref: "w7-x" });
  P.merkePruefung(c2, { art: "aufgehoben", fehler: false, ref: "w7-x" });
  assert.equal(AS.bewaehrtePruefungen(c2, { aktionen: [a], pruefungen: P.lesePruefungen(v2), nutzung }), 1, "aufgehobene Beanstandung zählt nicht mehr");
});
