// .tools/tageslauf/pflege-kopie.mjs — Die Pflege-Arbeitskopie von B3 (Spec §6.2): EIN Git-Worktree je Lauf außerhalb des Vaults
// (Branch tageslauf/<lauf>-pflege; Reste räumt raeumeResteAuf wie in B2 weg). Je Einheit (eine Quelle, eine Seite, eine
// Entscheidung) GENAU EIN Commit oder keiner: arbeit() → Wächter „Vault unverändert" → rev nachziehen → _log-Eintrag (Node)
// → Diff-Prüfung → git add (explizit) → commit mit normalem pre-commit (Lint + Secrets + REV + Log, nie --no-verify).
// Jeder Verstoß setzt die Arbeitskopie auf den letzten guten Commit zurück. Übernommen wird am Ende per ff-Merge — und nur,
// wenn der Branch genau auf dem letzten geprüften Commit steht (kein Commit an der Diff-Prüfung vorbei).
// Härtung: VOR und NACH jeder Arbeit ein Fingerabdruck (integritaet.mjs) von echtem Vault, Arbeitskopie und Home — jede Abweichung
// (Hook, .git/config, .tools, Wiki, ~/.zshrc …) verwirft die Einheit, beendet die Pflege und erzeugt eine laute Warnung.
import { readFileSync, writeFileSync, existsSync, statSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ordner, ladeConfig } from "../pfade.mjs";
import { gitBefehl } from "../werkzeug.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { git, legeArbeitskopieAn, uebernehmen } from "./arbeitskopie.mjs";
import { leseFeld, setzeFeld, fuegeLogEin, logZeit } from "./schreiben.mjs";
import { pruefeDiff } from "./diffpruefung.mjs";
import { fingerabdruck, freigabeStand, abweichungen, meldeVerletzung, befunde as integritaetsBefunde } from "./integritaet.mjs";

export const BETREFF_PFLEGE = /^pflege\(([^)]+)\): .* \[([a-z0-9-]{1,80})\]$/;
export const ID_MUSTER = /^[a-z0-9-]{1,80}$/;
const ART_TEXT = { inbox: "Inbox eingearbeitet", konsolidieren: "Seite konsolidiert", "neue-seite": "neue Seite", entscheidung: "Konflikt entschieden" };
const einzeilig = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const fwd = (p) => String(p).split("\\").join("/");
const ohneGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

export const slug = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss")
  .replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
export const pflegeBetreff = ({ lauf, art, titel, id }) => `pflege(${lauf}): ${art} ${einzeilig(titel).slice(0, 60)} [${id}]`;
export const clusterIds = (vault) => (ladeConfig(vault).clusters || []).map((c) => c?.id).filter((x) => typeof x === "string");
// kopf = letzter GEPRÜFTER Commit der Kopie (anfangs der Start-Commit); nur einheit() schiebt ihn weiter.
export function legePflegeKopieAn(vault, lauf, opt = {}) {
  const kopie = legeArbeitskopieAn(vault, `${lauf}-pflege`, opt);
  try { kopie.kopf = git(vault, kopie.pfad, ["rev-parse", "HEAD"]); } catch {}
  return kopie;
}

