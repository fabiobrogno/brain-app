// Posteingang sichten (FBL-68/FBL-71): Verwerfen, Später, in Wiki-Seite übernehmen — Dateieffekte, genau ein Commit je Aktion,
// Rückweg bei Fehlern, Gesperrt/Kein-Git, Routen über den Handler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, chmodSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad, echt } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { setzeKopfFeld, koerperVon } = await import(pfad("gemeinsam", "posteingang.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const HEUTE = "2026-10-28";
const vault = (d, extra = {}) => oeffneVault(d, { heute: HEUTE, jetzt: () => new Date("2026-10-28T12:00:00Z"), ...extra });
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const lesen = (d, rel) => readFileSync(join(d, rel), "utf8");
const letzter = (d) => ({ nachricht: g(d, "log", "-1", "--format=%s").trim(), dateien: g(d, "show", "--name-status", "--format=", "--no-renames", "HEAD").trim().split("\n").sort() });
const anzahlCommits = (d) => Number(g(d, "rev-list", "--count", "HEAD").trim());
const sauber = (d) => g(d, "status", "--porcelain", "-uall").trim();
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};

// Repo mit Wiki, zwei Notizen im Posteingang (eine davon eingecheckt, eine noch nicht).
function posteingang() {
  const d = repo();
  schreibe(d, "00_inbox/2026-10-27_idee.md", "# Kaffee-Idee\n\nBohnen direkt vom Röster kaufen.\n\nZweite Zeile.\n");
  schreibe(d, "09_wiki/wissen/thema_kaffee.md", "---\nname: kaffee\ntyp: thema\nstand: 2026-10-01\n---\n# Kaffee\n\nKaffee ist ein Heißgetränk.\n");
  schreibe(d, "09_wiki/_schema.md", "# Schema\n");
  g(d, "add", "--", "00_inbox/2026-10-27_idee.md", "09_wiki/wissen/thema_kaffee.md", "09_wiki/_schema.md");
  g(d, "commit", "-q", "-m", "Grundstand");
  schreibe(d, "00_inbox/2026-10-28_frisch.md", "# Frisch\n\nNoch nicht eingecheckt.\n");
  return d;
}

// ---------- Kopf ----------
test("setzeKopfFeld: anlegen, ersetzen, entfernen, CRLF; der Rest bleibt bytegleich", () => {
  assert.equal(setzeKopfFeld("# T\n\nText\n", "spaeter_bis", "2026-11-01"), "---\nspaeter_bis: 2026-11-01\n---\n# T\n\nText\n");
  assert.equal(setzeKopfFeld("---\nname: x\n---\n# T\n", "spaeter_bis", "2026-11-01"), "---\nname: x\nspaeter_bis: 2026-11-01\n---\n# T\n");
  assert.equal(setzeKopfFeld("---\nspaeter_bis: 2026-11-01\nname: x\n---\n# T\n", "spaeter_bis", "2026-12-01"), "---\nspaeter_bis: 2026-12-01\nname: x\n---\n# T\n");
  assert.equal(setzeKopfFeld("---\nspaeter_bis: 2026-11-01\nname: x\n---\n# T\n", "spaeter_bis", null), "---\nname: x\n---\n# T\n");
  assert.equal(setzeKopfFeld("---\nspaeter_bis: 2026-11-01\n---\n# T\n", "spaeter_bis", null), "# T\n", "ein Kopf nur aus diesem Feld verschwindet ganz");
  assert.equal(setzeKopfFeld("# T\n", "spaeter_bis", null), "# T\n");
  assert.equal(setzeKopfFeld("---\nname: x\n---\n# T\r\n", "spaeter_bis", null), "---\nname: x\n---\n# T\r\n");
  assert.equal(setzeKopfFeld("---\r\nname: x\r\n---\r\n# T\r\n", "spaeter_bis", "2026-11-01"), "---\r\nname: x\r\nspaeter_bis: 2026-11-01\r\n---\r\n# T\r\n");
  assert.equal(setzeKopfFeld("---\nname: x\n---\n", "spaeter_bis", null), "---\nname: x\n---\n");
  assert.equal(setzeKopfFeld("---\nspaeter_bis: 2026-11-01\n---\n", "spaeter_bis", "2026-11-01"), "---\nspaeter_bis: 2026-11-01\n---\n");
  // ein gleichnamiger Text im Rumpf wird nie angefasst
  assert.equal(setzeKopfFeld("---\nname: x\n---\nspaeter_bis: 1\n", "spaeter_bis", null), "---\nname: x\n---\nspaeter_bis: 1\n");
});

