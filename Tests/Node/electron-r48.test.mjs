// R4-8 (Windows/Linux-Beta-Rest), Teile der Electron-Hülle ohne Electron: Tray-Zeile „Aufgaben offen“, Linux-Infobereich erkennen, Vault-Name in Mitteilungen.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const laden = (rel) => import(pathToFileURL(join(W, rel)).href);
const { aufgabenText, aufgabenZaehler, baueTrayVorlage, trayZustand, linuxTraySichtbar } = await laden("electron/tray.mjs");
const { systemMitteilung } = await laden("electron/mitteilungen.mjs");

test("Tray: Aufgaben-Zeile wie in der Menüleiste der Mac-App, nur mit offenen Aufgaben", () => {
  assert.equal(aufgabenText({ offen: 3, ueberfaellig: 1 }), "3 Aufgaben offen · 1 überfällig");
  assert.equal(aufgabenText({ offen: 1, ueberfaellig: 0 }), "1 Aufgabe offen");
  assert.equal(aufgabenText({ offen: 0, ueberfaellig: 0 }), null);
  assert.equal(aufgabenText(null), null);
  const liste = { aufgaben: [{ status: "offen", faellig: "2026-01-01" }, { status: "erledigt", faellig: "2026-01-01" }, { status: "laeuft" }, { status: "offen", faellig: "2099-01-01" }] };
  assert.deepEqual(aufgabenZaehler(liste, "2026-06-01"), { offen: 3, ueberfaellig: 1 });
  assert.equal(aufgabenZaehler({}), null);
});

test("Tray-Vorlage: die Zeile steht im Kopf, öffnet das Aufgaben-Board und fehlt ohne Vault oder ohne offene Aufgaben", () => {
  const gewaehlt = [];
  const z = trayZustand({ info: { vault: "/v", name: "V" }, aktivitaet: { ungelesen: 0 }, rueckfragen: null, aufgaben: { aufgaben: [{ status: "offen" }, { status: "offen", faellig: "2000-01-01" }] } });
  const vorlage = baueTrayVorlage(z, (a) => gewaehlt.push(a));
  const zeile = vorlage.find((x) => x.id === "tray-aufgaben");
  assert.equal(zeile.label, "2 Aufgaben offen · 1 überfällig");
  zeile.click();
  assert.deepEqual(gewaehlt, [{ befehl: "aufgaben" }]);
  assert.ok(vorlage.findIndex((x) => x.id === "tray-aufgaben") < vorlage.findIndex((x) => x.id === "tray-studio"));
  const keine = baueTrayVorlage(trayZustand({ info: { vault: "/v", name: "V" }, aufgaben: { aufgaben: [{ status: "erledigt" }] } }), () => {});
  assert.ok(!keine.some((x) => x.id === "tray-aufgaben"));
  const ohneVault = baueTrayVorlage(trayZustand({ info: {}, aufgaben: { aufgaben: [{ status: "offen" }] } }), () => {});
  assert.ok(!ohneVault.some((x) => x.id === "tray-aufgaben"));
});

test("Linux-Infobereich: Watcher da = sichtbar; gdbus fehlt → dbus-send; beide fehlen oder Watcher fehlt → nein", async () => {
  const aus = (antworten) => (programm, args, o, rueck) => { const a = antworten[programm]; if (a === undefined) return rueck(Object.assign(new Error("ENOENT"), { code: "ENOENT" })); rueck(null, a); };
  assert.equal(await linuxTraySichtbar({ ausfuehren: aus({ gdbus: "(true,)\n" }) }), true);
  assert.equal(await linuxTraySichtbar({ ausfuehren: aus({ gdbus: "(false,)\n" }) }), false);
  assert.equal(await linuxTraySichtbar({ ausfuehren: aus({ "dbus-send": "method return time=1\n   boolean true\n" }) }), true);
  assert.equal(await linuxTraySichtbar({ ausfuehren: aus({}) }), false);
  assert.equal(await linuxTraySichtbar({ ausfuehren: () => { throw new Error("kaputt"); } }), false);
});

test("Mitteilung: macOS zeigt den Vault-Namen als Untertitel, Windows und Linux davor im Text; ohne Namen bleibt der Text, wie er ist", () => {
  const m = { titel: "Claude Code", untertitel: "Mein Vault", text: "hat 2 Aufgaben angelegt." };
  assert.deepEqual(systemMitteilung(m, "darwin"), { title: "Claude Code", subtitle: "Mein Vault", body: "hat 2 Aufgaben angelegt." });
  for (const p of ["win32", "linux"]) assert.deepEqual(systemMitteilung(m, p), { title: "Claude Code", body: "Mein Vault: hat 2 Aufgaben angelegt." });
  assert.deepEqual(systemMitteilung({ titel: "Kortex", untertitel: null, text: "x" }, "linux"), { title: "Kortex", body: "x" });
});

const { trayHinweisNoetig, TRAY_HINWEIS } = await laden("electron/tray.mjs");
test("Linux ohne Infobereich: der Hinweis kommt einmal, nur unter Linux, nie beim Beenden aus dem Menü, im Test oder bei ausdrücklichem Verbot", () => {
  assert.equal(trayHinweisNoetig({ plattform: "linux" }), true);
  assert.equal(trayHinweisNoetig({ plattform: "linux", schonGezeigt: true }), false);
  assert.equal(trayHinweisNoetig({ plattform: "linux", beendet: true }), false);
  assert.equal(trayHinweisNoetig({ plattform: "linux", testmodus: true }), false);
  assert.equal(trayHinweisNoetig({ plattform: "linux", erzwungen: true }), false);
  for (const p of ["win32", "darwin"]) assert.equal(trayHinweisNoetig({ plattform: p }), false);
  assert.match(TRAY_HINWEIS.text, /AppIndicator/);
});
