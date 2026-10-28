// .tools/tests/test-pflege-zurueck-nichts.mjs — B3 Task 6: eine Rücknahme, die nicht sauber geht, ändert NICHTS. Jeder Fall
// vergleicht den Vault vorher/nachher (schnappschuss: alle Dateien inkl. Inbox + Archiv, HEAD, Branches, Worktrees) plus
// Aktionsprotokoll, Prüfprotokoll, Pflege-Stand, Statuszeilen und Ingest-Sperre — und meldet den Grund. Ein Commit wird nie
// halb zurückgenommen („ganzer Commit bleibt"); bei mehreren Commits gilt das je Commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, neuerTestVault, committe, schnappschuss, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, orion, lies, ersetze, schreibe, pflegeCommit } from "./pflege-zurueck-hilfe.mjs";
const Z = await import("../tageslauf/pflege-zurueck.mjs");
const { leseAktionen, lesePruefungen, neuerLauf } = await import("../tageslauf/protokoll.mjs");
const { leseStand } = await import("../tageslauf/pflege-stand.mjs");
const { gibIngestSperreFrei } = await import("../tageslauf/arbeitskopie.mjs");
isoliere();

const NOTIZ = "# Notiz A\n\nOrion nutzt Redis.\n";
const QUELLE = "30_wissen/notiz-a.md", ARCHIV = "90_archiv/inbox-eingearbeitet/notiz-a.md";
const AKTION_INBOX = { quelle: "00_inbox/notiz-a.md", einsortiert: QUELLE, verschoben: ARCHIV };

// Vault-Zustand in einem Wert: gleicht er nach dem Aufruf dem von vorher, hat sich nichts bewegt.
const zustand = (v) => JSON.stringify({
  platte: schnappschuss(v), status: git(v, "status", "--porcelain=v1", "-uall"), aktionen: leseAktionen(v), pruefungen: lesePruefungen(v),
  stand: leseStand(v), sperre: existsSync(join(v, ".logs", "ingest.lock")),
  worktrees: git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length,
});
function nichtsAendertSich(v, aufruf, grund) {
  const vorher = zustand(v);
  const r = aufruf();
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.grund, grund, JSON.stringify(r));
  assert.equal(zustand(v), vorher, "Vault nach der gescheiterten Rücknahme anders als vorher");
  return r;
}

// Inbox-Commit wie B3: Seite + neue Quelle + rev/quellen; die Rohquelle liegt (wie von nachMerge abgelegt) im Archiv.
async function inboxCommit(v, id = "inbox-notiz-a") {
  schreibe(v, ARCHIV, NOTIZ);
  return pflegeCommit(v, { id, art: "inbox", titel: "notiz-a.md", aktion: AKTION_INBOX, arbeit: async (p) => {
    schreibe(p, QUELLE, NOTIZ);
    ersetze(p, SEITE, "Absatz 2.", "Absatz 2. Orion nutzt Redis.");
    ersetze(p, SEITE, "quellen: []", 'quellen: ["30_wissen/notiz-a.md"]');
    ersetze(p, SEITE, "quellen_sha: []", 'quellen_sha: ["aaaaaaaaaaaaaaaa"]');
    return { ok: true, neueQuellen: [QUELLE] };
  } });
}
const seiteVonHand = (v) => committe(v, SEITE, lies(v, SEITE).replace("Absatz 2. Orion nutzt Redis.", "Absatz 2, von Hand.").replace("rev: 2", "rev: 3"));

test("Seite von Hand umgeschrieben, Quelle unberührt → NICHTS zurück (auch Quelle + Inbox-Notiz bleiben), Grund + ID", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await inboxCommit(v);
  seiteVonHand(v);
  const r = nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { ids: [k.id], jetzt: JETZT + 3600e3 }), "von-hand-geaendert");
  assert.deepEqual(r.uebersprungen, [{ id: k.id, grund: "von-hand-geaendert" }]);
  assert.ok(existsSync(join(v, QUELLE)) && existsSync(join(v, ARCHIV)) && !existsSync(join(v, "00_inbox/notiz-a.md")));
});

test("Quelle von Hand geändert, Seite sauber zurücknehmbar → trotzdem NICHTS (ganzer Commit bleibt, auch die Seite)", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await inboxCommit(v);
  committe(v, QUELLE, NOTIZ + "\nVon Hand ergänzt.\n");
  assert.match(lies(v, SEITE), /Orion nutzt Redis/);
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 }), "von-hand-geaendert");
  assert.match(lies(v, SEITE), /Orion nutzt Redis/);
});

test("Kaputte Frontmatter-Liste (YAML-Block statt JSON) → nicht zurücknehmbar, nichts bewegt", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await inboxCommit(v);
  committe(v, SEITE, lies(v, SEITE).replace('quellen: ["30_wissen/notiz-a.md"]', "quellen:\n  - 30_wissen/notiz-a.md").replace("rev: 2", "rev: 3"));
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { ids: [k.id], jetzt: JETZT + 3600e3 }), "von-hand-geaendert");
});

