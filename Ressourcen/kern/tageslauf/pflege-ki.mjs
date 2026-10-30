// tageslauf/pflege-ki.mjs — Die KI-Wege von B3 (Spec §6.2, §7). Sonnet MIT Schreibwerkzeugen gibt es NUR hier (rufeSonnet):
// eingebaut nur Read/Edit/Write/Glob/Grep/Bash, kein Web, kein MCP, dontAsk (alles Nichtfreigegebene wird ohne Nachfrage abgelehnt),
// cwd = Pflege-Arbeitskopie außerhalb des Vaults, Umgebung gepinnt (sonnetUmgebung). Urteile ohne Werkzeuge: pflegeHaiku (rufeHaiku,
// --tools ""). Eigenes Budget je Lauf (ctx.pflegeBudget), getrennt vom B2-Budget; drei KI-Fehler in Folge → ctx.ohneKi wie in B2.
//
// Härtung — der Inhalt einer Inbox-Notiz ist DATEN, kann aber Anweisungen enthalten. Read/Edit/Write würden ohne Pfadregeln überall
// hin wirken (echter Vault: .git/config, Hooks, ggf. alter Kit-Ordner = Code beim nächsten Commit; ~/.zshrc, ~/.ssh, ~/.claude* …), an der
// Diff-Prüfung vorbei, die nur die Arbeitskopie sieht. Darum gilt (Doku-Stand Claude Code 2.1.306):
//  • Pfadregeln — https://code.claude.com/docs/en/permissions#read-and-edit : Read-/Edit-Regeln nutzen gitignore-Muster; `//pfad`
//    ist absolut ab Wurzel, `~/pfad` ab Home, ein einfaches `/pfad` NICHT absolut (ab Arbeitsverzeichnis/Settings-Quelle). Edit-Regeln
//    gelten für ALLE schreibenden Dateiwerkzeuge (Edit, Write, NotebookEdit); Pfadregeln für Write/Glob/Grep selbst prüft Claude
//    Code nie — Read(…) trägt Glob/Grep (nur nach bestem Bemühen), Edit(…) trägt Write. Bei Symlinks müssen für eine Erlaubnis
//    angefragter UND aufgelöster Pfad passen (macOS: /var → /private/var, darum beide Formen), ein Verbot greift bei einem von beiden.
//  • Vorrang — …/permissions#manage-permissions : deny → ask → allow, die erste Treffer-Regel entscheidet; ein Allow kann kein Deny
//    aufheben (darum nie ein Verbot, das die Kopie selbst trifft).
//  • dontAsk — …/permission-modes#allow-only-pre-approved-tools-with-dontask-mode : lehnt jeden Aufruf ab, der sonst nachfragen würde;
//    Schreiben in geschützte Pfade (.git, .claude, .zshrc …) ist dort stets verboten, auch mit Allow-Regel (…#protected-paths).
//  • Bash-Regeln — …/permissions#bash : `Bash(präfix *)` gilt für den Befehl samt Rest; Verkettung (&& ; |), Befehlsersetzung,
//    Variablenzuweisung davor und Umleitung auf fremde Ziele erfüllen die Regel nicht. Read-/Edit-Verbote gelten NICHT für Prozesse,
//    die Dateien selbst öffnen (node-Skripte) — deshalb nur eine lesende Suche und ein hart gepinnter Vault (sonnetUmgebung).
//  • --settings — …/settings#settings-precedence : die Kommandozeile steht über Projekt-/Nutzer-Settings. Ohne `disableAllHooks`
//    liefen Hooks aus einer `.claude/settings.json` der Kopie auch im `-p`-Lauf (Rauchtest bestätigt); `permissions.
//    blockReadsOutsideWorkingDirectories` lässt die Dateiwerkzeuge Lesen außerhalb des Arbeitsverzeichnisses verweigern.
//  • --setting-sources user (Kern-Umzug P4, Sicherheit) — …/settings#settings-precedence : Die Arbeitsverzeichnis ist die Kopie des Vaults;
//    „project“ lüde deren `.claude/settings.json` (env, apiKeyHelper, permissions, statusLine …) — Programme und Variablen aus Vault-Daten.
//    „user“ lädt nur die Einstellungen des Nutzers selbst (seine Anmeldung/sein apiKeyHelper bleiben nutzbar); die Befehlszeile
//    (--settings) steht darüber. Verzichtet wird auf die Projekt- und lokalen Einstellungen (project, local) der Kopie.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, relative, isAbsolute } from "node:path";
import { kindUmgebung, rufeHaiku, leseClaudeAntwort } from "../ernte.mjs";
import { kiBefehl, pflegeVon, KI_STUFE } from "./ki.mjs";
import { KERN, ALT_KIT_ORDNER } from "../pfade.mjs";
import { sperreAusgeschlossenes } from "./pflege-sperre.mjs";

