// abgleich-konflikt.mjs — Konflikt beim Abgleich: beide Fassungen zeigen, entscheiden, abschließen, zurücknehmen. EINE Wahrheit für Studio und Kern.
//
// Datenfluss: Die Hintergrund-Sicherung (backup.mjs#abgleichen) merkt einen Konflikt im Support-Ordner (<Support>/backup/<Kennung>.json → abgleich) und
// nimmt ihre Zusammenführung zurück. Das Studio holt auf Wunsch noch einmal und lässt die Zusammenführung offen (gemeinsam/git.mjs#sync) und ruft danach
// `markieren`: Kortex merkt sich, DASS es diese Zusammenführung begonnen hat (HEAD, MERGE_HEAD, Fingerabdruck der Dateien). Nur dann lösen oder brechen
// ab diese Funktionen sie ab — eine Zusammenführung, die jemand anderes begonnen hat (Terminal), fassen sie nie an (409 „fremd“); wurde eine Konfliktdatei
// seit dem Markieren von Hand bearbeitet, wird nichts überschrieben (409 „bearbeitet“; „Später“ sichert die Bearbeitung vor dem Zurücknehmen).
// `ansicht` liest beide Fassungen jeder Datei, `loesen` nimmt die Entscheidungen entgegen, schließt die Zusammenführung ab und gleicht danach wie die
// Sicherung ab (backup.mjs#abgleichen: holen, senden, nur an das bestätigte Ziel), räumt den Konfliktstand; `rueckgaengig` nimmt die Entscheidungen zurück.
// Aufgerufen wird es vom Kern-Befehl `brain abgleich <markieren|ansicht|loesen|abbrechen|rueckgaengig>` (JSON auf stdout); die Werkstatt startet ihn als
// Kindprozess (gemeinsam/vault.mjs). Alle git-Aufrufe laufen über git-sicher (backup.mjs#gitLauf), die Zusammenführung immer ohne Hooks.
//
// Entscheidungen je Datei: meine · andere · beide (meine bleibt, die andere liegt als Kopie „<Name> (<Gerät>)“ daneben) · text (zusammengeführter Text).
// Eine Aufgaben-Karte kennt nur meine/andere. Auf beiden Geräten umbenannt („umbenannt“): meine = mein Name, andere = der andere Name, beide = beide Namen.
// Verlauf: Die Zusammenführung selbst hält zuerst überall „meine“ fest; JEDE Entscheidung ist danach ein eigener Eintrag („Konflikt gelöst: …“) — ohne
// Pfadangabe geschrieben (der Eintrag enthält genau das, was diese Entscheidung vormerkt). „Rückgängig“ (letzter Abgleich) legt die Fassungen von vor den
// Entscheidungen als neuen Eintrag wieder hin und merkt den Stand in der Merker-Datei (`konfliktBasis`): die Sicherung sendet nichts, solange er offen ist,
// und nur dieser gemerkte Stand — nie einer aus der Oberfläche — darf neu entschieden werden. Nie Rebase, nie Reset, nie Force.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, realpathSync, readdirSync, statSync, openSync, closeSync, renameSync } from "node:fs";
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
const blobId = (vault, sha, pfad) => { if (!sha) return null; const r = g(vault, ["rev-parse", "-q", "--verify", `${sha}:${pfad}`]); return r.code === 0 ? r.out.trim() : null; };
const identFlags = (vault) => (g(vault, ["config", "user.email"]).code === 0 && g(vault, ["config", "user.name"]).code === 0 ? [] : ["-c", "user.email=brain@localhost", "-c", "user.name=Kortex"]);
const versteckt = (pfad) => pfad.split("/").some((t) => t.startsWith(".") || t.toLowerCase() === "node_modules");
// Fingerabdruck der Arbeitsdatei (null: fehlt oder keine reguläre Datei)
function arbeitId(vault, pfad) {
  try { if (!lstatSync(join(vault, ...pfad.split("/"))).isFile()) return null; } catch { return null; }
  const r = g(vault, ["hash-object", "--no-filters", "--", pfad]);
  return r.code === 0 ? r.out.trim() : null;
}
function indexId(vault, pfad) { // Blob im Index (Stufe 0, sonst Stufe 2 = meine)
  const r = g(vault, ["ls-files", "-s", "-z", "--", pfad]);
  if (r.code !== 0) return null;
  let zwei = null;
  for (const z of r.out.split("\0")) { const m = /^\d{6} ([0-9a-f]+) ([0-3])\t/.exec(z); if (!m) continue; if (m[2] === "0") return m[1]; if (m[2] === "2") zwei = m[1]; }
  return zwei;
}

