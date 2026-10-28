// beleg.mjs — Zitat-Prüfung gegen das Transkript (Spec §4.1). Kernrisiko: ein Zitat zählt als belegt, obwohl es nur
// eingespielter Kontext oder KI-Text ist (das Brain würde sich selbst bestätigen). Im Zweifel ki oder null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HERKUNFT_RANG, normalisiere, ladeTranskript, fundstellen, findeZitat } from "../beleg.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-belege");
const TRANSKRIPT = join(FIXTURE, "transkript.jsonl");

// Kleine Zeilen-Bauer für gezielte Einzelfälle
const nutzer = (uuid, content, extra = {}) => ({ type: "user", uuid, timestamp: "2026-10-21T10:00:00.000Z", message: { role: "user", content }, ...extra });
const assistent = (uuid, content) => ({ type: "assistant", uuid, timestamp: "2026-10-21T10:00:01.000Z", message: { role: "assistant", content } });
const aufruf = (id, name, input = {}) => ({ type: "tool_use", id, name, input });
const ergebnis = (id, content) => ({ type: "tool_result", tool_use_id: id, content });

function mitTempOrdner(fn) {
  const ordner = mkdtempSync(join(tmpdir(), "beleg-test-"));
  try { return fn(ordner); } finally { rmSync(ordner, { recursive: true, force: true }); }
}

test("HERKUNFT_RANG: tool > du > web > ki", () => {
  assert.deepEqual(HERKUNFT_RANG, { tool: 3, du: 2, web: 1, ki: 0 });
});

// ---------- normalisiere ----------

test("normalisiere: Leerraum (NBSP, Zeilenumbruch, Tab) → ein Leerzeichen, getrimmt", () => {
  assert.equal(normalisiere("  a  b\n\nc\td  "), "a b c d");
  assert.equal(normalisiere(" x y\r\nz"), "x y z");
  assert.equal(normalisiere(" \n\t "), "");
});

test("normalisiere: Anführungszeichen, Striche, Auslassung", () => {
  assert.equal(normalisiere("„a“ ”b” «c» »d«"), '"a" "b" "c" "d"');
  assert.equal(normalisiere("‚a‘ ’b’ ‹c› ›d‹"), "'a' 'b' 'c' 'd'");
  assert.equal(normalisiere("1–2 — 3"), "1-2 - 3");
  assert.equal(normalisiere("Moment…"), "Moment...");
});

test("normalisiere: **fett** und `code` verlieren die Zeichen, einzelne * und _ bleiben Inhalt", () => {
  assert.equal(normalisiere("Die **Gartenschere** liegt in der `Werkzeugkiste`."), "Die Gartenschere liegt in der Werkzeugkiste.");
  assert.equal(normalisiere("```js\nx\n```"), "js x");
  assert.equal(normalisiere("snake_case und *kursiv* und 2*3"), "snake_case und *kursiv* und 2*3");
});

test("normalisiere: Unicode NFC, Groß/Klein bleibt", () => {
  assert.equal(normalisiere("Ä"), "Ä");
  assert.equal(normalisiere("ä") === "ä", true);
  assert.equal(normalisiere("Halle SIEBEN"), "Halle SIEBEN");
});

test("normalisiere: kein String → leerer String, wirft nie", () => {
  assert.equal(normalisiere(undefined), "");
  assert.equal(normalisiere(null), "");
  assert.equal(normalisiere(42), "");
  assert.equal(normalisiere({}), "");
});

// ---------- ladeTranskript ----------

test("ladeTranskript: fehlende Datei → []", () => {
  assert.deepEqual(ladeTranskript(join(tmpdir(), "gibt-es-nicht-beleg.jsonl")), []);
  assert.deepEqual(ladeTranskript(undefined), []);
});

test("ladeTranskript: ungültige, leere und Nicht-Objekt-Zeilen werden übersprungen; BOM und CRLF stören nicht", () => {
  mitTempOrdner((ordner) => {
    const pfad = join(ordner, "t.jsonl");
    writeFileSync(pfad, '﻿{"a":1}\r\n\n{kaputt\n[1,2]\n"text"\n42\n{"b":2}\r\n{"halb":"abge');
    assert.deepEqual(ladeTranskript(pfad), [{ a: 1 }, { b: 2 }]);
  });
});

