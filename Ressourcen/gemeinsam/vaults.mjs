// gemeinsam/vaults.mjs — Vault-Verwaltung für Brain Studio v2 (Spec v2 §2): die Liste der Vaults, die Pfadregeln und
// die vier Wege zu einem Vault (neu aus Vorlage, neu leer, vorhandenen Ordner öffnen, von GitHub klonen).
// Reines Modul ohne Routen — die Werkstatt verdrahtet es. Prozesse nur über den git()-Helfer (execFile, keine Shell).
//
// Alle Funktionen nehmen als letztes Argument `opt`: support (Standard supportOrdner()), home (Standard os.homedir()) und
// heute ("JJJJ-MM-TT", für Tests). Sie werden bei JEDEM Aufruf frisch gelesen — nie als Modul-Konstante.
import {
  realpathSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, copyFileSync,
} from "node:fs";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { HttpFehler, supportOrdner, testmodus, falte, BEARBEITBAR } from "./basis.mjs";
import { git, istRepo } from "./git.mjs";
import { pruefeGitUrl, sorgeFuerIdentitaet, uebersetzeGitFehler } from "./gitwerkzeug.mjs";
import { berlinHeute } from "./pruefung.mjs";
import { legeVorlageAn, GITIGNORE } from "./vorlage.mjs";

export { HttpFehler };

// Feste Palette: ein neuer Vault bekommt die erste unbenutzte Farbe, sind alle vergeben, die am seltensten benutzte.
export const PALETTE = ["#5B8DEF", "#E5734F", "#4FA877", "#B07CD8", "#D9A441", "#3FA7B5", "#D6638A", "#7C8798"];

const MELDUNG_NICHT_LEER = "Der Ordner ist nicht leer. Wähle einen neuen oder leeren Ordner — oder öffne ihn als vorhandenen Ordner.";

// ---------- Kleinigkeiten ----------

function optionen(opt) {
  const o = opt || {};
  return { support: o.support || supportOrdner(), home: o.home || homedir(), heute: o.heute || null, limitKlon: o.limitKlon };
}

const objekt = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const gibtEs = (p) => { try { lstatSync(p); return true; } catch { return false; } }; // auch kaputte Verweise
const istOrdner = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const kuerze = (s, n = 4000) => { const t = String(s || "").trim(); return t.length > n ? t.slice(0, n) + "\n… (gekürzt)" : t; };

// Pfadvergleiche segmentweise und ohne Groß/klein und Unicode-Form (APFS): so kann kein Abschneiden von Strings schiefgehen.
const teile = (p) => String(p).split("/").filter(Boolean).map(falte);
const istGleich = (p, basis) => { const a = teile(p), b = teile(basis); return a.length === b.length && b.every((s, i) => s === a[i]); };
const hatPraefix = (p, basis) => { const a = teile(p), b = teile(basis); return a.length >= b.length && b.every((s, i) => s === a[i]); };
const istUnter = (p, basis) => teile(p).length > teile(basis).length && hatPraefix(p, basis);
const istUnterOderGleich = (p, basis) => hatPraefix(p, basis);

// Ordnername als Vault-Name (höchstens 80 Zeichen); beim Klonen ohne die Endung „.git“.
const standardName = (p, ohneGit = false) => [...((ohneGit ? basename(p).replace(/\.git$/i, "") : basename(p)) || "Brain")].slice(0, 80).join("");

// Name: fehlt er (undefined/null) → undefined (Aufrufer nimmt den Ordnernamen); sonst getrimmt, 1–80 Zeichen, keine Steuerzeichen.
function pruefeName(name) {
  if (name === undefined || name === null) return undefined;
  if (typeof name !== "string") throw new HttpFehler(400, "Der Name muss ein Text sein.");
  if (/[\x00-\x1f\x7f]/.test(name)) throw new HttpFehler(400, "Der Name enthält ungültige Zeichen.");
  const n = name.trim();
  if (!n) throw new HttpFehler(400, "Bitte einen Namen eingeben.");
  if ([...n].length > 80) throw new HttpFehler(400, "Der Name ist zu lang (höchstens 80 Zeichen).");
  return n;
}

