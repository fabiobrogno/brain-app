// Vorlagen und Tagesnotiz (gemeinsam/vorlagen.mjs): Platzhalter, Datumsformate, Kopf (Frontmatter), Umlaute, Cursor, Zeitzone/Tagesgrenzen inkl. Sommerzeit,
// Pfad der Tagesnotiz und die Gegenprobe Pfad → Tag. Reine Funktionen, keine Dateien.
import test from "node:test";
import assert from "node:assert/strict";
import { pfad } from "./hilfe.mjs";

const V = await import(pfad("gemeinsam", "vorlagen.mjs"));
const { heuteIso } = await import(pfad("gemeinsam", "zeit.mjs"));
const JETZT = new Date("2026-11-05T09:07:03Z"); // Berlin: 5.11.2026 10:07:03 (Donnerstag, KW 45)
const BERLIN = "Europe/Berlin";

test("Datumsformate: Zahlen, Namen, Kalenderwoche, wörtlicher Text", () => {
  const f = (fmt) => V.formatiereDatum(fmt, { iso: "2026-11-05", h: "10", m: "07", s: "03" });
  assert.equal(f("JJJJ-MM-TT"), "2026-11-05");
  assert.equal(f("TT.MM.JJJJ"), "05.11.2026");
  assert.equal(f("T.M.JJ"), "5.11.26");
  assert.equal(f("WWWW, T. MMMM JJJJ"), "Donnerstag, 5. November 2026");
  assert.equal(f("WWW, TT. MMM"), "Do, 05. Nov");
  assert.equal(f("JJJJ-[KW]KW"), "2026-KW45");
  assert.equal(f("HH:mm:ss"), "10:07:03");
  assert.equal(f("[Heute ist] WWWW"), "Heute ist Donnerstag");
  assert.equal(V.formatiereDatum("MMMM", { iso: "2026-03-01" }), "März", "Umlaut im Monatsnamen");
  assert.equal(V.formatiereDatum("TT", { iso: "kaputt" }), "");
});

test("Kalenderwochen am Jahreswechsel (ISO: Woche des Donnerstags)", () => {
  assert.equal(V.kalenderwoche("2026-01-01"), 1);
  assert.equal(V.kalenderwoche("2025-12-29"), 1, "Montag vor dem 1.1.2026 gehört zur KW 1 von 2026");
  assert.equal(V.kalenderwoche("2021-01-03"), 53, "Sonntag 3.1.2021 gehört zu KW 53 von 2020");
  assert.equal(V.kalenderwoche("2024-12-30"), 1);
  assert.equal(V.kalenderwoche("2026-12-31"), 53);
});

test("Platzhalter: titel, datum, datum:FORMAT, zeit, zeit:FORMAT, cursor; Schreibweise und Leerzeichen egal", () => {
  const r = V.renderVorlage("# {{titel}}\n{{ Datum }} · {{datum:TT.MM.JJJJ}} · {{DATUM:WWWW}} · {{zeit}} · {{zeit:HH}}h\nAnfang {{cursor}} Ende", { titel: "Käse & Öl", jetzt: JETZT, zone: BERLIN });
  assert.equal(r.text, "# Käse & Öl\n2026-11-05 · 05.11.2026 · Donnerstag · 10:07 · 10h\nAnfang  Ende");
  assert.equal(r.cursor, r.text.indexOf("Anfang ") + "Anfang ".length);
});

test("Platzhalter: unbekanntes bleibt stehen, {{titel:x}} gibt es nicht, nur der erste Cursor zählt, Cursor im Titel wirkt nicht", () => {
  const r = V.renderVorlage("{{foo}} {{titel:x}} {{cursor}}a{{cursor}}b", { titel: "T{{cursor}}x", jetzt: JETZT, zone: BERLIN });
  assert.equal(r.text, "{{foo}} {{titel:x}} ab");
  assert.equal(r.cursor, "{{foo}} {{titel:x}} ".length);
  const kein = V.renderVorlage("nur Text", { jetzt: JETZT, zone: BERLIN });
  assert.equal(kein.cursor, null);
  const t = V.renderVorlage("{{titel}}", { titel: "Zeile1\nZeile2 Drei", jetzt: JETZT, zone: BERLIN });
  assert.equal(t.text, "Zeile1 Zeile2 Drei", "ein Titel ist einzeilig");
});