test("ladeTranskript: Fixture-Transkript lädt, nur die kaputte Zeile fehlt", () => {
  const zeilen = ladeTranskript(TRANSKRIPT);
  const rohZeilen = readFileSync(TRANSKRIPT, "utf8").split("\n").filter(Boolean);
  assert.equal(zeilen.length, rohZeilen.length - 1);
  assert.ok(!zeilen.some((z) => z.uuid === "u-kaputt"));
});

// ---------- fundstellen ----------

test("fundstellen: Nutzer-Text → du mit uuid/zeit; leere Texte ergeben kein Stück", () => {
  const f = fundstellen([nutzer("u1", "Hallo Welt, das ist ein Test."), nutzer("u2", "   "), nutzer("u3", [])]);
  assert.deepEqual(f, [{ herkunft: "du", uuid: "u1", zeit: "2026-10-21T10:00:00.000Z", werkzeug: null, text: "Hallo Welt, das ist ein Test." }]);
});

test("fundstellen: system-reminder wird eigenes ki-Stück, Rest der Nachricht bleibt du", () => {
  const f = fundstellen([nutzer("u1", [
    { type: "text", text: "Frage vorab.<system-reminder>Kontext Eins</system-reminder>Frage danach." },
  ])]);
  assert.deepEqual(f.map((s) => [s.herkunft, s.text]), [["du", "Frage vorab."], ["ki", "Kontext Eins"], ["du", "Frage danach."]]);
});

test("fundstellen: system-reminder in einem Werkzeug-Ergebnis → ki-Stück, Rest behält tool/web; offener Block bis zum Ende ki; Agent bleibt ki", () => {
  const f = fundstellen([
    assistent("a1", [aufruf("t1", "Read"), aufruf("t2", "WebFetch"), aufruf("t3", "Bash"), aufruf("t4", "Agent")]),
    nutzer("u1", [ergebnis("t1", "     1\tInhalt der Datei\n<system-reminder>Eingespielt</system-reminder>")]),
    nutzer("u2", [ergebnis("t2", "Seite vorn <system-reminder>Eingespielt</system-reminder> Seite hinten")]),
    nutzer("u3", [ergebnis("t3", "Ausgabe\n<system-reminder>nie geschlossen")]),
    nutzer("u4", [ergebnis("t4", "Bericht <system-reminder>x</system-reminder> Ende")]),
  ]);
  assert.deepEqual(f.map((s) => [s.uuid, s.herkunft, s.werkzeug, s.text]), [
    ["u1", "tool", "Read", "Inhalt der Datei\n"],
    ["u1", "ki", "Read", "Eingespielt"],
    ["u2", "web", "WebFetch", "Seite vorn "],
    ["u2", "ki", "WebFetch", "Eingespielt"],
    ["u2", "web", "WebFetch", " Seite hinten"],
    ["u3", "tool", "Bash", "Ausgabe\n"],
    ["u3", "ki", "Bash", "<system-reminder>nie geschlossen"],
    ["u4", "ki", "Agent", "Bericht <system-reminder>x</system-reminder> Ende"],
  ]);
  const zeilen = [
    assistent("a1", [aufruf("t1", "Read")]),
    nutzer("u1", [ergebnis("t1", "Echter Dateiinhalt hier.\n<system-reminder>Nur eingespielter Hinweistext.</system-reminder>")]),
  ];
  assert.equal(findeZitat(zeilen, "Echter Dateiinhalt hier.").herkunft, "tool");
  assert.equal(findeZitat(zeilen, "Nur eingespielter Hinweistext.").herkunft, "ki");
});

test("findeZitat: **fett**/`code` im Transkript oder im Zitat ändern den Treffer nicht; andere Wörter schon", () => {
  const zeilen = [nutzer("u1", "Die **Gartenschere** liegt in der `Werkzeugkiste`."), nutzer("u2", "Das Beet ist 4 Meter lang.")];
  assert.equal(findeZitat(zeilen, "Die Gartenschere liegt in der Werkzeugkiste.").uuid, "u1");
  assert.equal(findeZitat(zeilen, "Das **Beet** ist `4 Meter` lang.").uuid, "u2");
  assert.equal(findeZitat(zeilen, "Die Gartenschere liegt in der Kiste."), null);
});

