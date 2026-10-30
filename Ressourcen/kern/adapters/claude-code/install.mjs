#!/usr/bin/env node
// adapters/claude-code/install.mjs — Brain-Hooks in Claude Code ergänzen (fremde Hooks nie
// anfassen); ältere Brain-Einträge derselben Vault werden ersetzt bzw. entfernt (sie zeigen auf Dateien,
// die es nach dem Umzug nach adapters/claude-code/ nicht mehr gibt), idempotent, mit Backup.
// Die Hook-Befehle zeigen auf den Starter der App (`[ -x S ] && exec S hook <name> || exit 0`, siehe pfade.mjs#hookBefehl): fehlt der Starter,
// endet der Hook still mit Exit 0. Nur der Starter und der Symlink bin/kern stehen in settings.json — nie ein Versionsordner oder ein .app-Pfad.
// Nutzung: install.mjs [vault] [--claude-home <ordner>] [--ohne-statusline]
//          install.mjs --entfernen [--claude-home <ordner>]   (nimmt alle Brain-Hooks, die Statuszeile und die Brain-Befehle wieder heraus; Fremdes bleibt)
//          install.mjs --stand [--claude-home <ordner>]       (eine JSON-Zeile: was eingetragen ist; schreibt nichts)
//          install.mjs [vault] --vorschau [--claude-home <ordner>]   (rechnet die Eintragung NUR im Speicher und gibt eine JSON-Zeile aus: { eintraege: [{ereignis, aktion}], restVerweise, geaendert, … };
//                                                                       schreibt weder settings.json noch Befehle — Probelauf der Umstellung, Paket P7b)
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync, renameSync, chmodSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { vaultPfadOderEnde, kernStabilOderEnde, starterOderEnde, hookBefehl, hookNameAusBefehl, shellQuote, ALT_KIT_ORDNER } from "../../pfade.mjs";
import { nennt } from "../../umstellung/restverweise.mjs";
// Gleiche Marke wie skills-build.mjs::schreibeGeneriert — hier erneut, weil die Commands jetzt erst in
// einen Temp-Ordner gerendert und danach HIER (nicht in skills-build.mjs) ins echte Ziel platziert werden,
// damit ein fremder, nicht markierter Command vor dem Überschreiben weiter gesichert wird.
const COMMANDS_MARKER = "<!-- brain-kit -->";
function platziereCommand(ziel, inhalt) {
  if (existsSync(ziel)) {
    let alt = "";
    try { alt = readFileSync(ziel, "utf8"); } catch {}
    if (!alt.includes(COMMANDS_MARKER)) {
      const bak = `${ziel}.bak-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
      copyFileSync(ziel, bak);
      console.log(`Eigene Datei gesichert: ${bak} (ersetzt durch die Kortex-Fassung)`);
    }
  }
  writeFileSync(ziel, inhalt);
}
function aufraeumen(tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }

// Alles in EINER Funktion, strikt in zwei Phasen: Phase A liest/berechnet nur (settings.json parsen,
// neues settings-Objekt im Speicher bauen, Commands-Ziel prüfen, Commands in einen Temp-Ordner rendern) —
// schlägt IRGENDETWAS darin fehl, wurde GARANTIERT noch nichts Echtes geschrieben (weder settings.json
// noch ein fremder Command). Erst wenn Phase A komplett durchgelaufen ist, schreibt Phase B wirklich:
// zuerst die Commands (mit Fremd-Datei-Backup), dann settings.json. Schlägt etwas in Phase B fehl, ist
// das eine andere Lage (etwas kann da schon geschrieben sein) — die Meldung dort sagt das auch so.
// Der äußere try/catch ganz unten fängt jeden unerwarteten Rest ab (z. B. ein fremder Hook in unbekannter
// Form während Phase A) und meldet einen Alltagssatz statt eines Stacktrace.
// Markierung der eigenen Hook-Befehle in älterer Form (Kern-Pfad im Befehl).
const MARKER = "/adapters/claude-code/";
const HOOK_DATEIEN = ["session-start", "brain-hint", "wiki-guard", "werkzeug-protokoll", "regeln-lesen", "kompakt-sichern", "ernte-ausloeser", "sitzung-ende"];
// Eigener Eintrag (Hook oder Statuszeile), egal welcher Starter-/Kern-Ort: neue Form `… kortex' hook <name>` oder ältere Form mit Pfad nach adapters/claude-code/.
function eigenerBefehl(c) {
  if (typeof c !== "string") return false;
  const n = hookNameAusBefehl(c);
  if (n) return HOOK_DATEIEN.includes(n) || n === "statusline";
  return c.includes(MARKER) && [...HOOK_DATEIEN, "statusline"].some((d) => c.includes(`${MARKER}${d}.mjs`));
}
const eigeneStatuszeile = (c) => typeof c === "string" && (hookNameAusBefehl(c) === "statusline" || c.includes(`${MARKER}statusline.mjs`));
const zeitstempel = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
function liesSettings(datei) {
  if (!existsSync(datei)) return {};
  try { return JSON.parse(readFileSync(datei, "utf8")); }
  catch { console.error(`Die Datei ${datei} ist kein gültiges JSON — ich ändere nichts. Bitte zuerst reparieren.`); process.exit(1); }
}
// Ist settings.json ein Symlink (z. B. aus einem Dotfiles-Ordner), wird das ZIEL geändert und der Link bleibt: → aufgelöster Pfad (auch bei ins Leere zeigendem Link).
function echtesZiel(datei) {
  let p = datei;
  for (let i = 0; i < 20; i++) {
    let l;
    try { l = lstatSync(p); } catch { return p; }
    if (!l.isSymbolicLink()) return p;
    p = resolve(dirname(p), readlinkSync(p));
  }
  throw new Error("zu viele verschachtelte Links");
}
// Atomar: Temp-Datei im selben Ordner wie das (aufgelöste) Ziel, Rechte der bisherigen Datei übernehmen, dann rename — settings.json ist nie halb geschrieben und ein
// Symlink wird nicht durch eine normale Datei ersetzt. Backup der alten Fassung neben dem Pfad `datei`.
function schreibeSettings(datei, home, s) {
  mkdirSync(home, { recursive: true });
  if (existsSync(datei)) { const b = `${datei}.bak-${zeitstempel()}`; copyFileSync(datei, b); console.log(`Backup: ${b}`); }
  const ziel = echtesZiel(datei);
  mkdirSync(dirname(ziel), { recursive: true });
  const tmp = `${ziel}.tmp-${process.pid}`;
  let modus = 0o600;
  try { modus = statSync(ziel).mode & 0o777; } catch { /* neue Datei */ }
  try {
    writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: modus });
    chmodSync(tmp, modus);
    renameSync(tmp, ziel);
  } catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
}
// Brain-Befehle (Slash-Commands) tragen die Marke; fremde Dateien im Ordner bleiben.
function brainCommands(commandsZiel) {
  if (!existsSync(commandsZiel) || !statSync(commandsZiel).isDirectory()) return [];
  return readdirSync(commandsZiel).filter((n) => {
    try { return n.endsWith(".md") && readFileSync(join(commandsZiel, n), "utf8").includes(COMMANDS_MARKER); } catch { return false; }
  });
}

function entfernen(home) {
  const datei = join(home, "settings.json");
  const commandsZiel = join(home, "commands");
  const s = liesSettings(datei);
  const vorher = JSON.stringify(s);
  for (const ev of Object.keys(s.hooks && typeof s.hooks === "object" ? s.hooks : {})) {
    const liste = s.hooks[ev];
    if (!Array.isArray(liste)) continue;
    let weg = 0;
    for (const eintrag of liste) {
      if (!Array.isArray(eintrag?.hooks)) continue;
      for (let i = eintrag.hooks.length - 1; i >= 0; i--) if (eigenerBefehl(eintrag.hooks[i]?.command)) { eintrag.hooks.splice(i, 1); weg++; }
    }
    if (!weg) continue;
    for (let i = liste.length - 1; i >= 0; i--) if (Array.isArray(liste[i]?.hooks) && liste[i].hooks.length === 0) liste.splice(i, 1);
    if (liste.length === 0) delete s.hooks[ev];
    console.log(`- Hook ${ev} entfernt${weg > 1 ? ` (${weg} Einträge)` : ""}`);
  }
  if (s.hooks && typeof s.hooks === "object" && Object.keys(s.hooks).length === 0) delete s.hooks;
  if (eigeneStatuszeile(s.statusLine?.command)) { delete s.statusLine; console.log("- Statuszeile entfernt"); }
  if (JSON.stringify(s) !== vorher) {
    try { schreibeSettings(datei, home, s); } catch { console.error("Die Datei settings.json ließ sich gerade nicht schreiben — es wurde nichts geändert. Bitte versuche es noch einmal."); process.exit(1); }
  } else console.log("settings.json unverändert");
  let cmds = 0;
  for (const n of brainCommands(commandsZiel)) { try { rmSync(join(commandsZiel, n), { force: true }); cmds++; } catch { /* bleibt */ } }
  if (cmds) console.log(`- ${cmds} Kortex-Befehl${cmds === 1 ? "" : "e"} entfernt`);
}

// Stand als eine JSON-Zeile (liest nur): wie viele der Brain-Hooks eingetragen sind, ob die Statuszeile von Brain ist, wie viele Brain-Befehle da sind.
function stand(home) {
  const s = liesSettings(join(home, "settings.json"));
  let da = 0, neu = 0;
  for (const n of HOOK_DATEIEN) {
    const treffer = Object.values(s.hooks && typeof s.hooks === "object" ? s.hooks : {}).flat().flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks : []))
      .map((h) => h?.command).filter((c) => typeof c === "string" && (hookNameAusBefehl(c) === n || c.includes(`${MARKER}${n}.mjs`)));
    if (treffer.length) da++;
    if (treffer.some((c) => hookNameAusBefehl(c) === n)) neu++;
  }
  const sl = s.statusLine?.command;
  const statuszeile = !sl ? null : eigeneStatuszeile(sl) ? "brain" : "fremd";
  // „aktiv“ = alle Hooks in der neuen Form (die ältere Form mit Kern-Pfad zählt als veraltet und wird beim Einrichten ersetzt).
  console.log(JSON.stringify({ hooks: { soll: HOOK_DATEIEN.length, eingetragen: da, neueForm: neu }, statuszeile, befehle: brainCommands(join(home, "commands")).length, aktiv: neu === HOOK_DATEIEN.length }));
}

