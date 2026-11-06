// „Kortex im Browser“ (Paket W1): Zugangsschutz (Token/Cookie/Host/Origin/CSRF), Einlass-Karten, eine Instanz je Support-Ordner, Start/Beenden, Portwahl, Browser-Öffnen je System,
// Ordnerhilfen, Hüllen-Vertrag im Browser. Der Startbefehl läuft echt als Kindprozess mit Wegwerf-HOME und -Support-Ordner; kein Browser wird geöffnet (--nicht-oeffnen).
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
test("Einlass-Karte: einmal einlösbar, läuft nach 2 Minuten ab, falsche wird abgelehnt", () => {
  let jetzt = 1_000_000;
  const z = erzeugeZugang({ port: () => 5555, jetzt: () => jetzt });
  const k = z.neueKarte();
  assert.ok(k.length >= 30);
  const s = z.loeseEin(k);
  assert.ok(s && s !== k);
  assert.equal(z.loeseEin(k), null, "zweites Einlösen scheitert");
  assert.equal(z.loeseEin("geraten"), null);
  assert.equal(z.loeseEin(undefined), null);
  const k2 = z.neueKarte();
  jetzt += KARTE_MS + 1;
  assert.equal(z.loeseEin(k2), null, "abgelaufen");
});

test("Sitzung: nur der Cookie dieses Ports gilt; Cookie ist HttpOnly und SameSite=Strict", () => {
  const z = erzeugeZugang({ port: () => 5555 });
  const sitzung = z.loeseEin(z.neueKarte());
  const zeile = z.setzeCookie(sitzung);
  assert.match(zeile, /^kortex_s_5555=[\w-]+; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.ok(z.hatSitzung(`andere=1; kortex_s_5555=${sitzung}`));
  assert.ok(!z.hatSitzung(`kortex_s_5556=${sitzung}`), "Cookie eines anderen Ports zählt nicht");
  assert.ok(!z.hatSitzung(`kortex_s_5555=${sitzung}x`));
  assert.ok(!z.hatSitzung(undefined));
  const anderer = erzeugeZugang({ port: () => 5555 });
  assert.ok(!anderer.hatSitzung(`kortex_s_5555=${sitzung}`), "Sitzung eines anderen Starts zählt nicht");
});

test("Geheimnis: nur das richtige schaltet Karten frei", () => {
  const z = erzeugeZugang({ port: () => 1 });
  assert.ok(z.geheimnisStimmt(z.geheimnis()));
  assert.ok(!z.geheimnisStimmt("falsch") && !z.geheimnisStimmt("") && !z.geheimnisStimmt(null));
  assert.equal(z.bearer(`Bearer ${z.geheimnis()}`), z.geheimnis());
  assert.equal(z.bearer("Basic abc"), null);
});

test("Anfrageprüfung: Host, Methode, Sec-Fetch-Site, Origin, schreibend nur mit Origin", () => {
  const ok = { host: "127.0.0.1:5000" };
  const p = (methode, kopf) => pruefeAnfrage({ methode, kopf: { ...ok, ...kopf }, port: 5000 });
  assert.equal(p("GET", {}), null);
  assert.equal(p("GET", { host: "localhost:5000" }), null);
  assert.equal(p("GET", { host: "127.0.0.1:5001" })?.status, 403, "falscher Port");
  assert.equal(p("GET", { host: "boese.example:5000" })?.status, 403, "DNS-Rebinding");
  assert.equal(p("GET", { host: "127.0.0.1" })?.status, 403);
  assert.equal(p("GET", { host: undefined })?.status, 403);
  assert.equal(p("OPTIONS", {})?.status, 405, "kein CORS-Preflight");
  assert.equal(p("TRACE", {})?.status, 405);
  assert.equal(p("GET", { "sec-fetch-site": "cross-site" })?.status, 403);
  assert.equal(p("GET", { "sec-fetch-site": "same-site" })?.status, 403, "anderer lokaler Port");
  assert.equal(p("GET", { "sec-fetch-site": "same-origin" }), null);
  assert.equal(p("GET", { "sec-fetch-site": "none" }), null);
  assert.equal(p("GET", { origin: "http://127.0.0.1:5000" }), null);
  assert.equal(p("GET", { origin: "http://evil.example" })?.status, 403);
  assert.equal(p("GET", { origin: "null" })?.status, 403);
  assert.equal(p("POST", {})?.status, 403, "schreibend ohne Origin");
  assert.equal(p("POST", { origin: "http://127.0.0.1:5000" }), null);
  assert.equal(p("PUT", { origin: "http://127.0.0.1:4999" })?.status, 403);
  assert.equal(p("DELETE", { origin: "https://127.0.0.1:5000" })?.status, 403, "https ist nicht unsere Herkunft");
});

// ───────────────────────── Dienst (echter Startbefehl) ─────────────────────────
test("Start: Adresse nur auf 127.0.0.1, freier Port, Sperrdatei mit Port; kein Token in der Ausgabe", async () => {
  const d = await dienst({});
  assert.equal(d.art, "Bereit");
  assert.match(d.adresse, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.ok(d.port > 0 && d.port !== 4517);
  const s = sperre(d.support);
  assert.equal(s.port, d.port);
  assert.equal(s.pid, d.kind.pid);
  assert.ok(s.geheimnis.length >= 40);
  if (POSIX) assert.equal(statSync(join(d.support, "browser-dienst.json")).mode & 0o077, 0, "Sperrdatei nur für den Benutzer lesbar");
  const k = await karte(d);
  assert.ok(k);
  assert.ok(!d.ausgabe().includes(s.geheimnis) && !d.ausgabe().includes(k), "weder Geheimnis noch Karte in der Ausgabe");
  assert.equal((await rufe({ port: d.port, pfad: "/", kopf: { Host: "x" } })).status, 403, "fremder Host");
});

test("ohne Zugang kommt nichts durch: Studio, API und Statik antworten 401, nur mit gültigem Cookie 200", async () => {
  const d = await dienst({});
  const kopf = { Host: `127.0.0.1:${d.port}` };
  for (const pfad of ["/", "/index.html", "/api/info", "/app.js", "/api/baum", "/_kortex/git/pruefen"]) {
    const r = await rufe({ port: d.port, pfad, kopf });
    assert.equal(r.status, 401, pfad);
    assert.ok(!/<script src="app\.js"|"vault"/.test(r.text), `${pfad} zeigt nichts vom Studio`);
  }
  const falsch = await rufe({ port: d.port, pfad: "/api/info", kopf: { ...kopf, Cookie: `kortex_s_${d.port}=erfunden` } });
  assert.equal(falsch.status, 401);
  const { cookie } = await meldeAn(d);
  assert.match(cookie, new RegExp(`^kortex_s_${d.port}=`));
  const ok = await rufe({ port: d.port, pfad: "/api/info", kopf: { ...kopf, Cookie: cookie } });
  assert.equal(ok.status, 200);
  const index = await rufe({ port: d.port, pfad: "/", kopf: { ...kopf, Cookie: cookie } });
  assert.equal(index.status, 200);
  assert.match(index.text, /<script src="huelle-browser\.js"><\/script>\s*<script src="fehlerhaken\.js">/, "die Browser-Hülle steht vor allen anderen Skripten");
  assert.match(index.text, /huelle-browser\.css/);
  const huelle = await rufe({ port: d.port, pfad: "/huelle-browser.js", kopf: { ...kopf, Cookie: cookie } });
  assert.equal(huelle.status, 200);
});

test("Einlass: /?t=<Karte> setzt den Cookie (HttpOnly, SameSite=Strict), leitet auf / um, die Karte gilt nur einmal", async () => {
  const d = await dienst({});
  const kopf = { Host: `127.0.0.1:${d.port}` };
  const k = await karte(d);
  const r = await rufe({ port: d.port, pfad: `/?t=${k}`, kopf });
  assert.equal(r.status, 303);
  assert.equal(r.kopf.location, "/", "die Karte steht danach nicht mehr in der Adresse");
  const c = String(r.kopf["set-cookie"]);
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//);
  assert.ok(!c.includes(k), "der Cookie ist nicht die Karte");
  const nochmal = await rufe({ port: d.port, pfad: `/?t=${k}`, kopf });
  assert.equal(nochmal.status, 403);
  assert.equal(nochmal.kopf["set-cookie"], undefined);
  assert.equal((await rufe({ port: d.port, pfad: "/?t=erfunden", kopf })).status, 403);
  assert.equal((await rufe({ port: d.port, pfad: "/?t=", kopf })).status, 403);
  // die Karte lässt sich nur mit dem Geheimnis holen
  const ohne = await rufe({ port: d.port, pfad: "/_kortex/einlass", methode: "POST", kopf, body: "" });
  assert.equal(ohne.status, 401);
  const falsch = await rufe({ port: d.port, pfad: "/_kortex/einlass", methode: "POST", kopf: { ...kopf, Authorization: "Bearer falsch" }, body: "" });
  assert.equal(falsch.status, 401);
  const get = await rufe({ port: d.port, pfad: "/_kortex/einlass", kopf: { ...kopf, Authorization: `Bearer ${sperre(d.support).geheimnis}` } });
  assert.equal(get.status, 405);
});

test("Host-, Origin- und CSRF-Schutz am echten Dienst; kein CORS", async () => {
  const d = await dienst({});
  const { cookie } = await meldeAn(d);
  const basis = { Host: `127.0.0.1:${d.port}`, Cookie: cookie };
  const mit = (extra) => ({ ...basis, ...extra });
  // DNS-Rebinding: fremder Host trotz gültigem Cookie
  assert.equal((await rufe({ port: d.port, pfad: "/api/info", kopf: mit({ Host: `rebind.example:${d.port}` }) })).status, 403);
  assert.equal((await rufe({ port: d.port, pfad: "/api/info", kopf: mit({ Host: "127.0.0.1" }) })).status, 403);
  // fremde Herkunft
  assert.equal((await rufe({ port: d.port, pfad: "/api/info", kopf: mit({ Origin: "http://evil.example" }) })).status, 403);
  assert.equal((await rufe({ port: d.port, pfad: "/api/info", kopf: mit({ "Sec-Fetch-Site": "cross-site" }) })).status, 403);
  // schreibend: ohne Origin 403, mit eigenem Origin und JSON erlaubt, falscher Inhaltstyp 415
  const post = (extra, body = "{}") => rufe({ port: d.port, pfad: "/api/vertrauen", methode: "POST", kopf: mit({ "Content-Type": "application/json", ...extra }), body });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ Origin: "http://evil.example" })).status, 403);
  const gut = await post({ Origin: `http://127.0.0.1:${d.port}` });
  assert.notEqual(gut.status, 403); assert.notEqual(gut.status, 401); assert.notEqual(gut.status, 415);
  assert.equal((await post({ Origin: `http://127.0.0.1:${d.port}`, "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post({ Origin: `http://127.0.0.1:${d.port}`, "Content-Type": "application/x-www-form-urlencoded" }, "a=b")).status, 415);
  // kein CORS: Preflight abgelehnt, nirgends ein Access-Control-Header
  const pre = await rufe({ port: d.port, pfad: "/api/info", methode: "OPTIONS", kopf: mit({ Origin: `http://127.0.0.1:${d.port}`, "Access-Control-Request-Method": "POST" }) });
  assert.equal(pre.status, 405);
  for (const r of [pre, await rufe({ port: d.port, pfad: "/api/info", kopf: basis }), await rufe({ port: d.port, pfad: "/", kopf: { Host: basis.Host } })]) {
    assert.ok(!Object.keys(r.kopf).some((k) => k.startsWith("access-control-")), "kein CORS-Header");
  }
  const info = await rufe({ port: d.port, pfad: "/api/info", kopf: basis });
  assert.equal(info.kopf["cross-origin-resource-policy"], "same-origin");
  assert.equal(info.kopf["x-content-type-options"], "nosniff");
});

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
test("Sperre: beanspruchen, fremde lebende Sperre erkennen, freigeben, PID-Wiederverwendung (andere Startzeit) zählt als verwaist", () => {
  const support = tmp("kortex-sperre-");
  assert.deepEqual(beanspruche(support, { pid: process.pid }), { ok: true });
  assert.equal(leseSperre(support).pid, process.pid);
  assert.ok(lebt(leseSperre(support)));
  const fremd = tmp("kortex-sperre-fremd-");
  writeFileSync(sperrDatei(fremd), JSON.stringify({ pid: process.pid, start: "Zeit A", port: 1, geheimnis: "g" }));
  assert.ok(!lebt(leseSperre(fremd), { startVon: () => "Zeit B" }), "gleiche PID, andere Startzeit");
  assert.ok(lebt(leseSperre(fremd), { startVon: () => "Zeit A" }));
  // eine fremde, lebende Sperre (hier: der Elternprozess dieses Tests) wird nicht übernommen
  const dritter = tmp("kortex-sperre-dritter-");
  writeFileSync(sperrDatei(dritter), JSON.stringify({ pid: process.ppid, start: "", port: 7, geheimnis: "g" }));
  const b = beanspruche(dritter, { pid: process.pid, startVon: () => "" });
  assert.equal(b.ok, false); assert.equal(b.andere.port, 7);
  gibFrei(support);
  assert.ok(!existsSync(sperrDatei(support)));
  gibFrei(dritter, process.pid); assert.ok(existsSync(sperrDatei(dritter)), "fremde Sperre wird nie freigegeben");
});

test("Ordner: ~ und absolute Pfade, relative abgelehnt, breite Orte, Zählung, Liste ohne versteckte, zuletzt benutzt", () => {
  const home = tmp("kortex-home-");
  assert.equal(erweitere("~", home), home);
  assert.equal(erweitere("~/x", home), join(home, "x"));
  assert.equal(erweitere("relativ", home), null);
  assert.equal(erweitere("", home), null);
  assert.equal(erweitere("a\0b", home), null);
  const vault = join(home, "Notizen"); mkdirSync(join(vault, "sub", ".git"), { recursive: true }); mkdirSync(join(vault, ".versteckt"));
  writeFileSync(join(vault, "x.md"), "x"); writeFileSync(join(vault, "sub", "y.txt"), "y"); writeFileSync(join(vault, "bild.png"), "p");
  const p = pruefeOrdner(vault, { home });
  assert.equal(p.ok, true); assert.equal(p.notizen, 2); assert.equal(p.ordner, 1); assert.equal(p.breit, undefined);
  assert.equal(pruefeOrdner(join(vault, "x.md"), { home }).grund, "kein-ordner");
  assert.equal(pruefeOrdner(join(vault, "nix"), { home }).grund, "nicht-gefunden");
  assert.ok(pruefeOrdner(home, { home }).breit, "der Benutzerordner ist als Vault zu breit");
  assert.ok(breiterOrt(join(home, "Documents"), home));
  mkdirSync(join(home, "Documents"));
  assert.equal(breiterOrt(vault, home), null);
  assert.deepEqual(listeOrdner(vault, { home }).ordner.map((o) => o.name), ["sub"], "versteckte und Dateien fehlen");
  assert.equal(listeOrdner(vault, { home }).eltern, home);
  assert.equal(listeOrdner("nix", { home }).ok, false);
  const support = tmp("kortex-zuletzt-");
  merkeZuletzt(support, vault); merkeZuletzt(support, home); merkeZuletzt(support, vault);
  assert.deepEqual(leseZuletzt(support), [vault, home]);
  assert.deepEqual(leseEinrichtung(support), { letzterSchritt: null, ende: null });
  schreibeEinrichtung(support, { schritt: "ki" }); schreibeEinrichtung(support, { schritt: "vault" });
  assert.equal(leseEinrichtung(support).letzterSchritt, "ki", "nie rückwärts");
  schreibeEinrichtung(support, { ende: "fertig" }); schreibeEinrichtung(support, { ende: "boese" });
  assert.equal(leseEinrichtung(support).ende, "fertig");
  assert.deepEqual(pruefeGit({ lauf: () => ({ error: { code: "ENOENT" } }) }), { stand: "fehlt" });
  assert.deepEqual(pruefeGit({ lauf: () => ({ status: 0, stdout: "git version 2.45.1\n" }) }), { stand: "vorhanden", version: "2.45.1" });
  assert.equal(pruefeGit({ lauf: () => ({ status: 1, stderr: "kaputt" }) }).stand, "defekt");
});

test("Browser öffnen: Befehl je System, nur eigene Adressen, KORTEX_BROWSER, Rückfall bei fehlendem Programm", async () => {
  const url = "http://127.0.0.1:4711/?t=abc_DEF-123";
  assert.deepEqual(browserBefehle(url, { plattform: "darwin", env: {} }), [["open", [url]]]);
  assert.deepEqual(browserBefehle(url, { plattform: "win32", env: {} }), [["rundll32", ["url.dll,FileProtocolHandler", url]]]);
  assert.deepEqual(browserBefehle(url, { plattform: "linux", env: {} }), [["xdg-open", [url]], ["gio", ["open", url]]]);
  assert.equal(browserBefehle(url, { plattform: "linux", env: { KORTEX_BROWSER: "/usr/bin/meiner" } })[0][0], "/usr/bin/meiner");
  for (const boese of ["https://evil.example/", "http://evil.example:80/", "file:///etc/passwd", "javascript:alert(1)", "http://127.0.0.1:80/; rm -rf", "http://127.0.0.1:99/\nx", "http://127.0.0.1.evil.example:5/"]) {
    assert.deepEqual(browserBefehle(boese, { plattform: "linux", env: {} }), [], boese);
    assert.equal(eigeneAdresse(boese), false);
  }
  // Startdatei statt Adresse mit Karte: nur absolute Pfade der Form kortex-start-<kennung>.html
  const datei = POSIX ? "/tmp/support/kortex-start-AbC_1-2.html" : "C:\\support\\kortex-start-AbC_1-2.html";
  assert.deepEqual(browserBefehle(datei, { plattform: "linux", env: {} })[0], ["xdg-open", [datei]]);
  for (const boese of ["/tmp/x/passwd", "kortex-start-a.html", "/tmp/kortex-start-a.html.sh", "/tmp/kortex-start-a b.html"]) assert.deepEqual(browserBefehle(boese, { plattform: "linux", env: {} }), [], boese);
  assert.equal(browserBefehle(url, { plattform: "win32", env: { KORTEX_BROWSER: "C:\\x\\b.cmd" } })[0][0], "rundll32", ".cmd wird nicht als Browser benutzt");
  const aufrufe = [];
  const falsch = (n) => ({ on(ev, f) { if (ev === "error" && n === "weg") queueMicrotask(() => f(Object.assign(new Error("x"), { code: "ENOENT" }))); if (ev === "exit" && n === "ok") queueMicrotask(() => f(0)); }, unref() {} });
  const starteAttrappe = (prog, args, opt) => { aufrufe.push([prog, args, opt.detached, opt.stdio]); return falsch(prog === "xdg-open" ? "weg" : "ok"); };
  const r = await oeffneImBrowser(url, { plattform: "linux", env: {}, starte: starteAttrappe });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(aufrufe.map((a) => a[0]), ["xdg-open", "gio"], "Rückfall auf gio");
  assert.equal(aufrufe[0][2], true); assert.equal(aufrufe[0][3], "ignore");
  const nichts = await oeffneImBrowser(url, { plattform: "linux", env: {}, starte: () => falsch("weg") });
  assert.equal(nichts.ok, false); assert.match(nichts.text, /nicht gefunden/);
  assert.equal((await oeffneImBrowser("https://evil.example/", { starte: () => assert.fail("darf nie starten") })).ok, false);
});

// ───────────────────────── Hüllen-Vertrag im Browser ─────────────────────────
test("die Browser-Hülle behandelt jede Aktion des Hüllen-Vertrags, und nur diese; die „nur bei offener Einrichtung“-Liste stimmt", () => {
  const vertrag = JSON.parse(readFileSync(join(WURZEL, "studio", "huellen-vertrag.json"), "utf8"));
  const text = readFileSync(join(WURZEL, "studio", "huelle-browser.js"), "utf8");
  const tabelle = /var AKTIONEN = \{([\s\S]*?)\n  \};/.exec(text)[1];
  const inHuelle = [...tabelle.matchAll(/^ {4}"([a-z-]+)":/gm)].map((m) => m[1]).sort();
  assert.deepEqual(inHuelle, vertrag.aktionen.map((a) => a.name).sort());
  const liste = /var NUR_EINRICHTUNG = \[([^\]]*)\]/.exec(text)[1];
  assert.deepEqual([...liste.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort(), vertrag.aktionen.filter((a) => a.nurBeiOffenerEinrichtung).map((a) => a.name).sort());
  const domaenen = /var ANMELDE_DOMAENEN = \[([^\]]*)\]/.exec(text)[1];
  for (const d of ["claude.ai", "claude.com", "anthropic.com", "openai.com", "chatgpt.com"]) assert.ok(domaenen.includes(`"${d}"`), d);
});

test("die Browser-Hülle liegt nicht in der App-Seite: index.html lädt sie nie selbst", () => {
  assert.ok(!readFileSync(join(WURZEL, "studio", "index.html"), "utf8").includes("huelle-browser"), "nur der Browser-Dienst fügt sie ein");
});

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
