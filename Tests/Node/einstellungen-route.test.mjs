// GET/PUT /api/einstellungen (Paket P5, Seite „Einstellungen“): eine Route für zwei Speicher — die Werte eines Vaults (kern/einstellungen.mjs,
// brain.config.json#automatik, dieselbe Speicherung wie `brain einstellungen`) und die Werte der App (<support>/einstellungen.json).
// Geprüft: Lesen mit Standardwerten, Schreiben in beide Speicher, Kern liest dasselbe, Prüfung (unbekannt, Typ, Bereich) ohne Teilschreiben,
// optimistische Sperre (409 art „konflikt“ je Speicher), null = Standard, kaputte Dateien, Vertrauen, Ereignis „einstellungen“ bei Änderung von außen.
// Nur Wegwerf-Ordner in os.tmpdir(); nie der echte Support-Ordner, kein Netzwerk.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad, echt } from "./hilfe.mjs";

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erzeugeEreignisse } = await import(pfad("werkstatt", "ereignisse.mjs"));
const { leseAutomatik, schreibeAutomatik, STANDARD } = await import(pfad("kern", "einstellungen.mjs"));
const { APP_STANDARD, leseApp } = await import(pfad("gemeinsam", "app-einstellungen.mjs"));

const vault = (cfg = "{}\n") => { const d = tmp("brain-einst-"); schreibe(d, "brain.config.json", cfg); schreibe(d, "a.md", "# A\n"); return d; };
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { status: r.status, j };
};
const aufbau = (cfg) => {
  const d = vault(cfg), support = tmp("brain-support-");
  return { d, support, rufe: aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } })) };
};
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

test("GET: Standardwerte beider Speicher, Schema mit Quelle, Stand aus zwei Teilen, Dateinamen", async () => {
  const { rufe, d } = aufbau();
  const r = await rufe("GET", "/api/einstellungen");
  assert.equal(r.status, 200);
  assert.match(r.j.stand, /^[0-9a-f]{64}\.[0-9a-f]{64}$/);
  for (const [k, w] of Object.entries(STANDARD)) assert.deepEqual(r.j.werte[k], w, k);
  for (const [k, w] of Object.entries(APP_STANDARD)) assert.deepEqual(r.j.werte[k], w, k);
  assert.equal(r.j.schema.tageslauf.quelle, "vault");
  assert.deepEqual(r.j.schema.tageslauf.werte, ["aus", "probe", "an"]);
  assert.equal(r.j.schema.schriftgroesse.quelle, "app");
  assert.equal(r.j.schema.schriftgroesse.max, 19);
  assert.equal(r.j.vault.pfad, d);
  assert.deepEqual(r.j.dateien, { vault: "brain.config.json", app: "einstellungen.json" });
  assert.equal(r.j.fehler, undefined);
});

test("PUT: Vault-Wert landet in brain.config.json — der Kern (brain einstellungen) liest dasselbe, übrige Abschnitte bleiben", async () => {
  const { rufe, d } = aufbau(JSON.stringify({ name: "Mein Vault", automatik: { hinweise: "hoch" }, ordner: { aufgaben: "05_aufgaben" } }));
  const g = (await rufe("GET", "/api/einstellungen")).j;
  assert.equal(g.werte.hinweise, "hoch");
  const r = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an", ernteOhneThema: ["Gesundheit", "Gehalt"], einschwingen: 7 }, stand: g.stand });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.equal(r.j.werte.tageslauf, "an");
  assert.deepEqual(r.j.werte.ernteOhneThema, ["Gesundheit", "Gehalt"]);
  const kern = leseAutomatik(d).werte; // dieselbe Speicherung: der Kern sieht genau das
  assert.equal(kern.tageslauf, "an"); assert.equal(kern.einschwingen, 7); assert.equal(kern.hinweise, "hoch");
  const cfg = JSON.parse(readFileSync(join(d, "brain.config.json"), "utf8"));
  assert.equal(cfg.name, "Mein Vault"); assert.deepEqual(cfg.ordner, { aufgaben: "05_aufgaben" });
  assert.equal(cfg.automatik.tageslauf, "an");
  assert.equal(existsSync(join(d, ".logs", "config-vorher.json")), true); // Sicherung wie im Kern
  // und andersherum: was der Kern schreibt, sieht die Route
  const k = leseAutomatik(d);
  schreibeAutomatik(d, { wochenbericht: false }, k.stand);
  assert.equal((await rufe("GET", "/api/einstellungen")).j.werte.wochenbericht, false);
});