export const SONNET_WERKZEUGE = "Read,Edit,Write,Glob,Grep,Bash";
// Das einzige freigegebene Bash-Programm: die lesende Suche. Steps 3–4 des Ingest brauchen keinen Unterbefehl zwingend (sha/index/refresh/
// lock macht das Programm selbst); `search` liest nur und schreibt höchstens .logs der Kopie. Alle anderen Unterbefehle von brain.mjs
// (hooks-install ändert die Git-Konfiguration des ECHTEN Vaults, dienst legt LaunchAgents an, backup pusht, einstellungen/import/
// tageslauf/nachernte schreiben oder starten Kindprozesse …) sind NICHT freigegeben.
// Der Kern liegt außerhalb der Arbeitskopie: der Befehl trägt seinen absoluten, gequoteten Pfad (der Vault ist über BRAIN_VAULT auf die Kopie gepinnt).
export const SONNET_BASH = [`node "${String(KERN).split("\\").join("/")}/brain.mjs" search`];
// Obergrenzen je Sonnet-Aufruf (claude 2.1.308 kennt beide Optionen: --max-turns steht nicht in --help, ist aber im Programm; --max-budget-usd schon).
export const SONNET_MAX_RUNDEN = 25, SONNET_MAX_USD = 3;
export const SONNET_EINSTELLUNGEN = { disableAllHooks: true, permissions: { blockReadsOutsideWorkingDirectories: true } };
// Bereiche der Kopie, die die KI nie ändern darf: Git-Zeiger (Worktree → echter Vault), Werkzeug-Code (läuft über Bash und beim
// Commit-Hook), Claude-Settings/MCP (Hooks, Rechte), Konfiguration.
const KOPIE_GESPERRT = [".git", ".git/**", `${ALT_KIT_ORDNER}/**`, ".claude/**", ".kortex/**", ".mcp.json", "brain.config.json"];
// Home: lesen UND schreiben verboten (Zugangsdaten) · nur schreiben verboten (Start-/Konfigurationsdateien, Code, Dienste).
const HOME_GEHEIM = [".ssh", ".aws", ".gnupg", ".config"];
const HOME_NUR_SCHREIBEN = [".claude*/**", ".claude.json*", ".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile", ".gitconfig",
  "Library/LaunchAgents/**", "Library/Application Support/Kortex/**", "Library/Application Support/Brain/**", ".brain-kit/**"];

const fwd = (p) => String(p).split("\\").join("/");
const echt = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
// Absolute Regelform: `//pfad` ab Dateisystemwurzel. Windows: C:\x → //c/x (Doku: Pfade werden vor dem Abgleich POSIX-normalisiert);
// gitignore-Zeichen im Pfad (* ? [ ]) werden maskiert, damit die Regel nur den wörtlichen Pfad trifft.
function regelPfad(p) {
  let s = fwd(p).replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`);
  s = s.replace(/[*?[\]]/g, "\\$&");
  return `//${s.replace(/^\/+/, "")}`;
}
const varianten = (p) => [...new Set([resolve(p), echt(p)])];
const istUnter = (pfad, wurzel) => { const a = fwd(pfad).replace(/\/+$/, ""), b = fwd(wurzel).replace(/\/+$/, ""); return a === b || a.startsWith(`${b}/`); };
// Liegt eine Kopie unter einem Home-Muster (z. B. `.claude*/**`)? `*` steht für beliebige Zeichen innerhalb EINES Pfadteils.
function heimTrifft(kopien, heim, muster) {
  const m = new RegExp(`^${muster.replace(/\/\*\*$/, "").split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}(?:/|$)`);
  return kopien.some((k) => { const rel = fwd(relative(heim, k)); return !isAbsolute(rel) && !rel.startsWith("..") && m.test(rel); });
}

