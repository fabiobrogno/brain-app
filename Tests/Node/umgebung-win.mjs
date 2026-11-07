// Tests/Node/umgebung-win.mjs — Hilfen für Tests, die Kindprozesse mit ausdrücklich gebauter Umgebung starten (macOS/Linux: nichts ändert sich).
// Windows: os.homedir() liest USERPROFILE (nicht HOME), und node.exe/git.exe brauchen SystemRoot, TEMP/TMP, ComSpec, PATHEXT, sonst starten sie nicht oder
// finden den Temp-Ordner nicht. `heim(h)` liefert HOME (+ auf Windows USERPROFILE und die Systemvariablen).
import { WIN } from "./attrappe.mjs";

const SYSTEM = ["SystemRoot", "SYSTEMROOT", "windir", "SystemDrive", "TEMP", "TMP", "ComSpec", "PATHEXT"];
export const heim = (h) => {
  const o = { HOME: h };
  if (!WIN) return o;
  o.USERPROFILE = h;
  for (const k of SYSTEM) if (process.env[k] !== undefined) o[k] = process.env[k];
  return o;
};
// Der Kindprozess beendet sich „abrupt“ (kein Aufräumen): macOS/Linux SIGKILL; Windows hat keine Signale, dort process.reallyExit(137) (siehe umbenennen-kind.mjs).
export const ABSTURZ_CODE = 137;
export const istAbsturz = (code, signal) => signal === "SIGKILL" || (WIN && code === ABSTURZ_CODE);
