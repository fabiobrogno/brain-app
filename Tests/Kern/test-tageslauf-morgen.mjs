// .tools/tests/test-tageslauf-morgen.mjs — Sitzungsstart-Zeile, allgemeine Lektionen, Status, Inbox-Systemordner (B2, Task 13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, legeVorschlagAn, FAKE_BEFEHL, JETZT, KIT } from "./tageslauf-hilfe.mjs";
import { hook, tempOrdner } from "./verlauf-fixture.mjs";
const M = await import("../tageslauf/morgen.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
const { allgemeineLektionen } = await import("../regeln.mjs");
const { brainStatus } = await import("../status.mjs");
isoliere();
const TAG = 86400e3;
// Mittags-Zeiten: das Kurzdatum „21.10.“ ist dann in jeder Zeitzone gleich.
const letzter = (extra = {}) => ({ lauf: "20261021-120000", zeit: "2026-10-21T12:00:00Z", modus: "an", art: "voll", status: "ok", erfolgreich: true,
  letzterErfolg: "2026-10-21T12:00:00Z", zahlen: { uebernommen: 7, aussortiert: 31, rueckfragenNeu: 3, rueckfragen: 3 }, fehlerquote: { fehler: 0, geprueft: 12 }, autostufe: "normal", ...extra });

test("morgenZeile: scharf wie in der Spec; Rückfragen live gezählt; Autostufe und > 3 Tage ohne Erfolg stehen dabei", () => {
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 } });   // ohne Einschwingphase — die Spec-Zeile unverändert (Phase: unten)
  P.schreibeLetzter(v, letzter());
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  for (let i = 0; i < 3; i++) R.legeRueckfrageAn(ctx, { typ: "heikel", frage: `F${i}` });
  assert.equal(M.morgenZeile(v, { jetzt: JETZT }), "Brain hat gelernt (21.10.): 7 übernommen · 31 aussortiert · 3 Rückfragen offen — „Rückfragen“ sagen · Fehlerquote 0/12");
  P.schreibeLetzter(v, letzter({ autostufe: "eng", letzterErfolg: "2026-10-17T03:00:00Z", status: "ohne-ki", grund: "claude nicht gefunden" }));
  const z = M.morgenZeile(v, { jetzt: JETZT });
  assert.match(z, /Autostufe eng/);
  assert.match(z, /seit 5 Tagen kein erfolgreicher Lauf \(claude nicht gefunden\)/);
});

test("morgenZeile: Probe-Variante; aus oder noch kein Lauf → null", () => {
  const v = neuerTestVault({ automatik: {} });
  assert.equal(M.morgenZeile(v, { jetzt: JETZT }), null);
  P.schreibeLetzter(v, letzter({ modus: "probe" }));
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /^Brain-Probelauf \(21\.10\.\): würde 7 übernehmen · 31 aussortieren · 3 Rückfragen stellen — nichts geändert/);
  const aus = neuerTestVault({ automatik: { tageslauf: "aus" } });
  P.schreibeLetzter(aus, letzter());
  assert.equal(M.morgenZeile(aus, { jetzt: JETZT }), null);
});