test("fundstellen: isMeta, isCompactSummary, fremde origin, Nebenzweig → ki; menschliche origin → du", () => {
  const f = fundstellen([
    nutzer("m", "meta text", { isMeta: true }),
    nutzer("c", "kompakt text", { isCompactSummary: true }),
    nutzer("p", "plugin text", { origin: { kind: "plugin", name: "x" } }),
    nutzer("t", "turn text", { turnOrigin: "task_notification" }),
    nutzer("s", "nebenzweig text", { isSidechain: true }),
    nutzer("h", "mensch text", { origin: { kind: "human" }, turnOrigin: "human" }),
    nutzer("o", "ohne origin text"),
  ]);
  assert.deepEqual(f.map((s) => [s.uuid, s.herkunft]), [
    ["m", "ki"], ["c", "ki"], ["p", "ki"], ["t", "ki"], ["s", "ki"], ["h", "du"], ["o", "du"],
  ]);
});

test("fundstellen: Befehls- und Hinweis-Blöcke → ki, <bash-input> → du, <bash-stdout>/<bash-stderr> → tool", () => {
  const f = fundstellen([nutzer("u1",
    "<command-name>/x</command-name><command-message>m</command-message><local-command-stdout>o</local-command-stdout>" +
    "<local-command-caveat>c</local-command-caveat><bash-input>ls</bash-input><bash-stdout>aus</bash-stdout><bash-stderr>fehl</bash-stderr>")]);
  assert.deepEqual(f.map((s) => [s.herkunft, s.text, s.werkzeug]), [
    ["ki", "/x", null], ["ki", "m", null], ["ki", "o", null], ["ki", "c", null],
    ["du", "ls", null], ["tool", "aus", "Bash"], ["tool", "fehl", "Bash"],
  ]);
});

test("fundstellen: verschachtelter und nicht geschlossener system-reminder bleiben Kontext", () => {
  const f = fundstellen([
    nutzer("a", "<system-reminder>außen <system-reminder>innen</system-reminder> rest</system-reminder>nach dem Block"),
    nutzer("b", "davor <system-reminder>offen und nie geschlossen"),
  ]);
  assert.deepEqual(f.map((s) => [s.uuid, s.herkunft, s.text]), [
    ["a", "ki", "außen <system-reminder>innen</system-reminder> rest"],
    ["a", "du", "nach dem Block"],
    ["b", "du", "davor "],
    ["b", "ki", "<system-reminder>offen und nie geschlossen"],
  ]);
});

test("fundstellen: Benachrichtigungstexte ohne Etikett → ki", () => {
  const f = fundstellen([
    nutzer("a", "<task-notification>x</task-notification>"),
    nutzer("b", "[Request interrupted by user for tool use]"),
    nutzer("c", "Caveat: The messages below were generated by the user while running local commands."),
    nutzer("d", "Ganz normaler Satz vom Nutzer."),
  ]);
  assert.deepEqual(f.map((s) => [s.uuid, s.herkunft]), [["a", "ki"], ["b", "ki"], ["c", "ki"], ["d", "du"]]);
});

test("fundstellen: tool_result-Herkunft nach Werkzeugname, werkzeug = Name", () => {
  const namen = ["Read", "Bash", "BashOutput", "Grep", "Glob", "LS", "NotebookRead", "mcp__x__y",
    "WebFetch", "WebSearch", "Agent", "Task", "Skill", "Edit", "ToolSearch"];
  const zeilen = [];
  namen.forEach((n, i) => {
    zeilen.push(assistent("a" + i, [aufruf("t" + i, n)]));
    zeilen.push(nutzer("u" + i, [ergebnis("t" + i, "Ergebnis " + n)]));
  });
  const erwartet = { Read: "tool", Bash: "tool", BashOutput: "tool", Grep: "tool", Glob: "tool", LS: "tool", NotebookRead: "tool",
    mcp__x__y: "web", WebFetch: "web", WebSearch: "web", Agent: "ki", Task: "ki", Skill: "ki", Edit: "ki", ToolSearch: "ki" };
  const ergebnisse = fundstellen(zeilen).filter((s) => s.text.startsWith("Ergebnis "));
  assert.equal(ergebnisse.length, namen.length);
  for (const s of ergebnisse) {
    const n = s.text.slice("Ergebnis ".length);
    assert.equal(s.herkunft, erwartet[n], n);
    assert.equal(s.werkzeug, n);
  }
});