test("koerperVon: ohne Kopf und erste Überschrift", () => {
  assert.equal(koerperVon("---\na: b\n---\n\n# Titel\n\nText\nmehr\n\n"), "Text\nmehr");
  assert.equal(koerperVon("Nur ein loser Gedanke\n"), "Nur ein loser Gedanke");
  assert.equal(koerperVon("# Nur Titel\n"), "");
  assert.equal(koerperVon("# T\r\n\r\nA\r\nB\r\n"), "A\nB");
});

// ---------- Verwerfen ----------
test("Verwerfen: Notiz wandert unverändert nach 90_archiv/verworfen, genau ein Commit, Archiv-Bereich", async () => {
  const d = posteingang();
  const v = vault(d);
  const vorher = lesen(d, "00_inbox/2026-10-27_idee.md"), n0 = anzahlCommits(d);
  const r = await v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-27_idee.md" });
  assert.equal(r.ziel, "90_archiv/verworfen/2026-10-27_idee.md");
  assert.equal(r.git, true);
  assert.equal(r.commit, g(d, "rev-parse", "HEAD").trim());
  assert.equal(existsSync(join(d, "00_inbox/2026-10-27_idee.md")), false);
  assert.equal(lesen(d, r.ziel), vorher, "bytegleich");
  assert.equal(anzahlCommits(d), n0 + 1);
  assert.deepEqual(letzter(d), { nachricht: "Posteingang: „Kaffee-Idee“ verworfen", dateien: ["A\t90_archiv/verworfen/2026-10-27_idee.md", "D\t00_inbox/2026-10-27_idee.md"] });
  assert.equal(g(d, "status", "--porcelain", "--", "90_archiv", "00_inbox/2026-10-27_idee.md").trim(), "");
  const n = (await v.notizen()).notizen;
  assert.equal(n.find((x) => x.pfad === r.ziel).bereich, "archiv");
  assert.ok(!n.some((x) => x.pfad === "00_inbox/2026-10-27_idee.md"));
  // andere offene Änderungen bleiben außen vor
  assert.equal(sauber(d), "?? 00_inbox/2026-10-28_frisch.md");
});

test("Verwerfen: noch nicht eingecheckte Notiz (Schnell merken) und Namensgleichheit → -2", async () => {
  const d = posteingang();
  const v = vault(d);
  const a = await v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-28_frisch.md" });
  assert.equal(a.ziel, "90_archiv/verworfen/2026-10-28_frisch.md");
  assert.deepEqual(letzter(d).dateien, ["A\t90_archiv/verworfen/2026-10-28_frisch.md"]);
  schreibe(d, "00_inbox/2026-10-28_frisch.md", "# Frisch\n\nNochmal gleicher Name.\n");
  const b = await v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-28_frisch.md" });
  assert.equal(b.ziel, "90_archiv/verworfen/2026-10-28_frisch-2.md");
  assert.match(lesen(d, a.ziel), /Noch nicht eingecheckt/);
  assert.match(lesen(d, b.ziel), /Nochmal gleicher Name/);
  const m = v.merken({ text: "Ein Merkzettel" });
  const c = await v.posteingangVerwerfen({ pfad: m.pfad });
  assert.ok(c.ziel.startsWith("90_archiv/verworfen/"));
  assert.equal(sauber(d), "");
});