// --- Einschwingphase: „Einschwingen R/N geprüft“ in der Morgenzeile (Zustand: aktionen.jsonl + pruefungen.jsonl, kein Zähler) -----------------
const jsonl = (v, name, liste) => { mkdirSync(P.TL_DIR(v), { recursive: true }); writeFileSync(join(P.TL_DIR(v), name), liste.map((x) => JSON.stringify(x)).join("\n") + "\n"); };
const ZIEL = "09_wiki/projekte/entitaet_orion.md";
// r richtig beantwortet, f falsch beantwortet, o offen — jeweils als Einschwing-Übernahme (einschwingen: true) mit der Antwort in den Prüfungen.
function phase(v, { r = 0, f = 0, o = 0 } = {}) {
  const ids = (n, vor) => Array.from({ length: n }, (_, i) => `${vor}${i + 1}`);
  const [richtig, falsch, offen] = [ids(r, "r"), ids(f, "f"), ids(o, "o")];
  jsonl(v, "aktionen.jsonl", [...richtig, ...falsch, ...offen].map((id) => ({ lauf: "20261020-030000", zeit: "2026-10-20T03:00:00.000Z", id, stufe: "uebernehmen", ziel: ZIEL, commit: id.padEnd(40, "0"), auto: true, einschwingen: true })));
  jsonl(v, "pruefungen.jsonl", [...richtig.map((id) => ({ zeit: "2026-10-21T03:00:00.000Z", art: "stichprobe", quelle: "einschwingen", fehler: false, ref: `rf-${id}`, aktion: id })),
    ...falsch.map((id) => ({ zeit: "2026-10-21T03:00:00.000Z", art: "stichprobe", quelle: "einschwingen", fehler: true, ref: `rf-${id}`, aktion: id }))]);
  return v;
}
const mitPhase = (n, zustand, tageslauf = "an") => phase(neuerTestVault({ automatik: { tageslauf, einschwingen: n } }), zustand);

test("morgenZeile: während der Einschwingphase steht „Einschwingen R/N geprüft“ dabei (R = beantwortet „stimmt“), danach nicht mehr", () => {
  const v = mitPhase(20, { r: 3 });
  P.schreibeLetzter(v, letzter());
  const z = M.morgenZeile(v, { jetzt: JETZT });
  assert.match(z, /^Brain hat gelernt \(21\.10\.\): 7 übernommen/);
  assert.match(z, / · Einschwingen 3\/20 geprüft(?: · |$)/);
  phase(v, { r: 19 });
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /Einschwingen 19\/20 geprüft/);
  phase(v, { r: 20 });
  assert.doesNotMatch(M.morgenZeile(v, { jetzt: JETZT }), /Einschwingen/, "bei R = N ist die Phase vorbei, die Zeile verschwindet");
  phase(v, { r: 35 });
  assert.doesNotMatch(M.morgenZeile(v, { jetzt: JETZT }), /Einschwingen/);
});

test("morgenZeile: „· O offen“ nur bei O > 0, „· F falsch“ nur bei F > 0, „— Automatik wartet auf deine Prüfung“ nur bei frei = 0 und O > 0", () => {
  const zeile = (n, zustand) => { const v = mitPhase(n, zustand); P.schreibeLetzter(v, letzter()); return M.morgenZeile(v, { jetzt: JETZT }); };
  assert.match(zeile(20, { r: 3 }), /Einschwingen 3\/20 geprüft(?! ·| —)/);
  assert.match(zeile(20, { r: 3, o: 4 }), /Einschwingen 3\/20 geprüft · 4 offen(?! ·| —)/);
  assert.match(zeile(20, { r: 3, f: 2 }), /Einschwingen 3\/20 geprüft · 2 falsch(?! —)/);
  assert.match(zeile(20, { r: 3, o: 4, f: 1 }), /Einschwingen 3\/20 geprüft · 4 offen · 1 falsch(?! —)/);
  assert.match(zeile(20, { o: 10 }), /Einschwingen 0\/20 geprüft · 10 offen — Automatik wartet auf deine Prüfung/, "Deckel: kein Platz frei");
  assert.match(zeile(5, { r: 2, o: 3 }), /Einschwingen 2\/5 geprüft · 3 offen — Automatik wartet auf deine Prüfung/, "R + O = N: kein Platz frei");
  assert.match(zeile(20, { r: 2, o: 3, f: 1 }), /Einschwingen 2\/20 geprüft · 3 offen · 1 falsch(?! —)/, "es sind noch Plätze frei");
  assert.doesNotMatch(zeile(20, { r: 2, o: 3 }), /Automatik wartet/);
});

