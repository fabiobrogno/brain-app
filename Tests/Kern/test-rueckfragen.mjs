// .tools/tests/test-rueckfragen.mjs — Rückfragen: Ablage, Deckel, Reihenfolge, Verfall, Stichprobe, Konflikte, CLI, Skill (B2, Task 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, FAKE_BEFEHL, JETZT, KIT } from "./tageslauf-hilfe.mjs";
const R = await import("../rueckfragen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
isoliere();
const TAG = 86400e3;
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const vo = (v, id, extra = {}) => { legeVorschlagAn(v, { id, ...extra }); return B.ladeVorschlag(v, "_vorschlaege", id); };

test("legeRueckfrageAn: Datei unter _rueckfragen, Vorschlag daneben; Probe legt nichts an, notiert nur", () => {
  const v = neuerTestVault();
  const id = R.legeRueckfrageAn(ctxFuer(v), { typ: "heikel", frage: "Übernehmen?", beschreibung: "Zitat: „x“", vorschlaege: [vo(v, "a1")], seite: "09_wiki/a.md", grund: "heikel" });
  assert.match(id, /^rf-20261022-heikel-[0-9a-f]{6}$/);
  const [r] = R.listeRueckfragen(v);
  assert.deepEqual([r.id, r.typ, r.frage, r.vorschlaege, r.seite, r.antwort], [id, "heikel", "Übernehmen?", ["a1"], "09_wiki/a.md", ""]);
  assert.ok(existsSync(join(v, "00_inbox", "_rueckfragen", "vorschlaege", "a1.md")));
  const probe = ctxFuer(v, { probe: true });
  assert.equal(R.legeRueckfrageAn(probe, { typ: "web", frage: "?", vorschlaege: [vo(v, "a2")] }), null);
  assert.equal(R.listeRueckfragen(v).length, 1);
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "a2.md")));
  assert.equal(probe.aktionen[0].stufe, "rueckfrage");
});

test("sortiere: zweifel > widerspruch/konflikt (oft genutzte Seite zuerst) > lektion > heikel > veraltet > web; sonst älteste zuerst", () => {
  const r = (id, typ, seite = "", erstellt = "2026-10-01T00:00:00Z") => ({ id, typ, seite, erstellt });
  const nutzung = new Map([["09_wiki/oft.md", [1, 2, 3]], ["09_wiki/selten.md", [1]]]);
  const liste = [r("w", "web"), r("v", "veraltet"), r("h2", "heikel", "", "2026-10-05T00:00:00Z"), r("h1", "heikel"), r("l", "lektion"),
    r("k", "konflikt", "09_wiki/selten.md"), r("wi", "widerspruch", "09_wiki/oft.md"), r("z", "zweifel")];
  assert.deepEqual(R.sortiere(liste, nutzung).map((x) => x.id), ["z", "wi", "k", "l", "h1", "h2", "v", "w"]);
});

test("sichtbare: höchstens 10 offene (Rest wartet), Stichproben zusätzlich, beantwortete nicht mehr", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  for (let i = 0; i < 12; i++) R.legeRueckfrageAn(ctx, { typ: "heikel", frage: `F${i}` });
  R.legeRueckfrageAn(ctx, { typ: "stichprobe", frage: "S", felder: { aktion: "x" } });
  const s = R.sichtbare(v, { nutzung: new Map() });
  assert.deepEqual([s.fragen.length, s.wartend], [11, 2]);
  assert.equal(s.fragen.filter((f) => f.typ === "stichprobe").length, 1);
  R.beantworte(v, s.fragen[0].id, "verwerfen");
  assert.equal(R.sichtbare(v, { nutzung: new Map() }).wartend, 1);
});

