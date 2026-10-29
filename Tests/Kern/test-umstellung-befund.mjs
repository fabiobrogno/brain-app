// test-umstellung-befund.mjs — Paket P7a: Befund für Vaults aus der Kit-Zeit (Plan docs/plaene/p7-umstellung.md, Abschnitte 1 und 8.5).
// Ein Test je Fixture-Fall (Tests/Kern/fixture-altvault.mjs baut in Temp einen Kit-Vault samt Wegwerf-HOME). Für JEDEN Fall gilt zusätzlich:
//  · der Befund hat die vereinbarte Form (id, kategorie, schwere, ort, anzahl, aktion, phase, text),
//  · in Befund (JSON) und Klartext steht nie ein Wert (die Marke GEHEIM-xyz steckt in jedem Wert, der Zugangsdaten sein könnte),
//  · der Befund hat NICHTS verändert (Stand des ganzen Temp-Baums vorher/nachher gleich).
// Nie ein echtes HOME, nie ein echter Support-Ordner, kein launchctl, kein claude/codex.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { altvault, baumStand, GEHEIM, FixtureNichtMoeglich } from "./fixture-altvault.mjs";
import { erstelleBefund } from "../umstellung/befund.mjs";
import { befundText } from "../umstellung/bericht.mjs";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const SCHWEREN = new Set(["auto", "frage", "hinweis", "blocker"]);

// Fall → erwartete Kategorien (sortiert). Nebenwirkungen eines Falls stehen mit drin (z. B. hängt an jedem Remote auch die Frage nach weiteren Macs).
const FAELLE = {
  // Kit-Ordner
  "kit-versioniert": ["kit-ordner", "kit-versioniert"],
  "kit-unversioniert": ["kit-ordner", "kit-unversioniert"],
  "kit-aenderungen": ["kit-ordner", "kit-ungesichert"],
  "kit-verweis": ["kit-ordner"],
  // Config
  "backup-pfad-gueltig": ["sicherungsordner"],
  "backup-pfad-uebernommen": ["sicherungsordner-uebernommen"],
  "backup-pfad-relativ": ["sicherungsordner-ungueltig"],
  "backup-pfad-verweis": ["sicherungsordner-ungueltig"],
  "werkzeuge-git": ["config-altfelder"],
  "altfelder": ["config-altfelder"],
  "wiki-ordner-pfad": ["ordnername-ungueltig"],
  "config-defekt": ["config-defekt"],
  "config-bom": ["config-bom"],
  // Versionsverlauf
  "hookspath-relativ": ["hookspfad-alt"],
  "hookspath-absolut": ["hookspfad-alt"],
  "hookspath-kortex": [],
  "hookspath-fremd": ["hookspfad-fremd"],
  "credential-helper": ["git-schluessel"],
  "credential-url": ["git-schluessel"],
  "ssh-command": ["git-schluessel"],
  "url-insteadof": ["git-schluessel"],
  "http-extraheader": ["git-schluessel"],
  "lfs-filter": ["git-schluessel"],
  "include-path": ["git-schluessel"],
  "user-name-ungueltig": ["git-schluessel"],
  "remote-prune": ["git-schluessel"],
  "maintenance": ["git-schluessel"],
  "fsmonitor": ["git-schluessel"],
  "core-worktree": ["git-struktur"],
  "partialclone": ["git-struktur"],
  "refstorage": ["git-struktur"],
  "remote-lokal-pfad": ["remote-lokal", "weitere-macs"],
  "remote-lokal-file": ["remote-lokal", "weitere-macs"],
  "remote-https": ["sicherung-ziel", "weitere-macs"],
  "remote-ssh": ["sicherung-ziel", "weitere-macs"],
  "remote-bestaetigt": ["weitere-macs"],
  "git-verweis-exclude": ["git-verweise"],
  "git-datei-aussen": ["git-ausserhalb"],
  "alternates": ["git-alternates"],
  "git-hook-eigen": ["git-hooks-eigen"],
  "kein-git": [],
  // Claude Code
  "hooks-alt-sh": ["claude-hooks"],
  "hooks-alt-mjs": ["claude-hooks"],
  "hooks-alt-home": ["claude-hooks"],
  "hooks-alt-tilde": ["claude-hooks"],
  "hooks-alt-nodestart": ["claude-hooks"],
  "hooks-alt-adapters": ["claude-hooks"],
  "hooks-fremd": [],
  "statusline-alt": ["claude-hooks"],
  "restverweis-skript": ["claude-restverweise"],
  "settings-verweis": ["claude-hooks"],
  "settings-kaputt": ["claude-einstellungen-defekt"],
  "zwei-profile": ["claude-hooks"],
  "plugin-marktplatz": ["claude-plugin"],
  "commands-marke": ["claude-befehle"],
  "commands-ohne-marke": ["claude-befehle-eigen"],
  "skill-verweis": ["claude-befehle-eigen"],
  "profil-claude-md": ["claude-anweisung"],
  // MCP
  "mcp-claude-alt": ["mcp-alt"],
  "mcp-claude-alt-app": ["mcp-alt"],
  "mcp-claude-alt-unbekannt": ["mcp-anders"],
  "mcp-claude-fremd": ["mcp-anders"],
  "mcp-claude-gleich": [],
  "mcp-claude-projekt": ["mcp-alt"],
  "mcp-codex-alt": ["mcp-alt"],
  "mcp-cursor-alt": ["mcp-alt"],
  "mcp-anderer-name": ["mcp-anderer-name"],
  // Hintergrunddienst
  "plist-alt-dieser": ["dienst-alt"],
  "plist-alt-dieser-profil": ["dienst-alt"],
  "plist-alt-anderer": ["dienst-alt-anderer-vault"],
  "plist-neu": [],
  "plist-keiner": [],
  "plist-weitere": ["dienst-weitere"],
  // Vault / Ort
  "vault-claude-settings": ["vault-agenten"],
  "vault-mcp-json": ["vault-agenten"],
  "vault-claude-md": ["vault-agenten"],
  "agents-versioniert": ["agents-versioniert"],
  "shell-datei": ["shell"],
  "pfad-sonderzeichen": ["vault-ort"],
  "alter-support": ["altlasten-aussen"],
  "logs-verweis": ["vault-verweis"],
  "keine-config": ["vault-ungueltig"],
  // Mehrere Macs
  "geraet-anderer-mac": ["anderer-mac"],
  "kernversion-neuer": ["kortex-zu-alt"],
};

