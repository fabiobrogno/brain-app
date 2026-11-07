// Paket E4 „Konten“: das aktive Konto je Programm (ki-konten.json, Kern und Werkstatt lesen es gleich), GET /api/ki/konten ohne Nebenwirkung und das ausstehende Konto, dessen Anmeldung
// noch läuft (anlegen unter dem endgültigen Namen → bestätigen, ohne je umzubenennen · Abbruch und Zeitablauf räumen auf). Nur Wegwerf-Orte unter dem Temp-Ordner; HOME gilt nur für den Handler im selben Prozess.
// Kein echtes Programm wird gestartet, kein Schlüsselbund gelesen.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, statSync, readdirSync, existsSync, realpathSync, readFileSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { nurUnix, modus } from "./attrappe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-"); if (process.platform === "win32") process.env.USERPROFILE = process.env.HOME || ""; 

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
  const alt = process.env.HOME; process.env.HOME = home; if (process.platform === "win32") process.env.USERPROFILE = process.env.HOME || ""; 
  try { return await fn(); } finally { process.env.HOME = alt; if (process.platform === "win32") process.env.USERPROFILE = process.env.HOME || "";  }
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
// Ausstehende Konten laut ki-konten.json (die Oberfläche sieht sie nie)
const ausstehende = (a) => Object.entries(G.liesKonten(a.s).daten?.konten || {}).filter(([, k]) => k.ausstehend).map(([id, k]) => ({ id, ordner: k.ordner }));
// Ein zweiter Handler auf demselben Support-Ordner: wie ein neu gestarteter Prozess, der die laufenden Versuche des ersten nicht kennt
const zweiter = (a) => { const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n"); const h = erzeugeHandler({ vault: a.vs[0], vaultOptionen: { support: a.s }, mcpPfad: join(mcp, "brain-mcp.mjs") }); return { ...a, h, rufe: aufruf(h) }; };
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

test("GET /api/ki/konten ist rein lesend: keine Datei ändert sich, es entsteht keine, ein liegengebliebenes ausstehendes Konto bleibt bis zum ausdrücklichen Abgleich", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    // Liste anlegen (Abgleich), ein Konto, dazu ein liegengebliebenes ausstehendes Konto (ein früherer Prozess) und ein erkennbares Konto außerhalb der Liste
    await a.rufe("POST", "/api/ki/konten/abgleich", {});
    const k = await legeAn(a, { programm: "claude", name: "Privat" });
    assert.equal(k.fertig.status, 200);
    const liegt = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Liegt" });
    assert.equal(liegt.status, 200);
    const alt = zweiter(a); // „neuer Prozess“: er kennt den Versuch nicht mehr
    mkdirSync(join(a.home, ".claude-draussen"), { recursive: true });
    writeFileSync(join(a.home, ".claude-draussen", "settings.json"), "{}\n");
    const vorher = [abbild(a.s), abbild(a.home)];
    for (let i = 0; i < 3; i++) {
      const g = await alt.rufe("GET", "/api/ki/konten");
      assert.equal(g.status, 200);
      assert.ok(Array.isArray(g.j.neu), "Neues steht nur als Hinweis unter `neu`");
      assert.equal(g.j.konten.length, 1, "nichts wurde eingetragen, das ausstehende Konto ist unsichtbar");
      assert.deepEqual(g.j.neu.map((x) => x.ordner).filter((o) => /liegt/.test(o)), [], "ein ausstehendes Konto gilt nicht als „neu erkannt“");
      assert.ok(g.j.neu.some((x) => /draussen/.test(x.ordner)), "das Konto außerhalb der Liste wird gemeldet, aber nicht eingetragen");
    }
    await alt.rufe("GET", "/api/ki/kontingent");
    assert.deepEqual([abbild(a.s), abbild(a.home)], vorher, "weder im Support-Ordner noch im Home hat sich etwas verändert");
    assert.equal(ausstehende(a).length, 1, "das liegengebliebene Konto wird beim Lesen nicht angefasst");

    // fehlende Liste: GET legt sie nicht an
    const b = aufbau();
    await mitHome(b.home, async () => {
      const g = await b.rufe("GET", "/api/ki/konten");
      assert.equal(g.status, 200);
      assert.equal(existsSync(join(b.s, "ki-konten.json")), false, "GET legt die Liste nicht an");
      assert.equal(existsSync(join(b.s, "ki-konten.angelegt")), false);
    });

    // erst der ausdrückliche Abgleich räumt auf und trägt ein
    const ab = await alt.rufe("POST", "/api/ki/konten/abgleich", {});
    assert.equal(ab.status, 200);
    assert.equal(ausstehende(a).length, 0, "der Abgleich räumt das liegengebliebene ausstehende Konto weg");
    assert.equal(existsSync(liegt.j.ausstehend.pfad), false, "samt Ordner");
    assert.ok(ab.j.konten.some((x) => /draussen/.test(x.ordner)), "und trägt das neu erkannte Konto ein (gesperrt)");
  });
});

