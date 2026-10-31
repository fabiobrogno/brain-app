// gemeinsam/sicherungsmerker.mjs — „dieses Remote hat der Nutzer bestätigt“ (Kern-Umzug P4, Sicherheit).
//
// Ein fremder Vault kann ein `origin` mitbringen. Der Kern (Online-Sicherung `brain backup`, Push beim Sitzungsstart) pusht darum nur zu
// einem Remote, das hier gemerkt ist: <Support>/backup/<Kennung des Vaults>.json → { "remoteBestaetigt": "<Adresse>" }. Gesetzt wird der
// Merker dort, wo der Nutzer das Remote selbst einrichtet: Assistent „Sicherung“ (/api/sicherung/verbinden), Studio „Remote hinzufügen“
// (/api/git/remote) und `brain backup einrichten github` im Kern. Derselbe Ort und dieselbe Kennung wie kern/backup.mjs
// (Test: Tests/Node/sicherungsmerker.test.mjs hält beide zusammen). Die Datei kann auch den Sicherungsordner ("pfad") enthalten; er bleibt erhalten.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { supportOrdner } from "./basis.mjs";

// Kennung = Hash des kanonischen Pfads (realpath.native), wie kern/backup.mjs; Übergang: eine unter der früheren Kennung (JS-realpath) angelegte Datei wird weiter gefunden.
const hashPfad = (p) => createHash("sha256").update(p).digest("hex").slice(0, 16);
export function kennungen(wurzel) {
  const e = (f) => { try { return f(wurzel); } catch { return wurzel; } };
  return [...new Set([hashPfad(e(realpathSync.native)), hashPfad(e(realpathSync))])];
}
export const kennung = (wurzel) => kennungen(wurzel)[0];
export function merkerDatei(wurzel, support = supportOrdner()) {
  const ids = kennungen(wurzel);
  return join(support, "backup", `${ids.find((i) => existsSync(join(support, "backup", `${i}.json`))) || ids[0]}.json`);
}

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

// Stand des Abgleichs bei mehreren Geräten (kern/backup.mjs schreibt ihn): abgleich = { stand: "konflikt" | "anmeldung" | "neues", zeit }.
// Das Studio zeigt „Konflikt – im Studio lösen“ damit auch dann, wenn der Konflikt im Hintergrund (Sicherung) entstand und der Arbeitsbaum wieder sauber ist.
export function leseAbgleichStand(wurzel, support) {
  const a = leseMerker(wurzel, support).abgleich;
  return a && typeof a === "object" && ["konflikt", "anmeldung", "neues"].includes(a.stand) ? a.stand : null;
}
// Dazu die Notizen im Konflikt (kern/backup.mjs vermerkt sie): { stand, dateien: [Pfad], zeit } oder null.
export function leseAbgleichDetail(wurzel, support) {
  const m = leseMerker(wurzel, support);
  const a = m.abgleich;
  const basis = m.konfliktBasis && typeof m.konfliktBasis === "object" ? m.konfliktBasis : null;
  // haelt: ein gemerkter Stand wartet auf neue Entscheidungen (nach „Rückgängig“ oder einem Abbruch): bis dahin wird nichts gesendet — auch wenn der Vermerk der Sicherung fehlt
  const abgleichOk = a && typeof a === "object" && ["konflikt", "anmeldung", "neues"].includes(a.stand);
  if (!abgleichOk && !basis) return null;
  const quelle = abgleichOk && Array.isArray(a.dateien) ? a.dateien : basis && Array.isArray(basis.dateien) ? basis.dateien : [];
  const dateien = quelle.filter((p) => typeof p === "string").slice(0, 200);
  return { stand: abgleichOk ? a.stand : "konflikt", dateien, zeit: abgleichOk && typeof a.zeit === "string" ? a.zeit : null, haelt: !!basis, haeltSeit: basis && typeof basis.zeit === "string" ? basis.zeit : null };
}
// Nach einem erfolgreichen Abgleich im Studio gilt der Vermerk nicht mehr. Wirft nie.
export function loescheAbgleichStand(wurzel, { support } = {}) {
  try {
    if (leseMerker(wurzel, support).konfliktBasis) return false; // ein gemerkter Stand wird nie nebenbei geräumt
    const m = leseMerker(wurzel, support);
    if (!("abgleich" in m)) return false;
    delete m.abgleich;
    const datei = merkerDatei(wurzel, support);
    const tmp = `${datei}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(m) + "\n");
    renameSync(tmp, datei);
    return true;
  } catch { return false; }
}
