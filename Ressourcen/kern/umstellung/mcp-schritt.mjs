// umstellung/mcp-schritt.mjs — Schritt A5 der Phase A (Paket P7b, Plan Abschnitt 3): der MCP-Eintrag „brain“ bei Claude Code (je Profil), Codex und Cursor zeigt auf den festen Pfad
// der App (<Support>/bin/node + <Support>/bin/kern/mcp/brain-mcp.mjs), statt auf den alten Werkzeug-Ordner oder einen früheren Ort.
//
// Abweichung vom Entwurf des Plans (dort: Route /api/mcp/verbinden der Werkstatt): die Schritte laufen im Kern (eine Stelle für Ablauf, Abbruch und Rückweg); die Einstufung
// gleich/alt/anders ist dieselbe wie in der Werkstatt (umstellung/mcp-lage.mjs, Test hält beide zusammen), die Einträge setzt – wie dort – das jeweilige Programm selbst
// (`claude mcp remove/add -s user`, `codex mcp remove/add`); nur Cursor hat keine Befehlszeile und bekommt die Datei ~/.cursor/mcp.json (Sicherung vorher, Fremdes bleibt).
// „alt“ wird ohne Rückfrage umgestellt, „anders“ (fremder Eintrag unter dem Namen brain) nur mit entscheidungen.mcpAnders. Ein Eintrag nur auf Projektebene bleibt (Hinweis).
// Der Rückweg trägt den gesicherten alten Eintrag wieder ein – nur, wenn der Eintrag noch genau unserer ist.
import { readFileSync, statSync } from "node:fs";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { findeClaude } from "../ernte.mjs";
import { mcpLage, claudeServer, codexServer, cursorServer } from "./mcp-lage.mjs";
import { kindUmgebung } from "./ziele.mjs";
import { hashDatei, sichereDatei, sicherungsPfad, stelleHer, schreibeAtomar, echtesDateiZiel, modusVon } from "./protokoll.mjs";

export const id = "A5";
export const titel = "KI-Programme mit Kortex verbinden";
const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);
const FRIST = 25_000;

