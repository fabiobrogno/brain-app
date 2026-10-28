// .tools/tests/test-beleg-ernte.mjs — Beleg-Integration für die Ernte (B1, §4.1): Selbstbestätigungs-Sperre (Pfade),
// Herkunft je Rolle laut Spec über beleg.mjs + markiereEigenes, Web-Adresse, Fundstelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { findeZitat } from "../beleg.mjs";
import {
  pfadFormen, nenntPfad, sperrPfade, aufrufGesperrt, markiereEigenes, webAdresse, ohneEingespieltes, ergebnisText,
  baueFundstelle, leseFundstelle, FUNDSTELLE_MUSTER, HERKUNFT_WERTE, MAX_ZITAT, aussageGedeckt, worktreePfade, wikiTexte, zitatImWiki, kernsatz,
} from "../beleg-ernte.mjs";
import { gartenEintraege, GARTEN_VAULT } from "./fixture-garten.mjs";

const HOME = "/heim/jo";

test("Pfade: Leerzeichen, Umlaute, Apostroph, Backslashes, ~, Groß/Klein (macOS), Nachbarordner ist nicht der Vault", () => {
  const formen = pfadFormen("~/Mein Brän, Jo's", { home: HOME });
  assert.deepEqual([...formen].sort(), ["/heim/jo/Mein Brän, Jo's", "~/Mein Brän, Jo's"].sort());
  for (const t of [`cat "/heim/jo/Mein Brän, Jo's/09_wiki/a.md"`, "~/Mein Brän, Jo's/x", "/HEIM/jo/mein brän, jo's/x"]) assert.ok(nenntPfad(t, formen, { plattform: "darwin" }), t);
  for (const t of ["/heim/jo/Mein Brän, Jo's-kit/x", "/heim/jo/Mein Brän, Jo's.bak/x", "/sicherung/heim/jo/Mein Brän, Jo's/x", "/heim/jo/Mein"]) assert.ok(!nenntPfad(t, formen, { plattform: "darwin" }), t);
  assert.ok(!nenntPfad("/HEIM/jo/mein brän, jo's/x", formen, { plattform: "linux" }), "Linux unterscheidet Groß/Klein");
  const win = pfadFormen("C:\\Daten\\Mein Brän", { home: "C:\\heim\\jo" });
  assert.ok(nenntPfad("type C:\\daten\\mein brän\\09_wiki\\a.md", win, { plattform: "win32" }));
  assert.ok(!nenntPfad("type C:\\Daten\\Mein Brän-kit\\a.md", win, { plattform: "win32" }));
  const brain = pfadFormen("~/brain", { home: HOME });
  assert.ok(!nenntPfad("cd ~/brain-kit-v0.7 && cat .tools/ernte.mjs", brain, { plattform: "darwin" }), "Nachbar-Worktree");
  assert.ok(nenntPfad("cd ~/brain && cat 09_wiki/a.md", brain, { plattform: "darwin" }));
});

test("pfadFormen: der echte Pfad hinter einem Symlink zählt mit", { skip: process.platform === "win32" }, () => {
  const basis = tempOrdner("Sym Brän");
  const echt = join(basis, "echt");
  mkdirSync(echt);
  const verweis = join(basis, "verweis");
  symlinkSync(echt, verweis);
  const formen = pfadFormen(verweis, { home: HOME });
  assert.ok(nenntPfad(`cat ${realpathSync(echt)}/09_wiki/a.md`, formen));
  assert.ok(nenntPfad(`cat ${verweis}/09_wiki/a.md`, formen));
});

