// Aktivitätsprotokoll (P8a) im Kern: Abweisungen der Hooks (Schreiben und Lesen in einem für das Konto gesperrten Vault, mit und ohne Leseverbot), Pflege fertig/fehlgeschlagen
// und die Online-Sicherung. Protokoll: <support>/aktivitaet/<Kennung>.jsonl (aktivitaet.mjs). Ein Hook, der nur nichts liefert, ist KEIN Zugriffsversuch und steht nicht darin.
// Alles in Wegwerf-Ordnern; jede Kindprozess-Umgebung kommt aus baueTestUmgebung (nie ...process.env).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { baueTestUmgebung } from "./konto-hilfe.mjs";

process.env.BRAIN_TESTMODUS = "1";
const HIER = dirname(fileURLToPath(import.meta.url));
const KERN = join(HIER, "..");
const ADAPTER = join(KERN, "adapters", "claude-code");
const temp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const kennung = (p) => { const st = statSync(p); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; };
const HOME = temp("akt-kern-home-"), LEER_PATH = temp("akt-kern-path-");
const PROFIL = join(HOME, ".claude-a"); mkdirSync(PROFIL, { recursive: true });
const PROFIL_A = realpathSync(PROFIL);
const A = await import(join(KERN, "aktivitaet.mjs"));

function szenario(stufe = "gesperrt") {
  const support = temp("akt-kern-support-"), vault = temp("akt-kern-vault-");
  writeFileSync(join(vault, "brain.config.json"), "{}");
  mkdirSync(join(vault, "09_wiki"));
  writeFileSync(join(vault, "09_wiki", "seite.md"), "# Seite\n\nInhalt.\n");
  const liste = (s = stufe) => writeFileSync(join(support, "ki-konten.json"), JSON.stringify({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: PROFIL_A, standard: false, name: "Privat", ordnerKennung: kennung(PROFIL_A) } },
    vaults: { [vault]: { ordnerKennung: kennung(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: s } } } }));
  liste();
  return { support, vault, liste, ereignisse: () => A.leseEreignisse(support, A.kennungVault(vault)) };
}
const umgebung = (s, extra = {}) => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: s.support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_EINMAL: "aus", BRAIN_VAULT: s.vault,
  PATH: LEER_PATH, CLAUDE_CONFIG_DIR: PROFIL_A, ...extra });
const hook = (n, s, eingabe, args = ["--konto", "k_aaaaaaaa"]) => {
  const r = spawnSync(process.execPath, [join(ADAPTER, `${n}.mjs`), ...args], { input: JSON.stringify(eingabe), env: umgebung(s), encoding: "utf8", cwd: s.vault, timeout: 30000 });
  return { code: r.status, aus: r.stdout, fehler: r.stderr };
};

test("wiki-guard: Schreiben in einen für das Konto gesperrten Vault wird verweigert UND steht als Abweisung im Protokoll (gedrosselt, kein Inhalt)", () => {
  const s = szenario("gesperrt");
  const ein = { tool_name: "Write", tool_input: { file_path: join(s.vault, "09_wiki", "neu.md"), content: "GEHEIMER-INHALT-4711" }, cwd: s.vault };
  const r = hook("wiki-guard", s, ein);
  assert.equal(r.code, 2, r.fehler); assert.match(r.fehler, /nicht freigegeben/);
  const [e] = s.ereignisse();
  assert.equal(e.art, "abweisung"); assert.equal(e.grund, "gesperrt"); assert.equal(e.konto, "k_aaaaaaaa"); assert.equal(e.programm, "claude"); assert.equal(e.wer, "Claude Code · Privat");
  assert.match(e.text, /wollte im Vault „.+“ schreiben und wurde abgewiesen\. Stufe „Gesperrt“ hat gewirkt\./);
  assert.ok(!readFileSync(A.ereignisDatei(s.support, A.kennungVault(s.vault)), "utf8").includes("GEHEIMER"));
  assert.equal(hook("wiki-guard", s, ein).code, 2);
  assert.equal(s.ereignisse().length, 1, "die Wiederholung wird gedrosselt");
  // außerhalb des Vaults: nichts
  const aus = hook("wiki-guard", s, { tool_name: "Write", tool_input: { file_path: join(HOME, "etwas.md") }, cwd: HOME });
  assert.equal(aus.code, 0); assert.equal(s.ereignisse().length, 1);
});

test("wiki-guard: ein Konto mit Stufe bekommt keine Abweisung (auch nicht für den Riegel des Wikis, der aus anderem Grund blockt)", () => {
  const s = szenario("posteingang");
  const r = hook("wiki-guard", s, { tool_name: "Write", tool_input: { file_path: join(s.vault, "09_wiki", "neu.md") }, cwd: s.vault });
  assert.equal(r.code, 2, "das Wiki ist ohne /ingest zu"); assert.deepEqual(s.ereignisse(), []);
});

