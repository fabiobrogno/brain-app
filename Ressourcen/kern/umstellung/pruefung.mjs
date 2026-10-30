// umstellung/pruefung.mjs — die Prüfkriterien der Umstellung (Paket P7b, Plan Abschnitt 2.4) und die Momentaufnahme für „Original unberührt“.
//
// Dieselben Kriterien gelten für den Probelauf (an der Kopie, mit den umgestellten Zielen) und für Schritt A9 (lesend am Original):
//   1 Kern-Status ok · 2 Suche ok · 3 git-sicher ok · 4 Hooks zeigen auf den Starter · 5 MCP zeigt auf den stabilen Kern · 6 Hintergrunddienst · 7 Sicherung
//   8 Phase-B-Probe (nur Probelauf: die Kopie ohne den alten Werkzeug-Ordner, 1–4 erneut) · 9 Original unberührt (nur Probelauf)
// Jedes Kriterium: { nr, id, titel, status: gruen | rot | uebersprungen, grund? } – `grund` ist ein fester Kurztext, nie ein Wert.
// Die Momentaufnahme hält nur Hashes und Zählungen fest (SHA-256 von .git/config, brain.config.json, der Ausgabe von `git status --porcelain`, HEAD, settings.json je Profil,
// plist, globaler git-Konfiguration, MCP-Einträgen); `fingerabdruck` ist der stabile Teil davon – der Probelauf-Merker gilt nur für denselben Fingerabdruck.
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, accessSync, constants } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { KERN, liesConfigRoh, istOrdnerName, pruefeVault, kernVersion, ordner as ordnerNamen } from "../pfade.mjs";
import { minisuche } from "../minisuche.mjs";
import { pruefeBackupPfad, merkerDateiFuer } from "../backup.mjs";
import { LABEL } from "../tageslauf/dienst.mjs";
import { echtesGit, adressArt, pruefungAlle } from "./git-lage.mjs";
import { mcpLage, claudeServer, codexServer, cursorServer } from "./mcp-lage.mjs";
import { gitLauf, gitSicherLauf, kernSkript, kindUmgebung, kennung } from "./ziele.mjs";
import { hashDatei, hashText } from "./protokoll.mjs";
import { vorschauProfil, analysierePlist } from "./schritte.mjs";

const TITEL = {
  1: "Kortex findet deinen Vault, die Einstellungen sind in Ordnung",
  2: "Die Suche findet deine Notizen",
  3: "Der Versionsverlauf funktioniert, die Passwort-Prüfung vor dem Speichern läuft",
  4: "Claude Code ruft Kortex auf",
  5: "Die KI-Programme sind mit Kortex verbunden",
  6: "Der Hintergrunddienst startet Kortex",
  7: "Die Sicherung ist übernommen",
  8: "Auch ohne den alten Werkzeug-Ordner funktioniert alles",
  9: "Dein Original wurde nicht verändert",
};
const k = (nr, id, status, grund, extra = {}) => ({ nr, id, titel: TITEL[nr], status, ...(grund ? { grund } : {}), ...extra });
const gruen = (nr, id, extra) => k(nr, id, "gruen", undefined, extra);
const rot = (nr, id, grund, extra) => k(nr, id, "rot", grund, extra);
const uebersprungen = (nr, id, grund) => k(nr, id, "uebersprungen", grund);
const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);
const ausfuehrbar = (p) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };

