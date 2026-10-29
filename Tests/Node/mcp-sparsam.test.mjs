// Token-Paket 1: brain_lesen seitenweise (Gliederung, abschnitt, von/bis), brain_suchen kompakt und treffsicher, brain_kontext begrenzt.
// Läuft im selben Prozess (bearbeite() des MCP-Servers) gegen Wegwerf-Vaults; kein Netz, keine KI.
import test from "node:test";
import assert from "node:assert/strict";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { bearbeite } = await import(pfad("mcp", "brain-mcp.mjs"));
process.env.BRAIN_NUTZUNG = "aus";

const kopf = "---\nname: x\ntyp: thema\n---\n";
let nr = 0;
async function rufe(v, name, args) {
  const a = await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name, arguments: args } });
  return { fehler: a.result.isError === true, text: a.result.content.map((c) => c.text).join("\n") };
}
const zaehle = (t) => t.split("\n").filter((z) => /^\d+\. /.test(z)).length;

function langerVault() {
  const d = tmp();
  const absatz = (n) => `Absatz ${n}: ` + "Der Tageslauf pflegt das Wissen und räumt die Inbox auf, ohne etwas zu löschen. ".repeat(9) + "\n";
  let t = kopf + "# Lange Seite\n\nKurze Einleitung zur Seite.\n\n";
  for (let i = 1; i <= 8; i++) t += `## Teil ${i}\n\n${absatz(i)}\n`;
  t += "### Unterteil 8a\n\nUnterteil-Inhalt 8a.\n\n```\n# kein Titel im Codezaun\n```\n\n## Schluss\n\nLetzter-Satz-der-Seite.\n";
  schreibe(d, "09_wiki/lang.md", t);
  schreibe(d, "09_wiki/klein.md", kopf + "# Klein\n\nKurzer Text.\n");
  return { v: oeffneVault(d), laenge: t.length };
}
const LANG = "09_wiki/lang.md";

test("brain_lesen: lange Seite = Hinweis, Gliederung mit Zeilen, Anfang; Obergrenze; kleine Seite unverändert", async () => {
  const { v, laenge } = langerVault();
  assert.ok(laenge > 6000);
  const a = await rufe(v, "brain_lesen", { pfad: LANG });
  assert.ok(!a.fehler);
  const t = a.text;
  assert.match(t, /Lange Seite \(\d+ Zeichen, \d+ Zeilen\)/);
  assert.match(t, /abschnitt=/); assert.match(t, /von=\d+ bis=/);
  assert.match(t, /Gliederung[^\n]*:\n1\. Lange Seite \(Z\. \d+\)/);
  assert.match(t, /\n {2}\d+\. Teil 1 \(Z\. \d+\)/); assert.match(t, /\n {4}\d+\. Unterteil 8a/);
  assert.ok(!/kein Titel im Codezaun \(Z\./.test(t), "Überschriften im Codezaun zählen nicht");
  assert.ok(t.includes("Kurze Einleitung zur Seite.") && t.includes("## Teil 1"));
  assert.ok(!t.includes("Letzter-Satz-der-Seite"), "das Ende steht nicht in der ersten Antwort");
  assert.ok(t.length <= 7000, `Antwort ${t.length} Zeichen`);
  assert.match(t, /Prüf-Stufe/);
  const k = await rufe(v, "brain_lesen", { pfad: "09_wiki/klein.md" });
  assert.doesNotMatch(k.text, /Lange Seite|Gliederung/);
  assert.ok(k.text.endsWith("---\n" + kopf + "# Klein\n\nKurzer Text.\n"), "kleine Seiten kommen ganz und unverändert");
});

test("brain_lesen: abschnitt (Text oder Nummer) und von/bis liefern genau den Teil; Fehler nennen die Gliederung", async () => {
  const { v } = langerVault();
  let t = (await rufe(v, "brain_lesen", { pfad: LANG, abschnitt: "teil 8" })).text;
  assert.match(t, /Abschnitt „Teil 8“, Zeilen \d+–\d+ von \d+/);
  assert.ok(t.includes("## Teil 8") && t.includes("Unterteil-Inhalt 8a.") && !t.includes("## Teil 7") && !t.includes("Letzter-Satz"), "mit Unterabschnitt, bis zur nächsten Überschrift gleicher Ebene");
  assert.ok(t.length < 2500);
  t = (await rufe(v, "brain_lesen", { pfad: LANG, abschnitt: "Schluss" })).text;
  assert.ok(t.includes("Letzter-Satz-der-Seite.") && !t.includes("Unterteil-Inhalt"));
  const nummer = (await rufe(v, "brain_lesen", { pfad: LANG, abschnitt: "2" })).text; // Nr. 2 der Gliederung = „Teil 1“
  assert.ok(nummer.includes("## Teil 1") && !nummer.includes("## Teil 2"));
  t = (await rufe(v, "brain_lesen", { pfad: LANG, von: 5, bis: 7 })).text;
  assert.match(t, /Zeilen 5–7 von \d+\./); assert.ok(t.length < 1500);
  t = (await rufe(v, "brain_lesen", { pfad: LANG, von: 5 })).text;
  assert.ok(t.length <= 7000 && /Weiter: von=\d+/.test(t), "ohne bis: bis zur Obergrenze, mit Hinweis zum Weiterlesen");
  const fall = [[{ abschnitt: "gibtsnicht" }, /gibt es in dieser Seite nicht[\s\S]*Gliederung/], [{ abschnitt: "Teil 1", von: 3 }, /entweder/], [{ von: 9999 }, /nur \d+ Zeilen/],
    [{ von: 9, bis: 3 }, /nicht vor/], [{ von: 0 }, /ganze Zahl/], [{ von: "x" }, /ganze Zahl/]];
  for (const [args, muster] of fall) {
    const a = await rufe(v, "brain_lesen", { pfad: LANG, ...args });
    assert.equal(a.fehler, true, JSON.stringify(args)); assert.match(a.text, muster);
  }
});

test("brain_suchen: Standard 5, höchstens 20, Zeile und Auszug aus dem Text (nie Frontmatter), Frage in ganzen Sätzen", async () => {
  const d = tmp();
  for (let i = 0; i < 25; i++) schreibe(d, `09_wiki/k${String(i).padStart(2, "0")}.md`, `---\nname: Kaktus-Seite ${i}\ndescription: "Beschreibung zum Kaktus"\n---\n\n# Kaktus ${i}\n\nEinleitung.\n\nDer Kaktus braucht wenig Wasser, Nummer ${i}.\n`);
  schreibe(d, "09_wiki/pflege.md", kopf + "# Tageslauf\n\nNachts läuft die Pflege im Tageslauf: erst die Inbox sichten, dann die Seiten prüfen.\n");
  schreibe(d, "09_wiki/anderes.md", kopf + "# Anderes\n\nHier geht es um etwas ganz anderes, nämlich Gartenarbeit.\n");
  const v = oeffneVault(d);
  assert.equal(zaehle((await rufe(v, "brain_suchen", { frage: "Kaktus" })).text), 5);
  assert.equal(zaehle((await rufe(v, "brain_suchen", { frage: "Kaktus", anzahl: 50 })).text), 20);
  let t = (await rufe(v, "brain_suchen", { frage: "Kaktus", anzahl: 3 })).text;
  assert.equal(zaehle(t), 3);
  assert.match(t, /\n {3}Z\.10: Der Kaktus braucht wenig Wasser, Nummer \d+\./, "Zeilennummer der Datei, Auszug aus dem Text");
  assert.doesNotMatch(t, /name:|description:|^---$/m, "kein Frontmatter als Auszug");
  assert.ok(t.split("\n").every((z) => z.length <= 260), "jede Zeile kurz");
  // natürliche Frage: früher „Keine Treffer.“ (jedes Wort musste als Teilstring vorkommen)
  t = (await rufe(v, "brain_suchen", { frage: "Wie läuft die Pflege im Tageslauf ab?" })).text;
  assert.match(t, /^1\. 09_wiki\/pflege\.md — Tageslauf/);
  assert.match(t, /Z\.7: Nachts läuft die Pflege/);
  assert.equal((await rufe(v, "brain_suchen", { frage: "?!…" })).text, "Keine Treffer.");
  assert.equal((await rufe(v, "brain_suchen", { frage: "zzzgibtesnicht" })).text, "Keine Treffer.");
  // _meta für die App-Probe: gleiche Felder wie bisher
  const roh = await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name: "brain_suchen", arguments: { frage: "Kaktus", anzahl: 2 } } });
  assert.deepEqual(roh.result._meta["brain-studio/treffer"].map((x) => Object.keys(x).sort().join()), Array(2).fill("auszug,pfad,stufe,titel,zeile"));
});

