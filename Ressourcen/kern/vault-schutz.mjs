// vault-schutz.mjs — Schreibzugriffe des Kerns bleiben im Vault (Kern-Umzug P4, Sicherheit).
//
// Ein fremder Vault kann Verweise (Symlinks) und Hardlinks mitbringen: `.logs/werkzeug.log → ~/.zshrc`, `.logs/tageslauf → ~/Documents`,
// ein Wiki-Unterordner → außerhalb. Die oberste Ebene prüft pfade.mjs#pruefeVault; dieses Modul schützt JEDEN Schreibzugriff darunter, auch
// tief im Baum. Sobald ein Vault geprüft ist (registriereVault), laufen die schreibenden Funktionen von node:fs (writeFileSync,
// appendFileSync, copyFileSync, cpSync, renameSync, openSync mit Schreibflags, mkdirSync, unlinkSync, rmSync, rmdirSync) für Pfade UNTER
// diesem Vault durch sicheresZiel():
//  - jeder Ordner auf dem Weg, der ein Verweis ist, muss in den Vault zurückführen (realpath), sonst wird nichts geschrieben;
//  - die Zieldatei selbst darf kein Verweis sein und höchstens einen Hardlink haben (nlink ≤ 1);
//  - Schreib- und Anhänge-Flags bekommen zusätzlich O_NOFOLLOW (das Betriebssystem verweigert einen Verweis auch im Wettlauf).
// Verstöße werfen (Code EVAULTSCHUTZ); die Aufrufer des Kerns fangen Schreibfehler fast durchweg still ab — es wird dann nichts geschrieben,
// ein Hook stört nie. Pfade außerhalb eines geprüften Vaults (Temp, Support-Ordner, ~/.claude …) und Lesezugriffe bleiben unberührt.
// Der Austausch der node:fs-Funktionen ist ein einziger Ort statt ~200 Schreibstellen; syncBuiltinESMExports macht ihn für `import { … } from
// "node:fs"` wirksam (live bindings). Test: Tests/Kern/test-vault-schutz.mjs.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, sep, join } from "node:path";

const lstat = fs.lstatSync, realpath = fs.realpathSync;
const K = fs.constants;
const wurzeln = []; // { lexikalisch, echt }
let installiert = false;

export class VaultSchutzFehler extends Error {
  constructor(pfad, grund) {
    super(`Schreiben außerhalb des Vaults verweigert (${grund}): ${pfad}`);
    this.name = "VaultSchutzFehler";
    this.code = "EVAULTSCHUTZ";
  }
}

const innen = (p, w) => p === w || p.startsWith(w + sep);

// → true, wenn `abs` unter einem geprüften Vault liegt (inkl. seiner echten Pfadform)
function wurzelFuer(abs) {
  for (const w of wurzeln) {
    if (innen(abs, w.lexikalisch)) return { w, basis: w.lexikalisch };
    if (innen(abs, w.echt)) return { w, basis: w.echt };
  }
  return null;
}

// Prüft den Weg von der Vault-Wurzel bis zum Elternordner (Verweise müssen im Vault bleiben) und, wenn `ziel`, die Datei selbst.
// Wirft VaultSchutzFehler; für Pfade außerhalb eines geprüften Vaults tut es nichts.
export function sicheresZiel(pfad, { ziel = true } = {}) {
  if (typeof pfad !== "string" && !(pfad instanceof URL)) return;
  const abs = resolve(pfad instanceof URL ? pfad.pathname : pfad);
  const f = wurzelFuer(abs);
  if (!f) return;
  const { w, basis } = f;
  const teile = abs.slice(basis.length).split(sep).filter(Boolean);
  let cur = basis;
  for (let i = 0; i < teile.length; i++) {
    cur = join(cur, teile[i]);
    const letzte = i === teile.length - 1;
    let st;
    try { st = lstat(cur); } catch (e) {
      if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return; // der Rest entsteht neu, unter einem geprüften Elternordner
      throw e;
    }
    if (letzte && !ziel) return; // nur der Weg zählt (löschen/umbenennen/Ordner anlegen fasst den Verweis selbst an, nicht sein Ziel)
    if (st.isSymbolicLink()) {
      if (letzte) throw new VaultSchutzFehler(abs, "Verweis als Ziel");
      let echt;
      try { echt = realpath(cur); } catch { throw new VaultSchutzFehler(abs, "Verweis ins Leere"); }
      if (!innen(echt, w.echt)) throw new VaultSchutzFehler(abs, "Verweis nach außerhalb");
    } else if (letzte && st.isFile() && st.nlink > 1) {
      throw new VaultSchutzFehler(abs, "Hardlink");
    }
  }
}

