// umstellung/geraete.mjs — Schritt A8 der Phase A (Paket P7b, Plan Abschnitt 3 und 6): der Gerätemerker. Die EINZIGE Änderung im Vault-Inhalt in Phase A, harmlos für alte Kits.
//   .kortex/geraete/<Geräte-ID>.json   { name, kortexVersion, phaseA: "JJJJ-MM-TT" } – eine Datei je Mac, darum keine Merge-Konflikte
//   brain.config.json                   kernVersion = Version dieses Kortex (nie herabgesetzt)
// Beides geht in EINEM Commit nur dieser Pfade durch git-sicher („Kortex: Gerät umgestellt“). Ist der Versionsverlauf gesperrt oder der Commit nicht möglich, bleiben die Dateien
// ungespeichert im Vault liegen (ok, aber ohne Commit – der Befund meldet es). Phase B prüft später: alle Geräte haben phaseA, und kernVersion ist gesetzt (Freigabe-Tor).
// Rückweg: git revert dieses Commits (ohne Commit: Dateien/Config aus der Sicherung, wenn unverändert).
// Die Geräte-ID steht in <Support>/umstellung/geraet.json (der Befund liest sie dort, um den eigenen Mac von anderen zu unterscheiden).
import { existsSync, readFileSync, mkdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { kernVersion, liesConfigRoh } from "../pfade.mjs";
import { gitLauf, gitSicherLauf } from "./ziele.mjs";
import { hashDatei, hashText, sichereDatei, sicherungsPfad, schreibeAtomar, stelleHer, modusVon, echtesDateiZiel } from "./protokoll.mjs";

export const id = "A8";
const MELDUNG = "Kortex: Gerät umgestellt";
export const titel = "Gerät im Vault vermerken";

export function versionKleiner(a, b) {
  const z = (v) => String(v || "").split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
  const x = z(a), y = z(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}
export function geraeteId(z, { anlegen = true } = {}) {
  const datei = join(z.support, "umstellung", "geraet.json");
  try { const j = JSON.parse(readFileSync(datei, "utf8")); if (j && typeof j.id === "string" && /^[0-9a-f]{12}$/.test(j.id)) return j.id; } catch { /* neu */ }
  if (!anlegen) return null;
  const idNeu = randomBytes(6).toString("hex");
  mkdirSync(join(z.support, "umstellung"), { recursive: true, mode: 0o700 });
  schreibeAtomar(datei, JSON.stringify({ id: idNeu }) + "\n", 0o600);
  return idNeu;
}
const merkerRel = (gid) => `.kortex/geraete/${gid}.json`;
const heute = () => new Date().toISOString().slice(0, 10);
const geraeteName = () => { try { return hostname().replace(/\.local$/i, "").slice(0, 60) || "Mac"; } catch { return "Mac"; } };

export function lage(z) {
  const roh = liesConfigRoh(z.vault);
  if (roh.fehler || !roh.cfg || typeof roh.cfg !== "object") return { art: "config-defekt" };
  const gid = geraeteId(z, { anlegen: false });
  const datei = gid ? join(z.vault, merkerRel(gid)) : null;
  let merker = null;
  if (datei) { try { merker = JSON.parse(readFileSync(datei, "utf8")); } catch { /* fehlt */ } }
  const kv = typeof roh.cfg.kernVersion === "string" ? roh.cfg.kernVersion : null;
  const kvNoetig = !kv || versionKleiner(kv, kernVersion());
  const merkerNoetig = !(merker && typeof merker.phaseA === "string");
  return { art: "ok", roh, kv, kvNoetig, merkerNoetig };
}
export function plan(z) {
  const l = lage(z);
  return { noetig: l.art === "ok" && (l.kvNoetig || l.merkerNoetig), text: l.art === "ok" ? "Kortex vermerkt in deinem Vault, dass dieser Mac umgestellt ist (eine kleine Datei und die Version in den Einstellungen)." : "Die Einstellungsdatei des Vaults ist beschädigt – kein Vermerk." };
}

export function wende(z, ctx) {
  const l = lage(z);
  if (l.art !== "ok") return { status: "uebersprungen", grund: "config-defekt" };
  if (!l.kvNoetig && !l.merkerNoetig) return { status: "nichts" };
  const gid = geraeteId(z);
  const rel = merkerRel(gid);
  const datei = join(z.vault, rel);
  const configDatei = join(z.vault, "brain.config.json");
  const hatGit = existsSync(join(z.vault, ".git"));
  // Hatte die Config schon Änderungen, die nicht im Verlauf stehen, kommt sie nicht in unseren Commit (wir committen nur, was wir selbst geändert haben)
  let configSauber = hatGit;
  if (hatGit) { const s = gitLauf(z, ["status", "--porcelain", "-z", "--", "brain.config.json"]); configSauber = s.status === 0 && s.stdout.trim() === ""; }
  const cs = sichereDatei(z, ctx.sicherungsDir, configDatei, "brain.config.vor-a8.json");
  // Alle Inhalte und ihre Hashes stehen FEST, bevor etwas geschrieben wird – so erkennt der Rückweg unsere Dateien auch nach einem Absturz mitten im Schritt.
  const merker = { name: geraeteName(), kortexVersion: kernVersion(), phaseA: heute() };
  const mtext = JSON.stringify(merker, null, 2) + "\n";
  let cfgText = null;
  if (l.kvNoetig) {
    const bom = (() => { try { const b = readFileSync(configDatei); return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf; } catch { return false; } })();
    cfgText = (bom ? "\uFEFF" : "") + JSON.stringify({ ...l.roh.cfg, kernVersion: kernVersion() }, null, 2) + "\n";
  }
  const head = hatGit ? gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]) : null;
  const undo = {
    rel, datei, merkerVorherHash: hashDatei(datei), merkerNachherHash: l.merkerNoetig ? hashText(mtext) : hashDatei(datei),
    config: { rel: cs && cs.rel, hashVorher: cs && cs.hash, hashNachher: cfgText === null ? null : hashText(cfgText), modus: modusVon(configDatei) },
    headVorher: head && head.status === 0 ? head.stdout.trim() : null, commit: null, committet: [],
  };
  ctx.merkeUndo(undo);
  mkdirSync(join(z.vault, ".kortex", "geraete"), { recursive: true });
  if (l.merkerNoetig) writeFileSync(datei, mtext);
  if (cfgText !== null) {
    // optimistisch: hat sich die Datei zwischen Lesen und Schreiben geändert, nichts überschreiben
    if (liesConfigRoh(z.vault).stand !== l.roh.stand) throw new Error("config-geaendert");
    schreibeAtomar(echtesDateiZiel(configDatei), cfgText, undo.config.modus);
  }
  ctx.pruefpunkt("nach-schreiben");
  // ein Commit nur dieser Pfade
  let commit = false, grund;
  if (hatGit) {
    const pfade = [...(l.merkerNoetig || existsSync(datei) ? [rel] : []), ...(l.kvNoetig && configSauber ? ["brain.config.json"] : [])];
    const a = gitSicherLauf(z, ["add", "--", ...pfade]);
    if (a.status === 0) {
      const c = gitSicherLauf(z, ["commit", "-q", "-m", MELDUNG, "--", ...pfade]);
      if (c.status === 0) {
        ctx.pruefpunkt("nach-commit");
        const h = gitSicherLauf(z, ["rev-parse", "HEAD"]);
        undo.commit = h.status === 0 ? h.stdout.trim() : null; undo.committet = pfade; commit = !!undo.commit;
        ctx.merkeUndo(undo);
      } else { grund = c.status === 126 ? "git-gesperrt" : "commit-fehlgeschlagen"; gitSicherLauf(z, ["reset", "-q", "--", ...pfade]); }
    } else grund = a.status === 126 ? "git-gesperrt" : "add-fehlgeschlagen";
  } else grund = "kein-git";
  ctx.nachDaten = { datei, kv: kernVersion() };
  return { status: "ok", anzahl: 1 + (l.kvNoetig ? 1 : 0), details: { commit, grundOhneCommit: commit ? undefined : grund } };
}

