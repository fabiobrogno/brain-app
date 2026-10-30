// test-umstellung-phase-b.mjs — Paket P7d: Phase B der Umstellung (Plan docs/plaene/p7-umstellung.md Abschnitt 4 und 6).
// Geprüft wird: das Freigabe-Tor (jede Bedingung einzeln rot, dann offen) · Probelauf an der Kopie (Original unberührt, Rückweg an der Kopie) · Phase B am Original: Archiv vollständig
// (Hash-Liste, auch Unversioniertes), ein Commit nur der genannten Pfade, Config bereinigt · Rückweg stellt den Vault Byte für Byte her (git revert + Archiv zurück) · Volume-Grenze
// (EXDEV simuliert: kopieren, vergleichen, dann entfernen) · Abbruch mittendrin · nichts ohne --ja. Nur Temp-HOME/-Support/-gitconfig; launchctl, claude und codex nur als Attrappe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, lstatSync, symlinkSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { umstellungsFixture, inhaltsStand } from "./umstellung-hilfe.mjs";
import { GEHEIM } from "./fixture-altvault.mjs";
import { phaseAFertig, tuerOffen, tor, bedingung, BEST, REICH_B, TAG, json, gitIn } from "./umstellung-hilfe-b.mjs";
import { phaseB, planPhaseB, TestAbbruch } from "../umstellung/phase-b.mjs";
import { probelaufB } from "../umstellung/probelauf-b.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { liesZustand, schreibeZustand, liesProtokoll, ablageOrdner } from "../umstellung/protokoll.mjs";
import { baumHash, baumEintraege } from "../umstellung/baum.mjs";
import { kernVersion } from "../pfade.mjs";
import { probelaufBStand } from "../umstellung/probelauf-b-merker.mjs";

const vaultStand = (h) => inhaltsStand(h.a.vault, { ohne: [".git", ".logs"] });
const kit = (h) => join(h.a.vault, ".tools");

test("Tor: jede Bedingung einzeln rot, am Ende offen", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    // 1 Phase A fehlt
    let t = tor(h);
    assert.equal(t.frei, false);
    assert.equal(bedingung(t, "phase-a").erfuellt, false);
    assert.equal(bedingung(t, "phase-a").grund, "nicht-umgestellt");
    await phaseAFertig(h);
    t = tor(h, {});
    assert.equal(bedingung(t, "phase-a").erfuellt, true);
    // 2 Release: gleiche Version wie bei Phase A → rot
    let zu = liesZustand(h.z());
    const echteVersion = zu.phaseA.kernVersion;
    zu.phaseA.kernVersion = kernVersion();
    schreibeZustand(h.z(), zu);
    assert.equal(bedingung(tor(h), "release").erfuellt, false);
    assert.equal(bedingung(tor(h), "release").grund, "gleiche-version");
    zu.phaseA.kernVersion = echteVersion; schreibeZustand(h.z(), zu);
    assert.equal(bedingung(tor(h), "release").erfuellt, true);
    // 3 Wartezeit: 6 Tage → rot (mit Resttagen), 8 Tage → grün; ein Fehler im Protokoll danach → rot
    zu.phaseA.zeit = new Date(Date.now() - 6 * TAG).toISOString(); schreibeZustand(h.z(), zu);
    assert.equal(bedingung(tor(h), "wartezeit").erfuellt, false);
    assert.equal(bedingung(tor(h), "wartezeit").grund, "zu-frueh");
    assert.equal(bedingung(tor(h), "wartezeit").details.noch, 1);
    assert.equal(bedingung(tor(h, BEST, { jetzt: Date.now() + 2 * TAG }), "wartezeit").erfuellt, true);
    zu.phaseA.zeit = new Date(Date.now() - 8 * TAG).toISOString(); schreibeZustand(h.z(), zu);
    assert.equal(bedingung(tor(h), "wartezeit").erfuellt, true);
    // 4 Macs: ein Mac im Vault ohne Phase A → rot; mit Phase A und zu alter Version → rot; ohne kernVersion → rot
    h.a.schreibe(join(h.a.vault, ".kortex", "geraete", "bbbbbbbbbbbb.json"), JSON.stringify({ name: `Mac-${GEHEIM}`, kortexVersion: "0.5.1" }));
    assert.equal(bedingung(tor(h), "macs").erfuellt, false);
    assert.equal(bedingung(tor(h), "macs").grund, "geraet-ohne-phase-a");
    h.a.schreibe(join(h.a.vault, ".kortex", "geraete", "bbbbbbbbbbbb.json"), JSON.stringify({ name: "B", kortexVersion: "0.1.0", phaseA: "2026-10-01" }));
    assert.equal(bedingung(tor(h), "macs").grund, "geraet-zu-alt");
    h.a.schreibe(join(h.a.vault, ".kortex", "geraete", "bbbbbbbbbbbb.json"), JSON.stringify({ name: "B", kortexVersion: "0.5.1", phaseA: "2026-10-01" }));
    assert.equal(bedingung(tor(h), "macs").erfuellt, true);
    assert.equal(bedingung(tor(h), "macs").details.macs, 2);
    const cfg = json(join(h.a.vault, "brain.config.json"));
    const ohneKv = { ...cfg }; delete ohneKv.kernVersion;
    writeFileSync(join(h.a.vault, "brain.config.json"), JSON.stringify(ohneKv, null, 2) + "\n");
    assert.equal(bedingung(tor(h), "macs").grund, "kernversion-fehlt");
    writeFileSync(join(h.a.vault, "brain.config.json"), JSON.stringify(cfg, null, 2) + "\n");
    // 5 Bestätigung
    assert.equal(bedingung(tor(h, {}), "bestaetigung").erfuellt, false);
    assert.equal(bedingung(tor(h, { keineAltenMacs: "ja" }), "bestaetigung").erfuellt, false, "nur ein echtes true zählt");
    assert.equal(bedingung(tor(h), "bestaetigung").erfuellt, true);
    // 6 Prozesse / 7 Restverweise / 8 Befund werden in eigenen Tests geprüft; hier: alles andere grün
    assert.equal(bedingung(tor(h), "prozesse").erfuellt, true);
    assert.equal(bedingung(tor(h), "restverweise").erfuellt, true);
    assert.equal(bedingung(tor(h), "befund").erfuellt, true);
    // 9 Probelauf fehlt → als einzige rot
    t = tor(h);
    assert.deepEqual(t.offen, ["probelauf"]);
    assert.equal(bedingung(t, "probelauf").grund, "fehlt");
    assert.equal(t.frei, false);
    // keine Werte, keine Namen von Macs
    assert.ok(!JSON.stringify(t).includes(GEHEIM));
  } finally { h.weg(); }
});