test("fundstellen: tool_result ohne bekanntes tool_use → ki, werkzeug null; Array-Inhalt wird verbunden", () => {
  const f = fundstellen([
    assistent("a1", [aufruf("t1", "Read")]),
    nutzer("u1", [ergebnis("t1", [{ type: "text", text: "Zeile eins" }, { type: "image", source: {} }, { type: "text", text: "Zeile zwei" }])]),
    nutzer("u2", [ergebnis("t-unbekannt", "irgendwas")]),
  ]);
  assert.deepEqual(f.map((s) => [s.uuid, s.herkunft, s.werkzeug, s.text]), [
    ["u1", "tool", "Read", "Zeile eins\nZeile zwei"],
    ["u2", "ki", null, "irgendwas"],
  ]);
});

test("fundstellen: Read/NotebookRead-Ergebnis verliert das Zeilennummern-Präfix je Zeile (Tab und Pfeil), text ist bereinigt", () => {
  const f = fundstellen([
    assistent("a1", [aufruf("t1", "Read"), aufruf("t2", "NotebookRead"), aufruf("t3", "Read"), aufruf("t4", "Read")]),
    nutzer("u1", [ergebnis("t1", "     1\tErste Zeile\n    12\t\tEingerückt 3\tTab bleibt\n   100\t")]),
    nutzer("u2", [ergebnis("t2", "1→Zelle eins\n22→Zelle zwei")]),
    nutzer("u3", [ergebnis("t3", [{ type: "text", text: "  7\tAus Block eins" }, { type: "text", text: "  8→Aus Block zwei" }])]),
    nutzer("u4", [ergebnis("t4", "Keine Nummer am Anfang\n2024 war ein gutes Jahr\n5 Stück\n")]),
  ]);
  assert.deepEqual(f.map((s) => s.text), [
    "Erste Zeile\n\tEingerückt 3\tTab bleibt\n",
    "Zelle eins\nZelle zwei",
    "Aus Block eins\nAus Block zwei",
    "Keine Nummer am Anfang\n2024 war ein gutes Jahr\n5 Stück\n",
  ]);
  assert.ok(f.every((s) => s.herkunft === "tool"));
});

test("fundstellen: Bash/Grep/MCP-Ergebnisse behalten führende Zahlen", () => {
  const f = fundstellen([
    assistent("a1", [aufruf("t1", "Bash"), aufruf("t2", "Grep"), aufruf("t3", "mcp__x__y"), aufruf("t4", "BashOutput")]),
    nutzer("u1", [ergebnis("t1", "     1\tzeile\n2→zeile")]),
    nutzer("u2", [ergebnis("t2", "17\tTreffer")]),
    nutzer("u3", [ergebnis("t3", "3\tTreffer")]),
    nutzer("u4", [ergebnis("t4", "4→Treffer")]),
  ]);
  assert.deepEqual(f.map((s) => s.text), ["     1\tzeile\n2→zeile", "17\tTreffer", "3\tTreffer", "4→Treffer"]);
});

test("findeZitat: mehrzeiliges Zitat aus Read-Ergebnis trifft, Zeilennummern gehören nicht zum Inhalt", () => {
  const zeilen = [assistent("a1", [aufruf("t1", "Read")]),
    nutzer("u1", [ergebnis("t1", "     1\tDer Server heißt wolke.\n     2\tEr läuft auf Port 8080.\n")])];
  assert.equal(findeZitat(zeilen, "Der Server heißt wolke.\nEr läuft auf Port 8080.")?.uuid, "u1");
  assert.equal(findeZitat(zeilen, "Der Server heißt wolke. 2 Er läuft auf Port 8080."), null);
});

