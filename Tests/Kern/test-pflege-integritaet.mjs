// .tools/tests/test-pflege-integritaet.mjs — B3 Härtung: Integritätsprüfung nach jedem KI-Lauf (Node, 0 Tokens). Vor und nach der Arbeit
// wird ein Fingerabdruck (nur Hashes) vom ECHTEN Vault (.git/config, Hooks, .tools, Wiki, HEAD, Arbeitsbaum), von der Kopie
// (.tools, Worktree-Zeiger, .claude) und vom Home (Shell-Starter, SSH, Claude-Settings, LaunchAgents) verglichen. Jede Abweichung →
// Einheit verworfen, Pflege für den Lauf gestoppt, Notiz gesperrt, „Integrität verletzt: <Pfad>“ im Bericht und eine Rückfrage,
// die der Sitzungsstart zuerst und laut zeigt. Szenarien (a)–(e) mit fake-sonnet, Temp-Vault und Temp-HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { KERN } from "../pfade.mjs";
import { isoliere, git, JETZT } from "./tageslauf-hilfe.mjs";
import { hook } from "./verlauf-fixture.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
const I = await import("../tageslauf/inbox-schritt.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const G = await import("../tageslauf/integritaet.mjs");
const M = await import("../tageslauf/morgen.mjs");
const R = await import("../rueckfragen.mjs");
const A = await import("../tageslauf/antworten.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { leseStand } = await import("../tageslauf/pflege-stand.mjs");
const HOME = isoliere();

const ORION = "09_wiki/wissen/orion.md", TEE = "09_wiki/wissen/tee.md";
const SEITEN = {
  [ORION]: seite({ name: "orion", description: "Orion" }, "# Orion\n\nOrion ist der Testdienst.\n"),
  [TEE]: seite({ name: "tee", description: "Tee" }, "# Tee\n\nTee ist ein Getränk.\n"),
};
const ANTWORT = (ziel, seiten) => `Erledigt.\n${JSON.stringify({ ziel, seiten, kurz: "ergänzt" })}`;
const MARKER = "GEHEIMER-INHALT-4711";
let nr = 0;
const jetztFuer = () => JETZT + (nr++) * 1000;
const alt = (v, name, tage) => { const t = (JETZT - tage * 86400e3) / 1000; utimesSync(join(v, "00_inbox", name), t, t); };
const einmalig = (text) => `${text} #${nr}-${Math.random().toString(36).slice(2)}\n`;
async function lauf(v, { probe } = {}) {
  const ctx = pflegeCtx(v, { jetzt: jetztFuer(), ...(probe ? { probe: true } : {}) });
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try { return { ctx, kopie, posten: await I.inboxSchritt(ctx, kopie) }; }
  catch (e) { verwerfeArbeitskopie(v, kopie); throw e; }
}
function aufbau() {
  const v = neuerPflegeVault({ seiten: SEITEN });
  const ctx = pflegeCtx(v, { jetzt: jetztFuer() });
  return { v, ctx, kopie: P.legePflegeKopieAn(v, ctx.lauf) };
}
const schreibe = (p, text) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, text); };

// ---- Fingerabdruck und Vergleich ---------------------------------------------------------------------------------------

test("abweichungen: neu, geändert, weg — sortiert; gleich → leer", () => {
  const a = new Map([["x", "1"], ["y", "2"], ["z", "3"]]);
  const b = new Map([["x", "1"], ["y", "9"], ["w", "4"]]);
  assert.deepEqual(G.abweichungen(a, b), ["w", "y", "z"]);
  assert.deepEqual(G.abweichungen(a, new Map(a)), []);
});

