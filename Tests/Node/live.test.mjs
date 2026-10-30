// Live-Aktualisierung (werkstatt/ereignisse.mjs): Einordnung der Pfade, Entprellen, Ignorieren, Echo-Unterdrückung, Long-Poll mit Nummern,
// Ratenbegrenzung, Polling-Rückfall, Git-Stand, Route /api/ereignisse, Ende der Werkstatt mit wartendem Abruf und der MCP-Weg (brain_aufgabe_anlegen).
// Plattformrobust: gewartet wird auf Bedingungen (mit Frist), nie auf feste Zeiten; fs.watch (macOS/Linux) und Polling werden getrennt geprüft.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const { erzeugeEreignisse, klassifiziere, aufgabenKopf, gitStand } = await import(pfad("werkstatt", "ereignisse.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

const kinder = [];
const hubs = [];
after(() => { for (const k of kinder) try { k.kill("SIGKILL"); } catch { /* weg */ } for (const h of hubs) try { h.beende(); } catch { /* weg */ } });

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const aufgabeText = (titel, extra = {}) => ["---", "typ: aufgabe", `titel: ${JSON.stringify(titel)}`, `status: ${extra.status || "offen"}`, `quelle: ${extra.quelle || "mensch"}`, "---", ""].join("\n");
const vaultOrdner = () => { const d = tmp("brain-live-"); schreibe(d, "brain.config.json", "{}\n"); mkdirSync(join(d, "05_aufgaben")); schreibe(d, "10_notizen/start.md", "# Start\n"); return d; };

// Hub für einen Vault; liest Ereignisse, bis die Bedingung erfüllt ist (oder die Frist vorbei ist).
function hub(d, o = {}) {
  const h = erzeugeEreignisse({ entprellMs: 60, maxWarteMs: 300, pollMs: 80, ...o });
  hubs.push(h);
  h.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
  return h;
}
// kurz warten: ein gerade erst angelegter fs.watch (FSEvents) nimmt in den ersten Millisekunden noch nichts an
async function grundstand(h) { const r = await h.warte({}); await pause(120); return r; }
// sammelt alles Neue ab `stand`, bis genügt(liste) gilt; gibt (auch bei Fristende) alles Gesammelte zurück
async function sammle(h, stand, genuegt, frist = 6000) {
  let { epoche, aktuell } = stand;
  const alle = [], ende = Date.now() + frist;
  while (Date.now() < ende) {
    const r = await h.warte({ seit: aktuell, epoche, warteMs: Math.min(500, Math.max(50, ende - Date.now())) });
    assert.equal(r.verpasst, false, "nicht verpasst");
    aktuell = r.aktuell; alle.push(...r.ereignisse);
    if (genuegt(alle)) break;
  }
  return alle;
}
// wartet ruhig `ms`, damit nichts Unerwartetes mehr kommt, und gibt zurück, was gekommen ist
async function ruhe(h, stand, ms = 700) { return sammle(h, stand, () => false, ms); }

// ───────────────────────────── Einordnung ─────────────────────────────