test("Verwerfen: Fehler — nicht im Posteingang 409, fehlt 404, Pfad-Ausbruch 403, Unsinn 400, generiert 403; nichts geändert", async () => {
  const d = posteingang();
  schreibe(d, "00_inbox/_rueckfragen/f1.md", "# Frage\n");
  schreibe(d, "00_inbox/INDEX.md", "# Index\n");
  const v = vault(d);
  const kopf = g(d, "rev-parse", "HEAD");
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: "09_wiki/wissen/thema_kaffee.md" }))).status, 409);
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: "00_inbox/_rueckfragen/f1.md" }))).status, 409, "Maschinen-Ordner gehört nicht zum Posteingang");
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: "00_inbox/gibt-es-nicht.md" }))).status, 404);
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: "../aussen.md" }))).status, 403);
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: ".git/config" }))).status, 403);
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: "" }))).status, 400);
  assert.equal((await wirft(v.posteingangVerwerfen({}))).status, 400);
  assert.equal((await wirft(v.posteingangVerwerfen({ pfad: "00_inbox/INDEX.md" }))).status, 403);
  assert.equal(g(d, "rev-parse", "HEAD"), kopf);
  assert.ok(existsSync(join(d, "09_wiki/wissen/thema_kaffee.md")));
  assert.equal(existsSync(join(d, "90_archiv")), false);
});

test("Verwerfen: Commit scheitert (Hook) → Notiz liegt wieder an ihrem Platz, Fehler mit Ausgabe, kein Commit", async () => {
  const d = posteingang();
  const v = vault(d);
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'HOOK sagt nein'\nexit 1\n"); chmodSync(hook, 0o755);
  v.vertrauen(true); // Hooks laufen nur bei Vertrauen
  const vorher = lesen(d, "00_inbox/2026-10-27_idee.md"), kopf = g(d, "rev-parse", "HEAD");
  const e = await wirft(v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-27_idee.md" }));
  assert.equal(e.status, 422);
  assert.match(e.extra.ausgabe, /HOOK sagt nein/);
  assert.equal(lesen(d, "00_inbox/2026-10-27_idee.md"), vorher);
  assert.equal(existsSync(join(d, "90_archiv")), false, "auch die angelegten Archiv-Ordner sind wieder weg");
  assert.equal(g(d, "rev-parse", "HEAD"), kopf);
  assert.equal(sauber(d), "?? 00_inbox/2026-10-28_frisch.md", "Git-Stand wie vorher");
});

test("Verwerfen: Zielordner in .gitignore → 422, zurückgenommen (nie still ungesichert)", async () => {
  const d = posteingang();
  writeFileSync(join(d, ".gitignore"), "90_archiv/\n"); g(d, "add", "--", ".gitignore"); g(d, "commit", "-q", "-m", "ignore");
  const v = vault(d);
  const e = await wirft(v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-27_idee.md" }));
  assert.equal(e.status, 422); assert.equal(e.extra.art, "git-ignoriert");
  assert.ok(existsSync(join(d, "00_inbox/2026-10-27_idee.md")));
  assert.equal(existsSync(join(d, "90_archiv/verworfen/2026-10-27_idee.md")), false);
});

test("Ohne Git-Repository: Datei wird verschoben, Antwort sagt git:false und commit:null", async () => {
  const d = tmp();
  schreibe(d, "00_inbox/a.md", "# A\n\nText\n");
  const v = vault(d);
  const r = await v.posteingangVerwerfen({ pfad: "00_inbox/a.md" });
  assert.equal(r.git, false); assert.equal(r.commit, null);
  assert.ok(existsSync(join(d, "90_archiv/verworfen/a.md")));
});

test("Git gesperrt (Vault nicht vertraut): 409 gitGesperrt, nichts verschoben", () => echt(async () => {
  const d = posteingang();
  appendFileSync(join(d, ".git", "config"), `[filter "probe"]\n\tclean = "sh -c 'cat'"\n`);
  const v = vault(d);
  for (const f of [() => v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-27_idee.md" }), () => v.posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", tage: 1 }),
    () => v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { seite: "09_wiki/wissen/thema_kaffee.md" } })]) {
    const e = await wirft(f());
    assert.equal(e.status, 409); assert.equal(e.extra.gitGesperrt, true);
  }
  assert.ok(existsSync(join(d, "00_inbox/2026-10-27_idee.md")));
  assert.doesNotMatch(lesen(d, "00_inbox/2026-10-27_idee.md"), /spaeter_bis/);
  assert.doesNotMatch(lesen(d, "09_wiki/wissen/thema_kaffee.md"), /Posteingang/);
}));