test("Umlaute und Zeilenenden bleiben erhalten, CRLF wird zu LF", () => {
  const r = V.renderVorlage("# Größe äöüß\r\n{{datum:MMMM}}\r\n", { jetzt: new Date("2026-03-15T12:00:00Z"), zone: BERLIN });
  assert.equal(r.text, "# Größe äöüß\nMärz\n");
});

test("Kopf der Vorlage: Titel im Kopf bleibt gültiges YAML (Doppelpunkt, #, Anführungszeichen, Zahlen), auch innerhalb von Anführungszeichen", () => {
  const kopf = "---\ntitel: {{titel}}\nq: \"{{titel}}\"\ns: '{{titel}}'\nerstellt: {{datum}}\n---\n# {{titel}}\n";
  const lies = (titel) => V.renderVorlage(kopf, { titel, jetzt: JETZT, zone: BERLIN }).text;
  assert.match(lies("Einfach"), /^---\ntitel: Einfach\nq: "Einfach"\ns: 'Einfach'\nerstellt: 2026-11-05\n---\n# Einfach\n$/);
  const heikel = lies('Plan: "Neu" #1');
  assert.match(heikel, /titel: "Plan: \\"Neu\\" #1"\n/, "ohne Anführungszeichen → in JSON-Anführungszeichen");
  assert.match(heikel, /q: "Plan: \\"Neu\\" #1"\n/, "in Anführungszeichen → nur maskiert");
  assert.match(lies("Don't"), /s: 'Don''t'\n/, "in einfachen Anführungszeichen → verdoppelt");
  assert.match(lies("2026"), /titel: "2026"\n/, "eine Zahl bliebe sonst eine Zahl");
  assert.match(lies("true"), /titel: "true"\n/);
  assert.match(lies(""), /titel: ""\n/, "leerer Titel ist ein leerer Text, kein Nichts");
  assert.match(lies("# Gedanken"), /titel: "# Gedanken"\n/);
  assert.match(heikel, /\n# Plan: "Neu" #1\n$/, "im Rumpf bleibt der Titel unverändert");
});

test("Notiztext: Kopf bleibt oben, Titel wird nur eingefügt, wenn der Rumpf keine Überschrift hat", () => {
  const mit = V.baueNotizText({ vorlage: "---\ntyp: besprechung\n---\n# {{titel}}\n\n## Agenda\n", titel: "Wochenstart", jetzt: JETZT, zone: BERLIN });
  assert.equal(mit.text, "---\ntyp: besprechung\n---\n# Wochenstart\n\n## Agenda\n");
  const ohne = V.baueNotizText({ vorlage: "---\ntyp: projekt\n---\n## Ziel\n\nText {{cursor}}\n", titel: "Alpha", jetzt: JETZT, zone: BERLIN });
  assert.equal(ohne.text, "---\ntyp: projekt\n---\n# Alpha\n\n## Ziel\n\nText \n");
  assert.equal(ohne.cursor, ohne.text.indexOf("Text ") + 5, "der Cursor wandert mit dem eingefügten Titel mit");
  assert.equal(ohne.text.split("---").length, 3, "der Kopf steht genau einmal da");
  const nurKopf = V.baueNotizText({ vorlage: "---\na: 1\n---\n", titel: "X", jetzt: JETZT, zone: BERLIN });
  assert.equal(nurKopf.text, "---\na: 1\n---\n# X\n");
  const code = V.baueNotizText({ vorlage: "```\n# kein Titel\n```\n", titel: "Echt", jetzt: JETZT, zone: BERLIN });
  assert.match(code.text, /^# Echt\n\n```/, "eine Überschrift im Code-Block zählt nicht");
  assert.equal(V.baueNotizText({ vorlage: "## Unter\n", titel: "A", jetzt: JETZT, zone: BERLIN }).text.startsWith("# A\n\n## Unter"), true, "## ist keine Überschrift der Ebene 1");
});

test("Cursor: ohne {{cursor}} und ohne Titel hinter der ersten Überschrift, mit Titel am Ende; ohne Vorlage ein leerer Titel", () => {
  const leer = V.baueNotizText({ vorlage: "# {{titel}}\n\n## A\n", titel: "", jetzt: JETZT, zone: BERLIN });
  assert.equal(leer.text, "# \n\n## A\n");
  assert.equal(leer.cursor, 2);
  const voll = V.baueNotizText({ vorlage: "# {{titel}}\n\n## A\n", titel: "Fertig", jetzt: JETZT, zone: BERLIN });
  assert.equal(voll.cursor, voll.text.length);
  const ohneVorlage = V.baueNotizText({ titel: "", jetzt: JETZT, zone: BERLIN });
  assert.equal(ohneVorlage.text, "# \n");
  assert.equal(ohneVorlage.cursor, 2);
  const mitTitel = V.baueNotizText({ titel: "Hallo", jetzt: JETZT, zone: BERLIN });
  assert.equal(mitTitel.text, "# Hallo\n");
});

test("Titel aus dem Text: erste Überschrift, sonst erste Zeile; leere Notiz hat keinen Titel (keine Datei)", () => {
  assert.equal(V.titelAusText("# Hallo Welt\n"), "Hallo Welt");
  assert.equal(V.titelAusText("---\na: 1\n---\n# Mit Kopf\n"), "Mit Kopf");
  assert.equal(V.titelAusText("# \n"), null);
  assert.equal(V.titelAusText("# \n\nGedanke zum Mitnehmen\n"), "Gedanke zum Mitnehmen");
  assert.equal(V.titelAusText("\n\n- [ ] Milch kaufen\n"), "Milch kaufen");
  assert.equal(V.titelAusText("## Unterüberschrift\n"), "Unterüberschrift");
  assert.equal(V.titelAusText(""), null);
  assert.equal(V.titelAusText("   \n\n"), null);
  assert.equal(V.titelAusText("---\na: 1\n---\n"), null);
  assert.equal(V.titelAusText("# Titel ##\n"), "Titel");
});

test("Tagesnotiz-Pfad: Standard Tagebuch/JJJJ-MM-TT.md, eigener Ordner und Format, Namen mit Umlauten", () => {
  assert.equal(V.tagesnotizPfad({}, "2026-11-05"), "Tagebuch/2026-11-05.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizOrdner: "Journal/Tage", tagesnotizFormat: "TT.MM.JJJJ" }, "2026-11-05"), "Journal/Tage/05.11.2026.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizFormat: "JJJJ/MM/JJJJ-MM-TT WWW" }, "2026-03-01"), "Tagebuch/2026/03/2026-03-01 So.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizFormat: "JJJJ-MM-TT MMMM" }, "2026-03-01"), "Tagebuch/2026-03-01 März.md");
  assert.equal(V.tagesnotizPfad({}, "2026-02-30"), null, "kein echter Tag");
  assert.equal(V.tagesnotizPfad({}, "heute"), null);
});

test("Tagesnotiz-Pfad: nichts führt aus dem Vault hinaus; Doppelpunkt und Steuerzeichen werden entschärft; leer = Standard", () => {
  assert.equal(V.tagesnotizPfad({ tagesnotizOrdner: "../../etc", tagesnotizFormat: "../x" }, "2026-11-05"), "etc/x.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizOrdner: "/abs//lut/" }, "2026-11-05"), "abs/lut/2026-11-05.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizFormat: "HH:mm" }, "2026-11-05"), "Tagebuch/00-00.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizOrdner: "", tagesnotizFormat: "  " }, "2026-11-05"), "Tagebuch/2026-11-05.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizOrdner: "..", tagesnotizFormat: ".." }, "2026-11-05"), "Tagebuch/2026-11-05.md");
  assert.equal(V.tagesnotizPfad({ tagesnotizFormat: "JJJJ-MM-TT.md" }, "2026-11-05"), "Tagebuch/2026-11-05.md", "keine doppelte Endung");
});

test("Pfad → Tag: Standard, eigenes Format, Namen im Format, fremde Pfade", () => {
  const heute = "2026-11-05";
  assert.equal(V.tagesnotizDatum({}, "Tagebuch/2026-11-05.md", heute), "2026-11-05");
  assert.equal(V.tagesnotizDatum({}, "Tagebuch/2026-13-05.md", heute), null);
  assert.equal(V.tagesnotizDatum({}, "Tagebuch/2026-11-05 Notizen.md", heute), null);
  assert.equal(V.tagesnotizDatum({}, "Anderes/2026-11-05.md", heute), null);
  assert.equal(V.tagesnotizDatum({}, "Tagebuch/unter/2026-11-05.md", heute), null);
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "TT.MM.JJJJ" }, "Tagebuch/05.11.2026.md", heute), "2026-11-05");
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "T.M.JJ" }, "Tagebuch/5.1.26.md", heute), "2026-01-05");
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "T.M.JJ" }, "Tagebuch/05.1.26.md", heute), null, "Gegenprobe: so schreibt das Format diesen Tag nicht");
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "JJJJ/MM/JJJJ-MM-TT" }, "Tagebuch/2026/11/2026-11-05.md", heute), "2026-11-05");
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "JJJJ-MM-TT [Tag] WWWW" }, "Tagebuch/2026-11-05 Tag Donnerstag.md", heute), "2026-11-05");
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "JJJJ-MM-TT WWWW" }, "Tagebuch/2026-11-05 Donnerstag.md", heute), "2026-11-05", "Namen im Format: gefunden durch Probieren rund um heute");
  assert.equal(V.tagesnotizDatum({ tagesnotizFormat: "JJJJ-MM-TT WWWW" }, "Tagebuch/2026-11-05 Montag.md", heute), null);
});

