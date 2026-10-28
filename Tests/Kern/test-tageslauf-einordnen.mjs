// .tools/tests/test-tageslauf-einordnen.mjs — Schritt 1 Aufräumen und Schritt 3 Einordnen (B2, Task 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const A = await import("../tageslauf/aufraeumen.mjs");
const E = await import("../tageslauf/einordnen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
isoliere();
const vo = (id, extra = {}) => ({ id, art: "fakt", titel: `T ${id}`, text: `Text ${id}`, erstellt: "2026-10-20T10:00:00Z", quelleOrdner: "/p",
  unterordner: "_vorschlaege", herkunft: "du", regel: "", wartenSeit: "", ...extra });

test("aufraeumKandidaten: herkunft ki, Dublette (neueste bleibt), überholter Stand, alter Rohkandidat, Warten > 60 Tage", () => {
  const port = "Der Dienst läuft auf Port 3309 im Testsystem seit heute früh";
  const liste = [
    vo("ki1", { herkunft: "ki" }),
    vo("d-alt", { titel: "Port", text: port, erstellt: "2026-10-01T10:00:00Z" }),
    vo("d-neu", { titel: "Port", text: port, erstellt: "2026-10-02T10:00:00Z" }),
    vo("s-alt", { art: "stand", quelleOrdner: "/repo", erstellt: "2026-10-01T10:00:00Z" }),
    vo("s-neu", { art: "stand", quelleOrdner: "/repo", erstellt: "2026-10-03T10:00:00Z" }),
    vo("l-alt", { art: "lektion", titel: "Wiederholter Fehlschlag: Bash: cd x", erstellt: "2026-10-01T10:00:00Z" }),
    vo("l-paar1", { art: "lektion", titel: "Wiederholte Korrektur: tabs", erstellt: "2026-10-01T10:00:00Z" }),
    vo("l-paar2", { art: "lektion", titel: "Wiederholte Korrektur: Tabs", erstellt: "2026-10-02T10:00:00Z" }),
    vo("l-jung", { art: "lektion", titel: "Wiederholte Korrektur: neu", erstellt: "2026-10-20T10:00:00Z" }),
    vo("l-fertig", { art: "lektion", titel: "Formuliert", regel: "Immer X", erstellt: "2026-09-01T10:00:00Z" }),
    vo("w-alt", { unterordner: "_warten", wartenSeit: "2026-08-01T00:00:00Z" }),
    vo("w-jung", { unterordner: "_warten", wartenSeit: "2026-10-01T00:00:00Z" }),
  ];
  const r = Object.fromEntries(A.aufraeumKandidaten(liste, { jetzt: JETZT }).map((x) => [x.v.id, x.grund]));
  assert.deepEqual(r, { "ki1": "herkunft-ki", "d-alt": "dublette", "s-alt": "stand-ueberholt", "l-alt": "lektion-alt", "w-alt": "ohne-seite" });
});

test("aufraeumen: verschiebt ins Archiv je Grund; Probe verschiebt nichts", () => {
  const v = neuerTestVault();
  legeVorschlagAn(v, { id: "k1", herkunft: "ki" });
  legeVorschlagAn(v, { id: "ok1" });
  const probe = P.neuerLauf(v, { probe: true, claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  assert.equal(A.aufraeumen(probe, B.ladeVorschlaege(v)).aussortiert, 1);
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "k1.md")));
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const r = A.aufraeumen(ctx, B.ladeVorschlaege(v));
  assert.deepEqual([r.aussortiert, r.rest.map((x) => x.id)], [1, ["ok1"]]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "herkunft-ki", "k1.md")));
});

function wikiVault() {
  const seiten = {
    "09_wiki/projekte/entitaet_alpha.md": { fm: { name: "alpha", description: "Projekt Alpha: Ticket-Board und Testumgebung", repo: "alpha-repo", typ: "entitaet" }, rumpf: "# Alpha\n" },
    "09_wiki/firma/thema_versand.md": { fm: { name: "versand", description: "Versand mit DHL, Paketlabels und Abholung", auch_genannt: ["paketdienst"] }, rumpf: "# Versand\n" },
    "09_wiki/wissen/thema_brot.md": { fm: { name: "brot", description: "Brot backen: Sauerteig, Rezepte, Ofen", kritisch: true }, rumpf: "# Brot\n" },
    "09_wiki/wissen/thema_zwilling-a.md": { fm: { name: "zwilling-a", description: "Gartenteich Pumpe Filter" }, rumpf: "# A\n" },
    "09_wiki/wissen/thema_zwilling-b.md": { fm: { name: "zwilling-b", description: "Gartenteich Pumpe Filter" }, rumpf: "# B\n" },
  };
  for (let i = 0; i < 8; i++) seiten[`09_wiki/wissen/thema_fuell-${i}.md`] = { fm: { name: `fuell-${i}`, description: `Füllseite ${i} über Wetter Kalender Notizen ${i}` }, rumpf: "# F\n" };
  return neuerTestVault({ seiten });
}