test("fundstellen: Nebenzweig-Zeile mit Werkzeug-Ergebnis bleibt tool, ihr Text ist ki", () => {
  const f = fundstellen([
    assistent("a1", [aufruf("t1", "Read")]),
    nutzer("u1", [ergebnis("t1", "Dateiinhalt")], { isSidechain: true }),
    nutzer("u2", "Auftrag an den Subagenten", { isSidechain: true }),
  ]);
  assert.deepEqual(f.map((s) => [s.uuid, s.herkunft]), [["u1", "tool"], ["u2", "ki"]]);
});

test("fundstellen: Assistent (Text, thinking, tool_use-Eingabe) und andere Zeilentypen → ki", () => {
  const f = fundstellen([
    assistent("a1", [{ type: "thinking", thinking: "denke nach" }, { type: "text", text: "antwort" },
      aufruf("t1", "Bash", { command: "echo hallo", nested: { pfad: "/x/y" } })]),
    assistent("a2", "reiner Text"),
    { type: "attachment", uuid: "x1", timestamp: "Z", attachment: { content: "hook ausgabe" } },
    { type: "system", uuid: "s1", content: "systemtext" },
    { type: "summary", summary: "kurzfassung" },
  ]);
  assert.ok(f.every((s) => s.herkunft === "ki"));
  const texte = f.map((s) => s.text).join("|");
  for (const t of ["denke nach", "antwort", "echo hallo", "/x/y", "reiner Text", "hook ausgabe", "systemtext", "kurzfassung"]) assert.ok(texte.includes(t), t);
  assert.equal(f.find((s) => s.text === "kurzfassung").uuid, null);
});

test("fundstellen: kaputte Einträge im Array stören nicht", () => {
  assert.deepEqual(fundstellen([null, undefined, 5, "x", [], {}]), []);
});

// ---------- findeZitat: Grenzen ----------

test("findeZitat: 12 Zeichen nach Normalisierung sind die Untergrenze, 300 die Obergrenze", () => {
  const lang = "x".repeat(300) + " Ende";
  const zeilen = [nutzer("u1", "abcdefghijkl und " + lang)];
  assert.equal(findeZitat(zeilen, "abcdefghijk"), null);              // 11
  assert.equal(findeZitat(zeilen, "  abcdefghijk  "), null);          // 11 nach trim
  assert.equal(findeZitat(zeilen, "abcdefghijkl")?.uuid, "u1");       // 12
  assert.equal(findeZitat(zeilen, "x".repeat(300))?.uuid, "u1");      // 300
  assert.equal(findeZitat(zeilen, "x".repeat(301)), null);            // 301: nicht gekürzt
});

test("findeZitat: Länge zählt nach Normalisierung (Leerraum zusammengefasst)", () => {
  const zeilen = [nutzer("u1", "a b c d e f g h i j k l m")];
  assert.equal(findeZitat(zeilen, "a   b   c   d   e   f   g")?.uuid, "u1"); // 13 Zeichen normalisiert, roh 25
  assert.equal(findeZitat(zeilen, "a   b   c   d   e   f"), null);            // 11 normalisiert, roh länger als 12
});

test("findeZitat: kein String, leer → null, wirft nie", () => {
  const zeilen = [nutzer("u1", "Irgendein ausreichend langer Satz.")];
  for (const z of [undefined, null, 42, {}, "", "   "]) assert.equal(findeZitat(zeilen, z), null);
  assert.equal(findeZitat([], "Irgendein ausreichend langer Satz."), null);
  assert.equal(findeZitat(undefined, "Irgendein ausreichend langer Satz."), null);
});

test("findeZitat: Ergebnis hat genau herkunft, uuid, zeit, werkzeug", () => {
  const zeilen = [assistent("a1", [aufruf("t1", "Read")]), nutzer("u1", [ergebnis("t1", "Der Server läuft auf Port 8080.")])];
  assert.deepEqual(findeZitat(zeilen, "Server läuft auf Port 8080"),
    { herkunft: "tool", uuid: "u1", zeit: "2026-10-21T10:00:00.000Z", werkzeug: "Read" });
});

