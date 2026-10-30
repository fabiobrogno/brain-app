// umstellung/phase-b-schritte.mjs — die Schritte B0–B3 der Phase B (Paket P7d, Plan docs/plaene/p7-umstellung.md Abschnitt 4.2). Gleiche Form wie die Schritte der Phase A
// ({ id, titel, plan, wende, nachpruefen, zurueck }): prüfen → Rückweg-Angaben ablegen → schreiben → nachprüfen; ein Fehler nimmt nur den betroffenen Schritt zurück.
//
//   B0 Sicherung       vor-phase-b.bundle (alle Commits) und Kopien von brain.config.json, .gitignore, Gerätemerker im Support-Ordner (0600)
//   B1 Archiv          der alte Werkzeug-Ordner (ALT_KIT_ORDNER) wandert – nie gelöscht – nach <Support>/umstellung/<Kennung>/kit-<Datum>/ (umbenennen; über eine Laufwerksgrenze: kopieren,
//                      Datei für Datei vergleichen, erst dann entfernen)
//   B2 Einstellungen   .gitignore bekommt den Ordnernamen, brain.config.json verliert die Altfelder (backup.pfad nur, wenn A1 ihn übernommen hat), der Gerätemerker dieses Macs bekommt phaseB
//   B3 Commit          EIN Commit nur dieser Pfade über git-sicher („Kortex: alten Werkzeug-Ordner entfernt“); Rückweg: git revert dieses Commits, dann kommt das Archiv zurück
// Reihenfolge des Rückwegs (rueckweg.mjs, umgekehrt): B3 (Revert) → B2 → B1 (Archiv zurück, notfalls zusammenführen) → B0 (bleibt liegen). Keine Werte im Protokoll.
import { existsSync, readFileSync, mkdirSync, rmSync, rmdirSync, chmodSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { ALT_KIT_ORDNER, liesConfigRoh, pruefeVault } from "../pfade.mjs";
import { merkerDateiFuer } from "../backup.mjs";
import { gitLauf, gitSicherLauf, freierPlatz } from "./ziele.mjs";
import { ablageOrdner, hashDatei, hashText, sichereDatei, sicherungsPfad, schreibeAtomar, stelleHer, modusVon, echtesDateiZiel, liesZustand } from "./protokoll.mjs";
import { baumHash, baumGroesse, baumEnthalten, verschiebeBaum, fuegeBaumZurueck, lexists, heuteTag } from "./baum.mjs";
import { geraeteId } from "./geraete.mjs";
import { undoListe } from "./schrittliste.mjs";

export const ALTE_FELDER = ["werkzeuge", "kit", "systemVersion", "updateHinweis", "vaultPath"];
const MELDUNG = "Kortex: alten Werkzeug-Ordner entfernt";
const PUFFER = 64 * 1024 * 1024;
const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);
const kitPfad = (z) => join(z.vault, ALT_KIT_ORDNER);
const hatGit = (z) => existsSync(join(z.vault, ".git"));
const IGNORE_ZEILE = new RegExp(`^/?${ALT_KIT_ORDNER.replace(/\./g, "\\.")}/?\\s*$`, "m");
const IGNORE_BLOCK = `# Kortex: alter Werkzeug-Ordner, wird nicht mehr benutzt\n${ALT_KIT_ORDNER}/\n`;

export const kitArt = (z) => { try { const l = lstatSync(kitPfad(z)); return l.isSymbolicLink() ? "verweis" : l.isDirectory() ? "ordner" : "datei"; } catch { return null; } };

