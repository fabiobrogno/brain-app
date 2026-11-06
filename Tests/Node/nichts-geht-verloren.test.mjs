// Paket „Nichts geht verloren“ (Werkstatt-Seite): Zusammenführen bei Fremdänderung (K2), Entwurfs-Journal (W1), automatische lokale Fassungen (W3).
// Echte Dateien und echtes Git in Wegwerf-Ordnern (os.tmpdir()), fremde Schreiber sind echte Kindprozesse. Nie der echte Support-Ordner, kein Netzwerk.
// Kindprozesse laufen mit gesäuberter Umgebung (kein CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL, CURSOR_CONFIG_DIR, GEMINI_CLI_HOME).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, chmodSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { tmp, schreibe, repo, g, pfad, echt } from "./hilfe.mjs";

const { zusammenfuehren: drei, baue, istWahl } = await import(pfad("gemeinsam", "merge3.mjs"));
const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const entwurf = await import(pfad("gemeinsam", "entwurf.mjs"));
const ablage = await import(pfad("gemeinsam", "ablage.mjs"));
const { erzeugeAutoFassungen, nachrichtFuer } = await import(pfad("werkstatt", "auto-fassungen.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { APP_STANDARD, leseApp, schreibeApp } = await import(pfad("gemeinsam", "app-einstellungen.mjs"));
const { kennung } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
const { leseEreignisse } = await import(pfad("gemeinsam", "aktivitaet.mjs"));

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function bis(fn, ms = 4000, schritt = 25) { const ende = Date.now() + ms; for (;;) { const w = await fn(); if (w) return w; if (Date.now() > ende) return w; await warte(schritt); } }
const wirft = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
// Gesäuberte Umgebung für Kindprozesse (wie die App sie baut): nichts vom Benutzer, nichts aus den Konfigurationsordnern der KI-Programme
const sauber = () => { const e = { ...process.env }; for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"]) delete e[k]; return e; };
// Ein anderes Programm schreibt in die Datei (ein echter Prozess): hängt Zeilen an
const fremdAn = (datei, text) => execFileSync(process.execPath, ["-e", "require('node:fs').appendFileSync(process.argv[1], process.argv[2])", datei, text], { env: sauber() });
const fremdErsetzt = (datei, text) => execFileSync(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], process.argv[2])", datei, text], { env: sauber() });

function aufbau(inhalt = "# Titel\n\nerste Zeile\nzweite Zeile\ndritte Zeile\n") {
  const d = tmp("brain-ngv-"), support = tmp("brain-ngv-support-");
  schreibe(d, "10_notizen/a.md", inhalt);
  const v = oeffneVault(d, { support });
  const l = v.lies("10_notizen/a.md");
  return { d, support, v, datei: join(d, "10_notizen/a.md"), basis: l.inhalt, hash: l.hash };
}

// ──────────────────────────────────────────── Drei-Wege-Zusammenführung (rein)
test("merge3: verschiedene Stellen werden ohne Rückfrage zusammengeführt (du änderst die Mitte, die KI hängt an)", () => {
  const basis = "# T\n\na\nb\nc\n";
  const meine = "# T\n\na\nB geändert\nc\n";
  const andere = "# T\n\na\nb\nc\nd von der KI\n";
  const r = drei(basis, meine, andere);
  assert.equal(r.sauber, true);
  assert.equal(baue(r.teile), "# T\n\na\nB geändert\nc\nd von der KI\n");
  assert.ok(r.eigene >= 1 && r.fremde >= 1);
});

test("merge3: dieselbe Stelle verschieden geändert = ein Konfliktblock mit Wahl meine / andere / beide / selbst", () => {
  const basis = "x\nalt\ny\n";
  const r = drei(basis, "x\nmeine\ny\n", "x\nandere\ny\n");
  assert.equal(r.sauber, false); assert.equal(r.konflikte, 1);
  const k = r.teile.find((t) => t.t === "konflikt");
  assert.deepEqual([k.basis, k.meine, k.andere], [["alt\n"], ["meine\n"], ["andere\n"]]); // das Zeilenende gehört zur Zeile
  assert.equal(baue(r.teile, ["meine"]), "x\nmeine\ny\n");
  assert.equal(baue(r.teile, ["andere"]), "x\nandere\ny\n");
  assert.equal(baue(r.teile, ["beide"]), "x\nmeine\nandere\ny\n");
  assert.equal(baue(r.teile, [{ text: "selbst\nzusammen\n" }]), "x\nselbst\nzusammen\ny\n");
  assert.equal(baue(r.teile, [{ text: "" }]), "x\ny\n");
  assert.throws(() => baue(r.teile, []));
  assert.ok(istWahl("beide") && istWahl({ text: "" }) && !istWahl("alle") && !istWahl(null));
});

test("merge3: gleiche Änderung auf beiden Seiten ist kein Konflikt; eine unveränderte Seite lässt die andere gelten", () => {
  assert.equal(baue(drei("a\nb\n", "a\nX\n", "a\nX\n").teile), "a\nX\n");
  assert.equal(baue(drei("a\nb\n", "a\nb\n", "a\nY\n").teile), "a\nY\n");
  assert.equal(baue(drei("a\nb\n", "a\nZ\n", "a\nb\n").teile), "a\nZ\n");
  assert.equal(drei("a\n", "a\n", "a\n").sauber, true);
});

test("merge3: CRLF, gemischte Zeilenenden und fehlender Schlusszeilenumbruch bleiben Byte für Byte erhalten", () => {
  const basis = "eins\r\nzwei\r\ndrei";
  const r = drei(basis, "EINS\r\nzwei\r\ndrei", "eins\r\nzwei\r\ndrei\r\nvier\r\n");
  assert.equal(r.sauber, true);
  assert.equal(baue(r.teile), "EINS\r\nzwei\r\ndrei\r\nvier\r\n");
  const gemischt = "a\r\nb\nc\r\n";
  assert.equal(baue(drei(gemischt, gemischt, gemischt).teile), gemischt);
  assert.equal(baue(drei("a", "a", "a").teile), "a");
});

test("merge3: zufällige Änderungen — nur eine Seite geändert ergibt genau diese Seite, weit entfernte Änderungen beider Seiten ergeben beides", () => {
  let z = 12345; const zufall = (n) => { z = (z * 1103515245 + 12345) & 0x7fffffff; return z % n; };
  for (let runde = 0; runde < 200; runde++) {
    const basis = Array.from({ length: 12 + zufall(20) }, (_, i) => `zeile ${i}`);
    const aendere = (zeilen, von, bis) => { const k = zeilen.slice(); const i = von + zufall(Math.max(1, bis - von)); const art = zufall(3); if (art === 0) k.splice(i, 1, `neu ${zufall(1000)}`); else if (art === 1) k.splice(i, 0, `neu ${zufall(1000)}`); else k.splice(i, 1); return k; };
    const m = aendere(basis, 0, basis.length), a = aendere(basis, 0, basis.length);
    assert.equal(baue(drei(basis.join("\n"), m.join("\n"), basis.join("\n")).teile), m.join("\n"), "nur meine");
    assert.equal(baue(drei(basis.join("\n"), basis.join("\n"), a.join("\n")).teile), a.join("\n"), "nur andere");
    // links ändert die erste, rechts die letzte Hälfte (Abstand ≥ 3 Zeilen): sauber
    const h = Math.floor(basis.length / 2);
    const ml = basis.slice(0, h - 1), mr = basis.slice(h + 1);
    const links = [...aendere(basis.slice(0, h - 1), 0, h - 1), ...basis.slice(h - 1)];
    const rechts = [...basis.slice(0, h + 1), ...aendere(mr, 0, mr.length)];
    const r = drei(basis.join("\n"), links.join("\n"), rechts.join("\n"));
    assert.equal(r.sauber, true, `Runde ${runde}`);
    void ml;
  }
});

test("merge3: riesige Mitte rechnet nicht ewig, sondern wird ein Block (nichts geht verloren)", () => {
  const n = 3500;
  const basis = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
  const meine = Array.from({ length: n }, (_, i) => `m${i}`).join("\n");
  const andere = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
  const t0 = Date.now();
  const r = drei(basis, meine, andere);
  assert.ok(Date.now() - t0 < 3000, "braucht zu lange");
  assert.equal(r.konflikte, 1);
  assert.equal(baue(r.teile, ["meine"]), meine); assert.equal(baue(r.teile, ["andere"]), andere);
});

// ──────────────────────────────────────────── vault.zusammenfuehren mit echten Dateien und fremden Schreibern
test("K2: Fremdänderung (anderes Programm) wird eingearbeitet statt überschrieben — und die fremde Fassung liegt in der Ablage", () => {
  const { v, support, d, datei, basis, hash } = aufbau();
  fremdAn(datei, "Zeile von außen (KI)\n");                      // ein echtes anderes Programm schreibt
  const meine = basis.replace("zweite Zeile", "zweite Zeile, von mir geändert");
  // Das alte Verhalten (PUT mit altem Hash) scheitert mit 409 …
  const e = wirft(() => v.schreibe({ pfad: "10_notizen/a.md", inhalt: meine, basisHash: hash }));
  assert.equal(e.status, 409);
  // … die neue Zusammenführung bewahrt beides
  const r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash });
  assert.equal(r.art, "eingearbeitet");
  const aufDerPlatte = readFileSync(datei, "utf8");
  assert.match(aufDerPlatte, /zweite Zeile, von mir geändert/);
  assert.match(aufDerPlatte, /Zeile von außen \(KI\)/);
  assert.equal(r.text, aufDerPlatte);
  assert.equal(r.hash, v.lies("10_notizen/a.md").hash);
  // vor dem Überschreiben lag die fremde Fassung in der Ablage (Byte für Byte)
  const alle = ablage.liste(support, d, "10_notizen/a.md");
  assert.equal(alle.length, 2, "die fremde und – auch beim automatischen Einarbeiten – meine Fassung");
  const liste = alle.filter((f) => f.grund === "fremd-eingearbeitet");
  assert.equal(liste.length, 1);
  assert.equal(ablage.lese(support, d, liste[0].id).inhalt, basis + "Zeile von außen (KI)\n");
  assert.equal(r.fremdFassung, liste[0].id);
  const mf = alle.find((f) => f.grund === "meine-vor-einarbeiten");
  assert.equal(ablage.lese(support, d, mf.id).inhalt, meine);
  assert.equal(r.meineFassung, mf.id);
});