test("beantworte: speichert Wahl und Notiz; falsche Wahl, Zugangsdaten, „ändern“ ohne Text → 400; unbekannt → 404", () => {
  const v = neuerTestVault();
  const id = R.legeRueckfrageAn(ctxFuer(v), { typ: "lektion", frage: "Aktivieren?" });
  assert.throws(() => R.beantworte(v, id, "vielleicht"), (e) => e.code === 400);
  assert.throws(() => R.beantworte(v, id, "aendern"), (e) => e.code === 400);
  assert.throws(() => R.beantworte(v, id, "aendern", ["pass", "word"].join("") + "=Koeder123"), (e) => e.code === 400);
  assert.throws(() => R.beantworte(v, "rf-gibtsnicht", "aktivieren"), (e) => e.code === 404);
  R.beantworte(v, id, "aendern", "Immer erst testen.");
  const [r] = R.listeRueckfragen(v);
  assert.deepEqual([r.antwort, r.notiz], ["aendern", "Immer erst testen."]);
  assert.match(r.beantwortet, /^\d{4}-\d{2}-\d{2}T/);
});

test("verfallen: web/heikel älter als 60 Tage → Archiv, Vorschlag aussortiert/verfallen; jüngere und andere Typen bleiben", () => {
  const v = neuerTestVault();
  const alt = ctxFuer(v, { jetzt: JETZT - 61 * TAG });
  R.legeRueckfrageAn(alt, { typ: "web", frage: "W", vorschlaege: [vo(v, "w1")] });
  R.legeRueckfrageAn(alt, { typ: "lektion", frage: "L" });
  R.legeRueckfrageAn(ctxFuer(v, { jetzt: JETZT - 59 * TAG }), { typ: "heikel", frage: "H" });
  assert.equal(R.verfallen(ctxFuer(v)), 1);
  assert.deepEqual(R.listeRueckfragen(v).map((r) => r.typ).sort(), ["heikel", "lektion"]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "verfallen", "w1.md")));
  assert.equal(readdirSync(join(v, "90_archiv", "rueckfragen-verfallen")).length, 1);
});

// Verfall (Folgepunkt): heikel-Rückfragen (auch kritisch-Prüfungen, markierte Autostufe-Rückfragen), die nie ANGEZEIGT wurden — der Deckel zeigt nur 10 —, dürfen nicht unbesehen
// ins Archiv wandern. Anzeige-Merkmal: `gezeigt` im Kopf der Rückfrage, gesetzt beim ersten Zeigen (CLI liste = Skill „rueckfragen“); die 60 Tage laufen ab dann.
test("verfallen: eine heikel-Rückfrage, die nie angezeigt wurde, verfällt nicht — auch nach 200 Tagen; web verfällt wie gehabt ab Erstellung", () => {
  const v = neuerTestVault();
  const alt = ctxFuer(v, { jetzt: JETZT - 200 * TAG });
  R.legeRueckfrageAn(alt, { typ: "heikel", frage: "H", vorschlaege: [vo(v, "h1")] });
  R.legeRueckfrageAn(alt, { typ: "web", frage: "W", vorschlaege: [vo(v, "w1")] });
  assert.equal(R.verfallen(ctxFuer(v)), 1, "nur web");
  assert.deepEqual(R.listeRueckfragen(v).map((r) => r.typ), ["heikel"]);
  assert.ok(existsSync(join(v, "00_inbox", "_rueckfragen", "vorschlaege", "h1.md")), "der Vorschlag liegt weiter bei der Rückfrage");
  assert.ok(!existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "verfallen", "h1.md")));
});

