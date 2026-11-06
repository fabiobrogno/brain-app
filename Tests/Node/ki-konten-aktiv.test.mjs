// Paket E4 „Konten“: das aktive Konto je Programm (ki-konten.json, Kern und Werkstatt lesen es gleich), GET /api/ki/konten ohne Nebenwirkung und der Ordner .neu-<kennung> für ein Konto, das gerade
// angemeldet wird (anlegen → bestätigen → umbenennen und eintragen · Abbruch und Zeitablauf räumen auf). Nur Wegwerf-Orte unter dem Temp-Ordner; HOME gilt nur für den Handler im selben Prozess.
// Kein echtes Programm wird gestartet, kein Schlüsselbund gelesen.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, statSync, readdirSync, existsSync, realpathSync, readFileSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const G = await import(pfad("gemeinsam", "ki-konten.mjs"));
const KERN = await import(pfad("kern", "ki-konten.mjs"));
const { verwaltetWurzel } = await import(pfad("werkstatt", "profile.mjs"));

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
function aufbau() {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const vs = [neuesVault()];
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: vs.map((p, i) => ({ name: `V${i + 1}`, pfad: p, farbe: "#5B8DEF" })), aktiv: vs[0] }));
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n");
  const h = erzeugeHandler({ vault: vs[0], vaultOptionen: { support: s }, mcpPfad: join(mcp, "brain-mcp.mjs") });
  return { home, s, vs, h, rufe: aufruf(h), wurzel: verwaltetWurzel(realpathSync(s)) };
}
// neu → (Anmeldung wäre hier) → fertig
const legeAn = async (a, daten) => {
  const r = await a.rufe("POST", "/api/ki/konto-neu", daten);
  if (r.status !== 200) return { neu: r, fertig: null };
  const f = await a.rufe("POST", "/api/ki/konto-fertig", { id: r.j.ausstehend.id });
  return { neu: r, fertig: f, id: f.j?.neuesKonto?.id };
};
const neuOrdner = (a) => (existsSync(a.wurzel) ? readdirSync(a.wurzel).filter((n) => n.startsWith(".neu-")) : []);
// Fingerabdruck eines Ordnerbaums: Pfad, Art, Größe, Änderungszeit und Inhalt
function abbild(wurzel) {
  const m = {};
  const geh = (d, vor) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n), l = lstatSync(p), k = `${vor}/${n}`;
      m[k] = l.isDirectory() ? `d:${l.mtimeMs}` : `f:${l.size}:${l.mtimeMs}:${createHash("sha1").update(readFileSync(p)).digest("hex")}`;
      if (l.isDirectory()) geh(p, k);
    }
  };
  geh(wurzel, "");
  return JSON.stringify(m);
}

test("aktivesKonto: Kern und Werkstatt lesen dieselbe Datei gleich (gültig, falsches Programm, unbekannt, einziges Konto, mehrere, defekt, fehlt)", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-");
  const prof = (n) => { const p = join(home, `.claude-${n}`); mkdirSync(p, { recursive: true }); return realpathSync(p); };
  const a = prof("a"), b = prof("b");
  const k = (programm, ordner) => ({ programm, ordner, standard: false, ordnerKennung: "" });
  const daten = (aktiv, konten) => ({ version: 1, konten, vaults: {}, ...(aktiv === undefined ? {} : { aktiv }) });
  const zwei = { k_aaaaaaaa: k("claude", a), k_bbbbbbbb: k("claude", b), k_cccccccc: k("codex", join(home, ".codex")) };
  const faelle = [
    [daten({ claude: "k_bbbbbbbb" }, zwei), "claude", "k_bbbbbbbb"],
    [daten({ claude: "k_cccccccc" }, zwei), "claude", null],          // gehört zu einem anderen Programm
    [daten({ claude: "k_99999999" }, zwei), "claude", null],          // unbekannt, bei zwei Konten kein einziges
    [daten({ claude: "../x" }, zwei), "claude", null],                // keine Kennung
    [daten(undefined, zwei), "claude", null],                         // nichts gesetzt, zwei Konten
    [daten(undefined, zwei), "codex", "k_cccccccc"],                  // nichts gesetzt, ein Konto = aktiv
    [daten({ claude: "k_99999999" }, { k_aaaaaaaa: k("claude", a) }), "claude", "k_aaaaaaaa"], // ungültiger Eintrag, aber nur ein Konto
    [daten("kaputt", zwei), "claude", null],
    [daten({}, zwei), "cursor", null],
  ];
  for (const [d, programm, erwartet] of faelle) {
    assert.equal(G.aktivesKonto(d, programm), erwartet, JSON.stringify([d.aktiv, programm]));
    assert.equal(KERN.aktivesKonto(d, programm), erwartet, `Kern: ${JSON.stringify([d.aktiv, programm])}`);
    G.aendere(s, () => structuredClone(d));
    assert.equal(G.liesAktivesKonto(s, programm), erwartet);
    assert.equal(KERN.liesAktivesKonto(s, programm), erwartet);
  }
  // keine lesbare Liste: null (nie ein Fehler)
  const leer = tmp("brain-support-");
  assert.equal(G.liesAktivesKonto(leer, "claude"), null); assert.equal(KERN.liesAktivesKonto(leer, "claude"), null);
  writeFileSync(join(leer, "ki-konten.json"), "{ kaputt");
  assert.equal(G.liesAktivesKonto(leer, "claude"), null); assert.equal(KERN.liesAktivesKonto(leer, "claude"), null);
  // ein Schreiben von außen wirkt sofort in beiden Hälften
  G.aendere(s, () => daten({ claude: "k_aaaaaaaa" }, zwei));
  assert.equal(KERN.liesAktivesKonto(s, "claude"), "k_aaaaaaaa");
  G.aendere(s, (alt) => { alt.aktiv.claude = "k_bbbbbbbb"; return alt; });
  assert.equal(KERN.liesAktivesKonto(s, "claude"), "k_bbbbbbbb"); assert.equal(G.liesAktivesKonto(s, "claude"), "k_bbbbbbbb");
});