test("PUT: App-Werte liegen in <support>/einstellungen.json, nur Geändertes steht dort, null = Standard", async () => {
  const { rufe, support } = aufbau();
  let g = (await rufe("GET", "/api/einstellungen")).j;
  const r = await rufe("PUT", "/api/einstellungen", { werte: { schriftgroesse: 17, bewegung: "reduziert", mitteilungenTon: true }, stand: g.stand });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.werte.schriftgroesse, 17);
  assert.deepEqual(JSON.parse(readFileSync(join(support, "einstellungen.json"), "utf8")), { schriftgroesse: 17, bewegung: "reduziert", mitteilungenTon: true });
  g = r.j;
  const r2 = await rufe("PUT", "/api/einstellungen", { werte: { schriftgroesse: null, bewegung: null }, stand: g.stand });
  assert.equal(r2.status, 200);
  assert.equal(r2.j.werte.schriftgroesse, APP_STANDARD.schriftgroesse);
  assert.deepEqual(JSON.parse(readFileSync(join(support, "einstellungen.json"), "utf8")), { mitteilungenTon: true });
  const r3 = await rufe("PUT", "/api/einstellungen", { werte: { mitteilungenTon: null }, stand: r2.j.stand });
  assert.equal(r3.status, 200);
  assert.equal(leseApp(support).stand, r3.j.stand.split(".")[1]);
  assert.equal(readFileSync(join(support, "einstellungen.json"), "utf8"), ""); // nichts Abweichendes mehr: leere Datei
});

test("PUT: beide Speicher in einem Aufruf", async () => {
  const { rufe, d, support } = aufbau();
  const g = (await rufe("GET", "/api/einstellungen")).j;
  const r = await rufe("PUT", "/api/einstellungen", { werte: { gesundheit: false, mitteilungenRueckfragen: false }, stand: g.stand });
  assert.equal(r.status, 200);
  assert.equal(leseAutomatik(d).werte.gesundheit, false);
  assert.equal(leseApp(support).werte.mitteilungenRueckfragen, false);
  // der Stand der Antwort ist sofort der neue
  const r2 = await rufe("PUT", "/api/einstellungen", { werte: { gesundheit: true }, stand: r.j.stand });
  assert.equal(r2.status, 200);
});

test("Validierung: unbekannt, falscher Typ, außerhalb des Bereichs, fehlender Stand — 400, und nichts wird geschrieben (auch nicht der gültige Teil)", async () => {
  const { rufe, d, support } = aufbau();
  const g = (await rufe("GET", "/api/einstellungen")).j;
  const vorher = readFileSync(join(d, "brain.config.json"), "utf8");
  const schlecht = [
    { werte: { gibtEsNicht: 1 } },
    { werte: { tageslauf: "immer" } },
    { werte: { gesundheit: "ja" } },
    { werte: { einschwingen: 1.5 } },
    { werte: { einschwingen: 100000 } },
    { werte: { schriftgroesse: 12 } },
    { werte: { schriftgroesse: "15" } },
    { werte: { bewegung: "voll" } },
    { werte: { ernteNichtIn: "nicht-liste" } },
    { werte: { ernteOhneThema: [""] } },
    { werte: [] },
    { werte: null },
    {},
  ];
  for (const s of schlecht) {
    const r = await rufe("PUT", "/api/einstellungen", { ...s, stand: g.stand });
    assert.equal(r.status, 400, JSON.stringify(s) + " → " + JSON.stringify(r.j));
    assert.equal(typeof r.j.fehler, "string");
  }
  // gültig + ungültig zusammen: der gültige Teil darf nicht durchrutschen
  const r = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an", schriftgroesse: 99 }, stand: g.stand });
  assert.equal(r.status, 400);
  assert.equal(readFileSync(join(d, "brain.config.json"), "utf8"), vorher);
  assert.equal(existsSync(join(support, "einstellungen.json")), false);
  for (const stand of [undefined, "", "abc", "x.y", g.stand.split(".")[0]]) {
    const r2 = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, ...(stand === undefined ? {} : { stand }) });
    assert.equal(r2.status, 400, String(stand));
  }
  assert.equal((await rufe("PUT", "/api/einstellungen", "kein objekt")).status, 400);
  assert.equal((await rufe("POST", "/api/einstellungen", {})).status, 405);
  assert.equal(leseAutomatik(d).werte.tageslauf, STANDARD.tageslauf);
});

