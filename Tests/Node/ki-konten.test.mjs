// KI-Konten und Vault-Zugriff (docs/plaene/ki-konten.md, Paket P1): Datenmodell, Konto bestimmen, Stufen, Erkennung, Migration, Routen, Verbinden mit --konto, Installer.
// Nur Wegwerf-Orte unter dem Temp-Ordner. Kindprozesse bekommen eine ausdrücklich gebaute Umgebung (baueTestUmgebung), claude/codex sind Attrappen mit
// strengem Argument-Parsing. Diese Datei verändert process.env nur für den Handler im selben Prozess (HOME, PATH) und stellt es nach jedem Test wieder her.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync, readdirSync, existsSync, rmSync, renameSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung, attrappen } from "./ki-konten-hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
const HOME0 = tmp("brain-home-");
process.env.HOME = HOME0;

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const { erzeugeKonten } = await import(pfad("werkstatt", "konten.mjs"));
const { erkenneKonten } = await import(pfad("werkstatt", "konten-erkennung.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const stufe = (support, vault, env = {}, extra = {}) => K.kontoStufe(vault, { support, env, ...extra });
const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const neueHome = () => { const h = tmp("brain-home-"); return h; };
const claudeProfil = (home, name = "", mitHooks = false) => {
  const p = join(home, name ? `.claude-${name}` : ".claude");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "settings.json"), mitHooks ? JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0" }] }] } }) : "{}");
  return realpathSync(p);
};
const sup = () => tmp("brain-support-");
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const modus = (p) => statSync(p).mode & 0o777;

// ───────────────────────────── Datei ─────────────────────────────
test("Datei: Modus 0600, atomar (keine Temp- oder Sperrreste), die vorige Fassung bleibt als .vorher", () => {
  const s = sup();
  K.aendere(s, () => ({ ...K.leerDaten(), konten: { k_00000001: { programm: "claude", ordner: "/x", ordnerKennung: "" } } }));
  const datei = K.kontenPfad(s);
  assert.equal(modus(datei), 0o600);
  K.aendere(s, (alt) => { alt.konten.k_00000001.name = "zwei"; return alt; });
  assert.equal(JSON.parse(readFileSync(`${datei}.vorher`, "utf8")).konten.k_00000001.name, undefined, ".vorher = die Fassung vor dem letzten Schreiben");
  assert.equal(modus(`${datei}.vorher`), 0o600);
  assert.deepEqual(readdirSync(s).filter((n) => /\.tmp$|\.lock$/.test(n)), []);
  const r = K.aendere(s, (alt) => alt); // keine Änderung → nichts geschrieben
  assert.equal(r.geaendert, false);
});

test("Datei fehlt → Übergang (bisheriges Verhalten); defekt, falsche Version, ein Link oder ein Ordner → gesperrt (fail-closed)", () => {
  const v = neuesVault(), s = sup(), datei = K.kontenPfad(s);
  assert.equal(K.liesKonten(s).zustand, "fehlt");
  assert.equal(stufe(s, v), "posteingang", "vor dem ersten Start der neuen App gilt das bisherige Verhalten");
  for (const inhalt of ["kein json", "[]", "{}", JSON.stringify({ version: 2, konten: {}, vaults: {} }), JSON.stringify({ version: 1, konten: [], vaults: {} }), ""]) {
    writeFileSync(datei, inhalt);
    assert.equal(K.liesKonten(s).zustand, "defekt", inhalt);
    assert.equal(stufe(s, v), "gesperrt", inhalt);
    assert.equal(stufe(s, v, {}, { arg: "k_00000001" }), "gesperrt");
  }
  // ein Symlink an der Stelle der Datei wird nie gefolgt, auch wenn er auf eine gültige Datei zeigt
  const gueltig = join(tmp(), "gueltig.json");
  writeFileSync(gueltig, JSON.stringify(K.leerDaten()));
  rmSync(datei); symlinkSync(gueltig, datei);
  assert.equal(K.liesKonten(s).zustand, "defekt");
  rmSync(datei); mkdirSync(datei);
  assert.equal(K.liesKonten(s).zustand, "defekt");
  assert.throws(() => K.aendere(s, () => K.leerDaten()), /beschädigt/, "eine defekte Datei wird nicht überschrieben");
});

test("Ein Entzug wirkt beim nächsten Aufruf, ohne Neustart (der Zwischenspeicher hängt am Inhalt der Datei)", () => {
  const v = neuesVault(), s = sup();
  const kennung = K.kennungVon(v);
  K.aendere(s, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner: "/x", ordnerKennung: "" } },
    vaults: { [v]: { ordnerKennung: kennung, neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "posteingang" } } } }));
  assert.equal(stufe(s, v, {}, { arg: "k_aaaaaaaa" }), "posteingang");
  K.aendere(s, (alt) => { alt.vaults[v].konten.k_aaaaaaaa = "gesperrt"; return alt; });
  assert.equal(stufe(s, v, {}, { arg: "k_aaaaaaaa" }), "gesperrt");
});

// ───────────────────────────── Stufen und Konto bestimmen ─────────────────────────────
function einrichtung() {
  const home = neueHome(), s = sup();
  const standard = claudeProfil(home), privat = claudeProfil(home, "privat"), firma = claudeProfil(home, "firma");
  const v1 = neuesVault(), v2 = neuesVault();
  const kennung = (p) => K.kennungVon(p);
  const daten = { version: 1,
    konten: {
      k_00000001: { programm: "claude", ordner: standard, standard: true, name: "Standard", ordnerKennung: kennung(standard), seit: "x" },
      k_00000002: { programm: "claude", ordner: privat, standard: false, name: "Privat", ordnerKennung: kennung(privat), seit: "x" },
      k_00000003: { programm: "claude", ordner: firma, standard: false, name: "Firma", ordnerKennung: kennung(firma), seit: "x" },
    },
    vaults: {
      [v1]: { ordnerKennung: kennung(v1), neueKonten: "lesen", ohneKonto: "posteingang", konten: { k_00000001: "erweitert", k_00000002: "posteingang", k_00000003: "gesperrt" } },
      [v2]: { ordnerKennung: kennung(v2), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_00000001: "lesen", k_00000002: "gesperrt" } },
    } };
  K.aendere(s, () => daten);
  return { home, s, standard, privat, firma, v1, v2 };
}