test("Aktives Konto: das erste Konto eines Programms ist aktiv, ein weiteres ändert nichts; PUT /api/ki/aktiv wechselt; Entfernen räumt auf; Kern liest dasselbe", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const eins = await legeAn(a, { programm: "claude", name: "Privat" });
    assert.equal(eins.fertig.status, 200, JSON.stringify(eins.fertig.j));
    assert.equal(eins.fertig.j.aktiv.claude, eins.id, "das erste Konto wird aktiv");
    const zwei = await legeAn(a, { programm: "claude", name: "Firma" });
    assert.equal(zwei.fertig.j.aktiv.claude, eins.id, "ein weiteres Konto ändert das aktive nicht");
    const codex = await legeAn(a, { programm: "codex", name: "Codex Privat" });
    assert.equal(codex.fertig.j.aktiv.codex, codex.id); assert.equal(codex.fertig.j.aktiv.claude, eins.id, "je Programm eines");
    assert.equal(KERN.liesAktivesKonto(a.s, "claude"), eins.id);
    assert.equal(G.liesAktivesKonto(a.s, "codex"), codex.id);

    // wechseln
    const w = await a.rufe("PUT", "/api/ki/aktiv", { programm: "claude", konto: zwei.id });
    assert.equal(w.status, 200, JSON.stringify(w.j));
    assert.equal(w.j.aktiv.claude, zwei.id);
    assert.equal(KERN.liesAktivesKonto(a.s, "claude"), zwei.id, "der Kern liest es sofort");
    assert.equal((await a.rufe("GET", "/api/ki/konten")).j.aktiv.claude, zwei.id);
    assert.equal(JSON.parse(readFileSync(join(a.s, "ki-konten.json"), "utf8")).aktiv.claude, zwei.id, "es steht in ki-konten.json");
    // Eingaben werden geprüft
    assert.equal((await a.rufe("PUT", "/api/ki/aktiv", { programm: "claude", konto: codex.id })).status, 400, "Konto eines anderen Programms");
    assert.equal((await a.rufe("PUT", "/api/ki/aktiv", { programm: "claude", konto: "k_00000000" })).status, 404);
    assert.equal((await a.rufe("PUT", "/api/ki/aktiv", { programm: "claude" })).status, 400);
    assert.equal((await a.rufe("POST", "/api/ki/aktiv", { programm: "claude", konto: eins.id })).status, 405);
    assert.equal(G.liesAktivesKonto(a.s, "claude"), zwei.id, "Fehler ändern nichts");

    // die Statusleiste (Kontingent-Stand) und Frag lesen dasselbe
    const kt = (await a.rufe("GET", "/api/ki/kontingent")).j;
    assert.deepEqual(kt.konten.filter((k) => k.aktiv).map((k) => k.id).sort(), [zwei.id, codex.id].sort());

    // Entfernen des aktiven Kontos: der Eintrag fällt weg, das einzige übrige Konto gilt dann
    const pk = await a.rufe("POST", "/api/ki/ordner-papierkorb", { id: zwei.id });
    assert.equal(pk.status, 200, JSON.stringify(pk.j));
    const e = await a.rufe("POST", "/api/ki/konto-entfernen", { id: zwei.id });
    assert.equal(e.status, 200, JSON.stringify(e.j));
    assert.equal(JSON.parse(readFileSync(join(a.s, "ki-konten.json"), "utf8")).aktiv?.claude, undefined, "kein Verweis auf ein entferntes Konto");
    assert.equal(e.j.aktiv.claude, eins.id, "übrig bleibt das einzige Claude-Konto");
    assert.equal(KERN.liesAktivesKonto(a.s, "claude"), eins.id);
  });
});

