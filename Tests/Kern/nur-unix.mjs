// Tests/Kern/nur-unix.mjs — Tests, die ein Unix-Werkzeug voraussetzen (Shell-Skript git-sicher, /bin/sh, POSIX-Signale), unter Windows sauber überspringen
// (Plattform-Paket „Windows grün“). Windows startet git direkt (werkzeug.mjs#gitBefehl), dort gibt es kein git-sicher; Entsprechungen sind Folgeaufgabe W2.
// Benutzung: `import { testNurUnix as test } from "./nur-unix.mjs"` (ganze Datei) oder `test(name, { skip: nurUnix("Grund") }, fn)` (einzelner Test).
import { test as echt } from "node:test";

export const WIN = process.platform === "win32";
export const nurUnix = (grund) => (WIN ? `nur macOS/Linux: ${grund}` : false);

export function testNurUnix(name, optionen, fn) {
  if (typeof optionen === "function") { fn = optionen; optionen = {}; }
  return echt(name, { ...(optionen || {}), skip: optionen?.skip ?? nurUnix("Shell-Skript/Unix-Werkzeug (Windows: W2)") }, fn);
}

// Die Umstellung vom alten Kit (Kit-Ordner .tools im Vault, Hooks mit node-start.sh, LaunchAgent, Attrappen als sh-Skripte) betrifft Rechner, die vor Kortex ein Kit hatten: das gab es unter
// Windows nie. Die Tests der Umstellung laufen dort nicht (Folgeaufgabe W2: entscheiden, ob eine Windows-Fassung der Umstellung überhaupt gebraucht wird).
export function testUmstellung(name, optionen, fn) {
  if (typeof optionen === "function") { fn = optionen; optionen = {}; }
  return echt(name, { ...(optionen || {}), skip: optionen?.skip ?? nurUnix("Umstellung vom alten Kit: das gab es unter Windows nie (W2: Bedarf klären)") }, fn);
}
