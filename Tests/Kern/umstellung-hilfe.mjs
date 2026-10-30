// umstellung-hilfe.mjs — gemeinsame Bausteine für die Tests der Umstellung (P7b). KEIN Test.
//   const h = umstellungsFixture(["kit-versioniert", "credential-helper", …]);   h.a (altvault), h.z (Ziele), h.weg()
// Alles in Temp: eigenes HOME, eigener Support-Ordner, eigene globale git-Konfiguration, launchctl/claude/codex nur als Attrappe. Setzt die Prozess-Umgebung (process.env) – weg() stellt sie her.
import { writeFileSync, rmSync, symlinkSync, readFileSync, existsSync, lstatSync, readlinkSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { altvault } from "./fixture-altvault.mjs";
import { KERN } from "../pfade.mjs";
import { echteZiele } from "../umstellung/ziele.mjs";
import { schreibeVertrauen } from "../umstellung/vertrauen-merker.mjs";
import { momentaufnahme, fingerabdruck } from "../umstellung/pruefung.mjs";
import { schreibeProbelaufMerker } from "../umstellung/probelauf-merker.mjs";
import { normalisiereEntscheidungen } from "../umstellung/schrittliste.mjs";
import { entscheidungenHash } from "../umstellung/phase-a.mjs";

const FAKE = (n) => new URL(`./${n}`, import.meta.url).pathname;
const MERKEN = ["KORTEX_KERN_PFAD", "KORTEX_KERN_TEMP_WURZELN", "KORTEX_KERN_UNSTABIL_ERLAUBT", "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "KORTEX_CODEX_PROGRAMM", "GIT_CONFIG_GLOBAL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "FAKE_MCP_LOG", "FAKE_MCP_FAIL", "FAKE_LAUNCHCTL_LOG", "FAKE_LAUNCHCTL_FAIL", "FAKE_LAUNCHCTL_VORGELADEN", "BRAIN_APP_SUPPORT", "HOME", "KORTEX_VAULT_VERTRAUT", "BRAIN_TESTMODUS", "CLAUDE_CONFIG_DIR", "KORTEX_DIENST_PLATTFORM"];

export function umstellungsFixture(faelle = [], { globalText = "[user]\n\tname = Test\n\temail = test@example.org\n", ohneMcpAttrappen = false, vaultName = null, vertrauen = "echt" } = {}) {
  const a = altvault({ faelle, vaultName });
  const gespeichert = Object.fromEntries(MERKEN.map((k) => [k, process.env[k]]));
  // der Hook-Ordner des Kerns im Wegwerf-Support ist der echte (git-sicher führt Hooks nur aus dem Kern-Ordner aus)
  const hooks = join(a.support, "bin", "kern", "git-hooks");
  rmSync(hooks, { recursive: true, force: true });
  symlinkSync(join(KERN, "git-hooks"), hooks);
  const gitGlobal = join(a.basis, "gitconfig-global");
  writeFileSync(gitGlobal, globalText);
  const log = join(a.basis, "launchctl.log"), mcpLog = join(a.basis, "mcp.log");
  // Workspace-Trust (P5): "echt" = der Vault steht im echten Merker des Temp-Supports (<Support>/vertrauen.json), der Testschalter KORTEX_VAULT_VERTRAUT ist AUS; "kein" = weder Merker
  // noch Schalter (nicht vertraut); "alle" = nur der Testschalter.
  delete process.env.KORTEX_VAULT_VERTRAUT;
  if (vertrauen === "echt") schreibeVertrauen(a.support, a.vault, "geklont");
  else if (vertrauen === "alle") process.env.KORTEX_VAULT_VERTRAUT = "alle";
  delete process.env.CLAUDE_CONFIG_DIR;   // nie das echte Profil der Entwicklungsumgebung: kein Test darf es erreichen
  Object.assign(process.env, {
    HOME: a.home, KORTEX_DIENST_PLATTFORM: "darwin", KORTEX_KERN_PFAD: join(a.support, "bin", "kern"), KORTEX_KERN_TEMP_WURZELN: "", KORTEX_KERN_UNSTABIL_ERLAUBT: "1",
    BRAIN_LAUNCHCTL: FAKE("fake-launchctl.mjs"), FAKE_LAUNCHCTL_LOG: log, FAKE_MCP_LOG: mcpLog, BRAIN_APP_SUPPORT: a.support, GIT_CONFIG_GLOBAL: gitGlobal,
    GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org",
    ...(ohneMcpAttrappen ? {} : { BRAIN_CLAUDE: FAKE("fake-claude-mcp.mjs"), KORTEX_CODEX_PROGRAMM: FAKE("fake-codex-mcp.mjs") }),
  });
  if (ohneMcpAttrappen) { delete process.env.BRAIN_CLAUDE; delete process.env.KORTEX_CODEX_PROGRAMM; }
  const z = () => echteZiele({ vault: a.vault, home: a.home, env: process.env });
  return {
    a, gitGlobal, log, mcpLog, z, zeilen: (datei) => (existsSync(datei) ? readFileSync(datei, "utf8").split("\n").filter(Boolean) : []),
    weg() {
      for (const [k, v] of Object.entries(gespeichert)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      a.weg();
    },
  };
}
// Schreibt einen grünen Probelauf-Merker für den jetzigen Stand (damit Tests einzelne Schritte der Phase A prüfen können, ohne jedes Mal den ganzen Probelauf zu fahren)
export function freigabe(z, entscheidungen = {}) {
  const ent = normalisiereEntscheidungen(entscheidungen);
  schreibeProbelaufMerker(z, { zeit: new Date().toISOString(), ergebnis: "gruen", fingerabdruck: fingerabdruck(momentaufnahme(z, { mitStatus: false })), entscheidungen: entscheidungenHash(ent), kriterien: [] });
}

// Stand eines Baums nur nach Inhalt (Pfad, Art, Hash, Verweisziel – ohne Änderungszeiten); `ohne`: Pfadbestandteile, die übersprungen werden (z. B. ".git", ".logs")
export function inhaltsStand(wurzel, { ohne = [] } = {}) {
  const z = [];
  const lauf = (p, rel) => {
    let l;
    try { l = lstatSync(p); } catch { z.push(`${rel}\tfehlt`); return; }
    if (l.isSymbolicLink()) { z.push(`${rel}\tlink\t${readlinkSync(p)}`); return; }
    if (l.isDirectory()) { z.push(`${rel}\tdir`); for (const n of readdirSync(p).sort()) if (!ohne.includes(n)) lauf(join(p, n), `${rel}/${n}`); return; }
    let h = ""; try { h = createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { /* unlesbar */ }
    z.push(`${rel}\tdatei\t${h}`);
  };
  lauf(wurzel, ".");
  return z.join("\n");
}
// Alles, was eine Umstellung ändern kann: Home, globale git-Konfiguration, Support-Ordner (ohne die Ablage der Umstellung), Vault-Arbeitsbaum (ohne .git/.logs), .git/config, HEAD-Baum
export function umstellungsStand(h) {
  const { a, gitGlobal } = h;
  const cfg = join(a.vault, ".git", "config");
  let tree = "";
  try { tree = a.g("rev-parse", "HEAD^{tree}").trim(); } catch { /* kein git */ }
  return [
    inhaltsStand(a.home, { ohne: [".claude.json"] }), inhaltsStand(gitGlobal), inhaltsStand(a.support, { ohne: ["umstellung", "logs"] }), inhaltsStand(a.vault, { ohne: [".git", ".logs"] }),
    existsSync(cfg) ? createHash("sha256").update(readFileSync(cfg)).digest("hex") : "keine-config", tree,
  ].join("\n====\n");
}
