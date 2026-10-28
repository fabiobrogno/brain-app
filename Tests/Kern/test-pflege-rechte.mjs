// .tools/tests/test-pflege-rechte.mjs — B3 Härtung: pfadbegrenzte Rechte des Sonnet-Aufrufs (Notiz-Inhalt = Daten, nie Auftrag).
// Die Regeln müssen GENAU die Arbeitskopie freigeben (Lesen/Editieren, absolut in der //-Form der Claude-Code-Doku), den
// Werkzeug-/Git-/Settings-Bereich der Kopie und alles Sensible außerhalb ausdrücklich verbieten, Bash auf eine lesende Suche
// verengen und den Vault für Unterprozesse hart auf die Kopie setzen. Nie echtes claude; die Regel-Syntax selbst prüft der
// einmalige, manuelle Rauchtest (nicht Teil der Suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { realpathSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { isoliere, KIT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx } from "./pflege-hilfe.mjs";
const K = await import("../tageslauf/pflege-ki.mjs");
isoliere();

const POSIX = process.platform !== "win32";
const abs = (p) => `//${p.split("\\").join("/").replace(/^\/+/, "")}`;
// macOS: /var/folders/… ist ein Symlink auf /private/var/… — Claude Code vergleicht angefragten UND aufgelösten Pfad.
const varianten = (p) => [...new Set([resolve(p), realpathSync(p)])];
const liste = (a, flag) => { const i = a.indexOf(flag); const o = []; for (let j = i + 1; i >= 0 && j < a.length && !a[j].startsWith("--"); j++) o.push(a[j]); return o; };
// Bash-Regel „Bash(<präfix> *)“: passt auf den Befehl selbst oder Befehl + Leerzeichen + beliebigen Rest (Doku: Wildcard-Muster).
const bashPasst = (regel, befehl) => { const m = /^Bash\((.*) \*\)$/.exec(regel); return !!m && (befehl === m[1] || befehl.startsWith(`${m[1]} `)); };
// Deckt eine Deny-Regel diesen absoluten Pfad ab? (nur //-Regeln mit /** oder exaktem Pfad und ~/-Regeln)
function deckt(regel, pfad) {
  const m = /^(?:Read|Edit)\((.*)\)$/.exec(regel);
  if (!m) return false;
  let r = m[1];
  if (r.startsWith("~/")) r = join(homedir(), r.slice(2)).split(sep).join("/");
  else if (r.startsWith("//")) r = r.slice(1);
  else return false;
  const wurzel = r.replace(/\/\*\*$/, "");
  const p = pfad.split(sep).join("/");
  return p === wurzel || (r.endsWith("/**") && p.startsWith(`${wurzel}/`));
}

test("sonnetRechte: erlaubt nur Lesen/Editieren UNTER der Kopie (//-Form) und die lesende Suche — nichts Nacktes", { skip: !POSIX }, () => {
  const kopie = tempOrdner("kopie");
  const { erlaubt } = K.sonnetRechte(kopie);
  const erwartet = [...varianten(kopie).flatMap((p) => [`Read(${abs(p)}/**)`, `Edit(${abs(p)}/**)`]), "Bash(node .tools/brain.mjs search *)"];
  assert.deepEqual([...erlaubt].sort(), erwartet.sort());
  assert.ok(erlaubt.every((r) => r.includes("(")), "ein nacktes „Read“/„Edit“/„Bash“ würde überall gelten");
  assert.ok(!erlaubt.some((r) => /^(Write|Glob|Grep)/.test(r)), "Write/Glob/Grep haben keine eigenen Pfadregeln — Edit/Read tragen sie");
});

