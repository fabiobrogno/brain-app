// gemeinsam/vaults.mjs — Vault-Verwaltung für Brain Studio v2 (Spec v2 §2): die Liste der Vaults, die Pfadregeln und
// die vier Wege zu einem Vault (neu aus Vorlage, neu leer, vorhandenen Ordner öffnen, von GitHub klonen).
// Reines Modul ohne Routen — die Werkstatt verdrahtet es. Prozesse nur über den git()-Helfer (execFile, keine Shell).
//
// Alle Funktionen nehmen als letztes Argument `opt`: support (Standard supportOrdner()), home (Standard os.homedir()) und
// heute ("JJJJ-MM-TT", für Tests). Sie werden bei JEDEM Aufruf frisch gelesen — nie als Modul-Konstante.
// Nur für Tests: frist (ms, Gesamtfrist je Vorgang; beim Klonen auch limitKlon) und jetzt (Zeitpunkt für den Namen der Sicherung).
//
// LESEREGEL für <support>/vaults.json — gilt für dieses Modul UND für Swift (VaultListe.swift liest dieselbe Datei):
//  1. Zustand: „fehlt“ (gibt es nicht) · „defekt“ (nicht lesbar, kein JSON-Objekt, oder „vaults“ ist da, aber kein Array) · sonst
//     „ok“ (auch {} und {"vaults":[]}: leere Liste). Bei „fehlt“/„defekt“ gilt der Vault der alten config.json (nur wenn sein Ordner
//     existiert und die Ortsregeln ihn erlauben), sonst eine leere Liste ohne aktiven Vault. Beim Lesen wird eine defekte Datei nie
//     überschrieben (nur bei „fehlt“ wird die Übernahme der config.json gespeichert).
//  2. Ein Eintrag zählt nur, wenn er ein Objekt mit Text „pfad“ ist: absolut („/…“), ohne NUL-Zeichen, und die Ortsregeln von
//     pruefeRegeln ihn erlauben (Spec §5a „Pfadregeln“: nicht /, /Users, /Volumes, nicht das Home selbst, kein Systemordner und kein
//     Vorfahr davon, nicht ~/Library außer Mobile Documents/CloudStorage, nicht der App-Ordner, kein „.git“/„node_modules“/„.app“ im
//     Pfad, kein versteckter Ordner unter dem Home) — für die geschriebene Form UND den aufgelösten Pfad (Symlinks). Unbrauchbare
//     Einträge werden übersprungen; in der Datei bleiben sie, bis das nächste Schreiben die Liste neu ausgibt. Ob der Ordner
//     existiert, gehört nicht dazu (ein abgezogener Stick bleibt Eintrag, „vorhanden: false“).
//  3. Einträge für denselben Ordner (gleicher aufgelöster Pfad, ohne Groß/klein und Unicode-Form) zählen einmal: der erste bleibt.
//  4. „aktiv“ gilt nur, wenn es (geschrieben oder aufgelöst) einen der gültigen Einträge meint, und wird zu dessen „pfad“; sonst
//     null. Gespeichert wird ein „aktiv“ ohne vorhandenen Ordner nie (dann null).
//  5. Name fehlt oder ist leer → Ordnername. Ungültige Farbe → nächste Palettenfarbe (nur Node).
// SCHREIBEN: atomar (Temp-Datei + rename). Eine defekte Datei wird vorher nach vaults.json.defekt-<JJJJMMTT-HHMMSS> (Berliner Zeit)
// gesichert, nie überschrieben; die 5 neuesten bleiben. Danach trägt leseVaults() `defekt: true`, solange vaults.json noch die Datei
// ist, die dieser Prozess nach der Sicherung geschrieben hat (Merker im Prozess, an Datei-Identität gebunden: kein weiterer
// Dateityp, den Swift kennen müsste, kein Rest nach einem Neustart oder einer Reparatur von Hand).
import {
  realpathSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, rmdirSync,
} from "node:fs";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { homedir, userInfo } from "node:os";
import { randomBytes } from "node:crypto";
import { HttpFehler, supportOrdner, testmodus, falte, BEARBEITBAR, vorschauOrdner } from "./basis.mjs";
import { git } from "./git.mjs";
import { pruefeGitUrl, uebersetzeGitFehler } from "./gitwerkzeug.mjs";
import { sicherungFuer } from "./sicherung.mjs";
import { sichereDefektenMerker, nutzerGitEinstellungen, erlaube as vertraue } from "./vertrauen.mjs";
import { berlinHeute } from "./pruefung.mjs";
import { legeVorlageAn, GITIGNORE } from "./vorlage.mjs";

export { HttpFehler };

// Feste Palette: ein neuer Vault bekommt die erste unbenutzte Farbe, sind alle vergeben, die am seltensten benutzte.
export const PALETTE = ["#5B8DEF", "#E5734F", "#4FA877", "#B07CD8", "#D9A441", "#3FA7B5", "#D6638A", "#7C8798"];

const MELDUNG_NICHT_LEER = "Der Ordner ist nicht leer. Wähle einen neuen oder leeren Ordner — oder öffne ihn als vorhandenen Ordner.";

// ---------- Kleinigkeiten ----------