test("GET /api/ki/konten ist rein lesend: keine Datei ändert sich, es entsteht keine, ein liegengebliebener .neu-Ordner bleibt bis zum ausdrücklichen Abgleich", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    // Liste anlegen (Abgleich), ein Konto, dazu ein liegengebliebener Ordner und ein erkennbares Konto außerhalb der Liste
    await a.rufe("POST", "/api/ki/konten/abgleich", {});
    const k = await legeAn(a, { programm: "claude", name: "Privat" });
    assert.equal(k.fertig.status, 200);
    mkdirSync(join(a.wurzel, ".neu-0a1b2c3d"), { recursive: true, mode: 0o700 });
    mkdirSync(join(a.home, ".claude-draussen"), { recursive: true });
    writeFileSync(join(a.home, ".claude-draussen", "settings.json"), "{}\n");
    const vorher = [abbild(a.s), abbild(a.home)];
    for (let i = 0; i < 3; i++) {
      const g = await a.rufe("GET", "/api/ki/konten");
      assert.equal(g.status, 200);
      assert.ok(Array.isArray(g.j.neu), "Neues steht nur als Hinweis unter `neu`");
      assert.equal(g.j.konten.length, 1, "es wurde nichts eingetragen");
      assert.ok(g.j.neu.some((x) => /draussen/.test(x.ordner)), "das Konto außerhalb der Liste wird gemeldet, aber nicht eingetragen");
    }
    await a.rufe("GET", "/api/ki/kontingent");
    assert.deepEqual([abbild(a.s), abbild(a.home)], vorher, "weder im Support-Ordner noch im Home hat sich etwas verändert");
    assert.ok(existsSync(join(a.wurzel, ".neu-0a1b2c3d")), "der liegengebliebene Ordner wird beim Lesen nicht angefasst");

    // fehlende Liste: GET legt sie nicht an
    const b = aufbau();
    await mitHome(b.home, async () => {
      const g = await b.rufe("GET", "/api/ki/konten");
      assert.equal(g.status, 200);
      assert.equal(existsSync(join(b.s, "ki-konten.json")), false, "GET legt die Liste nicht an");
      assert.equal(existsSync(join(b.s, "ki-konten.angelegt")), false);
    });

    // erst der ausdrückliche Abgleich räumt auf und trägt ein
    const ab = await a.rufe("POST", "/api/ki/konten/abgleich", {});
    assert.equal(ab.status, 200);
    assert.equal(existsSync(join(a.wurzel, ".neu-0a1b2c3d")), false, "der Abgleich räumt den verwaisten .neu-Ordner weg");
    assert.ok(ab.j.konten.some((x) => /draussen/.test(x.ordner)), "und trägt das neu erkannte Konto ein (gesperrt)");
  });
});