test("morgenZeile: Standard ist 20; einschwingen 0 schaltet die Phase (und die Zeile) ab; kaputte oder fehlende Dateien → 0/N", () => {
  const v = neuerTestVault({ automatik: { tageslauf: "an" } });
  P.schreibeLetzter(v, letzter());
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /Einschwingen 0\/20 geprüft/, "Dateien fehlen → 0/20 (Standard)");
  jsonl(v, "aktionen.jsonl", []);
  writeFileSync(join(P.TL_DIR(v), "aktionen.jsonl"), "{kaputt\n");
  writeFileSync(join(P.TL_DIR(v), "pruefungen.jsonl"), "\u0000\n[1]\n");
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /Einschwingen 0\/20 geprüft/, "kaputt → 0, die Zeile erscheint trotzdem");
  const aus = mitPhase(0, { r: 2, o: 3 });
  P.schreibeLetzter(aus, letzter());
  assert.doesNotMatch(M.morgenZeile(aus, { jetzt: JETZT }), /Einschwingen/);
  const klein = mitPhase(5, { r: 2 });
  P.schreibeLetzter(klein, letzter());
  assert.match(M.morgenZeile(klein, { jetzt: JETZT }), /Einschwingen 2\/5 geprüft/);
});

test("morgenZeile: im Probemodus keine Einschwing-Angabe (dort wird nie gezählt) — der Probe-Hinweis nennt die Phase aber", () => {
  const v = mitPhase(20, { r: 3 }, "probe");
  P.schreibeLetzter(v, letzter({ modus: "probe" }));
  const z = M.morgenZeile(v, { jetzt: JETZT });
  assert.doesNotMatch(z, /Einschwingen \d/);
  assert.match(z, /die ersten 20 Übernahmen prüfst du dann einzeln/, "ersetzt das alte Tor „20 zufällige im Probelauf müssen stimmen“");
  const v0 = neuerTestVault({ automatik: { tageslauf: "probe", einschwingen: 0 } });
  P.schreibeLetzter(v0, letzter({ modus: "probe" }));
  assert.doesNotMatch(M.morgenZeile(v0, { jetzt: JETZT }), /einzeln/, "Phase aus → kein Hinweis darauf");
  const v7 = neuerTestVault({ automatik: { tageslauf: "probe", einschwingen: 7 } });
  P.schreibeLetzter(v7, letzter({ modus: "probe" }));
  assert.match(M.morgenZeile(v7, { jetzt: JETZT }), /die ersten 7 Übernahmen/);
});

test("morgenZeile: ohne Tageslauf-Zeile (aus / noch kein Lauf / Modus passt nicht) bleibt sie null — die Einschwing-Angabe kommt dann aus einschwingZeile", () => {
  const aus = neuerTestVault({ automatik: { tageslauf: "aus" } });
  P.schreibeLetzter(aus, letzter());
  assert.equal(M.morgenZeile(aus, { jetzt: JETZT }), null);
  assert.equal(M.einschwingZeile(aus), null, "Schalter aus → nichts");
  const nie = mitPhase(20, { r: 2, o: 1 });
  assert.equal(M.morgenZeile(nie, { jetzt: JETZT }), null);
  assert.equal(M.einschwingZeile(nie), "Brain: Einschwingen 2/20 geprüft · 1 offen", "Schalter an, noch kein Lauf: eigene Zeile");
  const falsch = mitPhase(20, { r: 0 });
  P.schreibeLetzter(falsch, letzter({ modus: "probe" }));
  assert.equal(M.morgenZeile(falsch, { jetzt: JETZT }), null, "letzter Lauf war Probe, Schalter jetzt an: Sitzungsstart bleibt wie bisher (Zähler für Vorschläge)");
  assert.equal(M.einschwingZeile(falsch), "Brain: Einschwingen 0/20 geprüft");
  assert.equal(M.einschwingZeile(mitPhase(20, { r: 20 })), null, "Phase vorbei");
  assert.equal(M.einschwingZeile(mitPhase(0, { o: 2 })), null, "0 = aus");
  assert.equal(M.einschwingZeile(mitPhase(20, { r: 1 }, "probe")), null, "Probe: keine Einschwing-Zeile");
});