// ---------- Später ----------
test("Später: schreibt spaeter_bis in den Kopf, ein Commit, Index zeigt das Feld; wieder zeigen entfernt es", async () => {
  const d = posteingang();
  const v = vault(d);
  const n0 = anzahlCommits(d);
  const r = await v.posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", tage: 7 });
  assert.equal(r.bis, "2026-11-04");
  assert.equal(lesen(d, "00_inbox/2026-10-27_idee.md"), "---\nspaeter_bis: 2026-11-04\n---\n# Kaffee-Idee\n\nBohnen direkt vom Röster kaufen.\n\nZweite Zeile.\n");
  assert.equal(anzahlCommits(d), n0 + 1);
  assert.deepEqual(letzter(d), { nachricht: "Posteingang: „Kaffee-Idee“ zurückgestellt bis 2026-11-04", dateien: ["M\t00_inbox/2026-10-27_idee.md"] });
  const n = (await v.notizen()).notizen.find((x) => x.pfad === "00_inbox/2026-10-27_idee.md");
  assert.equal(n.bereich, "inbox"); assert.equal(n.felder.spaeter_bis, "2026-11-04"); assert.equal(n.titel, "Kaffee-Idee");
  // neues Datum ersetzt das alte
  const r2 = await v.posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", bis: "2026-12-24" });
  assert.equal(r2.bis, "2026-12-24"); assert.match(lesen(d, "00_inbox/2026-10-27_idee.md"), /^---\nspaeter_bis: 2026-12-24\n---\n# Kaffee-Idee/);
  // wieder anzeigen: Kopf weg, Datei wie am Anfang
  const r3 = await v.posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", bis: null });
  assert.equal(r3.bis, null);
  assert.equal(lesen(d, "00_inbox/2026-10-27_idee.md"), "# Kaffee-Idee\n\nBohnen direkt vom Röster kaufen.\n\nZweite Zeile.\n");
  assert.equal(letzter(d).nachricht, "Posteingang: „Kaffee-Idee“ wieder im Posteingang");
  // nichts zu tun → kein Commit
  const n1 = anzahlCommits(d);
  const r4 = await v.posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", bis: null });
  assert.equal(r4.commit, null); assert.equal(r4.unveraendert, true); assert.equal(anzahlCommits(d), n1);
});

test("Später: bestehender Kopf bleibt, eingecheckter Stand mit uncommitteten Änderungen anderer Dateien unberührt", async () => {
  const d = posteingang();
  schreibe(d, "00_inbox/mit-kopf.md", "---\ntitel: Mit Kopf\ntags: [a, b]\n---\nText ohne H1\n");
  g(d, "add", "--", "00_inbox/mit-kopf.md"); g(d, "commit", "-q", "-m", "mit Kopf");
  writeFileSync(join(d, "09_wiki/wissen/thema_kaffee.md"), lesen(d, "09_wiki/wissen/thema_kaffee.md") + "\nUngesichert\n");
  const v = vault(d);
  await v.posteingangSpaeter({ pfad: "00_inbox/mit-kopf.md", tage: 1 });
  assert.equal(lesen(d, "00_inbox/mit-kopf.md"), "---\ntitel: Mit Kopf\ntags: [a, b]\nspaeter_bis: 2026-10-29\n---\nText ohne H1\n");
  assert.deepEqual(letzter(d).dateien, ["M\t00_inbox/mit-kopf.md"]);
  assert.match(sauber(d), /M 09_wiki\/wissen\/thema_kaffee\.md/, "fremde Änderung bleibt offen");
});

test("Später: ungültige Angaben → 400, Datum in der Vergangenheit/heute/über einem Jahr abgelehnt; nichts geschrieben", async () => {
  const d = posteingang();
  const v = vault(d);
  const vorher = lesen(d, "00_inbox/2026-10-27_idee.md");
  for (const a of [{}, { tage: 0 }, { tage: 367 }, { tage: 1.5 }, { tage: "3" }, { bis: "2026-10-28" }, { bis: "2026-10-01" }, { bis: "2028-01-01" }, { bis: "morgen" }, { bis: "2026-02-30" }, { bis: 5 }]) {
    assert.equal((await wirft(v.posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", ...a }))).status, 400, JSON.stringify(a));
  }
  assert.equal((await wirft(v.posteingangSpaeter({ pfad: "09_wiki/wissen/thema_kaffee.md", tage: 1 }))).status, 409);
  assert.equal(lesen(d, "00_inbox/2026-10-27_idee.md"), vorher);
  assert.equal(anzahlCommits(d), 2);
});

// ---------- Übernehmen ----------
test("Übernehmen in bestehende Seite: Abschnitt angehängt, Notiz im Archiv, genau ein Commit über drei Pfade", async () => {
  const d = posteingang();
  const v = vault(d);
  const alt = lesen(d, "09_wiki/wissen/thema_kaffee.md"), n0 = anzahlCommits(d);
  const r = await v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { seite: "09_wiki/wissen/thema_kaffee.md" } });
  assert.deepEqual({ ziel: r.ziel, seite: r.seite, neu: r.neu, git: r.git }, { ziel: "90_archiv/uebernommen/2026-10-27_idee.md", seite: "09_wiki/wissen/thema_kaffee.md", neu: false, git: true });
  const neu = lesen(d, "09_wiki/wissen/thema_kaffee.md");
  assert.ok(neu.startsWith(alt.replace(/\n$/, "")), "der alte Text bleibt unverändert davor");
  assert.equal(neu, alt + "\n## Kaffee-Idee (aus dem Posteingang)\n\nBohnen direkt vom Röster kaufen.\n\nZweite Zeile.\n\n_Übernommen aus dem Posteingang am 2026-10-28 (Notiz: `90_archiv/uebernommen/2026-10-27_idee.md`)._\n");
  assert.match(neu, /stand: 2026-10-01/, "stand bleibt — das entscheidet der Mensch");
  assert.equal(existsSync(join(d, "00_inbox/2026-10-27_idee.md")), false);
  assert.match(lesen(d, r.ziel), /Bohnen direkt vom Röster/);
  assert.equal(anzahlCommits(d), n0 + 1);
  assert.deepEqual(letzter(d), { nachricht: "Posteingang: „Kaffee-Idee“ in „wissen/thema_kaffee“ übernommen",
    dateien: ["A\t90_archiv/uebernommen/2026-10-27_idee.md", "D\t00_inbox/2026-10-27_idee.md", "M\t09_wiki/wissen/thema_kaffee.md"] });
  assert.equal(sauber(d), "?? 00_inbox/2026-10-28_frisch.md");
});

test("Übernehmen als neue Seite: thema_<slug>.md mit Kopf, Name frei gewählt; Notiz ohne Überschrift und ohne Text nimmt den Titel", async () => {
  const d = posteingang();
  const v = vault(d);
  const r = await v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { neu: { titel: "Röster Direktkauf", bereich: "wissen" } } });
  assert.equal(r.seite, "09_wiki/wissen/thema_roester-direktkauf.md"); assert.equal(r.neu, true);
  assert.equal(lesen(d, r.seite), [
    "---", "name: roester-direktkauf", `description: "Röster Direktkauf"`, "typ: thema", "stand: 2026-10-28", 'quellen: ["90_archiv/uebernommen/2026-10-27_idee.md"]', "---",
    "# Röster Direktkauf", "", "Bohnen direkt vom Röster kaufen.", "", "Zweite Zeile.", "", "_Übernommen aus dem Posteingang am 2026-10-28 (Notiz: `90_archiv/uebernommen/2026-10-27_idee.md`)._", ""].join("\n"));
  assert.deepEqual(letzter(d).dateien, ["A\t09_wiki/wissen/thema_roester-direktkauf.md", "A\t90_archiv/uebernommen/2026-10-27_idee.md", "D\t00_inbox/2026-10-27_idee.md"]);
  // gleicher Titel nochmal → -2, bestehende Seite wird nie überschrieben
  schreibe(d, "00_inbox/zwei.md", "# Zwei\n");
  const r2 = await v.posteingangUebernehmen({ pfad: "00_inbox/zwei.md", ziel: { neu: { titel: "Röster Direktkauf" } } });
  assert.equal(r2.seite, "09_wiki/wissen/thema_roester-direktkauf-2.md");
  assert.match(lesen(d, r2.seite), /\n# Röster Direktkauf\n\nZwei\n\n_Übernommen/, "ohne Text zählt der Titel der Notiz");
  assert.match(lesen(d, r.seite), /Bohnen direkt/);
  // neuer Bereich wird angelegt
  schreibe(d, "00_inbox/drei.md", "Loser Gedanke ohne Überschrift\n");
  const r3 = await v.posteingangUebernehmen({ pfad: "00_inbox/drei.md", ziel: { neu: { titel: "Drei", bereich: "projekte" } } });
  assert.equal(r3.seite, "09_wiki/projekte/thema_drei.md");
  assert.equal(sauber(d), "?? 00_inbox/2026-10-28_frisch.md");
});

test("Übernehmen: ungültige Ziele — kein Wiki, Beleg, generiert, fehlt, beides/keines, Bereich mit Pfad — und nichts ändert sich", async () => {
  const d = posteingang();
  schreibe(d, "09_wiki/wissen/belege/2026-10/b1.md", "# Beleg\n");
  schreibe(d, "09_wiki/INDEX.md", "# Index\n");
  schreibe(d, "10_notizen/x.md", "# X\n");
  const v = vault(d);
  const p = "00_inbox/2026-10-27_idee.md";
  const probe = async (ziel, status) => assert.equal((await wirft(v.posteingangUebernehmen({ pfad: p, ziel }))).status, status, JSON.stringify(ziel));
  await probe({ seite: "10_notizen/x.md" }, 400);
  await probe({ seite: "09_wiki/wissen/belege/2026-10/b1.md" }, 403);
  await probe({ seite: "09_wiki/_schema.md" }, 403);
  await probe({ seite: "09_wiki/INDEX.md" }, 403);
  await probe({ seite: "09_wiki/wissen/gibt-es-nicht.md" }, 404);
  await probe({ seite: "../x.md" }, 403);
  await probe({ seite: "09_wiki/wissen/thema_kaffee.md", neu: { titel: "x" } }, 400);
  await probe({}, 400);
  await probe(null, 400);
  await probe({ neu: { titel: "  " } }, 400);
  await probe({ neu: { titel: "T", bereich: "a/b" } }, 400);
  await probe({ neu: { titel: "T", bereich: ".." } }, 400);
  await probe({ neu: { titel: "T", bereich: "belege" } }, 400);
  await probe({ neu: { titel: "T", bereich: "_intern" } }, 400);
  assert.equal((await wirft(v.posteingangUebernehmen({ pfad: "09_wiki/wissen/thema_kaffee.md", ziel: { seite: "09_wiki/wissen/thema_kaffee.md" } }))).status, 409);
  assert.ok(existsSync(join(d, p)));
  assert.equal(existsSync(join(d, "90_archiv")), false);
  assert.equal(anzahlCommits(d), 2);
});

test("Übernehmen: Commit scheitert → Zielseite und Notiz exakt wie vorher, neue Seite wieder weg", async () => {
  const d = posteingang();
  const v = vault(d);
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'HOOK sagt nein'\nexit 1\n"); chmodSync(hook, 0o755);
  v.vertrauen(true);
  const seite = lesen(d, "09_wiki/wissen/thema_kaffee.md"), notiz = lesen(d, "00_inbox/2026-10-27_idee.md"), kopf = g(d, "rev-parse", "HEAD");
  let e = await wirft(v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { seite: "09_wiki/wissen/thema_kaffee.md" } }));
  assert.equal(e.status, 422);
  e = await wirft(v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { neu: { titel: "Neu" } } }));
  assert.equal(e.status, 422);
  assert.equal(lesen(d, "09_wiki/wissen/thema_kaffee.md"), seite);
  assert.equal(lesen(d, "00_inbox/2026-10-27_idee.md"), notiz);
  assert.equal(existsSync(join(d, "09_wiki/wissen/thema_neu.md")), false);
  assert.equal(existsSync(join(d, "90_archiv/uebernommen/2026-10-27_idee.md")), false);
  assert.equal(g(d, "rev-parse", "HEAD"), kopf);
  assert.equal(sauber(d), "?? 00_inbox/2026-10-28_frisch.md");
});