test("Zwei Commits, einer von Hand geändert → nur der saubere geht zurück, der andere bleibt ganz, beide gemeldet", async () => {
  const A = "09_wiki/wissen/orion.md", B = "09_wiki/wissen/vega.md";
  const v = neuerTestVault({ seiten: { [A]: orion(), [B]: orion("vega") } });
  const vorherA = lies(v, A), vorherB = lies(v, B);
  const a = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, A, "Absatz 3.", "Absatz drei."); return { ok: true }; } });
  const b = await pflegeCommit(v, { id: "konsolidieren-vega", titel: "vega", jetzt: JETZT + 1000, arbeit: async (p) => { ersetze(p, B, "Absatz 3.", "Absatz drei."); return { ok: true }; } });
  committe(v, B, lies(v, B).replace("Absatz drei.", "Absatz drei, von Hand.").replace("rev: 2", "rev: 3"));
  const r = Z.nimmPflegeZurueck(v, { ids: [a.id, b.id], jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.zurueck, 1);
  assert.deepEqual(r.uebersprungen, [{ id: b.id, grund: "von-hand-geaendert" }]);
  assert.equal(lies(v, A), vorherA.replace("rev: 1", "rev: 3"));
  assert.ok(lies(v, B).includes("Absatz drei, von Hand.") && vorherB.includes("Absatz 3."));
  assert.deepEqual(leseAktionen(v).filter((x) => x.stufe === "zurueck").map((x) => x.id), [a.id]);
  assert.equal(Z.findePflegeCommits(v).map((c) => c.id).join(), b.id);
});

test("Lokale, nicht committete Änderung an derselben Seite → ff-Merge scheitert, NICHTS bewegt (die Hand-Änderung bleibt)", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, SEITE, "Absatz 3.", "Absatz drei."); return { ok: true }; } });
  writeFileSync(join(v, SEITE), lies(v, SEITE).replace("Absatz 6.", "Absatz 6, ungespeichert."));
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 }), "lokale-aenderung");
  assert.match(lies(v, SEITE), /Absatz 6, ungespeichert\./);
});

test("Vault nicht auf main → vault-nicht-auf-main, NICHTS bewegt", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, SEITE, "Absatz 3.", "Absatz drei."); return { ok: true }; } });
  git(v, "checkout", "-q", "-b", "nebenast");
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 }), "vault-nicht-auf-main");
});

test("pre-commit rot bei der Rücknahme → pruefung-rot, NICHTS bewegt (kein halber Commit, keine Reste)", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await inboxCommit(v);
  writeFileSync(join(v, ".hooks", "pre-commit"), "#!/bin/sh\necho '- SECRETS: Testbefund'\nexit 2\n");
  git(v, "add", "--", ".hooks/pre-commit"); git(v, "commit", "-qm", "Hook scharf", "--no-verify");
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 }), "pruefung-rot");
  assert.ok(existsSync(join(v, QUELLE)) && existsSync(join(v, ARCHIV)));
});

test("Probe, Ingest-Sperre fremd belegt, nichts zu tun → jeweils Grund und NICHTS bewegt; Sperre danach frei", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await inboxCommit(v);
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { ctx: neuerLauf(v, { probe: true, jetzt: JETZT, claudeBefehl: null }), lauf: k.lauf }), "probe");
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { lauf: "20200101-000000" }), "nichts-gefunden");
  nichtsAendertSich(v, () => Z.nimmPflegeZurueck(v, { ids: ["gibt-es-nicht"] }), "nichts-gefunden");
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "ingest.lock"), "ingest 1\n");                       // von /ingest, nicht von uns
  const vorher = zustand(v);
  assert.equal(Z.nimmPflegeZurueck(v, { lauf: k.lauf }).grund, "ingest-laeuft");
  assert.equal(zustand(v), vorher);
  assert.equal(lies(v, ".logs/ingest.lock"), "ingest 1\n", "fremde Sperre bleibt unberührt");
  gibIngestSperreFrei(v);                                                              // gibt nur UNSERE Sperre frei
  assert.equal(lies(v, ".logs/ingest.lock"), "ingest 1\n");
});

test("Erfolg räumt auf: Sperre frei, keine Arbeitskopie, kein Rest-Branch", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "konsolidieren-orion", arbeit: async (p) => { ersetze(p, SEITE, "Absatz 3.", "Absatz drei."); return { ok: true }; } });
  const r = Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(existsSync(join(v, ".logs", "ingest.lock")), false);
  assert.equal(git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length, 1);
  assert.equal(git(v, "for-each-ref", "--format=%(refname)", "refs/heads/"), "refs/heads/main");
  assert.equal(git(v, "status", "--porcelain=v1", "-uall"), "");
});
