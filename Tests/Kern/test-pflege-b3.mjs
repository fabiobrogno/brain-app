// .tools/tests/test-pflege-b3.mjs — B3 Task 11: Ablauf b3Schritte/b3Auftraege mit Stub-Schritten (echte Einheiten, keine KI):
// Schalter, Tages-Riegel, Ingest-Sperre, Probe, EIN ff-Merge, nachMerge mit Hash, Protokoll, Bericht, ctx wiederhergestellt;
// Themen-Guard (fail-closed) und Lernmodus (Vorschlag als markierte Rückfrage, Freigabe, nie ein Merge ohne Freigabe).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, git, schnappschuss, legeVorschlagAn, JETZT } from "./tageslauf-hilfe.mjs";
import { neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
const B3 = await import("../tageslauf/b3.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const R = await import("../rueckfragen.mjs");
const A = await import("../tageslauf/antworten.mjs");
const S = await import("../tageslauf/pflege-stand.mjs");
isoliere();

const SEITE = "09_wiki/wissen/orion.md";
const orion = () => seite({ name: "orion", description: "Orion" }, `# Orion\n\n${Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1}.`).join("\n")}\n`);
const anhaengen = (p, text) => writeFileSync(join(p, SEITE), readFileSync(join(p, SEITE), "utf8") + text);
const vault = (pflegeIntelligenz = "an", extra = {}) => neuerPflegeVault({ seiten: { [SEITE]: orion() }, automatik: { tageslauf: "an", pflegeIntelligenz, ...extra } });

// Stub-Schritte: echte einheit()-Commits ohne KI; `aufrufe` hält fest, wer lief (und mit welchem Durchgang).
function stubs(aufrufe, { nachMerge = [] } = {}) {
  const ohne = async () => { aufrufe.push("ohne"); return []; };
  const gut = async (ctx, kopie) => {
    const l = ctx.pflegeLern;
    const lern = { schluessel: "inbox:notiz-a.md", sha: "sha-1", art: "inbox" };
    if (l && !l.nimm(lern.schluessel, lern.sha)) return [];             // wie die echten Schritte: Lernmodus filtert die Kandidaten
    aufrufe.push(l ? `gut:${l.modus}` : "gut");
    const erg = await P.einheit(ctx, kopie, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
      arbeit: async (p) => { anhaengen(p, "Neu.\n"); return { ok: true }; } });
    return [{ erg, ziel: SEITE, aktion: { quelle: "00_inbox/notiz-a.md" }, lern,
      nachMerge: (h) => { nachMerge.push(h); return { verschoben: "90_archiv/inbox-eingearbeitet/notiz-a.md" }; } }];
  };
  const rot = async (ctx, kopie) => {
    if (ctx.pflegeLern?.modus === "freigaben") return [];
    aufrufe.push("rot");
    const erg = await P.einheit(ctx, kopie, { id: "konsolidieren-orion", art: "konsolidieren", titel: "orion",
      arbeit: async (p) => { anhaengen(p, "VERBOTEN\n"); return { ok: true }; } });
    return [{ erg, ziel: SEITE }];
  };
  return [["Entscheidungen", ohne, { ohneKi: true }], ["Inbox", gut], ["Konsolidieren", rot]];
}

test("Schalter aus (Standard): kein Schritt, keine Aufträge, kein Bericht-Abschnitt", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() } });
  const ctx = pflegeCtx(v);
  const aufrufe = [];
  assert.deepEqual(await B3.b3Schritte(ctx, { schritte: stubs(aufrufe) }), { lauf: false, grund: "aus" });
  assert.deepEqual(B3.b3Auftraege(ctx, { k7: () => { throw new Error("darf nicht laufen"); } }), []);
  assert.deepEqual(aufrufe, []);
  assert.deepEqual(B3.pflegeBerichtZeilen(ctx), []);
});

test("scharf: Schritte der Reihe nach, EIN Merge, nachMerge mit dem Hash aus main, Protokoll + Bericht; ctx wiederhergestellt", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  ctx.grund = "B2-Grund";
  const aufrufe = [], hashes = [];
  const r = await B3.b3Schritte(ctx, { schritte: stubs(aufrufe, { nachMerge: hashes }) });
  assert.deepEqual([r.lauf, r.gut, r.verworfen], [true, 1, 1]);
  assert.deepEqual(aufrufe, ["ohne", "gut", "rot"]);
  const head = git(v, "rev-parse", "HEAD");
  assert.match(git(v, "log", "-1", "--format=%s"), /^pflege\(\d{8}-\d{6}\): inbox notiz-a\.md \[inbox-notiz-a\]$/);
  assert.deepEqual(hashes, [head]);
  const a = ctx.aktionen.find((x) => x.stufe === "pflege");
  assert.deepEqual([a.id, a.art, a.commit, a.ziel, a.quelle, a.verschoben], ["inbox-notiz-a", "inbox", head, SEITE, "00_inbox/notiz-a.md", "90_archiv/inbox-eingearbeitet/notiz-a.md"]);
  assert.deepEqual(a.seiten, [SEITE]);
  const rot = ctx.aktionen.find((x) => x.stufe === "pflege-verworfen");
  assert.deepEqual([rot.id, rot.grund], ["konsolidieren-orion", "pruefung-rot"]);
  assert.deepEqual([ctx.grund, ctx.probe, ctx.ohneKi], ["B2-Grund", false, false]);
  assert.equal(existsSync(join(v, ".logs", "ingest.lock")), false);
  assert.equal(git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length, 1);
  assert.equal(B3.pflegeTag(v).scharf, ctx.heute);
  const z = B3.pflegeBerichtZeilen(ctx).join("\n");
  assert.match(z, /^\n### Pflege \(B3\)\n- scharf · Sonnet 0\/3 · Haiku 0\/40/);
  assert.match(z, /- Inbox eingearbeitet: notiz-a\.md → 09_wiki\/wissen\/orion\.md \([0-9a-f]{8}\) \[inbox-notiz-a\]/);
  assert.match(z, /- nicht übernommen — Konsolidieren orion: Commit-Prüfung/);
  assert.match(z, /brain zurueck \d{8}-\d{6}/);
});

test("zweiter Lauf am selben Tag: nichts (Kostenschleife); am nächsten Tag wieder", async () => {
  const v = vault();
  const aufrufe = [];
  await B3.b3Schritte(pflegeCtx(v), { schritte: stubs(aufrufe) });
  const n = aufrufe.length;
  assert.deepEqual(await B3.b3Schritte(pflegeCtx(v, { jetzt: JETZT + 3600e3 }), { schritte: stubs(aufrufe) }), { lauf: false, grund: "heute-schon" });
  assert.equal(aufrufe.length, n);
  assert.equal((await B3.b3Schritte(pflegeCtx(v, { jetzt: JETZT + 86400e3 }), { schritte: stubs(aufrufe) })).lauf, true);
});

test("Schalter probe: Einheiten in der Kopie, kein Merge, kein nachMerge, Aktion mit probe; Vault unverändert; Tageslauf bleibt scharf", async () => {
  const v = vault("probe");
  const vorher = schnappschuss(v);
  const ctx = pflegeCtx(v);
  const hashes = [];
  assert.equal((await B3.b3Schritte(ctx, { schritte: stubs([], { nachMerge: hashes }) })).lauf, true);
  assert.equal(schnappschuss(v), vorher);
  assert.deepEqual(hashes, []);
  const a = ctx.aktionen.find((x) => x.stufe === "pflege");
  assert.deepEqual([a.probe, a.commit], [true, null]);
  assert.match(a.kopieCommit, /^[0-9a-f]{40}$/);
  assert.equal(ctx.probe, false);
  assert.equal(B3.pflegeTag(v).probe, ctx.heute);
  assert.match(B3.pflegeBerichtZeilen(ctx).join("\n"), /- Probe \(nichts übernommen\)/);
});

test("Ingest-Sperre belegt (/ingest läuft) → nichts, Tages-Riegel bleibt frei, fremde Sperre unangetastet", async () => {
  const v = vault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "ingest.lock"), `ingest ${process.pid}\n`);   // lebender Prozess (eine tote PID gälte als veraltet)
  const aufrufe = [];
  assert.deepEqual(await B3.b3Schritte(pflegeCtx(v), { schritte: stubs(aufrufe) }), { lauf: false, grund: "ingest-laeuft" });
  assert.deepEqual(aufrufe, []);
  assert.equal(B3.pflegeTag(v).scharf, undefined);
  assert.equal(readFileSync(join(v, ".logs", "ingest.lock"), "utf8"), `ingest ${process.pid}\n`);
});

test("Ingest-Sperre belegt → Bericht nennt den Grund, Nachlauf-Marke für den nächsten Takt (Riegel scharf bleibt frei)", async () => {
  const v = vault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "ingest.lock"), `ingest ${process.pid}\n`);
  const ctx = pflegeCtx(v);
  await B3.b3Schritte(ctx, { schritte: stubs([]) });
  assert.match(B3.pflegeBerichtZeilen(ctx).join("\n"), /### Pflege \(B3\)\n- Pflege übersprungen: \/ingest lief gerade — Nachlauf beim nächsten stündlichen Takt/);
  assert.equal(B3.pflegeTag(v).nachlauf, ctx.heute);
  assert.equal(B3.pflegeTag(v).scharf, undefined);
  assert.equal(B3.pflegeNachlaufOffen(v, { pflegeIntelligenz: "an" }, ctx.heute), true);
  assert.equal(B3.pflegeNachlaufOffen(v, { pflegeIntelligenz: "aus" }, ctx.heute), false);
  assert.equal(B3.pflegeNachlaufOffen(v, { pflegeIntelligenz: "an" }, "2026-10-23"), false, "nur am selben Tag");
});

test("Einstellungen nicht lesbar → Bericht nennt den Grund; heute-schon bleibt still", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  ctx.werte = { ...ctx.werte, ernteOhneThema: "kaputt" };
  await B3.b3Schritte(ctx, { schritte: stubs([]) });
  assert.match(B3.pflegeBerichtZeilen(ctx).join("\n"), /- Pflege übersprungen: Einstellungen nicht lesbar/);
  const v2 = vault();
  await B3.b3Schritte(pflegeCtx(v2), { schritte: stubs([]) });
  const ctx2 = pflegeCtx(v2);
  assert.equal((await B3.b3Schritte(ctx2, { schritte: stubs([]) })).grund, "heute-schon");
  assert.doesNotMatch(B3.pflegeBerichtZeilen(ctx2).join("\n"), /übersprungen/);
});

test("veraltete Ingest-Sperre: eingetragener Prozess läuft nicht mehr → B3 übernimmt die Sperre und läuft", async () => {
  const v = vault();
  const tot = spawnSync(process.execPath, ["-e", "0"]).pid;                       // beendet → PID frei
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "ingest.lock"), `ingest ${tot}\n`);
  const aufrufe = [];
  assert.equal((await B3.b3Schritte(pflegeCtx(v), { schritte: stubs(aufrufe) })).lauf, true);
  assert.ok(aufrufe.includes("gut"));
});

test("Zeitbudget aufgebraucht → eigene Berichtszeile", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  const { neuesPflegeBudget } = await import("../tageslauf/pflege-ki.mjs");
  ctx.pflegeBudget = neuesPflegeBudget({ minuten: 0 });
  await B3.b3Schritte(ctx, { schritte: stubs([]) });
  assert.match(B3.pflegeBerichtZeilen(ctx).join("\n"), /- Pflege: Zeitbudget .* aufgebraucht/);
});

test("ohne KI: nur Schritte ohne KI; ein werfender Schritt stoppt die anderen nicht", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  ctx.ohneKi = true;
  const aufrufe = [];
  await B3.b3Schritte(ctx, { schritte: stubs(aufrufe) });
  assert.deepEqual(aufrufe, ["ohne"]);
  const v2 = vault();
  const ctx2 = pflegeCtx(v2);
  const aufrufe2 = [];
  const wirft = async () => { throw new Error("kaputt"); };
  assert.equal((await B3.b3Schritte(ctx2, { schritte: [["Entscheidungen", wirft, { ohneKi: true }], ...stubs(aufrufe2).slice(1)] })).lauf, true);
  assert.deepEqual(aufrufe2, ["gut", "rot"]);
  assert.ok(ctx2.aktionen.some((a) => a.stufe === "fehler" && /Pflege Entscheidungen: kaputt/.test(a.grund)));
});

test("b3Auftraege: K7 einmal je Tag; Pflege-Probe gibt keine Aufträge zurück; Drift-Hinweis zu Vorschlägen; Bericht nennt K7", () => {
  const v = vault();
  writeFileSync(join(v, "09_wiki", "_ausgemustert.md"), "# Ausgemustert\n\n- Altname → Neuname\n");
  legeVorschlagAn(v, { id: "v-1", titel: "Altname", text: "Altname läuft wieder." });
  const auftrag = { art: "feld", seite: SEITE, feld: "stand", wert: "2026-10-22", titel: "Projekt unverändert — stand verlängert", ref: "k7-x-stand" };
  let n = 0;
  const k7 = () => { n++; return { auftraege: [auftrag], rueckfragen: 1, archiv: { liste: ["09_wiki/wissen/alt.md"], zuJung: false } }; };
  const ctx = pflegeCtx(v);
  assert.deepEqual(B3.b3Auftraege(ctx, { k7 }), [auftrag]);
  assert.ok(ctx.aktionen.some((a) => a.stufe === "hinweis" && a.id === "v-1" && /drift: „Altname" → „Neuname"/.test(a.grund)));
  assert.deepEqual(B3.b3Auftraege(pflegeCtx(v, { jetzt: JETZT + 3600e3 }), { k7 }), []);
  assert.equal(n, 1);
  assert.match(B3.pflegeBerichtZeilen(ctx).join("\n"), /Prüfen nach Nutzung: 1 neue Rückfrage/);
  const ctxP = pflegeCtx(vault("probe"));
  assert.deepEqual(B3.b3Auftraege(ctxP, { k7 }), []);
  assert.equal(n, 2);
  assert.ok(ctxP.aktionen.some((a) => a.stufe === "hinweis" && /k7 \(Probe\): stand würde verlängert/.test(a.grund)));
});

test("b3Auftraege im Lernmodus: K7-Verlängerung wird nur gemeldet, nicht geschrieben (veraltet-Rückfragen bleiben)", () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  ctx.autostufe = "aus";
  const auftrag = { art: "feld", seite: SEITE, feld: "stand", wert: "2026-10-22", titel: "x", ref: "k7-x-stand" };
  assert.deepEqual(B3.b3Auftraege(ctx, { k7: () => ({ auftraege: [auftrag], rueckfragen: 2, archiv: { liste: [] } }) }), []);
  assert.ok(ctx.aktionen.some((a) => a.stufe === "hinweis" && /k7 \(Lernmodus\): stand würde verlängert/.test(a.grund)));
  assert.equal(ctx.pflegeInfo.k7.rueckfragen, 2);
});

test("Themen-Guard fail-closed: ohne lesbare Einstellungen läuft B3 nicht (kein Riegel, keine Sperre, kein Schritt)", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  const aufrufe = [];
  ctx.werte = { ...ctx.werte, ernteOhneThema: undefined };
  assert.deepEqual(await B3.b3Schritte(ctx, { schritte: stubs(aufrufe) }), { lauf: false, grund: "config" });
  const ctx2 = pflegeCtx(v);
  delete ctx2.werte;
  assert.deepEqual(await B3.b3Schritte(ctx2, { schritte: stubs(aufrufe) }), { lauf: false, grund: "aus" });   // ohne Werte gilt der Schalter als aus
  assert.deepEqual(aufrufe, []);
  assert.equal(B3.pflegeTag(v).scharf, undefined);
});

test("Lernmodus: nichts Inhaltliches wird gemergt — Vorschlag als markierte Rückfrage mit Diff; zweiter Tag fragt nicht noch einmal", async () => {
  const v = vault();
  const head = git(v, "rev-parse", "HEAD");
  const ctx = pflegeCtx(v);
  ctx.autostufe = "aus"; ctx.lernmodus = true;
  const aufrufe = [], hashes = [];
  const r = await B3.b3Schritte(ctx, { schritte: stubs(aufrufe, { nachMerge: hashes }) });
  assert.equal(r.lauf, true);
  assert.deepEqual(aufrufe, ["ohne", "gut:vorlegen", "rot"]);       // „rot“ ist hier ein Fehlschlag der Prüfung und kommt nicht als Frage
  assert.equal(git(v, "rev-parse", "HEAD"), head, "kein Commit auf main");
  assert.deepEqual(hashes, []);
  assert.equal(git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length, 1);
  const rf = R.listeRueckfragen(v);
  assert.equal(rf.length, 1);
  assert.deepEqual([rf[0].typ, rf[0].grund, rf[0].quelle, R.istAutostufeRueckfrage(rf[0]), rf[0].fm.pflege, rf[0].fm.pflege_sha], ["heikel", "autostufe-aus", R.AUTOSTUFE_QUELLE, true, "inbox:notiz-a.md", "sha-1"]);
  assert.match(rf[0].beschreibung, /\+Neu\./);
  assert.match(rf[0].beschreibung, /Lernmodus/);
  assert.equal(S.lernEintrag(v, "inbox:notiz-a.md").status, "vorgelegt");
  assert.ok(ctx.aktionen.some((a) => a.stufe === "pflege-vorschlag" && a.id === "inbox-notiz-a"));
  assert.ok(!ctx.aktionen.some((a) => a.stufe === "pflege"));
  const z = B3.pflegeBerichtZeilen(ctx).join("\n");
  assert.match(z, /Lernmodus \(nichts Inhaltliches ohne deine Freigabe\)/);
  assert.match(z, /- Vorschlag als Rückfrage: Inbox notiz-a\.md → /);
  // Tag 2: dieselbe Quelle ist schon vorgelegt → keine zweite Frage, kein Rechnen
  const aufrufe2 = [];
  await B3.b3Schritte(Object.assign(pflegeCtx(v, { jetzt: JETZT + 86400e3 }), { autostufe: "aus" }), { schritte: stubs(aufrufe2) });
  assert.ok(!aufrufe2.includes("gut:vorlegen") && !aufrufe2.includes("gut:freigaben"));
  assert.equal(R.listeRueckfragen(v).length, 1);
});

test("Lernmodus: „Übernehmen“ gibt die Einheit frei — der nächste Lauf merged sie; „Verwerfen“ legt sie ab", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  ctx.autostufe = "aus"; ctx.lernmodus = true;
  await B3.b3Schritte(ctx, { schritte: stubs([]) });
  const [rf] = R.listeRueckfragen(v);
  R.beantworte(v, rf.id, "uebernehmen");
  const c2 = pflegeCtx(v, { jetzt: JETZT + 86400e3 });
  const a = A.wendeAntwortenAn(c2);
  assert.equal(a.fehler, 0);
  assert.equal(S.lernEintrag(v, "inbox:notiz-a.md").status, "freigegeben");
  assert.ok(c2.aktionen.some((x) => x.stufe === "antwort" && /pflege-freigegeben/.test(x.grund)));
  // Der Rückweg-Zähler hat das Urteil als bestätigt gezählt
  const P2 = await import("../tageslauf/protokoll.mjs");
  assert.ok(P2.lesePruefungen(v).some((p) => p.art === "rueckweg" && p.quelle === R.AUTOSTUFE_QUELLE && p.fehler === false));
  const hashes = [], aufrufe = [];
  const c3 = pflegeCtx(v, { jetzt: JETZT + 2 * 86400e3 });
  c3.autostufe = "aus";
  await B3.b3Schritte(c3, { schritte: stubs(aufrufe, { nachMerge: hashes }) });
  assert.deepEqual(aufrufe.slice(0, 2), ["ohne", "gut:freigaben"]);
  assert.equal(hashes.length, 1, "freigegebene Einheit wurde gemergt");
  // (Der Stub lässt die Quelle stehen und wird deshalb im Vorlege-Durchgang erneut vorgeschlagen — echt ist die Notiz dann archiviert.)
  assert.notEqual(S.lernEintrag(v, "inbox:notiz-a.md")?.status, "freigegeben", "die Freigabe ist verbraucht");
  assert.match(git(v, "log", "-1", "--format=%s"), /^pflege\(.*\): inbox notiz-a\.md/);
});

test("Lernmodus: „Verwerfen“ zählt als Fehlurteil, die Einheit wird nicht wieder vorgelegt (gleiche Quelle)", async () => {
  const v = vault();
  const ctx = pflegeCtx(v);
  ctx.autostufe = "aus"; ctx.lernmodus = true;
  await B3.b3Schritte(ctx, { schritte: stubs([]) });
  R.beantworte(v, R.listeRueckfragen(v)[0].id, "verwerfen");
  const c2 = pflegeCtx(v, { jetzt: JETZT + 86400e3 });
  A.wendeAntwortenAn(c2);
  assert.equal(S.lernEintrag(v, "inbox:notiz-a.md").status, "abgelehnt");
  const P2 = await import("../tageslauf/protokoll.mjs");
  assert.ok(P2.lesePruefungen(v).some((p) => p.art === "rueckweg" && p.fehler === true));
  const aufrufe = [];
  const c3 = pflegeCtx(v, { jetzt: JETZT + 2 * 86400e3 });
  c3.autostufe = "aus";
  await B3.b3Schritte(c3, { schritte: stubs(aufrufe) });
  assert.ok(!aufrufe.some((x) => x.startsWith("gut")));
});