test("Übernehmen: CRLF-Seite behält ihre Zeilenenden; Zielseite mit uncommitteter Änderung wird mit committet (nichts geht verloren)", async () => {
  const d = posteingang();
  schreibe(d, "09_wiki/wissen/thema_crlf.md", "# CRLF\r\n\r\nZeile\r\n");
  g(d, "add", "--", "09_wiki/wissen/thema_crlf.md"); g(d, "commit", "-q", "-m", "crlf");
  const v = vault(d);
  await v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { seite: "09_wiki/wissen/thema_crlf.md" } });
  const t = lesen(d, "09_wiki/wissen/thema_crlf.md");
  assert.ok(t.startsWith("# CRLF\r\n\r\nZeile\r\n\r\n## Kaffee-Idee"));
  assert.ok(!/[^\r]\n/.test(t), "kein einzelnes \\n");
  writeFileSync(join(d, "09_wiki/wissen/thema_kaffee.md"), lesen(d, "09_wiki/wissen/thema_kaffee.md") + "\nHandschriftlich\n");
  await v.posteingangUebernehmen({ pfad: "00_inbox/2026-10-28_frisch.md", ziel: { seite: "09_wiki/wissen/thema_kaffee.md" } });
  assert.match(lesen(d, "09_wiki/wissen/thema_kaffee.md"), /Handschriftlich\n\n## Frisch/);
  assert.equal(sauber(d), "");
});