// ===================================================================================================================================
// B0 — Sicherung
// ===================================================================================================================================
export const B0 = {
  id: "B0", titel: "Sicherung anlegen",
  plan: () => ({ noetig: true, text: "Kortex sichert vor dem Aufräumen alle Commits des Vaults (Bundle) und die Einstellungen, die es gleich ändert." }),
  wende(z, ctx) {
    let bundle = "keins";
    if (hatGit(z)) {
      const ziel = join(ablageOrdner(z), "vor-phase-b.bundle");
      mkdirSync(ablageOrdner(z), { recursive: true, mode: 0o700 });
      if (existsSync(ziel)) rmSync(ziel, { force: true });      // eine frische Sicherung des jetzigen Stands
      if (freierPlatz(z, ablageOrdner(z)) < PUFFER) throw new Error("zu-wenig-platz");
      const r = gitLauf(z, ["bundle", "create", ziel, "--all"]);
      if (r.status !== 0) { rmSync(ziel, { force: true }); if (/empty bundle/i.test(r.stderr)) bundle = "leer"; else throw new Error("bundle-fehlgeschlagen"); }
      else {
        try { chmodSync(ziel, 0o600); } catch { /* best effort */ }
        if (gitLauf(z, ["bundle", "verify", ziel]).status !== 0) { rmSync(ziel, { force: true }); throw new Error("bundle-ungeprueft"); }
        bundle = "neu";
      }
    }
    let anzahl = 0;
    const kopiere = (quelle, name) => { if (sichereDatei(z, ctx.sicherungsDir, quelle, name)) anzahl++; };
    kopiere(join(z.vault, "brain.config.json"), "brain.config.vor-b");
    kopiere(join(z.vault, ".gitignore"), "gitignore.vor-b");
    const gid = geraeteId(z, { anlegen: false });
    if (gid) kopiere(join(z.vault, ".kortex", "geraete", `${gid}.json`), "geraet.vor-b.json");
    ctx.merkeUndo({ bundle });
    return { status: "ok", anzahl, details: { bundle } };
  },
  nachpruefen: (z) => !hatGit(z) || existsSync(join(ablageOrdner(z), "vor-phase-b.bundle")) || gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]).status !== 0,
  zurueck: () => ({ status: "nichts", hinweise: [] }),      // Bundle und Kopien bleiben liegen (sie sind die letzte Rettung)
};

// ===================================================================================================================================
// B1 — Archiv
// ===================================================================================================================================
function archivName(z, datum) {
  for (let i = 1; i < 100; i++) {
    const name = `kit-${datum}${i === 1 ? "" : `-${i}`}`;
    if (!lexists(join(ablageOrdner(z), name))) return name;
  }
  throw new Error("archivname-vergeben");
}
export const archivOrt = (z, name, art) => (art === "ordner" ? join(ablageOrdner(z), name) : join(ablageOrdner(z), name, ALT_KIT_ORDNER));

export const B1 = {
  id: "B1", titel: "Alten Werkzeug-Ordner ins Archiv legen",
  plan(z) {
    const art = kitArt(z);
    return art ? { noetig: true, text: "Der alte Werkzeug-Ordner wandert ins Archiv im Support-Ordner von Kortex (nichts wird gelöscht).", art } : { noetig: false, text: "Der alte Werkzeug-Ordner ist schon weg." };
  },
  wende(z, ctx) {
    const art = kitArt(z);
    if (!art) return { status: "nichts" };
    const quelle = kitPfad(z);
    const name = archivName(z, (z.heute ? z.heute() : heuteTag()));
    const ziel = archivOrt(z, name, art);
    const g = baumGroesse(quelle);
    const undo = { archiv: name, art, hash: baumHash(quelle), dateien: g.dateien, bytes: g.bytes, fertig: false };
    ctx.merkeUndo(undo);                      // VOR dem Verschieben: ein Absturz mittendrin bleibt umkehrbar
    mkdirSync(ablageOrdner(z), { recursive: true, mode: 0o700 });
    undo.wie = verschiebeBaum(quelle, ziel, {
      umbenenner: z.umbenenner || undefined,
      platz: (bytes) => freierPlatz(z, dirname(ziel)) >= Math.ceil(bytes * 1.2) + PUFFER,
      pruefpunkt: (n) => ctx.pruefpunkt(n),
    });
    undo.fertig = true;
    ctx.merkeUndo(undo);
    ctx.pruefpunkt("nach-archiv");
    return { status: "ok", anzahl: g.dateien, details: { archiv: name, wie: undo.wie, art } };
  },
  nachpruefen(z, ctx) {
    const u = ctx.undo;
    if (!u) return true;
    if (lexists(kitPfad(z))) return false;
    return baumHash(archivOrt(z, u.archiv, u.art)) === u.hash;
  },
  zurueck(z, ctx, undo) {
    const hinweise = [];
    if (!undo || !undo.archiv) return { status: "nichts", hinweise };
    const ort = archivOrt(z, undo.archiv, undo.art);
    if (!lexists(ort)) { if (!lexists(kitPfad(z))) hinweise.push("archiv-fehlt"); return { status: "nichts", hinweise }; }
    try { fuegeBaumZurueck(ort, kitPfad(z), { umbenenner: z.umbenenner || undefined, pruefpunkt: (n) => ctx.pruefpunkt && ctx.pruefpunkt(`zurueck-${n}`) }); }
    catch (e) { if (e && e.name === "TestAbbruch") throw e; hinweise.push("archiv-nicht-zurueck"); return { status: "nichts", hinweise }; }
    if (undo.art !== "ordner") { try { rmdirSync(join(ablageOrdner(z), undo.archiv)); } catch { /* nicht leer */ } }
    return { status: "ok", hinweise };
  },
};

