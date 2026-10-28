// .tools/tests/test-tageslauf-nachernte.mjs — Tageslauf-Schritt „Aufräumen“ nach der Nach-Ernte: ALTE Fakten ohne Zitat, deren Sitzung
// erfolgreich nachgeerntet wurde (Marke .logs/ernte/nachernte/<sid>, Status ok), wandern ins Archiv — Grund ersetzt-durch-nachernte.
// Nie gelöscht, im Probemodus nur gezählt. Temp-Vaults, fake-claude (kein echtes claude).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, fakeKi, schnappschuss, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
isoliere();
const A = await import("../tageslauf/aufraeumen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const E = await import("../ernte.mjs");
const { tageslauf } = await import("../tageslauf.mjs");

const vo = (id, titel, text, extra = {}) => ({ id, art: "fakt", titel, text, erstellt: "2026-10-20T10:00:00Z", quelleOrdner: "/p", quelleSitzung: "s9",
  unterordner: "_vorschlaege", herkunft: "", zitat: "", fundstelle: "", regel: "", wartenSeit: "", fm: {}, ...extra });
const ZEIT = "2026-10-21T08:00:00Z";
const ARCHIV = (v, grund, id) => join(v, "90_archiv", "vorschlaege-aussortiert", grund, `${id}.md`);

test("aufraeumKandidaten: alter Fakt ohne Zitat aus einer nachgeernteten Sitzung → ersetzt-durch-nachernte; alles andere bleibt", () => {
  const liste = [
    vo("alt1", "Bewässerung Hochbeet", "Das Hochbeet Nord wird morgens gegossen."),
    vo("alt-warten", "Kompostreife", "Der Kompost reift in sechs Monaten.", { unterordner: "_warten", wartenSeit: "2026-10-10T00:00:00Z" }),
    vo("mit-zitat", "Zaunfarbe", "Der Zaun ist grün gestrichen.", { zitat: "Der Zaun ist grün.", herkunft: "du", fundstelle: "s9#u1 ?" }),
    vo("neu-nach", "Regentonne", "Die Regentonne fasst 300 Liter.", { zitat: "Die Regentonne fasst 300 Liter.", herkunft: "du", fundstelle: "s9#u2 ?", fm: { nachernte: true } }),
    vo("nach-ohne-zitat", "Mulchschicht", "Die Mulchschicht ist fünf Zentimeter dick.", { fm: { nachernte: true } }),
    vo("andere-sitzung", "Lavendel", "Lavendel steht am Südhang.", { quelleSitzung: "s1" }),
    vo("ohne-sitzung", "Rosenschnitt", "Rosen werden im März geschnitten.", { quelleSitzung: "" }),
    vo("stand", "Stand Garten", "Beet 1 ist fertig.\n- Offen: Beet 2", { art: "stand" }),
    vo("lektion", "Wiederholte Korrektur: Tabs", "Immer Tabs nutzen.", { art: "lektion", erstellt: "2026-10-20T11:00:00Z" }),
  ];
  const r = Object.fromEntries(A.aufraeumKandidaten(liste, { jetzt: JETZT, nachgeerntet: new Set(["s9"]) }).map((x) => [x.v.id, x.grund]));
  assert.deepEqual(r, { alt1: "ersetzt-durch-nachernte", "alt-warten": "ersetzt-durch-nachernte" });
  assert.deepEqual(A.aufraeumKandidaten(liste, { jetzt: JETZT }), [], "ohne Marken bleibt alles liegen");
  assert.deepEqual(A.aufraeumKandidaten(liste, { jetzt: JETZT, nachgeerntet: new Set() }), []);
});

test("aufraeumen: liest die Marken aus dem Vault — nur Status ok zählt; Archiv statt Löschen; Probe verschiebt nichts und zählt nur", () => {
  const v = neuerTestVault();
  legeVorschlagAn(v, { id: "alt-ok", titel: "Bewässerung Hochbeet", text: "Das Hochbeet Nord wird morgens gegossen.", sitzung: "s9" });
  legeVorschlagAn(v, { id: "alt-kurz", titel: "Kompostreife", text: "Der Kompost reift in sechs Monaten.", sitzung: "s8" });
  legeVorschlagAn(v, { id: "alt-offen", titel: "Zaunfarbe", text: "Der Zaun ist grün gestrichen.", sitzung: "s7" });
  E.schreibeNachernteMarke(v, "s9", { status: "ok", vorschlaege: 2, zeit: ZEIT });
  E.schreibeNachernteMarke(v, "s8", { status: "uebersprungen", grund: "zu kurze Sitzung", zeit: ZEIT });
  legeVorschlagAn(v, { id: "alt-laeuft", titel: "Gießkanne", text: "Die Gießkanne hängt am Zaun.", sitzung: "s6" });
  E.schreibeNachernteMarke(v, "s6", { status: "laeuft", fenster: 4, fertig: [0], vorschlaege: 1, zeit: ZEIT });   // angefangen: noch nicht ersetzt
  const probe = P.neuerLauf(v, { probe: true, claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const rp = A.aufraeumen(probe, B.ladeVorschlaege(v));
  assert.equal(rp.aussortiert, 1);
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "alt-ok.md")), "Probe verschiebt nichts");
  assert.deepEqual(probe.aktionen.map((a) => [a.id, a.stufe, a.grund]), [["alt-ok", "aussortieren", "ersetzt-durch-nachernte"]]);
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const r = A.aufraeumen(ctx, B.ladeVorschlaege(v));
  assert.deepEqual([r.aussortiert, r.rest.map((x) => x.id).sort()], [1, ["alt-kurz", "alt-laeuft", "alt-offen"]]);
  assert.ok(existsSync(ARCHIV(v, "ersetzt-durch-nachernte", "alt-ok")));
  assert.ok(!existsSync(join(v, "00_inbox", "_vorschlaege", "alt-ok.md")));
  assert.match(readFileSync(ARCHIV(v, "ersetzt-durch-nachernte", "alt-ok"), "utf8"), /Hochbeet Nord/, "Inhalt bleibt erhalten, nichts gelöscht");
});

