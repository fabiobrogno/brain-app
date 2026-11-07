// „Was ist neu“ (gemeinsam/neuigkeiten.mjs, vault.neuigkeiten, GET /api/neuigkeiten): Kartendaten aus lokalen Quellen, Merker „gelesen“, ehrliche Lücken. Nur Wegwerf-Ordner, keine KI.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const N = await import(pfad("gemeinsam", "neuigkeiten.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const JETZT = new Date("2026-11-07T12:00:00Z");
const SEIT = "2026-11-05T00:00:00Z";
const zeile = (pfad, o = {}) => ({ pfad, titel: pfad.replace(/^.*\//, "").replace(/\.md$/, ""), bereich: "notiz", generiert: false, erstellt: "2026-10-01T00:00:00Z", geaendert: "2026-10-01T00:00:00Z", felder: {}, ...o });

test("Notizen: neu und geändert getrennt (eine neue Notiz zählt nicht doppelt), nur sichtbare Bereiche, neueste zuerst", () => {
  const r = N.baueNeuigkeiten({ seit: SEIT, jetzt: JETZT, heute: "2026-11-07", notizen: [
    zeile("a.md", { erstellt: "2026-11-06T08:00:00Z", geaendert: "2026-11-06T09:00:00Z" }),
    zeile("b.md", { erstellt: "2026-11-06T10:00:00Z", geaendert: "2026-11-06T10:00:00Z" }),
    zeile("c.md", { geaendert: "2026-11-06T11:00:00Z" }),
    zeile("d.md", { geaendert: "2026-11-04T23:59:59Z" }),
    zeile("arch.md", { bereich: "archiv", erstellt: "2026-11-06T10:00:00Z" }),
    zeile("auto.md", { generiert: true, erstellt: "2026-11-06T10:00:00Z" }),
    zeile("vorlage.md", { bereich: "vorlage", erstellt: "2026-11-06T10:00:00Z" }),
    zeile("w.md", { bereich: "wissen", erstellt: "2026-11-05T00:00:01Z" }),
  ] });
  assert.equal(r.notizen.neu, 3); assert.equal(r.notizen.geaendert, 1);
  assert.deepEqual(r.notizen.neuListe.map((x) => x.pfad), ["b.md", "a.md", "w.md"]);
  assert.deepEqual(r.notizen.geaendertListe.map((x) => x.pfad), ["c.md"]);
  assert.equal(r.leer, false);
});

test("Aufgaben: neu, erledigt seit, überfällig (jetzt); erledigte zählen nie als überfällig; Liste auf fünf gekürzt", () => {
  const auf = [
    { pfad: "5/a.md", titel: "A", status: "offen", erstellt: "2026-11-06T00:00:00Z", geaendert: "2026-11-06T00:00:00Z", faellig: "2026-11-06" },
    { pfad: "5/b.md", titel: "B", status: "erledigt", erstellt: "2026-10-01T00:00:00Z", geaendert: "2026-11-06T00:00:00Z", faellig: "2026-11-01" },
    { pfad: "5/c.md", titel: "C", status: "in-arbeit", erstellt: "2026-10-01T00:00:00Z", geaendert: "2026-10-02T00:00:00Z", faellig: "2026-11-07" },
    { pfad: "5/d.md", titel: "D", status: "warten", erstellt: "2026-10-01T00:00:00Z", geaendert: "2026-10-02T00:00:00Z", faellig: "2026-10-20" },
    ...Array.from({ length: 8 }, (_, i) => ({ pfad: `5/x${i}.md`, titel: `X${i}`, status: "offen", erstellt: "2026-11-06T01:00:00Z", geaendert: "2026-11-06T01:00:00Z" })),
  ];
  const r = N.baueNeuigkeiten({ seit: SEIT, jetzt: JETZT, heute: "2026-11-07", aufgaben: auf });
  assert.equal(r.aufgaben.neu, 9); assert.equal(r.aufgaben.erledigt, 1); assert.equal(r.aufgaben.ueberfaellig, 2);
  assert.deepEqual(r.aufgaben.ueberfaelligListe.map((x) => x.titel), ["D", "A"], "älteste Fälligkeit zuerst");
  assert.equal(r.aufgaben.neuListe.length, N.MAX_LISTE);
  assert.equal(r.notizen, null, "ohne Notiz-Zeilen keine Zahlen erfunden");
});

test("KI-Aktivität aus dem Protokoll: abgelegt und abgewiesen seit dem Zeitpunkt, mit Pfad des ersten Eintrags", () => {
  const ev = [
    { id: "a_1", zeit: "2026-11-06T10:00:00Z", art: "ablage-notiz", text: "Notiz abgelegt", pfade: ["00_inbox/x.md"], programm: "claude" },
    { id: "a_2", zeit: "2026-11-06T11:00:00Z", art: "ablage-aufgabe", text: "Aufgabe abgelegt", pfade: ["05_aufgaben/y.md"] },
    { id: "a_3", zeit: "2026-11-06T12:00:00Z", art: "abweisung", text: "Abgewiesen: gesperrt" },
    { id: "a_4", zeit: "2026-11-01T12:00:00Z", art: "abweisung", text: "alt" },
    { id: "a_5", zeit: "2026-11-06T12:00:00Z", art: "datei-aktion", text: "eigene Aktion zählt nicht" },
  ];
  const r = N.baueNeuigkeiten({ seit: SEIT, jetzt: JETZT, heute: "2026-11-07", ereignisse: ev });
  assert.equal(r.ki.abgelegt, 2); assert.equal(r.ki.abgewiesen, 1);
  assert.deepEqual(r.ki.abgelegtListe.map((x) => x.id), ["a_2", "a_1"]);
  assert.equal(r.ki.abgelegtListe[1].pfad, "00_inbox/x.md"); assert.equal(r.ki.abgelegtListe[1].programm, "claude");
});

test("Abgleich-Zustand: jeder Fall mit eigenem Satz, nie ein erfundener Erfolg", () => {
  const z = (g) => N.syncZustand(g).zustand;
  assert.equal(z(null), "unbekannt");
  assert.equal(z({ gesperrt: true, repo: true }), "gesperrt");
  assert.equal(z({ repo: false }), "kein-git");
  assert.equal(z({ repo: true, konflikt: { dateien: 1 }, remote: true }), "konflikt");
  assert.equal(z({ repo: true, remote: false, geaendert: ["a"] }), "kein-remote");
  assert.equal(z({ repo: true, remote: true, zurueck: 2, vor: 0, geaendert: [] }), "holen");
  assert.equal(z({ repo: true, remote: true, zurueck: 0, vor: 1, geaendert: [] }), "senden");
  assert.equal(z({ repo: true, remote: true, zurueck: 0, vor: 0, geaendert: ["x", "y"] }), "senden");
  const ok = N.syncZustand({ repo: true, remote: true, zurueck: 0, vor: 0, geaendert: [], letzterSync: "2026-11-07T10:00:00Z" });
  assert.equal(ok.zustand, "ok"); assert.equal(ok.letzterSync, "2026-11-07T10:00:00Z");
  assert.match(N.syncZustand({ repo: true, remote: true, zurueck: 1, vor: 0, geaendert: [] }).text, /^1 Stand wartet/);
});

test("Posteingang: Anzahl ohne zurückgestellte; ohne Treffer ist die Karte leer; ohne Zeit gilt die Standardspanne", () => {
  const r = N.baueNeuigkeiten({ seit: null, jetzt: JETZT, heute: "2026-11-07", notizen: [
    zeile("00_inbox/a.md", { bereich: "inbox" }), zeile("00_inbox/b.md", { bereich: "inbox", felder: { spaeter_bis: "2026-11-10" } }), zeile("00_inbox/c.md", { bereich: "inbox", felder: { spaeter_bis: "2026-11-01" } }) ] });
  assert.deepEqual(r.inbox, { anzahl: 2, zurueckgestellt: 1 });
  assert.equal(r.leer, true);
  assert.equal(r.seit, new Date(JETZT.getTime() - N.STANDARD_TAGE * 86400e3).toISOString());
});

test("Merker: schreiben, lesen, ungültig; je Vault getrennt", () => {
  const s = tmp("nk-support-");
  assert.equal(N.leseMarke(s, "aaaaaaaaaaaaaaaa"), null);
  assert.equal(N.setzeMarke(s, "aaaaaaaaaaaaaaaa", "2026-11-07T10:00:00+01:00"), "2026-11-07T09:00:00.000Z");
  assert.equal(N.leseMarke(s, "aaaaaaaaaaaaaaaa"), "2026-11-07T09:00:00.000Z");
  assert.equal(N.leseMarke(s, "bbbbbbbbbbbbbbbb"), null);
  assert.throws(() => N.setzeMarke(s, "aaaaaaaaaaaaaaaa", "gestern"));
  writeFileSync(join(s, "neuigkeiten", "cccccccccccccccc.json"), "{kaputt");
  assert.equal(N.leseMarke(s, "cccccccccccccccc"), null);
});

test("Text für den MCP-Server: wenige Zeilen, ohne Notizinhalte", () => {
  const r = N.baueNeuigkeiten({ seit: SEIT, jetzt: JETZT, heute: "2026-11-07", notizen: [zeile("a.md", { erstellt: "2026-11-06T08:00:00Z" })], aufgaben: [], ereignisse: [], git: { repo: false } });
  const t = N.neuigkeitenText(r);
  assert.ok(t.split("\n").length <= 8);
  assert.match(t, /Notizen: 1 neu, 0 geändert · neu: a \(a\.md\)/);
  assert.match(t, /Abgleich: Dieser Vault wird nicht mit Git gesichert\./);
});

// ───────────────────────────── Werkstatt ─────────────────────────────
function werkstatt() {
  const support = tmp("nk-r-support-"), d = tmp("nk-r-vault-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, "00_inbox/eins.md", "# Eins\n"); schreibe(d, "00_inbox/zwei.md", "# Zwei\n"); schreibe(d, "wissen/a.md", "# A\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support, heute: "2026-11-07" }, ereignisse: { modus: "poll", pollMs: 80, entprellMs: 40 } });
  const rufe = async (methode, p, daten) => { const [pf, q] = p.split("?"); const r = await h({ methode, pfad: pf, query: q || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* */ } return { status: r.status, j }; };
  return { d, support, rufe };
}

test("Route: Zahlen aus Notizen, Aufgaben und Protokoll; „gelesen“ setzt den Merker, danach ist die Karte leer; ?seit überschreibt", async () => {
  const { d, support, rufe } = werkstatt();
  const r0 = await rufe("POST", "/api/aufgaben", { titel: "Steuer abgeben", faellig: "2026-11-01" });
  assert.equal(r0.status, 200);
  A.schreibeEreignis(support, d, { art: "ablage-notiz", text: "Notiz abgelegt", pfade: ["00_inbox/eins.md"], programm: "claude" });
  A.schreibeEreignis(support, d, { art: "abweisung", text: "Abgewiesen: Schreiben gesperrt" });
  const g = await rufe("GET", "/api/neuigkeiten?seit=" + encodeURIComponent(new Date(Date.now() - 86400e3).toISOString()));
  assert.equal(g.status, 200);
  assert.equal(g.j.seitArt, "gewaehlt"); assert.equal(g.j.marke, null);
  assert.equal(g.j.notizen.neu, 3); assert.equal(g.j.aufgaben.neu, 1); assert.equal(g.j.aufgaben.ueberfaellig, 1);
  assert.equal(g.j.ki.abgelegt, 1); assert.equal(g.j.ki.abgewiesen, 1);
  assert.equal(g.j.inbox.anzahl, 2);
  assert.equal(g.j.sync.zustand, "kein-git");
  assert.equal(g.j.leer, false);
  // ohne Merker und Auswahl: die Standardspanne
  const s = await rufe("GET", "/api/neuigkeiten");
  assert.equal(s.j.seitArt, "standard"); assert.equal(s.j.notizen.neu, 3);
  // gelesen
  const ok = await rufe("POST", "/api/neuigkeiten/gelesen", {});
  assert.equal(ok.status, 200); assert.ok(ok.j.gelesenBis);
  const danach = await rufe("GET", "/api/neuigkeiten");
  assert.equal(danach.j.seitArt, "besuch"); assert.equal(danach.j.marke, ok.j.gelesenBis);
  assert.equal(danach.j.notizen.neu, 0); assert.equal(danach.j.ki.abgelegt, 0); assert.equal(danach.j.aufgaben.neu, 0);
  assert.equal(danach.j.aufgaben.ueberfaellig, 1, "überfällig ist ein Zustand, kein Ereignis");
  assert.equal(danach.j.inbox.anzahl, 2);
  assert.equal(danach.j.leer, true);
  // der Merker liegt im Support-Ordner, nie im Vault
  assert.ok(existsSync(join(support, "neuigkeiten")));
  assert.equal(existsSync(join(d, "neuigkeiten")), false);
  // Eingaben und Methoden
  assert.equal((await rufe("GET", "/api/neuigkeiten?seit=gestern")).status, 400);
  assert.equal((await rufe("POST", "/api/neuigkeiten/gelesen", { bis: "nie" })).status, 400);
  assert.equal((await rufe("POST", "/api/neuigkeiten", {})).status, 405);
  assert.equal((await rufe("GET", "/api/neuigkeiten/gelesen")).status, 405);
});

test("Eine nicht lesbare Quelle fehlt in der Antwort (null), der Rest kommt trotzdem", async () => {
  const d = tmp("nk-x-vault-"), support = tmp("nk-x-support-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "a.md", "# A\n");
  const v = oeffneVault(d, { support, kern: tmp("nk-x-kern-") }); // Kern ohne aufgaben.mjs → Aufgaben nicht lesbar (503)
  const r = await v.neuigkeiten({ seit: new Date(Date.now() - 3600e3).toISOString() });
  assert.equal(r.aufgaben, null);
  assert.equal(r.notizen.neu, 1);
});

// ───────────────────────────── MCP: brain_neuigkeiten ─────────────────────────────
test("MCP brain_neuigkeiten: nur lesend, ab Stufe „lesen“, kurz; gesperrt liefert nichts; falsche Zeit wird abgewiesen; der Merker des Nutzers bleibt unberührt", async () => {
  process.env.BRAIN_NUTZUNG = "aus";
  const { bearbeite, WERKZEUGE } = await import(pfad("mcp", "brain-mcp.mjs"));
  const d = tmp("nk-mcp-vault-"), support = tmp("nk-mcp-support-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/a.md", "# Geheimtitel Alpha\n"); schreibe(d, "wissen/b.md", "# B\n");
  const v = oeffneVault(d, { support });
  const rufe = (a, zugriff = null, name = "brain_neuigkeiten") => bearbeite(v, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: a } }, "0.2.0", undefined, zugriff);
  const konto = (stufe) => ({ defekt: () => false, stufe: () => stufe, kontoName: () => ({ id: "k_aaaaaaaa", programm: "claude", name: "A" }), gefiltert: () => true });
  const w = WERKZEUGE.find((x) => x.name === "brain_neuigkeiten");
  assert.ok(w); assert.ok(w.description.length <= 90); assert.deepEqual(Object.keys(w.inputSchema.properties), ["seit"]);
  const ok = await rufe({}, konto("lesen"));
  assert.ok(!ok.result.isError, JSON.stringify(ok.result));
  const t = ok.result.content[0].text;
  assert.match(t, /^Neuigkeiten seit /); assert.match(t, /Notizen: 2 neu, 0 geändert/); assert.match(t, /Abgleich:/); assert.match(t, /Posteingang: 1 offen/);
  assert.ok(t.length < 900, `${t.length} Zeichen`); assert.ok(t.split("\n").length <= 8);
  assert.equal((await rufe({}, konto("gesperrt"))).result.isError, true);
  assert.doesNotMatch((await rufe({}, konto("gesperrt"))).result.content[0].text, /Alpha|a\.md/);
  assert.equal((await rufe({ seit: "irgendwann" }, konto("lesen"))).result.isError, true);
  const zukunft = await rufe({ seit: new Date(Date.now() + 3600e3).toISOString() }, konto("lesen"));
  assert.match(zukunft.result.content[0].text, /Notizen: 0 neu, 0 geändert/);
  assert.equal(N.leseMarke(support, A.kennungVault(d)), null, "lesend: der Merker „gelesen“ ändert sich nie");
  assert.equal(existsSync(join(support, "neuigkeiten")), false);
});