function pruefeForm(b) {
  assert.equal(b.version, 1);
  assert.equal(typeof b.kitZeit, "boolean");
  assert.equal(typeof b.umstellbar, "boolean");
  for (const f of b.funde) {
    assert.match(f.id, /^E\d+$/);
    assert.ok(SCHWEREN.has(f.schwere), `schwere ${f.schwere}`);
    assert.equal(typeof f.kategorie, "string");
    assert.equal(typeof f.ort, "string");
    assert.ok(Number.isInteger(f.anzahl) && f.anzahl >= 0, `anzahl ${f.anzahl}`);
    assert.equal(typeof f.aktion, "string");
    assert.ok(f.phase === "A" || f.phase === "B");
    assert.ok(typeof f.text === "string" && f.text.length > 20, `text zu ${f.kategorie}`);
    assert.ok(!f.text.includes("undefined") && !f.text.includes("[object"), `kaputter Text: ${f.text}`);
  }
}
const kategorien = (b) => b.funde.map((f) => f.kategorie).sort();
const finde = (b, k) => b.funde.find((f) => f.kategorie === k);

for (const [fall, erwartet] of Object.entries(FAELLE)) {
  test(`Fall ${fall}: ${erwartet.length ? erwartet.join(" + ") : "kein Fund"}; ohne Werte, nichts verändert`, (t) => {
    let a;
    try { a = altvault({ faelle: [fall] }); } catch (e) { if (e instanceof FixtureNichtMoeglich) return t.skip(e.message); throw e; }
    try {
      const vorher = baumStand(a.basis);
      const b = erstelleBefund(a.opt);
      assert.deepEqual(kategorien(b), [...erwartet].sort(), `Funde: ${JSON.stringify(b.funde.map((f) => [f.kategorie, f.schwere, f.anzahl]))}`);
      pruefeForm(b);
      const alles = JSON.stringify(b) + "\n" + befundText(b);
      assert.ok(!alles.includes(GEHEIM), `Wert im Befund: ${alles.slice(alles.indexOf(GEHEIM) - 80, alles.indexOf(GEHEIM) + 40)}`);
      assert.ok(!/\bBrain\b/.test(befundText(b)), "sichtbarer Text sagt „Kortex“ und „Vault“, nicht „Brain“");
      assert.equal(baumStand(a.basis), vorher, "der Befund darf nichts schreiben (Dateien, Rechte, Zeiten)");
    } finally { a.weg(); }
  });
}

