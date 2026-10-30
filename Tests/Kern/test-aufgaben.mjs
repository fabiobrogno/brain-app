// Aufgaben (aufgaben.mjs): Dateiformat, Ordnerregel, Rang-Logik, Dateien lesen/schreiben, Kommandozeile `brain aufgabe …`, Status-Zähler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as A from "../aufgaben.mjs";
import { ordner } from "../pfade.mjs";
import { brainStatus, statusText } from "../status.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const KERN = join(HIER, "..");
const vault = (cfg = {}) => { const v = mkdtempSync(join(tmpdir(), "aufgaben ")); writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg)); return v; };
const T0 = new Date("2026-10-30T10:00:00Z");

// ---------- Ordnerregel ----------
test("Ordner: aufgaben ist ein konfigurierbarer einfacher Name (Standard 05_aufgaben); Pfade und Absolutes fallen auf den Standard zurück", () => {
  assert.equal(ordner(vault()).aufgaben, "05_aufgaben");
  assert.equal(ordner(vault({ ordner: { aufgaben: "todo" } })).aufgaben, "todo");
  for (const schlecht of ["../aussen", "/etc", "a/b", "..", ".", "", 5, null]) assert.equal(ordner(vault({ ordner: { aufgaben: schlecht } })).aufgaben, "05_aufgaben", String(schlecht));
  assert.equal(A.ordnerName(vault({ ordner: { aufgaben: "todo" } })), "todo");
});