test("Tagesgrenzen: der Kalendertag folgt der Zeitzone, auch rund um Mitternacht und die Zeitumstellung", () => {
  const tag = (d, zone) => V.renderVorlage("{{datum}} {{zeit}}", { jetzt: d, zone }).text;
  // 23:30 UTC am 30.10.2026: Berlin schon 31.10. 00:30, Los Angeles noch 30.10. 16:30
  const spaet = new Date("2026-10-30T23:30:00Z");
  assert.equal(tag(spaet, "Europe/Berlin"), "2026-10-31 00:30");
  assert.equal(tag(spaet, "America/Los_Angeles"), "2026-10-30 16:30");
  assert.equal(tag(spaet, "Asia/Tokyo"), "2026-10-31 08:30");
  // Ende der Sommerzeit 25.10.2026: 2:30 Uhr gibt es zweimal; der Kalendertag bleibt 25.10.
  assert.equal(tag(new Date("2026-10-25T00:30:00Z"), "Europe/Berlin"), "2026-10-25 02:30");
  assert.equal(tag(new Date("2026-10-25T01:30:00Z"), "Europe/Berlin"), "2026-10-25 02:30", "die zweite 2:30 Uhr");
  assert.equal(tag(new Date("2026-10-24T21:59:59Z"), "Europe/Berlin"), "2026-10-24 23:59");
  assert.equal(tag(new Date("2026-10-24T22:00:00Z"), "Europe/Berlin"), "2026-10-25 00:00");
  // Beginn der Sommerzeit 29.03.2026: 2:30 Uhr gibt es nicht
  assert.equal(tag(new Date("2026-03-29T00:59:59Z"), "Europe/Berlin"), "2026-03-29 01:59");
  assert.equal(tag(new Date("2026-03-29T01:00:00Z"), "Europe/Berlin"), "2026-03-29 03:00");
  // Die Tagesnotiz „heute“ nimmt dieselbe Regel wie die Werkstatt
  assert.equal(V.tagesnotizPfad({}, heuteIso(spaet, "Europe/Berlin")), "Tagebuch/2026-10-31.md");
  assert.equal(V.tagesnotizPfad({}, heuteIso(spaet, "America/Los_Angeles")), "Tagebuch/2026-10-30.md");
});

