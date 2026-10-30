// test-umstellung-phase-b-grenzen.mjs — Paket P7d: Phase B unter Druck. Laufwerksgrenze (EXDEV simuliert), Platzmangel, abweichende Kopie, Abbruch mittendrin und Weitermachen, ein
// scheiternder Commit, Config mit ungesicherten Änderungen, der alte Ordner als Verweis. Immer: das Original bleibt heil, der Rückweg stellt den Vault Byte für Byte her.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, lstatSync, symlinkSync, chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { umstellungsFixture, inhaltsStand } from "./umstellung-hilfe.mjs";
import { phaseAFertig, tuerOffen, tor, bedingung, BEST, REICH_B, json, gitIn } from "./umstellung-hilfe-b.mjs";
import { phaseB, TestAbbruch } from "../umstellung/phase-b.mjs";
import { probelaufB } from "../umstellung/probelauf-b.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { liesZustand, ablageOrdner } from "../umstellung/protokoll.mjs";
import { baumHash, verschiebeBaum } from "../umstellung/baum.mjs";
import { probelaufBStand } from "../umstellung/probelauf-b-merker.mjs";

const vaultStand = (h) => inhaltsStand(h.a.vault, { ohne: [".git", ".logs"] });
const kit = (h) => join(h.a.vault, ".tools");
const exdev = () => { const e = new Error("EXDEV: cross-device link not permitted"); e.code = "EXDEV"; throw e; };
const lstatDa = (p) => { try { lstatSync(p); return true; } catch { return false; } };
const zurueckB = (z) => rueckweg(z, { bestaetigt: true, schritte: ["B3", "B2", "B1"] });

