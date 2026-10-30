#!/usr/bin/env node
// Hintergrund-Teil von SessionStart (läuft als eigener, losgelöster Prozess — session-start.mjs wartet nicht
// darauf). Reihenfolge wie bisher: AGENTS.md, Index, Refresh, Suchdienst (falls eingeschaltet), Lint-Cache,
// Push, Memory-Sync (nur wenn module.claudeMemory). Fehler landen im Log, blockieren aber nie.
// Schalter (automatik): sicherungTaeglich=false → keine Sicherung.
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
// Kit-Module erst nach dieser Prüfung laden (dynamisches import) — statische Importe würden vorher ausgewertet.
import { appendFileSync, existsSync, statSync, readdirSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
const { vaultPfadOderEnde, ladeConfig, KERN } = await import("../../pfade.mjs");
const { gitBefehl } = await import("../../werkzeug.mjs");
const { leseAutomatik } = await import("../../einstellungen.mjs");
const { sicherungNoetig, merkeSicherung, aktuellerHead } = await import("../../sicherung-takt.mjs");

const TOOLS = KERN;
const V = vaultPfadOderEnde(process.argv, { still: true, kontoPruefen: false }); // vom Hook gestartet, der das Konto schon geprüft hat
const LOG = join(V, ".logs", "hooks.log");
// EIN git-Pfad für die ganze Datei — gilt auch für die Aufrufe gegen ~/.claude unten (dort geht es nur um
// den WERKZEUG-Ort, nicht um das Zielrepo).
const GIT = gitBefehl({ cfg: ladeConfig(V) });
const AUTOMATIK = leseAutomatik(V).werte;

function log(text) {
  if (!text) return;
  try { appendFileSync(LOG, text.endsWith("\n") ? text : text + "\n"); } catch {}
}
function node(script, args = []) {
  const r = spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: "utf8", windowsHide: true });
  log((r.stdout || "") + (r.stderr || ""));
  return r;
}

// AGENTS.md ist nicht getrackt (maschinenlokaler, absoluter Vault-Pfad) — jede Sitzung erzeugt sie neu
// aus der Vorlage (kit/AGENTS.md im Kern), damit sie nie veraltet oder fehlt.
node("skills-build.mjs", [V, "--ziel", "agents", join(V, "AGENTS.md")]);
node("brain-index.mjs", [V]);
node("search-refresh.mjs", [V]);

// Suchdienst (Reranker) nur, wenn eingeschaltet (hinweis.rerankSchwelle) — er verhindert Doppelstarts selbst
try {
  const cfg = ladeConfig(V);
  if (cfg.hinweis?.rerankSchwelle != null) {
    const haengtMarke = join(V, ".logs", "dienst-haengt");
    const frischHaengt = existsSync(haengtMarke) && (Date.now() - statSync(haengtMarke).mtimeMs) / 60000 < 10;
    if (!frischHaengt) {
      const kind = spawn(process.execPath, [join(TOOLS, "suchdienst.mjs"), V], { detached: true, stdio: "ignore", windowsHide: true });
      kind.unref();
    }
  }
} catch (e) { log(`Hinweis: Suchdienst-Start übersprungen (${e.message})`); }

// Lint-Cache atomar schreiben (Temp + rename statt "$$"-Suffix + mv)
try {
  mkdirSync(join(V, ".logs"), { recursive: true });
  const r = spawnSync(process.execPath, [join(TOOLS, "brain-lint.mjs"), V], { encoding: "utf8", windowsHide: true });
  log(r.stderr || "");
  const ziel = join(V, ".logs", "lint-cache.txt");
  const tmp = `${ziel}.${process.pid}`;
  writeFileSync(tmp, r.stdout || "");
  renameSync(tmp, ziel);
} catch (e) { log(`Hinweis: Lint-Cache übersprungen (${e.message})`); }

// Pflegebericht (v0.4) losgelöst vom Sitzungsstart rechnen → .logs/pflege-bericht.json; der NÄCHSTE Sitzungsstart
// liest daraus die Wochen-Zeile ohne Wartezeit (W1-Review #6). Neu gerechnet wird nur bei geändertem Vault.
if (AUTOMATIK.wochenbericht !== false) node("pflege.mjs", [V, "--cache"]);
// K15: Alltags-Wirkung einmal im Monat messen (0 Tokens, liest nur lokale Verläufe, speichert nur Zahlen) — losgelöst,
// weil das Auswerten von 30 Tagen Verlauf eine Weile dauern kann. Die Marke .logs/wirkung.laeuft verhindert Doppelläufe.
try {
  const { wirkungFaellig } = await import("../../wirkung.mjs");
  if (wirkungFaellig(V)) {
    const kind = spawn(process.execPath, [join(TOOLS, "wirkung.mjs"), V, "--speichern"], { detached: true, stdio: "ignore", windowsHide: true });
    kind.unref();
  }
} catch (e) { log(`Hinweis: Wirkungs-Messung übersprungen (${e.message})`); }

// Lernschleife (Treffsicherheit, 0 Tokens): einmal pro Woche „Frage → Seite“-Vorschläge aus Lücken/Fragespur und
// werkzeug.log. Nur mit Schalter luecken — ohne ihn gibt es keine Fragen-Stichwörter.
if (AUTOMATIK.luecken) node("lernschleife.mjs", [V, "--woche"]);

