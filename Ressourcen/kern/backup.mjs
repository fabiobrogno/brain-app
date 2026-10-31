// backup.mjs — Sicherung: github (push) | ordner (git bundle, 7 behalten) | keins. Alltagssprache, nie Abbruch im Alltag.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, lstatSync, rmSync, writeFileSync, readFileSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { ladeConfig, supportOrdner } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { nimmSperre, umstellungLaeuft } from "./abgleich-sperre.mjs";
const git = (v, ...a) => execFileSync(gitBefehl({ cfg: ladeConfig(v) }), ["-C", v, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

// Der Sicherungsordner steht NICHT in der brain.config.json des Vaults (Vault-Daten dürfen nicht bestimmen, wohin der Kern schreibt), sondern je
// Vault im Support-Ordner der App: <Support>/backup/<Kennung des Vaults>.json = { "pfad": "<absoluter Ordner>" }. Gesetzt wird er nur von
// `brain backup einrichten ordner:<pfad>` (Kern/App). Ein „pfad“ in der Vault-Config (ältere Vaults) zählt nicht mehr — neu einrichten.
// Kennung des Vaults: Hash des kanonischen Pfads (realpath.native); Übergang: eine unter der früheren Kennung (JS-realpath) angelegte Datei wird weiter gefunden.
const hashPfad = (p) => createHash("sha256").update(p).digest("hex").slice(0, 16);
export const kennungen = (vault) => {
  const e = (f) => { try { return f(vault); } catch { return vault; } };
  return [...new Set([hashPfad(e(realpathSync.native)), hashPfad(e(realpathSync))])];
};
const kennung = (vault) => kennungen(vault)[0];
const backupDatei = (vault, support = supportOrdner()) => {
  const ids = kennungen(vault);
  return join(support, "backup", `${ids.find((i) => existsSync(join(support, "backup", `${i}.json`))) || ids[0]}.json`);
};
export const merkerDateiFuer = (vault, support = supportOrdner()) => backupDatei(vault, support);
// Die gemeinsame Sperre aller Abgleiche (abgleich-sperre.mjs): immer unter der ersten Kennung, nie davon abhängig, welche Merker-Datei schon da ist
export const sperrDateiFuer = (vault, support = supportOrdner()) => join(support, "backup", `${kennung(vault)}.sperre`);
// Absolut, ein Ordner (falls schon vorhanden), kein Verweis. → Fehlertext oder null
export function pruefeBackupPfad(p) {
  if (typeof p !== "string" || !p || p.includes("\0") || !isAbsolute(p)) return "Der Sicherungsordner muss ein absoluter Pfad sein.";
  let st = null;
  try { st = lstatSync(p); } catch { /* noch nicht da (Stick abgezogen) ist erlaubt */ }
  if (st && st.isSymbolicLink()) return "Der Sicherungsordner darf kein Verweis (Symlink) sein.";
  if (st && !st.isDirectory()) return "Der Sicherungsordner ist kein Ordner.";
  return null;
}
const leseDatei = (vault, support) => { try { const o = JSON.parse(readFileSync(backupDatei(vault, support), "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; } };
// Atomar (Temp-Datei + rename): ein Leser sieht nie eine halbe Datei und verliert so nie die Bestätigung des Ziels oder den Sicherungsordner
const atomar = (datei, inhalt) => { const tmp = `${datei}.${process.pid}.tmp`; writeFileSync(tmp, inhalt); renameSync(tmp, datei); };
const schreibeDatei = (vault, o, support = supportOrdner()) => {
  mkdirSync(join(support, "backup"), { recursive: true });
  if (!Object.keys(o).length) rmSync(backupDatei(vault, support), { force: true });
  else atomar(backupDatei(vault, support), JSON.stringify(o) + "\n");
};
// Umstellung (P7b, Schritt A1): übernimmt den Sicherungsordner aus dem alten Eintrag der Vault-Config in den Support-Ordner – OHNE die Config zu ändern und ohne Commit
// (einrichten() schreibt die Config und committet). Der Ordner muss pruefeBackupPfad bestehen. `support` lenkt die Ablage um (Probelauf/Tests).
// → { ok, grund?, vorher: Inhalt der Merker-Datei oder null } (grund: "ungueltig" | "abweichend")
export function uebernehmeOrdner(vault, pfad, { support = supportOrdner(), ueberschreiben = false } = {}) {
  if (pruefeBackupPfad(pfad)) return { ok: false, grund: "ungueltig", vorher: null };
  const datei = backupDatei(vault, support);
  let vorher = null;
  try { vorher = readFileSync(datei, "utf8"); } catch { /* fehlt */ }
  const d = leseDatei(vault, support);
  if (typeof d.pfad === "string" && d.pfad && d.pfad !== pfad && !ueberschreiben) return { ok: false, grund: "abweichend", vorher };
  if (d.pfad === pfad) return { ok: true, geaendert: false, vorher };
  d.pfad = pfad;
  schreibeDatei(vault, d, support);
  return { ok: true, geaendert: true, vorher };
}
// → absoluter Pfad oder null (nicht eingerichtet / ungültig)
export function leseBackupOrdner(vault) {
  const p = leseDatei(vault).pfad;
  return pruefeBackupPfad(p) ? null : p;
}
// Push nur zu einem Remote, das der Nutzer bestätigt hat (<Support>/backup/<Kennung>.json → remoteBestaetigt; gesetzt vom Assistenten
// „Sicherung“, vom Studio-„Remote hinzufügen“ und von `brain backup einrichten github`, siehe gemeinsam/sicherungsmerker.mjs). Ein fremder Vault,
// der ein origin mitbringt, wird so nie automatisch beschickt. → { ok, url, grund }
export function pushErlaubnis(vault, support = supportOrdner()) {
  let url = "";
  try { url = git(vault, "config", "--get", "remote.origin.url").trim(); } catch { return { ok: false, url: "", grund: "kein-remote" }; }
  const bestaetigt = leseDatei(vault, support).remoteBestaetigt;
  if (!url) return { ok: false, url, grund: "kein-remote" };
  if (typeof bestaetigt !== "string" || bestaetigt !== url) return { ok: false, url, grund: bestaetigt ? "anderes-remote" : "nicht-bestaetigt" };
  return { ok: true, url };
}
// Vermerkt dieses Remote als vom Nutzer bestätigt (Aufrufer: einrichten github, Tests). Wirft nie.
export function bestaetigeRemote(vault, url, { support } = {}) {
  try { const d = leseDatei(vault, support); d.remoteBestaetigt = String(url); schreibeDatei(vault, d, support); return true; } catch { return false; }
}
export const PUSH_NICHT_BESTAETIGT = "Die Online-Sicherung wartet: Das Ziel dieses Vaults ist noch nicht von dir bestätigt (ein Vault kann ein fremdes Ziel mitbringen). Richte die Sicherung in Kortex ein (Einrichtung → Sicherung) oder sag „richte mir eine Sicherung ein“ — dann sichere ich dorthin.";
// Datum nach Ortszeit (wie der Kalender des Nutzers), nicht UTC — gilt für den Dateinamen und die „heute schon gesichert“-Prüfung des Sitzungsstarts
export function ortstag(h = new Date()) { return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`; }

export function einrichten(vault, wahl) {
  const cfg = ladeConfig(vault);
  const ordnerPfad = wahl.startsWith("ordner:") ? wahl.slice(7) : null;
  if (ordnerPfad !== null) {
    const fehler = pruefeBackupPfad(ordnerPfad);
    if (fehler) throw new Error(fehler);
  }
  cfg.backup = wahl === "github" ? { art: "github" } : ordnerPfad !== null ? { art: "ordner" } : { art: "keins" };
  try {
    const d = leseDatei(vault);
    if (ordnerPfad !== null) d.pfad = ordnerPfad; else delete d.pfad;
    if (wahl === "github") {
      // Der Nutzer richtet die Online-Sicherung ausdrücklich ein: das aktuelle origin (https/ssh) gilt ab jetzt als bestätigt
      let url = ""; try { url = git(vault, "config", "--get", "remote.origin.url").trim(); } catch { /* kein Remote */ }
      if (/^(https:\/\/|ssh:\/\/|[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9_.:-]*:)\S+$/.test(url)) d.remoteBestaetigt = url;
    } else if (wahl === "keins") delete d.remoteBestaetigt;
    schreibeDatei(vault, d);
  } catch (e) { throw new Error(`Der Sicherungsordner konnte nicht gemerkt werden (${e && e.code ? e.code : "Fehler"}).`); }
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify(cfg, null, 2) + "\n");
  // Config-Änderung sofort sichern (wie bei systemVersion im Skill update) — per Pfadangabe NUR diese
  // Datei stagen und committen, damit andere bereits gestagte (fremde) Änderungen unangetastet bleiben.
  try {
    // Ohne git-Identität (frischer Rechner, wiederhergestellter Vault) scheiterte der Commit sonst still —
    // gleicher Rückfall wie in install.mjs, nur für diesen Vault.
    try { git(vault, "config", "user.email"); } catch { git(vault, "config", "user.email", "brain@localhost"); git(vault, "config", "user.name", "Kortex"); }
    git(vault, "add", "--", "brain.config.json");
    git(vault, "commit", "-q", "-m", "brain: Sicherung eingerichtet", "--", "brain.config.json");
  } catch {}
  return ordnerPfad !== null ? { ...cfg.backup, pfad: ordnerPfad } : cfg.backup;
}

// Wie viele Notizen sind noch nicht eingearbeitet (uncommitted/untracked) — die Sicherung sichert nur den
// committeten Stand, also müssen wir sagen, was dabei fehlt, statt es still zu verschweigen.
function nichtEingearbeitet(vault) {
  try {
    const out = execFileSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", vault, "status", "--porcelain"], { encoding: "utf8", windowsHide: true });
    const n = out.split("\n").filter(Boolean).length;
    return n > 0 ? ` Achtung: ${n} Notiz(en) sind noch nicht eingearbeitet und deshalb nicht in der Sicherung — sag ‚arbeite meine Notizen ein‘.` : "";
  } catch { return ""; }
}

// ── Abgleich mit dem Server (mehrere Geräte) ─────────────────────────────────────────────────────────────────────────────
// Ein zweiter Mac oder das iPhone kann jederzeit einen Commit auf den Server legen. Ein bloßes Senden würde dann abgelehnt und als „kein
// Internet?“ missverstanden. Darum holt die Sicherung zuerst und führt zusammen — nach denselben Regeln wie der Studio-Abgleich
// (gemeinsam/git.mjs#sync): fetch, dann ff-only, sonst Zusammenführen ohne Hooks. Bei einem Konflikt wird NICHT gesendet: die Zusammenführung
// wird zurückgenommen (der Arbeitsstand bleibt, wie er war), der Stand „Konflikt“ wird im Support-Ordner vermerkt (<Support>/backup/<Kennung>.json
// → abgleich), und Menüleiste (brain status) und Studio weisen darauf hin. Gelöst wird der Konflikt im Studio („Abgleichen“).
// Alles läuft über git-sicher (gitBefehl), also mit allen Härtungen des Kerns; Hooks sind zusätzlich ausdrücklich aus.
// Ziel ist IMMER origin (das vom Nutzer bestätigte Remote), und zwar mit ausdrücklichem Zweig: geholt wird `+refs/heads/X:refs/remotes/origin/X`,
// gesendet `HEAD:refs/heads/X`, jeweils an die bestätigte Adresse selbst (nicht über den Remote-Namen: dessen fetch-Einträge würden mitaktualisieren) — weder ein Refspec noch ein Upstream, pushurl oder pushremote aus der Vault-Konfiguration kann das umlenken.
export const ZEIT_NETZ = 90_000, ZEIT_LOKAL = 30_000, OHNE_ZEIT = 0;
export const OHNE_HOOKS = ["-c", "core.hooksPath=/dev/null"];

export function gitLauf(vault, args, zeit = ZEIT_LOKAL) {
  const r = spawnSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", vault, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: zeit });
  const zuLange = r.error && r.error.code === "ETIMEDOUT";
  return { code: r.error ? (zuLange ? 124 : 1) : (r.status ?? 1), out: r.stdout || "", err: `${r.stderr || ""}${zuLange ? " Operation timed out" : ""}` };
}

// Fehlerausgabe (LC_ALL=C, also englisch) → Art des Fehlers. Reihenfolge zählt: gesperrt, Anmeldung, „abgelehnt“, „kein Netz“
// (ein ssh-Fehler endet mit „Could not read from remote repository“, ist aber eine Anmeldung). Der Rohtext kommt nie in eine Meldung.
export function gitFehlerArt(ausgabe) {
  const a = String(ausgabe || "");
  if (/git-sicher: git ist für diesen Ordner gesperrt|git-gesperrt/i.test(a)) return "gesperrt";
  if (/Authentication failed|could not read (Username|Password)|Permission denied \(publickey|Permission to .* denied|terminal prompts disabled|access denied|error: 40[13]|publickey|Invalid username or password|Repository not found|Host key verification failed/i.test(a)) return "anmeldung";
  if (/\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first|failed to push some refs|protected branch|pre-receive hook declined|stale info/i.test(a)) return "abgelehnt";
  if (/Could not resolve host|Connection (timed out|refused|reset)|Network is unreachable|early EOF|Operation timed out|unable to access|Could not read from remote|Failed to connect|Temporary failure|SSL|TLS|RPC failed|remote end hung up|Software caused connection abort/i.test(a)) return "netz";
  return "fehler";
}

const OK_ARTEN = new Set(["aktuell", "geholt", "gesendet", "beides"]);
const STAND_ARTEN = new Set(["konflikt", "anmeldung", "neues"]);
export const KONFLIKT_STATUS = "Konflikt – im Studio lösen";
export const STAND_TEXT = {
  konflikt: KONFLIKT_STATUS,
  anmeldung: "Anmeldung für die Online-Sicherung nötig",
  neues: "Auf dem Server liegt Neues – im Studio abgleichen",
};
const NAECHSTES_MAL = "Ich versuche es beim nächsten Mal wieder.";
const MELDUNG = {
  aktuell: "Online gesichert.",
  gesendet: "Online gesichert.",
  geholt: "Online gesichert. Neues von einem anderen Gerät wurde dabei übernommen.",
  beides: "Online gesichert. Neues von einem anderen Gerät wurde dabei übernommen.",
  konflikt: `Die Online-Sicherung wartet: ${KONFLIKT_STATUS}. Auf dem Server liegt eine andere Fassung derselben Notiz (zum Beispiel von einem anderen Gerät). Es wurde nichts überschrieben und nichts gesendet — öffne das Studio und tippe auf „Abgleichen“, dort wählst du, welche Fassung gilt.`,
  ungesichert: "Die Online-Sicherung wartet: Auf dem Server liegt Neues, aber es stehen noch nicht eingearbeitete Änderungen im Weg. Es wurde nichts gesendet. Arbeite deine Notizen ein oder gleiche im Studio ab.",
  abgelehnt: `Der Server hat die Online-Sicherung abgelehnt (dort liegt inzwischen Neueres, oder der Zweig ist geschützt). ${NAECHSTES_MAL}`,
  netz: `Online-Sicherung hat gerade nicht geklappt: Der Server ist nicht erreichbar (kein Internet?). ${NAECHSTES_MAL}`,
  anmeldung: "Online-Sicherung hat nicht geklappt: Die Anmeldung beim Server fehlt oder wurde abgelehnt. Melde dich in Kortex neu an (Einrichtung → Sicherung).",
  fehler: `Online-Sicherung hat gerade nicht geklappt. ${NAECHSTES_MAL}`,
  gesperrt: "Die Online-Sicherung wartet: Dieser Vault ist in Kortex noch nicht als deiner bestätigt (oder seine Git-Einstellungen sind nicht erlaubt). Bestätige ihn im Studio unter Einstellungen.",
  umgeleitet: "Die Online-Sicherung wartet: Die Git-Einstellungen dieses Vaults leiten das Senden woandershin um (pushurl, pushremote oder ein anderes Ziel als das bestätigte). Aus Sicherheitsgründen sende ich so nichts.",
  umstellung: `Die Online-Sicherung wartet: Kortex räumt gerade deinen Vault auf (alter Werkzeug-Ordner). ${NAECHSTES_MAL}`,
  laeuft: `Die Online-Sicherung wartet: Gerade läuft ein anderer Abgleich (zum Beispiel im Studio). ${NAECHSTES_MAL}`,
  beschaeftigt: `Die Online-Sicherung wartet: Gerade arbeitet eine Einarbeitung (Sperre .logs/ingest.lock). ${NAECHSTES_MAL}`,
  "kein-zweig": "Die Online-Sicherung wartet: Der Vault steht auf keinem Zweig. Wähle im Studio zuerst einen Zweig.",
  "kein-commit": "Die Online-Sicherung wartet: Es gibt noch nichts Eingearbeitetes zum Sichern.",
};

// Vermerk im Support-Ordner: abgleich = { stand: "konflikt"|"anmeldung"|"neues", zeit, dateien? }. Nur eine Änderung des Standes (oder der Dateiliste
// bei einem Konflikt) schreibt; zeit bleibt die des ersten Mals. dateien = die Notizen im Konflikt (ohne versteckte Orte): das Studio zeigt damit schon
// vor dem Öffnen „Konflikt in 2 Notizen“. Der Konfliktstand wird geräumt, sobald ein Abgleich durchläuft (loescheAbgleichStand).
const sichtbareDateien = (liste) => (Array.isArray(liste) ? liste : []).filter((p) => typeof p === "string" && p && !p.split("/").some((t) => t.startsWith("."))).slice(0, 200);
export function merkeStand(vault, stand, support, extra = {}) {
  try {
    const d = leseDatei(vault, support);
    if (!stand && d.konfliktBasis) return; // ein gemerkter Stand (Konflikt wartet auf Entscheidungen) wird nie nebenbei geräumt — nur Lösen, Verwerfen oder die Oberfläche tun das
    const alt = d.abgleich && typeof d.abgleich === "object" ? d.abgleich : null;
    const dateien = stand === "konflikt" && Array.isArray(extra.dateien) ? sichtbareDateien(extra.dateien) : null;
    const gleich = alt && alt.stand === stand && (!dateien || JSON.stringify(dateien) === JSON.stringify(alt.dateien || []));
    if (gleich || (!stand && !alt)) return;
    if (stand) {
      d.abgleich = { stand, zeit: alt && alt.stand === stand && typeof alt.zeit === "string" ? alt.zeit : new Date().toISOString() };
      const behalten = dateien || (alt && alt.stand === stand && Array.isArray(alt.dateien) ? alt.dateien : null);
      if (behalten && stand === "konflikt") d.abgleich.dateien = behalten;
    } else delete d.abgleich;
    schreibeDatei(vault, d, support);
  } catch { /* nur Komfort: ohne Vermerk bleibt der Hinweis eben aus */ }
}
// → { stand, text, zeit, dateien } oder null. Menüleiste (brain status) und Studio zeigen damit den Hinweis.
export function leseAbgleichStand(vault, { support = supportOrdner() } = {}) {
  const a = leseDatei(vault, support).abgleich;
  if (!a || typeof a !== "object" || !STAND_ARTEN.has(a.stand)) return null;
  return { stand: a.stand, text: STAND_TEXT[a.stand], zeit: typeof a.zeit === "string" ? a.zeit : null, dateien: sichtbareDateien(a.dateien) };
}
// Rohzugriff auf den Merker des Vaults für die Konfliktlösung (abgleich-konflikt.mjs): lesen, ändern, schreiben in einem Zug.
export function aendereMerker(vault, fn, { support = supportOrdner() } = {}) {
  const d = leseDatei(vault, support);
  const neu = fn(d) || d;
  schreibeDatei(vault, neu, support);
  return neu;
}
export const leseMerkerDatei = (vault, support = supportOrdner()) => leseDatei(vault, support);
export function loescheAbgleichStand(vault, { support = supportOrdner() } = {}) { merkeStand(vault, null, support); }

const mergeOffen = (vault) => gitLauf(vault, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).code === 0;
// Dieselbe Sperre wie `brain lock` / die Übernahme des Tageslaufs (.logs/ingest.lock, frisch < 30 min): währenddessen fasst der Hintergrund den Arbeitsbaum nicht an.
function ingestGesperrt(vault) {
  try { return Date.now() - statSync(join(vault, ".logs", "ingest.lock")).mtimeMs < 30 * 60000; } catch { return false; }
}

// Ziel dieses Zweigs auf origin. → { zweig, ref, vorhanden } | { fehler: "umgeleitet" }.
// zweig = Name auf dem Server (aus branch.<z>.merge, sonst der lokale Name), ref = refs/remotes/origin/<zweig>, vorhanden = Upstream ist schon eingerichtet.
// Ein Upstream auf ein anderes Remote als origin, pushurl, pushremote oder push.default-Umlenkungen gelten als Umleitung: dann wird nichts geholt oder gesendet.
function ziel(vault, lokal) {
  const cfg = (k) => { const r = gitLauf(vault, ["config", "--get", k]); return r.code === 0 ? r.out.trim() : ""; };
  const url = cfg("remote.origin.url");
  if (!url) return { fehler: "fehler" };
  if (cfg("remote.origin.pushurl") || cfg(`branch.${lokal}.pushremote`) || cfg("remote.pushDefault")) return { fehler: "umgeleitet" };
  const remote = cfg(`branch.${lokal}.remote`), merge = cfg(`branch.${lokal}.merge`);
  if (!remote && !merge) return { url, zweig: lokal, ref: `refs/remotes/origin/${lokal}`, vorhanden: false };
  if (remote !== "origin" || !/^refs\/heads\/[^\s~^:?*[\\]+$/.test(merge)) return { fehler: "umgeleitet" };
  const zweig = merge.slice("refs/heads/".length);
  return { url, zweig, ref: `refs/remotes/origin/${zweig}`, vorhanden: true };
}
function zaehlen(vault, ref) {
  const r = gitLauf(vault, ["rev-list", "--left-right", "--count", `HEAD...${ref}`]);
  if (r.code !== 0) return null;
  const [vor, zurueck] = r.out.trim().split(/\s+/).map(Number);
  return { vor: vor || 0, zurueck: zurueck || 0 };
}
// Holt genau diesen Zweig. → { code, err, neu } (neu: der Zweig fehlt auf dem Server)
function hole(vault, z) {
  const f = gitLauf(vault, [...OHNE_HOOKS, "fetch", "--quiet", "--no-recurse-submodules", z.url, `+refs/heads/${z.zweig}:${z.ref}`], ZEIT_NETZ);
  return { ...f, neu: f.code !== 0 && /couldn't find remote ref/i.test(f.err) };
}
// Verbindet den lokalen Zweig mit origin/<zweig>, wenn noch kein Upstream da ist (einen vorhandenen fasst das nie an)
function upstreamSetzen(vault, lokal, z) {
  if (!z.vorhanden) gitLauf(vault, [...OHNE_HOOKS, "branch", "--set-upstream-to", `origin/${z.zweig}`, lokal]);
}

// Holen, zusammenführen, senden. → { art, ok, text, dateien? } mit art ∈ aktuell | gesendet | geholt | beides (alle ok) | konflikt | ungesichert |
// abgelehnt | netz | anmeldung | fehler | gesperrt | umgeleitet | beschaeftigt | kein-zweig | kein-commit. Wirft nie. Sendet nur nach einem sauberen Zusammenführen.
export function abgleichen(vault, { support = supportOrdner(), sperre = true } = {}) {
  if (umstellungLaeuft(vault)) return { art: "umstellung", ok: false, text: MELDUNG.umstellung };
  if (!sperre) return abgleichenInnen(vault, support);
  const s = nimmSperre(sperrDateiFuer(vault, support), { art: "sicherung" }); // dieselbe Sperre wie der Abgleich im Studio: nie zwei zugleich
  if (!s.ok) return { art: "laeuft", ok: false, text: MELDUNG.laeuft };
  try { return abgleichenInnen(vault, support); } finally { s.freigeben(); }
}
function abgleichenInnen(vault, support) {
  const fertig = (art, extra = {}) => {
    if (OK_ARTEN.has(art)) merkeStand(vault, null, support);
    else if (art === "konflikt" || art === "anmeldung") merkeStand(vault, art, support, { dateien: extra.dateien });
    else if (art === "ungesichert") merkeStand(vault, "neues", support);
    return { art, ok: OK_ARTEN.has(art), text: MELDUNG[art], ...extra };
  };
  try {
    if (mergeOffen(vault)) return fertig("konflikt"); // eine offene Zusammenführung (im Studio begonnen) wartet auf den Nutzer
    // Nach „Rückgängig“ (oder einem Abbruch mitten im Festhalten) wartet ein gemerkter Stand auf neue Entscheidungen: bis dahin sendet die Sicherung nichts
    if (leseDatei(vault, support).konfliktBasis) return fertig("konflikt");
    if (ingestGesperrt(vault)) return fertig("beschaeftigt");
    const zw = gitLauf(vault, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (zw.code !== 0) return fertig("kein-zweig");
    const lokal = zw.out.trim();
    if (gitLauf(vault, ["rev-parse", "--verify", "-q", "HEAD"]).code !== 0) return fertig("kein-commit");
    const z = ziel(vault, lokal);
    if (z.fehler) return fertig(z.fehler);
    let geholt = false;
    for (let runde = 0; runde < 2; runde++) { // eine zweite Runde nur, wenn der Server zwischen Holen und Senden schon wieder Neues bekam
      const f = hole(vault, z);
      if (f.neu) { // der Zweig ist auf dem Server neu
        const p = gitLauf(vault, [...OHNE_HOOKS, "push", "--quiet", z.url, `HEAD:refs/heads/${z.zweig}`], ZEIT_NETZ);
        if (p.code !== 0) return fertig(gitFehlerArt(p.err));
        gitLauf(vault, [...OHNE_HOOKS, "fetch", "--quiet", "--no-recurse-submodules", z.url, `+refs/heads/${z.zweig}:${z.ref}`], ZEIT_NETZ);
        upstreamSetzen(vault, lokal, z);
        return fertig("gesendet");
      }
      if (f.code !== 0) return fertig(gitFehlerArt(f.err));
      upstreamSetzen(vault, lokal, z);
      let n = zaehlen(vault, z.ref);
      if (!n) return fertig("fehler");
      if (n.zurueck > 0) {
        geholt = true;
        // ohne eigene Identität (frischer Rechner) scheiterte das Zusammenführen: die Rückfall-Identität gilt nur für diesen Aufruf
        const hatIdent = gitLauf(vault, ["config", "user.email"]).code === 0 && gitLauf(vault, ["config", "user.name"]).code === 0;
        const ident = hatIdent ? [] : ["-c", "user.email=brain@localhost", "-c", "user.name=Kortex"];
        if (mergeOffen(vault)) return fertig("konflikt"); // inzwischen im Studio begonnen: nicht anfassen
        const spitze = gitLauf(vault, ["rev-parse", "--verify", "-q", z.ref]).out.trim();
        // lokale Zusammenführungen ohne Zeitlimit: ein Abbruch mitten im Checkout ließe einen halben Arbeitsbaum zurück
        let m = gitLauf(vault, [...OHNE_HOOKS, ...ident, "merge", "--ff-only", "--quiet", z.ref], OHNE_ZEIT);
        if (m.code !== 0) m = gitLauf(vault, [...OHNE_HOOKS, ...ident, "merge", "--no-edit", "--quiet", z.ref], OHNE_ZEIT);
        if (m.code !== 0) {
          const dateien = gitLauf(vault, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
          // zurücknehmen nur, was DIESER Lauf begonnen hat: MERGE_HEAD zeigt auf den eben geholten Stand (nie die Zusammenführung des Nutzers aus dem Studio)
          const kopf = gitLauf(vault, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
          if (kopf.code === 0 && kopf.out.trim() === spitze) gitLauf(vault, ["merge", "--abort"]);
          return dateien.length ? fertig("konflikt", { dateien }) : fertig("ungesichert");
        }
        n = zaehlen(vault, z.ref) || n;
      }
      if (n.vor > 0 || n.zurueck > 0) {
        const p = gitLauf(vault, [...OHNE_HOOKS, "push", "--quiet", z.url, `HEAD:refs/heads/${z.zweig}`], ZEIT_NETZ);
        if (p.code !== 0) {
          const art = gitFehlerArt(p.err);
          if (art === "abgelehnt" && runde === 0) continue;
          return fertig(art);
        }
        return fertig(geholt ? "beides" : "gesendet");
      }
      return fertig(geholt ? "geholt" : "aktuell");
    }
    return fertig("abgelehnt");
  } catch { return fertig("fehler"); }
}

// Regelmäßiges Holen (Sitzungsstart, Tageslauf): damit Änderungen anderer Geräte (zum Beispiel Aufgaben vom iPhone) hier ankommen. Nur mit einem
// vom Nutzer bestätigten Remote. Fast-Forward automatisch, aber nur bei sauberem Arbeitsbaum und ohne eigene neue Commits; sonst nur der Hinweis
// „Neues auf dem Server“ (Stand „neues“). Sendet nie, führt nie mit Merge-Commit zusammen. → { art, ok, text } mit art ∈ aktuell | geholt | neues |
// nicht-bestaetigt | konflikt | netz | anmeldung | abgelehnt | fehler | gesperrt | umgeleitet | beschaeftigt | kein-zweig | kein-commit. Wirft nie.
export function holen(vault, { support = supportOrdner() } = {}) {
  let s = null;
  try {
    if (!pushErlaubnis(vault, support).ok) return { art: "nicht-bestaetigt", ok: false, text: PUSH_NICHT_BESTAETIGT };
    if (umstellungLaeuft(vault)) return { art: "umstellung", ok: false, text: MELDUNG.umstellung };
    s = nimmSperre(sperrDateiFuer(vault, support), { art: "holen" });
    if (!s.ok) return { art: "laeuft", ok: false, text: MELDUNG.laeuft };
    return holenInnen(vault, support);
  } catch { return { art: "fehler", ok: false, text: MELDUNG.fehler }; } finally { if (s && s.ok) s.freigeben(); }
}
function holenInnen(vault, support) {
  try {
    if (!pushErlaubnis(vault, support).ok) return { art: "nicht-bestaetigt", ok: false, text: PUSH_NICHT_BESTAETIGT };
    const ergebnis = (art, ok = OK_ARTEN.has(art)) => ({ art, ok, text: MELDUNG[art] || STAND_TEXT[art] || "" });
    if (mergeOffen(vault) || leseDatei(vault, support).konfliktBasis) return ergebnis("konflikt", false); // offene Zusammenführung oder gemerkter Stand: nichts anfassen
    if (ingestGesperrt(vault)) return ergebnis("beschaeftigt", false);
    const zw = gitLauf(vault, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (zw.code !== 0) return ergebnis("kein-zweig", false);
    const lokal = zw.out.trim();
    if (gitLauf(vault, ["rev-parse", "--verify", "-q", "HEAD"]).code !== 0) return ergebnis("kein-commit", false);
    const z = ziel(vault, lokal);
    if (z.fehler) return ergebnis(z.fehler, false);
    const f = hole(vault, z);
    if (f.neu) return ergebnis("aktuell"); // der Zweig ist auf dem Server neu: nichts zu holen
    if (f.code !== 0) {
      const art = gitFehlerArt(f.err);
      if (art === "anmeldung") merkeStand(vault, "anmeldung", support);
      return ergebnis(art, false);
    }
    upstreamSetzen(vault, lokal, z);
    const n = zaehlen(vault, z.ref);
    if (!n) return ergebnis("fehler", false);
    if (n.zurueck === 0) { merkeStand(vault, null, support); return ergebnis("aktuell"); }
    const gesetzt = leseAbgleichStand(vault, { support });
    const hinweis = () => { if (!gesetzt || gesetzt.stand !== "konflikt") merkeStand(vault, "neues", support); return ergebnis("neues", false); };
    if (n.vor > 0) return hinweis(); // beide Seiten haben Neues: zusammenführen macht die Sicherung bzw. das Studio
    if (gitLauf(vault, ["status", "--porcelain"]).out.trim()) return hinweis(); // nicht eingearbeitete Änderungen: nicht anfassen
    const m = gitLauf(vault, [...OHNE_HOOKS, "merge", "--ff-only", "--quiet", z.ref], OHNE_ZEIT);
    if (m.code !== 0) return hinweis();
    merkeStand(vault, null, support);
    return ergebnis("geholt");
  } catch { return { art: "fehler", ok: false, text: MELDUNG.fehler }; }
}

// Holen höchstens alle 10 Minuten je Vault (Sitzungsstarts kommen oft hintereinander). Die Zeit steht im Support-Ordner in einer eigenen Datei
// (<Kennung>.holen.json, nicht im Vault und nicht im Merker): eine Datei im Vault machte den Arbeitsbaum „unsauber“, und häufiges Schreiben des Merkers
// risse sein Lesen-Ändern-Schreiben mit dem des Studios auseinander.
export const MIN_ABSTAND_HOLEN_MS = 10 * 60000;
export function holenGedrosselt(vault, { jetzt = Date.now(), support = supportOrdner() } = {}) {
  if (!pushErlaubnis(vault, support).ok) return { art: "nicht-bestaetigt", ok: false, text: PUSH_NICHT_BESTAETIGT };
  const datei = backupDatei(vault, support).replace(/\.json$/, ".holen.json");
  try { const z = Number(JSON.parse(readFileSync(datei, "utf8")).zeit); if (Number.isFinite(z) && jetzt - z >= 0 && jetzt - z < MIN_ABSTAND_HOLEN_MS) return { art: "uebersprungen", ok: true, text: "" }; } catch { /* noch nie geholt */ }
  const r = holen(vault, { support });
  try { mkdirSync(join(support, "backup"), { recursive: true }); atomar(datei, JSON.stringify({ zeit: jetzt }) + "\n"); } catch { /* nur Komfort */ }
  return r;
}

// → { ok, art, text }; ok = gesichert (bei der Ordner-Sicherung: ein Bundle geschrieben). Der Sitzungsstart merkt sich damit, ob er es noch einmal versuchen muss.
export function sichernErgebnis(vault) {
  let b = ladeConfig(vault).backup;
  // Ohne backup-Eintrag, aber mit eingerichtetem Git-Remote: pushen wie bisher (gleiche Rückfall-Regel wie
  // im Sitzungsstart — ältere Vaults vor dieser Sicherungs-Funktion sichern unverändert weiter).
  if (!b) { let remote = ""; try { remote = git(vault, "remote").trim(); } catch {} b = remote ? { art: "github" } : { art: "keins" }; }
  if (b.art === "keins") return { ok: false, art: "keins", text: "Keine Sicherung eingerichtet. Sag „richte mir eine Sicherung ein“, wenn du eine möchtest." };
  const hinweis = nichtEingearbeitet(vault);
  if (b.art === "github") {
    if (!pushErlaubnis(vault).ok) return { ok: false, art: "nicht-bestaetigt", text: PUSH_NICHT_BESTAETIGT };
    const r = abgleichen(vault);
    return { ok: r.ok, art: r.art, text: r.text + (r.ok ? hinweis : "") };
  }
  // Der Ordner kommt aus dem Support-Ordner (nie aus der Vault-Config) und wird vor jedem Gebrauch neu geprüft
  const ziel = leseBackupOrdner(vault);
  if (!ziel) return { ok: false, art: "kein-ordner", text: "Für diesen Vault ist kein gültiger Sicherungsordner eingerichtet (absoluter Ordner, kein Verweis). Sag „richte mir eine Sicherung ein“ oder: brain backup einrichten ordner:<Ordner>." };
  if (!existsSync(ziel)) return { ok: false, art: "ordner-fehlt", text: "Der Sicherungsordner ist gerade nicht da (Stick oder Platte nicht angeschlossen?). Ich sichere beim nächsten Mal." };
  const datei = join(ziel, `brain-${ortstag()}.bundle`);
  git(vault, "bundle", "create", datei, "--all");
  const alle = readdirSync(ziel).filter(f => /^brain-.*\.bundle$/.test(f)).sort((x, y) => statSync(join(ziel, y)).mtimeMs - statSync(join(ziel, x)).mtimeMs);
  for (const alt of alle.slice(7)) rmSync(join(ziel, alt));
  return { ok: true, art: "ordner", text: `Gesichert in ${ziel}.` + hinweis };
}
export function sichern(vault) { return sichernErgebnis(vault).text; }

export function wiederherstellen(quelle, ziel) {
  let nichtLeer = false;
  try { nichtLeer = existsSync(ziel) && readdirSync(ziel).length > 0; } catch { nichtLeer = true; }
  if (nichtLeer) return { ok: false, text: `Der Zielordner ${ziel} ist nicht leer — ich stelle nur in einen leeren oder neuen Ordner wieder her.` };
  try {
    execFileSync(gitBefehl({ ohneVault: true }), ["clone", "-q", quelle, ziel], { stdio: "ignore", windowsHide: true });
    // Aus einer Bundle-Datei oder einem lokalen Ordner geklont: das „origin“ zeigt auf einen lokalen Pfad. Lokale Remotes sind im Kern nicht erlaubt
    // (ein Push startete die Hooks des Ziels) und würden den wiederhergestellten Vault sperren — also entfernen.
    // Der Klon gehört zu keinem Vault dieses Prozesses (Workspace-Trust, P5): git-sicher ohne Vertrauensprüfung, nur für diese beiden Befehle.
    const gitZiel = (...a) => execFileSync(gitBefehl({ ohneVault: true }), ["-C", ziel, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try {
      const u = gitZiel("config", "--get", "remote.origin.url").trim();
      if (u.startsWith("/") || u.startsWith("file:")) gitZiel("config", "--remove-section", "remote.origin");
    } catch { /* kein origin */ }
    return { ok: true, text: `Wiederhergestellt nach ${ziel}.` };
  } catch {
    return { ok: false, text: "Wiederherstellen hat nicht geklappt — ist die Sicherungsdatei bzw. die Adresse richtig?" };
  }
}
