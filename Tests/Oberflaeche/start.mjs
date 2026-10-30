// Startet entwicklung.mjs für einen Vault und liefert die Adresse.
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
// BRAIN_WURZEL: alternative Wurzel mit Ressourcen/werkstatt (z. B. fester Backend-Stand), sonst dieses Repo
const wurzel = process.env.BRAIN_WURZEL || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Workspace-Trust (P5): der Merker braucht die Ordner-Kennung; die rechnet das Backend selbst aus (erlaube), geschrieben wird nur in den
// übergebenen Support-Ordner. quelle „angelegt“: so sieht ein von Kortex angelegter Vault aus.
export async function erteileVertrauen(vault, support) {
  const m = await import(pathToFileURL(join(wurzel, "Ressourcen/gemeinsam/vertrauen.mjs")).href);
  m.erlaube(vault, { support, quelle: "angelegt" });
}
// Eigener Support-Ordner je Server (nie der echte). Standard: Vault ist vertraut; { vertraut: false } = von außen geöffnet (die Frage kommt, Git bleibt gesperrt).
// { kern }: Ordner eines Attrappen-Kerns (brain.mjs, rueckfragen.mjs …), den die Werkstatt als gebündelten Kern benutzt (KORTEX_KERN_PFAD, wie
// die App ihn setzt); ohne Angabe bleibt die Variable leer (nie der Kern des Entwicklers).
// vault = null: Werkstatt ohne Vault (Willkommen), der Vault-Ordner wird dann über die Oberfläche geöffnet. Das Ergebnis nennt auch den support-Ordner.
// { umgebung }: die GANZE Umgebung des Servers (statt der des Testlaufs), z. B. mit eigenem HOME und PATH — nötig, wenn die Werkstatt Programme suchen oder ein Konto-Home lesen soll
// (Frag deinen Vault). BRAIN_APP_SUPPORT, BRAIN_TESTMODUS und KORTEX_KERN_PFAD setzt diese Funktion trotzdem selbst; { support } übernimmt einen vorbereiteten Support-Ordner.
export async function starteServer(vault, { vertraut = true, kern = "", umgebung = null, support: vorgabe = null } = {}) {
  const support = vorgabe || mkdtempSync(join(tmpdir(), "brain-ui-support-"));
  if (vault && vertraut) await erteileVertrauen(vault, support);
  return new Promise((ok, nein) => {
    const p = spawn(process.execPath, [join(wurzel, "Ressourcen/werkstatt/entwicklung.mjs"), vault || "-", "0"],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...(umgebung || process.env), BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", BRAIN_VAULT: "", KORTEX_KERN_PFAD: kern } }); // BRAIN_VAULT leer: ohne Vault-Argument nie der Vault aus der Umgebung des Entwicklers
    let puffer = "";
    const frist = setTimeout(() => nein(new Error("Server startet nicht: " + puffer)), 10000);
    const lies = (d) => { puffer += d; const m = /Bereit: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(puffer); if (m) { clearTimeout(frist); ok({ url: m[1], support, stopp: () => p.kill() }); } };
    p.stdout.on("data", lies); p.stderr.on("data", lies);
    p.on("exit", (c) => nein(new Error("Server beendet: " + c + " " + puffer)));
  });
}
