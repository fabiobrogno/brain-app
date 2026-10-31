// „KI & Konten“ in den Einstellungen (Paket P6): Konto hinzufügen (eigener Ordner unter dem Support-Ordner, nie im Home), Stufen eines solchen Kontos, Entfernen (Ordner in den Papierkorb,
// nur eigene Konten), Anmeldestand („abgelaufen“ erst, wenn ein Konto früher angemeldet war) und die Schutz-Ampel mit drei Stufen. Nur Wegwerf-Orte unter dem Temp-Ordner;
// HOME wird für den Handler im selben Prozess gesetzt und nach jedem Test zurückgesetzt. Kein echtes Programm wird gestartet, kein Schlüsselbund gelesen.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, statSync, readdirSync, existsSync, realpathSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { schutzAmpel } = await import(pfad("werkstatt", "schutz-ampel.mjs"));
const { erkenneProfile, profilZuPfad, verwaltetWurzel, verwaltetWurzelZustand, istVerwalteterOrdner } = await import(pfad("werkstatt", "profile.mjs"));
const { erkenneKonten } = await import(pfad("werkstatt", "konten-erkennung.mjs"));

const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
async function mitHome(home, fn) {
  const alt = process.env.HOME; process.env.HOME = home;
  try { return await fn(); } finally { process.env.HOME = alt; }
}
function aufbau({ vaults = 2 } = {}) {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const vs = Array.from({ length: vaults }, neuesVault);
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: vs.map((p, i) => ({ name: `V${i + 1}`, pfad: p, farbe: "#5B8DEF" })), aktiv: vs[0] }));
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n");
  const h = erzeugeHandler({ vault: vs[0], vaultOptionen: { support: s }, mcpPfad: join(mcp, "brain-mcp.mjs") });
  return { home, s, vs, rufe: aufruf(h) };
}

test("Schutz-Ampel: Stufe 1 gilt immer, Stufe 2 und 3 nur bei Claude Code, Farbe nach dem, was wirklich hält", () => {
  const a = schutzAmpel({ programm: "codex", gesperrt: 2 });
  assert.equal(a.moeglich, false);
  assert.deepEqual(a.stufen.map((s) => s.zustand), ["an", "nicht-moeglich", "nicht-moeglich"]);
  assert.equal(a.farbe, "kortex");
  assert.equal(schutzAmpel({ programm: "codex", gesperrt: 0 }).farbe, "grau");
  const moeglich = (vaults, strenger = false, aktiv = false) => ({ moeglich: true, strenger, strengerAktiv: aktiv, vaults });
  let r = schutzAmpel({ programm: "claude", gesperrt: 0, schutz: moeglich({}) });
  assert.equal(r.farbe, "grau"); assert.equal(r.stufen[1].zustand, "leer");
  r = schutzAmpel({ programm: "claude", gesperrt: 2, schutz: moeglich({ a: "aus", b: "fehlt" }) });
  assert.equal(r.farbe, "rot"); assert.equal(r.stufen[1].zustand, "aus");
  r = schutzAmpel({ programm: "claude", gesperrt: 2, schutz: moeglich({ a: "aktiv", b: "aus" }) });
  assert.equal(r.stufen[1].zustand, "teil"); assert.equal(r.farbe, "gelb");
  r = schutzAmpel({ programm: "claude", gesperrt: 1, schutz: moeglich({ a: "eigene" }) });
  assert.equal(r.stufen[1].zustand, "an"); assert.equal(r.stufen[2].zustand, "aus"); assert.equal(r.farbe, "gelb");
  r = schutzAmpel({ programm: "claude", gesperrt: 1, schutz: moeglich({ a: "aktiv" }, true, true) });
  assert.equal(r.farbe, "gruen"); assert.equal(r.stufen[2].zustand, "an");
  r = schutzAmpel({ programm: "claude", gesperrt: 1, schutz: moeglich({ a: "aktiv" }, true, false) });
  assert.equal(r.stufen[2].zustand, "inaktiv"); assert.equal(r.farbe, "gelb");
  r = schutzAmpel({ programm: "claude", gesperrt: 1, schutz: moeglich({ a: "defekt" }) });
  assert.equal(r.stufen[1].zustand, "defekt"); assert.equal(r.farbe, "rot");
});

