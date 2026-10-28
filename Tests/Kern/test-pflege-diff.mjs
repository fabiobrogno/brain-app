// .tools/tests/test-pflege-diff.mjs — B3 Task 2: Diff-Prüfung (Spec §6.2, §10 B3): kritisch, 20 %, Beleg-Links, quellen,
// Konflikt-Kästen, Pfade (.tools, generiert, Rohquelle, Konfiguration), Löschen, _log append-only, nur eigene Seite.
import { test } from "node:test";
import assert from "node:assert/strict";
const D = await import("../tageslauf/diffpruefung.mjs");
const { konfliktKaesten } = await import("../konflikte.mjs");
const JETZT = Date.parse("2026-10-22T03:00:00Z");
const S = ({ quellen = [], rev = 1, kritisch = false } = {}, rumpf = "") => `---\nname: x\ndescription: X\ntyp: thema\n`
  + `quellen: ${JSON.stringify(quellen)}\nquellen_sha: ${JSON.stringify(quellen.map(() => "0123456789abcdef"))}\nrev: ${rev}`
  + `${kritisch ? "\nkritisch: true" : ""}\n---\n${rumpf}`;
const zeilen = (n, ab = 1) => Array.from({ length: n }, (_, i) => `Zeile ${i + ab}.`).join("\n");
const g = (pfad, alt, neu) => ({ pfad, status: "geaendert", alt, neu });
const OPT = { wiki: "09_wiki", cluster: ["10_projekte", "20_firma", "30_wissen"], jetzt: JETZT };
const P = "09_wiki/wissen/orion.md";
const regeln = (r) => r.befunde.map((b) => b.regel);
const KASTEN = [
  '> [!KONFLIKT] offen — Du entscheidest',
  '> A: "Orion läuft auf Port 3309" — Quelle: [[30_wissen/a]]',
  '> B: "Orion läuft auf Port 3310" — Quelle: [[30_wissen/b]]',
].join("\n");

test("ergänzte Seite ist ok; rev im Frontmatter zählt nicht als entfernt", () => {
  const alt = S({}, `# Orion\n\n${zeilen(10)}\n`);
  assert.deepEqual(D.pruefeDiff([g(P, alt, S({ rev: 2 }, `# Orion\n\n${zeilen(10)}\nNeu: Redis.\n`))], OPT), { ok: true, befunde: [] });
});

test("20 %: zwei von zehn Zeilen weg ist ok, drei nicht", () => {
  const alt = S({}, zeilen(10));
  assert.equal(D.pruefeDiff([g(P, alt, S({}, zeilen(8, 3)))], OPT).ok, true);
  const r = D.pruefeDiff([g(P, alt, S({}, zeilen(7, 4)))], OPT);
  assert.deepEqual(regeln(r), ["zu-viel-entfernt"]);
  assert.match(r.befunde[0].meldung, /3 von 10/);
});

test("ersetzte Zeilen älter als 90 Tage zählen nicht, jüngere schon", () => {
  const alt90 = "- ~~Port 3308~~ · ersetzt am 01.06.2026 durch die Zeile darunter";
  const alt21 = "- ~~Port 3309~~ · ersetzt am 01.10.2026 durch die Zeile darunter";
  const alt = S({}, `${zeilen(2)}\n${alt90}\n${alt21}\n`);
  assert.equal(D.pruefeDiff([g(P, alt, S({}, `${zeilen(2)}\n${alt21}\n`))], OPT).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, S({}, `${zeilen(2)}\n${alt90}\n`))], OPT)), ["zu-viel-entfernt"]);
});

test("Beleg-Link muss bleiben (im Fließtext reicht)", () => {
  const fakt = "- Orion läuft · Stand 01.10.2026 · [[10_projekte/belege/2026-10/abc]]";
  const alt = S({}, `${zeilen(10)}\n${fakt}\n`);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, S({}, `${zeilen(10)}\nOrion läuft.\n`))], OPT)), ["beleg-link"]);
  assert.equal(D.pruefeDiff([g(P, alt, S({}, `${zeilen(10)}\nOrion läuft [[10_projekte/belege/2026-10/abc]].\n`))], OPT).ok, true);
});