test("K2: Überschneidung — nichts wird geschrieben, bis du wählst; danach liegen beide Fassungen in der Ablage", () => {
  const { v, support, d, datei, basis, hash } = aufbau();
  fremdErsetzt(datei, basis.replace("zweite Zeile", "zweite Zeile (fremd)"));
  const meine = basis.replace("zweite Zeile", "zweite Zeile (meine)");
  const vorher = readFileSync(datei, "utf8");
  const r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash });
  assert.equal(r.art, "konflikt"); assert.equal(r.konflikte, 1);
  assert.equal(readFileSync(datei, "utf8"), vorher, "bis zur Wahl bleibt die Datei unberührt");
  assert.equal(ablage.liste(support, d).length, 0, "noch nichts überschrieben, also noch nichts abgelegt");
  assert.equal(r.aktuellerHash, v.lies("10_notizen/a.md").hash);
  // falsche Anzahl von Wahlen
  assert.equal(wirft(() => v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash, auswahl: [], gesehenHash: r.aktuellerHash })).status, 400);
  assert.equal(wirft(() => v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash, auswahl: ["alle"], gesehenHash: r.aktuellerHash })).status, 400);
  const fertig = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash, auswahl: ["beide"], gesehenHash: r.aktuellerHash });
  assert.equal(fertig.art, "zusammengefuehrt");
  assert.match(readFileSync(datei, "utf8"), /zweite Zeile \(meine\)\nzweite Zeile \(fremd\)/);
  const gruende = ablage.liste(support, d, "10_notizen/a.md").map((e) => e.grund).sort();
  assert.deepEqual(gruende, ["fremd-zusammengefuehrt", "meine-vor-zusammenfuehren"]);
  const fremd = ablage.liste(support, d).find((e) => e.grund === "fremd-zusammengefuehrt");
  assert.equal(ablage.lese(support, d, fremd.id).inhalt, vorher);
});

test("K2: „Andere“ gewählt — meine Fassung geht nicht verloren, sie liegt in der Ablage", () => {
  const { v, support, d, datei, basis, hash } = aufbau();
  fremdErsetzt(datei, basis.replace("dritte Zeile", "dritte (fremd)"));
  const meine = basis.replace("dritte Zeile", "dritte (meine)");
  const r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash });
  const fertig = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash, auswahl: ["andere"], gesehenHash: r.aktuellerHash });
  assert.equal(fertig.art, "zusammengefuehrt"); assert.equal(fertig.text, readFileSync(datei, "utf8"), "das Ergebnis ist die Platte selbst");
  assert.match(readFileSync(datei, "utf8"), /dritte \(fremd\)/);
  const meineAblage = ablage.liste(support, d, "10_notizen/a.md").find((e) => e.grund === "meine-verworfen");
  assert.ok(meineAblage, "meine verworfene Fassung liegt in der Ablage");
  assert.equal(ablage.lese(support, d, meineAblage.id).inhalt, meine);
});

test("K2: ändert sich die Datei noch einmal, während die Wahl gezeigt wird, schreibt die Werkstatt nichts (409 erneut)", () => {
  const { v, datei, basis, hash } = aufbau();
  fremdErsetzt(datei, basis.replace("zweite Zeile", "zweite (fremd 1)"));
  const meine = basis.replace("zweite Zeile", "zweite (meine)");
  const r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash });
  assert.equal(r.art, "konflikt");
  fremdAn(datei, "noch eine Zeile von außen\n");                  // zwischen Anzeige und Klick
  const stand = readFileSync(datei, "utf8");
  const e = wirft(() => v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash, auswahl: ["meine"], gesehenHash: r.aktuellerHash }));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "erneut");
  assert.equal(readFileSync(datei, "utf8"), stand, "nichts überschrieben");
});

test("K2: Platte unverändert gegenüber der Basis — einfaches Speichern, kein Zusammenführen", () => {
  const { v, datei, basis, hash } = aufbau();
  const r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine: basis + "neu\n", basisHash: hash });
  assert.equal(r.art, "gespeichert");
  assert.equal(readFileSync(datei, "utf8"), basis + "neu\n");
});

