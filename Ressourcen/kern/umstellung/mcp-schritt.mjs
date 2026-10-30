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
import { mcpLage, claudeServer, codexServer, cursorServer } from "./mcp-lage.mjs";
import { kontoLeser, kontoFuerZiel } from "./konto.mjs";
import { kindUmgebung, findeClaudeProgramm } from "./ziele.mjs";
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
// KI-Konten: ein Eintrag trägt `--konto <id>` am Ende, sobald Kortex das Konto kennt (docs/plaene/ki-konten.md); ohne Kennung bleibt es die Altform.
const serverArgs = (z, konto) => [z.mcpServer, ...(konto ? ["--konto", konto] : [])];
const sollEintrag = (z, konto = null) => ({ command: z.node, args: serverArgs(z, konto) });
const istGleich = (e, z, konto = null) => !!e && e.command === z.node && Array.isArray(e.args) && JSON.stringify(e.args) === JSON.stringify(serverArgs(z, konto));
// Die Liste der KI-Konten liegt im echten Support-Ordner (auch im Probelauf), gelesen wird nur.
const kontoLies = (z) => kontoLeser(z.supportOriginal || z.support);
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
const gleichWert = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Claude Code: den NEUEN Eintrag setzen (remove, dann add – beides mit geprüftem Exit-Code) und den ALTEN verlustfrei wieder eintragen (`add-json` mit dem gesicherten Eintrag, nie
// `add -e …`: --env ist variadisch und frisst den Namen). → true, wenn der Zustand danach stimmt.
function claudeNeuSetzen(z, prog, p, konto = null) {
  if (lauf(z, prog, ["mcp", "remove", "-s", "user", "brain"], claudeEnv(p)).status !== 0) return false;
  return lauf(z, prog, ["mcp", "add", "-s", "user", "brain", "--", z.node, ...serverArgs(z, konto)], claudeEnv(p)).status === 0 && istGleich(claudeNutzerEintrag(z, p), z, konto);
}
function claudeAltHerstellen(z, prog, p, alt) {
  const jetzt = claudeNutzerEintrag(z, p);
  if (gleichWert(jetzt, alt)) return true;
  if (jetzt && lauf(z, prog, ["mcp", "remove", "-s", "user", "brain"], claudeEnv(p)).status !== 0) return false;
  return lauf(z, prog, ["mcp", "add-json", "-s", "user", "brain", JSON.stringify(alt)], claudeEnv(p)).status === 0 && gleichWert(claudeNutzerEintrag(z, p), alt);
}
// Codex: der Eintrag besteht aus [mcp_servers.brain] und Unterabschnitten (z. B. .env) in config.toml. Wir sichern den Text dieser Abschnitte vollständig (Zusatzfelder, env) und
// stellen ihn als Text wieder her; neu setzen geht über das Programm.
const CODEX_ABSCHNITT = /^\[mcp_servers\.(?:"brain"|brain)(?:\.[^\]]*)?\]/;
export function codexAbschnitte(text) {
  const teile = String(text || "").split(/^(?=\[)/m);
  return { brain: teile.filter((x) => CODEX_ABSCHNITT.test(x)).join(""), rest: teile.filter((x) => !CODEX_ABSCHNITT.test(x)).join("") };
}
function codexNeuSetzen(z, prog, konto = null) {
  if (lauf(z, prog, ["mcp", "remove", "brain"]).status !== 0) return false;
  return lauf(z, prog, ["mcp", "add", "brain", "--", z.node, ...serverArgs(z, konto)]).status === 0 && istGleich(codexServer(z.home).servers.brain, z, konto);
}
function codexAltHerstellen(datei, altText, modus) {
  const t = (() => { try { return readFileSync(datei, "utf8"); } catch { return ""; } })();
  const { rest } = codexAbschnitte(t);
  schreibeAtomar(echtesDateiZiel(datei), rest + (rest && !rest.endsWith("\n") && altText ? "\n" : "") + altText, modus || 0o600);
}

export function lage(z, ctx) {
  if (!z.mcpServer) return [];
  const lies = kontoLies(z);
  return mcpLage({ home: z.home, support: z.festSupport, profile: ctx.profile, vaults: bekannteVaults(z), konto: (ziel, profil) => kontoFuerZiel(lies, ziel, z.home, profil) });
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
      const prog = findeClaudeProgramm(z);
      if (!alt || typeof alt.command !== "string" || (alt.type && alt.type !== "stdio")) { uebersprungen.push("claude-projektebene"); continue; }
      if (!prog) { uebersprungen.push("claude-fehlt"); continue; }
      undo.eintraege.push({ ziel: "claude", profil: p.pfad, standard: !!p.standard, alt, konto: e.konto || null });
      ctx.merkeUndo(undo);
      if (!claudeNeuSetzen(z, prog, p, e.konto || null)) {
        // zurück auf den alten Eintrag; gelingt auch das nicht, steht er vollständig in den Rückweg-Angaben (der Rückweg versucht es noch einmal)
        if (!claudeAltHerstellen(z, prog, p, alt)) throw new Error("mcp-claude-eintrag-verloren");
        throw new Error("mcp-claude-fehlgeschlagen");
      }
      ctx.pruefpunkt("nach-claude");
      anzahl++;
    } else if (e.ziel === "codex") {
      const prog = findeCodex(z);
      const datei = join(z.home, ".codex", "config.toml");
      if (!prog) { uebersprungen.push("codex-fehlt"); continue; }
      const alt = codexServer(z.home).servers.brain;
      const s = sichereDatei(z, ctx.sicherungsDir, datei, "codex-config.vor-a5.toml");
      const eintrag = { ziel: "codex", konto: e.konto || null, altText: codexAbschnitte((() => { try { return readFileSync(datei, "utf8"); } catch { return ""; } })()).brain, datei, rel: s && s.rel, hashVorher: s && s.hash, hashNachher: null, modus: modusVon(datei) };
      undo.eintraege.push(eintrag);
      ctx.merkeUndo(undo);
      if (!codexNeuSetzen(z, prog, e.konto || null)) {
        // Fehlerpfad: die gesicherte Datei Byte für Byte zurück (verliert nichts, auch env und Zusatzfelder nicht)
        if (eintrag.rel) stelleHer(datei, sicherungsPfad(z, eintrag.rel), eintrag.modus || 0o600);
        throw new Error("mcp-codex-fehlgeschlagen");
      }
      ctx.pruefpunkt("nach-codex");
      eintrag.hashNachher = hashDatei(datei);
      ctx.merkeUndo(undo);
      anzahl++;
    } else if (e.ziel === "cursor") {
      const datei = join(z.home, ".cursor", "mcp.json");
      let doc;
      try { doc = JSON.parse(readFileSync(datei, "utf8")); } catch { uebersprungen.push("cursor-unlesbar"); continue; }
      if (!istObjekt(doc) || !istObjekt(doc.mcpServers)) { uebersprungen.push("cursor-unlesbar"); continue; }
      const s = sichereDatei(z, ctx.sicherungsDir, datei, "cursor-mcp.vor-a5.json");
      const eintrag = { ziel: "cursor", konto: e.konto || null, datei, rel: s && s.rel, hashVorher: s && s.hash, hashNachher: null, modus: modusVon(datei), alt: doc.mcpServers.brain };
      undo.eintraege.push(eintrag);
      ctx.merkeUndo(undo);
      doc.mcpServers.brain = sollEintrag(z, e.konto || null);
      schreibeAtomar(echtesDateiZiel(datei), JSON.stringify(doc, null, 2) + "\n", eintrag.modus);
      eintrag.hashNachher = hashDatei(datei);
      ctx.merkeUndo(undo);
      anzahl++;
    }
  }
  ctx.nachDaten = { eintraege: undo.eintraege.map((x) => ({ ziel: x.ziel, profil: x.profil, konto: x.konto || null })) };
  if (!anzahl) return { status: "uebersprungen", grund: uebersprungen[0] || "nichts-moeglich" };
  return { status: "ok", anzahl, details: { uebersprungen } };
}