// Sicherung (ersetzt reines git push): brain backup regelt github/ordner/keins. Rückwärtskompatibel:
// fehlt backup in der Config, aber es ist bereits ein Git-Remote eingerichtet, pushen wir wie bisher
// (altes Verhalten vor dieser Sicherung-Funktion bleibt für bestehende Vaults unverändert).
// Sicherung nur bei neuem HEAD und höchstens alle 15 min (§12.1 Nr. 2). Ordner-Sicherung zusätzlich höchstens 1×/Tag:
// sonst würde bei jedem SessionStart ein neues Bundle geschrieben.
// Holen (backup.mjs#holenGedrosselt): Änderungen anderer Geräte (zum Beispiel Aufgaben vom iPhone) kommen hier an, bevor gesichert wird. Nur mit einem vom Nutzer
// bestätigten Remote, höchstens alle 10 Minuten; Fast-Forward nur bei sauberem Arbeitsbaum, sonst bleibt es bei einem Hinweis in der Menüleiste (brain status).
if (AUTOMATIK.sicherungTaeglich !== false) try {
  const { holenGedrosselt } = await import("../../backup.mjs");
  const h = holenGedrosselt(V);
  if (!["uebersprungen", "aktuell", "nicht-bestaetigt"].includes(h.art)) log(`Holen: ${h.art}${h.text ? ` — ${h.text}` : ""}`);
} catch (e) { log(`Hinweis: Holen übersprungen (${e.message})`); }

if (AUTOMATIK.sicherungTaeglich !== false) try {
  const head = aktuellerHead(V);
  const takt = sicherungNoetig(V, { head });
  if (!takt.noetig) log(`Sicherung übersprungen (${takt.grund})`);
  else {
    const cfg = ladeConfig(V);
    const { leseBackupOrdner, ortstag, sichernErgebnis } = await import("../../backup.mjs");
    const backupOrdner = leseBackupOrdner(V);
    let ok = false;
    if (
      cfg.backup?.art === "ordner" && backupOrdner &&
      existsSync(join(backupOrdner, `brain-${ortstag()}.bundle`)) // Ortszeit wie beim Anlegen des Bundles (backup.mjs), Ordner aus dem Support-Ordner
    ) {
      // heute schon gesichert — überspringen
    } else if (cfg.backup?.art === "ordner") {
      ok = node("brain.mjs", ["backup"]).status === 0;
    } else if (cfg.backup?.art === "keins") {
      ok = true; // bewusst keine Sicherung: nichts zu tun, nichts zu wiederholen
    } else {
      // Online (oder ältere Vaults ohne backup-Eintrag, aber mit Remote): erst holen und zusammenführen, dann senden (backup.mjs#abgleichen) — nur zu einem
      // vom Nutzer bestätigten Remote (ein fremder Vault kann ein origin mitbringen). Gelingt es nicht, wird der Stand nicht als gesichert gemerkt: nächster Versuch beim nächsten Start.
      const r = sichernErgebnis(V);
      if (r.art === "nicht-bestaetigt") { const { pushErlaubnis } = await import("../../backup.mjs"); log(`Push übersprungen: Remote nicht bestätigt (${pushErlaubnis(V).grund})`); }
      else log(`Sicherung: ${r.art} — ${r.text}`);
      ok = r.ok;
    }
    if (ok) merkeSicherung(V, { head: aktuellerHead(V) || head }); // nach dem Zusammenführen mit dem Server ist der HEAD ein anderer als vorher
  }
} catch (e) { log(`Hinweis: Sicherung übersprungen (${e.message})`); }

// Memory-Sync: ungesicherte Memory-Writes (auch fremder Sessions) committen + pushen — nur wenn module.claudeMemory
try {
  const cfg = ladeConfig(V);
  if (cfg.module?.claudeMemory) {
    const claudeDir = join(homedir(), ".claude");
    if (existsSync(join(claudeDir, ".git"))) {
      const projDir = join(claudeDir, "projects");
      if (existsSync(projDir)) {
        for (const proj of readdirSync(projDir)) {
          const memDir = join(projDir, proj, "memory");
          if (existsSync(memDir)) {
            const r = spawnSync(GIT, ["-C", claudeDir, "add", memDir], { encoding: "utf8", windowsHide: true });
            log((r.stdout || "") + (r.stderr || ""));
          }
        }
      }
      const diff = spawnSync(GIT, ["-C", claudeDir, "diff", "--cached", "--quiet"], { windowsHide: true });
      if (diff.status !== 0) {
        const commit = spawnSync(GIT, ["-C", claudeDir, "commit", "-qm", "auto: memory-sync (SessionStart)"], { encoding: "utf8", windowsHide: true });
        log((commit.stdout || "") + (commit.stderr || ""));
      }
      const push = spawnSync(GIT, ["-C", claudeDir, "push", "-q"], { encoding: "utf8", windowsHide: true });
      log((push.stdout || "") + (push.stderr || ""));
    }
  }
} catch (e) { log(`Hinweis: Memory-Sync übersprungen (${e.message})`); }

// Kein Update-Check mehr: Kortex aktualisiert sich selbst (Sparkle), der Kern ist Teil der App. Der Schalter updateHinweis
// bleibt als wirkungslose Einstellung erhalten, damit bestehende brain.config.json gültig bleiben.
