// Studio v2: Erkennung der KI-Programme (gemeinsam/ki.mjs) — nur gefälschte Programme in Wegwerf-Ordnern, nie ein echtes claude.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { tmp, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-"); // os.homedir() liest $HOME: nichts aus dem echten Home

const { findeProgramm, erkenneAgenten, versionAus } = await import(pfad("gemeinsam", "ki.mjs"));

// Gefälschtes Programm: ausführbares Shell-Skript.
function skript(ordner, name, koerper, modus = 0o755) {
  const p = join(ordner, name);
  writeFileSync(p, `#!/bin/sh\n${koerper}\n`);
  chmodSync(p, modus);
  return p;
}
// Suchumgebung nur mit diesem Ordner (PATH und — im Testmodus — die Zusatzorte überschrieben); process.env bleibt unberührt.
const umgebung = (ordner, extra = "") => ({ ...process.env, PATH: ordner, BRAIN_TESTMODUS: "1", BRAIN_CLAUDE_EXTRA: extra });
const IDS = ["claude", "codex", "gemini", "cursor-agent", "opencode"];

test("findeProgramm: findet ausführbare Dateien (auch per Symlink), ignoriert Ordner und nicht ausführbare Dateien", () => {
  const d = tmp("brain-ki-");
  const echt = skript(d, "codex", 'echo "codex-cli 1.0.0"');
  mkdirSync(join(d, "gemini"));                       // Ordner mit dem Namen
  skript(d, "opencode", "echo x", 0o644);             // nicht ausführbar
  const ziel = tmp("brain-ki-ziel-");
  skript(ziel, "echtes-cursor", "echo x");
  symlinkSync(join(ziel, "echtes-cursor"), join(d, "cursor-agent")); // Symlink auf Programm
  const env = umgebung(d);
  assert.equal(findeProgramm("codex", env), echt);
  assert.equal(findeProgramm("gemini", env), null, "Ordner zählt nicht");
  assert.equal(findeProgramm("opencode", env), null, "nicht ausführbar");
  assert.equal(findeProgramm("cursor-agent", env), join(d, "cursor-agent"), "Symlink auf eine Datei zählt");
  assert.equal(findeProgramm("claude", env), null);
  assert.ok(findeProgramm("codex", env).startsWith("/"), "absoluter Pfad");
});

test("findeProgramm: Namen mit Pfadanteil, leere Namen und relative PATH-Einträge werden nie gefunden", () => {
  const d = tmp("brain-ki-");
  skript(d, "codex", "echo x");
  const env = umgebung(d);
  for (const name of ["../codex", "a/b", "", ".versteckt", "-x", " codex", undefined, null, 42]) assert.equal(findeProgramm(name, env), null, String(name));
  assert.equal(findeProgramm("codex", { ...env, PATH: "relativ:." }), null, "relative PATH-Einträge hängen vom Arbeitsordner ab");
  assert.equal(findeProgramm("codex", { ...env, PATH: `${d}:/nicht/da` }), join(d, "codex"));
});

test("findeProgramm: PATH kommt vor den Zusatzorten; BRAIN_CLAUDE_EXTRA ersetzt die Zusatzorte nur im Testmodus", () => {
  const imPfad = tmp("brain-ki-pfad-"), extra = tmp("brain-ki-extra-"), nurExtra = tmp("brain-ki-extra2-");
  skript(imPfad, "claude", "echo pfad"); skript(extra, "claude", "echo extra"); skript(nurExtra, "codex", "echo extra");
  const env = { ...process.env, PATH: imPfad, BRAIN_TESTMODUS: "1", BRAIN_CLAUDE_EXTRA: `${extra}:${nurExtra}` };
  assert.equal(findeProgramm("claude", env), join(imPfad, "claude"), "PATH zuerst");
  assert.equal(findeProgramm("codex", env), join(nurExtra, "codex"), "Zusatzort");
  // ohne Testmodus wirkt der Schalter nicht (sonst ließe sich die Suche von außen umlenken)
  skript(extra, "brain-test-nur-extra", "echo x");
  assert.equal(findeProgramm("brain-test-nur-extra", { PATH: "", BRAIN_CLAUDE_EXTRA: extra }), null);
  assert.equal(findeProgramm("brain-test-nur-extra", { PATH: "", BRAIN_TESTMODUS: "0", BRAIN_CLAUDE_EXTRA: extra }), null);
  assert.equal(findeProgramm("brain-test-nur-extra", { PATH: "", BRAIN_TESTMODUS: "1", BRAIN_CLAUDE_EXTRA: extra }), join(extra, "brain-test-nur-extra"));
  // leerer Schalter im Testmodus = keine Zusatzorte
  assert.equal(findeProgramm("brain-test-nur-extra", { PATH: "", BRAIN_TESTMODUS: "1", BRAIN_CLAUDE_EXTRA: "" }), null);
});