// String-Flags in Zahlen mit O_NOFOLLOW; unbekannte Flags bleiben (die lstat-Prüfung gilt trotzdem)
function flagsMit(flag, standard) {
  const f = flag === undefined ? standard : flag;
  const NF = K.O_NOFOLLOW || 0;
  if (typeof f === "number") return f | NF;
  switch (f) {
    case "w": return K.O_WRONLY | K.O_CREAT | K.O_TRUNC | NF;
    case "wx": case "xw": return K.O_WRONLY | K.O_CREAT | K.O_TRUNC | K.O_EXCL | NF;
    case "a": return K.O_WRONLY | K.O_CREAT | K.O_APPEND | NF;
    case "ax": case "xa": return K.O_WRONLY | K.O_CREAT | K.O_APPEND | K.O_EXCL | NF;
    case "w+": return K.O_RDWR | K.O_CREAT | K.O_TRUNC | NF;
    case "a+": return K.O_RDWR | K.O_CREAT | K.O_APPEND | NF;
    case "r+": return K.O_RDWR | NF;
    default: return f;
  }
}
function optionenMit(opt, standardFlag) {
  if (opt === undefined || opt === null) return { flag: flagsMit(undefined, standardFlag) };
  if (typeof opt === "string") return { encoding: opt, flag: flagsMit(undefined, standardFlag) };
  return { ...opt, flag: flagsMit(opt.flag, standardFlag) };
}
const schreibend = (flags) => typeof flags === "number" ? (flags & (K.O_WRONLY | K.O_RDWR | K.O_APPEND | K.O_CREAT)) !== 0 : /[wa+]/.test(String(flags ?? "r"));

function installiere() {
  if (installiert) return;
  installiert = true;
  const o = { ...fs };
  const ziel = (p) => sicheresZiel(p);
  const eltern = (p) => sicheresZiel(p, { ziel: false });
  fs.writeFileSync = function (pfad, daten, opt) {
    if (typeof pfad === "string") { ziel(pfad); return o.writeFileSync(pfad, daten, optionenMit(opt, "w")); }
    return o.writeFileSync(pfad, daten, opt);
  };
  fs.appendFileSync = function (pfad, daten, opt) {
    if (typeof pfad === "string") { ziel(pfad); return o.appendFileSync(pfad, daten, optionenMit(opt, "a")); }
    return o.appendFileSync(pfad, daten, opt);
  };
  fs.copyFileSync = function (quelle, dest, ...rest) { ziel(dest); return o.copyFileSync(quelle, dest, ...rest); };
  fs.cpSync = function (quelle, dest, ...rest) { eltern(dest); return o.cpSync(quelle, dest, ...rest); };
  fs.renameSync = function (alt, neu) { eltern(alt); eltern(neu); return o.renameSync(alt, neu); };
  fs.openSync = function (pfad, flags, ...rest) {
    if (typeof pfad === "string" && schreibend(flags)) { ziel(pfad); return o.openSync(pfad, flagsMit(flags, "r"), ...rest); }
    return o.openSync(pfad, flags, ...rest);
  };
  fs.mkdirSync = function (pfad, ...rest) { eltern(pfad); return o.mkdirSync(pfad, ...rest); };
  fs.unlinkSync = function (pfad) { eltern(pfad); return o.unlinkSync(pfad); };
  fs.rmSync = function (pfad, ...rest) { eltern(pfad); return o.rmSync(pfad, ...rest); };
  fs.rmdirSync = function (pfad, ...rest) { eltern(pfad); return o.rmdirSync(pfad, ...rest); };
  syncBuiltinESMExports();
}

// Ab jetzt gilt der Schutz für Pfade unter diesem Vault (lexikalischer und echter Pfad). Idempotent.
export function registriereVault(lexikalisch, echt) {
  const l = resolve(lexikalisch), e = echt ? resolve(echt) : l;
  if (!wurzeln.some((w) => w.lexikalisch === l && w.echt === e)) wurzeln.push({ lexikalisch: l, echt: e });
  installiere();
}