test(".neu-Ordner: anlegen (Modus 0700, nicht in der Liste, nirgends sichtbar) → bestätigen (umbenannt, eingetragen, aktiv, gesperrt) · Abbruch räumt auf", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Kunde Müller" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const kennung = r.j.ausstehend.id;
    assert.match(kennung, /^[0-9a-f]{8}$/);
    const ordner = join(a.wurzel, `.neu-${kennung}`);
    assert.equal(r.j.ausstehend.pfad, realpathSync(ordner));
    assert.ok(existsSync(ordner)); assert.equal(statSync(ordner).mode & 0o777, 0o700);
    assert.equal(r.j.neuesKonto, undefined, "noch kein Konto");
    assert.equal(r.j.konten.length, 0, "die Liste kennt es noch nicht");
    assert.deepEqual(readdirSync(a.home), [], "im Home wird nichts angelegt");
    // die Anmeldung schreibt in den Ordner; GET meldet ihn nicht als Konto
    writeFileSync(join(ordner, "settings.json"), "{}");
    const g = await a.rufe("GET", "/api/ki/konten");
    assert.equal(g.j.konten.length, 0); assert.deepEqual(g.j.neu, []);

    // bestätigen
    const f = await a.rufe("POST", "/api/ki/konto-fertig", { id: kennung });
    assert.equal(f.status, 200, JSON.stringify(f.j));
    const k = f.j.konten.find((x) => x.id === f.j.neuesKonto.id);
    assert.equal(k.name, "Kunde Müller"); assert.equal(k.verwaltet, true);
    assert.equal(k.pfad, join(realpathSync(a.s), "ki-konten-ordner", "claude-kunde-muller"));
    assert.equal(existsSync(ordner), false, "der .neu-Ordner ist umbenannt");
    assert.ok(existsSync(join(k.pfad, "settings.json")), "mit dem Inhalt der Anmeldung");
    for (const v of a.vs) assert.equal(f.j.zugriff[k.id][v], "gesperrt");
    assert.equal(f.j.aktiv.claude, k.id);
    assert.deepEqual(neuOrdner(a), []);
    // ein zweites Bestätigen geht nicht
    assert.equal((await a.rufe("POST", "/api/ki/konto-fertig", { id: kennung })).status, 404);

    // Abbruch: Ordner weg, nichts in der Liste
    const r2 = await a.rufe("POST", "/api/ki/konto-neu", { programm: "codex", name: "Weg" });
    const k2 = r2.j.ausstehend.id;
    writeFileSync(join(a.wurzel, `.neu-${k2}`, "auth.json"), "{}");
    assert.deepEqual(neuOrdner(a), [`.neu-${k2}`]);
    const ab = await a.rufe("POST", "/api/ki/konto-abbruch", { id: k2 });
    assert.equal(ab.status, 200); assert.equal(ab.j.ok, true);
    assert.deepEqual(neuOrdner(a), []);
    assert.equal(ab.j.konten.length, 1);
    assert.equal((await a.rufe("POST", "/api/ki/konto-abbruch", { id: k2 })).status, 200, "ein zweiter Abbruch schadet nicht");
    assert.equal((await a.rufe("POST", "/api/ki/konto-fertig", { id: k2 })).status, 404);
    assert.equal((await a.rufe("POST", "/api/ki/konto-abbruch", { id: "../../x" })).status, 400, "nur acht Hex-Zeichen");
    assert.equal((await a.rufe("POST", "/api/ki/konto-fertig", {})).status, 400);
  });
});

test(".neu-Ordner: Zeitablauf, Neustart und Verweise — verwaiste Ordner räumt der Abgleich weg, nie ein Verweis oder fremder Name; gleicher Name zweimal geht nicht", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Langsam" });
    const kennung = r.j.ausstehend.id;
    // gleicher Name, solange das erste noch läuft
    const doppelt = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "langsam" });
    assert.equal(doppelt.status, 409); assert.equal(doppelt.j.art, "name-doppelt");
    assert.deepEqual(neuOrdner(a), [`.neu-${kennung}`], "der abgewiesene Versuch hat nichts angelegt");
    // vor Ablauf bleibt der Eintrag
    a.h.konten.raeumeNeu();
    assert.deepEqual(neuOrdner(a), [`.neu-${kennung}`]);
    // nach 31 Minuten räumt der nächste Abgleich (oder jeder neue Versuch) auf, und das Bestätigen geht nicht mehr
    const echt = Date.now;
    Date.now = () => echt() + 31 * 60_000;
    try { await a.rufe("POST", "/api/ki/konten/abgleich", {}); } finally { Date.now = echt; }
    assert.deepEqual(neuOrdner(a), [], "abgelaufen: der Ordner ist weg");
    const f = await a.rufe("POST", "/api/ki/konto-fertig", { id: kennung });
    assert.equal(f.status, 404); assert.equal(f.j.art, "abgelaufen");
    assert.equal((await a.rufe("GET", "/api/ki/konten")).j.konten.length, 0);

    // Neustart (die Werkstatt kennt den Eintrag nicht mehr): verwaiste Ordner gehen beim nächsten Abgleich weg; Verweise, Dateien und fremde Namen bleiben unberührt
    mkdirSync(a.wurzel, { recursive: true, mode: 0o700 });
    mkdirSync(join(a.wurzel, ".neu-deadbeef"), { mode: 0o700 });
    writeFileSync(join(a.wurzel, ".neu-deadbeef", "x"), "x");
    const fremd = tmp("brain-fremd-"); writeFileSync(join(fremd, "wichtig.txt"), "bleibt");
    symlinkSync(fremd, join(a.wurzel, ".neu-cafebabe"));
    writeFileSync(join(a.wurzel, ".neu-00000000"), "datei");
    mkdirSync(join(a.wurzel, ".neu-xyz"), { mode: 0o700 });
    mkdirSync(join(a.wurzel, ".neu-DEADBEE1"), { mode: 0o700 });
    mkdirSync(join(a.wurzel, "claude-eigen"), { mode: 0o700 });
    await a.rufe("POST", "/api/ki/konten/abgleich", {});
    assert.equal(existsSync(join(a.wurzel, ".neu-deadbeef")), false, "das verwaiste .neu-<id> ist weg");
    assert.ok(lstatSync(join(a.wurzel, ".neu-cafebabe")).isSymbolicLink(), "ein Verweis bleibt");
    assert.equal(readFileSync(join(fremd, "wichtig.txt"), "utf8"), "bleibt", "und sein Ziel wird nie angefasst");
    assert.ok(existsSync(join(a.wurzel, ".neu-00000000")) && existsSync(join(a.wurzel, ".neu-xyz")) && existsSync(join(a.wurzel, ".neu-DEADBEE1")), "nur genau acht kleine Hex-Zeichen");
    assert.ok(existsSync(join(a.wurzel, "claude-eigen")), "ein Konto-Ordner ohne .neu- bleibt");
  });
});

