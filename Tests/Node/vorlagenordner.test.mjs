// Review W5: der Vorlagenordner ist eine Eigenschaft des Vaults (brain.config.json, ordner.vorlagen; Standard 01_vorlagen).
// Ein vorhandener Ordner „Vorlagen“ in einem alten Vault bleibt Notizen; nur ein Vault, der ihn so einstellt (neue Beispiel-Vaults tun es), behandelt ihn als Vorlagen.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { vorlagenAuswerten, vorlagenOrdnerVon } = await import(pfad("gemeinsam", "basis.mjs"));
const { vorlageDateien } = await import(pfad("gemeinsam", "vorlage.mjs"));

function vaultMit(dateien, config) {
  const d = tmp("kortex-vorlagenordner-");
  if (config !== undefined) writeFileSync(join(d, "brain.config.json"), typeof config === "string" ? config : JSON.stringify(config));
  for (const [p, inhalt] of Object.entries(dateien)) { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), inhalt); }
  return d;
}
const bereiche = async (d) => Object.fromEntries((await oeffneVault(d).notizen()).notizen.map((n) => [n.pfad, n.bereich]));
const ECHTE = { "Vorlagen/Kundenliste.md": "# Kundenliste\n\nEchte Notiz.\n", "Vorlagen/Ideen.md": "# Ideen\n\nNoch eine.\n", "01_vorlagen/Alt.md": "# Alt\n" };

test("W5: ein alter Vault mit einem Ordner „Vorlagen“ voller echter Notizen behält sie als Notizen; nur 01_vorlagen gilt wie bisher", async () => {
  for (const config of [undefined, { name: "x" }, { ordner: { inbox: "00_inbox" } }]) {
    const d = vaultMit(ECHTE, config);
    assert.equal(vorlagenOrdnerVon(d), "01_vorlagen");
    const b = await bereiche(d);
    assert.ok(["notiz", "inbox"].includes(b["Vorlagen/Kundenliste.md"]), `${JSON.stringify(config)}: ${b["Vorlagen/Kundenliste.md"]}`); // gewöhnliche Notiz (ohne Posteingang-Ordner zählen lose Notizen zum Posteingang)
    assert.ok(["notiz", "inbox"].includes(b["Vorlagen/Ideen.md"]));
    assert.equal(b["01_vorlagen/Alt.md"], "vorlage");
    assert.equal((await oeffneVault(d).notizen()).vorlagenOrdner, "01_vorlagen", "die Antwort nennt den Ordner (Studio, MCP: dieselbe Regel)");
  }
});

test("W5: stellt der Vault „Vorlagen“ als Vorlagenordner ein, sind die Notizen darin Vorlagen (auch Groß/klein) und 01_vorlagen wieder gewöhnlich", async () => {
  const d = vaultMit({ ...ECHTE, "09_wiki/x.md": "# W\n" }, { ordner: { vorlagen: "Vorlagen" } });
  const b = await bereiche(d);
  assert.equal(b["Vorlagen/Kundenliste.md"], "vorlage");
  assert.ok(["notiz", "inbox"].includes(b["01_vorlagen/Alt.md"]));
  assert.equal(b["09_wiki/x.md"], "wissen");
  assert.equal((await oeffneVault(d).notizen()).vorlagenOrdner, "Vorlagen");
});

test("W5: Posteingang, Aufgaben, Wiki, Archiv, Pfade und versteckte Namen werden als Vorlagenordner abgelehnt (Standard bleibt, mit Grund)", () => {
  const faelle = [
    [{ ordner: { vorlagen: "00_inbox" } }], [{ ordner: { vorlagen: "05_aufgaben" } }], [{ ordner: { vorlagen: "09_wiki" } }], [{ ordner: { vorlagen: "90_archiv" } }],
    [{ ordner: { vorlagen: "09_WIKI" } }], [{ ordner: { inbox: "Eingang", vorlagen: "eingang" } }], [{ ordner: { aufgaben: "Todo", vorlagen: "todo" } }],
    [{ ordner: { wiki: "Wissen", vorlagen: "Wissen" } }], [{ ordner: { archiv: "Alt", vorlagen: "Alt" } }],
    [{ ordner: { vorlagen: "a/b" } }], [{ ordner: { vorlagen: "../x" } }], [{ ordner: { vorlagen: ".versteckt" } }], [{ ordner: { vorlagen: 5 } }],
  ];
  for (const [config] of faelle.map((f) => f)) {
    const d = vaultMit({}, config);
    const a = vorlagenAuswerten(d);
    assert.equal(a.name, "01_vorlagen", JSON.stringify(config));
    assert.equal(a.abgelehnt, true, JSON.stringify(config));
    assert.ok(a.grund, JSON.stringify(config));
  }
  assert.equal(vorlagenAuswerten(vaultMit({}, "{kaputt")).name, "01_vorlagen", "kaputte Konfiguration: Standard, kein Absturz");
  assert.equal(vorlagenAuswerten(vaultMit({}, { ordner: { vorlagen: "Meine Vorlagen" } })).abgelehnt, true, "Leerzeichen sind kein gültiger Ordnername (wie beim Posteingang)");
});

test("W5: der neue Beispiel-Vault stellt „Vorlagen“ selbst ein — seine Vorlagen zählen nicht als Notizen", async () => {
  const dateien = vorlageDateien({ name: "Test", heute: "2026-11-05" });
  const d = vaultMit(Object.fromEntries(dateien.map((x) => [x.pfad, x.inhalt])));
  assert.equal(JSON.parse(dateien.find((x) => x.pfad === "brain.config.json").inhalt).ordner.vorlagen, "Vorlagen");
  const b = await bereiche(d);
  for (const n of ["Besprechung", "Projekt", "Tagesnotiz"]) assert.equal(b[`Vorlagen/${n}.md`], "vorlage", n);
});