test("quellen darf nicht schrumpfen", () => {
  const r = D.pruefeDiff([g(P, S({ quellen: ["30_wissen/a.md"] }, zeilen(5)), S({}, zeilen(5)))], OPT);
  assert.deepEqual(regeln(r), ["quellen"]);
});

test("kritisch vorher oder nachher → rot", () => {
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({ kritisch: true }, zeilen(5)), S({ kritisch: true }, `${zeilen(5)}\nx\n`))], OPT)), ["kritisch"]);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({}, zeilen(5)), S({ kritisch: true }, zeilen(5)))], OPT)), ["kritisch"]);
  assert.deepEqual(regeln(D.pruefeDiff([{ pfad: P, status: "neu", alt: null, neu: S({ kritisch: true }, "x") }], OPT)), ["kritisch"]);
});

test("Konflikt-Kasten bleibt; nur mit seinem Fingerabdruck darf er weg (seine Zeilen zählen dann nicht)", () => {
  const alt = S({}, `${zeilen(3)}\n\n${KASTEN}\n`);
  const fp = konfliktKaesten(alt).konflikte[0].fp;
  const neu = S({}, `${zeilen(3)}\n\nOrion läuft auf Port 3310 — Quelle: [[30_wissen/b]] _(Konflikt entschieden am 22.10.2026: B gilt)_\n`);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, neu)], OPT)), ["zu-viel-entfernt", "konflikt-aufgeloest"]);
  assert.equal(D.pruefeDiff([g(P, alt, neu)], { ...OPT, aufgeloest: [fp] }).ok, true);
  assert.deepEqual(D.kastenBereich(alt, fp), { start: 12, ende: 15 });   // Frontmatter 8 Zeilen, 3 Zeilen, Leerzeile, Kasten
  assert.equal(D.kastenBereich(alt, "000000000000"), null);
});

test("Kasten mit Leerzeile vor B: Bereich reicht bis B", () => {
  const t = `x\n> [!KONFLIKT] offen\n> A: "eins" — Quelle: [[a]]\n\n> B: "zwei" — Quelle: [[b]]\ny\n`;
  const fp = konfliktKaesten(t).konflikte[0].fp;
  assert.deepEqual(D.kastenBereich(t, fp), { start: 1, ende: 5 });
});

test("Pfade: .tools, generiert, Rohquelle, Konfiguration, Löschen — nur Wiki, _log, erlaubte neue Dateien", () => {
  const neu = (pfad, text = "x\n") => ({ pfad, status: "neu", alt: null, neu: text });
  const r = D.pruefeDiff([
    neu(".tools/neu.mjs"), neu("09_wiki/_index.md"), neu("INDEX.md"), neu("30_wissen/notiz.md"), neu(".claude/settings.json"),
    g("30_wissen/alt.md", "a\n", "b\n"), g("brain.config.json", "{}", '{"a":1}'), { pfad: P, status: "geloescht", alt: S({}, "x"), neu: null },
  ], OPT);
  assert.deepEqual(regeln(r), ["tools", "generiert", "generiert", "pfad", "pfad", "pfad", "pfad", "geloescht"]);
  assert.equal(D.pruefeDiff([neu("30_wissen/notiz.md"), neu("30_wissen/belege/2026-10/abc.md")],
    { ...OPT, neueQuellen: ["30_wissen/notiz.md"], neueBelege: ["30_wissen/belege/2026-10/abc.md"] }).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([neu("99_fremd/belege/2026-10/abc.md")], OPT)), ["pfad"]);
});

test("_log.md nur ergänzen; fremde Seite bei nurSeiten", () => {
  const log = "# Log\n\n## 2026-01-01 10:00 — start\n- Seiten neu: keine\n";
  assert.equal(D.pruefeDiff([g("09_wiki/_log.md", log, log.replace("# Log\n\n", "# Log\n\n## 2026-10-22 05:00 — pflege\n- x\n\n"))], OPT).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([g("09_wiki/_log.md", log, log.replace("start", "anders"))], OPT)), ["log"]);
  const r = D.pruefeDiff([g("09_wiki/wissen/tee.md", S({}, "a\n"), S({}, "a\nb\n"))], { ...OPT, nurSeiten: [P] });
  assert.deepEqual(regeln(r), ["fremde-seite"]);
});