test("sauberer Kortex-Vault (alles in neuer Form: Hooks, MCP, Dienst, Prüfung vor dem Speichern) = leerer Befund", () => {
  const a = altvault();
  try {
    const b = erstelleBefund(a.opt);
    assert.deepEqual(b.funde, []);
    assert.equal(b.kitZeit, false);
    assert.equal(b.umstellbar, true);
    assert.deepEqual(b.zaehlung, { auto: 0, frage: 0, hinweis: 0, blocker: 0, blockerPhaseA: 0 });
    assert.match(befundText(b), /auf dem neuen Stand/);
  } finally { a.weg(); }
});

test("Stufen: auto / frage / hinweis / blocker je Fall wie im Plan", () => {
  const erwartet = {
    "kit-versioniert": { "kit-ordner": ["auto", "B"], "kit-versioniert": ["hinweis", "B"] },
    "kit-aenderungen": { "kit-ungesichert": ["frage", "B"] },
    "hookspath-relativ": { "hookspfad-alt": ["auto", "A"] },
    "hookspath-fremd": { "hookspfad-fremd": ["frage", "A"] },
    "credential-helper": { "git-schluessel": ["frage", "A"] },
    "core-worktree": { "git-struktur": ["hinweis", "A"] },
    "remote-lokal-pfad": { "remote-lokal": ["frage", "A"] },
    "git-datei-aussen": { "git-ausserhalb": ["blocker", "A"] },
    "alternates": { "git-alternates": ["blocker", "A"] },
    "wiki-ordner-pfad": { "ordnername-ungueltig": ["blocker", "A"] },
    "config-defekt": { "config-defekt": ["blocker", "A"] },
    "hooks-alt-sh": { "claude-hooks": ["auto", "A"] },
    "restverweis-skript": { "claude-restverweise": ["hinweis", "A"] },
    "mcp-claude-alt": { "mcp-alt": ["auto", "A"] },
    "mcp-claude-fremd": { "mcp-anders": ["frage", "A"] },
    "plist-alt-dieser": { "dienst-alt": ["auto", "A"] },
    "plist-alt-anderer": { "dienst-alt-anderer-vault": ["frage", "A"] },
    "kernversion-neuer": { "kortex-zu-alt": ["blocker", "A"] },
  };
  for (const [fall, k] of Object.entries(erwartet)) {
    const a = altvault({ faelle: [fall] });
    try {
      const b = erstelleBefund(a.opt);
      for (const [kat, [schwere, phase]] of Object.entries(k)) {
        const f = finde(b, kat);
        assert.ok(f, `${fall}: ${kat} fehlt`);
        assert.equal(f.schwere, schwere, `${fall}/${kat}`);
        assert.equal(f.phase, phase, `${fall}/${kat}`);
      }
    } finally { a.weg(); }
  }
});

test("Zählung und „umstellbar“: ein Blocker der Phase A sperrt, Fragen und Hinweise nicht", () => {
  const a = altvault({ faelle: ["kit-versioniert", "hooks-alt-sh", "credential-helper", "shell-datei"] });
  try {
    const b = erstelleBefund(a.opt);
    assert.equal(b.kitZeit, true);
    assert.equal(b.umstellbar, true);
    assert.equal(b.zaehlung.auto, 2); assert.equal(b.zaehlung.frage, 1); assert.equal(b.zaehlung.hinweis, 2); assert.equal(b.zaehlung.blocker, 0);
  } finally { a.weg(); }
  const c = altvault({ faelle: ["kit-versioniert", "wiki-ordner-pfad"] });
  try {
    const b = erstelleBefund(c.opt);
    assert.equal(b.umstellbar, false);
    assert.equal(b.zaehlung.blockerPhaseA, 1);
    assert.match(befundText(b), /Löse zuerst die Punkte/);
  } finally { c.weg(); }
});

