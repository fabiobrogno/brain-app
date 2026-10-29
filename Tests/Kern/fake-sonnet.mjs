#!/usr/bin/env node
// .tools/tests/fake-sonnet.mjs — Ersatz für den Sonnet-Schreibaufruf von B3 in Tests (Testhaken: ctx.claudeBefehl). Ruft NIE claude.
// - `--model haiku` → weiter an fake-claude.mjs (dieselben $FAKE_CLAUDE_*-Regeln wie im Tageslauf)
// - sonst: verlangt BRAIN_ERNTE=1 (Exit 3) und die Schutzgeländer-Argumente aus Spec §6.2 samt Härtung (Exit 4, stderr nennt, was fehlt):
//   pfadbegrenzte Rechte (Pfadregeln für DIESES cwd, nichts Nacktes erlaubt, keine Umgehung), --settings (Hooks aus, Lesen nur im
//   Arbeitsverzeichnis) und der Vault für Unterprozesse hart auf das cwd gesetzt (BRAIN_VAULT == cwd, keine weiteren BRAIN_*-Variablen).
// - $FAKE_SONNET_REGELN = JSON-Datei [{ wenn, antwort, dateien?: { "<rel. zum cwd>": "<inhalt>" | null }, anhaengen?: { rel: text },
//   aussen?: { "<absoluter pfad>": "<inhalt>" }, aussenAnhaengen?: { "<absoluter pfad>": "<text>" },
//   befehle?: [["<skript>", "arg", …]] }] — die erste Regel, deren `wenn` in Eingabe oder Systemprompt steht, schreibt
//   (null = löschen) und antwortet; `befehle` startet node mit dem Skript im cwd und mit der Umgebung dieses Aufrufs (Test des
//   gepinnten Vaults); sonst $FAKE_SONNET_STANDARD. $FAKE_SONNET_ZAEHLER: je Aufruf { cwd, system, eingabe }.
// - $FAKE_SONNET_EXIT ≠ 0 → Exit ohne Ausgabe (nach dem Zählen).
import { writeFileSync, readFileSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { sonnetRechte } from "../tageslauf/pflege-ki.mjs";

const args = process.argv.slice(2);
const wert = (flag) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };

if (wert("--model") === "haiku") {
  await import("./fake-claude.mjs");
} else {
  if (process.env.BRAIN_ERNTE !== "1") process.exit(3);
  // Werkzeuge: B3 bekommt Read,Edit,Write,Glob,Grep,Bash; der Traum (traum-ki.mjs) dieselben OHNE Bash — nichts anderes, und immer mit Rundengrenze und Dollar-Budget.
  const SOLL = {
    "--model": "sonnet",
    "--permission-mode": "dontAsk", "--setting-sources": "user", "--output-format": "json",
  };
  const fehlt = Object.entries(SOLL).filter(([f, w]) => wert(f) !== w).map(([f, w]) => `${f} ${w}`);
  if (!["Read,Edit,Write,Glob,Grep,Bash", "Read,Edit,Write,Glob,Grep"].includes(wert("--tools"))) fehlt.push("--tools Read,Edit,Write,Glob,Grep[,Bash]");
  if (!(Number(wert("--max-turns")) > 0)) fehlt.push("--max-turns");
  if (!(Number(wert("--max-budget-usd")) > 0)) fehlt.push("--max-budget-usd");
  for (const f of ["-p", "--strict-mcp-config", "--no-session-persistence"]) if (!args.includes(f)) fehlt.push(f);
  try { const m = JSON.parse(wert("--mcp-config")); if (!m || Object.keys(m.mcpServers || {}).length) fehlt.push("--mcp-config leer"); }
  catch { fehlt.push("--mcp-config"); }
  if (!String(wert("--system-prompt") || "").trim()) fehlt.push("--system-prompt");
  if (args.some((a) => /bypass|dangerously/i.test(a))) fehlt.push("keine Umgehung der Rechte");
  // Regelflaggen sind Listen (ein Argument je Regel bis zur nächsten Option) — so brauchen Pfade mit Komma/Leerzeichen kein Quoting.
  const liste = (flag) => {
    const i = args.indexOf(flag);
    const out = [];
    for (let j = i + 1; i >= 0 && j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]);
    return out;
  };
  const soll = sonnetRechte(process.cwd());
  const erlaubt = liste("--allowedTools"), verboten = liste("--disallowedTools");
  for (const r of soll.erlaubt) if (!erlaubt.includes(r)) fehlt.push(`--allowedTools ${r}`);
  for (const r of soll.verboten) if (!verboten.includes(r)) fehlt.push(`--disallowedTools ${r}`);
  if (erlaubt.some((r) => !r.includes("("))) fehlt.push("--allowedTools: nacktes Werkzeug");
  try {
    const e = JSON.parse(wert("--settings"));
    if (e.disableAllHooks !== true) fehlt.push("--settings disableAllHooks");
    if (e.permissions?.blockReadsOutsideWorkingDirectories !== true) fehlt.push("--settings blockReadsOutsideWorkingDirectories");
  } catch { fehlt.push("--settings"); }
  if (process.env.BRAIN_VAULT !== process.cwd()) fehlt.push("BRAIN_VAULT == cwd");
  const fremd = Object.keys(process.env).filter((k) => k.startsWith("BRAIN_") && !["BRAIN_ERNTE", "BRAIN_VAULT"].includes(k));
  if (fremd.length) fehlt.push(`keine weiteren BRAIN_*-Variablen (${fremd.join(",")})`);
  if (fehlt.length) { process.stderr.write(`fake-sonnet: Aufruf unvollständig: ${fehlt.join(", ")}\n`); process.exit(4); }

  const teile = [];
  for await (const c of process.stdin) teile.push(c);
  const eingabe = Buffer.concat(teile).toString("utf8");
  const system = String(wert("--system-prompt"));
  if (process.env.FAKE_SONNET_ZAEHLER) appendFileSync(process.env.FAKE_SONNET_ZAEHLER, JSON.stringify({ cwd: process.cwd(), system, eingabe, grenzen: { werkzeuge: wert("--tools"), runden: Number(wert("--max-turns")), usd: Number(wert("--max-budget-usd")) } }) + "\n");
  if (process.env.FAKE_SONNET_EXIT && process.env.FAKE_SONNET_EXIT !== "0") process.exit(Number(process.env.FAKE_SONNET_EXIT));
  let regel = null;
  if (process.env.FAKE_SONNET_REGELN) {
    const regeln = JSON.parse(readFileSync(process.env.FAKE_SONNET_REGELN, "utf8"));
    regel = regeln.find((r) => eingabe.includes(r.wenn) || system.includes(r.wenn)) || null;
  }
  const schreibe = (p, inhalt) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, inhalt); };
  for (const [rel, inhalt] of Object.entries(regel?.dateien || {})) {
    const p = join(process.cwd(), rel);
    if (inhalt === null) rmSync(p, { force: true }); else schreibe(p, inhalt);
  }
  for (const [rel, text] of Object.entries(regel?.anhaengen || {})) appendFileSync(join(process.cwd(), rel), text);
  for (const [abs, inhalt] of Object.entries(regel?.aussen || {})) schreibe(abs, inhalt);
  for (const [abs, text] of Object.entries(regel?.aussenAnhaengen || {})) appendFileSync(abs, text);
  for (const [skript, ...a] of regel?.befehle || []) spawnSync(process.execPath, [skript, ...a], { cwd: process.cwd(), env: process.env, stdio: "ignore" });
  const text = regel ? String(regel.antwort) : String(process.env.FAKE_SONNET_STANDARD ?? "");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text,
    usage: { input_tokens: Math.ceil((system.length + eingabe.length) / 4), output_tokens: Math.ceil(text.length / 4) } }));
}
