import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, utimesSync, symlinkSync, unlinkSync, renameSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { analysiere, parseKopf, wikilinkZiele, ersterAbsatz, typStil, titelAus } = await import(pfad("gemeinsam", "notizen.mjs"));

const HEUTE = "2026-10-24";
const JETZT = () => new Date("2026-10-24T12:00:00Z");
const vault = (d) => oeffneVault(d, { heute: HEUTE, jetzt: JETZT });
const holeNotiz = async (v, rel) => (await v.notizen()).notizen.find((n) => n.pfad === rel);
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };

// ---------- Kopf ----------
test("parseKopf: Text, Anführungszeichen, Inline-Liste, Block-Liste, Blocktext, Kommentare, CRLF, kein Kopf", () => {
  const t = [
    "---", "name: x", 'titel: "Mit: Doppelpunkt"', "typ: 'Thema'", "tags: [a, \"b, c\", d]", "auch: [[wiki/a]]", "verweise:", "  - \"[[b]]\"", "  - c", "leer:", "beschr: >",
    "  eins", "  zwei", "roh: |", "  a", "  b", "verschachtelt:", "  unter: 1", "kommentar: wert # nicht Teil", "ende: ok", "---", "# Titel", "",
  ].join("\r\n");
  const k = parseKopf(t);
  assert.equal(k.felder.name, "x");
  assert.equal(k.felder.titel, "Mit: Doppelpunkt");
  assert.equal(k.felder.typ, "Thema");
  assert.deepEqual(k.felder.tags, ["a", "b, c", "d"]);
  assert.equal(k.felder.auch, "[[wiki/a]]");
  assert.deepEqual(k.felder.verweise, ["[[b]]", "c"]);
  assert.equal(k.felder.leer, "");
  assert.equal(k.felder.beschr, "eins zwei");
  assert.equal(k.felder.roh, "a\nb");
  assert.equal(k.felder.verschachtelt, "");
  assert.equal(k.felder.kommentar, "wert");
  assert.equal(k.felder.ende, "ok");
  assert.equal(k.bis, t.split("\r\n").findIndex((z, i) => i > 0 && z === "---") + 1);
  assert.deepEqual(parseKopf("# nur Text\n"), { felder: {}, roh: {}, bis: 0 });
  assert.deepEqual(parseKopf("---\nnie geschlossen: 1\n"), { felder: {}, roh: {}, bis: 0 });
});

test("Titel: H1 > title/titel/name > Dateiname; H1 im Code-Block zählt nicht; Markdown wird entfernt", async () => {
  const d = tmp();
  schreibe(d, "a.md", "---\nname: n\n---\n\n# **Fette** `Überschrift` mit [Link](http://x) und [[ziel|Alias]]\n");
  schreibe(d, "b.md", "---\ntitel: Aus dem Kopf\n---\nText ohne Überschrift\n");
  schreibe(d, "c.md", "---\nname: nur-name\n---\ntext\n");
  schreibe(d, "dateiname-ohne-h1.md", "text\n");
  schreibe(d, "code.md", "```sh\n# Kommentar, keine Überschrift\n```\n\n# Echter Titel\n");
  schreibe(d, "notiz.txt", "Nur Text\n");
  const v = vault(d);
  assert.equal((await holeNotiz(v, "a.md")).titel, "Fette Überschrift mit Link und Alias");
  assert.equal((await holeNotiz(v, "b.md")).titel, "Aus dem Kopf");
  assert.equal((await holeNotiz(v, "c.md")).titel, "nur-name");
  assert.equal((await holeNotiz(v, "dateiname-ohne-h1.md")).titel, "dateiname-ohne-h1");
  assert.equal((await holeNotiz(v, "code.md")).titel, "Echter Titel");
  assert.equal((await holeNotiz(v, "notiz.txt")).titel, "notiz");
  assert.equal(titelAus("x.md", "# Eins\n# Zwei\n"), "Eins");
  // dieselbe Regel in Suche und Palette (/api/baum)
  const baum = v.baum().eintraege.find((e) => e.pfad === "code.md");
  assert.equal(baum.titel, "Echter Titel");
});

// ---------- Vorschau ----------
test("Vorschau: description gewinnt; sonst erster Absatz ohne Überschrift/Code/Tabelle; Markdown entfernt; ~200 Zeichen", async () => {
  assert.equal(ersterAbsatz(["# Titel", "", "Erster **Absatz** mit [[a/b|Alias]], [[x/y]] und `Code`.", "geht weiter", "", "Zweiter."]), "Erster Absatz mit Alias, y und Code. geht weiter");
  assert.equal(ersterAbsatz(["# T", "```", "code", "```", "| a | b |", "|---|---|", "![bild](x.png)", "---", "- [ ] Aufgabe eins", "- zwei"]), "Aufgabe eins zwei");
  assert.equal(ersterAbsatz(["> [!hinweis] Wichtig", "> Zeile"]), "Wichtig Zeile");
  assert.equal(ersterAbsatz(["1. erste", "2) zweite"]), "erste zweite");
  assert.equal(ersterAbsatz(["# nur Titel"]), "");
  const lang = "Wort ".repeat(80).trim();
  const kurz = ersterAbsatz([lang]);
  assert.ok(kurz.length <= 201 && kurz.endsWith("…"), kurz.length + " " + kurz.slice(-10));
  const d = tmp();
  schreibe(d, "mit.md", "---\ndescription: \"Kurzbeschreibung mit *Kursiv*\"\n---\n# T\n\nAbsatz, der nicht gebraucht wird.\n");
  schreibe(d, "ohne.md", "---\nname: x\n---\n# T\n\nAbsatz **fett**.\n");
  const v = vault(d);
  assert.equal((await holeNotiz(v, "mit.md")).vorschau, "Kurzbeschreibung mit Kursiv");
  assert.equal((await holeNotiz(v, "ohne.md")).vorschau, "Absatz fett.");
});

// ---------- Typ, Bereich, Stufe, generiert ----------
test("Typ: typ > type, klein, [[Link]] und Liste werden aufgelöst", () => {
  assert.equal(analysiere("a.md", "---\ntyp: Thema\ntype: Projekt\n---\n", HEUTE).typ, "thema");
  assert.equal(analysiere("a.md", "---\ntype: Projekt\n---\n", HEUTE).typ, "projekt");
  assert.equal(analysiere("a.md", '---\ntype: "[[Person]]"\n---\n', HEUTE).typ, "person");
  assert.equal(analysiere("a.md", "---\ntype: [Quelle, Thema]\n---\n", HEUTE).typ, "quelle");
  assert.equal(analysiere("a.md", "# nur Text\n", HEUTE).typ, "");
});

