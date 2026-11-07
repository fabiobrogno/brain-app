// Kontingent wie Orca (Paket E5): die reinen Regeln — monotone Regel, Takt der Abfragen (nur bei sichtbarem Fenster, Aktivieren, Retry-After, Fehlerpause), Dichte-Leiter,
// ruhig veraltet, verbraucht/übrig und die Schwellen 80/100 % höchstens einmal je Fenster. Keine Uhr, keine Dateien: alles mit festen Zeiten. Dazu die Monotonie im echten Schreibweg
// (zeichneAuf) und bei Codex (werkstatt/kontingent.mjs) sowie die Mitteilung als Ereignis im Aktivitätsprotokoll.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

const R = await import(pfad("gemeinsam", "kontingent-regeln.mjs"));
const { istVeraltetesFenster, uebernimmMonoton, zeichneAuf } = await import(pfad("gemeinsam", "kortex-statuszeile.mjs"));
const { erzeugeKontingent } = await import(pfad("werkstatt", "kontingent.mjs"));
const { leseEreignisse, kennungVault } = await import(pfad("gemeinsam", "aktivitaet.mjs"));

const MIN = 60_000, STD = 3_600_000;
const T0 = Date.parse("2026-10-31T12:00:00.000Z");
const fen = (p, resetsAt, extra = {}) => ({ usedPercent: p, windowMinutes: 300, resetsAt, ...extra });

// ───────────── monotone Regel ─────────────
test("Monotone Regel: im selben Fenster zählen nur steigende Werte; niedrigere sind der Stand einer ruhenden Sitzung", () => {
  const ende = T0 + 2 * STD;
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(30, ende), T0), true, "kleiner im selben Fenster: verworfen");
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(40, ende), T0), false, "gleich: übernommen");
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(41, ende), T0), false, "größer: übernommen");
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(5, ende + 5 * STD), T0), false, "neues, späteres Fenster: übernommen, auch wenn der Wert kleiner ist");
});

test("Monotone Regel: Rücksetzzeiten innerhalb von ±60 s sind dasselbe Fenster, darüber hinaus ein anderes", () => {
  const ende = T0 + 2 * STD;
  for (const d of [-60_000, -1000, 0, 1000, 60_000]) assert.equal(istVeraltetesFenster(fen(40, ende), fen(30, ende + d), T0), true, `Abstand ${d} ms: dasselbe Fenster, kleiner → verworfen`);
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(30, ende + 60_001), T0), false, "61 s später: anderes (neueres) Fenster");
  // eine ÄLTERE Rücksetzzeit (mehr als 60 s früher) ist ein alter Stand, auch mit höherem Wert
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(90, ende - 60_001), T0), true);
  assert.equal(istVeraltetesFenster(fen(40, ende), fen(90, ende - 60_000), T0), false, "genau 60 s früher: dasselbe Fenster, höher → übernommen");
});

test("Monotone Regel: ohne Rücksetzzeit oder bei abgelaufenem Fenster schützt nichts", () => {
  assert.equal(istVeraltetesFenster(null, fen(10, T0 + STD), T0), false);
  assert.equal(istVeraltetesFenster(fen(40, null), fen(10, T0 + STD), T0), false);
  assert.equal(istVeraltetesFenster(fen(40, T0 + STD), fen(10, null), T0), false);
  assert.equal(istVeraltetesFenster(fen(80, T0 - 1), fen(10, T0 + 5 * STD), T0), false, "das frühere Fenster ist vorbei");
  assert.equal(istVeraltetesFenster(fen(80, T0), fen(10, T0), T0), false, "genau jetzt abgelaufen zählt als vorbei");
});

test("uebernimmMonoton: je Fenster einzeln; verworfene behalten den bisherigen Wert", () => {
  const vorher = { session: fen(40, T0 + 2 * STD), weekly: fen(20, T0 + 50 * STD, { windowMinutes: 10080 }) };
  const neu = { session: fen(30, T0 + 2 * STD), weekly: fen(25, T0 + 50 * STD, { windowMinutes: 10080 }) };
  const m = uebernimmMonoton(vorher, neu, T0);
  assert.equal(m.session.usedPercent, 40, "5 Std bleibt bei 40");
  assert.equal(m.weekly.usedPercent, 25, "Woche steigt auf 25");
  assert.equal(m.verworfen, 1);
  assert.deepEqual(uebernimmMonoton(null, neu, T0), { session: neu.session, weekly: neu.weekly, verworfen: 0 });
});

