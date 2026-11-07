// Electron-Hülle (Paket W2b, electron/): die Teile ohne Electron — Kürzel (Accelerator, globale Kürzel mit Attrappe), App-Menü aus dem Register, Tray-Menü, Mitteilungs-Planer (mit Uhr von außen),
// Erfassen (Anfrage, Platzierung), App-Symbole, Glas. Gleichheit mit der Mac-App (Texte, Zahlen, Fälle) wird gegen die Swift-Dateien abgeglichen. Die echte App prüft electron/test/w2b.spec.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const laden = (rel) => import(pathToFileURL(join(W, rel)).href);
const les = (rel) => readFileSync(join(W, rel), "utf8");
const logik = await laden("Ressourcen/gemeinsam/tastenkuerzel-logik.mjs");
const register = JSON.parse(les("Ressourcen/gemeinsam/tastenkuerzel-register.json"));
const { acceleratorVon, menueAccelerator, erzeugeGlobaleKuerzel, anzeigeText, TEXT } = await laden("electron/kuerzel.mjs");
const { baueMenueVorlage, MENUE_BEFEHLE } = await laden("electron/menue.mjs");
const tray = await laden("electron/tray.mjs");
const mi = await laden("electron/mitteilungen.mjs");
const er = await laden("electron/erfassen.mjs");
const sy = await laden("electron/symbole.mjs");
const gl = await laden("electron/glas.mjs");
const { liesKurzformen } = await laden("Ressourcen/gemeinsam/kurzformen.mjs");
const { ART_SCHALTER } = await laden("Ressourcen/gemeinsam/aktivitaet.mjs");
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "kortex-w2b-test-")));
const opt = (plattform) => ({ register, logik, plattform });

// ───────────── Kürzel ─────────────
test("Accelerator: Windows/Linux Strg statt ⌘ (Cmd und Ctrl werden beide zu Strg), Mac wie üblich; ungültige Schreibweise → null", () => {
  assert.equal(acceleratorVon("Cmd+K", opt("win32")), "Ctrl+K");
  assert.equal(acceleratorVon("Shift+Cmd+D", opt("linux")), "Ctrl+Shift+D".replace("Ctrl+Shift", "Ctrl+Shift"));
  assert.equal(acceleratorVon("Ctrl+Alt+Space", opt("win32")), "Ctrl+Alt+Space");
  assert.equal(acceleratorVon("Ctrl+Cmd+V", opt("win32")), "Ctrl+V", "⌃ und ⌘ fallen unter Windows/Linux zusammen");
  assert.equal(acceleratorVon("Alt+Cmd+Left", opt("linux")), "Ctrl+Alt+Left");
  assert.equal(acceleratorVon("Cmd+,", opt("win32")), "Ctrl+,");
  assert.equal(acceleratorVon("Shift+Cmd+D", opt("darwin")), "Shift+Command+D");
  assert.equal(acceleratorVon("Ctrl+Alt+Space", opt("darwin")), "Control+Alt+Space");
  for (const schlecht of ["", "Cmd+", "Cmd+ß", "Shift+Cmd+Ctrl+K", "Cmd++", null, 5]) assert.equal(acceleratorVon(schlecht, opt("win32")), null, String(schlecht));
});
test("Anzeige im Erfassen-Fenster: Windows/Linux als Wörter, Mac mit Zeichen", () => {
  assert.equal(anzeigeText("Ctrl+Alt+Space", opt("win32")), "Strg+Alt+Leertaste");
  assert.equal(anzeigeText("Shift+Cmd+M", opt("linux")), "Strg+Umschalt+M");
  assert.equal(anzeigeText("Ctrl+Alt+Space", opt("darwin")), "⌃⌥Leertaste");
  assert.equal(anzeigeText(null, opt("win32")), "");
});

// Attrappe für globalShortcut: hält Kürzel, `fremd` sind von einem anderen Programm belegt
function attrappe(fremd = []) {
  const gehalten = new Map(), aufrufe = [];
  return { gehalten, aufrufe, globalShortcut: {
    register(acc, fn) { aufrufe.push(["register", acc]); if (fremd.includes(acc) || gehalten.has(acc)) return false; gehalten.set(acc, fn); return true; },
    unregister(acc) { aufrufe.push(["unregister", acc]); gehalten.delete(acc); },
    isRegistered: (acc) => gehalten.has(acc),
  } };
}
const neuGlobal = (a, extra = {}) => { const g = erzeugeGlobaleKuerzel({ register, logik, globalShortcut: a.globalShortcut, plattform: "win32", ...extra }); for (const id of ["schnell-erfassen", "frage-global", "kortex-zeigen"]) g.setzeAktion(id, () => a.aufrufe.push(["aktion", id])); return g; };

test("Globale Kürzel: Belegung aus dem Register (Standard Strg+Alt+Leertaste), eigene Belegung, ohne Kürzel = nicht angemeldet", () => {
  const a = attrappe(), g = neuGlobal(a);
  const h = g.wendeAn(logik.wirksam(register, {}));
  assert.deepEqual(h, {});
  assert.deepEqual(g.angemeldet(), { "schnell-erfassen": "Ctrl+Alt+Space" }, "frage-global und kortex-zeigen haben im Register kein Kürzel");
  assert.ok(a.gehalten.has("Ctrl+Alt+Space"));
  a.gehalten.get("Ctrl+Alt+Space")(); // Tastendruck
  assert.deepEqual(a.aufrufe.at(-1), ["aktion", "schnell-erfassen"]);
  g.wendeAn(logik.wirksam(register, { "schnell-erfassen": "Shift+Cmd+F13", "kortex-zeigen": "Ctrl+Alt+Z" }));
  assert.deepEqual(g.angemeldet(), { "schnell-erfassen": "Shift+Cmd+F13", "kortex-zeigen": "Ctrl+Alt+Z" });
  assert.equal(a.gehalten.has("Ctrl+Alt+Space"), false, "das alte Kürzel ist frei");
  assert.ok(a.gehalten.has("Ctrl+Shift+F13"));
  g.wendeAn(logik.wirksam(register, { "schnell-erfassen": null }));
  assert.deepEqual(g.angemeldet(), {}, "null = bewusst ohne Kürzel: abgemeldet");
  g.beende();
  assert.equal(a.gehalten.size, 0);
});