test("klassifiziere: Bereiche, Ignorieren, Editor-Reste, .git nur HEAD und refs", () => {
  const k = (p) => klassifiziere(p, { aufgabenOrdner: "05_Aufgaben" });
  assert.deepEqual(k("05_aufgaben/a.md"), { bereich: "aufgabe", pfad: "05_aufgaben/a.md", text: true }); // Groß/klein egal
  assert.equal(k("00_inbox/x.md").bereich, "posteingang");
  assert.equal(k("10_notizen/x.txt").bereich, "notiz");
  assert.equal(k("10_notizen/Ordner").text, false); // evtl. ein Ordner
  assert.equal(k("10_notizen/bild.png"), null);
  for (const weg of [".logs/a.md", "10_notizen/.brain-tmp-1-ab12", ".brain-tmp-1", "x/.obsidian/app.json", ".DS_Store", "node_modules/x/readme.md", "10_notizen/x.md~", "10_notizen/.#x.md",
    "10_notizen/x.md.swp", "10_notizen/x.tmp", "10_notizen/#x.md#", ".git/objects/ab/cdef", ".git/index", ".git/refs/heads/main.lock", ".git/COMMIT_EDITMSG", "", "../x.md"]) {
    assert.equal(k(weg), null, weg);
  }
  assert.equal(k(".git/HEAD").bereich, "git");
  assert.equal(k(".git/refs/heads/main").bereich, "git");
  assert.equal(k(".git/MERGE_HEAD").bereich, "git");
  assert.equal(k("a\\b.md".replace("\\", "/")).pfad, "a/b.md");
  assert.equal(k("Ä.md".normalize("NFD")).pfad, "Ä.md"); // macOS liefert zerlegte Umlaute: NFC
});

test("aufgabenKopf: titel (JSON oder roh), status, quelle, typ; ohne Kopf leer", () => {
  assert.deepEqual(aufgabenKopf(aufgabeText("Lieferanten \"anrufen\"", { quelle: "ki:claude-code", status: "warten" })), { typ: "aufgabe", titel: "Lieferanten \"anrufen\"", status: "warten", quelle: "ki:claude-code" });
  assert.deepEqual(aufgabenKopf("---\ntitel: Roh ohne Anführungszeichen\n---\nText"), { titel: "Roh ohne Anführungszeichen" });
  assert.deepEqual(aufgabenKopf("Kein Kopf\n"), {});
});

// ───────────────────────────── Erkennen ─────────────────────────────

test("Datei anlegen: eine Meldung mit Nummer, Typ aufgabe, Titel, Quelle; Ändern → geaendert; Löschen → entfernt", async () => {
  const d = vaultOrdner(); const h = hub(d);
  let s = await grundstand(h);
  assert.equal(s.aktuell, 0); assert.equal(s.ereignisse.length, 0); assert.match(s.epoche, /^[0-9a-f]{12}$/);
  const p = join(d, "05_aufgaben", "2026-10-30-angebot.md");
  writeFileSync(p, aufgabeText("Angebot prüfen", { quelle: "ki:claude-code" }));
  let e = await sammle(h, s, (l) => l.some((x) => x.typ === "aufgabe"));
  const neu = e.filter((x) => x.typ === "aufgabe");
  assert.equal(neu.length, 1, JSON.stringify(e));
  assert.deepEqual({ ...neu[0], n: 0, zeit: 0 }, { n: 0, zeit: 0, typ: "aufgabe", art: "angelegt", pfad: "05_aufgaben/2026-10-30-angebot.md", titel: "Angebot prüfen", status: "offen", quelle: "ki:claude-code" });
  assert.ok(neu[0].n >= 1);
  s = { epoche: s.epoche, aktuell: e.at(-1).n };
  writeFileSync(p, aufgabeText("Angebot prüfen", { quelle: "ki:claude-code", status: "erledigt" }));
  e = await sammle(h, s, (l) => l.some((x) => x.typ === "aufgabe"));
  assert.equal(e.find((x) => x.typ === "aufgabe").art, "geaendert"); assert.equal(e.find((x) => x.typ === "aufgabe").status, "erledigt");
  s = { epoche: s.epoche, aktuell: e.at(-1).n };
  unlinkSync(p);
  e = await sammle(h, s, (l) => l.some((x) => x.typ === "aufgabe"));
  assert.equal(e.find((x) => x.typ === "aufgabe").art, "entfernt");
});

