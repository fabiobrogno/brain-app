// gemeinsam/claude-sperre.mjs — Leseverbot und „Strenger Schutz“ in den Einstellungen eines Claude-Code-Profils (docs/plaene/ki-konten.md, Paket P2, Abschnitt 2b).
//
// Kortex schreibt NUR in <profil>/settings.json und nur diese Stellen:
//   permissions.deny                  Read(//<vault>/**) und Edit(//<vault>/**) für jeden Vault, der für das Konto gesperrt ist (`//` = absoluter Pfad ab Wurzel), dazu die „Einstellungsregeln“
//                                     (einstellungsRegeln): Kortex-Einstellungen und die Einstellungsdateien des Profils ändern/lesen ist verboten, damit eine KI ihre eigene Kennung und die Sperren nicht umschreibt
//   sandbox.enabled / .allowUnsandboxedCommands / .failIfUnavailable / .filesystem.denyRead / .filesystem.denyWrite     nur bei „Strenger Schutz“ (Sandbox von Claude Code)
// Welche Einträge von Kortex stammen, steht NICHT in der settings.json (ein Text in einer Liste lässt sich nicht markieren; ein eigener Schlüssel könnte die Einstellungen für Claude Code ungültig
// machen), sondern im Merker ki-konten.json (`eingetragen`, siehe werkstatt/konten.mjs). Der Rückweg entfernt genau diese Einträge — fremde Regeln, fremde Pfade und Werte, die der Nutzer inzwischen
// selbst geändert hat, bleiben; leere Behälter (permissions, sandbox …) nur, wenn Kortex sie angelegt hat.
// Schreiben wie install.mjs: JSON wird geparst (kaputt → nichts geändert, 409), die Datei atomar ersetzt (Temp „wx“ im selben Ordner, Rechte der alten Datei), ein Symlink (Dotfiles-Ordner) bleibt ein
// Symlink — geändert wird sein Ziel — und vorher liegt eine Sicherung `settings.json.bak-<zeit>-<zufall>` daneben (höchstens eine je Anfrage, siehe eineSicherung).
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, chmodSync, lstatSync, readlinkSync, realpathSync, statSync, rmSync, constants } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { HttpFehler } from "./basis.mjs";

const istObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const MAX_GROESSE = 4 * 1024 * 1024;
export const SANDBOX_SCHALTER = ["enabled", "allowUnsandboxedCommands", "failIfUnavailable"];
export const SANDBOX_SOLL = { enabled: true, allowUnsandboxedCommands: false, failIfUnavailable: true };
export const SANDBOX_LISTEN = ["denyRead", "denyWrite"];