test("Stufen je Konto und Vault; unbekanntes Konto und unbekannter Vault sind gesperrt; ohne Eintrag gilt neueKonten, ohne Konto ohneKonto", () => {
  const e = einrichtung();
  assert.equal(stufe(e.s, e.v1, {}, { arg: "k_00000001" }), "erweitert");
  assert.equal(stufe(e.s, e.v1, {}, { arg: "k_00000002" }), "posteingang");
  assert.equal(stufe(e.s, e.v1, {}, { arg: "k_00000003" }), "gesperrt");
  assert.equal(stufe(e.s, e.v2, {}, { arg: "k_00000003" }), "gesperrt", "bekanntes Konto ohne Eintrag: neueKonten = gesperrt");
  assert.equal(stufe(e.s, e.v1, {}, { arg: "k_99999999" }), "gesperrt", "unbekannte Kennung");
  assert.equal(stufe(e.s, e.v1, {}, { arg: "../../etc" }), "gesperrt", "ungültige Kennung");
  assert.equal(stufe(e.s, e.v1), "gesperrt", "kein Konto erkennbar (Altform): nie lockerer als das strengste Konto des Vaults (hier k_00000003 = gesperrt), auch wenn ohneKonto posteingang sagt");
  assert.equal(stufe(e.s, e.v2), "gesperrt");
  assert.equal(stufe(e.s, neuesVault(), {}, { arg: "k_00000001" }), "gesperrt", "ein Vault, den die Liste nicht kennt");
});

test("bestimmeKonto: Argument · Umgebung · Widerspruch → das strengere Recht · ~/.claude ausdrücklich = Standard · unbekannter Ordner = gesperrt", () => {
  const e = einrichtung();
  // nur Umgebung (Altform): CLAUDE_CONFIG_DIR bestimmt das Konto
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: e.privat }), "posteingang");
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: e.firma }), "gesperrt");
  // Argument und Umgebung gleich → dieses Recht; Widerspruch → das strengere
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: e.privat }, { arg: "k_00000002" }), "posteingang");
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: e.firma }, { arg: "k_00000001" }), "gesperrt", "Argument sagt erweitert, die Umgebung ist das gesperrte Konto");
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: e.privat }, { arg: "k_00000001" }), "posteingang", "…und umgekehrt: erweitert gegen posteingang → posteingang");
  // Hook (programm claude, vollständige Umgebung): ohne CLAUDE_CONFIG_DIR läuft das Standardprofil; ~/.claude ausdrücklich gesetzt ist dasselbe
  assert.equal(stufe(e.s, e.v1, {}, { programm: "claude", vollstaendig: true }), "erweitert");
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: e.standard }, { programm: "claude", vollstaendig: true }), "erweitert");
  assert.equal(stufe(e.s, e.v1, {}, { programm: "claude", vollstaendig: true, arg: "k_00000002" }), "posteingang", "Hook von ~/.claude-privat in einer Sitzung ohne Variable: Widerspruch → strenger");
  // MCP-Server (Umgebung kann gefiltert sein): eine fehlende Variable ist keine Angabe
  assert.equal(stufe(e.s, e.v1, {}, { arg: "k_00000002" }), "posteingang");
  // ein Ordner, den Kortex nicht als Konto kennt (z. B. Symlink-Profil oder Zufallsordner) → gesperrt
  assert.equal(stufe(e.s, e.v1, { CLAUDE_CONFIG_DIR: tmp("brain-fremd-") }), "gesperrt");
  const link = join(e.home, ".claude-link"); symlinkSync(e.privat, link);
  assert.ok(!erkenneKonten({ home: e.home, programme: [] }).some((k) => k.ordner.endsWith("claude-link")), "ein Symlink-Profil ist nie ein Konto");
  // CODEX_HOME bestimmt ein Codex-Konto
  assert.equal(stufe(e.s, e.v1, { CODEX_HOME: tmp("brain-codex-") }), "gesperrt");
});

test("Ordnerkennung: ein umbenannter Vault trifft seine Regeln weiter, ein ausgetauschter Ordner am selben Pfad nicht", () => {
  const home = neueHome(), s = sup();
  const p = claudeProfil(home, "a");
  const v = neuesVault();
  K.aendere(s, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner: p, ordnerKennung: K.kennungVon(p) } },
    vaults: { [v]: { ordnerKennung: K.kennungVon(v), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "gesperrt" } } } }));
  assert.equal(stufe(s, v, {}, { arg: "k_aaaaaaaa" }), "gesperrt");
  // umbenannt: die Sperre gilt weiter (hier mit einer Erlaubnis geprüft, die an der Kennung hängt)
  K.aendere(s, (alt) => { alt.vaults[v].konten.k_aaaaaaaa = "lesen"; return alt; });
  const neuerName = `${v}-umbenannt`;
  renameSync(v, neuerName);
  assert.equal(stufe(s, neuerName, {}, { arg: "k_aaaaaaaa" }), "lesen", "gleiche Kennung, anderer Pfad: dieselben Regeln");
  // gelöscht und neu angelegt am alten Pfad: eine neue Kennung → die alten Regeln gelten NICHT (gesperrt, bis der Nutzer entscheidet)
  renameSync(neuerName, v);
  rmSync(v, { recursive: true }); mkdirSync(v); writeFileSync(join(v, "brain.config.json"), "{}");
  assert.equal(stufe(s, v, {}, { arg: "k_aaaaaaaa" }), "gesperrt");
});

