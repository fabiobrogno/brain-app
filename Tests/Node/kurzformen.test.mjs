// Kurzformen („morgen“, „@freitag“, „!hoch“): gemeinsame Logik für Studio, Werkstatt und MCP (gemeinsam/kurzformen.mjs).
// Dieselben Fälle liest der Swift-Test des Erfassen-Fensters (Tests/BrainCoreTests/ErfassenKurzformenTests.swift) aus Tests/Gemeinsam/kurzformen-faelle.json:
// weicht eine Seite ab, wird einer der beiden Tests rot. Nur Wegwerf-Vaults in os.tmpdir().
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { liesKurzformen, faelligText, REGELN } = await import(pfad("gemeinsam", "kurzformen.mjs"));
const { heuteIso } = await import(pfad("gemeinsam", "zeit.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { bearbeite } = await import(pfad("mcp", "brain-mcp.mjs"));

const FAELLE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "Gemeinsam", "kurzformen-faelle.json"), "utf8"));

test("gemeinsame Fälle: jede Eingabe wird gelesen wie in Swift (Tests/Gemeinsam/kurzformen-faelle.json)", () => {
  assert.ok(FAELLE.faelle.length >= 60, "die Fälle sind da");
  const fehler = [];
  for (const f of FAELLE.faelle) {
    const e = liesKurzformen(f.eingabe, { heute: f.heute || FAELLE.heute, ...(f.optionen || {}) });
    for (const [feld, soll] of Object.entries(f.erwartet)) {
      if (e[feld] !== soll) fehler.push(`${f.name}: ${feld} war ${JSON.stringify(e[feld])}, erwartet ${JSON.stringify(soll)}`);
    }
  }
  assert.deepEqual(fehler, []);
});

test("gemeinsame Fälle: faelligText", () => {
  for (const f of FAELLE.faelligText) assert.equal(faelligText(f.iso, FAELLE.heute), f.erwartet, f.iso);
});

test("Zeitzonen: derselbe Zeitpunkt ergibt je nach Zone ein anderes „heute“ — und damit ein anderes Fälligkeitsdatum", () => {
  for (const z of FAELLE.zeitpunkte) {
    const heute = heuteIso(new Date(z.zeitpunkt), z.zone);
    assert.equal(heute, z.heute, `${z.name}: heute`);
    assert.equal(liesKurzformen(z.eingabe, { heute }).faellig, z.faellig, `${z.name}: Fälligkeit`);
  }
});

test("Zeitzonen: ohne Angabe gilt die Zeitzone des Prozesses (TZ), nicht Berlin", () => {
  const alt = process.env.TZ;
  try {
    const t = new Date("2026-10-30T23:30:00Z");
    process.env.TZ = "Asia/Tokyo"; assert.equal(liesKurzformen("Steuer heute", {}).faellig, heuteIso(), "heute = Tokio");
    assert.equal(liesKurzformen("Steuer morgen", { heute: heuteIso(t) }).faellig, "2026-11-01");
    process.env.TZ = "America/Los_Angeles"; assert.equal(heuteIso(t), "2026-10-30");
    process.env.TZ = "Europe/Berlin"; assert.equal(heuteIso(t), "2026-10-31");
  } finally { if (alt === undefined) delete process.env.TZ; else process.env.TZ = alt; }
});

test("Regeln: die Hilfetexte nennen alle Kurzformen", () => {
  const alle = REGELN.join(" ");
  for (const wort of ["!hoch", "!niedrig", "!!", "@morgen", "bis morgen", "fällig", "übermorgen", "in 3 Tagen", "nächste Woche"]) assert.ok(alle.includes(wort), wort);
  assert.deepEqual(FAELLE.regeln, REGELN, "dieselben Sätze wie in Swift (Kurzformen.regeln)");
});

test("Ergebnis ist immer vollständig, auch bei kaputten Eingaben", () => {
  for (const x of [undefined, null, "", "\n\n", "   "]) {
    assert.deepEqual(liesKurzformen(x, { heute: "2026-10-30" }), { titel: "", text: "", prioritaet: null, faellig: null, prioritaetWort: null, faelligWort: null }, String(x));
  }
});

// ───────────────────────────── Werkstatt und MCP ─────────────────────────────

const vaultOrdner = () => { const d = tmp("brain-kurz-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "notiz.md", "# Notiz\n"); return d; };
const feld = (d, rel, k) => new RegExp(`^${k}: (.*)$`, "m").exec(readFileSync(join(d, rel), "utf8"))?.[1];
let nr = 0;
const mcp = async (v, name, args) => (await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name, arguments: args } }, undefined, { klient: "claude-code", angelegt: 0 })).result;
const text = (r) => r.content.map((c) => c.text).join("\n");
const zeitpunkt = () => new Date("2026-10-30T12:00:00Z"); // Freitag, 30.10.2026