test("Laufwerksgrenze: kopieren, Datei für Datei vergleichen, erst dann entfernen; Rückweg ebenso; Platzmangel lässt das Original unberührt", async () => {
  const h = umstellungsFixture([...REICH_B, "kit-aenderungen"].filter((f) => f !== "kit-versioniert"));
  try {
    await phaseAFertig(h);
    writeFileSync(join(kit(h), "lokal.txt"), "nur hier\n");
    symlinkSync("brain.mjs", join(kit(h), "verweis-relativ"));
    chmodSync(join(kit(h), "git-hooks", "pre-commit"), 0o755);
    const vor = vaultStand(h);
    const kitHash = baumHash(kit(h));
    const z = h.z(); z.umbenenner = exdev;                      // jedes Umbenennen scheitert wie über eine Laufwerksgrenze
    const probe = await probelaufB(z, { bestaetigt: true });
    assert.equal(probe.ok, true, JSON.stringify(probe.kriterien.filter((c) => c.status === "rot")));
    // Platzmangel: B1 schlägt fehl, der alte Ordner bleibt, nichts Halbes im Archiv
    z.freierPlatz = (() => { let n = 0; return () => (n++ === 0 ? 1e13 : 0); })();     // B0 (Bundle) hat Platz, B1 nicht
    const knapp = await phaseB(z, { bestaetigt: true, entscheidungen: BEST });
    assert.equal(knapp.ok, false);
    assert.equal(knapp.fehlerBei, "B1");
    assert.equal(knapp.grund, "zu-wenig-platz");
    assert.equal(baumHash(kit(h)), kitHash, "Original unberührt");
    assert.equal(vaultStand(h), vor);
    assert.deepEqual(readdirSync(ablageOrdner(z)).filter((n) => n.startsWith("kit-")), [], "kein halbes Archiv");
    delete z.freierPlatz;
    // mit Platz: kopiert, verglichen, entfernt
    const r = await phaseB(z, { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.schritte.find((s) => s.id === "B1").details.wie, "kopiert");
    assert.ok(!lstatDa(kit(h)));
    const archiv = join(ablageOrdner(z), r.archiv);
    assert.equal(baumHash(archiv), kitHash, "Kopie byte-gleich (Inhalt, Rechte, relative Verknüpfung)");
    assert.equal((await zurueckB(z)).ok, true);
    assert.equal(baumHash(kit(h)), kitHash);
    assert.equal(vaultStand(h), vor, "Rückweg über die Laufwerksgrenze stellt alles her");
    assert.ok(!existsSync(archiv));
  } finally { h.weg(); }
});

test("verschiebeBaum: eine abweichende Kopie wird verworfen, die Quelle bleibt; ein Abbruch vor dem Entfernen lässt Quelle und Kopie stehen", () => {
  const t = mkdtempSync(join(tmpdir(), "baum-test-"));
  try {
    mkdirSync(join(t, "q", "unter"), { recursive: true });
    writeFileSync(join(t, "q", "a.txt"), "A\n"); writeFileSync(join(t, "q", "unter", "b.txt"), "B\n");
    const hash = baumHash(join(t, "q"));
    assert.throws(() => verschiebeBaum(join(t, "q"), join(t, "z1"), { umbenenner: exdev, pruefpunkt: (n) => { if (n === "nach-kopie") writeFileSync(join(t, "z1", "a.txt"), "VERFÄLSCHT\n"); } }), /kopie-weicht-ab/);
    assert.equal(baumHash(join(t, "q")), hash, "Quelle unberührt");
    assert.ok(!existsSync(join(t, "z1")), "verfälschte Kopie wieder entfernt");
    assert.throws(() => verschiebeBaum(join(t, "q"), join(t, "z2"), { umbenenner: exdev, pruefpunkt: (n) => { if (n === "vor-entfernen") throw new TestAbbruch("x"); } }), TestAbbruch);
    assert.equal(baumHash(join(t, "q")), hash);
    assert.equal(baumHash(join(t, "z2")), hash, "nach einem Abbruch stehen Quelle und vollständige Kopie");
    assert.throws(() => verschiebeBaum(join(t, "q"), join(t, "z2"), { umbenenner: exdev }), /ziel-existiert/);
    assert.equal(verschiebeBaum(join(t, "q"), join(t, "z3")), "umbenannt");
    assert.equal(baumHash(join(t, "z3")), hash);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

const ABBRUECHE = [
  ["nach B1", { abbruchNach: "B1" }, false],
  ["in B1", { abbruchIn: "B1" }, false],
  ["B1 nach dem Archivieren", { abbruchBei: "B1:nach-archiv" }, false],
  ["B1 nach dem Kopieren (Laufwerksgrenze)", { abbruchBei: "B1:nach-kopie" }, true],
  ["B1 vor dem Entfernen (Laufwerksgrenze)", { abbruchBei: "B1:vor-entfernen" }, true],
  ["B2 nach der Config", { abbruchBei: "B2:nach-config" }, false],
  ["B3 nach dem Commit", { abbruchBei: "B3:nach-commit" }, false],
  ["nach B3", { abbruchNach: "B3" }, false],
];
for (const [name, opt, ueberGrenze] of ABBRUECHE) {
  test(`Abbruch ${name}: der Rückweg stellt den Vault Byte für Byte her`, async () => {
    const h = umstellungsFixture(REICH_B);
    try {
      await phaseAFertig(h);
      writeFileSync(join(kit(h), "lokal.txt"), "nur hier\n");
      const vor = vaultStand(h), kitHash = baumHash(kit(h)), treeVor = gitIn(h.a.vault, "rev-parse", "HEAD^{tree}");
      await tuerOffen(h);
      const z = h.z(); if (ueberGrenze) z.umbenenner = exdev;
      await assert.rejects(phaseB(z, { bestaetigt: true, entscheidungen: BEST, ...opt }), TestAbbruch);
      assert.equal(existsSync(join(ablageOrdner(z), "laeuft")), false, "die Sperre ist gelöst");
      const rw = await zurueckB(z);
      assert.equal(rw.ok, true, JSON.stringify(rw));
      assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
      assert.equal(baumHash(kit(h)), kitHash, ".tools wieder byte-gleich");
      assert.equal(vaultStand(h), vor);
      assert.equal(gitIn(h.a.vault, "rev-parse", "HEAD^{tree}"), treeVor);
      assert.equal(gitIn(h.a.vault, "status", "--porcelain", "--", "brain.config.json", ".gitignore", ".kortex"), "");
      assert.deepEqual(readdirSync(ablageOrdner(z)).filter((n) => n.startsWith("kit-")), [], "kein Archiv-Rest");
    } finally { h.weg(); }
  });
}

test("Weitermachen nach einem Abbruch (nach B1 und nach dem Commit): ohne neuen Probelauf, ohne doppelten Commit", async () => {
  for (const opt of [{ abbruchNach: "B1" }, { abbruchBei: "B3:nach-commit" }]) {
    const h = umstellungsFixture(REICH_B);
    try {
      await phaseAFertig(h);
      const kopfVor = gitIn(h.a.vault, "rev-parse", "HEAD");
      await tuerOffen(h);
      await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST, ...opt }), TestAbbruch);
      assert.equal(bedingung(tor(h), "probelauf").erfuellt, true, "begonnen: kein neuer Probelauf nötig");
      const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.phaseB, "fertig");
      assert.equal(gitIn(h.a.vault, "rev-list", "--count", `${kopfVor}..HEAD`), "1", "genau ein Commit");
      assert.equal(gitIn(h.a.vault, "ls-files", "--", ".tools"), "");
      assert.equal((await zurueckB(h.z())).ok, true);
      assert.ok(existsSync(join(kit(h), "VERSION")));
    } finally { h.weg(); }
  }
});