test("umgezogen: von der Haiku-Gegenprobe bestätigte Fakt-Zeilen zählen nicht für die 20 %, Beleg-Links trotzdem Pflicht", () => {
  const fakten = Array.from({ length: 5 }, (_, i) => `- Fakt ${i + 1} · Stand 01.10.2026 · [[30_wissen/belege/2026-10/f${i + 1}]]`);
  const alt = S({}, `${zeilen(10)}\n\n## Fakten\n\n${fakten.join("\n")}\n`);
  const neu = S({}, `${zeilen(10)}\nIm Fließtext: ${fakten.map((_, i) => `Fakt ${i + 1} [[30_wissen/belege/2026-10/f${i + 1}]]`).join(", ")}.\n`);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, neu)], OPT)), ["zu-viel-entfernt"]);
  assert.equal(D.pruefeDiff([g(P, alt, neu)], { ...OPT, umgezogen: [...fakten, "## Fakten"] }).ok, true);
  const ohneLink = neu.replace(" [[30_wissen/belege/2026-10/f3]]", "");
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, ohneLink)], { ...OPT, umgezogen: [...fakten, "## Fakten"] })), ["beleg-link"]);
});

test("entfernteZeilen zählt wie eine Mehrfachmenge, Leerzeilen nicht", () => {
  assert.deepEqual(D.entfernteZeilen("x\nx\n\nx\n", "x\n", { jetzt: JETZT }), { gesamt: 3, entfernt: 2, anteil: 2 / 3 });
  assert.deepEqual([...D.belegLinks("a [[30_wissen/belege/2026-10/k1|Beleg]] b [[seite]]")], ["30_wissen/belege/2026-10/k1"]);
});

// ---- Grenzfälle je Regel: jeweils ein Negativ- UND ein Positivtest ----------------------------------------------------

const neuD = (pfad, text = "x\n", mehr = {}) => ({ pfad, status: "neu", alt: null, neu: text, ...mehr });

test("tools: auch geändert, in Großschreibung, mit ./ davor — und eine Seite namens tools im Wiki ist erlaubt", () => {
  assert.deepEqual(regeln(D.pruefeDiff([g(".tools/brain.mjs", "a\n", "b\n"), neuD(".TOOLS/x.mjs"), neuD("./.tools/y.mjs"), neuD(".tools")], OPT)), ["tools", "tools", "tools", "tools"]);
  assert.equal(D.pruefeDiff([neuD("09_wiki/wissen/tools.md", S({}, "x\n"))], OPT).ok, true);
  assert.equal(D.pruefeDiff([neuD("09_wiki/wissen/.tools-notiz.md", S({}, "x\n"))], OPT).ok, false, "versteckte Datei im Wiki ist kein erlaubter Pfad");
});

test("generiert: INDEX, graph, AGENTS, _index und _<Ordner>.md → rot; eine normale neue Wiki-Seite ist ok", () => {
  const r = D.pruefeDiff([neuD("INDEX.md"), neuD("graph.json"), neuD("AGENTS.md"), g("09_wiki/wissen/_wissen.md", "a\n", "b\n"), g("09_wiki/_index.md", "a\n", "b\n")], OPT);
  assert.deepEqual(regeln(r), ["generiert", "generiert", "generiert", "generiert", "generiert"]);
  assert.equal(D.pruefeDiff([neuD("09_wiki/wissen/neu.md", S({}, "# Neu\n"))], OPT).ok, true);
});

