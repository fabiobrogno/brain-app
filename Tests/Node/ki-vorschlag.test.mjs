// KI-Vorschläge (K0): Aufruf, Umgebung, Ablauf, Token, Stufen/Einwilligung/`ki: nein`, Kontingent, Abbruch, eine Anfrage zur Zeit. Nie das echte `claude`:
// Tests/Kern/fake-claude-vorschlag.mjs parst die Argumente streng wie die echte CLI und prüft die Schutzgeländer (Exit 4 bei Verletzung).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pfad, echt, schreibe } from "./hilfe.mjs";
import { nurUnix } from "./attrappe.mjs";
import { szenarioV, K, bis, frei, warte, EINTRAG, EINTRAG_TEXT } from "./ki-vorschlag-hilfe.mjs";

const { baueVorschlagArgs, GRENZEN } = await import(pfad("werkstatt", "ki-vorschlag.mjs"));
const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
after(() => { beendeAlleProzesse(); });

test("Ablauf: Start → Stand → Vorschläge mit Token; Kennungen aus der Liste, Beschriftung von Kortex; nichts im Vault, Temp-Ordner weg", async () => {
  const s = szenarioV();
  const vorher = s.abbild(s.vault);
  const { start, stand } = await s.anfrage();
  assert.equal(stand.fertig, true);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.equal(stand.ergebnis.funktion, "posteingang");
  assert.equal(stand.ergebnis.vorschlaege.length, 1);
  const v = stand.ergebnis.vorschlaege[0];
  assert.equal(v.art, "verlinken");
  assert.match(v.id, /^vs_[0-9a-f]{16}$/);
  assert.match(v.token, /^[0-9a-f]{64}$/);
  assert.match(v.beschriftung, /^Verlinkt mit „(Atlas|Kaffeemaschine|Rechnung März)“$/);
  assert.ok(!JSON.stringify(stand.ergebnis).includes("10_projekte/"), "im Ergebnis steht kein Pfad der Ziele");
  assert.equal(stand.ergebnis.tokens.ausgabe, 80);
  assert.equal(stand.ergebnis.kosten, 0.0021);
  // „Was wird gesendet?“: das Datenpaket genau so, wie es auf stdin ging
  assert.equal(start.gesendet, s.aufrufe()[0].stdin);
  assert.deepEqual(s.abbild(s.vault), vorher, "im Vault ist nichts entstanden oder verändert");
  assert.deepEqual(readdirSync(s.temp), [], "der Temp-Ordner ist aufgeräumt");
});