test("Notiz und Posteingang: eigene Typen; Ordner werden als Ordner gemeldet", async () => {
  const d = vaultOrdner(); const h = hub(d);
  const s = await grundstand(h);
  writeFileSync(join(d, "10_notizen", "start.md"), "# Start\n\nneu\n");
  mkdirSync(join(d, "00_inbox"), { recursive: true });
  writeFileSync(join(d, "00_inbox", "gedanke.md"), "Gedanke\n");
  mkdirSync(join(d, "20_projekte"));
  const e = await sammle(h, s, (l) => ["notiz:10_notizen/start.md", "posteingang:00_inbox/gedanke.md", "notiz:20_projekte"].every((k) => l.some((x) => `${x.typ}:${x.pfad}` === k)));
  const f = (typ, p) => e.find((x) => x.typ === typ && x.pfad === p);
  assert.equal(f("notiz", "10_notizen/start.md").art, "geaendert");
  assert.equal(f("posteingang", "00_inbox/gedanke.md").art, "geaendert");
  assert.equal(f("notiz", "20_projekte").art, "ordner");
});

test("Entprellen: viele Schreibvorgänge kurz hintereinander → genau ein Ereignis je Datei", async () => {
  const d = vaultOrdner(); const h = hub(d, { entprellMs: 150, maxWarteMs: 1000 });
  const s = await grundstand(h);
  const p = join(d, "10_notizen", "tippen.md");
  for (let i = 0; i < 25; i++) { writeFileSync(p, `# Tippen ${i}\n`); await pause(5); }
  const e = await sammle(h, s, (l) => l.length > 0);
  await pause(400);
  const mehr = await ruhe(h, { epoche: s.epoche, aktuell: e.at(-1).n }, 500);
  assert.equal(e.filter((x) => x.pfad === "10_notizen/tippen.md").length, 1, JSON.stringify(e));
  assert.deepEqual(mehr, [], "danach kommt nichts mehr nach");
});

test("Ignoriert: .git-Innenleben, .logs, .brain-tmp-*, Editor-Reste, Bilder, node_modules — nur die echte Datei wird gemeldet", async () => {
  const d = vaultOrdner(); const h = hub(d);
  const s = await grundstand(h);
  for (const [rel, inhalt] of [[".git/objects/ab/cd", "x"], [".git/index", "x"], [".logs/mcp.log", "x"], ["10_notizen/.brain-tmp-12-ab", "x"], ["10_notizen/x.md.swp", "x"],
    ["10_notizen/x.md~", "x"], ["10_notizen/bild.png", "x"], ["node_modules/p/readme.md", "x"], [".obsidian/app.json", "{}"]]) schreibe(d, rel, inhalt);
  await pause(100);
  schreibe(d, "10_notizen/echt.md", "# Echt\n");
  const e = await sammle(h, s, (l) => l.some((x) => x.pfad === "10_notizen/echt.md"));
  await pause(300);
  const rest = await ruhe(h, { epoche: s.epoche, aktuell: e.at(-1).n }, 400);
  assert.deepEqual([...e, ...rest].map((x) => x.pfad), ["10_notizen/echt.md"]);
});

// ───────────────────────────── Echo ─────────────────────────────

test("Echo: markiereEigen unterdrückt die Meldung zum eigenen Inhalt; ein anderer Inhalt danach wird gemeldet", async () => {
  const d = vaultOrdner(); const h = hub(d);
  const s = await grundstand(h);
  const p = join(d, "10_notizen", "eigen.md");
  h.beginneEigenes();
  writeFileSync(p, "# Eigen\n");
  await pause(200); // die Meldung wird zurückgehalten, solange die „Anfrage“ läuft
  h.endeEigenes(["10_notizen/eigen.md"]);
  const still = await ruhe(h, s, 600);
  assert.deepEqual(still, [], "eigener Schreibvorgang: kein Ereignis");
  writeFileSync(p, "# Eigen\n\nvon außen\n");
  const e = await sammle(h, s, (l) => l.length > 0);
  assert.equal(e[0].pfad, "10_notizen/eigen.md");
});

