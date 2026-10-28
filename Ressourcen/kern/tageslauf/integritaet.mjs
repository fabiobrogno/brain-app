// .tools/tageslauf/integritaet.mjs — Integritätsprüfung nach jedem KI-Lauf der Pflege (B3-Härtung, Node, 0 Tokens).
// Die KI schreibt in einer Arbeitskopie; eine eingeschleuste Anweisung könnte sie aber dazu bringen, DANEBEN etwas zu ändern, das die
// Diff-Prüfung der Kopie nie sieht: .git/config oder Hooks des echten Vaults (= Code beim nächsten Commit), .tools, das Wiki, ~/.zshrc,
// ~/.ssh, ~/.claude*/settings.json, LaunchAgents. Darum wird VOR und NACH der Arbeit ein Fingerabdruck gebildet und verglichen —
// nur Hashes, nie Inhalt (nichts davon darf in Berichte, Logs oder Warnungen gelangen).
//   fingerabdruck()  Map<Schlüssel, Hash>: echter Vault (.git/config, .git/hooks, .git/info, .tools, Wiki ohne generierte Dateien, HEAD,
//                    Arbeitsbaum ohne Inbox/Archiv/.logs) · Arbeitskopie (.tools, Worktree-Zeiger samt Verwaltungsdateien, .claude, .mcp.json)
//                    · Home (Shell-Starter, SSH, Claude-Settings, LaunchAgents) — jeweils falls vorhanden; neu angelegt zählt als Änderung.
//   abweichungen()   Schlüssel, deren Hash sich unterscheidet (neu, geändert, weg).
//   meldeVerletzung  pflegeStopp, Grund im Lauf, Eintrag im Bericht („Integrität verletzt: <Pfad>“), Rückfrage `integritaet`, die der
//                    Sitzungsstart zuerst und laut zeigt (morgen.mjs#integritaetsZeile) — auch im Probelauf.
import { readFileSync, readdirSync, lstatSync, statSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { istGeneriert } from "../wiki-pfade.mjs";
import { listeRueckfragen, legeRueckfrageAn } from "../rueckfragen.mjs";
import { notiere } from "./protokoll.mjs";

export const REGEL = "integritaet", RUECKFRAGE_TYP = "integritaet";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;
const EGAL = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);     // Finder/Explorer legen sie von selbst an
const MAX_TIEFE = 40;

// Hash einer Datei (Ausführungsrecht zählt mit: ein Hook ohne x läuft nicht). Fehlt sie: "-", nicht lesbar: "?", Symlink: Hash des Ziels.
function dateiHash(p) {
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return `link:${sha(readlinkSync(p))}`;
    if (st.isDirectory()) return "dir";
    return `${sha(readFileSync(p))}${st.mode & 0o111 ? ":x" : ""}`;
  } catch (e) { return e?.code === "ENOENT" || e?.code === "ENOTDIR" ? "-" : "?"; }
}

function baum(wurzel, praefix, aus, { ueberspringe = () => false, tiefe = 0 } = {}) {
  let namen = [];
  try { namen = readdirSync(wurzel); } catch { return; }
  for (const n of namen) {
    if (EGAL.has(n)) continue;
    const p = join(wurzel, n), rel = `${praefix}/${n}`;
    if (ueberspringe(rel)) continue;
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isDirectory()) { if (tiefe < MAX_TIEFE) baum(p, rel, aus, { ueberspringe, tiefe: tiefe + 1 }); }
    else aus.set(rel, dateiHash(p));
  }
}