test("K2: abwechselnd schreiben zwei Programme in dieselbe Datei (25 Runden, echte Kindprozesse) — keine Zeile geht verloren", () => {
  const { v, support, d, datei } = aufbau("# Log\n\nstart\n");
  let l = v.lies("10_notizen/a.md");
  let basis = l.inhalt, hash = l.hash, editor = basis;
  const meineZeilen = [], fremdeZeilen = [];
  for (let i = 0; i < 25; i++) {
    const fremd = `fremd ${i}`;
    fremdAn(datei, `${fremd}\n`); fremdeZeilen.push(fremd);          // das andere Programm schreibt (hängt an)
    const mein = `meine ${i}`;
    editor = editor.replace("# Log\n", `# Log\n${mein}\n`); meineZeilen.push(mein); // ich ergänze oben
    let r;
    try { const x = v.schreibe({ pfad: "10_notizen/a.md", inhalt: editor, basisHash: hash }); r = { art: "gespeichert", hash: x.hash, text: editor }; }
    catch (e) { assert.equal(e.status, 409, "nur der Hash-Konflikt ist erlaubt"); r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine: editor, basisHash: hash }); }
    assert.notEqual(r.art, "konflikt", `Runde ${i}: Anfang und Ende überschneiden sich nicht`);
    editor = r.text; basis = r.text; hash = r.hash;
    assert.equal(readFileSync(datei, "utf8"), editor);
  }
  const ende = readFileSync(datei, "utf8");
  for (const z of [...meineZeilen, ...fremdeZeilen]) assert.ok(ende.includes(z + "\n"), `fehlt: ${z}`);
  assert.ok(ablage.liste(support, d).length >= 20, "jede überschriebene fremde Fassung liegt in der Ablage");
});

test("Ablage ist Pflicht: lässt sich nicht ablegen, wird nichts überschrieben", () => {
  const { d, datei, basis, hash } = aufbau();
  // Support-Ordner ist eine Datei → die Ablage kann nicht angelegt werden
  const kaputt = tmp("brain-ngv-kaputt-"); writeFileSync(join(kaputt, "x"), "");
  const v = oeffneVault(d, { support: join(kaputt, "x") });
  fremdAn(datei, "fremd\n");
  const vorher = readFileSync(datei, "utf8");
  assert.throws(() => v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine: basis.replace("erste", "ERSTE"), basisHash: hash }));
  assert.equal(readFileSync(datei, "utf8"), vorher);
});

test("Speichern mit altem Hash (ein fremdes Programm hat dazwischen geschrieben) wird abgewiesen und lässt dessen Text stehen", () => {
  const { v, datei, hash } = aufbau();
  fremdAn(datei, "dazwischen\n");
  assert.equal(wirft(() => v.schreibe({ pfad: "10_notizen/a.md", inhalt: "ganz neu\n", basisHash: hash })).status, 409);
  assert.match(readFileSync(datei, "utf8"), /dazwischen/);
});

// ──────────────────────────────────────────── Entwurfs-Journal
test("Entwurf: Datei 0600 im Support-Ordner mit Pfad, Basis-Hash, Zeit und Text; Ordner 0700; löschen nach dem Speichern", () => {
  const { v, support, d, hash } = aufbau();
  const r = entwurf.schreibeEntwurf(support, d, { pfad: "10_notizen/a.md", basisHash: hash, text: "# ungespeichert\n" });
  const ordner = join(support, "entwuerfe", kennung(d));
  const dateien = readdirSync(ordner);
  assert.equal(dateien.length, 1); assert.match(dateien[0], /^[0-9a-f]{32}\.json$/);
  assert.equal(statSync(join(ordner, dateien[0])).mode & 0o777, 0o600);
  assert.equal(statSync(ordner).mode & 0o777, 0o700);
  const e = entwurf.leseEntwurf(support, d, "10_notizen/a.md");
  assert.deepEqual([e.pfad, e.basisHash, e.text, e.zeit], ["10_notizen/a.md", hash, "# ungespeichert\n", r.zeit]);
  assert.equal(entwurf.listeEntwuerfe(support, d).length, 1);
  assert.equal(entwurf.loescheEntwurf(support, d, "10_notizen/a.md"), true);
  assert.equal(entwurf.leseEntwurf(support, d, "10_notizen/a.md"), null);
  assert.deepEqual(readdirSync(ordner), []);
  void v;
});

test("Entwurf: Pfade außerhalb des Vaults und zu große Texte werden abgewiesen", () => {
  const { support, d } = aufbau();
  for (const p of ["../x.md", "/etc/passwd", ".git/config", "a/../../x.md"]) assert.throws(() => entwurf.schreibeEntwurf(support, d, { pfad: p, text: "x" }), HttpFehler, p);
  assert.equal(wirft(() => entwurf.schreibeEntwurf(support, d, { pfad: "a.md", text: "x".repeat(5 * 1024 * 1024 + 1) })).status, 413);
});

test("Entwurf wird nur angeboten, wenn er NEUER ist als die Datei und anders als ihr Inhalt", async () => {
  const { v, support, d, datei, basis, hash } = aufbau();
  // 1. neuer und anders → angeboten
  utimesSync(datei, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  entwurf.schreibeEntwurf(support, d, { pfad: "10_notizen/a.md", basisHash: hash, text: basis + "ungespeichert\n" });
  let p = v.entwurfPruefen("10_notizen/a.md");
  assert.equal(p.entwurf.text, basis + "ungespeichert\n"); assert.equal(p.datei.inhalt, basis);
  // 2. Datei ist inzwischen neuer als der Entwurf → nicht mehr angeboten, aber nicht verloren: er liegt danach in der Ablage (Review 4a)
  await warte(20);
  fremdAn(datei, "neuer von außen\n");
  p = v.entwurfPruefen("10_notizen/a.md");
  assert.equal(p.entwurf, null); assert.equal(p.aelter, true);
  assert.ok(ablage.liste(support, d, "10_notizen/a.md").some((f) => f.grund === "entwurf-verworfen" && ablage.lese(support, d, f.id).inhalt === basis + "ungespeichert\n"), "der Entwurf liegt in der Ablage");
  assert.equal(entwurf.leseEntwurf(support, d, "10_notizen/a.md"), null, "und ist aus dem Journal entfernt");
  // 3. Entwurf gleich dem Inhalt → überflüssig, wird entfernt
  entwurf.schreibeEntwurf(support, d, { pfad: "10_notizen/a.md", basisHash: hash, text: readFileSync(datei, "utf8") });
  utimesSync(datei, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  assert.equal(v.entwurfPruefen("10_notizen/a.md").entwurf, null);
  assert.equal(entwurf.leseEntwurf(support, d, "10_notizen/a.md"), null);
});

test("Ablage: 0600, gleiche Fassung nicht doppelt, Kennung wird geprüft", () => {
  const { support, d } = aufbau();
  const a = ablage.legeAb(support, d, { pfad: "a.md", inhalt: "eins\n", grund: "fremd-eingearbeitet", quelle: "Claude Code" });
  const b = ablage.legeAb(support, d, { pfad: "a.md", inhalt: "eins\n", grund: "fremd-eingearbeitet", quelle: "Claude Code" });
  assert.equal(a.id, b.id); assert.equal(b.neu, false);
  const ordner = join(support, "fassungen", kennung(d));
  for (const n of readdirSync(ordner)) assert.equal(statSync(join(ordner, n)).mode & 0o777, 0o600, n);
  assert.equal(ablage.lese(support, d, a.id).quelle, "Claude Code");
  for (const id of ["../x", "f_abc", "", null, "f_aaaaaa_zzzzzzzz"]) assert.equal(wirft(() => ablage.lese(support, d, id)).status, 404, String(id));
});

// ──────────────────────────────────────────── Automatische lokale Fassungen
function gitVault() {
  const d = repo("brain-auto-");
  const support = tmp("brain-auto-support-");
  const v = oeffneVault(d, { support });
  return { d, support, v };
}
const letzterCommit = (d) => g(d, "log", "-1", "--format=%s").trim();
const anzahlCommits = (d) => Number(g(d, "rev-list", "--count", "HEAD").trim());

test("W3: Standard „an“ — nach dem Speichern und Leerlauf entsteht EIN Commit „Automatisch gesichert: N Notizen“ (nur lokal)", async () => {
  assert.equal(APP_STANDARD.fassungenAutomatisch, true);
  assert.equal(APP_STANDARD.abgleichAutomatisch, false);
  const { d, support, v } = gitVault();
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 80, wiederholMs: 80 });
  const vorher = anzahlCommits(d);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  v.schreibe({ pfad: "00_inbox/b.md", inhalt: "# B\n", basisHash: null }); auto.vermerke(v, ["00_inbox/b.md"]);
  assert.equal(anzahlCommits(d), vorher, "noch nicht: der Leerlauf läuft");
  assert.equal(auto.stand(v).offen, true);
  await bis(() => anzahlCommits(d) > vorher);
  await bis(() => auto.stand(v).letzte);
  assert.equal(anzahlCommits(d), vorher + 1);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 2 Notizen");
  assert.equal(g(d, "status", "--porcelain").trim(), "");
  const s = auto.stand(v);
  assert.equal(s.letzte.anzahl, 2); assert.equal(s.offen, false);
  assert.equal(nachrichtFuer(1), "Automatisch gesichert: 1 Notiz");
  auto.beende();
});