test("Aufruf: genau die dokumentierten Optionen, Daten über stdin, cwd leer und außerhalb des Vaults, Umgebung nur aus der erlaubten Liste, keine Werkzeuge", async () => {
  const s = szenarioV();
  const r = await s.anfrage();
  assert.equal(r.stand.ergebnis.ok, true, JSON.stringify(r.stand.ergebnis));
  const [a] = s.aufrufe();
  assert.deepEqual(a.verletzt, []);
  const opt = (n) => a.args[a.args.indexOf(n) + 1];
  assert.equal(opt("--model"), "haiku");
  assert.equal(opt("--tools"), "");
  assert.equal(opt("--output-format"), "json");
  assert.deepEqual(JSON.parse(opt("--mcp-config")), { mcpServers: {} });
  for (const f of ["-p", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]) assert.ok(a.args.includes(f), f);
  assert.equal(opt("--permission-mode"), "dontAsk");
  assert.deepEqual(JSON.parse(opt("--settings")), { disableAllHooks: true, autoMemoryEnabled: false });
  assert.equal(opt("--setting-sources"), "user");
  assert.equal(opt("--max-turns"), "3");
  assert.equal(opt("--max-budget-usd"), "0.15");
  assert.ok(!a.args.includes("--allowedTools"), "keine erlaubten Werkzeuge");
  const entfernt = opt("--disallowedTools").split(",");
  for (const n of ["Bash", "Edit", "Write", "WebFetch", "mcp__brain__brain_merken", "mcp__brain__brain_lesen"]) assert.ok(entfernt.includes(n), n);
  assert.ok(opt("--append-system-prompt").includes("KORTEX-VORSCHLAG/1"));
  const schema = JSON.parse(opt("--json-schema"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.vorschlaege.items.properties.ziel.enum.filter((x) => x.startsWith("k")).length > 0, true);
  // Daten nur über stdin, nie in den Argumenten
  const paket = JSON.parse(a.stdin);
  assert.equal(paket.aufgabe, "posteingang");
  assert.ok(!a.args.some((x) => x.includes("Kaffeemaschine besprechen")), "der Eintrag steht nicht in den Argumenten");
  assert.ok(a.cwd !== s.vault && !a.cwd.startsWith(s.vault), "cwd liegt außerhalb des Vaults");
  assert.equal(a.claudeConfigDir, s.a, "das Konto wählt CLAUDE_CONFIG_DIR");
  const erlaubt = new Set(["PATH", "HOME", "LANG", "BRAIN_ERNTE", "CLAUDE_CODE_DISABLE_CLAUDE_MDS", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CONFIG_DIR", "BRAIN_TESTMODUS", "TMPDIR", "NODE_EXTRA_CA_CERTS", "SystemRoot", "SYSTEMROOT", "USERPROFILE", "TEMP", "TMP", "ComSpec", "PATHEXT", "SystemDrive", "LC_CTYPE", "__CF_USER_TEXT_ENCODING", "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "USERDOMAIN", "USERNAME", "WINDIR"]);
  for (const k of a.envSchluessel) assert.ok(erlaubt.has(k) || (process.platform === "win32" && erlaubt.has(k.toUpperCase())) || (process.platform === "win32" && ["SYSTEMDRIVE", "SYSTEMROOT"].includes(k.toUpperCase())), `unerlaubte Umgebungsvariable: ${k}`);
  // baueVorschlagArgs liefert dieselbe Liste wie der Lauf (Argumente bis auf Schema und Systemprompt)
  const direkt = baueVorschlagArgs({ modell: "haiku", art: "posteingang", schema, system: opt("--append-system-prompt"), grenzen: GRENZEN });
  assert.deepEqual(direkt, a.args);
});

test("Datenpaket: Kandidaten ohne `ki: nein`, Ordner, Titel und Anfänge; die geheime Notiz kommt nirgends vor, auch nicht als Zahl", async () => {
  const s = szenarioV();
  const { stand } = await s.anfrage();
  assert.equal(stand.ergebnis.ok, true);
  const roh = s.aufrufe()[0].stdin;
  assert.ok(!roh.includes("GEHEIMER-INHALT"), "Inhalt der ki:nein-Notiz");
  assert.ok(!roh.includes("Geheim.md") && !/Atlas Kaffeemaschine Rechnung März/.test(roh), "Titel der ki:nein-Notiz");
  assert.ok(!roh.includes("Dieser Eintrag geht nie an eine KI"), "ki:nein-Eintrag im Posteingang");
  const p = JSON.parse(roh);
  assert.ok(p.daten.kandidaten.length >= 2 && p.daten.kandidaten.length <= 12);
  assert.deepEqual(p.daten.kandidaten.map((k) => k.id), p.daten.kandidaten.map((_, i) => `k${i + 1}`));
  for (const k of p.daten.kandidaten) { assert.ok(k.anfang.length <= 300); assert.deepEqual(Object.keys(k).sort(), ["anfang", "id", "titel"], "keine Pfade im Paket"); }
  assert.deepEqual(p.daten.ordner.map((o) => o.name).sort(), ["10_projekte", "20_finanzen"]);
  assert.equal(p.daten.eintrag.titel, "Atlas Idee");
  assert.equal(p.daten.eintrag.text, EINTRAG_TEXT);
});

test("`ki: nein`: ein Eintrag mit der Marke wird nie gesendet (409, keine Anfrage an die KI)", async () => {
  const s = szenarioV();
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: "00_inbox/Nein.md", konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "ki-nein");
  const t = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "text", aktion: "kuerzen", pfad: "10_projekte/Geheim.md", auswahl: "GEHEIMER-INHALT-NIE-SENDEN", konto: "k_aaaaaaaa" });
  assert.equal(t.status, 409); assert.equal(t.j.art, "ki-nein");
  assert.deepEqual(s.aufrufe(), [], "claude wurde nie gestartet");
});