test("findeProgramm: übliche Orte unter dem frischen home (.local/bin, .claude/local, .opencode/bin …) und nvm, neueste Version zuerst (numerisch)", () => {
  const home = homedir();
  assert.equal(home, process.env.HOME);
  const unter = (...t) => { const o = join(home, ...t); mkdirSync(o, { recursive: true }); return o; };
  const env = { PATH: "" }; // kein Testmodus: die echten Zusatzorte (hier unter dem Wegwerf-Home)
  skript(unter(".local", "bin"), "brain-t-lokal", "echo x");
  skript(unter(".claude", "local"), "brain-t-claudelokal", "echo x");
  skript(unter(".opencode", "bin"), "brain-t-opencode", "echo x");
  skript(unter(".cursor", "bin"), "brain-t-cursor", "echo x");
  skript(unter(".bun", "bin"), "brain-t-bun", "echo x");
  skript(unter(".npm-global", "bin"), "brain-t-npm", "echo x");
  skript(unter(".volta", "bin"), "brain-t-volta", "echo x");
  skript(unter(".cargo", "bin"), "brain-t-cargo", "echo x");
  for (const [datei, ort] of [["brain-t-lokal", ".local/bin"], ["brain-t-claudelokal", ".claude/local"], ["brain-t-opencode", ".opencode/bin"],
    ["brain-t-cursor", ".cursor/bin"], ["brain-t-bun", ".bun/bin"], ["brain-t-npm", ".npm-global/bin"], ["brain-t-volta", ".volta/bin"], ["brain-t-cargo", ".cargo/bin"]]) {
    assert.equal(findeProgramm(datei, env), join(home, ort, datei), ort);
  }
  for (const v of ["v9.0.0", "v22.1.0", "v20.11.0"]) skript(unter(".nvm", "versions", "node", v, "bin"), "brain-t-nvm", `echo ${v}`);
  assert.equal(findeProgramm("brain-t-nvm", env), join(home, ".nvm", "versions", "node", "v22.1.0", "bin", "brain-t-nvm"), "v22 vor v20 vor v9, nicht nach Zeichenfolge");

  // home wird bei jedem Aufruf frisch gelesen
  const altesHome = process.env.HOME, neuesHome = tmp("brain-home2-");
  try {
    process.env.HOME = neuesHome;
    assert.equal(findeProgramm("brain-t-lokal", env), null, "im neuen Home gibt es es nicht");
    mkdirSync(join(neuesHome, ".local", "bin"), { recursive: true });
    skript(join(neuesHome, ".local", "bin"), "brain-t-lokal", "echo x");
    assert.equal(findeProgramm("brain-t-lokal", env), join(neuesHome, ".local", "bin", "brain-t-lokal"));
  } finally { process.env.HOME = altesHome; }
});

test("versionAus: Versionsnummer herausziehen, sonst erste Zeile gekürzt; stdout vor stderr; leer → null", () => {
  assert.equal(versionAus("codex-cli 0.46.0\n", ""), "0.46.0");
  assert.equal(versionAus("2.0.10 (Claude Code)\n", ""), "2.0.10");
  assert.equal(versionAus("0.8.2", ""), "0.8.2");
  assert.equal(versionAus("2025.10.02-ab12cd34\n", ""), "2025.10.02-ab12cd34");
  assert.equal(versionAus("opencode v1.2\n", ""), "1.2");
  assert.equal(versionAus("1.4.0-beta.2\nzweite Zeile 9.9.9", ""), "1.4.0-beta.2", "nur die erste Zeile zählt");
  assert.equal(versionAus("1.4.0-beta.2+build.7", ""), "1.4.0-beta.2", "die vorgegebene Regex nimmt nur einen Anhang (-beta.2), kein zweites +build");
  assert.equal(versionAus("\n\n  \n3.1.4\n", ""), "3.1.4", "führende Leerzeilen überspringen");
  assert.equal(versionAus("", "Tool 7.0.1\n"), "7.0.1", "ohne stdout: stderr");
  assert.equal(versionAus("5.5.5", "6.6.6"), "5.5.5", "stdout geht vor");
  assert.equal(versionAus("Entwicklungsstand\n", ""), "Entwicklungsstand");
  const lang = "x".repeat(100);
  assert.equal(versionAus(lang, ""), "x".repeat(60), "ohne Nummer auf 60 Zeichen gekürzt");
  assert.equal(versionAus("", ""), null);
  assert.equal(versionAus(undefined, undefined), null);
  assert.equal(versionAus("  \n \n", ""), null);
});