test("Tor: laufende Prozesse und Restverweise sperren; „Ist mir bewusst“ quittiert einzeln", async () => {
  const h = umstellungsFixture([...REICH_B, "shell-datei"]);
  let kind = null;
  try {
    await phaseAFertig(h);
    // E24: eine Shell-Datei nennt den alten Ordner → Restverweis
    let t = tor(h);
    assert.equal(bedingung(t, "restverweise").erfuellt, false);
    assert.deepEqual(bedingung(t, "restverweise").details.liste.map((x) => x.id), ["E24"]);
    t = tor(h, { ...BEST, bewusst: ["E24"] });
    assert.equal(bedingung(t, "restverweise").erfuellt, true);
    assert.equal(bedingung(t, "restverweise").details.liste[0].quittiert, true);
    assert.equal(bedingung(tor(h, { ...BEST, bewusst: ["E15"] }), "restverweise").erfuellt, false, "eine andere ID quittiert nichts");
    // E3: ein Programm läuft aus dem alten Ordner
    const { spawn } = await import("node:child_process");
    writeFileSync(join(kit(h), "server.mjs"), "setTimeout(() => {}, 120000);\n");
    kind = spawn(process.execPath, [join(kit(h), "server.mjs")], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 400));
    t = tor(h, { ...BEST, bewusst: ["E24"] });
    assert.equal(bedingung(t, "prozesse").erfuellt, false);
    assert.equal(bedingung(t, "prozesse").grund, "laufende-prozesse");
    assert.ok(bedingung(t, "prozesse").details.anzahl >= 1);
    kind.kill(); kind = null;
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(bedingung(tor(h, { ...BEST, bewusst: ["E24"] }), "prozesse").erfuellt, true);
  } finally { if (kind) kind.kill(); h.weg(); }
});

test("Ohne --ja nur der Plan samt Tor; mit --ja aber geschlossenem Tor: abgelehnt, nichts verändert", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const vor = vaultStand(h);
    const kopfVor = gitIn(h.a.vault, "rev-parse", "HEAD");
    const plan = await phaseB(h.z(), {});
    assert.equal(plan.plan, true);
    assert.deepEqual(plan.schritte.map((s) => s.id), ["B0", "B1", "B2", "B3", "B4"]);
    assert.equal(plan.tor.frei, false);
    assert.ok(plan.schritte.find((s) => s.id === "B2").entfernt.includes("werkzeuge") || plan.schritte.find((s) => s.id === "B2").entfernt.includes("kit"));
    for (const roh of [{ keineAltenMacs: "ja" }, { bewusst: ["../x"] }]) assert.equal((await phaseB(h.z(), { entscheidungen: roh })).plan, true);
    await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST }), (e) => e.code === "tor-zu" && e.exit === 4 && /Probelauf/.test(e.message));
    assert.equal(vaultStand(h), vor);
    assert.equal(gitIn(h.a.vault, "rev-parse", "HEAD"), kopfVor);
    assert.ok(existsSync(join(kit(h), "VERSION")));
    assert.equal(liesZustand(h.z()).phaseB, undefined);
  } finally { h.weg(); }
});