test("Schreibweg der Statuszeile: eine ruhende Sitzung überschreibt nie einen höheren Stand, eine Sitzung im neuen Fenster schon", () => {
  const ordner = tmp("brain-kt-monoton-");
  const ziel = join(ordner, "k_aaaa0001.json");
  const ende = Math.floor((Date.now() + 2 * STD) / 1000);
  const eingabe = (p, e) => ({ rate_limits: { five_hour: { used_percentage: p, resets_at: e }, seven_day: { used_percentage: 10, resets_at: ende + 3 * 86400 } } });
  const alt = (zeit) => utimesSync(ziel, new Date(zeit), new Date(zeit));
  assert.equal(zeichneAuf(ordner, "k_aaaa0001", eingabe(60, ende), Date.now()), true);
  alt(Date.now() - 20_000);
  // niedrigerer Wert im selben Fenster (±1 s Rundung): verworfen, Datei bleibt unverändert (auch „geschrieben“)
  const vorher = readFileSync(ziel, "utf8");
  assert.equal(zeichneAuf(ordner, "k_aaaa0001", { rate_limits: { five_hour: { used_percentage: 20, resets_at: ende + 1 }, seven_day: { used_percentage: 5, resets_at: ende + 3 * 86400 + 1 } } }, Date.now()), false);
  assert.equal(readFileSync(ziel, "utf8"), vorher);
  // steigt ein Fenster und fällt das andere: das steigende wird übernommen, das fallende behält seinen Wert
  assert.equal(zeichneAuf(ordner, "k_aaaa0001", { rate_limits: { five_hour: { used_percentage: 70, resets_at: ende }, seven_day: { used_percentage: 4, resets_at: ende + 3 * 86400 } } }, Date.now()), true);
  let j = JSON.parse(readFileSync(ziel, "utf8"));
  assert.equal(j.session.usedPercent, 70);
  assert.equal(j.weekly.usedPercent, 10, "die Woche fiel auf 4: bleibt bei 10");
  alt(Date.now() - 20_000);
  // neues Fenster (Rücksetzzeit Stunden später): der kleinere Wert gilt
  assert.equal(zeichneAuf(ordner, "k_aaaa0001", eingabe(3, ende + 5 * 3600), Date.now()), true);
  j = JSON.parse(readFileSync(ziel, "utf8"));
  assert.equal(j.session.usedPercent, 3);
});

// ───────────── Takt ─────────────
const basis = { jetzt: T0, sichtbar: true, aktiviert: false, neu: false, laeuft: false, letzterVersuch: T0 - 20 * MIN, fehlerFolge: 0, retryBis: 0 };
const plan = (o) => R.planeAbfrage({ ...basis, ...o });

test("Takt: nur bei sichtbarem Fenster; ein unsichtbares Studio fragt nie", () => {
  assert.equal(plan({ sichtbar: false }).abfragen, false);
  assert.equal(plan({ sichtbar: false }).grund, "unsichtbar");
  assert.equal(plan({ sichtbar: false, neu: true }).abfragen, false, "auch nicht auf Klick: ohne Fenster klickt niemand");
  assert.equal(plan({ sichtbar: false, letzterVersuch: 0 }).abfragen, false, "auch die erste Abfrage wartet");
  assert.equal(plan({}).abfragen, true);
});

test("Takt: 15 Minuten, beim Aktivieren schon ab 5 Minuten, frühere Abfragen nie", () => {
  assert.equal(plan({ letzterVersuch: T0 - 14 * MIN }).abfragen, false);
  assert.equal(plan({ letzterVersuch: T0 - 15 * MIN }).abfragen, true);
  assert.equal(plan({ letzterVersuch: T0 - 14 * MIN }).warteMs, MIN);
  assert.equal(plan({ aktiviert: true, letzterVersuch: T0 - 4 * MIN }).abfragen, false, "Aktivieren: jünger als 5 Minuten bleibt");
  assert.equal(plan({ aktiviert: true, letzterVersuch: T0 - 5 * MIN }).abfragen, true, "Aktivieren: ab 5 Minuten frischt auf");
  assert.equal(plan({ aktiviert: true, letzterVersuch: T0 - 5 * MIN }).grund, "aktiviert");
  assert.equal(plan({ letzterVersuch: 0 }).grund, "erste");
  assert.equal(plan({ laeuft: true }).abfragen, false, "läuft schon");
});

test("Takt: „Auffrischen“ von Hand frühestens 5 Minuten nach der letzten Abfrage", () => {
  assert.equal(plan({ neu: true, letzterVersuch: T0 - 4 * MIN }).abfragen, false);
  assert.equal(plan({ neu: true, letzterVersuch: T0 - 4 * MIN }).warteMs, MIN);
  assert.equal(plan({ neu: true, letzterVersuch: T0 - 5 * MIN }).abfragen, true);
});

