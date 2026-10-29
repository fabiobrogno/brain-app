// K15 Alltags-Wirkung: Zählen gegen feste Musterlisten (v1 = Auswertung 16.10.2026), Rauschband, Speichern NUR von
// Zahlen. Kernrisiken: Text landet im Log, Subagenten/Systemzeilen werden mitgezählt, Zeitlimit wird ignoriert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, utimesSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  MUSTER_VERSION, GRUPPEN, RAUSCHBAND, transkripte, transkriptWurzeln, messeWirkung, vergleiche, textWirkung,
  kurzWirkung, speichereMessung, leseMessungen, wirkungFaellig, WIRKUNG_LOG,
} from "../wirkung.mjs";
import {
  tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, aufruf, ergebnis, hinweis, kompakt, befehl, KIT,
} from "./verlauf-fixture.mjs";

function testWurzel() {
  const w = tempOrdner("projects mit Ümlaut");
  const p = join(w, "-Users-jo-Garten App");
  schreibeVerlauf(join(p, "a.jsonl"), [
    nutzer("Wo waren wir gestern stehen geblieben?"),
    assistent("Beim Beet."),
    aufruf("t1", "Bash", { command: "cat gross.log" }),
    ergebnis("t1", "x".repeat(6000)),
    hinweis("Kortex-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ~/brain/09_wiki/x.md — x"),
    nutzer("nein, das stimmt nicht"),
    befehl("/compact"),
    kompakt("manual"),
    nutzer("This session is being continued from a previous conversation", { isCompactSummary: true }),
    aufruf("t2", "Read", { file_path: "/x/y.md" }),
    ergebnis("t2", "kurz"),
  ]);
  schreibeVerlauf(join(p, "b.jsonl"), [
    nutzer("mach nochmal die Tests"),
    nutzer("<system-reminder>nur System</system-reminder>"),
    nutzer("Subagent-Frage", { isSidechain: true }),
    "{kaputt",
  ], { halbeZeile: true });
  schreibeVerlauf(join(p, "alt.jsonl"), [nutzer("nein, uralt")]);
  const alt = (Date.now() - 40 * 86400000) / 1000;
  utimesSync(join(p, "alt.jsonl"), alt, alt);
  schreibeVerlauf(join(p, "a", "subagents", "agent-1.jsonl"), [nutzer("nein, Subagent")]);
  return w;
}

test("transkripte: nur <wurzel>/<projekt>/*.jsonl im Zeitfenster, keine Subagenten-Verläufe", () => {
  const namen = transkripte([testWurzel()], { tage: 30 }).map((x) => x.split(/[\\/]/).pop()).sort();
  assert.deepEqual(namen, ["a.jsonl", "b.jsonl"]);
});

test("transkriptWurzeln: findet <home>/.claude*/projects, ignoriert Dateien wie .claude.json", () => {
  const home = tempOrdner("home");
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  mkdirSync(join(home, ".claude-zwei", "projects"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), "{}");
  assert.deepEqual(transkriptWurzeln({ home }).map((p) => p.slice(home.length).split("\\").join("/")),
    ["/.claude/projects", "/.claude-zwei/projects"]);
});

test("messeWirkung: zählt Nachrichten, Gruppen, Rückbezüge, Kompaktierungen, Hinweise und große Ausgaben", async () => {
  const m = await messeWirkung({ wurzeln: [testWurzel()], tage: 30, kitVersion: "0.6.0" });
  assert.equal(m.muster, MUSTER_VERSION);
  assert.equal(m.dateien, 2);
  assert.equal(m.sitzungen, 2);
  assert.equal(m.nachrichten, 3, "System-, Subagenten- und Kompaktierungszeilen zählen nicht");
  assert.equal(m.befehle, 1);
  assert.deepEqual(m.gruppen.falsch, { n: 1, s: 1 });
  assert.deepEqual(m.gruppen.kontext, { n: 1, s: 1 });
  assert.deepEqual(m.gruppen.wiederholt, { n: 1, s: 1 });
  assert.deepEqual(m.gruppen.regelbruch, { n: 0, s: 0 });
  assert.deepEqual(m.rueckbezug, { n: 1, s: 1, start: 1 });
  assert.deepEqual(m.kompakt, { auto: 0, manuell: 1 });
  assert.deepEqual(m.hinweise, { n: 1, s: 1, korrektur: 1 });
  assert.equal(m.ausgaben.gross, 1);
  assert.equal(m.ausgaben.jeWerkzeug.bash, 6000);
  assert.equal(m.ausgaben.jeWerkzeug.read, 0);
  assert.ok(m.ausgaben.anteil > 0.9 && m.ausgaben.anteil < 1, String(m.ausgaben.anteil));
  assert.equal(m.unvollstaendig, false);
  assert.equal(m.kit, "0.6.0");
});

test("messeWirkung: Zeitlimit 0 → unvollständig, nichts gezählt", async () => {
  const m = await messeWirkung({ wurzeln: [testWurzel()], zeitlimitMs: 0 });
  assert.equal(m.unvollstaendig, true);
  assert.equal(m.dateien, 0);
});