test("Echo über den Handler: PUT /api/datei, POST /api/aufgaben und PATCH melden nichts; ein externes Schreiben schon", async () => {
  const d = vaultOrdner();
  const support = tmp("brain-support-");
  const handler = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { entprellMs: 60, maxWarteMs: 300 } });
  hubs.push(handler.ereignisse);
  const rufe = async (methode, p, daten, query) => {
    const r = await handler({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    return { ...r, j: JSON.parse(r.body.toString("utf8")) };
  };
  const s = (await rufe("GET", "/api/ereignisse")).j;
  assert.equal(s.aktuell, 0);
  const hash = (await rufe("GET", "/api/datei", undefined, "pfad=10_notizen%2Fstart.md")).j.hash;
  assert.equal((await rufe("PUT", "/api/datei", { pfad: "10_notizen/start.md", inhalt: "# Start\n\nvon mir\n", basisHash: hash })).status, 200);
  const a = await rufe("POST", "/api/aufgaben", { titel: "Meine Aufgabe" });
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.equal((await rufe("PATCH", `/api/aufgaben/${a.j.pfad}`, { status: "in-arbeit" })).status, 200);
  await pause(700);
  let r = (await rufe("GET", "/api/ereignisse", undefined, `seit=0&epoche=${s.epoche}&warte=0`)).j;
  assert.deepEqual(r.ereignisse, [], "eigene Schreibvorgänge erzeugen kein Echo: " + JSON.stringify(r.ereignisse));
  writeFileSync(join(d, "10_notizen", "start.md"), "# Start\n\nvon außen\n");
  r = (await rufe("GET", "/api/ereignisse", undefined, `seit=0&epoche=${s.epoche}&warte=5`)).j;
  assert.equal(r.ereignisse.length, 1); assert.equal(r.ereignisse[0].pfad, "10_notizen/start.md");
});

// ───────────────────────────── Long-Poll ─────────────────────────────

test("Long-Poll: Grundstand sofort, Neues sofort, sonst Warten bis zur Frist (leer, gleiche Nummer); falsche Epoche und zu alte Nummer → verpasst", async () => {
  const d = vaultOrdner(); const h = hub(d, { ring: 5 });
  const s = await grundstand(h);
  const t0 = Date.now();
  const leer = await h.warte({ seit: 0, epoche: s.epoche, warteMs: 250 });
  assert.ok(Date.now() - t0 >= 200, "wartet bis zur Frist");
  assert.deepEqual([leer.aktuell, leer.ereignisse.length, leer.verpasst], [0, 0, false]);
  h.melde({ typ: "notiz", pfad: "a.md", art: "geaendert" });
  const sofort = Date.now();
  const r = await h.warte({ seit: 0, epoche: s.epoche, warteMs: 5000 });
  assert.ok(Date.now() - sofort < 200, "Neues kommt ohne Warten");
  assert.deepEqual(r.ereignisse.map((x) => [x.n, x.pfad]), [[1, "a.md"]]);
  // wartender Abruf wird vom nächsten Ereignis geweckt
  const wartend = h.warte({ seit: 1, epoche: s.epoche, warteMs: 5000 });
  await pause(50); h.melde({ typ: "notiz", pfad: "b.md", art: "geaendert" });
  assert.deepEqual((await wartend).ereignisse.map((x) => x.n), [2]);
  // andere Epoche (Werkstatt neu gestartet) und Nummer aus der Zukunft
  assert.equal((await h.warte({ seit: 1, epoche: "anders", warteMs: 0 })).verpasst, true);
  assert.equal((await h.warte({ seit: 99, epoche: s.epoche, warteMs: 0 })).verpasst, true);
  // Ring (5): wer zu weit zurückliegt, hat etwas verpasst
  for (let i = 0; i < 10; i++) h.melde({ typ: "notiz", pfad: `c${i}.md`, art: "geaendert" });
  assert.equal((await h.warte({ seit: 1, epoche: s.epoche, warteMs: 0 })).verpasst, true);
  const nah = await h.warte({ seit: 10, epoche: s.epoche, warteMs: 0 });
  assert.equal(nah.verpasst, false); assert.deepEqual(nah.ereignisse.map((x) => x.n), [11, 12]);
});

