// ki-konten.mjs — KI-Konten und Vault-Zugriff (Plan docs/plaene/ki-konten.md, Paket P1), die LESENDE Hälfte im Kern (Hooks, Dienst).
//
// Welches KI-Konto darf welchen Vault wie weit nutzen? Der Merker <support>/ki-konten.json wird von der Werkstatt geschrieben
// (Ressourcen/gemeinsam/ki-konten.mjs, atomar, Modus 0600); der Kern liest nur. Stufen: gesperrt · lesen · posteingang · erweitert.
// Der Abschnitt zwischen den Marken LESEN-BEGINN/LESEN-ENDE ist wortgleich mit gemeinsam/ki-konten.mjs (Test: Tests/Node/ki-konten-paritaet.test.mjs).
// Jeder Fehler (Datei kaputt, Link, nicht lesbar) heißt „gesperrt“ (fail-closed). Fehlt die Datei ganz (die neue App lief noch nie), gilt das bisherige
// Verhalten (posteingang), damit ein Update nichts bricht; die Werkstatt legt die Datei beim ersten Start an.
import { openSync, closeSync, fstatSync, readSync, realpathSync, statSync, constants } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

// LESEN-BEGINN
export const STUFEN = ["gesperrt", "lesen", "posteingang", "erweitert"];
export const stufeNr = (s) => Math.max(0, STUFEN.indexOf(s));
export const schwaecher = (a, b) => (stufeNr(a) <= stufeNr(b) ? a : b);
export const darfMindestens = (stufe, mindest) => stufeNr(stufe) >= stufeNr(mindest) && stufeNr(mindest) >= 0;
export const KONTO_ID = /^k_[0-9a-f]{8}$/;
export const DATEI_NAME = "ki-konten.json";
export const kontenPfad = (support) => join(support, DATEI_NAME);
const NIEDRIG = ["gesperrt", "lesen", "posteingang"];
const MAX_GROESSE = 4 * 1024 * 1024;
const falteK = (s) => String(s).normalize("NFC").toLowerCase();
const istObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

export function kennungVon(wurzel) {
  const st = statSync(wurzel);
  return `${st.dev}:${st.ino}:${st.birthtimeMs}`;
}
// Der echte Ort eines Pfads, auch wenn es ihn (noch) nicht gibt: der längste vorhandene Vorfahr wird aufgelöst, der Rest bleibt.
export function echterOrt(p) {
  let rest = [], cur = resolve(String(p));
  for (;;) {
    try { return join(realpathSync.native(cur), ...rest); } catch { /* weiter nach oben */ }
    const eltern = dirname(cur);
    if (eltern === cur) return resolve(String(p));
    rest.unshift(basename(cur)); cur = eltern;
  }
}

function formOk(j) {
  if (!istObj(j) || j.version !== 1 || !istObj(j.konten) || !istObj(j.vaults)) return false;
  for (const k of Object.values(j.konten)) if (!istObj(k) || typeof k.programm !== "string" || typeof k.ordner !== "string") return false;
  for (const e of Object.values(j.vaults)) if (!istObj(e) || (e.konten !== undefined && !istObj(e.konten))) return false;
  return true;
}

