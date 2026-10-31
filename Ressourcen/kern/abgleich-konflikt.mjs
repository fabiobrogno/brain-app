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
  if (!kopf || !istCommit(vault, basis.meine) || !istCommit(vault, basis.andere) || !istVorfahr(vault, basis.meine, kopf) || !istVorfahr(vault, basis.andere, kopf)) return null;
  const mb = g(vault, ["merge-base", basis.meine, basis.andere]);
  const stamm = mb.code === 0 ? mb.out.trim() : null;
  const dateien = [], veraltet = [];
  const blobs = basis.kopfBlobs && typeof basis.kopfBlobs === "object" ? basis.kopfBlobs : {};
  for (const p of Array.isArray(basis.dateien) ? basis.dateien.slice(0, 400) : []) {
    let pfad; try { pfad = sauberer(p); } catch { continue; }
    // seitdem weitergearbeitet? Dann gehört diese Datei nicht mehr zum Konflikt (die neuere Arbeit gewinnt)
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
// → { aktiv: false } | { aktiv: true, modus, meine, andere, eigen, geraet, seit, dateien: [...], versteckt, fremd?, haelt?, veraltet? }
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
  if (l.modus === "stand" && !dateien.length) { // nichts mehr zu entscheiden (seitdem weitergearbeitet): der gemerkte Stand und die Sperre der Sicherung fallen weg
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
    if (ans.fremd) { const u = pruefeUebernahme(vault, l); ans.uebernehmbar = u.ok; if (!u.ok) ans.uebernahmeGrund = u.grund; }
  }
  else ans.haelt = true;
  if (l.veraltet && l.veraltet.length) ans.veraltet = l.veraltet;
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

// Sicherung dessen, was von Hand verändert wurde, vor dem Eingriff: <git-dir>/brain-sicherung/<Zeit>/ (30 Tage). Gesichert wird jede Arbeitsdatei, die von dem abweicht,
// was Git selbst hineingeschrieben hat (Konfliktdateien: Fingerabdruck beim Markieren; andere: der Stand im Index) — aus `git diff HEAD` plus den Konfliktdateien.
// Große Dateien (über MAX_DATEI) kommen als Objekt in die Versionsverwaltung (hash-object -w) und stehen mit ihrer Kennung in _blobs.txt.
// → { ordner, dateien: [Pfad], blobs: [{ pfad, id }] } oder null, wenn es nichts zu sichern gab. Scheitert eine Sicherung ganz: 409, nichts angefasst.
function sichereArbeitsstand(vault, konfliktPfade, marke) {
  const namen = new Set(konfliktPfade);
  const d = g(vault, ["diff", "--name-only", "-z", "HEAD"]);
  if (d.code === 0) for (const p of d.out.split("\0")) if (p) namen.add(p);
  const hashes = marke && marke.hashes && typeof marke.hashes === "object" ? marke.hashes : {};
  const zuSichern = [];
  for (const p of namen) {
    const quelle = join(vault, ...p.split("/"));
    let st; try { st = lstatSync(quelle); } catch { continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    const jetzt = arbeitId(vault, p);
    const bekannt = Object.hasOwn(hashes, p) ? hashes[p] : indexId(vault, p);
    if (jetzt && bekannt && jetzt === bekannt) continue; // nichts von Hand verändert
    zuSichern.push({ p, quelle, groesse: st.size });
  }
  if (!zuSichern.length) return null;
  const gp = g(vault, ["rev-parse", "--path-format=absolute", "--git-path", "brain-sicherung"]);
  const wurzel = gp.code === 0 ? gp.out.trim() : join(vault, ".git", "brain-sicherung");
  try {
    for (const e of readdirSync(wurzel, { withFileTypes: true })) {
      if (e.isDirectory() && /^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(e.name)) { const p = join(wurzel, e.name); if (Date.now() - statSync(p).mtimeMs > 30 * 86_400_000) rmSync(p, { recursive: true, force: true }); }
    }
  } catch { /* nur Komfort */ }
  const ordnerPfad = join(wurzel, new Date().toISOString().replace(/[:.]/g, "-"));
  const dateien = [], blobs = [], nicht = [];
  for (const { p, quelle, groesse } of zuSichern) {
    try {
      if (groesse > MAX_DATEI) throw new Error("gross");
      const ziel = join(ordnerPfad, ...p.split("/"));
      mkdirSync(dirname(ziel), { recursive: true }); copyFileSync(quelle, ziel); dateien.push(p);
    } catch {
      const r = g(vault, ["hash-object", "-w", "--no-filters", "--", p]);
      if (r.code === 0 && r.out.trim()) blobs.push({ pfad: p, id: r.out.trim() }); else nicht.push(p);
    }
  }
  if (nicht.length) throw new KonfliktFehler(409, `Von „${nicht[0]}“ ließ sich keine Sicherungskopie anlegen. Es wurde nichts verändert.`, { dateien: nicht });
  if (blobs.length) { mkdirSync(ordnerPfad, { recursive: true }); writeFileSync(join(ordnerPfad, "_blobs.txt"), blobs.map((b) => `${b.id}  ${b.pfad}`).join("\n") + "\n"); }
  return { ordner: ordnerPfad, dateien, blobs };
}

function mitSperre(vault, support, art, fn) {
  if (umstellungLaeuft(vault)) throw new KonfliktFehler(409, "Kortex räumt gerade deinen Vault auf (alter Werkzeug-Ordner). Warte einen Moment, dann geht das wieder.", { art: "umstellung" });
  const s = nimmSperre(sperrDateiFuer(vault, support), { art });
  if (!s.ok) throw new KonfliktFehler(409, "Gerade läuft ein anderer Abgleich. Bitte kurz warten und noch einmal versuchen.", { art: "laeuft" });
  try { return fn(); } finally { s.freigeben(); }
}

// ───────────────────────────── Markieren ─────────────────────────────
// Das Studio hat die Zusammenführung begonnen (git.mjs#sync) und ruft das gleich danach: nur so ist sie „von Kortex“.
export function markiere(vault, { support = supportOrdner() } = {}) {
  const merge = mergeSha(vault);
  if (!merge) return { ok: true, offen: false };
  const kopf = kopfSha(vault);
  const hashes = {};
  for (const e of indexKonflikte(vault)) { const h = arbeitId(vault, e.pfad); if (h) hashes[e.pfad] = h; }
  aendereMerker(vault, (m) => { m.konfliktOffen = { kopf, merge, hashes, zeit: new Date().toISOString() }; return m; }, { support });
  return { ok: true, offen: true };
}
// Eine Zusammenführung ohne Marke kann trotzdem von Kortex stammen: eine ältere Version hat sie im Studio-Abgleich begonnen (und nie markiert). Das erkennt man an
//  · MERGE_HEAD = refs/remotes/origin/<Zweig> (der Stand des Servers, den der Abgleich geholt hat) und einer Zusammenführungs-Meldung „… origin/<Zweig> …“ (MERGE_MSG),
//  · keiner Arbeit der Nutzerin in den Konfliktdateien: eine Datei mit beidseitigen Änderungen enthält noch Konfliktmarken, bei gelöscht/geändert und Umbenennungen
//    ist sie unverändert die Stufe, die Git hineingeschrieben hat; nichts davon ist (noch) von Hand bearbeitet.
// → { ok: true } oder { ok: false, grund }. Rein lesend.
function pruefeUebernahme(vault, l) {
  if (l.modus !== "offen") return { ok: false, grund: "Es gibt keine offene Zusammenführung." };
  const zw = g(vault, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (zw.code !== 0) return { ok: false, grund: "Der Vault steht auf keinem Zweig." };
  const lokal = zw.out.trim();
  const cfg = g(vault, ["config", "--get", `branch.${lokal}.merge`]);
  const ziel = cfg.code === 0 && /^refs\/heads\/[^\s~^:?*[\\]+$/.test(cfg.out.trim()) ? cfg.out.trim().slice("refs/heads/".length) : lokal;
  const spitze = g(vault, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${ziel}`]);
  if (spitze.code !== 0 || spitze.out.trim() !== l.andere) return { ok: false, grund: "Die Zusammenführung holt nicht den Stand des Servers (origin)." };
  let msg = "";
  try { const gd = g(vault, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_MSG"]); msg = readFileSync(gd.out.trim(), "utf8").split("\n")[0]; } catch { /* keine Meldung */ }
  if (!msg.includes(`origin/${ziel}`) || !/^Merge /.test(msg)) return { ok: false, grund: "Die Meldung der Zusammenführung passt nicht zum Abgleich von Kortex." };
  if (g(vault, ["ls-files", "-u", "-z"]).out === "") return { ok: false, grund: "Es gibt keine offenen Konflikte mehr." };
  for (const e of l.dateien) {
    if (e.art === "beide-geloescht") continue;
    const jetzt = arbeitId(vault, e.pfad);
    const stufe = (n) => { const r = g(vault, ["ls-files", "-s", "-z", "--", e.pfad]); for (const z of r.out.split("\0")) { const m = /^\d{6} ([0-9a-f]+) (\d)\t/.exec(z); if (m && Number(m[2]) === n) return m[1]; } return null; };
    if (e.art === "beide") {
      const t = jetzt ? (() => { try { return readFileSync(join(vault, ...e.pfad.split("/")), "utf8"); } catch { return ""; } })() : "";
      if (!/^<{7} /m.test(t) || !/^>{7} /m.test(t)) return { ok: false, grund: `„${e.pfad}“ wurde schon von Hand bearbeitet.` };
    } else {
      const erwartet = e.art === "meine-geloescht" || e.art === "nur-andere" ? stufe(3) : stufe(2);
      if (jetzt !== null && jetzt !== erwartet) return { ok: false, grund: `„${e.pfad}“ wurde schon von Hand bearbeitet.` };
    }
  }
  // nichts Fremdes vorgemerkt: vorgemerkt ist nur, was die Zusammenführung selbst bringt (Stufe 0 gegen HEAD wäre es auch — darum nur prüfen, dass keine Konfliktdatei gelöst vorgemerkt ist)
  return { ok: true };
}
// „Als Kortex-Zusammenführung übernehmen“ (nach Bestätigung in der Oberfläche): setzt die Marke, wenn alles dafür spricht
export function uebernehmen(vault, { support = supportOrdner() } = {}) {
  return mitSperre(vault, support, "konflikt", () => {
    const l = lage(vault, support);
    if (!l || l.modus !== "offen") throw new KonfliktFehler(409, "Es gibt keine offene Zusammenführung.", { art: "nichts" });
    const m = leseMerkerDatei(vault, support).konfliktOffen;
    if (m && m.kopf === l.meine && m.merge === l.andere) return { ok: true, offen: true, schon: true };
    const u = pruefeUebernahme(vault, l);
    if (!u.ok) throw new KonfliktFehler(409, `Das lässt sich nicht sicher übernehmen: ${u.grund}`, { art: "fremd" });
    markiere(vault, { support });
    return { ok: true, offen: true };
  });
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
    if (x.wahl === "beide" && (d.meine.gross || d.andere.gross)) throw new KonfliktFehler(413, `„${x.pfad}“ ist zu groß für „beide behalten“. Bitte wähle eine der beiden Fassungen.`);
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
    const lies = (sha, pf) => {
      const buf = blobVon(vault, sha, pf);
      if (buf === null) throw new KonfliktFehler(500, `„${pf}“ war nicht lesbar.`);
      if (buf.length > MAX_DATEI) throw new KonfliktFehler(413, `„${pf}“ ist zu groß.`);
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
    if (!gesehen || gesehen.meine !== l.meine || gesehen.andere !== l.andere) throw new KonfliktFehler(409, "Der Konflikt hat sich seit deiner Ansicht geändert. Öffne den Abgleich noch einmal.", { art: "veraltet" });
    let marke = null;
    if (l.modus === "offen") {
      marke = pruefeMarke(vault, support, l);
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
        const stelleHer = (rel, buf) => { const abs = imVault(vault, rel); let gleich = false; try { gleich = Buffer.compare(readFileSync(abs), buf) === 0; } catch { /* fehlt */ } if (!gleich) schreibeDatei(vault, rel, buf); fuegeHinzu(vault, rel); };
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
          schreibeDatei(vault, p.kopie, p.blobA, { neu: true });
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