// Ungetrimmt (git() aus arbeitskopie.mjs trimmt — das zerstört führende Leerzeichen der Statuszeilen).
export function gitRoh(vault, cwd, args) {
  return execFileSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", cwd, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: ohneGit() });
}
export function statusEintraege(vault, cwd) {
  const teile = gitRoh(vault, cwd, ["status", "--porcelain=v1", "-z", "-uall"]).split("\0");
  const out = [];
  for (let i = 0; i < teile.length; i++) {
    const e = teile[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    if (xy[0] === "R" || xy[0] === "C") {                    // -z: der Herkunftspfad folgt als eigener Eintrag
      const von = fwd(teile[++i] || "");
      out.push({ xy: "A ", pfad: fwd(e.slice(3)) });          // Umbenennen = neue Datei + gelöschte alte (Diff-Prüfung: „geloescht“)
      if (xy[0] === "R" && von) out.push({ xy: "D ", pfad: von });
      continue;
    }
    out.push({ xy, pfad: fwd(e.slice(3)) });
  }
  return out;
}
// binaer: NUL-Byte oder kein gültiges UTF-8 (vorher oder nachher) — die Diff-Prüfung lehnt Binärdateien in Pflege-Einheiten ab,
// damit nie „Binary files differ“ zur Freigabe vorgelegt wird.
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const istBinaer = (buf) => { if (buf.includes(0)) return true; try { UTF8.decode(buf); return false; } catch { return true; } };
export function sammleDiff(vault, kopie) {
  return statusEintraege(vault, kopie.pfad).map(({ xy, pfad }) => {
    const status = xy === "??" || xy.includes("A") ? "neu" : xy.includes("D") ? "geloescht" : "geaendert";
    const alt = status === "neu" ? null : gitRoh(vault, kopie.pfad, ["show", `HEAD:${pfad}`]);
    let neu = null, symlink = false, binaer = typeof alt === "string" && alt.includes("\0");
    if (status !== "geloescht") {
      try { symlink = lstatSync(join(kopie.pfad, pfad)).isSymbolicLink(); } catch {}
      if (!symlink) {
        try { const buf = readFileSync(join(kopie.pfad, pfad)); if (istBinaer(buf)) binaer = true; neu = buf.toString("utf8"); } catch { neu = null; }
      }
    }
    return { pfad, status, alt, neu, ...(symlink ? { symlink: true } : {}), ...(binaer ? { binaer: true } : {}) };
  });
}

// Fingerabdruck des echten Vaults ohne .logs/, Inbox und Archiv (außer den Freigabe-/Zustandsdateien, siehe integritaet.mjs#freigabeStand): HEAD + Statuszeilen + Größe/Zeit der gemeldeten Dateien.
export function vaultZustand(vault) {
  const o = ordner(vault);
  const frei = (p) => p.startsWith(".logs/") || p.startsWith(`${o.inbox}/`) || p.startsWith(`${o.archiv}/`);
  const h = createHash("sha256");
  try { h.update(git(vault, vault, ["rev-parse", "HEAD"])); } catch { h.update("-"); }
  let eintraege = [];
  try { eintraege = statusEintraege(vault, vault); } catch {}
  for (const { xy, pfad } of eintraege) {
    if (frei(pfad)) continue;
    h.update(`${xy} ${pfad}\0`);
    try { const st = statSync(join(vault, pfad)); h.update(`${st.size}:${st.mtimeMs}\0`); } catch { h.update("weg\0"); }
  }
  for (const [k, w] of freigabeStand(vault, o.inbox)) h.update(`${k}=${w}\0`);       // Rückfragen, Entscheidungen, Autostufe, Konfiguration …
  return h.digest("hex");
}

// Fingerabdruck für die Integritätsprüfung: Git-Sicht (HEAD, Status, gemeinsames Git-Verzeichnis) von hier, das Hashen in integritaet.mjs.
export function integritaetsStand(ctx, kopie) {
  const vault = ctx.vault, o = ordner(vault);
  let head = "-", status = [], gemeinsam = join(vault, ".git");
  try { head = git(vault, vault, ["rev-parse", "HEAD"]); } catch {}
  try { status = statusEintraege(vault, vault); } catch {}
  try { gemeinsam = resolve(vault, git(vault, vault, ["rev-parse", "--git-common-dir"])); } catch {}
  return fingerabdruck({ vault, kopie: kopie.pfad, home: ctx.home || homedir(), wiki: o.wiki, inbox: o.inbox, archiv: o.archiv, gemeinsam, head, status });
}

export function zuruecksetzen(vault, kopie) {
  try { git(vault, kopie.pfad, ["reset", "-q", "--hard", kopie.kopf || "HEAD"]); } catch {}
  try { git(vault, kopie.pfad, ["clean", "-qfdx"]); } catch {}            // auch ignorierte Reste (Inbox-Kopie)
}

function revNachziehen(wiki, kopie, diff) {
  for (const d of diff) {
    if (d.status !== "geaendert" || !istWikiSeite(d.pfad, wiki)) continue;
    try {
      const alt = Number(leseFeld(d.alt, "rev"));
      if (!Number.isInteger(alt) || alt < 1) continue;
      const datei = join(kopie.pfad, d.pfad);
      const text = readFileSync(datei, "utf8");
      if (Number(leseFeld(text, "rev")) !== alt + 1) writeFileSync(datei, setzeFeld(text, "rev", alt + 1));
    } catch { /* kaputtes Frontmatter → Diff-Prüfung/pre-commit entscheiden */ }
  }
}

export function pflegeLogEintrag({ zeit, lauf, art, titel, seiten = [], quelle = null }) {
  return [`## ${zeit} — pflege(${lauf}): ${ART_TEXT[art] || art}: ${einzeilig(titel).slice(0, 80)}`,
    `- Seiten geändert/neu: ${seiten.length ? seiten.join(", ") : "keine"}`, ...(quelle ? [`- Quelle: ${quelle}`] : []),
    `- Tageslauf (Pflege), automatisch — rückgängig: brain zurueck ${lauf}`].join("\n");
}

const kopfUndBranch = (vault, kopie) => {
  try { return `${git(vault, kopie.pfad, ["rev-parse", "HEAD"])} ${git(vault, kopie.pfad, ["symbolic-ref", "--short", "HEAD"])}`; } catch { return "?"; }
};

export async function einheit(ctx, kopie, { id, art, titel, arbeit, pruef = {} }) {
  if (!ID_MUSTER.test(String(id))) return { id, art, titel, ok: false, grund: "id-ungueltig", befunde: [] };
  ctx.pflegeIds ??= new Set();
  let eid = id;
  for (let n = 2; ctx.pflegeIds.has(eid); n++) eid = `${id.slice(0, 76)}-${n}`;
  ctx.pflegeIds.add(eid);
  const basis = { id: eid, art, titel };
  if (ctx.pflegeStopp) return { ...basis, ok: false, grund: "pflege-gestoppt", befunde: [{ pfad: "-", regel: "pflege-gestoppt", meldung: "Die Pflege wurde für diesen Lauf beendet — nichts mehr geschrieben." }] };
  const o = ordner(ctx.vault);
  const verwerfen = (grund, befunde = [], info) => { zuruecksetzen(ctx.vault, kopie); return { ...basis, ok: false, grund, befunde, ...(info ? { info } : {}) }; };
  const zeiger = join(kopie.pfad, ".git");                     // Worktree-Zeiger: darf nie umgebogen werden (sonst träfe ein reset den echten Vault)
  const lies = () => { try { return readFileSync(zeiger, "utf8"); } catch { return null; } };
  kopie.kopf ??= git(ctx.vault, kopie.pfad, ["rev-parse", "HEAD"]);
  const kopfVorher = kopfUndBranch(ctx.vault, kopie), zeigerVorher = lies();
  const vorher = vaultZustand(ctx.vault);
  const integVorher = integritaetsStand(ctx, kopie);
  let r;
  try { r = await arbeit(kopie.pfad); }
  catch (e) { r = { ok: false, grund: "arbeit-fehler", befunde: [{ pfad: "-", regel: "fehler", meldung: einzeilig(e?.grund || e?.message).slice(0, 160) }] }; }
  // Zuerst die Integrität — auch bei gescheiterter Arbeit. Der Fingerabdruck wird VOR dem Zurücksetzen des Zeigers genommen, sonst wäre
  // ein umgebogener Zeiger schon geheilt; danach den Zeiger zurück, bevor irgendein git-Befehl in der Kopie läuft (sonst träfe er den echten Vault).
  const verletzt = abweichungen(integVorher, integritaetsStand(ctx, kopie));
  if (zeigerVorher !== null && lies() !== zeigerVorher) { try { writeFileSync(zeiger, zeigerVorher); } catch {} }
  if (verletzt.length) {
    meldeVerletzung(ctx, { einheit: eid, pfade: verletzt });
    return verwerfen("integritaet-verletzt", integritaetsBefunde(verletzt));
  }
  if (vaultZustand(ctx.vault) !== vorher) {
    ctx.pflegeStopp = true;
    return verwerfen("vault-veraendert", [{ pfad: "-", regel: "vault-veraendert", meldung: "Im Brain hat sich währenddessen etwas geändert — nichts übernommen, Pflege für heute beendet." }]);
  }
  if (zeigerVorher !== null && lies() !== zeigerVorher) {
    try { writeFileSync(zeiger, zeigerVorher); } catch {}
    ctx.pflegeStopp = true;
    return verwerfen("vault-veraendert", [{ pfad: ".git", regel: "vault-veraendert", meldung: "Die Arbeitskopie wurde umgebogen — nichts übernommen, Pflege für heute beendet." }]);
  }
  if (kopfUndBranch(ctx.vault, kopie) !== kopfVorher) {
    ctx.pflegeStopp = true;
    return verwerfen("arbeit-fehler", [{ pfad: "-", regel: "kopie-veraendert", meldung: "Es wurde an der Diff-Prüfung vorbei committet — verworfen, Pflege für heute beendet." }]);
  }
  if (ctx.pflegeGesperrtBeruehrt?.length) {                    // W4: die KI hat eine für sie entfernte (themen-ausgeschlossene) Datei neu angelegt
    const liste = ctx.pflegeGesperrtBeruehrt.slice(0, 3).join(", ");
    ctx.pflegeGesperrtBeruehrt = undefined;
    return verwerfen("thema-ausgeschlossen", [{ pfad: "-", regel: "gesperrt", meldung: `Eine ausgeschlossene Datei wurde neu angelegt: ${liste}`.slice(0, 160) }]);
  }
  if (!r?.ok) return verwerfen(r?.grund || "arbeit-fehler", r?.befunde || [], r?.info);
  try {
    revNachziehen(o.wiki, kopie, sammleDiff(ctx.vault, kopie));
    const vorLog = sammleDiff(ctx.vault, kopie);
    if (!vorLog.length) return verwerfen("unveraendert");
    const seiten = vorLog.filter((d) => istWikiSeite(d.pfad, o.wiki)).map((d) => d.pfad);
    const logRel = `${o.wiki}/_log.md`, logDatei = join(kopie.pfad, logRel);
    const altLog = existsSync(logDatei) ? readFileSync(logDatei, "utf8") : "# Ingest-Protokoll (append-only, neuester Eintrag oben)\n";
    writeFileSync(logDatei, fuegeLogEin(altLog, pflegeLogEintrag({ zeit: logZeit(new Date(ctx.jetzt)), lauf: ctx.lauf, art, titel,
      seiten: seiten.map((s) => s.slice(o.wiki.length + 1)), quelle: r.neueQuellen?.[0] || null })));
    const diff = sammleDiff(ctx.vault, kopie);
    const p = pruefeDiff(diff, { wiki: o.wiki, cluster: clusterIds(ctx.vault), jetzt: ctx.jetzt,
      neueQuellen: r.neueQuellen || [], neueBelege: r.neueBelege || [], aufgeloest: r.aufgeloest || [], umgezogen: r.umgezogen || [], ...pruef,
      ...(Array.isArray(r.nurSeiten) ? { nurSeiten: r.nurSeiten } : {}) });
    if (!p.ok) return verwerfen("diff-rot", p.befunde);
    // Inhaltsprüfung der Einheit (Inbox: deckt die Quelle jede neu hinzugefügte Aussage?) — erst nach der billigen Diff-Prüfung.
    if (typeof r.pruefeInhalt === "function") {
      const c = await r.pruefeInhalt(diff);
      if (!c?.ok) return verwerfen(c?.grund || "arbeit-fehler", c?.befunde || []);
    }
    try {
      git(ctx.vault, kopie.pfad, ["add", "--", ...diff.map((d) => d.pfad)]);
      git(ctx.vault, kopie.pfad, ["commit", "-q", "-m", pflegeBetreff({ lauf: ctx.lauf, art, titel, id: eid })]);
    } catch (e) {
      const aus = `${e.stdout || ""}\n${e.stderr || ""}`;
      const befund = aus.split("\n").map((z) => z.trim()).filter((z) => /^- |blockiert/.test(z)).slice(0, 5).join(" | ").slice(0, 400);
      return verwerfen("pruefung-rot", [{ pfad: "-", regel: "pruefung-rot", meldung: befund || "pre-commit rot" }]);
    }
    kopie.kopf = git(ctx.vault, kopie.pfad, ["rev-parse", "HEAD"]);
    // meta: was die Diff-Prüfung dieser Einheit braucht — der Lernmodus speichert es mit dem Patch (pflege-patch.mjs).
    return { ...basis, ok: true, commit: kopie.kopf, dateien: diff.map((d) => d.pfad), seiten, info: r.info,
      meta: { neueQuellen: r.neueQuellen || [], neueBelege: r.neueBelege || [], umgezogen: r.umgezogen || [], aufgeloest: r.aufgeloest || [], seiten } };
  } catch (e) {
    return verwerfen("arbeit-fehler", [{ pfad: "-", regel: "fehler", meldung: einzeilig(e?.message).slice(0, 160) }]);
  }
}

// Nach dem ff-Merge (auch nach Rebase): Einheit-ID → Commit-Hash in main, aus den Betreffs dieses Laufs.
export function pflegeCommits(vault, lauf, n) {
  const m = new Map();
  if (!n) return m;
  for (const z of git(vault, vault, ["log", `-n${n}`, "--format=%H%x09%s", "main"]).split("\n")) {
    const [h, s = ""] = z.split("\t");
    const t = s.match(BETREFF_PFLEGE);
    if (t && t[1] === lauf) m.set(t[2], h);
  }
  return m;
}
export function uebernehmePflege(ctx, kopie) {
  if (ctx.probe) return { ok: false, grund: "probe", commits: new Map() };
  let kopf = null, soll = null;
  try {
    kopf = git(ctx.vault, ctx.vault, ["rev-parse", kopie.branch]);
    soll = kopie.kopf || git(ctx.vault, ctx.vault, ["merge-base", "main", kopie.branch]);   // ohne Einheit: der Branch darf nichts Eigenes tragen
  } catch {}
  if (!kopf || kopf !== soll) return { ok: false, grund: "ungeprueft", commits: new Map() };   // nur geprüfte Commits kommen in den Vault
  const m = uebernehmen(ctx.vault, kopie);
  if (!m.ok) return { ok: false, grund: m.grund, commits: new Map() };
  return { ok: true, commits: pflegeCommits(ctx.vault, ctx.lauf, m.commits) };
}