test("Takt: Fehlerpause 30 s, 60 s, 2 min … höchstens 15 min; nach 8 Fehlern in Folge pausiert das Automatische, von Hand geht es weiter", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(R.fehlerPause), [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  assert.equal(plan({ fehlerFolge: 1, letzterVersuch: T0 - 29_000 }).abfragen, false);
  assert.equal(plan({ fehlerFolge: 1, letzterVersuch: T0 - 30_000 }).abfragen, true);
  assert.equal(plan({ fehlerFolge: 3, letzterVersuch: T0 - 119_000 }).abfragen, false);
  assert.equal(plan({ fehlerFolge: 7, letzterVersuch: T0 - 15 * MIN }).abfragen, true, "7 Fehler: es geht weiter");
  const pause = plan({ fehlerFolge: 8, letzterVersuch: T0 - 3 * 24 * STD });
  assert.deepEqual([pause.abfragen, pause.grund], [false, "fehler-pause"], "8 Fehler: nie mehr von selbst, auch nicht nach Tagen");
  assert.equal(plan({ fehlerFolge: 8, aktiviert: true, letzterVersuch: T0 - 3 * 24 * STD }).abfragen, false, "auch das Aktivieren nimmt es nicht auf");
  assert.equal(plan({ fehlerFolge: 8, neu: true, letzterVersuch: T0 - 6 * MIN }).abfragen, true, "„Auffrischen“ von Hand probiert es erneut");
  assert.equal(plan({ fehlerFolge: 2, aktiviert: true, letzterVersuch: T0 - 6 * MIN }).abfragen, true, "Aktivieren im Fehlerzustand: die Fehlerpause (60 s) ist um");
  assert.equal(plan({ fehlerFolge: 2, aktiviert: true, letzterVersuch: T0 - 50_000 }).abfragen, false, "Aktivieren umgeht die Fehlerpause nicht");
});

test("Retry-After bindet (auch beim Auffrischen), höchstens 24 Stunden", () => {
  const gesperrt = plan({ retryBis: T0 + 10 * MIN, letzterVersuch: T0 - 60 * MIN });
  assert.deepEqual([gesperrt.abfragen, gesperrt.grund, gesperrt.warteMs], [false, "retry-after", 10 * MIN]);
  assert.equal(plan({ retryBis: T0 + 10 * MIN, neu: true, letzterVersuch: T0 - 60 * MIN }).abfragen, false);
  assert.equal(plan({ retryBis: T0 + 10 * MIN, aktiviert: true, letzterVersuch: T0 - 60 * MIN }).abfragen, false);
  assert.equal(plan({ retryBis: T0 - 1, letzterVersuch: T0 - 60 * MIN }).abfragen, true, "abgelaufen");
  assert.equal(R.leseRetryAfter(30, T0), 30_000);
  assert.equal(R.leseRetryAfter("120", T0), 120_000);
  assert.equal(R.leseRetryAfter("429 Too Many Requests, Retry-After: 90", T0), 90_000);
  assert.equal(R.leseRetryAfter("retry-after=7", T0), 7000);
  assert.equal(R.leseRetryAfter(10 * 86400, T0), 24 * STD, "auf 24 Stunden begrenzt");
  assert.equal(R.leseRetryAfter(`Retry-After: ${new Date(T0 + 5 * MIN).toUTCString()}`, T0), 5 * MIN, "HTTP-Datum");
  assert.equal(R.leseRetryAfter(0, T0), null);
  assert.equal(R.leseRetryAfter(-5, T0), null);
  assert.equal(R.leseRetryAfter("kein Hinweis", T0), null);
  assert.equal(R.leseRetryAfter(undefined, T0), null);
});

test("Studio-Takt: unsichtbar → gar nicht, sichtbar → 60 s, solange Codex noch gefragt wird 3 s", () => {
  assert.equal(R.naechsterTakt({ sichtbar: false }), null);
  assert.equal(R.naechsterTakt({ sichtbar: true }), 60_000);
  assert.equal(R.naechsterTakt({ sichtbar: true, schnell: true }), 3000);
});

// ───────────── Dichte-Leiter ─────────────
test("Dichte: die geräumigste Stufe, die in die verfügbare Breite passt; sonst die engste", () => {
  assert.deepEqual(R.DICHTE, ["voll", "kompakt", "knappstes", "plus-n", "symbol"]);
  const breiten = [520, 360, 150, 90, 26];
  assert.equal(R.waehleDichte(breiten, 600), 0);
  assert.equal(R.waehleDichte(breiten, 520), 0, "genau passend");
  assert.equal(R.waehleDichte(breiten, 519), 0, "1 px Toleranz gegen Rundung");
  assert.equal(R.waehleDichte(breiten, 400), 1);
  assert.equal(R.waehleDichte(breiten, 200), 2);
  assert.equal(R.waehleDichte(breiten, 100), 3);
  assert.equal(R.waehleDichte(breiten, 40), 4);
  assert.equal(R.waehleDichte(breiten, 0), 4, "nichts passt: nur das Symbol");
  assert.equal(R.waehleDichte([undefined, undefined, 150, 90, 26], 400), 2, "ungemessene Stufen werden übersprungen");
  assert.equal(R.waehleDichte([], 400), 4);
});