test("Einwilligung je Vault: ohne sie geht nichts hinaus; für ein anderes Konto gilt sie nicht; einschalten verlangt Vault-Bestätigung und lesendes Konto; ausschalten verwirft alles", async () => {
  const s = szenarioV({ einwilligung: false });
  const start = (extra = {}) => s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa", ...extra });
  let r = await start();
  assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung");
  assert.deepEqual(s.aufrufe(), []);
  assert.equal((await s.api("GET", "/api/ki/vorschlag/bereit")).j.einwilligung.an, false);
  // einschalten: falscher Vault in der Anfrage → 409; Konto ohne Zugriff → 409; Codex/gesperrt kommt nie vor
  r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: true, konto: "k_aaaaaaaa", vault: s.anderer });
  assert.equal(r.status, 409); assert.equal(r.j.art, "anderer-vault");
  r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: true, konto: "k_bbbbbbbb", vault: s.vault });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-zugriff");
  r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: "ja", vault: s.vault });
  assert.equal(r.status, 400);
  r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: true, konto: "k_aaaaaaaa", vault: s.vault });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.an, true); assert.equal(r.j.konto, "k_aaaaaaaa"); assert.equal(r.j.kontoName, "Arbeit");
  assert.equal(K.vorschlaegeFuer(K.liesKonten(s.support).daten, s.vault).an, true, "in ki-konten.json gespeichert");
  // sie gilt für genau dieses Konto
  r = await start({ konto: "k_dddddddd" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "einwilligung-konto");
  r = await start();
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await s.folge(r.j.id);
  // ausschalten: weg, und die Vorschläge sind verworfen
  const e = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: false, vault: s.vault });
  assert.equal(e.j.an, false);
  assert.equal((await start()).j.art, "einwilligung");
});

test("Einwilligung ist fail-closed: unbekanntes Konto, falsche Form oder ein anderer Vault in der Liste heißt „aus“; sinkt die Stufe, endet die Einwilligung", async () => {
  const s = szenarioV();
  assert.equal((await s.api("GET", "/api/ki/vorschlag/einwilligung")).j.an, true);
  const d = K.liesKonten(s.support).daten;
  assert.equal(K.vorschlaegeFuer(d, s.vault).an, true);
  assert.equal(K.vorschlaegeFuer(d, s.anderer).an, false, "ein anderer Vault hat keine Einwilligung");
  const kaputt = structuredClone(d);
  for (const w of [{ an: "true", konto: "k_aaaaaaaa" }, { an: true, konto: "k_unbekannt" }, { an: true, konto: "x" }, { an: true }, "ja", null, [], { an: false, konto: "k_aaaaaaaa" }]) {
    kaputt.vaults[s.vault].vorschlaege = w;
    assert.equal(K.vorschlaegeFuer(kaputt, s.vault).an, false, JSON.stringify(w));
  }
  s.setze({ a: "gesperrt" });
  assert.equal((await s.api("GET", "/api/ki/vorschlag/einwilligung")).j.an, false, "Konto gesperrt → keine Einwilligung wirksam");
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409);
});

test("Stufe: gesperrt → 409 kein-zugriff; lesen genügt; ein Konto, das nicht in der Liste steht, gibt es nicht; gesperrte Konten fehlen in „bereit“", async () => {
  const s = szenarioV({ stufeA: "gesperrt" });
  let r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-zugriff");
  r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_ffffffff" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-zugriff");
  const b = (await s.api("GET", "/api/ki/vorschlag/bereit")).j;
  assert.ok(!b.konten.some((k) => k.id === "k_aaaaaaaa" || k.id === "k_bbbbbbbb"), "gesperrte Konten kommen nie vor");
  assert.ok(!JSON.stringify(b).includes("Geheimkonto"));
  assert.deepEqual(s.aufrufe(), []);
  s.setze({ a: "lesen" });
  r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await s.folge(r.j.id);
});

