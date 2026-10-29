// umstellung/restverweise.mjs — Suche nach Verweisen auf den alten Kit-Ordner im Vault außerhalb des Vaults (Paket P7a). NUR LESEN.
//
// Wo Programme des Nutzers noch auf den alten Kit-Ordner zeigen können: Claude-Einstellungen (Hooks, Statuszeile, Umgebung, Rechte), Plugin-Marktplätze,
// Befehle und Skills im Claude-Profil, die globale Anweisungsdatei des Profils (CLAUDE.md), die Agenten-Dateien im Vault selbst und die Shell-Startdateien.
// Ausgegeben werden nur Zählungen und Stellen-Namen (z. B. „hooks.SessionStart“), nie ein Befehl, eine Umgebungsvariable oder eine Zeile. Hooks und Statuszeile,
// die der Installer (adapters/claude-code/install.mjs) selbst umstellt, zählen NICHT als Restverweis, sondern als „alte Form“ (eigeneAlt).
import { readFileSync, readdirSync, lstatSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALT_KIT_ORDNER, hookNameAusBefehl } from "../pfade.mjs";

const maskiere = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Ein Pfadsegment des alten Kit-Ordners (nicht Teil eines längeren Namens) oder das alte Start-Skript.
export const ALT_VERWEIS = new RegExp(`(?:^|[^A-Za-z0-9_-])${maskiere(ALT_KIT_ORDNER)}(?![A-Za-z0-9_-])|node-start\\.sh`);
export const nennt = (text) => typeof text === "string" && ALT_VERWEIS.test(text);

const MARKER = "/adapters/claude-code/";
const HOOK_DATEIEN = ["session-start", "brain-hint", "wiki-guard", "werkzeug-protokoll", "regeln-lesen", "kompakt-sichern", "ernte-ausloeser", "sitzung-ende"];
const ALLE_EIGENEN = [...HOOK_DATEIEN, "statusline"];

// Eigener Hook-Befehl in der neuen Form (… kortex' hook <name>)?
export const istNeueForm = (c) => { const n = hookNameAusBefehl(c); return !!n && ALLE_EIGENEN.includes(n); };

// Eigener Hook-Befehl in alter Form? Zwei Wege wie im Installer: Pfad nach adapters/claude-code/<datei>.mjs (jeder Kern-Ort) oder die Form aus der Zeit
// vor dem Umzug in diesen Unterordner (<Vault>/<Kit-Ordner>/<datei>.sh|mjs, auch $HOME- und ~-Schreibweise des Vaults).
export function altFormRegex(vault, home) {
  const v = String(vault).split("\\").join("/").replace(/\/+$/, "");
  const h = String(home).split("\\").join("/").replace(/\/+$/, "");
  const orte = [v];
  if (h && v.startsWith(`${h}/`)) { const rel = v.slice(h.length); orte.push(`$HOME${rel}`, `\${HOME}${rel}`, `~${rel}`); }
  const alt = orte.map(maskiere).join("|");
  return new RegExp(`(?:^|["'\\s])(?:${alt})/${maskiere(ALT_KIT_ORDNER)}/(?:session-start|brain-hint|wiki-guard|statusline)\\.(?:sh|mjs)(?=["'\\s]|$)`);
}
export function istAlteForm(c, muster) {
  if (typeof c !== "string" || istNeueForm(c)) return false;
  if (c.includes(MARKER) && ALLE_EIGENEN.some((d) => c.includes(`${MARKER}${d}.mjs`))) return true;
  return muster.test(c);
}

function leseJson(datei, grenze = 20 * 1024 * 1024) {
  try {
    const st = statSync(datei);
    if (!st.isFile() || st.size > grenze) return { doc: null, fehler: st.isFile() ? "zu-gross" : "keine-datei" };
    return { doc: JSON.parse(readFileSync(datei, "utf8")), fehler: null };
  } catch (e) { return { doc: null, fehler: e && e.code === "ENOENT" ? "fehlt" : "defekt" }; }
}
const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);

// Zählt Zeilen eines Textes mit Verweis (Dateien bis 2 MB).
export function zeilenMitVerweis(datei) {
  try {
    const st = statSync(datei);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return 0;
    return readFileSync(datei, "utf8").split(/\r?\n/).filter((z) => nennt(z)).length;
  } catch { return 0; }
}

// Alle Strings eines JSON-Werts mit Verweis, gezählt nach Stelle. Der Pfad der Stelle nennt nur Schlüssel (nie Werte).
function zaehleVerweise(wert, stelle, aus, ausnahme) {
  if (typeof wert === "string") { if (nennt(wert) && !(ausnahme && ausnahme(wert))) aus[stelle] = (aus[stelle] || 0) + 1; return; }
  if (Array.isArray(wert)) { wert.forEach((x) => zaehleVerweise(x, stelle, aus, ausnahme)); return; }
  if (istObjekt(wert)) for (const [k, x] of Object.entries(wert)) zaehleVerweise(x, stelle, aus, ausnahme);
}