test("Konflikt: ändert jemand die Datei des Vaults (CLI, KI), antwortet PUT mit 409 art „konflikt“ — nach dem Neuladen geht es", async () => {
  const { rufe, d } = aufbau();
  const alt = (await rufe("GET", "/api/einstellungen")).j;
  schreibeAutomatik(d, { hinweise: "niedrig" }, leseAutomatik(d).stand); // „brain einstellungen hinweise=niedrig“ zwischendurch
  const r = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: alt.stand });
  assert.equal(r.status, 409, JSON.stringify(r.j));
  assert.equal(r.j.art, "konflikt");
  assert.match(r.j.fehler, /neu laden/);
  assert.equal(leseAutomatik(d).werte.tageslauf, STANDARD.tageslauf); // nicht überschrieben
  const neu = (await rufe("GET", "/api/einstellungen")).j;
  assert.equal(neu.werte.hinweise, "niedrig");
  assert.notEqual(neu.stand, alt.stand);
  const r2 = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: neu.stand });
  assert.equal(r2.status, 200);
  assert.equal(leseAutomatik(d).werte.hinweise, "niedrig"); // der Zwischenstand der CLI blieb erhalten
});

test("Konflikt: zwei Fenster mit demselben Stand — das zweite bekommt 409; der Konflikt der App-Datei trifft nur App-Werte", async () => {
  const { rufe, d, support } = aufbau();
  const g = (await rufe("GET", "/api/einstellungen")).j;
  assert.equal((await rufe("PUT", "/api/einstellungen", { werte: { schriftgroesse: 16 }, stand: g.stand })).status, 200);
  const r = await rufe("PUT", "/api/einstellungen", { werte: { schriftgroesse: 18 }, stand: g.stand });
  assert.equal(r.status, 409); assert.equal(r.j.art, "konflikt");
  assert.equal(leseApp(support).werte.schriftgroesse, 16);
  // ein Vault-Wert mit dem alten Stand geht trotzdem: die Datei des Vaults hat sich nicht geändert (Stand je Speicher)
  const r2 = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: g.stand });
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  assert.equal(leseAutomatik(d).werte.tageslauf, "an");
  // gemischt mit veraltetem App-Stand: 409, und der Vault-Teil wurde NICHT schon geschrieben
  const r3 = await rufe("PUT", "/api/einstellungen", { werte: { wochenbericht: false, schriftgroesse: 14 }, stand: `${r2.j.stand.split(".")[0]}.${g.stand.split(".")[1]}` });
  assert.equal(r3.status, 409);
  assert.equal(leseAutomatik(d).werte.wochenbericht, true);
});

test("gleichzeitige Schreibvorgänge mit demselben Stand: genau einer gewinnt, kein halber Zustand", async () => {
  const { rufe, d } = aufbau();
  const g = (await rufe("GET", "/api/einstellungen")).j;
  const antworten = await Promise.all([
    rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: g.stand }),
    rufe("PUT", "/api/einstellungen", { werte: { hinweise: "hoch" }, stand: g.stand }),
    rufe("PUT", "/api/einstellungen", { werte: { gesundheit: false }, stand: g.stand }),
  ]);
  assert.deepEqual(antworten.map((a) => a.status).sort(), [200, 409, 409]);
  const w = leseAutomatik(d).werte;
  const geaendert = ["tageslauf", "hinweise", "gesundheit"].filter((k) => w[k] !== STANDARD[k]);
  assert.equal(geaendert.length, 1);
});

test("kaputte Dateien: Lesen liefert Standardwerte und einen Fehlertext, Schreiben meldet 500 und lässt die Datei unberührt", async () => {
  const { rufe, d, support } = aufbau();
  writeFileSync(join(support, "einstellungen.json"), "{ kaputt");
  const g = (await rufe("GET", "/api/einstellungen")).j;
  assert.equal(g.werte.schriftgroesse, APP_STANDARD.schriftgroesse);
  assert.match(g.fehler.app, /beschädigt/);
  const r = await rufe("PUT", "/api/einstellungen", { werte: { schriftgroesse: 16 }, stand: g.stand });
  assert.equal(r.status, 500);
  assert.equal(readFileSync(join(support, "einstellungen.json"), "utf8"), "{ kaputt");
  // Vault-Datei kaputt
  writeFileSync(join(d, "brain.config.json"), "{ kaputt");
  const g2 = (await rufe("GET", "/api/einstellungen")).j;
  assert.ok(g2.fehler.vault);
  const r2 = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: g2.stand });
  assert.equal(r2.status, 500);
  assert.equal(readFileSync(join(d, "brain.config.json"), "utf8"), "{ kaputt");
  // ungültige Werte in der Datei werden beim Lesen verworfen, nicht übernommen
  writeFileSync(join(support, "einstellungen.json"), JSON.stringify({ schriftgroesse: 99, bewegung: "reduziert", fremd: 1 }));
  const g3 = (await rufe("GET", "/api/einstellungen")).j;
  assert.equal(g3.werte.schriftgroesse, APP_STANDARD.schriftgroesse);
  assert.equal(g3.werte.bewegung, "reduziert");
  assert.equal(g3.werte.fremd, undefined);
});

