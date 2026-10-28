// .tools/tests/test-tageslauf-lernmodus.mjs — Lernmodus (B2.2): der Tageslauf schreibt anfangs NICHTS selbst. Die Autostufe beginnt bei „aus“ (Einstellung
// autostufeStart, Standard aus); jeder 🟢-Kandidat geht ZUERST durch den Richter, nur dessen „übernehmen“ wird eine MARKIERTE Autostufe-Rückfrage (Antwort zählt
// als Prüfung); nach 20 bestätigten Urteilen in Folge eine Stufe hoch (eng), dann greift das Einschwing-Tor. R5 „Altbestand“: ein Zitat, das mehr als 7 Tage
// vor dem Lauf liegt (oder keinen gültigen Zeitpunkt hat), wird nie automatisch übernommen. fake-claude, Temp-Vaults, nie echtes claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, committeAm, FAKE_BEFEHL, JETZT, RICHTER_KENNUNG } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const T = await import("../tageslauf.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
const AS = await import("../tageslauf/autostufe.mjs");
const E = await import("../tageslauf/einschwingen.mjs");
const M = await import("../tageslauf/morgen.mjs");
const RG = await import("../tageslauf/regeln.mjs");
isoliere();

const ORION = "09_wiki/projekte/entitaet_orion.md";
const ZITAT_ZEIT = "2026-10-20T10:00:00Z";
const STUNDE = 3600e3, TAG = 86400e3;
const fund = (id, zeit = ZITAT_ZEIT) => `s1#u-${id} ${zeit}`;
const fakt = (v, id, titel, text, zitat, extra = {}) => legeVorschlagAn(v, { id, titel, text, zitat, herkunft: "du", fundstelle: fund(id), ...extra });
const orionSeite = (zeilen = []) => seitenText({ fm: { name: "orion", description: "Orion Testsystem" },
  rumpf: `# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]\n${zeilen.map((z) => `${z}\n`).join("")}` });
// autostufeStart: undefined = der Standard der Einstellung (aus) — die Testhilfe setzt sonst „normal“ (wie vor dem Lernmodus).
const LERN = { tageslauf: "an", einschwingen: 0, autostufeStart: undefined };
function bau({ automatik = LERN, orion = orionSeite() } = {}) {
  const v = neuerTestVault({ automatik, seiten: { [ORION]: orion } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: ORION }));
  return v;
}
const NEU = (o = {}) => JSON.stringify({ urteil: "neu", zitatStuetzt: true, passtZurSeite: true, dauerhaft: true, ...o });
const abgl = (titel, antwort = NEU()) => ({ wenn: ["Du vergleichst", `FAKT: ${titel}.`], antwort });
const OK = { gedeckt: true, dauerhaft: true, seitePasst: true, schonDrin: false, widerspricht: false, ueberholt: false, begruendung: "Alles stimmt." };
const richter = (marker, o = {}) => ({ wenn: [RICHTER_KENNUNG, marker], antwort: typeof o === "string" ? o : JSON.stringify({ ...OK, ...o }) });
const lauf = (v, opt = {}) => T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const sonnet = (ki) => ki.aufrufe().filter((a) => a.modell === "sonnet");
const aktion = (v, id) => P.leseAktionen(v).find((a) => a.id === id);
const lies = (v, rel) => readFileSync(join(v, rel), "utf8");
const bericht = (v, r) => readFileSync(join(v, r.bericht), "utf8");
const zustandsDatei = (v) => join(P.TL_DIR(v), "autostufe.json");
const zustand = (v) => JSON.parse(readFileSync(zustandsDatei(v), "utf8"));
const rueckfragen = (v) => R.listeRueckfragen(v).filter((x) => x.typ !== "stichprobe");
const markierte = (v) => R.listeRueckfragen(v).filter((x) => R.istAutostufeRueckfrage(x) && !x.antwort);
const warteGrund = (v, id) => B.ladeVorschlag(v, "_warten", id)?.wartenGrund;
const archiv = (v, grund, id) => join(v, "90_archiv", "vorschlaege-aussortiert", grund, `${id}.md`);
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const ISO = (ms) => new Date(ms).toISOString();

// ------------------------------------------------------------------------------------------ 1 Einstellung und Startzustand

test("Einstellung autostufeStart: aus | eng | normal, Standard aus; ungültig → Standard", async () => {
  const { SCHEMA, STANDARD, leseAutomatik, schreibeAutomatik } = await import("../einstellungen.mjs");
  assert.deepEqual(SCHEMA.autostufeStart.werte, ["aus", "eng", "normal"]);
  assert.equal(STANDARD.autostufeStart, "aus");
  const v = bau({ automatik: { tageslauf: "an", autostufeStart: "turbo" } });
  assert.equal(leseAutomatik(v).werte.autostufeStart, "aus", "ungültiger Wert in der Config → Standard");
  const { stand } = leseAutomatik(v);
  assert.throws(() => schreibeAutomatik(v, { autostufeStart: "turbo" }, stand), (e) => e.code === 400 && /autostufeStart/.test(e.message));
  schreibeAutomatik(v, { autostufeStart: "eng" }, stand);
  assert.equal(leseAutomatik(v).werte.autostufeStart, "eng");
});