test("Fingerabdruck: zwei Messungen ohne Änderung sind gleich; Inbox, Archiv, .logs, generierte Wiki-Dateien und normale Kopie-Arbeit zählen nicht", () => {
  const { v, ctx, kopie } = aufbau();
  const vorher = P.integritaetsStand(ctx, kopie);
  assert.deepEqual(G.abweichungen(vorher, P.integritaetsStand(ctx, kopie)), []);
  schreibe(join(v, "00_inbox", "neu.md"), "x");
  schreibe(join(v, "90_archiv", "a.md"), "x");
  schreibe(join(v, ".logs", "l.log"), "x");
  schreibe(join(v, "09_wiki", "_index.md"), "generiert");
  schreibe(join(v, "09_wiki", "wissen", "_wissen.md"), "generiert");
  appendFileSync(join(kopie.pfad, ORION), "Neue Zeile in der Kopie.\n");
  schreibe(join(kopie.pfad, "30_wissen", "n.md"), "Kopie");
  schreibe(join(HOME, ".ssh", "known_hosts"), einmalig("host"));
  schreibe(join(HOME, "irgendwas.txt"), einmalig("x"));
  assert.deepEqual(G.abweichungen(vorher, P.integritaetsStand(ctx, kopie)), []);
  verwerfeArbeitskopie(v, kopie);
});

const MUTATIONEN = [
  ["Git-Konfiguration des Vaults", ".git/config", ({ v }) => appendFileSync(join(v, ".git", "config"), "\n[alias]\n\tx = !true\n")],
  ["Git-Hook im Standardordner", ".git/hooks/pre-push", ({ v }) => schreibe(join(v, ".git", "hooks", "pre-push"), einmalig("#!/bin/sh"))],
  ["Git-Info (attributes)", ".git/info/attributes", ({ v }) => schreibe(join(v, ".git", "info", "attributes"), einmalig("* text"))],
  ["Werkzeug-Code im Vault", ".tools/neu.mjs", ({ v }) => schreibe(join(v, ".tools", "neu.mjs"), einmalig("//"))],
  ["Wiki-Seite im Vault", ORION, ({ v }) => appendFileSync(join(v, ORION), "von außen\n")],
  ["neue Wiki-Seite im Vault", "09_wiki/wissen/heimlich.md", ({ v }) => schreibe(join(v, "09_wiki", "wissen", "heimlich.md"), "x")],
  ["neue Datei im Arbeitsbaum", "Arbeitsbaum/heimlich.txt", ({ v }) => schreibe(join(v, "heimlich.txt"), einmalig("x"))],
  ["HEAD des Vaults", "HEAD", ({ v }) => { schreibe(join(v, "n.txt"), einmalig("x")); git(v, "add", "--", "n.txt"); git(v, "commit", "-qm", "x"); }],
  ["Werkzeug-Code der Kopie", "Arbeitskopie/.tools/neu.mjs", ({ kopie }) => schreibe(join(kopie.pfad, ".tools", "neu.mjs"), einmalig("//"))],
  ["Worktree-Zeiger der Kopie", "Arbeitskopie/.git", ({ kopie }) => writeFileSync(join(kopie.pfad, ".git"), einmalig("gitdir: /woanders"))],
  ["Claude-Settings der Kopie", "Arbeitskopie/.claude/settings.json", ({ kopie }) => schreibe(join(kopie.pfad, ".claude", "settings.json"), einmalig("{}"))],
  ["MCP-Datei der Kopie", "Arbeitskopie/.mcp.json", ({ kopie }) => schreibe(join(kopie.pfad, ".mcp.json"), einmalig("{}"))],
  ["Rückfrage-Datei (Freigabe)", "00_inbox/_rueckfragen/rf-x.md", ({ v }) => schreibe(join(v, "00_inbox", "_rueckfragen", "rf-x.md"), einmalig("antwort: uebernehmen"))],
  ["Entscheidungs-Auftrag", "00_inbox/_entscheidungen/e-x.md", ({ v }) => schreibe(join(v, "00_inbox", "_entscheidungen", "e-x.md"), einmalig("wahl: b"))],
  ["autostufe.json", ".logs/tageslauf/autostufe.json", ({ v }) => schreibe(join(v, ".logs", "tageslauf", "autostufe.json"), einmalig("{}"))],
  ["pflege-stand.json", ".logs/tageslauf/pflege-stand.json", ({ v }) => schreibe(join(v, ".logs", "tageslauf", "pflege-stand.json"), einmalig("{}"))],
  ["pruefungen.jsonl", ".logs/tageslauf/pruefungen.jsonl", ({ v }) => schreibe(join(v, ".logs", "tageslauf", "pruefungen.jsonl"), einmalig("{}"))],
  ["gespeicherter Pflege-Vorschlag (Patch)", ".logs/tageslauf/pflege-vorschlaege/rf-x.patch", ({ v }) => schreibe(join(v, ".logs", "tageslauf", "pflege-vorschlaege", "rf-x.patch"), einmalig("diff"))],
  ["brain.config.json des Vaults", "brain.config.json", ({ v }) => writeFileSync(join(v, "brain.config.json"), einmalig("{}"))],
  ["~/.zshrc", "~/.zshrc", () => schreibe(join(HOME, ".zshrc"), einmalig("# rc"))],
  ["~/.zshenv", "~/.zshenv", () => schreibe(join(HOME, ".zshenv"), einmalig("# rc"))],
  ["~/.bashrc", "~/.bashrc", () => schreibe(join(HOME, ".bashrc"), einmalig("# rc"))],
  ["~/.gitconfig", "~/.gitconfig", () => schreibe(join(HOME, ".gitconfig"), einmalig("[user]"))],
  ["~/.claude*/settings.json", "~/.claude-test/settings.json", () => schreibe(join(HOME, ".claude-test", "settings.json"), einmalig("{}"))],
  ["~/.ssh/authorized_keys", "~/.ssh/authorized_keys", () => schreibe(join(HOME, ".ssh", "authorized_keys"), einmalig("ssh-ed25519 AAAA"))],
  ["~/.ssh/config", "~/.ssh/config", () => schreibe(join(HOME, ".ssh", "config"), einmalig("Host x"))],
  ["LaunchAgent", "~/Library/LaunchAgents/test.plist", () => schreibe(join(HOME, "Library", "LaunchAgents", "test.plist"), einmalig("<plist/>"))],
];
for (const [name, schluessel, aendere] of MUTATIONEN) {
  test(`Fingerabdruck erkennt: ${name} → „${schluessel}“`, () => {
    const { v, ctx, kopie } = aufbau();
    const vorher = P.integritaetsStand(ctx, kopie);
    aendere({ v, kopie });
    const abw = G.abweichungen(vorher, P.integritaetsStand(ctx, kopie));
    assert.ok(abw.includes(schluessel), abw.join());
    verwerfeArbeitskopie(v, kopie);
  });
}

