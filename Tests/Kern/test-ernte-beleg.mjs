// .tools/tests/test-ernte-beleg.mjs — Ernte mit Zitat (B1, §4.1/§10): Zitat fehlt → ohneBeleg, ki → nurKi, web bleibt,
// eingespielter/eigener Text zählt nie, Werkzeug-Ausgaben im Haiku-Input gefiltert. Nur fake-claude, Temp-HOME, leerer PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const LEER_PATH = mkdtempSync(join(tmpdir(), "ernte-beleg-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "ernte-beleg-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
delete process.env.BRAIN_CLAUDE;
delete process.env.BRAIN_ERNTE;
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const { ernte, parseAntwort, saubereZitat, auftrag, leseTranskript, WERKZEUG_KOPF, MAX_JE_WERKZEUG } = await import("../ernte.mjs");
const { tempVault, tempOrdner, schreibeVerlauf } = await import("./verlauf-fixture.mjs");
const { gartenEintraege, GARTEN_SITZUNG, GARTEN_CWD } = await import("./fixture-garten.mjs");

const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";

function fakeAusgabe(ausgabe) {
  const d = mkdtempSync(join(tmpdir(), "ernte-beleg-fake-"));
  writeFileSync(join(d, "ausgabe.txt"), ausgabe);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "eingabe.txt"), FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt"), FAKE_CLAUDE_WARTE: "0", FAKE_CLAUDE_EXIT: "0", FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "" });
  return join(d, "eingabe.txt");
}
// Garten-Verlauf mit dem Temp-Vault als „eigenem Brain“ (Wiki-Read, Sitzung im Vault) + optional weitere Einträge.
function verlauf(v, extra = []) {
  const f = join(tempOrdner("Verlauf Brän"), "sitzung beleg.jsonl");
  schreibeVerlauf(f, [...gartenEintraege({ vault: v }), ...extra]);
  return f;
}
const lauf = (v, tr) => ernte(v, { art: "fakt", transkript: tr, sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: Date.UTC(2026, 9, 21, 9, 0, 0) });
const vorschlaege = (v) => { const d = join(v, "00_inbox", "_vorschlaege"); try { return readdirSync(d).map((n) => readFileSync(join(d, n), "utf8")); } catch { return []; } };
const logZeile = (v) => readFileSync(join(v, ".logs", "ernte.log"), "utf8").trim().split("\n").pop();

test("auftrag: verlangt je Vorschlag eine Zeile „Zitat:“ — wörtlich aus Nutzer/Werkzeug, Assistent belegt nichts", () => {
  for (const art of ["fakt", "stand"]) {
    const a = auftrag(art);
    assert.match(a, /Zitat: <Auszug>/);
    assert.match(a, /"Nutzer:" oder "Werkzeug \(…\):"/);
    assert.match(a, /Assistenten belegen nichts/);
  }
});

test("auftrag (Nachbesserung): ein Fakt = genau das, was sein Zitat trägt — Namen/Zahlen/Daten/Verneinungen ins Zitat, sonst teilen oder weglassen, keine Themen-Zitate, Reaktionen sind kein Beleg", () => {
  for (const art of ["fakt", "stand"]) {
    const a = auftrag(art);
    assert.match(a, /Ein Fakt .*= genau das, was sein Zitat wörtlich trägt/);
    assert.match(a, /zusammenhängender Auszug\s+\(bevorzugt ganze Sätze oder Zeilen, bis 300 Zeichen\)/);
    assert.match(a, /ALLE Namen, Zahlen, Daten und Verneinungen des Fakts/);
    assert.match(a, /teile den Fakt \(jeder Teil bekommt ein eigenes Zitat\) oder lass das Detail weg/);
    assert.match(a, /Kein Zitat, das nur das Thema berührt/);
    assert.match(a, /Nutzer-Reaktionen \(Lob, Ärger, „ok“, „mach weiter“\) sind nie Beleg für einen Sachverhalt/);
  }
  assert.match(auftrag("stand"), /ERSTE Zeile ist ein Kernsatz.*Zitat vollständig trägt.*weitere Zeilen sind optional/s);
  assert.doesNotMatch(auftrag("fakt"), /Kernsatz, den/);
});

test("ernte: der geschärfte Auftrag geht wirklich als Systemprompt an claude (fake-claude)", async () => {
  const v = tempVault();
  const log = fakeAusgabe("NICHTS\n");
  await lauf(v, verlauf(v));
  const { args } = JSON.parse(readFileSync(log + ".json", "utf8"));
  const sys = args[args.indexOf("--system-prompt") + 1];
  assert.equal(sys, auftrag("fakt"));
  assert.match(sys, /Ein Fakt .*= genau das, was sein Zitat wörtlich trägt/);
  assert.match(sys, /sind nie Beleg für einen Sachverhalt/);
});

