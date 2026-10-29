// .tools/tests/tageslauf-hilfe.mjs — Test-Hilfen für den Tageslauf (B2). Nie echtes ~/brain, nie echtes claude/launchctl.
// Vaults liegen in tempOrdner (verlauf-fixture räumt sie beim Prozessende weg), Pfade mit Leerzeichen und Umlaut.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tempOrdner, nutzer, assistent, aufruf, ergebnis, schreibeVerlauf } from "./verlauf-fixture.mjs";
import { leseFundstelle } from "../beleg-ernte.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const KIT = join(HIER, "..");
export const FAKE = join(HIER, "fake-claude.mjs");
export const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
export const JETZT = Date.parse("2026-10-22T03:00:00Z");
const ohneGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

// Einmal je Testdatei: HOME/USERPROFILE auf Temp, Arbeitskopien in Temp, alle BRAIN_*/GIT_*/FAKE_CLAUDE_* weg.
export function isoliere() {
  const home = tempOrdner("home");
  for (const k of Object.keys(process.env)) if (/^(GIT_|BRAIN_|FAKE_CLAUDE_)/.test(k)) delete process.env[k];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, BRAIN_TAGESLAUF_CACHE: tempOrdner("caches") });
  return home;
}
export const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: ohneGit(), stdio: ["ignore", "pipe", "pipe"] }).trim();
// Wie git, aber mit festem Commit-Zeitpunkt (Autor- und Committer-Zeit): Die Regel „Seite nach dem Zitat geändert“ (R3) liest die Commit-Zeit.
export const gitAm = (cwd, zeit, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: { ...ohneGit(), GIT_AUTHOR_DATE: zeit, GIT_COMMITTER_DATE: zeit }, stdio: ["ignore", "pipe", "pipe"] }).trim();
// Der Start-Commit jedes Test-Vaults liegt VOR allen Zitaten der Tests (2026-10-xx): so gilt die Seite nicht als „nach dem Zitat geändert“.
export const ALTE_ZEIT = "2026-09-01T00:00:00Z";

export const LOG_KOPF = "# Ingest-Protokoll (append-only, neuester Eintrag oben)\n\nFormat je Lauf:\n## <YYYY-MM-DD HH:MM> — <Quelle>\n- Seiten geändert/neu: <liste>\n\n## 2026-01-01 10:00 — start\n- Seiten neu: keine\n";

export function seitenText({ fm = {}, rumpf = "" } = {}) {
  const alle = { typ: "thema", quellen: [], quellen_sha: [], rev: 1, ...fm };
  return `---\n${Object.entries(alle).map(([k, w]) => `${k}: ${typeof w === "string" ? w : JSON.stringify(w)}`).join("\n")}\n---\n${rumpf}`;
}
export function schreibeSeite(v, rel, s) {
  mkdirSync(dirname(join(v, rel)), { recursive: true });
  writeFileSync(join(v, rel), typeof s === "string" ? s : seitenText(s));
}
export function committe(v, rel, s, msg = `edit ${rel}`) {
  schreibeSeite(v, rel, s); git(v, "add", "--", rel); git(v, "commit", "-qm", msg);
}
// Wie committe, mit festem Zeitpunkt (z. B. NACH dem Zitat eines Vorschlags).
export function committeAm(v, rel, s, zeit, msg = `edit ${rel}`) {
  schreibeSeite(v, rel, s); git(v, "add", "--", rel); gitAm(v, zeit, "commit", "-qm", msg);
}