test("Neues Konto: der Ordner trägt gleich seinen endgültigen Namen, das ausstehende Konto ist unsichtbar, nach dem Bestätigen ist der Pfad derselbe · Abbruch räumt auf", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Kunde Müller" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const id = r.j.ausstehend.id;
    assert.match(id, /^k_[0-9a-f]{8}$/);
    const pfadVorher = r.j.ausstehend.pfad;
    assert.equal(pfadVorher, join(realpathSync(a.s), "ki-konten-ordner", "claude-kunde-muller"), "gleich der endgültige Name");
    assert.ok(existsSync(pfadVorher)); assert.equal(modus(pfadVorher, 0o700), 0o700);
    assert.equal(r.j.neuesKonto, undefined, "noch kein Konto");
    assert.equal(r.j.konten.length, 0, "unsichtbar");
    assert.deepEqual(readdirSync(a.home), [], "im Home wird nichts angelegt");
    // in der Datei steht es mit der Marke; Kern und Werkstatt sehen es nirgends als Konto
    const roh = JSON.parse(readFileSync(join(a.s, "ki-konten.json"), "utf8"));
    assert.equal(roh.konten[id].ausstehend.stufe, "gesperrt"); assert.equal(roh.konten[id].ordner, pfadVorher);
    assert.equal(KERN.liesAktivesKonto(a.s, "claude"), null, "ein ausstehendes Konto ist nie aktiv, auch nicht als einziges"); assert.equal(G.liesAktivesKonto(a.s, "claude"), null);
    // die Anmeldung schreibt in den Ordner; nichts davon macht daraus ein Konto
    writeFileSync(join(pfadVorher, "settings.json"), "{}");
    const g = await a.rufe("GET", "/api/ki/konten");
    assert.equal(g.j.konten.length, 0); assert.deepEqual(g.j.neu, []); assert.deepEqual(g.j.aktiv, {}); assert.deepEqual(g.j.zugriff, {});
    assert.equal((await a.rufe("GET", "/api/ki/kontingent")).j.konten.length, 0, "auch kein Kontingent");
    assert.equal((await a.rufe("PUT", "/api/ki/aktiv", { programm: "claude", konto: id })).status, 404);
    assert.equal((await a.rufe("POST", "/api/ki/konten", { id, name: "Anders" })).status, 404);
    assert.equal((await a.rufe("POST", "/api/ki/konten/abgleich", {})).j.konten.length, 0, "ein Abgleich während der Anmeldung lässt es stehen");
    assert.ok(existsSync(pfadVorher));

    // bestätigen: nur die Marke fällt weg
    const f = await a.rufe("POST", "/api/ki/konto-fertig", { id });
    assert.equal(f.status, 200, JSON.stringify(f.j));
    assert.equal(f.j.neuesKonto.id, id); assert.equal(f.j.neuesKonto.pfad, pfadVorher, "der Pfad ist vor und nach dem Bestätigen derselbe");
    const k = f.j.konten.find((x) => x.id === id);
    assert.equal(k.pfad, pfadVorher); assert.equal(k.name, "Kunde Müller"); assert.equal(k.verwaltet, true);
    assert.ok(existsSync(join(pfadVorher, "settings.json")), "der Ordner ist unberührt");
    assert.deepEqual(readdirSync(a.wurzel), ["claude-kunde-muller"], "es wurde nichts umbenannt oder neu angelegt");
    for (const v of a.vs) assert.equal(f.j.zugriff[id][v], "gesperrt");
    assert.equal(f.j.aktiv.claude, id);
    assert.equal(JSON.parse(readFileSync(join(a.s, "ki-konten.json"), "utf8")).konten[id].ausstehend, undefined);
    assert.equal((await a.rufe("POST", "/api/ki/konto-fertig", { id })).status, 404, "ein zweites Bestätigen geht nicht");
    assert.equal((await a.rufe("POST", "/api/ki/konto-abbruch", { id })).j.ok, false, "und ein Abbruch nimmt ein fertiges Konto nie weg");
    assert.ok(existsSync(pfadVorher)); assert.equal((await a.rufe("GET", "/api/ki/konten")).j.konten.length, 1);

    // Abbruch: Konto und Ordner weg
    const r2 = await a.rufe("POST", "/api/ki/konto-neu", { programm: "codex", name: "Weg" });
    const id2 = r2.j.ausstehend.id;
    writeFileSync(join(r2.j.ausstehend.pfad, "auth.json"), "{}");
    assert.equal(ausstehende(a).length, 1);
    const ab = await a.rufe("POST", "/api/ki/konto-abbruch", { id: id2 });
    assert.equal(ab.status, 200); assert.equal(ab.j.ok, true);
    assert.equal(ausstehende(a).length, 0); assert.equal(existsSync(r2.j.ausstehend.pfad), false);
    assert.equal(ab.j.konten.length, 1);
    assert.equal((await a.rufe("POST", "/api/ki/konto-abbruch", { id: id2 })).status, 200, "ein zweiter Abbruch schadet nicht");
    assert.equal((await a.rufe("POST", "/api/ki/konto-fertig", { id: id2 })).status, 404);
    assert.equal((await a.rufe("POST", "/api/ki/konto-abbruch", { id: "../../x" })).status, 400, "nur eine Konto-Kennung");
    assert.equal((await a.rufe("POST", "/api/ki/konto-fertig", {})).status, 400);
  });
});

