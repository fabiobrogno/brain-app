// Index-Cache der Suche (kern/minisuche.mjs): Ergebnisse bitgleich zur Suche ohne Cache, nur Geändertes wird neu gelesen, Vault-Wechsel,
// gelöschte/neue/umbenannte Dateien, frische Dateien, Speichergrenzen. Nur Temp-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync, renameSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad, WURZEL } from "./hilfe.mjs";
import { baueGrossVault } from "./gross-vault.mjs";
import { minisucheReferenz } from "./minisuche-referenz.mjs";

const { minisuche, leereMinisucheCache, minisucheStand, MINISUCHE_GRENZEN } = await import(pfad("kern", "minisuche.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));

const FRAGEN = ["retouren erstattung", "kunde wareneingang lieferant", "seite 17", "ber lo mi", "gibtesnirgends", "der die das", "stand 2026", "thema prozess entscheidung", "ÄÖÜ größe"];
// Treffer und Punktzahlen müssen bitgleich sein (deepEqual vergleicht Zahlen mit ===)
function gleich(vault, fragen = FRAGEN, n = 10) {
  for (const f of fragen) assert.deepEqual(minisuche(vault, f, n), minisucheReferenz(vault, f, n), `Frage „${f}“`);
}
const alt = (abs) => { const t = new Date(Date.now() - 3600 * 1000); utimesSync(abs, t, t); }; // nicht „frisch“

test("Cache: Fixture-Vault — gleiche Treffer und Punktzahlen wie ohne Cache, auch bei der zweiten Suche", () => {
  leereMinisucheCache();
  const d = tmp();
  cpSync(join(WURZEL, "..", "Tests", "Kern", "fixture"), d, { recursive: true });
  gleich(d); gleich(d);
});

test("Cache: synthetischer Vault (600 Dateien) — identisch, erste und folgende Suche", () => {
  leereMinisucheCache();
  const g = baueGrossVault(600, { start: 7, wortschatz: 3000 });
  const fragen = [...FRAGEN, `${g.wort()} ${g.wort()}`, `${g.wort()} ${g.wort()} ${g.wort()}`, g.wort()];
  gleich(g.vault, fragen); gleich(g.vault, fragen);
  const s = minisucheStand();
  assert.equal(s.dokumente, 600);
  assert.equal(s.gelesen, 600, "jede Datei genau einmal gelesen, obwohl 2 × 12 Suchen liefen");
});

test("Cache: nur geänderte, neue und gelöschte Dateien werden neu gelesen — Treffer bleiben gleich", () => {
  leereMinisucheCache();
  const g = baueGrossVault(300, { start: 3, wortschatz: 2000 });
  const fragen = [...FRAGEN, g.wort(), `${g.wort()} ${g.wort()}`];
  gleich(g.vault, fragen);
  const vorher = minisucheStand().gelesen;
  // geändert (anderer Inhalt und andere Größe), neu, gelöscht, umbenannt
  const aendere = g.dateien[10], loesche = g.dateien[20], benenne = g.dateien[30];
  g.aendere(aendere, `# Neu\n\nsonderbegriff-xyz ${g.wort()} ${g.wort()}\n`); alt(join(g.vault, aendere));
  g.neueSeite("09_wiki/neu/nagelneu.md", `# Nagelneu\n\nsonderbegriff-xyz und ${g.wort()}\n`); alt(join(g.vault, "09_wiki/neu/nagelneu.md"));
  rmSync(join(g.vault, loesche));
  renameSync(join(g.vault, benenne), join(g.vault, "09_wiki/umbenannt.md"));
  const f2 = [...fragen, "sonderbegriff xyz", "nagelneu", "umbenannt"];
  gleich(g.vault, f2);
  const s = minisucheStand();
  assert.equal(s.gelesen - vorher, 3, "geändert + neu + umbenannt (neuer Pfad) = 3 Lesevorgänge, alles andere aus dem Cache");
  assert.equal(s.dokumente, 300 + 1 - 1);
  assert.ok(minisuche(g.vault, "sonderbegriff xyz", 5).some((t) => t.pfad === "09_wiki/neu/nagelneu.md"));
  assert.ok(!minisuche(g.vault, "sonderbegriff xyz", 50).some((t) => t.pfad === loesche));
});

test("Cache: gleiche Größe, andere Änderungszeit → neu gelesen; gleiche Änderungszeit und Größe → Cache (nicht frisch)", () => {
  leereMinisucheCache();
  const d = tmp();
  schreibe(d, "a.md", "# A\n\nalpha alpha alpha\n"); schreibe(d, "b.md", "# B\n\nbeta beta beta\n");
  alt(join(d, "a.md")); alt(join(d, "b.md"));
  gleich(d, ["alpha", "beta"]);
  const n0 = minisucheStand().gelesen;
  gleich(d, ["alpha", "beta"]);
  assert.equal(minisucheStand().gelesen, n0, "nichts geändert → nichts gelesen");
  writeFileSync(join(d, "a.md"), "# A\n\nbeta beta beta\n"); // gleiche Größe, anderer Inhalt
  const t = new Date(Date.now() - 1800 * 1000); utimesSync(join(d, "a.md"), t, t);
  gleich(d, ["alpha", "beta"]);
  assert.equal(minisucheStand().gelesen - n0, 1);
  assert.deepEqual(minisuche(d, "alpha", 5), [], "alpha steht nirgends mehr");
});

test("Cache: frisch geschriebene Dateien (Änderungszeit < 2 s) werden bei jeder Suche neu gelesen — zwei Schreibvorgänge gleicher Größe und Zeit fallen auf", () => {
  leereMinisucheCache();
  const d = tmp();
  const feste = new Date(); // Änderungszeit festnageln: so verhält sich ein Dateisystem mit grober Zeitauflösung
  const schreibeFest = (text) => { writeFileSync(join(d, "a.md"), text); utimesSync(join(d, "a.md"), feste, feste); };
  schreibeFest("# A\n\nalpha\n");
  assert.equal(minisuche(d, "alpha", 5).length, 1);
  schreibeFest("# A\n\nbeta \n");                      // gleiche Größe, gleiche Zeit → gleicher Schlüssel
  assert.equal(minisuche(d, "beta", 5).length, 1, "trotz gleichem Schlüssel erkannt, weil die Datei frisch war");
  assert.equal(minisuche(d, "alpha", 5).length, 0);
  // Gegenprobe: dieselbe Lage bei einer alten Datei wird NICHT neu gelesen (so ist der Cache billig)
  const t = new Date(Date.now() - 3600 * 1000);
  writeFileSync(join(d, "a.md"), "# A\n\ngamma\n"); utimesSync(join(d, "a.md"), t, t);
  assert.equal(minisuche(d, "gamma", 5).length, 1);
  const n0 = minisucheStand().gelesen;
  minisuche(d, "gamma", 5); minisuche(d, "alpha", 5);
  assert.equal(minisucheStand().gelesen, n0);
});

test("Cache: Vault-Wechsel — jeder Vault hat seinen eigenen Eintrag, der erste bleibt richtig; höchstens drei Vaults im Speicher", () => {
  leereMinisucheCache();
  const vs = [1, 2, 3, 4].map((i) => baueGrossVault(40, { start: i, wortschatz: 500 }));
  for (const g of vs) gleich(g.vault, ["der die das", g.wort(), `${g.wort()} ${g.wort()}`]);
  assert.equal(minisucheStand().vaults, 3, "der älteste Vault wurde freigegeben");
  const vorher = minisucheStand().gelesen;
  gleich(vs[3].vault, ["der die das"]);
  assert.equal(minisucheStand().gelesen, vorher, "der zuletzt benutzte ist im Cache");
  gleich(vs[0].vault, ["der die das"]);
  assert.equal(minisucheStand().gelesen - vorher, 40, "der freigegebene wird beim nächsten Mal neu gelesen — und stimmt");
});

test("Cache: leerer Vault, nur Stoppwörter, ungültige Frage", () => {
  leereMinisucheCache();
  const d = tmp();
  assert.deepEqual(minisuche(d, "etwas", 5), []);
  schreibe(d, "a.md", "# A\n\nalpha\n");
  assert.deepEqual(minisuche(d, "!!! ???", 5), []);
  assert.deepEqual(minisuche(d, "alpha", 5), minisucheReferenz(d, "alpha", 5));
  rmSync(join(d, "a.md"));
  assert.deepEqual(minisuche(d, "alpha", 5), [], "Datei gelöscht → keine Treffer, kein veralteter Cache");
});

test("Cache: .brainignore und Generiertes werden wie ohne Cache behandelt (auch nach Änderung der Ignorierliste)", () => {
  leereMinisucheCache();
  const d = tmp();
  schreibe(d, "a.md", "# A\n\nsonderwort\n"); schreibe(d, "privat/b.md", "# B\n\nsonderwort\n"); schreibe(d, "INDEX.md", "sonderwort\n");
  alt(join(d, "a.md")); alt(join(d, "privat/b.md"));
  gleich(d, ["sonderwort"]);
  assert.equal(minisuche(d, "sonderwort", 5).length, 2);
  schreibe(d, ".brainignore", "privat\n");
  gleich(d, ["sonderwort"]);
  assert.deepEqual(minisuche(d, "sonderwort", 5).map((t) => t.pfad), ["a.md"]);
});

test("Cache: Speichergrenze — ein zu großes Wörterbuch verwirft den Eintrag (Speicher frei), die Suche bleibt richtig", () => {
  leereMinisucheCache();
  const g = baueGrossVault(30, { start: 5, wortschatz: 400 });
  const alt0 = { ...MINISUCHE_GRENZEN };
  try {
    gleich(g.vault, ["der die das", g.wort()]);
    assert.equal(minisucheStand().verworfen, 0);
    assert.ok(minisucheStand().woerter > 0 && minisucheStand().eintraege > 0, "Zahlen für die Speicheranzeige vorhanden");
    MINISUCHE_GRENZEN.woerter = 10;
    gleich(g.vault, ["der die das", g.wort()]);          // Ergebnis stimmt trotz Verwerfen
    assert.ok(minisucheStand().verworfen >= 1);
    assert.equal(minisucheStand().vaults, 0, "verworfen = nichts im Speicher");
    MINISUCHE_GRENZEN.woerter = alt0.woerter; MINISUCHE_GRENZEN.eintraege = 20;
    gleich(g.vault, ["der die das"]);
    assert.equal(minisucheStand().vaults, 0, "auch die Zahl der Zählungen ist begrenzt");
  } finally { Object.assign(MINISUCHE_GRENZEN, alt0); }
});

test("Cache über suchenFuerKi (brain_suchen): gleiche Treffer wie mit der Referenz-Reihenfolge, nach Änderung sofort aktuell", async () => {
  leereMinisucheCache();
  const g = baueGrossVault(120, { start: 11, wortschatz: 1200 });
  const v = oeffneVault(g.vault, { ohneUnterVaults: true });
  const frage = `${g.wort()} ${g.wort()}`;
  const erste = await v.suchenFuerKi(frage, 5);
  const zweite = await v.suchenFuerKi(frage, 5);
  assert.deepEqual(zweite, erste);
  const ref = minisucheReferenz(g.vault, frage, 15).map((t) => t.pfad);
  assert.deepEqual(erste.treffer.map((t) => t.pfad), ref.filter((p) => !p.split("/").some((s) => s.startsWith("."))).slice(0, erste.treffer.length));
  const ziel = g.dateien[5];
  g.aendere(ziel, `# Treffer\n\n${frage} ${frage} ${frage}\n`);
  const danach = await v.suchenFuerKi(frage, 5);
  assert.equal(danach.treffer[0].pfad, ziel, "die frisch geänderte Seite steht sofort vorn");
});