test("Fingerabdruck enthält nie Inhalte: nur Hashes und kurze Marken, auch bei Geheimem in den Dateien", () => {
  const { v, ctx, kopie } = aufbau();
  schreibe(join(HOME, ".zshrc"), `export X_MARKE=${MARKER}\n`);
  schreibe(join(v, ".tools", "x.mjs"), `// ${MARKER}\n`);
  const f = P.integritaetsStand(ctx, kopie);
  for (const [k, w] of f) {
    assert.ok(!w.includes(MARKER) && !k.includes(MARKER));
    assert.ok(w.length <= 120, `${k}: ${w}`);
  }
  assert.ok([...f.keys()].includes("~/.zshrc") && [...f.keys()].includes(".tools/x.mjs"));
  verwerfeArbeitskopie(v, kopie);
});

// ---- Szenarien (a)–(e): fake-sonnet schreibt, Node merkt es ------------------------------------------------------------

const FAELLE = [
  ["a", "einen Hook im echten Vault (.tools/git-hooks/pre-commit)", (v) => ({ aussen: { [join(v, ".tools", "git-hooks", "pre-commit")]: einmalig(`#!/bin/sh\n# ${MARKER}`) } }), ".tools/git-hooks/pre-commit"],
  ["b", "die Git-Konfiguration des echten Vaults (.git/config)", (v) => ({ aussenAnhaengen: { [join(v, ".git", "config")]: `\n[alias]\n\tpwn = !echo ${MARKER}\n` } }), ".git/config"],
  ["c", "~/.zshrc im Home", () => ({ aussen: { [join(HOME, ".zshrc")]: einmalig(`export X=${MARKER}`) } }), "~/.zshrc"],
  ["d", "den Werkzeug-Code der Arbeitskopie (.tools/x.mjs)", () => ({ dateien: { ".tools/x.mjs": einmalig(`// ${MARKER}`) } }), "Arbeitskopie/.tools/x.mjs"],
];
for (const [id, name, regelFuer, erwartet] of FAELLE) {
  test(`Szenario ${id}: KI ändert ${name} → erkannt, Einheit verworfen, Pflege gestoppt, Notiz gesperrt, Warnung sichtbar`, async () => {
    const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "a-boese.md": "# A\n\nText.\n", "b-zweite.md": "# B\n\nZwei.\n" } });
    alt(v, "a-boese.md", 3); alt(v, "b-zweite.md", 2);
    const s = fakeSonnet([{ wenn: "QUELLE: 00_inbox/a-boese.md", antwort: ANTWORT("30_wissen/a.md", [ORION]), anhaengen: { [ORION]: "Neu.\n" }, ...regelFuer(v) }]);
    const headVorher = git(v, "rev-parse", "HEAD");
    const { ctx, kopie, posten } = await lauf(v);
    assert.equal(posten.length, 1, "nach der Verletzung keine zweite Notiz");
    const [p] = posten;
    assert.equal(p.erg.ok, false);
    assert.equal(p.erg.grund, "integritaet-verletzt", JSON.stringify(p.erg));
    assert.ok(p.erg.befunde.some((b) => b.meldung === `Integrität verletzt: ${erwartet}`), JSON.stringify(p.erg.befunde));
    assert.equal(p.nachMerge, undefined, "nichts archiviert");
    assert.equal(ctx.pflegeStopp, true);
    assert.equal(s.anzahl(), 1, "keine weitere KI-Einheit in diesem Lauf");
    assert.match(ctx.grund, /Integrität verletzt/);
    assert.ok(ctx.integritaet.pfade.includes(erwartet));
    // Bericht (Aktionsprotokoll des Laufs)
    assert.ok(ctx.aktionen.some((a) => a.stufe === "fehler" && String(a.grund).includes(`Integrität verletzt: ${erwartet}`)), JSON.stringify(ctx.aktionen));
    // Kopie zurückgesetzt, nichts gemergt
    if (id === "b") {
      // Die .git/config des Vaults trägt jetzt einen Schlüssel, der nicht auf der Erlaubnisliste steht: git-sicher verweigert jeden weiteren
      // git-Aufruf des Kerns (Exit 126) — die Kopie lässt sich nicht mehr per Kern-git zurücksetzen und wird einfach weggeworfen. Wichtig ist:
      // erkannt, verworfen, gestoppt, nichts gemergt (siehe unten).
      const r = spawnSync(join(KERN, "git-sicher"), ["-C", kopie.pfad, "status", "--porcelain"], { encoding: "utf8" });
      assert.equal(r.status, 126, "git-sicher sperrt den Vault mit der veränderten .git/config");
    } else {
      assert.equal(git(kopie.pfad, "status", "--porcelain", "--ignored"), "");
    }
    assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
    assert.equal(P.uebernehmePflege(ctx, kopie).commits.size, 0);
    assert.equal(git(v, "rev-parse", "HEAD"), headVorher);
    // Notizen bleiben liegen, die verdächtige ist gesperrt (wird nie wieder an die KI gegeben)
    assert.ok(existsSync(join(v, "00_inbox/a-boese.md")) && existsSync(join(v, "00_inbox/b-zweite.md")) && !existsSync(join(v, "90_archiv")));
    const st = leseStand(v).inbox["a-boese.md"];
    assert.deepEqual([st.gesperrt, st.grund], [true, "integritaet-verletzt"]);
    // Warnung: Rückfrage + laute Zeile beim Sitzungsstart (ganz oben)
    const fragen = R.listeRueckfragen(v).filter((r) => r.typ === "integritaet");
    assert.equal(fragen.length, 1);
    assert.ok(fragen[0].fm.pfade.includes(erwartet) && !fragen[0].antwort);
    const zeile = M.integritaetsZeile(v);
    assert.match(zeile, /^ACHTUNG .*Integrität verletzt/);
    assert.ok(zeile.includes(erwartet) && !zeile.includes("\n"));
    const start = hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;
    assert.ok(start.startsWith("ACHTUNG"), start);
    assert.ok(start.split("\n")[0].includes(erwartet));
    // nie Inhalt: weder im Befund noch im Protokoll noch in der Warnung
    for (const t of [JSON.stringify(p.erg), JSON.stringify(ctx.aktionen), ctx.grund, zeile, readFileSync(fragen[0].datei, "utf8")]) assert.ok(!t.includes(MARKER), "Inhalt geleakt");
    verwerfeArbeitskopie(v, kopie);
  });
}

