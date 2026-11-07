// electron/laufzeit.mjs — die Laufzeit der installierten App im Support-Ordner (Paket W2c), das Gegenstück zu Sources/BrainCore/Laufzeit.swift:
//   Node  <support>/node/<version>/node[.exe]   Kopie des mitgelieferten Node (geprüft gegen manifest.json), nie überschrieben: Version ändert sich nur mit dem Node
//         <support>/bin/node[.exe]               der STABILE Pfad (BRAIN_MCP_NODE → MCP-Einträge, Statuszeile): fester Verweis auf die Kopie
//   Kern  <support>/kern/<appversion>-<stempel>  Kopie von <resources>/Ressourcen/kern (mit mcp/ und gemeinsam/), unveränderlich je Inhalt
//         <support>/bin/kern                     der STABILE Pfad (KORTEX_KERN_PFAD → MCP-Server, Hooks): Verweis auf die Kopie
// Warum Kopie statt „auf das Paket zeigen“: Das Paket liegt nicht überall an einem festen Ort — ein AppImage hängt sich bei jedem Start unter /tmp/.mount_<zufall> ein und hat bei jedem
// Update einen anderen Pfad —, aber ~/.claude, ~/.codex, Git-Hooks und Statuszeile merken sich die Pfade. Der Support-Ordner ist stabil, und eine Kopie überlebt auch das Beenden der App.
// Alles idempotent und ohne Wirkung außerhalb des Support-Ordners. Reine Logik OHNE `import "electron"` (Test: Tests/Node/electron-w2c.test.mjs).
//
// Der stabile Node-Pfad ist eine harte Verknüpfung (Rückfall: Kopie) und kein Symlink: harte Verknüpfungen brauchen unter Windows keine Rechte; Symlinks dort Entwicklermodus oder Admin.
// Austausch: Verknüpfung nebenan anlegen und darüber umbenennen (atomar auf Linux, auch bei laufendem Node); Windows verweigert das Überschreiben eines LAUFENDEN Programms, erlaubt aber
// das Umbenennen — dann wird die alte Datei beiseite geschoben (`.alt-<pid>`) und beim nächsten Start gelöscht. Der stabile Kern-Pfad ist ein Symlink (Windows: Junction, ohne Rechte).
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const VERSION = /^v\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{64}$/;
const NAME = /^[0-9A-Za-z._-]{1,60}$/;

export function sha256Datei(pfad) {
  const h = createHash("sha256"), puffer = Buffer.allocUnsafe(1 << 22), fd = openSync(pfad, "r");
  try { for (let n; (n = readSync(fd, puffer, 0, puffer.length, null)) > 0;) h.update(puffer.subarray(0, n)); } finally { closeSync(fd); }
  return h.digest("hex");
}

// Windows: frisch geschriebene Dateien hält oft kurz ein Virenscanner fest (EPERM/EBUSY) — umbenennen mit kurzen Wiederholungen
const warteBlockierend = (ms) => { const bis = Date.now() + ms; while (Date.now() < bis) { /* kurz warten */ } };
const benenneUm = (von, nach) => {
  for (let i = 0; ; i++) {
    try { return renameSync(von, nach); }
    catch (e) { if (process.platform !== "win32" || i >= 8 || !/^(EPERM|EACCES|EBUSY)$/.test(e?.code)) throw e; warteBlockierend(100 * (i + 1)); }
  }
};
const groesse = (p) => { try { return statSync(p).size; } catch { return -1; } };
const gleicheDatei = (a, b) => {
  try {
    const x = statSync(a, { bigint: true }), y = statSync(b, { bigint: true });
    if (x.ino !== 0n && x.ino === y.ino && x.dev === y.dev) return true; // harte Verknüpfung
    return x.size === y.size && sha256Datei(a) === sha256Datei(b); // Rückfall (Kopie, nur wenn keine harte Verknüpfung möglich war): gleicher Inhalt
  } catch { return false; }
};
const wegDamit = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* läuft gerade (Windows) oder weg: der nächste Start räumt auf */ } };
const aufraeumen = (ordner, muster) => { try { for (const n of readdirSync(ordner)) if (muster.test(n)) wegDamit(join(ordner, n)); } catch { /* kein Ordner */ } };

/** Legt `stabil` als harte Verknüpfung (Rückfall Kopie) auf `ziel`; ein vorhandener, anderer Eintrag wird atomar ersetzt (Windows: laufende Datei beiseite geschoben). */
export function setzeDateiLink(stabil, ziel) {
  if (existsSync(stabil) && gleicheDatei(stabil, ziel)) return false;
  const tmp = `${stabil}.neu-${process.pid}`;
  wegDamit(tmp);
  try { linkSync(ziel, tmp); } catch { copyFileSync(ziel, tmp); chmodSync(tmp, 0o755); }
  try { renameSync(tmp, stabil); }
  catch {
    const alt = `${stabil}.alt-${process.pid}-${Date.now()}`;
    renameSync(stabil, alt); // Windows: eine laufende Datei lässt sich umbenennen, nicht überschreiben
    renameSync(tmp, stabil);
    wegDamit(alt);
  }
  return true;
}