// Freigabe- und Zustandsdateien des echten Vaults, die eine KI-Arbeit nie ändern darf (B3 schreibt sie nur AUSSERHALB von arbeit()):
// Rückfragen (antwort: …), Entscheidungen, Autostufe, Prüfungen, Pflege-Stand und -Vorschläge (Patches), Konfiguration.
// Inbox und .logs sind sonst ausgenommen — diese Teile nicht.
const TL_DATEIEN = /^(?:autostufe|pflege-stand|pflege-tag|pruefungen[^/]*)\.jsonl?$/;
export function freigabeStand(vault, inbox) {
  const f = new Map();
  baum(join(vault, inbox, "_rueckfragen"), `${inbox}/_rueckfragen`, f);
  baum(join(vault, inbox, "_entscheidungen"), `${inbox}/_entscheidungen`, f);
  const tl = join(vault, ".logs", "tageslauf");
  let namen = [];
  try { namen = readdirSync(tl); } catch { /* noch kein Tageslauf */ }
  for (const n of namen) if (TL_DATEIEN.test(n)) f.set(`.logs/tageslauf/${n}`, dateiHash(join(tl, n)));
  baum(join(tl, "pflege-vorschlaege"), ".logs/tageslauf/pflege-vorschlaege", f);
  f.set("brain.config.json", dateiHash(join(vault, "brain.config.json")));
  return f;
}

const SHELL_STARTER = [".zshrc", ".zshenv", ".zprofile", ".zlogin", ".bashrc", ".bash_profile", ".profile", ".gitconfig"];
function claudeOrdner(home) {
  try {
    return readdirSync(home).filter((n) => { if (!n.startsWith(".claude")) return false; try { return statSync(join(home, n)).isDirectory(); } catch { return false; } });
  } catch { return []; }
}

// gemeinsam: gemeinsames Git-Verzeichnis des echten Vaults (meist <vault>/.git); status: [{ xy, pfad }] des echten Vaults; head: Commit.
export function fingerabdruck({ vault, kopie, home, wiki, inbox, archiv, gemeinsam, head = "-", status = [] }) {
  const f = new Map();
  // ---- echter Vault
  f.set(".git/config", dateiHash(join(gemeinsam, "config")));
  baum(join(gemeinsam, "hooks"), ".git/hooks", f);
  baum(join(gemeinsam, "info"), ".git/info", f);
  baum(join(vault, ".tools"), ".tools", f);
  baum(join(vault, wiki), wiki, f, { ueberspringe: (rel) => istGeneriert(rel, wiki) });
  f.set("HEAD", String(head || "-"));
  for (const [k, h] of freigabeStand(vault, inbox)) f.set(k, h);
  const frei = (p) => p.startsWith(".logs/") || p.startsWith(`${inbox}/`) || p.startsWith(`${archiv}/`) || istGeneriert(p, wiki);
  for (const { xy, pfad } of status) {
    if (frei(pfad) || EGAL.has(pfad.split("/").pop())) continue;
    f.set(`Arbeitsbaum/${pfad}`, `${xy}:${dateiHash(join(vault, pfad))}`);
  }
  // ---- Arbeitskopie: Code, der beim Lauf (über Bash) oder beim Commit-Hook ausgeführt würde, und der Zeiger auf den echten Vault
  const K = (rel) => `Arbeitskopie/${rel}`;
  baum(join(kopie, ".tools"), K(".tools"), f);
  baum(join(kopie, ".claude"), K(".claude"), f);
  f.set(K(".mcp.json"), dateiHash(join(kopie, ".mcp.json")));
  const zeiger = join(kopie, ".git");
  f.set(K(".git"), dateiHash(zeiger));
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(zeiger, "utf8"));
    if (m) for (const n of ["config.worktree", "commondir", "gitdir"]) f.set(K(`.git-verwaltung/${n}`), dateiHash(join(resolve(kopie, m[1].trim()), n)));
  } catch { /* .git ist ein Ordner oder fehlt: der Zeiger-Hash oben genügt */ }
  // ---- Home: nur Hashes, nie Inhalt
  const H = (rel) => f.set(`~/${rel}`, dateiHash(join(home, rel)));
  for (const n of SHELL_STARTER) H(n);
  for (const n of ["authorized_keys", "config", "rc"]) H(`.ssh/${n}`);
  for (const d of claudeOrdner(home)) { H(`${d}/settings.json`); H(`${d}/settings.local.json`); }
  baum(join(home, "Library", "LaunchAgents"), "~/Library/LaunchAgents", f);
  return f;
}