test("parseAntwort: Zitat-Zeile wird abgetrennt — Vorsatz, Anführungs-Hülle, Fett; zählt nicht zu den 12 Stand-Zeilen", () => {
  const r = parseAntwort("### Möhren\nMöhren ab April.\nZitat: Werkzeug (Bash): „Möhren säen ab Mitte April in Reihe 3.“\n\n### Rasen\nRasen samstags.\n**Zitat:** Nutzer: \"Der Rasenmäher steht im Schuppen links.\"\n\n### Ohne\nKein Beleg.\n", "fakt");
  assert.deepEqual(r, [
    { titel: "Möhren", text: "Möhren ab April.", zitat: "Möhren säen ab Mitte April in Reihe 3." },
    { titel: "Rasen", text: "Rasen samstags.", zitat: "Der Rasenmäher steht im Schuppen links." },
    { titel: "Ohne", text: "Kein Beleg.", zitat: "" },
  ]);
  const zeilen = Array.from({ length: 12 }, (_, i) => `- Punkt ${i + 1}`).join("\n");
  const [stand] = parseAntwort(`### Stand\n${zeilen}\nZitat: Frage 1 zum Testbrett`, "stand");
  assert.equal(stand.text.split("\n").length, 12);
  assert.equal(stand.zitat, "Frage 1 zum Testbrett");
  assert.equal(saubereZitat("  «Nutzer: ‚Reihe 3 links‘»  "), "Reihe 3 links");
});