test("verfallen: die 60 Tage einer heikel-Rückfrage laufen ab der ersten Anzeige (markiereGezeigt), nicht ab Erstellung; die erste Anzeige bleibt stehen", () => {
  const v = neuerTestVault();
  R.legeRueckfrageAn(ctxFuer(v, { jetzt: JETZT - 90 * TAG }), { typ: "heikel", frage: "H", vorschlaege: [vo(v, "h1")] });
  const erste = R.sichtbare(v, { jetzt: JETZT - 30 * TAG, nutzung: new Map() }).fragen;           // vor 30 Tagen zum ersten Mal gezeigt
  assert.equal(R.markiereGezeigt(v, erste, JETZT - 30 * TAG), 1);
  assert.equal(R.listeRueckfragen(v)[0].fm.gezeigt, new Date(JETZT - 30 * TAG).toISOString().slice(0, 19) + "Z");
  assert.equal(R.markiereGezeigt(v, R.sichtbare(v, { nutzung: new Map() }).fragen, JETZT), 0, "schon markiert: unverändert");
  assert.equal(R.listeRueckfragen(v)[0].fm.gezeigt, new Date(JETZT - 30 * TAG).toISOString().slice(0, 19) + "Z", "die erste Anzeige zählt");
  assert.equal(R.verfallen(ctxFuer(v)), 0, "30 Tage nach der Anzeige: noch nicht");
  assert.equal(R.verfallen(ctxFuer(v, { jetzt: JETZT + 29 * TAG })), 0, "59 Tage nach der Anzeige: noch nicht");
  assert.equal(R.verfallen(ctxFuer(v, { jetzt: JETZT + 31 * TAG })), 1, "61 Tage nach der Anzeige: verfallen");
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "verfallen", "h1.md")));
});

test("markiereGezeigt: Antworten und Rückfragen ohne Datei-Schreibrecht stören nicht; beantwortete Rückfragen werden nicht angefasst", () => {
  const v = neuerTestVault();
  const id = R.legeRueckfrageAn(ctxFuer(v), { typ: "heikel", frage: "H" });
  const [r] = R.listeRueckfragen(v);
  R.beantworte(v, id, "verwerfen");
  assert.equal(R.markiereGezeigt(v, [r], JETZT), 0, "beantwortet → nicht markieren");
  assert.equal(R.markiereGezeigt(v, [{ ...r, id: "rf-gibtsnicht", datei: join(v, "gibt", "es", "nicht.md"), antwort: "" }], JETZT), 0, "kaputter Pfad wirft nicht");
  assert.equal(R.markiereGezeigt(v, null, JETZT), 0);
});

test("CLI liste markiert genau die gezeigten Rückfragen als gezeigt; die wartenden über dem Deckel nicht", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  for (let i = 0; i < 12; i++) R.legeRueckfrageAn(ctx, { typ: "heikel", frage: `F${String(i).padStart(2, "0")}` });
  const cli = (...a) => spawnSync(process.execPath, [join(KIT, "rueckfragen.mjs"), v, ...a], { encoding: "utf8" });
  const l = JSON.parse(cli("liste").stdout);
  assert.deepEqual([l.fragen.length, l.wartend], [10, 2]);
  const alle = R.listeRueckfragen(v);
  const gezeigt = alle.filter((r) => r.fm.gezeigt);
  assert.equal(gezeigt.length, 10);
  assert.deepEqual(new Set(gezeigt.map((r) => r.id)), new Set(l.fragen.map((f) => f.id)), "genau die angezeigten");
  assert.ok(alle.filter((r) => !r.fm.gezeigt).every((r) => !l.fragen.some((f) => f.id === r.id)));
});