// ----------------------------------------------------------------------------------------------------------------------------------
// Momentaufnahme
// ----------------------------------------------------------------------------------------------------------------------------------
function mcpHash(z) {
  const teile = [];
  const profile = z.claudeProfile;
  for (const p of profile) teile.push(JSON.stringify(claudeServer(p, z.home).servers));
  teile.push(JSON.stringify(codexServer(z.home).servers), JSON.stringify(cursorServer(z.home).servers));
  return hashText(teile.join("\n"));
}
// → Objekt mit Hashes (nie Inhalte). `mitStatus`: auch `git status --porcelain` (nur, wenn die Prüfung der Erlaubnisliste nichts beanstandet: dann startet kein Filter-Treiber)
export function momentaufnahme(z, { mitStatus = true } = {}) {
  const git = echtesGit(z.env);
  const m = { vault: {}, profile: {}, plist: hashDatei(join(z.launchAgents, `${LABEL}.plist`)), gitGlobal: hashDatei(z.gitGlobal), mcp: mcpHash(z), dienstJson: hashDatei(join(z.festSupport, "dienst.json")) };
  const hatGit = existsSync(join(z.vault, ".git"));
  m.vault.gitConfig = hashDatei(join(z.vault, ".git", "config"));
  m.vault.config = hashDatei(join(z.vault, "brain.config.json"));
  m.vault.agents = hashDatei(join(z.vault, "AGENTS.md"));
  m.vault.geraete = existsSync(join(z.vault, ".kortex")) ? "da" : null;
  m.vault.head = null; m.vault.status = null;
  if (hatGit && git) {
    const h = gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]);
    m.vault.head = h.status === 0 ? h.stdout.trim() : "keiner";
    if (mitStatus && pruefungAlle(git, z.vault, { home: z.home }).ok) {
      const s = gitLauf(z, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
      m.vault.status = s.status === 0 ? hashText(s.stdout) : null;
    }
  }
  for (const p of z.claudeProfile) {
    const f = join(p.pfad, "settings.json");
    let mtime = null; try { mtime = statSync(f).mtimeMs; } catch { /* fehlt */ }
    m.profile[p.pfad] = { settings: hashDatei(f), mtime };
  }
  return m;
}
// Der stabile Teil (ohne mtime und ohne `git status`: die Notizen dürfen sich zwischen Probelauf und Umstellung ändern)
export function fingerabdruck(m) {
  const profile = Object.fromEntries(Object.entries(m.profile).map(([p, v]) => [p, v.settings]));
  const { status, ...vault } = m.vault;
  return hashText(JSON.stringify({ vault, profile, plist: m.plist, gitGlobal: m.gitGlobal, mcp: m.mcp, dienstJson: m.dienstJson }));
}
// → Liste der Bereiche, die sich unterscheiden (Namen, keine Werte)
export function unterschiede(a, b) {
  const aus = [];
  const vergleiche = (pfad, x, y) => {
    if (istObjekt(x) && istObjekt(y)) { for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) vergleiche(`${pfad}${pfad ? "." : ""}${key}`, x[key], y[key]); }
    else if (JSON.stringify(x) !== JSON.stringify(y)) aus.push(pfad);
  };
  vergleiche("", a, b);
  return aus.map((p) => p.replace(/^\/.*\/(.*)$/, "$1"));
}