// Dateisystemfehler in Alltagssprache; HttpFehler bleiben wie sie sind.
function wandleFehler(e, standard = "Das hat nicht geklappt.") {
  if (e instanceof HttpFehler) return e;
  const c = e && e.code;
  if (c === "EACCES" || c === "EPERM") return new HttpFehler(403, "Die App darf an diesem Ort nichts anlegen. Wähle einen anderen Ordner oder erlaube den Zugriff in den Systemeinstellungen unter „Datenschutz & Sicherheit“.");
  if (c === "ENOSPC") return new HttpFehler(500, "Auf dem Datenträger ist nicht genug Platz.");
  if (c === "ENOTDIR" || c === "EEXIST") return new HttpFehler(409, "Am Zielort liegt schon etwas im Weg, zum Beispiel eine Datei statt eines Ordners.");
  if (c === "ENOENT") return new HttpFehler(404, "Der Ordner ist nicht mehr da.");
  return new HttpFehler(500, standard, { ausgabe: String((e && e.message) || e).slice(0, 500) });
}

const loesche = (p) => { try { rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* beste Mühe */ } };

// ---------- Pfade auflösen und prüfen ----------

// Realpath des nächsten vorhandenen Vorfahren (Symlinks!, auf macOS auch die echte Groß/klein-Schreibung) plus der Rest,
// der noch nicht existiert.
// Eine Datei statt eines Ordners (selbst oder als Vorfahre) → 400, ein kaputter Verweis → 409.
function echterPfad(abs) {
  let p = abs;
  const rest = [];
  for (;;) {
    let echt;
    try { echt = realpathSync.native(p); }
    catch (e) {
      if (e && e.code === "ELOOP") throw new HttpFehler(400, "Dieser Pfad enthält einen Verweis im Kreis und lässt sich nicht öffnen.");
      if (e && e.code === "ENOENT" && gibtEs(p)) throw new HttpFehler(409, "Dieser Pfad ist ein Verweis (Alias), der ins Leere zeigt. Bitte wähle einen anderen Ordner.");
      const oben = dirname(p);
      if (oben === p) throw new HttpFehler(400, "Dieser Pfad ist nicht erreichbar.");
      rest.push(basename(p));
      p = oben;
      continue;
    }
    let st = null;
    try { st = statSync(echt); } catch { /* Rechte o. Ä. — später beim Anlegen */ }
    if (st && !st.isDirectory()) throw new HttpFehler(400, "Hier liegt eine Datei, kein Ordner. Bitte einen Ordner wählen.");
    return rest.length ? join(echt, ...rest.reverse()) : echt;
  }
}
const versuchEchter = (p) => { try { return echterPfad(p); } catch { return p; } };

const SYSTEM_PRAEFIXE = ["/System", "/bin", "/sbin", "/usr", "/etc", "/private/etc", "/dev", "/Library", "/Applications", "/cores", "/opt", "/private/var/db", "/var/db"];