test("pfad: Schema, Hooks, .gitignore, Konfiguration, absolute und „..“-Pfade sind nie erlaubt — auch nicht als angemeldete neue Quelle", () => {
  const r = D.pruefeDiff([g("09_wiki/_schema.md", "a\n", "b\n"), g(".hooks/pre-commit", "a\n", "b\n"), g(".gitignore", "a\n", "b\n"),
    neuD("../draussen.md"), neuD("/etc/x.md"), neuD("30_wissen/../.hooks/x"), neuD("C:/x.md")], OPT);
  assert.deepEqual(regeln(r), ["pfad", "pfad", "pfad", "pfad", "pfad", "pfad", "pfad"]);
  const anmelden = [".hooks/neu", "../draussen.md", "30_wissen/.versteckt/x.md"];
  assert.deepEqual(regeln(D.pruefeDiff(anmelden.map((p) => neuD(p)), { ...OPT, neueQuellen: anmelden })), ["pfad", "pfad", "pfad"]);
  assert.equal(D.pruefeDiff([neuD("30_wissen/notiz mit Leerzeichen.md")], { ...OPT, neueQuellen: ["30_wissen/notiz mit Leerzeichen.md"] }).ok, true);
  // eine angemeldete Quelle gilt nur als NEUE Datei: wer eine bestehende ändert, ist rot
  assert.deepEqual(regeln(D.pruefeDiff([g("30_wissen/notiz.md", "a\n", "b\n")], { ...OPT, neueQuellen: ["30_wissen/notiz.md"] })), ["pfad"]);
});

test("Symlink: als neue Seite, als Ersatz einer bestehenden Seite oder als Beleg → rot", () => {
  const link = { symlink: true };
  assert.deepEqual(regeln(D.pruefeDiff([neuD(P, null, link)], OPT)), ["pfad"]);
  assert.deepEqual(regeln(D.pruefeDiff([{ pfad: P, status: "geaendert", alt: S({}, "a\n"), neu: null, symlink: true }], OPT)), ["pfad"]);
  assert.deepEqual(regeln(D.pruefeDiff([neuD("30_wissen/belege/2026-10/abc.md", null, link)], OPT)), ["pfad"]);
  assert.equal(D.pruefeDiff([neuD(P, S({}, "a\n"))], OPT).ok, true);
});

test("Löschen: Wiki-Seite, Rohquelle und _log.md zu löschen ist rot; Umbenennen = neu + gelöscht ist rot", () => {
  const weg = (pfad) => ({ pfad, status: "geloescht", alt: "x\n", neu: null });
  assert.deepEqual(regeln(D.pruefeDiff([weg(P), weg("30_wissen/notiz.md"), weg("09_wiki/_log.md")], OPT)), ["geloescht", "geloescht", "geloescht"]);
  assert.deepEqual(regeln(D.pruefeDiff([weg(P), neuD("09_wiki/wissen/orion-neu.md", S({}, "x"))], OPT)), ["geloescht"]);
});

test("kritisch: kaputter Wert gilt als kritisch (fail-safe); kritisch: false und fehlendes Feld sind ok; eine neue Seite ohne kritisch ist ok", () => {
  const mit = (zeile) => `---\nname: x\ndescription: X\ntyp: thema\nquellen: []\nquellen_sha: []\nrev: 1\n${zeile}\n---\nA\nB\n`;
  assert.deepEqual(regeln(D.pruefeDiff([g(P, mit("kritisch: ja"), mit("kritisch: ja").replace("B", "C"))], { ...OPT })), ["kritisch"]);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, mit("kritisch: false"), mit("kritisch: true"))], OPT)), ["kritisch"]);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, mit("kritisch: true"), mit("kritisch: false"))], OPT)), ["kritisch"]);
  assert.equal(D.pruefeDiff([g(P, mit("kritisch: false"), mit("kritisch: false").replace("B", "B\nC"))], OPT).ok, true);
  assert.equal(D.pruefeDiff([g(P, S({}, "A\nB\n"), S({}, "A\nB\nC\n"))], OPT).ok, true);
});

test("kritisch: auch im Konflikt-/Löschfall zuerst — eine kritische Seite wird nie geprüft, sondern abgelehnt", () => {
  const alt = S({ kritisch: true }, `${zeilen(3)}\n\n${KASTEN}\n`);
  const r = D.pruefeDiff([g(P, alt, S({ kritisch: true }, zeilen(3)))], OPT);
  assert.deepEqual(regeln(r), ["kritisch"]);
});