test("Konto hinzufügen: eigener Ordner unter dem Support-Ordner (Modus 0700), nichts im Home, startet gesperrt, erscheint mit verwaltet:true", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Kunde Müller" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const k = r.j.konten.find((x) => x.id === r.j.neuesKonto.id);
    assert.equal(k.verwaltet, true); assert.equal(k.standard, false); assert.equal(k.name, "Kunde Müller");
    assert.equal(k.pfad, join(realpathSync(a.s), "ki-konten-ordner", "claude-kunde-muller"));
    assert.ok(existsSync(k.pfad)); assert.equal(statSync(k.pfad).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(a.home), [], "im Home wird nichts angelegt");
    for (const v of a.vs) assert.equal(r.j.zugriff[k.id][v], "gesperrt");
    // der Ordner kann mit der Stufe wie jedes andere Konto gesetzt werden
    const z = await a.rufe("PUT", "/api/ki/zugriff", { konto: k.id, vault: a.vs[0], stufe: "posteingang" });
    assert.equal(z.j.zugriff[k.id][a.vs[0]], "posteingang");
    assert.equal(z.j.zugriff[k.id][a.vs[1]], "gesperrt");
  });
});

test("Konto hinzufügen: Anfangsstufe „Lesen“, Namen und Programme werden geprüft, gleicher Name zweimal geht nicht, gleiche Kennung bekommt eine Zahl", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "codex", name: "Privat", stufe: "lesen" });
    assert.equal(r.status, 200);
    for (const v of a.vs) assert.equal(r.j.zugriff[r.j.neuesKonto.id][v], "lesen");
    assert.equal((await a.rufe("POST", "/api/ki/konto-neu", { programm: "codex", name: "privat" })).status, 409);
    assert.equal((await a.rufe("POST", "/api/ki/konto-neu", { programm: "cursor", name: "X" })).status, 400);
    assert.equal((await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "  " })).status, 400);
    assert.equal((await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "A", stufe: "erweitert" })).status, 400);
    const x = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Firma!" });
    const y = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Firma?" });
    assert.equal(x.status, 200); assert.equal(y.status, 200);
    assert.ok(x.j.neuesKonto.pfad.endsWith("claude-firma") && y.j.neuesKonto.pfad.endsWith("claude-firma-2"));
  });
});

test("Erkennung findet die eigenen Ordner wieder (Neustart), Profile und Konten, und nur Ordner, keine Verweise", async () => {
  const a = aufbau();
  const w = verwaltetWurzel(a.s);
  mkdirSync(join(w, "claude-eins"), { recursive: true });
  mkdirSync(join(w, "codex-zwei"), { recursive: true });
  mkdirSync(join(w, "claude-ohne"), { recursive: true });
  const fremd = tmp("brain-fremd-");
  symlinkSync(fremd, join(w, "claude-verweis"));
  writeFileSync(join(w, "claude-datei"), "x");
  mkdirSync(join(w, "andere-sache"), { recursive: true });
  const profile = erkenneProfile(a.home, a.s);
  assert.deepEqual(profile.map((p) => p.name), ["claude-eins", "claude-ohne"]);
  assert.ok(profile.every((p) => p.verwaltet && !p.standard));
  assert.equal(erkenneProfile(a.home).length, 0, "ohne Support-Ordner keine eigenen Ordner");
  assert.ok(profilZuPfad(join(w, "claude-eins"), a.home, a.s));
  assert.equal(profilZuPfad(join(w, "claude-verweis"), a.home, a.s), null);
  const k = erkenneKonten({ home: a.home, support: a.s, programme: [] });
  assert.deepEqual(k.map((x) => `${x.programm}:${x.name}`).sort(), ["claude:Claude Code · eins", "claude:Claude Code · ohne", "codex:Codex · zwei"]);
});