function optionen(opt) {
  const o = opt || {};
  return { support: o.support || supportOrdner(), home: o.home || homedir(), heute: o.heute || null, limitKlon: o.limitKlon, frist: o.frist, jetzt: o.jetzt, githubLogin: typeof o.githubLogin === "string" ? o.githubLogin : null };
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
const standardName = (p, ohneGit = false) => [...((ohneGit ? basename(p).replace(/\.git$/i, "") : basename(p)) || "Kortex")].slice(0, 80).join("");

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
  if (istGleich(p, home)) verbot("Dein Benutzerordner selbst ist als Vault zu groß. Lege dafür einen eigenen Ordner an, zum Beispiel „Kortex“.");
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

// Vorschau („wie frisch installiert“): Vaults liegen nur im Vorschau-Ordner — auch ein Ordner, den der Nutzer im Dialog wählt, darf nicht
// aus ihm herausführen (sonst legte die Vorschau Dateien in seine echten Ordner).
function pruefeVorschauOrt(lex, echt) {
  const vo = vorschauOrdner();
  if (!vo) return;
  const formen = [vo, versuchEchter(vo)];
  const drin = (p) => formen.some((f) => istUnter(p, f));
  if (!drin(lex) || !drin(echt)) throw new HttpFehler(403, "In der Vorschau kann nur im Vorschau-Ordner gearbeitet werden. Wähle einen Ordner darin (der vorgeschlagene Ort passt).");
}

// ---------- Zu breite Ordner ----------

// Ordner, in denen ein Vault nicht selbst liegen soll, sondern in einem eigenen Unterordner: Kortex würde sonst alles darin als Notizen
// behandeln und versionieren. Die Regel gilt NUR beim Anlegen, Öffnen und Klonen (nicht beim Lesen von vaults.json: ein älterer Eintrag
// darf weiter geöffnet und entfernt werden). Swift prüft dieselben Orte vorab (VaultAuswahl.breiterOrt) — beide Listen müssen gleich bleiben.
// [Ordnername im Home, Anzeigename im deutschen Finder]
export const BREITE_ORDNER = [
  ["Desktop", "Schreibtisch"], ["Documents", "Dokumente"], ["Downloads", "Downloads"], ["Pictures", "Bilder"],
  ["Movies", "Filme"], ["Music", "Musik"], ["Public", "Öffentlich"], ["Applications", "Programme"],
];

// → null (in Ordnung) oder { name, vorschlag }: der zu breite Ort und ein Unterordner, der stattdessen passt.
function breiterOrt(p, home) {
  const bei = (rel) => istGleich(p, join(home, ...rel));
  for (const [ordner, anzeige] of BREITE_ORDNER) if (bei([ordner])) return { name: anzeige, vorschlag: join(home, ordner, "Kortex") };
  const lib = ["Library"];
  if (bei([...lib, "Mobile Documents"]) || bei([...lib, "Mobile Documents", "com~apple~CloudDocs"])) {
    return { name: "iCloud Drive", vorschlag: join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Kortex") };
  }
  if (bei([...lib, "CloudStorage"])) return { name: "Cloud-Speicher", vorschlag: null };
  // direkte Unterordner von CloudStorage sind die Wurzeln der Anbieter (Dropbox, Google Drive, OneDrive …)
  const cs = join(home, "Library", "CloudStorage");
  if (istUnter(p, cs) && teile(p).length === teile(cs).length + 1) return { name: basename(p), vorschlag: join(p, "Kortex") };
  return null;
}

function pruefeBreit(lex, echt, o) {
  const homes = [resolve(o.home), versuchEchter(resolve(o.home))];
  for (const [p, h] of [[lex, homes[0]], [echt, homes[1]]]) {
    const b = breiterOrt(p, h);
    if (!b) continue;
    const wohin = b.vorschlag ? ` Lege darin einen eigenen Ordner an, zum Beispiel „${basename(b.vorschlag)}“ (${b.vorschlag.replace(h, "~")}).` : " Lege darin einen eigenen Ordner an.";
    throw new HttpFehler(403, `„${b.name}“ ist als Vault zu groß: Kortex würde alles darin als Notizen behandeln.${wohin}`, { art: "zu-breit", vorschlag: b.vorschlag });
  }
}

// → bereinigter absoluter Pfad (Symlinks aufgelöst) oder HttpFehler 400/403/409. Legt nichts an, ändert nichts.
export function pruefeVaultPfad(pfad, optionenUndListe) {
  const { vaults, breit, ...opt } = objekt(optionenUndListe);
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
  if (breit === true) pruefeBreit(lex, echt, o); // nur beim Anlegen, Öffnen, Klonen
  pruefeVorschauOrt(lex, echt);

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
  const basis = join(o.home, "Kortex");
  for (let n = 1; n < 1000; n++) {
    const p = n === 1 ? basis : `${basis} ${n}`;
    if (!gibtEs(p)) return p;
  }
  throw new HttpFehler(409, "Es gibt schon zu viele Ordner namens „Kortex“. Bitte wähle selbst einen Ordner.");
}

// ---------- Vertrauen vergessen ----------

// Der Pfad wie geschrieben, nur mit ~ aufgelöst und bereinigt (Symlinks bleiben stehen) — null, wenn er nicht absolut ist.
function lexikalisch(pfad, o) {
  if (typeof pfad !== "string") return null;
  let p = pfad.trim();
  if (p === "~" || p.startsWith("~/")) p = join(o.home, p.slice(1));
  return isAbsolute(p) && !p.includes("\0") ? resolve(p) : null;
}

// Das Vertrauen klebt am Pfad: <support>/vertrauen.json = { "<realpath des Vaults>": { … } } (schreibt das Vertrauensmodul). Ein neuer
// Vault am Ort eines alten (neu angelegt, geklont, nach „Entfernen“ wieder hineingelegt) darf das alte Vertrauen nie erben; vertraut wird er
// erst danach, durch Anlegen oder Klonen hier (angelegt/geklont) oder durch die Frage im Studio. Hier wird nur GELÖSCHT: jeder Schlüssel, der einen der Pfade meint (ohne Groß/klein und Unicode-Form), fällt weg;
// alle anderen Einträge bleiben, geschrieben wird atomar mit Modus 0600.
// Die Datei wird so gelesen wie im Vertrauensmodul: Was dort als „nichts freigegeben“ gilt (leer, „[]“, kein JSON), hat auch hier nichts zu
// vergessen — der Vorgang läuft weiter (eine kaputte Datei schützt nichts und dürfte den Nutzer nicht aussperren). Damit nichts still
// verloren geht, wird sie vorher als vertrauen.json.defekt-<Zeit> gesichert (und beiseite gelegt). Nur ein LESEFEHLER (Rechte, ein Ordner
// statt der Datei …) bricht ab, denn dann könnte der Eintrag später wieder lesbar sein — `folge` sagt, was nicht geschehen ist.
// Gibt es die Datei nicht → nichts zu tun.
function vergissVertrauen(o, pfade, folge) {
  const datei = join(o.support, "vertrauen.json");
  const nichtLesbar = (grund) => new HttpFehler(500, `Die Liste der vertrauten Vaults (Datei vertrauen.json im App-Ordner) lässt sich nicht lesen. ${folge} ` +
    "Prüfe, ob die Datei lesbar ist, oder lösche sie, und versuche es noch einmal — die Vaults müssen dann erneut bestätigt werden.", { ausgabe: grund });
  let text;
  try { text = readFileSync(datei, "utf8"); }
  catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return false;
    throw nichtLesbar(String((e && e.code) || (e && e.message) || e));
  }
  let merker = null;
  try { const j = JSON.parse(text); if (j && typeof j === "object" && !Array.isArray(j)) merker = j; } catch { /* kein JSON */ }
  if (merker === null) {
    try { sichereDefektenMerker(o.support, { jetzt: o.jetzt }); }
    catch (e) {
      throw new HttpFehler(500, `Die kaputte Liste der vertrauten Vaults (Datei vertrauen.json im App-Ordner) ließ sich nicht sichern. ${folge}`, { ausgabe: String((e && e.code) || (e && e.message) || e) });
    }
    return false;
  }
  const formen = pfade.filter((p) => typeof p === "string" && p);
  const weg = Object.keys(merker).filter((k) => formen.some((f) => istGleich(k, f)));
  if (!weg.length) return false;
  for (const k of weg) delete merker[k];
  const tmp = `${datei}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(merker, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, datei); }
  catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* weg */ }
    throw new HttpFehler(500, `Das alte Vertrauen für diesen Ordner konnte nicht zurückgenommen werden. ${folge}`, { ausgabe: String((e && e.code) || (e && e.message) || e) });
  }
  return true;
}

// ---------- Die Liste (vaults.json) ----------

// Dieselben Ortsregeln wie beim Hinzufügen (pruefeRegeln) für die geschriebene und die aufgelöste Form; legt nichts an, wirft nie.
function ortsPruefer(o) {
  let r = null;
  return (lex) => {
    try {
      r ??= (() => { const h = resolve(o.home), s = resolve(o.support); return { h, s, hEcht: versuchEchter(h), sEcht: versuchEchter(s) }; })();
      pruefeRegeln(lex, r.h, r.s);
      pruefeRegeln(versuchEchter(lex), r.hEcht, r.sEcht);
      return true;
    } catch { return false; }
  };
}

// Die gefalteten Formen eines Pfads (geschrieben, aufgelöst) — gleiche Ordner haben mindestens eine Form gemeinsam.
const formenVon = (pfad) => [...new Set([teile(pfad).join("/"), teile(versuchEchter(pfad)).join("/")])];
const teilenForm = (a, b) => a.some((x) => b.includes(x));

// Liest nur — nie schreiben. zustand: "ok" | "fehlt" | "defekt" (Rechte o. Ä. und kaputtes JSON zählen als defekt). Leseregel: siehe Kopf.
function leseDatei(o) {
  let text;
  try { text = readFileSync(join(o.support, "vaults.json"), "utf8"); }
  catch (e) { return { zustand: e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? "fehlt" : "defekt" }; }
  let wurzel;
  try { wurzel = JSON.parse(text); } catch { return { zustand: "defekt" }; }
  if (!wurzel || typeof wurzel !== "object" || Array.isArray(wurzel) || (wurzel.vaults !== undefined && !Array.isArray(wurzel.vaults))) return { zustand: "defekt" };
  const erlaubt = ortsPruefer(o);
  const vaults = [];
  const formen = []; // je übernommenem Eintrag seine Formen (für Doppelte und für aktiv)
  for (const v of wurzel.vaults || []) {
    if (!v || typeof v !== "object" || typeof v.pfad !== "string" || v.pfad.includes("\0") || !isAbsolute(v.pfad)) continue; // kaputte Einträge überspringen
    const pfad = resolve(v.pfad);
    if (!erlaubt(pfad)) continue; // Ort nicht zulässig: überspringen (bleibt in der Datei, bis das nächste Schreiben sie neu ausgibt)
    const f = formenVon(pfad);
    if (formen.some((x) => teilenForm(x, f))) continue; // derselbe Ordner noch einmal
    formen.push(f);
    vaults.push({
      name: typeof v.name === "string" && v.name.trim() ? v.name : standardName(pfad),
      pfad,
      farbe: typeof v.farbe === "string" && /^#[0-9a-f]{6}$/i.test(v.farbe) ? v.farbe : PALETTE[vaults.length % PALETTE.length],
    });
  }
  let aktiv = null; // muss einer der übernommenen Einträge sein und wird zu dessen pfad
  if (typeof wurzel.aktiv === "string" && !wurzel.aktiv.includes("\0") && isAbsolute(wurzel.aktiv)) {
    const f = formenVon(resolve(wurzel.aktiv));
    const i = formen.findIndex((x) => teilenForm(x, f));
    if (i >= 0) aktiv = vaults[i].pfad;
  }
  return { zustand: "ok", liste: { vaults, aktiv } };
}

// Der Vault aus der alten config.json der App ({"vault":"<pfad>"}) — nur wenn der Ordner noch da ist und die Ortsregeln ihn erlauben.
function altVault(o) {
  try {
    const c = JSON.parse(readFileSync(join(o.support, "config.json"), "utf8"));
    const v = c && typeof c.vault === "string" ? c.vault.trim() : "";
    if (!v || v.includes("\0") || !isAbsolute(v) || !istOrdner(v)) return null;
    const pfad = realpathSync.native(v);
    const erlaubt = ortsPruefer(o);
    if (!erlaubt(resolve(v)) || !erlaubt(pfad)) return null;
    return { pfad, name: standardName(v) };
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

// Sicherung einer defekten vaults.json: vaults.json.defekt-<JJJJMMTT-HHMMSS> (Berliner Zeit), nie überschreibend; es bleiben die 5 neuesten.
// Die Namen steigen immer (zweimal in derselben Sekunde → …-2, …-3; nie ein Zeitstempel unter dem neuesten vorhandenen) — Näheres und Code in
// sicherung.mjs (dieselbe Regel gilt für vertrauen.json). Die ältere Einzeldatei vaults.json.defekt wird nicht angefasst.
const LISTEN_SICHERUNG = sicherungFuer("vaults.json");
const sichereDefekte = (o, ziel) => LISTEN_SICHERUNG.sichere(o.support, ziel, { jetzt: o.jetzt });

// Merker „von der defekten Liste gibt es eine Sicherung“: je Support-Ordner die Identität von vaults.json, seit wir gesichert haben —
// erst die der defekten Datei (scheitert das Schreiben danach, ist sie ja noch defekt), nach dem Schreiben die der neuen. Er gilt nur,
// solange vaults.json genau diese Datei ist: jedes weitere Schreiben (auch von Hand oder durch einen anderen Prozess) beendet den
// Hinweis. Im Prozess statt in einer Marker-Datei: kein weiterer Dateityp für Swift, kein Hinweis, der nach einem Neustart oder einer
// Reparatur von Hand hängen bleibt; die Sicherung selbst liegt dauerhaft daneben.
const ersetzt = new Map();
const merkerSchluessel = (o) => (typeof o.support === "string" ? resolve(o.support) : "");
function dateiKennung(ziel) { try { const s = statSync(ziel); return { ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } }
function defektHinweis(o) {
  const k = ersetzt.get(merkerSchluessel(o));
  if (!k) return false;
  const jetztDa = dateiKennung(join(o.support, "vaults.json"));
  if (jetztDa && jetztDa.ino === k.ino && jetztDa.size === k.size && jetztDa.mtimeMs === k.mtimeMs) return true;
  ersetzt.delete(merkerSchluessel(o));
  return false;
}

// Gespeichert wird nie ein aktiv, das nicht zur Liste gehört oder auf einen fehlenden Ordner zeigt (dann null).
function gueltigAktiv(liste) {
  const a = liste.aktiv;
  if (typeof a !== "string" || !a) return null;
  const e = liste.vaults.find((v) => istGleich(v.pfad, a) || istGleich(versuchEchter(v.pfad), versuchEchter(a)));
  return e && istOrdner(e.pfad) ? e.pfad : null;
}

// Atomar: Temp-Datei im selben Ordner + rename. Eine defekte Datei wird vorher gesichert (siehe oben), nie überschrieben.
function schreibeListe(o, liste, zustand) {
  const ziel = join(o.support, "vaults.json");
  mkdirSync(o.support, { recursive: true });
  liste.aktiv = gueltigAktiv(liste);
  if (zustand === "defekt") { // scheitert die Sicherung, wird nichts geschrieben
    sichereDefekte(o, ziel);
    const defekteDatei = dateiKennung(ziel);
    if (defekteDatei) ersetzt.set(merkerSchluessel(o), defekteDatei);
  }
  const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const inhalt = JSON.stringify({ vaults: liste.vaults.map(({ name, pfad, farbe }) => ({ name, pfad, farbe })), aktiv: liste.aktiv ?? null }, null, 2) + "\n";
  try { writeFileSync(tmp, inhalt); renameSync(tmp, ziel); }
  catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
  const kennung = zustand === "defekt" ? dateiKennung(ziel) : null;
  if (kennung) ersetzt.set(merkerSchluessel(o), kennung); else ersetzt.delete(merkerSchluessel(o));
}
function speichere(o, liste, zustand) {
  try { schreibeListe(o, liste, zustand); }
  catch (e) { throw new HttpFehler(500, "Die Liste der Vaults konnte nicht gespeichert werden.", { ausgabe: String((e && e.code) || (e && e.message) || e) }); }
}

const kopie = (liste) => ({ vaults: liste.vaults.map((v) => ({ ...v })), aktiv: liste.aktiv ?? null });

// { vaults, aktiv } — dazu `defekt: true`, wenn dieser Prozess eine defekte vaults.json ersetzt hat und die Datei seither unverändert ist
// (die alte Liste liegt dann als vaults.json.defekt-… im App-Ordner; die Oberfläche soll das melden).
export function leseVaults(opt = {}) {
  const o = optionen(opt);
  const liste = kopie(ladeListe(o, true).liste);
  if (defektHinweis(o)) liste.defekt = true;
  return liste;
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

// Nur aus der Liste — Dateien bleiben unangetastet. War er aktiv, wird der erste verbleibende aktiv, dessen Ordner es gibt (sonst keiner).
// Das Vertrauen für den Ordner wird vorher zurückgenommen; geht das nicht, bleibt alles wie es war.
export function entferne(pfad, opt = {}) {
  const o = optionen(opt);
  const { liste, zustand } = ladeListe(o, false);
  const i = finde(liste, pfad, o);
  const weg = liste.vaults[i];
  vergissVertrauen(o, [weg.pfad, versuchEchter(weg.pfad), lexikalisch(pfad, o)], "Der Vault wurde nicht aus der Liste genommen.");
  liste.vaults.splice(i, 1);
  if (liste.aktiv && (istGleich(liste.aktiv, weg.pfad) || istGleich(liste.aktiv, versuchEchter(weg.pfad)))) {
    const naechster = liste.vaults.find((v) => istOrdner(v.pfad));
    liste.aktiv = naechster ? naechster.pfad : null;
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

// Nimmt zurück, was dieser Aufruf angelegt hat: das Ziel samt Inhalt; hat der Aufruf auch Elternordner angelegt, danach nur noch LEERE
// Elternordner (rmdir) bis hinauf zum obersten, den er angelegt hat — ein Ordner, in dem inzwischen etwas anderes liegt (ein zweites
// Vault, eine Notiz des Nutzers), bleibt samt Inhalt. Bei einem vorher leeren Ordner nur der Inhalt.
function raeumeAuf(z) {
  try {
    if (z.erstAngelegt) {
      loesche(z.pfad);
      if (teile(z.erstAngelegt).length >= 2) { // nie ein Ordner der obersten Ebene
        let ordner = dirname(z.pfad);
        while (istUnterOderGleich(ordner, z.erstAngelegt)) {
          try { rmdirSync(ordner); } catch { break; } // nicht leer (oder schon weg): hier ist Schluss
          if (istGleich(ordner, z.erstAngelegt)) break;
          ordner = dirname(ordner);
        }
      }
    } else if (!z.vorherDa) loesche(z.pfad);
    else for (const n of readdirSync(z.pfad)) if (n !== ".DS_Store") loesche(join(z.pfad, n));
  } catch { /* beste Mühe */ }
}

// Laufende Vorgänge (Anlegen, Klonen, Git einschalten) und was jeder davon bisher im Dateisystem angelegt hat. Beendet sich die Werkstatt
// mitten darin (SIGTERM, die App wird beendet), läuft der catch der Wege nie mehr — dann nähme niemand zurück, was schon da ist (ein
// halbes ~/Brain, ein .git ohne Commit im Ordner des Nutzers). beendeVorgaenge() erledigt das synchron, nach beendeAlleProzesse().
const vorgaenge = new Set();
const merkeVorgang = (zuruecknehmen) => { const e = { zuruecknehmen }; vorgaenge.add(e); return () => vorgaenge.delete(e); }; // → „fertig“
export function beendeVorgaenge() {
  const offen = [...vorgaenge];
  vorgaenge.clear();
  for (const e of offen) { try { e.zuruecknehmen(); } catch { /* beste Mühe */ } }
  return offen.length;
}

// Gesamtfrist je Vorgang (Spec §8): neu anlegen, Ordner öffnen (mit Git einschalten) und klonen dürfen zusammen höchstens 300 s dauern —
// nicht je Git-Aufruf. Jeder Aufruf bekommt nur das, was vom Budget übrig ist; ist es aufgebraucht, startet keiner mehr.
const FRIST_MS = 300_000;
const neueFrist = (gesamt) => { const ende = Date.now() + gesamt; return { rest: () => ende - Date.now() }; };
// Nur im Test kürzer: opt.frist für alle Wege, opt.limitKlon nur fürs Klonen.
const gesamtfrist = (o, nurDieserWeg) => (testmodus() ? [nurDieserWeg, o.frist].find((x) => Number.isFinite(x) && x > 0) : undefined) ?? FRIST_MS;

// Ein Git-Aufruf mit dem Restbudget. Läuft es im Aufruf ab, beendet git() den Kindprozess (SIGKILL); ist es schon aufgebraucht,
// wird gar nichts mehr gestartet. Beides → HttpFehler 504; die Wege nehmen zurück, was sie angelegt haben, und übersetzen ihn (zeitFehler).
async function gitMit(frist, cwd, args, extra = {}) {
  const rest = frist.rest();
  if (rest < 1) throw new HttpFehler(504, "Die Frist ist abgelaufen.");
  return git(cwd, args, { timeout: Math.ceil(rest), ...extra });
}
async function gitOk(frist, cwd, args, meldung) {
  const r = await gitMit(frist, cwd, args);
  if (r.code !== 0) throw new HttpFehler(500, meldung, { ausgabe: kuerze(r.stdout + r.stderr) });
  return r;
}
const zeitFehler = (e, meldung) => (e instanceof HttpFehler && e.status === 504 ? new HttpFehler(504, meldung) : e);
const ZEIT_NEU = "Das Anlegen hat zu lange gedauert und wurde abgebrochen. Es wurde nichts angelegt und nichts in die Liste eingetragen — bitte später noch einmal versuchen.";
const ZEIT_EINSCHALTEN = "Das Einschalten des Versionsverlaufs hat zu lange gedauert und wurde abgebrochen. Dein Ordner ist unverändert und nicht in der Liste eingetragen — bitte später noch einmal versuchen.";
const ZEIT_GIT = "Git hat nicht rechtzeitig geantwortet. Es wurde nichts verändert und nichts in die Liste eingetragen — bitte später noch einmal versuchen.";
const ZEIT_KLONEN = "Das Herunterladen hat zu lange gedauert. Es wurde nichts angelegt und nichts in die Liste eingetragen — bitte später noch einmal versuchen.";

// Wie gitwerkzeug.sorgeFuerIdentitaet — nimmt kein Zeitlimit je Aufruf, hier muss aber jeder Aufruf mit dem Restbudget laufen (und bei Ablauf
// wirklich beendet werden).
// Fehlt user.name/user.email überall (system/global/lokal), wird sie NUR in diesem Repo gesetzt: Mac-Benutzername und <name>@localhost.
async function sorgeFuerIdentitaetMit(frist, wurzel) {
  const lies = async (k) => { const r = await gitMit(frist, wurzel, ["config", "--get", k]); return r.code === 0 ? r.stdout.trim() : ""; };
  const [n, e] = [await lies("user.name"), await lies("user.email")];
  if (n && e) return;
  let konto = "brain";
  try { konto = userInfo().username || konto; } catch { /* Standardname */ }
  if (!n) await gitMit(frist, wurzel, ["config", "user.name", konto]);
  if (!e) await gitMit(frist, wurzel, ["config", "user.email", `${konto}@localhost`]);
}

// Eigene Commits beim Anlegen laufen ohne Hooks und ohne Signierzwang aus der Git-Einstellung des Nutzers.
const COMMIT = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-q"];
const imBloecken = (liste, n = 400) => { const b = []; for (let i = 0; i < liste.length; i += n) b.push(liste.slice(i, i + n)); return b; };

async function starteRepo(pfad, dateien, nachricht, frist) {
  await gitOk(frist, pfad, ["init", "-q", "-b", "main"], "Der Versionsverlauf (Git) konnte nicht angelegt werden.");
  await sorgeFuerIdentitaetMit(frist, pfad);
  // --force: das sind genau unsere Gerüstdateien; eine globale Ignore-Datei des Nutzers (manche ignorieren CLAUDE.md) darf sie nicht ausschließen
  for (const block of imBloecken(dateien)) await gitOk(frist, pfad, ["add", "--force", "--", ...block], "Die Dateien konnten nicht für den Versionsverlauf vorgemerkt werden.");
  await gitOk(frist, pfad, [...COMMIT, "-m", nachricht], "Der erste Eintrag im Versionsverlauf konnte nicht angelegt werden.");
}

// → { pfad: bereinigter Zielpfad (Symlinks aufgelöst), lex: derselbe Pfad wie geschrieben (nur ~ und .. bereinigt) }
const zielOrdner = (ordner, o, liste) => {
  const roh = ordner === undefined || ordner === null ? standardOrdner(o) : ordner;
  return { pfad: pruefeVaultPfad(roh, { vaults: liste.vaults, breit: true, ...o }), lex: lexikalisch(roh, o) };
};

// Workspace-Trust (P5): was Kortex selbst angelegt oder über den Assistenten geklont hat, gilt als vertraut. Misslingt das Schreiben des Merkers,
// ist der Vault trotzdem da — das Studio fragt dann einmal nach („Kommt dieser Vault von dir?“).
function merkeVertrauen(o, pfad, quelle) {
  try { vertraue(pfad, { support: o.support, quelle }); } catch { /* das Studio fragt */ }
}

// Wem gehört das Repository hinter dieser Adresse? Nur github.com-Adressen (https, ssh, scp-Form) haben einen erkennbaren Besitzer: https://github.com/<b>/<repo>,
// ssh://git@github.com/<b>/<repo>, git@github.com:<b>/<repo>. Im Testmodus zählt bei einem lokalen Pfad der Name des Elternordners (…/<b>/<repo>.git). → Kleinschrift oder null.
export function besitzerAusAdresse(adresse) {
  const a = String(adresse || "").trim();
  let m = /^https:\/\/(?:[^/@:]+@)?github\.com(?::\d{1,5})?\/([A-Za-z0-9-]{1,39})\/[^/]+$/i.exec(a)
    || /^ssh:\/\/(?:[A-Za-z0-9._-]+@)?github\.com(?::\d{1,5})?\/([A-Za-z0-9-]{1,39})\/[^/]+$/i.exec(a)
    || /^(?:[A-Za-z0-9._-]+@)?github\.com:([A-Za-z0-9-]{1,39})\/[^/]+$/i.exec(a);
  if (m) return m[1].toLowerCase();
  if (testmodus() && a.startsWith("/")) return basename(dirname(a)).toLowerCase();
  return null;
}
// Ein Klon gilt nur dann als „von dir“ (vertraut), wenn das Repository dem in Kortex angemeldeten GitHub-Konto gehört. Ein fremdes Repository (auch eine Organisation —
// die Mitgliedschaft prüfen wir nicht) bleibt wie ein von außen geöffneter Ordner: das Studio fragt einmal „Kommt dieser Vault von dir?“.
export function istEigenerKlon(adresse, login) {
  const b = besitzerAusAdresse(adresse);
  return !!b && typeof login === "string" && login.toLowerCase() === b;
}

// art "vorlage": Brain-Gerüst + git init + erster Commit „Brain angelegt“; art "leer": nur .gitignore + Commit „Vault angelegt“.
// Gesamtfrist 300 s; läuft sie ab, wird zurückgenommen, was dieser Aufruf angelegt hat (kein Eintrag, kein Wechsel des aktiven Vaults).
export async function neuesVault(eingabe, opt = {}) {
  const { art, name, ordner } = objekt(eingabe);
  const o = optionen(opt);
  if (art !== "vorlage" && art !== "leer") throw new HttpFehler(400, "Bitte „vorlage“ oder „leer“ als Art wählen.");
  const wunsch = pruefeName(name);
  const { liste } = ladeListe(o, false);
  const { pfad, lex } = zielOrdner(ordner, o, liste);
  const vaultName = wunsch ?? standardName(pfad); // erscheint in den Vorlagetexten
  return mitSperre(pfad, async () => {
    const frist = neueFrist(gesamtfrist(o));
    let z;
    try { z = bereiteZiel(pfad); } catch (e) { throw wandleFehler(e); }
    const fertig = merkeVorgang(() => raeumeAuf(z)); // beendet sich die Werkstatt mittendrin, nimmt beendeVorgaenge() es zurück
    try {
      vergissVertrauen(o, [pfad, lex], "Es wurde nichts angelegt."); // der Ort ist neu oder leer: altes Vertrauen für ihn erbt der neue Vault nie
      if (art === "vorlage") {
        const dateien = await legeVorlageAn(pfad, { name: vaultName, heute: o.heute || berlinHeute() });
        await starteRepo(pfad, dateien, "Kortex-Vault angelegt", frist);
      } else {
        writeFileSync(join(pfad, ".gitignore"), GITIGNORE, { flag: "wx" });
        await starteRepo(pfad, [".gitignore"], "Vault angelegt", frist);
      }
      const erg = ergebnis(registriereAktiv(o, pfad, wunsch), true);
      fertig(); // eingetragen: nichts mehr zurückzunehmen (kein await zwischen Eintragen und hier)
      merkeVertrauen(o, pfad, "angelegt");
      return erg;
    } catch (e) {
      raeumeAuf(z);
      fertig();
      throw wandleFehler(zeitFehler(e, ZEIT_NEU), "Der Vault konnte nicht angelegt werden.");
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

// Nur was dieser Aufruf selbst angelegt hat (.git, eine fehlende .gitignore) wird bei jedem Abbruch — auch bei Ablauf der Frist — wieder entfernt.
async function schalteGitEin(p, frist) {
  const oben = await gitMit(frist, p, ["rev-parse", "--show-toplevel"]);
  if (oben.code === 0) { // ein Repo, aber nicht dieser Ordner als Wurzel → nie verschachtelt anlegen
    let top = null;
    try { top = realpathSync(oben.stdout.trim()); } catch { /* unbekannt */ }
    if (top && !istGleich(top, p)) throw new HttpFehler(409, "Dieser Ordner liegt schon in einem anderen Git-Repository.");
  }
  if (gibtEs(join(p, ".git"))) throw new HttpFehler(409, "In diesem Ordner liegt ein „.git“, das Git nicht lesen kann. Bitte zuerst reparieren oder entfernen.");
  const ignorieren = join(p, ".gitignore");
  let ignoreAngelegt = false, gitAngelegt = false;
  const zuruecknehmen = () => { if (gitAngelegt) loesche(join(p, ".git")); if (ignoreAngelegt) loesche(ignorieren); };
  const fertig = merkeVorgang(zuruecknehmen); // beendet sich die Werkstatt mittendrin, nimmt beendeVorgaenge() es zurück
  try {
    if (!gibtEs(ignorieren)) { writeFileSync(ignorieren, GITIGNORE, { flag: "wx" }); ignoreAngelegt = true; }
    gitAngelegt = true; // schon vor dem Aufruf: scheitert git init halb, gehört das Übriggebliebene uns (.git gab es vorher nicht)
    await gitOk(frist, p, ["init", "-q", "-b", "main"], "Der Versionsverlauf (Git) konnte nicht eingeschaltet werden.");
    await sorgeFuerIdentitaetMit(frist, p);
    // Git sagt, was nicht ignoriert ist (auch .gitignore des Nutzers); davon nehmen wir nur Textdateien, keine Verweise.
    const roh = (await gitOk(frist, p, ["ls-files", "--others", "--exclude-standard", "-z"], "Die Dateien konnten nicht gelesen werden.")).stdout;
    const dateien = roh.split("\0").filter(Boolean).filter(istTextPfad).filter((rel) => { try { return lstatSync(join(p, rel)).isFile(); } catch { return false; } });
    for (const block of imBloecken(dateien)) await gitOk(frist, p, ["add", "--", ...block], "Die Dateien konnten nicht für den Versionsverlauf vorgemerkt werden.");
    const nichts = (await gitMit(frist, p, ["diff", "--cached", "--quiet"])).code === 0;
    await gitOk(frist, p, [...COMMIT, ...(nichts ? ["--allow-empty"] : []), "-m", "Versionsverlauf eingeschaltet"], "Der erste Eintrag im Versionsverlauf konnte nicht angelegt werden.");
  } catch (e) {
    zuruecknehmen();
    fertig();
    throw wandleFehler(e, "Der Versionsverlauf konnte nicht eingeschaltet werden.");
  }
  fertig();
}

// Vorhandenen Ordner öffnen: registrieren + aktiv. Ohne Git-Wunsch wird nichts angelegt (git:false, wenn kein Repo).
// Git-Wunsch: gitEinschalten (hat Vorrang) oder „git“ — so hieß das Feld in der älteren Oberfläche. Mit Git-Wunsch gilt die Gesamtfrist 300 s.
export async function oeffneOrdner(eingabe, opt = {}) {
  const e = objekt(eingabe);
  const { pfad } = e;
  const gitWunsch = (e.gitEinschalten !== undefined ? e.gitEinschalten : e.git) === true;
  const o = optionen(opt);
  const { liste } = ladeListe(o, false);
  const p = pruefeVaultPfad(pfad, { vaults: liste.vaults, breit: true, ...o });
  if (!istOrdner(p)) throw new HttpFehler(404, "Diesen Ordner gibt es nicht (mehr).");
  return mitSperre(p, async () => {
    const frist = neueFrist(gesamtfrist(o));
    try {
      // Ein von außen geöffneter Ordner ist (noch) nicht vertraut: kein git, auch kein rev-parse — ob es ein Repository ist, sagt das .git im Ordner.
      // Nur der ausdrückliche Wunsch „Versionsverlauf einschalten“ startet git (gehärtet, ohne Hooks) und nur in einem Ordner ohne .git.
      let istGit = gibtEs(join(p, ".git"));
      if (gitWunsch && !istGit) { await schalteGitEin(p, frist); istGit = true; }
      return ergebnis(registriereAktiv(o, p, undefined), istGit);
    } catch (err) { throw zeitFehler(err, gitWunsch ? ZEIT_EINSCHALTEN : ZEIT_GIT); }
  });
}

// Von GitHub (oder einem anderen Server) klonen. Nur https/ssh (im Test auch lokale Pfade); Anmeldung macht Git selbst.
// Gesamtfrist 300 s für Klonen und Einrichten; läuft sie ab, verschwindet das Ziel wieder.
export async function klone(eingabe, opt = {}) {
  const { url, ordner, name } = objekt(eingabe);
  const o = optionen(opt);
  const adresse = pruefeGitUrl(url);
  const wunsch = pruefeName(name);
  const { liste } = ladeListe(o, false);
  const { pfad: ziel, lex } = zielOrdner(ordner, o, liste);
  return mitSperre(ziel, async () => {
    const frist = neueFrist(gesamtfrist(o, o.limitKlon));
    const z = { pfad: ziel, vorherDa: false, erstAngelegt: null };
    try {
      Object.assign(z, bereiteZiel(ziel)); // neu anlegen (leer) oder einen vorhandenen leeren Ordner nehmen; sonst 409
      if (z.vorherDa) rmSync(join(ziel, ".DS_Store"), { force: true }); // Git klont nicht in einen Ordner mit Inhalt; die Finder-Datei entsteht von selbst neu
    } catch (e) { throw wandleFehler(e); }
    const fertig = merkeVorgang(() => raeumeAuf(z)); // beendet sich die Werkstatt mittendrin, nimmt beendeVorgaenge() es zurück
    try {
      vergissVertrauen(o, [ziel, lex], "Es wurde nichts angelegt."); // der Ort ist neu oder leer: altes Vertrauen für ihn erbt der Klon nie
      const protokolle = testmodus() ? ["-c", "protocol.file.allow=always"] : ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always"];
      // Beim Klonen gibt es noch keine Vault-Konfiguration, die man entschärfen müsste: was der Nutzer selbst für Git eingestellt hat (core.sshCommand,
      // Signierwünsche) gilt unverändert — sonst scheitert ein Klon, der im Terminal klappt (zweites GitHub-Konto mit eigenem Schlüssel).
      const nutzer = nutzerGitEinstellungen();
      const r = await gitMit(frist, dirname(ziel), ["-c", "protocol.ext.allow=never", ...protokolle, "clone", "--quiet", "--", adresse, ziel],
        { sshGlobal: nutzer.sshGlobal, gpgGlobal: nutzer.gpgGlobal, vault: null });
      if (r.code !== 0) {
        const u = uebersetzeGitFehler(r.stderr, "Das Repository konnte nicht geklont werden.");
        throw new HttpFehler(u.status, u.meldung, { ausgabe: kuerze(r.stderr) });
      }
      await sorgeFuerIdentitaetMit(frist, ziel); // damit auch der erste eigene Commit in Studio gelingt
      const erg = ergebnis(registriereAktiv(o, ziel, wunsch ?? standardName(ziel, true)), true);
      fertig(); // eingetragen: nichts mehr zurückzunehmen (kein await zwischen Eintragen und hier)
      if (istEigenerKlon(adresse, o.githubLogin)) merkeVertrauen(o, ziel, "geklont"); // fremde Repositories: das Studio fragt
      return erg;
    } catch (e) {
      raeumeAuf(z);
      fertig();
      throw wandleFehler(zeitFehler(e, ZEIT_KLONEN), "Das Repository konnte nicht geklont werden.");
    }
  });
}
