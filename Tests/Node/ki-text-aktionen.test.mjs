// KI-Text-Aktionen (K2), Werkstatt-Seite: der Sammler schickt NUR die Auswahl und die Überschrift darüber (byte-treu, auch mit CRLF und Umlauten), `ki: nein` blockt,
// feste Antworten der Attrappe (Ersatz, Aufgaben, Warnzeilen). Nie das echte `claude` (Tests/Kern/fake-claude-vorschlag.mjs).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pfad, schreibe } from "./hilfe.mjs";
import { szenarioV } from "./ki-vorschlag-hilfe.mjs";

const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
after(() => { beendeAlleProzesse(); });

const NOTIZ_CRLF = "---\r\ntitel: Plan\r\n---\r\n# Hauptüberschrift\r\n\r\nGeheimer Absatz davor mit Zahl 4711.\r\n\r\n## Große Pläne 🚀\r\n\r\nWir müssen Käse kaufen.\r\nUnd Brötchen nicht vergessen.\r\n\r\nGeheimer Absatz danach.\r\n";
const AUSWAHL = "Wir müssen Käse kaufen.\r\nUnd Brötchen nicht vergessen.";

test("Sammler: auf stdin stehen nur Aktion, Auswahl (byte-treu mit CRLF und Umlauten) und die Überschrift darüber, sonst nichts aus der Notiz", async () => {
  const s = szenarioV();
  schreibe(s.vault, "10_projekte/Plan.md", NOTIZ_CRLF);
  const { start, stand } = await s.anfrage({ funktion: "text", aktion: "umschreiben", pfad: "10_projekte/Plan.md", auswahl: AUSWAHL });
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  const roh = s.aufrufe()[0].stdin;
  const paket = JSON.parse(roh);
  assert.deepEqual(Object.keys(paket), ["aufgabe", "daten"]);
  assert.equal(paket.aufgabe, "umschreiben");
  assert.deepEqual(Object.keys(paket.daten).sort(), ["auswahl", "ueberschrift"]);
  assert.equal(paket.daten.auswahl, AUSWAHL, "byte-treu: CRLF, ä, ü, ö bleiben");
  assert.equal(paket.daten.ueberschrift, "Große Pläne 🚀", "die nächste Überschrift darüber, nicht die Hauptüberschrift");
  for (const nie of ["4711", "Geheimer Absatz", "titel: Plan", "Hauptüberschrift", "danach"]) assert.ok(!roh.includes(nie), `„${nie}“ darf nicht gesendet werden`);
  assert.equal(start.gesendet, roh, "„Was wird gesendet?“ zeigt genau das Paket");
  assert.equal(stand.ergebnis.funktion, "ersatz");
});

test("Sammler: ohne Überschrift darüber fehlt das Feld; Übersetzen schickt die Sprache aus der Liste", async () => {
  const s = szenarioV();
  schreibe(s.vault, "10_projekte/Kurz.md", "Nur ein Absatz ohne Überschrift.\n");
  await s.anfrage({ funktion: "text", aktion: "uebersetzen", sprache: "fr", pfad: "10_projekte/Kurz.md", auswahl: "Nur ein Absatz" });
  const paket = JSON.parse(s.aufrufe()[0].stdin);
  assert.deepEqual(Object.keys(paket.daten).sort(), ["auswahl", "sprache"]);
  assert.equal(paket.daten.sprache, "fr");
});

test("`ki: nein` blockt Text-Aktionen auch bei CRLF im Kopf; es wird nie ein Prozess gestartet", async () => {
  const s = szenarioV();
  schreibe(s.vault, "10_projekte/Privat.md", "---\r\nki: nein\r\n---\r\n# Privat\r\n\r\nGEHEIM-GEHEIM-GEHEIM\r\n");
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "text", aktion: "kuerzen", pfad: "10_projekte/Privat.md", auswahl: "GEHEIM-GEHEIM-GEHEIM", konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "ki-nein");
  assert.deepEqual(s.aufrufe(), []);
});

test("Ersatz mit neuem Link nach außen: die Werkstatt liefert die Warnzeile (Ziel ohne Schema), die Aufgabenliste kommt fest aus der Attrappe", async () => {
  const s = szenarioV();
  schreibe(s.vault, "10_projekte/Plan.md", NOTIZ_CRLF);
  s.szen({ ersatz: "Wir kaufen Käse bei [Laden](https://beispiel.example/kaese) ![x](bild.png)\n[[Neu]]" });
  let { stand } = await s.anfrage({ funktion: "text", aktion: "umschreiben", pfad: "10_projekte/Plan.md", auswahl: AUSWAHL });
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  const arten = stand.ergebnis.warnungen.map((w) => w.art).sort();
  assert.deepEqual(arten, ["bild", "link-extern", "wikilink"]);
  assert.deepEqual(stand.ergebnis.warnungen.find((w) => w.art === "link-extern").ziele, ["beispiel.example/kaese"]);
  s.szen({ aufgabenListe: [{ text: "Käse kaufen", beleg: "Käse kaufen", faellig: "2026-12-01" }, { text: "Brötchen holen", beleg: "Brötchen" }, { text: "Erfunden", beleg: "steht nirgends" }] });
  ({ stand } = await s.anfrage({ funktion: "text", aktion: "aufgaben", pfad: "10_projekte/Plan.md", auswahl: AUSWAHL }));
  assert.equal(stand.ergebnis.funktion, "aufgaben");
  assert.deepEqual(stand.ergebnis.aufgaben.map((a) => a.text), ["Käse kaufen", "Brötchen holen"], "eine Aufgabe ohne wörtlichen Beleg fällt weg");
  assert.equal(stand.ergebnis.verworfen, 1);
});