test("Kit-Ordner: Version und Größe, aber kein Dateiname und kein Inhalt", () => {
  const a = altvault({ faelle: ["kit-versioniert"] });
  try {
    const f = finde(erstelleBefund(a.opt), "kit-ordner");
    assert.equal(f.details.version, "0.5.1");
    assert.equal(f.details.art, "ordner");
    assert.ok(f.details.dateien >= 4 && f.details.bytes > 0);
  } finally { a.weg(); }
});

test("git-Schlüssel: nur Namen in der Form abschnitt.*.variable – keine Adresse, kein Wert (auch nicht aus dem Unterabschnitt)", () => {
  const a = altvault({ faelle: ["url-insteadof", "credential-url", "http-extraheader", "ssh-command", "user-name-ungueltig"] });
  try {
    const f = finde(erstelleBefund(a.opt), "git-schluessel");
    assert.equal(f.anzahl, 5);
    const namen = f.details.schluessel.join(",");
    for (const soll of ["url.*.insteadof", "credential.*.helper", "http.*.extraheader", "core.sshcommand", "user.name"]) assert.ok(namen.includes(soll), `${soll} in ${namen}`);
    assert.ok(!namen.includes("example.org") && !namen.includes(GEHEIM), namen);
  } finally { a.weg(); }
});

test("credential.helper mit mehreren Werten (auch leerer Reset-Wert) zählt als EIN Schlüssel", () => {
  const a = altvault({ faelle: ["credential-helper"] });
  try {
    const f = finde(erstelleBefund(a.opt), "git-schluessel");
    assert.equal(f.anzahl, 1);
    assert.deepEqual(f.details.schluessel, ["credential.helper"]);
  } finally { a.weg(); }
});

test("core.hooksPath: die relative Kit-Form wird als alter Kit-Eintrag erkannt (anders als install-git-hooks.mjs#istKortex), die absolute auch", () => {
  const r = altvault({ faelle: ["hookspath-relativ"] });
  const ab = altvault({ faelle: ["hookspath-absolut"] });
  try {
    assert.equal(finde(erstelleBefund(r.opt), "hookspfad-alt").details.form, "relativ");
    assert.equal(finde(erstelleBefund(ab.opt), "hookspfad-alt").details.form, "absolut");
  } finally { r.weg(); ab.weg(); }
});

test("Claude-Hooks: fremde Hooks daneben zählen nicht; alte Statuszeile zählt mit; zwei Profile ergeben je einen Fund", () => {
  const a = altvault({ faelle: ["hooks-alt-sh", "hooks-fremd", "statusline-alt", "zwei-profile"] });
  try {
    const b = erstelleBefund(a.opt);
    const h = b.funde.filter((f) => f.kategorie === "claude-hooks");
    assert.equal(h.length, 2);
    assert.deepEqual(h.map((f) => f.ort).sort(), ["Claude-Profil .claude", "Claude-Profil .claude-privat"]);
    assert.equal(h.find((f) => f.ort.endsWith(".claude")).anzahl, 2, "ein Hook und die Statuszeile");
    assert.deepEqual(b.profile.map((p) => p.name), [".claude", ".claude-privat"]);
  } finally { a.weg(); }
});

test("--claude-home beschränkt die Suche auf genannte Profile", () => {
  const a = altvault({ faelle: ["hooks-alt-sh", "zwei-profile"] });
  try {
    const b = erstelleBefund({ ...a.opt, claudeHomes: [join(a.home, ".claude-privat")] });
    assert.deepEqual(b.funde.map((f) => f.ort), ["Claude-Profil .claude-privat"]);
  } finally { a.weg(); }
});

test("Restverweise: nur Zählung je Stelle, nie der Befehl", () => {
  const a = altvault({ faelle: ["restverweis-skript"] });
  try {
    const f = finde(erstelleBefund(a.opt), "claude-restverweise");
    assert.deepEqual(f.details.stellen, { "hooks.UserPromptSubmit": 1, env: 1 });
  } finally { a.weg(); }
});

