// test-umstellung-phase-b-review.mjs — Paket P7d, Nachbesserung nach dem Opus-Review:
// K1 Abbruch in B1/B2 + „Weitermachen“ (Rückweg-Angaben nie verwaisen) · W1 laufendes cherry-pick/revert des Nutzers wird nie angefasst · W2 Rückweg idempotent · W3 nichts wird beim Zurückholen
// überschrieben · W4 verwaiste Einbindungen (nicht eingehängtes Laufwerk, bekannte Vaults, Länge, Pfad der Datei) · B0 neue Sicherung zuerst · Prozessprüfung fail-closed · Tor „macs“ (dieser Mac,
// Auffrischen des Merkers) · Fingerabdruck mit HEAD/Index · versionierter Verweis · Platz beim Zurückkopieren · Sperre während Phase B.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, lstatSync, symlinkSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { umstellungsFixture, inhaltsStand, freigabe, umstellungsStand } from "./umstellung-hilfe.mjs";
import { phaseAFertig, tuerOffen, tor, bedingung, BEST, REICH_B, json, gitIn } from "./umstellung-hilfe-b.mjs";
import { phaseB, TestAbbruch } from "../umstellung/phase-b.mjs";
import { phaseA } from "../umstellung/phase-a.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { liesZustand, ablageOrdner } from "../umstellung/protokoll.mjs";
import { baumHash, fuegeBaumZurueck } from "../umstellung/baum.mjs";
import { probelaufBStand } from "../umstellung/probelauf-b-merker.mjs";
import { leseBloecke, findeVerwaiste } from "../umstellung/verwaist.mjs";
import { einbindungsBlock, setzeBlock } from "../umstellung/git-umzug.mjs";
import { raeume } from "../umstellung/aufraeumen.mjs";

const vaultStand = (h) => inhaltsStand(h.a.vault, { ohne: [".git", ".logs"] });
const kit = (h) => join(h.a.vault, ".tools");
const zurueckB = (z) => rueckweg(z, { bestaetigt: true, schritte: ["B3", "B2", "B1"] });
const exdev = () => { const e = new Error("EXDEV"); e.code = "EXDEV"; throw e; };
const sh = (h, ...a) => gitIn(h.a.vault, ...a);
const rueckHinweise = (rw) => rw.hinweise;

// --- K1 ----------------------------------------------------------------------------------------------------------------------------------------------------------------
for (const [name, opt] of [["B1 nach dem Archivieren", { abbruchBei: "B1:nach-archiv" }], ["in B1 (nach dem Verschieben, vor „ok“)", { abbruchIn: "B1" }], ["B2 nach der Config", { abbruchBei: "B2:nach-config" }], ["in B2 (alles geschrieben, vor „ok“)", { abbruchIn: "B2" }]]) {
  test(`K1 Abbruch ${name}: Weitermachen übernimmt Archiv und Dateien, der Rückweg stellt alles her (auch Unversioniertes)`, async () => {
    const h = umstellungsFixture(REICH_B);
    try {
      await phaseAFertig(h);
      writeFileSync(join(kit(h), "lokal.txt"), "nur hier, unversioniert\n");
      const vor = vaultStand(h), kitHash = baumHash(kit(h)), treeVor = sh(h, "rev-parse", "HEAD^{tree}");
      await tuerOffen(h);
      await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST, ...opt }), TestAbbruch);
      const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.phaseB, "fertig", JSON.stringify(r.b4));
      assert.match(r.archiv, /^kit-\d{4}-\d{2}-\d{2}/, "phaseB.archiv ist gesetzt");
      assert.equal(liesZustand(h.z()).phaseB.archiv, r.archiv);
      assert.ok(existsSync(join(ablageOrdner(h.z()), r.archiv, "lokal.txt")), "das Unversionierte liegt im Archiv");
      // der Commit enthält .tools UND (auch nach dem Abbruch in B2) die Einstellungen
      const dateien = sh(h, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
      assert.ok(dateien.some((p) => p.startsWith(".tools/")) && dateien.includes("brain.config.json") && dateien.includes(".gitignore"), dateien.join(","));
      assert.equal(sh(h, "ls-files", "--", ".tools"), "");
      const rw = await zurueckB(h.z());
      assert.equal(rw.ok, true, JSON.stringify(rw));
      assert.deepEqual(rueckHinweise(rw), [], JSON.stringify(rw));
      assert.equal(baumHash(kit(h)), kitHash, ".tools wieder byte-gleich, mit lokal.txt");
      assert.equal(vaultStand(h), vor);
      assert.equal(sh(h, "rev-parse", "HEAD^{tree}"), treeVor);
      assert.deepEqual(readdirSync(ablageOrdner(h.z())).filter((n) => n.startsWith("kit-")), [], "kein Archiv-Rest");
    } finally { h.weg(); }
  });
}