// pre-commit: „gruen" blockt nur Zeilen mit VERBOTEN, „rot" blockt alles, „echt" = Kit-commit-pruefung.mjs
// (Secrets, REV, _log append-only). Der Struktur-Lint wird per BRAIN_LINT_SKRIPT auf ein nicht vorhandenes Skript gelenkt (gilt nur unter node --test): die
// Fixture-Seiten haben absichtlich tote Platzhalter-Links; früher lief der Lint nie, weil der Test-Vault keinen Werkzeug-Ordner hatte → nur Hinweis.
const HOOKS = {
  gruen: "#!/bin/sh\nif git diff --cached -U0 | grep -q VERBOTEN; then echo '- SECRETS: Testbefund VERBOTEN'; exit 2; fi\nexit 0\n",
  rot: "#!/bin/sh\necho '- SECRETS: Testbefund'\nexit 2\n",
  echt: `#!/bin/sh\nexport BRAIN_LINT_SKRIPT="${join(KIT, "gibt-es-nicht-lint.mjs")}"\nexec "${process.execPath}" "${join(KIT, "commit-pruefung.mjs")}" "$(git rev-parse --show-toplevel)"\n`,
};
// Testvaults starten bei Autostufe „normal“ (wie vor dem Lernmodus): der Standard der Einstellung autostufeStart ist „aus“ — der erste echte Lauf ohne Zustand schriebe sonst nichts
// selbst, und jeder Test der Stufen/Übernahmen müsste es einzeln umstellen. Die Lernmodus-Tests (test-tageslauf-lernmodus.mjs) setzen autostufeStart selbst; `autostufeStart: undefined`
// im automatik-Objekt heißt „nicht setzen“ = der Standard der Einstellung.
export const START_NORMAL = { autostufeStart: "normal" };
export function neuerTestVault({ seiten = {}, automatik = { tageslauf: "an" }, hook = "gruen", config = {} } = {}) {
  const v = tempOrdner("Tages Brän");
  const cfg = { clusters: [{ id: "10_projekte" }, { id: "20_firma" }, { id: "30_wissen" }], wiki: { ordner: "09_wiki" }, ...config, automatik: { ...START_NORMAL, ...automatik } };
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg, null, 2) + "\n");
  writeFileSync(join(v, ".gitignore"), ".logs/\n00_inbox/\n90_archiv/\n");
  schreibeSeite(v, "09_wiki/_log.md", LOG_KOPF);
  for (const [rel, s] of Object.entries(seiten)) schreibeSeite(v, rel, s);
  mkdirSync(join(v, ".hooks"), { recursive: true });
  writeFileSync(join(v, ".hooks", "pre-commit"), HOOKS[hook], { mode: 0o755 });
  git(v, "init", "-q", "-b", "main");
  git(v, "config", "user.name", "Test"); git(v, "config", "user.email", "test@example.com");
  git(v, "config", "commit.gpgsign", "false");
  git(v, "add", "--", ".gitignore", "brain.config.json", ".hooks/pre-commit", "09_wiki");
  gitAm(v, ALTE_ZEIT, "commit", "-qm", "start");
  // Erst NACH dem Start-Commit aktivieren: der grüne Hook enthält das Wort VERBOTEN selbst und würde sich sonst blockieren.
  git(v, "config", "core.hooksPath", ".hooks");
  return v;
}

export function legeVorschlagAn(v, { id, art = "fakt", titel = "Titel", text = "Text.", sitzung = "s1", ordner = "/tmp/projekt",
  erstellt = "2026-10-20T10:00:00Z", unterordner = "_vorschlaege", ...felder } = {}) {
  const zeilen = ["---", "typ: vorschlag", `art: ${art}`, `titel: ${JSON.stringify(titel)}`, `quelle_ordner: ${JSON.stringify(ordner)}`,
    `quelle_sitzung: ${JSON.stringify(sitzung)}`, ...Object.entries(felder).map(([k, w]) => `${k}: ${JSON.stringify(w)}`),
    `erstellt: ${erstellt}`, "---", "", `# ${titel}`, "", text, ""];
  const dir = join(v, "00_inbox", unterordner);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), zeilen.join("\n"));
  if (felder.zitat && felder.fundstelle) ergaenzeTranskript(v, felder.fundstelle, felder.zitat);
  return join(dir, `${id}.md`);
}

// Der Richter (tageslauf/richter.mjs) liest die Sitzung zur Fundstelle: Für jeden Vorschlag mit Zitat und Fundstelle steht darum eine Nutzer-Nachricht mit dem
// Zitat (uuid und Zeit der Fundstelle) im gesicherten Transkript der Sitzung. Eine Zeile je uuid; weitere Nachrichten hängt der Test selbst an.
export function ergaenzeTranskript(v, fundstelle, text) {
  const f = leseFundstelle(fundstelle);
  if (!f || !f.sitzung || !f.uuid) return null;
  const pfad = join(v, ".logs", "transkript-sicherung", `${f.sitzung}.jsonl`);
  let alt = "";
  try { alt = readFileSync(pfad, "utf8"); } catch {}
  if (alt.includes(`"uuid":${JSON.stringify(f.uuid)}`)) return pfad;
  mkdirSync(dirname(pfad), { recursive: true });
  appendFileSync(pfad, `${JSON.stringify({ ...nutzer(String(text), { zeit: f.zeit || undefined }), uuid: f.uuid })}\n`);
  return pfad;
}

