// .tools/tests/test-pflege-vorschlag.mjs — B3 Lernmodus (Nachbesserung 2): was als Rückfrage vorgelegt wird, ist vollständig anzeigbar
// (Diff im ```diff-Block, Anzeige-Grenze ≥ Diff-Grenze), „Übernehmen“ ist an genau diese Rückfrage und den gesehenen Seitenstand gebunden,
// und im Freigabe-Durchgang rechnet nie eine KI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, fakeKi, JETZT } from "./tageslauf-hilfe.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
import { SEITEN as NS_SEITEN, pizza, ENTWURF, lauf as neueSeitenLauf } from "./neue-seiten-hilfe.mjs";
const B3 = await import("../tageslauf/b3.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const R = await import("../rueckfragen.mjs");
const S = await import("../tageslauf/pflege-stand.mjs");
const A = await import("../tageslauf/antworten.mjs");
const PA = await import("../tageslauf/pflege-patch.mjs");
const PR = await import("../tageslauf/protokoll.mjs");
const I = await import("../tageslauf/inbox-schritt.mjs");
const K = await import("../tageslauf/konsolidieren.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
isoliere();

const SEITE = "09_wiki/wissen/orion.md";
const orion = () => seite({ name: "orion", description: "Orion" }, `# Orion\n\n${Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1}.`).join("\n")}\n`);
const vault = (extra = {}) => neuerPflegeVault({ seiten: { [SEITE]: orion() }, automatik: { tageslauf: "an", pflegeIntelligenz: "an", ...extra } });
const lernCtx = (v, tage = 0) => Object.assign(pflegeCtx(v, { jetzt: JETZT + tage * 86400e3 }), { autostufe: "aus", lernmodus: true });

// Ein Schritt mit n Zeilen Zuwachs; quelle = Text der Quelle-Angabe im Protokoll (geht in die Rückfrage-Beschreibung).
function schritt(n, { quelle = "00_inbox/notiz-a.md", text = (i) => `Füllzeile ${String(i).padStart(3, "0")} mit etwas Text zum Füllen.`, aufrufe = [] } = {}) {
  const f = async (ctx, kopie) => {
    const l = ctx.pflegeLern;
    const lern = { schluessel: "inbox:notiz-a.md", sha: "sha-1", art: "inbox" };
    if (l && !l.nimm(lern.schluessel, lern.sha)) return [];
    aufrufe.push(l ? l.modus : "normal");
    const erg = await P.einheit(ctx, kopie, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
      arbeit: async (p) => { writeFileSync(join(p, SEITE), readFileSync(join(p, SEITE), "utf8") + Array.from({ length: n }, (_, i) => text(i)).join("\n") + "\n"); return { ok: true }; } });
    return [{ erg, ziel: SEITE, aktion: { quelle }, lern }];
  };
  return [["Inbox", f]];
}

test("Anzeige-Grenze der Rückfrage ist nie kleiner als die Diff-Grenze (Diff + Kopf/Fuß passen immer in die volle Anzeige)", () => {
  assert.ok(B3.MAX_DIFF_ZEICHEN + 2000 <= R.ANZEIGE_MAX_PFLEGE, `${B3.MAX_DIFF_ZEICHEN} + Rand muss ≤ ${R.ANZEIGE_MAX_PFLEGE} sein`);
});

test("Vorschlag knapp unter der Diff-Grenze: Rückfrage mit dem Diff im ```diff-Block, fuerSkill zeigt ihn vollständig und mit Optionen", async () => {
  const v = vault();
  const ctx = lernCtx(v);
  await B3.b3Schritte(ctx, { schritte: schritt(150) });
  const [rf] = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  assert.ok(rf, JSON.stringify(ctx.aktionen.filter((a) => /pflege/.test(a.stufe))));
  const roh = readFileSync(rf.datei, "utf8");
  assert.match(roh, /\n```diff\nDatei: 09_wiki\/wissen\/orion\.md\n@@ /);
  assert.match(roh, /\+Füllzeile 149 mit etwas Text zum Füllen\.\n```\n/, "der Diff endet im Block, der Block schließt direkt danach");
  assert.ok(rf.beschreibung.length > 5000 && rf.beschreibung.length <= R.ANZEIGE_MAX_PFLEGE);
  const s = R.fuerSkill(rf);
  assert.equal(s.vollstaendig, true);
  assert.equal(s.beschreibung, rf.beschreibung);
  assert.ok(s.beschreibung.includes("+Füllzeile 000") && s.beschreibung.includes("+Füllzeile 149"), "erste und letzte hinzugefügte Zeile sind da");
  assert.deepEqual(s.optionen.map((o) => o.wahl), ["uebernehmen", "verwerfen"]);
  assert.equal(s.optionen[0].wirkung, "Genau diese Änderung wird übernommen.");
});

