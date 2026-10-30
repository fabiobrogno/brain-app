// gemeinsam/claude-sperre.mjs — Leseverbot und „Strenger Schutz“ in den Einstellungen eines Claude-Code-Profils (docs/plaene/ki-konten.md, Paket P2, Abschnitt 2b).
//
// Kortex schreibt NUR in <profil>/settings.json und nur diese Stellen:
//   permissions.deny                  Read(//<vault>/**) und Edit(//<vault>/**) für jeden Vault, der für das Konto gesperrt ist (`//` = absoluter Pfad ab Wurzel)
//   sandbox.enabled / .allowUnsandboxedCommands / .failIfUnavailable / .filesystem.denyRead     nur bei „Strenger Schutz“ (Sandbox von Claude Code)
// Welche Einträge von Kortex stammen, steht NICHT in der settings.json (ein Text in einer Liste lässt sich nicht markieren), sondern im Merker ki-konten.json
// (`eingetragen`, siehe werkstatt/konten.mjs). Der Rückweg entfernt genau diese Einträge — fremde Regeln, fremde Pfade und Werte, die der Nutzer inzwischen selbst
// geändert hat, bleiben.
// Schreiben wie install.mjs: JSON wird geparst (kaputt → nichts geändert, 409), die Datei atomar ersetzt (Temp im selben Ordner, Rechte der alten Datei), ein Symlink
// (Dotfiles-Ordner) bleibt ein Symlink — geändert wird sein Ziel — und vorher liegt eine Sicherung `settings.json.bak-<zeit>` daneben.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, renameSync, chmodSync, lstatSync, readlinkSync, realpathSync, statSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { HttpFehler } from "./basis.mjs";

const istObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const MAX_GROESSE = 4 * 1024 * 1024;
export const SANDBOX_SCHALTER = ["enabled", "allowUnsandboxedCommands", "failIfUnavailable"];
export const SANDBOX_SOLL = { enabled: true, allowUnsandboxedCommands: false, failIfUnavailable: true };

