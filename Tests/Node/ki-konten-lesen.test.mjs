// KI-Konten: Lesen ist rein lesend. GET /api/ki/konten (und das Bereit-Signal des Frag-Felds) legt nie ein Konto an, gleicht nichts ab und ändert keine Datei im
// Support-Ordner — neu erkannte Konten stehen nur unter `neu` („neu, noch nicht eingetragen“) und kommen erst durch den ausdrücklichen Abgleich
// (POST /api/ki/konten/abgleich) in die Liste, mit der Regel für neue Konten (gesperrt). Nur Wegwerf-Orte unter dem Temp-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const claudeProfil = (home, name) => { const p = join(home, `.claude-${name}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}\n"); return realpathSync(p); };
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
// Fingerabdruck des ganzen Support-Ordners (Pfad + Inhalt + Größe jeder Datei): GET darf daran nichts ändern
function abdruck(ordner) {
  const aus = {};
  const geh = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { aus[`${r}/`] = "ordner"; geh(p, r); }
      else aus[r] = `${statSync(p).size}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`;
    }
  };
  geh(ordner, "");
  return aus;
}
const listenHash = (support) => { try { return createHash("sha256").update(readFileSync(K.kontenPfad(support))).digest("hex"); } catch { return null; } };

function aufbau() {
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const v1 = neuesVault();
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "V1", pfad: v1, farbe: "#5B8DEF" }], aktiv: v1 }));
  const a = claudeProfil(home, "a");
  const rufe = aufruf(erzeugeHandler({ vault: v1, vaultOptionen: { support }, kontenHome: home }));
  return { home, support, v1, a, rufe };
}

test("GET /api/ki/konten ohne Liste: legt nichts an, ändert keine Datei; die erkannten Konten stehen unter `neu`", async () => {
  const { support, rufe } = aufbau();
  const vorher = abdruck(support);
  for (let i = 0; i < 3; i++) {
    const r = await rufe("GET", "/api/ki/konten");
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.zustand, "fehlt");
    assert.deepEqual(r.j.konten, []);
    assert.ok(r.j.neu.some((k) => k.programm === "claude" && /claude-a/.test(k.ordner)), JSON.stringify(r.j.neu));
  }
  assert.deepEqual(abdruck(support), vorher, "kein Konto, keine Liste, keine Spur im Support-Ordner");
  assert.equal(listenHash(support), null);
});

test("GET ändert ki-konten.json nie (Hash vorher/nachher); ein neu erkanntes Konto ist nur „neu“ — erst der Abgleich trägt es ein (gesperrt)", async () => {
  const { home, support, v1, a, rufe } = aufbau();
  // der ausdrückliche Abgleich legt die Liste an (Migration: ohne Verbindung bleibt alles gesperrt)
  let r = await rufe("POST", "/api/ki/konten/abgleich");
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.zustand, "ok");
  assert.deepEqual(r.j.neu, [], "nach dem Abgleich ist nichts mehr neu");
  const ida = r.j.konten.find((k) => k.pfad === a).id; assert.ok(ida);
  const h0 = listenHash(support), alle0 = abdruck(support);
  // Lesen verändert nichts, auch nicht oft hintereinander
  for (let i = 0; i < 3; i++) { r = await rufe("GET", "/api/ki/konten"); assert.equal(r.status, 200); assert.deepEqual(r.j.neu, []); }
  assert.equal(listenHash(support), h0);
  // ein zweites Konto taucht auf (Ordner angelegt) und ein zweiter Vault ist in der App-Liste
  const b = claudeProfil(home, "b");
  const v2 = neuesVault();
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "V1", pfad: v1, farbe: "#5B8DEF" }, { name: "V2", pfad: v2, farbe: "#5B8DEF" }], aktiv: v1 }));
  const vorher = abdruck(support);
  for (let i = 0; i < 3; i++) {
    r = await rufe("GET", "/api/ki/konten");
    assert.equal(r.j.zustand, "ok");
    assert.equal(r.j.konten.length, 1, "das neue Konto steht noch nicht in der Liste");
    assert.deepEqual(r.j.neu.map((k) => k.ordner.replace(/^.*\//, "")), [".claude-b"], "… sondern wird nur als neu gemeldet");
    assert.equal(r.j.vaults.find((v) => v.pfad === v2).neueKonten, "gesperrt", "ein Vault, der noch nicht in der Liste steht, gilt als gesperrt — ohne einen Eintrag zu schreiben");
  }
  assert.equal(listenHash(support), h0, "ki-konten.json unverändert");
  assert.deepEqual(abdruck(support), vorher, "der ganze Support-Ordner unverändert");
  assert.equal(Object.keys(K.liesKonten(support).daten.vaults).length, 1, "kein Eintrag für den zweiten Vault angelegt");
  assert.ok(alle0 && Object.keys(alle0).length > 0);
  // Abgleich auf ausdrücklichen Wunsch: das neue Konto kommt mit der Regel für neue Konten (gesperrt) in die Liste, der zweite Vault auch
  r = await rufe("POST", "/api/ki/konten/abgleich");
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.konten.length, 2);
  assert.deepEqual(r.j.neu, []);
  const idb = r.j.konten.find((k) => k.pfad === b).id;
  assert.equal(r.j.zugriff[idb][v1], "gesperrt");
  // und danach ist Lesen wieder rein lesend
  const h1 = listenHash(support);
  assert.notEqual(h1, h0);
  r = await rufe("GET", "/api/ki/konten");
  assert.deepEqual(r.j.neu, []);
  assert.equal(listenHash(support), h1);
});

test("Das Bereit-Signal des Frag-Felds (GET /api/frage/bereit) legt keine Liste an; „Liste nicht verfügbar“ statt eines stillen Abgleichs", async () => {
  const { support, rufe } = aufbau();
  const vorher = abdruck(support);
  const r = await rufe("GET", "/api/frage/bereit");
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.kontenDefekt, true);
  assert.deepEqual(r.j.konten, []);
  assert.deepEqual(abdruck(support), vorher, "nichts angelegt");
  // nach dem ausdrücklichen Abgleich ist die Liste da; das Bereit-Signal liest sie nur
  await rufe("POST", "/api/ki/konten/abgleich");
  const h = listenHash(support);
  const r2 = await rufe("GET", "/api/frage/bereit");
  assert.equal(r2.j.kontenDefekt, false);
  assert.equal(listenHash(support), h);
});

test("Der Abgleich ist eine schreibende Route: GET → 405 auf /abgleich, nur POST", async () => {
  const { rufe } = aufbau();
  assert.equal((await rufe("GET", "/api/ki/konten/abgleich")).status, 405);
  assert.equal((await rufe("PUT", "/api/ki/konten/abgleich", {})).status, 405);
});