test("MCP: Claude (Benutzerebene und Projekt), Codex und Cursor werden gelesen, ohne claude/codex zu starten; Eintrag unter anderem Namen = Hinweis", () => {
  const a = altvault({ faelle: ["mcp-codex-alt", "mcp-cursor-alt", "mcp-claude-alt"] });
  try {
    const b = erstelleBefund(a.opt);
    const m = b.funde.filter((f) => f.kategorie === "mcp-alt").map((f) => f.details.ziel).sort();
    assert.deepEqual(m, ["claude", "codex", "cursor"]);
  } finally { a.weg(); }
});

test("MCP alt mit Kit-Server eines UNBEKANNTEN Ordners ist eine Frage (anders), eines bekannten Vaults (vaults.json) ohne Rückfrage alt", () => {
  const a = altvault({ faelle: ["mcp-claude-alt-unbekannt"] });
  try {
    assert.equal(finde(erstelleBefund(a.opt), "mcp-anders").schwere, "frage");
    a.schreibe(join(a.support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: join(a.basis, "anderer"), name: "x" }], aktiv: null }));
    assert.equal(finde(erstelleBefund(a.opt), "mcp-alt").schwere, "auto");
  } finally { a.weg(); }
});

test("Hintergrunddienst: alt für diesen Vault mit/ohne Profil = auto, für einen anderen Vault = Frage; das Profil wird gemeldet, nie sein Pfad", () => {
  const a = altvault({ faelle: ["plist-alt-dieser-profil"] });
  const b = altvault({ faelle: ["plist-alt-dieser"] });
  try {
    const x = finde(erstelleBefund(a.opt), "dienst-alt");
    assert.equal(x.details.mitProfil, true);
    assert.equal(x.details.fuerDiesenVault, true);
    assert.equal(finde(erstelleBefund(b.opt), "dienst-alt").details.mitProfil, false);
    assert.ok(!JSON.stringify(x).includes(".claude-privat"));
  } finally { a.weg(); b.weg(); }
});

test("weitere Macs: Gerätemerker eines anderen Macs und kernVersion", () => {
  const a = altvault({ faelle: ["geraet-anderer-mac"] });
  try {
    const f = finde(erstelleBefund(a.opt), "anderer-mac");
    assert.equal(f.details.andereMacs, 1);
    // der eigene Merker zählt nicht
    a.schreibe(join(a.support, "umstellung", "geraet.json"), JSON.stringify({ id: "abc123" }));
    assert.equal(finde(erstelleBefund(a.opt), "anderer-mac"), undefined);
  } finally { a.weg(); }
});

test("Vault über Verknüpfung erreichbar und anderes Laufwerk werden als Ort gemeldet", () => {
  const a = altvault({ faelle: ["vault-ueber-verweis"] });
  try {
    const f = finde(erstelleBefund({ ...a.opt, vault: a.vaultVerweis }), "vault-ort");
    assert.ok(f.details.merkmale.includes("verknuepfung"));
    const g = finde(erstelleBefund({ ...a.opt, tmp: "/dev" }), "vault-ort");
    assert.ok(g.details.merkmale.includes("anderes-volume"));
  } finally { a.weg(); }
});