test("Entfernen: nur ein von Kortex angelegtes Konto, sein Ordner kommt in den Papierkorb, Eintrag und Pflege-Wahl verschwinden", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Weg" });
    const id = r.j.neuesKonto.id, ordner = r.j.neuesKonto.pfad;
    writeFileSync(join(ordner, "settings.json"), "{}");
    await a.rufe("PUT", "/api/ki/zugriff", { konto: id, vault: a.vs[0], stufe: "erweitert" });
    const p = await a.rufe("POST", "/api/ki/pflege", { vault: a.vs[0], konto: id, stufe: "mittel" });
    assert.equal(p.status, 200, JSON.stringify(p.j));
    // Ohne Papierkorb geht Entfernen nicht (kein stilles Löschen), danach schon
    const zu = await a.rufe("POST", "/api/ki/konto-entfernen", { id });
    assert.equal(zu.status, 409); assert.equal(zu.j.art, "ordner-da"); assert.ok(existsSync(ordner));
    const pk = await a.rufe("POST", "/api/ki/ordner-papierkorb", { id });
    assert.equal(pk.status, 200, JSON.stringify(pk.j));
    assert.equal(existsSync(ordner), false);
    assert.ok(existsSync(join(a.home, ".Trash", "claude-weg", "settings.json")), "der Ordner liegt im Papierkorb");
    const e = await a.rufe("POST", "/api/ki/konto-entfernen", { id });
    assert.equal(e.status, 200, JSON.stringify(e.j));
    assert.equal(e.j.konten.some((k) => k.id === id), false);
    const v = e.j.vaults.find((x) => x.pfad === a.vs[0]);
    assert.equal(v.pflege.konto ?? null, null);
    assert.equal((await a.rufe("POST", "/api/ki/konto-entfernen", { id })).status, 404);
  });
});

test("Verweis als Wurzel: zeigt <Support>/ki-konten-ordner auf den Benutzerordner, gilt NICHTS darin als eigenes Konto — kein Entfernen, kein Papierkorb, kein Anlegen, keine Erkennung", async () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const privat = join(home, ".claude-privat"); mkdirSync(privat); writeFileSync(join(privat, "settings.json"), "{}");
  symlinkSync(home, join(s, "ki-konten-ordner"));                      // die Wurzel ist ein Verweis auf das Home
  const vault = neuesVault();
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ name: "V", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n");
  const rufe = aufruf(erzeugeHandler({ vault, vaultOptionen: { support: s }, mcpPfad: join(mcp, "brain-mcp.mjs") }));
  assert.equal(verwaltetWurzelZustand(s), "link");
  assert.deepEqual(erkenneProfile(home, s).filter((p) => p.verwaltet), []);
  assert.equal(istVerwalteterOrdner(s, privat, "claude", { fehltOk: true }), false);
  await mitHome(home, async () => {
    const st = await rufe("GET", "/api/ki/konten");
    const k = st.j.konten.find((x) => x.pfad.endsWith(".claude-privat"));
    assert.ok(k, "das Konto aus dem Home ist erkannt");
    assert.equal(k.verwaltet, false);
    for (const weg of ["/api/ki/konto-entfernen", "/api/ki/ordner-papierkorb"]) {
      const r = await rufe("POST", weg, { id: k.id });
      assert.equal(r.status, 409, weg); assert.equal(r.j.art, "nicht-verwaltet", weg);
    }
    const neu = await rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Neu" });
    assert.equal(neu.status, 409); assert.equal(neu.j.art, "wurzel-link");
    assert.ok(existsSync(join(privat, "settings.json")), "nichts wurde angefasst");
    assert.equal(existsSync(join(home, ".Trash")), false);
    assert.deepEqual(readdirSync(home).sort(), [".claude-privat"], "im Home entstand nichts");
  });
});

