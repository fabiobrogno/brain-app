// Umbenennen, Verschieben, Papierkorb mit Link-Pflege und Rückgängig (gemeinsam/dateiaktionen.mjs, gemeinsam/linkpflege.mjs). Nur Wegwerf-Ordner (tmp), nie ein echter Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { readlinkSync, readFileSync, readdirSync, lstatSync, existsSync, writeFileSync, mkdirSync, symlinkSync, statSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const L = await import(pfad("gemeinsam", "linkpflege.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const sha = (b) => createHash("sha256").update(b).digest("hex");

// Alle Dateien (Bytes) und Ordner eines Vaults als Vergleichsstand
function stand(d) {
  const dateien = new Map(), ordner = [];
  const geh = (rel) => {
    for (const n of readdirSync(rel ? join(d, rel) : d).sort()) {
      if (n.startsWith(".")) continue; // .kortex-lokal (Vault-ID, Papierkorb) gehört nicht zum Vergleich
      const r = rel ? `${rel}/${n}` : n;
      const st = lstatSync(join(d, r));
      if (st.isSymbolicLink()) dateien.set(r, "link:" + readlinkSync(join(d, r)));
      else if (st.isDirectory()) { ordner.push(r); geh(r); } else dateien.set(r, sha(readFileSync(join(d, r))));
    }
  };
  geh("");
  return { dateien, ordner };
}
const lies = (d, p) => readFileSync(join(d, p), "utf8");
async function fehler(fn) { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); }