export function nachpruefen(z, ctx) {
  const d = ctx.nachDaten;
  if (!d) return true;
  try { const m = JSON.parse(readFileSync(d.datei, "utf8")); if (typeof m.phaseA !== "string") return false; } catch { return false; }
  const roh = liesConfigRoh(z.vault);
  return !roh.fehler && roh.cfg && typeof roh.cfg.kernVersion === "string" && !versionKleiner(roh.cfg.kernVersion, d.kv);
}

function leereDirs(z) {
  for (const d of [join(z.vault, ".kortex", "geraete"), join(z.vault, ".kortex")]) { try { rmdirSync(d); } catch { /* nicht leer oder weg */ } }
}
export function zurueck(z, ctx, undo) {
  const hinweise = [];
  if (!undo) return { status: "nichts", hinweise };
  let n = 0;
  // Den Commit finden – auch wenn der Absturz zwischen `git commit` und dem Vermerken kam: HEAD ist dann unser Commit, wenn er direkt auf dem früheren HEAD sitzt und unsere Meldung trägt
  let commit = undo.commit;
  if (!commit && undo.headVorher) {
    const h = gitSicherLauf(z, ["rev-parse", "HEAD"]).stdout.trim();
    if (h && h !== undo.headVorher && gitSicherLauf(z, ["rev-parse", "HEAD^"]).stdout.trim() === undo.headVorher && gitSicherLauf(z, ["log", "-1", "--format=%s"]).stdout.trim() === MELDUNG) commit = h;
  }
  if (commit) {
    const r = gitSicherLauf(z, ["revert", "--no-edit", commit]);
    if (r.status !== 0) { gitSicherLauf(z, ["revert", "--abort"]); hinweise.push("revert-fehlgeschlagen"); return { status: "nichts", hinweise }; }
    n++;
  } else if (undo.merkerNachherHash && hashDatei(undo.datei) === undo.merkerNachherHash && undo.merkerVorherHash === null) { rmSync(undo.datei, { force: true }); n++; }
  else if (existsSync(undo.datei) && hashDatei(undo.datei) !== undo.merkerVorherHash) hinweise.push("geraetemerker-geaendert");
  // die Config: war sie Teil des Commits, hat der Revert sie schon hergestellt (ihr Hash ist dann wieder der alte); sonst (Config hatte vorher eigene Änderungen oder kein Commit)
  // aus der Sicherung, wenn sie unverändert unsere Fassung ist
  const c = undo.config || {};
  const configDatei = join(z.vault, "brain.config.json");
  if (c.hashNachher && hashDatei(configDatei) === c.hashNachher && c.rel) { stelleHer(configDatei, sicherungsPfad(z, c.rel), c.modus || 0o644); n++; }
  else if (c.hashNachher && hashDatei(configDatei) !== c.hashVorher) hinweise.push("config-geaendert");
  leereDirs(z);
  return { status: n ? "ok" : "nichts", hinweise };
}
