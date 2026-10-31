// test-umstellung-geraet-version.mjs — Paket P7d, Review 2: die laufend erneuerte Kortex-Version steht in einer EIGENEN Datei je Mac (.kortex/versionen/<ID>.json), nicht im Gerätemerker von A8/B3.
// Sonst ließe ein späterer Commit „Gerät aktualisiert“ neben der Zeile von B3 den Revert von B3 (und A8) an einem Konflikt scheitern. Echtes git, nur Temp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { umstellungsFixture, inhaltsStand } from "./umstellung-hilfe.mjs";
import { phaseAFertig, tuerOffen, tor, bedingung, BEST, REICH_B, json, gitIn } from "./umstellung-hilfe-b.mjs";
import { phaseB } from "../umstellung/phase-b.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { liesZustand } from "../umstellung/protokoll.mjs";
import { aktualisiereGeraetemerker, geraeteId, versionRel, liesGeraeteVersion } from "../umstellung/geraete.mjs";
import { baumHash } from "../umstellung/baum.mjs";
import { kernVersion } from "../pfade.mjs";

const sh = (h, ...a) => gitIn(h.a.vault, ...a);
const ohneVersionen = (h) => inhaltsStand(h.a.vault, { ohne: [".git", ".logs", "versionen"] });
// „Kortex wurde aktualisiert“: die Datei trägt eine ältere Version (im Verlauf), der Sitzungsstart erneuert sie und committet nur sie
function aktualisierungen(h, z, gid, n) {
  const rel = versionRel(gid), datei = join(h.a.vault, rel);
  for (let i = 0; i < n; i++) {
    mkdirSync(join(h.a.vault, ".kortex", "versionen"), { recursive: true });
    writeFileSync(datei, JSON.stringify({ kortexVersion: `0.${i + 1}.0` }, null, 2) + "\n");
    sh(h, "add", "--", rel); sh(h, "commit", "-q", "-m", `Version 0.${i + 1}.0`, "--", rel);
    assert.equal(aktualisiereGeraetemerker(z), "aktualisiert");
    assert.equal(liesGeraeteVersion(h.a.vault, gid), kernVersion());
    assert.deepEqual(sh(h, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter(Boolean), ["Kortex: Gerät aktualisiert", rel], "ein Commit, nur diese Datei");
  }
}

test("Phase B → mehrere „Gerät aktualisiert“ → Rückweg Byte für Byte (B3 lässt sich zurücknehmen)", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const z = h.z(), gid = geraeteId(z, { anlegen: false });
    const vor = ohneVersionen(h), kitHash = baumHash(join(h.a.vault, ".tools"));
    aktualisierungen(h, z, gid, 1);
    await tuerOffen(h);
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    const merkerNachB = readFileSync(join(h.a.vault, ".kortex", "geraete", `${gid}.json`), "utf8");
    assert.equal(json(join(h.a.vault, ".kortex", "geraete", `${gid}.json`)).phaseB.length, 10);
    aktualisierungen(h, z, gid, 3);                           // drei Kortex-Updates nach Phase B
    assert.equal(readFileSync(join(h.a.vault, ".kortex", "geraete", `${gid}.json`), "utf8"), merkerNachB, "der Gerätemerker bleibt unberührt");
    const rw = await rueckweg(z, { bestaetigt: true, schritte: ["B3", "B2", "B1"] });
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
    assert.equal(baumHash(join(h.a.vault, ".tools")), kitHash);
    assert.equal(ohneVersionen(h), vor);
    assert.equal(liesGeraeteVersion(h.a.vault, gid), kernVersion(), "die Versionsdatei gehört dem Auffrischer und bleibt");
  } finally { h.weg(); }
});

test("Phase A (A8) / „alles zurück“ nach mehreren Auffrischungen: der Revert von A8 geht ohne Konflikt", async () => {
  const h = umstellungsFixture(["kit-versioniert", "hooks-alt-sh", "altfelder"]);
  try {
    sh(h, "add", "--", "brain.config.json"); sh(h, "commit", "-q", "-m", "Config");
    const configVor = readFileSync(join(h.a.vault, "brain.config.json"), "utf8");
    await phaseAFertig(h, { configCommit: false });
    const z = h.z(), gid = geraeteId(z, { anlegen: false });
    aktualisierungen(h, z, gid, 3);
    const rw = await rueckweg(z, { bestaetigt: true, alles: true });
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.deepEqual(rw.hinweise, [], JSON.stringify(rw));
    assert.ok(!existsSync(join(h.a.vault, ".kortex", "geraete", `${gid}.json`)), "der Gerätemerker ist zurückgenommen");
    assert.equal(readFileSync(join(h.a.vault, "brain.config.json"), "utf8"), configVor);
    assert.equal(liesZustand(z).phase, null);
  } finally { h.weg(); }
});