// ---------- Format ----------
test("Neue Aufgabe: Kopf in fester Reihenfolge, Text darunter, parst zurück", () => {
  const text = A.baueText(A.pruefeEingabe({ titel: "Lieferanten anrufen", text: "Wegen der Mühle.", prioritaet: "hoch", faellig: "2026-11-03", quelle: "ki:claude-code", bezug: ["09_wiki/x/thema_kaffee", "[[Mühle]]"], rang: 2500 }), T0);
  assert.equal(text, [
    "---", "typ: aufgabe", "titel: Lieferanten anrufen", "status: offen", "prioritaet: hoch", "faellig: 2026-11-03", "rang: 2500",
    "erstellt: 2026-10-30T10:00:00Z", "geaendert: 2026-10-30T10:00:00Z", "quelle: ki:claude-code", 'bezug: ["[[09_wiki/x/thema_kaffee]]", "[[Mühle]]"]', "---", "", "Wegen der Mühle.", ""].join("\n"));
  const a = A.parseAufgabe(text, "05_aufgaben/2026-10-30-x.md");
  assert.deepEqual(a, { pfad: "05_aufgaben/2026-10-30-x.md", titel: "Lieferanten anrufen", status: "offen", prioritaet: "hoch", faellig: "2026-11-03", rang: 2500,
    erstellt: "2026-10-30T10:00:00Z", geaendert: "2026-10-30T10:00:00Z", quelle: "ki:claude-code", bezug: ["09_wiki/x/thema_kaffee", "Mühle"], text: "Wegen der Mühle." });
});
test("Titel mit Sonderzeichen wird in Anführungszeichen geschrieben und kommt unverändert zurück", () => {
  for (const titel of ["Mail an Frau Müller: Termin #2", 'Er sagte "ja"', "- Liste", "[Klammer] x", "mit \\ Backslash", "  Rand  ", "a, b"]) {
    const text = A.baueText(A.pruefeEingabe({ titel }), T0);
    assert.equal(A.parseAufgabe(text, "x.md").titel, titel.trim().replace(/\s+/g, " "), titel);
  }
  assert.match(A.baueText(A.pruefeEingabe({ titel: "Einfacher Titel" }), T0), /\ntitel: Einfacher Titel\n/);
});
test("Eingaben werden geprüft: Titel, Status, Priorität, Datum, Quelle, Rang", () => {
  const nein = (e, re) => assert.throws(() => A.pruefeEingabe(e), (x) => x instanceof A.AufgabeFehler && x.code === 400 && re.test(x.message));
  nein({ titel: "" }, /Titel/); nein({ titel: 5 }, /Text/); nein({ status: "fertig" }, /Status/); nein({ prioritaet: "sehr" }, /Priorität/);
  nein({ faellig: "2026-02-30" }, /Datum/); nein({ faellig: "morgen" }, /Datum/); nein({ quelle: "bot" }, /Quelle/); nein({ rang: "oben" }, /Rang/); nein({ rang: Infinity }, /Rang/);
  assert.equal(A.pruefeEingabe({ faellig: null }).faellig, null);
  assert.equal(A.pruefeEingabe({ quelle: "KI:Claude Code" }).quelle, "ki:claude-code");
  assert.equal(A.pruefeEingabe({ titel: "a\n\tb\u0000c" }).titel, "a b c");
  assert.equal(A.pruefeEingabe({ titel: "x".repeat(500) }).titel.length, 200);
  assert.deepEqual(A.pruefeEingabe({ bezug: ['a"b', "[[c|d]]", "a\"b", ""] }).bezug, ["ab", "cd"], "Bezüge bleiben als Wiki-Links lesbar: keine Anführungszeichen, Klammern, Striche");
});
test("Fremde oder unvollständige Dateien: Standardwerte, kein Absturz; Nicht-Aufgaben werden nicht erkannt", () => {
  assert.equal(A.parseAufgabe("# Nur Text\n", "x.md"), null);
  assert.equal(A.parseAufgabe("---\ntyp: thema\n---\n# X\n", "x.md"), null);
  assert.equal(A.parseAufgabe("---\ntyp: aufgabe\n", "x.md"), null);   // Kopf nicht geschlossen
  const a = A.parseAufgabe("---\r\ntyp: aufgabe\r\nstatus: In Arbeit\r\nprioritaet: Hoch\r\nfaellig: bald\r\n---\r\n# Von Hand\r\n\r\nText\r\n", "05_aufgaben/2026-10-29-von-hand.md");
  assert.deepEqual([a.titel, a.status, a.prioritaet, a.faellig, a.rang, a.quelle], ["Von Hand", "in-arbeit", "hoch", null, null, "mensch"]);
  assert.equal(A.parseAufgabe("---\ntyp: aufgabe\n---\n", "05_aufgaben/2026-10-29-ohne-titel.md").titel, "ohne titel");
  assert.equal(A.parseAufgabe("---\ntyp: aufgabe\nstatus: kaputt\nquelle: robot\n---\n", "x.md").status, "offen");
  assert.equal(A.parseAufgabe("---\ntyp: aufgabe\nquelle: robot\n---\n", "x.md").quelle, "mensch");
  assert.equal(A.parseAufgabe("﻿---\ntyp: aufgabe\ntitel: Mit BOM\n---\n", "x.md").titel, "Mit BOM");
});
test("setzeFelder ändert nur die genannten Zeilen: Text, fremde Felder, Zeilenenden bleiben, geaendert wird neu gesetzt", () => {
  const alt = "---\ntyp: aufgabe\ntitel: Alt\nstatus: offen\nrang: 1000\nerstellt: 2026-10-01T00:00:00Z\ngeaendert: 2026-10-01T00:00:00Z\nfarbe: blau\nfaellig: 2026-11-01\n---\n\nText mit : Doppelpunkt\n";
  const neu = A.setzeFelder(alt, { status: "erledigt", faellig: null, rang: 1500.5 }, T0);
  assert.equal(neu, "---\ntyp: aufgabe\ntitel: Alt\nstatus: erledigt\nrang: 1500.5\nerstellt: 2026-10-01T00:00:00Z\ngeaendert: 2026-10-30T10:00:00Z\nfarbe: blau\n---\n\nText mit : Doppelpunkt\n");
  const crlf = A.setzeFelder(alt.replace(/\n/g, "\r\n"), { prioritaet: "hoch" }, T0);
  assert.ok(crlf.includes("prioritaet: hoch\r\n") && !/[^\r]\n/.test(crlf), "Zeilenenden bleiben CRLF");
  assert.equal(A.parseAufgabe(crlf, "x.md").prioritaet, "hoch");
  assert.throws(() => A.setzeFelder("kein Kopf", { status: "offen" }), (x) => x instanceof A.AufgabeFehler && x.code === 422);
});