// eintraege: { du } | { ki } | { tool: "<Werkzeug>", text } | { web: "WebFetch", text } — uuid je Zeile u-<sid>-<n>.
export function legeTranskriptAn(v, sid, eintraege, { ort = "sicherung" } = {}) {
  const zeilen = [];
  let n = 0;
  const mitId = (o) => ({ ...o, uuid: `u-${sid}-${++n}` });
  for (const e of eintraege) {
    if (e.du !== undefined) zeilen.push(mitId(nutzer(e.du)));
    else if (e.ki !== undefined) zeilen.push(mitId(assistent(e.ki)));
    else { const id = `t${n}`; zeilen.push(mitId(aufruf(id, e.tool || e.web, {}))); zeilen.push(mitId(ergebnis(id, e.text))); }
  }
  const dir = ort === "sicherung" ? join(v, ".logs", "transkript-sicherung") : join(homedir(), ".claude", "projects", "-tmp-projekt");
  const pfad = join(dir, `${sid}.jsonl`);
  schreibeVerlauf(pfad, zeilen);
  return pfad;
}

// Standardantwort des Richters in den Tageslauf-Tests: alles in Ordnung. Eine eigene Regel mit `wenn` davor überstimmt sie (Regeln: die erste passende gewinnt).
export const RICHTER_OK = JSON.stringify({ gedeckt: true, dauerhaft: true, seitePasst: true, schonDrin: false, widerspricht: false, ueberholt: false, begruendung: "Standard der Testhilfe." });
export const RICHTER_KENNUNG = "Du bist der RICHTER";
export function fakeKi(regeln = [], { standard = "NICHTS", exit = 0 } = {}) {
  const d = tempOrdner("fake");
  writeFileSync(join(d, "regeln.json"), JSON.stringify([...regeln, { wenn: RICHTER_KENNUNG, antwort: RICHTER_OK }]));
  writeFileSync(join(d, "standard.txt"), standard);
  writeFileSync(join(d, "zaehler.jsonl"), "");
  Object.assign(process.env, { BRAIN_CLAUDE: FAKE, FAKE_CLAUDE_REGELN: join(d, "regeln.json"), FAKE_CLAUDE_AUSGABE: join(d, "standard.txt"),
    FAKE_CLAUDE_ZAEHLER: join(d, "zaehler.jsonl"), FAKE_CLAUDE_EXIT: String(exit) });
  const aufrufe = () => readFileSync(join(d, "zaehler.jsonl"), "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
  // haikuAnzahl: Wahl, Abgleich, Belege (Haiku); richterAnzahl: der Richter (Sonnet) — so bleiben Tests über „einen Abgleich je Fakt“ unabhängig vom Richter.
  return { aufrufe, anzahl: () => aufrufe().length, haikuAnzahl: () => aufrufe().filter((a) => a.modell !== "sonnet").length, richterAnzahl: () => aufrufe().filter((a) => a.modell === "sonnet").length };
}

// Fingerabdruck des Vaults ohne .git/.logs, plus HEAD, alle Refs und Arbeitskopien — für „Probe schreibt nichts".
export function schnappschuss(v) {
  const h = createHash("sha256");
  const lauf = (dir) => {
    for (const n of readdirSync(dir).sort()) {
      if (n === ".git" || n === ".logs") continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) lauf(p); else h.update(`${relative(v, p)}\0`).update(readFileSync(p));
    }
  };
  lauf(v);
  h.update(git(v, "rev-parse", "HEAD")).update(git(v, "for-each-ref", "--format=%(refname) %(objectname)")).update(git(v, "worktree", "list", "--porcelain"));
  return h.digest("hex");
}