/** Legt `stabil` als Verweis auf den Ordner `ziel` (Linux/macOS Symlink, Windows Junction) und schaltet ihn atomar um. → vorheriges Ziel (Ordnername) oder null. */
export function setzeOrdnerLink(stabil, ziel, { plattform = process.platform } = {}) {
  let vorher = null;
  try { vorher = basename(readlinkSync(stabil)); } catch { /* neu */ }
  try { if (readlinkSync(stabil) === ziel) return vorher; } catch { /* neu */ } // schon richtig: nichts anfassen (unter Windows gäbe es sonst ein Fenster ohne Verweis)
  const tmp = `${stabil}.neu-${process.pid}`;
  wegDamit(tmp);
  symlinkSync(ziel, tmp, plattform === "win32" ? "junction" : "dir");
  try { renameSync(tmp, stabil); }
  catch { // Windows: ein vorhandener Verweis lässt sich nicht überschreiben
    try { unlinkSync(stabil); } catch { /* weg oder kein Verweis */ }
    renameSync(tmp, stabil);
  }
  return vorher;
}

/** Node: Kopie nach <support>/node/<version>/, stabiler Pfad <support>/bin/node[.exe]. → { node (stabil), nodeDatei (Kopie), version } */
export function installiereNode({ quelle, support, plattform = process.platform }) {
  const exe = plattform === "win32" ? "node.exe" : "node";
  let m;
  try { m = JSON.parse(readFileSync(join(quelle, "manifest.json"), "utf8")); } catch { throw new Error("Das Manifest der mitgelieferten Node-Laufzeit fehlt."); }
  if (!m || !VERSION.test(m.version) || !SHA.test(m.sha256) || !Number.isInteger(m.size)) throw new Error("Das Manifest der mitgelieferten Node-Laufzeit ist ungültig.");
  const dir = join(support, "node", m.version), datei = join(dir, exe), marke = join(dir, ".fertig");
  const fertig = () => { try { return readFileSync(marke, "utf8").trim() === m.sha256 && groesse(datei) === m.size; } catch { return false; } };
  if (!fertig()) {
    const q = join(quelle, exe);
    if (groesse(q) !== m.size || sha256Datei(q) !== m.sha256) throw new Error("Die Prüfsumme der mitgelieferten Node-Datei stimmt nicht.");
    wegDamit(dir);
    mkdirSync(dir, { recursive: true });
    const tmp = `${datei}.neu-${process.pid}`;
    copyFileSync(q, tmp);
    chmodSync(tmp, 0o755);
    benenneUm(tmp, datei);
    writeFileSync(marke, `${m.sha256}\n`);
  }
  const bin = join(support, "bin");
  mkdirSync(bin, { recursive: true });
  aufraeumen(bin, /\.(alt|neu)-\d+(-\d+)?$/);
  const stabil = join(bin, exe);
  setzeDateiLink(stabil, datei);
  try { for (const n of readdirSync(join(support, "node"))) if (n !== m.version) wegDamit(join(support, "node", n)); } catch { /* nichts zu räumen */ }
  return { node: stabil, nodeDatei: datei, version: m.version };
}

/** Kern: Kopie nach <support>/kern/<version>-<stempel>/, stabiler Pfad <support>/bin/kern. → { kern (stabil), ordner, version } oder null, wenn das Paket keinen Kern enthält. */
export function installiereKern({ quelle, support, plattform = process.platform }) {
  if (!existsSync(join(quelle, "brain.mjs"))) return null;
  const lies = (n) => { try { return readFileSync(join(quelle, n), "utf8").trim(); } catch { return ""; } };
  const version = NAME.test(lies("VERSION")) ? lies("VERSION") : "0";
  const stempel = lies(".stempel");
  if (!SHA.test(stempel)) throw new Error("Der Kern im Paket hat keinen Stempel (.stempel).");
  const name = `${version}-${stempel.slice(0, 12)}`, dir = join(support, "kern", name), marke = join(dir, ".fertig");
  if (!(existsSync(marke) && readFileSync(marke, "utf8").trim() === stempel)) {
    mkdirSync(join(support, "kern"), { recursive: true });
    const tmp = `${dir}.neu-${process.pid}`;
    wegDamit(tmp);
    cpSync(quelle, tmp, { recursive: true });
    writeFileSync(join(tmp, ".fertig"), `${stempel}\n`);
    wegDamit(dir);
    benenneUm(tmp, dir);
  }
  const bin = join(support, "bin");
  mkdirSync(bin, { recursive: true });
  const stabil = join(bin, "kern");
  const vorher = setzeOrdnerLink(stabil, dir, { plattform });
  // Die vorige Version bleibt liegen (ein Hook, der mitten im Update läuft, liest weiter aus ihr); ältere und angebrochene Kopien gehen
  try { for (const n of readdirSync(join(support, "kern"))) if (n !== name && n !== vorher) wegDamit(join(support, "kern", n)); } catch { /* nichts zu räumen */ }
  return { kern: stabil, ordner: dir, version };
}

/** Alles zusammen für die installierte App: `ressourcen` = process.resourcesPath. Node ist Pflicht (wirft), der Kern fehlt nur in einem Paket ohne Kern. */
export function installiereLaufzeit({ ressourcen, support, plattform = process.platform }) {
  const node = installiereNode({ quelle: join(ressourcen, "node"), support, plattform });
  const kern = installiereKern({ quelle: join(ressourcen, "Ressourcen", "kern"), support, plattform });
  return { ...node, kern: kern?.kern ?? null, kernOrdner: kern?.ordner ?? null };
}