function aufbau(dateien = {}) {
  const d = tmp("umb-vault-"), support = tmp("umb-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  const v = oeffneVault(d, { support, heute: "2026-11-05" });
  return { d, support, v, kennung: null };
}
const eintraege = (support, kennung) => A.leseEreignisse(support, kennung, { arten: ["datei-aktion"] });

// ───────────────────────────── Link-Pflege (reine Funktionen) ─────────────────────────────

test("findeVerweise: Wikilinks mit Alias, Abschnitt, Einbettung; Markdown-Links; Code wird nicht gelesen", () => {
  const t = "# T\n[[A]] [[B|zeig]] [[C#Kopf]] ![[D]] [E](e.md#x) ![F](f/bild.png)\n`[[Code]]` und ``[[Auch]]``\n```\n[[Block]] [x](block.md)\n```\n~~~\n[[Tilde]]\n~~~\n[extern](https://x.de/a.md) [anker](#a) [mail](mailto:a@b.de)\n";
  const z = L.findeVerweise(t).map((l) => `${l.art}:${l.einbettung ? "!" : ""}${l.ziel}`);
  assert.deepEqual(z, ["wiki:A", "wiki:B", "wiki:C", "wiki:!D", "md:e.md", "md:!f/bild.png"]);
});

test("findeVerweise: Kopf (Frontmatter) nur Wikilinks, CRLF und BOM verschieben keine Positionen, Tabellen-Alias \\|", () => {
  const t = "﻿---\r\nverwandt: [[Kopf]]\r\nlink: [x](y.md)\r\n---\r\n# T\r\n| a |\r\n| [[Tab\\|Anz]] |\r\n";
  const v = L.findeVerweise(t);
  assert.deepEqual(v.map((l) => [l.art, l.ziel, t.slice(l.zielVon, l.zielBis)]), [["wiki", "Kopf", "Kopf"], ["wiki", "Tab", "Tab"]]);
});

test("setzeTitel: Überschrift (CRLF bleibt), Kopf-Titel mit Anführungszeichen, ohne Quelle → nichts", () => {
  assert.equal(L.setzeTitel("---\ntags: [a]\n---\r\n# Alt ##\r\nText\r\n", "Neu").text, "---\ntags: [a]\n---\r\n# Neu ##\r\nText\r\n");
  assert.equal(L.setzeTitel("---\ntitle: \"Alt: x\"  # k\n---\nText\n", 'Neu "Q"').text, '---\ntitle: "Neu \\"Q\\""  # k\n---\nText\n');
  assert.equal(L.setzeTitel("---\ntitel: Alt\n---\nText\n", "A: B").text, '---\ntitel: "A: B"\n---\nText\n');
  assert.equal(L.setzeTitel("```\n# im Code\n```\nText\n", "Neu").geaendert, false);
  assert.equal(L.setzeTitel("# Alt\n", "Neu\nZeile").text, "# Neu Zeile\n");
});

// ───────────────────────────── Umbenennen ─────────────────────────────

const BASIS = () => ({
  "10/Kaffee.md": "---\ntags: [genuss]\n---\r\n# Kaffee\r\n\r\nText mit [[Tee]].\r\n",
  "10/Tee.md": "# Tee\n\nSiehe [[Kaffee]], [[Kaffee|der Muntermacher]], [[Kaffee#Sorten]], ![[Kaffee]], [[10/Kaffee]], [[kaffee.md]] und [Link](Kaffee.md#x) sowie [Pfad](../10/Kaffee.md).\n\n`[[Kaffee]]`\n\n```\n[[Kaffee]] [c](Kaffee.md)\n```\n",
  "20/Notiz.md": "---\nverwandt: [[Kaffee]]\n---\n# Notiz\n\n[[Kaffee]] und [[Unbekannt]]\n",
  "20/Kein Link.md": "# Ohne Verweise\nText\n",
});

test("Notiz umbenennen (Titel und Dateiname): alle Verweise folgen, Code bleibt, CRLF/Kopf bleiben, ein Eintrag im Protokoll", async () => {
  const { d, v, support, kennung } = aufbau(BASIS());
  const vorher = stand(d);
  const sicht = await v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md", vorschau: true });
  assert.equal(sicht.verweise, 10, JSON.stringify(sicht.liste));
  assert.equal(sicht.notizen, 2);
  assert.deepEqual(stand(d), vorher, "die Vorschau schreibt nichts");
  const r = await v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md", token: sicht.token, basisHash: sicht.hash });
  assert.equal(r.nach, "10/Espresso.md");
  assert.ok(!existsSync(join(d, "10/Kaffee.md")));
  // die Notiz selbst: Titel neu, Zeilenenden und Kopf unverändert, eigener Link auf Tee unverändert
  assert.equal(lies(d, "10/Espresso.md"), "---\ntags: [genuss]\n---\r\n# Espresso\r\n\r\nText mit [[Tee]].\r\n");
  assert.equal(lies(d, "10/Tee.md"),
    "# Tee\n\nSiehe [[Espresso]], [[Espresso|der Muntermacher]], [[Espresso#Sorten]], ![[Espresso]], [[10/Espresso]], [[Espresso.md]] und [Link](Espresso.md#x) sowie [Pfad](../10/Espresso.md).\n\n`[[Kaffee]]`\n\n```\n[[Kaffee]] [c](Kaffee.md)\n```\n");
  assert.equal(lies(d, "20/Notiz.md"), "---\nverwandt: [[Espresso]]\n---\n# Notiz\n\n[[Espresso]] und [[Unbekannt]]\n");
  assert.equal(lies(d, "20/Kein Link.md"), "# Ohne Verweise\nText\n", "Unbeteiligtes bleibt unberührt");
  // genau ein Eintrag, ohne Inhalt
  const e = eintraege(support, A.kennungVault(d));
  assert.equal(e.length, 1);
  assert.equal(e[0].rueckgaengig.art, "vorgang");
  assert.ok(!/Espresso|Kaffee/.test(JSON.stringify({ ...e[0], pfade: undefined })), "kein Titel im Text");
  assert.deepEqual(e[0].pfade, ["10/Espresso.md", "10/Kaffee.md"]);
});

test("Rückgängig stellt Dateien und alle Verweise Byte für Byte her; Wiederherstellen führt es wieder aus", async () => {
  const { d, v } = aufbau(BASIS());
  const vorher = stand(d);
  const r = await v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md" });
  const nachher = stand(d);
  assert.notDeepEqual([...nachher.dateien], [...vorher.dateien]);
  const z = await v.vorgangZurueck({ id: r.vorgang });
  assert.equal(z.art, "zurueck");
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien], "Bytes gleich");
  assert.deepEqual(stand(d).ordner, vorher.ordner);
  await fehler(() => v.vorgangZurueck({ id: r.vorgang })); // schon zurück
  const w = await v.vorgangWieder({ id: r.vorgang });
  assert.equal(w.art, "wieder");
  assert.deepEqual([...stand(d).dateien], [...nachher.dateien], "wieder wie nach dem Umbenennen");
  await v.vorgangZurueck({ id: r.vorgang });
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
});

test("Nur der Titel ändern: Dateiname bleibt, Verweise nach Titel folgen, Verweise nach Dateiname bleiben", async () => {
  const { d, v } = aufbau({ "a/kaffee-notiz.md": "# Kaffee\n", "b/x.md": "[[Kaffee]] [[kaffee-notiz]] [[a/kaffee-notiz]]\n" });
  await v.umbenennen({ pfad: "a/kaffee-notiz.md", titel: "Espresso" });
  assert.ok(existsSync(join(d, "a/kaffee-notiz.md")));
  assert.equal(lies(d, "a/kaffee-notiz.md"), "# Espresso\n");
  assert.equal(lies(d, "b/x.md"), "[[Espresso]] [[kaffee-notiz]] [[a/kaffee-notiz]]\n");
});