test("Vault-Wechsel: neue Epoche, wartende Abrufe kommen sofort mit „verpasst“", async () => {
  const d1 = vaultOrdner(), d2 = vaultOrdner(); const h = hub(d1);
  const s = await grundstand(h);
  const wartend = h.warte({ seit: 0, epoche: s.epoche, warteMs: 5000 });
  await pause(50);
  h.richteAuf(d2, { aufgabenOrdner: "05_aufgaben" });
  const r = await wartend;
  assert.equal(r.verpasst, true); assert.notEqual(r.epoche, s.epoche);
  // der neue Vault wird beobachtet
  const s2 = await grundstand(h);
  schreibe(d2, "10_notizen/neu.md", "# Neu\n");
  assert.ok((await sammle(h, s2, (l) => l.length > 0)).some((x) => x.pfad === "10_notizen/neu.md"));
});

test("beende(): wartende Abrufe werden sofort beantwortet", async () => {
  const h = hub(vaultOrdner());
  const s = await grundstand(h);
  const t0 = Date.now();
  const wartend = h.warte({ seit: 0, epoche: s.epoche, warteMs: 20_000 });
  await pause(30); h.beende();
  await wartend;
  assert.ok(Date.now() - t0 < 2000);
});

// ───────────────────────────── Grenzen ─────────────────────────────

test("Ratenbegrenzung: ein Schwall von Dateien wird zu einem einzigen „alles“, nicht zu Hunderten Meldungen", async () => {
  const d = vaultOrdner(); const h = hub(d, { maxJeFlush: 20, maxWarteMs: 400 });
  const s = await grundstand(h);
  for (let i = 0; i < 300; i++) writeFileSync(join(d, "10_notizen", `viele-${i}.md`), `# ${i}\n`);
  const e = await sammle(h, s, (l) => l.some((x) => x.typ === "alles"));
  await pause(300);
  const rest = await ruhe(h, { epoche: s.epoche, aktuell: e.at(-1).n }, 600);
  const alle = [...e, ...rest];
  assert.ok(alle.some((x) => x.typ === "alles"), JSON.stringify(alle).slice(0, 300));
  assert.ok(alle.length <= 25, `höchstens eine Handvoll Meldungen statt 300: ${alle.length}`);
});

test("Dauerfeuer: über mehrere Flush-Runden bleibt die Zahl der Meldungen im Rahmen (Fenster-Grenze)", async () => {
  const d = vaultOrdner(); const h = hub(d, { entprellMs: 20, maxWarteMs: 40, maxProFenster: 30, fensterMs: 5000 });
  const s = await grundstand(h);
  for (let runde = 0; runde < 12; runde++) {
    for (let i = 0; i < 8; i++) writeFileSync(join(d, "10_notizen", `r${runde}-${i}.md`), `# ${runde}${i}\n`);
    await pause(60);
  }
  const e = await sammle(h, s, (l) => l.some((x) => x.typ === "alles"));
  assert.ok(e.some((x) => x.typ === "alles"), "irgendwann wird gedrosselt");
  await pause(500);
  const mehr = await ruhe(h, { epoche: s.epoche, aktuell: e.at(-1).n }, 500);
  assert.ok(e.length + mehr.length < 12 * 8, `weniger Meldungen als Dateien: ${e.length + mehr.length}`);
});

// ───────────────────────────── Polling-Rückfall ─────────────────────────────