// → { zustand: "fehlt" | "ok" | "defekt", daten }. Gelesen wird ohne Symlinks zu folgen (O_NOFOLLOW; ein Link an dieser Stelle ist „defekt“). Der Zwischenspeicher
// hängt an Inode, Größe und Zeiten: jedes atomare Schreiben (neuer Inode) wirkt beim nächsten Aufruf. Nie ein Fehler nach außen.
const lesecache = new Map();
export function liesKonten(support) {
  const defekt = { zustand: "defekt", daten: null };
  if (typeof support !== "string" || !support) return defekt;
  const datei = kontenPfad(support);
  let fd;
  try { fd = openSync(datei, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
  catch (e) { return e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? { zustand: "fehlt", daten: null } : defekt; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_GROESSE) return defekt;
    const schluessel = `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
    const c = lesecache.get(datei);
    if (c && c.schluessel === schluessel) return c.ergebnis;
    const puffer = Buffer.alloc(st.size);
    let gelesen = 0;
    while (gelesen < st.size) { const n = readSync(fd, puffer, gelesen, st.size - gelesen, gelesen); if (n <= 0) break; gelesen += n; }
    let j = null;
    try { j = JSON.parse(puffer.subarray(0, gelesen).toString("utf8")); } catch { j = null; }
    const ergebnis = formOk(j) ? { zustand: "ok", daten: j } : defekt;
    if (lesecache.size >= 20) lesecache.clear();
    lesecache.set(datei, { schluessel, ergebnis });
    return ergebnis;
  } catch { return defekt; } finally { try { closeSync(fd); } catch { /* egal */ } }
}

// → { eintrag, schluessel } | { ausgetauscht: true } | null.
// Gesucht wird zuerst über die Ordnerkennung (ein umbenannter oder verschobener Vault trifft seine Regeln weiter), dann über den Pfad. Steht unter dem Pfad
// ein Eintrag mit anderer Kennung, ist der Ordner ausgetauscht (gelöscht und neu angelegt/kopiert): die alten Regeln gelten nicht, der Vault bleibt gesperrt.
export function vaultEintrag(daten, vault) {
  let echt, kennung = null;
  try { echt = realpathSync.native(vault); } catch { return null; }
  try { kennung = kennungVon(echt); } catch { return null; }
  const f = falteK(echt);
  let amPfad = false;
  for (const [k, e] of Object.entries(daten.vaults)) {
    if (e.ordnerKennung === kennung) return { eintrag: e, schluessel: k };
    if (falteK(k) === f) amPfad = true;
  }
  return amPfad ? { ausgetauscht: true } : null;
}

const gueltig = (s, erlaubt) => (typeof s === "string" && erlaubt.includes(s) ? s : "gesperrt");
// → Stufe eines Kontos (id; null = kein Konto erkennbar) in einem Vault.
export function stufeFuer(daten, vault, kontoId) {
  const t = vaultEintrag(daten, vault);
  if (!t || !t.eintrag) return "gesperrt";
  const e = t.eintrag;
  if (kontoId === null || kontoId === undefined) return gueltig(e.ohneKonto, NIEDRIG);
  if (typeof kontoId !== "string" || !Object.hasOwn(daten.konten, kontoId)) return "gesperrt";
  if (istObj(e.konten) && Object.hasOwn(e.konten, kontoId)) return gueltig(e.konten[kontoId], STUFEN);
  return gueltig(e.neueKonten, NIEDRIG);
}

// Wer fragt? → { ids: [<kontoId> | null, …] }. null = ein Konto, das Kortex nicht kennt (zählt als gesperrt); eine leere Liste = kein Konto erkennbar.
//   arg:  Wert von --konto (Kortex trägt ihn beim Verbinden ein) · env: Umgebung des Prozesses (CLAUDE_CONFIG_DIR, CODEX_HOME)
//   programm: das Programm, das den Aufruf macht, wenn es feststeht (Hooks: "claude") · vollstaendig: die Umgebung ist unverändert von Claude Code geerbt
//   (Hooks): fehlt CLAUDE_CONFIG_DIR, läuft das Standardprofil. Beim MCP-Server (gefilterte Umgebung möglich) heißt eine fehlende Variable „keine Angabe“.
// Widersprechen sich Argument und Umgebung, gilt das STRENGERE Recht (stufeFuerBestimmung nimmt das Minimum): --konto steht in Dateien, die ein anderes
// Konto als Projekt-Einstellung mitliest, und ist nicht geheim.
export function bestimmeKonto({ arg, env = {}, programm = null, daten, vollstaendig = false } = {}) {
  const ids = [];
  const konten = daten && istObj(daten.konten) ? daten.konten : {};
  const eintraege = Object.entries(konten);
  const amOrt = (prog, dir) => {
    const f = falteK(echterOrt(dir));
    const t = eintraege.filter(([, k]) => k.programm === prog && falteK(k.ordner) === f);
    if (t.length <= 1) return t.length ? t[0][0] : null;
    let kennung = null; try { kennung = kennungVon(echterOrt(dir)); } catch { /* Ordner fehlt */ }
    const g = t.find(([, k]) => k.ordnerKennung === kennung);
    return g ? g[0] : null;
  };
  const standardKonto = (prog) => {
    const t = eintraege.filter(([, k]) => k.programm === prog && k.standard === true);
    if (t.length <= 1) return t.length ? t[0][0] : undefined;
    const g = t.find(([, k]) => { try { return k.ordnerKennung === kennungVon(echterOrt(k.ordner)); } catch { return false; } });
    return g ? g[0] : null;
  };
  let argProg = null;
  if (arg !== undefined && arg !== null) {
    if (typeof arg === "string" && KONTO_ID.test(arg) && Object.hasOwn(konten, arg)) { ids.push(arg); argProg = konten[arg].programm; }
    else ids.push(null);
  }
  for (const prog of argProg ? [argProg] : programm ? [programm] : ["claude", "codex"]) {
    const dir = prog === "claude" ? env.CLAUDE_CONFIG_DIR : prog === "codex" ? env.CODEX_HOME : undefined;
    if (typeof dir === "string" && dir) ids.push(amOrt(prog, dir));
    else if (vollstaendig && prog === "claude") { const s = standardKonto("claude"); if (s !== undefined) ids.push(s); }
  }
  return { ids };
}
export function stufeFuerBestimmung(daten, vault, ids) {
  if (!ids.length) return stufeFuer(daten, vault, null);
  return ids.reduce((s, id) => schwaecher(s, id === null ? "gesperrt" : stufeFuer(daten, vault, id)), "erweitert"); // null = ein Konto, das Kortex nicht kennt
}

// Die Stufe für einen Aufruf (Hook, MCP-Server): liest die Datei (mit Zwischenspeicher), bestimmt das Konto, wendet die Regeln an.
//   fehlt: Übergang vor dem ersten Start der neuen App → das bisherige Verhalten (posteingang). defekt/unlesbar: gesperrt (fail-closed).
export function kontoStufe(vault, { support, arg, env = {}, programm = null, vollstaendig = false } = {}) {
  const { zustand, daten } = liesKonten(support);
  if (zustand === "fehlt") return "posteingang";
  if (zustand !== "ok") return "gesperrt";
  return stufeFuerBestimmung(daten, vault, bestimmeKonto({ arg, env, programm, daten, vollstaendig }).ids);
}
// LESEN-ENDE
