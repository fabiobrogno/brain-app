// Kontingent (Paket P7): Eintragen und Entfernen der Statuszeile bei Claude Code — nur nach Klick, mit Bestätigung für Orte außerhalb von Kortex (System-Standard ~/.claude), Sicherung
// der settings.json, eigener markierter Eintrag, Rückweg BYTEGLEICH. Nur Wegwerf-Orte unter dem Temp-Ordner (HOME und Support sind Temp-Ordner, der Testmodus verbietet alles andere);
// Kindprozesse (die Kette) laufen mit ausdrücklich gebauter Umgebung.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, lstatSync, existsSync, symlinkSync, chmodSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad, schreibe } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const { erzeugeKontingent, MARKE } = await import(pfad("werkstatt", "kontingent.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { hookBefehl, hookNameAusBefehl } = await import(pfad("kern", "pfade.mjs"));

const ID = "k_aaaa0001", ID2 = "k_aaaa0002";
const EINGABE = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 42, resets_at: 1893456000 }, seven_day: { used_percentage: 9, resets_at: 1893888000 } } });

// Ein Aufbau: Support, ein von Kortex angelegtes Konto (verwaltet) und ein „System-Standard“-Konto im (Temp-)Home
function aufbau(opt = {}) {
  const support = tmp("brain-support-");
  const home = tmp("brain-home-");
  const verwaltet = join(support, "ki-konten-ordner", "claude-kunde");
  mkdirSync(verwaltet, { recursive: true });
  const standard = join(home, ".claude");
  mkdirSync(standard, { recursive: true });
  const daten = { konten: { [ID]: { programm: "claude", ordner: verwaltet, standard: false, name: "Kunde" }, [ID2]: { programm: "claude", ordner: standard, standard: true, name: "Claude Code" },
    k_aaaa0003: { programm: "codex", ordner: join(home, ".codex"), standard: true, name: "Codex" }, k_aaaa0004: { programm: "cursor", ordner: join(home, ".cursor"), standard: true, name: "Cursor" } } };
  let zeit = Date.now();
  const kt = erzeugeKontingent({ support, konten: { lade: () => daten }, nodePfad: process.execPath, home: () => home, jetzt: () => zeit, ...opt });
  return { support, home, verwaltet, standard, daten, kt, k: join(support, "kontingent"), zeit: (ms) => { if (ms !== undefined) zeit = ms; return zeit; } };
}
const schalte = (a, konto, an, extra = {}) => a.kt.schalteStatuszeile({ konto, an, einwilligung: true, ...extra });
const settings = (ordner) => join(ordner, "settings.json");
const rein = (env = {}) => ({ PATH: "/usr/bin:/bin", HOME: tmp("brain-h2-"), ...env });
const fuehreAus = (command, eingabe = EINGABE) => spawnSync("/bin/sh", ["-c", command], { input: eingabe, env: rein(), timeout: 20_000 });
const befehlVon = (ordner) => JSON.parse(readFileSync(settings(ordner), "utf8")).statusLine.command;
const modus = (p) => statSync(p).mode & 0o777;
const wirft = (fn, status, art) => assert.throws(fn, (e) => { assert.equal(e.status, status, e.message); if (art) assert.equal(e.extra?.art, art); assert.match(e.message, /\S/); return true; });

test("Ohne Klick (einwilligung) und ohne Bestätigung außerhalb von Kortex geschieht nichts — die Fehlertexte nennen den nächsten Schritt", () => {
  const a = aufbau();
  const vorher = readdirSync(a.verwaltet);
  wirft(() => a.kt.schalteStatuszeile({ konto: ID, an: true }), 409, "einwilligung");
  wirft(() => a.kt.schalteStatuszeile({ konto: ID, an: true, einwilligung: "ja" }), 409, "einwilligung");
  wirft(() => a.kt.schalteStatuszeile({ konto: ID, an: false }), 409, "einwilligung");
  wirft(() => schalte(a, ID2, true), 409, "bestaetigung");                      // System-Standard: Klick allein genügt nicht
  wirft(() => schalte(a, ID2, true, { bestaetigt: "true" }), 409, "bestaetigung"); // nur ein echtes true zählt
  wirft(() => a.kt.schalteStatuszeile({ konto: "../x", an: true, einwilligung: true }), 400);
  wirft(() => a.kt.schalteStatuszeile({ konto: ID, an: "ja", einwilligung: true }), 400);
  wirft(() => schalte(a, "k_ffffffff", true), 404);
  wirft(() => schalte(a, "k_aaaa0003", true), 409, "kein-claude");
  wirft(() => schalte(a, "k_aaaa0004", true), 409, "kein-claude");
  assert.deepEqual(readdirSync(a.verwaltet), vorher);
  assert.equal(existsSync(settings(a.standard)), false);
  assert.equal(existsSync(a.k), false, "nicht einmal der Ordner für das Kontingent wurde angelegt");
  try { schalte(a, ID2, true); } catch (e) { assert.match(e.message, /bestätige|Bestätige/); assert.match(e.message, /Kontingent anzeigen/); }
});