// ───────────────────────────── Pfade und Regeln ─────────────────────────────
// Absolute Regelform: `//pfad` (ein einfaches `/pfad` bedeutet in Benutzer-Einstellungen „relativ zum Einstellungsordner“). Zeichen mit Bedeutung in gitignore-Mustern und in
// der Regelschreibweise Tool(...) werden maskiert, damit die Regel nur den wörtlichen Pfad trifft: \ * ? [ ] ( ).
export function regelPfad(p) {
  const s = String(p).replace(/[\\*?[\]()]/g, "\\$&");
  return `//${s.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}
const echt = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
// Die Formen eines Ortes: wie angegeben (aufgelöst zu absolut) und der echte Ort (z. B. /private/var/… statt /var/…). Ohne Duplikate.
export const ortsformen = (...pfade) => [...new Set(pfade.flatMap((p) => (typeof p === "string" && p ? [resolve(p), echt(p)] : [])))];
const pruefePfad = (p) => { if (/[\u0000-\u001f\u007f]/.test(p)) throw new HttpFehler(400, "Der Pfad dieses Vaults enthält Steuerzeichen — Kortex trägt dafür keine Regel ein."); return p; };

// → ["Read(//…/**)", "Edit(//…/**)", …] für jeden Ort des Vaults (in fester Reihenfolge).
export function vaultRegeln(...orte) {
  return ortsformen(...orte).map(pruefePfad).flatMap((o) => [`Read(${regelPfad(o)}/**)`, `Edit(${regelPfad(o)}/**)`]);
}
// → ["/Users/x/Vault", …] für sandbox.filesystem.denyRead (dort ist `/pfad` absolut).
export const sandboxPfade = (...orte) => ortsformen(...orte).map(pruefePfad);

// ───────────────────────────── settings.json lesen und schreiben ─────────────────────────────
const zeitstempel = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
// Ein Symlink bleibt erhalten: geändert wird das Ziel (auch bei einem Link, der ins Leere zeigt).
export function echtesZiel(datei) {
  let p = datei;
  for (let i = 0; i < 20; i++) {
    let l;
    try { l = lstatSync(p); } catch { return p; }
    if (!l.isSymbolicLink()) return p;
    p = resolve(dirname(p), readlinkSync(p));
  }
  throw new HttpFehler(409, "Die Einstellungsdatei von Claude Code ist über zu viele Verweise verschachtelt. Kortex ändert nichts.");
}
const KAPUTT = "Die Einstellungen von Claude Code (settings.json) sind kein gültiges JSON in der erwarteten Form. Kortex ändert nichts daran — bitte zuerst reparieren.";
export function liesSettings(datei) {
  const ziel = echtesZiel(datei);
  let text = null;
  try {
    const st = statSync(ziel);
    if (!st.isFile() || st.size > MAX_GROESSE) throw new HttpFehler(409, KAPUTT);
    text = readFileSync(ziel, "utf8");
  } catch (e) { if (e instanceof HttpFehler) throw e; if (!e || e.code !== "ENOENT") throw new HttpFehler(409, "Die Einstellungen von Claude Code (settings.json) lassen sich nicht lesen. Kortex ändert nichts."); }
  if (text === null) return { text: null, doc: {} };
  let doc;
  try { doc = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new HttpFehler(409, KAPUTT); }
  if (!istObj(doc)) throw new HttpFehler(409, KAPUTT);
  return { text, doc };
}

// Liest, ändert (fn bekommt das Objekt) und schreibt atomar, falls sich etwas ändert. Ändert sich die Datei zwischen Lesen und Schreiben (Claude Code selbst oder install.mjs),
// wird neu gelesen (bis zu 3 Versuche). → true, wenn geschrieben wurde.
export function aendereSettings(profilOrdner, fn) {
  const datei = join(profilOrdner, "settings.json");
  for (let versuch = 0; versuch < 3; versuch++) {
    const { text, doc } = liesSettings(datei);
    const vorher = JSON.stringify(doc);
    fn(doc);
    if (JSON.stringify(doc) === vorher) return false;
    const ziel = echtesZiel(datei);
    mkdirSync(dirname(ziel), { recursive: true });
    let modus = 0o600;
    try { modus = statSync(ziel).mode & 0o777; } catch { /* neue Datei */ }
    const tmp = `${ziel}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: modus, flag: "w" });
      chmodSync(tmp, modus);
      // noch dieselbe Fassung wie beim Lesen?
      let jetzt = null; try { jetzt = readFileSync(ziel, "utf8"); } catch { /* neu */ }
      if (jetzt !== text) { rmSync(tmp, { force: true }); continue; }
      if (existsSync(datei)) { try { copyFileSync(datei, `${datei}.bak-${zeitstempel()}`); } catch { /* ohne Sicherung nicht weitermachen */ rmSync(tmp, { force: true }); throw new HttpFehler(500, "Kortex konnte keine Sicherung der Claude-Einstellungen anlegen und ändert deshalb nichts."); } }
      renameSync(tmp, ziel);
      return true;
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* weg */ }
      if (e instanceof HttpFehler) throw e;
      throw new HttpFehler(500, "Die Einstellungen von Claude Code ließen sich gerade nicht schreiben — es wurde nichts geändert. Bitte versuche es noch einmal.");
    }
  }
  throw new HttpFehler(503, "Die Einstellungen von Claude Code werden gerade von einem anderen Vorgang geändert. Versuche es gleich noch einmal.");
}

// ───────────────────────────── Leseverbot (permissions.deny) ─────────────────────────────
function denyListe(doc, anlegen) {
  if (doc.permissions === undefined) { if (!anlegen) return null; doc.permissions = {}; }
  if (!istObj(doc.permissions)) throw new HttpFehler(409, KAPUTT);
  if (doc.permissions.deny === undefined) { if (!anlegen) return null; doc.permissions.deny = []; }
  if (!Array.isArray(doc.permissions.deny)) throw new HttpFehler(409, KAPUTT);
  return doc.permissions.deny;
}
// Trägt die Regeln ein, die noch fehlen. → { hinzu: [Regeln, die Kortex jetzt eingetragen hat], schonDa: [bereits vorhandene] }
export function regelnVorschau(profilOrdner, regeln) {
  const { doc } = liesSettings(join(profilOrdner, "settings.json"));
  const liste = denyListe(doc, false) || [];
  return { hinzu: regeln.filter((r) => !liste.includes(r)), schonDa: regeln.filter((r) => liste.includes(r)) };
}
export function tragRegelnEin(profilOrdner, regeln) {
  let hinzu = [];
  aendereSettings(profilOrdner, (doc) => {
    const liste = denyListe(doc, true);
    hinzu = regeln.filter((r) => !liste.includes(r));
    liste.push(...hinzu);
  });
  return { hinzu };
}
// Nimmt genau diese Regeln (Text gleich) heraus. Räumt eine dadurch leere Liste auf. → { weg: [Regeln] }
export function nimmRegelnHeraus(profilOrdner, regeln) {
  let weg = [];
  if (!regeln.length) return { weg };
  aendereSettings(profilOrdner, (doc) => {
    const liste = denyListe(doc, false);
    if (!liste) return;
    weg = liste.filter((r) => regeln.includes(r));
    if (!weg.length) return;
    doc.permissions.deny = liste.filter((r) => !regeln.includes(r));
    if (!doc.permissions.deny.length) delete doc.permissions.deny;
    if (!Object.keys(doc.permissions).length) delete doc.permissions;
  });
  return { weg };
}
// Welche der Regeln stehen in der Datei? → { zustand: "ok" | "defekt" | "keine-datei", da: [Regeln] }
export function liesRegelStand(profilOrdner, regeln) {
  try {
    const { text, doc } = liesSettings(join(profilOrdner, "settings.json"));
    if (text === null) return { zustand: "keine-datei", da: [] };
    const liste = denyListe(doc, false) || [];
    return { zustand: "ok", da: regeln.filter((r) => liste.includes(r)) };
  } catch { return { zustand: "defekt", da: [] }; }
}

// ───────────────────────────── Strenger Schutz (sandbox) ─────────────────────────────
function sandboxKnoten(doc, anlegen) {
  if (doc.sandbox === undefined) { if (!anlegen) return null; doc.sandbox = {}; }
  if (!istObj(doc.sandbox)) throw new HttpFehler(409, KAPUTT);
  return doc.sandbox;
}
function denyReadListe(sb, anlegen) {
  if (sb.filesystem === undefined) { if (!anlegen) return null; sb.filesystem = {}; }
  if (!istObj(sb.filesystem)) throw new HttpFehler(409, KAPUTT);
  if (sb.filesystem.denyRead === undefined) { if (!anlegen) return null; sb.filesystem.denyRead = []; }
  if (!Array.isArray(sb.filesystem.denyRead)) throw new HttpFehler(409, KAPUTT);
  return sb.filesystem.denyRead;
}
// Bringt die Sandbox-Einstellungen in den gewünschten Zustand und meldet, was Kortex geändert hat, damit der Rückweg genau das zurücknimmt.
//   frueher: bisher von Kortex Eingetragenes { denyRead: [..], vorher: { <schalter>: { fehlte: true } | { wert } } } oder null
//   soll:    null = Strenger Schutz aus · { denyRead: [Pfade] } = an, mit diesen Pfaden
// → neuer Merker (dasselbe Format) oder null (nichts mehr von Kortex eingetragen)
export function gleicheSandboxAb(profilOrdner, frueher, soll) {
  let neu = null;
  aendereSettings(profilOrdner, (doc) => {
    const sb = sandboxKnoten(doc, soll !== null);
    const alt = frueher && istObj(frueher) ? frueher : { denyRead: [], vorher: {} };
    const vorher = { ...(istObj(alt.vorher) ? alt.vorher : {}) };
    if (soll === null) {
      if (!sb) { neu = null; return; }
      // eigene Pfade heraus, Schalter nur zurück, wenn sie noch so stehen, wie Kortex sie gesetzt hat
      const liste = denyReadListe(sb, false);
      if (liste) {
        sb.filesystem.denyRead = liste.filter((p) => !(alt.denyRead || []).includes(p));
        if (!sb.filesystem.denyRead.length) delete sb.filesystem.denyRead;
        if (!Object.keys(sb.filesystem).length) delete sb.filesystem;
      }
      for (const k of SANDBOX_SCHALTER) {
        if (!Object.hasOwn(vorher, k)) continue;
        if (sb[k] !== SANDBOX_SOLL[k]) continue; // der Nutzer hat es inzwischen selbst geändert: bleibt
        if (vorher[k] && vorher[k].fehlte) delete sb[k]; else if (vorher[k]) sb[k] = vorher[k].wert;
      }
      if (!Object.keys(sb).length) delete doc.sandbox;
      neu = null;
      return;
    }
    for (const k of SANDBOX_SCHALTER) {
      if (!Object.hasOwn(vorher, k)) vorher[k] = Object.hasOwn(sb, k) ? { wert: sb[k] } : { fehlte: true };
      sb[k] = SANDBOX_SOLL[k];
    }
    const liste = denyReadListe(sb, true);
    const eigene = soll.denyRead;
    const behalten = (alt.denyRead || []).filter((p) => eigene.includes(p));
    const stale = (alt.denyRead || []).filter((p) => !eigene.includes(p));
    sb.filesystem.denyRead = liste.filter((p) => !stale.includes(p));
    const hinzu = eigene.filter((p) => !sb.filesystem.denyRead.includes(p));
    sb.filesystem.denyRead.push(...hinzu);
    // Pfade, die schon vorher von jemand anderem eingetragen waren, gehören nicht Kortex (und werden beim Rückweg nicht entfernt)
    neu = { denyRead: [...new Set([...behalten, ...hinzu])], vorher };
  });
  return neu;
}
// Steht Strenger Schutz tatsächlich in der Datei? → { zustand, an, pfade: [aus eigenen Pfaden, die in denyRead stehen] }
export function liesSandboxStand(profilOrdner, eigenePfade = []) {
  try {
    const { text, doc } = liesSettings(join(profilOrdner, "settings.json"));
    if (text === null) return { zustand: "keine-datei", an: false, da: [] };
    const sb = sandboxKnoten(doc, false);
    const an = !!sb && SANDBOX_SCHALTER.every((k) => sb[k] === SANDBOX_SOLL[k]);
    const liste = sb ? denyReadListe(sb, false) || [] : [];
    return { zustand: "ok", an, da: eigenePfade.filter((p) => liste.includes(p)) };
  } catch { return { zustand: "defekt", an: false, da: [] }; }
}