test("Dichte „+N“: dringende Konten bleiben, sonst das dringendste eines; der Rest wird zur Zahl", () => {
  const k = [{ id: "a", prozent: 10, dringend: false }, { id: "b", prozent: 45, dringend: false }, { id: "c", prozent: 91, dringend: true }, { id: "d", prozent: 85, dringend: true }];
  assert.deepEqual(R.waehleSichtbare(k), { sichtbar: ["c", "d"], mehr: 2 });
  assert.deepEqual(R.waehleSichtbare(k.slice(0, 2)), { sichtbar: ["b"], mehr: 1 });
  assert.deepEqual(R.waehleSichtbare(k.slice(0, 1)), { sichtbar: ["a"], mehr: 0 });
  assert.deepEqual(R.waehleSichtbare([]), { sichtbar: [], mehr: 0 });
  assert.deepEqual(R.waehleSichtbare([{ id: "x", prozent: null, dringend: false }, { id: "y", prozent: 5, dringend: false }]), { sichtbar: ["y"], mehr: 1 });
});

// ───────────── ruhig veraltet ─────────────
test("Ruhig veraltet: grauer Stand ab 10 Minuten; das Warnzeichen NUR bei einem Fehler UND einem Wert älter als 30 Minuten", () => {
  const vor = (min) => new Date(T0 - min * MIN).toISOString();
  assert.equal(R.alterMin(vor(7), T0), 7);
  assert.equal(R.alterMin(null, T0), null);
  assert.equal(R.alterMin("kein Datum", T0), null);
  assert.equal(R.istRuhigAlt({ aktualisiert: vor(9) }, T0), false);
  assert.equal(R.istRuhigAlt({ aktualisiert: vor(10) }, T0), true);
  const fehler = (min) => ({ status: "fehler-mit-wert", aktualisiert: vor(min) });
  assert.equal(R.warnzeichenNoetig(fehler(31), T0), true);
  assert.equal(R.warnzeichenNoetig(fehler(30), T0), false, "genau 30 Minuten: noch ruhig");
  assert.equal(R.warnzeichenNoetig(fehler(5), T0), false, "Fehler, aber der Wert ist frisch");
  assert.equal(R.warnzeichenNoetig({ status: "veraltet", aktualisiert: vor(300) }, T0), false, "alt, aber kein Fehler: kein Zeichen");
  assert.equal(R.warnzeichenNoetig({ status: "ok", aktualisiert: vor(300) }, T0), false);
  assert.equal(R.warnzeichenNoetig({ status: "fehler", fehlerArt: "zeit" }, T0), false, "ohne Wert gibt es nichts, was veraltet wäre");
  assert.equal(R.warnzeichenNoetig(null, T0), false);
});

test("verbraucht/übrig: nur die Anzeige wechselt", () => {
  assert.equal(R.angezeigtProzent(34, "verbraucht"), 34);
  assert.equal(R.angezeigtProzent(34, "uebrig"), 66);
  assert.equal(R.angezeigtProzent(100, "uebrig"), 0);
  assert.equal(R.angezeigtProzent(130, "uebrig"), 0, "begrenzt");
  assert.equal(R.angezeigtProzent(-5, "verbraucht"), 0);
  assert.equal(R.angezeigtProzent(null, "uebrig"), 100);
});

// ───────────── Schwellen 80 / 100 % ─────────────
const konto = (session, weekly = null, id = "k_aaaa0001") => ({ id, programm: "claude", name: "Privat", session, weekly });
const SPAETER = T0 + 3 * STD;

