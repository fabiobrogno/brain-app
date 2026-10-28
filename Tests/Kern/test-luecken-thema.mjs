// .tools/tests/test-luecken-thema.mjs — Themen-Ausschluss (automatik.ernteOhneThema) bei Lücken und Fragespur (analyse.mjs): eine Frage,
// die ein ausgeschlossenes Wort nennt (oder deren Treffer-Seite es im Pfad trägt), wird ganz verworfen — auch ihre übrigen Stichwörter
// kommen nicht ins Log. Neutrales Wort (zebra), Temp-Vault, Temp-HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { merkeLuecke, merkeFragespur } from "../analyse.mjs";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain luecken thema home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });

const neuerVault = (automatik) => {
  const vault = join(mkdtempSync(join(tmpdir(), "brain luecken thema ")), "Mein Brain");
  mkdirSync(vault);
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ automatik }, null, 2) + "\n");
  return vault;
};
const datei = (v, n) => join(v, ".logs", n);
const inhalt = (v, n) => (existsSync(datei(v, n)) ? readFileSync(datei(v, n), "utf8") : "");

test("Kontrolle: ohne ausgeschlossenes Wort werden Lücke und Fragespur gemerkt", () => {
  const v = neuerVault({ luecken: true });
  assert.equal(merkeLuecke(v, "hint", "wo wohnt das zebra hans"), true);
  assert.equal(merkeFragespur(v, "wo wohnt das zebra hans", { sid: "sitzung-1", hits: ["09_wiki/tiere/thema_gehege.md"] }), true);
});

test("merkeLuecke: Treffer in der Frage → nichts gemerkt, auch die übrigen Stichwörter nicht; das Wort steht in keiner Datei", () => {
  const v = neuerVault({ luecken: true, ernteOhneThema: ["zebra"] });
  assert.equal(merkeLuecke(v, "hint", "Wo wohnt das Zebra Hans im Gehege?"), false);
  assert.equal(existsSync(datei(v, "luecken.log")), false);
  assert.equal(merkeLuecke(v, "hint", "Wo wohnt das Gnu Hans im Gehege?"), true, "andere Fragen laufen weiter");
  assert.doesNotMatch(inhalt(v, "luecken.log"), /zebra/i);
  assert.equal(merkeLuecke(v, "hint", "Wo ist der Zebrastreifen?"), true, "Teilwort trifft nicht");
});

test("merkeFragespur: Treffer in der Frage oder im Pfad einer Treffer-Seite → nichts gemerkt", () => {
  const v = neuerVault({ luecken: true, ernteOhneThema: ["zebra"] });
  assert.equal(merkeFragespur(v, "Wo wohnt das Zebra Hans?", { sid: "sitzung-1", hits: ["09_wiki/tiere/thema_gehege.md"] }), false);
  assert.equal(merkeFragespur(v, "Wo wohnt Hans?", { sid: "sitzung-1", hits: ["09_wiki/tiere/zebra/thema_gehege.md"] }), false, "Wort im Pfad (Ordnername)");
  assert.equal(merkeFragespur(v, "Wo wohnt Hans?", { sid: "sitzung-1", hits: ["09_wiki/tiere/thema_zebra.md"] }), false, "Wort im Dateinamen");
  assert.equal(existsSync(datei(v, "fragespur.log")), false);
  assert.equal(merkeFragespur(v, "Wo wohnt Hans?", { sid: "sitzung-1", hits: ["09_wiki/tiere/thema_gnu.md"] }), true);
  assert.doesNotMatch(inhalt(v, "fragespur.log"), /zebra/i);
});

test("kaputte Config bleibt fail-closed (nichts gemerkt)", () => {
  const v = neuerVault({});
  writeFileSync(join(v, "brain.config.json"), '{ "automatik": { "luecken": true, "ernteOhneThema": ["zebra"]');
  assert.equal(merkeLuecke(v, "hint", "harmlose frage"), false);
  assert.equal(existsSync(datei(v, "luecken.log")), false);
});