// Die Verbote gelten für die geschriebene UND die aufgelöste Form des Pfads (siehe pruefeVaultPfad).
function pruefeRegeln(p, home, support) {
  const verbot = (m) => { throw new HttpFehler(403, m); };
  const system = "Dieser Ordner gehört dem System und kann kein Vault sein. Wähle einen Ordner in deinem Benutzerordner, zum Beispiel unter „Dokumente“.";
  const segs = teile(p);
  if (!segs.length || (segs.length === 1 && (segs[0] === "users" || segs[0] === "volumes"))) verbot(system);
  if (istGleich(p, home)) verbot("Dein Benutzerordner selbst ist als Vault zu groß. Lege dafür einen eigenen Ordner an, zum Beispiel „Brain“.");
  // auch die Vorfahren der Systemordner (/private, /private/var, /var): ein Vault dort würde das System enthalten
  for (const s of SYSTEM_PRAEFIXE) if (istUnterOderGleich(p, s) || istUnterOderGleich(s, p)) verbot(system);
  const lib = join(home, "Library");
  if (istUnterOderGleich(p, lib) && !istUnterOderGleich(p, join(lib, "Mobile Documents")) && !istUnterOderGleich(p, join(lib, "CloudStorage"))) {
    verbot("Der Ordner „Library“ gehört dem System und den Programmen. Wähle einen anderen Ort — iCloud Drive und Dropbox sind erlaubt.");
  }
  if (istUnterOderGleich(p, support)) verbot("Das ist der interne Ordner der App. Bitte wähle einen anderen Ort.");
  if (segs.includes(".git")) verbot("In einem „.git“-Ordner kann kein Vault liegen.");
  if (segs.includes("node_modules")) verbot("In einem „node_modules“-Ordner kann kein Vault liegen.");
  if (segs.some((s) => s.endsWith(".app"))) verbot("In einem Programm (.app) kann kein Vault liegen.");
  if (istUnter(p, home)) {
    const rest = p.split("/").filter(Boolean).slice(teile(home).length);
    if (rest.some((s) => s.startsWith("."))) verbot("Versteckte Ordner (mit einem Punkt am Anfang) sind kein guter Ort für einen Vault. Wähle einen sichtbaren Ordner.");
  }
}

// → bereinigter absoluter Pfad (Symlinks aufgelöst) oder HttpFehler 400/403/409. Legt nichts an, ändert nichts.
export function pruefeVaultPfad(pfad, optionenUndListe) {
  const { vaults, ...opt } = objekt(optionenUndListe);
  const o = optionen(opt);
  if (typeof pfad !== "string" || !pfad.trim()) throw new HttpFehler(400, "Bitte einen vollständigen Ordnerpfad angeben");
  if (pfad.length > 1000) throw new HttpFehler(400, "Der Pfad ist zu lang.");
  if (/[\x00-\x1f\x7f]/.test(pfad)) throw new HttpFehler(400, "Der Pfad enthält ungültige Zeichen.");
  let p = pfad.trim();
  if (p === "~" || p.startsWith("~/")) p = join(o.home, p.slice(1));
  if (!isAbsolute(p)) throw new HttpFehler(400, "Bitte einen vollständigen Ordnerpfad angeben");

  const homeLex = resolve(o.home), supportLex = resolve(o.support);
  const lex = resolve(p);
  pruefeRegeln(lex, homeLex, supportLex);
  const echt = echterPfad(lex);
  pruefeRegeln(echt, versuchEchter(homeLex), versuchEchter(supportLex));

  const alle = Array.isArray(vaults) ? vaults : ladeListe(o, false).liste.vaults;
  for (const v of alle) {
    if (!v || typeof v.pfad !== "string") continue;
    const formen = [v.pfad, versuchEchter(v.pfad)];
    if (formen.some((f) => istGleich(echt, f))) continue; // derselbe Vault: erlaubt (Idempotenz)
    const name = v.name || basename(v.pfad);
    if (formen.some((f) => istUnter(echt, f))) throw new HttpFehler(409, `Dieser Ordner liegt schon im Vault „${name}“. Ein Vault darf nicht in einem anderen Vault liegen.`);
    if (formen.some((f) => istUnter(f, echt))) throw new HttpFehler(409, `In diesem Ordner liegt schon der Vault „${name}“. Wähle einen Ordner außerhalb davon.`);
  }
  return echt;
}

// <home>/Brain; gibt es das schon, <home>/Brain 2, Brain 3 …
export function standardOrdner(opt = {}) {
  const o = optionen(opt);
  const basis = join(o.home, "Brain");
  for (let n = 1; n < 1000; n++) {
    const p = n === 1 ? basis : `${basis} ${n}`;
    if (!gibtEs(p)) return p;
  }
  throw new HttpFehler(409, "Es gibt schon zu viele Ordner namens „Brain“. Bitte wähle selbst einen Ordner.");
}

// ---------- Die Liste (vaults.json) ----------