test("Bereich: inbox · wissen · archiv (90_*, archiviert) · notiz; _-Ordner im Posteingang sind maschine", async () => {
  const d = tmp();
  schreibe(d, "00_inbox/lose.md", "# Lose\n");
  schreibe(d, "00_inbox/_rueckfragen/rf-1.md", "---\ntyp: rueckfrage\n---\n# RF\n");
  schreibe(d, "09_wiki/firma/thema_a.md", "# A\n");
  schreibe(d, "09_wiki/_index.md", "# Verzeichnis\n");
  schreibe(d, "90_archiv/alt.md", "# Alt\n");
  schreibe(d, "projekte/neu.md", "# Neu\n");
  schreibe(d, "projekte/weg.md", "---\narchiviert: true\n---\n# Weg\n");
  schreibe(d, "09_wiki/firma/thema_b.md", "---\narchived: yes\n---\n# B\n");
  const v = vault(d);
  const nach = Object.fromEntries((await v.notizen()).notizen.map((n) => [n.pfad, n.bereich]));
  assert.deepEqual(nach, {
    "00_inbox/lose.md": "inbox", "00_inbox/_rueckfragen/rf-1.md": "maschine", "09_wiki/firma/thema_a.md": "wissen", "09_wiki/_index.md": "wissen",
    "90_archiv/alt.md": "archiv", "projekte/neu.md": "notiz", "projekte/weg.md": "archiv", "09_wiki/firma/thema_b.md": "archiv",
  });
});

test("Bereich: Vault ohne 00_inbox — lose Notizen ohne Typ und ohne Verknüpfung sind Posteingang", async () => {
  const d = tmp();
  schreibe(d, "lose.md", "# Lose\n");
  schreibe(d, "typisiert.md", "---\ntyp: thema\n---\n# T\n");
  schreibe(d, "verlinkt-a.md", "# A\n[[verlinkt-b]]\n");
  schreibe(d, "verlinkt-b.md", "# B\n");
  schreibe(d, "ordner/andere-lose.md", "# Andere\n");
  const v = vault(d);
  const nach = Object.fromEntries((await v.notizen()).notizen.map((n) => [n.pfad, n.bereich]));
  assert.deepEqual(nach, { "lose.md": "inbox", "typisiert.md": "notiz", "verlinkt-a.md": "notiz", "verlinkt-b.md": "notiz", "ordner/andere-lose.md": "inbox" });
  // gibt es 00_inbox (auch leer), gilt die Ordnerregel
  mkdirSync(join(d, "00_inbox"));
  const nach2 = Object.fromEntries((await v.notizen()).notizen.map((n) => [n.pfad, n.bereich]));
  assert.equal(nach2["lose.md"], "notiz");
});

test("Bereich: maschine (00_inbox/_*/) · vorlage (01_vorlagen/) · system (CLAUDE/AGENTS/GEMINI.md in der Wurzel); Vorrang archiv > maschine > vorlage > system > inbox", async () => {
  const d = tmp();
  schreibe(d, "00_inbox/lose.md", "# Lose\n");
  schreibe(d, "00_inbox/_warten.md", "# Datei mit Unterstrich, kein Ordner\n");
  schreibe(d, "00_inbox/_rueckfragen/rf-1.md", "---\ntyp: rueckfrage\n---\n# RF\n");
  schreibe(d, "00_inbox/_vorschlaege/tief/unter/v-1.md", "# V\n");
  schreibe(d, "00_inbox/_lektionen/alt.md", "---\narchiviert: true\n---\n# Archiviert vor maschine\n");
  schreibe(d, "01_vorlagen/notiz.md", "# Vorlage\n");
  schreibe(d, "01_vorlagen/unter/recherche.md", "# Tief\n");
  schreibe(d, "01_vorlagen/alt.md", "---\narchived: yes\n---\n# Archiviert vor vorlage\n");
  schreibe(d, "01_vorlagen/_index.md", "# Verzeichnis\n");
  schreibe(d, "claude.md", "@AGENTS.md\n"); // klein geschrieben
  schreibe(d, "AGENTS.md", "# Agenten\n");
  schreibe(d, "Gemini.md", "# Gemini\n");
  schreibe(d, "GEMINI.txt", "Nur Text\n"); // kein Markdown
  schreibe(d, "README.md", "# Readme\n");
  schreibe(d, "projekte/CLAUDE.md", "# Projektregeln\n"); // nicht in der Wurzel
  schreibe(d, "09_wiki/_index.md", "# Verzeichnis\n");
  const n = Object.fromEntries((await vault(d).notizen()).notizen.map((x) => [x.pfad, x]));
  assert.deepEqual(Object.fromEntries(Object.entries(n).map(([p, x]) => [p, x.bereich])), {
    "00_inbox/lose.md": "inbox", "00_inbox/_warten.md": "inbox", "00_inbox/_rueckfragen/rf-1.md": "maschine", "00_inbox/_vorschlaege/tief/unter/v-1.md": "maschine",
    "00_inbox/_lektionen/alt.md": "archiv", "01_vorlagen/notiz.md": "vorlage", "01_vorlagen/unter/recherche.md": "vorlage", "01_vorlagen/alt.md": "archiv",
    "01_vorlagen/_index.md": "vorlage", "claude.md": "system", "AGENTS.md": "system", "Gemini.md": "system", "GEMINI.txt": "notiz", "README.md": "notiz",
    "projekte/CLAUDE.md": "notiz", "09_wiki/_index.md": "wissen",
  });
  // generierte Dateien behalten ihre Markierung zusätzlich zum Bereich
  assert.equal(n["01_vorlagen/_index.md"].generiert, true);
  assert.equal(n["09_wiki/_index.md"].generiert, true);
  assert.equal(n["01_vorlagen/notiz.md"].generiert, false);
});

test("Bereich: Vault ohne 00_inbox — vorlage und system gehen vor der Regel für lose Notizen", async () => {
  const d = tmp();
  schreibe(d, "README.md", "# Readme\n");
  schreibe(d, "CLAUDE.md", "# Regeln\n");
  schreibe(d, "01_vorlagen/leer.md", "# Vorlage\n");
  schreibe(d, "ordner/lose.md", "# Lose\n");
  const nach = Object.fromEntries((await vault(d).notizen()).notizen.map((n) => [n.pfad, n.bereich]));
  assert.deepEqual(nach, { "README.md": "inbox", "CLAUDE.md": "system", "01_vorlagen/leer.md": "vorlage", "ordner/lose.md": "inbox" });
});