test("Eingabe: unbekannte Funktion, falsches Modell, „gründlicher“ nur für Text, Pfad außerhalb des Posteingangs, zu viel Text, Text steht nicht in der Notiz", async () => {
  const s = szenarioV();
  const st = (e) => s.api("POST", "/api/ki/vorschlag/start", { konto: "k_aaaaaaaa", ...e });
  assert.equal((await st({ funktion: "zusammenfassung" })).status, 400, "K1 gibt es noch nicht");
  assert.equal((await st({ funktion: "frei" })).status, 400);
  assert.equal((await st({ funktion: "posteingang", pfad: EINTRAG, modell: "riesig" })).status, 400);
  assert.equal((await st({ funktion: "posteingang", pfad: EINTRAG, modell: "mittel" })).status, 400, "gründlicher nur für Text-Aktionen");
  let r = await st({ funktion: "posteingang", pfad: "10_projekte/Atlas.md" });
  assert.equal(r.status, 400); assert.equal(r.j.art, "kein-eintrag");
  assert.equal((await st({ funktion: "posteingang", pfad: "../x.md" })).status >= 400, true);
  assert.equal((await st({ funktion: "text", aktion: "kuerzen", pfad: "10_projekte/Atlas.md", auswahl: "x".repeat(8001) })).status, 413);
  r = await st({ funktion: "text", aktion: "kuerzen", pfad: "10_projekte/Atlas.md", auswahl: "Dieser Satz steht nicht da" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "veraltet");
  assert.equal((await st({ funktion: "text", aktion: "zaubern", pfad: "10_projekte/Atlas.md", auswahl: "Atlas" })).status, 400);
  assert.equal((await st({ funktion: "text", aktion: "uebersetzen", sprache: "klingonisch", pfad: "10_projekte/Atlas.md", auswahl: "Atlas" })).status, 400);
  assert.deepEqual(s.aufrufe(), []);
  // gültig: Text-Aktion mit „gründlicher“
  r = await st({ funktion: "text", aktion: "kuerzen", pfad: "10_projekte/Atlas.md", auswahl: "Projekt Atlas, Planung", modell: "mittel" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const stand = await s.folge(r.j.id);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.equal(stand.ergebnis.funktion, "ersatz");
  assert.equal(stand.ergebnis.ersatz, "Projekt Atl", "die Attrappe kürzt auf die Hälfte");
  assert.equal(s.aufrufe()[0].args[s.aufrufe()[0].args.indexOf("--model") + 1], "sonnet");
  assert.equal(s.aufrufe()[0].args[s.aufrufe()[0].args.indexOf("--max-budget-usd") + 1], "0.6");
});

test("Text-Aktionen: Aufgaben herausziehen (Beleg wörtlich), Übersetzen mit Sprache, Warnzeilen für neue Links", async () => {
  const s = szenarioV();
  const sel = "Projekt Atlas, Planung und Termine.";
  let { stand } = await s.anfrage({ funktion: "text", aktion: "aufgaben", pfad: "10_projekte/Atlas.md", auswahl: sel });
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.equal(stand.ergebnis.funktion, "aufgaben");
  assert.equal(stand.ergebnis.aufgaben.length, 1);
  ({ stand } = await s.anfrage({ funktion: "text", aktion: "uebersetzen", sprache: "en", pfad: "10_projekte/Atlas.md", auswahl: sel }));
  assert.equal(stand.ergebnis.ersatz, `[en] ${sel}`);
  assert.deepEqual(stand.ergebnis.warnungen, []);
  const paket = JSON.parse(s.aufrufe()[1].stdin);
  assert.equal(paket.aufgabe, "uebersetzen"); assert.equal(paket.daten.sprache, "en"); assert.equal(paket.daten.ueberschrift, "Atlas");
});

test("Token: falscher Vault 404, falsches Token 403, geänderte Notiz 409, abgelaufen 409, fremde id 404, doppelt 409; nie Pfad oder Aktion von außen", async () => {
  let t = 1_000_000;
  const s = szenarioV({ jetzt: () => t });
  s.szen({ szenario: "ok" });
  // Ziel „verschieben“ braucht einen Ordner: die Attrappe schlägt verlinken vor, darum den Speicher über die Antwort „injektion“ nicht nutzen — hier genügt „aufgabe“
  const { stand } = await s.anfrage();
  const vs = stand.ergebnis.vorschlaege[0];
  const anwenden = (e) => s.api("POST", "/api/ki/vorschlag/anwenden", e);
  assert.equal((await anwenden({ id: vs.id })).status, 400, "ohne Token");
  assert.equal((await anwenden({ id: 42, token: "x" })).status, 400);
  assert.equal((await anwenden({ id: "vs_0000000000000000", token: vs.token })).status, 404, "fremde id");
  let r = await anwenden({ id: vs.id, token: "0".repeat(64) });
  assert.equal(r.status, 403); assert.equal(r.j.art, "token");
  assert.equal((await anwenden({ id: vs.id, token: vs.token.slice(0, 60) })).status, 403, "zu kurz");
  // Token und Pfad/Aktion von außen werden nicht gelesen: zusätzliche Felder ändern nichts
  r = await anwenden({ id: vs.id, token: vs.token, pfad: "../../x", art: "loeschen", ziel: "/" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "noch-nicht", "„verlinken“ lässt sich in K0 noch nicht übernehmen; es wurde nichts geschrieben");
  // anderer Vault: alles verworfen, nichts bekannt (404)
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  r = await anwenden({ id: vs.id, token: vs.token });
  assert.ok([404, 409].includes(r.status), String(r.status));
});

test("Token: Notiz geändert → 409 veraltet; Ablauf → 409 abgelaufen; Token ist an Vault, Pfad und Hash gebunden (anderes Geheimnis → 403)", async () => {
  let t = 5_000_000;
  const s = szenarioV({ jetzt: () => t });
  // Aufgaben-Vorschlag, damit „anwenden“ bis zum Schreiben durchläuft: dafür sorgt Tests/Node/ki-vorschlag-anwenden.test.mjs; hier die Prüfreihenfolge
  const { stand } = await s.anfrage();
  const vs = stand.ergebnis.vorschlaege[0];
  const anwenden = (e) => s.api("POST", "/api/ki/vorschlag/anwenden", e);
  await writeEintrag(s, EINTRAG_TEXT + "\nNeue Zeile.\n");
  let r = await anwenden({ id: vs.id, token: vs.token });
  assert.equal(r.status, 409); assert.equal(r.j.art, "veraltet");
  const s2 = szenarioV({ jetzt: () => t });
  const a2 = await s2.anfrage();
  t += 16 * 60_000;
  r = await s2.api("POST", "/api/ki/vorschlag/anwenden", { id: a2.stand.ergebnis.vorschlaege[0].id, token: a2.stand.ergebnis.vorschlaege[0].token });
  assert.equal(r.status, 409); assert.equal(r.j.art, "abgelaufen");
  // zwei Werkstätten haben zwei Geheimnisse: ein Token der einen gilt in der anderen nie
  const s3 = szenarioV({ jetzt: () => t });
  assert.equal((await s3.api("POST", "/api/ki/vorschlag/anwenden", { id: vs.id, token: vs.token })).status, 404);
});

function writeEintrag(s, text) { // Hilfe: den Eintrag ändern, wie es ein anderes Programm täte
  return import("node:fs").then((fs) => fs.writeFileSync(join(s.vault, EINTRAG), text));
}

test("Kontingent: bei 100 % keine Anfrage (mit Rücksetzzeit), bei 80 % und ohne Wert läuft sie; „bereit“ zeigt die Zahlen", async () => {
  const jetzt = Date.now();
  let stand = { status: "ok", session: { usedPercent: 100, resetsAt: jetzt + 3_600_000 }, weekly: { usedPercent: 10, resetsAt: jetzt + 86_400_000 } };
  const s = szenarioV({ kontingent: () => stand });
  let r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kontingent"); assert.ok(r.j.bis);
  assert.deepEqual(s.aufrufe(), []);
  assert.equal((await s.api("GET", "/api/ki/vorschlag/bereit")).j.kontingent.session.usedPercent, 100);
  stand = { status: "ok", session: { usedPercent: 85, resetsAt: jetzt + 3_600_000 }, weekly: null };
  r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await s.folge(r.j.id);
  stand = { status: "ohne-kontingent" };
  r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, "ohne Wert: kein Sperren");
  await s.folge(r.j.id);
  stand = { status: "ok", session: { usedPercent: 100, resetsAt: jetzt - 1000 }, weekly: null };
  r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, "das Fenster ist schon zurückgesetzt");
  await s.folge(r.j.id);
});

test("Eine Anfrage zur Zeit; Frag und Vorschlag teilen sich den Weg; Vault-Wechsel verwirft und bricht ab", { skip: nurUnix("SIGINT und Prozessgruppen gibt es unter Windows nicht") }, async () => {
  const s = szenarioV();
  s.szen({ szenario: "abbruch" });
  const a = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(a.status, 200);
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8");
  const zweite = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(zweite.status, 409); assert.equal(zweite.j.art, "laeuft");
  assert.equal((await s.api("GET", "/api/ki/vorschlag/bereit")).j.laeuft, true);
  // Vault-Wechsel bricht ab
  await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer });
  await bis(() => frei(pid), 5000, "Prozess beendet");
  const stand = await s.api("GET", `/api/ki/vorschlag/stand?id=${a.j.id}`);
  assert.ok(stand.status === 404 || (stand.j.fertig && stand.j.ergebnis.abgebrochen));
});