test("W3: Schalter aus — es wird nichts angelegt; wieder an — es geht weiter", async () => {
  const { d, support, v } = gitVault();
  const stand = leseApp(support).stand;
  schreibeApp(support, { fassungenAutomatisch: false }, stand);
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 60, wiederholMs: 60 });
  const vorher = anzahlCommits(d);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  await warte(400);
  assert.equal(anzahlCommits(d), vorher);
  assert.equal(auto.stand(v).an, false);
  assert.equal((await auto.sichere(v, "fenster")).art, "aus");
  schreibeApp(support, { fassungenAutomatisch: null }, leseApp(support).stand); // zurück auf den Standard (an)
  v.schreibe({ pfad: "00_inbox/b.md", inhalt: "# B\n", basisHash: null }); auto.vermerke(v, ["00_inbox/b.md"]);
  await bis(() => anzahlCommits(d) > vorher);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 2 Notizen");
  auto.beende();
});

test("W3: Fenster gewechselt / App beendet — sofort sichern, auch ohne den Leerlauf; ohne vorheriges Speichern geschieht nichts", async () => {
  const { d, support, v } = gitVault();
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 60_000 });
  const vorher = anzahlCommits(d);
  schreibe(d, "00_inbox/von-ki.md", "# KI\n");                      // geändert von außen, nicht im Studio gespeichert
  assert.equal((await auto.sichere(v, "fenster")).art, "nichts", "nie ins Blaue: nur nach einem Speichern im Studio");
  assert.equal(anzahlCommits(d), vorher);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  const r = await auto.sichere(v, "beenden");
  assert.equal(r.art, "gesichert"); assert.equal(r.anzahl, 1, "nur die im Studio gespeicherte Notiz, nicht die von außen angelegte");
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  auto.beende();
});

test("W3: läuft ein Abgleich (gemeinsame Sperre #69/#73/#78), wartet die Automatik und sichert danach", async () => {
  const { d, support, v } = gitVault();
  const { nimmSperre } = await import(pfad("kern", "abgleich-sperre.mjs"));
  const sperrDatei = join(support, "backup", `${kennung(d)}.sperre`);
  const sp = nimmSperre(sperrDatei, { art: "backup" });
  assert.equal(sp.ok, true);
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 60, wiederholMs: 120 });
  const vorher = anzahlCommits(d);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  await warte(300);
  assert.equal(anzahlCommits(d), vorher, "solange die Sperre gehalten wird, kein Commit");
  sp.freigeben();
  await bis(() => anzahlCommits(d) > vorher);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  auto.beende();
});

test("W3: offene Zusammenführung oder Konflikt — die Automatik fasst nichts an", async () => {
  const { d, support, v } = gitVault();
  const auto = erzeugeAutoFassungen({ support });
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  const echtStatus = v.gitStatus;
  const falsch = { ...v, wurzel: v.wurzel, abgleichBeschaeftigt: async () => false, umstellungLaeuft: () => false, gitStatus: async () => ({ ...(await echtStatus()), konflikt: { dateien: [{ pfad: "00_inbox/a.md", art: "beide" }] } }), gitCommit: async () => { throw new Error("darf nicht committen"); } };
  assert.equal((await auto.sichere(falsch, "fenster")).art, "konflikt");
  auto.beende();
  void d;
});

test("W3: Geheimnis in einer Notiz — die Prüfung blockt, die Automatik hält an und meldet es; nach dem Entfernen geht es weiter", async () => {
  const { d, support, v } = gitVault();
  // Prüfung vor dem Sichern wie in einem vertrauten Vault: ein pre-commit-Hook, der den gestagten Stand liest
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nif git diff --cached | grep -q 'GEHEIMER-SCHLUESSEL'; then echo 'SECRETS: Notiz Zeile 3 — Credential-Muster'; exit 2; fi\nexit 0\n");
  chmodSync(hook, 0o755);
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 60, wiederholMs: 60 });
  const vorher = anzahlCommits(d);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n\nGEHEIMER-SCHLUESSEL=abc\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  await bis(() => auto.stand(v).angehalten);
  const s = auto.stand(v);
  assert.equal(s.angehalten.grund, "pruefung");
  assert.match(s.angehalten.ausgabe, /SECRETS/);
  assert.doesNotMatch(JSON.stringify(s), /abc/, "der Wert des Geheimnisses steht nirgends in der Meldung");
  assert.equal(anzahlCommits(d), vorher, "kein Commit mit dem Geheimnis");
  const ereignisse = leseEreignisse(support, kennung(d));
  assert.ok(ereignisse.some((e) => e.art === "sicherung-fehler"), "eine Mitteilung in der Glocke");
  // unverändert: kein zweiter Versuch, keine zweite Mitteilung
  assert.ok(["angehalten", "nichts"].includes((await auto.sichere(v, "fenster")).art));
  assert.equal(anzahlCommits(d), vorher);
  assert.equal(leseEreignisse(support, kennung(d)).filter((e) => e.art === "sicherung-fehler").length, 1);
  // Geheimnis entfernt → es geht weiter
  const l = v.lies("00_inbox/a.md");
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n\nSchlüssel liegt im Passwort-Manager\n", basisHash: l.hash }); auto.vermerke(v, ["00_inbox/a.md"]);
  await bis(() => anzahlCommits(d) > vorher);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  await bis(() => auto.stand(v).angehalten === null && auto.stand(v).letzte);
  assert.equal(auto.stand(v).angehalten, null);
  auto.beende();
});

test("W3: nicht vertrauter Vault — Git ist gesperrt, es geschieht nichts", async () => {
  await echt(async () => {
    const { d, support, v } = gitVault();
    const auto = erzeugeAutoFassungen({ support });
    const vorher = anzahlCommits(d);
    v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
    assert.equal((await auto.sichere(v, "fenster")).art, "kein-git");
    assert.equal(anzahlCommits(d), vorher);
    auto.beende();
  });
});