test("Szenario f/g: KI setzt „antwort: uebernehmen“ in einer Rückfrage bzw. ändert autostufe.json → Integritätsverletzung, nichts gemergt, nichts archiviert", async () => {
  for (const [name, erwartet, bau] of [
    ["Rückfrage", null, (v) => {
      const ctx0 = pflegeCtx(v, { jetzt: jetztFuer() });
      const id = R.legeRueckfrageAn(ctx0, { typ: "heikel", frage: "Übernehmen?", seite: ORION, grund: "autostufe-aus" });
      const datei = join(v, "00_inbox", "_rueckfragen", `${id}.md`);
      return { erwartet: `00_inbox/_rueckfragen/${id}.md`, regel: { aussen: { [datei]: readFileSync(datei, "utf8").replace(/^antwort:.*$/m, "antwort: uebernehmen") } } };
    }],
    ["autostufe.json", null, (v) => {
      mkdirSync(join(v, ".logs", "tageslauf"), { recursive: true });
      writeFileSync(join(v, ".logs", "tageslauf", "autostufe.json"), '{"stufe":"aus"}\n');
      return { erwartet: ".logs/tageslauf/autostufe.json", regel: { aussen: { [join(v, ".logs", "tageslauf", "autostufe.json")]: '{"stufe":"normal"}\n' } } };
    }],
    ["brain.config.json", null, (v) => ({ erwartet: "brain.config.json", regel: { aussenAnhaengen: { [join(v, "brain.config.json")]: " " } } })],
  ]) {
    const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "a-boese.md": "# A\n\nText.\n" } });
    const { erwartet, regel } = bau(v);
    fakeSonnet([{ wenn: "QUELLE: 00_inbox/a-boese.md", antwort: ANTWORT("30_wissen/a.md", [ORION]), anhaengen: { [ORION]: "Neu.\n" }, ...regel }]);
    const head = git(v, "rev-parse", "HEAD");
    const { ctx, kopie, posten } = await lauf(v);
    const [p] = posten;
    assert.equal(p.erg.grund, "integritaet-verletzt", `${name}: ${JSON.stringify(p.erg)}`);
    assert.ok(p.erg.befunde.some((b) => b.meldung === `Integrität verletzt: ${erwartet}`), `${name}: ${JSON.stringify(p.erg.befunde)}`);
    assert.equal(P.uebernehmePflege(ctx, kopie).commits.size, 0);
    assert.equal(git(v, "rev-parse", "HEAD"), head);
    assert.ok(existsSync(join(v, "00_inbox/a-boese.md")) && !existsSync(join(v, "90_archiv")));
    verwerfeArbeitskopie(v, kopie);
  }
});