test("K1 Phase A: Abbruch in A8, dann Weitermachen – die Rückweg-Angaben bleiben, „alles zurück“ stellt den Stand her", async () => {
  const h = umstellungsFixture(["kit-versioniert", "hooks-alt-sh", "altfelder"]);
  try {
    const vor = umstellungsStand(h);
    freigabe(h.z());
    await assert.rejects(phaseA(h.z(), { bestaetigt: true, abbruchIn: "A8" }), TestAbbruch);
    freigabe(h.z());
    const r = await phaseA(h.z(), { bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(liesZustand(h.z()).schritte.A8.undo, "A8 behält seine Rückweg-Angaben");
    const rw = await rueckweg(h.z(), { bestaetigt: true, alles: true });
    assert.equal(rw.ok, true);
    assert.equal(umstellungsStand(h), vor);
  } finally { h.weg(); }
});

// --- W1 / W2 -----------------------------------------------------------------------------------------------------------------------------------------------------------
test("W1 Ein laufendes revert/cherry-pick des Nutzers wird nie angefasst; ein eigener gescheiterter Revert wird abgebrochen", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const kitHash = baumHash(kit(h));
    await tuerOffen(h);
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    const commitB = sh(h, "rev-parse", "HEAD");
    const notiz = join(h.a.vault, "09_wiki", "start.md");
    writeFileSync(notiz, "# Start\n\nA\n"); sh(h, "commit", "-q", "-am", "A");
    const a = sh(h, "rev-parse", "HEAD");
    writeFileSync(notiz, "# Start\n\nB\n"); sh(h, "commit", "-q", "-am", "B");
    const gitDir = join(h.a.vault, ".git");
    // (a) der Nutzer steckt mitten in einem revert (Konflikt) bzw. cherry-pick
    for (const [marke, befehl] of [["REVERT_HEAD", ["revert", "--no-edit", a]], ["CHERRY_PICK_HEAD", ["cherry-pick", a]]]) {
      sh(h, ...befehl);
      assert.ok(existsSync(join(gitDir, marke)), `${marke}: der Konflikt des Nutzers steht`);
      const rw = await zurueckB(h.z());
      assert.ok(rw.hinweise.includes("B3:git-beschaeftigt"), JSON.stringify(rw));
      assert.ok(rw.hinweise.includes("B3:rest-nicht-angefasst"));
      assert.ok(existsSync(join(gitDir, marke)), "nichts abgebrochen");
      assert.ok(!existsSync(kit(h)) && sh(h, "ls-files", "--", ".tools") === "", "B2 und B1 blieben unberührt (kein Mischzustand)");
      assert.equal(liesZustand(h.z()).phaseB.status, "fertig");
      sh(h, marke === "REVERT_HEAD" ? "revert" : "cherry-pick", "--abort");
      assert.ok(!existsSync(join(gitDir, marke)));
    }
    // (b) der Revert von B3 scheitert selbst (spätere Änderung an denselben Zeilen der Config): ER bricht ab, der Zustand ist sauber, der Rest bleibt unberührt
    const cfg = join(h.a.vault, "brain.config.json");
    const c = json(cfg); c.kernVersion = "9.9.9"; c.sprache = "en"; writeFileSync(cfg, JSON.stringify(c, null, 2) + "\n"); sh(h, "commit", "-q", "-am", "Config später");
    const rw = await zurueckB(h.z());
    assert.ok(rw.hinweise.includes("B3:revert-fehlgeschlagen"), JSON.stringify(rw));
    assert.ok(!existsSync(join(gitDir, "REVERT_HEAD")), "unser eigener Revert wurde abgebrochen");
    assert.ok(!existsSync(kit(h)), "der Rest blieb unberührt");
    assert.equal(sh(h, "status", "--porcelain", "--", "brain.config.json"), "");
    assert.equal(sh(h, "log", "--format=%s", "-1", `${commitB}`), "Kortex: alten Werkzeug-Ordner entfernt");
    assert.equal(liesZustand(h.z()).phaseB.status, "fertig");
    assert.ok(kitHash);
  } finally { h.weg(); }
});