test("Im Testmodus schreibt Kortex nie außerhalb des Temp-Ordners", () => {
  const a = aufbau();
  a.daten.konten.k_aaaa0005 = { programm: "claude", ordner: "/nicht-vorhanden-p7/.claude", standard: false, name: "Fremd" };
  wirft(() => schalte(a, "k_aaaa0005", true, { bestaetigt: true }), 409, "testmodus");
  assert.equal(existsSync("/nicht-vorhanden-p7"), false);
});

test("Eintragen bei einem Konto von Kortex ohne vorhandene settings.json: Datei mit eigenem Eintrag, Rechte, Skript, Merker — und Entfernen löscht die Datei wieder (Zustand wie vorher)", () => {
  const a = aufbau();
  const vorherNamen = readdirSync(a.verwaltet);
  const r = schalte(a, ID, true);
  assert.equal(r.aktion, "eingetragen"); assert.equal(r.kette, false);
  const doc = JSON.parse(readFileSync(settings(a.verwaltet), "utf8"));
  assert.deepEqual(Object.keys(doc), ["statusLine"]);
  assert.equal(doc.statusLine.type, "command");
  assert.ok(doc.statusLine.command.includes(`/kontingent/bin/${MARKE}`), "markierter eigener Eintrag");
  assert.ok(doc.statusLine.command.includes(`--konto ${ID}`));
  // Skript, Ordner und Merker sind privat
  assert.equal(modus(join(a.k, "bin", MARKE)), 0o700);
  assert.equal(modus(a.k), 0o700);
  assert.equal(modus(join(a.k, "eintragung.json")), 0o600);
  // Der Befehl läuft und merkt sich die Werte; ohne frühere Statuszeile bleibt die Ausgabe leer
  const l = fuehreAus(doc.statusLine.command);
  assert.equal(l.status, 0, l.stderr.toString()); assert.equal(l.stdout.length, 0);
  const werte = JSON.parse(readFileSync(join(a.k, `${ID}.json`), "utf8"));
  assert.equal(werte.session.usedPercent, 42);
  // Stand: eingetragen, Werte da
  let s = a.kt.stand({}).konten.find((x) => x.id === ID);
  assert.equal(s.status, "ok"); assert.equal(s.eingetragen, true); assert.equal(s.session.usedPercent, 42); assert.equal(s.weekly.usedPercent, 9);
  // Entfernen: Datei weg, Ordner wie vorher, Kortex' Merker und Skript weg
  const e = schalte(a, ID, false);
  assert.equal(e.exakt, true);
  assert.deepEqual(readdirSync(a.verwaltet).sort(), vorherNamen.sort());
  assert.equal(existsSync(settings(a.verwaltet)), false);
  assert.equal(existsSync(join(a.k, "bin", MARKE)), false);
  assert.equal(existsSync(join(a.k, `${ID}.json`)), false);
  assert.equal(existsSync(join(a.k, "eintragung.json")), false);
  assert.equal(a.kt.stand({}).konten.find((x) => x.id === ID).status, "nicht-eingerichtet");
});