test("stichprobenAuffuellen: 2 je Woche aus automatischen Übernahmen ≤ 30 Tage, ungeprüfte zuerst, ohne zurückgenommene/von Hand", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  const a = (id, tage, extra = {}) => ({ lauf: "L", zeit: new Date(JETZT - tage * TAG).toISOString(), id, stufe: "uebernehmen", ziel: "09_wiki/a.md", commit: `c${id}`, auto: true, titel: `T ${id}`, zitat: "Z", fundstelle: "s#u", ...extra });
  const aktionen = [a("alt", 40), a("geprueft", 3), a("frei1", 5), a("frei2", 6), a("hand", 2, { auto: false }), a("weg", 2), { id: "weg", stufe: "zurueck" }];
  const pruefungen = [{ art: "stichprobe", aktion: "geprueft", fehler: false }];
  assert.equal(R.stichprobenAuffuellen(ctx, { aktionen, pruefungen, jeWoche: 2, zufall: () => 0 }), 2);
  assert.deepEqual(R.listeRueckfragen(v).map((r) => r.fm.aktion).sort(), ["frei1", "frei2"]);
  assert.equal(R.stichprobenAuffuellen(ctx, { aktionen, pruefungen, jeWoche: 2, zufall: () => 0 }), 0, "Woche voll");
  assert.equal(R.stichprobenAuffuellen(ctx, { aktionen, pruefungen, jeWoche: 4, zufall: () => 0 }), 1, "eng: 4 je Woche; übrig ist nur die schon geprüfte");
});

// --- Einschwingphase (B2): Stichproben mit `quelle: einschwingen` --------------------------------------------------------------------
const einschw = (ctx, id, extra = {}) => R.legeRueckfrageAn(ctx, { typ: "stichprobe", frage: `S ${id}`, grund: "einschwingen", seite: "09_wiki/a.md",
  felder: { aktion: id, commit: `c${id}`, quelle: "einschwingen" }, ...extra });

test("Einschwing-Stichprobe: gleiche Form wie die Wochen-Stichprobe, nur mit quelle; listeRueckfragen reicht quelle durch", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  const e = einschw(ctx, "a1"), w = R.legeRueckfrageAn(ctx, { typ: "stichprobe", frage: "W", felder: { aktion: "a2", commit: "c2" } });
  const l = R.listeRueckfragen(v);
  const re = l.find((r) => r.id === e), rw = l.find((r) => r.id === w);
  assert.deepEqual([re.typ, re.quelle, re.fm.aktion, re.fm.commit], ["stichprobe", "einschwingen", "a1", "ca1"]);
  assert.deepEqual([rw.typ, rw.quelle], ["stichprobe", ""]);
  assert.equal(R.EINSCHWING_QUELLE, "einschwingen");
  assert.deepEqual(R.fuerSkill(re).optionen.map((o) => o.wahl), ["stimmt", "stimmt-nicht"], "dieselben Antworten wie die Wochen-Stichprobe");
});

test("sortiere: Einschwing-Stichprobe steht vor allen übrigen Typen (insbesondere vor web), mehrere nach Alter", () => {
  const r = (id, typ, quelle = "", erstellt = "2026-10-01T00:00:00Z") => ({ id, typ, quelle, seite: "", erstellt });
  const liste = [r("w", "web"), r("h", "heikel"), r("e2", "stichprobe", "einschwingen", "2026-10-03T00:00:00Z"), r("z", "zweifel"), r("e1", "stichprobe", "einschwingen", "2026-10-02T00:00:00Z"),
    r("v", "veraltet"), r("s", "stichprobe", "")];
  const ids = R.sortiere(liste).map((x) => x.id);
  assert.ok(ids.indexOf("e1") < ids.indexOf("e2") && ids.indexOf("e2") < ids.indexOf("w"), "Einschwing vor web, älteste zuerst");
  assert.deepEqual(ids.filter((i) => i !== "s"), ["e1", "e2", "z", "h", "v", "w"]);
});

