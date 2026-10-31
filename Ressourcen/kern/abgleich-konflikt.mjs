// abgleich-konflikt.mjs — Konflikt beim Abgleich: beide Fassungen zeigen, entscheiden, abschließen, zurücknehmen. EINE Wahrheit für Studio und Kern.
//
// Datenfluss: Die Hintergrund-Sicherung (backup.mjs#abgleichen) merkt einen Konflikt im Support-Ordner (<Support>/backup/<Kennung>.json → abgleich) und
// nimmt ihre Zusammenführung zurück. Das Studio holt auf Wunsch noch einmal und lässt die Zusammenführung offen (gemeinsam/git.mjs#sync); dieses Modul
// liest dann beide Fassungen jeder Datei (ansicht), nimmt die Entscheidungen entgegen (loesen), schließt die Zusammenführung ab und gleicht danach wie
// die Sicherung ab (backup.mjs#abgleichen: holen, senden, nur an das bestätigte Ziel), räumt den Konfliktstand und kann die Entscheidungen zurücknehmen
// (rueckgaengig). Aufgerufen wird es vom Kern-Befehl `brain abgleich <ansicht|loesen|abbrechen|rueckgaengig>` (JSON auf stdout); die Werkstatt startet ihn
// als Kindprozess (gemeinsam/vault.mjs). Alle git-Aufrufe laufen über git-sicher (backup.mjs#gitLauf), die Zusammenführung immer ohne Hooks.
//
// Entscheidungen je Datei: meine (diese behalten) · andere (die andere Fassung nehmen) · beide (meine bleibt, die andere liegt als Kopie „<Name> (<Gerät>)“ daneben) ·
// text (zusammengeführter Text, selbst geschrieben). Eine Aufgaben-Karte kennt nur meine/andere. Verlauf: Die Zusammenführung selbst hält zuerst überall
// „meine“ fest; JEDE Entscheidung ist danach ein eigener Eintrag im Verlauf („Konflikt gelöst: …“) — darüber lässt sich jede Fassung zurückholen, und
// „Rückgängig“ (letzter Abgleich) legt die Fassungen von vor den Entscheidungen als neuen Eintrag wieder hin. Nie Rebase, nie Reset, nie Force.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, realpathSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, extname, sep, isAbsolute } from "node:path";
import { hostname } from "node:os";
import { supportOrdner, ordner } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { gitLauf, OHNE_HOOKS, OHNE_ZEIT, ZEIT_LOKAL, abgleichen, pushErlaubnis, PUSH_NICHT_BESTAETIGT, loescheAbgleichStand, merkeStand, aendereMerker, leseMerkerDatei, sperrDateiFuer } from "./backup.mjs";
import { nimmSperre, umstellungLaeuft } from "./abgleich-sperre.mjs";
import { parseAufgabe } from "./aufgaben.mjs";

export const MAX_ANZEIGE = 200_000;          // so viel Text zeigt die Ansicht je Fassung
export const MAX_DATEI = 5 * 1024 * 1024;    // größere Dateien werden nicht zusammengeführt oder kopiert
export const WAHLEN = ["meine", "andere", "beide", "text"];

export class KonfliktFehler extends Error {
  constructor(status, text, extra = {}) { super(text); this.status = status; this.extra = extra; }
}

// ───────────────────────────── git ─────────────────────────────
const g = (vault, args, zeit = ZEIT_LOKAL) => gitLauf(vault, args, zeit);
function gBytes(vault, args) {
  const r = spawnSync(gitBefehl({}), ["-C", vault, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: ZEIT_LOKAL, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error ? 1 : (r.status ?? 1), out: r.stdout || Buffer.alloc(0), err: String(r.stderr || "") };
}
const istSha = (s) => typeof s === "string" && /^[0-9a-f]{40,64}$/i.test(s);
const kopfSha = (vault) => { const r = g(vault, ["rev-parse", "--verify", "-q", "HEAD"]); return r.code === 0 ? r.out.trim() : null; };
const mergeSha = (vault) => { const r = g(vault, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]); return r.code === 0 ? r.out.trim() : null; };
const istCommit = (vault, sha) => istSha(sha) && g(vault, ["cat-file", "-e", `${sha}^{commit}`]).code === 0;
const istVorfahr = (vault, a, b) => g(vault, ["merge-base", "--is-ancestor", a, b]).code === 0;
const hatInSha = (vault, sha, pfad) => !!sha && g(vault, ["cat-file", "-e", `${sha}:${pfad}`]).code === 0;
const blobVon = (vault, sha, pfad) => { if (!sha) return null; const r = gBytes(vault, ["cat-file", "blob", `${sha}:${pfad}`]); return r.code === 0 ? r.out : null; };
const blobId = (vault, sha, pfad) => { const r = g(vault, ["rev-parse", "-q", "--verify", `${sha}:${pfad}`]); return r.code === 0 ? r.out.trim() : null; };
const identFlags = (vault) => (g(vault, ["config", "user.email"]).code === 0 && g(vault, ["config", "user.name"]).code === 0 ? [] : ["-c", "user.email=brain@localhost", "-c", "user.name=Kortex"]);
const versteckt = (pfad) => pfad.split("/").some((t) => t.startsWith(".") || t.toLowerCase() === "node_modules");

