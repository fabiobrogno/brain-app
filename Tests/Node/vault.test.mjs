import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, symlinkSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler, pruefeText, slug } = await import(pfad("gemeinsam", "vault.mjs"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const status = (fn) => { try { fn(); return 200; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e.status; } };

function vault() {
  const d = tmp();
  schreibe(d, "00_inbox/alt.md", "# Alt\n");
  schreibe(d, "09_wiki/firma/thema_a.md", "---\nname: a\n---\n# Thema A\nInhalt\n");
  schreibe(d, ".tools/geheim.md", "# nein\n");
  schreibe(d, ".git/config", "x");
  schreibe(d, "node_modules/x.md", "# nein\n");
  return { d, v: oeffneVault(d, { heute: "2026-10-24" }) };
}

test("Pfad-Schutz: .., absolut, .git, .tools, node_modules, Punkt-Dateien", () => {
  const { v } = vault();
  for (const p of ["../x.md", "a/../../x.md", "/etc/passwd", "~/x.md", "C:/x.md", ".git/config", ".tools/geheim.md", "node_modules/x.md", "a/.versteckt.md"]) {
    assert.equal(status(() => v.lies(p)), 403, p);
    assert.equal(status(() => v.schreibe({ pfad: p, inhalt: "x", basisHash: null })), 403, p);
  }
  assert.equal(status(() => v.lies("")), 400);
  assert.equal(status(() => v.lies("a\\b.md")), 400);
  assert.equal(status(() => v.lies(undefined)), 400);
  assert.equal(status(() => v.lies("nix.md")), 404);
});

test("Pfad-Schutz: Symlink nach draußen (Datei und Ordner) wird abgewiesen", () => {
  const { d, v } = vault();
  const draussen = tmp("brain-draussen-");
  schreibe(draussen, "geheim.md", "# geheim\n");
  symlinkSync(join(draussen, "geheim.md"), join(d, "link.md"));
  symlinkSync(draussen, join(d, "ordnerlink"));
  assert.equal(status(() => v.lies("link.md")), 403);
  assert.equal(status(() => v.lies("ordnerlink/geheim.md")), 403);
  assert.equal(status(() => v.schreibe({ pfad: "ordnerlink/neu.md", inhalt: "x", basisHash: null })), 403);
  assert.equal(existsSync(join(draussen, "neu.md")), false);
  const baum = v.baum().eintraege.map((e) => e.pfad);
  assert.ok(!baum.includes("link.md") && !baum.includes("ordnerlink"));
  // Symlink innerhalb des Vaults ist erlaubt
  symlinkSync(join(d, "00_inbox", "alt.md"), join(d, "intern.md"));
  assert.equal(v.lies("intern.md").inhalt, "# Alt\n");
});

test("Baum: Ordner zuerst, ohne Versteckte, mit Feldern", () => {
  const { v } = vault();
  const b = v.baum().eintraege;
  const pfade = b.map((e) => e.pfad);
  assert.deepEqual(pfade, ["00_inbox", "00_inbox/alt.md", "09_wiki", "09_wiki/firma", "09_wiki/firma/thema_a.md"]);
  assert.equal(b[0].art, "ordner");
  const f = b[1];
  assert.equal(f.art, "datei"); assert.equal(f.groesse, 6); assert.equal(f.schreibschutz, false);
  assert.match(f.geaendert, /^\d{4}-\d\d-\d\dT/);
});

test("Schreibschutz: generierte Dateien (Namen, _*.md im Wiki, Kopfzeile) und Nicht-Text", () => {
  const { d, v } = vault();
  schreibe(d, "INDEX.md", "# Index\n");
  schreibe(d, "09_wiki/_index.md", "# Wiki-Verzeichnis (generiert — nicht editieren)\n");
  schreibe(d, "09_wiki/firma/_firma.md", "# egal\n");
  schreibe(d, "09_wiki/_schema.md", "# Schema\n");
  schreibe(d, "notiz.md", "# Notiz\n\nzweite\n\ndritte Zeile: generiert — nicht editieren\n");
  schreibe(d, "auto.md", "# Auto\n\n> generiert — nicht editieren\n");
  schreibe(d, "graph.json", "{}");
  schreibe(d, "bild.png", "x");
  const sp = Object.fromEntries(v.baum().eintraege.filter((e) => e.art === "datei").map((e) => [e.pfad, e.schreibschutz]));
  assert.equal(sp["INDEX.md"], true); assert.equal(sp["09_wiki/_index.md"], true); assert.equal(sp["09_wiki/firma/_firma.md"], true);
  assert.equal(sp["09_wiki/_schema.md"], false); assert.equal(sp["notiz.md"], false); assert.equal(sp["auto.md"], true);
  assert.equal(sp["graph.json"], true); assert.equal(sp["bild.png"], true);
  assert.equal(v.lies("INDEX.md").schreibschutz, true);
  for (const p of ["INDEX.md", "09_wiki/_index.md", "09_wiki/firma/_firma.md", "auto.md"]) {
    assert.equal(status(() => v.schreibe({ pfad: p, inhalt: "x", basisHash: v.lies(p).hash })), 403, p);
  }
  assert.equal(status(() => v.schreibe({ pfad: "bild.png", inhalt: "x", basisHash: null })), 403);
  assert.equal(status(() => v.lies("bild.png")), 415);
  assert.equal(readFileSync(join(d, "INDEX.md"), "utf8"), "# Index\n");
});

test("Hash-Konflikt: 409 mit aktuellerHash, kein Überschreiben", () => {
  const { d, v } = vault();
  const l = v.lies("00_inbox/alt.md");
  assert.equal(l.hash, sha(Buffer.from("# Alt\n")));
  writeFileSync(join(d, "00_inbox/alt.md"), "# Von außen geändert\n");
  try { v.schreibe({ pfad: "00_inbox/alt.md", inhalt: "# Meins\n", basisHash: l.hash }); assert.fail("kein 409"); }
  catch (e) { assert.equal(e.status, 409); assert.equal(e.extra.aktuellerHash, sha(Buffer.from("# Von außen geändert\n"))); }
  assert.equal(readFileSync(join(d, "00_inbox/alt.md"), "utf8"), "# Von außen geändert\n");
  // mit dem neuen Hash klappt es
  const r = v.schreibe({ pfad: "00_inbox/alt.md", inhalt: "# Meins\n", basisHash: sha(Buffer.from("# Von außen geändert\n")) });
  assert.equal(r.hash, sha(Buffer.from("# Meins\n")));
});

test("Neu anlegen: basisHash null → 409 wenn vorhanden; fehlende Datei mit Hash → 404; Eingabe geprüft", () => {
  const { d, v } = vault();
  assert.equal(status(() => v.schreibe({ pfad: "00_inbox/alt.md", inhalt: "x", basisHash: null })), 409);
  assert.equal(status(() => v.schreibe({ pfad: "00_inbox/weg.md", inhalt: "x", basisHash: "abc" })), 404);
  assert.equal(status(() => v.schreibe({ pfad: "00_inbox/x.md", inhalt: 5, basisHash: null })), 400);
  assert.equal(status(() => v.schreibe({ pfad: "00_inbox/x.md", inhalt: "x" })), 400);
  assert.equal(status(() => v.schreibe({ pfad: "00_inbox/x.exe", inhalt: "x", basisHash: null })), 403);
  const r = v.schreibe({ pfad: "tief/er/neu.md", inhalt: "# neu\n", basisHash: null });
  assert.ok(r.hash);
  assert.equal(readFileSync(join(d, "tief/er/neu.md"), "utf8"), "# neu\n");
  assert.deepEqual(readdirSync(join(d, "tief/er")), ["neu.md"], "keine Temp-Reste");
});

test("Schreiben ist bytegleich: CRLF, Emoji, Frontmatter, ohne Schluss-Newline, BOM", () => {
  const { d, v } = vault();
  const faelle = {
    "crlf.md": "# Titel\r\n\r\nZeile eins\r\nZeile zwei\r\n",
    "emoji.md": "# 🧠 Gehirn 👩‍👩‍👧 ✓\n\nÄÖÜ ß — „Zitat“\n",
    "front.md": "---\nname: x\nquellen: [\"a\"]\n---\n\n# H\n",
    "ohne.md": "# Ohne Schluss",
    "leer.md": "",
    "bom.md": "\uFEFF# Mit BOM\n",
    "gemischt.md": "a\r\nb\nc\r\n\n\n  eingerückt\t\n",
  };
  for (const [name, inhalt] of Object.entries(faelle)) {
    const r = v.schreibe({ pfad: name, inhalt, basisHash: null });
    const bytes = readFileSync(join(d, name));
    assert.ok(bytes.equals(Buffer.from(inhalt, "utf8")), name);
    assert.equal(r.hash, sha(bytes), name);
    const l = v.lies(name);
    assert.equal(l.inhalt, inhalt, name); assert.equal(l.hash, r.hash, name);
    // überschreiben mit anderem Inhalt, dann zurück
    const r2 = v.schreibe({ pfad: name, inhalt: inhalt + "x", basisHash: r.hash });
    const r3 = v.schreibe({ pfad: name, inhalt, basisHash: r2.hash });
    assert.ok(readFileSync(join(d, name)).equals(Buffer.from(inhalt, "utf8")), name + " zurück");
    assert.equal(r3.hash, r.hash);
  }
});

test("Ungültiges UTF-8 wird nicht geöffnet (kein stilles Umwandeln)", () => {
  const { d, v } = vault();
  writeFileSync(join(d, "kaputt.md"), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
  assert.equal(status(() => v.lies("kaputt.md")), 415);
});

test("Neu: Datei <ordner>/<slug>.md mit Überschrift; Namensgleichheit -2", () => {
  const { d, v } = vault();
  const a = v.neu({ ordner: "00_inbox", titel: "Größe & Ärger!" });
  assert.equal(a.pfad, "00_inbox/groesse-aerger.md");
  assert.equal(readFileSync(join(d, a.pfad), "utf8"), "# Größe & Ärger!\n");
  assert.equal(v.neu({ ordner: "00_inbox", titel: "Größe & Ärger!" }).pfad, "00_inbox/groesse-aerger-2.md");
  assert.equal(v.neu({ ordner: "", titel: "Wurzel" }).pfad, "wurzel.md");
  assert.equal(v.neu({ ordner: "neuer/ordner", titel: "X" }).pfad, "neuer/ordner/x.md");
  assert.equal(status(() => v.neu({ ordner: "../draussen", titel: "X" })), 403);
  assert.equal(status(() => v.neu({ ordner: ".git", titel: "X" })), 403);
  assert.equal(status(() => v.neu({ ordner: "a", titel: "  " })), 400);
});

test("Merken: Format wie Inbox, Datum Berliner Zeit, -2/-3, nie überschreiben, nur 00_inbox", () => {
  const d = tmp();
  const v = oeffneVault(d, { jetzt: () => new Date("2026-10-24T22:30:00Z") }); // = 25.10. 00:30 Berlin
  const a = v.merken({ text: "Erste Idee\nmit zweiter Zeile", titel: "Meine Idee" });
  assert.equal(a.pfad, "00_inbox/2026-10-25_meine-idee.md");
  assert.equal(readFileSync(join(d, a.pfad), "utf8"), "# Meine Idee\n\nErste Idee\nmit zweiter Zeile\n");
  assert.equal(v.merken({ text: "Zweite", titel: "Meine Idee" }).pfad, "00_inbox/2026-10-25_meine-idee-2.md");
  assert.equal(v.merken({ text: "Dritte", titel: "Meine Idee" }).pfad, "00_inbox/2026-10-25_meine-idee-3.md");
  assert.equal(readFileSync(join(d, a.pfad), "utf8").includes("Zweite"), false);
  const ohneTitel = v.merken({ text: "Kaufe Milch für Müller\nund Brot" });
  assert.equal(ohneTitel.pfad, "00_inbox/2026-10-25_kaufe-milch-fuer-mueller.md");
  assert.match(readFileSync(join(d, ohneTitel.pfad), "utf8"), /^# Kaufe Milch für Müller\n\nKaufe Milch für Müller\nund Brot\n$/);
  const mitKopf = v.merken({ text: "# Eigene Überschrift\n\nText" });
  assert.equal(readFileSync(join(d, mitKopf.pfad), "utf8"), "# Eigene Überschrift\n\nText\n");
  assert.equal(status(() => v.merken({ text: "  " })), 400);
  assert.deepEqual(readdirSync(d), ["00_inbox"]);
  assert.equal(slug("???"), "notiz");
});

test("Suche: Umlaute, groß/klein, Titel zuerst, max 30, Auszug und Zeile", () => {
  const d = tmp();
  schreibe(d, "a.md", "# Allgemeines\n\nHier steht etwas über Überstunden und Ärger im Büro.\n");
  schreibe(d, "b.md", "# Ärger mit Amazon\n\nnichts weiter\n");
  schreibe(d, "c.md", "Kein Titel, aber AMAZON-Konto hier.\n");
  schreibe(d, "09_wiki/_index.md", "# generiert — nicht editieren\namazon amazon\n");
  schreibe(d, ".tools/x.md", "# amazon\n");
  for (let i = 0; i < 40; i++) schreibe(d, `viele/n${i}.md`, `# Seite ${i}\nfoo bar ${i}\n`);
  const v = oeffneVault(d);
  let t = v.suche("ärger").treffer;
  assert.deepEqual(t.map((x) => x.pfad), ["b.md", "a.md"], "Titel-Treffer zuerst");
  assert.equal(t[1].zeile, 3); assert.match(t[1].auszug, /Ärger im Büro/); assert.equal(t[0].titel, "Ärger mit Amazon");
  assert.deepEqual(v.suche("ÜBERSTUNDEN").treffer.map((x) => x.pfad), ["a.md"]);
  t = v.suche("amazon").treffer;
  assert.deepEqual(t.map((x) => x.pfad), ["b.md", "c.md"], "generierte und versteckte Dateien nie");
  assert.equal(v.suche("foo").treffer.length, 30);
  assert.deepEqual(v.suche("über büro").treffer.map((x) => x.pfad), ["a.md"], "mehrere Wörter = UND");
  assert.deepEqual(v.suche("   ").treffer, []);
  assert.deepEqual(v.suche("gibtesnicht").treffer, []);
});

// ---------- Prüf-Signale ----------
const WIKI = "09_wiki/firma/thema_x.md";
const kopf = (extra = "") => `---\nname: x\ndescription: d\ntyp: thema\nquellen: ["a"]\nquellen_sha: ["0123456789abcdef"]\nrev: 1\n${extra}---\n`;
const heute = { heute: "2026-10-24" };
const arten = (r) => r.signale.map((s) => s.art);

test("Prüfung: außerhalb 09_wiki ist grau; _-Dateien grau", () => {
  const r = pruefeText("00_inbox/x.md", "# x", heute);
  assert.equal(r.stufe, "grau"); assert.match(r.zusammenfassung, /ingest/);
  assert.equal(pruefeText("09_wiki/_index.md", "# x", heute).stufe, "grau");
});

test("Prüfung: grün mit belegten Fakten und Zusatzsignalen (kritisch, Stand)", () => {
  const text = kopf("stand: 2026-10-01\nkritisch: true\npruefen_bis: 2026-12-31\n") +
    "# X\n\n- Ein Fakt · Stand 21.10.2026 · [[firma/amazon/belege/2026-10/b1]]\n- Noch einer · Stand 22.10.2026 · [[firma/amazon/belege/2026-10/b2]]\n- Hand-Stichpunkt (Stand 19.10.)\n";
  const r = pruefeText(WIKI, text, heute);
  assert.equal(r.stufe, "gruen");
  assert.deepEqual(arten(r).sort(), ["belegt", "kritisch", "stand"]);
  assert.match(r.signale.find((s) => s.art === "belegt").text, /^2 belegte/);
  assert.match(r.zusammenfassung, /2 belegte/);
  assert.doesNotMatch(r.zusammenfassung, /stimmt/i);
});

test("Prüfung: rot bei Konflikt-Kasten (mit Zeile) und PRÜFBEDÜRFTIG, nicht in Code-Blöcken", () => {
  const k = pruefeText(WIKI, kopf() + "# X\n\n> [!KONFLIKT] offen — Du entscheidest\n> A: \"1\" — Quelle: [[a]]\n> B: \"2\" — Quelle: [[b]]\n", heute);
  assert.equal(k.stufe, "rot");
  const s = k.signale.find((x) => x.art === "konflikt");
  assert.equal(s.zeile, 11);
  const p = pruefeText(WIKI, kopf() + "# X\n\nDas hier ist PRÜFBEDÜRFTIG (Zweifel).\n", heute);
  assert.equal(p.stufe, "rot"); assert.deepEqual(arten(p), ["pruefbeduerftig"]);
  assert.equal(pruefeText(WIKI, kopf() + "# X\n\n```\n> [!KONFLIKT] x\nPRÜFBEDÜRFTIG\n```\n", heute).stufe, "gruen");
  const z = pruefeText(WIKI, kopf('zweifel: "2026-10-23: Korrektur"\n') + "# X\n", heute);
  assert.equal(z.stufe, "rot"); assert.ok(arten(z).includes("zweifel"));
});

test("Prüfung: gelb bei abgelaufener Frist, Verfall, Fakt ohne Beleg, quelle_ ohne quellen_sha", () => {
  const a = pruefeText(WIKI, kopf("pruefen_bis: 2026-10-23\n") + "# X\n", heute);
  assert.equal(a.stufe, "gelb"); assert.deepEqual(arten(a), ["abgelaufen"]);
  assert.equal(pruefeText(WIKI, kopf("pruefen_bis: 2026-10-24\n") + "# X\n", heute).stufe, "gruen", "heute ist noch nicht abgelaufen");
  const v = pruefeText(WIKI, kopf("stand: 2026-09-01\nverfall: 30\n") + "# X\n", heute);
  assert.equal(v.stufe, "gelb"); assert.ok(arten(v).includes("verfall"));
  assert.equal(pruefeText(WIKI, kopf("stand: 2026-10-10\nverfall: 30\n") + "# X\n", heute).stufe, "gruen");
  const f = pruefeText(WIKI, kopf() + "# X\n\n- Fakt ohne Link · Stand 21.10.2026\n- Fakt mit falschem Link · Stand 21.10.2026 · [[firma/x]]\n", heute);
  assert.equal(f.stufe, "gelb");
  assert.deepEqual(f.signale.filter((s) => s.art === "beleg_fehlt").map((s) => s.zeile), [11, 12]);
  const q = pruefeText("09_wiki/firma/quelle_y.md", "---\nname: y\ntyp: quelle\nquellen: [\"a\"]\nrev: 1\n---\n# Y\n", heute);
  assert.equal(q.stufe, "gelb"); assert.deepEqual(arten(q), ["quellen_sha"]);
  assert.equal(pruefeText("09_wiki/firma/quelle_y.md", kopf() + "# Y\n", heute).stufe, "gruen");
});

test("Prüfung: rot schlägt gelb; Route über Vault liest die Datei", () => {
  const d = tmp();
  schreibe(d, WIKI, kopf("pruefen_bis: 2020-01-01\n") + "# X\n> [!KONFLIKT] offen\n");
  const v = oeffneVault(d, heute);
  const r = v.pruefung(WIKI);
  assert.equal(r.stufe, "rot"); assert.deepEqual(new Set(arten(r)), new Set(["abgelaufen", "konflikt"]));
  assert.equal(status(() => v.pruefung("09_wiki/gibts-nicht.md")), 404);
  assert.equal(v.pruefung("00_inbox/x.md" in {} ? "" : WIKI).stufe, "rot");
});

test("Gesundheit: ohne Kit {verfuegbar:false}; mit Kit durchgereicht und 120 s gecacht", async () => {
  const d = tmp();
  const v = oeffneVault(d);
  assert.deepEqual(await v.gesundheit(), { verfuegbar: false });
  schreibe(d, ".tools/brain.mjs", `import {appendFileSync} from "node:fs"; appendFileSync(process.cwd()+"/aufrufe.log","x");\nconsole.log(JSON.stringify({version:1,ampel:"gelb",warnungen:1,pruefungen:[]}));\n`);
  schreibe(d, ".tools/VERSION", "9.9.9\n");
  const w = oeffneVault(d);
  assert.equal(w.kitVersion(), "9.9.9");
  assert.equal((await w.gesundheit()).ampel, "gelb");
  assert.equal((await w.gesundheit()).ampel, "gelb");
  assert.equal(readFileSync(join(d, "aufrufe.log"), "utf8"), "x", "zweiter Aufruf kam aus dem Cache");
  schreibe(d, ".tools/brain.mjs", "console.log('kein json');");
  assert.deepEqual(await oeffneVault(d).gesundheit(), { verfuegbar: false });
});