// ---------- Rang: konfliktarm ----------
const kar = (pfad, rang, status = "offen", erstellt = "2026-10-01T00:00:00Z") => ({ pfad, rang, status, erstellt });
test("Sortierung: rang, dann erstellt, dann Pfad; ohne Rang ans Ende — auf jedem Gerät gleich", () => {
  const l = [kar("c", null), kar("b", 2), kar("a", 2, "offen", "2026-10-02T00:00:00Z"), kar("z", 1), kar("a2", 2)];
  assert.deepEqual(A.sortiere(l).map((x) => x.pfad), ["z", "a2", "b", "a", "c"]);
});
test("Rang: zwischen zwei Nachbarn genau EINE Datei bekommt einen neuen Rang (Mitte)", () => {
  const s = [kar("a", 1000), kar("b", 2000), kar("c", 3000)];
  assert.deepEqual(A.plane(s, "x", "a", "b"), { rang: 1500, umnummerieren: [] });
  assert.deepEqual(A.plane(s, "x", null, "a"), { rang: 0, umnummerieren: [] });        // ganz nach oben
  assert.deepEqual(A.plane(s, "x", "c", null), { rang: 4000, umnummerieren: [] });     // ganz nach unten
  assert.deepEqual(A.plane([], "x", null, null), { rang: 1000, umnummerieren: [] });
  // die bewegte Karte selbst zählt nicht als Nachbar
  assert.deepEqual(A.plane([kar("a", 1000), kar("b", 2000), kar("c", 3000)], "b", "c", null), { rang: 4000, umnummerieren: [] });
});
test("Rang: Gleichstand (zwei Geräte haben gleichzeitig angelegt) oder ohne Rang → Spalte wird neu durchnummeriert", () => {
  const gleich = [kar("a", 1000), kar("b", 1000), kar("c", 2000)];
  const p = A.plane(gleich, "x", "a", "b");
  assert.deepEqual(p, { rang: 2000, umnummerieren: [{ pfad: "b", rang: 3000 }, { pfad: "c", rang: 4000 }] });
  const ohne = A.plane([kar("a", 1000), kar("b", null)], "x", "a", "b");
  assert.equal(ohne.rang, 2000);
  assert.deepEqual(ohne.umnummerieren, [{ pfad: "b", rang: 3000 }]);
  const eng = A.plane([kar("a", 1), kar("b", 1.00005)], "x", "a", "b");
  assert.ok(eng.umnummerieren.length > 0, "Lücke unter 1e-4: neu nummerieren statt Gleitkomma-Brei");
});
test("Rang am Ende der Spalte; Zähler offen/überfällig", () => {
  assert.equal(A.rangAmEnde([kar("a", 1000), kar("b", 2500.5), kar("c", 9000, "erledigt")], "offen"), 3500);
  assert.equal(A.rangAmEnde([], "offen"), 1000);
  const z = A.zaehleAus([{ status: "offen", faellig: "2026-10-01" }, { status: "warten", faellig: "2026-12-01" }, { status: "erledigt", faellig: "2020-01-01" }, { status: "in-arbeit", faellig: null }], "2026-10-30");
  assert.deepEqual(z, { offen: 3, ueberfaellig: 1 });
});

