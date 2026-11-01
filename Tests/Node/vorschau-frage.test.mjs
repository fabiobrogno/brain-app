// „Frag deinen Vault“ in der Vorschau (scripts/vorschau.sh --mit-ki): Die Werkstatt gibt KORTEX_VORSCHAU — und nur das — an den claude-Platzhalter weiter,
// aber nur in einer echten Vorschau (Marke im Ordner, HOME darin). Der Platzhalter ist das echte Skript aus Sources/BrainCore/VorschauPlatzhalter.swift
// (zwischen den Marken), die Frage läuft durch die echte Frage-Funktion mit dem echten brain-mcp-Pfad. Alles in Temp-Ordnern, nie das echte claude oder HOME.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { baueFrageUmgebung, VORSCHAU_FRAGE_TEXT } = await import(pfad("werkstatt", "frage.mjs"));
const { vorschauOrdnerAus } = await import(pfad("gemeinsam", "basis.mjs"));
const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
after(() => { beendeAlleProzesse(); });

// Das Skript des claude-Platzhalters aus der Swift-Datei: Raw-String zwischen den Marken, `\#(schutz)` durch den Schutzblock ersetzt, Einrückung entfernt.
function platzhalterSkript() {
  const swift = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Sources", "BrainCore", "VorschauPlatzhalter.swift"), "utf8");
  const holeBlock = (anfang, ende) => {
    const i = swift.indexOf(anfang), j = swift.indexOf(ende, i + anfang.length);
    assert.ok(i >= 0 && j > i, `Marke fehlt: ${anfang}`);
    const zeilen = swift.slice(i + anfang.length, j).replace(/^\n/, "").split("\n");
    const einzug = Math.min(...zeilen.filter((z) => z.trim()).map((z) => z.match(/^ */)[0].length));
    return zeilen.map((z) => z.slice(einzug)).join("\n").replace(/\n+$/, "\n");
  };
  const schutz = holeBlock('static let schutz = """', '"""').replace(/\n$/, "");
  return holeBlock('static let claude = #"""', '"""#').replace("\\#(schutz)", schutz);
}

// Ein Vorschau-Ordner wie ihn scripts/vorschau.sh anlegt (mit Marke), darin ein Vault mit drei Seiten und ein claude-Konto.
function vorschau({ marke = true, skript = platzhalterSkript() } = {}) {
  const vo = realpathSync(tmp("kortex-vorschau-"));
  if (marke) writeFileSync(join(vo, ".kortex-vorschau"), "");
  for (const u of ["home", "support", "bin", "tmp"]) mkdirSync(join(vo, u));
  const home = join(vo, "home"), support = join(vo, "support"), bin = join(vo, "bin");
  const vault = join(home, "vaults", "probe");
  schreibe(vault, "brain.config.json", "{}\n");
  schreibe(vault, "09_wiki/wissen/Kaffee.md", "---\ntitel: Kaffee\n---\n# Kaffee\n\nKaffee ist ein Heißgetränk aus gerösteten Bohnen.\n");
  schreibe(vault, "09_wiki/wissen/Mühle.md", "# Mühle\n\nEine Kaffeemühle mahlt Bohnen. Siehe [[Kaffee]].\n");
  schreibe(vault, "10_notizen/Reise.md", "# Reise\n\nFlug im Mai.\n");
  const profil = join(home, ".claude"); mkdirSync(profil); writeFileSync(join(profil, "settings.json"), "{}");
  const ordner = realpathSync(profil);
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Probe", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner, standard: true, name: "Standard", ordnerKennung: K.kennungVon(ordner), abo: "max" } },
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen" } } } }));
  writeFileSync(join(bin, "claude"), skript);
  chmodSync(join(bin, "claude"), 0o755);
  return { vo, home, support, bin, vault };
}

// Die Umgebung der Werkstatt, wie sie die App der Vorschau gibt (KORTEX_VORSCHAU, HOME, PATH nur mit dem Platzhalter-Ordner).
const werkstattEnv = (p, extra = {}) => baueTestUmgebung({ HOME: p.home, BRAIN_APP_SUPPORT: p.support, PATH: `${p.bin}:/usr/bin:/bin`, TMPDIR: join(p.vo, "tmp") + "/", KORTEX_VORSCHAU: p.vo, ...extra });

