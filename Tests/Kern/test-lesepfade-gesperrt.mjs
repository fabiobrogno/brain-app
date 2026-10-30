// Regressionstest „jeder Lesepfad gegen gesperrt“ (Sicherheitsreview P1+P2): Es gibt im Kern vier Wege, auf denen Vault-Inhalt zu einer KI gelangt — Hooks (Hinweise, Sitzungsstart, Statuszeile,
// Ernte), MCP-Server (eigener Test: Tests/Node/ki-konten-mcp.test.mjs, ki-konten-haertung.test.mjs), Tageslauf/Pflege/Traum (claude -p mit dem Konto des Dienstes) und der Gedächtnis-Abgleich.
// Dieser Test hält fest, dass JEDE Stelle, die `claude` startet oder Projekt-Gedächtnis verteilt, die Konten-Prüfung benutzt (ein neuer Weg ohne Prüfung macht ihn rot), und dass die Prüfungen
// für jeden Zustand, der nichts öffnen darf (gesperrt, lesen/posteingang bei „erweitert“, unbekanntes Konto, beschädigte oder gelöschte Liste), verweigern. Nur Wegwerf-Orte, kein claude-Aufruf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const KERN = join(HIER, "..");
const temp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const kennung = (p) => { const st = statSync(p); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; };

// Die Prozess-Umgebung bestimmt, was kontoStufe liest (BRAIN_TESTMODUS: nur der übergebene Support-Ordner). Dieser Test setzt sie für sich und stellt sie wieder her.
const merke = { BRAIN_TESTMODUS: process.env.BRAIN_TESTMODUS, BRAIN_APP_SUPPORT: process.env.BRAIN_APP_SUPPORT, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
process.env.BRAIN_TESTMODUS = "1"; delete process.env.CLAUDE_CONFIG_DIR;
process.on("exit", () => { for (const [k, v] of Object.entries(merke)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const P = await import(join(KERN, "pfade.mjs"));
const K = await import(join(KERN, "ki-konten.mjs"));

const home = temp("lese-home-");
const profil = (n) => { const p = join(home, n); mkdirSync(p, { recursive: true }); return realpathSync(p); };
const a = profil(".claude-a"), fremd = profil(".claude-fremd");

function aufbau(stufe, { zustand = "ok" } = {}) {
  const support = temp("lese-support-");
  const vault = temp("lese-vault-"); writeFileSync(join(vault, "brain.config.json"), "{}");
  const liste = { version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, name: "A", ordnerKennung: kennung(a) } },
    vaults: { [vault]: { ordnerKennung: kennung(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufe } } } };
  const datei = join(support, "ki-konten.json");
  if (zustand === "ok") writeFileSync(datei, JSON.stringify(liste));
  else if (zustand === "defekt") writeFileSync(datei, "{ kaputt");
  else if (zustand === "geloescht") { writeFileSync(datei, JSON.stringify(liste)); writeFileSync(join(support, K.SPUR_DATEI), ""); rmSync(datei); }
  return { support, vault };
}
const hookStufe = (s, env) => P.kontoDarf(s.vault, "lesen", { support: s.support, env });
const pflegeDarf = (s, env) => { process.env.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR; try { return P.kiKontoDarf(s.vault, "erweitert", { support: s.support }); } finally { delete process.env.CLAUDE_CONFIG_DIR; } };

test("Zustände, die nichts öffnen dürfen: Hooks (lesen) und Pflege/Tageslauf (erweitert) verweigern — gesperrt, unbekanntes Konto, beschädigte und gelöschte Liste", () => {
  for (const [name, s, env] of [
    ["gesperrt", aufbau("gesperrt"), { CLAUDE_CONFIG_DIR: a }],
    ["unbekanntes Konto", aufbau("erweitert"), { CLAUDE_CONFIG_DIR: fremd }],
    ["beschädigte Liste", aufbau("erweitert", { zustand: "defekt" }), { CLAUDE_CONFIG_DIR: a }],
    ["gelöschte Liste", aufbau("erweitert", { zustand: "geloescht" }), { CLAUDE_CONFIG_DIR: a }],
  ]) {
    assert.equal(hookStufe(s, env), false, `Hooks: ${name}`);
    assert.equal(pflegeDarf(s, env), false, `Pflege: ${name}`);
  }
});

test("Stufen: lesen und posteingang öffnen die Hooks, aber nicht die KI-Pflege (die braucht „erweitert“); erweitert öffnet beides", () => {
  const env = { CLAUDE_CONFIG_DIR: a };
  for (const [stufe, hooks, pflege] of [["lesen", true, false], ["posteingang", true, false], ["erweitert", true, true]]) {
    const s = aufbau(stufe);
    assert.equal(hookStufe(s, env), hooks, `Hooks bei ${stufe}`);
    assert.equal(pflegeDarf(s, env), pflege, `Pflege bei ${stufe}`);
  }
});

test("Jede Stelle im Kern, die claude für Vault-Inhalt startet oder Projekt-Gedächtnis verteilt, benutzt die Konten-Prüfung (neuer Weg ohne Prüfung → rot)", () => {
  const MUSS = {
    "tageslauf.mjs": /kiKontoDarf|kiBefehl|kiKontoErlaubt/, "tageslauf/ki.mjs": /kiKontoDarf/, "tageslauf/pflege-ki.mjs": /kiBefehl|kiKontoErlaubt|kiKontoDarf/, "tageslauf/traum-ki.mjs": /kiBefehl|kiKontoErlaubt|kiKontoDarf/,
    "pflegelauf.mjs": /kiKontoDarf|kiKontoErlaubt/, "antwort-messlatte.mjs": /kiKontoDarf|kiKontoErlaubt/, "lektionen.mjs": /kiKontoDarf|kiStufe/, "ernte.mjs": /kiKontoDarf|kontoDarf/, "nachernte.mjs": /kiKontoDarf|kontoDarf/,
    "gedaechtnis.mjs": /kontoStufe|baueKontoPruefung/, "adapters/claude-code/ernte-ausloeser.mjs": /kontoDarf/, "adapters/claude-code/wiki-guard.mjs": /kontoDarf/,
  };
  for (const [datei, muster] of Object.entries(MUSS)) assert.match(readFileSync(join(KERN, datei), "utf8"), muster, `${datei} prüft das KI-Konto`);
  // und: alle Hooks laufen über vaultPfadOderEnde mit Kontoprüfung (still) — pfade.mjs
  assert.match(readFileSync(join(KERN, "pfade.mjs"), "utf8"), /kontoDarf\(v, opt\.mindest \|\| "lesen", opt\)/);
});
