// .tools/tests/test-vorschlaege-beleg.mjs — Vorschläge mit Beleg (B1, §4.1): Felder zitat/herkunft/fundstelle/quelle_url.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempVault } from "./verlauf-fixture.mjs";
import { schreibeVorschlag, listeVorschlaege, vorschlagOrdner } from "../vorschlaege.mjs";

const JETZT = new Date(Date.UTC(2026, 9, 21, 9, 0, 0));
const BELEG = { zitat: "Möhren säen ab Mitte April in Reihe 3.", herkunft: "tool", fundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00.000Z" };
const KOEDER = ["pass", "word"].join("") + "=Koeder123";

test("schreibeVorschlag: Beleg-Felder stehen vor erstellt, JSON-sicher; listeVorschlaege liefert sie", () => {
  const v = tempVault("Vorschlag Brän, Jo's");
  const id = schreibeVorschlag(v, { art: "fakt", titel: "Möhren", text: "Möhren ab Mitte April.", ordner: "/projekte/garten", sitzung: "sitzung-beleg",
    ...BELEG, zitat: "Er sagte \"Reihe 3\" \\ links", quelleUrl: "https://example.com/gartentipps" }, JETZT);
  const datei = readFileSync(join(vorschlagOrdner(v), `${id}.md`), "utf8");
  assert.match(datei, /\nquelle_sitzung: "sitzung-beleg"\nzitat: "Er sagte \\"Reihe 3\\" \\\\ links"\nherkunft: tool\nfundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00\.000Z"\nquelle_url: "https:\/\/example\.com\/gartentipps"\nerstellt: 2026-10-21T09:00:00Z\n/);
  const [v1] = listeVorschlaege(v);
  assert.equal(v1.zitat, "Er sagte \"Reihe 3\" \\ links");
  assert.equal(v1.herkunft, "tool");
  assert.equal(v1.fundstelle, BELEG.fundstelle);
  assert.equal(v1.quelleUrl, "https://example.com/gartentipps");
});

test("schreibeVorschlag: ohne Beleg bleibt alles wie bisher — keine neuen Schlüssel in listeVorschlaege", () => {
  const v = tempVault();
  schreibeVorschlag(v, { art: "fakt", titel: "Alt", text: "Altbestand." }, JETZT);
  const [x] = listeVorschlaege(v);
  assert.deepEqual(Object.keys(x).sort(), ["art", "erstellt", "id", "quelleOrdner", "text", "titel"]);
  schreibeVorschlag(v, { art: "stand", titel: "Stand", text: "Erledigt.", ...BELEG, herkunft: "du" }, JETZT);
  assert.ok(listeVorschlaege(v).some((y) => y.art === "stand" && y.herkunft === "du" && !("quelleUrl" in y)));
});

test("schreibeVorschlag: ungültiger Beleg → 400, nichts geschrieben", () => {
  const v = tempVault();
  const faelle = [
    { art: "lektion", titel: "L", text: "x", ...BELEG },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: "zwei\nZeilen" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: "z".repeat(301) },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: "   " },
    { art: "fakt", titel: "F", text: "x", ...BELEG, herkunft: "chef" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, fundstelle: "irgendwo" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, quelleUrl: "ftp://example.com/a" },
    { art: "fakt", titel: "F", text: "x", ...BELEG, quelleUrl: "https://example.com/" + "a".repeat(300) },
    { art: "fakt", titel: "F", text: "x", ...BELEG, zitat: `Das gilt: ${KOEDER}` },
  ];
  for (const f of faelle) assert.throws(() => schreibeVorschlag(v, f, JETZT), (e) => e.code === 400, JSON.stringify(f).slice(0, 80));
  assert.deepEqual(listeVorschlaege(v), []);
});