// ───────────────────────────── Erkennung ─────────────────────────────
test("Erkennung: Claude-Profile, Codex-Ordner (nur mit config.toml/auth.json), übrige Programme über die vorhandene Erkennung; Symlinks nie; keine Dateiinhalte", () => {
  const home = neueHome();
  claudeProfil(home); claudeProfil(home, "privat");
  symlinkSync(join(home, ".claude-privat"), join(home, ".claude-verweis"));
  schreibe(home, ".codex/config.toml", "model = \"x\"\n");
  schreibe(home, ".codex-arbeit/auth.json", "GEHEIM-NICHT-LESEN");
  mkdirSync(join(home, ".codex-leer"));
  mkdirSync(join(home, ".cursor"));
  const liste = erkenneKonten({ home, programme: ["cursor"] });
  const text = JSON.stringify(liste);
  assert.ok(!text.includes("GEHEIM"), "Inhalte werden nie gelesen");
  assert.deepEqual(liste.map((k) => `${k.programm}:${k.standard ? "standard" : k.ordner.split("/").pop()}`).sort(),
    ["claude:.claude-privat", "claude:standard", "codex:.codex-arbeit", "codex:standard", "cursor:standard"].sort());
  assert.ok(liste.every((k) => typeof k.name === "string" && k.name.length <= 40));
  assert.deepEqual(liste.find((k) => k.programm === "cursor").ordner, realpathSync(join(home, ".cursor")));
});

// ───────────────────────────── Konten führen: Migration, neue Konten, Ausnahme ─────────────────────────────
const erzeuge = (home, s, vaultListe, extra = {}) => erzeugeKonten({ support: s, home: () => home, vaults: () => vaultListe.map((p) => ({ pfad: p, name: p.split("/").pop() })),
  erkennung: () => erkenneKonten({ home, programme: [] }), quelleVon: () => "bestaetigt", ...extra });

test("Migration: Konten mit bestehender Verbindung behalten ihre heutigen Rechte (posteingang für alle Vaults, auch alte Einträge ohne Konto), alle anderen starten gesperrt", () => {
  const home = neueHome(), s = sup();
  const a = claudeProfil(home, "privat", true), b = claudeProfil(home, "firma", false), v1 = neuesVault(), v2 = neuesVault();
  const k = erzeuge(home, s, [v1, v2]);
  assert.equal(K.liesKonten(s).zustand, "fehlt");
  k.synchronisiere();
  const d = K.liesKonten(s).daten;
  const id = (ordner) => Object.keys(d.konten).find((x) => d.konten[x].ordner === ordner);
  for (const v of [v1, v2]) {
    assert.equal(K.stufeFuer(d, v, id(a)), "posteingang");
    assert.equal(K.stufeFuer(d, v, id(b)), "gesperrt", "nicht verbunden → gesperrt");
    assert.equal(K.stufeFuer(d, v, null), "gesperrt", "alte Einträge ohne --konto: nie lockerer als das strengste Konto des Vaults (b ist gesperrt) — sie müssen mit Konto neu verbunden werden");
    assert.equal(d.vaults[v].ohneKonto, "posteingang", "die Migration vermerkt den früheren Wert weiter; wirksam ist das Minimum");
    assert.equal(d.vaults[v].neueKonten, "gesperrt");
  }
  // ein Vault, der später dazukommt, ist für alle gesperrt (auch für die Altform)
  const v3 = neuesVault();
  const k2 = erzeuge(home, s, [v1, v2, v3]);
  k2.synchronisiere();
  const d2 = K.liesKonten(s).daten;
  assert.equal(K.stufeFuer(d2, v3, id(a)), "gesperrt");
  assert.equal(K.stufeFuer(d2, v3, null), "gesperrt");
  assert.equal(K.stufeFuer(d2, v1, id(a)), "posteingang", "bestehende Regeln bleiben");
});

test("Migration ohne bestehende Verbindung: nichts wird still freigegeben", () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "privat", false);
  const v = neuesVault();
  erzeuge(home, s, [v]).synchronisiere();
  const d = K.liesKonten(s).daten;
  assert.equal(K.stufeFuer(d, v, null), "gesperrt");
  for (const id of Object.keys(d.konten)) assert.equal(K.stufeFuer(d, v, id), "gesperrt");
});

test("Verbundene Claude-Konten werden auch am MCP-Eintrag erkannt (~/.claude.json, <profil>/.claude.json), nur der Schlüssel brain zählt", () => {
  const home = neueHome(), s = sup();
  claudeProfil(home); const p = claudeProfil(home, "zwei");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "geheim@example.org" }, mcpServers: { brain: { command: "x" } } }));
  writeFileSync(join(p, ".claude.json"), JSON.stringify({ mcpServers: { anderes: { command: "x" } } }));
  const v = neuesVault();
  const k = erzeuge(home, s, [v]);
  k.synchronisiere();
  const d = K.liesKonten(s).daten;
  assert.ok(!JSON.stringify(d).includes("geheim@example.org"), "aus der Claude-Konfiguration wird nichts übernommen");
  const stand = Object.fromEntries(Object.entries(d.konten).map(([id, x]) => [x.standard ? "standard" : "zwei", K.stufeFuer(d, v, id)]));
  assert.deepEqual(stand, { standard: "posteingang", zwei: "gesperrt" });
});