test("Rückweg BYTEGLEICH: eine vorhandene settings.json mit eigenwilliger Formatierung (Tabs, kein Zeilenende, BOM-frei, Umlaute, Reihenfolge) kommt Byte für Byte zurück — und das Skript verschwindet", () => {
  const a = aufbau();
  const original = Buffer.from('{\t"theme":"dunkel",\n\t"permissions": {"allow": ["Read(//x/**)"]},   "name":"Grüße ✓","env":{"A":"1"}}', "utf8"); // kein Zeilenende, Tabs
  writeFileSync(settings(a.standard), original, { mode: 0o640 });
  const ziel = settings(a.standard);
  const r = schalte(a, ID2, true, { bestaetigt: true });
  assert.equal(r.aktion, "eingetragen");
  assert.ok(r.sicherung && existsSync(r.sicherung), "Sicherung der settings.json liegt bereit");
  assert.equal(modus(r.sicherung), 0o600);
  assert.ok(readFileSync(r.sicherung).equals(original), "die Sicherung ist die Datei vor der Änderung");
  const neu = JSON.parse(readFileSync(ziel, "utf8"));
  assert.equal(neu.theme, "dunkel"); assert.deepEqual(neu.permissions, { allow: ["Read(//x/**)"] }); assert.equal(neu.name, "Grüße ✓"); assert.deepEqual(neu.env, { A: "1" });
  assert.equal(modus(ziel), 0o640, "die Rechte der Datei bleiben");
  assert.equal(readdirSync(a.standard).filter((n) => n.includes(".tmp-")).length, 0);
  const e = schalte(a, ID2, false);
  assert.equal(e.exakt, true);
  assert.ok(readFileSync(ziel).equals(original), "byteweise wie vorher");
  assert.equal(modus(ziel), 0o640);
  assert.deepEqual(readdirSync(a.standard), ["settings.json"], "im Profil-Ordner bleibt nichts zurück (keine .bak-, keine Temp-Dateien)");
  assert.equal(existsSync(join(a.k, "sicherung", r.sicherung.split("/").pop())), false);
  assert.equal(existsSync(join(a.k, "bin", MARKE)), false);
});

test("Vorhandene Statuszeile: die Kette gibt ihre Ausgabe unverändert weiter, Zusatzfelder (padding) bleiben, der Rückweg stellt sie wieder her", () => {
  const a = aufbau();
  const eigene = "printf '\\033[1mBranch main\\033[0m | Grüße'; exit 0";
  const original = JSON.stringify({ model: "x", statusLine: { type: "command", command: eigene, padding: 2 } }, null, 4) + "\n";
  writeFileSync(settings(a.standard), original);
  const r = schalte(a, ID2, true, { bestaetigt: true });
  assert.equal(r.kette, true);
  const sl = JSON.parse(readFileSync(settings(a.standard), "utf8")).statusLine;
  assert.equal(sl.padding, 2, "Zusatzfelder bleiben");
  assert.equal(sl.type, "command");
  assert.ok(sl.command.includes(MARKE));
  // Ausgabe der Kette = Ausgabe der früheren Statuszeile, byteweise
  const direkt = fuehreAus(eigene), kette = fuehreAus(sl.command);
  assert.equal(kette.status, direkt.status);
  assert.ok(kette.stdout.equals(direkt.stdout), "die Ausgabe bleibt gleich");
  assert.ok(existsSync(join(a.k, `${ID2}.json`)), "nebenbei wurden die Werte gemerkt");
  assert.equal(modus(join(a.k, "kette", `${ID2}.json`)), 0o600);
  assert.equal(a.kt.stand({}).konten.find((x) => x.id === ID2).kette, true);
  // Rückweg: byteweise die alte Datei
  assert.equal(schalte(a, ID2, false).exakt, true);
  assert.equal(readFileSync(settings(a.standard), "utf8"), original);
  assert.equal(existsSync(join(a.k, "kette", `${ID2}.json`)), false);
});

test("Fehlt Node oder das Skript (aufgeräumt, App verschoben), läuft die frühere Statuszeile direkt weiter — ihre Ausgabe bleibt wie vorher", () => {
  const a = aufbau({ nodePfad: "/nicht-vorhanden/node" });
  const eigene = "echo 'meine Zeile'";
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: eigene } }));
  schalte(a, ID, true);
  const l = fuehreAus(befehlVon(a.verwaltet));
  assert.equal(l.stdout.toString(), "meine Zeile\n");
  // ohne frühere Statuszeile: nichts, ohne Fehler
  const b = aufbau({ nodePfad: "/nicht-vorhanden/node" });
  schalte(b, ID, true);
  const l2 = fuehreAus(befehlVon(b.verwaltet));
  assert.equal(l2.status, 0); assert.equal(l2.stdout.length, 0);
});

test("Die eigene Statuszeile der Hooks von Kortex (refreshInterval, kortex' hook statusline) läuft als Kette weiter, ihre Felder bleiben — und der Installer der Hooks hält die Kette nicht für seinen Eintrag", () => {
  const a = aufbau();
  const eigene = hookBefehl("/nicht/da/bin/kortex", "statusline");
  assert.equal(hookNameAusBefehl(eigene), "statusline");
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: eigene, refreshInterval: 10 } }, null, 2) + "\n");
  schalte(a, ID, true);
  const sl = JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine;
  assert.equal(sl.refreshInterval, 10, "Zusatzfelder bleiben");
  assert.equal(hookNameAusBefehl(sl.command), null, "der Installer (kern/adapters/claude-code/install.mjs) erkennt Kortex-Statuszeilen am Befehl: die Kette darf den Aufruf nicht enthalten");
  assert.ok(!sl.command.includes("hook statusline"));
  const l = fuehreAus(sl.command);
  assert.equal(l.status, 0, l.stderr.toString());
  // Rückweg: die frühere Statuszeile samt refreshInterval, byteweise
  assert.equal(schalte(a, ID, false).exakt, true);
  assert.equal(JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine.command, eigene);
});

