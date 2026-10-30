// KI-Konten (docs/plaene/ki-konten.md, P1): der ECHTE MCP-Server über stdio gegen Wegwerf-Vaults. Jede Stufe, jedes Werkzeug; gesperrte Vaults tauchen weder mit Namen
// noch mit Pfad noch als Zahl auf; der Entzug wirkt ohne Neustart; Widerspruch zwischen --konto und Umgebung gilt als das strengere Recht; eine beschädigte Liste liefert nichts.
// Die Kindprozess-Umgebung wird ausdrücklich gebaut (baueTestUmgebung) — nichts vom Rechner kommt hinein.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const kinder = [];
after(() => { for (const k of kinder) try { k.kill("SIGKILL"); } catch { /* weg */ } });

const GEHEIM = "Geheimprojekt-Nordlicht"; // steht nur im gesperrten Vault: darf nirgends in einer Antwort auftauchen
function szenario() {
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const offen = realpathSync(tmp("vault-offen-")), zu = realpathSync(tmp("vault-zu-"));
  for (const [v, text] of [[offen, "Das Zebra frisst Gras."], [zu, `${GEHEIM} ist vertraulich.`]]) {
    schreibe(v, "brain.config.json", "{}\n");
    schreibe(v, "09_wiki/w/thema.md", `# Thema\n\n${text}\n`);
    schreibe(v, "00_inbox/n.md", "# N\n");
  }
  const profil = (n) => { const p = join(home, `.claude-${n}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil("a"), b = profil("b");
  const schreibeListe = (aktiv) => writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Offen", pfad: offen, farbe: "#5B8DEF" }, { name: "Zu", pfad: zu, farbe: "#E5734F" }], aktiv }));
  schreibeListe(offen);
  const setze = (stufeA, stufeB = "gesperrt", extra = {}) => K.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "A", ordnerKennung: K.kennungVon(a), ...(extra.heimat ? { heimat: extra.heimat } : {}) },
      k_bbbbbbbb: { programm: "claude", ordner: b, standard: false, name: "B", ordnerKennung: K.kennungVon(b) } },
    vaults: {
      [offen]: { ordnerKennung: K.kennungVon(offen), neueKonten: "gesperrt", ohneKonto: extra.ohneKonto || "gesperrt", konten: { k_aaaaaaaa: stufeA, k_bbbbbbbb: stufeB } },
      [zu]: { ordnerKennung: K.kennungVon(zu), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "gesperrt", k_bbbbbbbb: "gesperrt" } },
    } }));
  setze("posteingang");
  return { home, support, offen, zu, a, b, schreibeListe, setze };
}

function starteMcp(s, args = [], envExtra = {}) {
  const env = baueTestUmgebung({ HOME: s.home, BRAIN_APP_SUPPORT: s.support, KORTEX_VAULT_VERTRAUT: "alle", ...envExtra });
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), ...args], { stdio: ["pipe", "pipe", "pipe"], env, cwd: s.home });
  kinder.push(p);
  const wartende = [], antworten = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  let stderr = ""; p.stderr.on("data", (d) => { stderr += d; });
  const naechste = () => new Promise((ok) => { const a = antworten.shift(); if (a) ok(a); else wartende.push(ok); });
  let n = 0;
  const frage = async (method, params) => { const id = ++n; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const a = await naechste(); assert.equal(a.id, id); return a; };
  const rufe = async (name, a = {}) => { const r = (await frage("tools/call", { name, arguments: a })).result; return { text: r.content.map((c) => c.text).join("\n"), fehler: r.isError === true, roh: r }; };
  const werkzeuge = async () => (await frage("tools/list")).result.tools.map((t) => t.name);
  const ende = () => new Promise((ok) => { p.on("close", ok); p.stdin.end(); });
  return { p, frage, rufe, werkzeuge, ende, stderr: () => stderr };
}
// Kein Hinweis auf den gesperrten Vault: weder Name noch Pfad noch Inhalt noch eine zweite Zeile in der Liste.
const rein = (s, text) => { for (const g of [s.zu, "Zu —", GEHEIM, "vault-zu-"]) assert.ok(!text.includes(g), `„${g}“ darf nicht in der Antwort stehen:\n${text}`); };
const KEIN_ZUGRIFF = /kein Vault freigegeben/;

test("brain_vaults zeigt nur Vaults, die das Konto sehen darf — ein gesperrter erscheint weder mit Namen noch mit Pfad noch als Zahl", async () => {
  const s = szenario();
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  const t = (await m.rufe("brain_vaults")).text;
  assert.match(t, new RegExp(`1\\. \\* Offen — ${s.offen}`));
  assert.equal(t.split("\n").filter((z) => /^\d+\./.test(z.trim())).length, 1, t);
  rein(s, t);
  // der gesperrte Vault ist in der App der aktive: der Server nutzt ihn trotzdem nicht
  s.schreibeListe(s.zu);
  const r = await m.rufe("brain_suchen", { frage: "thema" });
  assert.equal(r.fehler, true); assert.match(r.text, KEIN_ZUGRIFF); rein(s, r.text);
  const v = (await m.rufe("brain_vaults")).text;
  rein(s, v); assert.ok(!/\(in der App aktiv\)/.test(v), "auch nicht als „in der App aktiv“");
  await m.ende();
});

test("Jedes Werkzeug je Stufe: gesperrt → nichts (ohne Pfad im Text) · lesen → lesen/suchen/kontext/gesundheit/verlauf, nicht merken · posteingang und erweitert → auch merken", async () => {
  const s = szenario();
  const alle = [["brain_suchen", { frage: "zebra" }], ["brain_lesen", { pfad: "09_wiki/w/thema.md" }], ["brain_kontext", { projekt: "thema" }], ["brain_gesundheit", {}], ["brain_verlauf", { pfad: "09_wiki/w/thema.md" }]];
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  for (const [stufeA, erwartung] of [["gesperrt", "nichts"], ["lesen", "lesen"], ["posteingang", "schreiben"], ["erweitert", "schreiben"]]) {
    s.setze(stufeA);
    const liste = await m.werkzeuge();
    if (erwartung === "nichts") {
      for (const [name, a] of [...alle, ["brain_merken", { text: "x" }]]) {
        const r = await m.rufe(name, a);
        assert.equal(r.fehler, true, `${name} bei ${stufeA}`); assert.match(r.text, KEIN_ZUGRIFF, name); rein(s, r.text);
        assert.ok(!r.text.includes(s.offen), "auch der Pfad des freigegebenen Vaults wird nicht genannt, wenn nichts freigegeben ist");
      }
      assert.ok(!liste.includes("brain_merken"));
      continue;
    }
    for (const [name, a] of alle) {
      const r = await m.rufe(name, a);
      // brain_verlauf braucht ein Versionsverzeichnis (der Wegwerf-Vault hat keines): hier zählt nur, dass die Stufe es nicht verweigert
      if (name === "brain_verlauf") assert.doesNotMatch(r.text, KEIN_ZUGRIFF); else assert.equal(r.fehler, false, `${name} bei ${stufeA}: ${r.text}`);
    }
    const merken = await m.rufe("brain_merken", { text: `Merke ${stufeA}`, titel: `Merke ${stufeA}` });
    if (erwartung === "lesen") {
      assert.equal(merken.fehler, true); assert.match(merken.text, /nur lesen/); assert.ok(!liste.includes("brain_merken"), "bei lesen nicht in tools/list");
      assert.equal(existsSync(join(s.offen, "00_inbox", "merke-lesen.md")), false);
    } else {
      assert.equal(merken.fehler, false, merken.text); assert.ok(liste.includes("brain_merken"));
    }
  }
  assert.equal(existsSync(join(s.zu, ".logs", "mcp.log")), false, "in den gesperrten Vault wird nichts geschrieben");
  await m.ende();
});

test("Der Entzug wirkt beim nächsten Aufruf — ohne Neustart des Servers; das Nutzungsprotokoll wird nur in einem erlaubten Vault geschrieben", async () => {
  const s = szenario();
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  assert.ok(existsSync(join(s.offen, ".logs", "mcp.log")));
  rmSync(join(s.offen, ".logs"), { recursive: true });
  s.setze("gesperrt");
  const r = await m.rufe("brain_suchen", { frage: "zebra" });
  assert.equal(r.fehler, true); assert.match(r.text, KEIN_ZUGRIFF);
  assert.equal(existsSync(join(s.offen, ".logs", "mcp.log")), false, "auch das Protokoll schweigt nach dem Entzug");
  s.setze("lesen");
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false, "und die Freigabe wirkt ebenso sofort");
  await m.ende();
});

test("Heimat-Vault: ist der aktive Vault gesperrt, folgt der Server dem Heimat-Vault des Kontos (falls erlaubt), sonst gibt es keinen Vault", async () => {
  const s = szenario();
  s.setze("posteingang", "gesperrt", { heimat: s.offen });
  s.schreibeListe(s.zu); // aktiv in der App: der gesperrte Vault
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  const r = await m.rufe("brain_suchen", { frage: "zebra" });
  assert.equal(r.fehler, false, r.text); assert.match(r.text, /Zebra/); rein(s, r.text);
  // ein Heimat-Vault, den das Konto nicht (mehr) sehen darf, zählt nicht
  s.setze("gesperrt", "gesperrt", { heimat: s.offen });
  const r2 = await m.rufe("brain_suchen", { frage: "zebra" });
  assert.equal(r2.fehler, true); assert.match(r2.text, KEIN_ZUGRIFF);
  // ein anderes Konto ohne Heimat bekommt ihn nicht
  const m2 = starteMcp(s, ["--konto", "k_bbbbbbbb"]);
  assert.match((await m2.rufe("brain_suchen", { frage: "zebra" })).text, KEIN_ZUGRIFF);
  await m.ende(); await m2.ende();
});

test("Widerspruch zwischen --konto und Umgebung: das strengere Recht gilt; ohne --konto bestimmt die Umgebung das Konto; ohne beides ohneKonto", async () => {
  const s = szenario();
  s.setze("posteingang", "gesperrt", { ohneKonto: "lesen" });
  // --konto A (posteingang), aber die Sitzung läuft im Profil B (gesperrt): B gewinnt
  let m = starteMcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: s.b });
  let r = await m.rufe("brain_suchen", { frage: "zebra" });
  assert.equal(r.fehler, true); assert.match(r.text, KEIN_ZUGRIFF); await m.ende();
  // Umgebung und Argument stimmen überein → A
  m = starteMcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: s.a });
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false); await m.ende();
  // nur Umgebung (alter Eintrag ohne --konto)
  m = starteMcp(s, [], { CLAUDE_CONFIG_DIR: s.a });
  assert.equal((await m.rufe("brain_merken", { text: "x", titel: "umgebung" })).fehler, false); await m.ende();
  m = starteMcp(s, [], { CLAUDE_CONFIG_DIR: s.b });
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, true); await m.ende();
  // weder Argument noch Umgebung: ohneKonto des Vaults (hier lesen)
  m = starteMcp(s, []);
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  assert.match((await m.rufe("brain_merken", { text: "x" })).text, /nur lesen/); await m.ende();
  // ein Ordner, den Kortex nicht als Konto kennt, ist gesperrt — auch wenn --konto ein erlaubtes Konto nennt
  m = starteMcp(s, ["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: tmp("brain-fremd-") });
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, true); await m.ende();
});

test("Ungültige, fehlende oder unterschiedliche --konto-Angaben ergeben ein unbekanntes Konto: gesperrt, kein Rückfall auf ohneKonto", async () => {
  const s = szenario();
  s.setze("posteingang", "gesperrt", { ohneKonto: "posteingang" });
  for (const args of [["--konto"], ["--konto", "--nur-lesen"], ["--konto", "../../etc"], ["--konto", "k_12345678"], ["--konto", "k_aaaaaaaa", "--konto", "k_bbbbbbbb"], ["--konto="], ["--konto=k_zzzzzzzz"]]) {
    const m = starteMcp(s, args);
    const r = await m.rufe("brain_suchen", { frage: "zebra" });
    assert.equal(r.fehler, true, args.join(" ")); assert.match(r.text, KEIN_ZUGRIFF); await m.ende();
  }
  // die Schreibweise mit = und ein Vault-Argument daneben funktionieren
  const m = starteMcp(s, ["--konto=k_aaaaaaaa", s.offen]);
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false); await m.ende();
});

test("Gebunden an einen Vault (Argument): die Stufe gilt trotzdem; ein gesperrter Vault bleibt zu; --nur-lesen deckelt jede Stufe auf lesen", async () => {
  const s = szenario();
  s.setze("erweitert");
  let m = starteMcp(s, ["--konto", "k_aaaaaaaa", "--vault", s.zu]);
  let r = await m.rufe("brain_suchen", { frage: "nordlicht" });
  assert.equal(r.fehler, true); rein(s, r.text); assert.equal(await m.werkzeuge().then((l) => l.includes("brain_merken")), false); await m.ende();
  m = starteMcp(s, ["--konto", "k_aaaaaaaa", "--vault", s.offen]);
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  assert.ok((await m.werkzeuge()).includes("brain_merken")); await m.ende();
  m = starteMcp(s, ["--konto", "k_aaaaaaaa", "--vault", s.offen, "--nur-lesen"]);
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  assert.equal((await m.rufe("brain_merken", { text: "x" })).fehler, true);
  assert.ok(!(await m.werkzeuge()).includes("brain_merken")); await m.ende();
});

test("Beschädigte Liste: der Server liefert nichts (auch nicht brain_vaults) und sagt es ohne Namen oder Pfade; fehlt die Liste, gilt das bisherige Verhalten", async () => {
  const s = szenario();
  const datei = K.kontenPfad(s.support);
  writeFileSync(datei, "{ kaputt");
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  for (const [name, a] of [["brain_suchen", { frage: "zebra" }], ["brain_lesen", { pfad: "09_wiki/w/thema.md" }], ["brain_kontext", { projekt: "t" }], ["brain_merken", { text: "x" }], ["brain_vaults", {}], ["brain_gesundheit", {}]]) {
    const r = await m.rufe(name, a);
    assert.equal(r.fehler, true, name); assert.match(r.text, /beschädigt/, name); rein(s, r.text); assert.ok(!r.text.includes(s.offen), name);
  }
  assert.ok(!(await m.werkzeuge()).includes("brain_merken"));
  // repariert (gültige Datei) → es geht sofort wieder
  rmSync(datei); s.setze("lesen");
  assert.equal((await m.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  // Liste weg (die neue App lief noch nie): Übergang, alles wie bisher — auch ohne Argument
  rmSync(datei); rmSync(`${datei}.vorher`, { force: true });
  assert.equal((await m.rufe("brain_merken", { text: "x", titel: "uebergang" })).fehler, false);
  await m.ende();
  const alt = starteMcp(s, []);
  assert.equal((await alt.rufe("brain_suchen", { frage: "zebra" })).fehler, false);
  assert.match((await alt.rufe("brain_vaults")).text, /Offen/);
  await alt.ende();
});

test("Ein Symlink an der Liste und ein Ordner dort sind wie eine beschädigte Datei: nichts wird geliefert", async () => {
  const s = szenario();
  const datei = K.kontenPfad(s.support);
  const kopie = join(tmp(), "kopie.json");
  writeFileSync(kopie, JSON.stringify({ version: 1, konten: {}, vaults: {} }));
  rmSync(datei);
  (await import("node:fs")).symlinkSync(kopie, datei);
  const m = starteMcp(s, ["--konto", "k_aaaaaaaa"]);
  assert.match((await m.rufe("brain_suchen", { frage: "zebra" })).text, /beschädigt/);
  await m.ende();
});

test("Ohne Vault in der App und ohne Freigabe sagt der Server in beiden Fällen dasselbe — er verrät nicht, ob es gesperrte Vaults gibt", async () => {
  const s = szenario();
  const leer = { home: s.home, support: tmp("brain-support-") };
  K.aendere(leer.support, () => K.leerDaten());
  const m1 = starteMcp(leer, []); // Liste da, aber keine Vaults
  const t1 = (await m1.rufe("brain_suchen", { frage: "x" })).text;
  s.setze("gesperrt");
  const m2 = starteMcp(s, ["--konto", "k_aaaaaaaa"]); // Vaults da, aber keiner freigegeben
  const t2 = (await m2.rufe("brain_suchen", { frage: "x" })).text;
  assert.equal(t1, t2);
  assert.equal((await m1.rufe("brain_vaults")).text, (await m2.rufe("brain_vaults")).text);
  await m1.ende(); await m2.ende();
});
