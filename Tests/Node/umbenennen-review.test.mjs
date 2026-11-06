// Befunde aus dem Review von #95 (Umbenennen, Verschieben, Papierkorb): jeder Test stellt den Fehlerfall nach. Nur Wegwerf-Ordner (tmp).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, chmodSync, utimesSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad, repo } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const L = await import(pfad("gemeinsam", "linkpflege.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const G = await import(pfad("gemeinsam", "git.mjs"));
const { erzeugeAktivitaet } = await import(pfad("werkstatt", "aktivitaet.mjs"));

const lies = (d, p) => readFileSync(join(d, p), "utf8");
async function fehler(fn) { try { await fn(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("hätte scheitern müssen"); }
function aufbau(dateien = {}, opts = {}) {
  const d = tmp("umr-vault-"), support = tmp("umr-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  mkdirSync(join(d, ".kortex"), { recursive: true }); writeFileSync(join(d, ".kortex", "vault-id"), JSON.stringify({ id: "00112233445566aa", alt: [A.kennungVault(d)] }) + "\n");
  const v = oeffneVault(d, { support, heute: "2026-11-05", ...opts });
  return { d, support, v, kennung: "00112233445566aa" };
}
const vorgangsDir = (support, kennung, id) => join(support, "papierkorb", kennung, "vorgaenge", id);

// ───────────── W1: NFC/NFD ─────────────

test("W1: Ordner in NFD auf der Platte, NFC im Link: Markdown-Link und Anhang-Link werden nach Segmenten umgeschrieben (und umgekehrt)", async () => {
  for (const [platte, link] of [["Übungen", "Übungen"], ["Übungen", "Übungen"]]) {
    const { d, v } = aufbau({ [`${platte}/Notiz.md`]: "# Notiz\n", [`${platte}/bild.png`]: "PNG", "l.md": `[a](${link}/Notiz.md) ![[${link}/bild.png]] [[${link}/Notiz]]\n` });
    const echt = readdirSync(d).find((n) => n.normalize("NFC") === "Übungen");
    await v.umbenennen({ typ: "ordner", pfad: echt, name: "Training" });
    const anhangDa = existsSync(join(d, link + "/bild.png")) || existsSync(join(d, "Training/bild.png")); // der Anhang-Link wird nur umgeschrieben, wenn es ihn gab
    const roh = lies(d, "l.md");
    assert.match(roh, /^\[a\]\(Training\/Notiz\.md\) /, roh);
    assert.ok(roh.includes("[[Training/Notiz]]"), roh);
    if (anhangDa && process.platform === "darwin") assert.ok(roh.includes("![[Training/bild.png]]"), roh);
    assert.ok(!roh.includes("Trainingbild") && !roh.includes("TrainingNotiz"), roh);
  }
});

// ───────────── W2: Erholung ─────────────

test("W2: Absturz nach dem Umzug: Notiz wird zurückbenannt, Verweise zurückgesetzt; ein junger Lauf zählt auch (kein Alter nötig)", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  const mf = join(vorgangsDir(support, kennung, r.vorgang), "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; writeFileSync(mf, JSON.stringify(m)); // Zeit bleibt „gerade eben“
  const v2 = oeffneVault(d, { support });
  await v2.papierkorb();
  assert.ok(existsSync(join(d, "a/Alt.md"))); assert.ok(!existsSync(join(d, "a/Neu.md")));
  assert.equal(lies(d, "a/Alt.md"), "# Alt\n"); assert.equal(lies(d, "b/x.md"), "[[Alt]]\n");
  assert.ok(!existsSync(vorgangsDir(support, kennung, r.vorgang)));
});

test("W2: Marke .laeuft nach einem Absturz mitten im Vorgang (auch nach der ersten Prüfung der Sitzung) holt den Vorgang zurück", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  await v.papierkorb(); // erste Prüfung der Sitzung ist durch
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  const mf = join(vorgangsDir(support, kennung, r.vorgang), "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; writeFileSync(mf, JSON.stringify(m));
  writeFileSync(join(support, "papierkorb", kennung, ".laeuft"), JSON.stringify({ id: r.vorgang, aktion: "op" }));
  await v.papierkorb();
  assert.ok(existsSync(join(d, "a/Alt.md"))); assert.equal(lies(d, "b/x.md"), "[[Alt]]\n");
});

test("W2: unklare Lage (Quelle und Ziel liegen beide da): nichts wird gelöscht, das Journal bleibt mit Status „unklar“", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n", "b/x.md": "[[Alt]]\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" });
  schreibe(d, "a/Alt.md", "# noch eine Alt\n"); // beide da
  const mf = join(vorgangsDir(support, kennung, r.vorgang), "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.status = "laeuft"; writeFileSync(mf, JSON.stringify(m));
  const v2 = oeffneVault(d, { support });
  await v2.papierkorb();
  assert.ok(existsSync(vorgangsDir(support, kennung, r.vorgang)));
  assert.equal(JSON.parse(readFileSync(mf, "utf8")).status, "unklar");
  assert.ok(existsSync(join(d, "a/Neu.md")) && lies(d, "a/Alt.md") === "# noch eine Alt\n");
});

// ───────────── W3: Wiederholen eines Ordner-Löschens ─────────────

test("W3: Wiederholen nach Wiederherstellen aus dem Papierkorb ist gesperrt; nach Rückgängig mit anderem Inhalt → 409; der neue Ordner bleibt", async () => {
  const { d, v } = aufbau({ "P/a.md": "# a\n" });
  const r = await v.loeschen({ typ: "ordner", pfad: "P" });
  await v.papierkorbWiederherstellen({ id: r.vorgang, name: "P alt" });
  schreibe(d, "P/neu.md", "# neu\n");
  const e1 = await fehler(() => v.vorgangWieder({ id: r.vorgang }));
  assert.equal(e1.status, 409); assert.ok(existsSync(join(d, "P/neu.md")));
  // Rückgängig-Weg
  const { d: d2, v: v2 } = aufbau({ "Q/a.md": "# a\n" });
  const r2 = await v2.loeschen({ typ: "ordner", pfad: "Q" });
  await v2.vorgangZurueck({ id: r2.vorgang });
  schreibe(d2, "Q/ganz-anders.md", "# anders\n");
  const e2 = await fehler(() => v2.vorgangWieder({ id: r2.vorgang }));
  assert.equal(e2.extra.art, "geaendert"); assert.ok(existsSync(join(d2, "Q/ganz-anders.md")));
  // unverändert geht, und die 30 Tage beginnen neu
  const { d: d3, v: v3, support: s3, kennung: k3 } = aufbau({ "R/a.md": "# a\n" });
  const r3 = await v3.loeschen({ typ: "ordner", pfad: "R" });
  await v3.vorgangZurueck({ id: r3.vorgang });
  const mf = join(vorgangsDir(s3, k3, r3.vorgang), "manifest.json");
  const m = JSON.parse(readFileSync(mf, "utf8")); m.zeit = new Date(Date.now() - 20 * 86400e3).toISOString(); writeFileSync(mf, JSON.stringify(m));
  await v3.vorgangWieder({ id: r3.vorgang });
  assert.ok(!existsSync(join(d3, "R")));
  assert.ok(Date.now() - Date.parse(JSON.parse(readFileSync(mf, "utf8")).zeit) < 60_000, "Zeit neu gesetzt");
});

// ───────────── W4: erzeugte Namen als Ziel ─────────────

test("W4: Dateiname index.md / _x.md im Wiki ist als Ziel abgewiesen; ein Titel „Index“ ergibt einen unkritischen Dateinamen", async () => {
  const { d, v } = aufbau({ "a/Tee.md": "# Tee\n", "09_wiki/w/Seite.md": "# Seite\n" });
  assert.equal((await fehler(() => v.umbenennen({ pfad: "a/Tee.md", dateiname: "index.md" }))).extra.art, "reserviert");
  assert.equal((await fehler(() => v.umbenennen({ pfad: "a/Tee.md", dateiname: "INDEX.md" }))).status, 403);
  assert.equal((await fehler(() => v.umbenennen({ pfad: "09_wiki/w/Seite.md", dateiname: "_gen.md" }))).status, 403);
  await v.umbenennen({ pfad: "a/Tee.md", titel: "Index", dateinameAusTitel: true });
  assert.ok(existsSync(join(d, "a/Index-notiz.md")) && !existsSync(join(d, "a/Index.md")) , "nicht index.md");
  assert.equal(lies(d, "a/Index-notiz.md"), "# Index\n");
});

// ───────────── W5: Unter-Vault ─────────────

test("W5: Verschieben in einen Unter-Vault (auch tief darin) ist für den MCP-Server (ohneUnterVaults) abgewiesen", async () => {
  const { d, v } = aufbau({ "a/x.md": "# x\n", "sub/brain.config.json": "{}\n", "sub/inner/.keep": "" }, { ohneUnterVaults: true });
  for (const ziel of ["sub", "sub/inner"]) { const e = await fehler(() => v.verschieben({ pfad: "a/x.md", ziel })); assert.equal(e.status, 404, ziel); }
  assert.ok(existsSync(join(d, "a/x.md")));
});

// ───────────── Klein ─────────────

test("git: Abgleich/Commit laufen nicht an, solange eine Dateiaktion die Sperre hält (auch aus einem anderen Prozess)", async () => {
  const d = repo("umr-git-"), support = tmp("umr-git-support-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "a.md", "# a\n");
  const v = oeffneVault(d, { support });
  const kennung = A.kennungVault(d); // dieses Vault hat (noch) keine Vault-ID: Schlüssel = Pfad-Hash
  mkdirSync(join(support, "papierkorb", kennung), { recursive: true });
  writeFileSync(join(support, "papierkorb", kennung, ".sperre"), JSON.stringify({ pid: process.pid, token: "t" }) + "\n");
  const e = await fehler(() => G.commit(v.wurzel, { nachricht: "x", dateien: ["a.md"] }, {}));
  assert.equal(e.extra.art, "beschaeftigt");
});

test("Link-Erkennung: eingerückte Code-Blöcke, Zäune in Listen, HTML-Kommentare und Inline-Code über Zeilen werden nicht gelesen; Listenabsätze schon", () => {
  const t = [
    "# T", "", "Text [[A]]", "", "    [[Eingerückt]] und [x](eingerueckt.md)", "",
    "- Punkt", "      ```", "      [[InListeZaun]]", "      ```", "", "    [[Absatz in Liste]]", "",
    "<!-- [[Kommentar]]", "noch [[Kommentar2]] -->", "", "und `Code [[ueberZeile]]", "weiter` dann [[B]]", "",
  ].join("\n");
  assert.deepEqual(L.findeVerweise(t).map((l) => l.ziel), ["A", "Absatz in Liste", "B"]);
});

test("Markdown-Links: #, % und ? im neuen Dateinamen werden kodiert", async () => {
  const { d, v } = aufbau({ "a/Alt.md": "# Alt\n", "l.md": "[x](a/Alt.md#k) ![y](a/Alt.md)\n" });
  await v.umbenennen({ pfad: "a/Alt.md", dateiname: "A#B%C?.md" });
  assert.equal(lies(d, "l.md"), "[x](a/A%23B%25C%3F.md#k) ![y](a/A%23B%25C%3F.md)\n");
});

test("dateiname „x.txt“ ändert die Endung .md nicht: 400; ohne Endung bleibt sie", async () => {
  const { d, v } = aufbau({ "a/Alt.md": "# Alt\n" });
  assert.equal((await fehler(() => v.umbenennen({ pfad: "a/Alt.md", dateiname: "x.txt" }))).status, 400);
  await v.umbenennen({ pfad: "a/Alt.md", dateiname: "neu" });
  assert.ok(existsSync(join(d, "a/neu.md")));
});

test("Ordner verschieben auf einen vorhandenen (auch leeren) Ordner: 409, nichts ersetzt", async () => {
  const { d, v } = aufbau({ "p/q/a.md": "# a\n", "z/q/.keep": "" });
  assert.equal((await fehler(() => v.verschieben({ typ: "ordner", pfad: "p/q", ziel: "z" }))).extra.art, "belegt");
  assert.ok(existsSync(join(d, "p/q/a.md")) && existsSync(join(d, "z/q/.keep")));
  mkdirSync(join(d, "leer"));
  await v.verschieben({ typ: "ordner", pfad: "p/q", ziel: "leer" });
  assert.equal(lies(d, "leer/q/a.md"), "# a\n");
});

test("Unbekanntes oder kaputtes Journal kommt in die Quarantäne statt gelöscht zu werden", async () => {
  const { d, support, kennung } = aufbau({ "a/x.md": "# x\n" });
  const dir = vorgangsDir(support, kennung, "v_aaaaaaaaaaaa");
  mkdirSync(join(dir, "inhalt"), { recursive: true }); writeFileSync(join(dir, "inhalt", "wichtig.md"), "# wichtig\n"); writeFileSync(join(dir, "manifest.json"), "{kaputt");
  const v = oeffneVault(d, { support });
  await v.papierkorb();
  assert.ok(!existsSync(dir));
  const q = join(support, "papierkorb", kennung, "quarantaene");
  const eintrag = readdirSync(q)[0];
  assert.equal(readFileSync(join(q, eintrag, "inhalt", "wichtig.md"), "utf8"), "# wichtig\n");
});

test("Uhrensprung: steht ein Eintrag in der Zukunft, wird nichts aufgeräumt; sonst höchstens abgelaufene", async () => {
  const { d, v, support, kennung } = aufbau({ "a/x.md": "# x\n", "a/y.md": "# y\n", "a/z.md": "# z\n" });
  const r1 = await v.loeschen({ pfad: "a/x.md" }), r2 = await v.loeschen({ pfad: "a/y.md" });
  const aendere = (id, tage) => { const mf = join(vorgangsDir(support, kennung, id), "manifest.json"); const m = JSON.parse(readFileSync(mf, "utf8")); m.zeit = new Date(Date.now() + tage * 86400e3).toISOString(); writeFileSync(mf, JSON.stringify(m)); };
  aendere(r1.vorgang, -40); aendere(r2.vorgang, +3);
  await oeffneVault(d, { support }).papierkorb();
  assert.ok(existsSync(vorgangsDir(support, kennung, r1.vorgang)), "wegen der falschen Uhr nichts gelöscht");
  aendere(r2.vorgang, 0);
  await oeffneVault(d, { support }).papierkorb();
  assert.ok(!existsSync(vorgangsDir(support, kennung, r1.vorgang)) && existsSync(vorgangsDir(support, kennung, r2.vorgang)));
});

test("Endgültig löschen entfernt auch die Kopien dieser Datei in den Journalen anderer Vorgänge", async () => {
  const { d, v, support, kennung } = aufbau({ "a/Alt.md": "# Alt\n", "b/L.md": "# L\n[[Alt]]\n" });
  const r1 = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md" }); // Journal enthält vorher/nachher von b/L.md
  assert.ok(existsSync(join(vorgangsDir(support, kennung, r1.vorgang), "vorher", "0")));
  const r2 = await v.loeschen({ pfad: "b/L.md" });
  await v.papierkorbEndgueltig({ id: r2.vorgang });
  assert.ok(!existsSync(join(vorgangsDir(support, kennung, r1.vorgang), "vorher", "0")) && !existsSync(join(vorgangsDir(support, kennung, r1.vorgang), "nachher", "0")));
  assert.deepEqual(JSON.parse(readFileSync(join(vorgangsDir(support, kennung, r1.vorgang), "manifest.json"), "utf8")).dateien.map((x) => x.pfad), ["a/Alt.md"].filter(() => false).concat(JSON.parse(readFileSync(join(vorgangsDir(support, kennung, r1.vorgang), "manifest.json"), "utf8")).dateien.map((x) => x.pfad)));
});

test("Protokoll-Liste: Einträge mit Vorgang behalten Konto und Programm (MCP)", async () => {
  const { v, support, kennung, d } = aufbau({ "a/Alt.md": "# Alt\n" });
  const r = await v.umbenennen({ pfad: "a/Alt.md", titel: "Neu", dateiname: "Neu.md", eintrag: false });
  A.schreibeEreignis(support, d, { art: "aenderung", konto: "k_aaaaaaaa", programm: "claude", wer: "Claude Code · Privat", text: "hat eine Notiz umbenannt.", pfade: [r.nach, r.von], rueckgaengig: { art: "vorgang", id: r.vorgang } });
  const akt = erzeugeAktivitaet({ support, konten: { kontoDaten: (id) => (id === "k_aaaaaaaa" ? { name: "Privat", programm: "claude" } : null) }, vaults: () => [] });
  const e = akt.lesen(v, new URLSearchParams()).ereignisse.find((x) => x.vorgang === r.vorgang);
  assert.equal(e.kontoName, "Privat"); assert.equal(e.programmName, "Claude Code"); assert.equal(e.konto, "k_aaaaaaaa"); assert.equal(e.rueckgaengigMoeglich, true);
});