test("einordnen: Alias, Suche über Mindestgüte, zu schwach, mehrdeutig, kritisch", () => {
  const v = wikiVault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ paketdienst: "09_wiki/firma/thema_versand.md" }));
  const karten = E.seitenKarten(v), aliasse = E.ladeAliasse(v);
  assert.equal(karten.length, 13, "nur Wiki-Seiten, ohne _log.md");
  const o = (text, minGuete = 1) => E.einordnen(v, vo("x", { titel: "Neu", text }), { karten, aliasse, minGuete });
  assert.deepEqual([o("Der Paketdienst holt jetzt dienstags ab.").seite, o("Der Paketdienst holt jetzt dienstags ab.").wie], ["09_wiki/firma/thema_versand.md", "alias"]);
  const s = o("Paketlabels für DHL druckt jetzt der neue Drucker, Abholung bleibt.");
  assert.deepEqual([s.seite, s.wie], ["09_wiki/firma/thema_versand.md", "suche"]);
  assert.deepEqual(o("Paketlabels für DHL druckt jetzt der neue Drucker.", 1000).grund, "keine-seite");
  assert.equal(o("Die Pumpe im Gartenteich braucht einen neuen Filter.").grund, "mehrdeutig");
  assert.equal(o("Sauerteig für Brot braucht zwölf Stunden im Ofen.").kritisch, true);
  assert.equal(E.seiteZu(karten, "thema_versand.md").seite, "09_wiki/firma/thema_versand.md");
  assert.equal(E.seiteZu(karten, "firma/thema_versand").seite, "09_wiki/firma/thema_versand.md");
});

test("einordnen: mehrdeutig liefert die bis zu 3 besten Kandidaten {seite, guete} — kritische Seiten sind nie dabei", () => {
  const v = wikiVault();
  const karten = E.seitenKarten(v);
  const o = E.einordnen(v, vo("x", { titel: "Neu", text: "Die Pumpe im Gartenteich braucht einen neuen Filter." }), { karten, aliasse: [], minGuete: 1 });
  assert.equal(o.grund, "mehrdeutig");
  assert.equal(o.seite, null);
  assert.deepEqual(o.kandidaten.map((k) => k.seite).sort(), ["09_wiki/wissen/thema_zwilling-a.md", "09_wiki/wissen/thema_zwilling-b.md"]);
  assert.ok(o.kandidaten.every((k) => typeof k.guete === "number" && k.guete > 0 && Object.keys(k).sort().join() === "guete,seite"));
  // Nur kritische Seiten oder gar nichts Passendes: kandidaten ist leer, nie eine kritische Seite (siehe auch die Tests zu Befund #4 unten).
  const seite = (name, description, kritisch = false) => [`09_wiki/wissen/thema_${name}.md`, { fm: { name, description, ...(kritisch ? { kritisch: true } : {}) }, rumpf: `# ${name}\n` }];
  const nurK = neuerTestVault({ seiten: Object.fromEntries([seite("teich-k1", "Gartenteich Pumpe Filter", true), seite("teich-k2", "Gartenteich Pumpe Filter", true),
    ...Array.from({ length: 8 }, (_, i) => seite(`fuell-${i}`, `Füllseite ${i} über Wetter Kalender Notizen ${i}`))]) });
  const n = E.einordnen(nurK, vo("z", { titel: "Neu", text: "Die Pumpe im Gartenteich braucht einen neuen Filter." }), { karten: E.seitenKarten(nurK), aliasse: [], minGuete: 1 });
  assert.deepEqual([n.grund, n.kandidaten], ["mehrdeutig", []]);
  // Die anderen Ausgänge tragen keine Kandidaten.
  assert.equal(E.einordnen(v, vo("w", { titel: "Neu", text: "Nichts Passendes hier Zebra" }), { karten, aliasse: [], minGuete: 1 }).kandidaten, undefined);
});