test("sichtbare: Einschwing-Stichproben zählen in den Deckel von 10 (anders als Wochen-Stichproben) und kommen vor web", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  for (let i = 0; i < 12; i++) R.legeRueckfrageAn(ctx, { typ: "web", frage: `W${i}` });
  for (let i = 0; i < 3; i++) einschw(ctx, `e${i}`);
  R.legeRueckfrageAn(ctx, { typ: "stichprobe", frage: "Woche", felder: { aktion: "wo" } });
  const s = R.sichtbare(v, { nutzung: new Map() });
  const e = s.fragen.filter((f) => f.typ === "stichprobe" && f.quelle === "einschwingen"), web = s.fragen.filter((f) => f.typ === "web");
  assert.deepEqual([e.length, web.length], [3, 7], "Deckel 10 = 3 Einschwing + 7 web");
  assert.equal(s.fragen.filter((f) => f.typ === "stichprobe" && f.quelle !== "einschwingen").length, 1, "Wochen-Stichprobe weiterhin zusätzlich");
  assert.equal(s.fragen.length, 11);
  assert.equal(s.wartend, 5, "die übrigen 5 web warten über dem Deckel");
  const reihe = s.fragen.filter((f) => f.typ !== "stichprobe" || f.quelle === "einschwingen").map((f) => f.typ);
  assert.deepEqual(reihe.slice(0, 3), ["stichprobe", "stichprobe", "stichprobe"], "Einschwing zuerst, dann web");
  // Mehr als 10 Einschwing-Stichproben: auch sie halten den Deckel ein, der Rest wartet.
  const w2 = neuerTestVault();
  const c2 = ctxFuer(w2);
  for (let i = 0; i < 14; i++) einschw(c2, `x${i}`);
  const s2 = R.sichtbare(w2, { nutzung: new Map() });
  assert.deepEqual([s2.fragen.length, s2.wartend], [10, 4]);
});

test("stichprobenAuffuellen: offene Einschwing-Stichproben verbrauchen das Wochenkontingent nicht — und ihre Übernahme wird nicht doppelt gefragt", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  const a = (id, tage) => ({ lauf: "L", zeit: new Date(JETZT - tage * TAG).toISOString(), id, stufe: "uebernehmen", ziel: "09_wiki/a.md", commit: `c${id}`, auto: true, titel: `T ${id}`, zitat: "Z", fundstelle: "s#u" });
  einschw(ctx, "e1"); einschw(ctx, "e2");
  const aktionen = [a("e1", 1), a("e2", 1), a("f1", 2), a("f2", 3), a("f3", 4)];
  assert.equal(R.stichprobenAuffuellen(ctx, { aktionen, pruefungen: [], jeWoche: 2, zufall: () => 0 }), 2, "zwei volle Wochen-Stichproben trotz zweier Einschwing-Fragen");
  const wochen = R.listeRueckfragen(v).filter((r) => r.typ === "stichprobe" && r.quelle !== "einschwingen").map((r) => r.fm.aktion).sort();
  assert.deepEqual(wochen, ["f1", "f2"], "e1/e2 haben schon eine offene Frage");
  assert.equal(R.stichprobenAuffuellen(ctx, { aktionen, pruefungen: [], jeWoche: 2, zufall: () => 0 }), 0, "Wochen-Kontingent jetzt voll");
});

test("konfliktRueckfragen: je offenem Kasten eine Rückfrage mit A/B und Quellen, beim zweiten Lauf nicht doppelt", () => {
  const kasten = "> [!KONFLIKT] offen — Du entscheidest\n> A: \"Port 3309\" — Quelle: [[q-a]]\n> B: \"Port 3310\" — Quelle: [[q-b]]\n";
  const v = neuerTestVault({ seiten: { "09_wiki/wissen/thema_k.md": seitenText({ fm: { name: "k" }, rumpf: `# K\n\n${kasten}` }) } });
  const ctx = ctxFuer(v);
  assert.equal(R.konfliktRueckfragen(ctx), 1);
  assert.equal(R.konfliktRueckfragen(ctx), 0);
  const [r] = R.listeRueckfragen(v);
  assert.equal(r.typ, "konflikt");
  assert.match(r.beschreibung, /Port 3309[\s\S]*q-a[\s\S]*Port 3310/);
  assert.equal(Number(r.fm.nr), 1);
  assert.match(String(r.fm.fp), /^[0-9a-f]{12}$/);
});