export function abweichungen(vorher, nachher) {
  const alle = new Set([...vorher.keys(), ...nachher.keys()]);
  return [...alle].filter((k) => vorher.get(k) !== nachher.get(k)).sort();
}

// Anzeigepfade: Doppel (Arbeitsbaum/<pfad>, wenn <pfad> selbst schon gemeldet ist) weg, Steuerzeichen nie durchlassen (der Name landet
// im Sitzungsstart und damit bei der KI: kein Einschleusen über Dateinamen), Länge begrenzt.
export function anzeigePfade(schluessel) {
  const menge = new Set(schluessel);
  const out = [];
  for (const k of schluessel) {
    if (k.startsWith("Arbeitsbaum/") && menge.has(k.slice("Arbeitsbaum/".length))) continue;
    out.push(STEUERZEICHEN.test(k) ? "<Pfad mit Steuerzeichen>" : k.length > 200 ? `${k.slice(0, 199)}…` : k);
  }
  return [...new Set(out)];
}
const kurzListe = (liste, n = 3) => `${liste.slice(0, n).join(", ")}${liste.length > n ? ` (+${liste.length - n} weitere)` : ""}`;

export function befunde(pfade, max = 10) {
  const liste = anzeigePfade(pfade);
  const b = liste.slice(0, max).map((p) => ({ pfad: p, regel: REGEL, meldung: `Integrität verletzt: ${p}`.slice(0, 220) }));
  if (liste.length > max) b.push({ pfad: "-", regel: REGEL, meldung: `Integrität verletzt: … und ${liste.length - max} weitere` });
  return b;
}

export function meldeVerletzung(ctx, { einheit, pfade }) {
  const liste = anzeigePfade(pfade);
  if (!liste.length) return;
  ctx.pflegeStopp = true;
  ctx.integritaet = { verletzt: true, pfade: [...new Set([...(ctx.integritaet?.pfade || []), ...liste])] };
  const text = `Integrität verletzt: ${kurzListe(liste)}`;
  ctx.grund = text;                                            // wichtiger als jeder andere Grund des Laufs
  notiere(ctx, { id: einheit, stufe: "fehler", ziel: liste[0], grund: text });
  try {
    const fp = sha([...liste].sort().join("\n")).slice(0, 16);
    if (listeRueckfragen(ctx.vault).some((r) => r.typ === RUECKFRAGE_TYP && !r.antwort && r.fm.fp === fp)) return;   // dieselbe Warnung steht schon da
    // Auch im Probelauf: ein Sicherheitsbefund wird nie verschwiegen (legeRueckfrageAn legt in der Probe sonst nichts an).
    legeRueckfrageAn({ ...ctx, probe: false }, { typ: RUECKFRAGE_TYP, frage: `Integrität verletzt: ${kurzListe(liste)}`, grund: RUECKFRAGE_TYP,
      beschreibung: [
        "Die KI hat bei der Pflege etwas verändert, das sie nie anfassen darf (echter Vault, Git-Konfiguration oder Hooks, Werkzeug-Code,",
        "Shell-Startdateien, Zugangs- oder Settings-Dateien). Betroffen (nur Namen, nie Inhalt):",
        ...liste.slice(0, 15).map((p) => `- ${p}`),
        "Die Einheit wurde verworfen, die Pflege für diesen Lauf beendet, die Notiz ist gesperrt.",
        "Bitte ansehen: git status, git diff, .git/config, .git/hooks, .tools — erst danach als „geprüft“ abhaken.",
      ].join("\n"),
      felder: { pfade: liste.slice(0, 30), fp } });
  } catch { /* die Warnung im Bericht (notiere) bleibt */ }
}