test("Titel ohne Quelle im Text: der Dateiname ist der Titel und folgt; Dateiname folgt dem Titel auf Wunsch (Schreibweise wie bisher)", async () => {
  const { d, v } = aufbau({ "a/Tee.md": "nur Text\n", "a/mein-text.md": "# Mein Text\n", "b/x.md": "[[Tee]] [[Mein Text]] [[mein-text]]\n" });
  await v.umbenennen({ pfad: "a/Tee.md", titel: "Grüner Tee" });
  assert.ok(existsSync(join(d, "a/Grüner Tee.md")));
  await v.umbenennen({ pfad: "a/mein-text.md", titel: "Dein Text!", dateinameAusTitel: true });
  assert.ok(existsSync(join(d, "a/dein-text.md")), "Slug-Schreibweise bleibt Slug");
  assert.equal(lies(d, "b/x.md"), "[[Grüner Tee]] [[Dein Text!]] [[dein-text]]\n");
});

test("Gleicher Titel in zwei Ordnern: Verweise aus dem anderen Ordner werden eindeutig gemacht und behalten ihre Anzeige", async () => {
  const { d, v } = aufbau({ "a/Kaffee.md": "# Kaffee\n", "b/Kaffee.md": "# Kaffee\n", "a/x.md": "[[Kaffee]]\n", "b/y.md": "[[Kaffee]]\n", "c/z.md": "[[Kaffee]] [[a/Kaffee]]\n" });
  await v.umbenennen({ pfad: "a/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md" });
  assert.equal(lies(d, "a/x.md"), "[[Espresso]]\n");
  assert.equal(lies(d, "b/y.md"), "[[Kaffee]]\n");
  // c/z.md: [[Kaffee]] zeigte alphabetisch auf a/Kaffee → jetzt eindeutig, Anzeige bleibt
  assert.equal(lies(d, "c/z.md"), "[[Espresso]] [[a/Espresso]]\n", "folgt der Umbenennung");
});

test("Verschieben macht einen jetzt mehrdeutigen Verweis eindeutig und behält die Anzeige", async () => {
  const { d, v } = aufbau({ "a/Kaffee.md": "# Kaffee\n", "b/Kaffee.md": "# Kaffee\n", "z/.keep": "", "c/z.md": "[[Kaffee]] | [[Kaffee]]\n", "c/t.md": "| [[Kaffee]] |\n" });
  await v.verschieben({ pfad: "a/Kaffee.md", ziel: "z" });
  assert.equal(lies(d, "c/z.md"), "[[z/Kaffee|Kaffee]] | [[z/Kaffee|Kaffee]]\n");
  assert.equal(lies(d, "c/t.md"), "| [[z/Kaffee\\|Kaffee]] |\n", "in Tabellen mit maskiertem Strich");
});

test("Umlaute und Unicode-Formen: [[Müller]] (NFD) und [[Muller]]-Schreibweisen folgen; Anzeige im Alias bleibt", async () => {
  const nfd = "Müller";
  const { d, v } = aufbau({ "p/Müller.md": "# Müller\n", "q/a.md": `[[${nfd}]] [[Mueller]] [[müller|Herr M.]] [[Müller#K]]\n` });
  await v.umbenennen({ pfad: "p/Müller.md", titel: "Schröder", dateiname: "Schröder.md" });
  assert.equal(lies(d, "q/a.md"), "[[Schröder]] [[Schröder]] [[Schröder|Herr M.]] [[Schröder#K]]\n");
});

test("Alias der Notiz (aliases) bleibt gültig: Verweis über den Alias wird nicht angefasst", async () => {
  const { d, v } = aufbau({ "p/Mühle.md": "---\naliases: [Wassermühle]\n---\n# Mühle\n", "q/a.md": "[[Wassermühle]] [[Mühle]]\n" });
  await v.umbenennen({ pfad: "p/Mühle.md", titel: "Werk", dateiname: "Werk.md" });
  assert.equal(lies(d, "q/a.md"), "[[Wassermühle]] [[Werk]]\n");
});