test("Globale Kürzel: dieselben Antworten wie KuerzelSteuerung.pruefeGlobal (Swift) — ok, ungültig, ⌃/⌘ fehlt, reserviert, belegt, unbekannt", () => {
  const a = attrappe(["Ctrl+Alt+F9"]), g = neuGlobal(a);
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Ctrl+Alt+F8"), { ok: true });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Ctrl+Hoch"), { ok: false, text: "Diese Taste lässt sich nicht als Kürzel verwenden." });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Alt+Shift+A"), { ok: false, text: "Bitte mit ⌃ (Control) oder ⌘ (Befehl) kombinieren, sonst stört das Kürzel beim Schreiben." });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Cmd+Q"), { ok: false, text: "Dieses Kürzel nutzt das System bereits („Kortex beenden“). Wähle ein anderes." });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Alt+Cmd+1"), { ok: false, text: "Alt+Strg+1 ist in Kortex fest vergeben („Studio öffnen“).".replace("Alt+Strg+1", "⌥⌘1") });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Ctrl+Alt+F9"), { ok: false, text: "Dieses Kürzel ist schon von einem anderen Programm belegt." });
  assert.deepEqual(g.pruefeGlobal("neue-notiz", "Ctrl+Alt+F8"), { ok: false, text: "Dieses Kürzel gibt es nicht." }, "kein globaler Befehl");
  assert.deepEqual(g.pruefeGlobal("gibt-es-nicht", "Ctrl+Alt+F8"), { ok: false, text: "Dieses Kürzel gibt es nicht." });
  // Fehler: das bisherige Kürzel bleibt angemeldet (kein „halb umgestellt“)
  assert.deepEqual(g.angemeldet(), { "schnell-erfassen": "Ctrl+Alt+F8" });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", null), { ok: true });
  assert.deepEqual(g.angemeldet(), {});
  // zwei eigene Befehle mit derselben Taste: der zweite ist „belegt“
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Ctrl+Alt+F8"), { ok: true });
  assert.deepEqual(g.pruefeGlobal("kortex-zeigen", "Ctrl+Alt+F8"), { ok: false, text: TEXT.belegt });
});
test("Globale Kürzel: die Texte sind die der Mac-App (KuerzelFehler, KuerzelPruefung)", () => {
  const swift = les("Sources/BrainCore/Erfassen/KuerzelRegistrierung.swift") + les("Sources/BrainCore/Erfassen/KuerzelPruefung.swift") + les("Sources/BrainApp/KuerzelSteuerung.swift");
  assert.ok(swift.includes(TEXT.belegt));
  assert.ok(swift.includes(TEXT.taste));
  assert.ok(swift.includes(TEXT.unbekannt));
  assert.ok(swift.includes("Bitte mit ⌃ (Control) oder ⌘ (Befehl) kombinieren, sonst stört das Kürzel beim Schreiben."));
});
test("Globale Kürzel: Vorschau/Testlauf (aktiv: false) meldet nie etwas an und antwortet ok; Wayland und ungültiger Accelerator haben eigene Texte", () => {
  const a = attrappe(), g = neuGlobal(a, { aktiv: false });
  assert.deepEqual(g.wendeAn(logik.wirksam(register, {})), {});
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Cmd+Q"), { ok: true });
  assert.deepEqual(g.pruefeGlobal("schnell-erfassen", "Ctrl+Hoch"), { ok: false, text: TEXT.taste }, "die Schreibweise prüft auch die Vorschau");
  assert.deepEqual(a.aufrufe, []);
  const b = attrappe(["Ctrl+Alt+F8"]), w = neuGlobal(b, { wayland: true });
  assert.equal(w.pruefeGlobal("schnell-erfassen", "Ctrl+Alt+F8").text, TEXT.wayland);
  const c = { globalShortcut: { register() { throw new TypeError("ungültig"); }, unregister() {}, isRegistered: () => false }, aufrufe: [] };
  assert.equal(neuGlobal(c).pruefeGlobal("schnell-erfassen", "Ctrl+Alt+F8").text, TEXT.taste);
});

// ───────────── Menü ─────────────
const belegungStandard = () => logik.wirksam(register, {});
const menue = (plattform, belegung = belegungStandard(), extra = {}) => baueMenueVorlage({ register, logik, belegung, plattform, aktion: () => {}, ...extra });
const flach = (v) => v.flatMap((m) => (m.submenu ? m.submenu.map((i) => ({ ...i, oben: m.label })) : [m]));

