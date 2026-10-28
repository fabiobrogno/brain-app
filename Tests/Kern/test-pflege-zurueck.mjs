// .tools/tests/test-pflege-zurueck.mjs — B3 Task 6: brain zurueck für Pflege-Commits. Echte Pflege-Commits über einheit()
// (T2) + ff-Merge, dann Rücknahme: Text wie vorher, spätere Änderungen bleiben, rev = main + 1, _log nur ergänzt,
// Rohquelle zurück in die Inbox (gesperrt), Vorschläge abgelehnt, „von Hand geändert" lässt alles stehen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, neuerTestVault, seitenText, committe, legeVorschlagAn, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, RUMPF, lies, ersetze, schreibe, pflegeCommit } from "./pflege-zurueck-hilfe.mjs";
const Z = await import("../tageslauf/pflege-zurueck.mjs");
const { nimmIngestSperre, gibIngestSperreFrei } = await import("../tageslauf/arbeitskopie.mjs");
const { neuerLauf, leseAktionen, lesePruefungen } = await import("../tageslauf/protokoll.mjs");
const { leseStand } = await import("../tageslauf/pflege-stand.mjs");
isoliere();

const orion = () => seitenText({ fm: { name: "orion", description: "Orion" }, rumpf: RUMPF });

test("rueckwaertsText: Absatz zurück, spätere Änderung bleibt, quellen/herkunft_web gerechnet; Konflikt → null", () => {
  const S = (fm, rumpf) => seitenText({ fm: { name: "x", description: "x", ...fm }, rumpf });
  const R = (a, c) => `# X\n\n${a}\n\nB1.\n\nB2.\n\nB3.\n\n${c}\n`;
  const vor = S({ rev: 1 }, R("A.", "C."));
  const nach = S({ rev: 2, quellen: ["30_wissen/n.md"], quellen_sha: ["1111111111111111"], herkunft_web: ["Einleitung"] }, R("A neu.", "C."));
  const jetzt = S({ rev: 3, quellen: ["30_wissen/n.md", "30_wissen/b.md"], quellen_sha: ["1111111111111111", "2222222222222222"],
    herkunft_web: ["Einleitung"] }, R("A neu.", "C von später."));
  const r = Z.rueckwaertsText({ vor, nach, jetzt });
  assert.equal(r.unveraendert, false);
  assert.equal(r.text, S({ rev: 3, quellen: ["30_wissen/b.md"], quellen_sha: ["2222222222222222"] }, R("A.", "C von später.")));
  assert.equal(Z.rueckwaertsText({ vor, nach, jetzt: S({ rev: 3 }, R("A ganz anders.", "C.")) }), null);
  assert.equal(Z.rueckwaertsText({ vor, nach, jetzt: S({ rev: 3 }, R("A.", "C.")) }).unveraendert, true);
});