// ── Nach dem Review (Befunde 1–3, 12) ──
test("Review 1: die automatische Fassung nimmt nur Notizen mit — nie neue fremde Dateien, nie Nicht-Notizen, nie große Dateien", async () => {
  const { d, support, v } = gitVault();
  // schon versioniert: eine Notiz (wird später geändert) und ein Bild (wird später geändert)
  schreibe(d, "00_inbox/alt.md", "# Alt\n"); schreibe(d, "bilder/logo.png", "PNG1");
  g(d, "add", "--", "00_inbox/alt.md", "bilder/logo.png"); g(d, "commit", "-q", "-m", "alt");
  schreibe(d, "00_inbox/alt.md", "# Alt geändert\n"); schreibe(d, "bilder/logo.png", "PNG2");
  // nie versioniert: Video, PDF, halb geschriebene KI-Datei — das Studio hat sie nie gespeichert
  schreibe(d, "anhang/film.mov", "x".repeat(2000)); schreibe(d, "anhang/skript.pdf", "%PDF"); schreibe(d, "00_inbox/ki-halb.md", "# halb");
  // im Studio gespeichert, aber zu groß
  writeFileSync(join(d, "00_inbox/riesig.md"), "y".repeat(6 * 1024 * 1024));
  v.schreibe({ pfad: "00_inbox/neu.md", inhalt: "# Neu\n", basisHash: null });
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 60, wiederholMs: 60 });
  auto.vermerke(v, ["00_inbox/neu.md", "00_inbox/riesig.md"]);
  const vorher = anzahlCommits(d);
  assert.equal((await auto.sichere(v, "fenster")).art, "gesichert");
  assert.equal(anzahlCommits(d), vorher + 1);
  const drin = g(d, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();
  assert.deepEqual(drin, ["00_inbox/alt.md", "00_inbox/neu.md"], "nur die gespeicherte und die versionierte Notiz");
  const offen = g(d, "status", "--porcelain", "-uall").split("\n").filter(Boolean).map((z) => z.slice(3)).sort();
  assert.deepEqual(offen, ["00_inbox/ki-halb.md", "00_inbox/riesig.md", "anhang/film.mov", "anhang/skript.pdf", "bilder/logo.png"]);
  auto.beende();
});

test("Review 2: der Commit der automatischen Fassung läuft unter der gemeinsamen Sperre der Hintergrund-Sicherung", async () => {
  const { d, support, v } = gitVault();
  const { nimmSperre } = await import(pfad("kern", "abgleich-sperre.mjs"));
  const sperrDatei = join(support, "backup", `${kennung(d)}.sperre`);
  let mitten = null;
  const beobachtet = { ...v, gitCommit: async (a, e) => { const f = nimmSperre(sperrDatei, { art: "backup" }); mitten = f.ok; if (f.ok) f.freigeben(); return v.gitCommit(a, e); } };
  const auto = erzeugeAutoFassungen({ support });
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(beobachtet, ["00_inbox/a.md"]);
  const vorher = anzahlCommits(d);
  assert.equal((await auto.sichere(beobachtet, "fenster")).art, "gesichert");
  assert.equal(mitten, false, "mitten im Commit ist die Sperre gehalten: ein Abgleich der Hintergrund-Sicherung bekommt sie nicht");
  assert.equal(anzahlCommits(d), vorher + 1);
  assert.equal(existsSync(sperrDatei), false, "danach ist sie wieder frei");
  auto.beende();
});

test("Review 3: ein technischer Git-Fehler (index.lock) ist keine „Geheimnis gefunden“-Meldung — kein Anhalten, keine Glocke, später klappt es", async () => {
  const { d, support, v } = gitVault();
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 50, wiederholMs: 50 });
  const sperre = join(d, ".git", "index.lock");
  writeFileSync(sperre, "");
  const vorher = anzahlCommits(d);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null });
  // der Fehler selbst (vor dem Anstoßen der Automatik, damit nicht beide zugleich committen): 422, aber art „git“ — keine Ablehnung durch die Prüfung
  const e = await v.gitCommit({ nachricht: "x", dateien: ["00_inbox/a.md"] }).catch((x) => x);
  assert.equal(e.status, 422); assert.equal(e.extra.art, "git");
  auto.vermerke(v, ["00_inbox/a.md"]);
  await warte(150);
  assert.equal(anzahlCommits(d), vorher);
  assert.equal(auto.stand(v).angehalten, null, "nicht angehalten wegen eines vorübergehenden Fehlers");
  assert.equal(leseEreignisse(support, kennung(d)).filter((x) => x.art === "sicherung-fehler").length, 0, "keine Glocke");
  rmSync(sperre);
  await bis(() => anzahlCommits(d) > vorher, 6000);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  auto.beende();
});

test("Review 3: die Ablehnung durch die Prüfung trägt art „hook“; „meldet einmal“ gilt je betroffener Datei — eine weitere Notiz läutet nicht erneut", async () => {
  const { d, support, v } = gitVault();
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nif git diff --cached | grep -q 'GEHEIMER-SCHLUESSEL'; then echo 'SECRETS: Credential-Muster'; exit 2; fi\nexit 0\n");
  chmodSync(hook, 0o755);
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 50, wiederholMs: 50 });
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n\nGEHEIMER-SCHLUESSEL=abc\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  await bis(() => auto.stand(v).angehalten);
  const seit = auto.stand(v).angehalten.seit;
  const klein = (n) => n; void klein;
  // eine weitere, harmlose Notiz: die Automatik versucht es noch einmal (der Stand hat sich geändert) — die Prüfung lehnt a.md wieder ab, aber es läutet nichts mehr
  await warte(20);
  v.schreibe({ pfad: "00_inbox/b.md", inhalt: "# B\n", basisHash: null }); auto.vermerke(v, ["00_inbox/b.md"]);
  await bis(() => auto.stand(v).angehalten && auto.stand(v).angehalten.seit !== seit);
  assert.equal(leseEreignisse(support, kennung(d)).filter((e) => e.art === "sicherung-fehler").length, 1, "genau eine Glocke für a.md");
  auto.beende();
});

test("Review 12: war beim „Fenster gewechselt“ gerade ein Abgleich dran, fragt die Automatik später noch einmal (nicht erst beim nächsten Speichern)", async () => {
  const { d, support, v } = gitVault();
  const { nimmSperre } = await import(pfad("kern", "abgleich-sperre.mjs"));
  const sp = nimmSperre(join(support, "backup", `${kennung(d)}.sperre`), { art: "backup" });
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 60_000, wiederholMs: 80 });
  const vorher = anzahlCommits(d);
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  assert.equal((await auto.sichere(v, "fenster")).art, "besetzt");
  assert.equal(anzahlCommits(d), vorher);
  sp.freigeben();
  await bis(() => anzahlCommits(d) > vorher, 5000);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  auto.beende();
});