test("Probelauf B: grün, Original unberührt, Merker gilt nur für denselben Stand und 24 Stunden", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const vor = vaultStand(h);
    const kopfVor = gitIn(h.a.vault, "rev-parse", "HEAD");
    const kitHash = baumHash(kit(h));
    const r = await probelaufB(h.z(), { bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r.kriterien.filter((c) => c.status === "rot")) + JSON.stringify(r.schritte));
    assert.ok(r.kriterien.some((c) => c.id === "rueckweg" && c.status === "gruen"), "der Rückweg wurde an der Kopie erprobt");
    assert.ok(r.kriterien.some((c) => c.id === "original" && c.status === "gruen"));
    assert.equal(vaultStand(h), vor, "Original unverändert");
    assert.equal(gitIn(h.a.vault, "rev-parse", "HEAD"), kopfVor);
    assert.equal(baumHash(kit(h)), kitHash);
    assert.equal(r.kopieBehalten, null, "grün: die Kopie wird gelöscht");
    assert.equal(probelaufBStand(h.z()).gueltig, true);
    // Tor: nur noch die Bestätigung fehlt, mit ihr ist es offen
    assert.deepEqual(tor(h, {}).offen, ["bestaetigung"]);
    assert.equal(tor(h).frei, true);
    // Merker gilt nicht mehr, wenn sich der Stand ändert …
    const cfg = json(join(h.a.vault, "brain.config.json"));
    writeFileSync(join(h.a.vault, "brain.config.json"), JSON.stringify({ ...cfg, neu: 1 }, null, 2) + "\n");
    assert.equal(probelaufBStand(h.z()).grund, "veraltet");
    assert.equal(bedingung(tor(h), "probelauf").grund, "veraltet");
    writeFileSync(join(h.a.vault, "brain.config.json"), JSON.stringify(cfg, null, 2) + "\n");
    assert.equal(probelaufBStand(h.z()).gueltig, true);
    // … und nicht nach 24 Stunden
    assert.equal(probelaufBStand(h.z(), Date.now() + 25 * 3600_000).grund, "abgelaufen");
    // neue Notizen ändern ihn nicht
    writeFileSync(join(h.a.vault, "09_wiki", "neu.md"), "# Neu\n");
    assert.equal(probelaufBStand(h.z()).gueltig, true);
    // ohne Phase A kein Probelauf
  } finally { h.weg(); }
});