test("Pflege-Commit zurück: Text wie vorher, rev = main + 1, _log nur ergänzt, Aktion + Prüfung als Fehler, zweites Mal nichts", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const vorher = lies(v, SEITE);
  const k = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, SEITE, "Absatz 3.", "Absatz drei, neu gefasst."); return { ok: true }; } });
  assert.match(lies(v, SEITE), /^rev: 2$/m);
  const logVorher = lies(v, "09_wiki/_log.md");
  const r = Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.zurueck, 1);
  assert.equal(lies(v, SEITE), vorher.replace("rev: 1", "rev: 3"));
  const log = lies(v, "09_wiki/_log.md");
  assert.ok(log.endsWith(logVorher.slice(logVorher.search(/\n## \d{4}-/))), "alte _log-Einträge unverändert da");
  assert.match(log, /\n## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — zurueck: 1 Pflege-Änderung\(en\) zurückgenommen\n- Seiten geändert\/gelöscht: wissen\/orion\.md \(rev 3\)\n- Zurückgenommen: konsolidieren-orion \(pflege [0-9a-f]{8}\)\n[\s\S]*— pflege\(/);
  assert.equal(git(v, "log", "-1", "--format=%s"), "zurueck: konsolidieren-orion (pflege)");
  assert.equal(leseAktionen(v).find((a) => a.stufe === "zurueck").von, k.hash);
  assert.ok(lesePruefungen(v).some((p) => p.art === "zurueck" && p.fehler === true && p.ref === `zurueck:${k.hash}`));
  assert.equal(Z.findePflegeCommits(v).length, 0);
  assert.equal(Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 7200e3 }).grund, "nichts-gefunden");
});

test("Inbox-Commit zurück: spätere Änderung + Quelle bleiben, Rohquelle aus dem Archiv zurück in die Inbox und gesperrt", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const NOTIZ = "# Notiz A\n\nOrion nutzt Redis.\n";
  schreibe(v, "90_archiv/inbox-eingearbeitet/notiz-a.md", NOTIZ);                  // so hat nachMerge (T7) sie abgelegt
  const k = await pflegeCommit(v, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
    aktion: { quelle: "00_inbox/notiz-a.md", einsortiert: "30_wissen/notiz-a.md", verschoben: "90_archiv/inbox-eingearbeitet/notiz-a.md" },
    arbeit: async (p) => {
      schreibe(p, "30_wissen/notiz-a.md", NOTIZ);
      ersetze(p, SEITE, "Absatz 2.", "Absatz 2. Orion nutzt Redis.");
      ersetze(p, SEITE, "quellen: []", 'quellen: ["30_wissen/notiz-a.md"]');
      ersetze(p, SEITE, "quellen_sha: []", 'quellen_sha: ["aaaaaaaaaaaaaaaa"]');
      return { ok: true, neueQuellen: ["30_wissen/notiz-a.md"] };
    } });
  committe(v, SEITE, lies(v, SEITE).replace("Absatz 7.", "Absatz 7, später ergänzt.").replace("rev: 2", "rev: 3")
    .replace('quellen: ["30_wissen/notiz-a.md"]', 'quellen: ["30_wissen/notiz-a.md","30_wissen/b.md"]')
    .replace('quellen_sha: ["aaaaaaaaaaaaaaaa"]', 'quellen_sha: ["aaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbb"]'));
  const r = Z.nimmPflegeZurueck(v, { ids: [k.id], jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = lies(v, SEITE);
  assert.match(t, /^rev: 4$/m);
  assert.match(t, /^quellen: \["30_wissen\/b\.md"\]$/m);
  assert.match(t, /^quellen_sha: \["bbbbbbbbbbbbbbbb"\]$/m);
  assert.ok(t.includes("\nAbsatz 2.\n") && !t.includes("Redis"));
  assert.ok(t.includes("Absatz 7, später ergänzt."));
  assert.equal(existsSync(join(v, "30_wissen/notiz-a.md")), false);
  assert.deepEqual(r.inbox, ["00_inbox/notiz-a.md"]);
  assert.equal(lies(v, "00_inbox/notiz-a.md"), NOTIZ);
  assert.equal(existsSync(join(v, "90_archiv/inbox-eingearbeitet/notiz-a.md")), false);
  const { sha, letzter, ...rest } = leseStand(v).inbox["notiz-a.md"];
  assert.deepEqual(rest, { versuche: 2, gesperrt: true, grund: "zurueckgenommen" });
  assert.match(sha, /^[0-9a-f]{16}$/);
  assert.match(letzter, /^\d{4}-\d{2}-\d{2}$/);
});

test("von Hand geändert: dieselbe Zeile später umgeschrieben → nichts zurück, kein Commit, Grund + ID", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, SEITE, "Absatz 3.", "Absatz drei, neu gefasst."); return { ok: true }; } });
  committe(v, SEITE, lies(v, SEITE).replace("Absatz drei, neu gefasst.", "Absatz drei, von Hand.").replace("rev: 2", "rev: 3"));
  const head = git(v, "rev-parse", "HEAD");
  const r = Z.nimmPflegeZurueck(v, { ids: [k.id], jetzt: JETZT + 3600e3 });
  assert.deepEqual([r.ok, r.grund], [false, "von-hand-geaendert"]);
  assert.deepEqual(r.uebersprungen.map((u) => u.id), [k.id]);
  assert.equal(git(v, "rev-parse", "HEAD"), head);
  assert.equal(git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length, 1);
});

test("neue Seite zurück: Seite + Beleg gelöscht, übernommener Vorschlag → vorschlaege-abgelehnt", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const TEE = "09_wiki/wissen/tee.md", BELEG = "30_wissen/belege/2026-10/b-tee-1.md";
  const roh = legeVorschlagAn(v, { id: "v-tee-1", titel: "Tee" });
  mkdirSync(join(v, "90_archiv/vorschlaege-uebernommen"), { recursive: true });
  renameSync(roh, join(v, "90_archiv/vorschlaege-uebernommen/v-tee-1.md"));
  const k = await pflegeCommit(v, { id: "neue-seite-tee", art: "neue-seite", titel: "tee",
    aktion: { vorschlaege: ["90_archiv/vorschlaege-uebernommen/v-tee-1.md"] },
    arbeit: async (p) => {
      schreibe(p, TEE, seitenText({ fm: { name: "tee", description: "Tee" }, rumpf: "# Tee\n\n## Fakten\n\n- Grüner Tee zieht 2 Minuten. [[30_wissen/belege/2026-10/b-tee-1]]\n" }));
      schreibe(p, BELEG, "# Beleg\n");
      return { ok: true, neueBelege: [BELEG] };
    } });
  const r = Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(existsSync(join(v, TEE)), false);
  assert.equal(existsSync(join(v, BELEG)), false);
  assert.ok(existsSync(join(v, "90_archiv/vorschlaege-abgelehnt/v-tee-1.md")));
  assert.match(lies(v, "09_wiki/_log.md"), /Seiten geändert\/gelöscht: wissen\/tee\.md \(gelöscht\)/);
});

test("Probe schreibt nie; Ingest-Sperre belegt → ingest-laeuft; auto(-Commits sind nicht Sache dieses Moduls", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, SEITE, "Absatz 3.", "Absatz drei."); return { ok: true }; } });
  committe(v, "09_wiki/wissen/andere.md", seitenText({ fm: { name: "andere", description: "x" }, rumpf: "# A\n" }), `auto(${k.lauf}): Fakt → andere.md [v-1]`);
  assert.deepEqual(Z.findePflegeCommits(v).map((c) => c.id), ["konsolidieren-orion"]);
  const head = git(v, "rev-parse", "HEAD");
  const ctx = neuerLauf(v, { probe: true, jetzt: JETZT, claudeBefehl: null });
  assert.equal(Z.nimmPflegeZurueck(v, { ctx, lauf: k.lauf }).grund, "probe");
  assert.equal(nimmIngestSperre(v), true);
  try { assert.equal(Z.nimmPflegeZurueck(v, { lauf: k.lauf }).grund, "ingest-laeuft"); }
  finally { gibIngestSperreFrei(v); }
  assert.equal(git(v, "rev-parse", "HEAD"), head);
});
