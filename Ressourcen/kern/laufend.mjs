// .tools/laufend.mjs — K13 „Was läuft parallel" (Spec §12.2): SessionStart trägt die Sitzung in .logs/laufend/<sid>.json
// ein (Projekt-Schlüssel = Git-Wurzel bzw. Vault, Titel, Start), jeder Prompt erneuert das Lebenszeichen, SessionEnd
// trägt aus. Einträge ohne Lebenszeichen > 2 h zählen nicht (SessionEnd läuft bei einem Absturz nicht), > 24 h werden
// aufgeräumt. Je Sitzung eine eigene Datei, atomar (tmp + rename) — mehrere Sitzungen schreiben nie dieselbe Datei.
// Nur Hinweis („anbieten, nicht beanspruchen"): nichts wird gesperrt. Titel aus Nutzertext laufen durch den Secret- und
// den Kundendaten-Riegel. 0 Tokens, nur Node-Standardbibliothek.
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { istSystemNachricht, ohneWissensbedarf } from "./hint-core.mjs";
import { kuerze, uhrzeit } from "./verlauf.mjs";

export const LEBENSZEICHEN_MS = 2 * 3600 * 1000;
export const ALTLAST_MS = 24 * 3600 * 1000;
const ordnerVon = (vault) => join(vault, ".logs", "laufend");
const sauber = (sid) => String(sid || "").replace(/[^\w-]/g, "").slice(0, 64);
function lies(datei) {
  try { const o = JSON.parse(readFileSync(datei, "utf8")); return o && typeof o === "object" ? o : null; } catch { return null; }
}
function schreibeAtomar(datei, obj) {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj) + "\n");
  renameSync(tmp, datei);
}

export function titelAusPrompt(prompt) {
  const p = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!p || p.startsWith("/") || istSystemNachricht(p) || ohneWissensbedarf(p)) return null;
  if (hatSecretsImKontext(p) || hatPii(p)) return "(Titel ausgeblendet)";
  return kuerze(p, 60);
}

export function parallele(vault, { sid, schluessel, jetzt = Date.now() } = {}) {
  if (!schluessel) return [];
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const eigene = sauber(sid), out = [];
  for (const n of namen) {
    const e = lies(join(ordnerVon(vault), n));
    if (!e || e.sid === eigene || e.schluessel !== schluessel) continue;
    if (!(jetzt - Number(e.lebenszeichen) <= LEBENSZEICHEN_MS)) continue;
    out.push(e);
  }
  return out.sort((a, b) => a.start - b.start);
}

// melden=false: die Parallelen werden nicht ausgegeben (z. B. SessionStart nach einer Kompaktierung) und gelten daher
// nicht als gemeldet — der nächste Prompt meldet sie.
export function anmelden(vault, { sid, schluessel = null, titel = null, jetzt = Date.now(), melden = true } = {}) {
  const s = sauber(sid);
  if (!s) return null;
  mkdirSync(ordnerVon(vault), { recursive: true });
  const datei = join(ordnerVon(vault), `${s}.json`);
  const alt = lies(datei);
  const andere = parallele(vault, { sid: s, schluessel, jetzt });
  const eintrag = {
    sid: s, schluessel: schluessel || null, start: alt?.start ?? jetzt, lebenszeichen: jetzt,
    titel: titel ?? alt?.titel ?? null,
    gemeldet: [...new Set([...(Array.isArray(alt?.gemeldet) ? alt.gemeldet : []), ...(melden ? andere.map((e) => e.sid) : [])])],
  };
  schreibeAtomar(datei, eintrag);
  return { eintrag, andere };
}

// Lebenszeichen beim Prompt; → nur die parallelen Sitzungen, die dieser Sitzung noch nie gemeldet wurden.
export function puls(vault, { sid, prompt = "", jetzt = Date.now() } = {}) {
  const s = sauber(sid);
  if (!s) return [];
  const datei = join(ordnerVon(vault), `${s}.json`);
  const e = lies(datei);
  if (!e) return [];
  e.lebenszeichen = jetzt;
  if (!e.titel) e.titel = titelAusPrompt(prompt);
  const gemeldet = Array.isArray(e.gemeldet) ? e.gemeldet : [];
  const neu = parallele(vault, { sid: s, schluessel: e.schluessel, jetzt }).filter((x) => !gemeldet.includes(x.sid));
  e.gemeldet = [...new Set([...gemeldet, ...neu.map((x) => x.sid)])];
  try { schreibeAtomar(datei, e); } catch {}
  return neu;
}

export function abmelden(vault, sid) {
  const s = sauber(sid);
  if (!s) return;
  try { unlinkSync(join(ordnerVon(vault), `${s}.json`)); } catch {}
}

export function raeumeAuf(vault, jetzt = Date.now()) {
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)); } catch { return; }
  for (const n of namen) {
    const p = join(ordnerVon(vault), n);
    try {
      if (n.endsWith(".tmp")) { if (jetzt - statSync(p).mtimeMs > 3600000) unlinkSync(p); continue; }
      const zuletzt = Number(lies(p)?.lebenszeichen) || statSync(p).mtimeMs;
      if (jetzt - zuletzt > ALTLAST_MS) unlinkSync(p);
    } catch {}
  }
}

export function hinweisZeile(andere) {
  if (!Array.isArray(andere) || !andere.length) return "";
  const teile = andere.slice(0, 3).map((e) => `„${e.titel || "ohne Titel"}“ seit ${uhrzeit(Number(e.start))}`);
  return `Parallel im selben Repo${andere.length > 3 ? ` (${andere.length} Sitzungen)` : ""}: ${teile.join(", ")} — vor Commits `
    + "und Merges abstimmen (Cross-Session-Messaging). Nur ein Hinweis, nichts wird gesperrt.";
}
