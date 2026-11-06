// „Kortex im Browser“ (Paket W1), Teil 2: Instanzen und Prozesse des echten Startbefehls (eine Instanz, Beenden, verwaiste Sperre, Portwahl, Routen, Browser öffnen).
// Eigene Datei, damit jede Datei unter der Frist von 60 s bleibt (unter Windows startet jeder Start PowerShell für die Prozess-Startzeit).
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmp, WURZEL } from "./hilfe.mjs";
import { starte, rufe, karte, meldeAn, neueUmgebung, sperre } from "./browser-hilfe.mjs";
import { erzeugeZugang, pruefeAnfrage, KARTE_MS } from "../../Ressourcen/werkstatt/browser-zugang.mjs";
import { beanspruche, lebt, leseSperre, gibFrei, sperrDatei } from "../../Ressourcen/werkstatt/browser-sperre.mjs";
import { pruefeOrdner, listeOrdner, erweitere, breiterOrt, merkeZuletzt, leseZuletzt, leseEinrichtung, schreibeEinrichtung, pruefeGit } from "../../Ressourcen/werkstatt/browser-ordner.mjs";
import { browserBefehle, oeffneImBrowser, eigeneAdresse } from "../../Ressourcen/gemeinsam/plattform.mjs";

const POSIX = process.platform !== "win32";
const laufend = [];
test.after(async () => { for (const d of laufend) { try { await d.stopp(); } catch { /* weg */ } } });
const dienst = async (o) => { const d = await starte(o); laufend.push(d); return d; };
const freierPort = () => new Promise((ok) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });

// ───────────────────────── Zugang (reine Logik) ─────────────────────────
test("Eine Instanz: der zweite Start zeigt auf die laufende (gleicher Port), startet keinen zweiten Server", async () => {
  const a = await dienst({});
  const b = await dienst({ home: a.home, support: a.support });
  assert.equal(b.art, "Läuft bereits");
  assert.equal(b.port, a.port);
  assert.equal(await b.beendet, 0, "der zweite Start endet von selbst");
  assert.equal(a.kind.exitCode, null, "die erste läuft weiter");
  assert.equal(sperre(a.support).pid, a.kind.pid);
  // der zweite hat eine Karte geholt: die erste Instanz hat jetzt eine mehr, die laufende Sitzung blieb unberührt
  const { cookie } = await meldeAn(a);
  assert.equal((await rufe({ port: a.port, pfad: "/api/info", kopf: { Host: `127.0.0.1:${a.port}`, Cookie: cookie } })).status, 200);
  assert.ok(!b.ausgabe().includes(sperre(a.support).geheimnis));
});

test("Beenden: --beenden stoppt die Instanz, räumt die Sperre auf, danach startet ein neuer Dienst", async () => {
  const a = await dienst({});
  const ende = await starte({ home: a.home, support: a.support, args: ["--beenden"] }).catch((e) => e);
  assert.ok(ende instanceof Error, "--beenden meldet kein Bereit"); // es gibt nur eine Textausgabe
  assert.equal(await a.beendet, 0);
  assert.ok(!existsSync(sperrDatei(a.support)), "Sperrdatei ist weg");
  const neu = await dienst({ home: a.home, support: a.support });
  assert.equal(neu.art, "Bereit");
  assert.ok(existsSync(sperrDatei(a.support)));
});

test("verwaiste Sperre (Prozess weg) wird übernommen", async () => {
  const { home, support } = neueUmgebung();
  writeFileSync(sperrDatei(support), JSON.stringify({ pid: 2 ** 22 - 3, start: "", port: 54321, geheimnis: "alt" }));
  const d = await dienst({ home, support });
  assert.equal(d.art, "Bereit");
  assert.notEqual(sperre(support).port, 54321);
  assert.equal(sperre(support).pid, d.kind.pid);
});

test("Portwahl: Standard ist ein freier Port, --port nimmt einen festen, ein belegter Port meldet sich und gibt die Sperre frei", async () => {
  const fest = await freierPort();
  const a = await dienst({ args: ["--port", String(fest)] });
  assert.equal(a.port, fest);
  const b = await dienst({});
  assert.notEqual(b.port, a.port, "zwei Instanzen mit eigenem Support-Ordner bekommen verschiedene freie Ports");
  const { home, support } = neueUmgebung();
  const ergebnis = await starte({ home, support, args: ["--port", String(fest)] }).catch((e) => e);
  assert.ok(ergebnis instanceof Error);
  assert.match(String(ergebnis.message), /Start fehlgeschlagen/);
  assert.ok(!existsSync(sperrDatei(support)), "nach dem Fehlstart bleibt keine Sperre");
  const ungueltig = await starte({ home, support, args: ["--port", "99999"] }).catch((e) => e);
  assert.match(String(ungueltig.message), /Ungültiger Port/);
});

