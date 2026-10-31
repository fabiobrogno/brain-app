// Kontingent (Paket P7): das Statuszeilen-Skript von Kortex (gemeinsam/kortex-statuszeile.mjs) als Kette — Durchreichen, vorhandene Statuszeile, ungültiges JSON, atomares Schreiben,
// nur die erlaubten Felder. Nur Wegwerf-Orte unter dem Temp-Ordner; das Skript läuft als Kindprozess mit ausdrücklich gebauter Umgebung (nichts vom Rechner wird geerbt).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, existsSync, utimesSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

const QUELLE = pfad("gemeinsam", "kortex-statuszeile.mjs");
const { leseStatuszeile, leseFenster, zeichneAuf, MIN_SCHREIB_ABSTAND_MS } = await import(QUELLE);

// Ein Support-Ordner mit <support>/kontingent/bin/kortex-statuszeile.mjs, genau wie ihn die Werkstatt anlegt
function aufbau() {
  const support = tmp("brain-kontingent-");
  const k = join(support, "kontingent");
  mkdirSync(join(k, "bin"), { recursive: true });
  copyFileSync(QUELLE, join(k, "bin", "kortex-statuszeile.mjs"));
  return { support, k, skript: join(k, "bin", "kortex-statuszeile.mjs"), home: tmp("brain-home-") };
}
const kette = (a, id, command) => { mkdirSync(join(a.k, "kette"), { recursive: true }); writeFileSync(join(a.k, "kette", `${id}.json`), JSON.stringify({ command, original: { type: "command", command } })); };
const lauf = (a, id, eingabe, env = {}) => spawnSync(process.execPath, [a.skript, "--konto", id], {
  input: eingabe, env: { PATH: "/usr/bin:/bin", HOME: a.home, ...env }, cwd: a.home, timeout: 20_000,
});
const AUS = { rate_limits: { five_hour: { used_percentage: 42, resets_at: 1893456000 }, seven_day: { used_percentage: 18.5, resets_at: 1893888000 } } };
const ID = "k_aaaa0001";

test("Ohne frühere Statuszeile: die Ausgabe bleibt leer, Exit 0 — und die Werte stehen in <konto>.json (0600, nur die erlaubten Felder)", () => {
  const a = aufbau();
  const geheim = { ...AUS, session_id: "GEHEIM-SITZUNG", transcript_path: "/Users/x/.claude/projects/GEHEIM/a.jsonl", model: { id: "m", display_name: "Opus" }, workspace: { current_dir: "/Users/x/Firma" }, cost: { total_cost_usd: 1.5 }, token: "sk-ant-GEHEIM" };
  const r = lauf(a, ID, JSON.stringify(geheim));
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(r.stdout.length, 0);
  assert.equal(r.stderr.length, 0);
  const datei = join(a.k, `${ID}.json`);
  const roh = readFileSync(datei, "utf8");
  const j = JSON.parse(roh);
  assert.equal(j.v, 1);
  assert.deepEqual(j.session, { usedPercent: 42, windowMinutes: 300, resetsAt: 1893456000 * 1000 });
  assert.deepEqual(j.weekly, { usedPercent: 18.5, windowMinutes: 10080, resetsAt: 1893888000 * 1000 });
  assert.deepEqual(Object.keys(j).sort(), ["geschrieben", "session", "v", "weekly"]);
  for (const s of ["GEHEIM", "sk-ant", "transcript", "session_id", "Opus", "Firma", "cost"]) assert.ok(!roh.includes(s), `„${s}“ darf nie in der Datei stehen`);
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(a.k).filter((n) => n.includes(".tmp-")), [], "keine Temp-Reste");
});

test("Eine vorhandene Statuszeile wird mit derselben Eingabe aufgerufen und ihre Ausgabe BYTEGLEICH durchgereicht (ohne Zeilenende, ANSI, Umlaute, Exit-Code, stderr)", () => {
  const a = aufbau();
  const eingabe = JSON.stringify({ ...AUS, hallo: "Grüße ✓" });
  const befehl = "printf '\\033[32mOK\\033[0m Grüße ✓ ohne Zeilenende'; cat >&2; exit 3";
  kette(a, ID, befehl);
  const direkt = spawnSync("/bin/sh", ["-c", befehl], { input: eingabe, env: { PATH: "/usr/bin:/bin" } });
  const r = lauf(a, ID, eingabe);
  assert.equal(r.status, 3);
  assert.ok(r.stdout.equals(direkt.stdout), "stdout muss byteweise gleich sein");
  assert.ok(r.stderr.equals(direkt.stderr), "stderr (= die unveränderte Eingabe) muss byteweise gleich sein");
  assert.equal(r.stderr.toString("utf8"), eingabe);
  assert.ok(existsSync(join(a.k, `${ID}.json`)), "nebenbei wurden die Werte gemerkt");
});

