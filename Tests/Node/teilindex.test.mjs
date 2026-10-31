// Teil-Index der Oberfläche (notizen.mjs teil, vault.mjs teilIndex, Routen /api/index und /api/teilindex):
// Die Zeilen, die der Teil-Index liefert, sind GENAU die, die ein vollständiger Lauf für diese Dateien ergäbe; wo das nicht gesichert ist, kommt { voll: true }.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, utimesSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const alt = (abs, s = 3600) => { const t = new Date(Date.now() - s * 1000); utimesSync(abs, t, t); };
function vaultMit(inbox = true) {
  const d = tmp();
  if (inbox) schreibe(d, "00_inbox/lose.md", "# Lose\n\nEine lose Idee.\n");
  schreibe(d, "09_wiki/firma/thema_a.md", "---\nname: a\ntyp: thema\nstand: 2026-10-01\nverwandt: \"[[entitaet_b]]\"\n---\n# Thema A\n\nText zu A. [[entitaet_b]]\n");
  schreibe(d, "09_wiki/firma/entitaet_b.md", "---\nname: b\ntyp: entitaet\naliases: [Bee]\n---\n# Entität B\n\nVerweist auf [[thema_a]].\n");
  schreibe(d, "projekte/frei.md", "# Frei\n\nNotiz ohne Typ. [[Bee]]\n");
  schreibe(d, "projekte/bild.png", "kein Text");
  for (const r of ["00_inbox/lose.md", "09_wiki/firma/thema_a.md", "09_wiki/firma/entitaet_b.md", "projekte/frei.md"]) try { alt(join(d, r)); } catch { /* ohne Inbox */ }
  return d;
}
const zeile = (liste, p) => liste.find((n) => n.pfad === p);
// Was ein vollständiger Lauf (frisches Vault-Objekt, kein Teilstand) für denselben Ordner ergibt
async function voll(d) {
  const f = oeffneVault(d);
  const [n, t, a] = [await f.notizen(), await f.typen(), await f.ansichten()];
  return { notizen: n.notizen, typen: t, ansichten: a, baum: f.baum().eintraege };
}

test("Teil-Index: ohne vorherigen Vollauf, bei unbekannten, neuen, entfernten Pfaden, Ordnern und ungültigen Eingaben → voll", async () => {
  const d = vaultMit();
  const v = oeffneVault(d);
  assert.deepEqual(await v.teilIndex(["09_wiki/firma/thema_a.md"]), { voll: true }, "noch kein Vollauf");
  await v.notizen();
  for (const e of [null, undefined, "x", [], [1], ["../draussen.md"], ["gibt-es-nicht.md"], ["09_wiki"], ["09_wiki/firma"], new Array(201).fill("projekte/frei.md")]) {
    assert.deepEqual(await v.teilIndex(e), { voll: true }, JSON.stringify(e)?.slice(0, 40));
  }
  schreibe(d, "projekte/neu.md", "# Neu\n");
  assert.deepEqual(await v.teilIndex(["projekte/neu.md"]), { voll: true }, "neue Datei: andere Links könnten sich neu auflösen");
  const r = await v.teilIndex(["projekte/frei.md"]);
  assert.equal(r.voll, false, "bekannte, unveränderte Datei geht");
  rmSync(join(d, "projekte/frei.md"));
  assert.deepEqual(await v.teilIndex(["projekte/frei.md"]), { voll: true }, "entfernt");
  assert.deepEqual(await v.teilIndex(["09_wiki/firma/thema_a.md", "projekte/neu.md"]), { voll: true }, "ein unbekannter Pfad genügt");
});