test("Menü: jeder Eintrag, der einen Studio-Befehl auslöst, steht im Register (nichts erfunden), und jeder Menü-Befehl der Mac-App ist da", () => {
  const imRegister = new Set(register.befehle.map((b) => b.menue).filter(Boolean));
  for (const n of MENUE_BEFEHLE) assert.ok(imRegister.has(n), `Menü-Name „${n}“ steht nicht im Register`);
  // dieselben Befehle wie das Hauptmenü der Mac-App (BrainApp.swift: befehl("…", .name))
  const swift = les("Sources/BrainApp/BrainApp.swift");
  const mac = new Set([...swift.matchAll(/befehl\("[^"]+", \.(\w+)\)/g)].map((m) => m[1]));
  const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const unserer = new Set(MENUE_BEFEHLE.map(camel));
  for (const n of mac) assert.ok(unserer.has(n === "abgleichen" ? "sync" : n), `Mac-Menü-Befehl ${n} fehlt im Electron-Menü`);
});
test("Menü: Kürzel kommen aus Register und eigener Belegung — Strg statt ⌘, Kürzel gehört einem Eintrag, deutsche Texte", () => {
  const v = menue("win32"), e = flach(v);
  assert.deepEqual(v.map((m) => m.label), ["Ablage", "Darstellung", "Gehe zu", "Fenster"]);
  const nach = (id) => e.find((x) => x.id === id);
  assert.equal(nach("befehl-neu").accelerator, "Ctrl+N");
  assert.equal(nach("befehl-neu").label, "Neue Notiz");
  assert.equal(nach("befehl-palette").accelerator, "Ctrl+K");
  assert.equal(nach("befehl-heute").accelerator, "Ctrl+Shift+D");
  assert.equal(nach("befehl-zurueck").accelerator, "Ctrl+Alt+Left");
  assert.equal(nach("befehl-hell-dunkel").accelerator, undefined, "ohne Kürzel im Register: keines im Menü");
  assert.equal(nach("befehl-neu").registerAccelerator, false, "Windows/Linux: nur anzeigen, das Studio fängt den Tastendruck selbst ab");
  // feste Einträge: Kürzel aus den „reservierten“ des Registers
  assert.equal(nach("fest-beenden").accelerator, "Ctrl+Q");
  assert.equal(nach("fest-schliessen").accelerator, "Ctrl+W");
  assert.equal(nach("fest-einrichten").accelerator, "Ctrl+E");
  assert.equal(nach("fest-studio").accelerator, "Ctrl+Alt+1");
  assert.equal(nach("fest-erfassen").accelerator, "Ctrl+Alt+Space", "„Schnell erfassen“ zeigt das globale Kürzel des Registers");
  // eigene Belegung gilt sofort; null = kein Kürzel; ein Kürzel gehört dem Gewinner (geänderter Befehl vor unverändertem)
  const eigen = logik.wirksam(register, { "palette": null, "tagesnotiz": "Cmd+N", "kuerzel-hilfe": "Shift+Cmd+Y" });
  const e2 = flach(menue("linux", eigen));
  assert.equal(e2.find((x) => x.id === "befehl-neu").accelerator, undefined, "Cmd+N gehört jetzt der Tagesnotiz (geändert, hat Vorrang) — der andere Eintrag zeigt keins");
  assert.equal(e2.find((x) => x.id === "befehl-heute").accelerator, "Ctrl+N");
  assert.equal(e2.find((x) => x.id === "befehl-palette").accelerator, undefined);
  assert.equal(flach(menue("linux", logik.wirksam(register, { "neue-notiz": "Shift+Cmd+Y" }))).find((x) => x.id === "befehl-neu").accelerator, "Ctrl+Shift+Y", "eigenes Kürzel gilt sofort");
  // Mac (nur Entwicklung): Command, Standardmenüs vorn
  const mac = menue("darwin");
  assert.deepEqual(mac.slice(0, 2), [{ role: "appMenu" }, { role: "editMenu" }]);
  assert.equal(flach(mac).find((x) => x.id === "befehl-neu").accelerator, "Command+N");
  assert.equal(flach(mac).find((x) => x.id === "befehl-neu").registerAccelerator, undefined);
  // Windows/Linux haben kein Bearbeiten-Menü (Strg+C/V/Z gehören dem Editor), Entwicklerwerkzeuge nur für Entwickler
  assert.ok(!v.some((m) => m.label === "Bearbeiten"));
  assert.ok(!flach(v).some((x) => x.id === "rolle-toggleDevTools"));
  assert.ok(flach(menue("win32", belegungStandard(), { entwickler: true })).some((x) => x.id === "rolle-toggleDevTools"));
});
test("Menü: Klick meldet den Befehl bzw. die feste Aktion; menueAccelerator ohne Kürzel → null", () => {
  const klicks = [];
  const v = baueMenueVorlage({ register, logik, belegung: belegungStandard(), plattform: "linux", aktion: (a) => klicks.push(a) });
  const e = flach(v);
  e.find((x) => x.id === "befehl-vault-wechseln").click();
  e.find((x) => x.id === "fest-beenden").click();
  e.find((x) => x.id === "fest-erfassen").click();
  assert.deepEqual(klicks, [{ befehl: "vault-wechseln" }, { fest: "beenden" }, { fest: "erfassen" }]);
  assert.equal(menueAccelerator("hell-dunkel", { register, logik, belegung: belegungStandard(), gewinner: logik.nachschlagen(register, {}), plattform: "linux" }), null);
});

// ───────────── Tray ─────────────
test("Tray: Menü wie die Menüleiste der Mac-App, Zähler neuer Mitteilungen und Rückfragen, Zeilen nur wo sie stimmen", () => {
  const klicks = [], aktion = (a) => klicks.push(a);
  const z = tray.trayZustand({ info: { vault: "/v", name: "Mein Vault", vertrauen: { erlaubt: true } }, aktivitaet: { ungelesen: 3 }, rueckfragen: { verfuegbar: true, offen: 2 } }, "Ctrl+Alt+Space");
  const v = tray.baueTrayVorlage(z, aktion);
  const labels = v.map((x) => x.label).filter(Boolean);
  assert.deepEqual(labels, ["Mein Vault", "3 neue Mitteilungen", "2 Rückfragen offen", "Studio öffnen", "Schnell erfassen …", "Jetzt abgleichen", "Vault wechseln …", "Ordner als Vault öffnen …", "Ordner im Dateimanager zeigen", "Einstellungen …", "Kortex einrichten …", "Beenden"]);
  assert.equal(tray.trayTitel(z), "Kortex — 3 neue Mitteilungen");
  assert.equal(v.find((x) => x.id === "tray-erfassen").accelerator, "Ctrl+Alt+Space");
  v.find((x) => x.id === "tray-mitteilungen").click(); v.find((x) => x.id === "tray-beenden").click(); v.find((x) => x.id === "tray-abgleichen").click();
  assert.deepEqual(klicks, [{ befehl: "aktivitaet" }, { fest: "beenden" }, { befehl: "sync" }]);
  // ohne Vault: keine Zähler, abhängige Zeilen aus; nur ansehen: Hinweis; ohne Kit keine Rückfragen-Zeile
  const leer = tray.baueTrayVorlage(tray.trayZustand({ info: { vault: null }, aktivitaet: null, rueckfragen: null }), aktion);
  assert.deepEqual(leer.map((x) => x.label).filter(Boolean).slice(0, 2), ["Studio öffnen", "Schnell erfassen …"]);
  assert.equal(leer.find((x) => x.id === "tray-abgleichen").enabled, false);
  assert.equal(tray.trayTitel(tray.trayZustand({ info: { vault: null } })), "Kortex");
  const nur = tray.baueTrayVorlage(tray.trayZustand({ info: { vault: "/v", name: "V", vertrauen: { erlaubt: false } }, aktivitaet: { ungelesen: 0 }, rueckfragen: { verfuegbar: false } }), aktion);
  assert.ok(nur.some((x) => x.id === "tray-nur-ansehen"));
  assert.ok(!nur.some((x) => x.id === "tray-rueckfragen"));
  assert.ok(nur.some((x) => x.label === "Keine neuen Mitteilungen"));
  // Texte wie RueckfragenText (Swift)
  const swift = les("Sources/BrainCore/RueckfragenStapel.swift");
  for (const t of [tray.rueckfragenText(null), tray.rueckfragenText(0), tray.rueckfragenText(1)]) assert.ok(swift.includes(t), t);
  assert.ok(swift.includes('"\\(n) Rückfragen offen"') && tray.rueckfragenText(5) === "5 Rückfragen offen");
});

// ───────────── Mitteilungen ─────────────
const E = (o) => ({ id: `a_${Math.random().toString(36).slice(2, 10)}_000000`, zeit: new Date(1_000_000).toISOString(), art: "ablage-aufgabe", vault: "0123456789abcdef", vaultName: "V", wer: "Claude Code", anzahl: 1, text: "x", ...o });
const standard = () => mi.leseEinstellungen(temp());
function planer(opt = {}) {
  const uhr = { t: 1_000_000 };
  return { uhr, p: mi.erzeugePlaner({ artSchalter: ART_SCHALTER, jetzt: () => uhr.t, start: 999_000, ...opt }) };
}
test("Mitteilungs-Planer: Sammelfenster (5 s) macht aus gleichen Ereignissen EINE Mitteilung; Ziel und Satz je Art", () => {
  const { uhr, p } = planer();
  p.aufnehmen([E({}), E({}), E({ art: "ablage-notiz" })], standard());
  assert.equal(p.faellige(standard(), false).length, 0, "Fenster noch offen");
  uhr.t += 5000;
  const m = p.faellige(standard(), false);
  assert.equal(m.length, 2);
  const a = m.find((x) => x.ziel === "aufgaben"), n = m.find((x) => x.ziel === "posteingang");
  assert.deepEqual([a.titel, a.untertitel, a.text, a.istProbe], ["Claude Code", "V", "hat 2 Aufgaben angelegt.", false]);
  assert.equal(n.text, "hat eine Notiz im Posteingang abgelegt.");
  assert.equal(p.wartende(), 0);
});
test("Mitteilungs-Planer: Kontingent 80 % und 100 % bleiben getrennte Mitteilungen; ohne bekannten Handelnden „Eine KI“; Freitext aus dem Protokoll kommt nie vor", () => {
  const { uhr, p } = planer({ regeln: { sammelfenster: 0 } });
  p.aufnehmen([E({ art: "kontingent", grund: "5h-80", konto: "k_00000001" }), E({ art: "kontingent", grund: "5h-100", konto: "k_00000001" }), E({ art: "kontingent", grund: "woche-80", konto: "k_00000001", wer: "Evil <b>Tool</b>" })], standard());
  uhr.t += 1;
  const m = p.faellige(standard(), false);
  assert.deepEqual(m.map((x) => x.text).sort(), ["Eine KI hat 80 % des Wochen-Kontingents verbraucht.", "hat 80 % des 5-Stunden-Kontingents verbraucht.", "hat das 5-Stunden-Kontingent aufgebraucht."].sort());
  assert.ok(m.every((x) => x.ziel === "aktivitaet"));
  assert.equal(m.find((x) => x.text.startsWith("Eine KI")).titel, "Kortex", "unbekannter Handelnder → Kortex als Titel");
  assert.ok(!JSON.stringify(m).includes("Evil"));
});
test("Mitteilungs-Planer: Schalter je Art, Pflege standardmäßig aus, Kontingent-Schalter, rückgängig/datei-aktion/unbekannt nie, Ereignisse vor dem Start nie", () => {
  const { uhr, p } = planer({ regeln: { sammelfenster: 0 } });
  const e = standard();
  assert.equal(e.mitteilungenPflege, false);
  p.aufnehmen([E({ art: "pflege" }), E({ art: "rueckgaengig" }), E({ art: "datei-aktion" }), E({ art: "gibt-es-nicht" }), E({ zeit: new Date(500_000).toISOString() })], e);
  uhr.t += 1;
  assert.equal(p.faellige(e, false).length, 0);
  p.aufnehmen([E({ art: "kontingent", grund: "5h-80" })], { ...e, mitteilungenKontingent: false });
  assert.equal(p.faellige(e, false).length, 0, "Kontingent aus");
  p.aufnehmen([E({ art: "pflege" })], { ...e, mitteilungenPflege: true });
  uhr.t += 1;
  assert.deepEqual(p.faellige({ ...e, mitteilungenPflege: true }, false).map((x) => x.text), ["Pflege fertig."]);
  // Schalter ändert sich zwischen Aufnahme und Ablauf des Fensters
  const q = planer({ regeln: { sammelfenster: 5 } });
  q.p.aufnehmen([E({})], e); q.uhr.t += 5000;
  assert.equal(q.p.faellige({ ...e, mitteilungenAbgelegt: false }, false).length, 0);
});
test("Mitteilungs-Planer: nur im Hintergrund, höchstens 4 je Minute (Rest einmal als Sammelmitteilung), 5-s-Sperre, Pause für gleiche Abweisungen", () => {
  const e = standard();
  // nur im Hintergrund: ist Kortex vorn, entsteht nichts (und der Überlauf verfällt)
  let { uhr, p } = planer({ regeln: { sammelfenster: 0 } });
  p.aufnehmen([E({})], e); uhr.t += 1;
  assert.equal(p.faellige(e, true).length, 0);
  p.aufnehmen([E({})], e); uhr.t += 1;
  assert.equal(p.faellige({ ...e, mitteilungenNurImHintergrund: false }, true).length, 1, "mit ausgeschaltetem Schalter auch bei Kortex vorn");
  // 6 verschiedene Gruppen in einer Minute: 4 + „Weitere 2 Mitteilungen“
  ({ uhr, p } = planer({ regeln: { sammelfenster: 0 } }));
  p.aufnehmen(["a", "b", "c", "d", "e", "f"].map((w) => E({ wer: `Claude Code · ${w}` })), e); uhr.t += 1;
  assert.equal(p.faellige(e, false).length, 4);
  uhr.t += 61_000;
  const rest = p.faellige(e, false);
  assert.deepEqual(rest.map((x) => x.text), ["Weitere 2 Mitteilungen in Kortex."]);
  // 5-s-Sperre: dieselbe Gruppe nicht zweimal im Abstand von Sekunden
  ({ uhr, p } = planer({ regeln: { sammelfenster: 0 } }));
  p.aufnehmen([E({})], e); uhr.t += 1;
  assert.equal(p.faellige(e, false).length, 1);
  p.aufnehmen([E({})], e); uhr.t += 1000;
  assert.equal(p.faellige(e, false).length, 0, "innerhalb von 5 s");
  p.aufnehmen([E({})], e); uhr.t += 5000;
  assert.equal(p.faellige(e, false).length, 1, "nach der Sperre");
  // gleiche Abweisung: 10 min Pause, andere Gründe sind andere Meldungen
  ({ uhr, p } = planer({ regeln: { sammelfenster: 0 } }));
  p.aufnehmen([E({ art: "abweisung", grund: "vertrauen" })], e); uhr.t += 1;
  assert.equal(p.faellige(e, false).length, 1);
  p.aufnehmen([E({ art: "abweisung", grund: "vertrauen" })], e); uhr.t += 10_000;
  assert.equal(p.faellige(e, false).length, 0);
  p.aufnehmen([E({ art: "abweisung", grund: "leseverbot" })], e); uhr.t += 1;
  assert.equal(p.faellige(e, false).length, 1);
  p.aufnehmen([E({ art: "abweisung", grund: "vertrauen" })], e); uhr.t += 601_000;
  assert.equal(p.faellige(e, false).length, 1, "nach der Pause");
});
test("Mitteilungs-Planer: Schalter, Sätze und Regeln sind die der Mac-App (Mitteilungen.swift)", () => {
  const swift = les("Sources/BrainCore/Mitteilungen.swift");
  // Art → Schalter (Swift artSchalter) = ART_SCHALTER ohne die null-Einträge
  const ausSwift = Object.fromEntries([...swift.matchAll(/"([a-z-]+)": "(mitteilungen\w+)"/g)].map((m) => [m[1], m[2]]));
  const unsere = Object.fromEntries(Object.entries(ART_SCHALTER).filter(([, v]) => v));
  assert.deepEqual(ausSwift, unsere);
  // Standardwerte der Schalter
  const std = standard();
  assert.deepEqual([std.mitteilungenNurImHintergrund, std.mitteilungenTon, std.mitteilungenPflege, std.mitteilungenKontingent], [true, false, false, true]);
  assert.match(swift, /nurImHintergrund = true\s/); assert.match(swift, /public var ton = false/); assert.match(swift, /public var pflege = false/); assert.match(swift, /public var kontingent = true/);
  assert.match(swift, /sammelfenster: TimeInterval = 5/); assert.match(swift, /maxProMinute = 4/); assert.match(swift, /abweisungsPause: TimeInterval = 600/); assert.match(swift, /burstSperre: TimeInterval = 5/);
  // jeder Satz (oder seine Teile, wo Swift sie zusammensetzt) steht wörtlich in Swift
  for (const t of ["eine Aufgabe", " Aufgaben", "angelegt.", "eine Notiz", " Notizen", "im Posteingang abgelegt.", "hat eine Aufgabe geändert.", "Aufgaben geändert.", "hat in einem gesperrten Vault gelesen. Das Leseverbot ist nicht eingeschaltet.", "wurde abgewiesen.", "-mal abgewiesen.",
    "Pflege fertig.", "Die Pflege lief nicht ganz durch.", "Sicherung: Die Fassungen auf zwei Geräten widersprechen sich. Löse den Konflikt im Studio.", "Die Online-Sicherung hat nicht geklappt.", "muss sich neu anmelden.",
    "hat 80 % des 5-Stunden-Kontingents verbraucht.", "hat das 5-Stunden-Kontingent aufgebraucht.", "hat 80 % des Wochen-Kontingents verbraucht.", "hat das Wochen-Kontingent aufgebraucht.", "hat fast das ganze Kontingent verbraucht.", "Es gibt Neues in Kortex.",
    "Eine weitere Mitteilung in Kortex.", "Mitteilungen in Kortex."]) assert.ok(swift.includes(t), `„${t}“ steht nicht in Mitteilungen.swift`);
  const gleich = [["ablage-aufgabe", null, 1, "hat eine Aufgabe angelegt."], ["ablage-aufgabe", null, 3, "hat 3 Aufgaben angelegt."], ["ablage-notiz", null, 2, "hat 2 Notizen im Posteingang abgelegt."], ["aenderung", null, 1, "hat eine Aufgabe geändert."], ["aenderung", null, 4, "hat 4 Aufgaben geändert."],
    ["abweisung", null, 1, "wurde abgewiesen."], ["abweisung", null, 4, "wurde 4-mal abgewiesen."], ["kontingent", "woche-100", 1, "hat das Wochen-Kontingent aufgebraucht."], ["kontingent", "x", 1, "hat fast das ganze Kontingent verbraucht."], ["unbekannt", null, 1, "Es gibt Neues in Kortex."]];
  for (const [art, grund, n, soll] of gleich) assert.equal(mi.satz(art, grund, n), soll);
  assert.equal(mi.zielFuer("ablage-aufgabe"), "aufgaben"); assert.equal(mi.zielFuer("ablage-notiz"), "posteingang"); assert.equal(mi.zielFuer("kontingent"), "aktivitaet");
  assert.ok(swift.includes("So sehen Mitteilungen von Kortex aus.") && mi.probeMitteilung().text === "So sehen Mitteilungen von Kortex aus.");
});
test("Mitteilungs-Einstellungen: aus einstellungen.json, kaputt/fehlend/falscher Typ → Standard", () => {
  const s = temp();
  assert.equal(mi.leseEinstellungen(s).mitteilungenAbgelegt, true);
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ mitteilungenAbgelegt: false, mitteilungenTon: true, mitteilungenKontingent: "nein", mitteilungenPflege: null }));
  assert.deepEqual([mi.leseEinstellungen(s).mitteilungenAbgelegt, mi.leseEinstellungen(s).mitteilungenTon, mi.leseEinstellungen(s).mitteilungenKontingent, mi.leseEinstellungen(s).mitteilungenPflege], [false, true, true, false]);
  writeFileSync(join(s, "einstellungen.json"), "{kaputt");
  assert.equal(mi.leseEinstellungen(s).mitteilungenAbgelegt, true);
  writeFileSync(join(s, "einstellungen.json"), "[1,2]");
  assert.equal(mi.leseEinstellungen(s).mitteilungenTon, false);
});
test("Mitteilungs-Leser: meldet nur, was nach dem Anlegen dazukommt, jede Kennung nur einmal, liest nur bei geänderter Datei", () => {
  const dateien = { k1: [{ id: "alt1" }, { id: "alt2" }] };
  let stand = 1, liest = 0;
  const leser = mi.erzeugeLeser({ support: "/x", leseEreignisse: (_s, k) => { liest++; return dateien[k] || []; }, protokollKennungen: () => Object.keys(dateien), dateiStand: () => String(stand) });
  assert.deepEqual(leser.neueEreignisse(), [], "was schon da war, wird nie gemeldet");
  const nach = liest;
  assert.deepEqual(leser.neueEreignisse(), []);
  assert.equal(liest, nach, "Datei unverändert: nicht neu gelesen");
  dateien.k1.push({ id: "neu1" }); stand++;
  assert.deepEqual(leser.neueEreignisse().map((e) => e.id), ["neu1"]);
  stand++; // Rotation o. Ä.: dieselben Ereignisse noch einmal gelesen → nie doppelt
  assert.deepEqual(leser.neueEreignisse(), []);
  dateien.k2 = [{ id: "n2" }]; stand++; // ein neuer Vault mit Protokoll
  assert.deepEqual(leser.neueEreignisse().map((e) => e.id), ["n2"]);
});