async function fragen(p, env, text = "Was ist Kaffee?") {
  const temp = realpathSync(tmp("kortex-frage-temp-"));
  const h = erzeugeHandler({ vault: p.vault, vaultOptionen: { support: p.support }, kontenHome: p.home, kontenErkennung: () => [], frageEnv: env, frageTemp: temp });
  const api = async (methode, pf, daten) => {
    const q = pf.indexOf("?");
    const r = await h({ methode, pfad: q < 0 ? pf : pf.slice(0, q), query: q < 0 ? null : pf.slice(q + 1), body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    return { status: r.status, j: JSON.parse(r.body.toString("utf8")) };
  };
  const s = await api("POST", "/api/frage/start", { frage: text, konto: "k_aaaaaaaa" });
  assert.equal(s.status, 200, JSON.stringify(s.j));
  for (let i = 0; i < 400; i++) {
    await new Promise((ok) => setTimeout(ok, 50));
    const r = await api("GET", `/api/frage/stand?id=${s.j.id}&ab=0&text=0&epoche=0`);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    if (r.j.fertig) return r.j;
  }
  assert.fail("Frage wird nicht fertig");
}

test("Vorschau: der Platzhalter antwortet auf Frag mit gekennzeichneter Beispielantwort und nennt echte Seiten des Vorschau-Vaults", async () => {
  const p = vorschau();
  const r = await fragen(p, werkstattEnv(p));
  assert.equal(r.ergebnis.ok, true, JSON.stringify(r.ergebnis));
  assert.match(r.ergebnis.text, /^Vorschau: So würde eine Antwort aussehen/);
  assert.match(r.ergebnis.text, /\[\[09_wiki\/wissen\/Kaffee\.md\]\]/, "die Frage nach Kaffee nennt die Kaffee-Seite");
  assert.equal(r.text, r.ergebnis.text, "der Text kam gestreamt und ist am Ende die fertige Antwort");
  assert.ok(r.quellen.length >= 1 && r.quellen.every((q) => q.art === "genannt"), JSON.stringify(r.quellen));
  assert.ok(r.quellen.some((q) => q.pfad === "09_wiki/wissen/Kaffee.md"));
  assert.equal(r.unbekannt, 0, "alle genannten Seiten gibt es im Vault");
  rmSync(p.vo, { recursive: true, force: true });
});

test("Vorschau: ohne die Variable verweigert der Platzhalter die Arbeit (Release-Verhalten: nichts wird weitergegeben)", async () => {
  const p = vorschau();
  // Die Werkstatt hat KORTEX_VORSCHAU nicht (wie in der echten App): Es wird nichts weitergegeben, der Platzhalter bricht ab. Hier ist es keine Vorschau, also bleibt der echte Fehlertext.
  const ohne = werkstattEnv(p); delete ohne.KORTEX_VORSCHAU;
  const r = await fragen(p, ohne);
  assert.equal(r.ergebnis.ok, false);
  assert.match(r.ergebnis.fehler, /KORTEX_VORSCHAU fehlt/);
  assert.notEqual(r.ergebnis.fehler, VORSCHAU_FRAGE_TEXT);
  rmSync(p.vo, { recursive: true, force: true });
});

test("Vorschau: scheitert die Frage trotzdem (der Platzhalter kann nicht alles), steht ein freundlicher Text statt eines internen Fehlers da", async () => {
  const p = vorschau({ skript: "#!/bin/sh\necho 'interner Fehler 123' >&2\nexit 3\n" });
  const r = await fragen(p, werkstattEnv(p));
  assert.equal(r.ergebnis.ok, false);
  assert.equal(r.ergebnis.fehler, VORSCHAU_FRAGE_TEXT);
  assert.match(r.ergebnis.fehler, /In der Vorschau antwortet ein Platzhalter statt Claude/);
  assert.doesNotMatch(r.ergebnis.fehler, /interner Fehler|Vorschau-Schutz/);
  rmSync(p.vo, { recursive: true, force: true });
});

test("baueFrageUmgebung: KORTEX_VORSCHAU geht nur in einer echten Vorschau durch (gültiger Pfad, Marke, HOME darin) — und nur diese Variable", () => {
  const p = vorschau();
  const konto = { ordner: join(p.home, ".claude"), standard: true };
  const bau = (basis, home) => baueFrageUmgebung({ basis, home, claudePfad: join(p.bin, "claude"), konto });
  const basis = { PATH: "/usr/bin", LANG: "de_DE.UTF-8", KORTEX_VORSCHAU: p.vo, KORTEX_ANDERES: "x", ANTHROPIC_API_KEY: "geheim", BRAIN_APP_SUPPORT: p.support };
  const e = bau(basis, p.home);
  assert.equal(e.KORTEX_VORSCHAU, p.vo);
  assert.equal(e.KORTEX_ANDERES, undefined);
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.BRAIN_APP_SUPPORT, undefined, "kein anderer Wert der Werkstatt geht durch");
  // Release: die Variable ist nicht gesetzt → nichts
  assert.equal(bau({ ...basis, KORTEX_VORSCHAU: undefined }, p.home).KORTEX_VORSCHAU, undefined);
  // HOME nicht im Vorschau-Ordner → nichts
  assert.equal(bau(basis, realpathSync(tmp("anderes-home-"))).KORTEX_VORSCHAU, undefined);
  // ungültiger Pfad (Leerzeichen, relativ, „..“, Schrägstrich am Ende) → nichts
  for (const falsch of ["relativ/pfad", `${p.vo}/../x`, `${p.vo}/`, `${p.vo} x`, ""]) assert.equal(bau({ ...basis, KORTEX_VORSCHAU: falsch }, p.home).KORTEX_VORSCHAU, undefined, `„${falsch}“`);
  // Ordner ohne Marke → nichts
  const o = vorschau({ marke: false });
  assert.equal(baueFrageUmgebung({ basis: { ...basis, KORTEX_VORSCHAU: o.vo }, home: o.home, claudePfad: join(o.bin, "claude"), konto: { ordner: join(o.home, ".claude"), standard: true } }).KORTEX_VORSCHAU, undefined);
  assert.equal(vorschauOrdnerAus({ KORTEX_VORSCHAU: o.vo }, o.home), null);
  assert.equal(vorschauOrdnerAus({ KORTEX_VORSCHAU: p.vo }, p.home), p.vo);
  assert.equal(vorschauOrdnerAus({}, p.home), null);
  assert.equal(vorschauOrdnerAus({ KORTEX_VORSCHAU: p.vo }, undefined), null);
  for (const d of [p, o]) rmSync(d.vo, { recursive: true, force: true });
});

test("Die übrigen Aufrufe von claude/codex in der Vorschau (KI verbinden, Prüfen, Kontingent, Pflege) behalten KORTEX_VORSCHAU: sie erben die Umgebung, nur Frag baut sie neu", async () => {
  const { kindUmgebung } = await import(pfad("gemeinsam", "basis.mjs"));
  const { codexUmgebung } = await import(pfad("gemeinsam", "kontingent.mjs"));
  const { mitProfil, mitCodexHome } = await import(pfad("werkstatt", "profile.mjs"));
  const { ohneFremdeAnmeldung } = await import(pfad("kern", "pflege-konto.mjs"));
  const p = vorschau();
  const alt = process.env.KORTEX_VORSCHAU;
  process.env.KORTEX_VORSCHAU = p.vo;
  try {
    const k = kindUmgebung({ CI: "1" });
    assert.equal(k.KORTEX_VORSCHAU, p.vo, "KI verbinden (mcp get/add/remove), Prüfen und die Versionsabfrage");
    assert.equal(mitProfil(k, { standard: true }).KORTEX_VORSCHAU, p.vo);
    assert.equal(mitCodexHome(codexUmgebung(k), { programm: "codex", standard: true }).KORTEX_VORSCHAU, p.vo, "Kontingent von Codex");
    assert.equal(ohneFremdeAnmeldung(k).KORTEX_VORSCHAU, p.vo, "Pflege");
  } finally { if (alt === undefined) delete process.env.KORTEX_VORSCHAU; else process.env.KORTEX_VORSCHAU = alt; }
  rmSync(p.vo, { recursive: true, force: true });
});