// settings.json eines Profils → { vorhanden, defekt, verweis, eigeneAlt, eigeneNeu, statuszeile, rest: { <Stelle>: n } }
export function pruefeEinstellungen(datei, vault, home) {
  const aus = { vorhanden: false, defekt: false, verweis: false, eigeneAlt: 0, eigeneNeu: 0, statuszeile: "keine", rest: {}, plugins: 0 };
  let l;
  try { l = lstatSync(datei); } catch { return aus; }
  aus.vorhanden = true;
  aus.verweis = l.isSymbolicLink();
  const { doc, fehler } = leseJson(datei);
  if (!doc || !istObjekt(doc)) { aus.defekt = fehler === "defekt" || (doc !== null && !istObjekt(doc)); aus.vorhanden = fehler !== "fehlt"; return aus; }
  const muster = altFormRegex(vault, home);
  const eigener = (c) => istNeueForm(c) || istAlteForm(c, muster);
  for (const [ev, liste] of Object.entries(istObjekt(doc.hooks) ? doc.hooks : {})) {
    if (!Array.isArray(liste)) continue;
    for (const eintrag of liste) {
      if (!istObjekt(eintrag)) continue;
      for (const h of Array.isArray(eintrag.hooks) ? eintrag.hooks : []) {
        const c = h && h.command;
        if (typeof c !== "string") { zaehleVerweise(h, `hooks.${ev}`, aus.rest); continue; }
        if (istNeueForm(c)) aus.eigeneNeu++;
        else if (istAlteForm(c, muster)) aus.eigeneAlt++;
        else if (nennt(c)) aus.rest[`hooks.${ev}`] = (aus.rest[`hooks.${ev}`] || 0) + 1;
      }
    }
  }
  const sl = istObjekt(doc.statusLine) ? doc.statusLine.command : null;
  if (typeof sl === "string") {
    if (hookNameAusBefehl(sl) === "statusline") aus.statuszeile = "neu";
    else if (istAlteForm(sl, muster)) { aus.statuszeile = "alt"; aus.eigeneAlt++; }
    else { aus.statuszeile = "fremd"; if (nennt(sl)) aus.rest.statusLine = 1; }
  }
  for (const k of ["env", "permissions", "apiKeyHelper", "awsAuthRefresh", "otelHeadersHelper"]) if (k in doc) zaehleVerweise(doc[k], k, aus.rest);
  // alles übrige (außer hooks, statusLine, Plugin-Angaben, die gesondert gezählt werden)
  for (const [k, x] of Object.entries(doc)) {
    if (["hooks", "statusLine", "env", "permissions", "apiKeyHelper", "awsAuthRefresh", "otelHeadersHelper", "enabledPlugins", "extraKnownMarketplaces"].includes(k)) continue;
    zaehleVerweise(x, "sonstiges", aus.rest);
  }
  // Plugin-Marktplätze aus dem alten Kit-Ordner (Quelle „directory“)
  const maerkte = istObjekt(doc.extraKnownMarketplaces) ? doc.extraKnownMarketplaces : {};
  const betroffene = new Set();
  for (const [name, m] of Object.entries(maerkte)) {
    const src = istObjekt(m) ? (m.source || m) : null;
    const pfad = istObjekt(src) ? (src.path ?? src.url ?? src.repo) : null;
    if (typeof pfad === "string" && nennt(pfad)) betroffene.add(name);
  }
  aus.plugins = betroffene.size;
  aus.pluginMaerkte = [...betroffene];
  return aus;
}

// <Profil>/plugins/known_marketplaces.json → Anzahl Marktplätze mit Quelle im alten Kit-Ordner
export function pruefeBekannteMaerkte(profilPfad) {
  const { doc } = leseJson(join(profilPfad, "plugins", "known_marketplaces.json"), 5 * 1024 * 1024);
  if (!istObjekt(doc)) return 0;
  let n = 0;
  for (const m of Object.values(doc)) { const a = {}; zaehleVerweise(m, "x", a); if (a.x) n++; }
  return n;
}

// Befehle und Skills im Profil. Befehle mit der Marke von Kortex/Kit werden beim Eintragen der Hooks neu erzeugt (auto); eigene Dateien und Skills nicht (Hinweis).
export const COMMANDS_MARKE = "<!-- brain-kit -->";
export function pruefeBefehleUndSkills(profilPfad) {
  const aus = { mitMarke: 0, ohneMarke: 0, skills: 0 };
  const cmd = join(profilPfad, "commands");
  try {
    for (const n of readdirSync(cmd)) {
      if (!n.endsWith(".md")) continue;
      let t = "";
      try { const p = join(cmd, n); if (statSync(p).size > 2 * 1024 * 1024) continue; t = readFileSync(p, "utf8"); } catch { continue; }
      if (!nennt(t)) continue;
      if (t.includes(COMMANDS_MARKE)) aus.mitMarke++; else aus.ohneMarke++;
    }
  } catch { /* kein commands-Ordner */ }
  // Skills: bis Tiefe 3, höchstens 500 Dateien, keine Verweise
  let zaehler = 0;
  const lauf = (dir, tiefe) => {
    let namen;
    try { namen = readdirSync(dir); } catch { return; }
    for (const n of namen) {
      if (++zaehler > 500) return;
      const p = join(dir, n);
      let s;
      try { s = lstatSync(p); } catch { continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { if (tiefe < 3) lauf(p, tiefe + 1); continue; }
      if (s.isFile() && /\.(md|mjs|js|sh|json|txt)$/i.test(n) && s.size <= 512 * 1024) {
        try { if (nennt(readFileSync(p, "utf8"))) aus.skills++; } catch { /* unlesbar */ }
      }
    }
  };
  lauf(join(profilPfad, "skills"), 0);
  return aus;
}

// Die Startdateien der Shells im Home → [{ name, anzahl }]
export const SHELL_DATEIEN = [".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile", ".config/fish/config.fish"];
export function pruefeShellDateien(home) {
  const aus = [];
  for (const n of SHELL_DATEIEN) { const z = zeilenMitVerweis(join(home, n)); if (z) aus.push({ name: n, anzahl: z }); }
  return aus;
}