// ---------- Dateien ----------
test("legeAn: Datei <datum>-<slug>.md im Aufgaben-Ordner, Rang am Ende, gleiche Titel bekommen -2, -3", () => {
  const v = vault();
  const r1 = A.legeAn(v, { titel: "Müller anrufen" }, { jetzt: T0 });
  const r2 = A.legeAn(v, { titel: "Müller anrufen" }, { jetzt: T0 });
  const r3 = A.legeAn(v, { titel: "Erledigt", status: "erledigt" }, { jetzt: T0 });
  assert.equal(r1.pfad, "05_aufgaben/2026-10-30-mueller-anrufen.md");
  assert.equal(r2.pfad, "05_aufgaben/2026-10-30-mueller-anrufen-2.md");
  assert.deepEqual([r1.aufgabe.rang, r2.aufgabe.rang, r3.aufgabe.rang], [1000, 2000, 1000]);   // je Spalte gezählt
  assert.equal(readdirSync(join(v, "05_aufgaben")).length, 3);
  assert.deepEqual(A.liste(v).map((a) => a.pfad), [r3.pfad, r1.pfad, r2.pfad]);   // nach rang: 1000, 1000 (erstellt gleich → Pfad), 2000
});
test("legeAn mit eigenem Ordnernamen; Aufgaben-Ordner als Verweis aus dem Vault hinaus wird abgelehnt", () => {
  const v = vault({ ordner: { aufgaben: "todo" } });
  assert.equal(A.legeAn(v, { titel: "X" }, { jetzt: T0 }).pfad, "todo/2026-10-30-x.md");
  const v2 = vault(), draussen = mkdtempSync(join(tmpdir(), "draussen "));
  symlinkSync(draussen, join(v2, "05_aufgaben"));
  assert.throws(() => A.legeAn(v2, { titel: "X" }), (x) => x instanceof A.AufgabeFehler && x.code === 403);
  assert.throws(() => A.liste(v2), (x) => x instanceof A.AufgabeFehler && x.code === 403);
  assert.equal(readdirSync(draussen).length, 0);
});
test("liste: überspringt Nicht-Aufgaben, Verweise, Unterordner, versteckte und _-Dateien", () => {
  const v = vault(); A.legeAn(v, { titel: "Echt" }, { jetzt: T0 });
  const o = join(v, "05_aufgaben");
  writeFileSync(join(o, "README.md"), "# Hinweis\n");
  writeFileSync(join(o, "_vorlage.md"), "---\ntyp: aufgabe\ntitel: Vorlage\n---\n");
  writeFileSync(join(o, ".versteckt.md"), "---\ntyp: aufgabe\ntitel: Versteckt\n---\n");
  mkdirSync(join(o, "unter")); writeFileSync(join(o, "unter", "x.md"), "---\ntyp: aufgabe\ntitel: Tief\n---\n");
  symlinkSync(join(v, "brain.config.json"), join(o, "link.md"));
  assert.deepEqual(A.liste(v).map((a) => a.titel), ["Echt"]);
  assert.deepEqual(A.liste(vault()), []);   // kein Ordner → leer
});
test("aendere: Status ohne Platz → ans Ende der neuen Spalte; nur diese Datei ändert sich; Text bleibt", () => {
  const v = vault();
  const a = A.legeAn(v, { titel: "A", text: "Details" }, { jetzt: T0 }), b = A.legeAn(v, { titel: "B" }, { jetzt: T0 }), c = A.legeAn(v, { titel: "C", status: "warten" }, { jetzt: T0 });
  const vorB = readFileSync(join(v, b.pfad), "utf8");
  const r = A.aendere(v, a.pfad, { status: "warten" }, { jetzt: new Date("2026-10-31T10:00:00Z") });
  assert.equal(r.aufgabe.status, "warten");
  assert.equal(r.aufgabe.rang, 2000);   // C hat 1000 in „warten“
  assert.equal(r.aufgabe.text, "Details");
  assert.equal(r.aufgabe.geaendert, "2026-10-31T10:00:00Z");
  assert.deepEqual(r.geaendert, [a.pfad]);
  assert.equal(readFileSync(join(v, b.pfad), "utf8"), vorB);
  assert.equal(A.liste(v).find((x) => x.pfad === c.pfad).rang, 1000);
});
test("aendere mit platz: Mitte der Nachbarn; bei Gleichstand werden die Nachbarn neu nummeriert (und gemeldet)", () => {
  const v = vault();
  const [a, b, c] = ["A", "B", "C"].map((t, i) => A.legeAn(v, { titel: t, rang: 1000 * (i + 1) }, { jetzt: T0 }).pfad);
  assert.equal(A.aendere(v, c, { status: "offen", platz: { davor: a, danach: b } }).aufgabe.rang, 1500);
  assert.deepEqual(A.liste(v).map((x) => x.titel), ["A", "C", "B"]);
  const w = vault();
  const [x1, x2, x3] = ["X1", "X2", "X3"].map((t) => A.legeAn(w, { titel: t, rang: 1000 }, { jetzt: T0 }).pfad);
  const r = A.aendere(w, x3, { status: "offen", platz: { davor: x1, danach: x2 } });
  assert.ok(r.geaendert.length > 1 && r.geaendert[0] === x3);
  const titel = A.liste(w).map((x) => x.titel);
  assert.deepEqual(titel.slice(0, 1), ["X1"]); assert.equal(titel[1], "X3"); assert.equal(titel[2], "X2");
});
test("aendere: Pfadschutz und Fehler — nur Dateien direkt im Aufgaben-Ordner, nur Aufgaben", () => {
  const v = vault(); const a = A.legeAn(v, { titel: "A" }, { jetzt: T0 });
  writeFileSync(join(v, "notiz.md"), "# N\n"); writeFileSync(join(v, "05_aufgaben", "text.md"), "# Kein Kopf\n");
  const fehler = (pfad, code, e = { status: "erledigt" }) => assert.throws(() => A.aendere(v, pfad, e), (x) => x instanceof A.AufgabeFehler && x.code === code, pfad);
  fehler("notiz.md", 400); fehler("../x/05_aufgaben/a.md", 400); fehler("05_aufgaben/../notiz.md", 400); fehler("/etc/passwd", 400); fehler("05_aufgaben/unter/x.md", 400);
  fehler("05_aufgaben/fehlt.md", 404); fehler("05_aufgaben/text.md", 422); fehler("05_aufgaben/_x.md", 400);
  fehler(a.pfad, 400, { status: "fertig" });
  assert.throws(() => A.aendere(v, a.pfad, { status: "erledigt" }, { basisText: "anderer Stand" }), (x) => x.code === 409);
});
test("findePfad: voller Pfad, Dateiname, Namensteil — mehrdeutig und unbekannt melden verständlich", () => {
  const v = vault(); const a = A.legeAn(v, { titel: "Lieferanten anrufen" }, { jetzt: T0 }), b = A.legeAn(v, { titel: "Lieferung prüfen" }, { jetzt: T0 });
  assert.equal(A.findePfad(v, a.pfad), a.pfad);
  assert.equal(A.findePfad(v, "2026-10-30-lieferanten-anrufen"), a.pfad);
  assert.equal(A.findePfad(v, "anrufen"), a.pfad);
  assert.throws(() => A.findePfad(v, "liefer"), (x) => x.code === 409 && /mehrere/.test(x.message));
  assert.throws(() => A.findePfad(v, "gibt-es-nicht"), (x) => x.code === 404);
  assert.throws(() => A.findePfad(v, "05_aufgaben/gibt-es-nicht.md"), (x) => x.code === 404);
  void b;
});