test("Sitzungsstart: die Morgenzeile zeigt „Einschwingen R/N geprüft“ solange die Phase läuft, danach nicht mehr", () => {
  const v = mitPhase(20, { r: 3, o: 2 });
  P.schreibeLetzter(v, letzter());
  const start = () => hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;
  assert.match(start(), /Brain hat gelernt \(21\.10\.\).*Einschwingen 3\/20 geprüft · 2 offen/);
  phase(v, { r: 20 });
  const danach = start();
  assert.match(danach, /Brain hat gelernt \(21\.10\.\)/);
  assert.doesNotMatch(danach, /Einschwingen/);
});

test("Sitzungsstart: Schalter an, noch kein Lauf → die Einschwing-Zeile steht allein, die Vorschlags- und Lektionszähler bleiben unberührt", () => {
  const v = mitPhase(20, { r: 0 });
  legeVorschlagAn(v, { id: "v1" });
  legeVorschlagAn(v, { id: "l1", art: "lektion", titel: "L" });
  const aus = startNurStatus(v);
  assert.match(aus, /Brain: Einschwingen 0\/20 geprüft/);
  assert.match(aus, /1 neuer Vorschlag/, "Zähler nicht ersetzt");
  assert.match(aus, /1 Lektion wartet/);
  assert.doesNotMatch(aus, /Brain hat gelernt/);
  const probe = mitPhase(20, { r: 0 }, "probe");
  legeVorschlagAn(probe, { id: "v1" });
  assert.doesNotMatch(startNurStatus(probe), /Einschwingen \d/, "Probe: keine Einschwing-Zeile");
  const aus2 = mitPhase(20, { r: 0 }, "aus");
  assert.doesNotMatch(startNurStatus(aus2), /Einschwingen/);
});

test("allgemeineLektionen: nur ohne „Gilt für“, neueste zuerst, ganze Zeilen bis 600 Zeichen, nie mit Zugangsdaten", () => {
  const v = neuerTestVault();
  const lang = "x".repeat(250);
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), ["# Lektionen", "",
    "- **Alt** — Erst lesen, dann schreiben.", "  Warum: w",
    "- **Datei** — Nur für mjs.", "  Gilt für: `*.mjs`",
    `- **Lang1** — ${lang}`, `- **Lang2** — ${lang}`,
    `- **Geheim** — Nutze ${["pass", "word"].join("")}=Koeder123`,
    "- **Neu** — Immer Tests zuerst.", ""].join("\n"));
  const l = allgemeineLektionen(v);
  assert.equal(l[0], "- **Neu** — Immer Tests zuerst.");
  assert.ok(!l.some((z) => /Datei|Geheim|Koeder/.test(z)));
  assert.ok(l.join("\n").length <= 600);
  assert.ok(!l.includes("- **Alt** — Erst lesen, dann schreiben."), "passt nicht mehr ins Budget");
});

test("Sitzungsstart: scharf → eine Zeile statt der Vorschlags-/Lektionszähler; Probe → zusätzlich; _warten/_rueckfragen nie Inbox", () => {
  const v = neuerTestVault();
  P.schreibeLetzter(v, letzter());
  legeVorschlagAn(v, { id: "v1" });
  legeVorschlagAn(v, { id: "l1", art: "lektion", titel: "L" });
  legeVorschlagAn(v, { id: "w1", unterordner: "_warten" });
  mkdirSync(join(v, "00_inbox", "_rueckfragen"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "_rueckfragen", "rf-x.md"), "---\ntyp: rueckfrage\nart: heikel\n---\n# ?\n");
  const start = () => hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;
  let aus = start();
  assert.match(aus, /Brain hat gelernt \(21\.10\.\)/);
  assert.doesNotMatch(aus, /neuer Vorschlag|Lektion wartet|Brain-Inbox/);
  const cfg = JSON.parse(readFileSync(join(v, "brain.config.json"), "utf8"));
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ...cfg, automatik: { tageslauf: "probe" } }));
  P.schreibeLetzter(v, letzter({ modus: "probe" }));
  aus = start();
  assert.match(aus, /Brain-Probelauf/);
  assert.match(aus, /1 neuer Vorschlag/);
});

