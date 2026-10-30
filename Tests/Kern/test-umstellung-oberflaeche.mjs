// test-umstellung-oberflaeche.mjs — Paket P7c, Kern-Teil: der Hinweis für die Menüleiste (status --json → umstellung), liegen gebliebene Probekopien finden und löschen, das Protokoll ohne Werte.
// Nur Wegwerf-Ordner (Fixture-Altvault mit eigenem HOME und Support-Ordner); der Hinweis liest nur, das Löschen trifft nur Ordner mit dem Namen dieses Vaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { altvault, GEHEIM } from "./fixture-altvault.mjs";
import { brainStatus } from "../status.mjs";
import { umstellungHinweis } from "../umstellung/hinweis.mjs";
import { leerZustand, schreibeZustand, protokolliere } from "../umstellung/protokoll.mjs";
import { probekopien, loescheProbekopien, planKopienLoeschen, protokollAnsicht } from "../umstellung/kopien.mjs";
import { kennung } from "../umstellung/ziele.mjs";

const ziel = (a) => ({ vault: a.vault, support: a.support, home: a.home, probe: false });

test("Hinweis: alter Werkzeug-Ordner im Vault → Altlasten; sauberer Vault nicht; nach Phase A nicht mehr", () => {
  const sauber = altvault();
  const alt = altvault({ faelle: ["kit-unversioniert"] });
  try {
    assert.deepEqual(umstellungHinweis(sauber.vault, { support: sauber.support }), { altlasten: false, phase: null });
    assert.deepEqual(umstellungHinweis(alt.vault, { support: alt.support }), { altlasten: true, phase: null });
    schreibeZustand(ziel(alt), { ...leerZustand(), phase: "A" });
    assert.deepEqual(umstellungHinweis(alt.vault, { support: alt.support }), { altlasten: false, phase: "A" }, "der Ordner bleibt bis zum Aufräumen liegen, der Hinweis nicht");
    schreibeZustand(ziel(alt), leerZustand());   // alles zurückgenommen
    assert.equal(umstellungHinweis(alt.vault, { support: alt.support }).altlasten, true);
  } finally { sauber.weg(); alt.weg(); }
});

test("status --json: Block „umstellung“ mit Altlasten und Phase, ohne Werte", async () => {
  const alt = altvault({ faelle: ["kit-versioniert"] });
  try {
    const s = await brainStatus(alt.vault, { support: alt.support });
    assert.deepEqual(s.umstellung, { altlasten: true, phase: null });
    assert.ok(!JSON.stringify(s).includes(GEHEIM));
    const ohne = altvault();
    try { assert.equal((await brainStatus(ohne.vault, { support: ohne.support })).umstellung.altlasten, false); } finally { ohne.weg(); }
  } finally { alt.weg(); }
});

test("Probekopien: nur echte Ordner mit dem Namen dieses Vaults; Löschen trifft nichts anderes", () => {
  const a = altvault({ faelle: ["kit-versioniert"] });
  const tmp = mkdtempSync(join(tmpdir(), "kopien-test-"));
  try {
    const z = ziel(a);
    const k = kennung(a.vault);
    const eine = join(tmp, `kortex-probelauf-${k}-AbC123`);
    mkdirSync(join(eine, "vault"), { recursive: true });
    writeFileSync(join(eine, "vault", "x.md"), "# x\n");
    const fremd = join(tmp, "kortex-probelauf-0000000000000000-zzz");        // anderer Vault
    mkdirSync(fremd);
    const verweis = join(tmp, `kortex-probelauf-${k}-Link`);                  // Verweis: nie anfassen
    symlinkSync(fremd, verweis);
    const datei = join(tmp, `kortex-probelauf-${k}-Datei`);                   // keine Ordner
    writeFileSync(datei, "");
    assert.deepEqual(probekopien(z, { tmp }).map((x) => x.ort), [eine]);
    assert.equal(planKopienLoeschen(z, { tmp }).anzahl, 1);
    assert.ok(existsSync(eine), "der Plan löscht nichts");
    assert.deepEqual(loescheProbekopien(z, { tmp }), { geloescht: 1, uebrig: 0 });
    assert.ok(!existsSync(eine));
    assert.ok(existsSync(fremd) && existsSync(datei) && existsSync(verweis), "Fremdes bleibt");
    assert.ok(existsSync(join(a.vault, "brain.config.json")), "das Original bleibt");
    assert.deepEqual(loescheProbekopien(z, { tmp }), { geloescht: 0, uebrig: 0 }, "zweiter Lauf: nichts mehr da");
  } finally { rmSync(tmp, { recursive: true, force: true }); a.weg(); }
});

test("Protokoll für die Oberfläche: nur Zeit, Lauf, Schritt, Ereignis, Anzahl, Grund; Ort mit ~ gekürzt; gekürzt nach 200 Zeilen", () => {
  const a = altvault({ faelle: ["kit-versioniert"] });
  try {
    const z = ziel(a);
    assert.deepEqual(protokollAnsicht(z).zeilen, []);
    protokolliere(z, { schritt: "A4", ereignis: "ok", anzahl: 3, sicherung: `sicherungen/${GEHEIM}`, hashVorher: GEHEIM, hashNachher: GEHEIM, grund: "fertig" });
    const p = protokollAnsicht(z);
    assert.equal(p.zeilen.length, 1);
    assert.deepEqual(Object.keys(p.zeilen[0]).sort(), ["anzahl", "ereignis", "grund", "lauf", "schritt", "zeit"]);
    assert.ok(!JSON.stringify(p).includes(GEHEIM));
    assert.equal(p.datei, "protokoll.jsonl");
    assert.equal(p.gekuerzt, false);
    for (let i = 0; i < 210; i++) protokolliere(z, { schritt: "A1", ereignis: "ok" });
    const lang = protokollAnsicht(z);
    assert.equal(lang.zeilen.length, 200);
    assert.equal(lang.gekuerzt, true);
    assert.equal(lang.gesamt, 211);
  } finally { a.weg(); }
});
