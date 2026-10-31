// Ein konfigurierter Posteingang (brain.config.json → ordner.inbox) gilt überall gleich: Notiz-Index (Bereiche inbox/maschine), Live-Ereignisse
// (klassifiziere) und das Ergebnis von notizen()/indexAlles() (Feld inboxOrdner). Ungültige Namen fallen auf 00_inbox zurück.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { inboxOrdnerVon } = await import(pfad("gemeinsam", "basis.mjs"));
const { klassifiziere, erzeugeEreignisse } = await import(pfad("werkstatt", "ereignisse.mjs"));

const vault = (config) => {
  const d = tmp("brain-inbox-");
  schreibe(d, "00_inbox/alt.md", "# Alt\n");
  schreibe(d, "Eingang/neu.md", "# Neu\n");
  schreibe(d, "Eingang/_vorschlaege/v1.md", "# Vorschlag\n");
  schreibe(d, "10_notizen/n.md", "---\ntyp: thema\n---\n# N\n");
  if (config !== undefined) schreibe(d, "brain.config.json", typeof config === "string" ? config : JSON.stringify(config));
  return { d, v: oeffneVault(d, { heute: "2026-10-30" }) };
};
const bereiche = async (v) => Object.fromEntries((await v.notizen()).notizen.map((z) => [z.pfad, z.bereich]));

test("konfigurierter Posteingang „Eingang“: Index ordnet ihn zu inbox/maschine, 00_inbox ist dann gewöhnlich; Feld inboxOrdner", async () => {
  const { v } = vault({ ordner: { inbox: "Eingang" } });
  const r = await v.notizen();
  assert.equal(r.inboxOrdner, "Eingang");
  const b = Object.fromEntries(r.notizen.map((z) => [z.pfad, z.bereich]));
  assert.equal(b["Eingang/neu.md"], "inbox");
  assert.equal(b["Eingang/_vorschlaege/v1.md"], "maschine");
  assert.notEqual(b["00_inbox/alt.md"], "inbox");
  assert.equal((await v.indexAlles()).inboxOrdner, "Eingang");
});

test("Groß/Klein zählt beim Vergleich nicht", async () => {
  const { v } = vault({ ordner: { inbox: "EINGANG" } });
  assert.equal((await bereiche(v))["Eingang/neu.md"], "inbox");
});

test("ohne Konfiguration bleibt 00_inbox der Posteingang", async () => {
  const { v } = vault();
  const r = await v.notizen();
  assert.equal(r.inboxOrdner, "00_inbox");
  const b = Object.fromEntries(r.notizen.map((z) => [z.pfad, z.bereich]));
  assert.equal(b["00_inbox/alt.md"], "inbox");
  assert.notEqual(b["Eingang/neu.md"], "inbox");
});

test("ungültige Namen (versteckt, Wiki, Archiv, mit „/“) fallen auf 00_inbox zurück — im Index und in inboxOrdnerVon", async () => {
  const schlecht = [{ ordner: { inbox: ".geheim" } }, { ordner: { inbox: "Wissen", wiki: "wissen" } }, { ordner: { inbox: "09_wiki" } },
    { ordner: { inbox: "Ablage", archiv: "ABLAGE" } }, { ordner: { inbox: "90_archiv" } }, { ordner: { inbox: "a/b" } }, { ordner: { inbox: ".." } }, "kein json {"];
  for (const c of schlecht) {
    const { d, v } = vault(c);
    assert.equal(inboxOrdnerVon(d), "00_inbox", JSON.stringify(c));
    const r = await v.notizen();
    assert.equal(r.inboxOrdner, "00_inbox", JSON.stringify(c));
    assert.equal(r.notizen.find((z) => z.pfad === "00_inbox/alt.md").bereich, "inbox", JSON.stringify(c));
  }
  assert.equal(inboxOrdnerVon(tmp("brain-inbox-leer-")), "00_inbox"); // keine Konfiguration, wirft nie
  assert.equal(inboxOrdnerVon("/gibt/es/nicht"), "00_inbox");
});

test("Ereignisse: klassifiziere kennt den Posteingang über die Option (Standard 00_inbox, Vergleich ohne Groß/Klein)", () => {
  assert.equal(klassifiziere("Eingang/x.md", { inboxOrdner: "Eingang" }).bereich, "posteingang");
  assert.equal(klassifiziere("eingang/x.md", { inboxOrdner: "Eingang" }).bereich, "posteingang");
  assert.equal(klassifiziere("00_inbox/x.md", { inboxOrdner: "Eingang" }).bereich, "notiz");
  assert.equal(klassifiziere("00_inbox/x.md").bereich, "posteingang");
  assert.equal(klassifiziere("Eingang/x.md").bereich, "notiz");
  assert.equal(klassifiziere("Eingang/x.md", { inboxOrdner: "Eingang", aufgabenOrdner: "Eingang" }).bereich, "aufgabe"); // Aufgaben gehen vor
  assert.equal(klassifiziere(".geheim/x.md", { inboxOrdner: ".geheim" }), null); // Verstecktes wird nie gemeldet
});

test("Beobachter: meldet Dateien im konfigurierten Posteingang als „posteingang“ und liest brain.config.json bei jedem Flush neu", async () => {
  const d = tmp("brain-inbox-live-");
  schreibe(d, "brain.config.json", JSON.stringify({ ordner: { inbox: "Eingang" } }));
  schreibe(d, "Eingang/.gitkeep", "");
  schreibe(d, "00_inbox/.gitkeep", "");
  const h = erzeugeEreignisse({ entprellMs: 60, maxWarteMs: 300, pollMs: 80 });
  try {
    h.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
    let stand = await h.warte({});
    await new Promise((ok) => setTimeout(ok, 150));
    const sammle = async (genuegt) => {
      const alle = [], ende = Date.now() + 6000;
      while (Date.now() < ende && !genuegt(alle)) {
        const r = await h.warte({ seit: stand.aktuell, epoche: stand.epoche, warteMs: 400 });
        stand = { epoche: stand.epoche, aktuell: r.aktuell }; alle.push(...r.ereignisse);
      }
      return alle;
    };
    writeFileSync(`${d}/Eingang/a.md`, "A\n");
    writeFileSync(`${d}/00_inbox/b.md`, "B\n");
    const e1 = await sammle((l) => l.some((x) => x.pfad === "Eingang/a.md") && l.some((x) => x.pfad === "00_inbox/b.md"));
    assert.equal(e1.find((x) => x.pfad === "Eingang/a.md").typ, "posteingang");
    assert.equal(e1.find((x) => x.pfad === "00_inbox/b.md").typ, "notiz");
    // Konfiguration ändern: ohne Neustart gilt gleich der neue Posteingang
    writeFileSync(`${d}/brain.config.json`, JSON.stringify({}));
    await new Promise((ok) => setTimeout(ok, 200));
    writeFileSync(`${d}/00_inbox/c.md`, "C\n");
    const e2 = await sammle((l) => l.some((x) => x.pfad === "00_inbox/c.md"));
    assert.equal(e2.find((x) => x.pfad === "00_inbox/c.md").typ, "posteingang");
  } finally { h.beende(); }
});