test("Polling statt fs.watch: neue, geänderte und gelöschte Dateien; Versteckes bleibt still", async () => {
  const d = vaultOrdner(); const h = hub(d, { modus: "poll" });
  const s = await grundstand(h);
  assert.equal(h.stand().modus, "poll");
  const p = join(d, "05_aufgaben", "poll.md");
  writeFileSync(p, aufgabeText("Per Polling", { quelle: "ki:codex" }));
  schreibe(d, ".logs/x.md", "x");
  let e = await sammle(h, s, (l) => l.some((x) => x.typ === "aufgabe"));
  assert.deepEqual(e.map((x) => [x.typ, x.art, x.pfad]), [["aufgabe", "angelegt", "05_aufgaben/poll.md"]]);
  assert.equal(e[0].quelle, "ki:codex");
  let st = { epoche: s.epoche, aktuell: e.at(-1).n };
  writeFileSync(p, aufgabeText("Per Polling", { status: "erledigt" }) + "mehr Text\n");
  e = await sammle(h, st, (l) => l.length > 0);
  assert.equal(e[0].art, "geaendert");
  st = { epoche: s.epoche, aktuell: e.at(-1).n };
  unlinkSync(p);
  e = await sammle(h, st, (l) => l.length > 0);
  assert.equal(e[0].art, "entfernt");
});

// ───────────────────────────── Git ─────────────────────────────

test("Git: ein neuer Commit von außen meldet „git/neuer-stand“; der eigene (markiereEigenenKopf) nicht", async () => {
  const d = repo("brain-live-git-");
  mkdirSync(join(d, "05_aufgaben"), { recursive: true });
  const h = hub(d);
  const s = await grundstand(h);
  assert.ok(gitStand(d)?.kopf);
  schreibe(d, "10_notizen/a.md", "# A\n");
  g(d, "add", "--", "10_notizen/a.md"); g(d, "commit", "-q", "-m", "extern");
  const e = await sammle(h, s, (l) => l.some((x) => x.typ === "git"));
  assert.equal(e.find((x) => x.typ === "git").art, "neuer-stand");
  assert.ok(e.some((x) => x.typ === "notiz" && x.pfad === "10_notizen/a.md"));
  // eigener Commit: die Werkstatt hält die Meldung zurück und merkt sich den neuen Kopf
  const st = { epoche: s.epoche, aktuell: e.at(-1).n };
  h.beginneEigenes();
  schreibe(d, "10_notizen/b.md", "# B\n");
  g(d, "add", "--", "10_notizen/b.md"); g(d, "commit", "-q", "-m", "eigen");
  await pause(150);
  h.endeEigenes(["10_notizen/b.md"], { kopf: true });
  const still = await ruhe(h, st, 700);
  assert.deepEqual(still, [], "eigener Commit: kein Ereignis");
});

test("Git: gitStand liest HEAD ohne git zu starten (Zweig, losgelöst, packed-refs, MERGE_HEAD); ohne .git → null", () => {
  assert.equal(gitStand(tmp()), null);
  const d = repo("brain-live-git2-");
  const sha = g(d, "rev-parse", "HEAD").trim();
  assert.deepEqual(gitStand(d), { kopf: sha, merge: false });
  g(d, "pack-refs", "--all");
  assert.equal(gitStand(d).kopf, sha, "aus packed-refs");
  writeFileSync(join(d, ".git", "MERGE_HEAD"), sha + "\n");
  assert.equal(gitStand(d).merge, true);
});

// ───────────────────────────── Route ─────────────────────────────

test("Route /api/ereignisse: nur GET, „seit“ muss eine Nummer sein, ohne Vault antwortet sie trotzdem", async () => {
  const d = vaultOrdner();
  const handler = erzeugeHandler({ vault: d, vaultOptionen: { support: tmp("brain-support-") } });
  hubs.push(handler.ereignisse);
  const rufe = async (methode, p, query) => { const r = await handler({ methode, pfad: p, query }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  assert.equal((await rufe("POST", "/api/ereignisse", "")).status, 405);
  assert.equal((await rufe("GET", "/api/ereignisse", "seit=abc")).status, 400);
  assert.equal((await rufe("GET", "/api/ereignisse", "seit=-1")).status, 400);
  const r = await rufe("GET", "/api/ereignisse", "");
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.j).sort(), ["aktuell", "epoche", "ereignisse", "verpasst"]);
  const stumm = await rufe("GET", "/api/ereignisse", `seit=0&epoche=${r.j.epoche}&warte=0`);
  assert.deepEqual(stumm.j.ereignisse, []);
  const ohne = erzeugeHandler({ vaultOptionen: { support: tmp("brain-support-") } });
  hubs.push(ohne.ereignisse);
  const o = await ohne({ methode: "GET", pfad: "/api/ereignisse", query: "" });
  assert.equal(o.status, 200);
});