test("Szenario e: reguläres Schreiben nur in die Kopie → normal übernommen, archiviert, keine Warnung", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "a.md": "# A\n\nOrion nutzt Redis.\n", "b.md": "# B\n\nTee ist grün.\n" } });
  alt(v, "a.md", 3); alt(v, "b.md", 2);
  const s = fakeSonnet([
    { wenn: "QUELLE: 00_inbox/a.md", antwort: ANTWORT("30_wissen/a.md", [ORION]), anhaengen: { [ORION]: "Orion nutzt Redis.\n" } },
    { wenn: "QUELLE: 00_inbox/b.md", antwort: ANTWORT("30_wissen/b.md", [TEE]), anhaengen: { [TEE]: "Tee ist grün.\n" } },
  ]);
  const { ctx, kopie, posten } = await lauf(v);
  assert.deepEqual(posten.map((p) => p.erg.ok), [true, true], JSON.stringify(posten.map((p) => p.erg)));
  assert.ok(!ctx.pflegeStopp && !ctx.integritaet);
  assert.equal(s.anzahl(), 2);
  assert.deepEqual(R.listeRueckfragen(v).filter((r) => r.typ === "integritaet"), []);
  assert.equal(M.integritaetsZeile(v), null);
  assert.equal(P.uebernehmePflege(ctx, kopie).ok, true);
  for (const p of posten) assert.ok(p.nachMerge().verschoben);
  assert.ok(!existsSync(join(v, "00_inbox/a.md")) && !existsSync(join(v, "00_inbox/b.md")));
  const start = hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;
  assert.doesNotMatch(start, /Integrität|ACHTUNG/);
  verwerfeArbeitskopie(v, kopie);
});