// → { erlaubt: [Regel…], verboten: [Regel…] } — jede Regel ein Argument. Ohne Pfad der Kopie gibt es keine Pfadregeln: Fehler (fail-closed).
// sperren (optional): weitere Wurzeln, die die KI weder lesen noch schreiben darf (Traum: Gedächtnis-Wurzel, Claude-Konten).
export function sonnetRechte(kopiePfad, { vault, sperren = [] } = {}) {
  if (typeof kopiePfad !== "string" || !kopiePfad.trim()) throw new Error("Rechte brauchen den Pfad der Arbeitskopie");
  const kopien = varianten(kopiePfad);
  const erlaubt = [
    ...kopien.flatMap((k) => [`Read(${regelPfad(k)}/**)`, `Edit(${regelPfad(k)}/**)`]),
    ...SONNET_BASH.map((b) => `Bash(${b} *)`),
  ];
  const verboten = ["WebFetch", "WebSearch", ...kopien.flatMap((k) => KOPIE_GESPERRT.map((s) => `Edit(${regelPfad(k)}/${s})`))];
  // Der Kern (Code, den `brain.mjs search` ausführt) liegt außerhalb des Vaults und bleibt für die KI schreibgeschützt.
  for (const k of varianten(KERN)) if (!kopien.some((c) => istUnter(c, k))) verboten.push(`Edit(${regelPfad(k)}/**)`);
  // Ein Verbot, das die Kopie selbst träfe, würde jede Arbeit sperren (Deny schlägt Allow) → dann entfällt genau dieses.
  const trifftKopie = (wurzel) => kopien.some((k) => istUnter(k, wurzel));
  for (const w of [vault, ...sperren]) {
    if (w) for (const v of varianten(w)) if (!trifftKopie(v)) verboten.push(`Read(${regelPfad(v)}/**)`, `Edit(${regelPfad(v)}/**)`);
  }
  const heim = homedir();
  for (const n of HOME_GEHEIM) if (!heimTrifft(kopien, heim, n)) verboten.push(`Read(~/${n}/**)`, `Edit(~/${n}/**)`);
  for (const n of HOME_NUR_SCHREIBEN) if (!heimTrifft(kopien, heim, n)) verboten.push(`Edit(~/${n})`);
  if (!heimTrifft(kopien, heim, ".claude*")) verboten.push("Read(~/.claude*/.credentials.json)");
  return { erlaubt, verboten: [...new Set(verboten)] };
}

// werkzeuge/maxRunden/maxUsd: nur der Traum (traum-ki.mjs) setzt sie enger (kein Bash, 1,5 USD) — die Pfadregeln bleiben dieselben.
export function sonnetArgs(systemPrompt, kopiePfad, { vault, sperren, werkzeuge = SONNET_WERKZEUGE, maxRunden = SONNET_MAX_RUNDEN, maxUsd = SONNET_MAX_USD } = {}) {
  const { erlaubt, verboten } = sonnetRechte(kopiePfad, { vault, sperren });
  return ["-p", "--model", "sonnet", "--tools", werkzeuge, "--allowedTools", ...erlaubt, "--disallowedTools", ...verboten,
    "--max-turns", String(maxRunden), "--max-budget-usd", String(maxUsd), "--permission-mode", "dontAsk", "--settings", JSON.stringify(SONNET_EINSTELLUNGEN),
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--system-prompt", systemPrompt,
    "--no-session-persistence", "--setting-sources", "user", "--output-format", "json"];
}

// Umgebung des Sonnet-Kindes: wie kindUmgebung (BRAIN_ERNTE=1, keine Sitzungs-/GIT_-Variablen), aber der Vault HART auf die Kopie.
// Sonst träfe `node brain.mjs …` über ein geerbtes BRAIN_VAULT (Dienst/Hintergrundprozess setzen es) den ECHTEN Vault.
// Weitere BRAIN_*-Variablen (Testhaken, Pfade, Cache) bekommt das Kind nie. `env` ist die Umgebung des Pflege-Kontos (kern/pflege-konto.mjs#umgebungFuer): sie ergänzt nur CLAUDE_CONFIG_DIR, die Härtung bleibt.
export function sonnetUmgebung(kopiePfad, env = process.env) {
  const out = {};
  for (const [k, w] of Object.entries(kindUmgebung(env))) if (!k.startsWith("BRAIN_")) out[k] = w;
  out.BRAIN_ERNTE = "1";
  out.BRAIN_VAULT = echt(kopiePfad);
  return out;
}

export const PFLEGE_BUDGET = { sonnet: 3, haiku: 40, minuten: 40 };
export const SONNET_ZEITLIMIT_MS = 10 * 60000;