test("Tor „macs“ liest die Version aus der eigenen Datei, fällt auf das Feld im Merker zurück (Migration) und verlangt den Merker dieses Macs", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const z = h.z(), gid = geraeteId(z, { anlegen: false });
    h.a.schreibe(join(h.a.vault, ".kortex", "geraete", "cccccccccccc.json"), JSON.stringify({ name: "C", kortexVersion: "0.1.0", phaseA: "2026-10-01" }));
    assert.equal(bedingung(tor(h), "macs").grund, "geraet-zu-alt", "nur das alte Feld im Merker: zu alt");
    assert.match(bedingung(tor(h), "macs").text, /Öffne Kortex dort/);
    // die eigene Datei von Mac C trägt die aktuelle Version → gilt
    h.a.schreibe(join(h.a.vault, versionRel("cccccccccccc")), JSON.stringify({ kortexVersion: kernVersion() }));
    assert.equal(bedingung(tor(h), "macs").erfuellt, true, JSON.stringify(bedingung(tor(h), "macs")));
    assert.equal(bedingung(tor(h), "macs").details.macs, 2, "die Versionsdatei zählt nicht als eigener Mac");
    // Migration: ein Merker im alten Format mit aktueller Version im Feld und ohne Versionsdatei funktioniert weiter
    rmSync(join(h.a.vault, versionRel("cccccccccccc")));
    h.a.schreibe(join(h.a.vault, ".kortex", "geraete", "cccccccccccc.json"), JSON.stringify({ name: "C", kortexVersion: kernVersion(), phaseA: "2026-10-01" }));
    assert.equal(bedingung(tor(h), "macs").erfuellt, true);
    // dieser Mac ohne Merker → rot
    sh(h, "rm", "-q", "--", `.kortex/geraete/${gid}.json`);
    assert.equal(bedingung(tor(h), "macs").grund, "dieser-mac-ohne-merker");
    assert.equal(aktualisiereGeraetemerker(z), "kein-merker");
  } finally { h.weg(); }
});

test("Auffrischen: nur bei Bedarf, alte Sperren blockieren nicht, ein laufendes rebase/cherry-pick des Nutzers wird nie gestört, ein gescheiterter Commit hinterlässt nichts", async () => {
  const h = umstellungsFixture(REICH_B);
  try {
    await phaseAFertig(h);
    const z = h.z(), gid = geraeteId(z, { anlegen: false });
    const rel = versionRel(gid), datei = join(h.a.vault, rel);
    // Merker aus der Zeit davor (Version nur im Feld, alt) → wird in die eigene Datei übernommen, der Merker selbst bleibt
    const merkerPfad = join(h.a.vault, ".kortex", "geraete", `${gid}.json`);
    writeFileSync(merkerPfad, JSON.stringify({ ...json(merkerPfad), kortexVersion: "0.1.0" }, null, 2) + "\n"); sh(h, "commit", "-q", "-am", "alt");
    const merkerText = readFileSync(merkerPfad, "utf8");
    // Sperren: eine frische ingest.lock blockiert, eine alte (über 30 Minuten) nicht; die Sperre von Phase B nur mit lebendem Prozess
    mkdirSync(join(h.a.vault, ".logs"), { recursive: true });
    const ingest = join(h.a.vault, ".logs", "ingest.lock"), pb = join(h.a.vault, ".logs", "umstellung-phase-b.lock");
    writeFileSync(ingest, "x");
    assert.equal(aktualisiereGeraetemerker(z), "gesperrt");
    const alt = new Date(Date.now() - 2 * 3600_000); utimesSync(ingest, alt, alt);
    writeFileSync(pb, JSON.stringify({ pid: 2147483646, zeit: new Date().toISOString() }));
    // laufendes cherry-pick/revert des Nutzers: nichts anfassen (Marke genügt – die Prüfung ist dieselbe wie beim Rückweg)
    writeFileSync(join(h.a.vault, ".git", "CHERRY_PICK_HEAD"), sh(h, "rev-parse", "HEAD") + "\n");
    assert.equal(aktualisiereGeraetemerker(z), "git-beschaeftigt");
    rmSync(join(h.a.vault, ".git", "CHERRY_PICK_HEAD"));
    // Commit scheitert (Sperre im Verlauf): Index UND Arbeitsbaum sind danach sauber
    writeFileSync(join(h.a.vault, ".git", "index.lock"), "");
    assert.equal(aktualisiereGeraetemerker(z), "commit-fehlgeschlagen");
    rmSync(join(h.a.vault, ".git", "index.lock"));
    assert.ok(!existsSync(datei), "die Datei liegt nicht herum, die nächste Sicherung nimmt nichts mit");
    assert.equal(sh(h, "status", "--porcelain"), "");
    // jetzt klappt es (die tote Sperre und die alte ingest.lock stören nicht)
    assert.equal(aktualisiereGeraetemerker(z), "aktualisiert");
    assert.equal(readFileSync(merkerPfad, "utf8"), merkerText, "der Gerätemerker ist unberührt");
    assert.equal(aktualisiereGeraetemerker(z), "aktuell");
    // eine nicht saubere Versionsdatei wird nicht überschrieben
    writeFileSync(datei, JSON.stringify({ kortexVersion: "0.0.1" }));
    assert.equal(aktualisiereGeraetemerker(z), "datei-nicht-sauber");
  } finally { h.weg(); }
});