test("Verweis auf einen Konto-Ordner: ein Eintrag in der Wurzel, der auf ~/.claude-… zeigt, ist nie eigen; falscher Name, falsches Programm und tiefere Ordner auch nicht", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const privat = join(home, ".claude-privat"); mkdirSync(privat);
  const w = verwaltetWurzel(s); mkdirSync(w);
  symlinkSync(privat, join(w, "claude-verweis"));
  mkdirSync(join(w, "claude-echt")); mkdirSync(join(w, "codex-echt")); mkdirSync(join(w, "andere")); mkdirSync(join(w, "claude-echt", "claude-tief"));
  assert.equal(istVerwalteterOrdner(s, join(w, "claude-verweis"), "claude"), false, "Verweis");
  assert.equal(istVerwalteterOrdner(s, privat, "claude"), false, "Ordner im Home");
  assert.equal(istVerwalteterOrdner(s, join(w, "claude-echt"), "claude"), true);
  assert.equal(istVerwalteterOrdner(s, join(w, "claude-echt"), "codex"), false, "Programm passt nicht zum Namen");
  assert.equal(istVerwalteterOrdner(s, join(w, "codex-echt"), "claude"), false);
  assert.equal(istVerwalteterOrdner(s, join(w, "andere"), "claude"), false, "Name ohne Programm-Vorsatz");
  assert.equal(istVerwalteterOrdner(s, join(w, "claude-echt", "claude-tief"), "claude"), false, "nicht direkt in der Wurzel");
  assert.equal(istVerwalteterOrdner(s, join(w, "claude-fehlt"), "claude"), false);
  assert.equal(istVerwalteterOrdner(s, join(w, "claude-fehlt"), "claude", { fehltOk: true }), true, "ein schon entfernter Ordner darf aus der Liste");
  assert.equal(istVerwalteterOrdner(s, `${w}/../claude-x`, "claude", { fehltOk: true }), false, "Punkte im Pfad");
  assert.deepEqual(erkenneProfile(home, s).filter((p) => p.verwaltet).map((p) => p.name), ["claude-echt"]);
});

test("Entfernen: ein Konto aus dem Home (System-Standard oder ~/.claude-…) bleibt unberührt; Ordner bleibt stehen", async () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const claude = join(home, ".claude"); mkdirSync(claude); writeFileSync(join(claude, "settings.json"), "{}");
  const privat = join(home, ".claude-privat"); mkdirSync(privat); writeFileSync(join(privat, "settings.json"), "{}");
  const vault = neuesVault();
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ name: "V", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n");
  const rufe = aufruf(erzeugeHandler({ vault, vaultOptionen: { support: s }, mcpPfad: join(mcp, "brain-mcp.mjs") }));
  await mitHome(home, async () => {
    const st = await rufe("GET", "/api/ki/konten");
    assert.equal(st.j.konten.length, 2);
    assert.ok(st.j.konten.every((k) => k.verwaltet === false));
    for (const k of st.j.konten) {
      const r = await rufe("POST", "/api/ki/konto-entfernen", { id: k.id });
      assert.equal(r.status, 409, k.name);
      assert.equal(r.j.art, "nicht-verwaltet");
    }
    assert.ok(existsSync(join(claude, "settings.json")) && existsSync(join(privat, "settings.json")));
    assert.equal(existsSync(join(home, ".Trash")), false);
  });
});