test("sonnetRechte: verboten sind Web, Werkzeug-/Git-/Settings-Bereich der Kopie, der echte Vault und sensible Pfade im Home", { skip: !POSIX }, () => {
  const kopie = tempOrdner("kopie"), vault = tempOrdner("echter Vault");
  const { verboten } = K.sonnetRechte(kopie, { vault });
  for (const r of ["WebFetch", "WebSearch"]) assert.ok(verboten.includes(r), r);
  for (const p of varianten(kopie)) {
    for (const sub of [".git", ".git/**", ".tools/**", ".claude/**", ".mcp.json", "brain.config.json"]) assert.ok(verboten.includes(`Edit(${abs(p)}/${sub})`), `Edit ${sub}`);
  }
  for (const p of varianten(vault)) for (const art of ["Read", "Edit"]) assert.ok(verboten.includes(`${art}(${abs(p)}/**)`), `${art} Vault`);
  for (const r of ["Read(~/.ssh/**)", "Edit(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.gnupg/**)", "Read(~/.config/**)", "Edit(~/.claude*/**)",
    "Edit(~/.zshrc)", "Edit(~/.zshenv)", "Edit(~/.zprofile)", "Edit(~/.bashrc)", "Edit(~/.gitconfig)", "Edit(~/Library/LaunchAgents/**)", "Edit(~/.brain-kit/**)"]) {
    assert.ok(verboten.includes(r), r);
  }
  // Deny schlägt Allow: keine Verbotsregel darf die Kopie selbst treffen (sonst wäre jede Arbeit gesperrt)
  for (const p of varianten(kopie)) assert.ok(!verboten.some((r) => deckt(r, p) || deckt(r, `${p}/09_wiki/x.md`)), "eine Verbotsregel trifft die Kopie");
});

test("sonnetRechte: liegt die Kopie IM Vault (oder in einem Home-Verbot), entfällt genau diese Verbotsregel — Deny schlägt Allow", { skip: !POSIX }, () => {
  const vault = tempOrdner("vault");
  const imVault = join(vault, "kopie");
  mkdirSync(imVault);
  const a = K.sonnetRechte(imVault, { vault }).verboten;
  for (const p of varianten(vault)) assert.ok(!a.includes(`Read(${abs(p)}/**)`) && !a.includes(`Edit(${abs(p)}/**)`), "Vault-Verbot würde die Kopie sperren");
  assert.ok(a.includes("Read(~/.ssh/**)"), "andere Verbote bleiben");
  const imHome = join(homedir(), ".config", "kopie");
  mkdirSync(imHome, { recursive: true });
  const b = K.sonnetRechte(imHome, { vault: tempOrdner("v2") }).verboten;
  assert.ok(!b.includes("Read(~/.config/**)") && !b.includes("Edit(~/.config/**)"));
  assert.ok(b.includes("Read(~/.ssh/**)"));
});

test("Bash: nur die lesende Suche; JEDER andere Unterbefehl von brain.mjs bleibt gesperrt (Liste aus dem echten brain.mjs)", () => {
  // brain.mjs nennt bei unbekanntem Befehl selbst alle Unterbefehle: „Befehle: a | b | …“ (Exit 64) — echter Export, nicht geraten.
  const r = spawnSync(process.execPath, [join(KIT, "brain.mjs"), "__unbekannt__"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: tempOrdner("v") } });
  assert.equal(r.status, 64);
  const befehle = /Befehle: (.+)/.exec(r.stderr)?.[1].split(" | ").map((s) => s.trim()).filter(Boolean) || [];
  assert.ok(befehle.length > 15 && befehle.includes("search") && befehle.includes("hooks-install") && befehle.includes("dienst"), befehle.join());
  const kopie = tempOrdner("kopie");
  const { erlaubt } = K.sonnetRechte(kopie);
  const bash = erlaubt.filter((x) => x.startsWith("Bash"));
  assert.deepEqual(bash, ["Bash(node .tools/brain.mjs search *)"]);
  const frei = befehle.filter((b) => bash.some((rg) => bashPasst(rg, `node .tools/brain.mjs ${b} x`)));
  assert.deepEqual(frei, ["search"], "freigegeben: nur search (liest nur; schreibt höchstens .logs der Kopie)");
  // die gefährlichen Beispiele ausdrücklich: Hooks/Git-Config, LaunchAgent, Backup/Push, Einstellungen, Import, nested Tageslauf, Lock …
  for (const b of ["hooks-install", "dienst", "backup", "einstellungen", "import", "tageslauf", "zurueck", "nachernte", "zeig", "lock", "unlock", "refresh", "index", "update-check", "rueckfragen", "sha"]) {
    assert.ok(!bash.some((rg) => bashPasst(rg, `node .tools/brain.mjs ${b}`)), b);
  }
  // Verkettung, Umleitung, Variablen-Präfix und fremder Pfad passen nicht auf eine Regel mit festem Befehlspräfix
  for (const text of ["node ./.tools/brain.mjs search x", "FOO=1 node .tools/brain.mjs search x", "node .tools/brain.mjs searchx", "node /tmp/brain.mjs search x"]) {
    assert.ok(!bash.some((rg) => bashPasst(rg, text)), text);
  }
});