test("Schwellen: 80 % und 100 % je Fenster höchstens einmal; ein zweiter Durchlauf im selben Fenster meldet nichts", () => {
  const ende = T0 + 2 * STD;
  let stand = {};
  let r = R.planeSchwellen(stand, [konto(fen(50, ende))], { jetzt: T0 });
  assert.deepEqual(r.ereignisse, []);
  stand = r.nachher;
  r = R.planeSchwellen(stand, [konto(fen(80, ende))], { jetzt: T0 + MIN });
  assert.deepEqual(r.ereignisse.map((e) => [e.fenster, e.schwelle, e.prozent]), [["session", 80, 80]]);
  stand = r.nachher;
  assert.deepEqual(R.planeSchwellen(stand, [konto(fen(85, ende))], { jetzt: T0 + 2 * MIN }).ereignisse, [], "85 %: 80 ist schon gemeldet");
  assert.deepEqual(R.planeSchwellen(stand, [konto(fen(80, ende + 30_000))], { jetzt: T0 + 2 * MIN }).ereignisse, [], "Rücksetzzeit ±60 s: dasselbe Fenster");
  r = R.planeSchwellen(stand, [konto(fen(100, ende))], { jetzt: T0 + 3 * MIN });
  assert.deepEqual(r.ereignisse.map((e) => e.schwelle), [100]);
  stand = r.nachher;
  assert.deepEqual(R.planeSchwellen(stand, [konto(fen(100, ende))], { jetzt: T0 + 4 * MIN }).ereignisse, [], "100 % nur einmal");
  assert.deepEqual(R.planeSchwellen(stand, [konto(fen(100, ende))], { jetzt: T0 + 5 * MIN }).nachher, stand, "der Stand bleibt gleich");
});

test("Schwellen: ein neues Fenster beginnt von vorn; Sprung über beide Schwellen meldet nur 100 %", () => {
  const ende = T0 + 2 * STD, neuesEnde = ende + 5 * STD;
  let r = R.planeSchwellen({}, [konto(fen(95, ende))], { jetzt: T0 });
  assert.deepEqual(r.ereignisse.map((e) => e.schwelle), [80], "95 % ohne Vorgeschichte: erreicht ist 80, nicht 100");
  let stand = r.nachher;
  r = R.planeSchwellen({}, [konto(fen(100, ende))], { jetzt: T0 });
  assert.deepEqual(r.ereignisse.map((e) => e.schwelle), [100], "nur die höchste");
  assert.deepEqual(r.nachher.k_aaaa0001.session.gemeldet, [80, 100], "80 gilt als mitgemeldet");
  // nach dem Ende des Fensters: neues Fenster, 80 % wieder meldbar
  r = R.planeSchwellen(r.nachher, [konto(fen(82, neuesEnde))], { jetzt: ende + MIN });
  assert.deepEqual(r.ereignisse.map((e) => e.schwelle), [80], "neues Fenster");
  // anderes Fenster (Rücksetzzeit weit weg), obwohl das alte noch lief
  r = R.planeSchwellen(stand, [konto(fen(81, ende + 2 * 3600_000))], { jetzt: T0 + MIN });
  assert.deepEqual(r.ereignisse.map((e) => e.schwelle), [80], "Rücksetzzeit > 60 s anders: neues Fenster");
});

test("Schwellen: Woche und 5 Std getrennt, mehrere Konten getrennt; abgelaufene Werte zählen nicht", () => {
  const ende = T0 + 2 * STD, wende = T0 + 50 * STD;
  const r = R.planeSchwellen({}, [konto(fen(81, ende), fen(90, wende, { windowMinutes: 10080 })), konto(fen(10, ende), null, "k_aaaa0002")], { jetzt: T0 });
  assert.deepEqual(r.ereignisse.map((e) => `${e.konto}:${e.fenster}:${e.schwelle}`), ["k_aaaa0001:session:80", "k_aaaa0001:weekly:80"]);
  assert.deepEqual(R.planeSchwellen({}, [konto(fen(100, T0 - 1))], { jetzt: T0 }).ereignisse, [], "dieses Fenster ist schon vorbei");
  assert.deepEqual(R.planeSchwellen({}, [konto(null, null)], { jetzt: T0 }).ereignisse, []);
});

test("Schwellen: bei ausgeschaltetem Schalter wird nichts gemeldet, aber gemerkt (Einschalten meldet nichts Altes nach)", () => {
  const ende = T0 + 2 * STD;
  const aus = R.planeSchwellen({}, [konto(fen(90, ende))], { jetzt: T0, aktiv: false });
  assert.deepEqual(aus.ereignisse, []);
  const an = R.planeSchwellen(aus.nachher, [konto(fen(92, ende))], { jetzt: T0 + MIN, aktiv: true });
  assert.deepEqual(an.ereignisse, [], "das Fenster war schon über 80 %");
  assert.deepEqual(R.planeSchwellen(an.nachher, [konto(fen(100, ende))], { jetzt: T0 + 2 * MIN }).ereignisse.map((e) => e.schwelle), [100], "100 % kommt noch");
});

