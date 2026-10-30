// vault-schutz.mjs — Schreibzugriffe des Kerns bleiben im Vault (Kern-Umzug P4, Sicherheit).
//
// Ein fremder Vault kann Verweise (Symlinks) und Hardlinks mitbringen: `.logs/werkzeug.log → ~/.zshrc`, `.logs/tageslauf → ~/Documents`,
// ein Wiki-Unterordner → außerhalb. Die oberste Ebene prüft pfade.mjs#pruefeVault; dieses Modul schützt JEDEN Schreibzugriff darunter, auch
// tief im Baum. Sobald ein Vault geprüft ist (registriereVault), laufen die verändernden Funktionen von node:fs — synchron
// (writeFileSync, appendFileSync, copyFileSync, cpSync, renameSync, openSync mit Schreibflags, mkdirSync, unlinkSync, rmSync, rmdirSync,
// utimesSync, chmodSync, symlinkSync, linkSync), mit Callback (writeFile, appendFile, … gleiche Namen ohne „Sync“), als Promise
// (fs.promises.*, node:fs/promises) und createWriteStream — für Pfade UNTER diesem Vault durch sicheresZiel():
//  - jeder Ordner auf dem Weg, der ein Verweis ist, muss in den Vault zurückführen (realpath), sonst wird nichts geschrieben;
//  - die Zieldatei selbst darf kein Verweis sein und höchstens einen Hardlink haben (nlink ≤ 1);
//  - bei symlink/link muss auch das Ziel des neuen Verweises im Vault liegen (sonst entstünde ein Weg nach draußen);
//  - synchrone Schreib- und Anhänge-Flags bekommen zusätzlich O_NOFOLLOW (das Betriebssystem verweigert einen Verweis auch im Wettlauf).
// Pfade dürfen Strings, Buffer oder file:-URLs sein. Verstöße werfen (Code EVAULTSCHUTZ; bei Callbacks/Promises wird der Fehler so
// zugestellt); die Aufrufer des Kerns fangen Schreibfehler fast durchweg still ab — es wird dann nichts geschrieben, ein Hook stört nie.
// Pfade außerhalb eines geprüften Vaults (Temp, Support-Ordner, ~/.claude …) und Lesezugriffe bleiben unberührt.
// Der Austausch der node:fs-Funktionen ist ein einziger Ort statt ~200 Schreibstellen; syncBuiltinESMExports macht ihn für `import { … } from
// "node:fs"` und "node:fs/promises" wirksam (live bindings). Test: Tests/Kern/test-vault-schutz.mjs.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, sep, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

// String / Buffer / file:-URL → absoluter Pfad; alles andere (Dateinummer …) → null
function alsPfad(p) {
  if (typeof p === "string") return resolve(p);
  if (Buffer.isBuffer(p)) return resolve(p.toString());
  if (p instanceof URL) { try { return resolve(fileURLToPath(p)); } catch { return null; } }
  return null;
}

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
  const abs = alsPfad(pfad);
  if (abs === null) return;
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

// Ein neuer Verweis/Hardlink INNERHALB eines Vaults darf nicht nach draußen zeigen (Ziel relativ zum Ordner des Verweises)
function neuerVerweisZiel(ziel, linkpfad) {
  const link = alsPfad(linkpfad);
  if (link === null || !wurzelFuer(link)) return;
  const z = alsPfad(ziel instanceof URL || Buffer.isBuffer(ziel) ? ziel : resolve(dirname(link), String(ziel)));
  if (z === null) return;
  const f = wurzelFuer(link);
  let echt = z;
  try { echt = realpath(z); } catch { /* existiert noch nicht: lexikalisch prüfen */ }
  if (!innen(z, f.w.lexikalisch) && !innen(z, f.w.echt) && !innen(echt, f.w.echt)) throw new VaultSchutzFehler(link, `Verweisziel außerhalb (${z})`);
}

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

// Welche Pfade eine Funktion verändert: [[pfad, ziel?], …] (ziel = die Datei selbst, sonst nur der Weg); Sonderfälle als Funktion
const SPEZ = {
  writeFile: (a) => { sicheresZiel(a[0]); },
  appendFile: (a) => { sicheresZiel(a[0]); },
  copyFile: (a) => { sicheresZiel(a[1]); },
  cp: (a) => { sicheresZiel(a[1], { ziel: false }); },
  rename: (a) => { sicheresZiel(a[0], { ziel: false }); sicheresZiel(a[1], { ziel: false }); },
  open: (a) => { if (schreibend(a[1])) sicheresZiel(a[0]); },
  mkdir: (a) => { sicheresZiel(a[0], { ziel: false }); },
  unlink: (a) => { sicheresZiel(a[0], { ziel: false }); },
  rm: (a) => { sicheresZiel(a[0], { ziel: false }); },
  rmdir: (a) => { sicheresZiel(a[0], { ziel: false }); },
  utimes: (a) => { sicheresZiel(a[0]); },
  chmod: (a) => { sicheresZiel(a[0]); },
  symlink: (a) => { sicheresZiel(a[1], { ziel: false }); neuerVerweisZiel(a[0], a[1]); },
  link: (a) => { sicheresZiel(a[1], { ziel: false }); neuerVerweisZiel(a[0], a[1]); },
};

function installiere() {
  if (installiert) return;
  installiert = true;
  const o = { ...fs };
  const op = { ...fs.promises };
  for (const [name, pruefe] of Object.entries(SPEZ)) {
    // synchron
    const sync = name + "Sync";
    if (typeof o[sync] === "function") {
      fs[sync] = function (...a) {
        pruefe(a);
        if ((name === "writeFile" || name === "appendFile") && typeof a[0] === "string") a[2] = optionenMit(a[2], name === "writeFile" ? "w" : "a");
        else if (name === "open" && typeof a[0] === "string" && schreibend(a[1])) a[1] = flagsMit(a[1], "r");
        return o[sync](...a);
      };
    }
    // Callback: der Fehler kommt asynchron an den Callback (nie als Wurf), wie bei node:fs
    if (typeof o[name] === "function") {
      fs[name] = function (...a) {
        try { pruefe(a); } catch (e) {
          const cb = a.find((x) => typeof x === "function");
          if (cb) { process.nextTick(cb, e); return; }
          throw e;
        }
        return o[name](...a);
      };
    }
    // Promise
    if (typeof op[name] === "function") {
      fs.promises[name] = function (...a) {
        try { pruefe(a); } catch (e) { return Promise.reject(e); }
        return op[name](...a);
      };
    }
  }
  fs.createWriteStream = function (pfad, opt) {
    sicheresZiel(pfad);
    const o2 = typeof opt === "string" ? { encoding: opt } : { ...(opt || {}) };
    if (typeof pfad !== "number") o2.flags = flagsMit(o2.flags, "w");
    return o.createWriteStream(pfad, o2);
  };
  syncBuiltinESMExports();
}

// Ab jetzt gilt der Schutz für Pfade unter diesem Vault (lexikalischer und echter Pfad). Idempotent.
export function registriereVault(lexikalisch, echt) {
  const l = resolve(lexikalisch), e = echt ? resolve(echt) : l;
  if (!wurzeln.some((w) => w.lexikalisch === l && w.echt === e)) wurzeln.push({ lexikalisch: l, echt: e });
  installiere();
}
// Die echten Pfade der Vaults, die dieser Prozess geprüft hat (pruefeVault) — werkzeug.mjs#gitBefehl fragt danach, ob sie vertraut sind.
export function registrierteVaults() { return [...new Set(wurzeln.map((w) => w.echt))]; }