test("ladeAliasse: Format von brain-index — nur ausdrückliche, eindeutige Aliasse", () => {
  const v = wikiVault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ version: 1,
    seiten: { "09_wiki/firma/thema_versand.md": ["paketdienst"], "09_wiki/firma/thema_lager.md": ["halle", "paketdienst"] },
    namen: { paketdienst: ["09_wiki/firma/thema_lager.md", "09_wiki/firma/thema_versand.md"], halle: ["09_wiki/firma/thema_lager.md"],
      versand: ["09_wiki/firma/thema_versand.md"] } }));
  assert.deepEqual(E.ladeAliasse(v), [["halle", "09_wiki/firma/thema_lager.md"]],
    "mehrdeutig (paketdienst) und reiner Seitenname (versand) ordnen nichts zu");
  writeFileSync(join(v, ".logs", "aliasse.json"), "{kaputt");
  assert.deepEqual(E.ladeAliasse(v), []);
});

test("einordnen: Stand geht auf die Projektseite, deren repo zum quelle_ordner passt; sonst keine-projektseite", () => {
  const v = wikiVault();
  const karten = E.seitenKarten(v);
  const repo = join(tempOrdner("repos"), "alpha-repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  const r = E.einordnen(v, vo("s", { art: "stand", quelleOrdner: join(repo, "src") }), { karten, aliasse: [] });
  assert.deepEqual([r.seite, r.wie], ["09_wiki/projekte/entitaet_alpha.md", "projekt"]);
  assert.equal(E.einordnen(v, vo("s2", { art: "stand", quelleOrdner: "/gibt/es/nicht" }), { karten, aliasse: [] }).grund, "keine-projektseite");
});

// Befund #5 (Opus-Review B2): kritisch gilt fail-safe wie in B1 (seitenfelder.mjs) — jeder Wert außer false ist kritisch.
const KRITISCH_WERTE = [["true", true], ["ja", true], ["\"true\"", true], ["True", true], ["yes", true], ["1", true], ["[kaputt", true], ["\"\"", true], ["", true], ["false", false]];
test("seitenKarten: kritisch fail-safe — ja, \"true\", True, kaputter Wert gelten als kritisch; nur false und fehlend nicht", () => {
  const seite = (name, wert) => [`09_wiki/wissen/thema_${name}.md`, `---\ntyp: thema\nname: ${name}\ndescription: Karte ${name}\n${wert === undefined ? "" : `kritisch: ${wert}\n`}rev: 1\n---\n# ${name}\n`];
  const seiten = Object.fromEntries([...KRITISCH_WERTE.map(([w], i) => seite(`k${i}`, w)), seite("ohne", undefined)]);
  const v = neuerTestVault({ seiten });
  const karten = E.seitenKarten(v);
  for (const [i, [w, krit]] of KRITISCH_WERTE.entries()) assert.equal(karten.find((k) => k.seite.endsWith(`thema_k${i}.md`)).kritisch, krit, `kritisch: ${w}`);
  assert.equal(karten.find((k) => k.seite.endsWith("thema_ohne.md")).kritisch, false, "ohne das Feld nicht kritisch");
});

// ---- Befund #4 (Opus-Review B2) und Mindestgüte der Kandidaten ------------------------------------------------------------------
// Gartenteich-Seiten verschieden stark: die Beschreibung bestimmt die Güte (Treffer-Wörter der Frage, Länge dämpft).
const FRAGE = "Die Pumpe im Gartenteich braucht einen neuen Filter.";
const teichSeite = (name, description, kritisch = false) => [`09_wiki/wissen/thema_${name}.md`, { fm: { name, description, ...(kritisch ? { kritisch: true } : {}) }, rumpf: `# ${name}\n` }];
const teichVault = (defs) => neuerTestVault({ seiten: Object.fromEntries([...defs.map((d) => teichSeite(...d)),
  ...Array.from({ length: 8 }, (_, i) => teichSeite(`fuell-${i}`, `Füllseite ${i} über Wetter Kalender Notizen ${i}`))]) });
const ordne = (v, opt = {}) => E.einordnen(v, vo("y", { titel: "Neu", text: FRAGE }), { karten: E.seitenKarten(v), aliasse: [], minGuete: 1, ...opt });
const NUR_NAMEN = (o) => o.kandidaten.map((k) => k.seite.replace(/^.*thema_|\.md$/g, ""));

// Fünf Seiten mit streng fallender Güte: je Rang ein Füllwort mehr in der description (Länge dämpft), alle nah genug beieinander für die Mindestgüte 0,8.
const EXTRA = ["", " Zubehör", " Zubehör Winter", " Zubehör Winter Sommer", " Zubehör Winter Sommer Herbst"];
const rang = (r, kritisch = false) => [kritisch ? "teich-k" : `teich-${"abcde"[r - 1]}`, `Gartenteich Pumpe Filter${EXTRA[r - 1]}`, kritisch];

test("einordnen (#4): kritische Seite unter den Top 5 eines mehrdeutigen Treffers → keine Wahl — auf Platz 1 bis 5, je mit vier nicht kritischen", () => {
  assert.equal(E.MAX_KANDIDATEN, 5, "bis zu fünf Kandidaten (früher drei)");
  for (const platz of [1, 2, 3, 4, 5]) {
    const name = `Platz ${platz}`;
    const defs = [1, 2, 3, 4, 5].map((r) => rang(r, r === platz));
    const v = teichVault(defs);
    const reihenfolge = E.bm25(E.seitenKarten(v), `Neu ${FRAGE}`).slice(0, 5).map((t) => t.seite.replace(/^.*thema_|\.md$/g, ""));
    assert.equal(reihenfolge[platz - 1], "teich-k", `${name}: Vorbedingung — die kritische Seite steht wirklich auf diesem Platz (${reihenfolge})`);
    const o = ordne(v);
    assert.equal(o.grund, "mehrdeutig", name);
    assert.equal(o.seite, null, name);
    assert.deepEqual(o.kandidaten, [], `${name}: keine Wahl anbieten, auch nicht unter den nicht kritischen`);
    assert.equal(o.detail, "kritisch-unter-kandidaten", `${name}: im Protokoll erkennbar`);
    // Gegenprobe: dieselben Seiten ohne kritisch → alle fünf bleiben Kandidaten, ohne detail.
    const g = ordne(teichVault(defs.map(([n, d]) => [n, d, false])));
    assert.equal(g.grund, "mehrdeutig", `${name} ohne kritisch`);
    assert.equal(g.kandidaten.length, 5, `${name} ohne kritisch: alle fünf sind Kandidaten`);
    assert.equal(g.detail, undefined, `${name} ohne kritisch`);
  }
});

test("einordnen: die Suchanfrage besteht aus Titel UND Text — Wörter nur im Text finden die Seite, ein Titel allein ohne Treffer-Wörter nicht", () => {
  const v = teichVault([["teich-a", "Gartenteich Pumpe Filter Skimmer Schlamm"], ["teich-b", "Wetter Kalender"]]);
  const k = E.seitenKarten(v);
  const nurText = E.einordnen(v, vo("t1", { titel: "Neu", text: FRAGE }), { karten: k, aliasse: [], minGuete: 1 });
  assert.equal(nurText.seite, "09_wiki/wissen/thema_teich-a.md", "Titel „Neu“ trifft nichts, der Text trägt die Suche");
  const nurTitel = E.einordnen(v, vo("t2", { titel: "Neu", text: "Nichts Passendes hier." }), { karten: k, aliasse: [], minGuete: 1 });
  assert.equal(nurTitel.seite, null);
  assert.equal(nurTitel.grund, "keine-seite");
});

test("einordnen (#4): eine kritische Seite außerhalb der Top 5 (Platz 6) ändert nichts; ein eindeutiger Treffer behält kritisch in der Karte", () => {
  const v = teichVault([["teich-a", "Gartenteich Pumpe Filter"], ["teich-b", "Gartenteich Pumpe Filter"], ["teich-c", "Gartenteich Pumpe Filter"], ["teich-d", "Gartenteich Pumpe Filter"],
    ["teich-e", "Gartenteich Pumpe Filter"], ["teich-k", "Gartenteich Pumpe Filter Zubehör Winter Sommer Herbst Frühling Schnee Regen", true]]);
  const o = ordne(v);
  assert.equal(o.grund, "mehrdeutig");
  assert.deepEqual(NUR_NAMEN(o).sort(), ["teich-a", "teich-b", "teich-c", "teich-d", "teich-e"], "fünf Kandidaten, die kritische Seite auf Platz 6 zählt nicht");
  assert.equal(o.detail, undefined);
  const e = teichVault([["teich-k", "Gartenteich Pumpe Filter Gartenteich Pumpe Filter", true], ["teich-b", "Gartenteich"]]);
  const eind = ordne(e);
  assert.deepEqual([eind.wie, eind.kritisch], ["suche", true], "eindeutig und kritisch: weiter wie bisher (Rückfrage über stufe)");
});

test("einordnen (5 Kandidaten): mehr als fünf gleich starke Treffer ergeben genau fünf; die Mindestgüte schneidet schwächere auch in Platz 4 und 5 weg", () => {
  const gleich = ["a", "b", "c", "d", "e", "f", "g"].map((n) => [`teich-${n}`, "Gartenteich Pumpe Filter"]);
  const o = ordne(teichVault(gleich));
  assert.equal(o.grund, "mehrdeutig");
  assert.equal(o.kandidaten.length, 5, "sieben gleich starke → die ersten fünf");
  const gemischt = teichVault([["teich-a", "Gartenteich Pumpe Filter"], ["teich-b", "Gartenteich Pumpe Filter"], ["teich-c", "Gartenteich Pumpe Filter"],
    ["teich-d", "Gartenteich Zubehör Winter Sommer Herbst"], ["teich-e", "Gartenteich Zubehör Winter Sommer Herbst Frühling"]]);
  const alle = E.bm25(E.seitenKarten(gemischt), `Neu ${FRAGE}`).slice(0, 5);
  assert.ok(alle[3].guete < 0.8 * alle[0].guete && alle[4].guete < 0.8 * alle[0].guete, "Vorbedingung: Platz 4 und 5 sind deutlich schwächer");
  assert.deepEqual(NUR_NAMEN(ordne(gemischt)).sort(), ["teich-a", "teich-b", "teich-c"], "Mindestgüte gilt weiter");
});

test("einordnen (Mindestgüte): nur Kandidaten mit guete ≥ 0,8 × guete(Platz 1); ein schwacher dritter Treffer fällt weg", () => {
  assert.equal(E.MIN_KANDIDAT_ANTEIL, 0.8);
  const v = teichVault([["teich-a", "Gartenteich Pumpe Filter"], ["teich-b", "Gartenteich Pumpe Filter"], ["teich-c", "Gartenteich Zubehör Winter"]]);
  const o = ordne(v);
  assert.equal(o.grund, "mehrdeutig");
  const alle = E.bm25(E.seitenKarten(v), `Neu ${FRAGE}`).slice(0, 3);
  assert.ok(alle[2].guete < 0.8 * alle[0].guete, "Vorbedingung: der dritte Treffer ist deutlich schwächer");
  assert.deepEqual(NUR_NAMEN(o).sort(), ["teich-a", "teich-b"]);
  assert.ok(o.kandidaten.every((k) => k.guete >= 0.8 * alle[0].guete));
  // Genau an der Grenze zählt noch: Anteil 1 behält nur Seiten mit der Güte von Platz 1 (hier die beiden gleich starken).
  assert.deepEqual(NUR_NAMEN(ordne(v, { minKandidatAnteil: 1 })).sort(), ["teich-a", "teich-b"]);
});

test("einordnen (Mindestgüte): bleiben weniger als 2 Kandidaten übrig, gibt es keine Wahl (kandidaten hat < 2 Einträge, der Tageslauf ruft die KI dann nicht)", () => {
  const v = teichVault([["teich-a", "Gartenteich Pumpe Filter"], ["teich-b", "Gartenteich Pumpe Filter Zubehör"]]);
  const o = ordne(v);
  assert.equal(o.grund, "mehrdeutig");
  assert.equal(o.kandidaten.length, 2, "mit der Standard-Grenze sind beide dabei");
  const streng = ordne(v, { minKandidatAnteil: 0.999 });
  assert.equal(streng.grund, "mehrdeutig");
  assert.equal(streng.seite, null);
  assert.ok(streng.kandidaten.length < 2, `weniger als 2: ${streng.kandidaten.length}`);
});