test("Schwellen: ohne Rücksetzzeit erkennt ein Absinken unter 80 % das neue Fenster; fehlende Zahlen ändern nichts am Gemerkten", () => {
  let r = R.planeSchwellen({}, [konto(fen(90, null))], { jetzt: T0 });
  assert.equal(r.ereignisse.length, 1);
  assert.deepEqual(R.planeSchwellen(r.nachher, [konto(fen(95, null))], { jetzt: T0 + MIN }).ereignisse, []);
  r = R.planeSchwellen(r.nachher, [konto(fen(5, null))], { jetzt: T0 + 2 * MIN });
  r = R.planeSchwellen(r.nachher, [konto(fen(85, null))], { jetzt: T0 + 3 * MIN });
  assert.equal(r.ereignisse.length, 1, "nach dem Absinken wieder meldbar");
  // ein Konto ohne Zahlen in einem Durchlauf vergisst das laufende Fenster nicht
  const ende = T0 + 2 * STD;
  const a = R.planeSchwellen({}, [konto(fen(90, ende))], { jetzt: T0 });
  const b = R.planeSchwellen(a.nachher, [konto(null, null)], { jetzt: T0 + MIN });
  const c = R.planeSchwellen(b.nachher, [konto(fen(91, ende))], { jetzt: T0 + 2 * MIN });
  assert.deepEqual(c.ereignisse, []);
  assert.ok(SPAETER > T0);
});

// ───────────── Werkstatt: Schwellen als Ereignis, Codex monoton und mit Retry-After ─────────────
function aufbau(opt = {}) {
  const support = tmp("brain-support-"), vault = tmp("brain-vault-");
  const home = tmp("brain-home-");
  const daten = { konten: { k_aaaa0001: { programm: "claude", ordner: join(support, "ki-konten-ordner", "claude-privat"), standard: false, name: "Privat" },
    k_aaaa0003: { programm: "codex", ordner: join(home, ".codex"), standard: true, name: "Codex" } } };
  mkdirSync(daten.konten.k_aaaa0001.ordner, { recursive: true });
  let zeit = Date.now();
  const kt = erzeugeKontingent({ support, konten: { lade: () => daten }, nodePfad: process.execPath, home: () => home, jetzt: () => zeit, codexProgramm: () => "/nicht/da/codex", ...opt });
  return { support, vault, kt, zeit: (ms) => { if (ms !== undefined) zeit = ms; return zeit; } };
}
const schreibeWerte = (a, session, weekly = null) => {
  const ordner = join(a.support, "kontingent");
  mkdirSync(ordner, { recursive: true });
  // Der Claude-Stand zählt nur mit eingetragener Statuszeile: dieser Test prüft die Mitteilung, darum wird der Eintrag der Statuszeile über die Werkstatt-Funktionen umgangen.
  writeFileSync(join(ordner, "k_aaaa0001.json"), JSON.stringify({ v: 1, geschrieben: new Date(a.zeit()).toISOString(), session, weekly }) + "\n");
};

test("Mitteilung: bei 80 % und 100 % je EIN Ereignis im Aktivitätsprotokoll des Vaults, danach nichts mehr im selben Fenster", async () => {
  const a = aufbau();
  // eingetragene Statuszeile vortäuschen: der Stand des Kontos kommt in dieser Prüfung direkt aus liesWerte; darum den echten Weg nehmen
  const settings = join(a.support, "ki-konten-ordner", "claude-privat", "settings.json");
  assert.ok(a.kt.schalteStatuszeile({ konto: "k_aaaa0001", an: true, einwilligung: true }).ok);
  assert.ok(existsSync(settings));
  const ende = a.zeit() + 2 * STD;
  const lies = () => leseEreignisse(a.support, kennungVault(a.vault)).filter((e) => e.art === "kontingent");
  schreibeWerte(a, fen(50, ende), fen(10, a.zeit() + 50 * STD, { windowMinutes: 10080 }));
  a.kt.stand({ vault: a.vault, vaultName: "Test" });
  assert.equal(lies().length, 0);
  schreibeWerte(a, fen(81, ende), fen(10, a.zeit() + 50 * STD, { windowMinutes: 10080 }));
  a.kt.stand({ vault: a.vault, vaultName: "Test" });
  a.kt.stand({ vault: a.vault, vaultName: "Test" });
  let e = lies();
  assert.equal(e.length, 1, "zweimal abgefragt, einmal gemeldet");
  assert.deepEqual([e[0].grund, e[0].konto, e[0].programm, e[0].wer, e[0].vaultName], ["5h-80", "k_aaaa0001", "claude", "Claude Code · Privat", "Test"]);
  assert.equal(e[0].text, "hat 80 % des 5-Stunden-Kontingents verbraucht.");
  schreibeWerte(a, fen(100, ende), fen(10, a.zeit() + 50 * STD, { windowMinutes: 10080 }));
  a.kt.stand({ vault: a.vault });
  a.kt.stand({ vault: a.vault });
  e = lies();
  assert.deepEqual(e.map((x) => x.grund), ["5h-80", "5h-100"]);
  assert.equal(e[1].text, "hat das 5-Stunden-Kontingent aufgebraucht.");
  // ein neuer Kortex-Start (neue Instanz) kennt den Stand aus der Datei: keine Wiederholung
  const b = erzeugeKontingent({ support: a.support, konten: { lade: () => ({ konten: { k_aaaa0001: { programm: "claude", ordner: join(a.support, "ki-konten-ordner", "claude-privat"), standard: false, name: "Privat" } } }) }, nodePfad: process.execPath, jetzt: () => a.zeit() });
  b.stand({ vault: a.vault });
  assert.equal(lies().length, 2);
  // ohne offenen Vault: keine Mitteilung
  const ohne = tmp("brain-vault-ohne-");
  a.kt.stand({});
  assert.equal(leseEreignisse(a.support, kennungVault(ohne)).length, 0);
});

