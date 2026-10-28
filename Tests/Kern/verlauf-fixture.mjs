// Test-Helfer für Claude-Code-Verläufe (JSONL) und Hook-Aufrufe — KEIN Test (Name beginnt nicht mit test-).
// Baut Zeilen im Format, das Claude Code v2.1.30x schreibt (Stand 16.10.2026), plus Temp-Ordner mit Leerzeichen/Umlaut.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ZEIT = "2026-10-16T10:00:00.000Z";
export const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function nutzer(text, { zeit = ZEIT, ...felder } = {}) {
  return { type: "user", timestamp: zeit, message: { role: "user", content: text }, ...felder };
}
export function assistent(text, { zeit = ZEIT } = {}) {
  return { type: "assistant", timestamp: zeit, message: { role: "assistant", content: [{ type: "text", text }] } };
}
export function aufruf(id, name, input, { zeit = ZEIT } = {}) {
  return { type: "assistant", timestamp: zeit, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } };
}
export function ergebnis(id, text, { fehler = false, zeit = ZEIT, alsListe = false } = {}) {
  const content = alsListe ? [{ type: "text", text }] : text;
  return { type: "user", timestamp: zeit, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: fehler, content }] } };
}
export function hinweis(text, ereignis = "UserPromptSubmit") {
  return { type: "attachment", attachment: { type: "hook_success", hookEvent: ereignis, hookName: ereignis, content: text } };
}
export function kompakt(trigger = "auto") {
  return { type: "system", subtype: "compact_boundary", content: "Conversation compacted", compactMetadata: { trigger } };
}
export const kiTitel = (t) => ({ type: "ai-title", aiTitle: t });
export const eigenerTitel = (t) => ({ type: "custom-title", customTitle: t });
export const befehl = (name) => nutzer(`<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>`);

// eintraege: Objekte (→ JSON) oder rohe Zeilen (Strings, z. B. "{kaputt"). halbeZeile: unvollständige letzte Zeile.
export function schreibeVerlauf(pfad, eintraege, { halbeZeile = false } = {}) {
  mkdirSync(dirname(pfad), { recursive: true });
  const zeilen = eintraege.map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
  writeFileSync(pfad, zeilen.join("\n") + "\n" + (halbeZeile ? '{"type":"user","message":{"content":"halb' : ""));
}

// Genau EIN exit-Listener für alle Temp-Ordner (sonst MaxListeners-Warnung bei vielen Aufrufen).
const ANGELEGT = [];
process.on("exit", () => {
  for (const basis of ANGELEGT) {
    try { rmSync(basis, { recursive: true, force: true }); } catch {}
  }
});

export function tempOrdner(name = "Mein Brän") {
  const basis = mkdtempSync(join(tmpdir(), "verlauf-"));
  ANGELEGT.push(basis);
  const p = join(basis, name);
  mkdirSync(p, { recursive: true });
  return p;
}
export function tempVault(name = "Mein Brän") {
  const v = tempOrdner(name);
  writeFileSync(join(v, "brain.config.json"), "{}");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  return v;
}

// Eigenes Temp-HOME: das echte ~/.claude wird in Tests nie gelesen oder geschrieben.
export const TEMP_HOME = tempOrdner("home");
const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

// Hook-Skript aus .tools/adapters/claude-code/ mit JSON auf stdin starten. → { status, stdout, stderr, ms }
export function hook(name, eingabe, { vault, env = {} } = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(KIT, "adapters", "claude-code", name)], {
    input: typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe), encoding: "utf8", timeout: 30000,
    // QMD_BIN: nie das echte qmd — session-start startet losgelöst search-refresh, und `qmd embed` lädt mit Test-HOME das Modell (333 MB)
    // nach. setup.mjs setzt das schon für jeden Prozess; hier zusätzlich, damit auch ein nackter `node --test` nichts herunterlädt.
    env: { ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, QMD_BIN: process.env.QMD_BIN || join(KIT, "tests", "fake-qmd-cli.mjs"), ...(vault ? { BRAIN_VAULT: vault } : {}), ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", ms: Date.now() - t0 };
}