test("Die Kette bekommt die Eingabe auch dann, wenn sie kein gültiges JSON ist — und es wird nichts aufgezeichnet", () => {
  const a = aufbau();
  kette(a, ID, "cat");
  for (const roh of ["das ist kein JSON {", "", "[1,2,3]", "null", "\"text\"", "{\"rate_limits\": 7}"]) {
    const r = lauf(a, ID, roh);
    assert.equal(r.status, 0, roh);
    assert.equal(r.stdout.toString("utf8"), roh, `Eingabe „${roh}“ muss unverändert durchlaufen`);
  }
  // [1,2,3], null, "text", {"rate_limits":7} sind gültiges JSON ohne Kontingent: höchstens der Hinweis „ohne“, nie Werte
  const f = join(a.k, `${ID}.json`);
  if (existsSync(f)) { const j = JSON.parse(readFileSync(f, "utf8")); assert.equal(j.ohne, true); assert.equal(j.session, undefined); }
  const a2 = aufbau();
  lauf(a2, ID, "kein json");
  assert.ok(!existsSync(join(a2.k, `${ID}.json`)), "bei ungültigem JSON entsteht keine Datei");
});

test("Ohne rate_limits (alte Version, API-Schlüssel) merkt sich das Skript nur „ohne“ — damit die Oberfläche es ehrlich sagen kann", () => {
  const a = aufbau();
  assert.equal(lauf(a, ID, JSON.stringify({ model: { id: "x" } })).status, 0);
  const j = JSON.parse(readFileSync(join(a.k, `${ID}.json`), "utf8"));
  assert.deepEqual(Object.keys(j).sort(), ["geschrieben", "ohne", "v"]);
  assert.equal(j.ohne, true);
});

test("Atomar und höchstens alle 15 Sekunden: ein zweiter Aufruf kurz danach schreibt nicht, ein späterer ersetzt die Datei ganz", () => {
  const a = aufbau();
  const datei = join(a.k, `${ID}.json`);
  assert.equal(zeichneAuf(a.k, ID, AUS, 1_000_000), true);
  const m1 = statSync(datei).mtimeMs;
  const neuerWert = { rate_limits: { five_hour: { used_percentage: 77 } } };
  assert.equal(zeichneAuf(a.k, ID, neuerWert, m1 + 5_000), false, "innerhalb von 15 s");
  assert.equal(JSON.parse(readFileSync(datei, "utf8")).session.usedPercent, 42);
  assert.equal(zeichneAuf(a.k, ID, neuerWert, m1 + MIN_SCHREIB_ABSTAND_MS + 1), true);
  const j = JSON.parse(readFileSync(datei, "utf8"));
  assert.equal(j.session.usedPercent, 77);
  assert.equal(j.weekly, null);
  assert.deepEqual(readdirSync(a.k).filter((n) => n.includes(".tmp-")), []);
  // Die Datei ist nie halb geschrieben zu sehen: viele Aufrufe hintereinander, jede Fassung ist vollständiges JSON
  for (let i = 0; i < 20; i++) { utimesSync(datei, new Date(2020, 0, 1), new Date(2020, 0, 1)); zeichneAuf(a.k, ID, { rate_limits: { five_hour: { used_percentage: i } } }); JSON.parse(readFileSync(datei, "utf8")); }
});

test("Kein Konto-Name, der aus dem Ordner herausführt: ungültige Kennungen schreiben nichts, die Kette läuft trotzdem", () => {
  const a = aufbau();
  kette(a, "k_aaaa0001", "echo kette");
  for (const bose of ["../x", "a/b", "", "k..", "x y", "a".repeat(80)]) {
    const r = spawnSync(process.execPath, [a.skript, "--konto", bose], { input: JSON.stringify(AUS), env: { PATH: "/usr/bin:/bin", HOME: a.home }, cwd: a.home });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.length, 0, "ohne gültige Kennung auch keine Kette");
  }
  assert.deepEqual(readdirSync(a.k).sort(), ["bin", "kette"]);
  assert.equal(existsSync(join(a.support, "x.json")), false);
});