test("sonnetArgs: Rechte als Listen (ein Argument je Regel), --settings schaltet Hooks aus und fesselt die Dateiwerkzeuge, dontAsk, kein Web/MCP", { skip: !POSIX }, () => {
  const kopie = tempOrdner("kopie"), vault = tempOrdner("vault");
  const a = K.sonnetArgs("SYS", kopie, { vault });
  const w = (f) => a[a.indexOf(f) + 1];
  assert.equal(w("--model"), "sonnet");
  assert.equal(w("--tools"), "Read,Edit,Write,Glob,Grep,Bash");
  const r = K.sonnetRechte(kopie, { vault });
  assert.deepEqual(liste(a, "--allowedTools"), r.erlaubt);
  assert.deepEqual(liste(a, "--disallowedTools"), r.verboten);
  assert.deepEqual(JSON.parse(w("--settings")), { disableAllHooks: true, permissions: { blockReadsOutsideWorkingDirectories: true } });
  assert.equal(w("--permission-mode"), "dontAsk");
  assert.equal(w("--mcp-config"), '{"mcpServers":{}}');
  assert.equal(w("--system-prompt"), "SYS");
  assert.equal(w("--setting-sources"), "project");
  assert.equal(w("--output-format"), "json");
  for (const f of ["-p", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(a.includes(f), f);
  assert.ok(!a.some((x) => /bypass|dangerously/i.test(x)));
  assert.ok(!liste(a, "--allowedTools").some((x) => /^(Read|Edit|Write|Glob|Grep|Bash|WebFetch|WebSearch)$|mcp__/.test(x)));
  assert.ok(!/WebFetch|WebSearch/.test(liste(a, "--allowedTools").join()));
});

test("sonnetArgs ohne Kopie wirft — ohne Pfad lassen sich keine Pfadregeln bilden (fail-closed)", () => {
  assert.throws(() => K.sonnetArgs("SYS"), /Arbeitskopie/);
  assert.throws(() => K.sonnetRechte(""), /Arbeitskopie/);
});

test("sonnetUmgebung: Vault hart auf die Kopie, keine fremden BRAIN_*-Variablen, keine Sitzungs-/GIT_-Variablen, Rest bleibt", () => {
  const kopie = tempOrdner("kopie");
  const u = K.sonnetUmgebung(kopie, { BRAIN_VAULT: "/echter/vault", BRAIN_TAGESLAUF_CACHE: "/x", BRAIN_CLAUDE: "/y", BRAIN_NODE: "/z", BRAIN_KIT_HOME: "/h",
    GIT_DIR: "/g", CLAUDECODE: "1", CLAUDE_PID: "7", PATH: "/usr/bin", ANTHROPIC_BASE_URL: "k", LANG: "de_DE.UTF-8" });
  assert.equal(u.BRAIN_VAULT, realpathSync(kopie));
  assert.equal(u.BRAIN_ERNTE, "1");
  assert.deepEqual(Object.keys(u).filter((k) => k.startsWith("BRAIN_")).sort(), ["BRAIN_ERNTE", "BRAIN_VAULT"]);
  assert.ok(!("GIT_DIR" in u) && !("CLAUDECODE" in u) && !("CLAUDE_PID" in u));
  assert.equal(u.PATH, "/usr/bin");
  assert.equal(u.ANTHROPIC_BASE_URL, "k");     // claude braucht seine Anmeldung/Konfiguration
  assert.equal(u.LANG, "de_DE.UTF-8");
});

test("gepinnter Vault: das ECHTE brain.mjs wirkt mit der Umgebung des Sonnet-Aufrufs auf die Kopie, nie auf den echten Vault (Kontrolle: ohne Pin trifft es ihn)", () => {
  const echt = tempOrdner("echter Vault"), kopie = tempOrdner("kopie");
  const lauf = (env) => spawnSync(process.execPath, [join(KIT, "brain.mjs"), "lock"], { cwd: kopie, env, encoding: "utf8" });
  const feind = { ...process.env, BRAIN_VAULT: echt };            // so sähe die Umgebung aus, wenn der Dienst BRAIN_VAULT gesetzt hat
  const ohnePin = lauf(feind);
  assert.equal(ohnePin.status, 0, ohnePin.stderr);
  assert.ok(existsSync(join(echt, ".logs", "ingest.lock")), "Kontrolle: ohne Pin landet der Lock im echten Vault");
  assert.ok(!existsSync(join(kopie, ".logs", "ingest.lock")));
  const echt2 = tempOrdner("echter Vault 2"), kopie2 = tempOrdner("kopie 2");
  const mitPin = spawnSync(process.execPath, [join(KIT, "brain.mjs"), "lock"], { cwd: kopie2, env: K.sonnetUmgebung(kopie2, { ...process.env, BRAIN_VAULT: echt2 }), encoding: "utf8" });
  assert.equal(mitPin.status, 0, mitPin.stderr);
  assert.ok(existsSync(join(kopie2, ".logs", "ingest.lock")), "mit Pin landet er in der Kopie");
  assert.ok(!existsSync(join(echt2, ".logs", "ingest.lock")), "der echte Vault bleibt unberührt");
});

test("rufeSonnet: Pfadregeln, Settings und gepinnter Vault stehen im echten Aufruf — auch wenn die Eltern-Umgebung BRAIN_VAULT auf den echten Vault setzt", async () => {
  const v = neuerPflegeVault();
  const kopie = tempOrdner("kopie");
  const s = fakeSonnet([{ wenn: "QUELLE: x", antwort: "ok" }]);      // fake-sonnet bricht mit Exit 4 ab, wenn Rechte/Settings/Pin fehlen
  const alt = process.env.BRAIN_VAULT;
  process.env.BRAIN_VAULT = v;
  process.env.BRAIN_NODE = "/nicht/die/kopie";
  try {
    const r = await K.rufeSonnet(pflegeCtx(v), { system: "SYS", eingabe: "QUELLE: x", cwd: kopie });
    assert.equal(r.text, "ok", JSON.stringify(r));
  } finally { if (alt === undefined) delete process.env.BRAIN_VAULT; else process.env.BRAIN_VAULT = alt; delete process.env.BRAIN_NODE; }
  assert.equal(s.anzahl(), 1);
});

test("rufeSonnet: fehlt das Arbeitsverzeichnis, startet nichts (Fehler statt Rechte ohne Pfad)", async () => {
  const v = neuerPflegeVault();
  const s = fakeSonnet([], { standard: "ok" });
  const r = await K.rufeSonnet(pflegeCtx(v), { system: "SYS", eingabe: "x" });
  assert.ok(r.fehler, JSON.stringify(r));
  assert.equal(s.anzahl(), 0);
});
