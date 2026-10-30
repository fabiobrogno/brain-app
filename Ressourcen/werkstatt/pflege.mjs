// werkstatt/pflege.mjs — Pflege je Vault für die Oberfläche (docs/plaene/ki-konten.md, Abschnitt 5, Paket P3): letzter und nächster Lauf des Tageslaufs, Stand des Dienstes, und die
// einmalige Übernahme des festen Claude-Profils aus der alten plist des Dienstes in die Pflege-Einstellung der Vaults. Gelesen wird nur (die Einstellung selbst schreibt konten.mjs#setzePflege).
//   GET  /api/ki/pflege?vault=<pfad>   → { vault, letzter, naechster, dienst, schalter }
//   POST /api/ki/pflege/jetzt          → startet den Tageslauf des offenen Vaults einmal im Hintergrund (über den Starter, wie der Dienst)
// Vom Vault wird nur .logs/tageslauf/letzter.json gelesen (kein Link, höchstens 256 KB), und nur ein festes Feld-Set wird weitergegeben (Zeiten, Status, Zahlen) — nie Inhalt aus dem Vault.
import { readFileSync, lstatSync, realpathSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { HttpFehler, testmodus } from "../gemeinsam/basis.mjs";

export const LABEL = "de.brain.tageslauf";
const MAX_LESEN = 256 * 1024;
const FAELLIG_MS = 20 * 3600e3;                         // wie kern/tageslauf/zeitplan.mjs (fällig: letzter Erfolg > 20 h)
const unxml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const zahl = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
const zeit = (s) => (typeof s === "string" && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null);
const STATUS = ["ok", "teilweise", "ohne-ki", "ok-ohne-ki", "abgebrochen", "fehler"];

const leseJson = (datei) => {
  try { const st = lstatSync(datei); if (!st.isFile() || st.size > MAX_LESEN) return null; return JSON.parse(readFileSync(datei, "utf8")); } catch { return null; }
};

// Eine nicht-XML-plist (binär, von macOS umgeschrieben) mit plutil als XML lesen. Nur auf dem Mac; sonst/bei Fehler null. (Ersatz für Tests: erzeugePflege({ plutil }).)
const plutilStandard = (datei) => {
  const prog = "/usr/bin/plutil";
  if (process.platform !== "darwin" || !existsSync(prog)) return null;
  try { return execFileSync(prog, ["-convert", "xml1", "-o", "-", datei], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }); } catch { return null; }
};
const ISTXML = /^\s*(<\?xml|<!DOCTYPE|<plist)/;

