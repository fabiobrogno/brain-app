// fixture-altvault.mjs — baut in Temp einen Vault aus der Kit-Zeit (Paket P7a, Plan docs/plaene/p7-umstellung.md Abschnitt 8.5). KEIN Test.
//
//   const a = altvault({ faelle: ["kit-versioniert", "credential-helper"] });
//   a.vault, a.home, a.support, a.opt (Optionen für erstelleBefund), a.weg()
//
// Ausgangslage ohne Fälle = ein sauberer Kortex-Vault: Versionsverlauf mit einem Commit, brain.config.json, Wiki, und in einem Wegwerf-HOME alles in NEUER
// Form (Claude-Hooks und Statuszeile über den Starter, MCP-Eintrag „brain“ gleich, Hintergrunddienst über den Starter, core.hooksPath auf den Kern). Jeder Fall
// setzt genau EINE Altlast dazu. Alle Werte, die nie in einem Bericht stehen dürfen, tragen die Marke GEHEIM (Tests prüfen, dass sie nirgends auftaucht).
// Es wird nur in Temp geschrieben: nie ein echtes HOME, kein echter Support-Ordner, kein launchctl.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync, readFileSync, renameSync, lstatSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const GEHEIM = "GEHEIM-xyz";
export class FixtureNichtMoeglich extends Error {}

const HOOKS = ["session-start", "brain-hint", "wiki-guard", "werkzeug-protokoll", "regeln-lesen", "kompakt-sichern", "ernte-ausloeser", "sitzung-ende"];
const EREIGNIS = { "session-start": "SessionStart", "brain-hint": "UserPromptSubmit", "wiki-guard": "PreToolUse", "werkzeug-protokoll": "PreToolUse", "regeln-lesen": "PreToolUse", "kompakt-sichern": "PreCompact", "ernte-ausloeser": "SessionEnd", "sitzung-ende": "SessionEnd" };
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const neuerHookBefehl = (starter, name) => `[ -x ${q(starter)} ] && exec ${q(starter)} hook ${name} || exit 0`;