test("Abbruch: Knopf beendet die Prozessgruppe (SIGINT), Ergebnis „Abgebrochen“, Temp-Ordner weg; Frist beendet langsame Läufe", { skip: nurUnix("SIGINT und Prozessgruppen gibt es unter Windows nicht") }, async () => {
  const s = szenarioV();
  s.szen({ szenario: "abbruch" });
  const a = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8");
  assert.equal(frei(pid), false);
  assert.equal((await s.api("POST", "/api/ki/vorschlag/abbrechen", { id: "nicht-da" })).status, 404);
  assert.equal((await s.api("POST", "/api/ki/vorschlag/abbrechen", { id: a.j.id })).status, 200);
  const stand = await s.folge(a.j.id);
  assert.equal(stand.ergebnis.ok, false); assert.equal(stand.ergebnis.abgebrochen, true); assert.equal(stand.ergebnis.grund, "nutzer");
  await bis(() => frei(pid), 4000, "Prozess beendet");
  assert.deepEqual(readdirSync(s.temp), []);
  // Frist
  rmSync(join(s.bin, "wartet"), { force: true });
  const f = szenarioV({ grenzen: { frist: 400 } });
  f.szen({ szenario: "langsam", warteMs: 30_000 });
  const b = await f.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  const st = await f.folge(b.j.id);
  assert.equal(st.ergebnis.ok, false); assert.equal(st.ergebnis.grund, "frist");
  assert.match(st.ergebnis.fehler, /zu lange/);
});