test("aktualisiereAutostufe: echter Lauf ohne Zustand beginnt mit dem Startwert (Standard aus): Zustand angelegt, Grund start, Aktion im Protokoll, ctx.lernmodus", () => {
  const v = bau();
  assert.equal(existsSync(zustandsDatei(v)), false);
  const ctx = ctxFuer(v);
  AS.aktualisiereAutostufe(ctx);
  assert.deepEqual([ctx.autostufe, ctx.lernmodus], ["aus", true]);
  const z = zustand(v);
  assert.deepEqual([z.stufe, z.grund], ["aus", "start"]);
  assert.equal(z.seit, ISO(JETZT));
  assert.deepEqual(z.quote, { fehler: 0, geprueft: 0 });
  assert.equal(ctx.aktionen.at(-1).stufe, "autostufe");
  assert.match(ctx.aktionen.at(-1).grund, /start/i);
});

test("aktualisiereAutostufe: ohne Zustand zählen ältere Prüfungen nicht — 25 alte fehlerfreie Prüfungen überspringen den Lernmodus nicht", () => {
  const v = bau();
  mkdirSync(P.TL_DIR(v), { recursive: true });
  const alt = Array.from({ length: 25 }, (_, i) => JSON.stringify({ zeit: ISO(JETZT - 30 * TAG + i * STUNDE), art: "stichprobe", ref: `alt-${i}`, fehler: false }));
  writeFileSync(join(P.TL_DIR(v), "pruefungen.jsonl"), alt.join("\n") + "\n");
  const ctx = ctxFuer(v);
  AS.aktualisiereAutostufe(ctx);
  assert.deepEqual([ctx.autostufe, ctx.lernmodus], ["aus", true]);
  assert.deepEqual([zustand(v).stufe, zustand(v).grund, zustand(v).seit], ["aus", "start", ISO(JETZT)]);
  // auch mit Startwert eng: kein Sprung auf normal durch alte Prüfungen
  const e = bau({ automatik: { tageslauf: "an", autostufeStart: "eng" } });
  mkdirSync(P.TL_DIR(e), { recursive: true });
  writeFileSync(join(P.TL_DIR(e), "pruefungen.jsonl"), alt.join("\n") + "\n");
  const c = ctxFuer(e);
  AS.aktualisiereAutostufe(c);
  assert.equal(c.autostufe, "eng");
});

test("aktualisiereAutostufe: Startwert eng oder normal wird übernommen (normal ist kein Lernmodus und macht keine Aktion); ungültiger Startwert in ctx → aus", () => {
  for (const [start, lern] of [["eng", false], ["normal", false]]) {
    const v = bau({ automatik: { tageslauf: "an", autostufeStart: start } });
    const ctx = ctxFuer(v);
    AS.aktualisiereAutostufe(ctx);
    assert.deepEqual([ctx.autostufe, ctx.lernmodus, zustand(v).stufe, zustand(v).grund], [start, lern, start, "start"], start);
  }
  const normal = bau({ automatik: { tageslauf: "an", autostufeStart: "normal" } });
  const c = ctxFuer(normal);
  AS.aktualisiereAutostufe(c);
  assert.deepEqual(c.aktionen, [], "bei normal gibt es nichts zu berichten");
  const v = bau();
  const ctx = ctxFuer(v);
  ctx.werte = { ...ctx.werte, autostufeStart: "turbo" };
  AS.aktualisiereAutostufe(ctx);
  assert.equal(ctx.autostufe, "aus", "fail-safe: unbekannter Startwert = aus");
});

test("ein vorhandener Autostufen-Zustand bleibt unangetastet — der Startwert gilt nur, wenn es keinen gibt", () => {
  const v = bau();                                              // Standard: Start aus
  mkdirSync(P.TL_DIR(v), { recursive: true });
  const seit = ISO(JETZT - 3 * TAG);
  writeFileSync(zustandsDatei(v), JSON.stringify({ stufe: "normal", seit }));
  const ctx = ctxFuer(v);
  AS.aktualisiereAutostufe(ctx);
  assert.equal(ctx.autostufe, "normal");
  assert.equal(ctx.lernmodus, false);
  const z = zustand(v);
  assert.deepEqual([z.stufe, z.seit, z.grund], ["normal", seit, undefined]);
  assert.deepEqual(ctx.aktionen, []);
});

test("Probe legt nie einen Zustand an, rechnet aber mit dem Startwert", () => {
  const v = bau();
  const ctx = ctxFuer(v, { probe: true });
  AS.aktualisiereAutostufe(ctx);
  assert.deepEqual([ctx.autostufe, ctx.lernmodus], ["aus", true]);
  assert.equal(existsSync(zustandsDatei(v)), false, "keine Datei");
});