test("Ausstehende Konten: Zeitablauf und liegengebliebene räumt der Abgleich weg; gelöscht wird nur ein echter Ordner, den Kortex angelegt hat (nie Verweise, fremde Orte, Dateien)", { skip: nurUnix("Symlinks brauchen unter Windows besondere Rechte") }, async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Langsam" });
    const id = r.j.ausstehend.id;
    // gleicher Name, solange das erste noch läuft
    const doppelt = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "langsam" });
    assert.equal(doppelt.status, 409); assert.equal(doppelt.j.art, "name-doppelt");
    assert.equal(ausstehende(a).length, 1, "der abgewiesene Versuch hat nichts angelegt");
    assert.equal(a.h.konten.raeumeNeu(), 0, "vor Ablauf bleibt der Eintrag");
    // nach 31 Minuten räumt der nächste Abgleich auf, und das Bestätigen geht nicht mehr
    const echt = Date.now;
    Date.now = () => echt() + 31 * 60_000;
    try { await a.rufe("POST", "/api/ki/konten/abgleich", {}); } finally { Date.now = echt; }
    assert.equal(ausstehende(a).length, 0); assert.equal(existsSync(r.j.ausstehend.pfad), false, "abgelaufen: Konto und Ordner sind weg");
    const f = await a.rufe("POST", "/api/ki/konto-fertig", { id });
    assert.equal(f.status, 404); assert.equal(f.j.art, "abgelaufen");

    // Sicherheit: eingetragene Marken auf Orte, die Kortex nicht angelegt hat — der Eintrag fällt weg, der Ort bleibt unberührt
    mkdirSync(a.wurzel, { recursive: true, mode: 0o700 });
    const fremd = tmp("brain-fremd-"); writeFileSync(join(fremd, "wichtig.txt"), "bleibt");
    symlinkSync(fremd, join(a.wurzel, "claude-verweis"));
    writeFileSync(join(a.wurzel, "claude-datei"), "datei");
    mkdirSync(join(a.wurzel, "claude-eigen"), { mode: 0o700 }); // ein echter Ordner OHNE Marke: bleibt
    const aussen = tmp("brain-aussen-"); writeFileSync(join(aussen, "x.txt"), "bleibt");
    const mark = (programm, ordner, name) => ({ programm, ordner, standard: false, name, ordnerKennung: "", seit: new Date().toISOString(), ausstehend: { seit: 1, stufe: "gesperrt" } });
    G.aendere(a.s, (alt) => { Object.assign(alt.konten, { k_00000001: mark("claude", join(a.wurzel, "claude-verweis"), "V"), k_00000002: mark("claude", join(a.wurzel, "claude-datei"), "D"), k_00000003: mark("claude", aussen, "A"), k_00000004: mark("claude", join(a.home, ".claude"), "S") }); return alt; });
    mkdirSync(join(a.home, ".claude"), { recursive: true }); writeFileSync(join(a.home, ".claude", "settings.json"), "{}");
    await a.rufe("POST", "/api/ki/konten/abgleich", {});
    assert.deepEqual(Object.keys(G.liesKonten(a.s).daten.konten).filter((i) => /^k_0000000/.test(i)), [], "die Einträge sind aus der Liste");
    assert.ok(lstatSync(join(a.wurzel, "claude-verweis")).isSymbolicLink(), "ein Verweis bleibt");
    assert.equal(readFileSync(join(fremd, "wichtig.txt"), "utf8"), "bleibt", "und sein Ziel wird nie angefasst");
    assert.ok(existsSync(join(a.wurzel, "claude-datei")), "eine Datei bleibt");
    assert.equal(readFileSync(join(aussen, "x.txt"), "utf8"), "bleibt", "ein Ort außerhalb der Wurzel bleibt");
    assert.ok(existsSync(join(a.home, ".claude", "settings.json")), "das Standardkonto im Home bleibt");
    assert.ok(existsSync(join(a.wurzel, "claude-eigen")), "ein Ordner ohne Marke bleibt");
  });
});