test("Diff länger als die Diff-Grenze → keine Rückfrage („zu-gross“); sprengt schon die Beschreibung (z. B. riesiger Quellname) die Anzeige-Grenze → ebenfalls keine", async () => {
  const v = vault();
  const ctx = lernCtx(v);
  await B3.b3Schritte(ctx, { schritte: schritt(400) });
  assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.fm.pflege), []);
  assert.ok(ctx.aktionen.some((a) => a.stufe === "pflege-verworfen" && a.grund === "zu-gross"));
  const v2 = vault();
  const ctx2 = lernCtx(v2);
  await B3.b3Schritte(ctx2, { schritte: schritt(150, { quelle: `00_inbox/${"q".repeat(6000)}.md` }) });
  assert.deepEqual(R.listeRueckfragen(v2).filter((x) => x.fm.pflege), [], "lieber nicht vorlegen als gekürzt vorlegen");
  assert.ok(ctx2.aktionen.some((a) => a.stufe === "pflege-verworfen" && a.grund === "zu-gross"));
  assert.equal(git(v2, "rev-parse", "HEAD"), git(v2, "rev-parse", "main"));
});

test("Diff mit Backticks und Obsidian-Kommentaren: im Block unverändert, der Zaun bricht nie aus", async () => {
  const v = vault();
  const ctx = lernCtx(v);
  await B3.b3Schritte(ctx, { schritte: schritt(3, { text: (i) => ["```js", "%% versteckt? %%", "<!-- auch? -->"][i] }) });
  const [rf] = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  const roh = readFileSync(rf.datei, "utf8");
  assert.match(roh, /\n````diff\n/, "Zaun länger als die Backtick-Folge im Diff");
  assert.match(roh, /\+```js\n\+%% versteckt\? %%\n\+<!-- auch\? -->\n````\n/);
});

// --- Freigabe an die Rückfrage gebunden ----------------------------------------------------------------------------------------------------
const KEY = "inbox:notiz-a.md";
async function vorgelegt() {
  const v = vault();
  await B3.b3Schritte(lernCtx(v), { schritte: schritt(3) });
  const [rf] = R.listeRueckfragen(v).filter((x) => x.fm.pflege);
  return { v, rf };
}

test("Freigabe gilt nur für DIE Rückfrage, die der Lern-Eintrag trägt: Antwort auf eine ältere Rückfrage gibt nichts frei und zählt nicht", async () => {
  const { v, rf } = await vorgelegt();
  assert.equal(S.lernEintrag(v, KEY).rueckfrage, rf.id);
  S.aendereStand(pflegeCtx(v), (st) => { st.lern[KEY].rueckfrage = "rf-neuere-vorlage"; });   // die Einheit wurde inzwischen neu vorgelegt
  R.beantworte(v, rf.id, "uebernehmen");
  const c2 = pflegeCtx(v, { jetzt: JETZT + 86400e3 });
  assert.equal(A.wendeAntwortenAn(c2).fehler, 0);
  const e = S.lernEintrag(v, KEY);
  assert.deepEqual([e.status, e.rueckfrage], ["vorgelegt", "rf-neuere-vorlage"], "unverändert — nicht freigegeben");
  assert.ok(c2.aktionen.some((a) => a.stufe === "antwort" && /pflege-veraltet/.test(a.grund)), JSON.stringify(c2.aktionen));
  assert.equal(PR.lesePruefungen(v).filter((p) => p.art === "rueckweg").length, 0, "ein Urteil über etwas Veraltetes zählt nicht");
  assert.deepEqual(R.listeRueckfragen(v), [], "die Rückfrage ist erledigt (archiviert)");
});

test("Freigabe: Eintrag fehlt oder trägt eine andere Prüfsumme (sha) → nichts freigegeben, nie ein neuer Eintrag", async () => {
  const { v, rf } = await vorgelegt();
  S.aendereStand(pflegeCtx(v), (st) => { delete st.lern[KEY]; });
  R.beantworte(v, rf.id, "uebernehmen");
  A.wendeAntwortenAn(pflegeCtx(v, { jetzt: JETZT + 86400e3 }));
  assert.equal(S.lernEintrag(v, KEY), null, "kein Eintrag aus dem Nichts");
  const w = await vorgelegt();
  S.aendereStand(pflegeCtx(w.v), (st) => { st.lern[KEY].sha = "ein-anderer-inhalt"; });
  R.beantworte(w.v, w.rf.id, "verwerfen");
  A.wendeAntwortenAn(pflegeCtx(w.v, { jetzt: JETZT + 86400e3 }));
  assert.equal(S.lernEintrag(w.v, KEY).status, "vorgelegt", "auch „Verwerfen“ wirkt nur auf die eigene Version");
  assert.equal(S.lernEintrag(w.v, KEY).sha, "ein-anderer-inhalt");
});

test("Freigabe passt zur Rückfrage: Antwort auf die eigene Rückfrage gibt frei (bisheriges Verhalten bleibt)", async () => {
  const { v, rf } = await vorgelegt();
  R.beantworte(v, rf.id, "uebernehmen");
  A.wendeAntwortenAn(pflegeCtx(v, { jetzt: JETZT + 86400e3 }));
  assert.equal(S.lernEintrag(v, KEY).status, "freigegeben");
  const stand = S.leseStand(v);
  assert.ok(PA.freigabePatch(v, KEY, "sha-1", stand));
  S.aendereStand(pflegeCtx(v), (st) => { st.lern[KEY].rueckfrage = "rf-fremd"; });         // Patch gehört nicht zur Rückfrage des Eintrags
  assert.equal(PA.freigabePatch(v, KEY, "sha-1", S.leseStand(v)), null);
});

// --- Im Freigabe-Durchgang rechnet nie eine KI ---------------------------------------------------------------------------------------------
const OHNE_PATCH = { modus: "freigaben", nurKi: false, nimm: () => true, patch: () => null };

test("Inbox im Freigabe-Durchgang ohne gültigen Patch: keine KI, Einheit abgebrochen (patch-nicht-anwendbar), kein Versuch gezählt", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: orion() }, inbox: { "notiz-a.md": "# A\n\nOrion nutzt Redis.\n" } });
  const s = fakeSonnet([{ wenn: "QUELLE:", antwort: '{"ziel":"30_wissen/n.md","seiten":["09_wiki/wissen/orion.md"],"kurz":"x"}', anhaengen: { [SEITE]: "Orion nutzt Redis.\n" } }]);
  const ctx = lernCtx(v);
  ctx.pflegeLern = OHNE_PATCH;
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try {
    const posten = await I.inboxSchritt(ctx, kopie);
    assert.equal(s.anzahl(), 0, "keine KI");
    assert.equal(posten.length, 1);
    assert.deepEqual([posten[0].erg.ok, posten[0].erg.grund], [false, "patch-nicht-anwendbar"]);
    assert.equal(posten[0].lern.schluessel, KEY);
    assert.equal(S.leseStand(v).inbox, undefined, "kein Versuch gezählt");
    assert.equal(git(kopie.pfad, "rev-parse", "HEAD"), kopie.kopf, "kein Commit");
  } finally { verwerfeArbeitskopie(v, kopie); }
});

const KS = "09_wiki/wissen/kaffee.md";
const KFM = { name: "kaffee", description: "Kaffee" };
const KFAKTEN = [["Die Mühle hat 40 Mahlstufen", "01.10"], ["Der Espresso läuft 25 Sekunden", "02.10"], ["Die Maschine braucht keinen Wasserfilter", "03.10"],
  ["Der Kessel fasst 1,8 Liter", "04.10"], ["Die Brühtemperatur liegt bei 93 Grad", "05.10"]].map(([t, d], i) => `- ${t} · Stand ${d}.2026 · [[30_wissen/belege/2026-10/k${i}]]`);
const KVORHER = seite(KFM, `# Kaffee\n\n## Fakten\n\n${KFAKTEN.join("\n")}\n`);

test("Konsolidieren im Freigabe-Durchgang ohne gültigen Patch: keine KI, abgebrochen, Stand „konsolidiert“ unberührt", async () => {
  const v = neuerPflegeVault({ seiten: { [KS]: KVORHER } });
  const s = fakeSonnet([{ wenn: "SEITE:", antwort: '{"ok":true}', anhaengen: { [KS]: "x\n" } }]);
  const h = fakeKi([], { standard: '{"drin":"ja"}' });
  const ctx = lernCtx(v);
  ctx.pflegeLern = OHNE_PATCH;
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try {
    const posten = await K.konsolidierSchritt(ctx, kopie);
    assert.equal(s.anzahl() + h.anzahl(), 0, "keine KI");
    assert.equal(posten.length, 1);
    assert.deepEqual([posten[0].erg.ok, posten[0].erg.grund], [false, "patch-nicht-anwendbar"]);
    assert.equal(S.leseStand(v).konsolidiert, undefined);
    assert.equal(git(kopie.pfad, "rev-parse", "HEAD"), kopie.kopf);
  } finally { verwerfeArbeitskopie(v, kopie); }
});

test("Neue Seiten im Freigabe-Durchgang ohne gültigen Patch: kein Entwurf von Haiku, abgebrochen, Häufung nicht als „versucht“ vermerkt", async () => {
  const v = neuerPflegeVault({ seiten: NS_SEITEN });
  pizza(v);
  const h = fakeKi([], { standard: JSON.stringify(ENTWURF) });
  const r = await neueSeitenLauf(v, { autostufe: "aus", vorab: (c) => { c.pflegeLern = OHNE_PATCH; } });
  try {
    assert.equal(h.anzahl(), 0, "keine KI");
    assert.equal(r.posten.length, 1);
    assert.deepEqual([r.posten[0].erg.ok, r.posten[0].erg.grund], [false, "patch-nicht-anwendbar"]);
    assert.match(r.posten[0].lern.schluessel, /^neue-seite:/);
    assert.equal(S.leseStand(v).haeufungen, undefined, "kein Versuch vermerkt");
  } finally { verwerfeArbeitskopie(v, r.kopie); }
});

// --- Offene Sicherheits-Rückfrage hält die Freigaben an ------------------------------------------------------------------------------------
test("Offene Integritäts-Rückfrage: Durchgang 1 (Freigaben anwenden) setzt aus, Bericht nennt den Grund; nach „Geprüft“ wird die Freigabe übernommen", async () => {
  const { v, rf } = await vorgelegt();
  R.beantworte(v, rf.id, "uebernehmen");
  A.wendeAntwortenAn(pflegeCtx(v, { jetzt: JETZT + 3600e3 }));
  assert.equal(S.lernEintrag(v, KEY).status, "freigegeben");
  const warn = R.legeRueckfrageAn(pflegeCtx(v, { jetzt: JETZT + 2 * 3600e3 }), { typ: "integritaet", frage: "Integrität verletzt: .git/hooks", grund: "integritaet", beschreibung: "Betroffen: .git/hooks" });
  const head = git(v, "rev-parse", "HEAD");
  // Tag 2: Warnung offen → nichts angewendet
  const aufrufe = [];
  const ctx2 = lernCtx(v, 1);
  await B3.b3Schritte(ctx2, { schritte: schritt(3, { aufrufe }) });
  assert.ok(!aufrufe.includes("freigaben"), `Freigaben dürfen nicht laufen: ${aufrufe}`);
  assert.equal(git(v, "rev-parse", "HEAD"), head, "kein Merge");
  assert.equal(S.lernEintrag(v, KEY).status, "freigegeben", "die Freigabe bleibt bestehen");
  assert.match(B3.pflegeBerichtZeilen(ctx2).join("\n"), /- Freigaben nicht angewendet: .*Sicherheits-Rückfrage.* offen/);
  assert.ok(ctx2.aktionen.some((a) => a.stufe === "hinweis" && /Freigaben nicht angewendet/.test(a.grund)));
  // „Später“ wird zurückgenommen (die Warnung bleibt offen und laut) → am nächsten Tag weiter ausgesetzt
  R.beantworte(v, warn, "spaeter");
  A.wendeAntwortenAn(pflegeCtx(v, { jetzt: JETZT + 2 * 86400e3 }));
  const aufrufe3 = [];
  await B3.b3Schritte(lernCtx(v, 2), { schritte: schritt(3, { aufrufe: aufrufe3 }) });
  assert.ok(!aufrufe3.includes("freigaben"));
  // „Geprüft“ → Rückfrage erledigt → die Freigabe wird angewendet
  R.beantworte(v, warn, "geprueft");
  A.wendeAntwortenAn(pflegeCtx(v, { jetzt: JETZT + 3 * 86400e3 }));
  assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.typ === "integritaet"), []);
  const aufrufe4 = [], hashes = [];
  await B3.b3Schritte(lernCtx(v, 3), { schritte: schritt(3, { aufrufe: aufrufe4 }) });
  assert.ok(aufrufe4.includes("freigaben"), `jetzt laufen die Freigaben: ${aufrufe4}`);
  assert.notEqual(git(v, "rev-parse", "HEAD"), head, "gemergt");
  void hashes;
});

test("Integritäts-Rückfrage offen, aber kein Lernmodus: B3 läuft wie bisher (die Regel betrifft nur das Anwenden von Freigaben)", async () => {
  const v = vault();
  R.legeRueckfrageAn(pflegeCtx(v), { typ: "integritaet", frage: "Integrität verletzt: x", grund: "integritaet", beschreibung: "Betroffen: x" });
  const aufrufe = [];
  const ctx = pflegeCtx(v, { jetzt: JETZT + 86400e3 });
  await B3.b3Schritte(ctx, { schritte: schritt(2, { aufrufe }) });
  assert.deepEqual(aufrufe, ["normal"]);
  assert.doesNotMatch(B3.pflegeBerichtZeilen(ctx).join("\n"), /Freigaben nicht angewendet/);
});