test("Tagesnotiz eines anderen Tages: {{datum}} ist der Tag der Notiz, nicht der Tag des Anlegens; die Uhrzeit bleibt die jetzige", () => {
  const r = V.baueNotizText({ vorlage: "---\ndatum: {{datum}}\n---\n# {{titel}}\n{{datum:WWWW}} {{zeit}}\n", titel: V.tagesTitel("2026-11-02"), jetzt: JETZT, zone: BERLIN, iso: "2026-11-02" });
  assert.equal(r.text, "---\ndatum: 2026-11-02\n---\n# Montag, 2. November 2026\nMontag 10:07\n");
  assert.throws(() => V.renderVorlage("x", { iso: "2026-02-30" }), TypeError);
  assert.equal(V.tagesTitel("2026-03-01"), "Sonntag, 1. März 2026");
});

test("imOrdner und Vorlagenname", () => {
  assert.equal(V.imOrdner("Vorlagen/Projekt.md", "Vorlagen"), true);
  assert.equal(V.imOrdner("vorlagen/Projekt.md", "Vorlagen"), true);
  assert.equal(V.imOrdner("Vorlagenx/Projekt.md", "Vorlagen"), false);
  assert.equal(V.imOrdner("Vorlagen.md", "Vorlagen"), false);
  assert.equal(V.imOrdner("a.md", ""), false);
  assert.equal(V.vorlagenName("Vorlagen/Ärger & Co.md"), "Ärger & Co");
});