test("Nur Groß-/Kleinschreibung des Dateinamens ändern geht (auch auf APFS ohne Unterscheidung) und lässt sich zurücknehmen", async () => {
  const { d, v } = aufbau({ "a/kaffee.md": "# kaffee\n", "a/x.md": "[[a/kaffee]] [l](kaffee.md)\n" });
  const r = await v.umbenennen({ pfad: "a/kaffee.md", dateiname: "Kaffee.md" });
  assert.ok(readdirSync(join(d, "a")).includes("Kaffee.md"), readdirSync(join(d, "a")).join());
  assert.ok(!readdirSync(join(d, "a")).includes("kaffee.md"));
  assert.equal(lies(d, "a/x.md"), "[[a/kaffee]] [l](Kaffee.md)\n", "[[…]] findet die Notiz unabhängig von Groß/klein, der Markdown-Link wird angepasst");
  await v.vorgangZurueck({ id: r.vorgang });
  assert.ok(readdirSync(join(d, "a")).includes("kaffee.md"));
  assert.equal(lies(d, "a/x.md"), "[[a/kaffee]] [l](kaffee.md)\n");
});

test("Ziel belegt → 409 art belegt; nichts geändert", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n", "a/y.md": "# y\n", "b/l.md": "[[x]]\n" });
  const vorher = stand(d);
  const e = await fehler(() => v.umbenennen({ pfad: "a/x.md", dateiname: "y.md" }));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "belegt");
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
});

test("Fremde Änderung zwischen Vorschau und Ausführen → 409 vorschau-veraltet, nichts verändert; falscher basisHash → 409", async () => {
  const { d, v } = aufbau(BASIS());
  const sicht = await v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md", vorschau: true });
  writeFileSync(join(d, "20/Notiz.md"), "---\nverwandt: [[Kaffee]]\n---\n# Notiz\n\n[[Kaffee]] [[Kaffee]] geändert\n");
  const vorher = stand(d);
  const e = await fehler(() => v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", dateiname: "Espresso.md", token: sicht.token }));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "vorschau-veraltet");
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
  const e2 = await fehler(() => v.umbenennen({ pfad: "10/Kaffee.md", titel: "Espresso", basisHash: "0".repeat(64) }));
  assert.equal(e2.status, 409); assert.ok(e2.extra.aktuellerHash);
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
});

test("Rückgängig nach Weiterarbeiten: 409 mit Liste; mit teilweise bleibt Geändertes unberührt, Datei und Titel gehen zurück", async () => {
  const { d, v } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  writeFileSync(join(d, "b/x.md"), "[[Neu]] und mehr\n");
  writeFileSync(join(d, "a/Neu.md"), "# Neu\n\nWeitergeschrieben\n");
  const vorher = stand(d);
  const e = await fehler(() => v.vorgangZurueck({ id: r.vorgang }));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "geaendert"); assert.deepEqual(e.extra.dateien.sort(), ["a/Neu.md", "b/x.md"]);
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien], "bei 409 bleibt alles");
  await v.vorgangZurueck({ id: r.vorgang, teilweise: true });
  assert.equal(lies(d, "a/Alt.md"), "# Alt\n\nWeitergeschrieben\n", "Titel zurück, Text bleibt");
  assert.equal(lies(d, "b/x.md"), "[[Neu]] und mehr\n", "Geändertes bleibt");
});

test("Pfade: .., absolut, versteckt, Symlink nach draußen, ungültige Namen → abgewiesen; es bleibt alles", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n", "z/.keep": "" });
  const draussen = tmp("umb-draussen-"); schreibe(draussen, "g.md", "# g\n");
  symlinkSync(draussen, join(d, "weg"));
  symlinkSync(join(draussen, "g.md"), join(d, "a/link.md"));
  const vorher = stand(d);
  for (const p of ["../x.md", "/etc/hosts", "a/../../x.md", ".git/config", "a/.v.md", "weg/g.md"]) {
    for (const f of [() => v.umbenennen({ pfad: p, dateiname: "n.md" }), () => v.verschieben({ pfad: p, ziel: "z" }), () => v.loeschen({ pfad: p })]) {
      const e = await fehler(f); assert.ok([400, 403, 404].includes(e.status), `${p}: ${e.status}`);
    }
  }
  for (const n of ["../x.md", "a/b.md", "..", ".versteckt.md", "a\\b.md", "", "  ", "x:y.md", "node_modules"]) assert.equal((await fehler(() => v.umbenennen({ pfad: "a/x.md", dateiname: n }))).status, 400, JSON.stringify(n));
  for (const z of ["../", "weg", "/etc", "nicht-da", ".git"]) { const e = await fehler(() => v.verschieben({ pfad: "a/x.md", ziel: z })); assert.ok([400, 403, 404].includes(e.status), `${z}: ${e.status}`); }
  assert.equal((await fehler(() => v.umbenennen({ pfad: "a/link.md", dateiname: "n.md" }))).status, 403, "Symlink wird nicht angefasst");
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
  assert.ok(!existsSync(join(draussen, "x.md")));
});

