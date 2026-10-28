// .tools/tests/test-pflege-sperre.mjs — B3 W4: Themen-Guard auch für das, was Sonnet LIEST. Vor jedem Sonnet-Lauf werden Seiten/Notizen,
// die ein ausgeschlossenes Thema nennen (ernteOhneThema) oder in einem ausgeschlossenen Ordner liegen (ernteNichtIn), aus der
// ARBEITSKOPIE entfernt (nur Kopie) und danach wiederhergestellt; legt die KI sie neu an, wird die Einheit verworfen. `brain search`
// im Sonnet-Lauf (BRAIN_ERNTE=1) fragt nie den qmd-Index des echten Vaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, git, JETZT, KIT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
const I = await import("../tageslauf/inbox-schritt.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const D = await import("../tageslauf/diffpruefung.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
isoliere();

const ORION = "09_wiki/wissen/orion.md", JARVIS = "09_wiki/wissen/jarvis.md", PRIVAT = "20_firma/privat/tagebuch.md";
const SEITEN = {
  [ORION]: seite({ name: "orion", description: "Orion" }, "# Orion\n\nOrion ist der Testdienst.\n"),
  [JARVIS]: seite({ name: "jarvis", description: "Jarvis" }, "# Jarvis\n\nJarvis ist der private Bot.\n"),
};
const ANTWORT = (ziel, seiten) => `Erledigt.\n${JSON.stringify({ ziel, seiten, kurz: "ergänzt" })}`;
let nr = 0;
async function lauf(v) {
  const ctx = pflegeCtx(v, { jetzt: JETZT + (nr++) * 1000 });
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try { return { ctx, kopie, posten: await I.inboxSchritt(ctx, kopie) }; }
  catch (e) { verwerfeArbeitskopie(v, kopie); throw e; }
}
// Skript, das der fake-sonnet im Arbeitsverzeichnis startet: schreibt, welche Dateien die KI jetzt sieht.
function spaeher(pfade) {
  const d = tempOrdner("spaeher");
  const aus = join(d, "gesehen.json");
  writeFileSync(join(d, "s.mjs"), `import { existsSync, writeFileSync } from "node:fs"; import { join } from "node:path";\n`
    + `writeFileSync(${JSON.stringify(aus)}, JSON.stringify(Object.fromEntries(${JSON.stringify(pfade)}.map((p) => [p, existsSync(join(process.cwd(), p))]))));\n`);
  return { skript: join(d, "s.mjs"), gesehen: () => JSON.parse(readFileSync(aus, "utf8")) };
}

test("W4: Seite mit ausgeschlossenem Wort und Datei im ausgeschlossenen Ordner fehlen in der Kopie, solange die KI läuft — danach sind sie wieder da, die Einheit ist sauber", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "n.md": "# N\n\nOrion nutzt Redis.\n" },
    automatik: { tageslauf: "an", pflegeIntelligenz: "an", ernteOhneThema: ["jarvis"], ernteNichtIn: [] } });
  mkdirSync(join(v, "20_firma", "privat"), { recursive: true });
  writeFileSync(join(v, PRIVAT), "# Tagebuch\n\nGeheim.\n");
  git(v, "add", "--", PRIVAT); git(v, "commit", "-qm", "privat");
  const ctx0 = pflegeCtx(v);
  ctx0.werte.ernteNichtIn = [join(v, "20_firma", "privat")];                     // der Ordner liegt im Vault (nur so lässt er sich im Test festlegen)
  const sp = spaeher([ORION, JARVIS, PRIVAT]);
  fakeSonnet([{ wenn: "QUELLE: 00_inbox/n.md", antwort: ANTWORT("30_wissen/n.md", [ORION]), anhaengen: { [ORION]: "Orion nutzt Redis.\n" }, befehle: [[sp.skript]] }]);
  const kopie = P.legePflegeKopieAn(v, ctx0.lauf);
  try {
    const posten = await I.inboxSchritt(ctx0, kopie);
    assert.equal(posten[0].erg.ok, true, JSON.stringify(posten[0].erg));
    assert.deepEqual(sp.gesehen(), { [ORION]: true, [JARVIS]: false, [PRIVAT]: false }, "die KI sah nur, was erlaubt ist");
    assert.deepEqual([existsSync(join(kopie.pfad, JARVIS)), existsSync(join(kopie.pfad, PRIVAT)), git(v, "ls-files", PRIVAT)], [true, true, PRIVAT], "danach wiederhergestellt (nur die Kopie war betroffen)");
    assert.deepEqual(posten[0].erg.dateien.sort(), ["09_wiki/_log.md", ORION, "30_wissen/n.md"], "der Diff der Einheit enthält die Entfernung nicht");
    assert.ok(existsSync(join(v, JARVIS)) && existsSync(join(v, PRIVAT)), "echter Vault unberührt");
  } finally { verwerfeArbeitskopie(v, kopie); }
});

