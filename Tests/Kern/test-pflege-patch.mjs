// .tools/tests/test-pflege-patch.mjs — B3 Paket B3 (Nachbesserung 2): Anzeige und Bindung des Lernmodus-Patches.
// Anzeige filtert Kopfzeilen nur VOR dem ersten @@ je Datei (Inhalt wie „++ x“ bleibt sichtbar); Binärdateien sind in Pflege-Einheiten
// ein Verstoß; der Patch trägt den Stand der berührten Seiten (seitenSha) — eine seither geänderte Seite wird nie überschrieben.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { isoliere, git, JETZT } from "./tageslauf-hilfe.mjs";
import { neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
const P = await import("../tageslauf/pflege-kopie.mjs");
const PA = await import("../tageslauf/pflege-patch.mjs");
const D = await import("../tageslauf/diffpruefung.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
isoliere();

const ORION = "09_wiki/wissen/orion.md";
const zeilen = Array.from({ length: 12 }, (_, i) => `Zeile ${i + 1}.`);
const orion = () => seite({ name: "orion", description: "Orion" }, `# Orion\n\n-- alter Strich\n${zeilen.join("\n")}\n`);
const schreibe = (p, rel, text) => { mkdirSync(dirname(join(p, rel)), { recursive: true }); writeFileSync(join(p, rel), text); };

let nr = 0;
const kopien = [];
afterEach(() => { for (const [v, k] of kopien.splice(0)) { try { verwerfeArbeitskopie(v, k); } catch { /* schon weg */ } } });
async function einheit(v, arbeit, opt = {}) {
  const ctx = pflegeCtx(v, { jetzt: JETZT + (nr++) * 1000 });
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  kopien.push([v, kopie]);
  const erg = await P.einheit(ctx, kopie, { id: "u-1", art: "inbox", titel: "u", arbeit, ...opt });
  return { ctx, kopie, erg };
}

test("patchAnzeige: Kopfzeilen nur vor dem ersten @@ — Inhalt „++ x“ und „-- y“ bleibt als „+++ x“ / „--- y“ sichtbar", async () => {
  const v = neuerPflegeVault({ seiten: { [ORION]: orion() } });
  const { ctx, kopie, erg } = await einheit(v, async (p) => {
    const t = readFileSync(join(p, ORION), "utf8").replace("-- alter Strich\n", "").replace("Zeile 12.\n", "Zeile 12.\n++ neuer Plus\n");
    writeFileSync(join(p, ORION), t);
    return { ok: true };
  });
  assert.equal(erg.ok, true, JSON.stringify(erg));
  const a = PA.patchAnzeige(ctx, kopie, erg.commit);
  assert.match(a, /^Datei: 09_wiki\/wissen\/orion\.md$/m);
  assert.match(a, /^\+\+\+ neuer Plus$/m, "hinzugefügte Zeile „++ neuer Plus“ darf nicht als Kopfzeile verschluckt werden");
  assert.match(a, /^--- alter Strich$/m, "entfernte Zeile „-- alter Strich“ darf nicht als Kopfzeile verschluckt werden");
  assert.doesNotMatch(a, /^(index |--- a\/|\+\+\+ b\/|new file mode|deleted file mode)/m, "echte Kopfzeilen bleiben weg");
  assert.match(a, /^@@ /m);
});

test("patchAnzeige: zwei Dateien — Kopfzeilen beider Dateien weg, neue Datei ohne „new file mode“, Inhalt bleibt", async () => {
  const v = neuerPflegeVault({ seiten: { [ORION]: orion() } });
  const { ctx, kopie, erg } = await einheit(v, async (p) => {
    writeFileSync(join(p, ORION), readFileSync(join(p, ORION), "utf8") + "Neu.\n");
    schreibe(p, "30_wissen/quelle.md", "# Quelle\n\n++ Doppelplus in der Quelle\n");
    return { ok: true, neueQuellen: ["30_wissen/quelle.md"] };
  });
  assert.equal(erg.ok, true, JSON.stringify(erg));
  const a = PA.patchAnzeige(ctx, kopie, erg.commit);
  assert.match(a, /^Datei: 09_wiki\/wissen\/orion\.md$/m);
  assert.match(a, /^Datei: 30_wissen\/quelle\.md$/m);
  assert.match(a, /^\+\+\+ Doppelplus in der Quelle$/m);
  assert.doesNotMatch(a, /^(index |--- \/dev\/null|--- a\/|\+\+\+ b\/|new file mode)/m);
});

test("Binärdatei in einer Pflege-Einheit ist ein Verstoß (binaer) — nie „Binary files differ“ zur Freigabe", async () => {
  const v = neuerPflegeVault({ seiten: { [ORION]: orion() } });
  const { kopie, erg } = await einheit(v, async (p) => {
    writeFileSync(join(p, ORION), readFileSync(join(p, ORION), "utf8") + "Neu.\n");
    mkdirSync(join(p, "30_wissen"), { recursive: true });
    writeFileSync(join(p, "30_wissen/bild.md"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff, 0xfe]));
    return { ok: true, neueQuellen: ["30_wissen/bild.md"] };
  });
  assert.equal(erg.ok, false);
  assert.equal(erg.grund, "diff-rot");
  assert.ok(erg.befunde.some((b) => b.regel === "binaer" && b.pfad === "30_wissen/bild.md"), JSON.stringify(erg.befunde));
});

test("Binärdatei ohne NUL-Byte (ungültiges UTF-8) zählt ebenfalls als binär; reine Text-Umlaute nicht", async () => {
  const v = neuerPflegeVault({ seiten: { [ORION]: orion() } });
  const { kopie, erg } = await einheit(v, async (p) => {
    writeFileSync(join(p, ORION), readFileSync(join(p, ORION), "utf8") + "Neu.\n");
    mkdirSync(join(p, "30_wissen"), { recursive: true });
    writeFileSync(join(p, "30_wissen/roh.md"), Buffer.from([0xff, 0xfe, 0xfd, 0x41, 0x42]));
    return { ok: true, neueQuellen: ["30_wissen/roh.md"] };
  });
  assert.equal(erg.grund, "diff-rot");
  assert.ok(erg.befunde.some((b) => b.regel === "binaer"), JSON.stringify(erg.befunde));
  const v2 = neuerPflegeVault({ seiten: { [ORION]: orion() } });
  const r2 = await einheit(v2, async (p) => { writeFileSync(join(p, ORION), readFileSync(join(p, ORION), "utf8") + "Größe: 12 Müller-Straße — ünïcödé.\n"); return { ok: true }; });
  assert.equal(r2.erg.ok, true, JSON.stringify(r2.erg));
});

test("pruefeDiff: d.binaer → Regel binaer (auch für eine Wiki-Seite)", () => {
  const OPT = { wiki: "09_wiki", cluster: ["30_wissen"], jetzt: Date.now() };
  const r = D.pruefeDiff([{ pfad: ORION, status: "geaendert", alt: "---\nname: x\n---\nA\n", neu: "---\nname: x\n---\nA\nB\n", binaer: true }], OPT);
  assert.deepEqual(r.befunde.map((b) => b.regel), ["binaer"]);
});

test("seitenStand: Blob-sha der berührten Dateien VOR der Einheit (neue Datei → null), nie _log.md; seitenAbweichung findet genau die geänderte Seite", async () => {
  const v = neuerPflegeVault({ seiten: { [ORION]: orion() } });
  const { ctx, kopie, erg } = await einheit(v, async (p) => {
    writeFileSync(join(p, ORION), readFileSync(join(p, ORION), "utf8") + "Neu.\n");
    schreibe(p, "30_wissen/quelle.md", "# Quelle\n");
    return { ok: true, neueQuellen: ["30_wissen/quelle.md"] };
  });
  assert.equal(erg.ok, true, JSON.stringify(erg));
  const st = PA.seitenStand(ctx, kopie, erg.commit);
  assert.deepEqual(Object.keys(st).sort(), [ORION, "30_wissen/quelle.md"].sort());
  assert.match(st[ORION], /^[0-9a-f]{40}$/);
  assert.equal(st["30_wissen/quelle.md"], null, "neue Datei: gab es vorher nicht");
  assert.equal(st[ORION], git(v, "rev-parse", `main:${ORION}`), "der Stand von main, auf dem die Einheit aufbaute");
  // gleiche Basis (frische Kopie von main): keine Abweichung
  const ctx2 = pflegeCtx(v, { jetzt: JETZT + 500000 });
  const k2 = P.legePflegeKopieAn(v, ctx2.lauf);
  kopien.push([v, k2]);
  assert.deepEqual(PA.seitenAbweichung(ctx2, k2.pfad, st), []);
  // die Seite ändert sich auf main (konfliktfrei an anderer Stelle) → genau diese Seite weicht ab
  writeFileSync(join(v, ORION), readFileSync(join(v, ORION), "utf8").replace("# Orion\n", "# Orion\n\nVon Hand.\n"));
  git(v, "add", "--", ORION); git(v, "commit", "-qm", "von Hand");
  const ctx3 = pflegeCtx(v, { jetzt: JETZT + 600000 });
  const k3 = P.legePflegeKopieAn(v, ctx3.lauf);
  kopien.push([v, k3]);
  assert.deepEqual(PA.seitenAbweichung(ctx3, k3.pfad, st), [ORION]);
  // eine Datei, die es bei der Vorlage nicht gab, jetzt aber gibt → ebenfalls Abweichung
  schreibe(join(v), "30_wissen/quelle.md", "# andere Quelle\n");
  git(v, "add", "--", "30_wissen/quelle.md"); git(v, "commit", "-qm", "Quelle von Hand");
  const ctx4 = pflegeCtx(v, { jetzt: JETZT + 700000 });
  const k4 = P.legePflegeKopieAn(v, ctx4.lauf);
  kopien.push([v, k4]);
  assert.deepEqual(PA.seitenAbweichung(ctx4, k4.pfad, st).sort(), [ORION, "30_wissen/quelle.md"].sort());
});