test("Mitteilung: die Wache prüft die lokalen Claude-Werte selbst (ohne stand() des Studios), meldet einmal je Schwelle und lässt den Stand von Codex unberührt", () => {
  const offen = {};
  const a = aufbau({ vaultFuer: () => offen.vault });
  offen.vault = { wurzel: a.vault, name: "Wache" };
  assert.ok(a.kt.schalteStatuszeile({ konto: "k_aaaa0001", an: true, einwilligung: true }).ok);
  const lies = () => leseEreignisse(a.support, kennungVault(a.vault)).filter((e) => e.art === "kontingent");
  const datei = join(a.support, "kontingent", "mitteilungen.json");
  mkdirSync(join(a.support, "kontingent"), { recursive: true });
  writeFileSync(datei, JSON.stringify({ v: 1, konten: { k_aaaa0003: { session: { resetsAt: a.zeit() + 3 * STD, gemeldet: [80] } } } }) + "\n");
  const ende = a.zeit() + 2 * STD;
  schreibeWerte(a, fen(50, ende));
  a.kt.pruefeClaudeSchwellen();
  assert.equal(lies().length, 0);
  schreibeWerte(a, fen(85, ende));
  a.kt.pruefeClaudeSchwellen(); a.kt.pruefeClaudeSchwellen();
  assert.deepEqual(lies().map((e) => [e.grund, e.vaultName]), [["5h-80", "Wache"]], "ohne stand(): gemeldet, nur einmal");
  assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")).konten.k_aaaa0003.session.gemeldet, [80], "der gemerkte Stand von Codex bleibt");
  // ohne offenen Vault: nichts
  const b = aufbau({ vaultFuer: () => null });
  b.kt.schalteStatuszeile({ konto: "k_aaaa0001", an: true, einwilligung: true });
  schreibeWerte(b, fen(95, b.zeit() + 2 * STD));
  b.kt.pruefeClaudeSchwellen();
  assert.equal(existsSync(join(b.support, "kontingent", "mitteilungen.json")), false);
});

test("Schwellen: fehlt die Rücksetzzeit, gilt das zuletzt bekannte Fenster (80 % wird nicht erneut gemeldet); ein neues Fenster erkennt das Absinken", () => {
  const ende = T0 + 2 * STD;
  const r = R.planeSchwellen({}, [konto(fen(85, ende))], { jetzt: T0 });
  assert.equal(r.ereignisse.length, 1);
  const ohne = R.planeSchwellen(r.nachher, [konto(fen(86, null))], { jetzt: T0 + MIN });
  assert.deepEqual(ohne.ereignisse, [], "dasselbe Fenster, nur ohne Zeitangabe");
  assert.equal(ohne.nachher.k_aaaa0001.session.resetsAt, ende, "die bekannte Rücksetzzeit bleibt");
  const wieder = R.planeSchwellen(ohne.nachher, [konto(fen(10, null))], { jetzt: T0 + 2 * MIN });
  assert.equal(R.planeSchwellen(wieder.nachher, [konto(fen(90, null))], { jetzt: T0 + 3 * MIN }).ereignisse.length, 1, "nach dem Absinken ein neues Fenster");
});

test("Mitteilung: ausgeschalteter Schalter (mitteilungenKontingent) schreibt kein Ereignis", async () => {
  const a = aufbau();
  writeFileSync(join(a.support, "einstellungen.json"), JSON.stringify({ mitteilungenKontingent: false }) + "\n");
  assert.ok(a.kt.schalteStatuszeile({ konto: "k_aaaa0001", an: true, einwilligung: true }).ok);
  schreibeWerte(a, fen(95, a.zeit() + 2 * STD));
  a.kt.stand({ vault: a.vault });
  assert.equal(leseEreignisse(a.support, kennungVault(a.vault)).filter((e) => e.art === "kontingent").length, 0);
});