// ── Nach dem Review (Befund 6, 8) ──
test("Review 6: merge3 gegen `git merge-file` (fester Seed) — wo Git einen Konflikt meldet, meldet merge3 ihn auch; wo beide sauber sind, ist das Ergebnis gleich", () => {
  const dir = tmp("brain-m3-fuzz-");
  let z = 20261105; const zufall = (n) => { z = (z * 1103515245 + 12345) & 0x7fffffff; return (z >> 8) % n; };
  const woerter = ["# h", "a", "b", "c", "c", "", "d"];
  const erzeuge = (n) => Array.from({ length: n }, () => woerter[zufall(woerter.length)]);
  const aendere = (zeilen) => {
    const k = zeilen.slice();
    for (let i = zufall(3) + 1; i > 0; i--) {
      const art = zufall(3), pos = zufall(k.length + 1);
      if (art === 0) k.splice(pos, 0, ...erzeuge(zufall(2) + 1));
      else if (art === 1 && k.length > 1) k.splice(Math.min(pos, k.length - 1), zufall(2) + 1);
      else if (k.length) k.splice(Math.min(pos, k.length - 1), 1, woerter[zufall(woerter.length)]);
    }
    return k;
  };
  const text = (zeilen) => (zeilen.length ? zeilen.join("\n") + "\n" : "");
  const gitFuer = (b, m, a) => {
    for (const [n, t] of [["b", b], ["m", m], ["a", a]]) writeFileSync(join(dir, n), t);
    try { return { konflikt: false, text: execFileSync("git", ["merge-file", "-p", "-L", "m", "-L", "b", "-L", "a", join(dir, "m"), join(dir, "b"), join(dir, "a")], { env: sauber(), encoding: "utf8" }) }; }
    catch (e) { if (typeof e.status === "number" && e.status > 0 && e.status < 128) return { konflikt: true }; throw e; }
  };
  let gitKonflikt = 0, strenger = 0, gleichSauber = 0;
  const FAELLE = 600;
  for (let i = 0; i < FAELLE; i++) {
    const basis = erzeuge(zufall(7) + 2), meine = aendere(basis), andere = aendere(basis);
    const [b, m, a] = [text(basis), text(meine), text(andere)];
    const g2 = gitFuer(b, m, a);
    const r = drei(b, m, a);
    if (g2.konflikt) { gitKonflikt++; assert.equal(r.sauber, false, `Git meldet einen Konflikt, merge3 nicht: ${JSON.stringify({ b, m, a })}`); continue; }
    if (!r.sauber) { strenger++; continue; }
    gleichSauber++;
    assert.equal(baue(r.teile), g2.text, `anderes Ergebnis als Git: ${JSON.stringify({ b, m, a })}`);
  }
  assert.ok(gitKonflikt > 100 && gleichSauber > 100, `zu wenig Fälle: ${gitKonflikt} Konflikte, ${gleichSauber} sauber`);
  assert.ok(strenger < FAELLE * 0.1, `merge3 meldet zu oft Konflikte, wo Git sauber ist: ${strenger}`);
});

test("Review 6: aneinanderstoßende Änderungen und gleiche Zeilen in Folge — die Beispiele aus dem Review", () => {
  // Basis mit drei gleichen Zeilen: beide Seiten löschen EINE davon (dieselbe Änderung) — es bleiben zwei, nicht eine (so rechnet auch Git)
  const r1 = drei("\n# h\na\nc\nc\nc\n", "# h\na\nc\nc\n", "\n# h\na\nc\nc\n");
  assert.equal(r1.sauber, true); assert.equal(baue(r1.teile), "# h\na\nc\nc\n");
  // „# h“ steht in der Basis vor zwei Leerzeilen: eine Seite löscht die Überschrift, die andere die Leerzeilen — sie berühren einander
  const r2 = drei("# h\n\n\n", "# h\n", "\n\n");
  assert.equal(r2.sauber, false);
  // zwischen den Änderungen liegt eine unveränderte Zeile: sauber
  const r3 = drei("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n");
  assert.equal(r3.sauber, true); assert.equal(baue(r3.teile), "A\nb\nC\n");
  // unmittelbar nebeneinander: Konflikt
  const r4 = drei("a\nb\nc\n", "A\nb\nc\n", "a\nB\nc\n");
  assert.equal(r4.sauber, false);
});

test("Review 8: eigener Text im Konfliktblock behält Leerzeile und Zeilenenden", () => {
  const r = drei("x\nalt\ny\n", "x\nmeine\n\ny\n", "x\nandere\ny\n");
  const k = r.teile.find((t) => t.t === "konflikt");
  assert.deepEqual(k.meine, ["meine\n", "\n"]);
  // der Text gilt wörtlich: eine Leerzeile am Ende bleibt erhalten
  assert.equal(baue(r.teile, [{ text: "meine\n\n" }]), "x\nmeine\n\ny\n");
  assert.equal(baue(r.teile, [{ text: "meine\n" }]), "x\nmeine\ny\n");
  // CRLF-Datei: die Zeilen des Blocks tragen ihr \r; ein eigener Text mit \r\n bleibt in der Datei einheitlich
  const c = drei("x\r\nalt\r\ny\r\n", "x\r\nmeine\r\ny\r\n", "x\r\nandere\r\ny\r\n");
  assert.equal(baue(c.teile, [{ text: "selbst\r\nzusammen\r\n" }]), "x\r\nselbst\r\nzusammen\r\ny\r\n");
});

// ── Nach dem Review (Befunde 9, 13, 14) ──
test("Review 13: die Ablage hat Grenzen — keine Datei über MAX_DATEI, und insgesamt höchstens 200 MB je Vault (die ältesten gehen zuerst)", () => {
  const { v, support, d } = aufbau();
  assert.equal(wirft(() => v.ablageLegeAb({ pfad: "10_notizen/a.md", inhalt: "x".repeat(5 * 1024 * 1024 + 1) })).status, 413);
  // 45 Fassungen zu je knapp 5 MB (verschieden, sonst sind sie „dieselbe Fassung“) überschreiten 200 MB: der Rest bleibt darunter, die neueste ist da
  let letzte;
  for (let i = 0; i < 45; i++) letzte = ablage.legeAb(support, d, { pfad: `10_notizen/g${i}.md`, inhalt: String(i).padStart(8, "0") + "y".repeat(4_900_000), grund: "meine-verworfen" });
  const rest = ablage.liste(support, d);
  const summe = rest.reduce((n, e) => n + e.groesse, 0);
  assert.ok(summe <= 200 * 1024 * 1024, `Gesamtgröße ${summe}`);
  assert.ok(rest.length < 45 && rest.length > 30, `Anzahl ${rest.length}`);
  assert.ok(rest.some((e) => e.id === letzte.id), "die neueste Fassung bleibt");
});

test("Review 14: das Zusammenführen wartet, bis die fremde Datei still ist (eine halb geschriebene Datei wird nicht halb zusammengeführt)", async () => {
  const d = repo("brain-stabil-"), support = tmp("brain-stabil-support-");
  schreibe(d, "10_notizen/a.md", "# A\n\nzeile 1\nzeile 2\n"); g(d, "add", "--", "10_notizen/a.md"); g(d, "commit", "-q", "-m", "a");
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, auto: { leerlaufMs: 60_000 } });
  const rufe = aufruf(h);
  const r0 = await rufe("GET", "/api/datei", undefined, "pfad=10_notizen%2Fa.md");
  const basis = r0.j.inhalt;
  const datei = join(d, "10_notizen/a.md");
  // ein anderes Programm schreibt in zwei Stößen (150 ms Pause); das Zusammenführen beginnt zwischen den Stößen
  writeFileSync(datei, basis + "von außen, erster Teil\n");
  setTimeout(() => writeFileSync(datei, basis + "von außen, erster Teil\nvon außen, zweiter Teil\n"), 150);
  const r = await rufe("POST", "/api/datei/zusammenfuehren", { pfad: "10_notizen/a.md", basis, meine: basis.replace("# A", "# A (Studio)"), basisHash: r0.j.hash });
  assert.equal(r.status, 200);
  const jetzt = readFileSync(datei, "utf8");
  assert.match(jetzt, /zweiter Teil/, "die fertig geschriebene Fassung wurde zusammengeführt, nicht die halbe");
  assert.match(jetzt, /# A \(Studio\)/);
});

