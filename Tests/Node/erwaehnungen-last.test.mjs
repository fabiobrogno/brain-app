// Messung der ungelinkten Erwähnungen bei 20.000 Notizen (Ziel: jeder Aufruf unter 50 ms, auf dem Entwicklungsrechner; die Schwellen im Test sind für wackelige CI-Läufer gelockert).
// Der Vault ist synthetisch (gross-vault.mjs, Temp-Ordner). Die Zahlen stehen in der Ausgabe („MESSUNG …“); KORTEX_MESSUNG=<Datei> schreibt sie zusätzlich als JSON.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueGrossVault } from "./gross-vault.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));

const N = Number(process.env.KORTEX_MESSUNG_N) || 20000;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const ms = (f) => { const t = performance.now(); const r = f(); return r && typeof r.then === "function" ? r.then((x) => [performance.now() - t, x]) : [performance.now() - t, r]; };
const rund = (x) => Math.round(x * 10) / 10;
const atme = () => new Promise((ok) => setImmediate(ok)); // wie im Server: zwischen zwei Anfragen läuft die Ereignisschleife (Aufbau in Scheiben)

test(`Messung bei ${N} Notizen: Aufruf-Dauer beider Richtungen, kalt, warm, häufiges Wort, nach einer Änderung`, { timeout: 280_000 }, async () => {
  const g = baueGrossVault(N, { start: 11 });
  const support = tmp("erw-last-support-");
  schreibe(g.vault, "brain.config.json", "{}\n");
  // Ziel-Notizen: ein seltener Titel mit Alias (Erwähnungen in 200 Notizen), ein Titel aus einem häufigen Füllwort, ein Mehrwort-Titel
  schreibe(g.vault, "ziele/zebrafink.md", "---\naliases: [Zebra-Fink]\n---\n# Zebrafink Projekt\n");
  schreibe(g.vault, "ziele/wird.md", "# Wird\n");
  schreibe(g.vault, "ziele/mehr.md", "# Müller Kaffeehaus\n");
  const streu = g.dateien.filter((_, i) => i % Math.floor(N / 200) === 0).slice(0, 200);
  for (const rel of streu) appendFileSync(join(g.vault, rel), "\nDas Zebrafink Projekt läuft, siehe auch das Zebra-Fink Konzept und [[Zebrafink Projekt]] sowie Müller Kaffeehaus.\n");

  const v = oeffneVault(g.vault, { support });
  const mess = { n: N };

  // 1) Aufbau: Suchindex und Namenssatz
  let [t, r] = await ms(() => v.erwaehnungen("ziele/zebrafink.md", { warteMs: 120_000, budgetMs: 25 }));
  mess.erstAufruf = { ms: rund(t), notizen: r.anzahlNotizen, stellen: r.anzahlStellen, offen: r.offen };
  await v.suchindexRuhe();
  await v.erwaehnungen("ziele/zebrafink.md", { budgetMs: 25 }); // Namenssatz anstoßen
  mess.index = v.suchindexStand();

  // 2) kalter Cache: wiederholen, bis nichts mehr offen ist; jede Dauer einzeln
  const kalt = [];
  let letzte;
  for (let i = 0; i < 400; i++) { [t, letzte] = await ms(() => v.erwaehnungen("ziele/zebrafink.md")); kalt.push(t); if (!letzte.offen && letzte.vollstaendig) break; await atme(); }
  mess.seltenKalt = { aufrufe: kalt.length, max: rund(Math.max(...kalt)), median: rund(med(kalt)), notizen: letzte.anzahlNotizen, stellen: letzte.anzahlStellen };
  assert.equal(letzte.vollstaendig, true, "am Ende ist alles geprüft: " + JSON.stringify({ off: letzte.offen, abg: letzte.abgeschnitten, aufbau: letzte.aufbau, n: letzte.anzahlNotizen }));
  assert.ok(letzte.anzahlNotizen >= 200, `mindestens die 200 eingestreuten Notizen, gefunden: ${letzte.anzahlNotizen}`);

  // 3) warm (alles im Cache)
  const warm = [];
  for (let i = 0; i < 30; i++) { [t] = await ms(() => v.erwaehnungen("ziele/zebrafink.md")); warm.push(t); await atme(); }
  mess.seltenWarm = { median: rund(med(warm)), p95: rund(p95(warm)), max: rund(Math.max(...warm)) };

  // 4) häufiges Wort als Titel: viele Kandidaten, schrittweise
  const haeufig = [];
  let h;
  for (let i = 0; i < 400; i++) { [t, h] = await ms(() => v.erwaehnungen("ziele/wird.md")); haeufig.push(t); if (!h.offen) break; await atme(); }
  mess.haeufigesWort = { aufrufe: haeufig.length, max: rund(Math.max(...haeufig)), median: rund(med(haeufig)), notizen: h.anzahlNotizen, abgeschnitten: h.abgeschnitten };

  // 5) Gegenrichtung: ein Text von 3 KB
  const text = `# Notiz\n\n${"Heute sprach ich mit Müller Kaffeehaus über das Zebrafink Projekt. ".repeat(10)}${readFileSync(join(g.vault, g.dateien[5]), "utf8").slice(0, 2500)}`;
  const aus = [];
  for (let i = 0; i < 30; i++) { [t, h] = await ms(() => v.erwaehntVon("neu/aktuell.md", text)); aus.push(t); await atme(); }
  mess.gegenrichtung = { median: rund(med(aus)), p95: rund(p95(aus)), max: rund(Math.max(...aus)), notizen: h.anzahlNotizen, vollstaendig: h.vollstaendig };
  assert.ok(h.notizen.some((x) => x.pfad === "ziele/zebrafink.md"));

  // 6) eine geänderte Notiz: der nächste Aufruf prüft nur sie neu
  const ziel = streu[3];
  writeFileSync(join(g.vault, ziel), "# Neu geschrieben\n\nHier steht kein Name mehr.\n");
  v.suchindexAendere([ziel]); await v.suchindexRuhe();
  // ein Aufruf ist durch sein Zeitbudget begrenzt (auf langsamen Läufern reicht es nicht für alle Kandidaten): wiederholen, bis nichts mehr offen ist; gemessen wird jeder Aufruf
  const nach = [];
  let rc;
  for (let i = 0; i < 400; i++) { const [tc, r] = await ms(() => v.erwaehnungen("ziele/zebrafink.md")); nach.push(tc); rc = r; if (!r.offen) break; await atme(); }
  mess.nachAenderung = { ms: rund(Math.max(...nach)), aufrufe: nach.length, notizen: rc.anzahlNotizen, offen: rc.offen };
  assert.equal(rc.anzahlNotizen, letzte.anzahlNotizen - 1);

  // 7) Link setzen („Alle“-Vorschau über 200 Notizen)
  const [tv, vor] = await ms(() => v.verlinke({ ziel: "ziele/zebrafink.md", alle: true, vorschau: true }));
  mess.alleVorschau = { ms: rund(tv), notizen: vor.notizen, verweise: vor.verweise };

  console.log("MESSUNG " + JSON.stringify(mess));
  if (process.env.KORTEX_MESSUNG) writeFileSync(process.env.KORTEX_MESSUNG, JSON.stringify(mess, null, 2));
  // Schwellen: Ziel 50 ms je Aufruf; hier gelockert (CI-Läufer, besonders Windows, schwanken stark)
  const GRENZE = Number(process.env.KORTEX_MESSUNG_GRENZE) || 150;
  assert.ok(mess.seltenWarm.median < GRENZE, `warm ${mess.seltenWarm.median} ms`);
  assert.ok(mess.seltenKalt.max < GRENZE * 2, `kalt max ${mess.seltenKalt.max} ms`);
  assert.ok(mess.haeufigesWort.max < GRENZE * 2, `häufiges Wort max ${mess.haeufigesWort.max} ms`);
  assert.ok(mess.gegenrichtung.median < GRENZE, `Gegenrichtung ${mess.gegenrichtung.median} ms`);
  assert.ok(mess.nachAenderung.ms < GRENZE * 2, `nach Änderung ${mess.nachAenderung.ms} ms`);
});