test("Phase B: Archiv vollständig (auch Unversioniertes), ein Commit nur der genannten Pfade, Config bereinigt; Rückweg stellt Byte für Byte her", async () => {
  const h = umstellungsFixture([...REICH_B.filter((f) => f !== "kit-versioniert"), "kit-aenderungen"]);
  try {
    await phaseAFertig(h);
    // Unversioniertes und lokale Änderungen im Kit-Ordner gehen mit ins Archiv; ein Notiz-Änderung außerhalb bleibt unberührt und kommt nicht in den Commit
    writeFileSync(join(kit(h), "lokal-unversioniert.txt"), `nur hier ${GEHEIM}\n`);
    chmodSync(join(kit(h), "git-hooks", "pre-commit"), 0o755);
    writeFileSync(join(h.a.vault, "09_wiki", "start.md"), "# Start\n\nGeändert, nicht im Commit.\n");
    const kitVorher = baumEintraege(kit(h));
    const kitHash = baumHash(kit(h));
    const vor = vaultStand(h);
    const treeVor = gitIn(h.a.vault, "rev-parse", "HEAD^{tree}");
    const kopfVor = gitIn(h.a.vault, "rev-parse", "HEAD");
    const configVor = readFileSync(join(h.a.vault, "brain.config.json"), "utf8");
    await tuerOffen(h);
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.phaseB, "fertig", JSON.stringify(r.b4));
    assert.equal(r.b4.ampel, "gruen", JSON.stringify(r.b4));
    assert.deepEqual(r.schritte.map((s) => [s.id, s.status]), [["B0", "ok"], ["B1", "ok"], ["B2", "ok"], ["B3", "ok"], ["B4", "ok"]]);
    const z = h.z();
    // Archiv: Name kit-<Datum> in der Ablage, Inhalt gleich dem alten Ordner (Rechte, Größen, Hashes), nichts mehr im Vault
    assert.match(r.archiv, /^kit-\d{4}-\d{2}-\d{2}$/);
    const archiv = join(ablageOrdner(z), r.archiv);
    assert.equal(baumHash(archiv), kitHash, "Archiv ist byte-gleich");
    assert.deepEqual([...baumEintraege(archiv)], [...kitVorher]);
    assert.ok(existsSync(join(archiv, "lokal-unversioniert.txt")));
    assert.ok(!existsSync(kit(h)), ".tools ist aus dem Vault verschwunden");
    assert.ok(existsSync(join(ablageOrdner(z), "vor-phase-b.bundle")), "Bundle als letzte Rettung");
    // Config bereinigt: Altfelder weg, backup.pfad weg (A1 hat ihn übernommen), Unbekanntes bleibt, kernVersion bleibt
    const cfg = json(join(h.a.vault, "brain.config.json"));
    for (const k of ["werkzeuge", "kit", "systemVersion", "updateHinweis", "vaultPath"]) assert.ok(!(k in cfg), k);
    assert.ok(!("pfad" in (cfg.backup || {})), "backup.pfad entfernt");
    assert.ok(cfg.kernVersion && cfg.ordner && cfg.sprache === "de");
    assert.match(readFileSync(join(h.a.vault, ".gitignore"), "utf8"), /^\.tools\/$/m);
    const merker = readdirSync(join(h.a.vault, ".kortex", "geraete")).map((n) => json(join(h.a.vault, ".kortex", "geraete", n)));
    assert.ok(merker.some((m) => typeof m.phaseA === "string" && typeof m.phaseB === "string"));
    // genau EIN Commit nur dieser Pfade; die geänderte Notiz bleibt ungespeichert
    assert.equal(gitIn(h.a.vault, "rev-list", "--count", `${kopfVor}..HEAD`), "1");
    assert.equal(gitIn(h.a.vault, "log", "-1", "--format=%s"), "Kortex: alten Werkzeug-Ordner entfernt");
    const geaendert = gitIn(h.a.vault, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    assert.ok(geaendert.every((p) => p.startsWith(".tools/") || ["brain.config.json", ".gitignore"].includes(p) || p.startsWith(".kortex/geraete/")), geaendert.join(","));
    assert.ok(geaendert.some((p) => p.startsWith(".tools/")) && !geaendert.includes("09_wiki/start.md"));
    assert.equal(gitIn(h.a.vault, "ls-files", "--", ".tools"), "");
    assert.match(gitIn(h.a.vault, "status", "--porcelain"), /09_wiki\/start\.md/, "Notiz-Änderung bleibt ungespeichert");
    // Protokoll und Zustand: keine Werte
    const prot = readFileSync(join(ablageOrdner(z), "protokoll.jsonl"), "utf8");
    assert.ok(!prot.includes(GEHEIM) && !prot.includes(h.a.home), "keine Werte im Protokoll");
    assert.equal(liesZustand(z).phase, "A");
    assert.equal(liesZustand(z).phaseB.status, "fertig");
    // Idempotenz: ein zweiter Lauf scheitert am Tor (Probelauf-Merker passt nicht mehr) und ändert nichts
    const nach = vaultStand(h);
    await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST }), (e) => e.code === "tor-zu");
    assert.equal(vaultStand(h), nach);

    // --- Rückweg: B3 (Revert) → B2 → B1 (Archiv zurück) ---
    const rw = await rueckweg(h.z(), { bestaetigt: true, schritte: ["B3", "B2", "B1"] });
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.deepEqual(rw.hinweise, []);
    assert.equal(baumHash(kit(h)), kitHash, ".tools ist wieder da, byte-gleich");
    assert.ok(!existsSync(archiv), "das Archiv ist zurückgewandert");
    assert.equal(readFileSync(join(h.a.vault, "brain.config.json"), "utf8"), configVor);
    assert.equal(gitIn(h.a.vault, "rev-parse", "HEAD^{tree}").length > 0, true);
    // der Verlauf: Commit + Revert; der Baum des Verlaufs ist wie vorher (die Notiz-Änderung liegt weiter nur im Arbeitsbaum)
    assert.equal(gitIn(h.a.vault, "rev-parse", "HEAD^{tree}"), treeVor);
    assert.equal(vaultStand(h), vor, "Vault Byte für Byte wie vor Phase B (inklusive Unversioniertem und Rechten)");
    assert.equal(liesZustand(h.z()).phaseB, undefined);
    assert.equal(liesZustand(h.z()).phase, "A");
    // der Rückweg ist selbst idempotent
    const rw2 = await rueckweg(h.z(), { bestaetigt: true, schritte: ["B3", "B2", "B1"] });
    assert.equal(rw2.ok, true);
    assert.equal(vaultStand(h), vor);
  } finally { h.weg(); }
});