// Liest nur — nie schreiben. zustand: "ok" | "fehlt" | "defekt" (Rechte o. Ä. und kaputtes JSON zählen als defekt).
function leseDatei(o) {
  let text;
  try { text = readFileSync(join(o.support, "vaults.json"), "utf8"); }
  catch (e) { return { zustand: e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? "fehlt" : "defekt" }; }
  let wurzel;
  try { wurzel = JSON.parse(text); } catch { return { zustand: "defekt" }; }
  if (!wurzel || typeof wurzel !== "object" || Array.isArray(wurzel) || (wurzel.vaults !== undefined && !Array.isArray(wurzel.vaults))) return { zustand: "defekt" };
  const gesehen = new Set();
  const vaults = [];
  for (const v of wurzel.vaults || []) {
    if (!v || typeof v !== "object" || typeof v.pfad !== "string" || v.pfad.includes("\0") || !isAbsolute(v.pfad)) continue; // kaputte Einträge überspringen
    const pfad = resolve(v.pfad);
    if (gesehen.has(teile(pfad).join("/"))) continue;
    gesehen.add(teile(pfad).join("/"));
    vaults.push({
      name: typeof v.name === "string" && v.name.trim() ? v.name : standardName(pfad),
      pfad,
      farbe: typeof v.farbe === "string" && /^#[0-9a-f]{6}$/i.test(v.farbe) ? v.farbe : PALETTE[vaults.length % PALETTE.length],
    });
  }
  const aktiv = typeof wurzel.aktiv === "string" && !wurzel.aktiv.includes("\0") && isAbsolute(wurzel.aktiv) ? resolve(wurzel.aktiv) : null;
  return { zustand: "ok", liste: { vaults, aktiv } };
}

// Der Vault aus der alten config.json der App ({"vault":"<pfad>"}) — nur wenn der Ordner noch da ist.
function altVault(o) {
  try {
    const c = JSON.parse(readFileSync(join(o.support, "config.json"), "utf8"));
    const v = c && typeof c.vault === "string" ? c.vault.trim() : "";
    if (!v || v.includes("\0") || !isAbsolute(v) || !istOrdner(v)) return null;
    return { pfad: realpathSync.native(v), name: standardName(v) };
  } catch { return null; }
}

// Liste lesen. Fehlt vaults.json (oder ist sie defekt), gilt der Vault der alten config.json. Nur bei „fehlt“ und nur wenn
// gewünscht wird die Übernahme gespeichert; eine defekte Datei wird beim Lesen nie überschreiben.
function ladeListe(o, uebernahmeSpeichern) {
  const r = leseDatei(o);
  if (r.zustand === "ok") return { zustand: "ok", liste: r.liste };
  const alt = altVault(o);
  const liste = alt ? { vaults: [{ name: alt.name, pfad: alt.pfad, farbe: PALETTE[0] }], aktiv: alt.pfad } : { vaults: [], aktiv: null };
  if (alt && r.zustand === "fehlt" && uebernahmeSpeichern) { try { schreibeListe(o, liste, "fehlt"); } catch { /* bleibt im Speicher */ } }
  return { zustand: r.zustand, liste };
}

// Atomar: Temp-Datei im selben Ordner + rename. Eine defekte Datei wird vorher als vaults.json.defekt gesichert.
function schreibeListe(o, liste, zustand) {
  const ziel = join(o.support, "vaults.json");
  mkdirSync(o.support, { recursive: true });
  if (zustand === "defekt") copyFileSync(ziel, ziel + ".defekt");
  const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const inhalt = JSON.stringify({ vaults: liste.vaults.map(({ name, pfad, farbe }) => ({ name, pfad, farbe })), aktiv: liste.aktiv ?? null }, null, 2) + "\n";
  try { writeFileSync(tmp, inhalt); renameSync(tmp, ziel); }
  catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
}
function speichere(o, liste, zustand) {
  try { schreibeListe(o, liste, zustand); }
  catch (e) { throw new HttpFehler(500, "Die Liste der Vaults konnte nicht gespeichert werden.", { ausgabe: String((e && e.code) || (e && e.message) || e) }); }
}

const kopie = (liste) => ({ vaults: liste.vaults.map((v) => ({ ...v })), aktiv: liste.aktiv ?? null });