test("findeZitat: Gleichstand → frühester; höherer Rang schlägt früheren niedrigeren", () => {
  const zeilen = [
    assistent("a1", "Der Lieferant sitzt in Hamburg am Hafen."),
    nutzer("u1", "Der Lieferant sitzt in Hamburg am Hafen."),
    nutzer("u2", "Der Lieferant sitzt in Hamburg am Hafen."),
  ];
  assert.equal(findeZitat(zeilen, "Lieferant sitzt in Hamburg")?.uuid, "u1");
  assert.equal(findeZitat(zeilen, "Lieferant sitzt in Hamburg")?.herkunft, "du");
});

// ---------- K2: Claude-Text über ein Werkzeug ----------

test("findeZitat (K2): Zitat steht VORHER in Assistenten-Text oder Werkzeug-Eingabe → tool/web wird ki", () => {
  const satz = "Der Gabelstapler wird jeden Mittwoch gewartet.";
  const faelle = {
    "echo": [assistent("a1", [aufruf("t1", "Bash", { command: `echo '${satz}'` })]), nutzer("u1", [ergebnis("t1", satz)])],
    "Write → Read": [assistent("a1", [aufruf("t0", "Write", { file_path: "/x/n.md", content: satz })]), nutzer("u0", [ergebnis("t0", "ok")]),
      assistent("a2", [aufruf("t1", "Read", { file_path: "/x/n.md" })]), nutzer("u1", [ergebnis("t1", `     1\t${satz}`)])],
    "Edit new_string": [assistent("a1", [aufruf("t0", "Edit", { file_path: "/x/n.md", old_string: "alt", new_string: satz })]), nutzer("u0", [ergebnis("t0", "ok")]),
      assistent("a2", [aufruf("t1", "Grep", { pattern: "Gabel" })]), nutzer("u1", [ergebnis("t1", `n.md:3:${satz}`)])],
    "Commit-Text": [assistent("a1", [aufruf("t0", "Bash", { command: `git commit -m "${satz}"` })]), nutzer("u0", [ergebnis("t0", "[main 1a2b3c4] ok")]),
      assistent("a2", [aufruf("t1", "Bash", { command: "git log -1 --format=%s" })]), nutzer("u1", [ergebnis("t1", satz)])],
    "Assistenten-Text": [assistent("a1", [{ type: "text", text: `Ich merke mir: ${satz}` }, aufruf("t1", "Read", { file_path: "/x/n.md" })]), nutzer("u1", [ergebnis("t1", satz)])],
    "web": [assistent("a1", [{ type: "text", text: satz }, aufruf("t1", "WebFetch", { url: "https://beispiel.example" })]), nutzer("u1", [ergebnis("t1", satz)])],
  };
  for (const [name, zeilen] of Object.entries(faelle)) {
    const r = findeZitat(zeilen, satz);
    assert.equal(r?.herkunft, "ki", name);
  }
});

test("findeZitat (K2): Nutzer sagt X, Claude wiederholt X, Read zeigt X → du; Read VOR dem Claude-Text bleibt tool", () => {
  const satz = "Die Ersatzteilliste liegt in Regal drei.";
  const r = findeZitat([nutzer("u0", satz), assistent("a1", [{ type: "text", text: `Verstanden: ${satz}` }, aufruf("t1", "Read")]), nutzer("u1", [ergebnis("t1", satz)])], satz);
  assert.deepEqual([r.herkunft, r.uuid], ["du", "u0"]);
  const davor = findeZitat([assistent("a0", [aufruf("t1", "Read")]), nutzer("u1", [ergebnis("t1", satz)]), assistent("a1", [{ type: "text", text: satz }])], satz);
  assert.deepEqual([davor.herkunft, davor.uuid], ["tool", "u1"]);
  const anderes = findeZitat([assistent("a1", [{ type: "text", text: "Ganz anderer Text ohne Bezug." }, aufruf("t1", "Read")]), nutzer("u1", [ergebnis("t1", satz)])], satz);
  assert.equal(anderes.herkunft, "tool", "ein anderer Claude-Text macht den Fund nicht zu ki");
});