test("laufender Prozess aus dem Kit-Ordner (Attrappe) = Blocker nur für Phase B", async () => {
  const a = altvault({ faelle: ["prozess-attrappe"] });
  const kind = spawn(process.execPath, [join(a.vault, ".tools", "server.mjs")], { stdio: "ignore" });
  try {
    let f;
    for (let i = 0; i < 40 && !f; i++) { f = finde(erstelleBefund(a.opt), "kit-prozesse"); if (!f) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(f, "pgrep findet die Attrappe");
    assert.equal(f.schwere, "blocker");
    assert.equal(f.blockiertPhase, "B");
    assert.ok(f.anzahl >= 1);
    const b = erstelleBefund(a.opt);
    assert.equal(b.umstellbar, true, "Phase A bleibt möglich");
    assert.match(befundText(b), /Erst vor dem späteren Aufräumen zu lösen \(1\)/);
  } finally { kind.kill("SIGKILL"); a.weg(); }
});

test("Pfade mit Leerzeichen, Anführungszeichen und Umlaut: Befund läuft durch, auch mit Kit-Ordner und git-Fund", () => {
  const a = altvault({ faelle: ["pfad-sonderzeichen", "kit-versioniert", "credential-helper"] });
  try {
    const b = erstelleBefund(a.opt);
    assert.deepEqual(kategorien(b), ["git-schluessel", "kit-ordner", "kit-versioniert", "vault-ort"]);
  } finally { a.weg(); }
});

test("Klartext: vier Gruppen, Kopf und Fuß, Begriffe Kortex/Vault", () => {
  const a = altvault({ faelle: ["kit-versioniert", "hooks-alt-sh", "credential-helper", "profil-claude-md"] });
  try {
    const t = befundText(erstelleBefund(a.opt));
    assert.match(t, /^Dein Vault stammt aus der Zeit vor Kortex\./);
    assert.match(t, /Stellt Kortex für dich um \(2\)/);
    assert.match(t, /Braucht deine Entscheidung \(1\)/);
    assert.match(t, /Kann Kortex nicht ändern – nur zur Info \(2\)/);
    assert.match(t, /Claude Code ruft Kortex noch über den alten Werkzeug-Ordner auf/);
    assert.match(t, /Als Nächstes probiert Kortex alles an einer Kopie deines Vaults aus\. Das Original bleibt dabei unberührt\./);
    assert.ok(!t.includes(a.vault), "kein Vault-Pfad im Klartext");
  } finally { a.weg(); }
});

test("Befund an einem Vault ohne Versionsverlauf, ohne HOME-Inhalte und ohne Support-Ordner läuft ohne Fehler", () => {
  const a = altvault({ faelle: ["kein-git"] });
  try {
    const b = erstelleBefund({ vault: a.vault, home: join(a.basis, "gibt-es-nicht"), support: join(a.basis, "auch-nicht") });
    assert.equal(b.version, 1);
    assert.ok(Array.isArray(b.funde));
  } finally { a.weg(); }
});

test("CLI: brain umstellung befund --json (eine Zeile) und Klartext; beschreibt auch einen Vault, den der Kern ablehnt; schreibt nichts", () => {
  const a = altvault({ faelle: ["kit-versioniert", "hooks-alt-sh", "credential-helper"] });
  const v = altvault({ faelle: ["logs-verweis"] });
  try {
    const env = { ...process.env, HOME: a.home, BRAIN_APP_SUPPORT: a.support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1" };
    delete env.BRAIN_VAULT;
    const lauf = (vault, ...args) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", vault, "umstellung", "befund", ...args], { encoding: "utf8", env: { ...env, HOME: vault === v.vault ? v.home : a.home, BRAIN_APP_SUPPORT: vault === v.vault ? v.support : a.support } });
    const vorher = baumStand(a.basis);
    const j = lauf(a.vault, "--json");
    assert.equal(j.status, 0, j.stderr);
    assert.equal(j.stdout.trim().split("\n").length, 1);
    const b = JSON.parse(j.stdout);
    assert.deepEqual(kategorien(b), ["claude-hooks", "git-schluessel", "kit-ordner", "kit-versioniert"]);
    assert.ok(!j.stdout.includes(GEHEIM));
    const t = lauf(a.vault);
    assert.equal(t.status, 0, t.stderr);
    assert.match(t.stdout, /Dein Vault stammt aus der Zeit vor Kortex\./);
    assert.equal(baumStand(a.basis), vorher);
    // Vault, den pruefeVault ablehnt (Verweis aus dem Vault hinaus): der Befund nennt ihn als Blocker statt mit Exit 2 abzubrechen
    const x = lauf(v.vault, "--json");
    assert.equal(x.status, 0, x.stderr);
    assert.deepEqual(kategorien(JSON.parse(x.stdout)), ["vault-verweis"]);
    assert.equal(lauf(a.vault, "--zufall").status, 64);
    assert.equal(spawnSync(process.execPath, [join(KERN, "brain.mjs"), "umstellung", "befund"], { encoding: "utf8", env: { ...env, BRAIN_VAULT: "", BRAIN_APP_SUPPORT: join(a.basis, "leer") } }).status, 2);
  } finally { a.weg(); v.weg(); }
});