test("Pfade mit Leerzeichen und Anführungszeichen im Befehl der Kette werden richtig gesetzt", () => {
  const support = tmp("brain support's ");
  const verwaltet = join(support, "ki-konten-ordner", "claude-x");
  mkdirSync(verwaltet, { recursive: true });
  const kt = erzeugeKontingent({ support, konten: { lade: () => ({ konten: { [ID]: { programm: "claude", ordner: verwaltet, standard: false, name: "X" } } }) } });
  kt.schalteStatuszeile({ konto: ID, an: true, einwilligung: true });
  const l = fuehreAus(befehlVon(verwaltet));
  assert.equal(l.status, 0, l.stderr.toString());
  assert.equal(JSON.parse(readFileSync(join(support, "kontingent", `${ID}.json`), "utf8")).session.usedPercent, 42);
});

test("Zweimal einschalten ist harmlos (keine zweite Kette, keine zweite Sicherung); die frühere Statuszeile geht dabei nicht verloren", () => {
  const a = aufbau();
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: "echo alt" } }, null, 2) + "\n");
  schalte(a, ID, true);
  const nachEins = readFileSync(settings(a.verwaltet));
  const zwei = schalte(a, ID, true);
  assert.equal(zwei.aktion, "schon-da");
  assert.ok(readFileSync(settings(a.verwaltet)).equals(nachEins));
  assert.equal(readdirSync(join(a.k, "sicherung")).length, 1);
  assert.equal(fuehreAus(befehlVon(a.verwaltet)).stdout.toString(), "alt\n");
  schalte(a, ID, false);
  assert.equal(JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine.command, "echo alt");
});

test("Wurde die settings.json seit dem Eintragen geändert, nimmt der Rückweg nur den eigenen Eintrag heraus (die Änderungen bleiben) und stellt die frühere Statuszeile wieder her", () => {
  const a = aufbau();
  writeFileSync(settings(a.verwaltet), JSON.stringify({ a: 1, statusLine: { type: "command", command: "echo vorher", padding: 1 } }, null, 2) + "\n");
  schalte(a, ID, true);
  const doc = JSON.parse(readFileSync(settings(a.verwaltet), "utf8")); doc.neu = "vom Nutzer"; doc.a = 2;     // Claude Code oder der Nutzer ändert etwas
  writeFileSync(settings(a.verwaltet), JSON.stringify(doc));
  const e = schalte(a, ID, false);
  assert.equal(e.exakt, false);
  const nach = JSON.parse(readFileSync(settings(a.verwaltet), "utf8"));
  assert.equal(nach.neu, "vom Nutzer"); assert.equal(nach.a, 2);
  assert.deepEqual(nach.statusLine, { type: "command", command: "echo vorher", padding: 1 });
  // ohne frühere Statuszeile: der Schlüssel verschwindet
  const b = aufbau();
  writeFileSync(settings(b.verwaltet), JSON.stringify({ b: 1 }));
  schalte(b, ID, true);
  const d2 = JSON.parse(readFileSync(settings(b.verwaltet), "utf8")); d2.c = 3; writeFileSync(settings(b.verwaltet), JSON.stringify(d2));
  assert.equal(schalte(b, ID, false).exakt, false);
  assert.deepEqual(JSON.parse(readFileSync(settings(b.verwaltet), "utf8")), { b: 1, c: 3 });
});

test("Hat der Nutzer die Statuszeile inzwischen selbst ersetzt, fasst Kortex sie beim Ausschalten nicht an; der Stand sagt „geändert“", () => {
  const a = aufbau();
  schalte(a, ID, true);
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: "echo neu vom Nutzer" } }));
  assert.equal(a.kt.stand({}).konten.find((x) => x.id === ID).status, "geaendert");
  const e = schalte(a, ID, false);
  assert.equal(e.aktion, "schon-weg");
  assert.equal(JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine.command, "echo neu vom Nutzer");
  assert.equal(existsSync(join(a.k, "eintragung.json")), false, "der Merker ist weg");
});

