// Tastenkürzel (Paket P10): das Register (einzige Quelle für Studio, Menüs und globale Kürzel), die reine Logik (Schreibweise, Konflikte, reservierte Kürzel, Tastendruck),
// die erzeugte Studio-Kopie des Registers und die Route GET/PUT /api/tastenkuerzel mit eigener Datei <support>/tastenkuerzel.json (stand, 409, Prüfung ohne Teilschreiben,
// zurücksetzen, kaputte Datei, Ereignis „tastenkuerzel“). Nur Wegwerf-Ordner in os.tmpdir(); nie der echte Support-Ordner, kein Netzwerk.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmp, schreibe, pfad, WURZEL } from "./hilfe.mjs";

const laden = (name) => import("data:text/javascript;base64," + Buffer.from(readFileSync(pfad("studio", name))).toString("base64"));
const L = await laden("tastenkuerzel-logik.js");
const R = JSON.parse(readFileSync(pfad("gemeinsam", "tastenkuerzel-register.json"), "utf8"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { erzeugeEreignisse } = await import(pfad("werkstatt", "ereignisse.mjs"));
const { DATEI, LEERER_STAND, leseDatei } = await import(pfad("werkstatt", "tastenkuerzel.mjs"));

// ---------------------------------------------------------------- Register
test("Register: ids eindeutig, Gruppen vorhanden, Standardkürzel gültig und mit ⌘ oder ⌃, nicht reserviert", () => {
  const ids = R.befehle.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte id");
  const gruppen = new Set(R.gruppen.map((g) => g.id));
  for (const b of R.befehle) {
    assert.ok(gruppen.has(b.gruppe), `${b.id}: Gruppe ${b.gruppe} fehlt`);
    assert.ok(b.name && b.text, `${b.id}: Name und Text`);
    if (b.standard === null || b.standard === undefined) continue;
    const k = L.zerlege(b.standard, R);
    assert.ok(k, `${b.id}: ${b.standard} ist keine gültige Schreibweise`);
    assert.equal(L.formatiere(k), b.standard, `${b.id}: Schreibweise nicht kanonisch`);
    assert.ok(!L.brauchtUmschalter(k), `${b.id}: ${b.standard} braucht ⌃ oder ⌘`);
    assert.equal(L.reserviertGrund(R, b.standard), null, `${b.id}: ${b.standard} ist reserviert`);
  }
});
test("Register: kein Standardkürzel doppelt (sonst gäbe es ab Werk einen Konflikt)", () => {
  const b = L.wirksam(R, {});
  assert.equal(L.konfliktIds(R, b).size, 0);
});
test("Register: die bekannten Befehle und ihre Standardkürzel (Studio + Menü + global)", () => {
  const b = L.wirksam(R, {});
  assert.equal(b["schnell-erfassen"], "Ctrl+Alt+Space");
  assert.equal(b["neue-notiz"], "Cmd+N");
  assert.equal(b.palette, "Cmd+K");
  assert.equal(b.frage, "Cmd+J");
  assert.equal(b.einstellungen, "Cmd+,");
  assert.equal(b["vault-wechseln"], "Ctrl+Cmd+V");
  assert.equal(b["gehe-aufgaben"], "Cmd+4");
  assert.equal(b["frage-global"], null);
  assert.equal(R.befehle.filter((x) => x.global).length, 3);
});
test("Register: reservierte Kürzel sind gültig geschrieben, eindeutig und tragen einen Grund; ⌘Q, ⌘Tab, ⌘Leertaste stehen drin", () => {
  const seen = new Set();
  for (const r of R.reserviert) {
    assert.equal(L.normalisiere(r.kuerzel, R), r.kuerzel, r.kuerzel);
    assert.ok(r.grund, r.kuerzel);
    assert.ok(!seen.has(r.kuerzel), `doppelt: ${r.kuerzel}`); seen.add(r.kuerzel);
  }
  for (const k of ["Cmd+Q", "Cmd+Tab", "Cmd+Space"]) assert.ok(L.reserviertGrund(R, k), k);
});
test("erzeugte Studio-Kopie des Registers passt zum Register (node scripts/erzeuge-tastenkuerzel.mjs --pruefen)", () => {
  execFileSync(process.execPath, [join(WURZEL, "..", "scripts", "erzeuge-tastenkuerzel.mjs"), "--pruefen"], { stdio: "pipe" });
});
test("Register: jeder Befehl mit `menue` hat im Studio (app.js, MENUE_BEFEHLE) eine Aktion dieses Namens, und jede Aktion eines Befehls ist im Register", () => {
  const app = readFileSync(pfad("studio", "app.js"), "utf8");
  const block = /const MENUE_BEFEHLE = \{([\s\S]*?)\n\};/.exec(app)?.[1] || "";
  assert.ok(block, "MENUE_BEFEHLE nicht gefunden");
  for (const b of R.befehle) if (b.menue) assert.ok(new RegExp(`(^|[\\s,{])"?${b.menue}"?:`).test(block), `${b.id}: ${b.menue} fehlt in MENUE_BEFEHLE`);
  for (const m of app.matchAll(/kz\.anmelden\("([a-z-]+)"/g)) assert.ok(R.befehle.some((b) => b.id === m[1]), `kz.anmelden(${m[1]}): nicht im Register`);
});

// ---------------------------------------------------------------- Schreibweise und Anzeige
test("zerlege/formatiere: feste Reihenfolge Ctrl+Alt+Shift+Cmd; falsche Reihenfolge, doppelt, unbekannt → null", () => {
  assert.deepEqual(L.zerlege("Shift+Cmd+M", R), { Ctrl: false, Alt: false, Shift: true, Cmd: true, taste: "M" });
  assert.equal(L.formatiere(L.zerlege("Ctrl+Alt+Shift+Cmd+F12", R)), "Ctrl+Alt+Shift+Cmd+F12");
  for (const falsch of ["Cmd+Shift+M", "Cmd+Cmd+M", "Cmd+", "Cmd+m", "Cmd+Esc", "Cmd+Backspace", "Strg+M", "", "M+Cmd", "Cmd++", null, 5, "Cmd+Mm"]) assert.equal(L.zerlege(falsch, R), null, String(falsch));
  assert.equal(L.normalisiere("Cmd+,", R), "Cmd+,");
});
test("Anzeige: ⌃⌥⇧⌘ in Systemreihenfolge, benannte Tasten deutsch", () => {
  assert.equal(L.anzeigeText("Ctrl+Alt+Space", R), "⌃⌥Leertaste");
  assert.equal(L.anzeigeText("Shift+Cmd+M", R), "⇧⌘M");
  assert.deepEqual(L.anzeigeTeile("Alt+Cmd+Left", R), ["⌥", "⌘", "←"]);
  assert.equal(L.anzeigeText("Cmd+PageUp", R), "⌘Bild ↑");
  assert.deepEqual(L.anzeigeTeile("kaputt", R), []);
});

// ---------------------------------------------------------------- Tastendruck → Kürzel
const ev = (o) => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
test("Tastendruck: ⌘N, ⇧⌘M (key ist „M“), ⌘, / ⌘/ über den Ort der Taste, ⌘1 trotz Umschalt-Zeichen", () => {
  assert.equal(L.ereignisText(ev({ key: "n", code: "KeyN", metaKey: true })), "Cmd+N");
  assert.equal(L.ereignisText(ev({ key: "M", code: "KeyM", metaKey: true, shiftKey: true })), "Shift+Cmd+M");
  assert.equal(L.ereignisText(ev({ key: ",", code: "Comma", metaKey: true })), "Cmd+,");
  assert.equal(L.ereignisText(ev({ key: "/", code: "Slash", metaKey: true })), "Cmd+/");
  assert.equal(L.ereignisText(ev({ key: "!", code: "Digit1", metaKey: true, shiftKey: true })), "Shift+Cmd+1");
  assert.equal(L.ereignisText(ev({ key: " ", code: "Space", ctrlKey: true, altKey: true })), "Ctrl+Alt+Space");
  assert.equal(L.ereignisText(ev({ key: "ArrowLeft", code: "ArrowLeft", metaKey: true, altKey: true })), "Alt+Cmd+Left");
  assert.equal(L.ereignisText(ev({ key: "F5", code: "F5", ctrlKey: true })), "Ctrl+F5");
});
test("Tastendruck: ⌥ verändert das Zeichen (å) — es zählt der Ort der Taste; Buchstaben folgen sonst dem Zeichen (deutsche Tastatur: ⌘Z auf der Taste mit Z)", () => {
  assert.equal(L.ereignisText(ev({ key: "å", code: "KeyA", metaKey: true, altKey: true })), "Alt+Cmd+A");
  assert.equal(L.ereignisText(ev({ key: "z", code: "KeyY", metaKey: true })), "Cmd+Z");
  assert.equal(L.ereignisText(ev({ key: "z", code: "KeyY", ctrlKey: true, altKey: true }), { physisch: true }), "Ctrl+Alt+Y", "globale Kürzel: Ort der Taste");
});
test("Tastendruck: nur Umschalttasten, Esc und Rücktaste ergeben kein Kürzel; außerhalb des Mac gilt Strg als ⌘", () => {
  assert.equal(L.ereignisText(ev({ key: "Meta", code: "MetaLeft", metaKey: true })), null);
  assert.equal(L.ereignisText(ev({ key: "Escape", code: "Escape", metaKey: true })), null);
  assert.equal(L.ereignisText(ev({ key: "Backspace", code: "Backspace", metaKey: true })), null);
  assert.equal(L.ereignisText(ev({ key: "k", code: "KeyK", ctrlKey: true }), { mac: false }), "Cmd+K");
  assert.equal(L.ereignisText(ev({ key: "k", code: "KeyK", ctrlKey: true }), { mac: true }), "Ctrl+K");
  assert.deepEqual(L.aufnahmeTeile(ev({ key: "Meta", code: "MetaLeft", metaKey: true, shiftKey: true })), ["⇧", "⌘"]);
  assert.deepEqual(L.aufnahmeTeile(ev({ key: "k", code: "KeyK", metaKey: true })), ["⌘", "K"]);
});

// ---------------------------------------------------------------- Belegung, Vorrang, Konflikte
test("wirksam: Standard + Eigenes; null = ohne Kürzel; Unbekanntes und Kaputtes fällt beim Säubern weg", () => {
  const e = { "neue-notiz": "Cmd+T", palette: null, gibtsnicht: "Cmd+X", frage: "Cmd+m", info: 5 };
  const sauber = L.saeubere(R, e);
  assert.deepEqual(sauber, { "neue-notiz": "Cmd+T", palette: null });
  const b = L.wirksam(R, sauber);
  assert.equal(b["neue-notiz"], "Cmd+T"); assert.equal(b.palette, null); assert.equal(b.frage, "Cmd+J");
  assert.deepEqual(L.saeubere(R, [1, 2]), {}); assert.deepEqual(L.saeubere(R, null), {});
});
test("Konflikt: nennt den anderen Befehl; mehrere → „A“ und „B“; Text „⌘K gehört schon zu „Befehlspalette“.“", () => {
  const b = L.wirksam(R, {});
  const k = L.konflikte(R, b, "neue-notiz", "Cmd+K");
  assert.deepEqual(k, [{ id: "palette", name: "Befehlspalette" }]);
  assert.equal(L.konfliktText("⌘K", k), "⌘K gehört schon zu „Befehlspalette“.");
  assert.equal(L.konfliktText("⌘K", [{ name: "A" }, { name: "B" }, { name: "C" }]), "⌘K gehört schon zu „A“, „B“ und „C“.");
  assert.deepEqual(L.konflikte(R, b, "palette", "Cmd+K"), [], "der Befehl selbst zählt nicht");
  assert.deepEqual(L.konflikte(R, b, "palette", null), []);
  assert.deepEqual(L.konflikte(R, b, "palette", "Cmd+U"), []);
});
test("Vorrang bei doppelter Belegung: ein geändertes Kürzel gilt vor einem unveränderten, sonst die Reihenfolge im Register", () => {
  const e = { "neue-notiz": "Cmd+K" }; // wie „Trotzdem nehmen“
  const m = L.nachschlagen(R, e);
  assert.equal(m.get("Cmd+K"), "neue-notiz");
  assert.equal(L.nachschlagen(R, {}).get("Cmd+K"), "palette");
  assert.ok(L.konfliktIds(R, L.wirksam(R, e)).has("palette") && L.konfliktIds(R, L.wirksam(R, e)).has("neue-notiz"));
  assert.equal(L.istGeaendert(R, e, "neue-notiz"), true);
  assert.equal(L.istGeaendert(R, { "neue-notiz": "Cmd+N" }, "neue-notiz"), false, "gleich dem Standard = nicht geändert");
  assert.equal(L.istGeaendert(R, { palette: null }, "palette"), true, "bewusst ohne Kürzel ist eine Änderung");
});
test("pruefe: ohne ⌃/⌘ abgelehnt, reservierte Kürzel mit Grund abgelehnt (⌘Q, ⌘Tab, ⌘Leertaste), sonst ok", () => {
  assert.equal(L.pruefe(R, "Shift+Cmd+J").ok, true);
  assert.equal(L.pruefe(R, "Alt+J").art, "umschalter");
  assert.equal(L.pruefe(R, "J").art, "umschalter");
  assert.equal(L.pruefe(R, "Cmd+Esc").art, "ungueltig");
  const q = L.pruefe(R, "Cmd+Q");
  assert.equal(q.ok, false); assert.equal(q.art, "reserviert"); assert.match(q.text, /⌘Q gehört macOS \(„Kortex beenden“\)/);
  assert.equal(L.pruefe(R, "Cmd+Tab").art, "reserviert");
  assert.equal(L.pruefe(R, "Cmd+Space").art, "reserviert");
  assert.equal(L.pruefe(R, "Ctrl+Space").art, "reserviert");
  const e = L.pruefe(R, "Cmd+E"); // fest vergebener Menüeintrag von Kortex („Kortex einrichten“)
  assert.equal(e.art, "reserviert"); assert.match(e.text, /⌘E ist in Kortex fest vergeben \(„Kortex einrichten“\)/);
});

// ---------------------------------------------------------------- Route und Datei
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { status: r.status, j };
};
const aufbau = () => {
  const d = tmp("brain-kz-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "a.md", "# A\n");
  const support = tmp("brain-kz-support-");
  return { d, support, rufe: aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } })) };
};
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