test("vergleiche: Rauschband — zu wenig Nachrichten, andere Musterliste, Rauschen, echte Änderung", () => {
  const mess = (n, falsch, muster = MUSTER_VERSION) => ({
    muster, nachrichten: n,
    gruppen: Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, { n: k === "falsch" ? falsch : 0, s: 0 }])),
  });
  assert.equal(vergleiche(null, mess(1000, 10)).falsch, "nichtVergleichbar");
  assert.equal(vergleiche(mess(400, 40), mess(1000, 10)).falsch, "nichtVergleichbar");
  assert.equal(vergleiche(mess(1000, 40, "v0"), mess(1000, 10)).falsch, "nichtVergleichbar");
  assert.equal(vergleiche(mess(1000, 40), mess(1000, 35)).falsch, "rauschen");   // 4,0 → 3,5: < 1,0 je 100
  assert.equal(vergleiche(mess(1000, 100), mess(1000, 88)).falsch, "rauschen"); // 10 → 8,8: ≥ 1,0, aber < 25 %
  assert.equal(vergleiche(mess(1000, 40), mess(1000, 20)).falsch, "gesunken");
  assert.equal(vergleiche(mess(1000, 20), mess(1000, 40)).falsch, "gestiegen");
  assert.equal(RAUSCHBAND.minNachrichten, 500);
});

test("speichereMessung: speichert nur Zahlen und feste Kennungen, nie Nachrichtentext", async () => {
  const v = tempVault();
  speichereMessung(v, await messeWirkung({ wurzeln: [testWurzel()], kitVersion: "0.6.0" }));
  const roh = readFileSync(WIRKUNG_LOG(v), "utf8");
  for (const wort of ["stimmt", "nochmal", "gestern", "Beet", "xxxx", "Garten"]) assert.ok(!roh.includes(wort), wort);
  const gespeichert = leseMessungen(v);
  assert.equal(gespeichert.length, 1);
  const TEXT_ERLAUBT = new Set(["zeit", "muster", "kit", "von", "bis"]);
  const pruefe = (o, pfad = "") => {
    for (const [k, w] of Object.entries(o)) {
      if (w && typeof w === "object") pruefe(w, `${pfad}${k}.`);
      else if (typeof w === "string") assert.ok(TEXT_ERLAUBT.has(k), `Text in ${pfad}${k}`);
      else assert.ok(typeof w === "number" || typeof w === "boolean", `${pfad}${k}`);
    }
  };
  pruefe(gespeichert[0]);
});

test("wirkungFaellig: ohne Messung ja, frisch nein, nach 30 Tagen ja, laufender Lauf (Marke < 1 h) nein", () => {
  const v = tempVault();
  assert.equal(wirkungFaellig(v), true);
  speichereMessung(v, { zeit: "2026-10-16T10:00:00", muster: MUSTER_VERSION, nachrichten: 0 });
  const t = Date.parse("2026-10-16T10:00:00Z");
  assert.equal(wirkungFaellig(v, t + 86400000), false);
  assert.equal(wirkungFaellig(v, t + 31 * 86400000), true);
  writeFileSync(join(v, ".logs", "wirkung.laeuft"), "");
  assert.equal(wirkungFaellig(v, Date.now()), false);
});

test("textWirkung/kurzWirkung: Kennzahlen, Musterliste und Rauschband stehen im Text", async () => {
  const m = await messeWirkung({ wurzeln: [testWurzel()] });
  const t = textWirkung(m);
  assert.match(t, /Musterliste v1/);
  assert.match(t, /Kompaktierungen: 1 \(0 automatisch, 1 manuell\)/);
  assert.match(t, /falsch\/stimmt nicht: 33,3 · 1 · 1/);
  assert.match(t, /Rauschband/);
  assert.match(kurzWirkung(m), /^Alltags-Wirkung \(.*\): je 100 Nachrichten Gedächtnis 33,3/);
});

test("CLI brain wirkung: --wurzel, --json, --speichern (Vault mit Leerzeichen/Umlaut); falsche Option → Exit 64", () => {
  const v = tempVault("Mein Brän"), w = testWurzel();
  const lauf = (...a) => spawnSync(process.execPath, [join(KIT, "brain.mjs"), "wirkung", ...a],
    { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  const r = lauf(`--wurzel=${w}`, "--json", "--speichern");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).nachrichten, 3);
  assert.equal(leseMessungen(v).length, 1);
  const t = lauf(`--wurzel=${w}`);
  assert.equal(t.status, 0);
  assert.match(t.stdout, /^Alltags-Wirkung/);
  assert.equal(lauf("--tage=0").status, 64);
});

test("Pflegebericht: zeigt die letzte Messung als eine Zeile; ohne Messung kein Feld-Inhalt", async () => {
  const v = tempOrdner("Brain Kopie");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  const { pflegebericht, textBericht } = await import("../pflege.mjs");
  assert.equal(pflegebericht(v).wirkung, null);
  speichereMessung(v, await messeWirkung({ wurzeln: [testWurzel()] }));
  const b = pflegebericht(v);
  assert.equal(b.wirkung.jetzt.nachrichten, 3);
  assert.equal(b.wirkung.vorher, null);
  assert.ok(Array.isArray(b.posten), "Posten unverändert");
  assert.match(textBericht(b), /\nAlltags-Wirkung \(/);
});