// ───────────── Erfassen ─────────────
test("Erfassen: Platzierung oben mittig (14 % Abstand, 48–180), immer ganz im sichtbaren Bereich — wie ErfassenPlatzierung (Swift)", () => {
  const g = { width: 560, height: 276 };
  assert.deepEqual(er.erfassenRahmen({ x: 0, y: 0, width: 1440, height: 900 }, g), { x: 440, y: 126, width: 560, height: 276 });
  assert.equal(er.erfassenRahmen({ x: 0, y: 0, width: 1440, height: 200 }, g).y, 0, "zu niedriger Bildschirm: das Fenster liegt trotzdem ganz im sichtbaren Bereich");
  assert.equal(er.erfassenRahmen({ x: 0, y: 0, width: 1440, height: 4000 }, g).y, 180, "höchstens 180");
  assert.equal(er.erfassenRahmen({ x: 0, y: 0, width: 1440, height: 100 }, g).y, 0, "nie unter dem Rand");
  const klein = er.erfassenRahmen({ x: 100, y: 50, width: 400, height: 300 }, g);
  assert.ok(klein.x >= 100 && klein.x + klein.width <= 500 + 160, "nie links vor dem Bereich");
  assert.equal(klein.x, 100);
  assert.deepEqual(er.erfassenRahmen({ x: -1920, y: 0, width: 1920, height: 1080 }, g), { x: -1920 + 680, y: 151, width: 560, height: 276 }, "zweiter Bildschirm links");
  // Maße wie ErfassenAnsicht (Swift)
  const a = les("Sources/BrainCore/Erfassen/ErfassenAnsicht.swift");
  assert.match(a, /breite: CGFloat = 560/); assert.match(a, /hoehe: CGFloat = 276/);
  assert.equal([er.BREITE, er.HOEHE].join("x"), "560x276");
  const platz = les("Sources/BrainCore/Erfassen/ErfassenPlatzierung.swift");
  assert.match(platz, /min\(180, max\(48, sichtbar\.height \* 0\.14\)\)/);
  assert.match(les("Sources/BrainCore/Erfassen/ErfassenModell.swift"), /hoechstTitel = 120/); assert.equal(er.MAX_TITEL, 120);
});
test("Erfassen: Eingabe aus der Seite wird geprüft (nie vertrauen)", () => {
  assert.equal(er.pruefeEingabe({ art: "aufgabe", text: "x" }).ok, true);
  for (const schlecht of [null, [], "x", { art: "x", text: "a" }, { art: "aufgabe", text: 5 }, { art: "aufgabe", text: "x".repeat(er.MAX_TEXT + 1) }, { art: "aufgabe", text: "a", prioritaet: "dringend" }, { art: "aufgabe", text: "a", faellig: "morgen" }, { art: "aufgabe", text: "a", faellig: "2026-1-1" }])
    assert.equal(er.pruefeEingabe(schlecht).ok, false, JSON.stringify(schlecht)?.slice(0, 60));
  assert.deepEqual(er.pruefeEingabe({ art: "notiz", text: "a", faellig: "2026-11-03", prioritaet: "hoch" }).wert, { art: "notiz", text: "a", prioritaet: "hoch", faellig: "2026-11-03", erkennePrioritaet: true, erkenneFaelligkeit: true });
});
test("Erfassen: Anfrage wie die Mac-App (Aufgabe: Kurzformen aus der Werkstatt-Logik, langer Titel; Notiz: Posteingang)", () => {
  const bau = (e, heute = "2026-11-02") => er.baueAnfrage(er.pruefeEingabe(e).wert, { liesKurzformen, heute });
  assert.deepEqual(bau({ art: "aufgabe", text: "Steuer machen morgen !hoch" }), { pfad: "/api/aufgaben", koerper: { titel: "Steuer machen", prioritaet: "hoch", faellig: "2026-11-03" } });
  assert.deepEqual(bau({ art: "aufgabe", text: "Steuer machen morgen !hoch\nzweite Zeile" }).koerper, { titel: "Steuer machen", text: "zweite Zeile", prioritaet: "hoch", faellig: "2026-11-03" });
  // von Hand gewählt hat Vorrang; „keine“ = kein Datum; Kurzform als Text lassen
  assert.deepEqual(bau({ art: "aufgabe", text: "Steuer morgen !hoch", prioritaet: "niedrig", faellig: "keine" }).koerper, { titel: "Steuer", prioritaet: "niedrig" });
  assert.deepEqual(bau({ art: "aufgabe", text: "Steuer morgen !hoch", faellig: "2026-12-24" }).koerper.faellig, "2026-12-24");
  assert.deepEqual(bau({ art: "aufgabe", text: "Steuer morgen !hoch", erkennePrioritaet: false, erkenneFaelligkeit: false }).koerper, { titel: "Steuer morgen !hoch" });
  // langer Gedanke wird nicht abgeschnitten: gekürzter Titel, ganze Zeile im Text
  const lang = ("wort ".repeat(40)).trim();
  const l = bau({ art: "aufgabe", text: lang }).koerper;
  assert.ok(Array.from(l.titel).length <= 120 && l.titel.endsWith("…")); assert.equal(l.text, lang);
  // Notiz und Fehler
  assert.deepEqual(bau({ art: "notiz", text: "  Ein Gedanke zweite Zeile  " }), { pfad: "/api/merken", koerper: { text: "Ein Gedanke\nzweite Zeile" } });
  assert.deepEqual(bau({ art: "aufgabe", text: "   " }), { fehler: "Schreib erst etwas auf." });
  assert.deepEqual(bau({ art: "aufgabe", text: "!hoch !!" }).koerper.titel, "!hoch !!", "besteht die Zeile nur aus Prioritätswörtern, bleibt sie der Titel");
});
test("Erfassen: Antworten der Werkstatt → Meldung (gespeichert, nur ansehen, Fehler); Hinweise vor dem Klick", () => {
  assert.deepEqual(er.antwortAus({ status: 200, json: { pfad: "a/b.md" } }, "Privat"), { ok: true, vault: "Privat" });
  assert.deepEqual(er.antwortAus({ status: 409, json: { art: "nicht-vertraut", fehler: "…" } }, "Privat"), { ok: false, nichtVertraut: true, text: "„Privat“ ist nur zum Ansehen freigegeben. Bestätige den Vault im Studio unter Einstellungen, dann kannst du hier speichern." });
  assert.equal(er.antwortAus({ status: 400, json: { fehler: "Titel fehlt." } }, "P").text, "Titel fehlt.");
  assert.equal(er.antwortAus({ status: 500, json: null }, "P").text, "Das Speichern hat nicht geklappt.");
  assert.equal(er.antwortAus({ status: 200, json: {} }, "P").ok, false);
  assert.equal(er.hinweisFuerVault({ name: null, erlaubt: false }), er.KEIN_VAULT);
  assert.equal(er.hinweisFuerVault({ name: "V", erlaubt: true }), null);
  assert.match(er.hinweisFuerVault({ name: "V", erlaubt: false }), /nur zum Ansehen freigegeben/);
  const swift = les("Sources/BrainCore/Erfassen/ErfassenModell.swift") + les("Sources/BrainCore/Erfassen/ErfassenSpeicher.swift");
  for (const t of ["ist nur zum Ansehen freigegeben. Bestätige den Vault im Studio unter Einstellungen, dann kannst du hier speichern.", "Kein Vault gewählt. Wähle in Kortex einen Vault aus (Menü → Vault wechseln …).", "Schreib erst etwas auf.", "Die Aufgabe braucht einen Titel."]) assert.ok(swift.includes(t), t);
  assert.ok(swift.includes('"/api/aufgaben"') && swift.includes('"/api/merken"'));
});
test("Erfassen: die Art wird in schnell-erfassen.json gemerkt (andere Schlüssel der Datei bleiben), kaputt → Aufgabe", () => {
  const s = temp();
  assert.equal(er.leseArt(s), "aufgabe");
  writeFileSync(join(s, "schnell-erfassen.json"), JSON.stringify({ kuerzel: { taste: 49 } }));
  assert.equal(er.merkeArt(s, "notiz"), true);
  assert.equal(er.leseArt(s), "notiz");
  assert.deepEqual(JSON.parse(readFileSync(join(s, "schnell-erfassen.json"), "utf8")), { kuerzel: { taste: 49 }, art: "notiz" });
  assert.equal(er.merkeArt(s, "x"), false);
  writeFileSync(join(s, "schnell-erfassen.json"), "{kaputt");
  assert.equal(er.leseArt(s), "aufgabe");
});

