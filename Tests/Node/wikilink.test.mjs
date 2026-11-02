// Wikilinks: EINE Regel für Werkstatt, Studio und MCP (gemeinsam/wikilink.mjs). Auflösung, Vervollständigung, „Anlegen“ ohne Doppel-Dateien.
// Der Ablauf aus dem Funktions-Audit (K1): [[Neue Idee]] → „Anlegen“ → der Link blieb kaputt, jeder weitere Klick legte neue-idee-2.md an.
// Nur Wegwerf-Vaults in os.tmpdir().
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { baueWikiIndex, findeWikiZiel, loeseWikiLink, linkText, schlageWikiZieleVor, zielZuNeuerNotiz, lockerFormen, unscharf } = await import(pfad("gemeinsam", "wikilink.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { bearbeite } = await import(pfad("mcp", "brain-mcp.mjs"));

const IX = () => baueWikiIndex([
  { pfad: "00_inbox/neue-idee.md", titel: "Neue Idee" },
  { pfad: "09_wiki/wissen/Kaffee.md", titel: "Kaffee", aliasse: ["Bohnen-Getränk", "Café"] },
  { pfad: "09_wiki/wissen/Mühle.md", titel: "Mühle" },
  { pfad: "a/Projekt Alpha.md", titel: "Projekt Alpha" },
  { pfad: "b/projekt-alpha.md", titel: "Projekt Alpha" },
  { pfad: "notizen/Straße.md", titel: "Straße nach Rom" },
]);

// ───────────────────────────── Auflösung ─────────────────────────────

test("Auflösung: Pfad, Endstück, Dateiname, Titel, Alias — Groß/klein egal", () => {
  const ix = IX();
  const ziel = (z, von = "") => loeseWikiLink(ix, z, von);
  assert.equal(ziel("09_wiki/wissen/Kaffee"), "09_wiki/wissen/Kaffee.md", "voller Pfad");
  assert.equal(ziel("09_wiki/wissen/kaffee.md"), "09_wiki/wissen/Kaffee.md", "Pfad mit Endung");
  assert.equal(ziel("wissen/KAFFEE"), "09_wiki/wissen/Kaffee.md", "Endstück des Pfads");
  assert.equal(ziel("kaffee"), "09_wiki/wissen/Kaffee.md", "Dateiname");
  assert.equal(ziel("Neue Idee"), "00_inbox/neue-idee.md", "Titel, obwohl der Dateiname anders aussieht (der Fall aus K1)");
  assert.equal(ziel("Straße nach Rom"), "notizen/Straße.md", "Titel statt Dateiname");
  assert.equal(ziel("Bohnen-Getränk"), "09_wiki/wissen/Kaffee.md", "Alias");
  assert.equal(ziel("Kaffee#Abschnitt"), "09_wiki/wissen/Kaffee.md", "Anker gehört nicht zum Ziel");
  assert.equal(ziel("Kaffee|der Kaffee"), "09_wiki/wissen/Kaffee.md", "Anzeigetext gehört nicht zum Ziel");
  assert.equal(ziel("Gibt es nicht"), null);
  assert.equal(ziel(""), null);
  assert.equal(ziel("   "), null);
});

test("Auflösung: Umlaute, ß und Trenner sind tolerant (ae = ä = a, ss = ß, Leerzeichen = - = _)", () => {
  const ix = IX();
  const ziel = (z) => loeseWikiLink(ix, z);
  assert.equal(ziel("Muehle"), "09_wiki/wissen/Mühle.md");
  assert.equal(ziel("muhle"), "09_wiki/wissen/Mühle.md");
  assert.equal(ziel("MÜHLE"), "09_wiki/wissen/Mühle.md");
  assert.equal(ziel("Strasse nach Rom"), "notizen/Straße.md");
  assert.equal(ziel("neue-idee"), "00_inbox/neue-idee.md");
  assert.equal(ziel("neue_idee"), "00_inbox/neue-idee.md");
  assert.equal(ziel("Cafe"), "09_wiki/wissen/Kaffee.md", "Akzent weg: Alias „Café“");
  assert.equal(ziel("bohnen getränk"), "09_wiki/wissen/Kaffee.md");
  assert.deepEqual(lockerFormen("Müller-Liste"), ["mueller liste", "muller liste"]);
  // NFD-Eingabe (macOS-Dateinamen) trifft NFC
  assert.equal(ziel("Mühle"), "09_wiki/wissen/Mühle.md");
});

test("Auflösung: Vorrang Pfad vor Titel vor Alias; genau vor tolerant", () => {
  const ix = baueWikiIndex([
    { pfad: "x/Alpha.md", titel: "Anderer Titel" },
    { pfad: "y/beta.md", titel: "Alpha" },
    { pfad: "z/gamma.md", titel: "Gamma", aliasse: ["Alpha"] },
    { pfad: "w/mueller.md", titel: "Mueller" },
    { pfad: "w/müller.md", titel: "Müller" },
  ]);
  assert.equal(loeseWikiLink(ix, "alpha"), "x/Alpha.md", "Dateiname schlägt Titel und Alias");
  assert.equal(loeseWikiLink(ix, "Gamma"), "z/gamma.md");
  assert.equal(loeseWikiLink(ix, "Müller"), "w/müller.md", "genauer Treffer vor dem toleranten (Mueller)");
  assert.equal(loeseWikiLink(ix, "Mueller"), "w/mueller.md");
});

test("Auflösung bei mehreren Treffern: genauer Pfad, gleicher Ordner, kürzerer Pfad, alphabetisch", () => {
  const ix = baueWikiIndex([
    { pfad: "a/notiz.md", titel: "Notiz" }, { pfad: "b/notiz.md", titel: "Notiz" }, { pfad: "b/tief/notiz.md", titel: "Notiz" },
  ]);
  assert.equal(loeseWikiLink(ix, "notiz", "b"), "b/notiz.md", "gleicher Ordner");
  assert.equal(loeseWikiLink(ix, "notiz", "b/tief"), "b/tief/notiz.md");
  assert.equal(loeseWikiLink(ix, "notiz", "c"), "a/notiz.md", "sonst der alphabetisch erste mit kürzestem Pfad");
  assert.equal(loeseWikiLink(ix, "b/tief/notiz", "a"), "b/tief/notiz.md", "genauer Pfad zuerst");
});

test("Auflösung: relative Ziele gelten ab dem Ordner der Notiz; aus dem Vault heraus gibt es nichts", () => {
  const ix = baueWikiIndex([{ pfad: "a/b/x.md", titel: "Ix" }, { pfad: "a/y.md", titel: "Iy" }, { pfad: "z.md", titel: "Iz" }]);
  assert.equal(loeseWikiLink(ix, "./x", "a/b"), "a/b/x.md");
  assert.equal(loeseWikiLink(ix, "../y", "a/b"), "a/y.md");
  assert.equal(loeseWikiLink(ix, "../../z", "a/b"), "z.md");
  assert.equal(loeseWikiLink(ix, "../../../z", "a/b"), null);
});

test("linkText: Titel, wenn er eindeutig zur Notiz führt, sonst „pfad|Titel“", () => {
  const ix = IX();
  assert.equal(linkText(ix, "00_inbox/neue-idee.md"), "Neue Idee");
  assert.equal(linkText(ix, "09_wiki/wissen/Kaffee.md"), "Kaffee");
  assert.equal(linkText(ix, "a/Projekt Alpha.md"), "Projekt Alpha");
  assert.equal(linkText(ix, "b/projekt-alpha.md"), "b/projekt-alpha|Projekt Alpha", "mehrdeutiger Titel");
  // der eingefügte Text trifft jeweils wieder dieselbe Notiz
  for (const e of ix.roh) assert.equal(loeseWikiLink(ix, linkText(ix, e.pfad)), e.pfad, e.pfad);
});

// ───────────────────────────── Vorschläge beim Tippen ─────────────────────────────

test("Vorschläge: Titel mit Ordner, unscharf (Tippfehler, Wortanfänge, Buchstabenfolge, Umlaute), Aliasse", () => {
  const ix = IX();
  const titel = (q, o) => schlageWikiZieleVor(ix, q, o).map((v) => v.titel);
  assert.deepEqual(titel("kafee"), ["Kaffee"], "Tippfehler");
  assert.deepEqual(titel("kfe"), ["Kaffee"], "Buchstaben in Reihenfolge");
  assert.deepEqual(titel("pa").slice(0, 2), ["Projekt Alpha", "Projekt Alpha"], "Wortanfänge");
  assert.deepEqual(titel("proj al").slice(0, 1), ["Projekt Alpha"]);
  assert.deepEqual(titel("muel"), ["Mühle"], "ue ↔ ü");
  assert.deepEqual(titel("muh"), ["Mühle"], "u ↔ ü");
  assert.deepEqual(titel("neu"), ["Neue Idee"]);
  assert.deepEqual(titel("xyzxyz"), []);
  const alias = schlageWikiZieleVor(ix, "bohnen")[0];
  assert.equal(alias.titel, "Kaffee"); assert.equal(alias.alias, "Bohnen-Getränk"); assert.equal(alias.text, "Kaffee", "eingefügt wird der Titel der Notiz");
  const kaffee = schlageWikiZieleVor(ix, "kaffee")[0];
  assert.equal(kaffee.ordner, "09_wiki/wissen"); assert.equal(kaffee.pfad, "09_wiki/wissen/Kaffee.md");
  assert.ok(schlageWikiZieleVor(ix, "", { max: 3 }).length === 3, "ohne Eingabe: alle, begrenzt");
  assert.equal(schlageWikiZieleVor(ix, "", { bevorzugt: ["notizen/Straße.md"] })[0].pfad, "notizen/Straße.md", "zuletzt Geöffnetes zuerst");
  // Ränge: genau vor Anfang vor Wortanfang vor Teilstück vor Buchstabenfolge vor Tippfehler
  assert.ok(unscharf("kaffee", "kaffee") < unscharf("kaf", "kaffee"));
  assert.ok(unscharf("kaf", "kaffee") < unscharf("af", "kaffee"));
  assert.equal(unscharf("zzz", "kaffee"), null);
});

test("Vorschläge: der eingefügte Text führt zurück zur Notiz (auch bei doppelten Titeln)", () => {
  const ix = IX();
  for (const v of schlageWikiZieleVor(ix, "projekt")) assert.equal(loeseWikiLink(ix, v.text), v.pfad, v.text);
  assert.deepEqual(schlageWikiZieleVor(ix, "projekt").map((v) => v.text).sort(), ["Projekt Alpha", "b/projekt-alpha|Projekt Alpha"]);
});

// ───────────────────────────── Ziel → neue Notiz ─────────────────────────────

test("zielZuNeuerNotiz: Titel ist das Ziel, Ordner nur wenn das Ziel einen nennt", () => {
  assert.deepEqual(zielZuNeuerNotiz("Neue Idee"), { titel: "Neue Idee", ordner: null });
  assert.deepEqual(zielZuNeuerNotiz("projekte/Neue  Idee"), { titel: "Neue Idee", ordner: "projekte" });
  assert.deepEqual(zielZuNeuerNotiz("./y", "x/z"), { titel: "y", ordner: "x/z" });
  assert.deepEqual(zielZuNeuerNotiz("../y", "x/z"), { titel: "y", ordner: "x" });
  assert.deepEqual(zielZuNeuerNotiz("Titel#Abschnitt|Anzeige"), { titel: "Titel", ordner: null });
  assert.equal(zielZuNeuerNotiz("   "), null);
  assert.equal(zielZuNeuerNotiz("../../../x", "a"), null);
});

// ───────────────────────────── Werkstatt: der Ablauf aus dem Audit (K1) ─────────────────────────────

function vault() {
  const d = tmp("brain-wiki-");
  schreibe(d, "00_inbox/erste.md", "# Erste Notiz\n\nIdee: [[Neue Idee]] und [[Mühle]] und [[projekte/Plan B]].\n");
  schreibe(d, "09_wiki/wissen/Mühle.md", "---\ntitel: Mühle\n---\n# Mühle\n\nText\n");
  return { d, v: oeffneVault(d, { heute: "2026-11-02" }) };
}
const zeileVon = async (v, rel) => (await v.notizen()).notizen.find((n) => n.pfad === rel);

test("K1: „Anlegen“ aus [[Neue Idee]] macht den Link sofort zu; ein zweiter Klick legt nichts doppelt an", async () => {
  const { d, v } = vault();
  let erste = await zeileVon(v, "00_inbox/erste.md");
  assert.deepEqual(erste.links, ["09_wiki/wissen/Mühle.md"], "vorher: nur die Mühle ist aufgelöst");
  const a = await v.wikiAnlegen({ ziel: "Neue Idee", von: "00_inbox/erste.md", ordner: "00_inbox" });
  assert.deepEqual(a, { pfad: "00_inbox/neue-idee.md", vorhanden: false });
  assert.equal(readFileSync(join(d, a.pfad), "utf8"), "# Neue Idee\n", "der Titel ist das Ziel");
  erste = await zeileVon(v, "00_inbox/erste.md");
  assert.ok(erste.links.includes("00_inbox/neue-idee.md"), "der Link trifft die neue Notiz sofort (Werkstatt)");
  assert.equal(await v.wikiLoese("Neue Idee", "00_inbox/erste.md"), "00_inbox/neue-idee.md");
  // zweiter Klick, auch gleichzeitig: nichts Neues
  const [b, c] = await Promise.all([v.wikiAnlegen({ ziel: "Neue Idee", von: "00_inbox/erste.md" }), v.wikiAnlegen({ ziel: "neue idee", von: "00_inbox/erste.md" })]);
  assert.deepEqual(b, { pfad: "00_inbox/neue-idee.md", vorhanden: true });
  assert.deepEqual(c, { pfad: "00_inbox/neue-idee.md", vorhanden: true });
  assert.deepEqual(readdirSync(join(d, "00_inbox")).sort(), ["erste.md", "neue-idee.md"], "kein neue-idee-2.md");
});

test("Anlegen: zwei gleichzeitige Klicks auf ein NOCH fehlendes Ziel legen genau eine Notiz an", async () => {
  const { d, v } = vault();
  const r = await Promise.all([1, 2, 3].map(() => v.wikiAnlegen({ ziel: "Ganz neu", von: "00_inbox/erste.md", ordner: "00_inbox" })));
  assert.equal(new Set(r.map((x) => x.pfad)).size, 1);
  assert.equal(r.filter((x) => !x.vorhanden).length, 1);
  assert.deepEqual(readdirSync(join(d, "00_inbox")).sort(), ["erste.md", "ganz-neu.md"]);
});

test("Anlegen: ein Ziel mit Ordner landet dort; der Link trifft die Notiz danach auch bei abweichendem Dateinamen", async () => {
  const { d, v } = vault();
  const a = await v.wikiAnlegen({ ziel: "projekte/Plan B", von: "00_inbox/erste.md", ordner: "00_inbox" });
  assert.equal(a.pfad, "projekte/plan-b.md");
  assert.ok((await zeileVon(v, "00_inbox/erste.md")).links.includes("projekte/plan-b.md"), "[[projekte/Plan B]] trifft projekte/plan-b.md");
  assert.equal((await v.wikiAnlegen({ ziel: "projekte/Plan B", von: "00_inbox/erste.md" })).vorhanden, true);
  assert.equal(existsSync(join(d, "projekte", "plan-b-2.md")), false);
});

test("Anlegen: ein Ziel, das es schon gibt (Titel, Alias, Umlaute), wird gefunden statt angelegt", async () => {
  const { d, v } = vault();
  schreibe(d, "10_notizen/kaffee-alt.md", "---\naliases: [Bohnensaft]\n---\n# Kaffee\n");
  for (const [ziel, soll] of [["Muehle", "09_wiki/wissen/Mühle.md"], ["mühle", "09_wiki/wissen/Mühle.md"], ["Bohnensaft", "10_notizen/kaffee-alt.md"], ["Kaffee", "10_notizen/kaffee-alt.md"]]) {
    assert.deepEqual(await v.wikiAnlegen({ ziel, von: "00_inbox/erste.md" }), { pfad: soll, vorhanden: true }, ziel);
  }
  assert.deepEqual(readdirSync(join(d, "00_inbox")), ["erste.md"]);
});

test("Anlegen: ungültige Eingaben und Pfadtricks werden abgewiesen", async () => {
  const { d, v } = vault();
  for (const ziel of ["", "   ", undefined, 5]) await assert.rejects(() => v.wikiAnlegen({ ziel, von: "" }), (e) => e.status === 400, String(ziel));
  await assert.rejects(() => v.wikiAnlegen({ ziel: "../../draussen/x", von: "00_inbox/erste.md" }), (e) => e.status === 400 || e.status === 403);
  await assert.rejects(() => v.wikiAnlegen({ ziel: "x", von: 5 }), (e) => e.status === 400);
  assert.equal(existsSync(join(d, "..", "draussen")), false);
});

test("Route POST /api/wiki/anlegen", async () => {
  const { d } = vault();
  const h = erzeugeHandler({ vault: d });
  const rufe = async (daten) => { const r = await h({ methode: "POST", pfad: "/api/wiki/anlegen", query: null, body: Buffer.from(JSON.stringify(daten)) }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  const a = await rufe({ ziel: "Neue Idee", von: "00_inbox/erste.md", ordner: "00_inbox" });
  assert.equal(a.status, 200); assert.deepEqual(a.j, { pfad: "00_inbox/neue-idee.md", vorhanden: false });
  const b = await rufe({ ziel: "Neue Idee", von: "00_inbox/erste.md" });
  assert.deepEqual(b.j, { pfad: "00_inbox/neue-idee.md", vorhanden: true });
  assert.equal((await rufe({ ziel: "" })).status, 400);
});

test("Werkstatt: Verknüpfungen, offene Links und Rückverweise folgen der gemeinsamen Regel (Titel, Alias, Umlaute)", async () => {
  const d = tmp("brain-wiki-i-");
  schreibe(d, "a.md", "# A\n\n[[Neue Idee]] [[Bohnen]] [[Muehle]] [[gibt es nicht]]\n");
  schreibe(d, "b/neue-idee.md", "# Neue Idee\n");
  schreibe(d, "c/kaffee.md", "---\naliases: [Bohnen]\n---\n# Kaffee\n");
  schreibe(d, "d/Mühle.md", "# Mühle\n");
  const v = oeffneVault(d, { heute: "2026-11-02" });
  const a = await zeileVon(v, "a.md");
  assert.deepEqual([...a.links].sort(), ["b/neue-idee.md", "c/kaffee.md", "d/Mühle.md"]);
  const k = await v.notizKontext("b/neue-idee.md");
  assert.deepEqual(k.rueckverweise.map((x) => x.pfad), ["a.md"], "Rückverweis über den Titel");
  assert.deepEqual((await v.notizKontext("a.md")).verweise.sort(), ["b/neue-idee.md", "c/kaffee.md", "d/Mühle.md", "gibt es nicht"]);
  assert.deepEqual(a.aliasse, [], "die Zeile trägt die Aliasse (das Studio löst damit auf)");
  assert.deepEqual((await zeileVon(v, "c/kaffee.md")).aliasse, ["Bohnen"]);
});

// ───────────────────────────── MCP: brain_lesen mit derselben Regel ─────────────────────────────

test("MCP brain_lesen: Titel, Alias oder [[Link]] statt Pfad", async () => {
  const d = tmp("brain-wiki-m-");
  schreibe(d, "00_inbox/neue-idee.md", "# Neue Idee\n\nInhalt der Idee.\n");
  schreibe(d, "c/kaffee.md", "---\naliases: [Bohnen]\n---\n# Kaffee\n\nBohnen.\n");
  const v = oeffneVault(d, { heute: "2026-11-02" });
  let nr = 0;
  const lies = async (pfadArg) => (await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name: "brain_lesen", arguments: { pfad: pfadArg } } })).result;
  const text = (r) => r.content.map((c) => c.text).join("\n");
  assert.match(text(await lies("00_inbox/neue-idee.md")), /Inhalt der Idee/, "Pfad wie bisher");
  assert.match(text(await lies("Neue Idee")), /Pfad: 00_inbox\/neue-idee\.md[\s\S]*Inhalt der Idee/, "Titel");
  assert.match(text(await lies("[[Bohnen]]")), /Pfad: c\/kaffee\.md/, "Alias im Link");
  const fehlt = await lies("Gibt es nicht");
  assert.equal(fehlt.isError, true);
});