test("werkzeug-protokoll: Read einer Datei im gesperrten Vault → Abweisung „gesperrt“; mit Leseverbot im Profil → „leseverbot“; Read außerhalb oder Konto mit Stufe → nichts", () => {
  const s = szenario("gesperrt");
  const lese = (datei) => hook("werkzeug-protokoll", s, { session_id: "s1", tool_name: "Read", tool_input: { file_path: datei }, tool_use_id: `id-${Math.random()}`, cwd: s.vault });
  assert.equal(lese(join(HOME, "irgendwo.md")).code, 0); assert.deepEqual(s.ereignisse(), []);
  const r = lese(join(s.vault, "09_wiki", "seite.md"));
  assert.equal(r.code, 0); assert.equal(r.aus, ""); assert.equal(r.fehler, "");
  let e = s.ereignisse();
  assert.equal(e.length, 1); assert.equal(e[0].grund, "gesperrt"); assert.match(e[0].text, /wollte den Vault „.+“ lesen und wurde abgewiesen\. Stufe „Gesperrt“ hat gewirkt\./);
  // Leseverbot: die Regel steht in den Einstellungen des Profils (gemeinsam/claude-sperre.mjs: Read(//<vault>/**))
  const s2 = szenario("gesperrt");
  writeFileSync(join(PROFIL_A, "settings.json"), JSON.stringify({ permissions: { deny: [`Read(//${s2.vault.replace(/^\/+/, "")}/**)`] } }));
  const r2 = hook("werkzeug-protokoll", s2, { session_id: "s2", tool_name: "Read", tool_input: { file_path: join(s2.vault, "09_wiki", "seite.md") }, tool_use_id: "x2", cwd: s2.vault });
  assert.equal(r2.code, 0);
  e = s2.ereignisse();
  assert.equal(e.length, 1); assert.equal(e[0].grund, "leseverbot"); assert.match(e[0].text, /Das Leseverbot hat gewirkt\./);
  writeFileSync(join(PROFIL_A, "settings.json"), "{}");
  // Konto mit Stufe: kein Ereignis
  const s3 = szenario("lesen");
  hook("werkzeug-protokoll", s3, { session_id: "s3", tool_name: "Read", tool_input: { file_path: join(s3.vault, "09_wiki", "seite.md") }, tool_use_id: "x3", cwd: s3.vault });
  assert.deepEqual(s3.ereignisse(), []);
});

test("Hooks, die für ein gesperrtes Konto nur nichts liefern (Sitzungsstart, Hinweis), sind kein Zugriffsversuch: kein Ereignis", () => {
  const s = szenario("gesperrt");
  for (const n of ["session-start", "brain-hint", "statusline", "sitzung-ende"]) {
    const r = hook(n, s, { session_id: `s-${n}`, prompt: "Wie ist der Stand?", cwd: HOME, hook_event_name: "UserPromptSubmit" }, ["--konto", "k_aaaaaaaa"]);
    assert.equal(r.code, 0, `${n}: ${r.fehler}`);
  }
  assert.deepEqual(s.ereignisse(), []);
});

test("Pflege: ein erfolgreicher Lauf wird „Pflege fertig“ (nur Zahlen), ein Lauf ohne KI oder mit Fehler „pflege-fehler“ mit dem Satz des Kerns — nie ein Titel", async () => {
  const s = szenario("erweitert");
  process.env.BRAIN_APP_SUPPORT = s.support;
  const { meldePflege } = await import(join(KERN, "tageslauf.mjs"));
  meldePflege(s.vault, { status: "ok", erfolgreich: true, z: { uebernommen: 3, rueckfragen: 1 }, grund: null });
  meldePflege(s.vault, { status: "ohne-ki", erfolgreich: false, z: { uebernommen: 0, rueckfragen: 0 }, grund: "Konto muss sich neu anmelden" });
  const [ok, fehler] = s.ereignisse();
  assert.equal(ok.art, "pflege"); assert.equal(ok.text, "Pflege fertig: 3 Änderungen übernommen, 1 Rückfrage wartet.");
  assert.equal(fehler.art, "pflege-fehler"); assert.equal(fehler.grund, "ohne-ki"); assert.match(fehler.text, /Die Pflege lief nicht ganz durch: Konto muss sich neu anmelden\./);
  assert.equal(ok.wer, undefined, "Systemereignis: kein Handelnder, der Text ist ein ganzer Satz");
});

test("Online-Sicherung: ein fehlender Sicherungsordner steht als „sicherung-fehler“ im Protokoll (gedrosselt)", async () => {
  const s = szenario("erweitert");
  process.env.BRAIN_APP_SUPPORT = s.support;
  const nichtDa = join(temp("akt-kern-ordner-"), "weg");
  writeFileSync(join(s.vault, "brain.config.json"), JSON.stringify({ backup: { art: "ordner" } }));
  const B = await import(join(KERN, "backup.mjs"));
  mkdirSync(join(s.support, "backup"), { recursive: true });
  writeFileSync(B.merkerDateiFuer(s.vault, s.support), JSON.stringify({ pfad: nichtDa }) + "\n");
  const r1 = B.sichernErgebnis(s.vault), r2 = B.sichernErgebnis(s.vault);
  assert.equal(r1.art, "ordner-fehlt"); assert.equal(r2.art, "ordner-fehlt");
  const e = s.ereignisse();
  assert.equal(e.length, 1); assert.equal(e[0].art, "sicherung-fehler"); assert.equal(e[0].grund, "ordner-fehlt"); assert.ok(!e[0].text.includes(nichtDa), "kein Pfad im Satz");
});