test("Generierte Dateien, Nicht-Textdateien und Kortex-Ordner sind geschützt", async () => {
  const { v } = aufbau({ "index.md": "# i\n", "09_wiki/_index.md": "# g\n", "bild.png": "x", "00_inbox/a.md": "# a\n", "05_aufgaben/b.md": "# b\n" });
  assert.equal((await fehler(() => v.umbenennen({ pfad: "index.md", dateiname: "x.md" }))).status, 403);
  assert.equal((await fehler(() => v.loeschen({ pfad: "09_wiki/_index.md" }))).status, 403);
  assert.equal((await fehler(() => v.umbenennen({ pfad: "bild.png", dateiname: "x.md" }))).status, 415);
  for (const o of ["00_inbox", "05_aufgaben", "09_wiki"]) { assert.equal((await fehler(() => v.umbenennen({ pfad: o, typ: "ordner", name: "neu" }))).status, 403, o); assert.equal((await fehler(() => v.loeschen({ pfad: o, typ: "ordner" }))).status, 403, o); }
});

// ───────────────────────────── Verschieben ─────────────────────────────

test("Notiz verschieben: Pfad-Verweise, relative Markdown-Links der Notiz und auf die Notiz werden angepasst; Titel-Verweise bleiben", async () => {
  const { d, v } = aufbau({
    "a/Plan.md": "# Plan\n\n[Bild](bild.png) [Nachbar](Nachbar.md) [[Nachbar]] [[b/Anders]] [oben](../Wurzel.md)\n",
    "a/Nachbar.md": "# Nachbar\n[[Plan]] [p](Plan.md) [[a/Plan]] [[a/Plan.md]]\n",
    "a/bild.png": "PNG", "Wurzel.md": "# Wurzel\n[[Plan]]\n", "b/Anders.md": "# Anders\n", "neu/.keep": "",
  });
  const r = await v.verschieben({ pfad: "a/Plan.md", ziel: "neu" });
  assert.equal(r.nach, "neu/Plan.md");
  assert.equal(lies(d, "neu/Plan.md"), "# Plan\n\n[Bild](../a/bild.png) [Nachbar](../a/Nachbar.md) [[Nachbar]] [[b/Anders]] [oben](../Wurzel.md)\n");
  assert.equal(lies(d, "a/Nachbar.md"), "# Nachbar\n[[Plan]] [p](../neu/Plan.md) [[neu/Plan]] [[neu/Plan.md]]\n");
  assert.equal(lies(d, "Wurzel.md"), "# Wurzel\n[[Plan]]\n");
  const vorher = stand(d);
  await v.vorgangZurueck({ id: r.vorgang });
  assert.equal(lies(d, "a/Plan.md").startsWith("# Plan"), true);
  assert.equal(lies(d, "a/Nachbar.md"), "# Nachbar\n[[Plan]] [p](Plan.md) [[a/Plan]] [[a/Plan.md]]\n");
  assert.notDeepEqual([...stand(d).dateien], [...vorher.dateien]);
});

test("Verschieben in die Vault-Wurzel; Name im Ziel belegt → 409", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n", "y.md": "# y\n", "b/y.md": "# y2\n", "l.md": "[[a/x]]\n" });
  const r = await v.verschieben({ pfad: "a/x.md", ziel: "" });
  assert.equal(r.nach, "x.md");
  assert.equal(lies(d, "l.md"), "[[x]]\n");
  assert.equal((await fehler(() => v.verschieben({ pfad: "b/y.md", ziel: "" }))).extra.art, "belegt");
});

// ───────────────────────────── Ordner ─────────────────────────────

test("Ordner umbenennen: Pfad-Verweise, Markdown-Links und Links aus dem Ordner heraus folgen; Rückgängig stellt alles her", async () => {
  const { d, v } = aufbau({
    "wissen/a.md": "# A\n[[wissen/b]] [[b]] [B](b.md) [außen](../ausserhalb.md) [[ausserhalb]]\n", "wissen/b.md": "# B\n", "wissen/tief/c.md": "# C\n[[a]]\n",
    "ausserhalb.md": "# Aus\n[[wissen/a]] [[wissen/tief/c.md]] [A](wissen/a.md) [[A]]\n",
  });
  const vorher = stand(d);
  const sicht = await v.umbenennen({ typ: "ordner", pfad: "wissen", name: "know", vorschau: true });
  assert.equal(sicht.notizenImOrdner, 3);
  const r = await v.umbenennen({ typ: "ordner", pfad: "wissen", name: "know", token: sicht.token });
  assert.ok(existsSync(join(d, "know/tief/c.md")) && !existsSync(join(d, "wissen")));
  assert.equal(lies(d, "know/a.md"), "# A\n[[know/b]] [[b]] [B](b.md) [außen](../ausserhalb.md) [[ausserhalb]]\n");
  assert.equal(lies(d, "ausserhalb.md"), "# Aus\n[[know/a]] [[know/tief/c.md]] [A](know/a.md) [[A]]\n");
  await v.vorgangZurueck({ id: r.vorgang });
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
  assert.deepEqual(stand(d).ordner, vorher.ordner);
});