test("gesperrte Notiz: im nächsten Lauf geht sie nicht wieder an die KI (gleicher Inhalt), nur die zweite kommt dran", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "a-boese.md": "# A\n\nText.\n", "b-zweite.md": "# B\n\nZwei.\n" } });
  alt(v, "a-boese.md", 3); alt(v, "b-zweite.md", 2);
  const s = fakeSonnet([
    { wenn: "QUELLE: 00_inbox/a-boese.md", antwort: ANTWORT("30_wissen/a.md", [ORION]), aussen: { [join(HOME, ".zshenv")]: einmalig("# x") } },
    { wenn: "QUELLE: 00_inbox/b-zweite.md", antwort: ANTWORT("30_wissen/b.md", [TEE]), anhaengen: { [TEE]: "Zwei.\n" } },
  ]);
  const erst = await lauf(v);
  assert.equal(erst.posten[0].erg.grund, "integritaet-verletzt");
  verwerfeArbeitskopie(v, erst.kopie);
  const zweit = await lauf(v);
  assert.deepEqual(zweit.posten.map((p) => p.erg.ok), [true]);
  assert.equal(s.anzahl(), 2, "a nur einmal, b einmal");
  assert.deepEqual(I.inboxKandidaten(zweit.ctx).gesperrt, ["a-boese.md"]);
  verwerfeArbeitskopie(v, zweit.kopie);
});

test("Probelauf: Verletzung wird trotzdem gemeldet (Rückfrage da), aber nichts im Stand geschrieben", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "a.md": "# A\n\nText.\n" } });
  fakeSonnet([{ wenn: "QUELLE: 00_inbox/a.md", antwort: ANTWORT("30_wissen/a.md", [ORION]), aussen: { [join(HOME, ".bashrc")]: einmalig("# x") } }]);
  const { ctx, kopie, posten } = await lauf(v, { probe: true });
  assert.equal(posten[0].erg.grund, "integritaet-verletzt");
  assert.equal(ctx.pflegeStopp, true);
  assert.equal(R.listeRueckfragen(v).filter((r) => r.typ === "integritaet").length, 1);
  assert.match(M.integritaetsZeile(v), /~\/\.bashrc/);
  assert.deepEqual(leseStand(v), {});
  verwerfeArbeitskopie(v, kopie);
});

test("dieselbe Verletzung in einem zweiten Lauf legt keine zweite Rückfrage an; mehrere Pfade stehen in EINER Zeile", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, inbox: { "a.md": "# A\n\nText.\n", "b.md": "# B\n\nZwei.\n" } });
  alt(v, "a.md", 3); alt(v, "b.md", 2);
  fakeSonnet([
    { wenn: "QUELLE: 00_inbox/a.md", antwort: ANTWORT("30_wissen/a.md", [ORION]), aussen: { [join(HOME, ".profile")]: einmalig("# x"), [join(HOME, ".zprofile")]: einmalig("# y") } },
    { wenn: "QUELLE: 00_inbox/b.md", antwort: ANTWORT("30_wissen/b.md", [TEE]), aussen: { [join(HOME, ".profile")]: einmalig("# x"), [join(HOME, ".zprofile")]: einmalig("# y") } },
  ]);
  const erst = await lauf(v);
  verwerfeArbeitskopie(v, erst.kopie);
  const zweit = await lauf(v);
  verwerfeArbeitskopie(v, zweit.kopie);
  assert.equal(zweit.posten[0].erg.grund, "integritaet-verletzt");
  assert.equal(R.listeRueckfragen(v).filter((r) => r.typ === "integritaet").length, 1, "dedupliziert");
  const zeile = M.integritaetsZeile(v);
  assert.ok(zeile.includes("~/.profile") && zeile.includes("~/.zprofile") && !zeile.includes("\n"), zeile);
});