test("sperrPfade + aufrufGesperrt: Vault/ernteNichtIn, cwd darin, verschachtelte Eingabe, relativ vom Eltern-cwd; Relatives/Wurzel zählt nicht", () => {
  assert.deepEqual([...sperrPfade("/vault/beispiel", ["~/firma", "", "/", "relativ/ordner", 5], { home: HOME })].sort(), ["/heim/jo/firma", "/vault/beispiel", "~/firma", "$HOME/firma", "${HOME}/firma"].sort());
  const sperr = sperrPfade("/heim/jo/brain", [], { home: HOME });
  assert.ok(aufrufGesperrt({ command: "ls" }, "/heim/jo/brain/09_wiki", sperr), "cwd im Vault");
  assert.ok(aufrufGesperrt({ file_path: "/heim/jo/brain/09_wiki/a.md" }, "/projekte/garten", sperr));
  assert.ok(aufrufGesperrt({ args: ["-n", "~/brain/09_wiki/a.md"] }, "/projekte/garten", sperr));
  assert.ok(aufrufGesperrt({ command: "cat brain/09_wiki/a.md" }, "/heim/jo", sperr), "relativ vom Home aus");
  assert.ok(aufrufGesperrt({ command: "cat ./brain/09_wiki/a.md" }, "/heim/jo", sperr));
  assert.ok(!aufrufGesperrt({ command: "cat brain-app/README.md" }, "/heim/jo", sperr), "Nachbarordner");
  assert.ok(!aufrufGesperrt({ command: "cat brain/x" }, "/projekte/garten", sperr));
  assert.ok(!aufrufGesperrt({ file_path: "/heim/jo/brain/a.md" }, "/heim/jo", []), "ohne Sperrliste nie gesperrt");
});

// Spec §4.1 je Rolle — über das vorhandene beleg.mjs, nach markiereEigenes (eigenes Brain, Fehler, unbekannte Aufrufe → ki).
const FAELLE = [
  ["u01", "Die Tomaten stehen im Hochbeet Nord", "du"],
  ["u02", "Ich lege den Gießplan für das Hochbeet Nord an.", "ki"],
  ["u04", "Tropfschlauch mit 2 Litern pro Stunde", "tool"],
  ["u04", "Die Erdbeeren brauchen Stroh als Unterlage.", "ki"],
  ["u06", "Möhren säen ab Mitte April in Reihe 3.", "tool"],
  ["u08", "Kompost braucht sechs Monate bis zur Reife.", "web"],
  ["u10", "Das Hochbeet Süd bekommt Schneckenkragen.", "ki"],
  ["u11", "Kartoffeln vertragen keinen Frost.", "ki"],
  ["u12", "Mulch hält die Feuchtigkeit im Boden.", "ki"],
  ["u13", "Der Rasen wird nur samstags gemäht.", "ki"],
  ["u13", "Der Rasenmäher steht im Schuppen links.", "du"],
  ["u15", "Der Apfelbaum wurde 2019 gepflanzt.", "ki"],
  ["u17", "Frostwarnung für die Nacht auf Dienstag.", "web"],       // MCP ohne Freigabe (W2)
  ["u18", "Der Komposter steht hinter dem Schuppen.", "du"],         // Claude wiederholt es (u19), Bash zeigt es (u21): ki (K2)
  ["u23", "Datei gartenplan.csv nicht gefunden", "ki"],
  ["u24", "Die Hecke ist 40 Meter lang.", "ki"],
  ["u25", "Zusammenfassung: Beet A hat Lehmboden.", "ki"],
  ["u26", "Der Gärtner sagt: \"Bohnen nie vor den Eisheiligen\" - das gilt auch für Kürbis...", "du"],
  ["u27", "Die Regentonne fasst 300 Liter.", "du"],
  ["u28", "Die Gartenschere liegt in der Werkzeugkiste.", "du"],
  ["u29", "Die Laube hat ein Blechdach.", "ki"],
  ["u30", "Die Gießkanne ist leer.", "ki"],
  ["u32", "Der Zaun ist grün gestrichen.", "tool"],
  ["u35", "Lavendel mag sonnige Standorte.", "web"],
  ["u37", "Die Kartoffeln liegen im Keller.", "tool"],
  ["u39", "Die Kräuterspirale liegt am Südhang.", "ki"],
  ["u41", "Der Gartenkalender beginnt im Februar.", "ki"],
  ["u42", "Die Wasseruhr hängt im Keller.", "du"],
  ["u44", "Rosen brauchen einen Rückschnitt im März.", "web"],
  ["u46", "Der Holzstapel ist trocken.", "ki"],
  [null, "die regentonne fasst 300 liter.", null],
  [null, "Die Regentonne fasst 400 Liter.", null],
  [null, "hinter dem Schuppen. Notiert:", null],
  [null, "Die Tomaten bekommen Brennnesseljauche und Kompost.", null],
  [null, "Reihe 3", null],
];

