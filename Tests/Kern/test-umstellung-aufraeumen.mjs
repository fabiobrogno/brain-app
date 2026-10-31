// test-umstellung-aufraeumen.mjs — Paket P7d: verwaiste git-Einbindungen (Befund E29, Aufräumen mit Rückweg) und die Angebote nach 30 Tagen (Archiv, Sicherungskopien, Bundles).
// Nichts wird von selbst gelöscht: Aufräumen nur auf Klick (bestaetigt), „Papierkorb“ ist hier ein Ordner im Temp-HOME (z.papierkorb). Zum Schluss: die CLI `umstellung phase-b|aufraeumen`
// als Kindprozess mit ausdrücklich gebauter Umgebung (baueTestUmgebung).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { umstellungsFixture } from "./umstellung-hilfe.mjs";
import { baueTestUmgebung } from "./konto-hilfe.mjs";
import { phaseAFertig, tuerOffen, BEST, gitIn } from "./umstellung-hilfe-b.mjs";
import { phaseB } from "../umstellung/phase-b.mjs";
import { rueckweg, planRueckweg } from "../umstellung/rueckweg.mjs";
import { erstelleBefund } from "../umstellung/befund.mjs";
import { angebote, raeume } from "../umstellung/aufraeumen.mjs";
import { leseBloecke, findeVerwaiste } from "../umstellung/verwaist.mjs";
import { einbindungsBlock, setzeBlock, markeAnfang } from "../umstellung/git-umzug.mjs";
import { liesZustand, schreibeZustand, ablageOrdner, liesProtokoll } from "../umstellung/protokoll.mjs";
import { KERN } from "../pfade.mjs";

const TAG = 86_400_000;
const trash = (h) => join(h.a.basis, "papierkorb");
const mitKorb = (h) => { const z = h.z(); z.papierkorb = (p) => { mkdirSync(trash(h), { recursive: true }); let ziel = join(trash(h), p.split("/").pop()), i = 1; while (existsSync(ziel)) ziel = `${ziel}-${++i}`; renameSync(p, ziel); return "verschoben"; }; return z; };