// ───────────── Symbole und Glas ─────────────
test("App-Symbole: dieselben fünf wie die Mac-App (AppSymbol.swift, Vertrag), Dateien da (.png, .ico, Tray), Auswahl aus einstellungen.json", async () => {
  const swift = les("Sources/BrainCore/AppSymbol.swift");
  const faelle = /case ([a-z, ]+)\n/.exec(swift)[1].split(",").map((x) => x.trim());
  assert.deepEqual(sy.APP_SYMBOLE, faelle);
  assert.equal(sy.SCHLUESSEL, "appSymbol");
  for (const n of sy.APP_SYMBOLE) {
    const w = sy.symbolPfade(n, { plattform: "win32" }), l = sy.symbolPfade(n, { plattform: "linux" });
    assert.ok(w.fenster.endsWith(`${n}.ico`) && existsSync(w.fenster) && existsSync(w.tray));
    assert.ok(l.fenster.endsWith(`${n}.png`) && existsSync(l.fenster));
  }
  assert.equal(sy.symbolPfade("lila"), null);
  assert.equal(sy.symbolPfade("dunkel", { ordner: temp() }), null, "Datei fehlt → null");
  const s = temp();
  assert.equal(sy.leseAppSymbol(s), "standard");
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ appSymbol: "smaragd" }));
  assert.equal(sy.leseAppSymbol(s), "smaragd");
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ appSymbol: "lila" }));
  assert.equal(sy.leseAppSymbol(s), "standard");
  // das Skript, das die Dateien erzeugt, prüft sie (PNG-Köpfe, ICO-Verzeichnis)
  const { pruefe, baueIco, leseIco } = await laden("scripts/erzeuge-electron-symbole.mjs");
  assert.deepEqual(pruefe(), []);
  const png = readFileSync(join(sy.ORDNER, "standard.png"));
  const v = leseIco(baueIco([{ px: 16, png }, { px: 256, png }]));
  assert.deepEqual(v.map((b) => b.breite), [16, 256]);
  assert.equal(leseIco(Buffer.from("kein ico")), null);
});
test("Glas: nur Windows 11 22H2+ (Build 22621); Wunsch aus einstellungen.json (Standard an); Skript setzt data-glas-moeglich und data-glas", () => {
  assert.equal(gl.glasMoeglich({ plattform: "win32", release: "10.0.22631" }), true);
  assert.equal(gl.glasMoeglich({ plattform: "win32", release: "10.0.22621" }), true);
  assert.equal(gl.glasMoeglich({ plattform: "win32", release: "10.0.22000" }), false, "Windows 11 21H2 hat kein Fenstermaterial über die Electron-Schnittstelle");
  assert.equal(gl.glasMoeglich({ plattform: "win32", release: "10.0.19045" }), false, "Windows 10");
  assert.equal(gl.glasMoeglich({ plattform: "linux", release: "6.8.0" }), false);
  assert.equal(gl.glasMoeglich({ plattform: "win32", release: "kaputt" }), false);
  const s = temp();
  assert.equal(gl.leseGlasWunsch(s), true);
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ seitenleisteDurchscheinend: false }));
  assert.equal(gl.leseGlasWunsch(s), false);
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ seitenleisteDurchscheinend: "nein" }));
  assert.equal(gl.leseGlasWunsch(s), true, "kein Boolean → an (wie SeitenleisteGlas.lies)");
  assert.equal(gl.glasSkript({ moeglich: false, an: true }), null);
  assert.match(gl.glasSkript({ moeglich: true, an: true }), /glasMoeglich='1';r\.dataset\.glas='1'/);
  assert.match(gl.glasSkript({ moeglich: true, an: false }), /delete r\.dataset\.glas/);
  assert.equal(gl.SCHLUESSEL, "seitenleisteDurchscheinend");
  assert.match(les("Sources/BrainCore/SeitenleisteGlas.swift"), /seitenleisteDurchscheinend/);
});