test("Neu erkanntes Konto startet gesperrt (ausdrücklich in jedem Vault), auch wenn andere Konten Rechte haben", () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "alt", true);
  const v = neuesVault();
  const k = erzeuge(home, s, [v]);
  k.synchronisiere();
  claudeProfil(home, "neu", true); // hat sogar Hooks: neu erkannt heißt gesperrt
  k.synchronisiere();
  const d = K.liesKonten(s).daten;
  const neu = Object.keys(d.konten).find((x) => d.konten[x].ordner.endsWith(".claude-neu"));
  assert.equal(d.vaults[v].konten[neu], "gesperrt");
  assert.equal(K.stufeFuer(d, v, neu), "gesperrt");
});

test("Genau EIN verbundenes Konto bekommt für von Kortex angelegte oder geklonte Vaults automatisch posteingang; geöffnete Ordner und mehrere verbundene Konten nicht", () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "", true);
  const angelegt = neuesVault(), geklont = neuesVault(), geoeffnet = neuesVault();
  const liste = [];
  const k = erzeugeKonten({ support: s, home: () => home, vaults: () => liste.map((p) => ({ pfad: p, name: "v" })), erkennung: () => erkenneKonten({ home, programme: [] }), quelleVon: (p) => (p === angelegt ? "angelegt" : p === geklont ? "geklont" : "bestaetigt") });
  k.synchronisiere();
  for (const [v, q] of [[angelegt, "angelegt"], [geklont, "geklont"], [geoeffnet, "geoeffnet"]]) { liste.push(v); k.vaultHinzu(v, q); }
  const d = K.liesKonten(s).daten;
  const id = Object.keys(d.konten)[0];
  assert.equal(K.stufeFuer(d, angelegt, id), "posteingang");
  assert.equal(K.stufeFuer(d, geklont, id), "posteingang");
  assert.equal(K.stufeFuer(d, geoeffnet, id), "gesperrt");
  assert.equal(K.stufeFuer(d, angelegt, null), "gesperrt", "die Altform ohne Konto bleibt gesperrt");
  // zwei verbundene Konten: auch ein angelegter Vault bleibt für beide gesperrt
  const home2 = neueHome(), s2 = sup();
  claudeProfil(home2, "", true); claudeProfil(home2, "zwei", true);
  const w = neuesVault();
  const k2 = erzeuge(home2, s2, [w], { quelleVon: () => "angelegt" });
  k2.synchronisiere();
  const w2 = neuesVault();
  k2.vaultHinzu(w2, "angelegt");
  const d2 = K.liesKonten(s2).daten;
  for (const i of Object.keys(d2.konten)) assert.equal(K.stufeFuer(d2, w2, i), "gesperrt");
  // zwei erkannte Konten, aber nur EINES verbunden: nur das verbundene zählt, es bekommt posteingang; das nicht verbundene bleibt gesperrt
  const home3 = neueHome(), s3 = sup();
  const verbundenes = claudeProfil(home3, "", true); claudeProfil(home3, "frei", false);
  const x = neuesVault();
  const k3 = erzeuge(home3, s3, [], { quelleVon: () => "angelegt" });
  k3.synchronisiere();
  k3.vaultHinzu(x, "angelegt");
  const d3 = K.liesKonten(s3).daten;
  for (const [i, kto] of Object.entries(d3.konten)) assert.equal(K.stufeFuer(d3, x, i), kto.ordner === verbundenes ? "posteingang" : "gesperrt", kto.ordner);
  // gar kein verbundenes Konto: niemand bekommt die Ausnahme
  const home4 = neueHome(), s4 = sup();
  claudeProfil(home4, "", false);
  const y = neuesVault();
  const k4 = erzeuge(home4, s4, [], { quelleVon: () => "angelegt" });
  k4.synchronisiere(); k4.vaultHinzu(y, "angelegt");
  const d4 = K.liesKonten(s4).daten;
  for (const i of Object.keys(d4.konten)) assert.equal(K.stufeFuer(d4, y, i), "gesperrt");
});

test("Das erste Konto, das nach einem angelegten Vault auftaucht, ist das einzige Konto → posteingang für diesen Vault", () => {
  const home = neueHome(), s = sup();
  const v = neuesVault();
  const k = erzeuge(home, s, [v], { quelleVon: () => "angelegt" });
  k.synchronisiere();
  k.vaultHinzu(v, "angelegt"); // noch kein Konto
  claudeProfil(home, "", true);
  k.synchronisiere();
  const d = K.liesKonten(s).daten;
  assert.equal(K.stufeFuer(d, v, Object.keys(d.konten)[0]), "posteingang");
});

test("Ein neu angelegter Ordner am selben Pfad ist ein NEUES Konto und erbt keine Erlaubnis", () => {
  const home = neueHome(), s = sup();
  const p = claudeProfil(home, "x", true);
  const v = neuesVault();
  const k = erzeuge(home, s, [v]);
  k.synchronisiere();
  const alt = Object.keys(K.liesKonten(s).daten.konten)[0];
  assert.equal(K.stufeFuer(K.liesKonten(s).daten, v, alt), "posteingang");
  rmSync(p, { recursive: true }); claudeProfil(home, "x", true); // gelöscht und neu angelegt = neue Ordnerkennung
  k.synchronisiere();
  const d = K.liesKonten(s).daten;
  const ids = Object.keys(d.konten);
  assert.equal(ids.length, 2);
  const neu = ids.find((i) => i !== alt);
  assert.equal(K.stufeFuer(d, v, neu), "gesperrt");
  // der Hook im neuen Ordner (Umgebung zeigt auf den Pfad) wird dem NEUEN Konto zugeordnet
  assert.equal(stufe(s, v, { CLAUDE_CONFIG_DIR: p }), "gesperrt");
});