test("Ordner verschieben: nicht in sich selbst, nicht auf Belegtes; Verweise folgen", async () => {
  const { d, v } = aufbau({ "p/q/a.md": "# A\n", "z/.keep": "", "l.md": "[[p/q/a]] [m](p/q/a.md)\n", "z/q/.keep": "" });
  assert.equal((await fehler(() => v.verschieben({ typ: "ordner", pfad: "p", ziel: "p/q" }))).status, 400);
  assert.equal((await fehler(() => v.verschieben({ typ: "ordner", pfad: "p/q", ziel: "z" }))).extra.art, "belegt");
  await v.verschieben({ typ: "ordner", pfad: "p", ziel: "z" });
  assert.equal(lies(d, "l.md"), "[[p/q/a]] [m](z/p/q/a.md)\n", "der Pfad am Ende trifft weiter, der Markdown-Link wird angepasst");
});

// ───────────────────────────── Papierkorb ─────────────────────────────

test("Löschen: Notiz im Papierkorb (0700/0600), Verweise bleiben als offene Links, Vorschau nennt die Verlinkenden", async () => {
  const { d, v, support, kennung } = aufbau(BASIS());
  const sicht = await v.loeschen({ pfad: "10/Kaffee.md", vorschau: true });
  assert.equal(sicht.notizen, 2); assert.equal(sicht.verlinktVon.length, 2);
  const vorher = stand(d);
  const r = await v.loeschen({ pfad: "10/Kaffee.md", token: sicht.token });
  assert.ok(!existsSync(join(d, "10/Kaffee.md")));
  assert.equal(lies(d, "10/Tee.md"), BASIS()["10/Tee.md"], "Verweise bleiben, wie sie sind (offene Links)");
  const korb = join(d, ".kortex-lokal", "papierkorb");
  const inhalt = join(korb, "vorgaenge", r.vorgang, "inhalt", "Kaffee.md");
  assert.equal(readFileSync(inhalt, "utf8"), BASIS()["10/Kaffee.md"]);
  assert.equal(statSync(inhalt).mode & 0o777, 0o600);
  for (const o of [join(d, ".kortex-lokal"), korb, join(korb, "vorgaenge"), join(korb, "vorgaenge", r.vorgang), join(korb, "vorgaenge", r.vorgang, "inhalt")]) assert.equal(statSync(o).mode & 0o777, 0o700, o);
  assert.equal(statSync(join(korb, "vorgaenge", r.vorgang, "manifest.json")).mode & 0o777, 0o600);
  const liste = await v.papierkorb();
  assert.equal(liste.eintraege.length, 1); assert.equal(liste.eintraege[0].titel, "Kaffee"); assert.equal(liste.eintraege[0].alt, false);
  // Wiederherstellen aus dem Papierkorb
  const w = await v.papierkorbWiederherstellen({ id: r.vorgang });
  assert.equal(w.pfad, "10/Kaffee.md");
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
  assert.equal(statSync(join(d, "10/Kaffee.md")).mode & 0o777, 0o644, "ursprünglicher Modus");
  assert.equal((await v.papierkorb()).eintraege.length, 0);
});

test("Löschen über Rückgängig (Protokoll), wieder löschen (Wiederherstellen), Platz belegt → 409", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n" });
  const r = await v.loeschen({ pfad: "a/x.md" });
  await v.vorgangZurueck({ id: r.vorgang });
  assert.equal(lies(d, "a/x.md"), "# x\n");
  await v.vorgangWieder({ id: r.vorgang });
  assert.ok(!existsSync(join(d, "a/x.md")));
  schreibe(d, "a/x.md", "# neu belegt\n");
  const e = await fehler(() => v.vorgangZurueck({ id: r.vorgang }));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "belegt");
  assert.equal(lies(d, "a/x.md"), "# neu belegt\n");
  const anders = await v.papierkorbWiederherstellen({ id: r.vorgang, name: "x-zurueck.md" });
  assert.equal(anders.pfad, "a/x-zurueck.md");
});

