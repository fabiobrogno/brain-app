// umstellung/vertrauen-merker.mjs — die EINE Stelle, an der die Umstellung (P7) und das Workspace-Trust (P5, Branch feat/vault-vertrauen) zusammentreffen.
//
// Stand dieses Branches: P5 ist noch nicht in main. Darum nimmt der Kern hier nichts vorweg und schreibt keinen Merker in <Support>/vertrauen.json (den schreibt nach P5 nur die
// Werkstatt, gemeinsam/vertrauen.mjs; der Kern liest ihn nur). Beim Merge von P5 sind genau zwei Dinge zu tun:
//
//  1. Ein umgestellter Vault gilt als vertraut. phaseA() setzt dafür `zustand.vertrauen = "vermerken"` und liefert `phase: "A"`; die Werkstatt (werkstatt/umstellung.mjs, Funktion
//     `vermerkeVertrauen`) ruft danach `erlaube(vault, { support, quelle })` aus gemeinsam/vertrauen.mjs – ist das Modul noch nicht da (P5 fehlt), bleibt der Aufruf ein stiller
//     Leerlauf. Der Nutzer hat die Umstellung selbst bestätigt (Probelauf, Klick „Jetzt umstellen“); als `quelle` taugt darum "bestaetigt". Wer lieber unterscheiden will, ergänzt
//     eine Quelle "umgestellt" in QUELLEN (kern/vertrauen.mjs UND gemeinsam/vertrauen.mjs) und ändert VERTRAUEN_QUELLE unten.
//  2. Die Probekopie braucht Vertrauen, sonst sperrt P5 dort git, Hooks und Dienst und der Probelauf wäre immer rot: `vertraueProbeKopie` schreibt den Merker im Format von P5
//     ({ "<realpath>": { seit, ordner: "dev:ino:birthtimeMs", quelle } }, 0600) in den EIGENEN Support-Ordner der Probe (Temp), nie in den echten. Ohne P5 ist die Datei wirkungslos.
//     Zusätzlich setzt kindUmgebung in Tests KORTEX_VAULT_VERTRAUT=alle (nur Testumgebung, wird aus der Umgebung des Tests durchgereicht).
//  3. Alle Kindprozesse der Phase A (claude-hooks, hooks-install, dienst an, skills-build) enden unter P5 mit Exit 5, wenn der Vault nicht vertraut ist; die Schritte melden das als
//     Grund "vault-nicht-vertraut" (der Vault ist vor der Umstellung fast immer „migriert“, weil er in vaults.json steht).
import { mkdirSync, statSync, realpathSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

export const VERTRAUEN_QUELLE = "bestaetigt";

export function vertraueProbeKopie(supportProbe, kopie) {
  const echt = realpathSync.native(kopie);
  const st = statSync(echt);
  mkdirSync(supportProbe, { recursive: true, mode: 0o700 });
  const datei = join(supportProbe, "vertrauen.json");
  const tmp = `${datei}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ [echt]: { seit: new Date().toISOString(), ordner: `${st.dev}:${st.ino}:${st.birthtimeMs}`, quelle: VERTRAUEN_QUELLE } }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, datei);
}

// Anschlussstelle für die Werkstatt: nichts zu schreiben im Kern (siehe oben). Gibt zurück, ob die Umstellung den Vermerk verlangt.
export function vermerkeUmgestellt() { return { vermerken: true, quelle: VERTRAUEN_QUELLE }; }