// ---------- Routen ----------
test("Routen: POST /api/posteingang/{verwerfen,spaeter,uebernehmen} über den Handler; Methoden, Fehlercodes, Vault nötig", async () => {
  const d = posteingang();
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: {} }));
  let r = await rufe("GET", "/api/posteingang/verwerfen");
  assert.equal(r.status, 405);
  r = await rufe("POST", "/api/posteingang/verwerfen");
  assert.equal(r.status, 400, "ohne Inhalt");
  r = await rufe("POST", "/api/posteingang/spaeter", { pfad: "00_inbox/2026-10-27_idee.md", tage: 3 });
  assert.equal(r.status, 200); assert.equal(typeof r.j.commit, "string"); assert.equal(r.j.git, true); assert.match(r.j.bis, /^\d{4}-\d{2}-\d{2}$/);
  r = await rufe("POST", "/api/posteingang/spaeter", { pfad: "00_inbox/2026-10-27_idee.md", tage: 0 });
  assert.equal(r.status, 400); assert.equal(typeof r.j.fehler, "string");
  r = await rufe("POST", "/api/posteingang/uebernehmen", { pfad: "00_inbox/2026-10-27_idee.md", ziel: { seite: "09_wiki/wissen/thema_kaffee.md" } });
  assert.equal(r.status, 200); assert.equal(r.j.ziel, "90_archiv/uebernommen/2026-10-27_idee.md"); assert.equal(r.j.neu, false);
  r = await rufe("POST", "/api/posteingang/verwerfen", { pfad: "00_inbox/2026-10-27_idee.md" });
  assert.equal(r.status, 404, "die Notiz ist schon weg");
  r = await rufe("POST", "/api/posteingang/verwerfen", { pfad: "00_inbox/2026-10-28_frisch.md" });
  assert.equal(r.status, 200); assert.equal(r.j.ziel, "90_archiv/verworfen/2026-10-28_frisch.md");
  r = await rufe("POST", "/api/posteingang/verwerfen", { pfad: "../x.md" });
  assert.equal(r.status, 403);
  // ohne Vault
  const ohne = aufruf(erzeugeHandler({}));
  r = await ohne("POST", "/api/posteingang/verwerfen", { pfad: "a.md" });
  assert.equal(r.status, 409); assert.equal(r.j.keinVault, true);
});