// ===================================================================================================================================
// B2 — .gitignore, Einstellungen des Vaults, Gerätemerker
// ===================================================================================================================================
const einrueckung = (text) => (/\n\t"/.test(text) ? "\t" : 2);
const merkerRel = (z) => { const g = geraeteId(z, { anlegen: false }); return g ? `.kortex/geraete/${g}.json` : null; };

// Was wird sich ändern? → { gitignore: {text|null}, config: {text|null, entfernt: [Namen]}, merker: {text|null} }
export function berechneB2(z) {
  const aus = { gitignore: { neu: null }, config: { neu: null, entfernt: [] }, merker: { neu: null, rel: merkerRel(z) } };
  let gi = ""; try { gi = readFileSync(join(z.vault, ".gitignore"), "utf8"); } catch { /* keine */ }
  if (!IGNORE_ZEILE.test(gi)) aus.gitignore.neu = (gi && !gi.endsWith("\n") ? gi + "\n" : gi) + (gi ? "\n" : "") + IGNORE_BLOCK;
  const roh = liesConfigRoh(z.vault);
  if (roh.cfg && istObjekt(roh.cfg) && !roh.fehler) {
    const cfg = { ...roh.cfg };
    const entfernt = [];
    for (const k of ALTE_FELDER) if (k in cfg) { delete cfg[k]; entfernt.push(k); }
    // backup.pfad nur, wenn A1 ihn als Sicherungsziel dieses Macs übernommen hat (Merker im Support-Ordner)
    if (istObjekt(cfg.backup) && typeof cfg.backup.pfad === "string") {
      let merker = {}; try { const o = JSON.parse(readFileSync(merkerDateiFuer(z.vault, z.support), "utf8")); if (istObjekt(o)) merker = o; } catch { /* keiner */ }
      if (merker.pfad === cfg.backup.pfad) { const { pfad, ...rest } = cfg.backup; cfg.backup = rest; entfernt.push("backup.pfad"); }
    }
    let buf = null; try { buf = readFileSync(join(z.vault, "brain.config.json")); } catch { /* fehlt */ }
    const bom = !!buf && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    if (entfernt.length || bom) { aus.config.neu = JSON.stringify(cfg, null, einrueckung(roh.text || "")) + "\n"; aus.config.entfernt = entfernt; aus.config.bom = bom; aus.config.stand = roh.stand; }
  }
  if (aus.merker.rel) {
    try { const m = JSON.parse(readFileSync(join(z.vault, aus.merker.rel), "utf8")); if (istObjekt(m) && typeof m.phaseB !== "string") aus.merker.neu = JSON.stringify({ ...m, phaseB: z.heute ? z.heute() : heuteTag() }, null, 2) + "\n"; } catch { /* kein Merker: wird nicht angelegt */ }
  }
  return aus;
}

export const B2 = {
  id: "B2", titel: "Einstellungen des Vaults bereinigen",
  plan(z) {
    const b = berechneB2(z);
    const n = (b.gitignore.neu !== null) + (b.config.neu !== null) + (b.merker.neu !== null);
    return { noetig: n > 0, text: b.config.entfernt.length ? `In den Einstellungen des Vaults werden ${b.config.entfernt.length} alte Felder entfernt (${b.config.entfernt.join(", ")}).` : "Kleine Aufräumarbeiten in den Dateien des Vaults.", entfernt: b.config.entfernt };
  },
  wende(z, ctx) {
    const b = berechneB2(z);
    const n = (b.gitignore.neu !== null) + (b.config.neu !== null) + (b.merker.neu !== null);
    if (!n) return { status: "nichts" };
    const gitignore = join(z.vault, ".gitignore"), configDatei = join(z.vault, "brain.config.json");
    const merker = b.merker.rel ? join(z.vault, b.merker.rel) : null;
    // Sauber = die Datei hat vorher keine ungesicherten Änderungen: nur dann kommt sie in den Commit (wir committen nur, was wir selbst geändert haben)
    const sauber = (rel) => { if (!hatGit(z)) return false; const s = gitLauf(z, ["status", "--porcelain", "-z", "--", rel]); return s.status === 0 && s.stdout.trim() === ""; };
    const getrackt = (rel) => { const r = gitLauf(z, ["ls-files", "-z", "--", rel]); return r.status === 0 && r.stdout.length > 0; };
    const undo = {
      gitignore: { geaendert: b.gitignore.neu !== null, hashVorher: hashDatei(gitignore), hashNachher: b.gitignore.neu !== null ? hashText(b.gitignore.neu) : null, modus: modusVon(gitignore, 0o644), sicherung: null,
        sauber: b.gitignore.neu !== null && sauber(".gitignore"), getrackt: hatGit(z) && getrackt(".gitignore") },
      config: { geaendert: b.config.neu !== null, hashVorher: hashDatei(configDatei), hashNachher: b.config.neu !== null ? hashText(b.config.neu) : null, modus: modusVon(configDatei), sicherung: null,
        sauber: b.config.neu !== null && sauber("brain.config.json"), entfernt: b.config.entfernt },
      merker: { rel: b.merker.rel, geaendert: b.merker.neu !== null, hashVorher: merker ? hashDatei(merker) : null, hashNachher: b.merker.neu !== null ? hashText(b.merker.neu) : null, modus: merker ? modusVon(merker, 0o644) : 0o644, sicherung: null,
        sauber: b.merker.neu !== null && sauber(b.merker.rel) },
    };
    const s1 = undo.gitignore.geaendert ? sichereDatei(z, ctx.sicherungsDir, gitignore, "gitignore.vor-b2") : null;
    const s2 = undo.config.geaendert ? sichereDatei(z, ctx.sicherungsDir, configDatei, "brain.config.vor-b2.json") : null;
    const s3 = undo.merker.geaendert && merker ? sichereDatei(z, ctx.sicherungsDir, merker, "geraet.vor-b2.json") : null;
    undo.gitignore.sicherung = s1 && s1.rel; undo.config.sicherung = s2 && s2.rel; undo.merker.sicherung = s3 && s3.rel;
    ctx.merkeUndo(undo);                      // Hashes und Sicherungen stehen fest, bevor etwas geschrieben wird
    if (undo.gitignore.geaendert) schreibeAtomar(echtesDateiZiel(gitignore), b.gitignore.neu, undo.gitignore.modus);
    if (undo.config.geaendert) {
      if (liesConfigRoh(z.vault).stand !== b.config.stand) throw new Error("config-geaendert");     // optimistisch: zwischen Lesen und Schreiben nichts überschreiben
      schreibeAtomar(echtesDateiZiel(configDatei), b.config.neu, undo.config.modus);
    }
    ctx.pruefpunkt("nach-config");
    if (undo.merker.geaendert) schreibeAtomar(echtesDateiZiel(merker), b.merker.neu, undo.merker.modus);
    return { status: "ok", anzahl: n, details: { alteFelder: b.config.entfernt.length, gitignore: undo.gitignore.geaendert, merker: undo.merker.geaendert } };
  },
  nachpruefen(z) {
    const roh = liesConfigRoh(z.vault);
    if (roh.fehler) return false;
    if (roh.cfg && ALTE_FELDER.some((k) => k in roh.cfg)) return false;
    try { pruefeVault(z.vault); } catch { return false; }
    return true;
  },
  zurueck(z, ctx, undo) {
    const hinweise = [];
    if (!undo) return { status: "nichts", hinweise };
    let n = 0;
    const eine = (name, d, datei) => {
      if (!d || !d.geaendert) return;
      const jetzt = hashDatei(datei);
      if (jetzt === d.hashVorher) return;                                 // schon zurück (z. B. durch den Revert des Commits)
      if (jetzt === d.hashNachher) {
        if (d.sicherung) stelleHer(datei, sicherungsPfad(z, d.sicherung), d.modus || 0o600);
        else rmSync(datei, { force: true });                              // gab es vorher nicht
        n++;
      } else hinweise.push(`${name}-geaendert`);
    };
    eine("gitignore", undo.gitignore, join(z.vault, ".gitignore"));
    eine("config", undo.config, join(z.vault, "brain.config.json"));
    if (undo.merker && undo.merker.rel) eine("geraetemerker", undo.merker, join(z.vault, undo.merker.rel));
    return { status: n ? "ok" : "nichts", hinweise };
  },
};

// ===================================================================================================================================
// B3 — ein Commit nur dieser Pfade
// ===================================================================================================================================
function b2Angaben(z) {
  try { const l = undoListe(z, liesZustand(z), "B2"); return l[0] || null; } catch { return null; }
}
function pfadeFuerCommit(z) {
  const u = b2Angaben(z);
  const kandidaten = [];
  const kit = gitLauf(z, ["ls-files", "-z", "--", ALT_KIT_ORDNER]);
  // „getrackt“ auch, wenn die Löschung schon vorgemerkt ist (Abbruch zwischen `rm --cached` und `commit`)
  const vorgemerkt = gitLauf(z, ["diff", "--cached", "--name-only", "-z", "--", ALT_KIT_ORDNER]);
  const getrackt = (kit.status === 0 && kit.stdout.length > 0) || (vorgemerkt.status === 0 && vorgemerkt.stdout.length > 0);
  if (u) {
    if (u.config && u.config.geaendert && u.config.sauber) kandidaten.push("brain.config.json");
    if (u.gitignore && u.gitignore.geaendert && u.gitignore.sauber) kandidaten.push(".gitignore");
    if (u.merker && u.merker.geaendert && u.merker.sauber && u.merker.rel) kandidaten.push(u.merker.rel);
  }
  // nur, was wirklich noch zu speichern ist (ein zweiter Lauf nach einem Abbruch findet den Commit schon vor)
  const andere = kandidaten.filter((rel) => { const s = gitLauf(z, ["status", "--porcelain", "-z", "--", rel]); return s.status === 0 && s.stdout.trim() !== ""; });
  return { getrackt, andere };
}

export const B3 = {
  id: "B3", titel: "Änderungen im Versionsverlauf speichern",
  plan(z) {
    if (!hatGit(z)) return { noetig: false, text: "Dieser Vault hat keinen Versionsverlauf – nichts zu speichern." };
    return { noetig: true, text: "Kortex speichert die Änderungen in einem einzigen Eintrag im Versionsverlauf (nur der alte Werkzeug-Ordner und die genannten Dateien). Der Eintrag lässt sich rückgängig machen." };
  },
  wende(z, ctx) {
    if (!hatGit(z)) return { status: "uebersprungen", grund: "kein-git" };
    // Nach einem Abbruch zwischen `git commit` und dem Vermerken steht der Commit schon im Verlauf → übernehmen
    const frueher = undoListe(z, liesZustand(z), "B3")[0];
    if (frueher && !frueher.commit && frueher.headVorher) {
      const h = gitSicherLauf(z, ["rev-parse", "HEAD"]).stdout.trim();
      if (h && h !== frueher.headVorher && gitSicherLauf(z, ["rev-parse", "HEAD^"]).stdout.trim() === frueher.headVorher && gitSicherLauf(z, ["log", "-1", "--format=%s"]).stdout.trim() === MELDUNG) {
        ctx.merkeUndo({ ...frueher, commit: h });
        return { status: "ok", anzahl: (frueher.committet || []).length, details: { commit: true, uebernommen: true } };
      }
    }
    const { getrackt, andere } = pfadeFuerCommit(z);
    const pfade = [...(getrackt ? [ALT_KIT_ORDNER] : []), ...andere];
    if (!pfade.length) return { status: "nichts" };
    const head = gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]);
    const undo = { headVorher: head.status === 0 ? head.stdout.trim() : null, commit: null, committet: pfade };
    ctx.merkeUndo(undo);
    const aufraeumen = () => { gitSicherLauf(z, ["reset", "-q", "--", ...pfade]); };
    if (getrackt) { const r = gitSicherLauf(z, ["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", ALT_KIT_ORDNER]); if (r.status !== 0) { aufraeumen(); throw new Error(r.status === 126 ? "git-gesperrt" : "rm-fehlgeschlagen"); } }
    if (andere.length) { const a = gitSicherLauf(z, ["add", "--", ...andere]); if (a.status !== 0) { aufraeumen(); throw new Error(a.status === 126 ? "git-gesperrt" : "add-fehlgeschlagen"); } }
    const c = gitSicherLauf(z, ["commit", "-q", "-m", MELDUNG, "--", ...pfade]);
    if (c.status !== 0) { aufraeumen(); throw new Error(c.status === 126 ? "git-gesperrt" : "commit-fehlgeschlagen"); }
    ctx.pruefpunkt("nach-commit");
    const h = gitSicherLauf(z, ["rev-parse", "HEAD"]);
    undo.commit = h.status === 0 ? h.stdout.trim() : null;
    ctx.merkeUndo(undo);
    ctx.nachDaten = { getrackt };
    return { status: "ok", anzahl: pfade.length, details: { commit: !!undo.commit, pfade: pfade.length } };
  },
  nachpruefen(z, ctx) {
    const d = ctx.nachDaten;
    if (!d || !d.getrackt) return true;
    const r = gitLauf(z, ["ls-files", "-z", "--", ALT_KIT_ORDNER]);
    return r.status === 0 && r.stdout.length === 0;
  },
  zurueck(z, ctx, undo) {
    const hinweise = [];
    if (!undo) return { status: "nichts", hinweise };
    let commit = undo.commit;
    // Absturz zwischen `git commit` und dem Vermerken: HEAD ist unser Commit, wenn er direkt auf dem früheren HEAD sitzt und unsere Meldung trägt
    if (!commit && undo.headVorher) {
      const h = gitSicherLauf(z, ["rev-parse", "HEAD"]).stdout.trim();
      if (h && h !== undo.headVorher && gitSicherLauf(z, ["rev-parse", "HEAD^"]).stdout.trim() === undo.headVorher && gitSicherLauf(z, ["log", "-1", "--format=%s"]).stdout.trim() === MELDUNG) commit = h;
    }
    if (!commit) {
      // nichts committet; waren Löschungen nur vorgemerkt, den Index zurücksetzen
      if (undo.committet && undo.committet.length && hatGit(z)) gitSicherLauf(z, ["reset", "-q", "--", ...undo.committet]);
      return { status: "nichts", hinweise };
    }
    // Ist der Commit überhaupt noch ein Vorfahre von HEAD? Sonst gibt es nichts zurückzunehmen (z. B. der Nutzer hat ihn schon selbst zurückgenommen)
    const vorfahre = gitSicherLauf(z, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    if (vorfahre.status !== 0) { hinweise.push("commit-nicht-mehr-im-verlauf"); return { status: "nichts", hinweise }; }
    const r = gitSicherLauf(z, ["revert", "--no-edit", commit]);
    if (r.status !== 0) { gitSicherLauf(z, ["revert", "--abort"]); hinweise.push("revert-fehlgeschlagen"); return { status: "nichts", hinweise }; }
    return { status: "ok", hinweise };
  },
};

export const SCHRITTE_B = [B0, B1, B2, B3];
export const IDS_B = [...SCHRITTE_B.map((s) => s.id), "B4"];
export { baumEnthalten };