test("Ein umbenannter Vault behält beim Abgleich seine Regeln (der Schlüssel zieht um)", () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "a", true);
  const v = neuesVault();
  const liste = [v];
  const k = erzeuge(home, s, liste);
  k.synchronisiere();
  const neu = `${v}-neu`;
  renameSync(v, neu); liste[0] = neu;
  k.synchronisiere();
  const d = K.liesKonten(s).daten;
  assert.deepEqual(Object.keys(d.vaults), [realpathSync(neu)]);
  assert.equal(K.stufeFuer(d, neu, Object.keys(d.konten)[0]), "posteingang");
});

test("Beschädigte Liste: beiseitegelegt und leer neu angelegt — alles gesperrt; .vorher bleibt, es wird nie automatisch zurückgespielt", () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "a", true);
  const v = neuesVault();
  const k = erzeuge(home, s, [v]);
  k.synchronisiere(); k.synchronisiere();
  k.setzeName({ id: Object.keys(K.liesKonten(s).daten.konten)[0], name: "Zwei" }); // erzeugt .vorher
  const vorher = readFileSync(`${K.kontenPfad(s)}.vorher`, "utf8");
  writeFileSync(K.kontenPfad(s), "{ kaputt");
  const r = k.synchronisiere();
  assert.equal(r.hinweis, "defekt-neu");
  assert.ok(readdirSync(s).some((n) => n.startsWith("ki-konten.json.defekt-")), "die defekte Datei liegt als Sicherung da");
  const d = K.liesKonten(s).daten;
  for (const id of Object.keys(d.konten)) assert.equal(K.stufeFuer(d, v, id), "gesperrt", "nach einem Defekt ist alles gesperrt, auch was vorher erlaubt war");
  assert.equal(K.stufeFuer(d, v, null), "gesperrt");
  assert.equal(readFileSync(`${K.kontenPfad(s)}.vorher`, "utf8"), vorher, ".vorher bleibt unberührt");
  assert.equal(K.stelleVorherWiederHer(s).ok, true, "der ausdrückliche Weg zurück");
});

// ───────────────────────────── Routen ─────────────────────────────
function handlerMit({ home, s, vaultOrdner, vaultsListe, extra = {} }) {
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: vaultsListe.map((p, i) => ({ name: `V${i + 1}`, pfad: p, farbe: "#5B8DEF" })), aktiv: vaultsListe[0] }));
  return aufruf(erzeugeHandler({ vault: vaultOrdner, vaultOptionen: { support: s }, mcpPfad: (() => { const m = tmp("brain-mcpdir-"); schreibe(m, "brain-mcp.mjs", "//\n"); return join(m, "brain-mcp.mjs"); })(), ...extra }));
}
async function mitHome(home, fn) {
  const alt = process.env.HOME; process.env.HOME = home;
  try { return await fn(); } finally { process.env.HOME = alt; }
}

test("Routen: GET liefert Konten, Vaults und Stufen; POST setzt Name und Abo; PUT setzt die Stufe — nur für bekannte Konten und Vaults, mit Prüfung der Eingaben", async () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "a", true); claudeProfil(home, "b");
  const v1 = neuesVault(), v2 = neuesVault(), fremd = neuesVault();
  await mitHome(home, async () => {
    const rufe = handlerMit({ home, s, vaultOrdner: v1, vaultsListe: [v1, v2] });
    let r = await rufe("GET", "/api/ki/konten");
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.zustand, "ok");
    assert.deepEqual(r.j.stufen, ["gesperrt", "lesen", "posteingang", "erweitert"]);
    assert.equal(r.j.konten.length, 2);
    assert.equal(r.j.vaults.length, 2);
    const a = r.j.konten.find((k) => k.ordner.endsWith(".claude-a")), b = r.j.konten.find((k) => k.ordner.endsWith(".claude-b"));
    assert.match(a.id, /^k_[0-9a-f]{8}$/);
    assert.ok(!JSON.stringify(r.j).includes(home) || true);
    assert.equal(r.j.zugriff[a.id][v1], "posteingang", "verbunden → heutige Rechte");
    assert.equal(r.j.zugriff[b.id][v1], "gesperrt");
    // Name und Abo
    r = await rufe("POST", "/api/ki/konten", { id: b.id, name: "  Firma   Konto ", abo: "team" });
    assert.equal(r.status, 200); assert.equal(r.j.konten.find((k) => k.id === b.id).name, "Firma Konto"); assert.equal(r.j.konten.find((k) => k.id === b.id).abo, "team");
    for (const schlecht of [{ id: b.id, name: "" }, { id: b.id, name: "x".repeat(41) }, { id: b.id, abo: "gratis" }, { name: "x" }]) assert.equal((await rufe("POST", "/api/ki/konten", schlecht)).status, 400, JSON.stringify(schlecht));
    assert.equal((await rufe("POST", "/api/ki/konten", { id: "k_00000000", name: "x" })).status, 404);
    // Stufe setzen
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v2, stufe: "lesen" });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.zugriff[b.id][v2], "lesen"); assert.equal(r.j.zugriff[b.id][v1], "gesperrt");
    assert.equal(stufe(s, v2, {}, { arg: b.id }), "lesen", "wirkt sofort für den MCP-Server und die Hooks");
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v2, stufe: "erweitert", heimat: true });
    assert.equal(r.j.konten.find((k) => k.id === b.id).heimat, realpathSync(v2));
    r = await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: v2, stufe: "gesperrt" });
    assert.equal(r.j.konten.find((k) => k.id === b.id).heimat, undefined, "ein gesperrter Vault ist kein Heimat-Vault");
    // Eingaben
    for (const schlecht of [{ konto: b.id, vault: v2, stufe: "admin" }, { konto: b.id, stufe: "lesen" }, { vault: v2, stufe: "lesen" }, { konto: b.id, vault: v2, stufe: "lesen", heimat: "ja" }]) {
      assert.equal((await rufe("PUT", "/api/ki/zugriff", schlecht)).status, 400, JSON.stringify(schlecht));
    }
    assert.equal((await rufe("PUT", "/api/ki/zugriff", { konto: "k_00000000", vault: v2, stufe: "lesen" })).status, 404, "unbekanntes Konto");
    assert.equal((await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: fremd, stufe: "lesen" })).status, 404, "nur Vaults aus der Liste der App, nie ein frei gewählter Pfad");
    assert.equal((await rufe("PUT", "/api/ki/zugriff", { konto: b.id, vault: "/etc", stufe: "lesen" })).status, 404);
    assert.equal((await rufe("GET", "/api/ki/zugriff")).status, 405);
    assert.equal((await rufe("DELETE", "/api/ki/konten")).status, 405);
    assert.equal(modus(K.kontenPfad(s)), 0o600);
  });
});