test("Stufe nur im Wiki; generiert-Markierung (Namen, Kopfzeile)", async () => {
  const d = tmp();
  const kopf = "---\nname: x\ntyp: thema\nstand: 2026-10-01\n---\n";
  schreibe(d, "09_wiki/w/thema_belegt.md", kopf + "# Belegt\n\n- Fakt · Stand 01.10.2026 · [[w/belege/2026-10/b1]]\n");
  schreibe(d, "09_wiki/w/thema_streit.md", kopf + "# Streit\n\n> [!KONFLIKT] offen — Du entscheidest\n");
  schreibe(d, "09_wiki/w/thema_leer.md", "# Leer\n\nnur Text\n");
  schreibe(d, "09_wiki/_schema.md", "# Schema\n");
  schreibe(d, "09_wiki/w/_w.md", "# w (generiert — nicht editieren)\n");
  schreibe(d, "INDEX.md", "# Index\n");
  schreibe(d, "notizen/eigen.md", "# Eigen\n");
  schreibe(d, "notizen/vom-werkzeug.md", "# Werkzeugdatei\n\n<!-- generiert — nicht editieren -->\n");
  schreibe(d, "notizen/spaet.md", "# a\n\n\n\n\n<!-- generiert — nicht editieren -->\n");
  const v = vault(d);
  const n = Object.fromEntries((await v.notizen()).notizen.map((x) => [x.pfad, x]));
  assert.equal(n["09_wiki/w/thema_belegt.md"].stufe, "gruen");
  assert.equal(n["09_wiki/w/thema_streit.md"].stufe, "rot");
  assert.equal(n["09_wiki/w/thema_leer.md"].stufe, "ohne");
  assert.equal(n["09_wiki/_schema.md"].stufe, "grau");
  assert.equal(n["notizen/eigen.md"].stufe, null);
  assert.equal(n["INDEX.md"].stufe, null);
  assert.deepEqual(Object.entries(n).filter(([, x]) => x.generiert).map(([p]) => p).sort(), ["09_wiki/w/_w.md", "INDEX.md", "notizen/vom-werkzeug.md"].sort());
  // dieselbe Antwort wie /api/pruefung
  assert.equal(v.pruefung("09_wiki/w/thema_belegt.md").stufe, n["09_wiki/w/thema_belegt.md"].stufe);
});

// ---------- Links ----------
test("wikilinkZiele: Alias, Anker, Einbettung, Tabellen-Pipe, Inline-Code", () => {
  assert.deepEqual(wikilinkZiele("[[a]] und [[b/c|Text]] und [[d#Abschnitt]] und [[e^block]] und ![[f]] und [[g\\|alias]] und `[[h]]` und [[#nur-anker]] und [[ ]]"),
    ["a", "b/c", "d", "e", "f", "g"]);
});

test("Links: Pfad (voll und Endstück), Dateiname, Titel, Alias, relativ, Groß/klein; Lose fallen weg; Felder zählen mit; Code zählt nicht", async () => {
  const d = tmp();
  schreibe(d, "09_wiki/firma/amazon/thema_preise.md", "---\nname: preise\nverwandt: \"[[entitaet_amazon]]\"\nersetzt_durch: \"[[firma/amazon/thema_preise-neu]]\"\n---\n# Preise\n");
  schreibe(d, "09_wiki/firma/amazon/thema_preise-neu.md", "# Preise neu\n");
  schreibe(d, "09_wiki/firma/amazon/entitaet_amazon.md", "---\nauch_genannt: [\"AMZ\", \"Amazon DE\"]\n---\n# Amazon\n");
  schreibe(d, "09_wiki/firma/belege/2026-10/b1.md", "# Beleg\n");
  schreibe(d, "projekte/start.md", [
    "# Start", "",
    "Pfad: [[09_wiki/firma/amazon/thema_preise]]  Endstück: [[amazon/thema_preise-neu]]  Name: [[THEMA_PREISE]]  Mit Endung: [[thema_preise.md]]",
    "Titel: [[amazon]]  Alias: [[AMZ]]  Beleg: [[firma/belege/2026-10/b1]]  Lose: [[gibt-es-nicht]]  Anker: [[thema_preise#Abschnitt|Text]]",
    "Relativ: [[./nachbar]]  [[../projekte/nachbar]]  Bild: ![[bild.png]]", "",
    "```", "[[im-code-block]]", "```", "", "Inline `[[im-inline-code]]` zählt nicht.",
  ].join("\n"));
  schreibe(d, "projekte/nachbar.md", "# Nachbar\n");
  schreibe(d, "im-code-block.md", "# Im Code\n");
  schreibe(d, "im-inline-code.md", "# Inline\n");
  const v = vault(d);
  const start = await holeNotiz(v, "projekte/start.md");
  assert.deepEqual(start.links, [
    "09_wiki/firma/amazon/thema_preise.md", "09_wiki/firma/amazon/thema_preise-neu.md", "09_wiki/firma/amazon/entitaet_amazon.md",
    "09_wiki/firma/belege/2026-10/b1.md", "projekte/nachbar.md",
  ]);
  const preise = await holeNotiz(v, "09_wiki/firma/amazon/thema_preise.md");
  assert.deepEqual(preise.links, ["09_wiki/firma/amazon/entitaet_amazon.md", "09_wiki/firma/amazon/thema_preise-neu.md"]);
});

test("Links: gleicher Dateiname in mehreren Ordnern — gleicher Ordner gewinnt, sonst kürzester Pfad; ein neues Ziel löst ein loses Ziel auf", async () => {
  const d = tmp();
  schreibe(d, "a/x/seite.md", "# Seite A\n[[seite]]\n");
  schreibe(d, "b/seite.md", "# Seite B\n");
  schreibe(d, "c/anders.md", "# Anders\n[[seite]]\n");
  schreibe(d, "d/tief/er/seite.md", "# Seite D\n");
  schreibe(d, "e/lose.md", "# Lose\n[[kommt-noch]]\n");
  const v = vault(d);
  assert.deepEqual((await holeNotiz(v, "a/x/seite.md")).links, ["a/x/seite.md"], "gleicher Ordner (auch die Notiz selbst)");
  assert.deepEqual((await holeNotiz(v, "c/anders.md")).links, ["b/seite.md"], "kürzester Pfad");
  assert.deepEqual((await holeNotiz(v, "e/lose.md")).links, []);
  schreibe(d, "kommt-noch.md", "# Kommt noch\n");
  assert.deepEqual((await holeNotiz(v, "e/lose.md")).links, ["kommt-noch.md"]);
});

