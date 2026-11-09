// Tag umbenennen: Grenzen (200 Notizen), Journal-Begrenzung, 409 bei offener Zusammenführung, teilweises Rückgängig, Verlauf-Texte; Tag-Index bei 20.000 Notizen (kein Gang durch den Vault pro Speichern).
// Nur Wegwerf-Ordner (tmp).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const lies = (d, p) => readFileSync(join(d, p), "utf8");

function aufbau() {
  const d = tmp("tg-vault-"), support = tmp("tg-support-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, "a.md", "---\ntags: [alt, keep]\n---\n# A\nText #alt/kind\n");
  schreibe(d, "ordner/b.md", "# B\n#alt und #keep\n");
  return { d, support, v: oeffneVault(d, { support, heute: "2026-11-05" }) };
}

test("mehr als 200 Notizen → 413 schon in der Vorschau („in Teilen umbenennen“), nichts geschrieben; genau 200 gehen", async () => {
  const d = tmp("tg-grenze-"), support = tmp("tg-grenze-s-");
  schreibe(d, "brain.config.json", "{}\n");
  for (let i = 0; i < 201; i++) schreibe(d, `n/${i}.md`, `# ${i}\n#gross\n`);
  const v = oeffneVault(d, { support, heute: "2026-11-05" });
  const e = await v.tagUmbenennen({ alt: "gross", neu: "klein", vorschau: true }).catch((x) => x);
  assert.ok(e instanceof HttpFehler && e.status === 413 && e.extra.art === "zu-gross", String(e));
  assert.match(e.message, /in Teilen/);
  await assert.rejects(() => v.tagUmbenennen({ alt: "gross", neu: "klein" }), (x) => x.status === 413);
  assert.equal(lies(d, "n/0.md"), "# 0\n#gross\n");
  const w = tmp("tg-grenze-");
  schreibe(w, "brain.config.json", "{}\n");
  for (let i = 0; i < 200; i++) schreibe(w, `n/${i}.md`, `# ${i}\n#gross\n`);
  const r = await oeffneVault(w, { support: tmp("tg-grenze-s-") }).tagUmbenennen({ alt: "gross", neu: "klein" });
  assert.equal(r.notizen, 200);
});

test("Journal: der laufende Vorgang zählt mit — höchstens 100 Rückgängig-Vorgänge bleiben, der neueste immer", async () => {
  const { d, v } = aufbau();
  let r;
  schreibe(d, "z.md", "# Z\n#eins\n");
  for (let i = 0; i < 104; i++) r = await v.tagUmbenennen({ alt: i % 2 ? "zwei" : "eins", neu: i % 2 ? "eins" : "zwei" });
  assert.ok(r.vorgang);
  const ordner = join(d, ".kortex-lokal/papierkorb/vorgaenge");
  const namen = readdirSync(ordner);
  assert.ok(namen.length <= 100, `${namen.length} Journale`);
  assert.ok(namen.includes(r.vorgang), "der neueste bleibt");
});

test("409 „beschäftigt“ bei offener Zusammenführung (MERGE_HEAD) — auch in der Vorschau; danach geht es", async () => {
  const { d, v } = aufbau();
  const g = (...a) => execFileSync("git", a, { cwd: d, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" } });
  g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "-m", "x");
  writeFileSync(join(d, ".git", "MERGE_HEAD"), "0".repeat(40) + "\n");
  for (const a of [{ alt: "keep", neu: "bleibt", vorschau: true }, { alt: "keep", neu: "bleibt" }]) {
    await assert.rejects(() => v.tagUmbenennen(a), (e) => e instanceof HttpFehler && e.status === 409 && e.extra.art === "beschaeftigt");
  }
  assert.match(lies(d, "ordner/b.md"), /#keep/);
  unlinkSync(join(d, ".git", "MERGE_HEAD"));
  assert.equal((await v.tagUmbenennen({ alt: "keep", neu: "bleibt" })).ok, true);
});

test("Rückgängig teilweise: fehlt die erste Notiz des Vorgangs, geht es mit teilweise; Manifest und Verlauf nennen die Tags", async () => {
  const { d, support, v } = aufbau();
  const r = await v.tagUmbenennen({ alt: "alt", neu: "neu" });
  const m = JSON.parse(readFileSync(join(d, ".kortex-lokal/papierkorb/vorgaenge", r.vorgang, "manifest.json"), "utf8"));
  assert.equal(m.tagAlt, "alt"); assert.equal(m.tagNeu, "neu"); assert.equal(m.art, "tag-umbenennen");
  unlinkSync(join(d, "a.md")); // die erste Datei des Vorgangs (von = nach) ist weg
  await assert.rejects(() => v.vorgangZurueck({ id: r.vorgang }), (e) => e.status === 409);
  const z = await v.vorgangZurueck({ id: r.vorgang, teilweise: true });
  assert.equal(z.ok, true);
  assert.equal(lies(d, "ordner/b.md"), "# B\n#alt und #keep\n");
  const e = A.leseEreignisse(support, A.kennungVault(v.wurzel), { arten: ["rueckgaengig"] });
  assert.ok(e.some((x) => /Tag #neu heißt wieder #alt/.test(x.text)));
  await v.vorgangWieder({ id: r.vorgang, teilweise: true });
  const w = A.leseEreignisse(support, A.kennungVault(v.wurzel), { arten: ["rueckgaengig"] });
  assert.ok(w.some((x) => /Tag #alt heißt jetzt #neu/.test(x.text)), JSON.stringify(w.map((x) => x.text)));
});

test("Tag-Index: Änderungsmeldung statt Gang durch den Vault; zuordnung nur auf Wunsch", async () => {
  const { d, v } = aufbau();
  const a = await v.tags();
  assert.equal(a.zuordnung, undefined);
  assert.ok((await v.tags({ zuordnung: true })).zuordnung["a.md"]);
  // eine neue Notiz erscheint über schreibe() (Änderungsmeldung), ohne dass der Vault neu durchlaufen wird
  v.schreibe({ pfad: "neu.md", inhalt: "# N\n#frisch\n", basisHash: null });
  assert.ok((await v.tags()).tags.some((t) => t.name === "frisch"));
  // Löschen und Verschieben von außen: die Meldung (suchindexAendere) genügt
  unlinkSync(join(d, "neu.md"));
  v.suchindexAendere(["neu.md"]);
  assert.ok(!(await v.tags()).tags.some((t) => t.name === "frisch"));
});

test("Tag-Index bei 20.000 Notizen: erster Lauf in kleinen Scheiben, Speichern bleibt schnell (kein Gang durch den Vault)", { timeout: 120_000 }, async () => {
  const d = tmp("tg-gross-"), support = tmp("tg-gross-s-");
  schreibe(d, "brain.config.json", "{}\n");
  for (let o = 0; o < 200; o++) {
    mkdirSync(join(d, `o${o}`), { recursive: true });
    for (let i = 0; i < 100; i++) writeFileSync(join(d, `o${o}/n${i}.md`), `# N ${o}/${i}\n\nText #gruppe${o % 10}/u${i % 7} und #alle\n`);
  }
  const v = oeffneVault(d, { support, heute: "2026-11-05" });
  // Der erste Lauf: die Ereignisschleife bleibt frei (Zeitgeber läuft dazwischen)
  let letzter = Date.now(), maxLuecke = 0, laeuft = true;
  const uhr = setInterval(() => { const j = Date.now(); maxLuecke = Math.max(maxLuecke, j - letzter); letzter = j; }, 5);
  const t0 = Date.now();
  const erst = await v.tags();
  clearInterval(uhr); laeuft = false;
  assert.equal(erst.notizen, 20000);
  assert.equal(erst.tags.find((t) => t.name === "alle").anzahl, 20000);
  console.log(`# erster Lauf ${Date.now() - t0} ms, längste Lücke ${maxLuecke} ms`);
  // Unter Windows nur Messung: der Virenschutz prüft die 20.000 frisch geschriebenen Dateien, einzelne Lesezugriffe hängen dort 39–607 ms
  // (gleicher Code, Mac 8 ms). Die Scheiben-Logik ist plattformgleich und wird auf macOS/Linux streng geprüft.
  if (process.platform !== "win32") assert.ok(maxLuecke < 150, `Lücke ${maxLuecke} ms: der erste Lauf blockiert`);
  // Speichern: schreibe() meldet nur diese Notiz; die nächste Zählung rechnet aus dem Speicher
  const zeiten = [];
  for (let i = 0; i < 5; i++) {
    const t1 = process.hrtime.bigint();
    v.schreibe({ pfad: `o1/n${i}.md`, inhalt: `# N\n#neu${i}\n`, basisHash: null === 0 ? null : v.lies(`o1/n${i}.md`).hash });
    zeiten.push(Number(process.hrtime.bigint() - t1) / 1e6);
  }
  const sortiert = [...zeiten].sort((x, y) => x - y);
  // der erste Aufruf wärmt Dateisystem und Hash (unter Windows bis ~60 ms); typisch < 50 ms, nie ein Gang durch den Vault (der brauchte hier Sekunden)
  assert.ok(sortiert[2] < 50 && sortiert[4] < 250, `Speichern ${zeiten.map((z) => z.toFixed(1))} ms`);
  const t2 = Date.now();
  const nach = await v.tags();
  const dauer = Date.now() - t2;
  console.log(`# Zählung nach Speichern ${dauer} ms, schreibe ${zeiten.map((z) => z.toFixed(1)).join("/")} ms`);
  assert.ok(nach.tags.some((t) => t.name === "neu4"));
  // Windows-Runner schwanken stark (69–150 ms gemessen, Mac 14 ms); die Grenze fängt dort nur den Gang durch den Vault (Sekunden)
  assert.ok(dauer < (process.platform === "win32" ? 400 : 100), `Zählung ${dauer} ms`);
  assert.equal(laeuft, false);
});