function hauptlauf() {
const A = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const home = args.includes("--claude-home") ? args[args.indexOf("--claude-home") + 1] : join(homedir(), ".claude");
const VORSCHAU = args.includes("--vorschau");
// Im Vorschau-Modus (Probelauf) wird nichts ausgegeben und nichts geschrieben: die Meldungen der Berechnung landen als Einträge in dieser Liste.
const aktionen = [];
const meld = VORSCHAU
  ? (z) => { const m = /^([~+-]) (?:Hook (\w+)|(Statusline))/.exec(String(z)); if (m) aktionen.push({ ereignis: m[2] || "statusLine", aktion: m[1] === "+" ? "neu" : m[1] === "~" ? "aktualisiert" : "entfernt" }); }
  : console.log;
if (args.includes("--entfernen")) return entfernen(home);
if (args.includes("--stand")) return stand(home);
// Der Vault (nur für die Commands und die Erkennung älterer Einträge): Argument oder --vault/BRAIN_VAULT/aktiver Vault — immer absolut und geprüft.
const vault = vaultPfadOderEnde(args[0] && !args[0].startsWith("--") ? ["", "", args[0]] : []);
// Ohne stabilen Kern-Pfad (KORTEX_KERN_PFAD) trägt der Installer nichts ein: Hooks würden beim nächsten App-Update ins Leere zeigen. Dazu gehört der Starter der App.
const KERN_STABIL = kernStabilOderEnde();
const STARTER = process.platform === "win32" ? null : starterOderEnde();
const commandsZiel = join(home, "commands");
const datei = join(home, "settings.json");

// ============================== Phase A: nur lesen/berechnen, nichts Echtes schreiben ==============

// A1: settings.json lesen + parsen — ZUERST, vor jedem Zugriff auf die Commands: ein kaputtes
// settings.json muss abbrechen, BEVOR irgendetwas anderes (auch ein fremder Command) angefasst wird.
const s = liesSettings(datei);
const vorher = JSON.stringify(s);

// A2: neues settings-Objekt komplett im Speicher berechnen (Hooks + Statusline) — s ist bis hierher nur
// ein JS-Objekt, noch keine Datei angefasst.
// Die Hook-Befehle tragen KEINEN festen Vault: die Hooks folgen zur Laufzeit dem aktiven Vault der App (vaults.json, mit Existenzprüfung in
// pfade.mjs) und beenden sich still mit Exit 0, wenn es keinen gibt. Ein fester --vault wäre nach einem Vault-Wechsel oder einer Umbenennung ein Geister-Vault.
// Kern-Pfad und Node-Starter werden POSIX-sicher in einfache Anführungszeichen gesetzt (Windows: doppelte, Vorwärts-Schrägstriche).
const KERN_FWD = KERN_STABIL.split("\\").join("/");
const pfad = (f) => shellQuote(`${KERN_FWD}/adapters/claude-code/${f}`);
// §12.1 Nr. 1 (B3): kein fester Node-Pfad in den Hooks — auf macOS/Linux sucht node-start.sh Node bei jedem Start (ein
// Node-Update bricht so keine Hooks; es findet auch das private Node im Support-Ordner der App bzw. unter ~/.brain-kit/node, das Claude Code oft nicht
// im PATH der Hooks hat). Windows behält den erkannten Pfad (kein /bin/sh).
const NODE = shellQuote(process.execPath); // nur Windows (kein /bin/sh, kein Starter): Node mit dem Kern-Pfad direkt
// macOS/Linux: der Starter-Befehl mit Stille bei fehlendem Starter (pfade.mjs#hookBefehl).
const hookCmd = (datei, args = "") => (process.platform === "win32" ? `${NODE} ${pfad(datei)}${args}` : hookBefehl(STARTER, datei.replace(/\.mjs$/, ""), args));
// Ein Eintrag je Brain-Hook. PreToolUse hat DREI eigene Einträge (wiki-guard, werkzeug-protokoll, regeln-lesen), damit
// der wiki-guard-Matcher unverändert bleibt; PreCompact sichert den Arbeitsstand (kompakt-sichern, M2a) UND startet die
// Ernte; SessionEnd startet die Ernte UND trägt die Sitzung aus .logs/laufend/ aus (sitzung-ende, M2a).
// Ruling v0.3: alle Hooks bleiben immer registriert und beenden sich selbst, wenn ihr Schalter aus ist —
// eine Klick-Änderung in der Maske schreibt settings.json nie um.
const WIKI_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
const soll = [
  { ev: "SessionStart", datei: "session-start.mjs" },
  { ev: "UserPromptSubmit", datei: "brain-hint.mjs" },
  { ev: "PreToolUse", datei: "wiki-guard.mjs", matcher: WIKI_MATCHER, altFassung: true },
  { ev: "PreToolUse", datei: "werkzeug-protokoll.mjs", matcher: "Read|mcp__.*" },
  { ev: "PreToolUse", datei: "regeln-lesen.mjs", matcher: "Read" },
  { ev: "PreCompact", datei: "kompakt-sichern.mjs" },
  { ev: "PreCompact", datei: "ernte-ausloeser.mjs", args: " --art fakt" },
  { ev: "SessionEnd", datei: "ernte-ausloeser.mjs", args: " --art fakt" },
  { ev: "SessionEnd", datei: "sitzung-ende.mjs" },
].map((e) => ({ ...e, cmd: hookCmd(e.datei, e.args || "") }));
// Bis v0.5 registrierter echo-Hinweis vor der Kompaktierung — ersetzt durch kompakt-sichern.mjs (K12) und entfernt.
const ALT_HANDOFF_ECHO = `echo 'Kontext-Kompression steht bevor: offenen Arbeitsstand sichern (Skill handoff).'`;

// Ältere Brain-Einträge derselben Vault erkennen (Migration): <vault>/<alter Kit-Ordner>/<basis>.<ext> — Stand vor dem Umzug in den
// Unterordner adapters/claude-code/ — mit oder ohne Anführungszeichen, auch in den Schreibweisen mit ~/, $HOME/ und dem aufgelösten Pfad (siehe unten).
// Einträge mit dem Pfad <vault>/<alter Kit-Ordner>/adapters/claude-code/ (Stand vor dem Kern-Umzug)
// werden unten auf den Kern der App umgestellt.
const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const vaultFwd = vault.split("\\").join("/");
// Schreibweisen des Vaults in älteren Einträgen: wie angegeben, aufgelöst (realpath, z. B. /private/var/… statt /var/…) und – liegt er unter dem Home – die
// unexpandierten Formen $HOME/…, ${HOME}/… und ~/… (Plan P7, Abschnitt 8.3, Lücke 2).
const fwdOhneEnde = (p) => String(p).split("\\").join("/").replace(/\/+$/, "");
const echterPfad = (p) => { try { return realpathSync(p); } catch { return p; } };
const vaultFormen = [...new Set([fwdOhneEnde(vaultFwd), fwdOhneEnde(echterPfad(vault))])];
const heimFormen = [...new Set([fwdOhneEnde(homedir()), fwdOhneEnde(echterPfad(homedir()))])].filter(Boolean);
const vaultAliases = [...vaultFormen];
for (const form of vaultFormen) for (const heim of heimFormen) {
  if (!form.startsWith(`${heim}/`)) continue;
  const rest = form.slice(heim.length);
  for (const a of [`$HOME${rest}`, `\${HOME}${rest}`, `~${rest}`]) if (!vaultAliases.includes(a)) vaultAliases.push(a);
}
function altMuster(basis, exts) {
  const alts = vaultAliases.map(escapeReg).join("|");
  const extAlt = exts.join("|");
  return new RegExp(`(?:^|["'\\s])(?:${alts})/${escapeReg(ALT_KIT_ORDNER)}/${basis}\\.(?:${extAlt})(?=["'\\s]|$)`);
}
const alteMuster = {
  SessionStart: altMuster("session-start", ["sh", "mjs"]),
  UserPromptSubmit: altMuster("brain-hint", ["mjs"]),
  PreToolUse: altMuster("wiki-guard", ["sh", "mjs"]),
};
const alteStatusMuster = altMuster("statusline", ["sh", "mjs"]);

s.hooks ||= {};
for (const { ev, datei: hookDatei, args: hookArgs = "", cmd, matcher, altFassung } of soll) {
  const liste = (s.hooks[ev] ||= []);
  // h.command fehlt bei fremden Hook-Formen ohne Kommandozeile (z. B. { type:"prompt", prompt:"…" } —
  // Claude Code kennt auch nicht-command-basierte Hooks). Solche Einträge sind fremd und bleiben
  // unangetastet: jeder Zugriff auf h.command ist deshalb mit typeof h.command === "string" abgesichert.
  // Eigener Eintrag = zeigt in einen adapters/claude-code/-Ordner auf genau diese Hook-Datei (mit denselben Argumenten) — gleich welcher Vault, welcher Kern-Ort
  // oder welche Quotierung drinsteht (altes <vault>/<alter Kit-Ordner>/…, früheres --vault, anderer Kern-Pfad). Fremde Hooks erfüllen das nie.
  const hookName = hookDatei.replace(/\.mjs$/, "");
  const meinEintrag = (h) => typeof h.command === "string" && ((h.command.includes(MARKER) && h.command.includes(hookDatei)) || hookNameAusBefehl(h.command) === hookName) && (!hookArgs || h.command.includes(hookArgs.trim()));
  const istAktuell = (h) => typeof h.command === "string" && h.command === cmd;
  // Eigene Einträge mit anderem Aufruf (anderer Vault/Kern-Ort, nacktes "node", altes --vault …) → auf den aktuellen Befehl heben; Dubletten desselben
  // Hooks im selben Ereignis entfernen (erster Treffer bleibt). Idempotent: ein zweiter Lauf ändert nichts.
  let gesehen = false;
  for (const eintrag of liste) {
    if (!Array.isArray(eintrag.hooks)) continue;
    for (let i = 0; i < eintrag.hooks.length; i++) {
      const h = eintrag.hooks[i];
      if (!meinEintrag(h)) continue;
      if (gesehen) { eintrag.hooks.splice(i, 1); i--; meld(`- Hook ${ev} entfernt (doppelter Eintrag)`); continue; }
      gesehen = true;
      if (h.command !== cmd) { h.command = cmd; meld(`~ Hook ${ev} aktualisiert`); }
    }
  }
  for (let i = liste.length - 1; i >= 0; i--) if (Array.isArray(liste[i].hooks) && liste[i].hooks.length === 0) liste.splice(i, 1);
  let aktuellVorhanden = liste.some(x => x.hooks?.some(istAktuell));
  // Alte Fassungen (vor dem Umzug) gab es nur für SessionStart/UserPromptSubmit und den wiki-guard.
  const alt = ev === "PreToolUse" ? (altFassung ? alteMuster.PreToolUse : null) : alteMuster[ev];
  let ersetzt = false, matcherAngepasst = false, entfernt = false;
  if (alt) {
    // Erster Treffer ohne aktuellen Eintrag wird in Ort und Stelle ersetzt (einer je Event genügt);
    // jeder weitere Treffer — auch wenn schon ein aktueller Eintrag da war — wird entfernt (die alten
    // Dateien existieren nach dem Umzug nach adapters/claude-code/ nicht mehr).
    for (const eintrag of liste) {
      if (!eintrag.hooks) continue;
      for (let i = eintrag.hooks.length - 1; i >= 0; i--) {
        const h = eintrag.hooks[i];
        if (typeof h.command !== "string" || !alt.test(h.command)) continue;
        if (!aktuellVorhanden && !ersetzt) {
          h.command = cmd;
          ersetzt = true;
          aktuellVorhanden = true;
          if (matcher && eintrag.matcher !== matcher) { eintrag.matcher = matcher; matcherAngepasst = true; }
        } else {
          eintrag.hooks.splice(i, 1);
          entfernt = true;
        }
      }
    }
    for (let i = liste.length - 1; i >= 0; i--) {
      if (liste[i].hooks && liste[i].hooks.length === 0) liste.splice(i, 1);
    }
  }
  if (ersetzt) meld(`~ Hook ${ev} ersetzt (alte Fassung${matcherAngepasst ? ", matcher angepasst" : ""})`);
  if (entfernt) meld(`- Hook ${ev} entfernt (alte Fassung)`);
  if (!aktuellVorhanden) {
    liste.push(matcher ? { matcher, hooks: [{ type: "command", command: cmd }] } : { hooks: [{ type: "command", command: cmd }] });
    meld(`+ Hook ${ev}${matcher && !altFassung ? ` (${matcher})` : ""}`);
  }
}
{
  const liste = s.hooks.PreCompact || [];
  let entfernt = false;
  for (const eintrag of liste) {
    if (!Array.isArray(eintrag.hooks)) continue;
    for (let i = eintrag.hooks.length - 1; i >= 0; i--) {
      if (eintrag.hooks[i]?.command === ALT_HANDOFF_ECHO) { eintrag.hooks.splice(i, 1); entfernt = true; }
    }
  }
  for (let i = liste.length - 1; i >= 0; i--) if (Array.isArray(liste[i].hooks) && liste[i].hooks.length === 0) liste.splice(i, 1);
  if (entfernt) meld("- Hook PreCompact entfernt (Hinweis „Skill handoff“ — ersetzt durch den Arbeitsstand)");
}
// Ist das Plugin brain-mods aktiv, zeigt dessen Brain-Band denselben Stand über dem Prompt — die Statusline wäre doppelt.
// Dann eine eigene (Brain-)Statusline entfernen und keine neu anlegen; fremde Statuslines bleiben unangetastet.
const brainModsAktiv = Object.entries(s.enabledPlugins || {}).some(([k, v]) => v === true && k.startsWith("brain-mods@"));
if (brainModsAktiv && !args.includes("--ohne-statusline")) {
  if (eigeneStatuszeile(s.statusLine?.command)) {
    delete s.statusLine; meld("- Statusline entfernt (das Band von brain-mods zeigt den Stand)");
  }
} else if (!args.includes("--ohne-statusline")) {
  const statusCmd = hookCmd("statusline.mjs");
  if (!s.statusLine) { s.statusLine = { type: "command", command: statusCmd }; meld("+ Statusline"); }
  else if (s.statusLine.command === statusCmd) { /* schon aktuell, idempotent still */ }
  else if (eigeneStatuszeile(s.statusLine.command)) { s.statusLine.command = statusCmd; meld("~ Statusline aktualisiert"); }
  else if (typeof s.statusLine.command === "string" && alteStatusMuster.test(s.statusLine.command)) { s.statusLine.command = statusCmd; meld("~ Statusline ersetzt (alte Fassung)"); }
  // Auch ruhende Terminals sollen den aktuellen Brain-Stand zeigen (Änderungen anderer Sitzungen): Claude Code
  // führt die Statusline sonst nur bei eigener Aktivität aus. Ein eigener Wert der Person bleibt unangetastet.
  if (s.statusLine?.command === statusCmd && s.statusLine.refreshInterval === undefined) {
    s.statusLine.refreshInterval = 10; meld("~ Statusline aktualisiert sich alle 10 s");
  }
  if (s.statusLine?.command !== statusCmd) meld("Statusline vorhanden, nicht geändert");
}
const geaendert = JSON.stringify(s) !== vorher;

if (VORSCHAU) {
  // Zählung der Stellen, die auch nach der Umstellung noch auf den alten Kit-Ordner zeigen (eigene Skripte, Plugins …): nur Zahlen, nie Texte.
  const zaehle = (w) => (typeof w === "string" ? (nennt(w) ? 1 : 0) : Array.isArray(w) ? w.reduce((a, x) => a + zaehle(x), 0) : w && typeof w === "object" ? Object.values(w).reduce((a, x) => a + zaehle(x), 0) : 0);
  const neueForm = soll.filter((e) => (s.hooks[e.ev] || []).some((x) => (x.hooks || []).some((h) => h.command === e.cmd))).length;
  const sl = s.statusLine?.command;
  console.log(JSON.stringify({
    vorschau: true, geaendert, eintraege: aktionen, restVerweise: zaehle(s),
    hooks: { soll: soll.length, neueForm }, statuszeile: !sl ? "keine" : sl === hookCmd("statusline.mjs") ? "neu" : eigeneStatuszeile(sl) ? "alt" : "fremd",
  }));
  return;
}

// A3: Commands-Ziel prüfen — nicht vorhanden oder ein Ordner ist in Ordnung, eine reguläre Datei nicht.
if (existsSync(commandsZiel) && !statSync(commandsZiel).isDirectory()) {
  console.error(`Der Ordner ${commandsZiel} für die Claude-Commands existiert bereits als Datei statt als Ordner — ich habe nichts an deinen Einstellungen geändert. Lösche oder benenne diese Datei um, dann noch einmal versuchen.`);
  process.exit(1);
}

// A4: Claude-Commands in einen frischen Temp-Ordner rendern (stdio abgefangen, kein roher Stacktrace
// mehr im Terminal, egal was skills-build.mjs dabei schiefgeht).
const commandsTemp = mkdtempSync(join(tmpdir(), "brain-commands-"));
let commandsAusgabe;
try {
  commandsAusgabe = execFileSync(process.execPath, [join(A, "..", "..", "skills-build.mjs"), vault, "--ziel", "claude-commands", commandsTemp], { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  aufraeumen(commandsTemp);
  console.error("Die Claude-Commands konnten nicht erzeugt werden — ich habe nichts an deinen Einstellungen geändert.");
  process.exit(1);
}

// ============================== Phase B: jetzt wirklich schreiben (Phase A ist komplett durch) ======

// B1: Commands platzieren (mit Fremd-Datei-Backup-Logik). Schlägt das fehl, ist settings.json noch
// unangetastet — das sagt die Meldung auch so (die Commands können an dieser Stelle teilweise
// geschrieben sein, darum keine pauschale "nichts geändert"-Aussage mehr).
try {
  mkdirSync(commandsZiel, { recursive: true });
  for (const name of readdirSync(commandsTemp)) platziereCommand(join(commandsZiel, name), readFileSync(join(commandsTemp, name), "utf8"));
} catch (e) {
  aufraeumen(commandsTemp);
  console.error(`Die Claude-Commands unter ${commandsZiel} ließen sich gerade nicht vollständig schreiben — settings.json wurde NICHT geändert. Bitte sag deiner KI, es noch einmal zu versuchen.`);
  process.exit(1);
}
aufraeumen(commandsTemp);
if (commandsAusgabe.trim()) console.log(commandsAusgabe.trimEnd());
console.log(`Commands: ${commandsZiel}`);

// B2: settings.json schreiben. Schlägt das fehl, sind die Commands oben bereits geschrieben — die
// Meldung sagt das ausdrücklich, statt pauschal "nichts geändert" zu behaupten.
if (geaendert) {
  try { schreibeSettings(datei, home, s); }
  catch (e) {
    console.error("Die Claude-Commands wurden aktualisiert, aber die Datei settings.json ließ sich gerade nicht schreiben — bitte sag deiner KI, es noch einmal zu versuchen.");
    process.exit(1);
  }
} else console.log("settings.json unverändert");
}

try {
  hauptlauf();
} catch (e) {
  console.error("Die Verbindung mit Claude Code ist unerwartet fehlgeschlagen — ich habe nichts an deinen Einstellungen geändert. Bitte sag deiner KI, dass die Installation hier abgebrochen ist.");
  process.exit(1);
}