export function altvault({ faelle = [], vaultName = null } = {}) {
  const imHome = faelle.some((f) => f.startsWith("hooks-alt-home") || f === "hooks-alt-tilde");
  const basis = realpathSync(mkdtempSync(join(tmpdir(), "umstellung-")));
  const home = join(basis, "home");
  const support = join(basis, "support");
  const extern = join(basis, "extern");
  const name = vaultName || (faelle.includes("pfad-sonderzeichen") ? "Vault Ä 'x" : "vault");
  const vault = imHome ? join(home, name) : join(basis, name);
  for (const d of [home, support, extern, vault, join(support, "bin", "kern", "mcp"), join(support, "bin", "kern", "git-hooks"), join(home, "Library", "LaunchAgents"), join(home, ".claude")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(support, "bin", "node"), "#!/bin/sh\n");
  writeFileSync(join(support, "bin", "kortex"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(support, "bin", "kern", "mcp", "brain-mcp.mjs"), "// mcp\n");

  const ENV = { PATH: process.env.PATH, HOME: home, LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" };
  const g = (...a) => execFileSync("git", ["-C", vault, ...a], { env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const schreibe = (pfad, text, modus) => { mkdirSync(dirname(pfad), { recursive: true }); writeFileSync(pfad, text, modus ? { mode: modus } : undefined); };
  const jsonDatei = (pfad) => { try { return JSON.parse(readFileSync(pfad, "utf8")); } catch { return {}; } };

  // ---- Ausgangslage: sauberer Kortex-Vault ----
  const config = { ordner: { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv" }, sprache: "de" };
  const schreibeConfig = (c) => writeFileSync(join(vault, "brain.config.json"), JSON.stringify(c, null, 2) + "\n");
  const aendereConfig = (fn) => { const c = jsonDatei(join(vault, "brain.config.json")); fn(c); schreibeConfig(c); };
  schreibeConfig(config);
  schreibe(join(vault, "00_inbox", ".gitkeep"), "");
  schreibe(join(vault, "09_wiki", "start.md"), "# Start\n\nEine Wiki-Seite.\n");
  schreibe(join(vault, ".gitignore"), ".logs/\n");
  try { g("init", "-q", "-b", "main", ...(faelle.includes("refstorage") ? ["--ref-format=reftable"] : [])); }
  catch { if (faelle.includes("refstorage")) { rmSync(basis, { recursive: true, force: true }); throw new FixtureNichtMoeglich("git kennt --ref-format=reftable nicht"); } throw new Error("git init schlug fehl"); }
  g("add", "--", "."); g("commit", "-q", "-m", "Start");
  const gitHooksKern = join(support, "bin", "kern", "git-hooks");
  g("config", "core.hooksPath", gitHooksKern);

  // Claude-Profil in neuer Form
  const profilStandard = join(home, ".claude");
  const neueHooks = () => {
    const s = { hooks: {}, statusLine: { type: "command", command: neuerHookBefehl(join(support, "bin", "kortex"), "statusline"), refreshInterval: 10 } };
    for (const h of HOOKS) (s.hooks[EREIGNIS[h]] ||= []).push({ hooks: [{ type: "command", command: neuerHookBefehl(join(support, "bin", "kortex"), h) }] });
    return s;
  };
  const schreibeSettings = (profil, s) => schreibe(join(profil, "settings.json"), JSON.stringify(s, null, 2) + "\n");
  const lies = (profil) => jsonDatei(join(profil, "settings.json"));
  schreibeSettings(profilStandard, neueHooks());

  // MCP „brain“ gleich
  const mcpSoll = { command: join(support, "bin", "node"), args: [join(support, "bin", "kern", "mcp", "brain-mcp.mjs")] };
  const schreibeClaudeJson = (pfad, brain, mehr = {}) => schreibe(pfad, JSON.stringify({ mcpServers: { ...(brain ? { brain } : {}), ...mehr } }, null, 2) + "\n");
  schreibeClaudeJson(join(home, ".claude.json"), mcpSoll);

  // Hintergrunddienst neu
  const plistPfad = join(home, "Library", "LaunchAgents", "de.brain.tageslauf.plist");
  const plist = ({ vaultEnv = null, profil = null, alt = false } = {}) => {
    const args = alt ? [join(vault, ".tools", "node-start.sh"), join(vault, ".tools", "brain.mjs"), "tageslauf", "--wenn-faellig"] : [join(support, "bin", "kortex"), "tageslauf", "--wenn-faellig", "--dienst"];
    const env = [["PATH", "/usr/bin:/bin"], ...(vaultEnv ? [["BRAIN_VAULT", vaultEnv]] : []), ...(profil ? [["CLAUDE_CONFIG_DIR", profil]] : [])];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>de.brain.tageslauf</string>\n  <key>ProgramArguments</key>\n  <array>\n${args.map((a) => `    <string>${a.replace(/&/g, "&amp;")}</string>`).join("\n")}\n  </array>\n  <key>EnvironmentVariables</key>\n  <dict>\n${env.map(([k, v]) => `    <key>${k}</key><string>${v.replace(/&/g, "&amp;")}</string>`).join("\n")}\n  </dict>\n</dict>\n</plist>\n`;
  };
  writeFileSync(plistPfad, plist());

  // ---- Fälle ----
  const kit = () => {
    schreibe(join(vault, ".tools", "VERSION"), "0.5.1\n");
    schreibe(join(vault, ".tools", "brain.mjs"), "// kit\n");
    schreibe(join(vault, ".tools", "git-hooks", "pre-commit"), "#!/bin/sh\nexit 0\n", 0o755);
    schreibe(join(vault, ".tools", "mcp", "brain-mcp.mjs"), "// kit-mcp\n");
  };
  const kitAlsAltHook = (datei, ersatz = null) => `"${join(vault, ".tools", datei)}"${ersatz ?? ""}`;
  const mitAltHook = (profil, ev, command, matcher = null) => {
    const s = lies(profil);
    // den eigenen neuen Hook dieses Ereignisses durch die alte Form ersetzen (Hook anderer Ereignisse bleibt neu)
    (s.hooks[ev] ||= []).unshift({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command }] });
    s.hooks[ev] = s.hooks[ev].filter((e, i) => i === 0 || !(e.hooks || []).some((h) => h.command.includes(`kortex' hook ${ev === "SessionStart" ? "session-start" : ev === "UserPromptSubmit" ? "brain-hint" : "wiki-guard"}`)));
    schreibeSettings(profil, s);
  };
  const kitMcpZiel = () => join(vault, ".tools", "mcp", "brain-mcp.mjs");
  const FAELLE = {
    // Kit-Ordner
    "kit-versioniert": () => { kit(); g("add", "--", ".tools"); g("commit", "-q", "-m", "Kit"); },
    "kit-unversioniert": () => { kit(); },
    "kit-aenderungen": () => { kit(); g("add", "--", ".tools"); g("commit", "-q", "-m", "Kit"); writeFileSync(join(vault, ".tools", "brain.mjs"), `// geändert ${GEHEIM}\n`); schreibe(join(vault, ".tools", "lokal.txt"), "neu\n"); },
    "kit-verweis": () => { schreibe(join(extern, "kit", "VERSION"), "0.5.1\n"); symlinkSync(join(extern, "kit"), join(vault, ".tools")); },
    // Config
    "backup-pfad-gueltig": () => { mkdirSync(join(basis, "sicherung")); aendereConfig((c) => { c.backup = { art: "ordner", pfad: join(basis, "sicherung") }; }); },
    "backup-pfad-uebernommen": () => {
      mkdirSync(join(basis, "sicherung"));
      aendereConfig((c) => { c.backup = { art: "ordner", pfad: join(basis, "sicherung") }; });
      const k = createHash("sha256").update(realpathSync(vault)).digest("hex").slice(0, 16);
      schreibe(join(support, "backup", `${k}.json`), JSON.stringify({ pfad: join(basis, "sicherung") }) + "\n");
    },
    "backup-pfad-relativ": () => { aendereConfig((c) => { c.backup = { art: "ordner", pfad: "sicherung" }; }); },
    "backup-pfad-verweis": () => { mkdirSync(join(extern, "ziel")); symlinkSync(join(extern, "ziel"), join(basis, "sicherung-link")); aendereConfig((c) => { c.backup = { art: "ordner", pfad: join(basis, "sicherung-link") }; }); },
    "werkzeuge-git": () => { aendereConfig((c) => { c.werkzeuge = { git: `/opt/${GEHEIM}/git` }; }); },
    "altfelder": () => { aendereConfig((c) => { c.kit = { stand: "0.5.1" }; c.systemVersion = "0.5.1"; c.updateHinweis = true; c.vaultPath = `/alt/${GEHEIM}`; }); },
    "wiki-ordner-pfad": () => { aendereConfig((c) => { c.wiki = { ordner: `/Volumes/${GEHEIM}/wiki` }; }); },
    "config-defekt": () => { writeFileSync(join(vault, "brain.config.json"), `{ "ordner": { "wiki": "${GEHEIM}" `); },
    "config-bom": () => { writeFileSync(join(vault, "brain.config.json"), "﻿" + JSON.stringify(config, null, 2) + "\n"); },
    // Versionsverlauf
    "hookspath-relativ": () => { g("config", "core.hooksPath", ".tools/git-hooks"); },
    "hookspath-absolut": () => { g("config", "core.hooksPath", join(vault, ".tools", "git-hooks")); },
    "hookspath-kortex": () => { g("config", "core.hooksPath", gitHooksKern); },
    "hookspath-fremd": () => { g("config", "core.hooksPath", ".husky/_"); },
    "credential-helper": () => { g("config", "--add", "credential.helper", ""); g("config", "--add", "credential.helper", "osxkeychain"); g("config", "--add", "credential.helper", `store --file /x/${GEHEIM}`); },
    "credential-url": () => { g("config", "credential.https://example.org.helper", `store ${GEHEIM}`); },
    "ssh-command": () => { g("config", "core.sshCommand", `ssh -i /k/${GEHEIM}`); },
    "url-insteadof": () => { g("config", `url.https://${GEHEIM}@example.org/.insteadOf`, "https://example.org/"); },
    "http-extraheader": () => { g("config", "http.https://example.org/.extraheader", `AUTHORIZATION: bearer ${GEHEIM}`); },
    "lfs-filter": () => { g("config", "filter.lfs.clean", "git-lfs clean -- %f"); g("config", "filter.lfs.smudge", "git-lfs smudge -- %f"); g("config", "filter.lfs.process", "git-lfs filter-process"); g("config", "filter.lfs.required", "true"); g("config", "lfs.repositoryformatversion", "0"); },
    "include-path": () => { g("config", "include.path", `../${GEHEIM}.cfg`); },
    "user-name-ungueltig": () => { g("config", "user.name", `Max & ${GEHEIM}`); },
    "remote-prune": () => { g("config", "remote.origin.prune", "true"); g("config", "remote.origin.tagopt", "--no-tags"); },
    "maintenance": () => { g("config", "maintenance.auto", "false"); g("config", "maintenance.strategy", "incremental"); },
    "fsmonitor": () => { g("config", "core.fsmonitor", "false"); g("config", "core.untrackedcache", "true"); },
    "core-worktree": () => { g("config", "core.worktree", vault); },
    "partialclone": () => { g("config", "core.repositoryformatversion", "1"); g("config", "extensions.partialclone", "origin"); g("config", "remote.origin.promisor", "true"); },
    "refstorage": () => { /* wird beim Anlegen (git init --ref-format=reftable) erzeugt */ },
    "remote-lokal-pfad": () => { mkdirSync(join(extern, "ziel.git")); g("config", "remote.origin.url", join(extern, "ziel.git")); },
    "remote-lokal-file": () => { mkdirSync(join(extern, "ziel.git")); g("config", "remote.origin.url", `file://${join(extern, "ziel.git")}`); },
    "remote-https": () => { g("config", "remote.origin.url", `https://example.org/${GEHEIM}/vault.git`); },
    "remote-ssh": () => { g("config", "remote.origin.url", `git@example.org:${GEHEIM}/vault.git`); },
    "remote-bestaetigt": () => {
      const url = `https://example.org/${GEHEIM}/vault.git`;
      g("config", "remote.origin.url", url);
      const k = createHash("sha256").update(realpathSync(vault)).digest("hex").slice(0, 16);
      schreibe(join(support, "backup", `${k}.json`), JSON.stringify({ remoteBestaetigt: url }) + "\n");
    },
    "git-verweis-exclude": () => { schreibe(join(extern, "exclude"), "# draußen\n"); rmSync(join(vault, ".git", "info", "exclude"), { force: true }); symlinkSync(join(extern, "exclude"), join(vault, ".git", "info", "exclude")); },
    "git-datei-aussen": () => { renameSync(join(vault, ".git"), join(extern, "gitdir")); writeFileSync(join(vault, ".git"), `gitdir: ${join(extern, "gitdir")}\n`); },
    "alternates": () => { schreibe(join(vault, ".git", "objects", "info", "alternates"), `${extern}/objekte\n`); },
    "git-hook-eigen": () => { schreibe(join(vault, ".git", "hooks", "pre-commit"), `#!/bin/sh\necho ${GEHEIM}\n`, 0o755); },
    "kein-git": () => { rmSync(join(vault, ".git"), { recursive: true, force: true }); },
    // Claude
    "hooks-alt-sh": () => mitAltHook(profilStandard, "SessionStart", `bash ${kitAlsAltHook("session-start.sh")} ${GEHEIM}`),
    "hooks-alt-mjs": () => mitAltHook(profilStandard, "UserPromptSubmit", `node ${kitAlsAltHook("brain-hint.mjs")}`),
    "hooks-alt-home": () => { mitAltHook(profilStandard, "SessionStart", `bash "$HOME/${name}/.tools/session-start.sh"`); },
    "hooks-alt-tilde": () => { mitAltHook(profilStandard, "SessionStart", `bash ~/${name}/.tools/session-start.sh`); },
    "hooks-alt-nodestart": () => mitAltHook(profilStandard, "SessionStart", `${q(join(vault, ".tools", "node-start.sh"))} ${q(join(vault, ".tools", "adapters", "claude-code", "session-start.mjs"))}`),
    "hooks-alt-adapters": () => mitAltHook(profilStandard, "PreToolUse", `node ${q(join(vault, ".tools", "adapters", "claude-code", "wiki-guard.mjs"))}`, "Edit|Write"),
    "hooks-fremd": () => { const s = lies(profilStandard); (s.hooks.PostToolUse ||= []).push({ hooks: [{ type: "command", command: `echo fertig ${GEHEIM}` }] }); schreibeSettings(profilStandard, s); },
    "statusline-alt": () => { const s = lies(profilStandard); s.statusLine = { type: "command", command: `bash ${kitAlsAltHook("statusline.sh")}` }; schreibeSettings(profilStandard, s); },
    "restverweis-skript": () => {
      const s = lies(profilStandard);
      (s.hooks.UserPromptSubmit ||= []).push({ hooks: [{ type: "command", command: `bash ${q(join(vault, ".tools", "search.sh"))} ${GEHEIM}` }] });
      s.env = { MEIN_SKRIPT: join(vault, ".tools", "eigenes.sh"), GEHEIM_TOKEN: GEHEIM };
      schreibeSettings(profilStandard, s);
    },
    // erst die alte Form eintragen, dann die Datei verlagern (Schreiben über einen Verweis blockt der Vault-Schutz im selben Prozess)
    "settings-verweis": () => {
      mitAltHook(profilStandard, "SessionStart", `bash ${kitAlsAltHook("session-start.sh")}`);
      const s = lies(profilStandard);
      schreibe(join(extern, "settings-echt.json"), JSON.stringify(s, null, 2));
      rmSync(join(profilStandard, "settings.json"));
      symlinkSync(join(extern, "settings-echt.json"), join(profilStandard, "settings.json"));
    },
    "settings-kaputt": () => { writeFileSync(join(profilStandard, "settings.json"), `{ "hooks": { "${GEHEIM}": `); },
    "zwei-profile": () => { const p = join(home, ".claude-privat"); mkdirSync(p, { recursive: true }); const s = neueHooks(); schreibeSettings(p, s); mitAltHook(p, "SessionStart", `bash ${kitAlsAltHook("session-start.sh")}`); },
    "plugin-marktplatz": () => { const s = lies(profilStandard); s.extraKnownMarketplaces = { "brain-mods": { source: { source: "directory", path: join(vault, ".tools", "mods") } } }; s.enabledPlugins = { "brain-mods@brain-mods": true }; schreibeSettings(profilStandard, s); },
    "commands-marke": () => { schreibe(join(profilStandard, "commands", "brain-suche.md"), `<!-- brain-kit -->\nRufe ${join(vault, ".tools", "search.sh")} auf.\n`); },
    "commands-ohne-marke": () => { schreibe(join(profilStandard, "commands", "eigen.md"), `Mein Befehl: ${join(vault, ".tools", "search.sh")} ${GEHEIM}\n`); },
    "skill-verweis": () => { schreibe(join(profilStandard, "skills", "mein-skill", "SKILL.md"), `Nutze ${join(vault, ".tools", "tool.sh")}\n`); },
    "profil-claude-md": () => { schreibe(join(profilStandard, "CLAUDE.md"), `# Anweisungen\n\nSuche mit ${join(vault, ".tools", "search.sh")} "<frage>" ${GEHEIM}\nLies ~/anderer/.tools/hinweis.md\n\nNormaler Text.\n`); },
    // MCP
    "mcp-claude-alt": () => schreibeClaudeJson(join(home, ".claude.json"), { command: "/opt/homebrew/bin/node", args: [kitMcpZiel()] }),
    "mcp-claude-alt-app": () => schreibeClaudeJson(join(home, ".claude.json"), { command: join(support, "bin", "node"), args: ["/Applications/Kortex.app/Contents/Resources/mcp/brain-mcp.mjs"] }),
    "mcp-claude-alt-unbekannt": () => schreibeClaudeJson(join(home, ".claude.json"), { command: "/opt/homebrew/bin/node", args: [join(basis, "anderer", ".tools", "mcp", "server-mcp.mjs")] }),
    "mcp-claude-fremd": () => schreibeClaudeJson(join(home, ".claude.json"), { command: "/usr/bin/foo", args: ["--token", GEHEIM] }),
    "mcp-claude-gleich": () => schreibeClaudeJson(join(home, ".claude.json"), mcpSoll),
    "mcp-claude-projekt": () => { schreibe(join(home, ".claude.json"), JSON.stringify({ mcpServers: {}, projects: { "/irgendwo": { mcpServers: { brain: { command: "/opt/homebrew/bin/node", args: [kitMcpZiel()] } } } } })); },
    "mcp-codex-alt": () => schreibe(join(home, ".codex", "config.toml"), `model = "x"\n\n[mcp_servers.brain]\ncommand = "/opt/homebrew/bin/node"\nargs = ["${kitMcpZiel()}"]\n\n[mcp_servers.brain.env]\nTOKEN = "${GEHEIM}"\n`),
    "mcp-cursor-alt": () => schreibe(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { brain: { command: "/opt/homebrew/bin/node", args: [kitMcpZiel()] } } }, null, 2)),
    "mcp-anderer-name": () => schreibeClaudeJson(join(home, ".claude.json"), mcpSoll, { wissen: { command: "/opt/homebrew/bin/node", args: [join(vault, ".tools", "mcp", "wissen-mcp.mjs"), GEHEIM] } }),
    // Hintergrunddienst
    "plist-alt-dieser": () => writeFileSync(plistPfad, plist({ vaultEnv: vault, alt: true })),
    "plist-alt-dieser-profil": () => writeFileSync(plistPfad, plist({ vaultEnv: vault, alt: true, profil: join(home, ".claude-privat") })),
    "plist-alt-anderer": () => writeFileSync(plistPfad, plist({ vaultEnv: join(basis, "anderer-vault"), alt: true })),
    "plist-neu": () => writeFileSync(plistPfad, plist()),
    "plist-keiner": () => rmSync(plistPfad, { force: true }),
    "plist-weitere": () => writeFileSync(join(home, "Library", "LaunchAgents", "de.brain.nachtlauf.plist"), plist()),
    // Vault / Ort
    "vault-claude-settings": () => schreibe(join(vault, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `bash ${join(vault, ".tools", "session-start.sh")}` }] }] } }, null, 2)),
    "vault-mcp-json": () => schreibe(join(vault, ".mcp.json"), JSON.stringify({ mcpServers: { brain: { command: "node", args: [join(vault, ".tools", "mcp", "brain-mcp.mjs")] } } }, null, 2)),
    "vault-claude-md": () => { schreibe(join(vault, "CLAUDE.md"), `# Regeln\n\nSuche: node ${join(vault, ".tools", "brain.mjs")} search\n`); },
    "agents-versioniert": () => { schreibe(join(vault, "AGENTS.md"), "# Agenten\n"); g("add", "--", "AGENTS.md"); g("commit", "-q", "-m", "AGENTS"); },
    "shell-datei": () => { schreibe(join(home, ".zshrc"), `export PATH="$PATH:${join(vault, ".tools", "bin")}"\nalias x=1\n`); },
    "pfad-sonderzeichen": () => { /* über vaultName */ },
    "vault-ueber-verweis": () => { symlinkSync(vault, join(basis, "vault-link")); },
    "prozess-attrappe": () => { kit(); schreibe(join(vault, ".tools", "server.mjs"), "setTimeout(() => {}, 120000);\n"); },
    "alter-support": () => { mkdirSync(join(home, "Library", "Application Support", "Brain"), { recursive: true }); mkdirSync(join(home, ".brain-kit")); },
    "logs-verweis": () => { mkdirSync(join(extern, "logs")); symlinkSync(join(extern, "logs"), join(vault, ".logs")); },
    "keine-config": () => { rmSync(join(vault, "brain.config.json")); },
    // Mehrere Macs
    "geraet-anderer-mac": () => { schreibe(join(vault, ".kortex", "geraete", "abc123.json"), JSON.stringify({ name: `Mac-${GEHEIM}`, kortexVersion: "1.0.0", phaseA: "2026-10-01" })); aendereConfig((c) => { c.kernVersion = "0.0.1"; }); },
    "kernversion-neuer": () => { aendereConfig((c) => { c.kernVersion = "99.0.0"; }); },
  };
  for (const f of faelle) {
    if (!FAELLE[f]) throw new Error(`Unbekannter Fall: ${f}`);
    FAELLE[f]();
  }
  const verweisPfad = join(basis, "vault-link");
  return {
    basis, vault, home, support, extern, name,
    vaultVerweis: verweisPfad,
    opt: { vault, home, support },
    g, schreibe, aendereConfig,
    weg: () => { try { rmSync(basis, { recursive: true, force: true }); } catch { /* weg */ } },
  };
}

// Stand eines Verzeichnisbaums (Pfad, Art, Größe, Änderungszeit, Hash der Dateiinhalte) für „nichts wurde verändert“-Prüfungen.
export function baumStand(...wurzeln) {
  const z = [];
  const lauf = (p) => {
    let l;
    try { l = lstatSync(p); } catch { z.push(`${p}\tfehlt`); return; }
    if (l.isSymbolicLink()) { z.push(`${p}\tlink\t${l.mtimeMs}`); return; }
    if (l.isDirectory()) { z.push(`${p}\tdir\t${l.mtimeMs}`); for (const n of readdirSync(p).sort()) lauf(join(p, n)); return; }
    let h = "";
    try { h = createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { /* unlesbar */ }
    z.push(`${p}\tdatei\t${l.size}\t${l.mtimeMs}\t${h}`);
  };
  for (const w of wurzeln) lauf(w);
  return z.join("\n");
}
