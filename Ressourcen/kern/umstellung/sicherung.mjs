// umstellung/sicherung.mjs — Schritt A0 der Phase A (Paket P7b, Plan Abschnitt 3): die Sicherung VOR jeder Änderung.
//   · vor-kortex.bundle   alle Commits des Vaults (git bundle --all) im Support-Ordner – die letzte Rettung, auch wenn alles andere schiefgeht
//   · .git/config.vor-kortex   die lokale git-Konfiguration vor der Umstellung (Plan Abschnitt 3.3), dazu eine Kopie im Support-Ordner
//   · Kopien (0600, nur im Support-Ordner) von brain.config.json, settings.json je Claude-Profil, der plist des Hintergrunddienstes und der globalen git-Konfiguration
// A0 ändert nichts an den Einstellungen selbst; sein Rückweg räumt nur die Kopie in .git/ weg (Bundle und Kopien im Support-Ordner bleiben).
import { existsSync, lstatSync, rmSync, chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ablageOrdner, hashDatei, sichereDatei } from "./protokoll.mjs";
import { gitLauf } from "./ziele.mjs";

export const id = "A0";
export const titel = "Sicherung anlegen";
const DIENST_PLIST = "de.brain.tageslauf.plist";

export const bundlePfad = (z) => join(ablageOrdner(z), "vor-kortex.bundle");
const hatRepo = (z) => { try { return lstatSync(join(z.vault, ".git")).isDirectory(); } catch { return false; } };

export function plan(z) {
  return { noetig: !existsSync(bundlePfad(z)) || !existsSync(join(z.vault, ".git", "config.vor-kortex")), text: "Kortex sichert zuerst alle Commits des Vaults (Bundle) und die Einstellungen, die es gleich ändert." };
}

export function wende(z, ctx) {
  let bundle = "keins";
  if (existsSync(join(z.vault, ".git"))) {
    const ziel = bundlePfad(z);
    if (existsSync(ziel)) bundle = "vorhanden";
    else {
      mkdirSync(ablageOrdner(z), { recursive: true, mode: 0o700 });
      const r = gitLauf(z, ["bundle", "create", ziel, "--all"]);
      if (r.status !== 0) {
        try { rmSync(ziel, { force: true }); } catch { /* weg */ }
        if (/empty bundle/i.test(r.stderr)) bundle = "leer";
        else throw new Error("bundle-fehlgeschlagen");
      } else {
        try { chmodSync(ziel, 0o600); } catch { /* best effort */ }
        const v = gitLauf(z, ["bundle", "verify", ziel]);
        if (v.status !== 0) { try { rmSync(ziel, { force: true }); } catch { /* weg */ } throw new Error("bundle-ungeprueft"); }
        bundle = "neu";
      }
    }
  }
  let anzahl = 0;
  const kopiere = (quelle, name) => { if (sichereDatei(z, ctx.sicherungsDir, quelle, name)) anzahl++; };
  // .git/config → .git/config.vor-kortex (nie überschreiben: die erste Kopie ist die ursprüngliche)
  const undo = { bundle };
  if (hatRepo(z) && existsSync(join(z.vault, ".git", "config"))) {
    const kopie = join(z.vault, ".git", "config.vor-kortex");
    if (!existsSync(kopie)) { copyFileSync(join(z.vault, ".git", "config"), kopie); chmodSync(kopie, 0o600); undo.gitConfigKopie = { datei: ".git/config.vor-kortex", hash: hashDatei(kopie) }; }
    kopiere(join(z.vault, ".git", "config"), "git-config.vor-kortex");
  }
  ctx.merkeUndo(undo);
  kopiere(join(z.vault, "brain.config.json"), "brain.config.json");
  for (const p of z.claudeProfile) kopiere(join(p.pfad, "settings.json"), `settings-${p.name}.json`);
  kopiere(join(z.launchAgentsQuelle || z.launchAgents, DIENST_PLIST), DIENST_PLIST);
  kopiere(z.gitGlobal, "gitconfig-global");
  return { status: "ok", anzahl, details: { bundle } };
}

export function nachpruefen(z) {
  if (existsSync(join(z.vault, ".git")) && !existsSync(bundlePfad(z))) {
    // ein leeres Repository (keine Commits) hat kein Bundle
    const r = gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]);
    return r.status !== 0;
  }
  return true;
}

export function zurueck(z, ctx, undo) {
  const hinweise = [];
  const k = undo && undo.gitConfigKopie;
  if (k) {
    const datei = join(z.vault, k.datei);
    if (existsSync(datei) && hashDatei(datei) === k.hash) rmSync(datei, { force: true });
    else if (existsSync(datei)) hinweise.push("config-vor-kortex-geaendert");
  }
  return { status: k ? "ok" : "nichts", hinweise };
}