test("20 %: genau 20 % ist ok, knapp darüber nicht; ein umgeschriebener Satz zählt als entfernt; Reihenfolge ändern kostet nichts", () => {
  const alt = S({}, zeilen(5));
  assert.equal(D.pruefeDiff([g(P, alt, S({}, `${zeilen(4)}\nAnders.`))], OPT).ok, true);                     // 1 von 5 = 20 %
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, S({}, `${zeilen(3)}\nAnders.\nNoch anders.`))], OPT)), ["zu-viel-entfernt"]);   // 2 von 5
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({}, zeilen(10)), S({}, "Zeile 1 anders.\nZeile 2 anders.\nZeile 3 anders.\n" + zeilen(7, 4)))], OPT)), ["zu-viel-entfernt"]);
  assert.equal(D.pruefeDiff([g(P, S({}, "a\nb\nc\nd\ne\n"), S({}, "e\nd\nc\nb\na\n"))], OPT).ok, true);
});

test("20 %: die ganze Seite leeren oder durch einen Satz ersetzen → rot; Frontmatter-Umbau ohne Rumpfänderung → kein Abzug", () => {
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({}, zeilen(10)), S({}, ""))], OPT)), ["zu-viel-entfernt"]);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({}, zeilen(10)), S({}, "Alles neu.\n"))], OPT)), ["zu-viel-entfernt"]);
  assert.equal(D.pruefeDiff([g(P, S({ rev: 1 }, zeilen(10)), S({ rev: 2 }, zeilen(10)))], OPT).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({}, zeilen(10)), zeilen(10))], OPT)).filter((x) => x === "zu-viel-entfernt"), []);   // ohne Frontmatter: Rumpf = alles
});

test("umgezogen: nur die gemeldeten Zeilen sind ausgenommen; eine nicht gemeldete entfernte Zeile zählt weiter", () => {
  const fakten = Array.from({ length: 5 }, (_, i) => `- Fakt ${i + 1} · Stand 01.10.2026 · [[30_wissen/belege/2026-10/f${i + 1}]]`);
  const alt = S({}, `${zeilen(10)}\n${fakten.join("\n")}\n`);
  const neu = S({}, `${zeilen(10)}\nIm Fließtext: ${fakten.map((_, i) => `Fakt ${i + 1} [[30_wissen/belege/2026-10/f${i + 1}]]`).join(", ")}.\n`);
  // 15 nichtleere Zeilen, 5 davon umgeschrieben: mit 1 gemeldeten Zeile bleiben 4 (27 %) → rot, mit 2 genau 3 (20 %) → ok
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, neu)], { ...OPT, umgezogen: fakten.slice(0, 1) })), ["zu-viel-entfernt"]);
  assert.equal(D.pruefeDiff([g(P, alt, neu)], { ...OPT, umgezogen: fakten.slice(0, 2) }).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, neu)], { ...OPT, umgezogen: ["Zeile 1.", "Zeile 2."] })), ["zu-viel-entfernt"], "Zeilen, die nicht entfernt wurden, entlasten nichts");
});

test("Beleg-Link: einer von zwei fehlt → genau ein Befund; Alias, Abschnitt und Fließtext zählen als vorhanden", () => {
  const l1 = "30_wissen/belege/2026-10/b1", l2 = "30_wissen/belege/2026-10/b2";
  const alt = S({}, `${zeilen(10)}\n- A · Stand 01.10.2026 · [[${l1}]]\n- B · Stand 01.10.2026 · [[${l2}]]\n`);
  const nur1 = S({}, `${zeilen(10)}\n- A · Stand 01.10.2026 · [[${l1}]]\nB ohne Link.\n`);
  const r = D.pruefeDiff([g(P, alt, nur1)], OPT);
  assert.deepEqual(regeln(r), ["beleg-link"]);
  assert.match(r.befunde[0].meldung, /b2/);
  const beide = S({}, `${zeilen(10)}\nA [[${l1}|Beleg]] und B [[${l2}#Abschnitt]].\n`);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, alt, beide)], { ...OPT, umgezogen: alt.split("\n").filter((z) => z.startsWith("- ")) })), []);
  // gleiche Zeile geändert, aber Link weg → beides rot (20 % und Link) ist möglich; der Link-Befund ist immer dabei
  assert.ok(regeln(D.pruefeDiff([g(P, alt, S({}, `${zeilen(10)}\n- A neu · Stand 01.10.2026\n- B neu · Stand 01.10.2026\n`))], OPT)).includes("beleg-link"));
});