export function erzeugePflege({ support, home = () => homedir(), konten, vaults = () => [], plutil = plutilStandard } = {}) {
  const plistPfad = () => join(home(), "Library", "LaunchAgents", `${LABEL}.plist`);
  // Im Testmodus wird nie das echte LaunchAgents-Verzeichnis des Rechners gelesen: nur ein Home unter dem Temp-Ordner.
  const echtPfad = (p) => { try { return realpathSync.native(p); } catch { return p; } };
  const homeErlaubt = () => !testmodus() || echtPfad(home()).startsWith(echtPfad(tmpdir()) + "/");
  const dienstVaults = () => {
    const j = leseJson(join(support, "dienst.json"));
    return j && Array.isArray(j.vaults) ? j.vaults.filter((v) => typeof v === "string" && v) : [];
  };
  // → { da, profil: Pfad | null, unlesbar? } — das feste Profil, das die plist (noch) trägt. Eine plist, die Kortex nicht sicher lesen kann (binär ohne plutil, umformatiert, Schlüssel ohne lesbaren Wert),
  // ist „unlesbar“: dann wird nichts übernommen und nie das Standardprofil angenommen (siehe migriere).
  function plistStand() {
    let roh; try { if (!homeErlaubt()) return { da: false, profil: null }; roh = readFileSync(plistPfad()); } catch { return { da: false, profil: null }; }
    let text = roh.toString("utf8");
    if (!ISTXML.test(text) || !text.includes("</plist>")) { const x = plutil(plistPfad()); text = typeof x === "string" ? x : ""; }
    if (!text.includes("<plist") || !text.includes("</plist>")) return { da: true, profil: null, unlesbar: true };
    const m = text.match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([^<]*)<\/string>/);
    if (!m) return /CLAUDE_CONFIG_DIR/.test(text) ? { da: true, profil: null, unlesbar: true } : { da: true, profil: null };
    const p = unxml(m[1]).trim();
    return { da: true, profil: p || null };
  }

  // Die Übernahme des festen Profils der plist in die Pflege-Einstellung der Vaults des Dienstes (konten.migrierePflege, idempotent) und danach das Neuschreiben der plist (neuschreiben: async () → { ok } | { grund }).
  // Läuft bei jedem Start und jedem Öffnen der KI-Konten, solange die plist eine Variable trägt oder die Übernahme noch nicht vermerkt ist; ein Misserfolg bleibt als `plistOffen` + Grund in der Liste (Studio zeigt es).
  // Eine unlesbare plist wird nie gedeutet (kein Standardprofil annehmen): nur der Hinweis. → { gemacht, vaults, hinweise, plist: "neu" | "offen" | "keine" | "unlesbar" | "in-ordnung" }
  async function migriere({ neuschreiben = null } = {}) {
    const leer = { gemacht: false, vaults: [], hinweise: [] };
    try {
      const p = plistStand();
      if (!p.da) return { ...leer, plist: "keine" };
      if (p.unlesbar) {
        if (konten.migrationVermerkt()) konten.vermerkePlist({ offen: true, grund: "unlesbar" });
        return { ...leer, plist: "unlesbar" };
      }
      const r = konten.migrierePflege({ profil: p.profil, dienstVaults: dienstVaults() });
      if (p.profil === null) { konten.vermerkePlist({ offen: false }); return { ...r, plist: "in-ordnung" }; }
      if (typeof neuschreiben !== "function") return { ...r, plist: "offen" };      // diesmal kein Versuch (die Werkstatt versucht es nicht bei jedem Aufruf): der Vermerk bleibt, wie er ist
      let grund = "fehler";
      try { const e = await neuschreiben(); if (e && e.ok) grund = null; else if (e && typeof e.grund === "string") grund = e.grund; } catch { grund = "fehler"; }
      if (grund === null && plistStand().profil !== null) grund = "fehler";             // „ok“ gemeldet, aber die Variable steht noch: nicht als erledigt zählen
      konten.vermerkePlist({ offen: grund !== null, grund });
      return { ...r, plist: grund === null ? "neu" : "offen" };
    } catch { return { ...leer, plist: "offen" }; }
  }

  // Schalter tageslauf (aus | probe | an) aus brain.config.json des Vaults; unlesbar heißt „aus“ (wie der Kern: ohne lesbare Einstellungen läuft nichts).
  function schalter(vaultPfad) {
    const cfg = leseJson(join(vaultPfad, "brain.config.json"));
    return cfg && cfg.automatik && ["aus", "probe", "an"].includes(cfg.automatik.tageslauf) ? cfg.automatik.tageslauf : "aus";
  }
  // Läuft der Tageslauf dieses Vaults gerade? (Sperre .logs/tageslauf/lauf.lock { pid, start }: lebt der Prozess und ist sie jünger als 2 h — wie kern/tageslauf/zeitplan.mjs#nimmSperre.)
  function laeuftSchon(vaultPfad) {
    const j = leseJson(join(vaultPfad, ".logs", "tageslauf", "lauf.lock"));
    if (!j || !Number.isInteger(j.pid)) return false;
    const start = Date.parse(j.start || "");
    if (!Number.isFinite(start) || Date.now() - start >= 2 * 3600e3) return false;
    try { process.kill(j.pid, 0); return true; } catch (e) { return !!e && e.code === "EPERM"; }
  }

  function letzter(vaultPfad) {
    const j = leseJson(join(vaultPfad, ".logs", "tageslauf", "letzter.json"));
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const ki = j.ki && typeof j.ki === "object" ? j.ki : null;
    return {
      zeit: zeit(j.zeit), status: STATUS.includes(j.status) ? j.status : "unbekannt", erfolgreich: j.erfolgreich === true, modus: j.modus === "probe" ? "probe" : "an",
      art: ["voll", "antworten", "pflege"].includes(j.art) ? j.art : "voll", letzterErfolg: zeit(j.letzterErfolg),
      aufrufe: zahl(j.aufrufe), tokEin: zahl(j.tokEin), tokAus: zahl(j.tokAus),
      uebernommen: zahl(j.zahlen && j.zahlen.uebernommen), rueckfragen: zahl(j.zahlen && j.zahlen.rueckfragen),
      ...(ki ? { ki: { modus: ["alt", "konto", "aus"].includes(ki.modus) ? ki.modus : "alt", stufe: ["klein", "mittel", "aus"].includes(ki.stufe) ? ki.stufe : "mittel", bewusst: ki.bewusst === true } } : {}),
      // Der Grund ist ein Satz des Kerns ohne Pfade und Namen; hier nur gekürzt
      ...(typeof j.grund === "string" && j.grund ? { grund: j.grund.replace(/\s+/g, " ").slice(0, 200) } : {}),
    };
  }

  function status(vaultPfad) {
    const bekannt = vaults().find((v) => v && (v.pfad === vaultPfad));
    if (!bekannt) throw new HttpFehler(404, "Diesen Vault kennt Kortex nicht (mehr).");
    const s = schalter(bekannt.pfad);
    const l = letzter(bekannt.pfad);
    const p = plistStand();
    let echt = bekannt.pfad; try { echt = realpathSync.native(bekannt.pfad); } catch { /* wie angegeben */ }
    const fuerVault = p.da && dienstVaults().some((x) => x === echt || x === bekannt.pfad);
    // nächster Lauf: der Dienst prüft stündlich und startet, wenn der letzte Erfolg mehr als 20 Stunden alt ist (und der Mac am Netzteil ruht)
    let naechster;
    if (s === "aus") naechster = { art: "aus" };
    else if (!fuerVault) naechster = { art: "sitzungsstart" };
    else {
      const t = l && l.letzterErfolg ? Date.parse(l.letzterErfolg) + FAELLIG_MS : null;
      naechster = { art: "dienst", fruehestens: t && t > Date.now() ? new Date(t).toISOString() : null };
    }
    return { vault: bekannt.pfad, schalter: s, letzter: l, naechster, dienst: { eingerichtet: p.da, fuerVault, profilAlt: p.profil !== null, ...(p.unlesbar ? { unlesbar: true } : {}) }, laeuft: laeuftSchon(bekannt.pfad) };
  }

  return { status, migriere, plistStand, dienstVaults, schalter, laeuftSchon };
}

