// K12 Arbeitsstand: wörtliche Auszüge aus DIESER Sitzung, inkrementell ab der letzten Kompaktierung, mit Budget.
// Kernrisiken: Zugangsdaten landen in .logs, Budget wird gesprengt, unbekannte Zeilen bringen alles zum Absturz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { appendFileSync, existsSync, utimesSync, readFileSync } from "node:fs";
import {
  sammle, render, schreibe, lies, leseZustand, kuerzeAnZeile, raeumeAuf, saubereSid, MAX_EINSPIELEN, GEHEIM,
} from "../arbeitsstand.mjs";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, aufruf, ergebnis } from "./verlauf-fixture.mjs";

const KOEDER = ["pass", "wort"].join("") + "=geheim12345";
const TOKEN_KOEDER = ["to", "ken"].join("") + "=zugriff98765";

function verlauf() {
  const f = join(tempOrdner("Verlauf Ä"), "s1.jsonl");
  schreibeVerlauf(f, [
    nutzer("Ziel: Baue den Export für die Garten-App"),
    assistent("Mache ich."),
    aufruf("t1", "TodoWrite", { todos: [
      { content: "Export bauen", status: "in_progress" }, { content: "Tests", status: "pending" },
      { content: "Plan lesen", status: "completed" }] }),
    aufruf("t2", "Edit", { file_path: "/Users/USER/Mein Projekt/ä.mjs", old_string: "a", new_string: "b" }),
    aufruf("t3", "Bash", { command: "git commit -m x" }),
    ergebnis("t3", "[kit-v0.6 abc1234] kit: Export gebaut\n 1 file changed"),
    aufruf("t4", "Bash", { command: "echo" }),
    ergebnis("t4", "[main deadbeef] gescheitert", { fehler: true }),
    nutzer("Wichtig: nie direkt auf main pushen"),
    nutzer(`hier der Zugang: ${KOEDER}`),
    { type: "zukunft-neu", irgendwas: 1 },
    "{kaputt",
  ], { halbeZeile: true });
  return f;
}

test("sammle: Ziel, Nachrichten, Commits, Dateien, offene Aufgaben — unbekannte/kaputte/halbe Zeilen still übersprungen", () => {
  const z = sammle(verlauf());
  assert.equal(z.ziel, "Ziel: Baue den Export für die Garten-App");
  assert.deepEqual(z.nachrichten.map((n) => n.text),
    ["Ziel: Baue den Export für die Garten-App", "Wichtig: nie direkt auf main pushen", GEHEIM]);
  assert.deepEqual(z.commits, [{ sha: "abc1234", zweig: "kit-v0.6", text: "kit: Export gebaut" }], "Fehler-Ergebnisse zählen nicht");
  assert.deepEqual(z.dateien, ["/Users/USER/Mein Projekt/ä.mjs"]);
  assert.deepEqual(z.aufgaben.liste.map((a) => a.text), ["Export bauen", "Tests"]);
  assert.equal(z.luecke, false);
});

test("sammle/render: Zugangsdaten erscheinen nirgends — weder im Zustand noch im Text", () => {
  const z = sammle(verlauf());
  const t = render(z);
  assert.ok(!JSON.stringify(z).includes("geheim12345"));
  assert.ok(!t.includes("geheim12345"));
  assert.ok(t.includes(GEHEIM));
});

test("sammle: inkrementell ab der Marke — nur neue Nachrichten; Commits, Dateien und Aufgaben bleiben", () => {
  const f = verlauf();
  const z1 = sammle(f);
  appendFileSync(f, '"}}\n'
    + JSON.stringify(nutzer("Nach der ersten Kompaktierung: weiter mit Tests")) + "\n"
    + JSON.stringify(aufruf("t9", "Write", { file_path: "/tmp/neu.md", content: "x" })) + "\n"
    + JSON.stringify(aufruf("t10", "Bash", { command: "git commit" })) + "\n"
    + JSON.stringify(ergebnis("t10", "[kit-v0.6 1234567] kit: Tests")) + "\n");
  const z2 = sammle(f, { vorher: z1 });
  assert.equal(z2.ziel, z1.ziel);
  assert.deepEqual(z2.nachrichten.map((n) => n.text), ["halb", "Nach der ersten Kompaktierung: weiter mit Tests"],
    "die vorher halbe Zeile zählt jetzt — vollständig, einmal");
  assert.deepEqual(z2.commits.map((c) => c.sha), ["abc1234", "1234567"]);
  assert.deepEqual(z2.dateien, ["/Users/USER/Mein Projekt/ä.mjs", "/tmp/neu.md"]);
  assert.deepEqual(z2.aufgaben.liste.map((a) => a.text), ["Export bauen", "Tests"]);
});