export function neuesPflegeBudget({ sonnet = PFLEGE_BUDGET.sonnet, haiku = PFLEGE_BUDGET.haiku, minuten = PFLEGE_BUDGET.minuten } = {}, uhr = Date.now) {
  const start = uhr();
  const n = { sonnet: 0, haiku: 0 }, max = { sonnet, haiku };
  const zeitUm = () => uhr() - start >= minuten * 60000;
  return {
    frei: (art) => !zeitUm() && n[art] < max[art],
    rest: (art) => (zeitUm() ? 0 : Math.max(0, max[art] - n[art])),
    zaehle: (art) => { n[art]++; },
    zeitUm,
    stand: () => ({ ...n, ms: uhr() - start }),
  };
}
export const pflegeBudget = (ctx) => (ctx.pflegeBudget ??= neuesPflegeBudget());

function vorab(ctx, art) {
  if (ctx.ohneKi) return { ohneKi: true };
  const b = pflegeBudget(ctx);
  if (!b.frei(art)) return { budget: true };
  const befehl = kiBefehl(ctx);
  if (!befehl) return { ohneKi: true };
  b.zaehle(art);
  (ctx.pflegeAufrufe ??= { sonnet: 0, haiku: 0 })[art]++;
  return { befehl };
}
function auswerten(ctx, r) {
  const a = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
  if (a?.tokens) {                                              // B3 getrennt von B2 (ctx.tokens): Eingabe ohne Cache / Cache-Lesen / Ausgabe
    const t = (ctx.pflegeTokens ??= { ein: 0, cache: 0, aus: 0 });
    const cache = a.tokens.cache || 0;
    t.ein += Math.max(0, a.tokens.ein - cache); t.cache += cache; t.aus += a.tokens.aus;
  }
  const fehler = r.fehler || a.fehler;
  if (fehler) {
    if (++ctx.kiFehlerFolge >= 3) { ctx.ohneKi = true; ctx.grund ||= `KI nicht erreichbar (${fehler})`; }
    return { fehler };
  }
  ctx.kiFehlerFolge = 0;
  return { text: a.text };
}

export async function rufeSonnet(ctx, { system, eingabe, cwd, zeitlimitMs = SONNET_ZEITLIMIT_MS }) {
  let args, env;
  try { args = sonnetArgs(system, cwd, { vault: ctx.vault }); env = sonnetUmgebung(cwd, pflegeVon(ctx).env); }
  catch { return { fehler: "Arbeitsverzeichnis fehlt — keine Rechte ohne Pfad" }; }     // vor dem Budget: nichts gezählt, nichts gestartet
  const v = vorab(ctx, "sonnet");
  if (!v.befehl) return v;
  const sperre = sperreAusgeschlossenes(ctx, cwd);                // W4: ausgeschlossene Themen/Ordner sind für die KI nicht lesbar
  const r = await new Promise((resolve) => {
    let kind;
    try {
      kind = execFile(v.befehl.befehl, [...v.befehl.args, ...args],
        { cwd, env, timeout: zeitlimitMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
        (err, stdout) => resolve(err
          ? { fehler: err.killed ? "Zeitlimit" : err.code === "ENOENT" ? "claude nicht startbar" : `Exit ${err.code ?? "?"}` }
          : { ausgabe: String(stdout || "") }));
    } catch { resolve({ fehler: "claude nicht startbar" }); return; }
    kind.stdin?.on("error", () => {});
    kind.stdin?.end(eingabe);
  });
  const neu = sperre.stelleHer();
  if (neu.length) ctx.pflegeGesperrtBeruehrt = [...(ctx.pflegeGesperrtBeruehrt || []), ...neu];
  return auswerten(ctx, r);
}

export async function pflegeHaiku(ctx, { system, eingabe, zweck = "pflege" }) {
  const v = vorab(ctx, "haiku");
  if (!v.befehl) return v;
  return auswerten(ctx, await rufeHaiku(v.befehl, system, eingabe, ctx.vault, { zweck: `b3${zweck}`, konto: KI_STUFE, env: pflegeVon(ctx).env }));
}

// Letztes JSON-Objekt in einem KI-Text (Sonnet schreibt oft Erklärungen davor). Kein Objekt → null.
export function letztesJson(text) {
  const t = String(text ?? "");
  const ende = t.lastIndexOf("}");
  if (ende < 0) return null;
  for (let i = t.lastIndexOf("{", ende); i >= 0; i = i > 0 ? t.lastIndexOf("{", i - 1) : -1) {
    try { const j = JSON.parse(t.slice(i, ende + 1)); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch {}
  }
  return null;
}