// ---------- Orte ----------
test("Gesperrte Orte, fremde Dateien und Links nach draußen kommen nicht in den Index", async () => {
  const d = repo();
  schreibe(d, ".tools/skill.md", "# Kit\n");
  schreibe(d, ".logs/x.md", "# Log\n");
  schreibe(d, "node_modules/p/readme.md", "# Paket\n");
  schreibe(d, ".versteckt.md", "# Versteckt\n");
  schreibe(d, "bild.png", "x");
  schreibe(d, "daten.json", "{}");
  schreibe(d, "ok/notiz.md", "# Ok\n");
  const aussen = tmp("brain-aussen-");
  schreibe(aussen, "geheim.md", "# Geheim\n");
  symlinkSync(join(aussen, "geheim.md"), join(d, "ok", "link-raus.md"));
  symlinkSync(join(d, "ok", "notiz.md"), join(d, "ok", "link-rein.md"));
  symlinkSync(aussen, join(d, "ordner-link"));
  const pfade = (await vault(d).notizen()).notizen.map((n) => n.pfad).sort();
  assert.deepEqual(pfade, ["ok/link-rein.md", "ok/notiz.md", "start.md"]);
});

// ---------- Erstellt (Git) ----------
const gDatum = (cwd, datum, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org", GIT_AUTHOR_DATE: datum, GIT_COMMITTER_DATE: datum } });

test("erstellt: erster Commit je Datei, Umbenennung behält den Anfang; Ungetracktes und Nicht-Repo fallen auf die Dateizeit zurück", async () => {
  const d = tmp();
  g(d, "init", "-q", "-b", "main");
  schreibe(d, "a.md", "# A\n\nein längerer Text, damit die Umbenennung erkannt wird.\nzweite Zeile\ndritte Zeile\n");
  gDatum(d, "2026-10-01T10:00:00Z", "add", "--", "a.md"); gDatum(d, "2026-10-01T10:00:00Z", "commit", "-q", "-m", "a");
  schreibe(d, "b.md", "# B\n");
  gDatum(d, "2026-10-05T10:00:00Z", "add", "--", "b.md"); gDatum(d, "2026-10-05T10:00:00Z", "commit", "-q", "-m", "b");
  mkdirSync(join(d, "neu"));
  gDatum(d, "2026-10-10T10:00:00Z", "mv", "a.md", "neu/a-umbenannt.md"); gDatum(d, "2026-10-10T10:00:00Z", "commit", "-q", "-m", "umbenannt");
  writeFileSync(join(d, "b.md"), "# B\n\nGeändert.\n");
  gDatum(d, "2026-10-11T10:00:00Z", "commit", "-q", "-am", "b geändert");
  schreibe(d, "frisch.md", "# Frisch\n"); // nie committet
  const v = vault(d);
  const n = Object.fromEntries((await v.notizen()).notizen.map((x) => [x.pfad, x]));
  assert.equal(n["neu/a-umbenannt.md"].erstellt, "2026-10-01T10:00:00.000Z");
  assert.equal(n["b.md"].erstellt, "2026-10-05T10:00:00.000Z");
  assert.ok(Math.abs(Date.parse(n["frisch.md"].erstellt) - Date.now()) < 60_000, "ungetrackt: Dateizeit");
  // neuer Commit → Karte wächst inkrementell
  schreibe(d, "c.md", "# C\n");
  gDatum(d, "2026-10-20T10:00:00Z", "add", "--", "c.md"); gDatum(d, "2026-10-20T10:00:00Z", "commit", "-q", "-m", "c");
  assert.equal((await holeNotiz(v, "c.md")).erstellt, "2026-10-20T10:00:00.000Z");
  assert.equal((await holeNotiz(v, "b.md")).erstellt, "2026-10-05T10:00:00.000Z");
  // gelöscht und neu angelegt = neues Entstehungsdatum
  gDatum(d, "2026-10-21T10:00:00Z", "rm", "-q", "--", "c.md"); gDatum(d, "2026-10-21T10:00:00Z", "commit", "-q", "-m", "c weg");
  schreibe(d, "c.md", "# C neu\n");
  gDatum(d, "2026-10-22T10:00:00Z", "add", "--", "c.md"); gDatum(d, "2026-10-22T10:00:00Z", "commit", "-q", "-m", "c neu");
  assert.equal((await holeNotiz(v, "c.md")).erstellt, "2026-10-22T10:00:00.000Z");
  // Nicht-Repo: nur Dateizeit
  const d2 = tmp();
  schreibe(d2, "x.md", "# X\n");
  const e = (await holeNotiz(vault(d2), "x.md")).erstellt;
  assert.ok(e && Math.abs(Date.parse(e) - Date.now()) < 60_000);
});

// ---------- Geändert (Git) ----------
test("geaendert: saubere Dateien zeigen den letzten Commit (nicht die Dateizeit), geänderte/vorgemerkte/neue die Dateizeit; Umbenennung behält die Zeiten; Klon", async () => {
  const TA = "2026-09-15T10:00:00Z", T1 = "2026-10-01T10:00:00Z", T2 = "2026-10-05T10:00:00Z", T3 = "2026-10-10T10:00:00Z", T4 = "2026-10-20T10:00:00Z", T5 = "2026-10-21T10:00:00Z";
  const zeit = (t) => new Date(t).toISOString();
  const lang = (t) => `# ${t}\n\nein längerer Text, damit eine Umbenennung erkannt wird.\nzweite Zeile\ndritte Zeile\nvierte Zeile\nfünfte Zeile\n`;
  const d = tmp();
  g(d, "init", "-q", "-b", "main");
  g(d, "config", "core.precomposeunicode", "false"); // Git meldet Namen so, wie sie gespeichert sind (hier NFD)
  schreibe(d, "A\u0308rger.md", lang("Ärger")); // Dateiname in NFD (Git und Index-Lauf vergleichen in NFC)
  gDatum(d, TA, "add", "--", "A\u0308rger.md"); gDatum(d, TA, "commit", "-q", "-m", "umlaut");
  const dateien1 = ["rein.md", "a.md", "b.md", "c.md", "d.md", "e.md"];
  for (const p of dateien1) schreibe(d, p, lang(p));
  gDatum(d, T1, "add", "--", ...dateien1); gDatum(d, T1, "commit", "-q", "-m", "eins");
  writeFileSync(join(d, "a.md"), lang("a.md") + "Neu im zweiten Commit.\n");
  gDatum(d, T2, "commit", "-q", "-am", "a geändert");
  mkdirSync(join(d, "neu"));
  gDatum(d, T3, "mv", "c.md", "neu/c-umbenannt.md"); // reine Umbenennung
  gDatum(d, T3, "mv", "d.md", "neu/d-umbenannt.md");
  writeFileSync(join(d, "neu/d-umbenannt.md"), lang("d.md") + "Im selben Commit geändert.\n"); // Umbenennung mit Änderung
  gDatum(d, T3, "add", "--", "neu/d-umbenannt.md"); gDatum(d, T3, "commit", "-q", "-m", "umbenannt");
  // „touch“: alle Dateizeiten sind neu und stimmen mit keinem Commit überein
  const vorEinerSekunde = new Date(Date.now() - 1000);
  const alle = ["rein.md", "a.md", "b.md", "e.md", "neu/c-umbenannt.md", "neu/d-umbenannt.md", "A\u0308rger.md"];
  for (const p of alle) utimesSync(join(d, p), vorEinerSekunde, vorEinerSekunde);

  const v = vault(d);
  const hole = async () => Object.fromEntries((await v.notizen()).notizen.map((x) => [x.pfad.normalize("NFC"), x]));
  let n = await hole();
  assert.equal(n["rein.md"].geaendert, zeit(T1));
  assert.equal(n["b.md"].geaendert, zeit(T1), "unverändert seit dem ersten Commit");
  assert.equal(n["a.md"].geaendert, zeit(T2)); assert.equal(n["a.md"].erstellt, zeit(T1));
  assert.equal(n["Ärger.md"].geaendert, zeit(TA), "Umlaut-Dateiname in anderer Normalform"); assert.equal(n["Ärger.md"].erstellt, zeit(TA));
  assert.equal(n["neu/c-umbenannt.md"].geaendert, zeit(T1), "reine Umbenennung: beide Zeiten bleiben"); assert.equal(n["neu/c-umbenannt.md"].erstellt, zeit(T1));
  assert.equal(n["neu/d-umbenannt.md"].geaendert, zeit(T3), "Umbenennung mit Änderung: der Commit zählt"); assert.equal(n["neu/d-umbenannt.md"].erstellt, zeit(T1));
  assert.notEqual(n["rein.md"].geaendert, statSync(join(d, "rein.md")).mtime.toISOString(), "nicht die Dateizeit");
  assert.equal((await v.notizKontext("a.md")).info.geaendert, zeit(T2), "Eigenschaften zeigen dieselbe Zeit wie die Liste");

  // neue Commits werden inkrementell nachgeladen: Änderung und Umbenennung (beide Zeiten wandern mit)
  writeFileSync(join(d, "rein.md"), lang("rein.md") + "Später geändert.\n");
  gDatum(d, T4, "commit", "-q", "-am", "rein geändert");
  gDatum(d, T5, "mv", "a.md", "a-neu.md"); gDatum(d, T5, "commit", "-q", "-m", "a umbenannt");
  n = await hole();
  assert.equal(n["rein.md"].geaendert, zeit(T4)); assert.equal(n["rein.md"].erstellt, zeit(T1));
  assert.equal(n["a-neu.md"].geaendert, zeit(T2)); assert.equal(n["a-neu.md"].erstellt, zeit(T1));
  assert.equal(n["a.md"], undefined);

  // Arbeitsstand: b ungesichert geändert, e vorgemerkt, frisch.md neu (ungetrackt) → Dateizeit
  const gestern = new Date("2026-10-23T12:00:00Z");
  writeFileSync(join(d, "b.md"), lang("b.md") + "Ungesichert.\n");
  writeFileSync(join(d, "e.md"), lang("e.md") + "Vorgemerkt.\n"); g(d, "add", "--", "e.md");
  schreibe(d, "frisch.md", "# Frisch\n");
  for (const p of ["b.md", "e.md", "frisch.md"]) utimesSync(join(d, p), gestern, gestern);
  const vorgestern = new Date("2026-10-22T12:00:00Z");
  writeFileSync(join(d, "A\u0308rger.md"), lang("Ärger") + "Ungesichert.\n"); utimesSync(join(d, "A\u0308rger.md"), vorgestern, vorgestern);
  const liste = (await v.notizen()).notizen;
  n = Object.fromEntries(liste.map((x) => [x.pfad.normalize("NFC"), x]));
  for (const p of ["b.md", "e.md", "frisch.md"]) assert.equal(n[p].geaendert, zeit(gestern), `${p}: Dateizeit`);
  assert.equal(n["Ärger.md"].geaendert, zeit(vorgestern), "Umlaut-Dateiname: Status und Index vergleichen in NFC");
  assert.equal(n["b.md"].erstellt, zeit(T1), "erstellt kommt weiter aus Git");
  assert.equal(n["rein.md"].geaendert, zeit(T4));
  // Sortierung und Ansicht „zuletzt“ (7 Tage vor JETZT = ab 17.10.) benutzen dieselbe Zeit
  assert.deepEqual(liste.map((x) => x.pfad.normalize("NFC")), ["b.md", "e.md", "frisch.md", "Ärger.md", "rein.md", "neu/d-umbenannt.md", "a-neu.md", "neu/c-umbenannt.md"]);
  assert.deepEqual(liste.filter((x) => x.ansichten.includes("zuletzt")).map((x) => x.pfad.normalize("NFC")), ["b.md", "e.md", "frisch.md", "Ärger.md", "rein.md"]);
  assert.equal((await v.ansichten()).ansichten.find((a) => a.id === "zuletzt").anzahl, 5);
  // gleichzeitige Anfragen teilen sich den laufenden Status und liefern untereinander stimmige Zahlen
  const [pn, pa] = await Promise.all([v.notizen(), v.ansichten(), v.typen(), v.notizKontext("rein.md")]);
  assert.deepEqual(pn.notizen.map((x) => [x.pfad, x.geaendert]), liste.map((x) => [x.pfad, x.geaendert]));
  assert.equal(pa.ansichten.find((a) => a.id === "zuletzt").anzahl, 5);

  // frischer Klon: alle Dateien haben die Zeit des Klonens, die Notizen behalten die Zeit ihrer Commits
  const klon = join(tmp("brain-klon-"), "klon");
  g(d, "clone", "-q", "-c", "core.precomposeunicode=false", d, klon); // gleiche Namensform wie im Original, sonst hielte Git den NFD-Namen selbst für ungetrackt
  const vk = vault(klon);
  const k = Object.fromEntries((await vk.notizen()).notizen.map((x) => [x.pfad.normalize("NFC"), x]));
  assert.equal(k["rein.md"].geaendert, zeit(T4)); assert.equal(k["a-neu.md"].geaendert, zeit(T2)); assert.equal(k["neu/c-umbenannt.md"].geaendert, zeit(T1));
  assert.equal(k["e.md"].geaendert, zeit(T1), "im Klon steht der eingecheckte Stand");
  assert.equal((await vk.ansichten()).ansichten.find((a) => a.id === "zuletzt").anzahl, 1, "nur rein.md ist jünger als 7 Tage");
});

test("geaendert: ohne Git, ohne Commit und bei unlesbarem Status gilt die Dateizeit; erstellt bleibt aus Git", async () => {
  const mtimeVon = (d, p) => statSync(join(d, p)).mtime.toISOString();
  // kein Repo
  const d1 = tmp();
  schreibe(d1, "x.md", "# X\n");
  assert.equal((await holeNotiz(vault(d1), "x.md")).geaendert, mtimeVon(d1, "x.md"));
  // Repo ohne Commit
  const d2 = tmp();
  g(d2, "init", "-q", "-b", "main");
  schreibe(d2, "x.md", "# X\n");
  assert.equal((await holeNotiz(vault(d2), "x.md")).geaendert, mtimeVon(d2, "x.md"));
  // Status schlägt fehl (kaputter Index): Dateizeit, die Karte (nur Verlauf) funktioniert weiter
  const d3 = tmp();
  g(d3, "init", "-q", "-b", "main");
  schreibe(d3, "y.md", "# Y\n");
  gDatum(d3, "2026-10-01T10:00:00Z", "add", "--", "y.md"); gDatum(d3, "2026-10-01T10:00:00Z", "commit", "-q", "-m", "y");
  const heil = await holeNotiz(vault(d3), "y.md");
  assert.equal(heil.geaendert, "2026-10-01T10:00:00.000Z");
  writeFileSync(join(d3, ".git", "index"), "kaputt");
  const kaputt = await holeNotiz(vault(d3), "y.md");
  assert.equal(kaputt.geaendert, mtimeVon(d3, "y.md"), "ohne Status keine Git-Änderungszeit");
  assert.equal(kaputt.erstellt, "2026-10-01T10:00:00.000Z");
  // Eine saubere Datei, die jünger ist als der Status (hier: Zeit in der Zukunft), behält ihre Dateizeit — der Status gilt für sie nicht
  const d4 = tmp();
  g(d4, "init", "-q", "-b", "main");
  schreibe(d4, "z.md", "# Z\n"); schreibe(d4, "alt.md", "# Alt\n");
  gDatum(d4, "2026-10-01T10:00:00Z", "add", "--", "z.md", "alt.md"); gDatum(d4, "2026-10-01T10:00:00Z", "commit", "-q", "-m", "z");
  const spaeter = new Date(Date.now() + 3600_000);
  utimesSync(join(d4, "z.md"), spaeter, spaeter);
  const n4 = Object.fromEntries((await vault(d4).notizen()).notizen.map((x) => [x.pfad, x]));
  assert.equal(n4["z.md"].geaendert, spaeter.toISOString());
  assert.equal(n4["alt.md"].geaendert, "2026-10-01T10:00:00.000Z");
});

// ---------- Cache ----------
test("Cache: geänderte, neue und gelöschte Dateien erscheinen sofort; unveränderte werden nicht neu gelesen", async () => {
  const d = tmp();
  schreibe(d, "a.md", "# Alt\n");
  schreibe(d, "b.md", "# B\n");
  const v = vault(d);
  assert.equal((await holeNotiz(v, "a.md")).titel, "Alt");
  // gleiche Größe, neue Änderungszeit → neu gelesen
  writeFileSync(join(d, "a.md"), "# Neu\n");
  const st = statSync(join(d, "a.md"));
  utimesSync(join(d, "a.md"), st.atime, new Date(st.mtimeMs + 5000));
  assert.equal((await holeNotiz(v, "a.md")).titel, "Neu");
  schreibe(d, "c.md", "# C\n");
  unlinkSync(join(d, "b.md"));
  assert.deepEqual((await v.notizen()).notizen.map((n) => n.pfad).sort(), ["a.md", "c.md"]);
  // Umbenennen = alter Pfad weg, neuer da
  renameSync(join(d, "c.md"), join(d, "c2.md"));
  assert.deepEqual((await v.notizen()).notizen.map((n) => n.pfad).sort(), ["a.md", "c2.md"]);
});

test("Mehr als 1 MB: nur der Anfang wird ausgewertet, Eintrag bleibt", async () => {
  const d = tmp();
  schreibe(d, "gross.md", "---\ntyp: quelle\n---\n# Große Datei\n\n" + "x".repeat(1_200_000));
  const n = await holeNotiz(vault(d), "gross.md");
  assert.equal(n.titel, "Große Datei"); assert.equal(n.typ, "quelle");
});

// ---------- Kontext ----------
test("Kontext: Felder, Beziehungen (nur Kopf-Felder mit [[…]]), Verweise im Text, Rückverweise ohne generierte Verzeichnisse, Info", async () => {
  const d = tmp();
  schreibe(d, "09_wiki/w/thema_a.md", "---\nname: a\ntyp: thema\nquellen: [\"x\", \"y\"]\nprojekt: \"[[projekt_p]]\"\nverwandt:\n  - \"[[thema_b]]\"\n  - \"[[gibt-es-nicht]]\"\nbeschreibung: nur Text\n---\n# Thema A\n\nText mit [[thema_b]] und [[thema_a]].\n```\n[[im-code]]\n```\n");
  schreibe(d, "09_wiki/w/thema_b.md", "# B\n\nzurück zu [[thema_a]]\n");
  schreibe(d, "projekte/projekt_p.md", "# Projekt P\n\n[[thema_a]]\n");
  schreibe(d, "09_wiki/_index.md", "# Index (generiert — nicht editieren)\n- [[thema_a]]\n");
  schreibe(d, "INDEX.md", "# Index\n[[thema_a]]\n");
  const v = vault(d);
  const k = await v.notizKontext("09_wiki/w/thema_a.md");
  assert.deepEqual(k.felder.quellen, ["x", "y"]);
  assert.equal(k.felder.typ, "thema");
  assert.deepEqual(k.beziehungen, [{ feld: "projekt", ziele: ["projekte/projekt_p.md"] }, { feld: "verwandt", ziele: ["09_wiki/w/thema_b.md", "gibt-es-nicht"] }]);
  assert.deepEqual(k.verweise, ["09_wiki/w/thema_b.md", "09_wiki/w/thema_a.md"]);
  assert.deepEqual(k.rueckverweise, [{ pfad: "09_wiki/w/thema_b.md", titel: "B" }, { pfad: "projekte/projekt_p.md", titel: "Projekt P" }]);
  assert.equal(k.info.bytes, statSync(join(d, "09_wiki/w/thema_a.md")).size);
  assert.ok(k.info.woerter > 5); assert.ok(k.info.geaendert); assert.ok(k.info.erstellt);
  assert.deepEqual(Object.keys(k).sort(), ["beziehungen", "felder", "info", "rueckverweise", "verweise"]);
  // Fehler wie überall
  assert.equal((await wirft(v.notizKontext("../x.md"))).status, 403);
  assert.equal((await wirft(v.notizKontext(".git/config.md"))).status, 403);
  assert.equal((await wirft(v.notizKontext("nirgends.md"))).status, 404);
  assert.equal((await wirft(v.notizKontext("bild.png"))).status, 415);
  assert.equal((await wirft(v.notizKontext(undefined))).status, 400);
});

// ---------- Typen und Ansichten ----------
test("Typen: Zähler, feste Farbe/Symbol für Brain-Typen, abgeleitete Farbe stabil, Standard", async () => {
  const d = tmp();
  for (const [i, t] of ["thema", "thema", "quelle", "entitaet", "projekt", "person", "entscheidung", "notiz", "Projekt", "synthese", "synthese", "Eigener Typ"].entries()) schreibe(d, `n${i}.md`, `---\ntyp: ${t}\n---\n# ${i}\n`);
  schreibe(d, "ohne.md", "# Ohne Typ\n");
  schreibe(d, "INDEX.md", "---\ntyp: thema\n---\n# Generiert\n");
  const r = await vault(d).typen();
  const m = Object.fromEntries(r.typen.map((t) => [t.name, t]));
  assert.equal(m.thema.anzahl, 2); assert.equal(m.projekt.anzahl, 2); assert.equal(m.synthese.anzahl, 2);
  assert.deepEqual([m.thema.symbol, m.quelle.symbol, m.entitaet.symbol, m.projekt.symbol, m.person.symbol, m.entscheidung.symbol, m.notiz.symbol], ["buch", "zitat", "wuerfel", "rakete", "person", "waage", "notiz"]);
  for (const t of r.typen) { assert.match(t.farbe, /^#[0-9A-F]{6}$/); assert.ok(["buch", "zitat", "wuerfel", "rakete", "person", "waage", "notiz", "ordner"].includes(t.symbol)); }
  assert.equal(m["eigener typ"].symbol, "notiz");
  assert.equal(typStil("Eigener Typ").farbe, typStil("eigener typ").farbe);
  assert.deepEqual(typStil("project"), typStil("projekt")); assert.deepEqual(typStil("Entität"), typStil("entitaet"));
  assert.deepEqual(r.typen.map((t) => t.anzahl), [...r.typen.map((t) => t.anzahl)].sort((a, b) => b - a), "nach Zahl absteigend");
  assert.equal(r.typen.find((t) => t.name === "thema").anzahl, 2, "generierte Dateien zählen nicht");
  assert.deepEqual(Object.keys(r.typen[0]).sort(), ["anzahl", "farbe", "name", "symbol"]);
  assert.deepEqual(Object.keys(r.standard).sort(), ["farbe", "symbol"]);
});

test("Ansichten: abgelaufen (pruefen_bis / stand+verfall), strittig, ungeprüft (Wiki ohne Beleg und Stand), zuletzt (7 Tage); generierte zählen nie", async () => {
  const d = tmp();
  const kopf = (z) => `---\nname: x\ntyp: thema\n${z}---\n`;
  schreibe(d, "09_wiki/w/thema_alt.md", kopf("pruefen_bis: 2026-10-01\nstand: 2026-09-01\n") + "# Alt\n\n- Fakt · Stand 01.09.2026 · [[w/belege/2026-09/b]]\n");
  schreibe(d, "09_wiki/w/thema_verfall.md", kopf("stand: 2026-01-01\nverfall: 30\n") + "# Verfall\n");
  schreibe(d, "09_wiki/w/thema_gut.md", kopf("pruefen_bis: 2027-01-01\nstand: 2026-10-20\n") + "# Gut\n\n- Fakt · Stand 20.10.2026 · [[w/belege/2026-10/b]]\n");
  schreibe(d, "09_wiki/w/thema_streit.md", kopf("") + "# Streit\n\n> [!KONFLIKT] offen — Du entscheidest\n");
  schreibe(d, "09_wiki/w/thema_unbelegt.md", "# Unbelegt\n\nnur Text\n");
  schreibe(d, "09_wiki/w/thema_stand.md", kopf("stand: 2026-10-20\n") + "# Nur Stand\n");
  schreibe(d, "notizen/frei.md", "---\npruefen_bis: 2026-09-30\n---\n# Frei\n");
  schreibe(d, "09_wiki/_index.md", "---\npruefen_bis: 2020-01-01\n---\n# Index (generiert — nicht editieren)\n");
  schreibe(d, "09_wiki/_schema.md", "# Schema\n");
  schreibe(d, "09_wiki/w/belege/2026-09/b.md", "---\nzitat: x\n---\n# Beleg\n"); // Nachweis, keine Aussage: nie „ungeprüft“
  const vor8Tagen = new Date(Date.parse("2026-10-24T12:00:00Z") - 8 * 24 * 3600 * 1000);
  const vor6Tagen = new Date(Date.parse("2026-10-24T12:00:00Z") - 6 * 24 * 3600 * 1000);
  for (const f of ["09_wiki/w/thema_alt.md", "09_wiki/w/thema_verfall.md", "09_wiki/w/thema_gut.md", "09_wiki/w/thema_streit.md", "09_wiki/w/thema_unbelegt.md", "09_wiki/w/thema_stand.md", "09_wiki/_schema.md", "09_wiki/_index.md", "09_wiki/w/belege/2026-09/b.md"]) utimesSync(join(d, f), vor8Tagen, vor8Tagen);
  utimesSync(join(d, "notizen/frei.md"), vor6Tagen, vor6Tagen);
  const v = vault(d);
  const r = Object.fromEntries((await v.ansichten()).ansichten.map((a) => [a.id, a.anzahl]));
  assert.deepEqual(Object.keys(r), ["abgelaufen", "strittig", "ungeprueft", "zuletzt"]);
  assert.equal(r.abgelaufen, 3); // alt, verfall, frei
  assert.equal(r.strittig, 1);
  assert.equal(r.ungeprueft, 2); // streit und unbelegt; alt/verfall/gut/stand haben Beleg oder Stand
  assert.equal(r.zuletzt, 1);
  const n = Object.fromEntries((await v.notizen()).notizen.map((x) => [x.pfad, x.ansichten]));
  assert.deepEqual(n["09_wiki/w/thema_alt.md"], ["abgelaufen"]);
  assert.deepEqual(n["09_wiki/w/thema_verfall.md"], ["abgelaufen"]);
  assert.deepEqual(n["09_wiki/w/thema_gut.md"], []);
  assert.deepEqual(n["09_wiki/w/thema_streit.md"], ["strittig", "ungeprueft"]);
  assert.deepEqual(n["09_wiki/w/thema_unbelegt.md"], ["ungeprueft"]);
  assert.deepEqual(n["09_wiki/w/thema_stand.md"], []);
  assert.deepEqual(n["notizen/frei.md"], ["abgelaufen", "zuletzt"]);
  assert.deepEqual(n["09_wiki/_index.md"], []); assert.deepEqual(n["09_wiki/_schema.md"], []); assert.deepEqual(n["09_wiki/w/belege/2026-09/b.md"], []);
});

test("Ansichten und Typen zählen nur inbox · notiz · wissen — nicht maschine, vorlage, system, archiv", async () => {
  const d = tmp();
  const kopf = (z = "") => `---\ntyp: thema\npruefen_bis: 2026-09-30\nstand: 2026-10-20\n${z}---\n`; // abgelaufen, mit Stand (nie „ungeprüft“)
  const mitzaehlen = ["00_inbox/lose.md", "projekte/notiz.md", "09_wiki/w/thema_x.md"];
  const beiwerk = ["00_inbox/_rueckfragen/rf.md", "01_vorlagen/vorlage.md", "CLAUDE.md", "90_archiv/alt.md", "projekte/weg.md"];
  for (const p of mitzaehlen) schreibe(d, p, kopf() + "# Zählt\n");
  for (const p of beiwerk) schreibe(d, p, kopf(p === "projekte/weg.md" ? "archiviert: true\n" : "") + "# Beiwerk\n");
  const gestern = new Date(Date.parse("2026-10-23T12:00:00Z")); // innerhalb der 7 Tage
  for (const p of [...mitzaehlen, ...beiwerk]) utimesSync(join(d, p), gestern, gestern);
  const v = vault(d);
  const n = Object.fromEntries((await v.notizen()).notizen.map((x) => [x.pfad, x]));
  assert.deepEqual(Object.fromEntries(beiwerk.map((p) => [p, n[p].bereich])),
    { "00_inbox/_rueckfragen/rf.md": "maschine", "01_vorlagen/vorlage.md": "vorlage", "CLAUDE.md": "system", "90_archiv/alt.md": "archiv", "projekte/weg.md": "archiv" });
  for (const p of mitzaehlen) assert.deepEqual(n[p].ansichten, ["abgelaufen", "zuletzt"], p);
  for (const p of beiwerk) assert.deepEqual(n[p].ansichten, [], p);
  const a = Object.fromEntries((await v.ansichten()).ansichten.map((x) => [x.id, x.anzahl]));
  assert.deepEqual(a, { abgelaufen: 3, strittig: 0, ungeprueft: 0, zuletzt: 3 });
  const t = await v.typen();
  assert.deepEqual(t.typen.map((x) => [x.name, x.anzahl]), [["thema", 3]], "Typen zählen über dieselben Bereiche wie die Ansichten");
});

// ---------- Unicode, BOM, Zeilenenden ----------
test("Unicode: Umlaut-Dateiname in anderer Normalform wird gefunden; BOM und CRLF vor/im Kopf stören nicht", async () => {
  const d = tmp();
  schreibe(d, "A\u0308rger.md", "\uFEFF---\r\ntyp: Thema\r\ndescription: Kurz\r\n---\r\n# Ärger mit Ü\r\n\r\nText\r\n"); // NFD
  schreibe(d, "ziel.md", "# Ziel\n\n[[Ärger]] [[ärger]] [[Ärger mit Ü]]\n"); // NFC
  const n = (await vault(d).notizen()).notizen;
  const a = n.find((x) => x.pfad.normalize("NFC") === "Ärger.md");
  assert.equal(a.titel, "Ärger mit Ü"); assert.equal(a.typ, "thema"); assert.equal(a.vorschau, "Kurz");
  const z = n.find((x) => x.pfad === "ziel.md");
  assert.deepEqual(z.links, [a.pfad]);
});

// ---------- Umfang ----------
test("Umfang: 1.000 Notizen — kalt unter 2 s, warm unter 300 ms", async () => {
  const d = tmp();
  for (let i = 0; i < 1000; i++) {
    schreibe(d, `ordner${i % 20}/unter${i % 7}/notiz-${i}.md`, `---\nname: n${i}\ntyp: ${["thema", "quelle", "projekt"][i % 3]}\ndescription: Beschreibung ${i}\n---\n# Notiz ${i}\n\nText mit [[notiz-${(i + 1) % 1000}]] und [[notiz-${(i * 7) % 1000}|Alias]]. ${"Wort ".repeat(60)}\n`);
  }
  const v = vault(d);
  let t = performance.now();
  const r = await v.notizen();
  const kalt = performance.now() - t;
  assert.equal(r.notizen.length, 1000);
  assert.ok(r.notizen.every((n) => n.links.length === 2), "alle Links aufgelöst");
  t = performance.now();
  await v.notizen();
  const warm = performance.now() - t;
  console.log(`# 1.000 Notizen: kalt ${kalt.toFixed(0)} ms, warm ${warm.toFixed(0)} ms`);
  assert.ok(kalt < 2000, `kalt ${kalt} ms`);
  assert.ok(warm < 300, `warm ${warm} ms`);
});