export function leseVaults(opt = {}) {
  return kopie(ladeListe(optionen(opt), true).liste);
}

// Pfad des aktiven Vaults, nur wenn der Ordner existiert. Wirft nie (der MCP-Server verlässt sich darauf).
export function aktiverVaultPfad(opt = {}) {
  try {
    const { aktiv } = ladeListe(optionen(opt), true).liste;
    return aktiv && istOrdner(aktiv) ? aktiv : null;
  } catch { return null; }
}

function naechsteFarbe(vaults) {
  const zaehl = new Map(PALETTE.map((f) => [f, 0]));
  for (const v of vaults) {
    const f = PALETTE.find((x) => x.toLowerCase() === String(v.farbe).toLowerCase());
    if (f) zaehl.set(f, zaehl.get(f) + 1);
  }
  let beste = PALETTE[0];
  for (const f of PALETTE) if (zaehl.get(f) < zaehl.get(beste)) beste = f;
  return beste;
}

const findeIndex = (liste, p) => liste.vaults.findIndex((v) => istGleich(v.pfad, p) || istGleich(versuchEchter(v.pfad), p));

// Fügt ein (idempotent über den aufgelösten Pfad). Der Name ändert sich nur, wenn einer übergeben wurde.
function fuegeEin(liste, p, name) {
  const i = findeIndex(liste, p);
  if (i >= 0) {
    const e = liste.vaults[i];
    if (name !== undefined && e.name !== name) { e.name = name; return { eintrag: e, geaendert: true }; }
    return { eintrag: e, geaendert: false };
  }
  const eintrag = { name: name ?? standardName(p), pfad: p, farbe: naechsteFarbe(liste.vaults) };
  liste.vaults.push(eintrag);
  return { eintrag, geaendert: true };
}

// → { eintrag, liste }. Prüft die Pfadregeln, macht den Vault NICHT aktiv. Der Ordner muss (noch) nicht existieren.
export function registriere(pfad, nameUndOptionen) {
  const { name, ...opt } = objekt(nameUndOptionen);
  const o = optionen(opt);
  const wunsch = pruefeName(name);
  const { liste, zustand } = ladeListe(o, false);
  const p = pruefeVaultPfad(pfad, { vaults: liste.vaults, ...o });
  const { eintrag, geaendert } = fuegeEin(liste, p, wunsch);
  if (geaendert) speichere(o, liste, zustand);
  return { eintrag: { ...eintrag }, liste: kopie(liste) };
}

// Findet einen registrierten Vault zu einer Eingabe (geschrieben, mit ~, relativ zu Symlinks aufgelöst) → Index oder 404.
function finde(liste, pfad, o) {
  if (typeof pfad !== "string" || !pfad.trim()) throw new HttpFehler(400, "Bitte einen Vault angeben.");
  let p = pfad.trim();
  if (p === "~" || p.startsWith("~/")) p = join(o.home, p.slice(1));
  const kandidaten = [];
  if (isAbsolute(p) && !p.includes("\0")) { const r = resolve(p); kandidaten.push(r, versuchEchter(r)); }
  const i = liste.vaults.findIndex((v) => { const formen = [v.pfad, versuchEchter(v.pfad)]; return kandidaten.some((k) => formen.some((f) => istGleich(k, f))); });
  if (i < 0) throw new HttpFehler(404, "Dieser Vault steht nicht in der Liste.");
  return i;
}

export function waehleAktiv(pfad, opt = {}) {
  const o = optionen(opt);
  const { liste, zustand } = ladeListe(o, false);
  const v = liste.vaults[finde(liste, pfad, o)];
  if (!istOrdner(v.pfad)) throw new HttpFehler(409, "Der Ordner ist nicht mehr da", { hinweis: "Entferne den Vault aus der Liste oder stelle den Ordner wieder her." });
  liste.aktiv = v.pfad;
  speichere(o, liste, zustand);
  return kopie(liste);
}

