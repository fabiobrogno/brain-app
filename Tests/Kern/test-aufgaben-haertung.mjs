// Aufgaben — Härtung nach dem Review von PR #50: Ordnerregel, Größen, Mengen, Dateinamen, Groß/Klein, Block-Felder, gleichzeitiges Ändern.
// Grundlagen (Format, Rang, CLI) stehen in test-aufgaben.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../aufgaben.mjs";
import { ordner } from "../pfade.mjs";

const vault = (cfg = {}) => { const v = mkdtempSync(join(tmpdir(), "aufgaben h ")); writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg)); return v; };
const T0 = new Date("2026-10-30T10:00:00Z");

test("1 Ordnerregel: kein versteckter Ordner, nie inbox/wiki/archiv (auch nicht deren konfigurierte Namen, Groß/Klein egal) — sonst Standard", () => {
  const v = (aufgaben, o = {}) => ordner(vault({ ordner: { aufgaben, ...o } })).aufgaben;
  for (const schlecht of [".git", ".claude", ".logs", "..", ".versteckt", "09_wiki", "00_inbox", "90_archiv", "09_WIKI", "Node_Modules"]) assert.equal(v(schlecht), "05_aufgaben", schlecht);
  assert.equal(v("wissen", { wiki: "wissen" }), "05_aufgaben", "der konfigurierte Wiki-Name ist belegt");
  assert.equal(v("Eingang", { inbox: "eingang" }), "05_aufgaben", "auch der konfigurierte Inbox-Name, Groß/Klein egal");
  assert.equal(v("Archiv-Neu", { archiv: "archiv-neu" }), "05_aufgaben");
  assert.equal(v("todo"), "todo");
  assert.equal(A.ordnerName(vault({ ordner: { aufgaben: ".git" } })), "05_aufgaben");
});

test("1 Ordnerregel: ein Aufgaben-Ordner, der als Verweis auf einen anderen Ordner im Vault (z. B. das Wiki) zeigt, wird nie benutzt", () => {
  const v = vault();
  mkdirSync(join(v, "09_wiki")); writeFileSync(join(v, "09_wiki", "thema.md"), "# Thema\n");
  symlinkSync(join(v, "09_wiki"), join(v, "05_aufgaben"));
  const nein = (fn) => assert.throws(fn, (x) => x instanceof A.AufgabeFehler && x.code === 403 && /Verweis/.test(x.message));
  nein(() => A.legeAn(v, { titel: "Böse" })); nein(() => A.liste(v)); nein(() => A.aendere(v, "05_aufgaben/thema.md", { status: "erledigt" })); nein(() => A.zaehle(v));
  assert.deepEqual(readdirSync(join(v, "09_wiki")), ["thema.md"], "ins Wiki wurde nichts geschrieben");
});

test("2 Größen: Text in UTF-8-Bytes begrenzt, Bezüge begrenzt und einzeilig, die geschriebene Datei bleibt unter der Lesegrenze", () => {
  const nein = (e, re) => assert.throws(() => A.pruefeEingabe(e), (x) => x instanceof A.AufgabeFehler && re.test(x.message));
  nein({ text: "ä".repeat(50_001) }, /zu lang/);                       // 50 001 Zeichen, aber 100 002 Bytes
  assert.equal(A.pruefeEingabe({ text: "ä".repeat(50_000) }).text.length, 50_000);
  const b = A.pruefeEingabe({ bezug: Array.from({ length: 50 }, (_, i) => `Seite ${i}\nmit Umbruch`.padEnd(500, "x")) }).bezug;
  assert.equal(b.length, 20); assert.ok(b.every((x) => x.length <= 200 && !/\n/.test(x)));
  assert.ok(A.parseAufgabe(A.baueText(A.pruefeEingabe({ titel: "T", bezug: b })), "x.md").bezug.every((x) => x.length <= 200));
  const v = vault();
  const r = A.legeAn(v, { titel: "Groß", text: "😀".repeat(24_000), bezug: b }, { jetzt: T0 });   // 96 000 Bytes Text
  assert.ok(Buffer.byteLength(readFileSync(join(v, r.pfad), "utf8")) < 256 * 1024 - 16 * 1024);
  assert.equal(A.liste(v).length, 1, "und sie wird wieder gelesen");
  // Eine Änderung, die eine Datei über die Lesegrenze triebe, wird abgelehnt (sonst wäre die Aufgabe danach unsichtbar)
  const grenze = 256 * 1024, kopf = "---\ntyp: aufgabe\ntitel: Rand\nstatus: offen\n---\n";
  writeFileSync(join(v, "05_aufgaben", "rand.md"), kopf + "x".repeat(grenze - Buffer.byteLength(kopf) - 3) + "\n");
  assert.ok(A.liste(v).some((a) => a.titel === "Rand"));
  assert.throws(() => A.aendere(v, "05_aufgaben/rand.md", { status: "erledigt" }), (x) => x instanceof A.AufgabeFehler && x.code === 422 && /zu groß/.test(x.message));
  assert.match(readFileSync(join(v, "05_aufgaben", "rand.md"), "utf8"), /status: offen/);
});

