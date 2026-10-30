// Token-Budget der KI-Werkzeuge (MCP): feste Obergrenzen für die Größe der Antworten (Zeichen) auf einem Fixture-Vault mit großen Seiten.
// Damit nichts still wieder wächst. 1 Token ≈ 3,5 Zeichen (deutscher Text). Die Obergrenzen sind absichtlich etwas lockerer als die Messwerte.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad, WURZEL } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { bearbeite, WERKZEUGE } = await import(pfad("mcp", "brain-mcp.mjs"));
process.env.BRAIN_NUTZUNG = "aus";

// Obergrenzen in Zeichen
const GRENZE = { werkzeugliste: 3700, sucheStandard: 1500, sucheMax20: 4200, lesenKlein: 6600, lesenLang: 7000, lesenTeil: 6800, kontext: 2000 };

// deterministischer Fließtext
const WOERTER = "Kortex Vault Seite Pflege Tageslauf Inbox Wissen Hinweis Suche Werkzeug Antwort Kontext Projekt Prüfung Sicherung Verlauf Abschnitt Gliederung Zeile Treffer Ranking Frage Stufe Beleg Quelle".split(" ");
function text(zeichen, start = 0) {
  let t = "", i = start;
  while (t.length < zeichen) { t += WOERTER[(i * 7 + (i >> 2)) % WOERTER.length] + (i % 13 === 12 ? ".\n\n" : i % 6 === 5 ? ". " : " "); i++; }
  return t.slice(0, zeichen);
}
function vault() {
  const d = tmp();
  cpSync(join(WURZEL, "..", "Tests", "Kern", "fixture"), d, { recursive: true });
  for (let i = 0; i < 25; i++) {
    let s = `---\nname: Thema ${i} Kortex Seite\ndescription: "Beschreibung ${i} zu Kortex, Suche und Pflege"\ntyp: thema\n---\n\n# Thema ${i}\n\n`;
    for (let k = 1; k <= 6; k++) s += `## Abschnitt ${k}\n\n${text(2200, i * 10 + k)}\n\n`;
    schreibe(d, `09_wiki/${i % 2 ? "themen" : "firma/kortex"}/thema_${String(i).padStart(2, "0")}.md`, s);
  }
  schreibe(d, "09_wiki/projekte/kortex.md", "---\nname: Kortex\ntyp: projekt\nrepo: [brain-app]\n---\n\n# Kortex\n\nDie App Kortex bündelt Kern, Studio und MCP-Server. Tests laufen über das Skript im Kern.\n");
  return oeffneVault(d);
}

let nr = 0;
const rufe = async (v, name, args) => {
  const a = await bearbeite(v, { jsonrpc: "2.0", id: ++nr, method: "tools/call", params: { name, arguments: args } });
  assert.ok(!a.result.isError, a.result.content[0].text);
  return a.result.content.map((c) => c.text).join("\n");
};
const gib = (name, zeichen, grenze) => console.log(`# ${name}: ${zeichen} Zeichen (Grenze ${grenze}) ≈ ${Math.round(zeichen / 3.5)} Token`);

test("Token-Budget: Werkzeugliste (Schemas)", () => {
  const n = JSON.stringify(WERKZEUGE).length;
  gib("tools/list", n, GRENZE.werkzeugliste);
  assert.ok(n <= GRENZE.werkzeugliste, `${n} > ${GRENZE.werkzeugliste}`);
});

test("Token-Budget: brain_suchen", async () => {
  const v = vault();
  const a = await rufe(v, "brain_suchen", { frage: "Kortex Suche Pflege" });
  gib("suchen Standard", a.length, GRENZE.sucheStandard);
  assert.ok(a.length <= GRENZE.sucheStandard, `${a.length}`);
  const b = await rufe(v, "brain_suchen", { frage: "Wie läuft die Pflege im Kortex ab?", anzahl: 20 });
  gib("suchen 20", b.length, GRENZE.sucheMax20);
  assert.ok(b.length <= GRENZE.sucheMax20, `${b.length}`);
});

test("Token-Budget: brain_lesen (große Seite, Abschnitt, Zeilenbereich, kleine Seite)", async () => {
  const v = vault();
  const gross = "09_wiki/firma/kortex/thema_00.md";
  const voll = v.lies(gross).inhalt.length;
  assert.ok(voll > 13000, `Fixture-Seite nur ${voll} Zeichen`);
  const lang = await rufe(v, "brain_lesen", { pfad: gross });
  gib("lesen groß", lang.length, GRENZE.lesenLang);
  assert.ok(lang.length <= GRENZE.lesenLang, `${lang.length}`);
  assert.ok(lang.length < voll / 1.8, "deutlich kleiner als die ganze Seite");
  const teil = await rufe(v, "brain_lesen", { pfad: gross, abschnitt: "Abschnitt 3" });
  gib("lesen Abschnitt", teil.length, GRENZE.lesenTeil);
  assert.ok(teil.length <= GRENZE.lesenTeil, `${teil.length}`);
  const zeilen = await rufe(v, "brain_lesen", { pfad: gross, von: 1, bis: 100000 });
  gib("lesen von/bis (alles angefordert)", zeilen.length, GRENZE.lesenTeil);
  assert.ok(zeilen.length <= GRENZE.lesenTeil, `${zeilen.length}`);
  const klein = await rufe(v, "brain_lesen", { pfad: "09_wiki/projekte/kortex.md" });
  assert.ok(klein.length <= 1200, "kleine Seite bleibt ganz und klein");
  // knapp unter der Schwelle kommt ganz
  schreibe(v.wurzel, "09_wiki/knapp.md", `---\nname: Knapp\n---\n# Knapp\n\n${text(5800)}\n`);
  const knapp = await rufe(v, "brain_lesen", { pfad: "09_wiki/knapp.md" });
  gib("lesen knapp unter 6000", knapp.length, GRENZE.lesenKlein);
  assert.ok(knapp.length <= GRENZE.lesenKlein);
  assert.doesNotMatch(knapp, /Lange Seite/);
});

test("Token-Budget: brain_kontext", async () => {
  const v = vault();
  const a = await rufe(v, "brain_kontext", { projekt: "kortex" });
  gib("kontext", a.length, GRENZE.kontext);
  assert.ok(a.length <= GRENZE.kontext, `${a.length}`);
  assert.ok((a.match(/^\d+\. /gm) || []).length <= 4);
});