test("Übernahme der früheren Wahl (localStorage → ki-konten.json): offener Vault zuerst, nur wo noch kein aktives Konto gilt, unbekannte Konten und Müll werden nur gelöscht", async () => {
  const { planeUebernahme } = await import(pfad("studio", "ki-aktiv.js"));
  const konten = [{ id: "k_a", programm: "claude" }, { id: "k_b", programm: "claude" }, { id: "k_c", programm: "codex" }];
  const e = (vault, konto) => ({ vault, konto });
  // zwei Vaults mit verschiedener Wahl: der offene gewinnt, je Programm eine
  let p = planeUebernahme({ eintraege: [e("/a", "k_a"), e("/b", "k_b"), e("/c", "k_c")], konten, aktiv: {}, vault: "/b" });
  assert.deepEqual(p.setze, [{ programm: "claude", konto: "k_b" }, { programm: "codex", konto: "k_c" }]);
  assert.deepEqual(p.loesche.sort(), ["/a", "/b", "/c"]);
  // ohne offenen Vault: die erste Wahl
  assert.deepEqual(planeUebernahme({ eintraege: [e("/a", "k_a"), e("/b", "k_b")], konten, aktiv: {}, vault: null }).setze, [{ programm: "claude", konto: "k_a" }]);
  // ein schon gesetztes aktives Konto bleibt
  p = planeUebernahme({ eintraege: [e("/a", "k_a")], konten, aktiv: { claude: "k_b" }, vault: "/a" });
  assert.deepEqual(p.setze, []); assert.deepEqual(p.loesche, ["/a"]);
  // unbekanntes Konto, kaputter Wert: nichts setzen, aber löschen
  p = planeUebernahme({ eintraege: [e("/a", "k_weg"), e("/b", null)], konten, aktiv: {}, vault: "/a" });
  assert.deepEqual(p.setze, []); assert.deepEqual(p.loesche.sort(), ["/a", "/b"]);
  // nichts da
  assert.deepEqual(planeUebernahme(), { setze: [], loesche: [] });
});

test(".neu-Ordner: scheitert das Eintragen (Name inzwischen vergeben), bleibt der Ordner unter .neu und das Konto fehlt; nichts Halbes", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r1 = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Doppelt" });
    // dasselbe Konto taucht zwischendurch über einen anderen Weg in der Liste auf (z. B. von Hand angelegt und umbenannt)
    const eins = await legeAn(a, { programm: "claude", name: "Anders" });
    assert.equal(eins.fertig.status, 200);
    await a.rufe("POST", "/api/ki/konten", { id: eins.id, name: "Doppelt" });
    const f = await a.rufe("POST", "/api/ki/konto-fertig", { id: r1.j.ausstehend.id });
    assert.equal(f.status, 409); assert.equal(f.j.art, "name-doppelt");
    assert.deepEqual(neuOrdner(a), [`.neu-${r1.j.ausstehend.id}`], "der Ordner bleibt, die Anmeldung geht nicht verloren");
    assert.equal((await a.rufe("GET", "/api/ki/konten")).j.konten.length, 1);
    const ab = await a.rufe("POST", "/api/ki/konto-abbruch", { id: r1.j.ausstehend.id });
    assert.equal(ab.status, 200); assert.deepEqual(neuOrdner(a), []);
  });
});