test("3 Menge: liste meldet abgeschnitten, legeAn weigert sich darüber, Köpfe werden ohne die großen Texte gelesen", () => {
  const v = vault(); const o = join(v, "05_aufgaben"); mkdirSync(o);
  const kopf = (t, r) => `---\ntyp: aufgabe\ntitel: ${t}\nstatus: offen\nrang: ${r}\n---\n`;
  for (let i = 0; i < A.MAX_DATEIEN + 3; i++) writeFileSync(join(o, `2026-01-01-a${String(i).padStart(5, "0")}.md`), kopf(`T${i}`, i));
  const l = A.liste(v, { kopf: true });
  assert.equal(l.length, A.MAX_DATEIEN); assert.equal(l.abgeschnitten, true);
  assert.deepEqual(A.liste(vault(), { kopf: true }).abgeschnitten, false);
  assert.throws(() => A.legeAn(v, { titel: "Eine zu viel" }), (x) => x instanceof A.AufgabeFehler && x.code === 409 && /mehr als/.test(x.message));
  // Rang kommt aus den Köpfen: eine Datei mit riesigem Text wird nicht ganz gelesen
  const w = vault(); mkdirSync(join(w, "05_aufgaben"));
  writeFileSync(join(w, "05_aufgaben", "2026-10-01-gross.md"), kopf("Groß", 7000) + "text ".repeat(40_000));
  const k = A.liste(w, { kopf: true });
  assert.deepEqual([k[0].titel, k[0].rang, k[0].text], ["Groß", 7000, ""]);
  assert.equal(A.liste(w)[0].text.length > 1000, true);
  assert.equal(A.legeAn(w, { titel: "Neu" }, { jetzt: T0 }).aufgabe.rang, 8000);
  assert.deepEqual(A.zaehle(w, "2026-10-30"), { offen: 2, ueberfaellig: 0 });
  // Kopf länger als der gelesene Anfang: es gilt die ganze Datei
  const lang = `---\ntyp: aufgabe\ntitel: Lang\nstatus: warten\nbezug: [${Array.from({ length: 20 }, (_, i) => `"[[${"s".repeat(180)}${i}]]"`).join(", ")}]\nrang: 3\n---\nText\n`;
  writeFileSync(join(w, "05_aufgaben", "2026-10-02-lang.md"), lang);
  const lg = A.liste(w, { kopf: true }).find((a) => a.titel === "Lang");
  assert.deepEqual([lg.status, lg.rang, lg.bezug.length], ["warten", 3, 20]);
});

test("5 und 9: Dateinamen mit Zeilenumbruch/Steuer-/Bidi-Zeichen werden übersprungen; Titel ohne C1- und Bidi-Zeichen", () => {
  const v = vault(); A.legeAn(v, { titel: "Normal" }, { jetzt: T0 });
  const o = join(v, "05_aufgaben"), inhalt = "---\ntyp: aufgabe\ntitel: Fremd\n---\n";
  for (const n of ["2026-10-30-a\nb.md", "2026-10-30-c‮d.md", "2026-10-30-e\u0085f.md", "2026-10-30-g⁦h.md"]) writeFileSync(join(o, n), inhalt);
  assert.deepEqual(A.liste(v).map((a) => a.titel), ["Normal"]);
  assert.throws(() => A.aendere(v, "05_aufgaben/2026-10-30-a\nb.md", { status: "erledigt" }), (x) => x.code === 400);
  assert.equal(A.zeile({ status: "offen", prioritaet: "normal", pfad: "05_aufgaben/x\ny‮.md", titel: "T" }), "[offen] 05_aufgaben/x y.md T");
  assert.equal(A.pruefeEingabe({ titel: "a\u0085b‮c‏d⁦e⁩f\u009fg" }).titel, "a bcdef g");
  assert.equal(A.parseAufgabe("---\ntyp: aufgabe\ntitel: \"x‮y\"\n---\n", "x.md").titel, "xy");
});

