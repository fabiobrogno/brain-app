// Parität: das Aktivitätsprotokoll hat zwei Hälften — gemeinsam/aktivitaet.mjs (Werkstatt, MCP-Server) und kern/aktivitaet.mjs (Hooks, Pflege, Sicherung).
// Der Kern importiert nichts aus gemeinsam/, darum ist der Abschnitt zwischen LOG-BEGINN und LOG-ENDE wortgleich; beide schreiben dieselbe Datei auf dieselbe Weise.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmp, pfad } from "./hilfe.mjs";

const abschnitt = (datei) => { const t = readFileSync(datei, "utf8"); const a = t.indexOf("// LOG-BEGINN"), b = t.indexOf("// LOG-ENDE"); assert.ok(a >= 0 && b > a, `Marken fehlen in ${datei}`); return t.slice(a, b); };

test("Der Abschnitt LOG-BEGINN … LOG-ENDE ist in beiden Dateien wortgleich", () => {
  assert.equal(abschnitt(pfad("kern", "aktivitaet.mjs")), abschnitt(pfad("gemeinsam", "aktivitaet.mjs")));
});

test("Beide Hälften schreiben und lesen dieselbe Datei gleich (Kennung, Zeile, Drossel, Rotation)", async () => {
  const G = await import(pfad("gemeinsam", "aktivitaet.mjs"));
  const K = await import(pfad("kern", "aktivitaet.mjs"));
  const support = tmp("akt-par-support-"), vault = tmp("akt-par-vault-");
  assert.equal(K.kennungVault(vault), G.kennungVault(vault));
  assert.deepEqual(K.ARTEN, G.ARTEN);
  const e = { art: "abweisung", grund: "gesperrt", konto: "k_0123abcd", programm: "claude", wer: "Claude Code", vaultName: "X", text: "wollte lesen.", zeit: "2026-10-31T08:00:00.000Z", id: "a_abcdef_123456" };
  const a = K.schreibeEreignis(support, vault, e), b = G.bereinige(e, { kennung: K.kennungVault(vault) });
  assert.deepEqual(a, b);
  // die Kern-Hälfte schreibt, die gemeinsame liest; und umgekehrt die Drossel über beide Hälften hinweg
  assert.deepEqual(G.leseEreignisse(support, G.kennungVault(vault)), [a]);
  assert.equal(G.schreibeEreignis(support, vault, { art: "abweisung", text: "x" }, { drossel: { schluessel: "s", sekunden: 600 } })?.art, "abweisung");
  assert.equal(K.schreibeEreignis(support, vault, { art: "abweisung", text: "x" }, { drossel: { schluessel: "s", sekunden: 600 } }), null);
  for (let i = 0; i < 30; i++) K.schreibeEreignis(support, vault, { art: "pflege", text: `n${i} ${"z".repeat(100)}` }, { maxBytes: 2000 });
  assert.equal(G.leseEreignisse(support, G.kennungVault(vault)).at(-1).text.startsWith("n29 "), true);
  assert.deepEqual(K.leseEreignisse(support, K.kennungVault(vault)), G.leseEreignisse(support, G.kennungVault(vault)));
});