test("MCP brain_aufgabe_anlegen liest Kurzformen im Titel (README-Versprechen: morgen, !hoch)", async () => {
  const d = vaultOrdner();
  const v = oeffneVault(d, { jetzt: zeitpunkt });
  const r = await mcp(v, "brain_aufgabe_anlegen", { titel: "Steuererklärung abgeben morgen !hoch" });
  assert.ok(!r.isError, text(r));
  const rel = text(r).replace("Aufgabe angelegt: ", "").trim();
  assert.equal(feld(d, rel, "titel"), "Steuererklärung abgeben");
  assert.equal(feld(d, rel, "prioritaet"), "hoch");
  assert.equal(feld(d, rel, "faellig"), "2026-10-31");
});

test("MCP: ausdrücklich mitgegebene Felder gelten und werden im Titel nicht gelesen; ohne Kurzform bleibt alles wie vorher", async () => {
  const d = vaultOrdner();
  const v = oeffneVault(d, { jetzt: zeitpunkt });
  const a = text(await mcp(v, "brain_aufgabe_anlegen", { titel: "Bericht schreiben morgen", faellig: "2026-12-01" })).replace("Aufgabe angelegt: ", "").trim();
  assert.equal(feld(d, a, "faellig"), "2026-12-01"); assert.equal(feld(d, a, "titel"), "Bericht schreiben morgen", "Fälligkeit war schon gesetzt: der Titel bleibt unberührt");
  const b = text(await mcp(v, "brain_aufgabe_anlegen", { titel: "Blumen gießen", prioritaet: "niedrig" })).replace("Aufgabe angelegt: ", "").trim();
  assert.equal(feld(d, b, "prioritaet"), "niedrig"); assert.equal(feld(d, b, "titel"), "Blumen gießen");
  const c = text(await mcp(v, "brain_aufgabe_anlegen", { titel: "Nur Text", text: "Details" })).replace("Aufgabe angelegt: ", "").trim();
  assert.equal(feld(d, c, "prioritaet"), "normal"); assert.equal(feld(d, c, "faellig"), undefined);
  const e = text(await mcp(v, "brain_aufgabe_anlegen", { titel: "Mit Datum @12.11.\nzweite Zeile" })).replace("Aufgabe angelegt: ", "").trim();
  assert.equal(feld(d, e, "faellig"), "2026-11-12"); assert.match(readFileSync(join(d, e), "utf8"), /zweite Zeile/);
});

test("MCP: „morgen“ rechnet in der Zeitzone des Macs (nicht in Berlin)", async () => {
  const alt = process.env.TZ;
  try {
    const d = vaultOrdner();
    const v = oeffneVault(d, { jetzt: () => new Date("2026-10-30T23:30:00Z") }); // Berlin: schon der 31., Los Angeles: noch der 30.
    process.env.TZ = "America/Los_Angeles";
    const a = text(await mcp(v, "brain_aufgabe_anlegen", { titel: "Steuer morgen" })).replace("Aufgabe angelegt: ", "").trim();
    assert.equal(feld(d, a, "faellig"), "2026-10-31");
    process.env.TZ = "Europe/Berlin";
    const b = text(await mcp(v, "brain_aufgabe_anlegen", { titel: "Zweite morgen" })).replace("Aufgabe angelegt: ", "").trim();
    assert.equal(feld(d, b, "faellig"), "2026-11-01");
  } finally { if (alt === undefined) delete process.env.TZ; else process.env.TZ = alt; }
});

test("Werkstatt-Route POST /api/aufgaben nimmt Priorität und Fälligkeit, die das Studio aus den Kurzformen gelesen hat", async () => {
  const d = vaultOrdner();
  const h = erzeugeHandler({ vault: d });
  const k = liesKurzformen("Steuererklärung abgeben morgen !hoch", { heute: heuteIso(zeitpunkt()) });
  const r = await h({ methode: "POST", pfad: "/api/aufgaben", query: null, body: Buffer.from(JSON.stringify({ titel: k.titel, prioritaet: k.prioritaet, faellig: k.faellig })) });
  const j = JSON.parse(r.body.toString("utf8"));
  assert.equal(r.status, 200);
  assert.equal(j.aufgabe.titel, "Steuererklärung abgeben"); assert.equal(j.aufgabe.prioritaet, "hoch"); assert.equal(j.aufgabe.faellig, heuteIso(new Date(zeitpunkt().getTime() + 86400000)));
});