test("Herkunft je Rolle (Spec §4.1) mit beleg.mjs + markiereEigenes: 100 % der Fälle", () => {
  const zeilen = markiereEigenes(gartenEintraege(), { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  const falsch = [];
  for (const [uuid, zitat, herkunft] of FAELLE) {
    const r = findeZitat(zeilen, zitat);
    const ok = herkunft === null ? r === null : r !== null && r.herkunft === herkunft && r.uuid === uuid;
    if (!ok) falsch.push(`${zitat} → ${JSON.stringify(r)} (erwartet ${herkunft} ${uuid})`);
  }
  assert.deepEqual(falsch, []);
});

test("Herkunft je Rolle: ein vertrautes MCP-Werkzeug (mcpVertraut) liefert tool statt web", () => {
  const zeilen = markiereEigenes(gartenEintraege(), { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  assert.equal(findeZitat(zeilen, "Frostwarnung für die Nacht auf Dienstag.", { mcpVertraut: ["mcp__wetter__*"] }).herkunft, "tool");
  assert.equal(findeZitat(zeilen, "Frostwarnung für die Nacht auf Dienstag.", { mcpVertraut: ["mcp__anderes__x"] }).herkunft, "web");
});

test("markiereEigenes: nur Werkzeug-Ergebnisse wandern; uuid/Zeit bleiben; Nachbarordner und fremde Zeilen unverändert", () => {
  const ein = gartenEintraege();
  const aus = markiereEigenes(ein, { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  const u10 = aus.filter((o) => o.uuid === "u10");
  assert.deepEqual(u10.map((o) => o.type), ["assistant"]);
  assert.equal(u10[0].timestamp, "2026-10-21T08:10:00.000Z");
  assert.equal(u10[0].message.content[0].text, "Das Hochbeet Süd bekommt Schneckenkragen.");
  assert.deepEqual(aus.find((o) => o.uuid === "u32"), ein.find((o) => o.uuid === "u32"));
  assert.deepEqual(aus.find((o) => o.uuid === "u01"), ein.find((o) => o.uuid === "u01"));
  assert.deepEqual(markiereEigenes(null), []);
});

test("webAdresse: WebFetch-Adresse ohne Query/Fragment; WebSearch und Unbekanntes → leer", () => {
  const z = gartenEintraege();
  assert.equal(webAdresse(z, "u08"), "https://example.com/gartentipps");
  assert.equal(webAdresse(z, "u44"), "https://example.com/rosen");
  assert.equal(webAdresse(z, "u35"), "");
  assert.equal(webAdresse(z, "u99"), "");
});

test("ohneEingespieltes/ergebnisText: eingespielte Blöcke raus (offener Block bis zum Ende), Text-Blöcke verbunden", () => {
  assert.equal(ohneEingespieltes("A <system-reminder>x</system-reminder> B <task-notification>offen"), "A \n B");
  assert.equal(ohneEingespieltes("<command-name>/clear</command-name>"), "");
  assert.equal(ergebnisText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(ergebnisText(5), "");
});

test("Fundstelle: <sitzung>#<uuid> <Zeit>, Unbekanntes als ?, Rundweg; Konstanten", () => {
  const f = baueFundstelle({ sitzung: "sitzung-beleg", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z" });
  assert.equal(f, "sitzung-beleg#u06 2026-10-21T08:06:00.000Z");
  assert.match(f, FUNDSTELLE_MUSTER);
  assert.deepEqual(leseFundstelle(f), { sitzung: "sitzung-beleg", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z" });
  assert.equal(baueFundstelle({ sitzung: "s/../x", uuid: "", zeit: "gestern" }), "sx#? ?");
  assert.deepEqual(leseFundstelle("sx#? ?"), { sitzung: "sx", uuid: "", zeit: "" });
  assert.equal(leseFundstelle("kaputt"), null);
  assert.deepEqual(HERKUNFT_WERTE, ["du", "tool", "web", "ki"]);
  assert.equal(MAX_ZITAT, 300);
});

// ---------- K1: Aussage gegen das Zitat (B1, §4.1) ----------

test("aussageGedeckt: andere Zahl (Halle 12 statt 7) oder andere Uhrzeit (16:00 statt 14:30) → ungedeckt, fehlt nennt sie", () => {
  const a = aussageGedeckt("Hauptlager\nDas Hauptlager zieht im November nach Halle 12 um.", "Unser Hauptlager steht in Halle 7");
  assert.equal(a.gedeckt, false);
  assert.ok(a.fehlt.includes("12"), JSON.stringify(a.fehlt));
  const b = aussageGedeckt("Versandschluss\nVersandschluss ist 16:00 Uhr.", "wir versenden täglich um 14:30 Uhr");
  assert.deepEqual([b.gedeckt, b.fehlt], [false, ["16:00"]]);
});

test("aussageGedeckt: Verneinung fehlt im Zitat → ungedeckt (nicht, kein*, nie, ohne, not, no, never)", () => {
  const ohne = "Der Export läuft jeden Morgen um sechs.";
  for (const aussage of ["Der Export läuft nicht mehr.", "Es gibt keinen Export mehr.", "Der Export läuft nie.", "Export ohne Anmeldung.",
    "The export is not running.", "There is no export.", "The export never runs."]) {
    const r = aussageGedeckt(aussage, ohne);
    assert.equal(r.gedeckt, false, aussage);
    assert.ok(r.fehlt.length >= 1, aussage);
  }
  assert.equal(aussageGedeckt("Der Export läuft nicht mehr.", "Der Export läuft nicht mehr, hat der Admin gesagt").gedeckt, true);
  assert.equal(aussageGedeckt("Es gibt keinen Export mehr.", "Einen Export gibt es nicht mehr").gedeckt, true, "nicht/kein sind dieselbe Verneinung");
  assert.equal(aussageGedeckt("Wir liefern nie am Sonntag.", "We never ship on Sundays").gedeckt, true, "nie = never, Sonntag = Sunday");
});

test("aussageGedeckt: Verneinung NUR im Zitat → ungedeckt (Sinn umgekehrt); beidseitig gleiche Anzahl nötig", () => {
  const r = aussageGedeckt("Die Lieferung kommt vor Montag.", "Die Lieferung kommt nicht vor Montag.");
  assert.equal(r.gedeckt, false, "Review-Fall: Verneinung nur im Zitat");
  assert.ok(r.fehlt.includes("verneinung:nicht"), JSON.stringify(r.fehlt));
  for (const [aussage, zitat] of [
    ["The export is running.", "The export is not running."],
    ["Es gibt einen Export.", "Es gibt keinen Export."],
    ["Wir liefern am Sonntag.", "Wir liefern nie am Sonntag."],
    ["Export mit Anmeldung.", "Export ohne Anmeldung."],
  ]) {
    const x = aussageGedeckt(aussage, zitat);
    assert.equal(x.gedeckt, false, aussage);
    assert.ok(x.fehlt.some((f) => f.startsWith("verneinung:")), JSON.stringify(x.fehlt));
  }
  // Zitat trägt zusätzlich eine Verneinung in einem Nebensatz → lieber Lücke als Fehler
  assert.equal(aussageGedeckt("Der Export läuft jeden Morgen.", "Der Export läuft jeden Morgen, auch wenn der Admin nicht da ist.").gedeckt, false);
  // Anzahl zählt: eine Verneinung in der Aussage, zwei im Zitat (und umgekehrt)
  assert.equal(aussageGedeckt("Der Export läuft nicht.", "Der Export läuft nicht, weil der Admin nicht da ist.").gedeckt, false);
  assert.equal(aussageGedeckt("Der Export läuft nicht und der Import läuft nicht.", "Der Export läuft nicht.").gedeckt, false);
  // beide verneint (auch in verschiedenen Wörtern/Sprachen derselben Verneinung) → gedeckt
  assert.equal(aussageGedeckt("Die Lieferung kommt nicht vor Montag.", "Die Lieferung kommt nicht vor Montag.").gedeckt, true);
  assert.equal(aussageGedeckt("Es gibt keinen Export mehr.", "Einen Export gibt es nicht mehr.").gedeckt, true);
  assert.equal(aussageGedeckt("The export is not running.", "The export isn't running.").gedeckt, true);
  assert.equal(aussageGedeckt("Wir liefern nie am Sonntag.", "We never ship on Sundays.").gedeckt, true);
  assert.equal(aussageGedeckt("Am Wochenende wird nicht versendet.", "Am Wochenende versenden wir nicht.").gedeckt, true);
  // beide ohne Verneinung → gedeckt
  assert.equal(aussageGedeckt("Die Lieferung kommt vor Montag.", "Die Lieferung kommt vor Montag.").gedeckt, true);
  // „läuft nicht mehr“ gegen Zitat ohne Verneinung bleibt ungedeckt
  const alt = aussageGedeckt("Der Export läuft nicht mehr.", "Der Export läuft jeden Morgen um sechs.");
  assert.equal(alt.gedeckt, false);
  assert.ok(alt.fehlt.includes("verneinung:nicht"), JSON.stringify(alt.fehlt));
});

test("aussageGedeckt: deckungsgleiche Aussagen sind gedeckt — Dezimal-/Tausenderformen, Datum, Uhrzeit, Zahlwörter, Hervorhebung", () => {
  const gedeckt = [
    ["Der Hausmeister kommt dienstags.", "Der Hausmeister kommt dienstags."],
    ["Preis 1.200 im Monat.", "Die Miete liegt bei 1200 Euro im Monat."],
    ["Preis 1200 im Monat.", "Die Miete liegt bei 1.200 Euro im Monat."],
    ["EK 4,20 und VK 12,99.", "EK: 4.2 / VK: 12.99"],
    ["Budget 50k.", "Das Jahresbudget beträgt 50.000 Euro."],
    ["Ertrag 2,4 Mio.", "Wir haben 2400000 Euro Ertrag gemacht."],
    ["Versandschluss 16 Uhr.", "Versandschluss ist um 16:00."],
    ["Versandschluss um 14.30 Uhr.", "Versand täglich 14:30 Uhr"],
    ["Der Mietvertrag endet am 31.12.2027.", "Der Mietvertrag endet am 31. Dezember 2027."],
    ["Der Vertrag endet am 31. Dezember.", "Mietvertrag Ende: 31.12.2027"],
    ["Die Lieferzeit beträgt drei Tage.", "Die Lieferzeit beträgt 3 Tage."],
    ["Node 26.3.0 ist installiert.", "Installiert ist Node 26.3.0 auf dem Rechner."],
    ["Das **Hauptlager** steht in Halle 7.", "Unser Hauptlager steht in `Halle 7`"],
    ["Das Hauptlager steht in Halle 7.", "„Unser Hauptlager steht in Halle 7“"],
    ["", "irgendein Zitat ohne Zahlen"],
  ];
  for (const [aussage, zitat] of gedeckt) {
    const r = aussageGedeckt(aussage, zitat);
    assert.deepEqual([aussage, r.gedeckt, r.fehlt], [aussage, true, []]);
  }
});

test("aussageGedeckt: Datum, Wochentag, Monat und Zahlwort werden einzeln geprüft", () => {
  assert.equal(aussageGedeckt("Der Vertrag endet am 31.12.2028.", "Der Vertrag endet am 31.12.2027.").gedeckt, false);
  assert.equal(aussageGedeckt("Der Vertrag endet am 30.12.2027.", "Der Vertrag endet am 31.12.2027.").gedeckt, false);
  assert.equal(aussageGedeckt("Die Lieferung kommt im Dezember.", "Die Lieferung kommt im November.").gedeckt, false);
  assert.equal(aussageGedeckt("Die Lieferung kommt montags.", "Die Lieferung kommt donnerstags.").gedeckt, false);
  assert.equal(aussageGedeckt("Die Lieferzeit beträgt vier Tage.", "Die Lieferzeit beträgt drei Tage.").gedeckt, false);
  assert.equal(aussageGedeckt("Die Lieferzeit beträgt 4 Tage.", "Die Lieferzeit beträgt drei Tage.").gedeckt, false);
  assert.equal(aussageGedeckt("Version 1.5 ist live.", "Version 1.50 ist live.").gedeckt, true, "1.5 = 1.50 (Dezimal)");
  assert.equal(aussageGedeckt("Kit 0.5.1 ist live.", "Kit 0.5.2 ist live.").gedeckt, false, "Versionsnummern bleiben getrennt");
  assert.equal(aussageGedeckt("Das Lager ist 12m breit.", "Das Lager ist 8m breit.").gedeckt, false, "Zahl direkt vor einer Einheit zählt");
  assert.equal(aussageGedeckt("Das Lager ist 8m breit, Ziel 50kg.", "Das Lager ist 8m breit, Ziel 50kg.").gedeckt, true);
  const r = aussageGedeckt("Halle 12, 14:30 Uhr, nicht am 3. Mai.", "Halle 7");
  assert.equal(r.gedeckt, false);
  assert.ok(r.fehlt.length >= 4, JSON.stringify(r.fehlt));
});

test("aussageGedeckt: Unbrauchbares wirft nie — kein String, leeres Zitat", () => {
  assert.deepEqual(aussageGedeckt(undefined, undefined), { gedeckt: true, fehlt: [] });
  assert.equal(aussageGedeckt("Halle 12", undefined).gedeckt, false);
  assert.equal(aussageGedeckt("Halle 12", "").gedeckt, false);
  assert.equal(aussageGedeckt(42, null).gedeckt, true);
});

// ---------- W1: Selbstbestätigungs-Sperre — Pfadformen und Inhalt ----------

test("W1 Pfadformen: $HOME/…, ${HOME}/… und relative ../… (gegen den cwd aufgelöst) nennen den Vault", () => {
  const sperr = sperrPfade("/heim/jo/brain", [], { home: HOME });
  for (const form of ["$HOME/brain", "${HOME}/brain"]) assert.ok(sperr.includes(form), form);
  assert.ok(aufrufGesperrt({ command: "cat $HOME/brain/09_wiki/firma/x.md" }, "/projekte/x", sperr));
  assert.ok(aufrufGesperrt({ command: 'grep -r Miet "${HOME}/brain/09_wiki"' }, "/projekte/x", sperr));
  assert.ok(aufrufGesperrt({ command: "cat $HOME/brain" }, "/projekte/x", sperr), "der Ordner selbst");
  assert.ok(!aufrufGesperrt({ command: "cat $HOME/brain-app/README.md" }, "/projekte/x", sperr), "Nachbarordner");
  assert.ok(!aufrufGesperrt({ command: "cat ${HOME}/brainstorm/x" }, "/projekte/x", sperr));
  assert.ok(aufrufGesperrt({ file_path: "../../brain/09_wiki/a.md" }, "/heim/jo/source/app", sperr));
  assert.ok(aufrufGesperrt({ command: "cd ../brain && cat 09_wiki/a.md" }, "/heim/jo/source", sperr));
  assert.ok(aufrufGesperrt({ command: "cat '../../brain/09_wiki/a.md'" }, "/heim/jo/source/app", sperr), "in Anführung");
  assert.ok(aufrufGesperrt({ command: "cat ./../../brain/09_wiki/a.md" }, "/heim/jo/source/app", sperr));
  assert.ok(!aufrufGesperrt({ command: "cat ../brain-app/README.md" }, "/heim/jo/source", sperr), "Nachbarordner");
  assert.ok(!aufrufGesperrt({ command: "cat ../../brain/x" }, "/heim/jo/source/app/x/y", sperr), "landet woanders");
  assert.ok(!aufrufGesperrt({ command: "cat ../../../../etc/hosts" }, "/heim/jo/source/app", sperr));
  assert.ok(!aufrufGesperrt({ command: "ls ../.." }, "/projekte/x/y", sperr));
});

test("W1 worktreePfade: alle Worktrees des Vault-Repos (git worktree list); kein Git-Repo oder kein git → []", () => {
  const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "jo@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "jo@example.com" } });
  assert.deepEqual(worktreePfade(tempOrdner("Ohne Git")), []);
  if (git(".", "--version").status !== 0) return;   // ohne git nur der Leer-Fall
  const basis = tempOrdner("Wt Brän");
  const vault = join(basis, "vault"), kit = join(basis, "kit worktree");
  mkdirSync(vault);
  git(vault, "init", "-q", "-b", "haupt");
  writeFileSync(join(vault, "a.md"), "x");
  git(vault, "add", "a.md");
  git(vault, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "x");
  assert.equal(git(vault, "worktree", "add", "-q", kit, "-b", "zweig").status, 0);
  const liste = worktreePfade(vault);
  assert.deepEqual(liste.map((p) => realpathSync(p)).sort(), [realpathSync(vault), realpathSync(kit)].sort());
  assert.deepEqual(worktreePfade(join(vault, "unterordner-gibt-es-nicht")), []);
  // als Sperre: ein Lesen im Worktree-Ordner zählt als Lesen des eigenen Brains
  const sperr = sperrPfade(vault, liste, { home: HOME });
  assert.ok(aufrufGesperrt({ file_path: join(realpathSync(kit), "09_wiki", "firma", "a.md") }, "/projekte/x", sperr));
});

test("W1 Inhalt: steht das Zitat wörtlich in einer Wiki-Seite des Vaults → zitatImWiki; Wortgrenzen, **fett**, andere Ordner zählen wie in beleg.mjs", () => {
  const v = tempOrdner("Wiki Brän");
  mkdirSync(join(v, "09_wiki", "firma"), { recursive: true });
  mkdirSync(join(v, "10_projekte"));
  writeFileSync(join(v, "09_wiki", "firma", "lager.md"), "---\ntitle: Lager\n---\n- Das **Hauptlager** liegt in Halle 7 · Stand 21.10.2026 · [[firma/belege/2026-10/a]]\n");
  writeFileSync(join(v, "09_wiki", "firma", "preise.md"), "Der Preis liegt bei 1500 Euro.");
  writeFileSync(join(v, "10_projekte", "notiz.md"), "Der Hausmeister kommt dienstags in der Frühe.");
  const texte = wikiTexte(v);
  assert.ok(zitatImWiki("Das Hauptlager liegt in Halle 7", texte));
  assert.ok(zitatImWiki("Das **Hauptlager** liegt in `Halle 7`", texte));
  assert.ok(!zitatImWiki("Der Preis liegt bei 150", texte), "mitten in einer Zahl");
  assert.ok(zitatImWiki("Der Preis liegt bei 1500 Euro.", texte));
  assert.ok(!zitatImWiki("Der Hausmeister kommt dienstags in der Frühe.", texte), "nur 09_wiki zählt");
  assert.ok(!zitatImWiki("Etwas ganz anderes steht hier nicht", texte));
  assert.deepEqual(wikiTexte(join(v, "gibt-es-nicht")), []);
  assert.ok(!zitatImWiki("", texte) && !zitatImWiki(undefined, texte) && !zitatImWiki("Das Hauptlager liegt in Halle 7", undefined));
  // Wiki-Ordner aus der Config
  const w = tempOrdner("Wiki Cfg");
  mkdirSync(join(w, "wissen"));
  writeFileSync(join(w, "brain.config.json"), JSON.stringify({ ordner: { wiki: "wissen" } }));
  writeFileSync(join(w, "wissen", "a.md"), "Die Kantine öffnet um sieben Uhr morgens.");
  assert.ok(zitatImWiki("Die Kantine öffnet um sieben Uhr morgens.", wikiTexte(w)));
});

test("kernsatz: erste nichtleere Zeile eines Stands (getrimmt, Aufzählungszeichen bleibt), Datum am Zeilenanfang bleibt; leer/Unbrauchbares → \"\"", () => {
  assert.equal(kernsatz("Das Testsystem läuft auf Port 3310.\n- Offen: Backup\n- Nächster Schritt: Test"), "Das Testsystem läuft auf Port 3310.");
  assert.equal(kernsatz("\n\n  - Port umgestellt  \n- Rest"), "- Port umgestellt");
  assert.equal(kernsatz("* Erledigt: Umzug\r\n* Offen: Kisten"), "* Erledigt: Umzug");
  assert.equal(kernsatz("-\n- Zweite Zeile zählt, die erste ist leer"), "- Zweite Zeile zählt, die erste ist leer");
  assert.equal(kernsatz("30. Oktober ist Stichtag.\nWeiteres."), "30. Oktober ist Stichtag.");
  for (const leer of ["", "  \n \n", "-", "- ", null, undefined, 42]) assert.equal(kernsatz(leer), "", String(leer));
});