test("der Start-Grund bleibt über die Läufe erhalten (solange die Stufe nicht wechselt) und fällt beim Wechsel weg; ladeAutostufe ohne Datei bleibt normal", () => {
  const v = bau();
  assert.equal(AS.ladeAutostufe(v).stufe, "normal", "Leser ohne Zustand: unverändert normal");
  AS.aktualisiereAutostufe(ctxFuer(v));
  const seit = zustand(v).seit;
  const c2 = ctxFuer(v, { jetzt: JETZT + TAG });
  AS.aktualisiereAutostufe(c2);
  assert.deepEqual([zustand(v).stufe, zustand(v).grund, zustand(v).seit], ["aus", "start", seit]);
  assert.deepEqual(c2.aktionen, []);
  // 20 bestätigte Urteile in Folge → eng; kein Lernmodus mehr.
  const c3 = ctxFuer(v, { jetzt: JETZT + 2 * TAG });
  for (let i = 0; i < 20; i++) P.merkePruefung(ctxFuer(v, { jetzt: JETZT + TAG + i * 1000 }), { art: "rueckweg", quelle: R.AUTOSTUFE_QUELLE, fehler: false, ref: `rf-${i}` });
  AS.aktualisiereAutostufe(c3);
  assert.deepEqual([c3.autostufe, c3.lernmodus, zustand(v).stufe, zustand(v).grund], ["eng", false, "eng", undefined]);
  assert.match(c3.aktionen.at(-1).grund, /aus → eng/);
});

test("erzwingeAutostufe ohne Zustand rechnet mit dem Startwert: Start aus bleibt aus (nie lockern)", () => {
  const v = bau();
  const ctx = ctxFuer(v);
  assert.equal(AS.erzwingeAutostufe(ctx, "eng", "Test"), false);
  assert.equal(ctx.autostufe, "aus");
});

// ------------------------------------------------------------------------------------------ 3 R5 Altbestand (reine Funktion)

test("R5: ALTBESTAND_TAGE ist 7; älter als 7 Tage → alt, genau 7 Tage und jünger → frisch; kein/ungültiger Zeitpunkt → alt (fail-safe)", () => {
  assert.equal(RG.ALTBESTAND_TAGE, 7);
  assert.equal(RG.ALTBESTAND_GRUND, "altbestand");
  const jetzt = Date.parse("2026-10-22T03:00:00Z");
  assert.equal(RG.istAltbestand(jetzt - 7 * TAG, jetzt), false, "genau 7 Tage: noch frisch");
  assert.equal(RG.istAltbestand(jetzt - 7 * TAG - 1000, jetzt), true, "eine Sekunde mehr: alt");
  assert.equal(RG.istAltbestand(jetzt - 6 * TAG, jetzt), false);
  assert.equal(RG.istAltbestand(jetzt, jetzt), false);
  assert.equal(RG.istAltbestand(jetzt + TAG, jetzt), false, "Zitat in der Zukunft (Uhrenabweichung) ist nicht alt");
  for (const schlecht of [null, undefined, NaN, "", "kaputt", "?", {}, [], Infinity]) assert.equal(RG.istAltbestand(schlecht, jetzt), true, `Zeitpunkt ${String(schlecht)}`);
  for (const schlecht of [null, undefined, NaN, "kaputt"]) assert.equal(RG.istAltbestand(jetzt - TAG, schlecht), true, `ungültiges Lauf-Datum ${String(schlecht)}`);
  assert.equal(RG.istAltbestand("2026-10-10T10:00:00Z", jetzt), true, "auch als ISO-Text");
  assert.equal(RG.istAltbestand(new Date(jetzt - TAG), jetzt), false, "auch als Date");
  assert.equal(RG.istAltbestand(RG.zitatZeitAusFundstelle("s1#u-x 2026-10-10T10:00:00Z"), jetzt), true, "Zeit aus der Fundstelle");
  assert.equal(RG.istAltbestand(RG.zitatZeitAusFundstelle("s1#u-x ?"), jetzt), true, "Fundstelle ohne Zeit");
  assert.equal(RG.istAltbestand(RG.zitatZeitAusFundstelle("kein Format"), jetzt), true);
});

// ------------------------------------------------------------------------------------------ 2 Reihenfolge: erst der Richter, dann die markierte Rückfrage