// ───────────────────────────── Werkstatt-Prozess ─────────────────────────────

test("Werkstatt-Prozess: ein wartender Abruf hält das Ende nicht auf (stdin zu → sofort beendet, Antwort kommt noch)", async () => {
  const d = vaultOrdner();
  const env = baueTestUmgebung({ HOME: tmp("brain-home-"), BRAIN_APP_SUPPORT: tmp("brain-support-"), KORTEX_VAULT_VERTRAUT: "alle" });
  const p = spawn(process.execPath, [pfad("werkstatt", "werkstatt.mjs"), d], { stdio: ["pipe", "pipe", "ignore"], env });
  kinder.push(p);
  const zeilen = []; let weiter = null;
  createInterface({ input: p.stdout }).on("line", (z) => { zeilen.push(JSON.parse(z)); weiter?.(); });
  const auf = (f) => new Promise((ok) => { const pruefe = () => { if (f()) { weiter = null; ok(); } }; weiter = pruefe; pruefe(); });
  await auf(() => zeilen.some((z) => z.bereit));
  const senden = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  senden({ id: 1, methode: "GET", pfad: "/api/ereignisse", query: null, body: null });
  await auf(() => zeilen.some((z) => z.id === 1));
  const grund = JSON.parse(Buffer.from(zeilen.find((z) => z.id === 1).body, "base64").toString());
  senden({ id: 2, methode: "GET", pfad: `/api/ereignisse?seit=0&epoche=${grund.epoche}&warte=30`, query: null, body: null });
  await pause(150);
  const ende = new Promise((ok) => p.on("close", ok));
  const t0 = Date.now();
  p.stdin.end();
  await ende;
  assert.ok(Date.now() - t0 < 4000, `beendet in ${Date.now() - t0} ms (ein 30-s-Abruf hätte es aufgehalten)`);
  assert.ok(zeilen.some((z) => z.id === 2 && z.status === 200), "auch der wartende Abruf wurde noch beantwortet");
});

// ───────────────────────────── Ende zu Ende: MCP legt eine Aufgabe an ─────────────────────────────