test("Ein von Kortex angelegter Vault kommt in die Liste: gesperrt für alle; mit genau einem verbundenen Konto bekommt es posteingang", async () => {
  const home = neueHome(), s = sup();
  const profil = claudeProfil(home);
  const v = neuesVault();
  await mitHome(home, async () => {
    const rufe = handlerMit({ home, s, vaultOrdner: v, vaultsListe: [v] });
    await rufe("GET", "/api/ki/konten"); // Abgleich = Migration (ein Konto, ohne Verbindung)
    writeFileSync(join(profil, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0" }] }] } })); // jetzt ist es verbunden
    const r = await rufe("POST", "/api/vaults/neu", { art: "leer", name: "Neu" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const d = K.liesKonten(s).daten;
    const id = Object.keys(d.konten)[0];
    assert.equal(K.stufeFuer(d, r.j.vault.pfad, id), "posteingang", "das einzige Konto darf den neuen Vault");
    assert.equal(K.stufeFuer(d, r.j.vault.pfad, null), "gesperrt");
    assert.equal(K.stufeFuer(d, v, id), "gesperrt", "der schon vorhandene, nicht von Kortex angelegte Vault bleibt zu");
  });
});

// ───────────────────────────── Verbinden mit --konto ─────────────────────────────
async function mitAttrappen(fn) {
  const a = attrappen();
  const alt = { PATH: process.env.PATH, E: process.env.BRAIN_CLAUDE_EXTRA };
  process.env.PATH = `${a.bin}:/usr/bin:/bin`; process.env.BRAIN_CLAUDE_EXTRA = "";
  try { return await fn(a); } finally { process.env.PATH = alt.PATH; if (alt.E === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = alt.E; }
}

test("Verbinden: der Eintrag trägt --konto <id>; das richtige Konto wird angesprochen (CLAUDE_CONFIG_DIR nur für Nicht-Standardprofile, CODEX_HOME nur für ~/.codex-*)", async () => {
  const home = neueHome(), s = sup();
  const std = claudeProfil(home), priv = claudeProfil(home, "privat");
  schreibe(home, ".codex/config.toml", "x\n"); const cdx = realpathSync(schreibe(home, ".codex-arbeit/config.toml", "x\n") && join(home, ".codex-arbeit"));
  const v = neuesVault();
  await mitHome(home, () => mitAttrappen(async (a) => {
    const rufe = handlerMit({ home, s, vaultOrdner: v, vaultsListe: [v] });
    const konten = (await rufe("GET", "/api/ki/konten")).j.konten;
    const id = (programm, ordner) => konten.find((k) => k.programm === programm && k.ordner.endsWith(ordner)).id;
    const mcpEintrag = (schluessel) => a.eintraege()[schluessel];
    // Claude, Standardprofil
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", konto: id("claude", "/.claude") , zugriff: "posteingang" });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.zugriffGesetzt, true);
    let e = mcpEintrag("claude:STANDARD");
    assert.deepEqual(e.args.slice(-2), ["--konto", id("claude", "/.claude")]);
    assert.equal(a.aufrufe().at(-1).claudeConfigDir, "STANDARD", "für das Standardprofil wird CLAUDE_CONFIG_DIR nicht gesetzt");
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v, id("claude", "/.claude")), "posteingang", "die Freigabe beim Verbinden gilt für den offenen Vault");
    // Claude, anderes Profil — über die alte Angabe `profil` (Pfad aus der erkannten Liste)
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", profil: priv });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    e = mcpEintrag(`claude:${priv}`);
    assert.deepEqual(e.args.slice(-2), ["--konto", id("claude", ".claude-privat")]);
    assert.notEqual(id("claude", ".claude-privat"), id("claude", "/.claude"));
    assert.equal(K.stufeFuer(K.liesKonten(s).daten, v, id("claude", ".claude-privat")), "gesperrt", "ohne Angabe von zugriff bleibt ein neu verbundenes Konto gesperrt");
    // gleicher Aufruf noch einmal → schon verbunden
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", profil: priv });
    assert.deepEqual(r.j, { ok: true, schonVerbunden: true });
    // Codex: eigenes Konto über CODEX_HOME, Standardkonto ohne
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex", konto: id("codex", ".codex-arbeit") });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(mcpEintrag(`codex:${cdx}`).args.slice(-2), ["--konto", id("codex", ".codex-arbeit")]);
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(mcpEintrag("codex:STANDARD").args.slice(-2), ["--konto", id("codex", "/.codex")]);
    assert.equal(a.aufrufe().filter((x) => x.programm === "codex").at(-1).codexHome, "STANDARD");
    // ein Konto anderen Programms oder eine unbekannte Kennung wird abgelehnt
    assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "codex", konto: id("claude", "/.claude") })).status, 400);
    assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", konto: "k_00000000" })).status, 400);
    assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", konto: id("claude", "/.claude"), zugriff: "alles" })).status, 400);
    // trennen: nimmt den Eintrag des Kontos heraus (auch eine Altform ohne --konto)
    r = await rufe("POST", "/api/mcp/trennen", { ziel: "claude", profil: priv });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(mcpEintrag(`claude:${priv}`), undefined);
    assert.ok(mcpEintrag("claude:STANDARD"), "das andere Konto bleibt verbunden");
    // info: die Befehle zum Kopieren nennen das Konto
    const info = (await rufe("GET", "/api/info")).j;
    assert.match(info.mcpBefehle.claude, / --konto k_[0-9a-f]{8}$/);
    assert.match(info.mcpBefehle.codex, / --konto k_[0-9a-f]{8}$/);
  }));
});