test("W2 Rückweg idempotent: zweimal, nach Handarbeit des Nutzers, und Phase B → zurück → Phase B → zurück", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const vor = vaultStand(h), kitHash = baumHash(kit(h));
    // Runde 1
    await tuerOffen(h);
    assert.equal((await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST })).ok, true);
    let rw = await zurueckB(h.z());
    assert.deepEqual(rw.hinweise, []);
    assert.equal(vaultStand(h), vor);
    // zweiter Rückweg: nichts zu tun, kein Hinweis
    rw = await zurueckB(h.z());
    assert.equal(rw.ok, true); assert.deepEqual(rw.hinweise, []);
    assert.equal(vaultStand(h), vor);
    // Runde 2: der Probelauf muss neu (HEAD hat sich durch Commit + Revert geändert)
    assert.equal(bedingung(tor(h), "probelauf").erfuellt, false, "neuer Verlauf → neuer Probelauf");
    await tuerOffen(h);
    const r2 = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(sh(h, "ls-files", "--", ".tools"), "");
    rw = await zurueckB(h.z());
    assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
    assert.equal(vaultStand(h), vor, "nach Runde 2 und zurück: alles wie vorher (der ältere Commit wurde nicht noch einmal zurückgenommen)");
    assert.equal(baumHash(kit(h)), kitHash);
    assert.notEqual(sh(h, "ls-files", "--", ".tools"), "");
    // Handarbeit: der Nutzer nimmt den Commit selbst zurück, danach der Rückweg
    await tuerOffen(h);
    assert.equal((await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST })).ok, true);
    sh(h, "revert", "--no-edit", "HEAD");
    rw = await zurueckB(h.z());
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
    assert.equal(baumHash(kit(h)), kitHash);
    assert.equal(vaultStand(h), vor);
  } finally { h.weg(); }
});

// --- W3 ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("W3 Zurückholen überschreibt und löscht nichts: Abweichendes wandert zuerst in die Sicherung (Baum und Ablauf)", async () => {
  const t = mkdtempSync(join(tmpdir(), "zusammen-"));
  try {
    mkdirSync(join(t, "arch", "d"), { recursive: true }); mkdirSync(join(t, "ziel", "d"), { recursive: true });
    writeFileSync(join(t, "arch", "a.txt"), "ARCHIV\n"); writeFileSync(join(t, "ziel", "a.txt"), "VAULT-ÄNDERUNG\n");
    writeFileSync(join(t, "arch", "d", "gleich.txt"), "x\n"); writeFileSync(join(t, "ziel", "d", "gleich.txt"), "x\n");
    writeFileSync(join(t, "ziel", "nur-im-vault.txt"), "bleibt\n");
    writeFileSync(join(t, "arch", "datei-statt-ordner"), "F\n"); mkdirSync(join(t, "ziel", "datei-statt-ordner")); writeFileSync(join(t, "ziel", "datei-statt-ordner", "inhalt"), "I\n");
    assert.throws(() => fuegeBaumZurueck(join(t, "arch"), join(t, "ziel")), /abweichung-ohne-ablage/);
    const erg = fuegeBaumZurueck(join(t, "arch"), join(t, "ziel"), { ablage: join(t, "sicherung") });
    assert.equal(erg.wie, "zusammengefuehrt"); assert.equal(erg.gesichert, 2);
    assert.equal(readFileSync(join(t, "ziel", "a.txt"), "utf8"), "ARCHIV\n");
    assert.equal(readFileSync(join(t, "sicherung", "a.txt"), "utf8"), "VAULT-ÄNDERUNG\n", "die Änderung im Vault ist gesichert, nicht verloren");
    assert.equal(readFileSync(join(t, "sicherung", "datei-statt-ordner", "inhalt"), "utf8"), "I\n");
    assert.equal(readFileSync(join(t, "ziel", "nur-im-vault.txt"), "utf8"), "bleibt\n");
    assert.ok(!existsSync(join(t, "arch")));
    // ein Archiv, das nur ein gleicher Verweis ist, wird einfach verworfen
    symlinkSync("irgendwo", join(t, "l1")); symlinkSync("irgendwo", join(t, "l2"));
    assert.equal(fuegeBaumZurueck(join(t, "l1"), join(t, "l2")).wie, "gleich");
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("W3 Ablauf: die versionierte, im Archiv geänderte Datei kommt zurück, die Fassung aus dem Revert liegt gesichert; Ergebnis nennt es", async () => {
  const h = umstellungsFixture([...REICH_B.filter((f) => f !== "kit-versioniert"), "kit-aenderungen"]);
  try {
    await phaseAFertig(h);
    const vor = vaultStand(h);
    await tuerOffen(h);
    assert.equal((await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST })).ok, true);
    const rw = await zurueckB(h.z());
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.deepEqual(rw.hinweise, []);
    assert.ok(rw.gesichert >= 1, "geänderte Datei: Revert-Fassung gesichert");
    assert.match(readFileSync(join(kit(h), "brain.mjs"), "utf8"), /geändert/);
    assert.equal(vaultStand(h), vor);
    const gesichert = [];
    const suche = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (lstatSync(p).isDirectory()) suche(p); else if (/zusammenfuehren-/.test(p)) gesichert.push(p); } };
    suche(join(ablageOrdner(h.z()), "sicherungen"));
    assert.ok(gesichert.length >= 1, "die ersetzte Fassung liegt unter sicherungen/…/zusammenfuehren-…");
  } finally { h.weg(); }
});