test("Beleg-Link: ein Link, der schon vorher fehlte oder kein Beleg-Muster hat, ist nicht Pflicht; neue Links sind ok", () => {
  const alt = S({}, `${zeilen(10)}\nSiehe [[30_wissen/tee]] und [[x/belege/kaputt]].\n`);
  assert.equal(D.pruefeDiff([g(P, alt, S({}, `${zeilen(10)}\nSiehe [[30_wissen/tee]] und [[x/belege/kaputt]].\nNeu [[30_wissen/belege/2026-10/n1]].\n`))], OPT).ok, true);
  assert.equal(D.pruefeDiff([g(P, alt, S({}, `${zeilen(10)}\nSiehe [[30_wissen/tee]] und [[x/belege/kaputt]].\nNeu.\n`))], OPT).ok, true);
});

test("quellen: gleich oder erweitert ist ok; ein Eintrag weniger, ein umgeschriebener Eintrag oder ein anderes Format ist rot", () => {
  const q2 = ["30_wissen/a.md", "30_wissen/b.md"];
  assert.equal(D.pruefeDiff([g(P, S({ quellen: q2 }, "x\n"), S({ quellen: q2 }, "x\ny\n"))], OPT).ok, true);
  assert.equal(D.pruefeDiff([g(P, S({ quellen: ["30_wissen/a.md"] }, "x\n"), S({ quellen: q2 }, "x\ny\n"))], OPT).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({ quellen: q2 }, "x\n"), S({ quellen: ["30_wissen/a.md"] }, "x\n"))], OPT)), ["quellen"]);
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({ quellen: q2 }, "x\n"), S({ quellen: ["30_wissen/a.md", "30_wissen/c.md"] }, "x\n"))], OPT)), ["quellen"]);
  const blockForm = S({ quellen: q2 }, "x\n").replace(/quellen: \[.*\]/, "quellen:\n  - 30_wissen/a.md\n  - 30_wissen/b.md");
  assert.deepEqual(regeln(D.pruefeDiff([g(P, S({ quellen: q2 }, "x\n"), blockForm)], OPT)), ["quellen", "quellen"]);
});

test("Konflikt: Kasten umformuliert, in Codeblock versteckt oder auf „geklärt“ gesetzt → rot; unveränderter Kasten bei Ergänzung → ok; zwei Kästen, einer entschieden", () => {
  const alt = S({}, `${zeilen(10)}\n\n${KASTEN}\n`);
  const fp = konfliktKaesten(alt).konflikte[0].fp;
  assert.equal(D.pruefeDiff([g(P, alt, alt.replace("Port 3309", "Port 3309 (vermutlich)"))], OPT).befunde.some((b) => b.regel === "konflikt-aufgeloest"), true);
  assert.equal(D.pruefeDiff([g(P, alt, alt.replace(KASTEN, "```\n" + KASTEN + "\n```"))], OPT).befunde.some((b) => b.regel === "konflikt-aufgeloest"), true);
  assert.equal(D.pruefeDiff([g(P, alt, alt.replace("offen", "geklärt"))], OPT).befunde.some((b) => b.regel === "konflikt-aufgeloest"), true);
  assert.equal(D.pruefeDiff([g(P, alt, `${alt}Neu: Redis.\n`)], OPT).ok, true);
  const k2 = ['> [!KONFLIKT] offen — Du entscheidest', '> A: "Tee ist grün" — Quelle: [[30_wissen/c]]', '> B: "Tee ist schwarz" — Quelle: [[30_wissen/d]]'].join("\n");
  const zwei = S({}, `${zeilen(10)}\n\n${KASTEN}\n\n${k2}\n`);
  const fp2 = konfliktKaesten(zwei).konflikte[1].fp;
  const ersterWeg = zwei.replace(`${KASTEN}\n\n`, "");
  assert.ok(regeln(D.pruefeDiff([g(P, zwei, ersterWeg)], { ...OPT, aufgeloest: [fp2] })).includes("konflikt-aufgeloest"), "der falsche Fingerabdruck erlaubt den ersten Kasten nicht");
  assert.equal(D.pruefeDiff([g(P, zwei, ersterWeg)], { ...OPT, aufgeloest: [fp] }).ok, true);
});