// Nur aus der Liste — Dateien bleiben unangetastet. War er aktiv, wird der erste verbleibende aktiv (sonst keiner).
export function entferne(pfad, opt = {}) {
  const o = optionen(opt);
  const { liste, zustand } = ladeListe(o, false);
  const [weg] = liste.vaults.splice(finde(liste, pfad, o), 1);
  if (liste.aktiv && (istGleich(liste.aktiv, weg.pfad) || istGleich(liste.aktiv, versuchEchter(weg.pfad)))) {
    liste.aktiv = liste.vaults.length ? liste.vaults[0].pfad : null;
  }
  speichere(o, liste, zustand);
  return kopie(liste);
}

// Registrieren und aktiv setzen in einem Schreibvorgang (liest die Liste frisch; kein await dazwischen).
function registriereAktiv(o, pfad, name) {
  const { liste, zustand } = ladeListe(o, false);
  const p = pruefeVaultPfad(pfad, { vaults: liste.vaults, ...o });
  const { eintrag } = fuegeEin(liste, p, name);
  liste.aktiv = eintrag.pfad;
  speichere(o, liste, zustand);
  return { eintrag: { ...eintrag }, liste: kopie(liste) };
}
const ergebnis = ({ eintrag, liste }, git) => ({ vault: { name: eintrag.name, pfad: eintrag.pfad, farbe: eintrag.farbe, git }, git, liste });

// ---------- Anlegen, Öffnen, Klonen ----------

// Pro Ordner läuft nur ein Vorgang gleichzeitig (Doppelklick auf „Erstellen“). Wird synchron beim Aufruf genommen.
const belegt = new Set();
async function mitSperre(pfad, fn) {
  const k = teile(pfad).join("/");
  if (belegt.has(k)) throw new HttpFehler(409, "In diesem Ordner läuft gerade schon etwas. Bitte einen Moment warten.");
  belegt.add(k);
  try { return await fn(); } finally { belegt.delete(k); }
}

// Zielordner für ein neues Vault: leer (nur .DS_Store) oder neu. → was wir vorgefunden/angelegt haben (für das Aufräumen).
function bereiteZiel(pfad) {
  const vorhanden = () => {
    if (readdirSync(pfad).some((n) => n !== ".DS_Store")) throw new HttpFehler(409, MELDUNG_NICHT_LEER);
    return { pfad, vorherDa: true, erstAngelegt: null };
  };
  if (gibtEs(pfad)) return vorhanden();
  const erst = mkdirSync(pfad, { recursive: true }); // der oberste Ordner, den dieser Aufruf wirklich angelegt hat
  return erst ? { pfad, vorherDa: false, erstAngelegt: erst } : vorhanden(); // undefined: jemand war schneller
}

// Nimmt zurück, was dieser Aufruf angelegt hat: neue Ordner samt Inhalt, bei einem vorher leeren Ordner nur den Inhalt.
function raeumeAuf(z) {
  try {
    if (z.erstAngelegt) {
      const segs = teile(z.erstAngelegt).length;
      if (segs >= 2 && istUnterOderGleich(z.pfad, z.erstAngelegt)) loesche(z.erstAngelegt);
    } else if (!z.vorherDa) loesche(z.pfad);
    else for (const n of readdirSync(z.pfad)) if (n !== ".DS_Store") loesche(join(z.pfad, n));
  } catch { /* beste Mühe */ }
}

async function gitOk(cwd, args, meldung) {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new HttpFehler(500, meldung, { ausgabe: kuerze(r.stdout + r.stderr) });
  return r;
}
// Eigene Commits beim Anlegen laufen ohne Hooks und ohne Signierzwang aus der Git-Einstellung des Nutzers.
const COMMIT = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-q"];
const imBloecken = (liste, n = 400) => { const b = []; for (let i = 0; i < liste.length; i += n) b.push(liste.slice(i, i + n)); return b; };

async function starteRepo(pfad, dateien, nachricht) {
  await gitOk(pfad, ["init", "-q", "-b", "main"], "Der Versionsverlauf (Git) konnte nicht angelegt werden.");
  await sorgeFuerIdentitaet(pfad);
  // --force: das sind genau unsere Gerüstdateien; eine globale Ignore-Datei des Nutzers (manche ignorieren CLAUDE.md) darf sie nicht ausschließen
  for (const block of imBloecken(dateien)) await gitOk(pfad, ["add", "--force", "--", ...block], "Die Dateien konnten nicht für den Versionsverlauf vorgemerkt werden.");
  await gitOk(pfad, [...COMMIT, "-m", nachricht], "Der erste Eintrag im Versionsverlauf konnte nicht angelegt werden.");
}