function bekannteVaults(z) {
  const liste = [z.musterVault];
  for (const s of [z.festSupport, z.support]) {
    try { const j = JSON.parse(readFileSync(join(s, "vaults.json"), "utf8")); for (const e of Array.isArray(j?.vaults) ? j.vaults : []) if (e && typeof e.pfad === "string") liste.push(e.pfad); } catch { /* keine Liste */ }
  }
  return liste;
}
export function findeCodex(z) {
  const t = z.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || z.env.BRAIN_TESTMODUS === "1";
  if (t && z.env.KORTEX_CODEX_PROGRAMM) return { befehl: process.execPath, args: [z.env.KORTEX_CODEX_PROGRAMM] };
  for (const dir of [...String(z.env.PATH || "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin", join(z.home, ".local", "bin")]) {
    const p = join(dir, "codex");
    try { if (dir && statSync(p).isFile()) return { befehl: p, args: [] }; } catch { /* weiter */ }
  }
  return null;
}
const sollEintrag = (z) => ({ command: z.node, args: [z.mcpServer] });
const istGleich = (e, z) => !!e && e.command === z.node && Array.isArray(e.args) && e.args.length === 1 && e.args[0] === z.mcpServer;
function lauf(z, prog, args, extra = {}) {
  const r = spawnSync(prog.befehl, [...prog.args, ...args], { encoding: "utf8", env: kindUmgebung(z, { CI: "1", ...extra }), cwd: z.home, timeout: FRIST, windowsHide: true });
  return { status: r.status === null ? 1 : r.status, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}
const claudeDatei = (z, p) => (p.standard ? join(z.home, ".claude.json") : join(p.pfad, ".claude.json"));
// Der Eintrag „brain“ auf Benutzerebene (nicht Projektebene), vollständig (mit env) – nur lesen
function claudeNutzerEintrag(z, p) {
  try { const d = JSON.parse(readFileSync(claudeDatei(z, p), "utf8")); return istObjekt(d.mcpServers) && istObjekt(d.mcpServers.brain) ? d.mcpServers.brain : null; } catch { return null; }
}
const claudeEnv = (p) => (p.standard ? {} : { CLAUDE_CONFIG_DIR: p.pfad });
const mitEnv = (alt) => (istObjekt(alt.env) ? Object.entries(alt.env).filter(([, v]) => typeof v === "string").flatMap(([k, v]) => ["-e", `${k}=${v}`]) : []);
function claudeSetze(z, prog, p, e) {   // e = { command, args, env? } oder null (nur entfernen)
  lauf(z, prog, ["mcp", "remove", "-s", "user", "brain"], claudeEnv(p));
  if (!e) return true;
  return lauf(z, prog, ["mcp", "add", "-s", "user", ...mitEnv(e), "brain", "--", e.command, ...(Array.isArray(e.args) ? e.args : [])], claudeEnv(p)).status === 0;
}
function codexSetze(z, prog, e) {
  lauf(z, prog, ["mcp", "remove", "brain"]);
  if (!e) return true;
  return lauf(z, prog, ["mcp", "add", "brain", "--", e.command, ...(Array.isArray(e.args) ? e.args : [])]).status === 0;
}

export function lage(z, ctx) {
  if (!z.mcpServer) return [];
  return mcpLage({ home: z.home, support: z.festSupport, profile: ctx.profile, vaults: bekannteVaults(z) });
}
const handeln = (e, ctx) => e.art === "alt" || (e.art === "anders" && ctx.entscheidungen.mcpAnders === true);

export function plan(z, ctx) {
  const l = lage(z, ctx);
  const n = l.filter((e) => handeln(e, ctx)).length;
  const fragen = l.filter((e) => e.art === "anders" && !handeln(e, ctx)).length;
  return { noetig: n > 0, text: n ? `${n} Eintrag/Einträge bei KI-Programmen werden auf den festen Pfad von Kortex umgestellt.` : fragen ? "Ein fremder Eintrag „brain“ bleibt, bis du ihn ausdrücklich umstellst." : "nichts umzustellen", anzahl: n, fragen };
}

export function wende(z, ctx) {
  if (!z.mcpServer || !z.kern) throw new Error("kein-stabiler-kern");
  const ziele = lage(z, ctx).filter((e) => handeln(e, ctx));
  if (!ziele.length) return { status: "nichts" };
  if (!z.schreibeMcp) return { status: "ok", anzahl: ziele.length, details: { geplant: ziele.map((e) => e.ziel) } };   // Probelauf: nur eingestuft
  const undo = { eintraege: [] };
  let anzahl = 0; const uebersprungen = [];
  for (const e of ziele) {
    if (e.ziel === "claude") {
      const p = ctx.profile.find((x) => x.pfad === e.profil) || { pfad: e.profil, name: e.profilName, standard: false };
      const alt = claudeNutzerEintrag(z, p);
      const prog = findeClaude({ env: z.env, home: z.home });
      if (!alt || typeof alt.command !== "string" || (alt.type && alt.type !== "stdio")) { uebersprungen.push("claude-projektebene"); continue; }
      if (!prog) { uebersprungen.push("claude-fehlt"); continue; }
      undo.eintraege.push({ ziel: "claude", profil: p.pfad, standard: !!p.standard, alt });
      ctx.merkeUndo(undo);
      if (!claudeSetze(z, prog, p, sollEintrag(z)) || !istGleich(claudeNutzerEintrag(z, p), z)) { claudeSetze(z, prog, p, alt); throw new Error("mcp-claude-fehlgeschlagen"); }
      anzahl++;
    } else if (e.ziel === "codex") {
      const prog = findeCodex(z);
      const datei = join(z.home, ".codex", "config.toml");
      if (!prog) { uebersprungen.push("codex-fehlt"); continue; }
      const alt = codexServer(z.home).servers.brain;
      const s = sichereDatei(z, ctx.sicherungsDir, datei, "codex-config.vor-a5.toml");
      const eintrag = { ziel: "codex", alt: alt ? { command: alt.command, args: alt.args } : null, datei, rel: s && s.rel, hashVorher: s && s.hash, hashNachher: null, modus: modusVon(datei) };
      undo.eintraege.push(eintrag);
      ctx.merkeUndo(undo);
      if (!codexSetze(z, prog, sollEintrag(z)) || !istGleich(codexServer(z.home).servers.brain, z)) { codexSetze(z, prog, eintrag.alt); throw new Error("mcp-codex-fehlgeschlagen"); }
      eintrag.hashNachher = hashDatei(datei);
      ctx.merkeUndo(undo);
      anzahl++;
    } else if (e.ziel === "cursor") {
      const datei = join(z.home, ".cursor", "mcp.json");
      let doc;
      try { doc = JSON.parse(readFileSync(datei, "utf8")); } catch { uebersprungen.push("cursor-unlesbar"); continue; }
      if (!istObjekt(doc) || !istObjekt(doc.mcpServers)) { uebersprungen.push("cursor-unlesbar"); continue; }
      const s = sichereDatei(z, ctx.sicherungsDir, datei, "cursor-mcp.vor-a5.json");
      const eintrag = { ziel: "cursor", datei, rel: s && s.rel, hashVorher: s && s.hash, hashNachher: null, modus: modusVon(datei), alt: doc.mcpServers.brain };
      undo.eintraege.push(eintrag);
      ctx.merkeUndo(undo);
      doc.mcpServers.brain = sollEintrag(z);
      schreibeAtomar(echtesDateiZiel(datei), JSON.stringify(doc, null, 2) + "\n", eintrag.modus);
      eintrag.hashNachher = hashDatei(datei);
      ctx.merkeUndo(undo);
      anzahl++;
    }
  }
  ctx.nachDaten = { eintraege: undo.eintraege.map((x) => ({ ziel: x.ziel, profil: x.profil })) };
  if (!anzahl) return { status: "uebersprungen", grund: uebersprungen[0] || "nichts-moeglich" };
  return { status: "ok", anzahl, details: { uebersprungen } };
}

export function nachpruefen(z, ctx) {
  const d = ctx.nachDaten;
  if (!d) return true;
  const profile = (p) => ctx.profile.find((x) => x.pfad === p);
  return d.eintraege.every((e) => {
    if (e.ziel === "claude") { const p = profile(e.profil); return !!p && istGleich(claudeServer(p, z.home).servers.brain, z); }
    if (e.ziel === "codex") return istGleich(codexServer(z.home).servers.brain, z);
    return istGleich(cursorServer(z.home).servers.brain, z);
  });
}

export function zurueck(z, ctx, undo) {
  const hinweise = [];
  let n = 0;
  for (const e of (undo && undo.eintraege) || []) {
    if (e.ziel === "claude") {
      const p = { pfad: e.profil, standard: !!e.standard, name: e.profil };
      const jetzt = claudeNutzerEintrag(z, p);
      const prog = findeClaude({ env: z.env, home: z.home });
      if (istGleich(jetzt, z) && prog) { claudeSetze(z, prog, p, e.alt); n++; }
      else if (!istGleich(jetzt, z)) { if (!(jetzt && jetzt.command === e.alt.command && JSON.stringify(jetzt.args || []) === JSON.stringify(e.alt.args || []))) hinweise.push("mcp-claude-geaendert"); }
      else hinweise.push("claude-fehlt");
    } else if (e.ziel === "codex") {
      const jetzt = hashDatei(e.datei);
      if (jetzt === e.hashVorher) continue;
      if (e.hashNachher && jetzt === e.hashNachher && e.rel) { stelleHer(e.datei, sicherungsPfad(z, e.rel), e.modus || 0o600); n++; }
      else if (istGleich(codexServer(z.home).servers.brain, z)) { const prog = findeCodex(z); if (prog) { codexSetze(z, prog, e.alt); n++; } else hinweise.push("codex-fehlt"); }
      else hinweise.push("mcp-codex-geaendert");
    } else if (e.ziel === "cursor") {
      const jetzt = hashDatei(e.datei);
      if (jetzt === e.hashVorher) continue;
      if (e.hashNachher && jetzt === e.hashNachher && e.rel) { stelleHer(e.datei, sicherungsPfad(z, e.rel), e.modus || 0o600); n++; }
      else {
        let doc = null; try { doc = JSON.parse(readFileSync(e.datei, "utf8")); } catch { /* unlesbar */ }
        if (doc && istObjekt(doc.mcpServers) && istGleich(doc.mcpServers.brain, z)) { if (e.alt === undefined) delete doc.mcpServers.brain; else doc.mcpServers.brain = e.alt; schreibeAtomar(echtesDateiZiel(e.datei), JSON.stringify(doc, null, 2) + "\n", e.modus || 0o600); n++; }
        else hinweise.push("mcp-cursor-geaendert");
      }
    }
  }
  return { status: n ? "ok" : "nichts", hinweise };
}