test("Review 9: das Journal gehört zu einem Vault — beim Wechsel endet alles, was noch in der Reihe steht, und gleiche Pfade in zwei Vaults verwechseln sich nicht", async () => {
  const { erzeugeJournal } = await import(pfad("studio", "entwurf.js"));
  const aufrufe = [];
  let vaultKennung = "A", release;
  const tor = new Promise((ok) => { release = ok; });
  const api = { entwurfSchreiben: async (p, bh, t) => { aufrufe.push(["schreibe", vaultKennung, p, t]); await tor; }, entwurfLoeschen: async (p) => { aufrufe.push(["loesche", vaultKennung, p]); } };
  let stand = { pfad: "a.md", text: "Text", basisHash: "h", dirty: true };
  const j = erzeugeJournal({ api, lies: () => stand, vault: () => vaultKennung, intervallMs: 10_000 });
  j.schreibeJetzt(); await warte(5);       // Vault A: Schreiben beginnt (hängt am Tor)
  j.nachSpeichern("a.md");                 // dahinter in der Reihe: das Löschen
  j.zuruecksetzen();                       // Wechsel zu Vault B
  vaultKennung = "B"; release();
  await warte(30);
  assert.deepEqual(aufrufe.map((a) => a[0]), ["schreibe"], "das wartende Löschen läuft nicht gegen den neuen Vault");
  // derselbe Pfad mit demselben Text im neuen Vault wird wieder geschrieben (nicht als „schon geschrieben“ übersprungen)
  j.schreibeJetzt(); await j.warte();
  assert.deepEqual(aufrufe.map((a) => a[0]), ["schreibe", "schreibe"]);
  assert.equal(aufrufe[1][1], "B");
});

test("Nach Review 2 (merge3): Fuzz gegen `git merge-file` mit und ohne Schluss-Zeilenumbruch, CRLF, einzelnem \\r und BOM — Git-Konflikt heißt merge3-Konflikt", () => {
  const dir = tmp("brain-m3-fuzz2-");
  let z = 7312026; const zufall = (n) => { z = (z * 1103515245 + 12345) & 0x7fffffff; return (z >> 8) % n; };
  const woerter = ["# h", "a", "b", "c", "c", "", "", "d", "x\r", "ü", " "];
  const erzeuge = (n) => Array.from({ length: n }, () => woerter[zufall(woerter.length)]);
  const aendere = (zeilen) => {
    const k = zeilen.slice();
    for (let i = zufall(3) + 1; i > 0; i--) {
      const art = zufall(4), pos = zufall(k.length + 1);
      if (art === 0) k.splice(pos, 0, ...erzeuge(zufall(3) + 1));
      else if (art === 1 && k.length) k.splice(Math.min(pos, k.length - 1), zufall(3) + 1);
      else if (art === 2 && k.length) k.splice(Math.min(pos, k.length - 1), 1, woerter[zufall(woerter.length)]);
    }
    return k;
  };
  const text = (zeilen, schluss, crlf, bom) => { const e = crlf ? "\r\n" : "\n"; let s = zeilen.join(e); if (zeilen.length && schluss) s += e; return (bom ? "﻿" : "") + s; };
  const gitFuer = (b, m, a) => {
    for (const [n, t] of [["b", b], ["m", m], ["a", a]]) writeFileSync(join(dir, n), t);
    const r = spawnSync("git", ["merge-file", "-p", join(dir, "m"), join(dir, "b"), join(dir, "a")], { env: sauber(), encoding: "utf8" });
    if (r.status === null || r.status < 0 || r.status >= 128) throw new Error("git merge-file: " + r.stderr);
    return { konflikt: r.status > 0, text: r.stdout };
  };
  let gitKonflikt = 0, ohneSchluss = 0, strenger = 0, gleichSauber = 0;
  const FAELLE = 800;
  for (let i = 0; i < FAELLE; i++) {
    const basis = erzeuge(zufall(7) + 1), meine = aendere(basis), andere = aendere(basis);
    const crlf = zufall(5) === 0, bom = zufall(8) === 0;
    const schluss = () => zufall(3) !== 0;
    const [b, m, a] = [text(basis, schluss(), crlf, bom), text(meine, schluss(), crlf, bom), text(andere, schluss(), crlf, bom)];
    if (![b, m, a].every((t) => t.endsWith("\n") || t === "" || t === "﻿")) ohneSchluss++;
    const g2 = gitFuer(b, m, a);
    const r = drei(b, m, a);
    if (g2.konflikt) { gitKonflikt++; assert.equal(r.sauber, false, `Git meldet einen Konflikt, merge3 nicht: ${JSON.stringify({ b, m, a })}`); continue; }
    if (!r.sauber) { strenger++; continue; }
    gleichSauber++;
    // Sauber bei beiden: kein Verlust. (Gleiche Zeilen in Folge dürfen anders zugeordnet sein — dann prüft der erste Fuzz-Test das Ergebnis genau; hier gilt: Zeilenzahl je Zeile mindestens wie bei Git.)
    const roh = baue(r.teile);
    const zaehle = (t) => { const c = new Map(); for (const l of t.replace(/^﻿/, "").split("\n")) if (l !== "") c.set(l, (c.get(l) || 0) + 1); return c; };
    const C = zaehle(roh), G = zaehle(g2.text);
    for (const [l, n] of G) assert.ok((C.get(l) || 0) >= n, `merge3 verliert eine Zeile, die Git behält (${JSON.stringify(l)}): ${JSON.stringify({ b, m, a, roh, git: g2.text })}`);
  }
  assert.ok(gitKonflikt > 100 && gleichSauber > 100 && ohneSchluss > 100, `zu wenig Fälle: ${gitKonflikt} Konflikte, ${gleichSauber} sauber, ${ohneSchluss} ohne Schlussumbruch`);
  assert.ok(strenger < FAELLE * 0.15, `merge3 meldet zu oft Konflikte, wo Git sauber ist: ${strenger}`);
});

test("Nach Review 2 (merge3): Beispiele — ein fehlender Schlussumbruch ist eine Änderung der letzten Zeile, keine zusätzliche leere Zeile", () => {
  assert.equal(drei("x\r\n\nb\nü\n", "x\r\n\nb\nü\n\nx\r", "").sauber, false);
  // beide hängen am Dateiende an, eine Seite ohne Umbruch: Konflikt wie bei Git, nichts geht verloren
  const r = drei("a\nb\n", "a\nb\nmeine", "a\nb\nandere\n");
  assert.equal(r.sauber, false);
  assert.equal(baue(r.teile, ["beide"]), "a\nb\nmeine\nandere\n");
  // der Schlussumbruch allein ist eine Änderung der letzten Zeile; die andere Seite ändert eine frühere: sauber, und das Ergebnis behält ihn
  const s = drei("a\nb\nc", "a\nb\nc\n", "A\nb\nc");
  assert.equal(s.sauber, true); assert.equal(baue(s.teile), "A\nb\nc\n");
  assert.equal(baue(drei("", "x\n", "").teile), "x\n");
});

// ── Nach Review 2: Kleinigkeiten ──
test("Nach Review 2: die automatische Fassung nimmt keine bloß vorgemerkten fremden .md-Dateien mit", async () => {
  const { d, support, v } = gitVault();
  schreibe(d, "00_inbox/fremd-vorgemerkt.md", "# von einem anderen Programm\n");
  g(d, "add", "--", "00_inbox/fremd-vorgemerkt.md");            // ein anderes Programm hat sie schon vorgemerkt, aber nie committet
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null });
  const auto = erzeugeAutoFassungen({ support });
  auto.vermerke(v, ["00_inbox/a.md"]);
  assert.equal((await auto.sichere(v, "fenster")).art, "gesichert");
  const drin = g(d, "show", "--name-only", "--format=", "HEAD").trim().split("\n");
  assert.deepEqual(drin, ["00_inbox/a.md"]);
  auto.beende();
});