test("Scheitert das Schreiben (Ziel ist ein Ordner, Ordner nicht beschreibbar), läuft die Kette trotzdem und der Exit-Code ist der der Kette", () => {
  const a = aufbau();
  kette(a, ID, "cat; exit 0");
  mkdirSync(join(a.k, `${ID}.json`)); // das Ziel der Umbenennung ist ein Ordner → Schreiben schlägt fehl
  const r = lauf(a, ID, JSON.stringify(AUS));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.toString("utf8"), JSON.stringify(AUS));
  assert.deepEqual(readdirSync(a.k).filter((n) => n.includes(".tmp-")), [], "kein Temp-Rest nach dem Fehlschlag");
});

test("Kaputte Kette-Datei oder fehlender Befehl: das Skript gibt nichts aus und scheitert nicht", () => {
  const a = aufbau();
  mkdirSync(join(a.k, "kette"), { recursive: true });
  writeFileSync(join(a.k, "kette", `${ID}.json`), "{kaputt");
  let r = lauf(a, ID, JSON.stringify(AUS));
  assert.equal(r.status, 0); assert.equal(r.stdout.length, 0);
  writeFileSync(join(a.k, "kette", `${ID}.json`), JSON.stringify({ command: "   " }));
  r = lauf(a, ID, JSON.stringify(AUS));
  assert.equal(r.status, 0); assert.equal(r.stdout.length, 0);
});

test("Eine hängende frühere Statuszeile hält die Anzeige nicht ewig auf: nach dem Zeitlimit endet die Kette samt allem, was sie gestartet hat", async () => {
  const a = aufbau();
  const pidDatei = join(a.home, "kind.pid");
  kette(a, ID, `sleep 61 & echo $! > '${pidDatei}'; wait`);
  const t0 = Date.now();
  const r = lauf(a, ID, JSON.stringify(AUS));
  assert.ok(Date.now() - t0 < 15_000, "Zeitlimit der Kette greift (8 s)");
  assert.notEqual(r.status, null);
  const pid = Number(readFileSync(pidDatei, "utf8").trim());
  assert.ok(pid > 1);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "auch der Enkelprozess ist beendet — es bleibt nichts im Hintergrund");
}, { timeout: 30_000 });

// ---------- Der Leser (Orcas Fälle: claude-statusline-rate-limits.ts) ----------
test("Parser: fehlende Felder, ISO-Zeit, utilization, Grenzen, falsche Typen", () => {
  assert.equal(leseStatuszeile(null), null);
  assert.equal(leseStatuszeile({}), null);
  assert.equal(leseStatuszeile({ rate_limits: null }), null);
  assert.equal(leseStatuszeile({ rate_limits: [] }), null);
  assert.equal(leseStatuszeile({ rate_limits: { five_hour: {} } }), null);
  assert.equal(leseStatuszeile({ rate_limits: { five_hour: { used_percentage: "42" } } }), null, "Text statt Zahl zählt nicht");
  assert.equal(leseStatuszeile({ rate_limits: { five_hour: { used_percentage: NaN } } }), null);
  // nur ein Fenster ist genug
  const nurWoche = leseStatuszeile({ rate_limits: { seven_day: { used_percentage: 9 } } });
  assert.equal(nurWoche.session, null); assert.deepEqual(nurWoche.weekly, { usedPercent: 9, windowMinutes: 10080, resetsAt: null });
  // Schemaänderung: utilization statt used_percentage, ISO-Text statt Epochensekunden
  const drift = leseStatuszeile({ rate_limits: { five_hour: { utilization: 63.2, resets_at: "2030-01-02T03:04:05Z" } } });
  assert.equal(drift.session.usedPercent, 63.2);
  assert.equal(drift.session.resetsAt, Date.parse("2030-01-02T03:04:05Z"));
  // used_percentage hat Vorrang vor utilization
  assert.equal(leseFenster({ used_percentage: 10, utilization: 99 }, 300).usedPercent, 10);
  // Grenzen 0–100, unlesbare Zeit → null
  assert.equal(leseFenster({ used_percentage: 140 }, 300).usedPercent, 100);
  assert.equal(leseFenster({ used_percentage: -5 }, 300).usedPercent, 0);
  assert.equal(leseFenster({ used_percentage: 5, resets_at: "gestern" }, 300).resetsAt, null);
  assert.equal(leseFenster({ used_percentage: 5, resets_at: 0 }, 300).resetsAt, null);
  assert.equal(leseFenster({ used_percentage: 5, resets_at: {} }, 300).resetsAt, null);
});