test("Kaputte settings.json, eine Statuszeile in fremder Form: Kortex ändert nichts und sagt, was zu tun ist", () => {
  const a = aufbau();
  writeFileSync(settings(a.verwaltet), "{ das ist kaputt");
  wirft(() => schalte(a, ID, true), 409, "einstellungen-defekt");
  assert.equal(readFileSync(settings(a.verwaltet), "utf8"), "{ das ist kaputt");
  assert.equal(a.kt.stand({}).konten.find((x) => x.id === ID).status, "einstellungen-defekt");
  const b = aufbau();
  const roh = JSON.stringify({ statusLine: "echo als-text" });
  writeFileSync(settings(b.verwaltet), roh);
  wirft(() => schalte(b, ID, true), 409, "andere-form");
  assert.equal(readFileSync(settings(b.verwaltet), "utf8"), roh);
  const c = aufbau();
  writeFileSync(settings(c.verwaltet), JSON.stringify([1, 2]));
  wirft(() => schalte(c, ID, true), 409);
  for (const x of [a, b, c]) assert.equal(existsSync(join(x.k, "eintragung.json")), false, "auch kein Merker bleibt zurück");
});

test("Ein Verweis auf settings.json (Dotfiles-Ordner) bleibt ein Verweis; geändert und zurückgespielt wird sein Ziel", () => {
  const a = aufbau();
  const dot = tmp("brain-dotfiles-");
  const ziel = join(dot, "settings.json");
  const original = '{"x": 1}\n';
  writeFileSync(ziel, original);
  symlinkSync(ziel, settings(a.verwaltet));
  schalte(a, ID, true);
  assert.ok(lstatSync(settings(a.verwaltet)).isSymbolicLink(), "der Verweis bleibt");
  assert.ok(JSON.parse(readFileSync(ziel, "utf8")).statusLine.command.includes(MARKE));
  schalte(a, ID, false);
  assert.ok(lstatSync(settings(a.verwaltet)).isSymbolicLink());
  assert.equal(readFileSync(ziel, "utf8"), original);
});

test("Zwei Konten: das Skript bleibt, bis das letzte Konto ausgeschaltet ist; jedes hat seine eigene Werte-Datei", () => {
  const a = aufbau();
  schalte(a, ID, true); schalte(a, ID2, true, { bestaetigt: true });
  assert.equal(existsSync(join(a.k, "sicherung")), false, "ohne vorhandene Datei gibt es nichts zu sichern");
  fuehreAus(befehlVon(a.verwaltet)); fuehreAus(befehlVon(a.standard));
  assert.ok(existsSync(join(a.k, `${ID}.json`)) && existsSync(join(a.k, `${ID2}.json`)));
  schalte(a, ID, false);
  assert.ok(existsSync(join(a.k, "bin", MARKE)));
  assert.equal(existsSync(join(a.k, `${ID}.json`)), false);
  assert.ok(existsSync(join(a.k, `${ID2}.json`)));
  schalte(a, ID2, false);
  assert.equal(existsSync(join(a.k, "bin", MARKE)), false);
});

test("Stand: noch keine Werte · veraltet nach 30 Minuten · „ohne Kontingent“ (alte Version/API-Schlüssel) · nicht abrufbar bei Programmen ohne Weg", () => {
  const a = aufbau();
  schalte(a, ID, true);
  const holen = (id) => a.kt.stand({}).konten.find((x) => x.id === id);
  assert.equal(holen(ID).status, "keine-werte");
  const t0 = a.zeit();
  writeFileSync(join(a.k, `${ID}.json`), JSON.stringify({ v: 1, geschrieben: new Date(t0).toISOString(), session: { usedPercent: 92, windowMinutes: 300, resetsAt: t0 + 3_600_000 }, weekly: null }));
  assert.equal(holen(ID).status, "ok");
  assert.equal(holen(ID).session.usedPercent, 92);
  a.zeit(t0 + 31 * 60_000);
  assert.equal(holen(ID).status, "veraltet");
  writeFileSync(join(a.k, `${ID}.json`), JSON.stringify({ v: 1, geschrieben: new Date(a.zeit()).toISOString(), ohne: true }));
  assert.equal(holen(ID).status, "ohne-kontingent");
  writeFileSync(join(a.k, `${ID}.json`), "{kaputt");
  assert.equal(holen(ID).status, "keine-werte", "eine unlesbare Werte-Datei ist keine Zahl");
  assert.equal(holen("k_aaaa0004").status, "nicht-abrufbar");
  assert.equal(holen(ID2).status, "nicht-eingerichtet");
  assert.equal(holen(ID2).bestaetigungNoetig, true);
  assert.equal(holen(ID).bestaetigungNoetig, false);
});