test("erkenneAgenten: fünf Einträge in fester Reihenfolge mit Namen; nichts gefunden → version null, pfad null", async () => {
  const leer = tmp("brain-ki-leer-");
  const { agenten } = await erkenneAgenten({ env: umgebung(leer) });
  assert.deepEqual(agenten.map((a) => a.id), IDS);
  assert.deepEqual(agenten.map((a) => a.name), ["Claude Code", "Codex", "Gemini CLI", "Cursor Agent", "OpenCode"]);
  for (const a of agenten) { assert.equal(a.version, null); assert.equal(a.pfad, null); assert.deepEqual(Object.keys(a).sort(), ["id", "name", "pfad", "version"]); }
});

test("erkenneAgenten: Pfad und Version aus --version; Reihenfolge bleibt fest, auch wenn nur manche da sind", async () => {
  const d = tmp("brain-ki-");
  skript(d, "claude", 'echo "2.0.10 (Claude Code)"');
  skript(d, "codex", 'echo "codex-cli 0.46.0"');
  skript(d, "cursor-agent", 'echo "2025.10.02-ab12cd34"');
  skript(d, "opencode", 'echo "Version nur auf stderr 1.2.3" >&2');
  const { agenten } = await erkenneAgenten({ env: umgebung(d), limit: 20_000 });
  assert.deepEqual(agenten.map((a) => a.id), IDS);
  const nach = Object.fromEntries(agenten.map((a) => [a.id, a]));
  assert.deepEqual(nach.claude, { id: "claude", name: "Claude Code", version: "2.0.10", pfad: join(d, "claude") });
  assert.equal(nach.codex.version, "0.46.0"); assert.equal(nach.codex.pfad, join(d, "codex"));
  assert.equal(nach["cursor-agent"].version, "2025.10.02-ab12cd34");
  assert.equal(nach.opencode.version, "1.2.3", "stderr, wenn stdout leer ist");
  assert.deepEqual(nach.gemini, { id: "gemini", name: "Gemini CLI", version: null, pfad: null });
});

test("erkenneAgenten: kaputtes Programm (exit 1, unmöglicher Interpreter, ohne Ausgabe) → version null, pfad bleibt, andere unberührt", async () => {
  const d = tmp("brain-ki-");
  skript(d, "claude", 'echo "kaputt 9.9.9"; echo "boom" >&2; exit 1');   // Ausgabe, aber Fehlercode: gilt nicht
  writeFileSync(join(d, "codex"), "#!/nicht/vorhanden/interpreter\n"); chmodSync(join(d, "codex"), 0o755);
  skript(d, "gemini", "exit 0");                                          // läuft, sagt aber nichts
  skript(d, "opencode", 'echo "1.0.0"');
  const { agenten } = await erkenneAgenten({ env: umgebung(d), limit: 20_000 });
  const nach = Object.fromEntries(agenten.map((a) => [a.id, a]));
  assert.deepEqual([nach.claude.version, nach.claude.pfad], [null, join(d, "claude")]);
  assert.deepEqual([nach.codex.version, nach.codex.pfad], [null, join(d, "codex")]);
  assert.deepEqual([nach.gemini.version, nach.gemini.pfad], [null, join(d, "gemini")]);
  assert.equal(nach.opencode.version, "1.0.0");
});