test("CLI: liste liefert JSON für den Skill (Kopf ≤ 12 Zeichen, Optionen mit Wirkung), antwort speichert; Skill vorhanden", () => {
  const v = neuerTestVault();
  const id = R.legeRueckfrageAn(ctxFuer(v), { typ: "widerspruch", frage: "Was gilt?", beschreibung: "A: x\nB: y" });
  const cli = (...a) => spawnSync(process.execPath, [join(KIT, "rueckfragen.mjs"), v, ...a], { encoding: "utf8" });
  const l = JSON.parse(cli("liste").stdout);
  assert.deepEqual([l.fragen.length, l.wartend], [1, 0]);
  const f = l.fragen[0];
  assert.ok(f.header.length <= 12);
  assert.deepEqual(f.optionen.map((o) => o.wahl), ["a", "b", "beide", "weiss-nicht"]);
  assert.ok(f.optionen.every((o) => o.label && o.wirkung));
  assert.equal(cli("antwort", id, "b").status, 0);
  assert.equal(R.listeRueckfragen(v)[0].antwort, "b");
  assert.equal(cli("antwort", id, "quatsch").status, 2);
  assert.equal(cli("antwort", "rf-gibtsnicht", "a").status, 1);
  for (const t of Object.values(R.TYPEN)) assert.ok(t.kopf.length <= 12 && Object.keys(t.wahlen).length >= 2 && Object.keys(t.wahlen).length <= 4);
  const skill = readFileSync(join(KIT, "skills", "rueckfragen", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: rueckfragen\n/);
  assert.match(skill, /AskUserQuestion/);
  assert.match(skill, /tageslauf --nur-antworten --losgeloest/);
});

// --- Pflege-Vorschläge (B3, Lernmodus): „Übernehmen“ wirkt nur für das, was vollständig gezeigt wurde ----------------------------------
const pflegeFrage = (v, diff, { extra = "", quelle = R.AUTOSTUFE_QUELLE } = {}) => R.legeRueckfrageAn(ctxFuer(v), { typ: "heikel", frage: "Pflege-Vorschlag: Inbox „x“ — so übernehmen?",
  beschreibung: `Ziel: 09_wiki/a.md\nVorschlag der Pflege:\n\n${R.diffCodeblock(diff)}\n\nWarum ich frage: Lernmodus${extra}`, seite: "09_wiki/a.md", grund: "autostufe-aus",
  felder: { quelle, pflege: "inbox:x.md", pflege_sha: "abc" } });
const langerDiff = (n) => `Datei: 09_wiki/a.md\n@@ -1,2 +1,${n} @@\n${Array.from({ length: n }, (_, i) => `+Zeile ${i} mit etwas Text zum Füllen`).join("\n")}\n+ENDE-DES-DIFFS`;

test("Pflege-Vorschlag: fuerSkill liefert den VOLLEN Text (nie gekürzt) und die passende Wirkung; gewöhnliche Rückfragen bleiben bei 1500 Zeichen", () => {
  const v = neuerTestVault();
  const diff = langerDiff(200);
  assert.ok(diff.length > 6000 && diff.length < 8000);
  pflegeFrage(v, diff);
  const [r] = R.listeRueckfragen(v);
  const s = R.fuerSkill(r);
  assert.equal(s.beschreibung, r.beschreibung, "unverändert, ohne Kürzung");
  assert.ok(s.beschreibung.includes("+ENDE-DES-DIFFS") && s.beschreibung.includes("Warum ich frage: Lernmodus"));
  assert.deepEqual([s.pflege, s.vollstaendig], [true, true]);
  assert.equal(s.optionen.find((o) => o.wahl === "uebernehmen").wirkung, "Genau diese Änderung wird übernommen.");
  assert.doesNotMatch(JSON.stringify(s.optionen), /Der Fakt kommt mit Beleg ins Wiki/);
  // gewöhnliche markierte Rückfrage (Fakt): wie bisher gekürzt, Optionstext unverändert
  R.legeRueckfrageAn(ctxFuer(v), { typ: "heikel", frage: "Fakt?", beschreibung: `${"x".repeat(1600)}ENDE`, seite: "09_wiki/b.md" });
  const f = R.listeRueckfragen(v).find((x) => x.frage === "Fakt?");
  const fs = R.fuerSkill(f);
  assert.equal(fs.beschreibung.length, 1500);
  assert.equal(fs.pflege, undefined);
  assert.equal(fs.optionen.find((o) => o.wahl === "uebernehmen").wirkung, "Der Fakt kommt mit Beleg ins Wiki.");
});

test("Pflege-Vorschlag, den die Anzeige nicht vollständig tragen kann: keine Optionen (nicht beantwortbar), nur der Verweis auf die Datei — nie gekürzt vorgelegt", () => {
  const v = neuerTestVault();
  pflegeFrage(v, langerDiff(10), { extra: `\n${"y".repeat(R.ANZEIGE_MAX_PFLEGE)}` });
  const [r] = R.listeRueckfragen(v);
  const s = R.fuerSkill(r);
  assert.deepEqual([s.pflege, s.vollstaendig], [true, false]);
  assert.deepEqual(s.optionen, []);
  assert.equal(s.beschreibung, "");
  assert.equal(s.datei, r.datei);
  assert.match(s.hinweis, /zu lang|zu groß/i);
});

test("diffCodeblock: ```diff-Zaun, länger als jede Backtick-Folge im Diff (kein Ausbrechen); in der Rückfrage-Datei steht der Diff im Block", () => {
  assert.equal(R.diffCodeblock("+a\n-b"), "```diff\n+a\n-b\n```");
  const b = R.diffCodeblock("+```js\n+x\n+````\n %% Kommentar %%\n+<!-- versteckt -->");
  assert.match(b, /^`{5}diff\n/);
  assert.match(b, /\n`{5}$/);
  assert.equal(b.split("\n").filter((z) => /^`{5}$/.test(z)).length, 1, "der Zaun kommt im Diff nicht vor");
  const v = neuerTestVault();
  pflegeFrage(v, "+%% Obsidian-Kommentar %%\n+<!-- auch versteckt -->");
  const roh = readFileSync(R.listeRueckfragen(v)[0].datei, "utf8");
  assert.match(roh, /```diff\n\+%% Obsidian-Kommentar %%\n\+<!-- auch versteckt -->\n```/);
});

test("CLI liste: Pflege-Vorschlag kommt mit vollem Diff (JSON), der Deckel der Anzeige gilt nicht für ihn", () => {
  const v = neuerTestVault();
  pflegeFrage(v, langerDiff(220));
  const cli = (...a) => spawnSync(process.execPath, [join(KIT, "rueckfragen.mjs"), v, ...a], { encoding: "utf8" });
  const l = JSON.parse(cli("liste").stdout);
  const f = l.fragen[0];
  assert.ok(f.beschreibung.length > 6000);
  assert.ok(f.beschreibung.includes("+ENDE-DES-DIFFS"));
  assert.equal(f.vollstaendig, true);
});

test("Skill rueckfragen: Pflege-Vorschläge werden wörtlich und vollständig im ```diff-Block gezeigt (nie kürzen/zusammenfassen), unvollständige nicht beantworten lassen", () => {
  const skill = readFileSync(join(KIT, "skills", "rueckfragen", "SKILL.md"), "utf8");
  assert.match(skill, /Pflege-Vorschlag/);
  assert.match(skill, /```diff/);
  assert.match(skill, /wörtlich und vollständig/);
  assert.match(skill, /nie (?:kürzen|zusammenfassen)/i);
  assert.match(skill, /vollstaendig/);
  assert.match(skill, /nicht beantworten lassen|nicht zur Antwort anbieten/);
  assert.match(skill, /in mehreren Teilen/);
});