export function nachpruefen(z, ctx) {
  const d = ctx.nachDaten;
  if (!d) return true;
  const profile = (p) => ctx.profile.find((x) => x.pfad === p);
  return d.eintraege.every((e) => {
    if (e.ziel === "claude") { const p = profile(e.profil); return !!p && istGleich(claudeServer(p, z.home).servers.brain, z, e.konto || null); }
    if (e.ziel === "codex") return istGleich(codexServer(z.home).servers.brain, z, e.konto || null);
    return istGleich(cursorServer(z.home).servers.brain, z, e.konto || null);
  });
}

export function zurueck(z, ctx, undo) {
  const hinweise = [];
  let n = 0;
  for (const e of (undo && undo.eintraege) || []) {
    if (e.ziel === "claude") {
      const p = { pfad: e.profil, standard: !!e.standard, name: e.profil };
      const jetzt = claudeNutzerEintrag(z, p);
      const prog = findeClaudeProgramm(z);
      if (gleichWert(jetzt, e.alt)) continue;                                              // schon wieder der alte Eintrag
      if (jetzt !== null && !istGleich(jetzt, z, e.konto || null)) { hinweise.push("mcp-claude-geaendert"); continue; }   // du hast ihn inzwischen selbst geändert: bleibt
      if (!prog) { hinweise.push("claude-fehlt"); continue; }
      if (claudeAltHerstellen(z, prog, p, e.alt)) n++; else hinweise.push("mcp-claude-nicht-zurueck");
    } else if (e.ziel === "codex") {
      const jetzt = hashDatei(e.datei);
      if (jetzt === e.hashVorher) continue;
      if ((ctx && ctx.imFehler) && e.rel) { stelleHer(e.datei, sicherungsPfad(z, e.rel), e.modus || 0o600); n++; }
      else if (e.hashNachher && jetzt === e.hashNachher && e.rel) { stelleHer(e.datei, sicherungsPfad(z, e.rel), e.modus || 0o600); n++; }
      else if (istGleich(codexServer(z.home).servers.brain, z, e.konto || null) || (e.hashNachher === null && !codexServer(z.home).servers.brain)) { codexAltHerstellen(e.datei, e.altText || "", e.modus); n++; }
      else hinweise.push("mcp-codex-geaendert");
    } else if (e.ziel === "cursor") {
      const jetzt = hashDatei(e.datei);
      if (jetzt === e.hashVorher) continue;
      if (e.hashNachher && jetzt === e.hashNachher && e.rel) { stelleHer(e.datei, sicherungsPfad(z, e.rel), e.modus || 0o600); n++; }
      else {
        let doc = null; try { doc = JSON.parse(readFileSync(e.datei, "utf8")); } catch { /* unlesbar */ }
        if (doc && istObjekt(doc.mcpServers) && istGleich(doc.mcpServers.brain, z, e.konto || null)) { if (e.alt === undefined) delete doc.mcpServers.brain; else doc.mcpServers.brain = e.alt; schreibeAtomar(echtesDateiZiel(e.datei), JSON.stringify(doc, null, 2) + "\n", e.modus || 0o600); n++; }
        else hinweise.push("mcp-cursor-geaendert");
      }
    }
  }
  return { status: n ? "ok" : "nichts", hinweise };
}
