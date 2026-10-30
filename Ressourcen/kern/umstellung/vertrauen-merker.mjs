// umstellung/vertrauen-merker.mjs — wo die Umstellung (P7) und das Workspace-Trust (P5) zusammentreffen. P5 ist in main; die Regeln:
//
//  1. VORAUSSETZUNG, nicht Folge: Probelauf und Phase A verlangen einen vertrauten Vault (phase-a.mjs#pruefeVertrauen → pfade.mjs#vaultVertraut, Merker <Support>/vertrauen.json),
//     und zwar VOR A0 (Code `nicht-vertraut`, Exit 6). Grund: die Umstellung schreibt aus dem Inhalt des Vaults in ~/.claude*, LaunchAgents und die globale git-Konfiguration; ein
//     von außen kopierter Ordner darf das nicht auslösen. Ein Kit-Vault, der nie im alten Studio bestätigt war, bestätigt der Nutzer zuerst im Studio („Kommt dieser Vault von dir?“).
//     Unter P5 enden außerdem claude-hooks, hooks-install, dienst an und skills-build mit Exit 5, wenn das Vertrauen unterwegs verschwindet → Grund "vault-nicht-vertraut".
//  2. KEINE eigene Quelle „umgestellt“: der Vault ist vor der Umstellung ohnehin vertraut (angelegt/geklont/bestaetigt/migriert), die Quelle sagt, WOHER das Vertrauen kommt – das
//     bleibt so. Die Werkstatt (werkstatt/umstellung.mjs#vermerkeVertrauen) trägt darum nach Phase A nur dann etwas ein, wenn der Merker fehlt (z. B. in der Zwischenzeit entzogen);
//     ein vorhandenes Vertrauen wird nie überschrieben (kein Herabstufen von „angelegt“ auf „bestaetigt“). Eintrag dann mit quelle "bestaetigt".
//  3. Die Probekopie braucht Vertrauen, sonst sperrt P5 dort git, Hooks und Dienst und der Probelauf wäre immer rot: `schreibeVertrauen` legt den Merker im Format von P5
//     ({ "<realpath>": { seit, ordner: "dev:ino:birthtimeMs", quelle } }, 0600) in den EIGENEN Support-Ordner der Probe (Temp), nie in den echten.
import { mkdirSync, statSync, realpathSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

export const VERTRAUEN_QUELLE = "bestaetigt";

export function schreibeVertrauen(support, vault, quelle = VERTRAUEN_QUELLE) {
  const echt = realpathSync.native(vault);
  const st = statSync(echt);
  mkdirSync(support, { recursive: true, mode: 0o700 });
  const datei = join(support, "vertrauen.json");
  const tmp = `${datei}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ [echt]: { seit: new Date().toISOString(), ordner: `${st.dev}:${st.ino}:${st.birthtimeMs}`, quelle } }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, datei);
}
export const vertraueProbeKopie = (supportProbe, kopie) => schreibeVertrauen(supportProbe, kopie);

// Anschlussstelle für die Werkstatt: nichts zu schreiben im Kern (siehe oben). Gibt zurück, ob die Umstellung den Vermerk verlangt.
export function vermerkeUmgestellt() { return { vermerken: true, quelle: VERTRAUEN_QUELLE }; }