test("ernte: Nutzer/Werkzeug → gespeichert mit Beleg; web bleibt mit Adresse; abgewandelt oder ohne Zitat → ohneBeleg; Wiki-Read → nurKi", async () => {
  const v = tempVault("Ernte Brän, Jo's");
  fakeAusgabe([
    "### Möhren", "Möhren werden ab Mitte April gesät.", "Zitat: Werkzeug (Bash): Möhren säen ab Mitte April in Reihe 3.", "",
    "### Kompost", "Kompost reift sechs Monate.", "Zitat: „Kompost braucht sechs Monate bis zur Reife.“", "",
    "### Schneckenkragen", "Das Hochbeet Süd hat Schneckenkragen.", "Zitat: Das Hochbeet Süd bekommt Schneckenkragen.", "",
    "### Regentonne", "Die Regentonne fasst 400 Liter.", "Zitat: Die Regentonne fasst 400 Liter.", "",
    "### Rasenmäher", "Der Rasenmäher steht im Schuppen.", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 2);
  const [moehren, kompost] = r.vorschlaege.map((id) => readFileSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`), "utf8"));
  assert.match(moehren, /\nzitat: "Möhren säen ab Mitte April in Reihe 3\."\nherkunft: tool\nfundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00\.000Z"\nerstellt: /);
  assert.match(kompost, /\nzitat: "Kompost braucht sechs Monate bis zur Reife\."\nherkunft: web\nfundstelle: "sitzung-beleg#u08 2026-10-21T08:08:00\.000Z"\nquelle_url: "https:\/\/example\.com\/gartentipps"\n/);
  assert.match(logZeile(v), / vorschlaege=2 verworfen=0 ohneBeleg=2 nurKi=1 ungedeckt=0$/);
});

test("ernte: eingespielter und eigener Text (system-reminder, Brain-Hinweis, Skill, Agent, Sitzung im Vault) → nurKi, nie gespeichert", async () => {
  const v = tempVault();
  fakeAusgabe([
    "### Erdbeeren", "Stroh unter Erdbeeren.", "Zitat: Die Erdbeeren brauchen Stroh als Unterlage.", "",
    "### Kartoffeln", "Kein Frost.", "Zitat: Kartoffeln vertragen keinen Frost.", "",
    "### Mulch", "Mulch hält feucht.", "Zitat: Mulch hält die Feuchtigkeit im Boden.", "",
    "### Apfelbaum", "Gepflanzt 2019.", "Zitat: Der Apfelbaum wurde 2019 gepflanzt.", "",
    "### Kräuter", "Südhang.", "Zitat: Die Kräuterspirale liegt am Südhang.", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.vorschlaege.length, 0);
  assert.deepEqual(vorschlaege(v), []);
  assert.match(logZeile(v), / vorschlaege=0 verworfen=0 ohneBeleg=0 nurKi=5 ungedeckt=0$/);
});

test("ernte: Zitat mit Zugangs- oder Kundendaten → verworfen; zu kurzes Zitat → ohneBeleg", async () => {
  const v = tempVault();
  fakeAusgabe([
    "### Zugang", "Siehe Zitat.", `Zitat: Bitte notieren ${KOEDER_PW}`, "",
    "### Kontakt", "Gärtner anschreiben.", "Zitat: Schreib an jo@example.com wegen der Beete", "",
    "### Kurz", "Reihe 3.", "Zitat: Reihe 3", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.vorschlaege.length, 0);
  assert.match(logZeile(v), / vorschlaege=0 verworfen=2 ohneBeleg=1 nurKi=0 ungedeckt=0$/);
  assert.ok(!vorschlaege(v).join("").includes("Koeder123"));
});

test("leseTranskript/ernte: Werkzeug-Ausgaben gehen gefiltert mit — tool/web ja; Wiki-Read, Fehler, KI-Werkzeuge, system-reminder, Zugangs- und Kundendaten nie; ≤ 800 je Ausgabe", async () => {
  const v = tempVault();
  const lang = [
    { type: "assistant", uuid: "u60", timestamp: "2026-10-21T08:59:00.000Z", cwd: GARTEN_CWD, message: { role: "assistant", content: [{ type: "tool_use", id: "t-lang", name: "Bash", input: { command: "cat lang.txt" } }] } },
    { type: "user", uuid: "u61", timestamp: "2026-10-21T08:59:30.000Z", cwd: GARTEN_CWD, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t-lang", content: `Zeile A bleibt.\n${KOEDER_PW}\nTel. 0171 2345678\n${"Beet ".repeat(400)}` }] } },
  ];
  const tr = verlauf(v, lang);
  const { werkzeuge, text, prompts } = leseTranskript(tr, { sperr: [v] });
  assert.equal(prompts, 8, "Nutzertext nach einem system-reminder zählt als Prompt, Meta/Nebenzweig/Befehle nicht");
  assert.ok(text.includes("Nutzer: Bitte merke dir: Der Rasenmäher steht im Schuppen links."));
  assert.ok(!text.includes("Die Hecke ist 40 Meter lang"), "Nebenzweig fehlt");
  for (const da of ["Werkzeug (Bash): Möhren säen ab Mitte April in Reihe 3.", "Werkzeug (WebFetch): Kompost braucht sechs Monate", "Werkzeug (mcp__wetter__vorhersage): Frostwarnung",
    "Werkzeug (Grep): vorrat.md: Die Kartoffeln liegen im Keller.", "Werkzeug (Read): Der Zaun ist grün gestrichen.", "Werkzeug (Read): Bewässerung: Tropfschlauch", "Werkzeug (Bash): Zeile A bleibt."]) {
    assert.ok(werkzeuge.includes(da), da);
  }
  for (const nie of ["Schneckenkragen", "Erdbeeren", "gartenplan.csv nicht gefunden", "Apfelbaum", "Kräuterspirale", "Gartenkalender", "Blechdach", "Koeder123", "2345678"]) {
    assert.ok(!werkzeuge.includes(nie), nie);
  }
  assert.ok(werkzeuge.includes("Beet ".repeat(100)) && !werkzeuge.includes("Beet ".repeat(170)), `je Ausgabe ≤ ${MAX_JE_WERKZEUG}`);
  const log = fakeAusgabe("NICHTS\n");
  await lauf(v, tr);
  const gesendet = readFileSync(log, "utf8");
  assert.ok(gesendet.includes(WERKZEUG_KOPF + "Werkzeug ("), "Werkzeug-Abschnitt nach dem Verlauf");
  assert.ok(!gesendet.includes("Koeder123") && !gesendet.includes("Schneckenkragen"));
});

test("ernte (K1): Aussage nennt andere Zahl/Uhrzeit/Verneinung als das Zitat → nicht gespeichert, zählt als ohneBeleg und ungedeckt", async () => {
  const v = tempVault();
  fakeAusgabe([
    "### Regentonne", "Die Regentonne fasst 500 Liter.", "Zitat: Die Regentonne fasst 300 Liter.", "",
    "### Gießzeit", "Gegossen wird um 18 Uhr.", "Zitat: Die Tomaten stehen im Hochbeet Nord, gegossen wird um 7 Uhr.", "",
    "### Wasseruhr", "Die Wasseruhr hängt nicht im Keller.", "Zitat: Die Wasseruhr hängt im Keller.", "",
    "### Schere", "Die Gartenschere liegt in der Werkzeugkiste.", "Zitat: Die Gartenschere liegt in der Werkzeugkiste.", "",
    "### Regentonne groß", "Die Regentonne fasst 300 Liter.", "Zitat: Die Regentonne fasst 300 Liter.", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 2);
  const gespeichert = vorschlaege(v).join("\n");
  assert.ok(gespeichert.includes("Gartenschere") && gespeichert.includes("fasst 300 Liter"));
  assert.ok(!gespeichert.includes("500 Liter") && !gespeichert.includes("18 Uhr") && !gespeichert.includes("nicht im Keller"));
  assert.match(logZeile(v), / vorschlaege=2 verworfen=0 ohneBeleg=3 nurKi=0 ungedeckt=3$/);
});

test("ernte (K1): beim Stand zählt nur der Kernsatz (erste Zeile) — weitere Zeilen werden nicht Zahl für Zahl geprüft, ein ungedeckter Kernsatz schon", async () => {
  const v = tempVault();
  const stand = () => ernte(v, { art: "stand", transkript: verlauf(v), sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: Date.UTC(2026, 9, 21, 9, 0, 0) });
  fakeAusgabe("### Stand Garten\n- Die Regentonne fasst 300 Liter.\n- Beet 2 offen, Frist 30.11.\n- Nicht vergessen: Kompost 3 Monate\nZitat: Die Regentonne fasst 300 Liter.\n");
  const r = await stand();
  assert.equal(r.vorschlaege.length, 1);
  assert.match(logZeile(v), / vorschlaege=1 verworfen=0 ohneBeleg=0 nurKi=0 ungedeckt=0$/);
  fakeAusgabe("### Stand Garten\n- Die Regentonne fasst 500 Liter.\n- Beet 2 offen\nZitat: Die Regentonne fasst 300 Liter.\n");
  const r2 = await stand();
  assert.equal(r2.vorschlaege.length, 0, "Zahl im Kernsatz fehlt im Zitat");
  assert.match(logZeile(v), / vorschlaege=0 verworfen=0 ohneBeleg=1 nurKi=0 ungedeckt=1$/);
});

test("ernte (W2): MCP-Ergebnis zählt als web — mit automatik.mcpVertraut als tool", async () => {
  const aus = ["### Frost", "Frostwarnung für die Nacht auf Dienstag.", "Zitat: Frostwarnung für die Nacht auf Dienstag.", ""].join("\n");
  const herkunft = async (config) => {
    const v = tempVault();
    writeFileSync(join(v, "brain.config.json"), JSON.stringify(config));
    fakeAusgabe(aus);
    const r = await lauf(v, verlauf(v));
    assert.equal(r.vorschlaege.length, 1);
    return readFileSync(join(v, "00_inbox", "_vorschlaege", `${r.vorschlaege[0]}.md`), "utf8").match(/^herkunft: (\w+)$/m)[1];
  };
  assert.equal(await herkunft({}), "web");
  assert.equal(await herkunft({ automatik: { mcpVertraut: ["mcp__wetter__*"] } }), "tool");
});

test("ernte (W1): steht das Zitat schon wörtlich im Wiki des Vaults → nurKi, egal über welchen Weg es zurückkam", async () => {
  const v = tempVault();
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "garten", "beete.md"), "- Das Hochbeet West wird jeden Sonntag gegossen. · Stand 20.10.2026\n");
  const extra = [
    { type: "assistant", uuid: "w1", timestamp: "2026-10-21T08:50:00.000Z", sessionId: GARTEN_SITZUNG, cwd: GARTEN_CWD, message: { role: "assistant", content: [{ type: "tool_use", id: "t-kopie", name: "Bash", input: { command: "cat /sicherung/kopie.md" } }] } },
    { type: "user", uuid: "w2", timestamp: "2026-10-21T08:50:30.000Z", sessionId: GARTEN_SITZUNG, cwd: GARTEN_CWD, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t-kopie", content: "Das Hochbeet West wird jeden Sonntag gegossen." }] } },
    { type: "user", uuid: "w3", timestamp: "2026-10-21T08:51:00.000Z", sessionId: GARTEN_SITZUNG, cwd: GARTEN_CWD, message: { role: "user", content: "Die Regentonne fasst 300 Liter und steht hinter dem Schuppen." } },
  ];
  fakeAusgabe([
    "### Beet West", "Das Hochbeet West wird sonntags gegossen.", "Zitat: Das Hochbeet West wird jeden Sonntag gegossen.", "",
    "### Tonne", "Die Regentonne fasst 300 Liter.", "Zitat: Die Regentonne fasst 300 Liter und steht hinter dem Schuppen.", "",
  ].join("\n"));
  const r = await lauf(v, verlauf(v, extra));
  assert.equal(r.vorschlaege.length, 1, "nur die Tonne ist neu");
  assert.match(logZeile(v), / vorschlaege=1 verworfen=0 ohneBeleg=0 nurKi=1 ungedeckt=0$/);
});
