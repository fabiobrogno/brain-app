// umstellung/schrittliste.mjs — die Schritte A0–A8 in ihrer Reihenfolge, die Entscheidungen des Nutzers und gemeinsame Bausteine für Phase A und Rückweg (Paket P7b).
import { existsSync } from "node:fs";
import * as A0 from "./sicherung.mjs";
import { A1, A3, A4, A6, A7 } from "./schritte.mjs";
import * as A2 from "./git-umzug.mjs";
import * as A5 from "./mcp-schritt.mjs";
import * as A8 from "./geraete.mjs";
import { liesUndo, schreibeUndo, schreibeZustand } from "./protokoll.mjs";

export const SCHRITTE = [A0, A1, A2, A3, A4, A5, A6, A7, A8];
export const ALLE_IDS = [...SCHRITTE.map((s) => s.id), "A9"];
export const schrittMitId = (id) => SCHRITTE.find((s) => s.id === id) || null;

// Fehler mit festem Code (für CLI-Exit und Werkstatt) und einem Satz für Nicht-Techniker.
export class UmstellungsFehler extends Error {
  constructor(code, meldung, exit = 1) { super(meldung); this.name = "UmstellungsFehler"; this.code = code; this.exit = exit; }
}

// Entscheidungen des Nutzers (Schalter im Assistenten). Unbekannte Schlüssel fallen weg, falsche Typen auch. Empfohlen: nur das Verschieben der git-Einstellungen ist vorbelegt.
export const STANDARD_ENTSCHEIDUNGEN = Object.freeze({
  gitSchluessel: true,          // persönliche git-Einstellungen in die Datei nur für diesen Vault verschieben (A2)
  verweiseAufloesen: false,     // Verknüpfungen im Versionsverlauf durch Kopien ersetzen (A2)
  remoteEntfernen: false,       // ein lokales Sicherungsziel des Versionsverlaufs entfernen (A2)
  remoteBestaetigen: false,     // das Online-Sicherungsziel (https/ssh) als von dir bestätigt merken (A1)
  hooksErsetzen: false,         // eine fremde Prüfung vor dem Speichern ersetzen (A3)
  mcpAnders: false,             // einen fremden Eintrag „brain“ bei KI-Programmen umstellen (A5)
  dienstAnderer: false,         // einen Hintergrunddienst eines anderen Vaults umstellen (A6)
  profile: null,                // Pfade der Claude-Profile, die umgestellt werden (null = alle erkannten)
  weitereMacs: null,            // "ja" | "nein" | null – nur zur Erinnerung für Phase B
  nachbarkopie: false,          // die Probekopie notfalls im Nachbarordner des Vaults anlegen (sonst nur in Temp)
});
const BOOL = ["gitSchluessel", "verweiseAufloesen", "remoteEntfernen", "remoteBestaetigen", "hooksErsetzen", "mcpAnders", "dienstAnderer", "nachbarkopie"];
export function normalisiereEntscheidungen(roh) {
  const e = { ...STANDARD_ENTSCHEIDUNGEN };
  if (roh && typeof roh === "object" && !Array.isArray(roh)) {
    for (const k of BOOL) if (typeof roh[k] === "boolean") e[k] = roh[k];
    if (Array.isArray(roh.profile) && roh.profile.every((p) => typeof p === "string")) e.profile = [...new Set(roh.profile)];
    if (roh.weitereMacs === "ja" || roh.weitereMacs === "nein") e.weitereMacs = roh.weitereMacs;
  }
  return e;
}
// "a=ja,b=nein" (CLI) → Objekt
export function entscheidungenAusText(text) {
  const o = {};
  for (const teil of String(text || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = teil.split("=");
    if (!k) continue;
    if (k === "profile") { o.profile = (v || "").split("+").filter(Boolean); continue; }
    if (k === "weitereMacs") { o.weitereMacs = v; continue; }
    o[k] = /^(ja|true|1|an)$/i.test(v || "ja");
  }
  return o;
}
export function waehleProfile(z, ent) {
  if (!ent.profile) return z.claudeProfile;
  return z.claudeProfile.filter((p) => ent.profile.includes(p.pfad));
}

// Kontext eines Schritts: schreibt die Rückweg-Angaben SOFORT (ctx.merkeUndo) und hält sie im Zustand fest, damit auch ein Absturz mitten im Schritt umkehrbar bleibt.
// Läuft ein Schritt in einem späteren Lauf erneut und tut wieder etwas, bleibt die Rückweg-Angabe des früheren Laufs erhalten (`fruehere`) – der Rückweg nimmt beide zurück.
// Prüfmarke für Tests: simuliert den Abbruch des Prozesses (kein Rückweg des laufenden Schritts, die Sperre wird gelöst)
export class TestAbbruch extends Error { constructor(wo) { super(`Testabbruch ${wo}`); this.name = "TestAbbruch"; } }

export function schrittKontext(z, { schritt, entscheidungen, profile, lauf, sicherungsDir, zustand, abbruchBei = null }) {
  const frueher = zustand.schritte[schritt.id] && zustand.schritte[schritt.id].undo;
  const c = {
    entscheidungen, profile, lauf, sicherungsDir, undo: null, nachDaten: undefined,
    // Prüfpunkte der Schritte (z. B. „A4:nach-install“): nur in Tests löst einer einen simulierten Absturz aus – genau dort, wo ein echter Absturz die Rückweg-Angaben am schwersten träfe
    pruefpunkt(name) { if (abbruchBei === `${schritt.id}:${name}`) throw new TestAbbruch(`bei ${schritt.id}:${name}`); },
    merkeUndo(obj) {
      c.undo = obj;
      const rel = schreibeUndo(z, sicherungsDir, schritt.id, obj);
      const e = zustand.schritte[schritt.id] || {};
      const fruehere = [...(e.fruehere || [])];
      if (frueher && frueher !== rel && !fruehere.includes(frueher)) fruehere.push(frueher);
      zustand.schritte[schritt.id] = { ...e, undo: rel, fruehere };
      schreibeZustand(z, zustand);
    },
  };
  return c;
}
// Rückweg-Angaben eines Schritts aus dem Zustand lesen: die jüngste zuerst, dann die früherer Läufe (neueste zuerst)
export function undoListe(z, zustand, id) {
  const e = zustand.schritte[id];
  if (!e) return [];
  return [e.undo, ...[...(e.fruehere || [])].reverse()].filter(Boolean).map((rel) => liesUndo(z, rel)).filter(Boolean);
}

// Ist alles da, was die Umstellung braucht? → null oder UmstellungsFehler
export function bereitFehler(z) {
  if (!z.kern || !z.starter) return new UmstellungsFehler("kein-stabiler-kern", "Kortex ist noch nicht ganz eingerichtet: der feste Programmpfad fehlt. Öffne Kortex bitte aus dem Ordner „Programme“ und versuche es noch einmal.", 3);
  if (!existsSync(z.node) || !z.mcpServer || !existsSync(z.mcpServer)) return new UmstellungsFehler("kern-unvollstaendig", "Kortex ist noch nicht vollständig bereit (Node oder der Suchserver fehlt). Starte Kortex neu und versuche es noch einmal.", 3);
  return null;
}