test("Teil-Index: Inhalt, Typ und Verknüpfungen geändert → Zeilen, Typen, Ansichten und Baum-Eintrag identisch zum Vollauf", async () => {
  const d = vaultMit();
  const v = oeffneVault(d);
  await v.notizen();
  const a = "09_wiki/firma/thema_a.md";
  // 1) nur Fließtext
  writeFileSync(join(d, a), "---\nname: a\ntyp: thema\nstand: 2026-10-01\nverwandt: \"[[entitaet_b]]\"\n---\n# Thema A\n\nGanz anderer Text, deutlich länger als vorher, damit sich die Größe ändert. [[entitaet_b]]\n");
  let r = await v.teilIndex([a]);
  assert.equal(r.voll, false);
  let ref = await voll(d);
  assert.deepEqual(r.notizen, [zeile(ref.notizen, a)]);
  assert.deepEqual(r.baum, [ref.baum.find((e) => e.pfad === a)]);
  assert.deepEqual(r.typen, ref.typen);
  assert.deepEqual(r.ansichten, ref.ansichten);
  assert.match(r.notizen[0].vorschau, /Ganz anderer Text/);
  // 2) Typ gewechselt und neuer Link (Vault hat einen Posteingang → bleibt ein Teil-Index)
  writeFileSync(join(d, a), "---\nname: a\ntyp: prozess\nstand: 2026-10-01\n---\n# Thema A\n\nJetzt auch [[lose]] und [[projekte/frei]] und [[gibt-es-nicht]].\n");
  r = await v.teilIndex([a]);
  assert.equal(r.voll, false);
  ref = await voll(d);
  assert.deepEqual(r.notizen, [zeile(ref.notizen, a)]);
  assert.deepEqual(r.notizen[0].links.sort(), ["00_inbox/lose.md", "projekte/frei.md"]);
  assert.deepEqual(r.typen, ref.typen);
  assert.ok(r.typen.typen.some((t) => t.name === "prozess"), "neuer Typ erscheint in den Typen");
  // 3) zwei Dateien in einem Aufruf, davon eine Nicht-Notiz (nur Baum)
  writeFileSync(join(d, "projekte/frei.md"), "# Frei\n\nMehr Text. [[Bee]] [[Bee]]\n");
  writeFileSync(join(d, "projekte/bild.png"), "kein Text, jetzt länger");
  r = await v.teilIndex(["projekte/frei.md", "projekte/bild.png"]);
  assert.equal(r.voll, false);
  ref = await voll(d);
  assert.deepEqual(r.notizen, [zeile(ref.notizen, "projekte/frei.md")]);
  assert.deepEqual(r.baum.map((e) => e.pfad), ["projekte/frei.md", "projekte/bild.png"]);
  assert.equal(r.baum[1].groesse, Buffer.byteLength("kein Text, jetzt länger"));
  assert.deepEqual(await v.teilIndex(["projekte/bild.png"]).then((x) => ({ voll: x.voll, notizen: x.notizen, typen: x.typen })), { voll: false, notizen: [], typen: undefined }, "nur Nicht-Notizen: keine Zeilen, keine Typen");
  // 4) ein späterer Vollauf auf demselben Objekt stimmt weiter
  assert.deepEqual((await v.notizen()).notizen.map((n) => n.pfad).sort(), ref.notizen.map((n) => n.pfad).sort());
});

test("Teil-Index: Titel- oder Alias-Änderung → voll (andere Notizen lösen ihre Links neu auf); danach geht es wieder inkrementell", async () => {
  const d = vaultMit();
  const v = oeffneVault(d);
  await v.notizen();
  const b = "09_wiki/firma/entitaet_b.md";
  writeFileSync(join(d, b), "---\nname: b\ntyp: entitaet\naliases: [Bee]\n---\n# Ganz neuer Titel\n\nVerweist auf [[thema_a]].\n");
  assert.deepEqual(await v.teilIndex([b]), { voll: true }, "Titel geändert");
  await v.notizen(); // die Oberfläche lädt dann alles → neuer Grundstand
  writeFileSync(join(d, b), "---\nname: b\ntyp: entitaet\naliases: [Bee, Bienchen]\n---\n# Ganz neuer Titel\n\nVerweist auf [[thema_a]].\n");
  assert.deepEqual(await v.teilIndex([b]), { voll: true }, "Alias geändert");
  await v.notizen();
  writeFileSync(join(d, b), "---\nname: b\ntyp: entitaet\naliases: [Bee, Bienchen]\n---\n# Ganz neuer Titel\n\nNur Text geändert.\n");
  const r = await v.teilIndex([b]);
  assert.equal(r.voll, false);
  const ref = await voll(d);
  assert.deepEqual(r.notizen, [zeile(ref.notizen, b)]);
});