test("MCP brain_aufgabe_anlegen → Ereignis aufgabe/angelegt mit Quelle ki:<client> und Titel, ohne dass jemand fragt (Latenz gemessen)", async () => {
  const d = vaultOrdner();
  const support = tmp("brain-support-");
  const home = tmp("brain-home-");
  const handler = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { entprellMs: 150, maxWarteMs: 600 } });
  hubs.push(handler.ereignisse);
  const rufeApi = async (p, query) => JSON.parse((await handler({ methode: "GET", pfad: p, query })).body.toString("utf8"));
  const s = await rufeApi("/api/ereignisse", "");
  const env = baueTestUmgebung({ HOME: home, BRAIN_APP_SUPPORT: support, KORTEX_VAULT_VERTRAUT: "alle", BRAIN_NUTZUNG: "aus" });
  const m = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), d], { stdio: ["pipe", "pipe", "pipe"], env, cwd: home });
  kinder.push(m);
  const antw = new Map(), wart = new Map();
  createInterface({ input: m.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wart.get(o.id); if (w) w(o); else antw.set(o.id, o); });
  const frage = (id, method, params) => new Promise((ok) => { if (antw.has(id)) return ok(antw.get(id)); wart.set(id, ok); m.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await frage(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } });
  const t0 = Date.now();
  const warteAuf = rufeApi("/api/ereignisse", `seit=0&epoche=${s.epoche}&warte=10`);
  const a = await frage(2, "tools/call", { name: "brain_aufgabe_anlegen", arguments: { titel: "Per KI angelegt" } });
  assert.ok(!a.result.isError, JSON.stringify(a));
  const r = await warteAuf;
  const dauer = Date.now() - t0;
  m.stdin.end();
  const e = r.ereignisse.find((x) => x.typ === "aufgabe");
  assert.ok(e, JSON.stringify(r));
  assert.deepEqual([e.art, e.titel, e.quelle, e.status], ["angelegt", "Per KI angelegt", "ki:claude-code", "offen"]);
  assert.match(e.pfad, /^05_aufgaben\/\d{4}-\d{2}-\d{2}-per-ki-angelegt\.md$/);
  assert.equal(readFileSync(join(d, e.pfad), "utf8").includes("quelle: ki:claude-code"), true);
  assert.ok(dauer < 2500, `Ereignis nach ${dauer} ms`);
  console.log(`# Latenz MCP → Ereignis: ${dauer} ms`);
});

// ───────────────────────────── Archiv ─────────────────────────────

test("Archiv: eine Aufgabe, die nach <aufgaben>/archiv/ wandert, meldet „archiviert“ (nie „angelegt“) und „entfernt“ am alten Ort; eigenes Archivieren bleibt still", async () => {
  const d = vaultOrdner();
  const handler = erzeugeHandler({ vault: d, vaultOptionen: { support: tmp("brain-support-") }, ereignisse: { entprellMs: 60, maxWarteMs: 300, modus: "poll", pollMs: 80 } });
  hubs.push(handler.ereignisse);
  const rufe = async (methode, p, daten, query) => { const r = await handler({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); return { status: r.status, j: JSON.parse(r.body.toString("utf8")) }; };
  const a = (await rufe("POST", "/api/aufgaben", { titel: "Zum Archivieren" })).j.pfad;
  const b = (await rufe("POST", "/api/aufgaben", { titel: "Von außen archiviert" })).j.pfad;
  await rufe("PATCH", `/api/aufgaben/${a}`, { status: "erledigt" });
  await rufe("PATCH", `/api/aufgaben/${b}`, { status: "erledigt" });
  const s = (await rufe("GET", "/api/ereignisse")).j;
  await pause(200);
  const r1 = await rufe("POST", "/api/aufgaben/archivieren", { pfad: a });
  assert.equal(r1.status, 200, JSON.stringify(r1.j));
  await pause(700);
  assert.deepEqual((await rufe("GET", "/api/ereignisse", undefined, `seit=0&epoche=${s.epoche}&warte=0`)).j.ereignisse, [], "eigenes Archivieren: kein Echo");
  // von außen (wie die KI oder der Finder): Datei verschieben
  mkdirSync(join(d, "05_aufgaben", "archiv"), { recursive: true });
  renameSync(join(d, b), join(d, "05_aufgaben", "archiv", b.split("/").pop()));
  await rufe("GET", "/api/ereignisse", undefined, `seit=0&epoche=${s.epoche}&warte=5`);
  await pause(400);
  const alle = (await rufe("GET", "/api/ereignisse", undefined, `seit=0&epoche=${s.epoche}&warte=0`)).j.ereignisse;
  assert.ok(alle.some((x) => x.typ === "aufgabe" && x.art === "archiviert" && x.pfad.includes("/archiv/")), JSON.stringify(alle));
  assert.ok(alle.some((x) => x.typ === "aufgabe" && x.art === "entfernt" && x.pfad === b), JSON.stringify(alle));
  assert.ok(!alle.some((x) => x.art === "angelegt"), "im Archiv entsteht keine neue Aufgabe");
});