test("Über die Werkstatt: GET /api/ki/kontingent und POST …/statuszeile (nach dem Klick), kein Token, kein Netz — und die Antwort enthält nie einen Pfad zu einer Anmeldedatei", async () => {
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const vault = tmp("brain-vault-"); schreibe(vault, "brain.config.json", "{}\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "V", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  const verwaltet = join(support, "ki-konten-ordner", "claude-kunde");
  mkdirSync(verwaltet, { recursive: true });
  const h = erzeugeHandler({ vault, vaultOptionen: { support }, kontenHome: home, kontenErkennung: () => [{ programm: "claude", ordner: realpathSync(verwaltet), standard: false, name: "Claude Code · kunde", ordnerKennung: "x1" }] });
  const rufe = async (methode, p, daten) => { const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); return { ...r, j: JSON.parse(r.body.toString("utf8")) }; };
  const konten = await rufe("GET", "/api/ki/konten");
  const id = konten.j.konten[0].id;
  let r = await rufe("GET", "/api/ki/kontingent");
  assert.equal(r.status, 200);
  assert.equal(r.j.konten.find((x) => x.id === id).status, "nicht-eingerichtet");
  assert.deepEqual(r.j.takt, { abfrageMs: 900_000, neuFruehestensMs: 300_000, veraltetMs: 1_800_000 });
  assert.equal(r.j.konten[0].stufe, "gesperrt", "ein neu erkanntes Konto ist im Vault gesperrt (die Stufe kommt aus der Liste, die Anfrage gleicht nichts ab)");
  const z = await rufe("PUT", "/api/ki/zugriff", { konto: id, vault: konten.j.vaults[0].pfad, stufe: "posteingang" });
  assert.equal(z.status, 200, JSON.stringify(z.j));
  assert.equal((await rufe("GET", "/api/ki/kontingent")).j.konten.find((x) => x.id === id).stufe, "posteingang", "die Stufe im offenen Vault kommt mit");
  r = await rufe("POST", "/api/ki/kontingent/statuszeile", { konto: id, an: true });
  assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung"); assert.match(r.j.fehler, /Kontingent anzeigen/);
  assert.equal(existsSync(settings(verwaltet)), false);
  r = await rufe("POST", "/api/ki/kontingent/statuszeile", { konto: id, an: true, einwilligung: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.stand.konten.find((x) => x.id === id).eingetragen, true);
  assert.ok(JSON.parse(readFileSync(settings(verwaltet), "utf8")).statusLine.command.includes(MARKE));
  assert.equal((await rufe("PUT", "/api/ki/kontingent", {})).status, 405);
  assert.equal((await rufe("GET", "/api/ki/kontingent/statuszeile")).status, 405);
  r = await rufe("POST", "/api/ki/kontingent/statuszeile", { konto: id, an: false, einwilligung: true });
  assert.equal(r.status, 200); assert.equal(r.j.exakt, true);
  assert.equal(existsSync(settings(verwaltet)), false);
});

// ---------------------------------------------------------------------- Befunde des Sicherheits-Reviews
// Eine zweite Sicht auf dasselbe Support-Verzeichnis (z. B. nach neu angelegter Konto-Liste oder verschobenem Node)
const nochEins = (a, { id = ID, nodePfad = process.execPath } = {}) => {
  const daten = { konten: { [id]: { programm: "claude", ordner: a.verwaltet, standard: false, name: "Kunde" } } };
  return erzeugeKontingent({ support: a.support, konten: { lade: () => daten }, nodePfad, home: () => a.home });
};
const eintragungen = (a) => { try { return JSON.parse(readFileSync(join(a.k, "eintragung.json"), "utf8")).konten; } catch { return {}; } };
const leer = (a) => ["eintragung.json", "bin", "kette", "sicherung", `${ID}.json`].filter((n) => existsSync(join(a.k, n)));

test("Neue Konto-Kennung: die Statuszeile geht NICHT verloren — Stand „neu verknüpfen“, Entfernen stellt die frühere Statuszeile aus der Kette der alten Kennung wieder her", () => {
  const a = aufbau();
  const original = JSON.stringify({ a: 1, statusLine: { type: "command", command: "echo meine-zeile", padding: 3 } }, null, 2) + "\n";
  writeFileSync(settings(a.verwaltet), original);
  schalte(a, ID, true);
  const neuesKt = nochEins(a, { id: "k_bbbb0009" });
  assert.equal(neuesKt.stand({}).konten[0].status, "neu-verknuepfen");
  // Entfernen über die neue Kennung, nachdem die Datei inzwischen geändert wurde (sonst ginge der byteweise Weg): die Kette der ALTEN Kennung liefert die frühere Statuszeile
  const doc = JSON.parse(readFileSync(settings(a.verwaltet), "utf8")); doc.b = 2; writeFileSync(settings(a.verwaltet), JSON.stringify(doc));
  const e = neuesKt.schalteStatuszeile({ konto: "k_bbbb0009", an: false, einwilligung: true });
  assert.equal(e.exakt, false);
  const nach = JSON.parse(readFileSync(settings(a.verwaltet), "utf8"));
  assert.deepEqual(nach.statusLine, { type: "command", command: "echo meine-zeile", padding: 3 }, "die frühere Statuszeile ist zurück, nicht gelöscht");
  assert.equal(nach.b, 2);
  assert.deepEqual(leer(a), [], "nichts von der alten Kennung bleibt liegen");
});

test("Neue Konto-Kennung, „Neu verknüpfen“: der Befehl trägt die neue Kennung, die Kette läuft weiter, Merker und Sicherung wandern mit — der Rückweg bleibt byteweise", () => {
  const a = aufbau();
  const original = '{\t"x": 1,\n"statusLine": {"type":"command","command":"printf alt"}}';
  writeFileSync(settings(a.verwaltet), original);
  schalte(a, ID, true);
  const neuesKt = nochEins(a, { id: "k_bbbb0009" });
  const r = neuesKt.schalteStatuszeile({ konto: "k_bbbb0009", an: true, einwilligung: true });
  assert.equal(r.aktion, "neu-verknuepft"); assert.equal(r.kette, true);
  const sl = JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine;
  assert.ok(sl.command.includes("--konto k_bbbb0009") && !sl.command.includes(ID));
  assert.equal(fuehreAus(sl.command).stdout.toString(), "alt");
  assert.ok(existsSync(join(a.k, "k_bbbb0009.json")), "die Werte landen unter der neuen Kennung");
  assert.deepEqual(Object.keys(eintragungen(a)), ["k_bbbb0009"]);
  assert.equal(neuesKt.stand({}).konten[0].status, "ok");
  assert.equal(neuesKt.schalteStatuszeile({ konto: "k_bbbb0009", an: false, einwilligung: true }).exakt, true);
  assert.equal(readFileSync(settings(a.verwaltet), "utf8"), original);
});

test("Nie „statusLine“ löschen, solange es eine Kette gibt: fehlt kette/<id>.json, kommt die frühere Statuszeile aus der Sicherung; fehlt auch die, ändert Kortex nichts", () => {
  const a = aufbau();
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: "echo aus-der-sicherung" } }, null, 2) + "\n");
  schalte(a, ID, true);
  const doc = JSON.parse(readFileSync(settings(a.verwaltet), "utf8")); doc.c = 1; writeFileSync(settings(a.verwaltet), JSON.stringify(doc));   // geändert: kein byteweiser Rückweg
  rmSync(join(a.k, "kette", `${ID}.json`));
  assert.equal(schalte(a, ID, false).exakt, false);
  assert.equal(JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine.command, "echo aus-der-sicherung");
  // zweiter Fall: weder Kette noch Sicherung
  const b = aufbau();
  writeFileSync(settings(b.verwaltet), JSON.stringify({ statusLine: { type: "command", command: "echo verloren" } }, null, 2) + "\n");
  schalte(b, ID, true);
  const d2 = JSON.parse(readFileSync(settings(b.verwaltet), "utf8")); d2.c = 1; writeFileSync(settings(b.verwaltet), JSON.stringify(d2));
  rmSync(join(b.k, "kette", `${ID}.json`));
  for (const n of readdirSync(join(b.k, "sicherung"))) rmSync(join(b.k, "sicherung", n));
  const vorher = readFileSync(settings(b.verwaltet));
  wirft(() => schalte(b, ID, false), 409, "keine-kette");
  assert.ok(readFileSync(settings(b.verwaltet)).equals(vorher), "die Datei bleibt unangetastet");
});