const codexLauf = (antworten) => { let i = 0; const aufrufe = []; const f = async (o) => { aufrufe.push(o); return antworten[Math.min(i++, antworten.length - 1)]; }; f.aufrufe = aufrufe; return f; };
const cx = (p, ende, extra = {}) => ({ ok: true, session: { usedPercent: p, windowMinutes: 300, resetsAt: ende }, weekly: null, ...extra });
const codexStand = (a) => a.kt.stand({ vault: a.vault }).konten.find((k) => k.id === "k_aaaa0003");

test("Codex: niedrigerer Wert im selben Fenster wird verworfen (monotone Regel), ein neues Fenster gilt", async () => {
  const lauf = codexLauf([cx(40, Date.now() + 2 * STD), cx(25, Date.now() + 2 * STD + 20_000), cx(30, Date.now() + 8 * STD)]);
  const a = aufbau({ codexLauf: lauf, codexProgramm: () => "/x/codex" });
  const t = a.zeit();
  codexStand(a); await a.kt.warteAufAbfragen();
  assert.equal(codexStand(a).session.usedPercent, 40);
  a.zeit(t + 16 * MIN);
  codexStand(a); await a.kt.warteAufAbfragen();
  assert.equal(codexStand(a).session.usedPercent, 40, "25 im selben Fenster: verworfen");
  a.zeit(t + 32 * MIN);
  codexStand(a); await a.kt.warteAufAbfragen();
  assert.equal(codexStand(a).session.usedPercent, 30, "Fenster Stunden später: der kleinere Wert gilt");
  assert.equal(lauf.aufrufe.length, 3);
});

test("Codex: Retry-After des Programms bindet bis zum Ablauf, auch bei „Auffrischen“; nach 8 Fehlern fragt nur noch ein Klick", async () => {
  const lauf = codexLauf([{ ok: false, art: "rpc", retryNachMs: 30 * MIN }, cx(10, Date.now() + 2 * STD)]);
  const a = aufbau({ codexLauf: lauf, codexProgramm: () => "/x/codex" });
  const t = a.zeit();
  codexStand(a); await a.kt.warteAufAbfragen();
  const fehler = codexStand(a);
  assert.equal(fehler.status, "fehler");
  assert.ok(fehler.wartetBis, "wartet bis …");
  a.zeit(t + 10 * MIN);
  a.kt.stand({ neu: true, vault: a.vault }); await a.kt.warteAufAbfragen();
  assert.equal(lauf.aufrufe.length, 1, "Auffrischen bricht Retry-After nicht");
  a.zeit(t + 31 * MIN);
  a.kt.stand({ neu: true, vault: a.vault }); await a.kt.warteAufAbfragen();
  assert.equal(lauf.aufrufe.length, 2, "nach Retry-After geht es wieder");
  assert.equal(codexStand(a).status, "ok");
  // 8 Fehler in Folge
  const lauf2 = codexLauf([{ ok: false, art: "zeit" }]);
  const b = aufbau({ codexLauf: lauf2, codexProgramm: () => "/x/codex" });
  let z = b.zeit();
  for (let i = 0; i < 12; i++) { codexStand(b); await b.kt.warteAufAbfragen(); z += 16 * MIN; b.zeit(z); }
  assert.equal(lauf2.aufrufe.length, 8, "nach 8 Fehlern in Folge ruht das automatische Abfragen");
  assert.equal(codexStand(b).pausiert, true);
  b.zeit(z + 5 * MIN);
  b.kt.stand({ neu: true, vault: b.vault }); await b.kt.warteAufAbfragen();
  assert.equal(lauf2.aufrufe.length, 9, "Auffrischen von Hand probiert es wieder");
});

test("Codex: Aktivieren des Fensters frischt auf, wenn der Stand älter als 5 Minuten ist (sonst erst nach 15)", async () => {
  const lauf = codexLauf([cx(10, Date.now() + 2 * STD)]);
  const a = aufbau({ codexLauf: lauf, codexProgramm: () => "/x/codex" });
  const t = a.zeit();
  codexStand(a); await a.kt.warteAufAbfragen();
  a.zeit(t + 4 * MIN);
  a.kt.stand({ aktiviert: true, vault: a.vault }); await a.kt.warteAufAbfragen();
  assert.equal(lauf.aufrufe.length, 1);
  a.zeit(t + 6 * MIN);
  a.kt.stand({ vault: a.vault }); await a.kt.warteAufAbfragen();
  assert.equal(lauf.aufrufe.length, 1, "ohne Aktivieren erst nach 15 Minuten");
  a.kt.stand({ aktiviert: true, vault: a.vault }); await a.kt.warteAufAbfragen();
  assert.equal(lauf.aufrufe.length, 2, "Aktivieren nach 6 Minuten");
});