test("Beenden mit SIGTERM räumt die Sperre auf (nicht unter Windows)", { skip: !POSIX }, async () => {
  const d = await dienst({});
  d.kind.kill("SIGTERM");
  await d.beendet;
  assert.ok(!existsSync(sperrDatei(d.support)));
});

test("eigene Routen: Ordner prüfen/listen, Einrichtungsstand und git nur hinter dem Cookie", async () => {
  const d = await dienst({});
  const basis = { Host: `127.0.0.1:${d.port}` };
  assert.equal((await rufe({ port: d.port, pfad: "/_kortex/ordner/start", kopf: basis })).status, 401);
  const { cookie } = await meldeAn(d);
  const mitC = { ...basis, Cookie: cookie };
  const post = (pfad, daten) => rufe({ port: d.port, pfad, methode: "POST", kopf: { ...mitC, Origin: `http://127.0.0.1:${d.port}`, "Content-Type": "application/json" }, body: JSON.stringify(daten) });
  const ordner = tmp("kortex-browser-ordner-");
  mkdirSync(join(ordner, "unter"), { recursive: true });
  writeFileSync(join(ordner, "a.md"), "# a");
  const p = JSON.parse((await post("/_kortex/ordner/pruefen", { pfad: ordner, merke: true })).text);
  assert.deepEqual({ ok: p.ok, pfad: p.pfad, notizen: p.notizen, ordner: p.ordner }, { ok: true, pfad: ordner, notizen: 1, ordner: 1 });
  const start = JSON.parse((await rufe({ port: d.port, pfad: "/_kortex/ordner/start", kopf: mitC })).text);
  assert.deepEqual(start.zuletzt, [ordner], "der gewählte Ordner steht unter „zuletzt benutzt“");
  const l = JSON.parse((await post("/_kortex/ordner/liste", { pfad: ordner })).text);
  assert.deepEqual(l.ordner.map((o) => o.name), ["unter"]);
  assert.equal(JSON.parse((await post("/_kortex/ordner/pruefen", { pfad: "relativ/pfad" })).text).grund, "kein-absoluter-pfad");
  await post("/_kortex/einrichtung", { schritt: "ki" });
  assert.deepEqual(JSON.parse((await rufe({ port: d.port, pfad: "/_kortex/einrichtung", kopf: mitC })).text), { letzterSchritt: "ki", ende: null });
  const git = JSON.parse((await rufe({ port: d.port, pfad: "/_kortex/git/pruefen", kopf: mitC })).text);
  assert.ok(["vorhanden", "fehlt", "defekt", "nicht-pruefbar"].includes(git.stand));
  const wiki = await rufe({ port: d.port, pfad: "/_kortex/gibtsnicht", kopf: mitC });
  assert.equal(wiki.status, 404);
});

// ───────────────────────── Sperre, Ordner, Browser-Befehle ─────────────────────────
test("Browser öffnen beim Start: die Befehlszeile des Browsers enthält nie die Karte, nur den Pfad der Startdatei (0600), die weiterleitet", { skip: !POSIX }, async () => {
  const { home, support } = neueUmgebung();
  const spur = join(home, "argv.json");
  const opener = join(home, "opener.js");
  writeFileSync(opener, `#!${process.execPath}\nconst fs=require("fs");fs.writeFileSync(${JSON.stringify(spur)}, JSON.stringify({argv:process.argv.slice(2), inhalt: fs.readFileSync(process.argv[2],"utf8"), modus: fs.statSync(process.argv[2]).mode & 0o777}));\n`, { mode: 0o755 });
  const d = await dienst({ home, support, oeffnen: true, extra: { KORTEX_BROWSER: opener } });
  for (let i = 0; i < 100 && !existsSync(spur); i++) await new Promise((ok) => setTimeout(ok, 50));
  const a = JSON.parse(readFileSync(spur, "utf8"));
  assert.equal(a.argv.length, 1);
  assert.match(a.argv[0], /kortex-start-[\w-]+\.html$/);
  assert.ok(!a.argv[0].includes("?t="));
  assert.match(a.inhalt, new RegExp(`url=http://127\\.0\\.0\\.1:${d.port}/\\?t=`));
  assert.equal(a.modus, 0o600);
  assert.ok(!d.ausgabe().includes("?t="));
});