test("B3 scheitert (Sperre im Versionsverlauf): B1/B2 bleiben, nichts geht verloren, Weitermachen speichert den Commit", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    await tuerOffen(h);
    writeFileSync(join(h.a.vault, ".git", "index.lock"), "");
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, false);
    assert.equal(r.fehlerBei, "B3");
    assert.equal(r.zurueckgenommen, true);
    assert.ok(!existsSync(kit(h)) && readdirSync(ablageOrdner(h.z())).some((n) => n.startsWith("kit-")), "der alte Ordner liegt im Archiv");
    assert.equal(liesZustand(h.z()).phaseB, undefined, "Phase B ist nicht abgeschlossen");
    rmSync(join(h.a.vault, ".git", "index.lock"));
    const r2 = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(gitIn(h.a.vault, "ls-files", "--", ".tools"), "");
    assert.equal(gitIn(h.a.vault, "log", "-1", "--format=%s"), "Kortex: alten Werkzeug-Ordner entfernt");
  } finally { h.weg(); }
});

test("Config mit ungesicherten Änderungen kommt nicht in den Commit; der Rückweg stellt sie her", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h, { configCommit: false });         // die Config bleibt ungespeichert (Altfelder, Sicherungsordner)
    const vor = vaultStand(h), configVor = readFileSync(join(h.a.vault, "brain.config.json"), "utf8");
    await tuerOffen(h);
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    const dateien = gitIn(h.a.vault, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    assert.ok(!dateien.includes("brain.config.json"), dateien.join(","));
    assert.ok(dateien.some((p) => p.startsWith(".tools/")));
    assert.match(gitIn(h.a.vault, "status", "--porcelain"), /brain\.config\.json/, "bleibt ungespeichert");
    assert.ok(!("werkzeuge" in json(join(h.a.vault, "brain.config.json"))), "aber bereinigt");
    assert.equal((await zurueckB(h.z())).ok, true);
    assert.equal(readFileSync(join(h.a.vault, "brain.config.json"), "utf8"), configVor);
    assert.equal(vaultStand(h), vor);
  } finally { h.weg(); }
});

test("Der alte Ordner als Verweis (Symlink): nur der Verweis wandert, das Ziel bleibt; Rückweg stellt ihn her", async () => {
  const h = umstellungsFixture(["kit-verweis", "altfelder"]);
  try {
    await phaseAFertig(h);
    const ziel = join(h.a.extern, "kit");
    const zielHash = baumHash(ziel);
    const vor = vaultStand(h);
    await tuerOffen(h);
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!lstatDa(kit(h)));
    assert.equal(baumHash(ziel), zielHash, "das Ziel des Verweises bleibt unberührt");
    assert.ok(lstatSync(join(ablageOrdner(h.z()), r.archiv, ".tools")).isSymbolicLink());
    assert.equal((await zurueckB(h.z())).ok, true);
    assert.ok(lstatSync(kit(h)).isSymbolicLink());
    assert.equal(vaultStand(h), vor);
  } finally { h.weg(); }
});