test("Ändert sich settings.json zwischen Lesen und Schreiben, stammen Sicherung und Prüfsumme aus der Fassung, die geschrieben wird — der Rückweg gibt genau die geänderte Fassung zurück", () => {
  const a = aufbau();
  const erste = '{"a": 1}\n', zweite = '{"a": 1, "neu": "dazwischen geändert"}\n';
  writeFileSync(settings(a.verwaltet), erste);
  let hakenAufrufe = 0;
  a.kt._setzeHaken((ziel) => { hakenAufrufe++; writeFileSync(ziel, zweite); });   // eine fremde Änderung genau vor dem Umbenennen
  const r = schalte(a, ID, true);
  assert.equal(hakenAufrufe, 1);
  assert.ok(readFileSync(r.sicherung).equals(Buffer.from(zweite)), "die Sicherung ist die geänderte Fassung, nicht die erste");
  assert.equal(readdirSync(join(a.k, "sicherung")).length, 1, "keine verwaiste Sicherung des ersten Versuchs");
  assert.equal(JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).neu, "dazwischen geändert", "die fremde Änderung ging nicht verloren");
  assert.equal(schalte(a, ID, false).exakt, true);
  assert.equal(readFileSync(settings(a.verwaltet), "utf8"), zweite);
});

test("Scheitert das Eintragen mittendrin, bleibt nichts liegen: weder Kette, Sicherung, Skript noch Merker — und settings.json ist unverändert", () => {
  const a = aufbau();
  const original = JSON.stringify({ statusLine: { type: "command", command: "echo alt" } }) + "\n";
  writeFileSync(settings(a.verwaltet), original);
  a.kt._setzeHaken(() => { throw new Error("Platte voll"); });
  wirft(() => schalte(a, ID, true), 500);
  assert.equal(readFileSync(settings(a.verwaltet), "utf8"), original);
  assert.deepEqual(leer(a), []);
  assert.deepEqual(readdirSync(a.verwaltet).filter((n) => n.includes(".tmp-")), []);
  // und es geht danach ganz normal
  assert.equal(schalte(a, ID, true).aktion, "eingetragen");
});