test("Teil-Index: Vault ohne Posteingang — Link- oder Generiert-Änderung → voll (der Bereich anderer Notizen hängt an den Rückverweisen), sonst inkrementell", async () => {
  const d = vaultMit(false);
  const v = oeffneVault(d);
  await v.notizen();
  const f = "projekte/frei.md";
  writeFileSync(join(d, f), "# Frei\n\nAnderer Text ohne Link-Änderung. [[Bee]]\n");
  assert.equal((await v.teilIndex([f])).voll, false);
  writeFileSync(join(d, f), "# Frei\n\nJetzt ein anderer Link. [[thema_a]]\n");
  assert.deepEqual(await v.teilIndex([f]), { voll: true });
});

test("Teil-Index: zwei Aufrufe nacheinander (zweite Änderung derselben Datei) und der Zustand nach dem Teil-Index stimmen mit dem Vollauf überein", async () => {
  const d = vaultMit();
  const v = oeffneVault(d);
  await v.notizen();
  const a = "09_wiki/firma/thema_a.md";
  for (const [i, extra] of ["eins", "zwei zwei", "drei drei drei"].entries()) {
    writeFileSync(join(d, a), `---\nname: a\ntyp: thema\n---\n# Thema A\n\n${extra} [[entitaet_b]]\n`);
    const t = new Date(Date.now() - (3000 - i) * 1000); utimesSync(join(d, a), t, t);
    const r = await v.teilIndex([a]);
    assert.equal(r.voll, false);
    assert.match(r.notizen[0].vorschau, new RegExp(extra));
  }
  const ref = await voll(d);
  assert.deepEqual((await v.notizen()).notizen.sort((x, y) => (x.pfad < y.pfad ? -1 : 1)), ref.notizen.sort((x, y) => (x.pfad < y.pfad ? -1 : 1)));
});

// ───────────────────────────── Routen ─────────────────────────────
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};

test("Routen: GET /api/index = notizen + typen + ansichten aus einem Lauf; POST /api/teilindex; Methoden und Eingaben", async () => {
  const d = vaultMit();
  const rufe = aufruf(erzeugeHandler({ vault: d }));
  const [n, t, a] = [await rufe("GET", "/api/notizen"), await rufe("GET", "/api/typen"), await rufe("GET", "/api/ansichten")];
  const i = await rufe("GET", "/api/index");
  assert.equal(i.status, 200);
  assert.deepEqual(i.j, { notizen: n.j.notizen, typen: t.j, ansichten: a.j.ansichten ? a.j : a.j, aufgabenOrdner: n.j.aufgabenOrdner, inboxOrdner: n.j.inboxOrdner });
  assert.equal((await rufe("POST", "/api/index", {})).status, 405);

  const bef = "09_wiki/firma/thema_a.md";
  writeFileSync(join(d, bef), "---\nname: a\ntyp: thema\n---\n# Thema A\n\nNeuer Text. [[entitaet_b]]\n");
  const r = await rufe("POST", "/api/teilindex", { pfade: [bef] });
  assert.equal(r.status, 200);
  assert.equal(r.j.voll, false);
  assert.match(r.j.notizen[0].vorschau, /Neuer Text/);
  assert.equal(r.j.aufgabenOrdner, n.j.aufgabenOrdner);
  assert.equal((await rufe("GET", "/api/teilindex")).status, 405);
  assert.equal((await rufe("POST", "/api/teilindex")).status, 400, "ohne Inhalt");
  assert.deepEqual((await rufe("POST", "/api/teilindex", { pfade: "x" })).j, { voll: true });
  assert.deepEqual((await rufe("POST", "/api/teilindex", {})).j, { voll: true });
  assert.deepEqual((await rufe("POST", "/api/teilindex", { pfade: ["../../etc/passwd"] })).j, { voll: true }, "Pfade außerhalb des Vaults werden nie gelesen");
});
