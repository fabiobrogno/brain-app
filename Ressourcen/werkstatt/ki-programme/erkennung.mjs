// werkstatt/ki-programme/erkennung.mjs — Welche KI-Programme sind auf diesem Mac installiert, und in welcher Version?
// Gesucht wird nur nach der App (…/Applications/<Name>.app, Version aus Contents/Info.plist, gelesen — nie gestartet) und/oder nach dem
// Befehl im PATH (findeProgramm; Version aus der schon vorhandenen Agentenliste, falls das Programm dort geführt wird).
// Ein Konfigurationsordner allein zählt NICHT als „installiert“: er bleibt oft nach dem Löschen eines Programms liegen.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { findeProgramm } from "../../gemeinsam/ki.mjs";
import { vorschauOrdner } from "../../gemeinsam/basis.mjs";

const PLIST_VERSION = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]{1,40})<\/string>/;

function appVersion(appPfad) {
  try { const m = PLIST_VERSION.exec(readFileSync(join(appPfad, "Contents", "Info.plist"), "utf8")); return m ? m[1] : null; } catch { return null; }
}

// beschreibungen: [{ id, name, erkennung: { apps?: ["Windsurf.app"], cli?: ["windsurf"] } }]
// → [{ id, name, gefunden, version|null, quelle: "app"|"cli"|null }] in der Reihenfolge der Beschreibungen. home/appOrdner nur für Tests austauschbar.
export function erkenneProgramme(beschreibungen, { env = process.env, agenten = [], home = homedir(), appOrdner = "/Applications" } = {}) {
  // Vorschau: ein frisch installierter Mac — die Apps und Befehle dieses Rechners gehören nicht dazu.
  const vorschau = !!vorschauOrdner();
  const appOrte = [...(vorschau ? [] : [appOrdner]), join(home, "Applications")];
  return beschreibungen.map((b) => {
    const er = b.erkennung || {};
    for (const app of er.apps || []) {
      for (const ort of appOrte) {
        const pfad = join(ort, app);
        if (existsSync(pfad)) return { id: b.id, name: b.name, gefunden: true, version: appVersion(pfad), quelle: "app" };
      }
    }
    for (const cli of er.cli || []) {
      const pfad = findeProgramm(cli, env);
      if (pfad) {
        const a = agenten.find((x) => x.id === cli && x.pfad);
        return { id: b.id, name: b.name, gefunden: true, version: a ? a.version || null : null, quelle: "cli" };
      }
    }
    return { id: b.id, name: b.name, gefunden: false, version: null, quelle: null };
  });
}