test("Anmeldestand: „abgelaufen“ erst, wenn das Konto früher angemeldet war; der Vermerk steht in einer eigenen Datei, nie in ki-konten.json; nichts davon enthält Zugangsdaten", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const id = (await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Anm" })).j.neuesKonto.id;
    let r = await a.rufe("POST", "/api/ki/anmeldung", { konto: id, zustand: "nicht-angemeldet" });
    assert.equal(r.j.zustand, "nicht-angemeldet"); assert.equal(r.j.zuletzt, null);
    r = await a.rufe("POST", "/api/ki/anmeldung", { konto: id, zustand: "unbekannt" });
    assert.equal(r.j.zustand, "unbekannt");
    r = await a.rufe("POST", "/api/ki/anmeldung", { konto: id, zustand: "angemeldet" });
    assert.equal(r.j.zustand, "angemeldet"); assert.ok(r.j.zuletzt);
    r = await a.rufe("POST", "/api/ki/anmeldung", { konto: id, zustand: "nicht-angemeldet" });
    assert.equal(r.j.zustand, "abgelaufen");
    assert.equal((await a.rufe("POST", "/api/ki/anmeldung", { konto: id, zustand: "kaputt" })).status, 400);
    assert.equal((await a.rufe("POST", "/api/ki/anmeldung", { konto: "k_gibtesnicht", zustand: "angemeldet" })).status, 404);
    const st = await a.rufe("GET", "/api/ki/konten");
    assert.ok(st.j.konten.find((k) => k.id === id).zuletztAngemeldet);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(a.s, "ki-anmeldung.json"), "utf8")).konten[id]), ["zuletzt"]);
    assert.ok(!readFileSync(join(a.s, "ki-konten.json"), "utf8").includes("zuletzt"));
    // Entfernen räumt den Vermerk mit auf
    await a.rufe("POST", "/api/ki/ordner-papierkorb", { id });
    await a.rufe("POST", "/api/ki/konto-entfernen", { id });
    assert.equal(JSON.parse(readFileSync(join(a.s, "ki-anmeldung.json"), "utf8")).konten[id], undefined);
  });
});

test("Stand der Konten trägt die Ampel: Claude mit Sperre ohne Leseverbot ist rot, andere Programme zeigen nur die Kortex-Wege", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const c = (await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Ampel" })).j.neuesKonto.id;
    const x = (await a.rufe("POST", "/api/ki/konto-neu", { programm: "codex", name: "Codex Zwei" })).j.neuesKonto.id;
    const st = await a.rufe("GET", "/api/ki/konten");
    const kc = st.j.konten.find((k) => k.id === c), kx = st.j.konten.find((k) => k.id === x);
    assert.equal(kc.schutz.ampel.gesperrt, 2);
    assert.equal(kc.schutz.ampel.farbe, "rot");
    assert.deepEqual(kc.schutz.ampel.stufen.map((s) => s.zustand), ["an", "aus", "aus"]);
    assert.equal(kx.schutz.moeglich, false);
    assert.equal(kx.schutz.ampel.farbe, "kortex");
    // Leseverbot für einen Vault eintragen: Stufe 2 „teil“ (ein Vault von zwei)
    const z = await a.rufe("PUT", "/api/ki/zugriff", { konto: c, vault: a.vs[0], stufe: "gesperrt", claudeSperre: true });
    assert.equal(z.j.claude.aktion, "eingetragen", JSON.stringify(z.j.claude));
    const k2 = z.j.konten.find((k) => k.id === c);
    assert.equal(k2.schutz.ampel.stufen[1].zustand, "teil");
    assert.equal(k2.schutz.ampel.farbe, "gelb");
  });
});

test("Rückfall für Browser und Entwicklung: /api/ki/programme antwortet in der Form der App, Anmelden geht nur in der App", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("GET", "/api/ki/programme");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.j.programme)); assert.equal(typeof r.j.gesucht, "string");
    const m = await a.rufe("POST", "/api/ki/anmelden", { programm: "claude", ordner: null });
    assert.equal(m.status, 409); assert.equal(m.j.art, "nur-app");
    assert.equal((await a.rufe("POST", "/api/ki/anmeldestatus", { programm: "claude", ordner: null })).j.zustand, "unbekannt");
  });
});