test("Zwei Aktionen gleichzeitig auf dieselbe Notiz: eine gewinnt, die andere bekommt 404, kein Datenverlust", async () => {
  const d = posteingang();
  const v = vault(d);
  const ergebnisse = await Promise.allSettled([v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-27_idee.md" }), v.posteingangVerwerfen({ pfad: "00_inbox/2026-10-27_idee.md" })]);
  assert.equal(ergebnisse.filter((x) => x.status === "fulfilled").length, 1);
  const abgelehnt = ergebnisse.find((x) => x.status === "rejected");
  assert.equal(abgelehnt.reason.status, 404);
  assert.match(lesen(d, "90_archiv/verworfen/2026-10-27_idee.md"), /Bohnen/);
  assert.equal(existsSync(join(d, "90_archiv/verworfen/2026-10-27_idee-2.md")), false);
});

// ---------- Nachgeschärft nach Review ----------
test("setzeKopfFeld: doppelter Schlüssel, BOM, LF-Kopf mit CRLF-Text, ungeschlossener Kopf", () => {
  assert.equal(setzeKopfFeld("---\nspaeter_bis: 2026-11-01\nname: x\nspaeter_bis: 2026-12-01\n---\nT\n", "spaeter_bis", "2027-01-01"), "---\nspaeter_bis: 2027-01-01\nname: x\n---\nT\n");
  assert.equal(setzeKopfFeld("---\nspaeter_bis: 2026-11-01\nname: x\nspaeter_bis: 2026-12-01\n---\nT\n", "spaeter_bis", null), "---\nname: x\n---\nT\n");
  assert.equal(setzeKopfFeld("﻿# T\n", "spaeter_bis", "2026-11-01"), "﻿---\nspaeter_bis: 2026-11-01\n---\n# T\n");
  assert.equal(setzeKopfFeld("﻿---\nname: x\n---\n", "spaeter_bis", "2026-11-01"), "﻿---\nname: x\nspaeter_bis: 2026-11-01\n---\n");
  assert.equal(setzeKopfFeld("---\nname: x\n---\nText\r\nmehr\r\n", "spaeter_bis", "2026-11-01"), "---\nname: x\nspaeter_bis: 2026-11-01\n---\nText\r\nmehr\r\n");
  assert.throws(() => setzeKopfFeld("---\nnie geschlossen: 1\n# T\n", "spaeter_bis", "2026-11-01"), (e) => e instanceof HttpFehler && e.status === 422);
});

test("Später auf einer Notiz, die Git ignoriert → 422 git-ignoriert, Datei unverändert", async () => {
  const d = posteingang();
  writeFileSync(join(d, ".gitignore"), "00_inbox/2026-10-27_idee.md\n"); g(d, "add", "--", ".gitignore"); g(d, "commit", "-q", "-m", "ignore");
  g(d, "rm", "-q", "--cached", "--", "00_inbox/2026-10-27_idee.md"); g(d, "commit", "-q", "-m", "untrack");
  const vorher = lesen(d, "00_inbox/2026-10-27_idee.md");
  const e = await wirft(vault(d).posteingangSpaeter({ pfad: "00_inbox/2026-10-27_idee.md", tage: 2 }));
  assert.equal(e.status, 422); assert.equal(e.extra.art, "git-ignoriert");
  assert.equal(lesen(d, "00_inbox/2026-10-27_idee.md"), vorher);
});

test("Neue Seite: Titel mit Doppelpunkt und Anführungszeichen steht als gültiger YAML-Text im Kopf", async () => {
  const d = posteingang();
  const r = await vault(d).posteingangUebernehmen({ pfad: "00_inbox/2026-10-27_idee.md", ziel: { neu: { titel: 'Kaffee: "Röster" #1' } } });
  assert.match(lesen(d, r.seite), /\ndescription: "Kaffee: \\"Röster\\" #1"\n/);
});