test("7 Groß/Klein zwischen Konfiguration und Platte: der Ordner heißt, wie er auf der Platte heißt; Pfade in beiden Schreibweisen gehen", () => {
  const v = vault({ ordner: { aufgaben: "Todo" } });
  mkdirSync(join(v, "todo")); writeFileSync(join(v, "todo", "2026-10-30-x.md"), "---\ntyp: aufgabe\ntitel: X\nstatus: offen\n---\n");
  assert.deepEqual(A.liste(v).map((a) => a.pfad), ["todo/2026-10-30-x.md"]);
  assert.equal(A.legeAn(v, { titel: "Y" }, { jetzt: T0 }).pfad, "todo/2026-10-30-y.md");
  for (const pfad of ["todo/2026-10-30-x.md", "Todo/2026-10-30-x.md"]) {
    const r = A.aendere(v, pfad, { status: "warten" }); assert.equal(r.pfad, "todo/2026-10-30-x.md"); assert.equal(r.aufgabe.status, "warten");
  }
  assert.equal(A.findePfad(v, "TODO/2026-10-30-X.md"), "todo/2026-10-30-x.md");
  assert.equal(readdirSync(v).filter((n) => n.toLowerCase() === "todo").length, 1, "kein zweiter Ordner");
});

test("8 setzeFelder und Lesen: Block-Listen und Block-Skalare — Folgezeilen werden mit ersetzt, nie als Waisen stehen gelassen", () => {
  const alt = '---\ntyp: aufgabe\ntitel: >\n  Ein langer\n  Titel\nstatus: offen\nbezug:\n  - "[[A]]"\n  - "[[B]]"\nfaellig: 2026-11-01\nrang: 5\n---\nText\n';
  const a = A.parseAufgabe(alt, "x.md");
  assert.deepEqual([a.titel, a.bezug, a.faellig], ["Ein langer Titel", ["A", "B"], "2026-11-01"]);
  const neu = A.setzeFelder(alt, { titel: "Neuer Titel", bezug: ["C"] }, T0);
  assert.equal(neu, '---\ntyp: aufgabe\ntitel: Neuer Titel\nstatus: offen\nbezug: ["[[C]]"]\nfaellig: 2026-11-01\nrang: 5\ngeaendert: 2026-10-30T10:00:00Z\n---\nText\n');
  assert.deepEqual(A.parseAufgabe(neu, "x.md").bezug, ["C"]);
  const weg = A.setzeFelder(alt, { bezug: [] }, T0);
  assert.doesNotMatch(weg, /\[\[|bezug|^\s+- /m); assert.equal(A.parseAufgabe(weg, "x.md").titel, "Ein langer Titel");
  // Liste ohne Einrückung („- “ gleich am Rand); der nächste Schlüssel bleibt unberührt
  const flach = "---\ntyp: aufgabe\ntitel: T\nbezug:\n- \"[[A]]\"\n- \"[[B]]\"\nstatus: warten\n---\n";
  assert.deepEqual(A.parseAufgabe(flach, "x.md").bezug, ["A", "B"]);
  const f2 = A.setzeFelder(flach, { bezug: ["Z"] }, T0);
  assert.match(f2, /\nbezug: \["\[\[Z\]\]"\]\nstatus: warten\n/); assert.doesNotMatch(f2, /^- /m);
  const crlf = A.setzeFelder(alt.replace(/\n/g, "\r\n"), { titel: "Neu" }, T0);
  assert.ok(!/[^\r]\n/.test(crlf) && /titel: Neu\r\nstatus: offen\r\n/.test(crlf));
});

test("10 Gleichzeitiges Ändern: ändert ein anderer Prozess die Datei zwischen Lesen und Schreiben, bleibt dessen Änderung erhalten", () => {
  const v = vault(); const a = A.legeAn(v, { titel: "A", text: "Details" }, { jetzt: T0 });
  const abs = join(v, a.pfad);
  const r = A.aendere(v, a.pfad, { status: "warten" }, { zwischen: () => writeFileSync(abs, readFileSync(abs, "utf8").replace("prioritaet: normal", "prioritaet: hoch").replace("Details", "Details\n\nNachtrag")) });
  assert.equal(r.aufgabe.status, "warten");
  assert.equal(r.aufgabe.prioritaet, "hoch", "die Änderung des anderen Prozesses ist nicht überschrieben");
  assert.match(readFileSync(abs, "utf8"), /Nachtrag/);
});
