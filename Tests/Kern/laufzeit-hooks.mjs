// Hook-Laufzeiten (Spec §13.2, Global Constraints M2a): Prompt mit Intent-Gate und Read < 300 ms, Sitzungsstart < 1 s,
// Sitzungsende < 500 ms, PreCompact mit 40-MB-Verlauf < 5 s. Bester von drei Läufen (kalter Plattencache zählt nicht).
// Läuft über test-hook-laufzeit.sh — bewusst NICHT als test-*.mjs, damit die Commit-Prüfung (alle Unit-Tests parallel,
// 120 s) nie an Zeitgrenzen scheitert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cpSync, writeFileSync, openSync, writeSync, closeSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tempOrdner, tempVault, hook, schreibeVerlauf, nutzer, assistent, ergebnis, KIT, TEMP_HOME } from "./verlauf-fixture.mjs";

const bester = (n, f) => Math.min(...Array.from({ length: n }, () => { const r = f(); assert.equal(r.status, 0, r.stderr); return r.ms; }));

test("UserPromptSubmit mit Intent-Gate < 300 ms", () => {
  const v = tempOrdner("Brain Laufzeit");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  spawnSync(process.execPath, [join(KIT, "brain-index.mjs"), v]);
  let i = 0;
  const ms = bester(3, () => hook("brain-hint.mjs", { session_id: `lz-p${i++}`, prompt: "Ja passt, dann mach einfach weiter so" }, { vault: v }));
  assert.ok(ms < 300, `${ms} ms`);
});

test("PreToolUse Read mit 50 Regeln < 300 ms", () => {
  const v = tempVault("Brain Laufzeit");
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), "# Lektionen\n\n"
    + Array.from({ length: 50 }, (_, i) => `- **Regel ${i}** — Text ${i}.\n  Gilt für: \`*.swift\`, \`src/**/r${i}.js\`\n`).join("\n"));
  const datei = join(TEMP_HOME, "app", "A.swift");
  let i = 0;
  const ms = bester(3, () => hook("regeln-lesen.mjs", { session_id: `lz-r${i++}`, tool_name: "Read", tool_input: { file_path: datei } }, { vault: v }));
  assert.ok(ms < 300, `${ms} ms`);
});

test("SessionStart (startup, 20 frühere Verläufe) < 1 s", () => {
  const v = tempVault("Brain Laufzeit");
  const ordner = tempOrdner("Verläufe");
  for (let i = 0; i < 20; i++) schreibeVerlauf(join(ordner, `alt${i}.jsonl`), [nutzer(`Sitzung ${i}`), assistent("ok")]);
  const eigene = join(ordner, "eigene.jsonl");
  schreibeVerlauf(eigene, [nutzer("los")]);
  const ms = bester(3, () => hook("session-start.mjs", { session_id: "eigene", source: "startup", cwd: v, transcript_path: eigene },
    { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }));
  assert.ok(ms < 1000, `${ms} ms`);
});

test("SessionEnd (sitzung-ende) < 500 ms", () => {
  const v = tempVault();
  const ms = bester(3, () => hook("sitzung-ende.mjs", { session_id: "lz-e", reason: "other" }, { vault: v }));
  assert.ok(ms < 500, `${ms} ms`);
});

test("PreCompact mit 40-MB-Verlauf < 5 s", () => {
  const v = tempVault();
  const f = join(tempOrdner(), "riesig.jsonl");
  const fd = openSync(f, "w");
  writeSync(fd, JSON.stringify(nutzer("Ziel: riesige Sitzung")) + "\n");
  const block = JSON.stringify(ergebnis("t", "r".repeat(100000))) + "\n";
  for (let i = 0; i < 400; i++) writeSync(fd, block);
  writeSync(fd, JSON.stringify(nutzer("letzte Vorgabe")) + "\n");
  closeSync(fd);
  const r = hook("kompakt-sichern.mjs", { session_id: "lz-pc", transcript_path: f, cwd: v, hook_event_name: "PreCompact", trigger: "auto" }, { vault: v });
  assert.equal(r.status, 0);
  assert.ok(r.ms < 5000, `${r.ms} ms`);
  // M3: schnell UND gearbeitet — Arbeitsstand liegt da, die Lücke ist vermerkt
  const md = join(v, ".logs", "sitzungen", "lz-pc.md");
  assert.ok(existsSync(md), "Arbeitsstand wurde nicht geschrieben");
  const t = readFileSync(md, "utf8");
  assert.match(t, /letzte Vorgabe/);
  assert.match(t, /nicht ausgewertet/);
});
