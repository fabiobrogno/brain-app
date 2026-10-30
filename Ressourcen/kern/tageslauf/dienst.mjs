// tageslauf/dienst.mjs — „brain dienst an|aus|status" (Spec §5.1): LaunchAgent de.brain.tageslauf ruft stündlich
// `brain tageslauf --wenn-faellig --dienst`. Nur macOS.
// Programm ist der STARTER der App (Support/Kortex/bin/kortex tageslauf …): Er setzt KORTEX_KERN_PFAD und startet Node und den Kern über die festen
// Pfade bin/node und bin/kern — die plist überlebt App-Updates. Sie trägt KEINEN Vault ein: der Lauf folgt wie die Hooks dem aktiven Vault der App
// (vaults.json); ohne gültigen Vault endet er still mit Exit 0 (brain.mjs). Das Protokoll liegt im Support-Ordner der App (logs/dienst.log), nicht im Vault.
// Eine ältere plist (BRAIN_VAULT, node-start.sh, Kern-Pfad) wird von dienstAn ersetzt.
// Der Lauf gilt nur für Vaults, für die der Dienst ausdrücklich eingeschaltet wurde (dienst-merker.mjs: <Support>/dienst.json); ein später aktiv gewordener
// fremder Vault wird nie automatisch bearbeitet. `dienst an` trägt den aktuellen Vault ein, `dienst aus` löscht den Merker und die plist.
// Der Nutzer führt `brain dienst an` selbst aus — Claude ändert keine LaunchAgents (Spec §9).
// Testhaken: BRAIN_LAUNCHCTL (Ersatzprogramm, per node gestartet). Unter `node --test` (NODE_TEST_CONTEXT) ohne Ersatz:
// Fehler statt echtem launchctl.
// Claude-Profil: launchd kennt die Umgebung der Sitzung nicht. Ist beim Einrichten CLAUDE_CONFIG_DIR gesetzt, wandert genau diese
// eine Variable (ein Pfad, kein Geheimnis) in die EnvironmentVariables der plist — sonst liefe `claude -p` des Tageslaufs mit dem
// Standardprofil (~/.claude), also womöglich mit einem anderen Konto. `brain dienst status` zeigt das Profil des Dienstes.
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, realpathSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { homedir, userInfo } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nodePfad, starterPfad, supportOrdner, KernNichtStabilFehler, vaultUndRest, vaultVertraut, NICHT_VERTRAUT_TEXT } from "../pfade.mjs";
import { findeClaude } from "../ernte.mjs";
import { erlaubeVault, widerrufeAlle, dienstErlaubt } from "./dienst-merker.mjs";