test("Tageslauf: Altbestand einer nachgeernteten Sitzung wird zuerst aufgeräumt (vor „Belege nachholen“, 0 KI-Aufrufe); Probe rechnet, ändert nichts, Bericht nennt den Grund", async () => {
  const v = neuerTestVault();
  legeVorschlagAn(v, { id: "alt-ok", titel: "Bewässerung Hochbeet", text: "Das Hochbeet Nord wird morgens gegossen.", sitzung: "s9" });
  legeVorschlagAn(v, { id: "alt-offen", titel: "Zaunfarbe", text: "Der Zaun ist grün gestrichen.", sitzung: "s7" });
  E.schreibeNachernteMarke(v, "s9", { status: "ok", vorschlaege: 1, zeit: ZEIT });
  const ki = fakeKi([]);
  const vorher = schnappschuss(v);
  const probe = await tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, probe: true });
  assert.equal(probe.modus, "probe");
  assert.equal(schnappschuss(v), vorher, "Probe schreibt nichts");
  assert.match(readFileSync(join(v, probe.bericht), "utf8"), /- ersetzt-durch-nachernte: 1\n/);
  assert.match(readFileSync(join(v, probe.bericht), "utf8"), /- kein-beleg: 1\n/, "die andere Sitzung läuft den alten Weg");
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "alt-ok.md")));

  const r = await tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(existsSync(ARCHIV(v, "ersetzt-durch-nachernte", "alt-ok")));
  assert.ok(existsSync(ARCHIV(v, "kein-beleg", "alt-offen")), "ohne Marke und ohne Transkript: wie bisher kein-beleg");
  assert.ok(!existsSync(join(v, "00_inbox", "_vorschlaege", "alt-ok.md")));
  assert.equal(ki.anzahl(), 0);
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /- ersetzt-durch-nachernte: 1\n/);
  const aktion = P.leseAktionen(v).find((a) => a.id === "alt-ok");
  assert.deepEqual([aktion.stufe, aktion.grund], ["aussortieren", "ersetzt-durch-nachernte"]);
});