test("sammle: TaskCreate/TaskUpdate — erledigte Aufgaben fallen weg", () => {
  const f = join(tempOrdner(), "tasks.jsonl");
  schreibeVerlauf(f, [
    nutzer("Los"),
    aufruf("c1", "TaskCreate", { subject: "Schema anpassen", description: "…" }), ergebnis("c1", "Task #1 created successfully: Schema anpassen"),
    aufruf("c2", "TaskCreate", { subject: "Doku" }), ergebnis("c2", "Task #2 created successfully: Doku"),
    aufruf("u1", "TaskUpdate", { taskId: "1", status: "completed" }), ergebnis("u1", "Updated task #1"),
    aufruf("u2", "TaskUpdate", { taskId: "2", status: "in_progress" }), ergebnis("u2", "Updated task #2"),
  ]);
  const z = sammle(f);
  assert.deepEqual(z.tasks, { 2: { text: "Doku", status: "in_progress" } });
  assert.match(render(z), /\[in_progress\] #2 Doku/);
});

test("sammle: zu großer neuer Teil → nur das Ende, Ziel trotzdem aus dem Kopf, Lücke wird gemeldet", () => {
  const f = join(tempOrdner(), "gross.jsonl");
  schreibeVerlauf(f, [nutzer("Ziel: großes Projekt"), ...Array.from({ length: 300 }, (_, i) => nutzer(`Schritt ${i} ` + "y".repeat(500)))]);
  const z = sammle(f, { maxBytes: 32 * 1024 });
  assert.equal(z.ziel, "Ziel: großes Projekt");
  assert.equal(z.luecke, true);
  assert.match(render(z), /nicht ausgewertet/);
});

test("render: Budget — neueste drei Nachrichten ganz, ältere gekürzt, Rest mit Hinweis; gesamt ≤ 8.000", () => {
  const z = {
    version: 1, bis: 0, ziel: "Ziel", stand: new Date().toISOString(), luecke: false, commits: [], dateien: [], aufgaben: null, tasks: {},
    nachrichten: Array.from({ length: 50 }, (_, i) => ({ zeit: Date.now(), text: `Nachricht ${i} ` + "z".repeat(900) })),
  };
  const t = render(z);
  assert.ok(t.length <= MAX_EINSPIELEN, String(t.length));
  assert.ok(t.includes(`Nachricht 49 ${"z".repeat(900)}`), "neueste ganz");
  assert.ok(t.includes(`Nachricht 47 ${"z".repeat(900)}`), "drittneueste ganz");
  assert.match(t, /Nachricht 46 z+ \(gekürzt\)/);
  assert.match(t, /\(\d+ ältere Nachricht\(en\) ausgelassen — Platzgrenze\)/);
  assert.match(t, /^Kortex-Arbeitsstand vor der Kompaktierung/);
});

test("schreibe/lies: je session_id eigene Datei; fremde session_id bekommt nichts; ohne session_id nichts", () => {
  const v = tempVault("Mein Brän");
  schreibe(v, "sitzung-a", sammle(verlauf()));
  assert.match(lies(v, "sitzung-a").text, /Baue den Export/);
  assert.equal(lies(v, "sitzung-b"), null);
  assert.equal(leseZustand(v, "sitzung-a").version, 1);
  assert.ok(existsSync(join(v, ".logs", "sitzungen", "sitzung-a.json")));
  assert.equal(schreibe(v, "", sammle(verlauf())), null);
  assert.equal(saubereSid("a/../b c"), "abc");
});

test("kuerzeAnZeile und raeumeAuf (> 14 Tage alt)", () => {
  assert.equal(kuerzeAnZeile("kurz", 100), "kurz");
  const t = kuerzeAnZeile(Array.from({ length: 100 }, (_, i) => `Zeile ${i}`).join("\n"), 200);
  assert.ok(t.length <= 200 && t.endsWith("(… gekürzt)"), t);
  const v = tempVault();
  schreibe(v, "alt", sammle(verlauf()));
  const alt = (Date.now() - 20 * 86400000) / 1000;
  for (const e of ["json", "md"]) utimesSync(join(v, ".logs", "sitzungen", `alt.${e}`), alt, alt);
  schreibe(v, "neu", sammle(verlauf()));
  raeumeAuf(v);
  assert.equal(lies(v, "alt"), null);
  assert.ok(lies(v, "neu"));
});

test("sammle: Secret-Köder in TodoWrite- und TaskCreate-Text landen weder im Zustand noch in .json/.md", () => {
  const f = join(tempOrdner(), "geheim.jsonl");
  schreibeVerlauf(f, [
    nutzer("Los"),
    aufruf("a1", "TodoWrite", { todos: [{ content: `Login mit ${KOEDER} testen`, status: "pending" }] }),
    aufruf("c1", "TaskCreate", { subject: `API ${TOKEN_KOEDER} setzen` }), ergebnis("c1", "Task #1 created successfully: x"),
  ]);
  const z = sammle(f);
  assert.ok(!JSON.stringify(z).includes("geheim12345") && !JSON.stringify(z).includes("zugriff98765"));
  const v = tempVault();
  const md = schreibe(v, "geh", z);
  for (const datei of [md, join(v, ".logs", "sitzungen", "geh.json")]) {
    const inhalt = readFileSync(datei, "utf8");
    assert.ok(!inhalt.includes("geheim12345") && !inhalt.includes("zugriff98765"), datei);
  }
});

test("render (I1): vier Nachrichten à 1.480 Zeichen plus volle Abschnitte — neueste drei ganz, älteste gekürzt, gesamt ≤ 8.000", () => {
  const lang = (n) => `N${n} ` + "q".repeat(1476);
  const z = {
    version: 1, bis: 0, ziel: "Ziel " + "g".repeat(500), stand: new Date().toISOString(), luecke: false, tasks: {},
    nachrichten: [1, 2, 3, 4].map((n) => ({ zeit: Date.now(), text: lang(n) })),
    aufgaben: { quelle: "TodoWrite", liste: Array.from({ length: 12 }, (_, i) => ({ text: `Aufgabe ${i} ` + "a".repeat(100), status: "pending" })) },
    commits: Array.from({ length: 15 }, (_, i) => ({ sha: "abc123" + i, zweig: "x", text: `Commit ${i} ` + "c".repeat(60) })),
    dateien: Array.from({ length: 30 }, (_, i) => `/Users/USER/projekt/datei-${i}-${"d".repeat(30)}.mjs`),
  };
  const t = render(z);
  assert.ok(t.length <= MAX_EINSPIELEN, String(t.length));
  for (const n of [2, 3, 4]) assert.ok(t.includes(lang(n)), `N${n} ganz`);
  assert.match(t, /N1 q+ \(gekürzt\)/);
  assert.doesNotMatch(t, /ältere Nachricht\(en\) ausgelassen/);
});

test("sammle (M2): Nachrichten vor einer Kompaktierungs-Grenze zählen nicht (auch ohne Marke)", async () => {
  const { kompakt } = await import("./verlauf-fixture.mjs");
  const f = join(tempOrdner(), "k.jsonl");
  schreibeVerlauf(f, [nutzer("Ziel"), nutzer("vor der Grenze"), kompakt(), nutzer("nach der Grenze")]);
  const z = sammle(f);
  assert.deepEqual(z.nachrichten.map((n) => n.text), ["nach der Grenze"]);
});
