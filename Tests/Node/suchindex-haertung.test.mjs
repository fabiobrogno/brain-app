// Suchindex: Härtung (Befunde des Reviews) — Verweise aus dem Vault heraus, Groß/klein-Doppelte, Regex-Last, Phrasen-Ausschluss, Vault-Wechsel, Neubau.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { erzeugeSuchindex } = await import(pfad("gemeinsam", "suchindex.mjs"));
const bereit = async (d, o = {}) => { const i = erzeugeSuchindex({ wurzel: d, ...o }); i.starte(); await i.ruhe(); return i; };
const pfade = (r) => r.treffer.map((t) => t.pfad);
function korpus() {
  const d = tmp();
  schreibe(d, "a.md", "# Allgemeines\n\nHier steht etwas über Überstunden und Ärger im Büro.\n");
  schreibe(d, "b.md", "# Ärger mit Amazon\n\nnichts weiter\n");
  return d;
}

test("Verweise aus dem Vault heraus und auf andere Dateien kommen nie in den Index; andere Schreibweise ergibt keine zweite Kopie", async () => {
  const d = korpus();
  const aussen = tmp();
  schreibe(aussen, "geheim.md", "# Geheim\n\nstreng geheimes passwortwort\n");
  symlinkSync(join(aussen, "geheim.md"), join(d, "link.md"));
  symlinkSync(join(d, "b.md"), join(d, "link-b.md"));
  const i = await bereit(d);
  assert.deepEqual(pfade(i.suche({ q: "passwortwort" })), []);
  i.aendere(["link.md", "link-b.md"]); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "passwortwort" })), [], "auch nicht über ein Ereignis");
  assert.ok(!pfade(i.suche({ q: "ärger" })).includes("link-b.md"));
  i.aendere("B.md"); await i.ruhe();
  assert.equal(pfade(i.suche({ q: "ärger" })).filter((p) => p.toLowerCase() === "b.md").length, 1);
});

test("Eine Überschrift mit zehntausenden Leerzeichen hält die Werkstatt nicht fest", async () => {
  const d = korpus();
  schreibe(d, "lang.md", "# a" + " ".repeat(30000) + "b\n\nText\n");
  const t0 = performance.now();
  const i = await bereit(d);
  i.suche({ q: "text" });
  assert.ok(performance.now() - t0 < 1000, `${performance.now() - t0} ms`);
});

test("-\"Phrase\" schließt nicht jede Notiz mit einem ihrer Wörter aus; Vault-Wechsel (beende) gibt frei, späteres Suchen baut neu", async () => {
  const d = korpus();
  const i = await bereit(d);
  assert.ok(pfade(i.suche({ q: 'ärger -"nie gehört"' })).includes("a.md"));
  assert.deepEqual(pfade(i.suche({ q: "ärger -amazon" })), ["a.md"]);
  i.beende();
  assert.equal(i.stand().dokumente, 0);
  const r = await i.sucheWarte({ q: "ärger" });
  assert.equal(r.treffer.length, 2);
});

test("Änderungen während eines Neubaus gehen nicht verloren; die Rangfolge bleibt nach vielen Speichervorgängen gleich", async () => {
  const d = korpus();
  const i = await bereit(d, { totSchwelle: 2 });
  for (let n = 0; n < 3; n++) { writeFileSync(join(d, "b.md"), `# Ärger mit Amazon\n\nVersion ${n}\n`); i.aendere("b.md"); }
  writeFileSync(join(d, "neu-im-bau.md"), "# Neu\n\nZwetschge im Neubau.\n");
  i.aendere("neu-im-bau.md");
  await i.ruhe();
  await new Promise((ok) => setTimeout(ok, 30)); await i.ruhe();
  assert.deepEqual(pfade(i.suche({ q: "zwetschge" })), ["neu-im-bau.md"]);
  assert.deepEqual(pfade(i.suche({ q: "version" })), ["b.md"]);
  // viele Speichervorgänge einer Notiz in einem größeren Vault: sie bleibt oben (Häufigkeiten werden durch Neubauten bereinigt)
  const g = tmp();
  for (let n = 0; n < 300; n++) schreibe(g, `n${n}.md`, `# Notiz ${n}\n\n${n % 6 === 0 ? "quokka " : ""}Allerlei Text ${n}\n`);
  schreibe(g, "ziel.md", "# Ziel\n\nquokka steht hier\n");
  const j = await bereit(g);
  const vorher = j.suche({ q: "quokka" }).treffer.find((t) => t.pfad === "ziel.md").score;
  for (let n = 0; n < 400; n++) { writeFileSync(join(g, "ziel.md"), `# Ziel\n\nquokka steht hier ${n}\n`); j.aendere("ziel.md"); if (n % 20 === 19) await j.ruhe(); }
  await j.ruhe(); await new Promise((ok) => setTimeout(ok, 50)); await j.ruhe();
  const nachher = j.suche({ q: "quokka" }).treffer.find((t) => t.pfad === "ziel.md").score;
  assert.ok(nachher > vorher * 0.6, `Score ${vorher} → ${nachher}`);
});