test("Ausstehendes Konto gehört seiner Werkstatt (pid + Startzeit): eine zweite Werkstatt räumt es nicht weg, solange jene lebt und die 30 Minuten nicht um sind", async () => {
  const { spawn } = await import("node:child_process");
  const { prozessStart } = await import(pfad("gemeinsam", "plattform.mjs"));
  const a = aufbau();
  // „die andere Werkstatt“: ein echter, lebender fremder Prozess
  const fremd = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    await mitHome(a.home, async () => {
      const r = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Fremd" });
      assert.equal(r.status, 200);
      const eintrag = () => G.liesKonten(a.s).daten.konten[r.j.ausstehend.id].ausstehend;
      assert.equal(eintrag().pid, process.pid, "der Eintrag nennt den Besitzer");
      assert.ok(eintrag().start, "samt Startzeit des Prozesses");
      const gehoertFremd = () => G.aendere(a.s, (alt) => { Object.assign(alt.konten[r.j.ausstehend.id].ausstehend, { pid: fremd.pid, start: prozessStart(fremd.pid) }); return alt; });
      gehoertFremd();
      const b = zweiter(a);
      assert.equal(b.h.konten.raeumeNeu(), 0, "die Anmeldung einer lebenden anderen Werkstatt bleibt");
      assert.equal(ausstehende(a).length, 1); assert.ok(existsSync(r.j.ausstehend.pfad));
      // PID wiederverwendet (andere Startzeit): der Besitzer ist nicht mehr der, der angelegt hat
      G.aendere(a.s, (alt) => { alt.konten[r.j.ausstehend.id].ausstehend.start = "Mon Jan  1 00:00:00 2001"; return alt; });
      assert.equal(zweiter(a).h.konten.raeumeNeu(), 1, "andere Startzeit = anderer Prozess: weg");
      assert.equal(ausstehende(a).length, 0);
      // lebt der Besitzer, ist aber die Frist um, räumt die zweite Werkstatt trotzdem auf
      const r2 = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Fremd2" });
      G.aendere(a.s, (alt) => { Object.assign(alt.konten[r2.j.ausstehend.id].ausstehend, { pid: fremd.pid, start: prozessStart(fremd.pid), seit: Date.now() - 31 * 60_000 }); return alt; });
      assert.equal(zweiter(a).h.konten.raeumeNeu(), 1, "30 Minuten um");
      // Besitzer tot: weg
      const r3 = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Fremd3" });
      G.aendere(a.s, (alt) => { Object.assign(alt.konten[r3.j.ausstehend.id].ausstehend, { pid: fremd.pid, start: prozessStart(fremd.pid) }); return alt; });
      assert.equal(zweiter(a).h.konten.raeumeNeu(), 0);
      fremd.kill("SIGKILL"); await new Promise((ok) => fremd.once("exit", ok));
      assert.equal(zweiter(a).h.konten.raeumeNeu(), 1, "Besitzer beendet: weg");
    });
  } finally { try { fremd.kill("SIGKILL"); } catch { /* weg */ } }
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

test("Neues Konto: scheitert das Bestätigen (Name inzwischen vergeben), bleibt das Konto ausstehend und der Ordner stehen; der Abbruch räumt es dann weg", async () => {
  const a = aufbau();
  await mitHome(a.home, async () => {
    const r1 = await a.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Doppelt" });
    const eins = await legeAn(a, { programm: "claude", name: "Anders" });
    assert.equal(eins.fertig.status, 200);
    await a.rufe("POST", "/api/ki/konten", { id: eins.id, name: "Doppelt" }); // der Name wird zwischendurch anderswo vergeben
    const f = await a.rufe("POST", "/api/ki/konto-fertig", { id: r1.j.ausstehend.id });
    assert.equal(f.status, 409); assert.equal(f.j.art, "name-doppelt");
    assert.equal(ausstehende(a).length, 1, "die Anmeldung geht nicht verloren");
    assert.equal((await a.rufe("GET", "/api/ki/konten")).j.konten.length, 1);
    const ab = await a.rufe("POST", "/api/ki/konto-abbruch", { id: r1.j.ausstehend.id });
    assert.equal(ab.status, 200); assert.equal(ausstehende(a).length, 0);
  });
});