// ───────────────────────────── Pfade und Regeln ─────────────────────────────
// Absolute Regelform: `//pfad` (ein einfaches `/pfad` bedeutet in Benutzer-Einstellungen „relativ zum Einstellungsordner“). Zeichen mit Bedeutung in gitignore-Mustern werden maskiert, damit die Regel
// nur den wörtlichen Pfad trifft: \ * ? [ ]. Klammern ( ) bleiben unmaskiert: die Doku maskiert sie nicht, und ein `\(` würde die Regel auf den falschen Namen richten.
export function regelPfad(p) {
  const s = String(p).replace(/[\\*?[\]]/g, "\\$&");
  return `//${s.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}
const echt = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
// Die Formen eines Ortes: wie angegeben (aufgelöst zu absolut), der echte Ort (z. B. /private/var/… statt /var/…) und jeweils die NFC- und die NFD-Schreibweise, falls sie sich unterscheiden
// (macOS-Dateisysteme speichern Umlaute zerlegt, Programme melden sie zusammengesetzt). Ohne Duplikate.
export const ortsformen = (...pfade) => [...new Set(pfade.flatMap((p) => (typeof p === "string" && p ? [resolve(p), echt(p)] : [])).flatMap((p) => [p, p.normalize("NFC"), p.normalize("NFD")]))];
const pruefePfad = (p) => { if (/[\u0000-\u001f\u007f]/.test(p)) throw new HttpFehler(400, "Der Pfad dieses Vaults enthält Steuerzeichen — Kortex trägt dafür keine Regel ein."); return p; };

// → ["Read(//…/**)", "Edit(//…/**)", …] für jeden Ort des Vaults (in fester Reihenfolge).
export function vaultRegeln(...orte) {
  return ortsformen(...orte).map(pruefePfad).flatMap((o) => [`Read(${regelPfad(o)}/**)`, `Edit(${regelPfad(o)}/**)`]);
}
// → ["/Users/x/Vault", …] für sandbox.filesystem.denyRead/denyWrite (dort ist `/pfad` absolut).
export const sandboxPfade = (...orte) => ortsformen(...orte).map(pruefePfad);

// Die Einstellungsregeln: Eine KI, die die Einstellungen ändern darf, kann ihre Kennung (`--konto`), die Stufen in ki-konten.json und das Leseverbot selbst umschreiben. Darum gehören zum Leseverbot:
//   Edit  Support-Ordner von Kortex · Einstellungsdatei(en) des Profils (settings.json, .claude.json bzw. ~/.claude.json) · Projektdateien .mcp.json und .claude/settings(.local).json (relativ zum Arbeitsordner)
//   Read  Namen und Pfade der Vaults und die Regeln selbst: <support>/vaults.json, <support>/ki-konten.json*, <profil>/settings.json*
// Grenze (steht auch in der Oberfläche): Regeln halten nur die Werkzeuge von Claude Code auf. Eine Shell, die sich nicht in der Sandbox befindet, liest und schreibt trotzdem — dafür gibt es den Strengen Schutz.
export function einstellungsRegeln({ support, profil, home = null, standard = false } = {}) {
  const regeln = [];
  const lang = (orte) => ortsformen(...orte).map(pruefePfad);
  if (support) for (const s of lang([support])) regeln.push(`Edit(${regelPfad(s)}/**)`, `Read(${regelPfad(s)}/vaults.json)`, `Read(${regelPfad(s)}/ki-konten.json*)`);
  if (profil) for (const p of lang([profil])) regeln.push(`Edit(${regelPfad(p)}/settings.json)`, `Read(${regelPfad(p)}/settings.json*)`, `Edit(${regelPfad(p)}/.claude.json)`);
  if (standard && home) for (const h of lang([home])) regeln.push(`Edit(${regelPfad(h)}/.claude.json)`);
  regeln.push("Edit(**/.mcp.json)", "Edit(**/.claude/settings.json)", "Edit(**/.claude/settings.local.json)");
  return [...new Set(regeln)];
}
// Pfade für die Sandbox: nicht lesbar = Vaults-Liste, Kortex-Liste, Einstellungen des Profils; nicht beschreibbar = Support-Ordner, Profilordner, ~/.claude.json (Standardprofil).
export function sandboxGeheim({ support, profil } = {}) {
  const l = [];
  if (support) for (const s of ortsformen(support).map(pruefePfad)) l.push(`${s}/vaults.json`, `${s}/ki-konten.json`, `${s}/ki-konten.json.vorher`);
  if (profil) for (const p of ortsformen(profil).map(pruefePfad)) l.push(`${p}/settings.json`);
  return [...new Set(l)];
}
export function sandboxSchreibschutz({ support, profil, home = null, standard = false } = {}) {
  const l = [];
  if (support) l.push(...sandboxPfade(support));
  if (profil) l.push(...sandboxPfade(profil));
  if (standard && home) for (const h of ortsformen(home).map(pruefePfad)) l.push(`${h}/.claude.json`);
  return [...new Set(l)];
}

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
  try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new HttpFehler(409, KAPUTT); }
  if (!istObj(doc)) throw new HttpFehler(409, KAPUTT);
  return { text, doc };
}

