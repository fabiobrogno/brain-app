#!/usr/bin/env node
// Aktiviert die Brain-Git-Hooks des Kerns (core.hooksPath = <Kern>/git-hooks, absolut) — idempotent, gilt für alle Sessions/Worktrees.
// Nutzung: node install-git-hooks.mjs [vault] [--ersetzen]   (oder --vault <pfad>, BRAIN_VAULT, aktiver Vault der App)
//          node install-git-hooks.mjs [vault] --aus          (nimmt core.hooksPath wieder heraus, aber nur, wenn er zu Kortex gehört)
//          node install-git-hooks.mjs [vault] --stand        (eine JSON-Zeile, schreibt nichts)
// Der Eintrag zeigt auf den stabilen Kern-Pfad (Symlink bin/kern), nie auf einen Versionsordner: er überlebt App-Updates.
// Hat der Vault schon einen anderen core.hooksPath (z. B. von einem anderen Werkzeug), wird er NICHT überschrieben (Exit 4), außer mit --ersetzen.
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { vaultPfadOderEnde, vertrauterVaultOderEnde, ladeConfig, kernStabilOderEnde, stabilerKern, KERN, ALT_KIT_ORDNER } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";

const args = process.argv.slice(2);
const V = vertrauterVaultOderEnde(vaultPfadOderEnde()); // Workspace-Trust (P5): core.hooksPath setzt nur in einem bestätigten Vault
const GIT = gitBefehl({ cfg: ladeConfig(V) });
const fwd = (p) => String(p).split("\\").join("/");
const git = (...a) => execFileSync(GIT, ["-C", V, ...a], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
// Der Kern-Pfad, den der Eintrag haben soll (nur die Testumgebung darf den tatsächlichen Ort nehmen); null = es gibt keinen.
const sollKern = () => stabilerKern() || (process.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" ? KERN : null);
const lies =() => { try { return git("config", "--local", "core.hooksPath"); } catch { return ""; } };

// Gehört der Eintrag zu Kortex? Der stabile Pfad, ein früherer Kern-Ort (…/bin/kern/git-hooks, …/kern/<Version>/git-hooks) oder der alte Kit-Ordner im Vault –
// in der absoluten Form und in der relativen Form, die das Kit selbst eintrug (<Kit-Ordner>/git-hooks; Plan P7, Abschnitt 8.3, Lücke 1).
function istKortex(wert, stabil) {
  const w = fwd(wert).replace(/\/+$/, "");
  if (!w) return false;
  if (stabil && w === fwd(join(stabil, "git-hooks"))) return true;
  return /\/Application Support\/(?:Kortex|Brain)\/(?:bin\/kern|kern\/[^/]+)\/git-hooks$/.test(w)
    || w === `${ALT_KIT_ORDNER}/git-hooks` || w === `./${ALT_KIT_ORDNER}/git-hooks`
    || w === `${fwd(V)}/${ALT_KIT_ORDNER}/git-hooks` || w.endsWith(`/${ALT_KIT_ORDNER}/git-hooks`);
}

if (args.includes("--stand")) {
  const stabil = sollKern();
  const wert = lies();
  console.log(JSON.stringify({ aktiv: !!stabil && !!wert && fwd(wert) === fwd(join(stabil, "git-hooks")),hooksPath: wert || null, eigener: istKortex(wert, stabil), fremder: !!wert && !istKortex(wert, stabil) }));
} else if (args.includes("--aus")) {
  const wert = lies();
  if (!wert) console.log("Die Git-Prüfung war nicht eingeschaltet.");
  else if (!istKortex(wert, sollKern())) console.log(`Der Git-Hook-Ordner (${wert}) gehört nicht zu Kortex — ich lasse ihn unverändert.`);
  else { git("config", "--local", "--unset", "core.hooksPath"); console.log("Kortex-Hooks aus: core.hooksPath entfernt."); }
} else {
  // Ohne stabilen Kern-Pfad (KORTEX_KERN_PFAD) wird nichts eingetragen: Exit 3 mit klarer Meldung.
  const HOOKS = join(kernStabilOderEnde(), "git-hooks");
  const bisher = lies();
  if (bisher && !istKortex(bisher, sollKern()) && fwd(bisher) !== fwd(HOOKS) && !args.includes("--ersetzen")) {
    console.error(`In diesem Vault ist schon ein anderer Git-Hook-Ordner eingetragen (${bisher}). Ich ändere ihn nicht. Zum Ersetzen: --ersetzen.`);
    process.exit(4);
  }
  if (process.platform !== "win32") {
    try { chmodSync(join(HOOKS, "pre-commit"), 0o755); } catch { /* schreibgeschützter Kern (App-Bundle): der Hook ist dort schon ausführbar */ }
  }
  execFileSync(GIT, ["-C", V, "config", "core.hooksPath", HOOKS.split("\\").join("/")], { windowsHide: true });
  const aktiv = execFileSync(GIT, ["-C", V, "config", "core.hooksPath"], { encoding: "utf8", windowsHide: true }).trim();
  console.log(`Kortex-Hooks aktiv: ${aktiv}`);
}