// ---------- W2: Web über Bash und MCP ----------

test("fundstellen (W2): Bash mit curl, wget, http:// oder https:// → web; sonst tool; mcp__* → web, außer in der Freigabeliste", () => {
  const befehle = { curl: "curl -s example.org/a", wget: "wget -qO- example.org/a", http: "python3 abruf.py http://example.org/a", https: "node x.js https://example.org/a",
    gross: "CURL -s example.org", lokal: "ls -la /srv", curlwort: "cat curling.txt", tool: "grep -n Preis /srv/preise.md" };
  const erwartet = { curl: "web", wget: "web", http: "web", https: "web", gross: "web", lokal: "tool", curlwort: "tool", tool: "tool" };
  const zeilen = [];
  Object.entries(befehle).forEach(([k, command], i) => { zeilen.push(assistent("a" + i, [aufruf("t" + i, "Bash", { command })]), nutzer("u" + i, [ergebnis("t" + i, "Ergebnis " + k)])); });
  for (const s of fundstellen(zeilen).filter((x) => x.text.startsWith("Ergebnis "))) assert.equal(s.herkunft, erwartet[s.text.slice(9)], s.text);
  const mcp = [assistent("a", [aufruf("t1", "mcp__wetter__abfrage"), aufruf("t2", "mcp__lager__bestand"), aufruf("t3", "mcp__wetter__karte")]),
    nutzer("u1", [ergebnis("t1", "Regen morgen")]), nutzer("u2", [ergebnis("t2", "Bestand 40")]), nutzer("u3", [ergebnis("t3", "Karte")])];
  assert.deepEqual(fundstellen(mcp).map((s) => s.herkunft), ["web", "web", "web"]);
  assert.deepEqual(fundstellen(mcp, { mcpVertraut: ["mcp__lager__bestand", "mcp__wetter__*"] }).map((s) => s.herkunft), ["tool", "tool", "tool"]);
  assert.deepEqual(fundstellen(mcp, { mcpVertraut: ["mcp__lager__bestand"] }).map((s) => s.herkunft), ["web", "tool", "web"]);
  assert.deepEqual(fundstellen(mcp, { mcpVertraut: "kaputt" }).map((s) => s.herkunft), ["web", "web", "web"], "Unbrauchbares gilt als leere Liste");
});

test("findeZitat (W2): Web-Inhalt über curl ist web, über vertrautes MCP-Werkzeug tool", () => {
  const z = [assistent("a1", [aufruf("t1", "Bash", { command: "curl -s https://beispiel.example/preise" })]), nutzer("u1", [ergebnis("t1", "Der Listenpreis beträgt 49 Euro netto.")])];
  assert.equal(findeZitat(z, "Der Listenpreis beträgt 49 Euro").herkunft, "web");
  const m = [assistent("a1", [aufruf("t1", "mcp__shop__preis")]), nutzer("u1", [ergebnis("t1", "Der Listenpreis beträgt 49 Euro netto.")])];
  assert.equal(findeZitat(m, "Der Listenpreis beträgt 49 Euro").herkunft, "web");
  assert.equal(findeZitat(m, "Der Listenpreis beträgt 49 Euro", { mcpVertraut: ["mcp__shop__preis"] }).herkunft, "tool");
});

// ---------- W3: Wortgrenzen ----------