test("Ordner löschen samt Inhalt und wiederherstellen (Bytes, leere Ordner, Modi)", async () => {
  const { d, v } = aufbau({ "p/a.md": "# a\n[[b]]\n", "p/tief/b.md": "# b\n", "p/bild.png": "PNG\u0000", "l.md": "[[a]] [[p/tief/b]]\n" });
  mkdirSync(join(d, "p/leer"));
  const vorher = stand(d);
  const r = await v.loeschen({ typ: "ordner", pfad: "p" });
  assert.ok(!existsSync(join(d, "p")));
  assert.equal(r.verweise, 2); assert.equal(r.notizen, 1);
  const liste = await v.papierkorb();
  assert.equal(liste.eintraege[0].typ, "ordner"); assert.equal(liste.eintraege[0].anzahl, 3);
  await v.papierkorbWiederherstellen({ id: r.vorgang });
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
  assert.deepEqual(stand(d).ordner, vorher.ordner);
});

test("Endgültig löschen entfernt den Inhalt auf Klick; danach gibt es kein Rückgängig; nichts wird je automatisch geleert (auch alte Einträge und verstellte Uhr nicht)", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n", "a/y.md": "# y\n", "a/z.md": "# z\n" });
  const r1 = await v.loeschen({ pfad: "a/x.md" });
  const r2 = await v.loeschen({ pfad: "a/y.md" });
  const r3 = await v.loeschen({ pfad: "a/z.md" });
  const korb = join(d, ".kortex-lokal", "papierkorb", "vorgaenge");
  assert.equal((await v.papierkorbEndgueltig({ id: r1.vorgang })).geloescht, 1);
  assert.ok(!existsSync(join(korb, r1.vorgang, "inhalt")));
  assert.equal((await fehler(() => v.vorgangZurueck({ id: r1.vorgang }))).status, 404);
  assert.equal((await fehler(() => v.papierkorbEndgueltig({ id: "v_000000000000" }))).status, 404);
  // sehr alt (und eine Uhr, die weit vorgeht): bleibt liegen, wird nur angezeigt und erst auf ausdrücklichen Wunsch gelöscht
  const alt = (id, tage) => { const mf = join(korb, id, "manifest.json"); const m = JSON.parse(readFileSync(mf, "utf8")); m.zeit = new Date(Date.now() - tage * 86400e3).toISOString(); writeFileSync(mf, JSON.stringify(m)); };
  alt(r2.vorgang, 400); alt(r3.vorgang, -5);
  for (let i = 0; i < 3; i++) { const liste = await oeffneVault(d, { support: tmp("upk-x-") }).papierkorb(); assert.equal(liste.eintraege.length, 2); assert.equal(liste.aelter, 1); }
  assert.ok(existsSync(join(korb, r2.vorgang, "inhalt")));
  assert.equal((await v.papierkorbEndgueltig({ aelterAlsTage: 30 })).geloescht, 1, "nur der alte Eintrag, nur auf Anfrage");
  assert.ok(existsSync(join(korb, r3.vorgang, "inhalt")));
});

test("Die Vorgangs-Kennung im Protokoll ist nur ein Hinweis: ungültige oder fremde Kennungen tun nichts", async () => {
  const { d, v, support } = aufbau({ "a/x.md": "# x\n" });
  assert.equal((await fehler(() => v.vorgangZurueck({ id: "../../etc" }))).status, 404);
  assert.equal(A.schreibeEreignis(support, d, { art: "datei-aktion", text: "x", rueckgaengig: { art: "vorgang", id: "../x" } }).rueckgaengig, undefined);
  assert.equal(A.schreibeEreignis(support, d, { art: "pflege", text: "x", rueckgaengig: { art: "vorgang", id: "v_0123456789ab" } }).rueckgaengig, undefined);
});

// ───────────────────────────── Werkstatt-Routen und Aktivitätsprotokoll ─────────────────────────────