test("brain_suchen: Ausschnitt mit Wortgrenzen, Treffer über die Beschreibung zeigt den Textanfang statt des Frontmatters", async () => {
  const d = tmp();
  schreibe(d, "09_wiki/lang.md", kopf + "# Lang\n\n" + "Vorgeschichte ohne Belang. ".repeat(12) + "Hier beginnt der Zebrastreifen-Abschnitt mit dem gesuchten Wort Zebrastreifen und danach geht es noch lange weiter " + "und weiter ".repeat(10) + "\n");
  schreibe(d, "09_wiki/beschr.md", "---\nname: Seite\ndescription: \"Alles zum Quokka\"\n---\n\n# Seite\n\nNichts davon steht im Text.\n");
  const v = oeffneVault(d);
  let t = (await rufe(v, "brain_suchen", { frage: "Zebrastreifen" })).text;
  const zeile = t.split("\n")[1];
  assert.match(zeile, /^ {3}Z\.7: … \S/, zeile); assert.ok(zeile.includes("Zebrastreifen") && zeile.length <= 3 + 6 + 2 + 110 + 3 + 2, zeile);
  t = (await rufe(v, "brain_suchen", { frage: "Quokka" })).text;
  assert.match(t, /beschr\.md[^\n]*\n {3}Z\.\d+: (# Seite|Nichts davon)/);
  assert.doesNotMatch(t, /description/);
});

function projektVault(anzahl) {
  const d = tmp();
  for (let i = 0; i < anzahl; i++) schreibe(d, `09_wiki/projekte/entitaet_p${i}.md`, `---\nname: P${i}\ntyp: entitaet\nrepo: jo/viel\nstand: 2026-10-2${i % 10}\n---\n# Projekt ${i}\n\n` + "Ein sehr langer Satz ohne Ende ".repeat(60) + "\n");
  return oeffneVault(d);
}

test("brain_kontext: höchstens 4 Seiten, je 1 Satz ≤ 160 Zeichen, insgesamt ≤ 2000 Zeichen, Rest wird genannt", async () => {
  const v = projektVault(9);
  const t = (await rufe(v, "brain_kontext", { projekt: "viel" })).text;
  assert.equal(zaehle(t), 4);
  assert.match(t, /\(\+5 weitere; brain_suchen\)/);
  assert.ok(t.length <= 2000, `${t.length}`);
  for (const z of t.split("\n")) assert.ok(z.length <= 200, z);
  const wenig = (await rufe(projektVault(2), "brain_kontext", { projekt: "viel" })).text;
  assert.equal(zaehle(wenig), 2); assert.doesNotMatch(wenig, /weitere/);
});