test("W4: legt die KI eine für sie entfernte Datei neu an → Einheit verworfen (thema-ausgeschlossen, gesperrt), die Datei bleibt wie im Vault", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "n.md": "# N\n\nOrion nutzt Redis.\n" },
    automatik: { tageslauf: "an", pflegeIntelligenz: "an", ernteOhneThema: ["jarvis"] } });
  fakeSonnet([{ wenn: "QUELLE: 00_inbox/n.md", antwort: ANTWORT("30_wissen/n.md", [ORION]), anhaengen: { [ORION]: "Orion nutzt Redis.\n" },
    dateien: { [JARVIS]: seite({ name: "jarvis", description: "Jarvis" }, "# Jarvis\n\nÜberschrieben.\n") } }]);
  const { kopie, posten } = await lauf(v);
  try {
    assert.equal(posten[0].erg.ok, false);
    assert.equal(posten[0].erg.grund, "thema-ausgeschlossen");
    assert.ok(posten[0].erg.befunde.some((b) => b.regel === "gesperrt"));
    assert.equal(readFileSync(join(kopie.pfad, JARVIS), "utf8").includes("Überschrieben"), false);
  } finally { verwerfeArbeitskopie(v, kopie); }
});

test("pruefeDiff: Option gesperrt — jede Berührung einer gesperrten Datei ist ein Verstoß", () => {
  const r = D.pruefeDiff([{ pfad: JARVIS, status: "geaendert", alt: "---\nname: j\n---\nx\n", neu: "---\nname: j\n---\ny\n" }], { wiki: "09_wiki", gesperrt: [JARVIS] });
  assert.deepEqual(r.befunde.map((b) => b.regel), ["gesperrt"]);
});

test("brain search im Sonnet-Lauf (BRAIN_ERNTE=1) fragt nie das qmd — nur die einfache Suche über den Vault des Aufrufs", () => {
  const v = neuerPflegeVault({ seiten: SEITEN });
  const d = tempOrdner("qmd");
  const marke = join(d, "marke");
  writeFileSync(join(d, "qmd.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marke)}, "gerufen"); console.log("0.9,/echter/vault/geheim.md");\n`);
  const such = (extra) => spawnSync(process.execPath, [join(KIT, "brain.mjs"), "search", "orion testdienst"],
    { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v, QMD_BIN: join(d, "qmd.mjs"), ...extra } });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ suche: { profil: "leicht" } }));
  such({});
  assert.equal(existsSync(marke), true, "Kontrolle: ohne BRAIN_ERNTE wird qmd gefragt");
  writeFileSync(marke, "");
  const r = such({ BRAIN_ERNTE: "1" });
  assert.equal(readFileSync(marke, "utf8"), "", "qmd wurde nicht gerufen");
  assert.match(r.stdout, /orion\.md/);
  assert.doesNotMatch(r.stdout, /echter/);
});