// --- W4 ----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("W4 Verwaist: nicht eingehängtes Laufwerk, bekannter Vault, zu langer Block und fremde Datei werden nie angeboten bzw. gelöscht", async () => {
  const h = umstellungsFixture(["kit-versioniert"]);
  try {
    await phaseAFertig(h);
    const z = h.z();
    const vol = join(h.a.basis, "Volumes"); mkdirSync(vol);
    const dateiK = (k) => join(h.a.support, "git", `${k}.gitconfig`);
    const neuerBlock = (k, vaultPfad, datei = dateiK(k)) => { mkdirSync(join(h.a.support, "git"), { recursive: true }); writeFileSync(datei, "[credential]\n\thelper = osxkeychain\n", { mode: 0o600 }); setzeBlock(h.gitGlobal, k, einbindungsBlock({ vaultEcht: vaultPfad, datei, k, caseInsensitiv: false })); };
    const opt = { volumen: vol, support: h.a.support };
    // 1 Laufwerk nicht eingehängt → nicht erreichbar, nicht verwaist; eingehängt, aber Vault weg → verwaist
    neuerBlock("1111111111111111", join(vol, "Platte", "Vault"));
    assert.equal(leseBloecke(h.gitGlobal, opt).find((b) => b.k === "1111111111111111").unerreichbar, true);
    assert.deepEqual(findeVerwaiste(h.gitGlobal, opt).map((b) => b.k), []);
    mkdirSync(join(vol, "Platte"));
    assert.deepEqual(findeVerwaiste(h.gitGlobal, opt).map((b) => b.k), ["1111111111111111"]);
    // 2 ein Vault aus vaults.json gilt nie als verwaist (auch wenn sein Ordner gerade fehlt)
    const bekannt = join(h.a.basis, "Bekannt");
    neuerBlock("2222222222222222", bekannt);
    assert.ok(findeVerwaiste(h.gitGlobal, opt).some((b) => b.k === "2222222222222222"));
    writeFileSync(join(h.a.support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: bekannt, name: "Bekannt" }], aktiv: bekannt }));
    assert.ok(!findeVerwaiste(h.gitGlobal, opt).some((b) => b.k === "2222222222222222"));
    // 3 ein Block mit mehr als 20 Zeilen ist nicht (mehr) von Kortex
    const lang = einbindungsBlock({ vaultEcht: join(h.a.basis, "Weg3"), datei: dateiK("3333333333333333"), k: "3333333333333333", caseInsensitiv: false }).replace("\n# <<<", `\n${"# Notiz des Nutzers\n".repeat(25)}# <<<`);
    setzeBlock(h.gitGlobal, "3333333333333333", lang);
    assert.ok(!leseBloecke(h.gitGlobal, opt).some((b) => b.k === "3333333333333333"));
    // 4 die Datei im Block liegt nicht unter <Support>/git/<k>.gitconfig → wird nie gelöscht
    const fremd = join(h.a.basis, "meine-datei.cfg");
    neuerBlock("4444444444444444", join(h.a.basis, "Weg4"), fremd);
    const zz = h.z(); zz.volumenWurzel = vol;
    const r = raeume(zz, { was: "verwaist", bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(existsSync(fremd), "die fremde Datei bleibt");
    assert.ok(!readFileSync(h.gitGlobal, "utf8").includes("4444444444444444"), "der Block ist weg");
    assert.ok(!existsSync(dateiK("1111111111111111")), "die eigene Datei des verwaisten Blocks liegt in der Sicherung");
    assert.ok(existsSync(dateiK("2222222222222222")), "der bekannte Vault behält seine Datei");
    assert.ok(z);
  } finally { h.weg(); }
});

