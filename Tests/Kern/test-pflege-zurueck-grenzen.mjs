// .tools/tests/test-pflege-zurueck-grenzen.mjs — B3 Task 6: Rücknahme gegen den ECHTEN pre-commit (REV, Secrets, _log append-only),
// Pfad-Tricks in Aktionsfeldern, Namenskollision in der Inbox, Rohquelle ohne Archivdatei, rueckwaertsText ohne Wurf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { isoliere, git, neuerTestVault, seitenText, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, orion, lies, ersetze, schreibe, pflegeCommit } from "./pflege-zurueck-hilfe.mjs";
const Z = await import("../tageslauf/pflege-zurueck.mjs");
const { leseStand } = await import("../tageslauf/pflege-stand.mjs");
isoliere();

const NOTIZ = "# Notiz A\n\nOrion nutzt Redis.\n";
const QUELLE = "30_wissen/notiz-a.md";
const inboxArbeit = async (p) => {
  schreibe(p, QUELLE, NOTIZ);
  ersetze(p, SEITE, "Absatz 2.", "Absatz 2. Orion nutzt Redis.");
  ersetze(p, SEITE, "quellen: []", 'quellen: ["30_wissen/notiz-a.md"]');
  ersetze(p, SEITE, "quellen_sha: []", 'quellen_sha: ["aaaaaaaaaaaaaaaa"]');
  return { ok: true, neueQuellen: [QUELLE] };
};
const inboxDateien = (v) => (existsSync(join(v, "00_inbox")) ? readdirSync(join(v, "00_inbox")).sort() : []);

test("echter pre-commit (REV, Secrets, _log append-only): Pflege-Commit UND Rücknahme gehen durch, rev/quellen stimmen", async () => {
  const v = neuerTestVault({ hook: "echt", seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
    aktion: { quelle: "00_inbox/notiz-a.md", einsortiert: QUELLE }, arbeit: inboxArbeit });
  const vorher = lies(v, SEITE).replace(/^rev: 2$/m, "rev: 1").replace(/^quellen: .*$/m, "quellen: []").replace(/^quellen_sha: .*$/m, "quellen_sha: []")
    .replace("Absatz 2. Orion nutzt Redis.", "Absatz 2.");
  const r = Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(lies(v, SEITE), vorher.replace("rev: 1", "rev: 3"));
  assert.equal(git(v, "log", "-1", "--format=%an|%s"), "Brain-Tageslauf|zurueck: inbox-notiz-a (pflege)");
  assert.equal(existsSync(join(v, QUELLE)), false);
  assert.deepEqual(inboxDateien(v), ["notiz-a.md"]);
});

test("Pfad-Tricks in quelle/verschoben (.., absolut) → nichts außerhalb der Inbox angefasst, Notiz landet unter ihrem Dateinamen", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
    aktion: { quelle: "00_inbox/../../evil.md", einsortiert: QUELLE, verschoben: "90_archiv/../brain.config.json" }, arbeit: inboxArbeit });
  const cfg = lies(v, "brain.config.json");
  const r = Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.inbox, ["00_inbox/notiz-a.md"]);
  assert.equal(lies(v, "00_inbox/notiz-a.md"), NOTIZ);                         // Inhalt aus dem Commit, nicht aus dem „Archivpfad"
  assert.equal(lies(v, "brain.config.json"), cfg, "Datei außerhalb des Archivs nicht verschoben");
  assert.equal(existsSync(join(dirname(v), "evil.md")), false);
});

test("Name in der Inbox schon vergeben → …-zurueck.md, Stand unter dem neuen Namen; Unterordner der Quelle bleibt", async () => {
  const v = neuerTestVault({ seiten: { [SEITE]: orion() } });
  const k = await pflegeCommit(v, { id: "inbox-notiz-a", art: "inbox", titel: "notiz-a.md",
    aktion: { quelle: "00_inbox/mail/notiz-a.md", einsortiert: QUELLE }, arbeit: inboxArbeit });
  schreibe(v, "00_inbox/mail/notiz-a.md", "# Neue Notiz mit demselben Namen\n");
  const r = Z.nimmPflegeZurueck(v, { lauf: k.lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.inbox, ["00_inbox/mail/notiz-a-zurueck.md"]);
  assert.equal(lies(v, "00_inbox/mail/notiz-a.md"), "# Neue Notiz mit demselben Namen\n");
  assert.equal(lies(v, "00_inbox/mail/notiz-a-zurueck.md"), NOTIZ);
  const s = leseStand(v).inbox;
  assert.equal(s["mail/notiz-a-zurueck.md"].gesperrt, true);
  assert.equal(s["mail/notiz-a.md"], undefined);
});

test("rueckwaertsText wirft nie: YAML-Blockliste, Frontmatter fehlt halb → null bzw. Text-Merge", () => {
  const S = (fm, rumpf) => seitenText({ fm: { name: "x", description: "x", ...fm }, rumpf });
  const R = (a) => `# X\n\n${a}\n\nB1.\n\nB2.\n\nB3.\n`;
  const vor = S({ rev: 1 }, R("A.")), nach = S({ rev: 2, quellen: ["a.md"], quellen_sha: ["1111111111111111"] }, R("A neu."));
  const block = nach.replace('quellen: ["a.md"]', "quellen:\n  - a.md");
  assert.equal(Z.rueckwaertsText({ vor, nach, jetzt: block }), null);
  const ohneFm = (a) => `# X\n\n${a}\n\nB1.\n\nB2.\n\nB3.\n`;
  const r = Z.rueckwaertsText({ vor: ohneFm("A."), nach: ohneFm("A neu."), jetzt: ohneFm("A neu.") });
  assert.deepEqual([r.text, r.unveraendert], [ohneFm("A."), false]);
});