// ----------------------------------------------------------------------------------------------------------------------------------
// Hilfen
// ----------------------------------------------------------------------------------------------------------------------------------
const WIKI_AUSSCHLUSS = /^(?:_|INDEX)/;
// Eine Wiki-Seite zum Suchen: deterministisch aus dem Los (Kennung + Zeit), Titel aus der ersten Überschrift, sonst aus dem Dateinamen. → { rel, titel } | null
export function waehleWikiSeite(vault, los = "") {
  let wiki;
  try { wiki = ordnerNamen(vault).wiki; } catch { wiki = "09_wiki"; }
  const wurzel = join(vault, wiki), seiten = [];
  const lauf = (dir) => {
    let namen = [];
    try { namen = readdirSync(dir).sort(); } catch { return; }
    for (const n of namen) {
      const p = join(dir, n);
      let l; try { l = lstatSync(p); } catch { continue; }
      if (l.isSymbolicLink()) continue;
      if (l.isDirectory()) { if (!n.startsWith(".")) lauf(p); } else if (/\.md$/i.test(n) && !WIKI_AUSSCHLUSS.test(n)) seiten.push(p);
    }
  };
  lauf(wurzel);
  if (!seiten.length) return null;
  const i = parseInt(createHash("sha256").update(String(los)).digest("hex").slice(0, 8), 16) % seiten.length;
  const datei = seiten[i];
  let titel = "";
  try { const m = /^#\s+(.+)$/m.exec(readFileSync(datei, "utf8")); if (m) titel = m[1].trim(); } catch { /* ohne */ }
  if (!titel) titel = datei.replace(/^.*[\\/]/, "").replace(/\.md$/i, "").replace(/[-_]+/g, " ");
  return { rel: relative(vault, datei).split(sep).join("/"), titel };
}

// Probe-Frage über den MCP-Server selbst (stdio, JSON-RPC): initialize, dann tools/call brain_suchen – so, wie Claude es täte. Der Server startet ohne Vault und folgt dem aktiven
// Vault aus vaults.json des (Probe-)Support-Ordners. Frist 10 s. → { ok, treffer: [pfad…], grund? }
export function mcpProbe(z, frage) {
  return new Promise((fertig) => {
    let kind, uhr, ende = false;
    const raus = (ergebnis) => { if (ende) return; ende = true; clearTimeout(uhr); try { kind.kill("SIGKILL"); } catch { /* weg */ } fertig(ergebnis); };
    const env = kindUmgebung(z, { BRAIN_NUTZUNG: "aus" }); delete env.BRAIN_VAULT;
    try { kind = spawn(z.node, [z.mcpServer], { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); }
    catch { return fertig({ ok: false, treffer: [], grund: "server-startet-nicht" }); }
    uhr = setTimeout(() => raus({ ok: false, treffer: [], grund: "zeitueberschreitung" }), 10_000);
    kind.on("error", () => raus({ ok: false, treffer: [], grund: "server-startet-nicht" }));
    kind.on("exit", () => setTimeout(() => raus({ ok: false, treffer: [], grund: "server-antwortet-nicht" }), 300).unref());
    kind.stdin.on("error", () => { /* Server schon weg */ });
    const nachricht = (m) => JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n";
    let puffer = "";
    kind.stdout.setEncoding("utf8");
    kind.stdout.on("data", (d) => {
      puffer += d;
      let i;
      while ((i = puffer.indexOf("\n")) >= 0) {
        const zeile = puffer.slice(0, i); puffer = puffer.slice(i + 1);
        let m; try { m = JSON.parse(zeile); } catch { continue; }
        if (!m || m.jsonrpc !== "2.0") continue;
        if (m.id === 1) {
          if (m.error || !m.result) return raus({ ok: false, treffer: [], grund: "server-antwortet-nicht" });
          kind.stdin.write(nachricht({ method: "notifications/initialized" }));
          kind.stdin.write(nachricht({ id: 2, method: "tools/call", params: { name: "brain_suchen", arguments: { frage } } }));
        } else if (m.id === 2) {
          const r = m.result;
          if (m.error || !r || r.isError) return raus({ ok: false, treffer: [], grund: "suche-fehlgeschlagen" });
          const t = r._meta && Array.isArray(r._meta["brain-studio/treffer"]) ? r._meta["brain-studio/treffer"] : [];
          raus({ ok: true, treffer: t.map((x) => x && x.pfad).filter((x) => typeof x === "string") });
        }
      }
    });
    try { kind.stdin.write(nachricht({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kortex-umstellung-probe", version: kernVersion() } } })); } catch { /* oben */ }
  });
}

// ----------------------------------------------------------------------------------------------------------------------------------
// Kriterien
// ----------------------------------------------------------------------------------------------------------------------------------
const ORDNER_SCHLUESSEL = [["ordner", "inbox"], ["ordner", "wiki"], ["ordner", "archiv"], ["wiki", "ordner"]];

export function kriterium1(z) {
  try { pruefeVault(z.vault); } catch { return rot(1, "kern-status", "kein-gueltiger-vault"); }
  const roh = liesConfigRoh(z.vault);
  if (roh.fehler) return rot(1, "kern-status", "config-defekt");
  const cfg = roh.cfg && istObjekt(roh.cfg) ? roh.cfg : {};
  if (ORDNER_SCHLUESSEL.some(([a, b]) => istObjekt(cfg[a]) && cfg[a][b] !== undefined && !istOrdnerName(cfg[a][b]))) return rot(1, "kern-status", "ordnername-ungueltig");
  const r = kernSkript(z, "brain.mjs", ["status", "--vault", z.vault, "--json"]);
  if (r.status !== 0) return rot(1, "kern-status", "status-fehlgeschlagen");
  try { const j = JSON.parse(r.stdout.trim().split("\n").pop()); if (!j || typeof j !== "object") throw new Error("x"); } catch { return rot(1, "kern-status", "status-ohne-antwort"); }
  return gruen(1, "kern-status");
}

export function kriterium2(z, ctx = {}) {
  const seite = waehleWikiSeite(z.vault, ctx.los || kennung(z.vault));
  if (!seite) return uebersprungen(2, "suche", "keine-wiki-seite");
  let treffer;
  try { treffer = minisuche(z.vault, seite.titel, 5); } catch { return rot(2, "suche", "suche-fehlgeschlagen"); }
  if (!treffer.some((t) => t.pfad === seite.rel)) return rot(2, "suche", "seite-nicht-gefunden");
  return gruen(2, "suche", { seite: seite.rel });
}

export function kriterium3(z, { testCommit = false } = {}) {
  if (!existsSync(join(z.vault, ".git"))) return uebersprungen(3, "git-sicher", "kein-git");
  const s = gitSicherLauf(z, ["status", "--porcelain"]);
  if (s.status === 126) return rot(3, "git-sicher", "git-gesperrt");
  if (s.status !== 0) return rot(3, "git-sicher", "status-fehlgeschlagen");
  const l = gitSicherLauf(z, ["log", "-1", "--format=%H"]);
  if (l.status !== 0) { const leer = gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]).status !== 0; if (!leer) return rot(3, "git-sicher", "log-fehlgeschlagen"); }
  if (testCommit) {
    const hp = gitLauf(z, ["config", "--local", "--get", "core.hooksPath"]).stdout.trim();
    const c = gitSicherLauf(z, ["commit", "--allow-empty", "-q", "-m", "probe"]);
    if (c.status !== 0) return rot(3, "git-sicher", "test-commit-fehlgeschlagen");
    return gruen(3, "git-sicher", { hookLaeuft: !!z.kern && hp.split("\\").join("/") === join(z.kern, "git-hooks").split("\\").join("/") });
  }
  return gruen(3, "git-sicher");
}

// 4: Hooks. Probelauf: die Vorschau je Profil; Original: --stand. Ende-zu-Ende (nur Probelauf): der Kern startet über den Hook-Weg einer Eingabe, ohne etwas Dauerhaftes zu starten.
export function kriterium4(z, ctx, { vorschau = true } = {}) {
  if (!z.starter || !z.kern) return rot(4, "hooks", "kein-stabiler-kern");
  if (!ausfuehrbar(z.starter) && z.env.KORTEX_KERN_UNSTABIL_ERLAUBT !== "1") return rot(4, "hooks", "starter-fehlt");
  const profile = ctx.profile || z.claudeProfile;
  if (!profile.length) return uebersprungen(4, "hooks", "kein-claude-profil");
  let rest = 0, fremdeStatuszeile = 0;
  for (const p of profile) {
    if (vorschau) {
      const v = vorschauProfil(z, p);
      if (!v.vorschau) return rot(4, "hooks", "einstellungen-nicht-lesbar");
      // nach der Umstellung müssen alle Hooks in neuer Form stehen (hier: nach Anwendung der Vorschau im Speicher)
      if (v.vorschau.hooks.neueForm !== v.vorschau.hooks.soll) return rot(4, "hooks", "hooks-unvollstaendig");
      if (v.vorschau.statuszeile === "alt") return rot(4, "hooks", "statuszeile-alt");
      if (v.vorschau.statuszeile === "fremd") fremdeStatuszeile++;
      rest += v.vorschau.restVerweise;
    } else {
      const r = kernSkript(z, join("adapters", "claude-code", "install.mjs"), ["--stand", "--claude-home", p.pfad]);
      let j = null; try { j = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* unten */ }
      if (!j || j.aktiv !== true) return rot(4, "hooks", "hooks-nicht-umgestellt");
    }
  }
  if (ctx.endeZuEnde) {
    const v = kernSkript(z, "brain.mjs", ["version"]);
    if (v.status !== 0 || v.stdout.trim() !== kernVersion()) return rot(4, "hooks", "kern-startet-nicht");
    const h = spawnSync(process.execPath, [join(KERN, "adapters", "claude-code", "regeln-lesen.mjs")], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", session_id: "umstellung-probe", tool_input: { file_path: join(z.vault, "brain.config.json") }, cwd: z.vault }),
      encoding: "utf8", env: kindUmgebung(z), cwd: z.home, timeout: 30_000, windowsHide: true,
    });
    if (h.status !== 0) return rot(4, "hooks", "hook-fehlgeschlagen");
  }
  return gruen(4, "hooks", { restVerweise: rest, fremdeStatuszeile });
}

export async function kriterium5(z, ctx, { probe = false } = {}) {
  if (!z.mcpServer || !z.kern) return rot(5, "mcp", "kein-stabiler-kern");
  if (!existsSync(z.mcpServer)) return rot(5, "mcp", "server-fehlt");
  if (!existsSync(z.node)) return rot(5, "mcp", "node-fehlt");
  // vorhandene Einträge: alt oder gleich (anders bleibt eine Frage)
  const vaulte = [z.musterVault];
  try { const j = JSON.parse(readFileSync(join(z.festSupport, "vaults.json"), "utf8")); for (const e of Array.isArray(j?.vaults) ? j.vaults : []) if (e && typeof e.pfad === "string") vaulte.push(e.pfad); } catch { /* keine Liste */ }
  const lage = mcpLage({ home: z.home, support: z.festSupport, profile: ctx.profile || z.claudeProfile, vaults: vaulte });
  const anders = lage.filter((e) => e.art === "anders").length;
  if (!probe) {
    const alt = lage.filter((e) => e.art === "alt").length;
    if (alt) return rot(5, "mcp", "eintrag-noch-alt");
  }
  if (probe) {
    const seite = waehleWikiSeite(z.vault, ctx.los || kennung(z.vault));
    if (seite) {
      const r = await mcpProbe(z, seite.titel);
      if (!r.ok) return rot(5, "mcp", r.grund);
      if (!r.treffer.includes(seite.rel)) return rot(5, "mcp", "seite-nicht-gefunden");
    }
  }
  return gruen(5, "mcp", { fragen: anders });
}

export function kriterium6(z, ctx, { probe = false } = {}) {
  if (z.plattform !== "darwin") return uebersprungen(6, "dienst", "kein-mac");   // nicht anwendbar: kein Hintergrunddienst, A9 wird davon nie rot
  const datei = join(z.launchAgents, `${LABEL}.plist`);
  let text = null; try { text = readFileSync(datei, "utf8"); } catch { /* keiner */ }
  if (text === null) return uebersprungen(6, "dienst", "kein-dienst");
  const a = analysierePlist(text, [z.vault, z.musterVault]);
  if (a.alt) return rot(6, "dienst", "plist-noch-alt");
  if (/BRAIN_VAULT|node-start\.sh|\/bin\/sh/.test(text)) return rot(6, "dienst", "plist-noch-alt");
  if (!z.starter || !text.includes(z.starter) || !/tageslauf<\/string>\s*<string>--wenn-faellig<\/string>\s*<string>--dienst/.test(text)) return rot(6, "dienst", "plist-ohne-starter");
  if (existsSync("/usr/bin/plutil") && spawnSync("/usr/bin/plutil", ["-lint", datei], { encoding: "utf8", windowsHide: true }).status !== 0) return rot(6, "dienst", "plist-ungueltig");
  if (probe && ctx.altesProfil) { if (!text.includes(`<key>CLAUDE_CONFIG_DIR</key><string>${ctx.altesProfil}</string>`) && !text.includes(ctx.altesProfil)) return rot(6, "dienst", "profil-verloren"); }
  return gruen(6, "dienst");
}

export function kriterium7(z, ctx) {
  const roh = liesConfigRoh(z.vault);
  const bp = roh.cfg && istObjekt(roh.cfg.backup) && typeof roh.cfg.backup.pfad === "string" ? roh.cfg.backup.pfad : null;
  let merker = {};
  try { const o = JSON.parse(readFileSync(merkerDateiFuer(z.vault, z.support), "utf8")); if (istObjekt(o)) merker = o; } catch { /* keiner */ }
  if (bp) {
    if (merker.pfad !== bp) {
      // ein ungültiger oder abweichender alter Ordner wird nicht übernommen: Frage, kein Fehler der Umstellung
      return pruefeBackupPfad(bp) ? uebersprungen(7, "sicherung", "ordner-ungueltig") : (merker.pfad ? uebersprungen(7, "sicherung", "ordner-abweichend") : rot(7, "sicherung", "ordner-nicht-uebernommen"));
    }
    if (pruefeBackupPfad(merker.pfad)) return rot(7, "sicherung", "ordner-ungueltig");
  }
  const git = echtesGit(z.env);
  let art = "keine";
  if (git && existsSync(join(z.vault, ".git"))) { const r = gitLauf(z, ["config", "--local", "--get", "remote.origin.url"]); if (r.status === 0 && r.stdout.trim()) art = adressArt(r.stdout.trim()); }
  if (!bp && art === "keine") return uebersprungen(7, "sicherung", "keine-sicherung");
  return gruen(7, "sicherung", { onlineZiel: art === "https" || art === "ssh" ? art : null, bestaetigt: !!merker.remoteBestaetigt });
}

// A9: die Kriterien 1–7 lesend am Original (nur Stand, Suche, git-sicher status, Hooks-Stand, MCP-Dateien, Dienst-Datei)
export async function pruefeAmOriginal(z, ctx) {
  const liste = [kriterium1(z), kriterium2(z, ctx), kriterium3(z, { testCommit: false }), kriterium4(z, ctx, { vorschau: false }), await kriterium5(z, ctx, { probe: false }), kriterium6(z, ctx), kriterium7(z, ctx)];
  return liste;
}
export const ampel = (kriterien) => (kriterien.some((c) => c.status === "rot") ? "rot" : "gruen");