const zielOrdner = (ordner, o, liste) => pruefeVaultPfad(ordner === undefined || ordner === null ? standardOrdner(o) : ordner, { vaults: liste.vaults, ...o });

// art "vorlage": Brain-Gerüst + git init + erster Commit „Brain angelegt“; art "leer": nur .gitignore + Commit „Vault angelegt“.
export async function neuesVault(eingabe, opt = {}) {
  const { art, name, ordner } = objekt(eingabe);
  const o = optionen(opt);
  if (art !== "vorlage" && art !== "leer") throw new HttpFehler(400, "Bitte „vorlage“ oder „leer“ als Art wählen.");
  const wunsch = pruefeName(name);
  const { liste } = ladeListe(o, false);
  const pfad = zielOrdner(ordner, o, liste);
  const vaultName = wunsch ?? standardName(pfad); // erscheint in den Vorlagetexten
  return mitSperre(pfad, async () => {
    let z;
    try { z = bereiteZiel(pfad); } catch (e) { throw wandleFehler(e); }
    try {
      if (art === "vorlage") {
        const dateien = await legeVorlageAn(pfad, { name: vaultName, heute: o.heute || berlinHeute() });
        await starteRepo(pfad, dateien, "Brain angelegt");
      } else {
        writeFileSync(join(pfad, ".gitignore"), GITIGNORE, { flag: "wx" });
        await starteRepo(pfad, [".gitignore"], "Vault angelegt");
      }
      return ergebnis(registriereAktiv(o, pfad, wunsch), true);
    } catch (e) {
      raeumeAuf(z);
      throw wandleFehler(e, "Der Vault konnte nicht angelegt werden.");
    }
  });
}

// Text-Datei für den ersten Commit beim Einschalten: .md/.txt, keine versteckten Ordner/Dateien, kein node_modules (+ .gitignore).
function istTextPfad(rel) {
  if (rel === ".gitignore") return true;
  const segs = rel.split("/");
  if (segs.some((s) => s.startsWith(".") || falte(s) === "node_modules")) return false;
  return BEARBEITBAR.test(segs[segs.length - 1]);
}

async function schalteGitEin(p) {
  const oben = await git(p, ["rev-parse", "--show-toplevel"]);
  if (oben.code === 0) { // ein Repo, aber nicht dieser Ordner als Wurzel → nie verschachtelt anlegen
    let top = null;
    try { top = realpathSync(oben.stdout.trim()); } catch { /* unbekannt */ }
    if (top && !istGleich(top, p)) throw new HttpFehler(409, "Dieser Ordner liegt schon in einem anderen Git-Repository.");
  }
  if (gibtEs(join(p, ".git"))) throw new HttpFehler(409, "In diesem Ordner liegt ein „.git“, das Git nicht lesen kann. Bitte zuerst reparieren oder entfernen.");
  const ignorieren = join(p, ".gitignore");
  let ignoreAngelegt = false, gitAngelegt = false;
  try {
    if (!gibtEs(ignorieren)) { writeFileSync(ignorieren, GITIGNORE, { flag: "wx" }); ignoreAngelegt = true; }
    gitAngelegt = true; // schon vor dem Aufruf: scheitert git init halb, gehört das Übriggebliebene uns (.git gab es vorher nicht)
    await gitOk(p, ["init", "-q", "-b", "main"], "Der Versionsverlauf (Git) konnte nicht eingeschaltet werden.");
    await sorgeFuerIdentitaet(p);
    // Git sagt, was nicht ignoriert ist (auch .gitignore des Nutzers); davon nehmen wir nur Textdateien, keine Verweise.
    const roh = (await gitOk(p, ["ls-files", "--others", "--exclude-standard", "-z"], "Die Dateien konnten nicht gelesen werden.")).stdout;
    const dateien = roh.split("\0").filter(Boolean).filter(istTextPfad).filter((rel) => { try { return lstatSync(join(p, rel)).isFile(); } catch { return false; } });
    for (const block of imBloecken(dateien)) await gitOk(p, ["add", "--", ...block], "Die Dateien konnten nicht für den Versionsverlauf vorgemerkt werden.");
    const nichts = (await git(p, ["diff", "--cached", "--quiet"])).code === 0;
    await gitOk(p, [...COMMIT, ...(nichts ? ["--allow-empty"] : []), "-m", "Versionsverlauf eingeschaltet"], "Der erste Eintrag im Versionsverlauf konnte nicht angelegt werden.");
  } catch (e) {
    if (gitAngelegt) loesche(join(p, ".git"));
    if (ignoreAngelegt) loesche(ignorieren);
    throw wandleFehler(e, "Der Versionsverlauf konnte nicht eingeschaltet werden.");
  }
}