test("status --json: tageslauf-Block und zahlen.rueckfragen", async () => {
  const v = neuerTestVault();
  P.schreibeLetzter(v, letzter());
  const s = await brainStatus(v, { jetzt: JETZT });
  assert.equal(s.zahlen.rueckfragen, 0);
  assert.deepEqual([s.tageslauf.schalter, s.tageslauf.status, s.tageslauf.autostufe], ["an", "ok", "normal"]);
});

test("brain-lint zählt _warten und _rueckfragen nicht als unverarbeitete Inbox", () => {
  const v = neuerTestVault();
  legeVorschlagAn(v, { id: "w1", unterordner: "_warten" });
  mkdirSync(join(v, "00_inbox", "_rueckfragen"), { recursive: true });
  const r = spawnSync(process.execPath, [join(KIT, "brain-lint.mjs"), v], { encoding: "utf8" });
  assert.doesNotMatch(r.stdout, /INBOX|_warten|_rueckfragen/);
});

// ---------- Ergänzungen (Sonderfälle der Sitzungsstart-Zeile) ----------
const startNurStatus = (v) => hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;

test("morgenZeile: Betriebsart des letzten Laufs muss zum Schalter passen (sonst null, nichts Falsches)", () => {
  const v = neuerTestVault({ automatik: { tageslauf: "an" } });
  P.schreibeLetzter(v, letzter({ modus: "probe" }));
  assert.equal(M.morgenZeile(v, { jetzt: JETZT }), null, "Schalter an, letzter Lauf nur Probe → noch nichts zu melden");
  const probe = neuerTestVault({ automatik: { tageslauf: "probe" } });
  P.schreibeLetzter(probe, letzter({ modus: "an" }));
  assert.equal(M.morgenZeile(probe, { jetzt: JETZT }), null, "Schalter zurück auf Probe → alter scharfer Lauf wird nicht mehr als aktuell gezeigt");
});

test("morgenZeile: eine einzige Zeile, kurz; wirft nie bei kaputter letzter.json", () => {
  const v = neuerTestVault();
  P.schreibeLetzter(v, letzter());
  const z = M.morgenZeile(v, { jetzt: JETZT });
  assert.ok(!z.includes("\n") && z.length < 190, z);   // Standard 20: „· Einschwingen 0/20 geprüft“ kommt dazu
  writeFileSync(join(v, ".logs", "tageslauf", "letzter.json"), "{kaputt");
  assert.equal(M.morgenZeile(v, { jetzt: JETZT }), null);
});

test("Sitzungsstart: Schalter aus → alles wie heute (alte Zähler da, keine Tageslauf-Zeile, keine neuen Regeln)", () => {
  const v = neuerTestVault({ automatik: { tageslauf: "aus" } });
  P.schreibeLetzter(v, letzter());
  legeVorschlagAn(v, { id: "v1" });
  legeVorschlagAn(v, { id: "v2" });
  legeVorschlagAn(v, { id: "l1", art: "lektion", titel: "L" });
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), "# Lektionen\n\n- **Immer** — Tests zuerst.\n");
  const aus = startNurStatus(v);
  assert.match(aus, /2 neue Vorschläge — im Gehirn prüfen/);
  assert.match(aus, /1 Lektion wartet auf Übernahme/);
  assert.doesNotMatch(aus, /Brain hat gelernt|Brain-Probelauf|Brain-Regeln \(allgemein\)/);
});

test("Sitzungsstart: Schalter an, aber noch kein scharfer Lauf → alte Zähler bleiben (nichts verschwindet ohne Ersatz)", () => {
  const v = neuerTestVault({ automatik: { tageslauf: "an" } });
  legeVorschlagAn(v, { id: "v1" });
  let aus = startNurStatus(v);
  assert.match(aus, /1 neuer Vorschlag/);
  assert.doesNotMatch(aus, /Brain hat gelernt/);
  P.schreibeLetzter(v, letzter({ modus: "probe" }));
  aus = startNurStatus(v);
  assert.match(aus, /1 neuer Vorschlag/, "nur ein Probelauf vorhanden → nichts ersetzt");
  assert.doesNotMatch(aus, /Brain-Probelauf|Brain hat gelernt/);
});

