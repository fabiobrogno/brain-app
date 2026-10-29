// gemeinsam/sicherungsmerker.mjs — „dieses Remote hat der Nutzer bestätigt“ (Kern-Umzug P4, Sicherheit).
//
// Ein fremder Vault kann ein `origin` mitbringen. Der Kern (Online-Sicherung `brain backup`, Push beim Sitzungsstart) pusht darum nur zu
// einem Remote, das hier gemerkt ist: <Support>/backup/<Kennung des Vaults>.json → { "remoteBestaetigt": "<Adresse>" }. Gesetzt wird der
// Merker dort, wo der Nutzer das Remote selbst einrichtet: Assistent „Sicherung“ (/api/sicherung/verbinden), Studio „Remote hinzufügen“
// (/api/git/remote) und `brain backup einrichten github` im Kern. Derselbe Ort und dieselbe Kennung wie kern/backup.mjs
// (Test: Tests/Node/sicherungsmerker.test.mjs hält beide zusammen). Die Datei kann auch den Sicherungsordner ("pfad") enthalten; er bleibt erhalten.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { supportOrdner } from "./basis.mjs";

export function kennung(wurzel) {
  let e = wurzel;
  try { e = realpathSync(wurzel); } catch { /* bleibt */ }
  return createHash("sha256").update(e).digest("hex").slice(0, 16);
}
export const merkerDatei = (wurzel, support = supportOrdner()) => join(support, "backup", `${kennung(wurzel)}.json`);

export function leseMerker(wurzel, support) {
  try { const o = JSON.parse(readFileSync(merkerDatei(wurzel, support), "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

// Merkt die Adresse als bestätigt (atomar, andere Felder bleiben). Wirft nie: ohne Merker pusht der Kern eben nicht.
export function merkeRemoteBestaetigt(wurzel, url, { support } = {}) {
  if (typeof url !== "string" || !url || /[\x00-\x1f\x7f]/.test(url)) return false;
  try {
    const datei = merkerDatei(wurzel, support);
    mkdirSync(join(datei, ".."), { recursive: true });
    const neu = { ...leseMerker(wurzel, support), remoteBestaetigt: url };
    const tmp = `${datei}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(neu) + "\n");
    renameSync(tmp, datei);
    return true;
  } catch { return false; }
}