// Vorhandenen Ordner öffnen: registrieren + aktiv. Ohne gitEinschalten wird nichts angelegt (git:false, wenn kein Repo).
export async function oeffneOrdner(eingabe, opt = {}) {
  const { pfad, gitEinschalten } = objekt(eingabe);
  const o = optionen(opt);
  const { liste } = ladeListe(o, false);
  const p = pruefeVaultPfad(pfad, { vaults: liste.vaults, ...o });
  if (!istOrdner(p)) throw new HttpFehler(404, "Diesen Ordner gibt es nicht (mehr).");
  return mitSperre(p, async () => {
    let istGit = await istRepo(p);
    if (gitEinschalten === true && !istGit) { await schalteGitEin(p); istGit = true; }
    return ergebnis(registriereAktiv(o, p, undefined), istGit);
  });
}

// Von GitHub (oder einem anderen Server) klonen. Nur https/ssh (im Test auch lokale Pfade); Anmeldung macht Git selbst.
export async function klone(eingabe, opt = {}) {
  const { url, ordner, name } = objekt(eingabe);
  const o = optionen(opt);
  const adresse = pruefeGitUrl(url);
  const wunsch = pruefeName(name);
  const { liste } = ladeListe(o, false);
  const ziel = zielOrdner(ordner, o, liste);
  const limit = testmodus() && Number.isFinite(o.limitKlon) ? o.limitKlon : 300_000; // nur im Test kürzer
  return mitSperre(ziel, async () => {
    const z = { pfad: ziel, vorherDa: false, erstAngelegt: null };
    try {
      Object.assign(z, bereiteZiel(ziel)); // neu anlegen (leer) oder einen vorhandenen leeren Ordner nehmen; sonst 409
      if (z.vorherDa) rmSync(join(ziel, ".DS_Store"), { force: true }); // Git klont nicht in einen Ordner mit Inhalt; die Finder-Datei entsteht von selbst neu
    } catch (e) { throw wandleFehler(e); }
    try {
      const protokolle = testmodus() ? ["-c", "protocol.file.allow=always"] : ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always"];
      let r;
      try { r = await git(dirname(ziel), ["-c", "protocol.ext.allow=never", ...protokolle, "clone", "--quiet", "--", adresse, ziel], { timeout: limit }); }
      catch (e) {
        if (e instanceof HttpFehler && e.status === 504) throw new HttpFehler(504, "Das Herunterladen hat zu lange gedauert.");
        throw e;
      }
      if (r.code !== 0) {
        const u = uebersetzeGitFehler(r.stderr, "Das Repository konnte nicht geklont werden.");
        throw new HttpFehler(u.status, u.meldung, { ausgabe: kuerze(r.stderr) });
      }
      await sorgeFuerIdentitaet(ziel); // damit auch der erste eigene Commit in Studio gelingt
      return ergebnis(registriereAktiv(o, ziel, wunsch ?? standardName(ziel, true)), true);
    } catch (e) {
      raeumeAuf(z);
      throw wandleFehler(e, "Das Repository konnte nicht geklont werden.");
    }
  });
}