test("Nach Review 2: ein Hook, der aus anderem Grund scheitert (kein Fund), heißt „angehalten“, nicht „Geheimnis gefunden“", async () => {
  const { d, support, v } = gitVault();
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'node: command not found' >&2\nexit 127\n");
  chmodSync(hook, 0o755);
  const auto = erzeugeAutoFassungen({ support, leerlaufMs: 50, wiederholMs: 50 });
  v.schreibe({ pfad: "00_inbox/a.md", inhalt: "# A\n", basisHash: null }); auto.vermerke(v, ["00_inbox/a.md"]);
  await bis(() => auto.stand(v).angehalten);
  const s = auto.stand(v);
  assert.equal(s.angehalten.grund, "hook-fehler");
  assert.doesNotMatch(s.angehalten.text, /gefunden/);
  assert.match(s.angehalten.text, /hat angehalten/);
  const bell = leseEreignisse(support, kennung(d)).filter((e) => e.art === "sicherung-fehler");
  assert.equal(bell.length, 1); assert.doesNotMatch(bell[0].text, /etwas gefunden/);
  auto.beende();
});

test("Nach Review 2: Entwürfe über 30 Tage gehen vor dem Löschen in die Ablage", () => {
  const { support, d } = aufbau();
  entwurf.schreibeEntwurf(support, d, { pfad: "10_notizen/a.md", basisHash: "h", text: "ALTER ENTWURF\n" });
  // den Entwurf 31 Tage alt machen
  const dir = join(support, "entwuerfe", kennung(d)), name = readdirSync(dir)[0];
  const o = JSON.parse(readFileSync(join(dir, name), "utf8")); o.zeit = new Date(Date.now() - 31 * 86_400_000).toISOString();
  writeFileSync(join(dir, name), JSON.stringify(o) + "\n");
  assert.deepEqual(entwurf.listeEntwuerfe(support, d), []);
  assert.equal(readdirSync(dir).length, 0, "aus dem Journal entfernt");
  const f = ablage.liste(support, d, "10_notizen/a.md");
  assert.equal(f.length, 1); assert.equal(f[0].grund, "entwurf-verworfen");
  assert.equal(ablage.lese(support, d, f[0].id).inhalt, "ALTER ENTWURF\n");
});

test("Nach Review 2: Ablage des Auto-Einarbeitens enthält auch MEINE Fassung (Route)", async () => {
  const { v, support, d, datei, basis, hash } = aufbau();
  fremdAn(datei, "Zeile von außen (KI)\n");
  const meine = basis.replace("zweite Zeile", "zweite Zeile, von mir geändert");
  const r = v.zusammenfuehren({ pfad: "10_notizen/a.md", basis, meine, basisHash: hash });
  assert.equal(r.art, "eingearbeitet");
  assert.equal(ablage.lese(support, d, r.meineFassung).inhalt, meine);
});

// ──────────────────────────────────────────── Routen der Werkstatt
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { status: r.status, j };
};
test("Routen: Speichern stößt die automatische Fassung an, Zusammenführen/Entwurf/Ablage/Auto-Stand sind erreichbar", async () => {
  const d = repo("brain-routen-"), support = tmp("brain-routen-support-");
  schreibe(d, "10_notizen/a.md", "# A\n\nzeile 1\nzeile 2\n"); g(d, "add", "--", "10_notizen/a.md"); g(d, "commit", "-q", "-m", "a");
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, auto: { leerlaufMs: 80, wiederholMs: 80 } });
  const rufe = aufruf(h);
  let r = await rufe("GET", "/api/datei", undefined, "pfad=10_notizen%2Fa.md");
  const basis = r.j.inhalt, hash = r.j.hash;
  r = await rufe("GET", "/api/auto/stand");
  assert.equal(r.status, 200); assert.equal(r.j.an, true); assert.equal(r.j.offen, false);
  // PUT → Vermerk → Commit
  const neu = basis.replace("zeile 1", "zeile 1 (Studio)");
  r = await rufe("PUT", "/api/datei", { pfad: "10_notizen/a.md", inhalt: neu, basisHash: hash });
  assert.equal(r.status, 200);
  assert.equal((await rufe("GET", "/api/auto/stand")).j.offen, true);
  await bis(() => letzterCommit(d).startsWith("Automatisch gesichert"));
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  // fremde Änderung → Zusammenführen über die Route
  fremdAn(join(d, "10_notizen/a.md"), "von außen\n");
  r = await rufe("POST", "/api/datei/zusammenfuehren", { pfad: "10_notizen/a.md", basis: neu, meine: neu.replace("# A", "# A (Studio)"), basisHash: "x" });
  assert.equal(r.status, 200); assert.equal(r.j.art, "eingearbeitet");
  assert.match(readFileSync(join(d, "10_notizen/a.md"), "utf8"), /von außen/);
  r = await rufe("GET", "/api/ablage", undefined, "pfad=10_notizen%2Fa.md");
  assert.equal(r.j.fassungen.length, 2);
  r = await rufe("GET", "/api/ablage/fassung", undefined, `id=${r.j.fassungen.find((f) => f.grund === "fremd-eingearbeitet").id}`);
  assert.match(r.j.inhalt, /von außen/);
  // Entwurf: schreiben, lesen (bei gleicher Zeit wie die Datei: nicht neuer → gleich nach dem Schreiben ist er neuer), listen, löschen (POST)
  r = await rufe("PUT", "/api/entwurf", { pfad: "10_notizen/a.md", basisHash: hash, text: "# Entwurf\n" });
  assert.equal(r.status, 200);
  assert.equal((await rufe("GET", "/api/entwuerfe")).j.entwuerfe.length, 1);
  r = await rufe("GET", "/api/entwurf", undefined, "pfad=10_notizen%2Fa.md");
  assert.equal(r.j.entwurf.text, "# Entwurf\n");
  assert.equal((await rufe("POST", "/api/entwurf/loeschen", { pfad: "10_notizen/a.md" })).j.ok, true);
  assert.equal((await rufe("GET", "/api/entwuerfe")).j.entwuerfe.length, 0);
  // Auto sichern: jetzt (Fenster gewechselt) — nach dem Zusammenführen ist wieder etwas offen
  r = await rufe("POST", "/api/auto/sichern", { grund: "fenster" });
  assert.equal(r.status, 200); assert.ok(["gesichert", "nichts", "laeuft"].includes(r.j.art), JSON.stringify(r.j)); // „laeuft“: der Leerlauf-Zeitgeber war schneller
  await bis(async () => (await rufe("GET", "/api/auto/stand")).j.offen === false && anzahlCommits(d) >= 4);
  assert.equal(letzterCommit(d), "Automatisch gesichert: 1 Notiz");
  assert.equal(anzahlCommits(d), 4, "Start, a, erste und zweite automatische Fassung — keine doppelten Commits");
  // Methoden
  assert.equal((await rufe("GET", "/api/datei/zusammenfuehren")).status, 405);
  assert.equal((await rufe("PUT", "/api/auto/stand", {})).status, 405);
  h.ereignisse.beende();
});

test("Einstellungen: „Fassungen automatisch anlegen“ (an) und „Automatisch abgleichen“ (aus, vorbereitet) liegen im Schema der App", async () => {
  const d = repo("brain-einst-"), support = tmp("brain-einst-support-");
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  const r = await rufe("GET", "/api/einstellungen");
  assert.equal(r.j.werte.fassungenAutomatisch, true);
  assert.equal(r.j.werte.abgleichAutomatisch, false);
  assert.equal(r.j.schema.fassungenAutomatisch.quelle, "app");
  assert.ok(existsSync(join(d, ".git")));
});