test("Node oder Skript sind nicht mehr dort, wo der Befehl sie sucht: Stand „reparieren“, „Reparieren“ trägt den Aufruf neu ein (Kette und Merker bleiben)", () => {
  const a = aufbau();
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: "printf meine" } }, null, 2) + "\n");
  schalte(a, ID, true);
  assert.equal(a.kt.stand({}).konten.find((x) => x.id === ID).status, "keine-werte");
  // 1) Kortex wurde verschoben/aktualisiert: anderer Node-Pfad
  const knoten = tmp("brain-node-"); const neuerNode = join(knoten, "node"); symlinkSync(process.execPath, neuerNode);
  const b = nochEins(a, { nodePfad: neuerNode });
  assert.equal(b.stand({}).konten[0].status, "reparieren");
  const r = b.schalteStatuszeile({ konto: ID, an: true, einwilligung: true });
  assert.equal(r.aktion, "repariert");
  const befehl = befehlVon(a.verwaltet);
  assert.ok(befehl.includes(neuerNode));
  assert.equal(fuehreAus(befehl).stdout.toString(), "meine", "die Kette läuft: die frühere Ausgabe bleibt, nebenbei werden Werte gemerkt");
  assert.ok(existsSync(join(a.k, `${ID}.json`)));
  assert.equal(b.stand({}).konten[0].status, "ok");
  assert.equal(b.schalteStatuszeile({ konto: ID, an: true, einwilligung: true }).aktion, "schon-da");
  // 2) das Skript fehlt: derselbe Weg, die frühere Statuszeile läuft derweil (Rückfall im Befehl) weiter
  rmSync(join(a.k, "bin", MARKE));
  assert.equal(b.stand({}).konten[0].status, "reparieren");
  assert.equal(fuehreAus(befehlVon(a.verwaltet)).stdout.toString(), "meine");
  assert.equal(b.schalteStatuszeile({ konto: ID, an: true, einwilligung: true }).aktion, "repariert");
  assert.ok(existsSync(join(a.k, "bin", MARKE)));
  // 3) Node fehlt ganz
  rmSync(neuerNode);
  assert.equal(b.stand({}).konten[0].status, "reparieren");
  // der Rückweg bleibt nach all dem byteweise
  const c = nochEins(a, { nodePfad: process.execPath });
  assert.equal(c.schalteStatuszeile({ konto: ID, an: true, einwilligung: true }).aktion, "repariert");
  assert.equal(c.schalteStatuszeile({ konto: ID, an: false, einwilligung: true }).aktion, "entfernt");
  assert.equal(JSON.parse(readFileSync(settings(a.verwaltet), "utf8")).statusLine.command, "printf meine");
});

test("Entfernen, wenn die Statuszeile schon weg ist: Aktion „schon-weg“ (die Oberfläche sagt es ehrlich) und die Reste sind aufgeräumt", () => {
  const a = aufbau();
  schalte(a, ID, true);
  writeFileSync(settings(a.verwaltet), JSON.stringify({ statusLine: { type: "command", command: "echo anders" } }));
  const e = schalte(a, ID, false);
  assert.equal(e.aktion, "schon-weg");
  assert.deepEqual(leer(a), []);
});