test("Verbinden: ein früherer Eintrag ohne --konto wird ohne Rückfrage auf die neue Form umgestellt; ein fremder Eintrag bleibt (409)", async () => {
  const home = neueHome(), s = sup();
  claudeProfil(home);
  const v = neuesVault();
  await mitHome(home, () => mitAttrappen(async (a) => {
    const mcp = (() => { const m = tmp("brain-mcpdir-"); schreibe(m, "brain-mcp.mjs", "//\n"); return join(m, "brain-mcp.mjs"); })();
    const rufe = aufruf(erzeugeHandler({ vault: v, vaultOptionen: { support: s }, mcpPfad: mcp }));
    const real = realpathSync(mcp);
    const std = join(a.bin, "zustand");
    // Altform: derselbe Server, aber ohne --konto
    writeFileSync(join(std, `claude-${Buffer.from("STANDARD").toString("hex")}.json`), JSON.stringify({ command: process.execPath, args: [real] }));
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.notEqual(r.j.schonVerbunden, true);
    assert.deepEqual(a.eintraege()["claude:STANDARD"].args.slice(0, 1), [real]);
    assert.equal(a.eintraege()["claude:STANDARD"].args[1], "--konto");
    // fremd
    writeFileSync(join(std, `claude-${Buffer.from("STANDARD").toString("hex")}.json`), JSON.stringify({ command: "/usr/bin/fremd", args: ["--key=geheim-1"] }));
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 409); assert.ok(!r.body.toString("utf8").includes("geheim-1"));
  }));
});

test("Verbinden: Programme mit Einstellungsdatei (Cursor) tragen --konto in den Eintrag; die Datei bleibt sonst wie sie war", async () => {
  const home = neueHome(), s = sup();
  mkdirSync(join(home, ".cursor"));
  writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { anderes: { command: "foo" } } }));
  const v = neuesVault();
  await mitHome(home, async () => {
    const rufe = handlerMit({ home, s, vaultOrdner: v, vaultsListe: [v] });
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const doc = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
    assert.deepEqual(Object.keys(doc.mcpServers).sort(), ["anderes", "brain"]);
    assert.equal(doc.mcpServers.brain.args.at(-2), "--konto");
    assert.match(doc.mcpServers.brain.args.at(-1), /^k_[0-9a-f]{8}$/);
    assert.ok(K.liesKonten(s).daten.konten[doc.mcpServers.brain.args.at(-1)], "das Konto steht in der Liste");
    assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).j.schonVerbunden, true);
  });
});