test("erkenneAgenten: hängendes Programm (auch mit Kindprozess) → version null in unter 2 s, pfad bleibt", async () => {
  const d = tmp("brain-ki-");
  skript(d, "claude", "/bin/sleep 30");             // sh + Kindprozess sleep, beide halten die Ausgabekanäle offen
  skript(d, "codex", "exec /bin/sleep 30");
  const t0 = Date.now();
  const { agenten } = await erkenneAgenten({ env: umgebung(d), limit: 300 });
  const dauer = Date.now() - t0;
  assert.ok(dauer < 2000, `dauerte ${dauer} ms`);
  const nach = Object.fromEntries(agenten.map((a) => [a.id, a]));
  assert.deepEqual([nach.claude.version, nach.claude.pfad], [null, join(d, "claude")]);
  assert.deepEqual([nach.codex.version, nach.codex.pfad], [null, join(d, "codex")]);
  assert.equal(agenten.length, 5, "die Liste bleibt vollständig");
  // (Dass schnelle Programme daneben ihre Version liefern, prüfen die anderen Tests mit dem normalen Limit: der erste Start frisch
  //  geschriebener Skripte dauert auf macOS durch die Systemprüfung teils mehrere hundert Millisekunden — zu viel für limit 300.)
});

test("erkenneAgenten: nach dem Zeitlimit bleibt kein Kindprozess des hängenden Programms übrig (ganze Prozessgruppe beendet)", async () => {
  const d = tmp("brain-ki-"), pidDatei = join(d, "kind.pid");
  skript(d, "claude", `[ -n "$WARM" ] && exit 0\n/bin/sleep 30 &\necho $! > "${pidDatei}"\nwait`);
  execFileSync(join(d, "claude"), [], { env: { ...process.env, WARM: "1" } }); // vorwärmen: der erste Start frisch geschriebener Skripte ist auf macOS langsam
  const { agenten } = await erkenneAgenten({ env: umgebung(d), limit: 1500 });
  assert.deepEqual([agenten[0].version, agenten[0].pfad], [null, join(d, "claude")]);
  const pid = Number(readFileSync(pidDatei, "utf8").trim());
  assert.ok(pid > 1, "das Programm hat seinen Kindprozess gestartet");
  const lebt = () => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  for (let i = 0; i < 40 && lebt(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(lebt(), false, "der Kindprozess lebt noch");
});

test("erkenneAgenten: Zwischenspeicher — zweiter Aufruf startet das Programm nicht erneut, neu:true umgeht und überschreibt ihn", async () => {
  const d = tmp("brain-ki-"), zaehler = join(d, "zaehler.txt");
  skript(d, "codex", `echo x >> "${zaehler}"\necho "codex-cli 1.0.0"`);
  const lauefe = () => (existsSync(zaehler) ? readFileSync(zaehler, "utf8").split("\n").filter(Boolean).length : 0);
  const env = umgebung(d);
  const [a1, a2] = await Promise.all([erkenneAgenten({ env, limit: 20_000 }), erkenneAgenten({ env, limit: 20_000 })]); // gleichzeitig: ein Lauf
  assert.equal(lauefe(), 1, "gleichzeitige Aufrufe teilen sich einen Lauf");
  assert.deepEqual(a1, a2);
  const b = await erkenneAgenten({ env });
  assert.equal(lauefe(), 1, "aus dem Zwischenspeicher");
  assert.deepEqual(b, a1);
  b.agenten[1].version = "verändert"; b.agenten.pop(); // Änderungen am Ergebnis dürfen den Zwischenspeicher nicht berühren
  const c = await erkenneAgenten({ env });
  assert.equal(lauefe(), 1);
  assert.deepEqual(c, a1);
  assert.equal(c.agenten.length, 5);
  // neu:true läuft wirklich neu — und schreibt den Zwischenspeicher fort
  skript(d, "codex", `echo x >> "${zaehler}"\necho "codex-cli 2.0.0"`);
  const n = await erkenneAgenten({ env, neu: true, limit: 20_000 });
  assert.equal(lauefe(), 2);
  assert.equal(n.agenten.find((a) => a.id === "codex").version, "2.0.0");
  const danach = await erkenneAgenten({ env });
  assert.equal(lauefe(), 2, "der neue Stand ist jetzt der gespeicherte");
  assert.equal(danach.agenten.find((a) => a.id === "codex").version, "2.0.0");
  // andere Suchumgebung = anderer Schlüssel: kein Treffer im Zwischenspeicher
  const anderer = tmp("brain-ki-");
  const leer = await erkenneAgenten({ env: umgebung(anderer) });
  assert.equal(leer.agenten.every((a) => a.pfad === null), true);
});