// ───────────────────────────── Namen, Texte ─────────────────────────────
// Steuerzeichen, Zeilenumbrüche und unsichtbare Umlenker (Bidi, Breite null) fliegen aus Namen: sie täuschten im Dateinamen oder Verlauf etwas anderes vor
const UNSICHTBAR = /[​-‏‪-‮⁠-⁤⁦-⁩﻿؜᠎]/g;
const einzeiler = (s, max = 80) => String(s ?? "").replace(/[\x00-\x1f\x7f\u0080-\u009f]/g, " ").replace(UNSICHTBAR, "").replace(/\s+/g, " ").trim().slice(0, max);
const dateiNamenTeil = (s) => einzeiler(s, 40).replace(/[\\/:*?"<>|]/g, "").replace(/^\.+/, "").trim();
const bytes = (s) => Buffer.byteLength(s, "utf8");

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
// Oder der gemerkte Stand `konfliktBasis` (nach „Rückgängig“ oder einem Abbruch mitten im Festhalten): beide Seiten sind schon zusammengeführt,
// die Entscheidungen werden neu getroffen. Dieser Stand kommt NUR aus der Merker-Datei, nie von außen.
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
const merkerBasis = (vault, support) => { const b = leseMerkerDatei(vault, support).konfliktBasis; return b && typeof b === "object" ? b : null; };
function lage(vault, support) {
  const merge = mergeSha(vault);
  if (merge) {
    const kopf = kopfSha(vault);
    return { modus: "offen", meine: kopf, andere: merge, dateien: indexKonflikte(vault) };
  }
  const basis = merkerBasis(vault, support);
  if (!basis) return null;
  const kopf = kopfSha(vault);
  // Passt der gemerkte Stand nicht mehr zum Vault (zum Beispiel nach einem Zurücksetzen), wird er NIE still geräumt: die Oberfläche zeigt ihn mit Hinweis und „Verwerfen“
  if (!kopf || !istCommit(vault, basis.meine) || !istCommit(vault, basis.andere) || !istVorfahr(vault, basis.meine, kopf) || !istVorfahr(vault, basis.andere, kopf)) return { modus: "stand", ungueltig: true, meine: null, andere: null, stamm: null, dateien: [], veraltet: [] };
  const mb = g(vault, ["merge-base", basis.meine, basis.andere]);
  const stamm = mb.code === 0 ? mb.out.trim() : null;
  const dateien = [], veraltet = [];
  const blobs = basis.kopfBlobs && typeof basis.kopfBlobs === "object" ? basis.kopfBlobs : {};
  for (const p of Array.isArray(basis.dateien) ? basis.dateien.slice(0, 400) : []) {
    let pfad; try { pfad = sauberer(p); } catch { continue; }
    // seitdem weitergearbeitet? Dann gehört diese Datei nicht mehr zum Konflikt (die neuere Arbeit gewinnt) — die Oberfläche sagt es (weitergearbeitet), die andere Fassung steht im Verlauf
    if (Object.hasOwn(blobs, pfad) && blobId(vault, "HEAD", pfad) !== blobs[pfad]) { veraltet.push(pfad); continue; }
    const art = artVon(hatInSha(vault, stamm, pfad), hatInSha(vault, basis.meine, pfad), hatInSha(vault, basis.andere, pfad));
    if (art !== "beide-geloescht") dateien.push({ pfad, art, eingebettet: false, versteckt: versteckt(pfad) });
  }
  return { modus: "stand", meine: basis.meine, andere: basis.andere, stamm, dateien, veraltet };
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

// Umbenennungen zwischen dem gemeinsamen Stand und einer Seite: alter Pfad → neuer Pfad
function umbenennungen(vault, stamm, sha) {
  const m = new Map();
  if (!stamm || !sha) return m;
  const r = g(vault, ["diff-tree", "-r", "-M", "--name-status", "-z", stamm, sha]);
  if (r.code !== 0) return m;
  const t = r.out.split("\0");
  for (let i = 0; i < t.length; i++) { if (/^R\d*$/.test(t[i])) { m.set(t[i + 1], t[i + 2]); i += 2; } else if (/^[A-Z]\d*$/.test(t[i])) i += /^[CR]/.test(t[i]) ? 2 : 1; }
  return m;
}
// Paare „auf beiden Seiten umbenannt“ unter den Konfliktdateien: meine Datei M und die des anderen A gehen aus DEMSELBEN Pfad hervor
function findePaare(vault, l, stamm) {
  const nurM = new Set(l.dateien.filter((e) => e.art === "nur-meine").map((e) => e.pfad)), nurA = new Set(l.dateien.filter((e) => e.art === "nur-andere").map((e) => e.pfad));
  const paare = new Map(); // M → { a, basis }
  if (!nurM.size || !nurA.size) return paare;
  const rm = umbenennungen(vault, stamm, l.meine), ra = umbenennungen(vault, stamm, l.andere);
  for (const [alt, m] of rm) { const a = ra.get(alt); if (a && a !== m && nurM.has(m) && nurA.has(a)) paare.set(m, { a, basis: alt }); }
  return paare;
}

// ───────────────────────────── Ansicht ─────────────────────────────
// → { aktiv: false } | { aktiv: true, modus, meine, andere, eigen, geraet, seit, dateien: [...], versteckt, fremd?, haelt?, weitergearbeitet?, ungueltig? }
// dateien[i] = { pfad, titel, art, typ: "text"|"geloescht"|"board"|"umbenannt", wer?, meine: { vorhanden, text, blob, zeit, geraet }, andere: {...}, karte?, neueZeilen?, pfadAndere? }
// fremd: die offene Zusammenführung hat Kortex nicht begonnen (nur ansehen, nie lösen). Rein lesend — bis auf das Aufräumen eines gemerkten Stands, der nichts mehr betrifft.
export function ansicht(vault, { support = supportOrdner() } = {}) {
  return baueAnsicht(vault, support).ansicht;
}
function baueAnsicht(vault, support) {
  const l = lage(vault, support);
  if (!l) return { ansicht: { aktiv: false, dateien: [] }, l: null, paare: new Map() };
  const aufgabenOrdner = ordner(vault).aufgaben;
  const eigen = eigenerGeraetName({ support });
  if (l.ungueltig) return { ansicht: { aktiv: true, modus: "stand", haelt: true, ungueltig: true, meine: null, andere: null, eigen, geraet: null, seit: null, dateien: [], versteckt: 0 }, l, paare: new Map() };
  const stammSha = l.modus === "offen" ? (g(vault, ["merge-base", l.meine, l.andere]).out.trim() || null) : l.stamm;
  const paare = findePaare(vault, l, stammSha);
  const alsA = new Set([...paare.values()].map((p) => p.a));
  const dateien = [];
  let verborgen = 0;
  for (const e of l.dateien) {
    if (e.versteckt) { verborgen++; continue; }
    if (e.art === "beide-geloescht" || alsA.has(e.pfad)) continue;
    const paar = paare.get(e.pfad);
    const vM = e.art === "beide" || e.art === "andere-geloescht" || e.art === "nur-meine";
    const vA = paar ? true : e.art === "beide" || e.art === "meine-geloescht" || e.art === "nur-andere";
    const pfadA = paar ? paar.a : e.pfad;
    const bM = vM ? blobVon(vault, l.meine, e.pfad) : null, bA = vA ? blobVon(vault, l.andere, pfadA) : null;
    const tM = textVon(bM), tA = textVon(bA);
    const seite = (vorhanden, t, sha, p) => ({ vorhanden, text: t ? t.text : null, blob: vorhanden ? blobId(vault, sha, p) : null, ...(t && t.gross ? { gross: true } : {}), ...(t && t.binaer ? { binaer: true } : {}), ...seitenMeta(vault, sha, p, vorhanden) });
    const geloescht = !paar && e.art !== "beide";
    const d = { pfad: e.pfad, art: paar ? "umbenannt" : e.art, titel: titelAus(tM?.text ?? tA?.text, e.pfad), meine: seite(vM, tM, l.meine, e.pfad), andere: seite(vA, tA, l.andere, pfadA) };
    d.typ = paar ? "umbenannt" : geloescht ? "geloescht" : "text";
    if (paar) { d.pfadAndere = paar.a; d.basisPfad = paar.basis; }
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
    if (!geloescht && !paar && imAufgaben) {
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
  if (l.modus === "stand" && !dateien.length && !(l.veraltet || []).length) { // der gemerkte Stand nennt keine einzige Datei mehr: nichts zu entscheiden
    aendereMerker(vault, (m) => { delete m.konfliktBasis; return m; }, { support });
    loescheAbgleichStand(vault, { support });
    return { ansicht: { aktiv: false, dateien: [] }, l: null, paare };
  }
  const seit = stammSha ? (commitInfo(vault, stammSha) || {}).zeit || null : null;
  const aInfo = commitInfo(vault, l.andere);
  const ans = { aktiv: true, modus: l.modus, meine: l.meine, andere: l.andere, eigen, geraet: aInfo ? geraetAusCommit(aInfo) : null, seit, dateien, versteckt: verborgen };
  if (l.modus === "offen") {
    const m = leseMerkerDatei(vault, support).konfliktOffen;
    ans.fremd = !(m && m.kopf === l.meine && m.merge === l.andere);
  }
  else ans.haelt = true;
  if (l.veraltet && l.veraltet.length) ans.weitergearbeitet = l.veraltet.map((p) => ({ pfad: p, titel: titelAus(null, p) }));
  return { ansicht: ans, l, paare };
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
// Große Datei: als Strom aus dem Objekt in die Datei (zuerst eine Nebendatei, dann umbenennen — nie eine halbe Datei am Ziel)
function schreibeStrom(vault, rel, blob, { neu = false } = {}) {
  const abs = imVault(vault, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (neu && existsSync(abs)) throw new KonfliktFehler(409, `„${rel}“ gibt es schon.`);
  const tmp = `${abs}.kortex-${process.pid}.tmp`;
  const fd = openSync(tmp, "w");
  let code = 1;
  try {
    const rr = spawnSync(gitBefehl({}), ["-C", vault, "cat-file", "blob", `${blob.sha}:${blob.pfad}`], { stdio: ["ignore", fd, "pipe"], windowsHide: true, timeout: 120_000 });
    code = rr.error ? 1 : (rr.status ?? 1);
  } finally { closeSync(fd); }
  if (code !== 0) { rmSync(tmp, { force: true }); throw new KonfliktFehler(500, `„${blob.pfad}“ war nicht lesbar.`); }
  renameSync(tmp, abs);
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
// Name der Kopie „<Name> (<Gerät>).<Endung>“, höchstens 255 Bytes (UTF-8) lang; `belegt` = schon für andere Kopien vergebene Namen
function freierKopieName(vault, pfad, geraet, belegt = new Set()) {
  const ord = dirname(pfad) === "." ? "" : dirname(pfad) + "/";
  const ext = extname(pfad);
  const baue = (stamm, i) => `${stamm} (${geraet}${i ? " " + (i + 1) : ""})${ext}`;
  for (let i = 0; i < 100; i++) {
    let stamm = [...basename(pfad, ext)].slice(0, 100).join("");
    while (stamm.length > 1 && bytes(baue(stamm, i)) > 255) stamm = [...stamm].slice(0, -1).join("");
    const name = baue(stamm, i);
    if (bytes(name) > 255) throw new KonfliktFehler(422, `Für „${pfad}“ lässt sich kein Name für die Kopie bilden (zu lang).`);
    const rel = ord + name;
    if (!belegt.has(rel) && !existsSync(imVault(vault, rel)) && g(vault, ["ls-files", "--error-unmatch", "--", rel]).code !== 0) return rel;
  }
  throw new KonfliktFehler(409, `Für „${pfad}“ gibt es schon zu viele Kopien.`);
}

// Sicherheitsnetz vor jedem Eingriff in eine offene Zusammenführung (Lösen, Später): gesichert wird ALLES in Arbeitsbaum UND Index, was vom reinen Ergebnis der Zusammenführung
// abweicht — nicht nur, was von einem Merker abweicht. Reines Ergebnis: Konfliktdateien = Git-Konfliktmarken (Fingerabdruck beim Markieren, sonst neu berechnet aus den Stufen 1/2/3
// mit `merge-file`; bei gelöscht/geändert eine der Stufen); die übrigen Pfade = HEAD, MERGE_HEAD oder (beidseitig geändert) das berechnete Dreiwege-Ergebnis. Im Zweifel wird gesichert.
// Gesichert wird je Pfad, was in der Arbeitsdatei steht, und — getrennt (`_vorgemerkt/`) — was vorgemerkt ist. Ablage: <git-dir>/brain-sicherung/<Zeit>/ (30 Tage). Große Dateien (über
// MAX_DATEI) kommen als Objekt in die Versionsverwaltung (hash-object -w) und stehen mit ihrer Kennung in _blobs.txt.
// → { ordner, dateien: [Pfad], vorgemerkt: [Pfad], blobs: [{ pfad, id }] } oder null (nichts zu sichern). Scheitert eine Sicherung ganz: 409, nichts angefasst.
function gMergeDatei(vault, args) {
  const r = spawnSync(gitBefehl({}), ["-C", vault, "merge-file", ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: ZEIT_LOKAL, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error ? 99 : (r.status ?? 99), out: r.stdout || Buffer.alloc(0) };
}
const stufenIds = (vault, pfad) => {
  const o = {};
  const r = g(vault, ["ls-files", "-s", "-z", "--", pfad]);
  if (r.code === 0) for (const z of r.out.split("\0")) { const m = /^\d{6} ([0-9a-f]+) ([0-3])\t/.exec(z); if (m) o[m[2]] = m[1]; }
  return o;
};
function schreibeTmp(vault, tmp, name, sha, spec) { // Blob (oder leer) in eine Hilfsdatei im Git-Ordner des Vaults
  mkdirSync(tmp, { recursive: true });
  const f = join(tmp, name);
  const b = spec ? gBytes(vault, ["cat-file", "blob", spec]) : { code: 0, out: Buffer.alloc(0) };
  writeFileSync(f, b.code === 0 ? b.out : Buffer.alloc(0));
  return f;
}
function hashDatei(vault, f) { const r = g(vault, ["hash-object", "--no-filters", "--", f]); return r.code === 0 ? r.out.trim() : null; }
// Pfad → Kennung für eine ganze Version in EINEM Aufruf (`ls-tree -r -t`: Blobs, Untermodul-Commits und — wie `rev-parse <sha>:<pfad>` — auch die Kennung der Verzeichnisse).
// Ohne Version: leere Karte; scheitert der Aufruf, wird nachgefragt wie früher (je Pfad).
function baumKarte(vault, sha) {
  if (!sha) return { sha: null, karte: new Map() };
  const r = gBytes(vault, ["ls-tree", "-r", "-t", "-z", sha]);
  if (r.code !== 0) return { sha, karte: null };
  const karte = new Map();
  for (const z of r.out.toString("utf8").split("\0")) { const m = /^\d{6} \w+ ([0-9a-f]+)\t([\s\S]+)$/.exec(z); if (m) karte.set(m[2], m[1]); }
  return { sha, karte };
}
const idAus = (vault, k, pfad) => (!k.sha ? null : k.karte ? (k.karte.get(pfad) ?? null) : blobId(vault, k.sha, pfad));
// Kennungen der Arbeitsdateien in EINEM Aufruf (`hash-object --no-filters --stdin-paths`); Pfade, die die zeilenweise Eingabe nicht tragen, und ein gescheiterter Sammelaufruf: einzeln wie früher.
function arbeitIds(vault, pfade) {
  const aus = new Map();
  const sammel = pfade.filter((p) => !/[\n\r"\\]/.test(p));
  if (sammel.length) {
    const r = spawnSync(gitBefehl({}), ["-C", vault, "hash-object", "--no-filters", "--stdin-paths"], { input: sammel.join("\n") + "\n", stdio: ["pipe", "pipe", "pipe"], windowsHide: true, timeout: ZEIT_LOKAL * 4, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" });
    const zeilen = String(r.stdout || "").split("\n").filter(Boolean);
    if (!r.error && r.status === 0 && zeilen.length === sammel.length) sammel.forEach((p, i) => aus.set(p, zeilen[i]));
  }
  for (const p of pfade) if (!aus.has(p)) aus.set(p, arbeitId(vault, p));
  return aus;
}
// Der Index in EINEM Aufruf: Pfad → { Stufe: Kennung }; null, wenn der Aufruf scheitert (dann einzeln wie früher)
function indexKarte(vault) {
  const r = gBytes(vault, ["ls-files", "-s", "-z"]);
  if (r.code !== 0) return null;
  const karte = new Map();
  for (const z of r.out.toString("utf8").split("\0")) {
    const m = /^\d{6} ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(z); if (!m) continue;
    const e = karte.get(m[3]) || {}; e[m[2]] = m[1]; karte.set(m[3], e);
  }
  return karte;
}
// Was die Zusammenführung für einen Pfad ohne Konflikt ergibt: { id } (id null = fehlt) oder null (unbekannt → sichern).
// `merge-file` läuft nur dort, wo HEAD, MERGE_HEAD und Basis alle verschieden sind.
function erwartetId(vault, pfad, kopf, merge, stamm, tmp, karten) {
  const h = idAus(vault, karten.kopf, pfad), m = idAus(vault, karten.merge, pfad), b = idAus(vault, karten.stamm, pfad);
  if (h === m) return { id: h };
  if (h === b) return { id: m };
  if (m === b) return { id: h };
  if (!h || !m || !b) return null;
  const f1 = schreibeTmp(vault, tmp, "a", h, `${kopf}:${pfad}`), f2 = schreibeTmp(vault, tmp, "b", b, `${stamm}:${pfad}`), f3 = schreibeTmp(vault, tmp, "c", m, `${merge}:${pfad}`);
  const r = gMergeDatei(vault, ["-p", f1, f2, f3]);
  if (r.code !== 0) return null;
  const f4 = join(tmp, "d"); writeFileSync(f4, r.out);
  const id = hashDatei(vault, f4);
  return id ? { id } : null;
}
// Ist die Konfliktdatei genau das, was Git hineingeschrieben hat? (Fingerabdruck beim Markieren, eine der Stufen, oder die Marken aus den Stufen neu berechnet)
function konfliktUnberuehrt(vault, pfad, jetzt, hashes, tmp) {
  if (Object.hasOwn(hashes, pfad) && jetzt === hashes[pfad]) return true;
  const st = stufenIds(vault, pfad);
  if (jetzt && (jetzt === st[2] || jetzt === st[3])) return true;
  let text; try { text = readFileSync(join(vault, ...pfad.split("/")), "utf8"); } catch { return false; }
  const l1 = /^<{7} (.*)$/m.exec(text), l3 = /^>{7} (.*)$/m.exec(text), l2 = /^\|{7} ?(.*)$/m.exec(text);
  if (!l1 || !l3 || !st[2] || !st[3]) return false;
  const f1 = schreibeTmp(vault, tmp, "m1", st[2], `:2:${pfad}`), f2 = schreibeTmp(vault, tmp, "m2", st[1] || null, st[1] ? `:1:${pfad}` : null), f3 = schreibeTmp(vault, tmp, "m3", st[3], `:3:${pfad}`);
  const r = gMergeDatei(vault, ["-p", "-L", l1[1], "-L", l2 ? l2[1] : "base", "-L", l3[1], ...(l2 ? ["--diff3"] : []), f1, f2, f3]);
  return r.code > 0 && r.code < 127 && Buffer.compare(r.out, readFileSync(join(vault, ...pfad.split("/")))) === 0;
}
// Was gesichert werden muss, ohne etwas zu schreiben: { arbeit: [{ p, groesse }], vorgemerkt: [{ p, id }] } (Reihenfolge: erst die Konfliktdateien, dann die übrigen in Git-Reihenfolge).
// Wenige Aufrufe unabhängig von der Dateizahl: je einmal `ls-tree -r -t` für HEAD, MERGE_HEAD und die Basis, `ls-files -s` für den Index, ein `hash-object --stdin-paths` für die
// Arbeitsdateien; `merge-file` nur dort, wo HEAD, MERGE_HEAD und Basis alle verschieden sind. Das Ergebnis ist je Pfad dasselbe wie die frühere Einzelabfrage — mit EINER Ausnahme:
// Unbeteiligtes (Index = HEAD = MERGE_HEAD, nur im Arbeitsbaum geändert: eine ungesicherte Notiz, die die Zusammenführung nicht betrifft) fasst weder `merge --abort` noch das
// Lösen an; es wird nicht bei jedem Später/Lösen erneut kopiert.
export function ermittleSicherung(vault, konfliktPfade, marke, tmp) {
  const merge = mergeSha(vault), kopf = kopfSha(vault);
  const stamm = merge && kopf ? (g(vault, ["merge-base", kopf, merge]).out.trim() || null) : null;
  const konflikt = new Set(konfliktPfade), namen = new Set(konfliktPfade);
  for (const args of [["diff", "--name-only", "--no-renames", "-z", "HEAD"], ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"]]) {
    const d = gBytes(vault, args);
    if (d.code === 0) for (const p of d.out.toString("utf8").split("\0")) if (p) namen.add(p);
  }
  const hashes = marke && marke.hashes && typeof marke.hashes === "object" ? marke.hashes : {};
  const karten = { kopf: baumKarte(vault, kopf), merge: baumKarte(vault, merge), stamm: baumKarte(vault, stamm) };
  const index = indexKarte(vault);
  const idxVon = (p) => { if (!index) return indexId(vault, p); const e = index.get(p); return e ? (e["0"] ?? e["2"] ?? null) : null; };
  const arbeit = [], vorgemerkt = [], mitDatei = [];
  for (const p of namen) {
    const k = konflikt.has(p);
    const idx = k ? null : idxVon(p);
    if (!k && idx && idx === idAus(vault, karten.kopf, p) && idx === idAus(vault, karten.merge, p)) continue; // unbeteiligt (s. o.)
    if (!k && idx) { const erw = erwartetId(vault, p, kopf, merge, stamm, tmp, karten); if (!erw || erw.id !== idx) vorgemerkt.push({ p, id: idx }); }
    let st = null; try { st = lstatSync(join(vault, ...p.split("/"))); } catch { /* fehlt */ }
    if (!st || st.isSymbolicLink() || !st.isFile()) continue;
    mitDatei.push({ p, k, idx, groesse: st.size });
  }
  const jetzt = arbeitIds(vault, mitDatei.map((c) => c.p)); // alle Arbeitsdateien in einem Zug
  for (const c of mitDatei) {
    const j = jetzt.get(c.p) ?? null;
    const unberuehrt = c.k ? konfliktUnberuehrt(vault, c.p, j, hashes, tmp) : !!(j && c.idx && j === c.idx);
    if (!unberuehrt) arbeit.push({ p: c.p, groesse: c.groesse });
  }
  return { arbeit, vorgemerkt };
}
function sichereArbeitsstand(vault, konfliktPfade, marke) {
  const gp = g(vault, ["rev-parse", "--path-format=absolute", "--git-path", "brain-sicherung"]);
  const wurzel = gp.code === 0 ? gp.out.trim() : join(vault, ".git", "brain-sicherung");
  const tmp = join(dirname(wurzel), `brain-sicherung-tmp-${process.pid}`);
  let arbeit, vorgemerkt;
  try { ({ arbeit, vorgemerkt } = ermittleSicherung(vault, konfliktPfade, marke, tmp)); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* nur Komfort */ } }
  if (!arbeit.length && !vorgemerkt.length) return null;
  try {
    for (const e of readdirSync(wurzel, { withFileTypes: true })) {
      if (e.isDirectory() && /^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(e.name)) { const q = join(wurzel, e.name); if (Date.now() - statSync(q).mtimeMs > 30 * 86_400_000) rmSync(q, { recursive: true, force: true }); }
    }
  } catch { /* nur Komfort */ }
  const ordnerPfad = join(wurzel, new Date().toISOString().replace(/[:.]/g, "-"));
  const dateien = [], blobs = [], nicht = [], vorg = [];
  for (const { p, groesse } of arbeit) {
    try {
      if (groesse > MAX_DATEI) throw new Error("gross");
      const ziel = join(ordnerPfad, ...p.split("/"));
      mkdirSync(dirname(ziel), { recursive: true }); copyFileSync(join(vault, ...p.split("/")), ziel); dateien.push(p);
    } catch {
      const r = g(vault, ["hash-object", "-w", "--no-filters", "--", p]);
      if (r.code === 0 && r.out.trim()) blobs.push({ pfad: p, id: r.out.trim() }); else nicht.push(p);
    }
  }
  for (const { p, id } of vorgemerkt) { // das Vorgemerkte steht schon als Objekt im Git-Ordner: nur die Kennung merken, kleine Dateien zusätzlich als Datei
    const groesse = Number((g(vault, ["cat-file", "-s", id]).out || "0").trim());
    if (groesse <= MAX_DATEI) { const b = gBytes(vault, ["cat-file", "blob", id]); if (b.code === 0) { const ziel = join(ordnerPfad, "_vorgemerkt", ...p.split("/")); mkdirSync(dirname(ziel), { recursive: true }); writeFileSync(ziel, b.out); vorg.push(p); continue; } }
    blobs.push({ pfad: `${p} (vorgemerkt)`, id }); vorg.push(p);
  }
  if (nicht.length) throw new KonfliktFehler(409, `Von „${nicht[0]}“ ließ sich keine Sicherungskopie anlegen. Es wurde nichts verändert.`, { dateien: nicht });
  if (blobs.length) { mkdirSync(ordnerPfad, { recursive: true }); writeFileSync(join(ordnerPfad, "_blobs.txt"), blobs.map((b) => `${b.id}  ${b.pfad}`).join("\n") + "\n"); }
  return { ordner: ordnerPfad, dateien, vorgemerkt: vorg, blobs };
}

// Vorgemerktes, das nicht zur Zusammenführung gehört (Pfade außerhalb dessen, was MERGE_HEAD ändert, und der Konfliktdateien): der Zusammenführungs-Eintrag würde es mitnehmen
function fremdVorgemerkt(vault, l, konfliktPfade) {
  const erlaubt = new Set(konfliktPfade);
  const d = g(vault, ["diff", "--name-only", "--no-renames", "-z", "HEAD", l.andere]);
  if (d.code === 0) for (const q of d.out.split("\0")) if (q) erlaubt.add(q);
  const c = g(vault, ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"]);
  return c.code === 0 ? c.out.split("\0").filter((q) => q && !erlaubt.has(q)) : [];
}

function mitSperre(vault, support, art, fn) {
  if (umstellungLaeuft(vault)) throw new KonfliktFehler(409, "Kortex räumt gerade deinen Vault auf (alter Werkzeug-Ordner). Warte einen Moment, dann geht das wieder.", { art: "umstellung" });
  const s = nimmSperre(sperrDateiFuer(vault, support), { art });
  if (!s.ok) throw new KonfliktFehler(409, "Gerade läuft ein anderer Abgleich. Bitte kurz warten und noch einmal versuchen.", { art: "laeuft" });
  try { return fn(); } finally { s.freigeben(); }
}

// ───────────────────────────── Markieren ─────────────────────────────
// Stand des Servers zum aktuellen Zweig: @{u}, sonst origin/<Zweig>; null, wenn keiner da ist
function zielSha(vault) {
  const u = g(vault, ["rev-parse", "-q", "--verify", "@{u}"]);
  if (u.code === 0 && u.out.trim()) return u.out.trim();
  const z = g(vault, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (z.code !== 0 || !z.out.trim()) return null;
  const o = g(vault, ["rev-parse", "-q", "--verify", `refs/remotes/origin/${z.out.trim()}`]);
  return o.code === 0 && o.out.trim() ? o.out.trim() : null;
}
// Das Studio hat die Zusammenführung begonnen (git.mjs#sync) und ruft das gleich danach: nur so ist sie „von Kortex“.
// Nur wenn der Aufrufer sagt, dass vorher KEINE Zusammenführung offen war (vorherAbwesend) UND sein Abgleich sie begonnen hat — sonst wird nie markiert (eine
// Zusammenführung aus dem Terminal gehört nicht Kortex).
export function markiere(vault, { support = supportOrdner(), vorherAbwesend = false } = {}) {
  const merge = mergeSha(vault);
  if (!merge) return { ok: true, offen: false };
  if (vorherAbwesend !== true) return { ok: true, offen: true, markiert: false };
  // Außerdem muss MERGE_HEAD genau der Stand des Servers sein, den der Abgleich holen wollte (@{u}, sonst origin/<Zweig>): eine Zusammenführung mit etwas anderem hat nicht der Abgleich begonnen
  const ziel = zielSha(vault);
  if (!ziel || ziel !== merge) return { ok: true, offen: true, markiert: false };
  const kopf = kopfSha(vault);
  const hashes = {};
  for (const e of indexKonflikte(vault)) { const h = arbeitId(vault, e.pfad); if (h) hashes[e.pfad] = h; }
  aendereMerker(vault, (m) => { m.konfliktOffen = { kopf, merge, hashes, zeit: new Date().toISOString() }; return m; }, { support });
  return { ok: true, offen: true, markiert: true };
}
// „Verwerfen“: der gemerkte Stand (`konfliktBasis`) fällt weg, damit die Sicherung wieder senden darf. Bereits festgehaltene Entscheidungen bleiben (Verlauf und Rückgängig-Marke
// unberührt); die Fassung des anderen Geräts steht weiter im Verlauf.
export function verwerfen(vault, { support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    const b = merkerBasis(vault, support);
    if (!b) throw new KonfliktFehler(409, "Es wartet kein gemerkter Stand.", { art: "nichts" });
    const dateien = Array.isArray(b.dateien) ? b.dateien.filter((p) => typeof p === "string").slice(0, 200) : [];
    aendereMerker(vault, (d) => { delete d.konfliktBasis; return d; }, { support });
    loescheAbgleichStand(vault, { support });
    return { ok: true, dateien };
  });
}

// Gehört die offene Zusammenführung Kortex? → die Marke oder 409 „fremd“
function pruefeMarke(vault, support, l) {
  const m = leseMerkerDatei(vault, support).konfliktOffen;
  if (!m || m.kopf !== l.meine || m.merge !== l.andere) throw new KonfliktFehler(409, "Diese Zusammenführung hat nicht Kortex begonnen (sondern zum Beispiel das Terminal). Schließe sie dort ab; Kortex fasst sie nicht an.", { art: "fremd" });
  return m;
}
// Seit dem Markieren von Hand bearbeitete Konfliktdateien
function bearbeitet(vault, marke, l) {
  const hashes = marke.hashes && typeof marke.hashes === "object" ? marke.hashes : {};
  return l.dateien.map((e) => e.pfad).filter((p) => Object.hasOwn(hashes, p) && arbeitId(vault, p) !== hashes[p]);
}

// ───────────────────────────── Entscheidungen ─────────────────────────────
const SEITE_TEXT = (geraet) => (geraet ? `vom Gerät „${geraet}“` : "vom anderen Gerät");
function entscheidungsText(d, wahl, geraet, kopie) {
  if (d.typ === "geloescht") {
    const behalten = (d.wer === "andere") === (wahl === "meine");
    return behalten ? "Notiz bleibt" : "Löschung übernommen";
  }
  if (d.typ === "board") return wahl === "meine" ? "Karte bleibt, wie sie hier steht" : `Karte so, wie sie ${SEITE_TEXT(geraet)} steht`;
  if (d.typ === "umbenannt") return { meine: "eigener Name bleibt", andere: `Name ${SEITE_TEXT(geraet)} übernommen`, beide: "beide Namen behalten", text: "selbst zusammengeführt" }[wahl];
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
    wahlen.set(x.pfad, x);
  }
  const fehlt = [...sichtbar].filter((p) => !wahlen.has(p));
  if (fehlt.length) throw new KonfliktFehler(400, `Bitte für jede Datei eine Entscheidung treffen (es fehlt: ${fehlt.slice(0, 3).join(", ")}).`, { dateien: fehlt });
  return wahlen;
}
// Ein Eintrag im Verlauf OHNE Pfadangabe: er enthält genau das, was diese Entscheidung vorgemerkt hat (ein Pfad, den es im Stand gar nicht mehr gibt, ließ ihn scheitern)
function commitEintrag(vault, nachricht) {
  const r = g(vault, [...OHNE_HOOKS, ...identFlags(vault), "commit", "-q", "--allow-empty", "-m", nachricht], OHNE_ZEIT);
  if (r.code !== 0) throw new KonfliktFehler(422, "Die Entscheidung ließ sich nicht festhalten.", { ausgabe: r.err.slice(0, 500) });
  return kopfSha(vault);
}

// Alles, was schiefgehen kann, VOR dem ersten Eingriff prüfen: Größen, lesbare Fassungen, Namen der Kopien.
function plane(vault, l, wahlen, ad, andereGeraetVon) {
  const geplant = new Map(), belegt = new Set();
  for (const [pfad, x] of wahlen) {
    const d = ad.get(pfad);
    const p = { x, d, geraet: andereGeraetVon(d), kopie: null };
    const lies = (sha, pf) => { // kleine Dateien als Puffer, große (über MAX_DATEI) als { gross, sha, pfad }: sie werden beim Schreiben als Strom aus dem Objekt kopiert (kein Puffer-Limit)
      const gr = g(vault, ["cat-file", "-s", `${sha}:${pf}`]);
      if (gr.code !== 0) throw new KonfliktFehler(500, `„${pf}“ war nicht lesbar.`);
      if (Number(gr.out.trim()) > MAX_DATEI) return { gross: true, sha, pfad: pf, id: blobId(vault, sha, pf) };
      const buf = blobVon(vault, sha, pf);
      if (buf === null) throw new KonfliktFehler(500, `„${pf}“ war nicht lesbar.`);
      return buf;
    };
    if (d.typ === "umbenannt") {
      if (x.wahl === "andere" || x.wahl === "beide") p.blobA = lies(l.andere, d.pfadAndere);
    } else if (x.wahl === "andere" && d.andere.vorhanden) p.blobA = lies(l.andere, pfad);
    else if (x.wahl === "meine" && d.meine.vorhanden && l.modus === "stand") p.blobM = lies(l.meine, pfad);
    else if (x.wahl === "beide" && d.meine.vorhanden && d.andere.vorhanden) {
      p.blobA = lies(l.andere, pfad);
      p.kopie = freierKopieName(vault, pfad, dateiNamenTeil(p.geraet) || "anderes Gerät", belegt); belegt.add(p.kopie);
    } else if (x.wahl === "beide" && d.andere.vorhanden && !d.meine.vorhanden) p.blobA = lies(l.andere, pfad);
    geplant.set(pfad, p);
  }
  return geplant;
}

// Stand nach einem Abbruch mitten im Festhalten oder nach „Rückgängig“: nur noch diese Dateien sind zu entscheiden
function merkeBasis(vault, support, l, dateien) {
  const kopfBlobs = {};
  for (const p of dateien) kopfBlobs[p] = blobId(vault, "HEAD", p);
  aendereMerker(vault, (m) => { m.konfliktBasis = { meine: l.meine, andere: l.andere, dateien, kopfBlobs, kopf: kopfSha(vault), zeit: new Date().toISOString() }; return m; }, { support });
  merkeStand(vault, "konflikt", support, { dateien });
}

// Schließt den Konflikt ab. auswahl: [{ pfad, wahl, text? }] für jede sichtbare Datei; gesehen: { meine, andere } = die Stände, die die Oberfläche gezeigt hat.
// → { ok: true, merge, eintraege: [{ pfad, wahl, commit, neu, kopie?, partner? }], kopien, versteckteBehalten, sicherung, abgleich: { art, ok, text } }
export function loesen(vault, { auswahl, gesehen, support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    const { ansicht: a, l } = baueAnsicht(vault, support);
    if (!l) throw new KonfliktFehler(409, "Es gibt keinen offenen Konflikt.");
    if (l.ungueltig) throw new KonfliktFehler(409, "Der gemerkte Stand passt nicht mehr zu diesem Vault (zum Beispiel nach einem Zurücksetzen). Verwirf ihn, dann geht es weiter.", { art: "ungueltig" });
    if (!gesehen || gesehen.meine !== l.meine || gesehen.andere !== l.andere) throw new KonfliktFehler(409, "Der Konflikt hat sich seit deiner Ansicht geändert. Öffne den Abgleich noch einmal.", { art: "veraltet" });
    let marke = null;
    if (l.modus === "offen") {
      marke = pruefeMarke(vault, support, l);
      const fv = fremdVorgemerkt(vault, l, l.dateien.map((e) => e.pfad));
      if (fv.length) throw new KonfliktFehler(409, `Es ist etwas vorgemerkt, das nicht zu dieser Zusammenführung gehört („${fv[0]}“). Sichere oder entferne es zuerst, damit es nicht im Abgleich landet.`, { art: "vorgemerkt", dateien: fv });
      const b = bearbeitet(vault, marke, l);
      if (b.length) throw new KonfliktFehler(409, `„${b[0]}“ wurde seit dem Öffnen von Hand bearbeitet. Wähle „Später“ — deine Bearbeitung wird gesichert — und öffne den Abgleich neu.`, { art: "bearbeitet", dateien: b });
    } else {
      if (g(vault, ["diff", "--cached", "--quiet"]).code !== 0) throw new KonfliktFehler(409, "Es gibt vorgemerkte, noch nicht gesicherte Änderungen. Sichere sie zuerst, dann geht es weiter.", { art: "geaendert" });
      const pf = l.dateien.map((e) => e.pfad);
      if (pf.length && g(vault, ["status", "--porcelain", "--", ...pf]).out.trim()) throw new KonfliktFehler(409, "An diesen Notizen gibt es nicht gesicherte Änderungen. Sichere sie zuerst, dann geht es weiter.", { art: "geaendert" });
    }
    const ad = new Map(a.dateien.map((d) => [d.pfad, d]));
    const wahlen = pruefeAuswahl(auswahl, new Set(ad.keys()), ad);
    const eigen = a.eigen;
    const geraetVon = (d) => d.andere.geraet || a.geraet || null; // dasselbe Gerät wie in der Oberfläche: je Datei
    const verborgen = l.dateien.filter((e) => e.versteckt && e.art !== "beide-geloescht").map((e) => e.pfad);
    for (const e of l.dateien) if (e.eingebettet) throw new KonfliktFehler(422, `„${e.pfad}“ ist ein eingebettetes Repository — das kann Kortex nicht zusammenführen.`);
    const geplant = plane(vault, l, wahlen, ad, geraetVon); // wirft vor jedem Eingriff
    const sicherung = l.modus === "offen" ? sichereArbeitsstand(vault, l.dateien.filter((e) => e.art !== "beide-geloescht").map((e) => e.pfad), marke) : null;
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
      aendereMerker(vault, (m) => { delete m.konfliktOffen; return m; }, { support });
    }
    const vorKopf = kopfSha(vault);
    // 2. Je Entscheidung ein eigener Eintrag im Verlauf
    const eintraege = [], kopien = [];
    const merkeLetzte = () => aendereMerker(vault, (m) => { m.abgleichLetzter = { zeit: new Date().toISOString(), meine: l.meine, andere: l.andere, vorKopf, merge, eintraege }; return m; }, { support });
    try {
      for (const [pfad, x] of wahlen) {
        // Testhaken: nach so vielen festgehaltenen Entscheidungen abbrechen (nur Prüfstand)
        if (process.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" && process.env.BRAIN_KONFLIKT_ABBRUCH_NACH !== undefined && Number(process.env.BRAIN_KONFLIKT_ABBRUCH_NACH) === eintraege.length) throw new Error("Testabbruch");
        const p = geplant.get(pfad), d = p.d;
        const neu = [];
        const hatM = d.meine.vorhanden, hatA = d.andere.vorhanden;
        const stelleHer = (rel, buf) => {
          if (buf && buf.gross) { if (arbeitId(vault, rel) !== buf.id) schreibeStrom(vault, rel, buf); fuegeHinzu(vault, rel); return; }
          const abs = imVault(vault, rel); let gleich = false; try { gleich = Buffer.compare(readFileSync(abs), buf) === 0; } catch { /* fehlt */ } if (!gleich) schreibeDatei(vault, rel, buf); fuegeHinzu(vault, rel);
        };
        if (d.typ === "umbenannt") {
          if (x.wahl === "andere") { entferne(vault, pfad); stelleHer(d.pfadAndere, p.blobA); neu.push(d.pfadAndere); }
          else if (x.wahl === "beide") { stelleHer(d.pfadAndere, p.blobA); neu.push(d.pfadAndere); }
          else if (x.wahl === "text") { schreibeDatei(vault, pfad, x.text); fuegeHinzu(vault, pfad); }
          else if (l.modus === "stand") { const bm = blobVon(vault, l.meine, pfad); if (bm) stelleHer(pfad, bm); }
        } else if (x.wahl === "meine") {
          if (l.modus === "stand") { if (hatM) stelleHer(pfad, p.blobM); else entferne(vault, pfad); }
          else if (!hatM) entferne(vault, pfad); else fuegeHinzu(vault, pfad);
        } else if (x.wahl === "andere") { if (hatA) stelleHer(pfad, p.blobA); else entferne(vault, pfad); }
        else if (x.wahl === "text") { schreibeDatei(vault, pfad, x.text); fuegeHinzu(vault, pfad); }
        else if (!hatM) { stelleHer(pfad, p.blobA); } // beide, meine Seite fehlt: die vorhandene bleibt
        else if (!hatA) { fuegeHinzu(vault, pfad); }
        else { // beide: meine bleibt, die andere Fassung liegt als Kopie daneben
          if (l.modus === "stand") { const bm = blobVon(vault, l.meine, pfad); if (bm) stelleHer(pfad, bm); } else fuegeHinzu(vault, pfad);
          if (p.blobA && p.blobA.gross) schreibeStrom(vault, p.kopie, p.blobA, { neu: true }); else schreibeDatei(vault, p.kopie, p.blobA, { neu: true });
          fuegeHinzu(vault, p.kopie); neu.push(p.kopie);
          kopien.push({ pfad: p.kopie, von: pfad });
        }
        const nachricht = `Konflikt gelöst: „${einzeiler(d.titel, 60)}“ – ${entscheidungsText(d, x.wahl, p.geraet, p.kopie)}`;
        const commit = commitEintrag(vault, nachricht);
        eintraege.push({ pfad, wahl: x.wahl, commit, neu, ...(p.kopie ? { kopie: p.kopie } : {}), ...(d.pfadAndere ? { partner: d.pfadAndere } : {}) });
      }
    } catch (e) {
      // mitten im Festhalten gescheitert: was schon festgehalten ist, bleibt rückgängig-fähig; der Rest wird als Stand gemerkt (die Sicherung sendet bis dahin nichts)
      try {
        merkeLetzte();
        const erledigt = new Set(eintraege.map((x) => x.pfad));
        const rest = [...wahlen.keys()].filter((p) => !erledigt.has(p)).flatMap((p) => [p, geplant.get(p).d.pfadAndere].filter(Boolean));
        if (rest.length) merkeBasis(vault, support, l, rest);
      } catch { /* beste Mühe */ }
      if (e instanceof KonfliktFehler) { e.extra = { ...e.extra, teilweise: true, festgehalten: eintraege.length }; throw e; }
      throw new KonfliktFehler(500, "Das Festhalten ist nicht ganz gelungen. Ein Teil der Entscheidungen ist festgehalten, der Rest wartet.", { teilweise: true, festgehalten: eintraege.length });
    }
    merkeLetzte();
    aendereMerker(vault, (m) => { delete m.konfliktBasis; return m; }, { support });
    loescheAbgleichStand(vault, { support }); // der Konflikt ist gelöst; ein neuer wird beim Abgleich unten wieder vermerkt
    // 3. Abgleich wie die Sicherung: holen, senden — nur an das vom Nutzer bestätigte Ziel
    let abgleich;
    if (!pushErlaubnis(vault, support).ok) abgleich = { art: "nicht-bestaetigt", ok: false, text: PUSH_NICHT_BESTAETIGT };
    else { const r = abgleichen(vault, { support, sperre: false }); abgleich = { art: r.art, ok: r.ok, text: r.text, ...(r.dateien ? { dateien: r.dateien } : {}) }; }
    return { ok: true, merge, eintraege, kopien, versteckteBehalten: verborgen, sicherung, abgleich };
  });
}

// „Später“ / Abbrechen: die offene Zusammenführung zurücknehmen — der Arbeitsstand ist danach wie vorher, der Konflikt bleibt vermerkt.
// Nur eine Zusammenführung, die Kortex begonnen hat (409 „fremd“). Von Hand Bearbeitetes liegt vorher gesichert in brain-sicherung/ (sicherung in der Antwort).
export function abbrechen(vault, { support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    if (!mergeSha(vault)) return { ok: true, offen: false };
    const l = lage(vault, support);
    const marke = pruefeMarke(vault, support, l);
    const namen = l.dateien.filter((e) => !e.versteckt && e.art !== "beide-geloescht").map((e) => e.pfad);
    const sicherung = sichereArbeitsstand(vault, l.dateien.filter((e) => e.art !== "beide-geloescht").map((e) => e.pfad), marke);
    const r = g(vault, [...OHNE_HOOKS, "merge", "--abort"], OHNE_ZEIT);
    if (r.code !== 0 || mergeSha(vault)) {
      if (/not uptodate|would be overwritten|local changes/i.test(r.err)) throw new KonfliktFehler(409, `Eine zusammengeführte Datei wurde seit dem Abgleich noch einmal geändert. Zum Zurücknehmen müsste sie zurückgesetzt werden — dabei ginge deine Änderung verloren. ${sicherung ? `Eine Kopie liegt gesichert in: ${sicherung.ordner}` : ""}`.trim(), { art: "geaendert", ...(sicherung ? { sicherung } : {}) });
      throw new KonfliktFehler(500, "Der Abgleich ließ sich nicht zurücknehmen.");
    }
    aendereMerker(vault, (m) => { delete m.konfliktOffen; return m; }, { support });
    merkeStand(vault, "konflikt", support, { dateien: namen });
    return { ok: true, offen: true, sicherung };
  });
}

// „Rückgängig“ für den letzten Abgleich: Fassungen von vor den Entscheidungen kommen als NEUER Eintrag zurück (nie Reset). Geht nur, solange an diesen Dateien nicht
// weitergearbeitet wurde. Der Stand wird als `konfliktBasis` gemerkt: die Oberfläche kann noch einmal entscheiden lassen, die Sicherung sendet bis dahin nichts.
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
    for (const e of aendern) { pfade.add(e.pfad); for (const n of Array.isArray(e.neu) ? e.neu : (e.kopie ? [e.kopie] : [])) pfade.add(n); }
    for (const p of pfade) {
      const jetzt = blobId(vault, "HEAD", p), damals = blobId(vault, letzter, p);
      if (jetzt !== damals) throw new KonfliktFehler(409, `„${p}“ wurde seit dem Abgleich noch einmal geändert. Zurücknehmen würde diese Änderung überschreiben.`, { art: "geaendert", dateien: [p] });
    }
    if (g(vault, ["diff", "--cached", "--quiet"]).code !== 0) throw new KonfliktFehler(409, "Es gibt vorgemerkte, noch nicht gesicherte Änderungen. Zurücknehmen würde sie mitnehmen.", { art: "geaendert" });
    if (pfade.size && g(vault, ["status", "--porcelain", "--", ...pfade]).out.trim()) throw new KonfliktFehler(409, "Diese Dateien haben nicht gesicherte Änderungen. Zurücknehmen würde sie überschreiben.", { art: "geaendert" });
    for (const e of aendern) {
      for (const n of Array.isArray(e.neu) ? e.neu : (e.kopie ? [e.kopie] : [])) entferne(vault, n);
      const buf = blobVon(vault, m.vorKopf, e.pfad);
      if (buf === null) entferne(vault, e.pfad); else { schreibeDatei(vault, e.pfad, buf); fuegeHinzu(vault, e.pfad); }
    }
    let commit = null;
    if (pfade.size) commit = commitEintrag(vault, `Abgleich zurückgenommen: ${aendern.length} ${aendern.length === 1 ? "Entscheidung" : "Entscheidungen"} rückgängig gemacht`);
    const dateien = [...new Set(m.eintraege.flatMap((e) => [e.pfad, e.partner].filter(Boolean)))];
    aendereMerker(vault, (d) => { delete d.abgleichLetzter; return d; }, { support });
    merkeBasis(vault, support, { meine: m.meine, andere: m.andere }, dateien);
    return { ok: true, commit, dateien };
  });
}

// Was „Rückgängig“ noch kann: { moeglich, anzahl } (nur lesend; das Studio blendet den Knopf damit ein)
export function rueckgaengigStand(vault, { support = supportOrdner() } = {}) {
  const m = leseMerkerDatei(vault, support).abgleichLetzter;
  return { moeglich: !!(m && Array.isArray(m.eintraege) && m.eintraege.length), anzahl: m && Array.isArray(m.eintraege) ? m.eintraege.length : 0 };
}