test("Sitzungsstart: allgemeine Lektionen als eigener Block (nur ohne „Gilt für“), Zugangsdaten nie", () => {
  const v = neuerTestVault();
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), ["# Lektionen", "", "- **Datei** — Nur für mjs.", "  Gilt für: `*.mjs`",
    `- **Geheim** — Nutze ${["pass", "word"].join("")}=Koeder123`, "- **Allgemein** — Immer Tests zuerst.", ""].join("\n"));
  const aus = startNurStatus(v);
  assert.match(aus, /Brain-Regeln \(allgemein\):\n- \*\*Allgemein\*\* — Immer Tests zuerst\./);
  assert.doesNotMatch(aus, /Nur für mjs|Koeder123/);
});

test("Sitzungsstart-Hook: Tageslauf-Zeile kostet nichts Spürbares (Rückfragen live, ohne hint.log)", () => {
  const v = neuerTestVault();
  P.schreibeLetzter(v, letzter());
  writeFileSync(join(v, ".logs", "hint.log"), "2026-10-20T10:00:00 x hits=09_wiki/a.md\n".repeat(20000));
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  for (let i = 0; i < 12; i++) R.legeRueckfrageAn(ctx, { typ: "heikel", frage: `F${i}` });
  const t0 = Date.now();
  const z = M.morgenZeile(v, { jetzt: JETZT });
  assert.match(z, /12 Rückfragen offen/);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

test("Rückfall-Start: Sitzungsstart stößt den Lauf nur losgelöst im Hintergrund an (Schalter aus → gar nicht, NUR_STATUS → gar nicht)", async () => {
  const marke = join(tempOrdner("marke"), "gestartet.txt");
  const skript = join(tempOrdner("skript"), "lauf.mjs");
  writeFileSync(skript, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marke)}, process.argv.slice(2).join(" ") + "\\n");\n`);
  const bereit = async (ms = 4000) => { const ende = Date.now() + ms; while (Date.now() < ende && !existsSync(marke)) await new Promise((r) => setTimeout(r, 50)); return existsSync(marke); };
  // Der Sitzungsstart startet losgelöst session-hintergrund (Index, Lint, …) und, wenn fällig, wirkung.mjs. Beide schreiben in den Vault,
  // den setup.mjs beim Prozessende löscht — kämen sie erst danach, legten sie ihn neu an (Temp-Rest). Darum: Wirkungsmessung per Marke
  // abschalten und warten, bis der Hintergrund durch ist (Lint-Cache = sein letzter Schritt bei diesem kleinen Vault, Rest per Schalter aus).
  const mitHintergrund = (v) => {
    mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", "wirkung.laeuft"), "");
    return hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_TAGESLAUF_SKRIPT: skript } });
  };
  const hintergrundFertig = async (v, ms = 20000) => {
    const lint = join(v, ".logs", "lint-cache.txt"), ende = Date.now() + ms;
    while (Date.now() < ende && !existsSync(lint)) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 150));
  };
  const klein = { updateHinweis: false, wochenbericht: false, sicherungTaeglich: false };

  const nurStatus = neuerTestVault({ automatik: { ...klein, tageslauf: "probe" } });
  hook("session-start.mjs", { session_id: "s", source: "startup", cwd: nurStatus }, { vault: nurStatus, env: { BRAIN_TAGESLAUF_SKRIPT: skript, BRAIN_SESSION_NUR_STATUS: "1" } });
  assert.equal(await bereit(600), false, "NUR_STATUS startet nichts");

  const aus = neuerTestVault({ automatik: { ...klein, tageslauf: "aus" } });
  mitHintergrund(aus);
  assert.equal(await bereit(1200), false, "Schalter aus startet nichts");
  await hintergrundFertig(aus);

  const v = neuerTestVault({ automatik: { ...klein, tageslauf: "probe" } });
  const r = mitHintergrund(v);
  assert.equal(r.status, 0);
  assert.equal(await bereit(), true, "fällig und kein Dienst → Lauf wird losgelöst gestartet");
  assert.match(readFileSync(marke, "utf8"), /--wenn-faellig/);
  await hintergrundFertig(v);
});
