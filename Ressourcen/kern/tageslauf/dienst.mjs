// tageslauf/dienst.mjs — „brain dienst an|aus|status" (Spec §5.1): LaunchAgent de.brain.tageslauf ruft stündlich
// `brain tageslauf --wenn-faellig --dienst`. Node- und claude-Pfad werden erkannt, nicht fest eingetragen. Nur macOS.
// Programm ist `/bin/sh node-start.sh` — Node wird bei jedem Takt neu gesucht.
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
import { nodePfad, kernStabil, KernNichtStabilFehler, vaultUndRest } from "../pfade.mjs";
import { findeClaude } from "../ernte.mjs";

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

export function plistInhalt({ starter, brain, vault, pfad, log, profil = null }) {
  const profilZeile = typeof profil === "string" && profil.trim() ? `\n    <key>CLAUDE_CONFIG_DIR</key><string>${xml(profil)}</string>` : "";
  const arg = (a) => `    <string>${xml(a)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${["/bin/sh", starter, brain, "tageslauf", "--wenn-faellig", "--dienst"].map(arg).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BRAIN_VAULT</key><string>${xml(vault)}</string>
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

function launchctl(args) {
  const ersatz = process.env.BRAIN_LAUNCHCTL;
  if (!ersatz && process.env.NODE_TEST_CONTEXT) throw new Error("echtes launchctl in Tests verboten (BRAIN_LAUNCHCTL setzen)");
  const [cmd, vor] = ersatz ? [process.execPath, [ersatz]] : ["/bin/launchctl", []];
  try { execFileSync(cmd, [...vor, ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 10000, windowsHide: true }); return true; } catch { return false; }
}
const domain = () => `gui/${userInfo().uid}`;

export function dienstAn(vault, { home = homedir(), plattform = process.platform, node = nodePfad(), claude = findeClaude(), profil: profilRoh = process.env.CLAUDE_CONFIG_DIR } = {}) {
  if (plattform !== "darwin") return { ok: false, text: "Den Hintergrunddienst gibt es nur auf dem Mac — der Tageslauf startet dann beim Sitzungsstart, wenn er fällig ist." };
  // Der LaunchAgent zeigt auf den Kern: ohne stabilen Pfad (KORTEX_KERN_PFAD) nichts eintragen, sonst bricht er beim nächsten App-Update.
  let kern;
  try { kern = kernStabil(); } catch (e) { if (e instanceof KernNichtStabilFehler) return { ok: false, nichtStabil: true, text: e.message }; throw e; }
  const profil = profilPfad(profilRoh, { home });
  const claudeDir = claude && claude.args.length === 0 ? dirname(claude.befehl) : null;
  const pfad = [...new Set([dirname(node), claudeDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean))].join(":");
  const log = join(vault, ".logs", "tageslauf", "dienst.log");
  mkdirSync(dirname(log), { recursive: true });
  const datei = plistPfad({ home });
  mkdirSync(dirname(datei), { recursive: true });
  if (existsSync(datei)) launchctl(["bootout", `${domain()}/${LABEL}`]);
  // §12.1 Nr. 1: kein fester Node-Pfad — der Ordner des heutigen Node steht nur noch als PATH-Hinweis drin.
  writeFileSync(datei, plistInhalt({ starter: join(kern, "node-start.sh"), brain: join(kern, "brain.mjs"), vault, pfad, log, profil }));
  const ok = launchctl(["bootstrap", domain(), datei]);
  return {
    ok, ohneClaude: !claude, profil,
    text: ok ? `Hintergrunddienst an: Der Tageslauf läuft einmal am Tag, wenn der Mac am Netzteil ist und 10 Minuten ruht. Claude-Profil: ${profil || "Standardprofil"}.`
      : `Die Einstellung ist geschrieben (${datei}), aber macOS hat sie nicht geladen — „brain dienst status“ zeigt den Zustand.`,
  };
}
export function dienstAus(vault, { home = homedir() } = {}) {
  const datei = plistPfad({ home });
  if (!existsSync(datei)) return { ok: true, text: "Der Hintergrunddienst war nicht eingerichtet." };
  launchctl(["bootout", `${domain()}/${LABEL}`]);
  unlinkSync(datei);
  return { ok: true, text: "Hintergrunddienst aus. Der Tageslauf startet jetzt beim Sitzungsstart, wenn er fällig ist." };
}
// Das Profil, das der Dienst tatsächlich nutzt, steht in seiner plist (nicht in der Umgebung dieser Sitzung): Pfad | null (Standardprofil).
function profilAusPlist(datei) {
  try {
    const m = readFileSync(datei, "utf8").match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([^<]*)<\/string>/);
    return m && unxml(m[1]).trim() ? unxml(m[1]).trim() : null;
  } catch { return null; }
}
export function dienstStatus(vault, { home = homedir() } = {}) {
  const eingerichtet = dienstEingerichtet({ home });
  const plist = plistPfad({ home });
  return { eingerichtet, geladen: eingerichtet && launchctl(["print", `${domain()}/${LABEL}`]), plist, profil: eingerichtet ? profilAusPlist(plist) : null };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  // <vault> <befehl> (so ruft brain.mjs auf) oder <befehl> mit --vault/BRAIN_VAULT/aktivem App-Vault
  const { vault, rest: [befehl = "status"] } = vaultUndRest(process.argv.slice(2), (a) => ["an", "aus", "status"].includes(a));
  if (!["an", "aus", "status"].includes(befehl)) { console.error("Nutzung: brain dienst an|aus|status"); process.exit(64); }
  if (befehl === "status") {
    const s = dienstStatus(vault);
    console.log(s.eingerichtet ? `Hintergrunddienst eingerichtet${s.geladen ? " und geladen" : ", aber nicht geladen — „brain dienst an“ erneut ausführen"}.`
      : "Hintergrunddienst ist nicht eingerichtet — der Tageslauf startet beim Sitzungsstart, wenn er fällig ist.");
    if (s.eingerichtet) {
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