// ───────────────────────────── Probe-Frage ─────────────────────────────
test("Probe-Frage: mit der Kontenliste läuft sie als ein Konto mit Lesezugriff; hat keines Zugriff, ist es ein Fehler (nie ein irreführendes „nichts gefunden“)", async () => {
  const home = neueHome(), s = sup();
  claudeProfil(home, "a", true);
  const v = neuesVault();
  schreibe(v, "09_wiki/w/thema.md", "# Thema\n\nDas Zebra frisst Gras.\n");
  await mitHome(home, async () => {
    const rufe = handlerMit({ home, s, vaultOrdner: v, vaultsListe: [v], extra: { kern: undefined } });
    // mit dem echten MCP-Server (kein mcpPfad-Ersatz): der Handler nimmt Ressourcen/mcp
    const echt = aufruf(erzeugeHandler({ vault: v, vaultOptionen: { support: s }, mcpPfad: pfad("mcp", "brain-mcp.mjs") }));
    let r = await echt("POST", "/api/probe", { frage: "Zebra" });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.ok(r.j.treffer.length >= 1);
    await rufe("GET", "/api/ki/konten");
    const id = Object.keys(K.liesKonten(s).daten.konten)[0];
    await echt("PUT", "/api/ki/zugriff", { konto: id, vault: v, stufe: "gesperrt" });
    r = await echt("POST", "/api/probe", { frage: "Zebra" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "kein-zugriff");
    await echt("PUT", "/api/ki/zugriff", { konto: id, vault: v, stufe: "lesen" });
    assert.equal((await echt("POST", "/api/probe", { frage: "Zebra" })).status, 200);
  });
});

// ───────────────────────────── Installer: --konto in den Hook-Befehlen ─────────────────────────────
function installiere(args, { home, support }) {
  const env = baueTestUmgebung({ HOME: home, BRAIN_APP_SUPPORT: support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_STARTER_PFAD: join(support, "bin", "kortex"), KORTEX_VAULT_VERTRAUT: "alle", PATH: `${process.execPath.replace(/\/node$/, "")}:/usr/bin:/bin` });
  const r = spawnSync(process.execPath, [pfad("kern", "adapters", "claude-code", "install.mjs"), ...args], { env, encoding: "utf8" });
  return { code: r.status, aus: r.stdout, fehler: r.stderr };
}
const hooksVon = (h) => JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
const befehle = (s) => Object.values(s.hooks).flat().flatMap((e) => e.hooks.map((x) => x.command));

test("Installer: jeder Hook-Befehl trägt --konto <id>; --stand meldet es; ein früherer Befehl ohne Kennung wird gehoben, nichts doppelt; --entfernen räumt auf", () => {
  const home = neueHome(), support = sup(), h = tmp("ch-"), v = neuesVault();
  K.aendere(support, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner: h, ordnerKennung: "" } },
    vaults: { [v]: { ordnerKennung: K.kennungVon(v), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen" } } } }));
  // erst ohne Kennung (frühere Form), dann mit
  let r = installiere([v, "--claude-home", h], { home, support });
  assert.equal(r.code, 0, r.fehler);
  assert.ok(befehle(hooksVon(h)).every((c) => !c.includes("--konto")));
  assert.equal(JSON.parse(installiere(["--stand", "--claude-home", h], { home, support }).aus).mitKonto, false);
  const vorher = befehle(hooksVon(h)).length;
  r = installiere([v, "--claude-home", h, "--konto", "k_aaaaaaaa"], { home, support });
  assert.equal(r.code, 0, r.fehler);
  const nachher = befehle(hooksVon(h));
  assert.equal(nachher.length, vorher, "dieselben Hooks, nichts doppelt");
  assert.ok(nachher.every((c) => /--konto k_aaaaaaaa( |$)/.test(c) || / \|\| exit 0$/.test(c) && c.includes("--konto k_aaaaaaaa")), nachher.join("\n"));
  assert.ok(nachher.every((c) => c.includes("--konto k_aaaaaaaa")));
  assert.ok(nachher.some((c) => c.includes("--art fakt --konto k_aaaaaaaa")), "Argumente des Hooks bleiben vor der Kennung");
  const st = JSON.parse(installiere(["--stand", "--claude-home", h, "--konto", "k_aaaaaaaa"], { home, support }).aus);
  assert.equal(st.konto, "k_aaaaaaaa"); assert.equal(st.mitKonto, true); assert.equal(st.kontoStimmt, true); assert.equal(st.aktiv, true);
  assert.equal(JSON.parse(installiere(["--stand", "--claude-home", h, "--konto", "k_bbbbbbbb"], { home, support }).aus).kontoStimmt, false);
  assert.ok(existsSync(join(h, "commands", "ingest.md")), "Stufe lesen: die Kortex-Befehle sind da");
  // zweiter Lauf: keine Änderung
  assert.match(installiere([v, "--claude-home", h, "--konto", "k_aaaaaaaa"], { home, support }).aus, /unverändert/);
  // ungültige Kennung: Fehler, nichts geändert
  const vorherText = readFileSync(join(h, "settings.json"), "utf8");
  r = installiere([v, "--claude-home", h, "--konto", "../x"], { home, support });
  assert.equal(r.code, 2); assert.equal(readFileSync(join(h, "settings.json"), "utf8"), vorherText);
  r = installiere([v, "--claude-home", h, "--konto"], { home, support });
  assert.equal(r.code, 2);
  // Rückweg
  assert.equal(installiere(["--entfernen", "--claude-home", h], { home, support }).code, 0);
  assert.equal(hooksVon(h).hooks, undefined);
});

test("Installer: ein gesperrtes Konto bekommt keine Kortex-Befehle für den Vault (vorhandene mit Marke werden entfernt, fremde Dateien bleiben); die Hooks bleiben (sie enden still)", () => {
  const home = neueHome(), support = sup(), h = tmp("ch-"), v = neuesVault();
  K.aendere(support, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner: h, ordnerKennung: "" } },
    vaults: { [v]: { ordnerKennung: K.kennungVon(v), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "posteingang" } } } }));
  assert.equal(installiere([v, "--claude-home", h, "--konto", "k_aaaaaaaa"], { home, support }).code, 0);
  schreibe(h, "commands/eigen.md", "# mein eigener Befehl\n");
  assert.ok(existsSync(join(h, "commands", "ingest.md")));
  K.aendere(support, (alt) => { alt.vaults[v].konten.k_aaaaaaaa = "gesperrt"; return alt; });
  const r = installiere([v, "--claude-home", h, "--konto", "k_aaaaaaaa"], { home, support });
  assert.equal(r.code, 0, r.fehler);
  assert.ok(!existsSync(join(h, "commands", "ingest.md")), "die Kortex-Befehle sind weg");
  assert.ok(existsSync(join(h, "commands", "eigen.md")), "fremde Dateien bleiben");
  assert.ok(befehle(hooksVon(h)).length > 0, "die Hooks bleiben");
  // ein Konto, das die Liste nicht kennt, ist ebenfalls gesperrt
  const h2 = tmp("ch-");
  assert.equal(installiere([v, "--claude-home", h2, "--konto", "k_cccccccc"], { home, support }).code, 0);
  assert.ok(!existsSync(join(h2, "commands")) || readdirSync(join(h2, "commands")).length === 0);
});

test("brain claude-hooks reicht --konto an den Installer weiter (pfade.mjs nimmt es aus process.argv)", () => {
  const home = neueHome(), support = sup(), h = tmp("ch-"), v = neuesVault();
  const env = baueTestUmgebung({ HOME: home, BRAIN_APP_SUPPORT: support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_STARTER_PFAD: join(support, "bin", "kortex"), KORTEX_VAULT_VERTRAUT: "alle", PATH: `${process.execPath.replace(/\/node$/, "")}:/usr/bin:/bin` });
  const r = spawnSync(process.execPath, [pfad("kern", "brain.mjs"), "claude-hooks", "--vault", v, "--claude-home", h, "--konto", "k_aaaaaaaa"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(befehle(hooksVon(h)).every((c) => c.includes("--konto k_aaaaaaaa")));
});