// Höchstens eine Sicherung je Anfrage: Wer mehrere Änderungen in einer Anfrage macht (Regeln, Einstellungsregeln, Sandbox), ruft sie in eineSicherung(() => …) auf — die erste legt die Sicherung an,
// die übrigen nicht (sie wäre sonst schon die geänderte Fassung). Synchron, darum reicht ein Merker des gerade laufenden Aufrufs.
let anfrage = null;
export function eineSicherung(fn) {
  if (anfrage) return fn();
  anfrage = new Set();
  try { return fn(); } finally { anfrage = null; }
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
    const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: modus, flag: "wx" });
      chmodSync(tmp, modus);
      // noch dieselbe Fassung wie beim Lesen?
      let jetzt = null; try { jetzt = readFileSync(ziel, "utf8"); } catch { /* neu */ }
      if (jetzt !== text) { rmSync(tmp, { force: true }); continue; }
      if (text !== null && !(anfrage && anfrage.has(datei))) {
        // „wx“-artig: nie eine vorhandene Sicherung überschreiben (Zeit + Zufall im Namen, COPYFILE_EXCL)
        const bak = `${datei}.bak-${zeitstempel()}-${randomBytes(3).toString("hex")}`;
        try { copyFileSync(datei, bak, constants.COPYFILE_EXCL); chmodSync(bak, 0o600); }
        catch { rmSync(tmp, { force: true }); throw new HttpFehler(500, "Kortex konnte keine Sicherung der Claude-Einstellungen anlegen und ändert deshalb nichts."); }
        if (anfrage) anfrage.add(datei);
      }
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
function denyListe(doc, anlegen, angelegt) {
  if (doc.permissions === undefined) { if (!anlegen) return null; doc.permissions = {}; angelegt?.push("permissions"); }
  if (!istObj(doc.permissions)) throw new HttpFehler(409, KAPUTT);
  if (doc.permissions.deny === undefined) { if (!anlegen) return null; doc.permissions.deny = []; angelegt?.push("deny"); }
  if (!Array.isArray(doc.permissions.deny)) throw new HttpFehler(409, KAPUTT);
  return doc.permissions.deny;
}
// Trägt die Regeln ein, die noch fehlen. → { hinzu: [Regeln, die Kortex jetzt eingetragen hat], angelegt: ["permissions" | "deny" — Behälter, die Kortex neu angelegt hat] }
export function regelnVorschau(profilOrdner, regeln) {
  const { doc } = liesSettings(join(profilOrdner, "settings.json"));
  const liste = denyListe(doc, false) || [];
  return { hinzu: regeln.filter((r) => !liste.includes(r)), schonDa: regeln.filter((r) => liste.includes(r)) };
}
export function tragRegelnEin(profilOrdner, regeln) {
  let hinzu = [], angelegt = [];
  aendereSettings(profilOrdner, (doc) => {
    hinzu = []; angelegt = [];
    const fehlen = regeln.filter((r) => { const l = istObj(doc.permissions) && Array.isArray(doc.permissions.deny) ? doc.permissions.deny : []; return !l.includes(r); });
    if (!fehlen.length) return; // nichts zu tun: auch keinen leeren Behälter anlegen
    const liste = denyListe(doc, true, angelegt);
    hinzu = fehlen;
    liste.push(...hinzu);
  });
  return { hinzu, angelegt };
}
// Nimmt genau diese Regeln (Text gleich) heraus. Behälter, die dadurch leer werden, bleiben — außer Kortex hat sie angelegt (`angelegt`, aus tragRegelnEin). → { weg: [Regeln], entfernt: [Behälter] }
export function nimmRegelnHeraus(profilOrdner, regeln, angelegt = []) {
  let weg = [], entfernt = [];
  if (!regeln.length) return { weg, entfernt };
  aendereSettings(profilOrdner, (doc) => {
    weg = []; entfernt = [];
    const liste = denyListe(doc, false);
    if (!liste) return;
    weg = liste.filter((r) => regeln.includes(r));
    if (!weg.length) return;
    doc.permissions.deny = liste.filter((r) => !regeln.includes(r));
    if (!doc.permissions.deny.length && angelegt.includes("deny")) { delete doc.permissions.deny; entfernt.push("deny"); }
    if (!Object.keys(doc.permissions).length && angelegt.includes("permissions")) { delete doc.permissions; entfernt.push("permissions"); }
  });
  return { weg, entfernt };
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
function sandboxKnoten(doc, anlegen, angelegt) {
  if (doc.sandbox === undefined) { if (!anlegen) return null; doc.sandbox = {}; angelegt?.push("sandbox"); }
  if (!istObj(doc.sandbox)) throw new HttpFehler(409, KAPUTT);
  return doc.sandbox;
}
function filesystemListe(sb, name, anlegen, angelegt) {
  if (sb.filesystem === undefined) { if (!anlegen) return null; sb.filesystem = {}; angelegt?.push("filesystem"); }
  if (!istObj(sb.filesystem)) throw new HttpFehler(409, KAPUTT);
  if (sb.filesystem[name] === undefined) { if (!anlegen) return null; sb.filesystem[name] = []; angelegt?.push(name); }
  if (!Array.isArray(sb.filesystem[name])) throw new HttpFehler(409, KAPUTT);
  return sb.filesystem[name];
}
// Bringt die Sandbox-Einstellungen in den gewünschten Zustand und meldet, was Kortex geändert hat, damit der Rückweg genau das zurücknimmt.
//   frueher: bisher von Kortex Eingetragenes { denyRead: [..], denyWrite: [..], vorher: { <schalter>: { fehlte: true } | { wert } }, angelegt: [Behälter] } oder null
//   soll:    null = Strenger Schutz aus · { denyRead: [Pfade], denyWrite: [Pfade] } = an, mit diesen Pfaden
// → neuer Merker (dasselbe Format) oder null (nichts mehr von Kortex eingetragen)
export function gleicheSandboxAb(profilOrdner, frueher, soll) {
  let neu = null;
  aendereSettings(profilOrdner, (doc) => {
    const angelegt = [...(frueher && Array.isArray(frueher.angelegt) ? frueher.angelegt : [])];
    const neuAngelegt = [];
    const sb = sandboxKnoten(doc, soll !== null, neuAngelegt);
    const alt = frueher && istObj(frueher) ? frueher : { denyRead: [], denyWrite: [], vorher: {} };
    const vorher = { ...(istObj(alt.vorher) ? alt.vorher : {}) };
    if (soll === null) {
      if (!sb) { neu = null; return; }
      // eigene Pfade heraus, Schalter nur zurück, wenn sie noch so stehen, wie Kortex sie gesetzt hat
      for (const name of SANDBOX_LISTEN) {
        const liste = filesystemListe(sb, name, false);
        if (!liste) continue;
        sb.filesystem[name] = liste.filter((p) => !(alt[name] || []).includes(p));
        if (!sb.filesystem[name].length && angelegt.includes(name)) delete sb.filesystem[name];
      }
      if (istObj(sb.filesystem) && !Object.keys(sb.filesystem).length && angelegt.includes("filesystem")) delete sb.filesystem;
      for (const k of SANDBOX_SCHALTER) {
        if (!Object.hasOwn(vorher, k)) continue;
        if (sb[k] !== SANDBOX_SOLL[k]) continue; // der Nutzer hat es inzwischen selbst geändert: bleibt
        if (vorher[k] && vorher[k].fehlte) delete sb[k]; else if (vorher[k]) sb[k] = vorher[k].wert;
      }
      if (!Object.keys(sb).length && angelegt.includes("sandbox")) delete doc.sandbox;
      neu = null;
      return;
    }
    for (const k of SANDBOX_SCHALTER) {
      if (!Object.hasOwn(vorher, k)) vorher[k] = Object.hasOwn(sb, k) ? { wert: sb[k] } : { fehlte: true };
      sb[k] = SANDBOX_SOLL[k];
    }
    const merker = { vorher };
    for (const name of SANDBOX_LISTEN) {
      const liste = filesystemListe(sb, name, true, neuAngelegt);
      const eigene = soll[name] || [];
      const stale = (alt[name] || []).filter((p) => !eigene.includes(p));
      sb.filesystem[name] = liste.filter((p) => !stale.includes(p));
      const hinzu = eigene.filter((p) => !sb.filesystem[name].includes(p));
      sb.filesystem[name].push(...hinzu);
      // Pfade, die schon vorher von jemand anderem eingetragen waren, gehören nicht Kortex (und werden beim Rückweg nicht entfernt)
      merker[name] = [...new Set([...(alt[name] || []).filter((p) => eigene.includes(p)), ...hinzu])];
    }
    merker.angelegt = [...new Set([...angelegt, ...neuAngelegt])];
    neu = merker;
  });
  return neu;
}
// Steht Strenger Schutz tatsächlich in der Datei? → { zustand, an, da: [eigene Pfade, die in denyRead stehen], warnungen: [...] }
// warnungen: Einstellungen, die den Schutz aufweichen können (für die Anzeige): allowRead, excludedCommands, Überstimmung durch settings.local.json des Profils.
export function liesSandboxStand(profilOrdner, eigenePfade = []) {
  try {
    const { text, doc } = liesSettings(join(profilOrdner, "settings.json"));
    if (text === null) return { zustand: "keine-datei", an: false, da: [], warnungen: [] };
    const sb = sandboxKnoten(doc, false);
    const an = !!sb && SANDBOX_SCHALTER.every((k) => sb[k] === SANDBOX_SOLL[k]);
    const liste = sb ? filesystemListe(sb, "denyRead", false) || [] : [];
    const warnungen = [];
    if (sb) {
      if (istObj(sb.filesystem) && Array.isArray(sb.filesystem.allowRead) && sb.filesystem.allowRead.length) warnungen.push("allowRead");
      if (Array.isArray(sb.excludedCommands) && sb.excludedCommands.length) warnungen.push("excludedCommands");
    }
    try {
      const lokal = liesSettings(join(profilOrdner, "settings.local.json")).doc;
      if (istObj(lokal.sandbox) && Object.keys(lokal.sandbox).length) warnungen.push("lokal");
    } catch { warnungen.push("lokal-unlesbar"); }
    return { zustand: "ok", an, da: eigenePfade.filter((p) => liste.includes(p)), warnungen };
  } catch { return { zustand: "defekt", an: false, da: [], warnungen: [] }; }
}
