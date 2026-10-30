// werkstatt/pflege.mjs — Pflege je Vault für die Oberfläche (docs/plaene/ki-konten.md, Abschnitt 5, Paket P3): letzter und nächster Lauf des Tageslaufs, Stand des Dienstes, und die
// einmalige Übernahme des festen Claude-Profils aus der alten plist des Dienstes in die Pflege-Einstellung der Vaults. Gelesen wird nur (die Einstellung selbst schreibt konten.mjs#setzePflege).
//   GET  /api/ki/pflege?vault=<pfad>   → { vault, letzter, naechster, dienst, schalter }
//   POST /api/ki/pflege/jetzt          → startet den Tageslauf des offenen Vaults einmal im Hintergrund (über den Starter, wie der Dienst)
// Vom Vault wird nur .logs/tageslauf/letzter.json gelesen (kein Link, höchstens 256 KB), und nur ein festes Feld-Set wird weitergegeben (Zeiten, Status, Zahlen) — nie Inhalt aus dem Vault.
import { readFileSync, lstatSync, realpathSync } from "node:fs";
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

export function erzeugePflege({ support, home = () => homedir(), konten, vaults = () => [] } = {}) {
  const plistPfad = () => join(home(), "Library", "LaunchAgents", `${LABEL}.plist`);
  // Im Testmodus wird nie das echte LaunchAgents-Verzeichnis des Rechners gelesen: nur ein Home unter dem Temp-Ordner.
  const echtPfad = (p) => { try { return realpathSync.native(p); } catch { return p; } };
  const homeErlaubt = () => !testmodus() || echtPfad(home()).startsWith(echtPfad(tmpdir()) + "/");
  const dienstVaults = () => {
    const j = leseJson(join(support, "dienst.json"));
    return j && Array.isArray(j.vaults) ? j.vaults.filter((v) => typeof v === "string" && v) : [];
  };
  // → { da: bool, profil: Pfad | null } — das feste Profil, das die plist (noch) trägt
  function plistStand() {
    let text; try { if (!homeErlaubt()) return { da: false, profil: null }; text = readFileSync(plistPfad(), "utf8"); } catch { return { da: false, profil: null }; }
    const m = text.match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([^<]*)<\/string>/);
    const p = m ? unxml(m[1]).trim() : "";
    return { da: true, profil: p || null };
  }

  // Einmal: das feste Profil der plist wird das Pflege-Konto der Vaults des Dienstes. → { gemacht, vaults, hinweise, plistNeu } (plistNeu: die plist trägt die Variable noch und sollte neu geschrieben werden)
  function migriere() {
    try {
      const p = plistStand();
      if (!p.da) return { gemacht: false, vaults: [], hinweise: [], plistNeu: false };
      const r = konten.migrierePflege({ profil: p.profil, dienstVaults: dienstVaults() });
      return { ...r, plistNeu: p.profil !== null && r.gemacht };
    } catch { return { gemacht: false, vaults: [], hinweise: [], plistNeu: false }; }
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
    const cfg = leseJson(join(bekannt.pfad, "brain.config.json"));
    const s = cfg && cfg.automatik && ["aus", "probe", "an"].includes(cfg.automatik.tageslauf) ? cfg.automatik.tageslauf : "aus";
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
    return { vault: bekannt.pfad, schalter: s, letzter: l, naechster, dienst: { eingerichtet: p.da, fuerVault, profilAlt: p.profil !== null } };
  }

  return { status, migriere, plistStand, dienstVaults };
}