test("Rückfrage „integritaet“: nur „geprueft“ nimmt die Warnung weg („spaeter“ lässt sie stehen); danach keine Zeile mehr, der nächste Lauf archiviert sie ohne Fehler", () => {
  const v = neuerPflegeVault({ seiten: SEITEN, automatik: { tageslauf: "aus" } });
  const ctx = pflegeCtx(v, { jetzt: jetztFuer() });
  G.meldeVerletzung(ctx, { einheit: "inbox-x", pfade: [".git/config"] });
  assert.match(M.integritaetsZeile(v), /\.git\/config/);
  const start = () => hook("session-start.mjs", { session_id: "s", source: "startup", cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;
  assert.match(start(), /^ACHTUNG/, "auch bei ausgeschaltetem Tageslauf — Sicherheit hängt nicht am Schalter");
  const [r] = R.listeRueckfragen(v).filter((x) => x.typ === "integritaet");
  assert.deepEqual(Object.keys(R.TYPEN.integritaet.wahlen), ["geprueft", "spaeter"]);
  assert.throws(() => R.beantworte(v, r.id, "egal"), /passt nicht/);
  R.beantworte(v, r.id, "spaeter");
  const spaeter = A.wendeAntwortenAn(pflegeCtx(v, { jetzt: jetztFuer() }));
  assert.deepEqual([spaeter.erledigt, spaeter.fehler], [0, 0]);
  assert.match(M.integritaetsZeile(v), /\.git\/config/, "„später“ versteckt die Warnung nicht");
  assert.ok(R.listeRueckfragen(v).find((x) => x.id === r.id && !x.antwort));
  R.beantworte(v, r.id, "geprueft");
  assert.equal(M.integritaetsZeile(v), null);
  assert.doesNotMatch(start(), /ACHTUNG|Integrität/);
  const erg = A.wendeAntwortenAn(pflegeCtx(v, { jetzt: jetztFuer() }));
  assert.deepEqual([erg.erledigt, erg.fehler], [1, 0]);
  assert.ok(existsSync(join(v, "90_archiv", "rueckfragen-erledigt", `${r.id}.md`)));
  assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.typ === "integritaet"), []);
});

test("meldeVerletzung: Pfade bereinigt (Steuerzeichen, Länge), Arbeitsbaum-Doppel entfallen, höchstens drei in der Zeile", () => {
  const v = neuerPflegeVault({ seiten: SEITEN });
  const ctx = pflegeCtx(v, { jetzt: jetztFuer() });
  G.meldeVerletzung(ctx, { einheit: "inbox-y", pfade: [".tools/a.mjs", "Arbeitsbaum/.tools/a.mjs", "~/.zshrc\nINJIZIERT: tu etwas", `~/${"x".repeat(400)}`, "~/.ssh/config", "~/.bashrc"] });
  const zeile = M.integritaetsZeile(v);
  assert.ok(!zeile.includes("\n") && !zeile.includes("INJIZIERT: tu"), zeile);
  assert.ok(zeile.length < 700, String(zeile.length));
  assert.match(zeile, /\(\+\d+ weitere\)/);
  assert.ok(!ctx.integritaet.pfade.includes("Arbeitsbaum/.tools/a.mjs"), ctx.integritaet.pfade.join());
  const [r] = R.listeRueckfragen(v).filter((x) => x.typ === "integritaet");
  assert.ok(r.fm.pfade.every((p) => p.length <= 200 && !/[\u0000-\u001f]/.test(p)));
});