test("Titel ohne Ersatz: eine leere Titelzeile wartet auf ihren Titel, auch wenn darunter Text steht", () => {
  assert.equal(V.titelAusText("# \n\nGedanke\n", { ersatz: false }), null);
  assert.equal(V.titelAusText("---\na: 1\n---\n#\ntext\n", { ersatz: false }), null);
  assert.equal(V.titelAusText("Text ohne Überschrift\n", { ersatz: false }), "Text ohne Überschrift");
  assert.equal(V.titelAusText("# Fertig\n", { ersatz: false }), "Fertig");
  assert.equal(V.titelAusText("```\n# \n```\n# Echt\n", { ersatz: false }), "Echt", "im Code-Block zählt nichts");
});

test("Neuer Vault bringt drei Beispiel-Vorlagen mit (Besprechung, Projekt, Tagesnotiz); alle füllen sich ohne übrig gebliebene Platzhalter und mit gültigem Kopf", async () => {
  const { vorlageDateien, VORLAGEN_ORDNER } = await import(pfad("gemeinsam", "vorlage.mjs"));
  const dateien = vorlageDateien({ name: "Test", heute: "2026-11-05" });
  const vorlagen = dateien.filter((d) => d.pfad.startsWith(VORLAGEN_ORDNER + "/"));
  assert.equal(VORLAGEN_ORDNER, "Vorlagen");
  assert.deepEqual(vorlagen.map((d) => d.pfad).sort(), ["Vorlagen/Besprechung.md", "Vorlagen/Projekt.md", "Vorlagen/Tagesnotiz.md"]);
  for (const v of vorlagen) {
    const r = V.baueNotizText({ vorlage: v.inhalt, titel: "Beispiel: Titel", jetzt: JETZT, zone: BERLIN });
    assert.doesNotMatch(r.text, /\{\{/, `${v.pfad}: Platzhalter übrig`);
    assert.ok(r.cursor !== null && r.cursor <= r.text.length);
    assert.match(r.text, /^---\n[\s\S]*?\n---\n# /, `${v.pfad}: Kopf oben, danach die Überschrift`);
    assert.equal(r.text.split("\n---\n").length, 2, `${v.pfad}: der Kopf steht genau einmal da`);
    assert.equal(V.titelAusText(r.text), v.pfad.includes("Tagesnotiz") ? V.tagesTitel("2026-11-05") : "Beispiel: Titel");
  }
  // die Tagesnotiz-Vorlage nimmt den Tag der Notiz, nicht den Tag des Anlegens
  const tag = vorlagen.find((d) => d.pfad.endsWith("Tagesnotiz.md"));
  const r = V.baueNotizText({ vorlage: tag.inhalt, titel: V.tagesTitel("2026-11-02"), jetzt: JETZT, zone: BERLIN, iso: "2026-11-02" });
  assert.match(r.text, /^---\ndatum: 2026-11-02\n---\n# Montag, 2\. November 2026\n/);
});

// ---- Review K1: nichts darf beim Titel-Suchen verloren gehen
test("K1: der Titel kommt aus der ersten Zeile, die nach dem Säubern nicht leer ist (Code, Listenreste, Trenner, Zitat, Nummern)", () => {
  const faelle = [
    ["# \n```\ncode\n```\n", "code"],
    ["# \n- [ ] \nText\n", "Text"],
    ["# \n***\nText\n", "Text"],
    ["# \n---\nText\n", "Text"],
    ["# \n> \nText\n", "Text"],
    ["# \n1. \nText\n", "Text"],
    ["# \n\n   \n* \n**\n__\nSpäter\n", "Später"],
  ];
  for (const [text, soll] of faelle) assert.equal(V.titelAusText(text), soll, JSON.stringify(text));
  assert.equal(V.titelAusText("---\na: 1\n---\n"), null, "nur Kopf: kein Titel — das Studio nimmt dann den Ersatztitel");
});

test("K1: hatInhalt — nur leere Titelzeilen und Leerraum zählen als leer", () => {
  assert.equal(V.hatInhalt("# \n"), false);
  assert.equal(V.hatInhalt("#\n\n  \n"), false);
  assert.equal(V.hatInhalt("# \n---\n"), true);
  assert.equal(V.hatInhalt("---\na: 1\n---\n# \n"), true, "Text nur im Kopf ist Inhalt");
  assert.equal(V.hatInhalt("# x"), true);
  assert.equal(V.ERSATZTITEL, "Unbenannt");
});

// ---- Review klein: YAML-Kontext
test("YAML: Titel in Anführungszeichen mitten im Wert, gemischte Werte, Zahlen-/Sonderformen und Zeilenumbruch-Zeichen bleiben gültig", () => {
  const lies = (kopfZeile, titel) => V.renderVorlage(`---\n${kopfZeile}\n---\n`, { titel, jetzt: JETZT, zone: BERLIN }).text.split("\n")[1];
  assert.equal(lies('title: "Meeting: {{titel}}"', 'Plan "B"'), 'title: "Meeting: Plan \\"B\\""');
  assert.equal(lies('title: "Meeting: {{titel}}"', "a: b"), 'title: "Meeting: a: b"');
  assert.equal(lies("title: 'Sitzung {{titel}}'", "Don't"), "title: 'Sitzung Don''t'");
  assert.equal(lies("title: Meeting: {{titel}}", "x"), 'title: "Meeting: x"', "gemischter Wert ohne Anführungszeichen: der ganze Wert wird gequotet");
  assert.equal(lies("title: Sitzung {{titel}}", "a: b"), 'title: "Sitzung a: b"');
  assert.equal(lies("title: Sitzung {{titel}}", "einfach"), "title: Sitzung einfach", "wo nichts stört, bleibt es unquotiert");
  for (const zahl of ["0x1F", ".5", "0o17", "1e3", "-.5", "+12", ".inf", "0b101"]) assert.equal(lies("t: {{titel}}", zahl), `t: "${zahl}"`, zahl);
  assert.equal(lies("t: {{titel}}", "a\u0085b"), 't: "a\\x85b"', "U+0085 ist in YAML ein Zeilenumbruch");
  assert.equal(lies("t: {{titel}}", "[x]"), 't: "[x]"');
});