// --- B0 / Prozesse / Macs / Fingerabdruck ------------------------------------------------------------------------------------------------------------------------------
test("B0 schreibt die neue Sicherung zuerst: scheitert sie (kein Platz), bleibt die alte unberührt", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    await tuerOffen(h);
    const z = h.z();
    const alt = join(ablageOrdner(z), "vor-phase-b.bundle");
    writeFileSync(alt, "ALTE SICHERUNG");
    z.freierPlatz = () => 0;
    const knapp = await phaseB(z, { bestaetigt: true, entscheidungen: BEST });
    assert.equal(knapp.ok, false); assert.equal(knapp.fehlerBei, "B0"); assert.equal(knapp.grund, "zu-wenig-platz");
    assert.equal(readFileSync(alt, "utf8"), "ALTE SICHERUNG", "die alte Sicherung ist unberührt");
    delete z.freierPlatz;
    const r = await phaseB(z, { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.notEqual(readFileSync(alt).toString("latin1").slice(0, 14), "ALTE SICHERUNG", "ersetzt");
    assert.ok(!existsSync(`${alt}.neu`));
  } finally { h.weg(); }
});

test("Prozessprüfung fail-closed: pgrep scheitert/fehlt → Tor rot „konnte nicht prüfen“; lsof findet relative Starts; Grenze steht im Text", async () => {
  const h = umstellungsFixture(REICH_B);
  const merken = { p: process.env.KORTEX_PGREP, l: process.env.KORTEX_LSOF };
  try {
    await phaseAFertig(h);
    const skript = (name, inhalt) => { const p = join(h.a.basis, name); writeFileSync(p, `#!/bin/sh\n${inhalt}\n`); chmodSync(p, 0o755); return p; };
    process.env.KORTEX_PGREP = skript("pgrep-nichts", "exit 1");
    let b = bedingung(tor(h), "prozesse");
    assert.equal(b.erfuellt, true);
    assert.match(b.text, /anderen Weg|anderem Weg/, "die Grenze steht im Text");
    process.env.KORTEX_PGREP = skript("pgrep-fehler", "exit 2");
    b = bedingung(tor(h), "prozesse");
    assert.equal(b.erfuellt, false); assert.equal(b.grund, "konnte-nicht-pruefen"); assert.match(b.text, /nicht prüfen/);
    process.env.KORTEX_PGREP = join(h.a.basis, "gibt-es-nicht");
    assert.equal(bedingung(tor(h), "prozesse").grund, "konnte-nicht-pruefen");
    process.env.KORTEX_PGREP = skript("pgrep-nichts2", "exit 1");
    process.env.KORTEX_LSOF = skript("lsof-treffer", "echo 424242");
    b = bedingung(tor(h), "prozesse");
    assert.equal(b.erfuellt, false); assert.equal(b.grund, "laufende-prozesse"); assert.equal(b.details.anzahl, 1);
    process.env.KORTEX_LSOF = skript("lsof-leer", "exit 1");
    assert.equal(bedingung(tor(h), "prozesse").erfuellt, true);
  } finally { for (const [k, v] of [["KORTEX_PGREP", merken.p], ["KORTEX_LSOF", merken.l]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } h.weg(); }
});

test("Fingerabdruck des Probelaufs enthält HEAD und den Index (nicht die Bytes der Index-Datei)", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    await tuerOffen(h);
    assert.equal(probelaufBStand(h.z()).gueltig, true);
    sh(h, "status", "--porcelain");                               // schreibt den Index neu (Zeitstempel) – darf nichts ändern
    assert.equal(probelaufBStand(h.z()).gueltig, true);
    writeFileSync(join(h.a.vault, "09_wiki", "neu.md"), "# Neu\n");
    assert.equal(probelaufBStand(h.z()).gueltig, true, "eine neue Notiz im Arbeitsbaum ändert nichts");
    sh(h, "add", "--", "09_wiki/neu.md");
    assert.equal(probelaufBStand(h.z()).grund, "veraltet", "vorgemerkte Änderung → Index anders");
    sh(h, "reset", "-q", "--", "09_wiki/neu.md");
    assert.equal(probelaufBStand(h.z()).gueltig, true);
    sh(h, "commit", "-q", "--allow-empty", "-m", "leer");
    assert.equal(probelaufBStand(h.z()).grund, "veraltet", "neuer Commit → HEAD anders");
  } finally { h.weg(); }
});