test("Verwaiste Einbindung: Befund E29 zählt nur Blöcke von Kortex, Aufräumen nur auf Klick, Rückweg stellt die globale Konfiguration Byte für Byte her", async () => {
  const h = umstellungsFixture(["kit-versioniert", "credential-helper"], { globalText: "[user]\n\tname = Test\n\temail = test@example.org\n[includeIf \"gitdir:/irgendwo/fremd/\"]\n\tpath = /irgendwo/fremd.cfg\n" });
  try {
    await phaseAFertig(h);
    const z = h.z();
    // A2 hat den echten Block für diesen Vault gesetzt (Vault existiert → nicht verwaist)
    assert.equal(leseBloecke(h.gitGlobal).length, 1);
    assert.equal(findeVerwaiste(h.gitGlobal).length, 0);
    assert.ok(!erstelleBefund(h.a.opt).funde.some((f) => f.id === "E29"), "kein Fund ohne verwaiste Einbindung");
    // ein Vault, der verschoben wurde: Block mit Pfad, den es nicht mehr gibt
    const k = "aaaaaaaaaaaaaaaa", alteDatei = join(h.a.support, "git", `${k}.gitconfig`);
    writeFileSync(alteDatei, "[credential]\n\thelper = osxkeychain\n", { mode: 0o600 });
    setzeBlock(h.gitGlobal, k, einbindungsBlock({ vaultEcht: "/Users/jemand/verschoben/Vault ä", datei: alteDatei, k, caseInsensitiv: false }));
    const globalVor = readFileSync(h.gitGlobal, "utf8");
    assert.equal(leseBloecke(h.gitGlobal).length, 2);
    const waisen = findeVerwaiste(h.gitGlobal);
    assert.deepEqual(waisen.map((w) => w.k), [k]);
    const fund = erstelleBefund(h.a.opt).funde.find((f) => f.id === "E29");
    assert.equal(fund.anzahl, 1);
    assert.equal(fund.schwere, "frage");
    assert.ok(!JSON.stringify(fund).includes("/Users/jemand") && !JSON.stringify(fund).includes(alteDatei), "keine Pfade im Fund");
    // Angebot ist sichtbar, aber ohne Klick geschieht nichts
    assert.ok(angebote(z).some((a) => a.id === "verwaist" && a.faellig));
    assert.equal(raeume(z, { was: "verwaist" }).plan, true);
    assert.equal(readFileSync(h.gitGlobal, "utf8"), globalVor);
    // aufräumen
    const r = raeume(z, { was: "verwaist", bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.geaendert, true);
    const nach = readFileSync(h.gitGlobal, "utf8");
    assert.ok(!nach.includes(markeAnfang(k)), "verwaister Block entfernt");
    assert.ok(nach.includes("gitdir:/irgendwo/fremd/"), "fremde includeIf-Einträge des Nutzers bleiben");
    assert.equal(leseBloecke(h.gitGlobal).length, 1, "der echte Block bleibt");
    assert.ok(!existsSync(alteDatei), "die Datei je Vault liegt in der Sicherung");
    assert.equal(spawnSync("/usr/bin/git", ["-C", h.a.vault, "config", "--get-all", "credential.helper"], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).status, 0, "der echte Vault behält seine Anmeldehilfe");
    assert.equal(erstelleBefund(h.a.opt).funde.some((f) => f.id === "E29"), false);
    assert.equal(raeume(z, { was: "verwaist", bestaetigt: true }).geaendert, false, "zweiter Lauf tut nichts");
    assert.ok(!JSON.stringify(liesProtokoll(z)).includes("osxkeychain"), "keine Werte im Protokoll");
    // Rückweg
    assert.ok(planRueckweg(z).find((s) => s.id === "V1").hatRueckweg);
    const rw = await rueckweg(z, { bestaetigt: true, schritte: ["V1"] });
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.equal(readFileSync(h.gitGlobal, "utf8"), globalVor, "globale Konfiguration Byte für Byte wie vorher");
    assert.equal(readFileSync(alteDatei, "utf8"), "[credential]\n\thelper = osxkeychain\n");
    // „alles zurück“ fasst V1 nie an (die Einbindung ist verwaist, sie soll nicht zurückkommen)
    const alles = await rueckweg(z, { bestaetigt: true, alles: true });
    assert.equal(alles.ok, true);
  } finally { h.weg(); }
});

test("Archiv: erst nach 30 Tagen angeboten, nur auf Klick, Papierkorb statt Löschen; ein falscher Name oder ein zu frühes Angebot wird abgelehnt", async () => {
  const h = umstellungsFixture(["kit-versioniert", "altfelder"]);
  try {
    await phaseAFertig(h);
    const z = mitKorb(h);
    await tuerOffen({ ...h, z: () => z });
    const r = await phaseB(z, { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    const jetzt = Date.now();
    let a = angebote(z, { jetzt }).find((x) => x.id === "archiv");
    assert.equal(a.name, r.archiv);
    assert.equal(a.faellig, false);
    assert.equal(a.tage, 0);
    assert.throws(() => raeume(z, { was: "archiv", name: r.archiv, bestaetigt: true, jetzt }), (e) => e.code === "noch-nicht");
    assert.ok(existsSync(join(ablageOrdner(z), r.archiv)));
    // 29 Tage: noch nicht, 31 Tage: fällig
    assert.equal(angebote(z, { jetzt: jetzt + 29 * TAG }).find((x) => x.id === "archiv").faellig, false);
    const spaeter = jetzt + 31 * TAG;
    a = angebote(z, { jetzt: spaeter }).find((x) => x.id === "archiv");
    assert.equal(a.faellig, true);
    assert.ok(a.tage >= 30);
    // nichts geschieht von selbst: weder angebote() noch raeume() ohne Bestätigung verändern etwas
    assert.equal(raeume(z, { was: "archiv", name: r.archiv, jetzt: spaeter }).plan, true);
    assert.ok(existsSync(join(ablageOrdner(z), r.archiv)));
    assert.throws(() => raeume(z, { was: "archiv", name: "kit-1999-01-01", bestaetigt: true, jetzt: spaeter }), (e) => e.code === "nichts-da");
    assert.throws(() => raeume(z, { was: "alles", bestaetigt: true }), (e) => e.code === "unbekannt");
    // auf Klick: in den Papierkorb, nicht gelöscht
    const ok = raeume(z, { was: "archiv", name: r.archiv, bestaetigt: true, jetzt: spaeter });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.ok(!existsSync(join(ablageOrdner(z), r.archiv)));
    assert.ok(existsSync(join(trash(h), r.archiv, "VERSION")), "der Ordner liegt im Papierkorb, vollständig");
    assert.ok(liesZustand(z).aufgeraeumt.archiv);
  } finally { h.weg(); }
});

test("Sicherungskopien und Bundles: 30 Tage nach Phase B angeboten, nie früher; danach lässt sich die Umstellung nicht mehr zurücknehmen", async () => {
  const h = umstellungsFixture(["kit-versioniert", "hooks-alt-sh", "mcp-claude-alt", "plist-alt-dieser", "altfelder"]);
  try {
    await phaseAFertig(h);
    const z = mitKorb(h);
    await tuerOffen({ ...h, z: () => z });
    assert.equal((await phaseB(z, { bestaetigt: true, entscheidungen: BEST })).ok, true);
    const jetzt = Date.now();
    const frueh = angebote(z, { jetzt });
    for (const id of ["sicherungen", "bundles"]) assert.equal(frueh.find((x) => x.id === id).faellig, false, `${id} noch nicht fällig`);
    assert.throws(() => raeume(z, { was: "sicherungen", bestaetigt: true, jetzt }), (e) => e.code === "noch-nicht");
    // Phase B liegt 31 Tage zurück
    const zu = liesZustand(z); zu.phaseB.zeit = new Date(jetzt - 31 * TAG).toISOString(); schreibeZustand(z, zu);
    const spaet = angebote(z, { jetzt });
    const sp = spaet.find((x) => x.id === "sicherungen"), bu = spaet.find((x) => x.id === "bundles");
    assert.equal(sp.faellig, true); assert.equal(bu.faellig, true);
    assert.match(sp.text, /nicht mehr zurücknehmen/);
    assert.ok(sp.anzahl >= 2, "sicherungen/ und .git/config.vor-kortex");
    // .bak-Dateien von Claude gehören dazu (A4 hat sie angelegt), fremde .bak-Dateien nicht
    const baks = readdirSync(join(h.a.home, ".claude")).filter((n) => /^settings\.json\.bak-/.test(n));
    writeFileSync(join(h.a.home, ".claude", "settings.json.bak-fremd"), "{}");
    assert.ok(baks.length >= 1 && existsSync(join(h.a.home, ".claude", "settings.json.bak-fremd")));
    const n1 = raeume(z, { was: "sicherungen", bestaetigt: true, jetzt });
    assert.equal(n1.ok, true, JSON.stringify(n1));
    assert.ok(existsSync(join(h.a.home, ".claude", "settings.json.bak-fremd")), "fremde Sicherung bleibt");
    assert.ok(baks.every((n) => !existsSync(join(h.a.home, ".claude", n))), "unsere .bak-Dateien liegen im Papierkorb");
    assert.ok(!existsSync(join(h.a.vault, ".git", "config.vor-kortex")) && !existsSync(join(ablageOrdner(z), "sicherungen")));
    assert.ok(readdirSync(trash(h)).length >= 2);
    assert.equal(planRueckweg(z).find((s) => s.id === "A4").hatRueckweg, false, "die Rückweg-Angaben von Phase A sind weg");
    assert.equal(raeume(z, { was: "bundles", bestaetigt: true, jetzt }).ok, true);
    assert.ok(!existsSync(join(ablageOrdner(z), "vor-kortex.bundle")) && !existsSync(join(ablageOrdner(z), "vor-phase-b.bundle")));
  } finally { h.weg(); }
});

test("CLI: phase-b ohne --ja zeigt Tor und Plan (Exit 0, nichts geschrieben); mit --ja bei geschlossenem Tor Exit 4; aufraeumen listet nur", async () => {
  const h = umstellungsFixture(["kit-versioniert", "hooks-alt-sh", "altfelder"]);
  try {
    await phaseAFertig(h);
    const kern = join(h.a.support, "bin", "kern");
    const umg = () => baueTestUmgebung({
      HOME: h.a.home, BRAIN_APP_SUPPORT: h.a.support, KORTEX_KERN_PFAD: kern, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_KERN_TEMP_WURZELN: "", KORTEX_DIENST_PLATTFORM: "darwin", GIT_CONFIG_GLOBAL: h.gitGlobal,
      GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org",
    });
    const cli = (...a) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "umstellung", ...a, "--vault", h.a.vault], { encoding: "utf8", env: umg(), cwd: h.a.home });
    const vorKit = existsSync(join(h.a.vault, ".tools", "VERSION"));
    const p = cli("phase-b", "--json");
    assert.equal(p.status, 0, p.stderr);
    const j = JSON.parse(p.stdout.trim().split("\n").pop());
    assert.equal(j.plan, true);
    assert.equal(j.tor.frei, false);
    assert.deepEqual(j.tor.bedingungen.map((b) => b.id), ["phase-a", "release", "wartezeit", "macs", "bestaetigung", "prozesse", "restverweise", "befund", "probelauf"]);
    const text = cli("phase-b");
    assert.equal(text.status, 0);
    assert.match(text.stdout, /noch nicht freigegeben/);
    const zu = cli("phase-b", "--ja", "--json", "--entscheide", "keineAltenMacs=ja");
    assert.equal(zu.status, 4, zu.stdout + zu.stderr);
    assert.equal(JSON.parse(zu.stdout.trim().split("\n").pop()).fehler, "tor-zu");
    const probe = cli("phase-b", "--probelauf", "--json");
    assert.equal(JSON.parse(probe.stdout.trim().split("\n").pop()).plan, true, "ohne --ja nur der Plan");
    const liste = cli("aufraeumen", "--json");
    assert.equal(liste.status, 0, liste.stderr);
    assert.ok(Array.isArray(JSON.parse(liste.stdout.trim().split("\n").pop()).angebote));
    assert.equal(cli("aufraeumen", "--was", "archiv", "--ja", "--json").status, 4, "kein Archiv da → Vorbedingung");
    assert.equal(cli("zurueck", "--schritt", "B9", "--ja", "--json").status, 64, "unbekannter Schritt");
    assert.equal(existsSync(join(h.a.vault, ".tools", "VERSION")), vorKit);
    assert.equal(gitIn(h.a.vault, "ls-files", "--", ".tools") !== "", true, "nichts wurde angefasst");
    const st = cli("stand", "--json");
    const sj = JSON.parse(st.stdout.trim().split("\n").pop());
    assert.equal(sj.phase, "A");
    assert.equal(sj.phaseB.status, null);
    assert.ok(Array.isArray(sj.angebote));
  } finally { h.weg(); }
});