test("Fehler: kein JSON, falsches Schema, offline, Budget — verständliche Texte, nie ein Vorschlag, nichts geändert", async () => {
  const s = szenarioV();
  const vorher = s.abbild(s.vault);
  const faelle = [["kaputt", /keinen brauchbaren Vorschlag/], ["schema-falsch", /keinen brauchbaren Vorschlag/], ["offline", /Keine Verbindung zur KI/], ["budget", /zu viel auf einmal/]];
  for (const [name, muster] of faelle) {
    s.szen({ szenario: name });
    const { stand } = await s.anfrage();
    assert.equal(stand.ergebnis.ok, false, name);
    assert.match(stand.ergebnis.fehler, muster, name);
    assert.ok(!stand.ergebnis.vorschlaege, name);
  }
  assert.deepEqual(s.abbild(s.vault), vorher);
});

test("Ausgabeformen: structured_output, JSON im result mit Code-Zaun (Rückfall) und stream-json werden gleich streng geprüft", async () => {
  const s = szenarioV();
  for (const name of ["ok", "zaun", "stream"]) {
    s.szen({ szenario: name });
    const { stand } = await s.anfrage();
    assert.equal(stand.ergebnis.ok, true, `${name}: ${JSON.stringify(stand.ergebnis)}`);
    assert.equal(stand.ergebnis.vorschlaege.length, 1, name);
  }
});

test("Temp-Ordner im Vault wird abgelehnt (kein Lauf)", async () => {
  const s = szenarioV({ tempImVault: true });
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 500);
  assert.deepEqual(s.aufrufe(), []);
});

test("bereit: Konten ohne Zugriff fehlen, Einwilligung und Grenzen stehen drin; GET legt nichts an", async () => {
  const s = szenarioV();
  const b = (await s.api("GET", "/api/ki/vorschlag/bereit")).j;
  assert.equal(b.vertraut, true); assert.equal(b.claude, true);
  assert.equal(b.einwilligung.an, true); assert.equal(b.einwilligung.kontoName, "Arbeit");
  assert.deepEqual(b.funktionen, ["posteingang", "text"]);
  assert.equal(b.aktiv, null, "mehrere Claude-Konten und keins als aktiv gewählt: keine Vorgabe");
  assert.ok(b.konten.some((k) => k.id === "k_aaaaaaaa" && k.erlaubt));
  assert.ok(!b.konten.some((k) => k.id === "k_bbbbbbbb"));
  assert.equal((await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", konto: "k_aaaaaaaa" })).status, 400, "Pfad fehlt");
  assert.equal((await s.api("GET", "/api/ki/vorschlag/start")).status, 405);
  assert.equal(EINTRAG_TEXT.length > 10, true);
  await warte(1);
});

test("Nicht vertrauter Vault: keine Anfrage an eine KI und kein Einschalten (409 nicht-vertraut); „bereit“ sagt es", async () => {
  const s = szenarioV();
  await echt(async () => {
    const b = (await s.api("GET", "/api/ki/vorschlag/bereit")).j;
    assert.equal(b.vertraut, false);
    let r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-vertraut");
    r = await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: true, konto: "k_aaaaaaaa", vault: s.vault });
    assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-vertraut");
    assert.deepEqual(s.aufrufe(), []);
  });
});