// --- Verweis, Platz, Sperre --------------------------------------------------------------------------------------------------------------------------------------------
test("Versionierter Verweis .tools: der Revert stellt ihn her, der Rückweg meldet nichts Falsches (kein „ziel-ist-anders“)", async () => {
  const h = umstellungsFixture(["kit-verweis", "altfelder"]);
  try {
    sh(h, "add", "--", ".tools"); sh(h, "commit", "-q", "-m", "Verweis versioniert");
    await phaseAFertig(h);
    const vor = vaultStand(h);
    await tuerOffen(h);
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!existsSync(kit(h)) && sh(h, "ls-files", "--", ".tools") === "");
    const rw = await zurueckB(h.z());
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
    assert.ok(lstatSync(kit(h)).isSymbolicLink());
    assert.equal(vaultStand(h), vor);
  } finally { h.weg(); }
});

test("Zurückkopieren über die Laufwerksgrenze prüft den Platz: zu wenig → Hinweis, nichts Halbes, später mit Platz byte-genau", async () => {
  const h = umstellungsFixture(["kit-unversioniert", "altfelder", "hooks-alt-sh"]);
  try {
    await phaseAFertig(h);
    writeFileSync(join(kit(h), "lokal.txt"), "lokal\n");
    const vor = vaultStand(h), kitHash = baumHash(kit(h));
    const z = h.z(); z.umbenenner = exdev;
    await tuerOffen({ ...h, z: () => z });
    assert.equal((await phaseB(z, { bestaetigt: true, entscheidungen: BEST })).ok, true);
    z.freierPlatz = () => 0;
    const knapp = await zurueckB(z);
    assert.ok(knapp.hinweise.includes("B1:zu-wenig-platz"), JSON.stringify(knapp));
    assert.ok(!existsSync(kit(h)), "nichts Halbes im Vault");
    assert.ok(readdirSync(ablageOrdner(z)).some((n) => n.startsWith("kit-")), "das Archiv ist noch da");
    assert.equal(liesZustand(z).schritte.B1.status, "ok", "der Schritt gilt weiter als erledigt, ein neuer Versuch ist möglich");
    delete z.freierPlatz;
    const rw = await zurueckB(z);
    assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
    assert.equal(baumHash(kit(h)), kitHash);
    assert.equal(vaultStand(h), vor);
  } finally { h.weg(); }
});

test("Sperre während Phase B und ihres Rückwegs: eigene Datei .logs/umstellung-phase-b.lock (pid, zeit) neben ingest.lock, danach weg (Lesen: Tests/Node/umstellung-phase-b.test.mjs)", async () => {
  const h = umstellungsFixture([...REICH_B.filter((f) => f !== "kit-versioniert"), "kit-unversioniert"]);
  try {
    await phaseAFertig(h);
    await tuerOffen(h);
    const z = h.z();
    const lock = join(h.a.vault, ".logs", "umstellung-phase-b.lock");
    let waehrend = null;
    z.umbenenner = (a, b) => { waehrend = { datei: existsSync(lock), inhalt: existsSync(lock) ? JSON.parse(readFileSync(lock, "utf8")) : null, ingest: existsSync(join(h.a.vault, ".logs", "ingest.lock")) }; renameSync(a, b); };
    assert.equal((await phaseB(z, { bestaetigt: true, entscheidungen: BEST })).ok, true);
    assert.equal(waehrend.datei, true); assert.equal(waehrend.ingest, true);
    assert.equal(waehrend.inhalt.pid, process.pid); assert.ok(Date.parse(waehrend.inhalt.zeit) > Date.now() - 60_000);
    assert.ok(!existsSync(lock), "nach Phase B ist die Sperre gelöst");
    z.umbenenner = (a, b) => { waehrend = { datei: existsSync(lock) }; renameSync(a, b); };
    waehrend = null;
    await zurueckB(z);
    assert.deepEqual(waehrend, { datei: true });
    assert.ok(!existsSync(lock));
    // auch nach einem Abbruch bleibt keine Sperre liegen
    await tuerOffen(h);
    await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST, abbruchNach: "B1" }), TestAbbruch);
    assert.ok(!existsSync(lock));
  } finally { h.weg(); }
});