// ---------- Kommandozeile ----------
const brain = (v, ...args) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", v, ...args], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: "", BRAIN_QUELLE: "" } });
test("CLI: aufgabe neu / aufgaben / aufgabe erledigt / aufgabe status", () => {
  const v = vault();
  let r = brain(v, "aufgabe", "neu", "Lieferanten", "anrufen", "--prio", "hoch", "--faellig", "2099-11-03");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Aufgabe angelegt: 05_aufgaben\/\d{4}-\d{2}-\d{2}-lieferanten-anrufen\.md\n$/);
  r = brain(v, "aufgabe", "neu", "Von der KI", "--quelle", "ki:codex", "--text", "Details");
  assert.equal(r.status, 0, r.stderr);
  r = brain(v, "aufgaben");
  assert.equal(r.status, 0);
  const zeilen = r.stdout.trim().split("\n");
  assert.equal(zeilen.length, 2);
  assert.match(zeilen[0], /^\[offen\] hoch 05_aufgaben\/.*lieferanten-anrufen\.md Lieferanten anrufen \(fällig 2099-11-03\)$/);
  assert.match(zeilen[1], /^\[offen\] 05_aufgaben\/.*von-der-ki\.md Von der KI$/);
  r = brain(v, "aufgabe", "erledigt", "lieferanten");
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^Lieferanten anrufen: erledigt/);
  assert.equal(brain(v, "aufgaben").stdout.trim().split("\n").length, 1);                       // erledigte sind weg
  assert.equal(brain(v, "aufgaben", "--status", "erledigt").stdout.trim().split("\n").length, 1);
  const j = JSON.parse(brain(v, "aufgaben", "--alle", "--json").stdout);
  assert.deepEqual(j.map((x) => [x.titel, x.status, x.quelle]), [["Lieferanten anrufen", "erledigt", "mensch"], ["Von der KI", "offen", "ki:codex"]]);
  assert.ok(j.every((x) => !("text" in x)));
  r = brain(v, "aufgabe", "status", "von-der-ki", "in-arbeit");
  assert.equal(r.status, 0); assert.match(r.stdout, /Von der KI: in-arbeit/);
  assert.equal(brain(v, "aufgaben", "--status", "in-arbeit").stdout.trim().split("\n").length, 1);
});
test("CLI: Fehler sind verständlich und enden mit Exit 64 bzw. 1, nie mit Stacktrace; BRAIN_QUELLE setzt die Quelle", () => {
  const v = vault();
  for (const [args, code, re] of [[["aufgabe"], 64, /Nutzung/], [["aufgabe", "neu"], 64, /Nutzung/], [["aufgabe", "neu", "X", "--prio", "sehr"], 64, /Priorität/],
    [["aufgabe", "neu", "X", "--faellig", "bald"], 64, /Datum/], [["aufgabe", "neu", "X", "--quelle", "bot"], 64, /Quelle/], [["aufgabe", "erledigt", "gibtsnicht"], 1, /gibt es nicht/],
    [["aufgaben", "--status", "fertig"], 64, /Status/]]) {
    const r = brain(v, ...args);
    assert.equal(r.status, code, args.join(" ") + r.stdout + r.stderr);
    assert.match(r.stderr, re); assert.doesNotMatch(r.stderr, /at .*\.mjs/);
  }
  const r = spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", v, "aufgabe", "neu", "Per Umgebung"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: "", BRAIN_QUELLE: "ki:gemini" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(A.liste(v)[0].quelle, "ki:gemini");
});
test("CLI: schreibende Unterbefehle nur in einem vertrauten Vault (Exit 5), Lesen geht immer", () => {
  const v = vault();
  A.legeAn(v, { titel: "Schon da" }, { jetzt: T0 });
  const env = { ...process.env, BRAIN_VAULT: "", KORTEX_VAULT_VERTRAUT: "", BRAIN_APP_SUPPORT: mkdtempSync(join(tmpdir(), "support leer ")) };
  const lauf = (...a) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", v, ...a], { encoding: "utf8", env });
  const neu = lauf("aufgabe", "neu", "Nicht erlaubt");
  assert.equal(neu.status, 5); assert.match(neu.stderr, /noch nicht als deiner bestätigt/);
  assert.equal(lauf("aufgabe", "erledigt", "schon").status, 5);
  assert.equal(A.liste(v).length, 1); assert.equal(A.liste(v)[0].status, "offen");
  const lesen = lauf("aufgaben");
  assert.equal(lesen.status, 0, lesen.stderr); assert.match(lesen.stdout, /Schon da/);
});

