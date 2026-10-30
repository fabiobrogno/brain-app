// gemeinsam/ki-konten.mjs — KI-Konten und Vault-Zugriff (Plan docs/plaene/ki-konten.md, Paket P1), die LESENDE UND SCHREIBENDE Hälfte (Werkstatt, MCP-Server).
//
// Ein KI-Konto ist ein Programm plus Konfig-Ordner (Claude-Profil ~/.claude-*, Codex-Ordner, Cursor …). Je Konto und Vault gilt eine Stufe:
//   gesperrt · lesen · posteingang (lesen + Posteingang/Aufgaben anlegen) · erweitert (darf Pflege-Konto sein).
// Der Merker liegt außerhalb der Vaults: <support>/ki-konten.json (Modus 0600, atomar: Temp „wx“ + rename, vorige Fassung als .vorher).
//   { version: 1,
//     konten: { "k_3f9a1c07": { programm, ordner, standard, name, abo?, ordnerKennung, seit, heimat? } },
//     vaults: { "<realpath>": { ordnerKennung, neueKonten, ohneKonto, konten: { "<kontoId>": "<stufe>" } } } }
//   neueKonten: was für ein bekanntes Konto ohne eigenen Eintrag gilt · ohneKonto: was für einen Aufruf ohne erkennbares Konto gilt (alte Einträge
//   ohne --konto; die Migration setzt es für bestehende Verbindungen auf „posteingang“, neue Vaults starten „gesperrt“).
//   Ein unbekanntes Konto (id nicht in konten) und ein Vault ohne Eintrag sind immer „gesperrt“.
//
// Der Abschnitt zwischen den Marken LESEN-BEGINN/LESEN-ENDE ist wortgleich in kern/ki-konten.mjs (Hooks, Kern); Tests/Node/ki-konten-paritaet.test.mjs
// vergleicht beide. Geändert wird er immer an beiden Stellen.
import { lstatSync, openSync, closeSync, fstatSync, readSync, writeSync, realpathSync, statSync, constants, mkdirSync, writeFileSync, renameSync, unlinkSync, copyFileSync, chmodSync, readFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { userInfo, tmpdir, homedir } from "node:os";
import { HttpFehler } from "./basis.mjs";
import { sicherungFuer } from "./sicherung.mjs";

// LESEN-BEGINN
export const STUFEN = ["gesperrt", "lesen", "posteingang", "erweitert"];
export const stufeNr = (s) => Math.max(0, STUFEN.indexOf(s));
export const schwaecher = (a, b) => (stufeNr(a) <= stufeNr(b) ? a : b);
export const darfMindestens = (stufe, mindest) => stufeNr(stufe) >= stufeNr(mindest) && stufeNr(mindest) >= 0;
export const KONTO_ID = /^k_[0-9a-f]{8}$/;
export const DATEI_NAME = "ki-konten.json";
export const kontenPfad = (support) => join(support, DATEI_NAME);
// Spur: Wurde die Liste schon einmal geschrieben? Das Schreiben legt <support>/ki-konten.angelegt an, und die vorige Fassung bleibt als ki-konten.json.vorher. Fehlt die Liste, die Spur aber
// nicht, wurde die Datei gelöscht (oder der Ordner zurückgesetzt): das gilt als beschädigt (fail-closed), nicht als „noch nie gelaufen“ — sonst öffnete ein Löschen alle Sperren.
export const SPUR_DATEI = "ki-konten.angelegt";
export function hatSpur(support) {
  if (typeof support !== "string" || !support) return false;
  for (const n of [SPUR_DATEI, `${DATEI_NAME}.vorher`]) { try { lstatSync(join(support, n)); return true; } catch { /* keine Spur */ } }
  return false;
}
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

// → { zustand: "fehlt" | "ok" | "defekt" | "geloescht", daten } („geloescht“: die Datei fehlt, aber es gibt Spuren, dass sie einmal da war). Gelesen wird ohne Symlinks zu folgen (O_NOFOLLOW; ein Link an dieser Stelle ist „defekt“). Der Zwischenspeicher
// hängt an Inode, Größe und Zeiten: jedes atomare Schreiben (neuer Inode) wirkt beim nächsten Aufruf. Nie ein Fehler nach außen.
const lesecache = new Map();
export function liesKonten(support) {
  const defekt = { zustand: "defekt", daten: null };
  if (typeof support !== "string" || !support) return defekt;
  const datei = kontenPfad(support);
  let fd;
  try { fd = openSync(datei, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
  catch (e) { return e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? (hatSpur(support) ? { zustand: "geloescht", daten: null } : { zustand: "fehlt", daten: null }) : defekt; }
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
  if (kontoId === null || kontoId === undefined) {
    // Ein Aufruf ohne erkennbares Konto (Altform ohne --konto) ist nie lockerer als das strengste bekannte Konto: eine Sperre darf sich so nicht umgehen lassen.
    let s = gueltig(e.ohneKonto, NIEDRIG);
    for (const id of Object.keys(daten.konten)) s = schwaecher(s, stufeFuer(daten, vault, id));
    return s;
  }
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

// Wo gilt die Liste? Der Support-Ordner der App ist der Standardort; BRAIN_APP_SUPPORT lenkt ihn um (Tests, Vorschau) — eine KI, die einen MCP-Eintrag oder eine Umgebung ändern kann, könnte sonst auf einen
// leeren Ordner zeigen („Datei fehlt“ = offen). Darum zählt außerhalb von Tests und Vorschau immer auch der Standardort (aus dem Benutzereintrag des Systems, nicht aus HOME), und bei mehreren Orten gilt das
// strengere Ergebnis. Im Test (BRAIN_TESTMODUS, Kern-Testläufer, HOME im Temp-Ordner) und in der Vorschau gilt nur der übergebene Ordner: kein Zugriff auf den echten Support-Ordner des Rechners.
const tempWurzel = () => { try { return realpathSync(tmpdir()); } catch { return tmpdir(); } };
const homeImTemp = () => { try { const h = realpathSync(homedir()); const t = tempWurzel(); return h === t || h.startsWith(`${t}/`); } catch { return false; } };
const abgeschottet = () => process.env.BRAIN_TESTMODUS === "1" || process.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || (typeof process.env.KORTEX_VORSCHAU === "string" && process.env.KORTEX_VORSCHAU !== "") || homeImTemp();
export function standardSupport() { try { return join(userInfo().homedir, "Library", "Application Support", "Kortex"); } catch { return null; } }
export function kontenOrte(support, { standard = undefined, abgeschottet: ab = undefined } = {}) {
  const orte = [];
  if (!(ab === undefined ? abgeschottet() : ab)) { const std = standard === undefined ? standardSupport() : standard; if (std) orte.push(std); }
  if (typeof support === "string" && support && !orte.some((o) => resolve(o) === resolve(support))) orte.push(support);
  return orte;
}
// → die erste lesbare Liste (Standardort zuerst) { zustand, daten, ort } für Dinge, die nur EINE Liste brauchen (Konto der Herkunft, Heimat-Vault). Gibt es keine, ist es die des übergebenen Ordners.
export function massgeblicheListe(support, opt = {}) {
  const orte = kontenOrte(support, opt);
  for (const ort of orte) { const r = liesKonten(ort); if (r.zustand === "ok") return { ...r, ort }; }
  const r = liesKonten(orte[orte.length - 1] ?? support);
  return { ...r, ort: orte[orte.length - 1] ?? support };
}
// Die Stufe für einen Aufruf (Hook, MCP-Server): liest die Liste(n) (mit Zwischenspeicher), bestimmt das Konto, wendet die Regeln an.
//   fehlt überall: Übergang vor dem ersten Start der neuen App → das bisherige Verhalten (posteingang). Ein Ort mit Liste, die defekt/unlesbar/gelöscht ist: gesperrt (fail-closed).
//   Mehrere Orte: das strengste Ergebnis; ein Ort, an dem die Liste schlicht fehlt, zählt dabei nicht mit.
export function kontoStufe(vault, { support, arg, env = {}, programm = null, vollstaendig = false, standard = undefined, abgeschottet = undefined } = {}) {
  let best = null;
  for (const ort of kontenOrte(support, { standard, abgeschottet })) {
    const { zustand, daten } = liesKonten(ort);
    if (zustand === "fehlt") continue;
    const s = zustand !== "ok" ? "gesperrt" : stufeFuerBestimmung(daten, vault, bestimmeKonto({ arg, env, programm, daten, vollstaendig }).ids);
    best = best === null ? s : schwaecher(best, s);
  }
  return best === null ? "posteingang" : best;
}
// LESEN-ENDE

// ───────────────────────────── Schreiben (nur Werkstatt) ─────────────────────────────
export const leerDaten = () => ({ version: 1, konten: {}, vaults: {} });
export const pruefeDaten = (j) => formOk(j);
export function neueId(daten) {
  for (let i = 0; i < 50; i++) {
    const id = `k_${randomBytes(4).toString("hex")}`;
    if (!Object.hasOwn(daten.konten, id)) return id;
  }
  throw new HttpFehler(500, "Es konnte keine Konto-Kennung vergeben werden.");
}
export function pruefeName(name) {
  const n = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.length > 40) throw new HttpFehler(400, "Der Name braucht 1 bis 40 Zeichen.");
  return n;
}
export const ABOS = ["pro", "max", "team", "enterprise", "api", "unbekannt"];

const sicherungDefekt = sicherungFuer(DATEI_NAME);
// Ist die Datei da, aber kein gültiges ki-konten.json, wird sie beiseitegelegt (ki-konten.json.defekt-<zeit>, nie überschrieben) → Name der Sicherung | null.
export function sichereDefekte(support) {
  const datei = kontenPfad(support);
  let st;
  try { st = lstatSync(datei); } catch { return null; }
  if (liesKonten(support).zustand !== "defekt") return null;
  if (st.isSymbolicLink()) { unlinkSync(datei); return null; } // ein Link wird nie gelesen oder kopiert, nur entfernt
  if (!st.isFile()) throw new HttpFehler(409, "An der Stelle der Liste der KI-Konten liegt etwas anderes als eine Datei. Kortex ändert es nicht.", { art: "defekt" });
  return sicherungDefekt.sichere(dirname(datei), datei, { verschieben: true });
}

// Sperre gegen eine zweite Werkstatt (oder ein zweites Fenster): ki-konten.json.lock per „wx“, nach 10 s gilt sie als verwaist.
function sperre(support) {
  const lock = `${kontenPfad(support)}.lock`;
  mkdirSync(support, { recursive: true, mode: 0o700 });
  const bis = Date.now() + 5000;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try { writeSync(fd, `${process.pid} ${Date.now()}`); } finally { closeSync(fd); }
      return () => { try { unlinkSync(lock); } catch { /* weg */ } };
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      try { if (Date.now() - lstatSync(lock).mtimeMs > 10_000) { unlinkSync(lock); continue; } } catch { /* weg */ }
      if (Date.now() > bis) throw new HttpFehler(503, "Die Liste der KI-Konten wird gerade von einem anderen Vorgang geändert. Versuche es gleich noch einmal.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

// Atomar: Temp-Datei „wx“ (0600) im selben Ordner, die bisherige gültige Fassung bleibt als ki-konten.json.vorher, dann rename. Ein Link an der Stelle
// wird ersetzt, nie durchschrieben.
function schreibeDatei(support, daten) {
  if (!formOk(daten)) throw new HttpFehler(500, "Die Liste der KI-Konten ist nicht gültig und wurde nicht gespeichert.");
  const datei = kontenPfad(support);
  mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
  const nonce = `${process.pid}.${randomBytes(4).toString("hex")}`;
  // Solange der Hinweis „Liste war beschädigt“ gilt (daten.hinweis), bleibt .vorher die letzte gute Fassung von VOR dem Schaden: sonst wäre sie mit dem ersten Schreiben danach überschrieben,
  // und „frühere Fassung zurückholen“ (stelleVorherWiederHer) hätte nichts mehr zurückzuholen.
  const jetzt = liesKonten(support);
  if (jetzt.zustand === "ok" && !(jetzt.daten.hinweis && jetzt.daten.hinweis.art === "defekt-neu")) {
    const vor = `${datei}.vorher.${nonce}.tmp`;
    try { copyFileSync(datei, vor, constants.COPYFILE_EXCL); chmodSync(vor, 0o600); renameSync(vor, `${datei}.vorher`); }
    catch { try { unlinkSync(vor); } catch { /* weg */ } }
  }
  const tmp = `${datei}.${nonce}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(daten, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(tmp, datei); }
  catch (e) { try { unlinkSync(tmp); } catch { /* weg */ } throw new HttpFehler(500, "Die Liste der KI-Konten konnte nicht gespeichert werden."); }
  sichereSpur(support);
}
// Die Spur „die Liste war einmal da“ (siehe hatSpur) anlegen, falls sie fehlt. Auch für Listen, die es schon vor dieser Spur gab.
export function sichereSpur(support) {
  const spur = join(support, SPUR_DATEI);
  try { lstatSync(spur); return; } catch { /* anlegen */ }
  try { writeFileSync(spur, "Kortex: die Liste der KI-Konten wurde angelegt. Fehlt ki-konten.json trotzdem, gilt alles als gesperrt.\n", { mode: 0o600, flag: "wx" }); } catch { /* vorhanden oder nicht schreibbar */ }
}

// Liest, ändert und schreibt unter der Sperre. fn(alt | null) → neue Daten | null/undefined (keine Änderung). Eine defekte Datei wird nicht überschrieben (409);
// dafür gibt es repariere().
export function aendere(support, fn, { neuAnfangen = false } = {}) {
  const frei = sperre(support);
  try {
    const r = liesKonten(support);
    if (r.zustand === "defekt" || (r.zustand === "geloescht" && !neuAnfangen)) throw new HttpFehler(409, "Die Liste der KI-Konten ist beschädigt. Kortex legt sie neu an, sobald du die KI-Konten öffnest.", { art: "defekt" });
    const alt = r.zustand === "ok" ? structuredClone(r.daten) : null;
    const vorher = alt ? JSON.stringify(alt) : null; // fn darf alt verändern und zurückgeben: verglichen wird mit dem Text von vorher
    const neu = fn(alt);
    if (neu === undefined || neu === null) return { geaendert: false, daten: alt };
    if (vorher !== null && vorher === JSON.stringify(neu)) return { geaendert: false, daten: alt };
    schreibeDatei(support, neu);
    return { geaendert: true, daten: neu };
  } finally { frei(); }
}

// Defekte Datei: beiseitelegen und leer neu anfangen (alles gesperrt, siehe synchronisiere). Die vorige Fassung (.vorher) bleibt unberührt liegen; sie wird
// NICHT automatisch zurückgespielt (sie könnte eine Sperre aufheben, die der Nutzer zuletzt gesetzt hat) — stelleVorherWiederHer() ist der ausdrückliche Weg.
export function repariere(support) {
  const frei = sperre(support);
  try {
    const z = liesKonten(support).zustand;
    if (z === "geloescht") return { repariert: true, sicherung: null, grund: "geloescht" }; // es gibt nichts beiseitezulegen; die frühere Fassung (.vorher) bleibt liegen
    if (z !== "defekt") return { repariert: false, sicherung: null };
    const sicherung = sichereDefekte(support);
    return { repariert: true, sicherung };
  } finally { frei(); }
}
export function stelleVorherWiederHer(support) {
  const frei = sperre(support);
  try {
    const vor = `${kontenPfad(support)}.vorher`;
    let st; try { st = lstatSync(vor); } catch { throw new HttpFehler(404, "Es gibt keine frühere Fassung der Liste."); }
    if (!st.isFile() || st.size > MAX_GROESSE) throw new HttpFehler(409, "Die frühere Fassung der Liste ist nicht brauchbar.");
    let j = null; try { j = JSON.parse(readFileSync(vor, "utf8")); } catch { j = null; }
    if (!formOk(j)) throw new HttpFehler(409, "Die frühere Fassung der Liste ist nicht brauchbar.");
    const r = liesKonten(support);
    if (r.zustand === "defekt") sichereDefekte(support);
    schreibeDatei(support, j);
    return { ok: true };
  } finally { frei(); }
}