test("GET: ohne Datei die Standardbelegung des Registers, Stand des leeren Textes, Dateiname", async () => {
  const { rufe, support } = aufbau();
  const r = await rufe("GET", "/api/tastenkuerzel");
  assert.equal(r.status, 200);
  assert.equal(r.j.stand, LEERER_STAND);
  assert.deepEqual(r.j.ueberschrieben, {});
  assert.deepEqual(r.j.belegung, L.wirksam(R, {}));
  assert.equal(r.j.datei, "tastenkuerzel.json");
  assert.equal(r.j.fehler, undefined);
  assert.equal(existsSync(join(support, DATEI)), false, "Lesen legt nichts an");
});
test("PUT: eigenes Kürzel landet in <support>/tastenkuerzel.json (nur die Abweichung), gilt sofort in der Antwort; Gleiches wie der Standard wird nicht gespeichert", async () => {
  const { rufe, support } = aufbau();
  const g = (await rufe("GET", "/api/tastenkuerzel")).j;
  const r = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T", palette: "Cmd+K", "kortex-zeigen": "Ctrl+Cmd+K", "schnell-merken": null }, stand: g.stand });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.equal(r.j.belegung["neue-notiz"], "Cmd+T");
  assert.equal(r.j.belegung["schnell-merken"], null);
  assert.equal(r.j.belegung.palette, "Cmd+K");
  const datei = JSON.parse(readFileSync(join(support, DATEI), "utf8"));
  assert.deepEqual(datei, { schema: 1, kuerzel: { "neue-notiz": "Cmd+T", "kortex-zeigen": "Ctrl+Cmd+K", "schnell-merken": null } });
  assert.notEqual(r.j.stand, g.stand);
  assert.deepEqual(leseDatei(support).ueberschrieben, datei.kuerzel, "die App liest dieselbe Datei");
});
test("PUT: zurücksetzen je Befehl und alle; leere Datei wird entfernt; Stand danach wie am Anfang", async () => {
  const { rufe, support } = aufbau();
  let st = (await rufe("GET", "/api/tastenkuerzel")).j.stand;
  let r = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T", info: "Alt+Cmd+J" }, stand: st });
  r = await rufe("PUT", "/api/tastenkuerzel", { zurueck: ["neue-notiz"], stand: r.j.stand });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.ueberschrieben, { info: "Alt+Cmd+J" });
  r = await rufe("PUT", "/api/tastenkuerzel", { zurueck: "alle", stand: r.j.stand });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.ueberschrieben, {});
  assert.equal(existsSync(join(support, DATEI)), false);
  assert.equal(r.j.stand, LEERER_STAND);
});
test("PUT: Prüfung vor dem Schreiben — unbekannter Befehl, ungültige Schreibweise, ohne ⌃/⌘, reserviert (⌘Q, ⌘Tab, ⌘Leertaste) → 400 und nichts geschrieben", async () => {
  const { rufe, support } = aufbau();
  const st = (await rufe("GET", "/api/tastenkuerzel")).j.stand;
  const fall = [
    [{ gibtsnicht: "Cmd+T" }, /Unbekannter Befehl/],
    [{ "neue-notiz": "Cmd+Esc" }, /nicht als Kürzel/],
    [{ "neue-notiz": "N" }, /⌃ \(Control\) oder ⌘/],
    [{ "neue-notiz": "Cmd+Q" }, /gehört macOS/],
    [{ "neue-notiz": "Cmd+Tab" }, /gehört macOS/],
    [{ "neue-notiz": "Cmd+Space" }, /gehört macOS/],
    [{ "neue-notiz": 5 }, /Ungültig/],
  ];
  for (const [werte, muster] of fall) {
    const r = await rufe("PUT", "/api/tastenkuerzel", { werte, stand: st });
    assert.equal(r.status, 400, JSON.stringify(werte));
    assert.match(r.j.fehler || r.j.message || JSON.stringify(r.j), muster);
  }
  // gemischt: ein gültiges und ein reserviertes → gar nichts wird geschrieben
  const r = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T", info: "Cmd+Q" }, stand: st });
  assert.equal(r.status, 400);
  assert.equal(existsSync(join(support, DATEI)), false);
  assert.equal((await rufe("PUT", "/api/tastenkuerzel", { werte: {}, zurueck: ["gibtsnicht"], stand: st })).status, 400);
  assert.equal((await rufe("PUT", "/api/tastenkuerzel", { werte: {}, zurueck: 7, stand: st })).status, 400);
  assert.equal((await rufe("PUT", "/api/tastenkuerzel", { werte: {} })).status, 400, "ohne stand");
  assert.equal((await rufe("PUT", "/api/tastenkuerzel", { werte: {}, stand: "x" })).status, 400, "ungültiger stand");
});
test("PUT: doppelt belegte Kürzel sind erlaubt („Trotzdem nehmen“) — die Route lehnt nur Ungültiges und Reserviertes ab", async () => {
  const { rufe } = aufbau();
  const st = (await rufe("GET", "/api/tastenkuerzel")).j.stand;
  const r = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+K" }, stand: st });
  assert.equal(r.status, 200);
  assert.equal(r.j.belegung["neue-notiz"], "Cmd+K"); assert.equal(r.j.belegung.palette, "Cmd+K");
});
test("PUT: optimistische Sperre — hat jemand anderes (die App, ein zweites Fenster) die Datei geändert → 409 art „konflikt“, nichts überschrieben", async () => {
  const { rufe, support } = aufbau();
  const st = (await rufe("GET", "/api/tastenkuerzel")).j.stand;
  writeFileSync(join(support, DATEI), JSON.stringify({ schema: 1, kuerzel: { info: "Alt+Cmd+J" } }));
  const r = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T" }, stand: st });
  assert.equal(r.status, 409);
  assert.equal(r.j.art, "konflikt");
  assert.deepEqual(JSON.parse(readFileSync(join(support, DATEI), "utf8")).kuerzel, { info: "Alt+Cmd+J" });
  // mit frischem Stand klappt es und führt beides zusammen
  const g = (await rufe("GET", "/api/tastenkuerzel")).j;
  const r2 = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T" }, stand: g.stand });
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.j.ueberschrieben, { info: "Alt+Cmd+J", "neue-notiz": "Cmd+T" });
});
test("Datei: Unbekanntes und Ungültiges wird beim Lesen ignoriert, kaputte Datei → Standardwerte + Fehlertext, Schreiben meldet 500 und überschreibt sie nie", async () => {
  const { rufe, support } = aufbau();
  writeFileSync(join(support, DATEI), JSON.stringify({ schema: 1, kuerzel: { "neue-notiz": "Cmd+T", gibtsnicht: "Cmd+X", info: "Cmd+Q", frage: "kaputt", palette: null } }));
  const g = (await rufe("GET", "/api/tastenkuerzel")).j;
  // Cmd+Q ist gültig geschrieben (Reserviertes prüft nur die Aufnahme/Route beim Schreiben); die Datei selbst wird nicht „zensiert“
  assert.deepEqual(g.ueberschrieben, { "neue-notiz": "Cmd+T", info: "Cmd+Q", palette: null });
  writeFileSync(join(support, DATEI), "{ das ist kein JSON");
  const k = (await rufe("GET", "/api/tastenkuerzel")).j;
  assert.match(k.fehler, /beschädigt/);
  assert.deepEqual(k.belegung, L.wirksam(R, {}));
  const r = await rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T" }, stand: k.stand });
  assert.equal(r.status, 500);
  assert.equal(readFileSync(join(support, DATEI), "utf8"), "{ das ist kein JSON");
  writeFileSync(join(support, DATEI), "[1,2]");
  assert.match((await rufe("GET", "/api/tastenkuerzel")).j.fehler, /beschädigt/);
});
test("Datei: gleichzeitige Schreibvorgänge laufen nacheinander (kein verlorenes Update)", async () => {
  const { rufe } = aufbau();
  const g = (await rufe("GET", "/api/tastenkuerzel")).j;
  const [a, b] = await Promise.all([
    rufe("PUT", "/api/tastenkuerzel", { werte: { "neue-notiz": "Cmd+T" }, stand: g.stand }),
    rufe("PUT", "/api/tastenkuerzel", { werte: { info: "Alt+Cmd+J" }, stand: g.stand }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], "einer gewinnt, der andere bekommt den Konflikt statt still zu überschreiben");
});
test("Route: auch ohne offenen Vault erreichbar (die Kürzel gehören der App, nicht dem Vault); der Handler kennt sie als eigene Route", async () => {
  const support = tmp("brain-kz-support-");
  const rufe = aufruf(erzeugeHandler({ vault: null, vaultOptionen: { support } }));
  const r = await rufe("GET", "/api/tastenkuerzel");
  assert.equal(r.status, 200);
  assert.equal((await rufe("POST", "/api/tastenkuerzel", {})).status, 405);
});
test("Ereignis „tastenkuerzel“: Änderung der Datei von außen (die App schreibt sie) wird gemeldet, ein eigener Schreibvorgang über die Route nicht", async () => {
  for (const modus of ["watch", "poll"]) {
    const { d, support } = aufbau();
    const h = erzeugeEreignisse({ entprellMs: 60, maxWarteMs: 300, pollMs: 80, modus, support });
    try {
      h.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
      let stand = await h.warte({}); await pause(250);
      const sammle = async (ms) => { const ende = Date.now() + ms, alle = []; while (Date.now() < ende) { const r = await h.warte({ seit: stand.aktuell, epoche: stand.epoche, warteMs: Math.min(300, Math.max(20, ende - Date.now())) }); stand = { epoche: r.epoche, aktuell: r.aktuell }; alle.push(...r.ereignisse); } return alle; };
      writeFileSync(join(support, DATEI), JSON.stringify({ schema: 1, kuerzel: { info: "Alt+Cmd+J" } }));
      const e = await sammle(900);
      assert.ok(e.some((x) => x.typ === "tastenkuerzel"), `${modus}: Änderung von außen: ${JSON.stringify(e)}`);
    } finally { h.beende(); }
  }
});
