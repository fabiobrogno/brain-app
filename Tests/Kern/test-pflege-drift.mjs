// .tools/tests/test-pflege-drift.mjs — B3 Task 3 (K4): Drift-Liste lesen, lebende Erwähnungen finden (ganzes Wort, nicht in
// Frontmatter/Code/Durchgestrichenem/Übergangssätzen), nur Wiki-Seiten, Lint-Zeilen, Vorschlags-Hinweis, Vorlage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, seitenText, KIT } from "./tageslauf-hilfe.mjs";
const D = await import("../tageslauf/drift.mjs");
isoliere();

const LISTE = "# Ausgemusterte Begriffe\n\n- Altdienst → Neudienst (seit 2026-10-01)\n- „Kanban-Brett“ -> Planungstafel\n- kaputt ohne Pfeil\n\n```\n- im Code → egal\n```\n";

test("leseDriftListe: Pfeile, Anführungszeichen, Zusatz in Klammern, unlesbare Zeile, Code zählt nicht", () => {
  const l = D.leseDriftListe(LISTE);
  assert.deepEqual(l.eintraege.map((e) => [e.alt, e.neu]), [["Altdienst", "Neudienst"], ["Kanban-Brett", "Planungstafel"]]);
  assert.deepEqual(l.fehler, [{ zeile: 5, text: "- kaputt ohne Pfeil" }]);
});

test("driftFunde: ganzes Wort, Groß/Klein egal; nicht in Frontmatter, Code, Durchgestrichenem, Übergangssätzen", () => {
  const { eintraege } = D.leseDriftListe(LISTE);
  const text = "---\ndescription: Altdienst\n---\n# X\n\nDer altdienst läuft.\nDer Altdienstplan ist etwas anderes.\n~~Altdienst~~ ist weg.\n"
    + "Neudienst (früher Altdienst) läuft.\n```\nAltdienst\n```\nDas Kanban-Brett hängt.\n";
  assert.deepEqual(D.driftFunde(text, eintraege), [{ alt: "Altdienst", neu: "Neudienst", zeile: 6 }, { alt: "Kanban-Brett", neu: "Planungstafel", zeile: 13 }]);
});

test("driftBefunde/driftLintZeilen: nur Wiki-Seiten, je Seite und Begriff einmal, ohne Zeilennummern", () => {
  const v = neuerTestVault({ seiten: {
    "09_wiki/_ausgemustert.md": LISTE,
    "09_wiki/wissen/a.md": seitenText({ fm: { name: "a", description: "A" }, rumpf: "# A\n\nAltdienst eins.\nAltdienst zwei.\n" }),
    "09_wiki/wissen/b.md": seitenText({ fm: { name: "b", description: "B" }, rumpf: "# B\n\nNeudienst.\n" }),
    "30_wissen/rohquelle.md": "Altdienst in der Rohquelle\n",
  } });
  assert.deepEqual(D.driftBefunde(v), [{ seite: "wissen/a.md", alt: "Altdienst", neu: "Neudienst" }]);
  assert.deepEqual(D.driftLintZeilen(v), [
    "DRIFT-LISTE: _ausgemustert.md — „- kaputt ohne Pfeil“ unlesbar (Format: - alter Begriff → neuer Begriff)",
    "DRIFT: wissen/a.md — „Altdienst“ ist ausgemustert → „Neudienst“",
  ]);
});

test("vorschlagDrift; ohne Liste nichts", () => {
  const { eintraege } = D.leseDriftListe(LISTE);
  assert.deepEqual(D.vorschlagDrift("Der Altdienst zieht um.", eintraege), { alt: "Altdienst", neu: "Neudienst" });
  assert.equal(D.vorschlagDrift("Nichts davon.", eintraege), null);
  const v = neuerTestVault();
  assert.deepEqual(D.ladeDriftListe(v), { eintraege: [], fehler: [], da: false });
  assert.deepEqual(D.driftLintZeilen(v), []);
});

test("Vorlage _ausgemustert.md: lesbar, ohne Einträge und ohne Fehler", () => {
  const t = readFileSync(join(KIT, "kit", "vorlage", "wiki", "_ausgemustert.md"), "utf8");
  const l = D.leseDriftListe(t);
  assert.deepEqual([l.eintraege, l.fehler], [[], []]);
});

// Zusatz zum Plan (Live-Brain: kein Fehlalarm): Zitate, Inline-Code und reine Link-Ziele sind keine lebenden Erwähnungen.
test("driftFunde: nicht in Zitaten (>), Inline-Code und Wikilink-Zielen; aber im Anzeigetext eines Links und im Fließtext", () => {
  const { eintraege } = D.leseDriftListe(LISTE);
  const text = "# X\n\n> Der Altdienst sagte damals nein.\n`Altdienst` ist ein Befehl.\nSiehe [[wissen/altdienst]] und [[wissen/altdienst#Teil|Altdienst-Seite]].\n"
    + "Siehe [[wissen/altdienst]].\nUnd Altdienst im Fließtext.\n";
  assert.deepEqual(D.driftFunde(text, eintraege).map((d) => d.zeile), [5, 7]);
});

test("Randfälle: Windows-Zeilenenden, BOM, leere/kaputte Eingaben, Sonderzeichen im Begriff", () => {
  const { eintraege, fehler } = D.leseDriftListe("﻿# L\r\n\r\n- Altdienst → Neudienst\r\n");
  assert.deepEqual([eintraege.length, fehler.length], [1, 0]);
  assert.deepEqual(D.driftFunde("Altdienst\r\n", eintraege).length, 1);
  assert.deepEqual(D.driftFunde(undefined, eintraege), []);
  assert.deepEqual(D.driftFunde("Altdienst", []), []);
  assert.deepEqual(D.driftFunde("Altdienst", undefined), []);
  assert.deepEqual(D.leseDriftListe(undefined), { eintraege: [], fehler: [] });
  assert.deepEqual(D.leseDriftListe("- Altdienst → Altdienst\n- → Neu\n- Alt →\n").eintraege, []);
  assert.equal(D.vorschlagDrift(null, eintraege), null);
  // Sonderzeichen im Begriff sind kein Regex
  const l = D.leseDriftListe("- C++ (alt) → Rust\n- a.b → c\n");
  assert.deepEqual(l.eintraege.map((e) => e.alt), ["C++", "a.b"]);
  assert.equal(D.driftFunde("Wir nutzen axb.\n", l.eintraege).length, 0);
  assert.equal(D.driftFunde("Wir nutzen a.b hier.\n", l.eintraege).length, 1);
});