// ───────────────────────────── Namen, Texte ─────────────────────────────
const einzeiler = (s, max = 80) => String(s ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const dateiNamenTeil = (s) => einzeiler(s, 40).replace(/[\\/:*?"<>|]/g, "").replace(/^\.+/, "").trim();

// Name dieses Geräts (Gerätemerker): <Support>/geraet.json → { name } vom Nutzer, sonst BRAIN_GERAET_NAME (Test), sonst der Computername (macOS), sonst der Rechnername.
export function eigenerGeraetName({ support = supportOrdner() } = {}) {
  try { const n = dateiNamenTeil(JSON.parse(readFileSync(join(support, "geraet.json"), "utf8")).name); if (n) return n; } catch { /* kein Merker */ }
  const env = dateiNamenTeil(process.env.BRAIN_TESTMODUS === "1" || process.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" ? process.env.BRAIN_GERAET_NAME : "");
  if (env) return env;
  if (process.platform === "darwin" && !process.env.BRAIN_TESTMODUS) {
    try { const r = spawnSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }); const n = dateiNamenTeil(r.stdout); if (n) return n; } catch { /* weiter */ }
  }
  return dateiNamenTeil(hostname().replace(/\.(local|lan|fritz\.box)$/i, "").replace(/[-_]+/g, " ")) || "Dieser Mac";
}
// Gerät hinter einem Commit: die Marke „Kortex-Geraet: <Name>“ (setzt dieses Modul), sonst die Standard-Adresse eines Macs („nutzer@Fabios-MacBook-Air.local“);
// sonst unbekannt (null → „anderes Gerät“).
export function geraetAusCommit({ nachricht = "", email = "" } = {}) {
  const t = /^Kortex-Geraet:[ \t]*(.+)$/im.exec(String(nachricht));
  if (t) { const n = dateiNamenTeil(t[1]); if (n) return n; }
  const m = /@([^@\s<>]+)\.local$/i.exec(String(email));
  if (m) { const n = dateiNamenTeil(m[1].replace(/[-_]+/g, " ")); if (n) return n; }
  return null;
}
const textVon = (buf) => {
  if (!buf) return null;
  if (buf.length > MAX_ANZEIGE) return { text: null, gross: true };
  if (buf.includes(0)) return { text: null, binaer: true };
  const text = buf.toString("utf8");
  return Buffer.compare(Buffer.from(text, "utf8"), buf) === 0 ? { text } : { text: null, binaer: true };
};
const titelAus = (text, pfad) => {
  const m = /^#\s+(.+)$/m.exec(String(text ?? ""));
  return einzeiler((m && m[1]) || basename(pfad).replace(/\.[^.]+$/, ""), 120);
};

// ───────────────────────────── Lage lesen ─────────────────────────────
// Offene Zusammenführung (MERGE_HEAD): meine = HEAD, andere = MERGE_HEAD, die Dateien aus dem Index (Stufen 1/2/3).
// Oder ein Stand aus `basis` { meine, andere, dateien } (nach „Rückgängig“: beide Seiten sind schon zusammengeführt, die Entscheidungen werden neu getroffen).
function artVon(hat1, hat2, hat3) {
  if (hat2 && hat3) return "beide";
  if (hat1 && hat3) return "meine-geloescht";
  if (hat1 && hat2) return "andere-geloescht";
  if (hat3) return "nur-andere";
  if (hat2) return "nur-meine";
  return "beide-geloescht";
}
function indexKonflikte(vault) {
  const r = g(vault, ["ls-files", "-u", "-z"]);
  if (r.code !== 0) throw new KonfliktFehler(500, "Die Konflikte waren nicht lesbar.");
  const map = new Map();
  for (const eintrag of r.out.split("\0")) {
    const m = /^(\d{6}) [0-9a-f]+ ([123])\t([\s\S]+)$/.exec(eintrag);
    if (!m) continue;
    const e = map.get(m[3]) || { pfad: m[3], st: new Set(), modi: new Set() };
    e.st.add(Number(m[2])); if (m[2] !== "1") e.modi.add(m[1]);
    map.set(m[3], e);
  }
  return [...map.values()].sort((a, b) => (a.pfad < b.pfad ? -1 : 1)).map((e) => ({
    pfad: e.pfad, art: artVon(e.st.has(1), e.st.has(2), e.st.has(3)), eingebettet: e.modi.has("160000"), versteckt: versteckt(e.pfad),
  }));
}
export function sauberer(pfad) { // → relativer Vault-Pfad mit "/" oder wirft
  if (typeof pfad !== "string" || !pfad || pfad.includes("\0") || isAbsolute(pfad) || pfad.includes("\\")) throw new KonfliktFehler(400, "Ungültiger Pfad.");
  const teile = pfad.split("/");
  if (teile.some((t) => !t || t === "." || t === "..")) throw new KonfliktFehler(400, "Ungültiger Pfad.");
  return teile.join("/");
}
function lage(vault, basis) {
  const merge = mergeSha(vault);
  if (merge) {
    const kopf = kopfSha(vault);
    return { modus: "offen", meine: kopf, andere: merge, dateien: indexKonflikte(vault) };
  }
  if (!basis || typeof basis !== "object") return null;
  const kopf = kopfSha(vault);
  if (!kopf || !istCommit(vault, basis.meine) || !istCommit(vault, basis.andere) || !istVorfahr(vault, basis.meine, kopf) || !istVorfahr(vault, basis.andere, kopf)) return null;
  const mb = g(vault, ["merge-base", basis.meine, basis.andere]);
  const stamm = mb.code === 0 ? mb.out.trim() : null;
  const dateien = [];
  for (const p of Array.isArray(basis.dateien) ? basis.dateien.slice(0, 200) : []) {
    let pfad; try { pfad = sauberer(p); } catch { continue; }
    const art = artVon(hatInSha(vault, stamm, pfad), hatInSha(vault, basis.meine, pfad), hatInSha(vault, basis.andere, pfad));
    if (art !== "beide-geloescht") dateien.push({ pfad, art, eingebettet: false, versteckt: versteckt(pfad) });
  }
  return { modus: "stand", meine: basis.meine, andere: basis.andere, stamm, dateien };
}

function commitInfo(vault, sha, pfad, geloescht = false) {
  const args = ["log", "-1", "--format=%cI%x00%ce%x00%cn%x00%B", ...(geloescht ? ["--diff-filter=D"] : []), sha, ...(pfad ? ["--", pfad] : [])];
  const r = g(vault, args);
  if (r.code !== 0 || !r.out.trim()) return null;
  const [zeit, email, name, ...rest] = r.out.split("\0");
  return { zeit: zeit.trim(), email: (email || "").trim(), name: (name || "").trim(), nachricht: rest.join("\0") };
}
const seitenMeta = (vault, sha, pfad, vorhanden) => {
  const i = commitInfo(vault, sha, pfad, !vorhanden) || (vorhanden ? null : commitInfo(vault, sha, pfad));
  return { zeit: i ? i.zeit : null, geraet: i ? geraetAusCommit(i) : null };
};

function kartenWerte(text, pfad) {
  const a = text == null ? null : parseAufgabe(text, pfad);
  return a ? { spalte: a.status, faellig: a.faellig, titel: a.titel } : null;
}

// ───────────────────────────── Ansicht ─────────────────────────────
// → { aktiv: false } | { aktiv: true, modus, meine, andere, eigen, geraet, seit, dateien: [...], versteckt }
// dateien[i] = { pfad, titel, art, typ: "text"|"geloescht"|"board", wer?, meine: { vorhanden, text, gross?, binaer?, zeit, geraet }, andere: {...}, karte? }
export function ansicht(vault, { support = supportOrdner(), basis = null } = {}) {
  const l = lage(vault, basis);
  if (!l) return { aktiv: false, dateien: [] };
  const aufgabenOrdner = ordner(vault).aufgaben;
  const eigen = eigenerGeraetName({ support });
  const dateien = [];
  let verborgen = 0;
  const stammSha = l.modus === "offen" ? (g(vault, ["merge-base", l.meine, l.andere]).out.trim() || null) : l.stamm;
  for (const e of l.dateien) {
    if (e.versteckt || e.art === "beide-geloescht") { verborgen++; continue; }
    const vM = e.art === "beide" || e.art === "andere-geloescht" || e.art === "nur-meine";
    const vA = e.art === "beide" || e.art === "meine-geloescht" || e.art === "nur-andere";
    const bM = vM ? blobVon(vault, l.meine, e.pfad) : null, bA = vA ? blobVon(vault, l.andere, e.pfad) : null;
    const tM = textVon(bM), tA = textVon(bA);
    const seite = (vorhanden, t, sha) => ({ vorhanden, text: t ? t.text : null, ...(t && t.gross ? { gross: true } : {}), ...(t && t.binaer ? { binaer: true } : {}), ...seitenMeta(vault, sha, e.pfad, vorhanden) });
    const geloescht = e.art !== "beide";
    const d = { pfad: e.pfad, art: e.art, titel: titelAus(tM?.text ?? tA?.text, e.pfad), meine: seite(vM, tM, l.meine), andere: seite(vA, tA, l.andere) };
    d.typ = geloescht ? "geloescht" : "text";
    if (geloescht) {
      d.wer = vM ? "andere" : "meine"; // wer hat gelöscht (bzw. hat die Datei nicht)
      // Zeilen, die seit dem gemeinsamen Stand dazugekommen sind (die Oberfläche hebt sie hervor)
      const vorhanden = vM ? tM : tA, basisText = stammSha ? textVon(blobVon(vault, stammSha, e.pfad)) : null;
      if (vorhanden && vorhanden.text != null && basisText && basisText.text != null) {
        const alt = new Set(basisText.text.replace(/\r\n/g, "\n").split("\n"));
        d.neueZeilen = vorhanden.text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").filter((z) => z.trim() && !alt.has(z));
      }
    }
    const imAufgaben = e.pfad.toLowerCase().startsWith(`${aufgabenOrdner.toLowerCase()}/`) && /\.md$/i.test(e.pfad);
    if (!geloescht && imAufgaben) {
      const km = kartenWerte(tM?.text, e.pfad), ka = kartenWerte(tA?.text, e.pfad);
      if (km && ka) {
        d.typ = "board";
        const kb = stammSha ? kartenWerte(blobVon(vault, stammSha, e.pfad)?.toString("utf8"), e.pfad) : null;
        d.titel = km.titel || ka.titel || d.titel;
        d.karte = { meine: { spalte: km.spalte, faellig: km.faellig }, andere: { spalte: ka.spalte, faellig: ka.faellig }, vorher: kb ? kb.spalte : null };
      }
    }
    dateien.push(d);
  }
  const seit = stammSha ? (commitInfo(vault, stammSha) || {}).zeit || null : null;
  const aInfo = commitInfo(vault, l.andere);
  return { aktiv: true, modus: l.modus, meine: l.meine, andere: l.andere, eigen, geraet: aInfo ? geraetAusCommit(aInfo) : null, seit, dateien, versteckt: verborgen };
}

// ───────────────────────────── Schreiben ─────────────────────────────
function imVault(vault, rel) { // absoluter Pfad, nur innerhalb des Vaults, nie über einen Verweis
  const echt = realpathSync(vault);
  const abs = join(echt, ...rel.split("/"));
  let eltern = dirname(abs);
  while (!existsSync(eltern) && eltern !== echt && eltern.length > echt.length) eltern = dirname(eltern);
  let echtEltern; try { echtEltern = realpathSync(eltern); } catch { throw new KonfliktFehler(400, "Ungültiger Pfad."); }
  if (echtEltern !== echt && !echtEltern.startsWith(echt + sep)) throw new KonfliktFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
  try { if (lstatSync(abs).isSymbolicLink()) throw new KonfliktFehler(422, `„${rel}“ ist ein Verweis — den fasse ich nicht an.`); } catch (e) { if (e instanceof KonfliktFehler) throw e; }
  return abs;
}
function schreibeDatei(vault, rel, inhalt, { neu = false } = {}) {
  const abs = imVault(vault, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, inhalt, neu ? { flag: "wx" } : undefined);
  return abs;
}
function fuegeHinzu(vault, pfad) {
  const r = g(vault, ["add", "--", pfad]);
  if (r.code !== 0) throw new KonfliktFehler(500, `„${pfad}“ ließ sich nicht vormerken.`);
}
function entferne(vault, pfad) {
  const r = g(vault, ["rm", "-q", "-f", "--cached", "--ignore-unmatch", "--", pfad]);
  if (r.code !== 0) throw new KonfliktFehler(500, `„${pfad}“ ließ sich nicht entfernen.`);
  try { rmSync(imVault(vault, pfad), { force: true }); } catch (e) { if (e instanceof KonfliktFehler) throw e; }
}
function freierKopieName(vault, pfad, geraet) {
  const ord = dirname(pfad) === "." ? "" : dirname(pfad) + "/";
  const ext = extname(pfad), stamm = basename(pfad, ext).slice(0, 100);
  for (let i = 0; i < 100; i++) {
    const rel = `${ord}${stamm} (${geraet}${i ? " " + (i + 1) : ""})${ext}`;
    if (!existsSync(imVault(vault, rel)) && g(vault, ["ls-files", "--error-unmatch", "--", rel]).code !== 0) return rel;
  }
  throw new KonfliktFehler(409, `Für „${pfad}“ gibt es schon zu viele Kopien.`);
}
// Kopie der Arbeitsdateien vor dem Eingriff: <git-dir>/brain-sicherung/<Zeit>/ (30 Tage). Lässt sich eine vorhandene Datei nicht sichern: 409, nichts angefasst.
function sichereArbeitsstand(vault, pfade) {
  if (!pfade.length) return null;
  const gp = g(vault, ["rev-parse", "--path-format=absolute", "--git-path", "brain-sicherung"]);
  const wurzel = gp.code === 0 ? gp.out.trim() : join(vault, ".git", "brain-sicherung");
  try {
    for (const e of readdirSync(wurzel, { withFileTypes: true })) {
      if (e.isDirectory() && /^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(e.name)) { const p = join(wurzel, e.name); if (Date.now() - statSync(p).mtimeMs > 30 * 86_400_000) rmSync(p, { recursive: true, force: true }); }
    }
  } catch { /* nur Komfort */ }
  const basis = join(wurzel, new Date().toISOString().replace(/[:.]/g, "-"));
  const nicht = []; let n = 0;
  for (const p of pfade) {
    const quelle = join(vault, ...p.split("/")), ziel = join(basis, ...p.split("/"));
    let st; try { st = lstatSync(quelle); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    try {
      if (!st.isFile() || st.size > MAX_DATEI) throw new Error("nicht sicherbar");
      mkdirSync(dirname(ziel), { recursive: true }); copyFileSync(quelle, ziel); n++;
    } catch { nicht.push(p); }
  }
  if (nicht.length) throw new KonfliktFehler(409, `Von „${nicht[0]}“ ließ sich keine Sicherungskopie anlegen (zu groß oder nicht lesbar). Es wurde nichts verändert.`, { dateien: nicht });
  return n ? basis : null;
}

function mitSperre(vault, support, art, fn) {
  if (umstellungLaeuft(vault)) throw new KonfliktFehler(409, "Kortex räumt gerade deinen Vault auf (alter Werkzeug-Ordner). Warte einen Moment, dann geht das wieder.", { art: "umstellung" });
  const s = nimmSperre(sperrDateiFuer(vault, support), { art });
  if (!s.ok) throw new KonfliktFehler(409, "Gerade läuft ein anderer Abgleich. Bitte kurz warten und noch einmal versuchen.", { art: "laeuft" });
  try { return fn(); } finally { s.freigeben(); }
}

// ───────────────────────────── Entscheidungen ─────────────────────────────
const SEITE_TEXT = (geraet) => (geraet ? `vom Gerät „${geraet}“` : "vom anderen Gerät");
function entscheidungsText(d, wahl, geraet, kopie) {
  if (d.typ === "geloescht") {
    const behalten = (d.wer === "andere") === (wahl === "meine");
    return behalten ? "Notiz bleibt" : "Löschung übernommen";
  }
  if (d.typ === "board") return wahl === "meine" ? "Karte bleibt, wie sie hier steht" : `Karte so, wie sie ${SEITE_TEXT(geraet)} steht`;
  return { meine: "Dieser Mac behalten", andere: `Fassung ${SEITE_TEXT(geraet)} übernommen`, beide: `beide behalten, Kopie „${kopie ? basename(kopie).replace(/\.[^.]+$/, "") : ""}“`, text: "selbst zusammengeführt" }[wahl];
}
function pruefeAuswahl(auswahl, sichtbar, ansichtDateien) {
  if (!Array.isArray(auswahl)) throw new KonfliktFehler(400, "Bitte für jede Datei eine Entscheidung treffen.");
  const wahlen = new Map();
  for (const x of auswahl) {
    if (!x || typeof x.pfad !== "string" || !WAHLEN.includes(x.wahl)) throw new KonfliktFehler(400, "Ungültige Auswahl.");
    const d = ansichtDateien.get(x.pfad);
    if (!sichtbar.has(x.pfad) || !d) throw new KonfliktFehler(400, `„${x.pfad}“ hat keinen offenen Konflikt.`);
    if (d.typ === "board" && (x.wahl === "beide" || x.wahl === "text")) throw new KonfliktFehler(400, "Eine Aufgaben-Karte kann nur auf einer der beiden Seiten stehen.");
    if (d.typ === "geloescht" && x.wahl === "text") throw new KonfliktFehler(400, "Hier geht nur: Notiz behalten oder Löschung übernehmen.");
    if (x.wahl === "text") {
      if (typeof x.text !== "string" || Buffer.byteLength(x.text) > MAX_DATEI) throw new KonfliktFehler(400, "Der zusammengeführte Text fehlt oder ist zu lang.");
      if (d.meine.binaer || d.andere.binaer || d.meine.gross || d.andere.gross) throw new KonfliktFehler(422, `„${x.pfad}“ ist zu groß oder kein Text — bitte eine der beiden Fassungen wählen.`);
    }
    if (x.wahl === "beide" && (d.meine.gross || d.andere.gross)) throw new KonfliktFehler(413, `„${x.pfad}“ ist zu groß für „beide behalten“. Bitte wähle eine der beiden Fassungen.`);
    wahlen.set(x.pfad, x);
  }
  const fehlt = [...sichtbar].filter((p) => !wahlen.has(p));
  if (fehlt.length) throw new KonfliktFehler(400, `Bitte für jede Datei eine Entscheidung treffen (es fehlt: ${fehlt.slice(0, 3).join(", ")}).`, { dateien: fehlt });
  return wahlen;
}
function commitEintrag(vault, nachricht, pfade) {
  const basis = [...OHNE_HOOKS, ...identFlags(vault), "commit", "-q", "--allow-empty", "-m", nachricht];
  const r = g(vault, [...basis, "--", ...pfade], OHNE_ZEIT);
  if (r.code !== 0) throw new KonfliktFehler(422, "Die Entscheidung ließ sich nicht festhalten.", { ausgabe: r.err.slice(0, 500) });
  return kopfSha(vault);
}

// Schließt den Konflikt ab. auswahl: [{ pfad, wahl, text? }] für jede sichtbare Datei; basis nur nach „Rückgängig“.
// → { ok: true, merge, eintraege: [{ pfad, wahl, commit, kopie? }], kopien, versteckteBehalten, abgleich: { art, ok, text } }
export function loesen(vault, { auswahl, basis = null, support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    const l = lage(vault, basis);
    if (!l) throw new KonfliktFehler(409, "Es gibt keinen offenen Konflikt.");
    const a = ansicht(vault, { support, basis });
    const ad = new Map(a.dateien.map((d) => [d.pfad, d]));
    const wahlen = pruefeAuswahl(auswahl, new Set(ad.keys()), ad);
    const eigen = a.eigen;
    const andereGeraet = a.geraet;
    const verborgen = l.dateien.filter((e) => e.versteckt && e.art !== "beide-geloescht").map((e) => e.pfad);
    for (const e of l.dateien) if (e.eingebettet) throw new KonfliktFehler(422, `„${e.pfad}“ ist ein eingebettetes Repository — das kann Kortex nicht zusammenführen.`);
    const sicherung = sichereArbeitsstand(vault, l.dateien.filter((e) => e.art !== "beide-geloescht").map((e) => e.pfad));
    let merge = null;
    if (l.modus === "offen") {
      // 1. Zusammenführung: überall „meine“ festhalten (versteckte Orte bleiben ohnehin bei meiner Fassung, beidseitig Gelöschtes bleibt gelöscht)
      for (const e of l.dateien) {
        if (e.art === "beide-geloescht") { entferne(vault, e.pfad); continue; }
        const hatMeine = e.art === "beide" || e.art === "andere-geloescht" || e.art === "nur-meine";
        if (hatMeine) {
          const r = g(vault, ["checkout", "--ours", "--", e.pfad]);
          if (r.code !== 0) throw new KonfliktFehler(500, `„${e.pfad}“ ließ sich nicht übernehmen.`);
          fuegeHinzu(vault, e.pfad);
        } else entferne(vault, e.pfad);
      }
      if (g(vault, ["ls-files", "-u"]).out.trim()) throw new KonfliktFehler(409, "Es sind noch Dateien offen.");
      const kopf = `Abgleich mit dem anderen Gerät: ${wahlen.size} ${wahlen.size === 1 ? "Konflikt" : "Konflikte"} gelöst`;
      const r = g(vault, [...OHNE_HOOKS, ...identFlags(vault), "commit", "-q", "-m", `${kopf}\n\nKortex-Geraet: ${eigen}`], OHNE_ZEIT);
      if (r.code !== 0) throw new KonfliktFehler(422, "Das Zusammenführen konnte nicht abgeschlossen werden.", { ausgabe: r.err.slice(0, 500) });
      merge = kopfSha(vault);
    }
    const vorKopf = kopfSha(vault);
    // 2. Je Entscheidung ein eigener Eintrag im Verlauf
    const eintraege = [], kopien = [];
    for (const [pfad, x] of wahlen) {
      const d = ad.get(pfad);
      let kopie = null;
      const hatM = d.meine.vorhanden, hatA = d.andere.vorhanden;
      const setze = (seite) => { // Inhalt der gewählten Seite herstellen
        const sha = seite === "meine" ? l.meine : l.andere;
        if (seite === "meine" ? hatM : hatA) {
          const buf = blobVon(vault, sha, pfad);
          if (buf === null) throw new KonfliktFehler(500, `„${pfad}“ war nicht lesbar.`);
          if (buf.length > MAX_DATEI) throw new KonfliktFehler(413, `„${pfad}“ ist zu groß.`);
          const abs = imVault(vault, pfad);
          let gleich = false; try { gleich = Buffer.compare(readFileSync(abs), buf) === 0; } catch { /* fehlt */ }
          if (!gleich) schreibeDatei(vault, pfad, buf);
          fuegeHinzu(vault, pfad);
        } else entferne(vault, pfad);
      };
      if (x.wahl === "meine") setze("meine");
      else if (x.wahl === "andere") setze("andere");
      else if (x.wahl === "text") { schreibeDatei(vault, pfad, x.text); fuegeHinzu(vault, pfad); }
      else { // beide: meine bleibt, die andere Fassung liegt als Kopie daneben (fehlt eine Seite, bleibt die vorhandene)
        if (!hatM) setze("andere");
        else if (!hatA) setze("meine");
        else {
          setze("meine");
          kopie = freierKopieName(vault, pfad, dateiNamenTeil(andereGeraet) || "anderes Gerät");
          schreibeDatei(vault, kopie, blobVon(vault, l.andere, pfad), { neu: true });
          fuegeHinzu(vault, kopie);
          kopien.push({ pfad: kopie, von: pfad });
        }
      }
      const nachricht = `Konflikt gelöst: „${einzeiler(d.titel, 60)}“ – ${entscheidungsText(d, x.wahl, andereGeraet, kopie)}`;
      const commit = commitEintrag(vault, nachricht, kopie ? [pfad, kopie] : [pfad]);
      eintraege.push({ pfad, wahl: x.wahl, commit, ...(kopie ? { kopie } : {}) });
    }
    aendereMerker(vault, (m) => { m.abgleichLetzter = { zeit: new Date().toISOString(), meine: l.meine, andere: l.andere, vorKopf, merge, eintraege }; return m; }, { support });
    loescheAbgleichStand(vault, { support }); // der Konflikt ist gelöst; ein neuer wird beim Abgleich unten wieder vermerkt
    // 3. Abgleich wie die Sicherung: holen, senden — nur an das vom Nutzer bestätigte Ziel
    let abgleich;
    if (!pushErlaubnis(vault, support).ok) abgleich = { art: "nicht-bestaetigt", ok: false, text: PUSH_NICHT_BESTAETIGT };
    else { const r = abgleichen(vault, { support, sperre: false }); abgleich = { art: r.art, ok: r.ok, text: r.text, ...(r.dateien ? { dateien: r.dateien } : {}) }; }
    return { ok: true, merge, eintraege, kopien, versteckteBehalten: verborgen, sicherung, abgleich };
  });
}

// „Später“ / Abbrechen: die offene Zusammenführung zurücknehmen — der Arbeitsstand ist danach wie vorher, der Konflikt bleibt vermerkt.
export function abbrechen(vault, { support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    if (!mergeSha(vault)) return { ok: true, offen: false };
    const l = lage(vault, null);
    const namen = l.dateien.filter((e) => !e.versteckt && e.art !== "beide-geloescht").map((e) => e.pfad);
    const sicherung = sichereArbeitsstand(vault, l.dateien.filter((e) => e.art !== "beide-geloescht").map((e) => e.pfad));
    const r = g(vault, [...OHNE_HOOKS, "merge", "--abort"], OHNE_ZEIT);
    if (r.code !== 0 || mergeSha(vault)) {
      if (/not uptodate|would be overwritten|local changes/i.test(r.err)) throw new KonfliktFehler(409, "Eine zusammengeführte Datei wurde seit dem Abgleich noch einmal geändert. Zum Abbrechen müsste sie zurückgesetzt werden — dabei ginge deine Änderung verloren.", { art: "geaendert" });
      throw new KonfliktFehler(500, "Der Abgleich ließ sich nicht zurücknehmen.");
    }
    merkeStand(vault, "konflikt", support, { dateien: namen });
    return { ok: true, offen: true, sicherung };
  });
}

// „Rückgängig“ für den letzten Abgleich: Fassungen von vor den Entscheidungen kommen als NEUER Eintrag zurück (nie Reset). Geht nur, solange an diesen Dateien nicht
// weitergearbeitet wurde. Danach kann die Oberfläche mit basis { meine, andere, dateien } noch einmal entscheiden lassen.
export function rueckgaengig(vault, { support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    const m = leseMerkerDatei(vault, support).abgleichLetzter;
    if (!m || !Array.isArray(m.eintraege) || !istSha(m.vorKopf)) throw new KonfliktFehler(409, "Es gibt nichts zum Zurücknehmen.", { art: "nichts" });
    if (mergeSha(vault)) throw new KonfliktFehler(409, "Es wartet noch ein Abgleich mit Konflikten.");
    const kopf = kopfSha(vault);
    const letzter = m.eintraege.length ? m.eintraege[m.eintraege.length - 1].commit : m.vorKopf;
    if (!kopf || !istCommit(vault, letzter) || !istVorfahr(vault, letzter, kopf)) throw new KonfliktFehler(409, "Seitdem hat sich der Verlauf geändert — Zurücknehmen geht nicht mehr.", { art: "geaendert" });
    const aendern = m.eintraege.filter((e) => e.wahl !== "meine");
    const pfade = new Set();
    for (const e of aendern) { pfade.add(e.pfad); if (e.kopie) pfade.add(e.kopie); }
    for (const p of pfade) {
      const jetzt = blobId(vault, "HEAD", p), damals = blobId(vault, letzter, p);
      if (jetzt !== damals) throw new KonfliktFehler(409, `„${p}“ wurde seit dem Abgleich noch einmal geändert. Zurücknehmen würde diese Änderung überschreiben.`, { art: "geaendert", dateien: [p] });
    }
    if (pfade.size && g(vault, ["status", "--porcelain", "--", ...pfade]).out.trim()) throw new KonfliktFehler(409, "Diese Dateien haben nicht gesicherte Änderungen. Zurücknehmen würde sie überschreiben.", { art: "geaendert" });
    for (const e of aendern) {
      if (e.kopie) entferne(vault, e.kopie);
      const buf = blobVon(vault, m.vorKopf, e.pfad);
      if (buf === null) entferne(vault, e.pfad); else { schreibeDatei(vault, e.pfad, buf); fuegeHinzu(vault, e.pfad); }
    }
    const liste = [...pfade];
    let commit = null;
    if (liste.length) {
      const r = g(vault, [...OHNE_HOOKS, ...identFlags(vault), "commit", "-q", "--allow-empty", "-m", `Abgleich zurückgenommen: ${aendern.length} ${aendern.length === 1 ? "Entscheidung" : "Entscheidungen"} rückgängig gemacht`, "--", ...liste], OHNE_ZEIT);
      if (r.code !== 0) throw new KonfliktFehler(422, "Das Zurücknehmen ließ sich nicht festhalten.", { ausgabe: r.err.slice(0, 500) });
      commit = kopfSha(vault);
    }
    const dateien = m.eintraege.map((e) => e.pfad);
    aendereMerker(vault, (d) => { delete d.abgleichLetzter; return d; }, { support });
    merkeStand(vault, "konflikt", support, { dateien });
    return { ok: true, commit, dateien, basis: { meine: m.meine, andere: m.andere, dateien } };
  });
}

// Was „Rückgängig“ noch kann: { moeglich, anzahl } (nur lesend; das Studio blendet den Knopf damit ein)
export function rueckgaengigStand(vault, { support = supportOrdner() } = {}) {
  const m = leseMerkerDatei(vault, support).abgleichLetzter;
  return { moeglich: !!(m && Array.isArray(m.eintraege) && m.eintraege.length), anzahl: m && Array.isArray(m.eintraege) ? m.eintraege.length : 0 };
}