// ---------- Status für die Menüleiste ----------
test("status: aufgaben { offen, ueberfaellig } in JSON und Text; ohne Aufgaben 0/0 und keine Textzeile", async () => {
  const v = vault();
  const s0 = await brainStatus(v);
  assert.deepEqual(s0.aufgaben, { offen: 0, ueberfaellig: 0 });
  assert.doesNotMatch(statusText(s0), /Aufgaben:/);
  A.legeAn(v, { titel: "Alt", faellig: "2020-01-01" }); A.legeAn(v, { titel: "Neu" }); A.legeAn(v, { titel: "Fertig", status: "erledigt", faellig: "2020-01-01" });
  const s = await brainStatus(v);
  assert.deepEqual(s.aufgaben, { offen: 2, ueberfaellig: 1 });
  assert.match(statusText(s), /Aufgaben: 2 offen · 1 überfällig/);
  const r = brain(v, "status", "--json");
  assert.deepEqual(JSON.parse(r.stdout.trim().split("\n").pop()).aufgaben, { offen: 2, ueberfaellig: 1 });
});

// ---------- Skill ----------
test("Skill „aufgabe“ liegt im Kern und wird als Befehl gebaut (Quelle: ki:<programm>)", () => {
  const z = mkdtempSync(join(tmpdir(), "cmd-")); const v = vault();
  const r = spawnSync(process.execPath, [join(KERN, "skills-build.mjs"), v, "--ziel", "claude-commands", z], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(z, "aufgabe.md")));
  const t = readFileSync(join(z, "aufgabe.md"), "utf8");
  assert.match(t, /^---\ndescription: .*Aufgabe.*\nargument-hint: .*\n---\n/);
  assert.match(t, /aufgabe neu "<titel>" --quelle ki:<dein-programm>/);
  assert.doesNotMatch(t, /\{\{/);
});
