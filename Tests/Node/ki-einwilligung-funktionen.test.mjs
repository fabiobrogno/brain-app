// Einwilligung versionieren (docs/plaene/ki-runde.md, Abschnitt 14): die Einwilligung merkt die Funktionen, die der Dialog genannt hat. Eine später dazugekommene Funktion ist NICHT eingewilligt (fail-closed).
import test from "node:test";
import assert from "node:assert/strict";
import { szenarioV, K, EINTRAG, rmSync } from "./ki-vorschlag-hilfe.mjs";

const setzeFunktionen = (s, funktionen) => K.aendere(s.support, (alt) => {
  if (funktionen === undefined) delete alt.vaults[s.vault].vorschlaege.funktionen; else alt.vaults[s.vault].vorschlaege.funktionen = funktionen;
  return alt;
});
const holeDaten = (s) => K.liesKonten(s.support).daten;

test("Alte Einwilligung ohne `funktionen` gilt für genau die vier heutigen Funktionen", async () => {
  const s = szenarioV();
  try {
    assert.equal(holeDaten(s).vaults[s.vault].vorschlaege.funktionen, undefined, "das Szenario schreibt eine alte Einwilligung");
    const e = K.vorschlaegeFuer(holeDaten(s), s.vault);
    assert.equal(e.an, true);
    assert.deepEqual([...e.funktionen].sort(), ["erwaehnungen", "posteingang", "text", "zusammenfassung"]);
    assert.deepEqual(e.fehlend, []);
    const b = (await s.api("GET", "/api/ki/vorschlag/bereit")).j;
    assert.equal(b.einwilligung.an, true);
    assert.deepEqual(b.einwilligung.fehlend, []);
    assert.deepEqual([...b.funktionen].sort(), [...K.KI_FUNKTIONEN].sort(), "bereit meldet die zentrale Liste");
  } finally { rmSync(s.vault, { recursive: true, force: true }); }
});

test("Eine Funktion außerhalb der gespeicherten Liste fragt neu (409 einwilligung-funktion); die anderen laufen weiter", async () => {
  const s = szenarioV();
  try {
    await setzeFunktionen(s, ["posteingang", "text"]); // „zusammenfassung“ und „erwaehnungen“ kamen später dazu
    const b = (await s.api("GET", "/api/ki/vorschlag/bereit")).j.einwilligung;
    assert.equal(b.an, true);
    assert.deepEqual([...b.funktionen].sort(), ["posteingang", "text"]);
    assert.deepEqual([...b.fehlend].sort(), ["erwaehnungen", "zusammenfassung"]);
    let r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "zusammenfassung", konto: "k_aaaaaaaa" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung-funktion"); assert.equal(r.j.funktion, "zusammenfassung");
    r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "erwaehnungen", pfad: EINTRAG, konto: "k_aaaaaaaa" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung-funktion");
    assert.deepEqual(s.aufrufe(), [], "claude wurde nie gestartet");
    r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    await s.folge(r.j.id);
    // erneut einschalten (der Dialog) deckt alle Funktionen von heute
    r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: true, konto: "k_aaaaaaaa", vault: s.vault });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(r.j.fehlend, []);
    assert.deepEqual([...holeDaten(s).vaults[s.vault].vorschlaege.funktionen].sort(), [...K.KI_FUNKTIONEN].sort(), "in ki-konten.json gespeichert");
    r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "zusammenfassung", konto: "k_aaaaaaaa" });
    assert.notEqual(r.j.art, "einwilligung-funktion");
  } finally { rmSync(s.vault, { recursive: true, force: true }); }
});

test("Kaputte `funktionen` (kein Array, unbekannte Namen, leer) decken nichts Unbekanntes (fail-closed)", async () => {
  const s = szenarioV();
  try {
    for (const [roh, erwartet] of [["alle", []], [{ a: 1 }, []], [[], []], [["gibt-es-nicht", 5, null], []], [["text", "gibt-es-nicht"], ["text"]]]) {
      await setzeFunktionen(s, roh);
      const e = K.vorschlaegeFuer(holeDaten(s), s.vault);
      assert.equal(e.an, true);
      assert.deepEqual(e.funktionen, erwartet, JSON.stringify(roh));
      assert.equal(e.fehlend.length, K.KI_FUNKTIONEN.length - erwartet.length);
    }
    await setzeFunktionen(s, []);
    const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung-funktion");
  } finally { rmSync(s.vault, { recursive: true, force: true }); }
});

test("Einschalten speichert die Liste von heute; ausschalten löscht sie mit der Einwilligung", async () => {
  const s = szenarioV({ einwilligung: false });
  try {
    let r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: true, konto: "k_aaaaaaaa", vault: s.vault });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual([...holeDaten(s).vaults[s.vault].vorschlaege.funktionen].sort(), [...K.KI_FUNKTIONEN].sort());
    r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: false, vault: s.vault });
    assert.equal(r.j.an, false); assert.deepEqual(r.j.funktionen, []);
    assert.equal(K.vorschlaegeFuer(holeDaten(s), s.vault).an, false);
  } finally { rmSync(s.vault, { recursive: true, force: true }); }
});