test("findeZitat (W3): vor und nach dem Fund darf kein Buchstabe und keine Ziffer stehen", () => {
  const z = [nutzer("u1", "Der Preis liegt bei 1500 Euro pro Palette."), nutzer("u2", "Der Preis liegt bei 150 Euro pro Palette.")];
  assert.equal(findeZitat(z, "Der Preis liegt bei 150")?.uuid, "u2", "…bei 150 trifft nur die Stelle mit Leerzeichen danach");
  assert.equal(findeZitat([z[0]], "Der Preis liegt bei 150"), null);
  assert.equal(findeZitat([z[1]], "Der Preis liegt bei 150 Euro")?.uuid, "u2");
  assert.equal(findeZitat([nutzer("u3", "Die Lieferung kommt nicht vor Montag.")], "Die Lieferung kommt n"), null, "Ende mitten im Wort");
  assert.equal(findeZitat([nutzer("u3", "Gestern: Die Lieferung kommt Montag.")], "ie Lieferung kommt Montag."), null, "Anfang mitten im Wort");
  assert.equal(findeZitat([nutzer("u3", "Bei Preisen über 50 Euro")], "Preisen über 50 Euro")?.uuid, "u3");
  assert.equal(findeZitat([nutzer("u3", "Der Preis liegt bei 150.5 Euro")], "Der Preis liegt bei 150."), null, "Zahl nicht mittendrin kappen");
  assert.equal(findeZitat([nutzer("u3", "(Der Preis liegt bei 150 Euro)")], "Der Preis liegt bei 150 Euro")?.uuid, "u3", "Klammern, Anführung, Satzzeichen sind Grenzen");
  assert.equal(findeZitat([nutzer("u3", "Über den Ärger der Küche")], "ber den Ärger der Küche"), null, "Umlaute zählen als Buchstaben");
  assert.equal(findeZitat([nutzer("u3", "Der Müller liefert täglich")], "Der Müller liefert täglich")?.uuid, "u3");
});

// ---------- Klein: IDE-Kontext ----------

test("fundstellen (IDE): <ide_selection>, <ide_opened_file> und andere <ide_…>-Blöcke im Nutzertext → ki, der Rest bleibt du", () => {
  const f = fundstellen([nutzer("u1", [
    { type: "text", text: "<ide_opened_file>Der Nutzer hat Datei a.md geöffnet.</ide_opened_file>" },
    { type: "text", text: "<ide_selection>Zeilen 3 bis 3:\nDer Rahmenvertrag läuft bis 2029.\n</ide_selection>\nWas meinst du dazu?" },
    { type: "text", text: "<ide_diagnostics>Fehler in Zeile 4</ide_diagnostics>" },
  ])]);
  assert.deepEqual(f.map((s) => [s.herkunft, s.text]), [
    ["ki", "Der Nutzer hat Datei a.md geöffnet."], ["ki", "Zeilen 3 bis 3:\nDer Rahmenvertrag läuft bis 2029.\n"], ["du", "\nWas meinst du dazu?"], ["ki", "Fehler in Zeile 4"],
  ]);
  assert.equal(findeZitat([nutzer("u1", "<ide_selection>Der Rahmenvertrag läuft bis 2029.</ide_selection> frage")], "Der Rahmenvertrag läuft bis 2029.").herkunft, "ki");
});

// ---------- Prüfset: Zitat-Treue 100 % ----------

test("Prüfset faelle.json: alle Fälle stimmen (Zitat-Treue 100 %)", () => {
  const faelle = JSON.parse(readFileSync(join(FIXTURE, "faelle.json"), "utf8"));
  assert.ok(faelle.length >= 20, `zu wenige Fälle: ${faelle.length}`);
  const zeilen = ladeTranskript(TRANSKRIPT);
  const falsch = [];
  for (const f of faelle) {
    const r = findeZitat(zeilen, f.zitat);
    const ist = r ? { herkunft: r.herkunft, uuid: r.uuid } : null;
    try { assert.deepEqual(ist, f.erwartet); } catch { falsch.push(`${f.warum}: erwartet ${JSON.stringify(f.erwartet)}, war ${JSON.stringify(ist)}`); }
  }
  assert.deepEqual(falsch, [], `${faelle.length - falsch.length}/${faelle.length} Fälle stimmen`);
  console.log(`# Zitat-Treue: ${faelle.length}/${faelle.length} Fälle`);
});

test("Prüfset deckt alle vier Herkünfte und null ab", () => {
  const faelle = JSON.parse(readFileSync(join(FIXTURE, "faelle.json"), "utf8"));
  const arten = new Set(faelle.map((f) => (f.erwartet ? f.erwartet.herkunft : "null")));
  for (const a of ["du", "tool", "web", "ki", "null"]) assert.ok(arten.has(a), a);
  for (const f of faelle) assert.ok(typeof f.warum === "string" && f.warum.length > 0);
});
