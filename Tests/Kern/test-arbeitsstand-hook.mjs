// K12 über echte Hook-Aufrufe: PreCompact sichert, SessionStart(compact) spielt ein — strikt je session_id, mit
// Gesamtbudget, auch bei riesigen Verläufen schnell und still.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, existsSync, readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, ergebnis, hook, KIT } from "./verlauf-fixture.mjs";

const NUR_STATUS = { BRAIN_SESSION_NUR_STATUS: "1" };
function sitzung(sid, ziel) {
  const f = join(tempOrdner("Verläufe"), `${sid}.jsonl`);
  schreibeVerlauf(f, [nutzer(ziel), assistent("ok"), nutzer(`Vorgabe für ${sid}: nur im Worktree arbeiten`)]);
  return f;
}
const sichern = (v, sid, f, env = {}) => hook("kompakt-sichern.mjs",
  { session_id: sid, transcript_path: f, cwd: v, hook_event_name: "PreCompact", trigger: "auto", custom_instructions: null }, { vault: v, env });
const start = (v, sid, source, extra = {}) => hook("session-start.mjs", { session_id: sid, source, cwd: v, ...extra }, { vault: v, env: NUR_STATUS });

test("kompakt-sichern → SessionStart(compact) spielt den Stand derselben Sitzung wörtlich ein", () => {
  const v = tempVault("Mein Brän");
  const pc = sichern(v, "sitzung-a", sitzung("sitzung-a", "Ziel A: Export bauen"));
  assert.equal(pc.status, 0);
  assert.equal(pc.stdout, "", "PreCompact gibt nie etwas aus");
  assert.ok(existsSync(join(v, ".logs", "sitzungen", "sitzung-a.md")));
  assert.match(readFileSync(join(v, ".logs", "hooks.log"), "utf8"), /kompakt-sichern sid=sitzung- nachrichten=2 luecke=0/);
  const ss = start(v, "sitzung-a", "compact");
  assert.equal(ss.status, 0);
  assert.match(ss.stdout, /^Kortex-Arbeitsstand vor der Kompaktierung/);
  assert.match(ss.stdout, /> Ziel A: Export bauen/);
  assert.match(ss.stdout, /Vorgabe für sitzung-a: nur im Worktree arbeiten/);
});

test("zwei parallele Sitzungen bekommen nie den Stand der anderen (Zuordnung strikt über session_id)", () => {
  const v = tempVault();
  sichern(v, "sitzung-a", sitzung("sitzung-a", "Ziel A"));
  sichern(v, "sitzung-b", sitzung("sitzung-b", "Ziel B"));
  const b = start(v, "sitzung-b", "compact").stdout;
  assert.match(b, /Ziel B/);
  assert.doesNotMatch(b, /Ziel A|sitzung-a/);
  assert.doesNotMatch(start(v, "sitzung-c", "compact").stdout, /Kortex-Arbeitsstand/);
});

test("SessionStart startup/resume/clear spielt keinen Arbeitsstand ein", () => {
  const v = tempVault();
  sichern(v, "sitzung-a", sitzung("sitzung-a", "Ziel A"));
  for (const q of ["startup", "resume", "clear"]) assert.doesNotMatch(start(v, "sitzung-a", q).stdout, /Kortex-Arbeitsstand/, q);
});

test("SessionStart-Ausgabe bleibt mit Ich-Karte und großem Arbeitsstand ≤ 9.500 Zeichen; Arbeitsstand steht zuerst", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ichKarte: true } }));
  writeFileSync(join(v, "09_wiki", "ich.md"), "---\nname: ich\n---\n" + "Ich-Karte ".repeat(200));
  const f = join(tempOrdner(), "gross.jsonl");
  schreibeVerlauf(f, Array.from({ length: 60 }, (_, i) => nutzer(`Nachricht ${i} ` + "w".repeat(1400))));
  sichern(v, "gross", f);
  const out = start(v, "gross", "compact").stdout;
  assert.ok(out.length <= 9500, String(out.length));
  assert.match(out, /^Kortex-Arbeitsstand/);
  assert.match(out, /Ich-Karte/);
});