test("log: Zeile gelöscht, Eintrag verändert oder _log.md neu angelegt → rot; mehrere neue Einträge oben → ok", () => {
  const log = "# Log\n\n## 2026-01-01 10:00 — start\n- Seiten neu: keine\n";
  const zwei = log.replace("# Log\n\n", "# Log\n\n## 2026-10-22 05:00 — a\n- x\n\n## 2026-10-22 05:01 — b\n- y\n\n");
  assert.equal(D.pruefeDiff([g("09_wiki/_log.md", log, zwei)], OPT).ok, true);
  assert.deepEqual(regeln(D.pruefeDiff([g("09_wiki/_log.md", log, log.replace("- Seiten neu: keine\n", ""))], OPT)), ["log"]);
  assert.deepEqual(regeln(D.pruefeDiff([neuD("09_wiki/_log.md", log)], OPT)), ["log"]);
});

test("nurSeiten: die eigene Seite ist ok, jede andere (geändert oder neu) ist fremd; ohne nurSeiten gilt die Beschränkung nicht", () => {
  const fremdNeu = neuD("09_wiki/wissen/tee.md", S({}, "x\n"));
  assert.deepEqual(regeln(D.pruefeDiff([fremdNeu], { ...OPT, nurSeiten: [P] })), ["fremde-seite"]);
  assert.equal(D.pruefeDiff([fremdNeu], OPT).ok, true);
  assert.equal(D.pruefeDiff([g(P, S({}, "a\n"), S({}, "a\nb\n"))], { ...OPT, nurSeiten: [P] }).ok, true);
});

test("mehrere Befunde sammeln sich; jede Datei wird einzeln geprüft", () => {
  const r = D.pruefeDiff([neuD(".tools/x.mjs"), g(P, S({}, zeilen(10)), S({}, "x\n")), neuD("09_wiki/wissen/ok.md", S({}, "y\n"))], OPT);
  assert.deepEqual(r.befunde.map((b) => [b.pfad, b.regel]), [[".tools/x.mjs", "tools"], [P, "zu-viel-entfernt"]]);
  assert.equal(r.ok, false);
  assert.deepEqual(D.pruefeDiff([], OPT), { ok: true, befunde: [] });
});

test("Hilfsfunktionen: rumpfZeilen ohne Frontmatter, quellenListe kaputt → leer, kastenBereich ohne Folgezeilen", () => {
  assert.deepEqual(D.rumpfZeilen("---\na: 1\n---\nx\ny"), ["x", "y"]);
  assert.deepEqual(D.rumpfZeilen("---\r\na: 1\r\n---\r\nx\r\n"), ["x", ""]);
  assert.deepEqual(D.quellenListe("---\nquellen: [kaputt\n---\n"), []);
  assert.deepEqual(D.quellenListe(S({ quellen: ["a", "b"] }, "x")), ["a", "b"]);
  assert.equal(D.MAX_ENTFERNT, 0.2);
  assert.equal(D.ERSETZT_TAGE, 90);
});

test("W1: neue Beleg-Dateien nur, wenn die Einheit sie anmeldet — sonst Verstoß (auch mit Fakt-Link auf der Seite)", () => {
  const beleg = { pfad: "30_wissen/belege/2026-10/fake.md", status: "neu", alt: null, neu: "---\nquelle: x\n---\nErfunden\n" };
  const alt = S({}, `# Orion\n\n${zeilen(10)}\n`);
  const seite = g(P, alt, S({}, `# Orion\n\n${zeilen(10)}\n- Kassensystem ersetzt · Stand 22.10.2026 · [[30_wissen/belege/2026-10/fake]]\n`));
  const r = D.pruefeDiff([seite, beleg], OPT);                                   // Inbox/Konsolidieren melden nie Belege an
  assert.equal(r.ok, false);
  assert.deepEqual(regeln(r), ["pfad"]);
  assert.equal(D.pruefeDiff([seite, beleg], { ...OPT, neueBelege: ["30_wissen/belege/2026-10/anders.md"] }).ok, false, "nur die angemeldeten Pfade");
  assert.equal(D.pruefeDiff([seite, beleg], { ...OPT, neueBelege: ["30_wissen/belege/2026-10/fake.md"] }).ok, true);
});