export const LABEL = "de.brain.tageslauf";
export const plistPfad = ({ home = homedir() } = {}) => join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
export const dienstEingerichtet = ({ home = homedir() } = {}) => existsSync(plistPfad({ home }));
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unxml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Profilpfad für die plist: nur ein nicht leerer Text zählt; ~ und relative Pfade werden absolut (launchd hat weder ~ noch den
// Arbeitsordner dieser Sitzung). → Pfad | null (= Standardprofil).
export function profilPfad(roh = process.env.CLAUDE_CONFIG_DIR, { home = homedir() } = {}) {
  const p = typeof roh === "string" ? roh.trim() : "";
  if (!p) return null;
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

export function plistInhalt({ starter, pfad, log, profil = null }) {
  const profilZeile = typeof profil === "string" && profil.trim() ? `\n    <key>CLAUDE_CONFIG_DIR</key><string>${xml(profil)}</string>` : "";
  const arg = (a) => `    <string>${xml(a)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[starter, "tageslauf", "--wenn-faellig", "--dienst"].map(arg).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(pfad)}</string>${profilZeile}
  </dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

export function launchctl(args) {
  const ersatz = process.env.BRAIN_LAUNCHCTL;
  if (!ersatz && process.env.NODE_TEST_CONTEXT) throw new Error("echtes launchctl in Tests verboten (BRAIN_LAUNCHCTL setzen)");
  const [cmd, vor] = ersatz ? [process.execPath, [ersatz]] : ["/bin/launchctl", []];
  try { execFileSync(cmd, [...vor, ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 10000, windowsHide: true }); return true; } catch { return false; }
}
export const domain = () => `gui/${userInfo().uid}`;

// Der Inhalt der plist samt Profil – eine Stelle für „dienst an“ und für die Umstellung (P7b: Probelauf rendert nur, ohne zu schreiben und ohne launchctl).
// → { profil, text, log }
export function bauePlist({ starter, node = nodePfad(), claude = findeClaude(), profilRoh = process.env.CLAUDE_CONFIG_DIR, home = homedir(), support = supportOrdner() } = {}) {
  const profil = profilPfad(profilRoh, { home });
  const claudeDir = claude && claude.args.length === 0 ? dirname(claude.befehl) : null;
  const pfad = [...new Set([dirname(node), claudeDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean))].join(":");
  const log = join(support, "logs", "dienst.log");
  return { profil, log, text: plistInhalt({ starter, pfad, log, profil }) };
}

export function dienstAn(vault, { home = homedir(), plattform = process.platform, node = nodePfad(), claude = findeClaude(), profil: profilRoh = process.env.CLAUDE_CONFIG_DIR } = {}) {
  // Workspace-Trust (P5): der Dienst läuft nur für einen Vault, den der Nutzer als seinen bestätigt hat.
  if (!vaultVertraut(vault)) return { ok: false, nichtVertraut: true, text: NICHT_VERTRAUT_TEXT };
  if (plattform !== "darwin") return { ok: false, text: "Den Hintergrunddienst gibt es nur auf dem Mac — der Tageslauf startet dann beim Sitzungsstart, wenn er fällig ist." };
  // Der LaunchAgent zeigt auf den Starter neben dem stabilen Kern-Pfad: ohne ihn (KORTEX_KERN_PFAD) nichts eintragen, sonst bricht er beim nächsten App-Update.
  let starter;
  try { starter = starterPfad(); } catch (e) { if (e instanceof KernNichtStabilFehler) return { ok: false, nichtStabil: true, text: e.message }; throw e; }
  if (process.env.KORTEX_KERN_UNSTABIL_ERLAUBT !== "1" && !existsSync(starter)) {
    return { ok: false, nichtStabil: true, text: "Der Starter von Kortex fehlt. Öffne die Kortex-App einmal, dann wird er angelegt, und versuche es danach noch einmal." };
  }
  const { profil, text } = bauePlist({ starter, node, claude, profilRoh, home });
  mkdirSync(dirname(join(supportOrdner(), "logs", "dienst.log")), { recursive: true });
  const datei = plistPfad({ home });
  mkdirSync(dirname(datei), { recursive: true });
  if (existsSync(datei)) launchctl(["bootout", `${domain()}/${LABEL}`]);
  // Kein fester Node-Pfad und kein Vault — der Ordner des heutigen Node steht nur noch als PATH-Hinweis drin.
  writeFileSync(datei, text);
  erlaubeVault(vault);
  const ok = launchctl(["bootstrap", domain(), datei]);
  return {
    ok, ohneClaude: !claude, profil,
    text: ok ? `Hintergrunddienst an: Der Tageslauf läuft einmal am Tag, wenn der Mac am Netzteil ist und 10 Minuten ruht. Claude-Profil: ${profil || "Standardprofil"}.`
      : `Die Einstellung ist geschrieben (${datei}), aber macOS hat sie nicht geladen — „brain dienst status“ zeigt den Zustand.`,
  };
}
export function dienstAus(vault, { home = homedir() } = {}) {
  const datei = plistPfad({ home });
  widerrufeAlle(); // auch ohne plist: nie ein Merker ohne Dienst
  if (!existsSync(datei)) return { ok: true, text: "Der Hintergrunddienst war nicht eingerichtet." };
  launchctl(["bootout", `${domain()}/${LABEL}`]);
  unlinkSync(datei);
  return { ok: true, text: "Hintergrunddienst aus. Der Tageslauf startet jetzt beim Sitzungsstart, wenn er fällig ist." };
}
// Das Profil, das der Dienst tatsächlich nutzt, steht in seiner plist (nicht in der Umgebung dieser Sitzung): Pfad | null (Standardprofil).
export function profilAusPlist(datei) {
  try {
    const m = readFileSync(datei, "utf8").match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([^<]*)<\/string>/);
    return m && unxml(m[1]).trim() ? unxml(m[1]).trim() : null;
  } catch { return null; }
}
// nurLesen: kein `launchctl print` (Probelauf/Befund der Umstellung); `geladen` bleibt dann null.
export function dienstStatus(vault, { home = homedir(), nurLesen = false } = {}) {
  const eingerichtet = dienstEingerichtet({ home });
  const plist = plistPfad({ home });
  // veraltet: die plist ist noch die ältere Form (fester Vault oder node-start.sh) — „dienst an“ ersetzt sie.
  let veraltet = false;
  if (eingerichtet) { try { veraltet = /<key>BRAIN_VAULT<\/key>|node-start\.sh/.test(readFileSync(plist, "utf8")); } catch { /* unlesbar */ } }
  return { eingerichtet, geladen: nurLesen ? null : eingerichtet && launchctl(["print", `${domain()}/${LABEL}`]), plist, profil: eingerichtet ? profilAusPlist(plist) : null, veraltet, fuerVault: eingerichtet && dienstErlaubt(vault) };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  // <vault> <befehl> (so ruft brain.mjs auf) oder <befehl> mit --vault/BRAIN_VAULT/aktivem App-Vault
  const { vault, rest: [befehl = "status"] } = vaultUndRest(process.argv.slice(2), (a) => ["an", "aus", "status"].includes(a));
  if (!["an", "aus", "status"].includes(befehl)) { console.error("Nutzung: brain dienst an|aus|status"); process.exit(64); }
  if (befehl === "status") {
    const s = dienstStatus(vault, { nurLesen: process.argv.includes("--nur-lesen") });
    // --json: eine Zeile für die App (Kortex-Einrichtung); nichts davon enthält Zugangsdaten.
    if (process.argv.includes("--json")) console.log(JSON.stringify({ eingerichtet: s.eingerichtet, geladen: s.geladen, profil: s.profil, veraltet: s.veraltet, fuerDiesenVault: s.fuerVault }));
    else console.log(s.eingerichtet ? `Hintergrunddienst eingerichtet${s.geladen ? " und geladen" : ", aber nicht geladen — „brain dienst an“ erneut ausführen"}.`
      : "Hintergrunddienst ist nicht eingerichtet — der Tageslauf startet beim Sitzungsstart, wenn er fällig ist.");
    if (s.eingerichtet && !process.argv.includes("--json")) {
      console.log(`Profil: ${s.profil || "Standardprofil"}`);
      // Nur wenn DIESE Sitzung ausdrücklich ein Profil hat, das der Dienst nicht nutzt — sonst wäre der Hinweis nur Rauschen.
      const sitzung = profilPfad();
      if (sitzung && sitzung !== s.profil) console.log(`Hinweis: Diese Sitzung nutzt ein anderes Profil (${sitzung}). Der Dienst bleibt bei seinem — soll er das der Sitzung nehmen, führe „brain dienst an“ hier erneut aus.`);
    }
  } else {
    const r = befehl === "an" ? dienstAn(vault) : dienstAus(vault);
    console.log(r.text);
    if (r.ohneClaude) console.log("Hinweis: „claude“ wurde nicht gefunden — ohne claude laufen nur die Regel-Schritte.");
    process.exitCode = r.ok ? 0 : 1;
  }
}
