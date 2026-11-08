// Härtung der ungelinkten Erwähnungen (Review zu PR #124): offener Abgleich, Ereignisschleife, Journal-Grenzen, Stellen wiederfinden, ehrliches Zurückrollen, Index-Aufbau,
// Berechtigungen des Journals, Laufzeit von „Alle verlinken“, Werkzeugliste des MCP-Servers. Nur Wegwerf-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad, g } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erzeugeErwaehnungen } = await import(pfad("gemeinsam", "erwaehnungen-index.mjs"));
const { WERKZEUGE } = await import(pfad("mcp", "brain-mcp.mjs"));

function aufbau(dateien) {
  const d = tmp("erwh-vault-"), support = tmp("erwh-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  return { d, support, v: oeffneVault(d, { support, heute: "2026-11-05" }) };
}
const lies = (d, p) => readFileSync(join(d, p), "utf8");
const KAFFEE = "wissen/kaffee.md";
const stelleVon = (n, i = 0) => { const s = n.stellen[i]; return { pfad: n.pfad, start: s.start, treffer: s.treffer, vor: s.vor, nach: s.nach, hash: n.hash }; };

test("Offener Abgleich: Verlinken und Rückgängig lehnen mit 409 „beschaeftigt“ ab, nichts wird geschrieben", async () => {
  const { d, v } = aufbau({ [KAFFEE]: "# Kaffee\n", "n/a.md": "# A\n\nKaffee.\n", "n/b.md": "# B\n\nKaffee.\n" });
  g(d, "init", "-q", "-b", "main");
  const r0 = await v.erwaehnungen(KAFFEE);
  const e = await v.verlinke({ ziel: KAFFEE, stellen: [stelleVon(r0.notizen.find((n) => n.pfad === "n/a.md"))] });
  assert.equal(e.ok, true);
  writeFileSync(join(d, ".git", "MERGE_HEAD"), "0123456789012345678901234567890123456789\n"); // eine Zusammenführung ist offen
  const vorher = lies(d, "n/b.md");
  await assert.rejects(() => v.verlinke({ ziel: KAFFEE, alle: true }), (err) => err.status === 409 && err.extra?.art === "beschaeftigt");
  await assert.rejects(() => v.vorgangZurueck({ id: e.vorgang }), (err) => err.status === 409 && err.extra?.art === "beschaeftigt");
  assert.equal(lies(d, "n/b.md"), vorher);
  assert.match(lies(d, "n/a.md"), /\[\[Kaffee\]\]/, "das Rückgängig wurde nicht ausgeführt");
});

test("Konfliktmarken: eine Notiz mit <<<<<<< … >>>>>>> wird übersprungen", async () => {
  const { d, v } = aufbau({ [KAFFEE]: "# Kaffee\n", "n/k.md": "# K\n<<<<<<< HEAD\nKaffee oben\n=======\nKaffee unten\n>>>>>>> origin\n", "n/ok.md": "# OK\n\nKaffee.\n" });
  const e = await v.verlinke({ ziel: KAFFEE, alle: true });
  assert.deepEqual(e.dateien.map((x) => x.pfad), ["n/ok.md"]);
  assert.ok(e.uebersprungen.some((u) => u.pfad === "n/k.md" && /Konflikt/.test(u.grund)));
  assert.match(lies(d, "n/k.md"), /^# K\n<<<<<<< HEAD\nKaffee oben/);
});

test("Ereignisschleife: eine 1-MB-Notiz mit 40.000 Treffern bremst die Werkstatt nicht (andere Route < 50 ms), große Texte werden abgewiesen", async () => {
  const support = tmp("erwh-r-support-"), d = tmp("erwh-r-vault-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, KAFFEE, "# Kaffee\n");
  const riesig = "Kaffee und Tee. ".repeat(Math.ceil(1_000_000 / 16)).slice(0, 1_000_000); // 62.500 Treffer
  schreibe(d, "n/riesig.md", "# Riesig\n\n" + riesig);
  schreibe(d, "n/mittel.md", "# Mittel\n\n" + "Kaffee ".repeat(30_000)); // 210 KB, unter der Grenze: ein Durchlauf
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { modus: "poll", pollMs: 80, entprellMs: 40 } });
  const rufe = async (methode, p, daten) => { const [pf, q] = p.split("?"); const r = await h({ methode, pfad: pf, query: q || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* */ } return { status: r.status, j }; };
  const warm = await rufe("GET", "/api/erwaehnungen?pfad=" + encodeURIComponent(KAFFEE)); // Index aufbauen lassen
  assert.equal(warm.status, 200);
  assert.deepEqual(warm.j.notizen.map((n) => n.pfad), ["n/mittel.md"], "die 1-MB-Notiz wird nicht durchsucht");
  assert.equal(warm.j.notizen[0].stellen.length, 8); assert.equal(warm.j.notizen[0].anzahl, 30_000);
  // Verzögerung der Ereignisschleife, solange eine große Anfrage läuft
  let maxVerzug = 0, letzte = performance.now();
  const takt = setInterval(() => { const jetzt = performance.now(); maxVerzug = Math.max(maxVerzug, jetzt - letzte - 1); letzte = jetzt; }, 1);
  const grossText = "# G\n\n" + "Kaffee ".repeat(30_000);
  const antworten = await Promise.all([rufe("POST", "/api/erwaehnungen/aus", { pfad: "n/x.md", text: grossText }), rufe("POST", "/api/erwaehnungen/aus", { pfad: "n/x.md", text: "# R\n\n" + riesig }), rufe("GET", "/api/erwaehnungen?pfad=" + encodeURIComponent(KAFFEE))]);
  clearInterval(takt);
  assert.equal(antworten[0].status, 200); assert.equal(antworten[0].j.anzahlStellen, 30_000); assert.equal(antworten[0].j.notizen[0].stellen.length, 8);
  assert.equal(antworten[1].status, 413, "über 256 KB: abgewiesen");
  assert.ok(maxVerzug < 80, `die Ereignisschleife stand ${Math.round(maxVerzug)} ms still`);
  const t0 = performance.now(); const info = await rufe("GET", "/api/info"); const dauer = performance.now() - t0;
  assert.equal(info.status, 200); assert.ok(dauer < 50, `/api/info brauchte ${Math.round(dauer)} ms`);
  const links = await rufe("POST", "/api/erwaehnungen/links", { pfad: "n/x.md", text: grossText, alle: true });
  assert.equal(links.status, 200); assert.equal(links.j.aenderungen.length, 500, "höchstens 500 Änderungen auf einmal"); assert.equal(links.j.uebersprungen, 29_500);
  assert.equal((await rufe("POST", "/api/erwaehnungen/aus", { pfad: "n/x.md", text: "x".repeat(1_100_000) })).status, 413);
});

test("Alle verlinken: über 200 Notizen → 413 „in Teilen verlinken“ (Vorschau und Ausführen), nichts geschrieben; darunter geht es und bleibt schnell", async () => {
  const dateien = { [KAFFEE]: "# Kaffee\n" };
  for (let i = 0; i < 201; i++) dateien[`n/a${String(i).padStart(3, "0")}.md`] = `# A${i}\n\nKaffee ${i}.\n`;
  const { d, v } = aufbau(dateien);
  await assert.rejects(() => v.verlinke({ ziel: KAFFEE, alle: true, vorschau: true }), (err) => err.status === 413 && err.extra?.art === "zu-viele" && /in Teilen/.test(err.message));
  await assert.rejects(() => v.verlinke({ ziel: KAFFEE, alle: true }), (err) => err.status === 413);
  assert.equal(lies(d, "n/a000.md"), "# A0\n\nKaffee 0.\n");
  for (let i = 0; i < 61; i++) writeFileSync(join(d, `n/a${String(i).padStart(3, "0")}.md`), `# A${i}\n\nNichts ${i}.\n`); // 140 bleiben
  v.suchindexAendere(Array.from({ length: 61 }, (_, i) => `n/a${String(i).padStart(3, "0")}.md`)); await v.suchindexRuhe();
  const t0 = performance.now();
  const vor = await v.verlinke({ ziel: KAFFEE, alle: true, vorschau: true });
  const e = await v.verlinke({ ziel: KAFFEE, alle: true, token: vor.token });
  const dauer = performance.now() - t0;
  assert.equal(e.dateien.length, 140);
  assert.ok(dauer < 5000, `Vorschau und Ausführen von 140 Notizen: ${Math.round(dauer)} ms`);
  // Journal: Ordner 0700, Dateien 0600 (nicht auf Windows)
  if (process.platform !== "win32") {
    const dir = join(d, ".kortex-lokal", "papierkorb", "vorgaenge", e.vorgang);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    for (const sub of ["", "vorher", "nachher"]) for (const n of readdirSync(join(dir, sub))) { const st = statSync(join(dir, sub, n)); if (st.isFile()) assert.equal(st.mode & 0o777, 0o600, `${sub}/${n}`); }
  }
});

test("Journal: die laufende Aktion bleibt, höchstens 100 Journale insgesamt", async () => {
  const { d, v } = aufbau({ [KAFFEE]: "# Kaffee\n", "n/a.md": "# A\n\nKaffee.\n" });
  let letzter;
  for (let i = 0; i < 103; i++) {
    const r = await v.erwaehnungen(KAFFEE);
    if (!r.notizen.length) break;
    letzter = await v.verlinke({ ziel: KAFFEE, stellen: [stelleVon(r.notizen[0])] });
    await v.vorgangZurueck({ id: letzter.vorgang });
    v.suchindexAendere(["n/a.md"]); await v.suchindexRuhe();
  }
  const ordner = join(d, ".kortex-lokal", "papierkorb", "vorgaenge");
  const anzahl = readdirSync(ordner).length;
  assert.ok(anzahl <= 100, `${anzahl} Journale`);
  assert.ok(existsSync(join(ordner, letzter.vorgang)), "das neueste Journal bleibt");
});

test("Einzelne Stelle: gleicher Hash → genau diese Stelle; geänderte Notiz → nur mit eindeutiger Umgebung davor und danach, sonst übersprungen", async () => {
  const { d, v } = aufbau({ [KAFFEE]: "# Kaffee\n", "n/a.md": "Kaffee am Anfang.\n", "n/b.md": "# B\n\nEin Satz mit Kaffee darin.\n", "n/c.md": "# C\n\nKaffee Kaffee Kaffee.\n" });
  const r = await v.erwaehnungen(KAFFEE);
  const von = (p, i = 0) => stelleVon(r.notizen.find((n) => n.pfad === p), i);
  // a: Stelle am Textanfang, Umgebung davor leer; die Notiz wird davor ergänzt → nicht wiederzufinden
  writeFileSync(join(d, "n/a.md"), "Neu davor.\nKaffee am Anfang.\n");
  // b: verschoben, Umgebung gleich → gefunden
  writeFileSync(join(d, "n/b.md"), "# B\n\nNeuer Absatz.\n\nEin Satz mit Kaffee darin.\n");
  // c: Hash gleich → die zweite Stelle genau
  const e = await v.verlinke({ ziel: KAFFEE, stellen: [von("n/a.md"), von("n/b.md"), von("n/c.md", 1)] });
  assert.equal(lies(d, "n/a.md"), "Neu davor.\nKaffee am Anfang.\n");
  assert.equal(lies(d, "n/b.md"), "# B\n\nNeuer Absatz.\n\nEin Satz mit [[Kaffee]] darin.\n");
  assert.equal(lies(d, "n/c.md"), "# C\n\nKaffee [[Kaffee]] Kaffee.\n");
  assert.deepEqual(e.uebersprungen.map((u) => u.pfad), ["n/a.md"]);
});

test("Rückrollen: war eine Notiz inzwischen geändert, bleibt sie stehen, das Journal bleibt liegen und die Meldung sagt es ehrlich", async () => {
  const dateien = { [KAFFEE]: "# Kaffee\n", "n/a.md": "# A\n\nKaffee.\n", "n/b.md": "# B\n\nKaffee.\n" };
  const d = tmp("erwh-rb-vault-"), support = tmp("erwh-rb-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  let ausgeloest = false;
  const v = oeffneVault(d, { support, dateiHaken: { punkt: (n) => {
    if (n !== "nach-schreiben" || ausgeloest) return;
    ausgeloest = true;
    writeFileSync(join(d, "n/a.md"), lies(d, "n/a.md") + "Von Hand ergänzt.\n"); // nach dem Schreiben von Kortex geändert
    throw new Error("Absturz nach dem Schreiben");
  } } });
  await assert.rejects(() => v.verlinke({ ziel: KAFFEE, alle: true }), (err) => err.status === 409 && err.extra?.art === "teilweise" && /ließ.*sich nicht zurücknehmen/.test(err.message) && err.extra.dateien.length === 1);
  assert.match(lies(d, "n/a.md"), /Von Hand ergänzt/, "die Handarbeit bleibt");
  assert.equal(lies(d, "n/b.md"), "# B\n\nKaffee.\n", "was sich zurücknehmen ließ, ist zurück");
  const journale = readdirSync(join(d, ".kortex-lokal", "papierkorb", "vorgaenge"));
  assert.equal(journale.length, 1, "das Journal bleibt liegen");
  const m = JSON.parse(readFileSync(join(d, ".kortex-lokal", "papierkorb", "vorgaenge", journale[0], "manifest.json"), "utf8"));
  assert.equal(m.status, "unklar");
});

test("Index baut noch: Verlinken und Links für den Text melden 409 „index-baut“", async () => {
  const dienst = erzeugeErwaehnungen({ wurzel: tmp("erwh-ix-"), index: () => ({ starte() {}, istFertig: () => false, epoche: () => 1, dokumente: () => ({ epoche: 1, bis: 0, dokumente: [] }), lebtNr: () => false, stand: () => ({ tot: 0 }), kandidaten: () => [] }) });
  await assert.rejects(() => dienst.planeVerlinken("a.md", "alle", () => null), (err) => err.status === 409 && err.extra?.art === "index-baut");
  await assert.rejects(() => dienst.linksFuerText("a.md", "text", "alle"), (err) => err.status === 409 && err.extra?.art === "index-baut");
  dienst.beende();
});

test("Agentendateien in jedem Ordner sind keine Quelle für Links", async () => {
  const { d, v } = aufbau({ [KAFFEE]: "# Kaffee\n", "projekt/CLAUDE.md": "Kaffee\n", "projekt/sub/AGENTS.md": "Kaffee\n", "x/gemini.md": "Kaffee\n", "n/ok.md": "Kaffee\n" });
  const r = await v.erwaehnungen(KAFFEE);
  assert.deepEqual(r.notizen.map((n) => n.pfad), ["n/ok.md"]);
  const e = await v.verlinke({ ziel: KAFFEE, stellen: [{ pfad: "projekt/CLAUDE.md", start: 0, treffer: "Kaffee" }] });
  assert.equal(e.unveraendert, true);
  assert.equal(lies(d, "projekt/CLAUDE.md"), "Kaffee\n");
});

test("MCP: die Werkzeugliste bleibt unter 4400 Zeichen und enthält brain_neuigkeiten", () => {
  const n = JSON.stringify(WERKZEUGE).length;
  assert.ok(n <= 4400, `${n} Zeichen`);
  assert.ok(WERKZEUGE.some((w) => w.name === "brain_neuigkeiten"));
});

test("Lesende POSTs (/aus, /links) gelten nicht als eigene Schreibvorgänge: eine Änderung von außen an derselben Notiz meldet die Werkstatt weiterhin", async () => {
  const support = tmp("erwh-e-support-"), d = tmp("erwh-e-vault-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, KAFFEE, "# Kaffee\n"); schreibe(d, "n/a.md", "# A\n\nKaffee.\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { entprellMs: 60, maxWarteMs: 300 } });
  const rufe = async (methode, p, daten, query) => { const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  const s = (await rufe("GET", "/api/ereignisse")).j;
  await new Promise((ok) => setTimeout(ok, 700)); // der Beobachter hat den Ausgangsstand sicher gelesen, bevor von außen geschrieben wird (langsame Läufer)
  const text = lies(d, "n/a.md");
  // Die Anfrage läuft noch (der Index baut sich erst auf), während die Notiz von außen geändert wird — genau so trifft es die Oberfläche beim Öffnen einer Notiz
  const laufend = [rufe("POST", "/api/erwaehnungen/aus", { pfad: "n/a.md", text }), rufe("POST", "/api/erwaehnungen/links", { pfad: "n/a.md", text, alle: true })];
  writeFileSync(join(d, "n/a.md"), "# A\n\nKaffee, von außen geändert.\n");
  assert.deepEqual((await Promise.all(laufend)).map((x) => x.status), [200, 200]);
  const r = (await rufe("GET", "/api/ereignisse", undefined, `seit=0&epoche=${s.epoche}&warte=5`)).j;
  assert.ok(r.ereignisse.some((e) => e.pfad === "n/a.md"), "die Änderung von außen wird gemeldet: " + JSON.stringify(r.ereignisse));
  h.ereignisse.beende?.();
});