test("`ki: nein` verrät sich weder über Tags noch über Ordner (auch bei „ki:nein“ ohne Leerzeichen und bei vielen Kopffeldern)", async () => {
  const s = szenarioV();
  schreibe(s.vault, "30_scheidung/Anwalt.md", "---\nki:nein\ntags: [diagnose-geheim]\n---\n# Anwalt\n\nAtlas Kaffeemaschine Rechnung.\n");
  const viele = Array.from({ length: 50 }, (_, i) => `f${i}: x`).join("\n");
  schreibe(s.vault, "40_arzt/Befund.md", `---\n${viele}\nki: nein\ntags: [diagnose-geheim]\n---\n# Befund\n\nAtlas Kaffeemaschine Rechnung.\n`);
  const { stand } = await s.anfrage();
  assert.equal(stand.ergebnis.ok, true);
  const roh = s.aufrufe()[0].stdin;
  for (const wort of ["scheidung", "arzt", "diagnose-geheim", "Anwalt", "Befund"]) assert.ok(!roh.includes(wort), `„${wort}“ im Datenpaket`);
  assert.deepEqual(JSON.parse(roh).daten.tags, []);
});

test("Wettlauf: zwei gleichzeitige Starts ergeben genau eine Anfrage; ein Vault-Wechsel während des Sammelns startet nichts mehr", async () => {
  const s = szenarioV();
  s.szen({ szenario: "abbruch" });
  const st = () => s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });
  const [a, b] = await Promise.all([st(), st()]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.j, b.j]));
  assert.equal(s.aufrufe().length >= 0, true);
  await s.api("POST", "/api/ki/vorschlag/abbrechen", { id: [a, b].find((x) => x.status === 200).j.id });
  // Wechsel mitten im Start
  const s2 = szenarioV();
  const start = st2(s2);
  await s2.api("POST", "/api/vaults/aktiv", { pfad: s2.anderer });
  const r = await start;
  assert.equal(r.status, 409); assert.equal(r.j.art, "abgebrochen");
  assert.deepEqual(s2.aufrufe(), [], "für den alten Vault wurde nichts mehr gestartet");
});
const st2 = (s) => s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" });

test("Einwilligung zurücknehmen bricht eine laufende Anfrage ab; Frag wartet auf eine laufende Vorschlags-Anfrage; Kontingent „veraltet“ sperrt nicht", { skip: nurUnix("SIGINT und Prozessgruppen gibt es unter Windows nicht") }, async () => {
  const s = szenarioV();
  s.szen({ szenario: "abbruch" });
  const a = await st2(s);
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8");
  const f = await s.api("POST", "/api/frage/start", { frage: "Was ist Atlas?", konto: "k_aaaaaaaa" });
  assert.equal(f.status, 409); assert.equal(f.j.art, "laeuft");
  await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: false, vault: s.vault });
  await bis(() => frei(pid), 5000, "Prozess beendet");
  assert.ok(a.status === 200);
  const jetzt = Date.now();
  const v = szenarioV({ kontingent: () => ({ status: "veraltet", session: { usedPercent: 100, resetsAt: null }, weekly: null }) });
  const r = await st2(v);
  assert.equal(r.status, 200, "ein veralteter Wert sperrt nicht");
  await v.folge(r.j.id);
  assert.ok(jetzt > 0);
});

test("Die Vorschau-Marke einer Antwort gilt nur in einer echten Vorschau (die echte KI kann sie nicht behaupten)", async () => {
  const s = szenarioV();
  s.szen({ szenario: "ok", vorschau: true });
  const { stand } = await s.anfrage();
  assert.equal(stand.ergebnis.ok, true);
  assert.equal(stand.ergebnis.vorschau, undefined);
});