test("kompakt-sichern: 40-MB-Verlauf — Exit 0, Ziel und letzte Vorgabe da, Lücke vermerkt", () => {
  const v = tempVault();
  const f = join(tempOrdner(), "riesig.jsonl");
  const fd = openSync(f, "w");
  writeSync(fd, JSON.stringify(nutzer("Ziel: riesige Sitzung")) + "\n");
  const block = JSON.stringify(ergebnis("t", "r".repeat(100000))) + "\n";
  for (let i = 0; i < 400; i++) writeSync(fd, block);
  writeSync(fd, JSON.stringify(nutzer("letzte Vorgabe")) + "\n");
  closeSync(fd);
  const r = sichern(v, "riesig", f);
  assert.equal(r.status, 0);
  // Großzügige Grenze: diese Datei läuft auch in der Commit-Prüfung parallel zu allen Unit-Tests. Die strenge
  // Grenze (< 5 s) prüft laufzeit-hooks.mjs (Task 11) über test-hook-laufzeit.sh.
  assert.ok(r.ms < 15000, `${r.ms} ms`);
  const md = readFileSync(join(v, ".logs", "sitzungen", "riesig.md"), "utf8");
  assert.match(md, /Ziel: riesige Sitzung/);
  assert.match(md, /letzte Vorgabe/);
  assert.match(md, /nicht ausgewertet/);
});

test("kompakt-sichern: kaputtes stdin, fehlender Verlauf, BRAIN_ERNTE=1 → still, Exit 0, nichts geschrieben", () => {
  const v = tempVault();
  const laeufe = [
    hook("kompakt-sichern.mjs", "kaputt", { vault: v }),
    sichern(v, "x", join(v, "fehlt.jsonl")),
    sichern(v, "y", sitzung("y", "Ziel"), { BRAIN_ERNTE: "1" }),
  ];
  for (const r of laeufe) { assert.equal(r.status, 0); assert.equal(r.stdout, ""); assert.equal(r.stderr, ""); }
  assert.ok(!existsSync(join(v, ".logs", "sitzungen", "x.md")));
  assert.ok(!existsSync(join(v, ".logs", "sitzungen", "y.md")));
});

test("AGENTS.md-Vorlage enthält den Abschnitt „# Compact instructions“", () => {
  assert.match(readFileSync(join(KIT, "kit", "AGENTS.md"), "utf8"), /\n# Compact instructions\n/);
});

test("SessionStart (M1): passt ein Eintrag nicht mehr ins Gesamtbudget, entfällt er ganz — nie eine Kopfzeile ohne Inhalt", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ichKarte: true } }));
  writeFileSync(join(v, "09_wiki", "ich.md"), "---\nname: ich\n---\n" + "Ich-Karte ".repeat(200));
  // Nachrichtenlänge so wählen, dass der Arbeitsstand fast die 8.000 füllt (Ich-Karte ≈ 1.540 passt dann nicht mehr).
  let stand = "", sid = "";
  for (let laenge = 1380; laenge <= 1480 && stand.length <= 7960; laenge += 3) {
    const f = join(tempOrdner(), `gross2-${laenge}.jsonl`);
    schreibeVerlauf(f, Array.from({ length: 60 }, (_, i) => nutzer(`Nachricht ${i} ` + "w".repeat(laenge))));
    sid = `gross2-${laenge}`;
    sichern(v, sid, f);
    stand = readFileSync(join(v, ".logs", "sitzungen", `${sid}.md`), "utf8").trimEnd();
  }
  assert.ok(stand.length > 7960, `Stand zu kurz für den Test: ${stand.length}`);
  const out = start(v, sid, "compact").stdout;
  assert.ok(out.length <= 9500, String(out.length));
  assert.match(out, /^Kortex-Arbeitsstand/);
  assert.doesNotMatch(out, /\(… gekürzt\)\s*$|Kortex-Ich-Karte[^\n]*:\n?(\(… gekürzt\))?\s*$/);
  assert.doesNotMatch(out, /Kortex-Ich-Karte/, "passt nicht ganz → entfällt ganz");
});