test("erster scharfer Lauf ohne Zustand: aus (Lernmodus) — der 🟢-Kandidat geht zuerst durch den Richter, nur dessen „übernehmen“ wird eine MARKIERTE Rückfrage mit Zitat, Zielseite und Begründung; nichts wird geschrieben", async () => {
  const v = bau();
  fakt(v, "g1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { herkunft: "tool" });
  const ki = fakeKi([abgl("Orion Backups"), richter("Orion Backups", { begruendung: "Zitat und Seite passen zusammen." })]);
  const vorher = lies(v, ORION);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual([zustand(v).stufe, zustand(v).grund], ["aus", "start"]);
  assert.deepEqual([P.leseLetzter(v).autostufe, P.leseLetzter(v).lernmodus], ["aus", true]);
  assert.equal(r.zahlen.uebernommen, 0);
  assert.equal(lies(v, ORION), vorher, "nichts auf der Seite");
  assert.equal(sonnet(ki).length, 1, "der Richter hat zuerst geurteilt");
  const rf = rueckfragen(v);
  assert.equal(rf.length, 1);
  assert.deepEqual([rf[0].typ, rf[0].seite, rf[0].grund, rf[0].quelle], ["heikel", ORION, "autostufe-aus", R.AUTOSTUFE_QUELLE]);
  assert.equal(R.istAutostufeRueckfrage(rf[0]), true);
  const t = rf[0].beschreibung;
  assert.match(t, /Fakt: Orion sichert die Daten über den Dienst Alpha\./);
  assert.match(t, /Zitat: „Orion sichert jetzt über den Dienst Alpha“ \(tool, s1#u-g1 2026-10-20T10:00:00Z\)/, "Zitat samt Herkunft und Fundstelle");
  assert.ok(t.includes(`Zielseite: ${ORION}`), "Zielseite mit Pfad");
  assert.match(t, /Einschätzung der Prüfung: Zitat und Seite passen zusammen\./, "Begründung des Richters");
  assert.match(t, /Warum ich frage: Lernmodus/, "sagt, dass es der Lernmodus ist");
  assert.doesNotMatch(t, /Fehlerquote/, "keine Fehler-Formulierung");
  assert.doesNotMatch(t, /älter als 7 Tage|nach dem Zitat geändert/, "frisch und unverändert: kein Hinweis");
  const a = aktion(v, "g1");
  assert.deepEqual([a.stufe, a.grund], ["rueckfrage", "autostufe-aus"]);
  assert.equal(a.richter.urteil, "uebernehmen");
  assert.equal(B.ladeVorschlag(v, B.UNTERORDNER.rueckfrage, "g1")?.id, "g1", "der Vorschlag liegt bei der Rückfrage");
});

test("aus: Richter lehnt ab → wie Richter (aussortieren / Konflikt-Rückfrage / warten), KEINE markierte Rückfrage; was schon der Abgleich verwirft, kostet keinen Richter-Aufruf", async () => {
  const v = bau({ orion: orionSeite(["- Orion zeigt den Lagebericht in den Meldungen (erledigt) · Stand 01.10.2026 · [[x]]"]) });
  fakt(v, "a1", "Orion Sicherung", "Die Sicherung von Orion läuft über den alten Dienst.", "Orion sichert noch über den alten Dienst");
  fakt(v, "a2", "Orion Konfliktfall", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakt(v, "a3", "Orion Kaputtfall", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  fakt(v, "a4", "Orion Lagebericht", "Der Lagebericht von Orion erscheint in den Meldungen.", "Orion zeigt den Lagebericht in den Meldungen");
  fakt(v, "a5", "Orion Gut", "Die Warteschlange von Orion liegt im Dienst Zeta.", "Die Warteschlange von Orion liegt im Dienst Zeta");
  const ki = fakeKi([abgl("Orion Sicherung"), abgl("Orion Konfliktfall"), abgl("Orion Kaputtfall"), abgl("Orion Gut"),
    abgl("Orion Lagebericht", NEU({ urteil: "schon_drin" })),
    richter("Orion Sicherung", { ueberholt: true, begruendung: "Später umgestellt." }),
    richter("Orion Konfliktfall", { widerspricht: true, begruendung: "KONFLIKT-BEGRUENDUNG" }),
    richter("Orion Kaputtfall", "kein JSON"),
    richter("Orion Gut", { begruendung: "Passt." })]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(sonnet(ki).length, 4, "Richter für a1, a2, a3, a5 — nicht für a4 (schon drin, schon der Abgleich verwirft)");
  assert.ok(existsSync(archiv(v, "ueberholt", "a1")));
  assert.ok(existsSync(archiv(v, "schon-drin", "a4")));
  assert.equal(warteGrund(v, "a3"), "richter-unklar");
  const rf = rueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.typ, x.grund, x.quelle, R.istAutostufeRueckfrage(x)]).sort(), [
    ["heikel", "autostufe-aus", R.AUTOSTUFE_QUELLE, true],
    ["widerspruch", "konflikt", "", false]], "nur das Richter-„übernehmen“ ist markiert; der Konflikt ist eine gewöhnliche Rückfrage");
  assert.deepEqual(markierte(v).map((x) => x.vorschlaege[0]), ["a5"]);
  assert.match(rf.find((x) => x.typ === "widerspruch").beschreibung, /KONFLIKT-BEGRUENDUNG/);
});

test("aus: R3 (Seite seit dem Zitat geändert) und R5 (Zitat älter als 7 Tage) bleiben markierte Rückfragen und tragen den Hinweis; ohne Zeitpunkt gilt beides", async () => {
  const v = bau();
  fakt(v, "r3", "Orion Seitenfall", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { fundstelle: fund("r3", "2026-10-20T10:00:00Z") });
  fakt(v, "r5", "Orion Altfall", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta", { fundstelle: fund("r5", "2026-10-10T10:00:00Z") });
  fakt(v, "r0", "Orion Zeitlosfall", "Orion nutzt für Anmeldungen den Dienst Gamma.", "Orion nutzt für Anmeldungen den Dienst Gamma", { fundstelle: "s1#u-r0 ?" });
  // Die Handänderung (21.10.) liegt nach allen drei Zitaten — und ohne Zeitpunkt gilt die Seite im Zweifel als geändert.
  committeAm(v, ORION, orionSeite(["- von Hand · Stand 01.10.2026 · [[x]]"]), "2026-10-21T08:00:00Z", "Handänderung nach den Zitaten");
  fakeKi([abgl("Orion Seitenfall"), abgl("Orion Altfall"), abgl("Orion Zeitlosfall")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const ms = markierte(v);
  assert.equal(ms.length, 3, "alle drei sind markierte Rückfragen (Lernmodus)");
  const von = (id) => ms.find((x) => x.vorschlaege[0] === id).beschreibung;
  assert.match(von("r3"), /\nHinweis: Seite seither geändert.*\nWarum ich frage: Lernmodus/s, "der Hinweis steht als eigene Zeile vor der Erklärung");
  assert.doesNotMatch(von("r3"), /älter als 7 Tage/, "r3 ist frisch (2 Tage)");
  assert.match(von("r5"), /\nHinweis: .*Zitat älter als 7 Tage — später evtl\. überholt/s);
  assert.match(von("r5"), /\nHinweis: .*Seite seither geändert/s, "die Seite wurde auch nach diesem Zitat geändert");
  assert.match(von("r0"), /\nHinweis: .*Zitat älter als 7 Tage — später evtl\. überholt/s, "kein Zeitpunkt = alt");
  assert.match(von("r0"), /Seite seither geändert/, "kein Zeitpunkt = Seite gilt als geändert");
  for (const x of ms) assert.deepEqual([x.grund, x.quelle], ["autostufe-aus", R.AUTOSTUFE_QUELLE]);
  for (const x of ms) assert.ok(R.fuerSkill(x).beschreibung.includes("Warum ich frage: Lernmodus"), "auch in der gekürzten Anzeige für den Skill steht alles bis zum Ende");
  assert.match(bericht(v, r), /- R3\/R4 → Rückfrage: 3 \(seite-seither-geaendert 3 · seitenwahl 0\)/, "der Bericht zählt auch die markierten Rückfragen mit Hinweis");
  assert.match(bericht(v, r), /- R5 Altbestand → Rückfrage: 2 \(Zitat älter als 7 Tage oder ohne Zeitpunkt\)/);
});

test("Probe ohne Zustand: legt nichts an (weder Zustand noch Rückfragen), rechnet mit dem Startwert, der Bericht zeigt den Lernmodus, die Probe-Aktionen zeigen, was live passiert", async () => {
  const v = bau({ automatik: { ...LERN, tageslauf: "probe" } });
  fakt(v, "g1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { herkunft: "tool" });
  fakeKi([abgl("Orion Backups")]);
  const r = await lauf(v);
  assert.equal(r.modus, "probe");
  assert.equal(existsSync(zustandsDatei(v)), false, "kein Zustand");
  assert.deepEqual(R.listeRueckfragen(v), []);
  assert.equal(r.zahlen.uebernommen, 0, "würde nichts übernehmen");
  assert.equal(r.zahlen.rueckfragenNeu, 1, "würde eine (markierte) Rückfrage stellen");
  const b = bericht(v, r);
  assert.match(b, /- Lernmodus: /);
  assert.match(b, /Autostufe aus/);
  const a = readFileSync(join(P.TL_DIR(v), "probe-aktionen.jsonl"), "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
  assert.deepEqual(a.filter((x) => x.id === "g1").map((x) => [x.stufe, x.grund]), [["rueckfrage", "autostufe-aus"]]);
});

test("vorhandener Zustand normal (Standard-Start aus): der Kandidat wird wie bisher automatisch übernommen — der Lernmodus berührt ihn nicht", async () => {
  const v = bau();
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(zustandsDatei(v), JSON.stringify({ stufe: "normal", seit: ISO(JETZT - TAG) }));
  fakt(v, "g1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { herkunft: "tool" });
  fakeKi([abgl("Orion Backups")]);
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 1, JSON.stringify(r.zahlen));
  assert.match(lies(v, ORION), /Dienst Alpha/);
  assert.deepEqual(rueckfragen(v), []);
  assert.equal(zustand(v).stufe, "normal");
  assert.equal(P.leseLetzter(v).lernmodus, undefined);
});

// ------------------------------------------------------------------------------------------ 3 R5 im Lauf (normal): Rückfrage statt Automatik

test("R5 im Lauf: Zitat 8 Tage alt → 🟡 Rückfrage altbestand (kein Tor-Platz, keine Übernahme); 6 Tage alt → Übernahme; ohne Zeitpunkt → nie automatisch", async () => {
  const v = bau({ automatik: { tageslauf: "an", einschwingen: 5, autostufeStart: "normal" } });
  fakt(v, "alt", "Orion Altfall", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { fundstelle: fund("alt", "2026-10-14T03:00:00Z") });
  fakt(v, "neu", "Orion Neufall", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta", { fundstelle: fund("neu", "2026-10-16T03:00:00Z") });
  fakt(v, "ohne", "Orion Zeitlosfall", "Orion nutzt für Anmeldungen den Dienst Gamma.", "Orion nutzt für Anmeldungen den Dienst Gamma", { fundstelle: "s1#u-ohne ?" });
  fakeKi([abgl("Orion Altfall"), abgl("Orion Neufall"), abgl("Orion Zeitlosfall")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 1, JSON.stringify(r.zahlen));
  assert.match(lies(v, ORION), /Team Beta/);
  assert.doesNotMatch(lies(v, ORION), /Dienst Alpha|Dienst Gamma/);
  const rf = rueckfragen(v);
  const alt = rf.find((x) => x.vorschlaege[0] === "alt");
  assert.deepEqual([alt.typ, alt.seite, alt.grund, R.istAutostufeRueckfrage(alt)], ["heikel", ORION, "altbestand", false], "gewöhnliche Rückfrage mit eigenem Grund");
  assert.match(alt.beschreibung, /Warum ich frage: Zitat älter als 7 Tage — später evtl\. überholt/);
  assert.ok(alt.beschreibung.includes("Zielseite: " + ORION));
  assert.match(alt.beschreibung, /Einschätzung der Prüfung: Standard der Testhilfe\./, "die Begründung des Richters steht dabei");
  const ohne = rf.find((x) => x.vorschlaege[0] === "ohne");
  assert.ok(ohne, "ohne Zeitpunkt: Rückfrage");
  assert.match(ohne.beschreibung, /Zitat älter als 7 Tage/);
  assert.equal(aktion(v, "alt").grund, "altbestand");
  assert.equal(E.einschwingStand(v, { einschwingen: 5 }).A, 1, "nur die frische Übernahme war ein Tor-Platz");
  assert.match(bericht(v, r), /- R5 Altbestand → Rückfrage: 2 \(/);
  // Die Antwort des Menschen schreibt (ohne weiteren Richter).
  R.beantworte(v, alt.id, "uebernehmen", "");
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r2.zahlen.uebernommen, 1);
  assert.match(lies(v, ORION), /Dienst Alpha/);
});

test("R5 und R3 zugleich (kein Lernmodus): Grund seite-seither-geaendert, die Frage nennt auch den Altbestand", async () => {
  const v = bau({ automatik: { tageslauf: "an", einschwingen: 0, autostufeStart: "normal" } });
  fakt(v, "x1", "Orion Altfall", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { fundstelle: fund("x1", "2026-10-10T10:00:00Z") });
  committeAm(v, ORION, orionSeite(["- von Hand · Stand 01.10.2026 · [[x]]"]), "2026-10-15T08:00:00Z", "Handänderung nach dem Zitat");
  fakeKi([abgl("Orion Altfall")]);
  await lauf(v);
  const rf = rueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.grund, R.istAutostufeRueckfrage(x)]), [["seite-seither-geaendert", false]]);
  assert.match(rf[0].beschreibung, /Seite seither geändert/);
  assert.match(rf[0].beschreibung, /Zitat älter als 7 Tage — später evtl\. überholt/);
});

test("R5 gilt auch für Stände: ein Stand mit altem Zitat wird eine Rückfrage altbestand (der Kernsatz steht in der Frage), ein frischer wird ersetzt", async () => {
  const repoBasis = tempOrdner("repos");
  const seiten = {}, repos = {};
  for (const n of ["orion", "luna"]) {
    repos[n] = join(repoBasis, `${n}-repo`);
    mkdirSync(join(repos[n], ".git"), { recursive: true });
    seiten[`09_wiki/projekte/entitaet_${n}.md`] = seitenText({ fm: { name: n, description: `${n} Testsystem`, repo: `${n}-repo` }, rumpf: `# ${n}\n\n## Fakten\n\n- a · Stand 01.10.2026 · [[x]]\n` });
  }
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0, autostufeStart: "normal" }, seiten });
  const KERN = { o: "Orion läuft seit der Umstellung auf der neuen Plattform.", l: "Der Mond-Dienst Luna läuft jetzt in der Zone Nord." };
  fakt(v, "st-o", "Stand Orion", KERN.o, "Orion läuft jetzt auf der neuen Plattform", { art: "stand", ordner: repos.orion, fundstelle: fund("st-o", "2026-10-12T10:00:00Z") });
  fakt(v, "st-l", "Stand Luna", KERN.l, "Luna läuft jetzt in der Zone Nord", { art: "stand", ordner: repos.luna });
  fakeKi(Object.values(KERN).map((k) => ({ wenn: ["Du vergleichst", `FAKT: ${k}`], antwort: NEU() })));
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 1);
  assert.match(lies(v, "09_wiki/projekte/entitaet_luna.md"), /## Stand/);
  assert.doesNotMatch(lies(v, "09_wiki/projekte/entitaet_orion.md"), /## Stand/);
  assert.deepEqual(rueckfragen(v).map((x) => [x.typ, x.grund]), [["heikel", "altbestand"]]);
  assert.match(rueckfragen(v)[0].beschreibung, /Fakt: Orion läuft seit der Umstellung auf der neuen Plattform\./);
});

test("Start eng: der Richter urteilt zuerst und es gibt KEINE markierte Rückfrage — Werkzeug-Belege gehen nach dem Richter automatisch durch, alles andere wartet ohne KI-Aufruf (autostufe-eng)", async () => {
  const v = bau({ automatik: { tageslauf: "an", einschwingen: 0, autostufeStart: "eng" } });
  fakt(v, "e1", "Orion Werkzeugfall", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha", { herkunft: "tool" });
  fakt(v, "e2", "Orion Duzfall", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  fakt(v, "e3", "Orion Altwerkzeug", "Orion nutzt für Anmeldungen den Dienst Gamma.", "Orion nutzt für Anmeldungen den Dienst Gamma", { herkunft: "tool" });
  const ki = fakeKi([abgl("Orion Werkzeugfall"), abgl("Orion Duzfall"), abgl("Orion Altwerkzeug"), richter("Orion Altwerkzeug", { ueberholt: true })]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual([zustand(v).stufe, zustand(v).grund], ["eng", "start"]);
  assert.equal(P.leseLetzter(v).lernmodus, undefined, "eng ist kein Lernmodus");
  assert.equal(sonnet(ki).length, 2, "Richter nur für die beiden Werkzeug-Belege");
  assert.equal(r.zahlen.uebernommen, 1);
  assert.match(lies(v, ORION), /Dienst Alpha/);
  assert.ok(existsSync(archiv(v, "ueberholt", "e3")));
  assert.equal(warteGrund(v, "e2"), "autostufe-eng");
  assert.deepEqual(R.listeRueckfragen(v), []);
});

// ------------------------------------------------------------------------------------------ Lernmodus ganz: 20 bestätigte Urteile → eng → Einschwing-Tor

const SILBEN = ["ka", "ro", "mi", "tu", "be", "so", "la", "ne", "vi", "pa"];
const wort = (i) => { const w = `${SILBEN[i % 10]}${SILBEN[Math.floor(i / 10) % 10]}lon`; return w[0].toUpperCase() + w.slice(1); };
function kandidat(v, id, i, herkunft = "tool") {
  const satz = `Orion pflegt das Modul ${wort(i)} im Raum ${wort(i + 37)} sorgfältig`;
  legeVorschlagAn(v, { id, titel: `Orion ${wort(i)}`, text: `${satz}.`, zitat: satz, herkunft, fundstelle: fund(id) });
}
const idn = (vor, i) => `${vor}${String(i + 1).padStart(2, "0")}`;
const einschwing = (v) => R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe" && x.quelle === R.EINSCHWING_QUELLE);
const rueckweg = (v) => P.lesePruefungen(v).filter((p) => p.quelle === R.AUTOSTUFE_QUELLE);

test("Lernmodus von vorn bis hinten: 22 Kandidaten → 22 markierte Rückfragen, nichts automatisch; 20 bestätigte Urteile in Folge (ein „verwerfen“ setzt die Zählung zurück) → eng; dann greift das Einschwing-Tor", async () => {
  const v = bau({ automatik: { tageslauf: "an", einschwingen: 2, tageslaufBudget: "gross", autostufeStart: undefined } });
  for (let i = 0; i < 22; i++) kandidat(v, idn("f", i), i);
  fakeKi([{ wenn: "FAKT:", antwort: NEU() }]);
  const tag = (n) => ({ jetzt: JETZT + n * STUNDE });
  const r1 = await lauf(v, tag(0));
  assert.equal(r1.status, "ok", JSON.stringify(r1));
  assert.equal(r1.zahlen.uebernommen, 0, "Lernmodus: nichts automatisch");
  assert.equal(markierte(v).length, 22);
  assert.ok(markierte(v).every((x) => x.typ === "heikel" && x.grund === "autostufe-aus" && x.quelle === R.AUTOSTUFE_QUELLE));
  assert.deepEqual([zustand(v).stufe, zustand(v).grund], ["aus", "start"]);
  assert.equal(E.einschwingStand(v).A, 0);
  // Morgenzeile und Bericht: Lernmodus statt Fehler-Formulierung, Zählung 0/20.
  const z1 = M.morgenZeile(v, { jetzt: JETZT });
  assert.match(z1, /Lernmodus: Automatik ab 20 bestätigten Urteilen in Folge \(jetzt 0\/20\)/);
  assert.doesNotMatch(z1, /Fehlerquote 0\/0 — Rückfragen beantworten|Autostufe aus:/, "keine Fehler-Formulierung");
  assert.match(bericht(v, r1), /- Lernmodus: .*ab 20 bestätigten Urteilen in Folge \(jetzt 0\/20\).*22 markierte Rückfragen warten/);
  assert.doesNotMatch(bericht(v, r1), /Autostufe aus: Fehlerquote/);
  // Lauf 2: ein „verwerfen“ — Prüfung falsch, Zählung bleibt bei 0, die Stufe bleibt aus (und der Lernmodus auch).
  const alle = markierte(v);
  R.beantworte(v, alle[0].id, "verwerfen");
  const r2 = await lauf(v, tag(1));
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.deepEqual(rueckweg(v).map((p) => p.fehler), [true]);
  assert.deepEqual([zustand(v).stufe, zustand(v).grund], ["aus", "start"], "der Zustand kommt weiter aus dem Start, nicht aus Fehlern");
  assert.match(M.morgenZeile(v, { jetzt: JETZT + STUNDE }), /Lernmodus: Automatik ab 20 bestätigten Urteilen in Folge \(jetzt 0\/20\)/);
  // Lauf 3: 19 richtige → 19/20, noch aus.
  const rest = markierte(v);
  for (const x of rest.slice(0, 19)) R.beantworte(v, x.id, "uebernehmen");
  const r3 = await lauf(v, tag(2));
  assert.equal(r3.status, "ok", JSON.stringify(r3));
  assert.equal(AS.rueckwegStand(v).folge, 19);
  assert.equal(zustand(v).stufe, "aus");
  assert.match(M.morgenZeile(v, { jetzt: JETZT + 2 * STUNDE }), /Lernmodus: Automatik ab 20 bestätigten Urteilen in Folge \(jetzt 19\/20\)/);
  assert.match(bericht(v, r3), /\(jetzt 19\/20\)/);
  // Lauf 4: die 20. richtige Antwort → eng.
  R.beantworte(v, markierte(v)[0].id, "uebernehmen");
  const r4 = await lauf(v, tag(3));
  assert.equal(r4.status, "ok", JSON.stringify(r4));
  assert.deepEqual([zustand(v).stufe, zustand(v).grund], ["eng", undefined], "20 bestätigte Urteile in Folge → eine Stufe hoch");
  assert.equal(P.leseLetzter(v).autostufe, "eng");
  assert.equal(P.leseLetzter(v).lernmodus, undefined);
  assert.equal(rueckweg(v).length, 21);
  assert.equal(P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen" && a.auto === false).length, 20, "20 Fakten stehen nach deiner Antwort im Wiki");
  const z4 = M.morgenZeile(v, { jetzt: JETZT + 3 * STUNDE });
  assert.doesNotMatch(z4, /Lernmodus/);
  assert.match(z4, /Autostufe eng/);
  assert.deepEqual([E.einschwingStand(v).A, E.einschwingStand(v).R], [0, 0], "die Lernmodus-Antworten zählen nicht als Einschwing-R");
  // Lauf 5: neue Werkzeug-Belege gehen unter „eng“ automatisch durch — aber nur so viele, wie das Einschwing-Tor (N = 2) Plätze hat.
  for (let i = 0; i < 3; i++) kandidat(v, idn("g", i), 60 + i);
  const r5 = await lauf(v, tag(4));
  assert.equal(r5.status, "ok", JSON.stringify(r5));
  assert.equal(r5.zahlen.uebernommen, 2, JSON.stringify(r5.zahlen));
  const auto = P.leseAktionen(v).filter((a) => a.lauf === r5.lauf && a.stufe === "uebernehmen");
  assert.ok(auto.every((a) => a.auto === true && a.einschwingen === true), "automatisch, als Einschwing-Übernahme gekennzeichnet");
  assert.equal(einschwing(v).length, 2, "jede bekommt sofort ihre Stichprobe");
  const wartet = ["g01", "g02", "g03"].filter((id) => warteGrund(v, id) === "einschwingen");
  assert.equal(wartet.length, 1, "der dritte wartet auf einen freien Platz");
  assert.match(M.morgenZeile(v, { jetzt: JETZT + 4 * STUNDE }), /Einschwingen 0\/2 geprüft · 2 offen/);
});

test("Morgenzeile: Lernmodus nur, wenn der Zustand aus dem Start kommt; kommt „aus“ aus Fehlern, bleibt die Fehler-Formulierung; Probe nennt den Lernmodus als Ausblick", () => {
  const letzter = (extra = {}) => ({ lauf: "20261021-120000", zeit: "2026-10-21T12:00:00Z", modus: "an", art: "voll", status: "ok", erfolgreich: true,
    letzterErfolg: "2026-10-21T12:00:00Z", zahlen: { uebernommen: 0, aussortiert: 2, rueckfragenNeu: 3, rueckfragen: 3 }, fehlerquote: { fehler: 0, geprueft: 0 }, autostufe: "aus", ...extra });
  const v = bau();
  P.schreibeLetzter(v, letzter({ lernmodus: true }));
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(zustandsDatei(v), JSON.stringify({ stufe: "aus", seit: "2026-10-21T12:00:00.000Z", grund: "start" }));
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /Lernmodus: Automatik ab 20 bestätigten Urteilen in Folge \(jetzt 0\/20\)/);
  // aus wegen Fehlern: keine Lernmodus-Angabe, die Fehler-Formulierung wie bisher.
  const w = bau();
  P.schreibeLetzter(w, letzter({ fehlerquote: { fehler: 3, geprueft: 10 } }));
  mkdirSync(P.TL_DIR(w), { recursive: true });
  writeFileSync(zustandsDatei(w), JSON.stringify({ stufe: "aus", seit: "2026-10-21T12:00:00.000Z" }));
  const zw = M.morgenZeile(w, { jetzt: JETZT });
  assert.match(zw, /Autostufe aus: Fehlerquote 3\/10 — Rückfragen beantworten bringt die Automatik zurück/);
  assert.doesNotMatch(zw, /Lernmodus/);
  // Probe: Ausblick.
  const p = bau({ automatik: { ...LERN, tageslauf: "probe" } });
  P.schreibeLetzter(p, letzter({ modus: "probe", lernmodus: true }));
  const zp = M.morgenZeile(p, { jetzt: JETZT });
  assert.match(zp, /^Brain-Probelauf/);
  assert.match(zp, /Lernmodus: scharf beginnt die Automatik bei „aus“/);
  assert.doesNotMatch(zp, /Autostufe aus: Fehlerquote/);
});

test("brain status: der Lernmodus steht beim Tageslauf dabei", async () => {
  const { brainStatus, statusText } = await import("../status.mjs");
  const v = bau();
  P.schreibeLetzter(v, { lauf: "20261021-120000", zeit: "2026-10-21T12:00:00Z", modus: "an", status: "ok", zahlen: { rueckfragen: 3 }, fehlerquote: { fehler: 0, geprueft: 0 }, autostufe: "aus", lernmodus: true });
  const s = await brainStatus(v, { jetzt: JETZT });
  assert.equal(s.tageslauf.autostufe, "aus");
  assert.equal(s.tageslauf.lernmodus, true);
  assert.match(statusText(s), /Autostufe aus \(Lernmodus\)/);
});
