// Konflikt-Ansicht über die Werkstatt, Teil 3: Routen (Rückgängig, neu entscheiden) und die gemeinsame Sperre. Hilfen: konflikt-werkstatt-hilfe.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, g, pfad, erzeugeHandler, kennung, wirft, mitRemote, commitIn, lies, loesen, konfliktAufbauen } from "./konflikt-werkstatt-hilfe.mjs";

test("Rückgängig und neu entscheiden über die Routen; Methoden und Fehler der Routen", async () => {
  const leer = mitRemote();
  const hl = erzeugeHandler({ vault: leer.a });
  const rufe = async (methode, p) => { const r = await hl({ methode, pfad: p, query: null }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  const k = await konfliktAufbauen();
  const hk = erzeugeHandler({ vault: k.a });
  const rk = async (methode, p, daten) => {
    const r = await hk({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* egal */ }
    return { status: r.status, j };
  };
  assert.equal((await rufe("GET", "/api/git/konflikt")).j.aktiv, false);
  const r0 = await rk("GET", "/api/git/konflikt");
  let r = r0;
  assert.equal(r.status, 200); assert.equal(r.j.dateien[0].andere.text, "# Start\nVersion von B\n");
  assert.equal((await rk("GET", "/api/git/konflikt/loesen")).status, 405);
  assert.equal((await rk("GET", "/api/git/konflikt/rueckgaengig")).status, 405);
  assert.equal((await rk("POST", "/api/git/konflikt/loesen")).status, 400);
  r = await rk("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "andere" }], gesehen: { meine: r0.j.meine, andere: r0.j.andere } });
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nVersion von B\n");
  r = await rk("GET", "/api/git/konflikt");
  assert.equal(r.j.aktiv, false); assert.equal(r.j.rueckgaengig.moeglich, true);
  r = await rk("POST", "/api/git/konflikt/rueckgaengig");
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nVersion von A\n");
  // der gemerkte Stand kommt aus dem Support-Ordner; die Oberfläche schickt keinen
  r = await rk("GET", "/api/git/konflikt");
  assert.equal(r.j.aktiv, true); assert.equal(r.j.modus, "stand"); assert.equal(r.j.haelt, true); assert.equal(r.j.dateien[0].andere.text, "# Start\nVersion von B\n");
  assert.equal((await rk("POST", "/api/git/konflikt", {})).status, 405);
  // solange der Stand wartet, sendet auch der Studio-Abgleich nichts: 409 mit dem Hinweis auf den Konflikt
  r = await rk("POST", "/api/git/sync", {});
  assert.equal(r.status, 409); assert.equal(r.j.haelt, true); assert.equal(r.j.konflikt, true);
  r = await rk("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "text", text: "# Start\nzusammen\n" }], gesehen: { meine: r0.j.meine, andere: r0.j.andere } });
  assert.equal(r.status, 200); assert.equal(lies(k.a, "start.md"), "# Start\nzusammen\n");
  assert.equal((await rk("POST", "/api/git/konflikt/rueckgaengig")).status, 200);
  assert.equal((await rk("POST", "/api/git/konflikt/rueckgaengig")).status, 409, "nur einmal");
});

test("Gemeinsame Sperre: solange der Kern-Hintergrund (oder ein anderer Prozess) abgleicht, wartet der Studio-Abgleich — und umgekehrt", async () => {
  const { a, v } = mitRemote();
  const support = process.env.BRAIN_APP_SUPPORT;
  const datei = join(support, "backup", `${kennung(a)}.sperre`);
  mkdirSync(join(support, "backup"), { recursive: true });
  writeFileSync(datei, JSON.stringify({ pid: process.pid, zeit: Date.now(), art: "sicherung", marke: "kern" }));
  const e = await wirft(v.gitSync({}));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "laeuft");
  assert.equal((await wirft(loesen(v, []))).status, 409);
  assert.equal(existsSync(datei), true, "eine fremde Sperre wird nie freigegeben");
  // verwaist (Prozess nicht mehr da) blockiert nicht
  writeFileSync(datei, JSON.stringify({ pid: 2 ** 22 - 3, zeit: Date.now(), art: "sicherung", marke: "tot" }));
  commitIn(a, "neu.md", "# Neu\n", "neu");
  const r = await v.gitSync({});
  assert.equal(r.ergebnis, "gesendet");
  assert.equal(existsSync(datei), false, "der Studio-Abgleich gibt seine Sperre wieder frei");
});