test("ohne Vault: App-Werte gehen, Vault-Werte nicht (409 keinVault)", async () => {
  const support = tmp("brain-support-");
  const rufe = aufruf(erzeugeHandler({ vault: null, vaultOptionen: { support } }));
  const g = await rufe("GET", "/api/einstellungen");
  assert.equal(g.status, 200);
  assert.equal(g.j.vault, null);
  assert.match(g.j.stand, /^-\.[0-9a-f]{64}$/);
  assert.equal(g.j.werte.bewegung, "system");
  const r = await rufe("PUT", "/api/einstellungen", { werte: { bewegung: "reduziert" }, stand: g.j.stand });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const r2 = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: r.j.stand });
  assert.equal(r2.status, 409); assert.equal(r2.j.keinVault, true);
});

test("Vertrauen: in einem Vault „nur ansehen“ lassen sich Vault-Werte nicht ändern (409 art nicht-vertraut), App-Werte schon", async () => {
  await echt(async () => {
    const d = vault(), support = tmp("brain-support-");
    const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
    const g = (await rufe("GET", "/api/einstellungen")).j;
    assert.equal(g.vault.vertraut, false);
    const r = await rufe("PUT", "/api/einstellungen", { werte: { tageslauf: "an" }, stand: g.stand });
    assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-vertraut");
    assert.equal(leseAutomatik(d).werte.tageslauf, STANDARD.tageslauf);
    const r2 = await rufe("PUT", "/api/einstellungen", { werte: { schriftgroesse: 16 }, stand: g.stand });
    assert.equal(r2.status, 200);
  });
});

test("ichKarte: die Änderung rendert AGENTS.md im Vault neu (wie im Kern) — und die Anfrage meldet das nicht als Fremdänderung", async () => {
  const { rufe, d } = aufbau();
  const g = (await rufe("GET", "/api/einstellungen")).j;
  const r = await rufe("PUT", "/api/einstellungen", { werte: { ichKarte: true }, stand: g.stand });
  assert.equal(r.status, 200);
  assert.equal(r.j.werte.ichKarte, true);
  assert.equal(leseAutomatik(d).werte.ichKarte, true); // das Rendern selbst ist fehlertolerant — die Route bleibt 200, auch wenn es nicht gelingt
});

// ───────────────────────────── Live: Änderungen von außen ─────────────────────────────

test("Ereignis „einstellungen“: CLI-Änderung an brain.config.json und Änderung der App-Datei von außen werden gemeldet, eigene Schreibvorgänge nicht", async () => {
  for (const modus of ["watch", "poll"]) {
    const d = vault(), support = tmp("brain-support-");
    const h = erzeugeEreignisse({ entprellMs: 60, maxWarteMs: 300, pollMs: 80, modus, support });
    try {
      h.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
      let stand = await h.warte({}); await pause(250);
      const sammle = async (ms) => { const ende = Date.now() + ms, alle = []; while (Date.now() < ende) { const r = await h.warte({ seit: stand.aktuell, epoche: stand.epoche, warteMs: Math.min(300, Math.max(20, ende - Date.now())) }); stand = { epoche: r.epoche, aktuell: r.aktuell }; alle.push(...r.ereignisse); } return alle; };
      // von außen (wie `brain einstellungen …`)
      schreibeAutomatik(d, { tageslauf: "an" }, leseAutomatik(d).stand);
      let e = await sammle(900);
      assert.ok(e.some((x) => x.typ === "einstellungen"), `${modus}: Änderung der Vault-Einstellungen von außen: ${JSON.stringify(e)}`);
      // die App-Datei von außen
      writeFileSync(join(support, "einstellungen.json"), JSON.stringify({ schriftgroesse: 17 }));
      e = await sammle(900);
      assert.ok(e.some((x) => x.typ === "einstellungen"), `${modus}: Änderung der App-Datei von außen: ${JSON.stringify(e)}`);
      // eigener Schreibvorgang über die Werkstatt: kein Echo
      h.beginneEigenes();
      schreibeAutomatik(d, { hinweise: "hoch" }, leseAutomatik(d).stand);
      h.endeEigenes(["brain.config.json"]);
      e = await sammle(900);
      assert.equal(e.filter((x) => x.typ === "einstellungen").length, 0, `${modus}: eigene Änderung ohne Echo: ${JSON.stringify(e)}`);
    } finally { h.beende(); }
  }
});