const aufruf = (h) => async (methode, p, daten) => {
  const [pf, q] = p.split("?");
  const r = await h({ methode, pfad: pf, query: q || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { status: r.status, j };
};
function werkstatt(dateien) {
  const support = tmp("umb-r-support-"), d = tmp("umb-r-vault-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { modus: "poll", pollMs: 80, entprellMs: 40 } });
  return { d, support, rufe: aufruf(h), h };
}

test("Routen: Vorschau → Umbenennen → Eintrag im Protokoll mit Rückgängig → Rückgängig → Wiederherstellen", async () => {
  const { d, rufe } = werkstatt({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const vorher = stand(d);
  const s = await rufe("POST", "/api/notiz/umbenennen", { pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md", vorschau: true });
  assert.equal(s.status, 200); assert.equal(s.j.verweise, 1); assert.equal(s.j.liste[0].pfad, "b/x.md"); assert.equal(s.j.liste[0].zeilen[0].nachher, "[[Neu]]");
  const r = await rufe("POST", "/api/notiz/umbenennen", { pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md", token: s.j.token, basisHash: s.j.hash });
  assert.equal(r.status, 200); assert.ok(r.j.aktivitaetId); assert.ok(r.j.geaendert.includes("b/x.md"));
  const akt = (await rufe("GET", "/api/aktivitaet?art=datei-aktion")).j;
  assert.equal(akt.ereignisse.length, 1);
  assert.equal(akt.ereignisse[0].rueckgaengigMoeglich, true); assert.equal(akt.ereignisse[0].rueckgaengig, undefined);
  const z = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: r.j.aktivitaetId });
  assert.equal(z.status, 200); assert.equal(z.j.art, "zurueck");
  assert.deepEqual([...stand(d).dateien], [...vorher.dateien]);
  const akt2 = (await rufe("GET", "/api/aktivitaet?art=datei-aktion")).j.ereignisse[0];
  assert.equal(akt2.rueckgaengigMoeglich, false); assert.equal(akt2.wiederherstellenMoeglich, true); assert.ok(akt2.zurueckgenommen);
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: r.j.aktivitaetId })).status, 409);
  const w = await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: r.j.aktivitaetId });
  assert.equal(w.status, 200);
  assert.ok(existsSync(join(d, "a/Neu.md")));
});

test("Routen: Ordner, Löschen, Papierkorb-Liste und -Wiederherstellen; falsche Methode und Eingaben", async () => {
  const { d, rufe } = werkstatt({ "a/x.md": "# x\n", "a/y.md": "# y\n" });
  assert.equal((await rufe("GET", "/api/notiz/umbenennen")).status, 405);
  assert.equal((await rufe("POST", "/api/notiz/umbenennen", {})).status, 400);
  assert.equal((await rufe("POST", "/api/ordner/umbenennen", { pfad: "a", name: "b" })).status, 200);
  assert.ok(existsSync(join(d, "b/x.md")));
  const l = await rufe("POST", "/api/notiz/loeschen", { pfad: "b/x.md" });
  assert.equal(l.status, 200);
  const k = (await rufe("GET", "/api/papierkorb")).j;
  assert.equal(k.eintraege.length, 1);
  assert.equal((await rufe("POST", "/api/papierkorb/wiederherstellen", { id: k.eintraege[0].id })).status, 200);
  assert.ok(existsSync(join(d, "b/x.md")));
  // eine Datei, die ein Ordner-Route anfasst
  assert.equal((await rufe("POST", "/api/ordner/loeschen", { pfad: "b/y.md" })).status, 400);
});

test("Eintrag im Protokoll enthält nie Inhalt oder Titel im Text; eine Aktion = ein Eintrag (auch Rückgängig-Bestätigung ist ein eigener, getrennter Eintrag)", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Geheimer Titel.md": "# Geheimer Titel\nInhalt XYZ\n", "b/x.md": "[[Geheimer Titel]]\n" });
  const r = await v.umbenennen({ pfad: "a/Geheimer Titel.md", titel: "Noch geheimer", dateiname: "n.md" });
  const roh = readFileSync(join(support, "aktivitaet", `${A.kennungVault(d)}.jsonl`), "utf8");
  assert.ok(!/Inhalt XYZ|Noch geheimer/.test(roh));
  assert.equal(eintraege(support, A.kennungVault(d)).length, 1);
  assert.ok(r.aktivitaetId);
});

test("Mitten im Lauf abgebrochene Aktion (Journal „laeuft“) wird beim nächsten Mal zurückgenommen", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  // Absturz nachstellen: Journal auf „laeuft“ und alt, Notizen im Stand „nachher“, Datei noch an alter Stelle
  const mf = join(d, ".kortex-lokal", "papierkorb", "vorgaenge", r.vorgang, "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; m.zeit = new Date(Date.now() - 120_000).toISOString(); writeFileSync(mf, JSON.stringify(m));
  const v2 = oeffneVault(d, { support });
  await v2.papierkorb();
  assert.equal(lies(d, "b/x.md"), "[[Alt]]\n", "Verweis zurückgesetzt");
  assert.ok(existsSync(join(d, "a/Alt.md")) && !existsSync(join(d, "a/Neu.md")), "auch der Umzug ist zurückgefahren: die Notiz liegt wieder unter dem alten Namen");
  assert.equal(lies(d, "a/Alt.md"), "# Alt\n");
  assert.ok(!existsSync(join(d, ".kortex-lokal", "papierkorb", "vorgaenge", r.vorgang)));
});
